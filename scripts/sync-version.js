#!/usr/bin/env node
/**
 * 版本同步脚本
 * 用于在 CI/CD 中从 Git tag 同步版本到 package.json
 * 
 * 用法: node scripts/sync-version.js <version>
 * 示例: node scripts/sync-version.js 5.1.0
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');

const PACKAGE_FILES = [
    'plugins/qq-chat-exporter/package.json',
    'qce-v4-tool/package.json'
];

function updatePackageVersion(filePath, version) {
    const fullPath = path.join(rootDir, filePath);
    
    if (!fs.existsSync(fullPath)) {
        console.warn(`[SKIP] ${filePath} not found`);
        return false;
    }
    
    try {
        const content = JSON.parse(fs.readFileSync(fullPath, 'utf-8'));
        const oldVersion = content.version;
        content.version = version;
        fs.writeFileSync(fullPath, JSON.stringify(content, null, 2) + '\n');
        console.log(`[OK] ${filePath}: ${oldVersion} → ${version}`);
        return true;
    } catch (error) {
        console.error(`[ERROR] ${filePath}: ${error.message}`);
        return false;
    }
}

function main() {
    const version = process.argv[2];
    
    if (!version) {
        console.error('Usage: node scripts/sync-version.js <version>');
        console.error('Example: node scripts/sync-version.js 5.1.0');
        process.exit(1);
    }
    
    // 移除 v 前缀
    const cleanVersion = version.replace(/^v/, '');
    
    // 验证版本格式
    if (!/^\d+\.\d+\.\d+(-[\w.]+)?$/.test(cleanVersion)) {
        console.error(`Invalid version format: ${cleanVersion}`);
        console.error('Expected format: X.Y.Z or X.Y.Z-suffix');
        process.exit(1);
    }
    
    console.log(`Syncing version to: ${cleanVersion}\n`);
    
    let success = 0;
    for (const file of PACKAGE_FILES) {
        if (updatePackageVersion(file, cleanVersion)) {
            success++;
        }
    }
    
    console.log(`\nDone: ${success}/${PACKAGE_FILES.length} files updated`);
}

main();
