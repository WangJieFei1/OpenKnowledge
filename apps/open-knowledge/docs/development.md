# Development

## Commands

From `apps/open-knowledge`:

Use Bun 1.4.0, matching CI. SvelteKit and its static adapter are pinned to the versions recorded in
the lockfile so that a changed `next` tag does not silently change a frozen installation.

```bash
bun install
bun run dev
bun run lint
bun run check
bun run build
bun run build:dir
bun run build:app
bun run build:linux
bun run build:mac
bun run build:mac:release
bun run build:win
bun run start
```

`bun run dev` starts Vite and Electron. Renderer changes use HMR, main-process changes restart Electron, and preload changes reload the window. Production output goes to `build/` and `dist-electron/`. The MCP stdio bridge uses a dedicated application mode so packaged builds can disable Electron-as-Node.

`bun run build:dir` creates an unpacked application under `out/`. `bun run build:app` creates distributables under `out/make/`: ZIP on every platform, AppImage on Linux, DMG on macOS, and Squirrel on Windows. Use `build:linux`, `build:mac`, or `build:win` on the matching host.

See [release security](./release-security.md) for Electron fuses, production debugging restrictions,
and the Developer ID-signed/notarized `build:mac:release` flow. Ad-hoc signed builds are for local
review only.

### Linux AppImage

AppImage builds require `mksquashfs` to be available on `PATH`. On Debian or Ubuntu, install it from the `squashfs-tools` package:

```bash
sudo apt install squashfs-tools
command -v mksquashfs
bun run build:linux
```

On Nix, provide it for the build without installing it globally:

```bash
nix-shell -p squashfsTools --run 'bun run build:linux'
```

The AppImage is written to `out/make/AppImage/<architecture>/`.

Set `OPEN_KNOWLEDGE_WORKSPACE=/absolute/path/to/bundle` during development to register and open a fixture without using the native folder dialog. Packaged applications ignore this variable.

On NixOS, an unwrapped npm Electron binary may lack host shared libraries. A production smoke run can use the wrapped system package:

```bash
nix-shell -p electron --run 'bun run dev:system'
```

`dev:system` keeps the normal Vite restart/HMR behavior but resolves `electron` from `PATH` instead of the npm binary.

## Verification

Run targeted tests while developing, then `bun run lint`, `bun run check`, and `bun run build` before completion.

For behavior changes, exercise the affected Electron flow with a temporary bundle. Verify conflicts for filesystem work, round-trip preservation for editor work, deep links for routes, and keyboard/focus behavior for interactive UI. For UI changes, check the renderer console and a `960 x 640` layout.

When running workspace tests on macOS, use a canonical temporary directory (for example,
`TMPDIR=/private/tmp bun test` from this app directory). macOS may otherwise supply `/var/...` while
the filesystem resolves it to `/private/var/...`, which breaks fixtures that compare root identities.
