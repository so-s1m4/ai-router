import { Component, inject, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../core/api.service';

type Server = { name: string; url: string; headerNames: string[] };
@Component({
  selector: 'app-personal-mcp',
  standalone: true,
  imports: [FormsModule],
  template: `
    <section class="card form-card">
      <div class="form-card-head">
        <h3>Personal MCP</h3>
        <p>Connect your HTTPS MCP servers to Codex, including when using shared tokens. Settings apply to new tasks. Other users cannot manage these settings.</p>
      </div>
      @if (error()) { <p role="alert">{{ error() }}</p> }
      @if (notice()) { <p role="status">{{ notice() }}</p> }
      @for (server of servers(); track server.name) {
        <div class="server-row">
          <div><strong>{{ server.name }}</strong><p>{{ server.url }}</p></div>
          <button class="btn btn-outline btn-sm" [disabled]="busy()" (click)="edit(server)">Edit</button>
          <button class="btn btn-outline btn-sm" [disabled]="busy()" (click)="remove(server.name)">Remove</button>
        </div>
      } @empty { <p>No personal MCP servers connected.</p> }
      <form (ngSubmit)="save()">
        <label>MCP name<input name="name" [(ngModel)]="name" required pattern="[a-zA-Z0-9_-]{1,50}" [readOnly]="editing" placeholder="my-server"></label>
        <label>HTTPS URL<input name="url" [(ngModel)]="url" required type="url" placeholder="https://example.com/mcp"></label>
        <p>HTTP headers, such as Authorization → Bearer token. Editing replaces all saved headers; enter their values again.</p>
        @for (row of headers; track row; let i = $index) {
          <div class="header-row">
            <input [name]="'key'+i" [(ngModel)]="row.key" placeholder="Authorization" aria-label="Header name" autocomplete="off">
            <input [name]="'value'+i" [(ngModel)]="row.value" type="password" placeholder="Bearer token" aria-label="Header value" autocomplete="new-password">
            <button type="button" class="btn btn-outline btn-sm" (click)="headers.splice(i,1)">Remove</button>
          </div>
        }
        <div class="actions">
          <button type="button" class="btn btn-outline btn-sm" [disabled]="headers.length >= 30" (click)="headers.push({key:'',value:''})">Add header</button>
          <button type="submit" class="btn btn-primary btn-sm" [disabled]="busy() || !name.trim() || !url.trim()">{{ editing ? 'Save MCP' : 'Add MCP' }}</button>
          @if (editing) { <button type="button" class="btn btn-outline btn-sm" (click)="reset()">Cancel</button> }
        </div>
      </form>
    </section>
  `,
  styles: `:host { display:block; margin:24px 0; } label { display:block; margin:12px 0; } input { display:block; width:100%; padding:10px; margin-top:6px; box-sizing:border-box; } .server-row,.header-row,.actions { display:flex; gap:10px; align-items:center; margin:12px 0; flex-wrap:wrap; } .server-row > div { flex:1; min-width:180px; overflow-wrap:anywhere; } .header-row input { flex:1; min-width:150px; } p { overflow-wrap:anywhere; }`,
})
export class PersonalMcpComponent implements OnInit {
  private readonly api = inject(ApiService);
  servers = signal<Server[]>([]);
  busy = signal(false);
  error = signal('');
  notice = signal('');
  name = '';
  url = '';
  editing = false;
  headers: {key:string;value:string}[] = [];
  async ngOnInit() {
    try { this.servers.set(await this.api.request<Server[]>('/personal-mcp')); }
    catch (error) { this.error.set((error as Error).message); }
  }
  edit(server: Server) {
    this.name = server.name; this.url = server.url; this.editing = true;
    this.headers = server.headerNames.map(key => ({key, value:''}));
    this.error.set(''); this.notice.set('');
  }
  reset() { this.name = ''; this.url = ''; this.headers = []; this.editing = false; }
  async save() {
    if (this.busy()) return;
    const rows = this.headers.filter(row => row.key.trim() || row.value);
    if (rows.some(row => !row.key.trim() || !row.value) || new Set(rows.map(row => row.key.trim().toLowerCase())).size !== rows.length) {
      this.error.set('Provide a unique name and a value for each header'); return;
    }
    await this.change('/personal-mcp/' + encodeURIComponent(this.name.trim()), 'PUT', {
      url:this.url.trim(), headers:Object.fromEntries(rows.map(row => [row.key.trim(),row.value])),
    });
  }
  async remove(name: string) { await this.change('/personal-mcp/' + encodeURIComponent(name), 'DELETE'); }
  private async change(path: string, method: string, body?: unknown) {
    if (this.busy()) return;
    this.busy.set(true); this.error.set(''); this.notice.set('');
    try {
      this.servers.set(await this.api.request<Server[]>(path, {method, body:body === undefined ? undefined : JSON.stringify(body)}));
      this.reset(); this.notice.set('Personal MCP settings saved. Start a new Codex task to apply them.');
    } catch (error) { this.error.set((error as Error).message); }
    finally { this.busy.set(false); }
  }
}
