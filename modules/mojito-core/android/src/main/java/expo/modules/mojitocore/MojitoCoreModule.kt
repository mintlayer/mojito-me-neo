package expo.modules.mojitocore

import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import expo.modules.kotlin.Promise
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.security.KeyStore
import java.security.SecureRandom
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.spec.GCMParameterSpec

// Mojito core facade. The crypto half is real: AES-256-GCM with a key that is
// generated inside Android Keystore on first use of a keyId and never leaves
// it. The MintlayerBindings call-throughs are stubs that reject until M1 ships
// the AAR (org.mintlayer.wallet.bindings). No logging of plaintext or key
// bytes anywhere; module-level logs may reference the keyId only.
class MojitoCoreModule : Module() {
  private val keyAliasPrefix = "mojito.core."

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

    AsyncFunction("seal") { keyId: String, plaintext: ByteArray, promise: Promise ->
      try {
        val key = loadOrCreateKey(keyId)
        val cipher = Cipher.getInstance(TRANSFORM)
        // The Keystore cipher generates its own IV: caller-provided encryption
        // IVs are rejected outright on API 28+ (randomized encryption is
        // required) and would otherwise open the door to IV-reuse misuse.
        cipher.init(Cipher.ENCRYPT_MODE, key)
        val output = cipher.doFinal(plaintext)
        val iv = cipher.iv
        // GCM output is ciphertext with the tag appended; split them apart.
        val tagLen = TAG_BITS / 8
        val ct = output.copyOfRange(0, output.size - tagLen)
        val tag = output.copyOfRange(output.size - tagLen, output.size)
        promise.resolve(
          mapOf(
            "iv" to hex(iv),
            "ct" to hex(ct),
            "tag" to hex(tag),
          ),
        )
      } catch (e: Exception) {
        promise.reject(ERR_CODE, "seal failed for $keyId", e)
      }
    }

    AsyncFunction("open") { keyId: String, iv: String, ct: String, tag: String, promise: Promise ->
      try {
        val key = loadOrCreateKey(keyId)
        require(unhex(iv).size == IV_BYTES) { "iv must be exactly $IV_BYTES bytes" }
        val cipher = Cipher.getInstance(TRANSFORM)
        cipher.init(Cipher.DECRYPT_MODE, key, GCMParameterSpec(TAG_BITS, unhex(iv)))
        val joined = unhex(ct) + unhex(tag)
        promise.resolve(cipher.doFinal(joined))
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
    AsyncFunction("encodeOutputTokenTransfer") { tokenId: String, atoms: String, address: String, network: String, promise: Promise ->
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

  // M1 note: once biometric gating lands, regenerate keys with
  // setUserAuthenticationRequired(true) when biometrics are enrolled.
  private fun loadOrCreateKey(keyId: String): java.security.Key {
    val ks = keyStore()
    if (ks.containsAlias(alias(keyId))) {
      ks.getKey(alias(keyId), null)?.let { return it }
    }
    val generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, ANDROID_KEYSTORE)
    generator.init(
      KeyGenParameterSpec.Builder(
        alias(keyId),
        KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT,
      )
        .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
        .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
        .setKeySize(256)
        .build(),
    )
    generator.generateKey()
    return ks.getKey(alias(keyId), null)
  }

  private fun rejectBindings(promise: Promise) {
    promise.reject(BINDINGS_CODE, "bindings arrive in M1", null)
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
    private const val BINDINGS_CODE = "BINDINGS_NOT_IMPLEMENTED"
    private const val ANDROID_KEYSTORE = "AndroidKeyStore"
    private const val TRANSFORM = "AES/GCM/NoPadding"
    private const val IV_BYTES = 12
    private const val TAG_BITS = 128
  }
}
