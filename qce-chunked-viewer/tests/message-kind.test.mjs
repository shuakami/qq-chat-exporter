import assert from 'node:assert/strict';
import test from 'node:test';

import { kindOf } from '../src/qce/message-kind.mjs';

test('classifies custom and market stickers as emoji', () => {
  assert.equal(
    kindOf('<span class="sticker-wrap"><img class="sticker sticker-img"></span>'),
    'sticker',
  );
  assert.equal(
    kindOf('<span class="sticker-wrap"><span class="text-content">[超级表情]</span></span>'),
    'sticker',
  );
  assert.equal(kindOf('<img class="sticker sticker-img market-face">'), 'sticker');
});

test('classifies native QQ faces as emoji', () => {
  assert.equal(kindOf('<img class="face-emoji face-emoji-image">'), 'sticker');
  assert.equal(kindOf('<span class="face-emoji">/赞</span>'), 'sticker');
});

test('does not classify ordinary images as emoji', () => {
  assert.equal(kindOf('<div class="image-content"><img src="image.png"></div>'), 'img');
});

test('classifies modern exporter voice and video markup', () => {
  assert.equal(
    kindOf('<div class="voice-bubble" data-src="voice.silk"><span class="vplay"></span><span class="vbars"></span></div>'),
    'voice',
  );
  assert.equal(
    kindOf('<span class="media-fallback mf-audio" role="img"><span class="mf-icon"></span></span>'),
    'voice',
  );
  assert.equal(
    kindOf('<div class="video-bubble" data-src="video.mp4"><video class="img" src="video.mp4#t=0.1"></video><span class="vbadge">视频</span></div>'),
    'video',
  );
  assert.equal(
    kindOf('<span class="media-fallback mf-video" role="img"><span class="mf-icon"></span></span>'),
    'video',
  );
});

test('keeps classifying legacy audio and video markup', () => {
  assert.equal(kindOf('<div class="audio-wrapper"><audio></audio></div>'), 'voice');
  assert.equal(kindOf('<div class="message-audio"></div>'), 'voice');
  assert.equal(kindOf('<div class="message-video"></div>'), 'video');
});
