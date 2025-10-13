/**
 * 配置管理器
 * 负责系统配置和用户配置的统一管理
 * 支持配置验证、热重载、环境变量覆盖等功能
 */
import fs from 'fs';
import path from 'path';
import os from 'os';
import { SystemConfig, ExportFormat, SystemError, ErrorType } from '../../types/index.js';
/**
 * 配置文件名称
 */
const CONFIG_FILE_NAME = 'config.json';
const USER_CONFIG_FILE_NAME = 'user-config.json';
/**
 * 默认系统配置
 */
const DEFAULT_SYSTEM_CONFIG = {
    databasePath: path.join(os.homedir(), '.qq-chat-exporter', 'database.db'),
    outputRootDir: path.join(os.homedir(), '.qq-chat-exporter', 'exports'),
    defaultBatchSize: 5000,
    defaultTimeout: 30000,
    defaultRetryCount: 3,
    maxConcurrentTasks: 3,
    resourceHealthCheckInterval: 60000,
    enableDebugLog: false,
    webuiPort: 8080
};
/**
 * 默认用户配置
 */
const DEFAULT_USER_CONFIG = {
    preferredFormats: [ExportFormat.HTML, ExportFormat.JSON],
    autoBackup: true,
    backupRetentionDays: 7,
    theme: 'auto',
    language: 'zh-CN',
    showAdvancedOptions: false,
    resourceLinkStrategy: 'keep',
    includeSystemMessages: true,
    filterPureImageMessages: false,
    enableNotifications: true
};
/**
 * 配置管理器类
 * 提供配置的加载、保存、验证、监听等功能
 */
export class ConfigManager {
    systemConfig;
    userConfig;
    configDir;
    systemConfigPath;
    userConfigPath;
    /** 配置变更监听器 */
    configChangeListeners = [];
    /** 文件监听器 */
    fileWatchers = [];
    /**
     * 构造函数
     * @param configDir 配置文件目录，默认为用户主目录下的.qq-chat-exporter
     */
    constructor(configDir) {
        this.configDir = configDir || path.join(os.homedir(), '.qq-chat-exporter');
        this.systemConfigPath = path.join(this.configDir, CONFIG_FILE_NAME);
        this.userConfigPath = path.join(this.configDir, USER_CONFIG_FILE_NAME);
        // 初始化为默认配置
        this.systemConfig = { ...DEFAULT_SYSTEM_CONFIG };
        this.userConfig = { ...DEFAULT_USER_CONFIG };
    }
    /**
     * 初始化配置管理器
     * 加载配置文件，设置监听器等
     */
    async initialize() {
        try {
            // 确保配置目录存在
            this.ensureConfigDirExists();
            // 加载系统配置
            await this.loadSystemConfig();
            // 加载用户配置
            await this.loadUserConfig();
            // 应用环境变量覆盖
            this.applyEnvironmentOverrides();
            // 验证配置
            this.validateConfig();
            // 设置文件监听器
            this.setupFileWatchers();
            // 确保必要的目录存在
            this.ensureRequiredDirectoriesExist();
        }
        catch (error) {
            throw new SystemError({
                type: ErrorType.CONFIG_ERROR,
                message: '配置管理器初始化失败',
                details: error,
                timestamp: new Date(),
                context: { configDir: this.configDir }
            });
        }
    }
    /**
     * 加载系统配置
     */
    async loadSystemConfig() {
        if (fs.existsSync(this.systemConfigPath)) {
            try {
                const configData = fs.readFileSync(this.systemConfigPath, 'utf-8');
                const loadedConfig = JSON.parse(configData);
                // 合并配置，保留默认值
                this.systemConfig = {
                    ...DEFAULT_SYSTEM_CONFIG,
                    ...loadedConfig
                };
            }
            catch (error) {
                console.warn('加载系统配置失败，使用默认配置:', error);
                // 使用默认配置并保存
                await this.saveSystemConfig();
            }
        }
        else {
            // 首次运行，创建默认配置文件
            await this.saveSystemConfig();
        }
    }
    /**
     * 加载用户配置
     */
    async loadUserConfig() {
        if (fs.existsSync(this.userConfigPath)) {
            try {
                const configData = fs.readFileSync(this.userConfigPath, 'utf-8');
                const loadedConfig = JSON.parse(configData);
                // 合并配置，保留默认值
                this.userConfig = {
                    ...DEFAULT_USER_CONFIG,
                    ...loadedConfig
                };
            }
            catch (error) {
                console.warn('加载用户配置失败，使用默认配置:', error);
                // 使用默认配置并保存
                await this.saveUserConfig();
            }
        }
        else {
            // 首次运行，创建默认配置文件
            await this.saveUserConfig();
        }
    }
    /**
     * 保存系统配置
     */
    async saveSystemConfig() {
        try {
            const configData = JSON.stringify(this.systemConfig, null, 2);
            fs.writeFileSync(this.systemConfigPath, configData, 'utf-8');
        }
        catch (error) {
            throw new SystemError({
                type: ErrorType.FILESYSTEM_ERROR,
                message: '保存系统配置失败',
                details: error,
                timestamp: new Date(),
                context: { path: this.systemConfigPath }
            });
        }
    }
    /**
     * 保存用户配置
     */
    async saveUserConfig() {
        try {
            const configData = JSON.stringify(this.userConfig, null, 2);
            fs.writeFileSync(this.userConfigPath, configData, 'utf-8');
        }
        catch (error) {
            throw new SystemError({
                type: ErrorType.FILESYSTEM_ERROR,
                message: '保存用户配置失败',
                details: error,
                timestamp: new Date(),
                context: { path: this.userConfigPath }
            });
        }
    }
    /**
     * 应用环境变量覆盖
     */
    applyEnvironmentOverrides() {
        const envMappings = [
            ['QCE_DATABASE_PATH', 'databasePath', (v) => v],
            ['QCE_OUTPUT_DIR', 'outputRootDir', (v) => v],
            ['QCE_BATCH_SIZE', 'defaultBatchSize', (v) => parseInt(v)],
            ['QCE_TIMEOUT', 'defaultTimeout', (v) => parseInt(v)],
            ['QCE_RETRY_COUNT', 'defaultRetryCount', (v) => parseInt(v)],
            ['QCE_MAX_CONCURRENT_TASKS', 'maxConcurrentTasks', (v) => parseInt(v)],
            ['QCE_DEBUG_LOG', 'enableDebugLog', (v) => v.toLowerCase() === 'true'],
            ['QCE_WEBUI_PORT', 'webuiPort', (v) => parseInt(v)]
        ];
        envMappings.forEach(([envVar, configKey, converter]) => {
            const value = process.env[envVar];
            if (value !== undefined) {
                try {
                    this.systemConfig[configKey] = converter(value);
                }
                catch (error) {
                    console.warn(`环境变量 ${envVar} 的值无效: ${value}`);
                }
            }
        });
    }
    /**
     * 验证配置
     */
    validateConfig() {
        const systemValidationRules = {
            defaultBatchSize: {
                validate: (value) => Number.isInteger(value) && value > 0 && value <= 50000,
                message: '批量大小必须是1到50000之间的整数'
            },
            defaultTimeout: {
                validate: (value) => Number.isInteger(value) && value >= 1000 && value <= 300000,
                message: '超时时间必须是1000到300000毫秒之间的整数'
            },
            defaultRetryCount: {
                validate: (value) => Number.isInteger(value) && value >= 0 && value <= 10,
                message: '重试次数必须是0到10之间的整数'
            },
            maxConcurrentTasks: {
                validate: (value) => Number.isInteger(value) && value >= 1 && value <= 10,
                message: '最大并发任务数必须是1到10之间的整数'
            },
            webuiPort: {
                validate: (value) => Number.isInteger(value) && value >= 1024 && value <= 65535,
                message: 'WebUI端口必须是1024到65535之间的整数'
            }
        };
        // 验证系统配置
        Object.entries(systemValidationRules).forEach(([key, rule]) => {
            const value = this.systemConfig[key];
            if (!rule.validate(value)) {
                throw new SystemError({
                    type: ErrorType.VALIDATION_ERROR,
                    message: `系统配置验证失败: ${key} - ${rule.message}`,
                    timestamp: new Date(),
                    context: { key, value }
                });
            }
        });
        // 验证用户配置
        if (this.userConfig.backupRetentionDays < 1 || this.userConfig.backupRetentionDays > 365) {
            throw new SystemError({
                type: ErrorType.VALIDATION_ERROR,
                message: '备份保留天数必须是1到365之间的整数',
                timestamp: new Date()
            });
        }
    }
    /**
     * 设置文件监听器
     */
    setupFileWatchers() {
        try {
            // 监听系统配置文件
            if (fs.existsSync(this.systemConfigPath)) {
                const systemWatcher = fs.watch(this.systemConfigPath, (eventType) => {
                    if (eventType === 'change') {
                        this.handleConfigFileChange('system');
                    }
                });
                this.fileWatchers.push(systemWatcher);
            }
            // 监听用户配置文件
            if (fs.existsSync(this.userConfigPath)) {
                const userWatcher = fs.watch(this.userConfigPath, (eventType) => {
                    if (eventType === 'change') {
                        this.handleConfigFileChange('user');
                    }
                });
                this.fileWatchers.push(userWatcher);
            }
        }
        catch (error) {
            console.warn('设置配置文件监听器失败:', error);
        }
    }
    /**
     * 处理配置文件变更
     */
    async handleConfigFileChange(configType) {
        try {
            // 防抖处理，避免频繁重载
            await new Promise(resolve => setTimeout(resolve, 100));
            if (configType === 'system') {
                await this.loadSystemConfig();
            }
            else {
                await this.loadUserConfig();
            }
            this.validateConfig();
            this.notifyConfigChange();
        }
        catch (error) {
            console.error('配置文件变更处理失败:', error);
        }
    }
    /**
     * 确保配置目录存在
     */
    ensureConfigDirExists() {
        if (!fs.existsSync(this.configDir)) {
            fs.mkdirSync(this.configDir, { recursive: true });
        }
    }
    /**
     * 确保必要的目录存在
     */
    ensureRequiredDirectoriesExist() {
        const directories = [
            path.dirname(this.systemConfig.databasePath),
            this.systemConfig.outputRootDir,
            this.userConfig.customOutputDir
        ].filter(Boolean);
        directories.forEach(dir => {
            if (dir && !fs.existsSync(dir)) {
                try {
                    fs.mkdirSync(dir, { recursive: true });
                }
                catch (error) {
                    console.warn(`创建目录失败: ${dir}`, error);
                }
            }
        });
    }
    /**
     * 获取合并后的完整配置
     */
    getConfig() {
        return {
            ...this.systemConfig,
            ...this.userConfig
        };
    }
    /**
     * 获取系统配置
     */
    getSystemConfig() {
        return { ...this.systemConfig };
    }
    /**
     * 获取用户配置
     */
    getUserConfig() {
        return { ...this.userConfig };
    }
    /**
     * 更新系统配置
     */
    async updateSystemConfig(updates) {
        // 创建临时配置进行验证
        const tempConfig = { ...this.systemConfig, ...updates };
        // 验证临时配置
        const originalConfig = this.systemConfig;
        this.systemConfig = tempConfig;
        try {
            this.validateConfig();
            // 验证通过，保存配置
            await this.saveSystemConfig();
            this.notifyConfigChange();
        }
        catch (error) {
            // 验证失败，恢复原配置
            this.systemConfig = originalConfig;
            throw error;
        }
    }
    /**
     * 更新用户配置
     */
    async updateUserConfig(updates) {
        // 创建临时配置进行验证
        const tempConfig = { ...this.userConfig, ...updates };
        // 验证临时配置
        const originalConfig = this.userConfig;
        this.userConfig = tempConfig;
        try {
            this.validateConfig();
            // 验证通过，保存配置
            await this.saveUserConfig();
            this.notifyConfigChange();
        }
        catch (error) {
            // 验证失败，恢复原配置
            this.userConfig = originalConfig;
            throw error;
        }
    }
    /**
     * 重置为默认配置
     */
    async resetToDefaults() {
        this.systemConfig = { ...DEFAULT_SYSTEM_CONFIG };
        this.userConfig = { ...DEFAULT_USER_CONFIG };
        await Promise.all([
            this.saveSystemConfig(),
            this.saveUserConfig()
        ]);
        this.notifyConfigChange();
    }
    /**
     * 导出配置到文件
     */
    async exportConfig(filePath) {
        const exportData = {
            system: this.systemConfig,
            user: this.userConfig,
            exportedAt: new Date().toISOString(),
            version: '1.0'
        };
        try {
            const data = JSON.stringify(exportData, null, 2);
            fs.writeFileSync(filePath, data, 'utf-8');
        }
        catch (error) {
            throw new SystemError({
                type: ErrorType.FILESYSTEM_ERROR,
                message: '导出配置失败',
                details: error,
                timestamp: new Date(),
                context: { filePath }
            });
        }
    }
    /**
     * 从文件导入配置
     */
    async importConfig(filePath) {
        try {
            const data = fs.readFileSync(filePath, 'utf-8');
            const importData = JSON.parse(data);
            // 验证导入数据格式
            if (!importData.system || !importData.user) {
                throw new Error('配置文件格式无效');
            }
            // 备份当前配置
            const backupSystem = { ...this.systemConfig };
            const backupUser = { ...this.userConfig };
            try {
                // 应用导入的配置
                this.systemConfig = { ...DEFAULT_SYSTEM_CONFIG, ...importData.system };
                this.userConfig = { ...DEFAULT_USER_CONFIG, ...importData.user };
                // 验证配置
                this.validateConfig();
                // 保存配置
                await Promise.all([
                    this.saveSystemConfig(),
                    this.saveUserConfig()
                ]);
                this.notifyConfigChange();
            }
            catch (error) {
                // 导入失败，恢复备份
                this.systemConfig = backupSystem;
                this.userConfig = backupUser;
                throw error;
            }
        }
        catch (error) {
            throw new SystemError({
                type: ErrorType.FILESYSTEM_ERROR,
                message: '导入配置失败',
                details: error,
                timestamp: new Date(),
                context: { filePath }
            });
        }
    }
    /**
     * 添加配置变更监听器
     */
    onConfigChange(listener) {
        this.configChangeListeners.push(listener);
        // 返回取消监听的函数
        return () => {
            const index = this.configChangeListeners.indexOf(listener);
            if (index > -1) {
                this.configChangeListeners.splice(index, 1);
            }
        };
    }
    /**
     * 通知配置变更
     */
    notifyConfigChange() {
        const config = this.getConfig();
        this.configChangeListeners.forEach(listener => {
            try {
                listener(config);
            }
            catch (error) {
                console.error('配置变更监听器执行失败:', error);
            }
        });
    }
    /**
     * 获取配置路径信息
     */
    getConfigPaths() {
        return {
            configDir: this.configDir,
            systemConfigPath: this.systemConfigPath,
            userConfigPath: this.userConfigPath
        };
    }
    /**
     * 清理资源
     */
    dispose() {
        // 关闭文件监听器
        this.fileWatchers.forEach(watcher => {
            try {
                watcher.close();
            }
            catch (error) {
                console.warn('关闭文件监听器失败:', error);
            }
        });
        this.fileWatchers = [];
        this.configChangeListeners = [];
    }
}
//# sourceMappingURL=ConfigManager.js.map