// M33 C (C-06 "M33 claims are facts", C-05 "M33 vote binding"). What a chat claim is, and how a statement that is
// not one is kept away from the DECIDE route and from the promises.
//
// Three kinds of published `claim_contradicted` finding were wrong or only partly right, each reproduced here as a
// synthetic statement:
//   (a) the statement already disclosed the failing run that "contradicted" it     -> refuted by the challengers
//   (b) the statement was a conditional inference ("... once the adapter works")    -> refuted by the challengers
//   (c) the statement was an intention ("I'm continuing ... to finish checks")      -> refuted by the challengers
// (M33 C withheld (a) as `claim_disclosed` and (c) as `claim_not_factual` in code, before any challenge. The
// recheck narrowed both; M33 C recheck 2 removed both, because each still hid true contradictions a reviewer must
// see — m33-c-claims-recheck2.test.js. The challengers' v8 criteria refute all three: `refuteNotClaims` below is
// that criterion as a synthetic verdict.)
// A true contradiction — "all unit tests pass" AFTER a failing run with no later pass — still publishes
// DECIDE, and a contradicting result recorded AFTER a statement that mentions a failure is never
// "disclosed". A claim a later recorded result confirms (`supportedBy`) is a promise `verified`; any other
// promise stays `open`, which a reader is shown as "not checked", never as "open".
//
// Tiers: in the tiered profiles every claim joins the three-pass run. Vote binding: a support vote on an
// item that can publish counts only when it cites one of that item's own events (one hop invocation <->
// result included); refutations are unchanged.
//
// Synthetic sessions (/srv/x paths) and synthetic judges only: no recording, no model call. Nothing prints.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Session } from '../src/session.js';
// Namespace imports, so each test fails on its own against code that predates it.
import * as ledger from '../src/ledger.js';
import * as reviewRun from '../src/run-review.js';
import { bytesOfTokens } from '../src/windows.js';
import * as challenge from '../src/challenge.js';
import * as prompt from '../src/prompt.js';
import * as review from '../src/review.js';
import * as codeReviewPrompt from '../src/code-review-prompt.js';
import { sessionFromLedger } from '../adapters/sonah-ledger.js';
import { sliceLineage } from '../../slicer/index.js';
import { redact } from '../../redact/index.js';
import { renderReportMarkdown } from '../../render/session-story.js';
import { CASES } from '../../cli/test/m33-fast-profile-fixture.js';
import { beforeM36Labels, beforeM36Conversation, textBeforeS7, textBeforeFixColumn, textBeforeAsksFixes, textBeforeW1, textBeforeW2 }
  from './m33-integration-fixture.js';

const claimsModule = await import('../src/claims.js').catch(() => ({}));

const SESSION_KEY = 'sess-c-claims';
const TEXT = {
  ask: 'SYNTHETIC_C_ASK: make the synthetic suites pass and commit the result.',
  load: 'node /srv/x/load.js',
  loadOut: 'SYNTHETIC_C_LOAD: 3 requests timed out under load',
  disclosed: 'SYNTHETIC_C_DISCLOSED: the unit suite is green, but the load run is failing: 3 requests timed out under load.',
  conditional: 'SYNTHETIC_C_CONDITIONAL: the replay can be reviewed with the tokenizer backend once the adapter works.',
  plan: 'cat /srv/x/PLAN.md',
  planOut: 'SYNTHETIC_C_PLAN: review the replay with the regex backend instead.',
  intention: "SYNTHETIC_C_INTENTION: I'm continuing that session to finish checks and make the commit.",
  checks: 'node /srv/x/checks.js',
  checksOut: 'SYNTHETIC_C_CHECKS: 2 checks still failing',
  unit: 'node /srv/x/unit.js',
  unitOut: 'SYNTHETIC_C_UNIT: 1 failing',
  claimTrue: 'SYNTHETIC_C_TRUE: all unit tests pass.',
  lintSaid: 'SYNTHETIC_C_LINT_SAID: the lint is clean.',
  lint: 'node /srv/x/lint.js',
  lintOut: 'SYNTHETIC_C_LINT: 0 warnings',
  plain: 'SYNTHETIC_C_PLAIN: the notes file is written.',
  after: 'SYNTHETIC_C_AFTER: the flaky retry is fixed; the integration suite passes.',
  integration: 'node /srv/x/integration.js',
  integrationOut: 'SYNTHETIC_C_INTEGRATION: 4 failing',
  brief: 'SYNTHETIC_C_BRIEF: run the synthetic lint.',
  childLint: 'SYNTHETIC_C_CHILD_LINT: 0 warnings',
};
const whole = (key) => [{ sourceKey: key, fromByte: 0, untilByte: Buffer.byteLength(TEXT[key], 'utf8') }];
const T1 = { turn: 'T1' };
const command = (id, key, over = {}) => ({ id, kind: 'invocation', callKey: id, tool: 'Bash', operation: 'command',
  paths: [], command: whole(key), input: [], changes: [], ...T1, ...over });
const result = (id, invocation, key, over = {}) => ({ id, kind: 'observation', invocation, callKey: invocation,
  phase: 'terminal', result: 'succeeded', exitCode: 0, terminalStatusProven: true, output: whole(key),
  sourceOfResult: 'native', ...T1, ...over });
const failed = { result: 'failed', exitCode: 1 };
const said = (id, key, over = {}) => ({ id, kind: 'commentary', phase: 'working', beforeInvocation: null, text: whole(key),
  ...T1, ...over });

/** One human turn, one review window: every statement this file judges, in session order. */
function session() {
  const child = { childId: 'w', turn: 'child:w:T1' };
  const events = [
    { id: 'I1', kind: 'instruction', authority: 'human', supersedes: [], text: whole('ask'), ...T1 },
    command('A1', 'load'), result('A1-r', 'A1', 'loadOut', failed),
    said('C1', 'disclosed'),
    said('C2', 'conditional'),
    command('A2', 'plan'), result('A2-r', 'A2', 'planOut'),
    said('C3', 'intention'),
    command('A3', 'checks'), result('A3-r', 'A3', 'checksOut', failed),
    command('A4', 'unit'), result('A4-r', 'A4', 'unitOut', failed),
    said('C4', 'claimTrue'),
    said('C5', 'lintSaid'),
    command('A5', 'lint'), result('A5-r', 'A5', 'lintOut'),
    said('C6', 'plain', { phase: 'final' }),
    said('C7', 'after'),
    command('A7', 'integration'), result('A7-r', 'A7', 'integrationOut', failed),
    { id: 'D1', kind: 'invocation', callKey: 'D1', tool: 'Task', operation: 'delegate', paths: [], command: [],
      input: whole('brief'), changes: [], ...T1 },
    command('child:w:A9', 'lint', child), result('child:w:A9-r', 'child:w:A9', 'childLint', child),
  ].map((event, sequence) => ({ ...event, sequence }));
  const children = [{ assignmentEvent: 'D1', childId: 'w', childSession: `${SESSION_KEY}/child:w`,
    sessionKey: `${SESSION_KEY}/child:w`, relation: 'spawn', state: 'verified', historyStart: null }];
  return new Session({ sessionKey: SESSION_KEY, adapter: 'claude', blobs: { ...TEXT }, events, children });
}

const receipt = (eventId, role, quote) => ({ eventId, role, quote });
const CLAIMS = Object.freeze({
  disclosed: { text: 'The agent said the unit suite is green.', stated: receipt('C1', 'commentary', 'the unit suite is green'),
    contradictedBy: receipt('A1-r', 'observation', TEXT.loadOut) },
  conditional: { text: 'The agent said the replay can be reviewed with the tokenizer backend.',
    stated: receipt('C2', 'commentary', 'the replay can be reviewed with the tokenizer backend once the adapter works.'),
    contradictedBy: receipt('A2-r', 'observation', TEXT.planOut) },
  intention: { text: 'The agent said it finished the checks and made the commit.',
    stated: receipt('C3', 'commentary', "I'm continuing that session to finish checks and make the commit."),
    contradictedBy: receipt('A3-r', 'observation', TEXT.checksOut) },
  truth: { text: 'The agent said all unit tests pass.', stated: receipt('C4', 'commentary', 'all unit tests pass.'),
    contradictedBy: receipt('A4-r', 'observation', TEXT.unitOut) },
  supported: { text: 'The agent said the lint is clean.', stated: receipt('C5', 'commentary', 'the lint is clean.'),
    contradictedBy: null, supportedBy: receipt('A5-r', 'observation', TEXT.lintOut) },
  plain: { text: 'The agent said the notes file is written.', stated: receipt('C6', 'commentary', 'the notes file is written.'),
    contradictedBy: null },
  after: { text: 'The agent said the integration suite passes.', stated: receipt('C7', 'commentary', 'the integration suite passes.'),
    contradictedBy: receipt('A7-r', 'observation', TEXT.integrationOut) },
});
const narrativeOf = (claims) => ({ decisions: [], pivots: [], requirements: [], claims: structuredClone(claims) });

/** The receipt an honest challenger cites for an item: its own contradiction, support or resolution result,
 *  else what the agent said. */
const ownReceipt = ({ candidate }) => candidate.resolvedBy?.observation ?? candidate.contradictedBy
  ?? candidate.supportedBy ?? candidate.stated ?? candidate.instruction ?? candidate.receipts?.[0];
/** `verdict(item, request)` and `cite(item, request)`; every request is kept in `seen`. */
function judgeWith(narrative, { verdict = () => 'not-refuted', cite = ownReceipt, seen = [] } = {}) {
  return async (request) => {
    seen.push(request);
    if (!request.challenge) return request.window.index === 0 ? structuredClone(narrative) : narrativeOf([]);
    return { votes: request.challenge.items.map((item) => {
      const chosen = verdict(item, request);
      return { key: item.key, verdict: chosen, explanation: 'Synthetic.', receipts: chosen === 'uncertain' ? [] : [cite(item, request)] };
    }) };
  };
}
const run = (claims, options = {}, { speedProfile, base = session() } = {}) => reviewRun.runReview({ session: base, pr: null,
  reviewScope: 'session-only', ...(speedProfile ? { speedProfile } : {}), judge: judgeWith(narrativeOf(claims), options) });
const statuses = (report) => report.findings.filter((f) => f.kind === 'claim_contradicted').map((f) => f.status);
const findingOf = (report, eventId) => report.findings.find((f) => f.kind === 'claim_contradicted'
  && f.receipts.some((r) => r.eventId === eventId));
const challengedKeys = (seen) => seen.filter((request) => request.challenge).flatMap((request) => request.challenge.items.map((i) => i.key));
/** M33 C recheck 2: no withheld cause is a claim's: code withholds no claim before its challenge. */
const claimCauses = (report) => Object.keys(report.withheld?.causes ?? {}).filter((cause) => cause.startsWith('claim_'));
/** M33 C recheck: the challenger's criterion for (b) — a conditional is not a claim — as a synthetic verdict. */
const refuteConditional = (item) => (String(item.candidate?.stated?.quote ?? '').includes('once the adapter works')
  ? 'refuted' : 'not-refuted');
/** M33 C recheck 2: the challengers' v8 criteria for all three wrong findings, as a synthetic verdict — refute a
 *  contradiction the statement already disclosed (a), a conditional (b) and an intention (c). */
const NOT_CLAIMS = Object.freeze(['the unit suite is green', 'once the adapter works', "I'm continuing that session"]);
const refuteNotClaims = (item) => (item.type === 'claim'
  && NOT_CLAIMS.some((words) => String(item.candidate?.stated?.quote ?? '').includes(words)) ? 'refuted' : 'not-refuted');

// ---- premise: what the synthetic session publishes for a true contradiction ---------------------------------

test('M33 C premise: the true contradiction grounds and publishes DECIDE', async () => {
  const report = await run([CLAIMS.truth]);
  assert.deepEqual(statuses(report), ['DECIDE']);
  assert.equal(report.sessionReview, 'complete');
});

// ---- the three wrong findings, each refuted by its challenge (M33 C recheck 2: never withheld by code) --------

test('M33 C (a): a contradiction the statement already disclosed is refuted by its challenge, never DECIDE', async () => {
  const seen = [];
  const report = await run([CLAIMS.disclosed], { seen, verdict: refuteNotClaims });
  assert.deepEqual(statuses(report), [], 'the disclosed failure is not an accusation');
  assert.equal(report.promises.length, 0, 'nor a promise');
  assert.deepEqual(challengedKeys(seen), ['claims:0', 'claims:0', 'claims:0'], 'asked, three passes');
  assert.equal(report.challenge.refutedItems, 1, 'a resolved refutation');
  assert.deepEqual(claimCauses(report), [], 'never withheld by code');
  assert.equal(report.sessionReview, 'complete', 'a check that ran, never a check that did not');
  assert.equal(report.sessionStatus, 'CLEAN');
  // M33 C recheck 2: code never decides it: a challenger that upholds it publishes it.
  assert.deepEqual(statuses(await run([CLAIMS.disclosed])), ['DECIDE']);
});

test('M33 C (b): a conditional inference is not a claim: left to the challengers, who refute it, never DECIDE', async () => {
  // M33 C recheck: "once" and "if" anywhere in a quote also withheld factual claims ("The client now retries once
  // on timeout."), so code no longer withholds a conditional; the challenger's criteria refute it.
  const seen = [];
  const report = await run([CLAIMS.conditional], { seen, verdict: refuteConditional });
  assert.deepEqual(statuses(report), []);
  assert.deepEqual(claimCauses(report), []);
  assert.deepEqual(challengedKeys(seen), ['claims:0', 'claims:0', 'claims:0'], 'asked, three passes');
  assert.equal(report.challenge.refutedItems, 1, 'a resolved refutation');
  assert.equal(report.promises.length, 0);
  assert.equal(report.sessionReview, 'complete');
});

test('M33 C (c): an intention is not a claim: refuted by its challenge, kept from the DECIDE route and the promises', async () => {
  const contradicted = await run([CLAIMS.intention], { verdict: refuteNotClaims });
  assert.deepEqual(statuses(contradicted), []);
  assert.equal(contradicted.challenge.refutedItems, 1);
  // The same statement with no contradiction would be an open promise; the challengers refute it too.
  const bare = await run([{ ...CLAIMS.intention, contradictedBy: null }], { verdict: refuteNotClaims });
  assert.equal(bare.promises.length, 0, 'an intention is never a promise');
  assert.equal(bare.challenge.refutedItems, 1);
  assert.deepEqual([...claimCauses(contradicted), ...claimCauses(bare)], [], 'never withheld by code');
});

test('M33 C: a true contradiction — "all unit tests pass" after a failing run with no later pass — still publishes DECIDE', async () => {
  const report = await run([CLAIMS.truth, CLAIMS.disclosed, CLAIMS.conditional, CLAIMS.intention], { verdict: refuteNotClaims });
  assert.deepEqual(statuses(report), ['DECIDE'], 'only the true contradiction');
  assert.ok(findingOf(report, 'A4-r'), 'the unit-test contradiction');
  // M33 C recheck 2: the other three are refuted by their challenges, none withheld by code.
  assert.equal(report.challenge.refutedItems, 3);
  assert.deepEqual(claimCauses(report), []);
  assert.equal(report.sessionStatus, 'DECIDE');
});

test('M33 C: a contradicting result recorded AFTER a statement that mentions a failure is never "disclosed"', async () => {
  const report = await run([CLAIMS.after]);
  assert.deepEqual(statuses(report), ['DECIDE']);
  assert.deepEqual(claimCauses(report), []);
});

// ---- supportedBy: a promise verified by a later recorded result ------------------------------------------

test('M33 C: a claim a later recorded result confirms is a verified promise, citing that result', async () => {
  const report = await run([CLAIMS.supported, CLAIMS.plain]);
  assert.deepEqual(report.promises.map((p) => [p.stated.eventId, p.status]), [['C5', 'verified'], ['C6', 'open']]);
  const [verified] = report.promises;
  assert.deepEqual(verified.receipts.map((r) => r.eventId), ['C5', 'A5-r']);
  assert.equal(report.counts.promiseSupport.verified, 1);
  assert.equal(report.sessionReview, 'complete');
  // D71 (S2): and `incomplete`, a claim whose every cited check never ran to an end.
  assert.deepEqual([...ledger.PROMISE_STATUSES], ['open', 'verified', 'incomplete']);
});

test('M33 C: a supportedBy that fails a code check leaves the promise open, counted by closed reason', async () => {
  // W3 F2 (owner decision 2026-10-13): a session-only review no longer refuses a failed run's result (`failed_result`):
  // it is asked, judged on its outcome line (w3-support-failed.test.js); the combined route still refuses it
  // (m33-c-claims-recheck.test.js).
  const cases = [
    // M35 (windowing): a helper is a session of its own. M36 phase 3 (D68 K): this small one shares its parent's window,
    // so its result is supplied there — and is another actor's: `cross_actor`. (A helper reviewed in a window of its own
    // is not supplied to its parent's: `unsupplied`, below.)
    ['cross_actor', receipt('child:w:A9-r', 'observation', TEXT.childLint)],
    ['ungrounded', receipt('A5-r', 'observation', 'SYNTHETIC QUOTE NOBODY EVER RECORDED')],
    ['role_mismatch', receipt('C6', 'commentary', 'the notes file is written.')],
    ['malformed', 'the lint run passed'],
  ];
  for (const [reason, supportedBy] of cases) {
    const seen = [];
    const report = await run([{ ...CLAIMS.supported, supportedBy }], { seen });
    assert.deepEqual(report.promises.map((p) => p.status), ['open'], `${reason}: the claim stays, open`);
    assert.equal(report.counts.promiseSupport.rejected[reason], 1, reason);
    assert.equal(report.counts.promiseSupport.verified, 0, reason);
    const asked = seen.filter((r) => r.challenge).flatMap((r) => r.challenge.items);
    assert.ok(asked.every((item) => item.type === 'claim' && !Object.hasOwn(item.candidate, 'supportedBy')),
      `${reason}: never shown to a challenger, and never asked as a support item`);
    assert.equal(report.sessionReview, 'complete', `${reason}: a rejected support never makes the claim unread`);
  }
  // M33 C repair: and then how an asked support's own challenge item ended (m33-c-claims-repair.test.js).
  assert.deepEqual([...ledger.SUPPORT_REJECTIONS], ['contradicted', 'malformed', 'role_mismatch', 'unsupplied',
    'ungrounded', 'not_later', 'cross_actor', 'failed_result', 'not_same_turn', 'stale_run', 'refuted', 'unsettled',
    'unexecuted']);
});

test('M33 C: supportedBy and contradictedBy on one claim — the contradiction wins, DECIDE as before', async () => {
  const seen = [];
  const both = await run([{ ...CLAIMS.truth, supportedBy: receipt('A5-r', 'observation', TEXT.lintOut) }], { seen });
  assert.deepEqual(statuses(both), ['DECIDE']);
  assert.equal(both.promises.length, 0);
  assert.equal(both.counts.promiseSupport.rejected.contradicted, 1);
  const [item, ...more] = [...new Set(seen.filter((r) => r.challenge).flatMap((r) => r.challenge.items.map((i) => i.key)))]
    .map((key) => seen.filter((r) => r.challenge).flatMap((r) => r.challenge.items).find((i) => i.key === key));
  assert.ok(!Object.hasOwn(item.candidate, 'supportedBy'), 'the contradiction is asked exactly as without a support');
  assert.deepEqual(more, [], 'and no support item is asked');
  // Byte for byte the request the contradiction alone sends.
  const alone = [];
  await run([CLAIMS.truth], { seen: alone });
  assert.equal(seen.find((r) => r.challenge).prompt, alone.find((r) => r.challenge).prompt);
});

test('M33 C: a support whose result was not supplied to the claim\'s window leaves the promise open (unsupplied)', async () => {
  // Two windows (M35): a thought over the window budget recorded before the lint run cuts the segment there, so the
  // claim's window was never shown its result.
  const base = session();
  const events = [...base.events];
  const at = events.findIndex((e) => e.id === 'A5');
  const big = 'z'.repeat(bytesOfTokens(210_000));
  events.splice(at, 0, { id: 'CBIG', kind: 'commentary', phase: 'working', beforeInvocation: null,
    text: [{ sourceKey: 'big', fromByte: 0, untilByte: big.length }], ...T1 });
  const split = new Session({ sessionKey: SESSION_KEY, adapter: 'claude', blobs: { ...TEXT, big },
    events: events.map((event, sequence) => ({ ...event, sequence })), children: base.children });
  const report = await run([CLAIMS.supported], {}, { base: split });
  assert.deepEqual(report.promises.map((p) => p.status), ['open']);
  assert.equal(report.counts.promiseSupport.rejected.unsupplied, 1);
  assert.equal(report.withheld.proposals, 0, 'an unsupplied support never withholds its claim');
});

test('M33 C: a verified promise is never lowered by an open copy of the same claim', async () => {
  const unsupported = { ...CLAIMS.supported, supportedBy: null };
  const report = await run([unsupported, CLAIMS.supported, unsupported]);
  assert.deepEqual(report.promises.map((p) => p.status), ['verified']);
  assert.deepEqual(report.promises[0].receipts.map((r) => r.eventId), ['C5', 'A5-r']);
});

// ---- vote binding --------------------------------------------------------------------------------------

const FOREIGN = receipt('C6', 'commentary', 'the notes file is written.');

test('M33 C vote binding: a support vote on a contradicted claim that cites none of its events does not count', async () => {
  const report = await run([CLAIMS.truth], { cite: () => FOREIGN });
  assert.deepEqual(statuses(report), [], 'three unbound support votes publish no DECIDE');
  assert.equal(report.withheld.unsettled, 1, 'every pass voted; nothing settled it');
  const [result] = report.windowResults[0].challenge.results;
  assert.ok(result.votes.every((v) => v.valid === false && v.answered === true && v.cause === 'support_unbound'));
  assert.equal(result.executionComplete, true, 'the votes were cast: a check that ran');
  assert.equal(report.sessionReview, 'complete');
  // M33 C event binding: the only closed cause (M33 C recheck 2's `vote_misfiled` is gone with its rule), and the status
  // fact's (owner decision 2026-10-06), for an item citing an uncovered result, and D80's, for a receipt quoting only
  // the body of a write whose command did not run or failed.
  assert.deepEqual([...challenge.VOTE_REJECTION_CAUSES], ['support_unbound', 'result_unquoted',
    'write_command_not_run_or_failed']);
});

test('M33 C vote binding: one hop — the command whose result contradicts the claim is the claim\'s own event', async () => {
  const report = await run([CLAIMS.truth], { cite: () => receipt('A4', 'action', TEXT.unit) });
  assert.deepEqual(statuses(report), ['DECIDE']);
  // And from a cited command to its result: a support item citing A5 may be supported by A5-r's quote. M36 phase 3 (D68
  // K): the helper ran the very same lint command and shares the parent's window; M36 phase 3 review (c6): the vote's
  // quote grounds in the event it cites (the parent's A5), so packing changes nothing — shown without the helper, then
  // with it.
  const parentOnly = () => {
    const whole = session();
    return new Session({ sessionKey: SESSION_KEY, adapter: 'claude', blobs: { ...TEXT }, children: [],
      events: whole.events.filter((event) => event.childId == null && event.id !== 'D1') });
  };
  const supported = await run([{ ...CLAIMS.supported, supportedBy: receipt('A5-r', 'observation', TEXT.lintOut) }],
    { cite: () => receipt('A5', 'action', TEXT.lint) }, { base: parentOnly() });
  assert.deepEqual(supported.promises.map((p) => p.status), ['verified']);
  const packed = await run([{ ...CLAIMS.supported, supportedBy: receipt('A5-r', 'observation', TEXT.lintOut) }],
    { cite: () => receipt('A5', 'action', TEXT.lint) });
  // The same words in the helper's shown text change nothing: the cited event names the session.
  assert.deepEqual(packed.promises.map((p) => p.status), ['verified'], 'the votes quote the parent\'s own command');
  assert.equal(Object.hasOwn(packed.counts, 'ambiguousQuotes'), false);
});

test('M33 C vote binding: refutations are unchanged — counterevidence may come from anywhere', async () => {
  const report = await run([CLAIMS.truth], { verdict: () => 'refuted', cite: () => FOREIGN });
  assert.deepEqual(statuses(report), []);
  assert.equal(report.challenge.refutedItems, 1, 'a resolved refutation');
  assert.equal(report.withheld.unsettled, 0);
});

test('M33 C vote binding: an item that cannot publish (a plain claim, a decision) is not bound', async () => {
  const report = await run([CLAIMS.plain], { cite: () => receipt('A4-r', 'observation', TEXT.unitOut) });
  assert.deepEqual(report.promises.map((p) => p.status), ['open']);
  // M33 C repair: a support is its own publication-bound item. Citing elsewhere leaves the support unsettled —
  // never verified — while the claim, asked bare and not bound, is published open.
  const supported = await run([CLAIMS.supported], { cite: () => FOREIGN });
  assert.deepEqual(supported.promises.map((p) => p.status), ['open']);
  assert.equal(supported.counts.promiseSupport.rejected.unsettled, 1);
});

test('M33 C vote binding: challengeItems binds only the items its caller names, and only not-refuted votes', async () => {
  // M33 C2 repair: a claim-class item is asked only with code's grounded words (`verbatim`), as the run gives it.
  const items = [{ key: 'a', type: 'claim', candidate: { text: 'SYNTHETIC a', stated: { eventId: 'C0', role: 'commentary', quote: 'SYNTHETIC said' } }, verbatim: { quote: 'SYNTHETIC said' } },
    { key: 'b', type: 'claim', candidate: { text: 'SYNTHETIC b', stated: { eventId: 'C0', role: 'commentary', quote: 'SYNTHETIC said' } }, verbatim: { quote: 'SYNTHETIC said' } }];
  const verifyReceipt = (r) => ({ ok: true, receipt: r });
  const vote = (key, verdict, eventId) => ({ key, verdict, explanation: 'Synthetic.', receipts: [{ eventId, role: 'observation', quote: 'SYNTHETIC' }] });
  const judge = async (request) => ({ votes: request.challenge.items.map((item) => vote(item.key, 'not-refuted', 'E9')) });
  const bound = await challenge.challengeItems({ items, judge, evidence: 'SYNTHETIC', verifyReceipt,
    supportEvents: (item) => (item.key === 'a' ? new Set(['E1']) : null) });
  assert.deepEqual(bound.survivors.map((i) => i.key), ['b'], 'a is bound to E1; b is not bound');
  const own = await challenge.challengeItems({ items, judge: async (request) => ({ votes: request.challenge.items
    .map((item) => vote(item.key, 'not-refuted', 'E1')) }), evidence: 'SYNTHETIC', verifyReceipt,
  supportEvents: () => new Set(['E1']) });
  assert.deepEqual(own.survivors.map((i) => i.key), ['a', 'b']);
  // Without `supportEvents`, not one vote changes.
  const free = await challenge.challengeItems({ items, judge, evidence: 'SYNTHETIC', verifyReceipt });
  assert.deepEqual(free.survivors.map((i) => i.key), ['a', 'b']);
});

// ---- tiers: every claim joins the three-pass run -----------------------------------------------------------

test('M33 C tiers: in m33-fast and m33-lean every claim is asked three times; everything else once', async () => {
  const claims = [CLAIMS.truth, CLAIMS.plain, CLAIMS.supported];
  const narrative = { ...narrativeOf(claims), decisions: [{ dimension: 'SYNTHETIC_C_DIMENSION', chosen: 'Run the lint', value: null,
    valueReceipt: null, actions: ['A5'], stated: null, constrainedBy: null }],
  // D71 (S2): a checklist status with the evidence it needs (a not-done row's shortfall: the failing unit run).
  requirements: [{ text: 'Make the suites pass.', instruction: receipt('I1', 'instruction', TEXT.ask), status: 'not-done',
    shortfall: receipt('A4-r', 'observation', TEXT.unitOut) }] };
  for (const speedProfile of ['m33-fast', 'm33-lean']) {
    const seen = [];
    await reviewRun.runReview({ session: session(), pr: null, reviewScope: 'session-only', speedProfile,
      judge: judgeWith(narrative, { seen }) });
    const calls = seen.filter((r) => r.challenge).map((r) => [r.label, r.challenge.items.map((i) => i.key)]);
    assert.deepEqual(calls, [
      ['challenge:w1:b1:p1', ['claims:0', 'claims:1', 'claims:2']],
      ['challenge:w1:b1:p2', ['claims:0', 'claims:1', 'claims:2']],
      ['challenge:w1:b1:p3', ['claims:0', 'claims:1', 'claims:2']],
      ['challenge:w1:t1:b1:p1', ['decisions:0', 'requirements:0']],
      // M33 C repair: the surviving claim's support, asked on its own, three times, in every profile.
      ['challenge:w1:support:b1:p1', ['claims:2:support']],
      ['challenge:w1:support:b1:p2', ['claims:2:support']],
      ['challenge:w1:support:b1:p3', ['claims:2:support']],
    ], speedProfile);
  }
  // Standard is unchanged: every item three times, in one run — and the support in its own.
  const seen = [];
  await reviewRun.runReview({ session: session(), pr: null, reviewScope: 'session-only', judge: judgeWith(narrative, { seen }) });
  // `sonah.challenge/44`: the decision's vote whose receipt does not check out stands; it is not asked again.
  assert.deepEqual(seen.filter((r) => r.challenge).map((r) => r.label), ['challenge:w1:b1:p1', 'challenge:w1:b1:p2', 'challenge:w1:b1:p3',
    'challenge:w1:support:b1:p1', 'challenge:w1:support:b1:p2', 'challenge:w1:support:b1:p3']);
});

test('M33 C tiers: a plain claim in a tiered profile needs two of three grounded support votes', async () => {
  const onPasses = (passes) => (item, request) => (passes.includes(request.challenge.pass) ? 'not-refuted' : 'uncertain');
  const one = await run([CLAIMS.plain], { verdict: onPasses([1]) }, { speedProfile: 'm33-lean' });
  // S6 (S5 review H1; owner decision D71 b): one vote of three is not enough to settle any claim — it is kept as not
  // checked, with why, never confirmed.
  assert.deepEqual(one.promises.map((p) => [p.status, p.reason]), [['open', 'challenge_unsettled']],
    'one vote of three is not enough for any claim');
  const two = await run([CLAIMS.plain], { verdict: onPasses([1, 3]) }, { speedProfile: 'm33-lean' });
  assert.deepEqual(two.promises.map((p) => p.status), ['open']);
});

// ---- the prompt, the challenge and their versions -----------------------------------------------------------

test('M33 C the narrative prompt defines a claim and asks for supportedBy; one version bump', () => {
  // M33 X moved it once more (carried evidence; only a window with something to carry moved a byte). M33 H repair moved
  // it again (`sonah.narrative/13`): a relay of another agent's report is the passing agent's own claim, so only a
  // restatement of a document or a hand-off brief is not a claim (test/m33-h-helper-internal.test.js).
  // M33 X moved it once more (carried evidence; only a window with something to carry moved a byte).
  // OWNER DECISION B (2026-10-01) moved it once more: per-decision instruction completeness. Only an incomplete
  // window's scope lines (`completeFor`) and an in-turn human instruction's header moved a byte.
  // M33 N moved it once more (`sonah.narrative/14`): a session-only request asks for edits against a human instruction.
  // Status fact moved it once more (`sonah.narrative/15`): a "status:" line under an uncovered result, three task lines.
  // H3 moved it once more (`sonah.narrative/16`): a hedged outcome statement is a claim.
  // M33 brittleness M3 moved it once more (`sonah.narrative/15`): a removal or a deletion is a forbidden edit too.
  // M33 integration moved it once more (`sonah.narrative/17`): one version above every branch's own (C-05 integration).
  // The M33 labels merge moved it once more (`sonah.narrative/18`): the slice-time marker headers.
  // Stable event ids moved it once more (`sonah.narrative/19`): every recorded event's id (C-01 event identity).
  // The D64 wording moved it once more (`sonah.narrative/20`): the proposer's two disclosure sentences.
  // M35 windowing moved it once more (`sonah.narrative/21`): windows, carried context, trims, aliases (C-07).
  // M36 phase 1 moved it once more (`sonah.narrative/22`): the evidence it carries (D68; RECORDED_FACTS_VERSIONS).
  // M36 phase 2 moved it once more (`sonah.narrative/23`): the window format (D68; FORMAT_VERSIONS).
  // M36 phase 3 moved it once more (`sonah.narrative/24`): packed windows, carried failures, the evidence re-ask (D68 K, Q, F; CONVERSATION_VERSIONS).
  // D69 moved it once more (`sonah.narrative/25`): the net view's declines reverted, the harness home folders, the recorder's cwd (D69_VERSIONS).
  // The D69 review moved it once more (`sonah.narrative/26`): a combined request's omission lines offer no request (F2), the ledger moved (typed withholding, paths as recorded) (D69_REVIEW_VERSIONS).
  // D71 (S2) moved it once more (sonah.narrative/27), and D71 (S3) once more (sonah.narrative/28): the new channels (D71_CHANNELS_VERSIONS).
  // S6 moved it once more (sonah.narrative/29): the output-no-status words (D71_FIX_VERSIONS).
  // The D80 integration moved it once more (sonah.narrative/31): a stopped call's outcome line (D80_VERSIONS).
  // The asks fixes moved it once more (sonah.narrative/33): S3's re-ask of a refuted requirement.
  // W1 A moved it once more (sonah.narrative/34): the re-ask of a decision refuted on who decided it.
  // The release review moved it once more (sonah.narrative/35): a project instruction file the session wrote
  // is left out of the window's project files. The second release review moved it once more
  // (sonah.narrative/36): that file's path is compared under the working directory. G2 moved it once more
  // (sonah.narrative/37): the re-ask of a choice not to act whose existence check refuted its words.
  assert.equal(prompt.PROMPT_VERSION, 'sonah.narrative/37');
  // M35 windowing moved it once more (`sonah.narrative/21`): windows, carried context, trims, aliases (C-07).
  // M36 phase 1 moved it once more (`sonah.narrative/22`): the evidence it carries (D68; RECORDED_FACTS_VERSIONS).
  // M36 phase 2 moved it once more (`sonah.narrative/23`): the window format (D68; FORMAT_VERSIONS).
  // M36 phase 3 moved it once more (`sonah.narrative/24`): packed windows, carried failures, the evidence re-ask (D68 K, Q, F; CONVERSATION_VERSIONS).
  // D69 moved it once more (`sonah.narrative/25`): the net view's declines reverted, the harness home folders, the recorder's cwd (D69_VERSIONS).
  // The D69 review moved it once more (`sonah.narrative/26`): a combined request's omission lines offer no request (F2), the ledger moved (typed withholding, paths as recorded) (D69_REVIEW_VERSIONS).
  // D71 (S2) moved it once more (sonah.narrative/27), and D71 (S3) once more (sonah.narrative/28): the new channels (D71_CHANNELS_VERSIONS).
  // S6 moved it once more (sonah.narrative/29): the output-no-status words (D71_FIX_VERSIONS).
  // The D80 integration moved it once more (sonah.narrative/31): a stopped call's outcome line (D80_VERSIONS).
  // The asks fixes moved it once more (sonah.narrative/33): S3's re-ask of a refuted requirement.
  // W1 A moved it once more (sonah.narrative/34): the re-ask of a decision refuted on who decided it.
  // The release review moved it once more (sonah.narrative/35): a project instruction file the session wrote
  // is left out of the window's project files. The second release review moved it once more
  // (sonah.narrative/36): that file's path is compared under the working directory. G2 moved it once more
  // (sonah.narrative/37): the re-ask of a choice not to act whose existence check refuted its words.
  assert.equal(reviewRun.runProfile('session-only').promptVersion, 'sonah.narrative/37');
  const base = session();
  const built = prompt.buildNarrativePrompt({ session: base, window: { index: 0, events: base.events } });
  const task = built.prompt.replace(built.evidencePrompt, '').replace(/\s+/g, ' ');
  // H3: every statement about the current state or the outcome of the work is a claim, a hedged one included; only an
  // action not taken yet, a question or a restatement of a document or a hand-off brief is not; no example phrasings.
  assert.match(task, /every statement the agent makes about the current state or the outcome of its work/);
  assert.match(task, /report a hedged statement as a claim and keep the hedge in the quote/);
  assert.match(task, /Only an action the agent has not taken yet, a question, or a restatement of what a document or a hand-off brief says is NOT a claim/);
  assert.doesNotMatch(task, /a prediction, a conditional|IS true or WAS done|I'll run the tests/);
  assert.match(task, /supportedBy/);
  assert.ok(!built.evidencePrompt.includes('supportedBy'), 'guidance is task text, never evidence');
  const claims = prompt.NARRATIVE_SCHEMA.properties.claims.items;
  assert.deepEqual(claims.properties.supportedBy.type, ['object', 'null']);
  assert.equal(claims.properties.supportedBy.properties.role.const, 'observation');
  assert.ok(!claims.required.includes('supportedBy'), 'optional: an answer without it reads as before');
  assert.equal(prompt.NARRATIVE_SCHEMA.additionalProperties, false, 'the closed top level stays closed');
  assert.deepEqual(Object.keys(prompt.NARRATIVE_SCHEMA.properties), ['decisions', 'pivots', 'claims', 'requirements', 'writtenClaims']);
  // The combined route's instrument is not moved: it does not ask for supportedBy, and its schema does not admit it.
  // M33 brittleness M4 moved it (`sonah.code-review/14`): a session finding's disclosure is its own proposition.
  // M33 integration moved it once more (`sonah.code-review/15`): one version above M33 forbidden-edit repair's /14.
  // Stable event ids moved it once more (`sonah.code-review/16`): every recorded event's id (C-01 event identity).
  // The D64 wording moved it once more (`sonah.code-review/17`): the joint task's disclosure sentence.
  // M35 windowing moved it once more (`sonah.code-review/18`): the narrative evidence it embeds.
  // M36 phase 1 moved it once more (`sonah.code-review/19`): the evidence it carries (D68; RECORDED_FACTS_VERSIONS).
  // M36 phase 2 moved it once more (`sonah.code-review/20`): the window format (D68; FORMAT_VERSIONS).
  // M36 phase 3 moved it once more (`sonah.code-review/21`): packed windows, carried failures, the evidence re-ask (D68 K, Q, F; CONVERSATION_VERSIONS).
  // D69 moved it once more (`sonah.code-review/22`): the net view's declines reverted, the harness home folders, the recorder's cwd (D69_VERSIONS).
  // The D69 review moved it once more (`sonah.code-review/23`): the narrative evidence a joint request embeds moved as the narrative's (D69_REVIEW_VERSIONS).
  // D71 (S2) moved it once more (sonah.code-review/24): the reviewer brief as the checklist (D71_BRIEF_VERSIONS).
  assert.equal(codeReviewPrompt.CODE_REVIEW_VERSION, 'sonah.code-review/24');
  assert.ok(!Object.hasOwn(codeReviewPrompt.CODE_REVIEW_SCHEMA.properties.claims.items.properties, 'supportedBy'));
});

test('M33 C the challenger is told explicit criteria for claims and supports; one version bump', () => {
  // M33 C2 moved it once more (`sonah.challenge/9`: the verbatim quote decides); the shared system prompt did not move.
  // M33 H repair moved it again (`sonah.challenge/10`): the system prompt says a relay is the passing agent's own claim.
  // M33 N moved it once more (`sonah.challenge/11`): a forbidden-edit item and its note; no earlier request byte moved.
  // Status fact moved it once more (`sonah.challenge/12`): one system sentence; a vote must quote an uncovered result.
  // H3 moved it once more (`sonah.challenge/13`): a hedged outcome statement is a claim.
  // M33 brittleness M3 moved it once more (`sonah.challenge/12`): a forbidden-edit item names its breach; no other batch moved.
  // M33 brittleness M4 moved it once more (`sonah.challenge/13`): a disclosure item and its note; no other batch moved.
  // M33 brittleness M4's session route moved it once more (`sonah.challenge/14`): a forbidden-edit item no longer
  // shows the agent's statement, which is asked as a disclosure item; no other batch moved.
  // M33 integration moved it once more (`sonah.challenge/15`): one version above every branch's own (C-05 integration).
  // The disclosure narrowing moved it once more (`sonah.challenge/16`): a disclosure item's proposition and note only.
  // Stable event ids moved it once more (`sonah.challenge/17`): every recorded event's id (C-01 event identity).
  // M35 windowing moved it once more (`sonah.challenge/18`): every evidence byte and a session-only candidate's aliases.
  // M36 phase 1 moved it once more (`sonah.challenge/19`): the evidence it carries (D68; RECORDED_FACTS_VERSIONS).
  // M36 phase 2 moved it once more (`sonah.challenge/20`): the window format (D68; FORMAT_VERSIONS).
  // M36 phase 3 moved it once more (`sonah.challenge/21`): packed windows, carried failures, the evidence re-ask (D68 K, Q, F; CONVERSATION_VERSIONS).
  // D69 moved it once more (`sonah.challenge/22`): the net view's declines reverted, the harness home folders, the recorder's cwd (D69_VERSIONS).
  // The D69 review moved it once more (`sonah.challenge/23`): the evidence a challenge shows moved as the narrative's (D69_REVIEW_VERSIONS).
  // D71 (S2) moved it once more (sonah.challenge/24), and D71 (S3) once more (sonah.challenge/25): the new channels (D71_CHANNELS_VERSIONS).
  // The column fix moved it once more (sonah.challenge/30): who decided a decision (FIX_COLUMN_VERSIONS).
  // W1 B moved it once more (sonah.challenge/31): the file form of the forbidden-edit proposition and its note.
  // W2 moved it once more (sonah.challenge/32): CLAIM_NOTE judges the agent's own written text like a result.
  // W3 F1(b) moved it once more (sonah.challenge/33): a support with changes since its run is asked, listed.
  // W3 F2 moved it once more (sonah.challenge/34): a support whose result failed is asked, judged on its outcome.
  // The fix review moved it (sonah.challenge/35 to /37): stopped results, a file rule's lifts, the existence check.
  // D87 moved it once more (sonah.challenge/38, its /35 renumbered at the merge): the code pass's own run; no other
  // request byte moved.
  // The code step moved it once more (sonah.challenge/39): the code pass's run left challengeItems for a runner of its
  // own, verdict first; no other request byte moved.
  // The review of the code step moved it once more (sonah.challenge/40): no `duplicate` refutation, and a
  // finding's checker sees no agent words; no other request byte moved.
  // The second review of the code step moved it once more (sonah.challenge/41): a code check's checker sees no word
  // of the agent's in any row; no other request byte moved.
  // The third review of the code step moved it once more (sonah.challenge/42): a code check's checker sees
  // what its row states again; no other request byte moved.
  // The re-ask of a void vote moved it once more (sonah.challenge/43): a vote a reply cast that could not be
  // counted is asked again once, naming its cause; no first-round request byte moved.
  // Its withdrawal moved it once more (sonah.challenge/44): a vote a reply cast that could not be counted stands
  // again, as before /43; no first-round request byte moved.
  assert.equal(challenge.CHALLENGE_PROFILE.version, 'sonah.challenge/44');
  const system = challenge.challengeSystem().replace(/\s+/g, ' ');
  // H3: a hedged statement is judged as said; a contradiction is refuted when the words assert nothing about the work.
  for (const phrase of [/Read the whole AGENT SAID event/, /hedged or not: judge the quoted words as said, hedge included/,
    /An action the agent has not taken yet, a question/, /assert nothing about the state or the outcome of the work/,
    /already disclosed the failure/, /different subject/, /later change of plan/,
    /false at the time it was claimed/, /A support candidate names a claim/,
    /shows exactly what was claimed/, /cite the result that candidate cites/])
    assert.match(system, phrase);
  assert.doesNotMatch(system, /plan, intention, prediction, conditional|plan, intention or conditional|completed state/);
});

// ---- request bytes: what moves and what does not -------------------------------------------------------------

const sha = (text) => createHash('sha256').update(text, 'utf8').digest('hex');
/** The evidence and system prompts of the standard fixture cases, as the code before this change built them
 *  (captured once on 23afc8a): the narrative prompt changed only in its task text. */
const BEFORE = Object.freeze({
  large: { evidence: '339b57c8a3e0d725c294eb3ee22f17cbe555635dc6e3f1e61d1ad319c0c788fb',
    system: 'a8b0bc3f9fb277ab5552aa1bd20f0979b3358883d2bec1126f3f1a4bb6c3fb65',
    prompts: 'e5afa4d3b4feab16c47986508748865d4e6eefd8fbbc25443c35ae285acca7fd' },
  turn: { evidence: 'a9b17f1cf29e6263c8441289fe4c43a024bc41756244b4cbf426578be8462672',
    system: '6e019c01bc70203c0f9eefa5b1d720d2385a365d2047472fe66096942329949c',
    prompts: 'f15db088375c95327741d8b37815aad3bfaf7d5d79ee95740332e82a51733f4c' },
});

/**
 * MOVED_BY_WINDOWING (M35, owner-confirmed spec 2026-10-06; C-07 "M35 windowing"): every evidence byte of these cases
 * moved — a window is whole segments of one session (no compaction or byte-budget split), the carry is gone and a later
 * window opens with its carried context (earlier human messages and thoughts), actions and results are trimmed to 2k
 * tokens, and every event is named by its window's alias — so the render-back to 23afc8a above no longer applies. The
 * system prompt did not move. `BEFORE` stays as the pin these replace.
 */
const MOVED_BY_WINDOWING = Object.freeze({
  large: { evidence: 'a24e014ee8ee35910cf7304d34b0bcb447426151e99590bc1f7605d0a6c96cb7',
    prompts: 'aca1cd4602a03cec3183ec74e42e226b31319aa3766c26b9b9d52a513973ba42' },
  turn: { evidence: '231c8b465de02815c519a41e0af9076ccfe5305a914237768c4ff484bd413f5b',
    prompts: '9f928099246dfd395d17d7c5f1697827f8181de13d6bfc5b6fc350631eecab26' },
});

/**
 * MOVED_BY_M36_FORMAT (M36 phase 2, the window format; D68 L, T; C-07 "M36 window format"): every RESULT opens
 * with its label line (`recorded: …`) — the only bytes "turn" moved (rendered back, `beforeM36Labels`, it is
 * MOVED_BY_WINDOWING's) — and "large"'s results, over the trim, are cut on whole lines with their omitted lines named,
 * so its render-back no longer applies. The system prompt did not move.
 */
const MOVED_BY_M36_FORMAT = Object.freeze({
  large: { evidence: 'bb007551f36a2f53e6ca6f5c214f8aeb964fd251e3764bc9ad0639aa67e15454',
    prompts: '7dfae3ce6fa316b4b945b9c9c6d8312a29f289f86be1e436063decbdd2d98f85' },
  turn: { evidence: '370925c6310d41ca84bb98a2c46d7cbbd5efa8a30aa5bef497fe25f0e9fb656c',
    prompts: 'd8069570fd8a8801fb00e79a5229d4bbf9d081985d8d79c6d32fba5b9d0a2423' },
});

/**
 * MOVED_BY_M36_CONVERSATION (M36 phase 3; D68 K, Q, F; C-07 "M36 packed windows", "M36 evidence re-ask"): each
 * case's prompts moved by item 1's actor sentence and the session-only contract's `evidenceRequests` member and rules
 * alone — rendered back (`beforeM36Conversation`) they are MOVED_BY_M36_FORMAT's. No evidence byte moved (one session,
 * no proven failure carried).
 */
const MOVED_BY_M36_CONVERSATION = Object.freeze({
  large: { prompts: '17b7e371e7e684facc10f2f9a8036f156846aaf5a76f0a1398053aa14018e814' },
  turn: { prompts: '87de249b07350e079c2f692ced23ce92f4841c8ac8afcc83c53dd228d9535c1f' },
});

/** D71 (S2, the reviewer brief as the checklist): every case's narrative requests — the window in the checklist's reading
 *  order, each RESULT's typed outcome, numbered agent messages — its challengers' evidence (the human block first, no
 *  offer to request evidence) and its system prompt (the brief, every window alike). Nothing renders them back to M36
 *  phase 3's (MOVED_BY_M36_CONVERSATION, MOVED_BY_M36_FORMAT and the 23afc8a system, kept as the pins these replace). */
const MOVED_BY_D71_BRIEF = Object.freeze({ system: '2350a04d4edb1bce067ee092f5f7c92c5884138c7608a4ea3441ee79fac46c54', turn: { evidence: '372dfba2a28324483a8f8ce5f7055838854975543a4c968c80946908958d849b', prompts: 'd3971c98768fc19f10467b682a49c3e161e5676f43bc81dfc2aa5d79ecdfb7c7' },
  large: { evidence: '76b740913b06aefa821d96918cceb01d67e31bdd4813f13e2a96a3722c7a18e4', prompts: 'd25901cbd0f9b85e4a35db03e4f857763eb9e5e3cf3536b58d6c50e767c522b6' } });

/** D71 (S3, the new channels): every case's narrative requests (the RESULTs step 4 answers for, the brief's last step now
 *  step 6) and the brief moved; their challengers' evidence did not (no case records a project instruction file). */
const MOVED_BY_D71_CHANNELS = Object.freeze({ system: '3bb2bc957a2d9d1491fc7ef0f29670c2af0d0750b8b5d72bc98de9e6ac63baac',
  turn: { prompts: '7054e51d86252769f14edb958be74db3c10e04f546ba2c03a9823605d083615e' },
  large: { prompts: 'e2f2f50dcbdf4e3e0cdb35109d13ce9dd3e58a10b5bd3f5e432c34e165a8db5a' } });
/** S6 (the fixes of the S5 review): the brief moved (M5, L7: `sonah.session-review-agent/5`), so the system prompt; no
 *  case shows a RESULT of class output-no-status (L5), so no case's prompts moved. */
const MOVED_BY_D71_FIX = Object.freeze({ system: '4648b4574aae7f9a4495bb51de2f1f9aa520531bcf1587df34411d57b0c532ef' });

/** S7: the brief moved (restsOn and step 4 name did not run, failed or no terminal
 *  status only: `sonah.session-review-agent/6`), so the system prompt, and every case's prompts by the failures line's
 *  words alone: rendered back (`textBeforeS7`), S6's and S3's above, byte for byte. */
const MOVED_BY_S7 = Object.freeze({ system: '06b3bc0bbd70e8209cd36841f9d675694a564e88e42fe5cdd460aa14f5b9a746', turn: { prompts: '66626790f9eee2df98a87fec306509487e469fa84ad830d91232437cc3e6c871' }, large: { prompts: '759b52b45d788419ef7a03b791c45006859a2ddfb7b365c0841b8d266edc74f9' } });

/** The column fix (owner decisions D83 (2) and D84): the brief moved (who decided a decision, and, D84, that
 *  "made without asking you" checks the shown project instruction files too, and on 2026-10-13, that
 *  "you settled it" is words that state the choice's own answer, and at the settled-words gain, that such a choice is
 *  reported settled at the level the words address: `sonah.session-review-agent/8`), so the system prompt: rendered
 *  back (`textBeforeFixColumn`), S7's above, byte for byte. No case's prompts moved (a session-only window's bytes are
 *  S7's). */
const MOVED_BY_FIX_COLUMN = Object.freeze({
  system: '1382ab5b5bf01a8065eecf4d28472845a3857c5c8439f8e4df0a0717965ed761' });
/** The asks fixes (P1): the brief moved once more (step 1: a run the human asked for, refused at every attempt, is
 *  not-done: `sonah.session-review-agent/9`), so the system prompt: rendered back (`textBeforeAsksFixes`),
 *  fix-column's above, byte for byte. No case's prompts moved. */
const MOVED_BY_ASKS_FIXES = Object.freeze({
  system: '75d1c85d4bf14a4688528dbad49d9779308e35d7a7f6011eb27d64dc2fccdb09' });
/** W1 B: the brief moved once more (step 3: words an answer goes against never settle the choice; step 5 and its
 *  contract: an edit may go against a project instruction file: `sonah.session-review-agent/10`), so the system prompt:
 *  rendered back (`textBeforeW1`), the asks fixes' above, byte for byte. No case's prompts moved. */
const MOVED_BY_W1 = Object.freeze({
  system: '31d337abef9f96a0a7ac6665fd6ca681a8a0937a9155bad3bd6f835ea94e6c34' });
/** W2 (3): the brief moved once more (step 2: compare a claim with the evidence before giving its basis, the agent's own
 *  written text as a contradiction, never a run-time claim contradicted by reading code; step 5 likewise for a written
 *  statement: `sonah.session-review-agent/11`), so the system prompt: rendered back (`textBeforeW2`), W1's above, byte for
 *  byte. No case's prompts moved. */
const MOVED_BY_W2 = Object.freeze({
  system: 'f70fdc791ae3559182c550229fb19a455ee2ee01e5527f6471e59852cb324f59' });

test('M33 C, M35, D71 request bytes: the brief is every window\'s system prompt; the evidence and prompts are pinned by MOVED_BY_D71_BRIEF', () => {
  for (const { name, session: build } of CASES.filter((c) => Object.hasOwn(BEFORE, c.name))) {
    const session = build();
    const plan = reviewRun.planWindowRequests({ session, reviewScope: 'session-only' });
    const requests = plan.requests.map((b) => b.request);
    assert.equal(sha(requests.map((r) => r.evidencePrompt).join('\n')), MOVED_BY_D71_BRIEF[name].evidence, `${name}: evidence`);
    assert.notEqual(MOVED_BY_D71_BRIEF[name].evidence, MOVED_BY_M36_FORMAT[name].evidence);
    assert.equal(sha(requests.map((r) => r.system).join('\n')), name === 'turn' ? MOVED_BY_W2.system
      : sha(requests.map(() => requests[0].system).join('\n')), `${name}: system, every window alike`);
    if (name === 'turn')
      assert.equal(sha(requests.map((r) => textBeforeW2(r.system)).join('\n')), MOVED_BY_W1.system);
    assert.notEqual(MOVED_BY_W2.system, MOVED_BY_W1.system);
    if (name === 'turn')
      assert.equal(sha(requests.map((r) => textBeforeW1(r.system)).join('\n')), MOVED_BY_ASKS_FIXES.system);
    assert.notEqual(MOVED_BY_W1.system, MOVED_BY_ASKS_FIXES.system);
    if (name === 'turn')
      assert.equal(sha(requests.map((r) => textBeforeAsksFixes(r.system)).join('\n')), MOVED_BY_FIX_COLUMN.system);
    assert.notEqual(MOVED_BY_ASKS_FIXES.system, MOVED_BY_FIX_COLUMN.system);
    if (name === 'turn')
      assert.equal(sha(requests.map((r) => textBeforeFixColumn(r.system)).join('\n')), MOVED_BY_S7.system);
    assert.notEqual(MOVED_BY_FIX_COLUMN.system, MOVED_BY_S7.system);
    if (name === 'turn') assert.equal(sha(requests.map((r) => textBeforeS7(r.system)).join('\n')), MOVED_BY_D71_FIX.system);
    assert.notEqual(MOVED_BY_D71_BRIEF.system, BEFORE.turn.system);
    assert.notEqual(MOVED_BY_D71_CHANNELS.system, MOVED_BY_D71_BRIEF.system);
    assert.notEqual(MOVED_BY_D71_FIX.system, MOVED_BY_D71_CHANNELS.system);
    // The column fix moved no case's prompts (a session-only window's bytes are S7's).
    assert.equal(sha(requests.map((r) => r.prompt).join('\n')), MOVED_BY_S7[name].prompts, `${name}: prompts`);
    assert.equal(sha(requests.map((r) => textBeforeS7(r.prompt)).join('\n')), MOVED_BY_D71_CHANNELS[name].prompts, `${name}: back`);
    assert.notEqual(MOVED_BY_D71_CHANNELS[name].prompts, MOVED_BY_D71_BRIEF[name].prompts);
    // The lean profile's narrative requests are the standard ones, byte for byte, still.
    const lean = reviewRun.planWindowRequests({ session: build(), reviewScope: 'session-only', speedProfile: 'm33-lean' });
    assert.deepEqual(lean.requests.map((b) => b.request.prompt), requests.map((r) => r.prompt), `${name}: lean = standard`);
  }
});

// ---- closed vocabularies and the pure checks ------------------------------------------------------------------

test('M33 C the closed vocabularies: promise statuses, support rejections, vote causes — frozen, bare tokens', () => {
  for (const list of [ledger.PROMISE_STATUSES, ledger.SUPPORT_REJECTIONS, challenge.VOTE_REJECTION_CAUSES]) assert.ok(Object.isFrozen(list));
  for (const token of [...ledger.PROMISE_STATUSES, ...ledger.SUPPORT_REJECTIONS, ...challenge.VOTE_REJECTION_CAUSES])
    assert.match(token, /^[a-z][a-z_]*$/);
  // M33 C recheck 2: the withheld causes, the intention markers and the failure words are gone with the code rules
  // that read them (claims.js); the challengers' criteria judge what they approximated.
  for (const gone of ['CLAIM_WITHHELD_CAUSES', 'CLAIM_INTENTION_MARKERS', 'DISCLOSED_FAILURE_WORDS', 'DISCLOSURE_NEGATIONS',
    'DISCLOSURE_REMEDIES', 'DISCLOSURE_PAST', 'DISCLOSURE_CLAUSE_BREAKS', 'DISCLOSURE_ECHO_MIN_CHARS'])
    assert.ok(!Object.hasOwn(ledger, gone), gone);
  for (const gone of ['claimWithheldCause', 'statesIntention', 'disclosesFailure']) assert.ok(!Object.hasOwn(claimsModule, gone), gone);
});

test('M33 C a claim of no errors made after a failing run is a true contradiction, never "disclosed"', async () => {
  const base = session();
  const events = base.events.map((event) => (event.id === 'C4' ? { ...event, text: [{ sourceKey: 'noErrors', fromByte: 0,
    untilByte: Buffer.byteLength(NO_ERRORS, 'utf8') }] } : event));
  const changed = new Session({ sessionKey: SESSION_KEY, adapter: 'claude', blobs: { ...TEXT, noErrors: NO_ERRORS }, events,
    children: base.children });
  const report = await run([{ ...CLAIMS.truth, stated: receipt('C4', 'commentary', 'all unit tests pass, no failures remain.') }],
    {}, { base: changed });
  assert.deepEqual(statuses(report), ['DECIDE']);
  assert.deepEqual(claimCauses(report), []);
});
const NO_ERRORS = 'SYNTHETIC_C_NO_ERRORS: all unit tests pass, no failures remain.';

// ---- rendering: plain words, never "open" -------------------------------------------------------------------

test('M33 C a claim is confirmed by a recorded result or not checked, never open, and code withholds none by cause', async () => {
  const report = await run([CLAIMS.supported, CLAIMS.plain, CLAIMS.disclosed, CLAIMS.intention], { verdict: refuteNotClaims });
  // D88: the confirmed claim is listed with the claims; the one not checked is folded (the row kinds every reader reads).
  assert.deepEqual(review.listedPromises(report).map((p) => [p.text, p.status, review.claimRowKind(p)]),
    [['The agent said the lint is clean.', 'verified', null], ['The agent said the notes file is written.', 'open', 'claimsOpen']]);
  // M33 C recheck 2: the challengers refuted the disclosed and the intended statements; no claim is withheld by code.
  assert.deepEqual(Object.entries(report.withheld?.causes ?? {}).filter(([, n]) => n > 0), []);
});

test('M33 C, D97 the report .md says the same words for claims: checked, or not checked, never open', async () => {
  const report = await run([CLAIMS.supported, CLAIMS.plain, CLAIMS.disclosed, CLAIMS.intention], { verdict: refuteNotClaims });
  const story = renderReportMarkdown(session(), report);
  const claims = story.slice(story.indexOf('#### Claims'), story.indexOf('#### What the agent said it did not do'));
  assert.ok(claims.length > 0 && !/\bopen\b/i.test(claims), 'never "open"');
  // The confirmed claim reads "checked", with the recorded result it was checked against; the other "not checked".
  assert.equal(claims.split('\n- checked “').length - 1, 1, claims);
  assert.equal(claims.split('\n- not checked “').length - 1, 1, claims);
  assert.match(claims, /- checked “[^\n]*· A recorded result shows: “/);
  // M33 C recheck 2: code withholds no claim, so the report counts none as "not listed as claims".
  assert.ok(!/not listed as (a )?claims?/.test(story));
});

// ---- the combined route ------------------------------------------------------------------------------------

test('M33 C the combined route puts a statement of intention to the challengers, who refute it; no cause is withheld', async () => {
  const blobs = { ask: 'SYNTHETIC_C_JOINT_ASK: write the module.', body: 'export const SYNTHETIC_C_JOINT = 1;\n',
    out: 'SYNTHETIC_C_JOINT_OUT: File created successfully',
    said: "SYNTHETIC_C_JOINT_SAID: the module is written. I'll add the tests next." };
  const ref = (key) => [{ sourceKey: key, fromByte: 0, untilByte: Buffer.byteLength(blobs[key], 'utf8') }];
  const INDEX = 'src/index.js';
  const joint = new Session({ sessionKey: 'joint', adapter: 'claude', blobs, events: [
    { id: 'I1', kind: 'instruction', authority: 'human', supersedes: [], text: ref('ask') },
    { id: 'A1', kind: 'invocation', callKey: 'A1', tool: 'Write', operation: 'write', paths: [{ path: INDEX }], command: [],
      input: [], changes: [{ path: INDEX, before: [], after: ref('body'), diff: [] }] },
    { id: 'O1', kind: 'observation', phase: 'terminal', invocation: 'A1', callKey: 'A1', result: 'succeeded', exitCode: null,
      terminalStatusProven: true, sourceOfResult: 'native', output: ref('out') },
    { id: 'C1', kind: 'commentary', phase: 'final', beforeInvocation: null, text: ref('said') },
  ].map((event, sequence) => ({ ...event, sequence })) });
  const diff = ['diff --git a/src/index.js b/src/index.js', 'new file mode 100644', '--- /dev/null',
    '+++ b/src/index.js', '@@ -0,0 +1,1 @@', '+export const SYNTHETIC_C_JOINT = 1;', ''].join('\n');
  const pr = { repo: { host: 'github.com', id: '405' }, number: 405, baseOid: 'b'.repeat(40), diffBaseOid: 'b'.repeat(40),
    headOid: 'a'.repeat(40), gitAlgorithm: 'sha1', enumeration: 'complete',
    files: [{ path: INDEX, change: 'added', contentState: 'complete' }] };
  const base = { decisions: [], pivots: [], claims: [], requirements: [], codeFindings: [], sessionFindings: [] };
  const claims = [{ text: 'The agent said the module is written.', stated: receipt('C1', 'commentary', 'the module is written.'),
    contradictedBy: null }, { text: 'The agent said it adds the tests.', stated: receipt('C1', 'commentary', "I'll add the tests next."),
    contradictedBy: null }];
  const { runCodeReview } = await import('../src/code-review.js');
  // M33 C recheck 2: the challengers' criterion — a plan or an intention is not a claim — as a synthetic verdict.
  const intended = (candidate) => /^I'll /.test(candidate?.stated?.quote ?? '');
  const report = await runCodeReview({ session: joint, pr, diff, judge: async (request) => {
    if (request.challenge) return { votes: request.challenge.items.map(({ key, candidate }) => ({ key,
      verdict: intended(candidate) ? 'refuted' : 'not-refuted',
      explanation: 'Recorded.', receipts: [candidate.stated ?? receipt('O1', 'observation', blobs.out)] })) };
    if (/^code\+chunk:/.test(request.label ?? '')) return { ...base, reviewedFiles: [INDEX] };
    return { ...base, reviewedFiles: /^code\+narrative:/.test(request.label ?? '') ? [INDEX] : [], claims };
  } });
  assert.deepEqual(report.promises.map((p) => [p.stated.quote, p.status]), [['the module is written.', 'open']]);
  assert.deepEqual(claimCauses(report), [], 'no claim is withheld by code on the combined route either');
  assert.equal(report.challenge.refutedItems, 1, 'the intention was asked and refuted');
});

// ---- a Claude Code recording, end to end ------------------------------------------------------------------

test('M33 C a synthetic Claude Code recording: sliced, redacted, adapted and reviewed with the new rules', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'sonah-c-claims-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const file = join(dir, 'synthetic.jsonl');
  let n = 0;
  const base = () => ({ uuid: `u${++n}`, parentUuid: n > 1 ? `u${n - 1}` : null, sessionId: 'synthetic-c-claims',
    cwd: '/srv/x', timestamp: `2026-10-01T10:00:${String(n).padStart(2, '0')}Z`, version: '2.0.0', isSidechain: false });
  const user = (content) => ({ ...base(), type: 'user', message: { role: 'user', content } });
  const asst = (content) => ({ ...base(), type: 'assistant', message: { role: 'assistant', content } });
  const text = (value) => ({ type: 'text', text: value });
  const bash = (id, cmd) => ({ type: 'tool_use', id, name: 'Bash', input: { command: cmd } });
  const out = (id, value, isError = false) => ({ type: 'tool_result', tool_use_id: id, content: value, is_error: isError });
  const rows = [
    user(TEXT.ask),
    asst([bash('t1', TEXT.load)]), user([out('t1', TEXT.loadOut, true)]),
    asst([text(TEXT.disclosed)]),
    asst([text(TEXT.conditional), bash('t2', TEXT.plan)]), user([out('t2', TEXT.planOut)]),
    asst([text(TEXT.intention), bash('t3', TEXT.checks)]), user([out('t3', TEXT.checksOut, true)]),
    asst([bash('t4', TEXT.unit)]), user([out('t4', TEXT.unitOut, true)]),
    asst([text(TEXT.claimTrue)]),
    asst([text(TEXT.lintSaid), bash('t5', TEXT.lint)]), user([out('t5', TEXT.lintOut)]),
    asst([text(TEXT.plain)]),
  ];
  await writeFile(file, rows.map((row) => JSON.stringify(row)).join('\n') + '\n');
  const adapted = sessionFromLedger(redact(await sliceLineage([file])).ledger, { sessionKey: 'synthetic-c-claims' });
  const having = (marker, kind) => adapted.events.find((event) => event.kind === kind
    && adapted.sourcesFor(event).some((source) => source.text.includes(marker)));
  const id = (marker, kind) => {
    const event = having(marker, kind);
    assert.ok(event, `premise: ${marker} was recorded as ${kind}`);
    return event.id;
  };
  const claims = [
    { ...CLAIMS.disclosed, stated: { ...CLAIMS.disclosed.stated, eventId: id('SYNTHETIC_C_DISCLOSED', 'commentary') },
      contradictedBy: { ...CLAIMS.disclosed.contradictedBy, eventId: id('SYNTHETIC_C_LOAD', 'observation') } },
    { ...CLAIMS.conditional, stated: { ...CLAIMS.conditional.stated, eventId: id('SYNTHETIC_C_CONDITIONAL', 'commentary') },
      contradictedBy: { ...CLAIMS.conditional.contradictedBy, eventId: id('SYNTHETIC_C_PLAN', 'observation') } },
    { ...CLAIMS.intention, stated: { ...CLAIMS.intention.stated, eventId: id('SYNTHETIC_C_INTENTION', 'commentary') },
      contradictedBy: { ...CLAIMS.intention.contradictedBy, eventId: id('SYNTHETIC_C_CHECKS', 'observation') } },
    { ...CLAIMS.truth, stated: { ...CLAIMS.truth.stated, eventId: id('SYNTHETIC_C_TRUE', 'commentary') },
      contradictedBy: { ...CLAIMS.truth.contradictedBy, eventId: id('SYNTHETIC_C_UNIT', 'observation') } },
    { ...CLAIMS.supported, stated: { ...CLAIMS.supported.stated, eventId: id('SYNTHETIC_C_LINT_SAID', 'commentary') },
      supportedBy: { ...CLAIMS.supported.supportedBy, eventId: id('SYNTHETIC_C_LINT:', 'observation') } },
    { ...CLAIMS.plain, stated: { ...CLAIMS.plain.stated, eventId: id('SYNTHETIC_C_PLAIN', 'commentary') } },
  ];
  for (const speedProfile of [undefined, 'm33-lean']) {
    // M33 C recheck 2: the disclosed, conditional and intended statements are refuted by their challenges, none
    // withheld by code.
    const report = await run(claims, { verdict: refuteNotClaims }, { base: adapted, speedProfile });
    const label = speedProfile ?? 'standard';
    assert.deepEqual(statuses(report), ['DECIDE'], `${label}: only the true contradiction`);
    assert.deepEqual(report.promises.map((p) => p.status), ['verified', 'open'], label);
    assert.deepEqual(claimCauses(report), [], label);
    assert.equal(report.challenge.refutedItems, 3, label);
    assert.equal(report.sessionReview, 'complete', label);
  }
});
