# Release review runbook (M6)

The M6 gate document: how this repository is reviewed, what the release gates
found, and the acceptance decision for store readiness. Companion documents:
`docs/MANUAL-QA.md` (the device matrix that must still run) and the pending
list in `README.md`. Decisions cited as D and R live in
`plans/mojito-neo/decisions.md`; gaps in `missing-architecture.md` (plans
dir of the project notes); milestone specs in `specs/` of the plans dir.

## 1. Review model

Two nested cycles (decision D10):

| Cycle | Reviewers | Scope | Gate |
|---|---|---|---|
| Per commit | OCR pass plus security pass | every commit, max depth 5 | 0 critical, 0 medium |
| Milestone gate | UI/UX, i18n, mobile, DRY | whole milestone diff | findings closed or explicitly waived |

The M6 pass re-runs the milestone checklist across the finished app as an
integration-drift check, plus the release-specific audits in sections 3 to 5.

### Reviewer matrix

| Reviewer | Owns | Release input |
|---|---|---|
| OCR | per-commit correctness read | commit history M0 to M5 re-skimmed for drift |
| Security | secrets, storage, auth surfaces | release security block (section 5) |
| UI/UX | layout, honesty of states, affordances | ux-deferred reconciliation (section 4.2) |
| i18n | completeness test, hardcoded-string grep, English read-through | section 3 deviations |
| Mobile | five-size matrix, safe areas, notch and dynamic island | `docs/MANUAL-QA.md` |
| DRY | provider interfaces, facade duplication, fixture leftovers | provider seam audit (section 4.1) |

### Escalation rules

1. A release blocker found at any gate stops the train: fix or waive in
   writing in this file before any store submission step.
2. Decisions (product, identifiers, endpoints) belong to the owner; the
   runbook records open ones in section 6 and the build waits.
3. A missed perf or size budget is a blocker unless waived in writing here
   (section 5 records the one waiver).
4. Bindings upgrades after M6 re-run `scripts/parity` coverage and re-hash
   `vendor/mintlayer/CHECKSUMS.txt`: treat as a release event, not a bump.

## 2. Milestone gate results (recorded)

Per-milestone gates ran on their branches during M0 to M5 (commit history,
155 commits from `feat/baseline-ts` to `feat/m5-card`, one line each). The
M6 integration pass confirms the cross-milestone invariants below; each
invariant is machine-checked or referenced to its evidence.

| Invariant | Evidence | Status |
|---|---|---|
| npm run check green on the release branch | gate script, 36 tests plus tsc, eslint, perf, size | pass |
| i18n completeness (every key referenced, no orphans) | `src/i18n/strings.test.ts` | pass |
| Vendored bindings signatures pinned | `src/trade/bindingsParity.test.ts` | pass |
| No console in secret paths | `scripts/no-console.ts` | pass |
| No em or en dashes | `scripts/no-em-dash.ts` (docs/ added to the scan roots in M6) | pass |
| Provider seam single registration point | `src/data/providers/index.ts` (screens never construct providers) | pass |
| Storage release policy one spelling | `src/config/runtime.ts` (`devFallbackAllowed`) | pass |

## 3. Release honesty audit (production build behavior)

Every pending-config gate must render its honest state in a production
build. Production means an EAS release profile: `__DEV__ false`, so
`devFallbackAllowed()` (`src/config/runtime.ts`) returns false and dev
memory fallbacks refuse.

| Surface | Config state | Production behavior | Evidence |
|---|---|---|---|
| ML broadcast (R3, A1 open) | `broadcastBase: null` (endpoints.ts:38), `FLAGS.realBroadcastEnabled: false` (endpoints.ts:83) | real-mode send reviews and signs, then refuses with the broadcast-disabled copy; never a fabricated success. Trade surfaces refuse typed (order placement, swap lock) | `src/i18n/strings/en.ts:129` (`send.error.broadcast.disabled`), `:202` (`dex.order.broadcastOff`), `:254` (`swap.broadcastOff`) |
| Testnet (A2 open, R6) | every TESTNET read endpoint null (endpoints.ts:51 to 56) | the network switch is dev-only: release builds render the unavailable status row instead of the toggle; dev builds keep the switch with the pending-base warning; testnet data surfaces show the honest not-connected banner | `src/screens/SettingsScreen.tsx:249` (dev gate, added M6), `src/i18n/strings/en.ts:388` (`errors.indexer.testnet`), HomeScreen testnet banner branch |
| BTC backend (F13, unconfigured) | `btcBase: null` (endpoints.ts:39) | no BTC chain client is constructed; chains lists drop Bitcoin instead of promising a dead chain; BTC send fee fallback flags itself when a configured base is unreachable | `src/data/real/account.ts:53`, `src/data/real/realWalletData.ts:204,216` |
| Card waitlist (R4 ship blocker) | `waitlistBase: null` (endpoints.ts:41), `FLAGS.localWaitlistOnly: true` (endpoints.ts:87) | release construction of the provider REFUSES with `LocalWaitlistShipBlockerError`; the taken-counter gauge release-hides while local-only. Consequence: a production build cannot start until a real waitlist backend is configured. This is the deliberate R4 gate | `src/data/providers/WaitlistProvider.ts:38-55`, `src/data/providers/WaitlistProvider.test.ts:89`, `src/screens/CardScreen.tsx:97` |
| Prices (R1, direction chosen, implementation pending) | `priceBase: null` (endpoints.ts:40) | fixture price provider in both modes, `pricesAreMock: true`; the home chip discloses the mode: "Demo data" in mock, "Demo prices" in real | `src/data/providers/index.ts:40-43`, `App.tsx` chip (`home.demoData` / `home.demoPrices`) |
| Bridge (R5, E2M signer open) | `bridgeBase` configured (api.bridge.mintlayer.org/api/v1) | quotes and status ride the bridge api; E2M direction disabled with the signer-decision copy; M2E initiation honestly gated until the deposit intent encoder and the ML submission route exist | `src/i18n/strings/en.ts:284` (`bridge.route.e2m.unavailable`) |
| Bindings call-through (pending device verification) | artifacts vendored and linked | facades compile and reject typed until a dev build on a machine verifies the native call-through; TS key paths do not depend on it | README pending list, `src/trade/bindingsParity.test.ts` |
| Demo path (R3) | mock mode only | demo-labelled fake ids stay inside mock mode; the chip, send success and order copy disclose demo status | `src/i18n/strings/en.ts:114,207` |

Machine-verifiable gates (`grep` over `src/config/endpoints.ts`):
`realBroadcastEnabled: false`, `localWaitlistOnly: true`,
`defaultDataMode: 'mock'`, and the null fields listed above. The gate values
are constants in one file; flipping any of them is a reviewed config change,
not a code change.

## 4. Drift checks

### 4.1 DRY and provider seams

One registration point (`createProviders`), one selection factory per gap
provider, the runtime policy single-spelled in `src/config/runtime.ts`. The
M4-to-M5 reconciliation ledger (in-repo `plans/mojito-neo/decisions.md`)
remains the record for consumed, trimmed and deferred chain-client methods.

### 4.2 ux-deferred reconciliation

The M1-gate deferred list (plans ux-deferred) closes as follows; each item
is either resolved by a later milestone or carried explicitly.

| Item | Outcome |
|---|---|
| Swap 1/2 and Max vs balance | resolved in the M2 cycle-4 fix pass (provider balance semantics) |
| Send address book link | resolved by removal (recipient chips plus paste; contact list is mock-mode only) |
| Send scan and QR icons | carried as the honest alert (`send.scan.unavailable`); camera scanning ships with its milestone (in-repo decision D15); MANUAL-QA item |
| Receive request-specific-amount row | resolved by removal (lands with the payment-request flow; comment at the site) |
| Home profile chevron | resolved: static label now, lock and settings buttons wired |
| Home bell with unread badge | resolved by removal (no notification feature exists) |
| Home Tokens/NFTs/DeFi segment | resolved: wired in M2 (NFT and DeFi branches render) |
| Home "See all" | resolved by removal |
| Settings "Edit" | resolved by removal (comment at the site) |
| Settings "Connected dApps" | resolved by removal |
| Settings "Manage networks" | resolved: rendered as a status row, not a button |
| Bridge chain tiles | resolved: informational cards (no tap affordance), honest two-chain set |
| DEX Trades/Depth segment | CARRIED (known limitation): the segment sets state that no panel consumes. Recorded in the README pending list and MANUAL-QA; the house rule (wire, disable or remove) applies at the fix pass that owns the trades panel |
| ICU plural migration | resolved by removal: the `{plural}` substitution keys no longer exist in the dictionary (English-only D7; the trap is gone with the reworded copy) |
| Waitlist join-failure path | resolved (recorded fix; invalid and duplicate callouts ship in M5) |
| Native vault-prompt locale plumb (repo plans/ux-deferred.md) | carried: native BiometricPrompt strings stay English; no locale channel exists; release note item |
| NFT thumbnails (repo plans/ux-deferred.md) | carried: text-only rows; no image dependency in the set; release note item |
| Receive QR below 360 dp | carried (no supported target below 360; scale rule recorded at the site) |
| Waitlist duplicate copy local-store semantics | carried with R4: accurate for v1; revisit with the backend milestone |

## 5. Performance and size pass

Static scope in this environment (no device runs, no native builds);
`scripts/perf.mjs` and `scripts/size-report.mjs` are in the `npm run check`
gate and grade what they can grade honestly.

### Timing budgets (spec M6)

Not measured here: they need the 360x740 device baseline. The measurement
protocol is in `docs/MANUAL-QA.md` section 2; the numbers are a MANUAL-QA
deliverable and a store-submission precondition. Deviation recorded: the
spec's timing harness scope is delivered as the static startup-path review
(eager-import inventory, splash gate, lazy bindings require, synchronous
provider construction) plus the documented protocol.

### Size budgets

| Budget | Measured | Verdict |
|---|---|---|
| JS bundle under 4 MB | 4,608,641 bytes (4.40 MiB Hermes bytecode, 1488 modules, zero image assets; `npx expo export --platform android`) | MISS, waived below |
| Installed app under 90 MB iOS | not measured (needs a native build); static contributions: bindings device slice 49.69 MB + bundle 4.40 MB + framework and asset overhead, estimate well under budget | pending device-pass record |
| Installed app under 60 MB Android | not measured; AAR 7.94 MB all ABIs (app bundle splits per ABI) + bundle 4.40 MB, estimate well under budget | pending device-pass record |

**Written waiver (JS bundle):** the measured 4.40 MiB misses the 4 MB
budget by roughly 10 percent. The budget predates any measurement; the app
ships the complete BIP39 wordlist, the scure and noble crypto stack, five
full surfaces and the trade encoders. Trimming before release without
device verification trades a bounded byte miss for unbounded regression
risk. Waived for this release with the trim plan in order: (1) lazy-mount
the trade surfaces (Bridge, Swap, DEX behind their tab), (2) prune unused
icon paths, (3) re-grade. Owner sign-off of this waiver is part of the
submission checklist (section 7). The gate fails on any future measured
breach unless this waiver is renewed.

## 6. Deviations and open items (spec M6 vs shipped)

| Spec item | Shipped | Reason |
|---|---|---|
| Runbook and QA docs in-repo | `docs/REVIEW-RUNBOOK.md`, `docs/MANUAL-QA.md` created in-repo per spec deliverables 1 and 2 | the plans-dir copies stay as working notes; the release gate documents live with the code they gate |
| `update.required.title` / `update.required.body` reserved keys | NOT added | the i18n completeness gate fails on unreferenced keys; reserved-but-unwired entries are exactly the orphan class it exists to prevent. They land with the endpoint-version gate wiring |
| `send.disabled.title` / `send.disabled.body` | NOT added | superseded by the shipped M3 honesty: send stays enabled through review and sign and refuses at broadcast with existing keys; a disabled-send copy would describe a flow that does not exist |
| `release.network.mainnetOnly` | NOT added | the release UI hides the switch and shows `settings.network.unavailable`; a second mainnet-only string has no call site |
| `settings.network.unavailable` | added and wired (SettingsScreen release branch) | as specified |
| Camera usage string in app.json | NOT added | no camera dependency exists (scanning deferred, in-repo decision D15); a usage string without the feature is a store-rejection and honesty risk. Becomes a submission precondition together with the ScanSheet milestone |
| Production app identifiers | `org.mintlayer.mojito.me` (iOS bundleIdentifier, Android package) | derived from the project slug; owner confirms before submission (section 7) |
| EAS profile names | `development`, `preview`, `production-android`, `production-ios` per the spec profile contract | as specified; `EXPO_PUBLIC_DATA_MODE=real` set on preview and production, mock explicit on development; no secrets in eas.json and no endpoint literals outside `src/config/endpoints.ts` |
| Privacy declarations | none beyond framework defaults: no analytics, no tracking, no third-party SDK data collection anywhere in the dependency set | as specified |
| Version policy | `appVersionSource: remote` with `autoIncrement` on both production profiles; the semver display version stays owner-owned at submission | CI-stamped build numbers, never hand-edited in release commits |

## 7. Release acceptance checklist

Statuses: pass (machine or recorded evidence), pending (device pass,
`docs/MANUAL-QA.md`), blocked (external dependency), waived (section 5).

- [x] All six milestone specs have their acceptance criteria checked or explicitly waived in the branch history and the in-repo decisions ledger; residual deferrals are enumerated in section 4.2 and the README pending list. (pass)
- [x] Reviewer gate history: per-commit cycle through M5; M6 integration pass recorded in sections 2 and 4. (pass)
- [x] EAS profiles configured per the profile contract; identifiers and version policy applied. Builds not run here. (pass as config; builds pending)
- [ ] Five-size matrix executed per `docs/MANUAL-QA.md` with results recorded; safe areas on notch and dynamic-island devices. (pending device pass)
- [ ] Perf budgets recorded from the 360x740 baseline. (pending device pass)
- [x] Size pass: measured JS bundle recorded; installed sizes pending real artifacts; the one budget miss waived in writing. (pass with waiver)
- [x] Production endpoints locked in `src/config/endpoints.ts`; undecided gaps flag-hidden or mock-gated with honest states (section 3). (pass)
- [ ] Security release checks on a release build: sealed seed, lockout persistence, no secrets in the bundle, checksums re-verified, dependency audit clean or waived. (pending device pass; the static half - no secrets in eas.json, no console in secret paths, checksums in CI - passes here)
- [x] Store metadata readiness minus the camera string: bundle id, version strings, Face ID usage string, privacy posture recorded. Camera string rides the scanning milestone (waiver note in section 6). (pass with noted exception)
- [ ] Testnet E2E demo (M3 script) against the final build; faucet flow documented in `docs/MANUAL-QA.md`. (blocked: A2 testnet URL open; the BTC leg runs when a btc-api testnet base is configured)
- [x] npm run check green on the release commit; commits small with one-line messages through M6. (pass)

### Submission preconditions (owner)

1. Confirm or replace the app identifiers (`org.mintlayer.mojito.me`).
2. Sign the JS-bundle waiver (section 5) or run the trim plan first.
3. Configure `waitlistBase` (R4 backend) - without it the release build refuses to start by design.
4. A1 (ML submission endpoint) and A2 (testnet URL) remain open; their surfaces ship honest-gated (section 3).
5. Record installed sizes and timing numbers from the device pass in this file.

## 8. Sign-off

| Role | Name | Result |
|---|---|---|
| Release engineering | M6 branch `feat/m6-release` | gates recorded above |
| Owner | pending | submission preconditions in section 7 |
