# Mojito ME · Mobile Edition

The React Native client for **[Mojito](https://www.mintlayer.org/wallet)**, Mintlayer's non-custodial
wallet, *"your gateway to Bitcoin DeFi."*

Mojito is self-custodial by design: **your keys, your coins**. It holds BTC, ML, MLS-01 tokens and
NFTs, generates a fresh address per transaction for privacy, encrypts client-side before anything
leaves the device, and restores from a seed phrase alone. Mojito already ships as a browser
extension and on the App Store and Google Play; this repository is the *neo* generation of the
mobile app, rebuilt in React Native.

---

## ⚠️ Project status · pre-production (M0)

**This repository is the foundations milestone: UI plus the first real native layer. It is not a working wallet.**

There is no backend and no chain connectivity. Wallet balances, addresses, transactions and
accounts are fixtures from `src/data.ts` or `src/onboarding/data.ts`. Specifically, and deliberately:

- The recovery phrase is a **fixed demo constant**, not generated entropy.
- Checksum validation on import is a **stand-in**, not BIP39 (see `checksumOK()`).
- The BIP39 word list is **truncated** (a-cy) for the autocomplete demo.
- The "draw your own entropy" screen collects and meters real input but **does not derive a key**.
- Biometric prompts are **simulated**; no `LocalAuthentication` call is made.
- The native crypto module (`modules/mojito-core`) ships **real AES-256-GCM** over Keychain or
  Keystore, but nothing stores wallet secrets with it yet; the bindings call-throughs **reject**
  until M1. See the Storage section below.

Do not point this at real funds. Do not treat any screen here as a security control until the
corresponding logic is implemented and audited.

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
- **react-native-svg** for icons, charts and the entropy canvas
- **TypeScript**, strict mode
- No navigation library: screen switching is plain state in `App.tsx`
- Screens read fixture data through the provider layer (`src/data/providers`), never `src/data.ts` directly

### Layout

```
App.tsx                     root shell: tabs, overlays, onboarding/lock layering
src/theme.ts                design tokens; oklch→sRGB (feeds tailwind.config.ts too)
src/data.ts                 wallet fixtures
src/config/endpoints.ts     per-network endpoint sets and feature flags

src/ui/                     shared component library · one file per component
  index.tsx                 barrel: re-exports only
  Btn.tsx  Card.tsx  ListRow.tsx  Sheet.tsx  TokenPicker.tsx  …
  icons.tsx                 line-icon set
  motion.tsx                animation primitives (one useLoop backs them all)
  style.ts                  gradColors · toneColor · hairlineTop · tile · tint
  chart.ts                  polyline maths shared by Sparkline and AreaChart

src/screens/                one screen per file
  HomeScreen.tsx  DexScreen.tsx  SwapScreen.tsx  BridgeScreen.tsx
  CardScreen.tsx  SendScreen.tsx  ReceiveScreen.tsx  SettingsScreen.tsx
  intro.tsx                 splash
  types.ts                  Nav / Sheet prop types

src/onboarding/
  index.tsx                 <Onboarding> + the screen map
  context.ts                Ctx, ScreenId, lockout constants
  UnlockScreen.tsx
  screens/                  one screen per file (Welcome, Secure, PinSet, …)
  ui/                       onboarding-only components, one file each
  data.ts                   BIP39 list, demo phrase, discovery fixtures

src/i18n/                   t() plus the en dictionary; a completeness test gates
  strings/en.ts             every user-visible string (no literals in screens)

src/data/providers/         provider interfaces, mock implementations, mode switch
src/storage/                SecureStore facade over the native crypto (seal/open/wipe)

modules/mojito-core/        Expo native module: AES-256-GCM seal/open, secure
  index.ts                  random, key wipe; Mintlayer bindings arrive in M1
  android/  ios/            Kotlin (Keystore) and Swift (Keychain) sources

scripts/no-em-dash.ts       dash gate (no em or en dashes in code or specs)
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

## Storage and crypto (M0 state)

`src/storage/secureStore.ts` exposes a `seal`/`open`/`wipe`/`keyExists` facade over the native
MojitoCore module (AES-256-GCM, key resident in Keychain or Keystore, never returned to JS).
`getSecureStore()` reports which implementation it handed out (`kind: 'native' | 'memory'`).
A small in-memory store exists **only** for dev builds, Expo Go and Node tooling; it is a
non-cryptographic test double, and a release build without the native core **throws** instead of
falling back. Nothing persists to disk yet; persistence lands in M1.

---

## Tests and checks

```bash
npm run check        # everything CI should run
npm run lint         # eslint only
npx tsx src/theme.test.ts
```

`npm run check` runs seven things:

1. **`src/theme.test.ts`**: asserts the oklch→sRGB conversion against the known sRGB primaries.
   Every colour in the app flows through it, so it's the one piece of non-trivial logic with a
   runnable check. Plain `node:assert`, no framework.
2. **`src/i18n/strings.test.ts`**: i18n completeness. Every `t()` key referenced in source must
   exist in `en.ts`, no orphaned keys, and `{var}` interpolation must work.
3. **`src/storage/secureStore.test.ts`**: memory SecureStore self-check (roundtrip, wrong key and
   tamper rejection, wipe). The native path is exercised on dev builds.
4. **`src/data/providers/providers.test.ts`**: provider mode switch and mock behaviour.
5. **`tsc --noEmit`**: strict TypeScript.
6. **`eslint .`**: `eslint-config-expo`, including the `react-hooks` rules.
7. **`scripts/no-em-dash.ts`**: no em or en dashes anywhere in code, specs or docs.

**There is no UI/component test suite yet.** Adding one (React Native Testing Library +
`jest-expo`) is a welcome contribution: start with the onboarding flow, which holds the most
logic. Until then, changes touching navigation or gestures should be verified on a device or
simulator: a green `tsc` has repeatedly failed to catch runtime issues here (a modal that
swallowed every touch typechecked and bundled perfectly).

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

Mojito ME is pre-production. The native crypto module is real AES-256-GCM, but the wallet does not
use it for secret material yet, there is no chain connectivity, and the data layer is deliberately
mocked (see [Project status](#️-project-status--pre-production-m0)). Findings against mock data,
placeholder checksums or simulated biometrics are out of scope and not eligible for a reward.

The bounty becomes valid for this repository when it ships to production, at which point this
section will be updated with the scope and terms. Reports are still welcome in the meantime:
they're just not paid.

---

## License

MIT. See [LICENSE](LICENSE).
