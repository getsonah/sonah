// W3d-5 (D59, F174 F175), under D60 (W3f-1). A window's request carries only that window: its own
// events, the human instructions recorded up to its end — and, through the instruction scope's
// completeness, nothing else of the session. W3d-5 pinned this through two hand-built key families
// (`windowKeys`, `sessionWindowKeys`); those keys are gone. Reuse is now by exact request bytes, so
// the same facts are pinned where they matter: after each kind of growth, the second review makes
// judge calls for exactly the requests whose bytes changed (computed from the requests themselves),
// and never for a window before the change.
//
// The case: one gap recorded at a live session's tail changed the key of every window, and a
// second review reused none.
//
// D82 step 10: these ran through the removed PR route's review; they run through the session review
// (`reviewSession`, a fresh checkpoint store each time, so only the answer cache carries over). Its
// `reviewDependencies` test and the per-target state's end-to-end test went with the route.
//
// Every byte here is synthetic: invented instructions, paths and tool output. No model, no GitHub,
// no git, no real ~/.sonah — each test that writes gets its own temporary directory.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Session } from '../../evidence/src/session.js';
import { WINDOW_SETTINGS, planWindows } from '../../evidence/src/windows.js';
import { createAnswerCache } from '../src/answer-cache.js';
import { createSessionReviewStore, reviewSession } from '../src/session-review.js';

const ASK = 'SYNTHETIC_WKB_ASK: keep the notes current and update the b module.';
const ASK_QUOTE = 'SYNTHETIC_WKB_ASK: keep the notes current';
const PATHS = { 1: 'docs/notes.md', 2: 'b.js', 3: 'docs/more.md' };
const UNLOCATED = (count) => ({ code: 'unsupported_message', channel: 'commentary', scope: 'session', count });
/** The adapter declares ONE unrecorded-body gap for the whole session, listing every write. */
const UNRECORDED = (ids) => ({ code: 'unrecorded_body', channel: 'code', scope: 'session', count: ids.length,
  eventIds: ids, writes: ids.map((eventId) => ({ eventId, path: `docs/${eventId}.md`, outsideRepository: false })),
  note: `${ids.length} write(s) whose body the recording does not contain` });

/**
 * Three windows split at two recorded compactions: w1 = I1 C1 A1 O1, w2 = C2 A2 O2, w3 = C3 A3 O3.
 * `tail` appends a write whose body was not recorded, a delegation and a human instruction to the
 * last window — the three kinds of growth a live session shows. `insert` puts a human
 * instruction inside window 2, after its write. M35 windowing: a compaction no longer splits a window, so each step
 * opens with a long thought (370k bytes): no two steps fit a session review's 200k-token (~720k-byte) work budget,
 * and the one task is cut at its thoughts (each compaction now closes the window before it). A human instruction
 * starts a segment of its own: the tail's is a fourth window, and the inserted one opens the last window.
 */
function sessionOf({ tail = false, insert = false, gaps = [UNLOCATED(2), UNRECORDED(['A1'])], children = [] } = {}) {
  const blobs = { ask: ASK, ok: 'SYNTHETIC_WKB_OK: write succeeded', later: 'SYNTHETIC_WKB_LATER: now review it again.',
    middle: 'SYNTHETIC_WKB_MIDDLE: also keep the b module small.', brief: 'SYNTHETIC_WKB_BRIEF: check the notes.' };
  for (const n of [1, 2, 3])
    blobs[`said${n}`] = `SYNTHETIC_WKB_SAID_${n}: writing the next file now.\n${'w'.repeat(370_000)}`;
  const whole = (key) => [{ sourceKey: key, fromByte: 0, untilByte: Buffer.byteLength(blobs[key], 'utf8') }];
  const events = [];
  let sequence = 0;
  const push = (event) => events.push({ ...event, sequence: sequence++ });
  const step = (n) => {
    push({ id: `C${n}`, kind: 'commentary', phase: 'working', text: whole(`said${n}`) });
    push({ id: `A${n}`, kind: 'invocation', operation: 'write', tool: 'Write', paths: [{ path: PATHS[n] }] });
    push({ id: `O${n}`, kind: 'observation', phase: 'terminal', invocation: `A${n}`, result: 'succeeded', output: whole('ok') });
  };
  push({ id: 'I1', kind: 'instruction', authority: 'human', text: whole('ask'), supersedes: [] });
  step(1);
  push({ id: 'B1', kind: 'boundary', boundary: 'compaction' });
  step(2);
  if (insert) push({ id: 'IM', kind: 'instruction', authority: 'human', text: whole('middle'), supersedes: [] });
  push({ id: 'B2', kind: 'boundary', boundary: 'compaction' });
  step(3);
  if (tail) {
    push({ id: 'A5', kind: 'invocation', operation: 'write', tool: 'Write', paths: [{ path: 'docs/tail.md' }],
      changes: [{ path: 'docs/tail.md', extent: { recorded: false } }] });
    push({ id: 'O5', kind: 'observation', phase: 'terminal', invocation: 'A5', result: 'succeeded', output: whole('ok') });
    push({ id: 'D1', kind: 'invocation', operation: 'delegate', tool: 'Task', paths: [], command: whole('brief') });
    push({ id: 'I9', kind: 'instruction', authority: 'human', text: whole('later'), supersedes: [] });
  }
  const session = new Session({ sessionKey: 'sess-wkb', adapter: 'claude', events, blobs, children });
  session.adapterGaps = gaps;
  return session;
}
/** The growth: one located gap, one delegation link and one human instruction at the tail,
 *  and the session-wide counters that grew with them. */
const grown = () => sessionOf({ tail: true, gaps: [UNLOCATED(3), UNRECORDED(['A1', 'A5'])],
  children: [{ assignmentEvent: 'D1', childSession: 'sess-wkb-child', state: 'verified' }] });

const windowOf = (label) => Number(/:w(\d+)/.exec(label ?? '')?.[1] ?? 0);
function decisionFor(n) {
  const path = PATHS[n];
  return { dimension: `SYNTHETIC_WKB_DIMENSION_${n}`, chosen: `Write ${path}`, actions: [`A${n}`], value: path,
    valueReceipt: { eventId: `A${n}`, role: 'action', field: 'path', quote: path },
    stated: { eventId: `C${n}`, role: 'commentary', quote: `SYNTHETIC_WKB_SAID_${n}` },
    constrainedBy: { instruction: { eventId: 'I1', role: 'instruction', quote: ASK_QUOTE }, settles: false, settledValueQuote: null } };
}
/** Answers honestly and records every call it receives: one grounded decision per window, votes that verify. */
function countingJudge(calls = []) {
  return async (request) => {
    calls.push({ label: request.label, system: request.system, prompt: request.prompt });
    if (request.challenge) return { votes: request.challenge.items.map(({ key }) => ({ key, verdict: 'not-refuted',
      explanation: 'The recorded instruction supports this synthetic item.',
      receipts: [{ eventId: 'I1', role: 'instruction', quote: ASK_QUOTE }] })) };
    const answer = { decisions: [], pivots: [], claims: [], requirements: [] };
    const n = windowOf(request.label);
    return n ? { ...answer, decisions: [decisionFor(n)] } : answer;
  };
}
const windowsCalled = (calls) => [...new Set(calls.map((c) => windowOf(c.label)).filter(Boolean))].sort();
const bytesOf = (request) => JSON.stringify([request.system, request.prompt]);
function unanswered(after, before) {
  const left = new Map();
  for (const r of before) left.set(bytesOf(r), (left.get(bytesOf(r)) ?? 0) + 1);
  const out = [];
  for (const r of after) {
    const n = left.get(bytesOf(r)) ?? 0;
    if (n > 0) left.set(bytesOf(r), n - 1); else out.push(bytesOf(r));
  }
  return out.sort();
}
async function directory(t, name) {
  const dir = await mkdtemp(join(tmpdir(), `sonah-wkb-${name}-`));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return dir;
}

/**
 * Review `before`, then `after`, into one answer cache. Returns the windows the second review asked
 * live, after checking that its live calls are exactly the requests whose bytes changed — computed
 * from the requests themselves: every request `after` makes (asked with no cache), less every
 * request `before` got an answer to.
 */
const IDENTITY = { backend: 'claude-cli', model: 'sonnet' };
let stores = 0;
/** One session review of `session`, its checkpoints in a store of its own. */
const review = (dir, session, judge, answerCache) => reviewSession({ session, judge, answerCache, ...IDENTITY,
  store: createSessionReviewStore(join(dir, 'review', String(++stores))) });
async function liveAfter(t, before, after) {
  const dir = await directory(t, 'live');
  const cache = () => createAnswerCache(join(dir, 'answers'), IDENTITY);
  const first = [];
  await review(dir, before, countingJudge(first), cache());
  const every = [];
  await review(dir, after, countingJudge(every), createAnswerCache(join(dir, 'unshared'), IDENTITY));
  const live = [];
  const result = await review(dir, after, countingJudge(live), cache());
  assert.deepEqual(live.map(bytesOf).sort(), unanswered(every, first), 'live calls are exactly the requests whose bytes changed');
  return { windows: windowsCalled(live), live, result };
}

test('the premise: the tail growth lands in the last of three windows, and its human instruction in a fourth', () => {
  assert.deepEqual(planWindows(sessionOf(), WINDOW_SETTINGS).map((w) => w.events.map((e) => e.id)),
    [['I1', 'C1', 'A1', 'O1', 'B1'], ['C2', 'A2', 'O2', 'B2'], ['C3', 'A3', 'O3']]);
  const windows = planWindows(grown(), WINDOW_SETTINGS);
  assert.equal(windows.length, 4);
  assert.deepEqual(windows[2].events.map((e) => e.id), ['C3', 'A3', 'O3', 'A5', 'O5', 'D1']);
  assert.deepEqual(windows[3].events.map((e) => e.id), ['I9'], 'M35: a human message starts a segment of its own');
});

test('F174 after a gap, a link and an instruction at the tail, only the tail window is asked again', async (t) => {
  const { windows, live, result } = await liveAfter(t, sessionOf(), grown());
  t.diagnostic(`grown review: ${live.length} live of ${live.length + result.report.instrument.answers.reused}`);
  assert.deepEqual(windows, [3, 4], `the grown review asked windows ${windows}`);
  assert.equal(result.report.decisions.length, 3, 'the reused answers\' decisions are reported beside the live one');
});

test('F174 a gap located in window j reaches no request: nothing is asked again', async (t) => {
  const clipped = { code: 'source_clipped', channel: 'code', scope: 'session', count: 1, eventIds: ['A2'] };
  const base = sessionOf();
  assert.deepEqual((await liveAfter(t, base, sessionOf({ gaps: [...base.adapterGaps, clipped] }))).windows, []);
  assert.deepEqual((await liveAfter(t, base, sessionOf({ gaps: [...base.adapterGaps, { ...clipped, eventIds: ['NOT_RECORDED'] }] }))).windows, []);
});

test('F174 an unlocated gap that grows, repeats or is new reaches no request; an unlocated instruction-inventory gap reaches every one', async (t) => {
  assert.deepEqual((await liveAfter(t, sessionOf({ gaps: [UNLOCATED(2)] }), sessionOf({ gaps: [UNLOCATED(9)] }))).windows, []);
  assert.deepEqual((await liveAfter(t, sessionOf({ gaps: [UNLOCATED(2)] }), sessionOf({ gaps: [UNLOCATED(2), UNLOCATED(4)] }))).windows, []);
  const fresh = { code: 'source_clipped', channel: 'commentary', scope: 'session', count: 1 };
  assert.deepEqual((await liveAfter(t, sessionOf({ gaps: [UNLOCATED(2)] }), sessionOf({ gaps: [UNLOCATED(2), fresh] }))).windows, []);
  // OWNER DECISION B (2026-10-01) amends what D59 pinned here. An instruction-inventory gap LOCATED at A3 — it counts
  // exactly the event it names — is a loss only for a window that reaches A3: window 3's request states it, and no
  // earlier window's request moves a byte.
  const inventory = { code: 'incomplete_inventory', channel: 'instructions', scope: 'session', count: 1, eventIds: ['A3'] };
  assert.deepEqual((await liveAfter(t, sessionOf({ gaps: [] }), sessionOf({ gaps: [inventory] }))).windows, [3]);
  // One with no location (none named, or a count that is not exactly the events it names) still makes every window's
  // instruction scope incomplete — which every window's request states. Every window is a new question.
  for (const unlocated of [{ code: 'incomplete_inventory', channel: 'instructions', scope: 'session', count: 1 },
    { ...inventory, count: 2 }])
    assert.deepEqual((await liveAfter(t, sessionOf({ gaps: [] }), sessionOf({ gaps: [unlocated] }))).windows, [1, 2, 3]);
});

test('F174 a session-wide gap that grows at the tail asks no earlier window again', async (t) => {
  assert.deepEqual((await liveAfter(t, sessionOf({ gaps: [UNRECORDED(['A1'])] }), sessionOf({ gaps: [UNRECORDED(['A1', 'A3'])] }))).windows, []);
  const outside = UNRECORDED(['A1']);
  outside.writes[0].outsideRepository = true;
  assert.deepEqual((await liveAfter(t, sessionOf({ gaps: [UNRECORDED(['A1'])] }), sessionOf({ gaps: [outside] }))).windows, []);
});

test('F174 a child link reaches no request: nothing is asked again', async (t) => {
  const link = (assignmentEvent, state = 'verified') => ({ assignmentEvent, childSession: 'sess-wkb-child', state });
  assert.deepEqual((await liveAfter(t, sessionOf(), sessionOf({ children: [link('A2')] }))).windows, []);
  assert.deepEqual((await liveAfter(t, sessionOf({ children: [link('A2')] }), sessionOf({ children: [link('A2', 'missing')] }))).windows, []);
});

test('F175 a human instruction inserted inside window j asks windows j..n again, never 1..j-1', async (t) => {
  const { windows } = await liveAfter(t, sessionOf(), sessionOf({ insert: true }));
  assert.deepEqual(windows, [2, 3]);
});
