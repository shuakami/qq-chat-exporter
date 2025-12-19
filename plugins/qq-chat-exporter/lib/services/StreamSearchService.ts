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
export class StreamSearchService {
    /** 活跃的搜索任务 */
    private activeSearches: Map<string, { cancel: () => void }> = new Map();
    
    /**
     * 提取消息文本（轻量级，不存储完整对象）
     */
    private extractText(message: RawMessage): string {
        const texts: string[] = [];
        
        if (message.elements) {
            for (const element of message.elements) {
                if (element.textElement?.content) {
                    texts.push(element.textElement.content);
                }
            }
        }
        
        const senderName = message.sendMemberName || message.sendNickName;
        if (senderName) {
            texts.push(senderName);
        }
        
        return texts.join(' ');
    }
    
    /**
     * 检查消息是否匹配查询
     */
    private matchesQuery(message: RawMessage, query: string, caseSensitive: boolean = false): boolean {
        const text = this.extractText(message);
        
        if (caseSensitive) {
            return text.includes(query);
        }
        
        return text.toLowerCase().includes(query.toLowerCase());
    }
    
    /**
     * 发送进度更新
     */
    private sendProgress(ws: WebSocket, progress: SearchProgress): void {
        if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({
                type: 'search_progress',
                data: progress
            }));
        }
    }
    
    /**
     * 流式搜索消息批次
     * 关键：每处理完一批就释放内存
     */
    async searchBatch(
        messages: RawMessage[],
        options: StreamSearchOptions
    ): Promise<RawMessage[]> {
        const { query, caseSensitive = false } = options;
        const matches: RawMessage[] = [];
        
        for (const message of messages) {
            // 检查是否被取消
            const search = this.activeSearches.get(options.searchId);
            if (!search) {
                throw new Error('Search cancelled');
            }
            
            if (this.matchesQuery(message, query, caseSensitive)) {
                matches.push(message);
            }
        }
        
        return matches;
    }
    
    /**
     * 启动流式搜索
     * @param messageGenerator 消息生成器（异步迭代器）
     * @param options 搜索选项
     */
    async startStreamSearch(
        messageGenerator: AsyncGenerator<RawMessage[], void, unknown>,
        options: StreamSearchOptions
    ): Promise<void> {
        const { searchId, query, ws } = options;
        
        // 注册搜索任务
        let cancelled = false;
        this.activeSearches.set(searchId, {
            cancel: () => { cancelled = true; }
        });
        
        let processedCount = 0;
        let matchedCount = 0;
        let batchNumber = 0;
        
        try {
            // 流式处理每一批消息 - 一直搜到底！
            for await (const batch of messageGenerator) {
                batchNumber++;
                
                // 检查是否被用户取消
                if (cancelled) {
                    this.sendProgress(ws, {
                        searchId,
                        status: 'cancelled',
                        processedCount,
                        matchedCount,
                        results: []
                    });
                    return;
                }
                
                // 搜索这一批消息（轻量级，不存储完整对象）
                const matches = await this.searchBatch(batch, options);
                
                processedCount += batch.length;
                matchedCount += matches.length;
                
                // 实时推送结果（无论有没有找到）
                this.sendProgress(ws, {
                    searchId,
                    status: 'searching',
                    processedCount,
                    matchedCount,
                    results: matches  // 增量推送新找到的结果
                });
                
                // 关键：这批消息处理完后立即被GC回收，内存不累积！
                // batch变量会被下一次循环覆盖，旧数据自动释放
            }
            
            // 搜索完成（搜索了所有历史消息）
            this.sendProgress(ws, {
                searchId,
                status: 'completed',
                processedCount,
                matchedCount,
                results: []  // 完成信号，结果已经增量发送过了
            });
            
        } catch (error) {
            console.error(`[StreamSearch] 搜索错误: ${searchId}`, error);
            
            this.sendProgress(ws, {
                searchId,
                status: 'error',
                processedCount,
                matchedCount,
                results: [],
                error: error instanceof Error ? error.message : '搜索失败'
            });
        } finally {
            // 清理
            this.activeSearches.delete(searchId);
        }
    }
    
    /**
     * 取消搜索
     */
    cancelSearch(searchId: string): boolean {
        const search = this.activeSearches.get(searchId);
        if (search) {
            search.cancel();
            this.activeSearches.delete(searchId);
            return true;
        }
        return false;
    }
    
    /**
     * 获取活跃搜索数量
     */
    getActiveSearchCount(): number {
        return this.activeSearches.size;
    }
    
    /**
     * 取消所有搜索
     */
    cancelAllSearches(): void {
        for (const [searchId, search] of this.activeSearches) {
            search.cancel();
        }
        this.activeSearches.clear();
    }
}

/** 全局单例 */
export const streamSearchService = new StreamSearchService();

