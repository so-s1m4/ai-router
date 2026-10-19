import { mkdir, rm, writeFile, readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const desktop = fileURLToPath(new URL('..', import.meta.url));
const runtime = path.join(desktop, 'runtime/runner');
await rm(runtime, { recursive: true, force: true });
await mkdir(runtime, { recursive: true });
await writeFile(path.join(runtime, 'package.json'), JSON.stringify({name:'ai-router-mac-bridge',version:JSON.parse(await readFile(path.join(desktop,'package.json'),'utf8')).version,private:true,dependencies:{'socket.io-client':'4.8.1'}}));
execFileSync('npm', ['install', '--omit=dev', '--ignore-scripts'], { cwd: runtime, stdio: 'inherit' });

// Universal helper: the same runtime is packaged for arm64 and x64.
if (process.platform === 'darwin') {
  const source = path.join(desktop, 'native/ComputerUse.swift');
  for (const arch of ['arm64','x86_64']) {
    execFileSync('xcrun', ['swiftc','-parse-as-library','-O','-target',arch+'-apple-macos14.0',source,'-o',path.join(runtime,'computer-use-'+arch)], {stdio:'inherit'});
  }
  execFileSync('xcrun', ['lipo','-create',path.join(runtime,'computer-use-arm64'),path.join(runtime,'computer-use-x86_64'),'-output',path.join(runtime,'computer-use')], {stdio:'inherit'});
  await Promise.all(['arm64','x86_64'].map(arch => rm(path.join(runtime,'computer-use-'+arch))));
}
