// Compaction boundaries — the one thing the review's window segmentation is built on.
//
// Two ways a compaction is recorded, and both were broken:
//   1. A FILE JOIN. sliceLineage stitches a lineage together and records the join as a boundary.
//      The boundary is positional (a record index) and has to become a TURN index. Counting
//      `kind === 'user'` records counts every tool_result as a turn, so the mark landed far past
//      the real boundary — at the end of the session, on a real recording (H42).
//   2. AN IN-FILE RECORD. Claude Code writes the compaction inside the same file, as a system
//      record with subtype `compact_boundary` or as a synthetic continuation user turn. Both are
//      in KEPT_TYPES, so the parser classified them as ordinary records and no mark was ever
//      produced (H45).
//
// Every fixture here is synthetic. No real recording is read.

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sliceLineage } from '../index.js';

let seq = 0;
const uid = () => `id-${String(++seq).padStart(6, '0')}`;
// M34 labels review (F6): a typed recorder (2.1.219 and later), whose human rows carry the host's typed origin — these
// tests are about compaction, not the declared legacy fallback (whose every row is a counted, positioned label gap).
const base = { sessionId: 'sess-compaction', cwd: '/repo', version: '2.1.284', gitBranch: 'main', isSidechain: false };

const userTurn = (text) => ({ ...base, type: 'user', uuid: uid(), origin: { kind: 'human' },
  message: { role: 'user', content: text } });
const toolUse = (id, name, input) => ({ ...base, type: 'assistant', uuid: uid(),
  message: { role: 'assistant', content: [{ type: 'tool_use', id, name, input }] } });
const toolResult = (id, content) => ({ ...base, type: 'user', uuid: uid(),
  message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content }] } });

/** One human turn plus the tool call and tool result it provokes: 1 turn, 2 user-kind records. */
const workedTurn = (n) => [
  userTurn(`ask number ${n}`),
  toolUse(`t${n}`, 'Edit', { file_path: `/repo/src/f${n}.js`, old_string: 'a', new_string: 'b' }),
  toolResult(`t${n}`, 'ok'),
];

async function lineageOnDisk(...fileRecordSets) {
  const dir = await mkdtemp(join(tmpdir(), 'slicer-compaction-'));
  const files = [];
  for (const [i, records] of fileRecordSets.entries()) {
    const f = join(dir, `part-${i}.jsonl`);
    await writeFile(f, records.map((r) => JSON.stringify(r)).join('\n') + '\n');
    files.push(f);
  }
  return { dir, files };
}

test('a file join marks the turn the compaction happened on, not the user-record count (H42)', async () => {
  const second = [...workedTurn(4), ...workedTurn(5)];
  const { dir, files } = await lineageOnDisk(
    [...workedTurn(1), ...workedTurn(2), ...workedTurn(3)],
    second,
  );
  try {
    const ledger = await sliceLineage(files);
    // C-01 event identity: the join is named by the first row of the file it opens.
    assert.deepEqual(ledger.marks, [{ turn: 3, kind: 'compaction',
      identity: { stream: 1, record: 1, native: second[0].uuid, sub: 'join' } }]);
    assert.deepEqual(ledger.lineage.compactionBoundaries, [3]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('an in-file compact_boundary system record produces a mark (H45)', async () => {
  const before = [...workedTurn(1), ...workedTurn(2)];
  const boundary = { ...base, type: 'system', subtype: 'compact_boundary', uuid: uid() };
  const { dir, files } = await lineageOnDisk([...before, boundary, ...workedTurn(3)]);
  try {
    const ledger = await sliceLineage(files);
    // C-01 event identity: the compaction is named by its own row.
    assert.deepEqual(ledger.marks, [{ turn: 2, kind: 'compaction',
      identity: { stream: 0, record: before.length + 1, native: boundary.uuid, sub: 'compaction' } }]);
    assert.deepEqual(ledger.lineage.compactionBoundaries, [2]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('a continuation user turn marks the compaction and is not itself a human turn (H45)', async () => {
  // H2: Claude Code marks the summary row `isCompactSummary`; the
  // mark decides, never the row's opening words.
  const before = [...workedTurn(1), ...workedTurn(2)];
  const summary = { ...base, type: 'user', uuid: uid(), message: { role: 'user',
    content: 'This session is being continued from a previous conversation that ran out of context.' },
  isCompactSummary: true, isVisibleInTranscriptOnly: true };
  const { dir, files } = await lineageOnDisk([...before, summary, ...workedTurn(3)]);
  try {
    const ledger = await sliceLineage(files);
    // C-01 event identity: the compaction is named by its own row.
    assert.deepEqual(ledger.marks, [{ turn: 2, kind: 'compaction',
      identity: { stream: 0, record: before.length + 1, native: summary.uuid, sub: 'compaction' } }]);
    // The continuation notice is harness scaffolding, never an ask: the turn counter does not
    // advance for it, so the session still has exactly three human turns.
    assert.deepEqual(ledger.ask.map((a) => a.turn), [1, 2, 3]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('H2: a user row the recorder did not mark is never read as a compaction by its opening words', async () => {
  const words = 'This session is being continued from a previous conversation; please pick up the parser fix.';
  const { dir, files } = await lineageOnDisk([...workedTurn(1), userTurn(words), ...workedTurn(2)]);
  try {
    const ledger = await sliceLineage(files);
    assert.deepEqual(ledger.marks, []);
    assert.deepEqual(ledger.ask.map((a) => [a.turn, a.text]), [[1, 'ask number 1'], [2, words], [3, 'ask number 2']]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
