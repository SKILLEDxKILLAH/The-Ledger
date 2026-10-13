#!/usr/bin/env bash
# CI boot test: install the APK on a running emulator, launch it, wait for the
# on-device SillyTavern server, then check The Ledger's theme, plugin explorer
# and a real plugin install. Collects a screenshot and logs either way.
#
# Usage: emulator-boot-test.sh <apk>
#        LOCAL_BASE=http://127.0.0.1:8124 emulator-boot-test.sh   (checks only, no adb)
set -u

APK="${1:-}"
PKG=app.sillytavern.pocket
base="${LOCAL_BASE:-http://127.0.0.1:8000}"
adb_on() { [ -z "${LOCAL_BASE:-}" ]; }

if adb_on; then
  adb install -r -g "$APK"
  adb shell am start -n "$PKG/.MainActivity"
  adb forward tcp:8000 tcp:8000
fi

ok=0
for _ in $(seq 1 120); do
  if curl -sf -o index.html "$base/" && grep -qi sillytavern index.html; then
    ok=1
    break
  fi
  sleep 5
done

failed=0
check() { # description, then a command that must succeed
  local name="$1"; shift
  if "$@" >/dev/null 2>&1; then echo "ok   $name"; else echo "FAIL $name"; failed=1; fi
}
has() { grep -qF -- "$1" <<<"$2"; }

if [ "$ok" = 1 ]; then
  jar=$(mktemp)
  token=$(curl -sf -c "$jar" -b "$jar" "$base/csrf-token" | sed -n 's/.*"token":"\([^"]*\)".*/\1/p')
  post() { curl -s -c "$jar" -b "$jar" -X POST -H "X-CSRF-Token: $token" -H 'Content-Type: application/json' -d "$2" "$base$1"; }

  check "Ledger theme is served" has "THE LEDGER" "$(curl -sf "$base/ledger/ledger-theme.css")"
  check "plugin explorer is served" has "The Plugin Ledger" "$(curl -sf "$base/ledger/explorer.html")"
  check "explorer extension is discovered" has "ledger-explorer" "$(curl -sf -b "$jar" "$base/api/extensions/discover")"
  check "The Ledger is the default theme" has '\"theme\": \"The Ledger\"' "$(post /api/settings/get '{}')"

  # Install a catalogue plugin through the same API the explorer uses. This runs
  # SillyTavern's built-in git client on Android's Node, which is the risky part.
  install=$(post /api/extensions/install '{"url":"https://github.com/IceFog72/SillyTavern-ProbablyTooManyTabs"}')
  echo "install response: ${install:0:300}"
  check "plugin installs (or is already installed)" bash -c 'grep -q display_name <<<"$0" || grep -q "already exists" <<<"$0"' "$install"
  check "installed plugin is discovered" has "ProbablyTooManyTabs" "$(curl -sf -b "$jar" "$base/api/extensions/discover")"
fi

if adb_on; then
  # Give the WebView time to render the UI before the screenshot.
  sleep 20
  adb exec-out screencap -p > screenshot.png || true
  adb shell run-as "$PKG" cat files/logs/server.log > server.log || true
  adb logcat -d > logcat.txt || true
  tail -40 server.log || true
fi

if [ "$ok" != 1 ]; then
  echo "SillyTavern did not answer within 10 minutes" >&2
  exit 1
fi
if [ "$failed" != 0 ]; then
  echo "SillyTavern is up but a Ledger check failed" >&2
  exit 1
fi
echo "SillyTavern answered and all Ledger checks passed"
