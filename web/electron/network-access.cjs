const QUORUM_API_ORIGIN = 'https://api.quorummessenger.com';
const QUORUM_WEBSOCKET_ORIGIN = 'wss://api.quorummessenger.com';
const QUORUM_WEB_ORIGIN = 'https://app.quorummessenger.com';
const FARCASTER_CLIENT_ORIGIN = 'https://client.farcaster.xyz';
const FARCASTER_API_ORIGIN = 'https://api.farcaster.xyz';
const FARCASTER_WEB_ORIGIN = 'https://farcaster.xyz';

const REQUEST_URLS = [
  `${QUORUM_API_ORIGIN}/*`,
  `${QUORUM_WEBSOCKET_ORIGIN}/*`,
  `${FARCASTER_CLIENT_ORIGIN}/*`,
  `${FARCASTER_API_ORIGIN}/*`,
];

const RESPONSE_URLS = [
  `${QUORUM_API_ORIGIN}/*`,
  `${FARCASTER_CLIENT_ORIGIN}/*`,
  `${FARCASTER_API_ORIGIN}/*`,
];

function replaceHeader(headers, name, value) {
  const updatedHeaders = { ...headers };
  for (const headerName of Object.keys(updatedHeaders)) {
    if (headerName.toLowerCase() === name.toLowerCase()) {
      delete updatedHeaders[headerName];
    }
  }
  updatedHeaders[name] = value;
  return updatedHeaders;
}

function upstreamOriginForUrl(requestUrl) {
  let url;
  try {
    url = new URL(requestUrl);
  } catch {
    return null;
  }

  if (
    url.origin === QUORUM_API_ORIGIN ||
    url.origin === QUORUM_WEBSOCKET_ORIGIN
  ) {
    return QUORUM_WEB_ORIGIN;
  }
  if (
    url.origin === FARCASTER_CLIENT_ORIGIN ||
    url.origin === FARCASTER_API_ORIGIN
  ) {
    return FARCASTER_WEB_ORIGIN;
  }
  return null;
}

function resolveDevProxyUrl(requestUrl, devServerUrl, rendererOrigin) {
  let source;
  let server;
  let renderer;
  try {
    source = new URL(requestUrl);
    server = new URL(devServerUrl);
    renderer = new URL(rendererOrigin);
  } catch {
    return null;
  }

  if (
    source.protocol !== renderer.protocol ||
    source.host !== renderer.host ||
    source.username ||
    source.password ||
    !['http:', 'https:'].includes(server.protocol)
  ) {
    return null;
  }

  // Assign the path instead of resolving it as a URL reference. A pathname
  // beginning with // is still a path here and cannot replace the dev server's
  // authority (new URL('//host', base) would do exactly that).
  server.pathname = source.pathname;
  server.search = source.search;
  server.hash = '';
  return server.toString();
}

/**
 * Electron WebRequest accepts only one listener for each event. Quorum and
 * Farcaster therefore have to share these listeners; registering one pair per
 * service silently replaces the earlier pair.
 */
function configureNetworkAccess(electronSession, rendererOrigin) {
  electronSession.webRequest.onBeforeSendHeaders(
    { urls: REQUEST_URLS },
    (details, callback) => {
      const upstreamOrigin = upstreamOriginForUrl(details.url);
      callback({
        requestHeaders: upstreamOrigin
          ? replaceHeader(details.requestHeaders, 'Origin', upstreamOrigin)
          : details.requestHeaders,
      });
    }
  );

  electronSession.webRequest.onHeadersReceived(
    { urls: RESPONSE_URLS },
    (details, callback) => {
      callback({
        responseHeaders: replaceHeader(
          details.responseHeaders,
          'Access-Control-Allow-Origin',
          [rendererOrigin]
        ),
      });
    }
  );
}

module.exports = {
  REQUEST_URLS,
  RESPONSE_URLS,
  configureNetworkAccess,
  replaceHeader,
  resolveDevProxyUrl,
  upstreamOriginForUrl,
};
