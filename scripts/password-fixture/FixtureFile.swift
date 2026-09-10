import Citadel
import NIO

struct FixtureFile: SFTPFileHandle {
    func read(at offset: UInt64, length: UInt32) async throws -> ByteBuffer { ByteBuffer(string: offset == 0 && length > 0 ? "x" : "") }
    func write(_ data: ByteBuffer, atOffset offset: UInt64) async throws -> SFTPStatusCode { .permissionDenied }
    func close() async throws -> SFTPStatusCode { .ok }
    func readFileAttributes() async throws -> SFTPFileAttributes { SFTPFileAttributes(size: 1, permissions: 0o100644) }
    func setFileAttributes(to attributes: SFTPFileAttributes) async throws { }
}
