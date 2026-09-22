// Run: node --experimental-vm-modules --test scripts/napcat-launcher/tests/macos-loader.test.cjs
// Execute the actual generated loader with isolated Electron/Node boundaries.
// No QQ account, QQ files, subprocess signals, or third-party packages are used.
'use strict';

const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { pathToFileURL } = require('node:url');
const vm = require('node:vm');

const launcher = fs.readFileSync(path.join(__dirname, '..', 'launcher-user.sh'), 'utf8');
const loader = launcher.match(/<<'LOADER_EOF'\r?\n([\s\S]*?)\r?\nLOADER_EOF(?:\r?\n|$)/)?.[1];
assert.ok(loader, 'canonical launcher must contain its generated macOS loader');
assert.equal(typeof vm.SyntheticModule, 'function', 'run Node with --experimental-vm-modules');

const settle = async () => {
  // Drain dynamic-import jobs and continuations without real shutdown delays.
  for (let i = 0; i < 4; i++) await new Promise(resolve => setImmediate(resolve));
};

function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}

function createHarness(options = {}) {
  const { cleanup = async () => {}, startupError, bridge = true, pluginLoaded = true, modernShutdown = false } = options;
  const entry = Object.hasOwn(options, 'entry') ? options.entry : '1';
  const events = [];
  const imports = [];
  const timers = new Map();
  const intervals = new Set();
  const app = new EventEmitter();
  const processMock = new EventEmitter();
  processMock.pid = 12345;
  processMock.platform = 'darwin';
  processMock.argv = ['mock-qq'];
  processMock.env = {
    NAPCAT_WORKDIR: '/mock/qce',
    QCE_NAPCAT_MJS_PATH: '/mock/qce/napcat.mjs',
    ...(entry === undefined ? {} : { QCE_NAPCAT_ENTRY: entry }),
  };
  const terminal = (method, code) => events.push({ type: 'exit', method, code });
  app.exit = code => terminal('app.exit', code ?? 0);
  processMock.exit = () => assert.fail('shutdown must use Electron app.exit');
  processMock.reallyExit = () => assert.fail('shutdown must use Electron app.exit');
  processMock.kill = () => assert.fail('shutdown must not send process signals');
  app.commandLine = {
    appendSwitch: (...args) => events.push({ type: 'switch', args }),
  };
  app.disableHardwareAcceleration = () => events.push({ type: 'disable-gpu' });

  // NapCat owns this export object from its cache-busted module import. Only
  // this cached instance has the live QCE server state that cleanup must use.
  const pluginState = { running: true };
  const cachedExports = {
    async plugin_cleanup(receivedContext) {
      assert.equal(this, cachedExports, 'cleanup must run on the cached plugin exports');
      assert.equal(receivedContext, pluginContext, 'cleanup must receive the live plugin context');
      events.push({ type: 'cleanup-start' });
      await cleanup();
      pluginState.running = false;
      events.push({ type: 'cleanup-finish' });
    },
  };
  const pluginContext = {
    pluginName: 'mock-qce-live-plugin',
    getPluginExports(name) {
      assert.equal(this, pluginContext, 'export lookup must preserve its context receiver');
      assert.equal(name, this.pluginName, 'lookup must use the live context plugin name');
      events.push({ type: 'plugin-lookup', name });
      return pluginLoaded ? cachedExports : undefined;
    },
  };

  const bridgeValue = {
    pluginContext,
    ...(modernShutdown ? {
      async shutdown() {
        events.push({ type: 'shutdown-start' });
        await cleanup();
        events.push({ type: 'shutdown-finish' });
      },
    } : {}),
  };
  const context = vm.createContext({
    ...(bridge ? { __NAPCAT_BRIDGE__: bridgeValue } : {}),
    process: processMock,
    require(specifier) {
      if (specifier === 'electron') return { app };
      if (specifier === 'url' || specifier === 'node:url') return require('node:url');
      if (specifier === 'path' || specifier === 'node:path') return path;
      assert.fail(`unexpected require (must not load desktop QQ): ${specifier}`);
    },
    console: Object.fromEntries(['log', 'error', 'warn'].map(level => [level,
      (...args) => events.push({ type: 'log', level, message: args.join(' ') }),
    ])),
    setTimeout(callback, delay) {
      const timer = { unref() { return this; } };
      timers.set(timer, { callback, delay });
      return timer;
    },
    clearTimeout(timer) { timers.delete(timer); },
    setInterval() {
      const timer = {};
      intervals.add(timer);
      return timer;
    },
    clearInterval(timer) { intervals.delete(timer); },
  });
  const napcatURL = pathToFileURL(processMock.env.QCE_NAPCAT_MJS_PATH).href;
  const script = new vm.Script(loader, {
    filename: 'generated-macos-loader.js',
    async importModuleDynamically(specifier) {
      imports.push(specifier);
      assert.equal(specifier, napcatURL,
        'only NapCat may be imported: a second plugin import would lose the live server instance');
      if (startupError) throw startupError;
      const module = new vm.SyntheticModule([], function () {}, { context, identifier: specifier });
      await module.link(() => assert.fail('mock modules have no dependencies'));
      await module.evaluate();
      return module;
    },
  });
  script.runInContext(context, { timeout: 1000 });
  return {
    app, events, imports, intervals, napcatURL, pluginContext, pluginState, processMock, timers,
    exits: () => events.filter(event => event.type === 'exit'),
  };
}

for (const entry of [undefined, '', '0']) {
  test(`direct app opening without the launcher gate (${String(entry)}) never loads QQ or NapCat`, async () => {
    const harness = createHarness({ entry });
    await settle();
    assert.deepEqual(harness.imports, []);
    assert.equal(harness.events.some(event => event.type === 'cleanup-start'), false);
    assert.equal(harness.processMock.listenerCount('SIGTERM'), 0);
    assert.deepEqual(harness.exits(), [{ type: 'exit', method: 'app.exit', code: 0 }]);
  });
}

test('repeated signals and app quit share one cleanup, completed before exit', async () => {
  const cleaning = deferred();
  const harness = createHarness({ cleanup: () => cleaning.promise });
  await settle();
  assert.deepEqual(harness.imports, [harness.napcatURL]);
  harness.processMock.emit('SIGTERM');
  await settle();
  for (const signal of ['SIGTERM', 'SIGINT', 'SIGHUP']) harness.processMock.emit(signal);
  let prevented = false;
  harness.app.emit('before-quit', { preventDefault() { prevented = true; } });
  await settle();
  assert.equal(prevented, true);
  assert.equal(harness.events.filter(event => event.type === 'cleanup-start').length, 1);
  assert.equal(harness.events.filter(event => event.type === 'plugin-lookup').length, 1);
  assert.deepEqual(harness.imports, [harness.napcatURL], 'must reuse the running plugin without re-importing');
  assert.deepEqual(harness.exits(), [], 'must wait while plugin cleanup is outstanding');

  cleaning.resolve();
  await settle();
  assert.deepEqual(harness.exits(), [{ type: 'exit', method: 'app.exit', code: 0 }]);
  const finishIndex = harness.events.findIndex(event => event.type === 'cleanup-finish');
  const exitIndex = harness.events.findIndex(event => event.type === 'exit');
  assert.ok(finishIndex >= 0 && finishIndex < exitIndex, 'plugin cleanup must finish before exit');
  assert.equal(harness.pluginState.running, false, 'cleanup must stop the cached instance');
  assert.equal(harness.timers.size, 0, 'successful cleanup must cancel the shutdown deadline');
  assert.equal(harness.intervals.size, 0, 'successful cleanup must release the host keepalive');
});

test('cleanup failure is reported and keeps the owner alive rather than orphaning resources', async () => {
  const harness = createHarness({ cleanup: async () => { throw new Error('mock cleanup failure'); } });
  await settle();
  harness.processMock.emit('SIGTERM');
  await settle();
  assert.equal(harness.events.filter(event => event.type === 'cleanup-start').length, 1);
  assert.deepEqual(harness.exits(), []);
  assert.equal(harness.intervals.size, 1, 'failed cleanup must keep its owner alive');
  assert.ok(harness.events.some(event => event.type === 'log'
    && event.level === 'error' && event.message.includes('mock cleanup failure')));
  assert.equal(harness.timers.size, 0);
});

test('NapCat import failure still cleans up QCE before reporting failed startup', async () => {
  const harness = createHarness({ startupError: new Error('mock startup failure') });
  await settle();
  assert.deepEqual(harness.imports, [harness.napcatURL]);
  assert.deepEqual(harness.exits(), [{ type: 'exit', method: 'app.exit', code: 1 }]);
  const finishIndex = harness.events.findIndex(event => event.type === 'cleanup-finish');
  assert.ok(finishIndex >= 0 && finishIndex
    < harness.events.findIndex(event => event.type === 'exit'));
});

test('cleanup still pending after ten seconds retains the owner and can finish later', async () => {
  const cleaning = deferred();
  const harness = createHarness({ cleanup: () => cleaning.promise });
  await settle();
  harness.processMock.emit('SIGTERM');
  await settle();
  assert.equal(harness.events.filter(event => event.type === 'cleanup-start').length, 1);
  assert.deepEqual(harness.exits(), []);
  assert.equal(harness.timers.size, 1);
  const [timer, deadline] = harness.timers.entries().next().value;
  assert.equal(deadline.delay, 10000, 'slow cleanup has the documented ten-second warning');
  harness.timers.delete(timer); // A real setTimeout fires only once.
  deadline.callback();
  assert.deepEqual(harness.exits(), [], 'the warning cannot abandon pending resources');
  assert.equal(harness.intervals.size, 1);
  assert.equal(harness.events.some(event => event.type === 'cleanup-finish'), false);
  assert.ok(harness.events.some(event => event.type === 'log'
    && event.level === 'warn' && event.message.includes('still pending')));
  cleaning.resolve();
  await settle();
  assert.deepEqual(harness.exits(), [{ type: 'exit', method: 'app.exit', code: 0 }]);
  assert.equal(harness.intervals.size, 0);
  assert.ok(harness.events.findIndex(event => event.type === 'cleanup-finish')
    < harness.events.findIndex(event => event.type === 'exit'));
});

test('shutdown before the NapCat bridge exists does not import a fresh plugin', async () => {
  const harness = createHarness({ bridge: false });
  await settle();
  harness.processMock.emit('SIGTERM');
  await settle();
  assert.deepEqual(harness.imports, [harness.napcatURL]);
  assert.equal(harness.events.some(event => event.type === 'plugin-lookup'), false);
  assert.equal(harness.events.some(event => event.type === 'cleanup-start'), false);
  assert.deepEqual(harness.exits(), [{ type: 'exit', method: 'app.exit', code: 0 }]);
  assert.equal(harness.timers.size, 0);
});

test('shutdown when the plugin is not loaded exits without manufacturing a plugin instance', async () => {
  const harness = createHarness({ pluginLoaded: false });
  await settle();
  harness.processMock.emit('SIGINT');
  await settle();
  assert.deepEqual(harness.imports, [harness.napcatURL]);
  assert.deepEqual(harness.events.filter(event => event.type === 'plugin-lookup'), [
    { type: 'plugin-lookup', name: harness.pluginContext.pluginName },
  ]);
  assert.equal(harness.events.some(event => event.type === 'cleanup-start'), false);
  assert.deepEqual(harness.exits(), [{ type: 'exit', method: 'app.exit', code: 0 }]);
  assert.equal(harness.timers.size, 0);
});


test('shutdown hook is awaited even before NapCat marks the plugin loaded', async () => {
  const initializing = deferred();
  const harness = createHarness({ modernShutdown: true, pluginLoaded: false,
    cleanup: () => initializing.promise });
  await settle();
  harness.processMock.emit('SIGTERM');
  harness.processMock.emit('SIGINT');
  await settle();
  assert.equal(harness.events.filter(event => event.type === 'shutdown-start').length, 1);
  assert.equal(harness.events.some(event => event.type === 'plugin-lookup'), false);
  assert.deepEqual(harness.exits(), [], 'initializing plugins must finish shutdown before QQ exits');
  initializing.resolve();
  await settle();
  assert.deepEqual(harness.exits(), [{ type: 'exit', method: 'app.exit', code: 0 }]);
  assert.ok(harness.events.findIndex(event => event.type === 'shutdown-finish')
    < harness.events.findIndex(event => event.type === 'exit'));
});

test('shutdown hook errors retain the owner without calling a second cleanup path', async () => {
  const harness = createHarness({ modernShutdown: true,
    cleanup: async () => { throw new Error('service did not stop'); } });
  await settle();
  harness.processMock.emit('SIGHUP');
  await settle();
  assert.deepEqual(harness.exits(), []);
  assert.equal(harness.intervals.size, 1);
  assert.equal(harness.events.some(event => event.type === 'plugin-lookup'), false);
  assert.ok(harness.events.some(event => event.type === 'log'
    && event.message.includes('service did not stop')));
});

test('startup cleanup exceeding the warning duration still completes before host exit', async () => {
  const initializing = deferred();
  const harness = createHarness({ modernShutdown: true, pluginLoaded: false,
    cleanup: () => initializing.promise });
  await settle();
  harness.processMock.emit('SIGTERM');
  await settle();
  const [timer, warning] = harness.timers.entries().next().value;
  harness.timers.delete(timer);
  warning.callback();
  harness.processMock.emit('SIGINT');
  assert.deepEqual(harness.exits(), []);
  assert.equal(harness.intervals.size, 1);
  assert.equal(harness.events.filter(event => event.type === 'shutdown-start').length, 1);
  initializing.resolve();
  await settle();
  assert.deepEqual(harness.exits(), [{ type: 'exit', method: 'app.exit', code: 0 }]);
  assert.equal(harness.intervals.size, 0);
  assert.ok(harness.events.findIndex(event => event.type === 'shutdown-finish')
    < harness.events.findIndex(event => event.type === 'exit'));
});
