import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { initTauriBridge } from '../../../adapters/tauri/tauriBridge';
import {
  getFarcasterStorageStatus,
  loadDesktopFarcasterAccount,
  disconnectDesktopFarcasterAccount,
  desktopFarcasterSignerStore,
} from '../../../services/FarcasterAccountService';
import { invoke } from '@tauri-apps/api/core';

vi.mock('@tauri-apps/api/core', () => ({
  isTauri: () => true,
  invoke: vi.fn(),
}));

describe('Farcaster Tauri Integration', () => {
  const originalElectron = window.electron;
  const inMemoryStore = new Map<string, string>();

  beforeEach(() => {
    inMemoryStore.clear();
    delete (window as unknown as Record<string, unknown>).electron;

    vi.mocked(invoke).mockImplementation(async (cmd, args) => {
      if (cmd === 'secure_storage_status') {
        return { available: true, backend: 'secret-service' };
      }
      if (cmd === 'secure_storage_get') {
        const key = (args as { key: string }).key;
        return inMemoryStore.get(key) || null;
      }
      if (cmd === 'secure_storage_set') {
        const { key, value } = args as { key: string; value: string };
        inMemoryStore.set(key, value);
        return undefined;
      }
      if (cmd === 'secure_storage_delete') {
        const key = (args as { key: string }).key;
        const exists = inMemoryStore.has(key);
        inMemoryStore.delete(key);
        return exists;
      }
      return undefined;
    });

    initTauriBridge();
  });

  afterEach(() => {
    window.electron = originalElectron;
    vi.restoreAllMocks();
  });

  it('queries secure storage status via Tauri bridge', async () => {
    const status = await getFarcasterStorageStatus();
    expect(status).toEqual({ available: true, backend: 'secret-service' });
  });

  it('persists and loads Farcaster account records through Tauri secure storage', async () => {
    const mockAccount = {
      fid: 12345,
      username: 'vitalik.eth',
      displayName: 'Vitalik Buterin',
      pfpUrl: 'https://example.com/pfp.png',
      custodyAddress: '0x1234567890abcdef',
      connectedAt: '2026-08-18T00:00:00.000Z',
    };

    await window.electron?.secureStorage.set('farcaster-account', JSON.stringify(mockAccount));

    const loaded = await loadDesktopFarcasterAccount();
    expect(loaded).toEqual(mockAccount);
  });

  it('saves, retrieves, and clears signer key records through desktopFarcasterSignerStore', async () => {
    const mockSigner = {
      fid: 12345,
      signerPublicKeyHex: '0xabcdef0123456789',
      signerPrivateKeyHex: '0x9876543210fedcba',
      addedAt: '2026-08-18T00:00:00.000Z',
      lastSignerNonce: 1,
    };

    await desktopFarcasterSignerStore.save(mockSigner);
    const retrieved = await desktopFarcasterSignerStore.get();
    expect(retrieved).toEqual(mockSigner);

    await desktopFarcasterSignerStore.clear();
    const afterClear = await desktopFarcasterSignerStore.get();
    expect(afterClear).toBeNull();
  });

  it('disconnects Farcaster account by clearing both account and signer storage slots', async () => {
    await window.electron?.secureStorage.set('farcaster-account', JSON.stringify({ fid: 1 }));
    await window.electron?.secureStorage.set('farcaster-signer', JSON.stringify({ fid: 1 }));

    expect(inMemoryStore.size).toBe(2);

    await disconnectDesktopFarcasterAccount();
    expect(inMemoryStore.size).toBe(0);
  });

  it('imports account correctly when API returns user at root of result', async () => {
    const testPhrase = 'test test test test test test test test test test test junk';

    vi.mocked(invoke).mockImplementation(async (cmd, args) => {
      if (cmd === 'secure_storage_status') {
        return { available: true, backend: 'secret-service' };
      }
      if (cmd === 'secure_storage_get') {
        const key = (args as { key: string }).key;
        return inMemoryStore.get(key) || null;
      }
      if (cmd === 'secure_storage_set') {
        const { key, value } = args as { key: string; value: string };
        inMemoryStore.set(key, value);
        return undefined;
      }
      if (cmd === 'http_fetch') {
        const url = (args as { url: string }).url;
        if (url.includes('/v2/onboarding-state')) {
          return {
            status: 200,
            ok: true,
            body: JSON.stringify({
              result: {
                user: {
                  fid: 98765,
                  username: 'alice',
                  displayName: 'Alice Wonderland',
                  pfp: { url: 'https://example.com/alice.png' },
                },
                token: { secret: 'farcaster-secret-token' },
              },
            }),
          };
        }
      }
      return undefined;
    });

    const { importDesktopFarcasterAccount } = await import('../../../services/FarcasterAccountService');
    const account = await importDesktopFarcasterAccount(testPhrase);

    expect(account.fid).toBe(98765);
    expect(account.username).toBe('alice');
    expect(account.authToken).toBe('farcaster-secret-token');
  });
});
