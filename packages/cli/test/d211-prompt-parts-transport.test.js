// D211 (0.3.0-beta.13): the claude-cli transport sends a request whose prompt is in parts (evidence prompt-parts.js) as
// one stream-json user message, one text block per part, the first carrying the one cache marker; only such a request's
// argv and answer key move. An agent request says its reply has begun at its first assistant line. A request in parts
// that the provider refuses as invalid is sent once more as one string. And (e), with the installed `claude` against a
// local fake Messages API (no login, no model, no network past this machine), an agent run of 30 turns and more never
// sends more than four cache markers. Every byte is synthetic.
import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtemp, mkdir, readdir, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PARTS_DROPPED, PROMPT_PARTS_REFUSED_CLASS, PROMPT_PART_CACHE_CONTROL, REVIEW_AGENT_TRANSPORT_VERSION,
  REVIEW_TRANSPORT_VERSION, createReviewJudge, resentWhole, reviewAgentCliArgs, reviewCliArgs, withTransportRetry }
  from '../src/review-judge.js';
import { answerKey, createAnswerCache, memoizeJudge } from '../src/answer-cache.js';
import { boundedJudge } from '../src/session-review.js';
import { createReviewBudget } from '../src/review-budget.js';
import { REPLY_BEGUN } from '../../evidence/src/challenge.js';
import { ANSWER_REPLAYED, staggerSharedParts } from '../../evidence/src/prompt-parts.js';
import { PROMPT_PARTS_DROPPED } from '../../evidence/src/ledger.js';
import { MODEL, SCHEMA, ANSWER, agentEvents } from './agent-transport-fixture.js';

const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC';
const SHARED = 'SYNTHETIC_D211 the shared first part\n\n';
const PROMPT = `${SHARED}SYNTHETIC_D211 the rest`;
const session = { system: 'SYNTHETIC_D211_SYSTEM', prompt: PROMPT };
const inParts = { ...session, parts: [SHARED.length] };
const tick = (ms = 0) => new Promise((resolve) => setTimeout(resolve, ms));
const markersIn = (value) => (Array.isArray(value) ? value.reduce((n, v) => n + markersIn(v), 0)
  : value !== null && typeof value === 'object' ? Object.entries(value)
    .reduce((n, [key, v]) => n + (key === 'cache_control' ? 1 : markersIn(v)), 0) : 0);

const sessionEvents = (answer = '{"value":"ok"}') => [{ type: 'system', subtype: 'init', model: MODEL },
  { type: 'assistant', parent_tool_use_id: null, message: { model: MODEL, content: [] } },
  { type: 'result', subtype: 'success', is_error: false, result: answer, usage: { output_tokens: 1 } }];
/** Claude Code 2.1.311's stream for a request the API refused with HTTP 400 (a fake API, captured 2026-11-05): the
 *  assistant error line and an error result, both with the typed `api_error_status`, then exit 1. */
const refusedEvents = [{ type: 'system', subtype: 'init', model: MODEL },
  { type: 'assistant', parent_tool_use_id: null, error: 'unknown', is_api_error_message: true, api_error_status: 400,
    message: { model: '<synthetic>', content: [] } },
  { type: 'result', subtype: 'success', is_error: true, api_error_status: 400, result: 'SYNTHETIC refused' }];

/** A fake spawn: `script({ args, stdin })` gives `{ events, exit }`; each line is written a tick apart, and `log` gets
 *  `line <type>` just before it is written. `seen` gets each call's argv and stdin. */
function fakeSpawn(script, { seen = [], log = [] } = {}) {
  return (command, args) => {
    const child = new EventEmitter();
    child.stdin = new PassThrough(); child.stdout = new PassThrough(); child.stderr = new PassThrough();
    child.kill = () => {};
    let stdin = '';
    child.stdin.on('data', (d) => { stdin += d; });
    child.stdin.on('finish', () => setImmediate(async () => {
      seen.push({ args, stdin });
      const { events, exit = 0 } = script({ args, stdin });
      for (const event of events) {
        log.push(`line ${event.type}`);
        child.stdout.write(`${JSON.stringify(event)}\n`);
        await tick();
      }
      child.emit('close', exit);
    }));
    return child;
  };
}
const judgeWith = (spawnProcess, extra = {}) => createReviewJudge({ config: { backend: 'claude-cli', model: MODEL },
  env: { HOME: '/synthetic', PATH: '/bin' }, spawnProcess, ...extra });
const userMessage = (stdin) => {
  assert.ok(stdin.endsWith('\n') && stdin.indexOf('\n') === stdin.length - 1, 'one stdin line');
  const line = JSON.parse(stdin);
  assert.equal(line.type, 'user');
  assert.equal(line.message.role, 'user');
  return line.message.content;
};

// ---- (c) what the transport sends -----------------------------------------------------------------------------------

test('D211 (c): a request in parts is one stream-json user message — its text blocks join to the prompt, one cache '
  + 'marker on the first, images after; a request without is sent as before', async () => {
  const seen = [];
  const judge = judgeWith(fakeSpawn(() => ({ events: sessionEvents() }), { seen }));
  const image = { mediaType: 'image/png', data: PNG };
  for (const request of [inParts, session, { ...inParts, images: [image] }, { ...session, images: [image] },
    { ...inParts, parts: [PROMPT.length] }]) assert.deepEqual(await judge(request), { value: 'ok' });
  const [parted, whole, partedImage, wholeImage, malformed] = seen;
  assert.deepEqual(parted.args, reviewCliArgs({ system: session.system, model: MODEL, parts: true }));
  assert.equal(parted.args.filter((a) => a === '--input-format').length, 1);
  assert.equal(parted.args[parted.args.indexOf('--input-format') + 1], 'stream-json');
  assert.deepEqual(userMessage(parted.stdin), [
    { type: 'text', text: SHARED, cache_control: { type: 'ephemeral' } },
    { type: 'text', text: 'SYNTHETIC_D211 the rest' }]);
  assert.deepEqual(PROMPT_PART_CACHE_CONTROL, { type: 'ephemeral' });
  // A request without parts or images: the argv and stdin of before, byte for byte.
  assert.deepEqual(whole.args, reviewCliArgs({ system: session.system, model: MODEL }));
  assert.ok(!whole.args.includes('--input-format'));
  assert.equal(whole.stdin, PROMPT);
  // With images: the parts, then each image after its line, as before; the argv is the images' argv.
  const content = userMessage(partedImage.stdin);
  assert.equal(markersIn(content), 1);
  assert.deepEqual(content.map((block) => block.type), ['text', 'text', 'text', 'image']);
  assert.equal(content.slice(0, 2).map((block) => block.text).join(''), PROMPT);
  assert.equal(content[2].text, 'Image 1:');
  assert.deepEqual(partedImage.args, wholeImage.args);
  assert.deepEqual(userMessage(wholeImage.stdin)[0], { type: 'text', text: PROMPT }, 'an image request as before');
  // Cuts the transport cannot send as they are: the prompt whole, as before.
  assert.deepEqual(malformed.args, whole.args);
  assert.equal(malformed.stdin, PROMPT);
});

test('D211 (c): an agent request in parts gets --input-format stream-json after --verbose and its message on stdin; one '
  + 'without keeps its argv', async () => {
  const root = await realpath(tmpdir());
  const seen = [];
  const judge = judgeWith(fakeSpawn(() => ({ events: agentEvents(root) }), { seen }));
  const agentRequest = { ...session, schema: SCHEMA, agent: { root, maxTurns: 3 } };
  assert.deepEqual(await judge({ ...agentRequest, parts: [SHARED.length] }), ANSWER);
  assert.deepEqual(await judge(agentRequest), ANSWER);
  const [parted, whole] = seen;
  const plainArgs = reviewAgentCliArgs({ system: session.system, model: MODEL, agent: agentRequest.agent, schema: SCHEMA });
  assert.deepEqual(whole.args, plainArgs);
  assert.equal(whole.stdin, PROMPT);
  const at = plainArgs.indexOf('--verbose') + 1;
  assert.deepEqual(parted.args, [...plainArgs.slice(0, at), '--input-format', 'stream-json', ...plainArgs.slice(at)]);
  assert.deepEqual(parted.args, reviewAgentCliArgs({ system: session.system, model: MODEL, agent: agentRequest.agent,
    schema: SCHEMA, parts: true }));
  const content = userMessage(parted.stdin);
  assert.equal(markersIn(content), 1);
  assert.equal(content.map((block) => block.text).join(''), PROMPT);
});

test('D211 (c): only a request in parts has another answer key — on claude-cli, session, image and agent alike; every '
  + 'other key is 20be6999\'s', () => {
  const image = { mediaType: 'image/png', data: 'iVBORw0KGgo=' };
  const agent = { system: 'S', prompt: 'P', schema: { type: 'object' }, agent: { root: '/tmp', maxTurns: 3 } };
  const cli = { backend: 'claude-cli', model: 'sonnet' };
  // 20be6999's keys (d211-prompt-parts-fixture.js's requests, computed there once).
  assert.equal(answerKey({ system: 'S', prompt: 'P' }, cli),
    'd05b6e06fe888800e22d4c0fa105ec35effca8e6ca51373322b743e24e28fa73');
  assert.equal(answerKey({ system: 'S', prompt: 'P', images: [image] }, cli),
    '84b946eb8947f63895c94baa4d4fcee2cc047a55eee62ab54d0dc737f2f7ced1');
  assert.equal(answerKey(agent, { ...cli, repoState: 'a'.repeat(64) }),
    'b4f064207c61c9b312daba1808ee3dde010ff46438e45b9e54c6c154130e9f36');
  const cut = (request) => ({ ...request, prompt: `${request.prompt} Q`, parts: [1] });
  const named = { ...cli, repoState: 'a'.repeat(64) };
  for (const request of [{ system: 'S', prompt: 'P' }, agent]) {
    const whole = { ...request, prompt: `${request.prompt} Q` };
    assert.notEqual(answerKey(cut(request), named), answerKey(whole, named), 'its argv moved, and its key with it');
    assert.equal(answerKey({ ...whole, parts: [0] }, named), answerKey(whole, named), 'cuts it cannot send are none');
  }
  // An image request was one stream-json message already: its argv does not move, nor its key, and the offsets of the
  // cut are bound nowhere (the model reads the same text wherever the cut is).
  const pictured = { system: 'S', prompt: 'P', images: [image] };
  assert.equal(answerKey(cut(pictured), named), answerKey({ ...pictured, prompt: 'P Q' }, named));
  assert.equal(answerKey({ ...cut({ system: 'S', prompt: 'P' }), parts: [2] }, named),
    answerKey(cut({ system: 'S', prompt: 'P' }), named));
  // No other transport sends parts: its key does not move.
  for (const backend of [{ backend: 'codex-cli', model: 'gpt-5.5' }, { backend: 'anthropic-api', model: 'claude-x-1' }])
    assert.equal(answerKey(cut({ system: 'S', prompt: 'P' }), backend), answerKey({ system: 'S', prompt: 'P Q' }, backend));
  assert.equal(REVIEW_TRANSPORT_VERSION, 'sonah.review-transport/3');
  assert.equal(REVIEW_AGENT_TRANSPORT_VERSION, 'sonah.review-agent-transport/2');
});

// ---- (d) an agent request says its reply has begun -----------------------------------------------------------------

test('D211 (d): an agent request is told once, at its first assistant line; a session request still at its first '
  + 'stream_event line only', async () => {
  const root = await realpath(tmpdir());
  const log = [];
  let told = 0;
  const request = Object.defineProperty({ ...session, schema: SCHEMA, agent: { root, maxTurns: 3 } }, REPLY_BEGUN,
    { value: () => { told++; log.push('told'); } });
  const judge = judgeWith(fakeSpawn(() => ({ events: agentEvents(root) }), { log }));
  assert.deepEqual(await judge(request), ANSWER);
  assert.equal(told, 1);
  const first = log.indexOf('line assistant');
  assert.ok(first !== -1 && log.indexOf('told') > first && log.indexOf('told') < log.indexOf('line assistant', first + 1),
    log.join(', '));
  told = 0;
  const plain = Object.defineProperty({ ...session }, REPLY_BEGUN, { value: () => { told++; } });
  assert.deepEqual(await judgeWith(fakeSpawn(() => ({ events: sessionEvents() })))(plain), { value: 'ok' });
  assert.equal(told, 0, 'a session request\'s assistant line says nothing (D145)');
});

// ---- the guard: a request in parts refused as invalid is sent once more as one string -------------------------------

test('D211: a request in parts the provider refuses as invalid is sent once more as one string, its reason recorded; '
  + 'a request sent whole that is refused is not asked again', async () => {
  assert.equal(PROMPT_PARTS_REFUSED_CLASS, 'invalid_request');
  assert.deepEqual(PROMPT_PARTS_DROPPED, ['refused_in_parts']);
  const seen = [], attempts = [];
  const budget = createReviewBudget();
  const refuseParts = ({ args }) => (args.includes('--input-format') ? { events: refusedEvents, exit: 1 }
    : { events: sessionEvents() });
  const judge = withTransportRetry(judgeWith(fakeSpawn(refuseParts, { seen }),
    { onResult: (metadata) => { attempts.push(metadata); budget.record(metadata); } }));
  let told = 0;
  const request = Object.defineProperty({ ...inParts }, REPLY_BEGUN, { value: () => { told++; } });
  const answer = await judge(request);
  assert.deepEqual(answer, { value: 'ok' });
  assert.equal(answer.attempts, 2);
  assert.deepEqual(seen.map((call) => call.args.includes('--input-format')), [true, false]);
  assert.equal(seen[1].stdin, PROMPT, 'the same text, as one string');
  assert.deepEqual(attempts.map((m) => [m.ok, m.providerClass, m.promptParts ?? null, m.partsDropped ?? null]),
    [[false, 'invalid_request', 2, null], [true, null, null, 'refused_in_parts']]);
  assert.equal(request.parts.length, 1, 'the request itself is left as it was');
  assert.equal(Object.keys(request).includes(PARTS_DROPPED), false);
  assert.deepEqual(budget.usageRecord().promptParts, { calls: 1, resent: { refused_in_parts: 1 } });
  assert.equal(told, 0);
  // Refused whole: not asked again, as before (NON_RETRYABLE_PROVIDER_CLASSES).
  const refused = [];
  const always = withTransportRetry(judgeWith(fakeSpawn(() => ({ events: refusedEvents, exit: 1 }), { seen: refused })));
  await assert.rejects(always(session), (error) => error.providerClass === 'invalid_request');
  assert.equal(refused.length, 1);
  // Refused in parts and then whole: the failure stands, after the one resend.
  const twice = [];
  const both = withTransportRetry(judgeWith(fakeSpawn(() => ({ events: refusedEvents, exit: 1 }), { seen: twice })));
  await assert.rejects(both(inParts), (error) => error.providerClass === 'invalid_request');
  assert.deepEqual(twice.map((call) => call.args.includes('--input-format')), [true, false]);
  // A review with no request in parts keeps its usage record as before.
  const none = createReviewBudget();
  none.record({ ok: true });
  assert.equal(Object.hasOwn(none.usageRecord(), 'promptParts'), false);
});

test('D211: an attempt in parts refused as invalid after a transport failure is resent as one string too; the '
  + 'resend\'s own failure stands', async () => {
  const timeout = () => Object.assign(new Error('model_timeout'), { code: 'model_timeout' });
  const refused = () => Object.defineProperty(Object.assign(new Error('model_unavailable'), { code: 'model_unavailable' }),
    'providerClass', { value: 'invalid_request' });
  const run = async (outcomes) => {
    const calls = [];
    const judge = withTransportRetry(async (request) => {
      calls.push({ parts: request.parts ?? null, dropped: request[PARTS_DROPPED] ?? null });
      const next = outcomes.shift();
      if (next instanceof Error) throw next;
      return { value: next };
    });
    let answer = null, error = null;
    try { answer = await judge(inParts); } catch (e) { error = e; }
    return { calls, answer, error };
  };
  // A transport failure, then the identical retry refused in parts: resent as one string, a third attempt.
  const third = await run([timeout(), refused(), 'ok']);
  assert.deepEqual(third.calls, [{ parts: [SHARED.length], dropped: null }, { parts: [SHARED.length], dropped: null },
    { parts: null, dropped: 'refused_in_parts' }]);
  assert.deepEqual(third.answer, { value: 'ok' });
  assert.equal(third.answer.attempts, 3);
  assert.equal(resentWhole(third.answer), true);
  assert.equal(Object.hasOwn(third.answer, PARTS_DROPPED), false, 'no member of the answer is added or changed');
  // Refused in parts, then the resend fails for the transport: that failure stands, with no third attempt.
  const stands = await run([refused(), timeout(), 'never']);
  assert.equal(stands.calls.length, 2);
  assert.equal(stands.error?.code, 'model_timeout');
  // Sent whole, an answer is not marked; nor is one that holds a member of that name of its own.
  const whole = await run(['ok']);
  assert.equal(resentWhole(whole.answer), false);
  const named = await withTransportRetry(async () => ({ [PARTS_DROPPED]: 'SYNTHETIC its own' }))(inParts);
  assert.equal(resentWhole(named), false);
  assert.equal(named[PARTS_DROPPED], 'SYNTHETIC its own');
});

test('D211: an answer got by resending a request in parts as one string is never stored under the key that binds its '
  + 'parts; the next review asks it again', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'sonah-d211-store-'));
  try {
    const cache = createAnswerCache(dir, { backend: 'claude-cli', model: MODEL });
    const refuseParts = ({ args }) => (args.includes('--input-format') ? { events: refusedEvents, exit: 1 }
      : { events: sessionEvents() });
    const review = async () => {
      const seen = [];
      const memo = memoizeJudge(boundedJudge(judgeWith(fakeSpawn(refuseParts, { seen })), () => {}, {}), cache);
      assert.deepEqual(await memo({ ...inParts, label: 'SYNTHETIC:1' }), { value: 'ok' });
      return seen.map((call) => call.args.includes('--input-format'));
    };
    assert.deepEqual(await review(), [true, false]);
    assert.deepEqual((await readdir(dir)).filter((name) => name.endsWith('.json')), [], 'nothing stored');
    assert.deepEqual(await review(), [true, false], 'asked again');
    // An answer to the request as its key names it is stored and replays, as before.
    const answering = memoizeJudge(boundedJudge(judgeWith(fakeSpawn(() => ({ events: sessionEvents() }))), () => {}, {}),
      cache);
    await answering({ ...inParts, label: 'SYNTHETIC:1' });
    assert.equal((await readdir(dir)).filter((name) => name.endsWith('.json')).length, 1);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('D211 (d): the answer store tells a request it answered with no call; through it, the next request of a first part '
  + 'leads when the first one was stored', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'sonah-d211-replay-'));
  try {
    const cache = createAnswerCache(dir, { backend: 'claude-cli', model: MODEL });
    const sibling = (n) => ({ system: session.system, prompt: `${SHARED}SYNTHETIC_D211 sibling ${n}`,
      parts: [SHARED.length], label: `SYNTHETIC:${n}` });
    // One review answered the first sibling only (a review stopped after it).
    const first = memoizeJudge(boundedJudge(judgeWith(fakeSpawn(() => ({ events: sessionEvents() }))), () => {}, {}),
      cache);
    let replayed = 0;
    await first(Object.defineProperty(sibling(1), ANSWER_REPLAYED, { value: () => { replayed++; } }));
    assert.equal(replayed, 0, 'a live answer says nothing');
    // The next review: the first is stored, so the second leads, and the rest wait for its reply to begin.
    const log = [];
    const streamed = (answer) => [{ type: 'system', subtype: 'init', model: MODEL },
      { type: 'stream_event', event: { type: 'message_start' } }, ...sessionEvents(answer).slice(1)];
    const memo = memoizeJudge(boundedJudge(judgeWith(fakeSpawn(({ stdin }) => {
      log.push(`spawn ${/sibling (\d)/.exec(stdin)[1]}`);
      return { events: streamed() };
    }, { log })), () => {}, {}), cache);
    const sent = [];
    const send = staggerSharedParts((request) => { sent.push(request.label); log.push(`sent ${request.label}`);
      return memo(request); });
    const told = [];
    const answers = [1, 2, 3, 4].map((n) => send(Object.defineProperty(sibling(n), REPLY_BEGUN,
      { value: () => { told.push(n); log.push(`begun ${n}`); } })));
    assert.deepEqual(await Promise.all(answers), [1, 2, 3, 4].map(() => ({ value: 'ok' })));
    assert.deepEqual(sent, [1, 2, 3, 4].map((n) => `SYNTHETIC:${n}`), 'the order given');
    assert.equal(told[0], 2, 'the second\'s reply begins first: it leads');
    const at = (entry) => log.indexOf(entry);
    // The third and fourth are sent once the second's reply began (its first stream_event line, the only one so far);
    // the CLI's own spawn order of the two released together follows its pipes.
    const begun = log.indexOf('line stream_event');
    assert.ok(at('spawn 2') < begun && begun < at('sent SYNTHETIC:3') && begun < at('spawn 3') && begun < at('spawn 4'),
      log.join(', '));
    assert.equal(log.includes('spawn 1'), false, 'the first replays');
  } finally { await rm(dir, { recursive: true, force: true }); }
});

// ---- (e) the installed claude CLI, against a local fake Messages API ------------------------------------------------

const claudeVersion = (() => {
  try {
    const run = spawnSync('claude', ['--version'], { encoding: 'utf8', timeout: 20_000 });
    return run.status === 0 && /^\d+\.\d+\.\d+/.test(run.stdout) ? run.stdout.trim() : null;
  } catch { return null; }
})();

/** A local stand-in for the Messages API on 127.0.0.1. Each request of the agent's own loop (it offers the Read tool)
 *  is answered with the next Read of a chain of files, then the structured answer; any other with "OK". A body with
 *  more than four cache markers is refused (HTTP 400), as the API refuses it. `bodies` gets each body's marker count. */
async function fakeMessagesApi(chain, bodies) {
  const reply = (res, block, stop) => {
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    const event = (type, data) => res.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`);
    event('message_start', { message: { id: `msg_synthetic_${bodies.length}`, type: 'message', role: 'assistant',
      model: MODEL, content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 1, output_tokens: 1 } } });
    event('content_block_start', { index: 0, content_block: block.type === 'text' ? { type: 'text', text: '' }
      : { type: 'tool_use', id: block.id, name: block.name, input: {} } });
    event('content_block_delta', { index: 0, delta: block.type === 'text' ? { type: 'text_delta', text: block.text }
      : { type: 'input_json_delta', partial_json: JSON.stringify(block.input) } });
    event('content_block_stop', { index: 0 });
    event('message_delta', { delta: { stop_reason: stop, stop_sequence: null }, usage: { output_tokens: 1 } });
    event('message_stop', {});
    res.end();
  };
  const server = createServer((req, res) => {
    let data = '';
    req.on('data', (chunk) => { data += chunk; });
    req.on('end', () => {
      if (req.method !== 'POST' || req.url.split('?')[0] !== '/v1/messages') { res.writeHead(404); res.end('{}'); return; }
      const body = JSON.parse(data);
      const loop = Array.isArray(body.tools) && body.tools.some((tool) => tool.name === 'Read');
      bodies.push({ loop, markers: markersIn(body) });
      if (markersIn(body) > 4) {
        res.writeHead(400, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ type: 'error', error: { type: 'invalid_request_error', message: 'SYNTHETIC over 4' } }));
        return;
      }
      if (!loop) return reply(res, { type: 'text', text: 'OK' }, 'end_turn');
      const turn = body.messages.filter((message) => message.role === 'assistant').length;
      if (turn < chain.length) return reply(res, { type: 'tool_use', id: `toolu_synthetic_${turn}`, name: 'Read',
        input: { file_path: chain[turn] } }, 'tool_use');
      if (turn === chain.length) return reply(res, { type: 'tool_use', id: 'toolu_synthetic_answer',
        name: 'StructuredOutput', input: { count: chain.length } }, 'tool_use');
      return reply(res, { type: 'text', text: 'SYNTHETIC done' }, 'end_turn');
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return server;
}

test('D211 (e): with the installed claude, an agent request in parts runs 30 turns and more, never sending more than four '
  + 'cache markers, and its first part carries one', { skip: claudeVersion === null ? 'no claude CLI on PATH' : false,
  timeout: 120_000 }, async (t) => {
  const dir = await realpath(await mkdtemp(join(tmpdir(), 'sonah-d211-')));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const root = join(dir, 'root'), home = join(dir, 'home');
  await mkdir(root); await mkdir(home);
  const chain = Array.from({ length: 31 }, (_, at) => join(root, `f${String(at).padStart(2, '0')}.txt`));
  for (const [at, file] of chain.entries()) await writeFile(file, `SYNTHETIC next: ${chain[at + 1] ?? 'none'}\n`);
  const bodies = [];
  const server = await fakeMessagesApi(chain, bodies);
  t.after(() => server.close());
  // The transport's own argv, stdin and environment; the stand-in's address and a key that is no key are added for the
  // capture alone, with a configuration folder of its own (no login of the person's is read or sent).
  const capture = { CLAUDE_CONFIG_DIR: home, ANTHROPIC_API_KEY: 'SYNTHETIC_D211_NOT_A_KEY',
    ANTHROPIC_BASE_URL: `http://127.0.0.1:${server.address().port}`, DISABLE_TELEMETRY: '1',
    CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1', DISABLE_AUTOUPDATER: '1' };
  const attempts = [];
  const judge = withTransportRetry(createReviewJudge({ config: { backend: 'claude-cli', model: MODEL },
    env: { HOME: home, PATH: process.env.PATH, TMPDIR: process.env.TMPDIR, LANG: 'en_US.UTF-8' },
    spawnProcess: (command, args, options) => spawn(command, args, { ...options, env: { ...options.env, ...capture } }),
    onResult: (metadata) => attempts.push(metadata) }));
  const shared = `# SYNTHETIC_D211 shared — untrusted\n\n${Array.from({ length: 200 }, (_, at) => `SYNTHETIC row ${at}.`)
    .join('\n')}\n\n\n`;
  const schema = { type: 'object', properties: { count: { type: 'integer' } }, required: ['count'],
    additionalProperties: false };
  const answer = await judge({ system: 'SYNTHETIC_D211: follow the task.', schema, agent: { root, maxTurns: 60 },
    prompt: `${shared}SYNTHETIC_D211 task: read ${chain[0]}, then each file it names, then answer the count.`,
    parts: [shared.length] });
  assert.deepEqual(answer, { count: 31 });
  const loop = bodies.filter((body) => body.loop);
  assert.ok(loop.length >= 30, `${loop.length} turns`);
  assert.ok(loop.every((body) => body.markers <= 4), `${claudeVersion}: ${loop.map((body) => body.markers).join(',')}`);
  assert.ok(bodies.every((body) => body.markers <= 4));
  assert.deepEqual(attempts.map((m) => [m.ok, m.promptParts ?? null, m.partsDropped ?? null]), [[true, 2, null]],
    'one attempt, in parts, never resent');
});
