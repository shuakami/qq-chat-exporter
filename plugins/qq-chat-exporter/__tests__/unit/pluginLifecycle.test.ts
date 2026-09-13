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
import { getEventListeners } from 'node:events';

const [scenario, entryPath] = process.argv.slice(1);
const entryURL = pathToFileURL(entryPath).href;
const launcherURL = new URL('./runtime/ApiLauncher.mjs', entryURL).href;
const rustURL = new URL('./runtime/rustBridge.mjs', entryURL).href;
const events = [];
const plans = [];
const servers = [];
const logs = [];
const context = vm.createContext({
  AbortController,
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
class StartupCleanupError extends AggregateError {
  constructor(startError, cleanupError) {
    super([startError, cleanupError], 'mock startup cleanup failed', { cause: startError });
  }
}
async function startRustApiServer(core, _frontendPath, { signal } = {}) {
  signal?.throwIfAborted();
  assert.equal(core.apis.GroupApi.owner, core.name, 'a pending init must not borrow the reloaded bridge APIs');
  const plan = plans.shift() || {};
  if (plan.missingBinary) throw new Error('mock binary missing');
  const server = { name: core.name, state: 'starting', stopCalls: 0 };
  servers.push(server);
  events.push('start:' + server.name);
  let stopPromise;
  const stop = () => stopPromise ||= Promise.resolve().then(async () => {
    server.stopCalls++;
    events.push('stop:' + server.name);
    if (plan.stopGate) await plan.stopGate.promise;
    if (plan.stopError) throw new Error(plan.stopError);
    server.state = 'stopped';
  });
  try {
    if (plan.startGate) await new Promise((resolve, reject) => {
      const onAbort = () => reject(signal.reason);
      signal.addEventListener('abort', onAbort, { once: true });
      plan.startGate.promise.then(resolve, reject);
      if (signal.aborted) onAbort();
      plan.removeAbort = () => signal.removeEventListener('abort', onAbort);
    }).finally(() => plan.removeAbort());
    signal?.throwIfAborted();
    if (plan.startError) throw new Error(plan.startError);
    server.state = 'running';
    return { stop };
  } catch (error) {
    try { await stop(); } catch (cleanupError) {
      throw new StartupCleanupError(error, cleanupError);
    }
    throw error;
  }
}

const modules = new Map();
async function getModule(url) {
  if (modules.has(url)) return modules.get(url);
  let module;
  if (url === rustURL) {
    module = new vm.SyntheticModule(['startRustApiServer', 'StartupCleanupError'], function () {
      this.setExport('StartupCleanupError', StartupCleanupError);
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
  assert.equal(servers[0].stopCalls, 0, 'shutdown publishes its cached promise before performing cleanup');
  await Promise.all([init, stop]);
  assert.ok(!logs.some(log => log.level === 'error'), 'expected cancellation is not an initialization error');
  assert.equal(servers[0].state, 'stopped');
  assert.equal(servers[0].stopCalls, 1);
  assert.deepEqual(events, ['start:one', 'stop:one']);
  assert.equal(context.__NAPCAT_BRIDGE__, undefined);
} else if (scenario === 'immediate-stop') {
  const init = entry.plugin_init(makeContext('one'));
  const stop = context.__NAPCAT_BRIDGE__.shutdown();
  await Promise.all([init, stop]);
  assert.equal(servers.length, 0, 'cancel before import must not spawn a server');
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
  await assert.rejects(entry.plugin_init(makeContext('one')), /mock start failed/);
  const bridge = context.__NAPCAT_BRIDGE__;
  await bridge.shutdown();
  assert.equal(servers[0].stopCalls, 1, 'runtime cleaned the failed startup before rejecting');
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
  await assert.rejects(reloaded.plugin_init(makeContext('new')), /old server did not stop/);
  assert.equal(servers.length, 1, 'do not start another server after replacement cleanup fails');
  await assert.rejects(oldBridge.shutdown(), /old server did not stop/);
  await assert.rejects(reloaded.plugin_cleanup(), /old server did not stop/);
} else if (scenario === 'same-module-reload') {
  const oldContext = makeContext('old');
  const newContext = makeContext('new');
  const oldInit = entry.plugin_init(oldContext);
  await oldInit;
  const newInit = entry.plugin_init(newContext);
  await Promise.all([oldInit, newInit]);
  const newBridge = context.__NAPCAT_BRIDGE__;
  await entry.plugin_cleanup(oldContext);
  assert.equal(context.__NAPCAT_BRIDGE__, newBridge, 'old context cannot clean up the newer cached module instance');
  assert.equal(servers[1].state, 'running');
  await entry.plugin_cleanup(newContext);
  assert.equal(servers[1].state, 'stopped');
} else if (scenario === 'missing-binary') {
  plans.push({ missingBinary: true });
  await assert.rejects(entry.plugin_init(makeContext('one')), /mock binary missing/);
  await entry.plugin_cleanup();
  assert.equal(servers.length, 0);
  assert.equal(context.__NAPCAT_BRIDGE__, undefined);
} else if (scenario === 'cancel-cleanup-error') {
  plans.push({ startGate: deferred(), stopError: 'child remained alive' });
  const init = entry.plugin_init(makeContext('one'));
  const rejectedInit = assert.rejects(init, error => {
    assert.ok(error instanceof StartupCleanupError);
    assert.equal(error.errors[0].name, 'AbortError');
    assert.match(error.errors[1].message, /child remained alive/);
    return true;
  });
  await tickUntil(() => servers.length === 1);
  const bridge = context.__NAPCAT_BRIDGE__;
  await assert.rejects(bridge.shutdown(), StartupCleanupError);
  await rejectedInit;
  assert.equal(servers[0].stopCalls, 1);
  assert.equal(context.__NAPCAT_BRIDGE__, bridge);
} else if (scenario === 'start-cleanup-error') {
  plans.push({ startError: 'readiness failed', stopError: 'child remained alive' });
  await assert.rejects(entry.plugin_init(makeContext('one')), StartupCleanupError);
  const bridge = context.__NAPCAT_BRIDGE__;
  await assert.rejects(bridge.shutdown(), error => {
    assert.match(error.errors[0].message, /readiness failed/);
    assert.match(error.errors[1].message, /child remained alive/);
    return true;
  });
  assert.equal(context.__NAPCAT_BRIDGE__, bridge);
} else if (scenario === 'cancel-waits-cleanup') {
  const stopGate = deferred();
  plans.push({ startGate: deferred(), stopGate });
  const init = entry.plugin_init(makeContext('one'));
  await tickUntil(() => servers.length === 1);
  const bridge = context.__NAPCAT_BRIDGE__;
  let stopped = false;
  const stop = bridge.shutdown().then(() => { stopped = true; });
  await tickUntil(() => servers[0].stopCalls === 1);
  assert.equal(stopped, false, 'abort is not proof of child exit');
  assert.equal(context.__NAPCAT_BRIDGE__, bridge);
  stopGate.resolve();
  await Promise.all([init, stop]);
  assert.equal(context.__NAPCAT_BRIDGE__, undefined);
} else if (scenario === 'direct-launcher-stop') {
  const module = await getModule(launcherURL);
  if (module.status === 'unlinked') await module.link(linker);
  if (module.status === 'linked') await module.evaluate();
  const launcher = new module.namespace.QQChatExporterApiLauncher(makeContext('direct').core);
  plans.push({ startGate: deferred() });
  const start = launcher.startApiServer();
  const rejectedStart = assert.rejects(start, { name: 'AbortError' });
  await tickUntil(() => servers.length === 1);
  const stop = launcher.stopApiServer();
  assert.equal(launcher.stopApiServer(), stop);
  await stop;
  await rejectedStart;
  assert.equal(launcher.isRunning, false);
  assert.equal(servers[0].state, 'stopped');
  await launcher.startApiServer();
  assert.equal(launcher.isRunning, true, 'a fully stopped launcher can start a new run');
  await launcher.stopApiServer();
} else if (scenario === 'external-signal') {
  const module = await getModule(launcherURL);
  if (module.status === 'unlinked') await module.link(linker);
  if (module.status === 'linked') await module.evaluate();
  const launcher = new module.namespace.QQChatExporterApiLauncher(makeContext('direct').core);
  const controller = new AbortController();
  const reason = new Error('caller cancelled startup');
  plans.push({ startGate: deferred() });
  const start = launcher.startApiServer({ signal: controller.signal });
  const rejectedStart = assert.rejects(start, error => error === reason);
  await tickUntil(() => servers.length === 1);
  controller.abort(reason);
  await rejectedStart;
  await launcher.stopApiServer();
  assert.equal(getEventListeners(controller.signal, 'abort').length, 0);
  assert.equal(servers[0].stopCalls, 1);
  assert.equal(launcher.isRunning, false);
  const preCancelled = new AbortController();
  preCancelled.abort(reason);
  await assert.rejects(launcher.startApiServer({ signal: preCancelled.signal }), error => error === reason);
  await launcher.stopApiServer();
  assert.equal(servers.length, 1, 'an already aborted signal cannot start a second server');
} else if (scenario === 'ready-logger-error' || scenario === 'ready-logger-cleanup-error') {
  const pluginContext = makeContext('one');
  const loggerError = new Error('host logger failed');
  pluginContext.core.context.logger.log = () => { throw loggerError; };
  if (scenario === 'ready-logger-cleanup-error') plans.push({ stopError: 'ready server remained alive' });
  const initialization = entry.plugin_init(pluginContext);
  const bridge = context.__NAPCAT_BRIDGE__;
  if (scenario === 'ready-logger-error') {
    await assert.rejects(initialization, error => error === loggerError);
    assert.equal(servers[0].state, 'stopped', 'ready server must stop before init rejects');
    await bridge.shutdown();
    assert.equal(context.__NAPCAT_BRIDGE__, undefined);
  } else {
    await assert.rejects(initialization, error => {
      assert.ok(error instanceof StartupCleanupError);
      assert.equal(error.errors[0], loggerError);
      assert.match(error.errors[1].message, /ready server remained alive/);
      return true;
    });
    await assert.rejects(bridge.shutdown(), StartupCleanupError);
    assert.equal(context.__NAPCAT_BRIDGE__, bridge);
  }
  assert.equal(servers[0].stopCalls, 1);
} else if (scenario === 'empty-cleanup') {
  await entry.plugin_cleanup();
  assert.equal(servers.length, 0);
} else {
  assert.fail('unknown scenario');
}
process.stdout.write('LIFECYCLE_OK');
`;

const scenarios = {
    'startup-stop': 'shutdown cancels pending startup and confirms cleanup before NapCat marks the instance loaded',
    'immediate-stop': 'shutdown is safe immediately after plugin_init returns its pending promise',
    'stop-error': 'real launcher stop errors reach both shutdown and plugin_cleanup callers',
    'start-error': 'failed initialization settles and cleanup does not hang',
    'reload': 'overlapping cache-busted reload waits for the old server and preserves its own bridge',
    'reload-stop-error': 'failed old cleanup prevents the replacement from starting another server',
    'same-module-reload': 'late cleanup with an old context cannot stop a newer instance of the same cached module',
    'missing-binary': 'missing binary rejects initialization but permits safe shutdown without a child',
    'cancel-cleanup-error': 'cleanup failure during cancellation rejects init and remains visible to shutdown',
    'start-cleanup-error': 'startup and cleanup failures are both preserved',
    'cancel-waits-cleanup': 'cancellation waits for owned resource cleanup to finish',
    'direct-launcher-stop': 'direct launcher stop cancels startup and allows restart only after cleanup',
    'external-signal': 'external cancellation preserves its reason and removes listeners after cleanup',
    'ready-logger-error': 'a host logger failure after readiness cleans the server before init rejects',
    'ready-logger-cleanup-error': 'cleanup failure after a host logger error stays visible to shutdown',
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
