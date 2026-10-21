import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { prepareSolverTemplate } from '../dist/ccc-solver-template.js';
import { runScoredRecipe } from '../dist/ccc-execution.js';

test('GCP transport executes real sources, returns answers and cleans up failed and canceled jobs', { timeout: 30000 }, async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'ccc-gcp-test-'));
  const saved = { ...process.env };
  try {
    const bin = path.join(root, 'bin');
    await mkdir(bin);
    // Emulate only transport; compile, execute, time out and clean up actual
    // processes and files using the same remote commands as production.
    await writeFile(path.join(bin, 'gcloud'), `#!/usr/bin/env node
const {spawnSync} = require('node:child_process');
const fs = require('node:fs');
const args = process.argv.slice(2);
fs.appendFileSync(process.env.GCP_TEST_LOG, JSON.stringify(args)+'\\n');
if(process.env.GCP_TEST_CONFIG_LOG)fs.appendFileSync(process.env.GCP_TEST_CONFIG_LOG,(process.env.CLOUDSDK_CONFIG||'')+'\\n');
let result;
if (args[1] === 'ssh') result = spawnSync('/bin/sh', ['-c', args.find(a=>a.startsWith('--command=')).slice(10)], {stdio:'inherit'});
else {
 const files = args.slice(2).filter(a=>!a.startsWith('--')).map(a=>a.replace(/^ccc-compute:/,''));
 result = spawnSync('cp', ['-r', ...files], {stdio:'inherit'});
}
process.exit(result.status ?? 1);
`, { mode: 0o700 });
    Object.assign(process.env, { PATH: bin + path.delimiter + saved.PATH, CCC_EXECUTION: 'gcp',
      CCC_GCP_PROJECT: 'project-37e84c09-c743-4b4c-8a8', CCC_GCP_ZONE: 'europe-west3-a',
      CCC_GCP_INSTANCE: 'ccc-compute', CCC_GCP_WORKERS: '2', CCC_GCP_TIMEOUT_SECONDS: '10',
      GCP_TEST_LOG: path.join(root, 'commands') });
    await writeFile(path.join(root, 'secret.txt'), 'MUST NOT BE UPLOADED');
    await writeFile(path.join(root, 'input.txt'), '21\n');
    await writeFile(path.join(root, 'task.json'), JSON.stringify({ inputs: [{ file_id: 'input-1', path: path.join(root, 'input.txt') }] }));
    const run = signal => runScoredRecipe(root, path.join(root, 'task.json'), path.join(root, 'answers.json'), signal ?? new AbortController().signal);
    for (const language of ['cpp', 'python']) {
      await writeFile(path.join(root, 'solver.json'), JSON.stringify({ runtime: 'node', script: language === 'cpp' ? 'cpp.cjs' : 'python.cjs' }));
      await writeFile(path.join(root, `solution.${language === 'cpp' ? 'cpp' : 'py'}`), language === 'cpp'
        ? '#include <iostream>\nint main(){int n;std::cin>>n;std::cout<<n*2<<"\\n";}'
        : 'print(int(input()) * 2)\n');
      await run();
      const { answers } = JSON.parse(await readFile(path.join(root, 'answers.json'), 'utf8'));
      assert.equal(answers[0].file_id, 'input-1');
      assert.equal(await readFile(path.join(root, answers[0].path), 'utf8'), '42\n');
    }
    await writeFile(path.join(root, 'solution.py'), 'raise RuntimeError("solver-broken")');
    await assert.rejects(run(), /solver-broken/);
    await writeFile(path.join(root, 'solution.py'), 'import time\ntime.sleep(60)');
    process.env.CCC_GCP_TIMEOUT_SECONDS = '1';
    await assert.rejects(run(), /Google Cloud command failed/);
    process.env.CCC_GCP_TIMEOUT_SECONDS = '10';
    const cancel = new AbortController();
    const timer = setTimeout(() => cancel.abort(), 1000);
    try { await assert.rejects(run(cancel.signal), /abort/i); }
    finally { clearTimeout(timer); }
    const commands = (await readFile(process.env.GCP_TEST_LOG, 'utf8')).trim().split('\n').map(JSON.parse);
    for (const args of commands.filter(args => args[1] === 'ssh')) {
      const remote = args.find(a => a.startsWith('--command=')).match(/\/tmp\/ai-router-ccc-[a-f0-9-]+/)?.[0];
      if (remote) await assert.rejects(readFile(path.join(remote, 'pid')), { code: 'ENOENT' });
    }
    assert.ok(commands.some(args => args.includes('--project=project-37e84c09-c743-4b4c-8a8')));
    process.env.CCC_EXECUTION = 'invalid';
    await assert.rejects(run(), /CCC_EXECUTION/);
    // Saved UI settings override legacy env values and use the sign-in store.
    process.env.GCP_TEST_CONFIG_LOG=path.join(root,'configs');
    process.env.RUNNER_DATA_DIR=path.join(root,'runner-data');
    await writeFile(path.join(root,'solution.py'),'print(int(input()) * 2)\n');
    const settings={enabled:true,runnerId:'12345678-1234-4234-8234-123456789abc',project:'project-from-settings',zone:'europe-west1-b',instance:'ccc-compute',workers:1,timeoutSeconds:10,useIap:true};
    await runScoredRecipe(root,path.join(root,'task.json'),path.join(root,'answers.json'),new AbortController().signal,settings);
    const configured=(await readFile(process.env.GCP_TEST_LOG,'utf8')).trim().split('\n').map(JSON.parse).filter(args=>args.includes('--project=project-from-settings'));
    assert.ok(configured.length>=5);
    assert.ok(configured.every(args=>args.includes('--zone=europe-west1-b')&&args.includes('--tunnel-through-iap')));
    assert.ok((await readFile(process.env.GCP_TEST_CONFIG_LOG,'utf8')).trim().split('\n').every(value=>value===path.join(root,'runner-data','ccc-gcloud')));
    await prepareSolverTemplate(root,'.results');
    await runScoredRecipe(root,path.join(root,'task.json'),path.join(root,'answers.json'),new AbortController().signal,{...settings,enabled:false});

  } finally {
    for (const key of Object.keys(process.env)) if (!(key in saved)) delete process.env[key];
    Object.assign(process.env, saved);
    await rm(root, { recursive: true, force: true });
  }
});
