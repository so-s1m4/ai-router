const { test } = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');
const { EventEmitter } = require('node:events');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
for (const configured of [false, true]) test(`app opens one window (${configured ? 'configured' : 'first start'}) and keeps remote UI isolated`, async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(),'router-app-'));
  const handlers = new Map(), windows = [], external = [];
  if (configured) await fs.writeFile(path.join(directory,'desktop.json'), JSON.stringify({server:'https://router.example',mode:'off'}));
  let menu;
  let ready;
  const initialized = new Promise(resolve => { ready = resolve; });
  class Window extends EventEmitter {
    constructor(options) {
      super(); this.visible = true; this.options = options; this.webContents = new EventEmitter();
      Object.assign(this.webContents,{ mainFrame:{},getUserAgent(){return 'test';},setUserAgent(value){this.userAgent=value;},send(){},setWindowOpenHandler(fn){this.open=fn;},session:{setPermissionRequestHandler(){},setPermissionCheckHandler(){}} });
      windows.push(this); ready();
    }
    loadFile(value) { this.file = value; }
    loadURL(value) { this.url = value; }
    show() { this.visible = true; }
    hide() { this.visible = false; }
    focus() {}
    isVisible() { return this.visible; }
    close() { this.visible = false; this.emit('closed'); }
  }
  const application = new EventEmitter();
  Object.assign(application,{whenReady:async () => {},getPath:() => directory,getVersion:() => '0.1.5',isPackaged:false});
  const electron = {app:application,BrowserWindow:Window,Menu:{setApplicationMenu(value){menu=value;},buildFromTemplate:items => items},dialog:{},ipcMain:{handle:(name,handler) => handlers.set(name,handler)},shell:{openExternal:url => external.push(url)}};
  const load = Module._load;
  Module._load = function(name,...args) { return name === 'electron' ? electron : load.call(this,name,...args); };
  try { require('../src/main.cjs'); } finally { Module._load = load; }
  try {
    await initialized;
    assert.equal(windows.length,1);
    assert.equal(windows[0].visible,true);
    if (configured) {
      assert.equal(windows[0].url,'https://router.example');
      menu[0].submenu[1].click();
      assert.equal(windows[0].visible,false);
    } else assert.ok(windows[0].file.endsWith('settings.html'));
    const local = windows.find(window => window.file), source = {sender:local.webContents,senderFrame:local.webContents.mainFrame};
    const invoke = (name,...args) => handlers.get('desktop:'+name)(source,...args);
    assert.equal((await invoke('state')).mode,'off');
    await assert.rejects(handlers.get('desktop:save')({sender:{},senderFrame:{}},{server:'https://evil.example',mode:'full'}),/source/);
    await assert.rejects(handlers.get('desktop:save')({...source,senderFrame:{}},{server:'https://evil.example',mode:'full'}),/source/);
    await invoke('save',{server:'https://router.example',mode:'off'});
    await invoke('site');
    const remote = windows.find(window => window.url);
    assert.equal(local.visible,false);
    assert.equal(remote.visible,true);
    assert.equal(windows.filter(window => window.visible).length,1);
    menu[0].submenu[1].click();
    assert.equal(local.visible,true);
    assert.equal(remote.visible,false);
    application.emit('activate');
    assert.equal(local.visible,true);
    assert.equal(remote.visible,false);
    await invoke('site');
    assert.equal(local.visible,false);
    assert.equal(remote.visible,true);
    assert.equal(windows.length,2);
    assert.equal(remote.url,'https://router.example');
    assert.equal(remote.options.webPreferences.nodeIntegration,false);
    assert.equal(remote.options.webPreferences.sandbox,true);
    assert.equal(remote.options.webPreferences.contextIsolation,true);
    assert.ok(remote.options.webPreferences.preload.endsWith('voice-preload.cjs'));
    await assert.rejects(handlers.get('desktop:state')({sender:remote.webContents,senderFrame:remote.webContents.mainFrame}),/source/);
    remote.webContents.mainFrame.url = 'https://evil.example';
    assert.throws(() => handlers.get('voice:start')({sender:remote.webContents,senderFrame:remote.webContents.mainFrame}),/source/);
    remote.webContents.mainFrame.url = 'https://router.example/chats';
    handlers.get('voice:stop')({sender:remote.webContents,senderFrame:remote.webContents.mainFrame});
    let blocked = false;
    remote.webContents.emit('will-navigate',{preventDefault:() => {blocked=true;}},'file:///etc/passwd');
    assert.equal(blocked,true); assert.deepEqual(external,[]);
    remote.webContents.emit('will-navigate',{preventDefault(){}},'https://accounts.example/login');
    assert.deepEqual(external,['https://accounts.example/login']);
    await invoke('stop');
    assert.equal(JSON.parse(await fs.readFile(path.join(directory,'desktop.json'),'utf8')).mode,'off');
  } finally { delete require.cache[require.resolve('../src/main.cjs')]; await fs.rm(directory,{recursive:true,force:true}); }
});
