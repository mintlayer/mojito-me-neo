package expo.modules.mojitocore

import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyInfo
import android.security.keystore.KeyPermanentlyInvalidatedException
import android.security.keystore.KeyProperties
import android.security.keystore.UserNotAuthenticatedException
import androidx.biometric.BiometricManager
import androidx.biometric.BiometricPrompt
import androidx.fragment.app.FragmentActivity
import expo.modules.kotlin.Promise
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.security.KeyStore
import java.security.SecureRandom
import java.security.UnrecoverableEntryException
import java.util.concurrent.Executor
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKeyFactory
import javax.crypto.spec.GCMParameterSpec

// Mojito core facade. The crypto half is real: AES-256-GCM with a key that is
// generated inside Android Keystore on first use of a keyId and never leaves
// it. Auth-per-use keys are authorized by an androidx BiometricPrompt launched
// from this module over the cipher's own CryptoObject, so the OS-level
// biometric check and the doFinal are one operation; expo-local-authentication
// cannot pass a CryptoObject and therefore cannot authorize these keys. The
// MintlayerBindings call-throughs reject until the vendored AAR
// (org.mintlayer.wallet.bindings, see vendor/mintlayer) is exercised in a
// dev build on a build machine; the TS key paths do not depend on them. No
// logging of plaintext or key bytes anywhere; module-level logs may reference
// the keyId only.
class MojitoCoreModule : Module() {
  private val keyAliasPrefix = "mojito.core."

  // Carries the typed rejection codes to the TS facade, which maps them to
  // VaultAuthRequiredError and VaultKeyInvalidatedError.
  private class VaultException(val code: String, message: String, cause: Throwable? = null) :
    Exception(message, cause)

  override fun definition() = ModuleDefinition {
    Name("MojitoCore")

    AsyncFunction("secureRandom") { length: Int, promise: Promise ->
      try {
        val bytes = ByteArray(length)
        SecureRandom().nextBytes(bytes)
        promise.resolve(bytes)
      } catch (e: Exception) {
        promise.reject(ERR_CODE, "secure random failed", e)
      }
    }

    AsyncFunction("seal") { keyId: String, plaintext: ByteArray, gated: Boolean, promise: Promise ->
      try {
        val key = loadOrCreateKey(keyId, gated)
        runAuthorized(
          keyId,
          key,
          promise,
          initCipher = { cipher -> cipher.init(Cipher.ENCRYPT_MODE, key) },
        ) { cipher ->
          val output = cipher.doFinal(plaintext)
          val iv = cipher.iv
          // GCM output is ciphertext with the tag appended; split them apart.
          val tagLen = TAG_BITS / 8
          val ct = output.copyOfRange(0, output.size - tagLen)
          val tag = output.copyOfRange(output.size - tagLen, output.size)
          mapOf(
            "iv" to hex(iv),
            "ct" to hex(ct),
            "tag" to hex(tag),
          )
        }
      } catch (e: VaultException) {
        promise.reject(e.code, e.message, e.cause)
      } catch (e: Exception) {
        promise.reject(ERR_CODE, "seal failed for $keyId", e)
      }
    }

    AsyncFunction("open") { keyId: String, iv: String, ct: String, tag: String, promise: Promise ->
      try {
        require(unhex(iv).size == IV_BYTES) { "iv must be exactly $IV_BYTES bytes" }
        // open never creates a key: a persisted blob without a usable key is
        // a hard failure, never a silent regeneration.
        val key = loadKey(keyId)
        runAuthorized(
          keyId,
          key,
          promise,
          initCipher = { cipher ->
            cipher.init(Cipher.DECRYPT_MODE, key, GCMParameterSpec(TAG_BITS, unhex(iv)))
          },
        ) { cipher ->
          cipher.doFinal(unhex(ct) + unhex(tag))
        }
      } catch (e: VaultException) {
        promise.reject(e.code, e.message, e.cause)
      } catch (e: Exception) {
        // Wrong key or tampered blob: surface as a failure, never log bytes.
        promise.reject(ERR_CODE, "open failed for $keyId", e)
      }
    }

    AsyncFunction("wipe") { keyId: String, promise: Promise ->
      try {
        val keyStore = keyStore()
        if (keyStore.containsAlias(alias(keyId))) keyStore.deleteEntry(alias(keyId))
        promise.resolve(null)
      } catch (e: Exception) {
        promise.reject(ERR_CODE, "wipe failed for $keyId", e)
      }
    }

    AsyncFunction("keyExists") { keyId: String, promise: Promise ->
      try {
        promise.resolve(keyStore().containsAlias(alias(keyId)))
      } catch (e: Exception) {
        promise.reject(ERR_CODE, "keyExists failed for $keyId", e)
      }
    }

    AsyncFunction("keyGated") { keyId: String, promise: Promise ->
      try {
        promise.resolve(isUserAuthRequired(loadKey(keyId)))
      } catch (e: VaultException) {
        promise.reject(e.code, e.message, e.cause)
      } catch (e: Exception) {
        promise.reject(ERR_CODE, "keyGated failed for $keyId", e)
      }
    }

    // MintlayerBindings stubs. Signatures stay primitive; the JS facade
    // flattens struct params to JSON strings. Each rejects identically.
    AsyncFunction("makeDefaultAccountPrivkey") { mnemonic: String, network: String, passphrase: String?, promise: Promise ->
      rejectBindings(promise)
    }
    AsyncFunction("extendedPublicKeyFromExtendedPrivateKey") { accountPrivkey: ByteArray, promise: Promise ->
      rejectBindings(promise)
    }
    AsyncFunction("makeReceivingAddressPublicKey") { accountPublicKey: ByteArray, keyIndex: Int, promise: Promise ->
      rejectBindings(promise)
    }
    AsyncFunction("makeChangeAddressPublicKey") { accountPublicKey: ByteArray, keyIndex: Int, promise: Promise ->
      rejectBindings(promise)
    }
    AsyncFunction("publicKeyFromPrivateKey") { privateKey: ByteArray, promise: Promise ->
      rejectBindings(promise)
    }
    AsyncFunction("pubkeyToPubkeyhashAddress") { publicKey: ByteArray, network: String, promise: Promise ->
      rejectBindings(promise)
    }
    AsyncFunction("encodeDestination") { address: String, network: String, promise: Promise ->
      rejectBindings(promise)
    }
    AsyncFunction("encodeOutpointSourceId") { id32: ByteArray, source: String, promise: Promise ->
      rejectBindings(promise)
    }
    AsyncFunction("encodeInputForUtxo") { outpointSource: ByteArray, index: Int, promise: Promise ->
      rejectBindings(promise)
    }
    AsyncFunction("encodeOutputTransfer") { atoms: String, address: String, network: String, promise: Promise ->
      rejectBindings(promise)
    }
    AsyncFunction("encodeOutputTokenTransfer") { tokenId: String, atoms: String, network: String, promise: Promise ->
      rejectBindings(promise)
    }
    AsyncFunction("encodeOutputHtlc") { params: String, promise: Promise ->
      rejectBindings(promise)
    }
    AsyncFunction("encodeTransaction") { inputs: String, outputs: String, flags: Int, promise: Promise ->
      rejectBindings(promise)
    }
    AsyncFunction("estimateTransactionSize") { inputs: String, inputDestinations: String, outputs: String, network: String, promise: Promise ->
      rejectBindings(promise)
    }
    AsyncFunction("getTransactionId") { transaction: ByteArray, strictByteSize: Boolean, promise: Promise ->
      rejectBindings(promise)
    }
    AsyncFunction("decodeTransactionToJson") { transaction: ByteArray, network: String, promise: Promise ->
      rejectBindings(promise)
    }
    AsyncFunction("encodeWitness") { params: String, promise: Promise ->
      rejectBindings(promise)
    }
    AsyncFunction("encodeWitnessNoSignature") { promise: Promise ->
      rejectBindings(promise)
    }
    AsyncFunction("encodeWitnessHtlcSpend") { params: String, promise: Promise ->
      rejectBindings(promise)
    }
    AsyncFunction("encodeWitnessHtlcRefundSingleSig") { params: String, promise: Promise ->
      rejectBindings(promise)
    }
    AsyncFunction("encodeSignedTransaction") { transaction: ByteArray, witnesses: String, promise: Promise ->
      rejectBindings(promise)
    }
    AsyncFunction("extractHtlcSecret") { signedTx: ByteArray, strictByteSize: Boolean, htlcOutpointSourceId: ByteArray, htlcOutputIndex: Int, promise: Promise ->
      rejectBindings(promise)
    }
    AsyncFunction("encodeCreateOrderOutput") { params: String, promise: Promise ->
      rejectBindings(promise)
    }
    AsyncFunction("encodeInputForFillOrder") { orderId: ByteArray, destination: ByteArray, amount: String, promise: Promise ->
      rejectBindings(promise)
    }
    AsyncFunction("encodeInputForConcludeOrder") { orderId: ByteArray, destination: ByteArray, promise: Promise ->
      rejectBindings(promise)
    }
    AsyncFunction("getOrderId") { transaction: ByteArray, outputIndex: Int, promise: Promise ->
      rejectBindings(promise)
    }
    AsyncFunction("getTokenId") { transaction: ByteArray, outputIndex: Int, promise: Promise ->
      rejectBindings(promise)
    }
    AsyncFunction("fungibleTokenIssuanceFee") { promise: Promise ->
      rejectBindings(promise)
    }
    AsyncFunction("nftIssuanceFee") { promise: Promise ->
      rejectBindings(promise)
    }
  }

  private fun keyStore(): KeyStore {
    val ks = KeyStore.getInstance(ANDROID_KEYSTORE).apply { load(null) }
    return ks
  }

  private fun alias(keyId: String) = keyAliasPrefix + keyId

  private fun loadKey(keyId: String): java.security.Key {
    val ks = keyStore()
    if (!ks.containsAlias(alias(keyId))) {
      throw VaultException(ERR_CODE, "no vault key for $keyId")
    }
    return readKey(ks, keyId)
  }

  private fun readKey(ks: KeyStore, keyId: String): java.security.Key {
    val key = try {
      ks.getKey(alias(keyId), null)
    } catch (e: UnrecoverableEntryException) {
      throw VaultException(
        KEY_INVALIDATED_CODE,
        "vault key for $keyId is unreadable; restore from the recovery phrase",
        e,
      )
    }
    // An alias whose entry cannot be handed out is effectively dead: the
    // sealed data under it can no longer be opened, so fail loudly instead
    // of silently regenerating a fresh (ungated) key.
    return key
      ?: throw VaultException(
        KEY_INVALIDATED_CODE,
        "vault key for $keyId is unreadable; restore from the recovery phrase",
      )
  }

  // The vault key is created auth-gated only when the wallet chose biometrics
  // on the Secure screen (the `gated` argument travels with every seal, so
  // creation keys on the persisted user choice, never on hardware detection).
  // A PIN-only wallet keeps the in-app PIN as its only gate; enrolling new
  // biometrics invalidates a gated key and the wallet recovers via phrase
  // restore (documented in the README manual checks).
  private fun loadOrCreateKey(keyId: String, gated: Boolean): java.security.Key {
    val ks = keyStore()
    if (ks.containsAlias(alias(keyId))) {
      return readKey(ks, keyId)
    }
    val builder = KeyGenParameterSpec.Builder(
      alias(keyId),
      KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT,
    )
      .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
      .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
      .setKeySize(256)
    if (gated) {
      if (appContext.reactContext == null) {
        // An auth-per-use key is only usable through a BiometricPrompt over
        // the current activity; creating one without the context would make
        // the wallet unopenable, and silently downgrading to an ungated key
        // is not an option.
        throw VaultException(ERR_CODE, "cannot create the gated vault key for $keyId: no activity context")
      }
      builder.setUserAuthenticationRequired(true)
      builder.setInvalidatedByBiometricEnrollment(true)
    }
    val generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, ANDROID_KEYSTORE)
    generator.init(builder.build())
    generator.generateKey()
    return readKey(ks, keyId)
  }

  private fun isUserAuthRequired(key: java.security.Key): Boolean {
    val factory = SecretKeyFactory.getInstance(KeyProperties.KEY_ALGORITHM_AES, ANDROID_KEYSTORE)
    val info = factory.getKeySpec(key, KeyInfo::class.java)
    return info.isUserAuthenticationRequired
  }

  // Every vault cipher use funnels through here. Gated keys are authorized
  // with an androidx BiometricPrompt over the cipher's own CryptoObject,
  // launched from this module against the current activity: a generic prompt
  // without the CryptoObject authorizes nothing, so the JS side never runs
  // one for vault operations. Cancellation and failure reject
  // MOJITO_AUTH_REQUIRED; terminal key states reject their own code.
  private fun runAuthorized(
    keyId: String,
    key: java.security.Key,
    promise: Promise,
    initCipher: (Cipher) -> Unit,
    op: (Cipher) -> Any?,
  ) {
    val cipher = Cipher.getInstance(TRANSFORM)
    try {
      initCipher(cipher)
    } catch (e: KeyPermanentlyInvalidatedException) {
      // Distinct from UserNotAuthenticatedException (a different hierarchy
      // branch): new biometric enrolment killed the key for good.
      promise.reject(
        KEY_INVALIDATED_CODE,
        "vault key for $keyId was invalidated by a biometric change; restore from the recovery phrase",
        e,
      )
      return
    } catch (e: UserNotAuthenticatedException) {
      // Expected for an auth-per-use key: the prompt below completes the
      // crypto binding before doFinal runs in the success callback.
    }
    if (!isUserAuthRequired(key)) {
      // Ungated key (a PIN-only wallet choice): no OS prompt; the app-level
      // PIN remains the only control for the vault.
      try {
        promise.resolve(op(cipher))
      } catch (e: Exception) {
        promise.reject(ERR_CODE, "vault operation failed for $keyId", e)
      }
      return
    }
    val activity = appContext.reactContext?.currentActivity as? FragmentActivity
    if (activity == null) {
      // The gate's prompt cannot be shown: fail instead of running the
      // operation without its authorization.
      promise.reject(ERR_CODE, "no foreground activity to authorize the vault key for $keyId", null)
      return
    }
    appContext.mainQueue.launch {
      val prompt = BiometricPrompt(
        activity,
        Executor { it.run() },
        object : BiometricPrompt.AuthenticationCallback() {
          override fun onAuthenticationSucceeded(result: BiometricPrompt.AuthenticationResult) {
            try {
              promise.resolve(op(result.cryptoObject?.cipher ?: cipher))
            } catch (e: Exception) {
              promise.reject(ERR_CODE, "vault operation failed for $keyId", e)
            }
          }

          override fun onAuthenticationError(errorCode: Int, errString: CharSequence) {
            if (errorCode == BiometricPrompt.ERROR_NO_BIOMETRICS) {
              // The gate can never be satisfied again on this device;
              // recovery is phrase restore, not a retry.
              promise.reject(
                KEY_INVALIDATED_CODE,
                "no biometrics can satisfy the vault key gate for $keyId; restore from the recovery phrase",
                null,
              )
              return
            }
            // Cancellation (button, user cancel, timeout), recognition
            // failure and temporary lockout all mean "not authorized now";
            // the typed error lets the app keep the wallet locked.
            promise.reject(AUTH_REQUIRED_CODE, "biometric authorization for $keyId was not completed", null)
          }

          // onAuthenticationFailed is not terminal: the prompt stays up and
          // the user can retry inside it. Never reject here.
        },
      )
      val info = BiometricPrompt.PromptInfo.Builder()
        // i18n exception (deferred-UX notes): these strings are hardcoded
        // English inside the module; there is no app-locale channel across
        // the bridge yet, so the full plumb is deferred. The wording mirrors
        // the in-app copy (onboarding.unlock.bioReason) so the vault prompt
        // and the unlock screen do not diverge.
        .setTitle("Unlock the wallet")
        .setSubtitle("Verify it is you to unlock")
        .setNegativeButtonText("Cancel")
        .setAllowedAuthenticators(BiometricManager.Authenticators.BIOMETRIC_STRONG)
        .build()
      prompt.authenticate(info, BiometricPrompt.CryptoObject(cipher))
    }
  }

  private fun rejectBindings(promise: Promise) {
    promise.reject(BINDINGS_CODE, "bindings facade: native call-through pending native-build verification", null)
  }

  private fun hex(bytes: ByteArray): String {
    val sb = StringBuilder(bytes.size * 2)
    for (b in bytes) sb.append("%02x".format(b))
    return sb.toString()
  }

  private fun unhex(value: String): ByteArray {
    require(value.length % 2 == 0) { "odd-length hex string" }
    return ByteArray(value.length / 2) { i ->
      value.substring(i * 2, i * 2 + 2).toInt(16).toByte()
    }
  }

  companion object {
    private const val ERR_CODE = "MOJITO_CORE"
    private const val AUTH_REQUIRED_CODE = "MOJITO_AUTH_REQUIRED"
    private const val KEY_INVALIDATED_CODE = "MOJITO_KEY_INVALIDATED"
    private const val BINDINGS_CODE = "BINDINGS_NOT_IMPLEMENTED"
    private const val ANDROID_KEYSTORE = "AndroidKeyStore"
    private const val TRANSFORM = "AES/GCM/NoPadding"
    private const val IV_BYTES = 12
    private const val TAG_BITS = 128
  }
}
