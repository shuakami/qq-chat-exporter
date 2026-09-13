import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

// Execute the production Rust startup module, replacing every I/O boundary.
// No QCE binary, native module, real socket, configuration, or port-owner
// command can be reached, even when the checkout contains a release build.
const isolatedTest = String.raw`
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { EventEmitter, getEventListeners } from 'node:events';
import { pathToFileURL } from 'node:url';
import vm from 'node:vm';

const [scenario, sourcePath] = process.argv.slice(1);
const sourceURL = pathToFileURL(sourcePath).href;
const events = [];
const children = [];
const sockets = [];
const bridges = [];
const timers = new Map();
const plan = {};
const controller = new AbortController();
const reason = new Error('test startup cancelled');
function setTimer(callback, delay) {
  const timer = { callback, delay };
  timers.set(timer, timer);
  return timer;
}
function clearTimer(timer) { timers.delete(timer); }
function fireTimer(delay) {
  const timer = [...timers.values()].find(timer => timer.delay === delay);
  assert.ok(timer, 'expected active timer: ' + delay);
  timers.delete(timer);
  timer.callback();
}
async function tickUntil(predicate) {
  for (let i = 0; i < 30 && !predicate(); i++) await new Promise(resolve => setImmediate(resolve));
  assert.ok(predicate(), 'mock lifecycle step was not reached');
}
class FakeChild extends EventEmitter {
  constructor() {
    super();
    this.pid = plan.spawnError ? undefined : 12345;
    this.exitCode = null;
    this.signalCode = null;
    this.stdout = new EventEmitter();
    this.stderr = new EventEmitter();
    this.killCalls = 0;
  }
  exit(code = null, signal = 'SIGTERM') {
    this.exitCode = code;
    this.signalCode = signal;
    events.push('child-exit');
    this.emit('exit', code, signal);
  }
  kill(signal) {
    assert.equal(signal, 'SIGTERM', 'cleanup must never force kill');
    this.killCalls++;
    events.push('child-kill');
    if (!plan.delayExit) this.exit();
    return true;
  }
}
class FakeSocket extends EventEmitter {
  destroyed = false;
  setTimeout(value) { this.timeout = value; return this; }
  destroy() { this.destroyed = true; return this; }
}
class FakeBridge extends EventEmitter {
  closeCalls = 0;
  listen(port, host) {
    assert.equal(port, 45001);
    assert.equal(host, '127.0.0.1');
    events.push('bridge-listen');
    if (!plan.delayBridge) queueMicrotask(() => this.emit('listening'));
  }
  address() { return { port: 45001 }; }
  close(callback) {
    this.closeCalls++;
    events.push('bridge-close');
    callback(plan.bridgeCloseError);
  }
}
const mocks = {
  'node:child_process': {
    spawn(command, args, options) {
      assert.equal(command, '/mock/qce-server', 'no external command may run');
      assert.equal(args.length, 0);
      assert.equal(options.env.QCE_BRIDGE_ENDPOINT, 'http://127.0.0.1:45001');
      if (plan.spawnThrows) throw plan.spawnThrows;
      const child = new FakeChild();
      children.push(child);
      events.push('spawn');
      if (plan.abortInSpawn) controller.abort(reason);
      if (plan.spawnError) queueMicrotask(() => child.emit('error', plan.spawnError));
      return child;
    },
  },
  'node:fs': {
    appendFileSync() {}, mkdirSync() {},
    existsSync(candidate) { return !plan.missingBinary && candidate === '/mock/qce-server'; },
    readFileSync() { return JSON.stringify({ accessToken: 'test-only-token' }); },
  },
  'node:http': {
    createServer() { const bridge = new FakeBridge(); bridges.push(bridge); return bridge; },
  },
  'node:net': { default: {
    createConnection(options) {
      assert.equal(options.port, 45002);
      assert.equal(options.host, '127.0.0.1');
      const socket = new FakeSocket();
      sockets.push(socket);
      return socket;
    },
  } },
};
const context = vm.createContext({
  AbortController, Buffer, setTimeout: setTimer, clearTimeout: clearTimer,
  console: { log() {}, error() {}, warn() {} },
  process: {
    env: {
      QCE_RUST_SERVER_PATH: '/mock/qce-server', QCE_NO_AUTO_OPEN: '1',
      QCE_LOG_DIR: '/mock/log', QCE_CONFIG_DIR: '/mock/config',
      QCE_BRIDGE_PORT: '45001', QCE_SERVER_PORT: '45002',
    },
    platform: process.platform, arch: process.arch, pid: process.pid,
    kill() { assert.fail('must never signal a real process'); },
  },
});
const module = new vm.SourceTextModule(fs.readFileSync(sourcePath, 'utf8'), {
  context, identifier: sourceURL, initializeImportMeta(meta) { meta.url = sourceURL; },
});
await module.link(async specifier => {
  assert.ok(specifier in mocks || ['node:os', 'node:path', 'node:url'].includes(specifier),
    'unmocked I/O import: ' + specifier);
  const exports = mocks[specifier] || await import(specifier);
  return new vm.SyntheticModule(Object.keys(exports), function () {
    for (const [name, value] of Object.entries(exports)) this.setExport(name, value);
  }, { context, identifier: specifier });
});
await module.evaluate();
const { startRustApiServer, StartupCleanupError } = module.namespace;
const core = { context: { logger: { log() {}, logError() {} } } };
function start() { return startRustApiServer(core, undefined, { signal: controller.signal }); }
function observe(promise) {
  const outcome = { settled: false };
  promise.then(value => { outcome.settled = true; outcome.value = value; },
    error => { outcome.settled = true; outcome.error = error; });
  return outcome;
}
function assertCleanPolling() {
  assert.equal(getEventListeners(controller.signal, 'abort').length, 0);
  for (const socket of sockets) {
    assert.equal(socket.destroyed, true);
    assert.equal(socket.timeout, 0);
    assert.equal(socket.listenerCount('connect'), 0);
    assert.equal(socket.listenerCount('error'), 0);
    assert.equal(socket.listenerCount('timeout'), 0);
  }
  // One permanent logging listener per event is intentional.
  for (const child of children) {
    assert.equal(child.listenerCount('exit'), 1);
    assert.equal(child.listenerCount('error'), 1);
  }
  assert.equal(timers.size, 0, 'poll/retry/shutdown timers must all be released');
}
if (scenario === 'pre-abort') {
  controller.abort(reason);
  await assert.rejects(start(), error => error === reason);
  assert.equal(bridges.length, 0);
  assert.equal(children.length, 0);
} else if (scenario === 'missing-binary') {
  plan.missingBinary = true;
  await assert.rejects(start(), /required but was not found/);
  assert.equal(bridges.length, 0);
  assert.equal(children.length, 0);
} else if (scenario === 'bridge-abort') {
  plan.delayBridge = true;
  const result = start();
  const outcome = observe(result);
  await tickUntil(() => bridges.length === 1);
  controller.abort(reason);
  assert.equal(outcome.settled, false);
  bridges[0].emit('listening');
  await assert.rejects(result, error => error === reason);
  assert.equal(children.length, 0);
  assert.equal(bridges[0].closeCalls, 1);
} else if (scenario === 'spawn-abort') {
  plan.abortInSpawn = true;
  await assert.rejects(start(), error => error === reason);
  assert.equal(sockets.length, 0, 'abort immediately after spawn skips readiness polling');
  assert.deepEqual(events, ['bridge-listen', 'spawn', 'child-kill', 'child-exit', 'bridge-close']);
} else if (scenario === 'pending-abort') {
  plan.delayExit = true;
  const result = start();
  const outcome = observe(result);
  await tickUntil(() => sockets.length === 1);
  controller.abort(reason);
  await tickUntil(() => children[0].killCalls === 1);
  assert.equal(outcome.settled, false, 'SIGTERM alone is not confirmed cleanup');
  assert.equal(bridges[0].closeCalls, 0);
  children[0].exit();
  await assert.rejects(result, error => error === reason);
  assert.deepEqual(events, ['bridge-listen', 'spawn', 'child-kill', 'child-exit', 'bridge-close']);
} else if (scenario === 'retry-abort') {
  const result = start();
  observe(result);
  await tickUntil(() => sockets.length === 1);
  sockets[0].emit('error', new Error('ECONNREFUSED'));
  assert.ok([...timers.values()].some(timer => timer.delay === 100));
  controller.abort(reason);
  await assert.rejects(result, error => error === reason);
  assert.equal(sockets.length, 1);
} else if (scenario === 'ready-stop') {
  const result = start();
  await tickUntil(() => sockets.length === 1);
  sockets[0].emit('connect');
  const server = await result;
  plan.delayExit = true;
  const stop = server.stop();
  const outcome = observe(stop);
  assert.equal(server.stop(), stop);
  await tickUntil(() => children[0].killCalls === 1);
  assert.equal(outcome.settled, false);
  children[0].exit();
  await stop;
  assert.equal(children[0].killCalls, 1);
  assert.equal(bridges[0].closeCalls, 1);
} else if (scenario === 'early-exit') {
  const result = start();
  observe(result);
  await tickUntil(() => sockets.length === 1);
  children[0].exit(1, null);
  await assert.rejects(result, /exited before startup/);
  assert.equal(children[0].killCalls, 0, 'an already exited child must not be signalled');
  assert.equal(bridges[0].closeCalls, 1);
} else if (scenario === 'spawn-throws' || scenario === 'spawn-error') {
  const error = new Error('mock spawn failure');
  if (scenario === 'spawn-throws') plan.spawnThrows = error;
  else plan.spawnError = error;
  await assert.rejects(start(), actual => actual === error);
  assert.equal(bridges[0].closeCalls, 1);
  if (children[0]) assert.equal(children[0].killCalls, 0, 'failed spawn has no process to signal');
} else if (scenario === 'timeout-cleanup' || scenario === 'timeout-cleanup-failure') {
  plan.delayExit = scenario === 'timeout-cleanup-failure';
  const result = start();
  observe(result);
  await tickUntil(() => sockets.length === 1);
  fireTimer(15000);
  if (plan.delayExit) {
    await tickUntil(() => children[0].killCalls === 1);
    fireTimer(2000);
    await assert.rejects(result, error => {
      assert.ok(error instanceof StartupCleanupError);
      assert.match(error.errors[0].message, /did not listen/);
      assert.match(error.errors[1].message, /did not exit/);
      assert.equal(error.cause, error.errors[0]);
      return true;
    });
  } else await assert.rejects(result, /did not listen/);
  assert.equal(bridges[0].closeCalls, 1);
} else if (scenario === 'abort-cleanup-failure' || scenario === 'both-cleanup-failures') {
  plan.bridgeCloseError = new Error('mock bridge close failed');
  plan.delayExit = scenario === 'both-cleanup-failures';
  const result = start();
  observe(result);
  await tickUntil(() => sockets.length === 1);
  controller.abort(reason);
  if (plan.delayExit) {
    await tickUntil(() => children[0].killCalls === 1);
    fireTimer(2000);
  }
  await assert.rejects(result, error => {
    assert.ok(error instanceof StartupCleanupError);
    assert.equal(error.errors[0], reason);
    if (plan.delayExit) {
      assert.match(error.errors[1].errors[0].message, /did not exit/);
      assert.equal(error.errors[1].errors[1], plan.bridgeCloseError);
    } else assert.equal(error.errors[1], plan.bridgeCloseError);
    return true;
  });
  assert.equal(bridges[0].closeCalls, 1);
} else assert.fail('unknown scenario: ' + scenario);
assertCleanPolling();
process.stdout.write('STARTUP_OK');
`;

const scenarios = {
    'pre-abort': 'pre-cancelled startup allocates no bridge or child',
    'missing-binary': 'missing binary fails without allocating startup resources',
    'bridge-abort': 'cancellation while binding closes the owned bridge before spawning',
    'spawn-abort': 'cancellation immediately after spawn cleans the child before polling readiness',
    'pending-abort': 'pending startup cancellation waits for child exit and then closes its bridge',
    'retry-abort': 'cancellation clears a pending readiness retry and releases socket listeners',
    'ready-stop': 'ready server stop is idempotent and waits for confirmed child exit',
    'early-exit': 'child exit before readiness rejects and closes the bridge without signalling it again',
    'spawn-throws': 'synchronous spawn failure closes the already bound bridge',
    'spawn-error': 'asynchronous spawn failure with no PID closes the bridge without a false kill failure',
    'timeout-cleanup': 'readiness timeout confirms child exit before reporting startup failure',
    'timeout-cleanup-failure': 'readiness timeout retains both startup and unconfirmed exit errors',
    'abort-cleanup-failure': 'bridge close failure cannot be mistaken for successful cancellation',
    'both-cleanup-failures': 'cancellation preserves both child-exit and bridge-close failures',
};
for (const [scenario, title] of Object.entries(scenarios)) {
    test(title, { timeout: 10_000 }, () => {
        let output: string;
        try {
            output = execFileSync(process.execPath, [
                '--experimental-vm-modules', '--input-type=module', '-e', isolatedTest,
                scenario, fileURLToPath(new URL('../../runtime/rustBridge.mjs', import.meta.url)),
            ], { encoding: 'utf8', timeout: 8_000, stdio: ['ignore', 'pipe', 'pipe'] });
        } catch (error) {
            throw new Error(String((error as { stderr?: string }).stderr || error));
        }
        assert.equal(output, 'STARTUP_OK');
    });
}
