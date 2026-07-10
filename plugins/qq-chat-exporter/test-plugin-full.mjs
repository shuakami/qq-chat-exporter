console.log('[TEST] Rust-only plugin runtime');

// 模拟NapCat环境
const mockCore = {
  apis: {
    GroupApi: {
      getGroups: async () => [],
      fetchGroupDetail: async (id) => ({ groupCode: id, groupName: 'TestGroup' }),
      getGroupMemberAll: async (id) => ({ result: { infos: new Map() } })
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
      downloadMedia: async () => '/tmp/test.jpg'
    }
  },
  context: {
    logger: {
      log: (...args) => console.log('  [Core]', ...args),
      logError: (...args) => console.error('  [Core]', ...args),
      logWarn: (...args) => console.warn('  [Core]', ...args),
      logDebug: (...args) => {}
    },
    pathWrapper: {
      cachePath: './cache',
      tmpPath: './tmp',
      logsPath: './logs'
    }
  },
  selfInfo: {
    online: true,
    uid: '12345',
    uin: '12345',
    nick: 'TestBot'
  }
};

const mockActions = new Map([
  ['get_version_info', {
    handle: async () => ({ 
      data: { app_name: 'NapCat', app_version: '4.8.119' } 
    })
  }],
  ['get_login_info', {
    handle: async () => ({ 
      data: { user_id: 12345, nickname: 'TestBot' } 
    })
  }]
]);
mockActions.get = (key) => mockActions.get(key);

const mockInstance = { config: {} };

async function test() {
  try {
    // 注入Bridge
    globalThis.__NAPCAT_BRIDGE__ = {
      core: mockCore,
      obContext: {},
      actions: mockActions,
      instance: mockInstance
    };
    console.log('[PASS] Mock NapCat bridge installed');

    const ApiLauncher = await import('./runtime/ApiLauncher.mjs');
    console.log(`[PASS] Runtime exports: ${Object.keys(ApiLauncher).join(', ')}`);

    const launcher = new ApiLauncher.QQChatExporterApiLauncher(mockCore);
    console.log('[PASS] API launcher instantiated');
    await launcher.startApiServer();

    const port = Number(process.env.QCE_SERVER_PORT || 40653);
    const health = await fetch(`http://127.0.0.1:${port}/health`);
    if (!health.ok) {
      throw new Error(`Rust health check failed: HTTP ${health.status}`);
    }
    console.log('[PASS] Rust server health endpoint');

    const bridgePort = Number(process.env.QCE_BRIDGE_PORT || 40654);
    const bridgeResponse = await fetch(`http://127.0.0.1:${bridgePort}/rpc`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        id: 1,
        method: 'GroupApi.getGroups',
        params: [false],
      }),
    });
    const bridgeResult = await bridgeResponse.json();
    if (!bridgeResult.ok || !Array.isArray(bridgeResult.result)) {
      throw new Error(`NapCat bridge check failed: ${JSON.stringify(bridgeResult)}`);
    }
    console.log('[PASS] NapCat RPC bridge');
    await launcher.stopApiServer();
    console.log('[PASS] Rust-only runtime validation complete');
    
  } catch (error) {
    console.error('[FAIL] Rust-only runtime validation');
    console.error(error instanceof Error ? error.stack : error);
    process.exit(1);
  }
}

test();
