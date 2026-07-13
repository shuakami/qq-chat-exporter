import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const viewer = readFileSync(new URL('../src/Viewer.tsx', import.meta.url), 'utf8');
const css = readFileSync(
  new URL('../../qq-chat-export-core/assets/modern_css.css', import.meta.url),
  'utf8',
);
const mediaFallback = readFileSync(
  new URL('../src/qce/media-fallback.ts', import.meta.url),
  'utf8',
);
const singleScripts = readFileSync(
  new URL('../../qq-chat-export-core/assets/modern_single_scripts.html', import.meta.url),
  'utf8',
);

test('settings dialog exposes the group title toggle as its third experimental option', () => {
  const experimental = viewer.slice(
    viewer.indexOf('>实验性功能<'),
    viewer.indexOf('</div>', viewer.indexOf('label="显示群成员头衔"')) + 6,
  );
  assert.equal((experimental.match(/<SettingsToggle/g) ?? []).length, 3);
  assert.match(experimental, /label="显示群成员头衔"/);
  assert.match(viewer, /qce-hide-group-member-titles/);
  assert.match(css, /\.qce-hide-group-member-titles \.sender-title/);
});

test('reply jump retries until the virtualized bubble exists and visibly darkens it', () => {
  assert.match(viewer, /requestAnimationFrame\(highlight\)/);
  assert.match(viewer, /bubble\.classList\.add\('reply-jump-highlight'\)/);
  assert.match(css, /\.message-bubble\.reply-jump-highlight/);
  assert.match(css, /rgba\(0, 0, 0, 0\.14\)/);
});

test('failed exported media uses the supplied empty-state fallback UI', () => {
  assert.match(viewer, /installMediaFallback\(viewport\)/);
  assert.match(viewer, /replaceMediaWithFallback\(el, 'audio'\)/);
  assert.match(mediaFallback, /\.image-content img/);
  assert.match(mediaFallback, /\.video-bubble video\.img/);
  assert.match(mediaFallback, /\.sticker-wrap img\.sticker/);
  assert.match(mediaFallback, /img\.reply-content-thumb/);
  assert.match(mediaFallback, /图片不可用/);
  assert.match(mediaFallback, /视频不可用/);
  assert.match(mediaFallback, /语音不可用/);
  assert.match(singleScripts, /document\.addEventListener\('error'/);
  assert.match(css, /\.media-fallback/);
  assert.match(css, /\.mf-icon/);
});
