// M33 K. Harness guards, count-only: progress.json carries the latest rate-limit fields an attempt reported
// (numbers and closed codes only); `--stop-at-utilization U` stops admitting new windows, exactly as the
// deadline does, once an attempt reports a utilization of at least U, and the summary names that guard; and
// the review's AbortSignal is sized for its lanes, so twelve lanes print no MaxListenersExceededWarning.
//
// Synthetic sessions and fake judges only: no model, no network. Each test gets its own directory.
import test from 'node:test';
import assert from 'node:assert/strict';
import { getMaxListeners } from 'node:events';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { readSessionReviewProgress } from '../src/session-review.js';
import { manyWindowSession } from './m33-fast-profile-fixture.js';

const HARNESS = pathToFileURL(fileURLToPath(new URL('../../../scripts/session-review.mjs', import.meta.url))).href;
const harness = await import(HARNESS);
const MODEL = 'claude-synthetic-1';
const EMPTY = { decisions: [], pivots: [], claims: [], requirements: [] };
const GOOD = ['--parent', 'p.jsonl', '--codex-home', 'h', '--out', 'o', '--backend', 'codex-cli', '--model', 'm',
  '--max-calls', '10', '--max-seconds', '60'];

async function directory(t, name) {
  const dir = await mkdtemp(join(tmpdir(), `sonah-k-guards-${name}-`));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return dir;
}
const options = (base, extra = {}) => ({ parent: join(base, 'SYNTHETIC.jsonl'), codexHome: base, out: join(base, 'out'),
  backend: 'claude-cli', model: MODEL, maxCalls: 1000, maxSeconds: 600, timeoutMs: 5000, sessionKey: 'session',
  concurrency: 1, ...extra });
const quiet = { write: () => {}, progress: () => {}, installSignals: false };
/** A transport whose n-th attempt reports `rateLimitOf(n)`, attested; every answer is empty. */
const reporting = (rateLimitOf, calls = { n: 0 }) => ({ onResult }) => async (request) => {
  calls.n++;
  await onResult({ ok: true, attestation: 'attested', providerClass: null, elapsedMs: 1, inputBytes: 1,
    rateLimit: rateLimitOf(calls.n) });
  return request.challenge ? { votes: [] } : EMPTY;
};

test('M33 K --stop-at-utilization parses a fraction in (0, 1]; absent is today\'s behaviour', () => {
  const parse = (...extra) => harness.parseHarnessArgs([...GOOD, ...extra]);
  assert.equal(parse().stopAtUtilization, undefined);
  for (const [text, value] of [['0.9', 0.9], ['1', 1], ['0.05', 0.05], ['1.0', 1]])
    assert.equal(parse('--stop-at-utilization', text).stopAtUtilization, value, text);
  for (const bad of ['0', '0.0', '1.01', '2', '-0.5', 'abc', '.5', '0.5x', '1e-1', ''])
    assert.throws(() => parse('--stop-at-utilization', bad), (error) => error.code === 'usage', bad);
  assert.throws(() => parse('--stop-at-utilization', '0.5', '--stop-at-utilization', '0.5'), (error) => error.code === 'usage');
  assert.ok(harness.BREAKER_REASONS.includes('utilization'));
  // m33-lean takes up to twelve lanes, twelve by default.
  assert.deepEqual([parse('--speed-profile', 'm33-lean').speedProfile, parse('--speed-profile', 'm33-lean').concurrency],
    ['m33-lean', 12]);
  assert.throws(() => parse('--speed-profile', 'm33-lean', '--concurrency', '13'), (error) => error.code === 'usage');
});

test('M33 K progress.json carries the latest rate-limit fields seen, closed codes and numbers only', async (t) => {
  const base = await directory(t, 'progress');
  const reports = [
    { status: 'allowed', rateLimitType: 'five_hour', utilization: 0.2, resetsAt: 1800000000 },
    null,
    { status: 'SYNTHETIC_STATUS', rateLimitType: 'seven_day', utilization: 0.4, resetsAt: 1900000000 },
  ];
  const run = await harness.runSessionReviewHarness(options(base), { ...quiet,
    loadSession: async () => manyWindowSession(3), createJudge: reporting((n) => reports[n - 1] ?? null) });
  assert.equal(run.exitCode, 0, JSON.stringify(run.summary));
  const progress = JSON.parse(await readFile(join(base, 'out', 'review', 'progress.json'), 'utf8'));
  // The latest REPORTED one: an attempt that reported none does not erase it; a status outside the list is `unknown`.
  assert.deepEqual(progress.rateLimit, { status: 'unknown', rateLimitType: 'seven_day', utilization: 0.4, resetsAt: 1900000000,
    windows: null });
  assert.deepEqual(run.summary.rateLimit, progress.rateLimit);
  // The file stays a valid progress: a continuation reads it.
  const read = await readSessionReviewProgress(join(base, 'out', 'review'));
  assert.equal(read?.attempt, 1);
  assert.deepEqual(read.rateLimit, progress.rateLimit);
  // A run that saw none records null.
  const none = await directory(t, 'progress-none');
  await harness.runSessionReviewHarness(options(none), { ...quiet, loadSession: async () => manyWindowSession(1),
    createJudge: reporting(() => null) });
  assert.equal(JSON.parse(await readFile(join(none, 'out', 'review', 'progress.json'), 'utf8')).rateLimit, null);
});

test('M33 K --stop-at-utilization stops admitting windows like a deadline; the run is resumable', async (t) => {
  const base = await directory(t, 'stop');
  const calls = { n: 0 };
  const stopped = await harness.runSessionReviewHarness(options(base, { stopAtUtilization: 0.9 }), { ...quiet,
    loadSession: async () => manyWindowSession(4),
    createJudge: reporting((n) => ({ status: 'allowed_warning', rateLimitType: 'five_hour', utilization: n >= 2 ? 0.93 : 0.5,
      resetsAt: 1800000000 }), calls) });
  assert.equal(stopped.exitCode, 3, JSON.stringify(stopped.summary));
  assert.deepEqual([stopped.summary.failure, stopped.summary.state, stopped.summary.breaker],
    ['review_interrupted', 'interrupted', 'utilization']);
  assert.equal(calls.n, 2, 'the attempt that crossed the bound finished; no window was admitted after it');
  // The window whose call crossed it resolved after the stop: its answer is stored, it is not announced.
  assert.equal(stopped.summary.windows.finished, 1);
  // Continued without the guard: the two stored answers are replayed, only the rest is asked.
  const resumed = await harness.runSessionReviewHarness(options(base), { ...quiet,
    loadSession: async () => manyWindowSession(4), createJudge: reporting(() => null, calls) });
  assert.equal(resumed.exitCode, 0, JSON.stringify(resumed.summary));
  assert.equal(calls.n, 4);
  assert.deepEqual([resumed.summary.attempt, resumed.summary.calls.reused, resumed.summary.breaker], [2, 2, null]);
  // Below the bound, nothing stops.
  const below = await directory(t, 'below');
  const run = await harness.runSessionReviewHarness(options(below, { stopAtUtilization: 0.95 }), { ...quiet,
    loadSession: async () => manyWindowSession(3), createJudge: reporting(() => ({ status: 'allowed', rateLimitType: 'five_hour',
      utilization: 0.94, resetsAt: 1 })) });
  assert.deepEqual([run.exitCode, run.summary.breaker], [0, null]);
  // A programmatic run with a bound outside (0, 1] is usage and touches nothing.
  for (const bad of [0, 1.5, -1, Number.NaN, '0.5']) {
    const refused = await harness.runSessionReviewHarness(options(below, { stopAtUtilization: bad, out: join(below, 'never') }),
      { ...quiet, loadSession: async () => manyWindowSession(1), createJudge: reporting(() => null) });
    assert.equal(refused.exitCode, 2, String(bad));
  }
});

test('M33 K twelve lanes print no MaxListenersExceededWarning: the review signal is sized for its calls', async (t) => {
  const base = await directory(t, 'listeners');
  const warnings = [];
  const onWarning = (warning) => warnings.push(warning.name);
  process.on('warning', onWarning);
  t.after(() => process.off('warning', onWarning));
  let bound = null;
  const createJudge = ({ signal, onResult }) => {
    bound = getMaxListeners(signal);
    return async (request) => {
      // One abort listener per call in flight, as the CLI transport adds.
      const listener = () => {};
      signal.addEventListener('abort', listener, { once: true });
      await new Promise((resolve) => setTimeout(resolve, 20));
      signal.removeEventListener('abort', listener);
      await onResult({ ok: true, attestation: 'attested', providerClass: null, elapsedMs: 1, inputBytes: 1 });
      return request.challenge ? { votes: [] } : EMPTY;
    };
  };
  const run = await harness.runSessionReviewHarness(options(base, { speedProfile: 'm33-lean', concurrency: 12 }),
    { ...quiet, loadSession: async () => manyWindowSession(14), createJudge });
  assert.equal(run.exitCode, 0, JSON.stringify(run.summary));
  assert.ok(bound >= 12 * 6, `the signal admits every call the review can have in flight (${bound})`);
  await new Promise((resolve) => setImmediate(resolve));
  assert.ok(!warnings.includes('MaxListenersExceededWarning'));
});

test('M33 K --stop-at-utilization lets every call in flight finish and stores its answer (twelve lanes)', async (t) => {
  const base = await directory(t, 'in-flight');
  const LANES = 12;
  const state = { started: 0, finished: 0, cancelled: 0 };
  let release;
  const allStarted = new Promise((resolve) => { release = resolve; });
  // Honours the review signal as the CLI transport does (review-judge.js `cancellationOf`): once it
  // aborts, the call in flight is stopped and nothing it would have answered is returned.
  const createJudge = ({ signal, onResult }) => async (request) => {
    const n = ++state.started;
    if (n === LANES) release();
    await Promise.race([allStarted, new Promise((resolve) => setTimeout(resolve, 2000))]);
    await new Promise((resolve, reject) => {
      let timer = null;
      const cancel = () => { clearTimeout(timer); state.cancelled++;
        reject(Object.assign(new Error('synthetic cancel'), { code: 'review_cancelled' })); };
      if (signal.aborted) { cancel(); return; }
      signal.addEventListener('abort', cancel, { once: true });
      timer = setTimeout(() => { signal.removeEventListener('abort', cancel); resolve(); }, n === 1 ? 0 : 40);
    });
    state.finished++;
    await onResult({ ok: true, attestation: 'attested', providerClass: null, elapsedMs: 1, inputBytes: 1,
      rateLimit: { status: 'allowed_warning', rateLimitType: 'five_hour', utilization: n === 1 ? 0.95 : 0.5, resetsAt: 1 } });
    return request.challenge ? { votes: [] } : EMPTY;
  };
  const stopped = await harness.runSessionReviewHarness(options(base, { speedProfile: 'm33-lean', concurrency: LANES,
    stopAtUtilization: 0.9 }), { ...quiet, loadSession: async () => manyWindowSession(14), createJudge });
  assert.equal(stopped.exitCode, 3, JSON.stringify(stopped.summary));
  assert.deepEqual([stopped.summary.failure, stopped.summary.state, stopped.summary.breaker],
    ['review_interrupted', 'interrupted', 'utilization']);
  assert.equal(state.started, LANES, 'every lane had a call in flight when the bound was crossed');
  assert.deepEqual([state.finished, state.cancelled], [LANES, 0], 'no call in flight was cancelled');
  // Every one of those answers was stored: continued without the guard, all twelve are replayed.
  const calls = { n: 0 };
  const resumed = await harness.runSessionReviewHarness(options(base, { speedProfile: 'm33-lean', concurrency: LANES }),
    { ...quiet, loadSession: async () => manyWindowSession(14), createJudge: reporting(() => null, calls) });
  assert.equal(resumed.exitCode, 0, JSON.stringify(resumed.summary));
  assert.deepEqual([resumed.summary.calls.reused, calls.n], [LANES, 14 - LANES]);
});
