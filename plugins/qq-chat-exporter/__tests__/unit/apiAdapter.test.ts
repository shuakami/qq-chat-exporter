import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createApiAdapter } from '../../index.mjs';

describe('createApiAdapter', () => {
    it('passes through non-function properties like groupMemberCache (issue #654)', () => {
        const groupMemberCache = new Map([['g1_u1', { uid: 'u1' }]]);
        const apis = { GroupApi: { groupMemberCache } };
        const adapter = createApiAdapter(apis);

        const exposed = adapter.GroupApi.groupMemberCache;
        assert.equal(exposed, groupMemberCache);
        assert.equal(exposed.get('g1_u1').uid, 'u1');
    });

    it('passes through non-function PacketApi.pkt so pkt.operation.* resolves', () => {
        const GetGroupFileUrl = async () => ({ url: 'https://example.invalid/file' });
        const apis = { PacketApi: { pkt: { operation: { GetGroupFileUrl } } } };
        const adapter = createApiAdapter(apis);

        const pkt = adapter.PacketApi.pkt;
        assert.equal(typeof pkt, 'object');
        assert.equal(pkt.operation.GetGroupFileUrl, GetGroupFileUrl);
    });

    it('keeps stub fallbacks for truly unknown methods', async () => {
        const adapter = createApiAdapter({ GroupApi: {} });

        const missing = adapter.GroupApi.someUnknownMethod;
        assert.equal(typeof missing, 'function');
        assert.deepEqual(await missing(), { result: 0, errMsg: '' });

        const missingNs = adapter.UnknownApi.whatever;
        assert.equal(typeof missingNs, 'function');
        assert.deepEqual(await missingNs(), { result: 0, errMsg: '' });
    });

    it('keeps known-method stubs when the real method is absent', async () => {
        const adapter = createApiAdapter({ GroupApi: {} });
        assert.deepEqual(await adapter.GroupApi.getGroups(), []);
    });

    it('binds real functions to their API object', async () => {
        const calls: unknown[][] = [];
        const apis = {
            GroupApi: {
                getGroups(this: object, ...args: unknown[]) {
                    assert.equal(this, apis.GroupApi);
                    calls.push(args);
                    return ['g1'];
                }
            }
        };
        const adapter = createApiAdapter(apis);

        assert.deepEqual(await adapter.GroupApi.getGroups('x'), ['g1']);
        assert.deepEqual(calls, [['x']]);
    });

    it('passes through non-function properties of known namespaces instead of stubbing them', () => {
        const apis = { GroupApi: { getGroups: null } };
        const adapter = createApiAdapter(apis);
        assert.equal(adapter.GroupApi.getGroups, null);
    });
});

describe('plugin_init core isolation', () => {
    it('does not overwrite NapCat core.apis with the adapter proxy (issue #654)', async () => {
        // Execute the real entrypoint, but replace its launcher import before
        // initialization. A locally built qce-server must never turn this
        // contract test into a production process launch or port reclamation.
        const source = String.raw`
        import assert from 'node:assert/strict';
        import fs from 'node:fs';
        import vm from 'node:vm';
        const [entryPath] = process.argv.slice(1);
        const context = vm.createContext({
            AbortController, DOMException,
            process: { env: {}, versions: process.versions },
            console: { log() {}, error() {}, warn() {} },
        });
        let launchedCore;
        let startCalls = 0;
        let stopCalls = 0;
        class FakeLauncher {
            constructor(core) { launchedCore = core; }
            async startApiServer() { startCalls++; }
            async stopApiServer() { stopCalls++; }
        }
        const launcher = new vm.SyntheticModule(['QQChatExporterApiLauncher'], function () {
            this.setExport('QQChatExporterApiLauncher', FakeLauncher);
        }, { context });
        await launcher.link(() => assert.fail('fake launcher has no imports'));
        await launcher.evaluate();
        const entry = new vm.SourceTextModule(fs.readFileSync(entryPath, 'utf8'), {
            context,
            async importModuleDynamically(specifier) {
                assert.equal(specifier, './runtime/ApiLauncher.mjs', 'unexpected production import');
                return launcher;
            },
        });
        await entry.link(() => assert.fail('unexpected static entrypoint import'));
        await entry.evaluate();
        const { plugin_init, plugin_cleanup, __apiAdapterDebug } = entry.namespace;
        const groupMemberCache = new Map([['g1_u1', { uid: 'u1' }]]);
        const getGroups = async () => [{ groupCode: '1' }];
        const core = {
            context: {
                logger: {
                    log() {},
                    logError() {},
                    logWarn() {},
                    logDebug() {},
                },
            },
            apis: {
                GroupApi: {
                    groupMemberCache,
                    getGroups,
                },
            },
        };

        try {
            await plugin_init(core);
            assert.equal(startCalls, 1, 'the mocked launcher must actually be reached');
            assert.notEqual(launchedCore, core);
            assert.notEqual(launchedCore.apis, core.apis);

            // NapCat's own core.apis must be untouched.
            assert.equal(core.apis.GroupApi.groupMemberCache, groupMemberCache);
            assert.equal(core.apis.GroupApi.groupMemberCache.get('g1_u1').uid, 'u1');
            assert.equal(core.apis.GroupApi.getGroups, getGroups);

            // The QCE runtime adapter exposes the same data safely.
            const adapter = __apiAdapterDebug.lastApis;
            assert.ok(adapter, 'adapter created');
            assert.equal(adapter.GroupApi.groupMemberCache, groupMemberCache);
            assert.equal(typeof adapter.GroupApi.getGroups, 'function');
        } finally {
            await plugin_cleanup();
        }
        assert.equal(stopCalls, 1, 'the fixture launcher must be cleaned up');
        process.stdout.write('CORE_ISOLATION_OK');
        `;
        const output = execFileSync(process.execPath, [
            '--experimental-vm-modules', '--input-type=module', '-e', source,
            fileURLToPath(new URL('../../index.mjs', import.meta.url)),
        ], { encoding: 'utf8', timeout: 10_000, stdio: ['ignore', 'pipe', 'pipe'] });
        assert.equal(output, 'CORE_ISOLATION_OK');
    });
});
