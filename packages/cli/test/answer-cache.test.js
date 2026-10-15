// W3f-1 (D60). One reuse rule: a model request whose exact bytes were answered before is given that
// answer, with no call; every other request is live; every deterministic step re-runs on every
// review. Every byte here is synthetic: invented instructions, paths and tool output. No model, no
// GitHub, no git, no real ~/.sonah — each test gets its own temporary directory. (D82 step 10: the
// review-level tests ran through the removed PR route; the session route's are in session-review.test.js
// and session-review-command.test.js.)
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { chmod, lstat, mkdtemp, open, readFile, readdir, rm, stat, symlink, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CHALLENGE_SCHEMA } from '../../evidence/src/challenge.js';
import { REVIEW_TRANSPORT_VERSION, reviewTransportArguments } from '../src/review-judge.js';
import { ANSWER_CACHE_VERSION, ANSWER_STORE_MAX_BYTES, SENT_FIELDS, answerKey, createAnswerCache,
  memoizeJudge } from '../src/answer-cache.js';
import { windowOfLabel } from '../src/session-review.js';

const IDENTITY = { backend: 'claude-cli', model: 'sonnet' };

async function directory(t, name) {
  const dir = await mkdtemp(join(tmpdir(), `sonah-ans-${name}-`));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return dir;
}

// ---- the key ------------------------------------------------------------------------------------
test('D60 the key is SHA-256 over exactly what the transport sends, and who answers it — never the label', () => {
  assert.deepEqual(SENT_FIELDS, ['system', 'prompt']);
  // W3f-2 / F227: and the transport's own arguments, as the transport builds them.
  const expected = createHash('sha256').update(JSON.stringify({ v: ANSWER_CACHE_VERSION, transport: REVIEW_TRANSPORT_VERSION,
    backend: 'claude-cli', model: 'sonnet', args: reviewTransportArguments({ backend: 'claude-cli', model: 'sonnet', system: 'SYNTHETIC_S' }),
    system: 'SYNTHETIC_S', prompt: 'SYNTHETIC_P' })).digest('hex');
  const request = { system: 'SYNTHETIC_S', prompt: 'SYNTHETIC_P' };
  assert.equal(answerKey(request, IDENTITY), expected);
  // Nothing the transport does not send is in the key.
  for (const unsent of [{ label: 'narrative:w1' }, { label: 'challenge:w9:b1:p3' }, { schema: CHALLENGE_SCHEMA },
    { window: { index: 4 } }, { evidencePrompt: 'SYNTHETIC_OTHER' }, { challenge: { items: [], pass: 2 } }])
    assert.equal(answerKey({ ...request, ...unsent }, IDENTITY), expected, `${Object.keys(unsent)} is not sent`);
  // Everything it does send, and who answers, is.
  for (const [changed, identity] of [[{ system: 'SYNTHETIC_S ' }, IDENTITY], [{ prompt: 'SYNTHETIC_P\n' }, IDENTITY],
    [{}, { ...IDENTITY, model: 'opus' }], [{}, { backend: 'anthropic-api', model: 'sonnet' }]])
    assert.notEqual(answerKey({ ...request, ...changed }, identity), expected);
  assert.equal(answerKey({ prompt: 'SYNTHETIC_P' }, IDENTITY), null, 'a request the transport cannot send has no key');
});

test('F227 the key binds the transport\'s own arguments: one changed without a version bump is a miss', async (t) => {
  const dir = await directory(t, 'arguments');
  const request = { system: 'SYNTHETIC_S', prompt: 'SYNTHETIC_P' };
  const API = { backend: 'anthropic-api', model: 'claude-synthetic-1' };
  for (const identity of [IDENTITY, API]) {
    assert.equal(await createAnswerCache(dir, identity).put(request, { votes: [] }), true);
    assert.deepEqual(await createAnswerCache(dir, identity).get(request), { votes: [] }, 'premise: the same arguments hit');
  }
  const changed = (identity, change) => createAnswerCache(dir, { ...identity,
    transportArguments: (input) => change(structuredClone(reviewTransportArguments(input))) });
  for (const [name, identity, change] of [
    ['one more CLI flag', IDENTITY, (a) => ({ argv: [...a.argv.slice(0, -2), '--synthetic-flag', ...a.argv.slice(-2)] })],
    ['another CLI output format', IDENTITY, (a) => ({ argv: a.argv.map((v) => (v === 'stream-json' ? 'json' : v)) })],
    ['another API max_tokens', API, (a) => ({ ...a, body: { ...a.body, max_tokens: a.body.max_tokens / 2 } })],
    ['one more API body field', API, (a) => ({ ...a, body: { ...a.body, temperature: 0 } })],
    ['another API version', API, (a) => ({ ...a, version: '2099-01-01' })],
    ['another API endpoint', API, (a) => ({ ...a, url: 'https://example.invalid/v1/messages' })],
  ]) assert.equal(await changed(identity, change).get(request), null, `${name} replayed an answer given under other arguments`);
  assert.equal(REVIEW_TRANSPORT_VERSION, 'sonah.review-transport/3', 'no transport version was bumped for any of them');
});

test('D60 the same bytes under two labels hit', async (t) => {
  const cache = createAnswerCache(await directory(t, 'label'), IDENTITY);
  const first = memoizeJudge(async () => ({ votes: [] }), cache);
  await first({ system: 'SYNTHETIC_S', prompt: 'SYNTHETIC_P', label: 'code+narrative:w1' });
  const second = memoizeJudge(async () => assert.fail('the same bytes were asked again'), cache);
  assert.deepEqual(await second({ system: 'SYNTHETIC_S', prompt: 'SYNTHETIC_P', label: 'code+narrative:w7' }), { votes: [] });
  assert.deepEqual(second.answers, { calls: 0, reused: 1 });
});

// ---- the store ----------------------------------------------------------------------------------
test('D60 a stored answer is { key, occurrence, response } only — no request text — in 0600 files under 0700 directories', async (t) => {
  const root = await directory(t, 'store');
  const cache = createAnswerCache(join(root, 'answers', 'sess'), IDENTITY);
  const request = { system: 'SYNTHETIC_SYSTEM_TEXT', prompt: 'SYNTHETIC_PROMPT_TEXT', label: 'SYNTHETIC_LABEL' };
  assert.equal(await cache.put(request, { votes: [] }), true);
  const files = await readdir(cache.directory);
  const key = cache.keyOf(request);
  assert.deepEqual(files, [`${key}.0.json`]);
  const bytes = await readFile(join(cache.directory, files[0]), 'utf8');
  assert.deepEqual(JSON.parse(bytes), { key, occurrence: 0, response: { votes: [] } });
  for (const text of ['SYNTHETIC_SYSTEM_TEXT', 'SYNTHETIC_PROMPT_TEXT', 'SYNTHETIC_LABEL'])
    assert.ok(!bytes.includes(text), `the stored record carries ${text}`);
  assert.equal((await stat(join(cache.directory, files[0]))).mode & 0o777, 0o600);
  assert.equal((await stat(cache.directory)).mode & 0o777, 0o700);
  assert.equal((await stat(join(root, 'answers'))).mode & 0o777, 0o700);
  assert.deepEqual(await cache.get(request), { votes: [] });
  assert.equal(await cache.get(request, 1), null, 'a different occurrence is a different answer');
});

test('D60 only a successful answer is stored: never null, an array, a scalar, or an object the request did not ask for', async (t) => {
  const cache = createAnswerCache(join(await directory(t, 'invalid'), 'answers', 'sess'), IDENTITY);
  const request = { system: 'SYNTHETIC_S', prompt: 'SYNTHETIC_P', schema: CHALLENGE_SCHEMA };
  for (const invalid of [null, undefined, [], 'text', 7, true, {}, { votes: 'not a list' }, { votes: [], extra: 1 },
    Object.assign(Object.create({ inherited: true }), { votes: [] })])
    assert.equal(await cache.put(request, invalid), false, `${JSON.stringify(invalid)} was stored`);
  await assert.rejects(readdir(cache.directory), { code: 'ENOENT' }, 'nothing was written, not even the directory');
  assert.equal(await cache.put(request, { votes: [] }), true);
  assert.equal(await cache.put({ ...request, schema: undefined, prompt: 'SYNTHETIC_Q' }, { anything: 1 }), true,
    'a request with no schema is answered by any JSON object');
});

test('D60 a failed, timed-out or refused call is rethrown and never stored; the next review asks it again', async (t) => {
  const cache = createAnswerCache(await directory(t, 'failed'), IDENTITY);
  const request = { system: 'SYNTHETIC_S', prompt: 'SYNTHETIC_P', label: 'code+narrative:w1' };
  for (const code of ['model_timeout', 'model_output_limit', 'model_response_incomplete', 'model_unavailable',
    'model_response_invalid', 'invalid_model_input', 'budget_exhausted']) {
    const failing = memoizeJudge(async () => { throw Object.assign(new Error('synthetic'), { code }); }, cache);
    await assert.rejects(failing(request), { code });
    assert.deepEqual(failing.answers, { calls: 1, reused: 0 });
  }
  const nothing = memoizeJudge(async () => null, cache);
  assert.equal(await nothing(request), null, 'an invalid response still reaches the review, which names it');
  assert.equal(await cache.get(request), null);
  let live = 0;
  const next = memoizeJudge(async () => { live++; return { votes: [] }; }, cache);
  await next(request);
  assert.equal(live, 1, 'asked live again');
});

test('D60 a corrupt, foreign or mismatched cache file is a miss, never a crash, and the live answer replaces it', async (t) => {
  const cache = createAnswerCache(await directory(t, 'corrupt'), IDENTITY);
  const request = { system: 'SYNTHETIC_S', prompt: 'SYNTHETIC_P', schema: CHALLENGE_SCHEMA };
  await cache.put(request, { votes: [] });
  const path = join(cache.directory, `${cache.keyOf(request)}.0.json`);
  const other = cache.keyOf({ ...request, prompt: 'SYNTHETIC_OTHER' });
  for (const bytes of ['{ not json', '', 'null', '[]', JSON.stringify({ key: other, occurrence: 0, response: { votes: [] } }),
    JSON.stringify({ key: cache.keyOf(request), occurrence: 1, response: { votes: [] } }),
    JSON.stringify({ key: cache.keyOf(request), occurrence: 0, response: { votes: 'no' } }),
    JSON.stringify({ key: cache.keyOf(request), occurrence: 0 })]) {
    await writeFile(path, bytes);
    assert.equal(await cache.get(request), null, `${bytes} was read as an answer`);
  }
  let live = 0;
  const judge = memoizeJudge(async () => { live++; return { votes: [] }; }, cache);
  assert.deepEqual(await judge(request), { votes: [] });
  assert.equal(live, 1);
  assert.deepEqual(await cache.get(request), { votes: [] }, 'the live answer replaced the corrupt file');
});

test('D60 one request asked three times in one review keeps three answers: one stored vote is never counted three times', async (t) => {
  const cache = createAnswerCache(await directory(t, 'passes'), IDENTITY);
  const request = { system: 'SYNTHETIC_S', prompt: 'SYNTHETIC_CHALLENGE_BATCH' };
  let n = 0;
  const first = memoizeJudge(async () => ({ vote: ++n }), cache);
  const asked = await Promise.all([1, 2, 3].map((pass) => first({ ...request, label: `challenge:w1:b1:p${pass}` })));
  // Three calls, three answers — in whatever order the calls happened to reach the judge.
  assert.deepEqual(asked.map(({ vote }) => vote).sort(), [1, 2, 3], 'three independent calls');
  assert.deepEqual(first.answers, { calls: 3, reused: 0 });
  const replay = memoizeJudge(async () => assert.fail('no call'), cache);
  assert.deepEqual(await Promise.all([1, 2, 3].map((pass) => replay({ ...request, label: `challenge:w1:b1:p${pass}` }))),
    asked, 'each pass is given its own answer, in the order it was asked');
  const more = memoizeJudge(async () => ({ vote: ++n }), cache);
  for (let pass = 1; pass <= 4; pass++) await more(request);
  assert.deepEqual(more.answers, { calls: 1, reused: 3 }, 'a fourth ask has no fourth answer, and is live');
});

test('D60 fresh skips every lookup and still stores what it gets', async (t) => {
  const cache = createAnswerCache(await directory(t, 'fresh'), IDENTITY);
  const request = { system: 'SYNTHETIC_S', prompt: 'SYNTHETIC_P' };
  await memoizeJudge(async () => ({ answer: 'old' }), cache)(request);
  const fresh = memoizeJudge(async () => ({ answer: 'new' }), cache, { fresh: true });
  assert.deepEqual(await fresh(request), { answer: 'new' });
  assert.deepEqual(fresh.answers, { calls: 1, reused: 0 });
  assert.deepEqual(await cache.get(request), { answer: 'new' });
});

// ---- the bound (W3f-2 / F228) ---------------------------------------------------------------------
/** Store `count` answers of one size, each with its own modification time, oldest first. */
async function filled(dir, count, { maxBytes } = {}) {
  const cache = createAnswerCache(dir, { ...IDENTITY, ...(maxBytes === undefined ? {} : { maxBytes }) });
  const requests = Array.from({ length: count }, (_, i) => ({ system: 'SYNTHETIC_S', prompt: `SYNTHETIC_P_${i}` }));
  for (const [i, request] of requests.entries()) {
    assert.equal(await cache.put(request, { votes: [], note: `SYNTHETIC_ANSWER_${i}` }), true);
    const when = new Date(Date.UTC(2026, 0, 1, 0, i));
    await utimes(join(dir, `${cache.keyOf(request)}.0.json`), when, when);
  }
  const size = (await stat(join(dir, `${cache.keyOf(requests[0])}.0.json`))).size;
  return { cache, requests, size };
}
const present = async (cache, requests) => {
  const names = new Set(await readdir(cache.directory));
  return requests.map((r) => names.has(`${cache.keyOf(r)}.0.json`));
};

test('F228 a recording\'s store is bounded: the answers used longest ago go first, until the rest fit', async (t) => {
  assert.equal(ANSWER_STORE_MAX_BYTES, 64 * 1024 * 1024, 'a frozen literal');
  const dir = await directory(t, 'bound');
  const { size } = await filled(dir, 1);
  await rm(dir, { recursive: true, force: true });
  const { cache, requests } = await filled(dir, 5, { maxBytes: 3 * size });
  // Not an answer: never counted, never removed.
  await writeFile(join(dir, '.SYNTHETIC.tmp'), 'x'.repeat(10 * size));
  await writeFile(join(dir, 'SYNTHETIC_NOTE.txt'), 'x');
  assert.deepEqual(await cache.prune(), { removed: 2, bytes: 3 * size });
  assert.deepEqual(await present(cache, requests), [false, false, true, true, true]);
  assert.ok((await readdir(dir)).includes('.SYNTHETIC.tmp') && (await readdir(dir)).includes('SYNTHETIC_NOTE.txt'));
  assert.deepEqual(await cache.prune(), { removed: 0, bytes: 3 * size }, 'a store that fits is left alone');
  assert.deepEqual(await createAnswerCache(join(dir, 'SYNTHETIC_ABSENT'), IDENTITY).prune(), { removed: 0, bytes: 0 });
  assert.throws(() => createAnswerCache(dir, { ...IDENTITY, maxBytes: -1 }), TypeError);
});

test('F228 a hit refreshes its answer\'s modification time: an answer still asked for outlives one that is not', async (t) => {
  const dir = await directory(t, 'lru');
  const { size } = await filled(dir, 1);
  await rm(dir, { recursive: true, force: true });
  const { cache, requests } = await filled(dir, 3, { maxBytes: 2 * size });
  const before = (await stat(join(dir, `${cache.keyOf(requests[0])}.0.json`))).mtimeMs;
  assert.deepEqual((await cache.get(requests[0])).votes, [], 'premise: a hit');
  assert.ok((await stat(join(dir, `${cache.keyOf(requests[0])}.0.json`))).mtimeMs > before, 'the hit moved its time to now');
  assert.deepEqual(await cache.prune(), { removed: 1, bytes: 2 * size });
  assert.deepEqual(await present(cache, requests), [true, false, true], 'the oldest answer nobody read went, not the one read');
});

// ---- M33: owner-only reads, synced writes, per-label accounting ------------------------------------
test('M33 a stored answer is read only from a regular owner-only file: a symlink, a group/other mode or another owner is a miss', async (t) => {
  const dir = await directory(t, 'owner-only');
  const cache = createAnswerCache(join(dir, 'answers'), IDENTITY);
  const request = { system: 'SYNTHETIC_S', prompt: 'SYNTHETIC_P' };
  assert.equal(await cache.put(request, { votes: [] }), true);
  const path = join(cache.directory, `${cache.keyOf(request)}.0.json`);
  const bytes = await readFile(path, 'utf8');
  assert.deepEqual(await cache.get(request), { votes: [] }, 'premise: a hit');
  for (const mode of [0o644, 0o640, 0o604, 0o660]) {
    await chmod(path, mode);
    assert.equal(await cache.get(request), null, `a ${mode.toString(8)} answer file was replayed`);
  }
  await chmod(path, 0o600);
  assert.deepEqual(await cache.get(request), { votes: [] });
  const original = process.getuid;
  process.getuid = () => original.call(process) + 1;
  try { assert.equal(await cache.get(request), null, 'an answer file owned by another user was replayed'); }
  finally { process.getuid = original; }
  const planted = join(dir, 'planted.json');
  await writeFile(planted, bytes, { mode: 0o600 });
  await rm(path);
  await symlink(planted, path);
  assert.equal(await cache.get(request), null, 'a symlinked answer file was replayed');
  let live = 0;
  const judge = memoizeJudge(async () => { live++; return { votes: [] }; }, cache);
  assert.deepEqual(await judge(request), { votes: [] });
  assert.equal(live, 1, 'the miss was asked live');
  const info = await lstat(path);
  assert.ok(info.isFile() && (info.mode & 0o777) === 0o600, 'the live answer replaced the link with an owner-only file');
  assert.equal(await readFile(planted, 'utf8'), bytes, 'the link target was never written through');
});

test('M33 a stored answer is synced to disk before it is renamed into place', async (t) => {
  const dir = await directory(t, 'sync');
  const probe = await open(join(dir, 'probe'), 'w');
  const prototype = Object.getPrototypeOf(probe);
  await probe.close();
  const sync = prototype.sync;
  let synced = 0;
  prototype.sync = function patched(...args) { synced++; return sync.apply(this, args); };
  try {
    const cache = createAnswerCache(join(dir, 'answers'), IDENTITY);
    assert.equal(await cache.put({ system: 'SYNTHETIC_S', prompt: 'SYNTHETIC_P' }, { votes: [] }), true);
  } finally { prototype.sync = sync; }
  assert.ok(synced >= 1, 'the answer was renamed into place without a file sync');
});

test('M33 memoizeJudge names each window\'s stored answers in dispatch order and counts live and reused calls per label', async (t) => {
  const cache = createAnswerCache(await directory(t, 'per-label'), IDENTITY);
  const challenge = { system: 'SYNTHETIC_S', prompt: 'SYNTHETIC_CHALLENGE' };
  const requests = [{ system: 'SYNTHETIC_S', prompt: 'SYNTHETIC_N1', label: 'narrative:w1' },
    ...[1, 2, 3].map((pass) => ({ ...challenge, label: `challenge:w1:b1:p${pass}` })),
    { system: 'SYNTHETIC_S', prompt: 'SYNTHETIC_N2', label: 'narrative:w2' }];
  // Answers come back in the reverse of the order they were asked.
  const slow = (request) => new Promise((resolve) => setTimeout(() => resolve({ votes: [] }),
    (requests.length - requests.findIndex((r) => r.label === request.label)) * 4));
  const first = memoizeJudge(slow, cache);
  await Promise.all(requests.map((request) => first(request)));
  const inWindow = (n) => (label) => windowOfLabel(label) === n;
  const expected = [{ label: 'narrative:w1', key: cache.keyOf(requests[0]), occurrence: 0 },
    ...[1, 2, 3].map((pass) => ({ label: `challenge:w1:b1:p${pass}`, key: cache.keyOf(challenge), occurrence: pass - 1 }))];
  assert.deepEqual(first.touchedFor(inWindow(1)), expected, 'dispatch order, never completion order');
  assert.deepEqual(first.answersFor(inWindow(1)), { calls: 4, reused: 0 });
  assert.deepEqual(first.answersFor(inWindow(2)), { calls: 1, reused: 0 });
  assert.deepEqual(first.answers, { calls: 5, reused: 0 }, 'the whole-review counts are unchanged');
  first.touchedFor(inWindow(1)).pop();
  assert.equal(first.touchedFor(inWindow(1)).length, 4, 'a caller gets a copy');
  const second = memoizeJudge(async () => assert.fail('no call'), cache);
  await Promise.all(requests.map((request) => second(request)));
  assert.deepEqual(second.touchedFor(inWindow(1)), expected);
  assert.deepEqual(second.answersFor(inWindow(1)), { calls: 0, reused: 4 });
  assert.deepEqual(second.answers, { calls: 0, reused: 5 });
});
