const path = require('node:path');
const fs = require('node:fs');
const { execFileSync } = require('node:child_process');

// Run before signing and archiving, for every architecture. Loading the module
// also checks its transitive dependencies without connecting to a server.
module.exports = async ({ appOutDir, packager }) => {
  const helper = path.join(packager.getResourcesDir(appOutDir), 'runner/computer-use');
  fs.accessSync(helper, fs.constants.X_OK);
  if (process.platform === 'darwin') {
    const info = execFileSync('xcrun',['lipo','-info',helper],{encoding:'utf8'});
    if (!info.includes('arm64') || !info.includes('x86_64')) throw new Error('Computer helper must include both architectures');
  }
  const runtime = path.join(packager.getResourcesDir(appOutDir), 'runner/node_modules/socket.io-client');
  execFileSync(process.execPath, ['-e', `
    const { io } = require(${JSON.stringify(runtime)});
    require('node:assert/strict').equal(typeof io, 'function');
  `], { stdio: 'inherit' });
};
