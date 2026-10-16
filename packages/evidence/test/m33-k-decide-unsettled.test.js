// M33 K (C-06 "decide_unsettled"). A claim that cites the result contradicting it is DECIDE-bound: when its
// challenge ends unsettled (every pass voted, nothing settled) or unexecuted (some pass never voted), it is
// withheld — and until now no part reason said so, so its part could read CLEAN. Now the part whose events
// it cites (its stated or contradictedBy event) cannot read CLEAN: it reads NO_FINDINGS with the closed
// reason `decide_unsettled` — never DECIDE, ambiguous evidence is never an accusation — and the session
// cannot read CLEAN because of it. A refuted contradiction is a completed check and leaves CLEAN; a
// surviving one is DECIDE as before. Every profile.
//
// Synthetic sessions and judges only: no model call, no recording. Nothing prints.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as ledger from '../src/ledger.js';
import * as review from '../src/review.js';
import * as reviewRun from '../src/run-review.js';
import { Session } from '../src/session.js';
import { ownReceipt, turnNarrative, turnSession } from '../../cli/test/m33-fast-profile-fixture.js';

const TURN = turnSession();
const CLAIM = 'claims:0';

function judge(verdict) {
  return async (request) => {
    if (!request.challenge) return turnNarrative();
    return { votes: request.challenge.items.flatMap((item) => {
      const chosen = verdict(item, request);
      if (chosen === null) return [];
      return [{ key: item.key, verdict: chosen, explanation: 'Synthetic.',
        receipts: chosen === 'uncertain' ? [] : [ownReceipt(item.candidate)] }];
    }) };
  };
}
const run = (verdict, speedProfile = null) => reviewRun.runReview({ session: TURN, pr: null, reviewScope: 'session-only',
  ...(speedProfile ? { speedProfile } : {}), judge: judge(verdict) });
const onClaim = (claim, rest = 'not-refuted') => (item) => (item.key === CLAIM ? claim : rest);
const part = (report) => report.parts.find((p) => p.part === 'T1');
/** The same recording with no turn recorded: no part can be named, the session is reduced as a whole. */
const turnless = (s) => new Session({ sessionKey: s.sessionKey, adapter: s.adapter, blobs: s.blobs, children: s.children,
  events: s.events.map(({ turn, ...event }) => event) });

test('M33 K decide_unsettled is a closed part reason, neither a review nor a coverage reason, and a part cause', () => {
  assert.ok(ledger.PART_REASONS.includes('decide_unsettled'));
  assert.ok(!ledger.PART_REVIEW_REASONS.includes('decide_unsettled'), 'the review of the part did complete');
  assert.ok(!ledger.PART_COVERAGE_REASONS.includes('decide_unsettled'), 'no recorder limit names it');
  assert.ok(ledger.PART_CAUSES.includes('parts_decide_unsettled'));
});

test('M33 K a part whose contradicted claim ended unsettled reads NO_FINDINGS / decide_unsettled, not CLEAN', async () => {
  for (const profile of [null, 'm33-fast', 'm33-lean']) {
    const report = await run(onClaim('uncertain'), profile);
    const label = String(profile);
    assert.equal(report.sessionReview, 'complete', label);
    assert.equal(report.coverage, 'complete', label);
    assert.deepEqual(report.findings.filter((f) => f.kind === 'claim_contradicted'), [], `${label}: withheld, never published`);
    assert.equal(part(report).status, 'NO_FINDINGS', label);
    assert.deepEqual(part(report).reasons, ['decide_unsettled'], label);
    assert.equal(report.sessionStatus, 'NO_FINDINGS', label);
    assert.equal(report.reviewStatus, 'NO_FINDINGS', label);
    assert.deepEqual(report.partCounts, { parts_fully_checked: 0, parts_partial: 0, parts_decide_unsettled: 1,
      parts_unchecked: 0, session_wide_unchecked: 0 }, label);
  }
});

test('M33 K a refuted contradiction leaves CLEAN; a surviving one is DECIDE as before', async () => {
  const refuted = await run(onClaim('refuted'));
  assert.equal(part(refuted).status, 'CLEAN');
  assert.deepEqual(part(refuted).reasons, []);
  assert.equal(refuted.sessionStatus, 'CLEAN');
  assert.equal(refuted.partCounts.parts_decide_unsettled, 0);
  // The claim survives and its resolution does not: the contradiction stands, DECIDE.
  const survived = await run((item) => (item.key === `${CLAIM}:resolution` ? 'refuted' : 'not-refuted'));
  assert.equal(part(survived).status, 'DECIDE');
  assert.ok(part(survived).reasons.includes('finding_decide'));
  assert.ok(!part(survived).reasons.includes('decide_unsettled'));
  assert.equal(survived.sessionStatus, 'DECIDE');
});

test('M33 K an unexecuted contradiction check names its part too; the part stays UNCHECKED, never upgraded', async () => {
  const report = await run(onClaim(null));
  assert.ok(part(report).reasons.includes('decide_unsettled'));
  assert.ok(part(report).reasons.includes('window_incomplete'));
  assert.equal(part(report).status, 'UNCHECKED');
  assert.equal(report.partCounts.parts_unchecked, 1);
  assert.equal(report.partCounts.parts_decide_unsettled, 0, 'counted once, as unchecked');
});

test('M33 K the reason survives a saved report, and the part counts name the check that did not settle', async () => {
  const report = await run(onClaim('uncertain'));
  const { session: omitted, ...saved } = report;
  const again = ledger.honestStatuses(saved);
  assert.equal(again.sessionStatus, 'NO_FINDINGS');
  assert.deepEqual(again.parts.find((p) => p.part === 'T1').reasons, ['decide_unsettled']);
  // D71 (a): the review ran to completion over complete coverage, so no cause says a partial coverage it is not.
  assert.equal(ledger.reviewRunState(report), 'complete', 'never read as a partial coverage it is not');
  assert.deepEqual(review.coverageCauses(report), []);
  assert.equal(report.partCounts.parts_decide_unsettled, 1);
});

test('M33 K a session reduced as a whole (no recorded turn) cannot read CLEAN because of it', async () => {
  const report = await run(onClaim('uncertain'));
  const whole = ledger.honestStatuses({ ...report, session: turnless(report.session) });
  assert.deepEqual(whole.parts, []);
  assert.equal(whole.sessionStatus, 'NO_FINDINGS');
  const refuted = await run(onClaim('refuted'));
  const clean = ledger.honestStatuses({ ...refuted, session: turnless(refuted.session) });
  assert.equal(clean.sessionStatus, 'CLEAN');
});
