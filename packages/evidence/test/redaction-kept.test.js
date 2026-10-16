// W3e-1 — what redaction did not redact reaches the reviewer as written, and what the redactor
// wrote is never the session's text.
//
//   F186  a backslash-continued line is kept as written, so a verbatim quote of it grounds.
//   F184  the redactor's dropped-lines note is never inside a quotable span and never part of an
//         edit side: it used to land at the end of the field, inside the LAST replaced side.
//   F185  a key block cut by the recorder cap ends where the recorded text ends, so the stub, the
//         separator and the replaced side survive; a side redaction removed entirely says so
//         (`priorState: 'redacted'`) instead of claiming the record had none.
//
// The production raw path (a synthetic .jsonl on disk -> analyze() -> sessionFromLedger) runs
// wherever the recorder's own shape or cap is part of the case. D90 (owner decision 2026-10-15, privacy is not a design
// constraint): no Sonah drops or masks a line now, so F184 and F185 read hand-built ledgers literally as an earlier
// Sonah's redactor wrote them (its note in place of the lines it dropped, its counts), through today's `redact()`.
// Every fixture is synthetic; secret-shaped values are assembled at run time. No real recording is read and no session
// text is printed.

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { analyze } from '../../cli/index.js';
import { redact } from '../../redact/index.js';
import { ARG_SEP } from '../../slicer/src/events.js';
/** The body cap an earlier Sonah cut at (M33 R to D68 E): its stub stands only in a persisted ledger. */
const BEFORE_CAP = 20_000;
import { sessionFromLedger, PRIOR_STATE } from '../adapters/sonah-ledger.js';
import { verifyReceipt } from '../src/session.js';

const quotable = (session, id, quote) => verifyReceipt(session, { eventId: id, role: 'code', quote }).ok;

// ---- production raw path ------------------------------------------------------------------------
let seq = 0;
const uid = () => `w3e1-${String(++seq).padStart(6, '0')}`;
const base = { sessionId: 'sess-w3e1', cwd: '/repo', version: '2.1.205', gitBranch: 'main', isSidechain: false };
const userTurn = (text) => ({ ...base, type: 'user', uuid: uid(), message: { role: 'user', content: text } });
const toolUse = (id, name, input) => ({ ...base, type: 'assistant', uuid: uid(),
  message: { role: 'assistant', content: [{ type: 'tool_use', id, name, input }] } });
const toolResult = (id, content) => ({ ...base, type: 'user', uuid: uid(),
  message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content }] } });
const rawEdit = (id, path, oldString, newString) => [
  toolUse(id, 'Edit', { file_path: path, old_string: oldString, new_string: newString }),
  toolResult(id, 'The file has been updated successfully.'),
];

async function throughProductionPath(records) {
  const dir = await mkdtemp(join(tmpdir(), 'w3e1-'));
  const file = join(dir, 'session.jsonl');
  await writeFile(file, records.map((r) => JSON.stringify(r)).join('\n') + '\n');
  try {
    const { ledger } = await analyze([file]);
    const session = sessionFromLedger(ledger, { sessionKey: 'w3e1' });
    const found = session.events.filter((e) => e.kind === 'invocation' && e.operation !== 'command' && e.operation !== 'delegate');
    assert.equal(found.length, 1, 'premise: one write in the session');
    return { ledger, session, write: found[0] };
  } finally { await rm(dir, { recursive: true, force: true }); }
}

// ---- F186: a continued line is kept as written --------------------------------------------------

test('F186 an edit whose written text ends in a backslash keeps it, and a quote across a continuation grounds', async () => {
  const NEW = ['exec node server.js \\', '  --port 8080 \\'].join('\n');
  const OLD = 'exec node server.js   # W3E1_OLD_START';
  const { session, write } = await throughProductionPath([userTurn('pass the port'),
    ...rawEdit('e1', '/repo/scripts/start.sh', OLD, NEW)]);
  const [change] = write.changes;
  assert.equal(session.textOf(change, 'after'), NEW, 'the written side, byte for byte');
  assert.equal(session.textOf(change, 'before'), OLD, 'the replaced side, byte for byte');
  assert.ok(quotable(session, write.id, 'server.js \\\n  --port 8080 \\'), 'the session\'s own bytes ground');
});

test('F186 a whole-file write of a continued shell command is quotable exactly as the session wrote it', async () => {
  const BODY = ['#!/bin/sh', 'docker run --rm \\', '  --volume "./src:/work/src" \\', '  node:20 npm test', ''].join('\n');
  const { session, write } = await throughProductionPath([userTurn('add the test script'),
    toolUse('w1', 'Write', { file_path: '/repo/scripts/test.sh', content: BODY }), toolResult('w1', 'File created successfully')]);
  const [change] = write.changes;
  assert.equal(session.textOf(change, 'after'), BODY);
  assert.equal(change.extent.lines, BODY.split('\n').length, 'the extent counts the lines as written');
  assert.ok(quotable(session, write.id, 'docker run --rm \\\n  --volume'));
});

// ---- F184: the redactor's note is not the session's text ----------------------------------------

const NOTE_QUOTES = ['line(s) dropped: unclassified', 'unclassified high-entropy content', '[… 1 line(s) dropped'];

/** Hand-built ledger events, as an earlier Sonah's redactor left them, through today's redactor and the adapter. */
function reviewed(events) {
  const { ledger } = redact({ ask: [{ turn: 1, text: 'change the key loader' }], ledger: events,
    claim: { finalMessage: '' }, dropped: [] });
  const session = sessionFromLedger(ledger, { sessionKey: 'w3e1' });
  return { ledger, session, write: session.events.find((e) => e.id === 'A1-0') };
}
const editOf = (segments, over = {}) => {
  const text = segments.join(ARG_SEP);
  return { turn: 1, seq: 0, kind: 'edit', path: 'src/keys.js', ...over,
    after: { text, truncated: false, lines: text.split('\n').length, parts: segments.length / 2,
      priorParts: segments.length / 2, ...over.after } };
};
/** The notes that redactor wrote in place of the lines it dropped. */
const ENTROPY_NOTE = '[… 1 line(s) dropped: unclassified high-entropy content …]';
const KEY_NOTE = (n) => `[… ${n} line(s) dropped: private key block …]`;
/** What that redactor declared on an event whose text it dropped `n` lines of. */
const dropped = (n, after = {}) => ({ redacted: true, after: { redactedLines: n, ...after } });
const noteIsRejected = (session, id) => {
  for (const quote of NOTE_QUOTES)
    assert.equal(quotable(session, id, quote), false, `the redactor's note is not quotable: ${JSON.stringify(quote)}`);
};

test('F184 an edit whose written side lost a line: the replaced side is exactly the replaced text', () => {
  // The written side's middle line, a high-entropy blob, was dropped by that redactor.
  const WRITTEN = ['const seed = loadSeed();', ENTROPY_NOTE, 'export default seed;'].join('\n');
  const OLD = 'const seed = null;   // W3E1_REPLACED';
  const { session, write } = reviewed([editOf([WRITTEN, OLD], dropped(1))]);
  const [change] = write.changes;
  assert.equal(session.textOf(change, 'before'), OLD, 'nothing of the redactor\'s is in the replaced side');
  assert.equal(change.beforeExtent.chars, OLD.length);
  assert.equal(session.textOf(change, 'after'), 'const seed = loadSeed();\nexport default seed;');
  assert.equal(change.extent.redactedLines, 1, 'the drop is declared on the extent');
  assert.equal(change.redacted, true);
  assert.equal(change.extent.priorState, 'edit-text');
  assert.ok(quotable(session, write.id, 'W3E1_REPLACED'));
  noteIsRejected(session, write.id);
});

test('F184 an edit whose replaced side lost a line: the note is not counted as replaced text', () => {
  const OLD = ['const seed = null;', ENTROPY_NOTE, '// W3E1_OLD_TAIL'].join('\n');
  const { session, write } = reviewed([editOf(['const seed = loadSeed();', OLD], dropped(1))]);
  const [change] = write.changes;
  assert.equal(session.textOf(change, 'before'), 'const seed = null;\n// W3E1_OLD_TAIL');
  assert.equal(change.beforeExtent.lines, 2, 'the note is not a line of the replaced side');
  assert.equal(change.extent.priorState, 'edit-text');
  noteIsRejected(session, write.id);
});

test('F184 a whole-file body and a file state that lost a line: the note is neither code nor counted', () => {
  const BODY = ['export const a = 1;', ENTROPY_NOTE, 'export const b = 2;'].join('\n');
  const FILE = ['export const a = 0;', ENTROPY_NOTE].join('\n');
  const { session, write } = reviewed([{ turn: 1, seq: 0, kind: 'create', path: 'src/seed.js', redacted: true,
    after: { text: BODY, truncated: false, lines: 3, redactedLines: 1 } },
  { turn: 1, seq: 1, kind: 'edit', path: 'src/file.js', redacted: true,
    before: { text: FILE, source: 'read', turn: 1, partial: false, truncated: false, lines: 2, redactedLines: 1 },
    after: { text: `export const a = 1;${ARG_SEP}export const a = 0;`, truncated: false, lines: 3, parts: 1, priorParts: 1 } }]);
  const [created] = write.changes;
  assert.equal(session.textOf(created, 'after'), 'export const a = 1;\nexport const b = 2;');
  assert.equal(created.extent.lines, 2);
  assert.equal(created.extent.redactedLines, 1);
  noteIsRejected(session, write.id);
  const edit = session.events.find((e) => e.id === 'A1-1');
  const [first] = edit.changes;
  assert.equal(first.extent.priorState, 'first-write');
  assert.equal(session.textOf(first, 'before'), 'export const a = 0;');
  assert.equal(first.beforeExtent.redactedLines, 1);
  noteIsRejected(session, edit.id);
});

test('F184 a MultiEdit: each segment\'s drops stay in that segment, and no replaced side carries a note', () => {
  const { session, write } = reviewed([editOf(['one();', ENTROPY_NOTE, 'old one', 'old two'], dropped(1))]);
  assert.equal(write.changes.length, 2);
  assert.equal(session.textOf(write.changes[0], 'before'), 'old one');
  assert.equal(session.textOf(write.changes[1], 'before'), 'old two');
  assert.equal(session.textOf(write.changes[1], 'after'), '', 'the written segment redaction emptied is empty');
  assert.equal(write.changes[1].extent.recorded, true);
  assert.equal(write.changes[1].extent.redactedLines, 1);
  noteIsRejected(session, write.id);
});

// ---- F185: a cut key block ends where the record ends; a redacted side says so ------------------

const STUB_QUOTES = [`truncated at ${BEFORE_CAP} chars`, `[… truncated at ${BEFORE_CAP}`];
const BEGIN = ['-----BEGIN', 'RSA', 'PRIVATE', 'KEY-----'].join(' ');
const END = ['-----END', 'RSA', 'PRIVATE', 'KEY-----'].join(' ');
const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const keyLine = (i) => Array.from({ length: 64 }, (_, k) => B64[(i * 29 + k * 37 + ((k * k) % 11)) % 64]).join('');
const keyBody = (n) => Array.from({ length: n }, (_, i) => keyLine(i));
const KEY = (n = 3) => [BEGIN, ...keyBody(n), END].join('\n');
const noKeyMaterial = (session) => Object.values(session.blobs)
  .every((b) => !b.includes(BEGIN) && keyBody(250).every((l) => !b.includes(l.slice(0, 32))));

// D90 (owner decision 2026-10-15, privacy is not a design constraint): the production path (`analyze`, what `sonah
// slice` prints, as a review loads) masks and drops nothing, so a key block the agent wrote is kept whole as written;
// the hand-built ledgers below still pass the redactor, which declares its drops as before.

test('F185, D90 a key block across the retired review cap is kept whole: nothing of it is cut or dropped', async () => {
  const NEW = ['const key = `', BEGIN, ...keyBody(400), END, '`;'].join('\n');
  assert.ok(NEW.indexOf(END) > BEFORE_CAP, 'premise: the old cap, made before redaction, cut inside the key body');
  const OLD = 'const key = loadKey();   // W3E1_OLD_LOADER';
  const { ledger, session, write } = await throughProductionPath([userTurn('inline the key'),
    ...rawEdit('e1', '/repo/src/keys.js', OLD, NEW)]);
  const recorded = ledger.ledger.find((e) => e.kind === 'edit').after.text;
  assert.equal(recorded.includes('truncated at'), false, 'nothing is cut');
  assert.ok(recorded.endsWith(`${ARG_SEP}${OLD}`), 'and the replaced side is whole');
  const [change] = write.changes;
  assert.equal(change.extent.truncated, false);
  assert.equal(session.textOf(change, 'after'), NEW, 'the written side as written, the key block included');
  assert.ok(!(change.extent.redactedLines > 0), 'no line is dropped');
  assert.ok(quotable(session, write.id, keyLine(399)), 'the block\'s last line grounds a quote');
});

test('F185, D68 (E), D90 a key block past the retired memory bound is kept whole, with its separator and its replaced side', async () => {
  const NEW = ['const key = `', BEGIN, ...keyBody(700), END, '`;'].join('\n');
  assert.ok(NEW.indexOf(END) > 2 * BEFORE_CAP, 'premise: the retired memory bound cut inside the key body');
  const OLD = 'const key = loadKey();   // W3E1_OLD_LOADER';
  const { ledger, session, write } = await throughProductionPath([userTurn('inline the key'),
    ...rawEdit('e1', '/repo/src/keys.js', OLD, NEW)]);
  const recorded = ledger.ledger.find((e) => e.kind === 'edit').after.text;
  assert.equal(recorded.includes('truncated at'), false, 'no stub: nothing cuts a body');
  assert.ok(recorded.endsWith(`${ARG_SEP}${OLD}`), 'the replaced side, whole');

  const [change] = write.changes;
  assert.equal(change.extent.truncated, false);
  assert.equal(session.textOf(change, 'after'), NEW, 'the written side as written, the key block included');
  assert.ok(!(change.extent.redactedLines > 0), 'no line is dropped');
  assert.equal(change.extent.priorState, 'edit-text', 'the replaced side is the record\'s, not "none"');
  assert.equal(session.textOf(change, 'before'), OLD);
  assert.equal(change.beforeExtent.truncated, false);
  assert.ok(quotable(session, write.id, 'W3E1_OLD_LOADER'), 'the replaced text is quotable');
});

test('F185, D90 an edit whose replaced side is entirely a key keeps that key as its replaced side', async () => {
  const { session, write } = await throughProductionPath([userTurn('load the key from disk'),
    ...rawEdit('e1', '/repo/src/keys.js', KEY(), 'const key = loadKey();')]);
  const [change] = write.changes;
  assert.equal(change.extent.priorState, 'edit-text');
  assert.equal(session.textOf(change, 'before'), KEY(), 'the replaced side as recorded');
  assert.notEqual(change.redacted, true);
  assert.equal(session.textOf(change, 'after'), 'const key = loadKey();');
});

test('F185 a MultiEdit: only the segment redaction emptied is declared redacted', () => {
  const { session, write } = reviewed([editOf(['a();', 'b();', 'old a', KEY_NOTE(4)], dropped(4, { lines: 10 }))]);
  assert.deepEqual(write.changes.map((c) => c.extent.priorState), ['edit-text', 'redacted']);
  assert.equal(session.textOf(write.changes[0], 'before'), 'old a');
  assert.ok(noKeyMaterial(session));
});

test('F185 a replaced side the record kept empty is still an empty edit text, whatever else was redacted', () => {
  // The redactor declares its drops per segment, so an empty old_string is never mistaken for a
  // side redaction removed.
  const { session, write } = reviewed([editOf([['header();', ENTROPY_NOTE].join('\n'), ''], dropped(1))]);
  const [change] = write.changes;
  assert.equal(change.extent.redactedLines, 1, 'premise: redaction dropped a line from this field');
  assert.equal(change.extent.priorState, 'edit-text');
  assert.equal(session.textOf(change, 'before'), '');
  assert.equal(change.beforeExtent.recorded, true);
});

test('F185 a stub-alone segment past the budget is a cut, not a redaction', () => {
  const STUB = `\n[… truncated at ${BEFORE_CAP} chars …]`;
  const { write } = reviewed([editOf([`${'a'.repeat(20)}${STUB}`, STUB, 'old a', STUB], { after: { truncated: true } })]);
  assert.deepEqual(write.changes.map((c) => c.extent.priorState), ['edit-text', 'edit-text']);
  assert.equal(write.changes[1].beforeExtent.truncated, true);
});

test('F185 every prior-state reason the adapter emits is a member of its one closed set', () => {
  assert.ok(Object.isFrozen(PRIOR_STATE));
  const members = new Set(Object.values(PRIOR_STATE));
  assert.ok(members.has('redacted'), 'the new reason is declared where the others are');
  const { session } = reviewed([
    editOf(['a();', 'old a']),                                                       // edit-text
    { ...editOf(['a();', KEY_NOTE(3)], dropped(3, { lines: 5 })), seq: 1 },               // redacted
    { turn: 1, seq: 2, kind: 'create', path: 'src/new.js', after: { text: 'x', truncated: false, lines: 1 } }, // none
    { turn: 1, seq: 3, kind: 'edit', path: 'src/old.js', after: { text: `b();${ARG_SEP}old b`, truncated: false, lines: 3, parts: 1, priorParts: 1 },
      before: { text: 'old b', source: 'read', turn: 1, partial: false, truncated: false, lines: 1 } }, // first-write
    { turn: 1, seq: 4, kind: 'delete', path: 'src/gone.js',
      before: { text: 'gone', source: 'write', turn: 1, partial: false, truncated: false, lines: 1 } }, // deleted-state
  ]);
  const emitted = session.events.flatMap((e) => (e.changes ?? []).map((c) => c.extent.priorState));
  assert.deepEqual([...new Set(emitted)].sort(), [...members].sort(), 'premise: every reason is exercised');
  for (const reason of emitted) assert.ok(members.has(reason), `${reason} is not a declared prior-state reason`);
});
