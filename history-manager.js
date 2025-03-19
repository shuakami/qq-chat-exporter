import { createHistoryManager } from './components/HistoryManager.js';

// 创建全局实例
let historyManager = null;

// 初始化函数
async function init() {
  // 确保 Dexie 已加载
  if (!window.Dexie) {
    try {
      await new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = 'https://cdn.bootcdn.net/ajax/libs/dexie/3.2.2/dexie.min.js';
        script.onload = resolve;
        script.onerror = reject;
        document.head.appendChild(script);
      });
      console.log('Dexie.js 已成功加载');
    } catch (error) {
      console.error('加载 Dexie.js 失败:', error);
      return;
    }
  }

  // 创建历史管理器
  if (!historyManager) {
    historyManager = await createHistoryManager();
  }
}

// 注册快捷键
document.addEventListener('keydown', async (event) => {
  if (event.ctrlKey && event.key === 'F9') {
    event.preventDefault();
    if (!historyManager) {
      await init();
    }
    historyManager.show();
  }
});

// 导出全局方法
window.QCEHistory = {
  show: async () => {
    if (!historyManager) {
      await init();
    }
    historyManager.show();
  }
};

// 等待 DOM 加载完成后初始化
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    init().catch(error => {
      console.error('历史管理器初始化失败:', error);
    });
  });
} else {
  init().catch(error => {
    console.error('历史管理器初始化失败:', error);
  });
} 