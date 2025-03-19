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

export default logger; 