import Citadel

extension SFTPFileAttributes {
    init(size: UInt64 = 0, permissions: UInt32) {
        self.init(size: size)
        self.permissions = permissions
    }
}
