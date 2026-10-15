// C-04 / W3d-1. A challenger call whose closed failure is `model_response_invalid` after the
// transport's own single retry returned a reply nobody could read. Its slots join that pass's one
// bounded re-ask, exactly like a malformed but parsed reply. Every other failure stays a check
// that did not run. Synthetic judges only: no model, no network.
import test from 'node:test';
import assert from 'node:assert/strict';
import { challengeItems, CHALLENGE_PROFILE } from '../src/challenge.js';
import { verifyReceipt } from '../src/session.js';
import { redisPivotSession, redisPivotPr } from '../fixtures/redis-pivot.js';
import { runReview, windowIncompleteReasons } from '../src/run-review.js';
import { withTransportRetry } from '../../cli/src/review-judge.js';
import { boundedJudge } from '../../cli/src/session-review.js';
import { REASKABLE_JUDGE_CODES, RETRYABLE_JUDGE_CODES, JUDGE_FAILURE_CODES } from '../src/ledger.js';

const session = redisPivotSession();
const pr = redisPivotPr();
const receipt = { eventId: 'E1', role: 'instruction', quote: 'Do not add any new infrastructure' };
const support = { verdict: 'not-refuted', explanation: 'The cited instruction establishes the constraint.', receipts: [receipt] };
const decision = { dimension: 'cache backend', chosen: 'Redis', actions: ['E3'],
  value: 'config/redis.yml', valueReceipt: { eventId: 'E3', field: 'path', role: 'action', quote: 'config/redis.yml' },
  constrainedBy: { instruction: { eventId: 'E1', role: 'instruction', quote: 'Add response caching' }, settles: false, settledValueQuote: null } };
const item = (key = 'decisions:0') => ({ key, type: 'decision', candidate: decision });
const narrative = { decisions: [decision], claims: [], pivots: [], requirements: [] };
const closed = (code) => Object.assign(new Error(code), { code });
const votes = (request, keep = () => true) => ({ votes: request.challenge.items.filter(keep).map(({ key }) => ({ key, ...support })) });

/** A counted raw judge behind the real transport retry; `fail(request)` returns an error to throw. */
function transport(fail) {
  const raw = async (request) => {
    raw.physical++;
    const error = fail(request);
    if (error) throw error;
    return votes(request);
  };
  raw.physical = 0;
  return { raw, judge: withTransportRetry(raw) };
}
const run = (judge, items = [item()]) => challengeItems({ items, evidence: 'Synthetic complete evidence.',
  judge, verifyReceipt: (r) => verifyReceipt(session, r) });
const firstPass = (request) => request.challenge.pass === 1 && !request.challenge.reask;

test('an exhausted invalid reply takes its pass\'s one re-ask and the challenge completes', async () => {
  const { raw, judge } = transport((request) => firstPass(request) ? closed('model_response_invalid') : null);
  const result = await run(judge);
  assert.equal(raw.physical, 5, 'two exhausted attempts, two good passes, one re-ask');
  assert.equal(result.reaskCalls, 1);
  assert.equal(result.reaskedSlots, 1);
  assert.equal(result.complete, true);
  assert.equal(result.executionComplete, true);
  const [first] = result.results[0].votes;
  assert.equal(first.pass, 1);
  assert.equal(first.reasked, true);
  assert.equal(first.answered, true);
  assert.equal(first.valid, true);
  assert.equal(result.survivors.length, 1);
});

test('a re-ask that is also invalid stays incomplete and is never asked a third time', async () => {
  const { raw, judge } = transport((request) => request.challenge.pass === 1 ? closed('model_response_invalid') : null);
  const result = await run(judge);
  assert.equal(result.reaskCalls, 1, 'one re-ask per pass, whatever it returns');
  assert.equal(raw.physical, 6, 'two exhausted attempts, two good passes, two exhausted re-ask attempts');
  assert.equal(result.complete, false);
  const [first] = result.results[0].votes;
  assert.equal(first.answered, false);
  assert.equal(first.reasked, true);
  assert.equal(first.reason, 'unreviewed_scope');
});

test('every other failure is a check that did not run: no re-ask, challenge incomplete', async () => {
  for (const error of ['model_unavailable', 'model_timeout', 'model_tool_use', 'model_response_incomplete',
    'model_output_limit', 'invalid_model_input', 'anthropic_key_missing'].map(closed)
    .concat([new Error('model_response_invalid'), Object.assign(new Error('x'), { code: 'MODEL_RESPONSE_INVALID' }),
      Object.assign(new Error('x'), { code: ' model_response_invalid' }), null])) {
    const judge = async (request) => {
      if (firstPass(request)) { if (error) throw error; throw undefined; }
      return votes(request);
    };
    const result = await run(judge);
    assert.equal(result.reaskCalls, 0, String(error?.code ?? error?.message ?? error));
    assert.equal(result.complete, false);
    assert.equal(result.results[0].votes[0].answered, false);
  }
});

test('budget exhaustion stops the re-ask even when an invalid reply queued one', async () => {
  const judge = async (request) => {
    if (firstPass(request)) throw closed('model_response_invalid');
    if (request.challenge.pass === 2) throw closed('budget_exhausted');
    return votes(request);
  };
  const result = await run(judge);
  assert.equal(result.budgetExhausted, true);
  assert.equal(result.reaskCalls, 0);
  assert.equal(result.complete, false);
});

test('rejected votes in a readable reply are answers, not re-ask slots', async () => {
  const judge = async (request) => (firstPass(request)
    ? { votes: request.challenge.items.map(({ key }) => ({ key, ...support,
      receipts: [{ ...receipt, quote: 'a quote that is not in the record' }] })) }
    : votes(request));
  const result = await run(judge);
  assert.equal(result.reaskCalls, 0);
  const [first] = result.results[0].votes;
  assert.equal(first.answered, true);
  assert.equal(first.reason, 'receipt_rejected');
  assert.equal(result.complete, true, 'every check ran; the rejected vote is inconclusive, not unrun (D58)');
});

test('S2: invalid and omitted slots of one pass are all re-asked, in as many batches as the bound needs', async () => {
  const items = Array.from({ length: CHALLENGE_PROFILE.maxItemsPerBatch + 2 }, (_, i) => item(`decisions:${i}`));
  const seen = [];
  const judge = async (request) => {
    if (request.challenge.reask) {
      seen.push({ label: request.label, keys: request.challenge.items.map(({ key }) => key) });
      return votes(request);
    }
    if (request.challenge.pass !== 1) return votes(request);
    // Batch 1 (16 items) is unreadable; batch 2 (2 items) omits its last item.
    if (request.challenge.batchIndex === 0) throw closed('model_response_invalid');
    return votes(request, ({ key }) => key !== `decisions:${CHALLENGE_PROFILE.maxItemsPerBatch + 1}`);
  };
  const result = await run(judge, items);
  assert.equal(result.reaskCalls, 2, 'pass 1\'s re-ask takes two batches: by the item bound, not per failed batch');
  seen.sort((a, b) => a.label.localeCompare(b.label));
  assert.deepEqual(seen.map(({ label }) => label), ['challenge:reask:p1', 'challenge:reask:p1:b2'],
    'the first batch keeps the label it always had');
  assert.deepEqual(seen[0].keys, items.slice(0, CHALLENGE_PROFILE.maxItemsPerBatch).map(({ key }) => key),
    'the first batch is filled in the fixed rank order, as the one batch was');
  assert.deepEqual(seen[1].keys, [`decisions:${CHALLENGE_PROFILE.maxItemsPerBatch + 1}`], 'the overflow is asked too');
  assert.equal(result.reaskedSlots, CHALLENGE_PROFILE.maxItemsPerBatch + 1, 'each skipped slot re-asked exactly once');
  assert.equal(result.complete, true, 'no skipped slot is left unasked');
  assert.ok(result.results.every((r) => r.executionComplete));
});

test('S2: a single-pass run whose replies skipped more than 16 items re-asks every skipped item once', async () => {
  // One window, m33-lean's single pass: batch 1's reply could not be read, batch 2's voted on one item.
  const items = Array.from({ length: CHALLENGE_PROFILE.maxItemsPerBatch + 8 }, (_, i) => item(`requirements:${i}`));
  const asked = new Map();
  const judge = async (request) => {
    for (const { key } of request.challenge.items) asked.set(key, (asked.get(key) ?? 0) + 1);
    if (request.challenge.reask) return votes(request);
    if (request.challenge.batchIndex === 0) throw closed('model_response_invalid');
    return votes(request, ({ key }) => key === `requirements:${CHALLENGE_PROFILE.maxItemsPerBatch}`);
  };
  const result = await challengeItems({ items, evidence: 'Synthetic complete evidence.', judge,
    verifyReceipt: (r) => verifyReceipt(session, r), labelPrefix: 'challenge:w1:t1', passes: 1, requiredSurvivals: 1 });
  assert.equal(result.reaskCalls, 2);
  assert.equal(result.reaskedSlots, CHALLENGE_PROFILE.maxItemsPerBatch + 7);
  const once = `requirements:${CHALLENGE_PROFILE.maxItemsPerBatch}`;
  assert.ok([...asked].every(([key, n]) => n === (key === once ? 1 : 2)), 'each asked once, re-asked at most once');
  assert.equal(result.complete, true);
  assert.equal(result.survivors.length, items.length);
});

test('S2: items that fit a request only apart are each re-asked, in batches of their own', async () => {
  const wide = (key) => ({ key, type: 'decision', candidate: { ...decision, chosen: `${key} ${'x'.repeat(6000)}` } });
  const items = ['decisions:0', 'decisions:1', 'decisions:2'].map(wide);
  const evidence = 'Synthetic complete evidence.';
  const verify = (r) => verifyReceipt(session, r);
  let single = 0;
  await challengeItems({ items: [items[0]], evidence, verifyReceipt: verify, passes: 1, requiredSurvivals: 1,
    judge: async (request) => {
      single = Buffer.byteLength(request.system) + Buffer.byteLength(request.prompt);
      return votes(request);
    } });
  const seen = [];
  // Every first reply votes on nothing; under a bound one item fits and two do not, each is re-asked on its own.
  const judge = async (request) => {
    if (!request.challenge.reask) return { votes: [] };
    seen.push({ label: request.label, keys: request.challenge.items.map(({ key }) => key) });
    return votes(request);
  };
  const result = await challengeItems({ items, evidence, judge, verifyReceipt: verify, passes: 1, requiredSurvivals: 1,
    maxInputBytes: single + 3000 });
  seen.sort((a, b) => a.label.localeCompare(b.label));
  assert.deepEqual(seen, [{ label: 'challenge:reask:p1', keys: ['decisions:0'] },
    { label: 'challenge:reask:p1:b2', keys: ['decisions:1'] },
    { label: 'challenge:reask:p1:b3', keys: ['decisions:2'] }]);
  assert.equal(result.complete, true);
});

test('an invalid reply in every pass takes one re-ask per pass', async () => {
  const judge = async (request) => (request.challenge.reask ? votes(request) : (() => { throw closed('model_response_invalid'); })());
  const result = await run(judge);
  assert.equal(result.reaskCalls, CHALLENGE_PROFILE.passes);
  assert.equal(result.complete, true);
  assert.ok(result.results[0].votes.every((vote) => vote.reasked === true && vote.answered === true));
});

test('a window whose challenger reply was unreadable is not capped once its re-ask answers', async () => {
  const judge = withTransportRetry(async (request) => {
    if (!request.challenge) return narrative;
    if (firstPass(request)) throw closed('model_response_invalid');
    return votes(request);
  });
  const report = await runReview({ session, pr, judge });
  assert.equal(report.challenge.reaskCalls, 1);
  assert.equal(report.decisions.length, 1);
  assert.ok(report.windowResults.every((window) => !windowIncompleteReasons(window).includes('challenge:votes_invalid')));
  const failing = withTransportRetry(async (request) => {
    if (!request.challenge) return narrative;
    if (request.challenge.pass === 1) throw closed('model_response_invalid');
    return votes(request);
  });
  const capped = await runReview({ session, pr, judge: failing });
  assert.ok(capped.windowResults.some((window) => windowIncompleteReasons(window).includes('challenge:votes_invalid')),
    'near miss: a failed re-ask still caps the window');
  assert.notEqual(capped.coverage, 'complete');
});

test('the re-askable code is closed, retryable and a judge failure: reaching the challenge means the retry is spent', () => {
  assert.deepEqual([...REASKABLE_JUDGE_CODES], ['model_response_invalid']);
  for (const code of REASKABLE_JUDGE_CODES) {
    assert.ok(RETRYABLE_JUDGE_CODES.includes(code), code);
    assert.ok(JUDGE_FAILURE_CODES.includes(code), code);
  }
});

test('the failure that ended the transport attempt decides: timeout then invalid is re-asked, the reverse is not', async () => {
  for (const [sequence, reasked] of [[['model_timeout', 'model_response_invalid'], 1], [['model_response_invalid', 'model_timeout'], 0]]) {
    let attempt = 0;
    const judge = withTransportRetry(async (request) => {
      if (firstPass(request)) throw closed(sequence[attempt++]);
      return votes(request);
    });
    const result = await run(judge);
    assert.equal(result.reaskCalls, reasked, sequence.join(' then '));
    assert.equal(result.complete, reasked === 1);
  }
});

test('session-only review through the real boundedJudge: each unreadable challenger is sent twice, then re-asked once', async () => {
  const physical = new Map();
  const raw = async (request) => {
    physical.set(request.label, (physical.get(request.label) ?? 0) + 1);
    if (!request.challenge) return structuredClone(narrative);
    if (firstPass(request)) throw closed('model_response_invalid');
    return votes(request);
  };
  const report = await runReview({ session, pr: null, reviewScope: 'session-only', judge: boundedJudge(raw) });
  const firstPassLabels = [...physical.keys()].filter((label) => /:b\d+:p1$/.test(label));
  assert.ok(firstPassLabels.length > 0);
  assert.ok(firstPassLabels.every((label) => physical.get(label) === 2), 'the transport retried each once');
  assert.deepEqual([...physical.keys()].filter((label) => /:reask:p1$/.test(label)).map((label) => physical.get(label)), [1]);
  assert.equal(report.challenge.reaskCalls, 1);
  assert.ok(report.windowResults.every((window) => !windowIncompleteReasons(window).includes('challenge:votes_invalid')));
});
