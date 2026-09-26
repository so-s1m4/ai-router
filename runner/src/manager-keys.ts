import { spawn, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { chown, chmod, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { createConnection, createServer } from 'node:net';
import path from 'node:path';

const dataRoot = process.env.MANAGER_DATA_DIR || '/manager-data';
const keyRoot = path.join(dataRoot, 'keys');
const agentSocket = process.env.SSH_AUTH_SOCK || '/ssh-agent/agent.sock';
const privateAgentSocket = path.join(dataRoot, 'agent.sock');
const keyId = (id: string) => { if (!/^[a-f0-9-]{36}$/.test(id)) throw new Error('Неверный ID ключа'); return path.join(keyRoot, id); };

function command(bin: string, args: string[], timeoutMs = 20_000): Promise<{ code: number; output: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { env: { PATH: process.env.PATH, HOME: dataRoot, SSH_AUTH_SOCK: privateAgentSocket }, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = ''; const timer = setTimeout(() => child.kill('SIGKILL'), timeoutMs);
    for (const stream of [child.stdout, child.stderr]) stream?.on('data', (chunk: Buffer) => { output = (output + chunk.toString()).slice(-8_000); });
    child.on('error', reject);
    child.on('close', code => { clearTimeout(timer); resolve({ code: code ?? 1, output }); });
  });
}

export async function startSshAgent(): Promise<ChildProcess> {
  await mkdir(keyRoot, { recursive: true, mode: 0o700 });
  await mkdir(path.dirname(agentSocket), { recursive: true });
  await chown(path.dirname(agentSocket), 0, 0);
  await chmod(path.dirname(agentSocket), 0o755);
  await rm(agentSocket, { force: true });
  await rm(privateAgentSocket, { force: true });
  const agent = spawn('ssh-agent', ['-D', '-a', privateAgentSocket], { stdio: 'ignore' });
  for (let i = 0; i < 50; i++) { try { await stat(privateAgentSocket); break; } catch { await new Promise(resolve => setTimeout(resolve, 100)); } }
  await stat(privateAgentSocket);
  const proxy = createServer(client => {
    const upstream = createConnection(privateAgentSocket);
    let pending = Buffer.alloc(0);
    client.on('data', (chunk: Buffer) => {
      if (pending.length + chunk.length > 260_000) { client.destroy(); return; }
      pending = Buffer.concat([pending, chunk]);
      while (pending.length >= 4) {
        const length = pending.readUInt32BE(0);
        if (length < 1 || length > 256_000) { client.destroy(); return; }
        if (pending.length < length + 4) return;
        const packet = pending.subarray(0, length + 4);
        pending = pending.subarray(length + 4);
        // The task runner may list identities and sign GitHub challenges only.
        if (packet[4] === 11 || packet[4] === 13) upstream.write(packet);
        else client.write(Buffer.from([0, 0, 0, 1, 5]));
      }
    });
    upstream.pipe(client);
    client.on('error', () => upstream.destroy());
    upstream.on('error', () => client.destroy());
    client.on('close', () => upstream.destroy());
    upstream.on('close', () => client.destroy());
  });
  await new Promise<void>((resolve, reject) => { proxy.once('error', reject); proxy.listen(agentSocket, () => { proxy.off('error', reject); resolve(); }); });
  await chown(agentSocket, 1000, 1000);
  await chmod(agentSocket, 0o600);
  for (const file of await readdir(keyRoot)) if (/^[a-f0-9-]{36}$/.test(file)) {
    const result = await command('ssh-add', [path.join(keyRoot, file)]);
    if (result.code !== 0) console.error(`Could not load SSH key ${file}: ${result.output.slice(-200)}`);
  }
  return agent;
}

export async function listKeys() {
  await mkdir(keyRoot, { recursive: true, mode: 0o700 });
  const entries = await readdir(keyRoot);
  const keys = [];
  for (const id of entries.filter(name => /^[a-f0-9-]{36}$/.test(name))) {
    try {
      const publicKey = (await readFile(keyId(id) + '.pub', 'utf8')).trim();
      const label = (await readFile(keyId(id) + '.name', 'utf8')).trim();
      const fingerprint = await command('ssh-keygen', ['-lf', keyId(id) + '.pub']);
      keys.push({ id, label, publicKey, fingerprint: fingerprint.output.trim().split(/\s+/)[1] || '' });
    } catch {}
  }
  return keys;
}

export async function createKey(label: string) {
  if (!label.trim() || label.length > 60 || /[\r\n]/.test(label)) throw new Error('Название ключа: 1–60 символов');
  const id = randomUUID(), file = keyId(id);
  await mkdir(keyRoot, { recursive: true, mode: 0o700 });
  const made = await command('ssh-keygen', ['-q', '-t', 'ed25519', '-N', '', '-C', label.trim(), '-f', file]);
  if (made.code !== 0) throw new Error(made.output || 'Не удалось создать SSH-ключ');
  await chmod(file, 0o600);
  await writeFile(file + '.name', label.trim(), { mode: 0o600 });
  const added = await command('ssh-add', [file]);
  if (added.code !== 0) throw new Error(added.output || 'Не удалось загрузить ключ в SSH-agent');
  return (await listKeys()).find(key => key.id === id);
}

export async function deleteKey(id: string) {
  const file = keyId(id);
  await command('ssh-add', ['-d', file]);
  for (const suffix of ['', '.pub', '.name']) await rm(file + suffix, { force: true });
  return { ok: true };
}

export async function testGithub() {
  const result = await command('ssh', ['-T', '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10', '-o', 'StrictHostKeyChecking=accept-new', '-o', `UserKnownHostsFile=${path.join(dataRoot, 'known_hosts')}`, 'git@github.com'], 18_000);
  return { connected: /successfully authenticated/i.test(result.output), message: result.output.trim().slice(-600) || `SSH завершился с кодом ${result.code}` };
}
