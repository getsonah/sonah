// M33 J repair (after adversarial review of the opt-in "m33-fast" speed profile).
//
// 1. A fast window's request carried the window's source AND every human instruction recorded up to its
//    end (the verbatim inventory), which the source budget did not count, so m33-fast re-cut a window whose
//    request did not fit. M35 windowing removed the re-cut with the byte-budget splitter: the carried context is
//    capped, and every profile's windows and request bound are the spec's.
// 2. m33-fast is a session-only profile: a combined (PR) review under it is refused before anything.
// 3. runReview holds a fast review to its profile's calls in flight, narrative and challenge together,
//    so `report.instrument.maxCallsInFlight` is a true bound (12), not lanes x pool (72).
// 4. A tiered window's challenge shortfall states no single pass count: its items were asked once or
//    three times.
//
// Synthetic sessions and fake judges only: no model call, no recording. Nothing prints.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as reviewRun from '../../evidence/src/run-review.js';
import { reviewInputBytes } from '../../evidence/src/challenge.js';
import { WINDOW_REQUEST_MAX_BYTES } from '../../evidence/src/windows.js';
import { renderReview } from '../../evidence/src/review.js';
import { contradictedNarrative, contradictedSession, ownReceipt, fixtureJudge, inventorySession,
  turnNarrative, turnSession, windowNarrative } from './m33-fast-profile-fixture.js';

const profiles = await import('../../evidence/src/review-profiles.js').catch(() => ({}));
const FAST = 'm33-fast';
const SPLIT_REASONS = ['compaction', 'source-byte-budget', 'oversized-event', 'session-end'];
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const ids = (windows) => windows.flatMap((window) => window.events.map((event) => event.id));
const sizes = (plan) => plan.requests.map(({ request }) => reviewInputBytes(request));
const plan = (session, speedProfile) => reviewRun.planWindowRequests({ session, reviewScope: 'session-only',
  ...(speedProfile ? { speedProfile } : {}) });

// ---- 1. no re-cut ------------------------------------------------------------------------------------------
// M35 windowing (C-07): the re-cut is gone with the byte-budget splitter. A window's request is its work (at most 200k
// tokens, or one segment piece over it) and its carried context, capped at 200k tokens, so the inventory that made a
// fast window's request outgrow its bound is bounded by construction; a request over the spec's worst-case call is
// `unreviewed_scope`, never re-cut or clipped.
test('M35 the inventory session: every request fits the one bound, no window is re-cut and none is lost', async () => {
  const session = inventorySession();
  for (const speedProfile of [undefined, FAST]) {
    const planned = plan(session, speedProfile);
    assert.ok(sizes(planned).every((bytes) => bytes <= WINDOW_REQUEST_MAX_BYTES), String(speedProfile));
    assert.deepEqual(ids(planned.windows), session.events.map((event) => event.id), 'nothing lost, nothing twice');
    assert.ok(planned.windows.every((w) => w.oversize === false && !Object.hasOwn(w, 'sourceByteBudget')));
  }
  const report = await reviewRun.runReview({ session, pr: null, reviewScope: 'session-only', speedProfile: FAST,
    judge: fixtureJudge({ narrativeOf: (request) => windowNarrative(session, request.window), omitOnPass: 0 }) });
  assert.deepEqual(report.windowFailures, [], 'no window is unreviewed_scope');
  assert.equal(Object.hasOwn(profiles.REVIEW_SPEED_PROFILES[FAST], 'windowSourceFloorBytes'), false);
  assert.equal(Object.hasOwn(reviewRun.runProfile('session-only', FAST), 'segmentation'), false);
});

// ---- 2. session-only -------------------------------------------------------------------------------------------
test('M33 J m33-fast runs a session-only review only; a combined review under it is refused before any call', async () => {
  const session = contradictedSession(2);
  const judge = async () => { throw new Error('SYNTHETIC: no call may be made'); };
  assert.throws(() => reviewRun.planWindowRequests({ session, speedProfile: FAST }), RangeError);
  assert.throws(() => reviewRun.planWindowRequests({ session, reviewScope: 'combined', speedProfile: FAST }), RangeError);
  await assert.rejects(reviewRun.runReview({ session, pr: null, reviewScope: 'combined', speedProfile: FAST, judge }), RangeError);
  await assert.rejects(reviewRun.runReview({ session, pr: null, speedProfile: FAST, judge }), RangeError);
  assert.throws(() => reviewRun.runProfile('combined', FAST), RangeError);
  // Standard, named or not, still runs a combined review.
  assert.equal(reviewRun.planWindowRequests({ session, reviewScope: 'combined', speedProfile: 'standard' }).windows.length, 2);
  assert.equal(reviewRun.runProfile('combined', 'standard').reviewScope, 'combined');
});

// ---- 3. calls in flight ------------------------------------------------------------------------------------------
test('M33 J a fast review holds itself to twelve calls in flight, narrative and challenge together', async () => {
  const session = contradictedSession(14);
  const count = { inFlight: 0, peak: 0, calls: 0 };
  const counted = (inner) => async (request) => {
    count.calls++;
    count.inFlight++;
    count.peak = Math.max(count.peak, count.inFlight);
    try { await sleep(5); return await inner(request); } finally { count.inFlight--; }
  };
  const answer = fixtureJudge({ narrativeOf: (request) => contradictedNarrative(request.window), omitOnPass: 0 });
  const report = await reviewRun.runReview({ session, pr: null, reviewScope: 'session-only', speedProfile: FAST,
    judge: counted(answer) });
  // 14 narratives and each window's contradicted claim asked three times: 12 lanes x 3 passes could be 36.
  assert.equal(count.calls, 14 * 4);
  assert.equal(count.peak, 12, 'twelve calls at once, never more');
  assert.equal(report.instrument.maxCallsInFlight, 12, 'the declared bound is the one the review holds to');
  assert.equal(report.instrument.speedProfile.maxCallsInFlight, 12);
  assert.equal(report.sessionReview, 'complete');
  // A separate challenge judge shares the same twelve slots.
  Object.assign(count, { inFlight: 0, peak: 0, calls: 0 });
  await reviewRun.runReview({ session, pr: null, reviewScope: 'session-only', speedProfile: FAST,
    judge: counted(answer), challengeJudge: counted(answer) });
  assert.equal(count.peak, 12);
  // Standard is unchanged: no limiter of its own, and the declared bound is still lanes x pool.
  const standard = await reviewRun.runReview({ session, pr: null, reviewScope: 'session-only', judge: answer });
  assert.equal(standard.instrument.maxCallsInFlight, 18);
});

test('M33 J after an abort no call waiting for a fast slot reaches the judge', async () => {
  const session = contradictedSession(14);
  const controller = new AbortController();
  const answer = fixtureJudge({ narrativeOf: (request) => contradictedNarrative(request.window), omitOnPass: 0 });
  const started = [];
  const gates = [];
  const judge = async (request) => {
    if (!request.challenge) return answer(request);
    started.push(request.label);
    await new Promise((resolve) => gates.push(resolve));
    return answer(request);
  };
  const run = reviewRun.runReview({ session, pr: null, reviewScope: 'session-only', speedProfile: FAST, judge,
    signal: controller.signal });
  await sleep(30);
  assert.equal(started.length, 12, 'twelve challenge calls hold every slot; the rest wait');
  controller.abort();
  for (const release of gates) release();
  await assert.rejects(run, { code: 'review_interrupted' });
  assert.equal(started.length, 12, 'no waiting call started after the abort');
});

// ---- 4. the shortfall of a tiered window ---------------------------------------------------------------------------
test('M33 J a tiered window\'s challenge shortfall states no single pass count', async () => {
  const session = turnSession();
  // decisions:0 is never voted on: its window's challenge is incomplete.
  const judge = async (request) => (request.challenge ? { votes: request.challenge.items
    .filter((item) => item.key !== 'decisions:0')
    .map((item) => ({ key: item.key, verdict: 'not-refuted', explanation: 'Synthetic.', receipts: [ownReceipt(item.candidate)] })) }
    : turnNarrative());
  const run = (speedProfile) => reviewRun.runReview({ session, pr: null, reviewScope: 'session-only',
    ...(speedProfile ? { speedProfile } : {}), judge });
  const fast = await run(FAST);
  const [fastWindow] = fast.windowResults;
  assert.equal(fastWindow.shortfall.challenge.reason, 'votes_invalid');
  assert.equal(fastWindow.shortfall.challenge.passes, null, 'items asked once and items asked three times');
  assert.ok(Number.isSafeInteger(fastWindow.shortfall.challenge.validVotes));
  assert.doesNotMatch(renderReview(fast), /valid votes of \d+ passes/);
  const standard = await run(null);
  assert.equal(standard.windowResults[0].shortfall.challenge.passes, 3, 'standard is unchanged');
  assert.match(renderReview(standard), /valid votes of 3 passes/);
});
