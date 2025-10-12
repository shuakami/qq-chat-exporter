/**
 * QQ聊天记录导出工具安全管理器
 * 负责处理认证、密钥生成和IP获取
 */

import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

export interface SecurityConfig {
    accessToken: string;
    secretKey: string;
    createdAt: Date;
    lastAccess?: Date;
    allowedIPs: string[];
    tokenExpired?: Date;
    /** 用户配置的服务器地址，用于外网访问 */
    serverHost?: string;
}

/**
 * 安全管理器
 */
export class SecurityManager {
    private configPath: string;
    private config: SecurityConfig | null = null;
    private publicIP: string | null = null;

    constructor() {
        const userProfile = process.env['USERPROFILE'] || process.env['HOME'] || '.';
        const securityDir = path.join(userProfile, '.qq-chat-exporter');
        
        // 确保目录存在
        if (!fs.existsSync(securityDir)) {
            fs.mkdirSync(securityDir, { recursive: true });
        }
        
        this.configPath = path.join(securityDir, 'security.json');
    }

    /**
     * 初始化安全配置
     */
    async initialize(): Promise<void> {
        console.log('[SecurityManager] 正在初始化安全配置...');
        
        // 初始化服务器地址（默认localhost）
        this.publicIP = '127.0.0.1';

        // 加载或创建安全配置
        if (fs.existsSync(this.configPath)) {
            await this.loadConfig();
        } else {
            await this.generateInitialConfig();
        }

        // 从配置中设置服务器地址
        if (this.config?.serverHost) {
            this.setServerHost(this.config.serverHost);
        }
    }

    /**
     * 设置服务器地址（供外部配置使用）
     */
    setServerHost(host: string): void {
        // 标准化host地址，参考NapCat的做法
        if (host === '0.0.0.0' || host === '') {
            this.publicIP = '127.0.0.1';
        } else {
            this.publicIP = host;
        }
    }

    /**
     * 更新服务器地址配置并保存
     */
    async updateServerHost(host: string): Promise<void> {
        if (!this.config) return;
        
        this.config.serverHost = host;
        await this.saveConfig();
        this.setServerHost(host);
        
        console.log(`[SecurityManager] 服务器地址已更新为: ${this.publicIP}`);
    }

    /**
     * 生成初始安全配置
     */
    private async generateInitialConfig(): Promise<void> {
        console.log('[SecurityManager] 🔐 首次启动，正在生成安全配置...');
        
        // 生成复杂的访问令牌 (32字符)
        const accessToken = this.generateSecureToken(32);
        
        // 生成密钥 (64字符)
        const secretKey = this.generateSecureToken(64);
        
        this.config = {
            accessToken,
            secretKey,
            createdAt: new Date(),
            allowedIPs: ['127.0.0.1', '::1'], // 默认只允许本地访问
            tokenExpired: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) // 7天过期
        };

        await this.saveConfig();

        console.log('');
        console.log('[SecurityManager] ══════════════════════════════════════════════════════');
        console.log('[SecurityManager] 🔒 安全配置已生成！请妥善保管以下信息：');
        console.log('[SecurityManager] ══════════════════════════════════════════════════════');
        console.log(`[SecurityManager] 🔑 访问令牌: ${accessToken}`);
        console.log(`[SecurityManager] 🛡️  密钥: ${secretKey.substring(0, 16)}...`);
        console.log('[SecurityManager] ⚠️  令牌将在7天后过期，届时需要重新生成');
        console.log('[SecurityManager] 📋 请将令牌添加到浏览器书签或复制保存');
        console.log('[SecurityManager] ══════════════════════════════════════════════════════');
        console.log('');
    }

    /**
     * 加载安全配置
     */
    private async loadConfig(): Promise<void> {
        try {
            const data = fs.readFileSync(this.configPath, 'utf-8');
            this.config = JSON.parse(data);
            
            // 转换日期字段
            if (this.config) {
                this.config.createdAt = new Date(this.config.createdAt);
                if (this.config.lastAccess) {
                    this.config.lastAccess = new Date(this.config.lastAccess);
                }
                if (this.config.tokenExpired) {
                    this.config.tokenExpired = new Date(this.config.tokenExpired);
                }
            }

            console.log('[SecurityManager] ✅ 安全配置已加载');
            
            // 检查令牌是否过期
            if (this.config?.tokenExpired && new Date() > this.config.tokenExpired) {
                console.log('[SecurityManager] ⚠️ 访问令牌已过期，正在重新生成...');
                await this.regenerateToken();
            }
        } catch (error) {
            console.error('[SecurityManager] 加载安全配置失败:', error);
            await this.generateInitialConfig();
        }
    }

    /**
     * 保存安全配置
     */
    private async saveConfig(): Promise<void> {
        try {
            const data = JSON.stringify(this.config, null, 2);
            fs.writeFileSync(this.configPath, data, 'utf-8');
        } catch (error) {
            console.error('[SecurityManager] 保存安全配置失败:', error);
        }
    }

    /**
     * 生成安全令牌
     */
    private generateSecureToken(length: number = 32): string {
        const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*';
        let result = '';
        
        for (let i = 0; i < length; i++) {
            result += chars.charAt(crypto.randomInt(0, chars.length));
        }
        
        return result;
    }

    /**
     * 重新生成访问令牌
     */
    private async regenerateToken(): Promise<void> {
        if (!this.config) return;
        
        this.config.accessToken = this.generateSecureToken(32);
        this.config.tokenExpired = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
        
        await this.saveConfig();
        
        console.log('[SecurityManager] 🔑 新的访问令牌:', this.config.accessToken);
    }

    /**
     * 验证访问令牌
     */
    verifyToken(token: string, clientIP?: string): boolean {
        if (!this.config) return false;
        
        // 验证令牌
        if (token !== this.config.accessToken) {
            return false;
        }
        
        // 验证IP（如果配置了IP白名单）
        if (clientIP && this.config.allowedIPs.length > 0) {
            const isAllowed = this.config.allowedIPs.some(ip => {
                return ip === clientIP || ip === '0.0.0.0';
            });
            
            if (!isAllowed) {
                console.warn(`[SecurityManager] IP ${clientIP} 不在白名单中`);
                return false;
            }
        }
        
        // 验证是否过期
        if (this.config.tokenExpired && new Date() > this.config.tokenExpired) {
            return false;
        }
        
        // 更新最后访问时间
        this.config.lastAccess = new Date();
        this.saveConfig().catch(console.error);
        
        return true;
    }

    /**
     * 获取访问令牌（仅用于显示）
     */
    getAccessToken(): string | null {
        return this.config?.accessToken || null;
    }

    /**
     * 获取服务器地址
     */
    public getPublicIP(): string | null {
        return this.publicIP;
    }

    /**
     * 获取完整的服务器地址信息（用于显示）
     */
    public getServerAddresses(): { local: string; external?: string } {
        const result: { local: string; external?: string } = {
            local: 'http://127.0.0.1:40653'
        };

        // 如果配置的不是localhost，添加外部地址
        if (this.publicIP && this.publicIP !== '127.0.0.1' && this.publicIP !== 'localhost') {
            result.external = `http://${this.publicIP}:40653`;
        }

        return result;
    }

    /**
     * 获取安全状态信息
     */
    getSecurityStatus(): {
        hasConfig: boolean;
        tokenExpired: boolean;
        publicIP: string | null;
        createdAt: Date | null;
        lastAccess: Date | null;
    } {
        return {
            hasConfig: !!this.config,
            tokenExpired: !!(this.config?.tokenExpired && new Date() > this.config.tokenExpired),
            publicIP: this.publicIP,
            createdAt: this.config?.createdAt || null,
            lastAccess: this.config?.lastAccess || null
        };
    }

    /**
     * 添加IP到白名单
     */
    async addAllowedIP(ip: string): Promise<void> {
        if (!this.config) return;
        
        if (!this.config.allowedIPs.includes(ip)) {
            this.config.allowedIPs.push(ip);
            await this.saveConfig();
            console.log(`[SecurityManager] IP ${ip} 已添加到白名单`);
        }
    }

    /**
     * 生成新的访问令牌（手动）
     */
    async generateNewToken(): Promise<string> {
        if (!this.config) throw new Error('安全配置未初始化');
        
        await this.regenerateToken();
        return this.config.accessToken;
    }
}