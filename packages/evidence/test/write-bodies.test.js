// B1 — a write's body reaches the reviewer, with declared extent.
//
// Everything here runs the PRODUCTION raw path: a synthetic .jsonl on disk ->
// sliceLineage -> redact -> analyze -> sessionFromLedger. A hand-built Session cannot show
// where a body is lost, and a hand-built Session cannot show that redaction ran before the
// body was placed — which is the property the redaction tests below protect.
//
// Every fixture is synthetic. No real recording is read and no session text is printed.

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sliceLineage } from '../../slicer/index.js';
import { redact } from '../../redact/index.js';
import { analyze } from '../../cli/index.js';
import { sessionFromLedger } from '../adapters/sonah-ledger.js';
import { verifyReceipt } from '../src/session.js';
import { planWindows, WINDOW_SETTINGS } from '../src/windows.js';
import { buildNarrativePrompt } from '../src/prompt.js';
import { instructionReviewScope } from '../src/ledger.js';
import { ARG_SEP } from '../../slicer/src/events.js';

/** The body cap an earlier Sonah cut at (M33 R to D68 E): its stub stands only in a persisted ledger. D68 (E): the
 *  production path cuts nothing; `persisted` rebuilds a ledger as an earlier Sonah wrote it, read exactly as before. */
const BEFORE_CAP = 20_000;
function persistedCut(ledger, path) {
  const out = structuredClone(ledger);
  for (const e of out.ledger) {
    if (!['create', 'edit'].includes(e.kind) || !String(e.path).endsWith(path)) continue;
    const [written, ...rest] = e.after.text.split(ARG_SEP);
    if (written.length <= BEFORE_CAP) continue;
    e.after.text = [`${written.slice(0, BEFORE_CAP)}\n[… truncated at ${BEFORE_CAP} chars …]`, ...rest].join(ARG_SEP);
    e.after.truncated = true;
    e.after.lines = e.after.text.split('\n').length;
  }
  return out;
}
const persisted = async (records, path) => {
  const { ledger } = await throughProductionPath(records);
  assert.equal(ledger.ledger.some((e) => e.after?.truncated === true), false, 'D68 (E): the production path cuts nothing');
  const cut = persistedCut(ledger, path);
  return { ledger: cut, session: sessionFromLedger(cut, { sessionKey: 'b1' }) };
};

// ---- synthetic raw recording builders ------------------------------------------------
let seq = 0;
const uid = () => `b1-${String(++seq).padStart(6, '0')}`;
// M34 labels review (F6): a typed recorder (2.1.219 and later), whose human prompts carry the host's typed origin; a
// 2.1.205 recording is labelled by the declared legacy fallback, every row of it a counted gap.
const base = { sessionId: 'sess-b1', cwd: '/repo', version: '2.1.284', gitBranch: 'main', isSidechain: false };

const userTurn = (text) => ({ ...base, type: 'user', uuid: uid(), origin: { kind: 'human' },
  message: { role: 'user', content: text } });
const toolUse = (id, name, input) => ({ ...base, type: 'assistant', uuid: uid(),
  message: { role: 'assistant', content: [{ type: 'tool_use', id, name, input }] } });
const toolResult = (id, content) => ({ ...base, type: 'user', uuid: uid(),
  message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content }] } });

/** One Write of `body` to `path`, recorded as created. */
const writeOf = (id, path, body) => [
  toolUse(id, 'Write', { file_path: path, content: body }),
  toolResult(id, 'File created successfully'),
];

async function onDisk(records, run) {
  const dir = await mkdtemp(join(tmpdir(), 'b1-'));
  const file = join(dir, 'session.jsonl');
  await writeFile(file, records.map((r) => JSON.stringify(r)).join('\n') + '\n');
  try { return await run(file); } finally { await rm(dir, { recursive: true, force: true }); }
}

/** analyze() -> sessionFromLedger(), the exact pair `sonah review` runs. */
const throughProductionPath = (records) => onDisk(records, async (file) => {
  const { ledger } = await analyze([file]);
  return { ledger, session: sessionFromLedger(ledger, { sessionKey: 'b1' }) };
});

const writes = (session) => session.events.filter((e) => e.kind === 'invocation'
  && e.operation !== 'command' && e.operation !== 'delegate');
const codeGaps = (session) => (session.adapterGaps ?? [])
  .filter((g) => g.code === 'source_clipped' && g.channel === 'code');

const pad = (n, tag) => Array.from({ length: n }, (_, i) => `  // ${tag} padding line ${i}`);
const SHORT_BODY = ['export function priceOrder(order) {', ...pad(40, 'short'),
  '  return Math.round(order.total * 1.2);    // MARKER_TAX_MULTIPLIER', '}'].join('\n');

// ---- the trace: which stage drops the body -------------------------------------------

test('the recorded body survives the slicer, redaction and analyze; only the adapter has to place it', async () => {
  await onDisk([userTurn('add order pricing'), ...writeOf('t1', '/repo/src/price.js', SHORT_BODY)],
    async (file) => {
      const raw = await sliceLineage([file], { cwd: '/repo' });
      const sliced = raw.ledger.find((e) => e.kind === 'create');
      assert.ok(sliced.after?.text.includes('MARKER_TAX_MULTIPLIER'), 'the slicer records after.text');

      const redacted = redact(raw).ledger.ledger.find((e) => e.kind === 'create');
      assert.ok(redacted.after?.text.includes('MARKER_TAX_MULTIPLIER'), 'redaction keeps a clean body');

      const { ledger } = await analyze([file]);
      const analyzed = ledger.ledger.find((e) => e.kind === 'create');
      assert.ok(analyzed.after?.text.includes('MARKER_TAX_MULTIPLIER'),
        'analyze() does not strip bodies — the adapter is the only place they can be lost');

      const session = sessionFromLedger(ledger, { sessionKey: 'b1' });
      const [write] = writes(session);
      assert.equal(session.textOf(write.changes[0], 'after'), redacted.after.text,
        'the adapter places exactly the REDACTED body, byte for byte');
    });
});

// ---- extent --------------------------------------------------------------------

test('an untruncated write is complete evidence and declares nothing', async () => {
  const { session } = await throughProductionPath([
    userTurn('add order pricing'), ...writeOf('t1', '/repo/src/price.js', SHORT_BODY),
  ]);
  const [write] = writes(session);
  assert.equal(write.changes.length, 1, 'the write carries exactly one change');
  assert.match(session.textOf(write.changes[0], 'after'), /MARKER_TAX_MULTIPLIER/);
  assert.equal(write.changes[0].extent.truncated, false);
  assert.equal(write.changes[0].extent.recorded, true);
  assert.equal(write.changes[0].extent.cap, null, 'no cap is claimed when the recorder declared none');
  assert.deepEqual(codeGaps(session), [], 'an untruncated write declares no source_clipped gap');
});

test('a persisted truncated write is placed as far as it exists and declares the cut', async () => {
  const BIG = ['export function big() {', ...pad(1200, 'big'),
    '  return 1;   // MARKER_TAIL_NEVER_RECORDED', '}'].join('\n');
  assert.ok(BIG.length > 20_000, 'the fixture must exceed the recorder cap');

  const { ledger, session } = await persisted([
    userTurn('write the big module'), ...writeOf('t1', '/repo/src/big.js', BIG),
  ], 'big.js');
  const recorded = ledger.ledger.find((e) => e.kind === 'create');
  assert.equal(recorded.after.truncated, true, 'a persisted ledger whose body was cut');

  const [write] = writes(session);
  const change = write.changes[0];
  const after = session.textOf(change, 'after');
  assert.equal(after, BIG.slice(0, change.extent.cap), 'the placed text is the recorder head, verbatim');
  assert.equal(change.extent.truncated, true);
  assert.equal(change.truncated, true, 'the change itself carries the truncation');
  assert.equal(change.extent.chars, change.extent.cap, 'a head-truncated body is exactly the cap');
  assert.equal(change.extent.cap, BEFORE_CAP, 'the cap the recorder declared in its own marker');
  assert.ok(!after.includes('MARKER_TAIL_NEVER_RECORDED'), 'the cut tail is not invented');
  assert.ok(!after.includes('truncated at'), "the recorder's stub is never quotable as code");

  const gaps = codeGaps(session);
  assert.equal(gaps.length, 1, 'exactly one source_clipped gap on channel code');
  assert.equal(gaps[0].count, 1, 'counted, not one per write');
});

test('two writes, one truncated: the gap counts the truncated one only', async () => {
  const BIG = ['export function big() {', ...pad(1200, 'big'), '}'].join('\n');
  const { session } = await persisted([
    userTurn('two files'),
    ...writeOf('t1', '/repo/src/small.js', SHORT_BODY),
    ...writeOf('t2', '/repo/src/big.js', BIG),
  ], 'big.js');
  assert.equal(writes(session).length, 2);
  const gaps = codeGaps(session);
  assert.equal(gaps.length, 1);
  assert.equal(gaps[0].count, 1, 'the untruncated write is not counted as clipped');
});

test('the first edit of a path carries the file as the record found it, and says so', async () => {
  const ORIGINAL = ['export function old() {', '  return "PRIOR_STATE_MARKER";', '}'].join('\n');
  const numbered = ORIGINAL.split('\n')
    .map((l, i) => `${String(i + 1).padStart(6)}\t${l}`).join('\n');
  const { session } = await throughProductionPath([
    userTurn('refactor old()'),
    toolUse('r1', 'Read', { file_path: '/repo/src/old.js' }), toolResult('r1', numbered),
    toolUse('e1', 'Edit', { file_path: '/repo/src/old.js',
      old_string: 'return "PRIOR_STATE_MARKER";', new_string: 'return "NEW_MARKER";' }),
    toolResult('e1', 'The file has been updated.'),
  ]);
  const edit = session.events.find((e) => e.kind === 'invocation' && e.operation === 'edit');
  const change = edit.changes[0];
  assert.equal(session.textOf(change, 'before'), ORIGINAL, 'the pre-edit state is placed verbatim');
  assert.equal(change.beforeExtent.recorded, true);
  // B1b/F67: the Edit's own written text is the `after` side. The whole-file state the record
  // observed still wins the `before` side — it contains the replaced span and says more.
  assert.equal(session.textOf(change, 'after'), 'return "NEW_MARKER";');
  assert.equal(change.extent.recorded, true);
  assert.equal(change.extent.priorState, 'first-write',
    'the recorder keeps a path\'s file state at its first write only, and this change has it');
  assert.equal(verifyReceipt(session, { role: 'code', eventId: edit.id,
    quote: '  return "PRIOR_STATE_MARKER";' }).ok, true, 'the prior state grounds a code receipt');

  // M36 phase 2 (D68 H; C-07 "M36 window format"): a window shows the Edit's own written and replaced text, and says the
  // file as the record found it exists (its lines and bytes, and how to ask) without inlining it.
  assert.equal(session.textOf(change, 'replaced'), 'return "PRIOR_STATE_MARKER";', 'the Edit\'s own replaced text, kept');
  const [window] = planWindows(session);
  const { prompt, sourceMap } = buildNarrativePrompt({ session, window });
  // M36 phase 2 review (critique c1): the state is labelled by the event that recorded it — here the Read before the edit.
  const readAlias = prompt.match(/\[([^\]]+)\] ACTION · tool=read/)?.[1];
  assert.ok(readAlias, 'premise: the Read is shown');
  assert.ok(prompt.includes(`old.js as read at [${readAlias}] (3 line(s), `), 'as read at the Read, never "as recorded before" the edit');
  // D69 review (finding F2): a combined request has no evidence request (its contract holds no `evidenceRequests`, and
  // only a session-only review is re-asked, D69 d), so it says the state is not shown and offers no way to ask; a
  // session-only request says how to ask.
  assert.match(prompt, /old\.js as read at \[[^\]]+\] \(3 line\(s\), [\d,]+ bytes\) is not shown\./);
  assert.ok(!prompt.includes('ask for ['), 'a combined request offers no request');
  const sessionOnly = buildNarrativePrompt({ session, window, reviewScope: 'session-only' }).prompt;
  // D71 (S2): under its brief's last step (S3: step 6).
  assert.match(sessionOnly, /old\.js as read at \[[^\]]+\] \(3 line\(s\), [\d,]+ bytes\) is not shown: ask for \[[^\]]+\] and a line range of it under step 6 if a row's status depends on it\./);
  assert.match(prompt, /text written to .*old\.js \(role=code\)/);
  assert.match(prompt, /text it replaced in .*old\.js \(role=code\)/);
  assert.deepEqual(sourceMap[edit.id].filter((source) => source.role === 'code').map((source) => source.text),
    ['return "NEW_MARKER";', 'return "PRIOR_STATE_MARKER";'], 'the file as found is not inlined (its Read is shown)');
});

test("a created file's own body is never also presented as the state before it", async () => {
  const { session } = await throughProductionPath([
    userTurn('add order pricing'), ...writeOf('t1', '/repo/src/price.js', SHORT_BODY),
  ]);
  const [write] = writes(session);
  // The slicer fills `before` from a create's own body: that is the pre-edit channel's baseline
  // for LATER edits, not a prior state. Carrying it would bill and show every new file twice.
  assert.equal(session.textOf(write.changes[0], 'before'), '');
  assert.equal(write.changes[0].beforeExtent, undefined);
  const bytes = Buffer.byteLength(session.textOf(write.changes[0], 'after'), 'utf8');
  const [window] = planWindows(session);
  assert.ok(window.workBytes < 2 * bytes, 'the body is counted once, not twice');
});

// ---- receipts ground --------------------------------------------------------------

test('a code receipt quoting a line of the body grounds; a paraphrase does not', async () => {
  const { session } = await throughProductionPath([
    userTurn('add order pricing'), ...writeOf('t1', '/repo/src/price.js', SHORT_BODY),
  ]);
  const [write] = writes(session);
  const exact = '  return Math.round(order.total * 1.2);    // MARKER_TAX_MULTIPLIER';

  const grounded = verifyReceipt(session, { role: 'code', eventId: write.id, quote: exact });
  assert.equal(grounded.ok, true, 'an exact span of the written body grounds on the invocation');

  const paraphrase = verifyReceipt(session, { role: 'code', eventId: write.id,
    quote: 'return Math.round(order.total * 1.2) // marker tax multiplier' });
  assert.equal(paraphrase.ok, false, 'a paraphrase of the same line does not ground');
  assert.equal(paraphrase.reason, 'receipt_rejected');

  // The channel claim still holds: written code is not something a human said.
  assert.equal(verifyReceipt(session, { role: 'instruction', eventId: write.id, quote: exact }).ok, false);
});

// ---- D90: what the agent wrote reaches the review as recorded -------------------------
// D90 (owner decision 2026-10-15, privacy is not a design constraint): nothing is masked on the way — a key-shaped value
// and a key block the agent wrote are evidence like every other line (before, `analyze` masked them: this part was
// "redaction fails closed"). AKIAIOSFODNN7EXAMPLE is AWS's own published example key; the key block is a synthetic one.

const AWS_KEY = 'AKIAIOSFODNN7EXAMPLE';
const PEM = ['-----BEGIN RSA PRIVATE KEY-----',
  'MIIEowIBAAKCAQEAx7Vn9tQfPq3mKcWJbL0sZvD4hRtGyYuNpXeAiOkQcSdFgHjK',
  'LmNoPqRsTuVwXyZaBcDeFgHiJkLmNoPqRsTuVwXyZaBcDeFgHiJkLmNoPqRsTuVw',
  '-----END RSA PRIVATE KEY-----'].join('\n');

test('D90: a planted AWS key and PEM block reach textOf and the narrative prompt as recorded', async () => {
  const BODY = ['export const config = {', `  awsAccessKeyId: '${AWS_KEY}',`, '};', '', PEM, '',
    'export function ok() { return "MARKER_SURVIVES"; }'].join('\n');

  const { session } = await throughProductionPath([
    userTurn('add the deploy config'), ...writeOf('t1', '/repo/src/config.js', BODY),
  ]);
  const [write] = writes(session);
  const after = session.textOf(write.changes[0], 'after');

  assert.equal(after, BODY, 'the whole body, the key and the key block included, as written');
  assert.notEqual(write.changes[0].redacted, true, 'nothing is declared cut');
  assert.ok(!(write.changes[0].extent.redactedLines > 0), 'no line is dropped');

  const [window] = planWindows(session);
  const { prompt } = buildNarrativePrompt({ session, window });
  assert.ok(prompt.includes(AWS_KEY), 'the key reaches the prompt');
  assert.ok(prompt.includes('MIIEowIBAAKCAQEA'), 'and the key block');
});

test('D90: a body that is nothing but a PEM block arrives whole and grounds a quote', async () => {
  const { session } = await throughProductionPath([
    userTurn('add the key'), ...writeOf('t1', '/repo/keys/service.js', PEM),
  ]);
  const [write] = writes(session);
  const after = session.textOf(write.changes[0], 'after');
  assert.equal(after, PEM);
  assert.notEqual(write.changes[0].redacted, true);
  assert.equal(verifyReceipt(session, { role: 'code', eventId: write.id,
    quote: 'MIIEowIBAAKCAQEAx7Vn9tQfPq3mKcWJbL0sZvD4hRtGyYuNpXeAiOkQcSdFgHjK' }).ok, true);
});

// ---- budget -----------------------------------------------------------------------

test('write bodies count toward the window work budget, in full (M35)', async () => {
  const BIG_A = ['export function alpha() {', ...pad(6000, 'alpha'), '}'].join('\n');
  const BIG_B = ['export function beta() {', ...pad(6000, 'beta'), '}'].join('\n');
  assert.ok(BIG_A.length > 100_000 && BIG_B.length > 100_000);

  const { session } = await throughProductionPath([
    userTurn('write both modules'),
    ...writeOf('t1', '/repo/src/alpha.js', BIG_A),
    ...writeOf('t2', '/repo/src/beta.js', BIG_B),
  ]);
  const [a, b] = writes(session);
  const bodyBytes = Buffer.byteLength(session.textOf(a.changes[0], 'after'), 'utf8');
  const otherBytes = Buffer.byteLength(session.textOf(b.changes[0], 'after'), 'utf8');
  assert.ok(bodyBytes > 10_000, 'each retained body is substantial');
  assert.equal(session.textOf(a.changes[0], 'after'), BIG_A, 'D68 (E): kept whole');

  // M35 (windowing): every written body counts in full toward its window's work. One body fits this budget, two do
  // not; with no thought between the two writes the segment is never cut between them: one window over its budget,
  // marked oversize, every body whole — never clipped.
  const settings = { ...WINDOW_SETTINGS, workTokens: Math.ceil((bodyBytes + 2_000) / 3.6) };
  const windows = planWindows(session, settings);
  assert.equal(windows.length, 1, 'no thought boundary between the writes: no cut');
  assert.equal(windows[0].oversize, true);
  assert.ok(windows[0].workBytes > bodyBytes + otherBytes, 'both bodies count, in full');
  assert.ok(windows[0].events.includes(a) && windows[0].events.includes(b));
});

// ---- the prompt shows the body ----------------------------------------------------

const fencedSpans = (prompt) => [...prompt.matchAll(/<<<\n([\s\S]*?)\n>>>/g)].map((m) => m[1]);

test('the narrative prompt shows an untruncated body fenced, labelled role=code, with no extent claim', async () => {
  const { session } = await throughProductionPath([
    userTurn('add order pricing'), ...writeOf('t1', '/repo/src/price.js', SHORT_BODY),
  ]);
  const [window] = planWindows(session);
  const { prompt } = buildNarrativePrompt({ session, window });
  assert.match(prompt, /text written to .*price\.js \(role=code\)/);
  assert.ok(fencedSpans(prompt).some((s) => s.includes('MARKER_TAX_MULTIPLIER')),
    'the body is inside a quotable fence, verbatim');
  assert.ok(!/capped before review|head-truncated by the recorder/.test(prompt), 'nothing is declared cut when nothing was');
});

test('the narrative prompt declares the extent of a truncated body', async () => {
  const BIG = ['export function big() {', ...pad(1200, 'big'), '}'].join('\n');
  const { session } = await persisted([
    userTurn('write the big module'), ...writeOf('t1', '/repo/src/big.js', BIG),
  ], 'big.js');
  const [window] = planWindows(session);
  const { prompt } = buildNarrativePrompt({ session, window });
  // M33 R repair: the cap is Sonah's (redaction's, after it scrubbed the body whole); the recorder kept the whole body.
  assert.match(prompt, new RegExp(`extent: ${BEFORE_CAP.toLocaleString('en-US')} chars shown — capped before review at `
    + `${BEFORE_CAP.toLocaleString('en-US')} chars; the rest of this body was not shown and cannot be quoted`),
    'the extent line states what was shown and that the rest cannot be quoted');
  assert.ok(!/head-truncated by the recorder|never recorded/.test(prompt), 'the cut is never credited to the recorder');
  // The stub is not inside any fence: it is not the session's text.
  assert.ok(!fencedSpans(prompt).some((s) => s.includes(`truncated at ${BEFORE_CAP} chars`)));
});

test('instructionReviewScope still reads a session whose writes now carry bodies', async () => {
  const { session } = await throughProductionPath([
    userTurn('add order pricing'), ...writeOf('t1', '/repo/src/price.js', SHORT_BODY),
  ]);
  assert.equal(instructionReviewScope(session).complete, true);
});

// ---- B1b: an Edit's written text is evidence too (F67); a deletion's prior state (F69) ----

/** One Edit, recorded as updated. */
const editOf = (id, path, oldString, newString, extra = {}) => [
  toolUse(id, 'Edit', { file_path: path, old_string: oldString, new_string: newString, ...extra }),
  toolResult(id, 'The file has been updated.'),
];

test('F67 an Edit places what it wrote as after and what it replaced as before', async () => {
  const OLD = '  return 0.2;   // OLD_RATE_MARKER';
  const NEW = '  return 0.25;  // NEW_RATE_MARKER';
  const { session } = await throughProductionPath([
    userTurn('raise the rate'), ...editOf('e1', '/repo/src/rate.js', OLD, NEW),
  ]);
  const [edit] = writes(session);
  assert.equal(edit.operation, 'edit');
  assert.equal(edit.changes.length, 1, 'one edit entry is one change');
  const change = edit.changes[0];
  assert.equal(session.textOf(change, 'after'), NEW, 'the written text, verbatim');
  assert.equal(session.textOf(change, 'before'), OLD, 'the replaced text, verbatim');
  assert.equal(change.extent.recorded, true);
  assert.equal(change.extent.truncated, false);
  assert.equal(change.extent.priorState, 'edit-text',
    "no whole-file state was recorded here; the before side is this edit's own replaced text");
  assert.deepEqual(codeGaps(session), [], 'a complete edit body declares no source_clipped gap');
  // The recorder's join marker is never the session's text and can never be quoted as code.
  assert.ok(!session.textOf(change, 'after').includes('⟪→⟫'));
  assert.ok(!session.textOf(change, 'before').includes('⟪→⟫'));
});

test('F67 a MultiEdit with three edits yields three changes, in order', async () => {
  const entries = [
    { old_string: 'const A = 1;', new_string: 'const A = 11;  // FIRST_MARKER' },
    { old_string: 'const B = 2;', new_string: 'const B = 22;  // SECOND_MARKER' },
    { old_string: 'const C = 3;', new_string: 'const C = 33;  // THIRD_MARKER' },
  ];
  const { session } = await throughProductionPath([
    userTurn('bump the constants'),
    toolUse('m1', 'MultiEdit', { file_path: '/repo/src/k.js', edits: entries }),
    toolResult('m1', 'Applied 3 edits.'),
  ]);
  const [edit] = writes(session);
  assert.equal(edit.changes.length, 3, 'one change per edit entry');
  assert.deepEqual(edit.changes.map((c) => session.textOf(c, 'after')), entries.map((e) => e.new_string));
  assert.deepEqual(edit.changes.map((c) => session.textOf(c, 'before')), entries.map((e) => e.old_string));
  assert.ok(edit.changes.every((c) => c.path === 'src/k.js'), 'every change names the edited path');
  for (const entry of entries) {
    assert.equal(verifyReceipt(session, { role: 'code', eventId: edit.id, quote: entry.new_string }).ok,
      true, "each entry's written text grounds a code receipt on the one invocation");
  }
});

test('F67 replace_all is declared on the extent and the body is still the written text once', async () => {
  const { session } = await throughProductionPath([
    userTurn('rename it everywhere'),
    ...editOf('e1', '/repo/src/n.js', 'oldName', 'newName_MARKER', { replace_all: true }),
  ]);
  const [edit] = writes(session);
  assert.equal(edit.changes.length, 1);
  assert.equal(session.textOf(edit.changes[0], 'after'), 'newName_MARKER', 'placed once, not per occurrence');
  assert.equal(edit.changes[0].extent.replaceAll, true);
});

test('F67 a persisted 20,000-char new_string cut is head-truncated with declared extent', async () => {
  const NEW = ['export function big() {', ...pad(1200, 'edit'),
    '  return 1;   // MARKER_TAIL_NEVER_RECORDED', '}'].join('\n');
  assert.ok(NEW.length > 20_000, 'the fixture must exceed the recorder cap');
  const { session } = await persisted([
    userTurn('write the big block'), ...editOf('e1', '/repo/src/big.js', 'export function big() {}', NEW),
  ], 'big.js');
  const [edit] = writes(session);
  const change = edit.changes[0];
  const after = session.textOf(change, 'after');
  assert.equal(change.extent.truncated, true);
  assert.equal(change.truncated, true, 'the change itself carries the truncation');
  assert.equal(change.extent.cap, BEFORE_CAP, 'the cap the recorder declared in its own marker');
  assert.equal(after, NEW.slice(0, change.extent.cap), 'the placed text is the recorder head, verbatim');
  assert.ok(!after.includes('MARKER_TAIL_NEVER_RECORDED'), 'the cut tail is not invented');
  assert.ok(!after.includes('truncated at'), "the recorder's stub is never quotable as code");
  // F155 (W3d-4): each side is capped on its own, so the long written text no longer cuts the
  // replaced text away. It is here, whole, with its own extent; only the written side is declared cut.
  assert.equal(session.textOf(change, 'before'), 'export function big() {}', 'the replaced text survives the written cap');
  assert.equal(change.extent.priorState, 'edit-text');
  assert.equal(change.beforeExtent.truncated, false);
  assert.equal(change.beforeExtent.cap, null);
  const gaps = codeGaps(session);
  assert.equal(gaps.length, 1, 'exactly one source_clipped gap on channel code');
  assert.equal(gaps[0].count, 1, 'counted once for the clipped change');
});

test('F67 a code receipt quoting a line of new_string grounds; a paraphrase does not', async () => {
  const NEW = ['function priceOrder(order) {', '  if (!order) throw new Error("EDIT_GUARD_MARKER");',
    '  return order.total;', '}'].join('\n');
  const { session } = await throughProductionPath([
    userTurn('guard the pricing'), ...editOf('e1', '/repo/src/price.js', 'function priceOrder(order) {}', NEW),
  ]);
  const [edit] = writes(session);
  const exact = '  if (!order) throw new Error("EDIT_GUARD_MARKER");';
  assert.equal(verifyReceipt(session, { role: 'code', eventId: edit.id, quote: exact }).ok, true);
  assert.equal(verifyReceipt(session, { role: 'code', eventId: edit.id,
    quote: "if (!order) throw new Error('EDIT_GUARD_MARKER')" }).ok, false, 'a paraphrase does not ground');
  assert.equal(verifyReceipt(session, { role: 'instruction', eventId: edit.id, quote: exact }).ok, false,
    'written code is not something a human said');

  const [window] = planWindows(session);
  const { prompt } = buildNarrativePrompt({ session, window });
  assert.ok(fencedSpans(prompt).some((s) => s.includes('EDIT_GUARD_MARKER')),
    'the edit body is inside a quotable fence, verbatim');
});

test('F67, D90: an AWS key planted in new_string reaches textOf and the prompt as recorded', async () => {
  const NEW = ['export const config = {', `  awsAccessKeyId: '${AWS_KEY}',`, '};', '', PEM, '',
    'export function ok() { return "EDIT_SURVIVES_MARKER"; }'].join('\n');
  const { session } = await throughProductionPath([
    userTurn('add the deploy config'), ...editOf('e1', '/repo/src/config.js', 'export const config = {};', NEW),
  ]);
  const [edit] = writes(session);
  const after = session.textOf(edit.changes[0], 'after');
  assert.equal(after, NEW, 'the whole edit, the key and the key block included, as written');
  assert.notEqual(edit.changes[0].redacted, true, 'nothing is declared cut');

  const [window] = planWindows(session);
  const { prompt } = buildNarrativePrompt({ session, window });
  assert.ok(prompt.includes(AWS_KEY), 'the key reaches the prompt');
  assert.ok(prompt.includes('MIIEowIBAAKCAQEA'), 'and the key block');
});

test('F67, D90: a key in old_string reaches the before side as recorded too', async () => {
  const OLD = ['export const config = {', `  awsAccessKeyId: '${AWS_KEY}',`, '};'].join('\n');
  const { session } = await throughProductionPath([
    userTurn('take the key out'),
    ...editOf('e1', '/repo/src/config.js', OLD, 'export const config = { awsAccessKeyId: process.env.AWS_KEY };'),
  ]);
  const [edit] = writes(session);
  assert.equal(session.textOf(edit.changes[0], 'before'), OLD, 'the replaced side, as written');
  const [window] = planWindows(session);
  assert.ok(buildNarrativePrompt({ session, window }).prompt.includes(AWS_KEY));
});

// ---- F107: an empty edit is a recorded empty write ------------------------------------------

test('F107 an Edit whose new_string is empty is recorded as writing nothing, not as unrecorded', async () => {
  const OLD = '  console.log("DEBUG_LINE_MARKER");';
  const { ledger, session } = await throughProductionPath([
    userTurn('drop the debug line'), ...editOf('e1', '/repo/src/debug.js', OLD, ''),
  ]);
  assert.ok(ledger.ledger.find((e) => e.kind === 'edit').after.text.length > 0,
    'the recorder kept the field: an empty written segment, the separator, the replaced text');
  const [edit] = writes(session);
  assert.equal(edit.changes.length, 1);
  const change = edit.changes[0];
  assert.equal(change.extent.recorded, true, 'the tool call recorded that it wrote the empty string');
  assert.equal(change.extent.chars, 0);
  assert.equal(change.extent.lines, 0);
  assert.equal(change.extent.truncated, false);
  assert.equal(session.textOf(change, 'after'), '');
  assert.equal(session.textOf(change, 'before'), OLD, 'what the edit removed is still its replaced side');
  const [window] = planWindows(session);
  assert.ok(!buildNarrativePrompt({ session, window }).prompt.includes(`the body written to ${change.path} was not recorded`),
    'the prompt must not tell the reviewer an empty write went unrecorded');
});

test('F107 a MultiEdit with one empty new_string keeps every entry recorded, and the empty one empty', async () => {
  const entries = [
    { old_string: 'const A = 1;', new_string: 'const A = 11;  // FIRST_MARKER' },
    { old_string: 'const B = 2;  // REMOVED_MARKER', new_string: '' },
    { old_string: 'const C = 3;', new_string: 'const C = 33;  // THIRD_MARKER' },
  ];
  const { session } = await throughProductionPath([
    userTurn('bump two constants and drop one'),
    toolUse('m1', 'MultiEdit', { file_path: '/repo/src/k.js', edits: entries }),
    toolResult('m1', 'Applied 3 edits.'),
  ]);
  const [edit] = writes(session);
  assert.equal(edit.changes.length, 3);
  assert.deepEqual(edit.changes.map((c) => c.extent.recorded), [true, true, true]);
  assert.deepEqual(edit.changes.map((c) => c.extent.chars), [entries[0].new_string.length, 0, entries[2].new_string.length]);
  assert.deepEqual(edit.changes.map((c) => session.textOf(c, 'after')), entries.map((e) => e.new_string));
  assert.deepEqual(edit.changes.map((c) => session.textOf(c, 'before')), entries.map((e) => e.old_string),
    'the empty segment does not shift which replaced text belongs to which entry');
});

test('F107 a write whose body the record does not carry is still unrecorded', async () => {
  // The fix is for a segment the separator delimits. A shell write has no body field at all.
  const { session } = await throughProductionPath([
    userTurn('rename the flag'),
    toolUse('b1', 'Bash', { command: "sed -i 's/oldFlag/newFlag/g' src/flags.js" }),
    toolResult('b1', ''),
  ]);
  const shell = writes(session).find((e) => e.shellWriteOf);
  assert.ok(shell, 'the sed -i is a shell-write sibling');
  assert.equal(shell.changes[0].extent.recorded, false);
});

// ---- F128: a Write of the empty string is a recorded empty write too --------------------------

test('F128 a Write whose content is empty is recorded as writing nothing, not as unrecorded', async () => {
  const { ledger, session } = await throughProductionPath([
    userTurn('add an empty placeholder'), ...writeOf('w0', '/repo/src/placeholder.js', ''),
  ]);
  assert.equal(ledger.ledger.find((e) => e.kind === 'create').after?.text, '',
    'the recorder kept the empty body (W3c-9): it is a recorded fact, not a missing one');
  const [write] = writes(session);
  const change = write.changes[0];
  assert.equal(change.extent.recorded, true, 'the tool call recorded that it wrote the empty string');
  assert.equal(change.extent.chars, 0);
  assert.equal(change.extent.lines, 0);
  assert.equal(change.extent.truncated, false);
  assert.equal(session.textOf(change, 'after'), '');
  assert.deepEqual((session.adapterGaps ?? []).filter((g) => g.code === 'unrecorded_body'), [],
    'an empty write is not a write whose body the recording lacks');
});

// ---- the prompt says what an empty write and a delete did ---------------------------------------

test('the prompt says an empty write and an empty edit wrote nothing, never that they went unrecorded', async () => {
  const { session } = await throughProductionPath([
    userTurn('empty the placeholder and drop the debug line'),
    ...writeOf('w0', '/repo/src/placeholder.js', ''),
    ...editOf('e1', '/repo/src/debug.js', '  console.log("DEBUG_LINE_MARKER");', ''),
  ]);
  const [window] = planWindows(session);
  const { prompt } = buildNarrativePrompt({ session, window });
  assert.ok(prompt.includes('  wrote nothing to src/placeholder.js (the file is now empty)'));
  assert.ok(prompt.includes('  wrote nothing to src/debug.js (the segment is now empty)'));
  assert.ok(!prompt.includes('was not recorded'), 'nothing here went unrecorded');
  assert.ok(prompt.includes('DEBUG_LINE_MARKER'), 'what the edit replaced is still shown as its before side');
});

test('the prompt says a delete deleted, and a shell write still went unrecorded', async () => {
  const { session } = await throughProductionPath([
    userTurn('drop the legacy module and bump the flag'),
    toolUse('d1', 'mcp__fs__delete_file', { path: '/repo/src/legacy.js' }), toolResult('d1', 'Deleted.'),
    toolUse('b1', 'Bash', { command: "sed -i 's/oldFlag/newFlag/g' src/flags.js" }), toolResult('b1', ''),
  ]);
  const [window] = planWindows(session);
  const { prompt } = buildNarrativePrompt({ session, window });
  assert.ok(prompt.includes('  deleted src/legacy.js (a delete writes no body)'));
  assert.ok(!prompt.includes('the body written to src/legacy.js was not recorded'),
    'a delete writes no body, so there is none to have lost');
  assert.ok(prompt.includes('the body written to src/flags.js was not recorded'),
    'a shell write really did write a body the record does not hold');
});

test('F69 a delete after a read carries the read body as its prior state', async () => {
  const GONE = ['export function gone() {', '  return "DELETED_STATE_MARKER";', '}'].join('\n');
  const numbered = GONE.split('\n').map((l, i) => `${String(i + 1).padStart(6)}\t${l}`).join('\n');
  const { session } = await throughProductionPath([
    userTurn('drop the dead module'),
    toolUse('r1', 'Read', { file_path: '/repo/src/gone.js' }), toolResult('r1', numbered),
    toolUse('d1', 'mcp__fs__delete_file', { path: '/repo/src/gone.js' }),
    toolResult('d1', 'Deleted.'),
  ]);
  const remove = session.events.find((e) => e.kind === 'invocation' && e.operation === 'delete');
  assert.ok(remove, 'the delete is an invocation with operation delete');
  const change = remove.changes[0];
  assert.equal(session.textOf(change, 'before'), GONE, 'the state the delete removed is placed verbatim');
  assert.equal(change.extent.priorState, 'deleted-state');
  assert.equal(verifyReceipt(session, { role: 'code', eventId: remove.id,
    quote: '  return "DELETED_STATE_MARKER";' }).ok, true, 'the removed state grounds a code receipt');
});

test('F69 a later write of a path declares that the recorder keeps no file state for it', async () => {
  const { session } = await throughProductionPath([
    userTurn('two edits to one file'),
    ...editOf('e1', '/repo/src/twice.js', 'const a = 1;', 'const a = 2;'),
    ...editOf('e2', '/repo/src/twice.js', 'const b = 1;', 'const b = 2;'),
  ]);
  const [first, second] = writes(session);
  assert.equal(session.textOf(first.changes[0], 'after'), 'const a = 2;');
  assert.equal(session.textOf(second.changes[0], 'after'), 'const b = 2;', 'a later edit is quotable too');
  assert.equal(second.changes[0].extent.priorState, 'edit-text',
    'the file state is recorded at the first write only; this change has the edit text instead');
});
