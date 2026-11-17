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
