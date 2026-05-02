/**
 * Exporter snapshot tests.
 *
 * For each exporter we feed the same fixture conversation, redact volatile
 * metadata (timestamps, version strings, host paths) and snapshot the file
 * contents. A pure additive change to an exporter then surfaces as a small
 * snapshot diff instead of silently shifting the on-disk output.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { createMockCore } from '../helpers/MockNapCatCore.js';
import { installBridge, uninstallBridge } from '../helpers/installBridge.js';
import { silenceConsole } from '../helpers/silenceConsole.js';
import { createTempDir } from '../helpers/tempDir.js';
import { assertSnapshot } from '../helpers/snapshot.js';
import { groupMixedMedia, GROUPS } from '../fixtures/conversations.js';

let console_!: ReturnType<typeof silenceConsole>;
let tmp!: ReturnType<typeof createTempDir>;

test.beforeEach(() => {
    console_ = silenceConsole();
    tmp = createTempDir();
});

test.afterEach(() => {
    uninstallBridge();
    tmp.cleanup();
    console_.restore();
});

interface RunOptions {
    extension: 'txt' | 'json' | 'html';
    exporter: 'TextExporter' | 'JsonExporter' | 'HtmlExporter';
    format: 'txt' | 'json' | 'html';
}

async function runExport(opts: RunOptions): Promise<string> {
    const fixture = groupMixedMedia();
    const core = createMockCore({ groups: GROUPS, conversations: [fixture] });
    installBridge({ core });

    const mod = await import(`../../lib/core/exporter/${opts.exporter}.js`);
    const Exporter = mod[opts.exporter];

    const outputPath = path.join(tmp.path, `out.${opts.extension}`);
    const exporter = new Exporter(
        {
            outputPath,
            includeResourceLinks: true,
            includeSystemMessages: true,
            filterPureImageMessages: false,
            timeFormat: 'YYYY-MM-DD HH:mm:ss',
            prettyFormat: true,
            encoding: 'utf-8'
        },
        {},
        core
    );
    await exporter.export(fixture.messages, fixture.chatInfo);
    return fs.readFileSync(outputPath, 'utf8');
}

/** Strip volatile fields so the snapshot stays stable across runs. */
function redact(content: string): string {
    return content
        .replaceAll(/qce-test-tmp[^"'\s]*/g, '<TMP_PATH>')
        .replaceAll(/\/tmp\/[^"'\s]+/g, '<TMP_PATH>')
        .replaceAll(/"exportTime"\s*:\s*"[^"]+"/g, '"exportTime":"<TIMESTAMP>"')
        .replaceAll(/"exportedAt"\s*:\s*"[^"]+"/g, '"exportedAt":"<TIMESTAMP>"')
        .replaceAll(/"createdAt"\s*:\s*"[^"]+"/g, '"createdAt":"<TIMESTAMP>"')
        .replaceAll(/导出时间[：: ]+[\d\-:T.Z+ ]+/g, '导出时间: <TIMESTAMP>')
        .replaceAll(/"version"\s*:\s*"[^"]+"/g, '"version":"<VERSION>"')
        .replaceAll(/QQ Chat Exporter v[\d.]+/g, 'QQ Chat Exporter v<VERSION>')
        .replaceAll(/\sdata-export-time="[^"]*"/g, ' data-export-time="<TIMESTAMP>"')
        .replaceAll(/Generated at [^<\n]+/g, 'Generated at <TIMESTAMP>')
        .replaceAll(/<meta name="generator" content="[^"]*">/g, '<meta name="generator" content="<GENERATOR>">');
}

test('TextExporter produces stable output for groupMixedMedia fixture', async () => {
    const output = await runExport({ extension: 'txt', exporter: 'TextExporter', format: 'txt' });
    assertSnapshot(redact(output), {
        testFileUrl: import.meta.url,
        name: 'TextExporter.groupMixedMedia',
        ext: '.snap.txt'
    });
});

test('JsonExporter produces stable output for groupMixedMedia fixture', async () => {
    const output = await runExport({ extension: 'json', exporter: 'JsonExporter', format: 'json' });
    // JSON output may have non-deterministic key ordering in metadata; reparse
    // for deep stability.
    const parsed = JSON.parse(output);
    if (parsed.metadata) {
        delete parsed.metadata.exportTime;
        delete parsed.metadata.createdAt;
        delete parsed.metadata.version;
        delete parsed.metadata.appInfo;
        delete parsed.metadata.totalSize;
    }
    if (Array.isArray(parsed.messages)) {
        for (const m of parsed.messages) delete m.id;
    }
    assertSnapshot(JSON.stringify(parsed, null, 2) + '\n', {
        testFileUrl: import.meta.url,
        name: 'JsonExporter.groupMixedMedia',
        ext: '.snap.json'
    });
});

test('HtmlExporter produces stable output for groupMixedMedia fixture', async () => {
    const output = await runExport({ extension: 'html', exporter: 'HtmlExporter', format: 'html' });
    assertSnapshot(redact(output), {
        testFileUrl: import.meta.url,
        name: 'HtmlExporter.groupMixedMedia',
        ext: '.snap.html'
    });
});

test('TextExporter is deterministic across runs', async () => {
    const a = await runExport({ extension: 'txt', exporter: 'TextExporter', format: 'txt' });
    uninstallBridge();
    const b = await runExport({ extension: 'txt', exporter: 'TextExporter', format: 'txt' });
    assert.equal(redact(a), redact(b));
});
