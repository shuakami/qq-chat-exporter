/**
 * 资源合并工具
 * 负责将多个备份任务的资源合并为单一资源
 */

import fs from 'fs';
import path from 'path';
import { promises as fsPromises } from 'fs';
import { createReadStream, createWriteStream } from 'fs';
import { createInterface } from 'readline';
import { pipeline } from 'stream/promises';
import crypto from 'crypto';
import { ModernHtmlExporter } from '../exporter/ModernHtmlExporter.js';
import { SimpleMessageParser } from '../parser/SimpleMessageParser.js';

/**
 * 合并配置接口
 */
export interface MergeConfig {
    /** 源文件名列表（不是taskId，而是实际的文件名如 friend_123_20250506_120000.html） */
    sourceTaskIds: string[];
    /** 目标输出路径 */
    outputPath: string;
    /** 是否删除源文件 */
    deleteSourceFiles: boolean;
    /** 是否去重消息 */
    deduplicateMessages: boolean;
    /** 合并后的资源文件夹名称 */
    resourceFolderName?: string;
}

/**
 * 合并进度回调
 */
export type MergeProgressCallback = (progress: {
    phase: string;
    current: number;
    total: number;
    percentage: number;
    message: string;
}) => void;

/**
 * 合并结果接口
 */
export interface MergeResult {
    /** 合并任务ID */
    mergeTaskId: string;
    /** 合并后的文件目录路径 */
    outputPath: string;
    /** 合并后的JSON文件路径 */
    jsonPath: string;
    /** 合并后的HTML文件路径 */
    htmlPath: string;
    /** 合并的源任务数 */
    sourceCount: number;
    /** 合并后的总消息数 */
    totalMessages: number;
    /** 去重消息数 */
    deduplicatedMessages: number;
    /** 合并的资源文件数 */
    totalResources: number;
    /** 合并后的文件大小 */
    totalSize: number;
    /** 合并耗时（毫秒） */
    mergeTime: number;
    /** 完成时间 */
    completedAt: Date;
}

/**
 * 资源合并器类
 */
export class ResourceMerger {
    private progressCallback: MergeProgressCallback | null = null;

    /**
     * 设置进度回调
     */
    setProgressCallback(callback: MergeProgressCallback | null): void {
        this.progressCallback = callback;
    }

    /**
     * 更新进度
     */
    private updateProgress(
        phase: string,
        current: number,
        total: number,
        message: string
    ): void {
        if (this.progressCallback) {
            const percentage = total > 0 ? Math.round((current / total) * 100) : 0;
            this.progressCallback({
                phase,
                current,
                total,
                percentage,
                message
            });
        }
    }

    /**
     * 合并多个导出任务的资源
     */
    async mergeResources(config: MergeConfig): Promise<MergeResult> {
        const startTime = Date.now();
        const mergeTaskId = `merge_${Date.now()}_${Math.random().toString(36).substring(7)}`;

        console.log(`[ResourceMerger] 开始合并任务 ${mergeTaskId}`);
        console.log(`[ResourceMerger] 源任务数: ${config.sourceTaskIds.length}`);

        try {
            // Phase 1: 验证源文件
            this.updateProgress('validate', 0, config.sourceTaskIds.length, '验证源文件...');
            const sourceFiles = await this.validateSourceFiles(config.sourceTaskIds);
            this.updateProgress('validate', config.sourceTaskIds.length, config.sourceTaskIds.length, '源文件验证完成');

            // Phase 2: 读取并合并消息数据
            this.updateProgress('merge', 0, 100, '读取消息数据...');
            const mergedMessages = await this.mergeMessages(
                sourceFiles,
                config.deduplicateMessages
            );
            this.updateProgress('merge', 50, 100, `合并消息完成，共 ${mergedMessages.length} 条`);

            // Phase 3: 合并资源文件
            this.updateProgress('resources', 0, 100, '合并资源文件...');
            const resourceStats = await this.mergeResourceFiles(
                sourceFiles,
                config.outputPath,
                config.resourceFolderName
            );
            this.updateProgress('resources', 100, 100, `资源文件合并完成，共 ${resourceStats.count} 个文件`);

            // Phase 4: 写入合并后的数据文件
            this.updateProgress('write', 0, 100, '写入合并数据...');
            const { jsonPath, htmlPath } = await this.writeMergedData(
                config.outputPath,
                mergedMessages,
                resourceStats.mapping
            );
            this.updateProgress('write', 100, 100, '数据写入完成');

            // Phase 5: 清理源文件（如果需要）
            if (config.deleteSourceFiles) {
                this.updateProgress('cleanup', 0, config.sourceTaskIds.length, '清理源文件...');
                await this.cleanupSourceFiles(sourceFiles);
                this.updateProgress('cleanup', config.sourceTaskIds.length, config.sourceTaskIds.length, '清理完成');
            }

            const mergeTime = Date.now() - startTime;
            const totalSize = await this.calculateDirectorySize(config.outputPath);

            const result: MergeResult = {
                mergeTaskId,
                outputPath: config.outputPath,
                jsonPath,
                htmlPath,
                sourceCount: config.sourceTaskIds.length,
                totalMessages: mergedMessages.length,
                deduplicatedMessages: mergedMessages.deduplicatedCount || 0,
                totalResources: resourceStats.count,
                totalSize,
                mergeTime,
                completedAt: new Date()
            };

            console.log(`[ResourceMerger] 合并完成，耗时 ${mergeTime}ms`);
            return result;

        } catch (error) {
            console.error(`[ResourceMerger] 合并失败:`, error);
            throw error;
        }
    }

    /**
     * 验证源文件是否存在
     * 根据实际的文件组织结构定位文件
     * @param fileNames - 文件名列表（不是taskId，而是实际的文件名）
     */
    private async validateSourceFiles(fileNames: string[]): Promise<Array<{
        taskId: string;
        htmlPath: string;
        jsonPath?: string;
        resourcePath: string;
    }>> {
        const sourceFiles: Array<{
            taskId: string;
            htmlPath: string;
            jsonPath?: string;
            resourcePath: string;
        }> = [];

        // 实际的导出目录路径
        const exportDir = path.join(process.env['USERPROFILE'] || process.cwd(), '.qq-chat-exporter', 'exports');
        const scheduledExportDir = path.join(process.env['USERPROFILE'] || process.cwd(), '.qq-chat-exporter', 'scheduled-exports');

        for (const fileName of fileNames) {
            // 尝试在两个目录中查找文件
            let taskDir = exportDir;
            let foundPath: string | null = null;
            
            // 先在普通导出目录查找
            const exportPath = path.join(exportDir, fileName);
            if (fs.existsSync(exportPath)) {
                foundPath = exportPath;
                taskDir = exportDir;
            } else {
                // 尝试定时导出目录
                const scheduledPath = path.join(scheduledExportDir, fileName);
                if (fs.existsSync(scheduledPath)) {
                    foundPath = scheduledPath;
                    taskDir = scheduledExportDir;
                }
            }
            
            if (!foundPath) {
                throw new Error(`未找到文件: ${fileName}（已搜索exports和scheduled-exports目录）`);
            }

            // 获取基础文件名（不含扩展名）
            const baseName = fileName.replace(/\.(html|json)$/, '');
            
            // 尝试找到对应的JSON文件
            let jsonPath: string | undefined;
            const jsonFileName = baseName + '.json';
            const jsonInExports = path.join(exportDir, jsonFileName);
            const jsonInScheduled = path.join(scheduledExportDir, jsonFileName);
            
            if (fs.existsSync(jsonInExports)) {
                jsonPath = jsonInExports;
            } else if (fs.existsSync(jsonInScheduled)) {
                jsonPath = jsonInScheduled;
            }

            // 资源文件路径：resources_{文件基础名}/
            const resourcePath = path.join(taskDir, `resources_${baseName}`);
            
            if (!fs.existsSync(resourcePath)) {
                console.warn(`[ResourceMerger] 文件 ${fileName} 没有resources目录: ${resourcePath}`);
            }

            sourceFiles.push({
                taskId: baseName, // 使用文件基础名作为标识
                htmlPath: foundPath,
                jsonPath,
                resourcePath
            });
        }

        return sourceFiles;
    }

    /**
     * 合并消息数据
     */
    private async mergeMessages(
        sourceFiles: Array<{ taskId: string; jsonPath?: string }>,
        deduplicate: boolean
    ): Promise<any> {
        const allMessages: any[] = [];
        const messageSet = new Set<string>(); // 用于去重
        let deduplicatedCount = 0;

        for (const source of sourceFiles) {
            if (!source.jsonPath || !fs.existsSync(source.jsonPath)) {
                console.warn(`[ResourceMerger] 跳过没有JSON的任务: ${source.taskId}`);
                continue;
            }

            // 读取JSON文件
            const jsonContent = await fsPromises.readFile(source.jsonPath, 'utf-8');
            const data = JSON.parse(jsonContent);
            
            if (data.messages && Array.isArray(data.messages)) {
                for (const message of data.messages) {
                    if (deduplicate) {
                        // 使用消息ID和时间戳作为唯一标识
                        const messageKey = `${message.id}_${message.timestamp}`;
                        
                        if (messageSet.has(messageKey)) {
                            deduplicatedCount++;
                            continue;
                        }
                        
                        messageSet.add(messageKey);
                    }
                    
                    allMessages.push(message);
                }
            }
        }

        // 按时间戳排序
        allMessages.sort((a, b) => {
            const timeA = a.timestamp || a.time || 0;
            const timeB = b.timestamp || b.time || 0;
            return timeA - timeB;
        });

        console.log(`[ResourceMerger] 合并消息: ${allMessages.length} 条，去重: ${deduplicatedCount} 条`);

        return {
            messages: allMessages,
            length: allMessages.length,
            deduplicatedCount
        };
    }

    /**
     * 合并资源文件
     */
    private async mergeResourceFiles(
        sourceFiles: Array<{ taskId: string; resourcePath: string }>,
        outputPath: string,
        resourceFolderName?: string
    ): Promise<{ count: number; mapping: Map<string, string> }> {
        const resourceFolder = resourceFolderName || 'resources';
        const targetResourcePath = path.join(outputPath, resourceFolder);
        
        // 确保目标资源目录存在
        await fsPromises.mkdir(targetResourcePath, { recursive: true });
        await fsPromises.mkdir(path.join(targetResourcePath, 'images'), { recursive: true });
        await fsPromises.mkdir(path.join(targetResourcePath, 'videos'), { recursive: true });
        await fsPromises.mkdir(path.join(targetResourcePath, 'audios'), { recursive: true });
        await fsPromises.mkdir(path.join(targetResourcePath, 'files'), { recursive: true });

        const copiedFiles = new Map<string, string>(); // md5 -> target path
        let totalCount = 0;

        for (const source of sourceFiles) {
            if (!fs.existsSync(source.resourcePath)) {
                continue;
            }

            // 遍历所有资源类型目录
            const resourceTypes = ['images', 'videos', 'audios', 'files'];
            
            for (const type of resourceTypes) {
                const sourceTypeDir = path.join(source.resourcePath, type);
                
                if (!fs.existsSync(sourceTypeDir)) {
                    continue;
                }

                const files = await fsPromises.readdir(sourceTypeDir);
                
                for (const file of files) {
                    const sourcePath = path.join(sourceTypeDir, file);
                    const stat = await fsPromises.stat(sourcePath);
                    
                    if (!stat.isFile()) {
                        continue;
                    }

                    // 计算文件MD5以去重
                    const md5 = await this.calculateFileMD5(sourcePath);
                    
                    if (copiedFiles.has(md5)) {
                        // 文件已存在，跳过
                        console.log(`[ResourceMerger] 跳过重复文件: ${file}`);
                        continue;
                    }

                    // 复制文件到目标目录
                    const targetPath = path.join(targetResourcePath, type, file);
                    await this.copyFile(sourcePath, targetPath);
                    
                    copiedFiles.set(md5, path.relative(outputPath, targetPath));
                    totalCount++;
                }
            }
        }

        console.log(`[ResourceMerger] 资源文件复制完成: ${totalCount} 个文件`);

        return {
            count: totalCount,
            mapping: copiedFiles
        };
    }

    /**
     * 写入合并后的数据（同时生成HTML和JSON）
     */
    private async writeMergedData(
        outputPath: string,
        mergedMessages: any,
        resourceMapping: Map<string, string>
    ): Promise<{ jsonPath: string; htmlPath: string }> {
        // 确保输出目录存在
        await fsPromises.mkdir(outputPath, { recursive: true });

        const messages = mergedMessages.messages || mergedMessages;
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-').substring(0, 19);

        // 1. 写入JSON文件
        const jsonPath = path.join(outputPath, `merged_${timestamp}.json`);
        const jsonData = {
            metadata: {
                mergedAt: new Date().toISOString(),
                messageCount: messages.length,
                resourceCount: resourceMapping.size
            },
            messages: messages,
            resources: Array.from(resourceMapping.entries()).map(([md5, filePath]) => ({
                md5,
                path: filePath
            }))
        };

        await fsPromises.writeFile(jsonPath, JSON.stringify(jsonData, null, 2), 'utf-8');
        console.log(`[ResourceMerger] JSON数据写入完成: ${jsonPath}`);

        // 2. 生成HTML文件
        let htmlPath = path.join(outputPath, `merged_${timestamp}.html`);
        try {
            
            const htmlExporter = new ModernHtmlExporter({
                outputPath: htmlPath,
                includeResourceLinks: true,
                includeSystemMessages: true,
                encoding: 'utf-8'
            });

            // 构造chatInfo
            const chatInfo = {
                name: '合并的聊天记录',
                type: 'group' as 'group' | 'private',
                selfUid: undefined,
                selfUin: undefined,
                selfName: '合并导出'
            };

            // 使用流式导出
            const parser = new SimpleMessageParser();
            const resourceMap = new Map<string, string>();
            
            // 构建资源映射（相对路径）
            for (const [md5, relativePath] of resourceMapping.entries()) {
                resourceMap.set(md5, relativePath);
            }

            const messageStream = parser.parseMessagesStream(messages, resourceMap);
            await htmlExporter.exportFromIterable(messageStream, chatInfo);
            
            console.log(`[ResourceMerger] HTML文件生成完成: ${htmlPath}`);
        } catch (error) {
            console.error(`[ResourceMerger] 生成HTML失败:`, error);
            console.warn(`[ResourceMerger] 合并完成，但HTML生成失败，仅保留JSON文件`);
            htmlPath = ''; // HTML生成失败时设为空字符串
        }
        
        return { jsonPath, htmlPath };
    }

    /**
     * 清理源文件
     */
    private async cleanupSourceFiles(
        sourceFiles: Array<{ taskId: string; htmlPath: string; jsonPath?: string; resourcePath: string }>
    ): Promise<void> {
        for (const source of sourceFiles) {
            try {
                // 删除HTML文件
                if (fs.existsSync(source.htmlPath)) {
                    await fsPromises.unlink(source.htmlPath);
                    console.log(`[ResourceMerger] 已删除HTML文件: ${source.htmlPath}`);
                }
                
                // 删除JSON文件（如果存在）
                if (source.jsonPath && fs.existsSync(source.jsonPath)) {
                    await fsPromises.unlink(source.jsonPath);
                    console.log(`[ResourceMerger] 已删除JSON文件: ${source.jsonPath}`);
                }
                
                // 删除资源目录
                if (fs.existsSync(source.resourcePath)) {
                    await fsPromises.rm(source.resourcePath, { recursive: true, force: true });
                    console.log(`[ResourceMerger] 已删除资源目录: ${source.resourcePath}`);
                }
            } catch (error) {
                console.error(`[ResourceMerger] 删除文件失败:`, error);
            }
        }
    }

    /**
     * 计算文件MD5
     */
    private async calculateFileMD5(filePath: string): Promise<string> {
        return new Promise((resolve, reject) => {
            const hash = crypto.createHash('md5');
            const stream = createReadStream(filePath);
            
            stream.on('data', (data) => hash.update(data));
            stream.on('end', () => resolve(hash.digest('hex')));
            stream.on('error', reject);
        });
    }

    /**
     * 复制文件（使用流）
     */
    private async copyFile(source: string, target: string): Promise<void> {
        await fsPromises.mkdir(path.dirname(target), { recursive: true });
        await pipeline(
            createReadStream(source),
            createWriteStream(target)
        );
    }

    /**
     * 计算目录大小
     */
    private async calculateDirectorySize(dirPath: string): Promise<number> {
        let totalSize = 0;

        const calculateSize = async (currentPath: string): Promise<void> => {
            const stat = await fsPromises.stat(currentPath);
            
            if (stat.isFile()) {
                totalSize += stat.size;
            } else if (stat.isDirectory()) {
                const files = await fsPromises.readdir(currentPath);
                await Promise.all(
                    files.map(file => calculateSize(path.join(currentPath, file)))
                );
            }
        };

        await calculateSize(dirPath);
        return totalSize;
    }
}
