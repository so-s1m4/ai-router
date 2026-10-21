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

test('Python input files overlap within worker limits and retain manifest order', async () => {
  const { spawn } = await import('node:child_process');
  const dir = await mkdtemp(path.join(os.tmpdir(), 'ccc-python-parallel-'));
  try {
    await prepareSolverTemplate(dir);
    await writeFile(path.join(dir, 'solution.py'), `import time
from pathlib import Path
value = input()
with Path('workers.log').open('a') as log: log.write('start\\n')
time.sleep(0.15 if value == '0' else 0.05)
print(value)
with Path('workers.log').open('a') as log: log.write('end\\n')
`);
    const inputs = [];
    for (let i = 0; i < 4; i++) {
      const file = path.join(dir, 'input-' + i);
      await writeFile(file, String(i));
      inputs.push({file_id:String(i),path:file});
    }
    await writeFile(path.join(dir,'task.json'),JSON.stringify({inputs}));
    await new Promise((resolve,reject) => {
      const child = spawn(process.execPath,['python.cjs','task.json','answers.json'],{
        cwd:dir,env:{...process.env,CCC_CPP_WORKERS:'2'},stdio:['ignore','ignore','pipe'],
      });
      let errors = '';
      child.stderr.on('data',chunk=>{errors+=chunk;});
      child.on('error',reject);
      child.on('close',code=>code === 0 ? resolve() : reject(new Error(errors)));
    });
    let active=0, maximum=0;
    for (const event of (await readFile(path.join(dir,'workers.log'),'utf8')).trim().split('\n')) {
      active += event === 'start' ? 1 : -1;
      maximum = Math.max(maximum,active);
    }
    assert.equal(active,0);
    assert.equal(maximum,2);
    const {answers}=JSON.parse(await readFile(path.join(dir,'answers.json'),'utf8'));
    assert.deepEqual(answers.map(a=>a.file_id),['0','1','2','3']);
    for (const answer of answers) assert.equal(await readFile(path.join(dir,answer.path),'utf8'),answer.file_id+'\n');
  } finally { await rm(dir,{recursive:true,force:true}); }
});
