/**
 * QQ聊天记录导出工具前端服务管理器
 * 负责管理NextJS前端应用的启动和服务
 */
import { ChildProcess, spawn } from 'child_process';
import path from 'path';
import fs from 'fs';
import express from 'express';
/**
 * 前端服务管理器
 */
export class FrontendBuilder {
    devServer = null;
    isDevMode = false;
    frontendPort = 3000;
    staticPath;
    nextjsProjectPath;
    constructor() {
        // 智能检测静态资源路径
        const cwd = process.cwd();
        // 检测可能的静态资源路径
        const possiblePaths = [
            path.join(cwd, 'static', 'qce'), // Release包直接运行
            path.join(cwd, 'dist', 'static', 'qce'), // 开发环境从项目根目录运行
            path.join(cwd, '..', 'static', 'qce'), // 其他可能的情况
        ];
        // 找到第一个存在的路径
        this.staticPath = possiblePaths.find(p => fs.existsSync(p)) || possiblePaths[0];
        // NextJS项目路径智能检测
        const possibleNextjsPaths = [
            path.join(cwd, '..', '..', 'qce-v4-tool'), // 从dist目录运行
            path.join(cwd, '..', 'qce-v4-tool'), // 从项目根目录运行
            path.join(cwd, 'qce-v4-tool'), // 特殊情况
        ];
        this.nextjsProjectPath = possibleNextjsPaths.find(p => fs.existsSync(p)) || possibleNextjsPaths[1];
        // 检查是否在开发环境
        this.isDevMode = process.env['NODE_ENV'] !== 'production' && process.env['QCE_DEV_MODE'] === 'true';
    }
    /**
     * 初始化前端服务
     */
    async initialize() {
        if (this.isDevMode) {
            console.log('[FrontendBuilder] 🚀 启动NextJS开发服务器');
            await this.startDevServer();
        }
        else {
            await this.checkStaticAssets();
        }
    }
    /**
     * 启动NextJS开发服务器
     */
    async startDevServer() {
        try {
            // 检查NextJS项目目录是否存在
            if (!fs.existsSync(this.nextjsProjectPath)) {
                console.error('[FrontendBuilder] NextJS项目目录不存在:', this.nextjsProjectPath);
                return;
            }
            console.log('[FrontendBuilder] 正在启动NextJS开发服务器...');
            // 启动NextJS开发服务器 (使用pnpm)
            this.devServer = spawn('pnpm', ['run', 'dev'], {
                cwd: this.nextjsProjectPath,
                stdio: 'pipe',
                shell: true
            });
            // 监听输出
            this.devServer.stdout?.on('data', (data) => {
                const output = data.toString();
                console.log('[FrontendBuilder] [NextJS Dev]', output.trim());
                // 检查服务器是否启动成功
                if (output.includes('Ready in') || output.includes('ready -')) {
                    console.log('[FrontendBuilder] ✅ NextJS开发服务器启动成功');
                    console.log(`[FrontendBuilder] 🌐 前端地址: http://localhost:${this.frontendPort}`);
                }
            });
            this.devServer.stderr?.on('data', (data) => {
                console.error('[FrontendBuilder] [NextJS Dev Error]', data.toString().trim());
            });
            this.devServer.on('exit', (code) => {
                console.log(`[FrontendBuilder] NextJS开发服务器退出，退出码: ${code}`);
                this.devServer = null;
            });
            this.devServer.on('error', (error) => {
                console.error('[FrontendBuilder] NextJS开发服务器启动失败:', error);
                this.devServer = null;
            });
        }
        catch (error) {
            console.error('[FrontendBuilder] 启动NextJS开发服务器失败:', error);
            throw error;
        }
    }
    /**
     * 检查静态资源是否存在
     */
    async checkStaticAssets() {
        try {
            console.log('[FrontendBuilder] 正在检查静态资源路径:', this.staticPath);
            if (fs.existsSync(this.staticPath)) {
                // 检查关键文件
                const indexFile = path.join(this.staticPath, 'index.html');
                if (fs.existsSync(indexFile)) {
                    console.log('[FrontendBuilder] ✅ QCE V4 前端静态资源已就绪');
                }
                else {
                    console.warn('[FrontendBuilder] ⚠️ 静态资源目录存在，但缺少 index.html 文件');
                }
            }
            else {
                console.warn('[FrontendBuilder] ⚠️ 前端静态资源未找到，请运行 npm run build:universal');
                console.log('[FrontendBuilder] 当前工作目录:', process.cwd());
                console.log('[FrontendBuilder] 期望的静态资源路径:', this.staticPath);
            }
        }
        catch (error) {
            console.error('[FrontendBuilder] 检查静态资源失败:', error);
        }
    }
    /**
     * 设置前端静态文件服务路由
     * @param app Express应用实例
     */
    setupStaticRoutes(app) {
        if (!this.isDevMode && fs.existsSync(this.staticPath)) {
            // 生产模式：提供静态文件服务
            app.use('/static/qce', express.static(this.staticPath, {
                maxAge: '1d',
                setHeaders: (res, path) => {
                    // 为HTML文件设置正确的Content-Type
                    if (path.endsWith('.html')) {
                        res.setHeader('Content-Type', 'text/html; charset=utf-8');
                    }
                }
            }));
            // 处理前端应用的根级静态资源请求
            app.get('/text-logo.png', (_req, res) => {
                const filePath = path.join(this.staticPath, 'text-logo.png');
                if (fs.existsSync(filePath)) {
                    res.sendFile(filePath);
                }
                else {
                    res.status(404).send('File not found');
                }
            });
            app.get('/text-full-logo.png', (_req, res) => {
                const filePath = path.join(this.staticPath, 'text-full-logo.png');
                if (fs.existsSync(filePath)) {
                    res.sendFile(filePath);
                }
                else {
                    res.status(404).send('File not found');
                }
            });
            app.get('/placeholder-logo.png', (_req, res) => {
                const filePath = path.join(this.staticPath, 'placeholder-logo.png');
                if (fs.existsSync(filePath)) {
                    res.sendFile(filePath);
                }
                else {
                    res.status(404).send('File not found');
                }
            });
            app.get('/placeholder-logo.svg', (_req, res) => {
                const filePath = path.join(this.staticPath, 'placeholder-logo.svg');
                if (fs.existsSync(filePath)) {
                    res.sendFile(filePath);
                }
                else {
                    res.status(404).send('File not found');
                }
            });
            app.get('/placeholder-user.jpg', (_req, res) => {
                const filePath = path.join(this.staticPath, 'placeholder-user.jpg');
                if (fs.existsSync(filePath)) {
                    res.sendFile(filePath);
                }
                else {
                    res.status(404).send('File not found');
                }
            });
            app.get('/placeholder.jpg', (_req, res) => {
                const filePath = path.join(this.staticPath, 'placeholder.jpg');
                if (fs.existsSync(filePath)) {
                    res.sendFile(filePath);
                }
                else {
                    res.status(404).send('File not found');
                }
            });
            app.get('/placeholder.svg', (_req, res) => {
                const filePath = path.join(this.staticPath, 'placeholder.svg');
                if (fs.existsSync(filePath)) {
                    res.sendFile(filePath);
                }
                else {
                    res.status(404).send('File not found');
                }
            });
            // 处理Vercel分析脚本（本地环境返回空脚本）
            app.get('/_vercel/insights/script.js', (_req, res) => {
                res.setHeader('Content-Type', 'application/javascript');
                res.send('// Vercel Analytics disabled in local development');
            });
            // 认证页面路由
            app.get('/qce/auth', (_req, res) => {
                res.send(this.generateAuthPage());
            });
            // 添加前端应用的入口路由
            app.get('/qce', (_req, res) => {
                const indexPath = path.join(this.staticPath, 'index.html');
                if (fs.existsSync(indexPath)) {
                    // 总是返回前端应用，让前端自己处理认证
                    res.sendFile(indexPath);
                }
                else {
                    res.status(404).send('前端应用未构建或文件不存在');
                }
            });
            // 处理前端应用的所有路由（SPA路由支持）
            app.get(/^\/qce\/.*/, (_req, res) => {
                const indexPath = path.join(this.staticPath, 'index.html');
                if (fs.existsSync(indexPath)) {
                    res.sendFile(indexPath);
                }
                else {
                    res.status(404).send('前端应用未构建或文件不存在');
                }
            });
            // 静态文件路由设置完成
        }
        else if (this.isDevMode) {
            // 开发模式：代理到NextJS开发服务器
            app.get('/qce', (_req, res) => {
                res.redirect(`http://localhost:${this.frontendPort}`);
            });
            console.log('[FrontendBuilder] ✅ 开发模式代理路由已设置，将重定向到NextJS开发服务器');
        }
    }
    /**
     * 获取前端访问URL
     */
    getFrontendUrl() {
        if (this.isDevMode) {
            return `http://localhost:${this.frontendPort}`;
        }
        else {
            return '/qce';
        }
    }
    /**
     * 检查前端服务是否在运行
     */
    isRunning() {
        if (this.isDevMode) {
            return this.devServer !== null && !this.devServer.killed;
        }
        else {
            return fs.existsSync(this.staticPath);
        }
    }
    /**
     * 停止前端服务
     */
    async stop() {
        if (this.devServer && !this.devServer.killed) {
            console.log('[FrontendBuilder] 正在停止NextJS开发服务器...');
            this.devServer.kill('SIGTERM');
            // 等待进程退出
            return new Promise((resolve) => {
                if (this.devServer) {
                    this.devServer.on('exit', () => {
                        console.log('[FrontendBuilder] NextJS开发服务器已停止');
                        resolve();
                    });
                }
                else {
                    resolve();
                }
            });
        }
    }
    /**
     * 获取服务状态信息
     */
    getStatus() {
        return {
            isRunning: this.isRunning(),
            mode: this.isDevMode ? 'development' : 'production',
            frontendUrl: this.getFrontendUrl(),
            staticPath: this.isDevMode ? undefined : this.staticPath
        };
    }
    /**
     * 生成认证页面HTML
     */
    generateAuthPage() {
        return `
<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>QQ聊天记录导出工具 - 认证</title>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body {
            font-family: "Microsoft YaHei", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
            background: #f5f5f5;
            min-height: 100vh;
            display: flex;
            align-items: center;
            justify-content: center;
        }
        .container {
            background: white;
            padding: 40px;
            border: 1px solid #ddd;
            max-width: 400px;
            width: 90%;
        }
        h1 {
            margin-bottom: 20px;
            font-size: 20px;
            color: #333;
        }
        .info {
            margin-bottom: 20px;
            color: #666;
            font-size: 14px;
            line-height: 1.4;
        }
        label {
            display: block;
            margin-bottom: 8px;
            color: #333;
            font-size: 14px;
        }
        input {
            width: 100%;
            padding: 12px;
            border: 1px solid #ddd;
            font-family: inherit;
            font-size: 14px;
            margin-bottom: 20px;
        }
        input:focus {
            outline: none;
            border-color: #333;
        }
        button {
            width: 100%;
            padding: 12px;
            background: #333;
            color: white;
            border: none;
            cursor: pointer;
            font-family: inherit;
            font-size: 14px;
        }
        button:hover {
            background: #555;
        }
        .error {
            color: #c53030;
            font-size: 14px;
            margin-top: 10px;
            display: none;
        }
        .footer {
            margin-top: 30px;
            color: #999;
            font-size: 12px;
            text-align: center;
        }
        .footer a {
            color: #333;
        }
    </style>
</head>
<body>
    <div class="container">
        <h1>QQ聊天记录导出工具</h1>
        
        <div class="info">
            需要访问令牌才能使用。<br>
            请查看控制台启动日志获取令牌。
        </div>
        
        <form id="authForm">
            <label>访问令牌</label>
            <input type="text" id="token" placeholder="输入访问令牌" required>
            <button type="submit">进入</button>
            <div id="error" class="error"></div>
        </form>
        
        <div class="footer">
            <a href="https://github.com/shuakami/qq-chat-exporter">开源项目</a> • 免费软件
        </div>
    </div>

    <script>
        document.getElementById('authForm').addEventListener('submit', async function(e) {
            e.preventDefault();
            
            const token = document.getElementById('token').value.trim();
            const errorDiv = document.getElementById('error');
            
            if (!token) {
                showError('请输入令牌');
                return;
            }
            
            try {
                const response = await fetch('/auth', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({ token })
                });
                
                const result = await response.json();
                
                if (result.success) {
                    // 认证成功后，存储token到localStorage供后续API调用使用
                    localStorage.setItem('qce_access_token', token);
                    window.location.href = '/qce?token=' + encodeURIComponent(token);
                } else {
                    showError(result.error?.message || '认证失败');
                }
            } catch (error) {
                showError('网络错误');
            }
        });
        
        function showError(message) {
            const errorDiv = document.getElementById('error');
            errorDiv.textContent = message;
            errorDiv.style.display = 'block';
            
            setTimeout(() => {
                errorDiv.style.display = 'none';
            }, 3000);
        }
        
        const urlParams = new URLSearchParams(window.location.search);
        const tokenFromUrl = urlParams.get('token');
        if (tokenFromUrl) {
            document.getElementById('token').value = tokenFromUrl;
        }
    </script>
</body>
</html>`;
    }
}
//# sourceMappingURL=FrontendBuilder.js.map