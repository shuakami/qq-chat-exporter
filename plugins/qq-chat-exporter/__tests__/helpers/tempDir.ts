/**
 * Disposable temp directory helper for exporter tests.
 *
 * Unlike `os.tmpdir()` we keep everything under a known location so failed
 * tests can be inspected after the fact. Pass `keep: true` (or set
 * `QCE_TEST_KEEP_TMP=1`) to skip cleanup.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const KEEP_ENV = 'QCE_TEST_KEEP_TMP';

export interface TempDirHandle {
    path: string;
    cleanup(): void;
}

export function createTempDir(prefix = 'qce-test-'): TempDirHandle {
    const root = path.join(os.tmpdir(), 'qce-tests');
    fs.mkdirSync(root, { recursive: true });
    const dir = fs.mkdtempSync(path.join(root, prefix));

    let cleaned = false;
    const cleanup = () => {
        if (cleaned) return;
        cleaned = true;
        if (process.env[KEEP_ENV]) {
            // eslint-disable-next-line no-console
            console.log(`[tempDir] keeping ${dir} (${KEEP_ENV} set)`);
            return;
        }
        try {
            fs.rmSync(dir, { recursive: true, force: true });
        } catch {
            // best effort
        }
    };

    return { path: dir, cleanup };
}
