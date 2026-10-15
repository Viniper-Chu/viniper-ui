// Protocol v1. Keep this signed executable unchanged across UI updates.
// Secrets travel only over inherited anonymous pipes to the signed parent app.
import Foundation
import Security
import CryptoKit
import Darwin

func reply(_ value: [String: Any], code: Int32 = 0) -> Never {
    let data = try! JSONSerialization.data(withJSONObject: value)
    FileHandle.standardOutput.write(data)
    exit(code)
}
func fail(_ reason: String) -> Never { reply(["ok": false, "error": reason], code: 1) }

func trustedParent() -> Bool {
    var own: SecCode?; var ownStatic: SecStaticCode?; var requirement: SecRequirement?
    var description: CFString?; var parent: SecCode?
    guard SecCodeCopySelf([], &own) == errSecSuccess, let own,
          SecCodeCopyStaticCode(own, [], &ownStatic) == errSecSuccess, let ownStatic,
          SecCodeCopyDesignatedRequirement(ownStatic, [], &requirement) == errSecSuccess, let requirement,
          SecRequirementCopyString(requirement, [], &description) == errSecSuccess, let description else { return false }
    let helperIdentifier = "identifier \"com.viniper.workstation.credentials\""
    let text = description as String
    guard text.contains(helperIdentifier), !text.contains("cdhash ") else { return false }
    let expected = text.replacingOccurrences(of: helperIdentifier, with: "identifier \"com.viniper.workstation\"")
    var parentRequirement: SecRequirement?
    guard SecRequirementCreateWithString(expected as CFString, [], &parentRequirement) == errSecSuccess,
          let parentRequirement,
          SecCodeCopyGuestWithAttributes(nil, [kSecGuestAttributePid as String: getppid()] as CFDictionary, [], &parent) == errSecSuccess,
          let parent else { return false }
    return SecCodeCheckValidity(parent, SecCSFlags(rawValue: kSecCSStrictValidate), parentRequirement) == errSecSuccess
}

guard trustedParent() else { fail("untrusted-parent") }
var input = Data()
while true {
    let chunk = FileHandle.standardInput.readData(ofLength: 4096)
    if chunk.isEmpty { break }
    input.append(chunk)
    guard input.count <= 131072 else { fail("request-too-large") }
}
guard let request = try? JSONSerialization.jsonObject(with: input) as? [String: Any],
      let action = request["action"] as? String else { fail("invalid-request") }
if request["interaction"] as? Bool == false { SecKeychainSetUserInteractionAllowed(false) }
if action == "available" {
    var keychain: SecKeychain?
    let status = SecKeychainCopyDefault(&keychain)
    reply(["ok": status == errSecSuccess, "protocol": 1])
}
guard action == "encrypt" || action == "decrypt", let value = request["value"] as? String else { fail("unsupported-action") }
let keyQuery: [String: Any] = [kSecClass as String: kSecClassGenericPassword,
    kSecAttrService as String: "com.viniper.workstation.credential-key",
    kSecAttrAccount as String: "vault-v1"]
func readKey() -> (OSStatus, Data?) {
    var query = keyQuery; query[kSecReturnData as String] = true
    var value: CFTypeRef?
    let status = SecItemCopyMatching(query as CFDictionary, &value)
    return (status, value as? Data)
}
var (keyStatus, keyData) = readKey()
if keyStatus == errSecItemNotFound && action == "encrypt" {
    var bytes = Data(count: 32)
    let randomStatus = bytes.withUnsafeMutableBytes { SecRandomCopyBytes(kSecRandomDefault, 32, $0.baseAddress!) }
    guard randomStatus == errSecSuccess else { fail("random-key-unavailable") }
    var create = keyQuery; create[kSecValueData as String] = bytes
    create[kSecAttrLabel as String] = "Viniper workstation encrypted credentials"
    let added = SecItemAdd(create as CFDictionary, nil)
    if added == errSecSuccess { keyStatus = errSecSuccess; keyData = bytes }
    else if added == errSecDuplicateItem { (keyStatus, keyData) = readKey() }
    else { fail("keychain-write-\(added)") }
}
guard keyStatus == errSecSuccess, let keyData, keyData.count == 32 else { fail("keychain-read-\(keyStatus)") }
let key = SymmetricKey(data: keyData)
do {
    if action == "encrypt" {
        let sealed = try AES.GCM.seal(Data(value.utf8), using: key)
        guard let combined = sealed.combined else { fail("encryption-failed") }
        reply(["ok": true, "value": combined.base64EncodedString(), "protocol": 1])
    } else {
        guard let encrypted = Data(base64Encoded: value) else { fail("invalid-ciphertext") }
        let sealed = try AES.GCM.SealedBox(combined: encrypted)
        let plain = try AES.GCM.open(sealed, using: key)
        guard let text = String(data: plain, encoding: .utf8) else { fail("invalid-plaintext") }
        reply(["ok": true, "value": text, "protocol": 1])
    }
} catch { fail("authenticated-encryption-failed") }
