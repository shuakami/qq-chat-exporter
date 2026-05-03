/**
 * Issue #134: 导出文件名生成 / 友好命名 / 同名去重的单元测试。
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';

import {
    sanitizeChatNameForFileName,
    buildExportFileName,
    buildExportDirName,
    disambiguateExportFileName,
} from '../../lib/utils/exportFileName.js';

test('sanitizeChatNameForFileName 移除非法字符并合并下划线', () => {
    assert.equal(sanitizeChatNameForFileName('a/b\\c:d?e*f|g'), 'a_b_c_d_e_f_g');
    assert.equal(sanitizeChatNameForFileName('   foo bar   '), 'foo_bar');
    assert.equal(sanitizeChatNameForFileName('___leading_trailing___'), 'leading_trailing');
});

test('sanitizeChatNameForFileName 截断到指定长度且不以下划线结尾', () => {
    const long = 'a'.repeat(60) + '_' + 'b'.repeat(60);
    const out = sanitizeChatNameForFileName(long, 50);
    assert.equal(out.length, 50);
    assert.ok(!out.endsWith('_'));
});

test('buildExportFileName 默认使用 prefix_QQ_date_time.ext (#216 关闭时)', () => {
    const fn = buildExportFileName({
        chatTypePrefix: 'friend',
        peerUid: '12345',
        sessionName: 'Alice',
        dateStr: '20260101',
        timeStr: '120000',
        extension: 'html',
    });
    assert.equal(fn, 'friend_12345_20260101_120000.html');
});

test('buildExportFileName useNameInFileName 走 #216 旧格式', () => {
    const fn = buildExportFileName({
        chatTypePrefix: 'group',
        peerUid: '99887766',
        sessionName: '我的群聊',
        dateStr: '20260101',
        timeStr: '120000',
        extension: 'html',
        useNameInFileName: true,
    });
    assert.equal(fn, 'group_我的群聊_99887766_20260101_120000.html');
});

test('buildExportFileName useFriendlyFileName 输出 `<名称>(<QQ号>).<ext>` (#134)', () => {
    const fn = buildExportFileName({
        chatTypePrefix: 'friend',
        peerUid: '12345',
        sessionName: 'Alice',
        dateStr: '20260101',
        timeStr: '120000',
        extension: 'html',
        useFriendlyFileName: true,
    });
    assert.equal(fn, 'Alice(12345).html');
});

test('buildExportFileName useFriendlyFileName 优先级高于 useNameInFileName', () => {
    const fn = buildExportFileName({
        chatTypePrefix: 'group',
        peerUid: '99887766',
        sessionName: '研发组',
        dateStr: '20260101',
        timeStr: '120000',
        extension: 'html',
        useNameInFileName: true,
        useFriendlyFileName: true,
    });
    assert.equal(fn, '研发组(99887766).html');
});

test('buildExportFileName useFriendlyFileName 缺 sessionName 时退回默认', () => {
    const fn = buildExportFileName({
        chatTypePrefix: 'friend',
        peerUid: '12345',
        sessionName: '12345', // 等于 peerUid，视作没有可用名称
        dateStr: '20260101',
        timeStr: '120000',
        extension: 'html',
        useFriendlyFileName: true,
    });
    assert.equal(fn, 'friend_12345_20260101_120000.html');
});

test('buildExportDirName useFriendlyFileName 与文件名一致 (suffix 在末尾)', () => {
    const dir = buildExportDirName({
        chatTypePrefix: 'group',
        peerUid: '99887766',
        sessionName: '研发组',
        dateStr: '20260101',
        timeStr: '120000',
        suffix: '_chunked_jsonl',
        useFriendlyFileName: true,
    });
    assert.equal(dir, '研发组(99887766)_chunked_jsonl');
});

test('disambiguateExportFileName 不存在时原样返回', () => {
    const out = disambiguateExportFileName(
        '/tmp/out',
        'Alice(12345).html',
        '20260101',
        '120000',
        () => false
    );
    assert.equal(out, 'Alice(12345).html');
});

test('disambiguateExportFileName 存在时追加 _<日期>_<时间> 后缀，扩展名保留', () => {
    const out = disambiguateExportFileName(
        '/tmp/out',
        'Alice(12345).html',
        '20260101',
        '120000',
        (p) => p === path.join('/tmp/out', 'Alice(12345).html')
    );
    assert.equal(out, 'Alice(12345)_20260101_120000.html');
});

test('disambiguateExportFileName 没有扩展名时把后缀直接拼到末尾', () => {
    const out = disambiguateExportFileName(
        '/tmp/out',
        'AliceWithoutExt',
        '20260101',
        '120000',
        () => true
    );
    assert.equal(out, 'AliceWithoutExt_20260101_120000');
});
