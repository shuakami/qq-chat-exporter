#!/usr/bin/env node
/**
 * Ensures the esbuild binary for the current platform is available under
 * `node_modules/@esbuild/<platform>`. The committed `node_modules` only
 * contains the Windows binary (matching the production build target) so
 * Linux / macOS test runs need to drop in the right package.
 *
 * Idempotent — fast no-op once the binary is present.
 */

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PLUGIN_ROOT = path.resolve(__dirname, '../..');

function detectPlatform() {
    const platform = process.platform;
    const arch = process.arch;
    const map = {
        'linux-x64': 'linux-x64',
        'linux-arm64': 'linux-arm64',
        'darwin-x64': 'darwin-x64',
        'darwin-arm64': 'darwin-arm64',
        'win32-x64': 'win32-x64',
        'win32-arm64': 'win32-arm64'
    };
    const key = `${platform}-${arch}`;
    return map[key];
}

function getEsbuildVersion() {
    const pkg = JSON.parse(
        fs.readFileSync(path.join(PLUGIN_ROOT, 'node_modules/esbuild/package.json'), 'utf8')
    );
    return pkg.version;
}

function targetExists(slug) {
    const candidates = [
        path.join(PLUGIN_ROOT, 'node_modules/@esbuild', slug, 'bin/esbuild'),
        path.join(PLUGIN_ROOT, 'node_modules/@esbuild', slug, 'esbuild.exe')
    ];
    return candidates.some((p) => fs.existsSync(p));
}

function installPlatformBinary(slug, version) {
    const dest = path.join(PLUGIN_ROOT, 'node_modules/@esbuild', slug);
    fs.mkdirSync(dest, { recursive: true });
    const tarballName = `esbuild-${slug}-${version}.tgz`;
    const tmpDir = fs.mkdtempSync(path.join(PLUGIN_ROOT, '.esbuild-platform-'));
    try {
        execFileSync('npm', ['pack', `@esbuild/${slug}@${version}`, '--silent'], {
            cwd: tmpDir,
            stdio: ['ignore', 'pipe', 'pipe']
        });
        execFileSync('tar', ['-xzf', tarballName], { cwd: tmpDir, stdio: 'inherit' });
        const extracted = path.join(tmpDir, 'package');
        for (const name of fs.readdirSync(extracted)) {
            const src = path.join(extracted, name);
            const dst = path.join(dest, name);
            if (fs.lstatSync(src).isDirectory()) {
                fs.cpSync(src, dst, { recursive: true });
            } else {
                fs.copyFileSync(src, dst);
            }
        }
        const bin = path.join(dest, 'bin/esbuild');
        if (fs.existsSync(bin)) fs.chmodSync(bin, 0o755);
    } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    }
}

function main() {
    const slug = detectPlatform();
    if (!slug) {
        console.warn(`[esbuild] unsupported platform ${process.platform}-${process.arch}; skipping`);
        return;
    }
    if (targetExists(slug)) {
        return; // nothing to do
    }
    const version = getEsbuildVersion();
    console.log(`[esbuild] installing @esbuild/${slug}@${version} into node_modules`);
    installPlatformBinary(slug, version);
    if (!targetExists(slug)) {
        throw new Error(`[esbuild] failed to install @esbuild/${slug}@${version}`);
    }
    console.log(`[esbuild] installed @esbuild/${slug}@${version}`);
}

main();
