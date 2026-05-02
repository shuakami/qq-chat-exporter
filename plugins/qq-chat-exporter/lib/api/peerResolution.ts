/**
 * 私聊导出时把数字 QQ 号解析为真正的 NTQQ uid。
 *
 * 旧版 NapCat / 部分 QQNT 客户端没有 UserApi.getUidByUinV2，旧实现里直接调用
 * 会抛 TypeError 让整条导出路径返回 500（issue #353）。这里把解析过程隔离，
 * 任何缺失 / 异常 / 空返回都安全降级到原始 peerUid，让下游用 QQ 号继续尝试。
 */
export interface PeerLike {
    chatType: number;
    peerUid: string;
}

export interface UserApiLike {
    getUidByUinV2?: (uin: string) => Promise<string | undefined | null>;
}

export interface LoggerLike {
    log: (msg: string) => void;
}

const PRIVATE_CHAT = 1;

export async function resolvePeerUid(
    peer: PeerLike,
    userApi: UserApiLike | undefined | null,
    logger?: LoggerLike,
): Promise<string> {
    if (peer.chatType !== PRIVATE_CHAT || !/^\d+$/.test(peer.peerUid)) {
        return peer.peerUid;
    }

    const fn = userApi?.getUidByUinV2;
    if (typeof fn !== 'function') {
        logger?.log(
            `[QCE] UserApi.getUidByUinV2 不可用，沿用原始 peerUid: ${peer.peerUid}`,
        );
        return peer.peerUid;
    }

    try {
        const uid = await fn.call(userApi, peer.peerUid);
        if (uid) {
            logger?.log(`[QCE] QQ号 ${peer.peerUid} 转换为 uid: ${uid}`);
            return uid;
        }
        return peer.peerUid;
    } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        logger?.log(
            `[QCE] QQ号 ${peer.peerUid} 转换 uid 失败，沿用原值: ${msg}`,
        );
        return peer.peerUid;
    }
}
