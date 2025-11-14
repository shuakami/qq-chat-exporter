/**
 * 流式搜索服务
 * 真正的流式处理：边获取边搜索边返回，不累积内存
 */
import { RawMessage } from 'NapCatQQ/src/core/types.js';
import { WebSocket } from 'ws';
export interface SearchProgress {
    searchId: string;
    status: 'searching' | 'completed' | 'cancelled' | 'error';
    processedCount: number;
    matchedCount: number;
    results: RawMessage[];
    error?: string;
}
export interface StreamSearchOptions {
    searchId: string;
    query: string;
    caseSensitive?: boolean;
    ws: WebSocket;
}
/**
 * 流式搜索管理器
 * 每个搜索都是独立的，不共享内存
 */
export declare class StreamSearchService {
    /** 活跃的搜索任务 */
    private activeSearches;
    /**
     * 提取消息文本（轻量级，不存储完整对象）
     */
    private extractText;
    /**
     * 检查消息是否匹配查询
     */
    private matchesQuery;
    /**
     * 发送进度更新
     */
    private sendProgress;
    /**
     * 流式搜索消息批次
     * 关键：每处理完一批就释放内存
     */
    searchBatch(messages: RawMessage[], options: StreamSearchOptions): Promise<RawMessage[]>;
    /**
     * 启动流式搜索
     * @param messageGenerator 消息生成器（异步迭代器）
     * @param options 搜索选项
     */
    startStreamSearch(messageGenerator: AsyncGenerator<RawMessage[], void, unknown>, options: StreamSearchOptions): Promise<void>;
    /**
     * 取消搜索
     */
    cancelSearch(searchId: string): boolean;
    /**
     * 获取活跃搜索数量
     */
    getActiveSearchCount(): number;
    /**
     * 取消所有搜索
     */
    cancelAllSearches(): void;
}
/** 全局单例 */
export declare const streamSearchService: StreamSearchService;
//# sourceMappingURL=StreamSearchService.d.ts.map