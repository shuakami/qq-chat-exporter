import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createFallbackCore } from '../../index.mjs';

describe('createFallbackCore', () => {
    it('preserves NapCat logger methods outside the QCE logging facade', () => {
        const calls: unknown[][] = [];
        const logger = Object.create({
            logMessage(this: object, ...args: unknown[]) {
                assert.equal(this, logger);
                calls.push(args);
            },
        });
        Object.assign(logger, {
            log() {},
            logWarn() {},
            logError() {},
            logDebug() {},
        });

        const core = { context: { logger } };
        const safeCore = createFallbackCore(core);

        safeCore.context.logger.logMessage('info', 'loaded groups');
        assert.deepEqual(calls, [['info', 'loaded groups']]);
    });
});
