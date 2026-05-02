import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

import { DatabaseManager } from '../../lib/core/storage/DatabaseManager.js';
import { ResourceHandler } from '../../lib/core/resource/ResourceHandler.js';
import { ResourceStatus } from '../../lib/types/index.js';
import { createMockCore } from '../helpers/MockNapCatCore.js';
import { msg } from '../fixtures/builders.js';

/**
 * Issue #341 — 仅保留文件元数据、跳过下载。
 *
 * 验证 ResourceHandler 在 setSkipDownloadTypes(['file']) 之后：
 *   - 文件类资源会被解析、入库，但不会触发实际下载（FileApi.downloadMedia 不被调用）
 *   - 该资源在返回的 resourceMap 中状态为 SKIPPED
 *   - 图片等其他类型默认不受影响（这里仅断言文件类被跳过；图片的真实下载链路需要更复杂的 mock，
 *     由 ApiServer 集成层覆盖）
 */
function tmpDir(prefix: string): { dir: string; cleanup: () => void } {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
    return { dir, cleanup: () => fs.rmSync(dir, { recursive: true, force: true }) };
}

test('setSkipDownloadTypes(["file"]) 命中文件资源时仅保留元数据，状态为 SKIPPED', async () => {
    const dbHome = tmpDir('qce-rh-db-');
    const resHome = tmpDir('qce-rh-res-');
    const prevUserProfile = process.env['USERPROFILE'];
    process.env['USERPROFILE'] = resHome.dir;

    try {
        const dbPath = path.join(dbHome.dir, 'qce.sqlite');
        const db = new DatabaseManager(dbPath);
        await db.initialize();

        const core = createMockCore();

        const handler = new ResourceHandler(core as any, db, {
            // 走默认存储根路径，但 USERPROFILE 已被指向临时目录
            downloadTimeout: 200,
            maxConcurrentDownloads: 1,
            maxRetries: 0,
            healthCheckInterval: 60_000,
        });
        handler.setSkipDownloadTypes(['file']);

        const message = msg({
            peerUid: 'peer_test',
            chatType: 1,
            senderUid: 'u_other',
        }).file({ filename: 'spec.pdf', size: 4096, md5: 'cafebabe' }).build();

        const resourceMap = await handler.processMessageResources([message]);

        const resources = resourceMap.get(message.msgId);
        assert.ok(resources, '应当返回该消息的资源数组');
        assert.equal(resources.length, 1, '应当解析出 1 个资源');
        const [info] = resources;
        assert.equal(info.type, 'file');
        assert.equal(info.fileName, 'spec.pdf');
        assert.equal(info.status, ResourceStatus.SKIPPED, '文件资源应被标记为 SKIPPED');

        const calls = core.__getCallLog().filter((c) => c.api === 'FileApi.downloadMedia');
        assert.equal(calls.length, 0, '跳过类型的资源不应触发 FileApi.downloadMedia');

        await handler.cleanup();
        await db.close();
    } finally {
        if (prevUserProfile === undefined) {
            delete process.env['USERPROFILE'];
        } else {
            process.env['USERPROFILE'] = prevUserProfile;
        }
        dbHome.cleanup();
        resHome.cleanup();
    }
});

test('setSkipDownloadTypes([]) 恢复默认行为，文件资源不再被强制跳过', async () => {
    const dbHome = tmpDir('qce-rh-db-');
    const resHome = tmpDir('qce-rh-res-');
    const prevUserProfile = process.env['USERPROFILE'];
    process.env['USERPROFILE'] = resHome.dir;

    try {
        const dbPath = path.join(dbHome.dir, 'qce.sqlite');
        const db = new DatabaseManager(dbPath);
        await db.initialize();

        const core = createMockCore();

        const handler = new ResourceHandler(core as any, db, {
            downloadTimeout: 200,
            maxConcurrentDownloads: 1,
            maxRetries: 0,
            healthCheckInterval: 60_000,
        });
        handler.setSkipDownloadTypes(['file']);
        handler.setSkipDownloadTypes([]); // 重置

        const message = msg({
            peerUid: 'peer_test',
            chatType: 1,
            senderUid: 'u_other',
        }).file({ filename: 'spec.pdf', size: 4096, md5: 'cafebabe2' }).build();

        const resourceMap = await handler.processMessageResources([message]);
        const resources = resourceMap.get(message.msgId)!;
        assert.equal(resources.length, 1);
        // 默认行为下不会进入 SKIPPED 路径；这里不强约束最终状态
        // （实际状态依赖健康检查与下载结果），只断言不是 SKIPPED。
        assert.notEqual(resources[0].status, ResourceStatus.SKIPPED);

        await handler.cleanup();
        await db.close();
    } finally {
        if (prevUserProfile === undefined) {
            delete process.env['USERPROFILE'];
        } else {
            process.env['USERPROFILE'] = prevUserProfile;
        }
        dbHome.cleanup();
        resHome.cleanup();
    }
});
