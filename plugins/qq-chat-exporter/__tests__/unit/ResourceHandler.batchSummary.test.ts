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
 * Issue #363 — `processMessageResources` 之后能拿到一个干净的批次摘要：
 *   - attempted 包含本次扫描到的所有资源；
 *   - skipped 计 `setSkipDownloadTypes` 命中的；
 *   - failed / downloaded 区分对，能让 ApiServer 给用户一句话总结，
 *     避免他们把 NapCat 的 `[Rkey] 所有服务均已禁用` 日志当成导出失败。
 *
 * 测试只走「跳过文件 + 一张图片下载失败」这条最常见的、最贴近 #363 截图场景的路径。
 */

function tmpDir(prefix: string): { dir: string; cleanup: () => void } {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
    return { dir, cleanup: () => fs.rmSync(dir, { recursive: true, force: true }) };
}

test('processMessageResources 后 getLastBatchSummary 返回正确的 attempted/skipped/failed', async () => {
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

        // 一条消息带 1 个图片 + 1 个文件。文件被跳过下载，图片走默认健康检查（mock 环境拿不到合法链接）。
        const m = msg({ peerUid: 'peer_a', chatType: 1, senderUid: 'u_other' })
            .image({ md5: 'aabbccdd11', fileName: 'pic.jpg' })
            .file({ filename: 'spec.pdf', size: 1024, md5: 'aabbccdd22' })
            .build();

        const resourceMap = await handler.processMessageResources([m]);
        const summary = handler.getLastBatchSummary();

        // 摘要总数应该等于实际解析出的资源数
        const totalParsed = (resourceMap.get(m.msgId) || []).length;
        assert.equal(summary.attempted, totalParsed);
        assert.ok(summary.attempted >= 1, 'attempted 至少应当包含图片或文件中的一个');
        assert.equal(summary.skipped, 1, '文件应被跳过');
        // 摘要的四项加起来应等于 attempted（不重不漏）
        assert.equal(
            summary.alreadyAvailable + summary.downloaded + summary.failed + summary.skipped,
            summary.attempted,
        );
        // 命中的所有资源里至少图片那条不会是 SKIPPED
        const resources = resourceMap.get(m.msgId)!;
        const nonSkipped = resources.filter(r => r.status !== ResourceStatus.SKIPPED);
        assert.ok(nonSkipped.length >= 1);

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

test('failedSamples 最多收集 5 条', async () => {
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
            downloadTimeout: 100,
            maxConcurrentDownloads: 2,
            maxRetries: 0,
            healthCheckInterval: 60_000,
        });

        // 7 张图片，模拟所有图片都拿不到 url（mock 环境本就如此）。
        const m = msg({ peerUid: 'peer_b', chatType: 1, senderUid: 'u_other' });
        for (let i = 0; i < 7; i++) {
            m.image({ md5: `face00${i}`, fileName: `img-${i}.jpg` });
        }

        await handler.processMessageResources([m.build()]);
        const summary = handler.getLastBatchSummary();

        assert.equal(summary.attempted, 7);
        // 不强约束 failed 的具体数目（mock 网络环境结果有抖动），但 failedSamples 永远不超过 5。
        assert.ok(summary.failedSamples.length <= 5, `failedSamples 不应超过 5 条，实际 ${summary.failedSamples.length}`);

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

test('再次调用 processMessageResources 时摘要会被重置而不是累加', async () => {
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
            downloadTimeout: 100,
            maxConcurrentDownloads: 1,
            maxRetries: 0,
            healthCheckInterval: 60_000,
        });
        handler.setSkipDownloadTypes(['file']);

        const m1 = msg({ peerUid: 'p', chatType: 1, senderUid: 'u' })
            .file({ filename: 'a.pdf', size: 1, md5: 'aaaa01' })
            .build();
        const m2 = msg({ peerUid: 'p', chatType: 1, senderUid: 'u' })
            .file({ filename: 'b.pdf', size: 1, md5: 'aaaa02' })
            .file({ filename: 'c.pdf', size: 1, md5: 'aaaa03' })
            .build();

        await handler.processMessageResources([m1]);
        const first = handler.getLastBatchSummary();
        assert.equal(first.attempted, 1);
        assert.equal(first.skipped, 1);

        await handler.processMessageResources([m2]);
        const second = handler.getLastBatchSummary();
        assert.equal(second.attempted, 2, '第二批应只看到 2 条，不应累加上一次的');
        assert.equal(second.skipped, 2);

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

test('空消息列表给出 attempted=0 的摘要', async () => {
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
            downloadTimeout: 100,
            maxConcurrentDownloads: 1,
            maxRetries: 0,
            healthCheckInterval: 60_000,
        });

        await handler.processMessageResources([]);
        const summary = handler.getLastBatchSummary();
        assert.deepEqual(summary, {
            attempted: 0,
            alreadyAvailable: 0,
            downloaded: 0,
            failed: 0,
            skipped: 0,
            failedSamples: [],
        });

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
