import assert from 'node:assert/strict';
import test from 'node:test';

import { settleSmoothOffset } from '../src/hyperscroll/settling.mjs';

test('terminal settling consumes only the remaining distance', () => {
  assert.equal(settleSmoothOffset(10.6, -0.1), 10.5);
  assert.equal(settleSmoothOffset(10.4, 0.1), 10.5);
  assert.equal(settleSmoothOffset(-10.6, 0.1), -10.5);
  assert.equal(settleSmoothOffset(-10.4, -0.1), -10.5);
});

test('terminal settling cannot reverse the final movement', () => {
  for (const offset of [-10.6, -10.4, 10.4, 10.6]) {
    for (const remainder of [-0.49, 0.49]) {
      const settled = settleSmoothOffset(offset, remainder);
      assert.ok(Math.abs(settled - offset) <= Math.abs(remainder) + Number.EPSILON * 8);
      assert.equal(Math.sign(settled - offset), Math.sign(remainder));
    }
  }
});
