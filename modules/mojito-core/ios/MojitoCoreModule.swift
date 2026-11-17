import CryptoKit
import ExpoModulesCore
import LocalAuthentication
import Security

// Mojito core facade. The crypto half is real: AES-256-GCM (CryptoKit) with a
// 256-bit key generated on first use of a keyId and stored in the Keychain
// (kSecAttrAccessibleWhenUnlockedThisDeviceOnly, never returned to JS). The
// MintlayerBindings call-throughs reject until the vendored xcframework
// (MintlayerWalletBindings, see vendor/mintlayer) is exercised in a dev build
// on a Mac; the TS key paths do not depend on them. No logging of plaintext
// or key bytes anywhere; module-level logs may reference the keyId only.
public class MojitoCoreModule: Module {
  private let service = "mojito.core.keys"

  enum CoreError: Error {
    case status(OSStatus)
    case crypto(String)
    case authRequired
  }

  public func definition() -> ModuleDefinition {
    Name("MojitoCore")

    AsyncFunction("secureRandom") { (length: Int, promise: Promise) in
      // Reject bad lengths instead of trapping: Array(count:) is fatal on
      // negative counts and a JS-side bug must not crash the app.
      guard length >= 0 else {
        promise.reject(ERR_CODE, "secureRandom length must be >= 0", nil)
        return
      }
      var bytes = [UInt8](repeating: 0, count: length)
      let status = SecRandomCopyBytes(kSecRandomDefault, length, &bytes)
      if status != errSecSuccess {
        promise.reject(ERR_CODE, "secure random failed", CoreError.status(status))
        return
      }
      promise.resolve(Data(bytes))
    }

    AsyncFunction("seal") { (keyId: String, plaintext: Data, promise: Promise) in
      do {
        let key = try self.loadOrCreateKey(keyId)
        let box = try AES.GCM.seal(plaintext, using: key)
        promise.resolve([
          "iv": hex(box.nonce),
          "ct": hex(box.ciphertext),
          "tag": hex(box.tag),
        ])
      } catch CoreError.authRequired {
        promise.reject(AUTH_REQUIRED_CODE, "user authentication required for \(keyId)", CoreError.authRequired)
      } catch {
        promise.reject(ERR_CODE, "seal failed for \(keyId)", error)
      }
    }

    AsyncFunction("open") { (keyId: String, iv: String, ct: String, tag: String, promise: Promise) in
      do {
        let ivBytes = try unhex(iv)
        guard ivBytes.count == 12 else {
          throw CoreError.crypto("iv must be exactly 12 bytes")
        }
        guard let nonce = AES.GCM.Nonce(data: ivBytes) else {
          throw CoreError.crypto("invalid nonce")
        }
        let key = try self.loadOrCreateKey(keyId)
        let box = try AES.GCM.SealedBox(nonce: nonce, ciphertext: try unhex(ct), tag: try unhex(tag))
        let plain = try AES.GCM.open(box, using: key)
        promise.resolve(plain)
      } catch CoreError.authRequired {
        // Auth-gated key without a fresh biometric (cancelled prompt or a
        // key invalidated by new enrolment). The TS facade maps this code to
        // VaultAuthRequiredError and re-prompts.
        promise.reject(AUTH_REQUIRED_CODE, "user authentication required for \(keyId)", CoreError.authRequired)
      } catch {
        // Wrong key or tampered blob: surface as a failure, never log bytes.
        promise.reject(ERR_CODE, "open failed for \(keyId)", error)
      }
    }

    AsyncFunction("wipe") { (keyId: String, promise: Promise) in
      do {
        try self.deleteKey(keyId)
        promise.resolve(nil)
      } catch {
        promise.reject(ERR_CODE, "wipe failed for \(keyId)", error)
      }
    }

    AsyncFunction("keyExists") { (keyId: String, promise: Promise) in
      do {
        promise.resolve(try self.keyData(keyId) != nil)
      } catch {
        promise.reject(ERR_CODE, "keyExists failed for \(keyId)", error)
      }
    }

    // MintlayerBindings stubs. Signatures stay primitive; the JS facade
    // flattens struct params to JSON strings. Each rejects identically.
    AsyncFunction("makeDefaultAccountPrivkey") { (_: String, _: String, _: String?, promise: Promise) in
      rejectBindings(promise)
    }
    AsyncFunction("extendedPublicKeyFromExtendedPrivateKey") { (_: Data, promise: Promise) in
      rejectBindings(promise)
    }
    AsyncFunction("makeReceivingAddressPublicKey") { (_: Data, _: Int, promise: Promise) in
      rejectBindings(promise)
    }
    AsyncFunction("makeChangeAddressPublicKey") { (_: Data, _: Int, promise: Promise) in
      rejectBindings(promise)
    }
    AsyncFunction("publicKeyFromPrivateKey") { (_: Data, promise: Promise) in
      rejectBindings(promise)
    }
    AsyncFunction("pubkeyToPubkeyhashAddress") { (_: Data, _: String, promise: Promise) in
      rejectBindings(promise)
    }
    AsyncFunction("encodeDestination") { (_: String, _: String, promise: Promise) in
      rejectBindings(promise)
    }
    AsyncFunction("encodeOutpointSourceId") { (_: Data, _: String, promise: Promise) in
      rejectBindings(promise)
    }
    AsyncFunction("encodeInputForUtxo") { (_: Data, _: Int, promise: Promise) in
      rejectBindings(promise)
    }
    AsyncFunction("encodeOutputTransfer") { (_: String, _: String, _: String, promise: Promise) in
      rejectBindings(promise)
    }
    AsyncFunction("encodeOutputTokenTransfer") { (_: String, _: String, _: String, _: String, promise: Promise) in
      rejectBindings(promise)
    }
    AsyncFunction("encodeOutputHtlc") { (_: String, promise: Promise) in
      rejectBindings(promise)
    }
    AsyncFunction("encodeTransaction") { (_: String, _: String, _: Int, promise: Promise) in
      rejectBindings(promise)
    }
    AsyncFunction("estimateTransactionSize") { (_: String, _: String, _: String, _: String, promise: Promise) in
      rejectBindings(promise)
    }
    AsyncFunction("getTransactionId") { (_: Data, _: Bool, promise: Promise) in
      rejectBindings(promise)
    }
    AsyncFunction("decodeTransactionToJson") { (_: Data, _: String, promise: Promise) in
      rejectBindings(promise)
    }
    AsyncFunction("encodeWitness") { (_: String, promise: Promise) in
      rejectBindings(promise)
    }
    AsyncFunction("encodeWitnessNoSignature") { (promise: Promise) in
      rejectBindings(promise)
    }
    AsyncFunction("encodeWitnessHtlcSpend") { (_: String, promise: Promise) in
      rejectBindings(promise)
    }
    AsyncFunction("encodeWitnessHtlcRefundSingleSig") { (_: String, promise: Promise) in
      rejectBindings(promise)
    }
    AsyncFunction("encodeSignedTransaction") { (_: Data, _: String, promise: Promise) in
      rejectBindings(promise)
    }
    AsyncFunction("extractHtlcSecret") { (_: Data, _: Bool, _: Data, _: Int, promise: Promise) in
      rejectBindings(promise)
    }
    AsyncFunction("encodeCreateOrderOutput") { (_: String, promise: Promise) in
      rejectBindings(promise)
    }
    AsyncFunction("encodeInputForFillOrder") { (_: Data, _: Data, _: String, promise: Promise) in
      rejectBindings(promise)
    }
    AsyncFunction("encodeInputForConcludeOrder") { (_: Data, _: Data, promise: Promise) in
      rejectBindings(promise)
    }
    AsyncFunction("getOrderId") { (_: Data, _: Int, promise: Promise) in
      rejectBindings(promise)
    }
    AsyncFunction("getTokenId") { (_: Data, _: Int, promise: Promise) in
      rejectBindings(promise)
    }
    AsyncFunction("fungibleTokenIssuanceFee") { (promise: Promise) in
      rejectBindings(promise)
    }
    AsyncFunction("nftIssuanceFee") { (promise: Promise) in
      rejectBindings(promise)
    }
  }

  // MARK: - Keychain key management

  private func keyQuery(for keyId: String) -> [String: Any] {
    [
      kSecClass as String: kSecClassGenericPassword,
      kSecAttrService as String: service,
      kSecAttrAccount as String: keyId,
    ]
  }

  private func keyData(_ keyId: String) throws -> Data? {
    var item = keyQuery(for: keyId)
    item[kSecReturnData as String] = true
    item[kSecMatchLimit as String] = kSecMatchLimitOne
    var result: AnyObject?
    let status = SecItemCopyMatching(item as CFDictionary, &result)
    if status == errSecItemNotFound { return nil }
    // An access-controlled item denied the read: the system biometric prompt
    // was cancelled (errSecAuthFailed) or interaction is not allowed right
    // now (errSecInteractionNotAllowed). Both map to the auth-required code.
    if status == errSecAuthFailed || status == errSecInteractionNotAllowed {
      throw CoreError.authRequired
    }
    if status != errSecSuccess { throw CoreError.status(status) }
    return result as? Data
  }

  // Enrolled biometrics gate the vault key on creation: access-controlled
  // items cannot be read with the in-app PIN, so a PIN-only wallet (no
  // biometrics enrolled) keeps the app-level PIN as its gate.
  private func biometricsEnrolled() -> Bool {
    LAContext().canEvaluatePolicy(.deviceOwnerAuthenticationWithBiometrics, error: nil)
  }

  private func loadOrCreateKey(_ keyId: String) throws -> SymmetricKey {
    if let existing = try keyData(keyId) {
      return SymmetricKey(data: existing)
    }
    let raw = SymmetricKey(size: .bits256).withUnsafeBytes { Data($0) }
    var add = keyQuery(for: keyId)
    add[kSecValueData as String] = raw
    add[kSecAttrAccessible as String] = kSecAttrAccessibleWhenUnlockedThisDeviceOnly
    // Real user-auth gating: with enrolled biometrics the key item carries
    // kSecAccessControlBiometryCurrentSet, so every Keychain read (and hence
    // every seal/open) runs the system biometric prompt, and enrolling new
    // biometrics invalidates the binding. Keys created before this gate
    // shipped stay ungated until the next wipe and re-onboarding.
    if biometricsEnrolled(),
       let access = SecAccessControlCreateWithFlags(
         kCFAllocatorDefault,
         kSecAttrAccessibleWhenUnlockedThisDeviceOnly,
         .biometryCurrentSet,
         nil
       ) {
      add[kSecAttrAccessControl as String] = access
    }
    let status = SecItemAdd(add as CFDictionary, nil)
    if status == errSecDuplicateItem {
      // First-use race: a concurrent seal() created the key; use the stored one.
      if let existing = try keyData(keyId) {
        return SymmetricKey(data: existing)
      }
    }
    if status != errSecSuccess { throw CoreError.status(status) }
    return SymmetricKey(data: raw)
  }

  private func deleteKey(_ keyId: String) throws {
    let status = SecItemDelete(keyQuery(for: keyId) as CFDictionary)
    if status != errSecSuccess && status != errSecItemNotFound {
      throw CoreError.status(status)
    }
  }

  private func rejectBindings(_ promise: Promise) {
    promise.reject(BINDINGS_CODE, "bindings facade: native call-through pending native-build verification", nil)
  }

  private func hex(_ data: Data) -> String {
    data.map { String(format: "%02x", $0) }.joined()
  }
}

// Strict hex decode: even length, every pair a valid byte. Malformed input
// throws so failures surface here instead of as opaque GCM auth errors later
// (mirrors the Kotlin require-based decoder).
private func unhex(_ value: String) throws -> Data {
  guard value.count % 2 == 0 else {
    throw CoreError.crypto("odd-length hex string")
  }
  var bytes = [UInt8]()
  var index = value.startIndex
  while index < value.endIndex {
    let next = value.index(index, offsetBy: 2)
    guard let byte = UInt8(value[index ..< next], radix: 16) else {
      throw CoreError.crypto("invalid hex string")
    }
    bytes.append(byte)
    index = next
  }
  return Data(bytes)
}

private let ERR_CODE = "MOJITO_CORE"
private let AUTH_REQUIRED_CODE = "MOJITO_AUTH_REQUIRED"
private let BINDINGS_CODE = "BINDINGS_NOT_IMPLEMENTED"
