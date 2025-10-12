/**
 * 配置管理器
 * 负责系统配置和用户配置的统一管理
 * 支持配置验证、热重载、环境变量覆盖等功能
 */
import { SystemConfig, ExportFormat } from '../../types.js';
/**
 * 用户配置接口
 */
interface UserConfig {
    /** 用户偏好的导出格式 */
    preferredFormats: ExportFormat[];
    /** 自定义输出目录 */
    customOutputDir?: string;
    /** 自定义批量大小 */
    customBatchSize?: number;
    /** 是否自动备份 */
    autoBackup: boolean;
    /** 备份保留天数 */
    backupRetentionDays: number;
    /** 主题设置 */
    theme: 'light' | 'dark' | 'auto';
    /** 语言设置 */
    language: 'zh-CN' | 'en-US';
    /** 是否显示高级选项 */
    showAdvancedOptions: boolean;
    /** 资源链接处理策略 */
    resourceLinkStrategy: 'keep' | 'download' | 'placeholder';
    /** 导出时是否包含系统消息 */
    includeSystemMessages: boolean;
    /** 是否过滤掉纯多媒体消息（只包含图片、视频、音频、文件、表情等，无文字内容） */
    filterPureImageMessages: boolean;
    /** 是否启用通知 */
    enableNotifications: boolean;
    /** WebUI访问密码（可选） */
    webuiPassword?: string;
}
/**
 * 配置管理器类
 * 提供配置的加载、保存、验证、监听等功能
 */
export declare class ConfigManager {
    private systemConfig;
    private userConfig;
    private readonly configDir;
    private readonly systemConfigPath;
    private readonly userConfigPath;
    /** 配置变更监听器 */
    private configChangeListeners;
    /** 文件监听器 */
    private fileWatchers;
    /**
     * 构造函数
     * @param configDir 配置文件目录，默认为用户主目录下的.qq-chat-exporter
     */
    constructor(configDir?: string);
    /**
     * 初始化配置管理器
     * 加载配置文件，设置监听器等
     */
    initialize(): Promise<void>;
    /**
     * 加载系统配置
     */
    private loadSystemConfig;
    /**
     * 加载用户配置
     */
    private loadUserConfig;
    /**
     * 保存系统配置
     */
    saveSystemConfig(): Promise<void>;
    /**
     * 保存用户配置
     */
    saveUserConfig(): Promise<void>;
    /**
     * 应用环境变量覆盖
     */
    private applyEnvironmentOverrides;
    /**
     * 验证配置
     */
    private validateConfig;
    /**
     * 设置文件监听器
     */
    private setupFileWatchers;
    /**
     * 处理配置文件变更
     */
    private handleConfigFileChange;
    /**
     * 确保配置目录存在
     */
    private ensureConfigDirExists;
    /**
     * 确保必要的目录存在
     */
    private ensureRequiredDirectoriesExist;
    /**
     * 获取合并后的完整配置
     */
    getConfig(): SystemConfig & UserConfig;
    /**
     * 获取系统配置
     */
    getSystemConfig(): SystemConfig;
    /**
     * 获取用户配置
     */
    getUserConfig(): UserConfig;
    /**
     * 更新系统配置
     */
    updateSystemConfig(updates: Partial<SystemConfig>): Promise<void>;
    /**
     * 更新用户配置
     */
    updateUserConfig(updates: Partial<UserConfig>): Promise<void>;
    /**
     * 重置为默认配置
     */
    resetToDefaults(): Promise<void>;
    /**
     * 导出配置到文件
     */
    exportConfig(filePath: string): Promise<void>;
    /**
     * 从文件导入配置
     */
    importConfig(filePath: string): Promise<void>;
    /**
     * 添加配置变更监听器
     */
    onConfigChange(listener: (config: SystemConfig & UserConfig) => void): () => void;
    /**
     * 通知配置变更
     */
    private notifyConfigChange;
    /**
     * 获取配置路径信息
     */
    getConfigPaths(): {
        configDir: string;
        systemConfigPath: string;
        userConfigPath: string;
    };
    /**
     * 清理资源
     */
    dispose(): void;
}
export {};
//# sourceMappingURL=ConfigManager.d.ts.map