import { prepareSolverTemplate } from './ccc-solver-template.js';
import { runRecipe, withOptimization, withExecutionLimit, executionLimitMs } from './ccc-execution.js';
import { createHash } from 'node:crypto';
import { appendFile, mkdir, open, readFile, realpath, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import type { CccClient } from './ccc-client.js';
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
type Submission = { status: 'submitting' | 'accepted' | 'rejected'; evaluation?: unknown; deliveryJobId?: number };
type State = { contest: string; submissions: Record<string, Submission>; nextSubmitAt?: number; solverThread?: { accountId: string; threadId: string } };
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

export async function runCccAuto(job: Job, cwd: string, client: CccClient, solve: Solver, signal: AbortSignal, emit: (event: Event) => void): Promise<string> {
  const reference = contestReference(job.originalPrompt || job.prompt);
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
  const save = () => atomic(stateFile, state);
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
  const runId = createHash('sha256').update(job.taskId).digest('hex').slice(0, 16);
  let solverThreadId = state.solverThread?.accountId === job.accountId ? state.solverThread.threadId : undefined;
  async function askSolver(solverPrompt: string, solverTaskId: string, solverSignal: AbortSignal, reuseThread = false) {
    let latestUsage: Record<string, number> = {};
    let checkpoint: string | undefined;
    const solverStartedAt = Date.now();
    let firstToolMs: number | undefined;
    let lastToolMs: number | undefined;
    let toolCount = 0;
    try {
      await timed('solver', () => solve({ ...job, workflow: 'standard', solverOnly: true, previousThreadId: reuseThread ? solverThreadId : undefined, taskId: solverTaskId, prompt: solverPrompt, model: 'gpt-6.1-sol', reasoning: 'medium', fast: true }, solverSignal, event => {
        // The workflow reports progress; internal solver narration is not a chat reply.
        if (event.type === 'tool') {
          lastToolMs = Date.now() - solverStartedAt;
          firstToolMs ??= lastToolMs;
          toolCount++;
        }
        if (event.type === 'checkpoint') {
          if (typeof event.data?.threadId === 'string') checkpoint = event.data.threadId;
          return;
        }
        if (event.type === 'delta') return;
        if (event.type === 'usage' && event.data && !event.data.limits) {
          for (const [field, snake] of [['inputTokens', 'input_tokens'], ['outputTokens', 'output_tokens'], ['cachedInputTokens', 'cached_input_tokens'], ['reasoningOutputTokens', 'reasoning_output_tokens'], ['totalTokens', 'total_tokens']]) {
            const value = event.data[field] ?? event.data[snake];
            if (typeof value === 'number' && Number.isSafeInteger(value)) latestUsage[field] = value;
          }
          latestUsage.totalTokens ??= (latestUsage.inputTokens || 0) + (latestUsage.outputTokens || 0);
          emit({ ...event, data: Object.fromEntries(Object.keys(latestUsage).map(field => [field, (completedUsage[field] || 0) + latestUsage[field]])) });
        } else emit(event.type === 'status' && event.data?.steeringAvailable ? { ...event, data: { ...event.data, steeringAvailable: false } } : event);
      }), { solverTaskId, reusedThread: Boolean(reuseThread && solverThreadId) });
    } finally {
      if (firstToolMs !== undefined) await reportTiming('solver_first_tool', firstToolMs, { solverTaskId, toolCount, lastToolMs });
      if (reuseThread && checkpoint) {
        solverThreadId = checkpoint;
        state.solverThread = { accountId: job.accountId, threadId: checkpoint };
        await save();
      }
      for (const [field, value] of Object.entries(latestUsage)) completedUsage[field] = (completedUsage[field] || 0) + value;
    }
  }
  let accepted = 0;
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
      if (previous?.status === 'submitting' || previous?.status === 'accepted') throw new Error(`CCC level ${level}, ${id}: previous submission is unresolved. Check platform progress before continuing; it will not be sent twice.`);
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
    const manifest = path.join(folder, 'task.json');
    await atomic(manifest, { contest, level, level_info: prepared.level_info, files, inputs });
    await reportTiming('download', Date.now() - downloadStartedAt, { level });
    const context = await timed('solver_context', () => solverContext(files, inputs), { level });
    let feedback: unknown = undefined;
    for (let attempt = 0; attempt < 3 && pending.length; attempt++) {
      signal.throwIfAborted();
      const originalDir = path.join(folder, `run-${runId}-${attempt}-original`);
      await mkdir(originalDir, { recursive: true, mode: 0o700 });
      await prepareSolverTemplate(originalDir);
      const answersFile = path.join(originalDir, 'answers.json');
      const taskFile = path.join(folder, `pending-${attempt}.json`);
      await atomic(taskFile, { contest, level, files, inputs: inputs.filter(input => pending.includes(input.file_id)) });
      const prompt = `Solve CCC level ${level}. The script manages all MCP and platform operations. Do not call MCP, browse the platform, submit answers, or read account/configuration secrets. Target solver preparation: about 40 seconds. Use workdir ${originalDir} for local commands and relative filenames for solver.json and solution.cpp; avoid repeating absolute paths in code and command text. The task paths, statement previews, examples and input sample are supplied below; use them directly without rereading the manifest or these files. Batch any additional reads only when the supplied context is incomplete or ambiguous. Extract or render the PDF only if required information is missing. Do not read entire large inputs. If this thread already analyzed this level, continue that analysis and reuse its solver source in the new run directory instead of rediscovering the statement. Reuse the previous level solver only if relevant. Solve directly: no plan, progress narration, repeated summaries, unrelated discovery, benchmark suite, or speculative checks.\nWrite all solver algorithms in C++17 from the first attempt, including corrections and optimization. Do not implement the solver in Python or JavaScript, or wait for a timeout before switching to C++. Write solution.cpp as a standalone program reading one entire input file from stdin and writing its answer to stdout. Compile it in your run directory with g++ -std=c++17 -O2 -pipe solution.cpp -o solution. Use the supplied cpp.cjs helper, which invokes ./solution with direct file I/O and handles the batch manifest, output files and answers.json. Do not reimplement this I/O or read the helper. Check an example using node cpp.cjs --input EXAMPLE_PATH from your run directory. Prefer a compact implementation and the supplied example check; add extra checks only to resolve an actual uncertainty.\nFor tasks requiring computation, create ${path.join(originalDir, 'solver.json')} with JSON {"runtime":"node","script":"cpp.cjs"}. Node is only the supplied batch launcher; all parsing and computation belong in C++. Put the complete solver source and helpers inside ${originalDir}. The supplied cpp.cjs helper receives the task manifest path (${taskFile}) and answer manifest path (${answersFile}) as arguments and writes outputs relative to its working directory; your C++ program only reads stdin and writes stdout. Before returning, run the supplied examples locally and compare against expected outputs when present. Fix any mismatch. Keep checks focused on examples and a few small cases needed to resolve ambiguity; do not run the full scored input batch or build a benchmark suite. The runner executes the full input batch and submits outputs to CCC; use rejection feedback to correct the solver. Computation has a 120-second execution limit; only after that limit will the runner stop it and request one optimized candidate. For trivial answers you may directly write ${answersFile} with JSON {"answers":[{"file_id":"exact ID","path":"output path relative to ${originalDir}"}]} or use "solution" instead of "path" for small text answers. Exactly one answer for each pending ID: ${JSON.stringify(pending)}. Avoid redundant defensive checks and boilerplate already handled by the supplied helper. Put output files inside ${originalDir}. Finish with only "Solver ready."; the runner reports execution and submission results.\nTask context: ${JSON.stringify({ ...context, inputs: context.inputs.filter(input => pending.includes(input.file_id)) })}\nUser request: ${(job.originalPrompt || job.prompt).split('Current user request:\n').at(-1)}\nEvaluation feedback: ${JSON.stringify(feedback ?? null)}`;
      emit({ type: 'status', message: `CCC авто: solving level ${level}${attempt ? ' (correcting rejected answers)' : ''}` });
      const solvingStartedAt = Date.now();
      await askSolver(prompt, `${job.taskId}-ccc-solver`, signal, true);
      emit({ type: 'status', message: `CCC авто: level ${level} solver prepared in ${Math.round((Date.now() - solvingStartedAt) / 1000)}s (6.1 Sol / medium / Fast)` });
      // Load submission files and check their envelope; CCC production evaluates correctness.
      const hasRecipe = async (dir: string) => {
        try { await readFile(path.join(dir, 'solver.json')); return true; }
        catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false; throw error; }
      };
      const executeCandidate = async (dir: string, candidateSignal: AbortSignal) => {
        const output = path.join(dir, 'answers.json');
        if (await hasRecipe(dir)) {
          emit({ type: 'tool', message: `CCC авто: running ${dir === originalDir ? 'original' : 'optimized'} solver for level ${level}` });
          await timed('execution', () => runRecipe(dir, taskFile, output, candidateSignal), { level, attempt, candidate: dir === originalDir ? 'original' : 'optimized' });
        }
        candidateSignal.throwIfAborted();
        return timed('answer_validation', () => readAnswers(output, dir, pending), { level, attempt });
      };
      const answers = await hasRecipe(originalDir)
        ? await withOptimization(
          candidateSignal => executeCandidate(originalDir, candidateSignal),
          async candidateSignal => {
            const optimizedDir = path.join(folder, `run-${runId}-${attempt}-optimized`);
            await mkdir(optimizedDir, { recursive: true, mode: 0o700 });
            await prepareSolverTemplate(optimizedDir);
            const optimizationPrompt = prompt.replaceAll(originalDir, optimizedDir) + `\nThe original solver in ${originalDir} exceeded its ${executionLimitMs / 1000}-second execution limit and has been stopped. Inspect its source and improve the algorithm, data structures or implementation for faster execution. Work only in ${optimizedDir}; leave the original source, inputs and outputs untouched. Return a complete faster solver recipe (or direct answers) for the same pending IDs. Check supplied examples, then return. The runner will execute your candidate with the same execution limit and validate its answer manifest.`;
            await askSolver(optimizationPrompt, `${job.taskId}-ccc-solver`, candidateSignal, true);
            return withExecutionLimit(executionSignal => executeCandidate(optimizedDir, executionSignal), candidateSignal);
          }, signal,
          () => emit({ type: 'status', message: `CCC авто: computation exceeded ${executionLimitMs / 1000} seconds; stopped solver, preparing one faster candidate` }),
        ) : await timed('answer_validation', () => readAnswers(answersFile, originalDir, pending), { level, attempt });
      const rejected: string[] = []; const evaluations: Record<string, unknown> = {};
      for (const id of pending) {
        if ((state.nextSubmitAt || 0) > Date.now()) {
          emit({ type: 'status', message: 'CCC авто: waiting for submission cooldown' });
          await timed('cooldown', () => delay(Math.max(0, state.nextSubmitAt! - Date.now()), undefined, { signal }), { level, fileId: id });
        }
        signal.throwIfAborted();
        const content = answers.get(id)!;
        let submission: Record<string, unknown> = { contest, level, file_id: id, filename: `level-${level}-output.txt`, include_case_details: true };
        if (content.length <= 256 * 1024) submission.solution = content.toString('utf8');
        else {
          const uploaded = await timed('upload', () => client.call('upload_artifact', { filename: submission.filename, data_base64: content.toString('base64') }), { level, fileId: id });
          const artifactId = uploaded.artifact_id || uploaded.artifact?.artifact_id;
          if (!artifactId) throw new Error('CCC output upload returned no artifact ID');
          submission.artifact_id = artifactId;
        }
        // Persist before dispatch. Lost responses remain uncertain even after cancellation/restart.
        state.submissions[`${level}:${id}`] = { status: 'submitting' }; await save();
        emit({ type: 'tool', message: `CCC авто: submitting level ${level}, ${id}` });
        let result: any;
        try { result = await timed('submission', () => client.call('submit_solution', submission), { level, fileId: id }); }
        catch (error) {
          signal.throwIfAborted();
          emit({ type: 'status', message: 'CCC авто: submission response lost; checking platform progress before continuing' });
          const progress = await timed('progress', () => client.call('game_info', { contest }), { level });
          if (!passed(progress, level, id)) throw error;
          // Platform confirms delivery; do not dispatch this submission again.
          result = { evaluation: { isCorrect: true, recoveredFromProgress: true }, cooldownSec: 60 };
        }
        const correct = result.evaluation?.isCorrect;
        if (typeof correct !== 'boolean') throw new Error('CCC submission has no definitive evaluation; check platform progress before continuing');
        const cooldown = Number(result.cooldownSec ?? 0);
        if (!Number.isFinite(cooldown) || cooldown < 0 || cooldown > 86400) throw new Error('CCC returned an invalid cooldown; check platform progress before continuing');
        state.nextSubmitAt = Date.now() + cooldown * 1000;
        state.submissions[`${level}:${id}`] = { status: correct ? 'accepted' : 'rejected', evaluation: result.evaluation, deliveryJobId: result.delivery_job_id };
        await save();
        emit({ type: 'status', message: `CCC авто: level ${level}, ${id} — ${correct ? 'accepted' : 'rejected'}` });
        if (correct) accepted++;
        else { rejected.push(id); evaluations[id] = result.evaluation; }
      }
      pending = rejected; feedback = evaluations;
    }
    if (pending.length) throw new Error(`CCC level ${level}: ${pending.join(', ')} still rejected after three solution attempts. Outputs and evaluations are saved in ${folder}`);
    const verified = await timed('progress', () => client.call('game_info', { contest }), { level });
    if (ids.some(id => !unscored.has(id) && !passed(verified, level, id))) throw new Error(`CCC level ${level}: accepted responses received, but platform progress is not confirmed. Check the site before continuing.`);
    info = verified;
  }
  await reportTiming('total', Date.now() - startedAt);
  const text = `CCC авто: completed ${info.game?.name || contest}. Accepted ${accepted} new outputs; all scored inputs are confirmed in platform progress. Files: ${directory}`;
  emit({ type: 'delta', text });
  return text;
}
