#!/usr/bin/env bash
# Package SillyTavern (code + production node_modules) into
# app/src/main/assets/sillytavern.zip. The app unpacks it on first launch and
# again whenever the APK is updated. User data lives elsewhere and is never touched.
#
# Usage: prepare-payload.sh [git-ref]   (default: the tag in ST_REF or 1.19.0)
set -euo pipefail

REF="${1:-${ST_REF:-1.19.0}}"
PROJECT="$(cd "$(dirname "$0")/.." && pwd)"
WORK="$PROJECT/work/payload"
ASSETS="$PROJECT/app/src/main/assets"

rm -rf "$WORK"
mkdir -p "$WORK" "$ASSETS"
git clone --depth 1 --branch "$REF" https://github.com/SillyTavern/SillyTavern.git "$WORK/st"
cd "$WORK/st"
REV="$(git rev-parse --short HEAD)"

# Same install the upstream start.sh performs; all dependencies are pure JS/WASM.
NODE_ENV=production npm ci --omit=dev --ignore-scripts --no-audit --no-fund --loglevel=error

# Not needed on a phone (.bin holds symlinks that zip would duplicate).
rm -rf node_modules/.bin .git .github docker colab tests \
  Start.bat UpdateAndStart.bat UpdateForkAndStart.bat Remote-Link.cmd replit.nix

rm -f "$ASSETS/sillytavern.zip"
zip -q -r -X "$ASSETS/sillytavern.zip" .
echo "$REF $REV" > "$ASSETS/sillytavern-version.txt"
ls -la "$ASSETS"
