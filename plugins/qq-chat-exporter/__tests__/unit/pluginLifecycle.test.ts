import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

// Run the real entrypoint and ApiLauncher in a separate VM. Only the Rust
// bridge module is replaced: these tests cannot spawn qce-server, reclaim
// ports, or touch the user's configuration, even if a release binary exists.
// A child provides VM-module support on the project's Node 20/22 CI runners
// without requiring experimental flags for the rest of the test suite.
const isolatedTest = String.raw`
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';
import vm from 'node:vm';

const [scenario, entryPath] = process.argv.slice(1);
const entryURL = pathToFileURL(entryPath).href;
const launcherURL = new URL('./runtime/ApiLauncher.mjs', entryURL).href;
const rustURL = new URL('./runtime/rustBridge.mjs', entryURL).href;
const events = [];
const plans = [];
const servers = [];
const logs = [];
const context = vm.createContext({
  process: { env: {}, versions: process.versions, platform: process.platform, arch: process.arch },
  console: Object.fromEntries(['log', 'error', 'warn', 'debug'].map(level => [level,
    (...args) => logs.push({ level, text: args.map(String).join(' ') })])),
});

function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}
async function tickUntil(predicate) {
  for (let i = 0; i < 30 && !predicate(); i++) await new Promise(resolve => setImmediate(resolve));
  assert.ok(predicate(), 'expected mocked lifecycle step was not reached');
}
function makeContext(name) {
  return {
    pluginName: name,
    getPluginExports: () => undefined, // NapCat does not mark it loaded until init settles.
    core: { name, apis: { GroupApi: { owner: name } }, context: {
      workingEnv: 1,
      logger: { log() {}, logError() {}, logWarn() {}, logDebug() {} },
    } },
  };
}
async function startRustApiServer(core) {
  assert.equal(core.apis.GroupApi.owner, core.name, 'a pending init must not borrow the reloaded bridge APIs');
  const plan = plans.shift() || {};
  const server = { name: core.name, state: 'starting', stopCalls: 0 };
  servers.push(server);
  events.push('start:' + server.name);
  if (plan.startGate) await plan.startGate.promise;
  if (plan.startError) throw new Error(plan.startError);
  server.state = 'running';
  return {
    async stop() {
      server.stopCalls++;
      events.push('stop:' + server.name);
      if (plan.stopGate) await plan.stopGate.promise;
      if (plan.stopError) throw new Error(plan.stopError);
      server.state = 'stopped';
    },
  };
}

const modules = new Map();
async function getModule(url) {
  if (modules.has(url)) return modules.get(url);
  let module;
  if (url === rustURL) {
    module = new vm.SyntheticModule(['startRustApiServer'], function () {
      this.setExport('startRustApiServer', startRustApiServer);
    }, { context, identifier: url });
  } else if (url.startsWith('node:')) {
    assert.ok(['node:fs', 'node:path', 'node:url'].includes(url), 'unexpected builtin: ' + url);
    const exports = await import(url);
    module = new vm.SyntheticModule(Object.keys(exports), function () {
      for (const [name, value] of Object.entries(exports)) this.setExport(name, value);
    }, { context, identifier: url });
  } else {
    const sourceURL = new URL(url);
    sourceURL.search = '';
    assert.ok([entryURL, launcherURL].includes(sourceURL.href), 'unmocked production module: ' + url);
    module = new vm.SourceTextModule(fs.readFileSync(sourceURL, 'utf8'), {
      context, identifier: url,
      initializeImportMeta(meta) { meta.url = sourceURL.href; },
      async importModuleDynamically(specifier, reference) {
        const imported = await getModule(new URL(specifier, reference.identifier).href);
        if (imported.status === 'unlinked') await imported.link(linker);
        if (imported.status === 'linked') await imported.evaluate();
        return imported;
      },
    });
  }
  modules.set(url, module);
  return module;
}
async function linker(specifier, reference) {
  return getModule(specifier.startsWith('node:') ? specifier : new URL(specifier, reference.identifier).href);
}
async function loadEntry(suffix = '') {
  const module = await getModule(entryURL + suffix);
  await module.link(linker);
  await module.evaluate();
  return module.namespace;
}
const entry = await loadEntry();

if (scenario === 'startup-stop') {
  const startGate = deferred();
  plans.push({ startGate });
  const init = entry.plugin_init(makeContext('one'));
  const bridge = context.__NAPCAT_BRIDGE__;
  assert.equal(typeof bridge.shutdown, 'function', 'hook must be published before the first await');
  await tickUntil(() => servers.length === 1);
  assert.equal(bridge.pluginContext.getPluginExports(), undefined);
  const stop = bridge.shutdown();
  assert.equal(bridge.shutdown(), stop, 'shutdown must return its original promise');
  assert.equal(entry.plugin_cleanup(), stop, 'NapCat cleanup must use the same instance and promise');
  assert.equal(servers[0].stopCalls, 0, 'stop must wait until start returns its server handle');
  startGate.resolve();
  await Promise.all([init, stop]);
  assert.equal(servers[0].state, 'stopped');
  assert.equal(servers[0].stopCalls, 1);
  assert.deepEqual(events, ['start:one', 'stop:one']);
  assert.equal(context.__NAPCAT_BRIDGE__, undefined);
} else if (scenario === 'immediate-stop') {
  const init = entry.plugin_init(makeContext('one'));
  const stop = context.__NAPCAT_BRIDGE__.shutdown();
  await Promise.all([init, stop]);
  assert.equal(servers[0].state, 'stopped');
  assert.equal(servers[0].stopCalls, 1);
} else if (scenario === 'stop-error') {
  plans.push({ stopError: 'mock stop failed' });
  await entry.plugin_init(makeContext('one'));
  const bridge = context.__NAPCAT_BRIDGE__;
  const stop = bridge.shutdown();
  await assert.rejects(stop, /mock stop failed/);
  assert.equal(entry.plugin_cleanup(), stop);
  await assert.rejects(entry.plugin_cleanup(), /mock stop failed/);
  assert.equal(servers[0].stopCalls, 1);
  assert.equal(context.__NAPCAT_BRIDGE__, bridge, 'failed cleanup must remain discoverable');
} else if (scenario === 'start-error') {
  plans.push({ startError: 'mock start failed' });
  await entry.plugin_init(makeContext('one'));
  const bridge = context.__NAPCAT_BRIDGE__;
  await bridge.shutdown();
  assert.equal(servers[0].stopCalls, 0, 'failed startup never produced a server handle');
  assert.equal(context.__NAPCAT_BRIDGE__, undefined);
  assert.ok(logs.some(log => log.text.includes('mock start failed')));
} else if (scenario === 'reload') {
  const startGate = deferred();
  plans.push({ startGate });
  const oldInit = entry.plugin_init(makeContext('old'));
  const oldBridge = context.__NAPCAT_BRIDGE__;
  await tickUntil(() => servers.length === 1);
  const reloaded = await loadEntry('?reload=2');
  const newInit = reloaded.plugin_init(makeContext('new'));
  const newBridge = context.__NAPCAT_BRIDGE__;
  assert.notEqual(newBridge, oldBridge);
  assert.equal(servers.length, 1, 'replacement cannot start before the old instance stops');
  startGate.resolve();
  await Promise.all([oldInit, newInit]);
  assert.deepEqual(events, ['start:old', 'stop:old', 'start:new']);
  await entry.plugin_cleanup();
  await oldBridge.shutdown();
  assert.equal(context.__NAPCAT_BRIDGE__, newBridge, 'late old cleanup cannot delete the replacement bridge');
  assert.equal(servers[1].state, 'running');
  await reloaded.plugin_cleanup();
  assert.equal(servers[1].state, 'stopped');
  assert.equal(context.__NAPCAT_BRIDGE__, undefined);
} else if (scenario === 'reload-stop-error') {
  plans.push({ stopError: 'old server did not stop' });
  await entry.plugin_init(makeContext('old'));
  const oldBridge = context.__NAPCAT_BRIDGE__;
  const reloaded = await loadEntry('?reload=2');
  await reloaded.plugin_init(makeContext('new'));
  assert.equal(servers.length, 1, 'do not start another server after replacement cleanup fails');
  await assert.rejects(oldBridge.shutdown(), /old server did not stop/);
  await assert.rejects(reloaded.plugin_cleanup(), /old server did not stop/);
} else if (scenario === 'same-module-reload') {
  const oldContext = makeContext('old');
  const newContext = makeContext('new');
  const oldInit = entry.plugin_init(oldContext);
  const newInit = entry.plugin_init(newContext);
  await Promise.all([oldInit, newInit]);
  const newBridge = context.__NAPCAT_BRIDGE__;
  await entry.plugin_cleanup(oldContext);
  assert.equal(context.__NAPCAT_BRIDGE__, newBridge, 'old context cannot clean up the newer cached module instance');
  assert.equal(servers[1].state, 'running');
  await entry.plugin_cleanup(newContext);
  assert.equal(servers[1].state, 'stopped');
} else if (scenario === 'empty-cleanup') {
  await entry.plugin_cleanup();
  assert.equal(servers.length, 0);
} else {
  assert.fail('unknown scenario');
}
process.stdout.write('LIFECYCLE_OK');
`;

const scenarios = {
    'startup-stop': 'shutdown waits for startup and stops the real instance once before NapCat marks it loaded',
    'immediate-stop': 'shutdown is safe immediately after plugin_init returns its pending promise',
    'stop-error': 'real launcher stop errors reach both shutdown and plugin_cleanup callers',
    'start-error': 'failed initialization settles and cleanup does not hang',
    'reload': 'overlapping cache-busted reload waits for the old server and preserves its own bridge',
    'reload-stop-error': 'failed old cleanup prevents the replacement from starting another server',
    'same-module-reload': 'late cleanup with an old context cannot stop a newer instance of the same cached module',
    'empty-cleanup': 'cleanup before initialization has no side effects',
};

for (const [scenario, title] of Object.entries(scenarios)) {
    test(title, { timeout: 10_000 }, () => {
        const output = execFileSync(process.execPath, [
            '--experimental-vm-modules', '--input-type=module', '-e', isolatedTest,
            scenario, fileURLToPath(new URL('../../index.mjs', import.meta.url)),
        ], { encoding: 'utf8', timeout: 8_000, stdio: ['ignore', 'pipe', 'pipe'] });
        assert.equal(output, 'LIFECYCLE_OK');
    });
}
