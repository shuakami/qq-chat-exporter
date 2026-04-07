import type { NapCatCore } from 'NapCatQQ/src/core/index.js';
import type { CleanMessage } from '../parser/SimpleMessageParser.js';
import { DecryptedSqliteQueryBackend } from './DecryptedSqliteQueryBackend.js';

type DatabaseParam = string | number | bigint | Buffer | Uint8Array | null;
type DatabaseCell = string | number | bigint | Buffer | Uint8Array | null | undefined;
type DatabaseRow = Record<string, DatabaseCell>;

interface DatabaseApiLike {
    hasPassphrase?: () => boolean;
    isSqliteAvailable?: () => Promise<boolean>;
    decryptDatabase?: (dbName: string, outputPath?: string) => string | null;
    query<T extends DatabaseRow = DatabaseRow>(
        dbName: string,
        sql: string,
        params?: readonly DatabaseParam[]
    ): T[] | null;
}

interface DatabaseQueryBackend {
    query<T extends DatabaseRow = DatabaseRow>(
        tableName: string,
        sql: string,
        params?: readonly DatabaseParam[]
    ): Promise<T[]>;
    dispose(): void;
}

interface TableColumnInfo extends DatabaseRow {
    cid: number | string;
    name: string;
    type: string;
    notnull?: number | string;
    pk?: number | string;
}

interface PeerInfoLike {
    chatType: number;
    peerUid: string;
}

interface MessageFilterLike {
    startTime?: number;
    endTime?: number;
}

interface RowShapeDetection {
    tableName: string;
    peerColumn: string;
    timeColumn?: string;
    idColumn?: string;
    seqColumn?: string;
    senderColumn?: string;
    senderNameColumn?: string;
    typeColumn?: string;
    textColumns: string[];
    blobColumns: string[];
}

export interface DatabaseSessionExportResult {
    messages: CleanMessage[];
    identifiers: string[];
    detectedShape: RowShapeDetection;
}

const NT_MSG_DB = 'nt_msg.db';
const UID_MAPPING_TABLE = 'nt_uid_mapping_table';

const TEXT_COLUMN_PRIORITY = [
    '40093',
    '40090',
    '40021',
    '40020',
    '40096',
    '40095',
    '40004',
    '40005'
];

const TYPE_COLUMN_PRIORITY = [
    '40026',
    '40003',
    '40008',
    '40009',
    '40105'
];

const TIME_COLUMN_PRIORITY = [
    '40050',
    '40058',
    '40005',
    '40006',
    '40001',
    '40002',
    '40003',
    '40010',
    '40011',
    '40012',
    '40013'
];

const SEQ_COLUMN_PRIORITY = [
    '40002',
    '40001',
    '40003',
    '40010',
    '40011',
    '40012',
    '40013'
];

const TIMESTAMP_MIN_MS = Date.UTC(2000, 0, 1);
const TIMESTAMP_MAX_MS = Date.UTC(2100, 0, 1);

export class QQNTDatabaseService {
    constructor(private readonly core: NapCatCore) {}

    async exportSessionMessages(
        peer: PeerInfoLike,
        filter?: MessageFilterLike,
        preferredPeerName?: string
    ): Promise<DatabaseSessionExportResult> {
        const tableName = Number(peer.chatType) === 2 ? 'group_msg_table' : 'c2c_msg_table';
        const backend = await this.createQueryBackend(NT_MSG_DB);

        try {
            await this.ensureTableExists(backend, tableName);

            const identifiers = await this.resolvePeerIdentifiers(backend, peer.peerUid);
            const columns = await this.getTableColumns(backend, tableName);
            if (columns.length === 0) {
                throw new Error(`数据库表 ${tableName} 不存在或无法读取`);
            }

            const peerColumn = await this.detectPeerColumn(backend, tableName, columns, identifiers);
            if (!peerColumn) {
                throw new Error(`没有在 ${tableName} 里找到与 ${peer.peerUid} 对应的会话字段`);
            }

            const sampleRows = await this.queryRows<DatabaseRow>(
                backend,
                tableName,
                `SELECT rowid AS "__qce_rowid", * FROM ${this.quoteIdentifier(tableName)}
                 WHERE ${this.buildInTextCondition(peerColumn, identifiers.length)}
                 LIMIT 200`,
                identifiers
            );

            if (sampleRows.length === 0) {
                throw new Error(`数据库中没有找到 ${peer.peerUid} 对应的聊天记录`);
            }

            const selfIdentifiers = this.getSelfIdentifiers();
            const timeColumn = this.detectTimeColumn(columns, sampleRows, peerColumn);
            const idColumn = this.detectIdColumn(columns, sampleRows, peerColumn);
            const seqColumn = this.detectSeqColumn(columns, sampleRows, peerColumn);
            const senderColumn = this.detectSenderColumn(columns, sampleRows, {
                peerColumn,
                timeColumn,
                idColumn,
                seqColumn,
                peerIdentifiers: identifiers,
                selfIdentifiers
            });
            const senderNameColumn = this.detectSenderNameColumn(columns, sampleRows, {
                peerColumn,
                timeColumn,
                idColumn,
                seqColumn,
                senderColumn
            });

            const detectedShape: RowShapeDetection = {
                tableName,
                peerColumn,
                timeColumn,
                idColumn,
                seqColumn,
                senderColumn,
                senderNameColumn,
                typeColumn: this.detectTypeColumn(columns, sampleRows, peerColumn),
                textColumns: this.detectTextColumns(columns),
                blobColumns: columns
                    .filter(column => this.isBlobColumn(column))
                    .map(column => column.name)
            };

            const orderBy = detectedShape.timeColumn
                ? `CAST(${this.quoteIdentifier(detectedShape.timeColumn)} AS INTEGER) ASC, "__qce_rowid" ASC`
                : `"__qce_rowid" ASC`;

            const rows = await this.queryRows<DatabaseRow>(
                backend,
                tableName,
                `SELECT rowid AS "__qce_rowid", * FROM ${this.quoteIdentifier(tableName)}
                 WHERE ${this.buildInTextCondition(peerColumn, identifiers.length)}
                 ORDER BY ${orderBy}`,
                identifiers
            );

            const peerLabel = preferredPeerName?.trim() || (Number(peer.chatType) === 2 ? `群聊 ${peer.peerUid}` : `好友 ${peer.peerUid}`);

            const startTimeMs = this.normalizeFilterTimestamp(filter?.startTime, false);
            const endTimeMs = this.normalizeFilterTimestamp(filter?.endTime, true);

            const messages = rows
                .map((row, index) => this.convertRowToCleanMessage(row, detectedShape, {
                    chatType: Number(peer.chatType) === 2 ? 'group' : 'private',
                    peerIdentifiers: identifiers,
                    selfIdentifiers,
                    peerLabel,
                    fallbackIndex: index + 1
                }))
                .filter((message): message is CleanMessage => Boolean(message))
                .filter(message => {
                    if (!message.timestamp) {
                        return true;
                    }
                    if (startTimeMs !== undefined && message.timestamp < startTimeMs) {
                        return false;
                    }
                    if (endTimeMs !== undefined && message.timestamp > endTimeMs) {
                        return false;
                    }
                    return true;
                })
                .sort((a, b) => {
                    if (a.timestamp !== b.timestamp) {
                        return a.timestamp - b.timestamp;
                    }
                    return String(a.seq || '').localeCompare(String(b.seq || ''));
                });

            if (messages.length === 0) {
                throw new Error('数据库中没有找到符合筛选条件的聊天记录');
            }

            return {
                messages,
                identifiers,
                detectedShape
            };
        } finally {
            backend.dispose();
        }
    }

    private resolveDatabaseApi(): DatabaseApiLike {
        const apis = (this.core as NapCatCore & {
            apis?: {
                DatabaseApi?: DatabaseApiLike;
                UserApi?: {
                    getUidByUinV2?: (uin: string) => Promise<string | undefined>;
                };
            };
        }).apis;

        const databaseApi = apis?.DatabaseApi;
        if (!databaseApi || typeof databaseApi.query !== 'function') {
            throw new Error('当前 NapCat 实例未提供 DatabaseApi');
        }

        if (typeof databaseApi.hasPassphrase === 'function' && !databaseApi.hasPassphrase()) {
            throw new Error('当前 NapCat 还没有拿到数据库密钥，请先确保 QQ 已登录且 NapCat 已完成初始化');
        }

        return databaseApi;
    }

    private async createQueryBackend(dbName: string): Promise<DatabaseQueryBackend> {
        const databaseApi = this.resolveDatabaseApi();
        let fallbackBackend: DatabaseQueryBackend | null = null;
        let fallbackReason: string | null = null;

        const ensureFallbackBackend = async (reason: string): Promise<DatabaseQueryBackend> => {
            if (!fallbackBackend) {
                this.logWarn(`原生数据库查询将切换到解密后明文库读取: ${reason}`);
                fallbackBackend = await this.createDecryptedFallbackBackend(databaseApi, dbName);
            }

            fallbackReason = reason;
            return fallbackBackend;
        };

        if (typeof databaseApi.isSqliteAvailable === 'function') {
            try {
                const available = await databaseApi.isSqliteAvailable();
                if (available === false) {
                    return ensureFallbackBackend(`当前运行时缺少 node:sqlite: ${dbName}`);
                }
            } catch (error) {
                this.logWarn(`检查 node:sqlite 可用性失败，继续尝试直接查询数据库: ${this.stringifyError(error)}`);
            }
        }

        try {
            const probeResult = databaseApi.query<{ qce_probe: number }>(
                dbName,
                'SELECT 1 AS qce_probe'
            );

            if (!probeResult) {
                throw new Error(`读取数据库 ${dbName} 失败`);
            }

            return {
                query: async <T extends DatabaseRow = DatabaseRow>(
                    tableName: string,
                    sql: string,
                    params: readonly DatabaseParam[] = []
                ): Promise<T[]> => {
                    if (fallbackBackend) {
                        return fallbackBackend.query<T>(tableName, sql, params);
                    }

                    try {
                        const result = databaseApi.query<T>(dbName, sql, params);
                        if (!result) {
                            throw new Error(`读取数据库表 ${tableName} 失败`);
                        }
                        return result;
                    } catch (error) {
                        if (!this.shouldUseDecryptedFallback(error)) {
                            throw error;
                        }

                        const backend = await ensureFallbackBackend(
                            `原生查询 ${tableName} 失败: ${this.stringifyError(error)}`
                        );
                        return backend.query<T>(tableName, sql, params);
                    }
                },
                dispose: () => {
                    fallbackBackend?.dispose();
                    if (fallbackReason) {
                        this.logWarn(`本次数据库导出已使用明文库后备通道完成读取: ${fallbackReason}`);
                    }
                }
            };
        } catch (error) {
            if (this.shouldUseDecryptedFallback(error)) {
                return ensureFallbackBackend(`DatabaseApi.query 初始化失败: ${this.stringifyError(error)}`);
            }

            throw error;
        }
    }

    private async createDecryptedFallbackBackend(
        databaseApi: DatabaseApiLike,
        dbName: string
    ): Promise<DatabaseQueryBackend> {
        const backend = await DecryptedSqliteQueryBackend.create(
            dbName,
            databaseApi,
            this.core.selfInfo?.uin
        );

        return {
            query: async <T extends DatabaseRow = DatabaseRow>(
                tableName: string,
                sql: string,
                params: readonly DatabaseParam[] = []
            ): Promise<T[]> => {
                try {
                    return backend.query<T>(sql, params);
                } catch (error) {
                    throw new Error(`读取数据库表 ${tableName} 失败: ${this.stringifyError(error)}`);
                }
            },
            dispose: () => backend.dispose()
        };
    }

    private async queryRows<T extends DatabaseRow>(
        backend: DatabaseQueryBackend,
        tableName: string,
        sql: string,
        params: readonly DatabaseParam[] = []
    ): Promise<T[]> {
        return backend.query<T>(tableName, sql, params);
    }

    private async ensureTableExists(backend: DatabaseQueryBackend, tableName: string): Promise<void> {
        const rows = await backend.query<{ name: string }>(
            tableName,
            'SELECT name FROM sqlite_master WHERE type = ? AND name = ? LIMIT 1',
            ['table', tableName]
        );

        if (!rows || rows.length === 0) {
            throw new Error(`数据库里没有找到 ${tableName}`);
        }
    }

    private getTableColumns(backend: DatabaseQueryBackend, tableName: string): Promise<TableColumnInfo[]> {
        return this.queryRows<TableColumnInfo>(
            backend,
            tableName,
            `PRAGMA table_info(${this.quoteIdentifier(tableName)})`
        );
    }

    private async resolvePeerIdentifiers(
        backend: DatabaseQueryBackend,
        peerUid: string
    ): Promise<string[]> {
        const identifiers = new Set<string>();
        const queue: string[] = [];
        const normalizedPeerUid = peerUid.trim();
        if (!normalizedPeerUid) {
            return [];
        }

        queue.push(normalizedPeerUid);
        identifiers.add(normalizedPeerUid);

        const userApi = (this.core as NapCatCore & {
            apis?: {
                UserApi?: {
                    getUidByUinV2?: (uin: string) => Promise<string | undefined>;
                };
            };
        }).apis?.UserApi;

        if (/^\d+$/.test(normalizedPeerUid) && typeof userApi?.getUidByUinV2 === 'function') {
            try {
                const uid = await userApi.getUidByUinV2(normalizedPeerUid);
                if (uid && uid.trim()) {
                    queue.push(uid.trim());
                    identifiers.add(uid.trim());
                }
            } catch {
                // 忽略在线映射失败，继续走本地映射表
            }
        }

        try {
            await this.ensureTableExists(backend, UID_MAPPING_TABLE);
        } catch {
            return Array.from(identifiers);
        }

        const mappingColumns = (await this.getTableColumns(backend, UID_MAPPING_TABLE))
            .filter(column => !this.isBlobColumn(column));

        let safetyCounter = 0;
        while (queue.length > 0 && safetyCounter < 30) {
            safetyCounter++;
            const current = queue.shift();
            if (!current) {
                continue;
            }

            for (const column of mappingColumns) {
                const rows = await this.queryRows<DatabaseRow>(
                    backend,
                    UID_MAPPING_TABLE,
                    `SELECT * FROM ${this.quoteIdentifier(UID_MAPPING_TABLE)}
                     WHERE CAST(${this.quoteIdentifier(column.name)} AS TEXT) = ?
                     LIMIT 1`,
                    [current]
                );

                if (rows.length === 0) {
                    continue;
                }

                for (const value of Object.values(rows[0])) {
                    const identifier = this.normalizeIdentifier(value);
                    if (!identifier || identifiers.has(identifier)) {
                        continue;
                    }
                    identifiers.add(identifier);
                    queue.push(identifier);
                }
            }
        }

        return Array.from(identifiers);
    }

    private async detectPeerColumn(
        backend: DatabaseQueryBackend,
        tableName: string,
        columns: TableColumnInfo[],
        identifiers: string[]
    ): Promise<string | undefined> {
        let bestColumn: string | undefined;
        let bestScore = 0;

        for (const column of columns) {
            if (this.isBlobColumn(column)) {
                continue;
            }

            const rows = await this.queryRows<{ matched_count: number | string }>(
                backend,
                tableName,
                `SELECT COUNT(1) AS matched_count
                 FROM ${this.quoteIdentifier(tableName)}
                 WHERE ${this.buildInTextCondition(column.name, identifiers.length)}`,
                identifiers
            );

            const score = Number(rows[0]?.matched_count || 0);
            if (score > bestScore) {
                bestScore = score;
                bestColumn = column.name;
            }
        }

        return bestColumn;
    }

    private detectTimeColumn(
        columns: TableColumnInfo[],
        sampleRows: DatabaseRow[],
        peerColumn: string
    ): string | undefined {
        const candidates = columns.filter(column => !this.isBlobColumn(column) && column.name !== peerColumn);
        let bestColumn: string | undefined;
        let bestScore = -1;

        for (const column of candidates) {
            let score = 0;
            for (const row of sampleRows) {
                const timestamp = this.normalizeTimestamp(row[column.name]);
                if (timestamp !== undefined) {
                    score++;
                }
            }

            if (score > bestScore || (score === bestScore && this.comparePriority(column.name, bestColumn, TIME_COLUMN_PRIORITY) < 0)) {
                bestScore = score;
                bestColumn = score > 0 ? column.name : bestColumn;
            }
        }

        return bestColumn;
    }

    private detectIdColumn(
        columns: TableColumnInfo[],
        sampleRows: DatabaseRow[],
        peerColumn: string
    ): string | undefined {
        const candidates = columns.filter(column => !this.isBlobColumn(column) && column.name !== peerColumn);
        const seenCounts = new Map<string, number>();

        for (const column of candidates) {
            const values = sampleRows
                .map(row => this.normalizeIdentifier(row[column.name]))
                .filter((value): value is string => Boolean(value));

            if (values.length === 0) {
                continue;
            }

            seenCounts.set(column.name, new Set(values).size);
        }

        return [...seenCounts.entries()]
            .sort((a, b) => {
                if (b[1] !== a[1]) {
                    return b[1] - a[1];
                }
                return this.comparePriority(a[0], b[0], TEXT_COLUMN_PRIORITY);
            })[0]?.[0];
    }

    private detectSeqColumn(
        columns: TableColumnInfo[],
        sampleRows: DatabaseRow[],
        peerColumn: string
    ): string | undefined {
        const candidates = columns
            .filter(column => !this.isBlobColumn(column) && column.name !== peerColumn)
            .map(column => column.name);

        return candidates.sort((a, b) => this.comparePriority(a, b, SEQ_COLUMN_PRIORITY))[0];
    }

    private detectSenderColumn(
        columns: TableColumnInfo[],
        sampleRows: DatabaseRow[],
        excluded: {
            peerColumn: string;
            timeColumn?: string;
            idColumn?: string;
            seqColumn?: string;
            peerIdentifiers: string[];
            selfIdentifiers: string[];
        }
    ): string | undefined {
        const excludedNames = new Set([
            excluded.peerColumn,
            excluded.timeColumn,
            excluded.idColumn,
            excluded.seqColumn
        ].filter((value): value is string => Boolean(value)));

        const candidates = columns.filter(column => !this.isBlobColumn(column) && !excludedNames.has(column.name));
        let bestColumn: string | undefined;
        let bestScore = -1;
        const knownIdentifiers = new Set([
            ...excluded.peerIdentifiers,
            ...excluded.selfIdentifiers
        ]);

        for (const column of candidates) {
            const values = sampleRows
                .map(row => this.normalizeIdentifier(row[column.name]))
                .filter((value): value is string => Boolean(value));

            if (values.length === 0) {
                continue;
            }

            const avgLength = values.reduce((sum, value) => sum + value.length, 0) / values.length;
            if (avgLength > 32) {
                continue;
            }

            const uniqueCount = new Set(values).size;
            const matchedKnownIdentifiers = values.filter(value => knownIdentifiers.has(value)).length;
            const smallNumericCount = values.filter(value => /^\d+$/.test(value) && Number(value) >= 0 && Number(value) <= 32).length;

            let score = uniqueCount * 10 - Math.round(avgLength);
            score += matchedKnownIdentifiers * 40;
            score -= smallNumericCount * 8;

            if (/(sender|from|user|member|uin|uid|nick|name)/i.test(column.name)) {
                score += 25;
            }
            if (/(type|time|seq|msg|text|content)/i.test(column.name)) {
                score -= 12;
            }

            if (score > bestScore) {
                bestScore = score;
                bestColumn = column.name;
            }
        }

        return bestColumn;
    }

    private detectSenderNameColumn(
        columns: TableColumnInfo[],
        sampleRows: DatabaseRow[],
        excluded: {
            peerColumn: string;
            timeColumn?: string;
            idColumn?: string;
            seqColumn?: string;
            senderColumn?: string;
        }
    ): string | undefined {
        const excludedNames = new Set([
            excluded.peerColumn,
            excluded.timeColumn,
            excluded.idColumn,
            excluded.seqColumn,
            excluded.senderColumn
        ].filter((value): value is string => Boolean(value)));

        const textColumns = columns.filter(column =>
            !this.isBlobColumn(column) &&
            !excludedNames.has(column.name) &&
            this.isTextColumn(column)
        );

        let bestColumn: string | undefined;
        let bestScore = -1;

        for (const column of textColumns) {
            const lengths = sampleRows
                .map(row => this.extractReadableText(row[column.name]))
                .filter((value): value is string => Boolean(value))
                .map(value => value.length);

            if (lengths.length === 0) {
                continue;
            }

            const avgLength = lengths.reduce((sum, length) => sum + length, 0) / lengths.length;
            if (avgLength > 24) {
                continue;
            }
            if (avgLength > bestScore) {
                bestScore = avgLength;
                bestColumn = column.name;
            }
        }

        return bestColumn;
    }

    private detectTypeColumn(
        columns: TableColumnInfo[],
        sampleRows: DatabaseRow[],
        peerColumn: string
    ): string | undefined {
        const candidates = columns.filter(column =>
            !this.isBlobColumn(column) &&
            column.name !== peerColumn &&
            !this.isTextColumn(column)
        );

        let bestColumn: string | undefined;
        let bestScore = -1;

        for (const column of candidates) {
            const values = sampleRows
                .map(row => this.toFiniteNumber(row[column.name]))
                .filter((value): value is number => value !== undefined);

            if (values.length === 0) {
                continue;
            }

            const distinct = new Set(values).size;
            if (distinct <= 12 && distinct > bestScore) {
                bestScore = distinct;
                bestColumn = column.name;
            }
        }

        return [bestColumn, ...TYPE_COLUMN_PRIORITY]
            .filter((value): value is string => Boolean(value))
            .find((value, index, array) => array.indexOf(value) === index && candidates.some(candidate => candidate.name === value));
    }

    private detectTextColumns(columns: TableColumnInfo[]): string[] {
        const columnNames = columns
            .filter(column => this.isTextColumn(column))
            .map(column => column.name);

        const prioritized = TEXT_COLUMN_PRIORITY.filter(name => columnNames.includes(name));
        const rest = columnNames.filter(name => !prioritized.includes(name));
        return [...prioritized, ...rest];
    }

    private convertRowToCleanMessage(
        row: DatabaseRow,
        shape: RowShapeDetection,
        context: {
            chatType: 'group' | 'private';
            peerIdentifiers: string[];
            selfIdentifiers: string[];
            peerLabel: string;
            fallbackIndex: number;
        }
    ): CleanMessage | null {
        const rowId = this.normalizeIdentifier(row.__qce_rowid) || String(context.fallbackIndex);
        const timestamp = shape.timeColumn ? this.normalizeTimestamp(row[shape.timeColumn]) : undefined;
        const senderValue = shape.senderColumn ? this.normalizeIdentifier(row[shape.senderColumn]) : undefined;
        const senderNameCandidate = shape.senderNameColumn
            ? this.extractReadableText(row[shape.senderNameColumn])
            : undefined;
        const text = this.extractMessageText(row, shape, context.peerIdentifiers, context.selfIdentifiers);
        const type = this.resolveMessageType(shape.typeColumn ? row[shape.typeColumn] : undefined, text);

        const senderName = this.resolveSenderName(
            senderValue,
            senderNameCandidate,
            context.chatType,
            context.peerIdentifiers,
            context.selfIdentifiers,
            context.peerLabel
        );

        const messageId = shape.idColumn
            ? this.normalizeIdentifier(row[shape.idColumn]) || `db_${shape.tableName}_${rowId}`
            : `db_${shape.tableName}_${rowId}`;

        const messageSeq = shape.seqColumn
            ? this.normalizeIdentifier(row[shape.seqColumn]) || rowId
            : rowId;

        const normalizedTimestamp = timestamp ?? 0;
        const messageTime = normalizedTimestamp > 0
            ? new Date(normalizedTimestamp).toISOString()
            : new Date(0).toISOString();

        const senderUin = senderValue && /^\d+$/.test(senderValue) ? senderValue : undefined;
        const senderUid = senderValue || 'unknown';
        const html = text ? this.escapeHtml(text).replace(/\r?\n/g, '<br />') : '';

        return {
            id: messageId,
            seq: messageSeq,
            timestamp: normalizedTimestamp,
            time: messageTime,
            sender: {
                uid: senderUid,
                uin: senderUin,
                name: senderName
            },
            type,
            content: {
                text,
                html,
                elements: text
                    ? [{
                        type: 'text',
                        data: { text }
                    }]
                    : [],
                resources: [],
                mentions: []
            },
            recalled: false,
            system: type === 'system'
        };
    }

    private extractMessageText(
        row: DatabaseRow,
        shape: RowShapeDetection,
        peerIdentifiers: string[],
        selfIdentifiers: string[]
    ): string {
        const excludedValues = new Set([
            ...peerIdentifiers.map(value => value.trim()),
            ...selfIdentifiers.map(value => value.trim())
        ]);

        const candidates: string[] = [];
        for (const column of shape.textColumns) {
            const value = this.extractReadableText(row[column]);
            if (!value || excludedValues.has(value)) {
                continue;
            }
            candidates.push(value);
        }

        if (candidates.length === 0) {
            for (const column of shape.blobColumns) {
                const value = this.extractReadableText(row[column]);
                if (!value || excludedValues.has(value)) {
                    continue;
                }
                candidates.push(value);
            }
        }

        return candidates
            .sort((a, b) => this.scoreTextCandidate(b, excludedValues) - this.scoreTextCandidate(a, excludedValues))[0]
            || '';
    }

    private resolveSenderName(
        senderValue: string | undefined,
        senderNameCandidate: string | undefined,
        chatType: 'group' | 'private',
        peerIdentifiers: string[],
        selfIdentifiers: string[],
        peerLabel: string
    ): string {
        if (senderNameCandidate && !peerIdentifiers.includes(senderNameCandidate) && !selfIdentifiers.includes(senderNameCandidate)) {
            return senderNameCandidate;
        }

        if (senderValue) {
            if (selfIdentifiers.includes(senderValue)) {
                return this.core.selfInfo?.nick || '我';
            }

            if (chatType === 'private' && peerIdentifiers.includes(senderValue)) {
                return peerLabel;
            }

            return senderValue;
        }

        return chatType === 'private' ? peerLabel : '未知用户';
    }

    private resolveMessageType(typeValue: DatabaseCell, text: string): string {
        const rawType = this.toFiniteNumber(typeValue);
        if (rawType !== undefined) {
            switch (rawType) {
                case 1:
                case 2:
                    return 'text';
                case 3:
                    return 'file';
                case 4:
                case 7:
                    return 'video';
                case 5:
                    return 'system';
                case 6:
                    return 'audio';
                case 8:
                    return 'forward';
                case 9:
                    return 'reply';
                case 11:
                    return 'card';
                default:
                    break;
            }
        }

        if (!text) {
            return 'unknown';
        }

        if (/撤回|加入群|退出群|修改群名|邀请/.test(text)) {
            return 'system';
        }

        return 'text';
    }

    private normalizeTimestamp(value: DatabaseCell): number | undefined {
        const numericValue = this.toFiniteNumber(value);
        if (numericValue === undefined) {
            const textValue = this.normalizeIdentifier(value);
            if (!textValue) {
                return undefined;
            }

            const parsedDate = Date.parse(textValue);
            if (Number.isFinite(parsedDate) && parsedDate >= TIMESTAMP_MIN_MS && parsedDate <= TIMESTAMP_MAX_MS) {
                return parsedDate;
            }

            return undefined;
        }

        if (numericValue >= TIMESTAMP_MIN_MS && numericValue <= TIMESTAMP_MAX_MS) {
            return Math.round(numericValue);
        }

        if (numericValue >= TIMESTAMP_MIN_MS / 1000 && numericValue <= TIMESTAMP_MAX_MS / 1000) {
            return Math.round(numericValue * 1000);
        }

        if (numericValue >= TIMESTAMP_MIN_MS * 1000 && numericValue <= TIMESTAMP_MAX_MS * 1000) {
            return Math.round(numericValue / 1000);
        }

        if (numericValue >= TIMESTAMP_MIN_MS * 1000000 && numericValue <= TIMESTAMP_MAX_MS * 1000000) {
            return Math.round(numericValue / 1000000);
        }

        return undefined;
    }

    private normalizeFilterTimestamp(value: number | undefined, endBoundary: boolean): number | undefined {
        if (value === undefined) {
            return undefined;
        }

        const timestamp = this.normalizeTimestamp(value);
        if (timestamp === undefined) {
            return undefined;
        }

        return endBoundary ? timestamp : timestamp;
    }

    private getSelfIdentifiers(): string[] {
        const values = [
            this.core.selfInfo?.uid,
            this.core.selfInfo?.uin ? String(this.core.selfInfo.uin) : undefined
        ];

        return values.filter((value): value is string => Boolean(value && value.trim()));
    }

    private buildInTextCondition(columnName: string, count: number): string {
        const placeholders = new Array(Math.max(count, 1)).fill('?').join(', ');
        return `CAST(${this.quoteIdentifier(columnName)} AS TEXT) IN (${placeholders})`;
    }

    private comparePriority(
        left: string | undefined,
        right: string | undefined,
        priorityList: string[]
    ): number {
        const leftIndex = left ? priorityList.indexOf(left) : -1;
        const rightIndex = right ? priorityList.indexOf(right) : -1;
        const safeLeftIndex = leftIndex === -1 ? Number.MAX_SAFE_INTEGER : leftIndex;
        const safeRightIndex = rightIndex === -1 ? Number.MAX_SAFE_INTEGER : rightIndex;
        return safeLeftIndex - safeRightIndex;
    }

    private isBlobColumn(column: TableColumnInfo): boolean {
        return String(column.type || '').toUpperCase().includes('BLOB');
    }

    private isTextColumn(column: TableColumnInfo): boolean {
        return String(column.type || '').toUpperCase().includes('TEXT');
    }

    private toFiniteNumber(value: DatabaseCell): number | undefined {
        if (typeof value === 'number' && Number.isFinite(value)) {
            return value;
        }

        if (typeof value === 'bigint') {
            const converted = Number(value);
            return Number.isFinite(converted) ? converted : undefined;
        }

        if (typeof value === 'string') {
            const trimmed = value.trim();
            if (!trimmed) {
                return undefined;
            }

            const converted = Number(trimmed);
            return Number.isFinite(converted) ? converted : undefined;
        }

        return undefined;
    }

    private normalizeIdentifier(value: DatabaseCell): string | undefined {
        if (typeof value === 'number' || typeof value === 'bigint') {
            return String(value);
        }

        if (typeof value !== 'string') {
            return undefined;
        }

        const normalized = value.replace(/\u0000/g, '').trim();
        if (!normalized || normalized.length > 128) {
            return undefined;
        }

        return normalized;
    }

    private extractReadableText(value: DatabaseCell): string | undefined {
        if (typeof value === 'string') {
            return this.pickReadableTextCandidate(value);
        }

        if (Buffer.isBuffer(value)) {
            return this.pickReadableTextCandidate(value.toString('utf-8'));
        }

        if (value instanceof Uint8Array) {
            return this.pickReadableTextCandidate(Buffer.from(value).toString('utf-8'));
        }

        return undefined;
    }

    private pickReadableTextCandidate(rawText: string): string | undefined {
        const text = rawText
            .replace(/\u0000/g, ' ')
            .replace(/[\u0001-\u0008\u000b\u000c\u000e-\u001f]/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();

        if (!text) {
            return undefined;
        }

        const jsonText = this.tryExtractTextFromJson(text);
        if (jsonText) {
            return jsonText;
        }

        const segments = text.match(/[\u4e00-\u9fffA-Za-z0-9@#%&*+=:;,.!?，。！？、：“”"'‘’（）()【】\[\]《》<>\-_/\\ ]{2,}/gu) || [];
        const bestSegment = segments
            .map(segment => segment.trim())
            .filter(segment => segment.length >= 2)
            .sort((a, b) => b.length - a.length)[0];

        const candidate = bestSegment || text;
        return candidate.length > 5000 ? candidate.slice(0, 5000) : candidate;
    }

    private tryExtractTextFromJson(text: string): string | undefined {
        if ((!text.startsWith('{') && !text.startsWith('[')) || text.length > 200000) {
            return undefined;
        }

        try {
            const parsed = JSON.parse(text) as unknown;
            const collected: string[] = [];
            this.collectStringsFromJson(parsed, collected);
            return collected
                .map(item => item.trim())
                .filter(item => item.length >= 2)
                .sort((a, b) => b.length - a.length)[0];
        } catch {
            return undefined;
        }
    }

    private collectStringsFromJson(value: unknown, collector: string[]): void {
        if (typeof value === 'string') {
            const trimmed = value.trim();
            if (trimmed) {
                collector.push(trimmed);
            }
            return;
        }

        if (Array.isArray(value)) {
            for (const item of value) {
                this.collectStringsFromJson(item, collector);
            }
            return;
        }

        if (value && typeof value === 'object') {
            for (const item of Object.values(value)) {
                this.collectStringsFromJson(item, collector);
            }
        }
    }

    private scoreTextCandidate(text: string, excludedValues: Set<string>): number {
        if (excludedValues.has(text)) {
            return -1;
        }

        let score = text.length;
        if (/[\u4e00-\u9fff]/.test(text)) {
            score += 50;
        }
        if (/https?:\/\//i.test(text)) {
            score -= 20;
        }
        if (/^[A-Za-z0-9_-]+$/.test(text)) {
            score -= 10;
        }
        return score;
    }

    private shouldUseDecryptedFallback(error: unknown): boolean {
        const message = this.stringifyError(error);
        return /node:sqlite|experimental-sqlite|checkSqliteAvailable|ERR_OUT_OF_RANGE|out of range|too large to be represented as a JavaScript number/i.test(message);
    }

    private stringifyError(error: unknown): string {
        if (error instanceof Error) {
            const code = (error as Error & { code?: string }).code;
            return code ? `${code}: ${error.message}` : error.message;
        }

        if (typeof error === 'string') {
            return error;
        }

        try {
            return JSON.stringify(error);
        } catch {
            return String(error);
        }
    }

    private logWarn(message: string): void {
        const logger = this.core.context?.logger;
        if (typeof logger?.logWarn === 'function') {
            logger.logWarn(`[QQNTDatabaseService] ${message}`);
            return;
        }

        console.warn(`[QQNTDatabaseService] ${message}`);
    }

    private escapeHtml(text: string): string {
        return text
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    private quoteIdentifier(identifier: string): string {
        return `"${identifier.replace(/"/g, '""')}"`;
    }
}
