/**
 * 群文件导出器
 * 负责导出QQ群文件
 */

import fs from 'fs';
import path from 'path';
import { NapCatCore } from 'NapCatQQ/src/core/index.js';
import { PathManager } from '../../utils/PathManager.js';

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

export interface GroupFolderInfo {
    folderId: string;
    folderName: string;
    createTime?: number;
    creatorUin?: string;
    creatorNick?: string;
    totalFileCount?: number;
    parentFolderId?: string;
}

export interface GroupFileSystemInfo {
    groupCode: string;
    fileCount: number;
    totalSpace: number;
    usedSpace: number;
    files: GroupFileInfo[];
    folders: GroupFolderInfo[];
}

export interface FileExportProgressCallback {
    (progress: {
        phase: 'listing' | 'downloading';
        current: number;
        total: number;
        folderName?: string;
        fileName?: string;
    }): void;
}

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

    async getGroupFileList(
        groupCode: string,
        folderId: string = '',
        startIndex: number = 0,
        fileCount: number = 100
    ): Promise<{ files: GroupFileInfo[]; folders: GroupFolderInfo[] }> {
        try {
            const params = {
                sortType: 1,
                fileCount,
                startIndex,
                sortOrder: 2,
                showOnlinedocFolder: 0,
                folderId
            };
            
            const items = await this.core.apis.MsgApi.getGroupFileList(groupCode, params);

            const files: GroupFileInfo[] = [];
            const folders: GroupFolderInfo[] = [];

            if (!items || !Array.isArray(items)) {
                return { files: [], folders: [] };
            }

            for (const item of items) {
                if (item.fileInfo) {
                    const fileInfo = item.fileInfo;
                    files.push({
                        fileId: fileInfo.fileId,
                        fileName: fileInfo.fileName,
                        fileSize: parseInt(fileInfo.fileSize, 10) || 0,
                        uploadTime: fileInfo.uploadTime,
                        uploaderUin: fileInfo.uploaderUin,
                        uploaderNick: fileInfo.uploaderName,
                        downloadCount: fileInfo.downloadTimes,
                        deadTime: fileInfo.deadTime,
                        modifyTime: fileInfo.modifyTime,
                        parentFolderId: folderId || '/'
                    });
                }

                if (item.folderInfo) {
                    const folderInfo = item.folderInfo;
                    folders.push({
                        folderId: folderInfo.folderId,
                        folderName: folderInfo.folderName,
                        createTime: folderInfo.createTime,
                        creatorUin: folderInfo.createUin,
                        creatorNick: folderInfo.creatorName,
                        totalFileCount: folderInfo.totalFileCount,
                        parentFolderId: folderId || '/'
                    });
                }
            }

            return { files, folders };
        } catch (error) {
            console.error('[GroupFilesExporter] 获取群文件列表失败:', error);
            return { files: [], folders: [] };
        }
    }

    private async getGroupFileListPaginated(
        groupCode: string,
        folderId: string = ''
    ): Promise<{ files: GroupFileInfo[]; folders: GroupFolderInfo[] }> {
        const allFiles: GroupFileInfo[] = [];
        const allFolders: GroupFolderInfo[] = [];
        const pageSize = 100;
        let startIndex = 0;
        let hasMore = true;

        while (hasMore) {
            const { files, folders } = await this.getGroupFileList(groupCode, folderId, startIndex, pageSize);
            
            allFiles.push(...files);
            allFolders.push(...folders);

            const totalReturned = files.length + folders.length;
            if (totalReturned < pageSize) {
                hasMore = false;
            } else {
                startIndex += pageSize;
                if (startIndex > 10000) {
                    hasMore = false;
                }
                await new Promise(resolve => setTimeout(resolve, 100));
            }
        }

        return { files: allFiles, folders: allFolders };
    }

    async getAllFilesRecursive(
        groupCode: string,
        folderId: string = '',
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

            const { files, folders } = await this.getGroupFileListPaginated(groupCode, currentFolder.id);
            
            allFiles.push(...files);
            
            for (const folder of folders) {
                allFolders.push(folder);
                foldersToProcess.push({ id: folder.folderId, name: folder.folderName });
            }

            await new Promise(resolve => setTimeout(resolve, 200));
        }

        return { files: allFiles, folders: allFolders };
    }

    async downloadGroupFile(groupCode: string, fileId: string, destPath: string): Promise<boolean> {
        try {
            const richMediaService = this.core.context.session.getRichMediaService();
            const normalizedFileId = fileId.startsWith('/') ? fileId.substring(1) : fileId;
            
            const result = await richMediaService.transGroupFile(groupCode, normalizedFileId);
            
            if (result && (result as any).transGroupFileResult?.result?.retCode === 0) {
                const savePath = (result as any).transGroupFileResult?.saveFilePath;
                
                if (savePath && fs.existsSync(savePath)) {
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

    async getFileDownloadUrl(groupCode: string, fileId: string): Promise<string | null> {
        try {
            const normalizedFileId = fileId.startsWith('/') ? fileId.substring(1) : fileId;
            
            const url = await this.core.apis.PacketApi.pkt.operation.GetGroupFileUrl(
                parseInt(groupCode, 10),
                normalizedFileId
            );
            
            return url || null;
        } catch (error) {
            console.error('[GroupFilesExporter] 获取文件下载链接失败:', error);
            return null;
        }
    }

    async exportGroupFilesMetadata(
        groupCode: string,
        groupName: string,
        onProgress?: FileExportProgressCallback
    ): Promise<FileExportResult> {
        const exportId = `files_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
        const timestamp = Date.now();
        const safeName = groupName.replace(/[\/\\:*?"<>|]/g, '_');
        const exportDir = path.join(this.exportBasePath, `${safeName}_${groupCode}_${timestamp}`);

        try {
            fs.mkdirSync(exportDir, { recursive: true });

            const { files, folders } = await this.getAllFilesRecursive(groupCode, '', onProgress);

            const totalSize = files.reduce((sum, f) => sum + f.fileSize, 0);

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
                rootFiles: files.filter(f => f.parentFolderId === '/' || f.parentFolderId === '')
            };

            fs.writeFileSync(
                path.join(exportDir, 'file-list.json'),
                JSON.stringify(metadata, null, 2),
                'utf-8'
            );

            let readableList = `# ${groupName} 群文件列表\n`;
            readableList += `导出时间: ${new Date().toLocaleString('zh-CN')}\n`;
            readableList += `文件总数: ${files.length}\n`;
            readableList += `文件夹数: ${folders.length}\n`;
            readableList += `总大小: ${this.formatFileSize(totalSize)}\n\n`;

            const rootFiles = files.filter(f => f.parentFolderId === '/' || f.parentFolderId === '');
            if (rootFiles.length > 0) {
                readableList += `## 根目录 (${rootFiles.length} 个文件)\n\n`;
                for (const file of rootFiles) {
                    readableList += `- ${file.fileName} (${this.formatFileSize(file.fileSize)})\n`;
                }
                readableList += '\n';
            }

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

    async exportGroupFilesWithDownload(
        groupCode: string,
        groupName: string,
        onProgress?: FileExportProgressCallback
    ): Promise<FileExportResult> {
        const exportId = `files_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
        const timestamp = Date.now();
        const safeName = groupName.replace(/[\/\\:*?"<>|]/g, '_');
        const exportDir = path.join(this.exportBasePath, `${safeName}_${groupCode}_${timestamp}`);

        try {
            fs.mkdirSync(exportDir, { recursive: true });

            const { files, folders } = await this.getAllFilesRecursive(groupCode, '', onProgress);

            let downloadedCount = 0;
            let failedCount = 0;
            const totalSize = files.reduce((sum, f) => sum + f.fileSize, 0);

            const folderPaths: Map<string, string> = new Map();
            folderPaths.set('/', exportDir);
            folderPaths.set('', exportDir);

            for (const folder of folders) {
                const parentPath = folderPaths.get(folder.parentFolderId || '') || exportDir;
                const folderPath = path.join(parentPath, folder.folderName.replace(/[\/\\:*?"<>|]/g, '_'));
                fs.mkdirSync(folderPath, { recursive: true });
                folderPaths.set(folder.folderId, folderPath);
            }

            for (let i = 0; i < files.length; i++) {
                const file = files[i];
                const parentPath = folderPaths.get(file.parentFolderId || '') || exportDir;
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

                await new Promise(resolve => setTimeout(resolve, 500));
            }

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
