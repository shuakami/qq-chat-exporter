/**
 * 通过 QQ 号反查 NTQQ uid，并附带尽量多的展示信息（issue #204）。
 *
 * 抽出来的目的是把所有「容错 / 降级」分支单独覆盖单元测试，避免回到
 * issue #353 那种「getUidByUinV2 不存在导致整条路径 500」的回归。
 *
 * 实际行为：
 *   - 非法 uin 直接返回 found=false + reason；
 *   - getUidByUinV2 不存在 / 抛异常 / 返回空 → found=false + reason；
 *   - 拿到 uid 后再尝试 getUserDetailInfo 取昵称 / 备注，失败时不影响主流程；
 *   - 已加好友时 isFriend=true，否则 false（销号 / 已删除 / 临时会话都会是 false）。
 */

export interface UserApiLikeForLookup {
    getUidByUinV2?: (uin: string) => Promise<string | undefined | null>;
    getUserDetailInfo?: (uid: string, noCache: boolean) => Promise<any>;
}

export interface FriendApiLikeForLookup {
    getBuddyV2ExWithCate?: () => Promise<Array<{ buddyList?: any[] }> | undefined | null>;
}

export interface LookupLogger {
    logWarn?: (msg: string, err?: unknown) => void;
    logDebug?: (msg: string, err?: unknown) => void;
}

export interface UserLookupResult {
    found: boolean;
    uin: string;
    uid?: string;
    nick?: string;
    remark?: string;
    avatarUrl?: string;
    isFriend?: boolean;
    reason?: string;
}

const UIN_REGEX = /^\d{4,12}$/;

export async function lookupUserByUin(
    rawUin: string,
    userApi: UserApiLikeForLookup | undefined | null,
    friendApi: FriendApiLikeForLookup | undefined | null,
    logger?: LookupLogger,
): Promise<UserLookupResult> {
    const uin = (rawUin ?? '').trim();
    if (!UIN_REGEX.test(uin)) {
        return {
            found: false,
            uin,
            reason: 'uin 必须是 4-12 位的数字 QQ 号',
        };
    }

    const lookupFn = userApi?.getUidByUinV2;
    if (typeof lookupFn !== 'function') {
        return {
            found: false,
            uin,
            reason: '当前 NapCat 版本未提供 getUidByUinV2，无法按 QQ 号查询',
        };
    }

    let uid: string | null = null;
    try {
        const resolved = await lookupFn.call(userApi, uin);
        if (resolved) uid = String(resolved);
    } catch (e) {
        logger?.logWarn?.(`getUidByUinV2(${uin}) 抛异常`, e);
    }

    if (!uid) {
        return {
            found: false,
            uin,
            reason:
                '该 QQ 号未在本机 NTQQ 数据中找到对应 uid（可能从未与之产生过聊天，或对方账号已彻底注销）',
        };
    }

    let nick: string | undefined;
    let remark: string | undefined;
    try {
        const detail = await userApi?.getUserDetailInfo?.(uid, false);
        if (detail) {
            nick =
                detail.nick ||
                detail.nickName ||
                detail?.simpleInfo?.coreInfo?.nick ||
                undefined;
            remark =
                detail.remark ||
                detail?.simpleInfo?.coreInfo?.remark ||
                undefined;
        }
    } catch (e) {
        // 销号后 getUserDetailInfo 经常会失败，吞掉让前端用 uin 兜底显示。
        logger?.logDebug?.(`getUserDetailInfo(${uid}) 失败，忽略`, e);
    }

    let isFriend = false;
    try {
        const categories = await friendApi?.getBuddyV2ExWithCate?.();
        if (Array.isArray(categories)) {
            const flat = categories.flatMap((cat) => cat?.buddyList || []);
            isFriend = flat.some(
                (f: any) =>
                    String(f?.uid || f?.coreInfo?.uid || '') === uid ||
                    String(f?.uin || f?.coreInfo?.uin || '') === uin,
            );
        }
    } catch (e) {
        logger?.logDebug?.('好友列表读取失败，跳过 isFriend 判定', e);
    }

    return {
        found: true,
        uin,
        uid,
        nick,
        remark,
        avatarUrl: `https://q1.qlogo.cn/g?b=qq&nk=${uin}&s=640`,
        isFriend,
    };
}
