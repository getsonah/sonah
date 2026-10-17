// W3 F2 (owner decision 2026-10-13): a support whose result the record says failed (a native or
// hook failure or cancellation, or a nonzero exit: session.js `recordedFailure`) was refused `failed_result` before any
// checker saw it — yet it is the one result that can show a refusal or a failure ("Stash needs
// approval", "four behaviour tests fail"). On the session route it is now asked; its RESULT's "outcome:" line already
// shows the typed outcome, and CLAIM_NOTE says such a result supports only words saying it failed, was refused or did
// not run, or what its output shows despite failing, never that a run or check passed. The support run stays unanimous.
// How each such item ended is counted under the closed counter `failedAsked`. The combined route refuses it as before.
//
// Synthetic sessions and synthetic judges only: no recording, no model call. Nothing prints.
import test from 'node:test';
import assert from 'node:assert/strict';
import { Session } from '../src/session.js';
import { supportCheck } from '../src/claims.js';
import { runReview } from '../src/run-review.js';
import { CLAIM_NOTE, CHALLENGE_PROFILE } from '../src/challenge.js';
import { SUPPORT_ASKED, RESOLUTION_CHALLENGE_OUTCOMES } from '../src/ledger.js';
import { W2_VERSIONS, W3_VERSIONS, FIX_REVIEW_VERSIONS, CODE_PASS_VERSIONS, CODE_STEP_VERSIONS, CODE_STEP_REVIEW_VERSIONS, CODE_STEP_REREVIEW_VERSIONS, CODE_STEP_THIRD_REVIEW_VERSIONS, VOID_VOTE_REASK_VERSIONS, CLEANUP_VERSIONS, CITED_WHOLE_VERSIONS,
  textBeforeW3, textBeforeFixReview }
  from './m33-integration-fixture.js';

const TEXT = {
  ask: 'SYNTHETIC_W3C_ASK: stash the changes and run the tests.',
  run: 'git stash',
  out: 'SYNTHETIC_W3C_OUT: This command requires approval',
  said: 'SYNTHETIC_W3C_SAID: The stash needs your approval, so I did not stash anything.',
};
const whole = (key) => [{ sourceKey: key, fromByte: 0, untilByte: Buffer.byteLength(TEXT[key], 'utf8') }];
const T1 = { turn: 'T1' };
const events = (result) => [
  { id: 'I1', kind: 'instruction', authority: 'human', supersedes: [], text: whole('ask'), ...T1 },
  { id: 'A1', kind: 'invocation', callKey: 'A1', tool: 'Bash', operation: 'command', paths: [], command: whole('run'),
    input: [], changes: [], ...T1 },
  { id: 'A1-r', kind: 'observation', invocation: 'A1', callKey: 'A1', phase: 'terminal', output: whole('out'),
    sourceOfResult: 'native', terminalStatusProven: true, ...result, ...T1 },
  { id: 'C1', kind: 'commentary', phase: 'final', beforeInvocation: null, text: whole('said'), ...T1 },
].map((event, sequence) => ({ ...event, sequence }));
const sessionOf = (result = { result: 'failed', exitCode: 1 }) => new Session({ sessionKey: 'sess-w3-failed',
  adapter: 'claude', blobs: { ...TEXT }, events: events(result), children: [] });
const claim = { text: 'The agent said the stash needs approval.', stated: { eventId: 'C1', role: 'commentary',
  quote: 'The stash needs your approval' }, supportedBy: { eventId: 'A1-r', role: 'observation',
  quote: 'This command requires approval' } };
const shown = { 'A1-r': [{ role: 'observation', text: TEXT.out }] };

test('W3 F2: on the session route a failed result passes the code checks, marked; the combined route refuses it', () => {
  for (const result of [{ result: 'failed', exitCode: 1 }, { result: 'cancelled' }, { result: 'succeeded', exitCode: 2 }]) {
    const session = sessionOf(result);
    const asked = supportCheck(session, claim, shown, { checklist: true });
    assert.deepEqual([asked.ok, asked.failed], [true, true], JSON.stringify(result));
    assert.deepEqual(supportCheck(session, claim, shown), { ok: false, reason: 'failed_result' }, JSON.stringify(result));
  }
  // A result that did not fail carries no mark.
  const passed = supportCheck(sessionOf({ result: 'succeeded', exitCode: 0 }), claim, shown, { checklist: true });
  assert.deepEqual([passed.ok, passed.failed], [true, undefined]);
});

test('W3 F2: CLAIM_NOTE says what a failed result can support; one version bump, rendered back W2\'s note', () => {
  // The fix review reworded the sentence (FIX_REVIEW_TEXTS, a cancelled or stopped result named too); rendered back, it
  // is W3's own.
  assert.ok(textBeforeFixReview(CLAIM_NOTE).replace(/\s+/g, ' ').includes('A result whose outcome line says it failed'
    + ' or did not run supports only words saying it failed, was refused or did not run, or what its output shows'
    + ' despite failing; never that a run or check passed.'));
  // The fix review moved it (sonah.challenge/35 to /37): stopped results, a file rule's lifts, the existence check.
  // D87 moved it once more (sonah.challenge/38, its /35 renumbered at the merge): the code pass's own run; no other
  // request byte moved.
  // The code step moved it once more (sonah.challenge/39): the code pass's run left challengeItems for a runner of its
  // own, verdict first; no other request byte moved.
  // The review of the code step moved it once more (sonah.challenge/40): no `duplicate` refutation, and a
  // finding's checker sees no agent words; no other request byte moved.
  // The second review of the code step moved it once more (sonah.challenge/41): a code check's checker sees no word
  // of the agent's in any row; no other request byte moved.
  // The third review of the code step moved it once more (sonah.challenge/42): a code check's checker sees
  // what its row states again; no other request byte moved.
  // The re-ask of a void vote moved it once more (sonah.challenge/43): a vote a reply cast that could not be
  // counted is asked again once, naming its cause; no first-round request byte moved.
  // Its withdrawal moved it once more (sonah.challenge/44): a vote a reply cast that could not be counted stands
  // again, as before /43; no first-round request byte moved.
  // D103 moved it once more (sonah.challenge/45): a session-only batch shows the results its items cite whole.
  assert.equal(CHALLENGE_PROFILE.version, 'sonah.challenge/45');
  assert.deepEqual([W3_VERSIONS.challenge.before, W3_VERSIONS.challenge.after, FIX_REVIEW_VERSIONS.challenge.after],
    [W2_VERSIONS.challenge.after, FIX_REVIEW_VERSIONS.challenge.before, CODE_PASS_VERSIONS.challenge.before]);
  assert.equal(CODE_PASS_VERSIONS.challenge.after, CODE_STEP_VERSIONS.challenge.before);
  assert.equal(CODE_STEP_VERSIONS.challenge.after, CODE_STEP_REVIEW_VERSIONS.challenge.before);
  assert.equal(CODE_STEP_REVIEW_VERSIONS.challenge.after, CODE_STEP_REREVIEW_VERSIONS.challenge.before);
  assert.equal(CODE_STEP_REREVIEW_VERSIONS.challenge.after, CODE_STEP_THIRD_REVIEW_VERSIONS.challenge.before);
  // The re-ask of a void vote moved it once more (VOID_VOTE_REASK_VERSIONS: challenge): a vote a reply cast that could
  // not be counted is asked again once, naming its cause.
  assert.equal(VOID_VOTE_REASK_VERSIONS.challenge.before, CODE_STEP_THIRD_REVIEW_VERSIONS.challenge.after);
  // Its withdrawal moved it once more (CLEANUP_VERSIONS: challenge): a vote a reply cast that could not be counted
  // stands again, as before /43.
  assert.equal(CLEANUP_VERSIONS.challenge.before, VOID_VOTE_REASK_VERSIONS.challenge.after);
  // D103 moved it once more (CITED_WHOLE_VERSIONS: challenge): a session-only batch shows the results its items cite whole.
  assert.equal(CITED_WHOLE_VERSIONS.challenge.before, CLEANUP_VERSIONS.challenge.after);
  assert.equal(CITED_WHOLE_VERSIONS.challenge.after, CHALLENGE_PROFILE.version);
  assert.ok(!textBeforeW3(CLAIM_NOTE).includes('never that a run or check passed'));
  assert.deepEqual([...SUPPORT_ASKED], ['staleAsked', 'failedAsked']);
});

test('W3 F2: the failed result is asked as its own support item and counted by how it ended', async () => {
  const answer = { decisions: [], pivots: [], requirements: [], claims: [structuredClone(claim)] };
  const review = async (supportVerdict) => {
    const asked = [];
    const report = await runReview({ session: sessionOf(), pr: null, reviewScope: 'session-only', judge: async (request) => {
      if (!request.challenge) return structuredClone(answer);
      asked.push(...request.challenge.items);
      return { votes: request.challenge.items.map((item) => ({ key: item.key,
        verdict: item.type === 'support' ? supportVerdict : 'not-refuted', explanation: 'Synthetic.',
        receipts: [item.type === 'support' ? item.candidate.supportedBy : item.candidate.stated] })) };
    } });
    return { report, asked };
  };
  // Words that say the run was refused: the refusal supports them.
  const upheld = await review('not-refuted');
  assert.ok(upheld.asked.some((item) => item.type === 'support'), 'asked as its own item');
  assert.deepEqual(upheld.report.promises.map((p) => p.status), ['verified']);
  assert.deepEqual(upheld.report.counts.promiseSupport.failedAsked,
    Object.fromEntries(RESOLUTION_CHALLENGE_OUTCOMES.map((outcome) => [outcome, outcome === 'upheld' ? 1 : 0])));
  assert.equal(upheld.report.counts.promiseSupport.rejected.failed_result, 0);
  // Refuted (as the note says for words that a run passed): the claim stays, not checked.
  const refuted = await review('refuted');
  assert.deepEqual(refuted.report.promises.map((p) => p.status), ['open']);
  assert.equal(refuted.report.counts.promiseSupport.failedAsked.refuted, 1);
  assert.equal(refuted.report.counts.promiseSupport.staleAsked.refuted, 0, 'counted under its own counter only');
});
