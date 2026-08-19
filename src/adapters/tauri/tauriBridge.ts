import { invoke, isTauri } from '@tauri-apps/api/core';

export interface DesktopBridge {
  platform: string;
  devServerUrl?: string;
  windowControls: {
    minimize: () => void | Promise<void>;
    maximize: () => void | Promise<void>;
    close: () => void | Promise<void>;
  };
  openLogin: () => Promise<void>;
  clipboard: {
    copySecret: (text: string) => Promise<number>;
  };
  secureStorage: {
    status: () => Promise<{ available: boolean; backend: string }>;
    get: (key: string) => Promise<string | null>;
    set: (key: string, value: string) => Promise<void>;
    delete: (key: string) => Promise<boolean>;
  };
  httpFetch?: (options: {
    url: string;
    method?: string;
    headers?: Record<string, string>;
    body?: string;
  }) => Promise<{ status: number; body: string; ok: boolean }>;
  devDiagnostics?: {
    onboarding: (details: unknown) => void;
    registration: (details: unknown) => void;
    storageSnapshot: (details: unknown) => void;
    rendererError: (details: unknown) => void;
  };
}

declare global {
  interface Window {
    electron?: DesktopBridge;
    __TAURI_INTERNALS__?: unknown;
  }
}

function detectPlatform(): string {
  if (typeof navigator !== 'undefined' && navigator.userAgent) {
    if (navigator.userAgent.includes('Macintosh') || navigator.userAgent.includes('Mac OS')) {
      return 'darwin';
    }
    if (navigator.userAgent.includes('Windows')) {
      return 'win32';
    }
  }
  return 'linux';
}

export function initTauriBridge(): boolean {
  if (!isTauri()) {
    return false;
  }

  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      window.localStorage.setItem('quorum-master-prf-incompatibility', 'true');
    }
  } catch (_e) {
    // Ignore localStorage access failure
  }

  // If running in Tauri and window.electron is not set, shim it
  if (!window.electron) {
    const tauriBridge: DesktopBridge = {
      platform: detectPlatform(),
      windowControls: {
        minimize: () => {
          void invoke('window_minimize');
        },
        maximize: () => {
          void invoke('window_maximize');
        },
        close: () => {
          void invoke('window_close');
        },
      },
      openLogin: async () => {
        await invoke('open_login');
      },
      clipboard: {
        copySecret: async (text: string) => {
          return await invoke<number>('clipboard_copy_secret', { text });
        },
      },
      secureStorage: {
        status: async () => {
          return await invoke<{ available: boolean; backend: string }>('secure_storage_status');
        },
        get: async (key: string) => {
          return await invoke<string | null>('secure_storage_get', { key });
        },
        set: async (key: string, value: string) => {
          await invoke('secure_storage_set', { key, value });
        },
        delete: async (key: string) => {
          return await invoke<boolean>('secure_storage_delete', { key });
        },
      },
      httpFetch: async (options) => {
        return await invoke<{ status: number; body: string; ok: boolean }>('http_fetch', {
          url: options.url,
          method: options.method,
          headers: options.headers,
          body: options.body,
        });
      },
      devDiagnostics: {
        onboarding: () => {},
        registration: () => {},
        storageSnapshot: () => {},
        rendererError: () => {},
      },
    };

    window.electron = tauriBridge;

    // Async update platform accurately from Rust
    void invoke<string>('get_platform')
      .then((plat) => {
        if (window.electron && plat) {
          window.electron.platform = plat;
        }
      })
      .catch(() => {});
  }

  return true;
}
