import test from 'node:test';
import assert from 'node:assert/strict';
import {
    compareSessionItems,
    sortSessionItems,
    formatRelativeFromNow,
    formatCompactCount,
    type SortableSessionItem,
} from '../../../../qce-v4-tool/lib/session-sort.js';

function makeItem(
    id: string,
    overrides: Partial<SortableSessionItem> = {},
): SortableSessionItem {
    return {
        id,
        type: 'group',
        name: id,
        ...overrides,
    };
}

test('compareSessionItems: 按 name 升序', () => {
    const a = makeItem('a', { name: '苹果' });
    const b = makeItem('b', { name: '香蕉' });
    assert.ok(compareSessionItems(a, b, 'name', 'asc') < 0);
    assert.ok(compareSessionItems(a, b, 'name', 'desc') > 0);
});

test('compareSessionItems: memberCount 缺失记为 -1，永远在最后', () => {
    const group = makeItem('g', { memberCount: 100 });
    const friend = makeItem('f', { type: 'friend' });
    // asc：好友 -1 在前
    assert.ok(compareSessionItems(friend, group, 'memberCount', 'asc') < 0);
    // desc：好友 -1 在后
    assert.ok(compareSessionItems(friend, group, 'memberCount', 'desc') > 0);
});

test('compareSessionItems: lastActivity 升序按时间，缺失永远沉底', () => {
    const recent = makeItem('a', { lastMessageTime: '2026-01-10T00:00:00Z' });
    const old = makeItem('b', { lastMessageTime: '2025-01-10T00:00:00Z' });
    const noData = makeItem('c');

    // 升序：旧的在前、新的在后
    assert.ok(compareSessionItems(old, recent, 'lastActivity', 'asc') < 0);
    // 缺失数据无论 asc / desc 都应该排在最后
    assert.ok(compareSessionItems(noData, old, 'lastActivity', 'asc') > 0);
    assert.ok(compareSessionItems(noData, old, 'lastActivity', 'desc') > 0);
    assert.ok(compareSessionItems(noData, recent, 'lastActivity', 'desc') > 0);
});

test('compareSessionItems: lastActivity 解析失败按缺失处理', () => {
    const broken = makeItem('a', { lastMessageTime: 'not-a-date' });
    const valid = makeItem('b', { lastMessageTime: '2026-01-10T00:00:00Z' });
    assert.ok(compareSessionItems(broken, valid, 'lastActivity', 'desc') > 0);
});

test('compareSessionItems: exportedCount 升序，缺失当 0 处理', () => {
    const big = makeItem('a', { exportedMessageCount: 5000 });
    const small = makeItem('b', { exportedMessageCount: 100 });
    const none = makeItem('c');

    assert.ok(compareSessionItems(small, big, 'exportedCount', 'asc') < 0);
    assert.ok(compareSessionItems(big, small, 'exportedCount', 'desc') < 0);
    // 没有导出过的会话当 0 处理：相对 small 更靠前（asc）
    assert.ok(compareSessionItems(none, small, 'exportedCount', 'asc') < 0);
});

test('sortSessionItems: 不修改原数组', () => {
    const items: SortableSessionItem[] = [
        makeItem('c', { name: 'c' }),
        makeItem('a', { name: 'a' }),
        makeItem('b', { name: 'b' }),
    ];
    const sorted = sortSessionItems(items, 'name', 'asc');
    assert.deepEqual(
        sorted.map((it) => it.id),
        ['a', 'b', 'c'],
    );
    // 原数组未变
    assert.deepEqual(
        items.map((it) => it.id),
        ['c', 'a', 'b'],
    );
});

test('sortSessionItems: lastActivity desc 把缺失项沉到最后', () => {
    const items: SortableSessionItem[] = [
        makeItem('no-data'),
        makeItem('jan', { lastMessageTime: '2026-01-01T00:00:00Z' }),
        makeItem('mar', { lastMessageTime: '2026-03-01T00:00:00Z' }),
        makeItem('feb', { lastMessageTime: '2026-02-01T00:00:00Z' }),
    ];
    const sorted = sortSessionItems(items, 'lastActivity', 'desc');
    assert.deepEqual(
        sorted.map((it) => it.id),
        ['mar', 'feb', 'jan', 'no-data'],
    );
});

test('formatRelativeFromNow: 各档位边界', () => {
    const now = Date.parse('2026-05-01T12:00:00Z');
    // 5 秒前
    assert.equal(formatRelativeFromNow('2026-05-01T11:59:55Z', now), '刚刚');
    // 30 分钟前
    assert.equal(formatRelativeFromNow('2026-05-01T11:30:00Z', now), '30 分钟前');
    // 5 小时前
    assert.equal(formatRelativeFromNow('2026-05-01T07:00:00Z', now), '5 小时前');
    // 3 天前
    assert.equal(formatRelativeFromNow('2026-04-28T12:00:00Z', now), '3 天前');
    // 2 个月前
    assert.equal(formatRelativeFromNow('2026-03-01T12:00:00Z', now), '2 个月前');
    // 2 年前
    assert.equal(formatRelativeFromNow('2024-04-30T12:00:00Z', now), '2 年前');
});

test('formatRelativeFromNow: 异常输入返回空字符串', () => {
    assert.equal(formatRelativeFromNow(undefined), '');
    assert.equal(formatRelativeFromNow(null), '');
    assert.equal(formatRelativeFromNow(''), '');
    assert.equal(formatRelativeFromNow('not-a-date'), '');
});

test('formatRelativeFromNow: 未来时间也算 "刚刚"，不渲染负号', () => {
    const now = Date.parse('2026-05-01T12:00:00Z');
    assert.equal(formatRelativeFromNow('2026-05-01T13:00:00Z', now), '刚刚');
});

test('formatCompactCount: 各级紧凑格式', () => {
    assert.equal(formatCompactCount(0), '0');
    assert.equal(formatCompactCount(42), '42');
    assert.equal(formatCompactCount(999), '999');
    assert.equal(formatCompactCount(1000), '1k');
    assert.equal(formatCompactCount(1200), '1.2k');
    assert.equal(formatCompactCount(9999), '10k');
    assert.equal(formatCompactCount(13427), '13k');
    assert.equal(formatCompactCount(999_999), '999k');
    assert.equal(formatCompactCount(1_200_000), '1.2m');
});

test('formatCompactCount: 异常输入兜底为 0', () => {
    assert.equal(formatCompactCount(-1), '0');
    assert.equal(formatCompactCount(NaN), '0');
    assert.equal(formatCompactCount(Infinity), '0');
});
