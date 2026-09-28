import { existsSync } from 'node:fs';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import puppeteer, { type Browser, type Page } from 'puppeteer-core';
import type { AccountModel, AccountStatus, Event, Job } from './cli.js';
import { RunnerError } from './cli.js';

export const DEFAULT_CHATGPT_MODELS: AccountModel[] = [
  { id: 'default', label: 'По умолчанию ChatGPT' }
];

export interface ChatGPTSessionData {
  sessionToken?: string;
  cookies?: Array<{
    name: string;
    value: string;
    domain?: string;
    path?: string;
    expires?: number;
    httpOnly?: boolean;
    secure?: boolean;
    sameSite?: 'Strict' | 'Lax' | 'None';
  }>;
}

export function findChromePath(): string | null {
  if (process.env.CHROME_BIN) return existsSync(process.env.CHROME_BIN) ? process.env.CHROME_BIN : null;
  if (process.env.PUPPETEER_EXECUTABLE_PATH) {
    return existsSync(process.env.PUPPETEER_EXECUTABLE_PATH) ? process.env.PUPPETEER_EXECUTABLE_PATH : null;
  }

  const candidates = [
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/snap/bin/chromium',
    '/usr/bin/chrome'
  ];
  for (const bin of candidates) {
    if (existsSync(bin)) return bin;
  }
  return null;
}

export async function saveChatGPTSession(home: string, data: ChatGPTSessionData): Promise<void> {
  const sessionFile = path.join(home, 'chatgpt-session.json');
  await mkdir(home, { recursive: true, mode: 0o700 });
  await writeFile(sessionFile + '.tmp', JSON.stringify(data, null, 2), { mode: 0o600 });
  await rename(sessionFile + '.tmp', sessionFile);
}

export async function readChatGPTSession(home: string): Promise<ChatGPTSessionData | null> {
  const sessionFile = path.join(home, 'chatgpt-session.json');
  try {
    const raw = await readFile(sessionFile, 'utf8');
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    return parsed as ChatGPTSessionData;
  } catch {
    return null;
  }
}


const profileLocks = new Map<string, Promise<void>>();
async function withProfile<T>(home: string, run: () => Promise<T>): Promise<T> {
  const previous = profileLocks.get(home) || Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>(resolve => { release = resolve; });
  profileLocks.set(home, current);
  await previous;
  try { return await run(); }
  finally { release(); if (profileLocks.get(home) === current) profileLocks.delete(home); }
}

export function parseChatGPTModels(payload: unknown): AccountModel[] {
  const rows = (payload as { models?: unknown })?.models;
  if (!Array.isArray(rows)) throw new RunnerError('ChatGPT не вернул список моделей', 'unavailable');
  const models = new Map<string, AccountModel>();
  for (const row of rows) {
    if (!row || typeof row !== 'object' || row.enabled === false || row.disabled === true) continue;
    const id = row.slug, label = row.title;
    if (typeof id !== 'string' || !id.trim() || id.length > 100 || typeof label !== 'string' || !label.trim() || label.length > 160) continue;
    models.set(id, { id, label });
  }
  if (!models.size) throw new RunnerError('В сессии ChatGPT нет доступных моделей', 'unavailable');
  models.delete('default');
  return [...DEFAULT_CHATGPT_MODELS, ...models.values()];
}

const statusRequests = new Map<string, Promise<AccountStatus>>();

export async function chatgptAccountStatus(home: string, signal: AbortSignal): Promise<AccountStatus> {
  const pending = statusRequests.get(home);
  if (pending) return pending;
  const request = withProfile(home, async () => {
    let models: AccountModel[] = [];
    await executeChatGPTWebInternal({ model: 'default' } as Job, home, '', signal, () => {}, value => { models = value; });
    return { models };
  });
  statusRequests.set(home, request);
  try { return await request; }
  finally { if (statusRequests.get(home) === request) statusRequests.delete(home); }
}

export async function executeChatGPTWeb(job: Job, home: string, cwd: string, signal: AbortSignal, emit: (e: Event) => void): Promise<string> {
  return withProfile(home, () => executeChatGPTWebInternal(job, home, cwd, signal, emit));
}

async function executeChatGPTWebInternal(
  job: Job,
  home: string,
  cwd: string,
  signal: AbortSignal,
  emit: (e: Event) => void,
  onModels?: (models: AccountModel[]) => void
): Promise<string> {
  if (signal.aborted) throw new RunnerError('Остановлено', 'canceled');

  if (onModels && process.env.MOCK_MODE === 'true') { onModels(DEFAULT_CHATGPT_MODELS); return ''; }
  if (process.env.MOCK_MODE === 'true') {
    emit({ type: 'status', message: 'Демо-режим: Chromium эмулируется' });
    const text = `Демо-ответ (ChatGPT Web): «${job.prompt.slice(0, 300)}». Установите Chromium в контейнере runner и авторизуйте сессию через cookies/профиль.`;
    for (const chunk of text.match(/.{1,24}/gu) || [text]) {
      if (signal.aborted) throw new RunnerError('Остановлено', 'canceled');
      emit({ type: 'delta', text: chunk });
      await new Promise(r => setTimeout(r, 10));
    }
    return text;
  }

  const chromePath = findChromePath();
  if (!chromePath) {
    if (!onModels && process.env.MOCK_MODE !== 'false') {
      emit({ type: 'status', message: 'Демо-режим: Chromium не установлен' });
      const text = `Демо-ответ (ChatGPT Web): «${job.prompt.slice(0, 300)}». Установите Chromium в контейнере runner и авторизуйте сессию через cookies/профиль.`;
      for (const chunk of text.match(/.{1,24}/gu) || [text]) {
        if (signal.aborted) throw new RunnerError('Остановлено', 'canceled');
        emit({ type: 'delta', text: chunk });
        await new Promise(r => setTimeout(r, 10));
      }
      return text;
    }
    throw new RunnerError('Chromium не найден в контейнере runner. Обновите образ и пересоздайте контейнер runner.', 'unavailable');
  }

  const profileDir = path.join(home, 'chrome-profile');
  const session = await readChatGPTSession(home);
  const hasSavedAuth = Boolean((session && (session.sessionToken || session.cookies?.length)) || existsSync(profileDir));

  if (!hasSavedAuth) {
    throw new RunnerError('Требуется вход в аккаунт ChatGPT: сохраните session token или cookies в настройках аккаунта', 'auth');
  }

  await mkdir(profileDir, { recursive: true, mode: 0o700 });
  emit({ type: 'status', message: 'Запуск браузера ChatGPT Web...' });

  let browser: Browser | null = null;
  const onAbort = () => {
    if (browser) {
      try { void browser.close(); } catch {}
    }
  };
  signal.addEventListener('abort', onAbort, { once: true });

  try {
    browser = await puppeteer.launch({
      executablePath: chromePath,
      headless: true,
      userDataDir: profileDir,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-blink-features=AutomationControlled',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--no-first-run',
        '--no-default-browser-check',
        '--window-size=1280,800'
      ],
      defaultViewport: { width: 1280, height: 800 }
    });

    if (signal.aborted) throw new RunnerError('Остановлено', 'canceled');

    const pages = await browser.pages();
    const page: Page = pages[0] || await browser.newPage();

    await page.setUserAgent('Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36');

    // Inject session token / cookies if configured
    if (session?.cookies && Array.isArray(session.cookies) && session.cookies.length) {
      for (const cookie of session.cookies) {
        await page.setCookie({
          name: cookie.name,
          value: cookie.value,
          domain: cookie.domain || '.chatgpt.com',
          path: cookie.path || '/',
          httpOnly: cookie.httpOnly ?? true,
          secure: cookie.secure ?? true,
          sameSite: cookie.sameSite || 'Lax'
        });
      }
    } else if (session?.sessionToken) {
      await page.setCookie({
        name: '__Secure-next-auth.session-token',
        value: session.sessionToken,
        domain: '.chatgpt.com',
        path: '/',
        httpOnly: true,
        secure: true,
        sameSite: 'Lax'
      });
    }

    emit({ type: 'status', message: 'Открытие chatgpt.com...' });

    const targetUrl = (job.model && job.model !== 'default')
      ? `https://chatgpt.com/?model=${encodeURIComponent(job.model)}`
      : 'https://chatgpt.com/';

    await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 35000 });

    if (signal.aborted) throw new RunnerError('Остановлено', 'canceled');

    const title = await page.title();
    const bodyText = await page.evaluate(() => document.body?.innerText || '');
    if (title.includes('Just a moment...') || bodyText.includes('Cloudflare') || bodyText.includes('Verify you are human')) {
      throw new RunnerError('Cloudflare заблокировал доступ к chatgpt.com. Для работы на сервере требуется прокси или домашний runner.', 'rate_limit');
    }

    // Dismiss cookie consent banner if present
    try {
      await page.evaluate(() => {
        const allButtons = Array.from(document.querySelectorAll('button'));
        const cookieBtn = allButtons.find(b => {
          const t = (b.innerText || '').toLowerCase();
          return t.includes('accept all') || t.includes('reject non-essential') || t.includes('принять все') || t.includes('отклонить');
        });
        if (cookieBtn) cookieBtn.click();
      });
    } catch {}

    // Wait for the prompt input or detect logged out state
    try {
      await page.waitForSelector('#prompt-textarea, textarea, div[contenteditable="true"]', { timeout: 20000 });
    } catch {
      const isLoggedOut = await page.evaluate(() => {
        return Boolean(document.querySelector('a[href*="/login"], button[data-testid="login-button"], [data-testid="welcome-login-button"]'));
      });
      if (isLoggedOut) {
        throw new RunnerError('Сессия ChatGPT истекла или недействительна. Обновите session token / cookies.', 'auth');
      }
      throw new RunnerError('Интерфейс ChatGPT не загрузился', 'unavailable');
    }

    if (job.model && job.model !== 'default') {
      const isLoggedOut = await page.evaluate(() => {
        return Boolean(document.querySelector('a[href*="/login"], button[data-testid="login-button"], [data-testid="welcome-login-button"]'));
      });
      if (isLoggedOut) {
        throw new RunnerError(`Для использования модели ${job.model} требуется авторизация в ChatGPT. Обновите session token или cookies в настройках аккаунта.`, 'auth');
      }
    }


    // Web-internal endpoint: fail explicitly if the session or contract changes.
    const catalog = await page.evaluate(async () => {
      const auth = await fetch('/api/auth/session', { credentials: 'include', signal: AbortSignal.timeout(15000) });
      if (!auth.ok) return { error: 'auth' };
      const session = await auth.json();
      if (!session.accessToken) return { error: 'auth' };
      const response = await fetch('/backend-api/models', {
        credentials: 'include', headers: { Authorization: 'Bearer ' + session.accessToken },
        signal: AbortSignal.timeout(15000)
      });
      if (!response.ok) return { error: response.status === 401 || response.status === 403 ? 'auth' : 'unavailable' };
      return { payload: await response.json() };
    });
    if (catalog.error) throw new RunnerError('Не удалось получить модели сессии ChatGPT. Проверьте подключение и авторизацию.', catalog.error === 'auth' ? 'auth' : 'unavailable');
    const availableModels = parseChatGPTModels(catalog.payload);
    if (onModels) { onModels(availableModels); return ''; }
    if (job.model && !availableModels.some(m => m.id === job.model)) {
      throw new RunnerError('Выбранная модель больше недоступна в сессии ChatGPT. Обновите список моделей.', 'unavailable');
    }
    emit({ type: 'status', message: 'Отправка сообщения в ChatGPT...' });

    // Focus and fill prompt with ProseMirror compatibility
    const promptInputSelector = '#prompt-textarea, div[contenteditable="true"], textarea';
    await page.focus(promptInputSelector).catch(() => {});

    const inserted = await page.evaluate((promptText) => {
      const el = document.querySelector('#prompt-textarea') || document.querySelector('div[contenteditable="true"]') || document.querySelector('textarea');
      if (!el) return false;
      if (el.tagName === 'TEXTAREA') {
        (el as HTMLTextAreaElement).value = promptText;
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
        return true;
      }
      (el as HTMLElement).focus();
      return document.execCommand('insertText', false, promptText);
    }, job.prompt);

    if (!inserted) {
      await page.keyboard.type(job.prompt, { delay: 0 });
    }

    await new Promise(r => setTimeout(r, 400));

    // Click send or press Enter
    const sent = await page.evaluate(() => {
      const btn = document.querySelector(
        'button[data-testid="send-button"], button[aria-label="Send prompt"], button[data-testid="fruitjuice-send-button"], #composer-submit-button'
      ) as HTMLButtonElement | null;
      if (btn && !btn.disabled) {
        btn.click();
        return true;
      }
      return false;
    });

    if (!sent) {
      await page.focus(promptInputSelector).catch(() => {});
      await page.keyboard.press('Enter');
    }

    emit({ type: 'status', message: 'Генерация ответа ChatGPT...' });

    let fullText = '';
    let lastLength = 0;
    const startTime = Date.now();
    const maxWaitMs = 180000;

    while (!signal.aborted && (Date.now() - startTime < maxWaitMs)) {
      await new Promise(r => setTimeout(r, 250));

      const assistantText = await page.evaluate(() => {
        const messages = document.querySelectorAll('[data-message-author-role="assistant"]');
        if (!messages.length) return '';
        const lastMsg = messages[messages.length - 1];
        const textContainer = lastMsg.querySelector('.markdown') || lastMsg;
        return (textContainer as HTMLElement).innerText || '';
      });

      if (assistantText.length > lastLength) {
        const delta = assistantText.slice(lastLength);
        lastLength = assistantText.length;
        fullText = assistantText;
        emit({ type: 'delta', text: delta });
      }

      const isGenerating = await page.evaluate(() => {
        return Boolean(document.querySelector('button[data-testid="stop-button"], .result-streaming, button[aria-label="Stop generating"]'));
      });

      // Check if page displays an error banner
      const pageError = await page.evaluate(() => {
        const alert = document.querySelector('[role="alert"], [data-testid*="error"], .text-red-500');
        return alert ? (alert as HTMLElement).innerText : null;
      });
      if (pageError && !fullText) {
        throw new RunnerError(`ChatGPT: ${pageError}`, 'failed');
      }

      if (fullText.length > 0 && !isGenerating) {
        await new Promise(r => setTimeout(r, 400));
        const finalText = await page.evaluate(() => {
          const messages = document.querySelectorAll('[data-message-author-role="assistant"]');
          if (!messages.length) return '';
          const lastMsg = messages[messages.length - 1];
          const textContainer = lastMsg.querySelector('.markdown') || lastMsg;
          return (textContainer as HTMLElement).innerText || '';
        });
        if (finalText.length > lastLength) {
          emit({ type: 'delta', text: finalText.slice(lastLength) });
          fullText = finalText;
        }
        break;
      }
    }

    if (signal.aborted) throw new RunnerError('Остановлено', 'canceled');
    if (!fullText.trim()) throw new RunnerError('ChatGPT не вернул ответ', 'failed');
    return fullText;

  } finally {
    signal.removeEventListener('abort', onAbort);
    if (browser) {
      try { await browser.close(); } catch {}
    }
  }
}
