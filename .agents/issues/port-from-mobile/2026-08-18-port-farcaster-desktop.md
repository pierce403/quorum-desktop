# Port Farcaster to desktop

**Status:** Implemented and packaged validation complete
**Source:** `quorum-mobile` master (2026-08-18)
**Target:** `quorum-desktop` `/farcaster`

## Product decision

The user explicitly approved candidate #9 on 2026-08-18. Replace the desktop
placeholder with a working Farcaster surface.

## Desktop capability slice

- Hypersnap-first trending feed with refresh and cursor pagination.
- Authenticated following feed after account import.
- Channel feeds, user profiles, exact username lookup, cast threads.
- Images, video, link cards, quoted-cast affordances, mentions and channel links.
- Recovery-phrase account import using mobile's BIP-39/BIP-44 custody derivation.
- Official Farcaster custody authentication and shared signer provisioning.
- Cast, reply, like, unlike, recast, and unrecast writes.
- Electron `safeStorage` persistence behind narrow IPC; refuse Linux's
  `basic_text` fallback rather than persisting custody material weakly.
- Responsive desktop/phone layout using the existing Quorum shell.

## Compatibility boundary

`@quilibrium/quorum-shared` owns the Farcaster protocol clients, normalized
types, query hooks, and signer lifecycle. Desktop owns web rendering and local
navigation. React Native components and storage adapters are not copied.

The recovery phrase is never persisted. Desktop derives the custody key in the
renderer, exchanges its custody signature for the official API token, provisions
a scoped 90-day signer through `quorum-shared`, and passes the resulting account
and signer records to Electron's main process for OS-backed encryption.

Still separate from this surface: Farcaster direct casts in the Quorum DM list,
authenticated Farcaster notifications in Quorum's notification center, follows,
profile editing, media upload, and signer revocation UI.

## Verification

- TypeScript + lint/validation.
- Production Vite build.
- Packaged Electron render and network behavior.
- Live Hypersnap and official Farcaster requests from the packaged custom origin.
- Encrypted store write/read/delete round trip.
