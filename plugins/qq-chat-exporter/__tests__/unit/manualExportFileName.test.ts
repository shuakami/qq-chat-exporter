/**
 * Issue #163: 手动导出文件名解析的单元测试。
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
    parseManualExportFileName,
    manualExportGroupKey,
} from '../../lib/utils/manualExportFileName.js';

test('parseManualExportFileName 解析默认格式 friend_<uid>_<date>_<time>.html', () => {
    const r = parseManualExportFileName('friend_12345_20260101_120000.html');
    assert.ok(r);
    assert.equal(r!.chatType, 'friend');
    assert.equal(r!.peerUid, '12345');
    assert.equal(r!.sessionName, null);
    assert.equal(r!.timestamp, '20260101-120000');
    assert.equal(r!.extension, 'html');
});

test('parseManualExportFileName 解析 group_<uid>_<date>_<time>.json', () => {
    const r = parseManualExportFileName('group_99887766_20260101_120000.json');
    assert.ok(r);
    assert.equal(r!.chatType, 'group');
    assert.equal(r!.peerUid, '99887766');
    assert.equal(r!.extension, 'json');
});

test('parseManualExportFileName 解析 #216 命名 group_<name>_<uid>_<date>_<time>.html', () => {
    const r = parseManualExportFileName('group_研发组_99887766_20260101_120000.html');
    assert.ok(r);
    assert.equal(r!.chatType, 'group');
    assert.equal(r!.sessionName, '研发组');
    assert.equal(r!.peerUid, '99887766');
});

test('parseManualExportFileName 解析 #134 友好命名 <name>(<uid>).html', () => {
    const r = parseManualExportFileName('Alice(12345).html');
    assert.ok(r);
    assert.equal(r!.peerUid, '12345');
    assert.equal(r!.sessionName, 'Alice');
    assert.equal(r!.timestamp, null);
});

test('parseManualExportFileName 解析 #134 碰撞命名 <name>(<uid>)_<date>_<time>.html', () => {
    const r = parseManualExportFileName('Alice(12345)_20260101_120000.html');
    assert.ok(r);
    assert.equal(r!.peerUid, '12345');
    assert.equal(r!.sessionName, 'Alice');
    assert.equal(r!.timestamp, '20260101-120000');
});

test('parseManualExportFileName 不识别 jsonl / xlsx / txt 等不可合并的扩展名', () => {
    assert.equal(parseManualExportFileName('friend_12345_20260101_120000.jsonl'), null);
    assert.equal(parseManualExportFileName('Alice(12345).xlsx'), null);
    assert.equal(parseManualExportFileName('group_99887766_20260101_120000.txt'), null);
});

test('parseManualExportFileName 不识别完全无规则的文件名', () => {
    assert.equal(parseManualExportFileName('random_file.html'), null);
    assert.equal(parseManualExportFileName('export.html'), null);
});

test('manualExportGroupKey 把同一 uid 的默认 / #216 命名分到一起', () => {
    const a = parseManualExportFileName('friend_12345_20260101_120000.html')!;
    const b = parseManualExportFileName('friend_Alice_12345_20260102_130000.html')!;
    assert.equal(manualExportGroupKey(a), manualExportGroupKey(b));
});

test('manualExportGroupKey 把不同 chatType 但相同 uid 分开', () => {
    const a = parseManualExportFileName('friend_12345_20260101_120000.html')!;
    const b = parseManualExportFileName('group_12345_20260101_120000.html')!;
    assert.notEqual(manualExportGroupKey(a), manualExportGroupKey(b));
});
