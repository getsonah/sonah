// D60 (W3f-1). One rule: a model request whose exact bytes were answered before is answered from the
// answer cache, with no call; every other request is live; every deterministic step re-runs on every
// review, on stored and live answers alike. A stored answer is never trusted more than a live one.
//
// D82 step 10: these tests ran through the removed PR route's review, reusing a session window's
// answers across two pull requests. They run through the session review (`reviewSession`, a fresh
// checkpoint store each time, so only the answer cache carries over): the second review of the same
// session asks nothing, and re-derives everything from the stored answers. The PR-only tests (reuse
// across targets, relevance against a PR's files, the per-target history, the CLI's PR lines) went
// with the route. Every byte here is synthetic: invented instructions, paths and tool output. No
// model, no GitHub, no git, no real ~/.sonah — each test gets its own temporary directory.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Session } from '../../evidence/src/session.js';
import { WINDOW_SETTINGS, planWindows } from '../../evidence/src/windows.js';
import { createAnswerCache } from '../src/answer-cache.js';
import { createSessionReviewStore, reviewSession } from '../src/session-review.js';

const ASK = 'SYNTHETIC_SWR_ASK: keep the notes current and update the b module.';
const ASK_QUOTE = 'SYNTHETIC_SWR_ASK: keep the notes current';
const PATHS = { 1: 'docs/notes.md', 2: 'b.js', 3: 'docs/more.md' };
const IDENTITY = { backend: 'claude-cli', model: 'sonnet' };

/**
 * Three windows, split at two recorded compactions. Window 1 writes a notes file, window 2 the b module, window 3 a
 * second notes file. M35 windowing: a compaction no longer splits a window, so each step opens with a long thought
 * (370k bytes): no two steps fit a session review's 200k-token (~720k-byte) work budget, and the one task is cut at
 * its thoughts into three windows (each compaction now closes the window before it).
 */
function sessionOf() {
  const blobs = { ask: ASK, ok: 'SYNTHETIC_SWR_OK: write succeeded' };
  for (const n of [1, 2, 3])
    blobs[`said${n}`] = `SYNTHETIC_SWR_SAID_${n}: writing the next file now.\n${'w'.repeat(370_000)}`;
  const whole = (key) => [{ sourceKey: key, fromByte: 0, untilByte: Buffer.byteLength(blobs[key], 'utf8') }];
  let sequence = 0;
  const events = [{ id: 'I1', kind: 'instruction', authority: 'human', sequence: sequence++, text: whole('ask'), supersedes: [] }];
  const step = (n) => {
    events.push({ id: `C${n}`, kind: 'commentary', phase: 'working', sequence: sequence++, text: whole(`said${n}`) });
    events.push({ id: `A${n}`, kind: 'invocation', operation: 'write', tool: 'Write', sequence: sequence++,
      paths: [{ path: PATHS[n] }] });
    events.push({ id: `O${n}`, kind: 'observation', phase: 'terminal', invocation: `A${n}`, result: 'succeeded',
      sourceOfResult: 'native', terminalStatusProven: true, sequence: sequence++, output: whole('ok') });
  };
  step(1);
  events.push({ id: 'B1', kind: 'boundary', boundary: 'compaction', sequence: sequence++ });
  step(2);
  events.push({ id: 'B2', kind: 'boundary', boundary: 'compaction', sequence: sequence++ });
  step(3);
  return new Session({ sessionKey: 'sess-swr', adapter: 'claude', events, blobs });
}

const windowOf = (label) => Number(/:w(\d+)/.exec(label ?? '')?.[1] ?? 0);
function decisionFor(n) {
  const path = PATHS[n];
  return { dimension: `SYNTHETIC_SWR_DIMENSION_${n}`, chosen: `Write ${path}`, actions: [`A${n}`], value: path,
    valueReceipt: { eventId: `A${n}`, role: 'action', field: 'path', quote: path },
    stated: { eventId: `C${n}`, role: 'commentary', quote: `SYNTHETIC_SWR_SAID_${n}` },
    constrainedBy: { instruction: { eventId: 'I1', role: 'instruction', quote: ASK_QUOTE },
      settles: false, settledValueQuote: null } };
}

/** Answers honestly: one grounded decision per window, votes that verify; records every call it receives. */
function honestJudge(calls = []) {
  return async (request) => {
    calls.push({ label: request.label, system: request.system, prompt: request.prompt,
      challenge: Boolean(request.challenge) });
    if (request.challenge) return { votes: request.challenge.items.map(({ key }) => ({ key, verdict: 'not-refuted',
      explanation: 'The recorded instruction supports this synthetic item.',
      receipts: [{ eventId: 'I1', role: 'instruction', quote: ASK_QUOTE }] })) };
    const n = windowOf(request.label);
    return { decisions: n ? [decisionFor(n)] : [], pivots: [], claims: [], requirements: [] };
  };
}
const narrativeCalls = (calls) => calls.filter((c) => /^narrative:w\d+$/.test(c.label));

async function directory(t, name) {
  const dir = await mkdtemp(join(tmpdir(), `sonah-swr-${name}-`));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return dir;
}
const cacheIn = (dir) => createAnswerCache(join(dir, 'answers'), IDENTITY);
let stores = 0;
/** One session review of `sessionOf()`, its checkpoints in a store of its own. */
const review = async (dir, judge, answerCache = cacheIn(dir)) => (await reviewSession({ session: sessionOf(), judge,
  answerCache, ...IDENTITY, store: createSessionReviewStore(join(dir, 'review', String(++stores))) })).report;

test('the premise: three windows, one per step', () => {
  assert.deepEqual(planWindows(sessionOf(), WINDOW_SETTINGS).map((w) => w.events.map((e) => e.id)),
    [['I1', 'C1', 'A1', 'O1', 'B1'], ['C2', 'A2', 'O2', 'B2'], ['C3', 'A3', 'O3']]);
});

// W3d-3 (D58): a window whose checks all RAN, one of them inconclusive. Its answers are reused
// like any other; the inconclusive count is re-derived from them. On the session review (D71) the
// unsettled decision is kept at its weakest status — `unsettled`, its column not checked — and a
// stored answer never makes it read as settled.
test('W3d-3 a window whose challengers could not settle an item is replayed with that count', async (t) => {
  const dir = await directory(t, 'inconclusive');
  // Every challenge pass of window 1 votes `uncertain` on its decision: voted on, never settled.
  const unsure = (calls) => {
    const honest = honestJudge(calls);
    return async (request) => (request.challenge && /^challenge:w1:/.test(request.label ?? '')
      ? (calls.push({ label: request.label, challenge: true }), { votes: request.challenge.items.map(({ key }) => ({ key,
        verdict: 'uncertain', explanation: 'The synthetic evidence does not settle this.', receipts: [] })) })
      : honest(request));
  };
  const callsA = [], callsB = [];
  const a = await review(dir, unsure(callsA));
  assert.equal(a.windowResults[0].challenge.complete, true, 'every planned challenge call ran and voted');
  assert.equal(a.windowResults[0].challenge.unsettledItems, 1);
  assert.equal(a.withheld.unsettled, 1);
  const unsettled = (report) => report.decisions.filter((d) => d.reasons.includes('unsettled'))
    .map((d) => [d.dimension, d.columnState]);
  assert.deepEqual(unsettled(a), [['SYNTHETIC_SWR_DIMENSION_1', 'unchecked']],
    'window 1\'s decision is kept, not checked');

  const b = await review(dir, unsure(callsB));
  assert.deepEqual(callsB, [], 'every request was answered from the cache');
  assert.equal(b.windowResults[0].challenge.unsettledItems, 1, 'the count is re-derived from the stored votes');
  assert.equal(b.withheld.unsettled, 1);
  assert.deepEqual(unsettled(b), unsettled(a), 'and it is not read as settled from the cache');
  assert.equal(b.coverage, a.coverage);
});

// W3d-4 (D58): a window that withheld a proposal because its quote did not match the record ran
// every check. Its answer is reused like any other, and the proposal is withheld again, never shown.
test('W3d-4 a window that withheld a proposal for a bad quote is replayed with it withheld', async (t) => {
  const dir = await directory(t, 'withheld-quote');
  const NEVER_SAID = 'SYNTHETIC_SWR_NEVER_SAID_ANYWHERE';
  // Window 1 answers its grounded decision and a second one whose stated quote was never said.
  const withholding = (calls) => {
    const honest = honestJudge(calls);
    return async (request) => {
      const answer = await honest(request);
      if (request.label !== 'narrative:w1') return answer;
      return { ...answer, decisions: [...answer.decisions, { ...decisionFor(1), dimension: 'SYNTHETIC_SWR_DIMENSION_WITHHELD',
        stated: { eventId: 'C1', role: 'commentary', quote: NEVER_SAID } }] };
    };
  };
  const callsA = [], callsB = [];
  const a = await review(dir, withholding(callsA));
  const [w1] = a.windowResults;
  assert.equal(w1.shortfall.grounding.rejected, 1, 'premise: one receipt of window 1 did not verify');
  assert.equal(w1.groundingComplete, true, 'premise: the check ran — D58 complete');
  assert.equal(a.withheld.proposals, 1);

  const b = await review(dir, withholding(callsB));
  assert.deepEqual(callsB, [], 'every request was answered from the cache');
  assert.equal(b.windowResults[0].shortfall.grounding.rejected, 1, 'withheld again, from the same answer');
  assert.equal(b.withheld.proposals, 1);
  assert.deepEqual(b.decisions.map((d) => d.dimension).sort(),
    ['SYNTHETIC_SWR_DIMENSION_1', 'SYNTHETIC_SWR_DIMENSION_2', 'SYNTHETIC_SWR_DIMENSION_3']);
  assert.ok(!JSON.stringify([b.decisions, b.findings]).includes(NEVER_SAID), 'never published from the cache');
});

// ---- a stored answer is never trusted -------------------------------------------------------
test('D60 (F90) a stored answer whose quote no longer verifies is grounded again exactly like a live one; the quote is never published', async (t) => {
  const dir = await directory(t, 'tampered');
  const asked = [];
  const inner = honestJudge();
  await review(dir, async (request) => { asked.push(request); return inner(request); });
  // Window 3's stored answer is altered on disk: still the right shape, still citing an event its
  // request showed — only the quote is one the record never held.
  const cache = cacheIn(dir);
  const request = asked.find((r) => r.label === 'narrative:w3');
  const stored = await cache.get(request);
  stored.decisions[0].constrainedBy.instruction.quote = 'SYNTHETIC_SWR_NEVER_RECORDED_ANYWHERE';
  assert.equal(await cache.put(request, stored), true);
  const calls = [];
  const b = await review(dir, honestJudge(calls));
  assert.ok(!narrativeCalls(calls).some((c) => c.label === 'narrative:w3'), 'the stored answer was used');
  const w3 = b.windowResults[2];
  assert.equal(w3.failure, null);
  assert.equal(w3.shortfall.narrative, 'ok', 'a stored answer is never a model JSON-parse failure');
  assert.equal(w3.shortfall.grounding.rejected, 1, 'the altered quote did not verify');
  const third = (report) => report.decisions.find((d) => d.dimension === 'SYNTHETIC_SWR_DIMENSION_3');
  // D58: an authority receipt that does not verify is dropped, and the column is shown UNCHECKED —
  // never asserted from a quote the record does not hold.
  assert.equal(third(b).constrainedBy, null);
  assert.equal(third(b).columnState, 'unchecked');
  assert.ok(!JSON.stringify([b.decisions, b.findings]).includes('NEVER_RECORDED'), 'never published');
  // Exactly what a live answer carrying that quote gets: a stored answer is never trusted more.
  const live = await review(await directory(t, 'tampered-live'),
    async (r) => (r.label === 'narrative:w3' ? structuredClone(stored) : honestJudge()(r)));
  assert.deepEqual(third(b), third(live));
});

test('D60 (F90) an unreadable answer file is a miss, never a model failure: the request is asked live', async (t) => {
  const dir = await directory(t, 'unreadable');
  const asked = [];
  const inner = honestJudge();
  await review(dir, async (request) => { asked.push(request); return inner(request); });
  const cache = cacheIn(dir);
  const request = asked.find((r) => r.label === 'narrative:w1');
  await writeFile(join(cache.directory, `${cache.keyOf(request)}.0.json`), '{ not json');
  const calls = [];
  const b = await review(dir, honestJudge(calls), cache);
  assert.ok(narrativeCalls(calls).some((c) => c.label === 'narrative:w1'));
  assert.equal(b.windowResults[0].failure, null);
  assert.equal(b.windowResults[0].shortfall.narrative, 'ok');
  assert.equal(JSON.parse(await readFile(join(cache.directory, `${cache.keyOf(request)}.0.json`), 'utf8')).key,
    cache.keyOf(request), 'the live answer replaced the unreadable file');
});
