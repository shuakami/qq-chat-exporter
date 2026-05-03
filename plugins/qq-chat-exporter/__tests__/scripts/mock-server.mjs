#!/usr/bin/env node
/**
 * mock-server.mjs - launch the real QCE API server (port 40653) backed by a
 * MockNapCatCore instead of a live NapCatQQ instance.
 *
 * Use this for:
 *   - Frontend development: `npm run mock:server` then point qce-v4-tool dev
 *     server at http://localhost:40653.
 *   - Manual smoke testing: hit the same REST/WS endpoints production exposes
 *     without needing to scan a QR code.
 *   - Playwright E2E tests (driven by `npm run test:e2e`).
 *
 * The fixture scenario is selected via the `QCE_MOCK_SCENARIO` env var. See
 * `__tests__/fixtures/conversations.ts` for the list. Defaults to `default`,
 * which loads every conversation in the fixtures module.
 */

import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PLUGIN_ROOT = path.resolve(__dirname, '../..');

// Point tsx at the loose-mode test tsconfig so `verbatimModuleSyntax` doesn't
// fail when the production code imports types as values.
process.env.TSX_TSCONFIG_PATH ??= path.join(PLUGIN_ROOT, '__tests__', 'tsconfig.json');

// Tell ApiServer where to put its sqlite + cache + downloads. Without this,
// it would write into the user's real home directory.
const TMP_HOME = process.env.QCE_MOCK_HOME ?? fs.mkdtempSync(path.join(os.tmpdir(), 'qce-mock-home-'));
process.env.HOME = TMP_HOME;
process.env.USERPROFILE = TMP_HOME;
const SECURITY_DIR = path.join(TMP_HOME, '.qq-chat-exporter');
fs.mkdirSync(SECURITY_DIR, { recursive: true });

// Pre-seed a deterministic access token so E2E tests can pass `?token=...`
// without first scraping it from server stdout.
const FIXED_TOKEN = process.env.QCE_MOCK_TOKEN ?? 'qce_mock_token_for_tests';
const securityConfig = {
    accessToken: FIXED_TOKEN,
    secretKey: 'qce_mock_secret_key_padded_to_64_chars_for_dev_environment_only',
    createdAt: new Date().toISOString(),
    allowedIPs: ['127.0.0.1', '::1', '0.0.0.0/0'],
    tokenExpired: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString(),
    disableIPWhitelist: true,
    serverHost: '0.0.0.0'
};
fs.writeFileSync(
    path.join(SECURITY_DIR, 'security.json'),
    JSON.stringify(securityConfig, null, 2),
    'utf-8'
);

async function main() {
    const { register } = await import('tsx/esm/api');
    register();

    const { createMockCore } = await import('../helpers/MockNapCatCore.ts');
    const { installBridge } = await import('../helpers/installBridge.ts');
    const fixtures = await import('../fixtures/conversations.ts');
    const { QQChatExporterApiLauncher } = await import('../../lib/api/ApiLauncher.ts');

    const scenario = (process.env.QCE_MOCK_SCENARIO ?? 'default').toLowerCase();
    const conversations = pickScenario(scenario, fixtures);

    const core = createMockCore({
        selfInfo: { uid: 'self_test_uid', uin: '10000', nick: 'TestSelf', online: true },
        friends: fixtures.FRIENDS,
        groups: fixtures.GROUPS,
        conversations,
        paths: {
            cachePath: path.join(TMP_HOME, '.qq-chat-exporter', 'cache'),
            tmpPath: path.join(TMP_HOME, '.qq-chat-exporter', 'tmp'),
            logsPath: path.join(TMP_HOME, '.qq-chat-exporter', 'logs')
        }
    });

    installBridge({ core });

    const launcher = new QQChatExporterApiLauncher(core);
    await launcher.startApiServer();

    const port = launcher.getStatus().port ?? 40653;
    /* eslint-disable no-console */
    console.log('\n=========================================================');
    console.log(`[QCE Mock] API server listening on http://localhost:${port}`);
    console.log(`[QCE Mock] Token:    ${FIXED_TOKEN}`);
    console.log(`[QCE Mock] Scenario: ${scenario} (${conversations.length} conversations)`);
    console.log(`[QCE Mock] Tmp home: ${TMP_HOME}`);
    console.log(`[QCE Mock] Quick check:`);
    console.log(`  curl 'http://localhost:${port}/api/groups?token=${FIXED_TOKEN}'`);
    console.log('=========================================================\n');
    /* eslint-enable no-console */

    // Keep alive until SIGINT/SIGTERM
    const shutdown = async (signal) => {
        console.log(`[QCE Mock] received ${signal}, stopping`);
        try {
            await launcher.stopApiServer();
        } finally {
            try { fs.rmSync(TMP_HOME, { recursive: true, force: true }); } catch { /* ignore */ }
            process.exit(0);
        }
    };
    process.on('SIGINT', () => shutdown('SIGINT'));
    process.on('SIGTERM', () => shutdown('SIGTERM'));
}

function pickScenario(scenario, fixtures) {
    switch (scenario) {
        case 'private':
            return [fixtures.privateTextOnly()];
        case 'group':
            return [fixtures.groupMixedMedia()];
        case 'recall':
            return [fixtures.privateWithRecall()];
        case 'forward':
            return [fixtures.privateWithForward()];
        case 'volume':
            return [fixtures.privateVolume(200)];
        case 'deactivated':
            return [fixtures.privateDeactivatedFriend()];
        case 'default':
        case 'all':
        default:
            return [
                fixtures.privateTextOnly(),
                fixtures.groupMixedMedia(),
                fixtures.privateWithRecall(),
                fixtures.privateWithForward(),
                fixtures.privateVolume(50),
                fixtures.privateDeactivatedFriend()
            ];
    }
}

main().catch((err) => {
    console.error('[QCE Mock] failed to start:', err);
    process.exit(1);
});
