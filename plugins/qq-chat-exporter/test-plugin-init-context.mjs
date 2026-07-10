import { pathToFileURL } from 'node:url';

console.log('[TEST] Plugin context compatibility');

function createLogger(prefix) {
  return {
    log: (...args) => console.log(prefix, ...args),
    logError: (...args) => console.error(prefix, ...args),
    logWarn: (...args) => console.warn(prefix, ...args),
    logDebug: (...args) => console.debug(prefix, ...args)
  };
}

function createMockActions() {
  return new Map([
    ['get_version_info', { handle: async () => ({ data: { app_name: 'NapCat', app_version: 'test' } }) }],
    ['get_login_info', { handle: async () => ({ data: { user_id: 123456, nickname: 'TestBot' } }) }],
    ['send_msg', { handle: async () => ({ data: { message_id: 1 } }) }]
  ]);
}

function createMockCore() {
  return {
    apis: {
      GroupApi: {
        getGroups: async () => [],
        fetchGroupDetail: async () => ({ groupCode: '1', groupName: 'Test Group' }),
        getGroupMemberAll: async () => ({ result: { infos: new Map() } })
      },
      FriendApi: {
        getBuddy: async () => []
      },
      UserApi: {
        getUserDetailInfo: async (uid) => ({ uid, nick: 'TestUser' }),
        getRecentContactListSnapShot: async () => []
      },
      MsgApi: {
        getMsgHistory: async () => ({ msgList: [] }),
        getAioFirstViewLatestMsgs: async () => ({ msgList: [] }),
        getMultiMsg: async () => ({ messages: [] })
      },
      FileApi: {
        downloadMedia: async () => 'test.jpg'
      }
    },
    context: {
      workingEnv: 2,
      logger: createLogger('[MockCore]'),
      pathWrapper: {
        cachePath: './cache',
        tmpPath: './tmp',
        logsPath: './logs'
      }
    },
    selfInfo: {
      online: true,
      uid: '123456',
      uin: '123456',
      nick: 'TestBot'
    }
  };
}

function createPluginContext() {
  const core = createMockCore();
  const actions = createMockActions();
  const obContext = { actions, adapterName: 'OneBot' };
  const instance = { actions, core, config: {} };

  return {
    logger: createLogger('[PluginCtx]'),
    router: {},
    pluginManager: { config: {} },
    NapCatConfig: {},
    pluginName: 'qq-chat-exporter',
    actions,
    core,
    obContext,
    oneBot: obContext,
    instance,
    _ctx: {
      actions,
      obContext,
      oneBot: obContext,
      instance,
      core
    }
  };
}

async function run() {
  const plugin = await import(new URL('./index.mjs', import.meta.url));
  console.log('[PASS] Plugin entrypoint loaded');

  const ctx = createPluginContext();
  await plugin.plugin_init(ctx);

  const bridge = globalThis.__NAPCAT_BRIDGE__;
  if (!bridge) {
    throw new Error('__NAPCAT_BRIDGE__ was not installed');
  }
  if (bridge.ctx !== ctx) {
    throw new Error('bridge.ctx does not reference the original context');
  }
  if (bridge.pluginContext !== ctx) {
    throw new Error('bridge.pluginContext does not reference the original context');
  }
  if (bridge.core !== ctx.core) {
    throw new Error('bridge.core was resolved incorrectly');
  }
  if (bridge.obContext !== ctx.obContext) {
    throw new Error('bridge.obContext was resolved incorrectly');
  }
  if (bridge.actions !== ctx.actions) {
    throw new Error('bridge.actions was resolved incorrectly');
  }

  console.log('[PASS] plugin_init accepted the context object');

  await plugin.plugin_cleanup();
  if (globalThis.__NAPCAT_BRIDGE__ !== undefined) {
    throw new Error('plugin_cleanup did not remove the bridge');
  }

  console.log('[PASS] plugin_cleanup removed runtime state');
  console.log('[PASS] Plugin context compatibility complete');
}

run()
  .catch((error) => {
    console.error('[FAIL] Plugin context compatibility');
    console.error(error instanceof Error ? error.stack : error);
    process.exitCode = 1;
  });
