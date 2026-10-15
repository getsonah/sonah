import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter, getEventListeners } from 'node:events';
import { PassThrough } from 'node:stream';
import { stat } from 'node:fs/promises';
import { reviewJudgeConfig, createReviewJudge, withTransportRetry, RETRYABLE_JUDGE_CODES,
  reviewTransportArguments, reviewApiBody, REVIEW_TRANSPORT_VERSION, KILL_GRACE_MS, REVIEW_CANCELLED } from '../src/review-judge.js';
import { MAX_REVIEW_INPUT_BYTES } from '../../evidence/src/challenge.js';
import { boundedJudge } from '../src/session-review.js';

const request = { system: 'Custom review system.', prompt: 'Private synthetic éclair prompt.' };
function fakeSpawn(inspect, { code = 0, tool = false, isError = false } = {}) {
  return (command, args, options) => {
    const child = new EventEmitter();
    child.stdin = new PassThrough(); child.stdout = new PassThrough(); child.stderr = new PassThrough();
    child.kill = () => child.emit('close', 1);
    let stdin = ''; child.stdin.on('data', (d) => { stdin += d; });
    child.stdin.on('finish', () => setImmediate(async () => {
      try { await inspect({ command, args, options, stdin }); }
      catch (error) { child.emit('error', error); return; }
      // M33 refreeze: one init and a top-level assistant naming its model, so the default alias answers.
      const events = [ { type: 'system', subtype: 'init', model: 'claude-test-1' },
        { type: 'assistant', parent_tool_use_id: null, message: { model: 'claude-test-1', content: tool ? [{ type: 'tool_use' }] : [] } },
        { type: 'result', subtype: 'success', is_error: isError, result: '{"value":"éclair"}', usage: { output_tokens: 12 }, total_cost_usd: 0.01 } ];
      const bytes = Buffer.from(events.map((e) => JSON.stringify(e)).join('\n'));
      // Split within multibyte code points to test streaming decoding.
      for (const byte of bytes) child.stdout.write(Buffer.from([byte]));
      child.emit('close', code);
    }));
    return child;
  };
}

test('billing backend is explicit, unsupported selection and API aliases fail closed', () => {
  assert.equal(reviewJudgeConfig({ ANTHROPIC_API_KEY: 'synthetic' }).backend, 'claude-cli');
  assert.equal(reviewJudgeConfig({ SONAH_REVIEW_BACKEND: 'anthropic-api', SONAH_MODEL: 'claude-test-1' }).backend, 'anthropic-api');
  for (const options of [{ backend: 'codex' }, { backend: 'anthropic-api' }, { backend: 'anthropic-api', model: 'sonnet' }, { model: '--unsafe' }])
    assert.throws(() => reviewJudgeConfig({}, options));
});

test('local subscription preserves system, sends private prompt only on stdin, isolates settings and removes API auth', async () => {
  let directory, inspected = false, measurements = [];
  const judge = createReviewJudge({ env: { HOME: '/synthetic', PATH: '/bin', ANTHROPIC_API_KEY: 'synthetic', ANTHROPIC_BASE_URL: 'https://example.invalid', SONAH_HOME: '/private',
    ANTHROPIC_AUTH_TOKEN: 'synthetic', CLAUDE_CODE_USE_BEDROCK: '1', CLAUDE_CODE_SIMPLE: '1',
    CLAUDE_CODE_ENABLE_PROMPT_SUGGESTION: '1', CLAUDE_CODE_DISABLE_TERMINAL_TITLE: '0',
    CLAUDE_CODE_DISABLE_REFUSAL_FALLBACK: '0', CLAUDE_CODE_DISABLE_AUTO_MEMORY: '0', CLAUDE_CODE_MAX_RETRIES: '99' },
    onResult: (m) => measurements.push(m), spawnProcess: fakeSpawn(async ({ command, args, options, stdin }) => {
      inspected = true; directory = options.cwd;
      assert.equal(command, 'claude'); assert.equal(stdin, request.prompt); assert.ok(!args.includes(request.prompt));
      for (const [flag, value] of [['--tools', ''], ['--setting-sources', ''], ['--system-prompt', request.system]])
        assert.equal(args[args.indexOf(flag) + 1], value);
      assert.ok(args.includes('--strict-mcp-config')); assert.ok(args.includes('--no-session-persistence'));
      assert.equal(options.env.ANTHROPIC_API_KEY, undefined); assert.equal(options.env.ANTHROPIC_BASE_URL, undefined);
      // M33 (l): refusal fallback and automatic memory are off; the 2.1.278 binary reads both names.
      assert.deepEqual(options.env, { HOME: '/synthetic', PATH: '/bin', CLAUDE_CODE_DISABLE_TERMINAL_TITLE: '1',
        CLAUDE_CODE_DISABLE_REFUSAL_FALLBACK: '1', CLAUDE_CODE_DISABLE_AUTO_MEMORY: '1' });
      assert.equal(args[args.indexOf('--model') + 1], 'sonnet');
      assert.ok(!args.includes('--bare'), 'bare mode would disable subscription OAuth authentication');
      assert.equal((await stat(directory)).mode & 0o777, 0o700);
    }) });
  assert.deepEqual(await judge(request), { value: 'éclair' }); assert.ok(inspected);
  await assert.rejects(stat(directory), { code: 'ENOENT' });
  assert.equal(measurements[0].usage.output_tokens, 12); assert.deepEqual(measurements[0].reportedModels, ['claude-test-1']);
  assert.equal(measurements[0].attestation, 'unattested', 'M33: the default alias answers, and is never attested');
  assert.ok(!JSON.stringify(measurements).includes('éclair'));
});

test('CLI nonzero exit, tool use, and error result never become successful JSON', async () => {
  for (const fault of [{ code: 1 }, { tool: true }, { isError: true }])
    await assert.rejects(createReviewJudge({ spawnProcess: fakeSpawn(() => {}, fault) })(request));
});

test('API receives custom system, no tools, exact model, usage without exposing credentials or response', async () => {
  const measurements = [];
  // M33: the key is a distinctive sentinel, because the recorded result now has a `syntheticMessages` count.
  const judge = createReviewJudge({ env: { ANTHROPIC_API_KEY: 'API_KEY_SENTINEL_M33' }, config: { backend: 'anthropic-api', model: 'claude-test-1' },
    onResult: (m) => measurements.push(m), fetchImpl: async (url, options) => {
      assert.equal(url, 'https://api.anthropic.com/v1/messages');
      const body = JSON.parse(options.body);
      assert.equal(body.system, request.system); assert.equal(body.messages[0].content, request.prompt);
      assert.equal(body.model, 'claude-test-1'); assert.equal(body.tools, undefined);
      assert.equal(options.headers['x-api-key'], 'API_KEY_SENTINEL_M33');
      return new Response(JSON.stringify({ model: 'claude-test-1', stop_reason: 'end_turn', usage: { input_tokens: 30 }, content: [{ type: 'text', text: '{"value":"éclair"}' }] }));
    } });
  assert.deepEqual(await judge(request), { value: 'éclair' });
  assert.equal(measurements[0].usage.input_tokens, 30); assert.equal(measurements[0].costUsd, null);
  assert.ok(!JSON.stringify(measurements).includes('API_KEY_SENTINEL_M33'));
  assert.ok(!JSON.stringify(measurements).includes('éclair'));
});

// W3f-2 / F227. The answer key binds `reviewTransportArguments`; it must be what the transports send.
test('F227 the transport arguments the answer key binds are exactly the ones each transport sends', async () => {
  let argv = null;
  await createReviewJudge({ env: { HOME: '/synthetic', PATH: '/bin' }, config: { backend: 'claude-cli', model: 'sonnet' },
    spawnProcess: fakeSpawn(async ({ args }) => { argv = args; }) })(request);
  assert.deepEqual(argv, reviewTransportArguments({ backend: 'claude-cli', model: 'sonnet', system: request.system }).argv);
  let sent = null;
  await createReviewJudge({ env: { ANTHROPIC_API_KEY: 'synthetic' }, config: { backend: 'anthropic-api', model: 'claude-test-1' },
    fetchImpl: async (url, options) => { sent = { url, options };
      return new Response(JSON.stringify({ stop_reason: 'end_turn', content: [{ type: 'text', text: '{"value":"x"}' }] })); } })(request);
  const args = reviewTransportArguments({ backend: 'anthropic-api', model: 'claude-test-1', system: request.system });
  const { messages, ...body } = JSON.parse(sent.options.body);
  assert.deepEqual({ url: sent.url, version: sent.options.headers['anthropic-version'], body }, args);
  assert.deepEqual(messages, [{ role: 'user', content: request.prompt }]);
  assert.equal(sent.options.body, JSON.stringify(reviewApiBody({ ...request, model: 'claude-test-1' })));
  assert.ok(!JSON.stringify(args).includes('synthetic'), 'the credential is never an argument the key binds');
  assert.equal(reviewTransportArguments({ backend: 'codex', model: 'sonnet', system: 's' }), null);
});

test('missing API key, truncated reply, network failure, NUL and output ceiling fail closed', async () => {
  const config = { backend: 'anthropic-api', model: 'claude-test-1' };
  await assert.rejects(createReviewJudge({ config, env: {}, fetchImpl: () => { throw new Error('must not call'); } })(request), /anthropic_key_missing/);
  const base = { config, env: { ANTHROPIC_API_KEY: 'synthetic' } };
  await assert.rejects(createReviewJudge({ ...base, fetchImpl: async () => new Response(JSON.stringify({ stop_reason: 'max_tokens', content: [{ type: 'text', text: '{}' }] })) })(request), /incomplete/);
  await assert.rejects(createReviewJudge({ ...base, fetchImpl: async () => { throw new Error(request.prompt); } })(request), /model_unavailable/);
  await assert.rejects(createReviewJudge({ ...base, maxOutputBytes: 1, fetchImpl: async () => new Response('{}') })(request), /model_output_limit/);
  await assert.rejects(createReviewJudge({ ...base })({ ...request, prompt: '\0' }), /invalid_model_input/);
});

// --------------------------------------------------------- W3-6: one retry, transport failures only
//
// A window whose single model call lost the network is UNCHECKED, and an unchecked window is a
// whole decision nobody read. One identical second request is cheap and recovers the common case.
// A second failure stands: a transport that fails twice is not a blip. Nothing that would answer
// the same way twice is retried — that only spends the reviewer's time and the account's tokens
// on the same refusal.

const narrative = () => ({ decisions: [], pivots: [], claims: [], requirements: [] });
const throwing = (code) => Object.assign(new Error(code), { code });

test('a transport failure is retried once with the identical request (W3-6)', async () => {
  const seen = [];
  const judge = withTransportRetry(async (r) => {
    seen.push(r);
    if (seen.length === 1) throw throwing('model_unavailable');
    return narrative();
  });
  const result = await judge(request);
  assert.equal(seen.length, 2);
  assert.deepEqual(seen[0], seen[1], 'the retry must be the same request, not a smaller one');
  assert.equal(result.attempts, 2);
  // run-review.js pins the narrative to a CLOSED shape. A visible `attempts` key would fail the
  // very window the retry just rescued.
  assert.deepEqual(Object.keys(result), ['decisions', 'pivots', 'claims', 'requirements']);
  assert.ok(!JSON.stringify(result).includes('attempts'));
});

test('an answer on the first call is not retried and records one attempt (W3-6)', async () => {
  let calls = 0;
  const result = await withTransportRetry(async () => { calls++; return narrative(); })(request);
  assert.equal(calls, 1);
  assert.equal(result.attempts, 1);
});

test('a transport that fails twice propagates the SECOND failure (W3-6)', async () => {
  let calls = 0;
  const judge = withTransportRetry(async () => {
    calls++;
    throw Object.assign(throwing('model_unavailable'), { which: calls });
  });
  await assert.rejects(judge(request), (error) => {
    assert.equal(error.code, 'model_unavailable');
    assert.equal(error.which, 2, 'the error a reader sees is the one that ended the attempt');
    return true;
  });
  assert.equal(calls, 2);
});

test('every transport code retries, and nothing else does (W3-6)', async () => {
  for (const code of RETRYABLE_JUDGE_CODES) {
    let calls = 0;
    const judge = withTransportRetry(async () => {
      calls++;
      if (calls === 1) throw throwing(code);
      return narrative();
    });
    assert.equal((await judge(request)).attempts, 2, code);
  }
  // Deterministic refusals: asking twice cannot change any of these answers.
  for (const code of ['budget_exhausted', 'model_tool_use', 'anthropic_key_missing', 'invalid_model',
    'unsupported_backend', 'explicit_api_model_required', 'invalid_model_input', 'model_output_limit',
    'model_response_incomplete']) {
    let calls = 0;
    const judge = withTransportRetry(async () => { calls++; throw throwing(code); });
    await assert.rejects(judge(request), { code });
    assert.equal(calls, 1, `${code} must not be retried`);
  }
  // An error with no code at all is not a declared transport failure.
  let bare = 0;
  await assert.rejects(withTransportRetry(async () => { bare++; throw new Error('opaque'); })(request));
  assert.equal(bare, 1);
});

test('the retry reaches the review through boundedJudge, and the byte ceiling never does (W3-6)', async () => {
  let calls = 0;
  const bounded = boundedJudge(async () => {
    calls++;
    if (calls === 1) throw throwing('model_timeout');
    return narrative();
  });
  assert.equal((await bounded({ ...request, label: 'narrative:w1' })).attempts, 2);
  assert.equal(calls, 2);
  // budget_exhausted is raised before the judge is ever called, so it cannot be retried.
  calls = 0;
  const oversize = { system: '', prompt: 'x'.repeat(MAX_REVIEW_INPUT_BYTES + 1), label: 'narrative:w1' };
  await assert.rejects(bounded(oversize), { code: 'budget_exhausted' });
  assert.equal(calls, 0);
});

// ------------------------------------------------------ M33 C-07: local Claude transport hardening
//
// Every child here is a fake: nothing is spawned, no model is called. Each fake prints invented
// stream-json with a LEAK sentinel in assistant content, the result text, `errors` and stderr.

const M33_LEAK = 'M33_LEAK_SENTINEL sk-ant-FAKE-2468013579';
const M33_MODEL = 'claude-sonnet-5';
const m33Line = (event) => `${JSON.stringify(event)}\n`;
const m33Attested = [
  { type: 'system', subtype: 'init', model: M33_MODEL, cwd: `/synthetic/${M33_LEAK}`, tools: [] },
  { type: 'assistant', parent_tool_use_id: null, message: { model: M33_MODEL, content: [{ type: 'text', text: M33_LEAK }] } },
  { type: 'result', subtype: 'success', is_error: false, api_error_status: null, result: `{"ok":true} ${M33_LEAK}`, errors: [M33_LEAK] },
];

/** A fake child that records every signal. `onTerm`: 'close' exits on SIGTERM, 'ignore' waits for SIGKILL. */
function signalledClaude({ events = m33Attested, hang = false, onTerm = 'close', exit = 0 } = {}) {
  const capture = { calls: 0, signals: [], children: [] };
  const spawnProcess = (command, args, options) => {
    capture.calls++;
    Object.assign(capture, { command, args, options });
    const child = new EventEmitter();
    child.stdin = new PassThrough(); child.stdout = new PassThrough(); child.stderr = new PassThrough();
    let closed = false;
    const close = (code, signal = null) => { if (!closed) { closed = true; child.emit('close', code, signal); } };
    child.kill = (signal = 'SIGTERM') => {
      capture.signals.push(signal);
      if (signal === 'SIGKILL' || onTerm === 'close') setImmediate(() => close(null, signal));
      return true;
    };
    child.stdin.on('finish', () => setImmediate(() => {
      child.stderr.write(M33_LEAK);
      if (hang) return;
      child.stdout.write(events.map(m33Line).join(''));
      setImmediate(() => close(exit));
    }));
    capture.children.push(child);
    return child;
  };
  return { spawnProcess, capture };
}

const settle = () => new Promise((resolve) => setImmediate(resolve));
// Fake timers drive the transport; filesystem startup still needs real wall time.
const fixtureStartupTimer = globalThis.setTimeout;
async function until(predicate) {
  const deadline = performance.now() + 5000;
  while (!predicate() && performance.now() < deadline)
    await new Promise((resolve) => fixtureStartupTimer(resolve, 1));
  assert.ok(predicate(), 'the fake child was never reached');
}
function assertNoM33Leak(...values) {
  for (const value of values) {
    const text = JSON.stringify(value, value instanceof Error ? Object.getOwnPropertyNames(value) : undefined);
    assert.ok(!text.includes('M33_LEAK_SENTINEL') && !text.includes('sk-ant'), `stream text recorded: ${text}`);
  }
}

test('M33 (l) the argv pins --effort high beside the model, and the answer key binds it', async () => {
  const fake = signalledClaude();
  await createReviewJudge({ config: { backend: 'claude-cli', model: M33_MODEL }, env: {}, spawnProcess: fake.spawnProcess })(request);
  const args = fake.capture.args;
  assert.equal(args[args.indexOf('--effort') + 1], 'high');
  assert.equal(args.filter((a) => a === '--effort').length, 1);
  assert.deepEqual(args, reviewTransportArguments({ backend: 'claude-cli', model: M33_MODEL, system: request.system }).argv);
  assert.deepEqual(fake.capture.options.env, { CLAUDE_CODE_DISABLE_TERMINAL_TITLE: '1',
    CLAUDE_CODE_DISABLE_REFUSAL_FALLBACK: '1', CLAUDE_CODE_DISABLE_AUTO_MEMORY: '1' });
});

test('M33 (m) a timeout sends SIGTERM first and SIGKILL only after the fixed grace', async (t) => {
  assert.equal(KILL_GRACE_MS, 5000);
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const fake = signalledClaude({ hang: true, onTerm: 'ignore' }), recorded = [];
  const pending = createReviewJudge({ config: { backend: 'claude-cli', model: M33_MODEL }, env: {}, timeoutMs: 1000,
    spawnProcess: fake.spawnProcess, onResult: (m) => recorded.push(m) })(request);
  let error = null;
  pending.catch((caught) => { error = caught; });
  await until(() => fake.capture.calls === 1);
  await settle();
  t.mock.timers.tick(999);
  assert.deepEqual(fake.capture.signals, [], 'nothing before the timeout');
  t.mock.timers.tick(1);
  assert.deepEqual(fake.capture.signals, ['SIGTERM'], 'the child is asked to stop first');
  t.mock.timers.tick(KILL_GRACE_MS - 1);
  assert.deepEqual(fake.capture.signals, ['SIGTERM']);
  t.mock.timers.tick(1);
  assert.deepEqual(fake.capture.signals, ['SIGTERM', 'SIGKILL'], 'then killed after the grace');
  await until(() => error !== null);
  assert.equal(error.code, 'model_timeout');
  assert.equal(error.transportClass, 'timeout');
  assert.equal(recorded[0].transportClass, 'timeout');
  assert.equal(recorded[0].attestation, 'unattested', 'M33 refreeze: a timeout is not identity evidence');
  assertNoM33Leak(error, recorded);
});

test('M33 (m) a child that exits on SIGTERM is never sent SIGKILL', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const fake = signalledClaude({ hang: true, onTerm: 'close' });
  const pending = createReviewJudge({ config: { backend: 'claude-cli', model: M33_MODEL }, env: {}, timeoutMs: 50,
    spawnProcess: fake.spawnProcess })(request);
  let error = null;
  pending.catch((caught) => { error = caught; });
  await until(() => fake.capture.calls === 1);
  await settle();
  t.mock.timers.tick(50);
  await until(() => error !== null);
  t.mock.timers.tick(KILL_GRACE_MS * 2);
  assert.deepEqual(fake.capture.signals, ['SIGTERM']);
  assert.equal(error.code, 'model_timeout');
});

test('M33 (n) the transport version is /3, so no answer stored under the unattested /2 transport replays', async () => {
  const { createHash } = await import('node:crypto');
  const { ANSWER_CACHE_VERSION, answerKey } = await import('../src/answer-cache.js');
  assert.equal(REVIEW_TRANSPORT_VERSION, 'sonah.review-transport/3');
  assert.equal(reviewJudgeConfig({}, { backend: 'claude-cli', model: M33_MODEL }).version, 'sonah.review-transport/3');
  const identity = { backend: 'claude-cli', model: M33_MODEL };
  const keyUnder = (transport) => createHash('sha256').update(JSON.stringify({ v: ANSWER_CACHE_VERSION, transport,
    backend: identity.backend, model: identity.model,
    args: reviewTransportArguments({ ...identity, system: request.system }), system: request.system, prompt: request.prompt })).digest('hex');
  assert.equal(answerKey(request, identity), keyUnder('sonah.review-transport/3'));
  assert.notEqual(answerKey(request, identity), keyUnder('sonah.review-transport/2'));
});

test('M33 (o) an aborted signal stops in-flight children SIGTERM first and refuses new calls without spawning', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const controller = new AbortController();
  const fake = signalledClaude({ hang: true, onTerm: 'ignore' }), recorded = [];
  const judge = createReviewJudge({ config: { backend: 'claude-cli', model: M33_MODEL }, env: {}, signal: controller.signal,
    spawnProcess: fake.spawnProcess, onResult: (m) => recorded.push(m) });
  const errors = [];
  for (let i = 0; i < 2; i++) judge(request).catch((caught) => errors.push(caught));
  await until(() => fake.capture.calls === 2);
  await settle();
  controller.abort();
  assert.deepEqual(fake.capture.signals, ['SIGTERM', 'SIGTERM'], 'every in-flight child is asked to stop');
  t.mock.timers.tick(KILL_GRACE_MS);
  assert.deepEqual(fake.capture.signals, ['SIGTERM', 'SIGTERM', 'SIGKILL', 'SIGKILL']);
  await until(() => errors.length === 2);
  for (const error of errors) {
    assert.equal(error.code, 'review_cancelled');
    assert.equal(error.code, REVIEW_CANCELLED);
    assert.equal(error.transportClass, undefined);
  }
  assert.equal(recorded.length, 2, 'the two physical attempts are still accounted for');
  assert.ok(recorded.every((m) => m.code === 'review_cancelled'));
  await assert.rejects(judge(request), { code: 'review_cancelled' });
  assert.equal(fake.capture.calls, 2, 'a call after the abort starts nothing');
  assert.equal(recorded.length, 2, 'and records no attempt');
  assertNoM33Leak(errors, recorded);
});

test('M33 (o) an already-aborted signal refuses every backend before any process or request', async () => {
  const controller = new AbortController();
  controller.abort();
  const fake = signalledClaude();
  let fetched = 0;
  for (const config of [{ backend: 'claude-cli', model: M33_MODEL }, { backend: 'codex-cli', model: 'gpt-5.6-sol' },
    { backend: 'anthropic-api', model: 'claude-test-1' }]) {
    const judge = createReviewJudge({ config, env: { ANTHROPIC_API_KEY: 'synthetic' }, signal: controller.signal,
      spawnProcess: fake.spawnProcess, fetchImpl: async () => { fetched++; return new Response('{}'); } });
    await assert.rejects(judge(request), { code: 'review_cancelled' }, config.backend);
  }
  assert.equal(fake.capture.calls, 0);
  assert.equal(fetched, 0);
});

test('M33 (o) an abort reaches in-flight codex and API calls too', async () => {
  const controller = new AbortController();
  const codex = signalledClaude({ hang: true });
  const codexCall = createReviewJudge({ config: { backend: 'codex-cli', model: 'gpt-5.6-sol' }, env: {}, signal: controller.signal,
    spawnProcess: codex.spawnProcess })(request);
  const apiCall = createReviewJudge({ config: { backend: 'anthropic-api', model: 'claude-test-1' },
    env: { ANTHROPIC_API_KEY: 'synthetic' }, signal: controller.signal,
    fetchImpl: (url, { signal }) => new Promise((resolve, reject) => signal.addEventListener('abort', () => reject(new Error(M33_LEAK))))
  })(request);
  const outcomes = [codexCall, apiCall].map((call) => call.then(() => null, (error) => error));
  try {
    await until(() => codex.capture.calls === 1);
    await settle();
    controller.abort();
    const [codexError, apiError] = await Promise.all(outcomes);
    assert.equal(codexError?.code, 'review_cancelled');
    assert.equal(apiError?.code, 'review_cancelled');
    assert.equal(apiError.transportClass, undefined);
    assert.deepEqual(codex.capture.signals, ['SIGTERM']);
    assertNoM33Leak(codexError, apiError);
  } finally {
    controller.abort();
    await Promise.all(outcomes);
  }
});

test('M33 withTransportRetry never retries a stop-run provider class or a cancellation', async () => {
  const thrown = (code, providerClass) => {
    const error = Object.assign(new Error(code), { code });
    if (providerClass) Object.defineProperty(error, 'providerClass', { value: providerClass, enumerable: false });
    return error;
  };
  for (const providerClass of ['auth', 'billing', 'rate_limit', 'model_not_found', 'invalid_request', 'identity_mismatch']) {
    let calls = 0;
    await assert.rejects(withTransportRetry(async () => { calls++; throw thrown('model_unavailable', providerClass); })(request),
      { code: 'model_unavailable' });
    assert.equal(calls, 1, providerClass);
  }
  for (const providerClass of ['overloaded', 'server_error', 'unknown', null]) {
    let calls = 0;
    const result = await withTransportRetry(async () => {
      calls++; if (calls === 1) throw thrown('model_unavailable', providerClass); return narrative(); })(request);
    assert.equal(result.attempts, 2, String(providerClass));
  }
  let cancelled = 0;
  await assert.rejects(withTransportRetry(async () => { cancelled++; throw thrown('review_cancelled'); })(request),
    { code: 'review_cancelled' });
  assert.equal(cancelled, 1);
});

// ------------------------------------------- M33 refreeze (fix lane F3): listeners and child overlap

test('M33 F3 the abort listener lives only while a call is in flight: 50 calls leave none behind', async () => {
  const warnings = [];
  const onWarning = (warning) => warnings.push(warning.name);
  process.on('warning', onWarning);
  try {
    const controller = new AbortController();
    const config = { backend: 'claude-cli', model: M33_MODEL };
    // The review repro: one run-wide signal, one judge per call.
    for (let i = 0; i < 50; i++) {
      const fake = signalledClaude();
      assert.deepEqual(await createReviewJudge({ config, env: {}, spawnProcess: fake.spawnProcess, signal: controller.signal })(request),
        { ok: true });
    }
    assert.equal(getEventListeners(controller.signal, 'abort').length, 0, 'one judge per call');
    // One judge, 50 calls; and the codex and API backends.
    const fake = signalledClaude();
    const judge = createReviewJudge({ config, env: {}, spawnProcess: fake.spawnProcess, signal: controller.signal });
    for (let i = 0; i < 50; i++) await judge(request);
    assert.equal(getEventListeners(controller.signal, 'abort').length, 0, 'one judge, many calls');
    const codexEvents = [{ type: 'thread.started' }, { type: 'item.completed', item: { type: 'agent_message', text: '{"ok":true}' } },
      { type: 'turn.completed' }];
    const codex = signalledClaude({ events: codexEvents });
    const api = { config: { backend: 'anthropic-api', model: 'claude-test-1' }, env: { ANTHROPIC_API_KEY: 'synthetic' },
      fetchImpl: async () => new Response(JSON.stringify({ stop_reason: 'end_turn', content: [{ type: 'text', text: '{"ok":true}' }] })) };
    for (let i = 0; i < 20; i++) {
      await createReviewJudge({ config: { backend: 'codex-cli', model: 'gpt-5.6-sol' }, env: {}, spawnProcess: codex.spawnProcess,
        signal: controller.signal })(request);
      await createReviewJudge({ ...api, signal: controller.signal })(request);
    }
    assert.equal(getEventListeners(controller.signal, 'abort').length, 0, 'codex and API calls remove theirs too');
    // While a call is in flight it holds exactly one; when it settles, none.
    const hanging = signalledClaude({ hang: true });
    const inflight = createReviewJudge({ config, env: {}, spawnProcess: hanging.spawnProcess, signal: controller.signal })(request)
      .then(() => null, (error) => error);
    await until(() => hanging.capture.calls === 1);
    await settle();
    assert.equal(getEventListeners(controller.signal, 'abort').length, 1);
    controller.abort();
    assert.equal((await inflight)?.code, 'review_cancelled');
    assert.equal(getEventListeners(controller.signal, 'abort').length, 0);
    // An already-aborted signal refuses without spawning and without adding a listener.
    await assert.rejects(createReviewJudge({ config, env: {}, spawnProcess: hanging.spawnProcess, signal: controller.signal })(request),
      { code: 'review_cancelled' });
    assert.equal(hanging.capture.calls, 1);
    assert.equal(getEventListeners(controller.signal, 'abort').length, 0);
    await settle();
    assert.deepEqual(warnings.filter((name) => name === 'MaxListenersExceededWarning'), []);
  } finally { process.off('warning', onWarning); }
});

test('M33 F3 a stopped codex child has closed before its call settles, so a retry never overlaps it', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const live = { now: 0, max: 0, spawned: 0, signals: [] };
  const directories = [];
  // The review repro: a child that ignores SIGTERM and closes only on SIGKILL.
  const spawnProcess = (command, args, options) => {
    live.spawned++; live.now++; live.max = Math.max(live.max, live.now);
    directories.push(options.cwd);
    const child = new EventEmitter();
    child.stdin = new PassThrough(); child.stdout = new PassThrough(); child.stderr = new PassThrough();
    let closed = false;
    child.kill = (signal = 'SIGTERM') => {
      live.signals.push(signal);
      if (signal === 'SIGKILL') setImmediate(() => { if (!closed) { closed = true; live.now--; child.emit('close', null, signal); } });
      return true;
    };
    child.stdin.on('finish', () => setImmediate(() => child.stderr.write(M33_LEAK)));
    return child;
  };
  const recorded = [];
  const judge = withTransportRetry(createReviewJudge({ config: { backend: 'codex-cli', model: 'gpt-5.6-sol' }, env: {},
    timeoutMs: 50, spawnProcess, onResult: (m) => recorded.push(m) }));
  let error = null;
  judge(request).catch((caught) => { error = caught; });
  await until(() => live.spawned === 1);
  await settle();
  t.mock.timers.tick(50);
  assert.deepEqual(live.signals, ['SIGTERM']);
  for (let i = 0; i < 50; i++) await settle();
  assert.equal(live.spawned, 1, 'no retry starts while the first child is alive');
  assert.equal(recorded.length, 0, 'the call has not settled');
  assert.ok((await stat(directories[0])).isDirectory(), 'the private cwd outlives the child');
  t.mock.timers.tick(KILL_GRACE_MS - 1);
  assert.deepEqual(live.signals, ['SIGTERM']);
  t.mock.timers.tick(1);
  assert.deepEqual(live.signals, ['SIGTERM', 'SIGKILL']);
  await until(() => live.spawned === 2);
  await assert.rejects(stat(directories[0]), { code: 'ENOENT' }, 'removed only after the child closed');
  await settle();
  t.mock.timers.tick(50);
  t.mock.timers.tick(KILL_GRACE_MS);
  await until(() => error !== null);
  assert.equal(error.code, 'model_timeout');
  assert.equal(error.transportClass, 'timeout');
  assert.equal(live.max, 1, 'at most one live child');
  assert.equal(live.now, 0, 'no child is alive when the judge rejects');
  assert.deepEqual(live.signals, ['SIGTERM', 'SIGKILL', 'SIGTERM', 'SIGKILL']);
  assert.deepEqual(recorded.map((m) => [m.code, m.transportClass, m.attestation]),
    [['model_timeout', 'timeout', 'unattested'], ['model_timeout', 'timeout', 'unattested']]);
  assertNoM33Leak(error, recorded);
});

test('M33 F3 a codex child that exits on SIGTERM settles its call without SIGKILL', async () => {
  const fake = signalledClaude({ hang: true, onTerm: 'close' });
  const error = await createReviewJudge({ config: { backend: 'codex-cli', model: 'gpt-5.6-sol' }, env: {}, timeoutMs: 20,
    spawnProcess: fake.spawnProcess })(request).then(() => null, (caught) => caught);
  assert.equal(error?.code, 'model_timeout');
  assert.equal(error.transportClass, 'timeout');
  assert.deepEqual(fake.capture.signals, ['SIGTERM']);
});

test('G1 a stopped call settles within a fixed bound even when its pipes stay open: SIGKILL, a fixed grace, then the stdio is destroyed', async (t) => {
  const reviewJudge = await import('../src/review-judge.js');
  // Checked last, so a transport without the bound fails on the behaviour, not on a missing name.
  const grace = Number.isSafeInteger(reviewJudge.STDIO_GRACE_MS) ? reviewJudge.STDIO_GRACE_MS : 1000;
  t.mock.timers.enable({ apis: ['setTimeout'] });
  for (const config of [{ backend: 'claude-cli', model: M33_MODEL }, { backend: 'codex-cli', model: 'gpt-5.6-sol' }]) {
    const signals = [], children = [], directories = [], recorded = [];
    // The review repro: the child is gone, but a grandchild inherited its stdout and stderr, so the
    // pipes never close and `close` never comes, whatever the child is sent.
    const spawnProcess = (command, args, options) => {
      directories.push(options.cwd);
      const child = new EventEmitter();
      child.stdin = new PassThrough(); child.stdout = new PassThrough(); child.stderr = new PassThrough();
      child.kill = (signal = 'SIGTERM') => { signals.push(signal); return true; };
      child.stdin.on('finish', () => setImmediate(() => child.stderr.write(M33_LEAK)));
      children.push(child);
      return child;
    };
    let error = null;
    createReviewJudge({ config, env: {}, timeoutMs: 50, spawnProcess, onResult: (m) => recorded.push(m) })(request)
      .catch((caught) => { error = caught; });
    await until(() => children.length === 1);
    await settle();
    t.mock.timers.tick(50);
    assert.deepEqual(signals, ['SIGTERM'], config.backend);
    t.mock.timers.tick(KILL_GRACE_MS);
    assert.deepEqual(signals, ['SIGTERM', 'SIGKILL'], config.backend);
    for (let i = 0; i < 20; i++) await settle();
    t.mock.timers.tick(grace - 1);
    for (let i = 0; i < 20; i++) await settle();
    assert.equal(error, null, `${config.backend}: nothing settles before the fixed grace after SIGKILL`);
    assert.equal(children[0].stdout.destroyed, false, config.backend);
    t.mock.timers.tick(1);
    await until(() => error !== null);
    assert.equal(error.code, 'model_timeout', config.backend);
    assert.equal(error.transportClass, 'timeout', config.backend);
    const [child] = children;
    assert.ok(child.stdin.destroyed && child.stdout.destroyed && child.stderr.destroyed,
      `${config.backend}: every stdio stream is destroyed`);
    assert.deepEqual(recorded.map((m) => [m.code, m.transportClass]), [['model_timeout', 'timeout']], config.backend);
    await assert.rejects(stat(directories[0]), { code: 'ENOENT' }, `${config.backend}: the private cwd is removed once settled`);
    assert.deepEqual(signals, ['SIGTERM', 'SIGKILL'], `${config.backend}: no further signal`);
    assertNoM33Leak(error, recorded);
  }
  assert.ok(Number.isSafeInteger(reviewJudge.STDIO_GRACE_MS) && reviewJudge.STDIO_GRACE_MS > 0,
    'the grace after SIGKILL is an exported fixed literal');
});

test('G1 a stopped child that closes within the grace settles on its close, and its pipes are not destroyed', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  for (const config of [{ backend: 'claude-cli', model: M33_MODEL }, { backend: 'codex-cli', model: 'gpt-5.6-sol' }]) {
    const fake = signalledClaude({ hang: true, onTerm: 'ignore' });
    let error = null;
    createReviewJudge({ config, env: {}, timeoutMs: 50, spawnProcess: fake.spawnProcess })(request)
      .catch((caught) => { error = caught; });
    await until(() => fake.capture.calls === 1);
    await settle();
    t.mock.timers.tick(50);
    t.mock.timers.tick(KILL_GRACE_MS);
    await until(() => error !== null);
    assert.equal(error.code, 'model_timeout', config.backend);
    assert.equal(fake.capture.children[0].stdout.destroyed, false, `${config.backend}: a closed child's pipes are its own`);
    assert.deepEqual(fake.capture.signals, ['SIGTERM', 'SIGKILL'], config.backend);
  }
});
