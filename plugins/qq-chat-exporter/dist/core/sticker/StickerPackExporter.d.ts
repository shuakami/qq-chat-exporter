/**
 * 表情包导出器
 * 负责导出QQ中添加的表情包资源包
 */
import { NapCatCore } from 'NapCatQQ/src/core/index.js';
/**
 * 表情包类型枚举
 */
export declare enum StickerPackType {
    /** 收藏的单个表情 */
    FAVORITE_EMOJI = "favorite_emoji",
    /** 市场表情包 */
    MARKET_PACK = "market_pack",
    /** 系统表情包 */
    SYSTEM_PACK = "system_pack"
}
/**
 * 表情包信息
 */
export interface StickerPackInfo {
    /** 表情包ID */
    packId: string;
    /** 表情包名称 */
    packName: string;
    /** 表情包类型 */
    packType: StickerPackType;
    /** 表情包描述 */
    description?: string;
    /** 表情数量 */
    stickerCount: number;
    /** 表情列表 */
    stickers: StickerInfo[];
    /** 原始数据（用于调试） */
    rawData?: any;
}
/**
 * 单个表情信息
 */
export interface StickerInfo {
    /** 表情ID */
    stickerId: string;
    /** 表情名称 */
    name: string;
    /** 表情路径 */
    path: string;
    /** 是否已下载 */
    downloaded: boolean;
    /** MD5哈希 */
    md5?: string;
    /** 文件大小 */
    fileSize?: number;
}
/**
 * 导出结果
 */
export interface ExportResult {
    /** 是否成功 */
    success: boolean;
    /** 导出的表情包数量 */
    packCount: number;
    /** 导出的表情总数 */
    stickerCount: number;
    /** 导出路径 */
    exportPath: string;
    /** 导出ID */
    exportId?: string;
    /** 错误信息 */
    error?: string;
}
/**
 * 导出记录
 */
export interface ExportRecord {
    /** 记录ID */
    id: string;
    /** 导出类型 */
    type: 'single' | 'all';
    /** 表情包ID（单个导出时） */
    packId?: string;
    /** 表情包名称 */
    packName?: string;
    /** 导出的表情包数量 */
    packCount: number;
    /** 导出的表情总数 */
    stickerCount: number;
    /** 导出路径 */
    exportPath: string;
    /** 导出时间 */
    exportTime: Date;
    /** 是否成功 */
    success: boolean;
    /** 错误信息 */
    error?: string;
}
/**
 * 表情包导出器
 */
export declare class StickerPackExporter {
    private readonly core;
    private readonly exportBasePath;
    private readonly recordsPath;
    private exportRecords;
    constructor(core: NapCatCore);
    /**
     * 加载导出记录
     */
    private loadRecords;
    /**
     * 保存导出记录
     */
    private saveRecords;
    /**
     * 添加导出记录
     */
    private addRecord;
    /**
     * 获取导出记录
     */
    getExportRecords(limit?: number): ExportRecord[];
    /**
     * 下载文件
     */
    private downloadFile;
    /**
     * 获取所有表情包列表
     * @param types 要获取的表情包类型，默认获取所有类型
     */
    getStickerPacks(types?: StickerPackType[]): Promise<StickerPackInfo[]>;
    /**
     * 获取收藏的单个表情
     */
    private getFavoriteEmojis;
    private getMarketEmoticonPacks;
    private parseMarketPackJsonData;
    private parseMarketPackInfo;
    /**
     * 获取系统表情包
     */
    private getSystemEmoticonPacks;
    /**
     * 导出指定的表情包
     */
    exportStickerPack(packId: string): Promise<ExportResult>;
    /**
     * 导出所有表情包
     */
    exportAllStickerPacks(): Promise<ExportResult>;
}
//# sourceMappingURL=StickerPackExporter.d.ts.map