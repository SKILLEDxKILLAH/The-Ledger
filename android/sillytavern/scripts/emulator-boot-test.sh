#!/usr/bin/env bash
# CI boot test: install the APK on a running emulator, launch it, and wait for the
# on-device SillyTavern server to answer. Collects a screenshot and logs either way.
#
# Usage: emulator-boot-test.sh <apk>
set -u

APK="$1"
PKG=app.sillytavern.pocket

adb install -r -g "$APK"
adb shell am start -n "$PKG/.MainActivity"
adb forward tcp:8000 tcp:8000

ok=0
for _ in $(seq 1 120); do
  if curl -sf -o index.html http://127.0.0.1:8000/ && grep -qi sillytavern index.html; then
    ok=1
    break
  fi
  sleep 5
done

# Give the WebView time to render the UI before the screenshot.
sleep 20
adb exec-out screencap -p > screenshot.png || true
adb shell run-as "$PKG" cat files/logs/server.log > server.log || true
adb logcat -d > logcat.txt || true
tail -40 server.log || true

if [ "$ok" = 1 ]; then
  echo "SillyTavern answered on 127.0.0.1:8000"
else
  echo "SillyTavern did not answer within 10 minutes" >&2
  exit 1
fi
