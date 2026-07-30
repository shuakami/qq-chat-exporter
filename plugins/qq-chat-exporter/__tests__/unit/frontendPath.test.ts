import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import { resolveFrontendPath } from '../../runtime/ApiLauncher.mjs';
import { createTempDir } from '../helpers/tempDir.js';

function writeIndex(directory: string, marker: string) {
    fs.mkdirSync(directory, { recursive: true });
    fs.writeFileSync(path.join(directory, 'index.html'), marker, 'utf8');
}

test('frontend path prefers v6 static assets over a stale v5 webui directory', () => {
    const tempDir = createTempDir('qce-frontend-path-');
    try {
        const pluginRoot = path.join(tempDir.path, 'plugins', 'napcat-plugin-qce');
        const staleWebui = path.join(pluginRoot, 'webui');
        const currentStatic = path.join(tempDir.path, 'static', 'qce');
        writeIndex(staleWebui, 'v5');
        writeIndex(currentStatic, 'v6');
        assert.equal(resolveFrontendPath({}, { pluginRoot, env: {} }), currentStatic);
    } finally {
        tempDir.cleanup();
    }
});

test('frontend path keeps plugin webui as the final compatibility fallback', () => {
    const tempDir = createTempDir('qce-frontend-fallback-');
    try {
        const pluginRoot = path.join(tempDir.path, 'plugins', 'napcat-plugin-qce');
        const webui = path.join(pluginRoot, 'webui');
        writeIndex(webui, 'plugin');
        assert.equal(resolveFrontendPath({}, { pluginRoot, env: {} }), webui);
    } finally {
        tempDir.cleanup();
    }
});

test('frontend path ignores directories without an index page', () => {
    const tempDir = createTempDir('qce-frontend-invalid-');
    try {
        const pluginRoot = path.join(tempDir.path, 'plugins', 'napcat-plugin-qce');
        fs.mkdirSync(path.join(tempDir.path, 'static', 'qce'), { recursive: true });
        fs.mkdirSync(path.join(pluginRoot, 'webui'), { recursive: true });
        assert.equal(resolveFrontendPath({}, { pluginRoot, env: {} }), undefined);
    } finally {
        tempDir.cleanup();
    }
});
