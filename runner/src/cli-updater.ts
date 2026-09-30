import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { chmod, mkdir, mkdtemp, rename, rm, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';

type Provider = 'codex' | 'antigravity';
type Candidate = { provider: Provider; directory: string; version: string };
type Command = (command: string, args: string[], cwd?: string) => Promise<string>;
export type UpdaterOptions = {
  root: string;
  busy: () => boolean;
  promoted?: (provider: Provider) => void;
  enabled?: boolean;
  intervalMs?: number;
  env?: NodeJS.ProcessEnv;
  fetch?: typeof fetch;
  command?: Command;
  log?: (message: string) => void;
};
const versionPattern = /^\d+\.\d+\.\d+(?:[-+][\w.-]+)?$/;
const agyReleaseBase = 'https://antigravity-cli-auto-updater-974169037036.us-central1.run.app';

async function command(command: string, args: string[], cwd?: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
    let output = '', error = '';
    const stop = () => { try { process.kill(-child.pid!, 'SIGKILL'); } catch { child.kill('SIGKILL'); } };
    const timer = setTimeout(stop, 180_000);
    child.stdout.on('data', chunk => { output = (output + chunk).slice(-4000); });
    child.stderr.on('data', chunk => { error = (error + chunk).slice(-4000); });
    child.on('error', failure => { clearTimeout(timer); reject(failure); });
    child.on('close', code => { clearTimeout(timer); code === 0 ? resolve(output.trim()) : reject(new Error(`${command} failed (${code}): ${error.slice(-300)}`)); });
  });
}

/** Installs in a writable volume, validates binaries, and atomically switches PATH entries. */
export class CliUpdater {
  private readonly env: NodeJS.ProcessEnv;
  private readonly fetch: typeof fetch;
  private readonly command: Command;
  private readonly log: (message: string) => void;
  private readonly directory: string;
  private readonly intervalMs: number;
  private readonly enabled: boolean;
  private readonly pending = new Map<Provider, Candidate>();
  private operation?: Promise<void>;
  private nextCheck = 0;
  private timer?: ReturnType<typeof setInterval>;

  constructor(private readonly options: UpdaterOptions) {
    this.env = options.env ?? process.env;
    this.fetch = options.fetch ?? fetch;
    this.command = options.command ?? command;
    this.log = options.log ?? (message => console.log(message));
    this.directory = path.join(options.root, 'cli');
    const interval = options.intervalMs ?? Number(this.env.CLI_UPDATE_INTERVAL_SECONDS ?? 21600) * 1000;
    this.intervalMs = Number.isFinite(interval) && interval > 0 ? Math.max(60_000, interval) : 21_600_000;
    this.enabled = options.enabled ?? (this.env.CLI_AUTO_UPDATE !== 'false' && this.env.MOCK_MODE !== 'true');
  }

  async start() {
    if (!this.enabled) return;
    // Each process also needs this PATH; Docker sets the same paths for login scripts and the manager.
    const entries = [path.join(this.directory, 'current', 'codex'), path.join(this.directory, 'current', 'antigravity')];
    this.env.PATH = [...entries, ...(this.env.PATH ?? '').split(path.delimiter).filter(entry => !entries.includes(entry))].join(path.delimiter);
    await this.check();
    this.timer = setInterval(() => void this.check(), 60_000);
    this.timer.unref();
  }

  stop() { if (this.timer) clearInterval(this.timer); }

  check(): Promise<void> {
    if (!this.enabled) return Promise.resolve();
    if (this.operation) return this.operation;
    this.operation = this.run().catch(error => this.log(`CLI update failed; keeping installed versions: ${(error as Error).message}`)).finally(() => { this.operation = undefined; });
    return this.operation;
  }

  private async run() {
    await mkdir(path.join(this.directory, 'releases'), { recursive: true });
    await mkdir(path.join(this.directory, 'current'), { recursive: true });
    await this.promotePending();
    if (Date.now() < this.nextCheck) return;
    let failed = false;
    for (const provider of ['codex', 'antigravity'] as const) {
      if (this.pending.has(provider) || (provider === 'codex' ? this.env.CODEX_BIN : this.env.AGY_BIN)) continue;
      const binary = provider === 'codex' ? 'codex' : 'agy';
      let installed: string;
      try { installed = await this.command(binary, ['--version']); } catch { continue; }
      let stage: string | undefined;
      try {
        const latest = await this.latest(provider);
        if (installed.match(/\d+\.\d+\.\d+(?:[-+][\w.-]+)?/)?.[0] === latest.version) continue;
        stage = await mkdtemp(path.join(this.directory, 'releases', `${provider}-`));
        let executable: string, binaryDirectory: string;
        if (provider === 'codex') {
          await this.command('npm', ['install', '--prefix', stage, '--no-audit', '--no-fund', '--registry=https://registry.npmjs.org', `@openai/codex@${latest.version}`], stage);
          binaryDirectory = path.join(stage, 'node_modules', '.bin');
          executable = path.join(binaryDirectory, 'codex');
        } else {
          const response = await this.fetch(latest.url!, { signal: AbortSignal.timeout(180_000) });
          if (!response.ok) throw new Error(`Antigravity download failed (${response.status})`);
          const payload = Buffer.from(await response.arrayBuffer());
          if (createHash('sha512').update(payload).digest('hex') !== latest.sha512) throw new Error('Antigravity release checksum mismatch');
          executable = path.join(stage, 'agy');
          if (new URL(latest.url!).pathname.endsWith('.tar.gz')) {
            const archive = path.join(stage, 'release.tar.gz');
            await writeFile(archive, payload);
            await this.command('tar', ['-xzf', archive, '-C', stage, 'antigravity']);
            await rename(path.join(stage, 'antigravity'), executable);
            await rm(archive);
          } else await writeFile(executable, payload);
          await chmod(executable, 0o755);
          binaryDirectory = stage;
        }
        const verified = await this.command(executable, ['--version']);
        if (verified.match(/\d+\.\d+\.\d+(?:[-+][\w.-]+)?/)?.[0] !== latest.version) throw new Error('Downloaded CLI version does not match the release');
        await writeFile(path.join(stage, 'version.json'), JSON.stringify({ provider, version: latest.version, installedAt: new Date().toISOString() }));
        this.pending.set(provider, { provider, directory: binaryDirectory, version: latest.version });
        stage = undefined;
      } catch (error) {
        failed = true;
        this.log(`${provider} update failed; keeping installed version: ${(error as Error).message}`);
      } finally { if (stage) await rm(stage, { recursive: true, force: true }); }
    }
    // Retry network failures sooner; check current releases every six hours otherwise.
    this.nextCheck = Date.now() + (failed ? Math.min(this.intervalMs, 300_000) : this.intervalMs);
    await this.promotePending();
  }

  private async latest(provider: Provider): Promise<{ version: string; url?: string; sha512?: string }> {
    const platform = process.platform === 'linux' && process.arch === 'x64' ? 'linux_amd64' : process.platform === 'linux' && process.arch === 'arm64' ? 'linux_arm64' : undefined;
    if (provider === 'antigravity' && !platform) throw new Error('Unsupported Antigravity update platform');
    const url = provider === 'codex' ? 'https://registry.npmjs.org/@openai%2Fcodex/latest' : `${agyReleaseBase}/manifests/${platform}.json`;
    const response = await this.fetch(url, { signal: AbortSignal.timeout(30_000) });
    if (!response.ok) throw new Error(`Release check failed (${response.status})`);
    const release = await response.json() as { version: string; url?: string; sha512?: string };
    if (typeof release.version !== 'string' || !versionPattern.test(release.version)) throw new Error('Invalid CLI release version');
    if (provider === 'antigravity') {
      const download = new URL(release.url ?? '');
      if (download.protocol !== 'https:' || download.hostname !== 'storage.googleapis.com' || !download.pathname.startsWith('/antigravity-public/antigravity-cli/') || download.username || download.password || !/^[a-f0-9]{128}$/.test(release.sha512 ?? '')) throw new Error('Invalid Antigravity release manifest');
    }
    return release;
  }

  private async promotePending() {
    for (const [provider, candidate] of this.pending) {
      if (this.options.busy()) return;
      const target = path.join(this.directory, 'current', provider);
      const temporary = `${target}.${randomUUID()}`;
      try {
        await symlink(candidate.directory, temporary, 'dir');
        if (this.options.busy()) continue;
        await rename(temporary, target);
        this.pending.delete(provider);
        this.options.promoted?.(provider);
        this.log(`${provider} CLI updated to ${candidate.version}`);
      } finally { await rm(temporary, { force: true }); }
    }
  }
}
