# Manual QA (release matrix)

The M6 release QA list. It consolidates the accumulated per-milestone manual
matrix (the project notes manual-tests file) into the final pre-submission
run. Nothing here is optional at submission time except the items explicitly
marked blocked (they name their external dependency). Machine gates live in
`npm run check`; this file is the device half.

## 1. Builds and sizes to run

| Build | Profile | Mode | Use |
|---|---|---|---|
| Dev client | `development` (local or EAS) | mock unless `EXPO_PUBLIC_DATA_MODE=real` | functional matrix, vault and auth paths |
| Preview APK | `preview` | real | real-mode honesty matrix on mainnet |
| Production AAB / IPA | `production-android` / `production-ios` | real | store-metadata, installed-size and release-security pass. NOTE: the production profiles refuse to start while the R4 waitlist backend is unconfigured (`LocalWaitlistShipBlockerError`). That is the designed ship blocker: run the release-security pass on the preview APK until the backend lands, then re-run items 40 to 45 on the production builds |

Device sizes (decision D8): 375x667, 360x740 (perf baseline), 390x844,
412x915, 430x932. Full matrix on 360x740 and 390x844; every screen's layout
items on all five; the remaining sizes walk the full list once.

## 2. Performance measurement protocol (360x740 baseline)

Record device model and OS version next to every number; emulator numbers
are labeled as such and never substitutes. Budgets are release blockers
unless waived in `docs/REVIEW-RUNBOOK.md` section 5.

1. Cold start to interactive Home: launch from a killed process, stop the
   clock at the first interactive Home frame. Budget under 2500 ms.
2. Tab switch: Wallet to DEX to Swap to Bridge to Card and back, worst tab.
   Budget under 250 ms.
3. Send sheet open: tap Send from Home, stop at the rendered details step.
   Budget under 400 ms.
4. QR render: open Receive, stop at the drawn QR. Budget under 300 ms.
5. Scan-ready camera: the scan entry (when the ScanSheet milestone lands).
   Budget under 1200 ms.

## 3. Installed-size protocol

1. JS bundle: `npx expo export --platform android`, read the hbc size with
   `node scripts/size-report.mjs` (grade against the 4 MB budget; the M6
   measured 4.40 MiB is waived in the runbook).
2. Installed sizes: install the production artifacts, read the reported
   app size from OS storage settings (iOS) and `adb shell pm dump` or
   settings (Android). Budgets: 90 MB iOS, 60 MB Android, bindings
   artifacts included. Record the numbers in `docs/REVIEW-RUNBOOK.md` 5.

## 4. Per-screen release checklist

Items carry the milestone that shipped them. "release" means: repeat on a
release-mode build (preview APK or production where it can start).

### Onboarding and unlock (M1)

1. Create flow end to end: 24-word generation (12-word switch works), the
   verify quiz rejects a wrong chip, PIN set/confirm persists, discovery
   shows five real tmt1 addresses and lands on none.
2. Import flow: abandon x23 + art passes the real checksum, clipboard is
   cleared after paste, discovery shows the tmt1qyxqfq37rra32sq6zhayqcpjwh4trc07mcfardwt
   parity address as funded (fixture probe).
3. Import rejection: swapped word shows the checksum error, a foreign word
   names the word, a 6-word paste names the allowed counts.
4. Discovery custom path: m/84'/0'/3' (or m/44'/1'/2') actually derives that
   account; an unsupported path shows the path-invalid error, never a silent
   rescan of the defaults.
5. Lock and unlock with PIN: 5 wrong PINs arms the escalating countdown,
   input frozen, countdown resumes after relaunch mid-lock, correct PIN
   clears the attempt counter.
6. Biometric unlock: prompt fires on lock when enrolled and enabled,
   biometry-only (no device-credential escape), in-app PIN always unlocks,
   no-biometrics device goes straight to PIN, fingerprint devices see
   fingerprint copy.
7. Change PIN from settings: current PIN verified first (wrong ones feed the
   lockout), new PIN unlocks at the next lock.
8. Seed at rest: kill and relaunch keeps the wallet behind the lock screen;
   sign-out wipes the vault, the PIN verifier and the session, returning to
   onboarding.
9. Capture guard: seed, verify and import screens block screenshots on
   Android and warn on iOS.
10. Auto-lock: background and return, the lock screen is up (default on);
    toggle off and the session stays; relaunch respects the persisted
    toggle and the persisted Face ID choice.
11. Step-up auth on phrase reveal: Settings > Recovery phrase and the Home
    deferred-backup banner both re-lock; the words are never reachable from
    an unlocked session without PIN or biometric.
12. Vault gate on device: decrypt paths run the OS biometric prompt or the
    step-up prompt on refusal (`VaultAuthRequiredError`); enrolling a new
    biometric invalidates the key and surfaces the re-auth guidance.
13. Enable/disable biometrics re-seal and killed-mid-upgrade relaunch (the
    three M1 upgrade items in the accumulated matrix).
14. Release-build settings persistence smoke: enrol biometrics, kill,
    relaunch, the lock screen still leads with biometrics, no surprise
    re-seal prompt, Settings still shows Face ID on.

### Home (M2)

15. Live mainnet portfolio (real mode): totals and asset rows match the
    explorer for two spot-checked derived addresses; USD figures carry the
    demo chip (mock price provider per R1).
16. Demo chip per mode: mock shows "Demo data", real shows "Demo prices";
    never absent in either (prices are fixture-backed in both per R1).
17. Pull-to-refresh: spinner stops when data lands, the last-update banner
    clears, the chain tip moves without a restart.
18. Offline vs stale banners: airplane mode shows offline and pull cannot
    clear it while down; restored network clears it on the next poll; three
    minutes without a successful sync shows stale.
19. Polling on network loss: the balance error card, reconnect recovery, one
    immediate refresh on foreground (no duplicate bursts).
20. Fresh-address rotation on Receive; the address stays stable across
    reopen and rotates after on-chain use.
21. BTC portfolio sums across used addresses (no zero row on a used-history
    wallet).
22. NFT tab: empty state with no holdings; name, collection, shortened owner
    with a holding; metadata-unavailable copy instead of a blank row.
23. Lock screen shows no data prompts behind it; requests start only after
    unlock.

### Receive and QR (M2/M3)

24. Receive chains: exactly Mintlayer and Bitcoin in the picker with i18n
    labels, each with its own real address; copy and share write the visible
    address.
25. QR honesty: both modes render the scannable library QR decoding to
    exactly the string under it (phone camera on each chain segment); the
    decorative grid is gone.

### Send (M3)

26. Mock send demo end to end with demo-labelled fake id and pending status;
    the Home activity list refreshes via the tx tracker.
27. Address validation UX: wrong-chain, wrong-network, malformed; error
    clears as soon as the address is fixed.
28. Amount validation UX: parse message, too-many-decimals, MAX fills the
    full balance, over-balance fails the quote.
29. Percent buttons render clean amounts for every asset and percent (no
    float tails, no NaN, no negatives) on Send, Swap and Bridge.
30. ML real-mode honesty: send tile enabled, Review states broadcasting is
    not enabled for the network (R3), confirm ends with the device-pending
    signing message or the disabled-broadcast message, never fabricated
    success. (release)
31. BTC send real end to end against a configured btc-api base: live
    sat/vB tiers, real txid with explorer link, confirmed flip; flagged
    fallback callout when fee-estimates is unreachable.
32. Fresh-address rotation after a send; second send spends the change
    (including unconfirmed change policy); concurrent send refusal;
    unconfirmed incoming is not spendable; fee divergence re-review; long
    change history stays spendable and failures do not burn indexes.
33. Error and retry flows: broadcast failure keeps review with retry,
    timeout copy shows, no raw server text ever.

### DEX, orders, swap, bridge (M4)

34. Live order book (real mode): aggregated depth rows, bars per level,
    30s refresh, airplane-mode error copy instead of fixtures; stale banner
    at 90s with tap-to-refetch; cursor-page recovery never mixes row
    generations.
35. Place-order confirm sheet (mock): exact amounts, demo-order note with
    fake id, My orders strip, demo chip honesty holds.
36. Place-order honesty (real): device-pending or disabled-broadcast copy,
    never a fabricated order; over-drift price refused with the slippage
    copy before anything is built.
37. My orders fill and conclude: phase chips, foreign conclude refused as
    not-mine, frozen orders refuse fills client-side.
38. Swap session flow (mock): four protocol steps advance off the persisted
    session, keep-open warning while in flight; refund path after expiry
    with honest banners; real mode ends device-pending, the preimage never
    persists or logs.
39. Bridge: exactly Mintlayer and Ethereum in pickers; quote rows from the
    configured fees route in real mode and fixtures with the mock banner in
    dev; E2M carries the R5 unavailable copy and stays disabled; M2E CTA
    ends with the unsupported copy (intent encoder and ML submission route
    pending), never a fabricated handle; indicative-price caption in real
    mode. Known carried limitation (do not re-flag, it is in the README
    pending list): the DEX Trades/Depth segment does not switch panels yet.

### Card waitlist (M5)

40. Join end to end: empty form with the seeded counter (dev build while
    unconfigured), valid email lands the confirmation with the position line
    or the graceful no-position copy, counter shows seed plus one, join
    survives kill and relaunch, rejoin is idempotent.
41. Invalid entry: malformed emails show the specific error, the provider is
    never called, the callout clears on edit.
42. Duplicate flow: a different address shows the duplicate callout with the
    masked stored address; view-confirmation opens the confirmation screen;
    the stored address is untouched.
43. Unavailable and retry: with a backend configured and airplane mode on,
    submit parks in unavailable with the email kept and a working retry;
    with the v1 local provider the join always succeeds offline.
44. Settings leave-then-rejoin: joined row with the masked email, Leave
    confirms then wipes, rejoining works after the wipe.
45. Small devices: form, callouts and confirmation usable at 375x667 and
    360x740 with the keyboard up (field visible or scrollable, submit
    reachable, nothing truncated). Email hygiene: never logged, only sealed
    at rest, no analytics anywhere.

### Settings and i18n (M2/M5/M6)

46. Network switch (dev build): warn, confirm rebuilds providers, sub-label
    flips, mainnet restores live data; testnet shows the honest not-connected
    banner while A2 is pending.
47. Release-build network row: the switch is gone and the unavailable status
    row shows instead (M6 gate). (release)
48. i18n extraction walk: every screen at 360 and 430 width, no truncated or
    overlapping copy (CardScreen error callout, Send fee row with BTC).
49. A11y spot check with a screen reader: icon-only controls announce their
    purpose (Home eye, Swap flip, Bridge swap sides, Unlock bio switch,
    BioCircle, Verify clear word).
50. api smoke: `node scripts/api-smoke.mjs` passes against the mainnet base
    and fails loudly against a dead base.

## 5. Release security block (production build)

Run on the build that ships (preview APK until the R4 backend lands, then
the production profiles).

1. Sealed seed at rest verified on the release build, not only dev.
2. PIN lockout survives process death on the release build.
3. No secrets or API keys in the bundle: grep the export and artifact
   output for key material patterns; EXPO_PUBLIC vars limited to the mode
   flag; no secrets in eas.json.
4. No debug flags: `developmentClient` only on the development profile.
5. Screen-capture prevention active on seed and import screens.
6. Biometric prompt not bypassable by backgrounding during a gated flow.
7. Lockfile audit: critical and high findings resolved or waived in writing.
8. Bindings artifact checksums re-verified against
   `vendor/mintlayer/CHECKSUMS.txt` (CI re-hashes).
9. Privacy strings: camera usage rides the scanning milestone (deferred,
   project decision log D15); Face ID usage present; no tracking, no analytics,
   no third-party SDK data collection.

## 6. Testnet E2E and faucet flow (blocked: A2)

The Mintlayer-operated testnet indexer URL is still open (action item A2,
decision R6), so the M3 testnet E2E demo stays blocked; nothing points at a
guessed URL. When the URL lands, configure it in
`src/config/endpoints.ts` (TESTNET indexerBase) and run:

1. `npx tsx scripts/e2e-testnet.mjs` with no config exits with the
   A2-blocked message (exit 2); the honesty check, not a failure.
2. Faucet: fund the public test vector wallet (abandon x23 + art) at
   https://faucet.mintlayer.org, then re-run the harness with the testnet
   base exported.
3. BTC leg: set `MOJITO_BTC_BASE` to a btc-api testnet deployment; the
   harness runs derive, plan, sign, broadcast and track end to end.
4. Record the run against the final build in `docs/REVIEW-RUNBOOK.md` 7.
