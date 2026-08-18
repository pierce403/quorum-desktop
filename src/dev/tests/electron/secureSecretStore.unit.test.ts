import { createRequire } from 'node:module';
import {
  chmodSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
} from 'node:fs';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

interface SecretFileStore {
  get: (key: string) => Promise<string | null>;
  set: (key: string, value: string) => Promise<void>;
  delete: (key: string) => Promise<boolean>;
}

interface SecretStoreModule {
  createSecretFileStore: (options: {
    filePath: string;
    encrypt: (value: string) => string;
    decrypt: (value: string) => string;
    fileSystem?: typeof fs;
  }) => SecretFileStore;
}

const require = createRequire(resolve(process.cwd(), 'package.json'));
const modulePath = resolve(
  process.cwd(),
  'web/electron/secure-secret-store.cjs'
);
const { createSecretFileStore } = require(modulePath) as SecretStoreModule;

let temporaryDirectory: string;
let secretPath: string;

function encrypt(value: string): string {
  return Buffer.from(`encrypted:${value}`, 'utf8').toString('base64');
}

function decrypt(value: string): string {
  return Buffer.from(value, 'base64')
    .toString('utf8')
    .slice('encrypted:'.length);
}

function createStore(fileSystem?: typeof fs): SecretFileStore {
  return createSecretFileStore({
    filePath: secretPath,
    encrypt,
    decrypt,
    fileSystem,
  });
}

describe('Electron secure secret file store', () => {
  beforeEach(() => {
    temporaryDirectory = mkdtempSync(join(tmpdir(), 'quorum-secret-store-'));
    secretPath = join(temporaryDirectory, 'secure-secrets.json');
  });

  afterEach(() => {
    chmodSync(temporaryDirectory, 0o700);
    rmSync(temporaryDirectory, { recursive: true, force: true });
  });

  it('serializes concurrent updates and deletes without losing either key', async () => {
    const store = createStore();

    await Promise.all([
      store.set('farcaster-account', 'account-private-value'),
      store.set('farcaster-signer', 'signer-private-value'),
    ]);
    await expect(store.get('farcaster-account')).resolves.toBe(
      'account-private-value'
    );
    await expect(store.get('farcaster-signer')).resolves.toBe(
      'signer-private-value'
    );

    await Promise.all([
      store.delete('farcaster-account'),
      store.delete('farcaster-signer'),
    ]);
    expect(JSON.parse(readFileSync(secretPath, 'utf8'))).toEqual({});
    expect(readdirSync(temporaryDirectory)).toEqual(['secure-secrets.json']);
    if (process.platform !== 'win32') {
      expect(statSync(secretPath).mode & 0o777).toBe(0o600);
    }
  });

  it('keeps the previous file when an atomic replacement fails', async () => {
    let failNextRename = false;
    const fileSystem = {
      readFile: fs.readFile.bind(fs),
      mkdir: fs.mkdir.bind(fs),
      writeFile: fs.writeFile.bind(fs),
      unlink: fs.unlink.bind(fs),
      rename: async (...args: Parameters<typeof fs.rename>) => {
        if (failNextRename) {
          failNextRename = false;
          throw Object.assign(new Error('simulated rename failure'), {
            code: 'EIO',
          });
        }
        return fs.rename(...args);
      },
    } as typeof fs;
    const store = createStore(fileSystem);

    await store.set('farcaster-account', 'original');
    failNextRename = true;
    await expect(store.set('farcaster-account', 'replacement')).rejects.toThrow(
      'simulated rename failure'
    );

    await expect(store.get('farcaster-account')).resolves.toBe('original');
    expect(readdirSync(temporaryDirectory)).toEqual(['secure-secrets.json']);
  });
});
