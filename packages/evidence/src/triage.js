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
  CODE_FINDING_KINDS, FORBIDDEN_EDIT_BREACHES, PUBLIC_STATUSES, DISCLOSURE_REASONS, RECHECK_OUTCOMES, claimRowKind,
  derivedColumn } from './ledger.js';

/** The version of the tier table below (`ITEM_KIND_TABLE`): a change of any default, floor or ceiling is a new one. It
 *  is in the code step's run profile (code-pass.js `CODE_PASS_PROFILE`), so a table change never replays an old
 *  answer. /2 (D110): the kind `code_finding_unconfirmed`, a finding its check found to hold that Sonah could not
 *  confirm. In the same move (E1-F8, D112): every kind gained `refusedReadTier`, a failure that the agent passed over
 *  defaulting to Good to know when its call was a refused read. /3 (D122 (b), the owner, 2026-10-18): `refusedReadTier`
 *  is gone; a failure that the agent passed over defaults to Must know, whatever its call. /4 (D152): the kind
 *  `code_finding_open`, a finding its check found to hold that Sonah confirms, tied to no written promise: Good to know by
 *  default, never Must act. */
export const TIER_TABLE_VERSION = 'sonah.tiers/4';

const [MUST_ACT, MUST_KNOW, GOOD_TO_KNOW] = REPORT_TIERS;
const [HIGH, MEDIUM, LOW] = TRIAGE_LEVELS;
const [FIX, DECIDE, READ, VERIFY] = REPORT_ITEM_TYPES;
const [KIND_FLOOR, KIND_CEILING, REFUSED_CALL_CEILING, UNTIED_CEILING] = TIER_BOUND_REASONS;

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
 *     not against your goal (a record before D152) default to Good to know (D97);
 *   - (D152) a code finding its check found to hold, tied to no written promise (no row of the session review it follows
 *     from and no grounded receipt of what it breaks), is Good to know by default and never Must act (ceiling Must
 *     know): its check judged only that it is true, and nothing written that it breaks was found;
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
  code_finding_open: entry(DECIDE, GOOD_TO_KNOW, { ceiling: MUST_KNOW }),
  code_question_finding: entry(DECIDE, GOOD_TO_KNOW),
  code_finding_unconfirmed: entry(VERIFY, GOOD_TO_KNOW, { ceiling: MUST_KNOW }),
  claim_corrected: entry(VERIFY, GOOD_TO_KNOW, { ceiling: MUST_KNOW }),
  edit_undone: entry(FIX, GOOD_TO_KNOW, { ceiling: MUST_KNOW }),
  claim_not_checked: entry(VERIFY, null, { ceiling: MUST_KNOW, listed: true }),
  claim_incomplete: entry(VERIFY, null, { ceiling: MUST_KNOW, listed: true }),
  written_not_checked: entry(VERIFY, null, { ceiling: MUST_KNOW, listed: true }),
  code_finding_legacy: entry(READ, GOOD_TO_KNOW, { ceiling: MUST_KNOW }),
});
/**
 * D153: the kinds only a review run with the after-point re-check gives (run-review.js `recheckedRows`, an option that is
 * off by default), and their bounds, beside ITEM_KIND_TABLE and read with it (`kindBounds`): the code step's run profile
 * names ITEM_KIND_TABLE (code-pass.js `CODE_PASS_PROFILE`), so with the option off no profile, answer key or report byte
 * moves. They join ITEM_KIND_TABLE, and TIER_TABLE_VERSION moves, when the option becomes a default. Frozen literals:
 *   - an ask an earlier window found partly done or not done, followed by later work of its session that no later window
 *     settled, is Must know, never lower and never higher (floor and ceiling): ambiguous evidence is not an accusation,
 *     and a true open shortfall is not lost from the Must tiers (owner decision, D153); so is one a later window
 *     reaffirmed, and (the owner, 2026-10-26) a contradicted claim and a contradicted statement written into a file that
 *     later work followed and no later window settled (`unsettledRow`);
 *   - a contradicted statement written into a file that a later write of the agent's replaced is Good to know by
 *     default, never Must act (ceiling Must know), as a corrected claim is.
 */
export const RECHECK_KIND_TABLE = Object.freeze({
  ask_not_checked_after_later_work: entry(VERIFY, MUST_KNOW, { floor: MUST_KNOW, ceiling: MUST_KNOW }),
  claim_not_checked_after_later_work: entry(VERIFY, MUST_KNOW, { floor: MUST_KNOW, ceiling: MUST_KNOW }),
  written_not_checked_after_later_work: entry(VERIFY, MUST_KNOW, { floor: MUST_KNOW, ceiling: MUST_KNOW }),
  written_corrected: entry(VERIFY, GOOD_TO_KNOW, { ceiling: MUST_KNOW }),
});
/**
 * D161 (the owner, 2026-10-27: "Good to know unless tied", as a ceiling): the item kinds whose tier has a ceiling while
 * the item has no checked tie, and that ceiling, beside ITEM_KIND_TABLE and read with it (`boundTier`'s `untied`): the
 * code step's run profile names ITEM_KIND_TABLE and TIER_TABLE_VERSION (code-pass.js `CODE_PASS_PROFILE`) and the review
 * agent never sees a table, so no profile, request or answer key moves. A question of the code review whose `concerns`
 * names no row that code checked its tie to (D116, the report model's place test) is at most Good to know, whatever level
 * the review agent proposed; a tied one keeps its bounds. `bound` is the closed reason the final tier records when this
 * ceiling moved it (ledger.js TIER_BOUND_REASONS `untied_ceiling`; no profile names that list). Frozen literals.
 */
export const UNTIED_TIER_RULE = Object.freeze({ ceilings: Object.freeze({ code_question: GOOD_TO_KNOW }),
  bound: UNTIED_CEILING });
/** The bounds of one item kind: ITEM_KIND_TABLE's, else RECHECK_KIND_TABLE's (D153), else null. */
export const kindBounds = (kind) => (Object.hasOwn(ITEM_KIND_TABLE, kind) ? ITEM_KIND_TABLE[kind]
  : Object.hasOwn(RECHECK_KIND_TABLE, kind) ? RECHECK_KIND_TABLE[kind] : null);

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
 * (`PERMISSION_DENIALS`): never Must act. `untied` (D161): the item has no checked tie, so a kind UNTIED_TIER_RULE names is
 * at most its ceiling there (`bound` UNTIED_TIER_RULE.bound). A proposal still moves an item whose default a flag set,
 * inside the same bounds. A level outside TRIAGE_LEVELS reads as none. An unknown kind throws. Pure.
 */
export function boundTier(kind, level = null, { refused = false, unchecked = false, tied = false, untied = false } = {}) {
  const k = kindBounds(kind);
  if (k === null) throw new TypeError(`not an item kind: ${String(kind)}`);
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
  // D161: an item of a kind UNTIED_TIER_RULE names, with no checked tie (`untied`), is at most that kind's ceiling there.
  const untiedCeiling = untied === true && Object.hasOwn(UNTIED_TIER_RULE.ceilings, kind)
    ? UNTIED_TIER_RULE.ceilings[kind] : null;
  if (untiedCeiling && RANK[final] > RANK[untiedCeiling]) { final = untiedCeiling; bound = UNTIED_TIER_RULE.bound; }
  return { default: fallback, proposed, final, bound };
}

/**
 * The report arrays (and the code step's published lists) a report item comes from, by the name `itemKindOf`
 * takes: the session review's rows, then the code step's published findings and questions, and (D110) the findings it
 * could not confirm (read through code-pass.js `codePassFindings`, `codePassQuestions` and `codePassUnconfirmed`), and
 * (D152) the confirmed findings tied to no written promise (`codePassOpen`). Closed.
 */
export const ITEM_SOURCES = Object.freeze(['requirements', 'promises', 'writtenClaims', 'findings', 'decisions', 'pivots',
  'failures', 'codePass.findings', 'codePass.questions', 'codePass.unconfirmed', 'codePass.open']);

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
/** D153: the re-check's outcomes of a row a later window reaffirmed, and of one that later work followed and no later
 *  window settled. */
const [, REAFFIRMED, NOT_CHECKED_AFTER_LATER_WORK] = RECHECK_OUTCOMES;
/**
 * D153 (the owner's call of 2026-10-26): the re-check's outcomes of an accusing row that every reader shows with no
 * accusing word, in Must know: a row a later window reaffirmed, and one no later window settled, of every accusing kind.
 * A reaffirmation's precision is not measured yet, so it is shown no stronger than a row no later window settled; the
 * record keeps the outcome `reaffirmed`. Closed.
 */
export const SHOWN_NOT_CHECKED_LATER = Object.freeze([REAFFIRMED, NOT_CHECKED_AFTER_LATER_WORK]);
/**
 * D153: is the row of `source` (ITEM_SOURCES) an accusing row that the after-point re-check reaffirmed or left unsettled
 * (`recheck.outcome` in SHOWN_NOT_CHECKED_LATER)? The accusing rows: an ask an earlier window found partly done or not
 * done (a legacy report's partly addressed or open); a contradicted claim's finding, DECIDE (not the retired combined
 * route's); a statement written into a file, labelled contradicted with no disclosure reason beside it. Such a row
 * accuses no one: every reader words it, places it, counts it and sends it to the code review with no accusing word (its
 * kind `ask_not_checked_after_later_work`, `claim_not_checked_after_later_work` or
 * `written_not_checked_after_later_work`), never by its earlier status, with its earlier quote folded; a row a later
 * window checked (`laterChecked`) is worded as one that later work followed, never as one not checked. A row the re-check
 * moved keeps its new kind, and one with no later work (`no_later_work`: nothing later could have corrected it) keeps its
 * own. The one rule every reader reads (`itemKindOf`; review.js `askRowKind`, `askCodeNotes`, `writtenRowKind` and the
 * attention counts; code-context.js `codeDossier`; render report-model.js). By closed tokens only. Pure.
 */
export function unsettledRow(source, row) {
  if (!plain(row) || !plain(row.recheck) || !SHOWN_NOT_CHECKED_LATER.includes(row.recheck.outcome)) return false;
  switch (source) {
    case 'requirements': return [NOT_DONE, LEGACY_OPEN, PARTLY_DONE, PARTLY_ADDRESSED].includes(row.status);
    case 'findings': return row.kind === CLAIM_FINDING && row.status === DECIDE_STATUS && row.origin !== CODE_REVIEW_ORIGIN;
    case 'writtenClaims': return row.label === WRITTEN_CONTRADICTED && !DISCLOSURE_REASONS.includes(row.disclosureReason);
    default: return false;
  }
}
/** D153: `unsettledRow` of an ask row. Pure. */
export const unsettledAsk = (row) => unsettledRow('requirements', row);
/**
 * D153 (its fix round): is a row of `unsettledRow` one that a later window checked — reaffirmed (its later receipt the
 * row's own, the earlier kept in `recheck.earlier`), or a claim whose later RESULT a window grounded showing it not
 * holding again (`recheck.later`; never challenged, so its outcome stays `not_checked_after_later_work`)? Every reader
 * words such a row as one that later work followed, with its later receipt folded, never as one Sonah did not check;
 * the words are true either way and no stronger. By closed tokens and the record's structure only. Pure.
 */
export const laterChecked = (source, row) => unsettledRow(source, row) && (row.recheck.outcome === REAFFIRMED
  || (source === 'findings' && plain(row.recheck.later)));
/** A published code finding's item kind, by its closed kind (CODE_FINDING_KINDS); any other kind is an earlier code
 *  review's (code-pass/1's `code_issue`). */
const CODE_FINDING_ITEM = Object.freeze({ [ASK_NOT_MET]: 'code_ask_not_met', [CLAIM_FALSE]: 'code_claim_false',
  [BUG]: 'code_bug', [MISSED_CASE]: 'code_bug', [CONTRACT_BREAK]: 'code_contract', [RULE_BREAK]: 'code_contract',
  [WEAK_TEST]: 'code_weak_test' });
/** A code question that came from a finding its check found real but not against your goal (code-pass.js `from`): only
 *  a record before D152 holds one. */
const FROM_FINDING = 'finding';

/**
 * The item kind (REPORT_ITEM_KINDS) of one row of `source` (ITEM_SOURCES), or null when the row is no item (a done or
 * not-checked ask, a confirmed claim, a decision you settled, a failure the agent acted on or told you about or one Sonah
 * did not check, a row that is not an object, a source outside ITEM_SOURCES). By the row's closed tokens only:
 *   requirements        status not done (legacy open): ask_not_done; partly done (legacy partly addressed):
 *                       ask_partly_done; either, reaffirmed or left unsettled by the re-check (D153, `unsettledRow`):
 *                       ask_not_checked_after_later_work
 *   promises            `claimRowKind`: not checked, claim_not_checked; resting on a check that did not finish,
 *                       claim_incomplete; confirmed, none
 *   writtenClaims       label contradicted: written_contradicted, or with a disclosure reason beside it (D153):
 *                       written_corrected, or reaffirmed or left unsettled by the re-check (D153, `unsettledRow`):
 *                       written_not_checked_after_later_work; unverified: written_not_checked
 *   findings            origin code-review (the retired combined route): code_finding_legacy; a claim the recording
 *                       contradicts, DECIDE: claim_contradicted, or reaffirmed or left unsettled by the re-check (D153,
 *                       `unsettledRow`): claim_not_checked_after_later_work, FYI: claim_corrected; an edit against
 *                       your words, DECIDE with a closed breach: edit_against_instruction, FYI: edit_undone
 *   decisions           `notActing`: decision_not_acting, whatever its column; else by `derivedColumn`: made without
 *                       asking, decision_unasked; asked and the agent chose how, decision_chose; not derived,
 *                       decision_whether_asked; you settled it, none
 *   pivots              pivot
 *   failures            handling passed over: failure_passed_over
 *   codePass.findings   by its kind (`CODE_FINDING_ITEM`); a kind outside CODE_FINDING_KINDS: code_finding_legacy
 *   codePass.questions  `from` finding: code_question_finding; any other (review, or none: code-pass/3 and older):
 *                       code_question
 *   codePass.unconfirmed  code_finding_unconfirmed, whatever its kind (D110)
 *   codePass.open       code_finding_open, whatever its kind (D152)
 * Which rows are folded into another item (one item per root cause) is the report model's, not this function's. Pure.
 */
export function itemKindOf(source, row) {
  if (!plain(row)) return null;
  switch (source) {
    case 'requirements':
      // D153: an accusing ask that later work followed, reaffirmed or left unsettled, accuses no one (`unsettledRow`).
      if (unsettledRow(source, row)) return 'ask_not_checked_after_later_work';
      return [NOT_DONE, LEGACY_OPEN].includes(row.status) ? 'ask_not_done'
        : [PARTLY_DONE, PARTLY_ADDRESSED].includes(row.status) ? 'ask_partly_done' : null;
    case 'promises': {
      const kind = claimRowKind(row);
      return kind === 'claimsOpen' ? 'claim_not_checked' : kind === 'claimsIncomplete' ? 'claim_incomplete' : null;
    }
    case 'writtenClaims':
      // D153: a contradicted statement a later write replaced carries its disclosure reason beside its label; one the
      // re-check reaffirmed or left unsettled accuses no one.
      if (unsettledRow(source, row)) return 'written_not_checked_after_later_work';
      return row.label === WRITTEN_CONTRADICTED ? (DISCLOSURE_REASONS.includes(row.disclosureReason)
        ? 'written_corrected' : 'written_contradicted')
        : row.label === WRITTEN_UNVERIFIED ? 'written_not_checked' : null;
    case 'findings':
      if (row.origin === CODE_REVIEW_ORIGIN) return 'code_finding_legacy';
      // D153: a contradicted claim the re-check reaffirmed or left unsettled accuses no one.
      if (unsettledRow(source, row)) return 'claim_not_checked_after_later_work';
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
    case 'codePass.open':
      return 'code_finding_open';
    default:
      return null;
  }
}

/** The item kind of a code-step dossier item (code-context.js `codeDossier`: `{ source, index }`, a row of `report`),
 *  or null when its row can be no item: what makes an `S` key triageable. The dossier and the report model read the
 *  same rule (`itemKindOf`), so they never disagree; D153: a row the after-point re-check reaffirmed or left unsettled
 *  is named by the kind every reader shows it as (`unsettledRow`), in the dossier as on the page. Pure. */
export function triageableKind(item, report) {
  if (!plain(item) || typeof item.source !== 'string' || !Number.isSafeInteger(item.index)) return null;
  const rows = report?.[item.source];
  return Array.isArray(rows) ? itemKindOf(item.source, rows[item.index]) : null;
}

