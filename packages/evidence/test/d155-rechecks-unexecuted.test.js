// D155: a decision that the window's check refuted gets a second check (W1 A's existence check, and G2's on a choice
// not to act anchored anew). When that check does not run for it (a call that failed after its retry or was not
// retried, a budget stop, or a reply that left the item out, or could not be read, even after its re-ask), the decision
// stays out, as before: its first check refuted it. What changes: the report names how many (review.js
// `uncappedCauses`, the cause `rechecks_unexecuted`, run-review.js `rechecksUnexecuted`), and nothing else moves (the
// window stays complete, so the exit code and the run's profile stay as they were). The fix round: the count is of
// decisions by identity, not of window copies, and leaves out a decision another window kept; it counts only a run
// that asking again can run, and names that run's label prefix, whose stored answers a finished review forgets
// (`rechecksToReask`), so the remedy, run the same review again, holds.
//
// Every recording here is synthetic; no model is called: the judges are code.
import test from 'node:test';
import assert from 'node:assert/strict';
import { load, humanAsk, said, call, result } from './m33-u-unasked-fixture.js';
import { Session } from '../src/session.js';
import { bytesOfTokens } from '../src/windows.js';
import { runReview, planWindowRequests, windowIncompleteReasons, windowCompletion, rechecksUnexecuted,
  rechecksToReask, recheckResendable, WINDOW_INCOMPLETE_REASONS } from '../src/run-review.js';
import { coverageCauses, uncappedCauses, UNCAPPED_CAUSES, UNCAPPED_CAUSES_SAID_WHOLE, COVERAGE_CAUSES,
  COVERAGE_SENTENCE } from '../src/review.js';
import { RESOLUTION_CHALLENGE_OUTCOMES } from '../src/ledger.js';

const ASK = 'Rename the --out flag of the export command to --output, update its tests, and run the suite.';
const PLAN = 'First I will look at how the export command reads its flags.';
const STOP = 'I have left the code as it was and am stopping here to ask you.';
const COMMAND = 'cat src/export.js';
const rows = () => [
  humanAsk(ASK),
  said(PLAN),
  call('r1', 'Bash', { command: COMMAND, description: 'Read the export command' }),
  result('r1', "program.option('--out <dir>');", { stdout: "program.option('--out <dir>');",
    stderr: '', interrupted: false, isImage: false, noOutputExpected: false }, false),
  said(`${STOP} Should --out keep working beside --output, or go away?`),
].map((r, i) => ({ ...r, uuid: `u-d155-${i + 1}` }));

const quote = (eventId, role, text) => ({ eventId, role, quote: text });
const narrative = (decisions) => ({ requirements: [], claims: [], pivots: [], decisions });
async function fixture(t) {
  const { session } = await load(t, rows());
  const [plan, stop] = session.events.filter((event) => event.kind === 'commentary');
  return { session, ask: session.events.find((event) => event.kind === 'instruction'), plan, stop };
}
/** A choice not to act, anchored on the plan sentence, whose column says the ask settled it. */
const choice = (n, extra = {}) => ({ dimension: 'whether to stop and ask before renaming the flag',
  chosen: 'did not rename the flag; stopped to ask the human first', value: null, valueReceipt: null, actions: [],
  notActing: true, stated: quote(n.plan.id, 'commentary', PLAN), constrainedBy: { instruction: quote(n.ask.id,
    'instruction', 'Rename the --out flag of the export command to --output'), settles: true,
  settledValueQuote: 'to --output' }, instructionReview: null, ...extra });
/** The same choice on the agent's own words, as G2's re-ask gives it. */
const restated = (n) => choice(n, { stated: quote(n.stop.id, 'commentary', STOP) });

const isExists = (request) => /^challenge:w\d+:exists:/.test(request.label);
const isReanchor = (request) => /^challenge:w\d+:reanchor:/.test(request.label);
const isReask = (request) => /^narrative:w\d+:reanchor:/.test(request.label);
const fail = () => { throw Object.assign(new Error('model_unavailable'), { code: 'model_unavailable' }); };
/**
 * A judge in code. The window's own check refutes the decision. W1 A's existence check votes `exists(pass)`, G2's
 * existence check on the re-anchored choice `reanchored(pass)`; `'omit'` is a reply that leaves the item out, `'bad'` a
 * reply Sonah cannot read, and a throw a failed call. Every request is kept in `seen`.
 */
function judgeOf(n, { exists = () => 'refuted', reanchored = () => 'refuted', seen = [] } = {}) {
  return async (request) => {
    seen.push(request);
    if (request.challenge) {
      const pass = Number(/:p(\d+)$/.exec(request.label)?.[1]);
      const verdict = isExists(request) ? exists(pass) : isReanchor(request) ? reanchored(pass) : 'refuted';
      if (verdict === 'omit') return { votes: [] };
      if (verdict === 'bad') return { votes: [{ key: 'SYNTHETIC_FOREIGN', verdict: 'refuted' }] };
      return { votes: request.challenge.items.map((item) => ({ key: item.key, verdict,
        explanation: `SYNTHETIC_D155 (pass ${pass}).`, receipts: [item.candidate.stated] })) };
    }
    if (isReask(request)) return narrative([restated(n)]);
    return narrative([choice(n)]);
  };
}
const review = (n, judge) => runReview({ session: n.session, pr: null, reviewScope: 'session-only', judge });
const causeOf = (report) => uncappedCauses(report).find(([cause]) => cause === 'rechecks_unexecuted') ?? null;

test('D155: a second check that did not run is counted, its decision stays out, its window stays complete, and its run '
  + 'is named to be asked again', async (t) => {
  const n = await fixture(t);
  // W1 A's existence check: a failed call (after the transport's retry), a reply that leaves the item out even after
  // its re-ask (stored, so the forget is what makes the remedy hold), a reply Sonah cannot read, and one pass of three
  // failed. G2's: a failed call on the choice anchored anew.
  for (const [name, judging, member, prefix] of [
    ['W1 A, a failed call', { exists: fail }, 'recolumn', 'challenge:w1:exists:'],
    ['W1 A, a reply that leaves it out', { exists: () => 'omit' }, 'recolumn', 'challenge:w1:exists:'],
    ['W1 A, a reply Sonah cannot read', { exists: () => 'bad' }, 'recolumn', 'challenge:w1:exists:'],
    ['W1 A, one pass of three failed', { exists: (pass) => (pass === 1 ? fail() : 'not-refuted') }, 'recolumn',
      'challenge:w1:exists:'],
    ['G2, a failed call', { reanchored: fail }, 'reanchor', 'challenge:w1:reanchor:'],
  ]) {
    const seen = [];
    const report = await review(n, judgeOf(n, { seen, ...judging }));
    const [window] = report.windowResults;
    assert.equal(window[member].existence.unexecuted, 1, `${name}: the record counts it`);
    assert.equal(report.decisions.length, 0, `${name}: the decision stays out, as before`);
    assert.equal(report.counts.rechecksUnexecuted, 1, `${name}: the review states the count`);
    assert.equal(rechecksUnexecuted(report), 1, name);
    assert.deepEqual(causeOf(report), ['rechecks_unexecuted', { n: 1 }], name);
    assert.deepEqual(rechecksToReask(report.windowResults), [prefix], `${name}: the run whose answers are forgotten`);
    const own = member === 'recolumn' ? isExists : isReanchor;
    assert.ok(seen.some((request) => request.label.startsWith(prefix)), `${name}: the prefix names the run's requests`);
    assert.ok(seen.every((request) => !request.label.startsWith(prefix) || own(request)), `${name}: and only them`);
    // Only an uncapped cause: no capping cause names it, the window stays complete, and so does the review's run.
    assert.equal(coverageCauses(report).some(([cause]) => cause === 'rechecks_unexecuted'), false, name);
    assert.deepEqual(windowIncompleteReasons(window), [], name);
    assert.deepEqual(windowCompletion(report.windowResults), { windows: 1, complete: 1, byReason: {}, unexplained: 0 },
      name);
  }
});

test('D155: a second check that ran gives no cause, whatever it concluded, and nothing is forgotten', async (t) => {
  const n = await fixture(t);
  for (const [name, judging] of [
    ['W1 A refuted, G2 refuted', {}],
    ['W1 A unsettled', { exists: (pass) => (pass === 3 ? 'uncertain' : 'not-refuted') }],
    ['W1 A upheld', { exists: () => 'not-refuted' }],
    ['W1 A refuted, G2 upheld', { reanchored: () => 'not-refuted' }],
    ['W1 A refuted, G2 unsettled', { reanchored: (pass) => (pass === 2 ? 'uncertain' : 'not-refuted') }],
  ]) {
    const report = await review(n, judgeOf(n, judging));
    const [window] = report.windowResults;
    assert.ok(window.recolumn, `${name}: premise, W1 A's check was asked`);
    for (const member of ['recolumn', 'reanchor'])
      if (window[member]) assert.equal(window[member].existence.unexecuted, 0, `${name}: ${member}`);
    assert.equal(Object.hasOwn(report.counts, 'rechecksUnexecuted'), false, `${name}: the report keeps its counts`);
    assert.equal(rechecksUnexecuted(report), 0, name);
    assert.equal(causeOf(report), null, name);
    assert.deepEqual(rechecksToReask(report.windowResults), [], name);
  }
});

// ---- two windows: one decision, two copies --------------------------------------------------------------------------
const TEXT = {
  ask: 'SYNTHETIC_D155_ASK: rename the --out flag to --output.',
  ask2: 'SYNTHETIC_D155_ASK2: continue where you left off.',
  plan: 'SYNTHETIC_D155_PLAN: I will stop and ask before renaming the flag.',
  cat: 'cat /srv/x/big.log',
  big: 'y'.repeat(bytesOfTokens(3_000)),
};
/** Two windows split by size (M35): an ask, the agent's thought C1, 120k tokens of results; then a second ask and as
 *  much again. Window 2 is carried C1 and the first ask, so it can propose the same choice on the same words. */
function twoWindows() {
  const ref = (key) => [{ sourceKey: key, fromByte: 0, untilByte: Buffer.byteLength(TEXT[key], 'utf8') }];
  const events = [];
  const filler = (id, turn) => {
    events.push({ id, kind: 'invocation', callKey: id, tool: 'Bash', operation: 'command', paths: [],
      command: ref('cat'), input: [], changes: [], turn });
    for (let k = 0; k < 60; k++) events.push({ id: `${id}-r${k}`, kind: 'observation', invocation: id, callKey: id,
      phase: 'progress', result: 'succeeded', exitCode: null, output: ref('big'), sourceOfResult: 'native', turn });
  };
  events.push({ id: 'I1', kind: 'instruction', authority: 'human', supersedes: [], text: ref('ask'), turn: 'T1' });
  events.push({ id: 'C1', kind: 'commentary', phase: 'working', beforeInvocation: null, text: ref('plan'),
    turn: 'T1' });
  filler('F1', 'T1');
  events.push({ id: 'I2', kind: 'instruction', authority: 'human', supersedes: [], text: ref('ask2'), turn: 'T2' });
  filler('F2', 'T2');
  return new Session({ sessionKey: 'sess-d155-two', adapter: 'claude', blobs: { ...TEXT },
    events: events.map((event, sequence) => ({ ...event, sequence })), children: [] });
}
const TWO_CHOICE = { dimension: 'whether to stop and ask before renaming the flag', chosen: 'stopped to ask first',
  value: null, valueReceipt: null, actions: [], notActing: true,
  stated: quote('C1', 'commentary', 'I will stop and ask before renaming the flag'),
  constrainedBy: { instruction: quote('I1', 'instruction', 'rename the --out flag to --output'), settles: true,
    settledValueQuote: 'to --output' }, instructionReview: null };
/** Both windows propose the one choice. Window k's own check votes `checks[k]`; its existence check, `exists[k]`. */
const twoJudge = ({ checks, exists }) => async (request) => {
  const k = Number(/^(?:narrative|challenge):w(\d+)/.exec(request.label)?.[1]) - 1;
  if (request.challenge) {
    const verdict = isExists(request) ? exists[k] : isReanchor(request) ? 'refuted' : checks[k];
    if (verdict === 'fail') fail();
    return { votes: request.challenge.items.map((item) => ({ key: item.key, verdict, explanation: 'SYNTHETIC_D155.',
      receipts: [item.candidate.stated ?? item.candidate.instruction ?? item.candidate.receipts?.[0]] })) };
  }
  return narrative(isReask(request) ? [] : [structuredClone(TWO_CHOICE)]);
};

test('D155 premise: two windows, and the second is carried the thought and the ask the choice rests on', () => {
  const plan = planWindowRequests({ session: twoWindows(), reviewScope: 'session-only' });
  assert.equal(plan.windows.length, 2);
  assert.ok(Object.hasOwn(plan.requests[1].sourceMap, 'C1') && Object.hasOwn(plan.requests[1].sourceMap, 'I1'));
});

test('D155: one decision proposed in two windows is counted once, and not at all when another window kept it',
  async () => {
    // (i) Window 1 refutes it and its second check fails; window 2 upholds it: it is published, from window 2.
    const kept = await runReview({ session: twoWindows(), pr: null, reviewScope: 'session-only',
      judge: twoJudge({ checks: ['refuted', 'not-refuted'], exists: ['fail', 'fail'] }) });
    assert.equal(kept.windowResults[0].recolumn.existence.unexecuted, 1, 'premise: window 1 left its copy unexecuted');
    assert.equal(kept.decisions.length, 1, 'premise: window 2 kept the decision');
    assert.equal(rechecksUnexecuted(kept), 0, 'a decision the report publishes is never said to be left out');
    assert.equal(kept.counts.rechecksUnexecuted, 0);
    assert.equal(causeOf(kept), null);
    assert.deepEqual(rechecksToReask(kept.windowResults), ['challenge:w1:exists:'], 'its run is still asked again');
    // (ii) Both windows refute it and every second check fails: one decision, counted once.
    const both = await runReview({ session: twoWindows(), pr: null, reviewScope: 'session-only',
      judge: twoJudge({ checks: ['refuted', 'refuted'], exists: ['fail', 'fail'] }) });
    assert.deepEqual(both.windowResults.map((w) => w.recolumn.existence.unexecuted), [1, 1], 'premise: two copies');
    assert.equal(both.decisions.length, 0);
    assert.equal(rechecksUnexecuted(both), 1, 'one decision, once');
    assert.deepEqual(causeOf(both), ['rechecks_unexecuted', { n: 1 }]);
    assert.deepEqual(rechecksToReask(both.windowResults), ['challenge:w1:exists:', 'challenge:w2:exists:']);
  });

// ---- the stored records --------------------------------------------------------------------------------------------
const outcomes = (unexecuted) => Object.fromEntries(RESOLUTION_CHALLENGE_OUTCOMES.map((outcome) => [outcome,
  outcome === 'unexecuted' ? unexecuted : 0]));
/** A second check's run record: `sent` of `batches` batches sendable, three passes. */
const run = (batches = 1, sent = batches) => ({ plannedBatches: batches, plannedCalls: sent * 3,
  profile: { passes: 3 } });

test('D155: a run that asking again cannot run (a batch too large to send or invalid, or no record) is never counted',
  () => {
    assert.equal(recheckResendable(run()), true);
    assert.equal(recheckResendable(run(2)), true);
    for (const [name, record] of [['a batch never sent', run(1, 0)], ['one of two never sent', run(2, 1)],
      ['no record', null], ['no batch', run(0)], ['no passes', { ...run(), profile: {} }],
      ['a count that is not one', { ...run(), plannedCalls: '3' }]])
      assert.equal(recheckResendable(record), false, name);
    const windows = [
      { windowIndex: 0, recolumn: { existence: outcomes(2) }, recolumnExistsChallenge: run() },
      { windowIndex: 1, recolumn: { existence: outcomes(1) }, recolumnExistsChallenge: run(1, 0) },
      { windowIndex: 2, recolumn: { existence: outcomes(1) } },
      { windowIndex: 3, reanchor: { existence: outcomes(1) }, reanchorExistsChallenge: run() },
    ];
    assert.equal(rechecksUnexecuted({ windowResults: windows }), 3, 'windows 2 and 3 are left out');
    assert.deepEqual(rechecksToReask(windows), ['challenge:w1:exists:', 'challenge:w4:reanchor:']);
  });

test('D155: a report written before the fix round is counted from its windows, one per copy; a stated count wins',
  () => {
    const windows = [
      { windowIndex: 0, recolumn: { existence: outcomes(2) }, recolumnExistsChallenge: run() },
      { windowIndex: 1, recolumn: { existence: outcomes(1) }, recolumnExistsChallenge: run(),
        reanchor: { existence: outcomes(1) }, reanchorExistsChallenge: run() },
      { windowIndex: 2, recolumn: { existence: outcomes(0) }, recolumnExistsChallenge: run() },
      {},
      null,
      { windowIndex: 5, recolumn: { existence: outcomes('3') }, recolumnExistsChallenge: run(),
        reanchor: { existence: outcomes(-1) }, reanchorExistsChallenge: run() },
      { windowIndex: 6, recolumn: { existence: outcomes(1.5) }, recolumnExistsChallenge: run(),
        reanchor: { existence: outcomes(Number.NaN) }, reanchorExistsChallenge: run() },
    ];
    const before = JSON.parse(JSON.stringify({ coverageFacts: { resultsSeenInPart: 3 }, windowResults: windows }));
    assert.equal(rechecksUnexecuted(before), 4);
    assert.deepEqual(uncappedCauses(before), [['results_seen_in_part', { n: 3 }], ['rechecks_unexecuted', { n: 4 }]]);
    assert.equal(rechecksUnexecuted({ ...before, counts: { rechecksUnexecuted: 1 } }), 1);
    assert.equal(rechecksUnexecuted({ ...before, counts: { rechecksUnexecuted: 0 } }), 0);
    assert.equal(rechecksUnexecuted({ ...before, counts: { rechecksUnexecuted: -1 } }), 4, 'not a count: the windows');
    for (const none of [undefined, null, 'SYNTHETIC', {}, { windowResults: [{}] }, { windowResults: 'SYNTHETIC' }])
      assert.equal(rechecksUnexecuted(none), 0, JSON.stringify(none));
    assert.deepEqual(uncappedCauses({ windowResults: [{ recolumn: { existence: outcomes(0) } }] }), []);
    assert.deepEqual(rechecksToReask(undefined), []);
  });

test('D155: one closed cause, never a capping one, said with its count and its remedy', () => {
  assert.ok(COVERAGE_CAUSES.includes('rechecks_unexecuted'));
  assert.deepEqual(UNCAPPED_CAUSES, ['results_seen_in_part', 'rechecks_unexecuted']);
  assert.deepEqual(UNCAPPED_CAUSES_SAID_WHOLE, ['rechecks_unexecuted']);
  assert.ok(UNCAPPED_CAUSES_SAID_WHOLE.every((cause) => UNCAPPED_CAUSES.includes(cause)));
  // The window-incomplete vocabulary, which the run's profile digest holds, does not move.
  assert.equal(WINDOW_INCOMPLETE_REASONS.some((reason) => /recheck|exists/.test(reason)), false);
  assert.equal(COVERAGE_SENTENCE.rechecks_unexecuted({ n: 1 }), "Sonah left out 1 decision that the session review's "
    + 'check rejected, because the second check of it did not run. Run the same review again to check it');
  assert.equal(COVERAGE_SENTENCE.rechecks_unexecuted({ n: 2 }), "Sonah left out 2 decisions that the session review's "
    + 'check rejected, because the second check of them did not run. Run the same review again to check them');
});
