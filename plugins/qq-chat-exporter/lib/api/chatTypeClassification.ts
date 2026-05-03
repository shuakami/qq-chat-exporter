/**
 * 把 NTQQ ChatType 数值映射成导出层关心的二分类（issue #365）。
 *
 * 历史遗留代码里散布着大量 `chatType === 1 ? 'friend' : 'group'` 的写法。
 * 这种写法只覆盖了好友（1）/ 群聊（2），把临时会话（100）、官方 Bot 服务号
 * （118 / 201）、频道（4 / 9 / 16）等单聊型会话一律错分为「群聊」，导致：
 *
 *   1. 文件名前缀变成 `group_<uid>_*`，下载下来的临时会话档案看着像群聊
 *      存档；
 *   2. 自动 sessionName 走 GroupApi.getGroups 找不到对应的 groupCode，最终
 *      只能用裸 uid 兜底；
 *   3. 任务列表 / 数据库里 chatType 字段被记成 `GROUP`，前端按类型筛选时
 *      临时会话的导出任务被算到群聊一类；
 *   4. BatchMessageFetcher 的策略选择只把 chatType === 1 当成私聊优化路径，
 *      临时会话会进入面向群聊调优的策略，浪费时间。
 *
 * 本模块统一约定：
 *   - `isPrivateLikeChatType`: chatType !== 2 一律视为单聊型会话；
 *   - `getChatTypePrefix`: 仅 chatType === 2 用 `group`，其它走 `friend`；
 *   - `classifyChatTypeBinary`: 返回 `'group' | 'private'`，用于导出
 *     pipeline 里二选一的分支（exporter type、任务记录的 chatType 字段等）。
 *
 * 模块只做纯映射，不依赖任何 NapCat 全局类型，方便单元测试覆盖。
 */

export const GROUP_CHAT_TYPE = 2;

export type BinaryChatType = 'group' | 'private';

export type ChatTypeFilenamePrefix = 'group' | 'friend';

/**
 * 该 chatType 在导出层是否按「单聊」对待。
 *
 * NTQQ 的 ChatType 枚举里：
 *   - 1   好友
 *   - 2   群聊
 *   - 4   频道
 *   - 9 / 16    频道子会话
 *   - 100 临时会话
 *   - 118 / 201 服务号 / 公众账号
 *   - 132-134 通知类
 *
 * 除群聊（2）外，其余都是 1 对 1 的单聊型会话，导出 / 文件命名 / 策略选择
 * 都应按私聊处理。
 */
export function isPrivateLikeChatType(chatType: number | undefined | null): boolean {
    if (chatType === undefined || chatType === null) return true;
    return Number(chatType) !== GROUP_CHAT_TYPE;
}

/**
 * 文件名 / 目录名前缀。仅 chatType === 2 用 `group`，其它走 `friend`。
 */
export function getChatTypePrefix(chatType: number | undefined | null): ChatTypeFilenamePrefix {
    return isPrivateLikeChatType(chatType) ? 'friend' : 'group';
}

/**
 * 导出 pipeline 通用的二分类，用于 exporter type / 任务记录的 chatType 字段等。
 */
export function classifyChatTypeBinary(chatType: number | undefined | null): BinaryChatType {
    return isPrivateLikeChatType(chatType) ? 'private' : 'group';
}
