# QQ Chat Exporter Engineering Guide

This file is the repository-wide source of truth for coding agents and contributors. Read it before changing code. Subdirectory instructions, when present, may add stricter rules but must not weaken these.

## 1. Product and architecture

QQ Chat Exporter is a multi-runtime application:

| Area | Purpose | Source of truth |
| --- | --- | --- |
| NapCat plugin bridge | Loads in NapCat, normalizes plugin APIs, starts the Rust server | `plugins/qq-chat-exporter/index.mjs`, `plugins/qq-chat-exporter/runtime/` |
| Rust API server | HTTP/WebSocket API, NapCat RPC client, persistence, scheduling, resources | `qq-chat-export-server/src/` |
| Rust export core | TXT/JSON/JSONL/HTML/XLSX and modern HTML generation | `qq-chat-export-core/src/` |
| Main web UI | Static-exported Next.js application served under `/static/qce` | `qce-v4-tool/` |
| Chunked export viewer | React + HyperScroll viewer embedded into modern chunked exports | `qce-chunked-viewer/src/` |
| Legacy local viewer | Standalone Express viewer for existing exports | `qce-viewer/` |
| Desktop installer | Windows Tauri installer/launcher | `installer/` |
| Desktop uninstaller | Windows Tauri uninstaller | `uninstaller/` |
| Packaging/release | Shell, Framework, store plugin, installer, Docker artifacts | `scripts/`, `.github/workflows/`, `docker/` |

The production plugin is Rust-first. The TypeScript modules under `plugins/qq-chat-exporter/lib/` remain important compatibility references and test fixtures, but packaged runtime startup is `index.mjs` → `runtime/rustBridge.mjs` → `qce-server`.

## 2. Invariants that must not regress

### Paths and user data

- Configuration/database state defaults to `~/.qq-chat-exporter`.
- User-visible exports default to the platform Documents directory under `QQChatExporter`:
  - `exports`
  - `scheduled-exports`
  - `exports/avatars`
  - feature-specific subdirectories such as `exports/sticker-packs`
- Use the shared `PathManager`; do not reconstruct these paths in routes or UI code.
- Preserve custom export-directory settings and migration behavior.
- Never delete, overwrite, or migrate user data without an explicit, tested compatibility path.
- File APIs must validate that requested paths remain inside allowed export roots.

### API and bridge

- Keep the Node bridge bound to loopback and preserve request-size limits.
- Treat NapCat payloads as externally shaped data: support documented wrapper variants without weakening error handling.
- Do not add cross-account, cross-task, or unbounded caches. Every cache needs an owner, capacity/lifetime, and invalidation rule.
- Keep WebSocket task resync, polling fallback, task persistence, and completion notifications consistent.

### UI and UX

- Preserve the existing lightweight visual language, HyperScroll behavior, keyboard flows, and responsive layouts.
- Do not expose complete local paths in success notifications. Use an explicit open-location action.
- Do not move scroll or focus after exports unless the user initiated navigation.
- Keep confirmation notifications persistent until the user acts.
- Avoid decorative icons in text actions unless the surrounding component consistently uses them.

### Export compatibility

- Existing export formats and filenames are public interfaces.
- Chunked viewer Bloom parameters, JSONP callback shapes, manifest fields, global message indexes, and `file://` operation must remain compatible with the Rust exporter.
- Parser changes must consider replies, forwards, recalls, system messages, media, stickers, sender names, and both group/private chats.

### Security

- Never commit credentials, tokens, cookies, QR-session data, private exports, or local configuration.
- Do not log access tokens, full RPC bodies containing user messages, or sensitive filesystem paths.
- Keep `unsafe_code = "forbid"` in Rust crates.
- Preserve archive path sanitization, filename sanitization, request limits, loopback defaults, and path traversal checks.

## 3. Generated and synchronized files

Do not hand-edit generated output.

| Generated output | Canonical source | Regeneration |
| --- | --- | --- |
| `qce-chunked-viewer/assets/modern_chunked_app.js` | `qce-chunked-viewer/src/` | `cd qce-chunked-viewer && npm run build` |
| `qq-chat-export-core/assets/modern_chunked_app.js` and index template | `qce-chunked-viewer/assets/` | `cd qce-chunked-viewer && npm run sync` |
| NapCat overlay runtime under plugin `node_modules/NapCatQQ` | overlay generator and NapCat source snapshot | `node plugins/qq-chat-exporter/tools/create-overlay-runtime.cjs` |
| Frontend static export under `qce-v4-tool/out/` | `qce-v4-tool/app`, `components`, `hooks`, `lib` | `cd qce-v4-tool && pnpm build` |
| Installer/Tauri build output | installer source | package scripts/workflows; never edit `target/` |

If a generated file changes unexpectedly, inspect the generator and source diff instead of patching the output. Commit synchronized tracked output when the consuming package embeds it.

## 4. Change workflow

1. Read the relevant source, tests, package manifest, and workflow before editing.
2. Confirm which implementation is authoritative; several TypeScript modules mirror Rust behavior.
3. Make the smallest coherent change. Do not reformat unrelated files.
4. Add or update a focused regression test when behavior changes.
5. Regenerate only outputs owned by changed source.
6. Run the targeted checks below, then inspect the complete diff.
7. Report any skipped check and the concrete reason; never imply unrun checks passed.

Use existing dependencies and patterns. Before adding a package, prove that the standard library or an existing dependency cannot solve the problem. Pin compatible versions and update the correct lockfile through the package manager.

## 5. Build and test matrix

Run checks for every touched area. CI is authoritative when local platform constraints prevent a check.

### Plugin bridge and TypeScript compatibility code

```bash
cd plugins/qq-chat-exporter
npm ci
npm run typecheck
npm test
```

If code imports or depends on NapCatQQ internals, also run:

```bash
node plugins/qq-chat-exporter/tools/create-overlay-runtime.cjs
```

The test harness is login-free and uses `MockNapCatCore`; prefer it over a real QQ account. See `plugins/qq-chat-exporter/__tests__/README.md`.

### Rust export core

```bash
cd qq-chat-export-core
cargo test
cargo clippy --all-targets -- -D warnings
cargo build
```

### Rust API server

```bash
cd qq-chat-export-server
cargo test
cargo clippy --all-targets -- -D warnings
cargo build
```

Format only touched Rust files:

```bash
rustfmt --edition 2021 --check path/to/changed.rs
```

Repository-wide formatting may expose unrelated historical differences; do not rewrite unrelated files.

### Main web UI

CI uses Node 20 and pnpm 9 with `qce-v4-tool/pnpm-lock.yaml`.

```bash
cd qce-v4-tool
pnpm install --frozen-lockfile
pnpm build
pnpm exec playwright test
```

Playwright requires the mock server for API/UI smoke tests:

```bash
cd plugins/qq-chat-exporter
npm run mock:server
```

The current `lint` script uses a removed Next.js command; do not claim lint coverage until the script is repaired or an explicit replacement is established.

### Chunked viewer

```bash
cd qce-chunked-viewer
npm ci
npm run typecheck
npm run build
npm run sync
```

After syncing, verify the viewer asset in `qce-chunked-viewer/assets/` matches the embedded copy in `qq-chat-export-core/assets/`.

### Installer and uninstaller

```bash
cd installer
npm install
npm run lint
npm run build

cd ../uninstaller
npm install
npm run lint
npm run build
```

Tauri bundle validation is Windows/CI-specific unless the local host has the required target toolchain and WebView dependencies.

### Final repository checks

```bash
git diff --check
git status --short --branch
git diff --merge-base origin/master
```

Also inspect changed lockfiles and generated assets. Do not commit `.next/`, `dist/`, `target/`, temporary exports, or test credentials unless the path is intentionally tracked and regenerated by the documented workflow.

## 6. Release and packaging rules

- Never reuse or move an existing tag. A release correction requires a new version/tag because users and GitHub may retain stale artifacts.
- Before tagging, fetch remote tags and prove the candidate tag is unused.
- Version tags trigger `.github/workflows/release-plugin.yml`; package versions are synchronized from the tag by `scripts/sync-version.js`.
- Release packaging has separate Shell, Framework, plugin-store, installer, and Docker paths. Changes to shared runtime/config staging must be checked in both `scripts/quick-pack.py` and `scripts/build-framework-plugin.py`, and usually `scripts/build-napcat-plugin.py`/`scripts/plugin_runtime.py`.
- The release job must download named release artifacts only. Do not download every workflow artifact: Docker Buildx may publish a `.dockerbuild` artifact that is not a release file and can break artifact download.
- Keep Rust cache `shared-key` values aligned between `build-plugin.yml` and `release-plugin.yml` (`qce-server-{platform}-{arch}`).
- Release assets expected by the release job include Windows/Linux Shell packages, Framework package, store plugin zip, and Windows installer.
- Do not announce a release until the tag exists remotely and the authoritative release workflow/release page confirms the expected artifacts.

## 7. Git and review discipline

- Branch from the actual intended base and fetch tags before release work.
- Never push directly to `master`/`main`.
- Keep commits focused and use the repository's conventional prefixes (`feat:`, `fix:`, `perf:`, `docs:`, `test:`, `chore:`).
- Do not amend published work or bypass hooks/checks.
- Never use destructive cleanup commands to hide unrelated changes.
- Review the merge-base diff, not only the latest commit.
- Preserve user changes and call out substantive merge conflicts instead of guessing.

## 8. Mandatory agent self-review

Before declaring work complete, answer these privately and turn each answer into an action:

1. **What worries me most?** Identify the highest-impact plausible regression (data loss, path/security boundary, format compatibility, release artifact, concurrency, or UI workflow). Add a test, inspect the relevant call chain, or run the closest authoritative check.
2. **What did I do least well or not prove?** Identify the requested item with the weakest evidence. Complete it, or explicitly report the exact gap and why it could not be verified.

Completion is not “the code compiles.” It means every requested item is accounted for, generated consumers are synchronized, relevant checks ran, and the final diff contains no unexplained changes.
