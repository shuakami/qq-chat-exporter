import logger from './utils/logger.js';
import { delay, scrollWithMethod } from './utils/scroll.js';
import { createChatExporter } from './components/ChatExporter.js';
import { showExportHelp, exportChatRecords, previewChatRecords } from './utils/export.js';
import { createDatePicker, selectSpecificDate, processLatestChatMessage } from './utils/datePicker.js';

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
          await delay(2000); // 给用户时间阅读错误信息
        } else {
          logger.success("日期选择成功！");
          
          // 处理该日期的最新消息
          const messageProcessed = await processLatestChatMessage();
          if (!messageProcessed) {
            logger.warning("处理消息失败，可能无法跳转到选定的聊天记录位置。即将继续导出当前可见消息。");
            await delay(2000); // 给用户时间阅读警告信息
          } else {
            logger.success("已成功导航到选定的聊天记录位置！");
            await delay(1000); // 给页面一点时间加载
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
        delay
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
        await delay(delayTimes.focusInterval);
        
        // 2.2 使用当前活动方法滚动
        await scrollWithMethod(container, direction, activeMethod, delayTimes.scrollDuration);
        
        // 检查滚动是否生效
        await delay(delayTimes.scrollDelay);
        const newScrollTop = container.scrollTop;
        const scrollDiff = Math.abs(newScrollTop - oldScrollTop);
        
        if (scrollDiff < scrollThreshold) {
          // 切换到下一种方法
          activeMethod = (activeMethod + 1) % 5;
          logger.warning(`滚动无效 (差异: ${scrollDiff}px)，切换到方法 ${activeMethod}`);
          await scrollWithMethod(container, direction, activeMethod, delayTimes.scrollDuration);
          await delay(delayTimes.scrollDelay);
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