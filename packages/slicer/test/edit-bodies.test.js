// B1b/F67 + F69 — the slicer's side of an Edit's own text, and a deletion's prior state.
//
// The `Edit` tool call names `old_string`/`new_string`, not a whole body, so before B1b the
// slicer kept a diff of them and nothing quotable. This file pins WHAT the slicer records; the
// adapter's placement of it is pinned in packages/evidence/test/write-bodies.test.js.
//
// Every fixture is synthetic. No real recording is read and no session text is printed.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { buildEvents, ARG_SEP } from '../src/events.js';
import * as before from '../src/before.js';
import { sliceLineage, tokensOf } from '../index.js';
import { redact } from '../../redact/index.js';
import { session, toJsonl } from '../../golden/index.js';
import { scratchDir } from './scratch-dir.js';

const { attachBefore } = before;

// ---- synthetic records ---------------------------------------------------------------
let seq = 0;
const uid = () => `f67-${String(++seq).padStart(6, '0')}`;
const base = { sessionId: 'sess-f67', cwd: '/repo', version: '2.1.205', isSidechain: false };
const userTurn = (text) => ({ ...base, type: 'user', uuid: uid(), message: { role: 'user', content: text } });
const toolUse = (id, name, input) => ({ ...base, type: 'assistant', uuid: uid(),
  message: { role: 'assistant', content: [{ type: 'tool_use', id, name, input }] } });
const toolResult = (id, content) => ({ ...base, type: 'user', uuid: uid(),
  message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content }] } });

const records = (raw) => raw.map((r, i) => ({ kind: r.type, raw: r, line: i + 1, source: 0 }));
const build = (raw, cwd = '/repo') => buildEvents(records(raw), { cwd }).events;

const writeEvents = (events) => events.filter((e) => e.kind === 'edit' || e.kind === 'create');
/** D68 (E): the slicer keeps a body whole and redaction scrubs it whole; nothing cuts it. */
const redacted = (events) => redact({ ask: [], ledger: events, claim: { finalMessage: '' } }).ledger.ledger;

// ---- F67: the written text is recorded ------------------------------------------------

test('F67 an Edit records what it wrote and what it replaced, both quotable, diff unchanged', () => {
  const OLD = 'function rate() {\n  return 0.2;   // OLD_MARKER\n}';
  const NEW = 'function rate() {\n  return 0.25;  // NEW_MARKER\n}';
  const events = build([
    userTurn('raise the rate'),
    toolUse('e1', 'Edit', { file_path: '/repo/src/rate.js', old_string: OLD, new_string: NEW }),
    toolResult('e1', 'The file has been updated.'),
  ]);
  const [edit] = writeEvents(events);
  assert.equal(edit.kind, 'edit');
  // The written segment comes FIRST: it is the point of the channel and must survive the cap.
  assert.equal(edit.after.text, `${NEW}${ARG_SEP}${OLD}`);
  assert.equal(edit.after.parts, 1, 'one edit entry');
  assert.equal(edit.after.priorParts, 1, 'and its replaced text');
  assert.equal(edit.after.truncated, false);
  assert.ok(typeof edit.diff === 'string' && edit.diff.length, 'the diff the slicer already produced stays');
});

test('F67 a MultiEdit records every entry, written segments first, in order', () => {
  const entries = [
    { old_string: 'const A = 1;', new_string: 'const A = 11;' },
    { old_string: 'const B = 2;', new_string: 'const B = 22;' },
    { old_string: 'const C = 3;', new_string: 'const C = 33;' },
  ];
  const events = build([
    userTurn('bump the constants'),
    toolUse('m1', 'MultiEdit', { file_path: '/repo/src/k.js', edits: entries }),
    toolResult('m1', 'Applied 3 edits.'),
  ]);
  const [edit] = writeEvents(events);
  assert.equal(edit.after.parts, 3);
  assert.equal(edit.after.priorParts, 3);
  assert.deepEqual(edit.after.text.split(ARG_SEP),
    [...entries.map((e) => e.new_string), ...entries.map((e) => e.old_string)]);
});

test('F67 replace_all is declared per entry, and the body is the written text once', () => {
  const events = build([
    userTurn('rename it everywhere'),
    toolUse('e1', 'Edit', { file_path: '/repo/src/n.js', old_string: 'oldName', new_string: 'newName', replace_all: true }),
    toolResult('e1', 'The file has been updated.'),
  ]);
  const [edit] = writeEvents(events);
  assert.deepEqual(edit.after.replaceAll, [true]);
  assert.equal(edit.after.text, `newName${ARG_SEP}oldName`);
});

test('F67 a Write still records its whole body and declares no edit parts', () => {
  const events = build([
    userTurn('add the module'),
    toolUse('w1', 'Write', { file_path: '/repo/src/w.js', content: 'export const x = 1;\n' }),
    toolResult('w1', 'File created successfully'),
  ]);
  const [write] = writeEvents(events);
  assert.equal(write.after.text, 'export const x = 1;\n');
  assert.equal(write.after.parts, undefined, 'a whole-file body has no parts to split');
});

test('D68 (E) an over-long new_string is kept whole through redaction, its replaced side beside it', () => {
  const NEW = `${'x'.repeat(20_000)}\nTAIL_RECORDED`;
  const events = redacted(build([
    userTurn('write the big block'),
    toolUse('e1', 'Edit', { file_path: '/repo/src/big.js', old_string: 'tiny', new_string: NEW }),
    toolResult('e1', 'The file has been updated.'),
  ]));
  const [edit] = writeEvents(events);
  assert.equal(edit.after.truncated, false);
  const [written, replaced, ...rest] = edit.after.text.split(ARG_SEP);
  assert.equal(written, NEW, 'the written side is kept whole, its tail included');
  assert.equal(replaced, 'tiny');
  assert.deepEqual(rest, [], 'one written segment, one replaced, exactly as priorParts declares');
  assert.doesNotMatch(edit.after.text, /truncated at \d+ chars/);
});

// ---- D68 (E): each side of an Edit is kept whole (F155's per-side cap and F168's memory bound are gone) ----------

const segmentsOf = (edit) => edit.after.text.split(ARG_SEP);

test('F155 the slicer re-declares the recorder\'s edit separator exactly', () => {
  assert.equal(before.EDIT_SEPARATOR, ARG_SEP, 'before.js splits on the separator events.js joins with');
});

test('D68 (E) a long new_string and a long old_string are each kept whole', () => {
  const NEW = `${'n '.repeat(30_000)}NEW_TAIL_RECORDED`;
  const OLD = `${'o '.repeat(30_000)}OLD_TAIL_RECORDED`;
  const [edit] = writeEvents(redacted(build([userTurn('rewrite it'),
    toolUse('e1', 'Edit', { file_path: '/repo/src/big.js', old_string: OLD, new_string: NEW }),
    toolResult('e1', 'The file has been updated.')])));
  assert.deepEqual(segmentsOf(edit), [NEW, OLD]);
  assert.equal(edit.after.truncated, false);
  assert.equal(edit.after.priorParts, 1);
});

test('D68 (E) a MultiEdit keeps every segment whole and in its place', () => {
  const entries = [
    { old_string: 'const A = 1;', new_string: `${'a '.repeat(22_500)}A_TAIL_RECORDED` },
    { old_string: 'const B = 2;', new_string: `${'b'.repeat(12_000)}B_TAIL_RECORDED` },
    { old_string: 'const C = 3;', new_string: '' },
  ];
  const [edit] = writeEvents(redacted(build([userTurn('bump the constants'),
    toolUse('m1', 'MultiEdit', { file_path: '/repo/src/k.js', edits: entries }),
    toolResult('m1', 'Applied 3 edits.')])));
  assert.deepEqual(segmentsOf(edit), [...entries.map((x) => x.new_string), ...entries.map((x) => x.old_string)],
    'every segment keeps its place, an empty new_string stays the empty string it was (F83)');
  assert.equal(edit.after.parts, 3);
  assert.equal(edit.after.priorParts, 3);
  assert.equal(edit.after.truncated, false);
});

test('D68 (E) editText joins every written segment, then every replaced one, whole', () => {
  assert.equal(before.editText(['new'], ['old']), `new${ARG_SEP}old`);
  assert.equal(before.editText([''], ['old']), `${ARG_SEP}old`, 'an empty new_string stays empty');
  const long = 'n'.repeat(60_000);
  assert.deepEqual(before.editText([long], ['old']).split(ARG_SEP), [long, 'old'], 'no memory bound cuts a side');
  for (const name of ['retainHead', 'retainEdit', 'BEFORE_CAP']) assert.equal(name in before, false, `${name} is deleted`);
});


// ---- F69: a deletion carries the state it removed --------------------------------------

test('F69 a delete after a read carries the read body as its prior state', () => {
  const events = [
    { turn: 1, seq: 0, kind: 'read', path: 'src/gone.js', _readText: '     1\texport const gone = 1;\n' },
    { turn: 2, seq: 0, kind: 'delete', path: 'src/gone.js' },
  ];
  attachBefore(events);
  assert.equal(events[1].before.text, 'export const gone = 1;');
  assert.equal(events[1].before.source, 'read');
});

test('F69 a delete of a file this session wrote carries that whole-file body', () => {
  const events = [
    { turn: 1, seq: 0, kind: 'create', path: 'tmp/scratch.js', _body: 'const scratch = 1;\n', _writeType: 'create' },
    { turn: 2, seq: 0, kind: 'delete', path: 'tmp/scratch.js' },
  ];
  attachBefore(events);
  assert.equal(events[1].before.text, 'const scratch = 1;\n');
  assert.equal(events[1].before.source, 'write');
});

test('F69 a delete of an edit-fragment path takes the read, never an Edit fragment', () => {
  const events = [
    { turn: 1, seq: 0, kind: 'read', path: 'src/x.js', _readText: 'WHOLE FILE' },
    { turn: 1, seq: 1, kind: 'edit', path: 'src/x.js', _body: `NEW${ARG_SEP}OLD`, _editParts: 1 },
    { turn: 2, seq: 0, kind: 'delete', path: 'src/x.js' },
  ];
  attachBefore(events);
  assert.equal(events[2].before.text, 'WHOLE FILE', 'an edit fragment is not a file state');
  assert.equal(events[2].before.source, 'read');
});

test('F69 a delete with nothing recorded before it carries nothing, and never invents one', () => {
  const events = [{ turn: 1, seq: 0, kind: 'delete', path: 'src/unknown.js' }];
  attachBefore(events);
  assert.equal(events[0].before, undefined);
});

test('D90: a delete of a credential-shaped path gets the state it removed, as any delete does', () => {
  const events = [
    { turn: 1, seq: 0, kind: 'read', path: '.env', _readText: 'KEY=1' },
    { turn: 2, seq: 0, kind: 'delete', path: '.env' },
  ];
  attachBefore(events);
  assert.equal(events[1].before.withheld, undefined);
  assert.deepEqual([events[1].before.source, events[1].before.text], ['read', 'KEY=1']);
});

test('F69 the first-write rule is unchanged: a later edit of a path still gets no file state', () => {
  const events = [
    { turn: 1, seq: 0, kind: 'read', path: 'a.js', _readText: 'FIRST VERSION' },
    { turn: 1, seq: 1, kind: 'edit', path: 'a.js', _body: `N1${ARG_SEP}O1`, _editParts: 1 },
    { turn: 2, seq: 0, kind: 'edit', path: 'a.js', _body: `N2${ARG_SEP}O2`, _editParts: 1 },
  ];
  attachBefore(events);
  assert.equal(events[1].before.text, 'FIRST VERSION');
  assert.equal(events[2].before, undefined, 'the file state is recorded at the first write only');
  assert.equal(events[2].after.text, `N2${ARG_SEP}O2`, 'but the edit still carries its own text');
  assert.ok(events.every((e) => !('_editParts' in e) && !('_replaceAll' in e) && !('_body' in e)),
    'no transient field survives');
});

// ---- F83: an empty written segment is recorded as empty, not as missing -----------------------
//
// A deletion through Edit is `new_string: ''`. The recorder must keep that empty segment in its
// place — the text before the first separator — so the reader can tell "wrote nothing" from "the
// record does not carry what was written". This pins the slicer's half; the `extent` a reader
// derives from it is the adapter's (evidence/adapters/sonah-ledger.js `placeBodyParts`).

test('F83 an Edit with an empty new_string records an empty written segment, not an absent one', async () => {
  const { redact } = await import('../../redact/index.js');
  const OLD = 'export const dead = 1;\n';
  const events = build([
    userTurn('delete the dead constant'),
    toolUse('d1', 'Edit', { file_path: '/repo/src/dead.js', old_string: OLD, new_string: '' }),
    toolResult('d1', 'The file /repo/src/dead.js has been updated.'),
  ]);
  const [edit] = writeEvents(events);
  assert.equal(edit.after.parts, 1, 'the edit entry is counted');
  assert.equal(edit.after.text, `${ARG_SEP}${OLD}`, 'the written segment is present and empty');
  assert.deepEqual(edit.after.text.split(ARG_SEP), ['', OLD]);
  // Redaction runs before anything reads the field; the empty segment must survive it in place.
  const clean = redact({ ask: [], ledger: [edit], claim: {} }).ledger.ledger[0];
  assert.deepEqual(clean.after.text.split(/\n?⟪→⟫\n?/), ['', OLD]);
});

test('F83 an empty entry inside a MultiEdit keeps its position among the written segments', () => {
  const entries = [
    { old_string: 'const A = 1;', new_string: 'const A = 11;' },
    { old_string: 'const DEAD = 0;', new_string: '' },
    { old_string: 'const C = 3;', new_string: 'const C = 33;' },
  ];
  const events = build([
    userTurn('bump A and C, drop DEAD'),
    toolUse('m2', 'MultiEdit', { file_path: '/repo/src/k.js', edits: entries }),
    toolResult('m2', 'Applied 3 edits.'),
  ]);
  const [edit] = writeEvents(events);
  assert.equal(edit.after.parts, 3);
  assert.deepEqual(edit.after.text.split(ARG_SEP),
    ['const A = 11;', '', 'const C = 33;', 'const A = 1;', 'const DEAD = 0;', 'const C = 3;']);
});

// ---- F108: an empty whole-file body is recorded as empty, not as missing -----------------------
//
// `Write` with `content: ''` empties a file; a `NotebookEdit` with `new_source: ''` clears a cell.
// The record carries that emptiness exactly, so the ledger must say what the write left behind —
// nothing — rather than carry no `after` at all, which reads as "the recorder did not keep the
// body" (the same family as F83, for the whole-file channel). A write whose body is ABSENT from
// the record, and a write that failed, still carry no `after`: neither left a recorded state.

const toolError = (id, content) => ({ ...base, type: 'user', uuid: uid(),
  message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content, is_error: true }] } });
const EMPTY = Object.freeze({ text: '', truncated: false, lines: 0 });

test('F108 a Write with empty content records an empty after, not an absent one', async () => {
  const { redact } = await import('../../redact/index.js');
  const events = build([
    userTurn('empty the placeholder'),
    toolUse('w0', 'Write', { file_path: '/repo/src/placeholder.js', content: '' }),
    toolResult('w0', 'The file /repo/src/placeholder.js has been updated.'),
  ]);
  const [write] = writeEvents(events);
  assert.equal(write.kind, 'create');
  assert.deepEqual(write.after, EMPTY, 'the emptiness was recorded');
  assert.equal(write.diff, undefined, 'no diff is invented for a body with no lines');
  assert.ok(!('_body' in write), 'no transient field survives');
  // Redaction runs before anything reads the field; an empty body must survive it as empty.
  const clean = redact({ ask: [], ledger: [write], claim: {} }).ledger.ledger[0];
  assert.deepEqual(clean.after, EMPTY);
});

test('F108 a NotebookEdit that clears a cell records an empty after', () => {
  const events = build([
    userTurn('clear the scratch cell'),
    toolUse('n0', 'NotebookEdit', { notebook_path: '/repo/notes/explore.ipynb', cell_id: 'c3', new_source: '' }),
    toolResult('n0', 'Updated cell c3.'),
  ]);
  const [edit] = writeEvents(events);
  assert.equal(edit.kind, 'edit');
  assert.equal(edit.path, 'notes/explore.ipynb');
  assert.deepEqual(edit.after, EMPTY, 'a cleared cell is a recorded state');
});

test('F108 a Write whose body the record does not carry still records no after', () => {
  const events = build([
    userTurn('write it'),
    toolUse('w1', 'Write', { file_path: '/repo/src/unknown.js' }),
    toolResult('w1', 'File created successfully at: /repo/src/unknown.js'),
  ]);
  const [write] = writeEvents(events);
  assert.equal(write.after, undefined, 'absent is not empty: nothing is invented');
});

test('F108 an empty field on an MCP edit verb is not a file state, and records no after', () => {
  // Appending nothing leaves the file as it was; an empty `after` there would assert it is empty.
  const events = build([
    userTurn('append the log line'),
    toolUse('a0', 'mcp__fs__append_file', { path: '/repo/logs/run.txt', content: '' }),
    toolResult('a0', 'Appended.'),
    toolUse('c0', 'mcp__fs__write_file', { path: '/repo/logs/fresh.txt', content: '' }),
    toolResult('c0', 'Written.'),
  ]);
  const [append, create] = writeEvents(events);
  assert.equal(append.kind, 'edit');
  assert.equal(append.after, undefined, 'ambiguous evidence is recorded as nothing');
  assert.equal(create.kind, 'create');
  assert.deepEqual(create.after, EMPTY, 'a create-shaped MCP write with empty content is a recorded state');
});

test('F108 a failed empty Write carries no after, exactly as a failed non-empty one', () => {
  const events = build([
    userTurn('empty both'),
    toolUse('w2', 'Write', { file_path: '/repo/src/a.js', content: '' }),
    toolError('w2', 'Error: EACCES: permission denied'),
    toolUse('w3', 'Write', { file_path: '/repo/src/b.js', content: 'export const b = 1;\n' }),
    toolError('w3', 'Error: EACCES: permission denied'),
  ]);
  const failed = events.filter((e) => e.attempted === 'create');
  assert.deepEqual(failed.map((e) => e.path), ['src/a.js', 'src/b.js']);
  assert.ok(failed.every((e) => e.kind === 'error' && e.after === undefined),
    'a write that failed left no state behind, whatever its body was');
});

// Kept from the legacy compiler's s1-precision.test.js (removed with the compiler): the after view is redacted, and it is
// not counted in the size `sonah slice` prints.
test('D90: the after-state is kept as recorded, like the pre-edit view, and never moves size routing', async () => {
  const dir = await scratchDir('sonah-s1b-sec-');
  const file = join(dir, 's.jsonl');
  await writeFile(file, `${toJsonl(session({ cwd: '/repo' })
    .ask('Add the key.')
    .create('config.py', 'AWS_SECRET_ACCESS_KEY = "AKIAIOSFODNN7EXAMPLE9Zx1"\n')
    .say('Done.').done())}\n`);
  const raw = await sliceLineage([file]);
  const { ledger } = redact(raw);
  const w = (ledger.ledger ?? []).find((e) => e.kind === 'create');
  assert.equal(w.after?.text, 'AWS_SECRET_ACCESS_KEY = "AKIAIOSFODNN7EXAMPLE9Zx1"\n', 'the after view, as written');
  const stripped = { ...ledger, ledger: ledger.ledger.map((e) => { const { after, ...rest } = e; return rest; }) };
  assert.equal(tokensOf(ledger), tokensOf(stripped), 'the after view is opt-in content, not judged size');
});
