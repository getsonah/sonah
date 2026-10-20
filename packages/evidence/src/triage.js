// The report's items and their tiers (D96, D97): which kind of item a row of the report is, the tier each kind defaults
// to, and the floor and ceiling inside which the code step's review agent may move it (its `triage` list,
// code-pass/10). Frozen literals, no per-repository baseline (CLAUDE.md).
//
// Code reads a row's kind from its closed tokens only — a status, a label, a handling, a derived column, `notActing`, a
// finding's kind or origin, a question's `from` — never from its words. The review agent may propose high, medium or
// low for an item; code maps that level to a tier and keeps it inside the bounds of the item's kind (`boundTier`). The
// review agent never sets an item's type, kind or scope.
//
// Pure and deterministic. Imports ledger.js alone, so the code step (code-pass.js, code-context.js) can read it with no
// import cycle through review.js.

import { REPORT_TIERS, TRIAGE_LEVELS, REPORT_ITEM_TYPES, TIER_BOUND_REASONS,
  REQUIREMENT_STATUSES, LEGACY_REQUIREMENT_STATUSES, WRITTEN_LABELS, FAILURE_HANDLINGS, DECISION_COLUMNS,
  CODE_FINDING_KINDS, FORBIDDEN_EDIT_BREACHES, PUBLIC_STATUSES, claimRowKind, derivedColumn } from './ledger.js';

/** The version of the tier table below (`ITEM_KIND_TABLE`): a change of any default, floor or ceiling is a new one. It
 *  is in the code step's run profile (code-pass.js `CODE_PASS_PROFILE`), so a table change never replays an old
 *  answer. /2 (D110): the kind `code_finding_unconfirmed`, a finding its check found to hold that Sonah could not
 *  confirm. In the same move (E1-F8, D112): every kind gained `refusedReadTier`, a failure that the agent passed over
 *  defaulting to Good to know when its call was a refused read. /3 (D122 (b), the owner, 2026-10-18): `refusedReadTier`
 *  is gone; a failure that the agent passed over defaults to Must know, whatever its call. */
export const TIER_TABLE_VERSION = 'sonah.tiers/3';

const [MUST_ACT, MUST_KNOW, GOOD_TO_KNOW] = REPORT_TIERS;
const [HIGH, MEDIUM, LOW] = TRIAGE_LEVELS;
const [FIX, DECIDE, READ, VERIFY] = REPORT_ITEM_TYPES;
const [KIND_FLOOR, KIND_CEILING, REFUSED_CALL_CEILING] = TIER_BOUND_REASONS;

/** The tier each proposed level maps to (D96): high is must act, medium must know, low good to know. */
export const LEVEL_TIER = Object.freeze({ [HIGH]: MUST_ACT, [MEDIUM]: MUST_KNOW, [LOW]: GOOD_TO_KNOW });
/** The tiers by rank, lowest first: a floor raises a lower tier, a ceiling lowers a higher one. */
const RANK = Object.freeze({ [GOOD_TO_KNOW]: 0, [MUST_KNOW]: 1, [MUST_ACT]: 2 });

const entry = (type, tier, { floor = null, ceiling = null, listed = false, uncheckedTier = null, tiedTier = null } = {}) =>
  Object.freeze({ type, tier, floor, ceiling, listed, uncheckedTier, tiedTier });
/**
 * Each item kind (ledger.js REPORT_ITEM_KINDS): its type (the item's first word), its default tier, its floor and its
 * ceiling (null: none), whether it is only listed (no item unless the code review proposes medium or high; its default
 * tier is then null), for a code question with no check, its tier (`uncheckedTier`), for an item that a published
 * finding or question of the code review is tied to, its tier (`tiedTier`). Frozen literals, `TIER_TABLE_VERSION`. The
 * bounds, by the owner's rules (D96):
 *   - an unmet ask, a contradicted claim, an edit against your words and a confirmed bug are never Good to know (floor
 *     Must know); a code finding is published only when its check found the same problem;
 *   - a contradiction the agent corrected or told you about, an edit it undid or told you about, and an earlier code
 *     review's finding are never Must act (ceiling Must know); so is a claim Sonah did not check, when the code review
 *     raises it;
 *   - a decision not to act and a decision made without asking you (D70 b: where the agent's key judgment is shown,
 *     open) default to Must know with no floor;
 *   - "you asked, the agent decided how" defaults to Good to know, folded, still listed and counted; it is Must know
 *     when a published finding or question of the code review is tied to it (owner decision 2026-10-16, D96 amended)
 *     and that item's own tier is at least Must know: a tie never lifts it above the item that ties it (the report
 *     model passes `tied` only then);
 *   - a change of approach, a decision where Sonah could not check whether you asked, and a code finding its check found
 *     not against your goal default to Good to know (D97);
 *   - a question of the code review defaults to Must know when its checking agent ran, Good to know when it did not:
 *     an unchecked question is ambiguous evidence, and precision ranks over recall;
 *   - a code finding Sonah could not confirm (D110: a premise of its check rests outside the repository and the
 *     language) is a Verify item, Good to know by default and never Must act (ceiling Must know): it rests on what
 *     Sonah could not check, ambiguous evidence, and precision ranks over recall;
 *   - a failure that the agent passed over defaults to Must know, whatever its call (D122 (b) removed D112's Good to know
 *     for a refused read); a decision not to act stays in Must know.
 * "You did not ask for this." is never a bound. Pure data.
 */
export const ITEM_KIND_TABLE = Object.freeze({
  ask_not_done: entry(FIX, MUST_ACT, { floor: MUST_KNOW }),
  ask_partly_done: entry(FIX, MUST_ACT, { floor: MUST_KNOW }),
  code_ask_not_met: entry(FIX, MUST_ACT, { floor: MUST_KNOW }),
  claim_contradicted: entry(VERIFY, MUST_ACT, { floor: MUST_KNOW }),
  code_claim_false: entry(FIX, MUST_ACT, { floor: MUST_KNOW }),
  edit_against_instruction: entry(FIX, MUST_ACT, { floor: MUST_KNOW }),
  code_bug: entry(FIX, MUST_ACT, { floor: MUST_KNOW }),
  code_contract: entry(FIX, MUST_ACT, { floor: MUST_KNOW }),
  written_contradicted: entry(FIX, MUST_KNOW, { floor: MUST_KNOW }),
  code_weak_test: entry(FIX, MUST_KNOW),
  failure_passed_over: entry(VERIFY, MUST_KNOW),
  decision_not_acting: entry(DECIDE, MUST_KNOW),
  decision_unasked: entry(DECIDE, MUST_KNOW),
  code_question: entry(DECIDE, MUST_KNOW, { uncheckedTier: GOOD_TO_KNOW }),
  decision_chose: entry(DECIDE, GOOD_TO_KNOW, { tiedTier: MUST_KNOW }),
  pivot: entry(DECIDE, GOOD_TO_KNOW),
  decision_whether_asked: entry(READ, GOOD_TO_KNOW),
  code_question_finding: entry(DECIDE, GOOD_TO_KNOW),
  code_finding_unconfirmed: entry(VERIFY, GOOD_TO_KNOW, { ceiling: MUST_KNOW }),
  claim_corrected: entry(VERIFY, GOOD_TO_KNOW, { ceiling: MUST_KNOW }),
  edit_undone: entry(FIX, GOOD_TO_KNOW, { ceiling: MUST_KNOW }),
  claim_not_checked: entry(VERIFY, null, { ceiling: MUST_KNOW, listed: true }),
  claim_incomplete: entry(VERIFY, null, { ceiling: MUST_KNOW, listed: true }),
  written_not_checked: entry(VERIFY, null, { ceiling: MUST_KNOW, listed: true }),
  code_finding_legacy: entry(READ, GOOD_TO_KNOW, { ceiling: MUST_KNOW }),
});

/** The recorder's denial kinds (redact `RECORDED_FACTS.denial`, the slicer's `recorded.denial`) that mean a permission
 *  rule or auto mode refused the call before it ran. An item that cites such a call is never Must act (D96). Not
 *  `user-rejected`: the recorder gives it for a person's "no" at a prompt, and also for a prompt no person could be
 *  shown (slicer events.js `CLAUDE_USER_REFUSAL`), so it does not show that a rule refused the call, and an agent that
 *  went around it is not capped (D96; the report's words for it name no one, report-words.js REPORT_REFUSAL_WORDS); not
 *  `interrupted` or `cancelled`: a call stopped after it started (ledger.js STOPPED_DENIALS). A frozen
 *  literal: this file imports ledger.js alone. */
export const PERMISSION_DENIALS = Object.freeze(['permission-rule', 'automode-blocked', 'automode-unavailable',
  'automode-parsing-error']);

/** The longest texts and lists of the code review's `triage` and `files` (code-pass/10): runaway guards like
 *  code-pass.js TRACE_LIMITS, frozen literals, checked by code after the answer returns and never sent as a schema
 *  limit (a limit the transport enforced would cost every finding of the answer for one long label). */
export const TRIAGE_LIMITS = Object.freeze({ entries: 120, impactChars: 200, actionChars: 160, labelChars: 48,
  labelWords: 6, files: 200, fileChars: 100 });

/**
 * The tier of one item of kind `kind` (REPORT_ITEM_KINDS), from the level the code review proposed for it (`level`, a
 * TRIAGE_LEVELS member, or null for none) inside the kind's bounds (`ITEM_KIND_TABLE`):
 * `{ default, proposed, final, bound }` — `default` the kind's tier (a code question with no check, `unchecked`: its
 * `uncheckedTier`; an item a published finding or question of the code review is tied to, `tied`: its `tiedTier`; a
 * listed kind: null), `proposed` the
 * level's tier or null, `final` the tier the item is shown in, `bound` null or the TIER_BOUND_REASONS member that moved
 * the proposal. A listed kind is an item only when the proposal is must know or must act: else `final` is null (no
 * item; the row stays in its list). `refused`: the item cites a call a permission rule or auto mode refused
 * (`PERMISSION_DENIALS`): never Must act. A proposal still moves an item whose default a flag set, inside the same
 * bounds. A level outside TRIAGE_LEVELS reads as none. An unknown kind throws. Pure.
 */
export function boundTier(kind, level = null, { refused = false, unchecked = false, tied = false } = {}) {
  if (!Object.hasOwn(ITEM_KIND_TABLE, kind)) throw new TypeError(`not an item kind: ${String(kind)}`);
  const k = ITEM_KIND_TABLE[kind];
  const proposed = TRIAGE_LEVELS.includes(level) ? LEVEL_TIER[level] : null;
  if (k.listed && (proposed === null || proposed === GOOD_TO_KNOW))
    return { default: null, proposed, final: null, bound: null };
  const fallback = unchecked === true && k.uncheckedTier ? k.uncheckedTier : tied === true && k.tiedTier ? k.tiedTier
    : k.tier;
  let final = proposed ?? fallback;
  let bound = null;
  if (k.floor && RANK[final] < RANK[k.floor]) { final = k.floor; bound = KIND_FLOOR; }
  if (k.ceiling && RANK[final] > RANK[k.ceiling]) { final = k.ceiling; bound = KIND_CEILING; }
  if (refused === true && RANK[final] > RANK[MUST_KNOW]) { final = MUST_KNOW; bound = REFUSED_CALL_CEILING; }
  return { default: fallback, proposed, final, bound };
}

/**
 * The report arrays (and the code step's published lists) a report item comes from, by the name `itemKindOf`
 * takes: the session review's rows, then the code step's published findings and questions, and (D110) the findings it
 * could not confirm (read through code-pass.js `codePassFindings`, `codePassQuestions` and `codePassUnconfirmed`).
 * Closed.
 */
export const ITEM_SOURCES = Object.freeze(['requirements', 'promises', 'writtenClaims', 'findings', 'decisions', 'pivots',
  'failures', 'codePass.findings', 'codePass.questions', 'codePass.unconfirmed']);

const plain = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const [, PARTLY_DONE, NOT_DONE] = REQUIREMENT_STATUSES;
const [, PARTLY_ADDRESSED, LEGACY_OPEN] = LEGACY_REQUIREMENT_STATUSES;
const [WRITTEN_UNVERIFIED, WRITTEN_CONTRADICTED] = WRITTEN_LABELS;
const PASSED_OVER = FAILURE_HANDLINGS[2];
const [, ASKED_CHOSE, UNASKED] = DECISION_COLUMNS;
const [DECIDE_STATUS, FYI_STATUS] = PUBLIC_STATUSES;
const [BUG, MISSED_CASE, WEAK_TEST, CONTRACT_BREAK, ASK_NOT_MET, RULE_BREAK, CLAIM_FALSE] = CODE_FINDING_KINDS;
/** The session findings' kinds an item reads (ledger.js FINDING_KINDS). */
const CLAIM_FINDING = 'claim_contradicted';
const EDIT_FINDING = 'edit_under_negative_requirement';
/** Where a session finding came from when the retired combined route's code review wrote it. */
const CODE_REVIEW_ORIGIN = 'code-review';
/** A published code finding's item kind, by its closed kind (CODE_FINDING_KINDS); any other kind is an earlier code
 *  review's (code-pass/1's `code_issue`). */
const CODE_FINDING_ITEM = Object.freeze({ [ASK_NOT_MET]: 'code_ask_not_met', [CLAIM_FALSE]: 'code_claim_false',
  [BUG]: 'code_bug', [MISSED_CASE]: 'code_bug', [CONTRACT_BREAK]: 'code_contract', [RULE_BREAK]: 'code_contract',
  [WEAK_TEST]: 'code_weak_test' });
/** A code question that came from a finding its check found real but not against your goal (code-pass.js `from`). */
const FROM_FINDING = 'finding';

/**
 * The item kind (REPORT_ITEM_KINDS) of one row of `source` (ITEM_SOURCES), or null when the row is no item (a done or
 * not-checked ask, a confirmed claim, a decision you settled, a failure the agent acted on or told you about or one Sonah
 * did not check, a row that is not an object, a source outside ITEM_SOURCES). By the row's closed tokens only:
 *   requirements        status not done (legacy open): ask_not_done; partly done (legacy partly addressed):
 *                       ask_partly_done
 *   promises            `claimRowKind`: not checked, claim_not_checked; resting on a check that did not finish,
 *                       claim_incomplete; confirmed, none
 *   writtenClaims       label contradicted: written_contradicted; unverified: written_not_checked
 *   findings            origin code-review (the retired combined route): code_finding_legacy; a claim the recording
 *                       contradicts, DECIDE: claim_contradicted, FYI: claim_corrected; an edit against your words,
 *                       DECIDE with a closed breach: edit_against_instruction, FYI: edit_undone
 *   decisions           `notActing`: decision_not_acting, whatever its column; else by `derivedColumn`: made without
 *                       asking, decision_unasked; asked and the agent chose how, decision_chose; not derived,
 *                       decision_whether_asked; you settled it, none
 *   pivots              pivot
 *   failures            handling passed over: failure_passed_over
 *   codePass.findings   by its kind (`CODE_FINDING_ITEM`); a kind outside CODE_FINDING_KINDS: code_finding_legacy
 *   codePass.questions  `from` finding: code_question_finding; any other (review, or none: code-pass/3 and older):
 *                       code_question
 *   codePass.unconfirmed  code_finding_unconfirmed, whatever its kind (D110)
 * Which rows are folded into another item (one item per root cause) is the report model's, not this function's. Pure.
 */
export function itemKindOf(source, row) {
  if (!plain(row)) return null;
  switch (source) {
    case 'requirements':
      return [NOT_DONE, LEGACY_OPEN].includes(row.status) ? 'ask_not_done'
        : [PARTLY_DONE, PARTLY_ADDRESSED].includes(row.status) ? 'ask_partly_done' : null;
    case 'promises': {
      const kind = claimRowKind(row);
      return kind === 'claimsOpen' ? 'claim_not_checked' : kind === 'claimsIncomplete' ? 'claim_incomplete' : null;
    }
    case 'writtenClaims':
      return row.label === WRITTEN_CONTRADICTED ? 'written_contradicted'
        : row.label === WRITTEN_UNVERIFIED ? 'written_not_checked' : null;
    case 'findings':
      if (row.origin === CODE_REVIEW_ORIGIN) return 'code_finding_legacy';
      if (row.kind === CLAIM_FINDING) return row.status === DECIDE_STATUS ? 'claim_contradicted'
        : row.status === FYI_STATUS ? 'claim_corrected' : null;
      if (row.kind === EDIT_FINDING) return row.status === DECIDE_STATUS && FORBIDDEN_EDIT_BREACHES.includes(row.breach)
        ? 'edit_against_instruction' : row.status === FYI_STATUS ? 'edit_undone' : null;
      return null;
    case 'decisions': {
      if (row.notActing === true) return 'decision_not_acting';
      const column = derivedColumn(row);
      return column === UNASKED ? 'decision_unasked' : column === ASKED_CHOSE ? 'decision_chose'
        : column === null ? 'decision_whether_asked' : null;
    }
    case 'pivots':
      return 'pivot';
    case 'failures':
      return row.handling === PASSED_OVER ? 'failure_passed_over' : null;
    case 'codePass.findings':
      return Object.hasOwn(CODE_FINDING_ITEM, row.kind) ? CODE_FINDING_ITEM[row.kind] : 'code_finding_legacy';
    case 'codePass.questions':
      return row.from === FROM_FINDING ? 'code_question_finding' : 'code_question';
    case 'codePass.unconfirmed':
      return 'code_finding_unconfirmed';
    default:
      return null;
  }
}

/** The item kind of a code-step dossier item (code-context.js `codeDossier`: `{ source, index }`, a row of `report`),
 *  or null when its row can be no item: what makes an `S` key triageable. The dossier and the report model read the
 *  same rule (`itemKindOf`), so they never disagree. Pure. */
export function triageableKind(item, report) {
  if (!plain(item) || typeof item.source !== 'string' || !Number.isSafeInteger(item.index)) return null;
  const rows = report?.[item.source];
  return Array.isArray(rows) ? itemKindOf(item.source, rows[item.index]) : null;
}

