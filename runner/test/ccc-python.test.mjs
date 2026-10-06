import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mkdtemp, readFile, writeFile, rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {prepareFastCode} from '../dist/ccc-fast.js';
import {prepareSolverTemplate} from '../dist/ccc-solver-template.js';
import {runRecipe} from '../dist/ccc-execution.js';

test('Python examples and batch execution validate output and propagate errors', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'ccc-python-'));
  const signal = new AbortController().signal;
  try {
    await prepareSolverTemplate(dir);
    const input = path.join(dir, 'sample.in'), output = path.join(dir, 'sample.out');
    await writeFile(input, '21\n'); await writeFile(output, '42\n');
    const files = [{name:'sample.in',path:input}, {name:'sample.out',path:output}];
    const response = source=>JSON.stringify({source,outputMode:'exact'});
    await prepareFastCode(response('print(int(input()) * 2)'), dir, files, signal, undefined, 'python');
    await assert.rejects(readFile(path.join(dir,'solution.cpp')), {code:'ENOENT'});
    const task = path.join(dir,'task.json'), answers = path.join(dir,'answers.json');
    await writeFile(task, JSON.stringify({inputs:[{file_id:'id-1',path:input},{file_id:'id-2',path:input}]}));
    await runRecipe(dir, task, answers, signal);
    const values = JSON.parse(await readFile(answers,'utf8')).answers;
    assert.deepEqual(values.map(a=>a.file_id), ['id-1','id-2']);
    for (const value of values) assert.equal(await readFile(path.join(dir,value.path),'utf8'), '42\n');
    await assert.rejects(prepareFastCode(response('print(0)'),dir,files,signal,undefined,'python'), /example mismatch/);
    await assert.rejects(prepareFastCode(response('invalid syntax !'),dir,files,signal,undefined,'python'), /SyntaxError/);
  } finally { await rm(dir,{recursive:true,force:true}); }
});
