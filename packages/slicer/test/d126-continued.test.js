// D126 (N0): a recording that opens on a compaction is read with the recordings it continues, as one session in order.
// The pure half (slicer/src/continued.js) and the slicer's join (`sliceLineage` with `through`). Every fixture is
// synthetic, shaped like the rows Claude Code writes when a session is resumed after a compaction: the later recording
// starts with a copy of the compaction's boundary row, its summary and the kept messages (same uuids), then its own rows.

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sliceLineage, CONTINUED_REASONS } from '../index.js';
import { openingCompaction, earlierRecording, continuedShape, CONTINUED_LIMITS } from '../src/continued.js';

const V = '2.1.284';
const row = (sessionId, extra) => ({ sessionId, cwd: '/repo', version: V, gitBranch: 'main', isSidechain: false,
  userType: 'external', timestamp: '2026-10-20T10:00:00.000Z', ...extra });
const human = (sid, uuid, parentUuid, text) => row(sid, { type: 'user', uuid, parentUuid, origin: { kind: 'human' },
  promptSource: 'typed', message: { role: 'user', content: text } });
const said = (sid, uuid, parentUuid, text) => row(sid, { type: 'assistant', uuid, parentUuid,
  message: { role: 'assistant', model: 'claude-x', content: [{ type: 'text', text }] } });
const call = (sid, uuid, parentUuid, id) => row(sid, { type: 'assistant', uuid, parentUuid,
  message: { role: 'assistant', model: 'claude-x', content: [{ type: 'tool_use', id, name: 'Edit',
    input: { file_path: '/repo/a.js', old_string: 'a', new_string: 'b' } }] } });
const result = (sid, uuid, parentUuid, id) => row(sid, { type: 'user', uuid, parentUuid,
  message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content: 'ok' }] } });
const boundary = (sid, uuid, linked, head, tail, anchor) => row(sid, { type: 'system', subtype: 'compact_boundary', uuid,
  parentUuid: null, logicalParentUuid: linked, content: 'Conversation compacted', level: 'info',
  compactMetadata: { trigger: 'auto', preTokens: 967925, postTokens: 11687, durationMs: 1,
    preservedSegment: { headUuid: head, anchorUuid: anchor, tailUuid: tail } } });
const summary = (sid, uuid, parentUuid) => row(sid, { type: 'user', uuid, parentUuid, isCompactSummary: true,
  isVisibleInTranscriptOnly: true, message: { role: 'user', content: 'Summary of the earlier conversation.' } });
const meta = (sid) => ({ type: 'custom-title', customTitle: 'x', sessionId: sid });

/** A: the person's first asks, the compaction, one more ask. B: a resume of A after its compaction (copies, then own). */
function pair() {
  const A = 'sess-a', B = 'sess-b';
  const a = [meta(A),
    human(A, 'a1', null, 'ask one: add the parser'),
    call(A, 'a2', 'a1', 'toolu_1'), result(A, 'a3', 'a2', 'toolu_1'),
    human(A, 'a4', 'a3', 'ask two: keep the old flag'),
    said(A, 'a5', 'a4', 'Done with both.'),
    boundary(A, 'b1', 'a5', 'a4', 'a5', 's1'), summary(A, 's1', 'b1'),
    human(A, 'a6', 's1', 'ask three: now write the tests'),
    said(A, 'a7', 'a6', 'Writing them.')];
  const b = [meta(B),
    boundary(B, 'b1', 'a5', 'a4', 'a5', 's1'), summary(B, 's1', 'b1'),
    human(B, 'a4', 's1', 'ask two: keep the old flag'), said(B, 'a5', 'a4', 'Done with both.'),
    human(B, 'a6', 'a5', 'ask three: now write the tests'), said(B, 'a7', 'a6', 'Writing them.'),
    human(B, 'b2', 'a7', 'ask four: and update the docs'),
    call(B, 'b3', 'b2', 'toolu_2'), result(B, 'b4', 'b3', 'toolu_2')];
  return { a, b };
}

async function onDisk(sets) {
  const dir = await mkdtemp(join(tmpdir(), 'd126-'));
  const files = [];
  for (const [name, rows] of Object.entries(sets)) {
    const f = join(dir, `${name}.jsonl`);
    await writeFile(f, rows.map((r) => JSON.stringify(r)).join('\n') + '\n');
    files.push(f);
  }
  return { dir, files };
}

test('openingCompaction: a boundary before any user or assistant row, linking a row the recording does not hold', () => {
  const { a, b } = pair();
  assert.deepEqual(openingCompaction(b), { boundary: 'b1', linked: 'a5' });
  // The earlier recording's first message comes before its compaction.
  assert.equal(openingCompaction(a), null);
  // A helper's boundary, one with no link, and one whose link the recording holds before it are not an opening.
  assert.equal(openingCompaction([meta('s'), { ...b[1], isSidechain: true }]), null);
  assert.equal(openingCompaction([meta('s'), { ...b[1], logicalParentUuid: undefined }]), null);
  assert.equal(openingCompaction([{ type: 'attachment', uuid: 'a5' }, b[1]]), null);
  // An attachment row before the boundary is no message: still an opening.
  assert.deepEqual(openingCompaction([{ type: 'attachment', uuid: 'x9' }, b[1]]), { boundary: 'b1', linked: 'a5' });
  // Past the head bound: not read as an opening.
  assert.equal(openingCompaction([...Array(CONTINUED_LIMITS.headRows).fill(meta('s')), b[1]]), null);
  // A row's words never decide: a user row that says it continues is a message.
  assert.equal(openingCompaction([human('s', 'u', null, 'This session is being continued from a previous one'), b[1]]),
    null);
});

test('earlierRecording: the one that holds the linked row before the boundary; copies by bytes; each reason', () => {
  const at = (key, digest = 'd1', boundaryAfter = true) => ({ key, linkedLine: 6, boundaryAfter, digest });
  assert.deepEqual(earlierRecording({ candidates: [at('/f/a.jsonl')] }), { key: '/f/a.jsonl', linkedLine: 6 });
  // A recording that holds the linked row after the boundary (a copy of the kept messages) is not the earlier one.
  assert.deepEqual(earlierRecording({ candidates: [at('/f/c.jsonl', 'd1', false)] }),
    { reason: CONTINUED_REASONS.missing });
  assert.deepEqual(earlierRecording({ candidates: [], unreadable: 1 }), { reason: CONTINUED_REASONS.unread });
  // Two with the same bytes through the linked row: the first by name. Two that differ: ambiguous.
  assert.deepEqual(earlierRecording({ candidates: [at('/f/z.jsonl'), at('/f/m.jsonl')] }),
    { key: '/f/m.jsonl', linkedLine: 6 });
  assert.deepEqual(earlierRecording({ candidates: [at('/f/z.jsonl'), at('/f/m.jsonl', 'd2')] }),
    { reason: CONTINUED_REASONS.ambiguous });
  // Already part of the session: a cycle; another one beside it is still read.
  assert.deepEqual(earlierRecording({ candidates: [at('/f/a.jsonl')], visited: new Set(['/f/a.jsonl']) }),
    { reason: CONTINUED_REASONS.cycle });
  assert.deepEqual(earlierRecording({ candidates: [at('/f/a.jsonl'), at('/f/b.jsonl')],
    visited: new Set(['/f/a.jsonl']) }), { key: '/f/b.jsonl', linkedLine: 6 });
});

test('sliceLineage with `through`: the earlier part read through its row, copies once, no join mark, said on the lineage',
  async () => {
    const { a, b } = pair();
    const { dir, files } = await onDisk({ a, b });
    try {
      const alone = await sliceLineage([files[1]]);
      const joined = await sliceLineage(files, { through: ['a5', null] });
      // B alone holds three asks (ask two is a copy of A's, read after the summary); joined, all four, each once, in order.
      assert.deepEqual(alone.ask.map((x) => x.text), ['ask two: keep the old flag', 'ask three: now write the tests',
        'ask four: and update the docs']);
      assert.deepEqual(joined.ask.map((x) => x.text), ['ask one: add the parser', 'ask two: keep the old flag',
        'ask three: now write the tests', 'ask four: and update the docs']);
      // Ask two is read at its first place, before the compaction, in the earlier recording (stream 0).
      assert.deepEqual(joined.ask.map((x) => x.identity.stream), [0, 0, 1, 1]);
      // A's rows after the linked row (its own compaction and ask three) are B's to read: read once, from B.
      assert.equal(joined.ask.filter((x) => x.text.startsWith('ask three')).length, 1);
      // Both edits, each once, each named by its own row.
      assert.deepEqual(joined.ledger.filter((e) => e.kind === 'edit').map((e) => e.identity.native), ['a2', 'b3']);
      // B's own events keep their recorded ids (the native uuid), whatever their stream.
      assert.deepEqual(alone.ledger.map((e) => e.identity.native), ['b3']);
      // The compaction is marked by B's boundary and summary rows, never by the file join (no `join` identity).
      assert.ok(joined.marks.filter((m) => m.kind === 'compaction').every((m) => m.identity?.sub === 'compaction'));
      assert.deepEqual(joined.marks.filter((m) => m.kind === 'compaction').map((m) => m.turn), [2, 2]);
      assert.deepEqual(joined.lineage.continued, { earlier: 1 });
      assert.ok(continuedShape(joined.lineage.continued));
      assert.equal(alone.lineage.continued, undefined);
    } finally { await rm(dir, { recursive: true, force: true }); }
  });

test('sliceLineage: a recording that opens on a compaction with no earlier part read says why', async () => {
  const { b } = pair();
  const { dir, files } = await onDisk({ b });
  try {
    const ledger = await sliceLineage(files, { through: [null], continuedUnread: CONTINUED_REASONS.missing });
    assert.deepEqual(ledger.lineage.continued, { earlier: 0, unread: 'earlier_recording_missing' });
    // The evidence is that of the recording alone.
    const alone = await sliceLineage(files);
    assert.deepEqual(ledger.ask, alone.ask);
    assert.deepEqual(ledger.ledger, alone.ledger);
    await assert.rejects(sliceLineage(files, { through: [null], continuedUnread: 'gone' }));
    await assert.rejects(sliceLineage(files, { through: ['x'] }));
    await assert.rejects(sliceLineage([...files, ...files], { through: [null, null] }));
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('sliceLineage: an earlier recording whose linked row is gone is not read, and the part is declared unread',
  async () => {
    const { a, b } = pair();
    const { dir, files } = await onDisk({ a: a.filter((r) => r.uuid !== 'a5'), b });
    try {
      const ledger = await sliceLineage(files, { through: ['a5', null] });
      const alone = await sliceLineage([files[1]]);
      assert.deepEqual(ledger.lineage.continued, { earlier: 0, unread: 'earlier_recording_unread' });
      assert.deepEqual(ledger.ask, alone.ask);
      assert.equal(ledger.lineage.files.length, 1);
    } finally { await rm(dir, { recursive: true, force: true }); }
  });

test('sliceLineage without `through` keeps every byte: a plain lineage still joins with a mark and no dedupe', async () => {
  const { a, b } = pair();
  const { dir, files } = await onDisk({ a, b });
  try {
    const plain = await sliceLineage(files);
    assert.equal(plain.lineage.continued, undefined);
    assert.ok(plain.marks.some((m) => m.identity?.sub === 'join'));
    // The copies are read twice, as before this decision: ask two appears in both files.
    assert.equal(plain.ask.filter((x) => x.text.startsWith('ask two')).length, 2);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
