#!/usr/bin/env node
/**
 * Ensures esbuild platform binaries exist under <pluginDir>/node_modules/@esbuild.
 *
 * The plugin loads its TypeScript runtime through `tsx.register()`, which pulls
 * in esbuild. esbuild ships its native binary as a per-platform optional
 * dependency (`@esbuild/<platform>-<arch>`), and `npm install` only fetches the
 * binary matching the machine that ran the install. Because the release packages
 * are produced on a Linux runner, the resulting `@esbuild` directory would only
 * contain `linux-x64`, leaving Windows / macOS users with a runtime that throws
 * "You installed esbuild for another platform than the one you're currently using"
 * and silently fails to start the API server.
 *
 * This tool drops every requested platform binary into place so the package
 * works regardless of the OS that produced the build.
 *
 * Usage:
 *   node scripts/ensure-esbuild-platforms.mjs <pluginDir> [slug1,slug2,...]
 *
 * When the platform list is omitted, every supported platform is bundled
 * (cross-platform package). Pass an explicit comma-separated list to target a
 * specific subset, e.g. `win32-x64,win32-arm64`.
 */

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const ALL_PLATFORMS = [
    'win32-x64',
    'win32-arm64',
    'linux-x64',
    'linux-arm64',
    'darwin-x64',
    'darwin-arm64'
];

function parseArgs(argv) {
    const pluginDir = path.resolve(argv[2] || '.');
    const platforms = argv[3]
        ? argv[3].split(',').map((s) => s.trim()).filter(Boolean)
        : ALL_PLATFORMS;
    return { pluginDir, platforms };
}

function getEsbuildVersion(pluginDir) {
    const pkgPath = path.join(pluginDir, 'node_modules/esbuild/package.json');
    if (!fs.existsSync(pkgPath)) {
        return null;
    }
    return JSON.parse(fs.readFileSync(pkgPath, 'utf8')).version;
}

function targetExists(pluginDir, slug) {
    const dir = path.join(pluginDir, 'node_modules/@esbuild', slug);
    return (
        fs.existsSync(path.join(dir, 'bin/esbuild')) ||
        fs.existsSync(path.join(dir, 'esbuild.exe'))
    );
}

function installPlatformBinary(pluginDir, slug, version) {
    const dest = path.join(pluginDir, 'node_modules/@esbuild', slug);
    fs.mkdirSync(dest, { recursive: true });
    const tmpDir = fs.mkdtempSync(path.join(pluginDir, '.esbuild-platform-'));
    try {
        const packed = execFileSync(
            'npm',
            ['pack', `@esbuild/${slug}@${version}`, '--silent'],
            { cwd: tmpDir, encoding: 'utf8' }
        );
        const tarball = packed.trim().split(/\r?\n/).pop().trim();
        execFileSync('tar', ['-xzf', tarball], { cwd: tmpDir, stdio: 'inherit' });
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
        if (fs.existsSync(bin)) {
            fs.chmodSync(bin, 0o755);
        }
    } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    }
}

function main() {
    const { pluginDir, platforms } = parseArgs(process.argv);
    const version = getEsbuildVersion(pluginDir);
    if (!version) {
        console.log(`[esbuild] no esbuild under ${pluginDir}; nothing to bundle`);
        return;
    }

    let installed = 0;
    for (const slug of platforms) {
        if (targetExists(pluginDir, slug)) {
            continue;
        }
        console.log(`[esbuild] adding @esbuild/${slug}@${version}`);
        installPlatformBinary(pluginDir, slug, version);
        if (!targetExists(pluginDir, slug)) {
            throw new Error(`[esbuild] failed to install @esbuild/${slug}@${version}`);
        }
        installed++;
    }

    console.log(
        `[esbuild] platform binaries ready for ${version} ` +
        `(${platforms.length} targets, ${installed} newly installed)`
    );
}

main();
