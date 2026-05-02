import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { DatabaseManager } from '../../lib/core/storage/DatabaseManager.js';

function tmpDb(): { dbPath: string; dbDir: string; cleanup: () => void } {
    const dbDir = fs.mkdtempSync(path.join(os.tmpdir(), 'qce-db-'));
    const dbPath = path.join(dbDir, 'qce.sqlite');
    return {
        dbPath,
        dbDir,
        cleanup: () => fs.rmSync(dbDir, { recursive: true, force: true }),
    };
}

test('initialize 不再加载 messages.jsonl，避免遗留数据拖慢启动 (#309)', async () => {
    const { dbPath, dbDir, cleanup } = tmpDb();
    try {
        const messagesPath = path.join(dbDir, 'messages.jsonl');
        // 模拟旧版本累积下来的若干消息行
        const legacy = Array.from({ length: 100 }, (_, i) =>
            JSON.stringify({
                id: i,
                taskId: 'task-legacy',
                messageId: `m-${i}`,
                messageSeq: `${i}`,
                messageTime: `${1700000000 + i}`,
                senderUid: 'u_x',
                content: '{}',
                processed: false,
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
            }),
        ).join('\n');
        fs.writeFileSync(messagesPath, legacy + '\n', 'utf8');
        const beforeSize = fs.statSync(messagesPath).size;
        assert.ok(beforeSize > 0);

        const db = new DatabaseManager(dbPath);
        await db.initialize();

        // 文件被清空（归档过去）
        const afterSize = fs.statSync(messagesPath).size;
        assert.equal(afterSize, 0, 'messages.jsonl 应被清空');

        // 备份目录里能找到与之大小一致的归档
        const backupDir = path.join(dbDir, 'backups');
        const archives = fs
            .readdirSync(backupDir)
            .filter(name => name.startsWith('legacy-messages-'));
        assert.equal(archives.length, 1, '应该恰好有一份归档');
        const archiveSize = fs.statSync(path.join(backupDir, archives[0]!)).size;
        assert.equal(archiveSize, beforeSize, '归档大小应等于原文件');
    } finally {
        cleanup();
    }
});

test('initialize 在缺失 messages.jsonl 时不会创建归档', async () => {
    const { dbPath, dbDir, cleanup } = tmpDb();
    try {
        const db = new DatabaseManager(dbPath);
        await db.initialize();

        const backupDir = path.join(dbDir, 'backups');
        if (fs.existsSync(backupDir)) {
            const archives = fs
                .readdirSync(backupDir)
                .filter(name => name.startsWith('legacy-messages-'));
            assert.equal(archives.length, 0, '空数据库不应该产生归档');
        }

        // messages.jsonl 仍被作为空文件创建，便于后续运行时一致
        assert.ok(fs.existsSync(path.join(dbDir, 'messages.jsonl')));
    } finally {
        cleanup();
    }
});

test('initialize 在已有空 messages.jsonl 时静默跳过', async () => {
    const { dbPath, dbDir, cleanup } = tmpDb();
    try {
        const messagesPath = path.join(dbDir, 'messages.jsonl');
        fs.writeFileSync(messagesPath, '', 'utf8');

        const db = new DatabaseManager(dbPath);
        await db.initialize();

        const backupDir = path.join(dbDir, 'backups');
        if (fs.existsSync(backupDir)) {
            const archives = fs
                .readdirSync(backupDir)
                .filter(name => name.startsWith('legacy-messages-'));
            assert.equal(archives.length, 0, '空文件不应该被归档');
        }
    } finally {
        cleanup();
    }
});
