# Mojito ME — Mobile Edition

The React Native client for **[Mojito](https://www.mintlayer.org/wallet)**, Mintlayer's non-custodial
wallet — *"your gateway to Bitcoin DeFi."*

Mojito is self-custodial by design: **your keys, your coins**. It holds BTC, ML, MLS-01 tokens and
NFTs, generates a fresh address per transaction for privacy, encrypts client-side before anything
leaves the device, and restores from a seed phrase alone. Mojito already ships as a browser
extension and on the App Store and Google Play; this repository is the *neo* generation of the
mobile app, rebuilt in React Native.

---

## ⚠️ Project status — pre-production

**This repository is a UI implementation. It is not a working wallet.**

There is no backend, no chain connectivity, and no key management. Every balance, address,
transaction and account in the app is a fixture from `src/data.ts` or `src/onboarding/data.ts`.
Specifically, and deliberately:

- The recovery phrase is a **fixed demo constant**, not generated entropy.
- Checksum validation on import is a **stand-in**, not BIP39 — see `checksumOK()`.
- The BIP39 word list is **truncated** (a–cy) for the autocomplete demo.
- The "draw your own entropy" screen collects and meters real input but **does not derive a key**.
- Biometric prompts are **simulated**; no `LocalAuthentication` call is made.

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

- **Expo SDK 57** / React Native 0.86 / React 19
- **NativeWind v4** (Tailwind for React Native)
- **react-native-svg** for icons, charts and the entropy canvas
- **TypeScript**, strict mode
- No navigation library — screen switching is plain state in `App.tsx`

### Layout

```
App.tsx                     root shell: tabs, overlays, onboarding/lock layering
src/theme.ts                design tokens; oklch→sRGB (feeds tailwind.config.ts too)
src/data.ts                 wallet fixtures

src/ui/                     shared component library — one file per component
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
```

---

## Build and run

### Prerequisites

- Node 20+
- **iOS:** full Xcode (Command Line Tools alone cannot run a simulator)
- **Android:** Android SDK with an AVD, or a physical device with Expo Go

### Install

```bash
npm install
```

### Run

```bash
npm start            # Metro + QR code — scan with Expo Go
npm run ios          # iOS simulator (requires full Xcode)
npm run android      # Android emulator
```

Physical device: install **Expo Go**, then scan the QR from `npm start`. Phone and machine must
share a network — add `--tunnel` if they don't.

<details>
<summary><b>Android troubleshooting</b> — real issues hit during development</summary>

**SDK not on PATH.** If `adb` isn't found, export your SDK location. Homebrew installs land in a
non-default path:

```bash
export ANDROID_HOME=/opt/homebrew/share/android-commandlinetools   # or ~/Library/Android/sdk
export PATH="$ANDROID_HOME/platform-tools:$ANDROID_HOME/emulator:$PATH"
```

**`npm run android` fails on newer emulator images.** Expo launches Expo Go via `monkey`, which
exits 251 on Android 15. Launch the deep link directly instead:

```bash
npx expo start
adb reverse tcp:8081 tcp:8081
adb shell am start -a android.intent.action.VIEW -d "exp://127.0.0.1:8081" host.exp.exponent
```

**Fast Refresh and new named imports.** Adding a new named import to a live module can throw
`Property 'X' doesn't exist` even though the code is correct. Force a full reload:

```bash
adb shell am force-stop host.exp.exponent
```

**The seed screen captures black.** Intentional — `FLAG_SECURE` is applied while the recovery
phrase is on screen, and released on unmount.
</details>

---

## Tests and checks

```bash
npm run check        # everything CI should run: unit test + types + lint
npm run lint         # eslint only
npx tsx src/theme.test.ts
```

`npm run check` runs three things:

1. **`src/theme.test.ts`**: asserts the oklch→sRGB conversion against the known sRGB primaries.
   Every colour in the app flows through it, so it's the one piece of non-trivial logic with a
   runnable check. Plain `node:assert`, no framework.
2. **`tsc --noEmit`** — strict TypeScript.
3. **`eslint .`** — `eslint-config-expo`, including the `react-hooks` rules.

**There is no UI/component test suite yet.** Adding one (React Native Testing Library +
`jest-expo`) is a welcome contribution — start with the onboarding flow, which holds the most
logic. Until then, changes touching navigation or gestures should be verified on a device or
simulator: a green `tsc` has repeatedly failed to catch runtime issues here — a modal that
swallowed every touch typechecked and bundled perfectly.

---

## Contributing

Contributions are welcome. This is a self-custody wallet, so the bar for anything touching keys,
seed material or transaction construction is high. By participating you agree to our
[Code of Conduct](CODE_OF_CONDUCT.md).

### Before you start

1. Open an issue before writing anything non-trivial, so two people don't build the same thing.
2. Browse `src/ui/` first — one file per component, so the list of what exists is the
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
- **Mark deliberate shortcuts.** A `ponytail:` comment naming the ceiling and the upgrade path
  beats a silent simplification.
- **Don't let the UI claim something it doesn't do.** A button that says "Copied" must have
  copied. If a control isn't wired yet, leave it out or disable it visibly.
- **Accessibility isn't optional.** Icon-only controls need `accessibilityLabel`; inputs need a
  label. The shared primitives handle most of this — use them.

---

## Security

### Reporting

See [SECURITY.md](SECURITY.md) for the full policy.

Please report security issues **privately** — do not open a public issue. Email
[security@mintlayer.org](mailto:security@mintlayer.org) with a description, reproduction steps and
an assessment of impact. We'll acknowledge receipt and keep you updated.

Encrypt anything sensitive with our PGP key —
[`security.asc`](https://www.mintlayer.org/assets/keys/security.asc), fingerprint
`8EE2 B7AC 3BA2 5D1B 3C5A  BD49 0ED0 DD9A A56E BDA4`. See [SECURITY.md](SECURITY.md) for the
import and verification steps.

### Bug bounty

**The Mintlayer bug bounty does not apply to this repository yet.**

Mojito ME is pre-production: a UI implementation with no key management, no chain connectivity and
deliberately mocked cryptography (see [Project status](#️-project-status--pre-production)).
Findings against mock data, placeholder checksums or simulated biometrics are out of scope and not
eligible for a reward.

The bounty becomes valid for this repository when it ships to production, at which point this
section will be updated with the scope and terms. Reports are still welcome in the meantime —
they're just not paid.

---

## License

MIT — see [LICENSE](LICENSE).
