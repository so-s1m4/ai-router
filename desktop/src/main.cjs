const { app, BrowserWindow, Menu, dialog, ipcMain, shell } = require('electron');
const { spawn } = require('node:child_process');
const fs = require('node:fs/promises');
const path = require('node:path');
const { serverUrl, folderProfile } = require('./access.cjs');
const { startupDiagnostics, exitMessage } = require('./diagnostics.cjs');
const { killTree } = require('./process.cjs');
const { createUpdates } = require('./updates.cjs');
let updates;
let settingsWindow, siteWindow, runner, quitting = false;
let config = { server: '', mode: 'off', folder: '' }, status = 'Доступ выключен', runnerError = '';
let configFile, data, temporary, runtime;
const state = () => ({ ...config, status, runnerError });
function changed(message) { if (message) status = message; settingsWindow?.webContents.send('desktop:changed', state()); }
async function persist() { await fs.writeFile(configFile + '.tmp', JSON.stringify(config), {mode:0o600}); await fs.rename(configFile + '.tmp', configFile); }
function settings() {
  siteWindow?.hide();
  if (settingsWindow) { settingsWindow.show(); settingsWindow.focus(); return; }
  settingsWindow = new BrowserWindow({ width:820, height:900, title:'AI Router · Доступ к Mac', webPreferences:{preload:path.join(__dirname,'preload.cjs'),nodeIntegration:false,contextIsolation:true,sandbox:true} });
  settingsWindow.webContents.setWindowOpenHandler(() => ({action:'deny'}));
  settingsWindow.webContents.on('will-navigate', event => event.preventDefault());
  settingsWindow.on('closed', () => { settingsWindow = null; if (!quitting) siteWindow?.show(); });
  settingsWindow.loadFile(path.join(__dirname,'settings.html'));
}
function openSite() {
  if (!config.server) throw new Error('Сначала сохраните адрес сайта.');
  settingsWindow?.hide();
  if (siteWindow) { siteWindow.show(); siteWindow.focus(); return; }
  siteWindow = new BrowserWindow({width:1440,height:960,title:'AI Router',webPreferences:{nodeIntegration:false,contextIsolation:true,sandbox:true}});
  const contents = siteWindow.webContents;
  contents.setUserAgent(contents.getUserAgent() + ' AI-Router-Desktop/' + app.getVersion());
  contents.on('dom-ready', () => { void contents.insertCSS('app-install-app { display: none !important; }'); });
  const external = value => { try { const url = new URL(value); if (url.protocol === 'https:' || url.protocol === 'http:') void shell.openExternal(url.href); } catch {} };
  const guard = (event, value) => { try { if (new URL(value).origin === config.server) return; } catch {} event.preventDefault(); external(value); };
  contents.on('will-navigate', guard); contents.on('will-redirect', guard);
  contents.setWindowOpenHandler(({url}) => { external(url); return {action:'deny'}; });
  contents.session.setPermissionRequestHandler((_web, _permission, callback) => callback(false));
  contents.session.setPermissionCheckHandler(() => false);
  siteWindow.on('closed', () => { siteWindow = null; });
  siteWindow.loadURL(config.server);
}
async function stopProcesses() {
  await killTree(runner); runner = null;
  changed('Доступ выключен');
}
async function disable() { await stopProcesses(); config.mode = 'off'; await persist(); }
async function environment() {
  return {PATH:'/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin',LANG:process.env.LANG || 'en_US.UTF-8',HOME:app.getPath('home'),TMPDIR:temporary,
    MAC_BRIDGE_MODULE:path.join(runtime,'node_modules/socket.io-client'),ELECTRON_RUN_AS_NODE:'1',NODE_ENV:'production',RUNNER_DATA_DIR:data,ROUTER_SERVER_URL:config.server,
    DESKTOP_ACCESS_MODE:config.mode,DESKTOP_ACCESS_ROOT:config.mode === 'folder' ? config.folder : app.getPath('home')};
}
async function launch(command,args,env) {
  if (config.mode === 'folder') {
    const profile = folderProfile({folder:config.folder,data,runtime,executable:process.execPath,temporary});
    return spawn('/usr/bin/sandbox-exec',['-p',profile,command,...args],{env,cwd:data,stdio:['ignore','pipe','pipe']});
  }
  return spawn(command,args,{env,cwd:data,stdio:['ignore','pipe','pipe']});
}
async function start(code = '') {
  if (process.platform !== 'darwin') throw new Error('Локальный доступ поддерживается только на macOS.');
  if (!config.server || config.mode === 'off') throw new Error('Сохраните адрес сайта и выберите доступ к Mac.');
  if (config.mode === 'folder') { config.folder = await fs.realpath(config.folder); if (!(await fs.stat(config.folder)).isDirectory() || config.folder === '/') throw new Error('Выберите отдельную папку.'); }
  if (typeof code !== 'string' || code.length > 200) throw new Error('Некорректный код.');
  await stopProcesses();
  runnerError = '';
  const env = await environment();
  if (code) { await fs.rm(path.join(data,'device.json'),{force:true}); env.ROUTER_PAIRING_CODE = code; }
  if (!code) await fs.access(path.join(data,'device.json')).catch(() => { throw new Error('Вставьте одноразовый код со страницы «Исполнители».'); });
  runner = await launch(process.execPath,[path.join(__dirname,'bridge.cjs')],env);
  const child = runner;
  const diagnostics = startupDiagnostics([code]);
  changed('Подключение…');
  let buffer = '';
  child.stdout.on('data', chunk => {
    diagnostics.append(chunk);
    buffer = (buffer + chunk.toString()).slice(-4000);
    if (/Runner .+ connected/.test(buffer)) { runnerError = ''; changed('Mac подключён · ' + (config.mode === 'folder' ? config.folder : 'расширенный доступ')); buffer = ''; }
    if (buffer.includes('Control plane disconnected')) { changed('Нет связи с сайтом · переподключение…'); buffer = ''; }
  });
  child.stderr.on('data', chunk => {
    diagnostics.append(chunk);
    if (runner === child) { runnerError = diagnostics.text(); changed('Исполнитель сообщил об ошибке. Подробности ниже.'); }
  });
  child.on('error', error => {
    if (runner !== child) return;
    diagnostics.append(error.message); runnerError = diagnostics.text();
    changed('Не удалось запустить исполнитель. Причина указана ниже.');
  });
  child.on('close', (code, signal) => { if (runner === child) {
    runner = null;
    runnerError = diagnostics.text();
    changed(exitMessage(code, signal, runnerError));
  } });
}
app.whenReady().then(async () => {
  const root = app.getPath('userData');
  configFile = path.join(root,'desktop.json'); data = path.join(root,'executor'); temporary = path.join(data,'tmp');
  runtime = app.isPackaged ? path.join(process.resourcesPath,'runner') : path.join(__dirname,'../runtime/runner');
  await fs.mkdir(temporary,{recursive:true,mode:0o700});
  data = await fs.realpath(data); temporary = await fs.realpath(temporary); runtime = await fs.realpath(runtime).catch(() => runtime);
  try { const saved = JSON.parse(await fs.readFile(configFile,'utf8')); config = {server:serverUrl(saved.server),mode:['off','folder','full'].includes(saved.mode)?saved.mode:'off',folder:typeof saved.folder === 'string'?saved.folder:''}; } catch {}
  const handle = (channel,fn) => ipcMain.handle(channel,async (event,...args) => {
    if (event.sender !== settingsWindow?.webContents || event.senderFrame !== settingsWindow?.webContents.mainFrame) throw new Error('Недопустимый источник запроса.');
    return fn(...args);
  });
  handle('desktop:state',state);
  handle('desktop:save',async options => {
    if (!options || !['off','folder','full'].includes(options.mode)) throw new Error('Некорректный режим.');
    const server = serverUrl(options.server);
    const folder = options.mode === 'folder' ? await fs.realpath(options.folder) : '';
    if (options.mode === 'folder' && (folder === '/' || !(await fs.stat(folder)).isDirectory())) throw new Error('Выберите отдельную папку.');
    await stopProcesses();
    if (config.server && config.server !== server) { await fs.rm(path.join(data,'device.json'),{force:true}); siteWindow?.close(); }
    config = {server,mode:options.mode,folder}; await persist(); changed('Настройки сохранены. Нажмите «Подключить Mac».');
  });
  handle('desktop:folder',async () => { const result = await dialog.showOpenDialog(settingsWindow,{properties:['openDirectory'],title:'Папка для AI Router'}); return result.canceled ? null : fs.realpath(result.filePaths[0]); });
  handle('desktop:start',start); handle('desktop:stop',disable); handle('desktop:site',openSite);
  handle('desktop:disk',() => shell.openExternal('x-apple.systempreferences:com.apple.preference.security?Privacy_AllFiles'));
  updates = createUpdates({ app, dialog, openExternal: url => shell.openExternal(url) });
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    {label:'AI Router',submenu:[{label:'Открыть AI Router',click:() => { try { openSite(); } catch { settings(); } }},{label:'Доступ к Mac…',click:settings},{label:'Остановить и отключить доступ',click:() => disable().catch(error => dialog.showErrorBox('AI Router',error.message))},{type:'separator'},{label:'Проверить обновления…',click:() => updates.check(true)},{type:'separator'},{role:'quit'}]},
    {role:'editMenu'},{role:'viewMenu'},{role:'windowMenu'}
  ]));
  if (config.server) openSite(); else settings();
  updates.start();
  if (config.mode !== 'off') await start().catch(error => changed(error.message));
});
app.on('window-all-closed',() => {});
app.on('activate',() => { if (settingsWindow?.isVisible()) { settingsWindow.focus(); } else if (config.server) openSite(); else settings(); });
app.on('before-quit',event => {
  if (quitting) return;
  event.preventDefault();
  updates?.dispose();
  stopProcesses().then(() => { quitting = true; app.quit(); }).catch(error => { settings(); dialog.showErrorBox('Не удалось остановить исполнитель',error.message); });
});
