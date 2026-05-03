/**
 * 在导出任务创建阶段把 peer 解析成对人友好的会话名（issue #365）。
 *
 * 这一段以前内联在 ApiServer 三个导出端点里，写法都是
 *   if (chatType === 1) { 找好友 } else if (chatType === 2) { 找群 } else { 用 uid }
 *
 * 临时会话（chatType=100）、官方 Bot 服务号（118 / 201）等本质上还是单聊，
 * 但落到 `else` 分支后只会拿到一个裸 uid，导出文件名 / 任务列表里看着像
 * 一长串乱码。本模块把分支统一收敛：
 *   - chatType === 2  → 走群列表；
 *   - 其它任何 chatType → 优先用好友缓存（若 uid 在好友里）；
 *     再试 UserApi.getUserDetailInfo 拿昵称（覆盖临时会话 / 销号好友 / 服务号）；
 *     最后兜底 fallback（默认就是 peerUid）。
 *
 * 任意一步抛异常都吞掉，让导出主流程继续，不再因为「连个名字都查不到」就把
 * 整个任务卡住。
 */

import { isPrivateLikeChatType } from './chatTypeClassification.js';

export interface PeerLikeForName {
    chatType: number;
    peerUid: string;
}

export interface FriendApiLikeForName {
    getBuddy?: () => Promise<any[] | undefined | null>;
}

export interface GroupApiLikeForName {
    getGroups?: () => Promise<any[] | undefined | null>;
}

export interface UserApiLikeForName {
    getUserDetailInfo?: (uid: string, noCache?: boolean) => Promise<any>;
}

export interface CoreApisForName {
    FriendApi?: FriendApiLikeForName | null;
    GroupApi?: GroupApiLikeForName | null;
    UserApi?: UserApiLikeForName | null;
}

export interface ResolveSessionNameOptions {
    /** 单步查询超时（ms），默认 2000，和原来内联实现一致。 */
    timeoutMs?: number;
    /** 兜底名称，默认是 `peer.peerUid`。 */
    fallback?: string;
}

const DEFAULT_TIMEOUT = 2000;

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
    return new Promise<T>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('获取会话名称超时')), ms);
        p.then(
            (v) => {
                clearTimeout(timer);
                resolve(v);
            },
            (e) => {
                clearTimeout(timer);
                reject(e);
            },
        );
    });
}

async function tryFriendName(
    friendApi: FriendApiLikeForName | undefined | null,
    peerUid: string,
): Promise<string | undefined> {
    if (typeof friendApi?.getBuddy !== 'function') return undefined;
    const friends = await friendApi.getBuddy.call(friendApi);
    if (!Array.isArray(friends)) return undefined;
    const friend = friends.find((f: any) => f?.coreInfo?.uid === peerUid);
    return friend?.coreInfo?.remark || friend?.coreInfo?.nick || undefined;
}

async function tryGroupName(
    groupApi: GroupApiLikeForName | undefined | null,
    peerUid: string,
): Promise<string | undefined> {
    if (typeof groupApi?.getGroups !== 'function') return undefined;
    const groups = await groupApi.getGroups.call(groupApi);
    if (!Array.isArray(groups)) return undefined;
    const group = groups.find(
        (g: any) =>
            g?.groupCode === peerUid ||
            String(g?.groupCode ?? '') === String(peerUid),
    );
    return group?.groupName || undefined;
}

async function tryUserDetailName(
    userApi: UserApiLikeForName | undefined | null,
    peerUid: string,
): Promise<string | undefined> {
    if (typeof userApi?.getUserDetailInfo !== 'function') return undefined;
    const detail = await userApi.getUserDetailInfo.call(userApi, peerUid, false);
    if (!detail) return undefined;
    return (
        detail.remark ||
        detail.nick ||
        detail.nickName ||
        detail?.simpleInfo?.coreInfo?.remark ||
        detail?.simpleInfo?.coreInfo?.nick ||
        undefined
    );
}

/**
 * 根据 peer.chatType 走最合适的查找路径，把找到的展示名返回；任意异常都吞掉，
 * 最终至少返回 `options.fallback ?? peer.peerUid`。
 */
export async function resolveSessionName(
    peer: PeerLikeForName,
    apis: CoreApisForName | undefined | null,
    options: ResolveSessionNameOptions = {},
): Promise<string> {
    const fallback = options.fallback ?? peer.peerUid;
    const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT;

    if (!isPrivateLikeChatType(peer.chatType)) {
        try {
            const name = await withTimeout(
                tryGroupName(apis?.GroupApi, peer.peerUid).then(
                    (v) => v ?? `群聊 ${peer.peerUid}`,
                ),
                timeoutMs,
            );
            return name || fallback;
        } catch {
            return `群聊 ${peer.peerUid}`;
        }
    }

    // 单聊型会话（好友 / 临时会话 / 服务号 / 频道私聊等）：先看好友缓存，再
    // 兜底到 UserApi.getUserDetailInfo，最后回退到 peerUid。
    try {
        return await withTimeout(
            (async () => {
                const fromFriend = await tryFriendName(apis?.FriendApi, peer.peerUid).catch(
                    () => undefined,
                );
                if (fromFriend) return fromFriend;
                const fromDetail = await tryUserDetailName(apis?.UserApi, peer.peerUid).catch(
                    () => undefined,
                );
                if (fromDetail) return fromDetail;
                return fallback;
            })(),
            timeoutMs,
        );
    } catch {
        return fallback;
    }
}
