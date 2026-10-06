import { codeContext } from './ccc-context.js';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { copyFile, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { runRecipe, withExecutionLimit } from './ccc-execution.js';

export const codeOutputSchema = {
  type: 'object', properties: {
    source: { type: 'string' },
    outputMode: { type: 'string', enum: ['exact', 'constructive'] },
  }, required: ['source', 'outputMode'], additionalProperties: false,
};

export function fastLevelLimit(): number {
  const value = Number(process.env.CCC_AUTO_FAST_LEVELS ?? Infinity);
  return Number.isSafeInteger(value) && value >= 0 && value <= 100 ? value : Infinity;
}

export function codePrompt(level: number, context: unknown, language: 'cpp' | 'python' = 'cpp'): string {
  return `Solve CCC level ${level} immediately using only the supplied statement and examples. Return JSON {"source":"complete ${language === 'python' ? 'Python 3' : 'C++17'} source","outputMode":"exact"}. Set outputMode to "constructive" only when the statement allows multiple valid answers, such as layouts, paths or schedules; otherwise use "exact". No tools, file operations, plan or explanation. Keep the source compact; omit commentary and boilerplate. A sameAs field refers to identical source already supplied in this context. Use only the standard library. The runner prepares and runs examples and executes the scored inputs. Exact outputs are compared with example text; constructive outputs are evaluated by the platform because a different valid solution can differ from the example. Write a standalone program reading one input from stdin and writing the answer to stdout. Use a compact algorithm suitable for the input sizes. Reuse the supplied previous level source when its algorithm remains relevant, adapting it to the new constraints. If the context is insufficient (including required diagrams), return an empty source so a full agent can inspect the files.\nTask context: ${codeContext(context)}`;
}

async function compileUncached(directory: string, signal: AbortSignal) {
  await withExecutionLimit(async compileSignal => {
    compileSignal.throwIfAborted();
    await new Promise<void>((resolve, reject) => {
      const child = spawn('g++', ['-std=c++17', '-O2', '-pipe', 'solution.cpp', '-o', 'solution'], {
        cwd: directory, detached: true, stdio: ['ignore', 'ignore', 'pipe'],
        env: { PATH: process.env.PATH, LANG: 'C.UTF-8' },
      });
      let log = '';
      child.stderr.on('data', chunk => { log = (log + chunk.toString()).slice(-8000); });
      const stop = () => { if (child.pid) { try { process.kill(-child.pid, 'SIGKILL'); } catch {} } };
      compileSignal.addEventListener('abort', stop, { once: true });
      if (compileSignal.aborted) stop();
      const cleanup = () => compileSignal.removeEventListener('abort', stop);
      child.on('error', error => { cleanup(); reject(error); });
      child.on('close', code => {
        cleanup();
        if (compileSignal.aborted) reject(compileSignal.reason);
        else if (code !== 0) reject(new Error(`Fast C++ compilation failed: ${log}`));
        else resolve();
      });
    });
  }, signal, 30_000);
}

// Scope native artifacts to the contest and invalidate when compiler or flags change.
let compilerVersion: Promise<string> | undefined;
function compilerIdentity() {
  return compilerVersion ??= new Promise<string>((resolve, reject) => {
    const child = spawn('g++', ['--version'], { stdio: ['ignore', 'pipe', 'pipe'] });
    let version = '';
    child.stdout.on('data', chunk => { version += chunk; });
    child.on('error', reject);
    child.on('close', code => code === 0 ? resolve(version) : reject(new Error('Unable to identify C++ compiler')));
  });
}
async function compile(directory: string, signal: AbortSignal, cache: string) {
  const identity = await compilerIdentity();
  signal.throwIfAborted();
  const source = await readFile(path.join(directory, 'solution.cpp'));
  const key = createHash('sha256').update(source).update(identity).update(process.platform + process.arch + '-std=c++17 -O2 -pipe').digest('hex');
  await mkdir(cache, { recursive: true, mode: 0o700 });
  const binary = path.join(cache, key);
  try { await copyFile(binary, path.join(directory, 'solution')); return; }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  await compileUncached(directory, signal);
  signal.throwIfAborted();
  const temporary = binary + '.' + createHash('sha256').update(directory).digest('hex').slice(0, 16) + '.tmp';
  await copyFile(path.join(directory, 'solution'), temporary);
  await rename(temporary, binary);
}

export async function prepareFastCode(response: string, directory: string,
  files: { name: string; path: string }[], signal: AbortSignal, cache = path.join(directory, '.compiled'), language: 'cpp' | 'python' = 'cpp') {
  const value = JSON.parse(response);
  if (value.outputMode !== undefined && !['exact', 'constructive'].includes(value.outputMode)) {
    throw new Error('Fast solver returned an invalid output mode');
  }
  if (typeof value.source !== 'string' || !value.source.trim() || Buffer.byteLength(value.source) > 256 * 1024) {
    throw new Error('Fast solver returned no usable source');
  }
  signal.throwIfAborted();
  await writeFile(path.join(directory, language === 'python' ? 'solution.py' : 'solution.cpp'), value.source, { mode: 0o600 });
  if (language === 'cpp') await compile(directory, signal, cache);
  await writeFile(path.join(directory, 'solver.json'), JSON.stringify({ runtime: 'node', script: language === 'python' ? 'python.cjs' : 'cpp.cjs' }), { mode: 0o600 });
  const examples = files.filter(file => /example|sample/i.test(file.name) && /^(in_|input)|\.(in)$/i.test(file.name));
  if (!examples.length) return;
  const task = path.join(directory, 'examples.json'), answers = path.join(directory, 'example-answers.json');
  await writeFile(task, JSON.stringify({ inputs: examples.map((file, index) => ({file_id: String(index), path: file.path})) }));
  await withExecutionLimit(exampleSignal => runRecipe(directory, task, answers, exampleSignal), signal, 10_000);
  const outputs = JSON.parse(await readFile(answers, 'utf8')).answers;
  // Nonunique constructions still run locally. Platform evaluation decides
  // correctness; an exact text comparison cannot validate a construction.
  if (value.outputMode === 'constructive') return;
  for (const [index, example] of examples.entries()) {
    const expectedName = example.name.replace(/^in_/, 'out_').replace(/^input/i, 'output').replace(/\.in$/i, '.out');
    const expected = files.find(file => file.name === expectedName);
    if (!expected || expectedName === example.name) continue;
    const actual = await readFile(path.join(directory, outputs[index].path), 'utf8');
    const wanted = await readFile(expected.path, 'utf8');
    const normalize = (text: string) => text.trim().split(/\s+/).join(' ');
    if (normalize(actual) !== normalize(wanted)) throw new Error(`Fast solver example mismatch: ${example.name}\nExpected: ${wanted.slice(0, 6000)}\nActual: ${actual.slice(0, 6000)}`);
  }
}
