import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { cccGcloudBinary, cccGcloudDirectory, cccGcloudEnv } from './ccc-gcp-auth.js';
import { cccGcpVmSchema, type CccGcpSettings } from './ccc-settings.js';

const startup = `#!/bin/bash
set -euo pipefail
export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get install -y --no-install-recommends nodejs python3 g++ util-linux
touch /var/lib/ccc-compute-ready
`;

export class CccGcpVm {
  private busy = false;
  constructor(private directory = cccGcloudDirectory(), private binary = cccGcloudBinary()) {}
  private async command(args: string[], timeout = 30_000) {
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    return new Promise<string>((resolve, reject) => {
      const child = spawn(this.binary, args, { env: cccGcloudEnv(this.directory), stdio: ['ignore', 'pipe', 'pipe'] });
      let output = '', error = '';
      const timer = setTimeout(() => {
        child.kill('SIGKILL');
        reject(new Error('Google Cloud request timed out. Check VM status before retrying.'));
      }, timeout);
      child.stdout.on('data', chunk => { output = (output + chunk).slice(-32_000); });
      child.stderr.on('data', chunk => { error = (error + chunk).slice(-4_000); });
      child.on('error', () => { clearTimeout(timer); reject(new Error('Google Cloud CLI is unavailable on this runner')); });
      child.on('close', code => {
        clearTimeout(timer);
        code === 0 ? resolve(output.trim()) : reject(new Error(`Google Cloud request failed: ${error || 'check project permissions and billing'}`));
      });
    });
  }
  async run(action: 'status'|'create'|'start'|'stop'|'resize', settings: CccGcpSettings) {
    ({ action, settings } = cccGcpVmSchema.parse({action, settings}));
    if (this.busy) throw new Error('A VM request is already in progress on this runner');
    this.busy = true;
    const flags = [`--project=${settings.project}`, `--zone=${settings.zone}`, '--quiet'];
    try {
      if (action === 'status') {
        // A filtered list distinguishes a missing instance from denied access.
        const result = JSON.parse(await this.command(['compute', 'instances', 'list', `--filter=name=${settings.instance} AND zone:(${settings.zone})`, '--format=json(name,status,zone,machineType)', ...flags.filter(f => !f.startsWith('--zone='))]));
        const vm = result.find((v: {name:string;zone:string}) => v.name === settings.instance && v.zone.split('/').at(-1) === settings.zone);
        return { status: vm ? `${settings.instance}: ${vm.status}${vm.machineType ? ' · ' + vm.machineType.split('/').at(-1) : ''}` : 'VM not found. Create it using the button above.' };
      }
      if (action === 'create') {
        await this.command(['services', 'enable', 'compute.googleapis.com', `--project=${settings.project}`, '--quiet'], 90_000);
        const staging = await mkdtemp(path.join(tmpdir(), 'ccc-vm-'));
        try {
          const script = path.join(staging, 'startup.sh');
          await writeFile(script, startup, {mode:0o600});
          await this.command(['compute','instances','create',settings.instance,...flags,
            `--machine-type=${settings.machineType ?? 'e2-standard-8'}`,'--image-family=debian-12','--image-project=debian-cloud',
            '--boot-disk-size=20GB','--boot-disk-type=pd-balanced','--no-service-account','--no-scopes',
            '--max-run-duration=3600s','--instance-termination-action=STOP',
            `--metadata-from-file=startup-script=${script}`,'--async']);
        } finally { await rm(staging, {recursive:true,force:true}); }
      } else if (action === 'resize') {
        await this.command(['compute','instances','set-machine-type',settings.instance,...flags,`--machine-type=${settings.machineType ?? 'e2-standard-8'}`]);
        return {status:`VM profile changed to ${settings.machineType ?? 'e2-standard-8'}. Start the VM to use it.`};
      } else {
        // Enforce the same one-hour limit when starting an existing stopped VM.
        if (action === 'start') await this.command(['compute','instances','set-scheduling',settings.instance,...flags,'--max-run-duration=3600s','--instance-termination-action=STOP']);
        await this.command(['compute','instances',action,settings.instance,...flags,'--async']);
      }
      return { status: `${action === 'create' ? 'Creation' : action === 'start' ? 'Start' : 'Stop'} requested for ${settings.instance}. Check VM status for completion.` };
    } finally { this.busy = false; }
  }
}
