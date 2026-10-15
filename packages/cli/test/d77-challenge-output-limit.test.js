// D77 (H). The checker's output-token limit: one frozen number (CHALLENGE_MAX_OUTPUT_TOKENS) a challenge call carries
// to the claude CLI as its own CLAUDE_CODE_MAX_OUTPUT_TOKENS, never a narrative call. A cost guard against a reply that
// runs on to the model's ceiling of about 128k output tokens, not a judgment rule: it moves no argv and so no answer
// key, and a reply that hits it ends in the transport's existing closed failure, never in a cut answer accepted.
//
// Every child, stream and request here is invented; every spawn is a fake. No model, no network.
import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CHALLENGE_MAX_OUTPUT_TOKENS, REVIEW_API_MAX_TOKENS, REVIEW_TRANSPORT_VERSION, createReviewJudge, isChallengeRequest,
  reviewTransportArguments, withTransportRetry } from '../src/review-judge.js';
import { answerKey, answerStorable, createAnswerCache, memoizeJudge } from '../src/answer-cache.js';
import { CHALLENGE_PROFILE, CHALLENGE_SCHEMA } from '../../evidence/src/challenge.js';
import { JUDGE_FAILURE_CODES, REASKABLE_JUDGE_CODES, RETRYABLE_JUDGE_CODES } from '../../evidence/src/ledger.js';

const LEAK = 'D77_LEAK_SENTINEL sk-ant-FAKE-1357924680';
const MODEL = 'claude-synthetic-5-5';
const CONFIG = { backend: 'claude-cli', model: MODEL };
const VARIABLE = 'CLAUDE_CODE_MAX_OUTPUT_TOKENS';
const bytes = { system: 'SYNTHETIC_SYSTEM', prompt: 'SYNTHETIC_PROMPT' };
const narrative = { ...bytes, label: 'narrative:w1', window: { index: 0 }, evidencePrompt: 'SYNTHETIC_EVIDENCE' };
// What challengeItems (evidence/src/challenge.js) sends: a batch, and a re-ask.
const batch = { ...bytes, label: 'challenge:w1:b1:p1', schema: CHALLENGE_SCHEMA, challenge: { items: [], pass: 1, batchIndex: 0 } };
const reask = { ...bytes, label: 'challenge:w1:reask:p2', schema: CHALLENGE_SCHEMA,
  challenge: { items: [], pass: 2, batchIndex: null, reask: true } };

const init = { type: 'system', subtype: 'init', model: MODEL, cwd: `/synthetic/${LEAK}`, session_id: 'synthetic' };
const assistant = (text, extra = {}) => ({ type: 'assistant', parent_tool_use_id: null,
  message: { model: MODEL, role: 'assistant', content: [{ type: 'text', text }] }, ...extra });
/** The CLI's own message when a reply hit the limit and its continuations are spent (2.1.278 stream schema). */
const cutError = { type: 'assistant', parent_tool_use_id: null, error: 'max_output_tokens', is_api_error_message: true,
  message: { model: '<synthetic>', content: [{ type: 'text', text: `API Error: ${LEAK} exceeded the output token maximum` }] } };
const result = (reply, extra = {}) => ({ type: 'result', subtype: 'success', is_error: false, api_error_status: null,
  result: reply, num_turns: 1, stop_reason: 'end_turn', usage: { input_tokens: 1, output_tokens: 1 }, errors: [LEAK], ...extra });
const failed = (extra = {}) => result(`API Error: ${LEAK}`, { is_error: true, subtype: 'error_during_execution', ...extra });

/** A fake `claude`: records every spawn's argv and environment, prints `events`, writes the LEAK to stderr, exits `exit`. */
function fakeClaude(events, { exit = 0 } = {}) {
  const capture = { calls: 0, spawns: [] };
  const spawnProcess = (command, args, options) => {
    capture.calls++;
    capture.spawns.push({ command, args, env: options.env });
    const child = new EventEmitter();
    child.stdin = new PassThrough(); child.stdout = new PassThrough(); child.stderr = new PassThrough();
    let closed = false;
    const close = (code) => { if (!closed) { closed = true; child.emit('close', code, null); } };
    child.kill = () => { setImmediate(() => close(null)); return true; };
    child.stdin.resume();
    child.stdin.on('end', () => setImmediate(() => {
      child.stderr.write(LEAK);
      child.stdout.write(events.map((event) => `${JSON.stringify(event)}\n`).join(''));
      setImmediate(() => close(exit));
    }));
    return child;
  };
  return { spawnProcess, capture };
}

const noLeak = (...values) => {
  for (const value of values) {
    const text = JSON.stringify(value, Object.getOwnPropertyNames(value ?? {}));
    assert.ok(!text.includes('D77_LEAK') && !text.includes('sk-ant'), `transport text recorded: ${text.slice(0, 120)}`);
  }
};

// The person's own setting, which must never reach a call: the allowlist drops it like every inherited Claude option.
const PARENT_ENV = { HOME: '/synthetic', PATH: '/bin', [VARIABLE]: '99', CLAUDE_CODE_MAX_RETRIES: '99' };
const NARRATIVE_ENV = { HOME: '/synthetic', PATH: '/bin', CLAUDE_CODE_DISABLE_TERMINAL_TITLE: '1',
  CLAUDE_CODE_DISABLE_REFUSAL_FALLBACK: '1', CLAUDE_CODE_DISABLE_AUTO_MEMORY: '1' };

test('D77 the limit is one frozen number, derived from the 16-item batch bound and the model\'s ceiling', () => {
  assert.equal(CHALLENGE_MAX_OUTPUT_TOKENS, 32_768);
  assert.ok(Number.isSafeInteger(CHALLENGE_MAX_OUTPUT_TOKENS));
  // What the constant's comment states: a readable reply to a batch of at most 16 items stays far below 16,384 output
  // tokens; the model's own ceiling is 128,000, where a reply that runs on stops.
  assert.equal(CHALLENGE_PROFILE.maxItemsPerBatch, 16, 'the batch bound');
  assert.equal(CHALLENGE_MAX_OUTPUT_TOKENS, 2 * 16_384, 'twice what a readable reply to a full batch stays under');
  assert.ok(CHALLENGE_MAX_OUTPUT_TOKENS < 128_000, 'below the ceiling a runaway reaches, or the setting changes nothing');
  // Four attempts at the limit (the CLI's cut and its three continuations) cost about what one runaway does.
  assert.equal(4 * CHALLENGE_MAX_OUTPUT_TOKENS, 131_072);
});

test('D77 a challenge request is told by its challenge record, never by its label', () => {
  for (const request of [batch, reask, { ...bytes, challenge: {} }]) assert.equal(isChallengeRequest(request), true);
  for (const request of [narrative, { ...bytes, label: 'challenge:w1:b1:p1' }, { ...bytes, challenge: null },
    { ...bytes, challenge: true }, { ...bytes, challenge: [] }, { ...bytes, challenge: 'challenge' }, null, undefined, 'x'])
    assert.equal(isChallengeRequest(request), false, JSON.stringify(request));
});

test('D77 a challenge call carries the limit in its environment, a narrative call does not, and the argv is the same', async () => {
  const fake = fakeClaude([init, assistant('{"votes":[]}'), result('{"votes":[]}')]);
  const judge = createReviewJudge({ config: CONFIG, env: PARENT_ENV, spawnProcess: fake.spawnProcess });
  for (const request of [narrative, batch, reask]) assert.deepEqual(await judge(request), { votes: [] });
  const [first, second, third] = fake.capture.spawns;
  assert.deepEqual(first.env, NARRATIVE_ENV, 'a narrative call: the person\'s own setting dropped, no limit');
  assert.deepEqual(second.env, { ...NARRATIVE_ENV, [VARIABLE]: String(CHALLENGE_MAX_OUTPUT_TOKENS) }, 'a batch');
  assert.deepEqual(third.env, second.env, 'a re-ask');
  assert.equal(second.env[VARIABLE], '32768');
  assert.deepEqual(second.args, first.args, 'the limit is never an argument');
  assert.deepEqual(first.args, reviewTransportArguments({ ...CONFIG, system: bytes.system }).argv);
  assert.ok(!first.args.includes('32768') && !JSON.stringify(first.args).includes(VARIABLE));
});

test('D77 the answer key does not move: the limit is in no argument the key binds, and the version stays /3', () => {
  const identity = { backend: 'claude-cli', model: MODEL };
  const plain = answerKey(bytes, identity);
  assert.equal(answerKey(narrative, identity), plain);
  assert.equal(answerKey(batch, identity), plain, 'the same bytes, asked as a challenge, are the same question');
  assert.equal(answerKey(reask, identity), plain);
  assert.deepEqual(reviewTransportArguments({ ...identity, system: bytes.system }),
    reviewTransportArguments({ ...identity, system: bytes.system, challenge: batch.challenge }));
  assert.equal(REVIEW_TRANSPORT_VERSION, 'sonah.review-transport/3');
});

test('D77 a reply the CLI reports cut at the limit fails model_response_incomplete: not retried, not re-asked, never stored', async (t) => {
  const directory = join(await mkdtemp(join(tmpdir(), 'sonah-d77-')), 'answers');
  t.after(() => rm(join(directory, '..'), { recursive: true, force: true }));
  // The CLI's shape when its continuations are spent: the cut text, its own error message, a failed result, exit 1 —
  // and the same enum beside a result that still says success, exit 0: the typed error fails the call either way.
  for (const [events, exit] of [[[init, assistant(`{"votes":[{"key":"k1",${LEAK}`), cutError, failed()], 1],
    [[init, assistant(`{"votes":[{"key":"k1",${LEAK}`), cutError, result(`{"votes":[]} ${LEAK}`)], 0]]) {
    const fake = fakeClaude(events, { exit }), recorded = [];
    const cache = createAnswerCache(directory, { backend: 'claude-cli', model: MODEL });
    const judge = memoizeJudge(withTransportRetry(createReviewJudge({ config: CONFIG, env: PARENT_ENV,
      spawnProcess: fake.spawnProcess, onResult: (m) => recorded.push(m) })), cache);
    let error = null;
    try { await judge(batch); } catch (caught) { error = caught; }
    assert.ok(error, `exit ${exit}: the call failed`);
    assert.equal(error.code, 'model_response_incomplete');
    assert.equal(error.message, 'model_response_incomplete', 'the message is the closed code and nothing else');
    assert.equal(error.providerClass, 'output_tokens');
    assert.equal(fake.capture.calls, 1, 'one attempt: the transport does not retry it');
    assert.equal(fake.capture.spawns[0].env[VARIABLE], '32768');
    assert.equal(recorded.length, 1);
    assert.equal(recorded[0].ok, false);
    assert.equal(recorded[0].providerClass, 'output_tokens');
    assert.deepEqual(judge.answers, { calls: 1, reused: 0 });
    await assert.rejects(readdir(directory), { code: 'ENOENT' }, 'nothing was stored, not even the directory');
    noLeak(error, recorded[0]);
  }
  assert.ok(JUDGE_FAILURE_CODES.includes('model_response_incomplete'));
  assert.ok(!RETRYABLE_JUDGE_CODES.includes('model_response_incomplete'), 'the existing rule: an identical call is not asked');
  assert.ok(!REASKABLE_JUDGE_CODES.includes('model_response_incomplete'), 'and the challenge takes its slots as checks that did not run');
});

test('D77 a continuation the CLI made after a cut is read like any reply: whole it answers, a fragment never passes as votes', async () => {
  // 2.1.296 (byte search): a reply cut at the limit is withheld while the CLI asks the model to continue (a meta user
  // turn), so the stream the transport reads carries the head, the nudge and the continuation, and `result` is the
  // continuation's last text block. The transport cannot tell this from any other reply; the code that reads the
  // answer can: only a JSON object with the batch's own `votes` is a challenge answer.
  const head = `{"votes":[{"key":"k1","verdict":"upheld","receipts":[{"quote":"${LEAK}`;
  const nudge = { type: 'user', message: { role: 'user', content: 'Your response above was cut off mid-stream.' }, isMeta: true };
  const stream = (tail) => [init, assistant(head), nudge, assistant(tail), result(tail, { num_turns: 2,
    usage: { input_tokens: 1, output_tokens: CHALLENGE_MAX_OUTPUT_TOKENS + 184 } })];
  const through = async (tail) => {
    const fake = fakeClaude(stream(tail)), recorded = [];
    const judge = createReviewJudge({ config: CONFIG, env: PARENT_ENV, spawnProcess: fake.spawnProcess, onResult: (m) => recorded.push(m) });
    try { return { answer: await judge(batch), recorded }; } catch (error) { return { error, recorded }; }
  };
  // The model answered from the start, whole: a complete reply, accepted as one (as a runaway that then answered is).
  const whole = await through('{"votes":[]}');
  assert.deepEqual(whole.answer, { votes: [] });
  assert.equal(whole.recorded[0].replyShape.numTurns, 2);
  assert.equal(whole.recorded[0].usage.output_tokens, CHALLENGE_MAX_OUTPUT_TOKENS + 184);
  // It resumed mid-stream: the tail has no object — unreadable, the transport's retryable code, then the re-ask.
  const tail = await through(`${LEAK}"}]}]}`);
  assert.equal(tail.error.code, 'model_response_invalid');
  assert.ok(RETRYABLE_JUDGE_CODES.includes('model_response_invalid') && REASKABLE_JUDGE_CODES.includes('model_response_invalid'));
  // It resumed inside a vote: the tail parses as an object, which is not the batch's answer and is never stored.
  const inner = await through(`"${LEAK}"}]},{"key":"k2","verdict":"refuted"}]}`);
  assert.deepEqual(inner.answer, { key: 'k2', verdict: 'refuted' });
  assert.equal(answerStorable(batch, inner.answer), false, 'no `votes`: the challenge takes no vote from it and the cache keeps nothing');
  noLeak(whole.recorded[0], tail.error, tail.recorded[0], inner.recorded[0]);
});

test('D77 codex-cli and anthropic-api are unchanged by a challenge request', async () => {
  // Codex: the installed CLI has no model output-token setting (byte search), and its environment never carried one.
  const codexEvents = [{ type: 'thread.started', thread_id: 'synthetic' }, { type: 'turn.started' },
    { type: 'item.completed', item: { id: 'answer', type: 'agent_message', text: '{"votes":[]}' } },
    { type: 'turn.completed', usage: { input_tokens: 2, output_tokens: 1 } }];
  const codex = fakeClaude(codexEvents);
  const codexJudge = createReviewJudge({ config: { backend: 'codex-cli', model: 'gpt-synthetic' }, env: PARENT_ENV,
    spawnProcess: codex.spawnProcess });
  assert.deepEqual(await codexJudge(batch), { votes: [] });
  assert.deepEqual(await codexJudge(narrative), { votes: [] });
  for (const spawn of codex.capture.spawns) {
    assert.equal(Object.hasOwn(spawn.env, VARIABLE), false);
    assert.deepEqual(spawn.args, reviewTransportArguments({ backend: 'codex-cli', model: 'gpt-synthetic', system: bytes.system }).argv);
  }
  // The API: REVIEW_API_MAX_TOKENS on every call, challenge or narrative, as before — in the body, and so in the key.
  const bodies = [];
  const api = createReviewJudge({ config: { backend: 'anthropic-api', model: 'claude-synthetic-5-5' }, env: { ANTHROPIC_API_KEY: 'synthetic' },
    fetchImpl: async (url, options) => { bodies.push(JSON.parse(options.body));
      return new Response(JSON.stringify({ stop_reason: 'end_turn', content: [{ type: 'text', text: '{"votes":[]}' }] })); } });
  assert.deepEqual(await api(batch), { votes: [] });
  assert.deepEqual(await api(narrative), { votes: [] });
  assert.deepEqual(bodies.map((body) => body.max_tokens), [REVIEW_API_MAX_TOKENS, REVIEW_API_MAX_TOKENS]);
  assert.equal(REVIEW_API_MAX_TOKENS, 16_384);
});
