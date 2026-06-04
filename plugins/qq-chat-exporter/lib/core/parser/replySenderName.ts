/**
 * Issue #296：JSON 等导出里"回复 XXX"的发件人错位。
 *
 * 根因是被引用消息的「内容」与「发件人」走了两套解析：内容按 sourceMsgIdInRecords
 * 命中被引用消息，发件人却直接取 reply 元素自带的 senderUidStr / senderUin。两者
 * 落到不同消息时，预览里就出现「A 回复 A」这种发件人对不上引用内容的错位。
 *
 * 这里抽出一个纯函数，按与外层发件人显示（getSenderDisplayInfo）完全一致的优先级
 * 解析被引用消息的显示名，保证「回复 XXX」与正文里同一个人的显示名一致。
 */

export interface ReplySenderNameFields {
    /** 群名片 sendMemberName */
    memberName?: string | null;
    /** 备注 sendRemarkName */
    remark?: string | null;
    /** 昵称 sendNickName */
    nickname?: string | null;
    /** QQ 号 senderUin */
    uin?: string | null;
    /** uid 字符串 senderUidStr（u_xxx） */
    uidStr?: string | null;
}

export interface ReplySenderNameOptions {
    /** 被引用消息所在会话是否群聊（取外层消息的 chatType===2） */
    isGroupChat: boolean;
    /** 群聊是否优先群名片（对齐 MessageParser.config.preferGroupMemberName） */
    preferGroupMemberName: boolean;
}

function trim(value: unknown): string {
    if (value === null || value === undefined) return '';
    return String(value).trim();
}

/**
 * 解析被引用消息的显示名。优先级与 getSenderDisplayInfo 保持一致：
 *   - 群聊 + preferGroupMemberName：群名片 → 备注 → 昵称
 *   - 群聊 + 不优先：昵称
 *   - 私聊：备注 → 昵称
 *   - 兜底：QQ 号 → uid 字符串
 * 纯函数，便于单测。
 */
export function resolveReplySenderName(
    fields: ReplySenderNameFields,
    opts: ReplySenderNameOptions,
): string {
    const memberName = trim(fields.memberName);
    const remark = trim(fields.remark);
    const nickname = trim(fields.nickname);
    const uin = trim(fields.uin);
    const uidStr = trim(fields.uidStr);

    let name = '';
    if (opts.isGroupChat) {
        name = opts.preferGroupMemberName
            ? (memberName || remark || nickname)
            : nickname;
    } else {
        name = remark || nickname;
    }

    return name || uin || uidStr || '';
}
