// M33 J. Count-only instrumentation for every profile, and the harness flag that selects the opt-in
// "m33-fast" profile. The claude-cli transport keeps, from its stream, the result's token counts, its
// `duration_ms` and `duration_api_ms`, and the last `rate_limit_event`'s closed and numeric fields —
// never any text. The harness writes them per attempt to attempts.json and sums the token counts in
// summary.json. None of it changes a request byte.
//
// Every stream and session here is invented; every child process is a fake. No model, no network.
import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import * as reviewJudge from '../src/review-judge.js';
import { manyWindowSession } from './m33-fast-profile-fixture.js';

const HARNESS = pathToFileURL(fileURLToPath(new URL('../../../scripts/session-review.mjs', import.meta.url))).href;
const harness = await import(HARNESS).catch(() => ({}));
const LEAK = 'M33_J_LEAK_SENTINEL sk-ant-FAKE-0000000000';
const MODEL = 'claude-synthetic-1';
const EMPTY = { decisions: [], pivots: [], claims: [], requirements: [] };
const TOKENS = ['input_tokens', 'output_tokens', 'cache_creation_input_tokens', 'cache_read_input_tokens'];

async function directory(t, name) {
  const dir = await mkdtemp(join(tmpdir(), `sonah-j-fast-${name}-`));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return dir;
}

const init = { type: 'system', subtype: 'init', model: MODEL, cwd: `/synthetic/${LEAK}`, session_id: 'synthetic' };
const assistant = (text) => ({ type: 'assistant', parent_tool_use_id: null,
  message: { model: MODEL, role: 'assistant', content: [{ type: 'text', text }] } });
const rateLimit = (info) => ({ type: 'rate_limit_event', rate_limit_info: info, uuid: LEAK, session_id: LEAK });
const result = (text, extra = {}) => ({ type: 'result', subtype: 'success', is_error: false, api_error_status: null,
  result: text, duration_ms: 1234, duration_api_ms: 987, num_turns: 1, total_cost_usd: 0.01,
  usage: { input_tokens: 11, output_tokens: 7, cache_creation_input_tokens: 5, cache_read_input_tokens: 3,
    service_tier: LEAK, server_tool_use: { web_search_requests: 0 } }, ...extra });

/** A fake `claude` child that answers each request with `answer(prompt)`, printing `events(text)`. */
function fakeClaude(events, answer = () => EMPTY) {
  const capture = { calls: 0 };
  const spawnProcess = () => {
    capture.calls++;
    const child = new EventEmitter();
    child.stdin = new PassThrough(); child.stdout = new PassThrough(); child.stderr = new PassThrough();
    let closed = false, prompt = '';
    const close = (code) => { if (!closed) { closed = true; child.emit('close', code, null); } };
    child.kill = () => { setImmediate(() => close(null)); return true; };
    child.stdin.setEncoding('utf8');
    child.stdin.on('data', (chunk) => { prompt += chunk; });
    child.stdin.on('end', () => setImmediate(() => {
      child.stderr.write(LEAK);
      const text = JSON.stringify(answer(prompt));
      child.stdout.write(events(text).map((event) => `${JSON.stringify(event)}\n`).join(''));
      setImmediate(() => close(0));
    }));
    return child;
  };
  return { spawnProcess, capture };
}

async function oneCall(events) {
  const fake = fakeClaude(events);
  const recorded = [];
  const judge = reviewJudge.createReviewJudge({ config: { backend: 'claude-cli', model: MODEL }, env: { PATH: '/bin' },
    spawnProcess: fake.spawnProcess, onResult: (metadata) => recorded.push(metadata) });
  const answer = await judge({ system: 'SYNTHETIC_SYSTEM', prompt: 'SYNTHETIC_PROMPT' });
  return { answer, recorded };
}

// ---- the transport ---------------------------------------------------------------------------------------------
test('M33 J the claude stream\'s durations and last rate-limit event are kept as closed and numeric fields only', async () => {
  const { answer, recorded } = await oneCall((text) => [init,
    rateLimit({ status: 'allowed_warning', rateLimitType: 'seven_day', utilization: 0.2, resetsAt: 1700000000,
      overageDisabledReason: LEAK }),
    assistant(text),
    rateLimit({ status: 'allowed', rateLimitType: 'five_hour', utilization: 0.91, resetsAt: 1800000000, isUsingOverage: false,
      surpassedThreshold: 0.9, overageStatus: LEAK }),
    result(text)]);
  assert.deepEqual(answer, EMPTY);
  assert.equal(recorded.length, 1);
  const [m] = recorded;
  assert.equal(m.durationMs, 1234);
  assert.equal(m.durationApiMs, 987);
  assert.deepEqual(m.rateLimit, { status: 'allowed', rateLimitType: 'five_hour', utilization: 0.91, resetsAt: 1800000000,
    windows: null }, 'the last event, five fields (M44: no unifiedWindows, no windows)');
  assert.equal(m.usage.input_tokens, 11, 'result.usage is still in the metadata');
  assert.ok(!JSON.stringify(m.rateLimit).includes('M33_J_LEAK'));
  assert.deepEqual(reviewJudge.RATE_LIMIT_STATUSES, ['allowed', 'allowed_warning', 'rejected', 'unknown']);
  assert.deepEqual(reviewJudge.RATE_LIMIT_TYPES, ['five_hour', 'seven_day', 'seven_day_opus', 'seven_day_sonnet',
    'seven_day_overage_included', 'overage', 'unknown']);
  for (const list of [reviewJudge.RATE_LIMIT_STATUSES, reviewJudge.RATE_LIMIT_TYPES]) assert.ok(Object.isFrozen(list));
});

test('M33 J a rate-limit value outside the closed lists is `unknown`; absent fields are null; no event is null', async () => {
  const odd = await oneCall((text) => [init, assistant(text),
    rateLimit({ status: `${LEAK}`, rateLimitType: 'SYNTHETIC_WINDOW', utilization: 'high', resetsAt: 1.5 }), result(text)]);
  assert.deepEqual(odd.recorded[0].rateLimit, { status: 'unknown', rateLimitType: 'unknown', utilization: null, resetsAt: null,
    windows: null });
  const bare = await oneCall((text) => [init, assistant(text), rateLimit(null), result(text)]);
  assert.deepEqual(bare.recorded[0].rateLimit, { status: null, rateLimitType: null, utilization: null, resetsAt: null, windows: null });
  const none = await oneCall((text) => [init, assistant(text), result(text, { duration_ms: -1, duration_api_ms: 'x' })]);
  assert.equal(none.recorded[0].rateLimit, null);
  assert.equal(none.recorded[0].durationMs, null);
  assert.equal(none.recorded[0].durationApiMs, null);
});

test('M33 J instrumentation changes no request byte: the argv and the prompt are the transport\'s own', async () => {
  const seen = [];
  const fake = fakeClaude((text) => [init, assistant(text), rateLimit({ status: 'allowed' }), result(text)]);
  const spawnProcess = (command, args, options) => { seen.push({ command, args }); return fake.spawnProcess(command, args, options); };
  const judge = reviewJudge.createReviewJudge({ config: { backend: 'claude-cli', model: MODEL }, env: { PATH: '/bin' }, spawnProcess });
  await judge({ system: 'SYNTHETIC_SYSTEM', prompt: 'SYNTHETIC_PROMPT' });
  assert.deepEqual(seen, [{ command: 'claude', args: reviewJudge.reviewCliArgs({ system: 'SYNTHETIC_SYSTEM', model: MODEL }) }]);
});

// ---- the harness flag ---------------------------------------------------------------------------------------------
const GOOD = ['--parent', 'p.jsonl', '--codex-home', 'h', '--out', 'o', '--backend', 'codex-cli', '--model', 'm',
  '--max-calls', '5', '--max-seconds', '60'];

test('M33 J --speed-profile selects standard (the default, 1..3 lanes) or m33-fast (1..12 lanes, default 12)', () => {
  assert.equal(typeof harness.parseHarnessArgs, 'function');
  const parse = (...extra) => harness.parseHarnessArgs([...GOOD, ...extra]);
  assert.deepEqual([parse().speedProfile, parse().concurrency], ['standard', 3]);
  assert.deepEqual([parse('--speed-profile', 'standard').speedProfile, parse('--speed-profile', 'standard').concurrency],
    ['standard', 3]);
  assert.deepEqual([parse('--speed-profile', 'm33-fast').speedProfile, parse('--speed-profile', 'm33-fast').concurrency],
    ['m33-fast', 12]);
  for (const n of ['1', '7', '12']) assert.equal(parse('--speed-profile', 'm33-fast', '--concurrency', n).concurrency, Number(n));
  for (const n of ['1', '3']) assert.equal(parse('--concurrency', n).concurrency, Number(n));
  for (const bad of [['--speed-profile', 'm33-fast', '--concurrency', '13'], ['--concurrency', '4'],
    ['--speed-profile', 'standard', '--concurrency', '4'], ['--speed-profile', 'fast'], ['--speed-profile', 'M33-FAST'],
    ['--speed-profile', ''], ['--speed-profile'], ['--speed-profile', 'm33-fast', '--speed-profile', 'm33-fast'],
    ['--speed-profile', 'm33-fast', '--concurrency', '0']])
    assert.throws(() => parse(...bad), (error) => error.code === 'usage', JSON.stringify(bad));
});

const options = (base, extra = {}) => ({ parent: join(base, 'SYNTHETIC.jsonl'), codexHome: base, out: join(base, 'out'),
  backend: 'claude-cli', model: MODEL, maxCalls: 1000, maxSeconds: 600, timeoutMs: 5000, sessionKey: 'session',
  concurrency: 1, ...extra });
const quiet = { write: () => {}, progress: () => {}, installSignals: false };

test('M33 J a programmatic run outside the profile\'s bounds is usage and touches nothing', async (t) => {
  const base = await directory(t, 'usage');
  let built = 0;
  for (const extra of [{ speedProfile: 'm33-fast', concurrency: 13 }, { speedProfile: 'standard', concurrency: 4 },
    { concurrency: 4 }, { speedProfile: 'SYNTHETIC_PROFILE' }]) {
    const run = await harness.runSessionReviewHarness(options(base, extra), { ...quiet,
      loadSession: async () => manyWindowSession(2), createJudge: () => { built++; return async () => EMPTY; } });
    assert.deepEqual([run.exitCode, run.summary.failure], [2, 'usage'], JSON.stringify(extra));
  }
  assert.equal(built, 0);
  await assert.rejects(stat(join(base, 'out')), { code: 'ENOENT' });
});

test('M33 J attempts.json keeps each attempt\'s token counts, durations and rate limit; summary.json sums the tokens', async (t) => {
  const base = await directory(t, 'attempts');
  const fake = fakeClaude((text) => [init, assistant(text),
    rateLimit({ status: 'allowed', rateLimitType: 'five_hour', utilization: 0.5, resetsAt: 1800000000 }), result(text)]);
  let stdout = '';
  const run = await harness.runSessionReviewHarness(options(base, { speedProfile: 'm33-fast', concurrency: 12 }),
    { ...quiet, write: (text) => { stdout += text; }, loadSession: async () => manyWindowSession(3),
      createJudge: (args) => reviewJudge.createReviewJudge({ ...args, env: { PATH: '/bin' }, spawnProcess: fake.spawnProcess }) });
  assert.equal(run.exitCode, 0, JSON.stringify(run.summary));
  assert.equal(fake.capture.calls, 3, 'three empty windows, three narrative calls');
  assert.equal(run.summary.schema, 'sonah.session-review-harness/17');
  assert.equal(harness.HARNESS_SUMMARY_SCHEMA, 'sonah.session-review-harness/17');
  assert.equal(run.summary.speedProfile, 'm33-fast');
  assert.deepEqual(run.summary.tokens, { input_tokens: 33, output_tokens: 21, cache_creation_input_tokens: 15,
    cache_read_input_tokens: 9 });
  const attempts = JSON.parse(await readFile(join(base, 'out', 'attempts.json'), 'utf8'));
  assert.equal(attempts.length, 3);
  for (const attempt of attempts) {
    assert.deepEqual(Object.keys(attempt).sort(), ['attestation', 'cliVersion', 'code', 'contextWindow', 'durationApiMs',
      'durationMs', 'elapsedMs', 'inputBytes', 'ok', 'providerClass', 'rateLimit', 'replyShape', 'usage']);
    // M44: each accepted reply's closed shape (m44-reply-shape.test.js).
    assert.equal(attempt.replyShape.code, 'object');
    assert.deepEqual(attempt.usage, { input_tokens: 11, output_tokens: 7, cache_creation_input_tokens: 5, cache_read_input_tokens: 3 });
    assert.deepEqual([attempt.durationMs, attempt.durationApiMs], [1234, 987]);
    assert.deepEqual(attempt.rateLimit, { status: 'allowed', rateLimitType: 'five_hour', utilization: 0.5, resetsAt: 1800000000,
      windows: null });
  }
  const files = [await readFile(join(base, 'out', 'attempts.json'), 'utf8'), await readFile(join(base, 'out', 'summary.json'), 'utf8'), stdout];
  for (const text of files) assert.ok(!text.includes('M33_J_LEAK') && !text.includes('sk-ant'), 'no stream text is kept');
  assert.deepEqual(JSON.parse(files[1]), run.summary);
});

test('M33 J an attempt with no usage records null counts, and the standard run states its profile too', async (t) => {
  const base = await directory(t, 'no-usage');
  const createJudge = ({ onResult }) => async (request) => {
    await onResult({ ok: true, attestation: 'attested', providerClass: null, elapsedMs: 1, inputBytes: 1,
      usage: { input_tokens: 'SYNTHETIC', output_tokens: -1 } });
    return request.challenge ? { votes: [] } : EMPTY;
  };
  const run = await harness.runSessionReviewHarness(options(base), { ...quiet, createJudge,
    loadSession: async () => manyWindowSession(2) });
  assert.equal(run.exitCode, 0);
  assert.equal(run.summary.speedProfile, 'standard');
  assert.deepEqual(run.summary.tokens, Object.fromEntries(TOKENS.map((k) => [k, 0])));
  const attempts = JSON.parse(await readFile(join(base, 'out', 'attempts.json'), 'utf8'));
  for (const attempt of attempts) {
    assert.deepEqual(attempt.usage, Object.fromEntries(TOKENS.map((k) => [k, null])));
    assert.deepEqual([attempt.durationMs, attempt.durationApiMs, attempt.rateLimit], [null, null, null]);
  }
});
