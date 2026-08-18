// Production targets. The browser blocks direct cross-origin calls from the Vite
// dev server (localhost) to these, since the API doesn't send CORS headers for
// localhost. To avoid that during `yarn dev`, we route through Vite's dev proxy
// (see web/vite.config.ts → server.proxy), which forwards server-side so the
// browser only ever talks same-origin (localhost → localhost). No CORS involved.
const PROD_API_URL = 'https://api.quorummessenger.com';
const PROD_WS_URL = 'wss://api.quorummessenger.com/ws';

// Same-origin paths handled by the Vite dev proxy. Empty baseUrl means request
// URLs become same-origin (e.g. `/quorum-api/inbox`), which the proxy intercepts.
const DEV_PROXY_API_URL = '/quorum-api';
const DEV_PROXY_WS_URL = '/quorum-ws';

// True only in a Vite development renderer. Production builds use the direct
// service URLs even when Electron diagnostics have explicitly been enabled.
const isDevBrowser = import.meta.env.DEV && typeof window !== 'undefined';

function getDevProxyWsUrl(): string | undefined {
  if (!isDevBrowser) return undefined;

  // Electron keeps a stable quorum-app:// origin and proxies HTTP requests to
  // Vite. WebSockets cannot use that custom scheme, so preload supplies the
  // actual HTTP(S) dev-server URL. A normal browser dev session falls back to
  // its own HTTP(S) origin.
  const candidates = [window.electron?.devServerUrl, window.location.origin];

  for (const candidate of candidates) {
    if (!candidate) continue;
    try {
      const url = new URL(candidate);
      if (url.protocol !== 'http:' && url.protocol !== 'https:') continue;
      const protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
      return `${protocol}//${url.host}${DEV_PROXY_WS_URL}`;
    } catch {
      // Ignore malformed preload data and try the renderer origin next.
    }
  }

  return undefined;
}

export const getQuorumApiConfig = function () {
  return {
    quorumApiUrl: isDevBrowser ? DEV_PROXY_API_URL : PROD_API_URL,
    quorumWsUrl: getDevProxyWsUrl() ?? PROD_WS_URL,
    apiVersion: 'v1',
    langId: 'en-US',
  };
};
