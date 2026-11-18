# Decision log

Decisions referenced from code comments live here. Earlier entries (R2 pure
TypeScript keyring, D7 English-only strings, D9 no dash characters) are recorded
in the branch history and in the code comments that cite them; this file
consolidates the decisions taken from the M1 gate review onward so future
changes have one place to check.

## D10. KeySession stays an unlock-time abstraction, wired in M2

`src/keys/session.ts` (`openKeySession` / `KeySession`) has no production
caller in M1: discovery derives from onboarding state, and the unlock flow
calls `walletVault.meta()` / `openWords()` directly. The M1-gate review flagged
the module as production-dead code narrating phantom callers.

Decision: defer the wiring, do not delete the module. Receive and address
management in M2 are the intended consumers (an unlocked session derives
accounts through `withSeed` so seed bytes stay inside the closure). The module
stays in M1 because its closure-isolation, zeroize and release semantics are
vector-tested in `src/keys/session.test.ts`, and the header states the deferral
instead of describing callers that do not exist.

## D11. btcPrivateKeyAt lands with the M3 signer

`BtcKeyring.btcPrivateKeyAt` (and the `mnemonicToSeedSync` dependency it
carries) is test-only in M1; its production consumer is M3's BtcTxBuilder
signing path. Deferred with that milestone rather than landed as a
forward-declared API; the function doc says so.

## D12. Shared per-tick address scan deferred

Portfolio and activity each call `addressInfo` per derived address on every
refresh cycle, so one tick issues two sequential scans. A shared per-tick
scan carried on the home bundle would halve the request count. Deferred:
the duplicate work is bounded by the gap scan, the 60 second cadence and
the rate-limit-friendly sequential probing, so the simplification is not
worth the state coupling yet. Revisit with M3 send bookkeeping, which needs
fresh per-address summaries for coin selection anyway.

## D13. Chain-client methods without M2 consumers stay, deferred to their milestones

The M2 gate review counted 13 production-dead methods across the chain
clients: `src/data/ml/IndexerClient.ts` (`tip`, `spendableUtxos`, `allUtxos`,
`tokensByTicker`, `feerate`, `coinStatistics`, `orderBook`, `walkCursor`,
`walkOffset`) and `src/data/btc/BtcChainService.ts` (`utxos`, `txStatus`,
`tipHeight`, `feeEstimates`) have no caller outside their own tests. That is
the forward-declared-API shape D11 rejected, so the surface is recorded here
instead of being silently kept or silently trimmed.

Decision: defer, do not delete. Each method maps to a named milestone
consumer: `feerate`, the UTXO listings and the BTC `utxos`/`txStatus`/
`tipHeight`/`feeEstimates` set land with the M3 signer and fee bookkeeping;
`orderBook`, `coinStatistics`, `tokensByTicker` and the cursor walkers land
with the M4 market and activity paging. The client module headers cite this
entry instead of narrating callers that do not exist, and M3/M4 must consume
or trim these methods when their consumers land.

M4 outcome (reconciliation): consumed in production are `feerate`,
`spendableUtxos`, `tip`, the BTC set, `orderBook` (OrderBookService),
`tokensByTicker` (ticker disambiguation) and `walkOffset` (orders and
ordersByPair). Trimmed with the M4 fix pass: `allUtxos` and `coinStatistics`
(production-dead, untested, and no remaining milestone consumer). Deferred:
`walkCursor`, the only survivor, because M4's cursor walking lives inside
OrderBookService with restart semantics of its own; the generic walker stays
test-only until a second cursor endpoint needs it, and a later milestone must
consume or delete it like the rest of this ledger.

## D14. QR encoding uses react-native-qrcode-svg, not the spec's pure-TS encoder

The M3 spec's deliverable 1 asked for a hand-rolled pure TypeScript QR encoder
(`src/qr/QrCode.ts`, ECC M) with a reference-decoder round-trip test. Shipped
instead: the `react-native-qrcode-svg` library at error correction level H.

Rationale: a QR encoder is exactly the kind of byte-level state machine a
hand-rolled copy gets subtly wrong (mask selection, version negotiation,
padding), and a bug there produces codes that scan unreliably or encode the
wrong payload. The battle-tested library removes that entire failure class,
and ECC H keeps the code decodable under the center badge overlay the receive
screen renders. The price is one well-audited dependency instead of a
maintained in-tree deliverable, and the ECC M to H drift (more redundancy,
no functional change). The pure-TS deliverable and its round-trip test are
dropped, not deferred; if the dependency ever has to go, reintroduce the
deliverable with its reference-decoder test in the same change.

## D15. ScanSheet and expo-camera deferred past M3

The M3 spec's deliverable 2 (a scan sheet for pasting-free recipient entry)
is not shipped: there is no camera dependency and no ScanSheet. The send
screen's QR button shows an honest alert ("Camera scanning ships with the
next milestone; paste an address for now") and paste remains the entry path.

Rationale: a camera permission surface is a native build and store-review
cost that a paste-first send flow does not need yet, and shipping it half
wired would be worse than an honest alert. The `scan.*` i18n keys land with
the sheet, not before. Revisit when the milestone that owns scanning picks
the camera library.

## R4. The waitlist ships local-only in v1 (option C), real backend before ship

2026-11-17. The M5 card screen needs an early-access waitlist, but no waitlist
backend exists: missing-architecture gap 4 proposes the POST /v1/waitlist
contract, with options A and B for the hosted or self-hosted backend. Decision:
ship v1 as option C, the sealed device-local store
(`src/data/mock/localWaitlist.ts`): one slot per install, the email sealed
under the `waitlist.email.v1` key id, never logged, never sent anywhere. The
HTTP provider (`src/data/providers/WaitlistProvider.ts`) is complete against
the proposed contract and activates on a config flip only
(`endpoints.waitlistBase`), so going real stays a URL change.

This is a ship blocker: a production build must never run the local-only
waitlist. The gate lives in `createWaitlistProvider` behind
`FLAGS.localWaitlistOnly`: where dev fallbacks are not allowed (a release
build), construction without a configured backend refuses with
`LocalWaitlistShipBlockerError` instead of silently shipping the device-local
store.

Retention: the email is personal data, so it joins the destructive boundaries.
Settings > Leave wipes the sealed entry (a failed wipe surfaces and the row
stays joined), and wallet sign-out wipes it together with the vault and the
PIN, verifying the blob is gone before the app returns to onboarding.

## M4 change log

### Bindings seam corrected to the vendored signatures (M4 review, critical)

The first M4 implementation mirrored an imagined UniFFI API. The TS mirror
in `modules/mojito-core/mintlayer/MintlayerBindings.ts` is reshaped to the
pinned vendored surface (`vendor/mintlayer`, wallet-bindings v0.1.0):
`getOrderId(inputs, network)` derives the order id from the create tx
inputs (no output index exists); `encodeInputForFillOrder` and
`encodeInputForConcludeOrder` take the bech32 id strings plus the account
nonce and the current block height (they select the orders V0/V1 input
form; conclude carries no destination argument); `encodeOutputHtlc` takes
a hex secret hash, no spend pubkey, and a `refundTimelock` blob produced
by the `encodeLock*` encoders (`encodeLockForSeconds` is added to the
mirror for the seconds-denominated offers); `extractHtlcSecret` consumes
the `encodeOutpointSourceId` blob, not the bare 32-byte id;
`decodeTransactionToJson` is only ever fed serialized transaction bytes.
The seam is pinned by `src/trade/bindingsParity.test.ts` (per-line literal
asserts plus a checksum over the vendored signature lines), so either side
drifts only through a failing gate.

Account-nonce policy: the bindings docs require the fill and conclude
nonces to sequence with the filler's other account spendings. The flows
use an in-session counter (`createOrderFlows`); the wallet must persist
the account nonce with its state before the native call-through goes live
on real funds, otherwise the first order transaction after a restart can
sit at the wrong nonce. Recorded here as a gate condition for the
call-through landing.

### Deviations reviewed and kept (M4 change log consolidation)

The three M4 deviations the review flagged as sound stay, consolidated
here so the code comments can cite one entry:

- Raw claim bytes on `extractSecret`: the public Mintlayer indexer serves
  no raw-transaction route, so a txId-only signature cannot honestly fetch
  what the bindings extraction consumes. The lock transaction bytes are
  now captured at initiate (before the broadcast) and persisted with the
  swap session (`lockTxHex`); claim and refund take those bytes and feed
  them to `decodeTransactionToJson`, which consumes serialized transaction
  bytes, never a tx id.
- Optional `secret` on the shared `WitnessParams`: localizes the pinned
  htlc-spend-only reveal field at the seam level; `encodeWitnessHtlcSpend`
  is the only consumer (the M4 fix pass removed the dead secret parameter
  and the unreachable spend branch from the multi-input order/HTLC signer,
  so the field now rides the dedicated single-input witness paths only).
- Optional `BridgeQuote.minAmount/etaSeconds/confirmationsRequired`:
  encodes the fixture-vs-bridge_v2 API divergence; the screen honors each
  (null hides the row, the eta derives from confirmations).

### Swap initiate gated in real mode (M4 change log)

The M4 demo locked Mintlayer against the public BIP39 test vector as both
counterparty spend path and refund path. The fix pass gates real-mode
initiation with a typed unsupported error (mirroring
`BridgeProvider.initiate`) until an offer entry supplies the counterparty
spend address and key; the refund address comes from the wallet's own
address allocation; mock mode keeps the scripted demo flow with the demo
callout. The tautological timelock guard (a fabricated BTC leg derived
from the ML value) was removed from the entry path;
`checkTimelockRule` returns with real offers, taking `btcSeconds` from
the offer instead of the scripted half.

### Swap initiate split so the lock bytes rest before the broadcast (M4 fix)

`initiate` now only builds and signs the lock transaction (locally
computed tx id, unsigned bytes, signed hex); `broadcastLock` is the
second half and verifies the answered id against the locally computed
one. The swap screen persists the session row (state 'offered',
`lockTxHex` set) between the two calls, so a crash after the broadcast
still leaves the bytes the claim and refund decodes consume, and the
offered -> locked transition fires only after the broadcast answers.
The transition table now also allows offered -> refunded: an 'offered'
row whose post-broadcast save failed still refunds from its stored
bytes, and a failed save maps to an explicit funds-locked error naming
the tx id (the generic nothing-sent copy would invite a second lock).
The retired spend pubkey column is dropped with the split: the vendored
`encodeOutputHtlc` carries no spend pubkey, the decoded descriptor never
read one, and the screen no longer fabricates a 33-byte key to persist.
