import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createSafeLogger } from '../../lib/api/safeLogger.js';

interface RecordedConsole {
    log: unknown[][];
    warn: unknown[][];
    error: unknown[][];
    debug: unknown[][];
}

function makeFakeConsole(): { console: Console; recorded: RecordedConsole } {
    const recorded: RecordedConsole = { log: [], warn: [], error: [], debug: [] };
    const fake = {
        log: (...args: unknown[]) => recorded.log.push(args),
        warn: (...args: unknown[]) => recorded.warn.push(args),
        error: (...args: unknown[]) => recorded.error.push(args),
        debug: (...args: unknown[]) => recorded.debug.push(args),
    } as unknown as Console;
    return { console: fake, recorded };
}

describe('safeLogger', () => {
    it('falls back to console when core is undefined', () => {
        const { console: fake, recorded } = makeFakeConsole();
        const logger = createSafeLogger(undefined, fake);
        logger.log('hello');
        logger.logWarn('warning');
        logger.logError('boom');
        logger.logDebug('detail');

        assert.deepEqual(recorded.log, [['[QCE]', 'hello']]);
        assert.deepEqual(recorded.warn, [['[QCE]', 'warning']]);
        assert.deepEqual(recorded.error, [['[QCE]', 'boom']]);
        assert.deepEqual(recorded.debug, [['[QCE]', 'detail']]);
    });

    it('falls back to console when core.context is missing', () => {
        const { console: fake, recorded } = makeFakeConsole();
        const logger = createSafeLogger({} as any, fake);
        logger.log('hello');
        assert.deepEqual(recorded.log, [['[QCE]', 'hello']]);
    });

    it('falls back to console when logger is missing', () => {
        const { console: fake, recorded } = makeFakeConsole();
        const logger = createSafeLogger({ context: {} } as any, fake);
        logger.logError('boom');
        assert.deepEqual(recorded.error, [['[QCE]', 'boom']]);
    });

    it('falls back when only some methods are present', () => {
        const { console: fake, recorded } = makeFakeConsole();
        const napcatLogger = {
            log: (...args: unknown[]) => recorded.log.push(['napcat', ...args]),
        };
        const logger = createSafeLogger({ context: { logger: napcatLogger } } as any, fake);

        logger.log('hello');
        logger.logWarn('warning');
        logger.logError('boom');

        // log -> NapCat 真正的 logger
        assert.deepEqual(recorded.log, [['napcat', 'hello']]);
        // logWarn / logError 缺失 -> console
        assert.deepEqual(recorded.warn, [['[QCE]', 'warning']]);
        assert.deepEqual(recorded.error, [['[QCE]', 'boom']]);
    });

    it('routes calls to NapCat logger when fully present', () => {
        const { console: fake } = makeFakeConsole();
        const calls: Record<string, unknown[][]> = { log: [], logWarn: [], logError: [], logDebug: [] };
        const napcatLogger = {
            log: (...args: unknown[]) => { calls.log.push(args); },
            logWarn: (...args: unknown[]) => { calls.logWarn.push(args); },
            logError: (...args: unknown[]) => { calls.logError.push(args); },
            logDebug: (...args: unknown[]) => { calls.logDebug.push(args); },
        };
        const logger = createSafeLogger({ context: { logger: napcatLogger } } as any, fake);

        logger.log('a');
        logger.logWarn('b');
        logger.logError('c', 1, 2);
        logger.logDebug('d');

        assert.deepEqual(calls.log, [['a']]);
        assert.deepEqual(calls.logWarn, [['b']]);
        assert.deepEqual(calls.logError, [['c', 1, 2]]);
        assert.deepEqual(calls.logDebug, [['d']]);
    });

    it('falls back to console if the underlying NapCat logger throws', () => {
        const { console: fake, recorded } = makeFakeConsole();
        const napcatLogger = {
            log: () => { throw new Error('logger pipe broken'); },
        };
        const logger = createSafeLogger({ context: { logger: napcatLogger } } as any, fake);

        // 不能让 log 抛出来污染调用方
        logger.log('hello');

        assert.deepEqual(recorded.log, [['[QCE]', 'hello']]);
    });

    it('preserves `this` binding when calling NapCat logger', () => {
        const { console: fake } = makeFakeConsole();
        const napcatLogger = {
            tag: 'napcat',
            received: [] as Array<{ tag: string; args: unknown[] }>,
            log(this: { tag: string; received: Array<{ tag: string; args: unknown[] }> }, ...args: unknown[]) {
                this.received.push({ tag: this.tag, args });
            },
        };
        const logger = createSafeLogger({ context: { logger: napcatLogger } } as any, fake);

        logger.log('hi');

        assert.equal(napcatLogger.received.length, 1);
        assert.equal(napcatLogger.received[0]!.tag, 'napcat');
        assert.deepEqual(napcatLogger.received[0]!.args, ['hi']);
    });
});
