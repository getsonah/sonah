// W3c-4 — the report says what happened. Four render defects, each a line that either lied or
// said nothing:
//   F89 an unmatched challenge reason rendered the literal `undefined`.
//   F91 only the first shortfall of a window was shown; a second, concurrent one was hidden.
//   F61 a non-delegate invocation's command was escaped but never bounded, so a 4,000-character
//       shell command rendered a 4,000-character timeline line.
//   F77 a receipt code snapped to the recorded text rendered exactly like a verbatim model quote.
// Synthetic input only: no model, no provider, no recording.

import test from 'node:test';
import assert from 'node:assert/strict';
import { Session } from '../src/session.js';
import { renderReview, renderTimeline } from '../src/review.js';

const EXCERPT_CHARS = 160; // matches src/review.js; frozen there

function put(blobs, key, text) {
  blobs[key] = text;
  return [{ sourceKey: key, fromByte: 0, untilByte: Buffer.byteLength(text, 'utf8') }];
}

const shell = (over) => ({
  repo: { host: 'github.com', id: '1' }, pr: { number: 7, files: [] }, session: null,
  hasSessionEvidence: true, decisions: [], findings: [], rejectedDecisions: [], rejectedFindings: [],
  gaps: [], counts: { decisions: 0, byColumn: {}, uncheckedColumn: 0, rejectedDecisions: 0, rejectedFindings: 0 },
  coverage: 'partial', codeCoverage: 'missing', ...over,
});

const ok = { narrative: 'ok', challenge: { passes: 3, validVotes: 3, reason: null },
  grounding: { receipts: 2, verified: 2, rejected: 0, repaired: 0 } };
const shortfall = (over) => ({ ...ok, ...over });
const windowLines = (md, n) => md.split('\n').filter((line) => line.startsWith(`- window ${n}:`));

// ---- F89: no `undefined` -------------------------------------------------------------------

test('an unknown challenge reason renders a closed fallback, never `undefined` (F89)', () => {
  const md = renderReview(shell({ windowResults: [{ shortfall: shortfall({
    challenge: { passes: 3, validVotes: 1, reason: 'SYNTHETIC_UNKNOWN_REASON' } }) }] }));
  const lines = windowLines(md, 1);
  assert.equal(lines.length, 1, `the window fell short and must say so once:\n${md}`);
  assert.doesNotMatch(md, /undefined/, 'an unmatched reason is not the word "undefined"');
  assert.ok(!md.includes('SYNTHETIC_UNKNOWN_REASON'), 'an unknown token is not printed bare either');
  assert.match(lines[0], /\(1 valid votes of 3 passes\)/, 'the counts are code-owned and still shown');
});

test('a shortfall with missing or non-integer counts prints no count rather than `undefined` (F89)', () => {
  const md = renderReview(shell({ windowResults: [
    { shortfall: shortfall({ challenge: { reason: 'votes_invalid' } }) },
    { shortfall: shortfall({ grounding: { rejected: 2 } }) },
    { shortfall: shortfall({ grounding: { rejected: 'two', receipts: null } }) },
  ] }));
  assert.doesNotMatch(md, /undefined|null|NaN/);
  assert.equal(windowLines(md, 1).length, 1);
  assert.equal(windowLines(md, 2).length, 1);
  assert.match(windowLines(md, 2)[0], /2 receipts did not verify/);
  assert.equal(windowLines(md, 3).length, 0, 'a count that is not a count is not a rejection');
});

// ---- F91: every shortfall of a window ------------------------------------------------------

test('a window whose receipts did not verify AND whose challenge fell short shows both (F91)', () => {
  const md = renderReview(shell({ windowResults: [{ shortfall: shortfall({
    challenge: { passes: 3, validVotes: 2, reason: 'votes_invalid' },
    grounding: { receipts: 4, verified: 3, rejected: 1, repaired: 0 } }) }] }));
  const lines = windowLines(md, 1);
  assert.equal(lines.length, 2, `two shortfalls, two lines:\n${md}`);
  assert.ok(lines.some((l) => /1 of 4 receipts did not verify/.test(l)), 'the grounding shortfall');
  assert.ok(lines.some((l) => /a challenge pass returned no usable vote \(2 valid votes of 3 passes\)/.test(l)),
    'the challenge shortfall, which the first-only renderer hid');
});

test('a window whose model call failed and whose receipts did not verify reports both (F91)', () => {
  // A renderer contract: a record may carry a narrative shortfall and a grounding shortfall at
  // once, and both are said. (The window-capsule reuse path that produced such records until D60
  // is gone; the renderer still says every fact a record holds.)
  const md = renderReview(shell({ windowResults: [{ shortfall: shortfall({
    narrative: 'model_unavailable',
    grounding: { receipts: 3, verified: 1, rejected: 2, repaired: 0 } }) }] }));
  const lines = windowLines(md, 1);
  assert.equal(lines.length, 2, `two shortfalls, two lines:\n${md}`);
  assert.ok(lines.some((l) => /the model could not be reached/.test(l)));
  assert.ok(lines.some((l) => /2 of 3 receipts did not verify/.test(l)));
});

test('a window the model never answered does not also claim a challenge left a candidate unresolved (F91)', () => {
  // run-review records the untouched default challenge for a window with no narrative, which
  // reduces to `items_unresolved` — a consequence of the narrative failure, not a second fact.
  // Printing it would say a candidate existed when none did.
  const md = renderReview(shell({ windowResults: [{ shortfall: shortfall({
    narrative: 'model_unavailable',
    challenge: { passes: 3, validVotes: 0, reason: 'items_unresolved' },
    grounding: { receipts: 0, verified: 0, rejected: 0, repaired: 0 } }) }] }));
  const lines = windowLines(md, 1);
  assert.equal(lines.length, 1, `one shortfall happened:\n${md}`);
  assert.match(lines[0], /the model could not be reached/);
});

// ---- F61: a non-delegate invocation's body is bounded -------------------------------------

function longCommandSession(command) {
  const blobs = {};
  const events = [
    { id: 'L1', kind: 'instruction', sequence: 0, authority: 'human', supersedes: [],
      text: put(blobs, 'ask', 'Run the synthetic generator.') },
    { id: 'L2', kind: 'invocation', sequence: 1, tool: 'Bash', operation: 'execute',
      paths: [], command: put(blobs, 'cmd', command), input: [], changes: [] },
    { id: 'L3', kind: 'observation', sequence: 2, invocation: 'L2', phase: 'terminal',
      result: 'succeeded', exitCode: 0, output: put(blobs, 'out', 'generated') },
  ];
  return new Session({ sessionKey: 'w3c4-long-command', events, blobs });
}

const lineFor = (lines, id) => {
  const found = lines.filter((l) => l.includes(`\`${id}\``));
  assert.equal(found.length, 1);
  return found[0];
};

test('a 4,000-character shell command renders a bounded excerpt, not a 4,000-character line (F61)', () => {
  const command = Array.from({ length: 200 }, (_, n) => `echo synthetic step ${n};`).join(' ').slice(0, 4000);
  assert.ok(command.length >= 3900, 'the fixture must actually be long');
  const session = longCommandSession(command);
  const line = lineFor(renderTimeline(session, { findings: [], decisions: [] }), 'L2');
  const body = line.slice(line.indexOf('`Bash` ') + '`Bash` '.length);
  assert.ok(body.length <= EXCERPT_CHARS + 20, `the command body rendered ${body.length} characters`);
  assert.ok(body.startsWith('echo synthetic step 0;'), 'the opening of the command stays');
  assert.ok(body.endsWith(' …'), 'the cut is declared, never silent');
});

test('an action receipt deep in a long command still shows its quote, in a bounded window (F61)', () => {
  const command = Array.from({ length: 200 }, (_, n) => `echo synthetic step ${n};`).join(' ');
  const quote = 'echo synthetic step 150;';
  assert.ok(command.indexOf(quote) > 3000);
  const session = longCommandSession(command);
  const report = { findings: [{ origin: 'session-review', kind: 'code_issue', title: 't',
    explanation: 'e', scope: 'session-effect', anchor: null,
    receipts: [{ role: 'action', eventId: 'L2', quote }] }], decisions: [] };
  const line = lineFor(renderTimeline(session, report), 'L2');
  assert.ok(line.includes(quote), `the cited span must stay visible:\n${line}`);
  assert.ok(line.length < 500, `bounded, not the whole command — rendered ${line.length} characters`);
});

// ---- F77: repaired receipts are marked -----------------------------------------------------

const finding = (receipts) => ({ origin: 'session-review', kind: 'claim_contradicted',
  title: 'Synthetic finding', explanation: 'Synthetic explanation.', scope: 'session-effect',
  anchor: null, status: 'FYI', receipts });

test('a receipt with repaired: true is marked, and the footer counts every one (F77)', () => {
  const exact = { eventId: 'R1', role: 'commentary', quote: 'SYNTHETIC exact quote' };
  const snapped = { eventId: 'R2', role: 'observation', quote: 'SYNTHETIC snapped quote', repaired: true,
    original: 'SYNTHETIC snaped quote' };
  const pivotSnapped = { eventId: 'R3', role: 'action', quote: 'SYNTHETIC pivot quote', repaired: true };
  const md = renderReview(shell({ findings: [finding([exact, snapped])],
    pivots: [{ abandoned: 'plan A', adopted: 'plan B', receipts: [pivotSnapped] }] }));
  const lineOf = (quote) => md.split('\n').find((l) => l.includes(quote));

  assert.match(lineOf('SYNTHETIC snapped quote'), /” · repaired$/, 'the mark follows the quote');
  assert.match(lineOf('SYNTHETIC pivot quote'), /” · repaired$/);
  assert.doesNotMatch(lineOf('SYNTHETIC exact quote'), /repaired/, 'an exact quote carries no mark');
  assert.ok(md.includes('2 receipt quote(s) were snapped to the exact recorded text by code'),
    `the footer counts the repaired receipts:\n${md}`);
  assert.ok(!md.includes('SYNTHETIC snaped quote'), 'the pre-repair text is not rendered as evidence');
});

test('a repaired receipt on a decision card is marked too (F77)', () => {
  const stated = { eventId: 'D2', role: 'commentary', quote: 'SYNTHETIC decision quote', repaired: true };
  const decision = { dimension: 'cache', chosen: 'Redis', column: 'unasked', valueState: 'unchecked',
    materiality: 'material', materialityRule: 'synthetic', relevance: 'survives', stated };
  const md = renderReview(shell({ decisions: [decision],
    counts: { decisions: 1, byColumn: { 'asked-settled': 0, 'asked-chose': 0, unasked: 1 }, uncheckedColumn: 0 } }));
  assert.match(md.split('\n').find((l) => l.includes('SYNTHETIC decision quote')), /” · repaired$/);
  assert.ok(md.includes('1 receipt quote(s) were snapped to the exact recorded text by code'));
});

test('with no repaired flag the renderer shows nothing extra (F77)', () => {
  const md = renderReview(shell({ findings: [finding([
    { eventId: 'R1', role: 'commentary', quote: 'SYNTHETIC exact quote' },
    { eventId: 'R2', role: 'observation', quote: 'SYNTHETIC other quote', repaired: 'yes' }])] }));
  assert.doesNotMatch(md, /repaired|snapped/, 'only a strictly true flag is a claim that code repaired it');
});
