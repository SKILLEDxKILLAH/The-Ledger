#!/usr/bin/env bash
# Package SillyTavern (code + production node_modules), dressed in The Ledger
# (theme, plugin explorer, fonts), into app/src/main/assets/sillytavern.zip. The app unpacks it on first launch and
# again whenever the APK is updated. User data lives elsewhere and is never touched.
#
# Usage: prepare-payload.sh [git-ref]   (default: the tag in ST_REF or 1.19.0)
set -euo pipefail

REF="${1:-${ST_REF:-1.19.0}}"
PROJECT="$(cd "$(dirname "$0")/.." && pwd)"
WORK="$PROJECT/work/payload"
ASSETS="$PROJECT/app/src/main/assets"

rm -rf "$WORK"
mkdir -p "$WORK/fonts" "$ASSETS/fonts"

# Garamond faces for The Ledger (SIL OFL), pinned; latin subsets only.
(
  cd "$WORK/fonts"
  npm pack --silent @fontsource-variable/eb-garamond@5.3.0 @fontsource/cormorant-garamond@5.3.0 >/dev/null
  for t in *.tgz; do tar xzf "$t" --wildcards 'package/files/*-latin-*.woff2' && cp package/files/*-latin-*.woff2 . && rm -rf package; done
  rm -f ./*latin-ext*.woff2
  ls eb-garamond-latin-wght-normal.woff2 eb-garamond-latin-wght-italic.woff2 \
     cormorant-garamond-latin-600-normal.woff2 cormorant-garamond-latin-500-italic.woff2 >/dev/null
)
git clone --depth 1 --branch "$REF" https://github.com/SillyTavern/SillyTavern.git "$WORK/st"
cd "$WORK/st"
REV="$(git rev-parse --short HEAD)"

# Same install the upstream start.sh performs; all dependencies are pure JS/WASM.
NODE_ENV=production npm ci --omit=dev --ignore-scripts --no-audit --no-fund --loglevel=error

python3 "$PROJECT/scripts/apply-ledger.py" "$WORK/st" "$WORK/fonts"

# Not needed on a phone (.bin holds symlinks that zip would duplicate).
rm -rf node_modules/.bin .git .github docker colab tests \
  Start.bat UpdateAndStart.bat UpdateForkAndStart.bat Remote-Link.cmd replit.nix

rm -f "$ASSETS/sillytavern.zip"
zip -q -r -X "$ASSETS/sillytavern.zip" .
echo "$REF $REV" > "$ASSETS/sillytavern-version.txt"

# The app's own boot page and its fonts.
cp "$PROJECT/ledger/boot.html" "$ASSETS/boot.html"
cp "$WORK/fonts/eb-garamond-latin-wght-"*.woff2 "$WORK/fonts/cormorant-garamond-latin-600-normal.woff2" "$ASSETS/fonts/"
ls -la "$ASSETS" "$ASSETS/fonts"
