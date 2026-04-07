import { pathToFileURL } from 'node:url';

console.log('========================================');
console.log('测试 plugin_init 上下文兼容');
console.log('========================================\n');
console.log('1. 使用命令行 --import tsx，脚本内不再 register');

const originalConsoleWarn = console.warn;
const originalSetTimeout = globalThis.setTimeout;
const originalClearTimeout = globalThis.clearTimeout;

const noopTimer = () => ({ __mockTimer: true });
globalThis.setTimeout = noopTimer;
globalThis.clearTimeout = () => {};

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
  console.log('2. 插件入口加载成功');

  console.warn = (...args) => {
    const first = String(args[0] ?? '');
    if (first.includes('NapCatCore overlay init failed')) {
      console.log('3. 捕获到 overlay fallback，属于预期行为');
      return;
    }
    originalConsoleWarn(...args);
  };

  const ctx = createPluginContext();
  await plugin.plugin_init(ctx);

  const bridge = globalThis.__NAPCAT_BRIDGE__;
  if (!bridge) {
    throw new Error('__NAPCAT_BRIDGE__ 未注入');
  }
  if (bridge.ctx !== ctx) {
    throw new Error('bridge.ctx 不是原始 ctx');
  }
  if (bridge.pluginContext !== ctx) {
    throw new Error('bridge.pluginContext 未指向原始 ctx');
  }
  if (bridge.core !== ctx.core) {
    throw new Error('bridge.core 解析错误');
  }
  if (bridge.obContext !== ctx.obContext) {
    throw new Error('bridge.obContext 解析错误');
  }
  if (bridge.actions !== ctx.actions) {
    throw new Error('bridge.actions 解析错误');
  }

  console.log('4. plugin_init(ctx) 兼容通过');

  await plugin.plugin_cleanup();
  if (globalThis.__NAPCAT_BRIDGE__ !== undefined) {
    throw new Error('plugin_cleanup 未清理 bridge');
  }

  console.log('5. plugin_cleanup 清理通过');
  console.log('\n测试通过');
}

run()
  .catch((error) => {
    console.error('\n测试失败:', error);
    process.exitCode = 1;
  })
  .finally(() => {
    console.warn = originalConsoleWarn;
    globalThis.setTimeout = originalSetTimeout;
    globalThis.clearTimeout = originalClearTimeout;
  });
