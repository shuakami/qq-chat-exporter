/**
 * 聊天会话管理器
 * 负责获取和管理QQ聊天会话信息，包括群聊、私聊等
 * 使用NapCat的底层API获取真实的聊天数据
 */
import { ChatSession, ChatTypeSimple, SystemError, ErrorType } from '../../types/index.js';
import { NapCatCore, Peer } from 'NapCatQQ/src/core/index.js';
import { ChatType } from 'NapCatQQ/src/core/types.js';
/**
 * 聊天会话管理器类
 * 提供获取、格式化和管理聊天会话的功能
 */
export class ChatSessionManager {
    core;
    /** 会话缓存，避免频繁调用API */
    sessionCache = new Map();
    /** 缓存过期时间（毫秒） */
    cacheExpiration = 5 * 60 * 1000; // 5分钟
    /** 缓存时间戳 */
    cacheTimestamp = 0;
    /**
     * 构造函数
     * @param core NapCat核心实例
     */
    constructor(core) {
        this.core = core;
    }
    /**
     * 获取所有聊天会话
     * 包括最近联系人、群聊和好友
     *
     * @param forceRefresh 强制刷新缓存
     * @returns 聊天会话列表
     */
    async getAllChatSessions(forceRefresh = false) {
        try {
            // 检查缓存是否有效
            const now = Date.now();
            if (!forceRefresh && this.sessionCache.size > 0 &&
                (now - this.cacheTimestamp) < this.cacheExpiration) {
                this.core.context.logger.logDebug('[ChatSessionManager] 使用缓存数据');
                return Array.from(this.sessionCache.values());
            }
            this.core.context.logger.log('[ChatSessionManager] 开始获取聊天会话...');
            // 并行获取所有类型的会话
            const [recentContacts, groups, friends] = await Promise.all([
                this.getRecentContacts(),
                this.getGroupSessions(),
                this.getFriendSessions()
            ]);
            // 合并并去重会话
            const allSessions = new Map();
            // 添加最近联系人（优先级最高）
            recentContacts.forEach(session => {
                allSessions.set(session.id, session);
            });
            // 添加群聊（如果不在最近联系人中）
            groups.forEach(session => {
                if (!allSessions.has(session.id)) {
                    allSessions.set(session.id, session);
                }
            });
            // 添加好友（如果不在最近联系人中）
            friends.forEach(session => {
                if (!allSessions.has(session.id)) {
                    allSessions.set(session.id, session);
                }
            });
            // 更新缓存
            this.sessionCache = allSessions;
            this.cacheTimestamp = now;
            const sessions = Array.from(allSessions.values());
            this.core.context.logger.log(`[ChatSessionManager] 获取到 ${sessions.length} 个聊天会话`);
            return sessions;
        }
        catch (error) {
            this.core.context.logger.logError('[ChatSessionManager] 获取聊天会话失败:', error);
            throw new SystemError({
                type: ErrorType.API_ERROR,
                message: '获取聊天会话失败',
                details: error,
                timestamp: new Date(),
                context: { operation: 'getAllChatSessions' }
            });
        }
    }
    /**
     * 获取最近联系人
     * 使用getRecentContactListSnapShot API
     */
    async getRecentContacts() {
        try {
            this.core.context.logger.logDebug('[ChatSessionManager] 获取最近联系人...');
            // 获取最近100个联系人
            const recentResult = await this.core.apis.UserApi.getRecentContactListSnapShot(100);
            if (!recentResult.info || recentResult.info.errCode !== 0) {
                this.core.context.logger.logWarn('[ChatSessionManager] 获取最近联系人失败:', recentResult.info?.errMsg);
                return [];
            }
            const sessions = [];
            const changedList = recentResult.info.changedList || [];
            for (const contact of changedList) {
                try {
                    const session = await this.formatContactToSession(contact);
                    if (session) {
                        sessions.push(session);
                    }
                }
                catch (error) {
                    this.core.context.logger.logWarn(`[ChatSessionManager] 格式化联系人失败: ${contact.peerUid}`, error);
                }
            }
            this.core.context.logger.logDebug(`[ChatSessionManager] 获取到 ${sessions.length} 个最近联系人`);
            return sessions;
        }
        catch (error) {
            this.core.context.logger.logError('[ChatSessionManager] 获取最近联系人失败:', error);
            return [];
        }
    }
    /**
     * 获取群聊会话
     * 使用getGroups API
     */
    async getGroupSessions() {
        try {
            this.core.context.logger.logDebug('[ChatSessionManager] 获取群聊列表...');
            const groups = await this.core.apis.GroupApi.getGroups(false);
            if (!groups || groups.length === 0) {
                this.core.context.logger.logDebug('[ChatSessionManager] 没有群聊');
                return [];
            }
            const sessions = [];
            for (const group of groups) {
                try {
                    const session = {
                        id: `group_${group.groupCode}`,
                        type: 'group',
                        peer: {
                            chatType: ChatType.KCHATTYPEGROUP,
                            peerUid: group.groupCode,
                            guildId: ''
                        },
                        name: group.groupName || `群聊 ${group.groupCode}`,
                        available: true,
                        estimatedMessageCount: 0, // 稍后可以优化获取消息数量
                        avatar: group.avatarUrl || undefined,
                        lastMessageTime: group.lastMsgTime ? new Date(parseInt(group.lastMsgTime) * 1000) : undefined,
                        memberCount: group.memberCount
                    };
                    sessions.push(session);
                }
                catch (error) {
                    this.core.context.logger.logWarn(`[ChatSessionManager] 格式化群聊失败: ${group.groupCode}`, error);
                }
            }
            this.core.context.logger.logDebug(`[ChatSessionManager] 获取到 ${sessions.length} 个群聊`);
            return sessions;
        }
        catch (error) {
            this.core.context.logger.logError('[ChatSessionManager] 获取群聊失败:', error);
            return [];
        }
    }
    /**
     * 获取好友会话
     * 使用getBuddy API
     */
    async getFriendSessions() {
        try {
            this.core.context.logger.logDebug('[ChatSessionManager] 获取好友列表...');
            const friends = await this.core.apis.FriendApi.getBuddy();
            if (!friends || friends.length === 0) {
                this.core.context.logger.logDebug('[ChatSessionManager] 没有好友');
                return [];
            }
            const sessions = [];
            for (const friend of friends) {
                try {
                    const session = {
                        id: `private_${friend.uid}`,
                        type: 'private',
                        peer: {
                            chatType: ChatType.KCHATTYPEC2C,
                            peerUid: friend.uid || friend.uin || '',
                            guildId: ''
                        },
                        name: friend.remark || friend.nick || friend.uin || `用户 ${friend.uid}`,
                        available: true,
                        estimatedMessageCount: 0,
                        avatar: friend.avatarUrl || undefined,
                        isOnline: friend.status === 1 // 根据状态判断在线
                    };
                    sessions.push(session);
                }
                catch (error) {
                    this.core.context.logger.logWarn(`[ChatSessionManager] 格式化好友失败: ${friend.uid}`, error);
                }
            }
            this.core.context.logger.logDebug(`[ChatSessionManager] 获取到 ${sessions.length} 个好友`);
            return sessions;
        }
        catch (error) {
            this.core.context.logger.logError('[ChatSessionManager] 获取好友失败:', error);
            return [];
        }
    }
    /**
     * 格式化联系人为会话对象
     */
    async formatContactToSession(contact) {
        if (!contact.peerUid || !contact.chatType) {
            return null;
        }
        const sessionId = contact.chatType === ChatType.KCHATTYPEGROUP
            ? `group_${contact.peerUid}`
            : `private_${contact.peerUid}`;
        const session = {
            id: sessionId,
            type: contact.chatType === ChatType.KCHATTYPEGROUP ? 'group' : 'private',
            peer: {
                chatType: contact.chatType,
                peerUid: contact.peerUid,
                guildId: ''
            },
            name: contact.peerName || contact.sendNickName || `${contact.chatType === ChatType.KCHATTYPEGROUP ? '群聊' : '用户'} ${contact.peerUid}`,
            available: true,
            estimatedMessageCount: 0,
            lastMessageTime: contact.msgTime ? new Date(parseInt(contact.msgTime) * 1000) : undefined,
            lastMessageId: contact.msgId
        };
        return session;
    }
    /**
     * 根据ID获取特定会话
     *
     * @param sessionId 会话ID
     * @returns 会话信息或null
     */
    async getChatSession(sessionId) {
        try {
            // 首先尝试从缓存获取
            if (this.sessionCache.has(sessionId)) {
                return this.sessionCache.get(sessionId);
            }
            // 如果缓存中没有，刷新所有会话
            await this.getAllChatSessions(true);
            return this.sessionCache.get(sessionId) || null;
        }
        catch (error) {
            this.core.context.logger.logError(`[ChatSessionManager] 获取会话失败: ${sessionId}`, error);
            return null;
        }
    }
    /**
     * 搜索会话
     *
     * @param keyword 搜索关键词
     * @returns 匹配的会话列表
     */
    async searchChatSessions(keyword) {
        try {
            const allSessions = await this.getAllChatSessions();
            const lowercaseKeyword = keyword.toLowerCase();
            return allSessions.filter(session => session.name.toLowerCase().includes(lowercaseKeyword) ||
                session.id.toLowerCase().includes(lowercaseKeyword) ||
                session.peer.peerUid.toLowerCase().includes(lowercaseKeyword));
        }
        catch (error) {
            this.core.context.logger.logError('[ChatSessionManager] 搜索会话失败:', error);
            return [];
        }
    }
    /**
     * 清除缓存
     */
    clearCache() {
        this.sessionCache.clear();
        this.cacheTimestamp = 0;
        this.core.context.logger.logDebug('[ChatSessionManager] 缓存已清除');
    }
    /**
     * 获取会话统计信息
     */
    getSessionStats() {
        const sessions = Array.from(this.sessionCache.values());
        const groups = sessions.filter(s => s.type === 'group').length;
        const privateSessions = sessions.filter(s => s.type === 'private').length;
        return {
            total: sessions.length,
            groups,
            private: privateSessions,
            cached: this.sessionCache.size > 0,
            cacheAge: Date.now() - this.cacheTimestamp
        };
    }
}
//# sourceMappingURL=ChatSessionManager.js.map