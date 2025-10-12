// 真实的插件加载测试
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

console.log('[Test] Starting plugin loader test...');

// 模拟 NapCat 核心
const mockCore = {
  context: {
    logger: {
      log: (...args) => console.log('[Core]', ...args),
      logDebug: (...args) => console.log('[Core][Debug]', ...args),
      logError: (...args) => console.error('[Core][Error]', ...args),
      logWarn: (...args) => console.warn('[Core][Warn]', ...args)
    },
    pathWrapper: {
      cachePath: join(__dirname, 'cache'),
      tmpPath: join(__dirname, 'tmp'),
      logsPath: join(__dirname, 'logs'),
      pluginPath: join(__dirname, 'plugins')
    }
  },
  apis: {
    MsgApi: {
      getMsgHistory: async (peer, msgId, count) => {
        console.log('[Mock] getMsgHistory called:', { peer, msgId, count });
        return { msgList: [] };
      },
      getAioFirstViewLatestMsgs: async (peer, count) => {
        console.log('[Mock] getAioFirstViewLatestMsgs called:', { peer, count });
        return { msgList: [] };
      },
      getMultiMsg: async (params) => {
        console.log('[Mock] getMultiMsg called:', params);
        return { messages: [] };
      }
    },
    FileApi: {
      downloadMedia: async (...args) => {
        console.log('[Mock] downloadMedia called:', args.length, 'params');
        return '/mock/path/file.jpg';
      }
    },
    GroupApi: {
      getGroups: async () => {
        console.log('[Mock] getGroups called');
        return [];
      },
      fetchGroupDetail: async (groupId) => {
        console.log('[Mock] fetchGroupDetail called:', groupId);
        return { groupCode: groupId, groupName: 'TestGroup' };
      },
      getGroupMemberAll: async (groupId) => {
        console.log('[Mock] getGroupMemberAll called:', groupId);
        return { result: { infos: new Map() } };
      }
    },
    UserApi: {
      getUserDetailInfo: async (uid) => {
        console.log('[Mock] getUserDetailInfo called:', uid);
        return { uid, nick: 'TestUser' };
      },
      getRecentContactListSnapShot: async (count) => {
        console.log('[Mock] getRecentContactListSnapShot called:', count);
        return [];
      }
    },
    FriendApi: {
      getBuddy: async () => {
        console.log('[Mock] getBuddy called');
        return [];
      }
    }
  },
  selfInfo: {
    online: true,
    uid: '12345',
    uin: '12345',
    nick: 'TestBot'
  }
};

// 模拟 OneBot actions
const mockActions = new Map();
mockActions.set('get_version_info', {
  handle: async () => ({
    data: { app_name: 'NapCat', app_version: '4.8.105-test', protocol_version: 'v11' }
  })
});
mockActions.set('get_login_info', {
  handle: async () => ({
    data: { user_id: 12345, nickname: 'TestBot' }
  })
});

const mockInstance = {
  config: {}
};

// 查找并加载插件
const pluginsDir = join(__dirname, 'plugins');
console.log('[Test] Looking for plugins in:', pluginsDir);

if (!fs.existsSync(pluginsDir)) {
  console.error('[Test] Plugins directory not found!');
  process.exit(1);
}

const plugins = fs.readdirSync(pluginsDir);
console.log('[Test] Found plugins:', plugins);

for (const pluginName of plugins) {
  const pluginPath = join(pluginsDir, pluginName);
  const stat = fs.statSync(pluginPath);
  
  if (!stat.isDirectory()) continue;
  
  const pluginEntry = join(pluginPath, 'index.mjs');
  if (!fs.existsSync(pluginEntry)) {
    console.log('[Test] No index.mjs found in:', pluginName);
    continue;
  }
  
  console.log(`\n[Test] ======================================`);
  console.log(`[Test] Loading plugin: ${pluginName}`);
  console.log(`[Test] ======================================`);
  
  try {
    // 动态导入插件
    const plugin = await import(`file:///${pluginEntry.replace(/\\/g, '/')}`);
    
    if (typeof plugin.plugin_init !== 'function') {
      console.error('[Test] Plugin missing plugin_init function!');
      continue;
    }
    
    console.log('[Test] Calling plugin_init...');
    await plugin.plugin_init(mockCore, null, mockActions, mockInstance);
    
    console.log(`[Test] ✓ Plugin ${pluginName} loaded successfully!`);
    
    // 测试 Bridge
    if (globalThis.__NAPCAT_BRIDGE__) {
      console.log('[Test] Bridge detected!');
      console.log('[Test] Bridge keys:', Object.keys(globalThis.__NAPCAT_BRIDGE__));
      
      // 测试 Overlay API
      console.log('\n[Test] Testing Overlay API...');
      try {
        const overlayPath = join(pluginPath, 'node_modules/NapCatQQ/src');
        
        const { ChatType } = await import(`file:///${join(overlayPath, 'core/types.js').replace(/\\/g, '/')}`);
        console.log('[Test] ✓ ChatType imported, KCHATTYPEC2C =', ChatType.KCHATTYPEC2C);
        
        const { MsgApi } = await import(`file:///${join(overlayPath, 'core/apis/msg.js').replace(/\\/g, '/')}`);
        console.log('[Test] ✓ MsgApi imported');
        
        // 测试 API 调用
        console.log('[Test] Testing MsgApi.getMsgHistory...');
        const result = await MsgApi.getMsgHistory(
          { chatType: 2, peerUid: '12345', guildId: '' },
          'test-msg-id',
          10,
          false
        );
        console.log('[Test] ✓ MsgApi.getMsgHistory result:', result);
        
      } catch (err) {
        console.error('[Test] ✗ Overlay API test failed:', err.message);
        console.error(err.stack);
      }
    }
    
    // 给服务器启动一些时间
    console.log('\n[Test] Waiting 3 seconds for server to start...');
    await new Promise(resolve => setTimeout(resolve, 3000));
    
    // 测试 HTTP 端点
    console.log('[Test] Testing HTTP endpoint...');
    try {
      const response = await fetch('http://127.0.0.1:40653/qce/system/info');
      console.log('[Test] HTTP Status:', response.status, response.statusText);
      if (response.status === 401) {
        console.log('[Test] ✓ Server is running (authentication required)');
      } else if (response.ok) {
        const data = await response.json();
        console.log('[Test] ✓ System info:', data);
      }
    } catch (err) {
      console.error('[Test] ✗ HTTP test failed:', err.message);
    }
    
    // 清理
    if (typeof plugin.plugin_cleanup === 'function') {
      console.log('\n[Test] Cleaning up plugin...');
      await plugin.plugin_cleanup();
      console.log('[Test] ✓ Plugin cleaned up');
    }
    
  } catch (error) {
    console.error(`[Test] ✗ Failed to load plugin ${pluginName}:`, error.message);
    console.error(error.stack);
  }
}

console.log('\n[Test] ======================================');
console.log('[Test] All tests completed!');
console.log('[Test] ======================================');
process.exit(0);

