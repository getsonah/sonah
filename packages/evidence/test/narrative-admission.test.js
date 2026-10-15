// Source bytes control segmentation; serialized transport bytes control model admission.
// All content and judge replies here are synthetic.
import test from 'node:test';
import assert from 'node:assert/strict';
import { Session, verifyReceipt } from '../src/session.js';
import { runReview } from '../src/run-review.js';
import { MAX_REVIEW_INPUT_BYTES, requestFits, reviewInputBytes } from '../src/challenge.js';
import { planWindows, COMBINED_WINDOW_SETTINGS, bytesOfTokens } from '../src/windows.js';
import { buildEvents } from '../../slicer/src/events.js';
import { redact } from '../../redact/index.js';
import { sessionFromLedger } from '../adapters/sonah-ledger.js';

const EMPTY = { decisions: [], pivots: [], claims: [], requirements: [] };

test('a 17 KB human turn keeps its middle constraint through review and receipt checking', async () => {
  const constraint = 'Do not change the public API.';
  const raw = 'START ' + 'x'.repeat(8500) + constraint + 'y'.repeat(8400) + ' END';
  const built = buildEvents([{ kind: 'user', adapter: 'claude', raw: { type: 'user',
    message: { role: 'user', content: raw } } }]);
  assert.deepEqual(built.ask[0].elided ?? [], []);
  const ledger = redact({ ask: built.ask, ledger: built.events, claim: {} }).ledger;
  const session = sessionFromLedger(ledger, { sessionKey: 'synthetic-long-ask' });
  // C-01 event identity: the ask's event, found by what it is (the session's one instruction).
  assert.equal(verifyReceipt(session,
    { eventId: session.events.find((event) => event.kind === 'instruction').id, role: 'instruction', quote: constraint }).ok, true);
  assert.ok(!session.adapterGaps.some((gap) => gap.channel === 'instructions'
    && String(gap.note ?? '').includes('elided by the recorder')));
  let calls = 0;
  const report = await runReview({ session, judge: async (request) => {
    calls++;
    assert.ok(requestFits(request));
    assert.ok(request.prompt.includes(constraint));
    return EMPTY;
  } });
  assert.equal(calls, 1);
  assert.equal(report.instrument.windowCompletion.complete, 1);
});

function sessionWithCommentary(length) {
  const body = 'SYNTHETIC_SOURCE_' + 'x'.repeat(length);
  return new Session({ sessionKey: 'synthetic-admission', adapter: 'claude',
    blobs: { long: body }, events: [{ id: 'C1', sequence: 0, kind: 'commentary',
      phase: 'working', text: [{ sourceKey: 'long', fromByte: 0,
        untilByte: Buffer.byteLength(body) }] }] });
}

function sessionWithPair(actionLength, resultLength) {
  const action = 'SYNTHETIC_ACTION_' + 'a'.repeat(actionLength);
  const result = 'SYNTHETIC_RESULT_' + 'o'.repeat(resultLength);
  return new Session({ sessionKey: 'synthetic-pair-admission', adapter: 'claude',
    blobs: { action, result }, events: [
      { id: 'A1', sequence: 0, kind: 'invocation', tool: 'Bash', operation: 'command',
        paths: [], command: [{ sourceKey: 'action', fromByte: 0, untilByte: Buffer.byteLength(action) }],
        input: [], changes: [] },
      { id: 'O1', sequence: 1, kind: 'observation', invocation: 'A1', phase: 'terminal',
        result: 'unknown', output: [{ sourceKey: 'result', fromByte: 0,
          untilByte: Buffer.byteLength(result) }] },
    ] });
}

test('an isolated source-over-budget event is reviewed when its complete request fits transport', async () => {
  const session = sessionWithCommentary(200_000);
  // M35: a thought is shown in full, so one over a combined review's work budget is an oversize window of its own.
  const [window] = planWindows(session, COMBINED_WINDOW_SETTINGS);
  assert.equal(window.oversize, true);
  assert.ok(window.workBytes > bytesOfTokens(COMBINED_WINDOW_SETTINGS.workTokens));
  let calls = 0;
  const report = await runReview({ session, judge: async (request) => {
    calls++;
    assert.ok(reviewInputBytes(request) <= MAX_REVIEW_INPUT_BYTES);
    assert.ok(request.prompt.includes('SYNTHETIC_SOURCE_' + 'x'.repeat(200_000)));
    return EMPTY;
  } });
  assert.equal(calls, 1);
  assert.equal(report.instrument.windowCompletion.complete, 1);
  assert.deepEqual(report.instrument.windowCompletion.byReason, {});
});

test('a complete request over transport limit remains unchecked without calling the judge', async () => {
  const session = sessionWithCommentary(MAX_REVIEW_INPUT_BYTES);
  assert.equal(planWindows(session, COMBINED_WINDOW_SETTINGS)[0].oversize, true);
  let calls = 0;
  const report = await runReview({ session, judge: async () => { calls++; return EMPTY; } });
  assert.equal(calls, 0);
  assert.deepEqual(report.instrument.windowCompletion.byReason, { 'narrative:budget': 1 });
});

test('M35 a large action and its result are reviewed together (M36: the action whole up to the work budget, the result trimmed)', async () => {
  // M36 phase 2 (D68 P; C-07 "M36 window format"): a command is what the agent produced — whole, unless it is larger than
  // the window's whole work budget alone (a combined window's 196,606 bytes), when its head and tail are shown up to that
  // budget with the gap declared (`action_over_budget`); its result is cut to its first and last 1k tokens.
  const budget = bytesOfTokens(COMBINED_WINDOW_SETTINGS.workTokens);
  for (const [action, result] of [[150_000, 150_000], [300_000, 300_000], [400_000, 150_000]]) {
    const session = sessionWithPair(action, result);
    assert.equal(planWindows(session, COMBINED_WINDOW_SETTINGS).length, 1, 'never split apart');
    let calls = 0;
    const report = await runReview({ session, judge: async (request) => {
      calls++;
      assert.ok(reviewInputBytes(request) <= MAX_REVIEW_INPUT_BYTES);
      assert.ok(request.prompt.includes('SYNTHETIC_ACTION_aaa') && request.prompt.includes('SYNTHETIC_RESULT_ooo'));
      assert.equal(request.prompt.includes('a'.repeat(action)), action <= budget, 'the command whole within the budget');
      assert.ok(!request.prompt.includes('a'.repeat(budget)), 'never more than the budget of it');
      assert.equal(/\(action_over_budget: larger than a window's whole work budget\)/.test(request.prompt), action > budget);
      assert.ok(!request.prompt.includes('o'.repeat(10_000)), 'the result trimmed');
      assert.match(request.prompt, /omitted: line 1 of this output, [\d,]+ UTF-8 bytes, is not shown; line 1 in part/);
      return EMPTY;
    } });
    assert.equal(calls, 1);
    assert.equal(report.instrument.windows, 1);
    assert.equal(report.instrument.windowCompletion.complete, 1);
    assert.ok(!report.gaps.some((gap) => gap.code === 'input_limit'), 'no split pair, no gap');
  }
});
