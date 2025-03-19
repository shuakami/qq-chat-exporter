(function () {
  'use strict';

  // 日志工具类
  const logger = {
    // 颜色方案 - 使用舒适的色彩
    styles: {
      info: 'color: #3498db; font-weight: normal;', // 浅蓝色 - 普通信息
      success: 'color: #2ecc71; font-weight: bold;', // 绿色 - 成功
      warning: 'color: #f39c12; font-weight: bold;', // 橙色 - 警告
      error: 'color: #e74c3c; font-weight: bold;', // 红色 - 错误
      highlight: 'color: #9b59b6; font-weight: bold;', // 紫色 - 高亮
      system: 'color: #7f8c8d; font-style: italic;', // 灰色 - 系统信息
      event: 'color: #1abc9c; font-weight: normal;', // 青绿色 - 事件
      count: 'color: #f1c40f; font-weight: bold;', // 黄色 - 数量信息
    },
    
    // 日志函数
    info: (msg, ...args) => console.log(`%c[INFO] ${msg}`, logger.styles.info, ...args),
    success: (msg, ...args) => console.log(`%c[SUCCESS] ${msg}`, logger.styles.success, ...args),
    warning: (msg, ...args) => console.log(`%c[WARNING] ${msg}`, logger.styles.warning, ...args),
    error: (msg, ...args) => console.error(`%c[ERROR] ${msg}`, logger.styles.error, ...args),
    highlight: (msg, ...args) => console.log(`%c[IMPORTANT] ${msg}`, logger.styles.highlight, ...args),
    system: (msg, ...args) => console.log(`%c[SYSTEM] ${msg}`, logger.styles.system, ...args),
    event: (msg, ...args) => console.log(`%c[EVENT] ${msg}`, logger.styles.event, ...args),
    count: (msg, ...args) => console.log(`%c[COUNT] ${msg}`, logger.styles.count, ...args),
    
    // 特殊格式化输出
    startSection: (title) => {
      console.log(`\n%c========== ${title} ==========`, 'color: #3498db; background: #f8f9fa; font-size: 14px; font-weight: bold; padding: 4px 8px; border-radius: 4px;');
    },
    
    endSection: (title) => {
      console.log(`%c========== ${title} 结束 ==========\n`, 'color: #7f8c8d; background: #f8f9fa; font-size: 12px; padding: 2px 8px; border-radius: 4px;');
    },
    
    // 添加分隔线
    divider: () => console.log('%c----------------------------------------', 'color: #bdc3c7;')
  };

  // Web Worker 脚本代码
  const workerCode = `
  onmessage = function(e) {
    const {records, format, sortOrder} = e.data;
    
    // 根据排序参数对记录进行排序
    records.sort((a, b) => {
      if (sortOrder === 'asc') {
        return a.id - b.id; // 正序：ID小的在前(较早的消息)
      } else {
        return b.id - a.id; // 倒序：ID大的在前(较新的消息)
      }
    });
    
    let result = "";
    if(format === 'json'){
      result = JSON.stringify(records, null, 2);
    } else if(format === 'txt'){
      result = records.map(rec => rec.id + "\\t" + rec.time + "\\t" + rec.sender + "\\t" + rec.content).join("\\n");
    }
    postMessage(result);
  };
`;

  // 导出聊天记录
  async function exportChatRecords(db, recordId, format = 'json', sortOrder = 'asc') {
    // 增强格式参数处理
    if (typeof format !== 'string') {
      format = 'json';
      logger.warning('未指定正确的格式参数，已默认使用JSON格式');
    }
    
    // 规范化格式参数
    format = format.toLowerCase().trim();
    if (format !== 'json' && format !== 'txt') {
      format = 'json';
      logger.warning('格式参数只支持"json"或"txt"，已默认使用JSON格式');
    }
    
    // 规范化排序参数
    if (typeof sortOrder !== 'string') {
      sortOrder = 'asc';
      logger.warning('未指定正确的排序参数，已默认使用时间正序');
    } else {
      sortOrder = sortOrder.toLowerCase().trim();
      if (sortOrder !== 'asc' && sortOrder !== 'desc') {
        sortOrder = 'asc';
        logger.warning('排序参数只支持"asc"或"desc"，已默认使用时间正序');
      }
    }
    
    logger.highlight(`开始导出聊天记录 [${format.toUpperCase()}格式, ${sortOrder === 'asc' ? '时间正序' : '时间倒序'}]`);
    
    const blob = new Blob([workerCode], { type: 'application/javascript' });
    const worker = new Worker(URL.createObjectURL(blob));
    
    return new Promise((resolve, reject) => {
      worker.onmessage = function(e) {
        const output = e.data;
        logger.success(`导出完成 (${format.toUpperCase()}格式)`);
        
        // 触发下载
        const date = new Date().toISOString().slice(0, 10);
        const a = document.createElement('a');
        const blobFile = new Blob([output], { type: 'text/plain;charset=utf-8' });
        a.href = URL.createObjectURL(blobFile);
        a.download = `chat_records_${date}_${sortOrder}.${format}`;
        a.click();
        
        logger.info(`文件 chat_records_${date}_${sortOrder}.${format} 已保存到下载文件夹`);
        resolve();
      };
      
      // 获取当前 session 的全部数据库记录
      db.records.where("session").equals(recordId).toArray().then(records => {
        if (records.length === 0) {
          logger.error("没有找到可导出的聊天记录！请确保已正确获取聊天内容");
          reject(new Error("没有找到可导出的聊天记录"));
          return;
        }
        logger.system(`正在处理 ${records.length} 条记录...`);
        worker.postMessage({ records, format, sortOrder });
      }).catch(error => {
        logger.error(`读取数据库失败: ${error.message}`);
        logger.warning("如果您刚刚运行了脚本，请等待自动滚动完成后再导出");
        reject(error);
      });
    });
  }

  // 预览聊天记录
  async function previewChatRecords(db, recordId, sortOrder = 'asc') {
    // 规范化排序参数
    sortOrder = (typeof sortOrder === 'string' && (sortOrder.toLowerCase() === 'desc')) ? 'desc' : 'asc';
    
    logger.highlight(`正在获取聊天记录预览 (${sortOrder === 'asc' ? '时间正序' : '时间倒序'})`);
    
    try {
      const records = await db.records.where("session").equals(recordId).toArray();
      if (records.length === 0) {
        logger.error("没有找到可预览的聊天记录！");
        return;
      }
      
      // 根据ID排序（ID越大时间越新）
      records.sort((a, b) => {
        if (sortOrder === 'asc') {
          return a.id - b.id; // 正序：ID小的在前(较早的消息)
        } else {
          return b.id - a.id; // 倒序：ID大的在前(较新的消息)
        }
      });
      
      // 在控制台以表格形式显示前20条
      console.table(records.slice(0, 20).map(r => ({
        id: r.id,
        time: r.time,
        sender: r.sender,
        content: r.content.length > 50 ? r.content.substring(0, 50) + '...' : r.content
      })));
      
      logger.success(`共有 ${records.length} 条记录，上表显示前20条`);
      logger.system(`当前排序: ${sortOrder === 'asc' ? '时间正序 (ID小→大，较早→较新)' : '时间倒序 (ID大→小，较新→较早)'}`);
    } catch (error) {
      logger.error(`预览失败: ${error.message}`);
    }
  }

  async function createHistoryManager() {
    // 创建样式
    const styleElement = document.createElement('style');
    styleElement.textContent = `
    .history-manager {
      position: fixed;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      width: 90%;
      max-width: 800px;
      max-height: 90vh;
      background: rgba(255, 255, 255, 0.98);
      border-radius: 16px;
      box-shadow: 0 4px 24px rgba(0, 0, 0, 0.12);
      font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      z-index: 10000;
      overflow: hidden;
      border: 1px solid rgba(0, 0, 0, 0.06);
      backdrop-filter: blur(20px);
      -webkit-backdrop-filter: blur(20px);
      animation: fadeIn 0.3s ease-out;
      display: none;
    }

    @keyframes fadeIn {
      from {
        opacity: 0;
        transform: translate(-50%, -48%);
      }
      to {
        opacity: 1;
        transform: translate(-50%, -50%);
      }
    }

    .history-manager.visible {
      display: block;
    }

    .history-manager-overlay {
      position: fixed;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      background: rgba(0, 0, 0, 0.4);
      backdrop-filter: blur(4px);
      -webkit-backdrop-filter: blur(4px);
      z-index: 9999;
      animation: fadeIn 0.3s ease-out;
      display: none;
    }

    .history-manager-overlay.visible {
      display: block;
    }

    .history-manager-header {
      padding: 20px 24px;
      border-bottom: 1px solid rgba(0, 0, 0, 0.08);
      display: flex;
      justify-content: space-between;
      align-items: center;
    }

    .history-manager-title {
      font-size: 18px;
      font-weight: 600;
      color: #000;
      margin: 0;
      display: flex;
      align-items: center;
      gap: 12px;
    }

    .history-manager-close {
      padding: 8px;
      margin: -8px;
      cursor: pointer;
      opacity: 0.6;
      transition: all 0.2s;
      border: none;
      background: none;
      color: #000;
      display: flex;
      align-items: center;
      justify-content: center;
      border-radius: 8px;
    }

    .history-manager-close:hover {
      opacity: 1;
      background: rgba(0, 0, 0, 0.05);
    }

    .history-manager-body {
      padding: 20px 24px;
      overflow-y: auto;
      max-height: calc(90vh - 140px);
    }

    .history-manager-empty {
      text-align: center;
      padding: 40px 0;
      color: #666;
      font-size: 14px;
    }

    .history-list {
      display: grid;
      gap: 12px;
      grid-template-columns: repeat(auto-fill, minmax(360px, 1fr));
    }

    .history-item {
      background: rgba(0, 0, 0, 0.02);
      border: 1px solid rgba(0, 0, 0, 0.04);
      border-radius: 12px;
      padding: 16px;
      transition: all 0.2s;
    }

    .history-item:hover {
      background: rgba(0, 0, 0, 0.03);
      transform: translateY(-1px);
    }

    .history-item-header {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      margin-bottom: 12px;
    }

    .history-item-title {
      font-size: 15px;
      font-weight: 500;
      color: #000;
      margin: 0;
    }

    .history-item-time {
      font-size: 12px;
      color: #666;
    }

    .history-item-info {
      font-size: 13px;
      color: #666;
      margin: 8px 0;
    }

    .history-item-actions {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 8px;
      margin-top: 12px;
    }

    .history-item-btn {
      padding: 8px;
      border: none;
      border-radius: 8px;
      font-size: 13px;
      font-weight: 500;
      cursor: pointer;
      transition: all 0.2s;
      text-align: center;
      background: rgba(0, 0, 0, 0.03);
      color: #333;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 6px;
    }

    .history-item-btn:hover {
      background: rgba(0, 0, 0, 0.06);
    }

    .history-item-btn.primary {
      background: #1e90ff;
      color: white;
    }

    .history-item-btn.primary:hover {
      background: #1a7ee6;
    }

    .history-item-btn svg {
      width: 14px;
      height: 14px;
      opacity: 0.8;
    }

    .history-manager-footer {
      padding: 16px 24px;
      border-top: 1px solid rgba(0, 0, 0, 0.08);
      display: flex;
      justify-content: space-between;
      align-items: center;
      background: rgba(0, 0, 0, 0.01);
    }

    .history-manager-stats {
      font-size: 13px;
      color: #666;
    }

    .history-manager-actions {
      display: flex;
      gap: 8px;
    }

    .history-manager-btn {
      padding: 8px 16px;
      border: none;
      border-radius: 8px;
      font-size: 13px;
      font-weight: 500;
      cursor: pointer;
      transition: all 0.2s;
      background: rgba(0, 0, 0, 0.03);
      color: #333;
    }

    .history-manager-btn:hover {
      background: rgba(0, 0, 0, 0.06);
    }

    .history-manager-btn.danger {
      background: #ff4d4f;
      color: white;
    }

    .history-manager-btn.danger:hover {
      background: #ff3333;
    }
  `;
    document.head.appendChild(styleElement);

    // 创建遮罩层
    const overlay = document.createElement('div');
    overlay.className = 'history-manager-overlay';
    document.body.appendChild(overlay);

    // 创建主界面
    const managerDiv = document.createElement('div');
    managerDiv.className = 'history-manager';
    managerDiv.innerHTML = `
    <div class="history-manager-header">
      <h3 class="history-manager-title">
        历史记录管理
      </h3>
      <button class="history-manager-close" aria-label="关闭">
        <svg width="15" height="15" viewBox="0 0 15 15" fill="none">
          <path d="M1.5 1.5l12 12m-12 0l12-12" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
        </svg>
      </button>
    </div>
    <div class="history-manager-body">
      <div class="history-list"></div>
      <div class="history-manager-empty">正在加载历史记录...</div>
    </div>
    <div class="history-manager-footer">
      <div class="history-manager-stats"></div>
      <div class="history-manager-actions">
        <button class="history-manager-btn danger" id="clearHistoryBtn">清空所有记录</button>
      </div>
    </div>
  `;
    document.body.appendChild(managerDiv);

    // 关闭按钮功能
    const closeBtn = managerDiv.querySelector('.history-manager-close');
    closeBtn.addEventListener('click', () => {
      managerDiv.classList.remove('visible');
      overlay.classList.remove('visible');
    });

    // 加载历史记录
    async function loadHistory() {
      const historyList = managerDiv.querySelector('.history-list');
      const emptyState = managerDiv.querySelector('.history-manager-empty');
      const stats = managerDiv.querySelector('.history-manager-stats');

      try {
        // 获取所有数据库
        const databases = await window.indexedDB.databases();
        const chatDatabases = databases.filter(db => db.name.startsWith('ChatRecords_'));

        if (chatDatabases.length === 0) {
          emptyState.textContent = '暂无历史记录';
          stats.textContent = '共 0 条历史记录';
          return;
        }

        emptyState.style.display = 'none';
        historyList.innerHTML = '';
        let totalRecords = 0;

        // 处理每个数据库
        for (const dbInfo of chatDatabases) {
          const db = new Dexie(dbInfo.name);
          db.version(1).stores({
            records: '++id, session, timestamp, time, sender, content'
          });
          await db.open();
          
          const records = await db.table('records').toArray();
          if (records.length === 0) continue;

          // 获取会话信息
          const sessionId = records[0].session;
          const timestamp = new Date(records[0].timestamp);
          const senders = [...new Set(records.map(r => r.sender))].filter(Boolean);

          // 创建历史记录项
          const historyItem = document.createElement('div');
          historyItem.className = 'history-item';
          historyItem.innerHTML = `
          <div class="history-item-header">
            <h4 class="history-item-title">${senders.join(', ') || '未知对话'}</h4>
            <span class="history-item-time">${timestamp.toLocaleString()}</span>
          </div>
          <div class="history-item-info">
            共 ${records.length} 条消息
          </div>
          <div class="history-item-actions">
            <button class="history-item-btn primary" data-action="json" data-db="${dbInfo.name}">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M20 12V4H4v16h16v-8M16 2v4M8 2v4M4 8h16"/>
              </svg>
              JSON
            </button>
            <button class="history-item-btn" data-action="txt" data-db="${dbInfo.name}">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                <path d="M14 2v6h6M8 13h8M8 17h8M8 9h2"/>
              </svg>
              TXT
            </button>
            <button class="history-item-btn" data-action="preview" data-db="${dbInfo.name}">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
                <circle cx="12" cy="12" r="3"/>
              </svg>
              预览
            </button>
          </div>
        `;

          // 添加按钮事件
          const buttons = historyItem.querySelectorAll('.history-item-btn');
          buttons.forEach(btn => {
            btn.addEventListener('click', async () => {
              const action = btn.dataset.action;
              const dbName = btn.dataset.db;
              const db = new Dexie(dbName);
              db.version(1).stores({
                records: '++id, session, timestamp, time, sender, content'
              });
              await db.open();
              const sessionId = records[0].session;

              switch (action) {
                case 'json':
                  await exportChatRecords(db, sessionId, 'json', 'asc');
                  break;
                case 'txt':
                  await exportChatRecords(db, sessionId, 'txt', 'asc');
                  break;
                case 'preview':
                  await previewChatRecords(db, sessionId, 'asc');
                  break;
              }
            });
          });

          historyList.appendChild(historyItem);
          totalRecords += records.length;
        }

        stats.textContent = `共 ${chatDatabases.length} 条历史记录，${totalRecords} 条消息`;

        // 清空历史按钮功能
        const clearBtn = document.getElementById('clearHistoryBtn');
        clearBtn.addEventListener('click', async () => {
          if (confirm('确定要清空所有历史记录吗？此操作不可恢复！')) {
            for (const dbInfo of chatDatabases) {
              await Dexie.delete(dbInfo.name);
            }
            loadHistory(); // 重新加载（显示空状态）
          }
        });

      } catch (error) {
        console.error('加载历史记录失败:', error);
        emptyState.textContent = '加载历史记录失败';
      }
    }

    // 显示管理器
    function show() {
      managerDiv.classList.add('visible');
      overlay.classList.add('visible');
      loadHistory();
    }

    return {
      show
    };
  }

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
    historyManager.show();
  }

  // 导出全局方法
  window.QCEHistory = {
    show: init
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

})();
