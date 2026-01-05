import path from 'path';
import fs from 'fs';
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

    setCustomOutputDir(dir: string | null): void {
        this.customOutputDir = dir;
    }

    setCustomScheduledExportDir(dir: string | null): void {
        this.customScheduledExportDir = dir;
    }

    getDefaultBaseDir(): string {
        return path.join(process.env['USERPROFILE'] || process.env['HOME'] || process.cwd(), '.qq-chat-exporter');
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

    ensureDirectoryExists(dir: string): void {
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
    }

    ensureAllDirectoriesExist(): void {
        this.ensureDirectoryExists(this.getExportsDir());
        this.ensureDirectoryExists(this.getScheduledExportsDir());
        this.ensureDirectoryExists(this.getResourcesDir());
        this.ensureDirectoryExists(this.getDatabaseDir());
    }
}
