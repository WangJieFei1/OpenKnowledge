# macOS integration

## First launch and folder access

GitHub currently provides source archives, not a Mac installer. To build the app yourself, follow
the [development guide](development.md). An official Developer ID-signed, notarized download will
not require you to remove quarantine or have an Apple developer account. macOS may still ask you
to confirm the first launch.

### If a local test build is blocked

If you built the app yourself or know and trust the source of a test build, try to open it once.
If macOS only says the developer could not be verified or the app could not be checked, follow
[Apple's per-app instructions](https://support.apple.com/en-us/102445): open **System Settings →
Privacy & Security**, choose **Open Anyway** if offered, and confirm. This is an exception for that
app, not a step for a normal install. If macOS says the app is damaged or may harm your Mac,
replace it with a verified copy instead. Managed Macs may not offer the exception.

### If a folder will not open

Click **Open folder** and choose a folder you can read. macOS may ask before allowing access to
Desktop, Documents, Downloads, or a removable or network volume. If you denied access, check
[Privacy & Security → Files & Folders](https://support.apple.com/guide/mac-help/mchld5a35146/mac)
for that location, then select the folder again. An ordinary workspace does not need Full Disk Access.
If the folder is on a disconnected drive, reconnect it first. Writing also requires permission to
modify the folder. Sharing it with a connected tool is a separate, optional step in **MCP Settings**.

## Windows and keyboard shortcuts

macOS windows use the native traffic lights with a hidden inset title bar. The renderer reserves
48 pixels for the title bar and 84 pixels on its leading edge, so web controls cannot cover native
close, minimize, and full-screen targets. Other platforms keep their existing custom window controls.
Initial macOS window sizes fit within the target display's work area.

The interface uses the macOS system font and native scrollbars. Document fonts remain controlled by
the user's editor settings. CSS follows reduced-motion and increased-contrast preferences. Existing
system/light/dark choices also update the native window background, including subsequent appearance
changes; per-window listeners are removed when windows close.

Command is the application shortcut modifier on macOS; Control remains available for native text
editing, with Control-Tab reserved for document switching. Shortcut hints use macOS symbols. Command-W
closes the active document in workspace windows and closes Settings, MCP, or the workspace selector
when those utility windows are focused. Command-Shift-W closes the focused window.
Command-B toggles the sidebar only when the focused editor has not handled it as Bold. The native
sidebar menu item intentionally has no accelerator: Electron's `registerAccelerator: false` option
is limited to Linux and Windows. Menu clicks still toggle the sidebar, and its shortcut remains
visible in the command palette and workspace settings.

If unsaved work blocks a native window close, the main process requests the existing renderer save
flow. It does not bypass `beforeunload`. Saving must succeed before the close is retried.
An explicit application quit retains its intent across this save flow: after affected windows close,
the application retries quitting, while any window whose save fails remains open.

Browser permissions are denied except sanitized clipboard writes from the trusted application main
frame, which support copying a connection configuration. Clipboard reads, third-party frames, camera,
microphone, and unrelated browser capabilities are not granted. These are application policies;
the app does not alter macOS privacy settings, launch agents, or system-wide performance preferences.

## Verification

Use a temporary workspace and an isolated application profile for interactive testing. A packaged
test launch can pass `--user-data-dir=/absolute/path/to/test-profile` to the app executable.

- Inspect the workspace at 960 × 640, including a long title, sidebar, editor toolbar and source mode.
- Check the Settings and MCP windows, Command-W, native minimize/full screen, and return from full screen.
- Type into a temporary document and immediately close with the red button; confirm saving succeeds.
- Edit and immediately press Command-Q; confirm the content is saved and the process exits.
- Switch light/dark/system appearance and check the native title bar background.
- Check Chinese input and Command shortcuts without intercepting Control text-editing shortcuts.
- Select rich-text content and press Command-B: it must become bold without toggling the sidebar.
  Then focus the sidebar search field and press Command-B to verify the sidebar shortcut still works.
- Copy a non-sensitive connection configuration in the isolated profile and verify UI success feedback.

Run the native-window behavior, shortcut, application checks, and full test suite before packaging.
