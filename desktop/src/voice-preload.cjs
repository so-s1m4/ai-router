const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('aiRouterVoice', {
  start: () => ipcRenderer.invoke('voice:start'),
  stop: () => ipcRenderer.invoke('voice:stop'),
  onEvent: callback => {
    const listener = (_event, value) => callback(value);
    ipcRenderer.on('voice:event', listener);
    return () => ipcRenderer.removeListener('voice:event', listener);
  }
});
