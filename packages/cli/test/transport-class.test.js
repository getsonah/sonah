// W3d-1. A transport failure is classified from its exit status or error code — never from
// what the process printed. The failure's `code` stays the closed judge token; the class rides
// beside it as `transportClass`, on the thrown error and on the recorded result metadata.
//
// Every transport here is a fake: no process is spawned, no provider is called. Each fake writes
// a credential-shaped line to stderr, so a class that were derived from text would carry it.
import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { createReviewJudge, withTransportRetry, PROVIDER_CLASSES, NON_RETRYABLE_PROVIDER_CLASSES } from '../src/review-judge.js';
import * as reviewRun from '../../evidence/src/run-review.js';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { answerKey, createAnswerCache, memoizeJudge } from '../src/answer-cache.js';

const LEAK = 'SYNTHETIC_STDERR ANTHROPIC_API_KEY=sk-ant-FAKE-0123456789';
const request = { system: 'Synthetic system.', prompt: 'Synthetic private prompt.' };
const resultLine = (fields = {}) => `${JSON.stringify({ type: 'result', subtype: 'success', is_error: false,
  result: '{"value":1}', usage: { output_tokens: 1 }, ...fields })}\n`;
// M33 refreeze: the default alias (`sonnet`) is accepted only after one init and a top-level
// assistant naming the model that init names. A stream that should answer carries both.
const servedLines = `${JSON.stringify({ type: 'system', subtype: 'init', model: 'claude-test-1' })}\n${
  JSON.stringify({ type: 'assistant', parent_tool_use_id: null, message: { model: 'claude-test-1', content: [] } })}\n`;

/** A fake `claude` child. `kill` closes it the way a signal does: no exit code. */
function fakeSpawn({ stdout = '', exit = 0, hang = false, emitError = false, throws = false } = {}) {
  return () => {
    if (throws) throw Object.assign(new Error(`spawn claude EACCES ${LEAK}`), { code: 'EACCES' });
    const child = new EventEmitter();
    child.stdin = new PassThrough(); child.stdout = new PassThrough(); child.stderr = new PassThrough();
    let closed = false;
    const close = (code) => { if (!closed) { closed = true; child.emit('close', code, code === null ? 'SIGKILL' : null); } };
    child.kill = () => { setImmediate(() => close(null)); return true; };
    child.stdin.on('finish', () => setImmediate(() => {
      child.stderr.write(LEAK);
      if (emitError) {
        child.emit('error', Object.assign(new Error(`spawn claude ENOENT ${LEAK}`), { code: 'ENOENT', syscall: 'spawn claude' }));
        return;
      }
      if (stdout) child.stdout.write(stdout);
      if (!hang) setImmediate(() => close(exit));
    }));
    return child;
  };
}

async function failureOf(judge) {
  try { await judge(request); } catch (error) { return error; }
  assert.fail('the transport was expected to fail');
}

function assertNoText(...values) {
  for (const value of values) {
    const text = JSON.stringify(value, Object.getOwnPropertyNames(value ?? {}));
    assert.ok(!text.includes('SYNTHETIC_STDERR') && !text.includes('sk-ant'), `transport text recorded: ${text}`);
  }
}

test('W3d-1 every local transport failure carries one closed class, from status alone', async () => {
  const cases = [
    ['timeout', { hang: true }, { timeoutMs: 25 }, 'model_timeout'],
    ['output_limit', { stdout: 'x'.repeat(4096) }, { maxOutputBytes: 64 }, 'model_output_limit'],
    ['exit_nonzero', { stdout: resultLine(), exit: 1 }, {}, 'model_unavailable'],
    ['exit_nonzero', { stdout: resultLine(), exit: 137 }, {}, 'model_unavailable'],
    ['spawn_failed', { throws: true }, {}, 'model_unavailable'],
    ['spawn_failed', { emitError: true }, {}, 'model_unavailable'],
    ['no_output', { stdout: '' }, {}, 'model_unavailable'],
    ['no_output', { stdout: 'not a stream event\n' }, {}, 'model_unavailable'],
    ['unknown', { stdout: resultLine({ is_error: true }) }, {}, 'model_unavailable'],
    ['unknown', { stdout: resultLine({ subtype: 'error_during_execution' }) }, {}, 'model_unavailable'],
  ];
  for (const [transportClass, fake, options, code] of cases) {
    const recorded = [];
    const error = await failureOf(createReviewJudge({ spawnProcess: fakeSpawn(fake), onResult: (m) => recorded.push(m), ...options }));
    assert.equal(error.code, code, `${transportClass}: the reason stays the closed token`);
    assert.equal(error.transportClass, transportClass, JSON.stringify(fake).slice(0, 80));
    assert.ok(reviewRun.TRANSPORT_SHORTFALL?.includes(error.transportClass), 'the class is a member of the frozen list');
    assert.equal(recorded.length, 1);
    assert.equal(recorded[0].transportClass, transportClass, 'the recorded result carries the class too');
    assertNoText(error, recorded[0]);
  }
});

test('W3d-1 a failure that is not the transport\'s carries no class', async () => {
  const tool = `${JSON.stringify({ type: 'assistant', message: { model: 'claude-test-1', content: [{ type: 'tool_use' }] } })}\n${resultLine()}`;
  const toolUse = await failureOf(createReviewJudge({ spawnProcess: fakeSpawn({ stdout: tool }) }));
  assert.equal(toolUse.code, 'model_tool_use');
  assert.equal(toolUse.transportClass, undefined);
  const unparsed = await failureOf(createReviewJudge({ spawnProcess: fakeSpawn({ stdout: servedLines + resultLine({ result: 'no json here' }) }) }));
  assert.equal(unparsed.code, 'model_response_invalid');
  assert.equal(unparsed.transportClass, undefined);
  const recorded = [];
  const answer = await createReviewJudge({ spawnProcess: fakeSpawn({ stdout: servedLines + resultLine() }), onResult: (m) => recorded.push(m) })(request);
  assert.deepEqual(answer, { value: 1 });
  assert.equal(Object.hasOwn(recorded[0], 'transportClass'), false);
});

test('W3d-1 the API backend classifies its timeout, its output ceiling and everything else', async () => {
  const config = { backend: 'anthropic-api', model: 'claude-test-1' };
  const env = { ANTHROPIC_API_KEY: 'synthetic-key' };
  const hang = (url, { signal }) => new Promise((resolve, reject) =>
    signal.addEventListener('abort', () => reject(new Error(`aborted ${LEAK}`))));
  const cases = [
    ['timeout', { fetchImpl: hang, timeoutMs: 25 }],
    ['output_limit', { fetchImpl: async () => new Response('x'.repeat(4096)), maxOutputBytes: 64 }],
    ['unknown', { fetchImpl: async () => new Response(LEAK, { status: 529 }) }],
    ['unknown', { fetchImpl: async () => { throw new Error(LEAK); } }],
  ];
  for (const [transportClass, options] of cases) {
    const recorded = [];
    const error = await failureOf(createReviewJudge({ config, env, onResult: (m) => recorded.push(m), ...options }));
    assert.equal(error.transportClass, transportClass);
    assert.equal(recorded[0].transportClass, transportClass);
    assertNoText(error, recorded[0]);
  }
  const missing = await failureOf(createReviewJudge({ config, env: {}, fetchImpl: () => assert.fail('must not call') }));
  assert.equal(missing.code, 'anthropic_key_missing');
  assert.equal(missing.transportClass, undefined, 'a missing key is not a transport failure');
});

// ------------------------------------------------ M33 C-07: served-model attestation, provider class
//
// A `claude-cli` call counts as answered by the requested model only when the stream proves it:
// one `system/init` naming the full requested id, at least one top-level assistant, every one
// naming that id, no locally built (`<synthetic>`) or API-error assistant, no model-fallback event,
// one successful result without an API error status, exit 0 and no stop. A failure's provider
// class comes only from exact membership of the assistant's typed `error` enum — never from text.
// Every stream below is invented; each one carries a LEAK sentinel in assistant content, the
// result text, the result's `errors`, the init `cwd` and stderr.
const M33_LEAK = 'M33_LEAK_SENTINEL sk-ant-FAKE-9876543210';
const REQUESTED = 'claude-sonnet-5';
const attested = { backend: 'claude-cli', model: REQUESTED };
const initEvent = (model = REQUESTED, extra = {}) => ({ type: 'system', subtype: 'init', model, session_id: 'synthetic-session',
  cwd: `/synthetic/${M33_LEAK}`, tools: [], mcp_servers: [], claude_code_version: '0.0.0-synthetic', ...extra });
const assistantEvent = (model = REQUESTED, extra = {}) => ({ type: 'assistant', parent_tool_use_id: null, session_id: 'synthetic-session',
  message: { model, role: 'assistant', content: [{ type: 'text', text: `{"value":1} ${M33_LEAK}` }] }, ...extra });
const syntheticError = (error, extra = {}) => assistantEvent('<synthetic>', { error, is_api_error_message: true, ...extra });
const resultEvent = (extra = {}) => ({ type: 'result', subtype: 'success', is_error: false, api_error_status: null,
  result: `${M33_LEAK} {"value":1} ${M33_LEAK}`, errors: [M33_LEAK], usage: { output_tokens: 1 }, ...extra });
const failedResult = (status = null, extra = {}) => resultEvent({ is_error: true, api_error_status: status,
  result: `API Error: ${M33_LEAK}`, ...extra });
const streamOf = (...events) => events.map((event) => (typeof event === 'string' ? event : `${JSON.stringify(event)}\n`)).join('');

/** A fake `claude` that prints `events`, writes the LEAK to stderr and exits `exit`. Counts calls. */
function fakeClaude(events, { exit = 0 } = {}) {
  const capture = { calls: 0 };
  const spawnProcess = () => {
    capture.calls++;
    const child = new EventEmitter();
    child.stdin = new PassThrough(); child.stdout = new PassThrough(); child.stderr = new PassThrough();
    let closed = false;
    const close = (code) => { if (!closed) { closed = true; child.emit('close', code, code === null ? 'SIGTERM' : null); } };
    child.kill = () => { setImmediate(() => close(null)); return true; };
    child.stdin.on('finish', () => setImmediate(() => {
      child.stderr.write(`${M33_LEAK} rate_limit overloaded model_not_found`);
      child.stdout.write(streamOf(...events));
      setImmediate(() => close(exit));
    }));
    return child;
  };
  return { spawnProcess, capture };
}

function assertNoLeak(...values) {
  for (const value of values) {
    const text = JSON.stringify(value, value instanceof Error ? Object.getOwnPropertyNames(value) : undefined);
    assert.ok(!text.includes('M33_LEAK_SENTINEL') && !text.includes('sk-ant'), `stream text recorded: ${text}`);
  }
}

/** One call through the real judge and its one-retry wrapper. Returns what a reader could see. */
async function throughRetry(events, { exit = 0, config = attested } = {}) {
  const fake = fakeClaude(events, { exit }), recorded = [];
  const judge = withTransportRetry(createReviewJudge({ config, env: { PATH: '/bin' }, spawnProcess: fake.spawnProcess,
    onResult: (m) => recorded.push(m) }));
  let error = null, answer;
  try { answer = await judge(request); } catch (caught) { error = caught; }
  assertNoLeak(error ?? {}, recorded);
  if (error) assert.equal(error.message, error.code, 'the message is the closed code and nothing else');
  return { error, answer, recorded, calls: fake.capture.calls };
}

test('M33 the provider classes are one frozen closed list, and the no-retry set is inside it', () => {
  assert.deepEqual([...PROVIDER_CLASSES], ['auth', 'billing', 'rate_limit', 'model_not_found', 'invalid_request',
    'output_tokens', 'overloaded', 'server_error', 'identity_mismatch', 'unknown']);
  assert.ok(Object.isFrozen(PROVIDER_CLASSES));
  assert.deepEqual([...NON_RETRYABLE_PROVIDER_CLASSES].sort(),
    ['auth', 'billing', 'identity_mismatch', 'invalid_request', 'model_not_found', 'rate_limit']);
  assert.ok(Object.isFrozen(NON_RETRYABLE_PROVIDER_CLASSES));
  for (const cls of NON_RETRYABLE_PROVIDER_CLASSES) assert.ok(PROVIDER_CLASSES.includes(cls), cls);
});

test('M33 (a) a synthetic rate_limit with status 429 and exit 1: provider rate_limit, transport exit_nonzero, one attempt', async () => {
  const { error, recorded, calls } = await throughRetry([initEvent(), syntheticError('rate_limit', { api_error_status: 429 }),
    failedResult(429)], { exit: 1 });
  assert.equal(error.code, 'model_unavailable');
  assert.equal(error.transportClass, 'exit_nonzero');
  assert.equal(error.providerClass, 'rate_limit');
  assert.equal(Object.keys(error).includes('providerClass'), false, 'the class is not an enumerable field of the error');
  assert.equal(calls, 1, 'a rate limit is never asked again');
  assert.equal(recorded.length, 1);
  const [m] = recorded;
  assert.equal(m.ok, false);
  assert.equal(m.attestation, 'unattested', 'M33 refreeze: a failure without identity evidence is not a mismatch');
  assert.equal(m.providerClass, 'rate_limit');
  assert.equal(m.transportClass, 'exit_nonzero');
  assert.equal(m.syntheticMessages, 1);
  assert.equal(m.apiErrorStatus, 429);
  assert.equal(m.apiRetries, 0);
  assert.equal(m.configuredModel, REQUESTED);
  assert.deepEqual(m.servedModels, ['<synthetic>']);
});

test('M33 (b) every stop-run class is attempted exactly once through the retry wrapper', async () => {
  const cases = [['authentication_failed', 'auth', 401], ['oauth_org_not_allowed', 'auth', 403], ['account_on_hold', 'auth', 403],
    ['verification_required', 'auth', 403], ['cloud_credential_error', 'auth', null], ['billing_error', 'billing', 402],
    ['rate_limit', 'rate_limit', 429], ['model_not_found', 'model_not_found', 404], ['invalid_request', 'invalid_request', 400]];
  for (const [enumValue, providerClass, status] of cases) {
    const { error, recorded, calls } = await throughRetry([initEvent(), syntheticError(enumValue, { api_error_status: status }),
      failedResult(status)], { exit: 1 });
    assert.equal(error.code, 'model_unavailable', enumValue);
    assert.equal(error.providerClass, providerClass, enumValue);
    assert.equal(recorded[0].providerClass, providerClass, enumValue);
    assert.equal(calls, 1, `${enumValue} must not be retried`);
  }
});

test('M33 (c) overloaded, server_error and unknown are retried once; max_output_tokens is incomplete and not retried', async () => {
  for (const [enumValue, providerClass] of [['overloaded', 'overloaded'], ['server_error', 'server_error'], ['unknown', 'unknown']]) {
    const { error, recorded, calls } = await throughRetry([initEvent(), syntheticError(enumValue, { api_error_status: 529 }),
      failedResult(529)], { exit: 1 });
    assert.equal(error.code, 'model_unavailable', enumValue);
    assert.equal(error.providerClass, providerClass, enumValue);
    assert.equal(calls, 2, `${enumValue} is asked once more`);
    assert.deepEqual(recorded.map((m) => m.providerClass), [providerClass, providerClass]);
  }
  const { error, recorded, calls } = await throughRetry([initEvent(), syntheticError('max_output_tokens'), failedResult()], { exit: 1 });
  assert.equal(error.code, 'model_response_incomplete');
  assert.equal(error.providerClass, 'output_tokens');
  assert.equal(recorded[0].providerClass, 'output_tokens');
  assert.equal(calls, 1);
});

test('M33 (d) an error value outside the exact enum, or not a string, is unknown', async () => {
  for (const value of ['quota_exceeded', 'Rate_Limit', 'rate_limit ', ' rate_limit', 'RATE_LIMIT', '__proto__', 'constructor',
    'toString', '', 429, { type: 'rate_limit' }, ['rate_limit'], true, null]) {
    const { error, recorded } = await throughRetry([initEvent(), syntheticError(value), failedResult()], { exit: 1 });
    assert.equal(error.code, 'model_unavailable', JSON.stringify(value));
    assert.equal(error.providerClass, 'unknown', JSON.stringify(value));
    assert.equal(recorded[0].providerClass, 'unknown', JSON.stringify(value));
  }
  // M33 refreeze: a typed status that maps to a stop class still wins beside an unknown enum value.
  const beside = await throughRetry([initEvent(), syntheticError('quota_exceeded'), failedResult(429)], { exit: 1 });
  assert.equal(beside.error.providerClass, 'rate_limit');
  assert.equal(beside.calls, 1);
});

test('M33 (e) text that says rate limit is never a class: only the typed enum or the typed integer status is', async () => {
  const says = 'API Error: 429 rate_limit Rate limit reached billing_error model_not_found authentication_failed';
  const synthetic = assistantEvent('<synthetic>', { is_api_error_message: true,
    message: { model: '<synthetic>', role: 'assistant', content: [{ type: 'text', text: `${says} ${M33_LEAK}` }] } });
  // M33 refreeze: with no enum value, the result's integer `api_error_status` decides (429 is rate_limit).
  for (const [status, providerClass, attempts] of [[null, 'unknown', 2], [429, 'rate_limit', 1]]) {
    const { error, recorded, calls } = await throughRetry([initEvent(), synthetic,
      failedResult(status, { result: `${says} ${M33_LEAK}`, errors: [says, M33_LEAK], error_details: says })], { exit: 1 });
    assert.equal(error.providerClass, providerClass, `status ${status}`);
    assert.equal(recorded[0].providerClass, providerClass);
    assert.equal(recorded[0].apiErrorStatus, status, 'the typed status is recorded as a number');
    assert.equal(recorded[0].syntheticMessages, 1);
    assert.equal(calls, attempts, 'unknown keeps the one existing retry; rate_limit is never asked again');
  }
});

test('M33 (g) a valid answer served by another model is an identity mismatch: thrown, never returned, never stored', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'sonah-m33-l3-'));
  try {
    const fake = fakeClaude([initEvent(), assistantEvent('claude-sonnet-4-6'), resultEvent()]), recorded = [];
    const identity = { backend: 'claude-cli', model: REQUESTED };
    const cache = createAnswerCache(dir, identity);
    const judge = memoizeJudge(withTransportRetry(createReviewJudge({ config: attested, env: {}, spawnProcess: fake.spawnProcess,
      onResult: (m) => recorded.push(m) })), cache);
    let error = null;
    try { await judge(request); } catch (caught) { error = caught; }
    assert.ok(error, 'a mismatched answer is a failure');
    assert.equal(error.code, 'model_unavailable');
    assert.equal(error.providerClass, 'identity_mismatch');
    assert.equal(error.transportClass, 'unknown');
    assert.equal(fake.capture.calls, 1, 'an identity mismatch is not asked again');
    assert.equal(recorded[0].ok, false);
    assert.equal(recorded[0].attestation, 'mismatch');
    assert.deepEqual(recorded[0].servedModels, ['claude-sonnet-4-6']);
    assert.equal(await cache.get(request), null, 'D60 never stores a failed call');
    assert.ok(answerKey(request, identity));
    assertNoLeak(error, recorded);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('M33 (h) a near-miss id is a mismatch: no prefix, date or case matching', async () => {
  const cases = [
    [attested, [initEvent(), assistantEvent('claude-sonnet-5-20260101'), resultEvent()]],
    [attested, [initEvent('claude-sonnet-5-20260101'), assistantEvent(), resultEvent()]],
    [{ backend: 'claude-cli', model: 'claude-sonnet-5-20260101' }, [initEvent('claude-sonnet-5-20260101'), assistantEvent(), resultEvent()]],
    [attested, [initEvent(), assistantEvent('Claude-Sonnet-5'), resultEvent()]],
    [attested, [initEvent(), assistantEvent('claude-sonnet-5 '), resultEvent()]],
    [attested, [initEvent(), assistantEvent(), assistantEvent('claude-sonnet-5[1m]'), resultEvent()]],
  ];
  for (const [config, events] of cases) {
    const { error, recorded, calls } = await throughRetry(events, { config });
    assert.equal(error?.code, 'model_unavailable', JSON.stringify(events.map((e) => e.model ?? e.message?.model)));
    assert.equal(error.providerClass, 'identity_mismatch');
    assert.equal(recorded[0].attestation, 'mismatch');
    assert.equal(calls, 1);
  }
});

test('M33 (i) any model-fallback system event is a mismatch, even when the served id still matches', async () => {
  for (const subtype of ['model_fallback', 'model_consent_fallback', 'model_refusal_fallback', 'model_refusal_no_fallback']) {
    const fallback = { type: 'system', subtype, original_model: REQUESTED, fallback_model: 'claude-opus-5', content: M33_LEAK };
    const { error, recorded, calls } = await throughRetry([initEvent(), fallback, assistantEvent(), resultEvent()]);
    assert.equal(error?.code, 'model_unavailable', subtype);
    assert.equal(error.providerClass, 'identity_mismatch', subtype);
    assert.equal(recorded[0].attestation, 'mismatch', subtype);
    assert.equal(calls, 1, subtype);
  }
});

test('M33 (j) init and a successful result with no top-level assistant is not attested', async () => {
  const { error, recorded, calls } = await throughRetry([initEvent(), resultEvent()]);
  assert.equal(error?.code, 'model_unavailable');
  assert.equal(error.providerClass, 'unknown', 'nothing proved another model answered; nothing proved this one did');
  assert.equal(recorded[0].attestation, 'unattested', 'M33 refreeze: no identity evidence, so not a mismatch');
  assert.deepEqual(recorded[0].servedModels, []);
  assert.equal(calls, 2);
  // M33 refreeze: the transport has no tools, so an assistant that is not top-level is identity evidence.
  const subagent = assistantEvent(REQUESTED, { parent_tool_use_id: 'toolu_synthetic' });
  const { parent_tool_use_id: omitted, ...unparented } = assistantEvent();
  for (const events of [[initEvent(), subagent, resultEvent()], [initEvent(), unparented, resultEvent()]]) {
    const nested = await throughRetry(events);
    assert.equal(nested.error?.code, 'model_unavailable');
    assert.equal(nested.error.providerClass, 'identity_mismatch');
    assert.equal(nested.recorded[0].attestation, 'mismatch');
    assert.deepEqual(nested.recorded[0].servedModels, [], 'a nested event naming the requested id adds nothing');
    assert.equal(nested.calls, 1);
  }
});

test('M33 (k) the init event must be exactly one, naming exactly the requested id', async () => {
  const mismatch = await throughRetry([initEvent('claude-opus-5'), assistantEvent(), resultEvent()]);
  assert.equal(mismatch.error.providerClass, 'identity_mismatch');
  assert.equal(mismatch.recorded[0].attestation, 'mismatch');
  assert.equal(mismatch.recorded[0].configuredModel, 'claude-opus-5');
  assert.equal(mismatch.calls, 1);
  // A missing, repeated or non-string init proves nothing either way: a failure, never a mismatch.
  for (const events of [[assistantEvent(), resultEvent()], [initEvent(), initEvent(), assistantEvent(), resultEvent()],
    [initEvent(undefined, { model: 7 }), assistantEvent(), resultEvent()]]) {
    const { error, recorded } = await throughRetry(events);
    assert.equal(error?.code, 'model_unavailable');
    assert.equal(recorded[0].attestation, 'unattested');
  }
  // Two results, an absent is_error or a non-null API status are not one clean success either.
  for (const events of [[initEvent(), assistantEvent(), resultEvent(), resultEvent()],
    [initEvent(), assistantEvent(), resultEvent({ is_error: undefined })],
    [initEvent(), assistantEvent(), resultEvent({ api_error_status: 529 })],
    [initEvent(), assistantEvent(), assistantEvent(REQUESTED, { error: 'overloaded' }), resultEvent()],
    [initEvent(), assistantEvent(REQUESTED, { is_api_error_message: true }), resultEvent()]]) {
    const { error, recorded } = await throughRetry(events);
    assert.equal(error?.code, 'model_unavailable', JSON.stringify(events.map((e) => e.type)));
    assert.equal(recorded[0].attestation, 'unattested');
  }
});

test('M33 (f) an attested success returns the answer and records the attestation, counts only', async () => {
  const retry = { type: 'system', subtype: 'api_retry', attempt: 1, max_retries: 10, error_status: 529, error: 'overloaded' };
  const partial = { type: 'stream_event', event: { type: 'content_block_delta', delta: { text: M33_LEAK } }, parent_tool_use_id: null };
  const { error, answer, recorded, calls } = await throughRetry([initEvent(), retry, retry, partial, assistantEvent(),
    assistantEvent(), resultEvent()]);
  assert.equal(error, null);
  assert.deepEqual(answer, { value: 1 });
  assert.equal(calls, 1);
  const [m] = recorded;
  assert.equal(m.ok, true);
  assert.equal(m.attestation, 'attested');
  assert.equal(m.providerClass, null);
  assert.equal(m.configuredModel, REQUESTED);
  assert.deepEqual(m.servedModels, [REQUESTED]);
  assert.equal(m.syntheticMessages, 0);
  assert.equal(m.apiErrorStatus, null);
  assert.equal(m.apiRetries, 2);
  assert.equal(Object.hasOwn(m, 'transportClass'), false);
});

test('M33 an alias cannot be attested: it says unattested, still answers a non-measurement caller, and still fails on errors', async () => {
  for (const model of ['sonnet', 'opus', 'haiku', 'claude-sonnet', 'claude-opus-latest', 'best']) {
    const { error, answer, recorded } = await throughRetry([initEvent(model), assistantEvent(model), resultEvent()],
      { config: { backend: 'claude-cli', model } });
    assert.equal(error, null, model);
    assert.deepEqual(answer, { value: 1 });
    assert.equal(recorded[0].attestation, 'unattested', `${model} can never be attested`);
    assert.equal(recorded[0].providerClass, null);
  }
  const alias = { backend: 'claude-cli', model: 'sonnet' };
  const limited = await throughRetry([initEvent(), syntheticError('rate_limit'), failedResult(429)], { exit: 1, config: alias });
  assert.equal(limited.error.providerClass, 'rate_limit');
  assert.equal(limited.calls, 1);
  const fallback = await throughRetry([initEvent(), { type: 'system', subtype: 'model_fallback' }, assistantEvent(), resultEvent()],
    { config: alias });
  assert.equal(fallback.error.providerClass, 'identity_mismatch');
  const synthetic = await throughRetry([initEvent(), assistantEvent('<synthetic>'), resultEvent()], { config: alias });
  assert.equal(synthetic.error?.code, 'model_unavailable', 'a locally built message is never an answer');
  assert.equal(synthetic.error.providerClass, 'unknown');
});

test('M33 codex-cli and anthropic-api report the served model as unattested', async () => {
  const recorded = [];
  await createReviewJudge({ config: { backend: 'anthropic-api', model: 'claude-test-1' }, env: { ANTHROPIC_API_KEY: 'synthetic-key' },
    onResult: (m) => recorded.push(m), fetchImpl: async () => new Response(JSON.stringify({ model: 'claude-test-1',
      stop_reason: 'end_turn', content: [{ type: 'text', text: `{"value":1} ${M33_LEAK}` }] })) })(request);
  assert.equal(recorded[0].attestation, 'unattested');
  assert.equal(recorded[0].providerClass, null);
  assert.deepEqual(recorded[0].servedModels, ['claude-test-1']);
  assert.equal(recorded[0].syntheticMessages, 0);
  assert.equal(recorded[0].apiErrorStatus, null);
  assert.equal(recorded[0].apiRetries, 0);
  assertNoLeak(recorded);
});

test('M33 a stream line that is JSON but not an event, or an assistant with non-array content, is skipped, never a crash', async () => {
  // Before M33 a `null` line threw inside the child's close handler: an uncaught exception, not a failure code.
  const odd = ['null\n', '[]\n', '42\n', '"text"\n', `${JSON.stringify({ type: 7 })}\n`];
  const weird = assistantEvent(REQUESTED, { message: { model: REQUESTED, content: M33_LEAK } });
  const { error, answer, recorded } = await throughRetry([...odd, initEvent(), weird, assistantEvent(), resultEvent()]);
  assert.equal(error, null);
  assert.deepEqual(answer, { value: 1 });
  assert.equal(recorded[0].attestation, 'attested');
  assert.equal(recorded[0].toolUse, 0);
});

// ------------------------------------------- M33 refreeze (fix lane F3): adversarial review repros
//
// Each case below was a confirmed synthetic repro against the merged L3 transport. Every stream is
// invented and still carries the LEAK sentinel; `throughRetry` asserts none of it is recorded.

test('M33 F3 every assistant event must be top-level: a missing, false or id parent fails as an identity mismatch', async () => {
  const { parent_tool_use_id: omitted, ...unparentedHaiku } = assistantEvent('claude-haiku-4-5');
  const nested = (model, parent) => assistantEvent(model, { parent_tool_use_id: parent });
  const cases = [
    ['missing, other model, last', [initEvent(), assistantEvent(), unparentedHaiku, resultEvent()], 'claude-haiku-4-5'],
    ['tool id, other model', [initEvent(), assistantEvent(), nested('claude-haiku-4-5', 'toolu_synthetic'), resultEvent()], 'claude-haiku-4-5'],
    ['false, other model', [initEvent(), assistantEvent(), nested('claude-opus-4-1', false), resultEvent()], 'claude-opus-4-1'],
    ['zero', [initEvent(), assistantEvent(), nested('claude-opus-4-1', 0), resultEvent()], 'claude-opus-4-1'],
    ['empty string', [initEvent(), assistantEvent(), nested('claude-opus-4-1', ''), resultEvent()], 'claude-opus-4-1'],
    ['object', [initEvent(), assistantEvent(), nested('claude-opus-4-1', {}), resultEvent()], 'claude-opus-4-1'],
  ];
  for (const [name, events, other] of cases) {
    const { error, answer, recorded, calls } = await throughRetry(events);
    assert.equal(answer, undefined, name);
    assert.equal(error?.code, 'model_unavailable', name);
    assert.equal(error.providerClass, 'identity_mismatch', name);
    assert.equal(recorded[0].ok, false, name);
    assert.equal(recorded[0].attestation, 'mismatch', name);
    assert.equal(recorded[0].providerClass, 'identity_mismatch', name);
    assert.deepEqual(recorded[0].servedModels, [REQUESTED, other], `${name}: the nested event's other id is recorded`);
    assert.equal(calls, 1, `${name}: an identity mismatch is not asked again`);
  }
  // A nested event under an alias request is a mismatch too.
  const alias = await throughRetry([initEvent(), assistantEvent(), nested(REQUESTED, 'toolu_synthetic'), resultEvent()],
    { config: { backend: 'claude-cli', model: 'sonnet' } });
  assert.equal(alias.error?.providerClass, 'identity_mismatch');
  assert.equal(alias.recorded[0].attestation, 'mismatch');
});

test('M33 F3 every API-error marker form on any assistant event fails the call', async () => {
  const markers = [['is_api_error_message', 'true'], ['is_api_error_message', 1], ['is_api_error_message', true],
    ['api_error', 'no_response'], ['api_error', {}], ['api_error', 0], ['api_error_code', 'overloaded_error'],
    ['api_error_code', 529], ['aborted', true], ['aborted', 'true'], ['aborted', 0],
    ['api_error_status', 529], ['api_error_status', '529'], ['api_error_status', false], ['api_error_status', 0]];
  for (const [field, value] of markers) {
    for (const [where, events] of [
      ['only assistant', [initEvent(), assistantEvent(REQUESTED, { [field]: value }), resultEvent()]],
      ['second assistant', [initEvent(), assistantEvent(), assistantEvent(REQUESTED, { [field]: value }), resultEvent()]],
    ]) {
      const name = `${field}=${JSON.stringify(value)} on the ${where}`;
      const { error, answer, recorded, calls } = await throughRetry(events);
      assert.equal(answer, undefined, name);
      assert.equal(error?.code, 'model_unavailable', name);
      assert.equal(recorded[0].attestation, 'unattested', `${name}: a marker is not identity evidence`);
      assert.equal(error.providerClass, field === 'api_error_status' && value === 529 ? 'overloaded' : 'unknown', name);
      assert.equal(calls, 2, `${name}: a retryable class keeps its one retry`);
    }
  }
  // Only null or false is "no marker": these assistants answer and attest.
  const quiet = { is_api_error_message: false, api_error: null, api_error_code: false, aborted: false, api_error_status: null };
  const { error, answer, recorded } = await throughRetry([initEvent(), assistantEvent(REQUESTED, quiet), resultEvent()]);
  assert.equal(error, null);
  assert.deepEqual(answer, { value: 1 });
  assert.equal(recorded[0].attestation, 'attested');
});

test('M33 F3 an assistant-level api_error_status is a marker and, with no enum value, a class', async () => {
  const { error, answer, recorded, calls } = await throughRetry([initEvent(),
    assistantEvent(REQUESTED, { api_error_status: 429 }), resultEvent()]);
  assert.equal(answer, undefined);
  assert.equal(error?.code, 'model_unavailable');
  assert.equal(error.providerClass, 'rate_limit');
  assert.equal(recorded[0].providerClass, 'rate_limit');
  assert.equal(recorded[0].attestation, 'unattested');
  assert.equal(recorded[0].apiErrorStatus, null, 'apiErrorStatus stays the result\'s own typed status');
  assert.equal(calls, 1, 'rate_limit is never asked again');
});

test('M33 F3 with no enum value the integer api_error_status decides the class, and a stop class is never retried', async () => {
  const statusOnly = assistantEvent('<synthetic>', { is_api_error_message: true });
  const cases = [[400, 'invalid_request', 1], [401, 'auth', 1], [403, 'auth', 1], [402, 'billing', 1],
    [404, 'model_not_found', 1], [429, 'rate_limit', 1], [529, 'overloaded', 2], [500, 'server_error', 2],
    [503, 'server_error', 2], [599, 'server_error', 2], [418, 'unknown', 2], [499, 'unknown', 2], [600, 'unknown', 2],
    ['429', 'unknown', 2], [429.5, 'unknown', 2]];
  for (const [status, providerClass, attempts] of cases) {
    const { error, recorded, calls } = await throughRetry([initEvent(), statusOnly, failedResult(status)], { exit: 1 });
    assert.equal(error?.code, 'model_unavailable', String(status));
    assert.equal(error.providerClass, providerClass, String(status));
    assert.deepEqual(recorded.map((m) => m.providerClass), Array(attempts).fill(providerClass), String(status));
    assert.equal(recorded[0].attestation, 'unattested', String(status));
    assert.equal(calls, attempts, String(status));
  }
});

test('M33 F3 a stop class in any observed value wins in the fixed order; other disagreeing values are unknown', async () => {
  const cases = [
    // The review repro: rate_limit beside overloaded, and a 429 result. Asked once.
    [[syntheticError('rate_limit'), syntheticError('overloaded')], 429, 'rate_limit', 1],
    [[syntheticError('overloaded'), syntheticError('rate_limit')], null, 'rate_limit', 1],
    [[syntheticError('rate_limit'), syntheticError('billing_error')], null, 'billing', 1],
    [[syntheticError('invalid_request'), syntheticError('authentication_failed')], null, 'auth', 1],
    [[syntheticError('model_not_found'), syntheticError('invalid_request')], null, 'model_not_found', 1],
    [[syntheticError('invalid_request'), syntheticError('max_output_tokens')], null, 'invalid_request', 1],
    [[syntheticError('overloaded')], 401, 'auth', 1],
    [[syntheticError('overloaded', { api_error_status: 402 })], 529, 'billing', 1],
    [[syntheticError('rate_limit'), assistantEvent('claude-opus-5')], 429, 'identity_mismatch', 1],
    // No stop class: the enum decides, and disagreeing enum values are unknown.
    [[syntheticError('overloaded'), syntheticError('server_error')], null, 'unknown', 2],
    [[syntheticError('overloaded')], 500, 'overloaded', 2],
    [[syntheticError('server_error'), syntheticError('server_error')], 529, 'server_error', 2],
    // No enum value: disagreeing statuses are unknown.
    [[assistantEvent('<synthetic>', { is_api_error_message: true, api_error_status: 529 })], 500, 'unknown', 2],
  ];
  for (const [assistants, status, providerClass, attempts] of cases) {
    const { error, recorded, calls } = await throughRetry([initEvent(), ...assistants, failedResult(status)], { exit: 1 });
    const name = `${JSON.stringify(assistants.map((a) => a.error ?? a.message.model))} status ${status}`;
    assert.equal(error.providerClass, providerClass, name);
    assert.deepEqual(recorded.map((m) => m.providerClass), Array(attempts).fill(providerClass), name);
    assert.equal(calls, attempts, name);
  }
});

test('M33 F3 an alias answer is unattested only when every top-level assistant names the one init model', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'sonah-m33-f3-'));
  try {
    // The review repro: alias `sonnet`, init resolves one model, the only answer names another family.
    const identity = { backend: 'claude-cli', model: 'sonnet' };
    const fake = fakeClaude([initEvent(), assistantEvent('claude-haiku-4-5'), resultEvent()]), recorded = [];
    const cache = createAnswerCache(dir, identity);
    const judge = memoizeJudge(withTransportRetry(createReviewJudge({ config: identity, env: {}, spawnProcess: fake.spawnProcess,
      onResult: (m) => recorded.push(m) })), cache);
    let error = null;
    try { await judge(request); } catch (caught) { error = caught; }
    assert.equal(error?.code, 'model_unavailable');
    assert.equal(error.providerClass, 'identity_mismatch');
    assert.equal(recorded[0].attestation, 'mismatch');
    assert.equal(recorded[0].configuredModel, REQUESTED);
    assert.deepEqual(recorded[0].servedModels, ['claude-haiku-4-5']);
    assert.equal(fake.capture.calls, 1);
    assert.equal(await cache.get(request), null, 'D60 never stores it');
    assertNoLeak(error, recorded);
  } finally { await rm(dir, { recursive: true, force: true }); }
  const alias = { config: { backend: 'claude-cli', model: 'sonnet' } };
  // No identity evidence, but no proof either: each fails, unattested, and keeps its one retry.
  for (const events of [[resultEvent()], [assistantEvent(), resultEvent()], [initEvent(), resultEvent()],
    [initEvent(), initEvent(), assistantEvent(), resultEvent()], [initEvent(undefined, { model: null }), assistantEvent(null), resultEvent()]]) {
    const name = JSON.stringify(events.map((e) => e.subtype ?? e.type));
    const { error, answer, recorded, calls } = await throughRetry(events, alias);
    assert.equal(answer, undefined, name);
    assert.equal(error?.code, 'model_unavailable', name);
    assert.equal(error.providerClass, 'unknown', name);
    assert.equal(recorded[0].attestation, 'unattested', name);
    assert.equal(calls, 2, name);
  }
  // A second top-level answer, or a second init, naming another model is an identity mismatch.
  for (const events of [[initEvent(), assistantEvent(), assistantEvent('claude-opus-5'), resultEvent()],
    [initEvent(), initEvent('claude-opus-5'), assistantEvent(), resultEvent()]]) {
    const { error, recorded, calls } = await throughRetry(events, alias);
    assert.equal(error?.providerClass, 'identity_mismatch');
    assert.equal(recorded[0].attestation, 'mismatch');
    assert.equal(calls, 1);
  }
  // Every condition holds: the answer is returned, unattested, with the init's model recorded.
  const { error, answer, recorded } = await throughRetry([initEvent(), assistantEvent(), assistantEvent(), resultEvent()], alias);
  assert.equal(error, null);
  assert.deepEqual(answer, { value: 1 });
  assert.equal(recorded[0].attestation, 'unattested');
  assert.equal(recorded[0].providerClass, null);
  assert.equal(recorded[0].configuredModel, REQUESTED);
  assert.deepEqual(recorded[0].servedModels, [REQUESTED]);
});

test('M33 F3 attestation is mismatch only for identity failures; every other failure is unattested', async () => {
  const served = [initEvent(), assistantEvent()];
  const cases = [
    ['exit nonzero', [...served, resultEvent()], { exit: 1 }, 'model_unavailable'],
    ['no result', served, {}, 'model_unavailable'],
    ['invalid JSON', [...served, resultEvent({ result: `no json ${M33_LEAK}` })], {}, 'model_response_invalid'],
    ['synthetic error', [initEvent(), syntheticError('overloaded'), failedResult(529)], { exit: 1 }, 'model_unavailable'],
    ['error result', [...served, failedResult()], {}, 'model_unavailable'],
    ['tool use', [initEvent(), assistantEvent(REQUESTED, { message: { model: REQUESTED, content: [{ type: 'tool_use' }] } }),
      resultEvent()], {}, 'model_tool_use'],
  ];
  for (const [name, events, options, code] of cases) {
    const { error, recorded } = await throughRetry(events, options);
    assert.equal(error?.code, code, name);
    assert.ok(recorded.length >= 1, name);
    for (const m of recorded) assert.equal(m.attestation, 'unattested', name);
    assert.notEqual(error.providerClass, 'identity_mismatch', name);
  }
  // A process that could not start, or that timed out, proves nothing about identity.
  const config = attested;
  for (const [name, spawnOptions, judgeOptions, code] of [['spawn failed', { throws: true }, {}, 'model_unavailable'],
    ['timeout', { hang: true }, { timeoutMs: 25 }, 'model_timeout']]) {
    const recorded = [];
    const error = await failureOf(createReviewJudge({ config, spawnProcess: fakeSpawn(spawnOptions),
      onResult: (m) => recorded.push(m), ...judgeOptions }));
    assert.equal(error.code, code, name);
    assert.equal(recorded[0].attestation, 'unattested', name);
  }
  // A stop does not hide identity evidence already on the stream: that is still a mismatch, never retried.
  let spawned = 0;
  const partial = fakeSpawn({ stdout: streamOf(initEvent('claude-opus-5')), hang: true });
  const recorded = [];
  const error = await failureOf(withTransportRetry(createReviewJudge({ config, timeoutMs: 25,
    spawnProcess: (...args) => { spawned++; return partial(...args); }, onResult: (m) => recorded.push(m) })));
  assert.equal(error.code, 'model_timeout');
  assert.equal(error.providerClass, 'identity_mismatch');
  assert.equal(recorded[0].attestation, 'mismatch');
  assert.equal(spawned, 1);
  assertNoLeak(error, recorded);
});

test('M33 F3 a successful full-id call is attested, and only that', async () => {
  const { error, answer, recorded } = await throughRetry([initEvent(), assistantEvent(), resultEvent()]);
  assert.equal(error, null);
  assert.deepEqual(answer, { value: 1 });
  assert.equal(recorded[0].attestation, 'attested');
  assert.equal(recorded[0].providerClass, null);
});

/** A fake `claude` that prints `events` and then stalls — no result, no exit — until it is stopped;
 *  `tail` is written after the events, in its own chunk (an output-limit case). Counts calls. */
function stalledClaude(events, { tail = '' } = {}) {
  const capture = { calls: 0, signals: [] };
  const spawnProcess = () => {
    capture.calls++;
    const child = new EventEmitter();
    child.stdin = new PassThrough(); child.stdout = new PassThrough(); child.stderr = new PassThrough();
    let closed = false;
    child.kill = (signal = 'SIGTERM') => {
      capture.signals.push(signal);
      setImmediate(() => { if (!closed) { closed = true; child.emit('close', null, signal); } });
      return true;
    };
    child.stdin.on('finish', () => setImmediate(() => {
      child.stderr.write(M33_LEAK);
      child.stdout.write(streamOf(...events));
      if (tail) setImmediate(() => child.stdout.write(tail));
    }));
    return child;
  };
  return { spawnProcess, capture };
}
async function stoppedThroughRetry(events, { tail = '', timeoutMs = 30, maxOutputBytes } = {}) {
  const fake = stalledClaude(events, { tail }), recorded = [];
  const judge = withTransportRetry(createReviewJudge({ config: attested, env: { PATH: '/bin' }, spawnProcess: fake.spawnProcess,
    timeoutMs, ...(maxOutputBytes ? { maxOutputBytes } : {}), onResult: (m) => recorded.push(m) }));
  let error = null;
  try { await judge(request); } catch (caught) { error = caught; }
  assert.ok(error, 'the stopped call fails');
  assertNoLeak(error, recorded);
  return { error, recorded, calls: fake.capture.calls };
}

test('G1 a call the transport stops keeps a non-retryable class already on its stream: never retried, runners stop', async () => {
  const cases = [
    [[syntheticError('rate_limit')], 'rate_limit'],
    [[syntheticError('authentication_failed')], 'auth'],
    [[assistantEvent('<synthetic>', { is_api_error_message: true, api_error_status: 401 })], 'auth'],
    [[syntheticError('overloaded'), syntheticError('billing_error')], 'billing'],
    [[assistantEvent('<synthetic>', { is_api_error_message: true, api_error_status: 404 })], 'model_not_found'],
  ];
  for (const [assistants, providerClass] of cases) {
    const name = `${JSON.stringify(assistants.map((a) => a.error ?? a.api_error_status))}`;
    // Stopped by the timeout.
    const timedOut = await stoppedThroughRetry([initEvent(), ...assistants]);
    assert.equal(timedOut.error.code, 'model_timeout', name);
    assert.equal(timedOut.error.transportClass, 'timeout', name);
    assert.equal(timedOut.error.providerClass, providerClass, name);
    assert.equal(timedOut.calls, 1, `${name}: a stop class is never asked again`);
    assert.deepEqual(timedOut.recorded.map((m) => [m.code, m.transportClass, m.providerClass, m.attestation]),
      [['model_timeout', 'timeout', providerClass, 'unattested']], name);
    // Stopped by the output ceiling, after the typed frames arrived.
    const frames = [initEvent(), ...assistants];
    const limited = await stoppedThroughRetry(frames, { tail: 'x'.repeat(4096), timeoutMs: 60_000,
      maxOutputBytes: Buffer.byteLength(streamOf(...frames)) + 16 });
    assert.equal(limited.error.code, 'model_output_limit', name);
    assert.equal(limited.error.transportClass, 'output_limit', name);
    assert.equal(limited.error.providerClass, providerClass, name);
    assert.equal(limited.calls, 1, name);
    assert.deepEqual(limited.recorded.map((m) => m.providerClass), [providerClass], name);
  }
  // Near misses: a stopped call with only a retryable class, or none, carries no class and a timeout is
  // asked once more, exactly as before.
  for (const assistants of [[syntheticError('overloaded')], [syntheticError('server_error')], [assistantEvent()], []]) {
    const { error, recorded, calls } = await stoppedThroughRetry([initEvent(), ...assistants]);
    const name = JSON.stringify(assistants.map((a) => a.error ?? a.message.model));
    assert.equal(error.code, 'model_timeout', name);
    assert.equal(error.providerClass, undefined, name);
    assert.deepEqual(recorded.map((m) => m.providerClass), [null, null], name);
    assert.equal(calls, 2, name);
  }
  // Identity evidence on a stopped stream is still the call's class.
  const mismatch = await stoppedThroughRetry([initEvent('claude-opus-5'), syntheticError('rate_limit')]);
  assert.equal(mismatch.error.providerClass, 'identity_mismatch');
  assert.equal(mismatch.calls, 1);
});
