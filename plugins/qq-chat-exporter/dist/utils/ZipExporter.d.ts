/**
 * ZIP导出器
 * 用于将HTML文件和资源文件打包成ZIP格式
 */
/**
 * ZIP导出器类
 */
export declare class ZipExporter {
    /**
     * 创建ZIP文件
     * @param htmlPath HTML文件路径
     * @param outputZipPath 输出ZIP文件路径
     * @param resourcePaths 资源文件相对路径列表（相对于HTML所在目录）
     * @returns ZIP文件路径
     */
    static createZip(htmlPath: string, outputZipPath: string, resourcePaths?: string[]): Promise<string>;
    /**
     * 删除原始HTML文件和resources目录
     * @param htmlPath HTML文件路径
     * @returns 是否删除成功
     */
    static deleteOriginalFiles(htmlPath: string): Promise<boolean>;
}
//# sourceMappingURL=ZipExporter.d.ts.map