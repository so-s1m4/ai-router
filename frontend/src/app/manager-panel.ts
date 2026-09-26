import { CommonModule } from '@angular/common';
import { Component, EventEmitter, Input, OnDestroy, Output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { LucideArrowLeft, LucideCopy, LucideKeyRound, LucidePlus, LucideRefreshCw, LucideSettings2, LucideTrash2, LucideX } from '@lucide/angular';

type Runner = { id: string; name: string; managementOnline: boolean };
type Account = { id: string; name: string; provider: 'codex' | 'antigravity'; runnerId?: string };
type Key = { id: string; label: string; publicKey: string; fingerprint: string };
type Container = { id: string; name: string; image: string; state: string; status: string; composeProject: string | null };
type Mount = { type: 'bind' | 'volume'; source: string; target: string; readOnly: boolean };
type Details = { id: string; name: string; image: string; state: string; envNames: string[]; mounts: Mount[]; ports: Record<string, unknown>; labels: Record<string, string> };
type Mcp = { name: string; url: string | null; command: string | null; args: string[]; envNames: string[]; enabled: boolean };
type Auth = { sessionId: string; running: boolean; code?: number; output: string; accountId: string };
type Overview = { keys: Key[]; containers: Container[]; dockerError: string | null };
type Pairing = { code: string; expiresAt: string };

@Component({
  selector: 'app-manager-panel', standalone: true,
  imports: [CommonModule, FormsModule, LucideArrowLeft, LucideCopy, LucideKeyRound, LucidePlus, LucideRefreshCw, LucideSettings2, LucideTrash2, LucideX],
  templateUrl: './manager-panel.html', styleUrl: './manager-panel.css'
})
export class ManagerPanel implements OnDestroy {
  @Input({ required: true }) runner!: Runner;
  @Input({ required: true }) accounts: Account[] = [];
  @Output() close = new EventEmitter<void>();
  password = ''; unlocked = signal(false); busy = signal(false); error = signal(''); notice = signal('');
  pairing = signal<Pairing | null>(null); tab = signal<'keys' | 'containers' | 'mcp' | 'accounts'>('keys');
  keys = signal<Key[]>([]); containers = signal<Container[]>([]); dockerError = signal<string | null>(null); details = signal<Details | null>(null);
  keyLabel = ''; githubResult = signal('');
  image = ''; envRows: { key: string; value: string }[] = []; envUnset = new Set<string>();
  mountRows: { type: 'bind' | 'volume'; source: string; target: string; readOnly: boolean }[] = []; mountRemove = new Set<string>();
  selectedAccountId = ''; mcp = signal<Mcp[]>([]); mcpName = ''; mcpKind: 'url' | 'command' = 'url'; mcpUrl = ''; mcpCommand = ''; mcpArgs = ''; mcpEnvRows: { key: string; value: string }[] = [];
  loginSession = signal<Auth | null>(null); private pollTimer?: ReturnType<typeof setTimeout>;
  get localAccounts() { return this.accounts.filter(account => account.runnerId === this.runner.id); }
  get selectedAccount() { return this.localAccounts.find(account => account.id === this.selectedAccountId); }
  ngOnDestroy() { this.password = ''; if (this.pollTimer) clearTimeout(this.pollTimer); }

  private async api<T>(suffix: string, body: unknown): Promise<T> {
    const response = await fetch(`/api/runners/${this.runner.id}/management/${suffix}`, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const value = await response.json();
    if (!response.ok) throw new Error(value.error || 'Runner не ответил');
    return value as T;
  }
  private base64url(bytes: Uint8Array) { let raw = ''; for (const byte of bytes) raw += String.fromCharCode(byte); return btoa(raw).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); }
  private decode(value: string) { const raw = atob(value.replace(/-/g, '+').replace(/_/g, '/')); return Uint8Array.from(raw, char => char.charCodeAt(0)); }
  private async signed<T>(op: string, payload: Record<string, unknown> = {}): Promise<T> {
    const challenge = await this.api<{ nonce: string; salt: string; iterations: number; error?: string }>('challenge', {});
    if (challenge.error) throw new Error(challenge.error);
    if (!challenge.nonce || this.decode(challenge.salt).length !== 16 || !Number.isInteger(challenge.iterations) || challenge.iterations < 200_000 || challenge.iterations > 500_000) throw new Error('Неверный ответ сервиса управления');
    const passwordKey = await crypto.subtle.importKey('raw', new TextEncoder().encode(this.password), 'PBKDF2', false, ['deriveBits']);
    const keyBytes = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt: this.decode(challenge.salt), iterations: challenge.iterations, hash: 'SHA-256' }, passwordKey, 256);
    const hmacKey = await crypto.subtle.importKey('raw', keyBytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    const message = new TextEncoder().encode(JSON.stringify({ nonce: challenge.nonce, op, payload }));
    const proof = this.base64url(new Uint8Array(await crypto.subtle.sign('HMAC', hmacKey, message)));
    const result = await this.api<{ ok: boolean; data: T; error?: string }>('action', { nonce: challenge.nonce, proof, op, payload });
    if (!result.ok) throw new Error(result.error || 'Действие не выполнено');
    return result.data;
  }
  private async operation<T>(op: string, payload: Record<string, unknown> = {}, success = ''): Promise<T | undefined> {
    this.busy.set(true); this.error.set(''); this.notice.set('');
    try { const value = await this.signed<T>(op, payload); if (success) this.notice.set(success); return value; }
    catch (error) { this.error.set(error instanceof Error ? error.message : 'Ошибка'); return undefined; }
    finally { this.busy.set(false); }
  }
  async getPairing() { try { this.pairing.set(await this.api<Pairing>('pairing', {})); } catch (error) { this.error.set((error as Error).message); } }
  async unlock() { if (!this.password) return; const overview = await this.operation<Overview>('overview'); if (overview) { this.unlocked.set(true); this.applyOverview(overview); } }
  lock() { this.password = ''; this.unlocked.set(false); this.details.set(null); if (this.pollTimer) clearTimeout(this.pollTimer); }
  private applyOverview(value: Overview) { this.keys.set(value.keys); this.containers.set(value.containers); this.dockerError.set(value.dockerError); }
  async refresh() { const value = await this.operation<Overview>('overview'); if (value) this.applyOverview(value); }
  async copy(value: string) { await navigator.clipboard.writeText(value); this.notice.set('Скопировано'); }
  async createKey() { const value = await this.operation<Key>('keys.create', { label: this.keyLabel.trim() }, 'Ключ создан. Добавьте публичный ключ в GitHub.'); if (value) { this.keyLabel = ''; await this.refresh(); } }
  async deleteKey(id: string) { if (!confirm('Удалить эту ключевую пару? Доступ к репозиториям через неё прекратится.')) return; const value = await this.operation('keys.delete', { id }, 'Ключ удалён'); if (value) await this.refresh(); }
  async testGithub() { const value = await this.operation<{ connected: boolean; message: string }>('github.test'); if (value) this.githubResult.set(value.message); }
  async openContainer(id: string) { const value = await this.operation<Details>('containers.inspect', { id }); if (value) { this.details.set(value); this.image = value.image; this.envRows = []; this.envUnset.clear(); this.mountRows = []; this.mountRemove.clear(); } }
  async control(kind: 'start' | 'stop' | 'restart' | 'remove', id: string) {
    if ((kind === 'stop' || kind === 'remove') && !confirm(kind === 'remove' ? 'Удалить остановленный контейнер? Его файловый слой будет потерян.' : 'Остановить контейнер?')) return;
    const value = await this.operation(`containers.${kind}`, { id }, 'Команда Docker выполнена');
    if (value) { this.details.set(null); await this.refresh(); }
  }
  async recreate() {
    const current = this.details(); if (!current) return;
    if (!confirm(`Пересоздать ${current.name}? Контейнер временно остановится; старый останется резервной копией.`)) return;
    const envSet = Object.fromEntries(this.envRows.filter(row => row.key.trim()).map(row => [row.key.trim(), row.value]));
    const value = await this.operation<{ backup: string }>('containers.recreate', { id: current.id, image: this.image.trim(), envSet, envUnset: [...this.envUnset], mountsAdd: this.mountRows.filter(row => row.source.trim() && row.target.trim()), mountsRemove: [...this.mountRemove] }, 'Контейнер пересоздан');
    if (value) { this.notice.set(`Контейнер пересоздан. Резервная копия: ${value.backup}`); this.details.set(null); await this.refresh(); }
  }
  toggleEnv(name: string, checked: boolean) { checked ? this.envUnset.add(name) : this.envUnset.delete(name); }
  toggleMount(target: string, checked: boolean) { checked ? this.mountRemove.add(target) : this.mountRemove.delete(target); }
  async loadMcp() { const account = this.selectedAccount; if (!account) return; const value = await this.operation<Mcp[]>('mcp.list', { accountId: account.id, provider: account.provider }); if (value) this.mcp.set(value); }
  async addMcp() {
    const account = this.selectedAccount; if (!account) return;
    const payload: Record<string, unknown> = { accountId: account.id, provider: account.provider, name: this.mcpName.trim() };
    if (this.mcpKind === 'url') payload['url'] = this.mcpUrl.trim();
    else { payload['command'] = this.mcpCommand.trim(); payload['args'] = this.mcpArgs.split('\n').map(value => value.trim()).filter(Boolean); payload['env'] = Object.fromEntries(this.mcpEnvRows.filter(row => row.key.trim()).map(row => [row.key.trim(), row.value])); }
    const value = await this.operation<Mcp[]>('mcp.add', payload, 'MCP-сервер добавлен');
    if (value) { this.mcp.set(value); this.mcpName = ''; this.mcpUrl = ''; this.mcpCommand = ''; this.mcpArgs = ''; this.mcpEnvRows = []; }
  }
  async removeMcp(name: string) { const account = this.selectedAccount; if (!account || !confirm(`Удалить MCP «${name}»?`)) return; const value = await this.operation<Mcp[]>('mcp.remove', { accountId: account.id, provider: account.provider, name }, 'MCP-сервер удалён'); if (value) this.mcp.set(value); }
  async startLogin() { const account = this.selectedAccount; if (!account) return; const value = await this.operation<{ sessionId: string }>('auth.start', { accountId: account.id, provider: account.provider }); if (value) { this.loginSession.set({ sessionId: value.sessionId, accountId: account.id, running: true, output: '' }); this.schedulePoll(); } }
  private schedulePoll() { if (this.pollTimer) clearTimeout(this.pollTimer); this.pollTimer = setTimeout(() => void this.pollLogin(), 1500); }
  private async pollLogin() { const session = this.loginSession(); if (!session) return; try { const value = await this.signed<Auth>('auth.status', { sessionId: session.sessionId }); this.loginSession.set(value); if (value.running) this.schedulePoll(); else if (value.code === 0) this.notice.set('Вход выполнен. Статус аккаунта обновится в течение минуты.'); } catch (error) { this.error.set((error as Error).message); } }
  async cancelLogin() { const session = this.loginSession(); if (!session) return; const value = await this.operation('auth.cancel', { sessionId: session.sessionId }); if (value) { if (this.pollTimer) clearTimeout(this.pollTimer); this.loginSession.set(null); } }
}
