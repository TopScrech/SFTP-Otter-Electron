import NIO
@preconcurrency import NIOSSH

struct FixtureAuthentication: NIOSSHServerUserAuthenticationDelegate {
    let supportedAuthenticationMethods: NIOSSHAvailableUserAuthenticationMethods = .password
    func requestReceived(request: NIOSSHUserAuthenticationRequest, responsePromise: EventLoopPromise<NIOSSHUserAuthenticationOutcome>) {
        if case .password(let password) = request.request, request.username == "fixture", password.password == "tiny-fixture-password" {
            responsePromise.succeed(.success)
        } else {
            responsePromise.succeed(.failure)
        }
    }
}
