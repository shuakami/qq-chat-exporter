import path from 'path';
import { promises as fsp } from 'fs';
import os from 'os';

export class PathManager {
    private static instance: PathManager;
    private customOutputDir: string | null = null;
    private customScheduledExportDir: string | null = null;

    private constructor() {}

    static getInstance(): PathManager {
        if (!PathManager.instance) {
            PathManager.instance = new PathManager();
        }
        return PathManager.instance;
    }

    private getUserHome(): string {
        return os.homedir();
    }

    private validatePath(inputPath: string): string {
        const resolved = path.resolve(inputPath);

        // 只禁止系统关键目录，允许任意其他位置
        const dangerousPatterns = [
            /[\/\\]Windows[\/\\]System32/i,
            /[\/\\]Windows[\/\\]SysWOW64/i,
            /^[\/\\]etc[\/\\]/,
            /^[\/\\]bin[\/\\]/,
            /^[\/\\]usr[\/\\]bin/,
            /^[\/\\]sbin[\/\\]/,
        ];

        for (const pattern of dangerousPatterns) {
            if (pattern.test(resolved)) {
                throw new Error('禁止访问系统关键目录');
            }
        }

        return resolved;
    }

    setCustomOutputDir(dir: string | null): void {
        if (dir) {
            this.customOutputDir = this.validatePath(dir);
        } else {
            this.customOutputDir = null;
        }
    }

    setCustomScheduledExportDir(dir: string | null): void {
        if (dir) {
            this.customScheduledExportDir = this.validatePath(dir);
        } else {
            this.customScheduledExportDir = null;
        }
    }

    getDefaultBaseDir(): string {
        return path.join(this.getUserHome(), '.qq-chat-exporter');
    }

    getExportsDir(): string {
        if (this.customOutputDir) {
            return this.customOutputDir;
        }
        return path.join(this.getDefaultBaseDir(), 'exports');
    }

    getScheduledExportsDir(): string {
        if (this.customScheduledExportDir) {
            return this.customScheduledExportDir;
        }
        return path.join(this.getDefaultBaseDir(), 'scheduled-exports');
    }

    getResourcesDir(): string {
        return path.join(this.getDefaultBaseDir(), 'resources');
    }

    getDatabaseDir(): string {
        return path.join(this.getDefaultBaseDir(), 'database');
    }

    getAvatarsDir(): string {
        return path.join(this.getExportsDir(), 'avatars');
    }

    async ensureDirectoryExists(dir: string): Promise<void> {
        try {
            await fsp.access(dir);
        } catch {
            await fsp.mkdir(dir, { recursive: true });
        }
    }

    async ensureAllDirectoriesExist(): Promise<void> {
        await Promise.all([
            this.ensureDirectoryExists(this.getExportsDir()),
            this.ensureDirectoryExists(this.getScheduledExportsDir()),
            this.ensureDirectoryExists(this.getResourcesDir()),
            this.ensureDirectoryExists(this.getDatabaseDir())
        ]);
    }
}
