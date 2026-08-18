const EXTERNAL_PROTOCOLS = new Set(['http:', 'https:', 'mailto:']);

function parseUrl(value) {
  if (typeof value !== 'string' || !value) return null;
  try {
    return new URL(value);
  } catch {
    return null;
  }
}

function isAppUrl(value, appOrigin) {
  const target = parseUrl(value);
  const app = parseUrl(appOrigin);
  return Boolean(
    target &&
    app &&
    target.protocol === app.protocol &&
    target.host === app.host &&
    !target.username &&
    !target.password
  );
}

function classifyNavigationTarget(value, appOrigin) {
  const target = parseUrl(value);
  if (!target) return { kind: 'deny' };
  if (isAppUrl(target.toString(), appOrigin)) {
    return { kind: 'app', url: target.toString() };
  }
  if (
    EXTERNAL_PROTOCOLS.has(target.protocol) &&
    !target.username &&
    !target.password
  ) {
    return { kind: 'external', url: target.toString() };
  }
  return { kind: 'deny' };
}

function navigationUrlFromEvent(event, legacyUrl) {
  if (event && typeof event.url === 'string') return event.url;
  return typeof legacyUrl === 'string' ? legacyUrl : null;
}

function isTrustedRenderer(event, expectedWebContents, appOrigin) {
  if (!event || !expectedWebContents || event.sender !== expectedWebContents) {
    return false;
  }
  const senderFrame = event.senderFrame;
  if (!senderFrame || senderFrame !== expectedWebContents.mainFrame)
    return false;
  return isAppUrl(senderFrame.url, appOrigin);
}

module.exports = {
  classifyNavigationTarget,
  isAppUrl,
  isTrustedRenderer,
  navigationUrlFromEvent,
};
