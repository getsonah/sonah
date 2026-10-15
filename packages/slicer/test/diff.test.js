// The content channel's carrier: minimal, deterministic, budgeted, declared.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { minimalDiff, editDiff, createDiff, budgetDiff } from '../src/diff.js';
import * as diffModule from '../src/diff.js';

test('a minimal diff keeps only changed lines and one line of context', () => {
  const old = 'a\nb\nc\nd\ne\nf';
  const neu = 'a\nb\nC\nd\ne\nf';
  assert.equal(minimalDiff(old, neu), ' b\n-c\n+C\n d');
  assert.equal(minimalDiff('same', 'same'), '', 'identical text diffs to nothing');
});

test('a skip marker slipped into a test is visible as a + line — the whole point', () => {
  // M33 R repair: the diff shows each line as redaction leaves it once it has scrubbed the whole change. (A top-level
  // decorator right after a `+` marker, `+@pytest.mark.skip`, reads to redaction's email rule as an address and is masked
  // in the redacted diff, as it always was; a test method's decorator, after its indentation, is not.)
  const d = editDiff('class TestProbe:\n    def test_probe(self):\n        assert flush() == 1\n',
    'class TestProbe:\n    @pytest.mark.skip(reason="flaky")\n    def test_probe(self):\n        assert flush() == 1\n');
  // D69 (c): no computed hunk header names an "enclosing definition" from a keyword list.
  assert.doesNotMatch(d, /^@@/m, 'no computed hunk header');
  assert.match(d, /\+    @pytest\.mark\.skip\(reason="flaky"\)/);
  assert.ok(!d.includes('+        assert flush'), 'unchanged lines are not additions');
});

test('a whole-file write shows the head as additions, and lists no names it "defines" (D69 c)', () => {
  const body = Array.from({ length: 80 }, (_, i) => (i === 3 ? 'def handler(req):' : i === 40 ? 'class Store:' : `line ${i}`)).join('\n');
  const d = createDiff(body);
  assert.doesNotMatch(d, /@@ defines:/);
  assert.match(d, /^\+line 0/);
  assert.match(d, /\+line 0/);
  assert.match(d, /\[… 50 more lines …\]/);
});

test('the budget cap elides the middle and says so', () => {
  const big = Array.from({ length: 400 }, (_, i) => `+line number ${i} with some padding text`).join('\n');
  const d = budgetDiff(big);
  assert.ok(d.length < big.length);
  assert.match(d, /\[… \d+ diff lines elided …\]/);
  assert.match(d, /^\+line number 0/);
  assert.match(d, /\+line number 399/);
});

test('D69 (c): the programming-language keyword list and its helpers are deleted', () => {
  for (const name of ['hunkHeader', 'definedNames', 'shownLength']) assert.equal(diffModule[name], undefined, name);
});
