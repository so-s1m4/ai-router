const { test } = require('node:test');
const assert = require('node:assert/strict');
const { mkdtemp, mkdir, writeFile, realpath, rm } = require('node:fs/promises');
const { execFileSync } = require('node:child_process');
const path = require('node:path');
const os = require('node:os');
const { serverUrl, folderProfile, descendants } = require('../src/access.cjs');
test('server address cannot carry credentials, insecure protocols or remote paths', () => {
  assert.equal(serverUrl('https://router.example/'), 'https://router.example');
  for (const url of ['http://router.example','file:///etc/passwd','https://user:pass@router.example','https://router.example/path','https://router.example/?token=x']) assert.throws(() => serverUrl(url));
});
test('folder paths are quoted and never interpolated as sandbox rules', () => {
  const profile = folderProfile({folder:'/Users/test/a"b',data:'/app/data',runtime:'/app/runtime',executable:'/app/runtime/electron',temporary:'/app/tmp'});
  assert.ok(profile.includes('(deny default)'));
  assert.ok(profile.includes('(subpath "/Users/test/a\\"b")'));
  assert.ok(!profile.includes('(allow default)'));
  assert.throws(() => folderProfile({folder:'/'}));
  assert.throws(() => folderProfile({folder:'/x\n(allow default)',data:'/a',runtime:'/b',executable:'/c/d',temporary:'/e'}));
});
test('stop includes detached descendants without targeting other processes', () => {
  assert.deepEqual(descendants([{pid:11,ppid:1},{pid:12,ppid:11},{pid:13,ppid:12},{pid:14,ppid:1}],11),[12,13]);
});
test('macOS folder sandbox blocks sibling files, writes and symlink escapes in subprocesses', {skip:process.platform !== 'darwin'}, async () => {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(),'router-access-')));
  const folder = path.join(root,'allowed'), outside = path.join(root,'outside.txt');
  await mkdir(folder); await writeFile(path.join(folder,'inside.txt'),'allowed'); await writeFile(outside,'private');
  const { symlink } = require('node:fs/promises');
  await symlink(outside,path.join(folder,'escape.txt'));
  const profile = folderProfile({folder,data:path.join(root,'data'),runtime:'/nonexistent/runtime',executable:'/nonexistent/runtime/Electron',temporary:path.join(root,'tmp')});
  const run = command => {
    try { return execFileSync('/usr/bin/sandbox-exec',['-p',profile,'/bin/sh','-c',command],{encoding:'utf8',stdio:['ignore','pipe','pipe']}); }
    catch (error) { error.message += `\nstatus=${error.status} signal=${error.signal}\n${error.stderr || ''}`; throw error; }
  };
  const quote = value => "'"+value.replaceAll("'","'\\''")+"'";
  try {
    assert.equal(run(`/bin/cat ${quote(path.join(folder,'inside.txt'))}`),'allowed');
    run(`echo updated > ${quote(path.join(folder,'inside.txt'))}`);
    assert.throws(() => run(`/bin/cat ${quote(outside)}`));
    assert.throws(() => run(`echo bad > ${quote(outside)}`));
    assert.throws(() => run(`/bin/cat ${quote(path.join(folder,'escape.txt'))}`));
    assert.throws(() => run(`/bin/sh -c ${quote('/bin/cat '+quote(outside))}`));
    // The bundled Electron runtime must be able to run the real runner imports under the profile.
    const fs = require('node:fs');
    const electronPackage = require.resolve('electron/package.json');
    const electron = process.env.DESKTOP_TEST_EXECUTABLE || path.join(path.dirname(electronPackage),'dist/Electron.app/Contents/MacOS/Electron');
    assert.ok(fs.existsSync(electron), 'Electron runtime must be installed on macOS');
    {
      const runnerRuntime = await realpath(process.env.DESKTOP_TEST_RUNTIME || path.join(__dirname,'../runtime/runner'));
      const data = path.join(root,'data'), temporary = path.join(data,'tmp');
      await mkdir(temporary,{recursive:true});
      const smoke = path.join(data,'smoke.cjs');
      await writeFile(smoke, `require(${JSON.stringify(path.join(runnerRuntime,'node_modules/socket.io-client'))}); console.log('runtime-ok');`);
      const actualProfile = folderProfile({folder,data,runtime:runnerRuntime,executable:electron,temporary});
      assert.match(execFileSync('/usr/bin/sandbox-exec',['-p',actualProfile,electron,smoke],{encoding:'utf8',env:{...process.env,ELECTRON_RUN_AS_NODE:'1',TMPDIR:temporary}}),/runtime-ok/);
      // Exercise denied files through the actual packaged runtime as well as sh.
      for (const denied of [outside, path.join(folder,'escape.txt')]) {
        assert.match(execFileSync('/usr/bin/sandbox-exec',['-p',actualProfile,electron,'-e',`try { require('node:fs').readFileSync(${JSON.stringify(denied)}); process.exit(1); } catch(e) { if (!['EPERM','EACCES'].includes(e.code)) throw e; console.log('blocked'); }`],{encoding:'utf8',env:{...process.env,ELECTRON_RUN_AS_NODE:'1',TMPDIR:temporary}}),/blocked/);
      }
      assert.equal(fs.existsSync(path.join(runnerRuntime,'node_modules/@openai')),false, 'Mac bridge must not bundle Codex');

    }
  } finally { await rm(root,{recursive:true,force:true}); }
});
