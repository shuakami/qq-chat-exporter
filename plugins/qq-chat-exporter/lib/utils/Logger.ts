/**
 * QCE 统一日志工具
 * 简洁、清晰、无emoji的日志输出
 */

// ANSI颜色代码
const colors = {
    reset: '\x1b[0m',
    green: '\x1b[32m',
    cyan: '\x1b[36m',      // 青色用于强调，比绿色更舒服
    yellow: '\x1b[33m',
    red: '\x1b[31m',
    gray: '\x1b[90m',
    white: '\x1b[37m',
};

/**
 * 格式化日志消息
 */
function formatMessage(tag: string, message: string, highlight?: boolean): string {
    const tagStr = `[${tag}]`;
    if (highlight) {
        return `${colors.cyan}${tagStr} ${message}${colors.reset}`;
    }
    return `${tagStr} ${message}`;
}

/**
 * QCE Logger 类
 */
export class QCELogger {
    private tag: string;
    private enabled: boolean;

    constructor(tag: string, enabled = true) {
        this.tag = tag;
        this.enabled = enabled;
    }

    /**
     * 普通信息日志
     */
    info(message: string): void {
        if (!this.enabled) return;
        console.log(formatMessage(this.tag, message));
    }

    /**
     * 高亮信息（深绿色）- 用于关键信息
     */
    highlight(message: string): void {
        if (!this.enabled) return;
        console.log(formatMessage(this.tag, message, true));
    }

    /**
     * 调试日志（默认不输出，除非开启debug模式）
     */
    debug(message: string): void {
        // 调试日志默认关闭
        if (process.env['QCE_DEBUG'] !== 'true') return;
        console.log(`${colors.gray}[${this.tag}] ${message}${colors.reset}`);
    }

    /**
     * 警告日志
     */
    warn(message: string): void {
        if (!this.enabled) return;
        console.warn(`${colors.yellow}[${this.tag}] ${message}${colors.reset}`);
    }

    /**
     * 错误日志
     */
    error(message: string, error?: unknown): void {
        console.error(`${colors.red}[${this.tag}] ${message}${colors.reset}`);
        if (error) {
            console.error(error);
        }
    }

    /**
     * 成功日志（绿色）
     */
    success(message: string): void {
        if (!this.enabled) return;
        console.log(`${colors.green}[${this.tag}] ${message}${colors.reset}`);
    }
}

// 预定义的日志实例
export const loggers = {
    plugin: new QCELogger('QCE'),
    api: new QCELogger('QCE.API'),
    db: new QCELogger('QCE.DB', false),  // 数据库日志默认关闭
    security: new QCELogger('QCE.Security'),
    scheduler: new QCELogger('QCE.Scheduler'),
    frontend: new QCELogger('QCE.Frontend', false),  // 前端日志默认关闭
};

// 默认导出
export default QCELogger;
