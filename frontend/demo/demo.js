/* This script is included only in the standalone UI demo build. */
(() => {
  const inHours = hours => new Date(Date.now() + hours * 3600000).toISOString();
  const usage = (usedPercent, windowMinutes, hours) => ({
    usedPercent, remainingPercent: 100 - usedPercent, windowMinutes, resetAt: inHours(hours),
  });
  const limit = () => ({source: 'unknown', primary: null, secondary: null, cooldownUntil: null, updatedAt: null});
  let accounts = [
    {id: 'codex-personal', name: 'Personal Codex', provider: 'codex', runnerId: 'demo-runner', mode: 'runner', auth: 'ready', detail: 'Development runner', priority: 2, models: [],
      limit: {...limit(), source: 'provider', primary: usage(24, 300, 3), secondary: usage(41, 10080, 80), updatedAt: new Date().toISOString(), resetCredits: {availableCount: 2, credits: [{id: 'reset-1', title: 'Account reset', expiresAt: inHours(48)}, {id: 'reset-2', title: 'Account reset', expiresAt: inHours(96)}]}}},
    {id: 'codex-team', name: 'Team Codex', provider: 'codex', runnerId: 'demo-runner', mode: 'runner', auth: 'ready', detail: 'Development runner', priority: 1, models: [],
      limit: {...limit(), source: 'provider', primary: usage(100, 300, 1), secondary: usage(85, 10080, 40), cooldownUntil: inHours(1), resetCredits: {availableCount: 1, credits: [{id: 'reset-3', title: 'Account reset', expiresAt: inHours(72)}]}}},
    {id: 'gemini', name: 'Gemini workspace', provider: 'antigravity', runnerId: 'demo-runner', mode: 'runner', auth: 'ready', detail: 'Development runner', priority: 1, models: [], limit: limit()},
    {id: 'openai-api', name: 'OpenAI API', provider: 'codex', authType: 'api_key', runnerId: 'demo-runner', mode: 'runner', auth: 'ready', detail: 'Development runner', priority: 0, models: [], limit: limit()},
    {id: 'chatgpt', name: 'ChatGPT browser', provider: 'chatgpt', runnerId: 'demo-runner', mode: 'runner', auth: 'ready', detail: 'Development runner', priority: 1, models: [], limit: limit()},
    {id: 'shared', name: 'Shared Codex', provider: 'codex', shared: true, mode: 'runner', auth: 'ready', detail: 'Shared by teammate', models: [], limit: {...limit(), source: 'provider', primary: usage(55, 300, 2)}},
    {id: 'unassigned', name: 'New Gemini connection', provider: 'antigravity', mode: 'unassigned', auth: 'unknown', detail: 'No runner assigned', priority: 1, models: [], limit: limit()},
  ];
  accounts.push({id: 'openrouter-api', name: 'OpenRouter API', provider: 'openrouter', authType: 'api_key', runnerId: 'demo-runner', mode: 'runner', auth: 'ready', detail: 'Demo connection', priority: 1, models: [{id: 'openrouter/auto', name: 'Auto'}, {id: 'openai/gpt-4.1', name: 'GPT-4.1'}, {id: 'anthropic/claude-sonnet-4', name: 'Claude Sonnet 4'}], limit: limit()});
  for (const account of accounts.filter(a => a.provider === 'codex')) account.models = [{id: 'gpt-6.1-sol', name: 'GPT-6.1 Sol'}];
  for (const account of accounts) for (const model of account.models || []) {
    model.label = model.label || model.name || model.id;
    if (account.provider === 'codex') { model.reasoning = ['low','medium','high','xhigh'].map(id => ({id,label:id.charAt(0).toUpperCase()+id.slice(1)})); model.defaultReasoning = 'medium'; }
  }
  let cccSettings = {
    version: 1, submissionIntervalSeconds: 1, rateLimitRetries: 5, rateLimitDelaySeconds: 1,
    solutionAttempts: 3, preparationRetries: 2, optimizationEnabled: true, optimizationDelaySeconds: 10,
    reuseThreads: true, startLevel: 1, endLevel: null, extraInstructions: '',
    levels: [1, 2, 3, 4, 5].map(from => ({from, to: from === 5 ? null : from,
      candidates: ['low', 'medium', 'high'].map((reasoning, i) => ({id: ['light', 'medium', 'high'][i],
        enabled: true, provider: 'codex', model: 'gpt-6.1-sol', reasoning,
        delaySeconds: i === 2 ? 20 : 0, mode: 'code', fast: true}))})),
  };
  const runners = [{id: 'demo-runner', name: 'Development runner', online: true, managementOnline: true}];
  const projects = ['AI Router', 'Website', 'Research'].map((name, i) => ({
    id: 'demo-project-' + i, name, runnerId: 'demo-runner', createdAt: inHours(-48), updatedAt: inHours(-i),
  }));
  let sessions = [
    ['Huawei browser support', 'demo-project-0'],
    ['Make the project sidebar easier to navigate', 'demo-project-0'],
    ['Model routing rules', 'demo-project-0'],
    ['Mobile layout improvements', 'demo-project-0'],
    ['Install the web app', 'demo-project-0'],
    ['Review the latest changes', 'demo-project-0'],
    ['Landing page ideas', 'demo-project-1'],
    ['Compare available models', null],
  ].map(([title, projectId], i) => ({
    id: 'demo-chat-' + i, title, projectId, updatedAt: inHours(-i),
    messages: [{id: 'demo-message-' + i, role: 'assistant', at: inHours(-i),
      text: 'This is a sample chat. Explore the project sidebar, expand a project, or open a chat menu. Demo changes reset when you reload.'}],
  }));
  const originalFetch = window.fetch.bind(window);
  const response = (body, status = 200) => new Response(JSON.stringify(body), {status, headers: {'Content-Type': 'application/json'}});
  window.fetch = async (input, options = {}) => {
    const url = new URL(typeof input === 'string' ? input : input.url, location.href);
    if (!url.pathname.startsWith('/api/')) return originalFetch(input, options);
    const path = url.pathname.slice(4);
    const method = options.method || 'GET';
    const body = options.body ? JSON.parse(options.body) : {};
    if (['/me', '/login', '/register'].includes(path)) return response({username: 'UI Demo', isOwner: false});
    if (path === '/ccc-auto/settings') {
      if (method === 'PUT') cccSettings = body;
      return response(cccSettings);
    }
    if (path === '/ccc-auto/settings/validate') return response(body);
    if (path === '/accounts') {
      if (method === 'POST') accounts.push({...body, id: crypto.randomUUID(), mode: body.runnerId ? 'runner' : 'unassigned', auth: 'ready', detail: 'Demo connection', models: [], limit: limit()});
      return response(accounts);
    }
    if (path === '/runners') return response(runners);
    if (path === '/user/model-blacklist') return response({blacklist: []});
    const match = path.match(/^\/accounts\/([^/]+)(?:\/(.*))?$/);
    if (match) {
      const a = accounts.find(a => a.id === match[1]);
      if (!a) return response({error: 'Demo account not found'}, 404);
      if (method === 'DELETE') accounts = accounts.filter(item => item !== a);
      else if (match[2] === 'priority') a.priority = body.priority;
      else if (match[2] === 'reset') {
        if (!a.limit.resetCredits?.availableCount) return response({outcome: 'noCredit'});
        a.limit.resetCredits.availableCount--;
        a.limit.resetCredits.credits.shift();
        a.limit.cooldownUntil = null;
        for (const window of [a.limit.primary, a.limit.secondary]) if (window) {window.usedPercent = 0; window.remainingPercent = 100;}
        return response({outcome: 'reset'});
      } else if (match[2] === 'api-key' || match[2] === 'chatgpt-session') {
        // Submitted credentials are discarded; nothing leaves this browser.
        a.auth = 'ready';
      } else if (method === 'PATCH') {a.runnerId = body.runnerId; a.mode = 'runner'; a.detail = 'Development runner';}
      return response({ok: true});
    }
    if (method === 'GET' && path === '/projects') return response(projects);
    if (method === 'GET' && path === '/sessions') return response(sessions);
    const sessionMatch = path.match(/^\/sessions\/([^/]+)$/);
    if (sessionMatch) {
      const session = sessions.find(item => item.id === sessionMatch[1]);
      if (!session) return response({error: 'Demo chat not found'}, 404);
      if (method === 'DELETE') {
        sessions = sessions.filter(item => item.id !== session.id);
        return response({ok: true});
      }
      if (method === 'GET') return response(session);
    }
    if (method === 'GET' && (['/access-grants'].includes(path) || /\/previews$/.test(path))) return response([]);
    return response({error: 'This action is unavailable in the UI demo.'}, 400);
  };
  if (location.pathname === '/') history.replaceState(null, '', '/chats?session=demo-chat-0');
  document.addEventListener('DOMContentLoaded', () => {
    const label = document.createElement('div');
    label.textContent = 'UI demo · sample data · reload to reset';
    Object.assign(label.style, {position: 'fixed', bottom: '8px', right: '8px', zIndex: '50', padding: '7px 12px', borderRadius: '8px', background: '#222f49', color: '#cdd9ff', font: '12px system-ui', pointerEvents: 'none'});
    document.body.append(label);
  });
})();
