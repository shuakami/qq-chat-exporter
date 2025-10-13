/**
 * 聊天会话管理器
 * 负责获取和管理QQ聊天会话信息，包括群聊、私聊等
 * 使用NapCat的底层API获取真实的聊天数据
 */
import { ChatSession } from '../../types/index.js';
import { NapCatCore } from 'NapCatQQ/src/core/index.js';
/**
 * 聊天会话管理器类
 * 提供获取、格式化和管理聊天会话的功能
 */
export declare class ChatSessionManager {
    private readonly core;
    /** 会话缓存，避免频繁调用API */
    private sessionCache;
    /** 缓存过期时间（毫秒） */
    private readonly cacheExpiration;
    /** 缓存时间戳 */
    private cacheTimestamp;
    /**
     * 构造函数
     * @param core NapCat核心实例
     */
    constructor(core: NapCatCore);
    /**
     * 获取所有聊天会话
     * 包括最近联系人、群聊和好友
     *
     * @param forceRefresh 强制刷新缓存
     * @returns 聊天会话列表
     */
    getAllChatSessions(forceRefresh?: boolean): Promise<ChatSession[]>;
    /**
     * 获取最近联系人
     * 使用getRecentContactListSnapShot API
     */
    private getRecentContacts;
    /**
     * 获取群聊会话
     * 使用getGroups API
     */
    private getGroupSessions;
    /**
     * 获取好友会话
     * 使用getBuddy API
     */
    private getFriendSessions;
    /**
     * 格式化联系人为会话对象
     */
    private formatContactToSession;
    /**
     * 根据ID获取特定会话
     *
     * @param sessionId 会话ID
     * @returns 会话信息或null
     */
    getChatSession(sessionId: string): Promise<ChatSession | null>;
    /**
     * 搜索会话
     *
     * @param keyword 搜索关键词
     * @returns 匹配的会话列表
     */
    searchChatSessions(keyword: string): Promise<ChatSession[]>;
    /**
     * 清除缓存
     */
    clearCache(): void;
    /**
     * 获取会话统计信息
     */
    getSessionStats(): {
        total: number;
        groups: number;
        private: number;
        cached: boolean;
        cacheAge: number;
    };
}
//# sourceMappingURL=ChatSessionManager.d.ts.map