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

## NFT thumbnails (deferred, owner: M3)

NftRow already carries `mediaUri` and `iconUri` (parsed by NftService), but
the NFT rows render text-only. The M2 audit accepted the text rows and
flagged thumbnails as the next expectation once real collections show up.
Deferred because there is no image component in the dependency set yet, and
remote artwork needs a caching and failure-story decision (a broken or
hostile URI must degrade to the text row, never a broken tile). The data
contract is ready; only the rendering lands.

## Receive QR below 360 dp (deferred, owner: M3)

The 240 px QR plus the card paddings clips on 320-class screens (224 pt
inner width); every audited device width (360 to 430) is safe. Deferred
because no supported target sits below 360 today. If one lands, scale the
QR size from the measured inner width instead of shrinking the quiet zone.
