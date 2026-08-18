import { act, renderHook, waitFor } from '@testing-library/react';
import { i18n } from '@lingui/core';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { messages } from '@/i18n/en/messages';

const mocks = vi.hoisted(() => ({
  adapter: {
    currentPasskeyInfo: null as null | {
      credentialId: string;
      address: string;
      publicKey: string;
      displayName?: string;
      pfpUrl?: string;
      completedOnboarding?: boolean;
    },
    updateStoredPasskey: vi.fn(),
    exportKey: vi.fn(),
  },
  flow: {
    step: 'idle',
    error: null as null | {
      code: string;
      message?: string;
      rawMessage?: string;
    },
    isImportMode: false,
    isPasskeySupported: false,
    canRetry: true,
    address: null,
    proceedWithoutPasskey: vi.fn(),
    startRegistration: vi.fn(),
    completeRegistration: vi.fn(),
    importKeyFile: vi.fn(),
    retry: vi.fn(),
  },
  flowOptions: null as null | {
    onStepChange: (step: string) => void;
    onError: (error: {
      code: string;
      message?: string;
      rawMessage?: string;
    }) => void;
  },
  apiClient: {
    getUser: vi.fn(),
    getUserSettings: vi.fn(),
  },
  uploadRegistration: vi.fn(),
  downloadKey: vi.fn(),
  loadKeyDecryptData: vi.fn(),
  createKeyFromBuffer: vi.fn(),
  decrypt: vi.fn(),
  showWarning: vi.fn(),
  logOnboardingEvent: vi.fn(),
  setUser: vi.fn(),
}));

vi.mock('@quilibrium/quilibrium-js-sdk-channels', () => ({
  usePasskeyFlow: (options: typeof mocks.flowOptions) => {
    mocks.flowOptions = options;
    return mocks.flow;
  },
  passkey: {
    loadKeyDecryptData: (...args: unknown[]) =>
      mocks.loadKeyDecryptData(...args),
    createKeyFromBuffer: (...args: unknown[]) =>
      mocks.createKeyFromBuffer(...args),
    decrypt: (...args: unknown[]) => mocks.decrypt(...args),
  },
}));

vi.mock('@/hooks/platform/user/usePasskeyAdapter', () => ({
  usePasskeyAdapter: () => mocks.adapter,
}));

vi.mock('@/components/context/QuorumApiContext', () => ({
  useQuorumApiClient: () => ({ apiClient: mocks.apiClient }),
}));

vi.mock('@/hooks/mutations/useUploadRegistration', () => ({
  useUploadRegistration: () => mocks.uploadRegistration,
}));

vi.mock('@/hooks/useKeyBackup', () => ({
  useKeyBackup: () => ({ downloadKey: mocks.downloadKey }),
}));

vi.mock('@/hooks/business/validation', () => ({
  validateDisplayName: (name: string) =>
    name.trim().length > 0 ? undefined : 'required',
}));

vi.mock('@/utils', () => ({
  DefaultImages: { UNKNOWN_USER: 'unknown-user' },
}));

vi.mock('@/utils/crypto', () => ({
  decryptUserConfig: vi.fn(),
}));

vi.mock('@/utils/toast', () => ({
  showWarning: (...args: unknown[]) => mocks.showWarning(...args),
}));

vi.mock('@/utils/devDiagnostics', () => ({
  logOnboardingEvent: (...args: unknown[]) => mocks.logOnboardingEvent(...args),
}));

import { useUnifiedOnboardingFlow } from '@/hooks/business/user/useUnifiedOnboardingFlow';

beforeAll(() => {
  i18n.load('en', messages);
  i18n.activate('en');
});

async function renderFlow() {
  const hook = renderHook(() =>
    useUnifiedOnboardingFlow({ setUser: mocks.setUser })
  );
  await waitFor(() => expect(hook.result.current.step).toBe('welcome'));
  return hook;
}

describe('useUnifiedOnboardingFlow fallback registration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.adapter.currentPasskeyInfo = null;
    mocks.flow.step = 'idle';
    mocks.flow.error = null;
    mocks.flow.isImportMode = false;
    mocks.flow.isPasskeySupported = false;
    mocks.flow.canRetry = true;
    mocks.flow.address = null;
    mocks.flowOptions = null;
    mocks.flow.proceedWithoutPasskey.mockResolvedValue(undefined);
    mocks.flow.startRegistration.mockResolvedValue(undefined);
    mocks.flow.completeRegistration.mockResolvedValue(undefined);
    mocks.flow.importKeyFile.mockResolvedValue(undefined);
    mocks.downloadKey.mockResolvedValue(undefined);
    mocks.adapter.exportKey.mockResolvedValue('00'.repeat(57));
    mocks.loadKeyDecryptData.mockResolvedValue(
      Buffer.from(JSON.stringify({ ciphertext: [], iv: [] }))
    );
    mocks.createKeyFromBuffer.mockResolvedValue({});
    mocks.decrypt.mockResolvedValue(
      Buffer.from(
        JSON.stringify({ identity: { user_key: { private_key: [1] } } })
      )
    );
    mocks.apiClient.getUserSettings.mockResolvedValue({ data: {} });
  });

  it('does not advance until the SDK reports registration success', async () => {
    const { result } = await renderFlow();

    await act(async () => {
      await result.current.startNewAccount();
    });

    expect(mocks.flow.proceedWithoutPasskey).toHaveBeenCalledOnce();
    expect(result.current.step).toBe('loading');
  });

  it('advances to key backup when the SDK reports success', async () => {
    mocks.flow.proceedWithoutPasskey.mockImplementation(async () => {
      mocks.flowOptions?.onStepChange('success');
    });
    const { result } = await renderFlow();

    await act(async () => {
      await result.current.startNewAccount();
    });

    expect(result.current.step).toBe('backup-key');
  });

  it('routes an SDK-managed registration failure to the retryable create step', async () => {
    const sdkError = {
      code: 'storage_failed',
      rawMessage: 'private failure details',
    };
    mocks.flow.proceedWithoutPasskey.mockImplementation(async () => {
      mocks.flow.error = sdkError;
      mocks.flow.canRetry = false;
      mocks.flowOptions?.onError(sdkError);
    });
    const { result } = await renderFlow();

    await act(async () => {
      await result.current.startNewAccount();
    });

    expect(result.current.step).toBe('create-passkey-1a');
    expect(result.current.passkeyError).toBe(sdkError);
    expect(result.current.canRetry).toBe(false);
  });

  it('surfaces an SDK-managed import failure without exposing raw details', async () => {
    const sdkError = {
      code: 'invalid_file',
      rawMessage: 'SECRET RAW IMPORT FAILURE',
    };
    mocks.flow.importKeyFile.mockImplementation(async () => {
      mocks.flow.error = sdkError;
      mocks.flow.canRetry = true;
      mocks.flowOptions?.onError(sdkError);
    });
    const { result } = await renderFlow();

    act(() => {
      result.current.startImportAccount();
    });
    await act(async () => {
      await result.current.importKeyFile(
        new File(['invalid'], 'invalid.key', { type: 'text/plain' })
      );
    });

    expect(result.current.step).toBe('import-key');
    expect(result.current.importError).toBe(
      'Could not import that account key. Check the file or key and try again.'
    );
    expect(result.current.importError).not.toContain(sdkError.rawMessage);
    expect(JSON.stringify(mocks.logOnboardingEvent.mock.calls)).not.toContain(
      sdkError.rawMessage
    );
  });

  it('sanitizes a directly rejected import failure', async () => {
    mocks.flow.importKeyFile.mockRejectedValue(
      new Error('SECRET DIRECT IMPORT FAILURE')
    );
    const { result } = await renderFlow();

    act(() => {
      result.current.startImportAccount();
    });
    await act(async () => {
      await result.current.importKeyFile(
        new File(['invalid'], 'invalid.key', { type: 'text/plain' })
      );
    });

    expect(result.current.step).toBe('import-key');
    expect(result.current.importError).toBe(
      'Could not import that account key. Check the file or key and try again.'
    );
    expect(result.current.importError).not.toContain('SECRET');
  });

  it.each([
    [null, 'create-passkey-1a'],
    [
      {
        credentialId: 'stored-credential',
        address: 'stored-address',
        publicKey: 'stored-public-key',
      },
      'backup-key',
    ],
  ])(
    'routes save-key failure with account %s to %s',
    async (account, expectedStep) => {
      const sdkError = {
        code: 'storage_failed',
        rawMessage: 'not logged',
      };
      const { result } = await renderFlow();

      act(() => {
        mocks.flowOptions?.onStepChange('awaiting_completion');
      });
      expect(result.current.step).toBe('save-key-to-passkey');

      mocks.adapter.currentPasskeyInfo = account;
      mocks.flow.error = sdkError;
      mocks.flow.canRetry = false;
      act(() => {
        mocks.flowOptions?.onError(sdkError);
      });

      expect(result.current.step).toBe(expectedStep);
      expect(result.current.passkeyError).toBe(sdkError);
    }
  );

  it('retries imported-profile sync when account context hydrates after SDK success', async () => {
    const hook = await renderFlow();

    act(() => {
      hook.result.current.startImportAccount();
    });
    act(() => {
      mocks.flow.step = 'success';
      mocks.flowOptions?.onStepChange('success');
    });

    expect(hook.result.current.step).toBe('loading');
    expect(mocks.apiClient.getUserSettings).not.toHaveBeenCalled();

    mocks.adapter.currentPasskeyInfo = {
      credentialId: 'imported-credential',
      address: 'imported-address',
      publicKey: 'imported-public-key',
      completedOnboarding: false,
    };
    hook.rerender();

    await waitFor(() => expect(hook.result.current.step).toBe('backup-key'));
    expect(mocks.adapter.exportKey).toHaveBeenCalledOnce();
    expect(mocks.apiClient.getUserSettings).toHaveBeenCalledOnce();
  });

  it('blocks display-name submission while account context is missing', async () => {
    const { result } = await renderFlow();

    act(() => {
      result.current.skipKeyBackup();
      result.current.setDisplayName('Test User');
    });

    expect(result.current.step).toBe('display-name');
    expect(result.current.canProceedWithName).toBe(false);

    act(() => {
      result.current.saveDisplayName();
    });

    expect(mocks.adapter.updateStoredPasskey).not.toHaveBeenCalled();
    expect(mocks.showWarning).toHaveBeenCalledOnce();
    expect(mocks.logOnboardingEvent).toHaveBeenCalledWith({
      action: 'display-name-submit',
      step: 'display-name',
      outcome: 'blocked-no-account',
      hasAccount: false,
      valid: true,
      completed: false,
    });
    expect(result.current.step).toBe('display-name');
  });

  it('enables and persists the name after fallback account context hydrates', async () => {
    mocks.flow.proceedWithoutPasskey.mockImplementation(async () => {
      mocks.flowOptions?.onStepChange('success');
    });
    const hook = await renderFlow();

    await act(async () => {
      await hook.result.current.startNewAccount();
    });
    act(() => {
      hook.result.current.skipKeyBackup();
      hook.result.current.setDisplayName('Hydrated User');
    });

    expect(hook.result.current.step).toBe('display-name');
    expect(hook.result.current.canProceedWithName).toBe(false);

    mocks.adapter.currentPasskeyInfo = {
      credentialId: 'not-passkey',
      address: 'hydrated-address',
      publicKey: 'hydrated-public-key',
      completedOnboarding: false,
    };
    hook.rerender();

    expect(hook.result.current.canProceedWithName).toBe(true);
    act(() => {
      hook.result.current.saveDisplayName();
    });

    expect(mocks.adapter.updateStoredPasskey).toHaveBeenCalledWith(
      'not-passkey',
      expect.objectContaining({
        credentialId: 'not-passkey',
        address: 'hydrated-address',
        publicKey: 'hydrated-public-key',
        displayName: 'Hydrated User',
        completedOnboarding: false,
      })
    );
    expect(hook.result.current.step).toBe('profile-photo');
  });

  it.each([
    [{}, 'backup-key'],
    [{ displayName: '   ' }, 'backup-key'],
    [{ displayName: 'Saved User' }, 'profile-photo'],
    [{ displayName: 'Saved User', pfpUrl: 'saved-profile-image' }, 'complete'],
  ])(
    'resumes an incomplete stored account at %s metadata as %s',
    async (profile, expectedStep) => {
      mocks.adapter.currentPasskeyInfo = {
        credentialId: 'stored-credential',
        address: 'stored-address',
        publicKey: 'stored-public-key',
        completedOnboarding: false,
        ...profile,
      };

      const { result } = renderHook(() =>
        useUnifiedOnboardingFlow({ setUser: mocks.setUser })
      );

      await waitFor(() => expect(result.current.step).toBe(expectedStep));
      expect(result.current.displayName).toBe(profile.displayName ?? '');
      expect(mocks.logOnboardingEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'returning-user-check',
          step: expectedStep,
          outcome: 'restored',
          hasAccount: true,
          completed: false,
        })
      );
    }
  );
});
