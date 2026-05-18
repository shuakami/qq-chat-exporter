# napcat-launcher — Linux LD_PRELOAD shim (issue #433)

This shim is what makes the QCE Linux package boot into the real QQ Electron
process instead of plain Node.js. It is a Linux-only artefact; macOS and
Windows use other launchers.

## Why it exists

Before this, `launcher-user.sh` ran:

```
node napcat-bootstrap.mjs
```

which loaded NapCat's `napcat.mjs` (and through it, QQ's `wrapper.node`)
into a vanilla Node.js process. `wrapper.node` is a Chromium/Electron native
addon — it assumes the embedder set up V8 isolates and the libstdc++ runtime
the way Electron does. When loaded into stock Node, the C++ STL state inside
the addon ends up half-initialised; the first
`std::vector<std::string>::_M_realloc_insert` after `session.startNT()` reads
a corrupted `_M_start` and crashes:

```
#0  ... std::vector<std::string>::_M_realloc_insert<...>
        at /opt/QQ/resources/app/wrapper.node
#1  0x0
```

That is the segfault users on Fedora 44, Debian 13, NixOS, Arch and
Ubuntu 24.04 see immediately after the QR-code login completes.

## How it fixes the bug

`launcher.cpp` is `LD_PRELOAD`'d into the real QQ binary
(`/opt/QQ/qq` or equivalent). It hooks `open`, `openat` and `fopen` and:

1. Intercepts QQ's `resources/app/package.json` and rewrites the `main`
   field to point at our `loadNapCat.js`.
2. Synthesises `loadNapCat.js` (in memory via `memfd`, with a disk fallback)
   that imports `napcat.mjs` from the QCE pack directory.

`wrapper.node` therefore runs inside the Electron embedder it was built for,
the std::vector layout matches and login completes cleanly.

This is a port of [NapNeko/napcat-linux-launcher](https://github.com/NapNeko/napcat-linux-launcher),
with three QCE-specific changes:

1. `NAPCAT_JS_CONTENT` imports `./napcat.mjs` (QCE pack layout) instead of
   `./napcat/napcat.mjs` (NapCat-only layout).
2. QQ's `package.json` path is overridable via `NAPCAT_QQ_PKG_JSON`
   (`launcher-user.sh` auto-detects it from the QQ install).
3. Logging is gated behind `NAPCAT_LAUNCHER_DEBUG` so the normal stdout
   stays clean.

## Building

`scripts/quick-pack.py` pre-compiles `libnapcat_launcher.so` into the
Linux release tarball during packaging. For ad-hoc local builds:

```bash
./build.sh                                  # → libnapcat_launcher.so next to this README
./build.sh /tmp/libnapcat_launcher_test.so  # → custom output path
```

The launcher script (`launcher-user.sh`) recompiles in place if the bundled
`.so` is missing.

## Tests

See `plugins/qq-chat-exporter/__tests__/unit/napcatLinuxLauncher.test.ts`.
