import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { __apiAdapterDebug, createApiAdapter, plugin_cleanup, plugin_init } from '../../index.mjs';

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
            // plugin_init catches startup failures internally (no qce-server in tests),
            // but the core wrapping happens before the launcher starts.
            await plugin_init(core);

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
    });
});
