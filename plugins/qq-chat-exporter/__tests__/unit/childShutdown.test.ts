import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test from 'node:test';
import { createChildShutdown } from '../../runtime/rustBridge.mjs';

// Importing the helper does not call startRustApiServer. Every process and
// timer below is fake: no binaries, sockets, ports, or user config are used.
class FakeChild extends EventEmitter {
    exitCode: number | null = null;
    signalCode: NodeJS.Signals | null = null;
    signals: Array<number | NodeJS.Signals | undefined> = [];
    onKill: (() => boolean) | undefined;

    kill(signal?: number | NodeJS.Signals) {
        assert.equal(signal, 'SIGTERM', 'never use SIGKILL as a shutdown fallback');
        assert.ok(this.listenerCount('exit') > 0, 'exit listener must exist before sending the signal');
        assert.ok(this.listenerCount('error') > 0, 'error listener must exist before sending the signal');
        this.signals.push(signal);
        return this.onKill?.() ?? true;
    }

    finish(code: number | null, signal: NodeJS.Signals | null = null) {
        this.exitCode = code;
        this.signalCode = signal;
        this.emit('exit', code, signal);
    }
}

class FakeClock {
    pending = new Map<NodeJS.Timeout, { callback: () => void; delay: number }>();
    cleared: NodeJS.Timeout[] = [];

    setTimer = ((callback: () => void, delay: number) => {
        const timer = {} as NodeJS.Timeout;
        this.pending.set(timer, { callback, delay });
        return timer;
    }) as typeof setTimeout;

    clearTimer = ((timer: NodeJS.Timeout) => {
        this.cleared.push(timer);
        this.pending.delete(timer);
    }) as typeof clearTimeout;

    expire() {
        for (const [timer, { callback }] of [...this.pending]) {
            this.pending.delete(timer);
            callback();
        }
    }
}

function setup() {
    const child = new FakeChild();
    const clock = new FakeClock();
    const stop = createChildShutdown(child, { setTimer: clock.setTimer, clearTimer: clock.clearTimer });
    return { child, clock, stop };
}

for (const [code, signal] of [[0, null], [2, null], [null, 'SIGTERM']] as const) {
    test(`an already exited child (${code ?? signal}) is never signalled again`, async () => {
        const { child, clock, stop } = setup();
        child.exitCode = code;
        child.signalCode = signal;
        const attempt = stop();
        assert.equal(stop(), attempt);
        await attempt;
        assert.deepEqual(child.signals, []);
        assert.equal(clock.pending.size, 0);
        assert.equal(child.listenerCount('exit'), 0);
        assert.equal(child.listenerCount('error'), 0);
    });
}

test('concurrent and later stops share one SIGTERM and clear only their own listeners', async () => {
    const { child, clock, stop } = setup();
    const externalExit = () => {};
    const externalError = () => {};
    child.on('exit', externalExit);
    child.on('error', externalError);
    const attempt = stop();
    assert.equal(stop(), attempt);
    assert.deepEqual(child.signals, ['SIGTERM']);
    assert.equal(clock.pending.size, 1);
    assert.equal([...clock.pending.values()][0].delay, 2000);
    child.finish(null, 'SIGTERM');
    await attempt;
    assert.equal(stop(), attempt);
    assert.deepEqual(child.listeners('exit'), [externalExit]);
    assert.deepEqual(child.listeners('error'), [externalError]);
    assert.equal(clock.pending.size, 0);
    assert.equal(clock.cleared.length, 1);
});

test('an exit emitted synchronously by kill is observed without waiting for the deadline', async () => {
    const { child, clock, stop } = setup();
    child.onKill = () => { child.finish(0); return true; };
    await stop();
    assert.equal(clock.pending.size, 0);
    assert.equal(clock.cleared.length, 1);
    assert.equal(child.listenerCount('exit'), 0);
    assert.equal(child.listenerCount('error'), 0);
});

test('a stop called again inside an existing exit listener receives the original promise', async () => {
    const { child, stop } = setup();
    let nestedAttempt: Promise<void> | undefined;
    child.on('exit', () => { nestedAttempt = stop(); });
    child.onKill = () => { child.finish(0); return true; };
    const attempt = stop();
    assert.equal(nestedAttempt, attempt);
    await attempt;
    assert.deepEqual(child.signals, ['SIGTERM']);
});

test('a live child at the deadline rejects, removes listeners, and never escalates or retries', async () => {
    const { child, clock, stop } = setup();
    const attempt = stop();
    const rejection = assert.rejects(attempt, /did not exit within 2000ms after SIGTERM/);
    clock.expire();
    await rejection;
    assert.equal(stop(), attempt, 'repeating stop returns the original failure');
    await assert.rejects(stop(), /did not exit/);
    assert.deepEqual(child.signals, ['SIGTERM']);
    assert.equal(child.listenerCount('exit'), 0);
    assert.equal(child.listenerCount('error'), 0);
    assert.equal(clock.pending.size, 0);
    assert.equal(clock.cleared.length, 1);
});

test('independently observed signal termination before the deadline counts as exited', async () => {
    const { child, clock, stop } = setup();
    const attempt = stop();
    child.signalCode = 'SIGTERM';
    clock.expire();
    await attempt;
    assert.equal(child.listenerCount('exit'), 0);
    assert.equal(child.listenerCount('error'), 0);
});

test('a rejected kill request fails promptly and releases the deadline', async () => {
    const { child, clock, stop } = setup();
    child.onKill = () => false;
    await assert.rejects(stop(), /Failed to send SIGTERM/);
    assert.equal(clock.pending.size, 0);
    assert.equal(child.listenerCount('exit'), 0);
    assert.equal(child.listenerCount('error'), 0);
});

test('a failed kill request after observed exit is treated as an already stopped child', async () => {
    const { child, clock, stop } = setup();
    child.onKill = () => { child.exitCode = 0; return false; };
    await stop();
    assert.equal(clock.pending.size, 0);
    assert.equal(child.listenerCount('exit'), 0);
    assert.equal(child.listenerCount('error'), 0);
});

test('synchronous kill exceptions reject and clean up both listeners', async () => {
    const { child, clock, stop } = setup();
    child.onKill = () => { throw new Error('mock permission error'); };
    await assert.rejects(stop(), /mock permission error/);
    assert.equal(clock.pending.size, 0);
    assert.equal(child.listenerCount('exit'), 0);
    assert.equal(child.listenerCount('error'), 0);
});

test('child error events reject without removing the existing runtime error logger', async () => {
    const { child, clock, stop } = setup();
    const observed: Error[] = [];
    const logger = (error: Error) => observed.push(error);
    child.on('error', logger);
    child.onKill = () => { child.emit('error', new Error('mock process error')); return true; };
    await assert.rejects(stop(), /mock process error/);
    assert.equal(observed.length, 1);
    assert.deepEqual(child.listeners('error'), [logger]);
    assert.equal(child.listenerCount('exit'), 0);
    assert.equal(clock.pending.size, 0);
});
