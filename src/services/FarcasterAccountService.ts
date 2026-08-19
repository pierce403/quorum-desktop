import { secp256k1 } from '@noble/curves/secp256k1.js';
import { keccak_256 } from '@noble/hashes/sha3.js';
import { hmac } from '@noble/hashes/hmac.js';
import { sha512 } from '@noble/hashes/sha2.js';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js';
import * as bip39 from '@scure/bip39';
import { wordlist } from '@scure/bip39/wordlists/english.js';
import {
  provisionSigner,
  type SignerRecord,
  type SignerStore,
} from '@quilibrium/quorum-shared';
import { nativeFetch } from '../utils/nativeFetch';

const FARCASTER_API_BASE_URL = 'https://client.farcaster.xyz';
const ACCOUNT_KEY = 'farcaster-account' as const;
const SIGNER_KEY = 'farcaster-signer' as const;
const HARDENED_OFFSET = 0x80000000;
const BITCOIN_SEED_KEY = new TextEncoder().encode('Bitcoin seed');
const TOKEN_LIFETIME_MS = 1_000 * 24 * 60 * 60 * 1_000;

export interface DesktopFarcasterAccount {
  fid: number;
  username: string;
  displayName?: string;
  pfpUrl?: string;
  custodyAddress: string;
  custodyPrivateKey: string;
  authToken?: string;
  authTokenExpiresAt?: number | null;
  lastSignerNonce: number;
}

function storage() {
  const value = window.electron?.secureStorage;
  if (!value) throw new Error('Farcaster account import is available in the Electron app.');
  return value;
}

export async function getFarcasterStorageStatus() {
  if (!window.electron?.secureStorage) return { available: false, backend: 'browser' };
  return window.electron.secureStorage.status();
}

export const desktopFarcasterSignerStore: SignerStore = {
  async get() {
    if (!window.electron?.secureStorage) return null;
    const raw = await window.electron.secureStorage.get(SIGNER_KEY);
    return raw ? (JSON.parse(raw) as SignerRecord) : null;
  },
  async save(record) {
    if (!window.electron?.secureStorage) return;
    await window.electron.secureStorage.set(SIGNER_KEY, JSON.stringify(record));
  },
  async clear() {
    if (!window.electron?.secureStorage) return;
    await window.electron.secureStorage.delete(SIGNER_KEY);
  },
};

export async function loadDesktopFarcasterAccount(): Promise<DesktopFarcasterAccount | null> {
  if (!window.electron?.secureStorage) return null;
  const raw = await window.electron.secureStorage.get(ACCOUNT_KEY);
  return raw ? (JSON.parse(raw) as DesktopFarcasterAccount) : null;
}

export async function disconnectDesktopFarcasterAccount(): Promise<void> {
  if (!window.electron?.secureStorage) return;
  await Promise.all([
    window.electron.secureStorage.delete(ACCOUNT_KEY),
    window.electron.secureStorage.delete(SIGNER_KEY),
  ]);
}

function concatBytes(...arrays: Uint8Array[]): Uint8Array {
  const output = new Uint8Array(arrays.reduce((sum, value) => sum + value.length, 0));
  let offset = 0;
  for (const value of arrays) {
    output.set(value, offset);
    offset += value.length;
  }
  return output;
}

function ser32(value: number): Uint8Array {
  return new Uint8Array([
    (value >>> 24) & 0xff,
    (value >>> 16) & 0xff,
    (value >>> 8) & 0xff,
    value & 0xff,
  ]);
}

export function validateFarcasterRecoveryPhrase(phrase: string): boolean {
  const normalized = phrase.toLowerCase().trim().split(/\s+/).join(' ');
  const count = normalized ? normalized.split(' ').length : 0;
  return (count === 12 || count === 24) && bip39.validateMnemonic(normalized, wordlist);
}

export function deriveFarcasterCustodyKey(phrase: string): { address: string; privateKey: string } {
  const mnemonic = phrase.toLowerCase().trim().split(/\s+/).join(' ');
  if (!validateFarcasterRecoveryPhrase(mnemonic)) throw new Error('Invalid recovery phrase.');
  const seed = bip39.mnemonicToSeedSync(mnemonic);
  const master = hmac(sha512, BITCOIN_SEED_KEY, seed);
  let key: Uint8Array = new Uint8Array(master.slice(0, 32));
  let chainCode: Uint8Array = new Uint8Array(master.slice(32));
  const path = [44 + HARDENED_OFFSET, 60 + HARDENED_OFFSET, HARDENED_OFFSET, 0, 0];
  const curveOrder = BigInt('0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141');

  for (const index of path) {
    const data = index >= HARDENED_OFFSET
      ? concatBytes(new Uint8Array([0]), key, ser32(index))
      : concatBytes(secp256k1.getPublicKey(key, true), ser32(index));
    const derived = hmac(sha512, chainCode, data);
    const next = (BigInt(`0x${bytesToHex(key)}`) + BigInt(`0x${bytesToHex(derived.slice(0, 32))}`)) % curveOrder;
    key = new Uint8Array(hexToBytes(next.toString(16).padStart(64, '0')));
    chainCode = new Uint8Array(derived.slice(32));
  }

  const publicKey = secp256k1.getPublicKey(key, false).slice(1);
  const address = `0x${bytesToHex(keccak_256(publicKey).slice(-20))}`;
  return { address: address.toLowerCase(), privateKey: bytesToHex(key) };
}

function canonicalize(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(',')}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonicalize(record[key])}`).join(',')}}`;
}

export function signFarcasterPersonalMessage(message: string, privateKeyHex: string): string {
  const bytes = new TextEncoder().encode(message);
  const digest = keccak_256(new TextEncoder().encode(`\x19Ethereum Signed Message:\n${bytes.length}${message}`));
  const privateKey = hexToBytes(privateKeyHex);
  const signature = secp256k1.Signature.fromBytes(
    secp256k1.sign(digest, privateKey, { lowS: true, prehash: false }),
  );
  const publicKey = bytesToHex(secp256k1.getPublicKey(privateKey, false));
  let recovery = 0;
  for (let candidate = 0; candidate <= 1; candidate += 1) {
    try {
      if (bytesToHex(signature.addRecoveryBit(candidate).recoverPublicKey(digest).toBytes(false)) === publicKey) {
        recovery = candidate;
        break;
      }
    } catch { /* try the other recovery bit */ }
  }
  return `0x${signature.toHex('compact')}${(recovery + 27).toString(16).padStart(2, '0')}`;
}

function custodyBearer(authRequest: unknown, privateKey: string): string {
  const signature = hexToBytes(signFarcasterPersonalMessage(canonicalize(authRequest), privateKey).slice(2));
  let binary = '';
  for (const byte of signature) binary += String.fromCharCode(byte);
  return `eip191:${btoa(binary)}`;
}

async function lookupAccount(address: string, privateKey: string) {
  const timestamp = Date.now();
  const authRequest = {
    method: 'generateToken',
    params: { timestamp, expiresAt: timestamp + TOKEN_LIFETIME_MS },
  };

  console.log(`[Farcaster Import] Looking up account for custody address: ${address}`);

  let data: Record<string, any> | null = null;
  let authToken: string | undefined;
  let authTokenExpiresAt: number | null = null;

  try {
    const response = await nativeFetch(`${FARCASTER_API_BASE_URL}/v2/onboarding-state`, {
      method: 'PUT',
      headers: {
        accept: 'application/json',
        'content-type': 'application/json',
        authorization: `Bearer ${custodyBearer(authRequest, privateKey)}`,
      },
      body: JSON.stringify({ authRequest }),
    });

    console.log(`[Farcaster Import] /v2/onboarding-state HTTP status: ${response.status}`);
    if (response.ok) {
      data = (await response.json()) as Record<string, any>;
      console.log('[Farcaster Import] /v2/onboarding-state response body:', data);
      authToken = data?.result?.token?.secret ?? data?.result?.authToken;
      authTokenExpiresAt = data?.result?.token?.expiresAt ?? data?.result?.authTokenExpiresAt ?? null;
    }
  } catch (e) {
    console.warn('[Farcaster Import] /v2/onboarding-state request error:', e);
  }

  const res = data?.result;

  // Extract user and fid from all possible response locations
  let user = res?.user ?? res?.state?.user;
  let fid: number | undefined =
    (typeof user?.fid === 'number' && user.fid > 0 ? user.fid : undefined) ??
    (typeof res?.fid === 'number' && res.fid > 0 ? res.fid : undefined) ??
    (typeof res?.state?.fid === 'number' && res.state.fid > 0 ? res.state.fid : undefined);

  // If fid or user profile is missing, fallback to /v2/me using the auth token
  if ((!fid || !user?.username) && authToken) {
    try {
      console.log('[Farcaster Import] Querying /v2/me with auth token...');
      const meRes = await nativeFetch(`${FARCASTER_API_BASE_URL}/v2/me`, {
        headers: {
          accept: 'application/json',
          authorization: `Bearer ${authToken}`,
        },
      });
      console.log(`[Farcaster Import] /v2/me HTTP status: ${meRes.status}`);
      if (meRes.ok) {
        const meData = (await meRes.json()) as Record<string, any>;
        console.log('[Farcaster Import] /v2/me response:', meData);
        const meUser = meData?.result?.user ?? meData?.result;
        if (meUser) {
          user = { ...user, ...meUser };
          if (typeof meUser.fid === 'number' && meUser.fid > 0) {
            fid = meUser.fid;
          }
        }
      }
    } catch (e) {
      console.warn('[Farcaster Import] /v2/me lookup failed:', e);
    }
  }

  // If fid is still missing, attempt known custody lookup endpoints
  if (!fid) {
    const custodyEndpoints = [
      `https://farcaster.xyz/~api/v2/user-by-custody-address?custodyAddress=${encodeURIComponent(address)}`,
      `https://client.warpcast.com/v2/user-by-custody-address?custodyAddress=${encodeURIComponent(address)}`,
      `https://client.farcaster.xyz/v2/user-by-custody-address?custodyAddress=${encodeURIComponent(address)}`,
    ];

    for (const ep of custodyEndpoints) {
      try {
        console.log(`[Farcaster Import] Trying endpoint: ${ep}`);
        const custRes = await nativeFetch(ep, {
          headers: {
            accept: 'application/json',
            origin: 'https://farcaster.xyz',
            referer: 'https://farcaster.xyz/',
            ...(authToken ? { authorization: `Bearer ${authToken}` } : {}),
          },
        });
        console.log(`[Farcaster Import] ${ep} status: ${custRes.status}`);
        if (custRes.ok) {
          const custData = (await custRes.json()) as Record<string, any>;
          console.log(`[Farcaster Import] ${ep} payload:`, custData);
          const custUser = custData?.result?.user ?? custData?.result;
          if (custUser) {
            user = { ...user, ...custUser };
            if (typeof custUser.fid === 'number' && custUser.fid > 0) {
              fid = custUser.fid;
              break;
            }
          }
        }
      } catch (e) {
        console.warn(`[Farcaster Import] Endpoint error on ${ep}:`, e);
      }
    }
  }

  if (!fid || fid <= 0) {
    console.error('[Farcaster Import] Failed to resolve valid Farcaster FID for custody address:', address);
    return null;
  }

  console.log(`[Farcaster Import] Successfully resolved account: fid=${fid}, username=${user?.username || user?.displayName}`);

  return {
    fid,
    username: (user?.username as string) || `user_${fid}`,
    displayName: (user?.displayName as string) || (user?.username as string) || `User ${fid}`,
    pfpUrl: (user?.pfpUrl as string) || (user?.pfp?.url as string) || undefined,
    authToken,
    authTokenExpiresAt,
    address,
  };
}

export async function importDesktopFarcasterAccount(phrase: string): Promise<DesktopFarcasterAccount> {
  const status = await getFarcasterStorageStatus();
  if (!status.available) throw new Error('Your OS credential store is unavailable.');
  const custody = deriveFarcasterCustodyKey(phrase);
  console.log('[Farcaster Import] Starting import for custody address:', custody.address);

  const found = await lookupAccount(custody.address, custody.privateKey);
  if (!found) throw new Error('No Farcaster account was found for that recovery phrase.');

  const previous = await loadDesktopFarcasterAccount();
  const storedSigner = await desktopFarcasterSignerStore.get();
  const nonce = Math.max(previous?.lastSignerNonce ?? 0, Math.floor(Date.now() / 1_000)) + 1;
  if (!storedSigner || storedSigner.fid !== found.fid || storedSigner.custodyAddress.toLowerCase() !== custody.address) {
    console.log(`[Farcaster Import] Provisioning Hypersnap signer for FID=${found.fid}, nonce=${nonce}...`);
    const { record } = await provisionSigner({
      fid: found.fid,
      custodyPrivateKey: hexToBytes(custody.privateKey),
      nonce,
    });
    console.log('[Farcaster Import] Hypersnap signer provisioned successfully:', record.publicKeyHex);
    await desktopFarcasterSignerStore.save(record);
  }

  const account: DesktopFarcasterAccount = {
    fid: found.fid,
    username: found.username,
    displayName: found.displayName,
    pfpUrl: found.pfpUrl,
    custodyAddress: custody.address,
    custodyPrivateKey: custody.privateKey,
    authToken: found.authToken,
    authTokenExpiresAt: found.authTokenExpiresAt,
    lastSignerNonce: nonce,
  };
  await storage().set(ACCOUNT_KEY, JSON.stringify(account));
  console.log('[Farcaster Import] Farcaster account saved successfully in secure storage.');
  return account;
}
