import { cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const root = new URL('../', import.meta.url);
const output = new URL('dist/demo/', root);
await mkdir(output, { recursive: true });
await cp(new URL('dist/frontend/browser/', root), output, { recursive: true });
await cp(new URL('demo/demo.js', root), new URL('demo.js', output));
const index = await readFile(new URL('index.html', output), 'utf8');
await writeFile(new URL('index.html', output), index.replace('<head>', '<head><script src="/demo.js"></script>'));
console.log(fileURLToPath(output));
