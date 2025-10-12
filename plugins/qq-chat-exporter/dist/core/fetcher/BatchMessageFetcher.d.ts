/**
 * 批量消息获取器
 * 支持复杂筛选条件和大批量数据处理
 */
import { NapCatCore, Peer, RawMessage } from 'NapCatQQ/src/core/index.js';
import { MessageFilter, BatchFetchResult, ApiCallStats } from '../../types.js';
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
declare enum FetchStrategy {
    /** 基于时间范围的顺序获取 */
    TIME_BASED_SEQUENTIAL = "time_based_sequential",
    /** 基于序列号的范围获取 */
    SEQUENCE_BASED_RANGE = "sequence_based_range",
    /** 混合策略（动态选择） */
    HYBRID = "hybrid"
}
/**
 * 批量消息获取器类
 * 封装了NapCat最底层的消息获取API，提供高性能的批量获取能力
 */
export declare class BatchMessageFetcher {
    private readonly core;
    private readonly config;
    private readonly stats;
    /** 当前使用的获取策略 */
    private currentStrategy;
    /** 是否正在获取中 */
    private isFetching;
    /** 取消令牌 */
    private cancelToken;
    /**
     * 构造函数
     * @param core NapCat核心实例
     * @param config 批量获取配置
     */
    constructor(core: NapCatCore, config?: Partial<BatchFetchConfig>);
    /**
     * 获取当前使用的获取策略
     */
    getCurrentStrategy(): FetchStrategy;
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
    fetchMessages(peer: Peer, filter: MessageFilter, startMessageId?: string, startSeq?: string): Promise<BatchFetchResult>;
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
    fetchAllMessagesInTimeRange(peer: Peer, startTime: number, endTime: number, additionalFilter?: Partial<MessageFilter>): AsyncGenerator<RawMessage[], void, unknown>;
    /**
     * 根据筛选条件和性能情况选择最优的获取策略
     */
    private selectOptimalStrategy;
    /**
     * 执行指定的获取策略
     */
    private executeStrategy;
    /**
     * 基于时间的顺序获取策略
     * 使用 queryMsgsWithFilterEx API，支持复杂筛选条件
     */
    private fetchByTimeBasedSequential;
    /**
     * 基于序列号范围的获取策略
     * 使用 getMsgsBySeqRange API，适用于连续获取
     */
    private fetchBySequenceRange;
    /**
     * 混合策略
     * 根据实际情况动态选择最优的API调用方式
     */
    private fetchByHybridStrategy;
    /**
     * 处理API调用结果，统一格式化
     */
    private processApiResult;
    /**
     * 客户端筛选，用于序列号获取后的二次筛选
     */
    private applyClientSideFilter;
    /**
     * 构建消息类型筛选器
     */
    private buildMessageTypeFilter;
    /**
     * 获取权限标志
     */
    private getPrivilegeFlag;
    /**
     * 带重试的API调用
     */
    private callWithRetry;
    /**
     * 创建超时Promise
     */
    private createTimeoutPromise;
    /**
     * 更新统计信息
     */
    private updateStats;
    /**
     * 包装错误信息
     */
    private wrapError;
    /**
     * 延迟工具函数
     */
    private delay;
    /**
     * 取消当前获取操作
     */
    cancel(): void;
    /**
     * 获取当前统计信息
     */
    getStats(): ApiCallStats;
    /**
     * 重置统计信息
     */
    resetStats(): void;
    /**
     * 检查是否正在获取中
     */
    isBusy(): boolean;
}
export {};
//# sourceMappingURL=BatchMessageFetcher.d.ts.map