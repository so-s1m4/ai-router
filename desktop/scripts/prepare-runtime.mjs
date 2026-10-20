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

if (process.platform === 'darwin') {
  const speech = path.join(desktop, 'runtime/speech');
  await mkdir(speech, { recursive: true });
  for (const [arch, target] of [['arm64','arm64-apple-macos12.0'],['x64','x86_64-apple-macos12.0']]) {
    execFileSync('xcrun', ['swiftc', '-swift-version', '5', '-O', '-target', target, path.join(desktop,'src/voice.swift'), '-Xlinker', '-sectcreate', '-Xlinker', '__TEXT', '-Xlinker', '__info_plist', '-Xlinker', path.join(desktop,'src/voice-info.plist'), '-o', path.join(speech,'speech-' + arch)], { stdio: 'inherit' });
  }
}
