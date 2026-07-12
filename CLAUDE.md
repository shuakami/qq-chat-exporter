# QQ Chat Exporter Agent Quick Start

`AGENTS.md` is authoritative. Read and follow it first; this file is a compact execution checklist for repository work.

## Start here

1. Inspect `git status`, the target branch, and the merge-base.
2. Read the touched package manifest, nearby tests, and relevant workflow.
3. Identify the authoritative implementation:
   - runtime/API: `qq-chat-export-server`
   - export formats: `qq-chat-export-core`
   - NapCat lifecycle/bridge: `plugins/qq-chat-exporter/index.mjs` and `runtime/`
   - main UI: `qce-v4-tool`
   - chunked export UI: `qce-chunked-viewer`
4. Keep changes focused; do not mechanically rewrite unrelated files.
5. Run all checks in the `AGENTS.md` change-impact matrix.

## Easy-to-miss requirements

- NapCat internal imports require:

  ```bash
  node plugins/qq-chat-exporter/tools/create-overlay-runtime.cjs
  ```

- Main UI changes require a static production build:

  ```bash
  cd qce-v4-tool
  pnpm install --frozen-lockfile
  pnpm build
  ```

- Chunked viewer changes require both build and synchronization:

  ```bash
  cd qce-chunked-viewer
  npm ci
  npm run typecheck
  npm run build
  npm run sync
  ```

  Never edit either `modern_chunked_app.js` copy by hand.

- Rust changes require targeted `rustfmt`, tests, Clippy with warnings denied, and a build.
- Path-sensitive code must use `PathManager`, preserve custom directories, and validate allowed roots.
- Success notifications must not reveal complete local paths; provide an open-location action.
- Do not introduce unbounded or cross-account/task caches.
- A release fix always gets a new unused tag; never retag.

## Windows package smoke deployment

Use this only when a local `NapCat-QCE-Windows-x64` package directory is available.

```powershell
node plugins/qq-chat-exporter/tools/create-overlay-runtime.cjs
Copy-Item -Recurse -Force "plugins\qq-chat-exporter\lib\*" "NapCat-QCE-Windows-x64\plugins\qq-chat-exporter\lib\"
Remove-Item -Recurse -Force "NapCat-QCE-Windows-x64\plugins\qq-chat-exporter\node_modules\NapCatQQ" -ErrorAction SilentlyContinue
Copy-Item -Recurse -Force "plugins\qq-chat-exporter\node_modules\NapCatQQ" "NapCat-QCE-Windows-x64\plugins\qq-chat-exporter\node_modules\"

Remove-Item -Recurse -Force "NapCat-QCE-Windows-x64\static\qce" -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force -Path "NapCat-QCE-Windows-x64\static\qce"
Copy-Item -Recurse -Force "qce-v4-tool\out\*" "NapCat-QCE-Windows-x64\static\qce\"
```

Copy the complete `NapCatQQ` directory, not only its contents, and preserve the frontend `_next/static` hierarchy.

## Stop-before-finish check

Ask:

- **What worries me most?** Verify the riskiest behavior with a test or authoritative inspection.
- **What did I least prove?** Finish the weakest requested item or disclose the precise verification gap.

Then inspect `git diff --check`, the merge-base diff, generated assets, lockfiles, CI, and release state before making a success claim.
