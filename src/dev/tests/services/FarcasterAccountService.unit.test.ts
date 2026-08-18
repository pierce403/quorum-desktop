import { describe, expect, it } from 'vitest';
import {
  deriveFarcasterCustodyKey,
  signFarcasterPersonalMessage,
  validateFarcasterRecoveryPhrase,
} from '@/services/FarcasterAccountService';
import { secp256k1 } from '@noble/curves/secp256k1.js';
import { keccak_256 } from '@noble/hashes/sha3.js';
import { hexToBytes } from '@noble/hashes/utils.js';

describe('FarcasterAccountService', () => {
  const testPhrase = 'test test test test test test test test test test test junk';

  it('validates BIP-39 recovery phrases and rejects malformed input', () => {
    expect(validateFarcasterRecoveryPhrase(testPhrase)).toBe(true);
    expect(validateFarcasterRecoveryPhrase('test '.repeat(12))).toBe(false);
    expect(validateFarcasterRecoveryPhrase('not a phrase')).toBe(false);
  });

  it('derives the standard Ethereum BIP-44 custody account', () => {
    expect(deriveFarcasterCustodyKey(testPhrase).address).toBe(
      '0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266',
    );
  });

  it('emits an Ethereum EIP-191 signature recoverable to the custody key', () => {
    const custody = deriveFarcasterCustodyKey(testPhrase);
    const message = '{"method":"generateToken"}';
    const signed = signFarcasterPersonalMessage(message, custody.privateKey).slice(2);
    const compact = signed.slice(0, 128);
    const recovery = parseInt(signed.slice(128), 16) - 27;
    const bytes = new TextEncoder().encode(message);
    const digest = keccak_256(new TextEncoder().encode(`\x19Ethereum Signed Message:\n${bytes.length}${message}`));
    const recovered = secp256k1.Signature
      .fromBytes(hexToBytes(compact))
      .addRecoveryBit(recovery)
      .recoverPublicKey(digest)
      .toBytes(false);
    expect(recovered).toEqual(secp256k1.getPublicKey(hexToBytes(custody.privateKey), false));
  });
});
