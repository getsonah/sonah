// W3e-6 / F213, F214 — a NUL byte in the session no longer makes a window unreviewable.
//
// F213. Tool output carried U+0000 into review windows, and the review judge refuses any request
// containing one (a process argument or a stdin protocol cannot carry it). Nothing upstream removed
// it, so those windows could never be reviewed, in any run. The adapter now stores every NUL as
// U+2400 SYMBOL FOR NULL — one character for one — in every text a request is built from, and
// counts what it rewrote on the session. A quote that contains the symbol verifies against the
// stored text by string search, exactly as every quote does.
//
// F214. The judge's refusal (`invalid_model_input`) was not a declared failure code, so the window
// read `model_unavailable`: the report said the model could not be reached when the request was
// never sent. It is named as itself now: `narrative:input_invalid`, with its own closed sentence.
//
// Every byte is synthetic, and every NUL is written as an escape (this file holds none). No model is
// called and no process is started: the real judge is handed a spawn stub that only records it ran.

import test from 'node:test';
import assert from 'node:assert/strict';
// Namespace imports, so each test fails on its own against code that predates it rather than the
// whole file failing to link.
import * as adapter from '../adapters/sonah-ledger.js';
import * as reviewRun from '../src/run-review.js';
import * as reviewRender from '../src/review.js';
import * as ledgerModule from '../src/ledger.js';
import { windowCompletionLine } from '../../cli/src/session-review-command.js';
import { redact } from '../../redact/index.js';
import { Session, verifyReceipt } from '../src/session.js';
import { createReviewJudge, withTransportRetry } from '../../cli/src/review-judge.js';

const { sessionFromLedger } = adapter;
const { runReview } = reviewRun;
const NUL = '\u0000';
const SYMBOL = '\u2400';   // SYMBOL FOR NULL
const count = (text, ch) => String(text).split(ch).length - 1;

const EMPTY_NARRATIVE = () => ({ decisions: [], pivots: [], claims: [], requirements: [] });
const PR = { repo: { host: 'github.com', id: '1' }, number: 1, baseOid: 'a'.repeat(40), headOid: 'b'.repeat(40),
  files: [], diffBaseOid: 'a'.repeat(40) };

/**
 * One synthetic ledger with a NUL in every channel the adapter stores text from: an ask, an ask the
 * recorder shortened, the agent's words, a command, a command's output (1, 1 and 4
 * NULs per window), a written body, a head-truncated body, an Edit's written and replaced sides, a
 * written path, a delegation brief, and a linked child's own output. `NULS` is how many it holds.
 */
const NULS = 17;
function nulLedger() {
  const child = { ask: [], instructions: [{ turn: 1, text: `child brief${NUL} as the child saw it` }],
    ledger: [{ turn: 1, seq: 0, kind: 'bash', cmd: 'cat blob.bin', outcome: 'passed', exitCode: 0,
      tailLines: [`child${NUL}output line`] }],
    commentary: [], sayings: [], marks: [], claim: { finalMessage: '' }, dropped: [] };
  return {
    ask: [
      { turn: 1, text: `Run the build and fix what${NUL} breaks.` },                                   // 1
      { turn: 3, text: `Fix${NUL} the parser.\n[code block, 40 lines, 1200 chars]\nKeep${NUL} it green.`,  // 2
        elided: [{ what: 'code block', chars: 1200 }] },
    ],
    commentary: [{ turn: 1, beforeEvent: 0, text: `Running the build${NUL} now.`, record: 0, block: 0 }], // 1
    ledger: [
      { turn: 1, seq: 0, kind: 'bash', cmd: `printf 'a${NUL}b' > out.bin`, outcome: 'failed', exitCode: 1,  // 1
        tailLines: [`head${NUL}tail of the build log`, `x${NUL}${NUL}y`, `binary${NUL} noise`] },          // 4
      { turn: 1, seq: 1, kind: 'create', path: `src/gen${NUL}.js`,                                          // 1
        after: { text: `export const sep = "${NUL}";\n` }, result: { seen: true, outcome: 'succeeded', provenance: 'native' } }, // 1
      { turn: 1, seq: 2, kind: 'create', path: 'src/big.js',
        after: { text: `const big${NUL}head = 1;\n[… truncated at 100 chars …]`, truncated: true } },   // 1
      { turn: 1, seq: 3, kind: 'edit', path: 'src/b.js',
        after: { text: `new${NUL} line\n⟪→⟫\nold${NUL} line`, parts: 1 } },                      // 2
    ],
    delegations: [{ turn: 1, status: 'linked', kind: 'spawn', childId: '0123456789abcdef', link: { source: 0 },
      parentInstruction: { text: `delegate${NUL} the migration`, tool: 'Agent' } }],                         // 1
    children: [{ source: 0, ledger: child }],                                                                // 2
    sayings: [], marks: [], claim: { finalMessage: '' }, dropped: [],
  };
}

/** The production order: redaction first, then the canonical adapter. */
const nulSession = () => sessionFromLedger(redact(nulLedger()).ledger, { sessionKey: 'w3e6' });

/** Every text the session can put in a request: the blobs, and the paths rendered from event fields
 *  (an action's path once, though its changes repeat it — it is one recorded path). */
function storedText(session) {
  const paths = session.events.flatMap((e) => [...new Set([...(e.paths ?? []).map((p) => p.path),
    ...(e.changes ?? []).map((c) => c.path)])]);
  return [...Object.values(session.blobs), ...paths.filter((p) => typeof p === 'string')];
}

// ---- F213 ------------------------------------------------------------------------------------------

test('F213 premise: the synthetic ledger carries NULs through redaction, where the adapter receives them', () => {
  const input = JSON.stringify(nulLedger());
  assert.equal(count(input, '\\u0000'), NULS, 'the fixture holds exactly NULS NULs');
  assert.equal(count(input, SYMBOL), 0, 'and no symbol of its own, so every symbol stored is a replacement');
  assert.equal(count(JSON.stringify(redact(nulLedger()).ledger), '\\u0000'), NULS, 'redaction keeps every one');
});

test('F213 the evidence store never holds a NUL: each is stored as U+2400, and the session counts them exactly', () => {
  const session = nulSession();
  const stored = storedText(session);
  assert.equal(stored.filter((t) => t.includes(NUL)).length, 0, 'no stored text carries a NUL');
  assert.equal(stored.reduce((n, t) => n + count(t, SYMBOL), 0), NULS, 'every NUL is one symbol, none lost or doubled');
  assert.equal(session.controlCharsReplaced, NULS, 'the count is exact, the transferred child\'s included');
  // The text is complete — one symbol is spelled differently — so nothing is declared missing: the
  // gaps are exactly those of the same record with every NUL an ordinary letter.
  const plain = JSON.parse(JSON.stringify(nulLedger()).replaceAll('\\u0000', 'x'));
  const plainSession = sessionFromLedger(redact(plain).ledger, { sessionKey: 'w3e6' });
  assert.equal(plainSession.controlCharsReplaced, 0);
  assert.deepEqual(session.adapterGaps, plainSession.adapterGaps);
});

test('F213 one character for one: extents and byte offsets stay valid around the multi-byte symbol', () => {
  const session = nulSession();
  const create = session.events.find((e) => e.id === 'A1-1');
  assert.equal(create.changes[0].extent.chars, 'export const sep = "\0";\n'.length);
  const big = session.events.find((e) => e.id === 'A1-2').changes[0];
  assert.equal(session.textOf(big, 'after'), `const big${SYMBOL}head = 1;`, 'the recorder\'s stub is still cut out');
  assert.equal(big.extent.chars, `const big${NUL}head = 1;`.length);
  assert.equal(big.extent.cap, 100);
  const [edit] = session.events.find((e) => e.id === 'A1-3').changes;
  assert.equal(session.textOf(edit, 'after'), `new${SYMBOL} line`);
  assert.equal(session.textOf(edit, 'before'), `old${SYMBOL} line`);
  const elided = session.events.find((e) => e.id === 'I3');
  assert.equal(session.textOf(elided, 'text'), `Fix${SYMBOL} the parser.\n\nKeep${SYMBOL} it green.`,
    'head and tail around the recorder\'s stub, each at its own byte offsets');
});

test('F213 no request carries a NUL; each carries the symbol, and a receipt quoting the symbol verifies', async () => {
  const session = nulSession();
  const requests = [];
  const report = await runReview({ session, pr: PR, judge: async (request) => { requests.push(request); return EMPTY_NARRATIVE(); } });
  assert.ok(requests.length >= 1, 'premise: the window was asked about');
  assert.equal(report.windowFailures.length, 0, JSON.stringify(report.windowFailures));
  for (const request of requests) {
    assert.ok(!request.system.includes(NUL) && !request.prompt.includes(NUL), `${request.label} carries a NUL`);
  }
  const prompt = requests.map((r) => r.prompt).join('\n');
  for (const span of [`head${SYMBOL}tail of the build log`, `x${SYMBOL}${SYMBOL}y`, `src/gen${SYMBOL}.js`,
    `printf 'a${SYMBOL}b'`, `Keep${SYMBOL} it green.`, `child${SYMBOL}output line`])
    assert.ok(prompt.includes(span), `the prompt shows ${JSON.stringify(span)}`);

  // Quotes that contain the symbol verify against the stored text by string search, as every quote does.
  const receipts = [
    { eventId: 'A1-0-r', role: 'observation', quote: `head${SYMBOL}tail of the build log` },
    { eventId: 'A1-0-r', role: 'observation', quote: `x${SYMBOL}${SYMBOL}y` },
    { eventId: 'A1-0', role: 'action', quote: `printf 'a${SYMBOL}b'` },
    { eventId: 'A1-1', role: 'action', quote: `src/gen${SYMBOL}.js` },
    { eventId: 'A1-1', role: 'code', quote: `sep = "${SYMBOL}"` },
    { eventId: 'I1', role: 'instruction', quote: `what${SYMBOL} breaks` },
    { eventId: 'I3', role: 'instruction', quote: `Keep${SYMBOL} it green` },
  ];
  for (const receipt of receipts)
    assert.equal(verifyReceipt(session, receipt).ok, true, JSON.stringify(receipt));
  // And a quote that still spells the NUL cannot: the session no longer contains one.
  assert.equal(verifyReceipt(session, { eventId: 'A1-0-r', role: 'observation', quote: `head${NUL}tail` }).ok, false);
});

test('F213 the real judge sends the request it used to refuse (its NUL check stays)', async () => {
  const session = nulSession();
  const spawned = [];
  const judge = createReviewJudge({ config: { backend: 'claude-cli', model: 'sonnet' }, env: {},
    // Records that the transport was reached, then fails the way a missing binary does. No process starts.
    spawnProcess: (command) => { spawned.push(command); throw new Error('synthetic: no process is started'); } });
  const report = await runReview({ session, pr: PR, judge });
  assert.equal(spawned.length, report.windowResults.length, 'every window reached the transport');
  for (const window of report.windowResults) {
    assert.equal(window.failure, 'model_unavailable', 'the stub transport failed, as stubbed');
    assert.equal(window.shortfall.transport, 'spawn_failed');
  }
  // The last line of defence is still there.
  await assert.rejects(judge({ system: 'synthetic', prompt: `a${NUL}b` }), (error) => error.code === 'invalid_model_input');
});

test('F213 a session with no NUL is stored byte for byte as before, and counts zero', () => {
  const clean = sessionFromLedger(redact({ ask: [{ turn: 1, text: `a literal ${SYMBOL} typed by the human` }],
    ledger: [{ turn: 1, seq: 0, kind: 'bash', cmd: 'npm test', outcome: 'passed', exitCode: 0, tailLines: ['ok'] }],
    commentary: [], sayings: [], marks: [], claim: { finalMessage: '' }, dropped: [] }).ledger);
  assert.equal(clean.controlCharsReplaced, 0);
  assert.deepEqual(Object.values(clean.blobs), [`a literal ${SYMBOL} typed by the human`, 'npm test', 'ok'],
    'a symbol the session itself wrote is kept, and not counted as a replacement');
});

// ---- F214 ------------------------------------------------------------------------------------------

/** A session whose one blob still carries a NUL, built without the adapter: what the judge refuses. */
function unsendableSession() {
  const blobs = { ask: `SYNTHETIC_W3E6 ask${NUL}with a NUL the adapter never saw`, cmd: 'npm test' };
  const whole = (key) => [{ sourceKey: key, fromByte: 0, untilByte: Buffer.byteLength(blobs[key], 'utf8') }];
  return new Session({ sessionKey: 'w3e6-unsendable', adapter: 'claude', blobs, events: [
    { id: 'I1', kind: 'instruction', sequence: 0, authority: 'human', supersedes: [], text: whole('ask') },
    { id: 'A1', kind: 'invocation', sequence: 1, callKey: 'A1', tool: 'bash', operation: 'command', paths: [],
      command: whole('cmd'), input: [], changes: [] },
  ] });
}

test('F214 invalid_model_input is a declared judge failure code, not retryable, and maps to its own shortfall', () => {
  assert.ok(ledgerModule.JUDGE_FAILURE_CODES.includes('invalid_model_input'));
  assert.ok(!ledgerModule.RETRYABLE_JUDGE_CODES.includes('invalid_model_input'), 'retrying cannot help');
  assert.ok(reviewRun.NARRATIVE_SHORTFALL.includes('input_invalid'));
  assert.ok(reviewRun.WINDOW_INCOMPLETE_REASONS.includes('narrative:input_invalid'));
  assert.equal(typeof reviewRender.SHORTFALL_SENTENCE.input_invalid, 'string');
  assert.deepEqual(reviewRun.windowIncompleteReasons({ failure: 'invalid_model_input' }), ['narrative:input_invalid']);
});

test('F214 a judge that refuses the input: the window, the CLI completion line and the report say input_invalid', async () => {
  const session = unsendableSession();
  const judge = async () => { const e = new Error('invalid_model_input'); e.code = 'invalid_model_input'; throw e; };
  const report = await runReview({ session, pr: PR, judge });
  const [window] = report.windowResults;
  assert.equal(window.failure, 'invalid_model_input');
  assert.equal(window.shortfall.narrative, 'input_invalid');
  assert.equal(window.shortfall.transport, null, 'no transport was involved: the request was never sent');
  assert.deepEqual(report.windowFailures, [{ window: 1, reason: 'invalid_model_input' }]);
  assert.deepEqual(report.instrument.windowCompletion.byReason, { 'narrative:input_invalid': 1 });

  const line = windowCompletionLine(report.instrument.windowCompletion);
  assert.equal(line, 'Windows complete: 0 of 1; incomplete: narrative:input_invalid ×1');
  assert.ok(!line.includes('model_unavailable'));

  const md = reviewRender.renderReview(report);
  assert.ok(md.includes(reviewRender.SHORTFALL_SENTENCE.input_invalid), 'the reader is told the request was never sent');
  assert.ok(!md.includes(reviewRender.SHORTFALL_SENTENCE.model_unavailable), 'never that the model could not be reached');
});

test('F214 through the real judge and its retry wrapper: refused once, never retried, never sent', async () => {
  const session = unsendableSession();
  let spawned = 0, calls = 0;
  const real = createReviewJudge({ config: { backend: 'claude-cli', model: 'sonnet' }, env: {},
    spawnProcess: () => { spawned++; throw new Error('synthetic: must not be reached'); } });
  const judge = withTransportRetry(async (request) => { calls++; return real(request); });
  const report = await runReview({ session, pr: PR, judge });
  assert.equal(spawned, 0, 'the request was never sent');
  assert.equal(calls, 1, 'not retryable: an identical request is refused identically');
  assert.equal(report.windowResults[0].shortfall.narrative, 'input_invalid');
  assert.equal(windowCompletionLine(report.instrument.windowCompletion),
    'Windows complete: 0 of 1; incomplete: narrative:input_invalid ×1');
});
