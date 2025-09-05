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
    private devServer: ChildProcess | null = null;
    private isDevMode: boolean = false;
    private frontendPort: number = 3000;
    private staticPath: string;
    private nextjsProjectPath: string;

    constructor() {
        // 智能检测静态资源路径
        const cwd = process.cwd();
        if (cwd.endsWith('dist')) {
            // 如果当前目录已经是dist目录，直接使用相对路径
            this.staticPath = path.join(cwd, 'static', 'qce-v4-tool');
        } else {
            // 否则从项目根目录构建路径
            this.staticPath = path.join(cwd, 'dist', 'static', 'qce-v4-tool');
        }
        
        // NextJS项目路径智能检测
        if (cwd.endsWith('dist')) {
            // 如果在dist目录中运行，NextJS项目在../../qce-v4-tool
            this.nextjsProjectPath = path.join(cwd, '..', '..', 'qce-v4-tool');
        } else {
            // 否则NextJS项目与NapCatQQ同级
            this.nextjsProjectPath = path.join(cwd, '..', 'qce-v4-tool');
        }
        
        // 检查是否在开发环境
        this.isDevMode = process.env['NODE_ENV'] !== 'production' && process.env['QCE_DEV_MODE'] === 'true';
    }

    /**
     * 初始化前端服务
     */
    async initialize(): Promise<void> {
        if (this.isDevMode) {
            console.log('[FrontendBuilder] 🚀 启动NextJS开发服务器');
            await this.startDevServer();
        } else {
            await this.checkStaticAssets();
        }
    }

    /**
     * 启动NextJS开发服务器
     */
    private async startDevServer(): Promise<void> {
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

        } catch (error) {
            console.error('[FrontendBuilder] 启动NextJS开发服务器失败:', error);
            throw error;
        }
    }

    /**
     * 检查静态资源是否存在
     */
    private async checkStaticAssets(): Promise<void> {
        try {
            if (!fs.existsSync(this.staticPath)) {
                console.warn('[FrontendBuilder] ⚠️ 前端静态资源未找到，请运行 npm run build:universal');
            }
        } catch (error) {
            console.error('[FrontendBuilder] 检查静态资源失败:', error);
        }
    }

    /**
     * 设置前端静态文件服务路由
     * @param app Express应用实例
     */
    setupStaticRoutes(app: express.Application): void {
        if (!this.isDevMode && fs.existsSync(this.staticPath)) {
            // 生产模式：提供静态文件服务
            app.use('/static/qce-v4-tool', express.static(this.staticPath, {
                maxAge: '1d',
                setHeaders: (res, path) => {
                    // 为HTML文件设置正确的Content-Type
                    if (path.endsWith('.html')) {
                        res.setHeader('Content-Type', 'text/html; charset=utf-8');
                    }
                }
            }));

            // 处理前端应用的根级静态资源请求
            app.get('/text-logo.png', (req, res) => {
                const filePath = path.join(this.staticPath, 'text-logo.png');
                if (fs.existsSync(filePath)) {
                    res.sendFile(filePath);
                } else {
                    res.status(404).send('File not found');
                }
            });

            app.get('/text-full-logo.png', (req, res) => {
                const filePath = path.join(this.staticPath, 'text-full-logo.png');
                if (fs.existsSync(filePath)) {
                    res.sendFile(filePath);
                } else {
                    res.status(404).send('File not found');
                }
            });

            app.get('/placeholder-logo.png', (req, res) => {
                const filePath = path.join(this.staticPath, 'placeholder-logo.png');
                if (fs.existsSync(filePath)) {
                    res.sendFile(filePath);
                } else {
                    res.status(404).send('File not found');
                }
            });

            app.get('/placeholder-logo.svg', (req, res) => {
                const filePath = path.join(this.staticPath, 'placeholder-logo.svg');
                if (fs.existsSync(filePath)) {
                    res.sendFile(filePath);
                } else {
                    res.status(404).send('File not found');
                }
            });

            app.get('/placeholder-user.jpg', (req, res) => {
                const filePath = path.join(this.staticPath, 'placeholder-user.jpg');
                if (fs.existsSync(filePath)) {
                    res.sendFile(filePath);
                } else {
                    res.status(404).send('File not found');
                }
            });

            app.get('/placeholder.jpg', (req, res) => {
                const filePath = path.join(this.staticPath, 'placeholder.jpg');
                if (fs.existsSync(filePath)) {
                    res.sendFile(filePath);
                } else {
                    res.status(404).send('File not found');
                }
            });

            app.get('/placeholder.svg', (req, res) => {
                const filePath = path.join(this.staticPath, 'placeholder.svg');
                if (fs.existsSync(filePath)) {
                    res.sendFile(filePath);
                } else {
                    res.status(404).send('File not found');
                }
            });

            // 处理Vercel分析脚本（本地环境返回空脚本）
            app.get('/_vercel/insights/script.js', (_req, res) => {
                res.setHeader('Content-Type', 'application/javascript');
                res.send('// Vercel Analytics disabled in local development');
            });

            // 认证页面路由
            app.get('/qce-v4-tool/auth', (_req, res) => {
                res.send(this.generateAuthPage());
            });

            // 添加前端应用的入口路由
            app.get('/qce-v4-tool', (req, res) => {
                const indexPath = path.join(this.staticPath, 'index.html');
                if (fs.existsSync(indexPath)) {
                    // 总是返回前端应用，让前端自己处理认证
                    res.sendFile(indexPath);
                } else {
                    res.status(404).send('前端应用未构建或文件不存在');
                }
            });

            // 处理前端应用的所有路由（SPA路由支持）
            app.get(/^\/qce-v4-tool\/.*/, (_req, res) => {
                const indexPath = path.join(this.staticPath, 'index.html');
                if (fs.existsSync(indexPath)) {
                    res.sendFile(indexPath);
                } else {
                    res.status(404).send('前端应用未构建或文件不存在');
                }
            });

            // 静态文件路由设置完成
        } else if (this.isDevMode) {
            // 开发模式：代理到NextJS开发服务器
            app.get('/qce-v4-tool', (_req, res) => {
                res.redirect(`http://localhost:${this.frontendPort}`);
            });

            console.log('[FrontendBuilder] ✅ 开发模式代理路由已设置，将重定向到NextJS开发服务器');
        }
    }

    /**
     * 获取前端访问URL
     */
    getFrontendUrl(): string {
        if (this.isDevMode) {
            return `http://localhost:${this.frontendPort}`;
        } else {
            return '/qce-v4-tool';
        }
    }

    /**
     * 检查前端服务是否在运行
     */
    isRunning(): boolean {
        if (this.isDevMode) {
            return this.devServer !== null && !this.devServer.killed;
        } else {
            return fs.existsSync(this.staticPath);
        }
    }

    /**
     * 停止前端服务
     */
    async stop(): Promise<void> {
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
                } else {
                    resolve();
                }
            });
        }
    }

    /**
     * 获取服务状态信息
     */
    getStatus(): {
        isRunning: boolean;
        mode: 'development' | 'production';
        frontendUrl: string;
        staticPath?: string;
    } {
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
    private generateAuthPage(): string {
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
                    window.location.href = '/qce-v4-tool?token=' + encodeURIComponent(token);
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