/**
 * Guards against NapCat PluginLoader sensitive-keyword false positives
 * (issue #466).
 *
 * NapCat's PluginLoader scans the shipped plugin source and rejects the plugin
 * outright when it finds a blocked keyword. The plugin ships its TypeScript
 * sources verbatim (tsx loads lib/*.ts at runtime), so even keywords that only
 * appear in comments get scanned. "发卡" — a substring of "转发卡片"
 * ("forward card") used in comments — tripped this and made QCE disappear from
 * the plugin list on Docker NapCat.
 *
 * This test fails if any blocked keyword reappears in the shipped source, so a
 * future comment/string does not silently break Docker installs again.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PLUGIN_ROOT = path.resolve(__dirname, '../..');

// Keywords NapCat's PluginLoader rejects (observed in #466). Extend as more are
// reported.
const BLOCKED_KEYWORDS = ['发卡'];

// Files NapCat actually scans: the shipped entrypoint and the lib/ sources.
const SHIPPED_ROOTS = [
    path.join(PLUGIN_ROOT, 'index.mjs'),
    path.join(PLUGIN_ROOT, 'lib'),
];

function collectFiles(target: string): string[] {
    if (!fs.existsSync(target)) return [];
    const stat = fs.statSync(target);
    if (stat.isFile()) return [target];
    const out: string[] = [];
    for (const entry of fs.readdirSync(target)) {
        out.push(...collectFiles(path.join(target, entry)));
    }
    return out;
}

const SCANNED_EXTENSIONS = new Set(['.ts', '.mjs', '.js', '.json']);

test('shipped plugin source is free of NapCat sensitive keywords (#466)', () => {
    const offenders: string[] = [];
    for (const root of SHIPPED_ROOTS) {
        for (const file of collectFiles(root)) {
            if (!SCANNED_EXTENSIONS.has(path.extname(file))) continue;
            const content = fs.readFileSync(file, 'utf8');
            for (const keyword of BLOCKED_KEYWORDS) {
                if (content.includes(keyword)) {
                    offenders.push(`${path.relative(PLUGIN_ROOT, file)} contains "${keyword}"`);
                }
            }
        }
    }
    assert.deepEqual(offenders, [], `NapCat-blocked keywords found:\n${offenders.join('\n')}`);
});
