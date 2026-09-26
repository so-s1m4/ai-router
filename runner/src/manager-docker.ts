import http from 'node:http';

const socketPath = process.env.DOCKER_SOCKET_PATH || '/var/run/docker.sock';

async function request(method: string, route: string, body?: unknown, maxBytes = 4_000_000, timeoutMs = 30_000): Promise<any> {
  const data = body === undefined ? undefined : Buffer.from(JSON.stringify(body));
  return new Promise((resolve, reject) => {
    const req = http.request({ socketPath, method, path: `/v1.45${route}`, timeout: timeoutMs, headers: data ? { 'Content-Type': 'application/json', 'Content-Length': data.length } : {} }, res => {
      const chunks: Buffer[] = []; let bytes = 0;
      res.on('data', (chunk: Buffer) => { bytes += chunk.length; if (bytes > maxBytes) { req.destroy(new Error('Ответ Docker слишком большой')); return; } chunks.push(chunk); });
      res.on('end', () => { const raw = Buffer.concat(chunks).toString('utf8'); let value: any; try { value = raw ? JSON.parse(raw) : {}; } catch { value = { message: raw }; } if ((res.statusCode || 500) >= 400) reject(new Error(String(value.message || `Docker HTTP ${res.statusCode}`).slice(0, 400))); else resolve(value); });
    });
    req.on('timeout', () => req.destroy(new Error('Docker не ответил')));
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

const containerPath = (id: string) => {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,127}$/.test(id)) throw new Error('Неверный ID контейнера');
  return `/containers/${encodeURIComponent(id)}`;
};
function assertNotSelf(row: any) {
  const hostname = process.env.HOSTNAME;
  if (hostname && hostname.length >= 12 && String(row.Id || '').startsWith(hostname)) throw new Error('Контейнер управления нельзя изменить из его собственной сессии');
}

export async function listContainers() {
  const rows = await request('GET', '/containers/json?all=1');
  return (rows as any[]).map(row => ({ id: row.Id, name: (row.Names?.[0] || '').replace(/^\//, ''), image: row.Image, state: row.State, status: row.Status, composeProject: row.Labels?.['com.docker.compose.project'] || null }));
}

export async function inspectContainer(id: string) {
  const row = await request('GET', `${containerPath(id)}/json`);
  return { id: row.Id, name: String(row.Name || '').replace(/^\//, ''), image: row.Config?.Image, state: row.State?.Status, envNames: (row.Config?.Env || []).map((value: string) => value.split('=', 1)[0]), mounts: (row.Mounts || []).map((mount: any) => ({ type: mount.Type, source: mount.Name || mount.Source, target: mount.Destination, readOnly: !mount.RW })), ports: row.HostConfig?.PortBindings || {}, restartPolicy: row.HostConfig?.RestartPolicy || {}, labels: row.Config?.Labels || {} };
}

export async function controlContainer(op: 'start' | 'stop' | 'restart' | 'remove', id: string) {
  const route = containerPath(id);
  assertNotSelf(await request('GET', `${route}/json`));
  if (op === 'remove') return request('DELETE', `${route}?v=0&force=0`);
  return request('POST', `${route}/${op}${op === 'stop' ? '?t=10' : ''}`);
}

const configKeys = ['Hostname', 'Domainname', 'User', 'AttachStdin', 'AttachStdout', 'AttachStderr', 'Tty', 'OpenStdin', 'StdinOnce', 'Env', 'Cmd', 'Image', 'Volumes', 'WorkingDir', 'Entrypoint', 'NetworkDisabled', 'MacAddress', 'Labels', 'StopSignal', 'StopTimeout', 'Shell', 'Healthcheck', 'ExposedPorts'];
const hostKeys = ['Binds', 'PortBindings', 'RestartPolicy', 'NetworkMode', 'Privileged', 'CapAdd', 'CapDrop', 'SecurityOpt', 'Devices', 'AutoRemove', 'ReadonlyRootfs', 'ExtraHosts', 'Dns', 'DnsSearch', 'LogConfig', 'Memory', 'NanoCpus', 'PidsLimit', 'GroupAdd', 'Tmpfs', 'VolumesFrom', 'IpcMode', 'PidMode', 'UsernsMode', 'ShmSize', 'Init', 'Ulimits', 'DeviceRequests', 'CgroupParent', 'CpuShares', 'CpusetCpus', 'OomKillDisable', 'OomScoreAdj', 'Sysctls', 'Runtime'];
function pick(source: Record<string, unknown>, keys: string[]) { return Object.fromEntries(keys.filter(key => source[key] !== undefined && source[key] !== null).map(key => [key, source[key]])); }

export type RecreatePatch = { image?: string; envSet?: Record<string, string>; envUnset?: string[]; mountsAdd?: { type: 'bind' | 'volume'; source: string; target: string; readOnly?: boolean }[]; mountsRemove?: string[] };

async function pullImage(image: string) {
  const response = await request('POST', `/images/create?fromImage=${encodeURIComponent(image)}`, undefined, 20_000_000, 600_000);
  if (typeof response.message === 'string') for (const line of response.message.split('\n')) {
    try { const event = JSON.parse(line); if (event.error) throw new Error(String(event.error).slice(0, 400)); }
    catch (error) { if (error instanceof SyntaxError) continue; throw error; }
  }
}

export async function recreateContainer(id: string, patch: RecreatePatch) {
  const old = await request('GET', `${containerPath(id)}/json`);
  assertNotSelf(old);
  const name = String(old.Name || '').replace(/^\//, '');
  if (!name || name === process.env.HOSTNAME || old.Id === process.env.HOSTNAME) throw new Error('Этот контейнер нельзя пересоздать отсюда');
  if (old.HostConfig?.AutoRemove) throw new Error('Контейнер с AutoRemove нельзя безопасно пересоздать');
  const config: any = pick(old.Config || {}, configKeys);
  const host: any = pick(old.HostConfig || {}, hostKeys);
  if (patch.image) config.Image = patch.image;
  const env = new Map<string, string>((config.Env || []).map((entry: string) => [entry.split('=', 1)[0], entry.slice(entry.indexOf('=') + 1)]));
  for (const key of patch.envUnset || []) env.delete(key);
  for (const [key, value] of Object.entries(patch.envSet || {})) env.set(key, value);
  config.Env = [...env].map(([key, value]) => `${key}=${value}`);
  const mounts = (old.Mounts || []).filter((mount: any) => !['/etc/hosts', '/etc/hostname', '/etc/resolv.conf'].includes(mount.Destination)).map((mount: any) => ({ Type: mount.Type, Source: mount.Type === 'volume' ? mount.Name : mount.Source, Target: mount.Destination, ReadOnly: !mount.RW }));
  const remove = new Set(patch.mountsRemove || []);
  host.Mounts = mounts.filter((mount: any) => !remove.has(mount.Target));
  for (const mount of patch.mountsAdd || []) { host.Mounts = host.Mounts.filter((existing: any) => existing.Target !== mount.target); host.Mounts.push({ Type: mount.type, Source: mount.source, Target: mount.target, ReadOnly: !!mount.readOnly }); }
  delete host.Binds;
  if (patch.image && patch.image !== old.Config?.Image) await pullImage(patch.image);
  const wasRunning = old.State?.Running === true;
  const backup = `${name}.ai-router-backup-${Date.now()}`;
  let replacement: string | undefined;
  if (wasRunning) await request('POST', `${containerPath(id)}/stop?t=15`);
  await request('POST', `${containerPath(id)}/rename?name=${encodeURIComponent(backup)}`);
  try {
    const oldNetworks = old.NetworkSettings?.Networks || {};
    const primaryNetwork = Object.keys(oldNetworks).find(network => network === host.NetworkMode || (host.NetworkMode === 'default' && network === 'bridge'));
    const aliases = primaryNetwork ? (oldNetworks[primaryNetwork]?.Aliases || []).filter((alias: string) => alias !== old.Id?.slice(0, 12)) : [];
    const networking = primaryNetwork ? { EndpointsConfig: { [primaryNetwork]: { Aliases: aliases } } } : undefined;
    const created = await request('POST', `/containers/create?name=${encodeURIComponent(name)}`, { ...config, HostConfig: host, NetworkingConfig: networking });
    if (typeof created.Id !== 'string') throw new Error('Docker не вернул ID нового контейнера');
    replacement = created.Id;
    for (const [network, settings] of Object.entries(oldNetworks) as [string, any][]) {
      if (network === primaryNetwork) continue;
      await request('POST', `/networks/${encodeURIComponent(network)}/connect`, { Container: replacement, EndpointConfig: { Aliases: (settings.Aliases || []).filter((alias: string) => alias !== old.Id?.slice(0, 12)) } });
    }
    if (wasRunning) await request('POST', `${containerPath(replacement!)}/start`);
    return { id: replacement, name, backup, image: config.Image, running: wasRunning };
  } catch (error) {
    if (replacement) try { await request('DELETE', `${containerPath(replacement)}?force=1&v=0`); } catch {}
    await request('POST', `${containerPath(old.Id)}/rename?name=${encodeURIComponent(name)}`);
    if (wasRunning) await request('POST', `${containerPath(old.Id)}/start`);
    throw error;
  }
}
