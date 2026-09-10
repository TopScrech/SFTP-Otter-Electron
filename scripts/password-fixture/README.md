# Disposable password-authentication fixture

This test-only server uses the Citadel, SwiftNIO and Crypto dependencies already built for the original SwiftUI project
It adds no Electron dependency and is excluded from packaged app contents
It listens only on loopback, serves virtual in-memory files and denies filesystem mutations
No OS users, passwords, SSH configuration or saved user host records are changed

## Build and run

From the SFTP Otter project directory:

```sh
python3 scripts/password-fixture/build.py
scripts/password-fixture/server 22229
```

Set `TIDE_FIXTURE_PRODUCTS` to the matching Swift build-products directory, `TIDE_FIXTURE_MODULEMAPS` to its generated module maps, and `TIDE_FIXTURE_CHECKOUTS` to the dependency checkouts before running the builder
The optional fixture requires prebuilt Citadel, SwiftNIO and Crypto dependencies; it does not download or install them
Generated `.build/` objects and the `server` executable are ignored and must not be committed

- Address: `127.0.0.1`
- Port: `22229`, or first server argument
- Username: `fixture`
- Password: `tiny-fixture-password` (public disposable test credential)
- File: `/tiny.txt`, exactly one byte `x`
- Host key: ephemeral Ed25519 key, stable for one server process only

In another terminal:

```sh
./node_modules/.bin/electron scripts/verify-password.cjs --smoke-test
```

The client test writes `verification/password-result.json` after testing saved-password main IPC authentication, secret omission, custom trust approval, directory listing, one-byte download and wrong-password rejection
Set `TIDE_PASSWORD_PORT` when using a different port
Stop the fixture with Control-C after all coordinated tests finish

## Fixture dependency correction

The cached NIOSSH implementation of `writeCompositeSSHString` advances `writerIndex` four bytes without ensuring capacity
A larger SSH handshake reproducibly reaches the 2,048-byte buffer boundary and traps before authentication
The builder replaces that reservation with `writeInteger(UInt32(0))` in a generated fixture-only source copy, then links a replacement NIOSSH object
It never changes the dependency checkout, original app, or SFTP Otter runtime sources
This correction is unrelated to SFTP file contents or EOF handling

## Native folder transfer proof

```sh
./node_modules/.bin/electron scripts/verify-native-folder.cjs --smoke-test
```

This separate test uses the local system SFTP server and real mouse events to drag a remote folder containing one byte into a new disposable Finder window
It verifies nested bytes and preserved source, closes its own window and cleans only its temporary fixture
It requires foreground coordination and existing Accessibility permission
