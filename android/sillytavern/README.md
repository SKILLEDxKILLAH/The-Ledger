# Ledger Tavern: SillyTavern for Android (Pixel 9 Pro)

A standalone Android app that runs the full [SillyTavern](https://github.com/SillyTavern/SillyTavern)
server on the phone itself, dressed in The Ledger's look. No Termux, no PC, no
second device needed.

## The Ledger look

- **Phone layout.** On a phone, SillyTavern's row of unlabelled top-bar icons is
  replaced by a slim header: **Menu**, the current screen's name, **Plugins** and
  **Characters**. The menu lists every panel with a label and a one-line
  description, grouped as *Start here*, *Writing* and *Look & add-ons*. When a
  panel is open the menu button becomes a back arrow, and Android's back gesture
  closes the plugin browser, then the menu, then the open panel, before leaving
  the app.
- **Getting started.** The welcome screen shows a four-step guide (connect a
  model, choose a character, name your persona, add plugins) that ticks steps
  off as you finish them. Hide it from the guide itself; bring it back from the
  menu.

- **Theme.** New installs open in the *The Ledger* SillyTavern theme: oxblood,
  brass and hunter green on ruled ledger paper, set in EB Garamond and Cormorant.
  Chat messages read as ledger entries and panels as bound folios. You can switch
  themes in User Settings as usual; the source is `ledger/public/ledger-theme.css`.
- **The Plugin Ledger.** A compass icon in SillyTavern's top bar (also in the
  Extensions wand menu, and as a floating compass if a layout plugin hides the
  top bar) opens a small browser for plugins (UI extensions), with:
  - tabs, back/forward/reload and an address bar that takes a search,
    `owner/repo` or any GitHub URL;
  - the official SillyTavern catalogue (Featured, Tools, Entered filters), plus
    a GitHub search for plugins that aren't catalogued;
  - a page per plugin with its stars, last update, licence, manifest and
    rendered readme;
  - one-tap Install, plus Update and Remove for installed ("entered") plugins
    and a Shelf for bookmarks.

  Android has no `git` binary and SillyTavern's own update path needs one, so
  the app starts SillyTavern with its built-in git client and auto-update off,
  and the explorer's **Update** checks the repository's version, then
  reinstalls the plugin. The plugin's settings are kept.

  The explorer is served by SillyTavern itself (`/ledger/explorer.html`), so it
  uses the server's own extension API. Readmes are rendered through an
  allow-list sanitiser, behind a strict Content Security Policy.
- **Boot screen and icon.** A ledger seal, ruled ground and a brass progress bar
  while the server starts. If startup fails, it shows the server's last log lines
  and a Try again button.

## Install

1. On the phone, open the repo's **latest release**
   (`/releases/latest`) and download `LedgerTavern-<version>-arm64-v8a.apk`.
2. Open it and allow "Install unknown apps" for your browser when asked.
3. Launch **Ledger Tavern**. The first launch unpacks about 400 MB and compiles
   frontend assets, which takes around a minute. Later launches take a few seconds.

## How it works

- **Server:** Node.js (Termux's Android build of `nodejs-lts`) runs `server.js`
  as a child process of a foreground service, on `127.0.0.1:8000` only. It isn't
  reachable from the network. The notification has a **Close tavern** button, and swiping
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
- A monochrome seal icon for Pixel's Themed icons.
- V8 heap raised to 4 GB (the phone has 16 GB) for long chats.
- The foreground service keeps replies streaming while you switch apps.

## Layout

- `app/`: the Android shell (foreground service + WebView).
- `ledger/`: The Ledger's additions. `public/` holds the theme CSS and plugin
  explorer, `extension/` the built-in extension (phone header, menu, guide and
  the explorer's entry points),
  `theme.json` the theme preset and `boot.html` the boot screen.
- `scripts/apply-ledger.py`: installs `ledger/` into a SillyTavern checkout and
  makes the theme the default for new users.

## Building

CI does it (`.github/workflows/sillytavern-android.yml`). To build locally you
need the Android SDK, JDK 17, Node 22, `python3` and `dpkg-deb`:

```sh
python3 scripts/prepare-runtime.py aarch64   # Node runtime -> app/src/main/jniLibs
scripts/prepare-payload.sh 1.19.0            # SillyTavern  -> app/src/main/assets
./gradlew assembleRelease -PstVersion=1.19.0
```

Releases are signed with the app's permanent key (see `signing/README.md`), so
each one installs over the previous one and keeps your data. CI decrypts the key
with the `ST_KEYSTORE_PASSWORD` secret and won't publish an APK signed with
anything else.

## License

SillyTavern is AGPL-3.0. The release notes link to the exact upstream source
that each APK packages.
