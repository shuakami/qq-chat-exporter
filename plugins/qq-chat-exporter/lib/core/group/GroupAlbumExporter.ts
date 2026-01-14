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

    async getAlbumList(groupCode: string): Promise<AlbumInfo[]> {
        try {
            console.log(`[GroupAlbumExporter] 获取相册列表: groupCode=${groupCode}`);
            const result = await this.core.apis.WebApi.getAlbumListByNTQQ(groupCode);
            
            console.log('[GroupAlbumExporter] API返回:', JSON.stringify(result, null, 2).substring(0, 500));
            
            if (!result?.response) {
                console.error('[GroupAlbumExporter] 获取相册列表失败: 无响应数据');
                return [];
            }

            if (result.response.result !== 0) {
                console.error('[GroupAlbumExporter] 获取相册列表失败: result =', result.response.result, 'errMs =', result.response.errMs);
                return [];
            }

            const albumList = result.response.album_list;
            console.log(`[GroupAlbumExporter] 相册数量: ${albumList?.length || 0}`);
            
            if (!albumList || !Array.isArray(albumList)) {
                return [];
            }

            return albumList.map((album: any) => ({
                albumId: album.album_id,
                albumName: album.name || `相册_${album.album_id}`
            }));
        } catch (error) {
            console.error('[GroupAlbumExporter] 获取相册列表失败:', error);
            return [];
        }
    }

    async getAlbumMediaList(groupCode: string, albumId: string): Promise<AlbumMediaItem[]> {
        try {
            console.log(`[GroupAlbumExporter] 获取相册媒体: groupCode=${groupCode}, albumId=${albumId}`);
            const mediaItems: AlbumMediaItem[] = [];
            let attachInfo = '';

            while (true) {
                const response = await this.core.apis.WebApi.getAlbumMediaListByNTQQ(groupCode, albumId, attachInfo);

                console.log('[GroupAlbumExporter] 媒体API返回完整数据:', JSON.stringify(response, null, 2).substring(0, 2000));
                console.log('[GroupAlbumExporter] 返回数据的所有键:', Object.keys(response || {}));

                if (!response) {
                    console.error('[GroupAlbumExporter] 获取相册媒体列表失败: 无响应数据');
                    break;
                }

                if (response.result !== 0) {
                    console.error('[GroupAlbumExporter] 获取相册媒体列表失败: result =', response.result, 'errMs =', (response as any).errMs);
                    break;
                }

                // 尝试多种可能的字段名
                const items = (response as any).media_list 
                    || (response as any).mediaList 
                    || (response as any).feed_list 
                    || (response as any).feedList
                    || (response as any).list
                    || [];
                    
                console.log(`[GroupAlbumExporter] 本次获取媒体数量: ${items.length}`);
                
                if (items.length > 0) {
                    console.log('[GroupAlbumExporter] 第一个媒体项:', JSON.stringify(items[0], null, 2));
                }

                for (const item of items) {
                    // 处理可能的嵌套结构
                    const mediaData = item.cell_media || item.media || item;
                    const imageData = mediaData.image || mediaData;
                    
                    const mediaItem: AlbumMediaItem = {
                        id: imageData.lloc || item.lloc || item.id || `media_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
                        url: imageData.raw_url || imageData.url || imageData.originUrl || item.raw_url || item.url || '',
                        thumbUrl: imageData.thumb_url || imageData.thumbUrl || item.thumb_url || '',
                        type: (item.is_video || item.isVideo || mediaData.type === 1) ? 'video' : 'image',
                        uploadTime: item.upload_time ? Number(item.upload_time) : undefined,
                        uploaderUin: item.owner_uin || item.ownerUin,
                        uploaderNick: item.owner_name || item.ownerName,
                        width: imageData.width || item.width,
                        height: imageData.height || item.height,
                        fileSize: imageData.picsize || item.picsize || item.fileSize
                    };

                    if (mediaItem.url) {
                        mediaItems.push(mediaItem);
                    }
                }

                const nextAttachInfo = (response as any).attach_info || (response as any).attachInfo;
                if (!nextAttachInfo || items.length === 0) {
                    break;
                }
                attachInfo = nextAttachInfo;
            }

            console.log(`[GroupAlbumExporter] 总共获取媒体: ${mediaItems.length}`);
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
