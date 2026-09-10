import Citadel
import NIOConcurrencyHelpers

final class FixtureDirectory: SFTPDirectoryHandle {
    private let listed = NIOLockedValueBox(false)
    func listFiles(context: SSHContext) async throws -> [SFTPFileListing] {
        guard listed.withLockedValue({ value in
            if value { return false }
            value = true
            return true
        }) else { return [] }
        return [.init(path: [.init(filename: "tiny.txt", longname: "-rw-r--r-- 1 fixture fixture 1 Jan 1 00:00 tiny.txt", attributes: .init(size: 1, permissions: 0o100644))])]
    }
}
