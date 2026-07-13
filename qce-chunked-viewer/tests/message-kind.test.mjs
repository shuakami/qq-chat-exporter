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
