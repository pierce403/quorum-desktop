import * as React from 'react';
import { t } from '@lingui/core/macro';
import { Button, Icon, Modal } from '../primitives';
import type { DesktopFarcasterAccount } from '@/services/FarcasterAccountService';
import './FarcasterMiniAppModal.scss';

export interface MiniAppSession {
  url: string;
  title?: string;
  iconUrl?: string;
  castHash?: string;
}

interface Props {
  app: MiniAppSession | null;
  onClose: () => void;
  account: DesktopFarcasterAccount | null;
  onOpenProfile?: (fid: number) => void;
  onComposeCast?: (text: string, embeds?: string[]) => void;
}

export const FarcasterMiniAppModal: React.FC<Props> = ({
  app,
  onClose,
  account,
  onOpenProfile,
  onComposeCast,
}) => {
  const iframeRef = React.useRef<HTMLIFrameElement | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!app) return;
    setLoading(true);
    setError(null);
  }, [app?.url]);

  // Handle postMessage communication with Farcaster Mini-App SDK
  React.useEffect(() => {
    if (!app) return;

    const handleMessage = (event: MessageEvent) => {
      // Ensure the message is from our iframe
      if (iframeRef.current && event.source !== iframeRef.current.contentWindow) {
        return;
      }

      const data = event.data;
      if (!data || typeof data !== 'object') return;

      // Handle SDK ready / handshake
      if (
        data.type === 'ready' ||
        data.type === 'fc:ready' ||
        data.event === 'ready' ||
        data.method === 'fc:ready' ||
        data.type === 'miniapp:ready'
      ) {
        setLoading(false);
        const contextPayload = {
          type: 'fc:frame_context',
          event: 'frame_context',
          context: {
            user: account
              ? {
                  fid: account.fid,
                  username: account.username,
                  displayName: account.displayName || account.username,
                  pfpUrl: account.pfpUrl,
                  custodyAddress: account.custodyAddress,
                }
              : null,
            client: {
              clientFid: 8531,
              added: false,
              safeAreaInsets: { top: 0, bottom: 0, left: 0, right: 0 },
            },
          },
        };
        iframeRef.current?.contentWindow?.postMessage(contextPayload, '*');
      }

      // Handle openUrl
      if (data.type === 'openUrl' || data.method === 'openUrl' || data.type === 'fc:openUrl') {
        const targetUrl = data.url || data.params?.url;
        if (targetUrl && typeof targetUrl === 'string') {
          window.open(targetUrl, '_blank', 'noopener,noreferrer');
        }
      }

      // Handle close
      if (data.type === 'close' || data.method === 'close' || data.type === 'fc:close') {
        onClose();
      }

      // Handle viewProfile
      if (data.type === 'viewProfile' || data.method === 'viewProfile') {
        const fid = data.fid || data.params?.fid;
        if (fid && onOpenProfile) {
          onOpenProfile(Number(fid));
          onClose();
        }
      }

      // Handle composeCast
      if (data.type === 'composeCast' || data.method === 'composeCast') {
        const text = data.text || data.params?.text || '';
        const embeds = data.embeds || data.params?.embeds;
        if (onComposeCast) {
          onComposeCast(text, embeds);
          onClose();
        }
      }
    };

    window.addEventListener('message', handleMessage);
    return () => {
      window.removeEventListener('message', handleMessage);
    };
  }, [app, account, onClose, onOpenProfile, onComposeCast]);

  if (!app) return null;

  const domain = (() => {
    try {
      return new URL(app.url).hostname;
    } catch {
      return '';
    }
  })();

  const title = app.title || domain || t`Mini App`;

  return (
    <Modal
      visible={Boolean(app)}
      onClose={onClose}
      size="large"
      title=""
      closeOnBackdropClick
      closeOnEscape
    >
      <div className="farcaster-miniapp-dialog">
        <header className="farcaster-miniapp-dialog__header">
          <div className="farcaster-miniapp-dialog__meta">
            {app.iconUrl ? (
              <img className="farcaster-miniapp-dialog__icon" src={app.iconUrl} alt="" />
            ) : (
              <div className="farcaster-miniapp-dialog__icon farcaster-miniapp-dialog__icon--fallback">
                <Icon name="world-map" size="sm" />
              </div>
            )}
            <div className="farcaster-miniapp-dialog__titles">
              <h2 className="farcaster-miniapp-dialog__title">{title}</h2>
              {domain && <span className="farcaster-miniapp-dialog__domain">{domain}</span>}
            </div>
          </div>

          <div className="farcaster-miniapp-dialog__actions">
            <Button
              type="unstyled"
              iconName="refresh"
              iconOnly
              ariaLabel={t`Reload`}
              onClick={() => {
                if (iframeRef.current) {
                  setLoading(true);
                  iframeRef.current.src = app.url;
                }
              }}
            />
            <Button
              type="unstyled"
              iconName="external-link"
              iconOnly
              ariaLabel={t`Open in browser`}
              onClick={() => window.open(app.url, '_blank', 'noopener,noreferrer')}
            />
          </div>
        </header>

        <div className="farcaster-miniapp-dialog__body">
          {loading && (
            <div className="farcaster-miniapp-dialog__loading">
              <Icon name="spinner" className="icon-spin" size="lg" />
              <span>{t`Loading Mini App...`}</span>
            </div>
          )}
          {error && (
            <div className="farcaster-miniapp-dialog__error">
              <Icon name="warning" size="lg" />
              <span>{error}</span>
            </div>
          )}
          <iframe
            ref={iframeRef}
            src={app.url}
            title={title}
            className="farcaster-miniapp-dialog__iframe"
            sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-modals allow-downloads"
            allow="camera; microphone; geolocation; clipboard-read; clipboard-write"
            onLoad={() => setLoading(false)}
            onError={() => {
              setLoading(false);
              setError(t`Failed to load Mini App`);
            }}
          />
        </div>
      </div>
    </Modal>
  );
};
