# QCE Plugin Test Harness

The production plugin is a thin ESM bridge that starts `qce-server`. Export,
parser, resource, persistence, and API behavior belongs in the Rust crates and
must be tested there.

## Local checks

```bash
cd plugins/qq-chat-exporter
npm ci
npm run gen:overlay
npm run typecheck
npm test
npm run test:entrypoint
npm run test:context
```

`npm test` covers the shipped entrypoint, NapCat argument normalization, overlay
proxy, Rust RPC bridge serialization, launcher platform selection, and shared
frontend helpers. It must not reintroduce tests against the removed TypeScript
exporter.

`npm run test:runtime` starts the production launcher and requires a built
`qq-chat-export-server/target/release/qce-server`.

## Mock API server

```bash
cd qq-chat-export-server
cargo build --release

cd ../plugins/qq-chat-exporter
npm run mock:server
```

The mock server injects `MockNapCatCore` through the production bridge and
starts the Rust API server without a QQ login. Scenarios are selected with
`QCE_MOCK_SCENARIO=default|private|group|recall|forward|volume|deactivated`.

When adding exporter or parser behavior, add focused Rust tests under
`qq-chat-export-core/tests/` or the relevant `qq-chat-export-server` module.
