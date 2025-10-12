/**
 * 表情包导出器
 * 负责导出QQ中添加的表情包资源包
 */
import fs from 'fs';
import path from 'path';
import https from 'https';
import { NapCatCore } from 'NapCatQQ/src/core/index.js';
/**
 * 表情包类型枚举
 */
export var StickerPackType;
(function (StickerPackType) {
    /** 收藏的单个表情 */
    StickerPackType["FAVORITE_EMOJI"] = "favorite_emoji";
    /** 市场表情包 */
    StickerPackType["MARKET_PACK"] = "market_pack";
    /** 系统表情包 */
    StickerPackType["SYSTEM_PACK"] = "system_pack";
})(StickerPackType || (StickerPackType = {}));
/**
 * 表情包导出器
 */
export class StickerPackExporter {
    core;
    exportBasePath;
    recordsPath;
    exportRecords = [];
    constructor(core) {
        this.core = core;
        const userProfile = process.env['USERPROFILE'] || process.env['HOME'] || '.';
        this.exportBasePath = path.join(userProfile, '.qq-chat-exporter', 'sticker-packs');
        this.recordsPath = path.join(userProfile, '.qq-chat-exporter', 'sticker-export-records.json');
        // 确保导出目录存在
        if (!fs.existsSync(this.exportBasePath)) {
            fs.mkdirSync(this.exportBasePath, { recursive: true });
        }
        // 加载导出记录
        this.loadRecords();
    }
    /**
     * 加载导出记录
     */
    loadRecords() {
        try {
            if (fs.existsSync(this.recordsPath)) {
                const data = fs.readFileSync(this.recordsPath, 'utf-8');
                this.exportRecords = JSON.parse(data);
            }
        }
        catch (error) {
            console.error('[StickerPackExporter] 加载导出记录失败:', error);
            this.exportRecords = [];
        }
    }
    /**
     * 保存导出记录
     */
    saveRecords() {
        try {
            fs.writeFileSync(this.recordsPath, JSON.stringify(this.exportRecords, null, 2), 'utf-8');
        }
        catch (error) {
            console.error('[StickerPackExporter] 保存导出记录失败:', error);
        }
    }
    /**
     * 添加导出记录
     */
    addRecord(record) {
        this.exportRecords.unshift(record);
        // 只保留最近100条记录
        if (this.exportRecords.length > 100) {
            this.exportRecords = this.exportRecords.slice(0, 100);
        }
        this.saveRecords();
    }
    /**
     * 获取导出记录
     */
    getExportRecords(limit = 50) {
        return this.exportRecords.slice(0, limit);
    }
    /**
     * 下载文件
     */
    downloadFile(url, destPath) {
        return new Promise((resolve) => {
            try {
                const file = fs.createWriteStream(destPath);
                https.get(url, (response) => {
                    if (response.statusCode === 200) {
                        response.pipe(file);
                        file.on('finish', () => {
                            file.close();
                            resolve(true);
                        });
                    }
                    else {
                        file.close();
                        fs.unlinkSync(destPath);
                        resolve(false);
                    }
                }).on('error', (err) => {
                    file.close();
                    if (fs.existsSync(destPath)) {
                        fs.unlinkSync(destPath);
                    }
                    console.error(`[StickerPackExporter] 下载错误: ${err.message}`);
                    resolve(false);
                });
            }
            catch (error) {
                console.error(`[StickerPackExporter] 下载异常:`, error);
                resolve(false);
            }
        });
    }
    /**
     * 获取所有表情包列表
     * @param types 要获取的表情包类型，默认获取所有类型
     */
    async getStickerPacks(types) {
        try {
            const packs = [];
            const fetchTypes = types || [
                StickerPackType.FAVORITE_EMOJI,
                StickerPackType.MARKET_PACK,
                StickerPackType.SYSTEM_PACK
            ];
            if (fetchTypes.includes(StickerPackType.FAVORITE_EMOJI)) {
                await this.getFavoriteEmojis(packs);
            }
            if (fetchTypes.includes(StickerPackType.MARKET_PACK)) {
                await this.getMarketEmoticonPacks(packs);
            }
            if (fetchTypes.includes(StickerPackType.SYSTEM_PACK)) {
                await this.getSystemEmoticonPacks(packs);
            }
            return packs;
        }
        catch (error) {
            console.error('[StickerPackExporter] 获取表情包列表失败:', error);
            throw error;
        }
    }
    /**
     * 获取收藏的单个表情
     */
    async getFavoriteEmojis(packs) {
        try {
            console.log('[StickerPackExporter]   -> 调用 fetchFavEmojiList API...');
            const startTime = Date.now();
            const favEmojis = await this.core.apis.MsgApi.fetchFavEmojiList(1000);
            const elapsed = Date.now() - startTime;
            console.log(`[StickerPackExporter]   <- fetchFavEmojiList 返回 (耗时: ${elapsed}ms)`);
            console.log('[StickerPackExporter]      获取到收藏表情数:', favEmojis.emojiInfoList?.length || 0);
            if (favEmojis.emojiInfoList && favEmojis.emojiInfoList.length > 0) {
                const stickers = [];
                for (const emoji of favEmojis.emojiInfoList) {
                    stickers.push({
                        stickerId: emoji.eId || emoji.emoId.toString(),
                        name: emoji.desc || emoji.modifyWord || `表情_${emoji.emoId}`,
                        path: emoji.emoPath || emoji.emoOriginalPath,
                        downloaded: emoji.isExist,
                        md5: emoji.md5,
                        fileSize: 0
                    });
                }
                packs.push({
                    packId: 'favorite_emojis',
                    packName: '收藏的表情',
                    packType: StickerPackType.FAVORITE_EMOJI,
                    description: '用户收藏的单个表情',
                    stickerCount: stickers.length,
                    stickers
                });
            }
        }
        catch (error) {
            console.error('[StickerPackExporter] 获取收藏表情失败:', error);
        }
    }
    async getMarketEmoticonPacks(packs) {
        try {
            const msgService = this.core.context.session.getMsgService();
            const result = await msgService.fetchMarketEmoticonList('', 1);
            if (!result || !result.marketEmoticonInfo || !result.marketEmoticonInfo.roamEmojiTab) {
                return;
            }
            const tabList = result.marketEmoticonInfo.roamEmojiTab.ordinaryTabinfoList || [];
            for (const tab of tabList) {
                const epId = tab.epId.toString();
                const packName = tab.tabName || `表情包 #${epId}`;
                try {
                    const jsonResult = await msgService.fetchMarketEmotionJsonFile(epId);
                    if (jsonResult && jsonResult.result === 0 && jsonResult.errMsg) {
                        const jsonFilePath = jsonResult.errMsg;
                        if (fs.existsSync(jsonFilePath)) {
                            const jsonContent = fs.readFileSync(jsonFilePath, 'utf-8');
                            const packData = JSON.parse(jsonContent);
                            const stickers = this.parseMarketPackJsonData(packData, epId, packName);
                            if (stickers.length > 0) {
                                // 从JSON数据中获取描述信息
                                const description = packData.mark || packData.description || `包含 ${stickers.length} 个表情`;
                                packs.push({
                                    packId: `market_${epId}`,
                                    packName,
                                    packType: StickerPackType.MARKET_PACK,
                                    description,
                                    stickerCount: stickers.length,
                                    stickers,
                                    rawData: { epId, tabInfo: tab, jsonData: packData }
                                });
                                continue;
                            }
                        }
                    }
                }
                catch (error) {
                    // 静默处理，尝试其他方法
                }
                try {
                    const imagesResult = await msgService.fetchMarketEmoticonFaceImages(epId);
                    if (imagesResult && imagesResult.result === 0) {
                        const stickers = this.parseMarketPackInfo(imagesResult, epId, packName);
                        if (stickers.length > 0) {
                            const description = imagesResult.mark || imagesResult.description || `包含 ${stickers.length} 个表情`;
                            packs.push({
                                packId: `market_${epId}`,
                                packName,
                                packType: StickerPackType.MARKET_PACK,
                                description,
                                stickerCount: stickers.length,
                                stickers,
                                rawData: { epId, tabInfo: tab }
                            });
                            continue;
                        }
                    }
                }
                catch (error) {
                    // 静默处理
                }
                try {
                    const aioResult = await msgService.fetchMarketEmoticonAioImage(epId);
                    if (aioResult && aioResult.result === 0) {
                        const stickers = this.parseMarketPackInfo(aioResult, epId, packName);
                        if (stickers.length > 0) {
                            const description = aioResult.mark || aioResult.description || `包含 ${stickers.length} 个表情`;
                            packs.push({
                                packId: `market_${epId}`,
                                packName,
                                packType: StickerPackType.MARKET_PACK,
                                description,
                                stickerCount: stickers.length,
                                stickers,
                                rawData: { epId, tabInfo: tab }
                            });
                            continue;
                        }
                    }
                }
                catch (error) {
                    // 静默处理
                }
                // 所有方法都失败，添加占位
                packs.push({
                    packId: `market_${epId}`,
                    packName,
                    packType: StickerPackType.MARKET_PACK,
                    description: `待加载详情`,
                    stickerCount: 0,
                    stickers: [],
                    rawData: { epId, tabInfo: tab }
                });
            }
        }
        catch (error) {
            console.error('[StickerPackExporter] 获取市场表情包失败:', error);
        }
    }
    parseMarketPackJsonData(packData, _epId, packName) {
        const stickers = [];
        try {
            const emojiList = packData.imgs || [];
            for (const emoji of emojiList) {
                const md5 = emoji.id;
                const name = emoji.name || `表情_${md5}`;
                const md5Prefix = md5.substring(0, 2);
                const url = `https://gxh.vip.qq.com/club/item/parcel/item/${md5Prefix}/${md5}/raw300.gif`;
                stickers.push({
                    stickerId: md5,
                    name: name,
                    path: url,
                    downloaded: true,
                    md5: md5,
                    fileSize: 0
                });
            }
        }
        catch (error) {
            console.error(`[StickerPackExporter] 解析表情包 ${packName} 失败:`, error);
        }
        return stickers;
    }
    parseMarketPackInfo(packInfo, _epId, packName) {
        const stickers = [];
        try {
            // 尝试从不同的字段提取表情列表
            const emojiList = packInfo.emojiInfoList || packInfo.marketEmoticonInfo?.emojiList || [];
            for (const emoji of emojiList) {
                stickers.push({
                    stickerId: emoji.eId || emoji.emoId?.toString() || emoji.id?.toString(),
                    name: emoji.name || emoji.desc || emoji.emojiName || `表情_${emoji.eId}`,
                    path: emoji.path || emoji.emoPath || '',
                    downloaded: emoji.isExist || false,
                    md5: emoji.md5 || '',
                    fileSize: emoji.size || 0
                });
            }
        }
        catch (error) {
            console.error(`[StickerPackExporter] 解析表情包 ${packName} 失败:`, error);
        }
        return stickers;
    }
    /**
     * 获取系统表情包
     */
    async getSystemEmoticonPacks(packs) {
        try {
            console.log('[StickerPackExporter]   -> 读取系统表情包配置文件...');
            // 从face_config.json中读取系统表情包配置
            const faceConfigPath = path.join(__dirname, '../../../core/external/face_config.json');
            if (fs.existsSync(faceConfigPath)) {
                const faceConfig = JSON.parse(fs.readFileSync(faceConfigPath, 'utf-8'));
                if (faceConfig.sysface && Array.isArray(faceConfig.sysface)) {
                    // 按AniStickerPackName分组
                    const packMap = new Map();
                    for (const face of faceConfig.sysface) {
                        const packName = face.AniStickerPackName || '系统表情';
                        if (!packMap.has(packName)) {
                            packMap.set(packName, []);
                        }
                        packMap.get(packName).push(face);
                    }
                    // 转换为表情包列表
                    for (const [packName, faces] of packMap.entries()) {
                        const stickers = faces.map(face => ({
                            stickerId: face.QSid || face.AniStickerId,
                            name: face.QDes || `表情_${face.QSid}`,
                            path: '', // 系统表情需要通过API下载
                            downloaded: false,
                            fileSize: 0
                        }));
                        packs.push({
                            packId: `system_${packName.replace(/\s+/g, '_')}`,
                            packName: `系统表情 - ${packName}`,
                            packType: StickerPackType.SYSTEM_PACK,
                            description: `QQ系统内置表情包`,
                            stickerCount: stickers.length,
                            stickers,
                            rawData: { source: 'face_config' }
                        });
                    }
                    console.log(`[StickerPackExporter] 找到 ${packMap.size} 个系统表情包`);
                }
            }
        }
        catch (error) {
            console.warn('[StickerPackExporter] 获取系统表情包失败:', error);
        }
    }
    /**
     * 导出指定的表情包
     */
    async exportStickerPack(packId) {
        let pack;
        try {
            console.log(`[StickerPackExporter] 开始导出表情包: ${packId}`);
            // 获取表情包列表
            const packs = await this.getStickerPacks();
            pack = packs.find(p => p.packId === packId);
            if (!pack) {
                return {
                    success: false,
                    packCount: 0,
                    stickerCount: 0,
                    exportPath: '',
                    error: '表情包不存在'
                };
            }
            // 创建导出目录
            const timestamp = Date.now();
            const exportDir = path.join(this.exportBasePath, `${pack.packName}_${timestamp}`);
            fs.mkdirSync(exportDir, { recursive: true });
            // 导出表情包信息
            const packInfoPath = path.join(exportDir, 'pack_info.json');
            fs.writeFileSync(packInfoPath, JSON.stringify(pack, null, 2), 'utf-8');
            // 并发下载/复制表情文件
            let successCount = 0;
            const stickersDir = path.join(exportDir, 'stickers');
            fs.mkdirSync(stickersDir, { recursive: true });
            const concurrencyLimit = 10;
            for (let i = 0; i < pack.stickers.length; i += concurrencyLimit) {
                const batch = pack.stickers.slice(i, i + concurrencyLimit);
                const batchTasks = batch.map(async (sticker) => {
                    try {
                        if (!sticker.path)
                            return false;
                        const ext = path.extname(sticker.path) || '.gif';
                        const destPath = path.join(stickersDir, `${sticker.stickerId}_${sticker.name.replace(/[\/\\:*?"<>|]/g, '_')}${ext}`);
                        if (sticker.path.startsWith('http://') || sticker.path.startsWith('https://')) {
                            return await this.downloadFile(sticker.path, destPath);
                        }
                        else if (fs.existsSync(sticker.path)) {
                            fs.copyFileSync(sticker.path, destPath);
                            return true;
                        }
                        return false;
                    }
                    catch (error) {
                        return false;
                    }
                });
                const results = await Promise.all(batchTasks);
                successCount += results.filter(r => r).length;
            }
            // 添加导出记录
            const exportId = `export_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
            this.addRecord({
                id: exportId,
                type: 'single',
                packId: pack.packId,
                packName: pack.packName,
                packCount: 1,
                stickerCount: successCount,
                exportPath: exportDir,
                exportTime: new Date(),
                success: true
            });
            return {
                success: true,
                packCount: 1,
                stickerCount: successCount,
                exportPath: exportDir,
                exportId
            };
        }
        catch (error) {
            console.error(`[StickerPackExporter] 导出表情包失败:`, error);
            // 记录失败
            const exportId = `export_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
            this.addRecord({
                id: exportId,
                type: 'single',
                packId: pack?.packId,
                packName: pack?.packName,
                packCount: 0,
                stickerCount: 0,
                exportPath: '',
                exportTime: new Date(),
                success: false,
                error: error instanceof Error ? error.message : String(error)
            });
            return {
                success: false,
                packCount: 0,
                stickerCount: 0,
                exportPath: '',
                exportId,
                error: error instanceof Error ? error.message : String(error)
            };
        }
    }
    /**
     * 导出所有表情包
     */
    async exportAllStickerPacks() {
        try {
            const packs = await this.getStickerPacks();
            if (packs.length === 0) {
                return {
                    success: false,
                    packCount: 0,
                    stickerCount: 0,
                    exportPath: '',
                    error: '没有找到表情包'
                };
            }
            // 创建总导出目录
            const timestamp = Date.now();
            const exportDir = path.join(this.exportBasePath, `all_packs_${timestamp}`);
            fs.mkdirSync(exportDir, { recursive: true });
            let totalStickerCount = 0;
            let totalSuccessCount = 0;
            for (const pack of packs) {
                try {
                    const packDir = path.join(exportDir, pack.packName.replace(/[\/\\:*?"<>|]/g, '_'));
                    fs.mkdirSync(packDir, { recursive: true });
                    const packInfoPath = path.join(packDir, 'pack_info.json');
                    fs.writeFileSync(packInfoPath, JSON.stringify(pack, null, 2), 'utf-8');
                    const stickersDir = path.join(packDir, 'stickers');
                    fs.mkdirSync(stickersDir, { recursive: true });
                    const concurrencyLimit = 10;
                    for (let i = 0; i < pack.stickers.length; i += concurrencyLimit) {
                        const batch = pack.stickers.slice(i, i + concurrencyLimit);
                        const batchTasks = batch.map(async (sticker) => {
                            try {
                                if (!sticker.path)
                                    return false;
                                const ext = path.extname(sticker.path) || '.gif';
                                const destPath = path.join(stickersDir, `${sticker.stickerId}_${sticker.name.replace(/[\/\\:*?"<>|]/g, '_')}${ext}`);
                                if (sticker.path.startsWith('http://') || sticker.path.startsWith('https://')) {
                                    return await this.downloadFile(sticker.path, destPath);
                                }
                                else if (fs.existsSync(sticker.path)) {
                                    fs.copyFileSync(sticker.path, destPath);
                                    return true;
                                }
                                return false;
                            }
                            catch (error) {
                                return false;
                            }
                        });
                        const results = await Promise.all(batchTasks);
                        totalSuccessCount += results.filter(r => r).length;
                    }
                    totalStickerCount += pack.stickers.length;
                }
                catch (error) {
                    console.error(`[StickerPackExporter] 导出表情包失败: ${pack.packName}`, error);
                }
            }
            // 生成汇总信息
            const summaryPath = path.join(exportDir, 'summary.json');
            const summary = {
                exportTime: new Date().toISOString(),
                packCount: packs.length,
                totalStickers: totalStickerCount,
                successfulStickers: totalSuccessCount,
                packs: packs.map(p => ({
                    packId: p.packId,
                    packName: p.packName,
                    stickerCount: p.stickerCount
                }))
            };
            fs.writeFileSync(summaryPath, JSON.stringify(summary, null, 2), 'utf-8');
            // 生成收藏表情包列表
            const favoriteEmojis = packs.filter(p => p.packType === StickerPackType.FAVORITE_EMOJI);
            if (favoriteEmojis.length > 0) {
                const favoriteData = {
                    exportTime: new Date().toISOString(),
                    totalStickers: favoriteEmojis.reduce((sum, p) => sum + p.stickerCount, 0),
                    stickers: favoriteEmojis.flatMap(pack => pack.stickers.map(s => ({
                        id: s.stickerId,
                        name: s.name,
                        url: s.path,
                        md5: s.md5,
                        packId: pack.packId,
                        packName: pack.packName
                    })))
                };
                fs.writeFileSync(path.join(exportDir, 'favorite_emojis.json'), JSON.stringify(favoriteData, null, 2), 'utf-8');
            }
            // 生成所有表情包列表（不包括收藏）
            const allOtherPacks = packs.filter(p => p.packType !== StickerPackType.FAVORITE_EMOJI);
            if (allOtherPacks.length > 0) {
                const allPacksData = {
                    exportTime: new Date().toISOString(),
                    totalPacks: allOtherPacks.length,
                    totalStickers: allOtherPacks.reduce((sum, p) => sum + p.stickerCount, 0),
                    packs: allOtherPacks.map(pack => ({
                        packId: pack.packId,
                        packName: pack.packName,
                        packType: pack.packType,
                        description: pack.description,
                        stickerCount: pack.stickerCount,
                        stickers: pack.stickers.map(s => ({
                            id: s.stickerId,
                            name: s.name,
                            url: s.path,
                            md5: s.md5
                        }))
                    }))
                };
                fs.writeFileSync(path.join(exportDir, 'all_sticker_packs.json'), JSON.stringify(allPacksData, null, 2), 'utf-8');
            }
            // 添加导出记录
            const exportId = `export_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
            this.addRecord({
                id: exportId,
                type: 'all',
                packName: '所有表情包',
                packCount: packs.length,
                stickerCount: totalSuccessCount,
                exportPath: exportDir,
                exportTime: new Date(),
                success: true
            });
            return {
                success: true,
                packCount: packs.length,
                stickerCount: totalSuccessCount,
                exportPath: exportDir,
                exportId
            };
        }
        catch (error) {
            console.error('[StickerPackExporter] 导出所有表情包失败:', error);
            // 记录失败
            const exportId = `export_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
            this.addRecord({
                id: exportId,
                type: 'all',
                packName: '所有表情包',
                packCount: 0,
                stickerCount: 0,
                exportPath: '',
                exportTime: new Date(),
                success: false,
                error: error instanceof Error ? error.message : String(error)
            });
            return {
                success: false,
                packCount: 0,
                stickerCount: 0,
                exportPath: '',
                exportId,
                error: error instanceof Error ? error.message : String(error)
            };
        }
    }
}
//# sourceMappingURL=StickerPackExporter.js.map