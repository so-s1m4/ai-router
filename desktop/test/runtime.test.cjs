const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { getFileMatchers, copyFiles } = require('app-builder-lib/out/fileMatcher');
const verifyRuntime = require('../scripts/verify-runtime.cjs');
const { build } = require('../package.json');

test('packaging copies bridge dependencies and rejects an incomplete runtime', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'router-packaging-'));
  const source = path.join(root, 'source');
  const resources = path.join(root, 'Resources');
  const moduleDir = path.join(source, 'runtime/runner/node_modules/socket.io-client');
  await fs.mkdir(moduleDir, { recursive: true });
  await fs.writeFile(path.join(moduleDir, 'index.js'), 'exports.io = function() {};');
  await fs.writeFile(path.join(source, 'runtime/runner/package.json'), '{}');
  try {
    // Use the real builder copier: it excludes node_modules at a FileSet root.
    const matchers = getFileMatchers(build, 'extraResources', resources, {
      defaultSrc: source, globalOutDir: path.join(root, 'output'),
      macroExpander: value => value, customBuildOptions: {},
    });
    await copyFiles(matchers);
    const context = { appOutDir: root, packager: { getResourcesDir: () => resources } };
    await verifyRuntime(context);
    await fs.rm(path.join(resources, 'runner/node_modules'), { recursive: true });
    await assert.rejects(verifyRuntime(context));
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
