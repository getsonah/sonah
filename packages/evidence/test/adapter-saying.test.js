// B6 — the saying dedup contract, in one place.
//
// The slicer records a turn's closing text TWICE: once as `commentary[]` blocks (one per text
// block of each assistant record, carrying `record` and `block` indices) and once as `sayings[]`
// (one per turn — the LAST assistant record's text blocks joined with '\n' and trimmed; redaction
// scrubs it whole and bounds it at line boundaries around its own marker when over 8000 code
// points, M33 F repair 3; an older slicer capped it to 6000 + '\n[…]\n' + 2000 before redaction).
// The adapter must emit each statement exactly once and must never emit a span that did not
// exist in the source.
//
// Three rules were tried and each was wrong:
//   1. text equality          — a leading newline defeated it, so both copies grounded one quote;
//   2. position               — dropped a compact-ledger saying that no block carried;
//   3. per-line coverage      — audit B7: a saying sharing one trivial line (a code fence) with a
//                               block read as "partly carried" and was DROPPED, so a real
//                               admission became quotable nowhere.
//
// The rule these tests pin is structural: the saying is a duplicate IFF it equals the text the
// slicer would have built from the turn's last assistant record (its blocks, in block order,
// joined with '\n', trimmed) or a cap of that string (redaction's bound, or an older slicer's
// 6000/2000 cap) — compared after stripping redaction trailer lines from both sides, because the
// two copies are redacted separately.
//
// Every fixture is synthetic. No real session is read.

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { analyze } from '../../cli/index.js';
import { sessionFromLedger } from '../adapters/sonah-ledger.js';
import { verifyReceipt } from '../src/session.js';
import { STATEMENT_OMISSION } from '../../redact/index.js';

// ---- synthetic raw recording builders (copied, not imported: a test file is not a library) ----
let seq = 0;
const uid = () => `sy-${String(++seq).padStart(6, '0')}`;
const base = { sessionId: 'sess-b6', cwd: '/repo', version: '2.1.205', gitBranch: 'main', isSidechain: false };

const userTurn = (text) => ({ ...base, type: 'user', uuid: uid(), message: { role: 'user', content: text } });
const say = (text) => ({ ...base, type: 'assistant', uuid: uid(), message: { role: 'assistant', content: [{ type: 'text', text }] } });
/** One assistant record carrying several text blocks — the saying joins them with '\n'. */
const sayBlocks = (...texts) => ({ ...base, type: 'assistant', uuid: uid(),
  message: { role: 'assistant', content: texts.map((text) => ({ type: 'text', text })) } });
const toolUse = (id, name, input) => ({ ...base, type: 'assistant', uuid: uid(), message: { role: 'assistant', content: [{ type: 'tool_use', id, name, input }] } });
const toolResult = (id, content, isError) => ({ ...base, type: 'user', uuid: uid(),
  message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content, ...(isError === undefined ? {} : { is_error: isError }) }] } });
/** One assistant record carrying text, a tool call, then more text. */
const interleaved = (before, command, after) => ({
  ...base, type: 'assistant', uuid: uid(),
  message: { role: 'assistant', content: [
    { type: 'text', text: before },
    { type: 'tool_use', id: 'il1', name: 'Bash', input: { command } },
    { type: 'text', text: after }] },
});

/** Write records to a real .jsonl and run the production path over it. */
async function throughProductionPath(records) {
  const dir = await mkdtemp(join(tmpdir(), 'b6-saying-'));
  const file = join(dir, 'session.jsonl');
  await writeFile(file, records.map((r) => JSON.stringify(r)).join('\n') + '\n');
  try {
    const { ledger } = await analyze([file]);
    return { ledger, session: sessionFromLedger(ledger, { sessionKey: 'b6' }) };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

const commentaryOf = (s) => s.events.filter((e) => e.kind === 'commentary');
const grounds = (s, e, quote) => verifyReceipt(s, { role: 'commentary', eventId: e.id, quote }).ok;
const groundingCount = (s, quote) => commentaryOf(s).filter((e) => grounds(s, e, quote)).length;

// ---- raw path: every saying is the last record, rebuilt ------------------------------

test('raw: one text block -> one commentary event, final, quotable once', async () => {
  // The saying is trimmed and the block is raw, so ONE leading newline used to defeat the match
  // and re-emit the duplicate; both copies then grounded the same quote.
  const { session } = await throughProductionPath([
    userTurn('fix the failing test'),
    toolUse('a1', 'Bash', { command: 'npm test' }),
    toolResult('a1', '1 failed, 11 passed', true),
    say('\nAll green now.'),
  ]);
  const commentary = commentaryOf(session);
  assert.equal(commentary.length, 1, 'whitespace must not defeat the structural match');
  assert.equal(commentary[0].phase, 'final');
  assert.equal(groundingCount(session, 'All green now.'), 1, 'one statement, one citable event');
});

test('raw: interleaved [text, tool_use, text] -> two events, no F event, the joined span grounds nowhere', async () => {
  // The saying joins a record's text blocks with a newline. For [text, tool_use, text] that
  // produces a contiguous region fusing a statement made BEFORE the action with one made AFTER
  // it — a span that never existed in the source. C-05 forbids exactly that.
  const { session } = await throughProductionPath([
    userTurn('fix it'),
    interleaved('BEFORE-THE-ACTION', 'npm test', 'AFTER-THE-ACTION'),
    toolResult('il1', '1 failed', true),
  ]);
  const commentary = commentaryOf(session);
  assert.equal(commentary.length, 2, 'the record\'s two text blocks, and nothing else');
  assert.ok(!commentary.some((e) => e.id.startsWith('F')), 'no independent final event is emitted');
  assert.equal(groundingCount(session, 'BEFORE-THE-ACTION\nAFTER-THE-ACTION'), 0,
    'a span crossing the action grounds nowhere');
  assert.equal(groundingCount(session, 'BEFORE-THE-ACTION'), 1);
  assert.equal(groundingCount(session, 'AFTER-THE-ACTION'), 1);
  // The block marked final is the LAST block of the record the saying IS, not an earlier one.
  assert.equal(commentary[1].phase, 'final');
  assert.equal(commentary[0].phase, 'working');
});

test('raw: a 9000-char statement -> one event, the elision marker is not quotable', async () => {
  const { session } = await throughProductionPath([
    userTurn('do it'),
    toolUse('c1', 'Bash', { command: 'echo x' }),
    toolResult('c1', 'x'),
    say('L'.repeat(9000)),
  ]);
  const commentary = commentaryOf(session);
  assert.equal(commentary.length, 1, 'the capped twin never survives beside the block it was built from');
  assert.ok(!session.textOf(commentary[0], 'text').includes('[…]'),
    'a synthetic elision marker is not source text and must never be quotable');
});

test('raw: two assistant records in one turn -> the saying matches the LAST record; the earlier record\'s block is not marked final', async () => {
  const { session } = await throughProductionPath([
    userTurn('do it'),
    say('EARLY-STATEMENT about the approach'),
    toolUse('c1', 'Bash', { command: 'echo x' }),
    toolResult('c1', 'x'),
    say('CLOSING-STATEMENT about the result'),
  ]);
  const commentary = commentaryOf(session);
  assert.equal(commentary.length, 2, 'two blocks, no duplicate of the closing statement');
  assert.ok(!commentary.some((e) => e.id.startsWith('F')));
  const early = commentary.find((e) => session.textOf(e, 'text').includes('EARLY-STATEMENT'));
  const closing = commentary.find((e) => session.textOf(e, 'text').includes('CLOSING-STATEMENT'));
  assert.ok(early && closing, 'both statements survive separately');
  assert.equal(closing.phase, 'final', 'the last record\'s block carries the final phase');
  assert.equal(early.phase, 'working', 'the earlier record\'s block is not the turn\'s closing word');
  assert.equal(groundingCount(session, 'CLOSING-STATEMENT about the result'), 1);
});

// A PEM block is the one shape that makes redaction DROP lines out of agent prose (redact
// index.js scrubLines) and append a trailer declaring the count. The saying and the blocks are
// redacted separately, so a two-block record produces trailers that disagree (3 + 4 vs 7) and
// the saying used to read as a statement fused from text recorded nowhere.
const PEM = (bodyLines) => ['-----BEGIN PRIVATE KEY-----',
  ...bodyLines, '-----END PRIVATE KEY-----'].join('\n');

test('raw: a redacted multi-block record still deduplicates (no extra event, no gap)', async () => {
  const { ledger, session } = await throughProductionPath([
    userTurn('rotate the deploy keys'),
    sayBlocks(
      `Key rotated for the deploy user:\n${PEM(['QUJDREVGR0hJSktMTU5PUFFSU1RVVldYWVowMTIzNDU2Nzg5'])}`,
      `And the backup key as well:\n${PEM(['Uk9UQVRFRC1LRVktTUFURVJJQUwtRk9SLVRIRS1URVNU', 'WkVSTy1PTkUtVFdPLVRIUkVFLUZPVVItRklWRS1TSVg='])}`),
  ]);
  // Redaction really did drop lines and really did disagree between the two copies.
  const trailers = (text) => (String(text).match(/\[… \d+ line\(s\) dropped:/g) ?? []).length;
  assert.ok((ledger.commentary ?? []).some((c) => trailers(c.text)), 'the blocks carry a redaction trailer');
  assert.ok((ledger.sayings ?? []).some((s) => trailers(s.text)), 'the saying carries its own trailer');
  const commentary = commentaryOf(session);
  assert.equal(commentary.length, 2, 'two blocks; the saying is still recognised as their rebuild');
  assert.ok(!commentary.some((e) => e.id.startsWith('F')), 'no duplicate final event');
  assert.ok(!(session.adapterGaps ?? []).some((g) => g.code === 'fused_statement'),
    'a redaction trailer is not evidence that a statement was fused');
  assert.equal(groundingCount(session, 'Key rotated for the deploy user:'), 1);
  assert.equal(groundingCount(session, 'And the backup key as well:'), 1);
  assert.equal(commentary[1].phase, 'final');
});

test('raw: a persisted capped statement whose head was shortened by redaction is still its record, not a second event', async () => {
  // The slicer used to cut at 6000/2000 of the RAW text with redaction afterwards, so the head
  // of a capped saying was shorter than 6000 whenever a line inside it was scrubbed. Recomputing
  // the cap from the redacted blocks then missed, and the duplicate came back as an F event.
  // M33 F repair 3:
  // redaction now scrubs the whole saying and bounds it at line boundaries around its own marker;
  // the bound is still recognised as its record's.
  const key = PEM(['QUJDREVGR0hJSktMTU5PUFFSU1RVVldYWVowMTIzNDU2Nzg5', 'Uk9UQVRFRC1LRVktTUFURVJJQUwtRk9SLVRIRS1URVNU']);
  const filler = Array.from({ length: 300 }, (_, i) => `step ${i}: checked the module and left it alone`).join('\n');
  const { ledger, session } = await throughProductionPath([
    userTurn('rotate the key and tidy up'),
    say(`Rotated the deploy key:\n${key}\n${filler}\nAll of that is done.`),
  ]);
  const said = (ledger.sayings ?? [])[0]?.text ?? '';
  // D68 (E): redaction keeps the statement whole now; it is its record, as before.
  assert.equal(said.includes(STATEMENT_OMISSION), false, 'nothing bounds a statement now');
  assert.equal(said.includes('\n[…]\n'), false, 'the slicer cut nothing before redaction');
  assert.ok(said.includes('line(s) dropped:'), 'and redaction really did drop a line out of it');
  assert.equal(commentaryOf(session).length, 1);
  // A ledger an earlier Sonah persisted with the statement bounded around its marker is still its record's twin.
  const lines = said.split('\n');
  const persisted = structuredClone(ledger);
  persisted.sayings[0].text = [...lines.slice(0, 60), STATEMENT_OMISSION, ...lines.slice(-25)].join('\n');
  const boundSession = sessionFromLedger(persisted, { sessionKey: 'persisted-bound' });
  const commentary = commentaryOf(boundSession);
  assert.equal(commentary.length, 1, 'the capped twin is still recognised as the record it came from');
  assert.ok(!commentary.some((e) => e.id.startsWith('F')), 'no duplicate head/tail events');
  assert.ok(!(boundSession.adapterGaps ?? []).some((g) => g.code === 'source_clipped' && g.channel === 'commentary'),
    'nothing was clipped away from the evidence: the whole record is still there');
  assert.equal(commentary[0].phase, 'final');
  assert.ok(!boundSession.textOf(commentary[0], 'text').includes('[…'));
});

// ---- compact ledgers: a saying no block carries is evidence ---------------------------

test('compact: the saying shares a code fence with a block and adds a sentence -> emitted, quotable', () => {
  const L = { ask: [{ turn: 1, text: 'get the suite green' }],
    commentary: [{ turn: 1, beforeEvent: 0, text: 'Running the tests first:\n```\nnpm test\n```' }],
    ledger: [{ turn: 1, seq: 0, kind: 'test', cmd: 'npm test', outcome: 'failed', tailLines: ['3 failed'] }],
    sayings: [{ turn: 1, text: 'I skipped the flaky integration suite to get green:\n```\nSKIP_INTEGRATION=1 npm test\n```' }] };
  const s = sessionFromLedger(L, { sessionKey: 's' });
  const com = s.events.filter((e) => e.kind === 'commentary');
  assert.equal(com.length, 2);
  assert.ok(com.some((e) => verifyReceipt(s, { role: 'commentary', eventId: e.id, quote: 'I skipped the flaky integration suite' }).ok));
  assert.ok(!(s.adapterGaps ?? []).some((g) => g.code === 'fused_statement'));
});

test('compact: saying "Done." with block "Done. Now the docs." -> emitted (M69), and the block is not marked final', () => {
  const L = { ask: [{ turn: 1, text: 'ship it' }],
    commentary: [{ turn: 1, beforeEvent: 0, text: 'Done. Now the docs.' }],
    ledger: [],
    sayings: [{ turn: 1, text: 'Done.' }] };
  const s = sessionFromLedger(L, { sessionKey: 's' });
  const com = s.events.filter((e) => e.kind === 'commentary');
  assert.equal(com.length, 2, 'a prefix of a block line is a distinct statement, not a copy of it');
  const block = com.find((e) => s.textOf(e, 'text') === 'Done. Now the docs.');
  const closing = com.find((e) => s.textOf(e, 'text') === 'Done.');
  assert.ok(block && closing, 'both survive');
  assert.equal(block.phase, 'working', 'the block is not the statement, so it is not marked final');
  assert.equal(closing.phase, 'final');
});

test('compact: saying equal to the block -> not emitted, block final', () => {
  const L = { ask: [{ turn: 1, text: 'answer me' }],
    commentary: [{ turn: 1, beforeEvent: 0, text: 'The cache key was stale.' }],
    ledger: [],
    sayings: [{ turn: 1, text: 'The cache key was stale.' }] };
  const s = sessionFromLedger(L, { sessionKey: 's' });
  const com = s.events.filter((e) => e.kind === 'commentary');
  assert.equal(com.length, 1, 'one statement, one event');
  assert.equal(com[0].phase, 'final');
  assert.equal(com.filter((e) => verifyReceipt(s, { role: 'commentary', eventId: e.id, quote: 'The cache key was stale.' }).ok).length, 1);
});

test('compact: two sayings on one turn -> ids F1-0 and F1-1, both quotable (L107)', () => {
  const L = { ask: [{ turn: 1, text: 'two answers' }],
    commentary: [],
    ledger: [],
    sayings: [{ turn: 1, text: 'FIRST-CLOSING-STATEMENT' }, { turn: 1, text: 'SECOND-CLOSING-STATEMENT' }] };
  const s = sessionFromLedger(L, { sessionKey: 's' });
  const com = s.events.filter((e) => e.kind === 'commentary');
  assert.deepEqual(com.map((e) => e.id), ['F1-0', 'F1-1'], 'two sayings never collide on one id');
  assert.equal(s.byId.size, s.events.length, 'the Session index does not silently collapse');
  for (const quote of ['FIRST-CLOSING-STATEMENT', 'SECOND-CLOSING-STATEMENT']) {
    assert.equal(com.filter((e) => verifyReceipt(s, { role: 'commentary', eventId: e.id, quote }).ok).length, 1, quote);
  }
});

test('compact: a saying carrying "[…]" -> head and tail events, marker not quotable, source_clipped declared on commentary (H29)', () => {
  const L = { ask: [{ turn: 1, text: 'summarise' }],
    commentary: [],
    ledger: [],
    sayings: [{ turn: 1, text: 'HEAD-OF-THE-STATEMENT\n[…]\nTAIL-OF-THE-STATEMENT' }] };
  const s = sessionFromLedger(L, { sessionKey: 's' });
  const com = s.events.filter((e) => e.kind === 'commentary');
  assert.deepEqual(com.map((e) => e.id), ['F1-head', 'F1-tail']);
  assert.ok(!com.some((e) => s.textOf(e, 'text').includes('[…]')),
    'the older slicer\'s synthetic marker is never source text');
  assert.equal(com.filter((e) => verifyReceipt(s, { role: 'commentary', eventId: e.id,
    quote: 'HEAD-OF-THE-STATEMENT\n[…]\nTAIL-OF-THE-STATEMENT' }).ok).length, 0,
    'a quote crossing the elision grounds nowhere');
  assert.equal(com.filter((e) => verifyReceipt(s, { role: 'commentary', eventId: e.id, quote: 'HEAD-OF-THE-STATEMENT' }).ok).length, 1);
  assert.equal(com.filter((e) => verifyReceipt(s, { role: 'commentary', eventId: e.id, quote: 'TAIL-OF-THE-STATEMENT' }).ok).length, 1);
  const gap = (s.adapterGaps ?? []).find((g) => g.code === 'source_clipped' && g.channel === 'commentary');
  assert.ok(gap, 'the clip is declared, not silently absorbed');
  assert.equal(gap.count, 1);
});

test('compact: a turn with no commentary -> the saying is emitted (its only carrier)', () => {
  const L = { ask: [{ turn: 1, text: 'just answer' }],
    commentary: [],
    ledger: [],
    sayings: [{ turn: 1, text: 'THE-ONLY-ANSWER' }] };
  const s = sessionFromLedger(L, { sessionKey: 's' });
  const com = s.events.filter((e) => e.kind === 'commentary');
  assert.equal(com.length, 1, 'the dedup must not drop evidence when the saying is its only carrier');
  assert.equal(com[0].id, 'F1');
  assert.equal(com.filter((e) => verifyReceipt(s, { role: 'commentary', eventId: e.id, quote: 'THE-ONLY-ANSWER' }).ok).length, 1);
});

test('raw: a turn with no commentary still keeps its closing statement', async () => {
  const { ledger, session } = await throughProductionPath([
    userTurn('just answer'),
    say('THE-ONLY-ANSWER'),
  ]);
  const texts = commentaryOf(session).map((e) => session.textOf(e, 'text'));
  assert.ok(texts.some((t) => t.includes('THE-ONLY-ANSWER')),
    'the statement survives however the slicer classified it');
  assert.ok((ledger.sayings ?? []).length > 0 || texts.length > 0);
  assert.equal(groundingCount(session, 'THE-ONLY-ANSWER'), 1, 'and it is citable exactly once');
});

// F6: a final assistant record whose only text block is whitespace. The rebuild of THAT record
// is empty and matches no saying, so the turn's real closing statement — which belongs to the
// record before it — would be emitted a second time beside the block that already carries it.
// The case is rare; the cost of being wrong is one sentence quotable twice.
test('a whitespace-only final record does not make the previous saying a duplicate', () => {
  const L = { ask: [{ turn: 1, text: 'summarise' }],
    ledger: [],
    commentary: [
      { turn: 1, beforeEvent: 0, record: 1, block: 0, text: 'THE-REAL-CLOSING-STATEMENT' },
      { turn: 1, beforeEvent: 0, record: 2, block: 0, text: '   \n  ' },
    ],
    sayings: [{ turn: 1, text: 'THE-REAL-CLOSING-STATEMENT' }] };
  const s = sessionFromLedger(L, { sessionKey: 's' });
  assert.equal(groundingCount(s, 'THE-REAL-CLOSING-STATEMENT'), 1,
    'the saying is recognised as the previous record rebuilt, so it is not emitted again');
  assert.ok(s.events.some((e) => e.kind === 'commentary' && e.phase === 'final'),
    'and the block that carries it is marked final');
});

test('the fallback only skips records that are actually empty', () => {
  const L = { ask: [{ turn: 1, text: 'summarise' }],
    ledger: [],
    commentary: [
      { turn: 1, beforeEvent: 0, record: 1, block: 0, text: 'AN-EARLIER-STATEMENT' },
      { turn: 1, beforeEvent: 0, record: 2, block: 0, text: 'THE-LAST-STATEMENT' },
    ],
    sayings: [{ turn: 1, text: 'THE-LAST-STATEMENT' }] };
  const s = sessionFromLedger(L, { sessionKey: 's' });
  assert.equal(groundingCount(s, 'THE-LAST-STATEMENT'), 1);
  assert.equal(groundingCount(s, 'AN-EARLIER-STATEMENT'), 1);
  assert.equal(commentaryOf(s).length, 2, 'the real last record still owns the dedup');
});
