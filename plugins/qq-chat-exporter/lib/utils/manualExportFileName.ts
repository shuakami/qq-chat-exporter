/**
 * Issue #163: 解析手动导出生成的文件名，把它们按「同一会话」分组用于合并。
 *
 * 手动导出可能产生几种文件名：
 *  - 默认：     `friend_<uid>_<YYYYMMDD>_<HHMMSS>.<ext>`
 *  - #216：    `friend_<safeName>_<uid>_<YYYYMMDD>_<HHMMSS>.<ext>`
 *  - #134：    `<safeName>(<uid>).<ext>`
 *  - #134 碰撞：`<safeName>(<uid>)_<YYYYMMDD>_<HHMMSS>.<ext>`
 *
 * 这里只识别 `html` / `json` 两种扩展名 —— 这是合并器目前能消费的格式；
 * 其它格式（jsonl / xlsx / txt 等）即使在导出目录里也跳过，避免误把不可合并的
 * 文件加进任务列表。
 */

export type ChatType = 'friend' | 'group';

export interface ParsedManualExportFile {
    /** 文件基础名（不含扩展名）。 */
    baseName: string;
    /** 文件扩展名，不含点。 */
    extension: 'html' | 'json';
    /** 解析出的会话类型。 */
    chatType: ChatType;
    /** 对方 UID（一般就是 QQ 号）。 */
    peerUid: string;
    /**
     * 解析出的会话名称。`null` 时表示文件名里没有名称信息（例如默认格式里只有 UID）。
     * 用于在合并对话框上显示更易读的标签；分组本身不依赖这个字段。
     */
    sessionName: string | null;
    /** 解析出的时间戳（YYYYMMDD-HHMMSS），无时间戳的友好命名为 null。 */
    timestamp: string | null;
}

/**
 * 把扩展名归一化成统一的小写。返回 null 表示不是支持合并的扩展名。
 */
function normalizeExtension(ext: string): 'html' | 'json' | null {
    const lower = ext.toLowerCase();
    if (lower === 'html' || lower === 'json') return lower;
    return null;
}

const RE_DEFAULT = /^(friend|group)_(\d+)_(\d{8})_(\d{6})\.(html|json)$/;
const RE_NAMED = /^(friend|group)_(.+?)_(\d+)_(\d{8})_(\d{6})\.(html|json)$/;
const RE_FRIENDLY = /^(.+?)\((\d+)\)(?:_(\d{8})_(\d{6}))?\.(html|json)$/;

/**
 * 尝试把单个手动导出的文件名解析成结构化数据。返回 null 表示不识别 / 不可合并。
 */
export function parseManualExportFileName(fileName: string): ParsedManualExportFile | null {
    // 1. `<safeName>(<uid>).<ext>` / `<safeName>(<uid>)_<date>_<time>.<ext>`
    const friendlyMatch = fileName.match(RE_FRIENDLY);
    if (friendlyMatch) {
        const [, name, uid, date, time, extRaw] = friendlyMatch;
        const ext = normalizeExtension(extRaw);
        if (!ext) return null;
        // 友好命名格式没法 100% 区分 friend / group；为了让同一会话能聚到一起，
        // 用 `friend` 做默认值，再借助 sessionName + uid 共同作为 group key。
        return {
            baseName: fileName.slice(0, fileName.lastIndexOf('.')),
            extension: ext,
            chatType: 'friend',
            peerUid: uid,
            sessionName: name,
            timestamp: date && time ? `${date}-${time}` : null,
        };
    }

    // 2. `<chatType>_<safeName>_<uid>_<date>_<time>.<ext>` (#216)
    const namedMatch = fileName.match(RE_NAMED);
    if (namedMatch) {
        const [, chatType, name, uid, date, time, extRaw] = namedMatch;
        const ext = normalizeExtension(extRaw);
        if (!ext) return null;
        return {
            baseName: fileName.slice(0, fileName.lastIndexOf('.')),
            extension: ext,
            chatType: chatType as ChatType,
            peerUid: uid,
            sessionName: name,
            timestamp: `${date}-${time}`,
        };
    }

    // 3. `<chatType>_<uid>_<date>_<time>.<ext>` (默认)
    const defaultMatch = fileName.match(RE_DEFAULT);
    if (defaultMatch) {
        const [, chatType, uid, date, time, extRaw] = defaultMatch;
        const ext = normalizeExtension(extRaw);
        if (!ext) return null;
        return {
            baseName: fileName.slice(0, fileName.lastIndexOf('.')),
            extension: ext,
            chatType: chatType as ChatType,
            peerUid: uid,
            sessionName: null,
            timestamp: `${date}-${time}`,
        };
    }

    return null;
}

/**
 * 同一会话的合并组 key。`<chatType>_<peerUid>` 即可保证唯一；友好命名虽然不带 chatType
 * 也会回退到 `friend`，但只要 peerUid 一致就能和 #216 / 默认格式聚到一起。
 */
export function manualExportGroupKey(parsed: ParsedManualExportFile): string {
    return `${parsed.chatType}_${parsed.peerUid}`;
}
