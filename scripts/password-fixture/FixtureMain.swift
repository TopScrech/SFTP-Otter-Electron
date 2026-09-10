import Citadel
import Crypto
import NIOSSH
import Foundation

@main struct FixtureMain {
    static func main() async throws {
        let port = Int(CommandLine.arguments.dropFirst().first ?? "22229") ?? 22229
        let key = Curve25519.Signing.PrivateKey()
        let server = try await SSHServer.host(host: "127.0.0.1", port: port, hostKeys: [.init(ed25519Key: key)], authenticationDelegate: FixtureAuthentication())
        server.enableSFTP(withDelegate: FixtureFilesystem())
        print("READY 127.0.0.1:\(port) username=fixture password=tiny-fixture-password file=/tiny.txt size=1")
        try await server.closeFuture.get()
    }
}
