/**
 * 群系统通知规范化（issue #317）
 *
 * NapCat 上层 OneBot 的 `get_group_system_msg` 已经把 NT 内部的 GroupNotify
 * 拍平成了 `{invited_requests, join_requests, InvitedRequest}`，每条带
 * snake_case 字段：request_id / invitor_uin / invitor_nick / actor /
 * group_id / group_name / message / checked / requester_nick。
 *
 * QCE 这边对外统一走 camelCase + 显式语义字段，前端不用关心 OneBot 协议
 * 的历史包袱。这个模块只做字段重命名 / 兜底，不发请求、不读 DB。
 */

export type GroupSystemRequestKind = 'join' | 'invited';

export interface GroupSystemRequest {
    requestId: number;
    kind: GroupSystemRequestKind;
    groupId: string;
    groupName: string;
    requesterUin: number;
    requesterNick: string;
    actorUin: number;
    invitorUin: number;
    invitorNick: string;
    message: string;
    checked: boolean;
}

export interface NormalizedGroupSystemNotify {
    joinRequests: GroupSystemRequest[];
    invitedRequests: GroupSystemRequest[];
    totalCount: number;
}

interface RawSystemMsgItem {
    request_id?: number | string;
    invitor_uin?: number | string;
    invitor_nick?: string;
    group_id?: number | string;
    group_name?: string;
    message?: string;
    checked?: boolean;
    actor?: number | string;
    requester_nick?: string;
}

interface RawSystemMsgPayload {
    join_requests?: RawSystemMsgItem[];
    invited_requests?: RawSystemMsgItem[];
    InvitedRequest?: RawSystemMsgItem[];
}

function toNumber(v: unknown): number {
    if (typeof v === 'number' && Number.isFinite(v)) return v;
    if (typeof v === 'string' && v.trim() !== '') {
        const n = Number(v);
        return Number.isFinite(n) ? n : 0;
    }
    return 0;
}

function toString(v: unknown, fallback = ''): string {
    if (typeof v === 'string') return v;
    if (typeof v === 'number' && Number.isFinite(v)) return String(v);
    return fallback;
}

function mapItem(raw: RawSystemMsgItem, kind: GroupSystemRequestKind): GroupSystemRequest {
    return {
        requestId: toNumber(raw.request_id),
        kind,
        groupId: toString(raw.group_id),
        groupName: toString(raw.group_name),
        requesterUin: toNumber(raw.invitor_uin),
        requesterNick: toString(raw.requester_nick ?? raw.invitor_nick),
        actorUin: toNumber(raw.actor),
        invitorUin: toNumber(raw.invitor_uin),
        invitorNick: toString(raw.invitor_nick),
        message: toString(raw.message),
        checked: raw.checked === true,
    };
}

export function normalizeGroupSystemNotify(raw: unknown): NormalizedGroupSystemNotify {
    if (!raw || typeof raw !== 'object') {
        return { joinRequests: [], invitedRequests: [], totalCount: 0 };
    }
    const payload = raw as RawSystemMsgPayload;

    const join = Array.isArray(payload.join_requests) ? payload.join_requests : [];
    // OneBot 字段历史遗留 InvitedRequest（驼峰）和 invited_requests（蛇形）同时存在，
    // 取其一即可，避免重复。
    const invitedSrc = Array.isArray(payload.invited_requests)
        ? payload.invited_requests
        : Array.isArray(payload.InvitedRequest)
            ? payload.InvitedRequest
            : [];

    const joinRequests = join.map(item => mapItem(item, 'join'));
    const invitedRequests = invitedSrc.map(item => mapItem(item, 'invited'));

    return {
        joinRequests,
        invitedRequests,
        totalCount: joinRequests.length + invitedRequests.length,
    };
}
