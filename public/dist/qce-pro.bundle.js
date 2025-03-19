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
  const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

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
      try {
        await previewChatRecords(db, recordId, 'asc');
      } catch (error) {
        logger.error(`预览失败: ${error.message}`);
        console.error('预览失败:', error);
      }
    });

    exportJsonBtn.addEventListener('click', async () => {
      try {
        await exportChatRecords(db, recordId, 'json', 'asc');
      } catch (error) {
        logger.error(`导出JSON失败: ${error.message}`);
        console.error('导出JSON失败:', error);
      }
    });

    exportTxtBtn.addEventListener('click', async () => {
      try {
        await exportChatRecords(db, recordId, 'txt', 'asc');
      } catch (error) {
        logger.error(`导出TXT失败: ${error.message}`);
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

          const createButton = (text, value, desc) => {
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
            descSpan.textContent = desc;
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
        // 优化：不在内存中长期存放所有消息，仅临时存储一批后写入
        window.collectedMessages = [];
        window.processedIds = new Set();  // 用于去重

        // ========== 0.1 主要滚动参数 ==========
        const upTimes = (scrollDirection === 'up') ? 5 : 2;    // 上滑次数
        const downTimes = (scrollDirection === 'up') ? 2 : 10; // 下滑次数

        // 根据滚动方向设置不同的延迟时间
        const getDelayTime = (direction) => {
          if (direction === 'down') {
            return {
              scrollDelay: 300,      // 向下滚动等待时间
              focusInterval: 100,    // 向下滚动时焦点间隔
              scrollDuration: 1800   // 向下滚动时持续时间
            };
          } else {
            return {
              scrollDelay: 450,      // 向上滚动等待时间
              focusInterval: 150,    // 向上滚动时焦点间隔
              scrollDuration: 1200   // 向上滚动时持续时间
            };
          }
        };

        const maxNoNewTimes = 50;         // 连续n次无新消息则停止
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

        // 添加提前结束函数
        window.finishNow = function() {
          noNewTimes = maxNoNewTimes;
          logger.highlight('已触发提前结束，正在完成最后的数据保存...');
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

        // 注册全局快捷键：Ctrl+F8 切换暂停/恢复
        window.addEventListener("keydown", function(e) {
          if (e.ctrlKey && e.key === "F8") {
            e.preventDefault();
            isPaused = !isPaused;
            if (isPaused) {
              logger.warning(`已暂停自动滚动 (Ctrl+F8 可恢复)`);
              logger.warning('如果想提前结束采集，按Ctrl+F8继续，然后在控制台输入：window.finishNow() 并回车');
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
        let consecutiveInvalidScrolls = 0;  // 添加连续无效滚动计数器
        let hasTriedRecovery = false;      // 添加恢复机制执行标记
        
        mainLoop: while (!isManualStop) {
          // 检查是否处于暂停状态
          while (isPaused && !isManualStop) {
            logger.system("运行已暂停...等待恢复 (Ctrl+F8)");
            await delay(1000);
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
        logger.success(`【本次采集结束】已收集消息数: ${window.processedIds.size} 条`);
        
        // 如果是异常终止（连续无新消息或手动停止），提示继续任务
        if (noNewTimes >= maxNoNewTimes || isManualStop) {
          logger.system('如果说采集意外中断了？');
          logger.system('别担心！如果想继续采集剩余的消息：');
          logger.system('在控制台输入：window.QCEPro.continueTask() 并回车');
        }

        // 创建导出工具UI
        try {
          const chatExporter = await createChatExporter(db, recordId, window.processedIds.size);
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

        // ========== 2. 优化后的 "单步滚动+提取"函数 ==========
        // 返回 true 表示应终止整个滚动逻辑
        async function doScrollOneStep(direction) {
          cycleCount++;
          logger.event(`[滚动] 第${cycleCount}次, 方向=${direction}, 方法=${activeMethod}`);

          // 2.1 聚焦容器，并等待片刻以确保DOM渲染稳定
          const { focusInterval, scrollDuration, scrollDelay } = getDelayTime(direction);
          container.focus();
          await delay(focusInterval);

          // 2.2 初次滚动
          const oldScrollTop = container.scrollTop;
          await scrollWithMethod(container, direction, activeMethod, scrollDuration);
          await delay(scrollDelay);

          // 2.3 判断滚动有效性，若不足阈值则切换方法再滚一次
          const newScrollTop = container.scrollTop;
          const scrollDiff = Math.abs(newScrollTop - oldScrollTop);
          
          if (scrollDiff < scrollThreshold) {
            consecutiveInvalidScrolls++;
            activeMethod = (activeMethod + 1) % 5;
            logger.warning(`滚动无效 (差异: ${scrollDiff}px)，切换到方法 ${activeMethod}`);
          } else {
            logger.system(`滚动成功，位移: ${scrollDiff}px，方向: ${direction}`);
            consecutiveInvalidScrolls = 0;  // 重置连续无效计数器
          }

          // 2.4 提取本次新增消息
          const newCount = await extractNewMessagesAndLog();
          if (newCount > 0) {
            noNewTimes = 0;
            consecutiveInvalidScrolls = 0;  // 有新消息时也重置连续无效计数器
            hasTriedRecovery = false;       // 有新消息时重置恢复机制标记
          } else {
            noNewTimes++;
            logger.system(`无新消息，已连续 ${noNewTimes}/${maxNoNewTimes} 次 （出现此提示请不要担心，到达限制时系统会自动停止）`);
            
            // 在连续25次无新消息且未执行过恢复机制时，尝试恢复
            if (noNewTimes >= 25 && !hasTriedRecovery) {
              logger.warning('检测到连续25次无新消息，启动恢复机制...');
              logger.system('暂停5秒，然后尝试反向滚动来恢复...');
              
              // 暂停5秒
              await delay(5000);
              
              // 执行2次反向滚动
              const oppositeDirection = direction === 'up' ? 'down' : 'up';
              logger.system(`执行反向滚动 (${oppositeDirection})...`);
              
              for (let i = 0; i < 2; i++) {
                await scrollWithMethod(container, oppositeDirection, activeMethod, scrollDuration * 1.5);
                await delay(scrollDelay * 1.5);
              }
              
              // 标记已执行过恢复机制
              hasTriedRecovery = true;
              logger.system('恢复机制执行完毕，继续正常滚动...');
              logger.system('如果后续仍然无效，将等待达到最大无消息次数后自动停止。');
            }
            
            if (noNewTimes >= maxNoNewTimes) {
              logger.warning(`已达到最大无消息次数 (${maxNoNewTimes})，停止滚动`);
              return true; // 结束整个滚动流程
            }
          }
          return false; // 继续
        }

        // ========== 3. 从DOM中提取新的消息并写入DB ==========
        async function extractNewMessagesAndLog() {
          let newCount = 0;
          const items = document.querySelectorAll(messageItemSelector);
          const batchToSave = [];

          for (let i = 0; i < items.length; i++) {
            const item = items[i];
            const id = item.getAttribute('id') || '';
            if (!id || window.processedIds.has(id)) {
              continue;
            }

            const timeEl = item.querySelector('.message__timestamp .babble');
            const time = timeEl ? timeEl.innerText.trim() : '';

            const avatarSpan = item.querySelector('.avatar-span');
            const sender = avatarSpan ? (avatarSpan.getAttribute('aria-label') || '') : '';

            let content = '';
            // 文本消息
            const textEl = item.querySelector('.text-element');
            if (textEl && textEl.innerText.trim() !== '') {
              content = textEl.innerText.trim();
            }
            // 图片或视频
            else {
              const imgEl = item.querySelector('img.image-content');
              if (imgEl) {
                let src = imgEl.getAttribute('src') || '';
                let dataPath = imgEl.getAttribute('data-path') || '';
                if (src.startsWith('data:')) {
                  src = src.slice(0, 50) + '...';
                }

                // 检查视频
                const videoElement = item.querySelector('.msg-preview--video');
                if (videoElement) {
                  const finalSrc = videoElement.getAttribute('finalsrc') || '';
                  const videoLabel = videoElement.getAttribute('aria-label') || '视频';
                  if (finalSrc) {
                    content = `[${videoLabel}] 路径: ${finalSrc}`;
                  } else {
                    content = `[${videoLabel}] 预览: ${dataPath || src}`;
                  }
                } else {
                  content = `[图片] ${dataPath ? '路径: ' + dataPath : '预览: ' + src}`;
                }
              }

              // 如果没有找到图片元素，单独检查是否为视频
              if (!content) {
                const videoElement = item.querySelector('.msg-preview--video');
                if (videoElement) {
                  const finalSrc = videoElement.getAttribute('finalsrc') || '';
                  const imgInVideo = videoElement.querySelector('img.image-content');
                  let videoPath = '';
                  if (imgInVideo) {
                    videoPath = imgInVideo.getAttribute('data-path') ||
                                imgInVideo.getAttribute('src') || '';
                  }
                  content = `[视频] ${
                  finalSrc ? '路径: ' + finalSrc :
                  (videoPath ? '预览: ' + videoPath : '未知视频文件')
                }`;
                }
              }
            }

            // 如果还是没有内容，尝试其他类型
            if (!content) {
              const pureText = (item.textContent || '').trim();
              if (pureText) {
                content = `[未识别消息] ${pureText.substring(0, 100)}${pureText.length > 100 ? '...' : ''}`;
              } else {
                content = '[未识别消息类型]';
              }
            }

            const messageData = {
              id,
              time,
              sender,
              content,
              session: recordId,
              timestamp: new Date().toISOString()
            };

            batchToSave.push(messageData);
            window.processedIds.add(id);
            newCount++;
          }

          // 将新消息批量写入IndexedDB
          if (batchToSave.length > 0) {
            try {
              await db.records.bulkAdd(batchToSave);
              window.collectedMessages = batchToSave; // 仅保留本次新增批次，减少内存占用
              logger.success(`新增消息 ${newCount} 条 (累计总量: ${window.processedIds.size})`);
            } catch (error) {
              logger.error(`存储消息到数据库失败: ${error.message}`);
            }
          }
          return newCount;
        }
      } catch (error) {
        console.error('初始化失败:', error);
      }
    },
    
    // 添加继续任务方法
    continueTask: async function() {
      try {
        logger.startSection('继续未完成任务');
        
        // 1. 确保 Dexie.js 已加载
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

        // 2. 获取所有数据库列表
        const dbList = await Dexie.getDatabaseNames();
        const chatDbs = dbList.filter(name => name.startsWith('ChatRecords_'))
          .sort((a, b) => {
            const timeA = parseInt(a.split('_')[1].split('-')[0]);
            const timeB = parseInt(b.split('_')[1].split('-')[0]);
            return timeB - timeA;  // 降序排列
          });
        
        if (chatDbs.length === 0) {
          logger.error('未找到任何历史记录数据库');
          return;
        }

        // 3. 显示所有数据库的详细信息
        logger.highlight('找到以下历史记录数据库：');
        for (const dbName of chatDbs) {
          const db = new Dexie(dbName);
          db.version(1).stores({
            records: '++id, session, timestamp, time, sender, content'
          });

          // 获取该数据库的所有记录
          const records = await db.records.toArray();
          if (records.length === 0) continue;

          // 获取对话者信息
          const senders = [...new Set(records.map(r => r.sender))].filter(Boolean);
          const participants = senders.join(' 与 ') || '未知对话者';

          // 获取时间范围
          const times = records.map(r => r.time).filter(Boolean);
          const firstTime = times[0];
          const lastTime = times[times.length - 1];

          // 获取消息类型统计
          const textMsgs = records.filter(r => !r.content.startsWith('[') && !r.content.includes('未识别')).length;
          const imgMsgs = records.filter(r => r.content.includes('[图片]')).length;
          const videoMsgs = records.filter(r => r.content.includes('[视频]')).length;
          const otherMsgs = records.length - textMsgs - imgMsgs - videoMsgs;

          // 显示数据库详细信息
          logger.system(`\n== 数据库：${dbName} ==`);
          logger.system(`对话者：${participants}`);
          logger.system(`总消息数：${records.length} 条`);
          logger.system(`时间范围：${firstTime} 至 ${lastTime}`);
          logger.system('消息类型统计：');
          logger.system(`- 文本消息：${textMsgs} 条`);
          logger.system(`- 图片消息：${imgMsgs} 条`);
          logger.system(`- 视频消息：${videoMsgs} 条`);
          logger.system(`- 其他类型：${otherMsgs} 条`);
        }

        // 4. 获取最新数据库的最后记录
        const latestDb = new Dexie(chatDbs[0]);
        latestDb.version(1).stores({
          records: '++id, session, timestamp, time, sender, content'
        });
        const lastRecord = await latestDb.records.orderBy('id').last();
        
        // 5. 显示继续采集的操作指引
        logger.highlight('\n=== 如何继续采集 ===');
        logger.system('1. 请先刷新页面（按F5）');
        logger.system('2. 重新运行脚本');
        logger.system('3. 点击QQ聊天窗口右上角的"消息记录"按钮');
        logger.system(`4. 找到这个时间点附近的消息：${lastRecord.time}`);
        logger.system('5. 点击该消息，页面会自动滚动到对应位置');
        logger.system('6. 重新运行脚本，开始采集');
        logger.system('\n提示：每次继续采集前，都需要先刷新页面(F5)，这样可以确保数据采集的准确性。');
        
      } catch (error) {
        logger.error(`继续任务失败: ${error.message}`);
        console.error('继续任务失败:', error);
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
