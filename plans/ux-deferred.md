# Deferred UX items

UX work flagged in the M1 gate review that is deliberately not done in this
milestone, with the reason and the milestone that owns it.

## Native vault-prompt locale plumb (deferred, owner: M2+)

The Android `BiometricPrompt` strings inside
`modules/mojito-core/android/.../MojitoCoreModule.kt` are hardcoded English
("Unlock the wallet" / "Verify it is you to unlock" / "Cancel"). The module has
no channel for the app locale yet, and the prompt fires from inside native
crypto operations where no JS round-trip exists at prompt time.

Interim state: the wording mirrors the in-app copy
(`onboarding.unlock.bioReason`, `common.cancel`) so the vault prompt and the
unlock screen do not diverge, and the exception is documented at the call site.

Full fix: pass the locale (or a small strings bundle) into the module at
startup and resolve the prompt strings from it on both platforms; iOS shows
system-managed text for Keychain access-control prompts and needs no strings
today. No M1 UI copy contradicts the native prompts.
