import { writeFile } from 'node:fs/promises';
import path from 'node:path';

// The solver only implements text -> text; the runner supplies batch file I/O.
export async function prepareSolverTemplate(directory: string) {
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
const { spawnSync } = require('node:child_process');
function output(file, target) {
  const input = fs.openSync(file, 'r');
  const destination = target === undefined ? 1 : fs.openSync(target, 'w');
  try {
    const result = spawnSync(path.join(__dirname, 'solution'), [], {
      stdio: [input, destination, 'inherit'],
    });
    if (result.error) throw result.error;
    if (result.status !== 0) throw new Error('C++ solver failed: ' + (result.signal || result.status));
  } finally {
    fs.closeSync(input);
    if (target !== undefined) fs.closeSync(destination);
  }
}
if (process.argv[2] === '--input') {
  output(process.argv[3]);
} else {
  const task = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
  const answers = task.inputs.map((input, index) => {
    const name = 'output-' + index + '.txt';
    output(input.path, name);
    return {file_id: input.file_id, path: name};
  });
  fs.writeFileSync(process.argv[3], JSON.stringify({answers}));
}
`, { mode: 0o600 });
}
