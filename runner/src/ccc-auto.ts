import { codePrompt, fastLevelLimit, prepareFastCode } from './ccc-fast.js';
import { steerCodexJob } from './app-server.js';
import { raceLight } from './ccc-race.js';
import { prepareSolverTemplate } from './ccc-solver-template.js';
import { runRecipe, withOptimization, optimizationDelayMs } from './ccc-execution.js';
import { createHash } from 'node:crypto';
import { appendFile, mkdir, open, readFile, realpath, rename, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { CccClient } from './ccc-client.js';
import { submissionRateLimit } from './ccc-client.js';
import { setTimeout as delay } from 'node:timers/promises';
import type { Event, Job } from './cli.js';

const maxBytes = 30 * 1024 * 1024;
async function batch<T, R>(items: T[], action: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0, failed = false;
  const settled = await Promise.allSettled(Array.from({ length: Math.min(3, items.length) }, async () => {
    while (!failed && next < items.length) {
      const index = next++;
      try { results[index] = await action(items[index], index); }
      catch (error) { failed = true; throw error; }
    }
  }));
  for (const result of settled) {
    if (result.status === 'rejected') throw result.reason;
  }
  return results;
}
type Submission = { status: 'submitting' | 'accepted' | 'rejected' | 'not-sent'; evaluation?: unknown; deliveryJobId?: number };
type SolverThread = { accountId: string; threadId: string };
type State = { contest: string; submissions: Record<string, Submission>; fastFailed?: boolean; fastFailedLevel?: number; fastFeedback?: unknown; solverThread?: SolverThread; lightThread?: SolverThread; candidateThreads?: Record<string, SolverThread>; winnerAgent?: SolverThread & { reasoning: string } };
export type Solver = (job: Job, signal: AbortSignal, emit: (event: Event) => void) => Promise<string>;

// Give the model the statement and small input samples without a discovery turn.
export async function solverContext(files: { name: string; path: string; pdf_preview?: unknown }[], inputs: { file_id: string; path: string }[]) {
  const samples = files.filter(file => /example|sample/i.test(file.name) && /\.(txt|in|out)$/i.test(file.name)).slice(0, 4);
  const paths = [...new Set([...samples.map(file => file.path), ...inputs.slice(0, 1).map(input => input.path)])];
  const previews = await batch(paths, async file => {
    const handle = await open(file, 'r');
    try {
      const bytes = Buffer.alloc(4096);
      const { bytesRead } = await handle.read(bytes, 0, bytes.length, 0);
      const lines = bytes.subarray(0, bytesRead).toString('utf8').split('\n');
      const truncated = (await handle.stat()).size > bytesRead || lines.length > 16;
      return { path: file, text: lines.slice(0, 16).join('\n'), truncated };
    } finally { await handle.close(); }
  });
  let remaining = 16000;
  return { files: files.map(file => {
    if (!file.pdf_preview) return { name: file.name, path: file.path };
    const preview = JSON.stringify(file.pdf_preview);
    const text = preview.slice(0, remaining);
    remaining -= text.length;
    return { name: file.name, path: file.path, pdf_preview: text, truncated: text.length < preview.length };
  }), inputs, previews };
}

export function contestReference(prompt: string): string {
  // Backend history must never select a link from an earlier request.
  const current = prompt.split('Current user request:\n').at(-1)!.trim();
  const urls = current.match(/https:\/\/[^\s<>"']+/g) || [];
  for (const value of urls) {
    const url = new URL(value.replace(/[),.;]+$/, ''));
    if (url.hostname !== 'codingcontest.org' && !url.hostname.endsWith('.codingcontest.org')) continue;
    const contest = url.pathname.match(/^\/contests\/([^/]+)(?:\/|$)/)?.[1];
    if (contest) return decodeURIComponent(contest);
  }
  if (/^[a-zA-Z0-9][a-zA-Z0-9._-]{2,200}$/.test(current)) return current;
  throw new Error('CCC авто: send the contest game URL (codingcontest.org/contests/…/game) or its exact contest slug');
}

function passed(info: any, level: number, id: string): boolean {
  const value = info.participant?.score?.state?.[`level${level}`]?.passedFiles?.[id];
  return value !== null && value !== undefined && value !== false;
}
async function atomic(file: string, data: unknown) {
  await writeFile(file + '.tmp', JSON.stringify(data, null, 2), { mode: 0o600 });
  await rename(file + '.tmp', file);
}
async function solverSource(directory: string): Promise<string | undefined> {
  const handle = await open(path.join(directory, 'solution.cpp'), 'r').catch(error => {
    if (error.code === 'ENOENT') return undefined;
    throw error;
  });
  if (!handle) return undefined;
  try { if ((await handle.stat()).size <= 256 * 1024) return await handle.readFile('utf8'); }
  finally { await handle.close(); }
}
function filename(value: unknown): string {
  if (typeof value !== 'string' || !value || value.includes('\\') || value.includes('\0') || value.split('/').some(part => part === '..')) throw new Error('CCC returned an unsafe filename');
  return path.basename(value);
}
async function artifact(client: CccClient, item: any, target: string, signal: AbortSignal) {
  if (!item?.artifact_id) throw new Error('CCC returned no artifact ID');
  if (item.bytes > maxBytes) throw new Error('CCC file exceeds the 30 MiB limit');
  const link = await client.call('get_artifact_download_url', { artifact_id: item.artifact_id, filename: filename(item.filename || path.basename(target)) });
  if (typeof link.url !== 'string' || !link.url.startsWith('https://')) throw new Error('CCC returned an invalid download URL');
  const response = await fetch(link.url, { signal: AbortSignal.any([signal, AbortSignal.timeout(120_000)]) });
  if (!response.ok || !response.body) throw new Error('CCC artifact download failed');
  const chunks: Uint8Array[] = []; let size = 0;
  try {
    for await (const chunk of response.body as any as AsyncIterable<Uint8Array>) {
      size += chunk.length;
      if (size > maxBytes) throw new Error('CCC file exceeds the 30 MiB limit');
      chunks.push(chunk);
    }
  } catch (error) { await response.body.cancel().catch(() => {}); throw error; }
  const data = Buffer.concat(chunks);
  if (typeof item.bytes === 'number' && data.length !== item.bytes || item.sha256 && createHash('sha256').update(data).digest('hex') !== item.sha256) throw new Error('CCC artifact integrity check failed');
  await writeFile(target, data, { mode: 0o600 });
}

export async function readAnswers(file: string, directory: string, ids: string[]): Promise<Map<string, Buffer>> {
  const bytes = await readFile(file);
  if (bytes.length > 1024 * 1024) throw new Error('CCC answer manifest is too large');
  const data = JSON.parse(bytes.toString('utf8'));
  if (!Array.isArray(data.answers) || data.answers.length !== ids.length) throw new Error('CCC answer manifest must contain every pending input exactly once');
  const answers = new Map<string, Buffer>();
  const root = await realpath(directory);
  for (const answer of data.answers) {
    if (!ids.includes(answer.file_id) || answers.has(answer.file_id) || (typeof answer.path === 'string') === (typeof answer.solution === 'string')) throw new Error('CCC answer manifest has duplicate, unknown or invalid fields');
    let content: Buffer;
    if (typeof answer.path === 'string') {
      const resolved = await realpath(path.resolve(directory, answer.path));
      if (!resolved.startsWith(root + path.sep)) throw new Error('CCC output must stay inside its level folder');
      content = await readFile(resolved);
    } else content = Buffer.from(answer.solution, 'utf8');
    if (!content.length || content.length > maxBytes || content.includes(0)) throw new Error('CCC output is empty, binary or exceeds 30 MiB');
    try { new TextDecoder('utf-8', { fatal: true }).decode(content); }
    catch { throw new Error('CCC output must be valid UTF-8 text'); }
    answers.set(answer.file_id, content);
  }
  return answers;
}

export async function runCccAuto(job: Job, cwd: string, client: CccClient, solve: Solver, signal: AbortSignal, emit: (event: Event) => void, options: { steer?: typeof steerCodexJob; mediumHeadStartMs?: number } = {}): Promise<string> {
  const reference = contestReference(job.originalPrompt || job.prompt);
  // Explicit recovery authorization must come from this request, never quoted chat history.
  const retryUnresolved = /\bCCC_RETRY_UNRESOLVED\b/.test((job.originalPrompt || job.prompt).split('Current user request:\n').at(-1)!);
  emit({ type: 'status', message: 'CCC авто: checking contest and progress' });
  const startedAt = Date.now();
  const progressStartedAt = Date.now();
  let info = await client.call('game_info', { contest: reference });
  const initialProgressMs = Date.now() - progressStartedAt;
  const contest = info.contest_slug || reference;
  const key = createHash('sha256').update(job.sessionId + ':' + contest).digest('hex').slice(0, 24);
  const directory = path.join(cwd, '.ai-router/ccc-auto', key);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const stateFile = path.join(directory, 'state.json');
  let state: State;
  try { state = JSON.parse(await readFile(stateFile, 'utf8')); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; state = { contest, submissions: {} }; }
  if (state.contest !== contest || !state.submissions) throw new Error('CCC saved progress does not match this contest');
  let saveTail = Promise.resolve();
  const save = () => {
    const snapshot = structuredClone(state);
    const write = saveTail.then(() => atomic(stateFile, snapshot));
    saveTail = write.catch(() => {});
    return write;
  };
  const timingsFile = path.join(directory, 'timings.jsonl');
  const reportTiming = async (stage: string, elapsedMs: number, details: Record<string, unknown> = {}) => {
    const data = { stage, elapsedMs, ...details };
    await appendFile(timingsFile, JSON.stringify({ at: new Date().toISOString(), taskId: job.taskId, ...data }) + '\n', { mode: 0o600 });
    emit({ type: 'status', message: `CCC авто: ${stage} ${Math.round(elapsedMs / 1000)}s`, data: { cccTiming: data } });
  };
  async function timed<T>(stage: string, action: () => Promise<T>, details: Record<string, unknown> = {}): Promise<T> {
    const start = Date.now();
    let outcome = 'failed';
    try { const result = await action(); outcome = 'completed'; return result; }
    finally { await reportTiming(stage, Date.now() - start, { ...details, outcome: signal.aborted ? 'canceled' : outcome }); }
  }
  await reportTiming('progress', initialProgressMs);
  const completedUsage: Record<string, number> = {};
  const activeUsage = new Map<symbol, Record<string, number>>();
  const emitUsage = () => {
    const total = { ...completedUsage };
    for (const usage of activeUsage.values()) for (const [field, value] of Object.entries(usage)) total[field] = (total[field] || 0) + value;
    if (Object.keys(total).length) emit({ type: 'usage', data: total });
  };
  const runId = createHash('sha256').update(job.taskId).digest('hex').slice(0, 16);
  let regularSolverTaskId = `${job.taskId}-ccc-solver`;
  let solverThreadId = state.solverThread?.accountId === job.accountId ? state.solverThread.threadId : undefined;
  let lightThreadId = state.lightThread?.accountId === job.accountId ? state.lightThread.threadId : undefined;
  let winnerAgent = state.winnerAgent?.accountId === job.accountId ? state.winnerAgent : undefined;
  async function askSolver(solverPrompt: string, solverTaskId: string, solverSignal: AbortSignal, reuseThread = false, codeOnly = false,
    options: { reasoning?: string; previousThreadId?: string; onCheckpoint?: (threadId: string) => void } = {}) {
    const previousThreadId = options.previousThreadId ?? (reuseThread ? solverThreadId : undefined);
    let latestUsage: Record<string, number> = {};
    const usageKey = Symbol(solverTaskId);
    activeUsage.set(usageKey, latestUsage);
    let checkpoint: string | undefined;
    const solverStartedAt = Date.now();
    let firstToolMs: number | undefined;
    let lastToolMs: number | undefined;
    let toolCount = 0;
    activeSolvers.add(solverTaskId);
    try {
      return await timed(codeOnly ? 'code_generation' : 'solver', () => solve({ ...job, jobId: solverTaskId, workflow: 'standard', solverOnly: true, solverCodeOnly: codeOnly, previousThreadId, taskId: solverTaskId, prompt: solverPrompt, model: 'gpt-6.1-sol', reasoning: options.reasoning ?? (codeOnly ? 'low' : 'medium'), fast: true }, solverSignal, event => {
        // The workflow reports progress; internal solver narration is not a chat reply.
        if (event.type === 'tool') {
          lastToolMs = Date.now() - solverStartedAt;
          firstToolMs ??= lastToolMs;
          toolCount++;
        }
        if (event.type === 'checkpoint') {
          if (solverSignal.aborted) return;
          if (typeof event.data?.threadId === 'string') { checkpoint = event.data.threadId; options.onCheckpoint?.(checkpoint); }
          return;
        }
        if (event.type === 'delta') return;
        if (event.type === 'usage' && event.data && !event.data.limits) {
          for (const [field, snake] of [['inputTokens', 'input_tokens'], ['outputTokens', 'output_tokens'], ['cachedInputTokens', 'cached_input_tokens'], ['reasoningOutputTokens', 'reasoning_output_tokens'], ['totalTokens', 'total_tokens']]) {
            const value = event.data[field] ?? event.data[snake];
            if (typeof value === 'number' && Number.isSafeInteger(value)) latestUsage[field] = value;
          }
          latestUsage.totalTokens ??= (latestUsage.inputTokens || 0) + (latestUsage.outputTokens || 0);
          emitUsage();
        } else emit(event.type === 'status' && event.data?.steeringAvailable ? { ...event, data: { ...event.data, steeringAvailable: false } } : event);
      }), { solverTaskId, reusedThread: Boolean(previousThreadId) });
    } finally {
      activeSolvers.delete(solverTaskId);
      activeUsage.delete(usageKey);
      for (const [field, value] of Object.entries(latestUsage)) completedUsage[field] = (completedUsage[field] || 0) + value;
      emitUsage();
      if (firstToolMs !== undefined) await reportTiming('solver_first_tool', firstToolMs, { solverTaskId, toolCount, lastToolMs });
      if (checkpoint && !reuseThread) await save();
      if (reuseThread && checkpoint && !solverSignal.aborted) {
        solverThreadId = checkpoint;
        state.solverThread = { accountId: job.accountId, threadId: checkpoint };
        await save();
      }
    }
  }
  const activeSolvers = new Set<string>();
  let accepted = 0;
  let previousLevelContext: unknown;
  const levels = [...(info.levels || [])].sort((a: any, b: any) => a.level - b.level);
  if (!levels.length) throw new Error('CCC returned no levels for this contest');
  for (const levelInfo of levels) {
    signal.throwIfAborted();
    const level = levelInfo.level;
    if (!Number.isSafeInteger(level) || level < 1) throw new Error('CCC returned an invalid level');
    // Initial progress and the previous level's final verification are already fresh.
    const ids: string[] = levelInfo.inputFiles;
    if (!Array.isArray(ids) || !ids.length || ids.some(id => typeof id !== 'string') || new Set(ids).size !== ids.length) throw new Error('CCC returned invalid input file IDs');
    const unscored = new Set(levelInfo.unscoredFiles || []);
    let pending = ids.filter(id => !unscored.has(id) && !passed(info, level, id));
    for (const id of pending) {
      const previous = state.submissions[`${level}:${id}`];
      if (previous?.status === 'submitting' && retryUnresolved) {
        // Fresh platform progress above did not confirm acceptance. The user explicitly allowed a retry.
        state.submissions[`${level}:${id}`] = { status: 'not-sent' };
        await save();
        emit({ type: 'status', message: `CCC авто: retry authorized for level ${level}, ${id}; saved solver results will be reused when available` });
      } else if (previous?.status === 'submitting' || previous?.status === 'accepted') throw new Error(`CCC level ${level}, ${id}: previous submission is unresolved. Check platform progress before continuing; it will not be sent twice. To explicitly allow retrying an unconfirmed submission, send the contest URL with CCC_RETRY_UNRESOLVED.`);
    }
    if (!pending.length) continue;
    emit({ type: 'status', message: `CCC авто: fetching level ${level} (${pending.length} inputs)` });
    const downloadStartedAt = Date.now();
    const prepared = await client.call('prepare_level', { contest, level });
    const folder = path.join(directory, `level-${level}`);
    await mkdir(folder, { recursive: true, mode: 0o700 });
    let entries = prepared.files?.entries;
    if (!Array.isArray(entries) || !prepared.files?.extracted) {
      if (!prepared.archive?.artifact_id) throw new Error('CCC returned no level files');
      const archive = await client.call('list_archive', { artifact_id: prepared.archive.artifact_id });
      const members = archive.entries || archive.files;
      if (!Array.isArray(members)) throw new Error('CCC archive listing is invalid');
      entries = await batch(members, async (member: any) => {
        const name = member.name || member.filename; filename(name);
        const extracted = await client.call('archive_member', { artifact_id: prepared.archive.artifact_id, name });
        return extracted.artifact || extracted;
      });
    }
    const files = await batch<any, { name: string; path: string; pdf_preview?: unknown }>(entries, async (entry, index) => {
      const name = filename(entry.filename);
      const target = path.join(folder, `${index}-${name}`);
      await artifact(client, entry, target, signal);
      return { name, path: target, ...(entry.pdf_preview ? { pdf_preview: entry.pdf_preview } : {}) };
    });
    // Fetch by the exact platform IDs; archive filenames are never used to guess IDs.
    const inputs = await batch(pending, async (id, index) => {
      const existing = files.filter(file => file.name === `in_level-${level}_${id}.txt`);
      if (existing.length === 1) return { file_id: id, path: existing[0].path };
      const downloaded = await client.call('get_level_input', { contest, level, file_id: id });
      const target = path.join(folder, `input-${index}.txt`);
      await artifact(client, downloaded.artifact || downloaded, target, signal);
      return { file_id: id, path: target };
    });
    const sizes = await Promise.all(inputs.map(input => stat(input.path)));
    const inputSizes = new Map(inputs.map((input, index) => [input.file_id, sizes[index].size]));
    inputs.sort((a, b) => inputSizes.get(a.file_id)! - inputSizes.get(b.file_id)!);
    const manifest = path.join(folder, 'task.json');
    await atomic(manifest, { contest, level, level_info: prepared.level_info, files, inputs });
    await reportTiming('download', Date.now() - downloadStartedAt, { level });
    const context = await timed('solver_context', () => solverContext(files, inputs), { level });
    let feedback: unknown = state.fastFailedLevel === level ? state.fastFeedback : undefined;
    let feedbackVersion = 0;
    const broadcastFeedback = () => {
      feedbackVersion++;
      for (const taskId of activeSolvers) {
        void (options.steer ?? steerCodexJob)(taskId, `Platform rejected a candidate. Correct your solver using this feedback: ${JSON.stringify(feedback)}`).catch(() => {});
      }
    };
    let successfulDirectory: string | undefined;
    let submissionTail = Promise.resolve();
    const rejectedEarly = new WeakSet<Map<string, Buffer>>();
    let submissionFailed = false;
    let submissionError: unknown;
    const submissionController = new AbortController();
    // This outbox is independent of model threads and survives submission failures.
    const outboxFile = path.join(folder, 'outbox.json');
    type Queued = { directory: string; light: boolean; rejected?: boolean; answers: { file_id: string; path: string }[] };
    let outbox: Record<string, Queued> = {};
    try { outbox = JSON.parse(await readFile(outboxFile, 'utf8')); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    let outboxTail = Promise.resolve();
    const queueKey = (dir: string) => createHash('sha256').update(dir).digest('hex').slice(0, 24);
    const updateOutbox = (action: () => Promise<void>) => {
      const write = outboxTail.then(async () => { await action(); await atomic(outboxFile, outbox); });
      outboxTail = write.catch(() => {});
      return write;
    };
    const queueAnswers = (answers: Map<string, Buffer>, light: boolean, dir: string) => updateOutbox(async () => {
      const key = queueKey(dir);
      const queued = outbox[key] ??= { directory: dir, light, answers: [] };
      if (queued.rejected) return;
      const target = path.join(folder, 'outbox', key);
      await mkdir(target, { recursive: true, mode: 0o700 });
      for (const [id, content] of answers) {
        if (!pending.includes(id)) continue;
        const file = path.join(target, createHash('sha256').update(id).digest('hex') + '.txt');
        await writeFile(file + '.tmp', content, { mode: 0o600 });
        await rename(file + '.tmp', file);
        if (!queued.answers.some(answer => answer.file_id === id)) queued.answers.push({ file_id: id, path: path.relative(folder, file) });
      }
    });
    const discardAnswers = (dir: string) => updateOutbox(async () => { delete outbox[queueKey(dir)]; });
    const invalidateAnswers = (dir: string) => updateOutbox(async () => {
      const queued = outbox[queueKey(dir)];
      if (queued) { queued.rejected = true; queued.answers = []; }
    });
    const submitBatch = async (answers: Map<string, Buffer>, lightWinner: boolean, sourceDirectory: string, racing = false) => {
      const rejected: string[] = []; const evaluations: Record<string, unknown> = {};
      for (const id of [...pending]) {
        signal.throwIfAborted();
        const content = answers.get(id);
        if (!content) continue;
        let submission: Record<string, unknown> = { contest, level, file_id: id, filename: `level-${level}-output.txt`, include_case_details: true };
        if (content.length <= 256 * 1024) submission.solution = content.toString('utf8');
        else {
          const uploaded = await timed('upload', () => client.call('upload_artifact', { filename: submission.filename, data_base64: content.toString('base64') }), { level, fileId: id });
          const artifactId = uploaded.artifact_id || uploaded.artifact?.artifact_id;
          if (!artifactId) throw new Error('CCC output upload returned no artifact ID');
          submission.artifact_id = artifactId;
        }
        // Persist before dispatch. Lost responses remain uncertain even after cancellation/restart.
        emit({ type: 'tool', message: `CCC авто: submitting level ${level}, ${id}` });
        let result: any;
        try {
          for (let retry = 0; ; retry++) {
            signal.throwIfAborted();
            state.submissions[`${level}:${id}`] = { status: 'submitting' }; await save();
            try {
              result = await timed('submission', () => client.call('submit_solution', submission), { level, fileId: id });
              break;
            } catch (error) {
              const rateLimit = submissionRateLimit(error);
              if (!rateLimit) throw error;
              // An explicit HTTP refusal is not an uncertain delivery. Preserve this across cancellation/restart.
              state.submissions[`${level}:${id}`] = { status: 'not-sent' }; await save();
              if (retry >= 5) throw error;
              emit({ type: 'status', message: 'CCC авто: server refused submission (HTTP 429); retrying saved answer' });
              await delay(Math.max(1000, rateLimit.retryAfterMs ?? 1000), undefined, { signal });
            }
          }
        }
        catch (error) {
          signal.throwIfAborted();
          emit({ type: 'status', message: 'CCC авто: submission response lost; checking platform progress before continuing' });
          const progress = await timed('progress', () => client.call('game_info', { contest }), { level });
          if (!passed(progress, level, id)) throw error;
          // Platform confirms delivery; do not dispatch this submission again.
          result = { evaluation: { isCorrect: true, recoveredFromProgress: true } };
        }
        const correct = result.evaluation?.isCorrect;
        if (typeof correct !== 'boolean') throw new Error('CCC submission has no definitive evaluation; check platform progress before continuing');
        if (!correct && lightWinner) { state.fastFailed = true; state.fastFailedLevel = level; }
        if (!correct) await invalidateAnswers(sourceDirectory);
        state.submissions[`${level}:${id}`] = { status: correct ? 'accepted' : 'rejected', evaluation: result.evaluation, deliveryJobId: result.delivery_job_id };
        await save();
        emit({ type: 'status', message: `CCC авто: level ${level}, ${id} — ${correct ? 'accepted' : 'rejected'}` });
        if (correct) { accepted++; pending = pending.filter(value => value !== id); }
        else {
          rejected.push(id); evaluations[id] = result.evaluation;
          if (lightWinner || racing) {
            emit({ type: 'status', message: 'CCC авто: answer rejected; other candidates continue solving' });
            break;
          }
        }
      }
      if (rejected.length) feedback = { evaluations, sourceDirectory, source: await solverSource(sourceDirectory) };
      if (rejected.length) broadcastFeedback();
      if (rejected.length && state.fastFailedLevel === level) { state.fastFeedback = feedback; await save(); }
      return pending.length === 0;
    };
    const submitAnswers = (answers: Map<string, Buffer>, light: boolean, dir: string, racing = false, candidateSignal = signal, deferFailure = false) => {
      if (rejectedEarly.has(answers)) return Promise.resolve(false);
      const queued = queueAnswers(answers, light, dir);
      const submission = submissionTail.then(async () => { await queued; candidateSignal.throwIfAborted(); submissionController.signal.throwIfAborted(); if (submissionFailed) throw submissionError; return submitBatch(answers, light, dir, racing); });
      submissionTail = submission.then(() => {}, () => {});
      return submission.catch(error => { if (!candidateSignal.aborted) { submissionFailed = true; submissionError = error; if (!deferFailure) submissionController.abort(error); } throw error; });
    };
    // Probe first, then compute the rest while the platform validates the probe.
    const executeStaged = async (dir: string, candidateSignal: AbortSignal, light = false, expectedIds = pending) => {
      // A repaired solver can reuse its directory once the rejected execution has drained.
      if (outbox[queueKey(dir)]?.rejected) await discardAnswers(dir);
      const recipe = await readFile(path.join(dir, 'solver.json')).catch(error => {
        if (error.code === 'ENOENT') return undefined;
        throw error;
      });
      const output = path.join(dir, 'answers.json');
      if (!recipe) return timed('answer_validation', () => readAnswers(output, dir, expectedIds), { level });
      const answers = new Map<string, Buffer>();
      const computationController = new AbortController();
      const computationSignal = AbortSignal.any([candidateSignal, computationController.signal]);
      const runInputs = async (selected: typeof inputs, name: string) => {
        if (!selected.length) return;
        const task = path.join(dir, `${name}-task.json`), result = path.join(dir, `${name}-answers.json`);
        await atomic(task, { contest, level, files, inputs: selected });
        await timed('execution', () => runRecipe(dir, task, result, computationSignal), { level, candidate: path.basename(dir), batch: name });
        candidateSignal.throwIfAborted();
        const outputs = await timed('answer_validation', () => readAnswers(result, dir, selected.map(input => input.file_id)), { level });
        for (const [id, content] of outputs) answers.set(id, content);
        await queueAnswers(outputs, light, dir);
      };
      const smallest = inputs.find(input => pending.includes(input.file_id));
      if (smallest) {
        await runInputs([smallest], 'probe');
        candidateSignal.throwIfAborted();
        // Freeze the probe batch so outputs computed during validation are not sent early.
        const probe = submitAnswers(new Map(answers), light, dir, true, candidateSignal, true).then(() => {
          if (state.submissions[`${level}:${smallest.file_id}`]?.status === 'rejected') {
            rejectedEarly.add(answers);
            computationController.abort(new Error('CCC probe rejected'));
          }
        });
        const remaining = runInputs(inputs.filter(input => pending.includes(input.file_id) && !answers.has(input.file_id)), 'remaining');
        // On a transport failure, allow already running computation to finish and save its outputs.
        const results = await Promise.allSettled([probe, remaining]);
        if (rejectedEarly.has(answers)) { await invalidateAnswers(dir); return answers; }
        for (const result of results) if (result.status === 'rejected') {
          if (submissionFailed) submissionController.abort(result.reason);
          throw result.reason;
        }
      }
      candidateSignal.throwIfAborted();
      return answers;
    };
    // Fresh progress has already removed accepted files and guarded uncertain deliveries.
    for (const queued of Object.values(outbox)) {
      if (queued.rejected) continue;
      const remaining = queued.answers.filter(answer => pending.includes(answer.file_id));
      if (!remaining.length) { await discardAnswers(queued.directory); continue; }
      const manifest = path.join(folder, 'outbox-resume.json');
      await atomic(manifest, { answers: remaining });
      const answers = await readAnswers(manifest, folder, remaining.map(answer => answer.file_id));
      emit({ type: 'status', message: `CCC авто: restoring ${answers.size} saved outputs for level ${level}` });
      successfulDirectory = queued.directory;
      await submitAnswers(answers, queued.light, queued.directory, true);
    }
    for (let attempt = 0; attempt < 3 && pending.length; attempt++) {
      signal.throwIfAborted();
      const originalDir = path.join(folder, `run-${runId}-${attempt}-original`);
      successfulDirectory = originalDir;
      await mkdir(originalDir, { recursive: true, mode: 0o700 });
      await prepareSolverTemplate(originalDir, path.join(directory, '.results'));
      const attemptIds = [...pending];
      const answersFile = path.join(originalDir, 'answers.json');
      const taskFile = path.join(folder, `pending-${attempt}.json`);
      await atomic(taskFile, { contest, level, files, inputs: inputs.filter(input => pending.includes(input.file_id)) });
      const prompt = `Solve CCC level ${level}. The script manages all MCP and platform operations. Do not call MCP, browse the platform, submit answers, or read account/configuration secrets. Target solver preparation: about 40 seconds. Use workdir ${originalDir} for local commands and relative filenames for solver.json and solution.cpp; avoid repeating absolute paths in code and command text. The task paths, statement previews, examples and input sample are supplied below; use them directly without rereading the manifest or these files. Batch any additional reads only when the supplied context is incomplete or ambiguous. Extract or render the PDF only if required information is missing. Do not read entire large inputs. If this thread already analyzed this level, continue that analysis and reuse its solver source in the new run directory instead of rediscovering the statement. Reuse the previous level solver only if relevant. Solve directly: no plan, progress narration, repeated summaries, unrelated discovery, benchmark suite, or speculative checks.\nWrite all solver algorithms in C++17 from the first attempt, including corrections and optimization. Do not implement the solver in Python or JavaScript, or wait for a timeout before switching to C++. Write solution.cpp as a standalone program reading one entire input file from stdin and writing its answer to stdout. Compile it in your run directory with g++ -std=c++17 -O2 -pipe solution.cpp -o solution. Use the supplied cpp.cjs helper, which invokes ./solution with direct file I/O and handles the batch manifest, output files and answers.json. Do not reimplement this I/O or read the helper. Check an example using node cpp.cjs --input EXAMPLE_PATH from your run directory. Prefer a compact implementation and the supplied example check; add extra checks only to resolve an actual uncertainty.\nFor tasks requiring computation, create ${path.join(originalDir, 'solver.json')} with JSON {"runtime":"node","script":"cpp.cjs"}. Node is only the supplied batch launcher; all parsing and computation belong in C++. Put the complete solver source and helpers inside ${originalDir}. The supplied cpp.cjs helper receives the task manifest path (${taskFile}) and answer manifest path (${answersFile}) as arguments and writes outputs relative to its working directory; your C++ program only reads stdin and writes stdout. Before returning, run the supplied examples locally and compare against expected outputs when present. Fix any mismatch. Keep checks focused on examples and a few small cases needed to resolve ambiguity; do not run the full scored input batch or build a benchmark suite. The runner executes the full input batch and submits outputs to CCC; use rejection feedback to correct the solver. After 10 seconds of computation the runner prepares a faster candidate in the background while the original continues. The first completed result is used. For trivial answers you may directly write ${answersFile} with JSON {"answers":[{"file_id":"exact ID","path":"output path relative to ${originalDir}"}]} or use "solution" instead of "path" for small text answers. Exactly one answer for each pending ID: ${JSON.stringify(pending)}. Avoid redundant defensive checks and boilerplate already handled by the supplied helper. Put output files inside ${originalDir}. Finish with only "Solver ready."; the runner reports execution and submission results.\nTask context: ${JSON.stringify({ ...context, inputs: context.inputs.filter(input => pending.includes(input.file_id)) })}\nUser request: ${(job.originalPrompt || job.prompt).split('Current user request:\n').at(-1)}\nEvaluation feedback: ${JSON.stringify(feedback ?? null)}\nPrevious level: ${JSON.stringify(previousLevelContext ?? null)}`;
      const executeWithOptimization = (dir: string, candidateSignal: AbortSignal, reasoning = 'medium', threadId?: string) => withOptimization(
        async s => ({ answers: await executeStaged(dir, s, reasoning === 'low', attemptIds), directory: dir, threadId }),
        async s => {
          const optimizedDir = dir + '-optimized';
          await mkdir(optimizedDir, { recursive: true, mode: 0o700 });
          await prepareSolverTemplate(optimizedDir, path.join(directory, '.results'));
          const source = await solverSource(dir);
          let optimizedThreadId = threadId;
          const checkpoint = (value: string) => {
            optimizedThreadId = value;
            state.candidateThreads ??= {};
            state.candidateThreads[`${reasoning}-optimized`] = { accountId: job.accountId, threadId: value };
          };
          const optimizationTaskId = `${job.taskId}-ccc-${level}-${attempt}-${path.basename(dir)}-optimize`;
          const fullOptimization = async () => {
            await askSolver(prompt.replaceAll(originalDir, optimizedDir) +
              `\nThe original solver is still computing in ${dir}. Improve its algorithm for faster execution. Work in ${optimizedDir}. Original source: ${JSON.stringify(source)}. Return a complete faster recipe or direct answers.`,
              optimizationTaskId + '-agent', s, false, false,
              { reasoning: reasoning === 'low' ? 'medium' : reasoning, previousThreadId: optimizedThreadId, onCheckpoint: checkpoint });
          };
          if (fastEligible) {
            const response = await askSolver(codePrompt(level, { ...context, source, evaluationFeedback: feedback,
              instruction: 'The original computation is still running. Improve its algorithm for faster execution. Return complete optimized C++17 source.' }),
              optimizationTaskId, s, false, true,
              { reasoning, previousThreadId: optimizedThreadId, onCheckpoint: checkpoint });
            if (!JSON.parse(response).source?.trim()) await fullOptimization();
            else await prepareFastCode(response, optimizedDir, files, s, path.join(directory, '.compiled'));
          } else await fullOptimization();
          const answers = await executeStaged(optimizedDir, s, reasoning === 'low', attemptIds);
          if (rejectedEarly.has(answers)) throw new Error('CCC optimized candidate rejected by platform');
          return { answers, directory: optimizedDir, threadId: optimizedThreadId };
        }, AbortSignal.any([candidateSignal, submissionController.signal]),
        () => emit({ type: 'status', message: `CCC авто: computation running for ${optimizationDelayMs / 1000}s; preparing faster solution in background` }),
      );
      emit({ type: 'status', message: `CCC авто: solving level ${level}${attempt ? ' (correcting rejected answers)' : ''}` });
      const solvingStartedAt = Date.now();
      let fastAnswers: Map<string, Buffer> | undefined;
      let lightWinner = false;
      let candidateLabel = '6.1 Sol / medium / Fast';
      const fastEligible = level <= fastLevelLimit()
        && context.files.some(file => file.pdf_preview) && !context.files.some(file => file.truncated);
      if (fastEligible) {
        emit({ type: 'status', message: `CCC авто: level ${level} — generating C++ directly (low / Fast)` });
        try {
          const directCandidate = (reasoning: string, label = reasoning, previousThreadId?: string) => async (candidateSignal: AbortSignal) => {
            const candidateDir = path.join(folder, `run-${runId}-${attempt}-${label}`);
            await mkdir(candidateDir, { recursive: true, mode: 0o700 });
            await prepareSolverTemplate(candidateDir, path.join(directory, '.results'));
            candidateSignal.throwIfAborted();
            const savedThread = state.candidateThreads?.[label];
            let threadId = previousThreadId ?? (savedThread?.accountId === job.accountId ? savedThread.threadId : undefined);
            for (let revision = 0; ; revision++) {
              const version = feedbackVersion;
              const lightSource = await solverSource(originalDir);
              const response = await askSolver(codePrompt(level, { ...context, evaluationFeedback: feedback ?? null,
                previousLevel: previousLevelContext, currentLightSource: lightSource,
                userRequest: (job.originalPrompt || job.prompt).split('Current user request:\n').at(-1) }),
                `${job.taskId}-ccc-${level}-${attempt}-${label}-code-${revision}`, candidateSignal, false, true,
                { reasoning, previousThreadId: threadId, onCheckpoint: value => { threadId = value; state.candidateThreads ??= {}; state.candidateThreads[label] = { accountId: job.accountId, threadId: value }; } });
              candidateSignal.throwIfAborted();
              await save();
              if (version !== feedbackVersion && revision < 2) continue;
              const generated = JSON.parse(response);
              if (!generated.source?.trim()) {
                // Missing diagrams or attachments require tools in a separate full-agent thread.
                await askSolver(prompt.replaceAll(originalDir, candidateDir) + `\nPreparation feedback: ${JSON.stringify(feedback ?? null)}`,
                  `${job.taskId}-ccc-${level}-${attempt}-${label}-agent`, candidateSignal, false, false,
                  { reasoning, previousThreadId: threadId, onCheckpoint: value => { threadId = value; state.candidateThreads ??= {}; state.candidateThreads[label] = { accountId: job.accountId, threadId: value }; } });
              } else {
                await timed('compile_examples', () => prepareFastCode(response, candidateDir, files, candidateSignal, path.join(directory, '.compiled')), { level, candidate: label });
              }
              break;
            }
            candidateSignal.throwIfAborted();
            const result = await executeWithOptimization(candidateDir, candidateSignal, reasoning, threadId);
            const answers = result.answers;
            return { answers, directory: result.directory, reasoning, threadId: result.threadId };
          };
          const retained = winnerAgent;
          const background = retained ? directCandidate(retained.reasoning, 'retained', retained.threadId) : directCandidate('medium', 'background');
          const immediateMedium = (options.mediumHeadStartMs ?? 0) === 0;
          const needsBackground = immediateMedium || Boolean(retained) || (state.fastFailed && state.fastFailedLevel === level) || attempt > 0;
          const delayedReasonings = (immediateMedium ? ['high'] : ['medium', 'high']).filter(reasoning => reasoning !== retained?.reasoning);
          if (retained) emit({ type: 'status', message: `CCC авто: level ${level} — continuing previous winner ${retained.reasoning} alongside light in its existing thread` });
          if (needsBackground) emit({ type: 'status', message: `CCC авто: level ${level} — starting background candidate alongside light` });
          let lightGeneration = attempt;
          const runLight = async (candidateSignal: AbortSignal) => {
            for (let repair = 0; ; repair++) {
              const version = feedbackVersion;
              const source = await askSolver(codePrompt(level, { ...context, evaluationFeedback: feedback ?? null, previousLevel: previousLevelContext, userRequest: (job.originalPrompt || job.prompt).split('Current user request:\n').at(-1) }), `${job.taskId}-ccc-code-${level}-${lightGeneration++}`, candidateSignal, false, true, {
                previousThreadId: lightThreadId,
                onCheckpoint: threadId => { lightThreadId = threadId; state.lightThread = { accountId: job.accountId, threadId }; },
              });
              candidateSignal.throwIfAborted();
              await save();
              if (version !== feedbackVersion && repair < 2) continue;
              try {
                await timed('compile_examples', () => prepareFastCode(source, originalDir, files, candidateSignal, path.join(directory, '.compiled')), { level });
              } catch (error) {
                candidateSignal.throwIfAborted();
                if (!JSON.parse(source).source?.trim() || repair >= 2) throw error;
                feedback = { ...(typeof feedback === 'object' && feedback ? feedback : {}), preparationError: String(error).slice(-16000), source: await solverSource(originalDir) };
                state.fastFailed = true;
                state.fastFailedLevel = level;
                state.fastFeedback = feedback;
                await save();
                emit({ type: 'status', message: `CCC авто: level ${level} — repairing light in its existing thread` });
                continue;
              }
              const result = await executeWithOptimization(originalDir, candidateSignal, 'low', lightThreadId);
              const answers = result.answers;
              if (result.threadId) { lightThreadId = result.threadId; state.lightThread = { accountId: job.accountId, threadId: result.threadId }; await save(); }
              if (!rejectedEarly.has(answers) && version !== feedbackVersion && repair < 2) continue;
              return { answers, directory: result.directory, reasoning: 'low', threadId: undefined as string | undefined };
            }
          };
          const winner = await raceLight(runLight, delayedReasonings.map(reasoning => directCandidate(reasoning)), AbortSignal.any([signal, submissionController.signal]),
            () => emit({ type: 'status', message: `CCC авто: level ${level} — adding 6.1 Sol ${delayedReasonings.join(' and ')} / Fast after ${(options.mediumHeadStartMs || 20_000) / 1000}s` }), options.mediumHeadStartMs || undefined, {
              onCleanup: (elapsedMs, drained) => reportTiming('cancellation', elapsedMs, { level, drained }),
              background: needsBackground ? background : undefined,
              immediate: immediateMedium && retained && retained.reasoning !== 'medium' ? [directCandidate('medium')] : undefined,
              rejectedLightBackground: background,
              lightRetries: 2,
              accept: async candidate => {
                try { return await submitAnswers(candidate.answers, candidate.reasoning === 'low', candidate.directory, true); }
                catch (error) { submissionFailed = true; throw error; }
              },
              recoverLight: async (error, candidateSignal) => {
                if (submissionFailed || ['rate_limit', 'auth', 'unavailable'].includes((error as { code?: string })?.code || '')) throw error;
                state.fastFailed = true;
                state.fastFailedLevel = level;
                feedback = { fastPreparationError: String(error).slice(-8000), sourceDirectory: originalDir };
                state.fastFeedback = feedback;
                await save();
                emit({ type: 'status', message: `CCC авто: level ${level} — light preparation failed; starting background candidate, keeping delayed ${delayedReasonings.join('/')}` });
                return background(candidateSignal);
              },
            });
          fastAnswers = winner.answers;
          successfulDirectory = winner.directory;
          lightWinner = winner.reasoning === 'low';
          candidateLabel = lightWinner ? 'direct C++ / low / Fast' : `6.1 Sol / ${winner.reasoning} / Fast`;
          winnerAgent = !lightWinner && winner.threadId ? { accountId: job.accountId, threadId: winner.threadId, reasoning: winner.reasoning } : undefined;
          state.winnerAgent = winnerAgent;
          if (winner.threadId) {
            solverThreadId = winner.threadId;
            regularSolverTaskId = `${job.taskId}-ccc-${level}-${winner.reasoning}`;
            state.solverThread = { accountId: job.accountId, threadId: winner.threadId };
            await save();
          }
        } catch (error) {
          signal.throwIfAborted();
          if (submissionFailed) throw error;
          if (['rate_limit', 'auth', 'unavailable'].includes((error as {code?: string}).code || '')) throw error;
          state.fastFailed = true;
          state.fastFailedLevel = level;
          await save();
          feedback = { fastPreparationError: String(error).slice(-8000), sourceDirectory: originalDir };
          // Do not let a partially prepared recipe or manifest survive fallback.
          await rm(path.join(originalDir, 'solver.json'), { force: true });
          await rm(answersFile, { force: true });
          emit({ type: 'status', message: `CCC авто: level ${level} — preparation failed; using agent for this level` });
        }
      }
      if (!fastAnswers) {
        await askSolver(prompt + `\nPreparation feedback: ${JSON.stringify(feedback ?? null)}`, regularSolverTaskId, signal, true);
      }
      emit({ type: 'status', message: `CCC авто: level ${level} solver prepared in ${Math.round((Date.now() - solvingStartedAt) / 1000)}s (${candidateLabel})` });
      let answers = fastAnswers;
      if (!answers) {
        emit({ type: 'tool', message: `CCC авто: running original solver for level ${level}` });
        const result = await executeWithOptimization(originalDir, signal, 'medium', solverThreadId);
        answers = result.answers;
        successfulDirectory = result.directory;
        if (result.threadId) {
          solverThreadId = result.threadId;
          state.solverThread = { accountId: job.accountId, threadId: result.threadId };
          await save();
        }
      }
      if (!fastAnswers && await submitAnswers(answers, lightWinner, successfulDirectory!)) {
        winnerAgent = solverThreadId ? { accountId: job.accountId, threadId: solverThreadId, reasoning: 'medium' } : undefined;
        state.winnerAgent = winnerAgent;
      }
    }
    if (pending.length) throw new Error(`CCC level ${level}: ${pending.join(', ')} still rejected after three solution attempts. Outputs and evaluations are saved in ${folder}`);
    const verified = await timed('progress', () => client.call('game_info', { contest }), { level });
    if (ids.some(id => !unscored.has(id) && !passed(verified, level, id))) throw new Error(`CCC level ${level}: accepted responses received, but platform progress is not confirmed. Check the site before continuing.`);
    info = verified;
    delete state.fastFailed;
    delete state.fastFailedLevel;
    delete state.fastFeedback;
    await save();
    const source = successfulDirectory ? await solverSource(successfulDirectory) : undefined;
    previousLevelContext = { level, ...context, source };
  }
  await reportTiming('total', Date.now() - startedAt);
  const text = `CCC авто: completed ${info.game?.name || contest}. Accepted ${accepted} new outputs; all scored inputs are confirmed in platform progress. Files: ${directory}`;
  emit({ type: 'delta', text });
  return text;
}
