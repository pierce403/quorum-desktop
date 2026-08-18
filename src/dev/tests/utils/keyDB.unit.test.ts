import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  decrypt: vi.fn(),
}));

vi.mock('@quilibrium/quilibrium-js-sdk-channels', () => ({
  passkey: { decrypt: mocks.decrypt },
}));

import { loadKeyDecryptDataSafely } from '@/utils/keyDB';

const originalIndexedDB = Object.getOwnPropertyDescriptor(window, 'indexedDB');

function installKeyDatabase(record: unknown) {
  const getRequest: Record<string, unknown> = {
    result: record,
    error: null,
  };
  const store = {
    get: vi.fn(() => {
      queueMicrotask(() => {
        (getRequest.onsuccess as (() => void) | undefined)?.();
      });
      return getRequest;
    }),
  };
  const transaction: Record<string, unknown> = {
    error: null,
    objectStore: vi.fn(() => store),
  };
  const database = {
    objectStoreNames: { contains: vi.fn(() => true) },
    transaction: vi.fn(() => transaction),
    createObjectStore: vi.fn(),
    close: vi.fn(),
  };
  const openRequest: Record<string, unknown> = {
    result: database,
    error: null,
  };
  const indexedDB = {
    open: vi.fn(() => {
      queueMicrotask(() => {
        (openRequest.onsuccess as (() => void) | undefined)?.();
      });
      return openRequest;
    }),
  };

  Object.defineProperty(window, 'indexedDB', {
    configurable: true,
    value: indexedDB,
  });

  return { database, indexedDB, store };
}

describe('safe SDK KeyDB loader', () => {
  beforeEach(() => {
    mocks.decrypt.mockReset();
  });

  afterEach(() => {
    if (originalIndexedDB) {
      Object.defineProperty(window, 'indexedDB', originalIndexedDB);
    } else {
      Reflect.deleteProperty(window, 'indexedDB');
    }
  });

  it('resolves decrypted bytes and closes the database', async () => {
    const stored = {
      keys: {} as CryptoKey,
      encrypted: {
        ciphertext: new ArrayBuffer(4),
        iv: new Uint8Array(12),
      },
    };
    const { database, store } = installKeyDatabase(stored);
    mocks.decrypt.mockResolvedValue(new Uint8Array([1, 2, 3]));

    await expect(loadKeyDecryptDataSafely(2)).resolves.toEqual(
      new Uint8Array([1, 2, 3])
    );
    expect(store.get).toHaveBeenCalledWith(2);
    expect(database.close).toHaveBeenCalledOnce();
  });

  it('rejects instead of hanging when WebCrypto cannot decrypt a record', async () => {
    installKeyDatabase({
      keys: {} as CryptoKey,
      encrypted: {
        ciphertext: new ArrayBuffer(4),
        iv: new Uint8Array(12),
      },
    });
    mocks.decrypt.mockRejectedValue(
      new DOMException('private canary must not be logged', 'OperationError')
    );

    await expect(loadKeyDecryptDataSafely(2)).rejects.toMatchObject({
      name: 'OperationError',
    });
  });

  it('rejects a missing record with a fixed error type', async () => {
    installKeyDatabase(undefined);

    await expect(loadKeyDecryptDataSafely(2)).rejects.toMatchObject({
      name: 'NotFoundError',
    });
    expect(mocks.decrypt).not.toHaveBeenCalled();
  });
});
