// M33 J. The tiered challenge of the opt-in "m33-fast" profile. M33 C: EVERY claim — with or without
// contradictedBy or supportedBy: it can become a published finding, a promise or a verified one — and every
// resolution item are asked three times and need two grounded not-refuted votes, exactly as the standard
// profile asks. Every other item (a decision, a pivot, a requirement, a written statement) is asked once and
// survives only on that one vote, valid and not-refuted. Re-asks, unsettled/refuted/unexecuted, execution completeness and every planned count
// are computed against each run's own passes. The standard profile's challenge is untouched
// (m33-fast-profile-baseline.test.js pins its bytes and labels).
//
// Synthetic sessions and judges only: no model call, no recording. Nothing prints.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as challenge from '../src/challenge.js';
import * as reviewRun from '../src/run-review.js';
import { TURN_RECEIPTS, ownReceipt, turnNarrative, turnSession } from '../../cli/test/m33-fast-profile-fixture.js';

const FAST = 'm33-fast';
const GOOD = 'SYNTHETIC_GOOD_QUOTE';
const vote = (key, verdict, quote = GOOD) => ({ key, verdict, explanation: 'Synthetic.',
  receipts: verdict === 'uncertain' ? [] : [{ eventId: 'E1', role: 'observation', quote }] });
const verifyReceipt = (receipt) => (receipt.quote === GOOD ? { ok: true, receipt } : { ok: false });
// M33 C2 repair: a claim-class item is asked only with code's grounded words (`verbatim`), as the run gives it.
const items = (...types) => types.map((type, index) => ({ key: `${type}s:${index}`, type, candidate: { text: `SYNTHETIC ${type}`,
  ...(challenge.CLAIM_ITEM_TYPES.includes(type) ? { stated: { eventId: 'C0', role: 'commentary', quote: 'SYNTHETIC said' } } : {}) },
...(challenge.CLAIM_ITEM_TYPES.includes(type) ? { verbatim: { quote: 'SYNTHETIC said' } } : {}) }));

/** challengeItems with a judge that answers `answer(request)`; every request is kept in `seen`. */
async function run(list, answer, options = {}, seen = []) {
  return challenge.challengeItems({ items: list, evidence: 'SYNTHETIC EVIDENCE', verifyReceipt,
    judge: async (request) => { seen.push(request); return answer(request); }, ...options });
}
const SINGLE = { passes: 1, requiredSurvivals: 1 };

// ---- challengeItems, one run ----------------------------------------------------------------------------
test('M33 J a single-pass item survives on one valid not-refuted vote', async () => {
  const seen = [];
  const out = await run(items('decision', 'requirement', 'pivot'),
    (request) => ({ votes: request.challenge.items.map(({ key }) => vote(key, 'not-refuted')) }), SINGLE, seen);
  assert.deepEqual(seen.map((request) => request.label), ['challenge:b1:p1'], 'one pass, one call');
  assert.equal(out.survivors.length, 3);
  assert.ok(out.results.every((r) => r.survived && r.resolved && r.executionComplete && r.votes.length === 1));
  assert.equal(out.complete, true);
  assert.equal(out.executionComplete, true);
  assert.deepEqual([out.plannedBatches, out.plannedItems, out.plannedVoteSlots, out.plannedCalls], [1, 3, 3, 1]);
  assert.deepEqual([out.profile.passes, out.profile.requiredSurvivals], [1, 1]);
  assert.equal(out.profile.version, challenge.CHALLENGE_PROFILE.version, 'the votes and their schema are the same');
});

test('M33 J one uncertain, refuted or ungrounded vote kills a single-pass item', async () => {
  const cases = { uncertain: ['unsettled', false], refuted: ['kind_rejected', true], ungrounded: ['unsettled', false] };
  for (const [how, [reason, resolved]] of Object.entries(cases)) {
    const seen = [];
    const out = await run(items('decision'), (request) => ({ votes: request.challenge.items.map(({ key }) =>
      (how === 'ungrounded' ? vote(key, 'not-refuted', 'SYNTHETIC QUOTE NOBODY RECORDED') : vote(key, how))) }), SINGLE, seen);
    assert.equal(seen.length, 1, `${how}: one call decides`);
    assert.equal(out.survivors.length, 0, how);
    assert.deepEqual(out.rejected.map((r) => [r.reason, r.resolved, r.executionComplete]), [[reason, resolved, true]], how);
    assert.equal(out.complete, true, `${how}: every check ran`);
    assert.equal(out.unsettledItems, resolved ? 0 : 1, how);
    assert.equal(out.refutedItems, how === 'refuted' ? 1 : 0, how);
  }
});

test('M33 J a single-pass slot a reply left out takes its one re-ask, against its own pass', async () => {
  const seen = [];
  const answered = await run(items('decision', 'pivot'), (request) => ({ votes: request.challenge.items
    .filter(({ key }) => request.challenge.reask || key !== 'decisions:0').map(({ key }) => vote(key, 'not-refuted')) }),
  { ...SINGLE, labelPrefix: 'challenge:w1:t1' }, seen);
  assert.deepEqual(seen.map((request) => request.label), ['challenge:w1:t1:b1:p1', 'challenge:w1:t1:reask:p1']);
  assert.deepEqual(seen[1].challenge.items.map((item) => item.key), ['decisions:0']);
  assert.equal(answered.survivors.length, 2);
  const [decision] = answered.results;
  assert.deepEqual(decision.votes.map((v) => [v.pass, v.reasked === true, v.answered]), [[1, true, true]]);
  assert.deepEqual([answered.reaskCalls, answered.reaskedSlots, answered.complete], [1, 1, true]);
  // Left out again: the check did not run, and the run is incomplete.
  const unanswered = await run(items('decision', 'pivot'), (request) => ({ votes: request.challenge.items
    .filter(({ key }) => key !== 'decisions:0').map(({ key }) => vote(key, 'not-refuted')) }), SINGLE);
  assert.deepEqual(unanswered.rejected.map((r) => [r.key, r.reason]), [['decisions:0', 'unreviewed_scope']]);
  assert.equal(unanswered.complete, false);
  assert.equal(unanswered.executionComplete, false);
});

test('M33 J the defaults are the standard profile; a run bound that could admit a minority is refused', async () => {
  const seen = [];
  const out = await run(items('claim'), (request) => ({ votes: request.challenge.items.map(({ key }) => vote(key, 'not-refuted')) }),
    {}, seen);
  assert.equal(out.profile, challenge.CHALLENGE_PROFILE, 'the same frozen object as before');
  assert.deepEqual(seen.map((request) => request.label), ['challenge:b1:p1', 'challenge:b1:p2', 'challenge:b1:p3']);
  assert.deepEqual([out.plannedVoteSlots, out.plannedCalls], [3, 3]);
  for (const bad of [{ passes: 0 }, { passes: 4 }, { passes: 1.5 }, { passes: 3, requiredSurvivals: 1 },
    { passes: 1, requiredSurvivals: 2 }, { requiredSurvivals: 0 }, { maxInputBytes: 0 }, { maxInputBytes: '1' }])
    await assert.rejects(run(items('claim'), () => ({ votes: [] }), bad), TypeError, JSON.stringify(bad));
});

test('M33 J a run\'s byte bound is its own: evidence over 524288 bytes fits a 1048576-byte run', async () => {
  const evidence = 'x'.repeat(600_000);
  const ask = (options) => challenge.challengeItems({ items: items('decision'), evidence, verifyReceipt, ...options,
    judge: async (request) => ({ votes: request.challenge.items.map(({ key }) => vote(key, 'not-refuted')) }) });
  const standard = await ask({});
  assert.equal(standard.attemptedCalls, 0, 'standard never sends it');
  assert.equal(standard.budgetExhausted, true);
  const wide = await ask({ maxInputBytes: 1048576 });
  assert.equal(wide.attemptedCalls, 3);
  assert.equal(wide.survivors.length, 1);
  assert.equal(wide.profile.maxInputBytes, 1048576);
});

// ---- the tiers inside a fast review ----------------------------------------------------------------------------
const TURN = turnSession();
const r = TURN_RECEIPTS;
/** The turn's narrative and a vote per item: `verdict(item, request)` is a verdict (the item's first
 *  receipt cited), `{ cite }` for not-refuted citing another receipt, or null to leave the item out. */
function turnJudge(verdict = () => 'not-refuted', seen = []) {
  return async (request) => {
    seen.push(request);
    if (!request.challenge) return turnNarrative();
    return { votes: request.challenge.items.flatMap((item) => {
      const chosen = verdict(item, request);
      if (chosen === null) return [];
      if (typeof chosen === 'object') return [{ key: item.key, verdict: 'not-refuted', explanation: 'Synthetic.', receipts: [chosen.cite] }];
      return [{ key: item.key, verdict: chosen, explanation: 'Synthetic.',
        receipts: chosen === 'uncertain' ? [] : [ownReceipt(item.candidate)] }];
    }) };
  };
}
const fastReview = (verdict, seen = [], speedProfile = FAST) => reviewRun.runReview({ session: TURN, pr: null,
  reviewScope: 'session-only', ...(speedProfile ? { speedProfile } : {}), judge: turnJudge(verdict, seen) });
const keysOf = (request) => request.challenge.items.map((item) => item.key);
const statuses = (report) => report.findings.filter((f) => f.kind === 'claim_contradicted')
  .map((f) => `${f.status}${f.disclosureReason ? `/${f.disclosureReason}` : ''}`);

test('M33 J a fast window asks every claim in the three-pass run and every other item once', async () => {
  const seen = [];
  const report = await fastReview(undefined, seen);
  const CLAIM_KEYS = ['claims:0', 'claims:1'];
  assert.deepEqual(seen.map((request) => [request.label, request.challenge ? keysOf(request) : []]), [
    ['narrative:w1', []],
    ['challenge:w1:b1:p1', CLAIM_KEYS], ['challenge:w1:b1:p2', CLAIM_KEYS], ['challenge:w1:b1:p3', CLAIM_KEYS],
    ['challenge:w1:t1:b1:p1', ['decisions:0', 'pivots:0', 'requirements:0']],
    ['challenge:w1:resolution:b1:p1', ['claims:0:resolution']], ['challenge:w1:resolution:b1:p2', ['claims:0:resolution']],
    ['challenge:w1:resolution:b1:p3', ['claims:0:resolution']],
    ['challenge:w1:written:b1:p1', ['writtenClaims:0']],
  ]);
  assert.deepEqual(statuses(report), ['FYI/self_corrected']);
  assert.deepEqual([report.decisions.length, report.pivots.length, report.promises.length, report.requirements.length],
    [1, 1, 1, 1]);
  assert.deepEqual(report.writtenClaims.map((w) => w.label), ['contradicted']);
  assert.equal(report.sessionReview, 'complete');
  const [window] = report.windowResults;
  assert.equal(window.challenge.complete, true);
  // M33 C: 2 claims x 3 + 3 single-pass items x 1 + 1 resolution x 3; calls 3 + 1 + 3.
  assert.deepEqual([window.challenge.plannedVoteSlots, window.challenge.plannedCalls, window.challenge.plannedItems], [12, 7, 6]);
  assert.deepEqual(report.windowResults[0].writtenChallenge.plannedCalls, 1);
  assert.equal(report.writtenChallenge.attemptedCalls, 1);
  // The standard profile never labels a single-pass run.
  const standard = [];
  await fastReview(undefined, standard, null);
  assert.ok(standard.every((request) => !request.label.includes(':t1:')));
  assert.equal(standard.filter((request) => request.challenge).length, 9);
});

test('M33 J the contradicted claim still needs two of three grounded votes', async () => {
  const onPasses = (passes) => (item, request) => (item.key === 'claims:0'
    ? (passes.includes(request.challenge.pass) ? 'not-refuted' : 'uncertain') : 'not-refuted');
  const one = await fastReview(onPasses([1]));
  assert.deepEqual(statuses(one), [], 'one grounded vote of three publishes no finding');
  assert.equal(one.withheld.unsettled, 1);
  assert.equal(one.sessionReview, 'complete', 'every check ran; the claim is withheld, not unread');
  const two = await fastReview(onPasses([1, 3]));
  assert.deepEqual(statuses(two), ['FYI/self_corrected']);
  // A contradicted claim a DECIDE-bound pass refutes by majority is gone, never single-pass judged.
  const refuted = await fastReview((item) => (item.key === 'claims:0' ? 'refuted' : 'not-refuted'));
  assert.deepEqual(statuses(refuted), []);
});

test('M33 J a decision, a pivot or a requirement lives or dies on its one vote (M33 C: a plain claim never does)', async () => {
  const counts = (report) => ({ decisions: report.decisions.length, pivots: report.pivots.length,
    requirements: report.requirements.length, promises: report.promises.length });
  const all = { decisions: 1, pivots: 1, requirements: 1, promises: 1 };
  assert.deepEqual(counts(await fastReview()), all);
  const field = { decision: 'decisions', pivot: 'pivots', requirement: 'requirements' };
  const target = { decision: 'decisions:0', pivot: 'pivots:0', requirement: 'requirements:0' };
  const UNGROUNDED = { cite: { eventId: 'I1', role: 'instruction', quote: 'SYNTHETIC QUOTE NOBODY RECORDED' } };
  // The first pass decides. A later pass would say the opposite — so three passes would decide the
  // other way: the item is asked once, and that one vote is the whole of its challenge.
  const firstPass = (key, first, later) => (item, request) => (item.key !== key ? 'not-refuted'
    : request.challenge.pass === 1 ? first : later);
  for (const type of Object.keys(field)) {
    const seen = [];
    const lives = await fastReview(firstPass(target[type], 'not-refuted', 'uncertain'), seen);
    assert.deepEqual(counts(lives), all, `${type}: one valid not-refuted vote`);
    assert.equal(seen.filter((request) => request.challenge && keysOf(request).includes(target[type])).length, 1,
      `${type} is asked once`);
    for (const how of ['uncertain', 'refuted', 'ungrounded']) {
      const report = await fastReview(firstPass(target[type], how === 'ungrounded' ? UNGROUNDED : how, 'not-refuted'));
      if (type === 'requirement') {
        // D71 (S2; owner decision D71 b): a requirement whose one vote did not uphold its status is KEPT at its weakest,
        // not-checked, with the closed reason of how its check ended — never dropped.
        assert.deepEqual(counts(report), all, `${type} ${how}: kept`);
        assert.deepEqual([report.requirements[0].status, report.requirements[0].reason],
          ['not-checked', how === 'refuted' ? 'challenge_refuted' : 'challenge_unsettled'], `${type} ${how}`);
      } else if (type === 'decision' && how !== 'refuted') {
        // S6 (S5 review H1; owner decision D71 b): a decision whose one vote did not settle it is KEPT "could not tell" —
        // no column, the closed reason of how its check ended; a refuted one is still left out.
        assert.deepEqual(counts(report), all, `${type} ${how}: kept`);
        assert.deepEqual([report.decisions[0].column, report.decisions[0].columnState, report.decisions[0].reasons[0]],
          [null, 'unchecked', 'unsettled'], `${type} ${how}`);
      } else assert.deepEqual(counts(report), { ...all, [field[type]]: 0 }, `${type} ${how}`);
      assert.equal(report.sessionReview, 'complete', `${type} ${how}: the check ran`);
    }
  }
  // M33 C: the plain claim is asked three times; its first pass alone decides nothing.
  const seen = [];
  const claim = await fastReview(firstPass('claims:1', 'uncertain', 'not-refuted'), seen);
  assert.deepEqual(counts(claim), all, 'two of three grounded support votes');
  assert.equal(seen.filter((request) => request.challenge && keysOf(request).includes('claims:1')).length, 3);
  const once = await fastReview(firstPass('claims:1', 'not-refuted', 'uncertain'));
  // S6 (S5 review H1): one of three is not enough to settle it, so it is kept as not checked, with why.
  assert.deepEqual(counts(once), all, 'one of three is not enough: kept');
  assert.deepEqual(once.promises.map((p) => [p.status, p.reason]), [['open', 'challenge_unsettled']],
    'one of three is not enough: not checked');
});

test('M33 J a resolution still needs two of three; a written statement is labelled on its one vote', async () => {
  const resolution = (passes) => (item, request) => (item.type !== 'resolution' ? 'not-refuted'
    : passes.includes(request.challenge.pass) ? 'not-refuted' : 'uncertain');
  assert.deepEqual(statuses(await fastReview(resolution([2]))), ['DECIDE'], 'one of three leaves the finding DECIDE');
  assert.deepEqual(statuses(await fastReview(resolution([2, 3]))), ['FYI/self_corrected']);
  // The first pass decides a written statement; three passes would decide the other way.
  const written = (first, later) => (item, request) => (item.type !== 'written' ? 'not-refuted'
    : request.challenge.pass === 1 ? first : later);
  assert.deepEqual((await fastReview(written('uncertain', 'not-refuted'))).writtenClaims.map((w) => w.label), ['unverified']);
  assert.deepEqual((await fastReview(written('refuted', 'not-refuted'))).writtenClaims.map((w) => w.label), ['unverified']);
  assert.deepEqual((await fastReview(written('not-refuted', 'uncertain'))).writtenClaims.map((w) => w.label), ['contradicted']);
});

test('M33 J an omitted single-pass slot in a fast window is re-asked once, and left out twice the window is incomplete', async () => {
  const seen = [];
  const report = await fastReview((item, request) => (item.key === 'decisions:0' && !request.challenge.reask ? null
    : 'not-refuted'), seen);
  const reask = seen.filter((request) => request.label === 'challenge:w1:t1:reask:p1');
  assert.equal(reask.length, 1);
  assert.deepEqual(keysOf(reask[0]), ['decisions:0']);
  assert.equal(report.decisions.length, 1);
  assert.equal(report.sessionReview, 'complete');
  const never = await fastReview((item) => (item.key === 'decisions:0' ? null : 'not-refuted'));
  // S6 (S5 review H1): kept "could not tell", with the reason its check never ran (`unreviewed_scope`).
  assert.deepEqual(never.decisions.map((d) => [d.columnState, d.reasons[0]]), [['unchecked', 'unreviewed_scope']]);
  assert.deepEqual(never.instrument.windowCompletion.byReason, { 'challenge:votes_invalid': 1 }, 'an unfilled slot is an invalid vote');
  const [window] = never.windowResults;
  assert.deepEqual(window.challenge.rejected.filter((x) => x.key === 'decisions:0').map((x) => x.reason), ['unreviewed_scope']);
  assert.equal(window.challenge.executionComplete, false);
});

test('M33 J a fast window with nothing contradicted asks its plain claim three times and the rest once', async () => {
  const seen = [];
  const narrative = turnNarrative();
  narrative.claims = [narrative.claims[1]];
  const report = await reviewRun.runReview({ session: TURN, pr: null, reviewScope: 'session-only', speedProfile: FAST,
    judge: async (request) => { seen.push(request); return request.challenge
      ? { votes: request.challenge.items.map((item) => ({ key: item.key, verdict: 'not-refuted', explanation: 'Synthetic.',
        receipts: [ownReceipt(item.candidate)] })) } : narrative; } });
  assert.deepEqual(seen.map((request) => request.label), ['narrative:w1', 'challenge:w1:b1:p1', 'challenge:w1:b1:p2',
    'challenge:w1:b1:p3', 'challenge:w1:t1:b1:p1', 'challenge:w1:written:b1:p1']);
  assert.equal(report.sessionReview, 'complete');
  assert.equal(r.stated.eventId, 'C1', 'premise: the fixture receipts are the turn\'s');
});
