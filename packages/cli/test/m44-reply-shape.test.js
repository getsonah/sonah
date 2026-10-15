// M44. An attempt can be accepted by the CLI (exit 0, subtype success, no tool use) and still fail
// `model_response_invalid`: Sonah cannot read its text as a JSON object, and no reply text is recorded, so the cause
// cannot be named from it. Each accepted claude-cli reply now records its closed shape (review-judge.js replyShapeOf): how
// extractJson read the result's text, whether a fence was there, character counts, the final assistant event's block
// types, whether the stream's joined text blocks would have read, and the result's stop reason, turns and thinking
// tokens. Record only: the answer and the failure code are byte for byte what they were (parentOutcome below).
//
// Every stream, session and report here is invented; every child process and transport is a fake. No model, no network.
import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { REPLY_BLOCK_TYPES, REPLY_FINAL_BLOCKS_KEPT, REPLY_SHAPES, REPLY_STOP_REASONS, createReviewJudge, extractJson,
  replyShapeOf, replyShapeRecordOf } from '../src/review-judge.js';
import { manyWindowSession } from './m33-fast-profile-fixture.js';

const HARNESS = pathToFileURL(fileURLToPath(new URL('../../../scripts/session-review.mjs', import.meta.url))).href;
const harness = await import(HARNESS);
const LEAK = 'M44_REPLY_LEAK_SENTINEL';
const MODEL = 'claude-synthetic-1';
const EMPTY = { decisions: [], pivots: [], claims: [], requirements: [] };
const VALID = JSON.stringify(EMPTY);
const FENCE = '```';

const init = { type: 'system', subtype: 'init', model: MODEL, cwd: `/synthetic/${LEAK}`, session_id: 'synthetic' };
const assistant = (...content) => ({ type: 'assistant', parent_tool_use_id: null,
  message: { model: MODEL, role: 'assistant', content } });
const text = (value) => ({ type: 'text', text: value });
const thinking = { type: 'thinking', thinking: `${LEAK} thought`, signature: LEAK };
const result = (reply, extra = {}) => ({ type: 'result', subtype: 'success', is_error: false, api_error_status: null,
  result: reply, num_turns: 1, stop_reason: 'end_turn', usage: { input_tokens: 1, output_tokens: 1 }, ...extra });

/** A fake `claude` child that prints `events` (the n-th spawn prints `events(n)` when it is a function), exit 0. */
function fakeClaude(events, capture = { calls: 0 }) {
  return () => {
    capture.calls++;
    const lines = typeof events === 'function' ? events(capture.calls) : events;
    const child = new EventEmitter();
    child.stdin = new PassThrough(); child.stdout = new PassThrough(); child.stderr = new PassThrough();
    let closed = false;
    const close = (code) => { if (!closed) { closed = true; child.emit('close', code, null); } };
    child.kill = () => { setImmediate(() => close(null)); return true; };
    child.stdin.resume();
    child.stdin.on('end', () => setImmediate(() => {
      child.stderr.write(LEAK);
      child.stdout.write(lines.map((line) => `${JSON.stringify(line)}\n`).join(''));
      setImmediate(() => close(0));
    }));
    return child;
  };
}

/** The thrown failure's closed fields, as a caller can read them. */
const failureOf = (error) => ({ message: error.message, code: error.code, transportClass: error.transportClass,
  providerClass: error.providerClass, keys: Object.keys(error) });

/** One call through the claude transport: the answer or the failure, and its one onResult metadata. */
async function call(events) {
  const recorded = [];
  const judge = createReviewJudge({ config: { backend: 'claude-cli', model: MODEL }, env: { PATH: '/bin' },
    spawnProcess: fakeClaude(events), onResult: (metadata) => recorded.push(metadata) });
  let outcome;
  try { outcome = { answer: await judge({ system: 'SYNTHETIC_SYSTEM', prompt: 'SYNTHETIC_PROMPT' }) }; }
  catch (error) { outcome = { failure: failureOf(error) }; }
  assert.equal(recorded.length, 1);
  return { outcome, metadata: recorded[0] };
}

/** The parent's (51918f9) outcome for an accepted reply: settle() read `result.result` with extractJson, answered a JSON
 *  object, and failed `model_response_invalid` (no transport or provider class) on anything else. */
function parentOutcome(reply) {
  const json = typeof reply === 'string' ? extractJson(reply) : null;
  return json && typeof json === 'object' && !Array.isArray(json) ? { answer: json }
    : { failure: { message: 'model_response_invalid', code: 'model_response_invalid', transportClass: undefined,
      providerClass: undefined, keys: ['code'] } };
}

/** An accepted call over `events`: its outcome is the parent's, byte for byte; no text reaches the metadata; and the
 *  metadata's shape is what replyShapeOf computes, closed again to itself. Returns the shape. */
async function shapeOf(events) {
  const { outcome, metadata } = await call(events);
  const reply = events.findLast((event) => event.type === 'result');
  const expected = parentOutcome(Object.hasOwn(reply, 'result') ? reply.result : undefined);
  assert.deepEqual(outcome, expected);
  assert.equal(JSON.stringify(outcome), JSON.stringify(expected), 'the answer is byte for byte the parent\'s');
  assert.equal(metadata.ok, Object.hasOwn(expected, 'answer'));
  if (!metadata.ok) assert.equal(metadata.code, 'model_response_invalid');
  assert.ok(!JSON.stringify(metadata).includes(LEAK), 'no reply text, thinking or stream text is recorded');
  assert.deepEqual(replyShapeRecordOf(metadata.replyShape), metadata.replyShape, 'a shape closes again to itself');
  return metadata.replyShape;
}

const base = { fenced: false, finalBlocks: ['text'], finalBlockCount: 1, finalTextBlocks: 1, assistantEvents: 1, textBlocks: 1,
  joinedTextReadable: false, stopReason: 'end_turn', numTurns: 1, thinkingTokens: null };

// ---- the closed lists ---------------------------------------------------------------------------------------------
test('M44 the reply-shape vocabularies are closed, frozen lists', () => {
  assert.deepEqual(REPLY_SHAPES, ['object', 'array', 'unclosed', 'unparsed', 'no_bracket', 'empty', 'absent']);
  assert.deepEqual(REPLY_BLOCK_TYPES, ['text', 'thinking', 'redacted_thinking', 'tool_use', 'other']);
  assert.deepEqual(REPLY_STOP_REASONS, ['end_turn', 'max_tokens', 'stop_sequence', 'tool_use', 'pause_turn', 'compaction',
    'refusal', 'model_context_window_exceeded', 'tool_deferred', 'other']);
  for (const list of [REPLY_SHAPES, REPLY_BLOCK_TYPES, REPLY_STOP_REASONS]) {
    assert.ok(Object.isFrozen(list));
    for (const token of list) assert.match(token, /^[a-z][a-z_]*$/);
  }
});

// ---- each shape, through the transport ----------------------------------------------------------------------------
test('M44 a readable object: `object`, read where it stands; the answer is unchanged', async () => {
  const shape = await shapeOf([init, assistant(thinking, text(VALID)), result(VALID)]);
  assert.deepEqual(shape, { ...base, code: 'object', chars: VALID.length, charsBefore: 0, charsAfter: 0,
    finalBlocks: ['thinking', 'text'], finalBlockCount: 2, joinedTextReadable: true });
});

test('M44 an empty result (the final block was not text): `empty`, nothing before or after', async () => {
  assert.deepEqual(await shapeOf([init, assistant(thinking), result('')]), { ...base, code: 'empty', chars: 0,
    charsBefore: null, charsAfter: null, finalBlocks: ['thinking'], finalTextBlocks: 0, textBlocks: 0 });
  const blank = ' \n\t ';
  assert.deepEqual(await shapeOf([init, assistant(text(blank)), result(blank)]), { ...base, code: 'empty',
    chars: blank.length, charsBefore: null, charsAfter: null });
});

test('M44 prose only: `no_bracket`, its length kept and nothing of it', async () => {
  const prose = `${LEAK} I reviewed the window and found nothing to report.`;
  assert.deepEqual(await shapeOf([init, assistant(text(prose)), result(prose)]), { ...base, code: 'no_bracket',
    chars: prose.length, charsBefore: null, charsAfter: null });
});

test('M44 a top-level array: `array`, though it parses', async () => {
  const reply = `[${VALID}]`;
  assert.deepEqual(await shapeOf([init, assistant(text(reply)), result(reply)]), { ...base, code: 'array',
    chars: reply.length, charsBefore: 0, charsAfter: 0 });
});

test('M44 an unclosed object: `unclosed`, the characters before it counted and none after', async () => {
  const reply = `${LEAK}\n{"decisions": [{"dimension": "${LEAK}`;
  assert.deepEqual(await shapeOf([init, assistant(text(reply)), result(reply, { stop_reason: 'max_tokens' })]),
    { ...base, code: 'unclosed', chars: reply.length, charsBefore: LEAK.length + 1, charsAfter: null,
      stopReason: 'max_tokens' });
});

test('M44 a parse error: `unparsed`, the closed span counted from both ends', async () => {
  const reply = `{"decisions": [], "pivots": [],}\n${LEAK}`;
  assert.deepEqual(await shapeOf([init, assistant(text(reply)), result(reply)]), { ...base, code: 'unparsed',
    chars: reply.length, charsBefore: 0, charsAfter: LEAK.length + 1 });
});

test('M44 a reply split across two text blocks of one message: the result holds the last; the joined blocks read', async () => {
  // The CLI's `result` is the text of the final assistant event's last block (2.1.296), so only the tail is read.
  const head = '{"decisions":[],"pivots":[],', tail = '"claims":[],"requirements":[]}';
  assert.ok(extractJson(head + tail), 'premise: the joined blocks are the answer');
  assert.deepEqual(await shapeOf([init, assistant(text(head), text(tail)), result(tail)]), { ...base, code: 'array',
    chars: tail.length, charsBefore: '"claims":'.length, charsAfter: tail.length - '"claims":[]'.length,
    finalBlocks: ['text', 'text'], finalBlockCount: 2, finalTextBlocks: 2, textBlocks: 2, joinedTextReadable: true });
});

test('M44 a reply split across two assistant events: the final message has one text block; the joined blocks read', async () => {
  const head = '{"decisions": [], "pivots": [], "claims": [], "requirements": [', tail = ']}';
  assert.deepEqual(await shapeOf([init, assistant(thinking, text(head)), assistant(text(tail)), result(tail)]),
    { ...base, code: 'no_bracket', chars: 2, charsBefore: null, charsAfter: null, assistantEvents: 2, textBlocks: 2,
      joinedTextReadable: true });
});

test('M44 a fenced block: `fenced`; read inside the fence, or not read at all', async () => {
  const before = `Here is the review.\n${FENCE}json\n`, after = `\n${FENCE}\n${LEAK}`;
  const readable = `${before}${VALID}${after}`;
  assert.deepEqual(await shapeOf([init, assistant(text(readable)), result(readable)]), { ...base, code: 'object',
    fenced: true, chars: readable.length, charsBefore: before.length, charsAfter: after.length, joinedTextReadable: true });
  const broken = `${FENCE}json\n{"decisions": [],}\n${FENCE}`;
  assert.deepEqual(await shapeOf([init, assistant(text(broken)), result(broken)]), { ...base, code: 'unparsed',
    fenced: true, chars: broken.length, charsBefore: `${FENCE}json\n`.length, charsAfter: `\n${FENCE}`.length });
});

test('M44 no result string: `absent`, no counts', async () => {
  const { result: omitted, ...none } = result('');
  assert.deepEqual(await shapeOf([init, assistant(text(VALID)), none]), { ...base, code: 'absent', chars: null,
    charsBefore: null, charsAfter: null, joinedTextReadable: true });
  assert.equal((await shapeOf([init, assistant(text(VALID)), result(null)])).code, 'absent');
  assert.equal((await shapeOf([init, assistant(text(VALID)), result(7)])).code, 'absent');
});

// ---- the stream's and the result's closed fields ------------------------------------------------------------------
test('M44 block types are closed: any other type, or a block that is not a record, is `other`', async () => {
  const shape = await shapeOf([init, assistant(text(`${LEAK} [`)), assistant(thinking, { type: 'redacted_thinking', data: LEAK },
    { type: LEAK }, { type: 7 }, LEAK, null, { type: 'other' }, text(VALID)), result(VALID)]);
  assert.deepEqual([shape.code, shape.finalBlocks, shape.finalBlockCount, shape.finalTextBlocks, shape.assistantEvents,
    shape.textBlocks], ['object', ['thinking', 'redacted_thinking', 'other', 'other', 'other', 'other', 'other', 'text'], 8, 1,
    2, 2]);
  assert.equal(shape.joinedTextReadable, false, 'joined, the first block opens a bracket that never closes');
});

test('M44 the stop reason is the CLI\'s own list; another value is `other`, none is null', async () => {
  for (const reason of REPLY_STOP_REASONS)
    assert.equal((await shapeOf([init, assistant(text(VALID)), result(VALID, { stop_reason: reason })])).stopReason, reason);
  for (const [value, expected] of [[LEAK, 'other'], ['END_TURN', 'other'], [3, 'other'], [['end_turn'], 'other'],
    [null, null], [undefined, null]])
    assert.equal((await shapeOf([init, assistant(text(VALID)), result(VALID, { stop_reason: value })])).stopReason, expected,
      String(value));
  const { stop_reason: omitted, ...none } = result(VALID);
  assert.equal((await shapeOf([init, assistant(text(VALID)), none])).stopReason, null);
});

test('M44 turns and thinking tokens are counts, else null', async () => {
  const of = (extra) => shapeOf([init, assistant(text(VALID)), result(VALID, extra)]);
  const counted = await of({ num_turns: 2, usage: { input_tokens: 1, output_tokens: 900,
    output_tokens_details: { thinking_tokens: 812 } } });
  assert.deepEqual([counted.numTurns, counted.thinkingTokens], [2, 812]);
  for (const extra of [{ num_turns: -1, usage: { output_tokens_details: { thinking_tokens: -3 } } },
    { num_turns: '1', usage: { output_tokens_details: { thinking_tokens: '812' } } },
    { num_turns: 1.5, usage: { output_tokens_details: null } }, { num_turns: null, usage: null }]) {
    const shape = await of(extra);
    assert.deepEqual([shape.numTurns, shape.thinkingTokens], [null, null], JSON.stringify(extra));
  }
});

test('M44 a call that is not an accepted reply records no shape, and its failure is unchanged', async () => {
  const tool = await call([init, assistant({ type: 'tool_use', id: LEAK, name: 'Read', input: {} }), result(VALID)]);
  assert.deepEqual([tool.outcome.failure.code, tool.metadata.replyShape], ['model_tool_use', null]);
  const failed = await call([init, assistant(text(VALID)), result(VALID, { is_error: true, subtype: 'error_during_execution' })]);
  assert.deepEqual([failed.outcome.failure.code, failed.metadata.replyShape], ['model_unavailable', null]);
  const noInit = await call([assistant(text(VALID)), result(VALID)]);
  assert.deepEqual([noInit.outcome.failure.code, noInit.metadata.replyShape], ['model_unavailable', null]);
  // The API transport is not instrumented: it records no shape either.
  const recorded = [];
  const api = createReviewJudge({ config: { backend: 'anthropic-api', model: 'claude-test-1' },
    env: { ANTHROPIC_API_KEY: 'SYNTHETIC_KEY' }, onResult: (metadata) => recorded.push(metadata),
    fetchImpl: async () => new Response(JSON.stringify({ stop_reason: 'end_turn', content: [text(LEAK)] })) });
  await assert.rejects(api({ system: 's', prompt: 'p' }), { code: 'model_response_invalid' });
  assert.equal(recorded[0].replyShape, null);
});

// ---- the shape never drifts from the extractor ---------------------------------------------------------------------
test('M44 the shape agrees with extractJson on every reply of a deterministic corpus, and its counts frame the value', () => {
  const tokens = ['{', '}', '[', ']', '"', '\\', ':', ',', '1', 'a', ' ', '\n', FENCE, `${FENCE}json\n`, `${FENCE}\n`,
    'true', '"k"', '{"a":1}', '[1]', '"}"', '"]"', '\\"', 'x y'];
  let seed = 0x5eed;
  const random = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
  const seen = new Set();
  for (let n = 0; n < 6000; n++) {
    let reply = '';
    for (let k = Math.floor(random() * 14); k >= 0; k--) reply += tokens[Math.floor(random() * tokens.length)];
    const shape = replyShapeOf('', { result: reply });
    const value = extractJson(reply);
    seen.add(shape.code);
    if (shape.code === 'object') assert.ok(value && typeof value === 'object' && !Array.isArray(value), reply);
    else if (shape.code === 'array') assert.ok(Array.isArray(value), reply);
    else assert.equal(value, null, reply);
    assert.equal(shape.fenced, /```(?:json)?\s*\n([\s\S]*?)```/.test(reply), reply);
    assert.equal(shape.chars, reply.length);
    if (shape.charsBefore !== null) assert.match(reply[shape.charsBefore], /[[{]/, reply);
    if (shape.charsAfter !== null) {
      const span = reply.slice(shape.charsBefore, reply.length - shape.charsAfter);
      if (shape.code === 'unparsed') assert.throws(() => JSON.parse(span), reply);
      else assert.deepEqual(JSON.parse(span), value, reply);
    }
  }
  assert.deepEqual([...seen].sort(), REPLY_SHAPES.filter((code) => code !== 'absent').sort(), 'every text shape occurs');
});

test('M44 a record closes again: values outside a list or type are null (a block type `other`); not a record is null', () => {
  for (const value of [null, undefined, 'object', 7, [], true]) assert.equal(replyShapeRecordOf(value), null);
  assert.deepEqual(replyShapeRecordOf({ code: LEAK, fenced: 'yes', chars: '12', charsBefore: -1, charsAfter: 1.5,
    finalBlocks: [LEAK, 'text', null], finalBlockCount: '3', finalTextBlocks: 1, assistantEvents: 2, textBlocks: 3,
    joinedTextReadable: 1, stopReason: LEAK, numTurns: 1, thinkingTokens: 4, extra: LEAK }),
  { code: null, fenced: null, chars: null, charsBefore: null, charsAfter: null, finalBlocks: ['other', 'text', 'other'],
    finalBlockCount: null, finalTextBlocks: 1, assistantEvents: 2, textBlocks: 3, joinedTextReadable: null,
    stopReason: 'other', numTurns: 1, thinkingTokens: 4 });
  assert.equal(replyShapeRecordOf({ finalBlocks: LEAK }).finalBlocks, null);
  // A longer list than a shape keeps is cut to its last REPLY_FINAL_BLOCKS_KEPT entries.
  assert.deepEqual(replyShapeRecordOf({ finalBlocks: [...Array(20).fill('thinking'), LEAK, 'text'] }).finalBlocks,
    [...Array(6).fill('thinking'), 'other', 'text']);
});

test('M44 a final event of many blocks keeps its last 8 block types and counts them all: the record stays small', async () => {
  assert.equal(REPLY_FINAL_BLOCKS_KEPT, 8);
  const blocks = [...Array.from({ length: 20_000 }, (_, i) => (i % 2 ? thinking : { type: LEAK })), text(VALID)];
  const shape = await shapeOf([init, assistant(...blocks), result(VALID)]);
  assert.deepEqual(shape.finalBlocks, ['thinking', 'other', 'thinking', 'other', 'thinking', 'other', 'thinking', 'text']);
  assert.deepEqual([shape.finalBlockCount, shape.finalTextBlocks, shape.textBlocks], [20_001, 1, 1]);
  assert.ok(JSON.stringify(shape).length < 512, 'a bounded record, whatever the number of blocks');
});

test('M44 a line that cannot be an object is never parsed; one led by JSON white space is read as JSON.parse reads it', () => {
  const event = JSON.stringify(assistant(text(VALID)));
  // Blank, prose, an array, a string, a BOM or any other character before `{`: none is an event, parsed or not.
  const noise = ['', '   ', '\r', 'not json', '[1]', '"x"', `\uFEFF${event}`, `x${event}`, '{broken'];
  assert.equal(replyShapeOf(noise.join('\n'), result(VALID)).assistantEvents, 0);
  const shape = replyShapeOf([...noise, ` \t\r${event}\r `, ...noise].join('\n'), result(VALID));
  assert.deepEqual([shape.assistantEvents, shape.textBlocks, shape.joinedTextReadable], [1, 1, true]);
  assert.equal(replyShapeOf('\n'.repeat(1 << 16), result(VALID)).assistantEvents, 0);
});

// ---- the scripted runner --------------------------------------------------------------------------------------------
async function directory(t, name) {
  const dir = await mkdtemp(join(tmpdir(), `sonah-m44-reply-${name}-`));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return dir;
}
const options = (dir) => ({ parent: join(dir, 'SYNTHETIC.jsonl'), codexHome: dir, out: join(dir, 'out'),
  backend: 'claude-cli', model: MODEL, maxCalls: 1000, maxSeconds: 600, timeoutMs: 5000, sessionKey: 'session',
  concurrency: 1 });
const quiet = { write: () => {}, progress: () => {}, installSignals: false };

test('M44 attempts.json carries each attempt\'s reply shape; the summary counts them (schema /15); no text', async (t) => {
  const dir = await directory(t, 'harness');
  // The first spawn answers prose, unreadable; every later one answers the empty proposal.
  const prose = `${LEAK} no JSON here`;
  const capture = { calls: 0 };
  const spawnProcess = fakeClaude((n) => (n === 1
    ? [init, assistant(text(prose)), result(prose, { stop_reason: 'refusal' })]
    : [init, assistant(thinking, text(VALID)), result(VALID)]), capture);
  let stdout = '';
  const run = await harness.runSessionReviewHarness(options(dir), { ...quiet, write: (line) => { stdout += line; },
    loadSession: async () => manyWindowSession(2),
    createJudge: (args) => createReviewJudge({ ...args, env: { PATH: '/bin' }, spawnProcess }) });
  assert.equal(run.summary.schema, 'sonah.session-review-harness/17');
  assert.equal(harness.HARNESS_SUMMARY_SCHEMA, 'sonah.session-review-harness/17');
  const attempts = JSON.parse(await readFile(join(dir, 'out', 'attempts.json'), 'utf8'));
  assert.equal(attempts.length, capture.calls);
  assert.ok(attempts.length >= 3, JSON.stringify(run.summary));
  assert.deepEqual(attempts[0].replyShape, { code: 'no_bracket', fenced: false, chars: prose.length, charsBefore: null,
    charsAfter: null, finalBlocks: ['text'], finalBlockCount: 1, finalTextBlocks: 1, assistantEvents: 1, textBlocks: 1,
    joinedTextReadable: false, stopReason: 'refusal', numTurns: 1, thinkingTokens: null });
  assert.equal(attempts[0].code, 'model_response_invalid');
  for (const attempt of attempts.slice(1)) {
    assert.equal(attempt.replyShape.code, 'object');
    assert.deepEqual(attempt.replyShape.finalBlocks, ['thinking', 'text']);
  }
  const readable = attempts.length - 1;
  assert.deepEqual(run.summary.replyShape, {
    byCode: { object: readable, array: 0, unclosed: 0, unparsed: 0, no_bracket: 1, empty: 0, absent: 0 }, readAsVotes: 0,
    unreadable: { fenced: 0, joinedTextReadable: 0, byStopReason: { end_turn: 0, max_tokens: 0, stop_sequence: 0,
      tool_use: 0, pause_turn: 0, compaction: 0, refusal: 1, model_context_window_exceeded: 0, tool_deferred: 0, other: 0,
      unreported: 0 } } });
  const files = [await readFile(join(dir, 'out', 'attempts.json'), 'utf8'),
    await readFile(join(dir, 'out', 'summary.json'), 'utf8'), stdout];
  for (const file of files) assert.ok(!file.includes(LEAK), 'no reply text leaves the harness');
});

test('M44 the harness closes what a transport reports: a shape outside the lists counts nowhere; none is null', async (t) => {
  const dir = await directory(t, 'closed');
  const reports = [
    { code: 'unclosed', fenced: true, joinedTextReadable: true, stopReason: 'max_tokens', finalBlocks: [LEAK] },
    { code: LEAK, fenced: true, joinedTextReadable: true, stopReason: LEAK },
    { code: 'empty', fenced: false, joinedTextReadable: false, stopReason: null },
    LEAK,
  ];
  let n = 0;
  const createJudge = ({ onResult }) => async (request) => {
    const replyShape = reports[n++] ?? null;
    await onResult({ ok: true, attestation: 'attested', providerClass: null, elapsedMs: 1, inputBytes: 1, replyShape });
    return request.challenge ? { votes: [] } : EMPTY;
  };
  const run = await harness.runSessionReviewHarness(options(dir), { ...quiet, createJudge,
    loadSession: async () => manyWindowSession(5) });
  assert.equal(run.exitCode, 0, JSON.stringify(run.summary));
  const attempts = JSON.parse(await readFile(join(dir, 'out', 'attempts.json'), 'utf8'));
  assert.equal(attempts.length, 5, 'five empty windows, five narrative calls');
  assert.deepEqual(attempts.map((a) => (a.replyShape === null ? 'none' : a.replyShape.code)),
    ['unclosed', null, 'empty', 'none', 'none'], 'a code outside the list is null; a shape that is not a record is none');
  assert.deepEqual(attempts[0].replyShape.finalBlocks, ['other']);
  assert.equal(attempts[1].replyShape.stopReason, 'other');
  const { byCode, unreadable } = run.summary.replyShape;
  assert.deepEqual(byCode, { object: 0, array: 0, unclosed: 1, unparsed: 0, no_bracket: 0, empty: 1, absent: 0 });
  assert.deepEqual([unreadable.fenced, unreadable.joinedTextReadable], [1, 1]);
  assert.deepEqual([unreadable.byStopReason.max_tokens, unreadable.byStopReason.unreported], [1, 1]);
  assert.ok(!JSON.stringify(attempts).includes(LEAK) && !JSON.stringify(run.summary).includes(LEAK));
});

test('D78 (/16) an array reply that answered counts under readAsVotes, never under unreadable', async (t) => {
  const dir = await directory(t, 'votes');
  const array = { code: 'array', fenced: false, joinedTextReadable: false, stopReason: 'end_turn' };
  // Two windows: one array reply the transport read as votes (ok), one it could not read (a failure, retried).
  const outcomes = [{ ok: true, replyShape: array }, { ok: false, code: 'model_response_invalid', replyShape: array }];
  let n = 0;
  const createJudge = ({ onResult }) => async (request) => {
    const outcome = outcomes[n++] ?? { ok: true, replyShape: null };
    await onResult({ attestation: outcome.ok ? 'attested' : 'unattested', providerClass: null, elapsedMs: 1, inputBytes: 1,
      ...outcome });
    return request.challenge ? { votes: [] } : EMPTY;
  };
  const run = await harness.runSessionReviewHarness(options(dir), { ...quiet, createJudge,
    loadSession: async () => manyWindowSession(2) });
  assert.equal(run.summary.schema, 'sonah.session-review-harness/17');
  const { byCode, readAsVotes, unreadable } = run.summary.replyShape;
  assert.equal(byCode.array, 2, 'every accepted reply shape is still counted by its code');
  assert.equal(readAsVotes, 1, 'the one that answered');
  assert.equal(unreadable.byStopReason.end_turn, 1, 'only the one that failed is unreadable');
});
