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

export function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// -------------------- 日期选择工具函数 --------------------

export async function selectSpecificDate(targetDate) {
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

export async function processLatestChatMessage() {
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
export function createDatePicker(onSelect) {
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