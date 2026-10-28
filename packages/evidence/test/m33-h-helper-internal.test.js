// M33 H (C-06 "M33 helper-internal claims", owner decision 2026-10-01). A helper's own statements — its commentary,
// and its report to the parent (a Codex FINAL_ANSWER, a Claude Agent tool result, a Workflow journal result) — are
// not shown to the human; only the parent's statements are. So a `claim_contradicted` finding whose stated receipt is
// an event of a child actor (the recording's `childId`, a recorded fact) publishes FYI with the closed disclosure
// reason `helper_internal`, never DECIDE. The parent's own statement relaying the same claim is its own claim and
// publishes DECIDE by the existing rules (no relay detection: it is simply the parent's statement). A helper-internal
// claim whose challenge did not settle is FYI-bound, so it never holds a part off CLEAN as `decide_unsettled`; it is
// still withheld and counted as unsettled. Promise and claim statuses are unchanged. The rendered report and the
// session story say in plain words that the claim was a helper's internal statement.
//
// M33 H repair (recheck MAJOR and minors): the owner's "unless relayed" needs a relay that names its helper ("The helper
// reports that …") reviewed as the parent's own claim, which `sonah.narrative/12` and `sonah.challenge/9` excluded as
// "what another agent says" — so the narrative prompt and the challengers now say a relay is the passing agent's own
// claim (`sonah.narrative/13`, `sonah.challenge/10`), shown here with a synthetic reviewer and challengers that do what
// the words they are sent say. Whose statement it is, is code's mark on the challenge record, so a report saved without
// its recording reads as the live run did; a statement is a helper's only through a verified child link; the review
// labels the helper's words "helper said"; and (D71 (a)) the story lists every finding under one heading, the helper's
// said as what it is.
//
// Synthetic sessions only — a Claude Code Agent-tool helper built as the adapter emits it, a Claude Code Workflow run
// read through the real loader from a synthetic projects tree, and a Codex helper with an attached FINAL_ANSWER read
// through the ledger adapter. Synthetic judges: no recording, no model call. Nothing prints.
import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { Session } from '../src/session.js';
// Namespace imports, so each test fails on its own against code that predates it.
import * as ledger from '../src/ledger.js';
import * as reviewRun from '../src/run-review.js';
import * as prompt from '../src/prompt.js';
import * as challenge from '../src/challenge.js';
import * as story from '../../render/session-story.js';
import { REPORT_DISCLOSURE_WORDS, REPORT_ITEM_WORDS } from '../../render/report-words.js';
import { runCodeReview } from '../src/code-review.js';
import { sessionFromLedger } from '../adapters/sonah-ledger.js';
import { loadSessionEvidence } from '../../cli/src/session-evidence.js';
import { redact } from '../../redact/index.js';
import { ownReceipt } from '../../cli/test/m33-fast-profile-fixture.js';
import * as W from '../../cli/test/m33-w-workflow-fixture.js';
import { RELAY_RULE_TEXT, beforeRelayRule, requestBeforeRelayRule } from './m33-h-relay-rule-fixture.js';
import { beforeHedgedClaims, requestBeforeHedgedClaims } from './h3-hedged-claims-fixture.js';

const REPO = { host: 'github.com', id: '0' };
const SESSION_KEY = 'sess-h-helper';
const PROFILES = [null, 'm33-fast', 'm33-lean'];

// ---- a Claude Code Agent-tool helper, as the adapter emits it ---------------------------------------------------------

const TEXT = {
  ask: 'SYNTHETIC_HH_ASK: fix the nested parser and make the parser tests pass.',
  plan: 'SYNTHETIC_HH_PLAN: I will hand the parser fix to a helper.',
  brief: 'SYNTHETIC_HH_BRIEF: fix the nested parser and report whether the parser tests pass.',
  test: 'npm test',
  fail: 'SYNTHETIC_HH_FAIL: nested input > keeps nested arrays; 1 failed, 11 passed',
  helperSaid: 'SYNTHETIC_HH_HELPER_SAID: the nested parser tests pass now.',
  pass: 'SYNTHETIC_HH_PASS: 12 passed',
  helperFixed: 'SYNTHETIC_HH_HELPER_FIXED: after the second edit the parser tests pass.',
  report: 'SYNTHETIC_HH_REPORT: fixed the nested parser; all parser tests pass.',
  relay: 'SYNTHETIC_HH_RELAY: the nested parser is fixed and all parser tests pass.',
  // M33 H repair: the parent passing on what its helper reported, naming the helper as its source.
  attributed: 'SYNTHETIC_HH_ATTRIBUTED: The helper reports that the nested parser is fixed and all parser tests pass.',
  lint: 'npm run lint',
  lintFail: 'SYNTHETIC_HH_LINT: 2 errors',
  parentSaid: 'SYNTHETIC_HH_PARENT_SAID: lint is clean.',
};
const whole = (key) => [{ sourceKey: key, fromByte: 0, untilByte: Buffer.byteLength(TEXT[key], 'utf8') }];
const T1 = { turn: 'T1' };
const run = (id, key, over = {}) => ({ id, kind: 'invocation', callKey: id, tool: 'Bash', operation: 'command',
  paths: [], command: whole(key), input: [], changes: [], ...over });
const result = (id, invocation, key, over = {}) => ({ id, kind: 'observation', invocation, callKey: invocation,
  phase: 'terminal', result: 'succeeded', exitCode: 0, terminalStatusProven: true, output: whole(key),
  sourceOfResult: 'native', ...over });
const said = (id, key, over = {}) => ({ id, kind: 'commentary', phase: 'working', beforeInvocation: null,
  text: whole(key), ...over });

/**
 * One turn: the human's ask, the parent's plan, an Agent hand-off to a verified helper `w` whose own test run FAILS,
 * the helper's statement that the tests pass, its closing report, the Agent tool's result (the report as the parent
 * received it), the parent's own statement relaying it, and the parent's own lint run (failing) and statement about it.
 * `corrected` adds the helper's later passing run and its accurate statement, before its report. `childId` overrides
 * the helper's recorded actor on every one of its events. M33 H repair: `relay` names the text of the parent's relay
 * (`attributed`: it names the helper as its source); `link` overrides the hand-off's recorded child link (null: none).
 */
function agentSession({ corrected = false, childId = 'w', relay = 'relay', link = {} } = {}) {
  const H = { childId, ...T1 };
  const events = [
    { id: 'I1', kind: 'instruction', authority: 'human', supersedes: [], text: whole('ask'), ...T1 },
    said('C1', 'plan', T1),
    { id: 'D1', kind: 'invocation', callKey: 'D1', tool: 'Agent', operation: 'delegate', paths: [], command: [],
      input: whole('brief'), changes: [], ...T1 },
    run('child:w:A1', 'test', H), result('child:w:A1-r', 'child:w:A1', 'fail', { ...H, result: 'failed', exitCode: 1 }),
    said('child:w:C1', 'helperSaid', H),
    ...(corrected ? [run('child:w:A2', 'test', H), result('child:w:A2-r', 'child:w:A2', 'pass', H),
      said('child:w:C2', 'helperFixed', H)] : []),
    said('child:w:C3', 'report', { ...H, phase: 'final' }),
    result('D1-r', 'D1', 'report', { ...T1, exitCode: null }),
    said('C2', relay, T1),
    run('A3', 'lint', T1), result('A3-r', 'A3', 'lintFail', { ...T1, result: 'failed', exitCode: 1 }),
    said('C3', 'parentSaid', { ...T1, phase: 'final' }),
  ].map((event, sequence) => ({ ...event, sequence }));
  const children = link === null ? [] : [{ assignmentEvent: 'D1', childId: 'w', childSession: `${SESSION_KEY}/child:w`,
    sessionKey: `${SESSION_KEY}/child:w`, relation: 'spawn', state: 'verified', historyStart: null, ...link }];
  return new Session({ sessionKey: SESSION_KEY, adapter: 'claude', blobs: { ...TEXT }, events, children });
}

const receipt = (eventId, role, quote) => ({ eventId, role, quote });
const R = Object.freeze({
  helperSaid: receipt('child:w:C1', 'commentary', 'the nested parser tests pass now.'),
  report: receipt('child:w:C3', 'commentary', 'fixed the nested parser; all parser tests pass.'),
  fail: receipt('child:w:A1-r', 'observation', TEXT.fail),
  relay: receipt('C2', 'commentary', 'the nested parser is fixed and all parser tests pass.'),
  attributed: receipt('C2', 'commentary', 'The helper reports that the nested parser is fixed and all parser tests pass.'),
  parentSaid: receipt('C3', 'commentary', 'lint is clean.'),
  lintFail: receipt('A3-r', 'observation', TEXT.lintFail),
  // The Agent tool's result is the PARENT's observation of its hand-off: never a statement of anyone's.
  received: receipt('D1-r', 'commentary', 'fixed the nested parser; all parser tests pass.'),
  pass: receipt('child:w:A2-r', 'observation', TEXT.pass),
  helperFixed: receipt('child:w:C2', 'commentary', 'after the second edit the parser tests pass.'),
});
const CLAIMS = Object.freeze({
  helperSaid: { text: 'The helper said the nested parser tests pass.', stated: R.helperSaid, contradictedBy: R.fail },
  report: { text: 'The helper reported that all parser tests pass.', stated: R.report, contradictedBy: R.fail },
  relay: { text: 'The agent said all parser tests pass.', stated: R.relay, contradictedBy: R.fail },
  attributed: { text: 'The agent passed on the helper\'s report that all parser tests pass.', stated: R.attributed,
    contradictedBy: R.fail },
  parentOnly: { text: 'The agent said lint is clean.', stated: R.parentSaid, contradictedBy: R.lintFail },
  received: { text: 'The helper report says all parser tests pass.', stated: R.received, contradictedBy: R.fail },
});

// ---- the synthetic judge -----------------------------------------------------------------------------------------------

const narrativeOf = (claims) => ({ decisions: [], pivots: [], requirements: [], claims });
const EMPTY = narrativeOf([]);
const upheld = () => 'not-refuted';
/** Answers each window with the `claims` whose statement is one of its own events (M35: a helper is a session of its
 *  own, reviewed in its own window) and votes `verdict(item)` on every challenge item — citing the item's own evidence,
 *  as an honest challenger does; `null` casts no vote. */
function judgeFor(claims, verdict = upheld) {
  return async (request) => {
    const own = new Set((request.window?.events ?? []).map((event) => event.id));
    if (!request.challenge) return narrativeOf(claims.filter((claim) => own.has(claim.stated?.eventId)));
    return { votes: request.challenge.items.flatMap((item) => {
      const chosen = verdict(item);
      if (chosen === null) return [];
      return [{ key: item.key, verdict: chosen, explanation: 'Synthetic.',
        receipts: chosen === 'uncertain' ? [] : [ownReceipt(item.candidate)] }];
    }) };
  };
}
const reviewOf = (session, claims, { profile = null, verdict = upheld } = {}) => reviewRun.runReview({ session, pr: null,
  reviewScope: 'session-only', ...(profile ? { speedProfile: profile } : {}), judge: judgeFor(claims, verdict) });
/** A verdict on the claim item stating `eventId` (its resolution and support items included), upheld otherwise. */
const onClaimOf = (eventId, chosen) => (item) => (item.candidate?.stated?.eventId === eventId && item.type === 'claim'
  ? chosen : 'not-refuted');

const contradictions = (report) => report.findings.filter((f) => f.kind === 'claim_contradicted');
const statedOf = (finding) => finding.receipts.filter((r) => r.role === 'commentary').map((r) => r.eventId).join('+');
/** Each published contradiction as [its stated event(s), status, disclosure], sorted. */
const outcomes = (report) => contradictions(report).map((f) => [statedOf(f), f.status, f.disclosureReason ?? null]).sort();
const part = (report, name = 'T1') => report.parts.find((p) => p.part === name);

// ---- the closed vocabulary -----------------------------------------------------------------------------------------------

test('M33 H helper_internal is a closed disclosure reason beside self_corrected, with the story\'s sentence', () => {
  // M33 brittleness M4 added `disclosed` after them: an upheld disclosure of an edit, never a role.
  assert.deepEqual(ledger.DISCLOSURE_REASONS, ['self_corrected', 'helper_internal', 'disclosed', 'corrected_later']);
  assert.ok(Object.isFrozen(ledger.DISCLOSURE_REASONS));
  // D97: the page's and the report .md's words for it (report-words.js).
  // D153: and a later window's correction of a claim, which the after-point re-check gives.
  assert.deepEqual(Object.keys(REPORT_DISCLOSURE_WORDS.claim).sort(), ['corrected_later', 'disclosed', 'helper_internal',
    'self_corrected']);
  assert.equal(typeof REPORT_DISCLOSURE_WORDS.claim.helper_internal, 'string');
  assert.equal(REPORT_ITEM_WORDS.helperSaid, 'A helper said:');
});

// ---- Claude Code, Agent tool -----------------------------------------------------------------------------------------

test('M33 H Claude Code: a helper\'s own contradicted commentary publishes FYI helper_internal; the session reads FYI', async () => {
  for (const profile of PROFILES) {
    const label = String(profile);
    const report = await reviewOf(agentSession(), [CLAIMS.helperSaid], { profile });
    assert.deepEqual(outcomes(report), [['child:w:C1', 'FYI', 'helper_internal']], label);
    const [finding] = contradictions(report);
    assert.deepEqual(finding.receipts.map((r) => [r.eventId, r.role]), [['child:w:C1', 'commentary'],
      ['child:w:A1-r', 'observation']], `${label}: the contradiction is published with its own receipts`);
    assert.equal(Object.hasOwn(finding, 'resolvedBy'), false, label);
    assert.equal(report.sessionReview, 'complete', label);
    assert.equal(report.sessionStatus, 'FYI', label);
    assert.equal(report.reviewStatus, 'FYI', label);
    assert.equal(part(report).status, 'FYI', label);
    assert.deepEqual(part(report).reasons, ['finding_fyi'], label);
    assert.deepEqual(report.promises, [], `${label}: the claim is its finding, not also a promise`);
  }
});

test('M33 H Claude Code: a helper\'s contradicted closing report publishes FYI; the received tool result is no statement', async () => {
  for (const profile of PROFILES) {
    const label = String(profile);
    const report = await reviewOf(agentSession(), [CLAIMS.report], { profile });
    assert.deepEqual(outcomes(report), [['child:w:C3', 'FYI', 'helper_internal']], label);
    assert.equal(report.sessionStatus, 'FYI', label);
    // The same words as the Agent tool's result are the parent's observation of its hand-off: cited as a statement
    // they never ground, so no claim of anyone's is published from them — never a DECIDE.
    const received = await reviewOf(agentSession(), [CLAIMS.received], { profile });
    assert.deepEqual(contradictions(received), [], label);
    assert.notEqual(received.sessionStatus, 'DECIDE', label);
  }
});

/**
 * M35 (windowing, owner-confirmed spec 2026-10-06: a helper is a session of its own, and a window carries no earlier
 * action or result). The parent's relay is the parent's own claim, reviewed in the parent's window — which shows the
 * report the parent received, never the helper's own failing run (that is the helper's session's). A relay contradicted
 * only by the helper's result therefore cites a source its window was not shown: withheld before any challenge, counted,
 * never DECIDE. The helper's own statement, reviewed in the helper's window, stays FYI. (Open: M33 H's relay route — a
 * relayed helper claim reads DECIDE — now holds only when the parent's own window shows the contradicting result.)
 */
const RELAY_WITHHELD = 'M35: the relay\'s contradiction is the helper\'s result, which the parent\'s window is never shown';

test('M33 H, M35 Claude Code: the parent\'s relay contradicted only by the helper\'s run is withheld, never DECIDE; the helper\'s FYI stands', async () => {
  for (const profile of PROFILES) {
    const label = String(profile);
    const report = await reviewOf(agentSession(), [CLAIMS.helperSaid, CLAIMS.relay], { profile });
    assert.deepEqual(outcomes(report), [['child:w:C1', 'FYI', 'helper_internal']], `${label}: ${RELAY_WITHHELD}`);
    assert.equal(report.sessionStatus, 'FYI', label);
    assert.equal(report.withheld.proposals, 1, `${label}: the relay is counted as withheld`);
    const relay = await reviewOf(agentSession(), [CLAIMS.relay], { profile });
    assert.deepEqual(outcomes(relay), [], label);
    assert.notEqual(relay.sessionStatus, 'DECIDE', label);
    assert.equal(relay.withheld.proposals, 1, label);
  }
});

test('M33 H Claude Code: a parent-only contradicted claim is DECIDE exactly as before, beside a helper\'s FYI', async () => {
  for (const profile of PROFILES) {
    const label = String(profile);
    const report = await reviewOf(agentSession(), [CLAIMS.parentOnly], { profile });
    assert.deepEqual(outcomes(report), [['C3', 'DECIDE', null]], label);
    assert.equal(report.sessionStatus, 'DECIDE', label);
    const both = await reviewOf(agentSession(), [CLAIMS.helperSaid, CLAIMS.parentOnly], { profile });
    assert.deepEqual(outcomes(both), [['C3', 'DECIDE', null], ['child:w:C1', 'FYI', 'helper_internal']], label);
    assert.equal(both.sessionStatus, 'DECIDE', label);
    assert.deepEqual(contradictions(both).find((f) => statedOf(f) === 'C3'), contradictions(report)[0],
      `${label}: the parent's finding is byte for byte the one it is alone`);
  }
});

// ---- an unsettled helper-internal claim is FYI-bound, never decide_unsettled ----------------------------------------------

test('M33 H an unsettled helper-internal claim never holds its part off CLEAN; it is still withheld and counted', async () => {
  for (const profile of PROFILES) {
    const label = String(profile);
    const report = await reviewOf(agentSession(), [CLAIMS.helperSaid], { profile, verdict: onClaimOf('child:w:C1', 'uncertain') });
    assert.deepEqual(contradictions(report), [], `${label}: withheld, never published`);
    assert.equal(report.sessionReview, 'complete', label);
    assert.equal(part(report).status, 'CLEAN', label);
    assert.deepEqual(part(report).reasons, [], label);
    assert.equal(report.sessionStatus, 'CLEAN', label);
    assert.equal(report.partCounts.parts_decide_unsettled, 0, label);
    assert.equal(ledger.decideUnsettledCount(report), 0, label);
    assert.equal(report.withheld.unsettled, 1, `${label}: the unsettled check is counted, never hidden`);
    // M35: the parent's relay contradicted only by the helper's run is withheld before any challenge (RELAY_WITHHELD):
    // never asked, so never unsettled.
    const relay = await reviewOf(agentSession(), [CLAIMS.relay], { profile, verdict: onClaimOf('C2', 'uncertain') });
    assert.equal(relay.withheld.unsettled, 0, label);
    assert.equal(relay.withheld.proposals, 1, label);
  }
});

test('M33 H an unexecuted helper-internal claim leaves its window incomplete (UNCHECKED), with no decide_unsettled', async () => {
  const report = await reviewOf(agentSession(), [CLAIMS.helperSaid], { verdict: onClaimOf('child:w:C1', null) });
  assert.ok(part(report).reasons.includes('window_incomplete'));
  assert.ok(!part(report).reasons.includes('decide_unsettled'));
  assert.equal(part(report).status, 'UNCHECKED');
  assert.equal(report.sessionStatus, 'UNCHECKED');
});

// M33 H repair (recheck minor): whose statement it is is code's reading of the recording, made once, when the challenge
// record is built — the record's own `helperStatement: true` beside the item's result — so a report saved without its
// recording (the CLI's report.private.json) reads exactly as the live run read it. A result without the mark — an
// older report's, or any the code did not mark — is DECIDE-bound: a re-reading can be lower, never cleaner.
/** The live report with every claim result's code-set mark taken away (`mark`: what to put in its place). */
const withoutMarks = (report, mark = undefined) => ({ ...report, windowResults: report.windowResults.map((w) => ({ ...w,
  challenge: { ...w.challenge, results: w.challenge.results.map(({ helperStatement: _code, ...result }) => ({ ...result,
    ...(mark === undefined ? {} : { candidate: { ...result.candidate, helperStatement: mark } }) })) } })) });

test('M33 H repair: a report saved without its recording reads exactly as the live run did', async () => {
  for (const profile of PROFILES) {
    const label = String(profile);
    const report = await reviewOf(agentSession(), [CLAIMS.helperSaid], { profile, verdict: onClaimOf('child:w:C1', 'uncertain') });
    assert.equal(report.sessionStatus, 'CLEAN', `${label}: premise`);
    const marked = report.windowResults.flatMap((w) => w.challenge.results).filter((r) => r.helperStatement === true);
    assert.deepEqual(marked.map((r) => [r.type, r.candidate.stated.eventId]), [['claim', 'child:w:C1']],
      `${label}: code marked the helper's claim in the record it built`);
    const { session: omitted, ...saved } = report;
    const again = ledger.honestStatuses(saved);
    assert.equal(again.sessionStatus, 'CLEAN', `${label}: the saved report reads as the live run did`);
    assert.deepEqual(again.parts.map((p) => [p.part, p.status, p.reasons]), report.parts.map((p) => [p.part, p.status, p.reasons]),
      label);
    // D71 (a): no headline status; the saved report reads as a review that ran to completion, as the live run did.
    assert.equal(ledger.reviewRunState(saved), ledger.reviewRunState(report), label);
    // Only code's mark counts: none (an older report's) reads DECIDE-bound — lower, never cleaner — and a mark a model
    // put on its own candidate is not code's.
    assert.equal(ledger.honestStatuses(withoutMarks(saved)).sessionStatus, 'NO_FINDINGS', label);
    assert.equal(ledger.honestStatuses(withoutMarks(saved, true)).sessionStatus, 'NO_FINDINGS', label);
    assert.equal(ledger.decideUnsettledCount(withoutMarks(report)), 1, label);
  }
  // The parent's own claim is never marked, with or without its recording. (M35: the parent's own contradicted claim —
  // a relay contradicted only by the helper's run is withheld, RELAY_WITHHELD.)
  const parent = await reviewOf(agentSession(), [CLAIMS.parentOnly], { verdict: onClaimOf('C3', 'uncertain') });
  assert.deepEqual(parent.windowResults.flatMap((w) => w.challenge.results).filter((r) => Object.hasOwn(r, 'helperStatement')), []);
  const { session: gone, ...kept } = parent;
  assert.equal(ledger.honestStatuses(kept).sessionStatus, 'NO_FINDINGS');
  // A saved report's published helper finding keeps the FYI status the live reading gave it.
  const published = await reviewOf(agentSession(), [CLAIMS.helperSaid]);
  const { session: none, ...stored } = published;
  assert.equal(ledger.honestStatuses(stored).sessionStatus, 'FYI');
});

test('M33 H repair: a statement is a helper\'s only when its recorded child has a verified link', async () => {
  const session = agentSession({ link: null });
  const rows = (s) => grounded(s, candidateOf([R.helperSaid, R.fail])).findings.map((f) => [f.status, f.disclosureReason ?? null]);
  assert.deepEqual(rows(agentSession()), [['FYI', 'helper_internal']], 'premise: linked');
  // No link, a link that is not verified, one without its child session, or a conflicting one: the recorded childId
  // alone proves no helper (Session.actorForActions' rule), so the statement is the parent's.
  for (const s of [session, agentSession({ link: { state: 'missing' } }), agentSession({ link: { childSession: null } }),
    agentSession({ link: { state: 'conflicting' } })])
    assert.deepEqual(rows(s), [['DECIDE', null]]);
  const report = await reviewOf(session, [CLAIMS.helperSaid], { verdict: onClaimOf('child:w:C1', 'uncertain') });
  assert.deepEqual(report.windowResults.flatMap((w) => w.challenge.results).filter((r) => r.helperStatement === true), []);
  assert.equal(ledger.decideUnsettledCount(report), 1, 'unproven: DECIDE-bound, so its unsettled check holds it off CLEAN');
});

// ---- self-correction and code-owned status ---------------------------------------------------------------------------

test('M33 H a helper\'s self-corrected claim stays helper_internal FYI and keeps its verified correction', async () => {
  const resolvedBy = { observation: R.pass, statement: R.helperFixed };
  const report = await reviewOf(agentSession({ corrected: true }), [{ ...CLAIMS.helperSaid, resolvedBy }]);
  assert.deepEqual(outcomes(report), [['child:w:C1', 'FYI', 'helper_internal']]);
  const [finding] = contradictions(report);
  // M36 phase 3 review (c6): a verified receipt carries the session its quote grounds in — the recording's key and the
  // cited event's recorded child id (a helper's).
  assert.deepEqual(finding.resolvedBy.observation, { ...R.pass, sessionKey: SESSION_KEY, childId: 'w' });
  assert.deepEqual(finding.resolvedBy.statement, { ...R.helperFixed, sessionKey: SESSION_KEY, childId: 'w' });
  assert.equal(report.counts.resolutions.verified, 1);
});

const candidateOf = (receipts, over = {}) => ({ origin: 'session-review', kind: 'claim_contradicted',
  title: 'SYNTHETIC_HH_TITLE', explanation: 'SYNTHETIC_HH: a recorded result contradicts the statement.',
  scope: 'session-effect', anchor: null, receipts, ...over });
const grounded = (session, candidate) => ledger.buildLedger({ repo: REPO, session, findingCandidates: [candidate],
  sessionCoverage: 'complete' });

test('M33 H only code sets helper_internal, and only when every stated event is a helper\'s recorded own', () => {
  const session = agentSession();
  const rows = (candidate, s = session) => grounded(s, candidate).findings.map((f) => [f.status, f.disclosureReason ?? null]);
  assert.deepEqual(rows(candidateOf([R.helperSaid, R.fail])), [['FYI', 'helper_internal']]);
  assert.deepEqual(rows(candidateOf([R.helperSaid, R.report, R.fail])), [['FYI', 'helper_internal']], 'two of the helper\'s');
  // One parent statement among them is the parent's statement — and M36 phase 3 (D68 F, c6): the helper's run was never
  // received by the parent, so it contradicts no statement of the parent's: withheld (`other_session`), never DECIDE.
  const withheld = (candidate) => grounded(session, candidate).rejectedFindings.map((r) => r.cause);
  assert.deepEqual(rows(candidateOf([R.helperSaid, R.relay, R.fail])), []);
  assert.deepEqual(withheld(candidateOf([R.helperSaid, R.relay, R.fail])), ['other_session']);
  assert.deepEqual(rows(candidateOf([R.relay, R.fail])), []);
  assert.deepEqual(withheld(candidateOf([R.relay, R.fail])), ['other_session']);
  // The parent's own statement and its own run: DECIDE. A model cannot set helper_internal.
  assert.deepEqual(rows(candidateOf([R.parentSaid, R.lintFail])), [['DECIDE', null]]);
  assert.deepEqual(rows(candidateOf([R.parentSaid, R.lintFail], { disclosureReason: 'helper_internal' })), [['DECIDE', null]]);
  // An actor the recording does not name as a string is no helper's: DECIDE, never FYI by guess.
  for (const childId of ['', 7, null]) {
    const odd = agentSession({ childId });
    assert.deepEqual(rows(candidateOf([R.helperSaid, R.fail]), odd), [['DECIDE', null]], String(childId));
  }
});

test('M33 H a merge that keeps DECIDE keeps no helper_internal disclosure', () => {
  const session = agentSession();
  const fyi = grounded(session, candidateOf([R.helperSaid, R.fail])).findings[0];
  const decide = { ...fyi, title: 'SYNTHETIC_HH_OTHER', status: 'DECIDE' };
  delete decide.disclosureReason;
  const { findings } = ledger.mergeDuplicateFindings([fyi, decide]);
  assert.equal(findings.length, 1);
  assert.equal(findings[0].status, 'DECIDE');
  assert.equal(Object.hasOwn(findings[0], 'disclosureReason'), false);
});

// ---- the rendered report and the story say it in plain words ---------------------------------------------------------

test('M33 H the report marks the claim as a helper\'s internal statement; the parent\'s DECIDE carries no mark', async () => {
  // M35: the parent's DECIDE is its own contradicted claim (a relay contradicted only by the helper's run is withheld).
  const report = await reviewOf(agentSession(), [CLAIMS.helperSaid, CLAIMS.parentOnly]);
  assert.deepEqual(contradictions(report).map((f) => [f.status, f.disclosureReason ?? null]).sort(),
    [['DECIDE', null], ['FYI', 'helper_internal']]);
});

test('M33 H, D97 the report .md says the claim was a helper\'s internal statement, and labels its words as the helper\'s', async () => {
  const session = agentSession();
  // M35: the parent's statement is its own contradicted claim (RELAY_WITHHELD).
  const report = await reviewOf(session, [CLAIMS.helperSaid, CLAIMS.parentOnly]);
  const md = story.renderReportMarkdown(session, report);
  const helper = REPORT_DISCLOSURE_WORDS.claim.helper_internal;
  assert.equal(md.split(helper).length - 1, 1, 'said once, for the helper\'s finding only');
  assert.ok(md.includes(`${REPORT_ITEM_WORDS.helperSaid} “the nested parser tests pass now.”`), md);
  assert.ok(md.includes('“lint is clean.”') && !md.includes(`${REPORT_ITEM_WORDS.helperSaid} “lint is clean.”`),
    'the parent\'s statement is still what the agent said');
  // Without the helper's FYI there is nothing to say.
  const relay = await reviewOf(session, [CLAIMS.parentOnly]);
  assert.ok(!story.renderReportMarkdown(session, relay).includes(helper));
});

// ---- the combined route ------------------------------------------------------------------------------------------------

const GREET = 'src/greet.js';
const GREET_DIFF = ['diff --git a/src/greet.js b/src/greet.js', 'new file mode 100644', '--- /dev/null',
  '+++ b/src/greet.js', '@@ -0,0 +1,1 @@', '+export default "SYNTHETIC_HH_GREETING";', ''].join('\n');
const GREET_PR = { repo: { host: 'github.com', id: '332' }, number: 332, baseOid: 'b'.repeat(40), diffBaseOid: 'b'.repeat(40),
  headOid: 'a'.repeat(40), gitAlgorithm: 'sha1', enumeration: 'complete',
  files: [{ path: GREET, change: 'added', contentState: 'complete' }] };
const jointJudge = ({ claims = [], sessionFindings = [], verdict = upheld }) => async (request) => {
  const base = { ...EMPTY, codeFindings: [], sessionFindings: [] };
  if (request.challenge) return { votes: request.challenge.items.map((item) => ({ key: item.key, verdict: verdict(item),
    explanation: 'Synthetic.', receipts: verdict(item) === 'uncertain' ? [] : [ownReceipt(item.candidate)] })) };
  if (/^code\+chunk:/.test(request.label ?? '')) return { ...base, reviewedFiles: [GREET] };
  // M35: the helper is a session of its own. M36 phase 3 (D68 K): small, it shares its parent's window (the one window,
  // each under its own heading), which is answered with every statement of both.
  if (/^code\+narrative:w1$/.test(request.label ?? '')) return { ...base, reviewedFiles: [], claims, sessionFindings };
  return { ...base, reviewedFiles: [] };
};
const combined = (answer) => runCodeReview({ session: agentSession(), pr: GREET_PR, diff: GREET_DIFF, judge: jointJudge(answer) });

test('M33 H the combined route: a helper\'s claim and a joint finding on its statement are FYI; the parent\'s, DECIDE', async () => {
  const claim = await combined({ claims: [CLAIMS.helperSaid] });
  assert.deepEqual(outcomes(claim), [['child:w:C1', 'FYI', 'helper_internal']]);
  assert.equal(claim.sessionStatus, 'FYI');
  const joint = await combined({ sessionFindings: [candidateOf([R.report, R.fail])] });
  assert.deepEqual(outcomes(joint), [['child:w:C3', 'FYI', 'helper_internal']]);
  assert.equal(joint.sessionStatus, 'FYI');
  // M35 (RELAY_WITHHELD): a joint finding on the parent's relay that cites the helper's run — M36 phase 3 (D68 F, c6): a
  // result of another session, which the parent never received — is withheld (`other_session`), never DECIDE; the
  // parent's own contradicted statement is DECIDE.
  const relayed = await combined({ claims: [CLAIMS.helperSaid], sessionFindings: [candidateOf([R.relay, R.fail])] });
  assert.deepEqual(outcomes(relayed), [['child:w:C1', 'FYI', 'helper_internal']]);
  const parent = await combined({ claims: [CLAIMS.helperSaid], sessionFindings: [candidateOf([R.parentSaid, R.lintFail])] });
  assert.deepEqual(outcomes(parent), [['C3', 'DECIDE', null], ['child:w:C1', 'FYI', 'helper_internal']]);
  assert.equal(parent.sessionStatus, 'DECIDE');
  assert.equal(parent.reviewStatus, 'DECIDE');
});

test('M33 H repair the combined route: an unsettled joint finding is marked by code when it is a helper\'s, and reads the same saved', async () => {
  const unsettledJoint = (item) => (item.type === 'session-finding' ? 'uncertain' : 'not-refuted');
  const helper = await combined({ sessionFindings: [candidateOf([R.report, R.fail])], verdict: unsettledJoint });
  const marks = (report) => report.codeChallenges.flatMap((c) => c.results).filter((r) => r.type === 'session-finding')
    .map((r) => r.helperStatement === true);
  assert.deepEqual(contradictions(helper), [], 'withheld, never published');
  assert.deepEqual(marks(helper), [true]);
  assert.equal(ledger.decideUnsettledCount(helper), 0, 'FYI-bound');
  const { session: omitted, ...saved } = helper;
  assert.equal(ledger.honestStatuses(saved).sessionStatus, helper.sessionStatus, 'saved, it reads as the live run did');
  const parent = await combined({ sessionFindings: [candidateOf([R.parentSaid, R.lintFail])], verdict: unsettledJoint });
  assert.deepEqual(marks(parent), [false]);
  assert.equal(ledger.decideUnsettledCount(parent), 1, 'the parent\'s statement is DECIDE-bound');
  assert.notEqual(parent.sessionStatus, 'CLEAN');
});

// ---- Codex, through the ledger adapter (an attached FINAL_ANSWER) ------------------------------------------------------

const CODEX_TEXT = Object.freeze({
  fail: 'FAIL nested: 1 failed, 11 passed',
  helperSaid: 'The nested parser tests pass now.',
  report: 'Fixed the nested parser; all nested parser tests pass.',
  relay: 'The nested parser is fixed and all nested parser tests pass.',
  // M33 H repair: the parent's relay naming its helper as the source.
  attributed: 'The helper reports the nested parser is fixed and all nested parser tests pass.',
  checkFail: 'check: 2 failed',
  parentSaid: 'The parser check passes.',
});
const cmd = (turn, seq, record, name, extra = {}) => ({ turn, seq, kind: 'bash', cmd: `node ${name}.js`,
  outcome: 'passed', exitCode: 0, exitCodeSource: 'native', tailLines: [`${name} ok`],
  sourceLocator: { stream: 0, record, part: 0, resultRecord: record + 1 }, ...extra });
const say = (turn, record, beforeEvent, text) => ({ turn, source: 0, record, block: 0, beforeEvent, text });
/** A Codex parent: its suite (passing), a spawned helper whose own test run FAILS, which says the tests pass and
 *  reports so (its FINAL_ANSWER, attached to the hand-off), the parent's own check (failing), its relay of the
 *  helper's report (`relay`, its text) and its own statement about its check. */
function codexSession({ relay = CODEX_TEXT.relay } = {}) {
  const helper = { sources: [{ adapter: 'codex' }], ask: [], instructions: [], instructionAuthority: 'unchecked',
    sayings: [], marks: [],
    ledger: [cmd(0, 0, 3, 'helper-edit'), cmd(0, 1, 5, 'helper-test',
      { outcome: 'failed', exitCode: 1, tailLines: [CODEX_TEXT.fail] })],
    commentary: [say(0, 2, 0, 'Starting the nested parser fix.'), say(0, 7, 2, CODEX_TEXT.helperSaid),
      say(0, 9, 2, CODEX_TEXT.report)],
    capture: { incomplete: true, reasons: ['child_instruction_authority_unchecked'] } };
  return sessionFromLedger({
    sources: [{ adapter: 'codex' }],
    ask: [{ turn: 1, text: 'Fix the parser.' }],
    ledger: [cmd(1, 0, 4, 'suite'), cmd(1, 1, 12, 'check', { outcome: 'failed', exitCode: 1, tailLines: [CODEX_TEXT.checkFail] })],
    commentary: [say(1, 14, 2, relay), say(1, 15, 2, CODEX_TEXT.parentSaid)],
    sayings: [], marks: [],
    delegations: [{ adapter: 'codex', kind: 'spawn', callId: 'spawn-6', turn: 1, childId: 'helper-a',
      taskName: '/root/helper_a', status: 'linked', reason: 'child_recording_linked', source: 0, record: 6,
      link: { source: 0 }, parentInstruction: { tool: 'spawn_agent', field: 'message', encrypted: true },
      finalAnswer: { text: CODEX_TEXT.report, record: 10, turn: 1 } }],
    children: [{ source: 0, ledger: helper, parentInstructions: [] }],
  }, { sessionKey: 'sess-h-codex' });
}
/** The id of the one event of `session` whose own text (or output) is exactly `text`, of `kind`. */
function eventWith(session, kind, text) {
  const found = session.events.filter((event) => event.kind === kind
    && session.textOf(event, kind === 'observation' ? 'output' : 'text') === text);
  assert.equal(found.length, 1, `${kind}: ${text}`);
  return found[0];
}

test('M33 H Codex: a helper\'s contradicted commentary and closing report are FYI; the parent\'s own claim DECIDE (M35: its relay withheld)', async () => {
  const session = codexSession();
  const helperSaid = eventWith(session, 'commentary', CODEX_TEXT.helperSaid);
  const report = eventWith(session, 'commentary', CODEX_TEXT.report);
  const fail = eventWith(session, 'observation', CODEX_TEXT.fail);
  const relay = eventWith(session, 'commentary', CODEX_TEXT.relay);
  const parentSaid = eventWith(session, 'commentary', CODEX_TEXT.parentSaid);
  const checkFail = eventWith(session, 'observation', CODEX_TEXT.checkFail);
  // Premises: the helper's events are its own (recorded childId); the FINAL_ANSWER the parent received is the parent's
  // observation of its hand-off, with the report's very words.
  assert.equal(helperSaid.childId, 'helper-a');
  assert.equal(report.childId, 'helper-a');
  assert.equal(relay.childId ?? null, null);
  const delivered = session.events.find((event) => event.helperReported === true);
  assert.equal(session.textOf(delivered, 'output'), CODEX_TEXT.report);
  assert.equal(delivered.childId ?? null, null);
  const claim = (stated, quote, against, againstQuote) => ({ text: `The agent said: ${quote}`,
    stated: receipt(stated.id, 'commentary', quote), contradictedBy: receipt(against.id, 'observation', againstQuote) });
  const C = {
    helperSaid: claim(helperSaid, CODEX_TEXT.helperSaid, fail, CODEX_TEXT.fail),
    report: claim(report, CODEX_TEXT.report, fail, CODEX_TEXT.fail),
    relay: claim(relay, CODEX_TEXT.relay, fail, CODEX_TEXT.fail),
    parentSaid: claim(parentSaid, CODEX_TEXT.parentSaid, checkFail, CODEX_TEXT.checkFail),
    received: claim(delivered, CODEX_TEXT.report, fail, CODEX_TEXT.fail),
  };
  for (const profile of PROFILES) {
    const label = String(profile);
    const helperOnly = await reviewOf(session, [C.helperSaid, C.report], { profile });
    assert.deepEqual(outcomes(helperOnly), [[helperSaid.id, 'FYI', 'helper_internal'], [report.id, 'FYI', 'helper_internal']]
      .sort(), label);
    assert.equal(helperOnly.sessionReview, 'complete', label);
    assert.equal(helperOnly.sessionStatus, 'FYI', `${label}: FYI, never DECIDE`);
    // M35 (RELAY_WITHHELD): the relay is withheld; the helper's own statement stays FYI.
    const relayed = await reviewOf(session, [C.helperSaid, C.relay], { profile });
    assert.deepEqual(outcomes(relayed), [[helperSaid.id, 'FYI', 'helper_internal']], label);
    assert.equal(relayed.withheld.proposals, 1, label);
    const parentOnly = await reviewOf(session, [C.parentSaid], { profile });
    assert.deepEqual(outcomes(parentOnly), [[parentSaid.id, 'DECIDE', null]], label);
    assert.equal(parentOnly.sessionStatus, 'DECIDE', label);
    const received = await reviewOf(session, [C.received], { profile });
    assert.deepEqual(contradictions(received), [], `${label}: the delivered report is no one's statement`);
    assert.notEqual(received.sessionStatus, 'DECIDE', label);
  }
});

// ---- Claude Code Workflow, through the real loader --------------------------------------------------------------------

const WF = Object.freeze({
  premature: 'All parser tests pass after the edit.',
  falseReport: 'Fixed the nested-input branch; all parser tests pass.',
  // M33 H repair: the parent's closing statement passing on what its workflow agent reported, naming it as the source.
  attributed: 'Per the fixer agent, all parser tests pass now; the nested-input fix is in.',
});
/** The M33 W fixture's run, read by the real loader: the fixer agent's FAILING run, then (here) its premature claim
 *  that the tests pass and, with `falseReport`, a closing statement and journal result saying so; the parent's own
 *  closing claim that all parser tests pass (`closing`, its text). */
async function workflowSession(t, { falseReport = false, closing = null } = {}) {
  const dir = await W.scratch('sonah-m33-h-');
  t.after(() => W.rm(dir, { recursive: true, force: true }));
  const previous = process.env.SONAH_HOME;
  process.env.SONAH_HOME = join(dir, 'home');
  t.after(() => { if (previous === undefined) delete process.env.SONAH_HOME; else process.env.SONAH_HOME = previous; });
  const premature = (row) => row('assistant', [{ type: 'text', text: WF.premature }], {}, 'premature');
  const fixer = W.fixerRows({ extra: [premature] });
  if (falseReport) fixer[fixer.length - 1] = { ...fixer.at(-1),
    message: { role: 'assistant', content: [{ type: 'text', text: WF.falseReport }] } };
  const run = W.linkedRun({ agents: { [W.AGENTS.fixer]: fixer, [W.AGENTS.tester]: W.testerRows() },
    journal: [W.started(W.AGENTS.fixer), W.started(W.AGENTS.tester),
      W.resulted(W.AGENTS.fixer, falseReport ? WF.falseReport : W.RESULTS.fixer), W.resulted(W.AGENTS.tester, W.RESULTS.tester)] });
  const transcriptDir = join(dir, 'projects', W.SLUG, W.SID, 'subagents', 'workflows', W.RUN);
  const parent = W.parentRows({ workflows: [W.workflowRows({ transcriptDir })] });
  if (closing !== null) parent[parent.length - 1] = { ...parent.at(-1),
    message: { role: 'assistant', content: [{ type: 'text', text: closing }] } };
  const tree = await W.writeTree(dir, { parent, run });
  await W.mkdir(join(dir, 'codex'), { recursive: true });
  const loaded = redact(await loadSessionEvidence([tree.parent], { outcomes: new Map(), reviewLinkedChildren: true,
    recordingRoots: { claude: tree.projects, codex: join(dir, 'codex') } })).ledger;
  return sessionFromLedger(loaded);
}

test('M33 H Claude Code Workflow: an agent\'s contradicted claim is FYI; the parent\'s closing claim on its run is withheld (M35)', async (t) => {
  const session = await workflowSession(t);
  const premature = eventWith(session, 'commentary', WF.premature);
  const parentClaim = eventWith(session, 'commentary', W.TEXT.claim);
  const failing = eventWith(session, 'observation', W.TEXT.failing);
  assert.equal(premature.childId, W.AGENTS.fixer, 'premise: the agent\'s own statement');
  assert.equal(parentClaim.childId ?? null, null, 'premise: the parent\'s');
  const against = receipt(failing.id, 'observation', 'Tests: 1 failed, 11 passed, 12 total');
  const helperClaim = { text: 'The fixer agent said all parser tests pass.', stated: receipt(premature.id, 'commentary', WF.premature),
    contradictedBy: against };
  const relay = { text: 'The agent said all parser tests pass.', stated: receipt(parentClaim.id, 'commentary',
    'All parser tests pass now'), contradictedBy: against };
  for (const profile of [null, 'm33-lean']) {
    const label = String(profile);
    const alone = await reviewOf(session, [helperClaim], { profile });
    assert.deepEqual(outcomes(alone), [[premature.id, 'FYI', 'helper_internal']], label);
    assert.equal(alone.sessionStatus, 'FYI', label);
    // M35 (RELAY_WITHHELD): the parent's closing claim on the agent's run cites the agent's result, which the parent's
    // window is never shown: withheld; the agent's own claim stays FYI.
    const both = await reviewOf(session, [helperClaim, relay], { profile });
    assert.deepEqual(outcomes(both), [[premature.id, 'FYI', 'helper_internal']], label);
    assert.equal(both.sessionStatus, 'FYI', label);
  }
});

test('M33 H Claude Code Workflow: an agent\'s contradicted closing report (its journal result) is FYI', async (t) => {
  const session = await workflowSession(t, { falseReport: true });
  const closing = eventWith(session, 'commentary', WF.falseReport);
  const failing = eventWith(session, 'observation', W.TEXT.failing);
  assert.equal(closing.childId, W.AGENTS.fixer);
  // The journal result is the parent's observation of the agent's hand-off: what the parent received.
  const journal = session.events.find((event) => event.helperReported === true
    && session.textOf(event, 'output').includes('all parser tests pass'));
  assert.ok(journal, 'premise: the journal result carries the report');
  assert.equal(journal.childId ?? null, null);
  const report = await reviewOf(session, [{ text: 'The fixer agent reported all parser tests pass.',
    stated: receipt(closing.id, 'commentary', WF.falseReport),
    contradictedBy: receipt(failing.id, 'observation', 'Tests: 1 failed, 11 passed, 12 total') }]);
  assert.deepEqual(outcomes(report), [[closing.id, 'FYI', 'helper_internal']]);
  assert.equal(report.sessionStatus, 'FYI');
});

// ---- M33 H repair: a relay naming its helper is the parent's own claim (sonah.narrative/13, sonah.challenge/10) ---------
//
// The owner's "FYI unless relayed" needs the parent's relay reviewed as the parent's claim. Under sonah.narrative/12 and
// sonah.challenge/9 both the reviewer and the challengers were told that "a restatement of what … another agent says" is
// NOT a claim, so a parent passing on its helper's report BY NAME ("The helper reports that …") was never proposed, and
// refuted when it was: the false claim the human was told reached only FYI (recheck probes P02, P02b, P03, P28), and
// with the helper's own check unsettled the review read CLEAN (P04). Now a relay is the passing agent's own claim —
// unless it says it did not check it or doubts it — and only a restatement of a document or a hand-off brief is not.

const flat = (text) => String(text ?? '').replace(/\s+/g, ' ');
/** The words each instrument now sends, and the exclusion it sent before (whitespace folded). H3
 *  moved the exclusion beside the relay rule: only an action not taken yet, a question or a restatement of a document or
 *  a hand-off brief is not a claim. Its review repair (`sonah.narrative/16`, `sonah.challenge/13`) took the relay rule's
 *  example phrasings out and said a hedge on a relay is not doubt; the rule itself did not change. */
const RULE = Object.freeze({
  narrative: 'An agent that passes on what a helper or another agent reported makes it its own claim, unless it says it '
    + 'did not check it or doubts it: report it as that agent\'s claim, quoting its own words, never the report it '
    + 'received.',
  narrativeNotClaim: 'Only an action the agent has not taken yet, a question, or a restatement of what a document or a '
    + 'hand-off brief says is NOT a claim',
  narrativeContract: 'and never what a document or a hand-off brief says. What an agent passes on from a helper\'s or '
    + 'another agent\'s report is its own claims item, unless it says it did not check it or doubts it',
  challenge: 'An agent that passes on what a helper or another agent reported makes what it passes on its own claim, '
    + 'unless it says it did not check it or doubts it: judge it as that agent\'s own claim, never as a restatement.',
  challengeNotClaim: 'An action the agent has not taken yet, a question, or a restatement of what a document or a '
    + 'hand-off brief says is not a claim.',
});
/** D71 (S2): the relay rule as a SESSION-ONLY review says it now, once each — the brief's step 2 and the session
 *  challenge's CLAIM_NOTE (whitespace folded). A combined review still says RULE's (D71 i). */
const SESSION_RULE = Object.freeze({
  narrative: 'what it passes on from a helper or another agent as its own (unless it says it did not check it).',
  narrativeNotClaim: 'Not a claim: a question, a step it has not taken yet, or what it says a document or a hand-off brief says.',
  challenge: 'What the agent passes on from a helper or another agent is its own claim unless it says it did not check it',
  challengeNotClaim: 'A question, a step not taken yet, or what a document or a hand-off brief says is not a claim.',
});
/** The session-only counterfactual of `requestBeforeRelayRule`: the brief's and the claim note's relay rules replaced by
 *  the exclusions the repair closed, so the same reviewer and challengers read what it closed. Test-only. */
function sessionBeforeRelayRule(request) {
  if (request === null || typeof request !== 'object') return request;
  return { ...request, system: flat(request.system).replace(SESSION_RULE.narrative, `${BEFORE_REPAIR.narrative}.`)
    .replace(SESSION_RULE.challenge, BEFORE_REPAIR.challenge) };
}
const BEFORE_REPAIR = Object.freeze({
  narrative: 'a restatement of what a document, a handoff or another agent says is NOT a claim',
  narrativeContract: 'and never what a document, a handoff or another agent says.',
  challenge: 'a restatement of what a document, a handoff or another agent says is not a claim',
});

/**
 * A synthetic reviewer and challengers that do what the words they are SENT say — the recheck's probes, made
 * deterministic. The narrative proposes `helper` (the helper's own claim), and `relay` (the parent's relay naming the
 * helper) only when its prompt says a relay is the passing agent's own claim and does not say another agent's words are
 * none; a challenger refutes `relay` when its system prompt says another agent's words are no claim or does not say a
 * relay is one (citing the relay's own words), and votes `verdict(item)` on every other item. `seen` gets every request.
 */
function followingJudge({ helper, relay, verdict = upheld, seen = [], proposeRelay = false }) {
  return async (request) => {
    seen.push(request);
    if (!request.challenge) {
      // M35: each window proposes what states one of its own events (a helper is a session of its own).
      const own = new Set((request.window?.events ?? []).map((event) => event.id));
      // D71 (S2): a session-only reviewer reads its brief (the system prompt) and its window.
      const asked = flat(`${request.system}\n${request.prompt}`);
      const relays = proposeRelay || (asked.includes(SESSION_RULE.narrative) && !asked.includes(BEFORE_REPAIR.narrative));
      return narrativeOf((relays ? [helper, relay] : [helper]).filter((claim) => own.has(claim.stated.eventId)));
    }
    const system = flat(request.system);
    const refuteRelay = system.includes(BEFORE_REPAIR.challenge) || !system.includes(SESSION_RULE.challenge);
    return { votes: request.challenge.items.flatMap((item) => {
      const isRelay = item.type === 'claim' && item.candidate?.stated?.eventId === relay.stated.eventId;
      const chosen = isRelay && refuteRelay ? 'refuted' : verdict(item);
      if (chosen === null) return [];
      return [{ key: item.key, verdict: chosen, explanation: 'Synthetic.',
        receipts: chosen === 'uncertain' ? [] : [ownReceipt(item.candidate)] }];
    }) };
  };
}
const followed = (session, claims, { profile = null, sentBefore = false, ...options } = {}) => {
  const judge = followingJudge({ ...claims, ...options });
  // `sentBefore`: every request rendered back as /12 and /9 sent it, before the judge reads it (H3's texts first).
  return reviewRun.runReview({ session, pr: null, reviewScope: 'session-only', ...(profile ? { speedProfile: profile } : {}),
    judge: sentBefore ? (request) => judge(sessionBeforeRelayRule(requestBeforeRelayRule(requestBeforeHedgedClaims(request))))
      : judge });
};
/** Every narrative request asked the relay rule, and every challenge request was sent its criterion. */
function assertAskedRule(seen, label) {
  const narratives = seen.filter((r) => !r.challenge), challenges = seen.filter((r) => r.challenge);
  assert.ok(narratives.length > 0 && challenges.length > 0, `${label}: premise`);
  // D71 (S2): the brief says the relay rule (the system prompt); a session challenge batch holding a claim says it in its
  // claim note — a batch with no claim-class item is sent no claim rules at all.
  for (const r of narratives) {
    assert.ok(flat(r.system).includes(SESSION_RULE.narrative), `${label}: ${r.label}`);
    assert.ok(!flat(`${r.system}\n${r.prompt}`).includes(BEFORE_REPAIR.narrative), `${label}: ${r.label}`);
  }
  for (const r of challenges.filter((request) => request.challenge.items.some((item) => challenge.CLAIM_ITEM_TYPES.includes(item.type)))) {
    assert.ok(flat(r.system).includes(SESSION_RULE.challenge), `${label}: ${r.label}`);
    assert.ok(!flat(r.system).includes(BEFORE_REPAIR.challenge), `${label}: ${r.label}`);
  }
}

test('M33 H repair: the narrative prompt asks for a relay as the passing agent\'s own claim (sonah.narrative/13)', async () => {
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
  // The D80 integration moved it once more (sonah.narrative/31): a stopped call's outcome line (D80_VERSIONS).
  // The asks fixes moved it once more (sonah.narrative/33): S3's re-ask of a refuted requirement.
  // W1 A moved it once more (sonah.narrative/34): the re-ask of a decision refuted on who decided it.
  // The release review moved it once more (sonah.narrative/35): a project instruction file the session wrote
  // is left out of the window's project files. The second release review moved it once more
  // (sonah.narrative/36): that file's path is compared under the working directory. G2 moved it once more
  // (sonah.narrative/37): the re-ask of a choice not to act whose existence check refuted its words.
  // D103 moved it once more (sonah.narrative/38): a Claude Code recording's results shown up to 12,000 bytes a side.
  assert.equal(prompt.PROMPT_VERSION, 'sonah.narrative/38');
  // M35 windowing moved it once more (`sonah.narrative/21`): windows, carried context, trims, aliases (C-07).
  // M36 phase 1 moved it once more (`sonah.narrative/22`): the evidence it carries (D68; RECORDED_FACTS_VERSIONS).
  // M36 phase 2 moved it once more (`sonah.narrative/23`): the window format (D68; FORMAT_VERSIONS).
  // M36 phase 3 moved it once more (`sonah.narrative/24`): packed windows, carried failures, the evidence re-ask (D68 K, Q, F; CONVERSATION_VERSIONS).
  // D69 moved it once more (`sonah.narrative/25`): the net view's declines reverted, the harness home folders, the recorder's cwd (D69_VERSIONS).
  // The D69 review moved it once more (`sonah.narrative/26`): a combined request's omission lines offer no request (F2), the ledger moved (typed withholding, paths as recorded) (D69_REVIEW_VERSIONS).
  // D71 (S2) moved it once more (sonah.narrative/27), and D71 (S3) once more (sonah.narrative/28): the new channels (D71_CHANNELS_VERSIONS).
  // The D80 integration moved it once more (sonah.narrative/31): a stopped call's outcome line (D80_VERSIONS).
  // The asks fixes moved it once more (sonah.narrative/33): S3's re-ask of a refuted requirement.
  // W1 A moved it once more (sonah.narrative/34): the re-ask of a decision refuted on who decided it.
  // The release review moved it once more (sonah.narrative/35): a project instruction file the session wrote
  // is left out of the window's project files. The second release review moved it once more
  // (sonah.narrative/36): that file's path is compared under the working directory. G2 moved it once more
  // (sonah.narrative/37): the re-ask of a choice not to act whose existence check refuted its words.
  // D103 moved it once more (sonah.narrative/38): a Claude Code recording's results shown up to 12,000 bytes a side.
  assert.equal(reviewRun.runProfile('session-only').promptVersion, 'sonah.narrative/38');
  const session = agentSession();
  // D71 (S2): a combined request keeps the relay rule in its task (D71 i); a session-only review says it in its brief.
  const { SONAH_SESSION_REVIEW_AGENT } = await import('../src/review-agent.js');
  for (const words of [SESSION_RULE.narrative, SESSION_RULE.narrativeNotClaim])
    assert.ok(flat(SONAH_SESSION_REVIEW_AGENT).includes(words), words);
  for (const words of [SESSION_RULE.challenge, SESSION_RULE.challengeNotClaim])
    assert.ok(flat(challenge.CLAIM_NOTE).includes(words), words);
  const built = prompt.buildNarrativePrompt({ session, window: { index: 0, events: session.events }, reviewScope: 'combined' });
  const task = flat(built.prompt.replace(built.evidencePrompt, ''));
  for (const words of [RULE.narrative, RULE.narrativeNotClaim, RULE.narrativeContract]) assert.ok(task.includes(words), words);
  for (const words of [BEFORE_REPAIR.narrative, BEFORE_REPAIR.narrativeContract]) assert.ok(!task.includes(words), words);
  assert.ok(!flat(built.evidencePrompt).includes(RULE.narrative), 'task text, never evidence');
  // The baselines' render-back fixture names exactly these moved texts, each once in the prompt as /14 sent it (H3's
  // texts rendered back first: its claims definition shares the relay rule's task lines).
  const sent14 = beforeHedgedClaims(built.prompt);
  for (const name of ['narrativeTask', 'narrativeContract'])
    assert.equal(sent14.split(RELAY_RULE_TEXT[name].after).length, 2, name);
  assert.ok(!flat(beforeRelayRule(sent14)).includes(RULE.narrative));
  assert.ok(flat(beforeRelayRule(sent14)).includes(BEFORE_REPAIR.narrative));
});

test('M33 H repair: the challengers judge a relay as the passing agent\'s own claim (sonah.challenge/10)', () => {
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
  // D103 moved it once more (sonah.challenge/45): a session-only batch shows the results its items cite whole.
  assert.equal(challenge.CHALLENGE_PROFILE.version, 'sonah.challenge/45');
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
  // D103 moved it once more (sonah.challenge/45): a session-only batch shows the results its items cite whole.
  assert.equal(reviewRun.runProfile('session-only').challenge.version, 'sonah.challenge/45');
  const system = flat(challenge.challengeSystem());
  for (const words of [RULE.challenge, RULE.challengeNotClaim]) assert.ok(system.includes(words), words);
  assert.ok(!system.includes(BEFORE_REPAIR.challenge));
  const sent11 = beforeHedgedClaims(challenge.challengeSystem()); // as /11 sent it (H3's texts rendered back first)
  assert.equal(sent11.split(RELAY_RULE_TEXT.challengeSystem.after).length, 2);
  assert.ok(flat(beforeRelayRule(sent11)).includes(BEFORE_REPAIR.challenge));
});

test('M33 H repair Claude Code: the parent passing on its helper\'s report by name is proposed (M35: withheld) beside the helper\'s FYI', async () => {
  const session = agentSession({ relay: 'attributed' });
  for (const profile of PROFILES) {
    const label = String(profile);
    const seen = [];
    const report = await followed(session, { helper: CLAIMS.helperSaid, relay: CLAIMS.attributed, seen }, { profile });
    assertAskedRule(seen, label);
    // M35 (RELAY_WITHHELD): the relay is proposed — the rule is asked — and withheld, its contradiction the helper's run.
    assert.deepEqual(outcomes(report), [['child:w:C1', 'FYI', 'helper_internal']], label);
    assert.equal(report.withheld.proposals, 1, label);
    const closing = await followed(session, { helper: CLAIMS.report, relay: CLAIMS.attributed }, { profile });
    assert.deepEqual(outcomes(closing), [['child:w:C3', 'FYI', 'helper_internal']], label);
    assert.equal(closing.withheld.proposals, 1, label);
    // The same reviewer and challengers sent the words of /12 and /9 (the recheck's probes): the relay is never proposed
    // (P02), and when it is, it is refuted (P03) — the false claim the human was told reached only the helper's FYI.
    for (const proposeRelay of [false, true]) {
      const before = await followed(session, { helper: CLAIMS.helperSaid, relay: CLAIMS.attributed },
        { profile, sentBefore: true, proposeRelay });
      assert.deepEqual(outcomes(before), [['child:w:C1', 'FYI', 'helper_internal']], `${label}: ${proposeRelay}`);
      assert.equal(before.sessionStatus, 'FYI', `${label}: ${proposeRelay}`);
    }
  }
});

test('M33 H repair, M35 Claude Code: with the helper\'s check unsettled, a relay contradicted only by its run decides nothing', async () => {
  const session = agentSession({ relay: 'attributed' });
  for (const profile of PROFILES) {
    const label = String(profile);
    // M35 (RELAY_WITHHELD): the relay is withheld before any challenge; the helper's own claim, unsettled, is FYI-bound.
    // The gap M33 H's relay rule closed (P04) is open again for a relay contradicted only by the helper's run.
    const relayed = await followed(session, { helper: CLAIMS.helperSaid, relay: CLAIMS.attributed,
      verdict: onClaimOf('child:w:C1', 'uncertain') }, { profile });
    assert.deepEqual(outcomes(relayed), [], label);
    assert.equal(relayed.withheld.unsettled, 1, `${label}: the helper's unsettled check is still counted`);
    assert.equal(relayed.withheld.proposals, 1, `${label}: the relay is counted as withheld`);
    assert.equal(ledger.decideUnsettledCount(relayed), 0, label);
  }
});

test('M33 H repair Codex: the parent passing on its helper\'s FINAL_ANSWER by name is proposed (M35: withheld)', async () => {
  const session = codexSession({ relay: CODEX_TEXT.attributed });
  const helperSaid = eventWith(session, 'commentary', CODEX_TEXT.helperSaid);
  const fail = eventWith(session, 'observation', CODEX_TEXT.fail);
  const relay = eventWith(session, 'commentary', CODEX_TEXT.attributed);
  assert.equal(relay.childId ?? null, null, 'premise: the parent\'s');
  const claim = (stated, quote) => ({ text: `The agent said: ${quote}`, stated: receipt(stated.id, 'commentary', quote),
    contradictedBy: receipt(fail.id, 'observation', CODEX_TEXT.fail) });
  for (const profile of PROFILES) {
    const label = String(profile);
    const seen = [];
    const report = await followed(session, { helper: claim(helperSaid, CODEX_TEXT.helperSaid),
      relay: claim(relay, CODEX_TEXT.attributed), seen }, { profile });
    assertAskedRule(seen, label);
    // M35 (RELAY_WITHHELD): proposed, and withheld; the helper's own statement stays FYI.
    assert.deepEqual(outcomes(report), [[helperSaid.id, 'FYI', 'helper_internal']], label);
    assert.equal(report.withheld.proposals, 1, label);
  }
});

test('M33 H repair Claude Code Workflow: the parent passing on its agent\'s report by name is proposed (M35: withheld)', async (t) => {
  const session = await workflowSession(t, { closing: WF.attributed });
  const premature = eventWith(session, 'commentary', WF.premature);
  const parentClaim = eventWith(session, 'commentary', WF.attributed);
  const failing = eventWith(session, 'observation', W.TEXT.failing);
  assert.equal(parentClaim.childId ?? null, null, 'premise: the parent\'s');
  const against = receipt(failing.id, 'observation', 'Tests: 1 failed, 11 passed, 12 total');
  const helper = { text: 'The fixer agent said all parser tests pass.', stated: receipt(premature.id, 'commentary', WF.premature),
    contradictedBy: against };
  const relay = { text: 'The agent passed on that all parser tests pass.', stated: receipt(parentClaim.id, 'commentary',
    'Per the fixer agent, all parser tests pass now'), contradictedBy: against };
  for (const profile of [null, 'm33-lean']) {
    const label = String(profile);
    const seen = [];
    const report = await followed(session, { helper, relay, seen }, { profile });
    assertAskedRule(seen, label);
    // M35 (RELAY_WITHHELD): proposed, and withheld; the agent's own statement stays FYI.
    assert.deepEqual(outcomes(report), [[premature.id, 'FYI', 'helper_internal']], label);
    assert.equal(report.withheld.proposals, 1, label);
  }
});

// ---- M33 H repair: the words say what the review did ------------------------------------------------------------------

// Ported from review.md's test (review.md is deleted, D97): the report labels a helper's words as a helper's, the
// parent's as the agent's, and its fixed words never say that everything the main agent said was reviewed.
test('M33 H repair: the report .md labels the helper\'s words "A helper said"; the parent\'s carry no helper label', async () => {
  // M35: the parent's statement is its own contradicted claim (RELAY_WITHHELD).
  const session = agentSession();
  const md = story.renderReportMarkdown(session, await reviewOf(session, [CLAIMS.helperSaid, CLAIMS.parentOnly]));
  assert.ok(md.includes(`${REPORT_ITEM_WORDS.helperSaid} “the nested parser tests pass now.”`), md);
  assert.ok(!md.includes(`${REPORT_ITEM_WORDS.agentSaid} “the nested parser tests pass now.”`));
  assert.ok(md.includes('\n“lint is clean.”') && !md.includes(`${REPORT_ITEM_WORDS.helperSaid} “lint is clean.”`), md);
  // Self-corrected too: the correction is the helper's own statement.
  const resolvedBy = { observation: R.pass, statement: R.helperFixed };
  const corrected = story.renderReportMarkdown(session, await reviewOf(agentSession({ corrected: true }),
    [{ ...CLAIMS.helperSaid, resolvedBy }]));
  assert.ok(!corrected.includes(`${REPORT_ITEM_WORDS.agentSaid} “after the second edit the parser tests pass.”`));
  // The fixed words never say that everything the main agent said was reviewed.
  for (const words of Object.values(REPORT_DISCLOSURE_WORDS.claim))
    assert.ok(!/anything the main agent told you/i.test(words), words);
});

test('M33 H repair, D71 (a), D97: the report .md lists every contradicted claim as an item, the helper\'s said as what it is', async () => {
  const session = agentSession();
  // M35: the parent's DECIDE is its own contradicted claim (RELAY_WITHHELD).
  for (const claims of [[CLAIMS.helperSaid, CLAIMS.parentOnly], [CLAIMS.helperSaid], [CLAIMS.parentOnly]]) {
    const told = story.renderReportMarkdown(session, await reviewOf(session, claims));
    assert.doesNotMatch(told, /Needs your decision|Worth a look|\bDECIDE\b|\bFYI\b/);
    assert.equal(told.split('contradicts a claim of the agent\'s.').length - 1, claims.length, told);
    assert.equal(told.includes(REPORT_DISCLOSURE_WORDS.claim.helper_internal), claims.includes(CLAIMS.helperSaid));
  }
});
