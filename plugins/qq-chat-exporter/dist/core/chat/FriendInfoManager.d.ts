/**
 * 好友信息管理器
 * 负责获取和管理QQ好友的详细信息，包括个人资料、在线状态、关系等
 * 使用NapCat的底层API获取完整的好友数据
 */
import { NapCatCore } from 'NapCatQQ/src/core/index.js';
/**
 * 好友详细信息接口
 */
export interface FriendDetailInfo {
    /** 用户ID */
    uid: string;
    /** QQ号 */
    uin?: string;
    /** 昵称 */
    nick: string;
    /** 备注名 */
    remark?: string;
    /** 头像URL */
    avatarUrl?: string;
    /** 个性签名 */
    personalSign?: string;
    /** 性别 */
    gender?: 'male' | 'female' | 'unknown';
    /** 年龄 */
    age?: number;
    /** 生日 */
    birthday?: Date;
    /** 星座 */
    constellation?: string;
    /** 血型 */
    bloodType?: string;
    /** 职业 */
    profession?: string;
    /** 公司 */
    company?: string;
    /** 学校 */
    school?: string;
    /** 家乡 */
    hometown?: string;
    /** 现居地 */
    location?: string;
    /** 邮箱 */
    email?: string;
    /** 手机号（如果公开） */
    mobile?: string;
    /** QQ等级 */
    qqLevel?: number;
    /** VIP等级 */
    vipLevel?: number;
    /** 是否为超级会员 */
    isSuperVip?: boolean;
    /** 是否为大会员 */
    isBigVip?: boolean;
    /** 是否在线 */
    isOnline?: boolean;
    /** 在线状态 */
    onlineStatus?: 'online' | 'busy' | 'away' | 'invisible' | 'offline';
    /** 客户端类型 */
    clientType?: string;
    /** 最后在线时间 */
    lastOnlineTime?: Date;
    /** 好友关系建立时间 */
    friendSince?: Date;
    /** 互动信息 */
    interaction?: FriendInteraction;
    /** 扩展信息 */
    extInfo?: FriendExtInfo;
}
/**
 * 好友互动信息接口
 */
export interface FriendInteraction {
    /** 聊天天数 */
    chatDays?: number;
    /** 发送消息数 */
    sentMessageCount?: number;
    /** 接收消息数 */
    receivedMessageCount?: number;
    /** 最后聊天时间 */
    lastChatTime?: Date;
    /** 亲密度 */
    intimacy?: number;
    /** 是否特别关心 */
    isSpecialCare?: boolean;
    /** 是否被拉黑 */
    isBlocked?: boolean;
    /** 共同群聊数量 */
    commonGroupCount?: number;
}
/**
 * 好友扩展信息接口
 */
export interface FriendExtInfo {
    /** 认证信息 */
    authentication?: string;
    /** 社交标签 */
    socialTags?: string[];
    /** 兴趣爱好 */
    interests?: string[];
    /** 个人标签 */
    personalTags?: string[];
    /** 空间权限 */
    qzonePermission?: 'public' | 'friends' | 'private';
    /** 是否允许添加好友 */
    allowFriendRequest?: boolean;
    /** 来源 */
    friendSource?: string;
}
/**
 * 好友分组信息接口
 */
export interface FriendGroup {
    /** 分组ID */
    groupId: string;
    /** 分组名称 */
    groupName: string;
    /** 分组中的好友数量 */
    friendCount: number;
    /** 分组顺序 */
    sortOrder: number;
}
/**
 * 好友信息管理器类
 * 提供获取、格式化和管理好友详细信息的功能
 */
export declare class FriendInfoManager {
    private readonly core;
    /** 好友信息缓存 */
    private friendInfoCache;
    /** 好友分组缓存 */
    private friendGroupsCache;
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
     * 获取好友详细信息
     *
     * @param uid 好友UID
     * @param forceRefresh 强制刷新缓存
     * @returns 好友详细信息
     */
    getFriendDetailInfo(uid: string, forceRefresh?: boolean): Promise<FriendDetailInfo | null>;
    /**
     * 批量获取好友信息
     *
     * @param uids 好友UID列表
     * @param forceRefresh 强制刷新缓存
     * @returns 好友信息列表
     */
    getBatchFriendInfo(uids: string[], forceRefresh?: boolean): Promise<FriendDetailInfo[]>;
    /**
     * 搜索好友
     *
     * @param keyword 搜索关键词
     * @returns 匹配的好友列表
     */
    searchFriends(keyword: string): Promise<FriendDetailInfo[]>;
    /**
     * 获取好友分组信息
     *
     * @param forceRefresh 强制刷新缓存
     * @returns 好友分组列表
     */
    getFriendGroups(forceRefresh?: boolean): Promise<FriendGroup[]>;
    /**
     * 获取在线好友列表
     *
     * @returns 在线好友列表
     */
    getOnlineFriends(): Promise<FriendDetailInfo[]>;
    /**
     * 获取好友关系信息（私有方法）
     */
    private getFriendRelationInfo;
    /**
     * 检查缓存是否有效
     */
    private isValidCache;
    /**
     * 格式化好友详细信息
     */
    private formatFriendDetail;
    /**
     * 清除缓存
     */
    clearCache(uid?: string): void;
    /**
     * 获取缓存统计信息
     */
    getCacheStats(): {
        friendInfoCount: number;
        groupsCount: number;
        totalCacheSize: number;
    };
}
//# sourceMappingURL=FriendInfoManager.d.ts.map