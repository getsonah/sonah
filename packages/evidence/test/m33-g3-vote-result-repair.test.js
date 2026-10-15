// M33 G3. A challenger that cites an ACTION's id with role `observation` (`A1` instead of `A1-r`) is
// quoting that action's result under the wrong event. Code repairs it — deterministically, never by
// guessing — to the action's own result event, only when:
//   - the cited event is an invocation and the receipt claims role `observation`;
//   - the session records exactly ONE result (observation) for that action;
//   - that result was supplied to THIS window, as an observation; and
//   - the quote is an exact substring of that result's supplied text (no quote snapping on top).
// Anything else is rejected exactly as before. A repaired vote is counted on its own
// (`eventRepairedVotes`), apart from the vote quotes code snapped (`repairedVotes`).
//
// Every byte is synthetic; no model is called. Each judge is a pure function of the request.
import test from 'node:test';
import assert from 'node:assert/strict';
import { Session } from '../src/session.js';
import * as reviewRun from '../src/run-review.js';
import { challengeItems } from '../src/challenge.js';
import { renderReview } from '../src/review.js';

const { runReview } = reviewRun;

const TEXT = {
  ask: 'SYNTHETIC_G3_VOTE_ASK: run the unit tests and tell me whether they pass.',
  said: 'SYNTHETIC_G3_VOTE_SAID: the unit tests pass: 5 passed, 0 failed.',
  cmd: 'npm run test:unit -- --reporter=dot',
  out: 'SYNTHETIC_G3_VOTE_OUT: Tests: 5 passed, 0 failed, 5 total',
  again: 'SYNTHETIC_G3_VOTE_AGAIN: Tests: 5 passed, 0 failed, 5 total (rerun)',
  ask2: 'SYNTHETIC_G3_VOTE_ASK_2: now summarise what you did.',
  // M33 C: "one time", never "once" — a quote holding "once" was withheld as not a claim (claim_not_factual, gone
  // since M33 C recheck 2); the fixture keeps its words.
  said2: 'SYNTHETIC_G3_VOTE_SAID_2: I ran the unit tests one time and they passed.',
};
const whole = (key) => [{ sourceKey: key, fromByte: 0, untilByte: Buffer.byteLength(TEXT[key], 'utf8') }];
const result = (id, output, over = {}) => ({ id, kind: 'observation', sequence: 0, invocation: 'A1', callKey: 'a1',
  phase: 'terminal', result: 'succeeded', exitCode: 0, terminalStatusProven: true, output: whole(output),
  sourceOfResult: 'native', ...over });

/** One window: the ask, the test run and its result, the agent's claim. `extra` adds events. */
function oneWindow({ extra = [] } = {}) {
  const events = [
    { id: 'I1', kind: 'instruction', authority: 'human', supersedes: [], text: whole('ask') },
    { id: 'A1', kind: 'invocation', callKey: 'a1', tool: 'Bash', operation: 'command',
      paths: [], command: whole('cmd'), input: [], changes: [] },
    result('A1-r', 'out'),
    ...extra,
    { id: 'C1', kind: 'commentary', phase: 'final', text: whole('said'), beforeInvocation: null },
  ].map((event, sequence) => ({ ...event, sequence }));
  return new Session({ sessionKey: 'sess-g3-votes', adapter: 'claude', blobs: { ...TEXT }, events });
}

/**
 * Two windows: the test run in window 1, the summary in window 2. M35 windowing: a compaction no longer splits, so
 * each task carries a long thought (about 400k bytes each) and the two tasks do not fit one 200k-token window.
 * Window 2 is carried the earlier human message and thoughts, never the earlier actions or their results, so it is
 * shown the summary and not the test run, as this fixture always meant.
 */
function twoWindows() {
  const blobs = { ...TEXT, think1: `SYNTHETIC_G3_THINK_1: ${'t'.repeat(400_000)}`, think2: `SYNTHETIC_G3_THINK_2: ${'u'.repeat(400_000)}` };
  const ref = (key) => [{ sourceKey: key, fromByte: 0, untilByte: Buffer.byteLength(blobs[key], 'utf8') }];
  const think = (id, key) => ({ id, kind: 'commentary', phase: 'working', beforeInvocation: null, text: ref(key) });
  const events = [
    { id: 'I1', kind: 'instruction', authority: 'human', supersedes: [], text: whole('ask') },
    { id: 'A1', kind: 'invocation', callKey: 'a1', tool: 'Bash', operation: 'command',
      paths: [], command: whole('cmd'), input: [], changes: [] },
    result('A1-r', 'out'),
    think('T1', 'think1'),
    { id: 'B1', kind: 'boundary', boundary: 'compaction' },
    { id: 'I2', kind: 'instruction', authority: 'human', supersedes: [], text: whole('ask2') },
    think('T2', 'think2'),
    { id: 'C2', kind: 'commentary', phase: 'final', text: whole('said2'), beforeInvocation: null },
  ].map((event, sequence) => ({ ...event, sequence }));
  return new Session({ sessionKey: 'sess-g3-votes', adapter: 'claude', blobs, events });
}

// D71 (S2): a session-only answer's checklist status, with the deliverable a done row needs (the result of the run).
const REQUIREMENT = { text: 'SYNTHETIC_G3_VOTE_REQUIREMENT: run the unit tests', status: 'done',
  deliverable: { eventId: 'A1-r', role: 'observation', quote: 'Tests: 5 passed, 0 failed, 5 total' },
  instruction: { eventId: 'I1', role: 'instruction', quote: 'run the unit tests and tell me whether they pass.' } };
const CLAIM = { text: 'SYNTHETIC_G3_VOTE_CLAIM: the unit tests pass', contradictedBy: null,
  stated: { eventId: 'C1', role: 'commentary', quote: 'the unit tests pass: 5 passed, 0 failed.' } };
const EMPTY = { decisions: [], pivots: [], claims: [], requirements: [] };
const ACTION_AS_RESULT = { eventId: 'A1', role: 'observation', quote: 'Tests: 5 passed, 0 failed, 5 total' };

/** Narrative answers per window number; every challenge vote supports with `receipt`. */
const judgeWith = ({ narratives, receipt }) => async (request) => {
  const window = Number(/:w(\d+)/.exec(request.label ?? '')?.[1] ?? 0);
  if (!request.challenge) return narratives[window] ?? EMPTY;
  return { votes: request.challenge.items.map(({ key }) => ({ key, verdict: 'not-refuted',
    explanation: 'The recorded result shows it.', receipts: [receipt] })) };
};
const votesOf = (report, window = 0) => report.windowResults[window].challenge.results.flatMap((r) => r.votes);
const review = (session, narratives, receipt) => runReview({ session, pr: null, reviewScope: 'session-only',
  judge: judgeWith({ narratives, receipt }) });

test('M33 G3 an action id cited as its observation is repaired to the one supplied result', async () => {
  const report = await review(oneWindow(), { 1: { ...EMPTY, requirements: [REQUIREMENT], claims: [CLAIM] } }, ACTION_AS_RESULT);
  const votes = votesOf(report);
  assert.equal(votes.length, 6, 'premise: two items, three passes');
  for (const vote of votes) {
    assert.equal(vote.valid, true, 'the vote stands on the result it quoted');
    assert.equal(vote.reason, null);
    assert.equal(vote.receipts.length, 1);
    const [receipt] = vote.receipts;
    assert.equal(receipt.eventId, 'A1-r', 'the result id, never the action id');
    assert.equal(receipt.role, 'observation');
    assert.equal(receipt.quote, ACTION_AS_RESULT.quote, 'the quote is untouched: it was already exact');
    assert.equal(receipt.eventRepaired, true, 'code says it moved the receipt');
    assert.equal(receipt.eventRepairedFrom, 'A1', 'and from which event');
    assert.notEqual(receipt.repaired, true, 'it is not a quote snap');
  }
  assert.equal(report.windowResults[0].challenge.eventRepairedVotes, 6);
  assert.equal(report.windowResults[0].challenge.repairedVotes, 0);
  assert.equal(report.challenge.eventRepairedVotes, 6, 'summed across windows');
  assert.equal(report.challenge.complete, true);
  assert.equal(report.challenge.unresolvedItems, 0, 'every item resolved on valid votes');
  assert.equal(report.requirements.length, 1, 'the upheld requirement is published');
  assert.equal(report.promises.length, 1, 'the upheld claim is published');
  assert.match(renderReview(report), /6 vote receipt\(s\) citing an action were moved to its one recorded result by code/);
});

test('M33 G3 a vote citing the result id itself is valid and not counted as repaired', async () => {
  const report = await review(oneWindow(), { 1: { ...EMPTY, claims: [CLAIM] } }, { ...ACTION_AS_RESULT, eventId: 'A1-r' });
  for (const vote of votesOf(report)) {
    assert.equal(vote.valid, true);
    assert.equal(vote.receipts[0].eventId, 'A1-r');
    assert.equal(Object.hasOwn(vote.receipts[0], 'eventRepaired'), false);
  }
  assert.equal(report.challenge.eventRepairedVotes, 0);
  assert.doesNotMatch(renderReview(report), /moved to its one recorded result/);
});

const rejectedEverywhere = (report, window = 0) => {
  const votes = votesOf(report, window);
  assert.ok(votes.length > 0, 'premise: votes were cast');
  for (const vote of votes) {
    assert.equal(vote.valid, false);
    assert.equal(vote.reason, 'receipt_rejected');
  }
  assert.equal(report.challenge.eventRepairedVotes, 0);
};

test('M33 G3 near miss: two recorded results for the action are ambiguous, so the vote is rejected', async () => {
  const report = await review(oneWindow({ extra: [result('A1-r2', 'again')] }),
    { 1: { ...EMPTY, claims: [CLAIM] } }, ACTION_AS_RESULT);
  rejectedEverywhere(report);
  // S6 (S5 review H1; owner decision D71 b): no claim survives on rejected votes — it is kept as not checked, with why,
  // never confirmed.
  assert.deepEqual(report.promises.map((p) => [p.status, p.reason]), [['open', 'challenge_unsettled']],
    'no claim survives on rejected votes');
});

test('M33 G3 near miss: a quote that is not in the result is rejected (the action\'s own text included)', async () => {
  const fromCommand = await review(oneWindow(), { 1: { ...EMPTY, claims: [CLAIM] } },
    { eventId: 'A1', role: 'observation', quote: 'npm run test:unit' });
  rejectedEverywhere(fromCommand);
  const invented = await review(oneWindow(), { 1: { ...EMPTY, claims: [CLAIM] } },
    { eventId: 'A1', role: 'observation', quote: 'Tests: 6 passed, 0 failed' });
  rejectedEverywhere(invented);
});

test('M33 G3 near miss: a quote that only a snap would match is rejected — the repair is exact only', async () => {
  // A doubled space: the quote repair would snap it on the right event; this repair never does.
  const report = await review(oneWindow(), { 1: { ...EMPTY, claims: [CLAIM] } },
    { eventId: 'A1', role: 'observation', quote: 'Tests: 5 passed,  0 failed, 5 total' });
  rejectedEverywhere(report);
  assert.equal(report.challenge.repairedVotes, 0);
});

test('M33 G3 near miss: a result not supplied to this window is never reached', async () => {
  // Window 2 is shown the summary, not the test run (earlier actions are never carried); its challenger cites window 1's action.
  const plan = reviewRun.planWindowRequests({ session: twoWindows(), reviewScope: 'session-only' });
  assert.ok(!Object.hasOwn(plan.requests.at(-1).sourceMap, 'A1-r'), 'premise: the test run is not supplied to window 2');
  const report = await review(twoWindows(), { 2: { ...EMPTY, claims: [{ text: 'SYNTHETIC_G3_VOTE_CLAIM_2', contradictedBy: null,
    stated: { eventId: 'C2', role: 'commentary', quote: 'I ran the unit tests one time and they passed.' } }] } },
  ACTION_AS_RESULT);
  assert.equal(report.windowResults.length, 2, 'premise: the two tasks do not fit one window');
  rejectedEverywhere(report, 1);
  // S6 (S5 review H1): kept as not checked, with why.
  assert.deepEqual(report.promises.map((p) => [p.status, p.reason]), [['open', 'challenge_unsettled']]);
});

test('M33 G3 near miss: only an invocation cited as an observation is repaired', async () => {
  // The commentary event id with role observation: not an action, so nothing to repair.
  const report = await review(oneWindow(), { 1: { ...EMPTY, claims: [CLAIM] } },
    { eventId: 'C1', role: 'observation', quote: 'the unit tests pass: 5 passed, 0 failed.' });
  rejectedEverywhere(report);
  // The action cited with role `action` quoting its result: a wrong role, rejected as before.
  const wrongRole = await review(oneWindow(), { 1: { ...EMPTY, claims: [CLAIM] } },
    { ...ACTION_AS_RESULT, role: 'action' });
  rejectedEverywhere(wrongRole);
});

test('M33 G3 the exported repair is pure and refuses every near miss', () => {
  const { resultReceiptRepair } = reviewRun;
  assert.equal(typeof resultReceiptRepair, 'function');
  const session = oneWindow();
  const sourceMap = Object.create(null);
  for (const event of session.events) sourceMap[event.id] = session.sourcesFor(event).map((s) => ({ role: s.role, text: s.text }));
  const out = resultReceiptRepair(session, sourceMap, ACTION_AS_RESULT);
  assert.equal(out.ok, true);
  assert.deepEqual(out.receipt, { eventId: 'A1-r', role: 'observation', quote: ACTION_AS_RESULT.quote,
    sessionKey: 'sess-g3-votes', eventRepaired: true, eventRepairedFrom: 'A1' });
  const without = Object.create(null);
  for (const [id, sources] of Object.entries(sourceMap)) if (id !== 'A1-r') without[id] = sources;
  assert.equal(resultReceiptRepair(session, without, ACTION_AS_RESULT), null, 'result not supplied');
  assert.equal(resultReceiptRepair(session, sourceMap, { ...ACTION_AS_RESULT, quote: 'not in the result' }), null);
  assert.equal(resultReceiptRepair(session, sourceMap, { ...ACTION_AS_RESULT, role: 'action' }), null);
  assert.equal(resultReceiptRepair(session, sourceMap, { ...ACTION_AS_RESULT, revisionOid: 'a'.repeat(40) }), null,
    'a frozen revision on a session result is contradictory');
  assert.equal(resultReceiptRepair(session, sourceMap, { ...ACTION_AS_RESULT, sessionKey: 'another' }), null);
  assert.equal(resultReceiptRepair(session, sourceMap, { ...ACTION_AS_RESULT, eventId: 'NOPE' }), null);
  assert.equal(resultReceiptRepair(session, sourceMap, null), null);
  const two = oneWindow({ extra: [result('A1-r2', 'again')] });
  const twoMap = Object.create(null);
  for (const event of two.events) twoMap[event.id] = two.sourcesFor(event).map((s) => ({ role: s.role, text: s.text }));
  assert.equal(resultReceiptRepair(two, twoMap, ACTION_AS_RESULT), null, 'two results: ambiguous');
});

test('M33 G3 the challenge counts a verifier\'s event repair apart from a quote snap, and publishes its marks', async () => {
  // M33 C2 repair: a claim-class item is asked only with code's grounded words (`verbatim`), as the run gives it.
  const items = [{ key: 'claims:0', type: 'claim', candidate: { text: 'x', stated: { eventId: 'C0', role: 'commentary', quote: 'SYNTHETIC said' } }, verbatim: { quote: 'SYNTHETIC said' } }];
  const receipt = { eventId: 'A1', role: 'observation', quote: 'SYNTHETIC quote' };
  const out = await challengeItems({ items, evidence: 'Synthetic evidence.', concurrency: 1,
    judge: async (request) => ({ votes: request.challenge.items.map(({ key }) => ({ key, verdict: 'not-refuted',
      explanation: 'x', receipts: [receipt] })) }),
    verifyReceipt: (r) => ({ ok: true, eventRepaired: true,
      receipt: { ...r, eventId: 'A1-r', sessionKey: 's', eventRepaired: true, eventRepairedFrom: 'A1' } }) });
  assert.equal(out.eventRepairedVotes, 3);
  assert.equal(out.repairedVotes, 0);
  const [vote] = out.results[0].votes;
  assert.equal(vote.eventRepaired, 1);
  assert.deepEqual(vote.receipts, [{ eventId: 'A1-r', role: 'observation', quote: 'SYNTHETIC quote', sessionKey: 's',
    eventRepaired: true, eventRepairedFrom: 'A1' }]);
  // A model cannot set the marks itself: a receipt carrying them is refused before any verifier runs.
  const forged = await challengeItems({ items, evidence: 'Synthetic evidence.', concurrency: 1,
    judge: async (request) => ({ votes: request.challenge.items.map(({ key }) => ({ key, verdict: 'not-refuted',
      explanation: 'x', receipts: [{ ...receipt, eventRepaired: true }] })) }),
    verifyReceipt: (r) => ({ ok: true, receipt: r }) });
  assert.ok(forged.results[0].votes.every((v) => v.valid === false && v.reason === 'receipt_rejected'));
});
