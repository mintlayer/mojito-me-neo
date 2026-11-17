import CryptoKit
import ExpoModulesCore
import Security

// Mojito core facade. The crypto half is real: AES-256-GCM (CryptoKit) with a
// 256-bit key generated on first use of a keyId and stored in the Keychain
// (kSecAttrAccessibleWhenUnlockedThisDeviceOnly, never returned to JS). The
// MintlayerBindings call-throughs are stubs that reject until M1 ships the
// xcframework (MintlayerWalletBindings). No logging of plaintext or key bytes
// anywhere; module-level logs may reference the keyId only.
public class MojitoCoreModule: Module {
  private let service = "mojito.core.keys"

  enum CoreError: Error {
    case status(OSStatus)
    case crypto(String)
  }

  public func definition() -> ModuleDefinition {
    Name("MojitoCore")

    AsyncFunction("secureRandom") { (length: Int, promise: Promise) in
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
      } catch {
        promise.reject(ERR_CODE, "seal failed for \(keyId)", error)
      }
    }

    AsyncFunction("open") { (keyId: String, iv: String, ct: String, tag: String, promise: Promise) in
      do {
        guard let nonce = AES.GCM.Nonce(data: unhex(iv)) else {
          throw CoreError.crypto("invalid nonce")
        }
        let key = try self.loadOrCreateKey(keyId)
        let box = try AES.GCM.SealedBox(nonce: nonce, ciphertext: unhex(ct), tag: unhex(tag))
        let plain = try AES.GCM.open(box, using: key)
        promise.resolve(plain)
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
    if status != errSecSuccess { throw CoreError.status(status) }
    return result as? Data
  }

  private func loadOrCreateKey(_ keyId: String) throws -> SymmetricKey {
    if let existing = try keyData(keyId) {
      return SymmetricKey(data: existing)
    }
    let raw = SymmetricKey(size: .bits256).withUnsafeBytes { Data($0) }
    var add = keyQuery(for: keyId)
    add[kSecValueData as String] = raw
    add[kSecAttrAccessible as String] = kSecAttrAccessibleWhenUnlockedThisDeviceOnly
    let status = SecItemAdd(add as CFDictionary, nil)
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
    promise.reject(BINDINGS_CODE, "bindings arrive in M1", nil)
  }

  private func hex(_ data: Data) -> String {
    data.map { String(format: "%02x", $0) }.joined()
  }
}

private func unhex(_ value: String) -> Data {
  var bytes = [UInt8]()
  var index = value.startIndex
  while index < value.endIndex {
    let next = value.index(index, offsetBy: 2)
    if let byte = UInt8(value[index ..< next], radix: 16) {
      bytes.append(byte)
    }
    index = next
  }
  return Data(bytes)
}

private let ERR_CODE = "MOJITO_CORE"
private let BINDINGS_CODE = "BINDINGS_NOT_IMPLEMENTED"
