/**
 * QQ聊天记录导出系统 - 类型定义
 */
import { NTMsgType, Peer, RawMessage } from 'NapCatQQ/src/core/index.js';
/**
 * 导出任务状态枚举
 */
export var ExportTaskStatus;
(function (ExportTaskStatus) {
    /** 等待中 */
    ExportTaskStatus["PENDING"] = "pending";
    /** 执行中 */
    ExportTaskStatus["RUNNING"] = "running";
    /** 已暂停 */
    ExportTaskStatus["PAUSED"] = "paused";
    /** 已完成 */
    ExportTaskStatus["COMPLETED"] = "completed";
    /** 失败 */
    ExportTaskStatus["FAILED"] = "failed";
    /** 已取消 */
    ExportTaskStatus["CANCELLED"] = "cancelled";
})(ExportTaskStatus || (ExportTaskStatus = {}));
/**
 * 导出格式枚举
 */
export var ExportFormat;
(function (ExportFormat) {
    /** 纯文本格式 */
    ExportFormat["TXT"] = "txt";
    /** JSON格式 */
    ExportFormat["JSON"] = "json";
    /** HTML格式 */
    ExportFormat["HTML"] = "html";
    /** Excel格式 */
    ExportFormat["EXCEL"] = "excel";
})(ExportFormat || (ExportFormat = {}));
/**
 * 聊天类型枚举
 */
export var ChatTypeSimple;
(function (ChatTypeSimple) {
    /** 私聊 */
    ChatTypeSimple["PRIVATE"] = "private";
    /** 群聊 */
    ChatTypeSimple["GROUP"] = "group";
    /** 临时聊天 */
    ChatTypeSimple["TEMP"] = "temp";
})(ChatTypeSimple || (ChatTypeSimple = {}));
/**
 * 资源状态
 */
export var ResourceStatus;
(function (ResourceStatus) {
    ResourceStatus["PENDING"] = "pending";
    ResourceStatus["DOWNLOADING"] = "downloading";
    ResourceStatus["DOWNLOADED"] = "downloaded";
    ResourceStatus["FAILED"] = "failed";
    ResourceStatus["CORRUPTED"] = "corrupted";
    ResourceStatus["SKIPPED"] = "skipped"; // 已跳过（不可下载）
})(ResourceStatus || (ResourceStatus = {}));
/**
 * 事件类型枚举
 */
export var EventType;
(function (EventType) {
    /** 任务状态变更 */
    EventType["TASK_STATUS_CHANGED"] = "task_status_changed";
    /** 任务进度更新 */
    EventType["TASK_PROGRESS_UPDATED"] = "task_progress_updated";
    /** 任务完成 */
    EventType["TASK_COMPLETED"] = "task_completed";
    /** 任务失败 */
    EventType["TASK_FAILED"] = "task_failed";
    /** 消息获取进度 */
    EventType["MESSAGE_FETCH_PROGRESS"] = "message_fetch_progress";
    /** 导出进度 */
    EventType["EXPORT_PROGRESS"] = "export_progress";
    /** 系统错误 */
    EventType["SYSTEM_ERROR"] = "system_error";
    /** 健康状态变更 */
    EventType["HEALTH_STATUS_CHANGED"] = "health_status_changed";
})(EventType || (EventType = {}));
/**
 * 错误类型枚举
 */
export var ErrorType;
(function (ErrorType) {
    /** API调用错误 */
    ErrorType["API_ERROR"] = "api_error";
    /** 网络错误 */
    ErrorType["NETWORK_ERROR"] = "network_error";
    /** 数据库错误 */
    ErrorType["DATABASE_ERROR"] = "database_error";
    ErrorType["RESOURCE_ERROR"] = "resource_error";
    /** 文件系统错误 */
    ErrorType["FILESYSTEM_ERROR"] = "filesystem_error";
    /** 配置错误 */
    ErrorType["CONFIG_ERROR"] = "config_error";
    /** 验证错误 */
    ErrorType["VALIDATION_ERROR"] = "validation_error";
    /** 权限错误 */
    ErrorType["PERMISSION_ERROR"] = "permission_error";
    /** 超时错误 */
    ErrorType["TIMEOUT_ERROR"] = "timeout_error";
    /** 认证错误 */
    ErrorType["AUTH_ERROR"] = "auth_error";
    /** 未知错误 */
    ErrorType["UNKNOWN_ERROR"] = "unknown_error";
})(ErrorType || (ErrorType = {}));
/**
 * 系统错误类
 */
export class SystemError extends Error {
    type;
    details;
    timestamp;
    context;
    constructor(data) {
        super(data.message);
        this.name = 'SystemError';
        this.type = data.type;
        this.details = data.details;
        this.timestamp = data.timestamp;
        this.context = data.context;
        if (data.stack) {
            this.stack = data.stack;
        }
        else if (Error.captureStackTrace) {
            Error.captureStackTrace(this, SystemError);
        }
    }
}
//# sourceMappingURL=index.js.map