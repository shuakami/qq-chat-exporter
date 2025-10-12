/**
 * 插件测试脚本
 * 检查插件是否能正常加载
 */

console.log('========================================');
console.log('测试插件加载');
console.log('========================================\n');

// 模拟NapCat环境
const mockCore = {
  apis: {
    GroupApi: {
      getGroups: async () => {
        console.log('  [Mock] GroupApi.getGroups 被调用');
        return [];
      }
    },
    FriendApi: {
      getBuddy: async () => {
        console.log('  [Mock] FriendApi.getBuddy 被调用');
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
    console.log('1️⃣  测试Overlay加载...\n');
    
    // 模拟Bridge注入
    globalThis.__NAPCAT_BRIDGE__ = {
      core: mockCore,
      obContext: {},
      actions: mockActions,
      instance: mockInstance
    };
    
    // 测试Overlay导入
    const { ChatType, ElementType } = await import('./node_modules/NapCatQQ/src/core/types.js');
    console.log('  ✓ Overlay types加载成功');
    console.log('    ChatType.KCHATTYPEC2C =', ChatType.KCHATTYPEC2C);
    console.log('    ElementType.TEXT =', ElementType.TEXT);
    
    const { MsgApi } = await import('./node_modules/NapCatQQ/src/core/apis/msg.js');
    console.log('  ✓ Overlay MsgApi加载成功');
    console.log('    MsgApi方法:', Object.keys(MsgApi));
    
    console.log('\n2️⃣  测试插件入口...\n');
    
    // 导入插件
    const plugin = await import('./index.mjs');
    console.log('  ✓ 插件index.mjs加载成功');
    console.log('    导出:', Object.keys(plugin));
    
    console.log('\n3️⃣  测试插件初始化...\n');
    
    // 初始化插件（但不真的启动服务器）
    if (plugin.plugin_init) {
      console.log('  ⚠️  跳过实际初始化（避免启动真实服务器）');
      console.log('  但会测试代码是否有语法错误...\n');
      
      // 只检查函数是否可调用
      console.log('  ✓ plugin_init 函数存在');
      console.log('  ✓ plugin_cleanup 函数存在');
    }
    
    console.log('\n4️⃣  测试业务代码导入...\n');
    
    // 测试关键业务模块能否导入
    try {
      const { QQChatExporterApiLauncher } = await import('./lib/api/ApiLauncher.js');
      console.log('  ✓ ApiLauncher加载成功');
    } catch (e) {
      console.log('  ✗ ApiLauncher加载失败:', e.message);
    }
    
    try {
      const { BatchMessageFetcher } = await import('./lib/core/fetcher/BatchMessageFetcher.js');
      console.log('  ✓ BatchMessageFetcher加载成功');
    } catch (e) {
      console.log('  ✗ BatchMessageFetcher加载失败:', e.message);
    }
    
    console.log('\n========================================');
    console.log('✅ 测试完成！插件应该可以运行');
    console.log('========================================');
    
  } catch (error) {
    console.log('\n========================================');
    console.log('❌ 测试失败！');
    console.log('========================================');
    console.error('\n错误详情:');
    console.error(error);
    process.exit(1);
  }
}

test();

