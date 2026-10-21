import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

export const cccGcloudDirectory = () => path.join(path.resolve(process.env.RUNNER_DATA_DIR || '/runner-data'), 'ccc-gcloud');
export const cccGcloudBinary = () => process.env.CCC_GCLOUD_BIN || 'gcloud';
export function cccGcloudEnv(directory = cccGcloudDirectory()) {
  return { ...process.env, CLOUDSDK_CONFIG: directory, CLOUDSDK_CORE_DISABLE_PROMPTS: '1' };
}

type Pending = { id: string; child: ChildProcessWithoutNullStreams; expiresAt: number; timer: NodeJS.Timeout; done: Promise<void>; submitting: boolean };
// The process and PKCE verifier live on the runner until the user enters the code.
// Neither tokens nor gcloud output are returned to the control plane.
export class CccGcpAuth {
  private pending?: Pending;
  private generation = 0;
  constructor(private directory = cccGcloudDirectory(), private binary = cccGcloudBinary()) {}
  private async command(args: string[]) {
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    return new Promise<string>((resolve, reject) => {
      const child = spawn(this.binary, args, { env: cccGcloudEnv(this.directory), stdio: ['ignore', 'pipe', 'pipe'] });
      const timer = setTimeout(() => { child.kill(); reject(new Error('Google Cloud command timed out')); }, 20_000);
      let output = '';
      child.stdout.on('data', chunk => { output = (output + chunk).slice(-32_000); });
      child.stderr.resume();
      child.on('error', () => { clearTimeout(timer); reject(new Error('Google Cloud CLI is unavailable on this runner')); });
      child.on('close', code => { clearTimeout(timer); code === 0 ? resolve(output.trim()) : reject(new Error('Google Cloud command failed. Reconnect your Google account.')); });
    });
  }
  async status() {
    const email = await this.command(['auth', 'list', '--filter=status:ACTIVE', '--format=value(account)']);
    return { connected: !!email, email: email || undefined };
  }
  cancel() {
    ++this.generation;
    const pending = this.pending;
    this.pending = undefined;
    if (pending) { clearTimeout(pending.timer); pending.child.kill(); }
  }
  async start() {
    if (this.pending?.submitting) throw new Error('Google authorization is being completed');
    this.cancel();
    const generation = this.generation;
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    if (generation !== this.generation) throw new Error('Google sign-in canceled');
    const child = spawn(this.binary, ['auth', 'login', '--no-launch-browser', '--force'], {
      env: { ...cccGcloudEnv(this.directory), CLOUDSDK_CORE_DISABLE_PROMPTS: '0' }, stdio: ['pipe', 'pipe', 'pipe'],
    });
    child.stdin.on('error', () => {});
    const id = randomUUID(), expiresAt = Date.now() + 10 * 60_000;
    let resolveDone!: () => void, rejectDone!: (error: Error) => void;
    const done = new Promise<void>((resolve, reject) => { resolveDone = resolve; rejectDone = reject; });
    void done.catch(() => {});
    const pending: Pending = { id, child, expiresAt, done, submitting: false, timer: setTimeout(() => { if (this.pending === pending) this.cancel(); }, 10 * 60_000) };
    pending.timer.unref();
    this.pending = pending;
    child.on('error', () => rejectDone(new Error('Google Cloud CLI is unavailable on this runner')));
    child.on('close', code => {
      clearTimeout(pending.timer);
      if (this.pending === pending) this.pending = undefined;
      code === 0 ? resolveDone() : rejectDone(new Error('Google authorization failed or expired. Start sign-in again.'));
    });
    try {
      const url = await new Promise<string>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('Google sign-in link timed out')), 20_000);
        let output = '';
        const append = (chunk: Buffer) => {
          output = (output + chunk.toString()).slice(-64_000);
          const match = output.match(/https:\/\/accounts\.google\.com\/[^\s\x1b]+/);
          if (match && /Enter (?:verification|authorization) code/i.test(output)) { clearTimeout(timer); resolve(new URL(match[0]).toString()); }
        };
        child.stdout.on('data', append); child.stderr.on('data', append);
        done.then(() => { clearTimeout(timer); reject(new Error('Google sign-in ended before requesting a code')); }, error => { clearTimeout(timer); reject(error); });
      });
      return { flowId: id, url, expiresAt };
    } catch (error) { if (this.pending === pending) this.cancel(); throw error; }
  }
  async complete(flowId: string, code: string) {
    const pending = this.pending;
    if (!pending || pending.id !== flowId || pending.expiresAt <= Date.now()) throw new Error('Google sign-in expired. Start sign-in again.');
    if (pending.submitting) throw new Error('Google authorization is being completed');
    pending.submitting = true;
    pending.child.stdin.end(code + '\n');
    // Keep HTTP/RPC bounded even if Google's token exchange stalls.
    const timeout = setTimeout(() => { if (this.pending === pending) this.cancel(); }, 30_000);
    try { await pending.done; return await this.status(); }
    finally { clearTimeout(timeout); }
  }
  async disconnect() {
    this.cancel();
    await this.command(['auth', 'revoke', '--all', '--quiet']);
    return { connected: false };
  }
}
