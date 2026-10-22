import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { artifact } from '../dist/ccc-auto.js';
import { toolData, CccConnectionError, CccToolError, recoveringCcc } from '../dist/ccc-client.js';

for (const mode of ['success', 'range', 'digest', 'abort', 'denied']) test(`artifact size-limit fallback: ${mode}`, async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'ccc-artifact-'));
  const target = path.join(root, 'input');
  const data = Buffer.alloc(31 * 1024 * 1024 + 7, 'a');
  const controller = new AbortController();
  assert.equal(new CccToolError().code, 'ccc_mcp');
  let ranges = 0;
  const client = {async call(name, args) {
    if (name === 'get_artifact_download_url') {
      if (mode === 'denied') throw new CccToolError(403);
      try { toolData({isError:true, structuredContent:{ok:false,error:{detail:'Direct downloads are limited to 30 MiB'}}}); }
      catch (cause) { throw new CccConnectionError('wrapped', {cause}); }
    }
    assert.equal(name, 'read_artifact');
    ranges++;
    const chunk = data.subarray(args.offset, args.offset + args.length);
    if (mode === 'abort') controller.abort();
    return {data:chunk.toString('base64'),offset:args.offset,bytes:chunk.length,total_bytes:data.length,
      next_offset: mode === 'range' ? args.offset : args.offset + chunk.length < data.length ? args.offset + chunk.length : null};
  }};
  try {
    await writeFile(target, 'previous');
    const item = {artifact_id:'id',bytes:data.length,sha256:mode === 'digest' ? '0'.repeat(64) : createHash('sha256').update(data).digest('hex')};
    const run = () => artifact(client, item, target, controller.signal);
    if (mode === 'success') {
      await run();
      assert.deepEqual(await readFile(target), data);
      const before = ranges;
      await run();
      assert.equal(ranges, before);
      assert.ok(ranges > 1);
    } else {
      await assert.rejects(run());
      assert.equal(await readFile(target, 'utf8'), 'previous');
      if (mode === 'denied') assert.equal(ranges, 0);
    }
    assert.deepEqual(await readdir(root), ['input']);
  } finally { await rm(root, {force:true,recursive:true}); }
});

test('read_artifact reconnect retries the same byte range', async () => {
  let connects = 0;
  const args = {artifact_id:'id',offset:262144,length:262144,encoding:'base64'};
  const client = recoveringCcc(async () => {
    connects++;
    return {async close(){},async call(name, actual) {
      assert.equal(name,'read_artifact'); assert.deepEqual(actual,args);
      if (connects === 1) throw new CccToolError(503);
      return {data:'YQ=='};
    }};
  },new AbortController().signal,()=>{},[0]);
  assert.deepEqual(await client.call('read_artifact',args),{data:'YQ=='});
  assert.equal(connects,2);
  await client.close();
});
