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

  // 延迟函数
  const delay$1 = (ms) => new Promise(resolve => setTimeout(resolve, ms));

  // 直接激活焦点并发送键盘事件
  function activateFocusAndPressKey(container, key) {
    document.activeElement.blur();
    container.focus();
    const keyCode = key === 'PageUp' ? 33 : 34;
    const kdEvent = new KeyboardEvent('keydown', {
      bubbles: true,
      cancelable: true,
      key: key,
      code: key === 'PageUp' ? 'PageUp' : 'PageDown',
      keyCode: keyCode,
      which: keyCode,
      composed: true,
      view: window
    });
    try {
      Object.defineProperties(kdEvent, {
        keyCode: { value: keyCode },
        which: { value: keyCode },
        key: { value: key }
      });
    } catch (e) { }
    container.dispatchEvent(kdEvent);
    setTimeout(() => {
      const kuEvent = new KeyboardEvent('keyup', {
        bubbles: true,
        cancelable: true,
        key: key,
        code: key === 'PageUp' ? 'PageUp' : 'PageDown',
        keyCode: keyCode,
        which: keyCode,
        composed: true,
        view: window
      });
      try {
        Object.defineProperties(kuEvent, {
          keyCode: { value: keyCode },
          which: { value: keyCode },
          key: { value: key }
        });
      } catch (e) { }
      container.dispatchEvent(kuEvent);
    }, 100);
  }

  // 模拟输入流
  function simulateInputFlow(container, key, scrollDuration) {
    const keyCode = key === 'PageUp' ? 33 : 34;
    container.focus();
    const beforeInputEvent = new InputEvent('beforeinput', {
      bubbles: true,
      cancelable: true,
      inputType: 'insertText',
      data: key
    });
    container.dispatchEvent(beforeInputEvent);
    const keydownEvent = new KeyboardEvent('keydown', {
      bubbles: true,
      cancelable: true,
      key: key,
      code: key === 'PageUp' ? 'PageUp' : 'PageDown',
      keyCode: keyCode,
      which: keyCode
    });
    container.dispatchEvent(keydownEvent);
    let pressTime = 0;
    const totalTime = scrollDuration;
    const pressInterval = setInterval(() => {
      pressTime += 100;
      if (pressTime >= totalTime) {
        clearInterval(pressInterval);
        const keyupEvent = new KeyboardEvent('keyup', {
          bubbles: true,
          cancelable: true,
          key: key,
          code: key === 'PageUp' ? 'PageUp' : 'PageDown',
          keyCode: keyCode,
          which: keyCode
        });
        container.dispatchEvent(keyupEvent);
        const inputEvent = new InputEvent('input', {
          bubbles: true,
          cancelable: true,
          inputType: 'insertText',
          data: key
        });
        container.dispatchEvent(inputEvent);
      }
    }, 100);
  }

  // 模拟滚轮事件
  function simulateWheelEvent(element, deltaY, scrollDuration) {
    const duration = scrollDuration;
    const steps = Math.floor(duration / 50);
    const stepDelta = deltaY / steps;
    let currentStep = 0;
    const wheelInterval = setInterval(() => {
      if (currentStep >= steps) {
        clearInterval(wheelInterval);
        return;
      }
      const wheelEvent = new WheelEvent('wheel', {
        bubbles: true,
        cancelable: true,
        deltaY: stepDelta,
        deltaMode: 0,
      });
      element.dispatchEvent(wheelEvent);
      currentStep++;
    }, 50);
  }

  // 多种不同的滚动方法
  async function scrollWithMethod(container, direction, method, scrollDuration) {
    const pageSize = container.clientHeight;
    switch (method) {
      case 0:
        container.focus();
        activateFocusAndPressKey(container, direction === 'up' ? 'PageUp' : 'PageDown');
        break;
      case 1:
        container.focus();
        simulateInputFlow(container, direction === 'up' ? 'PageUp' : 'PageDown', scrollDuration);
        break;
      case 2:
        if (typeof container.scroll === 'function') {
          if (direction === 'up') {
            container.scroll(0, container.scrollTop - pageSize);
          } else {
            container.scroll(0, container.scrollTop + pageSize * 0.3);
          }
        } else {
          if (direction === 'up') {
            container.scrollTop -= pageSize;
          } else {
            container.scrollTop += pageSize * 0.3;
          }
        }
        break;
      case 3:
        simulateWheelEvent(container, direction === 'up' ? -pageSize : pageSize * 0.3, scrollDuration);
        break;
      case 4:
        container.scrollTo({
          top: direction === 'up' ? container.scrollTop - pageSize : container.scrollTop + pageSize * 0.3,
          behavior: 'smooth'
        });
        break;
    }
    container.dispatchEvent(new Event('scroll', { bubbles: true }));
  }

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

  // 显示导出帮助信息
  function showExportHelp() {
    logger.highlight('【导出方法】请使用以下方式导出聊天记录:');
    logger.info('1. 点击页面右下角的导出按钮');
    logger.info('2. 或在控制台输入以下命令:');
    logger.system('   - JSON格式(时间正序): exportChatRecords("json", "asc")');
    logger.system('   - JSON格式(时间倒序): exportChatRecords("json", "desc")');
    logger.system('   - TXT格式(时间正序): exportChatRecords("txt", "asc")');
    logger.system('   - TXT格式(时间倒序): exportChatRecords("txt", "desc")');
    logger.divider();
    logger.info('排序说明:');
    logger.system('- 时间正序(asc): 从早到晚，旧消息在前，新消息在后');
    logger.system('- 时间倒序(desc): 从晚到早，较新的消息在前，较早的消息在后');
  }

  // 创建导出工具的UI组件
  function createChatExporter(db, recordId, messageCount) {
    const styleElement = document.createElement('style');
    styleElement.textContent = `
    @keyframes slideIn {
      from {
        opacity: 0;
        transform: translateY(20px);
      }
      to {
        opacity: 1;
        transform: translateY(0);
      }
    }

    .chat-exporter {
      position: fixed;
      bottom: 20px;
      right: 20px;
      width: 320px;
      background: rgba(255, 255, 255, 0.95);
      border-radius: 16px;
      box-shadow: 0 4px 24px rgba(0, 0, 0, 0.08);
      font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      z-index: 9999;
      transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
      overflow: hidden;
      border: 1px solid rgba(0, 0, 0, 0.04);
      backdrop-filter: blur(20px);
      -webkit-backdrop-filter: blur(20px);
      animation: slideIn 0.3s cubic-bezier(0.4, 0, 0.2, 1);
      display: none;
    }
    
    .chat-exporter.visible {
      display: block;
    }
    
    .chat-exporter:hover {
      box-shadow: 0 8px 32px rgba(0, 0, 0, 0.12);
    }
    
    .chat-exporter-header {
      padding: 16px 20px;
      display: flex;
      justify-content: space-between;
      align-items: center;
      border-bottom: 1px solid rgba(0, 0, 0, 0.06);
    }
    
    .chat-exporter-title-group {
      display: flex;
      align-items: center;
      gap: 8px;
    }
  
    
    .chat-exporter-title {
      margin: 0;
      font-size: 15px;
      font-weight: 600;
      color: #000;
    }
    
    .chat-exporter-close {
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
    
    .chat-exporter-close:hover {
      opacity: 1;
      background: rgba(0, 0, 0, 0.05);
    }
    
    .chat-exporter-body {
      padding: 20px;
    }
    
    .chat-exporter-section-title {
      font-size: 13px;
      font-weight: 500;
      color: #666;
      margin: 0 0 12px 0;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }
    
    .chat-exporter-options {
      background: rgba(0, 0, 0, 0.02);
      padding: 12px 16px;
      border-radius: 12px;
      margin-bottom: 20px;
      border: 1px solid rgba(0, 0, 0, 0.04);
    }
    
    .chat-exporter-option {
      display: flex;
      align-items: center;
      padding: 8px 0;
    }
    
    .chat-exporter-option:not(:last-child) {
      border-bottom: 1px solid rgba(0, 0, 0, 0.04);
    }
    
    .chat-exporter-option input[type="radio"] {
      margin: 0;
      width: 16px;
      height: 16px;
      margin-right: 12px;
      accent-color: #1e90ff;
    }
    
    .chat-exporter-option label {
      font-size: 14px;
      color: #333;
      cursor: pointer;
      user-select: none;
    }
    
    .chat-exporter-buttons {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 8px;
    }
    
    .chat-exporter-btn {
      padding: 10px;
      border: none;
      border-radius: 10px;
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
    
    .chat-exporter-btn:hover {
      background: rgba(0, 0, 0, 0.06);
    }
    
    .chat-exporter-btn.primary {
      background: #1e90ff;
      color: white;
    }
    
    .chat-exporter-btn.primary:hover {
      background: #1a7ee6;
    }
    
    .chat-exporter-btn svg {
      width: 14px;
      height: 14px;
      opacity: 0.8;
    }
    
    .chat-exporter-footer {
      padding: 12px 20px;
      font-size: 12px;
      color: #666;
      text-align: center;
      background: rgba(0, 0, 0, 0.02);
      border-top: 1px solid rgba(0, 0, 0, 0.04);
    }
    
    .tooltip {
      position: relative;
    }
    
    .tooltip .tooltiptext {
      visibility: hidden;
      width: 200px;
      background: rgba(0, 0, 0, 0.8);
      backdrop-filter: blur(8px);
      -webkit-backdrop-filter: blur(8px);
      color: white;
      text-align: center;
      border-radius: 8px;
      padding: 8px 12px;
      position: absolute;
      z-index: 1;
      bottom: 125%;
      left: 50%;
      margin-left: -100px;
      opacity: 0;
      transition: all 0.2s;
      font-size: 12px;
      font-weight: normal;
      box-shadow: 0 4px 16px rgba(0, 0, 0, 0.16);
      pointer-events: none;
    }
    
    .tooltip:hover .tooltiptext {
      visibility: visible;
      opacity: 1;
      transform: translateY(-4px);
    }
    
    .restore-btn {
      position: fixed;
      bottom: 20px;
      right: 20px;
      width: 40px;
      height: 40px;
      background: #1e90ff;
      border-radius: 10px;
      color: white;
      display: flex;
      align-items: center;
      justify-content: center;
      cursor: pointer;
      box-shadow: 0 4px 12px rgba(30, 144, 255, 0.2);
      z-index: 9999;
      border: none;
      transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
      animation: slideIn 0.3s cubic-bezier(0.4, 0, 0.2, 1);
    }
    
    .restore-btn:hover {
      transform: translateY(-2px);
      box-shadow: 0 8px 24px rgba(30, 144, 255, 0.25);
    }

    .chat-exporter-loading {
      position: fixed;
      bottom: 20px;
      right: 20px;
      background: rgba(255, 255, 255, 0.95);
      backdrop-filter: blur(20px);
      -webkit-backdrop-filter: blur(20px);
      border-radius: 12px;
      padding: 12px 20px;
      display: flex;
      align-items: center;
      gap: 12px;
      box-shadow: 0 4px 24px rgba(0, 0, 0, 0.08);
      border: 1px solid rgba(0, 0, 0, 0.04);
      animation: slideIn 0.3s cubic-bezier(0.4, 0, 0.2, 1);
      z-index: 9999;
    }

    .chat-exporter-loading-spinner {
      width: 16px;
      height: 16px;
      border: 2px solid #1e90ff;
      border-top-color: transparent;
      border-radius: 50%;
      animation: spin 0.8s linear infinite;
    }

    .chat-exporter-loading-text {
      font-size: 14px;
      color: #333;
    }

    @keyframes spin {
      to { transform: rotate(360deg); }
    }
  `;
    document.head.appendChild(styleElement);
    
    // 创建加载提示
    const loadingDiv = document.createElement('div');
    loadingDiv.className = 'chat-exporter-loading';
    loadingDiv.innerHTML = `
    <div class="chat-exporter-loading-spinner"></div>
    <span class="chat-exporter-loading-text">正在准备导出工具...</span>
  `;
    document.body.appendChild(loadingDiv);
    
    // 创建导出工具UI
    const exporter = document.createElement('div');
    exporter.className = 'chat-exporter';
    exporter.innerHTML = `
    <div class="chat-exporter-header">
      <div class="chat-exporter-title-group">
        <h3 class="chat-exporter-title">导出选项</h3>
      </div>
      <button class="chat-exporter-close">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M18 6L6 18" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
          <path d="M6 6L18 18" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
      </button>
    </div>
    <div class="chat-exporter-body">
      <div class="chat-exporter-buttons">
        <button class="chat-exporter-btn" id="preview-btn">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M12 4H6C4.89543 4 4 4.89543 4 6V18C4 19.1046 4.89543 20 6 20H18C19.1046 20 20 19.1046 20 18V12" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
            <path d="M11 13L20 4" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
            <path d="M15 4H20V9" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
          预览
        </button>
        <button class="chat-exporter-btn" id="export-json-btn">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M12 15V3" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
            <path d="M7 8L12 3L17 8" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
            <path d="M20 21H4" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
          JSON
        </button>
        <button class="chat-exporter-btn" id="export-txt-btn">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M12 15V3" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
            <path d="M7 8L12 3L17 8" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
            <path d="M20 21H4" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
          TXT
        </button>
      </div>
    </div>
    <div class="chat-exporter-footer">
      已收集 <span id="message-count">${messageCount}</span> 条消息
    </div>
  `;

    // 添加事件监听器
    const closeBtn = exporter.querySelector('.chat-exporter-close');
    const previewBtn = exporter.querySelector('#preview-btn');
    const exportJsonBtn = exporter.querySelector('#export-json-btn');
    const exportTxtBtn = exporter.querySelector('#export-txt-btn');

    closeBtn.addEventListener('click', () => {
      exporter.classList.remove('visible');
      createRestoreButton();
    });

    previewBtn.addEventListener('click', async () => {
      const sortOrder = document.querySelector('input[name="sort-order"]:checked').value;
      try {
        await previewChatRecords(db, recordId, sortOrder);
      } catch (error) {
        logger.error('预览失败:', error);
        console.error('预览失败:', error);
      }
    });

    exportJsonBtn.addEventListener('click', async () => {
      const sortOrder = document.querySelector('input[name="sort-order"]:checked').value;
      try {
        await exportChatRecords(db, recordId, 'json', sortOrder);
      } catch (error) {
        logger.error('导出JSON失败:', error);
        console.error('导出JSON失败:', error);
      }
    });

    exportTxtBtn.addEventListener('click', async () => {
      const sortOrder = document.querySelector('input[name="sort-order"]:checked').value;
      try {
        await exportChatRecords(db, recordId, 'txt', sortOrder);
      } catch (error) {
        logger.error('导出TXT失败:', error);
        console.error('导出TXT失败:', error);
      }
    });

    // 创建恢复按钮
    function createRestoreButton() {
      const restoreBtn = document.createElement('button');
      restoreBtn.className = 'restore-btn';
      restoreBtn.innerHTML = `
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M19 9L12 16L5 9" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
      </svg>
    `;
      restoreBtn.addEventListener('click', () => {
        restoreBtn.remove();
        exporter.classList.add('visible');
      });
      document.body.appendChild(restoreBtn);
    }

    // 添加样式和显示导出工具
    document.head.appendChild(styleElement);
    document.body.appendChild(exporter);
    exporter.classList.add('visible');

    // 返回更新消息数的函数
    return {
      updateMessageCount: (count) => {
        const countElement = exporter.querySelector('#message-count');
        if (countElement) {
          countElement.textContent = count;
        }
      }
    };
  }

  // 日期选择和消息处理工具

  // -------------------- 工具函数 --------------------

  function simulateClick(element) {
    if (element) {
      element.click();
      console.log(`点击元素: ${element.textContent ? element.textContent.trim() : (element.className ? element.className : '按钮')}`);
    } else {
      console.error(`未找到可点击的元素`);
    }
  }

  function forceVisibleAndClick(element) {
    if (element) {
      // 强制显示（如果需要）
      element.style.display = 'block';
      element.style.visibility = 'visible';
      element.style.opacity = '1';
      element.click();
      console.log(`强制显示并点击元素: ${element.className}`);
    } else {
      console.error(`未找到需要强制显示和点击的元素`);
    }
  }

  function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  // -------------------- 日期选择工具函数 --------------------

  async function selectSpecificDate(targetDate) {
    console.log('开始选择日期...');

    const currentDate = new Date();
    const currentYear = currentDate.getFullYear();
    const currentMonth = currentDate.getMonth(); // 0-indexed
    const currentDay = currentDate.getDate();

    const targetYear = targetDate.year;
    const targetMonth = targetDate.month - 1; // 转为0-indexed
    const targetDay = targetDate.day;

    if (targetYear > currentYear ||
        (targetYear === currentYear && targetMonth > currentMonth) ||
        (targetYear === currentYear && targetMonth === currentMonth && targetDay > currentDay)) {
      console.error(`目标日期 ${targetYear}-${targetMonth + 1}-${targetDay} 超过当前时间，无法选择。`);
      return false; // 返回 false 表示选择失败
    }

    // 步骤 0: 点击筛选按钮
    const filterButtonCssPath = 'div.record-filter-btn[data-v-35f48dfb]';
    const filterButton = document.querySelector(filterButtonCssPath);
    if (filterButton) {
      simulateClick(filterButton);
      await delay(500); // 等待筛选选项展开
    } else {
      console.error('无法找到筛选按钮。');
      return false; // 返回 false 表示选择失败
    }

    // 步骤 1: 点击打开日期选择器
    const openDatePickerCssPath = 'div#ml-root > div:nth-of-type(3) > div > div:nth-of-type(2) > div:nth-of-type(2) > div';
    simulateClick(document.querySelector(openDatePickerCssPath));
    await delay(500); // 等待日期选择器展开

    // 步骤 2: 导航到目标月份
    let resetAttempted = false;

    while (true) {
      let currentDisplayedMonthYearElement = document.querySelector('div.vc-title span');

      if (!currentDisplayedMonthYearElement) {
        if (!resetAttempted) {
          console.log('无法找到当前显示的月份和年份，尝试点击重置按钮...');
          const resetButton = document.querySelector('span.reset-btn[data-v-846dfd24]');
          if (resetButton) {
            simulateClick(resetButton);
            await delay(1000); // 等待重置完成
            currentDisplayedMonthYearElement = document.querySelector('div.vc-title span'); // 再次尝试查找
            resetAttempted = true;
            if (currentDisplayedMonthYearElement) {
              console.log('重置成功，重新找到月份和年份。');
            } else {
              console.error('重置后仍然无法找到当前显示的月份和年份。');
              return false; // 返回 false 表示选择失败
            }
          } else {
            console.error('无法找到重置按钮。');
            return false; // 返回 false 表示选择失败
          }
        } else {
          console.error('多次尝试后仍然无法找到当前显示的月份和年份。');
          return false; // 返回 false 表示选择失败
        }
      }

      const currentDisplayedMonthYearText = currentDisplayedMonthYearElement.textContent.trim();
      const [currentDisplayedYearStr, currentDisplayedMonthStr] = currentDisplayedMonthYearText.split('-').map(s => s.trim());
      const currentDisplayedYear = parseInt(currentDisplayedYearStr, 10);
      const currentDisplayedMonth = parseInt(currentDisplayedMonthStr, 10) - 1; // Convert to 0-indexed

      if (currentDisplayedYear === targetYear && currentDisplayedMonth === targetMonth) {
        console.log(`已导航到目标月份: ${currentDisplayedYear}-${currentDisplayedMonth + 1}`);
        break;
      } else if (currentDisplayedYear > targetYear || (currentDisplayedYear === targetYear && currentDisplayedMonth > targetMonth)) {
        // 点击左箭头
        const prevMonthArrow = document.querySelector('div.vc-arrows-container > div.vc-arrow.is-left');
        simulateClick(prevMonthArrow);
        await delay(300);
      } else {
        // 点击右箭头
        const nextMonthArrow = document.querySelector('div.vc-arrows-container > div.vc-arrow.is-right');
        simulateClick(nextMonthArrow);
        await delay(300);
      }
    }

    // 步骤 3: 选择目标日期并判断是否禁用
    const dayElements = document.querySelectorAll('div.vc-weeks div.vc-day');
    let targetDayFound = false;

    for (const dayElement of dayElements) {
      const dayTextElement = dayElement.querySelector('span.vc-day-content');
      if (dayTextElement) {
        const dayText = dayTextElement.textContent.trim();
        if (parseInt(dayText, 10) === targetDay) {
          targetDayFound = true;
          if (dayTextElement.classList.contains('is-disabled')) {
            console.log(`目标日期 ${targetYear}-${targetMonth + 1}-${targetDay} 没有数据。`);
            return false; // 返回 false 表示选择失败
          } else if (!dayElement.classList.contains('is-not-in-month')) {
            simulateClick(dayTextElement);
            console.log(`选择日期: ${targetYear}-${targetMonth + 1}-${targetDay}`);
            return true; // 返回 true 表示选择成功
          }
        }
      }
    }

    if (!targetDayFound) {
      console.error(`未找到目标日期: ${targetYear}-${targetMonth + 1}-${targetDay}`);
    }
    return false; // 返回 false 表示选择失败
  }

  // -------------------- 最新消息处理工具函数 --------------------

  async function processLatestChatMessage() {
    console.log('开始处理最新消息...');

    // 步骤 1: 关闭筛选条件（如果打开）
    const filterPanel = document.querySelector('div.message-filter[data-v-846dfd24]');
    if (filterPanel) {
      console.log('检测到筛选条件已打开，尝试关闭...');
      const filterButton = document.querySelector('div.record-filter-btn[data-v-35f48dfb]');
      if (filterButton) {
        simulateClick(filterButton);
        await delay(500); // 等待筛选条件关闭
      } else {
        console.warn('无法找到筛选按钮，可能无法关闭筛选条件。');
      }
    } else {
      console.log('筛选条件未打开。');
    }

    // 步骤 2: 找到最新的消息
    const msgLists = document.querySelectorAll('div.msg-list[data-v-33692f9a]');
    if (msgLists.length > 0) {
      const latestMsgList = msgLists[msgLists.length - 1]; // 获取最后一个 msg-list
      const latestMsgDetail = latestMsgList.querySelector('div.record-msg-detail[data-v-33692f9a]');

      if (latestMsgDetail) {
        console.log('找到最新的消息。');

        // 步骤 3: 强制可见并触发目标图标
        const targetIcon = latestMsgDetail.querySelector('i.q-svg-icon.target-to-chat[data-v-357b03a8][data-v-33692f9a]');
        if (targetIcon) {
          forceVisibleAndClick(targetIcon);
          return true; // 返回 true 表示处理成功
        } else {
          console.warn('在最新的消息中未找到目标图标。');
          return false; // 返回 false 表示处理失败
        }
      } else {
        console.warn('未找到最新的消息详情。');
        return false; // 返回 false 表示处理失败
      }
    } else {
      console.warn('未找到任何消息列表。');
      return false; // 返回 false 表示处理失败
    }
  }

  // 创建日期选择器UI
  function createDatePicker(onSelect) {
    const datePicker = document.createElement('div');
    datePicker.className = 'date-picker-container';
    datePicker.innerHTML = `
    <div class="date-picker-overlay"></div>
    <div class="date-picker-modal">
      <div class="date-picker-header">
        <h3>选择导出起始日期</h3>
        <button class="date-picker-close" aria-label="关闭">
          <svg width="15" height="15" viewBox="0 0 15 15" fill="none">
            <path d="M1.5 1.5l12 12m-12 0l12-12" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
          </svg>
        </button>
      </div>
      <div class="date-picker-body">
        <div class="date-picker-inputs">
          <div class="date-input-group">
            <input type="number" id="year" min="2010" max="${new Date().getFullYear()}" value="${new Date().getFullYear()}">
            <label for="year">年</label>
          </div>
          <div class="date-input-group">
            <input type="number" id="month" min="1" max="12" value="${new Date().getMonth() + 1}">
            <label for="month">月</label>
          </div>
          <div class="date-input-group">
            <input type="number" id="day" min="1" max="31" value="${new Date().getDate()}">
            <label for="day">日</label>
          </div>
        </div>
      </div>
      <div class="date-picker-footer">
        <button class="date-picker-btn secondary" id="skip-btn">跳过选择</button>
        <div class="button-group">
          <button class="date-picker-btn" id="cancel-btn">取消</button>
          <button class="date-picker-btn primary" id="confirm-btn">确认</button>
        </div>
      </div>
    </div>
  `;

    // 添加样式
    const style = document.createElement('style');
    style.textContent = `
    .date-picker-container {
      position: fixed;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      z-index: 10000;
      display: flex;
      align-items: center;
      justify-content: center;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;
    }

    .date-picker-overlay {
      position: fixed;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      background: rgba(0, 0, 0, 0.4);
      backdrop-filter: blur(4px);
      -webkit-backdrop-filter: blur(4px);
    }

    .date-picker-modal {
      position: relative;
      background: white;
      border-radius: 16px;
      width: 90%;
      max-width: 400px;
      box-shadow: 0 20px 40px rgba(0, 0, 0, 0.1);
      z-index: 10001;
      animation: modalAppear 0.2s ease-out;
    }

    @keyframes modalAppear {
      from {
        opacity: 0;
        transform: scale(0.95);
      }
      to {
        opacity: 1;
        transform: scale(1);
      }
    }

    .date-picker-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 20px 24px;
    }

    .date-picker-header h3 {
      margin: 0;
      font-size: 18px;
      font-weight: 600;
      color: #000;
    }

    .date-picker-close {
      padding: 8px;
      border: none;
      background: none;
      cursor: pointer;
      color: #666;
      border-radius: 8px;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: all 0.2s;
    }

    .date-picker-close:hover {
      background: #f5f5f5;
      color: #000;
    }

    .date-picker-body {
      padding: 0 24px 24px;
    }

    .date-picker-inputs {
      display: flex;
      gap: 12px;
    }

    .date-input-group {
      flex: 1;
      display: flex;
      flex-direction: column;
    }

    .date-input-group input {
      width: 100%;
      padding: 12px;
      border: 1px solid #e5e7eb;
      border-radius: 8px;
      font-size: 16px;
      outline: none;
      transition: all 0.2s;
      -moz-appearance: textfield;
    }

    .date-input-group input::-webkit-outer-spin-button,
    .date-input-group input::-webkit-inner-spin-button {
      -webkit-appearance: none;
      margin: 0;
    }

    .date-input-group input:focus {
      border-color: #1e90ff;
      box-shadow: 0 0 0 3px rgba(30, 144, 255, 0.1);
    }

    .date-input-group label {
      margin-top: 6px;
      font-size: 13px;
      color: #666;
      text-align: center;
    }

    .date-picker-footer {
      padding: 16px 24px;
      border-top: 1px solid #f0f0f0;
      display: flex;
      justify-content: space-between;
      align-items: center;
    }

    .button-group {
      display: flex;
      gap: 8px;
    }

    .date-picker-btn {
      padding: 8px 16px;
      border: none;
      border-radius: 8px;
      font-size: 14px;
      font-weight: 500;
      cursor: pointer;
      transition: all 0.2s;
      background: #fff;
      color: #666;
    }

    .date-picker-btn:hover {
      background: #f5f5f5;
    }

    .date-picker-btn.primary {
      background: #1e90ff;
      color: white;
    }

    .date-picker-btn.primary:hover {
      background: #1a7ee6;
    }

    .date-picker-btn.secondary {
      color: #666;
    }

    .date-picker-btn.secondary:hover {
      background: #f5f5f5;
      color: #000;
    }
  `;
    document.head.appendChild(style);
    document.body.appendChild(datePicker);

    return new Promise((resolve) => {
      // 取消按钮
      document.getElementById('cancel-btn').addEventListener('click', () => {
        document.body.removeChild(datePicker);
        resolve(null);
      });

      // 关闭按钮
      document.querySelector('.date-picker-close').addEventListener('click', () => {
        document.body.removeChild(datePicker);
        resolve(null);
      });

      // 跳过按钮
      document.getElementById('skip-btn').addEventListener('click', () => {
        document.body.removeChild(datePicker);
        resolve(false);
      });

      // 确认按钮
      document.getElementById('confirm-btn').addEventListener('click', () => {
        const year = parseInt(document.getElementById('year').value, 10);
        const month = parseInt(document.getElementById('month').value, 10);
        const day = parseInt(document.getElementById('day').value, 10);

        // 简单验证
        const currentDate = new Date();
        if (year > currentDate.getFullYear() || 
            (year === currentDate.getFullYear() && month > currentDate.getMonth() + 1) ||
            (year === currentDate.getFullYear() && month === currentDate.getMonth() + 1 && day > currentDate.getDate())) {
          alert('所选日期不能超过当前日期');
          return;
        }

        // 验证日期是否有效
        const date = new Date(year, month - 1, day);
        if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) {
          alert('所选日期无效，请检查日期是否存在');
          return;
        }

        document.body.removeChild(datePicker);
        resolve({ year, month, day });
      });
    });
  }

  // 版本信息
  const VERSION = '2.0.0';

  // 导出全局方法供外部使用
  window.QCEPro = {
    VERSION,
    init: async function() {
      try {
        // 等待DOM完全加载
        if (document.readyState !== 'complete') {
          await new Promise(resolve => window.addEventListener('load', resolve, { once: true }));
        }

        // 确保聊天容器存在
        const containerSelector = '#ml-root';    // 滚动容器
        const messageItemSelector = '.ml-item';  // 单条消息的选择器
        const container = document.querySelector(containerSelector);
        if (!container) {
          logger.error('未找到聊天容器，请确保你已打开聊天窗口');
          return;
        }

        // 初始化日志
        console.log(`%c QQ Chat Exporter Pro v${VERSION} %c | https://github.com/shuakami/qq-chat-exporter `, 
          'background:#1e90ff;color:#fff;padding:5px 10px;border-radius:4px 0 0 4px;', 
          'background:#fff;color:#1e90ff;padding:5px 10px;border-radius:0 4px 4px 0;border:1px solid #1e90ff;');

        // 确保Selection API可用
        if (!window.getSelection) {
          logger.error('当前环境不支持Selection API，请检查浏览器设置');
          return;
        }

        // 初始化基础配置
        logger.startSection('初始化配置');

        // 0.0 日期选择 - 在开始导出前询问用户是否要选择特定日期
        logger.info("加载日期选择器...");
        const targetDate = await createDatePicker();
        
        // 如果用户选择了日期，则导航到该日期并处理消息
        if (targetDate) {
          logger.highlight(`用户选择了日期: ${targetDate.year}-${targetDate.month}-${targetDate.day}`);
          
          const dateSelected = await selectSpecificDate(targetDate);
          if (!dateSelected) {
            logger.error("日期选择失败，可能是该日期没有聊天记录。即将使用当前日期继续。");
            await delay$1(2000); // 给用户时间阅读错误信息
          } else {
            logger.success("日期选择成功！");
            
            // 处理该日期的最新消息
            const messageProcessed = await processLatestChatMessage();
            if (!messageProcessed) {
              logger.warning("处理消息失败，可能无法跳转到选定的聊天记录位置。即将继续导出当前可见消息。");
              await delay$1(2000); // 给用户时间阅读警告信息
            } else {
              logger.success("已成功导航到选定的聊天记录位置！");
              await delay$1(1000); // 给页面一点时间加载
            }
          }
        } else if (targetDate === false) {
          logger.system("用户选择跳过日期选择，将从当前日期开始导出。");
        } else {
          logger.warning("用户取消了操作，但我们仍将继续导出当前可见的聊天记录。");
        }

        // 0.0.1 滚动方向选择
        logger.info("选择滚动方向...");
        const scrollDirection = await new Promise(resolve => {
          const modal = document.createElement('div');
          modal.style.cssText = `
          position: fixed;
          top: 50%;
          left: 50%;
          transform: translate(-50%, -50%);
          background: rgba(255, 255, 255, 0.95);
          backdrop-filter: blur(10px);
          border-radius: 16px;
          padding: 24px;
          box-shadow: 0 8px 32px rgba(0, 0, 0, 0.1);
          z-index: 999999;
          width: 480px;
          font-family: system-ui, -apple-system, sans-serif;
        `;

          const title = document.createElement('h2');
          title.textContent = '选择滚动方向';
          title.style.cssText = `
          margin: 0 0 20px 0;
          font-size: 18px;
          font-weight: 600;
          color: #1e90ff;
        `;

          const description = document.createElement('p');
          description.textContent = '请选择聊天记录的滚动方向：';
          description.style.cssText = `
          margin: 0 0 20px 0;
          color: #666;
          font-size: 14px;
        `;

          const buttonContainer = document.createElement('div');
          buttonContainer.style.cssText = `
          display: flex;
          gap: 16px;
          margin-bottom: 16px;
        `;

          const createButton = (text, value, description) => {
            const button = document.createElement('button');
            button.style.cssText = `
            flex: 1;
            padding: 16px;
            border: 1px solid #e0e0e0;
            border-radius: 12px;
            background: white;
            cursor: pointer;
            transition: all 0.2s;
            display: flex;
            flex-direction: column;
            align-items: center;
            gap: 12px;
            color: #666;
            min-height: 120px;
          `;
            
            const iconSpan = document.createElement('span');
            iconSpan.textContent = value === 'up' ? '⬆️' : '⬇️';
            iconSpan.style.cssText = `
            font-size: 28px;
            margin-bottom: 4px;
          `;
            
            const textSpan = document.createElement('span');
            textSpan.textContent = text;
            textSpan.style.cssText = `
            font-size: 16px;
            font-weight: 500;
            margin-bottom: 8px;
          `;
            
            const descSpan = document.createElement('span');
            descSpan.textContent = description;
            descSpan.style.cssText = `
            font-size: 13px;
            color: #888;
            text-align: center;
            line-height: 1.4;
          `;
            
            button.appendChild(iconSpan);
            button.appendChild(textSpan);
            button.appendChild(descSpan);

            button.addEventListener('mouseover', () => {
              button.style.borderColor = '#1e90ff';
              button.style.color = '#1e90ff';
              button.style.transform = 'translateY(-2px)';
              descSpan.style.color = '#1e90ff';
            });

            button.addEventListener('mouseout', () => {
              button.style.borderColor = '#e0e0e0';
              button.style.color = '#666';
              button.style.transform = 'translateY(0)';
              descSpan.style.color = '#888';
            });

            button.addEventListener('click', () => {
              modal.remove();
              resolve(value);
            });

            return button;
          };

          const upButton = createButton('向上滚动', 'up', '选择此方向，我们会往上获取聊天记录');
          const downButton = createButton('向下滚动', 'down', '选择此方向，我们会往下获取聊天记录');
          buttonContainer.appendChild(upButton);
          buttonContainer.appendChild(downButton);

          const note = document.createElement('p');
          note.textContent = '提示：选择与你平时浏览消息记录的方向相反';
          note.style.cssText = `
          margin: 0;
          color: #999;
          font-size: 13px;
          text-align: center;
          line-height: 1.5;
        `;

          modal.appendChild(title);
          modal.appendChild(description);
          modal.appendChild(buttonContainer);
          modal.appendChild(note);
          document.body.appendChild(modal);
        });

        logger.success(`用户选择了${scrollDirection === 'up' ? '向上' : '向下'}滚动`);

        // 0.1 生成记录ID：当前时间 + 唯一随机字符串，用于标识本次聊天记录会话
        const recordId = Date.now() + '-' + Math.random().toString(36).substr(2, 9);
        logger.system(`当前记录 ID: ${recordId}`);

        // 0.2 用国内 CDN 加载 Dexie.js（如果尚未加载）
        if (!window.Dexie) {
          logger.info("正在从国内CDN加载 Dexie.js...");
          await new Promise((resolve, reject) => {
            const script = document.createElement("script");
            script.src = "https://cdn.bootcdn.net/ajax/libs/dexie/3.2.2/dexie.min.js";
            script.onload = resolve;
            script.onerror = (error) => {
              logger.error("Dexie.js 加载失败，尝试使用备用CDN...");
              script.src = "https://cdn.jsdelivr.net/npm/dexie@3.2.2/dist/dexie.min.js";
              script.onload = resolve;
              script.onerror = reject;
            };
            document.head.appendChild(script);
          }).catch(error => {
            logger.error("所有CDN加载失败，请检查网络连接");
            throw new Error("依赖加载失败: " + error);
          });
          logger.success("Dexie.js 已成功加载");
        }

        // 0.3 初始化 IndexedDB 存储（数据库名中嵌入 recordId）
        let db;
        try {
          const dbName = "ChatRecords_" + recordId;
          db = new Dexie(dbName);
          db.version(1).stores({
            records: '++id, session, timestamp, time, sender, content'
          });
          await db.open();
          logger.system(`已初始化数据库: ${dbName}`);
        } catch (error) {
          logger.error(`数据库初始化失败: ${error.message}`);
          throw new Error("数据库初始化失败");
        }

        // 全局数据
        window.collectedMessages = [];    // 保存所有提取到的消息
        window.processedIds = new Set();  // 用于去重

        // ========== 0.1 主要滚动参数 ==========
        const upTimes = scrollDirection === 'up' ? 5 : 1;     // 上滑次数
        const downTimes = scrollDirection === 'up' ? 1 : 10;    // 下滑次数
        
        // 根据滚动方向设置不同的延迟时间
        const getDelayTime = (direction) => {
          if (direction === 'down') {
            return {
              scrollDelay: 300,      // 向下滚动等待时间
              focusInterval: 100,    // 向下滚动时焦点间隔
              scrollDuration: 1800    // 向下滚动时持续时间
            };
          } else {
            return {
              scrollDelay: 900,      // 向上滚动等待时间
              focusInterval: 300,    // 向上滚动时焦点间隔
              scrollDuration: 2400   // 向上滚动时持续时间
            };
          }
        };

        const maxNoNewTimes = 20;         // 连续n次无新消息则停止
        const scrollThreshold = 50;       // 滚动检测阈值

        // ========== 0.2 其他控制变量 ==========
        let noNewTimes = 0;              // 连续无新消息计数
        let isManualStop = false;        // 是否手动停止爬取
        let isPaused = false;            // 暂停/恢复标志
        let cycleCount = 0;              // 滚动操作的次数
        let activeMethod = 0;            // 当前使用的方法

        // 暴露给控制台的停止函数
        window.stopAutoScroll = function() {
          isManualStop = true;
          logger.highlight('已手动停止自动滚动');
        };
        
        // 暴露导出和预览功能到全局作用域
        window.exportChatRecords = async (format, sortOrder) => {
          try {
            if (!db) {
              throw new Error('数据库未初始化');
            }
            if (!recordId) {
              throw new Error('记录ID未初始化');
            }
            return await exportChatRecords(db, recordId, format, sortOrder);
          } catch (error) {
            logger.error(`导出失败: ${error.message}`);
            console.error('导出失败:', error);
            throw error;
          }
        };
          
        window.previewChatRecords = async (sortOrder) => {
          try {
            if (!db) {
              throw new Error('数据库未初始化');
            }
            if (!recordId) {
              throw new Error('记录ID未初始化');
            }
            return await previewChatRecords(db, recordId, sortOrder);
          } catch (error) {
            logger.error(`预览失败: ${error.message}`);
            console.error('预览失败:', error);
            throw error;
          }
        };
        
        // 同时保持QCEPro对象的方法
        window.QCEPro.exportChatRecords = window.exportChatRecords;
        window.QCEPro.previewChatRecords = window.previewChatRecords;
          
        window.howToExport = showExportHelp;
        
        // 暴露日期选择工具类
        window.datePickerUtils = {
          selectSpecificDate,
          processLatestChatMessage,
          delay: delay$1
        };

        // 注册全局快捷键：Ctrl+F8 切换暂停/恢复
        window.addEventListener("keydown", function(e) {
          if (e.ctrlKey && e.key === "F8") {
            e.preventDefault();
            isPaused = !isPaused;
            if (isPaused) {
              logger.warning(`已暂停自动滚动 (Ctrl+F8 可恢复)`);
            } else {
              logger.success(`已恢复自动滚动`);
            }
          }
        }, false);

        // 初始化日志
        const initialCount = document.querySelectorAll(messageItemSelector).length;
        logger.count(`开始自动滚动, 初始消息数: ${initialCount}`);
        logger.system(`容器高度: ${container.clientHeight}px, 初始滚动位置: ${container.scrollTop}px`);
        logger.endSection('初始化配置');

        // ========== 1. 主循环: 5次上滑 + 1次下滑的反复 ==========
        logger.startSection('开始滚动采集');
        mainLoop: while (!isManualStop) {
          // 检查是否处于暂停状态
          while (isPaused && !isManualStop) {
            logger.system("运行已暂停...等待恢复 (Ctrl+F8)");
            await delay$1(1000);
          }

          // 1.1 先执行 upTimes 次"上滑"
          for (let i = 0; i < upTimes; i++) {
            if (await doScrollOneStep('up')) {
              break mainLoop; // 若返回 true，则终止整个流程
            }
          }
          // 1.2 再执行 downTimes 次"小幅下滑"
          for (let i = 0; i < downTimes; i++) {
            if (await doScrollOneStep('down')) {
              break mainLoop;
            }
          }
        }

        logger.endSection('滚动采集');
        logger.success(`共收集消息数: ${window.collectedMessages.length}条`);
        
        // 创建导出工具UI
        try {
          const chatExporter = await createChatExporter(db, recordId, window.collectedMessages.length);
          if (!chatExporter) {
            throw new Error("导出工具UI创建失败");
          }
        } catch (error) {
          logger.error(`创建导出工具失败: ${error.message}`);
          throw error;
        }
        
        // 显示导出帮助信息
        showExportHelp();
        
        // 显示可爱的点赞请求
        showStarRequest();
        
        logger.highlight('如果你要重新执行脚本/切换好友继续进行备份，请一定要先点击F5刷新后继续。');

        // ========== 2. 定义"单步滚动+提取"函数 ==========
        // 返回 true 表示应终止整个上滑逻辑
        async function doScrollOneStep(direction) {
          cycleCount++;
          const oldScrollTop = container.scrollTop;
          
          // 获取当前方向的延迟时间
          const delayTimes = getDelayTime(direction);
          
          logger.event(`[滚动] 第${cycleCount}次, 方向=${direction}, 方法=${activeMethod}`);
          
          // 2.1 确保容器获得焦点
          container.focus();
          await delay$1(delayTimes.focusInterval);
          
          // 2.2 使用当前活动方法滚动
          await scrollWithMethod(container, direction, activeMethod, delayTimes.scrollDuration);
          
          // 检查滚动是否生效
          await delay$1(delayTimes.scrollDelay);
          const newScrollTop = container.scrollTop;
          const scrollDiff = Math.abs(newScrollTop - oldScrollTop);
          
          if (scrollDiff < scrollThreshold) {
            // 切换到下一种方法
            activeMethod = (activeMethod + 1) % 5;
            logger.warning(`滚动无效 (差异: ${scrollDiff}px)，切换到方法 ${activeMethod}`);
            await scrollWithMethod(container, direction, activeMethod, delayTimes.scrollDuration);
            await delay$1(delayTimes.scrollDelay);
          } else {
            logger.system(`滚动成功，位移: ${scrollDiff}px，方向: ${direction}`);
          }

          // 2.3 提取本次新增消息，并存入 IndexedDB
          const newCount = extractNewMessagesAndLog();
          if (newCount > 0) {
            // 将新增消息添加至 IndexedDB（附加 session 和 timestamp 字段）
            const newMsgs = window.collectedMessages.slice(-newCount);
            newMsgs.forEach(msg => {
              msg.session = recordId;
              msg.timestamp = new Date().toISOString();
            });
            try {
              await db.records.bulkAdd(newMsgs);
              logger.success(`已存储 ${newCount} 条新增消息到数据库`);
            } catch (error) {
              logger.error(`存储消息到数据库失败: ${error.message}`);
            }
            noNewTimes = 0;
          } else {
            noNewTimes++;
            logger.system(`无新消息，已连续 ${noNewTimes}/${maxNoNewTimes} 次`);
            if (noNewTimes >= maxNoNewTimes) {
              logger.warning(`已达到最大无消息次数 (${maxNoNewTimes})，停止滚动`);
              return true;
            }
          }

          return false;
        }

        // ========== 3. 提取当前DOM中出现的"新消息"并打印 ==========
        function extractNewMessagesAndLog() {
          let newCount = 0;
          const items = document.querySelectorAll(messageItemSelector);
          for (const item of items) {
            const id = item.getAttribute('id') || '';
            if (!id || window.processedIds.has(id)) {
              continue;
            }
            const timeEl = item.querySelector('.message__timestamp .babble');
            const time = timeEl ? timeEl.innerText.trim() : '';
            const avatarSpan = item.querySelector('.avatar-span');
            const sender = avatarSpan ? avatarSpan.getAttribute('aria-label') || '' : '';
            let content = '';
            
            // 文本消息处理
            const textEl = item.querySelector('.text-element');
            if (textEl && textEl.innerText.trim() !== '') {
              content = textEl.innerText.trim();
            } 
            // 图片消息处理
            else {
              const imgEl = item.querySelector('img.image-content');
              if (imgEl) {
                let src = imgEl.getAttribute('src') || '';
                let dataPath = imgEl.getAttribute('data-path') || '';
                if (src.startsWith('data:')) {
                  src = src.slice(0, 50) + '...';
                }
                
                // 判断是否为视频消息
                const videoElement = item.querySelector('.msg-preview--video');
                if (videoElement) {
                  // 视频消息处理
                  // 尝试获取视频文件路径
                  const finalSrc = videoElement.getAttribute('finalsrc') || '';
                  const videoLabel = videoElement.getAttribute('aria-label') || '视频';
                  
                  if (finalSrc) {
                    content = `[${videoLabel}] 路径: ${finalSrc}`;
                  } else {
                    content = `[${videoLabel}] 预览: ${dataPath || src}`;
                  }
                } else {
                  // 普通图片消息
                  content = `[图片] ${dataPath ? '路径: ' + dataPath : '预览: ' + src}`;
                }
              }
              
              // 如果没有找到图片元素，单独检查是否为视频消息
              if (!content) {
                const videoElement = item.querySelector('.msg-preview--video');
                if (videoElement) {
                  const finalSrc = videoElement.getAttribute('finalsrc') || '';
                  const imgInVideo = videoElement.querySelector('img.image-content');
                  let videoPath = '';
                  
                  if (imgInVideo) {
                    videoPath = imgInVideo.getAttribute('data-path') || imgInVideo.getAttribute('src') || '';
                  }
                  
                  content = `[视频] ${finalSrc ? '路径: ' + finalSrc : (videoPath ? '预览: ' + videoPath : '未知视频文件')}`;
                }
              }
            }
            
            // 如果还是没有内容，尝试查找其他可能的消息类型
            if (!content) {
              if (item.textContent.trim()) {
                content = `[未识别消息] ${item.textContent.trim().substring(0, 100)}${item.textContent.trim().length > 100 ? '...' : ''}`;
              } else {
                content = '[未识别消息类型]';
              }
            }
            
            const messageData = { id, time, sender, content };
            window.collectedMessages.push(messageData);
            window.processedIds.add(id);
            newCount++;
            
            // 简洁日志
            if (newCount % 5 === 0 || newCount === 1) {
              logger.count(`已获取 ${window.collectedMessages.length} 条消息`);
            }
          }
          return newCount;
        }
      } catch (error) {
        console.error('初始化失败:', error);
      }
    },
    showExportHelp,
    exportChatRecords,
    previewChatRecords
  };

  // 立即执行初始化
  window.QCEPro.init().catch(error => {
    console.error('初始化失败:', error);
  });

  // Shuakami这个月的评分是3.0
  function showStarRequest() {
    const styles = {
      title: 'font-size: 14px; color: #3498db;',
      kaomoji: 'font-size: 14px; color: #3498db;',
      text: 'font-size: 13px; color: #3498db;',
      link: 'font-size: 13px; color: #3498db; text-decoration: underline;'
    };

    console.log(
      `%c QWQ...你喜欢这个工具吗？`,
      styles.title
    );
    console.log(
      `%c(｡･ω･｡)ﾉ♡ 如果对你有帮助的话～给个小星星吧～`,
      styles.kaomoji
    );
    console.log(
      `%c→ %chttps://github.com/shuakami/qq-chat-exporter`,
      styles.text, styles.link
    );
    console.log(
      `%c(´。＿。｀) 有问题或建议的话，也请到 issue 区留言哦～`,
      styles.kaomoji
    );
    console.log(
      `%c熬夜开发不易，感谢你的支持和反馈！(ﾉ◕ヮ◕)ﾉ*:･ﾟ✧`,
      styles.text
    );
  }

})();
