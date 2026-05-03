/**
 * Issue #344：`toggleSkipResourceType` 是 task wizard / 批量导出 / 定时导出三个表单
 * 共享的资源类型勾选器逻辑，单独跑一组单测确保它的语义不会随这些表单的样式
 * 调整而漂移。
 *
 * 由于这个 helper 物理上住在 `qce-v4-tool/lib/skip-resource-types.ts`，前端目前没有
 * 自己的 node 单测体系，这里复用插件已有的 tsx + node:test 体系跨目录 import。
 */

import test from 'node:test';
import assert from 'node:assert/strict';

// `qce-v4-tool/package.json` 没有 `"type": "module"`，所以 tsx 把它下面的 .ts 文件
// 当作 CJS 编译，命名导出会被收进 `default`。这里用命名空间 import 兼容两边
// （ESM 真命名导出 / CJS interop default）。
import * as skipResourceTypesMod from '../../../../qce-v4-tool/lib/skip-resource-types';

type Mod = typeof import('../../../../qce-v4-tool/lib/skip-resource-types');
const skipResourceTypes: Mod =
    (skipResourceTypesMod as unknown as { default?: Mod }).default ??
    (skipResourceTypesMod as unknown as Mod);
const { toggleSkipResourceType } = skipResourceTypes;

test('toggleSkipResourceType: 在 undefined 上加一项返回单元素数组', () => {
    assert.deepEqual(toggleSkipResourceType(undefined, 'image', true), ['image']);
});

test('toggleSkipResourceType: 已存在的类型再开一次保持幂等', () => {
    assert.deepEqual(toggleSkipResourceType(['image'], 'image', true), ['image']);
});

test('toggleSkipResourceType: 关闭最后一项时返回 undefined（避免给 API 传空数组）', () => {
    assert.equal(toggleSkipResourceType(['image'], 'image', false), undefined);
});

test('toggleSkipResourceType: 关闭其中一项保留剩余项', () => {
    assert.deepEqual(toggleSkipResourceType(['image', 'video', 'audio'], 'video', false), ['image', 'audio']);
});

test('toggleSkipResourceType: 输出按 image,video,audio,file 固定顺序排序', () => {
    // 故意把输入打乱顺序，输出应该被规范成固定顺序。
    assert.deepEqual(
        toggleSkipResourceType(['file', 'audio', 'video', 'image'], 'image', true),
        ['image', 'video', 'audio', 'file']
    );
});

test('toggleSkipResourceType: 忽略不在白名单内的输入值', () => {
    // 万一别的代码混入了一个未被识别的字符串（比如未来新增类型未同步），
    // toggle 应当把它丢掉，避免后端拿到无效值。
    assert.deepEqual(
        toggleSkipResourceType(['image', 'sticker' as unknown as 'image'], 'video', true),
        ['image', 'video']
    );
});

test('toggleSkipResourceType: 空数组等价于 undefined 输入', () => {
    assert.deepEqual(toggleSkipResourceType([], 'audio', true), ['audio']);
    assert.equal(toggleSkipResourceType([], 'audio', false), undefined);
});

test('toggleSkipResourceType: 不修改输入数组', () => {
    const input: ReadonlyArray<'image' | 'video' | 'audio' | 'file'> = ['image', 'video'];
    toggleSkipResourceType(input, 'audio', true);
    // input 仍然是原样
    assert.deepEqual(input, ['image', 'video']);
});
