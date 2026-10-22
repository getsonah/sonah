// D127 (A19): a file attachment that Claude Code writes after a compaction to restore the context of a message that the
// compaction kept is the harness's, never "You attached". Structure only: the latest compaction's boundary row lists the
// messages it kept (`compactMetadata.preservedMessages`), and the attachment's recorded chain reaches one of them. Every
// fixture is synthetic, shaped like the rows Claude Code writes when it resumes a session after a compaction.

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sliceLineage } from '../index.js';
import { readSession, ATTACHED_RECORD } from '../src/records.js';
import { INTERJECTION_KINDS } from '../src/events.js';

const base = { sessionId: 'sess-a19', cwd: '/repo', version: '2.1.295', gitBranch: 'main', isSidechain: false,
  userType: 'external', entrypoint: 'cli', timestamp: '2026-10-20T10:00:00.000Z' };
const human = (uuid, parentUuid, text) => ({ ...base, type: 'user', uuid, parentUuid, origin: { kind: 'human' },
  promptSource: 'typed', message: { role: 'user', content: text } });
const said = (uuid, parentUuid, text) => ({ ...base, type: 'assistant', uuid, parentUuid,
  message: { role: 'assistant', model: 'claude-x', content: [{ type: 'text', text }] } });
const file = (uuid, parentUuid, path) => ({ ...base, type: 'attachment', uuid, parentUuid,
  attachment: { type: 'file', displayPath: path, filename: `/repo/${path}`, content: { type: 'text',
    file: { filePath: `/repo/${path}`, content: `contents of ${path}`, numLines: 1, startLine: 1, totalLines: 1 } } } });
const boundary = (uuid, linked, kept) => ({ ...base, type: 'system', subtype: 'compact_boundary', uuid, parentUuid: null,
  logicalParentUuid: linked, content: 'Conversation compacted', level: 'info',
  compactMetadata: { trigger: 'auto', preTokens: 967925, postTokens: 11687,
    preservedSegment: { headUuid: kept[0], anchorUuid: 's1', tailUuid: kept.at(-1) },
    preservedMessages: { anchorUuid: 's1', uuids: kept, allUuids: kept } } });
const summary = (uuid, parentUuid) => ({ ...base, type: 'user', uuid, parentUuid, isCompactSummary: true,
  isVisibleInTranscriptOnly: true, message: { role: 'user', content: 'Summary.' } });

async function one(rows) {
  const dir = await mkdtemp(join(tmpdir(), 'd127-a19-'));
  const f = join(dir, 'r.jsonl');
  await writeFile(f, rows.map((r) => JSON.stringify(r)).join('\n') + '\n');
  return { dir, f };
}

/** A resumed recording: the boundary, the summary, the kept message and answer (copies), the files Claude Code restores
 *  for the kept message (chained to it), then a new message of the person's with a file they attach. */
const resumed = () => [
  boundary('b1', 'k2', ['k1', 'k2']), summary('s1', 'b1'),
  human('k1', 's1', 'Please review the plan in the notes.'), said('k2', 'k1', 'Reading it.'),
  file('f1', 'k1', 'notes/plan.md'), file('f2', 'f1', 'memory/MEMORY.md'),
  human('n1', 'k2', 'Now apply it to the parser.'), file('f3', 'n1', 'src/parser.js'),
];

test('A19: files restored for a message the compaction kept are the harness\'s; a file you attach later is yours',
  async () => {
    const { dir, f } = await one(resumed());
    try {
      const { records, meta } = await readSession(f, {});
      const attached = records.filter((r) => r.kind === ATTACHED_RECORD).map((r) => r.raw.uuid);
      assert.deepEqual(attached, ['f3']);
      const restored = meta.labelled.filter((c) => c.value?.basis === 'compaction_restored').map((c) => c.uuid);
      assert.deepEqual(restored, ['f1', 'f2']);
      assert.ok(meta.labelled.filter((c) => restored.includes(c.uuid)).every((c) => c.value.label === 'harness'
        && !c.value.gap && !c.value.markers?.length));
      const ledger = await sliceLineage([f]);
      assert.deepEqual(ledger.interjections.map((x) => [x.kind, x.text]),
        [[INTERJECTION_KINDS.attached, 'contents of src/parser.js']]);
      // The asks are unchanged: the kept message (read here, in a recording read alone) and the new one.
      assert.deepEqual(ledger.ask.map((a) => a.text), ['Please review the plan in the notes.', 'Now apply it to the parser.']);
      // Counted as harness context, never as a loss.
      assert.equal(ledger.capture.labels.human, 3);
    } finally { await rm(dir, { recursive: true, force: true }); }
  });

test('A19: only a message that the latest compaction lists as kept; before any compaction a file stays yours', async () => {
  // The same chain with a boundary that lists another message: the files stay the person's.
  const rows = resumed().map((r) => (r.uuid === 'b1' ? boundary('b1', 'k2', ['zz']) : r));
  let { dir, f } = await one(rows);
  try {
    const { records } = await readSession(f, {});
    assert.deepEqual(records.filter((r) => r.kind === ATTACHED_RECORD).map((r) => r.raw.uuid), ['f1', 'f2', 'f3']);
  } finally { await rm(dir, { recursive: true, force: true }); }
  // A recording with no compaction: an @-mention is the person's.
  ({ dir, f } = await one([human('k1', null, 'Please review the plan in the notes.'), file('f1', 'k1', 'notes/plan.md'),
    said('k2', 'f1', 'Reading it.')]));
  try {
    const { records } = await readSession(f, {});
    assert.deepEqual(records.filter((r) => r.kind === ATTACHED_RECORD).map((r) => r.raw.uuid), ['f1']);
  } finally { await rm(dir, { recursive: true, force: true }); }
  // In the recording where the compaction happened, a file attached with a message before the compaction stays the
  // person's: the compaction is recorded after it.
  ({ dir, f } = await one([human('k1', null, 'Please review the plan in the notes.'), file('f1', 'k1', 'notes/plan.md'),
    said('k2', 'f1', 'Reading it.'), boundary('b1', 'k2', ['k1', 'k2']), summary('s1', 'b1'),
    human('n1', 's1', 'Now apply it.')]));
  try {
    const { records } = await readSession(f, {});
    assert.deepEqual(records.filter((r) => r.kind === ATTACHED_RECORD).map((r) => r.raw.uuid), ['f1']);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('A19 (D134): a message either kept list names is kept; the two lists are read apart', async () => {
  // Claude Code's boundary row lists the kept messages twice: `uuids` and `allUuids`. Here they differ, so a reader that
  // reads only one of them labels the restored files differently.
  const lists = (uuids, allUuids) => resumed().map((r) => {
    if (r.uuid !== 'b1') return r;
    const b = boundary('b1', 'k2', ['k1', 'k2']);
    return { ...b, compactMetadata: { ...b.compactMetadata,
      preservedMessages: { ...b.compactMetadata.preservedMessages, uuids, allUuids } } };
  });
  for (const [uuids, allUuids] of [[['k2'], ['k1', 'k2']], [['k1', 'k2'], ['k2']], [['k1'], []], [[], ['k1']]]) {
    const { dir, f } = await one(lists(uuids, allUuids));
    try {
      const { records, meta } = await readSession(f, {});
      assert.deepEqual(records.filter((r) => r.kind === ATTACHED_RECORD).map((r) => r.raw.uuid), ['f3'],
        JSON.stringify({ uuids, allUuids }));
      assert.deepEqual(meta.labelled.filter((c) => c.value?.basis === 'compaction_restored').map((c) => c.uuid),
        ['f1', 'f2']);
    } finally { await rm(dir, { recursive: true, force: true }); }
  }
  // Neither list names k1: its files stay the person's.
  const { dir, f } = await one(lists(['k2'], ['k2']));
  try {
    const { records } = await readSession(f, {});
    assert.deepEqual(records.filter((r) => r.kind === ATTACHED_RECORD).map((r) => r.raw.uuid), ['f1', 'f2', 'f3']);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
