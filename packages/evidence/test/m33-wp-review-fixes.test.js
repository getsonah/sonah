// M33 review-WP fixes (C-06 "M33 self-corrected claims", "M33 written statements", "M33 per-part
// verdicts"). Five defects a review of the per-part work package confirmed, each pinned here:
//
//   1. The bounded re-ask of a window whose answer holds an unreadable proposal never erases a readable
//      proposal of the first answer. The re-ask only ADDS its readable proposals not already present by
//      exact identity; the unreadable item itself is never recovered from the first answer. A re-ask that
//      fails, is no narrative, or is unreadable too keeps the first answer's readable proposals and limits
//      only that window's parts (`proposal_unreadable`). Precision over recall: a resample cannot turn a
//      grounded DECIDE into CLEAN.
//   2. A written statement whose identity or publication throws (a lone surrogate the transport's JSON
//      parser accepts) is withheld as `written_unreadable`; it never rejects the review. The other identity
//      digests model text reaches in this change set (promise identity, resolution items) never reject it
//      either.
//   3. A chat claim is reclassified as a written statement only when its stated quote is an exact substring
//      of the written body its window was supplied for that write; otherwise it stays an unreadable chat
//      claim (so the re-ask and part rules apply).
//   4. A transferred child's eventless gap (the child's sessionKey, no event, no sequence) is placed on the
//      part whose verified assignment spawned that child, exactly like the child's events.
//   5. The session-wide entry has its own review completeness: a window holding session-wide events that is
//      incomplete makes it unchecked, counted apart from the parts (`session_wide_unchecked`, review-WP2),
//      and the headline never says the review completed while `sessionReview` is `incomplete`.
//
// Synthetic sessions (/srv/x paths) and synthetic judges only: no recording, no model call. Nothing prints.
import test from 'node:test';
import assert from 'node:assert/strict';
import { Session } from '../src/session.js';
// Namespace imports, so each test fails on its own against code that predates it.
import * as ledger from '../src/ledger.js';
import * as reviewRun from '../src/run-review.js';
import * as review from '../src/review.js';
import * as written from '../src/written.js';
import { runCodeReview } from '../src/code-review.js';
import { planWindows } from '../src/windows.js';

const REPO = { host: 'github.com', id: '0' };
const EMPTY = Object.freeze({ decisions: [], pivots: [], claims: [], requirements: [] });
const receipt = (eventId, role, quote) => ({ eventId, role, quote });
const vote = (key, cited) => ({ key, verdict: 'not-refuted', explanation: 'Recorded.', receipts: [cited] });

// ---- 1. the bounded re-ask keeps the first answer's readable proposals ---------------------------------

const RT = {
  ask: 'SYNTHETIC_WP_ASK: make the synthetic replay report no gaps.',
  replay: 'node /srv/x/replay.js',
  claim: 'SYNTHETIC_WP_CLAIM: this change clears the gap.',
  three: 'SYNTHETIC_WP_REPLAY: gaps=3',
  // M33 C: a claim of done work — "I will add ..." is an intention, never a claim, and would be withheld.
  promise: 'SYNTHETIC_WP_PROMISE: the regression test is added.',
};
const rWhole = (key) => [{ sourceKey: key, fromByte: 0, untilByte: Buffer.byteLength(RT[key], 'utf8') }];
/** One turn: the ask, the claim, the replay that contradicts it, and a later promise. */
const reaskSession = () => new Session({ sessionKey: 's', adapter: 'claude', blobs: { ...RT }, children: [], events: [
  { id: 'I1', kind: 'instruction', authority: 'human', supersedes: [], text: rWhole('ask') },
  { id: 'C1', kind: 'commentary', phase: 'final', beforeInvocation: null, text: rWhole('claim') },
  { id: 'A1', kind: 'invocation', callKey: 'A1', tool: 'Bash', operation: 'command', paths: [], command: rWhole('replay'),
    input: [], changes: [] },
  { id: 'A1-r', kind: 'observation', invocation: 'A1', callKey: 'A1', phase: 'terminal', result: 'failed', exitCode: 1,
    terminalStatusProven: true, output: rWhole('three'), sourceOfResult: 'native' },
  { id: 'C2', kind: 'commentary', phase: 'working', beforeInvocation: null, text: rWhole('promise') },
].map((event, sequence) => ({ ...event, turn: 'T1', sequence })) });
const STATED = receipt('C1', 'commentary', 'this change clears the gap.');
const AGAINST = receipt('A1-r', 'observation', RT.three);
const CLAIM = Object.freeze({ text: 'The agent said the change clears the gap.', stated: STATED, contradictedBy: AGAINST });
const PROMISE = Object.freeze({ text: 'The agent said the regression test is added.',
  stated: receipt('C2', 'commentary', 'the regression test is added.') });
/** A decision proposal outside the response contract (no `chosen`, no `actions`): no check can read it. */
const MALFORMED = Object.freeze({ dimension: 'SYNTHETIC_WP_UNREADABLE' });
const FIRST = Object.freeze({ ...EMPTY, claims: [CLAIM], decisions: [MALFORMED] });
const FAIL = Symbol('fail');

/** The nth narrative request is answered by `answers[n]` (the last one repeats); FAIL throws. Every
 *  challenged item is upheld. `calls` counts the narrative requests. */
function reaskJudge(answers, calls = { narrative: 0 }) {
  return async (request) => {
    if (request.challenge) return { votes: request.challenge.items.map(({ key }) => vote(key, STATED)) };
    const answer = answers[Math.min(calls.narrative++, answers.length - 1)];
    if (answer === FAIL) throw Object.assign(new Error('model_unavailable'), { code: 'model_unavailable' });
    return structuredClone(answer);
  };
}
const reaskReview = (answers, calls) => reviewRun.runReview({ session: reaskSession(), pr: null,
  reviewScope: 'session-only', judge: reaskJudge(answers, calls) });
const findingsOf = (report) => report.findings.map((f) => `${f.kind}:${f.status}`);
const partsOf = (report) => report.parts.map((p) => [p.part, p.status, p.reasons]);

test('M33 WP re-ask: a readable contradiction beside one malformed item still publishes DECIDE when the re-ask is empty', async () => {
  const alone = await reaskReview([{ ...EMPTY, claims: [CLAIM] }]);
  assert.equal(alone.sessionStatus, 'DECIDE', 'premise: the claim alone is a DECIDE finding');
  const calls = { narrative: 0 };
  const report = await reaskReview([FIRST, EMPTY], calls);
  assert.equal(calls.narrative, 2, 'the window was asked once more');
  assert.equal(report.sessionStatus, 'DECIDE', 'a resample never erases the grounded contradiction');
  assert.equal(report.reviewStatus, 'DECIDE');
  assert.deepEqual(findingsOf(report), ['claim_contradicted:DECIDE']);
  assert.deepEqual(partsOf(report), [['T1', 'DECIDE', ['finding_decide']]]);
  // The re-ask read in full: the window keeps no unreadable proposal, so it is complete, and the
  // malformed item of the first answer is never recovered from it.
  assert.deepEqual(report.counts.proposalReasks, { asked: 1, recovered: 1, unreadable: 0 });
  assert.equal(report.windowResults[0].proposalUnreadable, false);
  assert.deepEqual(reviewRun.windowIncompleteReasons(report.windowResults[0]), []);
  assert.deepEqual(report.windowResults[0].challenge.rejected, []);
  assert.equal(report.sessionReview, 'complete');
});

test('M33 WP re-ask: a re-ask that fails, is no narrative or is unreadable too keeps the first answer\'s readable items', async () => {
  const cases = {
    failed: FAIL,
    'no narrative': { votes: [] },
    'not an object': null,
    'unreadable too': { ...EMPTY, decisions: [MALFORMED] },
  };
  for (const [name, second] of Object.entries(cases)) {
    const report = await reaskReview([FIRST, second]);
    assert.equal(report.sessionStatus, 'DECIDE', name);
    assert.deepEqual(findingsOf(report), ['claim_contradicted:DECIDE'], name);
    assert.deepEqual(report.counts.proposalReasks, { asked: 1, recovered: 0, unreadable: 1 }, name);
    assert.equal(report.windowResults[0].proposalUnreadable, true, name);
    // Only that window's parts read unchecked; the finding is never suppressed.
    assert.deepEqual(partsOf(report), [['T1', 'DECIDE', ['finding_decide', 'proposal_unreadable']]], name);
    // The first answer's unreadable item is read as it always was: a check that did not run.
    assert.deepEqual(report.windowResults[0].challenge.rejected.map((r) => [r.type, r.reason]),
      [['decision', 'kind_rejected']], name);
    assert.equal(report.sessionReview, 'incomplete', name);
  }
});

test('M33 WP re-ask: the re-ask adds only readable proposals that are not already present by exact identity', async () => {
  // The re-ask repeats the contradiction, adds a promise and omits the first answer's requirement: the
  // contradiction is challenged once, the promise is added, and the requirement is kept.
  // D71 (S2): a session-only answer's checklist status.
  const requirement = { text: 'Report no gaps.', instruction: receipt('I1', 'instruction', RT.ask), status: 'not-checked' };
  const seen = [];
  const judge = reaskJudge([{ ...FIRST, requirements: [requirement] }, { ...EMPTY, claims: [CLAIM, PROMISE] }]);
  const report = await reviewRun.runReview({ session: reaskSession(), pr: null, reviewScope: 'session-only',
    judge: async (request) => { seen.push(request); return judge(request); } });
  assert.deepEqual(findingsOf(report), ['claim_contradicted:DECIDE']);
  assert.deepEqual(report.promises.map((p) => p.stated.eventId), ['C2'], 'the new promise is added');
  assert.deepEqual(report.requirements.map((r) => [r.text, r.status]), [['Report no gaps.', 'not-checked']],
    'a readable proposal the re-ask omits is kept');
  const claimItems = seen.filter((request) => request.challenge && request.challenge.pass === 1)
    .flatMap((request) => request.challenge.items).filter((item) => item.type === 'claim');
  assert.deepEqual(claimItems.map((item) => item.candidate.stated.eventId).sort(), ['C1', 'C2'],
    'the repeated contradiction is not challenged twice');
  assert.deepEqual(report.counts.proposalReasks, { asked: 1, recovered: 1, unreadable: 0 });
});

test('M33 WP re-ask: the kept answer, channel by channel (decisions, pivots, claims, requirements, written statements)', () => {
  const session = reaskSession();
  const decision = { dimension: 'replay target', chosen: 'the synthetic replay', actions: ['A1'] };
  const pivot = { abandoned: 'the old replay', adopted: 'the new replay',
    receipts: [receipt('A1', 'action', RT.replay), receipt('A1-r', 'observation', RT.three)] };
  // D71 (S2): a session-only answer's checklist statuses.
  const requirement = { text: 'Report no gaps.', instruction: receipt('I1', 'instruction', 'report no gaps.'),
    status: 'not-checked' };
  const statement = { text: 'The notes say the gap is gone.', stated: receipt('A1', 'code', 'SYNTHETIC_WP_NOTES'),
    contradictedBy: null };
  const first = { decisions: [decision, MALFORMED], pivots: [pivot], claims: [CLAIM], requirements: [requirement],
    writtenClaims: [statement] };
  const second = {
    // The same structure — the same actions, no instruction, no stated receipt — whatever its `chosen` or `dimension`
    // says (D79): not added. Another structure (an instruction receipt): added.
    decisions: [{ ...decision, chosen: 'reworded' }, { ...decision, dimension: 'the replay that is run' },
      { dimension: 'replay command', chosen: 'node', actions: ['A1'],
        constrainedBy: { instruction: receipt('I1', 'instruction', RT.ask), settles: false } }],
    // The same receipt set in another order and other words: the same pivot.
    pivots: [{ abandoned: 'x', adopted: 'y', receipts: [...pivot.receipts].reverse() }],
    // The same stated receipt and text but no contradiction: another copy (review-WP2: a claim's exact
    // identity includes its contradiction and resolution), kept for grounding and the challenge. The
    // repeated claim itself is not added again. The promise is new.
    claims: [{ ...CLAIM, contradictedBy: null }, { ...CLAIM }, PROMISE],
    // The same instruction and text keep the first answer's row; a new text is added.
    requirements: [{ ...requirement, status: 'done' }, { ...requirement, text: 'Keep the replay fast.' }],
    // The same written statement with a contradiction is another copy too; the same one repeated is not — nor is it
    // in other words (D78: the review's paraphrase is no part of a statement's identity).
    writtenClaims: [{ ...statement, contradictedBy: AGAINST }, { ...statement },
      { ...statement, text: 'The notes say it is fast.' }],
  };
  const kept = reviewRun.reaskedAnswer({ first, second, session, repo: REPO, sourceMap: null });
  assert.equal(kept.recovered, true, 'the re-ask read in full');
  assert.deepEqual(kept.narrative.decisions.map((d) => d.dimension), ['replay target', 'replay command']);
  assert.equal(kept.narrative.decisions[0].chosen, 'the synthetic replay', 'the first answer\'s row stands');
  assert.deepEqual(kept.narrative.pivots, [pivot]);
  assert.deepEqual(kept.narrative.claims, [CLAIM, { ...CLAIM, contradictedBy: null }, PROMISE]);
  assert.deepEqual(kept.narrative.requirements.map((r) => [r.text, r.status]),
    [['Report no gaps.', 'not-checked'], ['Keep the replay fast.', 'not-checked']]);
  assert.deepEqual(kept.narrative.writtenClaims.map((w) => [w.text, w.contradictedBy]),
    [['The notes say the gap is gone.', null], ['The notes say the gap is gone.', AGAINST]]);
  assert.ok(!kept.narrative.decisions.includes(MALFORMED), 'the unreadable item is never recovered');
  // A re-ask holding an unreadable proposal of its own: the first answer's unreadable item stays, to be
  // read as it always was, beside what the re-ask adds; nothing unreadable is added from the re-ask.
  const partly = reviewRun.reaskedAnswer({ first, second: { ...second, decisions: [...second.decisions, MALFORMED] },
    session, repo: REPO, sourceMap: null });
  assert.equal(partly.recovered, false);
  assert.deepEqual(partly.narrative.decisions.map((d) => d.dimension), ['replay target', MALFORMED.dimension, 'replay command']);
  // An unreadable proposal the first answer still holds is not present: it never keeps out the re-ask's
  // readable proposal of the same identity (here one that adds the missing `chosen`, or drops a rating).
  const unread = { ...EMPTY, decisions: [{ dimension: 'replay command', actions: ['A1'] }],
    writtenClaims: [{ ...statement, confidence: 'high' }] };
  const fixed = { ...EMPTY, decisions: [{ dimension: 'replay command', chosen: 'node', actions: ['A1'] }, MALFORMED],
    writtenClaims: [statement] };
  const both = reviewRun.reaskedAnswer({ first: unread, second: fixed, session, repo: REPO, sourceMap: null });
  assert.equal(both.recovered, false);
  assert.deepEqual(both.narrative.decisions, [unread.decisions[0], fixed.decisions[0]]);
  assert.deepEqual(both.narrative.writtenClaims, [unread.writtenClaims[0], statement]);
  // No narrative at all: the first answer stands as it came.
  for (const none of [null, { votes: [] }, 'SYNTHETIC not an answer']) {
    const kept2 = reviewRun.reaskedAnswer({ first, second: none, session, repo: REPO, sourceMap: null });
    assert.equal(kept2.recovered, false);
    assert.deepEqual(kept2.narrative, first);
  }
  // Deterministic: the same answers keep the same bytes.
  assert.deepEqual(reviewRun.reaskedAnswer({ first, second, session, repo: REPO, sourceMap: null }), kept);
});

// ---- 2. an identity digest that throws never rejects the review --------------------------------------------

const WT = {
  ask: 'SYNTHETIC_WP_WASK: add the notes.',
  notes: '# notes\nSYNTHETIC_WP_STATUS: all parser tests pass \u{1F600} today.\n',
  wrote: 'SYNTHETIC_WP_WROTE: file created',
  test: 'node /srv/x/test.js',
  tests: 'SYNTHETIC_WP_TESTS: 2 failing',
  said: 'SYNTHETIC_WP_SAID: the notes are written \u{1F600} and final.',
};
const wWhole = (key) => [{ sourceKey: key, fromByte: 0, untilByte: Buffer.byteLength(WT[key], 'utf8') }];
/** One turn: the agent writes the notes, says so, then a test run fails. Both texts carry an emoji, whose
 *  high surrogate alone is a substring of the recorded text that no identity digest accepts. */
const writtenSession = () => new Session({ sessionKey: 's', adapter: 'claude', blobs: { ...WT }, events: [
  { id: 'I1', kind: 'instruction', authority: 'human', supersedes: [], text: wWhole('ask') },
  { id: 'A1', kind: 'invocation', callKey: 'A1', tool: 'Write', operation: 'write', paths: [{ path: '/srv/x/NOTES.md' }],
    command: [], input: [], changes: [{ path: '/srv/x/NOTES.md', diff: [], before: [], after: wWhole('notes') }] },
  { id: 'A1-r', kind: 'observation', invocation: 'A1', callKey: 'A1', phase: 'terminal', result: 'succeeded', exitCode: 0,
    terminalStatusProven: true, output: wWhole('wrote'), sourceOfResult: 'native' },
  { id: 'C1', kind: 'commentary', phase: 'final', beforeInvocation: null, text: wWhole('said') },
  { id: 'A2', kind: 'invocation', callKey: 'A2', tool: 'Bash', operation: 'command', paths: [], command: wWhole('test'),
    input: [], changes: [] },
  { id: 'A2-r', kind: 'observation', invocation: 'A2', callKey: 'A2', phase: 'terminal', result: 'failed', exitCode: 1,
    terminalStatusProven: true, output: wWhole('tests'), sourceOfResult: 'native' },
].map((event, sequence) => ({ ...event, turn: 'T1', sequence })) });
const LONE = '\ud83d';
const W_STATUS = receipt('A1', 'code', 'SYNTHETIC_WP_STATUS: all parser tests pass');
const W_TESTS = receipt('A2-r', 'observation', WT.tests);
/** What the transport's JSON parser returns for an escaped lone surrogate: a string no digest accepts. */
const wire = (value) => JSON.parse(JSON.stringify(value).replaceAll('LONE', '\\ud83d'));
const writtenReview = (narrative, calls = { challenge: 0 }) => reviewRun.runReview({ session: writtenSession(), pr: null,
  reviewScope: 'session-only', judge: async (request) => {
    if (!request.challenge) return wire(narrative);
    calls.challenge++;
    return { votes: request.challenge.items.map(({ key }) => vote(key, W_TESTS)) };
  } });
const verdictOf = (report) => ({ sessionStatus: report.sessionStatus, sessionReview: report.sessionReview,
  coverage: report.coverage });

test('M33 WP identity: a written statement whose identity digest throws is withheld as written_unreadable', async () => {
  const baseline = await writtenReview(EMPTY);
  const plain = await writtenReview({ ...EMPTY, writtenClaims: [{ text: 'The notes say all tests pass.', stated: W_STATUS }] });
  assert.equal(plain.writtenClaims.length, 1, 'premise: the same statement without the surrogate is published');
  const cases = {
    'lone surrogate in its text': { text: 'The notes say all tests pass LONE.', stated: W_STATUS },
    // A quote ending in half of the emoji the agent wrote: a substring of the written body, so it grounds.
    'lone surrogate in its grounded quote': { text: 'The notes say all tests pass.',
      stated: receipt('A1', 'code', 'all parser tests pass LONE'), contradictedBy: W_TESTS },
  };
  for (const [name, statement] of Object.entries(cases)) {
    const calls = { challenge: 0 };
    const report = await writtenReview({ ...EMPTY, writtenClaims: [statement] }, calls);
    assert.deepEqual(report.writtenClaims, [], name);
    assert.equal(report.withheld.causes?.written_unreadable, 1, name);
    assert.equal(report.withheld.proposals, 1, name);
    assert.deepEqual(verdictOf(report), verdictOf(baseline), `${name}: never a limit on the review`);
    assert.deepEqual(reviewRun.windowIncompleteReasons(report.windowResults[0]), [], name);
    assert.equal(calls.challenge, 0, `${name}: a statement that cannot be published is never challenged`);
    assert.doesNotThrow(() => JSON.stringify(report), name);
  }
  // The same statement reclassified from a chat claim is withheld the same way.
  const chat = await writtenReview({ ...EMPTY, claims: [{ text: 'The notes say all tests pass LONE.', stated: W_STATUS }] });
  assert.deepEqual(chat.writtenClaims, []);
  assert.equal(chat.withheld.causes?.written_unreadable, 1);
  assert.equal(chat.counts.writtenClaims.reclassified, 1);
  // One statement that cannot be published never costs another its publication.
  const both = await writtenReview({ ...EMPTY, writtenClaims: [cases['lone surrogate in its text'],
    { text: 'The notes say all tests pass.', stated: W_STATUS }] });
  assert.deepEqual(both.writtenClaims.map((w) => w.text), ['The notes say all tests pass.']);
  assert.equal(both.withheld.causes?.written_unreadable, 1);
});

test('M33 WP identity: publishedStatement never throws; an identity it cannot compute is a withheld statement', () => {
  const read = { statement: { text: `The notes say ${LONE}.`, stated: { ...W_STATUS, sessionKey: 's' } } };
  let published;
  assert.doesNotThrow(() => { published = written.publishedStatement(REPO, read, undefined); });
  assert.deepEqual(published, { record: null, rejected: null, withheld: ledger.WRITTEN_WITHHELD_CAUSES[0] });
  const fine = written.publishedStatement(REPO, { statement: { ...read.statement, text: 'The notes say so.' } }, undefined);
  assert.equal(typeof fine.record.id, 'string');
  assert.equal(fine.withheld, undefined);
});

test('M33 WP identity: a promise or a contradiction whose identity digest throws never rejects the review', async () => {
  // A promise (a chat claim no result contradicts) quoting half of the emoji the agent said: its identity
  // cannot be computed, so it is a proposal no check could read — its window's limit, never a rejection.
  const halfQuote = receipt('C1', 'commentary', 'the notes are written LONE');
  const promise = await writtenReview({ ...EMPTY, claims: [{ text: 'The agent said the notes are written.', stated: halfQuote }] });
  assert.deepEqual(promise.promises, []);
  assert.equal(promise.claimsRejected, 1);
  assert.equal(promise.sessionStatus, 'UNCHECKED');
  assert.deepEqual(promise.parts.map((p) => [p.part, p.status]), [['T1', 'UNCHECKED']]);
  // The same quote as a contradicted claim's stated receipt: the finding's identity cannot be computed,
  // so the ledger rejects it as a check that did not run.
  const contradicted = await writtenReview({ ...EMPTY, claims: [{ text: 'The agent said the notes are written.',
    stated: halfQuote, contradictedBy: W_TESTS }] });
  assert.deepEqual(contradicted.findings, []);
  assert.equal(contradicted.sessionStatus, 'UNCHECKED');
  assert.doesNotThrow(() => JSON.stringify(contradicted));
});

test('M33 WP identity: a resolution quoting half a surrogate pair never rejects the review; the contradiction stands', async () => {
  const TT = { ask: 'SYNTHETIC_WP_RASK: fix the replay.', replay: 'node /srv/x/replay.js',
    claim: 'SYNTHETIC_WP_RCLAIM: this change clears the gap.', three: 'SYNTHETIC_WP_RREPLAY: gaps=3',
    zero: 'SYNTHETIC_WP_RREPLAY: gaps=0', fixed: 'SYNTHETIC_WP_RFIXED: the replay now reports gaps=0 \u{1F600} done.' };
  const tWhole = (key) => [{ sourceKey: key, fromByte: 0, untilByte: Buffer.byteLength(TT[key], 'utf8') }];
  const run = (id) => ({ id, kind: 'invocation', callKey: id, tool: 'Bash', operation: 'command', paths: [],
    command: tWhole('replay'), input: [], changes: [] });
  const out = (id, invocation, key, result) => ({ id, kind: 'observation', invocation, callKey: invocation, phase: 'terminal',
    result, exitCode: result === 'failed' ? 1 : 0, terminalStatusProven: true, output: tWhole(key), sourceOfResult: 'native' });
  const base = new Session({ sessionKey: 's', adapter: 'claude', blobs: { ...TT }, events: [
    { id: 'I1', kind: 'instruction', authority: 'human', supersedes: [], text: tWhole('ask') },
    { id: 'C1', kind: 'commentary', phase: 'working', beforeInvocation: null, text: tWhole('claim') },
    run('A1'), out('A1-r', 'A1', 'three', 'failed'), run('A2'), out('A2-r', 'A2', 'zero', 'succeeded'),
    { id: 'C3', kind: 'commentary', phase: 'final', beforeInvocation: null, text: tWhole('fixed') },
  ].map((event, sequence) => ({ ...event, turn: 'T1', sequence })) });
  const claim = { text: 'The agent said the change clears the gap.', stated: receipt('C1', 'commentary', 'this change clears the gap.'),
    contradictedBy: receipt('A1-r', 'observation', TT.three),
    resolvedBy: { observation: receipt('A2-r', 'observation', TT.zero),
      statement: receipt('C3', 'commentary', 'the replay now reports gaps=0 LONE') } };
  const report = await reviewRun.runReview({ session: base, pr: null, reviewScope: 'session-only',
    judge: async (request) => (request.challenge
      // M33 C (vote binding): the resolution item is upheld on its own later result.
      ? { votes: request.challenge.items.map(({ key, candidate }) => vote(key,
        candidate.resolvedBy?.observation ?? receipt('A1-r', 'observation', TT.three))) }
      : wire({ ...EMPTY, claims: [claim] })) });
  // Review-WP2 note: a half-surrogate quote MAY ground. Grounding is an exact string search over the recorded
  // text as JavaScript holds it (UTF-16 code units), and the high surrogate alone is a substring of the
  // emoji the agent said, so the resolution's statement receipt verifies like any other. No identity digest
  // reads a resolution's quote, so nothing refuses it: the resolution passes every code check, its own
  // challenge item is upheld, and the finding is published FYI `self_corrected` — exactly as for a quote that
  // stops short of the emoji. The contradiction itself is published either way.
  assert.deepEqual(report.findings.map((f) => [f.kind, f.status, f.disclosureReason]),
    [['claim_contradicted', 'FYI', 'self_corrected']]);
  assert.equal(report.findings[0].resolvedBy.statement.quote, `the replay now reports gaps=0 ${LONE}`,
    'the published quote is the half-surrogate quote as it grounded');
  assert.equal(report.counts.resolutions.verified, 1);
  assert.equal(report.sessionStatus, 'FYI');
  assert.equal(report.sessionReview, 'complete');
  assert.deepEqual(report.parts.map((p) => [p.part, p.status, p.reasons]), [['T1', 'FYI', ['finding_fyi']]]);
  assert.doesNotThrow(() => JSON.stringify(report));
});

// ---- 3. a chat claim is a written statement only when it quotes the written body its window was shown ---

const CT = {
  ask: 'SYNTHETIC_WP_CASK: add the notes.',
  notes: '# notes\nSYNTHETIC_WP_BODY: notes body.\n',
  wrote: 'SYNTHETIC_WP_CWROTE: file created',
  old: 'SYNTHETIC_WP_OLD: parser untested',
  edited: 'SYNTHETIC_WP_EDITED: parser handles empty input',
  updated: 'SYNTHETIC_WP_UPDATED: file updated',
  said: 'SYNTHETIC_WP_CSAID: all parser tests pass.',
  test: 'node /srv/x/test.js',
  tests: 'SYNTHETIC_WP_CTESTS: 2 failing',
};
const cWhole = (key) => [{ sourceKey: key, fromByte: 0, untilByte: Buffer.byteLength(CT[key], 'utf8') }];
/** One turn: a create, an edit, a chat statement and a failing test run. `compaction` puts the create in a
 *  window of its own, so the later windows are not shown its written body. M35 windowing: a compaction no longer
 *  splits, so the option adds a long thought after the create (730k bytes, over a session-only window's 200k tokens;
 *  `compaction: 'combined'` 250k bytes, over a combined window's budget and under its 512 KiB request): the turn is cut
 *  at its thoughts, and the create's window is the first. */
function claimSession({ compaction = false } = {}) {
  const longBytes = compaction === 'combined' ? 250_000 : 730_000;
  const blobs = { ...CT, ...(compaction ? { long: `SYNTHETIC_WP_LONG: still working.\n${'w'.repeat(longBytes)}` } : {}) };
  const events = [
    { id: 'I1', kind: 'instruction', authority: 'human', supersedes: [], text: cWhole('ask') },
    { id: 'A1', kind: 'invocation', callKey: 'A1', tool: 'Write', operation: 'write', paths: [{ path: '/srv/x/NOTES.md' }],
      command: [], input: [], changes: [{ path: '/srv/x/NOTES.md', diff: [], before: [], after: cWhole('notes') }] },
    { id: 'A1-r', kind: 'observation', invocation: 'A1', callKey: 'A1', phase: 'terminal', result: 'succeeded', exitCode: 0,
      terminalStatusProven: true, output: cWhole('wrote'), sourceOfResult: 'native' },
    ...(compaction ? [{ id: 'B1', kind: 'boundary', boundary: 'compaction', relatedSession: null },
      { id: 'L1', kind: 'commentary', phase: 'working', beforeInvocation: null,
        text: [{ sourceKey: 'long', fromByte: 0, untilByte: Buffer.byteLength(blobs.long, 'utf8') }] }] : []),
    { id: 'A3', kind: 'invocation', callKey: 'A3', tool: 'Edit', operation: 'edit', paths: [{ path: '/srv/x/PARSER.md' }],
      command: [], input: [], changes: [{ path: '/srv/x/PARSER.md', diff: [], before: cWhole('old'), after: cWhole('edited') }] },
    { id: 'A3-r', kind: 'observation', invocation: 'A3', callKey: 'A3', phase: 'terminal', result: 'succeeded', exitCode: 0,
      terminalStatusProven: true, output: cWhole('updated'), sourceOfResult: 'native' },
    { id: 'C1', kind: 'commentary', phase: 'working', beforeInvocation: null, text: cWhole('said') },
    { id: 'A2', kind: 'invocation', callKey: 'A2', tool: 'Bash', operation: 'command', paths: [], command: cWhole('test'),
      input: [], changes: [] },
    { id: 'A2-r', kind: 'observation', invocation: 'A2', callKey: 'A2', phase: 'terminal', result: 'failed', exitCode: 1,
      terminalStatusProven: true, output: cWhole('tests'), sourceOfResult: 'native' },
  ].map((event, sequence) => ({ ...event, turn: 'T1', sequence }));
  return new Session({ sessionKey: 's', adapter: 'claude', blobs, events });
}
const C_AGAINST = receipt('A2-r', 'observation', CT.tests);
const chatClaim = (stated) => ({ text: 'The agent said all parser tests pass.', stated, contradictedBy: C_AGAINST });
const claimReview = (stated, { base = claimSession(), at = null, calls = { narrative: 0 } } = {}) => reviewRun.runReview({
  session: base, pr: null, reviewScope: 'session-only', judge: async (request) => {
    if (request.challenge) return { votes: request.challenge.items.map(({ key }) => vote(key, C_AGAINST)) };
    calls.narrative++;
    return at === null || request.window.index === at ? { ...EMPTY, claims: [chatClaim(stated)] } : { ...EMPTY };
  } });

test('M33 WP reclassification: a chat claim mis-roled `code` on a write but quoting chat text stays an unreadable claim', async () => {
  const premise = await claimReview(receipt('C1', 'commentary', 'all parser tests pass.'));
  assert.equal(premise.sessionStatus, 'DECIDE', 'premise: the claim cited as commentary is a DECIDE finding');
  const cases = {
    'chat text on a create': receipt('A1', 'code', 'all parser tests pass.'),
    // An edit's before-text is code the record found, never text the agent wrote.
    'before-text of an edit': receipt('A3', 'code', CT.old),
  };
  for (const [name, stated] of Object.entries(cases)) {
    const calls = { narrative: 0 };
    const report = await claimReview(stated, { calls });
    assert.equal(report.counts.writtenClaims.reclassified, 0, name);
    assert.equal(report.withheld.causes?.written_ungrounded ?? 0, 0, name);
    assert.deepEqual(report.writtenClaims, [], name);
    assert.equal(calls.narrative, 2, `${name}: an unreadable proposal is re-asked once`);
    assert.equal(report.windowResults[0].proposalUnreadable, true, name);
    assert.deepEqual(report.windowResults[0].challenge.rejected.map((r) => [r.type, r.reason]), [['claim', 'kind_rejected']], name);
    assert.deepEqual(report.parts.map((p) => [p.part, p.status, p.reasons]), [['T1', 'UNCHECKED', ['proposal_unreadable']]], name);
    assert.equal(report.sessionStatus, 'UNCHECKED', `${name}: never CLEAN`);
  }
  // The written body of the edit, as its window was shown it, is still reclassified.
  const body = await claimReview(receipt('A3', 'code', CT.edited));
  assert.equal(body.counts.writtenClaims.reclassified, 1);
  assert.deepEqual(body.writtenClaims.map((w) => [w.stated.eventId, w.label]), [['A3', 'contradicted']]);
  assert.equal(body.sessionStatus, 'CLEAN');
});

test('M33 WP reclassification: a written body its window was not supplied is no written statement of that window', async () => {
  // The create is in window 1; window 2 proposes a chat claim citing it as `code` with its exact body.
  const report = await claimReview(receipt('A1', 'code', 'SYNTHETIC_WP_BODY: notes body.'),
    { base: claimSession({ compaction: true }), at: 1 });
  assert.equal(report.counts.writtenClaims.reclassified, 0);
  assert.equal(report.windowResults[1].proposalUnreadable, true);
  assert.equal(report.windowResults[0].proposalUnreadable, false);
  assert.equal(report.sessionStatus, 'UNCHECKED');
  // The predicate itself: the written side, as supplied.
  const session = claimSession();
  const sourceMap = { A1: session.sourcesFor(session.event('A1')).map(({ role, text }) => ({ role, text })) };
  const claimOn = (quote) => ({ text: 't', stated: receipt('A1', 'code', quote) });
  assert.equal(written.writtenChatClaim(claimOn('SYNTHETIC_WP_BODY: notes body.'), session, sourceMap), true);
  assert.equal(written.writtenChatClaim(claimOn('all parser tests pass.'), session, sourceMap), false);
  assert.equal(written.writtenChatClaim(claimOn('SYNTHETIC_WP_BODY: notes body.'), session, {}), false, 'not supplied');
  assert.equal(written.writtenChatClaim(claimOn('SYNTHETIC_WP_BODY: notes body.'), session), true,
    'with no window facts, the written body alone decides');
  assert.equal(written.writtenChatClaim(claimOn('all parser tests pass.'), session), false);
  assert.equal(written.writtenChatClaim({ text: 't', stated: receipt('A3', 'code', CT.old) }, session), false,
    'an edit\'s before-text is not written');
});

test('M33 WP reclassification: the combined route counts a mis-roled chat claim as a narrative it could not read', async () => {
  const GREET = 'src/greet.js';
  const diff = ['diff --git a/src/greet.js b/src/greet.js', 'new file mode 100644', '--- /dev/null',
    '+++ b/src/greet.js', '@@ -0,0 +1,1 @@', '+export default "SYNTHETIC_WP_GREETING";', ''].join('\n');
  const pr = { repo: { host: 'github.com', id: '335' }, number: 335, baseOid: 'b'.repeat(40), diffBaseOid: 'b'.repeat(40),
    headOid: 'a'.repeat(40), gitAlgorithm: 'sha1', enumeration: 'complete',
    files: [{ path: GREET, change: 'added', contentState: 'complete' }] };
  const judge = (claims, label = null) => async (request) => {
    const base = { ...EMPTY, codeFindings: [], sessionFindings: [], reviewedFiles: [] };
    if (request.challenge) return { votes: request.challenge.items.map(({ key }) => vote(key, C_AGAINST)) };
    if (/^code\+chunk:/.test(request.label ?? '')) return { ...base, reviewedFiles: [GREET] };
    return label === null || request.label === label ? { ...base, claims } : base;
  };
  const misroled = await runCodeReview({ session: claimSession(), pr, diff,
    judge: judge([chatClaim(receipt('A1', 'code', 'all parser tests pass.'))]) });
  assert.equal(misroled.rejectedNarrative, 1);
  assert.equal(misroled.counts.writtenClaims.reclassified, 0);
  const body = await runCodeReview({ session: claimSession(), pr, diff,
    judge: judge([chatClaim(receipt('A1', 'code', 'SYNTHETIC_WP_BODY: notes body.'))]) });
  assert.equal(body.rejectedNarrative, 0, 'a claim quoting the supplied written body is a written statement');
  assert.equal(body.counts.writtenClaims.reclassified, 1);
  // Window 2 was not shown the create: its claim quoting the create's body is one the join cannot read,
  // placed in window 2's parts exactly as runReview reads it.
  const unshown = await runCodeReview({ session: claimSession({ compaction: 'combined' }), pr, diff,
    judge: judge([chatClaim(receipt('A1', 'code', 'SYNTHETIC_WP_BODY: notes body.'))], 'code+narrative:w2') });
  assert.equal(unshown.rejectedNarrative, 1);
  assert.deepEqual(unshown.rejectedNarrativeWindows, [1]);
  assert.equal(unshown.counts.writtenClaims.reclassified, 0);
});

// ---- 4. a transferred child's eventless gap is its spawning part's -------------------------------------------

const PT = {
  ask1: 'SYNTHETIC_WP_PASK1: run the synthetic checks and hand the notes to a helper.',
  cmd: 'node /srv/x/check.js',
  out1: 'SYNTHETIC_WP_POUT1: 3 passed',
  brief: 'SYNTHETIC_WP_BRIEF: write the synthetic notes.',
  childOut: 'SYNTHETIC_WP_CHILD_OUT: notes written',
  ask2: 'SYNTHETIC_WP_PASK2: now tidy the synthetic notes.',
  out2: 'SYNTHETIC_WP_POUT2: 1 passed',
  post: 'SYNTHETIC_WP_POST: a note recorded after the last turn.',
  long: `SYNTHETIC_WP_PLONG: a long note.\n${'n'.repeat(730_000)}`,
};
const pWhole = (key) => [{ sourceKey: key, fromByte: 0, untilByte: Buffer.byteLength(PT[key], 'utf8') }];
const pCmd = (id, over) => ({ id, kind: 'invocation', callKey: id, tool: 'Bash', operation: 'command', paths: [],
  command: pWhole('cmd'), input: [], changes: [], ...over });
const pRes = (id, inv, out, over) => ({ id, kind: 'observation', invocation: inv, callKey: inv, phase: 'terminal',
  result: 'succeeded', exitCode: 0, terminalStatusProven: true, output: pWhole(out), sourceOfResult: 'native', ...over });
/** T1 hands off to a verified child `w` (and `w` to a grandchild `v`); a compaction; T2. `post` adds a
 *  compaction and turnless root notes, in a window of their own. M35 windowing: a compaction no longer splits and each
 *  helper is a session of its own, reviewed right after the window that launched it; the first turnless note is a long
 *  thought (730k bytes), so T2 is cut at it and the notes are a later piece. */
function partSession({ post = false, link = 'verified' } = {}) {
  const T = (n) => ({ turn: `T${n}` });
  const child = { childId: 'w', turn: 'child:w:T1' };
  const grandchild = { childId: 'v', turn: 'child:w:child:v:T1' };
  const events = [
    { id: 'I1', kind: 'instruction', authority: 'human', supersedes: [], text: pWhole('ask1'), ...T(1) },
    pCmd('A1', T(1)), pRes('A1-r', 'A1', 'out1', T(1)),
    { id: 'D1', kind: 'invocation', callKey: 'D1', tool: 'Task', operation: 'delegate', paths: [], command: [],
      input: pWhole('brief'), changes: [], ...T(1) },
    pCmd('child:w:A9', child), pRes('child:w:A9-r', 'child:w:A9', 'childOut', child),
    { id: 'child:w:D5', kind: 'invocation', callKey: 'child:w:D5', tool: 'Task', operation: 'delegate', paths: [],
      command: [], input: pWhole('brief'), changes: [], ...child },
    pCmd('child:w:child:v:A1', grandchild), pRes('child:w:child:v:A1-r', 'child:w:child:v:A1', 'childOut', grandchild),
    { id: 'B1', kind: 'boundary', boundary: 'compaction', relatedSession: null, ...T(1) },
    { id: 'I2', kind: 'instruction', authority: 'human', supersedes: [], text: pWhole('ask2'), ...T(2) },
    pCmd('A2', T(2)), pRes('A2-r', 'A2', 'out2', T(2)),
    ...(post ? [{ id: 'B9', kind: 'boundary', boundary: 'compaction', relatedSession: null },
      { id: 'S8', kind: 'commentary', phase: 'working', beforeInvocation: null, text: pWhole('long') },
      { id: 'S9', kind: 'commentary', phase: 'working', beforeInvocation: null, text: pWhole('post') }] : []),
  ].map((event, sequence) => ({ ...event, sequence }));
  return new Session({ sessionKey: 's', adapter: 'claude', blobs: { ...PT }, events, children: [
    { assignmentEvent: 'D1', childId: 'w', childSession: 's/child:w', sessionKey: 's/child:w', relation: 'spawn',
      state: link, historyStart: null },
    { assignmentEvent: 'child:w:D5', childId: 'v', childSession: 's/child:w/child:v', sessionKey: 's/child:w/child:v',
      relation: 'spawn', state: 'verified', historyStart: null },
  ] });
}
/** The shape the adapter gives a transferred child's own eventless loss: its sessionKey and loss ordinal. */
const eventlessGap = (sessionKey) => ({ code: 'incomplete_inventory', channel: 'commentary', scope: 'session', count: 1,
  sessionKey, lossOrdinal: 0, note: 'synthetic capture loss' });
const partReview = (base, { fail = [] } = {}) => reviewRun.runReview({ session: base, pr: null, reviewScope: 'session-only',
  judge: async (request) => {
    if (request.challenge) return { votes: [] };
    if (fail.includes(request.window.index)) throw Object.assign(new Error('model_unavailable'), { code: 'model_unavailable' });
    return { ...EMPTY };
  } });

test('M33 WP parts: a transferred child\'s eventless gap is placed on the part whose assignment spawned the child', async () => {
  assert.deepEqual([...ledger.childSessionParts(partSession())], [['s/child:w', 'T1'], ['s/child:w/child:v', 'T1']],
    'a child session is in the part its verified spawn is in; the root session is in none');
  assert.deepEqual([...ledger.childSessionParts(partSession({ link: 'ambiguous' }))], [['s/child:w/child:v', ledger.SESSION_WIDE]]);
  for (const key of ['s/child:w', 's/child:w/child:v']) {
    const base = partSession();
    base.adapterGaps = [eventlessGap(key)];
    const report = await partReview(base);
    assert.deepEqual(report.parts.map((p) => [p.part, p.status, p.reasons, p.counts.gaps]),
      [['T1', 'NO_FINDINGS', ['gap_declared'], 1], ['T2', 'CLEAN', [], 0]], key);
    assert.equal(report.sessionWideLimits.limited, false, `${key}: not a session-wide limit`);
    assert.equal(report.sessionWideLimits.counts.gaps, 0, key);
    assert.deepEqual(report.partCounts,
      { parts_fully_checked: 1, parts_partial: 1, parts_decide_unsettled: 0, parts_unchecked: 0, session_wide_unchecked: 0 }, key);
    assert.equal(report.sessionStatus, 'NO_FINDINGS', key);
    const md = review.renderReview(report);
    assert.ok(md.includes('Parts: 1 part fully checked, 1 partial, 0 not checked.'), key);
    assert.ok(!md.includes('session-wide:'), `${key}: no session-wide entry to name`);
  }
});

test('M33 WP parts: only a gap with no event, no sequence and no placeable sessionKey is session-wide', async () => {
  const cases = {
    'the root session': 's',
    'no session key': undefined,
    'an unknown session': 's/child:zz',
  };
  for (const [name, key] of Object.entries(cases)) {
    const base = partSession();
    const gap = eventlessGap(key);
    if (key === undefined) delete gap.sessionKey;
    base.adapterGaps = [gap];
    const report = await partReview(base);
    assert.deepEqual(report.parts.map((p) => [p.part, p.status]), [['T1', 'CLEAN'], ['T2', 'CLEAN']], name);
    assert.deepEqual(report.sessionWideLimits.reasons, ['gap_unplaced'], name);
    assert.equal(report.sessionStatus, 'NO_FINDINGS', name);
    // Review-WP2: the session-wide entry is limited, never counted among the parts, and named apart.
    assert.equal(report.sessionWideLimits.limited, true, name);
    assert.deepEqual(report.partCounts,
      { parts_fully_checked: 2, parts_partial: 0, parts_decide_unsettled: 0, parts_unchecked: 0, session_wide_unchecked: 0 }, name);
    assert.ok(review.renderReview(report).includes('Parts: 2 parts fully checked, 0 partial, 0 not checked; '
      + 'session-wide: limited.'), name);
  }
  // A child no verified spawn link places is in no part, and neither is its eventless loss.
  const without = await partReview(partSession({ link: 'ambiguous' }));
  const unlinked = partSession({ link: 'ambiguous' });
  unlinked.adapterGaps = [eventlessGap('s/child:w')];
  const report = await partReview(unlinked);
  assert.ok(report.sessionWideLimits.reasons.includes('gap_unplaced'));
  assert.equal(report.sessionWideLimits.counts.gaps, without.sessionWideLimits.counts.gaps + 1);
  assert.equal(report.parts.find((p) => p.part === 'T1').counts.gaps, without.parts.find((p) => p.part === 'T1').counts.gaps);
});

// ---- 5. the session-wide entry has its own review completeness ---------------------------------------------

test('M33 WP parts: an incomplete window holding session-wide events leaves the session-wide entry unchecked', async () => {
  const postWindow = planWindows(partSession({ post: true })).findIndex((w) => w.events.some((e) => e.id === 'S9'));
  assert.ok(planWindows(partSession({ post: true }))[postWindow].events.every((e) => !e.turn), 'premise: turnless events only');
  const report = await partReview(partSession({ post: true }), { fail: [postWindow] });
  assert.equal(report.sessionReview, 'incomplete', 'premise: the session review did not complete');
  assert.deepEqual(report.parts.map((p) => [p.part, p.status]), [['T1', 'CLEAN'], ['T2', 'CLEAN']]);
  assert.deepEqual(report.sessionWideLimits.reasons, ['window_incomplete']);
  assert.equal(report.sessionWideLimits.status, 'UNCHECKED');
  // Review-WP2: counted apart from the parts (`session_wide_unchecked`), never folded into `parts_unchecked`.
  assert.deepEqual(report.partCounts, { parts_fully_checked: 2, parts_partial: 0, parts_decide_unsettled: 0, parts_unchecked: 0,
    session_wide_unchecked: 1 }, 'the unchecked session-wide entry is counted, apart from the parts');
  assert.equal(report.sessionStatus, 'NO_FINDINGS', 'the parts that were checked completed');
  // Recomputing from the report never changes it.
  assert.deepEqual(ledger.honestStatuses(report).partCounts, report.partCounts);
  const md = review.renderReview(report);
  // D71 (a): never "a completed session review" — the review says it did not complete — and no status.
  assert.ok(md.includes(review.RUN_STATE_SENTENCE.incomplete) && md.includes('Session review: **did not complete**'));
  assert.doesNotMatch(md, /\b(CLEAN|UNCHECKED|NO_FINDINGS)\b/);
  assert.ok(md.includes('Parts: 2 parts fully checked, 0 partial, 0 not checked; session-wide: not checked.'));
  // Saved without its recording, the declared entries reduce the same way.
  const { session: _omitted, ...saved } = report;
  const reloaded = ledger.honestStatuses(JSON.parse(JSON.stringify(saved)));
  assert.deepEqual(reloaded.partCounts, report.partCounts);
  assert.equal(reloaded.sessionStatus, 'NO_FINDINGS');
  // A completed review of the same session: no session-wide limit, nothing unchecked.
  const clean = await partReview(partSession({ post: true }));
  assert.deepEqual(clean.partCounts,
    { parts_fully_checked: 2, parts_partial: 0, parts_decide_unsettled: 0, parts_unchecked: 0, session_wide_unchecked: 0 });
  assert.equal(clean.sessionStatus, 'CLEAN');
  assert.ok(review.renderReview(clean).includes('Parts: 2 parts fully checked, 0 partial, 0 not checked.'));
});
