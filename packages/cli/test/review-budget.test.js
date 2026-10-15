import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createAnswerCache, memoizeJudge } from '../src/answer-cache.js';
import { DEFAULT_REVIEW_BUDGET, REVIEW_BUDGET_REASONS, normalizeReviewBudget, createReviewBudget, estimateLine,
  estimateMinutes, REVIEW_ESTIMATE_RATES } from '../src/review-budget.js';

const request = { system: 'é', prompt: '🙂' };
function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}

test('budget defaults and raw CLI grammars remain explicit and normalized options are reusable', () => {
  assert.deepEqual(DEFAULT_REVIEW_BUDGET, { maxCalls: null, maxInputBytes: null, stopAtUtilization: null });
  assert.ok(Object.isFrozen(DEFAULT_REVIEW_BUDGET));
  assert.deepEqual(REVIEW_BUDGET_REASONS, ['max_calls', 'max_input_bytes', 'utilization']);
  const options = { backend: 'codex-cli' };
  assert.equal(normalizeReviewBudget(options), options);
  assert.deepEqual(options, { backend: 'codex-cli', ...DEFAULT_REVIEW_BUDGET });
  assert.equal(createReviewBudget(options).snapshot().calls, 0);
  // null is "no stop" (owner decision 2026-10-10), so normalized options normalize again unchanged.
  assert.deepEqual(normalizeReviewBudget({ ...options }), options);
  assert.deepEqual(normalizeReviewBudget({ maxCalls: '9007199254740991', maxInputBytes: '42', stopAtUtilization: '1.000000' }),
    { maxCalls: Number.MAX_SAFE_INTEGER, maxInputBytes: 42, stopAtUtilization: 1 });
  for (const stopAtUtilization of ['0.9', '0.000001', '1', '1.0'])
    assert.equal(normalizeReviewBudget({ stopAtUtilization }).stopAtUtilization, Number(stopAtUtilization));
  for (const field of ['maxCalls', 'maxInputBytes']) for (const value of ['0', '01', '+1', '1e2', '1.0', ' 1', '1 ',
    '١', '9007199254740992', '', true, NaN, Infinity, -1])
    assert.throws(() => normalizeReviewBudget({ [field]: value }), { code: 'usage' });
  for (const stopAtUtilization of ['0', '0.000000', '.9', '0.9000000', '1.000001', '2', '1e0', '0.9 ',
    '', true, NaN, Infinity, -1, 0.0000001])
    assert.throws(() => normalizeReviewBudget({ stopAtUtilization }), { code: 'usage' });
  // The usage error names the flag whose value it refused, never the value.
  for (const [field, flag] of [['maxCalls', '--max-calls'], ['maxInputBytes', '--max-input-bytes'],
    ['stopAtUtilization', '--stop-at-utilization']])
    assert.throws(() => normalizeReviewBudget({ [field]: 'SYNTHETIC_BAD_VALUE' }),
      (error) => error.code === 'usage' && error.problem.startsWith(`${flag} needs `)
        && !error.problem.includes('SYNTHETIC_BAD_VALUE'));
});

test('call reservations happen before delivery and strictly bound concurrent attempts', async () => {
  const budget = createReviewBudget({ maxCalls: 2 }), release = deferred();
  let delivered = 0;
  const judge = budget.wrap(async () => {
    delivered++;
    assert.equal(budget.snapshot().calls, delivered, 'each attempt is charged before transport delivery');
    return release.promise;
  });
  const one = judge(request), two = judge(request);
  assert.equal(budget.snapshot().calls, 2);
  assert.equal(budget.snapshot().inputBytes, 12, 'UTF-8 system and prompt bytes are charged');
  await assert.rejects(judge(request), { code: 'budget_exhausted' });
  assert.equal(delivered, 2);
  assert.equal(budget.signal.aborted, true);
  assert.equal(budget.snapshot().reason, 'max_calls');
  release.resolve({ synthetic: true });
  assert.deepEqual(await Promise.all([one, two]), [{ synthetic: true }, { synthetic: true }]);
});

test('byte reservations refuse an oversized attempt before delivery and preserve exact-limit calls', async () => {
  const budget = createReviewBudget({ maxInputBytes: 12 }), release = deferred();
  let delivered = 0;
  const judge = budget.wrap(async () => { delivered++; return release.promise; });
  const one = judge(request), two = judge(request);
  await assert.rejects(judge(request), { code: 'budget_exhausted' });
  assert.equal(delivered, 2); assert.equal(budget.snapshot().inputBytes, 12);
  assert.equal(budget.snapshot().reason, 'max_input_bytes');
  release.resolve({ synthetic: true });
  await Promise.all([one, two]);
  const tooSmall = createReviewBudget({ maxInputBytes: 1 });
  await assert.rejects(tooSmall.wrap(() => assert.fail('oversized request must not be sent'))(request), { code: 'budget_exhausted' });
  assert.equal(tooSmall.snapshot().calls, 0); assert.equal(tooSmall.snapshot().inputBytes, 0);
});

test('failed delivery and repeated physical attempts remain charged', async () => {
  const budget = createReviewBudget({ maxCalls: 2 });
  const judge = budget.wrap(() => { throw new Error('SYNTHETIC_PRIVATE_DELIVERY_ERROR'); });
  await assert.rejects(judge(request));
  await assert.rejects(judge(request));
  await assert.rejects(judge(request), { code: 'budget_exhausted' });
  assert.equal(budget.snapshot().calls, 2); assert.equal(budget.snapshot().inputBytes, 12);
  assert.doesNotMatch(budget.summaryLine(), /PRIVATE|DELIVERY|ERROR/);
});

test('utilization stops admission while in-flight answers remain cacheable and are free on resume', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'sonah-budget-cache-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const cache = createAnswerCache(directory, { backend: 'codex-cli', model: 'gpt-synthetic' });
  const budget = createReviewBudget({ maxCalls: 4, stopAtUtilization: 0.9 }), started = deferred(), release = deferred();
  let sent = 0;
  const judge = memoizeJudge(budget.wrap(async () => {
    if (++sent === 2) started.resolve();
    return release.promise;
  }), cache);
  const a = { system: 'synthetic', prompt: 'one' }, b = { system: 'synthetic', prompt: 'two' };
  const one = judge(a), two = judge(b);
  await started.promise;
  budget.record({ ok: true, backend: 'codex-cli', usage: { input_tokens: 10, output_tokens: 2 }, rateLimit: { utilization: 0.91 } });
  assert.equal(budget.signal.aborted, true);
  await assert.rejects(judge({ system: 'synthetic', prompt: 'three' }), { code: 'budget_exhausted' });
  release.resolve({ synthetic: true });
  await Promise.all([one, two]);
  budget.record({ ok: true, backend: 'codex-cli', usage: { input_tokens: 20, output_tokens: 3 } });
  assert.equal(budget.snapshot().calls, 2);
  assert.equal(budget.snapshot().reason, 'utilization');
  const resumed = createReviewBudget();
  const replay = memoizeJudge(resumed.wrap(() => assert.fail('stored answers must not spend a call')), cache);
  assert.deepEqual(await Promise.all([replay(a), replay(b)]), [{ synthetic: true }, { synthetic: true }]);
  assert.equal(resumed.snapshot().calls, 0);
  assert.equal(resumed.snapshot().inputTokens, 0);
});

test('Claude/API cache tokens count as input; Codex cached input remains a subset', async () => {
  const budget = createReviewBudget();
  const metadata = [
    { backend: 'claude-cli', usage: { input_tokens: 10, cache_creation_input_tokens: 20, cache_read_input_tokens: 30, output_tokens: 4 } },
    { backend: 'anthropic-api', usage: { input_tokens: 5, cache_read_input_tokens: 6, output_tokens: 2 } },
    { backend: 'codex-cli', usage: { input_tokens: 100, cached_input_tokens: 80, output_tokens: 3, total_tokens: 103 } },
  ];
  const judge = budget.wrap(async () => { budget.record(metadata.shift()); return {}; });
  await judge(request); await judge(request); await judge(request);
  assert.equal(budget.snapshot().inputTokens, 171);
  assert.equal(budget.snapshot().outputTokens, 9);
  assert.equal(budget.snapshot().inputReportedCalls, 3);
  assert.equal(budget.snapshot().outputReportedCalls, 3);
});

test('success and failure usage count; missing usage stays unreported with directional coverage', async () => {
  const budget = createReviewBudget();
  const judge = budget.wrap(async metadata => { budget.record(metadata); return {}; });
  await judge({ ok: true, usage: { input_tokens: 10, output_tokens: 0 } });
  await judge({ ok: false, usage: { input_tokens: 2 } });
  await judge({ ok: false, usage: null });
  const state = budget.snapshot();
  assert.equal(state.calls, 3); assert.equal(state.reportedCalls, 3);
  assert.equal(state.inputTokens, 12); assert.equal(state.inputReportedCalls, 2);
  assert.equal(state.outputTokens, 0); assert.equal(state.outputReportedCalls, 1);
  assert.match(budget.summaryLine(), /input tokens 12 \(2\/3 calls reported\)/);
  assert.match(budget.summaryLine(), /output tokens 0 \(1\/3 calls reported\)/);
  const unknown = createReviewBudget();
  await unknown.wrap(async () => ({}))(request);
  assert.equal(unknown.snapshot().inputTokens, null); assert.equal(unknown.snapshot().outputTokens, null);
  assert.match(unknown.summaryLine(), /input tokens not reported \(0\/1 calls reported\)/);
  assert.equal(createReviewBudget().snapshot().inputTokens, 0);
});

test('invalid/unsafe token fields and provider text cannot become measured totals or output', async () => {
  const budget = createReviewBudget();
  await budget.wrap(async () => {
    budget.record({ usage: { input_tokens: Number.MAX_SAFE_INTEGER, cache_read_input_tokens: 1, output_tokens: 'private' },
      model: 'SYNTHETIC_PRIVATE_MODEL', text: 'SYNTHETIC_PRIVATE_OUTPUT', rateLimit: { utilization: Infinity, status: 'PRIVATE' } });
    return {};
  })(request);
  assert.equal(budget.snapshot().inputTokens, null); assert.equal(budget.snapshot().outputTokens, null);
  assert.equal(budget.snapshot().utilization, null);
  assert.doesNotMatch(JSON.stringify(budget.snapshot()) + budget.summaryLine(), /PRIVATE|private|Infinity|NaN/);
  const aggregate = createReviewBudget();
  const judge = aggregate.wrap(async usage => { aggregate.record({ usage }); return {}; });
  await judge({ input_tokens: Number.MAX_SAFE_INTEGER, output_tokens: Number.MAX_SAFE_INTEGER });
  await judge({ input_tokens: 1, output_tokens: 1 });
  assert.equal(aggregate.snapshot().inputTokens, Number.MAX_SAFE_INTEGER);
  assert.equal(aggregate.snapshot().inputReportedCalls, 1);
});

test('latest valid transport utilization is retained and wall time is invocation elapsed time', async () => {
  let clock = 100;
  const budget = createReviewBudget({ stopAtUtilization: 0.9 }, { now: () => clock });
  await budget.wrap(async () => {
    budget.record({ elapsedMs: 9000, rateLimit: { utilization: 0.8 } });
    budget.record({ elapsedMs: 9000, rateLimit: { utilization: 0.4 } });
    budget.record({ rateLimit: { utilization: -1 } });
    return {};
  })(request);
  clock = 350;
  assert.equal(budget.snapshot().elapsedMs, 250);
  assert.equal(budget.snapshot().utilization, 0.4);
  assert.equal(budget.snapshot().reason, null);
  assert.equal(budget.pauseLine(), null);
  assert.match(budget.summaryLine(), /wall 250 ms; utilization 0\.4\./);
  budget.record({ rateLimit: { utilization: 0.90 } });
  assert.equal(budget.snapshot().reason, 'utilization');
  assert.match(budget.pauseLine(), /^Review stopped where you asked \(utilization\)\. Run the same command again.*answers/);
});

// Owner decision 2026-10-10: no limits by default; a review runs to the end and states its expected size up front.
test('a review with no stop flags never pauses, whatever it costs or reports', async () => {
  const budget = createReviewBudget();
  const send = budget.wrap(async () => 'answer');
  for (let i = 0; i < 500; i++) assert.equal(await send({ system: 'x'.repeat(10), prompt: 'y'.repeat(100_000) }), 'answer');
  budget.record({ rateLimit: { utilization: 0.99 } });
  assert.equal(budget.snapshot().reason, null);
  assert.equal(budget.signal.aborted, false);
  assert.equal(budget.pauseLine(), null);
});

// D84 (4) a, owner decision 2026-10-12: the person sees only a rough time; calls, sizes and windows are internal.
test('the estimate line states only a rough time from the plan, and how to stop', () => {
  const line = estimateLine({ requestBytes: [400_000], lanes: 3 });
  assert.equal(line, 'This review should take roughly 4-12 minutes (less if answers are already stored). '
    + 'It runs to the end; press Ctrl-C to stop at any point (answers so far are kept and the same command resumes).');
  for (const words of [/call/i, /MB|byte/i, /window/i]) assert.doesNotMatch(line, words);
  assert.equal(estimateLine({ requestBytes: [], lanes: 3 }), 'This review has nothing to send to a model.');
  assert.equal(estimateLine({}), 'This review has nothing to send to a model.');
  assert.doesNotMatch(estimateLine({ requestBytes: [400_000, 400_000], lanes: undefined }), /NaN|undefined/);
});

test('a dry run\'s estimate line says how long a review would take, and promises no run', () => {
  assert.equal(estimateLine({ requestBytes: [400_000], lanes: 3, dryRun: true }),
    'A review should take roughly 4-12 minutes (less if answers are already stored).');
  assert.equal(estimateLine({ requestBytes: [], lanes: 3, dryRun: true }),
    'A review would have nothing to send to a model.');
  assert.doesNotMatch(estimateLine({ requestBytes: [400_000], lanes: 3, dryRun: true }), /runs to the end|Ctrl-C/);
});

test('the estimated time follows each window request size and the lanes, by the frozen rates', () => {
  assert.deepEqual(REVIEW_ESTIMATE_RATES,
    { minutesAtOneMB: 12.3, exponent: 0.61, range: [0.6, 1.7], unknownRequestBytes: 48_000 });
  assert.ok(Object.isFrozen(REVIEW_ESTIMATE_RATES) && Object.isFrozen(REVIEW_ESTIMATE_RATES.range));
  // A short session is not quoted as a long one: the size of the request moves the range.
  assert.deepEqual(estimateMinutes({ requestBytes: [30_000], lanes: 3 }), [1, 2]);
  assert.deepEqual(estimateMinutes({ requestBytes: [400_000], lanes: 3 }), [4, 12]);
  assert.deepEqual(estimateMinutes({ requestBytes: [1_300_000], lanes: 3 }), [9, 25]);
  // Windows run in lanes: three in three lanes take one window's time, in one lane three times it.
  assert.deepEqual(estimateMinutes({ requestBytes: [400_000, 400_000, 400_000], lanes: 3 }), [4, 12]);
  assert.deepEqual(estimateMinutes({ requestBytes: [400_000, 400_000, 400_000], lanes: 1 }), [13, 36]);
  // Each window starts in the next lane to come free: small ones beside a large one do not add to it.
  assert.deepEqual(estimateMinutes({ requestBytes: [1_300_000, 30_000, 30_000, 30_000], lanes: 2 }), [9, 25]);
  // No lanes given is one lane; a size that is not a byte count is the typical request (`unknownRequestBytes`).
  assert.deepEqual(estimateMinutes({ requestBytes: [400_000, 400_000] }), [8, 24]);
  assert.deepEqual(estimateMinutes({ requestBytes: [null], lanes: 3 }),
    estimateMinutes({ requestBytes: [48_000], lanes: 3 }));
  // Never under a minute, and always a range.
  assert.deepEqual(estimateMinutes({ requestBytes: [0], lanes: 3 }), [1, 2]);
  assert.equal(estimateMinutes({ requestBytes: [], lanes: 3 }), null);
});
