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
}
