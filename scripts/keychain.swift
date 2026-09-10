import Foundation
import Security
let service = CommandLine.arguments.count > 2 ? CommandLine.arguments[2] : "dev.tide.sftp.secure-workspace"
let action = CommandLine.arguments.count > 1 ? CommandLine.arguments[1] : "read"
let query: [String: Any] = [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service, kSecAttrAccount as String: "workspace"]
func fail(_ status: OSStatus) -> Never {
    fputs("Keychain operation failed (\(status))\n", stderr)
    exit(1)
}
if action == "delete" {
    let status = SecItemDelete(query as CFDictionary)
    if status != errSecSuccess && status != errSecItemNotFound { fail(status) }
} else if action == "read" {
    var request = query
    request[kSecReturnData as String] = true
    request[kSecMatchLimit as String] = kSecMatchLimitOne
    var result: CFTypeRef?
    let status = SecItemCopyMatching(request as CFDictionary, &result)
    if status == errSecItemNotFound { exit(0) }
    guard status == errSecSuccess, let data = result as? Data else { fail(status) }
    FileHandle.standardOutput.write(data)
} else {
    let data = FileHandle.standardInput.readDataToEndOfFile()
    let status = SecItemUpdate(query as CFDictionary, [kSecValueData: data] as CFDictionary)
    if status == errSecItemNotFound {
        var item = query
        item[kSecValueData as String] = data
        item[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
        let added = SecItemAdd(item as CFDictionary, nil)
        if added != errSecSuccess { fail(added) }
    } else if status != errSecSuccess { fail(status) }
}
