import fs from 'fs';
import os from 'os';
import path from 'path';
import { createRequire } from 'module';
import initSqlJs from 'sql.js';

export type DecryptedDatabaseParam = string | number | bigint | Buffer | Uint8Array | null;

interface SqlJsStatementLike {
    bind(values?: readonly unknown[]): void;
    step(): boolean;
    getAsObject(): Record<string, unknown>;
    free(): void;
}

interface SqlJsDatabaseLike {
    prepare(sql: string): SqlJsStatementLike;
    close?: () => void;
}

interface SqlJsModuleLike {
    Database: new (data?: Uint8Array) => SqlJsDatabaseLike;
}

interface DatabaseApiDecryptLike {
    decryptDatabase?: (dbName: string, outputPath?: string) => string | null;
}

const require = createRequire(import.meta.url);

let sqlJsModulePromise: Promise<SqlJsModuleLike> | null = null;

async function loadSqlJsModule(): Promise<SqlJsModuleLike> {
    if (!sqlJsModulePromise) {
        const wasmPath = require.resolve('sql.js/dist/sql-wasm.wasm');
        sqlJsModulePromise = initSqlJs({
            locateFile: (file: string) => file.endsWith('.wasm') ? wasmPath : file
        }) as Promise<SqlJsModuleLike>;
    }

    return sqlJsModulePromise;
}

function normalizeParam(value: DecryptedDatabaseParam): string | number | Uint8Array | null {
    if (value === null) {
        return null;
    }

    if (typeof value === 'bigint') {
        return Number(value);
    }

    if (Buffer.isBuffer(value)) {
        return new Uint8Array(value);
    }

    if (value instanceof Uint8Array) {
        return value;
    }

    return value;
}

export class DecryptedSqliteQueryBackend {
    constructor(
        private readonly database: SqlJsDatabaseLike,
        private readonly decryptedPath: string
    ) {}

    static async create(
        dbName: string,
        databaseApi: DatabaseApiDecryptLike,
        selfUin?: string | number
    ): Promise<DecryptedSqliteQueryBackend> {
        if (typeof databaseApi.decryptDatabase !== 'function') {
            throw new Error('当前 NapCat DatabaseApi 没有提供 decryptDatabase，无法在无 node:sqlite 环境下读取数据库');
        }

        const cacheDir = path.join(
            os.tmpdir(),
            'qq-chat-exporter-pro',
            'decrypted-db',
            String(selfUin ?? 'unknown')
        );

        fs.mkdirSync(cacheDir, { recursive: true });

        const baseName = path.basename(dbName, path.extname(dbName));
        const decryptedPath = path.join(
            cacheDir,
            `${baseName}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.db`
        );

        const outputPath = databaseApi.decryptDatabase(dbName, decryptedPath);
        if (!outputPath || !fs.existsSync(outputPath)) {
            throw new Error(`解密数据库 ${dbName} 失败`);
        }

        const SQL = await loadSqlJsModule();
        const rawBuffer = fs.readFileSync(outputPath);
        const database = new SQL.Database(new Uint8Array(rawBuffer));

        return new DecryptedSqliteQueryBackend(database, outputPath);
    }

    query<T = Record<string, unknown>>(
        sql: string,
        params: readonly DecryptedDatabaseParam[] = []
    ): T[] {
        const statement = this.database.prepare(sql);

        try {
            if (params.length > 0) {
                statement.bind(params.map(normalizeParam));
            }

            const rows: T[] = [];
            while (statement.step()) {
                rows.push(statement.getAsObject() as T);
            }

            return rows;
        } finally {
            statement.free();
        }
    }

    dispose(): void {
        try {
            this.database.close?.();
        } finally {
            try {
                fs.rmSync(this.decryptedPath, { force: true });
            } catch {
                // 忽略清理失败，避免覆盖主流程错误
            }
        }
    }
}
