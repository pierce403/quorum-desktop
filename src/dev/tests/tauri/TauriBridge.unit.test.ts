import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { initTauriBridge } from '../../../adapters/tauri/tauriBridge';
import { isTauri, isDesktop, isElectron } from '../../../utils/platform';
import { invoke } from '@tauri-apps/api/core';

let isTauriEnv = false;

vi.mock('@tauri-apps/api/core', () => ({
  isTauri: () => isTauriEnv,
  invoke: vi.fn(),
}));

describe('TauriBridge', () => {
  const originalElectron = window.electron;

  beforeEach(() => {
    isTauriEnv = false;
    delete (window as unknown as Record<string, unknown>).electron;
    vi.mocked(invoke).mockReset();
  });

  afterEach(() => {
    window.electron = originalElectron;
  });

  it('returns false and does not shim if not running in Tauri', () => {
    const initialized = initTauriBridge();
    expect(initialized).toBe(false);
    expect(window.electron).toBeUndefined();
    expect(isTauri()).toBe(false);
  });

  it('detects Tauri, initializes window.electron, and provides 1:1 bridge APIs', async () => {
    isTauriEnv = true;
    Object.defineProperty(window, '__TAURI_INTERNALS__', {
      value: {},
      configurable: true,
      writable: true,
    });

    expect(isTauri()).toBe(true);
    expect(isDesktop()).toBe(true);
    expect(isElectron()).toBe(true);

    vi.mocked(invoke).mockImplementation(async (cmd, args) => {
      if (cmd === 'get_platform') return 'linux';
      if (cmd === 'secure_storage_status') return { available: true, backend: 'secret-service' };
      if (cmd === 'secure_storage_get') return `value-for-${(args as { key: string }).key}`;
      if (cmd === 'secure_storage_set') return undefined;
      if (cmd === 'secure_storage_delete') return true;
      if (cmd === 'clipboard_copy_secret') return 60000;
      if (cmd === 'http_fetch') return { status: 200, body: '{"ok":true}', ok: true };
      return undefined;
    });

    const initialized = initTauriBridge();
    expect(initialized).toBe(true);
    expect(window.electron).toBeDefined();

    // Verify window controls
    window.electron?.windowControls.minimize();
    expect(invoke).toHaveBeenCalledWith('window_minimize');

    window.electron?.windowControls.maximize();
    expect(invoke).toHaveBeenCalledWith('window_maximize');

    window.electron?.windowControls.close();
    expect(invoke).toHaveBeenCalledWith('window_close');

    // Verify openLogin
    await window.electron?.openLogin();
    expect(invoke).toHaveBeenCalledWith('open_login');

    // Verify clipboard copy secret
    const delay = await window.electron?.clipboard.copySecret('super-secret');
    expect(delay).toBe(60000);
    expect(invoke).toHaveBeenCalledWith('clipboard_copy_secret', { text: 'super-secret' });

    // Verify secure storage status
    const status = await window.electron?.secureStorage.status();
    expect(status).toEqual({ available: true, backend: 'secret-service' });

    // Verify secure storage set, get, delete
    await window.electron?.secureStorage.set('farcaster-account', 'test-data');
    expect(invoke).toHaveBeenCalledWith('secure_storage_set', {
      key: 'farcaster-account',
      value: 'test-data',
    });

    const retrieved = await window.electron?.secureStorage.get('farcaster-account');
    expect(retrieved).toBe('value-for-farcaster-account');

    const deleted = await window.electron?.secureStorage.delete('farcaster-account');
    expect(deleted).toBe(true);

    // Verify httpFetch
    const httpRes = await window.electron?.httpFetch?.({
      url: 'https://client.farcaster.xyz/v2/onboarding-state',
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    });
    expect(httpRes).toEqual({ status: 200, body: '{"ok":true}', ok: true });
    expect(invoke).toHaveBeenCalledWith('http_fetch', {
      url: 'https://client.farcaster.xyz/v2/onboarding-state',
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    });

    delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__;
  });
});
