#!/usr/bin/env python3
"""Dress a SillyTavern checkout in The Ledger.

- ledger/public/*        -> public/ledger/          (theme CSS, plugin explorer)
- fonts (woff2)          -> public/ledger/fonts/
- ledger/extension/*     -> public/scripts/extensions/ledger-explorer/  (built-in extension)
- ledger/theme.json      -> default/content/themes/The Ledger.json, made the default
                            theme for new users in default/content/settings.json

Usage: apply-ledger.py <sillytavern-dir> <fonts-dir>
"""
import json
import os
import shutil
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
LEDGER = os.path.join(os.path.dirname(HERE), "ledger")


def main():
    st, fonts = sys.argv[1], sys.argv[2]

    pub = os.path.join(st, "public", "ledger")
    shutil.rmtree(pub, ignore_errors=True)
    shutil.copytree(os.path.join(LEDGER, "public"), pub)
    os.makedirs(os.path.join(pub, "fonts"))
    for f in os.listdir(fonts):
        if f.endswith(".woff2"):
            shutil.copy(os.path.join(fonts, f), os.path.join(pub, "fonts", f))

    ext = os.path.join(st, "public", "scripts", "extensions", "ledger-explorer")
    shutil.rmtree(ext, ignore_errors=True)
    shutil.copytree(os.path.join(LEDGER, "extension"), ext)

    content = os.path.join(st, "default", "content")
    with open(os.path.join(LEDGER, "theme.json"), encoding="utf-8") as f:
        theme = json.load(f)
    with open(os.path.join(content, "themes", "The Ledger.json"), "w", encoding="utf-8") as f:
        json.dump(theme, f, indent=4)

    index_path = os.path.join(content, "index.json")
    with open(index_path, encoding="utf-8") as f:
        index = json.load(f)
    if not any(e.get("filename") == "themes/The Ledger.json" for e in index):
        # Right after settings.json so it is seeded before anything else.
        index.insert(1, {"filename": "themes/The Ledger.json", "type": "theme"})
    with open(index_path, "w", encoding="utf-8") as f:
        json.dump(index, f, indent=4)

    # New users start in The Ledger: the theme name plus its values, which is what
    # SillyTavern actually renders from (power_user holds the live settings).
    settings_path = os.path.join(content, "settings.json")
    with open(settings_path, encoding="utf-8") as f:
        settings = json.load(f)
    pu = settings.setdefault("power_user", {})
    for k, v in theme.items():
        if k != "name":
            pu[k] = v
    pu["theme"] = theme["name"]
    with open(settings_path, "w", encoding="utf-8") as f:
        json.dump(settings, f, indent=4)

    print(f"Applied The Ledger to {st}")


if __name__ == "__main__":
    main()
