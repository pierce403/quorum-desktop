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
const { existsSync, promises: fs } = require('fs');
const { pathToFileURL } = require('url');

// Simple development mode check
const isDev =
  process.env.NODE_ENV === 'development' || process.env.DEBUG_PROD === 'true';

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
const QUORUM_API_ORIGIN = 'https://api.quorummessenger.com';
const QUORUM_WEB_ORIGIN = 'https://app.quorummessenger.com';
const FARCASTER_CLIENT_ORIGIN = 'https://client.farcaster.xyz';
const FARCASTER_WEB_ORIGIN = 'https://farcaster.xyz';
const FARCASTER_API_ORIGIN = 'https://api.farcaster.xyz';

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

function registerProductionProtocol() {
  protocol.handle(APP_SCHEME, (request) => {
    const assetPath = resolveProductionAsset(request.url);
    if (!assetPath) {
      return new Response('Not found', { status: 404 });
    }
    return net.fetch(pathToFileURL(assetPath).toString());
  });
}

function replaceHeader(headers, name, value) {
  const updatedHeaders = { ...headers };
  for (const headerName of Object.keys(updatedHeaders)) {
    if (headerName.toLowerCase() === name.toLowerCase()) {
      delete updatedHeaders[headerName];
    }
  }
  updatedHeaders[name] = value;
  return updatedHeaders;
}

function configureProductionApiAccess() {
  const apiFilter = {
    urls: [`${QUORUM_API_ORIGIN}/*`, 'wss://api.quorummessenger.com/*'],
  };

  // The API intentionally allows the hosted web app's origin, but does not
  // know about Electron's private custom scheme. Present the official origin
  // upstream, then translate that one response header back to the renderer's
  // actual origin. This is deliberately limited to Quorum's API and keeps
  // Chromium's web security enabled for every other destination.
  session.defaultSession.webRequest.onBeforeSendHeaders(
    apiFilter,
    (details, callback) => {
      callback({
        requestHeaders: replaceHeader(
          details.requestHeaders,
          'Origin',
          QUORUM_WEB_ORIGIN
        ),
      });
    }
  );

  session.defaultSession.webRequest.onHeadersReceived(
    { urls: [`${QUORUM_API_ORIGIN}/*`] },
    (details, callback) => {
      callback({
        responseHeaders: replaceHeader(
          details.responseHeaders,
          'Access-Control-Allow-Origin',
          [APP_ORIGIN]
        ),
      });
    }
  );
}

function configureFarcasterApiAccess() {
  const urls = [`${FARCASTER_CLIENT_ORIGIN}/*`, `${FARCASTER_API_ORIGIN}/*`];
  session.defaultSession.webRequest.onBeforeSendHeaders(
    { urls },
    (details, callback) => {
      callback({
        requestHeaders: replaceHeader(details.requestHeaders, 'Origin', FARCASTER_WEB_ORIGIN),
      });
    }
  );
  session.defaultSession.webRequest.onHeadersReceived(
    { urls },
    (details, callback) => {
      callback({
        responseHeaders: replaceHeader(
          details.responseHeaders,
          'Access-Control-Allow-Origin',
          [APP_ORIGIN]
        ),
      });
    }
  );
}

const ALLOWED_SECRET_KEYS = new Set(['farcaster-account', 'farcaster-signer']);

function secureStorageUsable() {
  return safeStorage.isEncryptionAvailable() && safeStorage.getSelectedStorageBackend() !== 'basic_text';
}

function secretsPath() {
  return path.join(app.getPath('userData'), 'secure-secrets.json');
}

async function readSecretFile() {
  try {
    return JSON.parse(await fs.readFile(secretsPath(), 'utf8'));
  } catch (error) {
    if (error && error.code === 'ENOENT') return {};
    throw error;
  }
}

function assertSecretKey(key) {
  if (!ALLOWED_SECRET_KEYS.has(key)) throw new Error('Unsupported secret key');
}

ipcMain.handle('secure-storage:status', () => ({
  available: secureStorageUsable(),
  backend: safeStorage.getSelectedStorageBackend(),
}));

ipcMain.handle('secure-storage:get', async (_event, key) => {
  assertSecretKey(key);
  if (!secureStorageUsable()) return null;
  const values = await readSecretFile();
  const encrypted = values[key];
  if (typeof encrypted !== 'string') return null;
  return safeStorage.decryptString(Buffer.from(encrypted, 'base64'));
});

ipcMain.handle('secure-storage:set', async (_event, key, value) => {
  assertSecretKey(key);
  if (typeof value !== 'string' || value.length > 32_768) throw new Error('Invalid secret value');
  if (!secureStorageUsable()) throw new Error('OS credential encryption is unavailable');
  const values = await readSecretFile();
  values[key] = safeStorage.encryptString(value).toString('base64');
  const target = secretsPath();
  const temporary = `${target}.tmp`;
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(temporary, JSON.stringify(values), { mode: 0o600 });
  await fs.rename(temporary, target);
});

ipcMain.handle('secure-storage:delete', async (_event, key) => {
  assertSecretKey(key);
  const values = await readSecretFile();
  delete values[key];
  await fs.writeFile(secretsPath(), JSON.stringify(values), { mode: 0o600 });
});

// Add these IPC handlers
ipcMain.on('minimize-window', () => {
  const window = BrowserWindow.getFocusedWindow();
  if (window) window.minimize();
});

ipcMain.on('maximize-window', () => {
  const window = BrowserWindow.getFocusedWindow();
  if (window) {
    if (window.isMaximized()) {
      window.unmaximize();
    } else {
      window.maximize();
    }
  }
});

ipcMain.on('close-window', () => {
  const window = BrowserWindow.getFocusedWindow();
  if (window) window.close();
});

ipcMain.handle('openLogin', () => {
  shell.openExternal('http://localhost:5173');
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

ipcMain.handle('clipboard:copy-secret', (_event, text) => {
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
  isDev ? '../../public/icon-512.png' : '../../dist/icon-512.png'
);

function createWindow() {
  const mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    frame: false,
    icon: windowIcon,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      webAuthnEnabled: true,
      preload: path.join(__dirname, 'preload.cjs'),
      webSecurity: isDev ? false : true, // Disable web security in dev mode
    },
  });

  mainWindow.loadURL(isDev ? devUrl : `${APP_ORIGIN}/`, {});

  if (isDev) {
    mainWindow.webContents.openDevTools();

    // Bypass CORS in development
    mainWindow.webContents.session.webRequest.onBeforeSendHeaders(
      (details, callback) => {
        callback({
          requestHeaders: { ...details.requestHeaders, Origin: '*' },
        });
      }
    );

    mainWindow.webContents.session.webRequest.onHeadersReceived(
      (details, callback) => {
        callback({
          responseHeaders: {
            ...details.responseHeaders,
            'Access-Control-Allow-Origin': ['*'],
            'Access-Control-Allow-Methods': ['GET, POST, PUT, DELETE, OPTIONS'],
            'Access-Control-Allow-Headers': ['*'],
          },
        });
      }
    );
  }
}

// Windows groups taskbar entries by AppUserModelID. Without an explicit ID,
// Electron apps show the generic Electron icon in the taskbar even when the
// BrowserWindow icon is set. Must match electron-builder's appId.
if (process.platform === 'win32') {
  app.setAppUserModelId('com.quilibrium.quorum');
}

app.whenReady().then(() => {
  if (!isDev) {
    registerProductionProtocol();
    configureProductionApiAccess();
    configureFarcasterApiAccess();
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

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});
