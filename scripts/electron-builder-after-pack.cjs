const fs = require('fs/promises');
const path = require('path');

/**
 * Chromium refuses to start when a bundled SUID helper is present without its
 * required mode. electron-builder's AppImage tooling preserves root ownership
 * inside SquashFS, so setting 04755 before target creation yields a functional
 * sandboxed AppImage instead of forcing users to pass --no-sandbox.
 */
module.exports = async function configureLinuxSandbox(context) {
  if (context.electronPlatformName !== 'linux') return;
  await fs.chmod(path.join(context.appOutDir, 'chrome-sandbox'), 0o4755);
};
