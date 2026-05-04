/**
 * 解析 NapCat 推过来的 multiForwardMsgElement.xmlContent（issue #128 子项 3）。
 *
 * 当合并转发卡片无法通过 getMultiMsg 拉到子消息时（消息已过期 / NapCat 拒绝下发 / 嵌套过深），
 * 旧版会把整段 XML 当作 summary 直接落进导出文件，导致 HTML / 搜索索引里出现 `<msg ... ><item ...>...`
 * 这种 XML 原文。
 *
 * 这里用纯 regex 抠 QQ 客户端协议规定的固定结构（不引入 xml 依赖）：
 *   <msg ...>
 *     <item layout="1" ...>
 *       <title size="34" ...>聊天记录头部（"群聊的聊天记录" / "好友的聊天记录"）</title>
 *       <title size="26" ...>张三: 早</title>
 *       <title size="26" ...>李四: 在吗</title>
 *       ...
 *       <hr .../>
 *       <summary size="26" ...>查看N条转发消息</summary>
 *     </item>
 *     ...
 *   </msg>
 *
 * 抠出 header / preview 行 / 末尾 summary，调用方可直接拿来塞进转发卡片占位预览，
 * 不再把 XML 原文塞进 data.summary。
 */

export interface MultiForwardXmlInfo {
    /** 卡片头部文本，如 "群聊的聊天记录" */
    header: string;
    /** 卡片中部可见的若干预览行（已 unescape，去除前后空白） */
    previewLines: string[];
    /** 卡片底部统计行，如 "查看7条转发消息"；解析不到时为空字符串 */
    summary: string;
    /** 若解析过程中能从 summary 中抠到数字则填上，否则为 0 */
    messageCount: number;
}

const TITLE_RE = /<title\b([^>]*)>([\s\S]*?)<\/title>/g;
const SUMMARY_RE = /<summary\b[^>]*>([\s\S]*?)<\/summary>/;

/** size 属性是 QQ 客户端区分卡片层级用的：34 = header，26 = body（preview 行）。 */
const HEADER_SIZE = '34';

/**
 * unescape XML 实体；QQ 这边只会用到 5 个标准 entity，外加 numeric character reference。
 */
function unescapeXmlEntities(input: string): string {
    if (!input) return '';
    return input
        .replace(/&#x([0-9A-Fa-f]+);/g, (_, hex) => {
            const code = parseInt(hex, 16);
            return Number.isFinite(code) ? String.fromCodePoint(code) : '';
        })
        .replace(/&#(\d+);/g, (_, dec) => {
            const code = parseInt(dec, 10);
            return Number.isFinite(code) ? String.fromCodePoint(code) : '';
        })
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&apos;/g, "'")
        .replace(/&amp;/g, '&');
}

function extractAttribute(rawAttrs: string, name: string): string {
    const re = new RegExp(`\\b${name}\\s*=\\s*"([^"]*)"`);
    const match = rawAttrs.match(re);
    return match ? match[1]! : '';
}

/**
 * 判断给定字符串是否疑似 multiForwardMsg 的 XML 卡片。
 *
 * 用最严格的特征：必须出现 `<msg` 头 + `multiMsgFlag` 或 `viewMultiMsg`。
 * 这样能排掉只是普通带尖括号的文本。
 */
export function looksLikeMultiForwardXml(s: string | null | undefined): boolean {
    if (!s || typeof s !== 'string') return false;
    const trimmed = s.trim();
    if (!trimmed.startsWith('<')) return false;
    if (!/<msg\b/i.test(trimmed)) return false;
    return /multiMsgFlag\s*=|viewMultiMsg/i.test(trimmed);
}

/**
 * 抠 QQ multiForwardMsg 卡片 XML 的可视部分。
 * 解析失败时返回空 info（header / previewLines / summary 全空），调用方应当回退到 generic placeholder。
 */
export function parseMultiForwardXml(xml: string | null | undefined): MultiForwardXmlInfo {
    const info: MultiForwardXmlInfo = {
        header: '',
        previewLines: [],
        summary: '',
        messageCount: 0
    };
    if (!xml || typeof xml !== 'string') return info;

    const rawTitles: Array<{ attrs: string; text: string }> = [];
    let m: RegExpExecArray | null;
    TITLE_RE.lastIndex = 0;
    while ((m = TITLE_RE.exec(xml)) !== null) {
        rawTitles.push({ attrs: m[1] ?? '', text: unescapeXmlEntities(m[2] ?? '').trim() });
        if (rawTitles.length > 32) break; // 防止恶意 XML 撑爆解析
    }

    if (rawTitles.length > 0) {
        // 按 size 区分：先尝试取第一条 size="34" 当 header，其余 size!=34 当预览。
        // 没有 size 标注时退化为「第一条 = header，其余 = preview」。
        const headerEntry = rawTitles.find(t => extractAttribute(t.attrs, 'size') === HEADER_SIZE) ?? rawTitles[0];
        if (headerEntry) {
            info.header = headerEntry.text;
        }
        for (const t of rawTitles) {
            if (t === headerEntry) continue;
            if (!t.text) continue;
            info.previewLines.push(t.text);
            if (info.previewLines.length >= 16) break;
        }
    }

    const summaryMatch = xml.match(SUMMARY_RE);
    if (summaryMatch) {
        info.summary = unescapeXmlEntities(summaryMatch[1] ?? '').trim();
        const numMatch = info.summary.match(/(\d+)/);
        if (numMatch) {
            const n = parseInt(numMatch[1]!, 10);
            if (Number.isFinite(n)) info.messageCount = n;
        }
    }

    return info;
}
