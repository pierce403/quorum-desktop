import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

type HeaderValue = string | string[];
type Headers = Record<string, HeaderValue>;

type BeforeSendHeadersListener = (
  details: { url: string; requestHeaders: Headers },
  callback: (result: { requestHeaders: Headers }) => void
) => void;

type HeadersReceivedListener = (
  details: { responseHeaders: Headers },
  callback: (result: { responseHeaders: Headers }) => void
) => void;

interface NetworkAccessModule {
  REQUEST_URLS: string[];
  RESPONSE_URLS: string[];
  configureNetworkAccess: (
    electronSession: {
      webRequest: {
        onBeforeSendHeaders: (
          filter: { urls: string[] },
          listener: BeforeSendHeadersListener
        ) => void;
        onHeadersReceived: (
          filter: { urls: string[] },
          listener: HeadersReceivedListener
        ) => void;
      };
    },
    rendererOrigin: string
  ) => void;
  replaceHeader: (
    headers: Headers,
    name: string,
    value: HeaderValue
  ) => Headers;
  resolveDevProxyUrl: (
    requestUrl: string,
    devServerUrl: string,
    rendererOrigin: string
  ) => string | null;
  upstreamOriginForUrl: (url: string) => string | null;
}

const require = createRequire(resolve(process.cwd(), 'package.json'));
const modulePath = resolve(process.cwd(), 'web/electron/network-access.cjs');
const {
  REQUEST_URLS,
  RESPONSE_URLS,
  configureNetworkAccess,
  replaceHeader,
  resolveDevProxyUrl,
  upstreamOriginForUrl,
} = require(modulePath) as NetworkAccessModule;

describe('Electron network access', () => {
  it.each([
    [
      'https://api.quorummessenger.com/v1/status',
      'https://app.quorummessenger.com',
    ],
    ['wss://api.quorummessenger.com/ws', 'https://app.quorummessenger.com'],
    ['https://client.farcaster.xyz/v2/casts', 'https://farcaster.xyz'],
    ['https://api.farcaster.xyz/v1/users', 'https://farcaster.xyz'],
    ['https://api.quorummessenger.com.evil.example/v1/status', null],
    ['https://example.com/', null],
    ['not a url', null],
  ])('maps %s only to its expected upstream origin', (url, expected) => {
    expect(upstreamOriginForUrl(url)).toBe(expected);
  });

  it('replaces header casing without mutating the input', () => {
    const original: Headers = {
      origin: 'https://old.example',
      ORIGIN: 'https://duplicate.example',
      'X-Keep': 'yes',
    };

    const updated = replaceHeader(
      original,
      'Origin',
      'https://app.quorummessenger.com'
    );

    expect(updated).toEqual({
      Origin: 'https://app.quorummessenger.com',
      'X-Keep': 'yes',
    });
    expect(original).toEqual({
      origin: 'https://old.example',
      ORIGIN: 'https://duplicate.example',
      'X-Keep': 'yes',
    });
  });

  it('keeps custom-protocol paths on the configured development server', () => {
    expect(
      resolveDevProxyUrl(
        'quorum-app://app/assets/main.js?source=electron',
        'http://127.0.0.1:5173',
        'quorum-app://app'
      )
    ).toBe('http://127.0.0.1:5173/assets/main.js?source=electron');

    // A URL reference beginning with // normally replaces the base authority.
    // It must remain an ordinary Vite request path instead.
    expect(
      resolveDevProxyUrl(
        'quorum-app://app//evil.example/script.js',
        'http://127.0.0.1:5173',
        'quorum-app://app'
      )
    ).toBe('http://127.0.0.1:5173//evil.example/script.js');
  });

  it('rejects dev proxy requests outside the renderer and HTTP server origins', () => {
    expect(
      resolveDevProxyUrl(
        'quorum-app://other/assets/main.js',
        'http://127.0.0.1:5173',
        'quorum-app://app'
      )
    ).toBeNull();
    expect(
      resolveDevProxyUrl(
        'quorum-app://user@app/assets/main.js',
        'http://127.0.0.1:5173',
        'quorum-app://app'
      )
    ).toBeNull();
    expect(
      resolveDevProxyUrl(
        'quorum-app://app/assets/main.js',
        'file:///tmp/fake-vite/',
        'quorum-app://app'
      )
    ).toBeNull();
  });

  it('uses one listener per WebRequest event and applies both header rewrites', () => {
    let beforeListener: BeforeSendHeadersListener | undefined;
    let receivedListener: HeadersReceivedListener | undefined;
    const onBeforeSendHeaders = vi.fn(
      (filter: { urls: string[] }, listener: BeforeSendHeadersListener) => {
        beforeListener = listener;
      }
    );
    const onHeadersReceived = vi.fn(
      (filter: { urls: string[] }, listener: HeadersReceivedListener) => {
        receivedListener = listener;
      }
    );

    configureNetworkAccess(
      { webRequest: { onBeforeSendHeaders, onHeadersReceived } },
      'quorum-app://app'
    );

    expect(onBeforeSendHeaders).toHaveBeenCalledOnce();
    expect(onBeforeSendHeaders.mock.calls[0]?.[0]).toEqual({
      urls: REQUEST_URLS,
    });
    expect(onHeadersReceived).toHaveBeenCalledOnce();
    expect(onHeadersReceived.mock.calls[0]?.[0]).toEqual({
      urls: RESPONSE_URLS,
    });
    expect(beforeListener).toBeTypeOf('function');
    expect(receivedListener).toBeTypeOf('function');

    const requestHeaders: Headers = {
      origin: 'quorum-app://app',
      Accept: 'application/json',
    };
    const requestCallback = vi.fn();
    beforeListener?.(
      { url: 'https://client.farcaster.xyz/v2/casts', requestHeaders },
      requestCallback
    );
    expect(requestCallback).toHaveBeenCalledWith({
      requestHeaders: {
        Origin: 'https://farcaster.xyz',
        Accept: 'application/json',
      },
    });
    expect(requestHeaders).toHaveProperty('origin', 'quorum-app://app');

    const responseHeaders: Headers = {
      'access-control-allow-origin': ['https://farcaster.xyz'],
      Vary: ['Origin'],
    };
    const responseCallback = vi.fn();
    receivedListener?.({ responseHeaders }, responseCallback);
    expect(responseCallback).toHaveBeenCalledWith({
      responseHeaders: {
        'Access-Control-Allow-Origin': ['quorum-app://app'],
        Vary: ['Origin'],
      },
    });
    expect(responseHeaders).toHaveProperty('access-control-allow-origin');
  });

  it('does not rewrite an unrecognized request if Electron calls the listener', () => {
    let beforeListener: BeforeSendHeadersListener | undefined;
    configureNetworkAccess(
      {
        webRequest: {
          onBeforeSendHeaders: (_filter, listener) => {
            beforeListener = listener;
          },
          onHeadersReceived: () => {},
        },
      },
      'quorum-app://app'
    );

    const requestHeaders: Headers = { Origin: 'quorum-app://app' };
    const callback = vi.fn();
    beforeListener?.({ url: 'https://example.com/', requestHeaders }, callback);

    expect(callback).toHaveBeenCalledWith({ requestHeaders });
    expect(callback.mock.calls[0]?.[0]?.requestHeaders).toBe(requestHeaders);
  });
});
