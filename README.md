# Mojito ME · Mobile Edition

The React Native client for **[Mojito](https://www.mintlayer.org/wallet)**, Mintlayer's non-custodial
wallet, *"your gateway to Bitcoin DeFi."*

Mojito is self-custodial by design: **your keys, your coins**. It holds BTC, ML, MLS-01 tokens and
NFTs, generates a fresh address per transaction for privacy, encrypts client-side before anything
leaves the device, and restores from a seed phrase alone. Mojito already ships as a browser
extension and on the App Store and Google Play; this repository is the *neo* generation of the
mobile app, rebuilt in React Native.

---

## ⚠️ Project status · M1 (keys)

**This repository is the keys milestone: real key management under the M0 UI. It is not yet a working wallet.**

Real since M1, with vector-backed tests:

- **Recovery phrase**: full BIP39 over the complete 2048-word English list. Generation from device secure random (optionally mixed with the drawn-entropy screen, which genuinely feeds the phrase), import validation with checksum, PBKDF2-HMAC-SHA512 seeding.
- **Vault**: the phrase is sealed with AES-256-GCM under a Keychain (iOS) or Keystore (Android) resident key before onboarding completes; the wallet survives kill and relaunch. The key is **user-authentication gated only when you chose biometrics on the Secure screen** (the persisted choice, never hardware detection): every seal and open then runs the OS biometric prompt inside the native module, and enrolling a new biometric invalidates the key. Enabling biometrics later re-seals the vault under a gated key at the next unlock.
- **PIN and lock**: persisted PBKDF2 verifier with an escalating lockout that survives restart; real `LocalAuthentication` biometric prompts (biometry-only for the wallet lock, in-app PIN always works); auto-lock on background; the recovery-phrase reveal sits behind a re-auth step-up.
- **Derivation**: Mintlayer account 0 (`m/44'/<coin type>'/0'`) and BTC BIP84 account (`m/84'/<coin>'/0'`) in pure TypeScript, byte-pinned to the bindings' published parity vectors and the BIP84 test vectors. Discovery derives real addresses (balance probing is still a fixture seam).

Still deferred, deliberately:

- The **vendored bindings call-through** (transaction assembly, signing, native encoders) still rejects; the artifacts are vendored and linked, the facades are real code that compiles on EAS, and the TS key paths above do not depend on the call-through. See the Storage section and `vendor/mintlayer/`.
- Chain connectivity, balances, history, prices: fixtures from `src/data.ts` behind the provider layer. Sending lands in M3.

Do not point this at real funds. Do not treat any screen here as a security control until the corresponding logic is implemented and audited.

---

## What's implemented

| Area | Screens |
|---|---|
| **Onboarding** | Welcome · Secure (biometric) · PIN set/confirm · Seed reveal · Verify backup · Import phrase · Account discovery · Draw-your-own-entropy |
| **Wallet** | Home (portfolio, balance chart, activity) · DEX (order book + ticket) |
| **Trade** | Atomic Swap (HTLC) · Bridge (Mintlayer ⇄ EVM) · Mojito Card waitlist |
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
- Screens read fixture data through the provider layer (`src/data/providers`), never `src/data.ts` directly

### Layout

```
App.tsx                     root shell: tabs, overlays, onboarding/lock layering
src/theme.ts                design tokens; oklch→sRGB (feeds tailwind.config.ts too)
src/data.ts                 wallet fixtures (providers mock from here; M1 slimmed it)
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
  session.ts                KeySession: short-lived vault handle (M2 consumers, see plans/)

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

src/data/providers/         provider interfaces, mock implementations, mode switch
src/storage/                the persistence seam
  secureStore.ts            seal/open/wipe over the native crypto (test double in dev/node)
  blobStore.ts              persists sealed blobs across restarts (AsyncStorage)
  walletVault.ts            the sealed recovery phrase over the seed.v1 / seed.v2 slots
  pinStore.ts               PBKDF2 PIN verifier with persisted lockout (pin.meta.v1)
  appSettings.ts            plain security toggles (biometrics, auto-lock)

modules/mojito-core/        Expo native module: AES-256-GCM seal/open, secure
  index.ts                  random, auth-gated keys; bindings call-throughs pending
  android/  ios/            Kotlin (Keystore) and Swift (Keychain) sources

vendor/mintlayer/           vendored wallet-bindings v0.1.0 artifacts
  CHECKSUMS.txt             upstream SHA256SUMS provenance, verified in CI

scripts/no-em-dash.ts       dash gate (no em or en dashes in code or specs;
                            vendored artifacts excluded: checksum-pinned)
scripts/no-console.ts       secret-logging gate (keys, storage, onboarding, module)
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

`npm run check` runs fourteen things:

1. **`src/theme.test.ts`**: asserts the oklch→sRGB conversion against the known sRGB primaries.
   Every colour in the app flows through it, so it's the one piece of non-trivial logic with a
   runnable check. Plain `node:assert`, no framework.
2. **`src/i18n/strings.test.ts`**: i18n completeness. Every `t()` key referenced in source must
   exist in `en.ts`, no orphaned keys, and `{var}` interpolation must work.
3. **`src/storage/secureStore.test.ts`**: memory SecureStore self-check (roundtrip, wrong key and
   tamper rejection, wipe). The native path is exercised on dev builds.
4. **`src/storage/walletVault.test.ts`**: seal, meta-only read, open and wipe of the phrase vault.
5. **`src/storage/pinStore.test.ts`**: PIN set/verify, attempt bookkeeping, escalating lockout
   with persistence, unset-vs-wrong, wipe.
6. **`src/data/providers/providers.test.ts`**: provider mode switch and mock behaviour.
7. **`src/keys/bip39.test.ts`**: published BIP39 seed vectors, checksum/word/length rejection,
   NFKD normalization, wordlist integrity, supplied-entropy generation.
8. **`src/keys/mlAccounts.test.ts`**: the bindings parity vectors (both networks) for account
   blobs, receiving blobs and addresses, plus the custom-path scan.
9. **`src/keys/BtcKeyring.test.ts`**: BIP84 zpub and address vectors, branch separation, custom
   account paths.
10. **`src/keys/session.test.ts`**: KeySession closure isolation, zeroize of the seed buffer,
    release semantics, xpub parity.
11. **`scripts/no-console.ts`**: no `console.*` in the native facade or the secret-handling
    modules (keys, storage, onboarding).
12. **`scripts/no-em-dash.ts`**: no em or en dashes anywhere in code, specs or docs.
13. **`tsc --noEmit`**: strict TypeScript.
14. **`eslint .`**: `eslint-config-expo`, including the `react-hooks` rules.

**There is no UI/component test suite yet.** Adding one (React Native Testing Library +
`jest-expo`) is a welcome contribution: start with the onboarding flow, which holds the most
logic. Until then, changes touching navigation or gestures should be verified on a device or
simulator: a green `tsc` has repeatedly failed to catch runtime issues here (a modal that
swallowed every touch typechecked and bundled perfectly).

### Manual checks (device, gated-vault paths)

The native auth gate cannot be exercised in Node; verify these by hand on a device build:

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
call-through, chain connectivity and transaction sending are still pending (see
[Project status](#️-project-status--m1-keys)). Findings against mock chain data or the not-yet-
wired bindings facades are out of scope and not eligible for a reward.

The bounty becomes valid for this repository when it ships to production, at which point this
section will be updated with the scope and terms. Reports are still welcome in the meantime:
they're just not paid.

---

## License

MIT. See [LICENSE](LICENSE).
