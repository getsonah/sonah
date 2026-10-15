// extractJson, the reviewer backend's JSON reader (packages/cli/src/review-judge.js). Kept from the legacy compiler's
// tier.test.js (removed with the compiler). No model is called.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractJson } from '../src/review-judge.js';

test('JSON survives fences and trailing prose', () => {
  assert.deepEqual(extractJson('Sure!\n```json\n{"a":1}\n```\nHope that helps'), { a: 1 });
  assert.deepEqual(extractJson('{"a":"}"}\nthen prose'), { a: '}' });
  assert.equal(extractJson('no json here'), null);
});
