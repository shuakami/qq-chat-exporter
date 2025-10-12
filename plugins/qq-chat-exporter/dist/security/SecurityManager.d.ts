/**
 * QQ聊天记录导出工具安全管理器
 * 负责处理认证、密钥生成和IP获取
 */
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
export declare class SecurityManager {
    private configPath;
    private config;
    private publicIP;
    constructor();
    /**
     * 初始化安全配置
     */
    initialize(): Promise<void>;
    /**
     * 设置服务器地址（供外部配置使用）
     */
    setServerHost(host: string): void;
    /**
     * 更新服务器地址配置并保存
     */
    updateServerHost(host: string): Promise<void>;
    /**
     * 生成初始安全配置
     */
    private generateInitialConfig;
    /**
     * 加载安全配置
     */
    private loadConfig;
    /**
     * 保存安全配置
     */
    private saveConfig;
    /**
     * 生成安全令牌
     */
    private generateSecureToken;
    /**
     * 重新生成访问令牌
     */
    private regenerateToken;
    /**
     * 验证访问令牌
     */
    verifyToken(token: string, clientIP?: string): boolean;
    /**
     * 获取访问令牌（仅用于显示）
     */
    getAccessToken(): string | null;
    /**
     * 获取服务器地址
     */
    getPublicIP(): string | null;
    /**
     * 获取完整的服务器地址信息（用于显示）
     */
    getServerAddresses(): {
        local: string;
        external?: string;
    };
    /**
     * 获取安全状态信息
     */
    getSecurityStatus(): {
        hasConfig: boolean;
        tokenExpired: boolean;
        publicIP: string | null;
        createdAt: Date | null;
        lastAccess: Date | null;
    };
    /**
     * 添加IP到白名单
     */
    addAllowedIP(ip: string): Promise<void>;
    /**
     * 生成新的访问令牌（手动）
     */
    generateNewToken(): Promise<string>;
}
//# sourceMappingURL=SecurityManager.d.ts.map