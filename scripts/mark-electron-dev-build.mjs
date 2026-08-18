import { constants } from 'node:fs';
import { access, chmod, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const distDirectory = fileURLToPath(new URL('../dist/', import.meta.url));
const indexPath = fileURLToPath(new URL('../dist/index.html', import.meta.url));
const markerPath = fileURLToPath(
  new URL('../dist/quorum-dev-build.json', import.meta.url)
);

// Refuse to create a marker in an empty/stale tree. The package scripts always
// run the production Vite build first so the diagnostic build exercises the
// same renderer bundle and origin as a release.
await access(indexPath, constants.R_OK);
await writeFile(
  markerPath,
  `${JSON.stringify(
    {
      kind: 'quorum-electron-development-build',
      diagnostics: true,
    },
    null,
    2
  )}\n`,
  { encoding: 'utf8', mode: 0o600 }
);
await chmod(markerPath, 0o600);

console.log(`Marked Electron development bundle: ${distDirectory}`);
