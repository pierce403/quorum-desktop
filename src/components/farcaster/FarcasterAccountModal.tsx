import * as React from 'react';
import { t } from '@lingui/core/macro';
import { Button, Callout, Modal, TextArea } from '../primitives';
import {
  getFarcasterStorageStatus,
  importDesktopFarcasterAccount,
  validateFarcasterRecoveryPhrase,
  type DesktopFarcasterAccount,
} from '@/services/FarcasterAccountService';

interface Props {
  visible: boolean;
  onClose: () => void;
  onImported: (account: DesktopFarcasterAccount) => void;
}

export const FarcasterAccountModal: React.FC<Props> = ({ visible, onClose, onImported }) => {
  const [phrase, setPhrase] = React.useState('');
  const [error, setError] = React.useState<string | null>(null);
  const [importing, setImporting] = React.useState(false);
  const [storageStatus, setStorageStatus] = React.useState<{ available: boolean; backend: string } | null>(null);

  React.useEffect(() => {
    if (!visible) return;
    void getFarcasterStorageStatus().then(setStorageStatus);
  }, [visible]);

  const close = () => {
    setPhrase('');
    setError(null);
    onClose();
  };

  const submit = async () => {
    if (!validateFarcasterRecoveryPhrase(phrase)) {
      setError(t`Enter a valid 12 or 24 word Farcaster recovery phrase.`);
      return;
    }
    setImporting(true);
    setError(null);
    try {
      const account = await importDesktopFarcasterAccount(phrase);
      setPhrase('');
      onImported(account);
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t`Farcaster account import failed.`);
    } finally {
      setImporting(false);
    }
  };

  return (
    <Modal visible={visible} onClose={close} title={t`Import Farcaster account`} size="medium" closeOnBackdropClick={!importing} closeOnEscape={!importing}>
      <div className="farcaster-import">
        <Callout variant="warning" size="sm">
          {t`Your recovery phrase controls your Farcaster account. Quorum never sends or stores the phrase. It derives the custody key in this window, then encrypts that key with your operating system's credential store.`}
        </Callout>
        {storageStatus && !storageStatus.available && (
          <Callout variant="error" size="sm">
            {storageStatus.backend === 'browser'
              ? t`Open Quorum in the Electron desktop app to import an account securely.`
              : t`Your operating system credential store is unavailable.`}
          </Callout>
        )}
        {error && <Callout variant="error" size="sm">{error}</Callout>}
        <TextArea
          value={phrase}
          onChange={(value: string) => { setPhrase(value); setError(null); }}
          placeholder={t`Enter your 12 or 24 word recovery phrase`}
          rows={5}
          resize
          disabled={importing}
          accessibilityLabel={t`Farcaster recovery phrase`}
        />
        <div className="farcaster-import__actions">
          <Button type="secondary" disabled={importing} onClick={close}>{t`Cancel`}</Button>
          <Button type="primary" disabled={importing || storageStatus?.available !== true || !validateFarcasterRecoveryPhrase(phrase)} onClick={submit}>
            {importing ? t`Importing and provisioning signer...` : t`Import account`}
          </Button>
        </div>
      </div>
    </Modal>
  );
};
