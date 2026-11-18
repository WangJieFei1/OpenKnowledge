# Windows setup

GitHub currently provides source archives, not a Windows installer. Follow the
[development guide](development.md) to run from source with matching x64 Bun and Node.js on
a Windows x64 machine. In the app, click **Open folder** and choose a Markdown folder that
you can read and write. No account or MCP connection is needed to write and search notes.

If an existing folder won't open, check whether it is on a disconnected drive, is only
available online, or has restricted access. Try a normal folder under your user profile.
Sharing a workspace with another tool is optional and separate from Windows folder permissions.

## Install a published build

When a signed Windows x64 installer is available, download the matching Setup.exe from
[GitHub Releases](https://github.com/WangJieFei1/OpenKnowledge/releases), check its publisher
in **Properties → Digital Signatures**, and run it. The Squirrel installer is normally
per-user; you should not need to run the app as administrator. Launch Open Knowledge
from Start, then choose **Open folder**.

Windows may show a [SmartScreen reputation warning](https://learn.microsoft.com/windows/apps/package-and-deploy/smartscreen-reputation)
for a new download even if it is signed. Verify the publisher and download source. On managed
machines, follow your administrator's policy. A native Windows on Arm build has not been validated.

## Package and test on Windows

Use a Windows x64 build machine with matching x64 Bun and Node.js. The signing command
expects a trusted code-signing certificate with its private key available in the current
user's Personal certificate store (for example, through a hardware-backed provider).
Set `OPEN_KNOWLEDGE_WINDOWS_CERT_THUMBPRINT` locally to that certificate's thumbprint.
If your signer needs a specific SignTool or timestamp service, set `WINDOWS_SIGNTOOL_PATH`
or `WINDOWS_TIMESTAMP_SERVER` locally. Do not add keys or credentials to the repository.

From `apps/open-knowledge`:

```powershell
bun run build:win:release
```

The command signs the app and Setup.exe with Authenticode and checks both
signatures and timestamps before printing its path. Before publishing it:

1. Download Setup.exe on a clean Windows 11 x64 machine. Install as a standard user and
   launch from Start. Open a test folder whose path has spaces, create and save a Markdown
   note, restart the app, and check that the note is still there.
2. Check keyword search. On the build machine, run `bun run test:semantic:electron` from
   the desktop project to test local semantic search with a synthetic inputs.
3. If you use MCP, confirm that the folder is not shared until you enable read access.
   Check that uninstalling the app leaves the test folder intact.

`bun run build:win` is for a local test build and is not a substitute for signed
distribution. For Store distribution or a different signing provider, see
[Microsoft's signing options](https://learn.microsoft.com/windows/apps/package-and-deploy/code-signing-options).
