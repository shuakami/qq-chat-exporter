/** Copies the built viewer into the Rust exporter's embedded assets. */
import { copyFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const repo = resolve(root, '..');

copyFileSync(
  resolve(root, 'assets/modern_chunked_app.js'),
  resolve(repo, 'qq-chat-export-core/assets/modern_chunked_app.js'),
);
copyFileSync(
  resolve(root, 'assets/modern_chunked_index.html'),
  resolve(repo, 'qq-chat-export-core/assets/modern_chunked_index.html'),
);
console.log('synced: qq-chat-export-core/assets');
