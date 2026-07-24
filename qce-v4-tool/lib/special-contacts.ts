import type { Friend, RecentContact } from "@/types/api"

/**
 * 将 NTQQ ChatType 数值映射为人类可读的细分类别（Issue #364）。
 * 仅覆盖最近联系人列表里常见的非好友 / 非群聊会话。
 */
export function classifySpecialChatType(chatType: number): string {
  switch (chatType) {
    case 8:
    case 134:
      // 数据线会话：手机 QQ 里的「我的电脑 / 我的手机 / 我的设备」（Issue #609）。
      // NapCat 的 KCHATTYPEDATALINE(8) / KCHATTYPEDATALINEMQQ(134)。
      return "device"
    case 99:
    case 100:
    case 101:
    case 102:
    case 103:
    case 111:
    case 117:
    case 119:
      return "temp"
    case 118:
    case 201:
      return "service"
    case 132:
    case 133:
      return "notify"
    case 9:
    case 16:
      return "guild"
    default:
      return "other"
  }
}

/** 生产环境下前端静态资源前缀（与 next.config 的 basePath 一致）。 */
const ASSET_BASE = process.env.NODE_ENV === "production" ? "/static/qce" : ""

/**
 * 把最近联系人里既不在好友也不在群组的特殊会话（QQ Bot / 服务号 / 临时会话 /
 * 我的设备等）转换成 Friend，供会话选择列表展示。这些会话保留原始 chatType，
 * 上层导出 / 定时任务在选中时会把 chatType 透传给后端。（Issue #364 / #609）
 */
export function buildSpecialFriends(
  contacts: RecentContact[],
  existingUids: Set<string>,
): Friend[] {
  return contacts
    .filter((c) => c.classification === "special" && !existingUids.has(c.peerUid))
    .map((c) => {
      const specialKind = classifySpecialChatType(c.chatType)
      const isDevice = specialKind === "device"
      // 设备会话（我的电脑/我的手机）没有 QQ 号头像，用内置设备图标；
      // 名字缺失时兜底成「我的设备」。（Issue #609）
      const nick = c.name && c.name !== c.peerUid ? c.name : isDevice ? "我的设备" : c.name
      return {
        uid: c.peerUid,
        uin: c.peerUin ? Number(c.peerUin) : 0,
        nick,
        remark: undefined,
        avatarUrl: isDevice ? `${ASSET_BASE}/device.png` : c.avatarUrl,
        isOnline: false,
        status: 0,
        categoryId: 0,
        chatType: c.chatType,
        isSpecial: true,
        specialKind,
      }
    })
}
