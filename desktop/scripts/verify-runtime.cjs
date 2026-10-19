const path = require('node:path');
const { execFileSync } = require('node:child_process');

// Run before signing and archiving, for every architecture. Loading the module
// also checks its transitive dependencies without connecting to a server.
module.exports = async ({ appOutDir, packager }) => {
  const runtime = path.join(packager.getResourcesDir(appOutDir), 'runner/node_modules/socket.io-client');
  execFileSync(process.execPath, ['-e', `
    const { io } = require(${JSON.stringify(runtime)});
    require('node:assert/strict').equal(typeof io, 'function');
  `], { stdio: 'inherit' });
};
