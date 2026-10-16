// D96, D97 (B1.1, the contract): the report's items and their tiers. Which kind of item a row is, by its closed tokens
// (triage.js `itemKindOf`); the tier each kind defaults to and the floor and ceiling the code review's proposal is kept
// inside (`boundTier`, `ITEM_KIND_TABLE`); the refused-call ceiling (`PERMISSION_DENIALS`); the closed vocabularies
// (ledger.js); the STE word count a triage label is checked with (ste-count.js); the two readers moved from review.js
// so that the code step reads them with no import cycle; and the fixture the report's readers are built against.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { TIER_TABLE_VERSION, ITEM_KIND_TABLE, LEVEL_TIER, PERMISSION_DENIALS, TRIAGE_LIMITS, ITEM_SOURCES, boundTier,
  itemKindOf, triageableKind } from '../src/triage.js';
import * as ledger from '../src/ledger.js';
import { REPORT_TIERS, TRIAGE_LEVELS, REPORT_ITEM_TYPES, REPORT_ITEM_KINDS, TIER_BOUND_REASONS, TRIAGE_ERRORS,
  CODE_ITEM_ERRORS, FORBIDDEN_MODEL_FIELDS, STOPPED_DENIALS, CODE_FINDING_KINDS } from '../src/ledger.js';
import * as review from '../src/review.js';
import { steWordCount } from '../src/ste-count.js';
import { verifyReceipt } from '../src/session.js';
import { codeDossier } from '../src/code-context.js';
import { codePassFindings, codePassQuestions, codePassWithheld } from '../src/code-pass.js';
import { codeReceiptFound } from '../src/code-report.js';
import { RECORDED_FACTS } from '../../redact/index.js';
import { triageSession, triageReport, codePass9Report, sessionOnlyReport, codePass3Report, codePass8Report,
  codePass1Report, TRIAGE_REPORTS, ROWS } from './report-triage-fixture.js';

const here = dirname(fileURLToPath(import.meta.url));

// ---- the closed vocabularies ---------------------------------------------------------------------------------------------

test('the report\'s vocabularies are closed, frozen and in their order', () => {
  assert.deepEqual(REPORT_TIERS, ['must_act', 'must_know', 'good_to_know']);
  assert.deepEqual(TRIAGE_LEVELS, ['high', 'medium', 'low']);
  assert.deepEqual(REPORT_ITEM_TYPES, ['fix', 'decide', 'read', 'verify']);
  assert.deepEqual(REPORT_ITEM_KINDS, ['ask_not_done', 'ask_partly_done', 'code_ask_not_met', 'claim_contradicted',
    'code_claim_false', 'edit_against_instruction', 'code_bug', 'code_contract', 'written_contradicted', 'code_weak_test',
    'failure_passed_over', 'decision_not_acting', 'decision_unasked', 'code_question', 'decision_chose', 'pivot',
    'decision_whether_asked', 'code_question_finding', 'claim_corrected', 'edit_undone', 'claim_not_checked',
    'claim_incomplete', 'written_not_checked', 'code_finding_legacy']);
  assert.deepEqual(TIER_BOUND_REASONS, ['kind_floor', 'kind_ceiling', 'refused_call_ceiling']);
  assert.deepEqual(TRIAGE_ERRORS, ['triage_key_unknown', 'triage_key_repeated', 'triage_not_item', 'file_not_in_change',
    'where_ungrounded', 'item_withheld']);
  for (const list of [REPORT_TIERS, TRIAGE_LEVELS, REPORT_ITEM_TYPES, REPORT_ITEM_KINDS, TIER_BOUND_REASONS, TRIAGE_ERRORS,
    ITEM_SOURCES, PERMISSION_DENIALS]) {
    assert.ok(Object.isFrozen(list));
    assert.equal(new Set(list).size, list.length, 'no token twice');
  }
  for (const list of [REPORT_TIERS, TRIAGE_LEVELS, REPORT_ITEM_TYPES, REPORT_ITEM_KINDS, TIER_BOUND_REASONS, TRIAGE_ERRORS])
    for (const token of list) assert.match(token, /^[a-z][a-z_]*$/, 'a bare closed token');
  // A triage error is never one of the shape errors it sits beside: a dropped entry's cause names one list's token.
  assert.deepEqual(TRIAGE_ERRORS.filter((e) => CODE_ITEM_ERRORS.includes(e)), []);
  // D96 amends "no model-rated severity" by one closed level, never a field a session candidate may carry.
  for (const field of ['tier', 'severity', 'rank', 'confidence']) assert.ok(FORBIDDEN_MODEL_FIELDS.includes(field), field);
});

test('the tier table: every kind once, in display order, with its type and bounds as frozen literals', () => {
  assert.equal(TIER_TABLE_VERSION, 'sonah.tiers/1');
  assert.deepEqual(Object.keys(ITEM_KIND_TABLE), [...REPORT_ITEM_KINDS]);
  assert.ok(Object.isFrozen(ITEM_KIND_TABLE));
  const tiers = [...REPORT_TIERS, null];
  for (const [kind, k] of Object.entries(ITEM_KIND_TABLE)) {
    assert.ok(Object.isFrozen(k), kind);
    assert.deepEqual(Object.keys(k), ['type', 'tier', 'floor', 'ceiling', 'listed', 'uncheckedTier', 'tiedTier'], kind);
    assert.ok(REPORT_ITEM_TYPES.includes(k.type), kind);
    for (const field of ['tier', 'floor', 'ceiling', 'uncheckedTier', 'tiedTier'])
      assert.ok(tiers.includes(k[field]), `${kind}.${field}`);
    // A listed kind has no default tier; every other kind has one.
    assert.equal(k.tier === null, k.listed, kind);
  }
  const table = Object.fromEntries(Object.entries(ITEM_KIND_TABLE).map(([kind, k]) => [kind,
    [k.type, k.tier, k.floor, k.ceiling, k.listed, k.uncheckedTier, ...(k.tiedTier === null ? [] : [k.tiedTier])]]));
  const A = 'must_act', K = 'must_know', G = 'good_to_know';
  assert.deepEqual(table, {
    ask_not_done: ['fix', A, K, null, false, null], ask_partly_done: ['fix', A, K, null, false, null],
    code_ask_not_met: ['fix', A, K, null, false, null], claim_contradicted: ['verify', A, K, null, false, null],
    code_claim_false: ['fix', A, K, null, false, null], edit_against_instruction: ['fix', A, K, null, false, null],
    code_bug: ['fix', A, K, null, false, null], code_contract: ['fix', A, K, null, false, null],
    written_contradicted: ['fix', K, K, null, false, null], code_weak_test: ['fix', K, null, null, false, null],
    failure_passed_over: ['verify', K, null, null, false, null], decision_not_acting: ['decide', K, null, null, false, null],
    decision_unasked: ['decide', K, null, null, false, null], code_question: ['decide', K, null, null, false, G],
    // Owner decision 2026-10-16 (D96 amended): Good to know, Must know when the code review is tied to it.
    decision_chose: ['decide', G, null, null, false, null, K], pivot: ['decide', G, null, null, false, null],
    decision_whether_asked: ['read', G, null, null, false, null], code_question_finding: ['decide', G, null, null, false, null],
    claim_corrected: ['verify', G, null, K, false, null], edit_undone: ['fix', G, null, K, false, null],
    claim_not_checked: ['verify', null, null, K, true, null], claim_incomplete: ['verify', null, null, K, true, null],
    written_not_checked: ['verify', null, null, K, true, null], code_finding_legacy: ['read', G, null, K, false, null],
  });
  assert.deepEqual(LEVEL_TIER, { high: A, medium: K, low: G });
  assert.deepEqual(TRIAGE_LIMITS, { entries: 120, impactChars: 200, actionChars: 160, labelChars: 48, labelWords: 6,
    files: 200, fileChars: 100 });
  assert.ok(Object.isFrozen(TRIAGE_LIMITS) && Object.isFrozen(LEVEL_TIER));
});

test('the refused-call ceiling: a permission rule or auto mode refused the call; your own refusal and a stop are not', () => {
  assert.deepEqual(PERMISSION_DENIALS, ['permission-rule', 'automode-blocked', 'automode-unavailable',
    'automode-parsing-error']);
  // Every member is the recorder's own denial kind; every auto-mode kind is in it.
  for (const kind of PERMISSION_DENIALS) assert.ok(RECORDED_FACTS.denial.includes(kind), kind);
  assert.deepEqual(RECORDED_FACTS.denial.filter((k) => k.startsWith('automode-')),
    PERMISSION_DENIALS.filter((k) => k.startsWith('automode-')));
  assert.ok(!PERMISSION_DENIALS.includes('user-rejected'), 'your own "no" at the prompt sets no ceiling');
  for (const kind of STOPPED_DENIALS) assert.ok(!PERMISSION_DENIALS.includes(kind), `${kind}: stopped, not refused`);
});

// ---- boundTier ---------------------------------------------------------------------------------------------------------

test('boundTier: no proposal gives each kind its default tier, unbounded', () => {
  for (const [kind, k] of Object.entries(ITEM_KIND_TABLE)) {
    const result = boundTier(kind);
    if (k.listed) assert.deepEqual(result, { default: null, proposed: null, final: null, bound: null }, kind);
    else assert.deepEqual(result, { default: k.tier, proposed: null, final: k.tier, bound: null }, kind);
  }
  assert.deepEqual(boundTier('decision_chose'), { default: 'good_to_know', proposed: null, final: 'good_to_know',
    bound: null });
  // Tied to a published finding or question of the code review: its tied tier; a triage level still moves it, within
  // the kind's bounds (it has none).
  assert.deepEqual(boundTier('decision_chose', null, { tied: true }), { default: 'must_know', proposed: null,
    final: 'must_know', bound: null });
  assert.deepEqual(boundTier('decision_chose', 'low', { tied: true }), { default: 'must_know', proposed: 'good_to_know',
    final: 'good_to_know', bound: null });
  assert.deepEqual(boundTier('decision_chose', 'high'), { default: 'good_to_know', proposed: 'must_act',
    final: 'must_act', bound: null });
  // Tied changes no other kind: a decision made without asking and one not to act stay Must know.
  for (const kind of ['decision_unasked', 'decision_not_acting'])
    assert.deepEqual(boundTier(kind, null, { tied: true }), boundTier(kind), kind);
  assert.equal(boundTier('decision_unasked').final, 'must_know');
  assert.equal(boundTier('decision_not_acting').final, 'must_know');
  assert.deepEqual(boundTier('pivot'), { default: 'good_to_know', proposed: null, final: 'good_to_know', bound: null });
});

test('boundTier: a floor keeps an unmet ask, a confirmed bug and a contradicted claim out of Good to know', () => {
  for (const kind of ['ask_not_done', 'ask_partly_done', 'code_ask_not_met', 'code_bug', 'code_contract',
    'claim_contradicted', 'code_claim_false', 'edit_against_instruction'])
    assert.deepEqual(boundTier(kind, 'low'), { default: 'must_act', proposed: 'good_to_know', final: 'must_know',
      bound: 'kind_floor' }, kind);
  assert.deepEqual(boundTier('written_contradicted', 'low'), { default: 'must_know', proposed: 'good_to_know',
    final: 'must_know', bound: 'kind_floor' });
  // Medium is above every floor: kept as proposed.
  assert.deepEqual(boundTier('ask_not_done', 'medium'), { default: 'must_act', proposed: 'must_know', final: 'must_know',
    bound: null });
});

test('boundTier: a ceiling keeps a corrected or told contradiction, an old finding and a raised claim out of Must act', () => {
  for (const kind of ['claim_corrected', 'edit_undone', 'code_finding_legacy'])
    assert.deepEqual(boundTier(kind, 'high'), { default: 'good_to_know', proposed: 'must_act', final: 'must_know',
      bound: 'kind_ceiling' }, kind);
  for (const kind of ['claim_not_checked', 'claim_incomplete', 'written_not_checked']) {
    // A listed kind is an item only when the code review proposes medium or high.
    assert.deepEqual(boundTier(kind, 'high'), { default: null, proposed: 'must_act', final: 'must_know',
      bound: 'kind_ceiling' }, kind);
    assert.deepEqual(boundTier(kind, 'medium'), { default: null, proposed: 'must_know', final: 'must_know', bound: null },
      kind);
    assert.deepEqual(boundTier(kind, 'low'), { default: null, proposed: 'good_to_know', final: null, bound: null }, kind);
    assert.deepEqual(boundTier(kind, null), { default: null, proposed: null, final: null, bound: null }, kind);
  }
});

test('boundTier: a cited call a permission rule or auto mode refused caps every kind at Must know', () => {
  assert.deepEqual(boundTier('decision_unasked', 'high', { refused: true }), { default: 'must_know', proposed: 'must_act',
    final: 'must_know', bound: 'refused_call_ceiling' });
  assert.deepEqual(boundTier('ask_not_done', null, { refused: true }), { default: 'must_act', proposed: null,
    final: 'must_know', bound: 'refused_call_ceiling' });
  // Not refused: the same proposal is kept.
  assert.deepEqual(boundTier('decision_unasked', 'high'), { default: 'must_know', proposed: 'must_act', final: 'must_act',
    bound: null });
  // The ceiling lowers, never raises: a low proposal stays low.
  assert.deepEqual(boundTier('pivot', 'low', { refused: true }), { default: 'good_to_know', proposed: 'good_to_know',
    final: 'good_to_know', bound: null });
});

test('boundTier: a code question with no check defaults to Good to know; a proposal still moves it', () => {
  assert.deepEqual(boundTier('code_question', null, { unchecked: true }), { default: 'good_to_know', proposed: null,
    final: 'good_to_know', bound: null });
  assert.deepEqual(boundTier('code_question'), { default: 'must_know', proposed: null, final: 'must_know', bound: null });
  assert.deepEqual(boundTier('code_question', 'medium', { unchecked: true }), { default: 'good_to_know',
    proposed: 'must_know', final: 'must_know', bound: null });
  // `unchecked` means nothing to a kind with no unchecked tier.
  assert.deepEqual(boundTier('decision_unasked', null, { unchecked: true }), boundTier('decision_unasked'));
});

test('boundTier: every kind and level stays inside its bounds; a level outside the list is none; a kind outside throws', () => {
  const rank = { good_to_know: 0, must_know: 1, must_act: 2 };
  for (const [kind, k] of Object.entries(ITEM_KIND_TABLE)) for (const level of [...TRIAGE_LEVELS, null])
    for (const refused of [false, true]) {
      const { final, bound, proposed } = boundTier(kind, level, { refused });
      assert.equal(proposed, level === null ? null : LEVEL_TIER[level]);
      if (final === null) { assert.ok(k.listed, kind); continue; }
      if (k.floor) assert.ok(rank[final] >= rank[k.floor], `${kind} ${level}`);
      if (k.ceiling) assert.ok(rank[final] <= rank[k.ceiling], `${kind} ${level}`);
      if (refused) assert.notEqual(final, 'must_act', `${kind} ${level}`);
      assert.ok(bound === null || TIER_BOUND_REASONS.includes(bound));
    }
  for (const level of ['urgent', 'HIGH', 3, '', undefined])
    assert.deepEqual(boundTier('decision_unasked', level), boundTier('decision_unasked'), String(level));
  assert.throws(() => boundTier('severity'), TypeError);
  assert.throws(() => boundTier(undefined), TypeError);
});

// ---- itemKindOf --------------------------------------------------------------------------------------------------------

test('itemKindOf reads one row of each source shape by its closed tokens', () => {
  const kind = itemKindOf;
  // Asks, today's statuses and a legacy report's.
  assert.equal(kind('requirements', { status: 'not-done' }), 'ask_not_done');
  assert.equal(kind('requirements', { status: 'open' }), 'ask_not_done');
  assert.equal(kind('requirements', { status: 'partly-done' }), 'ask_partly_done');
  assert.equal(kind('requirements', { status: 'partly-addressed' }), 'ask_partly_done');
  for (const status of ['done', 'addressed', 'not-checked', 'something-else', undefined])
    assert.equal(kind('requirements', { status }), null, String(status));
  // Claims: confirmed is no item; not checked and resting on a check that did not finish are listed kinds.
  assert.equal(kind('promises', { status: 'verified' }), null);
  assert.equal(kind('promises', { status: 'open' }), 'claim_not_checked');
  assert.equal(kind('promises', { status: 'incomplete' }), 'claim_incomplete');
  assert.equal(kind('writtenClaims', { label: 'contradicted' }), 'written_contradicted');
  assert.equal(kind('writtenClaims', { label: 'unverified' }), 'written_not_checked');
  assert.equal(kind('writtenClaims', { label: 'other' }), null);
  // Session findings.
  assert.equal(kind('findings', { kind: 'claim_contradicted', status: 'DECIDE' }), 'claim_contradicted');
  assert.equal(kind('findings', { kind: 'claim_contradicted', status: 'FYI' }), 'claim_corrected');
  assert.equal(kind('findings', { kind: 'edit_under_negative_requirement', status: 'DECIDE', breach: 'wrote' }),
    'edit_against_instruction');
  assert.equal(kind('findings', { kind: 'edit_under_negative_requirement', status: 'DECIDE' }), null,
    'an edit against your words with no closed breach');
  assert.equal(kind('findings', { kind: 'edit_under_negative_requirement', status: 'FYI', breach: 'ran' }), 'edit_undone');
  assert.equal(kind('findings', { origin: 'code-review', kind: 'code_issue', status: 'DECIDE' }), 'code_finding_legacy');
  assert.equal(kind('findings', { origin: 'code-review', kind: 'claim_contradicted', status: 'DECIDE' }),
    'code_finding_legacy', 'the origin decides first');
  assert.equal(kind('findings', { kind: 'claim_contradicted', status: 'CLEAN' }), null);
  // Decisions: a decision not to act is one item whatever its column; a settled one is none.
  const decided = (column, columnState = 'grounded', extra = {}) => ({ column, columnState, ...extra });
  for (const column of ['asked-settled', 'asked-chose', 'unasked', null])
    assert.equal(kind('decisions', decided(column, 'grounded', { notActing: true })), 'decision_not_acting', String(column));
  assert.equal(kind('decisions', decided('unasked')), 'decision_unasked');
  assert.equal(kind('decisions', decided('asked-chose')), 'decision_chose');
  assert.equal(kind('decisions', decided('asked-settled')), null);
  assert.equal(kind('decisions', decided('unasked', 'unchecked')), 'decision_whether_asked',
    'a column the ledger did not derive');
  assert.equal(kind('decisions', decided(null, 'unchecked')), 'decision_whether_asked');
  assert.equal(kind('decisions', decided('unasked', 'grounded', { notActing: 'yes' })), 'decision_unasked',
    'only notActing true');
  assert.equal(kind('pivots', { abandoned: 'a', adopted: 'b' }), 'pivot');
  // Failures: only one passed over.
  assert.equal(kind('failures', { handling: 'passed-over' }), 'failure_passed_over');
  for (const handling of ['acted-on', 'told-human', 'not-checked', undefined])
    assert.equal(kind('failures', { handling }), null, String(handling));
  // The code step's published findings, by kind; any kind outside the list is an earlier code review's.
  const byKind = { bug: 'code_bug', missed_case: 'code_bug', weak_test: 'code_weak_test', contract_break: 'code_contract',
    ask_not_met: 'code_ask_not_met', rule_break: 'code_contract', claim_false: 'code_claim_false' };
  assert.deepEqual(Object.keys(byKind).sort(), [...CODE_FINDING_KINDS].sort());
  for (const [k, item] of Object.entries(byKind)) assert.equal(kind('codePass.findings', { kind: k, title: 't' }), item, k);
  assert.equal(kind('codePass.findings', { kind: 'code_issue', title: 't' }), 'code_finding_legacy');
  assert.equal(kind('codePass.questions', { question: 'q', from: 'review' }), 'code_question');
  assert.equal(kind('codePass.questions', { question: 'q' }), 'code_question', 'code-pass/3: no from');
  assert.equal(kind('codePass.questions', { question: 'q', from: 'finding' }), 'code_question_finding');
  // Not a row, or not a source.
  for (const row of [null, undefined, 'done', 3, []]) assert.equal(kind('requirements', row), null);
  assert.equal(kind('codePass.withheld', { what: 'finding' }), null);
  assert.equal(kind('steps', { status: 'not-done' }), null);
});

test('the fixture\'s code-step report holds every item kind; each older report reads by the same rule', () => {
  const kindsOf = (report) => {
    const kinds = new Map();
    for (const source of ITEM_SOURCES) {
      const rows = source === 'codePass.findings' ? codePassFindings(report)
        : source === 'codePass.questions' ? codePassQuestions(report) : report[source] ?? [];
      for (const row of rows) {
        const k = itemKindOf(source, row);
        if (k) kinds.set(k, (kinds.get(k) ?? 0) + 1);
      }
    }
    return kinds;
  };
  const session = triageSession();
  const a = kindsOf(triageReport(session));
  assert.deepEqual([...REPORT_ITEM_KINDS].filter((k) => !a.has(k)), [], 'every kind in (a)');
  assert.equal(a.get('failure_passed_over'), 2, 'a command and a refused Read');
  // (b) and (e) are the same rows with an older code step; (c) has no code step.
  const c = kindsOf(sessionOnlyReport());
  assert.ok(![...c.keys()].some((k) => k.startsWith('code_')), 'no code step, no code kind');
  // (d) code-pass/3: a question with no `from` is a code question.
  const d = codePass3Report(session);
  assert.equal(codePassQuestions(d).length, 1);
  assert.equal(codePassQuestions(d)[0].from, undefined);
  assert.equal(itemKindOf('codePass.questions', codePassQuestions(d)[0]), 'code_question');
  assert.deepEqual(boundTier('code_question', null, { unchecked: codePassQuestions(d)[0].check === undefined }).final,
    'good_to_know');
  // (f) code-pass/1: its `code_issue` finding is an earlier code review's.
  const [issue] = codePassFindings(codePass1Report(session));
  assert.equal(issue.kind, 'code_issue');
  assert.equal(itemKindOf('codePass.findings', issue), 'code_finding_legacy');
  // (e) code-pass/8: its held entry is no withheld item any reader lists, and `held` is no source.
  const e = codePass8Report(session);
  assert.ok(e.codePass.withheld.some((w) => w.what === 'held'));
  assert.ok(!codePassWithheld(e).some((w) => w.what === 'held'));
  assert.ok(!ITEM_SOURCES.includes('codePass.held'));
  assert.equal(codePass9Report(session).codePass.triage, undefined);
});

test('triageableKind: a dossier item can be triaged exactly when its row can be an item', () => {
  const session = triageSession();
  const report = triageReport(session);
  const items = codeDossier({ report, session });
  const at = (source, index) => items.find((i) => i.source === source && i.index === index);
  assert.equal(triageableKind(at('requirements', ROWS.askAdd), report), null, 'a done ask');
  assert.equal(triageableKind(at('requirements', ROWS.askCi), report), null, 'a not-checked ask');
  assert.equal(triageableKind(at('requirements', ROWS.askLog), report), 'ask_not_done');
  assert.equal(triageableKind(at('requirements', ROWS.askTimeout), report), 'ask_partly_done');
  assert.equal(triageableKind(at('promises', ROWS.claimSeconds), report), null, 'a confirmed claim');
  assert.equal(triageableKind(at('promises', ROWS.claimRetries), report), 'claim_not_checked');
  assert.equal(triageableKind(at('promises', ROWS.claimTimeoutRan), report), 'claim_incomplete');
  assert.equal(triageableKind(at('writtenClaims', ROWS.writtenWait), report), 'written_contradicted');
  assert.equal(triageableKind(at('writtenClaims', ROWS.writtenRetries), report), 'written_not_checked');
  assert.equal(triageableKind(at('findings', ROWS.contradicted), report), 'claim_contradicted');
  assert.equal(triageableKind(at('findings', ROWS.corrected), report), 'claim_corrected');
  assert.equal(triageableKind(at('findings', ROWS.editCi), report), 'edit_against_instruction');
  assert.equal(triageableKind(at('findings', ROWS.editReadme), report), 'edit_undone');
  assert.equal(triageableKind(at('decisions', ROWS.notActing), report), 'decision_not_acting');
  assert.equal(triageableKind(at('decisions', ROWS.settled), report), null, 'a decision you settled');
  assert.equal(triageableKind(at('decisions', ROWS.whetherAsked), report), 'decision_whether_asked');
  assert.equal(triageableKind(at('pivots', 0), report), 'pivot');
  assert.equal(triageableKind(at('failures', ROWS.refusedRead), report), 'failure_passed_over');
  // Every dossier item: the rule is itemKindOf on its own row, never anything else.
  for (const item of items) assert.equal(triageableKind(item, report), itemKindOf(item.source, report[item.source][item.index]));
  assert.equal(triageableKind({ source: 'requirements', index: 99 }, report), null);
  assert.equal(triageableKind({ source: 'requirements' }, report), null);
  assert.equal(triageableKind(null, report), null);
});

// ---- the fixture ---------------------------------------------------------------------------------------------------------

test('the fixture: every session quote grounds in the recording, every code quote in its stored span and file hash', () => {
  const session = triageSession();
  for (const [letter, make] of Object.entries(TRIAGE_REPORTS)) {
    const report = make(session);
    let quotes = 0, code = 0;
    const walk = (value, where) => {
      if (Array.isArray(value)) { value.forEach((v, i) => walk(v, `${where}[${i}]`)); return; }
      if (value === null || typeof value !== 'object') return;
      if (typeof value.quote === 'string' && value.sessionKey) {
        quotes++;
        assert.ok(verifyReceipt(session, value).ok, `${letter} ${where}`);
      }
      if (value.role === 'code' && typeof value.span === 'string') {
        code++;
        assert.ok(codeReceiptFound(report, value), `${letter} ${where}`);
      }
      for (const [k, v] of Object.entries(value)) walk(v, `${where}.${k}`);
    };
    walk(report, letter);
    assert.ok(quotes > 30, `${letter}: ${quotes} session quotes`);
    if (report.codePass && letter !== 'f') assert.ok(code > 3, `${letter}: ${code} code quotes`);
  }
});

test('the fixture (a): the code step\'s new fields, and a refused call of each kind', () => {
  const session = triageSession();
  const report = triageReport(session);
  const { codePass } = report;
  assert.equal(codePass.version.pass, 'sonah.code-pass/10');
  // Every triage entry names a published finding, a published question or a row of the report.
  const ids = new Set(codePassFindings(report).map((f) => f.id));
  const questions = new Set(codePassQuestions(report).map((q) => q.id));
  for (const { ref, level } of codePass.triage) {
    assert.ok(TRIAGE_LEVELS.includes(level));
    if (ref.finding) assert.ok(ids.has(ref.finding));
    else if (ref.question) assert.ok(questions.has(ref.question));
    else assert.ok(itemKindOf(ref.source, report[ref.source][ref.index]) !== null, JSON.stringify(ref));
  }
  for (const f of codePassFindings(report)) {
    assert.equal(f.anchorSha256, codePass.files.find((x) => x.path === f.anchor.path).sha256);
    assert.equal(f.anchorSpan.startLine, f.anchor.startLine);
    assert.equal(f.anchorSpan.lines.length, f.anchor.endLine - f.anchor.startLine + 1);
    assert.ok(f.anchorChanged.every((line) => line >= f.anchor.startLine && line <= f.anchor.endLine));
  }
  assert.ok(codePass.files.every((f) => Number.isSafeInteger(f.added) && Number.isSafeInteger(f.removed)));
  assert.ok(codePass.files.some((f) => f.what === undefined), 'a file the files list did not name');
  assert.equal(codePass.triageDropped.length, 1);
  assert.equal(codePass.filesDropped.length, 1);
  // A promise folded into a contradiction finding (the finding cites its stated receipt) and a confirmed claim that a
  // claim_false contradicts (its code check joined).
  const folded = report.promises[ROWS.claimTestsPass];
  assert.ok(report.findings[ROWS.contradicted].receipts.some((r) => r.eventId === folded.stated.eventId
    && r.quote === folded.stated.quote));
  assert.equal(report.promises[ROWS.claimSeconds].status, 'verified');
  assert.equal(report.promises[ROWS.claimSeconds].codeCheck.outcome, 'contradicted-by-code');
  assert.equal(report.findings[ROWS.editReadme].disclosureReason, 'disclosed');
  // The refused calls: each kind once, read from the recorder's fields.
  const denials = session.events.filter((e) => e.kind === 'invocation' && e.recorded?.denial).map((e) => [e.id, e.tool,
    e.recorded.denial]);
  assert.deepEqual(denials, [['X1', 'Read', 'permission-rule'], ['X2', 'bash', 'automode-blocked'],
    ['X3', 'bash', 'user-rejected']]);
  assert.equal(report.failures[ROWS.refusedRead].action, 'X1');
  assert.deepEqual(report.decisions[ROWS.chose].actions, ['X2']);
  assert.deepEqual(report.decisions[ROWS.whetherAsked].actions, ['X3']);
  // The D93 split: a done ask a published finding follows from.
  assert.deepEqual(report.requirements[ROWS.askSeconds].codeLinks.map((l) => l.link), ['leads_from', 'trace_quotes_ask']);
  assert.equal(review.askRowKind(report.requirements[ROWS.askSeconds]), 'asksCodeFinding');
  // Each call builds anew.
  const again = triageReport(session);
  again.codePass.triage.length = 0;
  assert.ok(triageReport(session).codePass.triage.length > 0);
});

// ---- the moved readers and the import cycle ------------------------------------------------------------------------------

test('claimRowKind and derivedColumn live in ledger.js; review.js re-exports the same functions by name', () => {
  assert.equal(review.claimRowKind, ledger.claimRowKind);
  assert.equal(review.derivedColumn, ledger.derivedColumn);
  assert.equal(review.DERIVED_COLUMN_STATE, ledger.DERIVED_COLUMN_STATE);
  assert.equal(ledger.DERIVED_COLUMN_STATE, 'grounded');
  assert.equal(ledger.claimRowKind({ status: 'verified' }), null);
  assert.equal(ledger.claimRowKind({ status: 'incomplete' }), 'claimsIncomplete');
  assert.equal(ledger.claimRowKind({ status: 'open' }), 'claimsOpen');
  assert.equal(ledger.claimRowKind(null), null);
  assert.equal(ledger.derivedColumn({ column: 'unasked', columnState: 'grounded' }), 'unasked');
  assert.equal(ledger.derivedColumn({ column: 'unasked', columnState: 'unchecked' }), null);
  assert.equal(ledger.derivedColumn({ column: 'sideways', columnState: 'grounded' }), null);
});

/** The relative modules a source file imports or re-exports, statically. */
function importsOf(file) {
  const text = readFileSync(file, 'utf8');
  return [...text.matchAll(/^\s*(?:import|export)\s[^;]*?\sfrom\s+['"](\.[^'"]+)['"]/gms)].map((m) => m[1]);
}

test('no import cycle: triage.js imports ledger.js alone; the code step reaches no review.js', () => {
  const src = resolve(here, '../src');
  assert.deepEqual(importsOf(resolve(src, 'triage.js')), ['./ledger.js']);
  for (const start of ['triage.js', 'code-context.js', 'code-pass.js']) {
    const seen = new Set();
    const walk = (file) => {
      if (seen.has(file)) return;
      seen.add(file);
      for (const spec of importsOf(file)) walk(resolve(dirname(file), spec));
    };
    walk(resolve(src, start));
    assert.ok(seen.size > 1, start);
    assert.deepEqual([...seen].filter((f) => basename(f) === 'review.js'), [], `${start} reaches review.js`);
  }
  // The scan reads re-exports too: review.js itself reaches ledger.js.
  assert.ok(importsOf(resolve(src, 'review.js')).includes('./ledger.js'));
});

// ---- the STE word count ------------------------------------------------------------------------------------------------

test('steWordCount: STE counting, by form only', () => {
  assert.equal(steWordCount('fix the Retry-After unit'), 4, 'a hyphenated word is one word');
  assert.equal(steWordCount('Send the wait in whole seconds.'), 6);
  assert.equal(steWordCount('Read the file (the one that the agent wrote) now.'), 5, 'text in parentheses is one word');
  assert.equal(steWordCount('a (b (c d) e) f'), 3, 'nested parentheses are one group');
  assert.equal(steWordCount('item(s) left'), 2, 'a group joined to a word is that word');
  assert.equal(steWordCount('Run `npm run test -- --watch` again.'), 3, 'an inline code span is one word');
  assert.equal(steWordCount('Run ``a ` b`` again.'), 3, 'a code span fenced by two backticks');
  assert.equal(steWordCount('After its last edit, the agent ran {n} commands.'), 9, 'a placeholder is one word');
  assert.equal(steWordCount('Open src/retry.js:12 at https://example.com/a?b=c in 2,000 ms.'), 7);
  assert.equal(steWordCount('Must act 2 · Must know 3'), 6, 'a lone separator is no word');
  assert.equal(steWordCount('one — two & three'), 3);
  assert.equal(steWordCount('an (unclosed group of words'), 5, 'an unbalanced mark is counted as it stands');
  assert.equal(steWordCount('a ``b c'), 3, 'an unclosed code span is counted as it stands');
  assert.equal(steWordCount('  '), 0);
  assert.equal(steWordCount(''), 0);
  for (const value of [null, undefined, 3, ['a b']]) assert.equal(steWordCount(value), 0);
  assert.equal(steWordCount('Größe prüfen'), 2, 'any script\'s letters');
  // The label bound: six words by this count.
  assert.ok(steWordCount('fix the unit of the Retry-After header') > TRIAGE_LIMITS.labelWords);
  assert.ok(steWordCount('fix the Retry-After unit (seconds)') <= TRIAGE_LIMITS.labelWords);
});
