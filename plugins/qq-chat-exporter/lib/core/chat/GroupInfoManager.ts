/**
 * 群组信息管理器
 * 负责获取和管理QQ群组的详细信息，包括群成员、群设置、群荣誉等
 * 使用NapCat的底层API获取完整的群组数据
 */

import { SystemError, ErrorType } from '../../types/index.js';
import { NapCatCore } from 'NapCatQQ/src/core/index.js';

/**
 * 群组详细信息接口
 */
export interface GroupDetailInfo {
    /** 群号 */
    groupCode: string;
    /** 群名称 */
    groupName: string;
    /** 群头像 */
    avatarUrl?: string;
    /** 群简介 */
    introduction?: string;
    /** 群公告 */
    announcement?: string;
    /** 群创建时间 */
    createTime?: Date;
    /** 群等级 */
    groupLevel?: number;
    /** 群最大成员数 */
    maxMemberCount: number;
    /** 当前成员数 */
    currentMemberCount: number;
    /** 群主信息 */
    owner?: GroupMemberInfo;
    /** 管理员列表 */
    admins?: GroupMemberInfo[];
    /** 群设置 */
    settings?: GroupSettings;
    /** 群标签 */
    tags?: string[];
    /** 群地理位置 */
    location?: string;
    /** 群分类 */
    category?: string;
    /** 是否已满员 */
    isFull: boolean;
    /** 最后活跃时间 */
    lastActiveTime?: Date;
}

/**
 * 群成员信息接口
 */
export interface GroupMemberInfo {
    /** 用户ID */
    uid: string;
    /** QQ号 */
    uin?: string;
    /** 昵称 */
    nick: string;
    /** 群名片 */
    cardName?: string;
    /** 头像URL */
    avatarUrl?: string;
    /** 角色 */
    role: 'owner' | 'admin' | 'member';
    /** 入群时间 */
    joinTime?: Date;
    /** 最后发言时间 */
    lastSpeakTime?: Date;
    /** 群等级 */
    memberLevel?: number;
    /** 头衔 */
    specialTitle?: string;
    /** 是否在线 */
    isOnline?: boolean;
    /** 是否被禁言 */
    isMuted?: boolean;
    /** 禁言结束时间 */
    muteEndTime?: Date;
}

/**
 * 群设置接口
 */
export interface GroupSettings {
    /** 是否允许非管理员邀请 */
    allowMemberInvite: boolean;
    /** 是否需要验证 */
    requireApproval: boolean;
    /** 是否允许匿名聊天 */
    allowAnonymousChat: boolean;
    /** 是否开启群聊天记录 */
    enableChatHistory: boolean;
    /** 是否允许临时会话 */
    allowTempSession: boolean;
    /** 全员禁言状态 */
    isAllMuted: boolean;
}

/**
 * 群荣誉信息接口
 */
export interface GroupHonorInfo {
    /** 群ID */
    groupId: string;
    /** 龙王列表 */
    talkativeList: GroupHonorMember[];
    /** 当前龙王 */
    currentTalkative?: GroupHonorMember;
    /** 群聊之火 */
    performerList: GroupHonorMember[];
    /** 群聊炽焰 */
    legendList: GroupHonorMember[];
    /** 冒尖小春笋 */
    strongNewbieList: GroupHonorMember[];
    /** 快乐之源 */
    emotionList: GroupHonorMember[];
}

/**
 * 群荣誉成员接口
 */
export interface GroupHonorMember {
    /** QQ号 */
    uin: string;
    /** 昵称 */
    name: string;
    /** 头像 */
    avatar: string;
    /** 描述 */
    desc: string;
}

/**
 * 群组信息管理器类
 * 提供获取、格式化和管理群组详细信息的功能
 */
export class GroupInfoManager {
    private readonly core: NapCatCore;
    
    /** 群信息缓存 */
    private groupInfoCache: Map<string, GroupDetailInfo> = new Map();
    
    /** 群成员缓存 */
    private groupMembersCache: Map<string, GroupMemberInfo[]> = new Map();
    
    /** 群荣誉缓存 */
    private groupHonorCache: Map<string, GroupHonorInfo> = new Map();
    
    /** 缓存过期时间（毫秒） */
    private readonly cacheExpiration = 10 * 60 * 1000; // 10分钟
    
    /** 缓存时间戳 */
    private cacheTimestamps: Map<string, number> = new Map();

    /**
     * 构造函数
     * @param core NapCat核心实例
     */
    constructor(core: NapCatCore) {
        this.core = core;
    }

    /**
     * 获取群组详细信息
     * 
     * @param groupCode 群号
     * @param forceRefresh 强制刷新缓存
     * @returns 群组详细信息
     */
    async getGroupDetailInfo(groupCode: string, forceRefresh = false): Promise<GroupDetailInfo | null> {
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

        } catch (error) {
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
    async getGroupMembers(groupCode: string, forceRefresh = false): Promise<GroupMemberInfo[]> {
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

        } catch (error) {
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
    async getGroupHonors(groupCode: string, forceRefresh = false): Promise<GroupHonorInfo | null> {
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
            const honorInfo: GroupHonorInfo = {
                groupId: groupCode,
                currentTalkative: honors.current_talkative as GroupHonorMember,
                talkativeList: honors.talkative_list as GroupHonorMember[],
                performerList: honors.performer_list as GroupHonorMember[],
                legendList: honors.legend_list as GroupHonorMember[],
                emotionList: honors.emotion_list as GroupHonorMember[],
                strongNewbieList: honors.strong_newbie_list as GroupHonorMember[]
            };
            
            // 更新缓存
            this.groupHonorCache.set(groupCode, honorInfo);
            this.cacheTimestamps.set(cacheKey, Date.now());

            this.core.context.logger.log(`[GroupInfoManager] 群荣誉信息获取成功: ${groupCode}`);
            return honorInfo;

        } catch (error) {
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
    async searchGroupMembers(groupCode: string, keyword: string): Promise<GroupMemberInfo[]> {
        try {
            const members = await this.getGroupMembers(groupCode);
            const lowercaseKeyword = keyword.toLowerCase();

            return members.filter(member => 
                member.nick.toLowerCase().includes(lowercaseKeyword) ||
                (member.cardName && member.cardName.toLowerCase().includes(lowercaseKeyword)) ||
                (member.uin && member.uin.includes(keyword)) ||
                (member.uid && member.uid.toLowerCase().includes(lowercaseKeyword))
            );

        } catch (error) {
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
    async getGroupAdmins(groupCode: string): Promise<GroupMemberInfo[]> {
        try {
            const members = await this.getGroupMembers(groupCode);
            return members.filter(member => member.role === 'owner' || member.role === 'admin');

        } catch (error) {
            this.core.context.logger.logError(`[GroupInfoManager] 获取群管理员失败: ${groupCode}`, error);
            return [];
        }
    }

    /**
     * 检查缓存是否有效
     */
    private isValidCache(cacheKey: string): boolean {
        const timestamp = this.cacheTimestamps.get(cacheKey);
        if (!timestamp) return false;
        
        return (Date.now() - timestamp) < this.cacheExpiration;
    }

    /**
     * 格式化群组详细信息
     */
    private async formatGroupDetail(
        groupDetail: any, 
        membersResult: PromiseSettledResult<GroupMemberInfo[]>,
        honorsResult: PromiseSettledResult<GroupHonorInfo | null>
    ): Promise<GroupDetailInfo> {
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
    private formatGroupMember(member: any): GroupMemberInfo {
        let role: 'owner' | 'admin' | 'member' = 'member';
        
        if (member.role === 4) {
            role = 'owner';
        } else if (member.role === 3) {
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
    clearCache(groupCode?: string): void {
        if (groupCode) {
            // 清除特定群的缓存
            this.groupInfoCache.delete(groupCode);
            this.groupMembersCache.delete(groupCode);
            this.groupHonorCache.delete(groupCode);
            this.cacheTimestamps.delete(`detail_${groupCode}`);
            this.cacheTimestamps.delete(`members_${groupCode}`);
            this.cacheTimestamps.delete(`honors_${groupCode}`);
            this.core.context.logger.logDebug(`[GroupInfoManager] 群${groupCode}的缓存已清除`);
        } else {
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
    getCacheStats(): {
        groupInfoCount: number;
        membersCount: number;
        honorsCount: number;
        totalCacheSize: number;
    } {
        return {
            groupInfoCount: this.groupInfoCache.size,
            membersCount: this.groupMembersCache.size,
            honorsCount: this.groupHonorCache.size,
            totalCacheSize: this.groupInfoCache.size + this.groupMembersCache.size + this.groupHonorCache.size
        };
    }
}