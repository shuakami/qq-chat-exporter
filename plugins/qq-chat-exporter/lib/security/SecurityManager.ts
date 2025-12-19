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
    /** 是否禁用IP白名单验证（Docker环境下可能需要） */
    disableIPWhitelist?: boolean;
}

/**
 * 检测是否在Docker环境中运行
 */
function isDockerEnvironment(): boolean {
    try {
        // 检查 /.dockerenv 文件
        if (fs.existsSync('/.dockerenv')) {
            return true;
        }
        // 检查 /proc/self/cgroup 中是否包含 docker
        if (fs.existsSync('/proc/self/cgroup')) {
            const cgroup = fs.readFileSync('/proc/self/cgroup', 'utf8');
            if (cgroup.includes('docker') || cgroup.includes('kubepods')) {
                return true;
            }
        }
        // 检查容器环境变量
        if (process.env['container'] || process.env['DOCKER_CONTAINER']) {
            return true;
        }
    } catch {
        // 忽略错误
    }
    return false;
}

/**
 * 解析CIDR格式的IP地址
 * @param cidr CIDR格式字符串，如 "172.16.0.0/12"
 * @returns 解析结果，包含网络地址和掩码位数
 */
function parseCIDR(cidr: string): { ip: number; maskBits: number } | null {
    const parts = cidr.split('/');
    if (parts.length !== 2) return null;
    
    const ipParts = parts[0].split('.');
    if (ipParts.length !== 4) return null;
    
    const maskBits = parseInt(parts[1], 10);
    if (isNaN(maskBits) || maskBits < 0 || maskBits > 32) return null;
    
    let ip = 0;
    for (const part of ipParts) {
        const num = parseInt(part, 10);
        if (isNaN(num) || num < 0 || num > 255) return null;
        ip = (ip << 8) | num;
    }
    
    return { ip: ip >>> 0, maskBits };
}

/**
 * 将IP地址字符串转换为数字
 */
function ipToNumber(ip: string): number | null {
    // 处理IPv6映射的IPv4地址
    const cleanIP = ip.replace(/^::ffff:/, '');
    
    const parts = cleanIP.split('.');
    if (parts.length !== 4) return null;
    
    let result = 0;
    for (const part of parts) {
        const num = parseInt(part, 10);
        if (isNaN(num) || num < 0 || num > 255) return null;
        result = (result << 8) | num;
    }
    
    return result >>> 0;
}

/**
 * 检查IP是否匹配CIDR规则
 */
function ipMatchesCIDR(ip: string, cidr: string): boolean {
    const cidrParsed = parseCIDR(cidr);
    if (!cidrParsed) return false;
    
    const ipNum = ipToNumber(ip);
    if (ipNum === null) return false;
    
    const mask = cidrParsed.maskBits === 0 ? 0 : (~0 << (32 - cidrParsed.maskBits)) >>> 0;
    return (ipNum & mask) === (cidrParsed.ip & mask);
}

/**
 * 检查是否为私有/局域网IP
 */
function isPrivateIP(ip: string): boolean {
    const cleanIP = ip.replace(/^::ffff:/, '');
    
    // 本地回环
    if (cleanIP === '127.0.0.1' || cleanIP === 'localhost' || cleanIP === '::1') {
        return true;
    }
    
    // 检查私有网段
    const privateRanges = [
        '10.0.0.0/8',      // Class A 私有网络
        '172.16.0.0/12',   // Class B 私有网络 (172.16.0.0 - 172.31.255.255)
        '192.168.0.0/16',  // Class C 私有网络
        '169.254.0.0/16',  // 链路本地地址
    ];
    
    return privateRanges.some(range => ipMatchesCIDR(cleanIP, range));
}

/**
 * 安全管理器
 */
export class SecurityManager {
    private configPath: string;
    private config: SecurityConfig | null = null;
    private publicIP: string | null = null;
    private isDocker: boolean = false;
    private configWatcher: fs.FSWatcher | null = null;

    constructor() {
        const userProfile = process.env['USERPROFILE'] || process.env['HOME'] || '.';
        const securityDir = path.join(userProfile, '.qq-chat-exporter');
        
        // 确保目录存在
        if (!fs.existsSync(securityDir)) {
            fs.mkdirSync(securityDir, { recursive: true });
        }
        
        this.configPath = path.join(securityDir, 'security.json');
        this.isDocker = isDockerEnvironment();
    }

    /**
     * 初始化安全配置
     */
    async initialize(): Promise<void> {
        // 初始化服务器地址（默认localhost，Docker环境下使用0.0.0.0）
        this.publicIP = this.isDocker ? '0.0.0.0' : '127.0.0.1';

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
        
        // 启动配置文件监听（热加载）
        this.startConfigWatcher();
    }
    
    /**
     * 启动配置文件监听，支持热加载
     */
    private startConfigWatcher(): void {
        if (this.configWatcher) {
            return;
        }
        
        try {
            let debounceTimer: NodeJS.Timeout | null = null;
            
            this.configWatcher = fs.watch(this.configPath, (eventType) => {
                if (eventType === 'change') {
                    if (debounceTimer) {
                        clearTimeout(debounceTimer);
                    }
                    debounceTimer = setTimeout(async () => {
                        await this.loadConfig();
                    }, 500);
                }
            });
        } catch (error) {
            // 静默处理
        }
    }
    
    /**
     * 停止配置文件监听
     */
    stopConfigWatcher(): void {
        if (this.configWatcher) {
            this.configWatcher.close();
            this.configWatcher = null;
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
    }

    /**
     * 生成初始安全配置
     */
    private async generateInitialConfig(): Promise<void> {
        // 生成复杂的访问令牌 (32字符)
        const accessToken = this.generateSecureToken(32);
        
        // 生成密钥 (64字符)
        const secretKey = this.generateSecureToken(64);
        
        // 默认白名单：本地 + Docker环境下添加常见的Docker网段
        const defaultAllowedIPs = ['127.0.0.1', '::1'];
        if (this.isDocker) {
            defaultAllowedIPs.push('172.16.0.0/12');
            defaultAllowedIPs.push('192.168.0.0/16');
            defaultAllowedIPs.push('10.0.0.0/8');
        }
        
        this.config = {
            accessToken,
            secretKey,
            createdAt: new Date(),
            allowedIPs: defaultAllowedIPs,
            tokenExpired: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
            disableIPWhitelist: this.isDocker
        };

        await this.saveConfig();
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
            
            // 检查令牌是否过期
            if (this.config?.tokenExpired && new Date() > this.config.tokenExpired) {
                await this.regenerateToken();
            }
        } catch (error) {
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
            // 静默处理
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
        
        // 如果禁用了IP白名单验证，跳过IP检查
        if (this.config.disableIPWhitelist) {
            // 仅依赖Token验证
        } else if (clientIP && this.config.allowedIPs.length > 0) {
            // 验证IP（支持精确匹配、CIDR网段、通配符）
            const isAllowed = this.checkIPAllowed(clientIP);
            
            if (!isAllowed) {
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
     * 检查IP是否在白名单中（支持精确匹配、CIDR网段、通配符）
     */
    private checkIPAllowed(clientIP: string): boolean {
        if (!this.config) return false;
        
        // 清理IP地址（移除IPv6前缀）
        const cleanIP = clientIP.replace(/^::ffff:/, '');
        
        for (const allowedIP of this.config.allowedIPs) {
            // 通配符：允许所有
            if (allowedIP === '0.0.0.0' || allowedIP === '*') {
                return true;
            }
            
            // CIDR格式匹配
            if (allowedIP.includes('/')) {
                if (ipMatchesCIDR(cleanIP, allowedIP)) {
                    return true;
                }
                continue;
            }
            
            // 精确匹配
            if (allowedIP === cleanIP || allowedIP === clientIP) {
                return true;
            }
        }
        
        return false;
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
        }
    }
    
    /**
     * 从白名单移除IP
     */
    async removeAllowedIP(ip: string): Promise<boolean> {
        if (!this.config) return false;
        
        const index = this.config.allowedIPs.indexOf(ip);
        if (index > -1) {
            this.config.allowedIPs.splice(index, 1);
            await this.saveConfig();
            return true;
        }
        return false;
    }
    
    /**
     * 获取当前白名单列表
     */
    getAllowedIPs(): string[] {
        return this.config?.allowedIPs || [];
    }
    
    /**
     * 设置是否禁用IP白名单验证
     */
    async setDisableIPWhitelist(disable: boolean): Promise<void> {
        if (!this.config) return;
        
        this.config.disableIPWhitelist = disable;
        await this.saveConfig();
    }
    
    /**
     * 获取IP白名单是否禁用
     */
    isIPWhitelistDisabled(): boolean {
        return this.config?.disableIPWhitelist || false;
    }
    
    /**
     * 检查是否在Docker环境中
     */
    isInDocker(): boolean {
        return this.isDocker;
    }
    
    /**
     * 获取配置文件路径
     */
    getConfigPath(): string {
        return this.configPath;
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