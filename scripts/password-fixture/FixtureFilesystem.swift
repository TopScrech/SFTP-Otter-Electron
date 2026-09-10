import Citadel

struct FixtureFilesystem: SFTPDelegate {
    func fileAttributes(atPath path: String, context: SSHContext) async throws -> SFTPFileAttributes { .init(size: path == "/" || path == "." ? 0 : 1, permissions: path == "/" || path == "." ? 0o40755 : 0o100644) }
    func openFile(_ filePath: String, withAttributes: SFTPFileAttributes, flags: SFTPOpenFileFlags, context: SSHContext) async throws -> SFTPFileHandle { FixtureFile() }
    func removeFile(_ filePath: String, context: SSHContext) async throws -> SFTPStatusCode { .permissionDenied }
    func createDirectory(_ filePath: String, withAttributes: SFTPFileAttributes, context: SSHContext) async throws -> SFTPStatusCode { .permissionDenied }
    func removeDirectory(_ filePath: String, context: SSHContext) async throws -> SFTPStatusCode { .permissionDenied }
    func realPath(for canonicalUrl: String, context: SSHContext) async throws -> [SFTPPathComponent] { [.init(filename: canonicalUrl == "." || canonicalUrl == "/" ? "/" : "/tiny.txt", longname: "/", attributes: .init(permissions: 0o40755))] }
    func openDirectory(atPath path: String, context: SSHContext) async throws -> SFTPDirectoryHandle { FixtureDirectory() }
    func setFileAttributes(to attributes: SFTPFileAttributes, atPath path: String, context: SSHContext) async throws -> SFTPStatusCode { .permissionDenied }
    func addSymlink(linkPath: String, targetPath: String, context: SSHContext) async throws -> SFTPStatusCode { .permissionDenied }
    func readSymlink(atPath path: String, context: SSHContext) async throws -> [SFTPPathComponent] { [] }
    func rename(oldPath: String, newPath: String, flags: UInt32, context: SSHContext) async throws -> SFTPStatusCode { .permissionDenied }
}
