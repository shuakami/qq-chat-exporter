/**
 * 数据库管理器
 * 负责所有持久化存储操作，支持任务状态、消息缓存、进度跟踪等
 * 使用高性能JSONL格式确保数据安全和极致性能
 */
import path from 'path';
import fs from 'fs';
import { promises as fsPromises } from 'fs';
import { createReadStream } from 'fs';
import { createInterface } from 'readline';
import { TaskDbRecord, MessageDbRecord, ExportTaskConfig, ExportTaskState, ErrorType, SystemError, ResourceInfo, ResourceStatus } from '../../types/index.js';
import { ScheduledExportConfig, ExecutionHistory } from '../scheduler/ScheduledExportManager.js';
/**
 * 数据库模式版本
 */
const DB_SCHEMA_VERSION = 1;
/**
 * 高性能JSONL数据库管理器类
 * 使用JSON Lines格式提供极致性能和完美兼容性
 */
export class DatabaseManager {
    dbDir;
    backupDir;
    files;
    /** 内存索引，提供O(1)查询性能 */
    indexes = {
        tasks: new Map(), // 使用记录ID作为key，不是taskId
        messages: new Map(),
        resources: new Map(),
        systemInfo: new Map(),
        scheduledExports: new Map(),
        executionHistory: new Map()
    };
    /** taskId 到记录ID的映射，用于通过taskId查找记录 */
    taskIdToRecordId = new Map();
    /** 是否已初始化 */
    initialized = false;
    /** 写入队列，支持批量操作 */
    writeQueue = [];
    writeTimeout = null;
    /**
     * 构造函数
     * @param dbPath 数据库目录路径
     */
    constructor(dbPath) {
        this.dbDir = path.dirname(dbPath);
        this.backupDir = path.join(this.dbDir, 'backups');
        console.info(`[DatabaseManager] 构造函数 - dbPath: ${dbPath}`);
        console.info(`[DatabaseManager] 构造函数 - dbDir: ${this.dbDir}`);
        // 初始化JSONL文件路径
        this.files = {
            tasks: path.join(this.dbDir, 'tasks.jsonl'),
            messages: path.join(this.dbDir, 'messages.jsonl'),
            resources: path.join(this.dbDir, 'resources.jsonl'),
            systemInfo: path.join(this.dbDir, 'system_info.jsonl'),
            scheduledExports: path.join(this.dbDir, 'scheduled_exports.jsonl'),
            executionHistory: path.join(this.dbDir, 'execution_history.jsonl')
        };
        console.info(`[DatabaseManager] 构造函数 - tasks file: ${this.files.tasks}`);
    }
    /**
     * 初始化JSONL数据库
     * 创建目录结构并加载所有数据到内存索引
     */
    async initialize() {
        if (this.initialized) {
            return;
        }
        try {
            // 确保数据库目录存在
            if (!fs.existsSync(this.dbDir)) {
                fs.mkdirSync(this.dbDir, { recursive: true });
            }
            // 确保备份目录存在
            if (!fs.existsSync(this.backupDir)) {
                fs.mkdirSync(this.backupDir, { recursive: true });
            }
            // 初始化JSONL文件
            await this.initializeFiles();
            // 加载所有数据到内存索引
            await this.loadIndexes();
            // 设置自动批量写入
            this.setupBatchWrite();
            // 设置系统信息
            this.setSystemInfo('schema_version', DB_SCHEMA_VERSION.toString());
            this.setSystemInfo('initialized_at', new Date().toISOString());
            // 清理失败的任务
            await this.cleanupFailedTasks();
            this.initialized = true;
        }
        catch (error) {
            throw new SystemError({
                type: ErrorType.DATABASE_ERROR,
                message: 'JSONL数据库初始化失败',
                details: error,
                timestamp: new Date(),
                context: { dbDir: this.dbDir }
            });
        }
    }
    /**
     * 初始化JSONL文件
     */
    async initializeFiles() {
        // 确保所有JSONL文件存在
        for (const filePath of Object.values(this.files)) {
            if (!fs.existsSync(filePath)) {
                await fsPromises.writeFile(filePath, '', 'utf8');
            }
        }
    }
    /**
     * 加载所有数据到内存索引
     */
    async loadIndexes() {
        // 加载任务数据
        await this.loadTaskIndex();
        // 加载消息数据
        await this.loadMessageIndex();
        // 加载资源数据
        await this.loadResourceIndex();
        // 加载系统信息
        await this.loadSystemInfoIndex();
        // 加载定时导出任务
        await this.loadScheduledExportIndex();
        // 加载执行历史
        await this.loadExecutionHistoryIndex();
    }
    /**
     * 加载任务索引
     */
    async loadTaskIndex() {
        console.info(`[DatabaseManager] 检查任务文件: ${this.files.tasks}`);
        if (!fs.existsSync(this.files.tasks)) {
            console.info('[DatabaseManager] 任务文件不存在');
            return;
        }
        console.info('[DatabaseManager] 开始加载任务索引...');
        const rl = createInterface({
            input: createReadStream(this.files.tasks),
            crlfDelay: Infinity
        });
        let lineCount = 0;
        let loadedCount = 0;
        let duplicateCount = 0;
        const seenTaskIds = new Set();
        const seenRecordIds = new Set();
        const taskIdToLatestRecord = new Map();
        for await (const line of rl) {
            lineCount++;
            if (line.trim()) {
                try {
                    const task = JSON.parse(line);
                    // 检查taskId重复情况（用于统计）
                    if (seenTaskIds.has(task.taskId)) {
                        duplicateCount++;
                        console.warn(`[DatabaseManager] 发现重复的taskId: ${task.taskId}, 记录ID: ${task.id}`);
                        // 保留最新的记录（基于updatedAt或记录ID）
                        const existingRecord = taskIdToLatestRecord.get(task.taskId);
                        if (existingRecord) {
                            const existingTime = new Date(existingRecord.updatedAt || existingRecord.createdAt).getTime();
                            const currentTime = new Date(task.updatedAt || task.createdAt).getTime();
                            if (currentTime > existingTime || task.id > existingRecord.id) {
                                taskIdToLatestRecord.set(task.taskId, task);
                                console.log(`[DatabaseManager] 保留较新的记录: taskId=${task.taskId}, recordId=${task.id}`);
                            }
                        }
                    }
                    else {
                        seenTaskIds.add(task.taskId);
                        taskIdToLatestRecord.set(task.taskId, task);
                    }
                    // 检查记录ID重复情况
                    if (seenRecordIds.has(task.id)) {
                        console.warn(`[DatabaseManager] 发现重复的记录ID: ${task.id}, 将覆盖之前的记录`);
                    }
                    else {
                        seenRecordIds.add(task.id);
                    }
                    loadedCount++;
                }
                catch (error) {
                    console.warn('解析任务数据行失败:', line, error);
                }
            }
        }
        // 只保留每个taskId的最新记录
        for (const [taskId, task] of taskIdToLatestRecord.entries()) {
            const recordIdStr = task.id.toString();
            this.indexes.tasks.set(recordIdStr, task);
            this.taskIdToRecordId.set(taskId, recordIdStr);
        }
        console.info(`[DatabaseManager] 任务索引加载完成: 处理了 ${lineCount} 行, 成功加载 ${loadedCount} 个任务, 发现 ${duplicateCount} 个重复taskId`);
        console.info(`[DatabaseManager] 内存中的任务记录数量: ${this.indexes.tasks.size}, 唯一taskId数量: ${this.taskIdToRecordId.size}`);
        // 如果发现重复记录，自动清理
        if (duplicateCount > 0) {
            console.warn(`[DatabaseManager] 发现 ${duplicateCount} 个重复记录，将自动清理...`);
            await this.rebuildTaskFile();
            console.info(`[DatabaseManager] 重复记录清理完成`);
        }
    }
    /**
     * 加载消息索引
     */
    async loadMessageIndex() {
        if (!fs.existsSync(this.files.messages))
            return;
        const rl = createInterface({
            input: createReadStream(this.files.messages),
            crlfDelay: Infinity
        });
        for await (const line of rl) {
            if (line.trim()) {
                try {
                    const message = JSON.parse(line);
                    if (!this.indexes.messages.has(message.taskId)) {
                        this.indexes.messages.set(message.taskId, new Map());
                    }
                    this.indexes.messages.get(message.taskId).set(message.messageId, message);
                }
                catch (error) {
                    console.warn('解析消息数据行失败:', line, error);
                }
            }
        }
    }
    /**
     * 加载资源索引
     */
    async loadResourceIndex() {
        if (!fs.existsSync(this.files.resources))
            return;
        const rl = createInterface({
            input: createReadStream(this.files.resources),
            crlfDelay: Infinity
        });
        for await (const line of rl) {
            if (line.trim()) {
                try {
                    const resource = JSON.parse(line);
                    // 修复日期字段类型：确保checkedAt是Date对象
                    if (resource.checkedAt) {
                        if (typeof resource.checkedAt === 'string') {
                            resource.checkedAt = new Date(resource.checkedAt);
                        }
                        else if (typeof resource.checkedAt === 'number') {
                            resource.checkedAt = new Date(resource.checkedAt);
                        }
                        // 验证日期是否有效
                        if (isNaN(resource.checkedAt.getTime())) {
                            console.warn(`[DatabaseManager] 资源 ${resource.md5} 的checkedAt字段无效，使用当前时间`);
                            resource.checkedAt = new Date();
                        }
                    }
                    else {
                        // 如果没有checkedAt字段，设置为当前时间
                        resource.checkedAt = new Date();
                    }
                    if (resource.md5) {
                        this.indexes.resources.set(resource.md5, resource);
                    }
                }
                catch (error) {
                    console.warn('解析资源数据行失败:', line, error);
                }
            }
        }
    }
    /**
     * 加载系统信息索引
     */
    async loadSystemInfoIndex() {
        if (!fs.existsSync(this.files.systemInfo))
            return;
        const rl = createInterface({
            input: createReadStream(this.files.systemInfo),
            crlfDelay: Infinity
        });
        for await (const line of rl) {
            if (line.trim()) {
                try {
                    const info = JSON.parse(line);
                    this.indexes.systemInfo.set(info.key, info.value);
                }
                catch (error) {
                    console.warn('解析系统信息行失败:', line, error);
                }
            }
        }
    }
    /**
     * 设置批量写入机制
     */
    setupBatchWrite() {
        // 每100ms执行一次批量写入
        setInterval(() => {
            this.flushWriteQueue();
        }, 100);
    }
    /**
     * 添加数据到写入队列
     */
    queueWrite(file, data) {
        this.writeQueue.push({ file, data });
        // 如果队列太大，立即执行写入
        if (this.writeQueue.length >= 100) {
            this.flushWriteQueue();
        }
        else {
            // 设置延时写入，确保小批量数据也能及时写入
            this.scheduleDelayedWrite();
        }
    }
    /**
     * 调度延时写入
     */
    scheduleDelayedWrite() {
        if (this.writeTimeout) {
            clearTimeout(this.writeTimeout);
        }
        this.writeTimeout = setTimeout(() => {
            this.flushWriteQueue().catch(error => {
                console.error('[DatabaseManager] 延时写入失败:', error);
            });
        }, 5000); // 5秒后自动写入
    }
    /**
     * 刷新写入队列（公开方法，允许外部调用立即刷新）
     */
    async flushWriteQueue() {
        if (this.writeQueue.length === 0)
            return;
        const queue = [...this.writeQueue];
        this.writeQueue = [];
        // 按文件分组
        const fileGroups = {};
        for (const item of queue) {
            if (!fileGroups[item.file]) {
                fileGroups[item.file] = [];
            }
            fileGroups[item.file].push(item.data);
        }
        // 并行写入所有文件
        const writePromises = Object.entries(fileGroups).map(([file, dataItems]) => {
            const content = dataItems.map(data => JSON.stringify(data)).join('\n') + '\n';
            return fsPromises.appendFile(file, content, 'utf8');
        });
        try {
            await Promise.all(writePromises);
        }
        catch (error) {
            console.error('批量写入失败:', error);
            // 重新加入队列
            this.writeQueue.unshift(...queue);
        }
    }
    /**
     * 保存任务配置和状态
     */
    async saveTask(config, state) {
        this.ensureInitialized();
        // 检查是否已存在该任务
        const existingRecordId = this.taskIdToRecordId.get(config.taskId);
        let taskRecord;
        if (existingRecordId) {
            // 更新现有记录
            const existingRecord = this.indexes.tasks.get(existingRecordId);
            if (existingRecord) {
                taskRecord = {
                    ...existingRecord,
                    config: JSON.stringify(config),
                    state: JSON.stringify(state),
                    updatedAt: new Date()
                };
                console.log(`[DatabaseManager] 更新现有任务: ${config.taskId}, 记录ID: ${existingRecordId}`);
            }
            else {
                // 记录不存在，创建新记录
                taskRecord = {
                    id: Date.now(),
                    taskId: config.taskId,
                    config: JSON.stringify(config),
                    state: JSON.stringify(state),
                    createdAt: new Date(),
                    updatedAt: new Date()
                };
                console.log(`[DatabaseManager] 创建新任务记录: ${config.taskId}, 记录ID: ${taskRecord.id}`);
                this.taskIdToRecordId.set(config.taskId, taskRecord.id.toString());
            }
        }
        else {
            // 创建新记录
            taskRecord = {
                id: Date.now(),
                taskId: config.taskId,
                config: JSON.stringify(config),
                state: JSON.stringify(state),
                createdAt: new Date(),
                updatedAt: new Date()
            };
            console.log(`[DatabaseManager] 创建新任务: ${config.taskId}, 记录ID: ${taskRecord.id}`);
            this.taskIdToRecordId.set(config.taskId, taskRecord.id.toString());
        }
        // 更新内存索引（使用记录ID作为key）
        this.indexes.tasks.set(taskRecord.id.toString(), taskRecord);
        // 添加到写入队列
        this.queueWrite(this.files.tasks, taskRecord);
    }
    /**
     * 加载任务配置和状态
     */
    async loadTask(taskId) {
        this.ensureInitialized();
        // 通过 taskId 查找记录ID
        const recordId = this.taskIdToRecordId.get(taskId);
        if (!recordId) {
            return null;
        }
        const taskRecord = this.indexes.tasks.get(recordId);
        if (!taskRecord) {
            return null;
        }
        try {
            const config = JSON.parse(taskRecord.config);
            const state = JSON.parse(taskRecord.state);
            return { config, state };
        }
        catch (error) {
            throw new SystemError({
                type: ErrorType.DATABASE_ERROR,
                message: '解析任务数据失败',
                details: error,
                timestamp: new Date(),
                context: { taskId }
            });
        }
    }
    /**
     * 获取所有任务
     */
    async getAllTasks() {
        this.ensureInitialized();
        console.info(`[DatabaseManager] getAllTasks 调用，内存中有 ${this.indexes.tasks.size} 个任务`);
        const results = [];
        for (const taskRecord of this.indexes.tasks.values()) {
            try {
                const config = JSON.parse(taskRecord.config);
                const state = JSON.parse(taskRecord.state);
                results.push({ config, state });
            }
            catch (error) {
                console.warn('解析任务数据失败:', taskRecord.taskId, error);
            }
        }
        console.info(`[DatabaseManager] 成功解析了 ${results.length} 个任务`);
        // 按开始时间倒序排列
        return results.sort((a, b) => {
            // 处理 startTime 可能是字符串的情况
            const aStartTime = a.state.startTime;
            const bStartTime = b.state.startTime;
            let aTime = 0;
            let bTime = 0;
            if (aStartTime) {
                if (typeof aStartTime === 'string') {
                    aTime = new Date(aStartTime).getTime();
                }
                else if (aStartTime.getTime) {
                    aTime = aStartTime.getTime();
                }
            }
            if (bStartTime) {
                if (typeof bStartTime === 'string') {
                    bTime = new Date(bStartTime).getTime();
                }
                else if (bStartTime.getTime) {
                    bTime = bStartTime.getTime();
                }
            }
            return bTime - aTime;
        });
    }
    /**
     * 删除任务及其所有相关数据
     */
    async deleteTask(taskId) {
        this.ensureInitialized();
        console.log(`[DatabaseManager] 开始删除任务: ${taskId}`);
        // 首先刷新写入队列，确保没有未写入的数据
        console.log(`[DatabaseManager] 刷新写入队列...`);
        await this.flushWriteQueue();
        // 通过 taskId 查找记录ID
        const recordId = this.taskIdToRecordId.get(taskId);
        if (recordId) {
            console.log(`[DatabaseManager] 找到任务记录ID: ${recordId}`);
            // 从内存索引中删除
            this.indexes.tasks.delete(recordId);
            this.taskIdToRecordId.delete(taskId);
        }
        else {
            console.warn(`[DatabaseManager] 未找到任务的记录ID: ${taskId}`);
            // 遍历所有任务记录查找可能的匹配
            for (const [recordIdStr, taskRecord] of this.indexes.tasks.entries()) {
                if (taskRecord.taskId === taskId) {
                    console.log(`[DatabaseManager] 通过遍历找到任务记录: ${recordIdStr}`);
                    this.indexes.tasks.delete(recordIdStr);
                    this.taskIdToRecordId.delete(taskId);
                    break;
                }
            }
        }
        // 删除相关消息
        const messageCount = this.indexes.messages.get(taskId)?.size || 0;
        if (messageCount > 0) {
            console.log(`[DatabaseManager] 删除任务 ${taskId} 的 ${messageCount} 条消息`);
        }
        this.indexes.messages.delete(taskId);
        // 重新构建文件以反映删除操作
        console.log(`[DatabaseManager] 重建数据库文件...`);
        await this.rebuildFiles();
        // 再次刷新写入队列，确保删除操作立即生效
        await this.flushWriteQueue();
        console.log(`[DatabaseManager] 任务 ${taskId} 已彻底删除`);
    }
    /**
     * 重建所有文件（用于删除操作后的清理）
     */
    async rebuildFiles() {
        await Promise.all([
            this.rebuildTaskFile(),
            this.rebuildMessageFile(),
            this.rebuildResourceFile()
        ]);
    }
    /**
     * 重建任务文件
     */
    async rebuildTaskFile() {
        const content = Array.from(this.indexes.tasks.values())
            .map(task => JSON.stringify(task))
            .join('\n') + (this.indexes.tasks.size > 0 ? '\n' : '');
        await fsPromises.writeFile(this.files.tasks, content, 'utf8');
    }
    /**
     * 重建消息文件
     */
    async rebuildMessageFile() {
        const allMessages = [];
        for (const taskMessages of this.indexes.messages.values()) {
            allMessages.push(...Array.from(taskMessages.values()));
        }
        const content = allMessages
            .map(message => JSON.stringify(message))
            .join('\n') + (allMessages.length > 0 ? '\n' : '');
        await fsPromises.writeFile(this.files.messages, content, 'utf8');
    }
    /**
     * 重建资源文件
     */
    async rebuildResourceFile() {
        const content = Array.from(this.indexes.resources.values())
            .map(resource => JSON.stringify(resource))
            .join('\n') + (this.indexes.resources.size > 0 ? '\n' : '');
        await fsPromises.writeFile(this.files.resources, content, 'utf8');
    }
    /**
     * 清理失败的任务
     * 删除状态为PENDING或RUNNING但进度为0%的任务
     */
    async cleanupFailedTasks() {
        const tasksToDelete = [];
        console.info('[DatabaseManager] 开始清理失败的任务...');
        for (const [, taskRecord] of this.indexes.tasks) {
            try {
                const config = JSON.parse(taskRecord.config);
                const state = JSON.parse(taskRecord.state);
                // 计算进度百分比
                const progress = state.totalMessages > 0 ?
                    Math.round((state.processedMessages / state.totalMessages) * 100) : 0;
                // 清理规则：PENDING或RUNNING状态但进度为0%
                if ((state.status === 'pending' || state.status === 'running') && progress === 0) {
                    tasksToDelete.push(config.taskId);
                    console.warn(`[DatabaseManager] 标记清理任务: ${config.chatName}(${config.taskId}) - 状态${state.status}进度0%`);
                }
            }
            catch (error) {
                console.error(`[DatabaseManager] 解析任务记录失败，将删除: ${taskRecord.taskId}`, error);
                tasksToDelete.push(taskRecord.taskId);
            }
        }
        // 执行删除操作
        if (tasksToDelete.length > 0) {
            console.info(`[DatabaseManager] 找到 ${tasksToDelete.length} 个需要清理的失败任务`);
            for (const taskId of tasksToDelete) {
                try {
                    // 直接从内存索引中删除
                    const recordId = this.taskIdToRecordId.get(taskId);
                    if (recordId) {
                        this.indexes.tasks.delete(recordId);
                        this.taskIdToRecordId.delete(taskId);
                    }
                    else {
                        // 遍历查找并删除
                        for (const [recordIdStr, taskRecord] of this.indexes.tasks.entries()) {
                            if (taskRecord.taskId === taskId) {
                                this.indexes.tasks.delete(recordIdStr);
                                this.taskIdToRecordId.delete(taskId);
                                break;
                            }
                        }
                    }
                    // 删除相关消息
                    this.indexes.messages.delete(taskId);
                }
                catch (error) {
                    console.error(`[DatabaseManager] 删除失败任务时出错: ${taskId}`, error);
                }
            }
            // 重建文件以反映删除操作
            await this.rebuildFiles();
            console.info(`[DatabaseManager] 已清理 ${tasksToDelete.length} 个失败任务`);
        }
        else {
            console.info(`[DatabaseManager] 未发现需要清理的失败任务`);
        }
    }
    /**
     * 批量保存消息
     */
    async saveMessages(taskId, messages) {
        this.ensureInitialized();
        // 确保任务消息索引存在
        if (!this.indexes.messages.has(taskId)) {
            this.indexes.messages.set(taskId, new Map());
        }
        const taskMessages = this.indexes.messages.get(taskId);
        const messageRecords = [];
        messages.forEach(msg => {
            const messageRecord = {
                id: Date.now() + Math.random(), // 简单的ID生成
                taskId: taskId,
                messageId: msg.msgId,
                messageSeq: msg.msgSeq,
                messageTime: msg.msgTime,
                senderUid: msg.senderUid || msg.peerUid,
                content: JSON.stringify(msg),
                processed: false,
                createdAt: new Date(),
                updatedAt: new Date()
            };
            // 更新内存索引
            taskMessages.set(messageRecord.messageId, messageRecord);
            messageRecords.push(messageRecord);
        });
        // 批量写入
        messageRecords.forEach(record => {
            this.queueWrite(this.files.messages, record);
        });
    }
    /**
     * 标记消息为已处理
     */
    async markMessageProcessed(taskId, messageId) {
        this.ensureInitialized();
        const taskMessages = this.indexes.messages.get(taskId);
        if (taskMessages && taskMessages.has(messageId)) {
            const message = taskMessages.get(messageId);
            message.processed = true;
            message.updatedAt = new Date();
            // 重新写入整个消息记录
            this.queueWrite(this.files.messages, message);
        }
    }
    /**
     * 获取未处理的消息
     */
    async getUnprocessedMessages(taskId) {
        this.ensureInitialized();
        const taskMessages = this.indexes.messages.get(taskId);
        if (!taskMessages) {
            return [];
        }
        const unprocessedMessages = [];
        for (const messageRecord of taskMessages.values()) {
            if (!messageRecord.processed) {
                try {
                    const content = JSON.parse(messageRecord.content);
                    unprocessedMessages.push(content);
                }
                catch (error) {
                    console.warn('解析消息内容失败:', messageRecord.messageId, error);
                }
            }
        }
        // 按消息时间排序
        return unprocessedMessages.sort((a, b) => parseInt(a.msgTime) - parseInt(b.msgTime));
    }
    /**
     * 获取任务进度统计
     */
    async getTaskProgress(taskId) {
        this.ensureInitialized();
        const taskMessages = this.indexes.messages.get(taskId);
        if (!taskMessages) {
            return { total: 0, processed: 0 };
        }
        const messages = Array.from(taskMessages.values());
        const total = messages.length;
        const processed = messages.filter(msg => msg.processed).length;
        return { total, processed };
    }
    /**
     * 保存资源信息（遗留方法，保持向后兼容）
     */
    async saveResources(_taskId, _messageId, resources) {
        this.ensureInitialized();
        // 这个方法现在委托给 saveResourceInfo
        for (const resource of resources) {
            if (resource.md5) {
                await this.saveResourceInfo(resource);
            }
        }
    }
    /**
     * 获取任务的所有资源（遗留方法，保持向后兼容）
     */
    async getTaskResources(_taskId) {
        this.ensureInitialized();
        // 由于JSONL格式不直接支持按任务ID查询资源，
        // 这个方法现在返回所有资源（可以根据需要优化）
        return Array.from(this.indexes.resources.values());
    }
    /**
     * 设置系统信息
     */
    setSystemInfo(key, value) {
        const systemInfo = {
            key,
            value,
            updated_at: new Date().toISOString()
        };
        // 更新内存索引
        this.indexes.systemInfo.set(key, value);
        // 添加到写入队列
        this.queueWrite(this.files.systemInfo, systemInfo);
    }
    /**
     * 获取系统信息
     */
    getSystemInfo(key) {
        return this.indexes.systemInfo.get(key) || null;
    }
    /**
     * 创建JSONL数据库备份
     */
    async createBackup() {
        this.ensureInitialized();
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const backupDir = path.join(this.backupDir, `backup-${timestamp}`);
        try {
            // 创建备份目录
            if (!fs.existsSync(backupDir)) {
                fs.mkdirSync(backupDir, { recursive: true });
            }
            // 刷新写入队列确保数据完整
            await this.flushWriteQueue();
            // 复制所有JSONL文件
            const copyPromises = Object.entries(this.files).map(([name, filePath]) => {
                const backupFile = path.join(backupDir, `${name}.jsonl`);
                return fsPromises.copyFile(filePath, backupFile);
            });
            await Promise.all(copyPromises);
            return backupDir;
        }
        catch (error) {
            throw new SystemError({
                type: ErrorType.DATABASE_ERROR,
                message: '创建数据库备份失败',
                details: error,
                timestamp: new Date(),
                context: { backupDir }
            });
        }
    }
    /**
     * 清理旧的备份文件
     */
    async cleanupOldBackups(keepDays = 7) {
        const cutoffTime = Date.now() - (keepDays * 24 * 60 * 60 * 1000);
        try {
            const files = fs.readdirSync(this.backupDir);
            for (const file of files) {
                if (file.endsWith('.db')) {
                    const filePath = path.join(this.backupDir, file);
                    const stats = fs.statSync(filePath);
                    if (stats.mtime.getTime() < cutoffTime) {
                        fs.unlinkSync(filePath);
                    }
                }
            }
        }
        catch (error) {
            // 清理失败不应该影响主要功能
            console.warn('清理旧备份文件失败:', error);
        }
    }
    /**
     * 获取数据库统计信息
     */
    async getDatabaseStats() {
        this.ensureInitialized();
        // 统计任务数量
        const totalTasks = this.indexes.tasks.size;
        // 统计消息数量
        let totalMessages = 0;
        for (const taskMessages of this.indexes.messages.values()) {
            totalMessages += taskMessages.size;
        }
        // 统计资源数量
        const totalResources = this.indexes.resources.size;
        // 计算所有JSONL文件的总大小
        let databaseSize = 0;
        try {
            for (const filePath of Object.values(this.files)) {
                if (fs.existsSync(filePath)) {
                    const stats = fs.statSync(filePath);
                    databaseSize += stats.size;
                }
            }
        }
        catch (error) {
            // 忽略文件大小获取失败
        }
        return {
            totalTasks,
            totalMessages,
            totalResources,
            databaseSize
        };
    }
    /**
     * 执行数据库优化
     */
    async optimize() {
        this.ensureInitialized();
        // 刷新所有待写入数据
        await this.flushWriteQueue();
        // 重建所有文件以整理碎片
        await this.rebuildFiles();
        // 重新加载索引
        this.indexes = {
            tasks: new Map(),
            messages: new Map(),
            resources: new Map(),
            systemInfo: new Map(),
            scheduledExports: new Map(),
            executionHistory: new Map()
        };
        await this.loadIndexes();
    }
    /**
     * 确保数据库已初始化
     */
    ensureInitialized() {
        if (!this.initialized) {
            throw new SystemError({
                type: ErrorType.DATABASE_ERROR,
                message: 'JSONL数据库未初始化',
                timestamp: new Date()
            });
        }
    }
    /**
     * 关闭数据库连接
     */
    async close() {
        if (this.initialized) {
            // 刷新所有待写入数据
            await this.flushWriteQueue();
            // 清理定时器
            if (this.writeTimeout) {
                clearTimeout(this.writeTimeout);
                this.writeTimeout = null;
            }
            // 清理索引
            this.indexes = {
                tasks: new Map(),
                messages: new Map(),
                resources: new Map(),
                systemInfo: new Map(),
                scheduledExports: new Map(),
                executionHistory: new Map()
            };
            this.initialized = false;
        }
    }
    /**
     * 检查数据库连接状态
     */
    isConnected() {
        return this.initialized;
    }
    // ================================
    // 资源管理方法
    // ================================
    /**
     * 保存资源信息
     */
    async saveResourceInfo(resourceInfo) {
        this.ensureInitialized();
        const resourceRecord = {
            ...resourceInfo,
            accessible: resourceInfo.accessible ? 1 : 0,
            checkedAt: resourceInfo.checkedAt.toISOString(),
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
        };
        // 更新内存索引
        if (resourceInfo.md5) {
            this.indexes.resources.set(resourceInfo.md5, resourceInfo);
        }
        // 添加到写入队列
        this.queueWrite(this.files.resources, resourceRecord);
    }
    /**
     * 根据MD5获取资源信息
     */
    async getResourceByMd5(md5) {
        this.ensureInitialized();
        return this.indexes.resources.get(md5) || null;
    }
    /**
     * 根据状态获取资源列表
     */
    async getResourcesByStatus(status) {
        this.ensureInitialized();
        const resources = [];
        for (const resource of this.indexes.resources.values()) {
            if (resource.status === status) {
                resources.push(resource);
            }
        }
        // 按检查时间倒序排列，增加类型安全检查
        return resources.sort((a, b) => {
            try {
                // 确保checkedAt是有效的Date对象
                const aTime = a.checkedAt instanceof Date ? a.checkedAt.getTime() : new Date(a.checkedAt).getTime();
                const bTime = b.checkedAt instanceof Date ? b.checkedAt.getTime() : new Date(b.checkedAt).getTime();
                // 检查是否为有效时间
                if (isNaN(aTime) || isNaN(bTime)) {
                    console.warn(`[DatabaseManager] 发现无效的checkedAt时间戳: a=${a.checkedAt}, b=${b.checkedAt}`);
                    return 0; // 无效时间保持原有顺序
                }
                return bTime - aTime;
            }
            catch (error) {
                console.error(`[DatabaseManager] 排序资源时发生错误:`, error);
                return 0; // 发生错误时保持原有顺序
            }
        });
    }
    /**
     * 获取早于指定时间的资源
     */
    async getResourcesOlderThan(cutoffTime) {
        this.ensureInitialized();
        const resources = [];
        for (const resource of this.indexes.resources.values()) {
            try {
                // 确保checkedAt是有效的Date对象
                const resourceTime = resource.checkedAt instanceof Date ?
                    resource.checkedAt.getTime() :
                    new Date(resource.checkedAt).getTime();
                if (!isNaN(resourceTime) && resourceTime < cutoffTime.getTime()) {
                    resources.push(resource);
                }
            }
            catch (error) {
                console.warn(`[DatabaseManager] 跳过无效checkedAt的资源 ${resource.md5}:`, error);
            }
        }
        // 按检查时间正序排列，增加类型安全检查
        return resources.sort((a, b) => {
            try {
                const aTime = a.checkedAt instanceof Date ? a.checkedAt.getTime() : new Date(a.checkedAt).getTime();
                const bTime = b.checkedAt instanceof Date ? b.checkedAt.getTime() : new Date(b.checkedAt).getTime();
                if (isNaN(aTime) || isNaN(bTime)) {
                    return 0; // 无效时间保持原有顺序
                }
                return aTime - bTime;
            }
            catch (error) {
                console.error(`[DatabaseManager] 排序资源时发生错误:`, error);
                return 0;
            }
        });
    }
    /**
     * 删除过期资源
     */
    async deleteExpiredResources(cutoffTime) {
        this.ensureInitialized();
        let deletedCount = 0;
        const toDelete = [];
        for (const [md5, resource] of this.indexes.resources.entries()) {
            if (resource.checkedAt.getTime() < cutoffTime.getTime()) {
                toDelete.push(md5);
                deletedCount++;
            }
        }
        // 从内存索引中删除
        for (const md5 of toDelete) {
            this.indexes.resources.delete(md5);
        }
        // 重建资源文件
        if (deletedCount > 0) {
            await this.rebuildResourceFile();
        }
        return deletedCount;
    }
    /**
     * 获取资源统计信息
     */
    async getResourceStatistics() {
        this.ensureInitialized();
        let downloaded = 0;
        let failed = 0;
        let pending = 0;
        for (const resource of this.indexes.resources.values()) {
            switch (resource.status) {
                case 'downloaded':
                    downloaded++;
                    break;
                case 'failed':
                    failed++;
                    break;
                case 'pending':
                    pending++;
                    break;
            }
        }
        return {
            total: this.indexes.resources.size,
            downloaded,
            failed,
            pending
        };
    }
    /**
     * 加载定时导出任务索引
     */
    async loadScheduledExportIndex() {
        console.info(`[DatabaseManager] 检查定时导出任务文件: ${this.files.scheduledExports}`);
        if (!fs.existsSync(this.files.scheduledExports)) {
            console.info(`[DatabaseManager] 定时导出任务文件不存在，跳过加载`);
            return;
        }
        const fileStream = createReadStream(this.files.scheduledExports);
        const rl = createInterface({
            input: fileStream,
            crlfDelay: Infinity
        });
        let lineCount = 0;
        for await (const line of rl) {
            if (line.trim()) {
                try {
                    const scheduledExport = JSON.parse(line);
                    // 处理日期字段
                    if (typeof scheduledExport.createdAt === 'string') {
                        scheduledExport.createdAt = new Date(scheduledExport.createdAt);
                    }
                    if (typeof scheduledExport.updatedAt === 'string') {
                        scheduledExport.updatedAt = new Date(scheduledExport.updatedAt);
                    }
                    if (scheduledExport.lastRun && typeof scheduledExport.lastRun === 'string') {
                        scheduledExport.lastRun = new Date(scheduledExport.lastRun);
                    }
                    if (scheduledExport.nextRun && typeof scheduledExport.nextRun === 'string') {
                        scheduledExport.nextRun = new Date(scheduledExport.nextRun);
                    }
                    this.indexes.scheduledExports.set(scheduledExport.id, scheduledExport);
                    lineCount++;
                }
                catch (error) {
                    console.error(`[DatabaseManager] 解析定时导出任务记录失败:`, error);
                }
            }
        }
        console.info(`[DatabaseManager] 加载了 ${lineCount} 个定时导出任务记录到内存索引`);
    }
    /**
     * 加载执行历史索引
     */
    async loadExecutionHistoryIndex() {
        console.info(`[DatabaseManager] 检查执行历史文件: ${this.files.executionHistory}`);
        if (!fs.existsSync(this.files.executionHistory)) {
            console.info(`[DatabaseManager] 执行历史文件不存在，跳过加载`);
            return;
        }
        const fileStream = createReadStream(this.files.executionHistory);
        const rl = createInterface({
            input: fileStream,
            crlfDelay: Infinity
        });
        let lineCount = 0;
        for await (const line of rl) {
            if (line.trim()) {
                try {
                    const history = JSON.parse(line);
                    // 处理日期字段
                    if (typeof history.executedAt === 'string') {
                        history.executedAt = new Date(history.executedAt);
                    }
                    if (!this.indexes.executionHistory.has(history.scheduledExportId)) {
                        this.indexes.executionHistory.set(history.scheduledExportId, []);
                    }
                    this.indexes.executionHistory.get(history.scheduledExportId).push(history);
                    lineCount++;
                }
                catch (error) {
                    console.error(`[DatabaseManager] 解析执行历史记录失败:`, error);
                }
            }
        }
        console.info(`[DatabaseManager] 加载了 ${lineCount} 个执行历史记录到内存索引`);
    }
    /**
     * 保存定时导出任务
     */
    async saveScheduledExport(scheduledExport) {
        this.ensureInitialized();
        this.indexes.scheduledExports.set(scheduledExport.id, { ...scheduledExport });
        // 写入到JSONL文件
        this.queueWrite(this.files.scheduledExports, scheduledExport);
        console.debug(`[DatabaseManager] 定时导出任务已保存: ${scheduledExport.id}`);
    }
    /**
     * 获取所有定时导出任务
     */
    async getScheduledExports() {
        this.ensureInitialized();
        return Array.from(this.indexes.scheduledExports.values()).sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    }
    /**
     * 获取指定的定时导出任务
     */
    async getScheduledExport(id) {
        this.ensureInitialized();
        return this.indexes.scheduledExports.get(id) || null;
    }
    /**
     * 删除定时导出任务
     */
    async deleteScheduledExport(id) {
        this.ensureInitialized();
        const exists = this.indexes.scheduledExports.has(id);
        if (exists) {
            this.indexes.scheduledExports.delete(id);
            this.indexes.executionHistory.delete(id);
            // 重建文件（物理删除）
            await this.rebuildScheduledExportFile();
            await this.rebuildExecutionHistoryFile();
            console.debug(`[DatabaseManager] 定时导出任务已删除: ${id}`);
        }
        return exists;
    }
    /**
     * 保存执行历史
     */
    async saveExecutionHistory(history) {
        this.ensureInitialized();
        if (!this.indexes.executionHistory.has(history.scheduledExportId)) {
            this.indexes.executionHistory.set(history.scheduledExportId, []);
        }
        const historyList = this.indexes.executionHistory.get(history.scheduledExportId);
        historyList.push({ ...history });
        // 只保留最近100条记录
        if (historyList.length > 100) {
            historyList.splice(0, historyList.length - 100);
        }
        // 写入到JSONL文件
        this.queueWrite(this.files.executionHistory, history);
        console.debug(`[DatabaseManager] 执行历史已保存: ${history.id}`);
    }
    /**
     * 获取执行历史
     */
    async getExecutionHistory(scheduledExportId, limit = 50) {
        this.ensureInitialized();
        const history = this.indexes.executionHistory.get(scheduledExportId) || [];
        return history.slice(-limit).reverse(); // 返回最近的记录
    }
    /**
     * 重建定时导出任务文件
     */
    async rebuildScheduledExportFile() {
        const tempFile = `${this.files.scheduledExports}.temp`;
        try {
            const stream = fs.createWriteStream(tempFile);
            for (const scheduledExport of this.indexes.scheduledExports.values()) {
                stream.write(JSON.stringify(scheduledExport) + '\n');
            }
            await new Promise((resolve, reject) => {
                stream.end((error) => {
                    if (error)
                        reject(error);
                    else
                        resolve();
                });
            });
            // 原子性替换文件
            if (fs.existsSync(this.files.scheduledExports)) {
                fs.unlinkSync(this.files.scheduledExports);
            }
            fs.renameSync(tempFile, this.files.scheduledExports);
            console.debug(`[DatabaseManager] 定时导出任务文件已重建`);
        }
        catch (error) {
            // 清理临时文件
            if (fs.existsSync(tempFile)) {
                fs.unlinkSync(tempFile);
            }
            throw error;
        }
    }
    /**
     * 重建执行历史文件
     */
    async rebuildExecutionHistoryFile() {
        const tempFile = `${this.files.executionHistory}.temp`;
        try {
            const stream = fs.createWriteStream(tempFile);
            for (const historyList of this.indexes.executionHistory.values()) {
                for (const history of historyList) {
                    stream.write(JSON.stringify(history) + '\n');
                }
            }
            await new Promise((resolve, reject) => {
                stream.end((error) => {
                    if (error)
                        reject(error);
                    else
                        resolve();
                });
            });
            // 原子性替换文件
            if (fs.existsSync(this.files.executionHistory)) {
                fs.unlinkSync(this.files.executionHistory);
            }
            fs.renameSync(tempFile, this.files.executionHistory);
            console.debug(`[DatabaseManager] 执行历史文件已重建`);
        }
        catch (error) {
            // 清理临时文件
            if (fs.existsSync(tempFile)) {
                fs.unlinkSync(tempFile);
            }
            throw error;
        }
    }
}
//# sourceMappingURL=DatabaseManager.js.map