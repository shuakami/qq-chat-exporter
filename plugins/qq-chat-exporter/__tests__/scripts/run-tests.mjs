#!/usr/bin/env node
/**
 * Cross-platform test runner.
 *
 * Sets the env vars tsx + node:test need, then runs `node --test` with the
 * supplied glob. Used by the npm scripts so the same `npm test` invocation
 * works on Windows, macOS and Linux without depending on `cross-env`.
 */

import path from 'node:path';
import fs from 'node:fs';
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

/**
 * Expand glob patterns. Node's `--test` doesn't expand globs in Node < 22, and
 * the npm script gets the patterns through verbatim, so we walk them manually.
 *
 * Supported: `**`, single segment `*`, exact paths.
 */
function globToFiles(pattern) {
    const abs = path.isAbsolute(pattern) ? pattern : path.join(PLUGIN_ROOT, pattern);

    // Exact file
    if (!abs.includes('*')) {
        return fs.existsSync(abs) ? [abs] : [];
    }

    // Split into base directory + remaining glob.
    const segments = abs.split(path.sep);
    const firstGlobIdx = segments.findIndex((s) => s.includes('*'));
    const baseDir = segments.slice(0, firstGlobIdx).join(path.sep) || path.sep;
    const tail = segments.slice(firstGlobIdx);

    // Build regex from tail. `**` matches any number of segments (including
    // none), `*` matches one segment. Build the source manually so `**` can
    // consume the following `/` separator.
    let regexSrc = '^';
    for (let i = 0; i < tail.length; i++) {
        const seg = tail[i];
        const isLast = i === tail.length - 1;
        if (seg === '**') {
            // Match zero or more path segments. When not the last segment,
            // also consume the trailing `/` separator.
            regexSrc += isLast ? '.*' : '(?:[^/]+/)*';
        } else {
            regexSrc += seg.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[^/]*');
            if (!isLast && tail[i + 1] !== '**') regexSrc += '/';
        }
    }
    regexSrc += '$';
    const re = new RegExp(regexSrc);

    if (!fs.existsSync(baseDir)) return [];

    const matches = [];
    function walk(dir) {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
            const full = path.join(dir, entry.name);
            if (entry.isDirectory()) {
                walk(full);
            } else if (entry.isFile()) {
                const rel = path.relative(baseDir, full).split(path.sep).join('/');
                if (re.test(rel)) matches.push(full);
            }
        }
    }
    walk(baseDir);
    return matches;
}

const files = filtered.flatMap(globToFiles);

if (files.length === 0) {
    console.error(`No test files matched: ${filtered.join(', ')}`);
    process.exit(1);
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
        ...files
    ],
    { cwd: PLUGIN_ROOT, env, stdio: 'inherit' }
);

process.exit(result.status ?? 1);
