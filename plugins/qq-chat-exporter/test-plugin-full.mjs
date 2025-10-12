/**
 * 完整插件测试（包含TypeScript加载）
 */

import { register } from 'node:module';
import { pathToFileURL } from 'node:url';

console.log('========================================');
console.log('完整插件测试（含TypeScript）');
console.log('========================================\n');

// 注册tsx加载器
console.log('1️⃣  注册tsx加载器...\n');
try {
  register('tsx', pathToFileURL('./'));
  console.log('  ✓ tsx加载器已注册\n');
} catch (e) {
  console.error('  ✗ tsx注册失败:', e.message);
  process.exit(1);
}

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
    console.log('✓ Bridge已注入\n');
    
    console.log('2️⃣  测试Overlay加载...\n');
    const { ChatType } = await import('./node_modules/NapCatQQ/src/core/types.js');
    console.log('  ✓ ChatType.KCHATTYPEC2C =', ChatType.KCHATTYPEC2C);
    
    console.log('\n3️⃣  测试TypeScript业务代码加载...\n');
    
    try {
      const ApiLauncher = await import('./lib/api/ApiLauncher.ts');
      console.log('  ✓ ApiLauncher加载成功');
      console.log('    导出:', Object.keys(ApiLauncher));
      
      if (ApiLauncher.QQChatExporterApiLauncher) {
        console.log('  ✓ QQChatExporterApiLauncher类存在');
        
        // 测试实例化（但不启动服务器）
        try {
          const launcher = new ApiLauncher.QQChatExporterApiLauncher(mockCore);
          console.log('  ✓ ApiLauncher实例化成功');
        } catch (e) {
          console.log('  ⚠️  实例化失败（可能缺少依赖）:', e.message);
        }
      }
    } catch (e) {
      console.error('  ✗ ApiLauncher加载失败:', e.message);
      console.error('    堆栈:', e.stack?.split('\n').slice(0, 3).join('\n'));
    }
    
    try {
      const Fetcher = await import('./lib/core/fetcher/BatchMessageFetcher.ts');
      console.log('  ✓ BatchMessageFetcher加载成功');
    } catch (e) {
      console.error('  ✗ BatchMessageFetcher加载失败:', e.message);
    }
    
    console.log('\n========================================');
    console.log('✅ 测试完成！');
    console.log('========================================');
    
  } catch (error) {
    console.log('\n========================================');
    console.log('❌ 测试失败！');
    console.log('========================================');
    console.error('\n错误:', error.message);
    console.error('\n堆栈:');
    console.error(error.stack);
    process.exit(1);
  }
}

test();

