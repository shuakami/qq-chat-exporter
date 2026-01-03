/**
 * JSON格式导出器
 * 将聊天记录导出为结构化的JSON格式
 * 便于程序化处理和数据分析
 */

import { ExportFormat } from '../../types/index.js';
import type { ExportResult } from '../../types/index.js';
import { BaseExporter, ExportOptions } from './BaseExporter.js';
import { CleanMessage, SimpleMessageParser } from '../parser/SimpleMessageParser.js';
import { NapCatCore } from 'NapCatQQ/src/core/index.js';
import { RawMessage } from 'NapCatQQ/src/core/index.js';
import { ParsedMessage } from '../parser/MessageParser.js';
import { VERSION, APP_INFO } from '../../version.js';

import { ChunkedJsonlWriter } from './ChunkedJsonlWriter.js';
import type { ChunkedJsonlChunkInfo } from './ChunkedJsonlWriter.js';
import {
    JsonObjectStreamTemplates,
    JsonSingleFileTemplates,
    createJsonStreamContext,
    DEFAULT_AVATARS_FILE_NAME,
    DEFAULT_CHUNKS_DIR_NAME,
    DEFAULT_MANIFEST_FILE_NAME,
    formatChunkFileName,
    renderJsonFile
} from './JsonExportTemplates.js';
import { BufferedTextWriter, yieldToEventLoop } from './JsonStreamUtils.js';
import { StatsAccumulator } from './JsonStatsAccumulator.js';

/**
 * 分块 JSONL 导出选项接口（优化方案：manifest + chunks/*.jsonl）
 *
 * 说明：
 * - 这是“可选接口”，不会影响默认单文件 JSON 的导出与 UI/逻辑
 * - 该方案完全流式：不会把全量消息/全量 JSON 字符串堆进内存
 */
interface ChunkedJsonlExportOptions {
    /**
     * 输出目录（manifest.json + chunks/）
     * - 不传则从 options.outputPath 推导：<outputBase>_chunked_jsonl
     */
    outputDir: string;

    /** chunks 子目录名（默认 'chunks'） */
    chunksDirName: string;

    /** manifest 文件名（默认 'manifest.json'） */
    manifestFileName: string;

    /** avatars 文件名（默认 'avatars.json'，仅 embedAvatarsAsBase64=true 时生成） */
    avatarsFileName: string;

    /** chunk 文件扩展名（默认 '.jsonl'） */
    chunkFileExt: string;

    /** 每个 chunk 最大消息数（0 表示不限） */
    maxMessagesPerChunk: number;

    /** 每个 chunk 最大字节数（0 表示不限） */
    maxBytesPerChunk: number;

    /** parseMessagesStream 的 batchSize（越小越省内存，越大越快） */
    parseBatchSize: number;
}

/**
 * Chunked JSONL manifest 结构（给未来的 Viewer/索引/搜索做准备）
 */
interface ChunkedJsonlExportManifest {
    metadata: JsonExportData['metadata'];
    chatInfo: JsonExportData['chatInfo'];
    statistics: JsonExportData['statistics'];

    chunked: {
        /** 固定为 'jsonl' */
        format: 'jsonl';
        /** chunks 子目录 */
        chunksDir: string;
        /** chunk 文件扩展名 */
        chunkFileExt: string;
        /** chunk 策略 */
        maxMessagesPerChunk: number;
        maxBytesPerChunk: number;
        /** chunk 列表 */
        chunks: ChunkedJsonlChunkInfo[];
    };

    /** 可选：发送者头像映射文件 */
    avatars?: {
        file: string;
        count: number;
    };

    /** 可选：导出选项记录 */
    exportOptions?: JsonExportData['exportOptions'];
}

/**
 * Chunked JSONL 导出返回结果（兼容 ExportResult，并附带目录信息）
 */
interface ChunkedJsonlExportResult extends ExportResult {
    /** 输出目录 */
    outputDir: string;
    /** manifest 路径 */
    manifestPath: string;
    /** chunk 数量 */
    chunkCount: number;
}

/**
 * JSON格式选项接口
 */
interface JsonFormatOptions {
    /** 是否美化输出（格式化JSON） */
    pretty: boolean;
    /** 缩进字符数（当pretty为true时生效） */
    indent: number;
    /** 是否包含原始消息数据 */
    includeRawData: boolean;
    /** 是否包含详细的元数据 */
    includeMetadata: boolean;
    /** 是否压缩字段名（减少文件大小） */
    compactFieldNames: boolean;
    /** 数组分块大小（0表示不分块） */
    chunkSize: number;
    /** 是否将头像嵌入为base64（默认false） */
    embedAvatarsAsBase64: boolean;

    /**
     * 导出模式：
     * - 'single-json'：单文件 JSON（默认，保持现有逻辑/结构不变）
     * - 'chunked-jsonl'：manifest + chunks/*.jsonl（优化方案，可选）
     */
    exportMode: 'single-json' | 'chunked-jsonl';

    /**
     * chunked-jsonl 默认参数（可选）
     * - 也可以直接调用 exportChunkedJsonl() 传参覆盖
     */
    chunkedJsonl: Partial<ChunkedJsonlExportOptions>;
}

/**
 * JSON输出数据结构接口
 */
interface JsonExportData {
    /** 文件元信息 */
    metadata: {
        /** 软件名称 */
        name: string;
        /** 版权信息 */
        copyright: string;
        /** 软件版本 */
        version: string;
    };

    /** 聊天信息 */
    chatInfo: {
        /** 聊天名称 */
        name: string;
        /** 聊天类型 */
        type: string;
        /** 头像URL */
        avatar?: string;
        /** 参与人数 */
        participantCount?: number;
        /** 聊天创建时间 */
        createdAt?: string;
        /** 当前登录用户的UID */
        selfUid?: string;
        /** 当前登录用户的QQ号 */
        selfUin?: string;
        /** 当前登录用户的昵称 */
        selfName?: string;
    };

    /** 统计信息 */
    statistics: {
        /** 消息总数 */
        totalMessages: number;
        /** 时间范围 */
        timeRange: {
            /** 开始时间 */
            start: string;
            /** 结束时间 */
            end: string;
            /** 时间跨度（天） */
            durationDays: number;
        };
        /** 消息类型统计 */
        messageTypes: Record<string, number>;
        /** 发送者统计 */
        senders: Array<{
            /** 发送者UID */
            uid: string;
            /** 发送者名称 */
            name?: string;
            /** 消息数量 */
            messageCount: number;
            /** 占比 */
            percentage: number;
        }>;
        /** 资源统计 */
        resources: {
            /** 总资源数 */
            total: number;
            /** 按类型分组 */
            byType: Record<string, number>;
            /** 总大小（字节） */
            totalSize: number;
        };
    };

    /** 解析后的消息列表 - 使用自定义解析器处理过的格式 */
    messages: CleanMessage[];

    /** 导出选项记录 */
    exportOptions?: {
        /** 包含的字段 */
        includedFields: string[];
        /** 筛选条件 */
        filters: any;
        /** 其他选项 */
        options: any;
    };
}

// 不再需要自定义的 JsonMessage 接口，直接使用 RawMessage

/**
 * JSON格式导出器类
 * 生成结构化、易于解析的JSON格式聊天记录
 */
export class JsonExporter extends BaseExporter {
    private readonly jsonOptions: JsonFormatOptions;

    /**
     * 构造函数
     * @param options 基础导出选项
     * @param jsonOptions JSON格式选项
     */
    constructor(options: ExportOptions, jsonOptions: Partial<JsonFormatOptions> = {}, core?: NapCatCore) {
        super(ExportFormat.JSON, options, core);

        this.jsonOptions = {
            pretty: true,
            indent: 2,
            includeRawData: false,
            includeMetadata: true,
            compactFieldNames: false,
            chunkSize: 0, // 0表示不分块
            embedAvatarsAsBase64: false,

            // 默认保持旧行为：单文件 JSON
            exportMode: 'single-json',
            chunkedJsonl: {},

            ...jsonOptions
        };
    }

    /**
     * [Override] 导出入口（保持兼容）
     * - 默认：single-json（现有流式导出逻辑）
     * - 可选：chunked-jsonl（优化方案：manifest + chunks/*.jsonl）
     */
    override async export(messages: RawMessage[], chatInfo?: any): Promise<ExportResult> {
        if (this.jsonOptions.exportMode === 'chunked-jsonl') {
            const r = await this.exportChunkedJsonl(messages, chatInfo, this.jsonOptions.chunkedJsonl);
            // ChunkedJsonlExportResult 兼容 ExportResult（结构类型）
            return r;
        }

        return await this.exportSingleJsonStreaming(messages, chatInfo);
    }

    /**
     * 方案A（现有方案）：单文件 JSON 两阶段流式导出
     * 阶段1: 边解析边写NDJSON临时文件（逐行JSON）
     * 阶段2: 流式读取NDJSON，合成最终JSON（带metadata、statistics）
     *
     * 注意：此方法保持原有输出结构与 UI/逻辑尽量一致（默认路径）
     */
    private async exportSingleJsonStreaming(messages: RawMessage[], chatInfo?: any): Promise<ExportResult> {
        const startTime = Date.now();
        const fs = await import('fs');
        const path = await import('path');
        const os = await import('os');

        let tmpFile: string | null = null;

        try {
            this.updateProgress(0, messages.length, `开始JSON流式导出`);
            this.ensureOutputDirectory();

            // 过滤+排序
            const filteredMessages = await this.preprocessMessages(messages);
            const total = filteredMessages.length;

            console.log(`[JsonExporter] ========== 流式导出开始 ==========`); 
            console.log(`[JsonExporter] 输入: ${messages.length} → 有效: ${total}`);
            console.log(`[JsonExporter] 目标: ${this.options.outputPath}`);

            // ========== 阶段1: 批量解析 → 写NDJSON ==========
            // Issue #192: 使用输出目录作为临时目录，而不是系统临时目录（避免占用C盘）
            const outputDir = path.dirname(this.options.outputPath);
            tmpFile = path.join(outputDir, `.qce_temp_${Date.now()}_${Math.random().toString(36).slice(2)}.ndjson`);
            const writeStream = this.createWriteStream(tmpFile);
            const ndjsonWriter = new BufferedTextWriter(writeStream, 1024 * 1024);
            const ndWrite = async (s: string) => {
                const maybe = ndjsonWriter.write(s);
                if (maybe) await maybe;
            };
            const statsAcc = new StatsAccumulator();
            let resourceCount = 0;

            console.log(`[JsonExporter] 阶段1: 解析并写入临时NDJSON → ${tmpFile}`);
            this.monitorMemory('导出开始');

            if (!this.core) {
                throw new Error('[JsonExporter] 缺少NapCatCore实例，无法流式解析');
            }

            const parser = this.getMessageParser(this.core);

            // 如果启用了头像base64嵌入，预先下载所有头像
            let avatarMap: Map<string, string> | null = null;
            if (this.jsonOptions.embedAvatarsAsBase64) {
                console.log(`[JsonExporter] 开始预下载头像...`);
                avatarMap = await this.preDownloadAvatars(filteredMessages);
            }

            // 使用正确的 parseMessagesStream API（带 onBatch 回调）
            const batchSize = 20000;

            await parser.parseMessagesStream(filteredMessages, {
                batchSize,
                onBatch: async (batch: any[], batchIndex: number, batchCount: number) => {
                    console.log(`[JsonExporter] 处理批次 ${batchIndex + 1}/${batchCount}，${batch.length} 条消息`);

                    // 顺序写入 + backpressure，确保绝对流式
                    for (let i = 0; i < batch.length; i++) {
                        const pm = batch[i];

                        // pm 已经是 ParsedMessage 格式，直接使用
                        statsAcc.consume(pm);

                        // 统计资源
                        const resArr = pm.content?.resources || [];
                        resourceCount += resArr.length;

                        // 智能清理rawMessage，删除null/undefined/空值，大幅减少JSON文件大小
                        if (pm.rawMessage) {
                            pm.rawMessage = this.cleanRawMessage(pm.rawMessage);
                        }

                        // 转换为 CleanMessage 格式以保持字段一致性 (Issue #218)
                        const cleanMsg = this.convertParsedToClean(pm);

                        // 写NDJSON：一条消息一行
                        await ndWrite(JSON.stringify(cleanMsg) + '\n');

                        // 可选让出事件循环：避免超大批次时 WebView/UI 卡死
                        if ((i + 1) % 5000 === 0) {
                            await yieldToEventLoop();
                        }
                    }

                    this.monitorMemory(`批次 ${batchIndex + 1}/${batchCount}`);
                    this.updateProgress(
                        (batchIndex + 1) * batchSize,
                        total,
                        `解析批次 ${batchIndex + 1}/${batchCount}`
                    );
                }
            });

            await ndjsonWriter.end();

            console.log(`[JsonExporter] 阶段1完成，NDJSON已写入`);
            this.monitorMemory('阶段1完成', true);

            // ========== 阶段2: 流式读NDJSON → 合成JSON ==========
            console.log(`[JsonExporter] 阶段2: 流式合成最终JSON`);
            const finalStats = statsAcc.finalize();
            const metadata = this.generateMetadata();
            const formattedChatInfo = await this.formatChatInfoAsync(chatInfo);

            const outStream = this.createWriteStream(this.options.outputPath);
            const outWriter = new BufferedTextWriter(outStream, 1024 * 1024);
            const outWrite = async (s: string) => {
                const maybe = outWriter.write(s);
                if (maybe) await maybe;
            };
            const ctx = createJsonStreamContext(this.jsonOptions.pretty, '  ');

            // 写 JSON 开头（模板化）
            await outWrite(JsonSingleFileTemplates.begin(metadata, formattedChatInfo, finalStats, ctx));

            // 流式读取NDJSON，逐行输出到messages数组
            const readline = await import('readline');
            const readStream = fs.createReadStream(tmpFile, { encoding: 'utf8' });
            const rl = readline.createInterface({ input: readStream });

            let isFirst = true;

            for await (const line of rl) {
                if (!line.trim()) continue;

                if (!isFirst) {
                    await outWrite(`,${ctx.nl}`);
                }

                if (ctx.pretty) {
                    await outWrite(`${ctx.indentUnit}${ctx.indentUnit}${line}`);
                } else {
                    await outWrite(line);
                }

                isFirst = false;
            }

            // 写 messages 数组结束
            await outWrite(JsonSingleFileTemplates.messagesArrayEnd(ctx));

            // 如果启用了头像嵌入（单文件模式保持旧行为：写入 avatars 字段）
            if (avatarMap && avatarMap.size > 0) {
                await outWrite(JsonSingleFileTemplates.avatarsBegin(ctx));

                const totalAvatars = avatarMap.size;
                let idx = 0;

                for (const [uin, base64] of avatarMap.entries()) {
                    idx++;
                    const isLastAvatar = idx === totalAvatars;
                    await outWrite(JsonSingleFileTemplates.avatarEntry(uin, base64, isLastAvatar, ctx));
                }

                await outWrite(JsonSingleFileTemplates.avatarsEnd(ctx));
            }

            if (this.jsonOptions.includeMetadata) {
                const exportOptions = this.generateExportOptions();
                await outWrite(JsonSingleFileTemplates.exportOptionsField(exportOptions, ctx));
            }

            // 写 JSON 结束
            await outWrite(JsonSingleFileTemplates.end(ctx));
            await outWriter.end();

            // 清理临时文件
            if (tmpFile) {
                try {
                    fs.unlinkSync(tmpFile);
                } catch {}
                tmpFile = null;
            }

            console.log(`[JsonExporter] ========== 流式导出完成 ==========`); 
            this.monitorMemory('最终完成', true);
            this.updateProgress(total, total, '导出完成');

            return {
                taskId: '',
                format: this.format,
                filePath: this.options.outputPath,
                fileSize: this.getFileSize(),
                messageCount: total,
                resourceCount,
                exportTime: Date.now() - startTime,
                completedAt: new Date()
            };
        } catch (error) {
            console.error(`[JsonExporter] 流式导出失败:`, error);

            // 出错时尽量清理临时文件
            if (tmpFile) {
                try {
                    fs.unlinkSync(tmpFile);
                } catch {}
            }

            throw this.wrapError(error, 'JsonExport');
        }
    }

    /**
     * 方案B（优化方案，可选接口）：chunked-jsonl 导出
     * 输出结构：
     * <outputDir>/
     *   manifest.json
     *   chunks/
     *     c000001.jsonl
     *     c000002.jsonl
     *   avatars.json  (可选：当 embedAvatarsAsBase64=true)
     *
     * 核心保证：
     * - 不构建全量 JSON 字符串
     * - 不构建全量 messages 数组
     * - 按 batch 解析、按 backpressure 写入，绝对流式
     */
    public async exportChunkedJsonl(
        messages: RawMessage[],
        chatInfo?: any,
        options: Partial<ChunkedJsonlExportOptions> = {}
    ): Promise<ChunkedJsonlExportResult> {
        const startTime = Date.now();
        const fs = await import('fs');
        const path = await import('path');

        try {
            this.updateProgress(0, messages.length, `开始JSONL分块导出`);
            this.ensureOutputDirectory();

            const filteredMessages = await this.preprocessMessages(messages);
            const total = filteredMessages.length;

            if (!this.core) {
                throw new Error('[JsonExporter] 缺少NapCatCore实例，无法流式解析');
            }

            // 合并 chunked-jsonl 选项（带默认值）
            const chunkedOptions = await this.buildChunkedJsonlOptions(options);

            // 输出目录
            const outputDir = chunkedOptions.outputDir;
            const chunksDir = path.join(outputDir, chunkedOptions.chunksDirName);
            const manifestPath = path.join(outputDir, chunkedOptions.manifestFileName);

            // 创建目录
            if (fs.existsSync(outputDir) && !fs.statSync(outputDir).isDirectory()) {
                throw new Error(`[JsonExporter] chunked-jsonl 输出目录冲突：${outputDir} 已存在且不是目录`);
            }
            fs.mkdirSync(chunksDir, { recursive: true });

            console.log(`[JsonExporter] ========== chunked-jsonl 导出开始 ==========`); 
            console.log(`[JsonExporter] 输入: ${messages.length} → 有效: ${total}`);
            console.log(`[JsonExporter] 输出目录: ${outputDir}`);
            console.log(`[JsonExporter] chunks: ${chunksDir}`);
            console.log(`[JsonExporter] manifest: ${manifestPath}`);

            this.monitorMemory('chunked-jsonl 导出开始');

            const parser = this.getMessageParser(this.core);
            const statsAcc = new StatsAccumulator();
            let resourceCount = 0;

            // 如果启用了头像base64嵌入，预先下载所有头像（与单文件模式一致）
            let avatarMap: Map<string, string> | null = null;
            if (this.jsonOptions.embedAvatarsAsBase64) {
                console.log(`[JsonExporter] 开始预下载头像...`);
                avatarMap = await this.preDownloadAvatars(filteredMessages);
            }

            // 初始化 chunk 写入器
            const writer = new ChunkedJsonlWriter({
                chunksDir,
                chunksDirNameForManifest: chunkedOptions.chunksDirName,
                encoding: this.options.encoding as string,
                maxMessages: chunkedOptions.maxMessagesPerChunk,
                maxBytes: chunkedOptions.maxBytesPerChunk,
                getChunkFileName: (index: number) => formatChunkFileName(index, chunkedOptions.chunkFileExt)
            });

            let processed = 0;

            await parser.parseMessagesStream(filteredMessages, {
                batchSize: chunkedOptions.parseBatchSize,
                onBatch: async (batch: any[], batchIndex: number, batchCount: number) => {
                    console.log(`[JsonExporter] [chunked-jsonl] 处理批次 ${batchIndex + 1}/${batchCount}，${batch.length} 条消息`);

                    for (let i = 0; i < batch.length; i++) {
                        const pm = batch[i];

                        statsAcc.consume(pm);

                        const resArr = pm.content?.resources || [];
                        resourceCount += resArr.length;

                        if (pm.rawMessage) {
                            pm.rawMessage = this.cleanRawMessage(pm.rawMessage);
                        }

                        // 转换为 CleanMessage 格式以保持字段一致性 (Issue #218)
                        const cleanMsg = this.convertParsedToClean(pm);
                        const tsMs = cleanMsg.timestamp;
                        const line = JSON.stringify(cleanMsg);

                        await writer.writeLine(line, tsMs);

                        processed += 1;

                        if (processed % 5000 === 0) {
                            await yieldToEventLoop();
                        }
                    }

                    this.monitorMemory(`[chunked-jsonl] 批次 ${batchIndex + 1}/${batchCount}`);
                    this.updateProgress(processed, total, `解析并写入 chunk ${batchIndex + 1}/${batchCount}`);
                }
            });

            await writer.finalize();

            // 统计 & 元信息
            const finalStats = statsAcc.finalize();
            const metadata = this.generateMetadata();
            const formattedChatInfo = await this.formatChatInfoAsync(chatInfo);

            // avatars 文件（可选，流式写，避免 JSON.stringify(Object.fromEntries) 造成 OOM）
            let avatarsRef: ChunkedJsonlExportManifest['avatars'] | undefined;
            if (avatarMap && avatarMap.size > 0) {
                const avatarsPath = path.join(outputDir, chunkedOptions.avatarsFileName);
                await this.writeAvatarMapToJsonFile(avatarMap, avatarsPath);

                avatarsRef = {
                    file: chunkedOptions.avatarsFileName,
                    count: avatarMap.size
                };
            }

            const chunks = writer.getChunks();

            const manifest: ChunkedJsonlExportManifest = {
                metadata,
                chatInfo: formattedChatInfo,
                statistics: finalStats,
                chunked: {
                    format: 'jsonl',
                    chunksDir: chunkedOptions.chunksDirName,
                    chunkFileExt: chunkedOptions.chunkFileExt,
                    maxMessagesPerChunk: chunkedOptions.maxMessagesPerChunk,
                    maxBytesPerChunk: chunkedOptions.maxBytesPerChunk,
                    chunks
                },
                ...(avatarsRef ? { avatars: avatarsRef } : {}),
                ...(this.jsonOptions.includeMetadata ? { exportOptions: this.generateExportOptions() } : {})
            };

            // manifest.json（小文件，直接 stringify）
            const manifestContent = renderJsonFile(manifest, this.jsonOptions.pretty, this.jsonOptions.indent);
            fs.writeFileSync(manifestPath, manifestContent, { encoding: this.options.encoding as BufferEncoding });

            // 统计总大小（尽量准确：stat + writer bytes）
            let totalSize = 0;

            try {
                totalSize += fs.statSync(manifestPath).size;
            } catch {}

            // chunks 总大小
            totalSize += writer.getTotalBytes();

            // avatars 大小
            if (avatarsRef) {
                try {
                    totalSize += fs.statSync(path.join(outputDir, avatarsRef.file)).size;
                } catch {}
            }

            console.log(`[JsonExporter] ========== chunked-jsonl 导出完成 ==========`); 
            this.monitorMemory('chunked-jsonl 最终完成', true);
            this.updateProgress(total, total, '导出完成');

            const result: ChunkedJsonlExportResult = {
                taskId: '',
                format: this.format,
                filePath: manifestPath,
                fileSize: totalSize,
                messageCount: total,
                resourceCount,
                exportTime: Date.now() - startTime,
                completedAt: new Date(),
                outputDir,
                manifestPath,
                chunkCount: chunks.length
            };

            return result;
        } catch (error) {
            console.error(`[JsonExporter] chunked-jsonl 导出失败:`, error);
            throw this.wrapError(error, 'JsonExportChunkedJsonl');
        }
    }

    /**
     * 统一的消息预处理：过滤空消息 + 排序 + 纯图片过滤
     * （保证两种方案输入一致，减少重复代码）
     */
    private async preprocessMessages(messages: RawMessage[]): Promise<RawMessage[]> {
        // 过滤+排序
        const validMessages = messages.filter(m => m);
        const sortedMessages = this.sortMessagesByTimestamp(validMessages);
        const filteredMessages = await this.applyPureImageFilter(sortedMessages);
        return filteredMessages;
    }

    /**
     * 生成 chunked-jsonl 的最终配置（含默认值与 outputDir 推导）
     */
    private async buildChunkedJsonlOptions(override: Partial<ChunkedJsonlExportOptions>): Promise<ChunkedJsonlExportOptions> {
        const path = await import('path');

        const derivedOutputDir = this.deriveDefaultChunkedOutputDir(path);

        const defaults: ChunkedJsonlExportOptions = {
            outputDir: derivedOutputDir,
            chunksDirName: DEFAULT_CHUNKS_DIR_NAME,
            manifestFileName: DEFAULT_MANIFEST_FILE_NAME,
            avatarsFileName: DEFAULT_AVATARS_FILE_NAME,
            chunkFileExt: '.jsonl',
            // 建议默认：5万条或50MB（满足绝大多数“极大文件”但 chunk 数又不会爆炸）
            maxMessagesPerChunk: 50000,
            maxBytesPerChunk: 50 * 1024 * 1024,
            // batch 越小越省内存，越大越快。这里默认 5000 比较均衡。
            parseBatchSize: 5000
        };

        return {
            ...defaults,
            ...override,
            // outputDir 必须最终为字符串；如果用户传空字符串，回落到默认
            outputDir: (override.outputDir && override.outputDir.trim()) ? override.outputDir : defaults.outputDir,
            chunksDirName: override.chunksDirName || defaults.chunksDirName,
            manifestFileName: override.manifestFileName || defaults.manifestFileName,
            avatarsFileName: override.avatarsFileName || defaults.avatarsFileName,
            chunkFileExt: override.chunkFileExt || defaults.chunkFileExt
        };
    }

    /**
     * 从 options.outputPath 推导默认 chunked-jsonl 输出目录
     * 规则：<dirname>/<basename>_chunked_jsonl
     */
    private deriveDefaultChunkedOutputDir(pathMod: typeof import('path')): string {
        const outputPath = this.options.outputPath;
        const dir = pathMod.dirname(outputPath);
        const base = pathMod.basename(outputPath, pathMod.extname(outputPath));
        return pathMod.join(dir, `${base}_chunked_jsonl`);
    }

    /**
     * 从消息对象提取 timestamp（ms）
     * - ParsedMessage: Date
     * - CleanMessage: number(ms)
     * - 其他：ISO string
     */
    private extractTimestampMs(m: any): number | null {
        if (!m) return null;

        if (typeof m.timestamp === 'number') return m.timestamp;

        if (m.timestamp instanceof Date) return m.timestamp.getTime();

        if (typeof m.timestamp === 'string') {
            const parsed = Date.parse(m.timestamp);
            if (!isNaN(parsed)) return parsed;
        }

        return null;
    }

    /**
     * 流式写出 avatarMap -> JSON 文件
     * - 避免 JSON.stringify(Object.fromEntries(map)) 造成大对象/大字符串常驻内存
     */
    private async writeAvatarMapToJsonFile(avatarMap: Map<string, string>, filePath: string): Promise<void> {
        const fs = await import('fs');
        const path = await import('path');

        fs.mkdirSync(path.dirname(filePath), { recursive: true });

        // avatars 文件遵循 jsonOptions.pretty / jsonOptions.indent
        const indentUnit = this.jsonOptions.pretty ? ' '.repeat(Math.max(0, this.jsonOptions.indent || 2)) : '';
        const ctx = createJsonStreamContext(this.jsonOptions.pretty, indentUnit);

        const outStream = fs.createWriteStream(filePath, { encoding: this.options.encoding as BufferEncoding });

        const writer = new BufferedTextWriter(outStream, 1024 * 1024);
        const write = async (s: string) => {
            const maybe = writer.write(s);
            if (maybe) await maybe;
        };

        await write(JsonObjectStreamTemplates.begin(ctx));

        const total = avatarMap.size;
        let idx = 0;

        for (const [uin, base64] of avatarMap.entries()) {
            idx += 1;
            const isLast = idx === total;
            await write(JsonObjectStreamTemplates.entry(uin, JSON.stringify(base64), isLast, ctx));

            if (idx % 2000 === 0) {
                await yieldToEventLoop();
            }
        }

        await write(JsonObjectStreamTemplates.end(ctx));
        await writer.end();
    }

    /**
     * 生成JSON内容 - 使用与TXT导出器相同的双重解析机制
     */
    protected async generateContent(
        messages: any[],
        chatInfo: { name: string; type: string; avatar?: string; participantCount?: number }
    ): Promise<string> {
        console.log(`[JsonExporter] ==================== 开始JSON导出 ====================`);
        console.log(`[JsonExporter] 输入消息数量: ${messages.length} 条`);
        console.log(`[JsonExporter] 聊天信息: ${chatInfo.name} (${chatInfo.type})`);
        console.log(`[JsonExporter] =====================================================`);

        // 检查是否需要解析消息
        let cleanMessages: CleanMessage[];

        // 更精确的类型检测：检查是否有RawMessage特有的字段
        if (messages.length > 0 && messages[0] &&
            typeof messages[0].msgId === 'string' &&
            messages[0].elements !== undefined &&
            messages[0].senderUid !== undefined &&
            messages[0].msgTime !== undefined) {
            // 这是RawMessage[]，需要解析
            console.log(`[JsonExporter] 检测到RawMessage[]，使用双重解析机制解析 ${messages.length} 条消息`);
            cleanMessages = await this.parseWithDualStrategy(messages as RawMessage[]);
            console.log(`[JsonExporter] 解析完成，得到 ${cleanMessages.length} 条CleanMessage`);
        } else if (messages.length > 0 && messages[0] &&
            messages[0].content !== undefined &&
            messages[0].sender !== undefined) {
            // 这是CleanMessage[]，直接使用
            console.log(`[JsonExporter] 检测到CleanMessage[]，直接使用 ${messages.length} 条消息`);
            cleanMessages = messages as CleanMessage[];
        } else {
            // 兜底：当作RawMessage处理
            console.warn(`[JsonExporter] 无法确定消息类型，当作RawMessage处理`);
            cleanMessages = await this.parseWithDualStrategy(messages as RawMessage[]);
        }

        // 如果启用了头像base64嵌入，处理消息
        if (this.jsonOptions.embedAvatarsAsBase64) {
            cleanMessages = await this.embedAvatarsToMessages(cleanMessages);
        }

        // 构建JSON数据结构
        const exportData: JsonExportData = {
            metadata: this.generateMetadata(),
            chatInfo: await this.formatChatInfoAsync(chatInfo),
            statistics: this.generateStatistics(cleanMessages),
            messages: cleanMessages, // 使用解析后的消息数据
            ...(this.jsonOptions.includeMetadata && {
                exportOptions: this.generateExportOptions()
            })
        };

        // 如果需要分块输出
        if (this.jsonOptions.chunkSize > 0 && cleanMessages.length > this.jsonOptions.chunkSize) {
            return this.generateChunkedOutput(exportData);
        }

        // 序列化为JSON
        return this.serializeJson(exportData);
    }

    /**
     * 使用双重解析策略解析消息（与TXT导出器相同的机制）
     * 首先尝试使用MessageParser，失败时fallback到SimpleMessageParser
     */
    private async parseWithDualStrategy(messages: RawMessage[]): Promise<CleanMessage[]> {
        let parsedMessages: ParsedMessage[] = [];

        // 尝试使用MessageParser解析消息
        if (this.core) {
            try {
                console.log(`[JsonExporter] 尝试使用MessageParser解析 ${messages.length} 条消息`);
                const parser = this.getMessageParser(this.core);
                parsedMessages = await parser.parseMessages(messages);
                console.log(`[JsonExporter] MessageParser解析了 ${parsedMessages.length} 条消息`);

                // 如果MessageParser解析结果为空，使用fallback
                if (parsedMessages.length === 0 && messages.length > 0) {
                    console.log(`[JsonExporter] MessageParser解析结果为空，使用SimpleMessageParser作为fallback`);
                    return await this.useFallbackParser(messages);
                }
            } catch (error) {
                console.error(`[JsonExporter] MessageParser解析失败，使用SimpleMessageParser作为fallback:`, error);
                return await this.useFallbackParser(messages);
            }
        } else {
            // 没有NapCatCore实例，直接使用SimpleMessageParser
            console.log(`[JsonExporter] 没有NapCatCore实例，使用SimpleMessageParser`);
            return await this.useFallbackParser(messages);
        }

        // 将ParsedMessage转换为CleanMessage格式
        return this.convertParsedMessagesToCleanMessages(parsedMessages);
    }

    /**
     * 使用SimpleMessageParser作为fallback解析器
     */
    private async useFallbackParser(messages: RawMessage[]): Promise<CleanMessage[]> {
        const simpleParser = new SimpleMessageParser();
        return await simpleParser.parseMessages(messages);
    }

    /**
     * 将ParsedMessage数组转换为CleanMessage数组
     */
    private convertParsedMessagesToCleanMessages(parsedMessages: ParsedMessage[]): CleanMessage[] {
        return parsedMessages.map((parsedMsg: ParsedMessage): CleanMessage => {
            return this.convertParsedToClean(parsedMsg);
        });
    }

    /**
     * 将单个ParsedMessage转换为CleanMessage（流式导出使用）
     */
    private convertParsedToClean(parsedMsg: ParsedMessage): CleanMessage {
        return {
            id: parsedMsg.messageId,
            seq: parsedMsg.messageSeq,
            timestamp: parsedMsg.timestamp.getTime(),
            time: parsedMsg.timestamp.toLocaleString('zh-CN', {
                year: 'numeric',
                month: '2-digit',
                day: '2-digit',
                hour: '2-digit',
                minute: '2-digit',
                second: '2-digit',
                hour12: false
            }).replace(/\//g, '-'),
            sender: {
                uid: parsedMsg.sender.uid,
                uin: parsedMsg.sender.uin,
                name: parsedMsg.sender.name || parsedMsg.sender.uid,
                nickname: (parsedMsg.sender as any).nickname,
                groupCard: (parsedMsg.sender as any).groupCard,
                remark: (parsedMsg.sender as any).remark
            },
            type: this.getMessageTypeFromNTMsgType(parsedMsg.messageType),
            content: {
                text: parsedMsg.content.text,
                html: parsedMsg.content.html,
                elements: this.convertContentToElements(parsedMsg.content),
                resources: parsedMsg.content.resources.map(r => ({
                    type: r.type,
                    filename: r.fileName,
                    size: r.fileSize,
                    url: r.originalUrl,
                    localPath: r.localPath,
                    width: undefined,
                    height: undefined,
                    duration: undefined
                })),
                mentions: (parsedMsg.content.mentions || []).map((m: any) => ({
                    uid: m.uid,
                    name: m.name,
                    type: m.type || 'user'
                }))
            },
            recalled: parsedMsg.isRecalled,
            system: parsedMsg.isSystemMessage
        };
    }

    /**
     * 将ParsedMessageContent转换为MessageElementData数组
     */
    private convertContentToElements(content: any): any[] {
        const elements: any[] = [];

        // 添加文本元素
        if (content.text) {
            elements.push({
                type: 'text',
                data: { text: content.text }
            });
        }

        // 添加资源元素
        for (const resource of content.resources) {
            elements.push({
                type: resource.type,
                data: {
                    filename: resource.fileName,
                    size: resource.fileSize,
                    url: resource.originalUrl
                }
            });
        }

        // 添加提及元素
        for (const mention of content.mentions) {
            elements.push({
                type: 'at',
                data: {
                    uid: mention.uid,
                    name: mention.name
                }
            });
        }

        // 添加表情元素
        for (const emoji of content.emojis) {
            elements.push({
                type: emoji.type === 'market' ? 'market_face' : 'face',
                data: {
                    id: emoji.id,
                    name: emoji.name,
                    url: emoji.url
                }
            });
        }

        // 添加回复元素
        if (content.reply) {
            elements.push({
                type: 'reply',
                data: {
                    messageId: content.reply.messageId,
                    referencedMessageId: content.reply.referencedMessageId, // 被引用消息的实际messageId
                    senderName: content.reply.senderName,
                    content: content.reply.content
                }
            });
        }

        return elements;
    }

    /**
     * 将NTMsgType转换为字符串类型
     */
    private getMessageTypeFromNTMsgType(msgType: any): string {
        // 根据 NTMsgType 映射到 type_X
        switch (Number(msgType)) {
            case 1: // KMSGTYPENULL
            case 2: // KMSGTYPEMIX
                return 'type_1'; // 文本
            case 3: // KMSGTYPEFILE
                return 'type_8'; // 文件
            case 4: // KMSGTYPESTRUCT
                return 'type_7'; // JSON卡片
            case 5: // KMSGTYPEGRAYTIPS
                return 'type_1'; // 系统消息
            case 6: // KMSGTYPEPTT
                return 'type_6'; // 语音
            case 7: // KMSGTYPEVIDEO
                return 'type_9'; // 视频
            case 8: // KMSGTYPEMULTIMSGFORWARD
                return 'type_11'; // 合并转发
            case 9: // KMSGTYPEREPLY
                return 'type_3'; // 回复
            case 11: // KMSGTYPEARKSTRUCT
                return 'type_7'; // Ark卡片
            case 25: // KMSGTYPESHARELOCATION
                return 'type_17'; // 位置分享/联系人卡片
            default:
                return `type_${msgType}`;
        }
    }

    /**
     * 生成元数据
     */
    private generateMetadata(): JsonExportData['metadata'] {
        return {
            name: APP_INFO.name,
            copyright: APP_INFO.copyright,
            version: VERSION
        };
    }

    /**
     * 格式化聊天信息（异步版本，支持群头像base64转换）
     */
    private async formatChatInfoAsync(chatInfo: { name: string; type: string; avatar?: string; participantCount?: number; selfUid?: string; selfUin?: string; selfName?: string }): Promise<JsonExportData['chatInfo']> {
        const result: JsonExportData['chatInfo'] = {
            name: chatInfo.name,
            type: chatInfo.type,
        };

        // 添加当前登录用户信息
        if (chatInfo.selfUid) {
            result.selfUid = chatInfo.selfUid;
        }
        if (chatInfo.selfUin) {
            result.selfUin = chatInfo.selfUin;
        }
        if (chatInfo.selfName) {
            result.selfName = chatInfo.selfName;
        }

        if (chatInfo.avatar) {
            // 如果启用了头像base64嵌入，下载群头像并转换
            if (this.jsonOptions.embedAvatarsAsBase64) {
                console.log(`[JsonExporter] 下载群/好友头像: ${chatInfo.avatar}`);
                const base64 = await this.downloadUrlAsBase64(chatInfo.avatar);
                if (base64) {
                    result.avatar = base64;
                    console.log(`[JsonExporter] 群/好友头像base64转换成功`);
                } else {
                    // 下载失败时保留原URL
                    result.avatar = chatInfo.avatar;
                    console.warn(`[JsonExporter] 群/好友头像下载失败，保留URL`);
                }
            } else {
                result.avatar = chatInfo.avatar;
            }
        }

        if (chatInfo.participantCount !== undefined) {
            result.participantCount = chatInfo.participantCount;
        }

        return result;
    }

    /**
     * 下载任意URL的图片并转换为base64
     * @param url 图片URL
     * @returns base64字符串或null
     */
    private async downloadUrlAsBase64(url: string): Promise<string | null> {
        try {
            const https = await import('https');
            const http = await import('http');
            const protocol = url.startsWith('https') ? https : http;

            return new Promise((resolve) => {
                protocol.get(url, (response) => {
                    // 处理重定向
                    if (response.statusCode === 301 || response.statusCode === 302) {
                        const redirectUrl = response.headers.location;
                        if (redirectUrl) {
                            this.downloadUrlAsBase64(redirectUrl).then(resolve);
                        } else {
                            resolve(null);
                        }
                        return;
                    }

                    if (response.statusCode !== 200) {
                        resolve(null);
                        return;
                    }

                    const chunks: Buffer[] = [];
                    response.on('data', (chunk: Buffer) => chunks.push(chunk));
                    response.on('end', () => {
                        const buffer = Buffer.concat(chunks);
                        // 检测图片类型
                        let mimeType = 'image/jpeg';
                        if (buffer[0] === 0x89 && buffer[1] === 0x50) {
                            mimeType = 'image/png';
                        } else if (buffer[0] === 0x47 && buffer[1] === 0x49) {
                            mimeType = 'image/gif';
                        }
                        const base64 = `data:${mimeType};base64,${buffer.toString('base64')}`;
                        resolve(base64);
                    });
                    response.on('error', () => resolve(null));
                }).on('error', () => resolve(null));
            });
        } catch (error) {
            console.warn(`[JsonExporter] 下载图片失败: ${url}`, error);
            return null;
        }
    }

    /**
     * 智能清理rawMessage，递归删除null/undefined/空值，大幅减少JSON文件大小
     */
    private cleanRawMessage(obj: any): any {
        if (obj === null || obj === undefined) {
            return undefined;
        }

        if (Array.isArray(obj)) {
            const cleaned = obj.map(item => this.cleanRawMessage(item)).filter(item => item !== undefined);
            return cleaned.length > 0 ? cleaned : undefined;
        }

        if (typeof obj === 'object') {
            const cleaned: any = {};
            let hasValue = false;

            for (const key in obj) {
                if (obj.hasOwnProperty(key)) {
                    const value = obj[key];

                    if (value === null || value === undefined || value === '') {
                        continue;
                    }

                    if (typeof value === 'object') {
                        const cleanedValue = this.cleanRawMessage(value);
                        if (cleanedValue !== undefined) {
                            if (Array.isArray(cleanedValue) && cleanedValue.length === 0) {
                                continue;
                            }
                            if (!Array.isArray(cleanedValue) && Object.keys(cleanedValue).length === 0) {
                                continue;
                            }
                            cleaned[key] = cleanedValue;
                            hasValue = true;
                        }
                    } else {
                        cleaned[key] = value;
                        hasValue = true;
                    }
                }
            }

            return hasValue ? cleaned : undefined;
        }

        return obj;
    }

    /**
     * 生成统计信息 - 从原始消息中提取
     */
    private generateStatistics(messages: CleanMessage[]): JsonExportData['statistics'] {
        const parser = new SimpleMessageParser();
        const stats = parser.calculateStatistics(messages);

        // 转换为JsonExportData期望的格式
        const senders = Object.entries(stats.bySender)
            .map(([name, data]) => ({
                uid: data.uid,
                name: name,
                messageCount: data.count,
                percentage: Math.round((data.count / stats.total) * 100 * 100) / 100
            }))
            .sort((a, b) => b.messageCount - a.messageCount);

        return {
            totalMessages: stats.total,
            timeRange: {
                start: stats.timeRange.start,
                end: stats.timeRange.end,
                durationDays: stats.timeRange.durationDays
            },
            messageTypes: stats.byType,
            senders,
            resources: {
                total: stats.resources.total,
                byType: stats.resources.byType,
                totalSize: stats.resources.totalSize
            }
        };
    }

    /**
     * 生成导出选项记录
     */
    private generateExportOptions(): JsonExportData['exportOptions'] {
        return {
            includedFields: ['id', 'timestamp', 'sender', 'content', 'resources'],
            filters: {},
            options: {
                includeResourceLinks: this.options.includeResourceLinks,
                includeSystemMessages: this.options.includeSystemMessages,
                timeFormat: this.options.timeFormat,
                encoding: this.options.encoding
            }
        };
    }

    /**
     * 生成分块输出
     */
    private generateChunkedOutput(exportData: JsonExportData): string {
        const chunks: JsonExportData[] = [];
        const messages = exportData.messages;
        const chunkSize = this.jsonOptions.chunkSize;

        // 分割消息
        for (let i = 0; i < messages.length; i += chunkSize) {
            const chunkMessages = messages.slice(i, i + chunkSize);

            const chunkData: JsonExportData = {
                ...exportData,
                messages: chunkMessages,
                metadata: {
                    ...exportData.metadata,
                    name: `${exportData.metadata.name} (分块 ${Math.floor(i / chunkSize) + 1})`
                },
                statistics: {
                    ...exportData.statistics,
                    totalMessages: chunkMessages.length
                }
            };

            chunks.push(chunkData);
        }

        // 如果只有一个分块，直接返回
        if (chunks.length === 1) {
            return this.serializeJson(chunks[0]);
        }

        // 多分块，返回数组格式
        return this.serializeJson({
            metadata: exportData.metadata,
            chunkInfo: {
                totalChunks: chunks.length,
                totalMessages: messages.length,
                chunkSize
            },
            chunks
        });
    }

    /**
     * 预下载所有消息发送者的头像
     * @param messages 原始消息列表
     * @returns uin -> base64 映射
     */
    private async preDownloadAvatars(messages: RawMessage[]): Promise<Map<string, string>> {
        const avatarMap = new Map<string, string>();
        const uniqueUins = new Set<string>();

        // 收集所有唯一的uin（senderUin可能是string或number）
        for (const msg of messages) {
            const uin = msg.senderUin;
            if (uin && String(uin) !== '0' && String(uin) !== '') {
                uniqueUins.add(String(uin));
            }
        }

        console.log(`[JsonExporter] 发现 ${uniqueUins.size} 个唯一发送者，开始下载头像...`);

        // 批量下载头像
        let downloaded = 0;
        for (const uin of uniqueUins) {
            const base64 = await this.downloadAvatarAsBase64(uin);
            if (base64) {
                avatarMap.set(uin, base64);
                downloaded++;
            }
        }

        console.log(`[JsonExporter] 头像下载完成: ${downloaded}/${uniqueUins.size}`);
        return avatarMap;
    }

    /**
     * 下载头像并转换为base64
     * @param uin QQ号
     * @returns base64字符串或null
     */
    private async downloadAvatarAsBase64(uin: string): Promise<string | null> {
        try {
            const https = await import('https');
            const avatarUrl = `https://q1.qlogo.cn/g?b=qq&nk=${uin}&s=100`;

            return new Promise((resolve) => {
                https.get(avatarUrl, (response) => {
                    // 处理重定向
                    if (response.statusCode === 301 || response.statusCode === 302) {
                        const redirectUrl = response.headers.location;
                        if (redirectUrl) {
                            https.get(redirectUrl, (redirectResponse) => {
                                const chunks: Buffer[] = [];
                                redirectResponse.on('data', (chunk: Buffer) => chunks.push(chunk));
                                redirectResponse.on('end', () => {
                                    const buffer = Buffer.concat(chunks);
                                    const base64 = `data:image/jpeg;base64,${buffer.toString('base64')}`;
                                    resolve(base64);
                                });
                                redirectResponse.on('error', () => resolve(null));
                            }).on('error', () => resolve(null));
                        } else {
                            resolve(null);
                        }
                    } else {
                        const chunks: Buffer[] = [];
                        response.on('data', (chunk: Buffer) => chunks.push(chunk));
                        response.on('end', () => {
                            const buffer = Buffer.concat(chunks);
                            const base64 = `data:image/jpeg;base64,${buffer.toString('base64')}`;
                            resolve(base64);
                        });
                        response.on('error', () => resolve(null));
                    }
                }).on('error', () => resolve(null));
            });
        } catch (error) {
            console.warn(`[JsonExporter] 下载头像失败: ${uin}`, error);
            return null;
        }
    }

    /**
     * 为消息列表嵌入头像base64
     * @param messages 消息列表
     * @returns 带有头像base64的消息列表
     */
    private async embedAvatarsToMessages(messages: CleanMessage[]): Promise<CleanMessage[]> {
        console.log(`[JsonExporter] 开始嵌入头像base64...`);

        // 收集所有唯一的发送者
        const senderMap = new Map<string, string>(); // uin -> base64
        const uniqueUins = new Set<string>();

        for (const msg of messages) {
            if (msg.sender?.uin) {
                uniqueUins.add(msg.sender.uin);
            }
        }

        console.log(`[JsonExporter] 发现 ${uniqueUins.size} 个唯一发送者，开始下载头像...`);

        // 批量下载头像
        let downloaded = 0;
        for (const uin of uniqueUins) {
            const base64 = await this.downloadAvatarAsBase64(uin);
            if (base64) {
                senderMap.set(uin, base64);
                downloaded++;
            }
        }

        console.log(`[JsonExporter] 头像下载完成: ${downloaded}/${uniqueUins.size}`);

        // 将base64添加到消息中
        return messages.map(msg => {
            if (msg.sender?.uin && senderMap.has(msg.sender.uin)) {
                return {
                    ...msg,
                    sender: {
                        ...msg.sender,
                        avatarBase64: senderMap.get(msg.sender.uin)
                    }
                };
            }
            return msg;
        });
    }

    /**
     * 序列化JSON
     */
    private serializeJson(data: any): string {
        if (this.jsonOptions.pretty) {
            return JSON.stringify(data, null, this.jsonOptions.indent);
        } else {
            return JSON.stringify(data);
        }
    }

    /**
     * 写入文件（重写以支持分块写入）
     */
    protected override async writeToFile(content: string): Promise<void> {
        if (this.options.chunkSize && content.length > this.options.chunkSize) {
            // 大文件分块写入
            await this.writeFileInChunks(content);
        } else {
            // 一次性写入
            await super.writeToFile(content);
        }
    }

    /**
     * 分块写入文件
     */
    private async writeFileInChunks(content: string): Promise<void> {
        const fs = await import('fs');
        const stream = fs.createWriteStream(this.options.outputPath, {
            encoding: this.options.encoding as BufferEncoding
        });

        return new Promise((resolve, reject) => {
            stream.on('error', reject);
            stream.on('finish', resolve);

            const chunkSize = this.options.chunkSize || 1024 * 1024; // 1MB chunks
            let offset = 0;

            const writeNextChunk = () => {
                if (offset >= content.length) {
                    stream.end();
                    return;
                }

                const chunk = content.slice(offset, offset + chunkSize);
                offset += chunkSize;

                stream.write(chunk, 'utf8', (error) => {
                    if (error) {
                        reject(error);
                    } else {
                        // 异步写入下一块
                        setImmediate(writeNextChunk);
                    }
                });
            };

            writeNextChunk();
        });
    }

    /**
     * 验证JSON格式
     */
    async validateOutput(): Promise<boolean> {
        try {
            const fs = await import('fs');
            const content = await fs.promises.readFile(this.options.outputPath, { encoding: this.options.encoding as BufferEncoding });
            JSON.parse(content);
            return true;
        } catch (error) {
            console.error('JSON格式验证失败:', error);
            return false;
        }
    }

    /**
     * 获取JSON模式定义
     */
    static getJsonSchema(): any {
        return {
            $schema: 'http://json-schema.org/draft-07/schema#',
            type: 'object',
            properties: {
                metadata: {
                    type: 'object',
                    properties: {
                        exporter: { type: 'string' },
                        version: { type: 'string' },
                        exportTime: { type: 'string', format: 'date-time' },
                        formatVersion: { type: 'string' }
                    },
                    required: ['exporter', 'version', 'exportTime', 'formatVersion']
                },
                chatInfo: {
                    type: 'object',
                    properties: {
                        name: { type: 'string' },
                        type: { type: 'string' },
                        avatar: { type: 'string' },
                        participantCount: { type: 'number' }
                    },
                    required: ['name', 'type']
                },
                messages: {
                    type: 'array',
                    items: {
                        type: 'object',
                        properties: {
                            id: { type: 'string' },
                            timestamp: { type: 'string', format: 'date-time' },
                            sender: {
                                type: 'object',
                                properties: {
                                    uid: { type: 'string' },
                                    name: { type: 'string' }
                                },
                                required: ['uid']
                            },
                            content: {
                                type: 'object',
                                properties: {
                                    text: { type: 'string' }
                                },
                                required: ['text']
                            }
                        },
                        required: ['id', 'timestamp', 'sender', 'content']
                    }
                }
            },
            required: ['metadata', 'chatInfo', 'messages']
        };
    }
}
