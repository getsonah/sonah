// M33 K. The opt-in "m33-lean" speed profile: the standard profile's windows and request bound (so every
// narrative request is byte-identical to the standard one, and a standard run's stored D60 answers answer
// a lean run with no call), m33-fast's tiered challenge, twelve window lanes and twelve calls in flight —
// and, for its single-pass run only, a cited-evidence dossier in place of the whole window evidence.
//
// Synthetic sessions and fake judges only: no model, no network, no recording. Each test that writes gets
// its own temporary directory.
import test from 'node:test';
import assert from 'node:assert/strict';
import { cp, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as reviewRun from '../../evidence/src/run-review.js';
import * as profiles from '../../evidence/src/review-profiles.js';
import { answerKey, createAnswerCache } from '../src/answer-cache.js';
import * as sr from '../src/session-review.js';
import { ownReceipt, largeSession, manyWindowSession, turnNarrative, turnSession } from './m33-fast-profile-fixture.js';
import { WINDOW_REQUEST_MAX_BYTES } from '../../evidence/src/windows.js';

const LEAN = 'm33-lean';
const BACKENDS = [['claude-cli', 'claude-synthetic-1'], ['codex-cli', 'synthetic-model']];

async function directory(t, name) {
  const dir = await mkdtemp(join(tmpdir(), `sonah-k-lean-${name}-`));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return dir;
}

test('M33 K m33-lean is frozen: standard windows and request bound, a tiered challenge, 12 lanes and 12 calls', () => {
  assert.deepEqual(profiles.REVIEW_SPEED_PROFILE_NAMES, ['standard', 'm33-fast', 'm33-lean']);
  const lean = profiles.reviewSpeedProfile(LEAN);
  const standard = profiles.reviewSpeedProfile('standard');
  assert.ok(Object.isFrozen(lean));
  assert.equal(lean.maxInputBytes, standard.maxInputBytes);
  // M35 windowing: every profile's windows are the spec's (no window source budget is named) and its request bound
  // the spec's worst-case window call.
  assert.deepEqual([lean.windowSourceBytes, lean.maxInputBytes], [undefined, WINDOW_REQUEST_MAX_BYTES]);
  assert.deepEqual([lean.windowConcurrency, lean.maxCallsInFlight], [12, 12]);
  assert.equal(profiles.tieredChallenge(lean), true);
  assert.equal(lean.singlePassEvidence, 'dossier');
  assert.deepEqual([...profiles.SINGLE_PASS_EVIDENCE], ['window', 'dossier']);
  assert.equal(profiles.dossierChallenge(lean), true);
  // The other two profiles are unchanged, byte for byte: no new member.
  for (const name of ['standard', 'm33-fast']) {
    assert.equal(profiles.dossierChallenge(profiles.reviewSpeedProfile(name)), false, name);
    assert.ok(!Object.hasOwn(profiles.REVIEW_SPEED_PROFILES[name], 'singlePassEvidence'), name);
  }
  assert.equal(profiles.challengeProfileOf(lean).singlePassEvidence, 'dossier');
  assert.ok(!Object.hasOwn(profiles.challengeProfileOf(profiles.reviewSpeedProfile('m33-fast')), 'singlePassEvidence'));
});

test('M33 K every m33-lean narrative request is byte-identical to the standard one; answer keys are identical', () => {
  for (const session of [largeSession(), manyWindowSession(5), turnSession()]) {
    const standard = reviewRun.planWindowRequests({ session, reviewScope: 'session-only' });
    const lean = reviewRun.planWindowRequests({ session, reviewScope: 'session-only', speedProfile: LEAN });
    assert.equal(lean.requests.length, standard.requests.length, session.sessionKey);
    assert.deepEqual(lean.windows.map((w) => w.events.map((e) => e.id)), standard.windows.map((w) => w.events.map((e) => e.id)));
    lean.requests.forEach((built, at) => {
      const base = standard.requests[at];
      const { request } = built;
      assert.deepEqual([request.system, request.prompt, request.label], [base.request.system, base.request.prompt,
        base.request.label], `${session.sessionKey} w${at + 1}`);
      assert.equal(request.evidencePrompt, base.request.evidencePrompt);
      assert.deepEqual(built.sourceMap, base.sourceMap);
      for (const [backend, model] of BACKENDS)
        assert.equal(answerKey(request, { backend, model }), answerKey(base.request, { backend, model }));
    });
  }
});

test('M33 K the m33-lean run profile is its own: its checkpoint keys never collide with standard or m33-fast', () => {
  const digests = ['standard', 'm33-fast', LEAN].map((name) => sr.sessionProfileDigest(name));
  assert.equal(new Set(digests).size, 3);
  assert.equal(sr.sessionProfileDigest(), digests[0], 'naming nothing is standard, as before');
  const lean = reviewRun.runProfile('session-only', LEAN);
  assert.equal(lean.speedProfile.name, LEAN);
  assert.equal(lean.challenge.singlePassEvidence, 'dossier');
  assert.notDeepEqual(lean, reviewRun.runProfile('session-only', 'm33-fast'));
  assert.notDeepEqual(lean, reviewRun.runProfile('session-only'));
  assert.throws(() => reviewRun.runProfile('combined', LEAN), RangeError, 'a session-only experiment');
});

/** A judge that answers the turn session's narrative and grounds every vote on the item's first receipt;
 *  every live call's label is kept in `labels`. */
const turnJudge = (labels) => async (request) => {
  labels.push(request.label);
  if (!request.challenge) return turnNarrative();
  return { votes: request.challenge.items.map((item) => ({ key: item.key, verdict: 'not-refuted',
    explanation: 'Synthetic.', receipts: [ownReceipt(item.candidate)] })) };
};

test('M33 K a lean review over a COPY of a standard review\'s answers asks no narrative again', async (t) => {
  const base = await directory(t, 'reuse');
  const session = turnSession();
  const [backend, model] = BACKENDS[1];
  const review = (out, answers, labels, speedProfile) => sr.reviewSession({ session, judge: turnJudge(labels),
    backend, model, answerCache: createAnswerCache(answers, { backend, model }),
    store: sr.createSessionReviewStore(join(out, 'review')), ...(speedProfile ? { speedProfile } : {}) });
  const standardLabels = [];
  const standard = await review(join(base, 'standard'), join(base, 'standard', 'answers'), standardLabels);
  assert.equal(standard.report.sessionReview, 'complete');
  assert.ok(standardLabels.includes('narrative:w1'));
  // The lean run reads a copy: the standard store is never written by it.
  await cp(join(base, 'standard', 'answers'), join(base, 'lean', 'answers'), { recursive: true });
  const leanLabels = [];
  const lean = await review(join(base, 'lean'), join(base, 'lean', 'answers'), leanLabels, LEAN);
  assert.ok(!leanLabels.some((label) => label.startsWith('narrative:')), 'no narrative call');
  assert.ok(lean.progress.calls.reused >= 1, 'the narrative answer was replayed');
  // The resolution run keeps the standard bytes too (three passes over the whole window): replayed.
  assert.ok(!leanLabels.some((label) => label.includes(':resolution:')), 'no resolution call');
  assert.ok(leanLabels.some((label) => label.startsWith('challenge:w1:t1:')), 'the dossier run is live');
  assert.equal(lean.report.sessionReview, 'complete');
  // The standard store still answers the standard review alone, with no call.
  const again = [];
  await review(join(base, 'standard-again'), join(base, 'standard', 'answers'), again);
  assert.deepEqual(again, [], 'the standard answers were not touched by the lean run');
});
