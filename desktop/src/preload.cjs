const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('desktop', {
  state: () => ipcRenderer.invoke('desktop:state'),
  save: options => ipcRenderer.invoke('desktop:save', options),
  chooseFolder: () => ipcRenderer.invoke('desktop:folder'),
  start: code => ipcRenderer.invoke('desktop:start', code),
  stop: () => ipcRenderer.invoke('desktop:stop'),
  openSite: () => ipcRenderer.invoke('desktop:site'),
  computerPermissions: () => ipcRenderer.invoke('desktop:computer-permissions'),
  diskSettings: () => ipcRenderer.invoke('desktop:disk'),
  onState: callback => ipcRenderer.on('desktop:changed', (_event, value) => callback(value))
});
