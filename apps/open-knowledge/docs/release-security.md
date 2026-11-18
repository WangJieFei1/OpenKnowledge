# Release security

Packaged builds use ASAR plus Electron Fuses. The application disables Electron-as-Node,
`NODE_OPTIONS`, Node inspector arguments, legacy `file:` privileges and non-ASAR application
fallbacks. It enables embedded ASAR integrity validation and WebAssembly trap handlers. The
browser-process-specific V8 snapshot fuse remains disabled because the application does not ship a
custom browser snapshot.
All known V1 fuses are required explicitly so an Electron upgrade cannot add a fuse without a build
decision.

The MCP stdio client runs through the packaged application's dedicated
`--open-knowledge-mcp-stdio` mode. The private launcher no longer copies executable JavaScript into
user data or relies on `ELECTRON_RUN_AS_NODE`. The connection file remains private and is validated
before use.

Packaged renderer windows disable DevTools and remove command-line switches that enable remote
debugging, disable web security, bypass sandboxing or ignore certificate errors. Development builds
retain their loopback DevTools workflow. Renderer sandboxing, context isolation, CSP, IPC sender
validation and navigation restrictions remain required independent controls.

## Hardened macOS release

Ordinary `build:dir` and `build:mac` output receives a complete ad-hoc signature for local integrity
testing, but it has no verified publisher identity or Hardened Runtime. Public macOS artifacts must use
`build:mac:release`, which checks the local signing certificate and Keychain profile before building. Set:

- `OPEN_KNOWLEDGE_MAC_SIGN_IDENTITY`: an installed Developer ID Application identity.
- `OPEN_KNOWLEDGE_MAC_NOTARY_PROFILE`: a `notarytool` keychain profile name.

Store notarization credentials in Keychain, never in the repository. For example, after creating the
profile with Apple's `notarytool`, run:

```bash
export OPEN_KNOWLEDGE_MAC_SIGN_IDENTITY='Developer ID Application: Example Corp (TEAMID)'
export OPEN_KNOWLEDGE_MAC_NOTARY_PROFILE='open-knowledge-notary'
bun run build:mac:release
```

The release uses Hardened Runtime and a minimal JIT entitlement. Forge signs and notarizes the app
after applying fuses. The release script then signs and notarizes the disk image, attaches its
Apple ticket, and verifies it before printing the file path. Each run writes to a fresh directory
under `out/`. Use a matching Bun and Node.js architecture; verify Apple Silicon and Intel builds
separately. Do not label a native build universal.

Test the downloaded image on a separate Mac with default Gatekeeper settings. Drag the app into
Applications, open it without Terminal, select a test folder and edit a note. Check both a normal
folder and the Files & Folders access flow for a protected location. You can also verify the installed app:

```bash
codesign --verify --deep --strict --verbose=2 '/path/to/Open Knowledge.app'
spctl --assess --type execute --verbose=2 '/path/to/Open Knowledge.app'
xcrun stapler validate '/path/to/Open Knowledge.app'
```

## Signed Windows release

See the [Windows release checklist](windows.md#package-and-test-on-windows) for Authenticode
signing, an installer signature check, and a first-launch test with a standard user.

## Security boundary

These controls make casual extraction harder and make modified signed releases fail integrity checks.
They cannot make client-side JavaScript secret from a determined person who controls the computer.
Never ship API secrets, signing credentials or authorization decisions in renderer code. If an
algorithm must remain confidential, keep it behind an authenticated service or a separately protected
native component; still enforce authorization on the service.
