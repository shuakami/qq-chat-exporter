import logger from '../utils/logger';
import { exportChatRecords, previewChatRecords } from '../utils/export';

// 创建导出工具的UI组件
export function createChatExporter(db, recordId, messageCount) {
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