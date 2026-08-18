const { randomUUID } = require('crypto');
const { promises: fs } = require('fs');
const path = require('path');

function isSecretMap(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

async function readSecretMap(filePath, fileSystem) {
  try {
    const parsed = JSON.parse(await fileSystem.readFile(filePath, 'utf8'));
    if (!isSecretMap(parsed)) throw new Error('Invalid secure storage file');
    return parsed;
  } catch (error) {
    if (error && error.code === 'ENOENT') return {};
    throw error;
  }
}

async function writeSecretMap(filePath, values, fileSystem) {
  const directory = path.dirname(filePath);
  const temporary = path.join(
    directory,
    `.${path.basename(filePath)}.${process.pid}.${randomUUID()}.tmp`
  );
  await fileSystem.mkdir(directory, { recursive: true });
  try {
    await fileSystem.writeFile(temporary, JSON.stringify(values), {
      encoding: 'utf8',
      mode: 0o600,
      flag: 'wx',
    });
    await fileSystem.rename(temporary, filePath);
  } catch (error) {
    await fileSystem.unlink(temporary).catch(() => {});
    throw error;
  }
}

/**
 * Serialize the entire read/modify/write cycle. Farcaster account and signer
 * records share one JSON file and are intentionally mutated concurrently by
 * some renderer flows; serializing only the final write would lose one update.
 */
function createSecretFileStore({
  filePath,
  encrypt,
  decrypt,
  fileSystem = fs,
}) {
  if (typeof filePath !== 'string' || !filePath) {
    throw new Error('A secure storage file path is required');
  }
  if (typeof encrypt !== 'function' || typeof decrypt !== 'function') {
    throw new Error('Secure storage codecs are required');
  }

  let operationTail = Promise.resolve();

  function serialize(operation) {
    const result = operationTail.then(operation, operation);
    operationTail = result.then(
      () => undefined,
      () => undefined
    );
    return result;
  }

  return {
    get(key) {
      return serialize(async () => {
        const values = await readSecretMap(filePath, fileSystem);
        const encrypted = values[key];
        return typeof encrypted === 'string' ? decrypt(encrypted) : null;
      });
    },

    set(key, value) {
      return serialize(async () => {
        const values = await readSecretMap(filePath, fileSystem);
        values[key] = encrypt(value);
        await writeSecretMap(filePath, values, fileSystem);
      });
    },

    delete(key) {
      return serialize(async () => {
        const values = await readSecretMap(filePath, fileSystem);
        const present = typeof values[key] === 'string';
        delete values[key];
        await writeSecretMap(filePath, values, fileSystem);
        return present;
      });
    },
  };
}

module.exports = { createSecretFileStore };
