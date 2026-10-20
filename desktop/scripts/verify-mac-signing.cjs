const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const path = require('node:path');

assert.equal(process.platform, 'darwin', 'Run this check on macOS after packaging');
const nativeDirectory = process.arch === 'arm64' ? 'mac-arm64' : 'mac';
for (const directory of ['mac-arm64', 'mac']) {
  const bundle = path.resolve(__dirname, '../release', directory, 'AI Router.app');
  execFileSync('/usr/bin/codesign', ['--verify', '--deep', '--strict', bundle], { stdio: 'inherit' });
  // Inspect the actual signed entitlement, rather than only the source plist.
  const entitlements = execFileSync('/usr/bin/codesign', ['--display', '--entitlements', ':-', bundle], { encoding: 'utf8' });
  const signed = JSON.parse(execFileSync('/usr/bin/plutil', ['-convert', 'json', '-o', '-', '-'], { input: entitlements, encoding: 'utf8' }));
  assert.equal(signed['com.apple.security.cs.disable-library-validation'], true, `${directory}: ad-hoc signing requires disabling library validation`);
  if (directory === nativeDirectory) {
    // Loading the packaged Electron executable catches dyld/Team ID failures.
    const executable = path.join(bundle, 'Contents/MacOS/AI Router');
    const output = execFileSync(executable, ['-e', 'console.log("electron-launch-ok")'], {
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
      encoding: 'utf8', timeout: 30000,
    });
    assert.equal(output.trim(), 'electron-launch-ok');
  }
  console.log(`Verified signing: ${directory}`);
}
