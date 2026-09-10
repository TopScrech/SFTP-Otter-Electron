# SFTP Otter — Electron

A native macOS Electron SFTP client with a Termius-style dual-pane workspace

## Run

```sh
npm ci
npm run build:native
npm start
```

Open the latest packaged `SFTP Otter.app` under `distribution/` or use `distribution/latest.json` to locate the app, ZIP and disk image

The retained development package is ad-hoc signed, not notarized — release signing and notarization are separate steps
The installed runtime and current package target Apple silicon and macOS 13 or later

## Features

- Two independent browser panes per tab, multiple connected host tabs, local files in either pane
- macOS traffic lights, tabs, settings and transfers on one dark title row
- Full-row file selection, command and shift selection, arrow navigation, Enter to open folders, Delete or Command-Delete confirmation, Command-R refresh
- Inline underlined filtering, breadcrumbs, history, parent rows and hidden files
- Custom file and Actions menus with keyboard navigation, prefix typing and repeated-letter cycling
- Open, Open with, Copy to target directory, Rename, New Folder, Edit Permissions and Delete
- Settings, host chooser/editor, explanations, trust, collision and permissions dialogs share the dark design
- Host profiles, optional passwords/key passphrases and trusted identities persist in macOS Keychain
- First-use fingerprint confirmation, unchanged-key reuse and changed-key rejection
- Reopen connections and local panes after relaunch, off by default; optional remote last-location restoration depends on that setting
- Recursive upload/download and local copy with bounded parallel files and 32 KiB SFTP request pipelining
- Stop, Skip, Replace and Duplicate collision choices; replacement staging and rollback preserve the old destination if installation fails
- Whole-row native drag images, remote file promises to Finder, Finder uploads, in-app local/remote drop destinations, no same-local-folder drop highlight
- Transfer progress, speed, cancellation, retry, text-only Clear, destination refresh and connection logs

SSH uses the system OpenSSH client and an SFTP v3 implementation built with Node core libraries
Electron is the only third-party dependency
Small native helpers integrate macOS Keychain and NSFilePromiseProvider/NSFilePromiseReceiver-compatible drag behavior

## Verify

```sh
npm run check
npm test
npm run smoke
npm run verify:relaunch
npm run verify:trust
```

These use disposable local files and loopback OpenSSH fixtures, never saved user servers
Verification commands generate ignored `verification/` output containing rendered screenshots, interaction results, relaunch/trust results and a 5,000-row selection timing measurement

```sh
npm run verify:native
```

The native verification temporarily shows an isolated app, opens a disposable Finder directory and moves the mouse to perform real remote-to-Finder and remote-to-local-pane drags
It needs Accessibility and Screen Recording permission for the running development tools
It closes its Finder window and app when done

## Build

```sh
npm run build:native
npm run package:mac
```

Requires Xcode command line tools and existing Node N-API headers (the builder checks the Node installation and node-gyp cache)
Each package receives a unique output directory, preserving earlier artifacts
Packaging retains the `.app`, creates ZIP and DMG archives, and verifies the ad-hoc code signature and disk image

## Practical limits

- macOS is the supported and verified platform
- Saved password authentication, encrypted-key authentication, saved key passphrases and RSA-SHA2/ECDH/AES-CTR/HMAC-SHA2 negotiation are exercised against real disposable SSH servers
- Transfers deliberately reject symbolic links and special files; file operations can rename/delete links without following them
- Transfers start again from byte zero when retried; queue history is not persisted across app restarts
- New files and folders use private default permissions; ownership and timestamps are displayed but are not automatically preserved by transfers
- A lost remote connection can leave uniquely named partial staging files; failed connected transfers attempt cleanup and replacement rollback
- Native Open With and file/folder pickers use macOS application/file selection panels

Additional password and one-byte folder Finder checks are documented in `scripts/password-fixture/README.md`

The legacy bundle ID, Keychain service and local preferences directory are retained so saved connections survive the app rename
