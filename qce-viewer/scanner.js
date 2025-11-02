const fs = require('fs');
const path = require('path');
const os = require('os');

class ChatExportScanner {
  constructor() {
    // 默认扫描路径
    this.baseDir = path.join(os.homedir(), '.qq-chat-exporter');
    this.exportsDir = path.join(this.baseDir, 'exports');
    this.resourcesDir = path.join(this.baseDir, 'resources');
    this.cache = null;
    this.cacheTime = null;
  }

  /**
   * 设置自定义扫描路径
   */
  setBasePath(basePath) {
    this.baseDir = basePath;
    this.exportsDir = path.join(basePath, 'exports');
    this.resourcesDir = path.join(basePath, 'resources');
    this.clearCache();
  }

  /**
   * 清除缓存
   */
  clearCache() {
    this.cache = null;
    this.cacheTime = null;
  }

  /**
   * 检查目录是否存在
   */
  checkDirectories() {
    if (!fs.existsSync(this.exportsDir)) {
      throw new Error(`导出目录不存在: ${this.exportsDir}`);
    }
    return true;
  }

  /**
   * 解析文件名获取基本信息
   * 格式: {type}_{id}_{date}_{time}.{ext}
   * 例如: group_1126320097_20251012_143920.json
   * 或: friend_u_9GDxQDEEYCFSI9NkS7e_BA_20251102_140411.html (ID包含下划线)
   */
  parseFileName(filename) {
    // 使用非贪婪匹配，支持ID中包含下划线
    const match = filename.match(/^(friend|group)_(.+?)_(\d{8})_(\d{6})\.(.+)$/);
    if (!match) return null;

    const [, type, id, date, time, ext] = match;
    
    return {
      type: type === 'group' ? 'group' : 'private',
      chatId: id,
      date: `${date.substring(0, 4)}-${date.substring(4, 6)}-${date.substring(6, 8)}`,
      time: `${time.substring(0, 2)}:${time.substring(2, 4)}:${time.substring(4, 6)}`,
      format: ext.toUpperCase(),
      filename
    };
  }

  /**
   * 从 HTML 文件提取元数据
   */
  extractHtmlMetadata(filePath) {
    try {
      const content = fs.readFileSync(filePath, 'utf-8');
      const match = content.match(/QCE_METADATA:\s*({[^}]+})/);
      if (match) {
        return JSON.parse(match[1]);
      }
    } catch (error) {
      console.error(`读取 HTML 元数据失败: ${filePath}`, error.message);
    }
    return null;
  }

  /**
   * 从 JSON 文件提取元数据和资源
   */
  extractJsonData(filePath) {
    try {
      const content = fs.readFileSync(filePath, 'utf-8');
      const data = JSON.parse(content);
      
      // 提取基本元数据
      const metadata = {
        chatName: data.chatInfo?.name || '未知',
        chatType: data.chatInfo?.type || 'unknown',
        messageCount: data.statistics?.totalMessages || 0,
        timeRange: data.statistics?.timeRange || null,
        resources: data.statistics?.resources || null,
        senders: data.statistics?.senders || []
      };

      // 提取所有资源
      const resources = [];
      if (data.messages && Array.isArray(data.messages)) {
        data.messages.forEach(msg => {
          if (msg.content?.resources && Array.isArray(msg.content.resources)) {
            msg.content.resources.forEach(res => {
              // 尝试从 resources.jsonl 中找到实际的本地路径
              const actualPath = this.findResourcePath(res.filename, res.type);
              resources.push({
                ...res,
                messageId: msg.id,
                timestamp: msg.timestamp,
                time: msg.time,
                sender: msg.sender,
                actualFilename: actualPath || res.filename
              });
            });
          }
        });
      }

      return { metadata, resources };
    } catch (error) {
      console.error(`读取 JSON 数据失败: ${filePath}`, error.message);
      return { metadata: null, resources: [] };
    }
  }

  /**
   * 获取文件大小（格式化）
   */
  getFileSize(filePath) {
    try {
      const stats = fs.statSync(filePath);
      const bytes = stats.size;
      
      if (bytes < 1024) return `${bytes} B`;
      if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(2)} KB`;
      if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
      return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
    } catch (error) {
      return '未知';
    }
  }

  /**
   * 扫描所有导出文件
   */
  scanExports() {
    // 返回缓存（5分钟内）
    if (this.cache && this.cacheTime && Date.now() - this.cacheTime < 5 * 60 * 1000) {
      return this.cache;
    }

    this.checkDirectories();

    const files = fs.readdirSync(this.exportsDir);
    const chatMap = new Map(); // 按 chatId 分组

    files.forEach(filename => {
      const filePath = path.join(this.exportsDir, filename);
      const stat = fs.statSync(filePath);
      
      // 跳过目录
      if (stat.isDirectory()) return;

      const parsed = this.parseFileName(filename);
      if (!parsed) return;

      const fileInfo = {
        filename,
        filePath,
        format: parsed.format,
        exportDate: parsed.date,
        exportTime: parsed.time,
        fileSize: this.getFileSize(filePath),
        fileSizeBytes: stat.size
      };

      // 根据文件类型提取额外信息
      if (parsed.format === 'JSON') {
        const { metadata, resources } = this.extractJsonData(filePath);
        fileInfo.metadata = metadata;
        fileInfo.resources = resources;
        fileInfo.resourceCount = resources.length;
        // 修正：文件名的type优先于JSON内容的type
        if (fileInfo.metadata) {
          fileInfo.metadata.chatType = parsed.type;
        }
      } else if (parsed.format === 'HTML') {
        const htmlMeta = this.extractHtmlMetadata(filePath);
        if (htmlMeta) {
          fileInfo.metadata = {
            chatName: htmlMeta.chatName || '未知',
            messageCount: htmlMeta.messageCount || 0,
            chatType: parsed.type
          };
        }
      }

      // 按 chatId 分组
      const key = `${parsed.type}_${parsed.chatId}`;
      if (!chatMap.has(key)) {
        chatMap.set(key, {
          chatId: parsed.chatId,
          type: parsed.type, // 使用文件名解析的type，因为这个是准确的
          chatName: fileInfo.metadata?.chatName || '未知',
          exports: [],
          totalResources: 0
        });
      }

      const chat = chatMap.get(key);
      chat.exports.push(fileInfo);
      chat.totalResources += fileInfo.resourceCount || 0;
      
      // 更新聊天名称（优先使用最新的）
      if (fileInfo.metadata?.chatName && fileInfo.metadata.chatName !== '未知') {
        chat.chatName = fileInfo.metadata.chatName;
      }
    });

    // 转换为数组并排序
    const chats = Array.from(chatMap.values()).map(chat => {
      // 按导出时间排序（最新的在前）
      chat.exports.sort((a, b) => {
        const dateA = new Date(`${a.exportDate} ${a.exportTime}`);
        const dateB = new Date(`${b.exportDate} ${b.exportTime}`);
        return dateB - dateA;
      });
      
      // 获取最新导出的元数据作为主要信息
      const latestExport = chat.exports[0];
      chat.latestExport = latestExport;
      chat.messageCount = latestExport.metadata?.messageCount || 0;
      chat.exportCount = chat.exports.length;
      
      return chat;
    });

    // 按聊天名称排序
    chats.sort((a, b) => a.chatName.localeCompare(b.chatName, 'zh-CN'));

    this.cache = {
      chats,
      totalChats: chats.length,
      totalExports: chats.reduce((sum, c) => sum + c.exportCount, 0),
      totalResources: chats.reduce((sum, c) => sum + c.totalResources, 0),
      scannedAt: new Date().toISOString(),
      baseDir: this.baseDir
    };
    this.cacheTime = Date.now();

    return this.cache;
  }

  /**
   * 获取特定聊天的详细信息
   */
  getChatDetails(chatId, type) {
    const scanResult = this.scanExports();
    const key = `${type}_${chatId}`;
    const chat = scanResult.chats.find(c => `${c.type}_${c.chatId}` === key);
    
    if (!chat) {
      throw new Error('找不到指定的聊天记录');
    }

    return chat;
  }

  /**
   * 获取特定聊天的所有资源
   */
  getChatResources(chatId, type) {
    const chat = this.getChatDetails(chatId, type);
    
    // 合并所有导出的资源（去重）
    const resourceMap = new Map();
    
    chat.exports.forEach(exportFile => {
      if (exportFile.resources) {
        exportFile.resources.forEach(res => {
          const key = `${res.filename}_${res.type}`;
          if (!resourceMap.has(key)) {
            resourceMap.set(key, {
              ...res,
              exportFile: exportFile.filename
            });
          }
        });
      }
    });

    return Array.from(resourceMap.values());
  }

  /**
   * 获取所有资源（跨聊天）
   */
  getAllResources() {
    const scanResult = this.scanExports();
    const allResources = [];

    scanResult.chats.forEach(chat => {
      const resources = this.getChatResources(chat.chatId, chat.type);
      resources.forEach(res => {
        allResources.push({
          ...res,
          chatId: chat.chatId,
          chatName: chat.chatName,
          chatType: chat.type
        });
      });
    });

    // 按时间排序
    allResources.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));

    return allResources;
  }

  /**
   * 搜索聊天
   */
  searchChats(query) {
    const scanResult = this.scanExports();
    const lowerQuery = query.toLowerCase();
    
    return scanResult.chats.filter(chat => 
      chat.chatName.toLowerCase().includes(lowerQuery) ||
      chat.chatId.toLowerCase().includes(lowerQuery)
    );
  }

  /**
   * 从 resources.jsonl 中查找资源的实际文件名
   */
  findResourcePath(filename, type) {
    const resourcesJsonl = path.join(this.baseDir, 'resources.jsonl');
    if (!fs.existsSync(resourcesJsonl)) {
      return null;
    }

    try {
      const content = fs.readFileSync(resourcesJsonl, 'utf-8');
      const lines = content.split('\n').filter(line => line.trim());
      
      for (const line of lines) {
        try {
          const resource = JSON.parse(line);
          // 匹配文件名（不区分大小写）
          if (resource.fileName && resource.fileName.toLowerCase() === filename.toLowerCase()) {
            // 提取实际文件名
            if (resource.localPath) {
              const actualFilename = path.basename(resource.localPath);
              return actualFilename;
            }
          }
        } catch (e) {
          // 跳过无效的行
        }
      }
    } catch (error) {
      console.error('读取 resources.jsonl 失败:', error);
    }

    return null;
  }
}

module.exports = ChatExportScanner;

