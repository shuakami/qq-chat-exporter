import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { systemPlatform } from '@/common/system';
import { getDefaultQQVersionConfigInfo, getQQPackageInfoPath, getQQVersionConfigPath, parseAppidFromMajor } from './helper';
import AppidTable from '@/core/external/appid.json';
import { LogWrapper } from '@/common/log';
import { getMajorPath } from '@/core';
import { QQAppidTableType, QQPackageInfoType, QQVersionConfigType } from './types';

export class QQBasicInfoWrapper {
    QQMainPath: string | undefined;
    QQPackageInfoPath: string | undefined;
    QQVersionConfigPath: string | undefined;
    isQuickUpdate: boolean | undefined;
    QQVersionConfig: QQVersionConfigType | undefined;
    QQPackageInfo: QQPackageInfoType | undefined;
    QQVersionAppid: string | undefined;
    QQVersionQua: string | undefined;
    context: { logger: LogWrapper };

    constructor(context: { logger: LogWrapper }) {
        //基础目录获取
        this.context = context;
        this.QQMainPath = this.getQQMainPath();
        this.QQVersionConfigPath = getQQVersionConfigPath(this.QQMainPath);


        //基础信息获取 无快更则启用默认模板填充
        this.isQuickUpdate = !!this.QQVersionConfigPath;
        this.QQVersionConfig = this.isQuickUpdate
            ? JSON.parse(fs.readFileSync(this.QQVersionConfigPath!).toString())
            : getDefaultQQVersionConfigInfo();

        this.QQPackageInfoPath = getQQPackageInfoPath(this.QQMainPath, this.QQVersionConfig?.curVersion);
        this.QQPackageInfo = JSON.parse(fs.readFileSync(this.QQPackageInfoPath).toString());
        const { appid: IQQVersionAppid, qua: IQQVersionQua } = this.getAppidV2();
        this.QQVersionAppid = IQQVersionAppid;
        this.QQVersionQua = IQQVersionQua;
    }

    //基础函数
    getQQBuildStr() {
        return this.isQuickUpdate ? this.QQVersionConfig?.buildId : this.QQPackageInfo?.buildVersion;
    }

    getFullQQVersion() {
        const version = this.isQuickUpdate ? this.QQVersionConfig?.curVersion : this.QQPackageInfo?.version;
        if (!version) throw new Error('QQ版本获取失败');
        return version;
    }

    requireMinNTQQBuild(buildStr: string) {
        const currentBuild = +(this.getQQBuildStr() ?? '0');
        if (currentBuild == 0) throw new Error('QQBuildStr获取失败');
        return currentBuild >= parseInt(buildStr);
    }

    //此方法不要直接使用
    getQUAFallback() {
        const platformMapping: Partial<Record<NodeJS.Platform, string>> = {
            win32: `V1_WIN_${this.getFullQQVersion()}_${this.getQQBuildStr()}_GW_B`,
            darwin: `V1_MAC_${this.getFullQQVersion()}_${this.getQQBuildStr()}_GW_B`,
            linux: `V1_LNX_${this.getFullQQVersion()}_${this.getQQBuildStr()}_GW_B`,
        };
        return platformMapping[systemPlatform] ?? (platformMapping.win32)!;
    }

    getAppIdFallback() {
        const platformMapping: Partial<Record<NodeJS.Platform, string>> = {
            win32: '537246092',
            darwin: '537246140',
            linux: '537246140',
        };
        return platformMapping[systemPlatform] ?? '537246092';
    }

    getAppidV2(): { appid: string; qua: string } {
        // 通过已有表 性能好
        const appidTbale = AppidTable as unknown as QQAppidTableType;
        const fullVersion = this.getFullQQVersion();
        if (fullVersion) {
            const data = appidTbale[fullVersion];
            if (data) {
                return data;
            }
        }
        // 通过Major拉取 性能差
        try {
            const majorAppid = this.getAppidV2ByMajor(fullVersion);
            if (majorAppid) {
                this.context.logger.log('[QQ版本兼容性检测] 当前版本Appid未内置 通过Major获取 为了更好的性能请尝试更新NapCat');
                return { appid: majorAppid, qua: this.getQUAFallback() };
            }
        } catch {
            this.context.logger.log('[QQ版本兼容性检测] 通过Major 获取Appid异常 请检测NapCat/QQNT是否正常');
        }
        // 最终兜底为老版本
        this.context.logger.log('[QQ版本兼容性检测] 获取Appid异常 请检测NapCat/QQNT是否正常');
        this.context.logger.log(`[QQ版本兼容性检测] ${fullVersion} 版本兼容性不佳，可能会导致一些功能无法正常使用`,);
        return { appid: this.getAppIdFallback(), qua: this.getQUAFallback() };
    }
    getAppidV2ByMajor(QQVersion: string) {
        const majorPath = getMajorPath(QQVersion);
        const appid = parseAppidFromMajor(majorPath);
        return appid;
    }

    /**
     * 获取QQ主程序路径
     * Linux环境下智能检测QQ安装位置
     */
    private getQQMainPath(): string {
        // 1. 优先使用环境变量指定的QQ路径
        const envQQPath = process.env['NAPCAT_QQ_PATH'];
        if (envQQPath) {
            if (fs.existsSync(envQQPath)) {
                this.context.logger.log(`[QQ路径] 使用环境变量指定的路径: ${envQQPath}`);
                return envQQPath;
            } else {
                this.context.logger.logError(`[QQ路径] 环境变量指定的路径不存在: ${envQQPath}`);
            }
        }

        // 2. Linux平台：优先使用当前工作目录（如果包含QQ相关文件）
        if (os.platform() === 'linux') {
            const cwd = process.cwd();
            const cwdPackageJson = path.join(cwd, 'resources/app/package.json');
            
            // 检查当前目录是否是QQ目录
            if (fs.existsSync(cwdPackageJson)) {
                this.context.logger.log(`[QQ路径] 使用当前工作目录: ${cwd}`);
                return path.join(cwd, 'qq'); // 返回QQ可执行文件路径
            }

            // 尝试常见的Linux QQ安装路径
            const commonLinuxPaths = [
                '/opt/QQ/qq',  // 官方包安装路径
                '/usr/local/bin/qq',  // 手动安装路径
                '/snap/qq/current/qq',  // Snap包路径
                '/var/lib/flatpak/app/com.qq.QQ/current/active/files/qq',  // Flatpak路径
                path.join(os.homedir(), '.local/share/applications/qq'),  // 用户安装路径
            ];

            for (const qqPath of commonLinuxPaths) {
                if (fs.existsSync(qqPath)) {
                    this.context.logger.log(`[QQ路径] 自动检测到QQ: ${qqPath}`);
                    return qqPath;
                }
            }

            // 在PATH中查找
            const pathEnv = process.env['PATH'] || '';
            const pathDirs = pathEnv.split(':');
            for (const dir of pathDirs) {
                const qqPath = path.join(dir, 'qq');
                if (fs.existsSync(qqPath)) {
                    this.context.logger.log(`[QQ路径] 在PATH中找到QQ: ${qqPath}`);
                    return qqPath;
                }
            }

            // Linux下找不到QQ时的警告
            this.context.logger.logError(
                `[QQ路径] Linux上未找到QQ安装路径。请确保NapCat运行在QQ目录中，或设置环境变量 NAPCAT_QQ_PATH`
            );
        }

        // 3. 回退到原来的行为（Windows/macOS或Linux检测失败时）
        this.context.logger.log(`[QQ路径] 使用进程路径: ${process.execPath}`);
        return process.execPath;
    }

}
