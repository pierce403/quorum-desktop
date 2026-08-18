import { passkey } from '@quilibrium/quilibrium-js-sdk-channels';

const KEY_DB_NAME = 'KeyDB';
const KEY_DB_VERSION = 1;
const KEY_STORE_NAME = 'KeyObjectStore';

interface StoredEncryptedRecord {
  keys: CryptoKey;
  encrypted: {
    ciphertext: ArrayBuffer;
    iv: ArrayBuffer | ArrayBufferView;
  };
}

function isStoredEncryptedRecord(
  value: unknown
): value is StoredEncryptedRecord {
  if (!value || typeof value !== 'object') return false;
  const record = value as Partial<StoredEncryptedRecord>;
  return Boolean(
    record.keys &&
    record.encrypted &&
    typeof record.encrypted === 'object' &&
    'ciphertext' in record.encrypted &&
    'iv' in record.encrypted
  );
}

/**
 * Reads an SDK KeyDB record while correctly forwarding asynchronous decrypt
 * failures to the caller. The SDK's current loader awaits inside an IndexedDB
 * callback without catching, which can leave its returned Promise pending and
 * surface only a global unhandled rejection when a stored record is damaged.
 */
export function loadKeyDecryptDataSafely(id: number): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    let settled = false;
    let database: IDBDatabase | undefined;

    const finish = (
      outcome: { data: Uint8Array } | { error: unknown }
    ): void => {
      if (settled) return;
      settled = true;
      database?.close();
      if ('data' in outcome) resolve(outcome.data);
      else reject(outcome.error);
    };

    let openRequest: IDBOpenDBRequest;
    try {
      openRequest = window.indexedDB.open(KEY_DB_NAME, KEY_DB_VERSION);
    } catch (error) {
      finish({ error });
      return;
    }

    openRequest.onblocked = () =>
      finish({
        error: new DOMException('Key database is blocked', 'AbortError'),
      });
    openRequest.onerror = () =>
      finish({
        error:
          openRequest.error ??
          new DOMException('Key database could not be opened', 'UnknownError'),
      });
    openRequest.onupgradeneeded = () => {
      if (!openRequest.result.objectStoreNames.contains(KEY_STORE_NAME)) {
        openRequest.result.createObjectStore(KEY_STORE_NAME, { keyPath: 'id' });
      }
    };
    openRequest.onsuccess = () => {
      database = openRequest.result;

      let transaction: IDBTransaction;
      let getRequest: IDBRequest;
      try {
        transaction = database.transaction(KEY_STORE_NAME, 'readonly');
        getRequest = transaction.objectStore(KEY_STORE_NAME).get(id);
      } catch (error) {
        finish({ error });
        return;
      }

      transaction.onabort = () =>
        finish({
          error:
            transaction.error ??
            new DOMException('Key database transaction aborted', 'AbortError'),
        });
      transaction.onerror = () =>
        finish({
          error:
            transaction.error ??
            new DOMException('Key database transaction failed', 'UnknownError'),
        });
      getRequest.onerror = () =>
        finish({
          error:
            getRequest.error ??
            new DOMException('Stored key could not be read', 'UnknownError'),
        });
      getRequest.onsuccess = () => {
        if (!isStoredEncryptedRecord(getRequest.result)) {
          finish({
            error: new DOMException(
              'Stored key is unavailable',
              'NotFoundError'
            ),
          });
          return;
        }

        const record = getRequest.result;
        void passkey
          .decrypt(
            record.encrypted.ciphertext,
            record.encrypted.iv,
            record.keys
          )
          .then((data) => finish({ data }))
          .catch((error) => finish({ error }));
      };
    };
  });
}
