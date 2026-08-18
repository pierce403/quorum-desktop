import { describe, expect, it } from 'vitest';
import { getSafeStackLocation } from '@/utils/devDiagnostics';

const SECRET_CANARY = 'PRIVATE_STACK_MESSAGE_CANARY_0123456789';

describe('renderer development diagnostics', () => {
  it('extracts only numeric app-frame locations from an exception stack', () => {
    const location = getSafeStackLocation({
      stack: `${SECRET_CANARY}\n    at decrypt (quorum-app://app/assets/index-safe.js:28:12345)`,
    });

    expect(location).toEqual({ line: 28, column: 12345 });
    expect(JSON.stringify(location)).not.toContain(SECRET_CANARY);
  });

  it('ignores data URLs and arbitrary non-web stack text', () => {
    expect(
      getSafeStackLocation({
        stack: `at data:text/javascript,${SECRET_CANARY}:28:12345`,
      })
    ).toEqual({});
    expect(getSafeStackLocation({ stack: SECRET_CANARY })).toEqual({});
    expect(getSafeStackLocation(null)).toEqual({});
  });
});
