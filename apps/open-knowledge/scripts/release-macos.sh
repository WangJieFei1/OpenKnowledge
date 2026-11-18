#!/bin/bash
set -euo pipefail

fail() {
  printf '%s\n' "$*" >&2
  exit 1
}

[ "$(uname -s)" = Darwin ] || fail 'Build a macOS release on a Mac.'
if ! security find-identity -v -p codesigning | grep -F 'Developer ID Application:' >/dev/null; then
  fail 'No valid Developer ID Application signing identity is installed. No installer was built.'
fi
: "${OPEN_KNOWLEDGE_MAC_SIGN_IDENTITY:?Set OPEN_KNOWLEDGE_MAC_SIGN_IDENTITY to a Developer ID Application identity in Keychain.}"
: "${OPEN_KNOWLEDGE_MAC_NOTARY_PROFILE:?Set OPEN_KNOWLEDGE_MAC_NOTARY_PROFILE to a notarytool Keychain profile.}"

cd "$(dirname "$0")/.."
export OPEN_KNOWLEDGE_MAC_RELEASE=1
export OPEN_KNOWLEDGE_EDITION="${OPEN_KNOWLEDGE_EDITION:-general}"
arch="$(node -p process.arch)"
case "$arch" in
  arm64|x64) ;;
  *) fail "Unsupported macOS architecture: $arch" ;;
esac
[ "$(bun -p process.arch)" = "$arch" ] || fail 'Bun and Node.js must use the same architecture.'

# Check credentials before compiling the app or creating a disk image.
xcrun notarytool history --keychain-profile "$OPEN_KNOWLEDGE_MAC_NOTARY_PROFILE" >/dev/null
mkdir -p "$PWD/out"
export OPEN_KNOWLEDGE_MAC_RELEASE_OUT="$(mktemp -d "$PWD/out/mac-release-XXXXXX")"
bun run build
node node_modules/@electron-forge/cli/dist/electron-forge.js make \
  --platform=darwin --arch="$arch" --targets=dmg

set -- "$OPEN_KNOWLEDGE_MAC_RELEASE_OUT"/make/dmg/"$arch"/*.dmg
[ "$#" -eq 1 ] && [ -f "$1" ] || fail 'Expected exactly one disk image from this build.'
image="$1"
codesign --force --sign "$OPEN_KNOWLEDGE_MAC_SIGN_IDENTITY" --timestamp "$image"
xcrun notarytool submit "$image" --keychain-profile "$OPEN_KNOWLEDGE_MAC_NOTARY_PROFILE" \
  --wait --output-format json > "$OPEN_KNOWLEDGE_MAC_RELEASE_OUT/notarization.json"
node -e 'const r = require(process.argv[1]); if (r.status !== "Accepted") { console.error("Disk image notarization was not accepted."); process.exit(1) }' \
  "$OPEN_KNOWLEDGE_MAC_RELEASE_OUT/notarization.json"
xcrun stapler staple "$image"
xcrun stapler validate "$image"
codesign --verify --strict "$image"
hdiutil verify "$image"
spctl --assess --type open --context context:primary-signature --verbose=2 "$image"
printf 'Verified macOS disk image: %s\n' "$image"
