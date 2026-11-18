# Mojito ME · Mobile Edition

The React Native client for **[Mojito](https://www.mintlayer.org/wallet)**, Mintlayer's non-custodial
wallet, *"your gateway to Bitcoin DeFi."*

Mojito is self-custodial by design: **your keys, your coins**. It holds BTC, ML, MLS-01 tokens and
NFTs, generates a fresh address per transaction for privacy, encrypts client-side before anything
leaves the device, and restores from a seed phrase alone. Mojito already ships as a browser
extension and on the App Store and Google Play; this repository is the *neo* generation of the
mobile app, rebuilt in React Native.

---

## ⚠️ Project status · M6 (release readiness)

**This repository is the release milestone: a feature-complete v1 candidate on top of M0 to M5 (keys and vault, live chain data, the send pipeline, the trade surfaces, the card waitlist), with the release gates run and recorded in `docs/REVIEW-RUNBOOK.md` and the device matrix finalized in `docs/MANUAL-QA.md`. The machine gates are green; store submission waits on the ship blockers below and the device pass.**

### Ship blockers (consolidated; each ships honest-gated until it closes)

1. **Card waitlist backend (R4)**: v1 persistence is device-local only; a production build refuses to start without a configured `waitlistBase` (`LocalWaitlistShipBlockerError` in `createWaitlistProvider`). This is the enforced gate, not a warning.
2. **ML transaction broadcast endpoint (R3, action item A1)**: the Mintlayer-operated production API refuses submissions (403); real-mode ML send reviews and signs, then stops honestly at broadcast. Enabling later is a URL change in `src/config/endpoints.ts`.
3. **Mintlayer-operated testnet URL (action item A2, R6)**: testnet ships typed-offline; release builds hide the network switch (dev-only until the URL lands).
4. **BTC data backend deployment (F13)**: no production btc-api base is configured; the BTC surface degrades honestly (chains list drops Bitcoin) until a deployment URL is set.
5. **EVM signer decision (R5 sub-question)**: the bridge's Ethereum-to-Mintlayer direction stays disabled with explanatory copy; the M2E direction is wired to the bridge api but gated until the deposit intent encoder and the ML submission route exist.
6. **Bindings call-through device verification**: the vendored artifacts are linked and the facades compile, but no build machine has verified the native call-through; the TS key paths do not depend on it.

Release configuration shipped in M6: final EAS profiles (`development`, `preview`, `production-android`, `production-ios`; Android local, iOS via Mac mini or CI per D5), production identifiers `org.mintlayer.mojito.me`, CI-stamped build numbers, the static perf and size gates in `npm run check`, and the honesty audit in `docs/REVIEW-RUNBOOK.md` section 3. Measured JS bundle: 4.40 MiB against the 4 MB budget, waived in writing in the runbook. Timing and installed-size numbers await the device pass (`docs/MANUAL-QA.md`).

Real in M5:

- **Card waitlist**: the form machine (RFC-validated input, no double submits, submit-time address freeze so a mid-flight edit cannot rename the confirmation), the masked confirmation and duplicate callouts, the provider-state counter, the Settings membership row with Leave, and the sign-out wipe. **R4 ship blocker (decision R4, 2026-11-17): the waitlist backend does not exist; v1 persistence is device-local only, and a production build must never ship it. `createWaitlistProvider` refuses release construction without a configured `waitlistBase` (project decision log R4, missing-architecture gap 4).**

Real in M4:

- **Order book**: Dex depth rows come from GET /order/pair/{base}_{quote}/book with keyset cursor pagination and an invalid-cursor page-1 restart; stale and error states are explicit, never fixture rows in real mode.
- **Orders**: place (confirm sheet with the exact amounts and a slippage guard against the book mid), fill and conclude run the bindings order encoders with the F11 witness mix (no-signature on the order input, signed payer inputs); the order id derives through the bindings from the create tx inputs, and fill and conclude inputs carry the account nonce and block height per the vendored wallet-bindings v0.1.0 signatures (pinned by src/trade/bindingsParity.test.ts).
- **Atomic swap**: the ML-side HTLC flow (lock, claim, refund, secret extraction) per the docs guide; sessions persist across restarts with the secret hash only (the preimage never persists and never logs; the keep-open warning explains what is at stake), and the lock bytes are stored before the broadcast so a crash cannot strand the refund. The BTC counterparty leg is the scripted demo (see scripts/e2e-testnet.mjs); the timelock guard returns with real offers (project decision log).
- **Bridge**: quotes and status ride the bridge_v2 api-server per R5 (per-token fees per direction, the Mintlayer treasury deposit address, m2e deposit confirmations); E2M stays disabled with explanatory copy (no EVM signer, scoped decision open). M2E initiation is honestly gated until the deposit intent encoder and the ML submission route exist. The EVM demo fixtures (Arbitrum, Polygon, BNB) are removed from the bridge chains and pickers in this milestone.

M3 (still accurate): BTC sends are end-to-end real on scure against the configured btc-api base; ML sends prepare and sign over the bindings interface but honestly refuse to broadcast (R3, action item A1); the send lifecycle tracks pending to confirmed with fresh-address rotation.

Real since M1, with vector-backed tests:

- **Recovery phrase**: full BIP39 over the complete 2048-word English list. Generation from device secure random (optionally mixed with the drawn-entropy screen, which genuinely feeds the phrase), import validation with checksum, PBKDF2-HMAC-SHA512 seeding.
- **Vault**: the phrase is sealed with AES-256-GCM under a Keychain (iOS) or Keystore (Android) resident key before onboarding completes; the wallet survives kill and relaunch. The key is **user-authentication gated only when you chose biometrics on the Secure screen** (the persisted choice, never hardware detection): every seal and open then runs the OS biometric prompt inside the native module, and enrolling a new biometric invalidates the key. Enabling biometrics later re-seals the vault under a gated key at the next unlock.
- **PIN and lock**: persisted PBKDF2 verifier with an escalating lockout that survives restart; real `LocalAuthentication` biometric prompts (biometry-only for the wallet lock, in-app PIN always works); auto-lock on background; the recovery-phrase reveal sits behind a re-auth step-up.
- **Derivation**: Mintlayer account 0 (`m/44'/<coin type>'/0'`) and BTC BIP84 account (`m/84'/<coin>'/0'`) in pure TypeScript, byte-pinned to the bindings' published parity vectors and the BIP84 test vectors. Discovery derives real addresses and probes real usage.

Real in M3:

- **BTC sends**: build, sign and broadcast are fully real in TypeScript (@scure/btc-signer P2WPKH, BIP84-vector pinned) against the configured btc-api base; fee tiers read live /fee-estimates with a flagged fixed fallback when the backend is unreachable.
- **ML sends**: address validation (mtc1/tmt1/bc1/tb1 with wrong-network detection), exact decimal amount parsing, UTXO selection with the implicit-fee invariant, and assembly/signing over the Mintlayer bindings interface. The signing call-through is the recorded device-pending seam: without a dev build on a device it fails typed, never fakes a signature.
- **Send lifecycle**: the three-step flow (details, review, sent) with per-tier live quotes, the typed error taxonomy (insufficient funds, malformed address, broadcast disabled or failed, timeout, rejection), pending to confirmed tracking that nudges the activity list, and fresh-address rotation after every send.
- **Demo path (R3)**: in mock mode the send flow completes on the mock broadcaster with demo-labelled fake ids, so the UX is fully demoable while ML production sending waits on a public submission endpoint (action item A1).

Real in M2, on mainnet:

- **Chain data**: balances, MLS-01 token balances, NFT metadata and transaction history come from the public Mintlayer indexer; BTC balances and history come from the configured btc-api base under its Esplora shape. Portfolio and BTC totals sum every derived address on BigInt atom strings; USD figures still use mock prices per R1.
- **Fresh addresses**: a sequential gap scan (BIP44 gap limit) finds used addresses at launch, persists the next index per chain and network, and the receive screen always shows the first unused address with a scannable QR encoding it.
- **Polling**: the home surfaces refresh on a 60 second cycle with failure backoff, pause in background and refresh once on foreground; real-mode data loads run only behind an unlocked session.

Still fixture-backed or deferred, deliberately:

- **Prices** are the mock provider in both modes (R1): every USD figure is indicative, and the home screen says so with the demo-data chip.
- **ML production sending** waits on infrastructure: the production API refuses transaction submissions (403), so the real-mode ML flow stops honestly at the broadcast step (R3, action item A1); the config switch makes enabling it a URL change.
- **ML signing device verification** is pending: the bindings artifacts are vendored and the TS pipeline is wired to their interface, but no build machine has verified the native call-through yet.
- **BTC device verification** is pending: balances and sends come from the configured btc-api deployment, and an end-to-end check against a funded device has not run yet.
- **Testnet** ships typed-offline: no Mintlayer-operated testnet indexer URL is documented (action item A2), so nothing points at a guess. The E2E harness (`npx tsx scripts/e2e-testnet.mjs`) states this honestly and runs its BTC leg when a btc-api testnet base is provided.
- The **vendored bindings call-through** (transaction assembly, signing, native encoders) still rejects; the artifacts are vendored and linked, the facades are real code that compiles on EAS, and the TS key paths above do not depend on the call-through. See the Storage section and `vendor/mintlayer/`.
- **QR encoding** rides the battle-tested `react-native-qrcode-svg` library at error correction H: the spec's pure-TypeScript encoder deliverable (ECC M) was replaced deliberately, and the substitution is recorded in the project decision log (D14).
- **Camera scanning** (the send screen's ScanSheet over expo-camera) ships with a later milestone: the QR button explains this honestly in an alert, and the deferral is recorded in the project decision log (D15). The store's camera usage string rides with it.
- **DEX Trades/Depth segment** sets state but no trades panel consumes it yet (carried from the M1-gate UX list through the M6 reconciliation in `docs/REVIEW-RUNBOOK.md` 4.2): the house rule (wire, visibly disable, or remove) applies at the fix pass that owns the panel.
- **Timing and installed-size numbers** (cold start, tab switch, sheet open, QR; installed iOS and Android sizes) await the device pass per `docs/MANUAL-QA.md`; the static halves ship in `npm run check` (`scripts/perf.mjs`, `scripts/size-report.mjs`).
- **Native biometric prompt strings** are English-only (the module has no locale channel yet; recorded in the external deferred-UX notes), and **NFT rows** render text-only (no image dependency in the set).

Do not point this at real funds you cannot afford to lose, and do not treat any screen here as a security control until the corresponding logic is implemented and audited.

---

## What's implemented

| Area | Screens |
|---|---|
| **Onboarding** | Welcome · Secure (biometric) · PIN set/confirm · Seed reveal · Verify backup · Import phrase · Account discovery · Draw-your-own-entropy |
| **Wallet** | Home (portfolio, balance chart, activity) · DEX (order book + ticket) |
| **Trade** | Atomic Swap (HTLC sessions) · Bridge (Mintlayer ⇄ Ethereum) · Mojito Card waitlist |
| **Flows** | Send (3-step) · Receive (QR) · Settings |
| **App** | Splash · Unlock (biometric + PIN with lockout) |

---

## Tech stack

- **Expo SDK 57** / React Native 0.86 / React 19 (development builds; Expo Go is blocked)
- **NativeWind v4** (Tailwind for React Native)
- **Expo modules**: a local native module (`modules/mojito-core`) for the crypto facade
- **Key crypto**: `@noble/hashes`, `@noble/curves`, `@scure/bip32`, `@scure/btc-signer` (pure JS, Hermes-safe, Uint8Array only)
- **react-native-svg** for icons, charts and the entropy canvas
- **TypeScript**, strict mode
- No navigation library: screen switching is plain state in `App.tsx`
- Screens read data through the provider layer (`src/data/providers`); the mode switch picks the fixture source or the real chain clients, never `src/data.ts` directly

### Layout

```
App.tsx                     root shell: tabs, overlays, onboarding/lock layering
src/theme.ts                design tokens; oklch→sRGB (feeds tailwind.config.ts too)
src/data.ts                 wallet fixtures (mock provider source)
src/config/endpoints.ts     per-network endpoint sets and feature flags

src/ui/                     shared component library · one file per component
  index.tsx                 barrel: re-exports only
  Btn.tsx  Card.tsx  ListRow.tsx  Sheet.tsx  TokenPicker.tsx  …
  icons.tsx                 line-icon set
  motion.tsx                animation primitives (one useLoop backs them all)
  style.ts                  gradColors · toneColor · hairlineTop · tile · tint
  chart.ts                  polyline maths shared by Sparkline and AreaChart

src/keys/                   the M1 key stack, pure TypeScript and vector-tested
  bip39.ts                  full BIP39: entropy, mnemonic, validation, seeding
  bip39Words.ts             the 2048-word list, SHA-256 pinned and asserted
  mlAccounts.ts             Mintlayer account derivation and bech32m addresses
  BtcKeyring.ts             BIP84 P2WPKH accounts on scure
  customPath.ts             generic m/… account-path parse for the discovery scan
  session.ts                KeySession: short-lived vault handle (M2 consumers, see decision log D17)

src/data/                   the M2 chain data layer, service by service
  ml/                       typed indexer client, BalanceService, NftService
  btc/                      Esplora-shaped BTC chain client (balances, txs, fees)
  addresses/                AddressManager: gap scan, persisted per-network indexes
  activity/                 unified ML and BTC activity rows, relative times
  real/                     real-mode WalletData over the services (home bundle)
  polling.ts                PollCycle: intervals, backoff, background pause, usePoll
  errors.ts                 typed error copy mapping for the screens

src/screens/                one screen per file
  HomeScreen.tsx  DexScreen.tsx  SwapScreen.tsx  BridgeScreen.tsx
  CardScreen.tsx  SendScreen.tsx  ReceiveScreen.tsx  SettingsScreen.tsx
  intro.tsx                 splash
  types.ts                  Nav / Sheet prop types

src/onboarding/
  index.tsx                 <Onboarding> + the screen map
  context.ts                Ctx, ScreenId
  UnlockScreen.tsx
  screens/                  one screen per file (Welcome, Secure, PinSet, …)
  ui/                       onboarding-only components, one file each
  data.ts                   one constant: the accepted phrase lengths

src/i18n/                   t() plus the en dictionary; a completeness test gates
  strings/en.ts             every user-visible string (no literals in screens)

src/data/providers/         provider interfaces, mock mode, real/mock mode switch
src/storage/                the persistence seam
  secureStore.ts            seal/open/wipe over the native crypto (test double in dev/node)
  blobStore.ts              persists sealed blobs across restarts (AsyncStorage)
  walletVault.ts            the sealed recovery phrase over the seed.v1 / seed.v2 slots
  pinStore.ts               PBKDF2 PIN verifier with persisted lockout (pin.meta.v1)
  appSettings.ts            plain security toggles (biometrics, auto-lock)
  addressStore.ts           persisted derivation indexes per network and chain

modules/mojito-core/        Expo native module: AES-256-GCM seal/open, secure
  index.ts                  random, auth-gated keys; bindings call-throughs pending
  android/  ios/            Kotlin (Keystore) and Swift (Keychain) sources

vendor/mintlayer/           vendored wallet-bindings v0.1.0 artifacts
  CHECKSUMS.txt             upstream SHA256SUMS provenance, verified in CI

scripts/api-smoke.mjs       read-only live endpoint smoke run (manually or nightly)
scripts/perf.mjs            static startup-path review with the timing budget status
scripts/size-report.mjs     static size inventory plus the measured-export budget grade
scripts/no-em-dash.ts       dash gate (no em or en dashes in code or specs;
                            vendored artifacts excluded: checksum-pinned)
scripts/no-console.ts       secret-logging gate (keys, storage, data, onboarding, module)
```

---

## Build and run

### Prerequisites

- Node 20+
- **iOS:** full Xcode (Command Line Tools alone cannot run a simulator)
- **Android:** Android SDK with an AVD or a physical device

### Install

```bash
npm install
```

### Run

This app **does not run in Expo Go**: the native crypto module requires a development build
(`App.tsx` blocks Expo Go at launch with an explanatory screen).

```bash
npm start            # Metro bundler (keep it running)
npm run android:dev  # build + launch on an Android emulator or device
npm run ios:dev      # build + launch on an iOS simulator
```

The first dev-client build takes a while; after that `npm start` plus a relaunch of the installed
app is enough. Changes to `modules/mojito-core` native sources require a rebuild.

### Release builds (M6)

```bash
npx eas build -p android --profile production-android   # local machine per D5
npx eas build -p ios --profile production-ios           # Mac mini or CI per D5
npx eas build -p android --profile preview              # real-mode internal APK
```

Identifiers are `org.mintlayer.mojito.me` (owner-confirmable before submission); version and
build numbers are CI-stamped (`appVersionSource: remote`, `autoIncrement`). No secrets live in
`eas.json`; the release profiles set `EXPO_PUBLIC_DATA_MODE=real`. Production profiles refuse to
start while the R4 waitlist backend is unconfigured (`LocalWaitlistShipBlockerError`): that is
the designed ship blocker, not a bug. The full gate picture lives in `docs/REVIEW-RUNBOOK.md`.

<details>
<summary><b>Android troubleshooting</b> · real issues hit during development</summary>

**SDK not on PATH.** If `adb` isn't found, export your SDK location. Homebrew installs land in a
non-default path:

```bash
export ANDROID_HOME=/opt/homebrew/share/android-commandlinetools   # or ~/Library/Android/sdk
export PATH="$ANDROID_HOME/platform-tools:$ANDROID_HOME/emulator:$PATH"
```

**Stale bundle after a native change.** Editing Kotlin/Swift sources needs a full dev-client
rebuild (`npm run android:dev` or `npm run ios:dev`); Metro reload alone keeps the old module.

**The seed screen captures black.** Intentional: `FLAG_SECURE` is applied while the recovery
phrase is on screen, and released on unmount.
</details>

---

## Storage and crypto (M1 state)

- `src/storage/secureStore.ts` exposes a `seal`/`open`/`wipe`/`keyExists`/`keyGated` facade over the native
  MojitoCore module (AES-256-GCM, key resident in Keychain or Keystore, never returned to JS). When the
  wallet's Secure-screen choice was biometrics, the key carries user-authentication gating (Keystore
  `setUserAuthenticationRequired` plus biometric-enrolment invalidation on Android,
  `kSecAccessControlBiometryCurrentSet` on iOS) and the OS biometric prompt runs inside the native
  module: Android wraps the Keystore cipher in a `BiometricPrompt.CryptoObject`, iOS relies on the
  Keychain ACL, so a generic prompt can never be mistaken for authorization. The TS facade maps the
  rejections to a typed `VaultAuthRequiredError` (cancelled or failed check, wallet stays locked) and
  `VaultKeyInvalidatedError` (terminal key state: a biometric change killed the key; the sealed phrase
  recovers only via phrase restore). `keyExists` is an attribute-level query and never prompts.
  PIN-only wallets are never created gated, so their vault operations never show a biometric prompt.
- `src/storage/blobStore.ts` persists the sealed ciphertext (AsyncStorage); `walletVault.ts` keeps
  the phrase across two fixed slots, `seed.v1` and `seed.v2`: exactly one is live, and the unlock-time
  gating upgrade re-seals into the other slot and deletes the old one only after the new blob reads
  back byte-equal (a failed upgrade leaves the old vault intact and retryable). `pinStore.ts` keeps
  the PIN verifier and lockout under `pin.meta.v1`, `appSettings.ts` keeps the plain security toggles.
- The memory store in `secureStore`/`blobStore` exists **only** for dev builds, Expo Go and Node
  tooling; it is a non-cryptographic test double, and a release build without the native core
  **throws** instead of falling back. Dev-only quirk: a wallet sealed under the memory double is
  undecryptable after a relaunch (the in-memory key is never persisted), so sign out and re-run
  onboarding instead of relying on dev persistence.
- The vendored bindings (`vendor/mintlayer`) are linked from both platform builds; their facade
  call-throughs reject until the first dev-build run on a build machine. CI re-hashes every
  vendored artifact against `CHECKSUMS.txt`.

---

## Tests and checks

```bash
npm run check        # everything CI should run
npm run lint         # eslint only
npx tsx src/theme.test.ts
```

`npm run check` runs forty-two things:

1. **`src/theme.test.ts`**: asserts the oklch→sRGB conversion against the known sRGB primaries.
   Every colour in the app flows through it, so it's the one piece of non-trivial logic with a
   runnable check. Plain `node:assert`, no framework.
2. **`src/i18n/strings.test.ts`**: i18n completeness. Every `t()` key referenced in source must
   exist in `en.ts`, no orphaned keys, and `{var}` interpolation must work.
3. **`src/money.test.ts`**: the atom and decimal string maths: conversions, rounding,
   grouping and the USD forms, all on exact digit strings.
4. **`src/data/polling.test.ts`**: poll intervals, failure backoff caps, pause/resume and
   the refresh scheduler seams with injected timers.
5. **`src/data/ml/indexerClient.test.ts`**: the typed Mintlayer indexer client: amount and
   response parsing, typed transport/http/parse errors, retry with Retry-After, order book
   pages and the fresh-address 404 mapping.
6. **`src/data/btc/btcChainService.test.ts`**: the Esplora-shaped BTC client: balances,
   UTXOs, transaction parsing, address stats and retries against scripted responses.
7. **`src/data/addresses/addressManager.test.ts`**: gap scan bounds, fresh-address
   monotonicity, persistence, the no-probe degradation and scan retry after a failure.
8. **`src/storage/addressStore.test.ts`**: persisted derivation indexes: corrupt JSON drops
   the state instead of wedging address calls, invalid entries drop on load.
9. **`src/data/activity/activityService.test.ts`**: portfolio aggregation, ML/BTC activity
   direction mapping, NFT identification and the 404 tolerances.
10. **`src/data/real/realWalletData.test.ts`**: the real-mode home bundle over a scripted
   fetch: BTC sums across derived addresses and tolerates the two-key Esplora balance body.
11. **`src/storage/secureStore.test.ts`**: memory SecureStore self-check (roundtrip, wrong key and
   tamper rejection, wipe). The native path is exercised on dev builds.
12. **`src/storage/walletVault.test.ts`**: seal, meta-only read, open and wipe of the phrase vault.
13. **`src/storage/pinStore.test.ts`**: PIN set/verify, attempt bookkeeping, escalating lockout
   with persistence, unset-vs-wrong, wipe.
14. **`src/storage/appSettings.test.ts`**: the plain security toggles roundtrip.
15. **`src/data/providers/providers.test.ts`**: provider mode switch and mock behaviour, plus
    the real-mode construction seams.
16. **`src/data/providers/broadcast.test.ts`**: the gap-3 broadcast provider: mock deterministic
    ids, 403-to-disabled and transport-to-network mappings, BTC POST tx shape, status reads.
17. **`src/data/providers/bridge.test.ts`**: the bridge_v2 api provider: quote and fee parsing
    per direction, the treasury deposit address, status mapping and the E2M and initiation
    typed gates, all over a scripted transport.
18. **`src/data/providers/WaitlistProvider.test.ts`**: the gap 4 waitlist contract over a
    scripted transport: the 201 join and the idempotent 200 duplicate, the
    invalid/unavailable mappings, transport failures and non-JSON bodies, the typed
    member-status refusal, factory selection and the R4 ship-blocker refusal in a
    release build.
19. **`src/trade/orderBookService.test.ts`**: the live depth aggregation: cursor-paginated
    pages, the num/denom price rational, the invalid-cursor page-1 restart and the honest
    null last-fill.
20. **`src/trade/orders.test.ts`**: order create/fill/conclude over the bindings double: the
    witness mix, order id extraction, nonce and height inputs, the fill guards (frozen,
    concluded, overbid, off-band price) and the lying-broadcast refusals.
21. **`src/trade/htlc.test.ts`**: the HTLC flows: lock output parameters, the build/broadcast
    split (nothing broadcasts until the prepared lock is confirmed), the claim witness with
    the secret, the refund timelock refusal, lying-broadcast refusals and the secret
    extraction round-trip.
22. **`src/trade/swapSession.test.ts`**: the swap session machine: transitions (including the
    offered -> locked broadcast step), persistence round-trip, corrupt-row dropping,
    legacy-column stripping and the no-preimage guarantee.
23. **`src/trade/priceGuards.test.ts`**: the slippage band, minimum fill floor, amount sanity
    and the swap timelock rule margin, with typed NaN results.
24. **`src/trade/bindingsParity.test.ts`**: the vendored-signature parity pin: every seam
    function (including the privateKey and secret carriers) line-pinned against the vendored
    Swift plus the checksum that fails on any vendor upgrade.
25. **`src/keys/bip39.test.ts`**: published BIP39 seed vectors, checksum/word/length rejection,
    NFKD normalization, wordlist integrity, supplied-entropy generation.
26. **`src/keys/mlAccounts.test.ts`**: the bindings parity vectors (both networks) for account
    blobs, receiving blobs and addresses, plus the custom-path scan.
27. **`src/keys/BtcKeyring.test.ts`**: BIP84 zpub and address vectors, branch separation, custom
    account paths.
28. **`src/send/validation.test.ts`**: send address validation (mtc1/tmt1/bc1/tb1, wrong-network
    detection, non-standard HRP rejection) and exact amount parsing against published vectors.
29. **`src/send/mlTxBuilder.test.ts`**: the ML planner and assembler: selection determinism, the
    implicit-fee invariant, token-remainder sizing on the real output list, signer loopback.
30. **`src/send/btcTxBuilder.test.ts`**: the BTC builder: plan-fee equals signed-fee on the BIP84
    vectors, multi-origin signing, confirmed-input policy, typed dust and insufficient funds.
31. **`src/send/TxTracker.test.ts`**: the pending-to-confirmed lifecycle with injected timers:
    poll cadence, attempt caps, terminal stop, flaky-read tolerance.
32. **`src/data/real/realSend.test.ts`**: the real send service over an in-memory manager:
    funding across every managed address with fresh branch 1 change, typed busy refusal,
    broadcast-answer verification, fee pinning, quote purity, post-broadcast warning, the
    origin walk over long change histories and the failed-send change release.
33. **`src/data/mock/mockSend.test.ts`**: the R3 demo send path: fixture fee tiers, the same
    address and amount validation rejections and deterministic demo-labelled ids.
34. **`src/data/mock/localWaitlist.test.ts`**: the sealed local waitlist store: the
    ciphertext carries no plaintext bytes, one slot per install with duplicate
    refusal, the idempotent rejoin, and leave wiping both the blob bytes and the
    key.
35. **`src/waitlist/waitlistForm.test.ts`**: the waitlist form machine: the validation
    matrix (length caps, forbidden characters, unicode normalization), the phase
    transitions, no double submits, the submit-time address freeze and retry
    scoping.

36. **`src/keys/session.test.ts`**: KeySession closure isolation, zeroize of the seed buffer,
    release semantics, xpub parity.
37. **`scripts/no-console.ts`**: no `console.*` in the native facade or the secret-handling
    modules (keys, send, storage, data, onboarding, trade, screens, waitlist).
38. **`scripts/no-em-dash.ts`**: no em or en dashes anywhere in code, specs or docs
    (`docs/` added to the scan roots in M6).
39. **`tsc --noEmit`**: strict TypeScript.
40. **`eslint .`**: `eslint-config-expo`, including the `react-hooks` rules.
41. **`scripts/perf.mjs`**: the static startup-path review (splash gate, lazy bindings
    require, synchronous provider construction, eager-import inventory) with the timing
    budget status; device numbers stay a `docs/MANUAL-QA.md` deliverable.
42. **`scripts/size-report.mjs`**: the static size inventory (app source, dependency
    trees, vendored artifacts) grading the JS-bundle budget only against a measured metro
    export, never an estimate.

**There is no UI/component test suite yet.** Adding one (React Native Testing Library +
`jest-expo`) is a welcome contribution: start with the onboarding flow, which holds the most
logic. Until then, changes touching navigation or gestures should be verified on a device or
simulator: a green `tsc` has repeatedly failed to catch runtime issues here (a modal that
swallowed every touch typechecked and bundled perfectly).

### Manual checks (device, gated-vault and waitlist paths)

The release QA list consolidating this whole section lives in `docs/MANUAL-QA.md`; the items
below stay for the day-to-day device loop.
The native auth gate cannot be exercised in Node; verify these by hand on a device build.
The waitlist matrix (18 to 24) runs in mock mode on a dev build: it needs no backend.

1. **Biometric choice gates the key.** Onboard with "Enable Face ID" (or fingerprint): the first
   seal at finish shows the OS biometric prompt from inside the module, and every unlock runs it.
   Onboard again with "Use PIN instead": no vault operation ever shows a biometric prompt.
2. **Declined prompt stays fail-closed.** Cancel the OS prompt at unlock: the wallet stays locked
   with no error loop; the next attempt re-runs the prompt.
3. **Biometric change recovery.** On a gated wallet, enrol a different biometric: seal and open now
   fail with the invalidated-key guidance, and the wallet recovers only via phrase restore (sign out,
   then import the phrase). This is deliberate: the phrase is the single recovery path.
4. **Legacy ungated upgrade.** A wallet created before the choice-based gate, with the persisted
   biometrics choice on, re-seals under a fresh gated key at the next unlock.
5. **Cold start never prompts.** Kill and relaunch the app: the existence probe must not show a
   biometric prompt behind the splash.
6. **Biometrics toggle on a biometrics-less device must not brick.** In Settings on a device with
   no biometrics enrolled: the biometrics row shows the unavailable copy with the switch disabled,
   enabling is impossible, and nothing persists `biometrics: true`. Lock and unlock with the PIN:
   the wallet keeps opening (no gated-key prompt can appear). A wallet that had the choice
   persisted before this guard opens too: the cold start downgrades the stored choice.
7. **Fingerprint devices see fingerprint copy.** Onboard on a fingerprint-only Android device or a
   Touch ID iPhone: the Secure and PIN screens show the fingerprint noun and glyph, never
   "Face ID".
8. **Declined native prompt returns to the lock with correct copy.** At unlock, cancel the OS
   prompt for the vault key: the label reads "Verifying" while the gate runs, then the screen is
   back at "Tap to unlock" (never stuck on an unlocked claim), and a retryable unlock failure
   shows the "Unlock failed" alert.
9. **Real QR scans to the correct address.** In real mode (`EXPO_PUBLIC_DATA_MODE=real`, mainnet,
   unlocked), open Receive on each chain segment and scan the code with a phone camera: it must
   decode to exactly the address string shown under the QR. Mock mode renders the same scannable
   library QR (both modes are scannable by design; the old decorative grid is gone).
10. **BTC portfolio sums across used addresses.** With BTC held on a previously used address (so
   the current receiving address is fresh), the home BTC row shows the combined confirmed plus
   unconfirmed balance of every derived address, not zero.
11. **Offline banner versus stale banner.** Cut connectivity on the home screen: the offline
    banner shows and pull-to-refresh cannot clear it while the network is down. Restore the
    network, wait for the next poll (or pull to refresh): the banner clears. With connectivity
    up but no successful sync for over three minutes, the stale banner shows instead.
12. **Lock screen shows no data prompts behind it.** With auto-lock on, background the app and
    return: the unlock layer appears with no biometric prompt and no network data prompt firing
    behind it, and portfolio or address requests only start after unlock.
13. **Second send spends the change.** In real mode on a funded wallet: after a first BTC send,
    the wallet still shows the change balance, and a second send succeeds spending it (including
    while the first send's change is still unconfirmed). The new change lands on a fresh address,
    verifiable on the explorer link or by rescanning the seed outside the app.
14. **Concurrent send refuses busy.** Start a send and, before it completes, start a second one
    on the same account: the second attempt is refused with the send-in-progress copy and leaves
    the balances and indexes untouched, and the first send completes cleanly.
15. **Unconfirmed incoming is not spendable.** While an incoming BTC transaction sits in the
    mempool, the balance counts it but a send drawing on it fails typed as insufficient funds;
    after it confirms, the same send succeeds. (Own unconfirmed change is the documented
    exception: it keeps back to back sends working.)
16. **Fee rise asks for re-review.** On the review screen, confirm while the live fee estimate
    has risen above the reviewed rate: the send refuses with the fee-changed copy and the flow
    asks for a fresh review. At or below the reviewed rate, the signed fee is exactly the
    reviewed fee.
17. **Long change history stays spendable, failures do not burn indexes.** With a simulated
    store state that puts the BTC change counter past the fixed derivation walk ceiling (send
    #500+), a send drawing on that change address still succeeds. A failed send (underfunded
    amount or refused broadcast) leaves the change counter untouched, so the next successful
    send allocates exactly one change index.
18. **Waitlist empty state.** On the card tab with no waitlist slot on the device: the form
    is empty, the submit button is disabled, and (dev build, gauge visible) the counter shows
    the fixture seed without this install's slot.
19. **Waitlist invalid input.** Type an invalid address (double @, an empty local part or
    domain, an over-254 address, control bytes or markup delimiters) and submit: the invalid
    callout shows, the provider is never called, and nothing is persisted.
20. **Waitlist success and counter.** Join with a valid mixed-case, padded address: the
    confirmation screen names the masked address (first local-part character, domain), Done
    returns to the card, and the gauge has incremented by exactly one.
21. **Waitlist duplicate.** Join again with a different address: the amber duplicate callout
    shows the masked on-file address and View confirmation opens the same masked
    confirmation. Rejoining the address already on file succeeds idempotently with no new
    position.
22. **Waitlist offline submit.** Go offline and submit a fresh address: the unavailable
    callout and retry button show. Back online, tap retry: the join completes with the
    address currently in the field, and the confirmation names that same address. Editing
    the draft while a live join is in flight never renames the confirmation (the submitted
    address is frozen).
23. **Waitlist leave and rejoin.** In Settings, Leave the waitlist: the row clears and the
    gauge drops back to the seed; the app relaunch keeps it cleared (the wipe persists).
    Join again afterwards: a fresh slot is allocated. A leave that fails (secure storage
    unavailable) surfaces the leave-failed alert and the row stays joined.
24. **Waitlist small-device keyboard.** On a 320-class screen with the keyboard open: the
    email field, callouts and submit button stay reachable, and the return key submits.

---

## Contributing

Contributions are welcome. This is a self-custody wallet, so the bar for anything touching keys,
seed material or transaction construction is high. By participating you agree to our
[Code of Conduct](CODE_OF_CONDUCT.md).

### Before you start

1. Open an issue before writing anything non-trivial, so two people don't build the same thing.
2. Browse `src/ui/` first: one file per component, so the list of what exists is the
   directory listing. The component you need may already be there.

### Workflow

1. Fork, branch from `main` (`feat/…`, `fix/…`, `docs/…`).
2. Make the change.
3. `npm run check` must pass.
4. Verify on a simulator or device if you touched UI, navigation or gestures.
5. Open a PR describing *what changed and why*, with screenshots for visual changes.

### House rules

- **Reuse before you write.** `src/ui/` is one file per component so you can see everything at a
  glance. Check it before adding one; if you need a variant, add a prop rather than a near-copy.
  New components go in their own file and get re-exported from `src/ui/index.tsx`.
- **No hardcoded colours or spacing.** Everything comes from `src/theme.ts` (`C`, `G`) or Tailwind
  tokens. `tailwind.config.ts` imports the same palette, so there is one source of truth.
- **Text goes through `<Txt>`.** React Native `Text` doesn't inherit colour; the wrapper applies
  the palette default.
- **User-visible strings go through `t()`.** No literals in screens, no concatenation for copy;
  see `src/i18n/`.
- **Mark deliberate shortcuts.** A `ponytail:` comment naming the ceiling and the upgrade path
  beats a silent simplification.
- **Don't let the UI claim something it doesn't do.** A button that says "Copied" must have
  copied. If a control isn't wired yet, leave it out or disable it visibly.
- **Accessibility isn't optional.** Icon-only controls need `accessibilityLabel`; inputs need a
  label. The shared primitives handle most of this: use them.

---

## Security

### Reporting

See [SECURITY.md](SECURITY.md) for the full policy.

Please report security issues **privately**: do not open a public issue. Email
[security@mintlayer.org](mailto:security@mintlayer.org) with a description, reproduction steps and
an assessment of impact. We'll acknowledge receipt and keep you updated.

Encrypt anything sensitive with our PGP key
([`security.asc`](https://www.mintlayer.org/assets/keys/security.asc), fingerprint
`8EE2 B7AC 3BA2 5D1B 3C5A  BD49 0ED0 DD9A A56E BDA4`). See [SECURITY.md](SECURITY.md) for the
import and verification steps.

### Bug bounty

**The Mintlayer bug bounty does not apply to this repository yet.**

Mojito ME is pre-production: the key stack is real and vector-tested, but the bindings
call-through, transaction sending and BTC device verification are still pending (see
[Project status](#️-project-status--m6-release-readiness)). Findings against mock chain data or the
not-yet-wired bindings facades are out of scope and not eligible for a reward.

The bounty becomes valid for this repository when it ships to production, at which point this
section will be updated with the scope and terms. Reports are still welcome in the meantime:
they're just not paid.

---

## License

MIT. See [LICENSE](LICENSE).
