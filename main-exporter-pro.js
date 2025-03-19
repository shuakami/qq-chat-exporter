import logger from './utils/logger.js';
import { delay, scrollWithMethod } from './utils/scroll.js';
import { createChatExporter } from './components/ChatExporter.js';
import { showExportHelp, exportChatRecords, previewChatRecords } from './utils/export.js';

// 版本信息
const VERSION = '2.1.6';

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
            logger.warning('检测到连续25次无新消息，启动强制滚动解锁机制...');
            logger.system('暂停3秒，然后尝试恢复滚动...');
            
            // 暂停3秒
            await delay(3000);

            // 1. 强制重置滚动容器属性
            logger.system('步骤1: 强制重置滚动容器属性');
            const originalOverflow = container.style.overflow;
            const originalScrollBehavior = container.style.scrollBehavior;
            const originalPosition = container.style.position;
            
            // 强制干预DOM - 临时禁用滚动
            container.style.overflow = 'hidden';
            container.style.scrollBehavior = 'auto';
            await delay(200);
            
            // 重置回原始状态并强制滚动
            container.style.overflow = originalOverflow || '';
            container.style.scrollBehavior = originalScrollBehavior || '';
            container.scrollTop = container.scrollTop - 1000; 
            await delay(300);
            
            // 2. 使用PageDown/PageUp键重置
            logger.system('步骤2: 模拟PageDown/PageUp键');
            document.activeElement.blur();
            container.focus();
            
            // 发送PageDown以强制向下滚动
            [33, 34].forEach(keyCode => {
              const keyEvents = ['keydown', 'keypress', 'keyup'];
              keyEvents.forEach(eventType => {
                const event = new KeyboardEvent(eventType, {
                  bubbles: true,
                  cancelable: true,
                  key: keyCode === 33 ? 'PageUp' : 'PageDown',
                  code: keyCode === 33 ? 'PageUp' : 'PageDown',
                  keyCode: keyCode,
                  which: keyCode,
                  composed: true,
                  view: window
                });
                
                // 强制设置关键属性
                try {
                  Object.defineProperties(event, {
                    keyCode: { value: keyCode },
                    which: { value: keyCode },
                    charCode: { value: 0 }
                  });
                } catch (e) {}
                
                container.dispatchEvent(event);
              });
            });
            await delay(500);
            
            // 3. 模拟鼠标拖拽
            logger.system('步骤3: 模拟鼠标拖拽滚动条');
            const rect = container.getBoundingClientRect();
            const scrollbarX = rect.right - 5;
            const startY = rect.top + 10;
            const endY = rect.bottom - 10;
            
            const mouseEvents = [
              {type: 'mousedown', x: scrollbarX, y: startY},
              {type: 'mousemove', x: scrollbarX, y: Math.floor((startY + endY) / 2)},
              {type: 'mousemove', x: scrollbarX, y: endY},
              {type: 'mouseup', x: scrollbarX, y: endY}
            ];
            
            for (const evt of mouseEvents) {
              const mouseEvent = new MouseEvent(evt.type, {
                bubbles: true,
                cancelable: true,
                view: window,
                button: 0,
                buttons: evt.type === 'mouseup' ? 0 : 1,
                clientX: evt.x,
                clientY: evt.y,
                screenX: evt.x,
                screenY: evt.y,
              });
              document.dispatchEvent(mouseEvent);
              await delay(100);
            }
            
            // 4. 触发滚轮事件
            logger.system('步骤4: 滚轮事件');
            for (let i = 0; i < 10; i++) {
              const wheelEvent1 = new WheelEvent('wheel', {
                bubbles: true,
                cancelable: true,
                deltaY: -300,
                deltaMode: 0,
              });
              container.dispatchEvent(wheelEvent1);
              await delay(50);
              
              const wheelEvent2 = new WheelEvent('wheel', {
                bubbles: true,
                cancelable: true,
                deltaY: 300,
                deltaMode: 0,
              });
              container.dispatchEvent(wheelEvent2);
              await delay(50);
            }
            await delay(300);
            
            // 5. 触发重绘
            logger.system('步骤5: 强制布局重新计算');
            // 保存原始样式
            const originalDisplay = container.style.display;
            
            // 使用display属性触发强制重排
            container.style.display = 'none';
            void container.offsetHeight; 
            container.style.display = originalDisplay || '';
            
            // 另一种强制重排的方法
            container.style.position = 'relative';
            void container.offsetHeight;
            container.style.position = originalPosition || '';
            await delay(200);
            
            // 6. 使用InputEvent
            logger.system('步骤6: InputEvent');
            const beforeInputEvent = new InputEvent('beforeinput', {
              bubbles: true,
              cancelable: true,
              inputType: 'insertText',
              data: 'PageUp'
            });
            container.dispatchEvent(beforeInputEvent);
            
            const inputEvent = new InputEvent('input', {
              bubbles: true,
              cancelable: true,
              inputType: 'insertText',
              data: 'PageUp'
            });
            container.dispatchEvent(inputEvent);
            
            // 7. 最后恢复滚动
            logger.system('步骤7: 恢复正常滚动');
            container.scrollTo({
              top: container.scrollTop - 500,
              behavior: 'smooth'
            });
            
            // 触发滚动完成事件
            container.dispatchEvent(new Event('scroll', {
              bubbles: true,
              cancelable: false
            }));
            
            // 4. 执行一次反向滚动
            const oppositeDirection = direction === 'up' ? 'down' : 'up';
            logger.system(`执行最终反向滚动 (${oppositeDirection})...`);
            await scrollWithMethod(container, oppositeDirection, activeMethod, scrollDuration);
            await delay(scrollDelay);

            // 5. 最后执行一次原方向的滚动
            logger.system('执行最终恢复滚动...');
            await scrollWithMethod(container, direction, activeMethod, scrollDuration);
            
            // 标记已执行过恢复机制
            hasTriedRecovery = true;
            logger.system('强制滚动解锁机制执行完毕，继续正常滚动...');
            
            // 重置计数器，给更多恢复机会
            consecutiveInvalidScrolls = 0;
            noNewTimes = Math.max(0, noNewTimes - 5);
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

        // 获取前3条和后3条消息的内容
        const first3Messages = records.slice(0, 3).map(r => r.content);
        const last3Messages = records.slice(-3).map(r => r.content);

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
        logger.system('前3条消息：');
        first3Messages.forEach((msg, i) => logger.system(`${i + 1}. ${msg.length > 50 ? msg.substring(0, 50) + '...' : msg}`));
        logger.system('最后3条消息：');
        last3Messages.forEach((msg, i) => logger.system(`${i + 1}. ${msg.length > 50 ? msg.substring(0, 50) + '...' : msg}`));
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
