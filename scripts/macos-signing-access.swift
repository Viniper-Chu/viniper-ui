// Read-only inspection of the private key paired with our local signing certificate.
// The CLI preflight proves its complete selector resolves to this key alone.
// Password entry and unlocking are performed only by Apple security(1).
// No private-key export, password collection, or other Keychain item access.
import Foundation
import Security
import Darwin

let identityName = "Viniper Workstation Local Signing"

func stop(_ message: String, status: OSStatus? = nil) -> Never {
    var result: [String: Any] = ["status": "STOPPED", "message": message]
    if let status { result["os_status"] = status }
    emit(result)
    exit(1)
}

func emit(_ value: [String: Any]) {
    let data = try! JSONSerialization.data(withJSONObject: value, options: [.sortedKeys])
    print(String(data: data, encoding: .utf8)!)
    fflush(stdout)
}

func partitionData(_ description: String) throws -> [String: Any] {
    let bytes = Array(description.utf8)
    guard bytes.count % 2 == 0 else { throw NSError(domain: "InvalidPartition", code: 1) }
    var data = Data()
    for i in stride(from: 0, to: bytes.count, by: 2) {
        guard let value = UInt8(String(bytes: bytes[i..<i+2], encoding: .utf8)!, radix: 16)
        else { throw NSError(domain: "InvalidPartition", code: 2) }
        data.append(value)
    }
    guard let value = try PropertyListSerialization.propertyList(from: data, format: nil) as? [String: Any],
          value["Partitions"] is [String] else { throw NSError(domain: "InvalidPartition", code: 3) }
    return value
}

func encodePartition(_ value: [String: Any]) throws -> String {
    try PropertyListSerialization.data(fromPropertyList: value, format: .xml, options: 0)
        .map { String(format: "%02x", $0) }.joined()
}

struct Entry {
    let acl: SecACL
    let apps: CFArray?
    let description: String
    let prompt: SecKeychainPromptSelector
    let authorizations: [String]
    let paths: [String]

    var isPartition: Bool { authorizations.contains("ACLAuthorizationPartitionID") }
    var isSign: Bool { authorizations.contains("ACLAuthorizationSign") }
    var comparison: String {
        let data = try! JSONSerialization.data(withJSONObject: [
            "authorizations": authorizations.sorted(), "paths": paths.sorted(),
            "any_application": apps == nil, "description": description,
            "prompt": prompt.rawValue
        ], options: [.sortedKeys])
        return String(data: data, encoding: .utf8)!
    }
}

func entries(_ key: SecKey) -> (SecAccess, [Entry]) {
    var access: SecAccess?
    let status = SecKeychainItemCopyAccess(unsafeBitCast(key, to: SecKeychainItem.self), &access)
    guard status == errSecSuccess, let access else { stop("Cannot inspect this signing key's access metadata.", status: status) }
    var list: CFArray?
    let listed = SecAccessCopyACLList(access, &list)
    guard listed == errSecSuccess, let list else { stop("Cannot read access entries.", status: listed) }
    let rows = (list as! [SecACL]).map { acl -> Entry in
        var apps: CFArray?; var description: CFString?
        var prompt = SecKeychainPromptSelector(rawValue: 0)
        let copied = SecACLCopyContents(acl, &apps, &description, &prompt)
        guard copied == errSecSuccess else { stop("Cannot inspect an access entry.", status: copied) }
        var paths: [String] = []
        if let apps {
            for app in apps as! [SecTrustedApplication] {
                var data: CFData?
                guard SecTrustedApplicationCopyData(app, &data) == errSecSuccess,
                      let data, let text = String(data: data as Data, encoding: .utf8),
                      let path = text.split(separator: "\0").first else { stop("Unrecognized trusted application metadata; no change made.") }
                paths.append(String(path))
            }
        }
        let tags = (SecACLCopyAuthorizations(acl) as NSArray).map { String(describing: $0) }
        return Entry(acl: acl, apps: apps, description: description as String? ?? "", prompt: prompt, authorizations: tags, paths: paths)
    }
    return (access, rows)
}

if CommandLine.arguments.contains("--self-test") {
    let original: [String: Any] = ["Partitions": ["apple-tool:"], "Other": "preserve"]
    var value = try partitionData(encodePartition(original))
    value["Partitions"] = (value["Partitions"] as! [String]) + ["apple:"]
    let result = try partitionData(encodePartition(value))
    precondition(result["Partitions"] as! [String] == ["apple-tool:", "apple:"])
    precondition(result["Other"] as! String == "preserve")
    emit(["status": "PASS", "scope": "partition metadata transformation; no Keychain access"])
    exit(0)
}

SecKeychainSetUserInteractionAllowed(false)
var keychain: SecKeychain?
let opened = SecKeychainOpen(NSHomeDirectory() + "/Library/Keychains/login.keychain-db", &keychain)
guard opened == errSecSuccess, let keychain else { stop("Cannot open the login Keychain.", status: opened) }
var keychainState: SecKeychainStatus = 0
let stateStatus = SecKeychainGetStatus(keychain, &keychainState)
guard stateStatus == errSecSuccess, keychainState & 1 != 0
else { stop("The login Keychain is locked; unlock it yourself using Apple security(1) before inspection.", status: stateStatus) }
let query: [String: Any] = [
    kSecClass as String: kSecClassCertificate,
    kSecMatchSubjectContains as String: identityName,
    kSecMatchSearchList as String: [keychain],
    kSecReturnRef as String: true,
    kSecMatchLimit as String: kSecMatchLimitAll
]
var found: CFTypeRef?
let matched = SecItemCopyMatching(query as CFDictionary, &found)
guard matched == errSecSuccess, let certificates = found as? [SecCertificate] else { stop("Local signing certificate not found.", status: matched) }
let exact = certificates.filter { certificate in
    var name: CFString?
    return SecCertificateCopyCommonName(certificate, &name) == errSecSuccess && name as String? == identityName
}
guard exact.count == 1 else { stop("Signing certificate selection is ambiguous; no change made.") }
var identity: SecIdentity?
let paired = SecIdentityCreateWithCertificate(keychain, exact[0], &identity)
guard paired == errSecSuccess, let identity else { stop("No private key paired with this certificate.", status: paired) }
var key: SecKey?
let referenced = SecIdentityCopyPrivateKey(identity, &key)
guard referenced == errSecSuccess, let key else { stop("Cannot obtain the paired key reference.", status: referenced) }
let (access, before) = entries(key)
let sign = before.filter { $0.isSign }
let partitions = before.filter { $0.isPartition }
guard sign.count == 1, sign[0].apps != nil, sign[0].paths == ["/usr/bin/codesign"], partitions.count == 1
else { stop("The signing key's access rules differ from the expected narrow setup; no change made.") }
var value: [String: Any]
do { value = try partitionData(partitions[0].description) }
catch { stop("Cannot parse the existing partition metadata; no change made.") }
let current = value["Partitions"] as! [String]
guard current == ["apple-tool:"] || current == ["apple-tool:", "apple:"]
else { stop("Unexpected partition rules; no change made.") }
var keyAttributes: CFTypeRef?
let attributesStatus = SecItemCopyMatching([
    kSecClass as String: kSecClassKey,
    kSecMatchItemList as String: [key],
    kSecReturnAttributes as String: true
] as CFDictionary, &keyAttributes)
let attributes = keyAttributes as? [String: Any]
let keyLabel = attributes?[kSecAttrLabel as String] as? String ?? ""
var result: [String: Any] = ["status": current.contains("apple:") ? "CONFIGURED_NOT_SIGNING_VERIFIED" : "NEEDS_PARTITION_REPAIR",
      "identity": identityName, "key_display_name": sign[0].description,
      "key_label_contains_nul": keyLabel.contains("\0"),
      "trusted_sign_apps": sign[0].paths, "partitions": current,
      "read_only": true, "private_key_exported": false, "password_received": false]
if CommandLine.arguments.contains("--preflight-cli") {
    // security(1) uses these same CFBoolean and key-class selectors. A label
    // containing NUL cannot be passed through argv, so never truncate it.
    let selection: [String: Any] = [
        kSecClass as String: kSecClassKey,
        kSecAttrKeyClass as String: kSecAttrKeyClassPrivate,
        kSecAttrCanSign as String: true,
        kSecAttrCanEncrypt as String: true,
        kSecAttrCanWrap as String: true,
        kSecAttrCanVerify as String: true,
        kSecMatchSearchList as String: [keychain],
        kSecReturnRef as String: true,
        kSecMatchLimit as String: kSecMatchLimitAll
    ]
    var selected: CFTypeRef?
    let status = SecItemCopyMatching(selection as CFDictionary, &selected)
    guard status == errSecSuccess, let keys = selected as? [SecKey],
          keys.count == 1, CFEqual(keys[0], key)
    else { stop("CLI selector does not uniquely identify the Viniper signing key; no change made.", status: status) }
    result["cli_selector"] = ["-t", "private", "-s", "-e", "-w", "-v"]
    result["cli_matches"] = 1
    result["cli_matches_certificate_paired_key"] = true
}
if CommandLine.arguments.contains("--require-configured") && !current.contains("apple:") {
    stop("The required apple: partition is still missing; signing is not ready.")
}
emit(result)
