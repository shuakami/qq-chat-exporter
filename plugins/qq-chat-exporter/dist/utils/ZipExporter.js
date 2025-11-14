/**
 * ZIP导出器
 * 用于将HTML文件和资源文件打包成ZIP格式
 */
import fs from 'fs';
import path from 'path';
import archiver from 'archiver';
/**
 * ZIP导出器类
 */
export class ZipExporter {
    /**
     * 创建ZIP文件
     * @param htmlPath HTML文件路径
     * @param outputZipPath 输出ZIP文件路径
     * @param resourcePaths 资源文件相对路径列表（相对于HTML所在目录）
     * @returns ZIP文件路径
     */
    static async createZip(htmlPath, outputZipPath, resourcePaths = []) {
        return new Promise((resolve, reject) => {
            try {
                // 验证HTML文件存在
                if (!fs.existsSync(htmlPath)) {
                    throw new Error(`HTML文件不存在: ${htmlPath}`);
                }
                // 获取HTML文件所在目录和文件名
                const htmlDir = path.dirname(htmlPath);
                const htmlFileName = path.basename(htmlPath);
                // 创建写入流
                const output = fs.createWriteStream(outputZipPath);
                const archive = archiver('zip', {
                    zlib: { level: 9 } // 最高压缩级别
                });
                // 监听完成事件
                output.on('close', () => {
                    console.log(`[ZipExporter] ZIP文件创建完成: ${outputZipPath}`);
                    console.log(`[ZipExporter] 总大小: ${archive.pointer()} bytes`);
                    resolve(outputZipPath);
                });
                // 监听错误事件
                archive.on('error', (err) => {
                    console.error('[ZipExporter] 创建ZIP文件时出错:', err);
                    reject(err);
                });
                output.on('error', (err) => {
                    console.error('[ZipExporter] 写入ZIP文件时出错:', err);
                    reject(err);
                });
                // 监听警告事件
                archive.on('warning', (err) => {
                    if (err.code === 'ENOENT') {
                        console.warn('[ZipExporter] 警告:', err);
                    }
                    else {
                        reject(err);
                    }
                });
                // 将归档流输出到文件
                archive.pipe(output);
                // 添加HTML文件到ZIP根目录
                archive.file(htmlPath, { name: htmlFileName });
                console.log(`[ZipExporter] 添加HTML文件: ${htmlFileName}`);
                // 添加指定的资源文件
                if (resourcePaths.length > 0) {
                    console.log(`[ZipExporter] 准备添加 ${resourcePaths.length} 个资源文件...`);
                    let addedCount = 0;
                    for (const resourcePath of resourcePaths) {
                        const absolutePath = path.join(htmlDir, resourcePath);
                        if (fs.existsSync(absolutePath)) {
                            // 使用相对路径作为ZIP内的路径，保持目录结构
                            archive.file(absolutePath, { name: resourcePath });
                            addedCount++;
                        }
                        else {
                            console.warn(`[ZipExporter] 资源文件不存在，跳过: ${resourcePath}`);
                        }
                    }
                    console.log(`[ZipExporter] 已添加 ${addedCount} 个资源文件`);
                }
                else {
                    console.log(`[ZipExporter] 无资源文件需要打包，仅打包HTML`);
                }
                // 完成归档
                archive.finalize();
            }
            catch (error) {
                console.error('[ZipExporter] ZIP创建失败:', error);
                reject(error);
            }
        });
    }
    /**
     * 删除原始HTML文件和resources目录
     * @param htmlPath HTML文件路径
     * @returns 是否删除成功
     */
    static async deleteOriginalFiles(htmlPath) {
        try {
            const htmlDir = path.dirname(htmlPath);
            const resourcesDir = path.join(htmlDir, 'resources');
            // 删除HTML文件
            if (fs.existsSync(htmlPath)) {
                fs.unlinkSync(htmlPath);
                console.log(`[ZipExporter] 已删除HTML文件: ${htmlPath}`);
            }
            // 删除resources目录
            if (fs.existsSync(resourcesDir)) {
                fs.rmSync(resourcesDir, { recursive: true, force: true });
                console.log(`[ZipExporter] 已删除资源目录: ${resourcesDir}`);
            }
            return true;
        }
        catch (error) {
            console.error('[ZipExporter] 删除原始文件失败:', error);
            return false;
        }
    }
}
//# sourceMappingURL=ZipExporter.js.map