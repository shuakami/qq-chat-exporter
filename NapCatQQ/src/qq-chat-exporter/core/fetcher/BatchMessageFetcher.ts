/**
 * 批量消息获取器
 * 支持复杂筛选条件和大批量数据处理
 */

import { NapCatCore, Peer, RawMessage, ChatType, NTMsgType } from '@/core';
import { 
    MessageFilter, 
    BatchFetchResult, 
    ApiCallStats, 
    ErrorType, 
    SystemError 
} from '../../types';

/**
 * 批量获取配置接口
 */
interface BatchFetchConfig {
    /** 每批次获取数量（建议1000-10000） */
    batchSize: number;
    /** 超时时间（毫秒） */
    timeout: number;
    /** 重试次数 */
    retryCount: number;
    /** 重试间隔（毫秒） */
    retryInterval: number;
    /** 是否启用优化模式 */
    enableOptimization: boolean;
}

/**
 * 获取策略枚举
 */
enum FetchStrategy {
    /** 基于时间范围的顺序获取 */
    TIME_BASED_SEQUENTIAL = 'time_based_sequential',
    /** 基于序列号的范围获取 */
    SEQUENCE_BASED_RANGE = 'sequence_based_range',
    /** 混合策略（动态选择） */
    HYBRID = 'hybrid'
}

/**
 * 批量消息获取器类
 * 封装了NapCat最底层的消息获取API，提供高性能的批量获取能力
 */
export class BatchMessageFetcher {
    private readonly core: NapCatCore;
    private readonly config: BatchFetchConfig;
    private readonly stats: ApiCallStats;
    
    /** 当前使用的获取策略 */
    private currentStrategy: FetchStrategy;
    
    /** 是否正在获取中 */
    private isFetching: boolean = false;
    
    /** 取消令牌 */
    private cancelToken: { cancelled: boolean } = { cancelled: false };

    /**
     * 构造函数
     * @param core NapCat核心实例
     * @param config 批量获取配置
     */
    constructor(core: NapCatCore, config: Partial<BatchFetchConfig> = {}) {
        this.core = core;
        this.config = {
            batchSize: 5000, // 默认5000条/批次，适合QQ API限制
            timeout: 30000, // 30秒超时
            retryCount: 3,
            retryInterval: 1000,
            enableOptimization: true,
            ...config
        };
        
        this.stats = {
            callCount: 0,
            successCount: 0,
            failureCount: 0,
            averageResponseTime: 0,
            lastCallTime: new Date(),
            consecutiveFailures: 0
        };
        
        // 默认使用混合策略
        this.currentStrategy = FetchStrategy.HYBRID;
    }

    /**
     * 获取当前使用的获取策略
     */
    getCurrentStrategy(): FetchStrategy {
        return this.currentStrategy;
    }

    /**
     * 批量获取消息
     * 这是主要的外部接口，支持复杂的筛选条件和分页获取
     * 
     * @param peer 聊天对象
     * @param filter 消息筛选条件
     * @param startMessageId 起始消息ID（用于分页）
     * @param startSeq 起始序列号（用于分页）
     * @returns 批量获取结果
     */
    async fetchMessages(
        peer: Peer,
        filter: MessageFilter,
        startMessageId?: string,
        startSeq?: string
    ): Promise<BatchFetchResult> {
        // 检查是否已在获取中
        if (this.isFetching) {
            throw new SystemError({
                type: ErrorType.API_ERROR,
                message: '批量获取器正忙，请稍后再试',
                timestamp: new Date(),
                context: { operation: 'fetchMessages', peer }
            });
        }

        this.isFetching = true;
        this.cancelToken.cancelled = false;
        
        try {
            const startTime = Date.now();
            
            // 根据筛选条件和性能情况选择最优策略
            const strategy = this.selectOptimalStrategy(filter, peer);
            this.currentStrategy = strategy;
            console.info(`[BatchMessageFetcher] 选择策略: ${strategy}, 开始执行获取`);
            
            // 执行获取
            const result = await this.executeStrategy(strategy, peer, filter, startMessageId, startSeq);
            console.info(`[BatchMessageFetcher] 策略执行完成, 获取${result.messages.length}条消息`);
            
            // 更新统计信息
            const fetchTime = Date.now() - startTime;
            this.updateStats(true, fetchTime);
            
            result.fetchTime = fetchTime;
            return result;
            
        } catch (error) {
            this.updateStats(false, 0);
            throw this.wrapError(error, 'fetchMessages', { peer, filter });
        } finally {
            this.isFetching = false;
        }
    }

    /**
     * 获取单个时间范围内的所有消息
     * 适用于需要获取特定时间段内所有消息的场景
     * 
     * @param peer 聊天对象
     * @param startTime 开始时间（Unix时间戳，毫秒）
     * @param endTime 结束时间（Unix时间戳，毫秒）
     * @param additionalFilter 额外筛选条件
     * @returns 所有消息的异步迭代器
     */
    async* fetchAllMessagesInTimeRange(
        peer: Peer,
        startTime: number,
        endTime: number,
        additionalFilter: Partial<MessageFilter> = {}
    ): AsyncGenerator<RawMessage[], void, unknown> {
        const filter: MessageFilter = {
            startTime,
            endTime,
            ...additionalFilter
        };

        let hasMore = true;
        let nextMessageId: string | undefined;
        let nextSeq: string | undefined;

        while (hasMore && !this.cancelToken.cancelled) {
            console.info(`[BatchMessageFetcher] 开始获取消息批次, nextMessageId=${nextMessageId}, nextSeq=${nextSeq}`);
            const result = await this.fetchMessages(peer, filter, nextMessageId, nextSeq);
            console.info(`[BatchMessageFetcher] 获取消息批次完成, 消息数量=${result.messages.length}, hasMore=${result.hasMore}`);
            
            // 防御性提前停止：若客户端筛选后为空，且批次最早时间早于开始时间，则无需继续回溯
            if (
                result.messages.length === 0 &&
                typeof (result as any).earliestMsgTime === 'number' &&
                typeof filter.startTime === 'number' &&
                (result as any).earliestMsgTime < filter.startTime
            ) {
                console.info(`[BatchMessageFetcher] 触发防御性提前停止：earliestMsgTime=${(result as any).earliestMsgTime}, startTime=${filter.startTime}`);
                hasMore = false;
                break;
            }
            
            if (result.messages.length > 0) {
                yield result.messages;
            }

            hasMore = result.hasMore;
            nextMessageId = result.nextMessageId;
            nextSeq = result.nextSeq;

            // 避免过于频繁的API调用
            if (hasMore) {
                await this.delay(100);
            }
        }
    }

    /**
     * 根据筛选条件和性能情况选择最优的获取策略
     */
    private selectOptimalStrategy(filter: MessageFilter, peer: Peer): FetchStrategy {
        // 对于私聊，直接使用最简单可靠的方法
        if (peer.chatType === 1) {
            console.debug(`策略选择: 私聊使用基础getMsgHistory方法, 对等体=${peer.peerUid}`);
            return FetchStrategy.TIME_BASED_SEQUENTIAL;
        }

        // 如果禁用优化，使用默认策略
        if (!this.config.enableOptimization) {
            return FetchStrategy.TIME_BASED_SEQUENTIAL;
        }

        // 根据筛选条件判断最优策略
        const hasTimeFilter = filter.startTime || filter.endTime;
        const hasSenderFilter = filter.senderUids && filter.senderUids.length > 0;
        const hasTypeFilter = filter.messageTypes && filter.messageTypes.length > 0;

        console.debug(`策略选择: 时间筛选=${hasTimeFilter ? filter.startTime + '-' + filter.endTime : 'false'}, 发送者筛选=${hasSenderFilter}, 类型筛选=${hasTypeFilter}, 对等体=${peer.peerUid}`);

        // 暂时都使用基础方法，避免复杂API问题
        return FetchStrategy.TIME_BASED_SEQUENTIAL;
    }

    /**
     * 执行指定的获取策略
     */
    private async executeStrategy(
        strategy: FetchStrategy,
        peer: Peer,
        filter: MessageFilter,
        startMessageId?: string,
        startSeq?: string
    ): Promise<BatchFetchResult> {
        switch (strategy) {
            case FetchStrategy.TIME_BASED_SEQUENTIAL:
                return this.fetchByTimeBasedSequential(peer, filter, startMessageId);
            
            case FetchStrategy.SEQUENCE_BASED_RANGE:
                return this.fetchBySequenceRange(peer, filter, startSeq);
            
            case FetchStrategy.HYBRID:
                return this.fetchByHybridStrategy(peer, filter, startMessageId, startSeq);
            
            default:
                throw new SystemError({
                    type: ErrorType.API_ERROR,
                    message: `未知的获取策略: ${strategy}`,
                    timestamp: new Date(),
                    context: { strategy, peer, filter }
                });
        }
    }

    /**
     * 基于时间的顺序获取策略
     * 使用 queryMsgsWithFilterEx API，支持复杂筛选条件
     */
    private async fetchByTimeBasedSequential(
        peer: Peer,
        filter: MessageFilter,
        startMessageId?: string
    ): Promise<BatchFetchResult> {
        console.info(`[BatchMessageFetcher] 时间筛选参数: 原始=${filter.startTime}-${filter.endTime}`);

        // 根据是否有起始消息ID选择不同的API
        const result = await this.callWithRetry(async () => {
            if (!startMessageId) {
                // 没有起始消息ID时，获取最新消息
                console.info(`[BatchMessageFetcher] 调用 getAioFirstViewLatestMsgs API, count=${this.config.batchSize}`);
                return await this.core.apis.MsgApi.getAioFirstViewLatestMsgs(peer, this.config.batchSize);
            } else {
                // 有起始消息ID时，从该消息开始获取历史消息
                console.info(`[BatchMessageFetcher] 调用 getMsgHistory API, msgId=${startMessageId}, count=${this.config.batchSize}`);
                return await this.core.apis.MsgApi.getMsgHistory(
                    peer,
                    startMessageId,
                    this.config.batchSize,
                    true // 改回true，这应该是获取历史消息的正确方向
                );
            }
        });

        console.info(`[BatchMessageFetcher] API 调用完成, 结果消息数量: ${result?.msgList?.length || 0}`);
        
        const batchResult = this.processApiResult(result, filter, startMessageId);
        
        // 应用客户端筛选（时间、发送者等）
        batchResult.messages = this.applyClientSideFilter(batchResult.messages, filter);
        batchResult.actualCount = batchResult.messages.length;
        
        return batchResult;
    }

    /**
     * 基于序列号范围的获取策略
     * 使用 getMsgsBySeqRange API，适用于连续获取
     */
    private async fetchBySequenceRange(
        peer: Peer,
        filter: MessageFilter,
        startSeq?: string
    ): Promise<BatchFetchResult> {
        // 如果没有起始序列号，先获取最新消息的序列号
        if (!startSeq) {
            const latestResult = await this.core.context.session.getMsgService()
                .getAioFirstViewLatestMsgs(peer, 1);
            
            if (latestResult.msgList.length === 0) {
                return {
                    messages: [],
                    hasMore: false,
                    actualCount: 0,
                    fetchTime: 0
                };
            }
            
            startSeq = latestResult.msgList[0]!.msgSeq;
        }

        // 计算结束序列号（向前推算batchSize条）
        const startSeqNum = parseInt(startSeq);
        const endSeqNum = Math.max(0, startSeqNum - this.config.batchSize);
        const endSeq = endSeqNum.toString();

        // 调用 getMsgsBySeqRange API
        const result = await this.callWithRetry(async () => {
            return this.core.context.session.getMsgService()
                .getMsgsBySeqRange(peer, endSeq, startSeq!);
        });

        const batchResult = this.processApiResult(result, filter, undefined);
        
        // 应用筛选条件（因为序列号获取不支持复杂筛选）
        batchResult.messages = this.applyClientSideFilter(batchResult.messages, filter);
        batchResult.actualCount = batchResult.messages.length;

        return batchResult;
    }

    /**
     * 混合策略
     * 根据实际情况动态选择最优的API调用方式
     */
    private async fetchByHybridStrategy(
        peer: Peer,
        filter: MessageFilter,
        startMessageId?: string,
        startSeq?: string
    ): Promise<BatchFetchResult> {
        // 分析筛选条件的复杂度
        const hasComplexFilter = (filter.senderUids && filter.senderUids.length > 0) ||
                                (filter.messageTypes && filter.messageTypes.length > 0) ||
                                (filter.keywords && filter.keywords.length > 0);

        // 如果有复杂筛选条件，使用时间基础策略
        if (hasComplexFilter) {
            return this.fetchByTimeBasedSequential(peer, filter, startMessageId);
        }

        // 否则使用性能更好的序列号策略
        return this.fetchBySequenceRange(peer, filter, startSeq);
    }

    /**
     * 处理API调用结果，统一格式化
     */
    private processApiResult(apiResult: any, filter?: MessageFilter, currentMessageId?: string): BatchFetchResult {
        const messages: RawMessage[] = apiResult.msgList || [];
        
        // 判断是否还有更多消息
        let hasMore = messages.length > 0; // 有消息就继续获取
        
        // 获取下一批次的标识符
        let nextMessageId: string | undefined;
        let nextSeq: string | undefined;
        
        // 计算本批次最早消息时间（毫秒）
        let earliestMsgTime: number | undefined;
        
        if (messages.length > 0) {
            // 获取这批消息中时间最早的消息ID作为下一次查询的起点
            let earliestMessage = messages[0];
            for (const msg of messages) {
                if (msg.msgTime && (!earliestMessage?.msgTime || parseInt(msg.msgTime) < parseInt(earliestMessage.msgTime))) {
                    earliestMessage = msg;
                }
            }
            
            if (earliestMessage) {
                nextMessageId = earliestMessage.msgId;
                nextSeq = earliestMessage.msgSeq;

                // 计算最早消息时间（转换为毫秒）
                let rawTime = parseInt(earliestMessage.msgTime);
                if (Number.isFinite(rawTime)) {
                    // 若为秒级时间戳，则转换为毫秒
                    if (rawTime > 1000000000 && rawTime < 10000000000) {
                        earliestMsgTime = rawTime * 1000;
                    } else {
                        earliestMsgTime = rawTime;
                    }
                }
                
                // 检查是否返回了与当前查询起点相同的消息（防止无限循环）
                if (currentMessageId && nextMessageId === currentMessageId) {
                    hasMore = false;
                    nextMessageId = undefined;
                    nextSeq = undefined;
                }
            }
        }

        // 若最早时间早于筛选开始时间，则提前停止，避免继续回溯无效范围
        if (
            typeof earliestMsgTime === 'number' &&
            filter && typeof filter.startTime === 'number' &&
            earliestMsgTime < filter.startTime
        ) {
            console.info(`[BatchMessageFetcher] 早停：earliestMsgTime=${earliestMsgTime} < startTime=${filter.startTime}，停止继续获取`);
            hasMore = false;
            nextMessageId = undefined;
            nextSeq = undefined;
        }

        console.info(`[BatchMessageFetcher] 处理结果: ${messages.length} 条消息, hasMore=${hasMore}, nextMessageId=${nextMessageId}, earliestMsgTime=${earliestMsgTime}`);

        return {
            messages,
            hasMore,
            nextMessageId,
            nextSeq,
            actualCount: messages.length,
            fetchTime: 0, // 将在外层设置
            earliestMsgTime
        };
    }

    /**
     * 客户端筛选，用于序列号获取后的二次筛选
     */
    private applyClientSideFilter(messages: RawMessage[], filter: MessageFilter): RawMessage[] {
        console.info(`[BatchMessageFetcher] 开始客户端筛选，输入消息数量: ${messages.length}`);
        let filtered = messages;

        // 时间筛选
        if (filter.startTime || filter.endTime) {
            const beforeTimeFilter = filtered.length;
            console.info(`[BatchMessageFetcher] 开始时间筛选，筛选前消息数量: ${beforeTimeFilter}, 筛选范围: ${filter.startTime} - ${filter.endTime}`);
            
            filtered = filtered.filter(msg => {
                let msgTime = parseInt(msg.msgTime);
                
                // 检查时间戳是否为秒级（10位数）并转换为毫秒级
                // 秒级时间戳范围大约：1000000000 (2001年) - 9999999999 (2286年)
                if (msgTime > 1000000000 && msgTime < 10000000000) {
                    msgTime = msgTime * 1000;
                }
                
                const passes = (!filter.startTime || msgTime >= filter.startTime) && 
                             (!filter.endTime || msgTime <= filter.endTime);
                
                if (!passes) {
                    console.info(`[BatchMessageFetcher] 消息被时间筛选过滤: msgId=${msg.msgId}, 原始时间=${msg.msgTime}, 转换后=${msgTime}, 筛选范围=${filter.startTime}-${filter.endTime}`);
                }
                
                return passes;
            });
            
            console.info(`[BatchMessageFetcher] 时间筛选完成，筛选后消息数量: ${filtered.length}, 过滤掉: ${beforeTimeFilter - filtered.length}`);
        }

        // 发送者筛选
        if (filter.senderUids && filter.senderUids.length > 0) {
            filtered = filtered.filter(msg => 
                filter.senderUids!.includes(msg.senderUid || msg.peerUid)
            );
        }

        // 消息类型筛选
        if (filter.messageTypes && filter.messageTypes.length > 0) {
            const allowedTypes = new Set(filter.messageTypes.map(t => t.type));
            filtered = filtered.filter(msg => allowedTypes.has(msg.msgType));
        }

        // 关键词筛选（简单实现）
        if (filter.keywords && filter.keywords.length > 0) {
            filtered = filtered.filter(msg => {
                const content = JSON.stringify(msg.elements);
                return filter.keywords!.some(keyword => 
                    content.toLowerCase().includes(keyword.toLowerCase())
                );
            });
        }

        console.info(`[BatchMessageFetcher] 客户端筛选完成，最终输出消息数量: ${filtered.length} (输入: ${messages.length}, 过滤掉: ${messages.length - filtered.length})`);
        return filtered;
    }

    /**
     * 构建消息类型筛选器
     */
    private buildMessageTypeFilter(messageTypes?: Array<{type: NTMsgType, subTypes?: number[]}>): Array<{type: NTMsgType, subType: number[]}> {
        if (!messageTypes || messageTypes.length === 0) {
            return [];
        }

        return messageTypes.map(mt => ({
            type: mt.type,
            subType: mt.subTypes || []
        }));
    }

    /**
     * 获取权限标志
     */
    private getPrivilegeFlag(chatType: ChatType): number {
        switch (chatType) {
            case ChatType.KCHATTYPEGROUP:
                return 336068800; // 群聊权限标志
            case ChatType.KCHATTYPEC2C:
                return 0; // 私聊权限标志
            default:
                return 0;
        }
    }

    /**
     * 带重试的API调用
     */
    private async callWithRetry<T>(apiCall: () => Promise<T>): Promise<T> {
        let lastError: Error | undefined;
        
        for (let attempt = 0; attempt <= this.config.retryCount; attempt++) {
            try {
                // 检查取消令牌
                if (this.cancelToken.cancelled) {
                    throw new SystemError({
                        type: ErrorType.API_ERROR,
                        message: '操作已被取消',
                        timestamp: new Date()
                    });
                }

                console.info(`[BatchMessageFetcher] 开始API调用 (尝试 ${attempt + 1}/${this.config.retryCount + 1})`);
                const result = await Promise.race([
                    apiCall(),
                    this.createTimeoutPromise<T>()
                ]);
                console.info(`[BatchMessageFetcher] API调用成功`);

                // 重置连续失败计数
                this.stats.consecutiveFailures = 0;
                return result;

            } catch (error) {
                lastError = error as Error;
                this.stats.consecutiveFailures++;
                console.warn(`[BatchMessageFetcher] API调用失败 (尝试 ${attempt + 1}/${this.config.retryCount + 1}):`, error);

                // 最后一次尝试失败，抛出错误
                if (attempt === this.config.retryCount) {
                    break;
                }

                // 等待重试间隔
                const retryDelay = this.config.retryInterval * (attempt + 1);
                console.info(`[BatchMessageFetcher] 等待 ${retryDelay}ms 后重试`);
                await this.delay(retryDelay);
            }
        }

        throw lastError;
    }

    /**
     * 创建超时Promise
     */
    private createTimeoutPromise<T>(): Promise<T> {
        return new Promise((_, reject) => {
            setTimeout(() => {
                reject(new SystemError({
                    type: ErrorType.TIMEOUT_ERROR,
                    message: `API调用超时 (${this.config.timeout}ms)`,
                    timestamp: new Date()
                }));
            }, this.config.timeout);
        });
    }

    /**
     * 更新统计信息
     */
    private updateStats(success: boolean, responseTime: number): void {
        this.stats.callCount++;
        this.stats.lastCallTime = new Date();

        if (success) {
            this.stats.successCount++;
            // 计算平均响应时间
            this.stats.averageResponseTime = 
                (this.stats.averageResponseTime * (this.stats.successCount - 1) + responseTime) / this.stats.successCount;
        } else {
            this.stats.failureCount++;
        }
    }

    /**
     * 包装错误信息
     */
    private wrapError(error: any, operation: string, context?: any): SystemError {
        if (error instanceof SystemError) {
            return error;
        }

        return new SystemError({
            type: ErrorType.API_ERROR,
            message: error.message || '未知API错误',
            details: error,
            stack: error.stack,
            timestamp: new Date(),
            context: { operation, ...context }
        });
    }

    /**
     * 延迟工具函数
     */
    private delay(ms: number): Promise<void> {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    /**
     * 取消当前获取操作
     */
    cancel(): void {
        this.cancelToken.cancelled = true;
    }

    /**
     * 获取当前统计信息
     */
    getStats(): ApiCallStats {
        return { ...this.stats };
    }

    /**
     * 重置统计信息
     */
    resetStats(): void {
        this.stats.callCount = 0;
        this.stats.successCount = 0;
        this.stats.failureCount = 0;
        this.stats.averageResponseTime = 0;
        this.stats.consecutiveFailures = 0;
    }

    /**
     * 检查是否正在获取中
     */
    isBusy(): boolean {
        return this.isFetching;
    }
}