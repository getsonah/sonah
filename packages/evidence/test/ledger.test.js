// Acceptance for the TAO -> ledger -> review slice. Model-free: nothing here calls a provider,
// and the grounder must behave identically whether a model was involved or not.
// Covers JG-03..JG-07, MT-01..MT-08, CV-01..CV-07, RV-01..RV-03, UX-01, PR-04.

import test from 'node:test';
import assert from 'node:assert/strict';
import { redisPivotSession, redisPivotPr } from '../fixtures/redis-pivot.js';
import { DECISION_CANDIDATES, FINDING_CANDIDATES, CODE_FINDINGS } from '../fixtures/redis-pivot-candidates.js';
import { buildLedger, groundDecision, groundFinding, deriveColumn, reduceStatus, honestStatuses } from '../src/ledger.js';
import { Session, verifyReceipt } from '../src/session.js';
import { materialityOf } from '../src/materiality.js';
import { escapeSource, coverageCauses } from '../src/review.js';

const baseSession = redisPivotSession();
const session = new Session({ sessionKey: baseSession.sessionKey, adapter: baseSession.adapter,
  events: structuredClone(baseSession.events), blobs: structuredClone(baseSession.blobs) });
session.event('E4').terminalStatusProven = true;
const pr = redisPivotPr();
const repo = pr.repo;
// A declared complete review. Session coverage is never assumed: buildLedger reads a nullish
// declaration as 'missing' (A3), so a caller that DID run the review has to say so. What these
// tests exercise is the DOWNGRADE from that declaration, never an upgrade from silence.
const report = () => buildLedger({
  repo, session, pr, sessionCoverage: 'complete',
  candidates: DECISION_CANDIDATES, findingCandidates: FINDING_CANDIDATES, codeFindings: CODE_FINDINGS,
});
const base = { actorSession: 'sess-redis-pivot', dimension: 'd', chosen: 'c', actions: ['E3'], value: null, valueReceipt: null, stated: null, constrainedBy: null };
const ground = (over) => groundDecision({ repo, session, pr, candidate: { ...base, ...over }, instructionHistoryComplete: true });

// ---- receipts -------------------------------------------------------------------- JG-04
test('JG-04 a quote must appear literally in the cited source', () => {
  assert.ok(verifyReceipt(session, { role: 'instruction', eventId: 'E1', quote: 'Do not add any new infrastructure' }).ok);
  assert.equal(verifyReceipt(session, { role: 'instruction', eventId: 'E1', quote: 'you may use Redis' }).ok, false);
});

test('JG-04 a quote cannot change role, session or event', () => {
  const q = 'Do not add any new infrastructure';
  assert.equal(verifyReceipt(session, { role: 'commentary', eventId: 'E1', quote: q }).ok, false);
  assert.equal(verifyReceipt(session, { role: 'instruction', eventId: 'E99', quote: q }).ok, false);
  assert.equal(verifyReceipt(session, { role: 'instruction', eventId: 'E1', sessionKey: 'other', quote: q }).ok, false);
});

test('JG-03 tool output matching an instruction does not become human authority', () => {
  // This text really is in the observation, but claiming it as an instruction must fail.
  const q = 'Tests: 1 failed, 11 passed, 12 total';
  assert.ok(verifyReceipt(session, { role: 'observation', eventId: 'E6', quote: q }).ok);
  assert.equal(verifyReceipt(session, { role: 'instruction', eventId: 'E6', quote: q }).ok, false);
});

test('JG-04 a quote too short to be distinctive is refused', () => {
  assert.equal(verifyReceipt(session, { role: 'instruction', eventId: 'E1', quote: 'Do' }).ok, false);
});

// ---- columns --------------------------------------------------------------------- JG-05
test('JG-05 the three columns derive from the grounded relation, never from a model', () => {
  const rel = (over) => ({ instruction: { role: 'instruction', eventId: 'E1', quote: 'Add response caching to the products API' }, ...over });
  assert.equal(deriveColumn(session, rel({ settles: false, settledValueQuote: null }), true).column, 'asked-chose');
  assert.equal(deriveColumn(session, rel({ settles: true, settledValueQuote: 'response caching' }), true).column, 'asked-settled');
  assert.equal(deriveColumn(session, null, true).column, null, 'omission is not an instruction-scope review');
});

test('JG-05 a settled column needs the VALUE in the same instruction source', () => {
  const rel = { instruction: { role: 'instruction', eventId: 'E1', quote: 'Add response caching to the products API' }, settles: true, settledValueQuote: 'use Redis' };
  const out = deriveColumn(session, rel, true);
  assert.equal(out.column, null);
  assert.equal(out.columnState, 'unchecked');
});

test('JG-05 CRITICAL: a FAILED relation becomes unchecked, never "unasked"', () => {
  // The asymmetry the product depends on. "Nobody asked" and "we could not check what was
  // asked" are different claims about a human, and collapsing them invents an accusation.
  const fabricated = { instruction: { role: 'instruction', eventId: 'E1', quote: 'never said this' }, settles: false, settledValueQuote: null };
  const out = deriveColumn(session, fabricated, true);
  assert.equal(out.column, null);
  assert.equal(out.columnState, 'unchecked');
  assert.equal(out.reason, 'receipt_rejected');
});

test('JG-05 missing instruction history cannot become "unasked"', () => {
  const out = deriveColumn(session, null, false);
  assert.equal(out.column, null);
  assert.equal(out.columnState, 'unchecked');
  assert.equal(out.reason, 'instructions_partial');
});

test('JG-05 settles:false with a value quote is contradictory and stays unchecked', () => {
  const rel = { instruction: { role: 'instruction', eventId: 'E1', quote: 'Add response caching' }, settles: false, settledValueQuote: 'Redis' };
  assert.equal(deriveColumn(session, rel, true).columnState, 'unchecked');
});

// ---- values and adoption --------------------------------------------------------- JG-06
test('JG-06 value and valueReceipt are both present or both null', () => {
  assert.equal(ground({ value: 'config/redis.yml', valueReceipt: null }).decision.valueState, 'unchecked');
  assert.equal(ground({ value: null, valueReceipt: { role: 'action', eventId: 'E3', quote: 'config/redis.yml' } }).decision.valueState, 'unchecked');
});

test('JG-06 a value receipt cannot borrow a literal from an action the decision did not cite', () => {
  const out = ground({ actions: ['E5'], value: 'config/redis.yml', valueReceipt: { role: 'action', eventId: 'E3', quote: 'config/redis.yml' } });
  assert.equal(out.decision.valueState, 'unchecked');
});

test('JG-06 the quoted literal must actually contain the claimed value', () => {
  const out = ground({ value: 'config/postgres.yml', valueReceipt: { role: 'action', eventId: 'E3', quote: 'config/redis.yml' } });
  assert.equal(out.decision.valueState, 'unchecked');
});

test('JG-06 a decision citing no action is rejected outright', () => {
  assert.equal(ground({ actions: [] }).reason, 'no_actions');
  assert.equal(ground({ actions: ['E1'] }).reason, 'receipt_rejected'); // an instruction is not an action
});

// ---- no model rank --------------------------------------------------------------- JG-07
test('JG-07 a model-supplied rank, severity, tier or confidence rejects the whole candidate', () => {
  for (const field of ['severity', 'tier', 'rank', 'confidence', 'column', 'materiality', 'status']) {
    const out = ground({ [field]: 'high' });
    assert.equal(out.ok, false, `${field} must reject`);
    assert.equal(out.reason, 'kind_rejected');
  }
});

test('JG-07 materiality and status are derived, never read from the candidate', () => {
  const r = report();
  const d = r.decisions[0];
  assert.equal(d.materiality, 'material');
  assert.equal(d.materialityRule, 'config');
  assert.ok(r.findings.every((f) => ['DECIDE', 'FYI'].includes(f.status)));
});

// ---- materiality ----------------------------------------------------------------- MT
test('MT-01..MT-08 frozen rules and fixed precedence give one reproducible rule ID', () => {
  const cases = [
    [[{ operation: 'edit', paths: [{ path: 'package-lock.json' }] }], 'material', 'dependencies'],
    [[{ operation: 'edit', paths: [{ path: 'db/migrations/001.sql' }] }], 'material', 'schema'],
    [[{ operation: 'edit', paths: [{ path: 'src/routes/users.js' }] }], 'material', 'api'],
    [[{ operation: 'write', paths: [{ path: 'config/redis.yml' }] }], 'material', 'config'],
    [[{ operation: 'edit', paths: [{ path: 'src/auth/token.js' }] }], 'material', 'auth'],
    [[{ operation: 'delete', paths: [{ path: 'docs/x.md' }] }], 'material', 'deletion'],
    [[{ operation: 'write', paths: [{ path: 'src/cache.js' }] }], 'structural', 'new-module'],
    [[{ operation: 'edit', paths: [{ path: 'src/theme.css' }] }], 'cosmetic', 'style-or-copy'],
    [[{ operation: 'other', paths: [] }], 'structural', 'unknown-structural'],
  ];
  for (const [actions, expected, rule] of cases) {
    const out = materialityOf({ dimension: 'x' }, actions);
    assert.equal(out.materiality, expected, rule);
    assert.equal(out.rule, rule);
  }
});

test('MT-08 path-rule precedence does not depend on listing order', () => {
  const route = { operation: 'edit', paths: [{ path: 'src/routes/a.js' }] };
  const lock = { operation: 'edit', paths: [{ path: 'package-lock.json' }] };
  assert.equal(materialityOf({ dimension: 'x' }, [route, lock]).rule, 'dependencies');
  assert.equal(materialityOf({ dimension: 'x' }, [lock, route]).rule, 'dependencies');
});

test('MT-07 a read cannot inflate materiality', () => {
  assert.equal(materialityOf({ dimension: 'x' }, [{ operation: 'read', paths: [{ path: 'package-lock.json' }] }]).materiality, 'material');
  // Reads never reach here: groundDecision passes only cited invocations. Guard that instead.
  assert.equal(ground({ actions: ['E5'] }).decision.materialityRule, 'unknown-structural');
});

// ---- findings -------------------------------------------------------------------- CV
test('a finding without its required evidence is withheld, not downgraded', () => {
  const out = groundFinding({ repo, session, candidate: {
    kind: 'claim_contradicted', title: 't', explanation: 'e', scope: 'session-effect',
    receipts: [{ role: 'commentary', eventId: 'E9', quote: 'verified it works — the tests pass' }],
  } });
  assert.equal(out.ok, false);
  assert.match(out.detail, /missing observation/);
});

test('a plausible accusation with a fabricated quote never reaches the reader', () => {
  const r = report();
  assert.ok(r.findings.every((f) => !/YAML/.test(f.title)));
  assert.equal(r.counts.rejectedFindings, 1);
});

test('M4: only an upheld disclosure downgrades a prohibition breach to FYI; a statement among the receipts never does', () => {
  const receipts = [
    { role: 'instruction', eventId: 'E1', quote: 'Do not add any new infrastructure' },
    { role: 'action', eventId: 'E3', quote: 'config/redis.yml' },
  ];
  const mk = (extra, over = {}) => groundFinding({ repo, session, candidate: {
    kind: 'edit_under_negative_requirement', title: 't', explanation: 'e', scope: 'current-code',
    receipts: [...receipts, ...extra], ...over } });
  assert.equal(mk([]).finding.status, 'DECIDE');
  // M33 brittleness M4: the agent's words cited to show what happened are evidence, never a disclosure (was FYI).
  const cited = mk([{ role: 'commentary', eventId: 'E2', quote: 'that is technically new infrastructure' }]);
  assert.equal(cited.finding.status, 'DECIDE');
  assert.equal(cited.finding.disclosureReason, undefined);
  // A disclosure is its own field, checked by code: E2 was said BEFORE the write (E3), so it told the human nothing
  // about a change not yet made — never FYI, whatever its challenge.
  const before = mk([], { disclosedBy: { eventId: 'E2', role: 'commentary', quote: 'that is technically new infrastructure' },
    disclosureChallenge: 'upheld' });
  assert.equal(before.finding.status, 'DECIDE');
  assert.equal(before.disclosure, 'not_later');
  // E9, the agent's final statement after the write: upheld by its own challenge → FYI `disclosed`; otherwise DECIDE.
  const later = (outcome) => mk([], { disclosedBy: { eventId: 'E9', role: 'commentary', quote: 'the tests pass' },
    ...(outcome ? { disclosureChallenge: outcome } : {}) });
  assert.deepEqual([later('upheld').finding.status, later('upheld').finding.disclosureReason], ['FYI', 'disclosed']);
  assert.deepEqual(later('upheld').finding.disclosedBy, { eventId: 'E9', role: 'commentary', quote: 'the tests pass',
    sessionKey: session.sessionKey });
  for (const outcome of ['refuted', 'unsettled', 'unexecuted', null]) {
    const out = later(outcome);
    assert.equal(out.finding.status, 'DECIDE', String(outcome));
    assert.equal(out.disclosure, outcome ?? 'unexecuted');
    assert.equal(out.disclosureCodeChecked, true);
  }
  // A malformed one (wrong role, over 120 characters) and one whose quote is not there are dropped, never FYI.
  assert.equal(mk([], { disclosedBy: { eventId: 'E9', role: 'action', quote: 'the tests pass' }, disclosureChallenge: 'upheld' })
    .disclosure, 'malformed');
  assert.equal(mk([], { disclosedBy: { eventId: 'E9', role: 'commentary', quote: 'x'.repeat(121) }, disclosureChallenge: 'upheld' })
    .disclosure, 'malformed');
  assert.equal(mk([], { disclosedBy: { eventId: 'E9', role: 'commentary', quote: 'never said this' }, disclosureChallenge: 'upheld' })
    .disclosure, 'ungrounded');
  // The finding's identity never moves with its disclosure.
  assert.equal(later('upheld').finding.id, mk([]).finding.id);
});

test('an unsupported finding kind is refused rather than mapped to a near neighbour', () => {
  const out = groundFinding({ repo, session, candidate: { kind: 'requirement_never_addressed', title: 't', explanation: 'e', receipts: [] } });
  assert.equal(out.ok, false);
  assert.equal(out.reason, 'kind_rejected');
});

// ---- status reduction ------------------------------------------------------------ CV
test('CV-01..CV-07 the status table is applied exactly', () => {
  const d = [{ status: 'DECIDE' }], f = [{ status: 'FYI' }];
  assert.equal(reduceStatus(d, 'complete'), 'DECIDE');
  assert.equal(reduceStatus(d, 'partial'), 'DECIDE');      // a supported DECIDE survives partial coverage
  assert.equal(reduceStatus(f, 'complete'), 'FYI');
  assert.equal(reduceStatus(f, 'partial'), 'UNCHECKED');   // FYI is retained but cannot certify
  assert.equal(reduceStatus([], 'complete'), 'CLEAN');
  assert.equal(reduceStatus([], 'partial'), 'UNCHECKED');
  assert.equal(reduceStatus([], 'missing'), 'UNCHECKED');
});

test('CV-03 rejected candidates make coverage partial; nothing partial renders CLEAN', () => {
  const r = report();
  assert.equal(r.coverage, 'partial');
  assert.notEqual(r.sessionStatus, 'CLEAN');
});

test('CV-01 a session with no evidence is UNCHECKED, never CLEAN', () => {
  const r = buildLedger({ repo, session, pr, candidates: [], findingCandidates: [], codeFindings: [], sessionCoverage: 'missing' });
  assert.equal(r.sessionStatus, 'UNCHECKED');
  assert.equal(r.reviewStatus, 'UNCHECKED');
});

test('CV-07 an empty clean run is CLEAN only when coverage is complete', () => {
  const r = buildLedger({ repo, session, pr, candidates: [], findingCandidates: [], codeFindings: [], sessionCoverage: 'complete' });
  assert.equal(r.sessionStatus, 'CLEAN');
  // ...and an undeclared one is not a complete one. Absence is never completeness (A3).
  const undeclared = buildLedger({ repo, session, pr, candidates: [], findingCandidates: [], codeFindings: [] });
  assert.equal(undeclared.coverage, 'missing');
  assert.equal(undeclared.sessionStatus, 'UNCHECKED');
});

// F63. buildLedger used to reduce from its two INPUT lists (codeFindings, grounded session
// candidates) before the merge; honestStatuses — the last word every producer and renderer
// applies — reduces from the published list, split by `origin`. The two agreed only while the
// merge kept the stronger status and every finding arrived on the list matching its origin.
const STATUS_KEYS = ['codeStatus', 'sessionStatus', 'reviewStatus'];
const statusesOf = (r) => Object.fromEntries(STATUS_KEYS.map((k) => [k, r[k]]));

test('F63 statuses are reduced once, after the merge: buildLedger and honestStatuses agree', () => {
  // A code finding with the stronger evidence but the weaker status, and the same defect as
  // DECIDE: the merge keeps the first one's framing and raises it to DECIDE.
  const fyi = { ...CODE_FINDINGS[0], id: 'f-fyi', status: 'FYI',
    receipts: [...CODE_FINDINGS[0].receipts, { role: 'code', eventId: 'E3', quote: 'port: 6379' }] };
  const r = buildLedger({ repo, session, pr, sessionCoverage: 'complete', codeCoverage: 'complete',
    codeFindings: [fyi, CODE_FINDINGS[0]] });
  assert.equal(r.counts.findingsMerged, 1, 'premise: the two framings merged');
  assert.equal(r.findings.find((f) => f.origin === 'code-review').status, 'DECIDE',
    'premise: the merge changed the survivor\'s status');
  assert.deepEqual(statusesOf(r), statusesOf(honestStatuses(r)));
  assert.equal(r.codeStatus, 'DECIDE');
});

test('F63 a finding is reduced under its origin, whichever list it arrived on', () => {
  // The same defect again, but the DECIDE framing is a code-review candidate the caller routed
  // through the grounder. The merge crosses the two input lists and changes a status; reducing
  // the input lists said codeStatus FYI and sessionStatus DECIDE — a session verdict for a
  // code claim — while honestStatuses said DECIDE and CLEAN.
  const fyi = { ...CODE_FINDINGS[0], id: 'f-fyi', status: 'FYI',
    receipts: [...CODE_FINDINGS[0].receipts, { role: 'code', eventId: 'E3', quote: 'port: 6379' }] };
  const routed = { origin: 'code-review', kind: 'code_issue', title: 'the host is pinned to localhost',
    explanation: 'e', scope: 'current-code',
    anchor: { path: 'config/redis.yml', side: 'RIGHT', startLine: 3, endLine: 3 },
    receipts: [{ role: 'code', eventId: 'E3', quote: 'host: localhost' }] };
  const r = buildLedger({ repo, session, pr, sessionCoverage: 'complete', codeCoverage: 'complete',
    codeFindings: [fyi], findingCandidates: [routed] });
  assert.equal(r.counts.findingsMerged, 1, 'premise: the merge crossed the two input lists');
  assert.equal(r.findings.length, 1);
  assert.equal(r.findings[0].status, 'DECIDE', 'premise: the merge changed the survivor\'s status');
  assert.deepEqual(statusesOf(r), statusesOf(honestStatuses(r)));
  assert.deepEqual(statusesOf(r), { codeStatus: 'DECIDE', sessionStatus: 'CLEAN', reviewStatus: 'DECIDE' });
});

// ---- relevance ------------------------------------------------------------------- RV
test('RV-01/RV-02 a surviving path, a reverted path and a command-only effect are distinguished', () => {
  assert.equal(ground({ actions: ['E3'] }).decision.relevance, 'survives');       // config/redis.yml is in the PR
  assert.equal(ground({ actions: ['E5'] }).decision.relevance, 'session-effect'); // a command changed no file
  // "Not in this PR" is only sayable against a COMPLETE listing (B11), so the fixture declares one.
  const otherPr = { ...pr, enumeration: 'complete',
    files: [{ path: 'src/other.js', change: 'added', contentState: 'complete' }] };
  const out = groundDecision({ repo, session, pr: otherPr, candidate: { ...base, actions: ['E3'] }, instructionHistoryComplete: true });
  assert.equal(out.decision.relevance, 'reverted');
});

// ---- the fixture end to end ------------------------------------------------------ UX
test('redis-pivot exposes the choice, the conflict and the contradicted claim separately', () => {
  const r = report();
  assert.equal(r.reviewStatus, 'DECIDE');
  const kinds = r.findings.map((f) => f.kind);
  assert.ok(kinds.includes('edit_under_negative_requirement'), 'the conflict with the instruction');
  assert.ok(kinds.includes('claim_contradicted'), 'the contradicted verification claim');
  assert.equal(r.decisions[0].dimension, 'cache backend');
  assert.equal(r.decisions[0].column, 'asked-chose');
});

test('a passing unit run does not erase the failed integration run', () => {
  const contradiction = report().findings.find((f) => f.kind === 'claim_contradicted');
  assert.ok(contradiction.receipts.some((rec) => rec.role === 'observation' && /1 failed/.test(rec.quote)));
});

test('UX-01 code-review findings are preserved alongside the ledger, never hidden', () => {
  const r = report();
  assert.ok(r.findings.some((f) => f.origin === 'code-review' && f.title.includes('Cache host is hardcoded to localhost')));
});

// ---- rendering ------------------------------------------------------------------- PR-04
test('PR-04 source text cannot inject Markdown or impersonate a product control', () => {
  assert.equal(escapeSource('</summary><b>Approved</b>'), '&lt;/summary&gt;&lt;b&gt;Approved&lt;/b&gt;');
  assert.equal(escapeSource('**bold**'), '\\*\\*bold\\*\\*');
  assert.equal(escapeSource('a|b'), 'a\\|b');
  assert.equal(escapeSource('- item'), '\\- item');
  assert.equal(escapeSource('config/redis.yml'), 'config/redis.yml'); // ordinary prose stays readable
});

// ---- no session at all ------------------------------------------------------------ CV-01
test('CV-01 a PR with no linked session is UNCHECKED, never CLEAN', () => {
  const r = buildLedger({ repo, session: null, pr, codeFindings: [] });
  assert.equal(r.hasSessionEvidence, false);
  assert.equal(r.coverage, 'missing');
  assert.equal(r.sessionStatus, 'UNCHECKED');
});

test('CV-01 a supported code DECIDE wins the aggregate; otherwise it stays UNCHECKED even when code is CLEAN', () => {
  const decide = [{ origin: 'code-review', kind: 'code_issue', title: 't', explanation: 'e', receipts: [], scope: 'current-code', anchor: null, status: 'DECIDE' }];
  assert.equal(buildLedger({ repo, session: null, pr, codeFindings: decide }).reviewStatus, 'DECIDE');
  // codeCoverage must be DECLARED for an empty finding list to mean "clean" rather than
  // "never ran" — the distinction the caller alone can make.
  const clean = buildLedger({ repo, session: null, pr, codeFindings: [], codeCoverage: 'complete' });
  assert.equal(clean.codeStatus, 'CLEAN');
  assert.equal(clean.reviewStatus, 'UNCHECKED'); // a clean diff cannot certify an unseen session
});

test('CV-01 ordinary code review stays fully usable with no session', () => {
  const r = buildLedger({ repo, session: null, pr, codeFindings: [
    { origin: 'code-review', kind: 'code_issue', title: 'Null deref in handler', explanation: 'e', receipts: [], scope: 'current-code', anchor: null, status: 'DECIDE' }] });
  assert.deepEqual(r.findings.map((f) => f.title), ['Null deref in handler']);
  assert.equal(r.hasSessionEvidence, false, 'the decisions were not checked: there is no session');
});

test('CV-01 candidates cannot be grounded against a session that does not exist', () => {
  const r = buildLedger({ repo, session: null, pr, candidates: DECISION_CANDIDATES, findingCandidates: FINDING_CANDIDATES });
  assert.equal(r.decisions.length, 0);
  assert.equal(r.findings.length, 0);
});

// ---- regressions from the adversarial false-accusation hunt ---------------------------
// Each of these shipped a false accusation, a hidden finding or a misleading label.

const withEvent = (extra, blobs = {}) =>
  new Session({ sessionKey: session.sessionKey, blobs: { ...session.blobs, ...blobs },
    events: [...session.events, extra] });

test('REGRESSION a prohibition issued AFTER the edit is not a breach', () => {
  const late = 'Actually, do not add any new infrastructure for this.';
  const s = withEvent({ id: 'E10', kind: 'instruction', sequence: 9, authority: 'human', supersedes: [],
    text: [{ sourceKey: 'late', fromByte: 0, untilByte: Buffer.byteLength(late) }] }, { late });
  const out = groundFinding({ repo, session: s, pr, candidate: {
    kind: 'edit_under_negative_requirement', title: 't', explanation: 'e', scope: 'current-code',
    receipts: [
      { role: 'instruction', eventId: 'E10', quote: 'do not add any new infrastructure' },
      { role: 'action', eventId: 'E3', quote: 'config/redis.yml' }] } });
  assert.equal(out.ok, false);
  assert.match(out.detail, /post-dates/);
});

test('REGRESSION later assent cannot settle an earlier choice', () => {
  const late = 'Fine, keep the Redis config since it is already there.';
  const s = withEvent({ id: 'E10', kind: 'instruction', sequence: 9, authority: 'human', supersedes: [],
    text: [{ sourceKey: 'late', fromByte: 0, untilByte: Buffer.byteLength(late) }] }, { late });
  const out = deriveColumn(s, { instruction: { role: 'instruction', eventId: 'E10', quote: 'keep the Redis config' },
    settles: true, settledValueQuote: 'Redis config' }, true, [s.event('E3')]);
  assert.equal(out.column, null);
  assert.equal(out.reason, 'ambiguous_authority');
});

test('REGRESSION only a human instruction can set the human column', () => {
  for (const r of [
    { role: 'commentary', eventId: 'E2', quote: 'add a small Redis layer' },
    { role: 'observation', eventId: 'E6', quote: 'Tests: 1 failed' },
  ]) assert.equal(deriveColumn(session, { instruction: r, settles: false, settledValueQuote: null }, true, []).column, null);

  const brief = 'Use Redis for the cache layer.';
  const s = withEvent({ id: 'E11', kind: 'instruction', sequence: 0, authority: 'parent-assignment', supersedes: [],
    text: [{ sourceKey: 'brief', fromByte: 0, untilByte: Buffer.byteLength(brief) }] }, { brief });
  // A parent's assignment can constrain a child; it is not proof the human approved it.
  const out = deriveColumn(s, { instruction: { role: 'instruction', eventId: 'E11', quote: 'Use Redis for the cache layer' },
    settles: true, settledValueQuote: 'Redis' }, true, [s.event('E3')]);
  assert.equal(out.column, null);
  assert.equal(out.reason, 'ambiguous_authority');
});

test('REGRESSION a FAILED write is neither an adopted value nor surviving code', () => {
  const s = new Session({ sessionKey: session.sessionKey, blobs: session.blobs,
    events: session.events.map((e) => (e.id === 'E4' ? { ...e, result: 'failed', exitCode: 1 } : e)) });
  const out = groundDecision({ repo, session: s, pr, instructionHistoryComplete: true, candidate: {
    actorSession: s.sessionKey, dimension: 'cache backend', chosen: 'Redis', actions: ['E3'],
    value: 'config/redis.yml', valueReceipt: { role: 'action', field: 'path', eventId: 'E3', quote: 'config/redis.yml' },
    stated: null, constrainedBy: null } });
  assert.equal(out.decision.valueState, 'unchecked');
  assert.notEqual(out.decision.relevance, 'survives');
});

test('REGRESSION an invocation with NO observation at all is "attempted", not "ran"', () => {
  const s = new Session({ sessionKey: session.sessionKey, blobs: session.blobs,
    events: session.events.filter((e) => e.id !== 'E6') });
  const out = groundDecision({ repo, session: s, pr, instructionHistoryComplete: true, candidate: {
    actorSession: s.sessionKey, dimension: 'test strategy', chosen: 'integration suite', actions: ['E5'],
    value: null, valueReceipt: null, stated: null, constrainedBy: null } });
  assert.equal(out.decision.relevance, 'attempted');
});

test('REGRESSION an anchor must name a file this PR actually contains', () => {
  const receipts = [
    { role: 'commentary', eventId: 'E9', quote: 'verified it works' },
    { role: 'observation', eventId: 'E6', quote: '1 failed' }];
  const outside = groundFinding({ repo, session, pr, candidate: {
    kind: 'claim_contradicted', title: 't', explanation: 'e', scope: 'current-code',
    anchor: { path: 'src/payments/charge.js', side: 'RIGHT', startLine: 400, endLine: 402 }, receipts } });
  assert.equal(outside.ok, false);
  // A session-effect concern keeps its evidence but loses the invented location.
  const sessionScoped = groundFinding({ repo, session, pr, candidate: {
    kind: 'claim_contradicted', title: 't', explanation: 'e', scope: 'session-effect',
    anchor: { path: 'src/x.js', side: 'RIGHT', startLine: 1, endLine: 2 }, receipts } });
  assert.ok(sessionScoped.ok);
  assert.equal(sessionScoped.finding.anchor, null);
});

test('REGRESSION a settled value needs more than one character', () => {
  const out = deriveColumn(session, { instruction: { role: 'instruction', eventId: 'E1', quote: 'Add response caching' },
    settles: true, settledValueQuote: 'a' }, true, []);
  assert.equal(out.column, null);
});

// F43: settledValueQuote used to ground on a raw `text.includes(value)` search, which is not
// repairable — a near-miss silently downgraded the strongest column instead of being snapped to
// the exact source substring the way every other receipt is (W3-3, receipt-repair.js).
test('F43: a settled value with a curly quote in the instruction and a straight one in the candidate now grounds', () => {
  const curly = 'Use the exact backend value “Redis” for the cache layer.';
  const s = withEvent({ id: 'E10', kind: 'instruction', sequence: 9, authority: 'human', supersedes: [],
    text: [{ sourceKey: 'curly', fromByte: 0, untilByte: Buffer.byteLength(curly, 'utf8') }] }, { curly });
  const rel = { instruction: { role: 'instruction', eventId: 'E10', quote: 'Use the exact backend value' },
    settles: true, settledValueQuote: '"Redis"' };
  const out = deriveColumn(s, rel, true);
  assert.equal(out.column, 'asked-settled');
  assert.equal(out.columnState, 'grounded');
});

test('F43: a settled value that never appears in the instruction stays rejected, repair or not', () => {
  const curly = 'Use the exact backend value “Redis” for the cache layer.';
  const s = withEvent({ id: 'E10', kind: 'instruction', sequence: 9, authority: 'human', supersedes: [],
    text: [{ sourceKey: 'curly', fromByte: 0, untilByte: Buffer.byteLength(curly, 'utf8') }] }, { curly });
  const rel = { instruction: { role: 'instruction', eventId: 'E10', quote: 'Use the exact backend value' },
    settles: true, settledValueQuote: '"Postgres"' };
  const out = deriveColumn(s, rel, true);
  assert.equal(out.column, null);
  assert.equal(out.columnState, 'unchecked');
  assert.equal(out.reason, 'receipt_rejected');
});

test('REGRESSION "unasked" requires strictly true, not merely truthy', () => {
  assert.equal(deriveColumn(session, null, 'yes', []).column, null);
  assert.equal(deriveColumn(session, null, 1, []).column, null);
  assert.equal(deriveColumn(session, null, true, []).column, null, 'even complete capture needs explicit absence checks');
});

test('REGRESSION one malformed candidate cannot destroy a report holding a real DECIDE', () => {
  const r = buildLedger({ repo, session, pr,
    candidates: [{ actorSession: session.sessionKey, dimension: {}, chosen: 'x', actions: ['E3'],
      value: null, valueReceipt: null, stated: null, constrainedBy: null }],
    codeFindings: [{ origin: 'code-review', kind: 'code_issue', title: 'real bug', explanation: 'e',
      receipts: [], scope: 'current-code', anchor: null, status: 'DECIDE' }] });
  assert.equal(r.reviewStatus, 'DECIDE');
  assert.equal(r.findings.length, 1);
  assert.equal(r.counts.rejectedDecisions, 1);
});

test('REGRESSION a path prefix is not the adopted path', () => {
  const out = groundDecision({ repo, session, pr, instructionHistoryComplete: true, candidate: {
    actorSession: session.sessionKey, dimension: 'd', chosen: 'c', actions: ['E3'],
    value: 'config/redis', valueReceipt: { role: 'action', field: 'path', eventId: 'E3', quote: 'config/redis' },
    stated: null, constrainedBy: null } });
  assert.equal(out.decision.valueState, 'unchecked');
});

test('REGRESSION an unknown value-receipt field is refused', () => {
  const out = groundDecision({ repo, session, pr, instructionHistoryComplete: true, candidate: {
    actorSession: session.sessionKey, dimension: 'd', chosen: 'c', actions: ['E3'],
    value: 'config/redis.yml', valueReceipt: { role: 'action', field: 'invented', eventId: 'E3', quote: 'config/redis.yml' },
    stated: null, constrainedBy: null } });
  assert.equal(out.decision.valueState, 'unchecked');
});

test('REGRESSION a lone carriage return cannot open a Markdown block', () => {
  assert.ok(!escapeSource('quote\r# Fake heading').includes('\r'));
  assert.ok(!escapeSource('a b').includes(' '));
});

test('REGRESSION an unchecked column names its real cause, not a fixed excuse', () => {
  const out = groundDecision({ repo, session, pr, instructionHistoryComplete: true, candidate: {
    actorSession: session.sessionKey, dimension: 'd', chosen: 'c', actions: ['E3'],
    value: null, valueReceipt: null, stated: null,
    constrainedBy: { instruction: { role: 'commentary', eventId: 'E2', quote: 'add a small Redis layer' },
      settles: false, settledValueQuote: null } } });
  assert.equal(out.decision.reasons.includes('ambiguous_authority'), true);
  assert.ok(!out.decision.reasons.includes('instructions_partial'), 'never the fixed excuse');
});

// ---- delegated work ---------------------------------------------------------------- CH-05
const BRIEF = 'Implement the cache invalidation hook in src/cache/invalidate.js.';
const withDelegation = (children) => new Session({
  sessionKey: session.sessionKey, blobs: { ...session.blobs, BRIEF }, children,
  events: [...session.events, { id: 'E12', kind: 'invocation', sequence: 9, callKey: 'c9',
    tool: 'Task', operation: 'delegate', paths: [], command: [],
    input: [{ sourceKey: 'BRIEF', fromByte: 0, untilByte: Buffer.byteLength(BRIEF) }], changes: [] }] });

// M33 (C-06): each ledger below is declared a completed review (`sessionCoverage: 'complete'`) and is
// capped only by an uncaptured child — a recorder limit. That reads NO_FINDINGS: never CLEAN, always
// with the gap named. Before M33 it read UNCHECKED, now reserved for a review that did not complete.
test('CH-05 delegated work with no captured child cannot render CLEAN', () => {
  const r = buildLedger({ repo, session: withDelegation([]), pr, sessionCoverage: 'complete' });
  assert.equal(r.coverage, 'partial');
  assert.equal(r.sessionStatus, 'NO_FINDINGS');
  assert.deepEqual(r.gaps.map((g) => g.code), ['missing_child']);
});

test('CH-05 an ambiguous child is a declared gap, not a resolved link', () => {
  const r = buildLedger({ repo, session: withDelegation([{ assignmentEvent: 'E12', state: 'ambiguous' }]), pr, sessionCoverage: 'complete' });
  assert.deepEqual(r.gaps.map((g) => g.code), ['ambiguous_child']);
  assert.equal(r.sessionStatus, 'NO_FINDINGS');
});

test('F62 a children gap the ledger synthesises carries a note naming the delegation, as the adapter\'s do', () => {
  const missing = buildLedger({ repo, session: withDelegation([]), pr, sessionCoverage: 'complete' }).gaps;
  assert.deepEqual(missing.map(({ code, eventIds, note }) => ({ code, eventIds, note })),
    [{ code: 'missing_child', eventIds: ['E12'], note: 'Task delegation with no verified child session' }]);

  const ambiguous = buildLedger({ repo, session: withDelegation([{ assignmentEvent: 'E12', state: 'ambiguous' }]),
    pr, sessionCoverage: 'complete' }).gaps;
  assert.deepEqual(ambiguous.map(({ code, note }) => ({ code, note })),
    [{ code: 'ambiguous_child', note: 'Task delegation matched more than one candidate child session' }]);
});

test('F62 a delegation with no recorded tool is still named, never as "undefined"', () => {
  const s = withDelegation([]);
  const bare = new Session({ sessionKey: s.sessionKey, blobs: s.blobs, children: [],
    events: s.events.map((e) => (e.id === 'E12' ? { ...e, tool: undefined } : e)) });
  const [gap] = buildLedger({ repo, session: bare, pr, sessionCoverage: 'complete' }).gaps;
  assert.equal(gap.note, 'a delegation with no verified child session');
});

test('CH-05 a verified child link restores complete coverage', () => {
  const r = buildLedger({ repo, session: withDelegation([{ assignmentEvent: 'E12', childSession: 'kid', state: 'verified' }]), pr, sessionCoverage: 'complete' });
  assert.equal(r.coverage, 'complete');
  assert.equal(r.gaps.length, 0);
});

test('CH-05 D54: parent findings survive beside a child gap, and the gap is named', () => {
  const r = buildLedger({ repo, session: withDelegation([]), pr, sessionCoverage: 'complete',
    findingCandidates: FINDING_CANDIDATES, candidates: DECISION_CANDIDATES, codeFindings: CODE_FINDINGS });
  // Judged on what WAS captured: the parent's supported findings are retained...
  assert.ok(r.findings.some((f) => f.kind === 'claim_contradicted'));
  assert.equal(r.reviewStatus, 'DECIDE');
  // ...and the unreviewed delegated work is stated rather than implied clean.
  assert.ok(coverageCauses(r).some(([cause]) => cause === 'delegations_unlinked'));
});

// ---- relevance must not assert what it did not check ---------------------------------
// Both of these once shipped as confident false statements.

test('REGRESSION an unknown outcome means it ran, not that it did not run', () => {
  // A recorder cannot grade arbitrary shell, so most commands carry outcome "unknown".
  // Reading that as "did not run" told the author their command never executed.
  const mk = (result) => new Session({ sessionKey: 's', blobs: { c: 'npm test' }, events: [
    { id: 'A1', kind: 'invocation', sequence: 0, callKey: 'a1', tool: 'bash', operation: 'command',
      paths: [], command: [{ sourceKey: 'c', fromByte: 0, untilByte: 8 }], input: [], changes: [] },
    ...(result ? [{ id: 'A1-r', kind: 'observation', sequence: 1, invocation: 'A1', callKey: 'a1',
      phase: 'terminal', result, exitCode: null, output: [], sourceOfResult: 'native' }] : [])] });
  const candidate = { actorSession: 's', dimension: 'd', chosen: 'c', actions: ['A1'],
    value: null, valueReceipt: null, stated: null, constrainedBy: null };
  const rel = (result) => groundDecision({ repo, session: mk(result), pr: { files: [] },
    candidate, instructionHistoryComplete: true }).decision.relevance;
  for (const result of ['unknown', 'succeeded', 'failed']) assert.equal(rel(result), 'session-effect', result);
  // Only the total absence of a recorded observation supports "no record that it ran".
  assert.equal(rel(null), 'attempted');
});

test('REGRESSION with no PR file list, survival is unchecked — not "not in this PR"', () => {
  const s = new Session({ sessionKey: 's', blobs: {}, events: [
    { id: 'W1', kind: 'invocation', sequence: 0, callKey: 'w1', tool: 'Write', operation: 'write',
      paths: [{ path: 'src/a.js' }], command: [], input: [], changes: [] },
    { id: 'W1-r', kind: 'observation', sequence: 1, invocation: 'W1', callKey: 'w1', phase: 'terminal',
      result: 'succeeded', terminalStatusProven: true, exitCode: 0, output: [], sourceOfResult: 'native' }] });
  const candidate = { actorSession: 's', dimension: 'd', chosen: 'c', actions: ['W1'],
    value: null, valueReceipt: null, stated: null, constrainedBy: null };
  const rel = (pr) => groundDecision({ repo, session: s, pr, candidate, instructionHistoryComplete: true }).decision.relevance;
  assert.equal(rel(null), 'unchecked', 'no PR read at all');
  assert.equal(rel({ files: [] }), 'unchecked', 'empty list is "we did not look", not "absent"');
  assert.equal(rel({ files: [{ path: 'src/a.js', change: 'added' }] }), 'survives');
  assert.equal(rel({ enumeration: 'complete', files: [{ path: 'other.js', change: 'added', contentState: 'complete' }] }), 'reverted');
});

// ---- B11: an absence from an incomplete list is not an absence -------------------------
test('B11 REGRESSION "not in this PR" is never said from a listing the reader declared partial', () => {
  const s = new Session({ sessionKey: 's', blobs: {}, events: [
    { id: 'W1', kind: 'invocation', sequence: 0, callKey: 'w1', tool: 'Write', operation: 'write',
      paths: [{ path: 'src/a.js' }], command: [], input: [], changes: [] },
    { id: 'W1-r', kind: 'observation', sequence: 1, invocation: 'W1', callKey: 'w1', phase: 'terminal',
      result: 'succeeded', terminalStatusProven: true, exitCode: 0, output: [], sourceOfResult: 'native' }] });
  const candidate = { actorSession: 's', dimension: 'retry strategy', chosen: 'exponential backoff',
    actions: ['W1'], value: null, valueReceipt: null, stated: null, constrainedBy: null };
  const rel = (prInput) => groundDecision({ repo, session: s, pr: prInput, candidate, instructionHistoryComplete: true }).decision.relevance;
  const listed = (over) => ({ enumeration: 'complete',
    files: [{ path: 'src/elsewhere.js', change: 'modified', contentState: 'complete' }], ...over });

  assert.equal(rel(listed()), 'reverted', 'a complete listing may still assert an absence');
  // The GitHub reader's 3,000-file cap, and a file whose content the reader could not fully read.
  assert.equal(rel(listed({ enumeration: 'partial' })), 'unchecked');
  assert.equal(rel(listed({ enumeration: 'unknown' })), 'unchecked');
  const noEnumeration = listed(); delete noEnumeration.enumeration;
  assert.equal(rel(noEnumeration), 'unchecked');
  // W3d-1: a file the reader could not fully read makes relevance unknown only for a decision
  // whose OWN path it is. Another file's partial content says nothing about whether src/a.js is
  // in a complete list — this used to make every decision in every window "relevance unchecked".
  assert.equal(rel(listed({ files: [{ path: 'src/elsewhere.js', change: 'modified', contentState: 'partial' }] })), 'reverted');
  assert.equal(rel(listed({ files: [{ path: 'src/a.js', change: 'deleted', contentState: 'partial' }] })), 'unchecked');
  const truncated = buildLedger({ repo, session: s, pr: listed({ enumeration: 'partial' }),
    candidates: [candidate], sessionCoverage: 'complete' });
  assert.ok(!truncated.decisions.some((d) => d.relevance === 'reverted'), 'a truncated listing must never claim an absence');
});

// ---- B10: a shell write is a write, and its sibling carries the path --------------------
test('B10 REGRESSION a successful sed -i is not "ran, changed no code" nor "no record that it ran"', async () => {
  const { sessionFromLedger } = await import('../adapters/sonah-ledger.js');
  const s = sessionFromLedger({
    ask: [{ turn: 1, text: 'Bump the cache TTL in the config.' }],
    ledger: [
      { turn: 1, seq: 0, kind: 'bash', cmd: "sed -i '' 's/300/600/' src/config.js",
        outcome: 'passed', exitCode: 0, exitCodeSource: 'native', tailLines: [''] },
      { turn: 1, seq: 1, kind: 'edit', path: 'src/config.js', via: 'sed -i',
        shellWriteStatusEligible: true },
    ],
  }, { sessionKey: 's' });
  assert.deepEqual(s.events.map((e) => e.id), ['I1', 'A1-0', 'A1-0-r', 'A1-1']);
  assert.equal(s.event('A1-1').shellWriteOf, 'A1-0', 'the sibling declares which command wrote it');

  const prWithFile = { repo, enumeration: 'complete',
    files: [{ path: 'src/config.js', change: 'modified', contentState: 'complete' }] };
  const rel = (actions) => groundDecision({ repo, session: s, pr: prWithFile, instructionHistoryComplete: true,
    candidate: { actorSession: 's', dimension: 'cache ttl', chosen: '600', actions,
      value: null, valueReceipt: null, stated: null, constrainedBy: null } }).decision.relevance;
  assert.equal(rel(['A1-0']), 'survives', 'citing the command: its sibling names the changed file');
  assert.equal(rel(['A1-1']), 'survives', 'citing the sibling: the command carries the outcome');
  assert.equal(rel(['A1-0', 'A1-1']), 'survives', 'citing both');
});

test('B10 a shell write whose command FAILED is not surviving code', async () => {
  const { sessionFromLedger } = await import('../adapters/sonah-ledger.js');
  const s = sessionFromLedger({
    ask: [{ turn: 1, text: 'Bump the cache TTL in the config.' }],
    ledger: [
      { turn: 1, seq: 0, kind: 'bash', attempted: 'bash', cmd: "sed -i '' 's/300/600/' src/config.js",
        outcome: 'failed', tailLines: ['sed: no such file'] },
      { turn: 1, seq: 1, kind: 'edit', path: 'src/config.js', via: 'sed -i' },
    ],
  }, { sessionKey: 's' });
  const prWithFile = { repo, enumeration: 'complete',
    files: [{ path: 'src/config.js', change: 'modified', contentState: 'complete' }] };
  const rel = (actions) => groundDecision({ repo, session: s, pr: prWithFile, instructionHistoryComplete: true,
    candidate: { actorSession: 's', dimension: 'cache ttl', chosen: '600', actions,
      value: null, valueReceipt: null, stated: null, constrainedBy: null } }).decision.relevance;
  assert.notEqual(rel(['A1-0']), 'survives');
  assert.notEqual(rel(['A1-1']), 'survives');
});

test('B10 a structured write with no preceding command is never adopted into a shell chain', async () => {
  const { sessionFromLedger } = await import('../adapters/sonah-ledger.js');
  const s = sessionFromLedger({ ask: [{ turn: 1, text: 'Write the config.' }],
    ledger: [{ turn: 1, seq: 0, kind: 'edit', path: 'config/redis.yml', via: 'Write' }] }, { sessionKey: 's' });
  assert.equal(s.event('A1-0').shellWriteOf, undefined);
});

// ---- a capability that did not run has no verdict ------------------------------------ CV-01
test('REGRESSION code review reports "not run", never CLEAN, when it did not run', () => {
  // Reviews once said "Code review: CLEAN" while no code review
  // capability existed at all. buildLedger assumed 'complete' coverage, so an empty finding list
  // from a capability that never ran reduced to a clean pass.
  const r = buildLedger({ repo, session, pr });
  assert.equal(r.codeCoverage, 'missing');
  assert.equal(r.codeStatus, 'UNCHECKED');
});

test('REGRESSION the aggregate is never cleaner than its weakest capability', () => {
  // Session review can be CLEAN while code review never ran; the overall verdict must not be.
  const r = buildLedger({ repo, session, pr, sessionCoverage: 'complete' });
  assert.equal(r.sessionStatus, 'CLEAN');
  assert.equal(r.reviewStatus, 'UNCHECKED');
});

// ---- B1b/F68: a value grounds on the side it claims -----------------------------------
//
// B1 made both sides of a change quotable as role `code`, and B1b gives an Edit an `after` and a
// `before` of its own. `verifyReceipt` accepts a `code` quote from EITHER side, so without a side
// check a value receipt could quote a line the edit REMOVED and have it reported as the value the
// session adopted. Synthetic session, built here rather than in the shared fixture.

const sidedSession = () => {
  const text = {
    ask: 'Bring the HTTP client timeout down so a slow upstream cannot hold a request open.',
    removed: 'const timeout = 30_000;   // REMOVED_LINE_MARKER',
    added: 'const timeout = 5_000;    // ADDED_LINE_MARKER',
  };
  const blobs = { ...text };
  const whole = (key) => [{ sourceKey: key, fromByte: 0, untilByte: Buffer.byteLength(blobs[key], 'utf8') }];
  const events = [
    { id: 'S1', kind: 'instruction', sequence: 0, authority: 'human', text: whole('ask'), supersedes: [] },
    { id: 'S2', kind: 'invocation', sequence: 1, callKey: 'k1', tool: 'Edit', operation: 'edit',
      paths: [{ path: 'src/http.js' }], command: [], input: [],
      changes: [{ path: 'src/http.js', before: whole('removed'), after: whole('added'), diff: [],
        extent: { chars: text.added.length, lines: 1, truncated: false, cap: null,
          recorded: true, redactedLines: 0, priorState: 'edit-text' } }] },
    { id: 'S3', kind: 'observation', sequence: 2, invocation: 'S2', callKey: 'k1', phase: 'terminal',
      result: 'succeeded', terminalStatusProven: true, exitCode: 0, output: [], sourceOfResult: 'native' },
  ];
  return { session: new Session({ sessionKey: 'sess-sides', adapter: 'claude', events, blobs }), text };
};

const groundSided = (over) => {
  const { session: sided } = sidedSession();
  return groundDecision({ repo, session: sided, pr,
    candidate: { actorSession: 'sess-sides', dimension: 'timeout', chosen: 'lower it',
      actions: ['S2'], stated: null, constrainedBy: null, ...over },
    instructionHistoryComplete: true });
};

test('F68 an added-code value quoting a line the edit REMOVED is not grounded', () => {
  const { text } = sidedSession();
  const out = groundSided({ value: 'REMOVED_LINE_MARKER',
    valueReceipt: { role: 'code', eventId: 'S2', field: 'added-code', quote: text.removed } });
  assert.equal(out.ok, true, 'the candidate is well formed; only the value fails');
  assert.notEqual(out.decision.valueState, 'grounded',
    'a removed line is not what the session adopted, however literally it grounds');
  assert.equal(out.decision.value, null);
  assert.equal(out.decision.valueReceipt, null);
  assert.ok(out.decision.reasons.includes('value_unchecked'));
});

test('an added-code value cannot bridge two source spans even if the removed side has that quote', () => {
  const { session: sided } = sidedSession();
  sided.blobs.removed = 'Never use\nRedis here';
  sided.blobs.left = 'Never use\n';
  sided.blobs.right = 'Redis here';
  const change = sided.event('S2').changes[0];
  change.before = [{ sourceKey: 'removed', fromByte: 0, untilByte: Buffer.byteLength(sided.blobs.removed) }];
  change.after = [
    { sourceKey: 'left', fromByte: 0, untilByte: Buffer.byteLength(sided.blobs.left) },
    { sourceKey: 'right', fromByte: 0, untilByte: Buffer.byteLength(sided.blobs.right) },
  ];
  const quote = 'use\nRedis';
  assert.equal(verifyReceipt(sided, { role: 'code', eventId: 'S2', quote }).ok, true,
    'the quote exists on the removed side');
  const out = groundDecision({ repo, session: sided, pr,
    candidate: { actorSession: 'sess-sides', dimension: 'backend', chosen: 'Redis',
      actions: ['S2'], stated: null, constrainedBy: null, value: 'Redis',
      valueReceipt: { role: 'code', eventId: 'S2', field: 'added-code', quote } },
    instructionHistoryComplete: true });
  assert.equal(out.ok, true);
  assert.equal(out.decision.valueState, 'unchecked');
});

test('F68 the same quote still grounds a plain code receipt — only the VALUE claim is refused', () => {
  const { session: sided, text } = sidedSession();
  assert.equal(verifyReceipt(sided, { role: 'code', eventId: 'S2', quote: text.removed }).ok, true,
    'the removed line really is in the record, and quoting it as evidence is legitimate');
});

test('F68 an added-code value quoting a line the edit WROTE is grounded', () => {
  const { text } = sidedSession();
  const out = groundSided({ value: 'ADDED_LINE_MARKER',
    valueReceipt: { role: 'code', eventId: 'S2', field: 'added-code', quote: text.added } });
  assert.equal(out.decision.valueState, 'grounded');
  assert.equal(out.decision.value, 'ADDED_LINE_MARKER');
});

test('F68 the side check runs after the success guard, not instead of it', () => {
  // A failed write changed nothing, so its written text is an attempt and never an adopted value.
  const { text } = sidedSession();
  const failed = new Session({ sessionKey: 'sess-sides', adapter: 'claude',
    blobs: { added: text.added },
    events: [
      { id: 'S2', kind: 'invocation', sequence: 1, callKey: 'k1', tool: 'Edit', operation: 'edit',
        paths: [{ path: 'src/http.js' }], command: [], input: [],
        changes: [{ path: 'src/http.js', before: [], diff: [],
          after: [{ sourceKey: 'added', fromByte: 0, untilByte: Buffer.byteLength(text.added, 'utf8') }] }] },
      { id: 'S3', kind: 'observation', sequence: 2, invocation: 'S2', callKey: 'k1', phase: 'terminal',
        result: 'failed', exitCode: 1, output: [], sourceOfResult: 'native' },
    ] });
  const out = groundDecision({ repo, session: failed, pr,
    candidate: { actorSession: 'sess-sides', dimension: 'timeout', chosen: 'lower it', actions: ['S2'],
      stated: null, constrainedBy: null, value: 'ADDED_LINE_MARKER',
      valueReceipt: { role: 'code', eventId: 'S2', field: 'added-code', quote: text.added } },
    instructionHistoryComplete: true });
  assert.notEqual(out.decision.valueState, 'grounded');
});

test('code review only reports CLEAN when a caller declares it ran and found nothing', () => {
  const declared = buildLedger({ repo, session, pr, codeFindings: [], codeCoverage: 'complete', sessionCoverage: 'complete' });
  assert.equal(declared.codeStatus, 'CLEAN');
  const withFinding = buildLedger({ repo, session, pr, codeFindings: [
    { origin: 'code-review', kind: 'code_issue', title: 't', explanation: 'e',
      receipts: [], scope: 'current-code', anchor: null, status: 'DECIDE' }] });
  assert.equal(withFinding.codeStatus, 'DECIDE');
  assert.equal(withFinding.reviewStatus, 'DECIDE');
});
