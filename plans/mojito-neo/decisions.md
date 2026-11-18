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
