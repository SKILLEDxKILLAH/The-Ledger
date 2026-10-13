#!/usr/bin/env python3
"""Stage an Android-native Node.js runtime into app/src/main/jniLibs/<abi>/.

Android has no glibc, so the official Node builds cannot run there. Termux
publishes Node built against Android's bionic libc; we take its `nodejs-lts`
package plus the shared libraries it links against.

Android only extracts files named lib*.so from an APK, and only files in the
app's nativeLibraryDir may be executed, so every file is renamed to
`libst_<name>.so`. A manifest (assets/runtime-libs.txt) maps each real SONAME to
its packaged name; at runtime the app symlinks SONAMEs to those files and points
LD_LIBRARY_PATH at the symlink dir, so no ELF patching is needed.

Usage: prepare-runtime.py <aarch64|x86_64>
"""
import gzip
import os
import re
import shutil
import subprocess
import sys
import urllib.request

REPO = "https://packages.termux.dev/apt/termux-main"
ROOT_PKG = "nodejs-lts"
ABI = {"aarch64": "arm64-v8a", "x86_64": "x86_64"}
# Provided by Android itself; must not be bundled.
SYSTEM_LIBS = {"libc.so", "libm.so", "libdl.so", "liblog.so", "libandroid.so", "libz.so"}

HERE = os.path.dirname(os.path.abspath(__file__))
PROJECT = os.path.dirname(HERE)


def fetch(url, dest):
    print("GET", url, flush=True)
    with urllib.request.urlopen(url) as r, open(dest, "wb") as f:
        shutil.copyfileobj(r, f)


def parse_packages(path):
    pkgs = {}
    with gzip.open(path, "rt", encoding="utf-8") if path.endswith(".gz") else open(path, encoding="utf-8") as f:
        for stanza in f.read().split("\n\n"):
            fields = dict(re.findall(r"^([A-Za-z-]+): (.*)$", stanza, re.M))
            if "Package" in fields:
                pkgs[fields["Package"]] = fields
    return pkgs


def deps_of(fields):
    out = []
    for part in fields.get("Depends", "").split(","):
        part = part.strip()
        if part:
            # "a (>= 1) | b" -> "a"
            out.append(re.split(r"[\s(|]", part, 1)[0])
    return out


def elf_info(path):
    """Return (soname, [needed]) or None if not an ELF file."""
    with open(path, "rb") as f:
        if f.read(4) != b"\x7fELF":
            return None
    txt = subprocess.run(["readelf", "-d", path], capture_output=True, text=True).stdout
    needed = re.findall(r"\(NEEDED\).*\[(.+?)\]", txt)
    soname = re.findall(r"\(SONAME\).*\[(.+?)\]", txt)
    return (soname[0] if soname else None, needed)


def packaged_name(soname):
    base = re.sub(r"^lib", "", soname)
    return "libst_" + re.sub(r"[^A-Za-z0-9_]", "_", base) + ".so"


def main():
    arch = sys.argv[1] if len(sys.argv) > 1 else "aarch64"
    abi = ABI[arch]
    work = os.path.join(PROJECT, "work", arch)
    shutil.rmtree(work, ignore_errors=True)
    os.makedirs(work)

    index = os.path.join(work, "Packages")
    fetch(f"{REPO}/dists/stable/main/binary-{arch}/Packages", index)
    pkgs = parse_packages(index)

    # Resolve the dependency closure of nodejs-lts.
    todo, seen = [ROOT_PKG], []
    while todo:
        name = todo.pop()
        if name in seen or name not in pkgs:
            continue
        seen.append(name)
        todo.extend(deps_of(pkgs[name]))
    print("packages:", " ".join(f"{p}={pkgs[p]['Version']}" for p in seen))

    root = os.path.join(work, "root")
    os.makedirs(root)
    for name in seen:
        deb = os.path.join(work, name + ".deb")
        fetch(f"{REPO}/{pkgs[name]['Filename']}", deb)
        subprocess.run(["dpkg-deb", "-x", deb, root], check=True)

    usr = os.path.join(root, "data/data/com.termux/files/usr")
    node = os.path.join(usr, "bin/node")
    node = os.path.realpath(node)

    # Index every shared object by SONAME and by file name (symlinks resolved).
    by_soname = {}
    for dirpath, _, files in os.walk(root):
        for fn in files:
            if ".so" not in fn:
                continue
            p = os.path.realpath(os.path.join(dirpath, fn))
            if not os.path.isfile(p):
                continue
            info = elf_info(p)
            if info:
                if info[0]:
                    by_soname[info[0]] = p
                by_soname.setdefault(fn, p)

    # ELF NEEDED closure starting at the node binary.
    needed, missing, queue = {}, set(), list(elf_info(node)[1])
    while queue:
        so = queue.pop()
        if so in needed or so in SYSTEM_LIBS or so in missing:
            continue
        if so not in by_soname:
            missing.add(so)
            continue
        needed[so] = by_soname[so]
        queue.extend(elf_info(by_soname[so])[1])
    if missing:
        print("libraries found in packages:", " ".join(sorted(by_soname)))
        sys.exit(f"unresolved libraries (not in Termux packages or Android): {sorted(missing)}")

    out = os.path.join(PROJECT, "app/src/main/jniLibs", abi)
    shutil.rmtree(os.path.join(PROJECT, "app/src/main/jniLibs"), ignore_errors=True)
    os.makedirs(out)
    shutil.copy(node, os.path.join(out, "libst_node.so"))
    manifest = []
    for so, path in sorted(needed.items()):
        shutil.copy(path, os.path.join(out, packaged_name(so)))
        manifest.append(f"{so}\t{packaged_name(so)}")

    assets = os.path.join(PROJECT, "app/src/main/assets")
    os.makedirs(assets, exist_ok=True)
    with open(os.path.join(assets, "runtime-libs.txt"), "w") as f:
        f.write("\n".join(manifest) + "\n")
    with open(os.path.join(assets, "runtime-version.txt"), "w") as f:
        f.write(f"{ROOT_PKG} {pkgs[ROOT_PKG]['Version']}\n")

    for line in manifest:
        print("  ", line)
    total = sum(os.path.getsize(os.path.join(out, f)) for f in os.listdir(out))
    print(f"staged {len(manifest) + 1} files ({total // (1 << 20)} MiB) into {out}")


if __name__ == "__main__":
    main()
