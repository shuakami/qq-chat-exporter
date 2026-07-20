import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '../../../..');

function read(relativePath: string) {
    return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

test('packaging scripts enable NapCat file logs and propagate QCE log paths', () => {
    const quickPack = read('scripts/quick-pack.py');
    const frameworkPack = read('scripts/build-framework-plugin.py');
    const installerService = read('installer/src-tauri/src/service.rs');

    for (const source of [quickPack, frameworkPack]) {
        assert.ok(source.includes('"fileLog": True'));
        assert.ok(source.includes('QCE_LOG_DIR'));
        assert.ok(source.includes('QCE_LOG_FILE'));
        assert.ok(source.includes('qce-runtime.log'));
    }
    assert.ok(!frameworkPack.includes('start "" "%NAPCAT_LAUNCHER_PATH%"'));
    assert.equal((installerService.match(/\.env\("QCE_LOG_FILE"/g) ?? []).length, 2);
    assert.equal((installerService.match(/\.env\("QCE_LOG_DIR"/g) ?? []).length, 2);
});

test('bug-related issue forms require log and screenshot confirmation', () => {
    for (const template of [
        '.github/ISSUE_TEMPLATE/bug_report.yml',
        '.github/ISSUE_TEMPLATE/export_issue.yml',
        '.github/ISSUE_TEMPLATE/install_issue.yml'
    ]) {
        const source = read(template);
        assert.ok(source.includes('id: evidence'), `${template} is missing the evidence confirmation`);
        assert.equal((source.match(/required: true/g) ?? []).length >= 2, true);
    }
});
