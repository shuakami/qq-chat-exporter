/**
 * 插件测试脚本
 * 检查插件是否能正常加载
 */

console.log('[TEST] Plugin entrypoint');

// 模拟NapCat环境
const mockCore = {
  apis: {
    GroupApi: {
      getGroups: async () => {
        console.log('[MOCK] GroupApi.getGroups');
        return [];
      }
    },
    FriendApi: {
      getBuddy: async () => {
        console.log('[MOCK] FriendApi.getBuddy');
        return [];
      }
    }
  },
  context: {
    logger: {
      log: (...args) => console.log('  [Core Log]', ...args),
      logError: (...args) => console.error('  [Core Error]', ...args),
      logWarn: (...args) => console.warn('  [Core Warn]', ...args),
      logDebug: (...args) => console.debug('  [Core Debug]', ...args)
    }
  },
  selfInfo: {
    online: true,
    uid: 'test-uid',
    uin: 'test-uin',
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
      data: { user_id: '123456', nickname: 'TestBot' } 
    })
  }]
]);
mockActions.get = (key) => mockActions.get(key);

const mockInstance = {
  config: {}
};

async function test() {
  try {
    // 模拟Bridge注入
    globalThis.__NAPCAT_BRIDGE__ = {
      core: mockCore,
      obContext: {},
      actions: mockActions,
      instance: mockInstance
    };
    
    // 导入插件
    const plugin = await import('./index.mjs');
    if (typeof plugin.plugin_init !== 'function' || typeof plugin.plugin_cleanup !== 'function') {
      throw new Error('Required plugin lifecycle exports are missing');
    }

    console.log(`[PASS] Entrypoint exports: ${Object.keys(plugin).join(', ')}`);
    
  } catch (error) {
    console.error('[FAIL] Plugin entrypoint validation');
    console.error(error instanceof Error ? error.stack : error);
    process.exit(1);
  }
}

test();
