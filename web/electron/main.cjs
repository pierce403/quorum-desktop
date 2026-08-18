// electron/main.cjs
const {
  app,
  session,
  BrowserWindow,
  ipcMain,
  shell,
  protocol,
  clipboard,
  net,
  safeStorage,
} = require('electron');
const path = require('path');
const { existsSync } = require('fs');
const { pathToFileURL } = require('url');
const {
  configureNetworkAccess,
  resolveDevProxyUrl,
} = require('./network-access.cjs');
const { createDevDiagnostics } = require('./dev-diagnostics.cjs');
const { createSecretFileStore } = require('./secure-secret-store.cjs');
const {
  classifyNavigationTarget,
  isTrustedRenderer: isTrustedRendererEvent,
  navigationUrlFromEvent,
} = require('./renderer-security.cjs');

// Keep packaged and unpackaged Electron on the same Chromium profile. Without
// this, `electron web/electron/main.cjs` defaults to ~/.config/Electron while
// the packaged app uses ~/.config/quorum-desktop, making the same machine look
// signed out depending on how the binary was launched. Respect explicit test or
// operator profiles supplied with --user-data-dir.
if (!app.commandLine.hasSwitch('user-data-dir')) {
  app.setPath('userData', path.join(app.getPath('appData'), 'quorum-desktop'));
}

// Content source and diagnostics are intentionally separate. DEBUG_PROD used
// to switch a packaged app to localhost, which also switched its storage origin
// and made an existing account disappear.
const usesDevServer = process.env.NODE_ENV === 'development';

// Dev server URL (override with ELECTRON_DEV_URL when Vite picks a non-default port).
const devUrl = process.env.ELECTRON_DEV_URL || 'http://localhost:5173';

// Production builds use absolute asset URLs so the same bundle continues to
// work when a browser route is loaded directly. A plain file:// URL cannot
// resolve those paths: `/assets/app.js` becomes `file:///assets/app.js`, which
// leaves Electron showing an empty white window. Serve dist/ from a secure,
// standard custom origin instead. Besides fixing assets, this gives
// BrowserRouter the expected `/` pathname rather than the path to index.html.
const APP_SCHEME = 'quorum-app';
const APP_HOST = 'app';
const APP_ORIGIN = `${APP_SCHEME}://${APP_HOST}`;
const DIST_ROOT = path.resolve(__dirname, '../../dist');
const DEV_BUILD_MARKER = path.join(DIST_ROOT, 'quorum-dev-build.json');
// Retain the BrowserWindow wrapper for the lifetime of the native window.
let mainWindow = null;
const diagnosticsEnabled =
  usesDevServer ||
  process.env.DEBUG_PROD === 'true' ||
  process.env.QUORUM_DEV_LOGS === 'true' ||
  existsSync(DEV_BUILD_MARKER);
const diagnostics = createDevDiagnostics({
  enabled: diagnosticsEnabled,
  logPath: path.join(app.getPath('userData'), 'logs', 'quorum-dev.ndjson'),
});

diagnostics.log('app.start', {
  version: app.getVersion(),
  platform: process.platform,
  arch: process.arch,
  packaged: app.isPackaged,
  sourceMode: usesDevServer ? 'vite' : 'bundle',
  diagnosticsMode: diagnosticsEnabled ? 'enabled' : 'disabled',
  userDataBasename: path.basename(app.getPath('userData')),
});

protocol.registerSchemesAsPrivileged([
  {
    scheme: APP_SCHEME,
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
    },
  },
]);

function resolveProductionAsset(requestUrl) {
  const url = new URL(requestUrl);
  if (url.host !== APP_HOST) return null;

  let pathname;
  try {
    pathname = decodeURIComponent(url.pathname);
  } catch {
    return null;
  }

  const requestedPath = pathname === '/' ? '/index.html' : pathname;
  const assetPath = path.resolve(DIST_ROOT, `.${requestedPath}`);
  const relativePath = path.relative(DIST_ROOT, assetPath);

  // Keep the custom scheme strictly rooted in dist/. An encoded traversal or
  // an absolute path must never turn this into a general filesystem reader.
  if (relativePath.startsWith('..') || path.isAbsolute(relativePath)) {
    return null;
  }

  if (existsSync(assetPath)) return assetPath;

  // BrowserRouter owns extensionless application routes. Returning the shell
  // lets refreshes and deep links behave like the web server's SPA fallback.
  if (!path.extname(pathname)) {
    return path.join(DIST_ROOT, 'index.html');
  }

  return null;
}

async function proxyDevRequest(request) {
  const targetUrl = resolveDevProxyUrl(request.url, devUrl, APP_ORIGIN);
  if (!targetUrl) {
    return new Response('Not found', { status: 404 });
  }

  const requestInit = {
    method: request.method,
    headers: request.headers,
    bypassCustomProtocolHandlers: true,
  };
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    requestInit.body = request.body;
  }
  return net.fetch(targetUrl, requestInit);
}

function registerAppProtocol() {
  protocol.handle(APP_SCHEME, (request) => {
    if (usesDevServer) return proxyDevRequest(request);

    const assetPath = resolveProductionAsset(request.url);
    if (!assetPath) {
      return new Response('Not found', { status: 404 });
    }
    return net.fetch(pathToFileURL(assetPath).toString());
  });
}

const ALLOWED_SECRET_KEYS = new Set(['farcaster-account', 'farcaster-signer']);

function secureStorageUsable() {
  return (
    safeStorage.isEncryptionAvailable() &&
    safeStorage.getSelectedStorageBackend() !== 'basic_text'
  );
}

function secretsPath() {
  return path.join(app.getPath('userData'), 'secure-secrets.json');
}

const secretStore = createSecretFileStore({
  filePath: secretsPath(),
  encrypt: (value) => safeStorage.encryptString(value).toString('base64'),
  decrypt: (value) => safeStorage.decryptString(Buffer.from(value, 'base64')),
});

function assertSecretKey(key) {
  if (!ALLOWED_SECRET_KEYS.has(key)) throw new Error('Unsupported secret key');
}

function isTrustedRenderer(event) {
  return isTrustedRendererEvent(event, mainWindow?.webContents, APP_ORIGIN);
}

function assertTrustedRenderer(event) {
  if (!isTrustedRenderer(event)) throw new Error('Untrusted renderer');
}

ipcMain.handle('secure-storage:status', (event) => {
  assertTrustedRenderer(event);
  const result = {
    available: secureStorageUsable(),
    backend: safeStorage.getSelectedStorageBackend(),
  };
  diagnostics.log('secure-storage', {
    operation: 'status',
    outcome: 'success',
    available: result.available,
    backend: result.backend,
  });
  return result;
});

ipcMain.handle('secure-storage:get', async (event, key) => {
  assertTrustedRenderer(event);
  assertSecretKey(key);
  const available = secureStorageUsable();
  if (!available) {
    diagnostics.log('secure-storage', {
      operation: 'get',
      slot: key,
      outcome: 'unavailable',
      available,
      present: false,
      backend: safeStorage.getSelectedStorageBackend(),
    });
    return null;
  }
  try {
    const value = await secretStore.get(key);
    const present = value !== null;
    diagnostics.log('secure-storage', {
      operation: 'get',
      slot: key,
      outcome: 'success',
      available,
      present,
      backend: safeStorage.getSelectedStorageBackend(),
    });
    return value;
  } catch (error) {
    diagnostics.log('secure-storage', {
      operation: 'get',
      slot: key,
      outcome: 'failed',
      available,
      backend: safeStorage.getSelectedStorageBackend(),
    });
    throw error;
  }
});

ipcMain.handle('secure-storage:set', async (event, key, value) => {
  assertTrustedRenderer(event);
  assertSecretKey(key);
  if (typeof value !== 'string' || value.length > 32_768)
    throw new Error('Invalid secret value');
  const available = secureStorageUsable();
  if (!available) throw new Error('OS credential encryption is unavailable');
  try {
    await secretStore.set(key, value);
    diagnostics.log('secure-storage', {
      operation: 'set',
      slot: key,
      outcome: 'success',
      available,
      present: true,
      backend: safeStorage.getSelectedStorageBackend(),
    });
  } catch (error) {
    diagnostics.log('secure-storage', {
      operation: 'set',
      slot: key,
      outcome: 'failed',
      available,
      backend: safeStorage.getSelectedStorageBackend(),
    });
    throw error;
  }
});

ipcMain.handle('secure-storage:delete', async (event, key) => {
  assertTrustedRenderer(event);
  assertSecretKey(key);
  const available = secureStorageUsable();
  try {
    const present = await secretStore.delete(key);
    diagnostics.log('secure-storage', {
      operation: 'delete',
      slot: key,
      outcome: 'success',
      available,
      present,
      backend: safeStorage.getSelectedStorageBackend(),
    });
  } catch (error) {
    diagnostics.log('secure-storage', {
      operation: 'delete',
      slot: key,
      outcome: 'failed',
      available,
      backend: safeStorage.getSelectedStorageBackend(),
    });
    throw error;
  }
});

// Native window controls are accepted only from the app's top-level renderer.
ipcMain.on('minimize-window', (event) => {
  if (!isTrustedRenderer(event)) return;
  const window = mainWindow;
  if (window) {
    diagnostics.log('renderer.window-control', { action: 'minimize' });
    window.minimize();
  }
});

ipcMain.on('maximize-window', (event) => {
  if (!isTrustedRenderer(event)) return;
  const window = mainWindow;
  if (window) {
    if (window.isMaximized()) {
      diagnostics.log('renderer.window-control', { action: 'unmaximize' });
      window.unmaximize();
    } else {
      diagnostics.log('renderer.window-control', { action: 'maximize' });
      window.maximize();
    }
  }
});

ipcMain.on('close-window', (event) => {
  if (!isTrustedRenderer(event)) return;
  const window = mainWindow;
  if (window) {
    diagnostics.log('renderer.window-control', { action: 'close' });
    window.close();
  }
});

ipcMain.handle('openLogin', (event) => {
  assertTrustedRenderer(event);
  const target = classifyNavigationTarget(
    usesDevServer ? devUrl : 'https://app.quorummessenger.com',
    APP_ORIGIN
  );
  if (target.kind !== 'external') throw new Error('Invalid login URL');
  return shell.openExternal(target.url);
});

// These channels deliberately expose fixed event shapes rather than a generic
// log(message) primitive. The diagnostics sink independently allow-lists every
// field, so renderer content, account identifiers, and key material cannot be
// written to disk through this bridge.
ipcMain.on('dev-diagnostics:onboarding', (event, details) => {
  if (isTrustedRenderer(event)) diagnostics.log('onboarding.event', details);
});

ipcMain.on('dev-diagnostics:registration', (event, details) => {
  if (isTrustedRenderer(event)) diagnostics.log('registration.event', details);
});

ipcMain.on('dev-diagnostics:storage-snapshot', (event, details) => {
  if (isTrustedRenderer(event)) diagnostics.log('storage.snapshot', details);
});

ipcMain.on('dev-diagnostics:renderer-error', (event, details) => {
  if (isTrustedRenderer(event)) diagnostics.log('renderer.error', details);
});

// --- Sensitive clipboard copy with reliable auto-clear ---
// The renderer's navigator.clipboard cannot clear the clipboard once the
// window loses focus (Chromium enforces document focus for both read and
// write). The main-process clipboard module has no such restriction, so the
// whole copy + delayed compare-and-clear lifecycle lives here. Pattern matches
// Bitwarden desktop: only clear if the clipboard still holds the value we
// wrote, so we never wipe something the user copied in the meantime.
// Note: on Linux/Wayland the compositor may still restrict background
// clipboard access; Windows/macOS are reliable.
const SENSITIVE_CLIPBOARD_CLEAR_MS = 60_000;
let pendingSensitiveValue = null;
let pendingClearTimer = null;

function clearSensitiveClipboardIfUnchanged() {
  if (pendingClearTimer) {
    clearTimeout(pendingClearTimer);
    pendingClearTimer = null;
  }
  if (pendingSensitiveValue === null) return;
  try {
    if (clipboard.readText() === pendingSensitiveValue) {
      clipboard.clear();
    }
  } finally {
    pendingSensitiveValue = null;
  }
}

ipcMain.handle('clipboard:copy-secret', (event, text) => {
  assertTrustedRenderer(event);
  if (typeof text !== 'string' || text.length === 0 || text.length > 4096) {
    throw new Error('Invalid clipboard payload');
  }
  if (pendingClearTimer) clearTimeout(pendingClearTimer);
  clipboard.writeText(text);
  pendingSensitiveValue = text;
  pendingClearTimer = setTimeout(
    clearSensitiveClipboardIfUnchanged,
    SENSITIVE_CLIPBOARD_CLEAR_MS
  );
  return SENSITIVE_CLIPBOARD_CLEAR_MS;
});

// Don't leave a secret on the clipboard when the app exits before the timer fires.
app.on('before-quit', clearSensitiveClipboardIfUnchanged);

// App/taskbar icon. In dev the asset lives in public/; in a packaged build
// Vite copies public/ into dist/. Used for the runtime window + taskbar
// (packaged installer/exe icons come from electron-builder's build.icon).
const windowIcon = path.join(
  __dirname,
  usesDevServer ? '../../public/icon-512.png' : '../../dist/icon-512.png'
);

function loadErrorKind(errorCode) {
  if (errorCode === -3) return 'aborted';
  if (errorCode <= -100 && errorCode > -200) return 'connection';
  if (errorCode <= -200 && errorCode > -300) return 'certificate';
  return 'load';
}

function rendererConsoleLevel(details) {
  return { debug: 0, info: 1, warning: 2, error: 3 }[details?.level] ?? 1;
}

function attachWindowDiagnostics(mainWindow) {
  const { webContents } = mainWindow;
  webContents.on('did-start-loading', () => {
    diagnostics.log('renderer.loading-started');
  });
  webContents.on('dom-ready', () => {
    diagnostics.log('renderer.dom-ready');
  });
  webContents.on('did-finish-load', () => {
    diagnostics.log('renderer.loading-finished', {
      origin: webContents.getURL(),
    });
  });
  webContents.on(
    'did-fail-load',
    (_event, errorCode, _errorDescription, validatedURL, isMainFrame) => {
      if (!isMainFrame) return;
      diagnostics.log('renderer.loading-failed', {
        errorCode,
        errorKind: loadErrorKind(errorCode),
        origin: validatedURL,
      });
    }
  );
  webContents.on('preload-error', () => {
    diagnostics.log('process.failure', { kind: 'preload' });
  });
  webContents.on('console-message', (details) => {
    // Never persist details.message. Existing development logs may include
    // decrypted content, so only console severity and source location are safe.
    diagnostics.log('renderer.console', {
      level: rendererConsoleLevel(details),
      source: details.sourceId,
      line: details.lineNumber,
    });
  });
  webContents.on('render-process-gone', (_event, details) => {
    diagnostics.log('renderer.gone', {
      reason: details.reason,
      exitCode: details.exitCode,
    });
  });
  mainWindow.on('unresponsive', () => diagnostics.log('renderer.unresponsive'));
  mainWindow.on('responsive', () => diagnostics.log('renderer.responsive'));
}

function attachNavigationPolicy(window) {
  const openExternal = (target) => {
    if (target.kind === 'external') {
      void shell.openExternal(target.url).catch(() => {});
    }
  };
  const handleNavigation = (event, legacyUrl) => {
    // Electron 41 puts the destination on event.url; retain the deprecated
    // positional URL as a compatibility fallback for older supported builds.
    const url = navigationUrlFromEvent(event, legacyUrl);
    const target = classifyNavigationTarget(url, APP_ORIGIN);
    // Preserve all quorum-app routes and SPA deep links in the primary window.
    if (target.kind === 'app') return;
    event.preventDefault();
    openExternal(target);
  };

  window.webContents.on('will-navigate', handleNavigation);
  window.webContents.on('will-redirect', handleNavigation);
  window.webContents.setWindowOpenHandler(({ url }) => {
    const target = classifyNavigationTarget(url, APP_ORIGIN);
    if (target.kind === 'app') {
      void window.loadURL(target.url).catch(() => {});
    } else {
      openExternal(target);
    }
    // Never give external content a BrowserWindow carrying Quorum's preload.
    return { action: 'deny' };
  });
}

function createWindow() {
  const additionalArguments = [];
  if (diagnosticsEnabled)
    additionalArguments.push('--quorum-dev-diagnostics=1');
  if (usesDevServer) {
    additionalArguments.push(
      `--quorum-dev-server-url=${encodeURIComponent(devUrl)}`
    );
  }

  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    frame: false,
    icon: windowIcon,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      webAuthnEnabled: true,
      preload: path.join(__dirname, 'preload.cjs'),
      webSecurity: true,
      additionalArguments,
    },
  });

  diagnostics.log('app.window-created', { width: 1200, height: 800 });
  attachWindowDiagnostics(mainWindow);
  attachNavigationPolicy(mainWindow);
  mainWindow.on('close', () => {
    diagnostics.log('renderer.window-close-requested');
  });
  mainWindow.on('closed', () => {
    diagnostics.log('renderer.window-closed');
    mainWindow = null;
  });
  void mainWindow.loadURL(`${APP_ORIGIN}/`).catch(() => {
    // did-fail-load records a structural error without persisting the URL path
    // or Chromium's potentially data-bearing error description.
  });

  if (usesDevServer || process.env.DEBUG_PROD === 'true') {
    mainWindow.webContents.openDevTools();
  }
}

// Windows groups taskbar entries by AppUserModelID. Without an explicit ID,
// Electron apps show the generic Electron icon in the taskbar even when the
// BrowserWindow icon is set. Must match electron-builder's appId.
if (process.platform === 'win32') {
  app.setAppUserModelId('com.quilibrium.quorum');
}

app.on('child-process-gone', (_event, details) => {
  diagnostics.log('process.child-gone', {
    kind: details.type,
    reason: details.reason,
    exitCode: details.exitCode,
  });
});

process.on('uncaughtExceptionMonitor', (_error, origin) => {
  diagnostics.log('process.failure', {
    kind:
      origin === 'unhandledRejection'
        ? 'unhandled-rejection'
        : 'uncaught-exception',
  });
});

app.whenReady().then(() => {
  registerAppProtocol();
  configureNetworkAccess(session.defaultSession, APP_ORIGIN);
  diagnostics.log('app.ready', {
    persistentSession: session.defaultSession.isPersistent(),
  });
  if (diagnosticsEnabled) {
    console.info(`[Quorum diagnostics] ${diagnostics.logPath}`);
  }
  createWindow();
});
if (process.defaultApp) {
  if (process.argv.length >= 2) {
    app.setAsDefaultProtocolClient('quorum', process.execPath, [
      path.resolve(process.argv[1]),
    ]);
  }
} else {
  app.setAsDefaultProtocolClient('quorum');
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', () => diagnostics.log('app.before-quit'));
app.on('will-quit', () => diagnostics.log('app.will-quit'));
app.on('quit', (_event, exitCode) => {
  diagnostics.log('app.quit', { exitCode });
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});
