// W3f-2 / F226. D60 replays a well-formed answer for the same request bytes on every later review.
// An answer that left its window incomplete — a challenge reply that never voted on an item, a
// proposal no check could evaluate — was therefore replayed until `--fresh`, although a retry is
// exactly what can complete it. At the end of a review, every stored answer read or written for a
// window an ANSWER left incomplete is removed; a window left incomplete by absent evidence keeps its
// answers, because asking again cannot supply what the record lacks. Every byte here is synthetic.
// No model, no GitHub, no git, no real ~/.sonah — each test gets its own temporary directory.
// D82 step 10: these ran through the removed PR route's review; they run through the session review
// (`reviewSession`, a fresh checkpoint store each time, so only the answer cache carries over).
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Session } from '../../evidence/src/session.js';
import { WINDOW_INCOMPLETE_REASONS, windowIncompleteReasons } from '../../evidence/src/run-review.js';
import { createAnswerCache, memoizeJudge } from '../src/answer-cache.js';
import { ANSWER_INCOMPLETE_REASONS, createSessionReviewStore, reviewSession, windowOfLabel,
  windowsToReask } from '../src/session-review.js';

const IDENTITY = { backend: 'claude-cli', model: 'sonnet' };
const ASK = 'SYNTHETIC_F226_ASK: keep the notes current and update the b module.';
const ASK_QUOTE = 'SYNTHETIC_F226_ASK: keep the notes current';
const PATHS = { 1: 'docs/notes.md', 2: 'b.js', 3: 'docs/more.md' };

async function directory(t, name) {
  const dir = await mkdtemp(join(tmpdir(), `sonah-f226-${name}-`));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return dir;
}

/** Three windows split at two compactions: w1 writes docs/notes.md, w2 b.js, w3 docs/more.md. M35 windowing: a
 *  compaction no longer splits a window, so each step opens with a long thought (370k bytes): no two steps fit a
 *  session review's 200k-token (~720k-byte) work budget, and the one task is cut at its thoughts into three windows. */
function sessionOf() {
  const blobs = { ask: ASK, ok: 'SYNTHETIC_F226_OK: write succeeded' };
  for (const n of [1, 2, 3])
    blobs[`said${n}`] = `SYNTHETIC_F226_SAID_${n}: writing the next file now.\n${'w'.repeat(370_000)}`;
  const whole = (key) => [{ sourceKey: key, fromByte: 0, untilByte: Buffer.byteLength(blobs[key], 'utf8') }];
  let sequence = 0;
  const events = [{ id: 'I1', kind: 'instruction', authority: 'human', sequence: sequence++, text: whole('ask'), supersedes: [] }];
  const step = (n) => {
    events.push({ id: `C${n}`, kind: 'commentary', phase: 'working', sequence: sequence++, text: whole(`said${n}`) });
    events.push({ id: `A${n}`, kind: 'invocation', operation: 'write', tool: 'Write', sequence: sequence++, paths: [{ path: PATHS[n] }] });
    events.push({ id: `O${n}`, kind: 'observation', phase: 'terminal', invocation: `A${n}`, result: 'succeeded',
      sourceOfResult: 'native', terminalStatusProven: true,
      sequence: sequence++, output: whole('ok') });
  };
  step(1);
  events.push({ id: 'B1', kind: 'boundary', boundary: 'compaction', sequence: sequence++ });
  step(2);
  events.push({ id: 'B2', kind: 'boundary', boundary: 'compaction', sequence: sequence++ });
  step(3);
  return new Session({ sessionKey: 'sess-f226', adapter: 'claude', events, blobs });
}
const windowOf = (label) => Number(/:w(\d+)/.exec(label ?? '')?.[1] ?? 0);
function decisionFor(n) {
  return { dimension: `SYNTHETIC_F226_DIMENSION_${n}`, chosen: `Write ${PATHS[n]}`, actions: [`A${n}`], value: PATHS[n],
    valueReceipt: { eventId: `A${n}`, role: 'action', field: 'path', quote: PATHS[n] },
    stated: { eventId: `C${n}`, role: 'commentary', quote: `SYNTHETIC_F226_SAID_${n}` },
    constrainedBy: { instruction: { eventId: 'I1', role: 'instruction', quote: ASK_QUOTE }, settles: false, settledValueQuote: null } };
}
/** Answers honestly, except as `twist(request, answer)` says; records every call it receives. */
function judgeWith(calls = [], twist = (request, answer) => answer) {
  return async (request) => {
    calls.push({ label: request.label, system: request.system, prompt: request.prompt });
    const answer = request.challenge
      ? { votes: request.challenge.items.map(({ key }) => ({ key, verdict: 'not-refuted',
        explanation: 'The recorded instruction supports this synthetic item.',
        receipts: [{ eventId: 'I1', role: 'instruction', quote: ASK_QUOTE }] })) }
      : { decisions: windowOf(request.label) ? [decisionFor(windowOf(request.label))] : [], pivots: [], claims: [],
        requirements: [] };
    return twist(request, answer);
  };
}
const honest = (calls) => judgeWith(calls);
const bytesOf = (request) => JSON.stringify([request.system, request.prompt]);
const cacheIn = (dir) => createAnswerCache(join(dir, 'answers', 'sess'), IDENTITY);
let stores = 0;
/** One session review of `sessionOf()`, its checkpoints in a store of its own. */
const review = (dir, { judge, answerCache }) => reviewSession({ session: sessionOf(), judge, answerCache, ...IDENTITY,
  store: createSessionReviewStore(join(dir, 'review', String(++stores))) });
/** The request keys with a stored answer on disk. */
async function storedKeys(dir) {
  try { return new Set((await readdir(join(dir, 'answers', 'sess'))).filter((f) => f.endsWith('.json')).map((f) => f.split('.')[0])); }
  catch { return new Set(); }
}

/**
 * Review once with `twist`, then check: the windows `expected` (1-based) are exactly the ones an
 * answer left incomplete; their answers are gone from disk and everyone else's are there; the next
 * review asks live exactly those windows' requests; and the review after that asks nothing.
 */
async function reaskedAfter(t, name, twist, expected, reasons) {
  const dir = await directory(t, name);
  const firstCalls = [];
  const first = await review(dir, { judge: judgeWith(firstCalls, twist), answerCache: cacheIn(dir) });
  assert.deepEqual(first.report.windowResults.map(windowIncompleteReasons), reasons, `${name}: premise`);
  const stored = await storedKeys(dir);
  const keysOf = (keep) => new Set(firstCalls.filter((c) => keep(windowOf(c.label))).map((c) => cacheIn(dir).keyOf(c)));
  for (const key of keysOf((n) => expected.includes(n)))
    assert.ok(!stored.has(key), `${name}: an answer of a window left incomplete by its answer was kept`);
  for (const key of keysOf((n) => !expected.includes(n)))
    assert.ok(stored.has(key), `${name}: an answer of another window was removed`);

  const every = [];
  await review(await directory(t, `${name}-every`), { judge: honest(every),
    answerCache: createAnswerCache(join(await directory(t, `${name}-none`), 'answers'), IDENTITY) });
  const live = [];
  const second = await review(dir, { judge: honest(live), answerCache: cacheIn(dir) });
  t.diagnostic(`${name}: the next review asked ${live.length} of ${every.length} requests live`);
  assert.ok(live.length > 0, `${name}: nothing was asked again`);
  assert.deepEqual(live.map(bytesOf).sort(), every.filter((c) => expected.includes(windowOf(c.label))).map(bytesOf).sort(),
    `${name}: the next review asks exactly the requests of the windows its answers left incomplete`);
  assert.deepEqual(second.report.windowResults.map(windowIncompleteReasons), [[], [], []], `${name}: completed by the retry`);
  const third = [];
  await review(dir, { judge: honest(third), answerCache: cacheIn(dir) });
  assert.deepEqual(third, [], `${name}: a complete window's answers are kept`);
}

test('F226 a challenge reply that never voted on an item: its window is asked again next review, and only it', async (t) => {
  // Every challenge reply for window 1 is readable and votes on nothing, first time and re-ask alike.
  await reaskedAfter(t, 'votes-invalid', (request, answer) => (request.challenge && windowOf(request.label) === 1
    ? { votes: [] } : answer), [1], [['challenge:votes_invalid'], [], []]);
});

test('F226 a proposal no check could evaluate (a decision citing no action) leaves grounding incomplete: its window is asked again', async (t) => {
  await reaskedAfter(t, 'grounding-session', (request, answer) => (request.label === 'narrative:w3'
    ? { ...answer, decisions: answer.decisions.map((d) => ({ ...d, actions: [] })) } : answer),
  [3], [[], [], ['grounding:session']]);
});

test('F226 a proposal outside the response contract could not be challenged: its window is asked again', async (t) => {
  await reaskedAfter(t, 'items-unresolved', (request, answer) => (request.label === 'narrative:w2'
    ? { ...answer, pivots: [{ abandoned: 'SYNTHETIC_F226_PIVOT', adopted: 'SYNTHETIC_F226_OTHER' }] } : answer),
  [2], [[], ['challenge:items_unresolved'], []]);
});

test('F226 the reasons an answer is responsible for are members of the closed list, and none is absent evidence', () => {
  for (const reason of ANSWER_INCOMPLETE_REASONS) assert.ok(WINDOW_INCOMPLETE_REASONS.includes(reason), reason);
  assert.deepEqual([...ANSWER_INCOMPLETE_REASONS].sort(),
    ['challenge:items_unresolved', 'challenge:votes_invalid', 'grounding:session']);
  for (const absent of ['grounding:relevance', 'narrative:budget', 'narrative:input_invalid', 'challenge:budget_exhausted'])
    assert.ok(!ANSWER_INCOMPLETE_REASONS.includes(absent), absent);
  // A window record nobody can read is asked about by nobody.
  assert.deepEqual([...windowsToReask([null, {}, { windowIndex: 'x', failure: null }])], []);
});

test('F226 every label a review gives a request maps to its window; a code-only chunk belongs to none', () => {
  // D82 step 10: the labels the session review gives, and those the removed PR route gave (still parsed: a stored
  // answer's label is never trusted to be the session route's).
  for (const label of ['narrative:w3', 'narrative:w3:receipt-repair', 'challenge:w4:b1:p2', 'challenge:w4:reask:p2',
    'code+narrative:w12:receipt-repair', 'challenge:narrative:w5:joint:reask:p1'])
    assert.equal(windowOfLabel(label), windowOf(label), label);
  for (const label of [undefined, null, 'code+chunk:2', 'challenge:chunk:2:joint:b1:p1', 'narrative:w0', 'SYNTHETIC'])
    assert.equal(windowOfLabel(label), null, String(label));
});

test('F226 forget removes exactly the stored answers this review read or wrote under the chosen labels', async (t) => {
  const cache = cacheIn(await directory(t, 'forget'));
  const ask = (n, label) => ({ system: 'SYNTHETIC_S', prompt: `SYNTHETIC_P_${n}`, label });
  const first = memoizeJudge(async () => ({ votes: [] }), cache);
  await first(ask(1, 'challenge:w1:b1:p1'));
  await first(ask(2, 'code+narrative:w2'));
  // A second review reads one answer, writes another, and forgets window 1 only.
  const second = memoizeJudge(async () => ({ votes: [] }), cache);
  await second(ask(1, 'challenge:w1:b1:p1'));
  await second(ask(3, 'code+narrative:w1'));
  assert.equal(await second.forget((label) => windowOfLabel(label) === 1), 2);
  assert.equal(await cache.get(ask(1)), null, 'the answer read for window 1 is gone');
  assert.equal(await cache.get(ask(3)), null, 'the answer written for window 1 is gone');
  assert.deepEqual(await cache.get(ask(2)), { votes: [] }, 'an answer this review never touched is kept');
  assert.equal(await cache.remove('not-a-key', 0), false);
  assert.equal(await memoizeJudge(async () => ({}))
    .forget(() => true), 0, 'with no cache there is nothing to forget');
});
