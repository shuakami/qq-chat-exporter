/**
 * 群组信息管理器
 * 负责获取和管理QQ群组的详细信息，包括群成员、群设置、群荣誉等
 * 使用NapCat的底层API获取完整的群组数据
 */
import { SystemError, ErrorType } from '../../types.js';
import { NapCatCore } from 'NapCatQQ/src/core/index.js';
/**
 * 群组信息管理器类
 * 提供获取、格式化和管理群组详细信息的功能
 */
export class GroupInfoManager {
    core;
    /** 群信息缓存 */
    groupInfoCache = new Map();
    /** 群成员缓存 */
    groupMembersCache = new Map();
    /** 群荣誉缓存 */
    groupHonorCache = new Map();
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
     * 获取群组详细信息
     *
     * @param groupCode 群号
     * @param forceRefresh 强制刷新缓存
     * @returns 群组详细信息
     */
    async getGroupDetailInfo(groupCode, forceRefresh = false) {
        try {
            const cacheKey = `detail_${groupCode}`;
            // 检查缓存
            if (!forceRefresh && this.isValidCache(cacheKey)) {
                this.core.context.logger.logDebug(`[GroupInfoManager] 使用缓存的群组信息: ${groupCode}`);
                return this.groupInfoCache.get(groupCode) || null;
            }
            this.core.context.logger.log(`[GroupInfoManager] 获取群组详细信息: ${groupCode}`);
            // 使用NapCat API获取群详细信息
            const groupDetail = await this.core.apis.GroupApi.fetchGroupDetail(groupCode);
            if (!groupDetail) {
                this.core.context.logger.logWarn(`[GroupInfoManager] 获取群组信息失败: ${groupCode}`);
                return null;
            }
            // 并行获取群成员和群荣誉
            const [members, honors] = await Promise.allSettled([
                this.getGroupMembers(groupCode, true),
                this.getGroupHonors(groupCode, true)
            ]);
            // 格式化群组信息
            const detailInfo = await this.formatGroupDetail(groupDetail, members, honors);
            // 更新缓存
            this.groupInfoCache.set(groupCode, detailInfo);
            this.cacheTimestamps.set(cacheKey, Date.now());
            this.core.context.logger.log(`[GroupInfoManager] 群组信息获取成功: ${groupCode} (${detailInfo.groupName})`);
            return detailInfo;
        }
        catch (error) {
            this.core.context.logger.logError(`[GroupInfoManager] 获取群组详细信息失败: ${groupCode}`, error);
            throw new SystemError({
                type: ErrorType.API_ERROR,
                message: '获取群组详细信息失败',
                details: error,
                timestamp: new Date(),
                context: { groupCode, operation: 'getGroupDetailInfo' }
            });
        }
    }
    /**
     * 获取群成员列表
     *
     * @param groupCode 群号
     * @param forceRefresh 强制刷新缓存
     * @returns 群成员列表
     */
    async getGroupMembers(groupCode, forceRefresh = false) {
        try {
            const cacheKey = `members_${groupCode}`;
            // 检查缓存
            if (!forceRefresh && this.isValidCache(cacheKey)) {
                this.core.context.logger.logDebug(`[GroupInfoManager] 使用缓存的群成员信息: ${groupCode}`);
                return this.groupMembersCache.get(groupCode) || [];
            }
            this.core.context.logger.log(`[GroupInfoManager] 获取群成员列表: ${groupCode}`);
            // 使用WebAPI获取群成员（更详细的信息）
            const webMembers = await this.core.apis.WebApi.getGroupMembers(groupCode);
            if (!webMembers || webMembers.length === 0) {
                this.core.context.logger.logWarn(`[GroupInfoManager] 未获取到群成员: ${groupCode}`);
                return [];
            }
            // 格式化成员信息
            const members = webMembers.map(member => this.formatGroupMember(member));
            // 更新缓存
            this.groupMembersCache.set(groupCode, members);
            this.cacheTimestamps.set(cacheKey, Date.now());
            this.core.context.logger.log(`[GroupInfoManager] 群成员获取成功: ${groupCode} (${members.length}人)`);
            return members;
        }
        catch (error) {
            this.core.context.logger.logError(`[GroupInfoManager] 获取群成员失败: ${groupCode}`, error);
            return [];
        }
    }
    /**
     * 获取群荣誉信息
     *
     * @param groupCode 群号
     * @param forceRefresh 强制刷新缓存
     * @returns 群荣誉信息
     */
    async getGroupHonors(groupCode, forceRefresh = false) {
        try {
            const cacheKey = `honors_${groupCode}`;
            // 检查缓存
            if (!forceRefresh && this.isValidCache(cacheKey)) {
                this.core.context.logger.logDebug(`[GroupInfoManager] 使用缓存的群荣誉信息: ${groupCode}`);
                return this.groupHonorCache.get(groupCode) || null;
            }
            this.core.context.logger.log(`[GroupInfoManager] 获取群荣誉信息: ${groupCode}`);
            // 使用WebAPI获取群荣誉
            const { WebHonorType } = await import('../../../core/types/webapi');
            const honors = await this.core.apis.WebApi.getGroupHonorInfo(groupCode, WebHonorType.ALL);
            if (!honors) {
                this.core.context.logger.logWarn(`[GroupInfoManager] 未获取到群荣誉信息: ${groupCode}`);
                return null;
            }
            // 格式化荣誉信息
            const honorInfo = {
                groupId: groupCode,
                currentTalkative: honors.current_talkative,
                talkativeList: honors.talkative_list,
                performerList: honors.performer_list,
                legendList: honors.legend_list,
                emotionList: honors.emotion_list,
                strongNewbieList: honors.strong_newbie_list
            };
            // 更新缓存
            this.groupHonorCache.set(groupCode, honorInfo);
            this.cacheTimestamps.set(cacheKey, Date.now());
            this.core.context.logger.log(`[GroupInfoManager] 群荣誉信息获取成功: ${groupCode}`);
            return honorInfo;
        }
        catch (error) {
            this.core.context.logger.logError(`[GroupInfoManager] 获取群荣誉信息失败: ${groupCode}`, error);
            return null;
        }
    }
    /**
     * 搜索群成员
     *
     * @param groupCode 群号
     * @param keyword 搜索关键词
     * @returns 匹配的群成员列表
     */
    async searchGroupMembers(groupCode, keyword) {
        try {
            const members = await this.getGroupMembers(groupCode);
            const lowercaseKeyword = keyword.toLowerCase();
            return members.filter(member => member.nick.toLowerCase().includes(lowercaseKeyword) ||
                (member.cardName && member.cardName.toLowerCase().includes(lowercaseKeyword)) ||
                (member.uin && member.uin.includes(keyword)) ||
                (member.uid && member.uid.toLowerCase().includes(lowercaseKeyword)));
        }
        catch (error) {
            this.core.context.logger.logError(`[GroupInfoManager] 搜索群成员失败: ${groupCode}, keyword: ${keyword}`, error);
            return [];
        }
    }
    /**
     * 获取群管理员列表
     *
     * @param groupCode 群号
     * @returns 管理员列表（包括群主）
     */
    async getGroupAdmins(groupCode) {
        try {
            const members = await this.getGroupMembers(groupCode);
            return members.filter(member => member.role === 'owner' || member.role === 'admin');
        }
        catch (error) {
            this.core.context.logger.logError(`[GroupInfoManager] 获取群管理员失败: ${groupCode}`, error);
            return [];
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
     * 格式化群组详细信息
     */
    async formatGroupDetail(groupDetail, membersResult, honorsResult) {
        const members = membersResult.status === 'fulfilled' ? membersResult.value : [];
        const honors = honorsResult.status === 'fulfilled' ? honorsResult.value : null;
        // 查找群主和管理员
        const owner = members.find(m => m.role === 'owner');
        const admins = members.filter(m => m.role === 'admin');
        return {
            groupCode: groupDetail.groupCode,
            groupName: groupDetail.groupName || `群聊 ${groupDetail.groupCode}`,
            avatarUrl: groupDetail.avatarUrl,
            introduction: groupDetail.richFingerMemo || groupDetail.groupInfo,
            announcement: groupDetail.groupBulletin,
            createTime: groupDetail.createTime ? new Date(groupDetail.createTime * 1000) : undefined,
            groupLevel: groupDetail.groupLevel,
            maxMemberCount: groupDetail.maxMember || 500,
            currentMemberCount: groupDetail.memberCount || members.length,
            owner,
            admins,
            settings: {
                allowMemberInvite: groupDetail.allowMemberInvite !== false,
                requireApproval: groupDetail.joinOption === 1, // 1表示需要验证
                allowAnonymousChat: groupDetail.allowAnonymousChat !== false,
                enableChatHistory: groupDetail.enableHistory !== false,
                allowTempSession: groupDetail.allowTempSession !== false,
                isAllMuted: groupDetail.shutUpAllMember === true
            },
            tags: groupDetail.tags || [],
            location: groupDetail.location,
            category: groupDetail.groupClassExt?.groupInfoExtSeq?.groupClassification,
            isFull: members.length >= (groupDetail.maxMember || 500),
            lastActiveTime: groupDetail.lastMsgTime ? new Date(groupDetail.lastMsgTime * 1000) : undefined
        };
    }
    /**
     * 格式化群成员信息
     */
    formatGroupMember(member) {
        let role = 'member';
        if (member.role === 4) {
            role = 'owner';
        }
        else if (member.role === 3) {
            role = 'admin';
        }
        return {
            uid: member.uin, // WebAPI返回的是uin
            uin: member.uin,
            nick: member.nick || member.name || `用户${member.uin}`,
            cardName: member.card || undefined,
            avatarUrl: member.avatar,
            role,
            joinTime: member.join_time ? new Date(member.join_time * 1000) : undefined,
            lastSpeakTime: member.last_speak_time ? new Date(member.last_speak_time * 1000) : undefined,
            memberLevel: member.level,
            specialTitle: member.title || undefined,
            isOnline: member.status === 1,
            isMuted: member.shut_up_timestap > Date.now() / 1000,
            muteEndTime: member.shut_up_timestap > Date.now() / 1000 ? new Date(member.shut_up_timestap * 1000) : undefined
        };
    }
    /**
     * 清除缓存
     */
    clearCache(groupCode) {
        if (groupCode) {
            // 清除特定群的缓存
            this.groupInfoCache.delete(groupCode);
            this.groupMembersCache.delete(groupCode);
            this.groupHonorCache.delete(groupCode);
            this.cacheTimestamps.delete(`detail_${groupCode}`);
            this.cacheTimestamps.delete(`members_${groupCode}`);
            this.cacheTimestamps.delete(`honors_${groupCode}`);
            this.core.context.logger.logDebug(`[GroupInfoManager] 群${groupCode}的缓存已清除`);
        }
        else {
            // 清除所有缓存
            this.groupInfoCache.clear();
            this.groupMembersCache.clear();
            this.groupHonorCache.clear();
            this.cacheTimestamps.clear();
            this.core.context.logger.logDebug('[GroupInfoManager] 所有缓存已清除');
        }
    }
    /**
     * 获取缓存统计信息
     */
    getCacheStats() {
        return {
            groupInfoCount: this.groupInfoCache.size,
            membersCount: this.groupMembersCache.size,
            honorsCount: this.groupHonorCache.size,
            totalCacheSize: this.groupInfoCache.size + this.groupMembersCache.size + this.groupHonorCache.size
        };
    }
}
//# sourceMappingURL=GroupInfoManager.js.map