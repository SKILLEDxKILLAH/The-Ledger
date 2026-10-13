# SillyTavern for Android (Pixel 9 Pro)

A standalone Android app that runs the full [SillyTavern](https://github.com/SillyTavern/SillyTavern)
server on the phone itself. No Termux, no PC, no second device needed.

## Install

1. Open the repo's **Releases** on the phone and download the newest
   `SillyTavern-<version>-arm64-v8a.apk` (published by the
   `SillyTavern Android APK` workflow).
2. Open it and allow "Install unknown apps" for your browser when asked.
3. Launch **SillyTavern**. The first launch unpacks about 400 MB and compiles
   frontend assets, which takes around a minute. Later launches take a few seconds.

## How it works

- **Server:** Node.js (Termux's Android build of `nodejs-lts`) runs `server.js`
  as a child process of a foreground service, on `127.0.0.1:8000` only. It isn't
  reachable from the network. The notification has a **Stop** button, and swiping
  the app out of Recents also stops it.
- **UI:** a full-screen WebView on that address. Exports (cards, chats,
  backups) are saved to `Downloads/SillyTavern/`. Imports use the system file
  picker. External links open in your browser.
- **Your data** lives in the app's private `files/data`, separate from the code
  in `files/app`. Updating the APK replaces only the code. Uninstalling deletes
  everything, so export a backup first.

## Pixel 9 Pro specifics

- arm64-v8a only (Tensor G4 is 64-bit only), which keeps the APK smaller.
- Android 14+ target with edge-to-edge layout padded for the punch-hole camera,
  gesture bar and keyboard.
- Predictive back gesture. Back at the root minimizes instead of killing the server.
- Material You boot screen and a monochrome icon for Themed icons.
- V8 heap raised to 4 GB (the phone has 16 GB) for long chats.
- The foreground service keeps replies streaming while you switch apps.

## Building

CI does it (`.github/workflows/sillytavern-android.yml`). To build locally you
need the Android SDK, JDK 17, Node 22, `python3` and `dpkg-deb`:

```sh
python3 scripts/prepare-runtime.py aarch64   # Node runtime -> app/src/main/jniLibs
scripts/prepare-payload.sh 1.19.0            # SillyTavern  -> app/src/main/assets
./gradlew assembleRelease -PstVersion=1.19.0
```

To get stable signing (so updates install over the top and keep your data),
add repo secrets `ST_KEYSTORE_BASE64` (a base64'd JKS with key alias `st`) and
`ST_KEYSTORE_PASSWORD`.

## License

SillyTavern is AGPL-3.0. The release notes link to the exact upstream source
that each APK packages.
