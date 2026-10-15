// F72: one shared limit on judge calls actually running at once, in the one wrapper every
// backend passes through (`boundedJudge`). W3-7 runs WINDOW_CONCURRENCY (3) windows in
// parallel, and each window's own challenge pool can run CHALLENGE_PROFILE.maxConcurrency (6)
// calls at once — nothing above them held the TOTAL, so a real run could put 3 x 6 = 18
// `claude --print` subprocesses in flight where the backend had only ever been asked for 6.
//
// Synthetic only: no model, no network, no git, no real session or recording.
import test from 'node:test';
import assert from 'node:assert/strict';
import { runReview, WINDOW_CONCURRENCY } from '../../evidence/src/run-review.js';
import { CHALLENGE_PROFILE } from '../../evidence/src/challenge.js';
import { Session } from '../../evidence/src/session.js';
import { boundedJudge, createCallLimiter, MAX_CALLS_IN_FLIGHT } from '../src/session-review.js';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const WINDOWS = 7;
// One window's challenge pool alone must be able to saturate CHALLENGE_PROFILE.maxConcurrency:
// with more than maxItemsPerBatch (16) candidates it splits into two batches, so the pool's
// queue (batches x passes) is 6, wide enough to run all 6 workers at once instead of stalling
// at fewer.
const REQUIREMENTS_PER_WINDOW = CHALLENGE_PROFILE.maxItemsPerBatch + 1;

/** `count` windows, each one recorded instruction and nothing else — enough for a requirement candidate to cite a
 * real, in-window receipt. M35 windowing: a compaction no longer splits a window, so each instruction is followed by a
 * long thought (120k bytes, never carried): no two fit a combined review's ~196k-byte work budget, and each is a window
 * of its own. */
function multiWindowSession(count = WINDOWS) {
  const blobs = {};
  const events = [];
  let sequence = 0;
  const whole = (key) => [{ sourceKey: key, fromByte: 0, untilByte: Buffer.byteLength(blobs[key], 'utf8') }];
  for (let i = 1; i <= count; i++) {
    blobs[`ask${i}`] = `SYNTHETIC_F72_ASK_${i}: do the step ${i} work and nothing else.`;
    blobs[`think${i}`] = `SYNTHETIC_F72_THINK_${i}: working on step ${i}.\n${'k'.repeat(120_000)}`;
    events.push({ id: `I${i}`, kind: 'instruction', sequence: sequence++, authority: 'human',
      text: whole(`ask${i}`), supersedes: [] });
    events.push({ id: `T${i}`, kind: 'commentary', phase: 'working', beforeInvocation: null, sequence: sequence++,
      text: whole(`think${i}`) });
    if (i < count) events.push({ id: `B${i}`, kind: 'boundary', sequence: sequence++, boundary: 'compaction' });
  }
  return new Session({ sessionKey: 'sess-f72', adapter: 'claude', events, blobs });
}

const windowOf = (label) => Number(/:w(\d+)/.exec(label ?? '')?.[1] ?? 0);
const EMPTY = { decisions: [], pivots: [], claims: [], requirements: [] };

/** Enough distinct, validly-sourced requirement candidates that this window's challenge pool
 * alone needs two batches (see REQUIREMENTS_PER_WINDOW above). */
function narrativeFor(i) {
  return { ...EMPTY, requirements: Array.from({ length: REQUIREMENTS_PER_WINDOW }, (_, k) => ({
    text: `SYNTHETIC_F72_REQ_${i}_${k}`, status: 'open',
    instruction: { eventId: `I${i}`, role: 'instruction', quote: `SYNTHETIC_F72_ASK_${i}` } })) };
}

/** The raw (unbounded) transport `boundedJudge` wraps. Records exactly when each call actually
 * ran, which is what a "calls in flight" measurement needs — not when it was merely issued. */
function recordingTransport({ latencyMs, calls }) {
  return async (request) => {
    const call = { label: request.label, started: performance.now(), ended: null };
    calls.push(call);
    if (latencyMs) await sleep(latencyMs);
    call.ended = performance.now();
    if (request.challenge)
      return { votes: request.challenge.items.map(({ key }) => ({ key, verdict: 'not-refuted',
        explanation: 'Synthetic vote for the shared in-flight limiter test.', receipts: [] })) };
    return narrativeFor(windowOf(request.label));
  };
}

/** The largest number of recorded calls that were ever simultaneously between `started` and
 * `ended` — an actual observed peak, not a declared or theoretical one. */
function maxInFlight(calls) {
  const edges = calls.flatMap((c) => [{ at: c.started, delta: 1 }, { at: c.ended, delta: -1 }])
    .sort((a, b) => a.at - b.at || a.delta - b.delta);
  let live = 0, peak = 0;
  for (const edge of edges) { live += edge.delta; peak = Math.max(peak, live); }
  return peak;
}

test('F72 the premise: this scenario really does ask for more than the shared limit at once', () => {
  // Three windows (WINDOW_CONCURRENCY) each drive a full CHALLENGE_PROFILE.maxConcurrency-wide
  // challenge pool through the same judge. Nothing above `boundedJudge` caps the total, so an
  // unbounded wrapper would put this many calls in flight together.
  assert.equal(WINDOW_CONCURRENCY * CHALLENGE_PROFILE.maxConcurrency, 18);
  assert.ok(18 > MAX_CALLS_IN_FLIGHT, 'the scenario must demand more than the shared limit to prove anything');
});

test('F72 boundedJudge holds every judge call — narrative and challenge, across every window — to one shared limit', async () => {
  const session = multiWindowSession(WINDOWS);
  const calls = [];
  const judge = boundedJudge(recordingTransport({ latencyMs: 50, calls }));
  const report = await runReview({ session, pr: null, judge });

  assert.equal(report.windowFailures.length, 0, 'no window should fail merely for having to wait its turn');
  assert.ok(calls.length > MAX_CALLS_IN_FLIGHT,
    `only ${calls.length} judge calls were made; this scenario must issue more than the limit to prove anything`);

  const peak = maxInFlight(calls);
  // The scenario is built to demand up to 18 calls at once; the limiter grants exactly
  // MAX_CALLS_IN_FLIGHT immediately and queues the rest, so a saturating scenario like this one
  // should observe the limit itself, not merely stay under it.
  assert.equal(peak, MAX_CALLS_IN_FLIGHT,
    `${peak} judge calls were in flight at once, not the shared limit of ${MAX_CALLS_IN_FLIGHT}`);
});

test('F72 the limiter makes a call wait, never fails it', async () => {
  const session = multiWindowSession(WINDOWS);
  const calls = [];
  const judge = boundedJudge(recordingTransport({ latencyMs: 5, calls }));
  const report = await runReview({ session, pr: null, judge });
  assert.deepEqual(report.windowFailures, []);
  for (const window of report.windowResults) assert.equal(window.failure, null);
});

test('F72 window order survives the shared limiter: same answers, same report regardless of how calls queue', async () => {
  const session = multiWindowSession(3);
  const fast = await runReview({ session, pr: null,
    judge: boundedJudge(recordingTransport({ latencyMs: 1, calls: [] })) });
  const slow = await runReview({ session, pr: null,
    judge: boundedJudge(recordingTransport({ latencyMs: 13, calls: [] })) });
  assert.deepEqual(fast.windowResults.map((w) => w.windowIndex), [0, 1, 2]);
  assert.deepEqual(slow.windowResults.map((w) => w.windowIndex), [0, 1, 2]);
  assert.equal(JSON.stringify(fast.requirements), JSON.stringify(slow.requirements));
});

test('F72 a limiter of one still drains its whole queue, strictly serialized, no deadlock', async () => {
  const limiter = createCallLimiter(1);
  const order = [];
  async function task(id) {
    await limiter.acquire();
    order.push(`start${id}`);
    await sleep(3);
    order.push(`end${id}`);
    limiter.release();
  }
  await Promise.all([1, 2, 3, 4, 5].map(task));
  assert.deepEqual(order, ['start1', 'end1', 'start2', 'end2', 'start3', 'end3', 'start4', 'end4', 'start5', 'end5']);
  assert.equal(limiter.peak, 1);
});

test('F72 createCallLimiter rejects a non-positive-integer size', () => {
  for (const bad of [0, -1, 1.5, NaN, Infinity, '6'])
    assert.throws(() => createCallLimiter(bad), RangeError);
});
