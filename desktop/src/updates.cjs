// Release checks run only in the trusted main process. Installation stays manual.
const repository = 'so-s1m4/ai-router';
function version(value) {
  const match = /^(?:desktop-v)?(\d+)\.(\d+)\.(\d+)$/.exec(value);
  return match ? match.slice(1).map(Number) : null;
}
function newer(candidate, current) {
  const a = version(candidate), b = version(current);
  if (!a || !b) return false;
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] > b[i];
  return false;
}
function createUpdates({ app, dialog, openExternal, fetchRelease = fetch, platform = process.platform, arch = process.arch, schedule = setInterval, cancel = clearInterval }) {
  let timer, checking = false, notified;
  const enabled = app.isPackaged && platform === 'darwin';
  const notify = message => dialog.showMessageBox({ type: 'info', title: 'AI Router · Обновления', message });
  async function check(manual = false) {
    if (!enabled) { if (manual) await notify('Проверка обновлений доступна в установленном приложении для macOS.'); return; }
    if (checking) return;
    checking = true;
    try {
      const response = await fetchRelease(`https://api.github.com/repos/${repository}/releases?per_page=100`, {
        headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'AI-Router-Desktop' }, signal: AbortSignal.timeout(15000)
      });
      if (!response.ok) throw Error('Release request failed');
      const releases = await response.json();
      if (!Array.isArray(releases)) throw Error('Invalid releases');
      const candidates = releases.filter(release => !release.draft && !release.prerelease && newer(release.tag_name, app.getVersion()))
        .sort((a, b) => newer(a.tag_name, b.tag_name) ? -1 : newer(b.tag_name, a.tag_name) ? 1 : 0);
      let available;
      for (const release of candidates) {
        const number = release.tag_name.replace('desktop-v', '');
        const name = `AI-Router-${number}-${arch}.dmg`;
        const url = `https://github.com/${repository}/releases/download/${release.tag_name}/${name}`;
        if (release.assets?.some(asset => asset.name === name && asset.browser_download_url === url)) {
          available = { number, url }; break;
        }
      }
      if (!available) { if (manual) await notify('Установлена последняя доступная версия.'); return; }
      if (!manual && notified === available.number) return;
      notified = available.number;
      const result = await dialog.showMessageBox({ type: 'info', title: 'AI Router · Обновления',
        message: `Доступна версия ${available.number}`,
        detail: 'Скачайте DMG, откройте его и замените AI Router в папке «Программы». Перед заменой завершите приложение через Cmd+Q.',
        buttons: ['Скачать DMG', 'Позже'], defaultId: 1, cancelId: 1 });
      if (result.response === 0) await openExternal(available.url);
    } catch {
      if (manual) await notify('Не удалось проверить обновления. Проверьте интернет и повторите попытку.');
    } finally { checking = false; }
  }
  return {
    check,
    start() { if (!enabled || timer) return; void check(); timer = schedule(() => { void check(); }, 4 * 60 * 60 * 1000); timer.unref?.(); },
    dispose() { if (timer) cancel(timer); timer = undefined; }
  };
}
module.exports = { createUpdates };
