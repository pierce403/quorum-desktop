export type OnboardingDiagnosticAction =
  | 'flow-state'
  | 'display-name-submit'
  | 'profile-photo-submit'
  | 'complete-submit'
  | 'returning-user-check';

export type OnboardingDiagnosticStep =
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

export type OnboardingDiagnosticOutcome =
  | 'observed'
  | 'started'
  | 'advanced'
  | 'restored'
  | 'blocked-no-account'
  | 'blocked-invalid'
  | 'failed';

export interface OnboardingDiagnosticInput {
  action: OnboardingDiagnosticAction;
  step?: OnboardingDiagnosticStep;
  outcome?: OnboardingDiagnosticOutcome;
  hasAccount?: boolean;
  valid?: boolean;
  completed?: boolean;
}

export interface OnboardingDiagnosticDetails extends OnboardingDiagnosticInput {
  accountCount: number;
}

export type RegistrationDiagnosticStage =
  | 'export-account-key'
  | 'load-device-keyset'
  | 'decrypt-device-keyset'
  | 'sync-registration'
  | 'initialize-config';

export type RegistrationDiagnosticOutcome =
  | 'started'
  | 'succeeded'
  | 'failed'
  | 'recovering';

export interface RegistrationDiagnosticDetails {
  stage: RegistrationDiagnosticStage;
  outcome: RegistrationDiagnosticOutcome;
  registered?: boolean;
}

export type StorageMetadataStatus =
  | 'missing'
  | 'valid'
  | 'invalid-json'
  | 'invalid-shape'
  | 'unavailable';

export interface StoredAccountDiagnosticSummary {
  metadataStatus: StorageMetadataStatus;
  accountCount: number;
  completedCount: number;
  fallbackCredential: boolean;
}

export interface StorageSnapshotDiagnosticDetails extends StoredAccountDiagnosticSummary {
  origin?: string;
  keyDbPresent?: boolean;
  keyDbVersion?: number;
  quorumDbPresent?: boolean;
  quorumDbVersion?: number;
}

export type RendererErrorKind =
  | 'window-error'
  | 'unhandled-error'
  | 'unhandled-dom-exception'
  | 'unhandled-object'
  | 'unhandled-primitive'
  | 'storage-databases-unavailable';

export type RendererDomExceptionName =
  | 'AbortError'
  | 'ConstraintError'
  | 'DataError'
  | 'InvalidAccessError'
  | 'InvalidStateError'
  | 'NetworkError'
  | 'NotAllowedError'
  | 'NotFoundError'
  | 'OperationError'
  | 'QuotaExceededError'
  | 'ReadOnlyError'
  | 'SecurityError'
  | 'TimeoutError'
  | 'TransactionInactiveError'
  | 'UnknownError'
  | 'VersionError';

export interface RendererErrorDiagnosticDetails {
  kind: RendererErrorKind;
  errorName?: RendererDomExceptionName;
  source?: string;
  line?: number;
  column?: number;
}

const PASSKEY_METADATA_KEY = 'passkeys-list';
const FALLBACK_CREDENTIAL_KEY = 'quorum-master-prf-incompatibility';
const FALLBACK_CREDENTIAL_ID = 'not-passkey';

const ONBOARDING_ACTIONS: ReadonlySet<OnboardingDiagnosticAction> = new Set([
  'flow-state',
  'display-name-submit',
  'profile-photo-submit',
  'complete-submit',
  'returning-user-check',
]);

const ONBOARDING_STEPS: ReadonlySet<OnboardingDiagnosticStep> = new Set([
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
]);

const ONBOARDING_OUTCOMES: ReadonlySet<OnboardingDiagnosticOutcome> = new Set([
  'observed',
  'started',
  'advanced',
  'restored',
  'blocked-no-account',
  'blocked-invalid',
  'failed',
]);

const REGISTRATION_STAGES: ReadonlySet<RegistrationDiagnosticStage> = new Set([
  'export-account-key',
  'load-device-keyset',
  'decrypt-device-keyset',
  'sync-registration',
  'initialize-config',
]);

const REGISTRATION_OUTCOMES: ReadonlySet<RegistrationDiagnosticOutcome> =
  new Set(['started', 'succeeded', 'failed', 'recovering']);

const DOM_EXCEPTION_NAMES: ReadonlySet<RendererDomExceptionName> = new Set([
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
]);

const diagnosticsEnabled =
  import.meta.env.DEV || import.meta.env.VITE_QUORUM_DEV_BUILD === 'true';

let installed = false;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function safeInteger(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isSafeInteger(value)
    ? value
    : undefined;
}

function safeSourceBasename(value: string): string | undefined {
  try {
    const url = new URL(value, window.location.href);
    if (!['http:', 'https:', 'file:', 'quorum-app:'].includes(url.protocol)) {
      return undefined;
    }
    const pathname = url.pathname;
    const basename = pathname.split('/').pop();
    if (!basename || basename.length > 80) return undefined;
    if (!/^[a-zA-Z0-9._+-]+$/.test(basename)) return undefined;
    return /\.(?:[cm]?js|jsx|tsx?)$/i.test(basename) ? basename : undefined;
  } catch {
    return undefined;
  }
}

function getRendererOrigin(): string | undefined {
  try {
    const url = new URL(window.location.href);
    if (url.protocol === 'file:') return 'file://';
    if (!['http:', 'https:', 'quorum-app:'].includes(url.protocol)) {
      return undefined;
    }
    return url.host ? `${url.protocol}//${url.host}` : undefined;
  } catch {
    return undefined;
  }
}

function getDiagnosticsBridge() {
  if (!diagnosticsEnabled || typeof window === 'undefined') return undefined;
  return window.electron?.devDiagnostics;
}

export function getStoredAccountDiagnosticSummary(): StoredAccountDiagnosticSummary {
  const unavailable: StoredAccountDiagnosticSummary = {
    metadataStatus: 'unavailable',
    accountCount: 0,
    completedCount: 0,
    fallbackCredential: false,
  };

  if (typeof window === 'undefined') return unavailable;

  try {
    const rawMetadata = window.localStorage.getItem(PASSKEY_METADATA_KEY);
    const fallbackFlag =
      window.localStorage.getItem(FALLBACK_CREDENTIAL_KEY) !== null;

    if (rawMetadata === null) {
      return {
        metadataStatus: 'missing',
        accountCount: 0,
        completedCount: 0,
        fallbackCredential: fallbackFlag,
      };
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(rawMetadata);
    } catch {
      return {
        metadataStatus: 'invalid-json',
        accountCount: 0,
        completedCount: 0,
        fallbackCredential: fallbackFlag,
      };
    }

    if (!Array.isArray(parsed)) {
      return {
        metadataStatus: 'invalid-shape',
        accountCount: 0,
        completedCount: 0,
        fallbackCredential: fallbackFlag,
      };
    }

    const records = parsed.filter(isRecord);
    return {
      metadataStatus:
        records.length === parsed.length ? 'valid' : 'invalid-shape',
      accountCount: parsed.length,
      completedCount: records.filter(
        (record) => record.completedOnboarding === true
      ).length,
      fallbackCredential:
        fallbackFlag ||
        records.some(
          (record) => record.credentialId === FALLBACK_CREDENTIAL_ID
        ),
    };
  } catch {
    return unavailable;
  }
}

function sanitizeOnboardingInput(
  details: OnboardingDiagnosticInput
): Omit<OnboardingDiagnosticDetails, 'accountCount'> | undefined {
  if (!ONBOARDING_ACTIONS.has(details.action)) return undefined;

  const safe: Omit<OnboardingDiagnosticDetails, 'accountCount'> = {
    action: details.action,
  };

  if (details.step !== undefined && ONBOARDING_STEPS.has(details.step)) {
    safe.step = details.step;
  }
  if (
    details.outcome !== undefined &&
    ONBOARDING_OUTCOMES.has(details.outcome)
  ) {
    safe.outcome = details.outcome;
  }
  if (typeof details.hasAccount === 'boolean') {
    safe.hasAccount = details.hasAccount;
  }
  if (typeof details.valid === 'boolean') safe.valid = details.valid;
  if (typeof details.completed === 'boolean') {
    safe.completed = details.completed;
  }

  return safe;
}

export function logOnboardingEvent(details: OnboardingDiagnosticInput): void {
  const bridge = getDiagnosticsBridge();
  if (!bridge) return;

  const safeDetails = sanitizeOnboardingInput(details);
  if (!safeDetails) return;

  const { accountCount } = getStoredAccountDiagnosticSummary();
  try {
    bridge.onboarding({ ...safeDetails, accountCount });
  } catch {
    // Diagnostics are non-essential and must never affect onboarding.
  }
}

export function logRegistrationEvent(
  details: RegistrationDiagnosticDetails
): void {
  const bridge = getDiagnosticsBridge();
  if (
    !bridge ||
    !REGISTRATION_STAGES.has(details.stage) ||
    !REGISTRATION_OUTCOMES.has(details.outcome)
  ) {
    return;
  }

  try {
    bridge.registration({
      stage: details.stage,
      outcome: details.outcome,
      ...(typeof details.registered === 'boolean'
        ? { registered: details.registered }
        : {}),
    });
  } catch {
    // Diagnostics are non-essential and must never affect registration.
  }
}

function logRendererError(details: RendererErrorDiagnosticDetails): void {
  const bridge = getDiagnosticsBridge();
  if (!bridge) return;

  try {
    bridge.rendererError(details);
  } catch {
    // Diagnostics are non-essential and must never affect the renderer.
  }
}

async function getDatabaseSummary(): Promise<
  Pick<
    StorageSnapshotDiagnosticDetails,
    'keyDbPresent' | 'keyDbVersion' | 'quorumDbPresent' | 'quorumDbVersion'
  >
> {
  const factory = window.indexedDB as IDBFactory & {
    databases?: () => Promise<IDBDatabaseInfo[]>;
  };

  if (typeof factory?.databases !== 'function') return {};

  try {
    const databases = await factory.databases();
    const keyDb = databases.find((database) => database.name === 'KeyDB');
    const quorumDb = databases.find(
      (database) => database.name === 'quorum_db'
    );
    const keyDbVersion = safeInteger(keyDb?.version);
    const quorumDbVersion = safeInteger(quorumDb?.version);

    return {
      keyDbPresent: keyDb !== undefined,
      ...(keyDbVersion === undefined ? {} : { keyDbVersion }),
      quorumDbPresent: quorumDb !== undefined,
      ...(quorumDbVersion === undefined ? {} : { quorumDbVersion }),
    };
  } catch {
    logRendererError({ kind: 'storage-databases-unavailable' });
    return {};
  }
}

async function logStorageSnapshot(): Promise<void> {
  const bridge = getDiagnosticsBridge();
  if (!bridge) return;

  const accountSummary = getStoredAccountDiagnosticSummary();
  const databaseSummary = await getDatabaseSummary();
  const origin = getRendererOrigin();

  try {
    bridge.storageSnapshot({
      ...accountSummary,
      ...databaseSummary,
      ...(origin === undefined ? {} : { origin }),
    });
  } catch {
    // Diagnostics are non-essential and must never affect the renderer.
  }
}

function classifyRejection(reason: unknown): RendererErrorKind {
  if (typeof DOMException !== 'undefined' && reason instanceof DOMException) {
    return 'unhandled-dom-exception';
  }
  if (reason instanceof Error) return 'unhandled-error';
  if (reason !== null && typeof reason === 'object') {
    return 'unhandled-object';
  }
  return 'unhandled-primitive';
}

function classifyDomExceptionName(
  reason: unknown
): RendererDomExceptionName | undefined {
  if (
    typeof DOMException === 'undefined' ||
    !(reason instanceof DOMException)
  ) {
    return undefined;
  }
  return DOM_EXCEPTION_NAMES.has(reason.name as RendererDomExceptionName)
    ? (reason.name as RendererDomExceptionName)
    : undefined;
}

export function getSafeStackLocation(reason: unknown): {
  line?: number;
  column?: number;
} {
  if (
    reason === null ||
    (typeof reason !== 'object' && typeof reason !== 'function') ||
    !('stack' in reason) ||
    typeof reason.stack !== 'string'
  ) {
    return {};
  }

  // Read only numeric locations from ordinary app/web stack frames. Never
  // forward the stack, function name, URL, or exception message.
  const match = reason.stack.match(
    /(?:quorum-app|https?|file):\/\/[^\s)]+:(\d+):(\d+)/
  );
  if (!match) return {};
  const line = safeInteger(Number(match[1]));
  const column = safeInteger(Number(match[2]));
  return {
    ...(line === undefined ? {} : { line }),
    ...(column === undefined ? {} : { column }),
  };
}

export function installRendererDevDiagnostics(): void {
  const bridge = getDiagnosticsBridge();
  if (!bridge || installed) return;
  installed = true;

  window.addEventListener('error', (event) => {
    const source = event.filename
      ? safeSourceBasename(event.filename)
      : undefined;
    const line = safeInteger(event.lineno);
    const column = safeInteger(event.colno);

    logRendererError({
      kind: 'window-error',
      ...(source === undefined ? {} : { source }),
      ...(line === undefined ? {} : { line }),
      ...(column === undefined ? {} : { column }),
    });
  });

  window.addEventListener('unhandledrejection', (event) => {
    const errorName = classifyDomExceptionName(event.reason);
    logRendererError({
      kind: classifyRejection(event.reason),
      ...(errorName === undefined ? {} : { errorName }),
      ...getSafeStackLocation(event.reason),
    });
  });

  void logStorageSnapshot();
}
