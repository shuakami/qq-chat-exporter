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

const PACKAGING_SCRIPTS = [
    'scripts/plugin_runtime.py',
    'scripts/quick-pack.py',
    'scripts/build-framework-plugin.py',
    'scripts/pack-windows-on-linux.py'
];

/*
 * v6.1.9 shipped a macOS package built around NapCat v4.8.119: the lookup hit
 * GitHub's unauthenticated rate limit and fell back to a hardcoded version, so
 * the package built, passed every check and could never log in. The fallback
 * lived in four near-copies, and the one fix that had been applied never
 * reached the other three.
 */
test('no packaging script can fall back to a hardcoded NapCat version', () => {
    for (const script of PACKAGING_SCRIPTS) {
        assert.ok(
            !/return\s+"v\d/.test(read(script)),
            `${script} still returns a hardcoded NapCat version`
        );
    }
});

test('the NapCat lookup has exactly one implementation', () => {
    assert.ok(read('scripts/plugin_runtime.py').includes('def get_napcat_latest_version'));

    for (const script of ['scripts/quick-pack.py', 'scripts/build-framework-plugin.py']) {
        const source = read(script);
        assert.match(
            source,
            /from plugin_runtime import \([^)]*get_napcat_latest_version,/,
            `${script} must import the lookup from plugin_runtime`
        );
        assert.ok(
            !source.includes('def get_napcat_latest_version'),
            `${script} must not define a second copy of the lookup`
        );
    }

    // The Windows-on-Linux wrapper used to monkey-patch its own copy of the
    // lookup; that divergence is what let the fix miss three call sites.
    assert.ok(!read('scripts/pack-windows-on-linux.py').includes('get_napcat_latest_version'));
});

test('one release-wide lookup feeds every packaging job', () => {
    const workflow = read('.github/workflows/release-plugin.yml');

    // Shell (all three platforms) and Framework packages both consume the one
    // resolved version, so a release can never bundle two different NapCats.
    const consumers = workflow.match(/NAPCAT_VERSION: \$\{\{ needs\.get-napcat-version\.outputs\.version \}\}/g);
    assert.equal(consumers?.length, 2);

    for (const job of ['build-shell-packages', 'build-framework-package']) {
        assert.match(
            workflow,
            new RegExp(`\\n  ${job}:\\s+needs: \\[get-napcat-version,`),
            `${job} must depend on the shared lookup`
        );
    }

    // Honouring the pinned value is what makes the fan-out work at all.
    assert.ok(read('scripts/plugin_runtime.py').includes('os.environ.get("NAPCAT_VERSION"'));
});
