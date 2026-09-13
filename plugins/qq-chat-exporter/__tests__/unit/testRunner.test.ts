import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { createTempDir } from '../helpers/tempDir.js';

const runner = fileURLToPath(new URL('../scripts/run-tests.mjs', import.meta.url));

function runFixture(source: string) {
    const tmp = createTempDir('qce-runner-regression-');
    try {
        const fixture = path.join(tmp.path, 'fixture.test.ts');
        fs.writeFileSync(path.join(tmp.path, 'package.json'), '{"type":"module"}');
        fs.writeFileSync(fixture, source);
        // Node versions choose different default reporters. Keep these CLI
        // contract assertions machine-readable regardless of the outer run.
        const env: NodeJS.ProcessEnv = { ...process.env, NODE_OPTIONS: '--test-reporter=tap' };
        // Model a user invoking the CLI, not a nested node:test worker.
        delete env.NODE_TEST_CONTEXT;
        return spawnSync(process.execPath, [runner, fixture], {
            env,
            encoding: 'utf8',
            timeout: 15_000,
        });
    } finally {
        tmp.cleanup();
    }
}

test('test runner counts completed asynchronous tests and the tests following them', () => {
    const result = runFixture(`
        import assert from 'node:assert/strict';
        import test from 'node:test';
        let completed = 0;
        for (let index = 0; index < 24; index++) {
            test('asynchronous fixture ' + index, async () => {
                await Promise.resolve();
                assert.equal(completed++, index);
            });
        }
        test('trailing fixture', () => assert.equal(completed, 24));
    `);
    assert.equal(result.error, undefined);
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.match(result.stdout, /# tests 25\b/);
    assert.match(result.stdout, /# pass 25\b/);
    assert.match(result.stdout, /# cancelled 0\b/);
});

test('test runner reports a timed-out promise and accounts for the queued tests', () => {
    const result = runFixture(`
        import test from 'node:test';
        test('unresolved fixture', { timeout: 25 }, context => {
            const timer = setInterval(() => {}, 1000);
            context.after(() => clearInterval(timer));
            return new Promise(() => {});
        });
        test('queued fixture', () => {});
    `);
    assert.equal(result.error, undefined, 'node:test must finish before the outer safety deadline');
    assert.equal(result.status, 1, result.stdout + result.stderr);
    assert.match(result.stdout, /# tests 2\b/);
    assert.match(result.stdout, /# pass 1\b/);
    assert.match(result.stdout, /# cancelled 1\b/);
    assert.match(result.stdout, /timed out after 25ms/);
});

test('test runner propagates a failing assertion after an asynchronous test', () => {
    const result = runFixture(`
        import assert from 'node:assert/strict';
        import test from 'node:test';
        for (let index = 0; index < 12; index++) {
            test('asynchronous fixture ' + index, async () => { await Promise.resolve(); });
        }
        test('trailing failure', () => assert.fail('expected fixture failure'));
    `);
    assert.equal(result.error, undefined);
    assert.equal(result.status, 1, result.stdout + result.stderr);
    assert.match(result.stdout, /# tests 13\b/);
    assert.match(result.stdout, /# pass 12\b/);
    assert.match(result.stdout, /# fail 1\b/);
    assert.match(result.stdout, /expected fixture failure/);
});
