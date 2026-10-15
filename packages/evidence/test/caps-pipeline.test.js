// W3d-6 — a capped edit keeps both sides and its stub through the whole pipeline.
//
// D68 (E) (owner decision 2026-10-07): no Sonah cuts a body any more (the slicer's memory bound and redaction's body cap
// are deleted). The production path now keeps every side whole; a ledger an earlier Sonah persisted with its stub is
// still read as it was written (`persistedCut` rebuilds one), and its stub is never quotable.
//
// F155 made the slicer cap an Edit's written and replaced sides separately. These tests run the
// PRODUCTION raw path — a synthetic .jsonl on disk -> analyze() (slice + redact) ->
// sessionFromLedger — because each defect here lives between two stages: the slicer's transient
// retention cap in front of F155's cap (F168), and redaction behind it (F169).
//
// Every fixture is synthetic. No real recording is read and no session text is printed.

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { analyze } from '../../cli/index.js';
import { ARG_SEP } from '../../slicer/src/events.js';

/** The body cap an earlier Sonah cut at (M33 R to D68 E): its stub stands only in a persisted ledger. */
const BEFORE_CAP = 20_000;
const STUB = `\n[… truncated at ${BEFORE_CAP} chars …]`;
/** A redacted ledger as an earlier Sonah persisted it: the first written segment of the `kind` write cut at the cap. */
function persistedCut(ledger, kind) {
  const out = structuredClone(ledger);
  const e = out.ledger.find((x) => x.kind === kind);
  const [written, ...rest] = e.after.text.split(ARG_SEP);
  e.after.text = [`${written.slice(0, BEFORE_CAP)}${STUB}`, ...rest].join(ARG_SEP);
  e.after.truncated = true;
  return out;
}
import { sessionFromLedger } from '../adapters/sonah-ledger.js';
import { verifyReceipt } from '../src/session.js';
import { redact } from '../../redact/index.js';

// ---- synthetic raw recording builders ------------------------------------------------
let seq = 0;
const uid = () => `w3d6-${String(++seq).padStart(6, '0')}`;
const base = { sessionId: 'sess-w3d6', cwd: '/repo', version: '2.1.205', gitBranch: 'main', isSidechain: false };
const userTurn = (text) => ({ ...base, type: 'user', uuid: uid(), message: { role: 'user', content: text } });
const toolUse = (id, name, input) => ({ ...base, type: 'assistant', uuid: uid(),
  message: { role: 'assistant', content: [{ type: 'tool_use', id, name, input }] } });
const toolResult = (id, content) => ({ ...base, type: 'user', uuid: uid(),
  message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content }] } });
const editOf = (id, path, oldString, newString) => [
  toolUse(id, 'Edit', { file_path: path, old_string: oldString, new_string: newString }),
  toolResult(id, 'The file has been updated successfully.'),
];

async function throughProductionPath(records) {
  const dir = await mkdtemp(join(tmpdir(), 'w3d6-'));
  const file = join(dir, 'session.jsonl');
  await writeFile(file, records.map((r) => JSON.stringify(r)).join('\n') + '\n');
  try {
    const { ledger } = await analyze([file]);
    return { ledger, session: sessionFromLedger(ledger, { sessionKey: 'w3d6' }) };
  } finally { await rm(dir, { recursive: true, force: true }); }
}

const onlyWrite = (session) => {
  const found = session.events.filter((e) => e.kind === 'invocation'
    && e.operation !== 'command' && e.operation !== 'delegate');
  assert.equal(found.length, 1, 'premise: one write in the session');
  return found[0];
};

// ---- F168: the retention cap keeps both sides ----------------------------------------

test('W3d-6 F168, D68 (E) a 60,000-char new_string and its 50-char replaced side are both kept whole', async () => {
  const NEW = `${'n '.repeat(30_000)}W3D6_NEW_TAIL_RECORDED`;
  const OLD = `const rate = 0.2;   // W3D6_REPLACED_${'r'.repeat(13)}`;
  assert.equal(OLD.length, 50, 'premise: a 50-char old_string');
  const { ledger, session } = await throughProductionPath([
    userTurn('rewrite the rate block'), ...editOf('e1', '/repo/src/rate.js', OLD, NEW),
  ]);
  const recorded = ledger.ledger.find((e) => e.kind === 'edit');
  assert.ok(recorded.after.text.includes('\n⟪→⟫\n'), 'the separator survives slicing and redaction');

  const edit = onlyWrite(session);
  assert.equal(edit.changes.length, 1);
  const [change] = edit.changes;
  assert.equal(change.extent.truncated, false, 'the written side is whole');
  assert.equal(session.textOf(change, 'after'), NEW, 'verbatim, its tail included');
  assert.equal(change.extent.priorState, 'edit-text', 'the before side is the replaced text');
  assert.equal(change.beforeExtent.truncated, false, 'the replaced side is declared whole');
  assert.equal(session.textOf(change, 'before'), OLD, 'and it is whole');
  assert.ok(verifyReceipt(session, { eventId: edit.id, role: 'code', quote: 'W3D6_NEW_TAIL_RECORDED' }).ok);
  assert.ok(verifyReceipt(session, { eventId: edit.id, role: 'code', quote: 'W3D6_REPLACED_' }).ok,
    'the replaced text is quotable');
});

// ---- F169: redaction never swallows a stub; the adapter recognises what the recorder declared ----

const STUB_QUOTES = [`truncated at ${BEFORE_CAP} chars`, `[… truncated at ${BEFORE_CAP}`];
const stubIsRejected = (session, id) => {
  for (const quote of STUB_QUOTES)
    assert.equal(verifyReceipt(session, { eventId: id, role: 'code', quote }).ok, false,
      `a receipt quoting the recorder's stub is rejected: ${JSON.stringify(quote)}`);
};
/** A kept head of exactly BEFORE_CAP chars ending in a shell line continuation, then more. */
const continuedPastTheCap = () => {
  const lines = Array.from({ length: 2_000 }, (_, i) => `  --step-${i} \\`).join('\n');
  return `${lines.slice(0, BEFORE_CAP - 2)} \\\n  --W3D6_TAIL_NEVER_RECORDED`;
};

test('W3d-6 F169 an edit cut after a backslash keeps its stub: the written side is cut, the stub unquotable', async () => {
  const NEW = continuedPastTheCap();
  assert.equal(NEW[BEFORE_CAP - 1], '\\', 'premise: the kept text ends in a backslash');
  const OLD = 'run --old-flags   # W3D6_OLD_FLAGS';
  const { ledger: whole } = await throughProductionPath([
    userTurn('rewrite the run script'), ...editOf('e1', '/repo/scripts/run.sh', OLD, NEW),
  ]);
  assert.equal(whole.ledger.find((e) => e.kind === 'edit').after.text.includes('truncated at'), false,
    'D68 (E): the production path writes no stub');
  // A ledger an earlier Sonah persisted, cut after the backslash: redaction keeps its stub on a line of its own.
  const ledger = redact({ ...persistedCut(whole, 'edit'), dropped: [] }).ledger;
  const session = sessionFromLedger(ledger, { sessionKey: 'w3d6' });
  const recorded = ledger.ledger.find((e) => e.kind === 'edit');
  assert.match(recorded.after.text, new RegExp(`\\n\\[… truncated at ${BEFORE_CAP} chars …\\]`),
    'after redaction the stub still matches with its leading newline');
  const edit = onlyWrite(session);
  const [change] = edit.changes;
  assert.equal(change.extent.truncated, true, 'the adapter marks the written segment cut');
  assert.equal(change.extent.cap, BEFORE_CAP);
  assert.equal(change.beforeExtent.truncated, false, 'the replaced side is whole');
  assert.equal(session.textOf(change, 'before'), OLD);
  assert.ok(!session.textOf(change, 'after').includes('truncated at'), 'the stub is not in the written text');
  stubIsRejected(session, edit.id);
});

test('W3d-6 F169 a whole-file write cut after a backslash keeps its stub and its cap', async () => {
  const { ledger: whole } = await throughProductionPath([
    userTurn('write the run script'),
    toolUse('w1', 'Write', { file_path: '/repo/scripts/run.sh', content: continuedPastTheCap() }),
    toolResult('w1', 'File created successfully'),
  ]);
  assert.equal(whole.ledger.find((e) => e.kind === 'create').after.text.includes('truncated at'), false);
  const session = sessionFromLedger(redact({ ...persistedCut(whole, 'create'), dropped: [] }).ledger, { sessionKey: 'w3d6' });
  const write = onlyWrite(session);
  const [change] = write.changes;
  assert.equal(change.extent.truncated, true);
  assert.equal(change.extent.cap, BEFORE_CAP, 'the cap is read from the recognised stub');
  assert.ok(!session.textOf(change, 'after').includes('truncated at'));
  stubIsRejected(session, write.id);
});

// The other path (W3d-6): redaction drops a kept line in front of a stub — an unclassifiable
// high-entropy head, such as one long single-line data blob. Redaction places its omission note at
// the cut, before the stub. M33 R: redaction now scrubs the WHOLE body before Sonah caps it, so a blob
// it drops no longer uses the budget: the body is capped only when what is left is still over it.
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
const blob = (n) => Array.from({ length: n }, (_, i) => ALPHABET[(i * 37 + Math.floor(i / 64) * 11) % ALPHABET.length]).join('');

test('W3d-6 / M33 R a blob redaction drops leaves the rest of a body within the cap: nothing is cut', async () => {
  const OLD = 'const inline = null;   // W3D6_OLD_BLOB';
  const { ledger, session } = await throughProductionPath([
    userTurn('inline the asset'),
    ...editOf('e1', '/repo/src/asset.js', OLD, `${blob(BEFORE_CAP + 500)}\nW3D6_TAIL_KEPT`),
  ]);
  const recorded = ledger.ledger.find((e) => e.kind === 'edit');
  assert.equal(recorded.after.text.includes('truncated at'), false, 'scrubbed whole, the side fits: no cut');
  assert.ok(recorded.after.text.includes('dropped:'), 'the blob is declared dropped');
  const [change] = onlyWrite(session).changes;
  assert.equal(change.extent.truncated, false);
  assert.equal(session.textOf(change, 'after').trim(), 'W3D6_TAIL_KEPT', 'what the old cut lost before redaction is kept');
  assert.equal(session.textOf(change, 'before'), OLD);
});

test('W3d-6 a stub after the redaction note is still the recorder\'s', async () => {
  const OLD = 'const inline = null;   // W3D6_OLD_BLOB';
  const rest = Array.from({ length: 1_500 }, (_, i) => `const kept${i} = ${i};`).join('\n');
  const { ledger: whole } = await throughProductionPath([
    userTurn('inline the asset'),
    ...editOf('e1', '/repo/src/asset.js', OLD, `${blob(5_000)}\n${rest}\nW3D6_TAIL_SHOWN`),
  ]);
  const kept = whole.ledger.find((e) => e.kind === 'edit');
  assert.ok(kept.after.text.includes('W3D6_TAIL_SHOWN') && !kept.after.text.includes('truncated at'),
    'D68 (E): the whole side is kept, the blob dropped and declared');
  const ledger = redact({ ...persistedCut(whole, 'edit'), dropped: [] }).ledger;
  const session = sessionFromLedger(ledger, { sessionKey: 'w3d6' });
  const recorded = ledger.ledger.find((e) => e.kind === 'edit');
  assert.ok(recorded.after.text.includes(`[… truncated at ${BEFORE_CAP} chars …]`), 'premise: a persisted cut');
  assert.ok(recorded.after.text.indexOf('dropped:') < recorded.after.text.indexOf('truncated at'),
    'the omission note marks the cut before the stub');
  const edit = onlyWrite(session);
  const [change] = edit.changes;
  assert.equal(change.extent.truncated, true, 'the written segment is the one that was cut');
  assert.equal(change.extent.cap, BEFORE_CAP);
  assert.ok(!session.textOf(change, 'after').includes('W3D6_TAIL_SHOWN'), 'what the persisted cut cut is not shown');
  assert.equal(change.beforeExtent.truncated, false, 'the replaced side is not the one cut');
  assert.equal(change.beforeExtent.cap, null);
  assert.equal(session.textOf(change, 'before'), OLD, 'the replaced text is placed where it belongs, and only it');
  stubIsRejected(session, edit.id);
});

test('W3d-6 a whole-file write whose first line redaction dropped still declares a persisted cap', async () => {
  const { ledger: whole } = await throughProductionPath([
    userTurn('write the asset'),
    toolUse('w1', 'Write', { file_path: '/repo/src/asset.txt', content: `${blob(5_000)}\n${'kept line\n'.repeat(2_100)}W3D6_TAIL` }),
    toolResult('w1', 'File created successfully'),
  ]);
  assert.ok(whole.ledger.find((e) => e.kind === 'create').after.text.endsWith('W3D6_TAIL'), 'D68 (E): kept whole');
  const ledger = redact({ ...persistedCut(whole, 'create'), dropped: [] }).ledger;
  const recorded = ledger.ledger.find((e) => e.kind === 'create');
  assert.ok(recorded.after.text.indexOf('dropped:') < recorded.after.text.indexOf('truncated at'),
    'the omission note marks the cut before the stub');
  const write = onlyWrite(sessionFromLedger(ledger, { sessionKey: 'w3d6' }));
  const [change] = write.changes;
  assert.equal(change.extent.truncated, true);
  assert.equal(change.extent.cap, BEFORE_CAP, 'the cap is read from the stub');
  stubIsRejected(sessionFromLedger(ledger, { sessionKey: 'w3d6' }), write.id);
});
