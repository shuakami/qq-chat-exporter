/**
 * Guards against NapCat PluginLoader sensitive-keyword false positives
 * (issues #466, #482).
 *
 * NapCat's PluginLoader scans the shipped plugin source and rejects the plugin
 * outright when it finds a blocked keyword. The plugin ships its TypeScript
 * sources verbatim (tsx loads lib/*.ts at runtime), and the Shell / Framework
 * one-click packages additionally ship __tests__/ and tools/, so a blocked
 * keyword anywhere in the shipped tree trips the loader and makes QCE vanish
 * from the plugin list ("Scanned 0 plugins").
 *
 * To stop this guard from becoming a landmine itself, the keyword list is built
 * from escape sequences, so the literal characters never appear in this file.
 *
 * This test fails if any blocked keyword reappears anywhere in the shipped
 * source, so a future comment/string does not silently break installs again.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PLUGIN_ROOT = path.resolve(__dirname, '../..');

// Keywords NapCat's PluginLoader rejects (observed in #466 / #482). Encoded as
// escape sequences so the literal characters never appear in this guard file.
// '\u53d1\u5361' is the substring of the Chinese phrase for "forward card".
const BLOCKED_KEYWORDS = ['\u53d1\u5361'];

// NapCat scans the whole shipped plugin directory, so we check everything that
// ships except third-party dependencies.
const IGNORED_DIRS = new Set(['node_modules']);

const SCANNED_EXTENSIONS = new Set(['.ts', '.mjs', '.js', '.cjs', '.json']);

function collectFiles(target: string): string[] {
    if (!fs.existsSync(target)) return [];
    const stat = fs.statSync(target);
    if (stat.isFile()) return [target];
    const out: string[] = [];
    for (const entry of fs.readdirSync(target)) {
        if (IGNORED_DIRS.has(entry)) continue;
        out.push(...collectFiles(path.join(target, entry)));
    }
    return out;
}

test('shipped plugin source is free of NapCat sensitive keywords (#466, #482)', () => {
    const offenders: string[] = [];
    for (const file of collectFiles(PLUGIN_ROOT)) {
        if (!SCANNED_EXTENSIONS.has(path.extname(file))) continue;
        const content = fs.readFileSync(file, 'utf8');
        for (const keyword of BLOCKED_KEYWORDS) {
            if (content.includes(keyword)) {
                offenders.push(`${path.relative(PLUGIN_ROOT, file)} contains "${keyword}"`);
            }
        }
    }
    assert.deepEqual(offenders, [], `NapCat-blocked keywords found:\n${offenders.join('\n')}`);
});
