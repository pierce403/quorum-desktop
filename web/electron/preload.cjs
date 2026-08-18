// electron/preload.cjs
const { contextBridge, ipcRenderer } = require('electron');

const diagnosticsEnabled = process.argv.includes('--quorum-dev-diagnostics=1');
const encodedDevServerUrl = process.argv
  .find((argument) => argument.startsWith('--quorum-dev-server-url='))
  ?.slice('--quorum-dev-server-url='.length);
let devServerUrl;
try {
  devServerUrl = encodedDevServerUrl
    ? decodeURIComponent(encodedDevServerUrl)
    : undefined;
} catch {
  devServerUrl = undefined;
}

const electronBridge = {
  platform: process.platform,
  devServerUrl,
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
};

if (diagnosticsEnabled) {
  electronBridge.devDiagnostics = {
    onboarding: (details) =>
      ipcRenderer.send('dev-diagnostics:onboarding', details),
    registration: (details) =>
      ipcRenderer.send('dev-diagnostics:registration', details),
    storageSnapshot: (details) =>
      ipcRenderer.send('dev-diagnostics:storage-snapshot', details),
    rendererError: (details) =>
      ipcRenderer.send('dev-diagnostics:renderer-error', details),
  };
}

contextBridge.exposeInMainWorld('electron', electronBridge);
