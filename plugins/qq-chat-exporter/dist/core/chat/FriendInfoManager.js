/**
 * 好友信息管理器
 * 负责获取和管理QQ好友的详细信息，包括个人资料、在线状态、关系等
 * 使用NapCat的底层API获取完整的好友数据
 */
import { SystemError, ErrorType } from '../../types/index.js';
import { NapCatCore } from 'NapCatQQ/src/core/index.js';
/**
 * 好友信息管理器类
 * 提供获取、格式化和管理好友详细信息的功能
 */
export class FriendInfoManager {
    core;
    /** 好友信息缓存 */
    friendInfoCache = new Map();
    /** 好友分组缓存 */
    friendGroupsCache = new Map();
    /** 缓存过期时间（毫秒） */
    cacheExpiration = 10 * 60 * 1000; // 10分钟
    /** 缓存时间戳 */
    cacheTimestamps = new Map();
    /**
     * 构造函数
     * @param core NapCat核心实例
     */
    constructor(core) {
        this.core = core;
    }
    /**
     * 获取好友详细信息
     *
     * @param uid 好友UID
     * @param forceRefresh 强制刷新缓存
     * @returns 好友详细信息
     */
    async getFriendDetailInfo(uid, forceRefresh = false) {
        try {
            const cacheKey = `friend_${uid}`;
            // 检查缓存
            if (!forceRefresh && this.isValidCache(cacheKey)) {
                this.core.context.logger.logDebug(`[FriendInfoManager] 使用缓存的好友信息: ${uid}`);
                return this.friendInfoCache.get(uid) || null;
            }
            this.core.context.logger.log(`[FriendInfoManager] 获取好友详细信息: ${uid}`);
            // 使用NapCat API获取用户详细信息
            const userDetail = await this.core.apis.UserApi.getUserDetailInfo(uid, true);
            if (!userDetail) {
                this.core.context.logger.logWarn(`[FriendInfoManager] 获取好友信息失败: ${uid}`);
                return null;
            }
            // 并行获取好友关系信息
            const [friendRelation] = await Promise.allSettled([
                this.getFriendRelationInfo(uid)
            ]);
            // 格式化好友信息
            const detailInfo = this.formatFriendDetail(userDetail, friendRelation);
            // 更新缓存
            this.friendInfoCache.set(uid, detailInfo);
            this.cacheTimestamps.set(cacheKey, Date.now());
            this.core.context.logger.log(`[FriendInfoManager] 好友信息获取成功: ${uid} (${detailInfo.nick})`);
            return detailInfo;
        }
        catch (error) {
            this.core.context.logger.logError(`[FriendInfoManager] 获取好友详细信息失败: ${uid}`, error);
            throw new SystemError({
                type: ErrorType.API_ERROR,
                message: '获取好友详细信息失败',
                details: error,
                timestamp: new Date(),
                context: { uid, operation: 'getFriendDetailInfo' }
            });
        }
    }
    /**
     * 批量获取好友信息
     *
     * @param uids 好友UID列表
     * @param forceRefresh 强制刷新缓存
     * @returns 好友信息列表
     */
    async getBatchFriendInfo(uids, forceRefresh = false) {
        try {
            this.core.context.logger.log(`[FriendInfoManager] 批量获取好友信息: ${uids.length}个`);
            const results = [];
            const batchSize = 10; // 控制并发数量
            // 分批处理，避免过多并发请求
            for (let i = 0; i < uids.length; i += batchSize) {
                const batch = uids.slice(i, i + batchSize);
                const batchPromises = batch.map(uid => this.getFriendDetailInfo(uid, forceRefresh).catch(error => {
                    this.core.context.logger.logWarn(`[FriendInfoManager] 获取好友信息失败: ${uid}`, error);
                    return null;
                }));
                const batchResults = await Promise.all(batchPromises);
                results.push(...batchResults.filter(result => result !== null));
                // 添加小延迟，避免请求过快
                if (i + batchSize < uids.length) {
                    await new Promise(resolve => setTimeout(resolve, 200));
                }
            }
            this.core.context.logger.log(`[FriendInfoManager] 批量获取完成: ${results.length}/${uids.length}`);
            return results;
        }
        catch (error) {
            this.core.context.logger.logError(`[FriendInfoManager] 批量获取好友信息失败`, error);
            return [];
        }
    }
    /**
     * 搜索好友
     *
     * @param keyword 搜索关键词
     * @returns 匹配的好友列表
     */
    async searchFriends(keyword) {
        try {
            // 首先获取所有好友基础信息
            const buddies = await this.core.apis.FriendApi.getBuddy();
            const lowercaseKeyword = keyword.toLowerCase();
            // 过滤匹配的好友
            const matchedBuddies = buddies.filter(buddy => (buddy.coreInfo?.nick && buddy.coreInfo.nick.toLowerCase().includes(lowercaseKeyword)) ||
                (buddy.coreInfo?.remark && buddy.coreInfo.remark.toLowerCase().includes(lowercaseKeyword)) ||
                (buddy.uin && buddy.uin.includes(keyword)) ||
                (buddy.uid && buddy.uid.toLowerCase().includes(lowercaseKeyword)));
            // 获取匹配好友的详细信息
            const detailPromises = matchedBuddies.map(buddy => this.getFriendDetailInfo(buddy.uid || '').catch(() => null));
            const results = await Promise.all(detailPromises);
            return results.filter(result => result !== null);
        }
        catch (error) {
            this.core.context.logger.logError(`[FriendInfoManager] 搜索好友失败: ${keyword}`, error);
            return [];
        }
    }
    /**
     * 获取好友分组信息
     *
     * @param forceRefresh 强制刷新缓存
     * @returns 好友分组列表
     */
    async getFriendGroups(forceRefresh = false) {
        try {
            const cacheKey = 'friend_groups';
            // 检查缓存
            if (!forceRefresh && this.isValidCache(cacheKey)) {
                this.core.context.logger.logDebug('[FriendInfoManager] 使用缓存的好友分组信息');
                return this.friendGroupsCache.get('all') || [];
            }
            this.core.context.logger.log('[FriendInfoManager] 获取好友分组信息...');
            // 这里可能需要调用特定的API获取分组信息
            // 当前先返回默认分组
            const defaultGroups = [
                {
                    groupId: 'default',
                    groupName: '我的好友',
                    friendCount: 0,
                    sortOrder: 0
                }
            ];
            // 统计每个分组的好友数量
            const buddies = await this.core.apis.FriendApi.getBuddy();
            if (buddies && Array.isArray(buddies)) {
                defaultGroups[0].friendCount = buddies.length;
            }
            else {
                defaultGroups[0].friendCount = 0;
            }
            // 更新缓存
            this.friendGroupsCache.set('all', defaultGroups);
            this.cacheTimestamps.set(cacheKey, Date.now());
            return defaultGroups;
        }
        catch (error) {
            this.core.context.logger.logError('[FriendInfoManager] 获取好友分组失败', error);
            return [];
        }
    }
    /**
     * 获取在线好友列表
     *
     * @returns 在线好友列表
     */
    async getOnlineFriends() {
        try {
            this.core.context.logger.log('[FriendInfoManager] 获取在线好友列表...');
            const buddies = await this.core.apis.FriendApi.getBuddy();
            const onlineBuddies = buddies ? buddies.filter(buddy => buddy.status && buddy.status.status === 1) : []; // 1表示在线
            // 获取在线好友的详细信息
            const detailPromises = onlineBuddies.map(buddy => this.getFriendDetailInfo(buddy.uid || '').catch(() => null));
            const results = await Promise.all(detailPromises);
            const onlineFriends = results.filter(result => result !== null);
            this.core.context.logger.log(`[FriendInfoManager] 在线好友: ${onlineFriends.length}/${buddies.length}`);
            return onlineFriends;
        }
        catch (error) {
            this.core.context.logger.logError('[FriendInfoManager] 获取在线好友失败', error);
            return [];
        }
    }
    /**
     * 获取好友关系信息（私有方法）
     */
    async getFriendRelationInfo(uid) {
        try {
            // 这里可以调用获取好友关系的API
            // 目前返回默认值
            return {
                chatDays: 0,
                intimacy: 0,
                isSpecialCare: false,
                isBlocked: false
            };
        }
        catch (error) {
            this.core.context.logger.logWarn(`[FriendInfoManager] 获取好友关系失败: ${uid}`, error);
            return null;
        }
    }
    /**
     * 检查缓存是否有效
     */
    isValidCache(cacheKey) {
        const timestamp = this.cacheTimestamps.get(cacheKey);
        if (!timestamp)
            return false;
        return (Date.now() - timestamp) < this.cacheExpiration;
    }
    /**
     * 格式化好友详细信息
     */
    formatFriendDetail(userDetail, relationResult) {
        const relation = relationResult.status === 'fulfilled' ? relationResult.value : null;
        // 解析在线状态
        let onlineStatus = 'offline';
        let isOnline = false;
        if (userDetail.status) {
            switch (userDetail.status) {
                case 1:
                    onlineStatus = 'online';
                    isOnline = true;
                    break;
                case 2:
                    onlineStatus = 'away';
                    isOnline = true;
                    break;
                case 3:
                    onlineStatus = 'busy';
                    isOnline = true;
                    break;
                case 4:
                    onlineStatus = 'invisible';
                    isOnline = false;
                    break;
                default:
                    onlineStatus = 'offline';
                    isOnline = false;
            }
        }
        // 解析性别
        let gender = 'unknown';
        if (userDetail.sex === 1) {
            gender = 'male';
        }
        else if (userDetail.sex === 2) {
            gender = 'female';
        }
        return {
            uid: userDetail.uid,
            uin: userDetail.uin,
            nick: userDetail.nick || userDetail.nickname || `用户${userDetail.uin}`,
            remark: userDetail.remark,
            avatarUrl: userDetail.avatarUrl,
            personalSign: userDetail.longNick || userDetail.personalNote,
            gender,
            age: userDetail.age,
            birthday: userDetail.birthday ? new Date(userDetail.birthday) : undefined,
            constellation: userDetail.constellation,
            bloodType: userDetail.bloodType,
            profession: userDetail.profession,
            company: userDetail.company,
            school: userDetail.school,
            hometown: userDetail.hometown,
            location: userDetail.location,
            email: userDetail.email,
            mobile: userDetail.mobile,
            qqLevel: userDetail.qqLevel,
            vipLevel: userDetail.vipLevel,
            isSuperVip: userDetail.isSuperVip,
            isBigVip: userDetail.isBigVip,
            isOnline,
            onlineStatus,
            clientType: userDetail.clientType,
            lastOnlineTime: userDetail.lastOnlineTime ? new Date(userDetail.lastOnlineTime) : undefined,
            friendSince: userDetail.friendSince ? new Date(userDetail.friendSince) : undefined,
            interaction: relation ? {
                chatDays: relation.chatDays,
                sentMessageCount: relation.sentMessageCount,
                receivedMessageCount: relation.receivedMessageCount,
                lastChatTime: relation.lastChatTime ? new Date(relation.lastChatTime) : undefined,
                intimacy: relation.intimacy,
                isSpecialCare: relation.isSpecialCare,
                isBlocked: relation.isBlocked,
                commonGroupCount: relation.commonGroupCount
            } : undefined,
            extInfo: {
                authentication: userDetail.authentication,
                socialTags: userDetail.socialTags || [],
                interests: userDetail.interests || [],
                personalTags: userDetail.personalTags || [],
                qzonePermission: userDetail.qzonePermission || 'private',
                allowFriendRequest: userDetail.allowFriendRequest !== false,
                friendSource: userDetail.friendSource
            }
        };
    }
    /**
     * 清除缓存
     */
    clearCache(uid) {
        if (uid) {
            // 清除特定好友的缓存
            this.friendInfoCache.delete(uid);
            this.cacheTimestamps.delete(`friend_${uid}`);
            this.core.context.logger.logDebug(`[FriendInfoManager] 好友${uid}的缓存已清除`);
        }
        else {
            // 清除所有缓存
            this.friendInfoCache.clear();
            this.friendGroupsCache.clear();
            this.cacheTimestamps.clear();
            this.core.context.logger.logDebug('[FriendInfoManager] 所有缓存已清除');
        }
    }
    /**
     * 获取缓存统计信息
     */
    getCacheStats() {
        return {
            friendInfoCount: this.friendInfoCache.size,
            groupsCount: this.friendGroupsCache.size,
            totalCacheSize: this.friendInfoCache.size + this.friendGroupsCache.size
        };
    }
}
//# sourceMappingURL=FriendInfoManager.js.map