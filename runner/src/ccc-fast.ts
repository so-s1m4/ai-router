import { spawn } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { runRecipe, withExecutionLimit } from './ccc-execution.js';

export const codeOutputSchema = {
  type: 'object', properties: { source: { type: 'string' } }, required: ['source'], additionalProperties: false,
};

export function fastLevelLimit(): number {
  const value = Number(process.env.CCC_AUTO_FAST_LEVELS ?? 2);
  return Number.isSafeInteger(value) && value >= 0 && value <= 100 ? value : 2;
}

export function codePrompt(level: number, context: unknown): string {
  return `Solve CCC level ${level} immediately using only the supplied statement and examples. Return JSON {"source":"complete C++17 source"}. No tools, file operations, plan or explanation. The runner compiles and checks examples and executes the scored inputs. Write a standalone program reading one input from stdin and writing the answer to stdout. Use a compact algorithm suitable for the input sizes. If the context is insufficient (including required diagrams), return an empty source so a full agent can inspect the files.\nTask context: ${JSON.stringify(context)}`;
}

async function compile(directory: string, signal: AbortSignal) {
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

export async function prepareFastCode(response: string, directory: string,
  files: { name: string; path: string }[], signal: AbortSignal) {
  const value = JSON.parse(response);
  if (typeof value.source !== 'string' || !value.source.trim() || Buffer.byteLength(value.source) > 256 * 1024) {
    throw new Error('Fast solver returned no usable C++ source');
  }
  await writeFile(path.join(directory, 'solution.cpp'), value.source, { mode: 0o600 });
  await compile(directory, signal);
  await writeFile(path.join(directory, 'solver.json'), JSON.stringify({ runtime: 'node', script: 'cpp.cjs' }), { mode: 0o600 });
  const examples = files.filter(file => /example|sample/i.test(file.name) && /^(in_|input)|\.(in)$/i.test(file.name));
  if (!examples.length) return;
  const task = path.join(directory, 'examples.json'), answers = path.join(directory, 'example-answers.json');
  await writeFile(task, JSON.stringify({ inputs: examples.map((file, index) => ({file_id: String(index), path: file.path})) }));
  await withExecutionLimit(exampleSignal => runRecipe(directory, task, answers, exampleSignal), signal, 10_000);
  const outputs = JSON.parse(await readFile(answers, 'utf8')).answers;
  for (const [index, example] of examples.entries()) {
    const expectedName = example.name.replace(/^in_/, 'out_').replace(/^input/i, 'output').replace(/\.in$/i, '.out');
    const expected = files.find(file => file.name === expectedName);
    if (!expected || expectedName === example.name) continue;
    const actual = await readFile(path.join(directory, outputs[index].path), 'utf8');
    const wanted = await readFile(expected.path, 'utf8');
    const normalize = (text: string) => text.trim().split(/\s+/).join(' ');
    if (normalize(actual) !== normalize(wanted)) throw new Error(`Fast solver example mismatch: ${example.name}`);
  }
}
