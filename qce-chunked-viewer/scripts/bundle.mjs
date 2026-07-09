/**
 * Merges the vite lib build (dist/viewer.js + dist/viewer.css) into a single
 * self-contained assets/app.js that injects its CSS at runtime, so exports
 * keep working from file:// with exactly one script asset.
 */
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dist = resolve(root, 'dist');

const js = readFileSync(resolve(dist, 'viewer.js'), 'utf8');
const cssFile = readdirSync(dist).find((f) => f.endsWith('.css'));
if (!cssFile) throw new Error('no css emitted by vite build');
const css = readFileSync(resolve(dist, cssFile), 'utf8');

const banner = `/* QCE chunked viewer - built from qce-chunked-viewer (React + HyperScroll). Do not edit by hand. */\n`;
const inject =
  `(function(){var s=document.createElement("style");` +
  `s.textContent=${JSON.stringify(css)};` +
  `document.head.appendChild(s);})();\n`;

writeFileSync(resolve(root, 'assets/modern_chunked_app.js'), banner + inject + js);
console.log(
  'assets/modern_chunked_app.js written:',
  ((banner.length + inject.length + js.length) / 1024).toFixed(0),
  'KiB',
);
