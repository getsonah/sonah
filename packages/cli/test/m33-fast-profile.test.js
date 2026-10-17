// M33 J. The opt-in "m33-fast" speed profile: twelve window lanes, and twelve calls in flight through a limiter of
// its own — the thirteenth waits. The PR-review path and the standard profile keep today's limiter and budget. (Its
// wider windows and request bound, 786432 and 1048576 bytes, are gone with M35 windowing: every profile's are the
// spec's.)
//
// Synthetic sessions and fake judges only: no model, no network, no recording. Each test that writes
// gets its own temporary directory.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as reviewRun from '../../evidence/src/run-review.js';
import { reviewInputBytes } from '../../evidence/src/challenge.js';
import { WINDOW_REQUEST_MAX_BYTES, windowingProfileOf } from '../../evidence/src/windows.js';
import { boundedJudge, windowOfLabel, windowsToReask } from '../src/session-review.js';
import { createAnswerCache } from '../src/answer-cache.js';
import * as sr from '../src/session-review.js';
import { largeSession, manyWindowSession } from './m33-fast-profile-fixture.js';

const profiles = await import('../../evidence/src/review-profiles.js').catch(() => ({}));
const FAST = 'm33-fast';
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const EMPTY = { decisions: [], pivots: [], claims: [], requirements: [] };
const deferred = () => { let resolve; const promise = new Promise((r) => { resolve = r; }); return { promise, resolve }; };

async function directory(t, name) {
  const dir = await mkdtemp(join(tmpdir(), `sonah-j-fast-${name}-`));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return dir;
}

// ---- windows and requests ----------------------------------------------------------------------------
// M35 windowing (C-07): every profile windows a session by the spec and bounds its requests by the spec's worst-case
// window call, so m33-fast's wider windows and request bound (786432 and 1048576 bytes) are gone; what still sets it
// apart is its lanes, its calls in flight and its tiered challenge.
test('M35 every speed profile plans the same windows and the same narrative requests', () => {
  for (const session of [largeSession(), manyWindowSession(3)]) {
    const fast = reviewRun.planWindowRequests({ session, reviewScope: 'session-only', speedProfile: FAST });
    const standard = reviewRun.planWindowRequests({ session, reviewScope: 'session-only' });
    assert.deepEqual(fast.windows.map((w) => w.events.map((e) => e.id)), standard.windows.map((w) => w.events.map((e) => e.id)));
    assert.deepEqual(fast.requests.map((r) => r.request.prompt), standard.requests.map((r) => r.request.prompt));
    assert.ok(fast.requests.every((r) => reviewInputBytes(r.request) <= profiles.REVIEW_SPEED_PROFILES[FAST].maxInputBytes));
  }
});

test('M33 J the instrument names the profile and states its bounds', async () => {
  const session = manyWindowSession(2);
  const run = (speedProfile) => reviewRun.runReview({ session, pr: null, reviewScope: 'session-only',
    ...(speedProfile ? { speedProfile } : {}), judge: async (request) => (request.challenge ? { votes: [] } : EMPTY) });
  const fast = (await run(FAST)).instrument;
  assert.deepEqual(fast.speedProfile, profiles.REVIEW_SPEED_PROFILES[FAST]);
  assert.equal(fast.windowConcurrency, 12);
  // M35 windowing: every profile's request bound is the spec's worst-case window call, and its windowing the spec's.
  // D103: the windowing of the session's harness (a Claude Code recording: 12,000 bytes a side).
  const windowing = windowingProfileOf('session-only', undefined, 'claude');
  assert.equal(windowing.skimSideBytes, 12_000);
  assert.equal(fast.maxInputBytes, WINDOW_REQUEST_MAX_BYTES);
  assert.equal(Object.hasOwn(fast, 'segmentation'), false);
  assert.deepEqual(fast.windowing, windowing);
  assert.equal(fast.challenge.maxInputBytes, WINDOW_REQUEST_MAX_BYTES);
  const standard = (await run(null)).instrument;
  assert.deepEqual(standard.speedProfile, profiles.REVIEW_SPEED_PROFILES.standard);
  assert.equal(standard.windowConcurrency, 3);
  assert.equal(standard.maxInputBytes, WINDOW_REQUEST_MAX_BYTES);
  assert.deepEqual(standard.windowing, windowing);
  assert.equal(standard.maxCallsInFlight, 18, 'the evidence package\'s declared bound is unchanged');
});

// ---- lanes -------------------------------------------------------------------------------------------------
/** A judge whose narrative calls wait until `lanes` of them are in flight (or a fallback passes). */
function laneJudge(lanes) {
  const state = { inFlight: 0, peak: 0, calls: 0 };
  let full = deferred();
  const judge = async (request) => {
    if (request.challenge) return { votes: [] };
    state.calls++;
    state.inFlight++;
    state.peak = Math.max(state.peak, state.inFlight);
    if (state.inFlight >= lanes) full.resolve();
    await Promise.race([full.promise, sleep(300)]);
    await sleep(5);
    state.inFlight--;
    if (state.inFlight === 0) full = deferred();
    return EMPTY;
  };
  return { judge, state };
}

test('M33 J m33-fast runs twelve window lanes; standard three; the bound follows the profile', async () => {
  const session = manyWindowSession(14);
  const fast = laneJudge(12);
  await reviewRun.runReview({ session, pr: null, reviewScope: 'session-only', speedProfile: FAST, judge: fast.judge });
  assert.equal(fast.state.peak, 12, 'twelve windows were in flight together, never more');
  assert.equal(fast.state.calls, 14);
  const standard = laneJudge(3);
  await reviewRun.runReview({ session, pr: null, reviewScope: 'session-only', judge: standard.judge });
  assert.equal(standard.state.peak, 3);
  const call = (speedProfile, concurrency) => reviewRun.runReview({ session, pr: null, reviewScope: 'session-only',
    ...(speedProfile ? { speedProfile } : {}), concurrency, judge: async () => EMPTY });
  await assert.rejects(call(FAST, 13), RangeError);
  await assert.rejects(call(null, 4), RangeError);
  await assert.rejects(call('standard', 4), RangeError);
  await assert.rejects(call(FAST, 0), RangeError);
  await call(FAST, 12);
  await assert.rejects(call('SYNTHETIC_PROFILE', 1), RangeError);
  // A precomputed plan is bound to its profile.
  const plan = reviewRun.planWindowRequests({ session, reviewScope: 'session-only', speedProfile: FAST });
  await assert.rejects(reviewRun.runReview({ session, pr: null, reviewScope: 'session-only', plan, judge: async () => EMPTY }),
    TypeError);
  await reviewRun.runReview({ session, pr: null, reviewScope: 'session-only', speedProfile: FAST, plan, judge: async () => EMPTY });
});

// ---- calls in flight ---------------------------------------------------------------------------------------
/** Start `n` calls through `bounded`; each raw call waits for its own release. */
function heldCalls(bounded, n) {
  const started = [];
  const releases = [];
  const raw = async (request) => {
    const gate = deferred();
    started.push(request.label);
    releases.push(gate.resolve);
    await gate.promise;
    return { ok: true };
  };
  const results = Array.from({ length: n }, (_, i) => bounded(raw)({ system: 'SYNTHETIC_SYSTEM', prompt: `SYNTHETIC_${i}`, label: `x${i}` }));
  return { started, releases, results };
}

test('M33 J m33-fast holds twelve calls in flight and the thirteenth waits; standard holds six', async () => {
  const fast = heldCalls((raw) => boundedJudge(raw, () => {}, { speedProfile: FAST }), 13);
  await sleep(20);
  assert.equal(fast.started.length, 12, 'twelve calls are in flight');
  // Standard calls do not queue behind the fast limiter: the PR-review limiter is its own.
  const standard = heldCalls((raw) => boundedJudge(raw), 7);
  await sleep(20);
  assert.equal(standard.started.length, 6, 'the standard limiter still holds six');
  assert.equal(fast.started.length, 12, 'the thirteenth fast call still waits');
  fast.releases[0]();
  await sleep(20);
  assert.equal(fast.started.length, 13, 'the thirteenth call starts when a slot is released');
  standard.releases[0]();
  await sleep(20);
  assert.equal(standard.started.length, 7);
  for (const release of [...fast.releases, ...standard.releases]) release();
  await Promise.all([...fast.results, ...standard.results]);
});

test('M35 the byte ceiling follows the scope: the spec\'s window call for every session review, 524288 for PR review', async () => {
  const answer = async () => ({ ok: true });
  const sized = (bytes) => ({ system: '', prompt: 'x'.repeat(bytes), label: 'narrative:w1' });
  for (const speedProfile of [FAST, 'standard', undefined]) {
    const session = boundedJudge(answer, () => {}, { speedProfile, reviewScope: 'session-only' });
    assert.deepEqual(await session(sized(WINDOW_REQUEST_MAX_BYTES)), { ok: true }, String(speedProfile));
    await assert.rejects(session(sized(WINDOW_REQUEST_MAX_BYTES + 1)), { code: 'budget_exhausted' }, String(speedProfile));
  }
  const pr = boundedJudge(answer);
  assert.deepEqual(await pr(sized(524288)), { ok: true });
  await assert.rejects(pr(sized(524289)), { code: 'budget_exhausted' });
  assert.throws(() => boundedJudge(answer, () => {}, { speedProfile: 'SYNTHETIC_PROFILE' }), RangeError);
});

// ---- the session review ----------------------------------------------------------------------------------------
const IDENTITY = { backend: 'claude-cli', model: 'sonnet' };

test('M33 J a fast session review runs twelve calls at once and keys its checkpoints apart from standard', async (t) => {
  const dir = await directory(t, 'session');
  const session = manyWindowSession(14);
  const lanes = laneJudge(12);
  const { report } = await sr.reviewSession({ session, judge: lanes.judge, ...IDENTITY, speedProfile: FAST,
    answerCache: createAnswerCache(join(dir, 'answers'), IDENTITY), store: sr.createSessionReviewStore(join(dir, 'fast')) });
  assert.equal(lanes.state.peak, 12, 'the session review\'s limiter is sized by its profile');
  assert.equal(report.instrument.speedProfile.name, FAST);
  // The same session and answers under standard: its window keys are other keys, never a fast record's.
  const records = await sr.reviewSession({ session, judge: laneJudge(3).judge, ...IDENTITY,
    answerCache: createAnswerCache(join(dir, 'answers'), IDENTITY), store: sr.createSessionReviewStore(join(dir, 'fast')) });
  assert.equal(records.progress.checkpoint.recordsRead, 0, 'no standard window read a fast window\'s record');
  assert.equal(records.report.instrument.speedProfile.name, 'standard');
  assert.throws(() => sr.sessionProfileDigest('SYNTHETIC_PROFILE'), RangeError);
});

test('M33 J F226 reads the single-pass challenge labels as their window\'s', () => {
  assert.equal(windowOfLabel('challenge:w3:t1:b1:p1'), 3);
  assert.equal(windowOfLabel('challenge:w12:t1:b2:p1'), 12);
  assert.equal(windowOfLabel('challenge:w3:t1:reask:p1'), 3);
  assert.equal(windowOfLabel('challenge:w3:written:b1:p1'), 3);
  assert.deepEqual([...windowsToReask([{ windowIndex: 2, failure: null, groundingComplete: true,
    challenge: { complete: false, results: [{ votes: [{ valid: false }] }] } }])], [3]);
});
