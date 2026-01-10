/**
 * 群相册导出器
 * 负责导出QQ群相册中的图片和视频
 */

import fs from 'fs';
import path from 'path';
import https from 'https';
import http from 'http';
import { NapCatCore } from 'NapCatQQ/src/core/index.js';
import { PathManager } from '../../utils/PathManager.js';

/**
 * 相册信息
 */
export interface AlbumInfo {
    albumId: string;
    albumName: string;
    photoCount?: number;
}

/**
 * 相册媒体项
 */
export interface AlbumMediaItem {
    id: string;
    url: string;
    thumbUrl?: string;
    type: 'image' | 'video';
    uploadTime?: number;
    uploaderUin?: string;
    uploaderNick?: string;
    width?: number;
    height?: number;
    fileSize?: number;
}

/**
 * 导出进度回调
 */
export interface ExportProgressCallback {
    (progress: {
        phase: 'fetching' | 'downloading';
        current: number;
        total: number;
        albumName?: string;
        fileName?: string;
    }): void;
}

/**
 * 导出结果
 */
export interface AlbumExportResult {
    success: boolean;
    groupCode: string;
    groupName: string;
    albumCount: number;
    mediaCount: number;
    downloadedCount: number;
    failedCount: number;
    exportPath: string;
    exportId: string;
    error?: string;
}

/**
 * 导出记录
 */
export interface AlbumExportRecord {
    id: string;
    groupCode: string;
    groupName: string;
    albumCount: number;
    mediaCount: number;
    downloadedCount: number;
    exportPath: string;
    exportTime: Date;
    success: boolean;
    error?: string;
}

/**
 * 群相册导出器
 */
export class GroupAlbumExporter {
    private readonly core: NapCatCore;
    private readonly exportBasePath: string;
    private readonly recordsPath: string;
    private exportRecords: AlbumExportRecord[] = [];
    private pathManager: PathManager;

    constructor(core: NapCatCore) {
        this.core = core;
        this.pathManager = PathManager.getInstance();
        this.exportBasePath = path.join(this.pathManager.getDefaultBaseDir(), 'group-albums');
        this.recordsPath = path.join(this.pathManager.getDefaultBaseDir(), 'group-album-records.json');
        
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
            console.error('[GroupAlbumExporter] 加载导出记录失败:', error);
            this.exportRecords = [];
        }
    }

    private saveRecords(): void {
        try {
            fs.writeFileSync(this.recordsPath, JSON.stringify(this.exportRecords, null, 2), 'utf-8');
        } catch (error) {
            console.error('[GroupAlbumExporter] 保存导出记录失败:', error);
        }
    }

    private addRecord(record: AlbumExportRecord): void {
        this.exportRecords.unshift(record);
        if (this.exportRecords.length > 100) {
            this.exportRecords = this.exportRecords.slice(0, 100);
        }
        this.saveRecords();
    }

    getExportRecords(limit: number = 50): AlbumExportRecord[] {
        return this.exportRecords.slice(0, limit);
    }

    /**
     * 下载文件
     */
    private downloadFile(url: string, destPath: string, timeout: number = 30000): Promise<boolean> {
        return new Promise((resolve) => {
            try {
                const protocol = url.startsWith('https') ? https : http;
                const file = fs.createWriteStream(destPath);
                
                const request = protocol.get(url, { timeout }, (response) => {
                    if (response.statusCode === 301 || response.statusCode === 302) {
                        const redirectUrl = response.headers.location;
                        if (redirectUrl) {
                            file.close();
                            fs.unlinkSync(destPath);
                            this.downloadFile(redirectUrl, destPath, timeout).then(resolve);
                            return;
                        }
                    }
                    
                    if (response.statusCode === 200) {
                        response.pipe(file);
                        file.on('finish', () => {
                            file.close();
                            resolve(true);
                        });
                    } else {
                        file.close();
                        if (fs.existsSync(destPath)) fs.unlinkSync(destPath);
                        resolve(false);
                    }
                });

                request.on('error', () => {
                    file.close();
                    if (fs.existsSync(destPath)) fs.unlinkSync(destPath);
                    resolve(false);
                });

                request.on('timeout', () => {
                    request.destroy();
                    file.close();
                    if (fs.existsSync(destPath)) fs.unlinkSync(destPath);
                    resolve(false);
                });
            } catch (error) {
                resolve(false);
            }
        });
    }

    /**
     * 获取群相册列表
     */
    async getAlbumList(groupCode: string): Promise<AlbumInfo[]> {
        try {
            const result = await this.core.apis.WebApi.getAlbumList(groupCode);
            
            if (result && Array.isArray(result)) {
                return result.map((album: any) => ({
                    albumId: album.id || album.albumId,
                    albumName: album.title || album.name || `相册_${album.id}`,
                    photoCount: album.photoCount || album.count || 0
                }));
            }
            
            return [];
        } catch (error) {
            console.error('[GroupAlbumExporter] 获取相册列表失败:', error);
            return [];
        }
    }

    /**
     * 获取相册媒体列表
     */
    async getAlbumMediaList(groupCode: string, albumId: string): Promise<AlbumMediaItem[]> {
        try {
            const result = await this.core.apis.WebApi.getAlbumMediaListByNTQQ(groupCode, albumId);
            
            if (!result) return [];

            const mediaItems: AlbumMediaItem[] = [];
            
            // 解析返回的媒体数据
            if (result && typeof result === 'object') {
                const items = (result as any).media_list || (result as any).mediaList || [];
                
                for (const item of items) {
                    const mediaItem: AlbumMediaItem = {
                        id: item.id || item.lloc || `media_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
                        url: item.url || item.originUrl || item.raw_url || '',
                        thumbUrl: item.thumbUrl || item.thumb_url || '',
                        type: item.type === 'video' || item.isVideo ? 'video' : 'image',
                        uploadTime: item.uploadTime || item.upload_time,
                        uploaderUin: item.uploaderUin || item.uploader_uin,
                        uploaderNick: item.uploaderNick || item.uploader_nick,
                        width: item.width,
                        height: item.height,
                        fileSize: item.fileSize || item.file_size
                    };
                    
                    if (mediaItem.url) {
                        mediaItems.push(mediaItem);
                    }
                }
            }
            
            return mediaItems;
        } catch (error) {
            console.error('[GroupAlbumExporter] 获取相册媒体列表失败:', error);
            return [];
        }
    }

    /**
     * 导出群相册
     */
    async exportGroupAlbum(
        groupCode: string,
        groupName: string,
        albumIds?: string[],
        onProgress?: ExportProgressCallback
    ): Promise<AlbumExportResult> {
        const exportId = `album_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        const timestamp = Date.now();
        const safeName = groupName.replace(/[\/\\:*?"<>|]/g, '_');
        const exportDir = path.join(this.exportBasePath, `${safeName}_${groupCode}_${timestamp}`);
        
        try {
            fs.mkdirSync(exportDir, { recursive: true });
            
            // 获取相册列表
            onProgress?.({ phase: 'fetching', current: 0, total: 0 });
            const albums = await this.getAlbumList(groupCode);
            
            if (albums.length === 0) {
                return {
                    success: false,
                    groupCode,
                    groupName,
                    albumCount: 0,
                    mediaCount: 0,
                    downloadedCount: 0,
                    failedCount: 0,
                    exportPath: exportDir,
                    exportId,
                    error: '未找到相册'
                };
            }

            // 筛选要导出的相册
            const targetAlbums = albumIds && albumIds.length > 0
                ? albums.filter(a => albumIds.includes(a.albumId))
                : albums;

            let totalMediaCount = 0;
            let downloadedCount = 0;
            let failedCount = 0;
            const albumData: any[] = [];

            for (let i = 0; i < targetAlbums.length; i++) {
                const album = targetAlbums[i];
                const albumDir = path.join(exportDir, album.albumName.replace(/[\/\\:*?"<>|]/g, '_'));
                fs.mkdirSync(albumDir, { recursive: true });

                onProgress?.({
                    phase: 'fetching',
                    current: i + 1,
                    total: targetAlbums.length,
                    albumName: album.albumName
                });

                // 获取相册媒体
                const mediaItems = await this.getAlbumMediaList(groupCode, album.albumId);
                totalMediaCount += mediaItems.length;

                const albumMediaData: any[] = [];

                // 下载媒体文件
                for (let j = 0; j < mediaItems.length; j++) {
                    const media = mediaItems[j];
                    const ext = media.type === 'video' ? '.mp4' : '.jpg';
                    const fileName = `${media.id}${ext}`;
                    const filePath = path.join(albumDir, fileName);

                    onProgress?.({
                        phase: 'downloading',
                        current: downloadedCount + failedCount + 1,
                        total: totalMediaCount,
                        albumName: album.albumName,
                        fileName
                    });

                    const success = await this.downloadFile(media.url, filePath);
                    
                    if (success) {
                        downloadedCount++;
                        albumMediaData.push({
                            ...media,
                            localPath: fileName,
                            downloaded: true
                        });
                    } else {
                        failedCount++;
                        albumMediaData.push({
                            ...media,
                            downloaded: false
                        });
                    }

                    // 添加延迟避免请求过快
                    await new Promise(resolve => setTimeout(resolve, 100));
                }

                albumData.push({
                    albumId: album.albumId,
                    albumName: album.albumName,
                    mediaCount: mediaItems.length,
                    downloadedCount: albumMediaData.filter(m => m.downloaded).length,
                    media: albumMediaData
                });
            }

            // 保存元数据
            const metadata = {
                groupCode,
                groupName,
                exportTime: new Date().toISOString(),
                albumCount: targetAlbums.length,
                totalMediaCount,
                downloadedCount,
                failedCount,
                albums: albumData
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
                albumCount: targetAlbums.length,
                mediaCount: totalMediaCount,
                downloadedCount,
                exportPath: exportDir,
                exportTime: new Date(),
                success: true
            });

            return {
                success: true,
                groupCode,
                groupName,
                albumCount: targetAlbums.length,
                mediaCount: totalMediaCount,
                downloadedCount,
                failedCount,
                exportPath: exportDir,
                exportId
            };
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            
            this.addRecord({
                id: exportId,
                groupCode,
                groupName,
                albumCount: 0,
                mediaCount: 0,
                downloadedCount: 0,
                exportPath: exportDir,
                exportTime: new Date(),
                success: false,
                error: errorMessage
            });

            return {
                success: false,
                groupCode,
                groupName,
                albumCount: 0,
                mediaCount: 0,
                downloadedCount: 0,
                failedCount: 0,
                exportPath: exportDir,
                exportId,
                error: errorMessage
            };
        }
    }
}
