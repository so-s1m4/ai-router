import { writeFile } from 'node:fs/promises';
import path from 'node:path';

// The solver only implements text -> text; the runner supplies batch file I/O.
export async function prepareSolverTemplate(directory: string, cache = path.join(directory, '.results')) {
  await writeFile(path.join(directory, 'batch.cjs'), `const fs = require('node:fs');
const path = require('node:path');
exports.runBatch = async function(solve) {
  async function output(file) {
    const result = await solve(fs.readFileSync(file, 'utf8'));
    if (typeof result !== 'string') throw new Error('solve(text) must return output text');
    return result;
  }
  if (process.argv[2] === '--input') {
    process.stdout.write(await output(process.argv[3]));
    return;
  }
  const task = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
  const answers = [];
  for (const [index, input] of task.inputs.entries()) {
    const name = 'output-' + index + '.txt';
    fs.writeFileSync(path.resolve(name), await output(input.path));
    answers.push({file_id: input.file_id, path: name});
  }
  fs.writeFileSync(process.argv[3], JSON.stringify({answers}));
};
`, { mode: 0o600 });
  // Keep manifest handling out of generated C++; stream files directly through
  // the native solver so large inputs and outputs never fill a JS buffer.
  await writeFile(path.join(directory, 'cpp.cjs'), `const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { createHash } = require('node:crypto');
const children = new Set();
const binaryHash = createHash('sha256').update(fs.readFileSync(path.join(__dirname, 'solution'))).digest('hex');
const cache = ${JSON.stringify(cache)};
fs.mkdirSync(cache, {recursive: true, mode: 0o700});
function inputHash(file) {
  const hash = createHash('sha256');
  const descriptor = fs.openSync(file, 'r'), buffer = Buffer.alloc(65536);
  try {
    let size;
    while ((size = fs.readSync(descriptor, buffer, 0, buffer.length, null))) hash.update(buffer.subarray(0, size));
  } finally { fs.closeSync(descriptor); }
  return hash.update(binaryHash).digest('hex');
}
async function deliver(file, target) {
  if (target !== undefined) { fs.copyFileSync(file, target); return; }
  for await (const chunk of fs.createReadStream(file)) {
    if (!process.stdout.write(chunk)) await new Promise(resolve => process.stdout.once('drain', resolve));
  }
}
async function output(file, target, key = inputHash(file)) {
  const cached = path.join(cache, key);
  if (fs.existsSync(cached)) {
    await deliver(cached, target);
    return;
  }
  const temporary = cached + '.' + process.pid + '-' + Math.random().toString(16).slice(2) + '.tmp';
  const input = fs.openSync(file, 'r');
  const destination = fs.openSync(temporary, 'w');
  try {
    await new Promise((resolve, reject) => {
      const binary = path.join(__dirname, 'solution');
      const memory = process.env.CCC_CPP_MEMORY_BYTES;
      const child = spawn(process.platform === 'linux' ? 'prlimit' : binary,
        process.platform === 'linux' ? ['--as=' + memory, '--', binary] : [],
        { stdio: [input, destination, 'inherit'] });
      children.add(child);
      child.on('error', reject);
      child.on('close', (code, signal) => {
        children.delete(child);
        if (code !== 0) reject(new Error('C++ solver failed: ' + (signal || code)));
        else resolve();
      });
    });
  } catch (error) {
    fs.rmSync(temporary, {force: true});
    throw error;
  } finally {
    fs.closeSync(input);
    fs.closeSync(destination);
  }
  fs.renameSync(temporary, cached);
  await deliver(cached, target);
}
(async () => {
  // Standalone example invocations use the same bounded memory default.
  process.env.CCC_CPP_MEMORY_BYTES ||= String(512 * 1024 * 1024);
  if (process.argv[2] === '--input') {
    await output(process.argv[3]);
  } else {
    const task = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
    const answers = new Array(task.inputs.length);
    let next = 0;
    await Promise.all(Array.from({length: Math.min(Number(process.env.CCC_CPP_WORKERS || 1), task.inputs.length)}, async () => {
      while (next < task.inputs.length) {
        const index = next++;
        const input = task.inputs[index];
        const key = inputHash(input.path);
        const name = 'output-' + key + '.txt';
        await output(input.path, name, key);
        answers[index] = {file_id: input.file_id, path: name};
      }
    }));
    fs.writeFileSync(process.argv[3], JSON.stringify({answers}));
  }
})().catch(error => {
  for (const child of children) child.kill('SIGKILL');
  console.error(error);
  process.exitCode = 1;
});
`, { mode: 0o600 });
}
