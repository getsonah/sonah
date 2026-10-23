// D145 (0.3.0-beta.7). A batch's later passes are sent after its first pass's reply has begun, so they read the prompt
// cache the first one wrote. Proved here: through the review command on a recording, every request's bytes, answer key
// and occurrence, and every stored answer's bytes, are those of the code before D145 (0981e645), and a second run
// replays every one; through the claude-cli transport, the first pass is told its reply has begun at the stream's first
// `stream_event` line, and its later passes start then.
//
// Every byte is synthetic: a recording made by golden/src/build.js, fake transports and fake `claude` children. No
// model, no network; SONAH_HOME is a temporary directory.
import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { capturePasses, d145Home, d145Run, d145Stored } from './d145-passes-fixture.js';
import { createReviewJudge } from '../src/review-judge.js';
import { memoizeJudge } from '../src/answer-cache.js';
import { boundedJudge } from '../src/session-review.js';
import { challengeItems, REPLY_BEGUN } from '../../evidence/src/challenge.js';
import { verifyReceipt } from '../../evidence/src/session.js';
import { redisPivotSession } from '../../evidence/fixtures/redis-pivot.js';

// Pinned ONCE by `capturePasses` (d145-passes-fixture.js) against `git archive 0981e645`, the code before D145
// (2026-10-24 00:06:58 IST): per request label, the digest of its bytes, its answer key and its occurrence (16 hex
// characters each), and each stored answer file with the digest of its bytes. They move only with a request byte.
const BASE_REQUESTS = Object.freeze([
  ['challenge:w1:b1:p1', 'ea1865b569083e87', '6a1771d9489161b1', 0],
  ['challenge:w1:b1:p2', 'ea1865b569083e87', '6a1771d9489161b1', 1],
  ['challenge:w1:b1:p3', 'ea1865b569083e87', '6a1771d9489161b1', 2],
  ['challenge:w1:b2:p1', 'c0799049d08f1ccc', 'bcd882a716807ac9', 0],
  ['challenge:w1:b2:p2', 'c0799049d08f1ccc', 'bcd882a716807ac9', 1],
  ['challenge:w1:b2:p3', 'c0799049d08f1ccc', 'bcd882a716807ac9', 2],
  ['narrative:w1', '1e5096fa83ed91ad', '6590483e866653d9', 0]]);
const BASE_STORE = Object.freeze([
  ['6590483e866653d9.0', '8be1f5c56cdcf7dd'], ['6a1771d9489161b1.0', '8277a11d8d356fd4'],
  ['6a1771d9489161b1.1', '745637c8722ea0a4'], ['6a1771d9489161b1.2', '734beab6331a690a'],
  ['bcd882a716807ac9.0', '5454c2991ae749cb'], ['bcd882a716807ac9.1', '3175ad84f8ca03b5'],
  ['bcd882a716807ac9.2', '71412f0873a1633e']]);
// The window record lists its answers in the order they were sent: 0981e645 sent a batch's passes together,
// `6590.0 6a17.0 6a17.1 6a17.2 bcd8.0 bcd8.1 bcd8.2`; D145 sends every batch's first pass first.
const SENT = Object.freeze(['narrative:w1', 'challenge:w1:b1:p1', 'challenge:w1:b2:p1', 'challenge:w1:b1:p2',
  'challenge:w1:b1:p3', 'challenge:w1:b2:p2', 'challenge:w1:b2:p3']);
const RECORD = Object.freeze(['6590483e866653d9.0', '6a1771d9489161b1.0', 'bcd882a716807ac9.0', '6a1771d9489161b1.1',
  '6a1771d9489161b1.2', 'bcd882a716807ac9.1', 'bcd882a716807ac9.2']);

test('D145 through the command: the same bytes, keys, occurrences and stored answers as before, sent first pass first', async () => {
  // Instant calls; then the first batch slow and the second fast; then the first fast and the second slow.
  const slow = (batch) => (label) => (label.includes(`:b${batch}:`) ? 40 : 2);
  for (const latency of [undefined, slow(1), slow(2)]) {
    const run = await capturePasses({ latency });
    assert.equal(run.code, 0);
    assert.deepEqual(run.requests, BASE_REQUESTS);
    assert.deepEqual(run.store, BASE_STORE, 'every stored answer is byte for byte the one 0981e645 stored');
    assert.deepEqual(run.sent, SENT);
    assert.deepEqual(run.records, [RECORD]);
    // The same command again over the same state: every answer replayed, the record rewritten byte for byte.
    assert.deepEqual(run.replay, { code: 0, calls: 0, records: [RECORD] });
  }
});

test('D145 a store written in the old order replays every answer, with no call', async (t) => {
  // The answers 0981e645 stored are these very files (BASE_STORE, above); its window record listed them in its order.
  const home = await d145Home();
  t.after(() => rm(home, { recursive: true, force: true }));
  await d145Run(home);
  const stored = await d145Stored(home);
  assert.deepEqual(stored.store, BASE_STORE);
  // The window record as 0981e645 wrote it: the same answers, a batch's passes together.
  const [path] = (await filesUnder(join(home, '.sonah'))).filter((file) => file.includes('/windows/'));
  const record = JSON.parse(await readFile(path, 'utf8'));
  const old = ['6590483e866653d9.0', '6a1771d9489161b1.0', '6a1771d9489161b1.1', '6a1771d9489161b1.2',
    'bcd882a716807ac9.0', 'bcd882a716807ac9.1', 'bcd882a716807ac9.2'];
  const byId = new Map(record.answers.map((ref) => [`${ref.key.slice(0, 16)}.${ref.occurrence}`, ref]));
  await writeFile(path, JSON.stringify({ ...record, answers: old.map((id) => byId.get(id)) }));
  assert.deepEqual((await d145Stored(home)).records, [old]);
  const again = await d145Run(home, { latency: (label) => (label.endsWith(':p1') ? 30 : 1) });
  assert.equal(again.code, 0);
  assert.equal(again.calls.length, 0, 'no stored answer is asked again');
  const after = await d145Stored(home);
  assert.deepEqual(after.store, BASE_STORE);
  assert.deepEqual(after.records, [RECORD], 'the record is written again in the order D145 sends');
});

async function filesUnder(folder) {
  const out = [];
  for (const entry of await readdir(folder, { withFileTypes: true }).catch(() => [])) {
    const path = join(folder, entry.name);
    if (entry.isDirectory()) out.push(...await filesUnder(path)); else if (entry.isFile()) out.push(path);
  }
  return out;
}

// ---- the claude-cli transport -------------------------------------------------------------------------------------
const init = `${JSON.stringify({ type: 'system', subtype: 'init', model: 'claude-test-1' })}\n`;
const begun = `${JSON.stringify({ type: 'stream_event', event: { type: 'message_start' }, parent_tool_use_id: null })}\n`;
const reply = (text) => `${JSON.stringify({ type: 'assistant', parent_tool_use_id: null,
  message: { model: 'claude-test-1', content: [{ type: 'text', text }] } })}\n${JSON.stringify({ type: 'result',
  subtype: 'success', is_error: false, result: text, usage: { output_tokens: 1 } })}\n`;

/** Fake `claude` children: each writes `chunks` (strings, or a number: wait that many ms) once its stdin ends, then
 *  closes. `log` gets `spawn N`, `writing N:<i>` just before chunk i is written, and `close N`. */
function fakeClaude({ log, chunks }) {
  let n = 0;
  return () => {
    const id = ++n;
    log.push(`spawn ${id}`);
    const child = new EventEmitter();
    child.stdin = new PassThrough(); child.stdout = new PassThrough(); child.stderr = new PassThrough();
    child.kill = () => { setImmediate(() => child.emit('close', null, 'SIGKILL')); return true; };
    child.stdin.on('finish', async () => {
      const list = typeof chunks === 'function' ? chunks(id) : chunks;
      for (const [at, chunk] of list.entries()) {
        if (typeof chunk === 'number') { await new Promise((resolve) => setTimeout(resolve, chunk)); continue; }
        log.push(`writing ${id}:${at}`);
        child.stdout.write(chunk);
        await new Promise((resolve) => setImmediate(resolve));
      }
      setImmediate(() => { log.push(`close ${id}`); child.emit('close', 0, null); });
    });
    return child;
  };
}

test('D145 the claude-cli transport says the reply has begun once, at the first stream_event line', async () => {
  const log = [];
  let told = 0;
  const request = { system: 'Synthetic system.', prompt: 'Synthetic prompt.' };
  Object.defineProperty(request, REPLY_BEGUN, { value: () => { told++; log.push('told'); } });
  // The stream_event line arrives in two chunks, after the init; a second stream_event follows.
  const half = Math.floor(begun.length / 2);
  const judge = createReviewJudge({ spawnProcess: fakeClaude({ log,
    chunks: [init, begun.slice(0, half), 5, begun.slice(half), 20, begun, reply('{"value":1}')] }) });
  assert.deepEqual(await judge(request), { value: 1 });
  assert.equal(told, 1);
  assert.ok(log.indexOf('told') > log.indexOf('writing 1:3') && log.indexOf('told') < log.indexOf('writing 1:5'),
    `told at the end of the first stream_event line, not before and not at the second: ${log.join(', ')}`);

  // No stream_event: never told, and the call answers as before; nor after an assistant line; nor a request without it.
  for (const chunks of [[init, reply('{"value":2}')], [init, reply('{"value":2}').split('\n')[0] + '\n', begun,
    reply('{"value":2}').split('\n')[1] + '\n']]) {
    told = 0;
    const plain = createReviewJudge({ spawnProcess: fakeClaude({ log: [], chunks }) });
    assert.deepEqual(await plain(request), { value: 2 });
    assert.equal(told, 0);
  }
  // A signal that throws changes nothing about the call.
  const throwing = { system: 'Synthetic system.', prompt: 'Synthetic prompt.' };
  Object.defineProperty(throwing, REPLY_BEGUN, { value: () => { throw new Error('SYNTHETIC'); } });
  const judged = createReviewJudge({ spawnProcess: fakeClaude({ log: [], chunks: [init, begun, reply('{"value":3}')] }) });
  assert.deepEqual(await judged(throwing), { value: 3 });
});

test('D145 end to end: through the answer store, the bound and the transport, later passes start at the first pass\'s reply', async () => {
  const session = redisPivotSession();
  const receipt = { eventId: 'E1', role: 'instruction', quote: 'Do not add any new infrastructure' };
  const decision = { dimension: 'cache backend', chosen: 'Redis', actions: ['E3'],
    value: 'config/redis.yml', valueReceipt: { eventId: 'E3', field: 'path', role: 'action', quote: 'config/redis.yml' },
    constrainedBy: { instruction: { eventId: 'E1', role: 'instruction', quote: 'Add response caching' }, settles: false,
      settledValueQuote: null } };
  const votes = JSON.stringify({ votes: [{ key: 'decisions:0', verdict: 'not-refuted', explanation: 'SYNTHETIC_D145 vote.',
    receipts: [receipt] }] });
  const log = [];
  // The first child prints its reply's start, then answers 60 ms later; the others answer at once.
  const spawnProcess = fakeClaude({ log, chunks: (id) => (id === 1 ? [init, begun, 60, reply(votes)] : [init, begun, reply(votes)]) });
  const judge = memoizeJudge(boundedJudge(createReviewJudge({ spawnProcess })));
  const result = await challengeItems({ items: [{ key: 'decisions:0', type: 'decision', candidate: decision }],
    evidence: 'Synthetic complete evidence.', judge, verifyReceipt: (r) => verifyReceipt(session, r) });
  assert.equal(result.attemptedCalls, 3);
  assert.equal(result.survivors.length, 1);
  const at = (entry) => log.indexOf(entry);
  for (const id of [2, 3]) {
    assert.ok(at(`spawn ${id}`) > at('writing 1:1'), `pass ${id} started before the first pass's reply began: ${log.join(', ')}`);
    assert.ok(at(`spawn ${id}`) < at('close 1'), `pass ${id} waited for the first pass's whole call: ${log.join(', ')}`);
  }
});
