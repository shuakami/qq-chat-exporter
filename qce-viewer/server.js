const express = require('express');
const path = require('path');
const fs = require('fs');
const open = require('open');
const ChatExportScanner = require('./scanner');

const app = express();
const PORT = process.env.PORT || 3000;
const scanner = new ChatExportScanner();

// 静态文件服务
app.use(express.static('public'));
app.use(express.json());

// API: 获取扫描结果
app.get('/api/scan', (req, res) => {
  try {
    const result = scanner.scanExports();
    res.json({
      success: true,
      data: result
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// API: 刷新扫描
app.post('/api/scan/refresh', (req, res) => {
  try {
    scanner.clearCache();
    const result = scanner.scanExports();
    res.json({
      success: true,
      data: result
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// API: 获取特定聊天详情
app.get('/api/chats/:type/:chatId', (req, res) => {
  try {
    const { type, chatId } = req.params;
    const chat = scanner.getChatDetails(chatId, type);
    res.json({
      success: true,
      data: chat
    });
  } catch (error) {
    res.status(404).json({
      success: false,
      error: error.message
    });
  }
});

// API: 获取特定聊天的资源
app.get('/api/chats/:type/:chatId/resources', (req, res) => {
  try {
    const { type, chatId } = req.params;
    const { resourceType } = req.query;
    
    let resources = scanner.getChatResources(chatId, type);
    
    // 按资源类型筛选
    if (resourceType) {
      resources = resources.filter(r => r.type === resourceType);
    }
    
    res.json({
      success: true,
      data: resources
    });
  } catch (error) {
    res.status(404).json({
      success: false,
      error: error.message
    });
  }
});

// API: 获取所有资源
app.get('/api/resources', (req, res) => {
  try {
    const { type } = req.query;
    let resources = scanner.getAllResources();
    
    // 按类型筛选
    if (type) {
      resources = resources.filter(r => r.type === type);
    }
    
    res.json({
      success: true,
      data: resources,
      total: resources.length
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// API: 搜索聊天
app.get('/api/search', (req, res) => {
  try {
    const { q } = req.query;
    if (!q) {
      return res.json({
        success: true,
        data: []
      });
    }
    
    const results = scanner.searchChats(q);
    res.json({
      success: true,
      data: results
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// API: 设置自定义扫描路径
app.post('/api/settings/path', (req, res) => {
  try {
    const { path: customPath } = req.body;
    if (!customPath) {
      return res.status(400).json({
        success: false,
        error: '路径不能为空'
      });
    }
    
    scanner.setBasePath(customPath);
    const result = scanner.scanExports();
    
    res.json({
      success: true,
      data: result
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      error: error.message
    });
  }
});

// 提供导出文件的直接访问
app.get('/exports/*', (req, res) => {
  try {
    const filePath = path.join(scanner.exportsDir, req.params[0]);
    
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({
        success: false,
        error: '文件不存在'
      });
    }
    
    res.sendFile(filePath);
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// 提供资源文件的访问
app.get('/resources/*', (req, res) => {
  try {
    const filePath = path.join(scanner.resourcesDir, req.params[0]);
    
    if (!fs.existsSync(filePath)) {
      return res.status(404).send('资源文件不存在');
    }
    
    res.sendFile(filePath);
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// 健康检查
app.get('/api/health', (req, res) => {
  res.json({
    success: true,
    status: 'ok',
    baseDir: scanner.baseDir,
    exportsDir: scanner.exportsDir
  });
});

// 启动服务器
app.listen(PORT, () => {
  console.log(`\nQQ Chat Exporter - 聊天记录索引查看器`);
  console.log(`服务器已启动: http://localhost:${PORT}`);
  console.log(`扫描目录: ${scanner.exportsDir}\n`);
  
  // 自动打开浏览器
  setTimeout(() => {
    open(`http://localhost:${PORT}`).catch(() => {
      console.log('无法自动打开浏览器，请手动访问 http://localhost:' + PORT);
    });
  }, 500);
});

// 优雅关闭
process.on('SIGINT', () => {
  console.log('\n正在关闭服务器...');
  process.exit(0);
});

