import type { CccGcpSettings } from './ccc-settings.js';
import { cccGcloudBinary, cccGcloudEnv } from './ccc-gcp-auth.js';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { waitForGcpReady, GcpCommandError, gcpReadinessCommand } from './ccc-gcp-ready.js';
import { copyFile, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { prepareSolverTemplate } from './ccc-solver-template.js';

// Only generated solver sources and selected inputs leave the runner. Never
// upload a candidate directory: it may contain unrelated files or credentials.
export async function runGcpRecipe(directory: string, taskFile: string, answersFile: string, signal: AbortSignal, settings?: CccGcpSettings) {
  signal.throwIfAborted();
  const project = settings?.project ?? process.env.CCC_GCP_PROJECT;
  const zone = settings?.zone ?? process.env.CCC_GCP_ZONE;
  const instance = settings?.instance ?? process.env.CCC_GCP_INSTANCE;
  if (!project || !/^[a-z][a-z0-9-]{4,61}[a-z0-9]$/.test(project) ||
      !zone || !/^[a-z]+-[a-z0-9]+[0-9]-[a-z]$/.test(zone) ||
      !instance || !/^[a-z][a-z0-9-]{0,61}[a-z0-9]$/.test(instance)) {
    throw new Error('Set CCC_GCP_PROJECT, CCC_GCP_ZONE and CCC_GCP_INSTANCE for Google Cloud execution');
  }
  const recipe = JSON.parse(await readFile(path.join(directory, 'solver.json'), 'utf8'));
  if (recipe.runtime !== 'node' || !['cpp.cjs', 'python.cjs'].includes(recipe.script)) {
    throw new Error('Google Cloud execution requires the supplied cpp.cjs or python.cjs recipe');
  }
  const workers = Number(settings?.workers ?? (process.env.CCC_GCP_WORKERS || 8));
  const seconds = Number(settings?.timeoutSeconds ?? (process.env.CCC_GCP_TIMEOUT_SECONDS || 120));
  if (!Number.isInteger(workers) || workers < 1 || workers > 64 || !Number.isInteger(seconds) || seconds < 1 || seconds > 3600) {
    throw new Error('CCC_GCP_WORKERS must be 1–64; CCC_GCP_TIMEOUT_SECONDS must be 1–3600');
  }
  const flags = [`--project=${project}`, `--zone=${zone}`, '--quiet'];
  if ((settings ? settings.useIap : process.env.CCC_GCP_USE_IAP === 'true')) flags.push('--tunnel-through-iap');
  const command = async (args: string[], abortSignal: AbortSignal) => {
    abortSignal.throwIfAborted();
    await new Promise<void>((resolve, reject) => {
      let log = '';
      const child = spawn(cccGcloudBinary(), [...args, ...flags], { env: settings ? cccGcloudEnv() : process.env, signal: abortSignal, stdio: ['ignore', 'pipe', 'pipe'] });
      const append = (chunk: Buffer) => { log = (log + chunk.toString()).slice(-16000); };
      child.stdout.on('data', append); child.stderr.on('data', append);
      child.on('error', reject);
      child.on('close', code => code === 0 ? resolve() : reject(new GcpCommandError(code, log)));
    });
  };
  const remote = `/tmp/ai-router-ccc-${randomUUID()}`;
  const staging = await mkdtemp(path.join(tmpdir(), 'ccc-gcp-'));
  const payload = path.join(staging, 'payload');
  const result = path.join(payload, 'results');
  let remoteCreated = false;
  try {
    await mkdir(result, { recursive: true, mode: 0o700 });
    const task = JSON.parse(await readFile(taskFile, 'utf8'));
    const inputs = [];
    for (const [index, input] of task.inputs.entries()) {
      signal.throwIfAborted();
      await copyFile(input.path, path.join(payload, `input-${index}`));
      inputs.push({ file_id: input.file_id, path: `../input-${index}` });
    }
    const source = recipe.script === 'cpp.cjs' ? 'solution.cpp' : 'solution.py';
    const sourcePath = await realpath(path.join(directory, source));
    if (!sourcePath.startsWith(await realpath(directory) + path.sep)) throw new Error('CCC source must stay inside its candidate folder');
    await copyFile(sourcePath, path.join(result, source));
    await prepareSolverTemplate(result, '.results');
    await writeFile(path.join(result, 'task.json'), JSON.stringify({ inputs }));
    // A remote hard timeout also bounds computation if the runner loses its
    // network connection. Each batch has an independent process group.
    const solve = `${recipe.script === 'cpp.cjs' ? 'g++ -std=c++17 -O2 -pipe -pthread solution.cpp -o solution && ' : ''}CCC_CPP_WORKERS=${workers} CCC_CPP_MEMORY_BYTES=536870912 node ${recipe.script} task.json answers.json`;
    await waitForGcpReady(readySignal => command(['compute', 'ssh', instance,
      `--command=${gcpReadinessCommand}`,
    ], readySignal), signal);
    await command(['compute', 'ssh', instance, `--command=umask 077; mkdir ${remote}`], signal);
    remoteCreated = true;
    await command(['compute', 'scp', '--recurse', payload, `${instance}:${remote}/`], signal);
    await command(['compute', 'ssh', instance, `--command=cd ${remote}/payload/results || exit 1; setsid timeout --kill-after=5s ${seconds}s sh -c '${solve}' >execution.log 2>&1 & pid=$!; echo $pid > ${remote}/pid; wait $pid; status=$?; cat execution.log; rm -rf .results solution solution.cpp solution.py cpp.cjs python.cjs batch.cjs task.json; exit $status`], signal);
    await command(['compute', 'scp', '--recurse', `${instance}:${remote}/payload/results`, path.join(staging, 'download')], signal);
    signal.throwIfAborted();
    const download = path.join(staging, 'download');
    const manifest = JSON.parse(await readFile(path.join(download, 'answers.json'), 'utf8'));
    if (!Array.isArray(manifest.answers) || manifest.answers.length !== inputs.length ||
        new Set(manifest.answers.map((answer: { file_id: string }) => answer.file_id)).size !== inputs.length) throw new Error('Invalid Google Cloud answer manifest');
    const answers = [];
    for (const [index, answer] of manifest.answers.entries()) {
      if (!inputs.some(input => input.file_id === answer.file_id) || typeof answer.path !== 'string') throw new Error('Unexpected Google Cloud answer');
      const output = await realpath(path.resolve(download, answer.path));
      if (!output.startsWith(await realpath(download) + path.sep)) throw new Error('Google Cloud answer escaped its result directory');
      const localName = `gcp-${path.basename(remote)}-${index}.txt`;
      await copyFile(output, path.join(directory, localName));
      answers.push({ file_id: answer.file_id, path: localName });
    }
    await copyFile(path.join(download, 'execution.log'), path.join(directory, 'execution.log'));
    await writeFile(answersFile, JSON.stringify({ answers }), { mode: 0o600 });
  } finally {
    if (remoteCreated) {
      // Independent from the canceled candidate signal; cancel the remote
      // process group before deleting its inputs and outputs.
      await command(['compute', 'ssh', instance, `--command=if test -f ${remote}/pid; then /bin/kill -KILL -- -$(cat ${remote}/pid) 2>/dev/null || true; fi; rm -rf ${remote}`], AbortSignal.timeout(15_000)).catch(error => {
        console.warn(`CCC Google Cloud cleanup failed for ${remote}: ${String(error)}`);
      });
    }
    await rm(staging, { recursive: true, force: true });
  }
}
