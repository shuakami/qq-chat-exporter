#!/usr/bin/env node
/**
 * 生成 Release Update Banner。
 *
 * 用法: node scripts/generate-release-banner.mjs <version> <changelog.txt> <output.png>
 * changelog.txt 为每行一条的 commit subject 列表。
 */
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium } from 'playwright';

const [version, changelogPath, outputPath] = process.argv.slice(2);
if (!version || !changelogPath || !outputPath) {
  console.error('usage: generate-release-banner.mjs <version> <changelog.txt> <output.png>');
  process.exit(1);
}

const MAX_ITEMS = 6;
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const escapeHtml = (s) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const seen = new Set();
const items = [];
for (const line of readFileSync(changelogPath, 'utf8').split('\n')) {
  const t = line.replace(/^-\s*/, '').replace(/\s*\(#\d+\)\s*$/, '').trim();
  if (t && !seen.has(t)) { seen.add(t); items.push(t); }
}

function renderItem(t) {
  const m = t.match(/^(feat|fix|perf|docs|test|chore|refactor|style|build|ci)(\(([^)]+)\))?\s*:\s*(.*)$/);
  if (!m) return `<li><span>${escapeHtml(t)}</span></li>`;
  const [, typ, , scope, rest] = m;
  const cls = ['feat', 'fix', 'perf', 'docs'].includes(typ) ? typ : 'other';
  const label = escapeHtml(typ) + (scope ? `<span class="scope"> ${escapeHtml(scope)}</span>` : '');
  return `<li><span class="ct ct-${cls}">${label}</span><span>${escapeHtml(rest)}</span></li>`;
}

const PRIORITY = { feat: 0, fix: 1, perf: 2 };
function rank(t) {
  const m = t.match(/^(\w+)(\([^)]+\))?\s*:/);
  return m && m[1] in PRIORITY ? PRIORITY[m[1]] : 3;
}

let selected = items;
if (items.length > MAX_ITEMS) {
  selected = items
    .map((t, i) => ({ t, i, r: rank(t) }))
    .sort((a, b) => a.r - b.r || a.i - b.i)
    .slice(0, MAX_ITEMS)
    .sort((a, b) => a.i - b.i)
    .map((x) => x.t);
}

let lis = selected.map(renderItem).join('');
if (items.length > MAX_ITEMS) {
  lis += `<li class="more">…以及另外 ${items.length - MAX_ITEMS} 项改进</li>`;
}

const template = readFileSync(join(repoRoot, 'scripts', 'release-banner-template.html'), 'utf8');
const html = template
  .replace('{{VERSION_MARK}}', 'Update')
  .replace('{{TAG}}', escapeHtml(version))
  .replace('{{ITEMS}}', lis)
  .replace('{{UI_URL}}', pathToFileURL(join(repoRoot, 'public', 'assets', 'home', 'app', 'index.html')).href)
  .replace('{{SHADER_URL}}', pathToFileURL(join(repoRoot, 'public', 'assets', 'vendor', 'paper-shaders-0.0.77.js')).href);

const htmlPath = join(mkdtempSync(join(tmpdir(), 'qce-banner-')), 'banner.html');
writeFileSync(htmlPath, html);

const browser = await chromium.launch({ args: ['--allow-file-access-from-files'] });
const page = await (await browser.newContext({
  viewport: { width: 1700, height: 900 },
  deviceScaleFactor: 2,
})).newPage();
await page.goto(pathToFileURL(htmlPath).href);
await page.waitForFunction('window.__shaderReady === true', null, { timeout: 30000 }).catch(() => {});
await page.waitForTimeout(3000);
await page.locator('.banner').screenshot({ path: outputPath });
await browser.close();
console.log(outputPath);
