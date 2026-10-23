// D145 (0.3.0-beta.7). The passes of one challenge batch send one request, byte for byte. A prompt cache entry is read
// only once the reply that wrote it has begun, so passes sent at the same moment each wrote the whole prompt to the
// cache and none read it. Each batch's later passes are now sent only after its first pass's reply has begun (or its
// call settled), every batch's first pass first, in one fixed order.
//
// Synthetic only: the redis-pivot fixture's decision, copied under new keys; fake judges on real timers. No model.
import test from 'node:test';
import assert from 'node:assert/strict';
import { challengeItems, CHALLENGE_PROFILE, REPLY_BEGUN, withReplyBegun } from '../src/challenge.js';
import { verifyReceipt } from '../src/session.js';
import { redisPivotSession } from '../fixtures/redis-pivot.js';
import { runReview } from '../src/run-review.js';
import { named } from './m33-u-unasked-fixture.js';
import { readingStableIds } from './m35-windows-fixture.js';
import { pastedRows, loadPasted, ASK } from './gain-i-images-fixture.js';

const session = redisPivotSession();
const receipt = { eventId: 'E1', role: 'instruction', quote: 'Do not add any new infrastructure' };
const decision = { dimension: 'cache backend', chosen: 'Redis', actions: ['E3'],
  value: 'config/redis.yml', valueReceipt: { eventId: 'E3', field: 'path', role: 'action', quote: 'config/redis.yml' },
  constrainedBy: { instruction: { eventId: 'E1', role: 'instruction', quote: 'Add response caching' }, settles: false, settledValueQuote: null } };
/** `batches` full batches of the profile's item bound: `batches` x 16 decisions, so the run plans exactly that many. */
const itemsFor = (batches) => Array.from({ length: batches * CHALLENGE_PROFILE.maxItemsPerBatch },
  (_, k) => ({ key: `decisions:${k}`, type: 'decision', candidate: decision }));
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const batchOf = (label) => Number(/:b(\d+):p\d+$/.exec(label)[1]);
const passOf = (label) => Number(/:p(\d+)$/.exec(label)[1]);
/** A third pass refutes, so the votes tell the passes apart. */
const answer = (request) => ({ votes: request.challenge.items.map(({ key }) => ({ key,
  verdict: request.challenge.pass === 3 ? 'refuted' : 'not-refuted', explanation: 'SYNTHETIC_D145 vote.', receipts: [receipt] })) });

/**
 * A fake transport on real timers. Each call logs its start; `begin(label)` ms later it says its reply has begun (when
 * `signal` and the request carries REPLY_BEGUN) and logs it; `end(label)` ms after its start it answers. `cache` models
 * the prompt cache: a call reads it when an earlier call of the same bytes has begun its reply, and writes it otherwise.
 */
function timedJudge({ log, begin = () => 5, end = () => 30, signal = true, cache = null }) {
  return async (request) => {
    const bytes = `${request.system}\u0000${request.prompt}`;
    log.push({ label: request.label, at: 'start' });
    if (cache) {
      if (cache.begun.has(bytes)) cache.reads++; else cache.writes++;
      cache.live++; cache.peak = Math.max(cache.peak, cache.live);
    }
    const told = request[REPLY_BEGUN];
    const timer = setTimeout(() => {
      log.push({ label: request.label, at: 'begun' });
      cache?.begun.add(bytes);
      if (signal && typeof told === 'function') told();
    }, begin(request.label));
    await sleep(end(request.label));
    clearTimeout(timer);
    cache?.begun.add(bytes);
    if (cache) cache.live--;
    log.push({ label: request.label, at: 'end' });
    return answer(request);
  };
}
const challenge = (items, judge, more = {}) => challengeItems({ items, evidence: 'Synthetic complete evidence.', judge,
  verifyReceipt: (r) => verifyReceipt(session, r), labelPrefix: 'challenge:w1', ...more });
const indexOf = (log, label, at) => log.findIndex((entry) => entry.label === label && entry.at === at);
const starts = (log) => log.filter((entry) => entry.at === 'start').map((entry) => entry.label);

test('D145 a later pass is sent once its first pass\'s reply has begun, while that pass is still answering', async () => {
  const log = [];
  const result = await challenge(itemsFor(2), timedJudge({ log, begin: () => 15, end: () => 120 }));
  assert.equal(result.attemptedCalls, 6);
  for (const b of [1, 2]) {
    const begun = indexOf(log, `challenge:w1:b${b}:p1`, 'begun'), ended = indexOf(log, `challenge:w1:b${b}:p1`, 'end');
    assert.ok(begun > -1 && ended > begun, `batch ${b}: the first pass began, then ended`);
    for (const pass of [2, 3]) {
      const sent = indexOf(log, `challenge:w1:b${b}:p${pass}`, 'start');
      assert.ok(sent > begun, `batch ${b} pass ${pass} was sent before its first pass's reply began`);
      assert.ok(sent < ended, `batch ${b} pass ${pass} waited for its first pass to end, past the reply's start`);
    }
  }
});

test('D145 with no reply-begun signal, a later pass is sent once its first pass has answered', async () => {
  const log = [];
  await challenge(itemsFor(2), timedJudge({ log, begin: () => 5, end: () => 40, signal: false }));
  for (const b of [1, 2]) for (const pass of [2, 3])
    assert.ok(indexOf(log, `challenge:w1:b${b}:p${pass}`, 'start') > indexOf(log, `challenge:w1:b${b}:p1`, 'end'),
      `batch ${b} pass ${pass}`);
});

test('D145 every batch\'s first pass goes first, and calls reach the judge in one order whatever the timing', async () => {
  const order = ['challenge:w1:b1:p1', 'challenge:w1:b2:p1', 'challenge:w1:b3:p1', 'challenge:w1:b1:p2',
    'challenge:w1:b1:p3', 'challenge:w1:b2:p2', 'challenge:w1:b2:p3', 'challenge:w1:b3:p2', 'challenge:w1:b3:p3'];
  const runs = [];
  // The first batch's reply begins last, then first; the third batch's ends first, then last; and no reply-begun signal.
  for (const timing of [{ begin: (l) => [40, 5, 20][batchOf(l) - 1], end: (l) => [60, 30, 10][batchOf(l) - 1] },
    { begin: (l) => [5, 30, 15][batchOf(l) - 1], end: (l) => [10, 45, 70][batchOf(l) - 1] },
    { begin: () => 1, end: (l) => 5 + 10 * passOf(l), signal: false }]) {
    const log = [];
    const result = await challenge(itemsFor(3), timedJudge({ log, ...timing }));
    assert.deepEqual(starts(log), order);
    runs.push(result);
  }
  // The same votes, in the same order, whatever came back first.
  const instant = await challenge(itemsFor(3), async (request) => answer(request));
  for (const result of runs) {
    assert.deepEqual(result.results, instant.results);
    assert.deepEqual(result.rejected, instant.rejected);
    assert.deepEqual(result.survivors.map((item) => item.key), instant.survivors.map((item) => item.key));
  }
});

test('D145 the prompt cache: each batch writes its prompt once and its later passes read it', async () => {
  for (const signal of [true, false]) {
    const cache = { begun: new Set(), writes: 0, reads: 0, live: 0, peak: 0 };
    const result = await challenge(itemsFor(4), timedJudge({ log: [], begin: () => 5, end: () => 25, signal, cache }));
    assert.equal(result.attemptedCalls, 12);
    // Before D145 all three passes of a batch were sent at once: 12 writes and no read.
    assert.deepEqual({ writes: cache.writes, reads: cache.reads }, { writes: 4, reads: 8 }, `signal ${signal}`);
    // A pass that waits holds no call: no more calls than the run's workers are ever in flight.
    assert.ok(cache.peak <= CHALLENGE_PROFILE.maxConcurrency);
  }
});

test('D145 only a first pass whose later passes wait carries REPLY_BEGUN, and no byte, key or copy holds it', async () => {
  const seen = [];
  await challenge(itemsFor(1), async (request) => { seen.push(request); return answer(request); });
  const [first, ...later] = seen;
  assert.equal(first.label, 'challenge:w1:b1:p1');
  assert.equal(typeof first[REPLY_BEGUN], 'function');
  assert.equal(Object.getOwnPropertyDescriptor(first, REPLY_BEGUN).enumerable, false);
  assert.deepEqual(Object.keys(first), Object.keys(later[0]));
  assert.ok(!JSON.stringify(first).includes(REPLY_BEGUN));
  assert.equal(first.prompt, later[0].prompt);
  assert.equal(first.system, later[0].system);
  for (const request of later) assert.equal(Object.hasOwn(request, REPLY_BEGUN), false, request.label);
  assert.equal(Object.hasOwn({ ...first }, REPLY_BEGUN), false, 'a spread leaves it behind');
  const copied = withReplyBegun(first, { ...first, images: [] });
  assert.equal(copied[REPLY_BEGUN], first[REPLY_BEGUN], 'withReplyBegun carries it to a copy');
  assert.equal(Object.hasOwn(withReplyBegun(later[0], { ...later[0] }), REPLY_BEGUN), false);
  // A single-pass run: nothing waits, so nothing is carried.
  const single = [];
  await challenge(itemsFor(2), async (request) => { single.push(request); return answer(request); },
    { passes: 1, requiredSurvivals: 1 });
  assert.deepEqual(single.map((request) => request.label), ['challenge:w1:b1:p1', 'challenge:w1:b2:p1']);
  for (const request of single) assert.equal(Object.hasOwn(request, REPLY_BEGUN), false);
});

test('D145 a first pass refused before any call stops its later passes; a first pass that fails lets them go', async () => {
  const fail = (code) => async (request) => {
    if (request.challenge.pass === 1) throw Object.assign(new Error(code), { code });
    return answer(request);
  };
  const refused = await challenge(itemsFor(1), fail('budget_exhausted'));
  // Before D145 the two later passes were already sent beside it, and refused the same way.
  assert.equal(refused.attemptedCalls, 1);
  assert.equal(refused.budgetExhausted, true);
  assert.ok(refused.results.every((r) => r.votes.length === 3 && r.votes.every((v) => v.answered === false)));
  const failed = await challenge(itemsFor(1), fail('model_unavailable'));
  assert.equal(failed.attemptedCalls, 3);
  assert.ok(failed.results.every((r) => r.votes.map((v) => v.answered).join() === 'false,true,true'));
});

test('D145 a window that sends images keeps the first pass\'s REPLY_BEGUN on the copy that carries them', async (t) => {
  // Gain I's recording: a human message with a pasted image; on claude-cli every request of its window carries it.
  const { session } = await loadPasted(t, pastedRows());
  const id = (label) => named(session, label);
  const dimension = 'SYNTHETIC_D145_DIMENSION: how the module is exported';
  const sent = [];
  const answer = readingStableIds(session, async (request) => {
    if (request.challenge) return { votes: request.challenge.items.map(({ key }) => ({ key, verdict: 'not-refuted',
      explanation: 'SYNTHETIC: the record shows it.', receipts: [{ eventId: id('I1'), role: 'instruction', quote: ASK }] })) };
    const empty = { decisions: [], pivots: [], claims: [], requirements: [] };
    if (!/:w1(?::|$)/.test(request.label ?? '')) return empty;
    return { ...empty, decisions: [{ dimension, chosen: 'Use src/parser.js', actions: [id('A1-0')], value: 'src/parser.js',
      valueReceipt: { eventId: id('A1-0'), role: 'action', field: 'path', quote: 'src/parser.js' },
      stated: { eventId: id('C1-0-1'), role: 'commentary', quote: 'Writing the parser now.' }, constrainedBy: null }] };
  });
  await runReview({ session, pr: null, reviewScope: 'session-only', backend: 'claude-cli',
    judge: (request) => { sent.push(request); return answer(request); } });
  const passes = sent.filter((request) => request.challenge && /:b\d+:p\d+$/.test(request.label));
  const firsts = passes.filter((request) => request.label.endsWith(':p1')
    && passes.some((later) => later.label === request.label.replace(/:p1$/, ':p2')));
  assert.ok(firsts.length > 0, 'a three-pass run was asked');
  for (const request of passes) assert.equal(request.images?.length, 1, request.label);
  for (const request of firsts) assert.equal(typeof request[REPLY_BEGUN], 'function', request.label);
  for (const request of passes.filter((r) => !firsts.includes(r))) assert.equal(Object.hasOwn(request, REPLY_BEGUN), false);
});
