import logger from './logger';

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
export async function exportChatRecords(db, recordId, format = 'json', sortOrder = 'asc') {
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
export async function previewChatRecords(db, recordId, sortOrder = 'asc') {
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
export function showExportHelp() {
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