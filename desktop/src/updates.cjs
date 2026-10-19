// Only the trusted main process can check for or install application updates.
function createUpdates({ app, dialog, stopProcesses, updater, platform = process.platform, schedule = setInterval, cancel = clearInterval }) {
  let timer, checking = false, downloaded = false, installing = false;
  const enabled = app.isPackaged && platform === 'darwin';
  const notify = message => dialog.showMessageBox({ type: 'info', title: 'AI Router · Обновления', message });
  if (enabled) {
    updater ||= require('electron-updater').autoUpdater;
    updater.autoDownload = true;
    updater.autoInstallOnAppQuit = true;
    updater.allowPrerelease = false;
    updater.allowDowngrade = false;
    // Background failures must not interrupt chats. A manual check shows the error.
    updater.on('error', () => {});
    updater.on('update-downloaded', () => {
      downloaded = true;
      void notify('Обновление загружено и установится при выходе из приложения. Для установки сейчас выберите «Установить обновление и перезапустить» в меню AI Router.');
    });
  }
  async function check(manual = false) {
    if (!enabled) { if (manual) await notify('Проверка обновлений доступна в установленном приложении для macOS.'); return; }
    if (checking) return;
    checking = true;
    try {
      if (downloaded) { if (manual) await notify('Обновление уже загружено. Можно установить его через меню AI Router.'); return; }
      const result = await updater.checkForUpdates();
      // Observe the download promise as well: network/signature failures can occur after the check.
      if (result?.downloadPromise) {
        if (manual) await notify('Найдена новая версия. Обновление загружается в фоне.');
        await result.downloadPromise;
      } else if (manual) await notify('Установлена последняя доступная версия.');
    } catch {
      if (manual) await notify('Не удалось получить обновление. Проверьте интернет и наличие опубликованного релиза приложения на GitHub.');
    } finally { checking = false; }
  }
  async function install() {
    if (!downloaded) { await notify('Сначала проверьте обновления и дождитесь загрузки.'); return; }
    if (installing) return;
    const result = await dialog.showMessageBox({ type: 'question', title: 'AI Router', message: 'Установить обновление и перезапустить?', detail: 'Выполняющиеся команды на Mac будут остановлены.', buttons: ['Установить', 'Позже'], defaultId: 1, cancelId: 1 });
    if (result.response !== 0) return;
    installing = true;
    try {
      await stopProcesses();
      updater.quitAndInstall();
    } catch {
      installing = false;
      await notify('Не удалось установить обновление. Повторите попытку после завершения команд.');
    }
  }
  return {
    check, install,
    start() { if (!enabled || timer) return; void check(); timer = schedule(() => { void check(); }, 4 * 60 * 60 * 1000); timer.unref?.(); },
    dispose() { if (timer) cancel(timer); timer = undefined; }
  };
}
module.exports = { createUpdates };
