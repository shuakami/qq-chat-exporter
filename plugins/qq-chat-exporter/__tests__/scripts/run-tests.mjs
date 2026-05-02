#!/usr/bin/env node
/**
 * Cross-platform test runner.
 *
 * Sets the env vars tsx + node:test need, then runs `node --test` with the
 * supplied glob. Used by the npm scripts so the same `npm test` invocation
 * works on Windows, macOS and Linux without depending on `cross-env`.
 */

import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PLUGIN_ROOT = path.resolve(__dirname, '../..');

const args = process.argv.slice(2);
const updateSnapshots = args.includes('--update-snapshots');
const filtered = args.filter((a) => a !== '--update-snapshots');

if (filtered.length === 0) {
    filtered.push('__tests__/**/*.test.ts');
}

const env = {
    ...process.env,
    TSX_TSCONFIG_PATH: path.join('__tests__', 'tsconfig.json'),
    QCE_UPDATE_SNAPSHOTS: updateSnapshots ? '1' : process.env.QCE_UPDATE_SNAPSHOTS ?? ''
};

const result = spawnSync(
    process.execPath,
    [
        '--import', 'tsx',
        '--test',
        '--test-force-exit',
        ...filtered
    ],
    { cwd: PLUGIN_ROOT, env, stdio: 'inherit' }
);

process.exit(result.status ?? 1);
