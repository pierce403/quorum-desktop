// electron/preload.cjs
const { contextBridge, ipcRenderer } = require('electron');
console.log('Preload script starting...');
contextBridge.exposeInMainWorld('electron', {
  platform: process.platform,
  windowControls: {
    minimize: () => ipcRenderer.send('minimize-window'),
    maximize: () => ipcRenderer.send('maximize-window'),
    close: () => ipcRenderer.send('close-window'),
  },
  openLogin: () => ipcRenderer.invoke('openLogin'),
  clipboard: {
    // Copy a sensitive value with a reliable main-process auto-clear.
    // Intentionally the ONLY clipboard capability exposed to the renderer
    // (no read/clear primitives). Resolves with the auto-clear delay in ms.
    copySecret: (text) => ipcRenderer.invoke('clipboard:copy-secret', text),
  },
  secureStorage: {
    status: () => ipcRenderer.invoke('secure-storage:status'),
    get: (key) => ipcRenderer.invoke('secure-storage:get', key),
    set: (key, value) => ipcRenderer.invoke('secure-storage:set', key, value),
    delete: (key) => ipcRenderer.invoke('secure-storage:delete', key),
  },
});
console.log('Preload script done...');
