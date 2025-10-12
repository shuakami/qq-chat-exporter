/**
 * 群组信息管理器
 * 负责获取和管理QQ群组的详细信息，包括群成员、群设置、群荣誉等
 * 使用NapCat的底层API获取完整的群组数据
 */
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
export declare class GroupInfoManager {
    private readonly core;
    /** 群信息缓存 */
    private groupInfoCache;
    /** 群成员缓存 */
    private groupMembersCache;
    /** 群荣誉缓存 */
    private groupHonorCache;
    /** 缓存过期时间（毫秒） */
    private readonly cacheExpiration;
    /** 缓存时间戳 */
    private cacheTimestamps;
    /**
     * 构造函数
     * @param core NapCat核心实例
     */
    constructor(core: NapCatCore);
    /**
     * 获取群组详细信息
     *
     * @param groupCode 群号
     * @param forceRefresh 强制刷新缓存
     * @returns 群组详细信息
     */
    getGroupDetailInfo(groupCode: string, forceRefresh?: boolean): Promise<GroupDetailInfo | null>;
    /**
     * 获取群成员列表
     *
     * @param groupCode 群号
     * @param forceRefresh 强制刷新缓存
     * @returns 群成员列表
     */
    getGroupMembers(groupCode: string, forceRefresh?: boolean): Promise<GroupMemberInfo[]>;
    /**
     * 获取群荣誉信息
     *
     * @param groupCode 群号
     * @param forceRefresh 强制刷新缓存
     * @returns 群荣誉信息
     */
    getGroupHonors(groupCode: string, forceRefresh?: boolean): Promise<GroupHonorInfo | null>;
    /**
     * 搜索群成员
     *
     * @param groupCode 群号
     * @param keyword 搜索关键词
     * @returns 匹配的群成员列表
     */
    searchGroupMembers(groupCode: string, keyword: string): Promise<GroupMemberInfo[]>;
    /**
     * 获取群管理员列表
     *
     * @param groupCode 群号
     * @returns 管理员列表（包括群主）
     */
    getGroupAdmins(groupCode: string): Promise<GroupMemberInfo[]>;
    /**
     * 检查缓存是否有效
     */
    private isValidCache;
    /**
     * 格式化群组详细信息
     */
    private formatGroupDetail;
    /**
     * 格式化群成员信息
     */
    private formatGroupMember;
    /**
     * 清除缓存
     */
    clearCache(groupCode?: string): void;
    /**
     * 获取缓存统计信息
     */
    getCacheStats(): {
        groupInfoCount: number;
        membersCount: number;
        honorsCount: number;
        totalCacheSize: number;
    };
}
//# sourceMappingURL=GroupInfoManager.d.ts.map