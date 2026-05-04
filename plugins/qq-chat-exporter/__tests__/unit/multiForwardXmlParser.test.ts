import test from 'node:test';
import assert from 'node:assert/strict';
import {
    parseMultiForwardXml,
    looksLikeMultiForwardXml,
} from '../../lib/core/parser/multiForwardXmlParser.js';

/**
 * QQ 客户端典型的 multiForwardMsg 卡片 XML（issue #128 子项 3）。
 * 真机抓回来的字段会比这更花哨（多了 m_resid / m_fileName / brief / sourceMsgId），
 * 但 <title> / <summary> 这一层结构是固定的。
 */
const sampleXml = `<?xml version='1.0' encoding='UTF-8' standalone='yes' ?>
<msg serviceID="35" templateID="1" action="viewMultiMsg" actionData="" brief="[聊天记录]" m_resid="abc==" m_fileName="123" sourceMsgId="0" url="" flag="3" adverSign="0" multiMsgFlag="0">
    <item layout="1" advertiser_id="0" aid="0">
        <title size="34" maxLines="2" lineSpace="12">群聊的聊天记录</title>
        <title size="26" color="#777777" maxLines="2" lineSpace="12">小明: 你好</title>
        <title size="26" color="#777777" maxLines="2" lineSpace="12">小红: 在吗</title>
        <title size="26" color="#777777" maxLines="2" lineSpace="12">小明: 我们出去玩吧</title>
        <hr hidden="false" style="0" />
        <summary size="26" color="#777777">查看7条转发消息</summary>
    </item>
    <source name="聊天记录" icon="" action="" appid="-1" />
</msg>`;

test('looksLikeMultiForwardXml: 识别真实卡片 XML', () => {
    assert.equal(looksLikeMultiForwardXml(sampleXml), true);
    assert.equal(
        looksLikeMultiForwardXml(`<msg viewMultiMsg="1"><item><title>x</title></item></msg>`),
        true,
    );
});

test('looksLikeMultiForwardXml: 不把普通带尖括号文本当成卡片 XML', () => {
    assert.equal(looksLikeMultiForwardXml('hello <b>world</b>'), false);
    assert.equal(looksLikeMultiForwardXml('<msg>plain</msg>'), false); // 没 multiMsg 特征
    assert.equal(looksLikeMultiForwardXml(''), false);
    assert.equal(looksLikeMultiForwardXml(null), false);
    assert.equal(looksLikeMultiForwardXml(undefined), false);
});

test('parseMultiForwardXml: 抠出 header / 预览行 / summary / messageCount', () => {
    const info = parseMultiForwardXml(sampleXml);
    assert.equal(info.header, '群聊的聊天记录');
    assert.deepEqual(info.previewLines, [
        '小明: 你好',
        '小红: 在吗',
        '小明: 我们出去玩吧',
    ]);
    assert.equal(info.summary, '查看7条转发消息');
    assert.equal(info.messageCount, 7);
});

test('parseMultiForwardXml: 空 / 非 XML 输入返回空 info', () => {
    const empty = parseMultiForwardXml('');
    assert.equal(empty.header, '');
    assert.deepEqual(empty.previewLines, []);
    assert.equal(empty.summary, '');
    assert.equal(empty.messageCount, 0);

    const notXml = parseMultiForwardXml('随便一段普通文本');
    assert.equal(notXml.header, '');
    assert.deepEqual(notXml.previewLines, []);

    assert.deepEqual(parseMultiForwardXml(null).previewLines, []);
    assert.deepEqual(parseMultiForwardXml(undefined).previewLines, []);
});

test('parseMultiForwardXml: 反转义 XML 实体', () => {
    const xml = `<msg multiMsgFlag="0"><item>
        <title size="34">A &amp; B 的聊天</title>
        <title size="26">A: 你 &lt; 我 &gt; 他</title>
        <title size="26">B: &quot;hello&quot; &apos;world&apos;</title>
        <title size="26">C: &#x4E2D;&#20013;</title>
        <summary size="26">查看3条转发消息</summary>
    </item></msg>`;
    const info = parseMultiForwardXml(xml);
    assert.equal(info.header, 'A & B 的聊天');
    assert.deepEqual(info.previewLines, [
        'A: 你 < 我 > 他',
        `B: "hello" 'world'`,
        'C: 中中',
    ]);
    assert.equal(info.summary, '查看3条转发消息');
    assert.equal(info.messageCount, 3);
});

test('parseMultiForwardXml: 没 size 标记时退化为 第一条=header / 其余=preview', () => {
    const xml = `<msg multiMsgFlag="0"><item>
        <title>聊天记录</title>
        <title>张三: 嗨</title>
        <title>李四: 嗨嗨</title>
    </item></msg>`;
    const info = parseMultiForwardXml(xml);
    assert.equal(info.header, '聊天记录');
    assert.deepEqual(info.previewLines, ['张三: 嗨', '李四: 嗨嗨']);
});

test('parseMultiForwardXml: <title> 数量上限保护，最多解析 16 条预览', () => {
    const titles = ['<title size="34">头部</title>'];
    for (let i = 0; i < 50; i++) {
        titles.push(`<title size="26">行${i}</title>`);
    }
    const xml = `<msg multiMsgFlag="0"><item>${titles.join('')}<summary size="26">查看51条转发消息</summary></item></msg>`;
    const info = parseMultiForwardXml(xml);
    assert.equal(info.header, '头部');
    // 最多 16 条预览
    assert.equal(info.previewLines.length, 16);
    assert.equal(info.messageCount, 51);
});

test('parseMultiForwardXml: summary 没数字时 messageCount 保持 0', () => {
    const xml = `<msg multiMsgFlag="0"><item>
        <title size="34">聊天记录</title>
        <summary size="26">查看转发消息</summary>
    </item></msg>`;
    const info = parseMultiForwardXml(xml);
    assert.equal(info.summary, '查看转发消息');
    assert.equal(info.messageCount, 0);
});

test('parseMultiForwardXml: 没 summary 标签时，messageCount=0、summary=空字符串', () => {
    const xml = `<msg multiMsgFlag="0"><item>
        <title size="34">A 的聊天</title>
        <title size="26">A: 你好</title>
    </item></msg>`;
    const info = parseMultiForwardXml(xml);
    assert.equal(info.header, 'A 的聊天');
    assert.deepEqual(info.previewLines, ['A: 你好']);
    assert.equal(info.summary, '');
    assert.equal(info.messageCount, 0);
});
