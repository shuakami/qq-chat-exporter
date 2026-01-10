/**
 * 群文件导出器
 * 负责导出QQ群文件
 */

import fs from 'fs';
import path from 'path';
import { NapCatCore } from 'NapCatQQ/src/core/index.js';
import { PathManager } from '../../utils/PathManager.js';

/**
 * 群文件信息
 */
export interface GroupFileInfo {
    fileId: string;
    fileName: string;
    fileSize: number;
    uploadTime: number;
    uploaderUin?: string;
    uploaderNick?: string;
    downloadCount?: number;
    deadTime?: number;
    modifyTime?: number;
    parentFolderId?: string;
}

/**
 * 群文件夹信息
 */
export interface GroupFolderInfo {
    folderId: string;
    folderName: string;
    createTime?: number;
    creatorUin?: string;
    creatorNick?: string;
    totalFileCount?: number;
    parentFolderId?: string;
}

/**
 * 群文件系统信息
 */
export interface GroupFileSystemInfo {
    groupCode: string;
    fileCount: number;
    totalSpace: number;
    usedSpace: number;
    files: GroupFileInfo[];
    folders: GroupFolderInfo[];
}

/**
 * 导出进度回调
 */
export interface FileExportProgressCallback {
    (progress: {
        phase: 'listing' | 'downloading';
        current: number;
        total: number;
        folderName?: string;
        fileName?: string;
    }): void;
}

/**
 * 导出结果
 */
export interface FileExportResult {
    success: boolean;
    groupCode: string;
    groupName: string;
    fileCount: number;
    folderCount: number;
    downloadedCount: number;
    failedCount: number;
    totalSize: number;
    exportPath: string;
    exportId: string;
    error?: string;
}

/**
 * 导出记录
 */
export interface FileExportRecord {
    id: string;
    groupCode: string;
    groupName: string;
    fileCount: number;
    folderCount: number;
    downloadedCount: number;
    totalSize: number;
    exportPath: string;
    exportTime: Date;
    success: boolean;
    error?: string;
}

/**
 * 群文件导出器
 */
export class GroupFilesExporter {
    private readonly core: NapCatCore;
    private readonly exportBasePath: string;
    private readonly recordsPath: string;
    private exportRecords: FileExportRecord[] = [];
    private pathManager: PathManager;

    constructor(core: NapCatCore) {
        this.core = core;
        this.pathManager = PathManager.getInstance();
        this.exportBasePath = path.join(this.pathManager.getDefaultBaseDir(), 'group-files');
        this.recordsPath = path.join(this.pathManager.getDefaultBaseDir(), 'group-files-records.json');
        
        if (!fs.existsSync(this.exportBasePath)) {
            fs.mkdirSync(this.exportBasePath, { recursive: true });
        }
        
        this.loadRecords();
    }

    private loadRecords(): void {
        try {
            if (fs.existsSync(this.recordsPath)) {
                const data = fs.readFileSync(this.recordsPath, 'utf-8');
                this.exportRecords = JSON.parse(data);
            }
        } catch (error) {
            console.error('[GroupFilesExporter] 加载导出记录失败:', error);
            this.exportRecords = [];
        }
    }

    private saveRecords(): void {
        try {
            fs.writeFileSync(this.recordsPath, JSON.stringify(this.exportRecords, null, 2), 'utf-8');
        } catch (error) {
            console.error('[GroupFilesExporter] 保存导出记录失败:', error);
        }
    }

    private addRecord(record: FileExportRecord): void {
        this.exportRecords.unshift(record);
        if (this.exportRecords.length > 100) {
            this.exportRecords = this.exportRecords.slice(0, 100);
        }
        this.saveRecords();
    }

    getExportRecords(limit: number = 50): FileExportRecord[] {
        return this.exportRecords.slice(0, limit);
    }

    /**
     * 获取群文件列表
     */
    async getGroupFileList(
        groupCode: string,
        folderId: string = '/',
        startIndex: number = 0,
        fileCount: number = 100
    ): Promise<{ files: GroupFileInfo[]; folders: GroupFolderInfo[] }> {
        try {
            const richMediaService = this.core.context.session.getRichMediaService();
            
            const result = await richMediaService.getGroupFileList(groupCode, {
                sortType: 1,
                fileCount,
                startIndex,
                sortOrder: 1,
                showOnlinedocFolder: 0,
                folderId
            });

            const files: GroupFileInfo[] = [];
            const folders: GroupFolderInfo[] = [];

            if (result && (result as any).groupSpaceResult) {
                // 解析文件列表
                const fileList = (result as any).fileList || [];
                const folderList = (result as any).folderList || [];

                for (const file of fileList) {
                    files.push({
                        fileId: file.fileId || file.id,
                        fileName: file.fileName || file.name,
                        fileSize: file.fileSize || file.size || 0,
                        uploadTime: file.uploadTime || file.uploadedTime || 0,
                        uploaderUin: file.uploaderUin || file.uploadUin,
                        uploaderNick: file.uploaderNick || file.uploadNick,
                        downloadCount: file.downloadTimes || file.downloadCount || 0,
                        deadTime: file.deadTime,
                        modifyTime: file.modifyTime,
                        parentFolderId: folderId
                    });
                }

                for (const folder of folderList) {
                    folders.push({
                        folderId: folder.folderId || folder.id,
                        folderName: folder.folderName || folder.name,
                        createTime: folder.createTime,
                        creatorUin: folder.creatorUin,
                        creatorNick: folder.creatorNick,
                        totalFileCount: folder.totalFileCount || folder.fileCount || 0,
                        parentFolderId: folderId
                    });
                }
            }

            return { files, folders };
        } catch (error) {
            console.error('[GroupFilesExporter] 获取群文件列表失败:', error);
            return { files: [], folders: [] };
        }
    }

    /**
     * 递归获取所有文件和文件夹
     */
    async getAllFilesRecursive(
        groupCode: string,
        folderId: string = '/',
        onProgress?: FileExportProgressCallback
    ): Promise<{ files: GroupFileInfo[]; folders: GroupFolderInfo[] }> {
        const allFiles: GroupFileInfo[] = [];
        const allFolders: GroupFolderInfo[] = [];
        const foldersToProcess: { id: string; name: string }[] = [{ id: folderId, name: '根目录' }];

        while (foldersToProcess.length > 0) {
            const currentFolder = foldersToProcess.shift()!;
            
            onProgress?.({
                phase: 'listing',
                current: allFolders.length,
                total: allFolders.length + foldersToProcess.length,
                folderName: currentFolder.name
            });

            const { files, folders } = await this.getGroupFileList(groupCode, currentFolder.id);
            
            allFiles.push(...files);
            
            for (const folder of folders) {
                allFolders.push(folder);
                foldersToProcess.push({ id: folder.folderId, name: folder.folderName });
            }

            // 添加延迟避免请求过快
            await new Promise(resolve => setTimeout(resolve, 200));
        }

        return { files: allFiles, folders: allFolders };
    }

    /**
     * 下载群文件
     */
    async downloadGroupFile(groupCode: string, fileId: string, destPath: string): Promise<boolean> {
        try {
            const richMediaService = this.core.context.session.getRichMediaService();
            
            // 转存文件到本地
            const result = await richMediaService.transGroupFile(groupCode, fileId);
            
            if (result && (result as any).transGroupFileResult?.result?.retCode === 0) {
                const savePath = (result as any).transGroupFileResult?.saveFilePath;
                
                if (savePath && fs.existsSync(savePath)) {
                    // 复制到目标路径
                    fs.copyFileSync(savePath, destPath);
                    return true;
                }
            }
            
            return false;
        } catch (error) {
            console.error('[GroupFilesExporter] 下载群文件失败:', error);
            return false;
        }
    }

    /**
     * 获取群文件数量
     */
    async getGroupFileCount(groupCode: string): Promise<number> {
        try {
            const result = await this.core.apis.GroupApi.getGroupFileCount([groupCode]);
            
            if (result && result.groupFileCounts && result.groupFileCounts.length > 0) {
                return result.groupFileCounts[0];
            }
            
            return 0;
        } catch (error) {
            console.error('[GroupFilesExporter] 获取群文件数量失败:', error);
            return 0;
        }
    }

    /**
     * 导出群文件（仅元数据，不下载文件）
     */
    async exportGroupFilesMetadata(
        groupCode: string,
        groupName: string,
        onProgress?: FileExportProgressCallback
    ): Promise<FileExportResult> {
        const exportId = `files_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        const timestamp = Date.now();
        const safeName = groupName.replace(/[\/\\:*?"<>|]/g, '_');
        const exportDir = path.join(this.exportBasePath, `${safeName}_${groupCode}_${timestamp}`);

        try {
            fs.mkdirSync(exportDir, { recursive: true });

            // 获取所有文件和文件夹
            const { files, folders } = await this.getAllFilesRecursive(groupCode, '/', onProgress);

            const totalSize = files.reduce((sum, f) => sum + f.fileSize, 0);

            // 保存元数据
            const metadata = {
                groupCode,
                groupName,
                exportTime: new Date().toISOString(),
                fileCount: files.length,
                folderCount: folders.length,
                totalSize,
                folders: folders.map(f => ({
                    ...f,
                    files: files.filter(file => file.parentFolderId === f.folderId)
                })),
                rootFiles: files.filter(f => f.parentFolderId === '/')
            };

            fs.writeFileSync(
                path.join(exportDir, 'file-list.json'),
                JSON.stringify(metadata, null, 2),
                'utf-8'
            );

            // 生成可读的文件列表
            let readableList = `# ${groupName} 群文件列表\n`;
            readableList += `导出时间: ${new Date().toLocaleString('zh-CN')}\n`;
            readableList += `文件总数: ${files.length}\n`;
            readableList += `文件夹数: ${folders.length}\n`;
            readableList += `总大小: ${this.formatFileSize(totalSize)}\n\n`;

            // 根目录文件
            const rootFiles = files.filter(f => f.parentFolderId === '/');
            if (rootFiles.length > 0) {
                readableList += `## 根目录 (${rootFiles.length} 个文件)\n\n`;
                for (const file of rootFiles) {
                    readableList += `- ${file.fileName} (${this.formatFileSize(file.fileSize)})\n`;
                }
                readableList += '\n';
            }

            // 各文件夹
            for (const folder of folders) {
                const folderFiles = files.filter(f => f.parentFolderId === folder.folderId);
                readableList += `## ${folder.folderName} (${folderFiles.length} 个文件)\n\n`;
                for (const file of folderFiles) {
                    readableList += `- ${file.fileName} (${this.formatFileSize(file.fileSize)})\n`;
                }
                readableList += '\n';
            }

            fs.writeFileSync(
                path.join(exportDir, 'file-list.md'),
                readableList,
                'utf-8'
            );

            // 添加导出记录
            this.addRecord({
                id: exportId,
                groupCode,
                groupName,
                fileCount: files.length,
                folderCount: folders.length,
                downloadedCount: 0,
                totalSize,
                exportPath: exportDir,
                exportTime: new Date(),
                success: true
            });

            return {
                success: true,
                groupCode,
                groupName,
                fileCount: files.length,
                folderCount: folders.length,
                downloadedCount: 0,
                failedCount: 0,
                totalSize,
                exportPath: exportDir,
                exportId
            };
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);

            this.addRecord({
                id: exportId,
                groupCode,
                groupName,
                fileCount: 0,
                folderCount: 0,
                downloadedCount: 0,
                totalSize: 0,
                exportPath: exportDir,
                exportTime: new Date(),
                success: false,
                error: errorMessage
            });

            return {
                success: false,
                groupCode,
                groupName,
                fileCount: 0,
                folderCount: 0,
                downloadedCount: 0,
                failedCount: 0,
                totalSize: 0,
                exportPath: exportDir,
                exportId,
                error: errorMessage
            };
        }
    }

    /**
     * 导出群文件（包含下载）
     */
    async exportGroupFilesWithDownload(
        groupCode: string,
        groupName: string,
        onProgress?: FileExportProgressCallback
    ): Promise<FileExportResult> {
        const exportId = `files_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        const timestamp = Date.now();
        const safeName = groupName.replace(/[\/\\:*?"<>|]/g, '_');
        const exportDir = path.join(this.exportBasePath, `${safeName}_${groupCode}_${timestamp}`);

        try {
            fs.mkdirSync(exportDir, { recursive: true });

            // 获取所有文件和文件夹
            const { files, folders } = await this.getAllFilesRecursive(groupCode, '/', onProgress);

            let downloadedCount = 0;
            let failedCount = 0;
            const totalSize = files.reduce((sum, f) => sum + f.fileSize, 0);

            // 创建文件夹结构
            const folderPaths: Map<string, string> = new Map();
            folderPaths.set('/', exportDir);

            for (const folder of folders) {
                const parentPath = folderPaths.get(folder.parentFolderId || '/') || exportDir;
                const folderPath = path.join(parentPath, folder.folderName.replace(/[\/\\:*?"<>|]/g, '_'));
                fs.mkdirSync(folderPath, { recursive: true });
                folderPaths.set(folder.folderId, folderPath);
            }

            // 下载文件
            for (let i = 0; i < files.length; i++) {
                const file = files[i];
                const parentPath = folderPaths.get(file.parentFolderId || '/') || exportDir;
                const filePath = path.join(parentPath, file.fileName.replace(/[\/\\:*?"<>|]/g, '_'));

                onProgress?.({
                    phase: 'downloading',
                    current: i + 1,
                    total: files.length,
                    fileName: file.fileName
                });

                const success = await this.downloadGroupFile(groupCode, file.fileId, filePath);
                
                if (success) {
                    downloadedCount++;
                } else {
                    failedCount++;
                }

                // 添加延迟避免请求过快
                await new Promise(resolve => setTimeout(resolve, 500));
            }

            // 保存元数据
            const metadata = {
                groupCode,
                groupName,
                exportTime: new Date().toISOString(),
                fileCount: files.length,
                folderCount: folders.length,
                downloadedCount,
                failedCount,
                totalSize,
                files,
                folders
            };

            fs.writeFileSync(
                path.join(exportDir, 'metadata.json'),
                JSON.stringify(metadata, null, 2),
                'utf-8'
            );

            // 添加导出记录
            this.addRecord({
                id: exportId,
                groupCode,
                groupName,
                fileCount: files.length,
                folderCount: folders.length,
                downloadedCount,
                totalSize,
                exportPath: exportDir,
                exportTime: new Date(),
                success: true
            });

            return {
                success: true,
                groupCode,
                groupName,
                fileCount: files.length,
                folderCount: folders.length,
                downloadedCount,
                failedCount,
                totalSize,
                exportPath: exportDir,
                exportId
            };
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);

            this.addRecord({
                id: exportId,
                groupCode,
                groupName,
                fileCount: 0,
                folderCount: 0,
                downloadedCount: 0,
                totalSize: 0,
                exportPath: exportDir,
                exportTime: new Date(),
                success: false,
                error: errorMessage
            });

            return {
                success: false,
                groupCode,
                groupName,
                fileCount: 0,
                folderCount: 0,
                downloadedCount: 0,
                failedCount: 0,
                totalSize: 0,
                exportPath: exportDir,
                exportId,
                error: errorMessage
            };
        }
    }

    private formatFileSize(bytes: number): string {
        if (bytes === 0) return '0 B';
        const k = 1024;
        const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    }
}
