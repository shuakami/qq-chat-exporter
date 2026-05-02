/**
 * Bridge installation helpers.
 *
 * The QCE plugin reads its environment from `globalThis.__NAPCAT_BRIDGE__`.
 * Tests need to make that global look like a real NapCat host. These helpers
 * wrap the boilerplate so each test file is a single function call.
 */

import type { MockNapCatCore } from './MockNapCatCore.js';

export interface MockBridge {
    core: MockNapCatCore;
    obContext: {
        actions: Map<string, { handle: (...args: unknown[]) => Promise<{ data?: unknown }> }>;
        adapterName: string;
    };
    actions: Map<string, { handle: (...args: unknown[]) => Promise<{ data?: unknown }> }>;
    instance: { actions: Map<string, unknown>; core: MockNapCatCore; config: Record<string, unknown> };
}

declare global {
    // eslint-disable-next-line no-var
    var __NAPCAT_BRIDGE__: MockBridge | undefined;
}

interface InstallOptions {
    core: MockNapCatCore;
    extraActions?: Record<string, (params: unknown) => Promise<unknown>>;
}

/**
 * Install a bridge backed by the supplied MockNapCatCore.
 *
 * Returns the bridge so tests can grab references to actions/instance for
 * extra assertions. Always pair with a call to `uninstallBridge()` (typically
 * in `afterEach` / `t.after`) to keep tests isolated.
 */
export function installBridge(options: InstallOptions): MockBridge {
    const actions = new Map<string, { handle: (...args: unknown[]) => Promise<{ data?: unknown }> }>([
        [
            'get_version_info',
            {
                handle: async () => ({ data: { app_name: 'NapCat', app_version: 'mock' } })
            }
        ],
        [
            'get_login_info',
            {
                handle: async () => ({
                    data: { user_id: Number(options.core.selfInfo.uin), nickname: options.core.selfInfo.nick }
                })
            }
        ],
        [
            'get_forward_msg',
            {
                handle: async (params: unknown) => {
                    const id = (params as { id?: string }).id;
                    if (!id) return { data: { messages: [] } };
                    const result = await options.core.apis.MsgApi.getMultiMsg({ forwardId: id, resId: id });
                    return { data: { messages: result?.msgList ?? [] } };
                }
            }
        ]
    ]);

    if (options.extraActions) {
        for (const [name, fn] of Object.entries(options.extraActions)) {
            actions.set(name, {
                handle: async (params: unknown) => ({ data: await fn(params) })
            });
        }
    }

    const obContext = { actions, adapterName: 'OneBot' };
    const instance = { actions, core: options.core, config: {} };

    const bridge: MockBridge = { core: options.core, obContext, actions, instance };
    globalThis.__NAPCAT_BRIDGE__ = bridge;
    return bridge;
}

/** Tear the global bridge down so tests don't leak state between files. */
export function uninstallBridge(): void {
    delete (globalThis as { __NAPCAT_BRIDGE__?: unknown }).__NAPCAT_BRIDGE__;
}

/**
 * Convenience wrapper: install for the duration of `fn` and uninstall after.
 *
 * Useful inside `it()` blocks when you don't want lifecycle hooks.
 */
export async function withBridge<T>(
    options: InstallOptions,
    fn: (bridge: MockBridge) => Promise<T>
): Promise<T> {
    const bridge = installBridge(options);
    try {
        return await fn(bridge);
    } finally {
        uninstallBridge();
    }
}
