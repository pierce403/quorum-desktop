import React, { useState } from 'react';
import { Button, Icon } from './primitives';
import { Trans } from '@lingui/react/macro';
import { Logo } from './Logo';
import { wipeLocalAppData } from '../services/resetAppData';
import { isDesktop, isTauri } from '../utils/platform';

/**
 * App-root crash screen: what the user sees when an error escapes every route
 * boundary and reaches the top-level `ErrorBoundary` in `App.tsx`.
 *
 * Provides multiple recovery paths:
 * 1. Reload Quorum (simple page refresh)
 * 2. Clear Session & Reconnect (clears session and query cache)
 * 3. Reset App Data & Re-onboard (clears IndexedDB/local storage if corrupted)
 * 4. Copy Diagnostic Report (copies full error, stack, and environment context)
 */
export const AppErrorScreen = ({ error }: { error?: unknown }) => {
  const [copied, setCopied] = useState(false);
  const [showResetConfirm, setShowResetConfirm] = useState(false);
  const [isResetting, setIsResetting] = useState(false);

  const errorObj = error instanceof Error ? error : null;
  const errorMessage =
    errorObj?.message ?? (typeof error === 'string' ? error : null);
  const errorStack = errorObj?.stack ?? null;

  const handleReload = () => {
    window.location.reload();
  };

  const handleClearSession = () => {
    try {
      sessionStorage.clear();
    } catch (_e) {
      // Ignore sessionStorage access errors
    }
    window.location.href = '/';
  };

  const handleResetData = async () => {
    setIsResetting(true);
    try {
      await wipeLocalAppData();
    } catch (e) {
      console.error('Failed to wipe local app data:', e);
      try {
        localStorage.clear();
        sessionStorage.clear();
      } catch (_storageErr) {
        // Ignore storage access errors
      }
    }
    window.location.href = '/';
  };

  const handleCopyDiagnostics = async () => {
    const report = {
      timestamp: new Date().toISOString(),
      error: {
        name: errorObj?.name ?? 'UnknownError',
        message: errorMessage ?? 'No message provided',
        stack: errorStack,
      },
      environment: {
        url: typeof window !== 'undefined' ? window.location.href : '',
        pathname: typeof window !== 'undefined' ? window.location.pathname : '',
        userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : '',
        isTauri: isTauri(),
        isDesktop: isDesktop(),
        storageKeys: typeof localStorage !== 'undefined' ? Object.keys(localStorage) : [],
      },
    };

    const text = JSON.stringify(report, null, 2);
    try {
      if (window.electron?.clipboard?.copySecret) {
        await window.electron.clipboard.copySecret(text);
      } else if (navigator.clipboard) {
        await navigator.clipboard.writeText(text);
      }
      setCopied(true);
      setTimeout(() => setCopied(false), 3000);
    } catch (e) {
      console.error('Failed to copy diagnostics:', e);
    }
  };

  return (
    <div
      className="flex flex-1 flex-col items-center justify-center px-4 py-12 relative"
      role="alert"
    >
      <Logo className="max-w-[160px] text-muted absolute top-4 left-4" />
      <div className="w-full max-w-[500px] text-center">
        <div className="flex justify-center mb-6">
          <div className="onboarding-step-icon onboarding-step-icon--large">
            <Icon name="skull" size="3xl" />
          </div>
        </div>
        <h1 className="onboarding-title">
          <Trans>Something went wrong</Trans>
        </h1>
        <p className="onboarding-description mx-auto mb-4">
          <Trans>
            Quorum encountered an unexpected issue during operation. You can reload,
            clear temporary session data, or reset local app data to recover.
          </Trans>
        </p>

        {errorMessage && (
          <div className="my-4 p-3 bg-surface-2 rounded text-xs text-left text-subtle overflow-auto max-h-36 font-mono border border-surface-3">
            <div className="font-semibold text-main mb-1">{errorMessage}</div>
            {errorStack && (
              <details className="mt-2 text-[11px] text-muted cursor-pointer">
                <summary>Stack Trace</summary>
                <pre className="mt-1 whitespace-pre-wrap">{errorStack}</pre>
              </details>
            )}
          </div>
        )}

        {/* Primary and secondary recovery actions */}
        <div className="flex flex-col gap-3 mt-6">
          <div className="flex flex-row gap-3 justify-center">
            <Button
              type="primary"
              className="flex-1"
              onClick={handleReload}
            >
              <Trans>Reload Quorum</Trans>
            </Button>
            <Button
              type="secondary"
              className="flex-1"
              onClick={handleClearSession}
            >
              <Trans>Clear Session</Trans>
            </Button>
          </div>

          <div className="flex flex-row gap-3 justify-center">
            <Button
              type="secondary"
              className="flex-1 text-xs"
              onClick={handleCopyDiagnostics}
            >
              {copied ? <Trans>Copied Diagnostics!</Trans> : <Trans>Copy Error Report</Trans>}
            </Button>

            {!showResetConfirm ? (
              <Button
                type="danger"
                className="flex-1 text-xs"
                onClick={() => setShowResetConfirm(true)}
              >
                <Trans>Reset App Data</Trans>
              </Button>
            ) : (
              <Button
                type="danger"
                className="flex-1 text-xs"
                disabled={isResetting}
                onClick={handleResetData}
              >
                <Trans>Confirm Reset & Restart</Trans>
              </Button>
            )}
          </div>

          {showResetConfirm && (
            <p className="text-xs text-warning mt-1 text-center">
              <Trans>
                Resetting will clear all local databases and return to onboarding.
                Ensure you have your recovery backup phrase if restoring an existing account.
              </Trans>
            </p>
          )}
        </div>

        <div className="mt-8 text-xs text-muted">
          <Trans>
            If this persists, check{' '}
            <a
              href="https://status.quilibrium.com/"
              target="_blank"
              rel="noopener noreferrer"
              className="onboarding-link !text-xs"
            >
              status.quilibrium.com
            </a>{' '}
            or submit the copied error report.
          </Trans>
        </div>
      </div>
    </div>
  );
};
