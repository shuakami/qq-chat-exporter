/**
 * Tiny snapshot helper used by exporter / parser tests.
 *
 * `node:test` ships its own snapshot API in Node 22 but it's still
 * experimental and changes shape between minor versions, so we ship our own
 * extremely small implementation. Run with `QCE_UPDATE_SNAPSHOTS=1` to refresh.
 */

import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

const UPDATE_ENV = 'QCE_UPDATE_SNAPSHOTS';

export interface SnapshotOptions {
    /** Absolute path to the test file (use `import.meta.url`). */
    testFileUrl: string;
    /** Snapshot identifier (becomes the filename, sans ext). */
    name: string;
    /** Snapshot extension, defaults to `.snap.txt`. */
    ext?: string;
}

function resolveSnapshotPath(opts: SnapshotOptions): string {
    const testDir = path.dirname(fileURLToPath(opts.testFileUrl));
    const snapDir = path.join(testDir, '__snapshots__');
    fs.mkdirSync(snapDir, { recursive: true });
    return path.join(snapDir, `${opts.name}${opts.ext ?? '.snap.txt'}`);
}

/** Normalize CRLF -> LF so snapshots compare equal regardless of git's autocrlf. */
function normalizeLineEndings(s: string): string {
    return s.replace(/\r\n/g, '\n');
}

export function assertSnapshot(actual: string, opts: SnapshotOptions): void {
    const file = resolveSnapshotPath(opts);
    const actualNorm = normalizeLineEndings(actual);

    if (process.env[UPDATE_ENV] || !fs.existsSync(file)) {
        fs.writeFileSync(file, actualNorm, 'utf8');
        return;
    }

    const expected = normalizeLineEndings(fs.readFileSync(file, 'utf8'));
    if (actualNorm === expected) return;

    const errorPath = `${file}.actual`;
    fs.writeFileSync(errorPath, actualNorm, 'utf8');
    assert.fail(
        `Snapshot mismatch for "${opts.name}".\n` +
        `  expected: ${file}\n` +
        `  actual:   ${errorPath}\n` +
        `Run with ${UPDATE_ENV}=1 to update snapshots.`
    );
}

export function assertJsonSnapshot(actual: unknown, opts: SnapshotOptions): void {
    assertSnapshot(
        JSON.stringify(actual, null, 2) + '\n',
        { ...opts, ext: opts.ext ?? '.snap.json' }
    );
}
