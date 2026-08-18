import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

type NavigationTarget =
  | { kind: 'app' | 'external'; url: string }
  | { kind: 'deny' };

interface RendererSecurityModule {
  classifyNavigationTarget: (
    value: unknown,
    appOrigin: string
  ) => NavigationTarget;
  isAppUrl: (value: unknown, appOrigin: string) => boolean;
  isTrustedRenderer: (
    event: unknown,
    expectedWebContents: unknown,
    appOrigin: string
  ) => boolean;
  navigationUrlFromEvent: (
    event: unknown,
    legacyUrl?: unknown
  ) => string | null;
}

const require = createRequire(resolve(process.cwd(), 'package.json'));
const modulePath = resolve(process.cwd(), 'web/electron/renderer-security.cjs');
const {
  classifyNavigationTarget,
  isAppUrl,
  isTrustedRenderer,
  navigationUrlFromEvent,
} = require(modulePath) as RendererSecurityModule;
const APP_ORIGIN = 'quorum-app://app';

describe('Electron renderer security policy', () => {
  it('keeps exact quorum-app routes internal and rejects confusable origins', () => {
    expect(isAppUrl('quorum-app://app/rooms/42?tab=chat', APP_ORIGIN)).toBe(
      true
    );
    expect(isAppUrl('quorum-app://app.evil.example/rooms/42', APP_ORIGIN)).toBe(
      false
    );
    expect(isAppUrl('quorum-app://user@app/rooms/42', APP_ORIGIN)).toBe(false);
    expect(isAppUrl('https://app/rooms/42', APP_ORIGIN)).toBe(false);
  });

  it('opens only ordinary external links outside Electron', () => {
    expect(
      classifyNavigationTarget('https://example.com/path?q=1', APP_ORIGIN)
    ).toEqual({ kind: 'external', url: 'https://example.com/path?q=1' });
    expect(
      classifyNavigationTarget('mailto:hello@example.com', APP_ORIGIN)
    ).toEqual({ kind: 'external', url: 'mailto:hello@example.com' });
    expect(
      classifyNavigationTarget('quorum-app://app/settings', APP_ORIGIN)
    ).toEqual({ kind: 'app', url: 'quorum-app://app/settings' });
    expect(classifyNavigationTarget('file:///tmp/secret', APP_ORIGIN)).toEqual({
      kind: 'deny',
    });
    expect(classifyNavigationTarget('javascript:alert(1)', APP_ORIGIN)).toEqual(
      { kind: 'deny' }
    );
    expect(
      classifyNavigationTarget('https://user:pass@example.com/', APP_ORIGIN)
    ).toEqual({ kind: 'deny' });
  });

  it('trusts only the primary main frame at the exact app origin', () => {
    const mainFrame = { url: 'quorum-app://app/onboarding' };
    const webContents = { mainFrame };
    const event = { sender: webContents, senderFrame: mainFrame };

    expect(isTrustedRenderer(event, webContents, APP_ORIGIN)).toBe(true);
    expect(
      isTrustedRenderer(
        { sender: webContents, senderFrame: { url: mainFrame.url } },
        webContents,
        APP_ORIGIN
      )
    ).toBe(false);
    expect(
      isTrustedRenderer(
        { sender: {}, senderFrame: mainFrame },
        webContents,
        APP_ORIGIN
      )
    ).toBe(false);

    mainFrame.url = 'https://example.com/';
    expect(isTrustedRenderer(event, webContents, APP_ORIGIN)).toBe(false);
  });

  it('uses the Electron 41 navigation details URL with a legacy fallback', () => {
    expect(
      navigationUrlFromEvent(
        { url: 'https://details.example/' },
        'https://legacy.example/'
      )
    ).toBe('https://details.example/');
    expect(navigationUrlFromEvent({}, 'https://legacy.example/')).toBe(
      'https://legacy.example/'
    );
    expect(navigationUrlFromEvent({}, undefined)).toBeNull();
  });
});
