const fs = require('fs');
const path = require('path');

const MAX_LOG_BYTES = 5 * 1024 * 1024;
const MAX_RECORD_BYTES = 4096;
const SAFE_ORIGIN_PROTOCOLS = new Set([
  'file:',
  'http:',
  'https:',
  'quorum-app:',
  'ws:',
  'wss:',
]);
const SAFE_SOURCE_PROTOCOLS = new Set([
  'file:',
  'http:',
  'https:',
  'quorum-app:',
]);
const TOKEN_ALLOWLISTS = {
  'onboarding.event': {
    action: new Set([
      'flow-state',
      'display-name-submit',
      'profile-photo-submit',
      'complete-submit',
      'returning-user-check',
    ]),
    step: new Set([
      'loading',
      'welcome',
      'import-key',
      'create-passkey-1a',
      'save-key-to-passkey',
      'backup-key',
      'security-warning',
      'display-name',
      'profile-photo',
      'complete',
    ]),
    outcome: new Set([
      'observed',
      'started',
      'advanced',
      'restored',
      'blocked-no-account',
      'blocked-invalid',
      'failed',
    ]),
  },
  'storage.snapshot': {
    metadataStatus: new Set([
      'missing',
      'valid',
      'invalid-json',
      'invalid-shape',
      'unavailable',
    ]),
  },
  'registration.event': {
    stage: new Set([
      'export-account-key',
      'load-device-keyset',
      'decrypt-device-keyset',
      'sync-registration',
      'initialize-config',
    ]),
    outcome: new Set(['started', 'succeeded', 'failed', 'recovering']),
  },
  'renderer.error': {
    kind: new Set([
      'window-error',
      'unhandled-error',
      'unhandled-dom-exception',
      'unhandled-object',
      'unhandled-primitive',
      'storage-databases-unavailable',
    ]),
    errorName: new Set([
      'AbortError',
      'ConstraintError',
      'DataError',
      'InvalidAccessError',
      'InvalidStateError',
      'NetworkError',
      'NotAllowedError',
      'NotFoundError',
      'OperationError',
      'QuotaExceededError',
      'ReadOnlyError',
      'SecurityError',
      'TimeoutError',
      'TransactionInactiveError',
      'UnknownError',
      'VersionError',
    ]),
  },
  'renderer.window-control': {
    action: new Set(['minimize', 'maximize', 'unmaximize', 'close']),
  },
};
const NUMBER_RANGES = {
  count: { min: 0, max: 1_000_000 },
  'db-version': { min: 0, max: 1_000_000 },
  location: { min: 0, max: 10_000_000 },
};

const SCHEMAS = {
  'app.start': {
    version: 'token',
    platform: 'token',
    arch: 'token',
    packaged: 'boolean',
    sourceMode: 'token',
    diagnosticsMode: 'token',
    userDataBasename: 'token',
  },
  'app.ready': { persistentSession: 'boolean' },
  'app.before-quit': {},
  'app.will-quit': {},
  'app.quit': { exitCode: 'number' },
  'app.window-created': { width: 'number', height: 'number' },
  'renderer.loading-started': {},
  'renderer.dom-ready': {},
  'renderer.loading-finished': { origin: 'origin' },
  'renderer.loading-failed': {
    errorCode: 'number',
    errorKind: 'token',
    origin: 'origin',
  },
  'renderer.console': { level: 'number', source: 'source', line: 'number' },
  'renderer.gone': { reason: 'token', exitCode: 'number' },
  'renderer.unresponsive': {},
  'renderer.responsive': {},
  'renderer.window-close-requested': {},
  'renderer.window-closed': {},
  'renderer.window-control': { action: 'token' },
  'process.child-gone': { kind: 'token', reason: 'token', exitCode: 'number' },
  'process.failure': { kind: 'token' },
  'secure-storage': {
    operation: 'token',
    slot: 'token',
    outcome: 'token',
    available: 'boolean',
    present: 'boolean',
    backend: 'token',
  },
  'onboarding.event': {
    action: 'token',
    step: 'token',
    outcome: 'token',
    hasAccount: 'boolean',
    valid: 'boolean',
    completed: 'boolean',
    accountCount: 'count',
  },
  'registration.event': {
    stage: 'token',
    outcome: 'token',
    registered: 'boolean',
  },
  'storage.snapshot': {
    origin: 'app-origin',
    metadataStatus: 'token',
    accountCount: 'count',
    completedCount: 'count',
    fallbackCredential: 'boolean',
    keyDbPresent: 'boolean',
    keyDbVersion: 'db-version',
    quorumDbPresent: 'boolean',
    quorumDbVersion: 'db-version',
  },
  'renderer.error': {
    kind: 'token',
    errorName: 'token',
    line: 'location',
    column: 'location',
  },
};

function originOnly(value) {
  if (typeof value !== 'string') return undefined;
  try {
    const url = new URL(value);
    if (!SAFE_ORIGIN_PROTOCOLS.has(url.protocol)) return undefined;
    if (url.protocol === 'file:') return 'file://';
    if (!url.host) return undefined;

    // Node reports the opaque origin "null" for custom schemes even when
    // Electron registered the scheme as standard and secure. Reconstruct only
    // protocol + host so paths, queries, fragments, and credentials never land
    // in the diagnostic file.
    return url.origin === 'null' ? `${url.protocol}//${url.host}` : url.origin;
  } catch {
    return undefined;
  }
}

function safeSourceName(value) {
  if (!value || value.length > 80) return undefined;
  if (!/^[a-zA-Z0-9._-]+$/.test(value)) return undefined;
  return /\.(?:[cm]?js|jsx|tsx?)$/i.test(value) ? value : undefined;
}

function sourceBasename(value) {
  if (typeof value !== 'string') return undefined;
  try {
    const url = new URL(value);
    // In particular, never treat data: URLs as file names: their pathname is
    // the renderer payload itself and may contain user text or secrets.
    if (!SAFE_SOURCE_PROTOCOLS.has(url.protocol)) return undefined;
    return safeSourceName(path.basename(url.pathname));
  } catch {
    return safeSourceName(path.basename(value.replace(/\\/g, '/')));
  }
}

function safeToken(value) {
  if (typeof value !== 'string') return undefined;
  if (!value || value.length > 80) return undefined;
  return /^[a-zA-Z0-9._:+-]+$/.test(value) ? value : undefined;
}

function safeBoundedInteger(value, kind) {
  const range = NUMBER_RANGES[kind];
  if (!range || !Number.isSafeInteger(value)) return undefined;
  return value >= range.min && value <= range.max ? value : undefined;
}

function sanitizeDetails(event, details) {
  const schema = SCHEMAS[event];
  if (
    !schema ||
    !details ||
    typeof details !== 'object' ||
    Array.isArray(details)
  ) {
    return {};
  }

  const safe = {};
  for (const [field, kind] of Object.entries(schema)) {
    const value = details[field];
    if (kind === 'boolean' && typeof value === 'boolean') safe[field] = value;
    if (kind === 'number' && Number.isSafeInteger(value)) safe[field] = value;
    if (NUMBER_RANGES[kind]) {
      const number = safeBoundedInteger(value, kind);
      if (number !== undefined) safe[field] = number;
    }
    if (kind === 'token') {
      const token = safeToken(value);
      const allowlist = TOKEN_ALLOWLISTS[event]?.[field];
      if (token !== undefined && (!allowlist || allowlist.has(token))) {
        safe[field] = token;
      }
    }
    if (kind === 'origin') {
      const origin = originOnly(value);
      if (origin !== undefined) safe[field] = origin;
    }
    if (kind === 'app-origin' && originOnly(value) === 'quorum-app://app') {
      safe[field] = 'quorum-app://app';
    }
    if (kind === 'source') {
      const source = sourceBasename(value);
      if (source !== undefined) safe[field] = source;
    }
  }
  return safe;
}

function createDevDiagnostics({ enabled, logPath }) {
  let sequence = 0;
  let initialized = false;

  function initialize() {
    if (!enabled || initialized) return;
    initialized = true;
    try {
      const directory = path.dirname(logPath);
      fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
      fs.chmodSync(directory, 0o700);
      if (
        fs.existsSync(logPath) &&
        fs.statSync(logPath).size >= MAX_LOG_BYTES
      ) {
        const previousPath = `${logPath}.1`;
        if (fs.existsSync(previousPath)) fs.unlinkSync(previousPath);
        fs.renameSync(logPath, previousPath);
        fs.chmodSync(previousPath, 0o600);
      }
      fs.closeSync(fs.openSync(logPath, 'a', 0o600));
      fs.chmodSync(logPath, 0o600);
    } catch {
      // Diagnostics must never make the application fail to start.
    }
  }

  function log(event, details = {}) {
    if (!enabled || !SCHEMAS[event]) return;
    initialize();
    try {
      const record = {
        ts: new Date().toISOString(),
        seq: ++sequence,
        pid: process.pid,
        event,
        details: sanitizeDetails(event, details),
      };
      let line = `${JSON.stringify(record)}\n`;
      if (Buffer.byteLength(line) > MAX_RECORD_BYTES) {
        line = `${JSON.stringify({ ...record, details: {} })}\n`;
      }
      fs.appendFileSync(logPath, line, { encoding: 'utf8', mode: 0o600 });
    } catch {
      // The log is diagnostic-only; a full disk or permissions error is non-fatal.
    }
  }

  return { enabled, logPath, log };
}

module.exports = {
  MAX_LOG_BYTES,
  MAX_RECORD_BYTES,
  createDevDiagnostics,
  originOnly,
  sanitizeDetails,
  sourceBasename,
};
