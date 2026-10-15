// Challenge /30 (5), 2026-10-13: a claim is verified only when every counted checking vote upholds it.
// Before, a claim's confirming result was upheld by a majority of its three checking passes, so one pass that refuted
// it ("one passing test cannot show no output change") or could not settle it was outvoted, and the page said
// "confirmed by a recorded result". The support run is now `unanimous`: its item survives only when no counted (valid)
// vote fails to uphold it, beside the two grounded not-refuted votes as before; a split the majority upheld is
// `unsettled`, the claim stays `open` (never contradicted by this rule). An invalid vote counts for nothing, as before,
// and every other run (the claim's own, decisions, requirements, written statements) keeps the majority rule.
// Synthetic sessions (/srv/x paths) and synthetic judges only: no recording, no model call. Nothing prints.
import test from 'node:test';
import assert from 'node:assert/strict';
import { Session } from '../src/session.js';
// Namespace imports, so each test fails on its own against code that predates it.
import * as reviewRun from '../src/run-review.js';
import * as challenge from '../src/challenge.js';

const R = 'not-refuted', X = 'refuted', U = 'uncertain', BAD = 'invalid';
const T1 = { turn: 'T1' };

// ---- challengeItems: the rule itself -------------------------------------------------------------------------------

const ITEM = { key: 'claims:0:support', type: 'support',
  candidate: { text: 'SYNTHETIC claim', stated: { eventId: 'C1', role: 'commentary', quote: 'SYNTHETIC said' },
    supportedBy: { eventId: 'E1', role: 'observation', quote: 'SYNTHETIC result' } },
  // A claim-class item is asked only with code's grounded words of the claim (M33 C2 repair), as the review gives it.
  verbatim: { quote: 'SYNTHETIC said' } };
const GOOD = [{ eventId: 'E1', role: 'observation', quote: 'SYNTHETIC result' }];
const NOWHERE = [{ eventId: 'E9', role: 'observation', quote: 'SYNTHETIC quote nobody recorded' }];
/** One vote per pass, by `verdicts[pass - 1]`: a verdict, or BAD (a receipt the verifier refuses: answered,
 *  invalid). */
const byPass = (verdicts) => async (request) => ({ votes: request.challenge.items.map(({ key }) => {
  const verdict = verdicts[request.challenge.pass - 1];
  if (verdict === BAD) return { key, verdict: R, explanation: 'Synthetic.', receipts: NOWHERE };
  return { key, verdict, explanation: 'Synthetic.', receipts: verdict === U ? [] : GOOD };
}) });
const verifyReceipt = (receipt) => (receipt.eventId === 'E1' ? { ok: true, receipt } : { ok: false });
const run = (verdicts, options = {}) => challenge.challengeItems({ items: [ITEM], judge: byPass(verdicts),
  evidence: 'SYNTHETIC', verifyReceipt, ...options });
const outcome = (record) => challenge.challengeOutcome(record.results[0]);

test('challenge /30 (5): a unanimous run upholds an item only when no counted vote fails to', async () => {
  const cases = [
    // [votes by pass, outcome unanimous, outcome by majority (every other run)]
    [[R, R, R], 'upheld', 'upheld'],
    [[R, X, R], 'unsettled', 'upheld'],
    [[R, R, U], 'unsettled', 'upheld'],
    [[U, R, R], 'unsettled', 'upheld'],
    // An invalid vote (here, a quote that does not ground) counts for nothing, as it always did.
    [[R, R, BAD], 'upheld', 'upheld'],
    [[R, X, X], 'refuted', 'refuted'],
    [[X, X, X], 'refuted', 'refuted'],
    [[R, X, U], 'unsettled', 'unsettled'],
    [[R, BAD, X], 'unsettled', 'unsettled'],
  ];
  for (const [verdicts, unanimous, majority] of cases) {
    assert.equal(outcome(await run(verdicts, { unanimous: true })), unanimous, `unanimous ${verdicts}`);
    assert.equal(outcome(await run(verdicts)), majority, `majority ${verdicts}`);
    assert.equal(outcome(await run(verdicts, { unanimous: false })), majority, `unanimous: false ${verdicts}`);
  }
});

test('challenge /30 (5): a unanimous split is counted unsettled, never refuted, and its run states the rule',
  async () => {
  const split = await run([R, X, R], { unanimous: true });
  assert.deepEqual(split.survivors, []);
  assert.deepEqual(split.rejected, [{ key: ITEM.key, type: 'support', resolved: false, executionComplete: true,
    reason: 'unsettled' }]);
  assert.deepEqual([split.resolvedItems, split.refutedItems, split.unresolvedItems, split.unsettledItems],
    [0, 0, 1, 1]);
  assert.equal(split.complete, true, 'every pass voted: a split is a check that ran');
  assert.deepEqual(split.profile, { ...challenge.CHALLENGE_PROFILE, unanimous: true });
  assert.ok(Object.isFrozen(split.profile));
  const majority = await run([R, X, R]);
  assert.equal(majority.profile, challenge.CHALLENGE_PROFILE, 'every other run states the profile as before');
  assert.deepEqual(majority.survivors.map((item) => item.key), [ITEM.key]);
  // The tiered profile's bounds, with the rule: the same record shape, its own bounds.
  const tiered = await run([R, R, R], { passes: 3, requiredSurvivals: 2, unanimous: true });
  assert.deepEqual(tiered.profile, { ...challenge.CHALLENGE_PROFILE, unanimous: true });
  // A single-pass unanimous run is the single-pass run: one vote, which must uphold it.
  assert.equal(outcome(await run([R], { passes: 1, requiredSurvivals: 1, unanimous: true })), 'upheld');
  assert.equal(outcome(await run([X], { passes: 1, requiredSurvivals: 1, unanimous: true })), 'refuted');
});

test('challenge /30 (5): the rule is a boolean, refused otherwise before any call', async () => {
  let calls = 0;
  const judge = async () => { calls++; return { votes: [] }; };
  for (const unanimous of ['true', 1, null, {}])
    await assert.rejects(challenge.challengeItems({ items: [ITEM], judge, evidence: 'SYNTHETIC', verifyReceipt,
      unanimous }), { name: 'TypeError', message: 'Invalid challenge run bounds' }, String(unanimous));
  assert.equal(calls, 0);
});

test('challenge /30 (5): no request byte depends on the rule', async () => {
  const seen = { on: [], off: [] };
  const judge = (into) => async (request) => { into.push(request); return byPass([R, X, R])(request); };
  await challenge.challengeItems({ items: [ITEM], judge: judge(seen.on), evidence: 'SYNTHETIC', verifyReceipt,
    unanimous: true });
  await challenge.challengeItems({ items: [ITEM], judge: judge(seen.off), evidence: 'SYNTHETIC', verifyReceipt });
  const bytes = (list) => list.map(({ system, prompt, schema, label }) =>
    JSON.stringify({ system, prompt, schema, label }));
  assert.equal(seen.on.length, 3);
  assert.deepEqual(bytes(seen.on), bytes(seen.off));
});

// ---- the review: the support run is unanimous, every other run is not ---------------------------------------------

/** A one-turn session from `rows`: [id, kind, blobKey, extra] (ask, cmd, out, said), as m33-c-claims-repair builds
 *  it. */
function build(blobs, rows) {
  const ref = (key) => [{ sourceKey: key, fromByte: 0, untilByte: Buffer.byteLength(blobs[key], 'utf8') }];
  const events = rows.map(([id, kind, key, extra = {}], sequence) => {
    if (kind === 'ask') return { id, kind: 'instruction', authority: 'human', supersedes: [], text: ref(key), ...T1,
      sequence };
    if (kind === 'cmd') return { id, kind: 'invocation', callKey: id, tool: 'Bash', operation: 'command', paths: [],
      command: ref(key), input: [], changes: [], ...T1, sequence };
    if (kind === 'out') return { id, kind: 'observation', invocation: extra.of, callKey: extra.of, phase: 'terminal',
      result: 'succeeded', exitCode: 0, terminalStatusProven: true, output: ref(key), sourceOfResult: 'native', ...T1,
      sequence };
    return { id, kind: 'commentary', phase: extra.phase ?? 'working', beforeInvocation: null, text: ref(key), ...T1,
      sequence };
  });
  return new Session({ sessionKey: 'sess-unanimous', adapter: 'claude', blobs: { ...blobs }, events });
}
const receipt = (eventId, role, quote) => ({ eventId, role, quote });
const BLOBS = { ask: 'SYNTHETIC_U_ASK: swap the date helper in the summary.', cmd: 'node /srv/x/summary.test.js',
  out: 'SYNTHETIC_U_TEST: 1 passing (one order)', said: 'SYNTHETIC_U_SAID: swapped the helper, no output change.' };
const ROWS = [['I1', 'ask', 'ask'], ['C1', 'said', 'said', { phase: 'final' }], ['A1', 'cmd', 'cmd'],
  ['A1-r', 'out', 'out', { of: 'A1' }]];
const CLAIM = { text: 'The agent said the swap changed no output.',
  stated: receipt('C1', 'commentary', 'no output change.'), contradictedBy: null,
  supportedBy: receipt('A1-r', 'observation', 'SYNTHETIC_U_TEST: 1 passing (one order)') };
const PROFILES = [undefined, 'm33-lean', 'm33-fast'];

/** Votes by item type and pass: `on[type]` is a list of verdicts by pass (every pass not-refuted otherwise). */
function judgeWith(on = {}) {
  return async (request) => {
    if (!request.challenge) return { decisions: [], pivots: [], requirements: [], claims: [structuredClone(CLAIM)] };
    return { votes: request.challenge.items.map((item) => {
      const verdict = on[item.type]?.[request.challenge.pass - 1] ?? R;
      const own = item.candidate.supportedBy ?? item.candidate.stated;
      return { key: item.key, verdict, explanation: 'Synthetic.', receipts: verdict === U ? [] : [own] };
    }) };
  };
}
const review = (on, speedProfile, reviewScope) => reviewRun.runReview({ session: build(BLOBS, ROWS), pr: null,
  reviewScope, ...(speedProfile ? { speedProfile } : {}), judge: judgeWith(on) });
// Every session-only profile, and the combined route (standard only: another profile runs a session-only review only).
const ROUTES = [...PROFILES.map((speedProfile) => ['session-only', speedProfile]), ['combined', undefined]];

test('challenge /30 (5): one pass that does not uphold the confirming result leaves the claim not checked',
  async () => {
  for (const [reviewScope, speedProfile] of ROUTES) {
    const label = `${reviewScope} ${speedProfile ?? 'standard'}`;
    const upheld = await review({}, speedProfile, reviewScope);
    assert.deepEqual(upheld.promises.map((p) => p.status), ['verified'], `${label}: every pass upholds it`);
    for (const support of [[R, X, R], [R, R, U], [X, R, R]]) {
      const split = await review({ support }, speedProfile, reviewScope);
      assert.deepEqual(split.promises.map((p) => p.status), ['open'], `${label}: ${support}`);
      assert.deepEqual(split.promises[0].receipts.map((r) => r.eventId), ['C1'],
        `${label}: ${support}: no basis shown`);
      assert.equal(split.counts.promiseSupport.rejected.unsettled, 1, `${label}: ${support}`);
      assert.equal(split.counts.promiseSupport.rejected.refuted, 0, `${label}: ${support}: never counted refuted`);
      assert.deepEqual(split.findings.filter((f) => f.kind === 'claim_contradicted'), [],
        `${label}: never contradicted`);
      assert.equal(split.sessionReview, 'complete', `${label}: a support check never makes the review incomplete`);
    }
    // The claim's own run keeps the majority rule: a split on the claim still publishes it, and its support decides.
    const claimSplit = await review({ claim: [R, X, R] }, speedProfile, reviewScope);
    assert.deepEqual(claimSplit.promises.map((p) => p.status), ['verified'],
      `${label}: the claim's own run is a majority`);
    const window = upheld.windowResults[0];
    assert.equal(window.supportChallenge.profile.unanimous, true, `${label}: the support run states the rule`);
    assert.equal(Object.hasOwn(window.challenge.profile, 'unanimous'), false,
      `${label}: the window's own run does not`);
  }
});
