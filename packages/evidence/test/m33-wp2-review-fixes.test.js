// M33 review-WP2 fixes (C-06 "M33 self-corrected claims", "M33 written statements", "M33 per-part
// verdicts"). Two defects a second review of the per-part work package confirmed, each pinned here:
//
//   1. The bounded re-ask's exact identity of a chat claim or a written statement includes its
//      `contradictedBy` and `resolvedBy` receipts. A first-answer copy of the same statement and text
//      without a contradiction (or with one that does not ground, or cites a source its window was not
//      shown) never keeps out a re-ask copy that carries a grounded one: both are kept, both are grounded
//      and challenged, and the existing merge rules pick — a finding merged from two copies is DECIDE if
//      either copy is, and a written statement's label only rises to `contradicted`. Precision over recall:
//      a model resample never erases or lowers a grounded proposal.
//   2. While the session review is not complete (a part or the session-wide entry unchecked), the FYI and
//      NO_FINDINGS headlines — session-only and combined route alike — say that some parts of the session
//      could not be checked, and never "none needs a decision" or "nothing is blocking".
//
// Synthetic sessions (/srv/x paths) and synthetic judges only: no recording, no model call. Nothing prints.
import test from 'node:test';
import assert from 'node:assert/strict';
import { Session } from '../src/session.js';
// Namespace imports, so each test fails on its own against code that predates it.
import * as reviewRun from '../src/run-review.js';
import * as review from '../src/review.js';
import { runCodeReview } from '../src/code-review.js';

const REPO = { host: 'github.com', id: '0' };
const EMPTY = Object.freeze({ decisions: [], pivots: [], claims: [], requirements: [] });
const receipt = (eventId, role, quote) => ({ eventId, role, quote });
const vote = (key, cited) => ({ key, verdict: 'not-refuted', explanation: 'Recorded.', receipts: [cited] });
/** A decision proposal outside the response contract (no `chosen`, no `actions`): no check can read it. */
const MALFORMED = Object.freeze({ dimension: 'SYNTHETIC_WP2_UNREADABLE' });
const findingsOf = (report) => report.findings.map((f) => `${f.kind}:${f.status}`);
const partsOf = (report) => report.parts.map((p) => [p.part, p.status, p.reasons]);

// ---- 1. a re-ask copy carrying a grounded contradiction is never kept out by a first-answer twin -----------

const RT = {
  ask: 'SYNTHETIC_WP2_ASK: make the synthetic replay report no gaps.',
  replay: 'node /srv/x/replay.js',
  claim: 'SYNTHETIC_WP2_CLAIM: this change clears the gap.',
  three: 'SYNTHETIC_WP2_REPLAY: gaps=3',
  zero: 'SYNTHETIC_WP2_REPLAY: gaps=0',
  fixed: 'SYNTHETIC_WP2_FIXED: the replay now reports gaps=0.',
};
const rWhole = (key) => [{ sourceKey: key, fromByte: 0, untilByte: Buffer.byteLength(RT[key], 'utf8') }];
const rRun = (id) => ({ id, kind: 'invocation', callKey: id, tool: 'Bash', operation: 'command', paths: [],
  command: rWhole('replay'), input: [], changes: [] });
const rOut = (id, invocation, key, result) => ({ id, kind: 'observation', invocation, callKey: invocation, phase: 'terminal',
  result, exitCode: result === 'failed' ? 1 : 0, terminalStatusProven: true, output: rWhole(key), sourceOfResult: 'native' });
/** One turn: the ask, the claim, the replay that contradicts it; `resolved` adds a later passing replay and
 *  the agent's accurate statement of it (a self-correction). */
const claimSession = ({ resolved = false } = {}) => new Session({ sessionKey: 's', adapter: 'claude', blobs: { ...RT },
  children: [], events: [
    { id: 'I1', kind: 'instruction', authority: 'human', supersedes: [], text: rWhole('ask') },
    { id: 'C1', kind: 'commentary', phase: 'working', beforeInvocation: null, text: rWhole('claim') },
    rRun('A1'), rOut('A1-r', 'A1', 'three', 'failed'),
    ...(resolved ? [rRun('A2'), rOut('A2-r', 'A2', 'zero', 'succeeded'),
      { id: 'C3', kind: 'commentary', phase: 'final', beforeInvocation: null, text: rWhole('fixed') }] : []),
  ].map((event, sequence) => ({ ...event, turn: 'T1', sequence })) });
const STATED = receipt('C1', 'commentary', 'this change clears the gap.');
const AGAINST = receipt('A1-r', 'observation', RT.three);
const RESOLVED_BY = Object.freeze({ observation: receipt('A2-r', 'observation', RT.zero),
  statement: receipt('C3', 'commentary', 'the replay now reports gaps=0.') });
const TEXT = 'The agent said the change clears the gap.';
const CLAIM = Object.freeze({ text: TEXT, stated: STATED, contradictedBy: AGAINST });
/** The same claim (stated receipt and text) with another contradiction, or none when `against` is undefined. */
const twin = (against) => ({ text: TEXT, stated: STATED, ...(against === undefined ? {} : { contradictedBy: against }) });
const TWINS = Object.freeze({
  'no contradiction': twin(undefined),
  'a null contradiction': twin(null),
  // A quote the record does not hold: the twin's contradiction cannot ground.
  'an ungrounded contradiction': twin({ ...AGAINST, quote: 'SYNTHETIC_WP2_REPLAY: gaps=9' }),
  // An event its window was never shown.
  'an unsupplied contradiction': twin({ ...AGAINST, eventId: 'SYNTHETIC_WP2_NOPE' }),
});

/** The nth narrative request is answered by `answers[n]` (the last one repeats). Every challenged item is
 *  upheld with a grounded receipt. `calls` counts the narrative requests. */
function reaskJudge(answers, calls = { narrative: 0 }) {
  return async (request) => {
    if (request.challenge) return { votes: request.challenge.items.map(({ key, candidate }) => vote(key, candidate.resolvedBy?.observation ?? AGAINST)) };
    return structuredClone(answers[Math.min(calls.narrative++, answers.length - 1)]);
  };
}
const reaskReview = (answers, { base = claimSession(), calls } = {}) => reviewRun.runReview({ session: base, pr: null,
  reviewScope: 'session-only', judge: reaskJudge(answers, calls) });

test('M33 WP2 re-ask: a first-answer twin without a grounded contradiction never keeps the re-ask\'s DECIDE out', async () => {
  const alone = await reaskReview([{ ...EMPTY, claims: [CLAIM] }]);
  assert.equal(alone.sessionStatus, 'DECIDE', 'premise: the re-ask\'s claim alone is a DECIDE finding');
  for (const [name, first] of Object.entries(TWINS)) {
    const calls = { narrative: 0 };
    const report = await reaskReview([{ ...EMPTY, claims: [first], decisions: [MALFORMED] }, { ...EMPTY, claims: [CLAIM] }],
      { calls });
    assert.equal(calls.narrative, 2, `${name}: the window was asked once more`);
    assert.equal(report.sessionStatus, 'DECIDE', `${name}: the re-ask's grounded contradiction is published`);
    assert.equal(report.reviewStatus, 'DECIDE', name);
    assert.deepEqual(findingsOf(report), ['claim_contradicted:DECIDE'], name);
    assert.deepEqual(partsOf(report), [['T1', 'DECIDE', ['finding_decide']]], name);
    assert.deepEqual(report.counts.proposalReasks, { asked: 1, recovered: 1, unreadable: 0 }, name);
    assert.deepEqual(report.promises, [], `${name}: the claim is its finding, never also an open promise`);
    assert.equal(report.sessionReview, 'complete', `${name}: a twin that did not ground is withheld, never a limit`);
  }
});

test('M33 WP2 re-ask: a re-ask twin without a contradiction never lowers the first answer\'s DECIDE', async () => {
  for (const [name, second] of Object.entries(TWINS)) {
    const report = await reaskReview([{ ...EMPTY, claims: [CLAIM], decisions: [MALFORMED] }, { ...EMPTY, claims: [second] }]);
    assert.equal(report.sessionStatus, 'DECIDE', name);
    assert.deepEqual(findingsOf(report), ['claim_contradicted:DECIDE'], name);
    assert.deepEqual(report.promises, [], name);
  }
});

test('M33 WP2 re-ask: copies that differ only in their resolution are both kept, and the merge never softens a DECIDE', async () => {
  const resolved = { ...CLAIM, resolvedBy: RESOLVED_BY };
  const base = () => claimSession({ resolved: true });
  const premise = await reaskReview([{ ...EMPTY, claims: [resolved] }], { base: base() });
  assert.deepEqual(findingsOf(premise), ['claim_contradicted:FYI'], 'premise: the resolved claim alone is self-corrected');
  // First answer DECIDE (no resolution), re-ask FYI (resolved): one finding, still DECIDE.
  const kept = await reaskReview([{ ...EMPTY, claims: [CLAIM], decisions: [MALFORMED] }, { ...EMPTY, claims: [resolved] }],
    { base: base() });
  assert.deepEqual(findingsOf(kept), ['claim_contradicted:DECIDE'], 'a resample never lowers a grounded DECIDE');
  assert.equal(kept.findings[0].disclosureReason, undefined);
  assert.equal(kept.counts.findingsMerged, 1, 'both copies were grounded, and merged by the existing rule');
  // First answer FYI (resolved), re-ask without the resolution: the existing merge rule keeps DECIDE if
  // either copy is — the same outcome two windows proposing these two copies have.
  const other = await reaskReview([{ ...EMPTY, claims: [resolved], decisions: [MALFORMED] }, { ...EMPTY, claims: [CLAIM] }],
    { base: base() });
  assert.deepEqual(findingsOf(other), ['claim_contradicted:DECIDE']);
  assert.equal(other.counts.findingsMerged, 1);
});

test('M33 WP2 re-ask: the exact identity of a claim includes its contradiction and its resolution', () => {
  const session = claimSession({ resolved: true });
  const ask = (first, second) => reviewRun.reaskedAnswer({ first: { ...EMPTY, decisions: [MALFORMED], ...first },
    second: { ...EMPTY, ...second }, session, repo: REPO, sourceMap: null }).narrative.claims;
  for (const [name, first] of Object.entries(TWINS))
    assert.deepEqual(ask({ claims: [first] }, { claims: [CLAIM] }), [first, CLAIM], `${name}: both copies are kept`);
  assert.deepEqual(ask({ claims: [CLAIM] }, { claims: [twin(undefined)] }), [CLAIM, twin(undefined)]);
  // The same receipts, exactly: one proposal, whatever order its keys came in.
  assert.deepEqual(ask({ claims: [CLAIM] }, { claims: [{ contradictedBy: { quote: AGAINST.quote, role: 'observation',
    eventId: 'A1-r' }, stated: STATED, text: TEXT }] }), [CLAIM]);
  // "No contradiction" is one meaning, however it is spelled.
  assert.deepEqual(ask({ claims: [twin(undefined)] }, { claims: [twin(null)] }), [twin(undefined)]);
  // A resolution is part of the identity: present or absent, and which receipts it cites.
  const resolved = { ...CLAIM, resolvedBy: RESOLVED_BY };
  assert.deepEqual(ask({ claims: [CLAIM] }, { claims: [resolved] }), [CLAIM, resolved]);
  assert.deepEqual(ask({ claims: [resolved] }, { claims: [structuredClone(resolved)] }), [resolved]);
  const elsewhere = { ...CLAIM, resolvedBy: { ...RESOLVED_BY, statement: receipt('C3', 'commentary', 'gaps=0.') } };
  assert.deepEqual(ask({ claims: [resolved] }, { claims: [elsewhere] }), [resolved, elsewhere]);
  // A null resolution is no resolution.
  assert.deepEqual(ask({ claims: [CLAIM] }, { claims: [{ ...CLAIM, resolvedBy: null }] }), [CLAIM]);
});

const WT = {
  ask: 'SYNTHETIC_WP2_WASK: add the notes.',
  notes: '# notes\nSYNTHETIC_WP2_NOTES: all parser tests pass.\n',
  wrote: 'SYNTHETIC_WP2_WROTE: done',
  test: 'node /srv/x/test.js',
  tests: 'SYNTHETIC_WP2_TESTS: 2 failing',
};
const wWhole = (key) => [{ sourceKey: key, fromByte: 0, untilByte: Buffer.byteLength(WT[key], 'utf8') }];
/** One turn: the agent writes the notes, then a later test run fails. */
const writtenSession = () => new Session({ sessionKey: 's', adapter: 'claude', blobs: { ...WT }, children: [], events: [
  { id: 'I1', kind: 'instruction', authority: 'human', supersedes: [], text: wWhole('ask') },
  { id: 'W1', kind: 'invocation', callKey: 'W1', tool: 'Write', operation: 'write', paths: [{ path: '/srv/x/NOTES.md' }],
    command: [], input: [], changes: [{ path: '/srv/x/NOTES.md', diff: [], before: [], after: wWhole('notes') }] },
  { id: 'W1-r', kind: 'observation', invocation: 'W1', callKey: 'W1', phase: 'terminal', result: 'succeeded', exitCode: 0,
    terminalStatusProven: true, output: wWhole('wrote'), sourceOfResult: 'native' },
  { id: 'A2', kind: 'invocation', callKey: 'A2', tool: 'Bash', operation: 'command', paths: [], command: wWhole('test'),
    input: [], changes: [] },
  { id: 'A2-r', kind: 'observation', invocation: 'A2', callKey: 'A2', phase: 'terminal', result: 'failed', exitCode: 1,
    terminalStatusProven: true, output: wWhole('tests'), sourceOfResult: 'native' },
].map((event, sequence) => ({ ...event, turn: 'T1', sequence })) });
const W_AGAINST = receipt('A2-r', 'observation', WT.tests);
const STATEMENT = Object.freeze({ text: 'The notes say all parser tests pass.',
  stated: receipt('W1', 'code', 'SYNTHETIC_WP2_NOTES: all parser tests pass.') });
const writtenReview = (answers) => {
  let nth = 0;
  return reviewRun.runReview({ session: writtenSession(), pr: null, reviewScope: 'session-only', judge: async (request) => {
    if (request.challenge) return { votes: request.challenge.items.map(({ key, candidate }) => vote(key, candidate.resolvedBy?.observation ?? W_AGAINST)) };
    return structuredClone(answers[Math.min(nth++, answers.length - 1)]);
  } });
};

test('M33 WP2 re-ask: a written statement\'s label only rises to contradicted across the first answer and the re-ask', async () => {
  const contradicted = { ...STATEMENT, contradictedBy: W_AGAINST };
  const premise = await writtenReview([{ ...EMPTY, writtenClaims: [contradicted] }]);
  assert.deepEqual(premise.writtenClaims.map((w) => w.label), ['contradicted'], 'premise: the re-ask\'s statement alone');
  const cases = {
    'first unverified, re-ask contradicted': [{ ...STATEMENT }, contradicted],
    'first with a contradiction that does not ground': [{ ...STATEMENT, contradictedBy: { ...W_AGAINST,
      quote: 'SYNTHETIC_WP2_TESTS: 9 failing' } }, contradicted],
    'first contradicted, re-ask unverified': [contradicted, { ...STATEMENT }],
  };
  for (const [name, [first, second]] of Object.entries(cases)) {
    const report = await writtenReview([{ ...EMPTY, decisions: [MALFORMED], writtenClaims: [first] },
      { ...EMPTY, writtenClaims: [second] }]);
    assert.deepEqual(report.writtenClaims.map((w) => [w.stated.eventId, w.label]), [['W1', 'contradicted']], name);
    assert.equal(report.counts.writtenClaims.contradicted, 1, name);
    assert.equal(report.counts.writtenClaims.unverified, 0, `${name}: one statement, one row`);
    assert.deepEqual(report.counts.proposalReasks, { asked: 1, recovered: 1, unreadable: 0 }, name);
    assert.equal(report.sessionStatus, 'CLEAN', `${name}: a written statement never changes a status`);
  }
  // A chat claim quoting the written body is the same written statement: its twin in the first answer
  // never keeps the re-ask's contradiction out either.
  const chat = await writtenReview([{ ...EMPTY, decisions: [MALFORMED], claims: [{ ...STATEMENT }] },
    { ...EMPTY, writtenClaims: [contradicted] }]);
  assert.deepEqual(chat.writtenClaims.map((w) => w.label), ['contradicted']);
  assert.equal(chat.counts.writtenClaims.reclassified, 1);
});

// ---- 2. an incomplete session review never headlines "none needs a decision" or "nothing is blocking" ----

const HT = {
  ask: 'SYNTHETIC_WP2_HASK: fix the replay.',
  replay: 'node /srv/x/replay.js',
  claim: 'SYNTHETIC_WP2_HCLAIM: this change clears the gap.',
  three: 'SYNTHETIC_WP2_HREPLAY: gaps=3',
  zero: 'SYNTHETIC_WP2_HREPLAY: gaps=0',
  fixed: 'SYNTHETIC_WP2_HFIXED: the replay now reports gaps=0.',
  ask2: 'SYNTHETIC_WP2_HASK2: now tidy up.',
  out2: 'SYNTHETIC_WP2_HOUT2: tidy',
  long1: `SYNTHETIC_WP2_HLONG1: still working.\n${'w'.repeat(400_000)}`,
  long2: `SYNTHETIC_WP2_HLONG2: still tidying.\n${'t'.repeat(400_000)}`,
};
const hWhole = (key) => [{ sourceKey: key, fromByte: 0, untilByte: Buffer.byteLength(HT[key], 'utf8') }];
const hRun = (id, turn) => ({ id, kind: 'invocation', callKey: id, tool: 'Bash', operation: 'command', paths: [],
  command: hWhole('replay'), input: [], changes: [], turn });
const hOut = (id, invocation, key, result, turn) => ({ id, kind: 'observation', invocation, callKey: invocation,
  phase: 'terminal', result, exitCode: result === 'failed' ? 1 : 0, terminalStatusProven: true, output: hWhole(key),
  sourceOfResult: 'native', turn });
/** T1: a self-corrected claim; a compaction; T2 in a window of its own. M35 windowing: a compaction no longer splits,
 *  so each turn ends on a long thought (400k bytes each): together over a session-only window's 200k tokens. A combined
 *  review (a ~196k-byte work budget) cuts T1 at its long thought, so T2 is its third window there. */
const headlineSession = () => new Session({ sessionKey: 's', adapter: 'claude', blobs: { ...HT }, children: [], events: [
  { id: 'I1', kind: 'instruction', authority: 'human', supersedes: [], text: hWhole('ask'), turn: 'T1' },
  { id: 'C1', kind: 'commentary', phase: 'working', beforeInvocation: null, text: hWhole('claim'), turn: 'T1' },
  hRun('A1', 'T1'), hOut('A1-r', 'A1', 'three', 'failed', 'T1'), hRun('A2', 'T1'), hOut('A2-r', 'A2', 'zero', 'succeeded', 'T1'),
  { id: 'C3', kind: 'commentary', phase: 'final', beforeInvocation: null, text: hWhole('fixed'), turn: 'T1' },
  { id: 'L1', kind: 'commentary', phase: 'working', beforeInvocation: null, text: hWhole('long1'), turn: 'T1' },
  { id: 'B1', kind: 'boundary', boundary: 'compaction', relatedSession: null, turn: 'T1' },
  { id: 'I2', kind: 'instruction', authority: 'human', supersedes: [], text: hWhole('ask2'), turn: 'T2' },
  hRun('A3', 'T2'), hOut('A3-r', 'A3', 'out2', 'succeeded', 'T2'),
  { id: 'L2', kind: 'commentary', phase: 'working', beforeInvocation: null, text: hWhole('long2'), turn: 'T2' },
].map((event, sequence) => ({ ...event, sequence })) });
const H_AGAINST = receipt('A1-r', 'observation', HT.three);
const SELF_CORRECTED = Object.freeze({ text: 'The agent said the change clears the gap.',
  stated: receipt('C1', 'commentary', 'this change clears the gap.'), contradictedBy: H_AGAINST,
  resolvedBy: { observation: receipt('A2-r', 'observation', HT.zero),
    statement: receipt('C3', 'commentary', 'the replay now reports gaps=0.') } });
const HALT = Symbol('throw');
/** T1's window answers `first`, T2's `second` (HALT: its call fails), any other window (a combined review's piece of
 *  T1 holding only its long thought) nothing. Every challenged item is upheld. A window is told apart by its own text:
 *  only T2's window shows T2's ask, and of the rest only T1's first shows T1's claim. */
const answerFor = (first, second, extra = {}) => async (request) => {
  if (request.challenge) return { votes: request.challenge.items.map(({ key, candidate }) => vote(key, candidate.resolvedBy?.observation ?? H_AGAINST)) };
  if (/^code\+chunk:/.test(request.label ?? '')) return { ...EMPTY, ...extra, reviewedFiles: ['src/g.js'] };
  const prompt = String(request.prompt ?? '');
  const answer = prompt.includes('SYNTHETIC_WP2_HASK2') ? second : prompt.includes('SYNTHETIC_WP2_HCLAIM') ? first : EMPTY;
  if (answer === HALT) throw Object.assign(new Error('model_unavailable'), { code: 'model_unavailable' });
  return { ...structuredClone(answer), ...extra };
};
const sessionOnlyHeadline = (first, second) => reviewRun.runReview({ session: headlineSession(), pr: null,
  reviewScope: 'session-only', judge: answerFor(first, second) });
const G_DIFF = ['diff --git a/src/g.js b/src/g.js', 'new file mode 100644', '--- /dev/null', '+++ b/src/g.js',
  '@@ -0,0 +1,1 @@', '+export default 1;', ''].join('\n');
const G_PR = { repo: { host: 'github.com', id: '9' }, number: 9, baseOid: 'b'.repeat(40), diffBaseOid: 'b'.repeat(40),
  headOid: 'a'.repeat(40), gitAlgorithm: 'sha1', enumeration: 'complete',
  files: [{ path: 'src/g.js', change: 'added', contentState: 'complete' }] };
const combinedHeadline = (first, second) => runCodeReview({ session: headlineSession(), pr: G_PR, diff: G_DIFF,
  judge: answerFor(first, second, { codeFindings: [], sessionFindings: [], reviewedFiles: [] }) });
// D71 (a), owner decision 2026-10-08: no headline status. What the review says of itself is one line, whether Sonah's
// own review ran (review.js RUN_STATE_SENTENCE); over an incomplete review it never reassures.
const headlineOf = (md) => md.split('\n').find((line) => line.startsWith("Sonah's review"));
const REASSURING = /none needs a decision|nothing is blocking/i;
const STATUS_TOKENS = /\b(DECIDE|FYI|CLEAN|NO_FINDINGS|UNCHECKED)\b/;
const WITH_FYI = { ...EMPTY, claims: [SELF_CORRECTED] };
const UNREADABLE = { ...EMPTY, decisions: [MALFORMED] };

test('M33 WP2 headline, D71: an FYI over an incomplete session review says the review did not complete', async () => {
  const routes = [
    ['session-only', 'a failed window', () => sessionOnlyHeadline(WITH_FYI, HALT)],
    ['session-only', 'an unreadable window', () => sessionOnlyHeadline(WITH_FYI, UNREADABLE)],
    ['combined', 'a failed window', () => combinedHeadline(WITH_FYI, HALT)],
    ['combined', 'an unreadable window', () => combinedHeadline(WITH_FYI, UNREADABLE)],
  ];
  for (const [scope, cause, reviewed] of routes) {
    const name = `${scope}, ${cause}`;
    const report = await reviewed();
    assert.equal(report.reviewStatus, 'FYI', `${name}: premise`);
    assert.equal(report.sessionReview, 'incomplete', `${name}: premise`);
    assert.deepEqual(report.parts.map((p) => [p.part, p.status]), [['T1', 'FYI'], ['T2', 'UNCHECKED']], `${name}: premise`);
    const md = review.renderReview(report);
    assert.equal(headlineOf(md), review.RUN_STATE_SENTENCE.incomplete, name);
    assert.ok(md.includes('Session review: **did not complete**'), name);
    assert.doesNotMatch(md, REASSURING, name);
    assert.doesNotMatch(md, STATUS_TOKENS, name);
  }
});

test('M33 WP2 headline, D71: a NO_FINDINGS over an incomplete session review says the review did not complete', async () => {
  const routes = {
    'session-only': () => sessionOnlyHeadline(EMPTY, UNREADABLE),
    combined: () => combinedHeadline(EMPTY, UNREADABLE),
  };
  for (const [name, reviewed] of Object.entries(routes)) {
    const report = await reviewed();
    assert.equal(report.reviewStatus, 'NO_FINDINGS', `${name}: premise`);
    assert.equal(report.sessionReview, 'incomplete', `${name}: premise`);
    const md = review.renderReview(report);
    assert.equal(headlineOf(md), review.RUN_STATE_SENTENCE.incomplete, name);
    assert.doesNotMatch(md, REASSURING, name);
    assert.doesNotMatch(md, STATUS_TOKENS, `${name}: never a status`);
  }
});

test('M33 WP2 headline, D71: a completed session review says it ran to completion, and never that the work is fine', async () => {
  const sessionOnly = await sessionOnlyHeadline(WITH_FYI, EMPTY);
  assert.equal(sessionOnly.sessionReview, 'complete');
  assert.equal(sessionOnly.reviewStatus, 'FYI');
  assert.equal(headlineOf(review.renderReview(sessionOnly)), review.RUN_STATE_SENTENCE.complete);
  const combined = await combinedHeadline(WITH_FYI, EMPTY);
  assert.equal(combined.sessionReview, 'complete');
  assert.equal(combined.reviewStatus, 'FYI');
  // The code review read no file here, so Sonah's review as a whole did not complete, whatever the session found.
  assert.equal(headlineOf(review.renderReview(combined)), review.RUN_STATE_SENTENCE[
    combined.codeCoverage === 'complete' ? 'complete' : 'incomplete']);
  assert.deepEqual(Object.keys(review.RUN_STATE_SENTENCE).sort(), ['complete', 'incomplete']);
  for (const sentence of Object.values(review.RUN_STATE_SENTENCE)) {
    assert.doesNotMatch(sentence, REASSURING);
    assert.doesNotMatch(sentence, /clean|approv|ready|complete enough/i);
    assert.doesNotMatch(sentence, STATUS_TOKENS);
  }
});
