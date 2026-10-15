// F14 / F15: reasons are tokens, and tokens are declared.
//
// A project rule: reason strings are a closed vocabulary in one constants file, never constructed in
// logic — per-reason false-positive rates must stay computable. `unparseable_lines:3` is not one
// reason, it is one reason per possible count, and a rate over an unbounded set is not a rate.
// The same holds for a declared member re-typed as a literal at its call site: the table stops
// being the single place the vocabulary can be read off.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join, dirname } from 'node:path';
import { writeFile, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { sliceLineage, hasActionGaps, hasCaptureGaps } from '../../slicer/index.js';
import { CHILD_CAPTURE_REASONS } from '../src/session-evidence.js';
import { scratchDir } from '../../slicer/test/scratch-dir.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

async function recording(lines) {
  const d = await scratchDir('reasons-');
  const f = join(d, 's.jsonl');
  await writeFile(f, lines.join('\n'), 'utf8');
  return f;
}

const valid = [
  JSON.stringify({ type: 'user', sessionId: 's', cwd: '/repo', message: { role: 'user', content: 'fix the build' } }),
  JSON.stringify({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'tool_use', id: 't1', name: 'Bash', input: { command: 'make' } }] } }),
  JSON.stringify({ type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't1', content: 'ok', is_error: false }] } }),
];

test('a corrupt recording drops the bare token and carries the count in a field', async () => {
  const ledger = await sliceLineage([await recording([valid[0], '{"type":"user"', valid[1], 'not json at all', valid[2]])]);
  const drop = (ledger.dropped ?? []).find((d) => String(d.reason).startsWith('unparseable_lines'));
  assert.ok(drop, 'corruption is counted, not hidden');
  assert.equal(drop.reason, 'unparseable_lines', 'the reason is the token, with no count glued to it');
  assert.equal(drop.count, 2, 'the count is a sibling field');
  for (const d of ledger.dropped ?? []) {
    assert.ok(!/:\d/.test(String(d.reason)), `a reason carries no number: ${d.reason}`);
  }
  // The gap predicates read the field, so what the drop MEANS is unchanged.
  assert.equal(hasActionGaps(ledger), true, 'unparseable records are still a gap in the action stream');
  assert.equal(hasCaptureGaps(ledger), true);
});

test('a clean recording drops nothing, and a zero count is not a gap', async () => {
  const ledger = await sliceLineage([await recording(valid)]);
  assert.deepEqual((ledger.dropped ?? []).filter((d) => String(d.reason).startsWith('unparseable')), []);
  assert.equal(hasActionGaps(ledger), false);
  // A count of zero never reaches the ledger, and a hand-built one must not read as a gap either
  // — the old `:[1-9]\d*` parser made that distinction and the field must keep it.
  for (const count of [0, undefined, null]) {
    const forged = { ...ledger, dropped: [{ turn: null, reason: 'unparseable_lines', count }] };
    assert.equal(hasActionGaps(forged), false, `count ${count} is not a gap`);
    assert.equal(hasCaptureGaps(forged), false, `count ${count} is not a gap`);
  }
});

test('an unresolved delegation declares a member of the slicer\'s table, not a literal', async () => {
  const { SLICE_REASONS } = await import('../../slicer/index.js');
  const members = new Set(Object.values(SLICE_REASONS));
  const ledger = await sliceLineage([await recording([
    valid[0],
    JSON.stringify({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'tool_use', id: 'd1', name: 'Task', input: { description: 'sub', prompt: 'go' } }] } }),
  ])]);
  assert.ok((ledger.capture?.reasons ?? []).includes(SLICE_REASONS.DELEGATED_CAPTURE),
    `expected the declared delegation reason, got ${JSON.stringify(ledger.capture?.reasons)}`);
  for (const r of ledger.capture?.reasons ?? []) assert.ok(members.has(r), `capture reason outside the table: ${r}`);
  for (const d of ledger.dropped ?? []) assert.ok(members.has(String(d.reason)), `drop reason outside the table: ${d.reason}`);
});

test('the slicer spells each reason out once, in its declared table, and builds none (F15)', async () => {
  // A literal is invisible to the table: it survives a rename, and it is the way a reason that is
  // no longer a member goes on being emitted.
  const occurrences = (text, token) => text.split(`'${token}'`).length - 1;

  const slicer = await readFile(join(ROOT, 'packages', 'slicer', 'index.js'), 'utf8');
  for (const token of ['delegated_capture_unchecked', 'delegated_review_unchecked',
    'capture_incomplete', 'known_code_effect_untyped', 'unparseable_lines', 'unknown_schema_files']) {
    assert.equal(occurrences(slicer, token), 1,
      `${token} must be spelled out exactly once in the slicer — in its declared table`);
    // And no reason is BUILT: a template literal is the shape F14 was reported for.
    assert.ok(!slicer.includes(`${token}:\${`), `${token} must not have a count interpolated into it`);
  }
});

test('the slicer table and the session layer table agree on the reasons they share', async () => {
  const { SLICE_REASONS } = await import('../../slicer/index.js');
  const { CODEX_CAPTURE_REASONS } = await import('../../slicer/src/codex-exec.js');
  // Both write `capture.reasons` on the same ledger, and session-evidence.js reads the slicer's delegation reason
  // back by its own member. The slicer does not import the session layer — a deterministic stage takes no
  // dependency on it — so the two tables are checked against each other here instead of trusted to stay in step.
  assert.equal(CHILD_CAPTURE_REASONS.CAPTURE_UNCHECKED, SLICE_REASONS.DELEGATED_CAPTURE);
  assert.equal(CHILD_CAPTURE_REASONS.REVIEW_UNCHECKED, SLICE_REASONS.DELEGATED_REVIEW);
  assert.equal(CODEX_CAPTURE_REASONS.codeEffectUntyped, SLICE_REASONS.KNOWN_CODE_EFFECT_UNTYPED);
});
