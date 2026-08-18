import { createRequire } from 'node:module';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

interface DiagnosticRecord {
  ts: string;
  seq: number;
  pid: number;
  event: string;
  details: Record<string, unknown>;
}

interface DevDiagnosticsModule {
  MAX_LOG_BYTES: number;
  createDevDiagnostics: (options: { enabled: boolean; logPath: string }) => {
    enabled: boolean;
    logPath: string;
    log: (event: string, details?: Record<string, unknown>) => void;
  };
  originOnly: (value: unknown) => string | undefined;
  sanitizeDetails: (event: string, details: unknown) => Record<string, unknown>;
  sourceBasename: (value: unknown) => string | undefined;
}

const require = createRequire(resolve(process.cwd(), 'package.json'));
const modulePath = resolve(process.cwd(), 'web/electron/dev-diagnostics.cjs');
const {
  MAX_LOG_BYTES,
  createDevDiagnostics,
  originOnly,
  sanitizeDetails,
  sourceBasename,
} = require(modulePath) as DevDiagnosticsModule;

const SECRET_CANARY = 'PRIVATE_KEY_CANARY_0123456789abcdef';
const KEY_SHAPED_CANARY = '0x0123456789abcdef0123456789abcdef01234567';

let temporaryDirectory: string;
let logPath: string;

function records(): DiagnosticRecord[] {
  return readFileSync(logPath, 'utf8')
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line) as DiagnosticRecord);
}

describe('Electron development diagnostics', () => {
  beforeEach(() => {
    temporaryDirectory = mkdtempSync(join(tmpdir(), 'quorum-dev-diagnostics-'));
    logPath = join(temporaryDirectory, 'logs', 'quorum-dev.ndjson');
  });

  afterEach(() => {
    rmSync(temporaryDirectory, { recursive: true, force: true });
  });

  it('does not create a file when diagnostics are disabled', () => {
    const diagnostics = createDevDiagnostics({ enabled: false, logPath });
    diagnostics.log('app.ready', { persistentSession: true });

    expect(existsSync(logPath)).toBe(false);
  });

  it('writes only fixed-schema metadata and excludes secret or plaintext canaries', () => {
    const diagnostics = createDevDiagnostics({ enabled: true, logPath });
    diagnostics.log('onboarding.event', {
      action: 'display-name-submit',
      step: 'display-name',
      outcome: 'blocked-invalid',
      hasAccount: true,
      valid: false,
      completed: false,
      accountCount: 1,
      privateKey: SECRET_CANARY,
      keyset: { ratchetKey: SECRET_CANARY },
      message: `plaintext ${SECRET_CANARY}`,
      content: SECRET_CANARY,
    });
    diagnostics.log('onboarding.event', {
      action: KEY_SHAPED_CANARY,
      step: KEY_SHAPED_CANARY,
      outcome: KEY_SHAPED_CANARY,
      accountCount: -1,
    });
    diagnostics.log('storage.snapshot', {
      origin: `https://${KEY_SHAPED_CANARY}.example/private`,
      metadataStatus: KEY_SHAPED_CANARY,
      accountCount: -1,
      completedCount: 1_000_001,
      keyDbVersion: -1,
      quorumDbVersion: 1_000_001,
    });
    diagnostics.log('renderer.error', {
      kind: KEY_SHAPED_CANARY,
      errorName: KEY_SHAPED_CANARY,
      source: `${KEY_SHAPED_CANARY}.js`,
      line: -1,
      column: 10_000_001,
    });
    diagnostics.log('renderer.window-control', {
      action: KEY_SHAPED_CANARY,
    });

    const raw = readFileSync(logPath, 'utf8');
    expect(raw).not.toContain(SECRET_CANARY);
    expect(raw).not.toContain(KEY_SHAPED_CANARY);
    expect(raw).not.toContain('plaintext');
    expect(records()[0]?.details).toEqual({
      action: 'display-name-submit',
      step: 'display-name',
      outcome: 'blocked-invalid',
      hasAccount: true,
      valid: false,
      completed: false,
      accountCount: 1,
    });
    expect(
      records()
        .slice(1)
        .map((record) => record.details)
    ).toEqual([{}, {}, {}, {}]);
  });

  it('sanitizes origins to origins, including the custom Electron scheme', () => {
    expect(originOnly('https://example.com/path?token=secret#fragment')).toBe(
      'https://example.com'
    );
    expect(originOnly('quorum-app://app/settings?token=secret')).toBe(
      'quorum-app://app'
    );
    expect(originOnly('file:///tmp/quorum/index.html?token=secret')).toBe(
      'file://'
    );
    expect(originOnly('data:text/plain,secret')).toBeUndefined();
    expect(originOnly('not a url')).toBeUndefined();
  });

  it('reduces renderer sources to safe basenames without data URL payloads', () => {
    expect(
      sourceBasename('https://example.com/assets/renderer.js?token=secret')
    ).toBe('renderer.js');
    expect(
      sourceBasename('quorum-app://app/assets/index-abc123.js#secret')
    ).toBe('index-abc123.js');
    expect(sourceBasename('/workspace/src/main.tsx')).toBe('main.tsx');
    expect(
      sourceBasename(`data:text/javascript,${SECRET_CANARY}`)
    ).toBeUndefined();
    expect(
      sourceBasename('https://example.com/assets/plain text.js')
    ).toBeUndefined();
    expect(sourceBasename(KEY_SHAPED_CANARY)).toBeUndefined();
  });

  it('keeps database versions as safe integers and rejects other value shapes', () => {
    expect(
      sanitizeDetails('storage.snapshot', {
        origin: 'quorum-app://app/path',
        metadataStatus: 'valid',
        accountCount: 2,
        completedCount: 1,
        fallbackCredential: false,
        keyDbPresent: true,
        keyDbVersion: 4,
        quorumDbPresent: true,
        quorumDbVersion: 7,
      })
    ).toEqual({
      origin: 'quorum-app://app',
      metadataStatus: 'valid',
      accountCount: 2,
      completedCount: 1,
      fallbackCredential: false,
      keyDbPresent: true,
      keyDbVersion: 4,
      quorumDbPresent: true,
      quorumDbVersion: 7,
    });

    expect(
      sanitizeDetails('storage.snapshot', {
        accountCount: 1.5,
        completedCount: 1_000_001,
        keyDbVersion: '4',
        quorumDbVersion: -1,
      })
    ).toEqual({});
  });

  it('records only allow-listed DOM exception names', () => {
    expect(
      sanitizeDetails('renderer.error', {
        kind: 'unhandled-dom-exception',
        errorName: 'OperationError',
      })
    ).toEqual({
      kind: 'unhandled-dom-exception',
      errorName: 'OperationError',
    });
    expect(
      sanitizeDetails('renderer.error', {
        kind: 'unhandled-dom-exception',
        errorName: SECRET_CANARY,
      })
    ).toEqual({ kind: 'unhandled-dom-exception' });
  });

  it('accepts only fixed registration lifecycle tokens', () => {
    expect(
      sanitizeDetails('registration.event', {
        stage: 'export-account-key',
        outcome: 'started',
        registered: true,
      })
    ).toEqual({
      stage: 'export-account-key',
      outcome: 'started',
      registered: true,
    });

    expect(
      sanitizeDetails('registration.event', {
        stage: SECRET_CANARY,
        outcome: SECRET_CANARY,
        registered: SECRET_CANARY,
      })
    ).toEqual({});
  });

  it('rotates one prior log and enforces private directory and file modes', () => {
    mkdirSync(dirname(logPath), { recursive: true, mode: 0o755 });
    chmodSync(dirname(logPath), 0o755);
    writeFileSync(logPath, Buffer.alloc(MAX_LOG_BYTES, 0x78), { mode: 0o644 });
    writeFileSync(`${logPath}.1`, 'stale backup', { mode: 0o644 });

    const diagnostics = createDevDiagnostics({ enabled: true, logPath });
    diagnostics.log('app.ready', { persistentSession: true });

    expect(statSync(`${logPath}.1`).size).toBe(MAX_LOG_BYTES);
    expect(records()).toHaveLength(1);
    expect(records()[0]).toMatchObject({
      seq: 1,
      event: 'app.ready',
      details: { persistentSession: true },
    });
    if (process.platform !== 'win32') {
      expect(statSync(dirname(logPath)).mode & 0o777).toBe(0o700);
      expect(statSync(logPath).mode & 0o777).toBe(0o600);
      expect(statSync(`${logPath}.1`).mode & 0o777).toBe(0o600);
    }
  });
});
