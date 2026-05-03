import test from 'node:test';
import assert from 'node:assert/strict';
import {
    MAX_NAME_SEARCH_LENGTH,
    buildNameSearchPredicate,
    normalizeNameSearch,
} from '../../lib/api/galleryFilter.js';

test('galleryFilter: normalizeNameSearch 空 / undefined / null 返回 null（不过滤）', () => {
    assert.equal(normalizeNameSearch(undefined), null);
    assert.equal(normalizeNameSearch(null), null);
    assert.equal(normalizeNameSearch(''), null);
    assert.equal(normalizeNameSearch('   '), null);
    assert.equal(normalizeNameSearch('\t\n'), null);
});

test('galleryFilter: normalizeNameSearch 非字符串异常入参视为不过滤', () => {
    assert.equal(normalizeNameSearch(123 as unknown), null);
    assert.equal(normalizeNameSearch([] as unknown), null);
    assert.equal(normalizeNameSearch({} as unknown), null);
    assert.equal(normalizeNameSearch(['foo', 'bar'] as unknown), null);
});

test('galleryFilter: normalizeNameSearch 正常字符串走 trim + toLowerCase', () => {
    assert.equal(normalizeNameSearch('Hello'), 'hello');
    assert.equal(normalizeNameSearch('  WORLD  '), 'world');
    assert.equal(normalizeNameSearch('PreFix-Mid-SUFFIX'), 'prefix-mid-suffix');
});

test('galleryFilter: normalizeNameSearch 中文 / 标点 / 数字保留', () => {
    assert.equal(normalizeNameSearch('图片'), '图片');
    assert.equal(normalizeNameSearch('IMG_2024_03'), 'img_2024_03');
    assert.equal(normalizeNameSearch('  截图.jpg  '), '截图.jpg');
});

test('galleryFilter: normalizeNameSearch 超长字符串被截断到 MAX_NAME_SEARCH_LENGTH', () => {
    const long = 'a'.repeat(MAX_NAME_SEARCH_LENGTH + 50);
    const out = normalizeNameSearch(long);
    assert.notEqual(out, null);
    assert.equal((out as string).length, MAX_NAME_SEARCH_LENGTH);
});

test('galleryFilter: buildNameSearchPredicate 不过滤时永远返回 true', () => {
    const match = buildNameSearchPredicate(undefined);
    assert.equal(match('anything.png'), true);
    assert.equal(match(''), true);
    assert.equal(match('IMG_2024_截图.jpg'), true);
});

test('galleryFilter: buildNameSearchPredicate 大小写不敏感子串匹配', () => {
    const match = buildNameSearchPredicate('IMG');
    assert.equal(match('img_2024_03_15.jpg'), true);
    assert.equal(match('IMG_2024_03_15.jpg'), true);
    assert.equal(match('vacation_img_001.png'), true);
    assert.equal(match('screenshot.jpg'), false);
});

test('galleryFilter: buildNameSearchPredicate 中文子串能匹配文件名', () => {
    const match = buildNameSearchPredicate('截图');
    assert.equal(match('微信截图_20240315.png'), true);
    assert.equal(match('IMG_2024.jpg'), false);
});

test('galleryFilter: buildNameSearchPredicate 异常 fileName（空 / 非字符串）安全返回 false', () => {
    const match = buildNameSearchPredicate('foo');
    assert.equal(match(''), false);
    assert.equal(match(undefined as unknown as string), false);
    assert.equal(match(null as unknown as string), false);
    assert.equal(match(123 as unknown as string), false);
});

test('galleryFilter: buildNameSearchPredicate 子串首尾空白被 trim 掉，搜索词照常工作', () => {
    const match = buildNameSearchPredicate('   .mp4  ');
    assert.equal(match('vacation.mp4'), true);
    assert.equal(match('clip.mov'), false);
});

test('galleryFilter: buildNameSearchPredicate 长查询截断后仍然能匹配前缀', () => {
    const long = 'a'.repeat(MAX_NAME_SEARCH_LENGTH + 50);
    const match = buildNameSearchPredicate(long);
    // 截断后是 200 个 'a'，文件名里有 250 个 'a' 也能命中
    assert.equal(match('a'.repeat(MAX_NAME_SEARCH_LENGTH + 50) + '.bin'), true);
    // 文件名里只有 100 个 'a'，命不中（长度不够）
    assert.equal(match('a'.repeat(100) + '.bin'), false);
});
