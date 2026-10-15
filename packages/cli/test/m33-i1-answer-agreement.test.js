// M33 I1. One rule on both sides of the D60 store: an answer the store keeps is an answer its consumer
// accepts, at the top level, for every request a review sends. A narrative answer with a member the
// narrative contract does not declare failed its window (`narrative:schema`), and was kept all the same —
// NARRATIVE_SCHEMA was open at its top level, so `answerStorable` let the extra member through — and then
// replayed on every later review: `narrative:schema` is not a reason F226 forgets, and the stored answer
// is returned before any call. The narrative schema is now closed at its top level, exactly as the review
// reads a narrative, and the one consumer that read it open (a PR review with no reviewable code) reads it
// closed too. The schema is never model input, so no request byte and no D60 key moved.
//
// Every byte here is synthetic: invented instructions, paths and tool output. No model, no recording, no
// real ~/.sonah — each test gets its own temporary directory, and every judge is fake.
import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Session } from '../../evidence/src/session.js';
import { NARRATIVE_SCHEMA, SESSION_NARRATIVE_SCHEMA } from '../../evidence/src/prompt.js';
import { CODE_REVIEW_SCHEMA } from '../../evidence/src/code-review-prompt.js';
import { CHALLENGE_SCHEMA, challengeItems } from '../../evidence/src/challenge.js';
import { planWindowRequests, runReview, windowIncompleteReasons } from '../../evidence/src/run-review.js';
import { runCodeReview, snapshotDiff } from '../../evidence/src/code-review.js';
import { answerKey, answerStorable, createAnswerCache } from '../src/answer-cache.js';
import { createReviewJudge } from '../src/review-judge.js';
import { createSessionReviewStore, reviewSession } from '../src/session-review.js';

const IDENTITY = { backend: 'claude-cli', model: 'sonnet' };
const IDENTITIES = [IDENTITY, { backend: 'codex-cli', model: 'gpt-synthetic' },
  { backend: 'anthropic-api', model: 'claude-synthetic-1' }];
const SENTINEL = 'SYNTHETIC_I1';
const EXTRA = 'SYNTHETIC_I1_EXTRA';
const pathOf = (i) => `i1/step-${i}.txt`;
const windowOf = (label) => Number(/:w(\d+)/.exec(label ?? '')?.[1] ?? 0);

async function directory(t, name) {
  const dir = await mkdtemp(join(tmpdir(), `sonah-i1-${name}-`));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return dir;
}

/** `count` windows split at compactions; window i asks for, announces, writes and reports step i. M35 windowing: a
 *  compaction no longer splits a window, so each step's write body is long (370k bytes, shown in full and never
 *  carried): no two steps fit one 200k-token window, and each step is a window of its own, as before. */
const BODY_FILL = `// ${'b'.repeat(370_000)}\n`;
function sessionOf(count = 3) {
  const blobs = {};
  const events = [];
  let sequence = 0;
  const whole = (key) => [{ sourceKey: key, fromByte: 0, untilByte: Buffer.byteLength(blobs[key], 'utf8') }];
  for (let i = 1; i <= count; i++) {
    blobs[`ask${i}`] = `${SENTINEL}_ASK_${i}: write the step ${i} marker file and nothing else.`;
    blobs[`said${i}`] = `${SENTINEL}_SAID_${i}: writing the step ${i} marker file now.`;
    blobs[`body${i}`] = `${SENTINEL}_BODY_${i} = ${i}\n${BODY_FILL}`;
    blobs[`out${i}`] = `${SENTINEL}_OUT_${i}: wrote the step ${i} marker.\n`;
    events.push({ id: `I${i}`, kind: 'instruction', sequence: sequence++, authority: 'human', text: whole(`ask${i}`), supersedes: [] });
    events.push({ id: `C${i}`, kind: 'commentary', sequence: sequence++, phase: 'working', text: whole(`said${i}`), beforeInvocation: `A${i}` });
    events.push({ id: `A${i}`, kind: 'invocation', sequence: sequence++, callKey: `c${i}`, tool: 'Write', operation: 'write',
      paths: [{ path: pathOf(i) }], command: [], input: [], changes: [{ path: pathOf(i), before: [], after: whole(`body${i}`), diff: [] }] });
    events.push({ id: `O${i}`, kind: 'observation', sequence: sequence++, invocation: `A${i}`, callKey: `c${i}`, phase: 'terminal',
      result: 'succeeded', exitCode: 0, terminalStatusProven: true, output: whole(`out${i}`), sourceOfResult: 'native' });
    if (i < count) events.push({ id: `B${i}`, kind: 'boundary', sequence: sequence++, boundary: 'compaction' });
  }
  return new Session({ sessionKey: 'sess-i1', adapter: 'claude', events, blobs });
}
const narrativeFor = (i) => ({
  decisions: [{ dimension: `${SENTINEL}_DIMENSION_${i}`, chosen: `Write ${pathOf(i)}`, value: pathOf(i),
    valueReceipt: { eventId: `A${i}`, field: 'path', role: 'action', quote: pathOf(i) }, actions: [`A${i}`],
    stated: { eventId: `C${i}`, role: 'commentary', quote: `${SENTINEL}_SAID_${i}` },
    constrainedBy: { instruction: { eventId: `I${i}`, role: 'instruction', quote: `${SENTINEL}_ASK_${i}` },
      settles: false, settledValueQuote: null } }],
  pivots: [], claims: [], requirements: [] });
const supportVotes = (request) => ({ votes: request.challenge.items.map(({ key }) => ({ key, verdict: 'not-refuted',
  explanation: `Synthetic support vote ${SENTINEL}.`,
  receipts: [{ eventId: `I${windowOf(request.label)}`, role: 'instruction', quote: `${SENTINEL}_ASK_${windowOf(request.label)}` }] })) });

/** Answers honestly, except as `twist(request, answer)` says; records every call it actually receives. */
function judgeWith(calls = [], twist = (request, answer) => answer) {
  return async (request) => {
    calls.push({ label: request.label, window: windowOf(request.label) });
    return twist(request, request.challenge ? supportVotes(request) : narrativeFor(windowOf(request.label)));
  };
}
const cacheIn = (dir) => createAnswerCache(join(dir, 'answers'), IDENTITY);
const review = (dir, judge, session = sessionOf(3)) => reviewSession({ session, judge, answerCache: cacheIn(dir),
  store: createSessionReviewStore(join(dir, 'review')), ...IDENTITY });
/** Window 2's narrative request, exactly as a session review plans it. */
const narrativeRequest = (n, session = sessionOf(3)) =>
  planWindowRequests({ session, reviewScope: 'session-only' }).requests[n - 1].request;
const withExtra = (answer) => ({ ...answer, [EXTRA]: 'a member the narrative contract does not declare' });

// ---- GAP 1: the narrative a review rejects is never kept --------------------------------------------------------
test('I1 a narrative answer with an extra top-level member is not stored, fails its window as narrative:schema, and is asked again', async (t) => {
  const dir = await directory(t, 'extra');
  const twist = (request, answer) => (request.label === 'narrative:w2' ? withExtra(answer) : answer);
  const first = await review(dir, judgeWith([], twist));
  const w2 = first.report.windowResults[1];
  // Exactly as before: the window fails with the closed reason, and nothing of it is read.
  assert.equal(w2.failure, 'model_response_invalid');
  assert.equal(w2.shortfall.narrative, 'schema');
  assert.deepEqual(windowIncompleteReasons(w2), ['narrative:schema']);
  assert.equal(w2.narrative, null);
  const uncached = await runReview({ session: sessionOf(3), pr: null, diff: null, reviewScope: 'session-only',
    judge: judgeWith([], twist) });
  assert.deepEqual([w2.failure, w2.shortfall, windowIncompleteReasons(w2)], [uncached.windowResults[1].failure,
    uncached.windowResults[1].shortfall, windowIncompleteReasons(uncached.windowResults[1])],
  'a cache changes nothing about how the window is judged');
  assert.deepEqual(first.report.windowResults.map(windowIncompleteReasons), [[], ['narrative:schema'], []]);
  // Not stored: no record under its key, and the store has no answer for it.
  const cache = cacheIn(dir);
  const request = narrativeRequest(2);
  assert.equal(await cache.get(request), null, 'the rejected narrative was kept');
  assert.ok(!(await readdir(cache.directory)).includes(`${cache.keyOf(request)}.0.json`));
  // The next review with the same store asks that narrative again — and only that window.
  const calls = [];
  const second = await review(dir, judgeWith(calls));
  assert.ok(calls.some((c) => c.label === 'narrative:w2'), 'the rejected narrative was replayed, not asked again');
  assert.deepEqual(calls.filter((c) => c.window !== 2), [], 'every other window was replayed');
  assert.deepEqual(second.report.windowResults.map(windowIncompleteReasons), [[], [], []], 'completed by the retry');
  // And what it got the second time is kept.
  const third = [];
  await review(dir, judgeWith(third));
  assert.deepEqual(third, []);
});

test('I1 an answer without the optional writtenClaims — or with it — is still stored and reused', async (t) => {
  for (const [name, shape] of [['absent', (answer) => answer], ['empty', (answer) => ({ ...answer, writtenClaims: [] })]]) {
    const dir = await directory(t, `optional-${name}`);
    const first = [];
    const twist = (request, answer) => (request.challenge ? answer : shape(answer));
    const initial = await review(dir, judgeWith(first, twist));
    assert.deepEqual(initial.report.windowResults.map(windowIncompleteReasons), [[], [], []], `${name}: premise`);
    assert.ok(first.length > 0);
    for (const n of [1, 2, 3])
      assert.deepEqual(await cacheIn(dir).get(narrativeRequest(n)), shape(narrativeFor(n)), `${name}: window ${n} was not kept`);
    const again = [];
    const replayed = await review(dir, judgeWith(again, twist));
    assert.deepEqual(again, [], `${name}: a kept answer was asked again`);
    assert.deepEqual(replayed.report.windowResults.map(windowIncompleteReasons), [[], [], []]);
  }
});

test('I1 a rejected narrative an earlier version already stored is re-validated on read and asked again, never replayed', async (t) => {
  const dir = await directory(t, 'legacy');
  const cache = cacheIn(dir);
  const request = narrativeRequest(2);
  // What an earlier version kept: the same key (the schema is never part of it) under an open top level.
  const open = { ...request, schema: { ...NARRATIVE_SCHEMA, additionalProperties: undefined } };
  assert.equal(cache.keyOf(open), cache.keyOf(request), 'premise: the schema is not in the key');
  assert.equal(await cache.put(open, withExtra(narrativeFor(2))), true, 'premise: stored under an open schema');
  assert.equal(await cache.get(request), null, 'read back under the review\'s own schema, it is no answer');
  const calls = [];
  const reviewed = await review(dir, judgeWith(calls));
  assert.ok(calls.some((c) => c.label === 'narrative:w2'), 'the stale rejected narrative was replayed');
  assert.deepEqual(reviewed.report.windowResults.map(windowIncompleteReasons), [[], [], []]);
  assert.deepEqual(await cacheIn(dir).get(request), narrativeFor(2), 'the live answer replaced it');
});

// ---- the property: storability equals acceptance, for every request kind ------------------------------------------
const PR_BASE = { repo: { host: 'github.com', id: '7' }, number: 11, baseOid: 'b'.repeat(40), diffBaseOid: 'b'.repeat(40),
  headOid: 'a'.repeat(40), gitAlgorithm: 'sha1', enumeration: 'complete' };
const CODE_PATH = pathOf(1);
const CODE_LINE = `${SENTINEL}_BODY_1 = 1`;
const CODE_PR = { pr: { ...PR_BASE, files: [{ path: CODE_PATH, change: 'added', contentState: 'complete' }] },
  diff: [`diff --git a/${CODE_PATH} b/${CODE_PATH}`, 'new file mode 100644', 'index 0000000..1111111 100644', '--- /dev/null',
    `+++ b/${CODE_PATH}`, '@@ -0,0 +1 @@', `+${CODE_LINE}`, ''].join('\n') };
const BINARY_PATH = 'assets/i1.png';
const BINARY_PR = { pr: { ...PR_BASE, files: [{ path: BINARY_PATH, change: 'binary', contentState: 'complete' }] },
  diff: `diff --git a/${BINARY_PATH} b/${BINARY_PATH}\nindex 2222222..3333333 100644\nBinary files a/${BINARY_PATH} and b/${BINARY_PATH} differ\n` };
const shownFiles = (prompt) => [...(prompt ?? '').matchAll(/^- (\S+) · [^\n]*· shown$/gm)].map((m) => m[1]);
const EMPTY_NARRATIVE = Object.freeze({ decisions: [], pivots: [], claims: [], requirements: [] });
function codeFinding(quote) {
  const source = snapshotDiff(CODE_PR).sources.find((s) => s.path === CODE_PATH && s.side === 'RIGHT');
  return { origin: 'code-review', kind: 'code_issue', title: `${SENTINEL} a synthetic defect`,
    explanation: 'A synthetic defect in the changed line.', scope: 'current-code',
    anchor: { path: CODE_PATH, side: 'RIGHT', startLine: 1, endLine: 1 },
    receipts: [{ eventId: source.eventId, role: 'code', quote }] };
}

/**
 * Every request kind a session or PR review sends, each with its real consumer: `run(answer)` runs the
 * review path that sends it, answers THAT request with `answer(request)` and every other honestly, and
 * returns `{ request, accepted }` — the request object the judge was given (its schema is what the D60
 * store judges by) and whether its consumer accepted the answer as the request's answer.
 */
const KINDS = {
  // A session review's window narrative (runReview reads it: `narrativeShape`).
  'narrative:session-only': async (answer) => {
    let request = null;
    const report = await runReview({ session: sessionOf(1), pr: null, diff: null, reviewScope: 'session-only',
      judge: async (r) => (r.challenge ? supportVotes(r) : (request = r, answer(r))) });
    return { request, accepted: report.windowResults[0].failure === null };
  },
  // A PR review with no reviewable code sends the same narrative contract (runCodeReview reads it).
  'narrative:no-code-pr': async (answer) => {
    let request = null;
    const report = await runCodeReview({ session: sessionOf(1), ...BINARY_PR,
      judge: async (r) => (r.challenge ? supportVotes(r) : (request = r, answer(r))) });
    assert.equal(request.schema, NARRATIVE_SCHEMA, 'premise: the no-code PR path sends the narrative contract');
    return { request, accepted: report.windowResults[0].failure === null };
  },
  // A joint window: accepted when its narrative is read AND its code half is usable — the shown file is
  // then acknowledged, and no code-only chunk is needed for it.
  'code-review:window': async (answer) => {
    let request = null;
    const labels = [];
    const report = await runCodeReview({ session: sessionOf(1), ...CODE_PR, judge: async (r) => {
      labels.push(r.label);
      if (r.challenge) return supportVotes(r);
      if (r.label === 'code+narrative:w1') { request = r; return answer(r); }
      return { ...EMPTY_NARRATIVE, codeFindings: [], sessionFindings: [], reviewedFiles: shownFiles(r.prompt) };
    } });
    return { request, accepted: report.windowResults[0].failure === null && !labels.some((l) => /^code\+chunk:/.test(l)) };
  },
  // The one receipt repair a joint window may ask: accepted when its corrected finding replaces the original.
  'code-review:receipt-repair': async (answer) => {
    let request = null;
    const report = await runCodeReview({ session: sessionOf(1), ...CODE_PR, judge: async (r) => {
      if (r.challenge) return supportVotes(r);
      if (/:receipt-repair$/.test(r.label)) { request = r; return answer(r); }
      return { ...EMPTY_NARRATIVE, codeFindings: [codeFinding(`${SENTINEL}_NOT_IN_THE_SOURCE();`)], sessionFindings: [],
        reviewedFiles: shownFiles(r.prompt) };
    } });
    assert.ok(request, 'premise: a receipt repair was asked');
    return { request, accepted: report.codeCoverageFacts.usableResults === 2 };
  },
  // A challenge batch (and its re-ask): accepted when the reply's vote was cast.
  challenge: async (answer) => {
    let request = null;
    const run = await challengeItems({ items: [{ key: 'k1', type: 'decision', candidate: { dimension: SENTINEL } }],
      evidence: `${SENTINEL} evidence`, verifyReceipt: (receipt) => ({ ok: true, receipt }),
      judge: async (r) => { request ??= r; return answer(r); } });
    return { request, accepted: run.results[0].votes[0].answered === true };
  },
};

/** A valid answer of each kind: every required member, of its declared type. */
const VALID = {
  'narrative:session-only': () => ({ ...EMPTY_NARRATIVE }),
  'narrative:no-code-pr': () => ({ ...EMPTY_NARRATIVE }),
  'code-review:window': (r) => ({ ...EMPTY_NARRATIVE, codeFindings: [], sessionFindings: [], reviewedFiles: shownFiles(r.prompt) }),
  'code-review:receipt-repair': () => ({ ...EMPTY_NARRATIVE, codeFindings: [codeFinding(CODE_LINE)], sessionFindings: [],
    reviewedFiles: [] }),
  challenge: () => ({ votes: [{ key: 'k1', verdict: 'uncertain', explanation: `${SENTINEL}: nothing to cite.`, receipts: [] }] }),
};
// M33 N: a session-only narrative request carries its own contract (`forbiddenEdits` beside the rest); a PR review's
// narrative request carries NARRATIVE_SCHEMA, unchanged.
const SCHEMA_OF = { 'narrative:session-only': SESSION_NARRATIVE_SCHEMA, 'narrative:no-code-pr': NARRATIVE_SCHEMA,
  'code-review:window': CODE_REVIEW_SCHEMA, 'code-review:receipt-repair': CODE_REVIEW_SCHEMA, challenge: CHALLENGE_SCHEMA };
const WRONG = Object.freeze({ array: [{}, `${SENTINEL} not a list`, null] });

/** The top-level shapes: valid; valid with each optional member absent; one extra member; each required
 *  member missing; each declared member of a wrong JSON type; and no object at all. */
function shapesOf(kind) {
  const schema = SCHEMA_OF[kind];
  const valid = VALID[kind];
  const optional = Object.keys(schema.properties).filter((key) => !schema.required.includes(key));
  const shapes = [{ name: 'valid', member: null, answer: valid }];
  for (const key of optional) {
    shapes.push({ name: `${key} absent`, member: key, answer: (r) => { const { [key]: _gone, ...rest } = valid(r); return rest; } });
    if (key === 'writtenClaims') shapes.push({ name: `${key} empty`, member: key, answer: (r) => ({ ...valid(r), [key]: [] }) });
  }
  shapes.push({ name: 'extra member', member: EXTRA, answer: (r) => ({ ...valid(r), [EXTRA]: [] }) });
  for (const key of schema.required)
    shapes.push({ name: `${key} missing`, member: key, answer: (r) => { const { [key]: _gone, ...rest } = valid(r); return rest; } });
  for (const [key, child] of Object.entries(schema.properties))
    for (const wrong of WRONG[child.type] ?? [])
      shapes.push({ name: `${key} ${JSON.stringify(wrong)}`, member: key, wrongType: true, answer: (r) => ({ ...valid(r), [key]: wrong }) });
  for (const none of [null, [], `${SENTINEL} not an object`]) shapes.push({ name: `answer ${JSON.stringify(none)}`, member: null, answer: () => none });
  return shapes;
}

/**
 * C-06 "M33 written statements": a `writtenClaims` that is not a list is one written statement no check can
 * read — withheld and counted — and never makes the narrative unreadable, so these consumers read the
 * rest of the answer. The D60 store does not keep it (the member is not the list the request asked for),
 * so the next review asks it again: the one pair where the two sides differ, and only ever in this
 * direction — an answer is never kept that its consumer rejects.
 */
const WRITTEN_READ_APART = new Set(['narrative:session-only', 'narrative:no-code-pr', 'code-review:window']);
/** M33 N (C-06 "M33 forbidden edits"): likewise a `forbiddenEdits` that is not a list — one forbidden edit no check can
 *  read, which leaves its window incomplete (never a failed narrative) — in the one request kind that asks for it. */
const FORBIDDEN_READ_APART = new Set(['narrative:session-only']);
/** M36 phase 3 (D68 Q; C-07 "M36 evidence re-ask"): likewise an `evidenceRequests` that is not a list — one request no
 *  check can read (`malformed`, counted), never a failed narrative — in the one request kind that asks for it. */
const EVIDENCE_READ_APART = new Set(['narrative:session-only']);
/** D71 (S2): likewise a `notClaims` that is not a list — one entry no check can read (`malformed`,
 *  counted), never a failed narrative — in the one request kind that asks for it. */
const NOT_CLAIMS_READ_APART = new Set(['narrative:session-only']);
/** D71 (S3, owner decision D71 c): likewise a `failures` that is not a list — one failure row no check can read
 *  (`malformed`, counted), never a failed narrative — in the one request kind that asks for it. */
const FAILURES_READ_APART = new Set(['narrative:session-only']);

test('I1 for every request kind a review sends, the D60 store keeps exactly the top-level shapes its consumer accepts', async (t) => {
  const table = [];
  const violations = [];
  for (const [kind, run] of Object.entries(KINDS)) {
    for (const shape of shapesOf(kind)) {
      const { request, accepted } = await run(shape.answer);
      assert.ok(request, `${kind} / ${shape.name}: premise: the request was sent`);
      assert.equal(request.schema, SCHEMA_OF[kind], `${kind}: premise: the request carries its kind's schema`);
      const storable = answerStorable(request, shape.answer(request));
      table.push({ kind, shape: shape.name, storable, accepted });
      const expected = ((WRITTEN_READ_APART.has(kind) && shape.member === 'writtenClaims')
        || (FORBIDDEN_READ_APART.has(kind) && shape.member === 'forbiddenEdits')
        || (EVIDENCE_READ_APART.has(kind) && shape.member === 'evidenceRequests')
        || (NOT_CLAIMS_READ_APART.has(kind) && shape.member === 'notClaims')
        || (FAILURES_READ_APART.has(kind) && shape.member === 'failures')) && shape.wrongType
        ? { storable: false, accepted: true } : { storable: accepted, accepted };
      // Above all never stored-but-rejected: that answer would be replayed on every later review.
      if (storable !== expected.storable || accepted !== expected.accepted)
        violations.push(`${kind} / ${shape.name}: stored ${storable}, accepted ${accepted}`);
    }
  }
  t.diagnostic(`${table.length} kind/shape cases over ${Object.keys(KINDS).length} request kinds; `
    + `${table.filter((row) => !row.storable && row.accepted).length} read apart (C-06), `
    + `${table.filter((row) => row.storable && !row.accepted).length} stored-but-rejected`);
  assert.deepEqual(violations, [], 'the store and the consumer disagree');
  // The table covers every kind, and in each both outcomes occur: the check is not vacuous.
  for (const kind of Object.keys(KINDS)) {
    assert.ok(table.some((row) => row.kind === kind && row.storable && row.accepted), `${kind}: nothing accepted`);
    assert.ok(table.some((row) => row.kind === kind && !row.storable && !row.accepted), `${kind}: nothing rejected`);
  }
});

test('I1 the narrative contract is closed at its top level with exactly the members the review reads', () => {
  assert.equal(NARRATIVE_SCHEMA.additionalProperties, false);
  assert.deepEqual(Object.keys(NARRATIVE_SCHEMA.properties), ['decisions', 'pivots', 'claims', 'requirements', 'writtenClaims']);
  assert.deepEqual(NARRATIVE_SCHEMA.required, ['decisions', 'pivots', 'claims', 'requirements']);
  assert.ok(Object.isFrozen(NARRATIVE_SCHEMA));
  // M33 N: the session-only contract is the same, closed, with one more optional member; M36 phase 3 (D68 Q): two; D71
  // (S2): three — the closing message's lines that assert nothing (`notClaims`); D71 (S3): four — the failures the agent
  // passed over (`failures`).
  assert.equal(SESSION_NARRATIVE_SCHEMA.additionalProperties, false);
  assert.deepEqual(Object.keys(SESSION_NARRATIVE_SCHEMA.properties), ['decisions', 'pivots', 'claims', 'requirements',
    'writtenClaims', 'failures', 'notClaims', 'forbiddenEdits', 'evidenceRequests']);
  assert.deepEqual(SESSION_NARRATIVE_SCHEMA.required, NARRATIVE_SCHEMA.required);
  assert.ok(Object.isFrozen(SESSION_NARRATIVE_SCHEMA));
  // The joint and challenge contracts were already closed at theirs.
  assert.equal(CODE_REVIEW_SCHEMA.additionalProperties, false);
  assert.equal(CHALLENGE_SCHEMA.additionalProperties, false);
});

// ---- no request byte moved -------------------------------------------------------------------------------------------
test('I1 the narrative schema is never model input: no request byte, no transport argument and no D60 key depends on it', async () => {
  const openOf = (schema) => { const open = { ...schema }; delete open.additionalProperties; return open; };
  const planned = ['session-only', 'combined'].flatMap((reviewScope) =>
    planWindowRequests({ session: sessionOf(3), reviewScope }).requests.map((built) => built.request));
  assert.equal(planned.length, 6);
  for (const [at, request] of planned.entries()) {
    // M33 N: a session-only request carries its own contract; neither is model input.
    assert.equal(request.schema, at < 3 ? SESSION_NARRATIVE_SCHEMA : NARRATIVE_SCHEMA);
    for (const identity of IDENTITIES)
      assert.equal(answerKey(request, identity), answerKey({ ...request, schema: openOf(request.schema) }, identity),
        `${identity.backend}: key moved`);
  }
  const open = openOf(NARRATIVE_SCHEMA);
  // The claude-cli transport, as it spawns: the same argv and the same stdin whichever schema the request carries.
  const sent = [];
  const spawnProcess = (command, args) => {
    const child = new EventEmitter();
    child.stdin = new PassThrough(); child.stdout = new PassThrough(); child.stderr = new PassThrough();
    const record = { command, args, stdin: '' };
    sent.push(record);
    child.kill = () => { setImmediate(() => child.emit('close', null, null)); return true; };
    child.stdin.setEncoding('utf8');
    child.stdin.on('data', (chunk) => { record.stdin += chunk; });
    child.stdin.on('end', () => setImmediate(() => child.emit('close', 1, null)));
    return child;
  };
  const judge = createReviewJudge({ config: IDENTITY, env: { PATH: '/bin' }, spawnProcess });
  for (const request of planned)
    for (const schema of [NARRATIVE_SCHEMA, open]) await judge({ ...request, schema }).catch(() => null);
  assert.equal(sent.length, planned.length * 2);
  for (let at = 0; at < sent.length; at += 2) {
    assert.deepEqual(sent[at], sent[at + 1], 'the transport sent something of the schema');
    assert.equal(sent[at].stdin, planned[at / 2].prompt);
    assert.ok(!JSON.stringify(sent[at].args).includes('additionalProperties'));
  }
});
