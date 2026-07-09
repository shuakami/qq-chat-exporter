/**
 * Copies the built viewer into the two places the exporters embed it from:
 *  - qq-chat-export-core/assets/ (Rust include_str!)
 *  - plugins/qq-chat-exporter/lib/core/exporter/ModernHtmlTemplates.ts (TS constants)
 */
import { readFileSync, writeFileSync, copyFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const repo = resolve(root, '..');

const appJs = readFileSync(resolve(root, 'assets/modern_chunked_app.js'), 'utf8');
const indexHtml = readFileSync(resolve(root, 'assets/modern_chunked_index.html'), 'utf8');

// 1) Rust assets (embedded via include_str! in modern_html_templates.rs).
copyFileSync(
  resolve(root, 'assets/modern_chunked_app.js'),
  resolve(repo, 'qq-chat-export-core/assets/modern_chunked_app.js'),
);
copyFileSync(
  resolve(root, 'assets/modern_chunked_index.html'),
  resolve(repo, 'qq-chat-export-core/assets/modern_chunked_index.html'),
);

// 2) TypeScript template constants.
const tsPath = resolve(repo, 'plugins/qq-chat-exporter/lib/core/exporter/ModernHtmlTemplates.ts');
const ts = readFileSync(tsPath, 'utf8');

function replaceConst(source, name, value) {
  const marker = `export const ${name} = `;
  const start = source.indexOf(marker);
  if (start === -1) throw new Error(`${name} not found in ModernHtmlTemplates.ts`);
  const open = source.indexOf('`', start);
  // Find the closing backtick of the template literal, skipping escaped ones.
  let i = open + 1;
  while (i < source.length) {
    const ch = source[i];
    if (ch === '\\') i += 2;
    else if (ch === '`') break;
    else i += 1;
  }
  if (i >= source.length) throw new Error(`unterminated template literal for ${name}`);
  const escaped = value.replace(/\\/g, '\\\\').replace(/`/g, '\\`').replace(/\$\{/g, '\\${');
  return source.slice(0, open + 1) + escaped + source.slice(i);
}

let out = ts;
out = replaceConst(out, 'MODERN_CHUNKED_INDEX_HTML_TEMPLATE', indexHtml);
out = replaceConst(out, 'MODERN_CHUNKED_APP_JS', appJs);
writeFileSync(tsPath, out);
console.log('synced: qq-chat-export-core/assets + ModernHtmlTemplates.ts');
