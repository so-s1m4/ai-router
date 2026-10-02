import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import os from 'node:os';
import { prepareFastCode } from '../dist/ccc-fast.js';
import { prepareSolverTemplate } from '../dist/ccc-solver-template.js';

test('native example results are reused across candidates and invalidated by input or executable changes', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'ccc-cache-'));
  try {
    const input = path.join(root, 'input'), count = path.join(root, 'count');
    await writeFile(input, 'hello\n');
    const dirs = [path.join(root,'first'), path.join(root,'second')];
    const source = `#!/bin/sh\necho run >> '${count}'\ncat\n`;
    for (const dir of dirs) {
      await mkdir(dir);
      await prepareSolverTemplate(dir, path.join(root, 'results'));
      await writeFile(path.join(dir, 'solution'), source, {mode:0o700});
    }
    const example = spawnSync(process.execPath, ['cpp.cjs','--input',input], {cwd:dirs[0],encoding:'utf8'});
    assert.equal(example.status, 0, example.stderr);
    assert.equal(example.stdout, 'hello\n');
    const batch = async () => {
      await writeFile(path.join(dirs[1], 'task.json'), JSON.stringify({inputs:[{file_id:'scored',path:input}]}));
      const result = spawnSync(process.execPath, ['cpp.cjs','task.json','answers.json'], {cwd:dirs[1],encoding:'utf8'});
      assert.equal(result.status, 0, result.stderr);
      const answer = JSON.parse(await readFile(path.join(dirs[1],'answers.json'),'utf8')).answers[0];
      return readFile(path.join(dirs[1],answer.path),'utf8');
    };
    assert.equal(await batch(), 'hello\n');
    assert.equal(await readFile(count,'utf8'), 'run\n');
    await writeFile(input, 'changed\n');
    assert.equal(await batch(), 'changed\n');
    assert.equal(await readFile(count,'utf8'), 'run\nrun\n');
    await writeFile(path.join(dirs[1], 'solution'), source + 'echo new\n', {mode:0o700});
    assert.equal(await batch(), 'changed\nnew\n');
    assert.equal(await readFile(count,'utf8'), 'run\nrun\nrun\n');
  } finally { await rm(root,{recursive:true,force:true}); }
});

test('compiled binaries are reused across candidate folders and invalidated by source changes', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(),'ccc-build-cache-'));
  const originalPath = process.env.PATH;
  try {
    const compiler = spawnSync('which',['g++'],{encoding:'utf8'}).stdout.trim();
    const wrappers = path.join(root,'bin'), cache = path.join(root,'compiled'), count = path.join(root,'compiles');
    await mkdir(wrappers);
    await writeFile(path.join(wrappers,'g++'), `#!/bin/sh\nif [ "$1" != "--version" ]; then echo compile >> '${count}'; fi\nexec '${compiler}' "$@"\n`, {mode:0o700});
    process.env.PATH = wrappers + path.delimiter + originalPath;
    const source = '#include <iostream>\nint main(){std::cout << 42;}';
    for (const [index, code] of [source,source,source.replace('42','43')].entries()) {
      const dir = path.join(root,String(index));
      await mkdir(dir); await prepareSolverTemplate(dir);
      await prepareFastCode(JSON.stringify({source:code,outputMode:'exact'}),dir,[],new AbortController().signal,cache);
      const result = spawnSync(path.join(dir,'solution'),[],{encoding:'utf8'});
      assert.equal(result.status,0);
      assert.equal(result.stdout,index === 2 ? '43' : '42');
    }
    assert.equal(await readFile(count,'utf8'),'compile\ncompile\n');
  } finally { process.env.PATH = originalPath; await rm(root,{recursive:true,force:true}); }
});
