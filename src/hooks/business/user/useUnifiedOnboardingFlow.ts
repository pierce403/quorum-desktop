import { useState, useCallback, useEffect, useRef } from 'react';
import {
  usePasskeyFlow,
  passkey,
} from '@quilibrium/quilibrium-js-sdk-channels';
import type {
  PasskeyFlowStep,
  PasskeyFlowError,
} from '@quilibrium/quilibrium-js-sdk-channels';
import { usePasskeyAdapter } from '../../platform/user/usePasskeyAdapter';
import { useQuorumApiClient } from '../../../components/context/QuorumApiContext';
import { useUploadRegistration } from '../../mutations/useUploadRegistration';
import { useKeyBackup } from '../../useKeyBackup';
import { validateDisplayName } from '../validation';
import { isDesktop } from '../../../utils/platform';
import { DefaultImages } from '../../../utils';
import { decryptUserConfig } from '../../../utils/crypto';
import { t } from '@lingui/core/macro';
import { showWarning } from '../../../utils/toast';
import { logOnboardingEvent } from '../../../utils/devDiagnostics';

// --- Types ---

export type OnboardingStep =
  | 'loading'
  | 'welcome'
  | 'import-key'
  | 'create-passkey-1a'
  | 'save-key-to-passkey'
  | 'backup-key'
  | 'security-warning'
  | 'display-name'
  | 'profile-photo'
  | 'complete';

export interface OnboardingUser {
  displayName: string;
  state: string;
  status: string;
  userIcon: string;
  address: string;
}

export interface UseUnifiedOnboardingFlowOptions {
  setUser: (user: OnboardingUser) => void;
}

export interface UseUnifiedOnboardingFlowReturn {
  // Step state
  step: OnboardingStep;
  dotIndex: number | null;

  // Passkey state (proxied from usePasskeyFlow)
  passkeyStep: PasskeyFlowStep;
  passkeyError: PasskeyFlowError | null;
  isImportMode: boolean;
  isPasskeySupported: boolean;
  canRetry: boolean;

  // Import error
  importError: string | null;

  // Profile state
  address: string | null;
  displayName: string;
  profileImagePreview: string | null;

  // Actions — welcome
  startNewAccount: () => Promise<void>;
  startImportAccount: () => void;

  // Actions — passkey
  createPasskey: () => Promise<void>;
  saveToPasskey: () => Promise<void>;
  continueWithoutPasskey: () => Promise<void>;
  retryPasskey: () => void;
  importKeyFile: (file: File) => Promise<void>;

  // Actions — onboarding
  downloadKey: () => Promise<void>;
  skipKeyBackup: () => void;
  acknowledgeSecurityWarning: () => void;
  setDisplayName: (name: string) => void;
  saveDisplayName: () => void;
  saveProfilePhoto: (url?: string) => void;
  setProfileImagePreview: (url: string | null) => void;
  completeOnboarding: () => void;

  // Validation
  canProceedWithName: boolean;
}

// --- Dot index mapping ---

function getDotIndex(step: OnboardingStep): number | null {
  switch (step) {
    case 'loading':
    case 'welcome':
    case 'import-key':
      return null;
    case 'create-passkey-1a':
    case 'save-key-to-passkey':
      return 1;
    case 'backup-key':
    case 'security-warning':
      return 2;
    case 'display-name':
      return 3;
    case 'profile-photo':
      return 4;
    case 'complete':
      return null;
  }
}

function getIncompleteAccountResumeStep(info: {
  displayName?: string;
  pfpUrl?: string;
}): OnboardingStep {
  if (!info.displayName || validateDisplayName(info.displayName)) {
    return 'backup-key';
  }
  if (!info.pfpUrl) return 'profile-photo';
  return 'complete';
}

export function useUnifiedOnboardingFlow(
  options: UseUnifiedOnboardingFlowOptions
): UseUnifiedOnboardingFlowReturn {
  const { setUser } = options;

  // --- Composed hooks ---
  const adapter = usePasskeyAdapter();
  const { apiClient } = useQuorumApiClient();
  const uploadRegistration = useUploadRegistration();
  const keyBackup = useKeyBackup();

  // --- Internal state ---
  const [step, setStep] = useState<OnboardingStep>('loading');
  const [importMode, setImportMode] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const [displayName, setDisplayName] = useState('');
  const [profileImagePreview, setProfileImagePreview] = useState<string | null>(
    null
  );
  const [isFetchingUser, setIsFetchingUser] = useState(false);

  // Ref to track current step inside callbacks (avoids stale closures)
  const stepRef = useRef<OnboardingStep>(step);
  const isRegisteringNewAccountRef = useRef(false);
  const isImportProfileSyncInFlightRef = useRef(false);
  stepRef.current = step;

  const displayNameIsValid = !validateDisplayName(displayName);
  const recordOnboardingEvent = useCallback(
    (
      action: Parameters<typeof logOnboardingEvent>[0]['action'],
      outcome: NonNullable<Parameters<typeof logOnboardingEvent>[0]['outcome']>,
      diagnosticStep: OnboardingStep = stepRef.current,
      overrides: Partial<
        Pick<
          Parameters<typeof logOnboardingEvent>[0],
          'hasAccount' | 'valid' | 'completed'
        >
      > = {}
    ) => {
      const account = adapter.currentPasskeyInfo;
      logOnboardingEvent({
        action,
        step: diagnosticStep,
        outcome,
        hasAccount: Boolean(account),
        valid: displayNameIsValid,
        completed: account?.completedOnboarding === true,
        ...overrides,
      });
    },
    [adapter.currentPasskeyInfo, displayNameIsValid]
  );

  // --- API callbacks for usePasskeyFlow ---
  const getUserRegistration = useCallback(
    async (address: string) => {
      try {
        const response = await apiClient.getUser(address);
        return response.data;
      } catch (error: unknown) {
        // Return 404 not found error format so SDK registration correctly treats
        // missing remote registration as expected for new account creation
        const err = new Error('404 not found');
        (err as unknown as { status: number }).status = 404;
        throw err;
      }
    },
    [apiClient]
  );

  // --- usePasskeyFlow from SDK ---
  const passkeyFlow = usePasskeyFlow({
    fqAppPrefix: 'Quorum',
    getUserRegistration,
    uploadRegistration,
    onStepChange: (sdkStep: PasskeyFlowStep) => {
      if (sdkStep === 'awaiting_completion') {
        recordOnboardingEvent('flow-state', 'advanced', 'save-key-to-passkey');
        setStep('save-key-to-passkey');
      }
      if (sdkStep === 'success') {
        isRegisteringNewAccountRef.current = false;
        // If in import mode, hold on 'loading' while we attempt remote profile sync.
        // The syncImportedProfile effect will advance to 'backup-key' if no profile found,
        // or call setUser() directly if a profile is found.
        if (!importMode) {
          recordOnboardingEvent('flow-state', 'advanced', 'backup-key', {
            hasAccount: true,
          });
          setStep('backup-key');
        } else {
          recordOnboardingEvent('flow-state', 'advanced', 'loading', {
            hasAccount: true,
          });
          setStep('loading');
        }
      }
      if (sdkStep === 'ready_with_keypair') {
        recordOnboardingEvent('flow-state', 'advanced', 'create-passkey-1a');
        setStep('create-passkey-1a');
      }
    },
    onError: (_error: PasskeyFlowError) => {
      const wasRegisteringNewAccount = isRegisteringNewAccountRef.current;
      isRegisteringNewAccountRef.current = false;
      recordOnboardingEvent('flow-state', 'failed');

      // The SDK reports import failures through onError after resolving
      // importKeyFile(), so the action-level catch below cannot surface them.
      // Keep the raw SDK error out of UI/logs and show a retryable generic error.
      if (stepRef.current === 'import-key') {
        setImportError(
          t`Could not import that account key. Check the file or key and try again.`
        );
        return;
      }

      // If we were completing (step 1b), retain the existing backup fallback
      // only when the SDK context can actually export/update that account.
      // A local credential write can precede a later registration failure, but
      // the provider does not hydrate currentPasskeyInfo on that error path.
      // In that case the create step exposes the safe fallback retry instead of
      // sending the user to unusable backup/name screens.
      if (stepRef.current === 'save-key-to-passkey') {
        setStep(
          adapter.currentPasskeyInfo ? 'backup-key' : 'create-passkey-1a'
        );
        return;
      }

      // Electron starts its no-passkey registration directly from Welcome.
      // The SDK reports failures through onError but resolves the action promise,
      // so without an explicit transition the outer flow can otherwise move on
      // with no account in context. Put the user on the existing error/retry UI.
      if (
        wasRegisteringNewAccount ||
        stepRef.current === 'welcome' ||
        stepRef.current === 'loading'
      ) {
        setStep('create-passkey-1a');
      }
      // If already registering (step 1a), stay on the same step — inline error shows.
    },
    onComplete: () => {
      // Handled by onStepChange 'success' → setStep('backup-key')
    },
  });

  // --- Profile sync after key import ---
  // When an imported key completes registration (SDK 'success'), credentials are now stored.
  // We set step back to 'loading' to show a spinner while we check for a remote profile.
  // This effect watches step + importMode so it fires when we re-enter 'loading' in import mode.
  useEffect(() => {
    if (step !== 'loading' || !importMode || passkeyFlow.step !== 'success')
      return;

    const syncImportedProfile = async () => {
      const info = adapter.currentPasskeyInfo;
      if (!info?.address || !adapter.exportKey) return;
      if (isImportProfileSyncInFlightRef.current) return;

      isImportProfileSyncInFlightRef.current = true;
      setIsFetchingUser(true);
      try {
        const userKeyHex = await adapter.exportKey(info.address);
        const userKey = new Uint8Array(Buffer.from(userKeyHex, 'hex'));

        const passkeyData = await passkey.loadKeyDecryptData(2);
        const envelope = JSON.parse(Buffer.from(passkeyData).toString('utf-8'));
        const key = await passkey.createKeyFromBuffer(
          userKey as unknown as ArrayBuffer
        );
        const decryptedKeyset = await passkey.decrypt(
          new Uint8Array(envelope.ciphertext),
          new Uint8Array(envelope.iv),
          key
        );
        const inner = JSON.parse(
          Buffer.from(decryptedKeyset).toString('utf-8')
        );

        let savedConfig;
        try {
          savedConfig = (await apiClient.getUserSettings(info.address)).data;
        } catch {
          setStep('backup-key');
          return;
        }

        if (!savedConfig?.user_config) {
          setStep('backup-key');
          return;
        }

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const decryptedConfig = (await decryptUserConfig(
          savedConfig.user_config,
          new Uint8Array(inner.identity.user_key.private_key)
        )) as any;

        const rawName = decryptedConfig?.name;
        const nameError = rawName ? validateDisplayName(rawName) : 'empty';
        const validatedName = nameError ? undefined : rawName;

        if (validatedName) {
          const finalProfileImage =
            decryptedConfig?.profile_image ?? DefaultImages.UNKNOWN_USER;
          adapter.updateStoredPasskey(info.credentialId, {
            credentialId: info.credentialId,
            address: info.address,
            publicKey: info.publicKey,
            displayName: validatedName,
            pfpUrl: finalProfileImage,
            completedOnboarding: true,
          });
          setUser({
            displayName: validatedName,
            state: 'online',
            status: '',
            userIcon: finalProfileImage,
            address: info.address,
          });
        }
        if (!validatedName) {
          setStep('backup-key');
        }
      } catch {
        setStep('backup-key');
      } finally {
        isImportProfileSyncInFlightRef.current = false;
        setIsFetchingUser(false);
      }
    };

    syncImportedProfile();
  }, [step, importMode, passkeyFlow.step, adapter.currentPasskeyInfo?.address]);

  // --- Returning user detection (initial mount only, not post-import) ---
  useEffect(() => {
    // Skip if we're in post-import profile sync (handled by the effect above)
    if (
      step !== 'loading' ||
      isRegisteringNewAccountRef.current ||
      (importMode && passkeyFlow.step === 'success')
    ) {
      return;
    }

    const checkReturningUser = async () => {
      const info = adapter.currentPasskeyInfo;

      // No stored credentials — new user
      if (!info || !info.address) {
        recordOnboardingEvent('returning-user-check', 'observed', 'welcome', {
          hasAccount: false,
          completed: false,
        });
        setStep('welcome');
        return;
      }

      const resumeIncompleteAccount = () => {
        const resumeStep = getIncompleteAccountResumeStep(info);
        setDisplayName(info.displayName ?? '');
        recordOnboardingEvent('returning-user-check', 'restored', resumeStep, {
          hasAccount: true,
          valid: Boolean(
            info.displayName && !validateDisplayName(info.displayName)
          ),
          completed: false,
        });
        setStep(resumeStep);
      };

      // Has credentials with completedOnboarding — App.tsx useEffect handles this case
      // before the orchestrator mounts. But as a safety net:
      if (info.completedOnboarding) {
        recordOnboardingEvent('returning-user-check', 'restored', 'complete', {
          hasAccount: true,
          completed: true,
        });
        setUser({
          displayName: info.displayName ?? info.address,
          state: 'online',
          status: '',
          userIcon: info.pfpUrl ?? DefaultImages.UNKNOWN_USER,
          address: info.address,
        });
        return;
      }

      // Has credentials but onboarding not complete — try to fetch remote profile
      if (!adapter.exportKey) {
        resumeIncompleteAccount();
        return;
      }

      setIsFetchingUser(true);
      try {
        const userKeyHex = await adapter.exportKey(info.address);
        const userKey = new Uint8Array(Buffer.from(userKeyHex, 'hex'));

        const passkeyData = await passkey.loadKeyDecryptData(2);
        const envelope = JSON.parse(Buffer.from(passkeyData).toString('utf-8'));
        const key = await passkey.createKeyFromBuffer(
          userKey as unknown as ArrayBuffer
        );
        const decryptedKeyset = await passkey.decrypt(
          new Uint8Array(envelope.ciphertext),
          new Uint8Array(envelope.iv),
          key
        );
        const inner = JSON.parse(
          Buffer.from(decryptedKeyset).toString('utf-8')
        );

        // Fetch encrypted config
        let savedConfig;
        try {
          savedConfig = (await apiClient.getUserSettings(info.address)).data;
        } catch {
          recordOnboardingEvent('returning-user-check', 'failed', 'loading', {
            hasAccount: true,
          });
          resumeIncompleteAccount();
          return;
        }

        if (!savedConfig?.user_config) {
          resumeIncompleteAccount();
          return;
        }

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const decryptedConfig = (await decryptUserConfig(
          savedConfig.user_config,
          new Uint8Array(inner.identity.user_key.private_key)
        )) as any;

        // Validate remote profile
        const rawName = decryptedConfig?.name;
        const nameError = rawName ? validateDisplayName(rawName) : 'empty';
        const validatedName = nameError ? undefined : rawName;

        if (validatedName) {
          const finalProfileImage =
            decryptedConfig?.profile_image ?? DefaultImages.UNKNOWN_USER;

          adapter.updateStoredPasskey(info.credentialId, {
            credentialId: info.credentialId,
            address: info.address,
            publicKey: info.publicKey,
            displayName: validatedName,
            pfpUrl: finalProfileImage,
            completedOnboarding: true,
          });

          setUser({
            displayName: validatedName,
            state: 'online',
            status: '',
            userIcon: finalProfileImage,
            address: info.address,
          });
          recordOnboardingEvent(
            'returning-user-check',
            'restored',
            'complete',
            {
              hasAccount: true,
              valid: true,
              completed: true,
            }
          );
          return;
        }

        // Has credentials but no valid remote profile — continue onboarding
        resumeIncompleteAccount();
      } catch {
        showWarning(
          t`Couldn't load your saved profile. Please re-enter your name and profile image.`
        );
        recordOnboardingEvent('returning-user-check', 'failed', 'loading', {
          hasAccount: true,
        });
        resumeIncompleteAccount();
      } finally {
        setIsFetchingUser(false);
      }
    };

    checkReturningUser();
  }, [step, adapter.currentPasskeyInfo?.address]);

  // Computed values
  const dotIndex = getDotIndex(step);
  const canProceedWithName =
    Boolean(adapter.currentPasskeyInfo) && displayNameIsValid;

  // --- Actions: Welcome ---

  const startNewAccount = useCallback(async () => {
    setImportMode(false);
    setImportError(null);
    recordOnboardingEvent('flow-state', 'started', 'welcome');

    if (!passkeyFlow.isPasskeySupported || isDesktop()) {
      // Desktop / unsupported browser: skip passkey steps entirely
      isRegisteringNewAccountRef.current = true;
      recordOnboardingEvent('flow-state', 'advanced', 'loading');
      setStep('loading');
      try {
        await passkeyFlow.proceedWithoutPasskey();
        // Success is the SDK's `onStepChange('success')` callback above. Do not
        // advance here: the SDK also resolves after internally handled errors.
      } catch {
        isRegisteringNewAccountRef.current = false;
        recordOnboardingEvent('flow-state', 'failed', 'welcome');
        setStep('create-passkey-1a');
      }
    } else {
      recordOnboardingEvent('flow-state', 'advanced', 'create-passkey-1a');
      setStep('create-passkey-1a');
    }
  }, [
    passkeyFlow.isPasskeySupported,
    passkeyFlow.proceedWithoutPasskey,
    recordOnboardingEvent,
  ]);

  const startImportAccount = useCallback(() => {
    setImportMode(true);
    setImportError(null);
    setStep('import-key');
  }, []);

  // --- Actions: Passkey ---

  const createPasskey = useCallback(async () => {
    await passkeyFlow.startRegistration();
  }, [passkeyFlow.startRegistration]);

  const saveToPasskey = useCallback(async () => {
    await passkeyFlow.completeRegistration();
  }, [passkeyFlow.completeRegistration]);

  const continueWithoutPasskey = useCallback(async () => {
    recordOnboardingEvent('flow-state', 'started', 'create-passkey-1a');
    isRegisteringNewAccountRef.current = true;
    recordOnboardingEvent('flow-state', 'advanced', 'loading');
    setStep('loading');
    try {
      await passkeyFlow.proceedWithoutPasskey();
      // See startNewAccount: only the SDK success callback may advance.
    } catch {
      isRegisteringNewAccountRef.current = false;
      recordOnboardingEvent('flow-state', 'failed', 'create-passkey-1a');
      setStep('create-passkey-1a');
    }
  }, [passkeyFlow.proceedWithoutPasskey, recordOnboardingEvent]);

  const retryPasskey = useCallback(() => {
    passkeyFlow.retry();
  }, [passkeyFlow.retry]);

  const handleImportKeyFile = useCallback(
    async (file: File) => {
      setImportError(null);
      try {
        await passkeyFlow.importKeyFile(file);
      } catch {
        setImportError(
          t`Could not import that account key. Check the file or key and try again.`
        );
      }
    },
    [passkeyFlow.importKeyFile]
  );

  // --- Actions: Onboarding ---

  const handleDownloadKey = useCallback(async () => {
    try {
      await keyBackup.downloadKey();
      setStep('security-warning');
    } catch (error) {
      // downloadKey handles its own error display; stay on backup-key step
      console.error('Key download failed:', error);
    }
  }, [keyBackup.downloadKey]);

  const skipKeyBackup = useCallback(() => {
    setStep('display-name');
  }, []);

  const acknowledgeSecurityWarning = useCallback(() => {
    setStep('display-name');
  }, []);

  const saveDisplayNameAction = useCallback(() => {
    if (!adapter.currentPasskeyInfo) {
      showWarning(
        t`Account setup isn't ready yet. Please retry creating your account.`
      );
      recordOnboardingEvent(
        'display-name-submit',
        'blocked-no-account',
        'display-name',
        {
          hasAccount: false,
        }
      );
      return;
    }
    if (!displayNameIsValid) {
      recordOnboardingEvent(
        'display-name-submit',
        'blocked-invalid',
        'display-name',
        {
          hasAccount: true,
          valid: false,
        }
      );
      return;
    }

    adapter.updateStoredPasskey(adapter.currentPasskeyInfo.credentialId, {
      credentialId: adapter.currentPasskeyInfo.credentialId,
      address: adapter.currentPasskeyInfo.address,
      publicKey: adapter.currentPasskeyInfo.publicKey,
      displayName,
      completedOnboarding: false,
      pfpUrl: adapter.currentPasskeyInfo.pfpUrl,
    });
    recordOnboardingEvent('display-name-submit', 'advanced', 'profile-photo', {
      hasAccount: true,
      valid: true,
    });
    setStep('profile-photo');
  }, [adapter, displayName, displayNameIsValid, recordOnboardingEvent]);

  const saveProfilePhoto = useCallback(
    (url?: string) => {
      if (!adapter.currentPasskeyInfo) {
        showWarning(
          t`Account setup isn't ready yet. Please retry creating your account.`
        );
        recordOnboardingEvent(
          'profile-photo-submit',
          'blocked-no-account',
          'profile-photo',
          {
            hasAccount: false,
          }
        );
        return;
      }

      const finalPfpUrl = url ?? DefaultImages.UNKNOWN_USER;
      adapter.updateStoredPasskey(adapter.currentPasskeyInfo.credentialId, {
        credentialId: adapter.currentPasskeyInfo.credentialId,
        address: adapter.currentPasskeyInfo.address,
        publicKey: adapter.currentPasskeyInfo.publicKey,
        displayName,
        pfpUrl: finalPfpUrl,
        completedOnboarding: false,
      });
      recordOnboardingEvent('profile-photo-submit', 'advanced', 'complete', {
        hasAccount: true,
      });
      setStep('complete');
    },
    [adapter, displayName, recordOnboardingEvent]
  );

  const handleCompleteOnboarding = useCallback(() => {
    if (!adapter.currentPasskeyInfo) {
      showWarning(
        t`Account setup isn't ready yet. Please retry creating your account.`
      );
      recordOnboardingEvent(
        'complete-submit',
        'blocked-no-account',
        'complete',
        {
          hasAccount: false,
        }
      );
      return;
    }

    const finalPfpUrl =
      profileImagePreview ??
      adapter.currentPasskeyInfo.pfpUrl ??
      DefaultImages.UNKNOWN_USER;

    adapter.updateStoredPasskey(adapter.currentPasskeyInfo.credentialId, {
      credentialId: adapter.currentPasskeyInfo.credentialId,
      address: adapter.currentPasskeyInfo.address,
      publicKey: adapter.currentPasskeyInfo.publicKey,
      displayName,
      pfpUrl: finalPfpUrl,
      completedOnboarding: true,
    });
    recordOnboardingEvent('complete-submit', 'advanced', 'complete', {
      hasAccount: true,
      completed: true,
    });

    setUser({
      displayName,
      state: 'online',
      status: '',
      userIcon: finalPfpUrl,
      address: adapter.currentPasskeyInfo.address,
    });
  }, [
    adapter,
    displayName,
    profileImagePreview,
    recordOnboardingEvent,
    setUser,
  ]);

  // --- Return ---

  return {
    step,
    dotIndex,

    passkeyStep: passkeyFlow.step,
    passkeyError: passkeyFlow.error,
    isImportMode: importMode,
    isPasskeySupported: passkeyFlow.isPasskeySupported,
    canRetry: passkeyFlow.canRetry,

    importError,

    address: passkeyFlow.address,
    displayName,
    profileImagePreview,

    startNewAccount,
    startImportAccount,

    createPasskey,
    saveToPasskey,
    continueWithoutPasskey,
    retryPasskey,
    importKeyFile: handleImportKeyFile,

    downloadKey: handleDownloadKey,
    skipKeyBackup,
    acknowledgeSecurityWarning,
    setDisplayName,
    saveDisplayName: saveDisplayNameAction,
    saveProfilePhoto,
    setProfileImagePreview,
    completeOnboarding: handleCompleteOnboarding,

    canProceedWithName,
  };
}
