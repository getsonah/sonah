// Rendering the review. Built without a model (C-10): the report is already decided by the time
// it gets here, and a summarizing model call would be an unverifiable layer over verified data.
//
// Two properties this file must not lose:
//   1. Every displayed claim shows its receipt — role, event and the verbatim quote.
//   2. Source text is escaped. A transcript containing </details> or **bold** must not be able
//      to restructure the review or impersonate a product control (C-10, hostile-pr).

import { COLUMN_LABELS, DECISION_ORDER, honestStatuses, unrecordedCover,
  withheldRejection, withheldCauseCounts, gapKey, WITHHELD_REJECTION_CAUSES, VALUE_UNCHECKED_CAUSES,
  WRITTEN_LABELS, WRITTEN_WITHHELD_CAUSES, PART_REASONS, reviewRunState,
  PROMISE_STATUSES, DISCLOSURE_REASONS, FORBIDDEN_EDIT_BREACHES, FORBIDDEN_WITHHELD_CAUSE, STOPPED_WORDS, FAILURE_HANDLINGS,
  DECISION_COLUMNS,
  shellWriteWords, UNRUN_WRITE_REASON, OWN_WRITTEN_SOURCE } from './ledger.js';
import { INSTRUCTION_GAP_NOTES, DELEGATION_BRIEF_GAP_NOTES, INTER_AGENT_GAP_NOTES, HELPER_REPORT_CLIPPED_NOTE, LABEL_GAP_NOTES,
  CLOSING_STATEMENT_CLIPPED_NOTE, BODY_CAPPED_NOTE, HUMAN_INTERACTION_UNKNOWN_NOTE } from '../adapters/sonah-ledger.js';
import { promisesBesideFindings } from './run-review.js';
import { codeContradictedRows, codePassFindings } from './code-pass.js';
import { referredPath } from './session.js';

/** M33 X second recheck's closed note (the retired carry's, `sonah.carry`): a window whose request cap kept earlier
 *  evidence out of its carry. M35 (windowing) deleted the carry, so no review declares it; kept, word for word, only to
 *  read a report written before (its coverage cause `carry_capped`). */
export const CARRY_CAPPED_NOTE = 'earlier evidence selected for this review window was not carried: its request byte cap could not hold it';

const QUOTE_DISPLAY_CHARS = 240;
/** The finding kinds the checklist places (ledger.js FINDING_KINDS): a contradicted claim under what the agent told you,
 *  a forbidden edit under the edits against what you said; any other (the code review's) under its own heading. */
const CLAIM_FINDING_KIND = 'claim_contradicted';
const FORBIDDEN_FINDING_KIND = 'edit_under_negative_requirement';

// C-10 requires byte-bounded output with EXPLICIT omissions. A PR with forty decisions must
// still be readable, and what is left out must be stated rather than silently dropped — an
// unstated truncation reads as "that is everything", which is a false coverage claim.
export const DISPLAY_LIMITS = Object.freeze({ decisionCards: 12, findings: 20 });

/**
 * Escape text that came from a session or a model so it cannot inject Markdown or HTML.
 *
 * Escape exactly what can change structure, and nothing else. Escaping every punctuation mark
 * is safe but turns prose into `config\\.yml` and `non\\-zero`, which makes the review harder to
 * read — and readability is the product here, not a nicety.
 */
export function escapeSource(text) {
  // A lone \r is a line break in Markdown renderers too, so flattening only \r\n and \n would
  // let a verified quote open new blocks and impersonate the review's own headings.
  const flattened = String(text ?? '').replace(/[\r\n\u2028\u2029]+/g, ' ');
  const escaped = flattened
    .replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]))
    // Inline constructs and the table-cell separator. These matter anywhere in the string.
    .replace(/([\\`*_\[\]|])/g, '\\$1');
  // Block constructs only matter at the very start, and newlines are already flattened, so a
  // leading marker is the only way source text could open a list, heading or blockquote.
  return escaped.replace(/^([#>+-])/, '\\$1').replace(/^(\d+)\./, '$1\\.');
}

/**
 * Display form of a verified quote. Truncation puts the ellipsis OUTSIDE the quotation marks,
 * because the ellipsis is not part of what was verified (C-05).
 */
function quoteDisplay(quote) {
  const text = String(quote ?? '');
  const scalars = [...text];
  if (scalars.length <= QUOTE_DISPLAY_CHARS) return `“${escapeSource(text)}”`;
  return `“${escapeSource(scalars.slice(0, QUOTE_DISPLAY_CHARS).join(''))}” …`;
}

const ROLE_LABEL = Object.freeze({
  instruction: 'human instruction',
  commentary: 'agent said',
  action: 'action',
  observation: 'result',
  code: 'code',
  // D71 (g): the project's own instruction file the harness gave the agent.
  'project-instructions': "project's instruction file",
});
/** D71 (e), S4: a contradicted claim's receipt that is what contradicts it, labelled by the finding's code-set source:
 *  an edit's removed or context lines are a file's recorded content, never "code" the agent wrote. */
const CONTRADICTING_ROLE_LABEL = Object.freeze({ file_content: "file's recorded content" });

/** M33 H repair (C-06 "M33 helper-internal claims"): the label of a helper's own statement in the receipts of a row
 *  the review disclosed as `helper_internal` — the helper said it, not the agent the human talked to. */
export const HELPER_STATEMENT_ROLE_LABEL = 'helper said';

function receiptLine(receipt, { helper = false, label: own = null } = {}) {
  const where = `\`${escapeSource(receipt.eventId ?? '?')}\``;
  // F77: a quote code snapped to the recorded text is still verified text, but it is not what
  // the model wrote. Say so on the line. Only a strictly true flag is that claim.
  const repaired = receipt.repaired === true ? ' · repaired' : '';
  const label = own ?? (helper && receipt.role === 'commentary' ? HELPER_STATEMENT_ROLE_LABEL : ROLE_LABEL[receipt.role] ?? receipt.role);
  return `- **${label}** ${where} — ${quoteDisplay(receipt.quote)}${repaired}`;
}

// D71 (a), owner decision 2026-10-08: no verdict anywhere the human sees. What the review says of itself as a whole is
// only whether Sonah's own review ran (ledger.js REVIEW_RUN_STATES; a review that failed has no report to render), and
// of each part of it, whether that part ran. Fixed words; never a status of the agent's work. (Before D71: one headline
// per member of PUBLIC_STATUSES, the "Needs a decision before merge." family, and a status beside each part.)
export const RUN_STATE_SENTENCE = Object.freeze({
  complete: "Sonah's review ran to completion. It lists what to check; it never says the work is right.",
  incomplete: "Sonah's review did not complete: read what it could not cover before relying on it.",
});
/** D71 (a): each part of the review by whether it ran — the code review by the report's `codeCoverage`, the session
 *  review by `sessionReview`. */
export const RUN_PART_WORDS = Object.freeze({
  code: Object.freeze({ complete: 'read every file', partial: 'did not read every file' }),
  session: Object.freeze({ complete: 'complete', incomplete: 'did not complete' }),
});
/** D71 (a), (S4): where the checklist points your attention, by section, in the checklist's order — fixed words filled
 *  with counts only. Each line is shown only when its count is above zero; the last when no line is. Nothing done is
 *  counted, so no line reads as a grade; a choice not to act and a failure passed over are highlighted (D71 c, d).
 *  D88 (owner decision 2026-10-14, amending D71 S2's "every row short of done points attention"): only the rows of
 *  ATTENTION_ROWS are counted, in its order; the rows Sonah could not check (FOLDED_ROWS) are folded, and one plain line
 *  says how many and where. */
export const ATTENTION_HEADING = '### Where your attention is needed';
const counted = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
/** D71 (S4): the checklist's sections in the PR comment, in its order (the page's headings). D88: the agent's judgment
 *  first, then what you asked, the failures it passed over, what it told you, the edits against what you said, what the
 *  code review found, and last, collapsed, what Sonah could not check. */
export const CHECKLIST_HEADINGS = Object.freeze({ requests: '### What you asked', claims: '### What the agent told you',
  decisions: '### What the agent decided', pivots: '#### Changes of approach', failures: '### Failures it passed over',
  edits: '### Edits against what you said, and statements it wrote into files', code: '### What the code review found',
  folded: '### What Sonah could not check' });

/**
 * D88 (owner decision 2026-10-14, amending D71 S2's "every row short of done points attention"): the review leads with
 * the agent's judgment and the settled problems. Every checklist row is read by its kind, and the kinds are two closed
 * lists — the one definition the session page, the story, the PR comment and the CLI read:
 *   - ATTENTION_ROWS, the only rows the attention summary counts, in its order: the agent's judgment (its choices not to
 *     act; its decisions made without asking you, where you asked and it chose how, and where the review could not tell
 *     whether you asked; its changes of approach), then the settled problems (asks shown not done or partly done;
 *     claims the recording contradicts; rows the code at review time contradicts; failures the agent passed over; edits
 *     against what you said or the project's instruction file; statements written into a file and contradicted; the
 *     code review's findings).
 *   - FOLDED_ROWS, the rows Sonah could not check (asks not checked; claims not checked against a recorded result;
 *     claims resting on a check that never completed; failures whose handling could not be checked; statements written
 *     into files and not checked): every one is kept in one collapsed section, "What Sonah could not check (N)", last,
 *     each group headed by how many rows of its kind there are and each row listed in full up to the reader's display
 *     bound, the rest of a group counted in it as not shown (the judgment-first review: review.md at most
 *     DISPLAY_LIMITS.findings rows of each group; the page and the story by their own bounds); none is counted in the
 *     summary, which carries one plain line saying how many and where. Nothing is deleted.
 * Why: a judgment row or a settled problem is what a reader acts on, while a row Sonah could not check is less often a
 * problem.
 * A row's kind is read from its closed tokens only (a status, a handling, a label, a column, `notActing`), never from
 * its words.
 */
export const ATTENTION_ROWS = Object.freeze(['notActing', 'unasked', 'chose', 'whetherAsked', 'pivots', 'asksNotDone',
  'contradicted', 'codeContradicted', 'passedOver', 'forbidden', 'writtenContradicted', 'codeFindings']);
export const FOLDED_ROWS = Object.freeze(['asksNotChecked', 'claimsOpen', 'claimsIncomplete', 'failuresNotChecked',
  'writtenOpen']);
/** D88: an ask by its status token (ledger.js REQUIREMENT_STATUSES; a legacy report's LEGACY_REQUIREMENT_STATUSES, the
 *  review's reading before the checklist) — not done or partly done counts (a legacy open or partly addressed ask too,
 *  as before); not checked is folded; done (or addressed) is neither. */
export const ASK_ROW_KINDS = Object.freeze({ 'not-done': 'asksNotDone', 'partly-done': 'asksNotDone',
  open: 'asksNotDone', 'partly-addressed': 'asksNotDone', 'not-checked': 'asksNotChecked' });
const [, CLAIM_VERIFIED, CLAIM_INCOMPLETE] = PROMISE_STATUSES;
const [FAILURE_ACTED_ON, FAILURE_TOLD_HUMAN, FAILURE_PASSED_OVER] = FAILURE_HANDLINGS;
const [, WRITTEN_CONTRADICTED_LABEL] = WRITTEN_LABELS;
const rowObject = (row) => row !== null && typeof row === 'object' && !Array.isArray(row);
/** D88: the kind of one ask row, or null when it is done. */
export const askRowKind = (r) => (rowObject(r) && Object.hasOwn(ASK_ROW_KINDS, r.status) ? ASK_ROW_KINDS[r.status] : null);
/** D88: the kind of one claim (a published promise) by its status: confirmed by a recorded result is neither (it is
 *  listed under what the agent told you); resting on a check that never completed is folded; any other status reads not
 *  checked (PROMISE_STATUS_WORDS) and is folded. */
export const claimRowKind = (p) => (!rowObject(p) || p.status === CLAIM_VERIFIED ? null
  : p.status === CLAIM_INCOMPLETE ? 'claimsIncomplete' : 'claimsOpen');
/** D88: the kind of one failure row by its handling (ledger.js FAILURE_HANDLINGS): passed over counts; acted on and
 *  told you are neither; any other (not checked, or a handling outside the vocabulary, which reads not checked) is
 *  folded. */
export const failureRowKind = (row) => (!rowObject(row) ? null : row.handling === FAILURE_PASSED_OVER ? 'passedOver'
  : row.handling === FAILURE_ACTED_ON || row.handling === FAILURE_TOLD_HUMAN ? null : 'failuresNotChecked');
/** D88: the kind of one statement written into a file by its label (ledger.js WRITTEN_LABELS): contradicted counts, the
 *  other label is folded; a label outside the vocabulary is no row. */
export const writtenRowKind = (w) => (!rowObject(w) || !WRITTEN_LABELS.includes(w.label) ? null
  : w.label === WRITTEN_CONTRADICTED_LABEL ? 'writtenContradicted' : 'writtenOpen');
/** The state of a column the ledger derived (ledger.js `deriveColumn`: `columnState` grounded); every other decision's
 *  column is null with `columnState` unchecked. */
export const DERIVED_COLUMN_STATE = 'grounded';
/** The judgment-first review (low, one counting): who decided a decision, as every reader reads it — its column only
 *  when the ledger derived it (DECISION_COLUMNS, `columnState` DERIVED_COLUMN_STATE), else null (the review could not
 *  tell whether you asked). The page's and the story's groups and the attention summary's kinds read this one rule. */
export const derivedColumn = (d) => (rowObject(d) && DECISION_COLUMNS.includes(d.column)
  && d.columnState === DERIVED_COLUMN_STATE ? d.column : null);
/** D88: the decision kinds by the ledger's derived column (DECISION_COLUMNS): made without asking you, and where you
 *  asked and the agent chose how; a column you settled is no attention row; a column the ledger could not derive (null)
 *  is where the review could not tell whether you asked. */
export const DECISION_ROW_KINDS = Object.freeze({ [DECISION_COLUMNS[2]]: 'unasked', [DECISION_COLUMNS[1]]: 'chose' });
/** D88: the kinds of one published decision: a choice not to act (D71 d: highlighted wherever it is, so counted beside
 *  its column's kind, as before), and its column's. */
export const decisionRowKinds = (d) => (!rowObject(d) ? [] : [...(d.notActing === true ? ['notActing'] : []),
  ...(derivedColumn(d) === null ? ['whetherAsked'] : Object.hasOwn(DECISION_ROW_KINDS, d.column)
    ? [DECISION_ROW_KINDS[d.column]] : [])]);
/** D88: the collapsed section's words, one table for every reader: its heading, its count, the sentence under it, each
 *  group's heading (by FOLDED_ROWS kind), and the line a section says where it holds folded rows. */
export const FOLDED_SECTION_WORDS = Object.freeze({
  heading: 'What Sonah could not check',
  summary: (n) => `What Sonah could not check (${n})`,
  lead: 'Sonah could not check these rows. Each is kept here, with why where the review recorded it, and none is counted '
    + 'where your attention is needed.',
  groups: Object.freeze({ asksNotChecked: 'Asks not checked', claimsOpen: 'Claims not checked against a recorded result',
    claimsIncomplete: 'Claims resting on a check that never completed', failuresNotChecked: 'Failures not checked',
    writtenOpen: 'Statements written into files, not checked' }),
  here: (n, one, many) => `${counted(n, one, many)} Sonah could not check ${n === 1 ? 'is' : 'are'} folded under What `
    + 'Sonah could not check.',
  show: (n) => `Show the ${counted(n, 'row')} Sonah could not check`,
});
export const ATTENTION_WORDS = Object.freeze({
  notActing: (n) => `**${counted(n, 'choice')} not to act** — under What the agent decided.`,
  unasked: (n) => `${counted(n, 'decision')} made without asking you — under What the agent decided.`,
  chose: (n) => `${counted(n, 'decision')} where you asked and the agent chose how — under What the agent decided.`,
  whetherAsked: (n) => `${counted(n, 'decision')} where the review could not check whether you asked — under What the `
    + 'agent decided.',
  pivots: (n) => `${counted(n, 'change')} of approach — under What the agent decided.`,
  asksNotDone: (n) => `${counted(n, 'ask')} of yours shown not done or partly done — under What you asked.`,
  contradicted: (n) => `${counted(n, 'claim')} of the agent's contradicted by the recording — under What the agent told you.`,
  // D87 (owner decisions 2026-10-13/14): the rows the code pass's check found contradicted by the code at review time —
  // claims, asks and decisions (a failure's check is shown on its row only), in the owner's words.
  codeContradicted: (n) => `${n} ${n === 1 ? 'claim' : 'claims'} (asks, decisions) contradicted by the code at review `
    + 'time — under What the code review found.',
  passedOver: (n) => `**${counted(n, 'failure')} the agent passed over** — under Failures it passed over.`,
  forbidden: (n) => `${counted(n, 'edit')} against what you said — under Edits against what you said.`,
  writtenContradicted: (n) => `${counted(n, 'statement')} written into a file and contradicted by a recorded result — under `
    + 'Edits against what you said.',
  codeFindings: (n) => `${counted(n, 'finding')} of the code review — under What the code review found.`,
  notCovered: 'What the review could not cover — the Not covered line at the top.',
  // D88: the one plain line for the folded rows: never counted with the rest, never highlighted.
  folded: (n) => `${counted(n, 'row')} Sonah could not check — folded under What Sonah could not check.`,
  none: 'The review lists nothing below for your attention. That is not a statement that the work is right.',
});

/** D71 (S4), owner decision (b): why an ask was kept as not checked — its closed reason (ledger.js
 *  REQUIREMENT_UNCHECKED_REASONS) in plain words; and the fact code adds beside a row (REQUIREMENT_FACTS). One table for
 *  the session page and the PR comment; the vocabularies stay closed in ledger.js, these are only their reader words. */
export const CHECKLIST_REQUIREMENT_REASON_WORDS = Object.freeze({
  deliverable_ungrounded: 'the evidence the review cited for it was not found word for word in what it was shown',
  deliverable_not_after: 'the evidence the review cited for it was not recorded after you asked, in the same session',
  check_not_completed: 'the result, command or edit the review cited for it never ran to an end',
  shortfall_ungrounded: 'what the review said is missing was not found word for word after you asked',
  ask_unreviewed: 'the review did not name what you asked in this message, so nothing here says whether it was done',
  challenge_refuted: "the review's own check did not uphold the status it first gave",
  challenge_unsettled: "the review's own check on it did not settle",
  challenge_unexecuted: "the review's own check on it did not run",
  // D80: a deliverable quoted only from the body of a write whose command did not run, failed or was stopped.
  [UNRUN_WRITE_REASON]: 'the code the review cited for it is only in a file write whose command did not run, failed or '
    + `${STOPPED_WORDS}, so it may never have been written`,
});
/** S6 (S5 review H1), owner decision D71 (b): why a claim is kept as not checked although the review proposed a basis
 *  for it — its own challenge did not settle (ledger.js PROMISE_UNCHECKED_REASONS), in plain words (the page and the PR
 *  comment). */
export const CHECKLIST_CLAIM_REASON_WORDS = Object.freeze({
  challenge_unsettled: "the review's own check on it did not settle",
  challenge_unexecuted: "the review's own check on it did not run",
});
export const CHECKLIST_REQUIREMENT_FACT_WORDS = Object.freeze({
  no_deliverable_by_end: 'The recording ends here, and the review cites nothing that delivers this ask.',
});
/** D71 (S4), owner decision (c): what the agent did about one failure (ledger.js FAILURE_HANDLINGS), and why a row is not
 *  checked (FAILURE_UNCHECKED_REASONS), in plain words (the page and the PR comment). */
export const CHECKLIST_FAILURE_WORDS = Object.freeze({
  'passed-over': 'Passed over: its turn ended without acting on it or telling you',
  'told-human': 'It told you', 'acted-on': 'It acted on it', 'not-checked': 'Not checked',
});
export const CHECKLIST_FAILURE_REASON_WORDS = Object.freeze({
  response_ungrounded: 'what the review cited for what the agent did was not found word for word in what it was shown',
  response_not_after: 'what the review cited was not recorded after the failure',
  response_other_agent: "what the review cited was another agent's",
  response_not_shown_to_human: "the words the review cited were a helper's, which you are not shown",
  turn_end_not_cited: "the review did not cite the end of the agent's turn after it",
  failure_unreviewed: 'the review said nothing about it',
  challenge_refuted: "the review's own check did not uphold what it first said",
  challenge_unsettled: "the review's own check on it did not settle",
  challenge_unexecuted: "the review's own check on it did not run",
  // D80: an acted-on response quoted only from the body of a write whose command did not run, failed or was stopped.
  [UNRUN_WRITE_REASON]: 'the code the review cited for what the agent did is only in a file write whose command did '
    + `not run, failed or ${STOPPED_WORDS}, so it may never have been written`,
});
/** D71 (S4): a result's typed outcome (ledger.js `resultOutcome`: its class and, where a class has several phrases, its
 *  form — recorder fields only) in plain words, never the recorder's terms (the page
 *  and the PR comment). */
export const CHECKLIST_OUTCOME_WORDS = Object.freeze({
  'ran-failed': (exit) => (Number.isSafeInteger(exit) && exit !== 0 ? `It ran and failed (exit code ${exit}).` : 'It ran and failed.'),
  'failed-or-refused': () => 'It failed, or was refused before it ran; the recording does not say which.',
  'did-not-run': () => 'It did not run: the call was refused.',
  // S7: `stopped` left the table; an interrupted or cancelled call is a form of no terminal
  // status, and a result recorded with none of its output shown is no longer listed (output-no-status `unread`).
  // D80: the one phrase for a stopped call (`STOPPED_WORDS`), and a write whose command failed or was stopped.
  'no-terminal-status': (exit, form) => (form === 'background' ? 'It was started in the background; no end of it was recorded.'
    : form === 'interrupted' || form === 'cancelled' ? `It ${STOPPED_WORDS}.`
      : form === 'command-failed' || form === 'command-stopped'
        ? `Its ${shellWriteWords(form === 'command-failed' ? 'failed' : 'stopped')}.`
        : form === 'none' ? 'No result of it was recorded.' : 'No end of it was recorded.'),
});
/** D71 (e), (g), S4: what contradicts a claim, by the finding's code-set source (ledger.js CONTRADICTION_SOURCES). */
export const CHECKLIST_CONTRADICTION_WORDS = Object.freeze({ result: 'Contradicted by a recorded result',
  human_message: 'Contradicted by your own message', file_content: "Contradicted by a file's recorded content",
  project_instructions: "Contradicted by the project's instruction file",
  // W2 (owner decision 2026-10-13): the text the agent's own edit or write added.
  own_written: 'Contradicted by what the agent itself wrote' });

// M33 (C-06 "M33 per-part verdicts"): one sentence per closed part reason (ledger.js PART_REASONS; asserted
// equal as sets in test/m33-per-part-verdicts.test.js), never built at the call site.
export const PART_REASON_SENTENCE = Object.freeze({
  // D71 (a): a finding is said by what it is, never by a status ("needs a decision", "worth a look").
  finding_decide: 'a finding cites it',
  finding_fyi: 'a finding cites it, beside a recorded fact: the agent corrected or undid it, told you, or a helper said it',
  decide_unsettled: 'a check on an agent claim a recorded result contradicts, or on a change against your instruction, '
    + 'did not settle',
  window_incomplete: 'a review window covering it did not complete',
  proposal_unreadable: 'a review window covering it returned a proposal that could not be read',
  reading_capped: 'a check on a proposal about it could not run',
  review_unattributed: 'a check that could not run names no part, so it is not shown to have been checked',
  no_reviewable_event: 'it has no instruction, message, action or result to review',
  gap_declared: 'a declared coverage gap names its events',
  instruction_omitted: 'a human instruction in it was elided or withheld',
  delegation_unlinked: 'a hand-off in it has no verified child evidence',
  gap_unplaced: 'a declared coverage gap names no recorded event',
  limit_unattributed: 'the session has a coverage limit that no part explains',
});

const COLUMN_HELP = Object.freeze({
  'asked-settled': 'you fixed this, and the agent followed it',
  'asked-chose': 'you raised this, the agent picked the specifics',
  unasked: 'nothing in your instructions covered this — neutral, not automatically wrong',
});

/**
 * M33 brittleness H4 (owner decision, 2026-10-06: keep 12 cards, point to the rest). The words of review.md's card cut,
 * in one place — never built inline, so the wording stays one decision: which cards are shown and the order they follow
 * (`shown`), how many decisions they leave out and in which groups (`left`), and where every decision is listed: the
 * session's review page (`sonah review --format html`, C-06 "Session page"), named by a fixed sentence (`page`) —
 * this comment never writes a URL or a path. `n` is a positive count; `groups` the closed group words, joined.
 */
export const DECISION_CARD_CUT_WORDS = Object.freeze({
  shown: (n, groups) => `Evidence is shown for the first ${n} decisions of the table above, in its order (${groups}; `
    + 'each group in the order the session recorded them).',
  left: (n, groups) => `${n} decision${n === 1 ? ' is' : 's are'} left out of these cards (${groups}) and listed in the `
    + `table with ${n === 1 ? 'its column' : 'their columns'}.`,
  page: 'The full review page lists every decision with its evidence, within the bounds it states.',
});

// One sentence per fact that can leave coverage short of complete, in one place — never built
// inline at the call site, so a per-cause rate stays computable and the wording stays one
// decision. Asserted equal to COVERAGE_CAUSES as a set in test/coverage.test.js. The order is the
// order the header names them in: the session's own facts, then its declared losses, then the PR's.
export const COVERAGE_CAUSES = Object.freeze(['no_windows', 'no_actions', 'windows_incomplete',
  'instructions_elided', 'instructions_withheld', 'instructions_capped', 'instructions_stripped',
  'instructions_nontext', 'instructions_nontext_unplaced',
  'labels_legacy_recorder', 'interruptions_untyped', 'commands_args_unrecorded', 'answers_unrecorded',
  'origins_unknown', 'notifications_unmatched',
  'instructions_refusal_untyped', 'instructions_refusal_session_unknown', 'human_interaction_unknown',
  'delegations_unlinked',
  'delegations_ambiguous',
  'briefs_encrypted', 'messages_encrypted', 'incomplete_inventory',
  'observations_incomplete', 'source_clipped', 'reports_capped', 'statements_capped', 'bodies_capped',
  'unsupported_message', 'unrecorded_body', 'write_outcome_unknown', 'command_outcome_unknown', 'input_limit', 'carry_capped',
  'other_gap', 'code_unreviewable',
  'pr_hunks_withheld',
  'pr_files_incomplete']);

/**
 * How a cause's count is said. `n` is the count; `atLeast` marks it as a lower bound — M33 (C-06): "a
 * cause whose items carry no count is counted by its declarations", and a declaration that stated no
 * count is at least one loss, so a sum over one is at least that sum. A value that is not a count is
 * never printed as one.
 */
const amount = ({ n, atLeast } = {}) => (isCount(n) ? `${atLeast === true ? 'at least ' : ''}${n}` : 'some');
const positiveAmount = (counts = {}) => (isCount(counts.n) && counts.n > 0 ? amount(counts) : 'some');
const one = (counts = {}) => counts.n === 1;

export const COVERAGE_SENTENCE = Object.freeze({
  no_windows: () => 'no review windows were produced',
  no_actions: () => 'no actions were recorded in this session',
  windows_incomplete: ({ n, m }) => `${n} of ${m} review windows did not complete`,
  // F170: these two are also how a declared missing child, or an elided ask, is named when no fact
  // counted it (GAP_HEADER_CAUSE) — and a declaration may state no count.
  instructions_elided: (counts) => `${amount(counts)} instruction(s) were elided by the recorder`,
  // W3e-5 / F212: an ask redaction left no words of (W3e-3 / F198) is missing too, but not by the
  // recorder's hand, and is never credited to it.
  instructions_withheld: (counts) => `${amount(counts)} instruction(s) were withheld by redaction`,
  // M33 R: an ask THIS REVIEW capped (redaction's bound of the ask it scrubbed whole; or an older slicer's cut, Sonah's
  // too). The recorder kept the whole ask, so the cut is never credited to it: the adapter declares it with its own note
  // (INSTRUCTION_GAP_NOTES.capped_before_review), and the header names it in the same terms.
  instructions_capped: (counts = {}) => `${amount(counts)} instruction${one(counts) ? ' was' : 's were'} capped before `
    + `review, so ${one(counts) ? 'its' : 'their'} elided middle cannot be quoted`,
  // M33 R repair: an ask whose pasted material THIS REVIEW replaced by a stub (redaction's strip of the ask it scrubbed
  // whole; or an older slicer's, Sonah's too). The recorder kept the whole ask, so the strip is never credited to it:
  // the adapter declares it with its own note (INSTRUCTION_GAP_NOTES.stripped_before_review).
  instructions_stripped: (counts = {}) => `${amount(counts)} instruction${one(counts) ? ' had' : 's had'} pasted `
    + 'material replaced by a stub before review, so what was stripped cannot be quoted',
  // Gain I (2026-10-13): messages of the human's that carried an image (or other content that is not text) the review
  // was not shown — the adapter's located note (INSTRUCTION_GAP_NOTES.nontext_attached), counted by message — and such
  // parts it could not place at a message (`nontext_unplaced`, counted by part). Before, both read "elided by the
  // recorder", which no recorder did.
  instructions_nontext: (counts = {}) => `${amount(counts)} message${one(counts) ? '' : 's'} of yours carried an image `
    + 'or other content that is not text, which the review was not shown',
  instructions_nontext_unplaced: (counts = {}) => `${amount(counts)} image${one(counts) ? '' : 's'} or other `
    + `part${one(counts) ? '' : 's'} of your input that ${one(counts) ? 'is' : 'are'} not text could not be placed `
    + `at a message of yours and ${one(counts) ? 'was' : 'were'} not shown to the review`,
  // M34 labels (C-02 "Slice-time labels"): each counted label gap, declared by the adapter with its own closed note
  // (sonah-ledger.js `LABEL_GAP_NOTES`), is named by its own cause, never by another's.
  // M34 labels review (F6): every row the fallback labelled is counted, whichever way it read it.
  labels_legacy_recorder: (counts = {}) => `${amount(counts)} recorded user row${one(counts) ? ' was' : 's were'} `
    + 'labelled by the legacy-recorder fallback, which has no typed human channel to go by, so whether '
    + `${one(counts) ? 'it holds' : 'they hold'} an instruction is not proven`,
  interruptions_untyped: (counts = {}) => `${amount(counts)} recorded row${one(counts) ? ' is' : 's are'} untyped where `
    + 'this recorder writes its interruption notice, so where the human interrupted the agent is not recorded',
  commands_args_unrecorded: (counts = {}) => `${amount(counts)} slash command${one(counts) ? '' : 's'} the human ran `
    + `${one(counts) ? 'was' : 'were'} recorded without ${one(counts) ? 'its' : 'their'} arguments, so the words typed `
    + 'with them are not in the instruction history',
  answers_unrecorded: (counts = {}) => `${amount(counts)} question${one(counts) ? '' : 's'} the agent asked the human `
    + `${one(counts) ? 'has' : 'have'} no answer the recording links to ${one(counts) ? 'it' : 'them'}`,
  origins_unknown: (counts = {}) => `${amount(counts)} recorded user row${one(counts) ? '' : 's'} carried an origin the `
    + `recorder's typed vocabulary does not name, so ${one(counts) ? 'it was' : 'they were'} not labelled`,
  // Owner decision 2026-10-07: only notifications whose carried call id names a call the recording does not hold.
  notifications_unmatched: (counts = {}) => `${amount(counts)} background-task notification${one(counts) ? '' : 's'} `
    + `named a background call the recording does not hold, so ${one(counts) ? 'it' : 'they'} could not be linked to the `
    + 'work reported',
  // L1 review (OWNER DECISION 2026-10-06): calls a Claude Code recorder that types no refusal recorded as failed. Any of
  // them may be the human's refusal holding an unread answer: the adapter declares them with its own note
  // (INSTRUCTION_GAP_NOTES.refusal_untyped).
  instructions_refusal_untyped: (counts = {}) => `${amount(counts)} failed call${one(counts) ? ' was' : 's were'} `
    + 'recorded by a version that does not record which calls the human refused, so '
    + `${one(counts) ? 'it' : 'any of them'} may hold an answer that was not read`,
  // L1 session-type review (finding L1S-unknown-type-not-counted): calls refused in a session whose recorder did not
  // record whether a human was there to answer. Each keeps its declaration under the adapter's own note
  // (INSTRUCTION_GAP_NOTES.refusal_session_unknown).
  instructions_refusal_session_unknown: (counts = {}) => `${amount(counts)} refused call${one(counts) ? ' was' : 's were'} `
    + 'recorded in a session that does not record whether a human was there to answer, so '
    + `${one(counts) ? 'it' : 'any of them'} may hold an answer that was not read`,
  // M33 brittleness L3 review: a recorder whose schema the adapter does not know (HUMAN_INTERACTION_UNKNOWN_NOTE) cannot
  // say which of its actions asked the human or recorded the human's choice. Nothing was elided and no instruction is
  // counted: the declaration's count is the session's actions, so the sentence states none.
  human_interaction_unknown: () => 'the recorder\'s schema does not say which actions asked you a question or recorded '
    + 'your choice',
  delegations_unlinked: (counts) => `${amount(counts)} delegation(s) have no verified child evidence`,
  // F191: an `ambiguous_child` had candidate child sessions — more than one — not none, so the
  // sentence above is not true of it. These are the words its declaration's note uses.
  delegations_ambiguous: (counts) => `${amount(counts)} delegation(s) matched more than one candidate child session`,
  // M33 T: a hand-off brief the recorder encrypted (Codex). Missing evidence, but not redaction's doing, and never
  // credited to it: the adapter declares it with its own note (DELEGATION_BRIEF_GAP_NOTES.recorder_encrypted).
  briefs_encrypted: (counts = {}) => `${amount(counts)} delegation brief${one(counts) ? ' was' : 's were'} encrypted by `
    + `the recorder, so ${one(counts) ? 'it' : 'they'} cannot be shown or checked`,
  // M33 F: an inter-agent message whose payload the recorder encrypted (every Codex NEW_TASK and MESSAGE). The adapter
  // declares it on the `children` channel with its own note (INTER_AGENT_GAP_NOTES.encrypted).
  messages_encrypted: (counts = {}) => `${amount(counts)} inter-agent message${one(counts) ? ' was' : 's were'} encrypted `
    + `by the recorder, so ${one(counts) ? 'it' : 'they'} cannot be shown or checked`,
  // F170: every other code a declared gap can cap with. A count no declaration stated is not
  // invented: `coverageCauses` counts such a declaration as one, and says "at least". W3c-8:
  // `unrecorded_body` (F96) and `code_unreviewable` (F106) were the first two.
  incomplete_inventory: (counts = {}) => `${positiveAmount(counts)} part${one(counts) ? '' : 's'} of the session evidence ${one(counts) ? 'was' : 'were'} incomplete`,
  observations_incomplete: (counts = {}) => `${positiveAmount(counts)} action result${one(counts) ? '' : 's'} ${one(counts) ? 'was' : 'were'} missing, withheld, or could not be linked to ${one(counts) ? 'its' : 'their'} action${one(counts) ? '' : 's'}`,
  source_clipped: (counts) => `${amount(counts)} recorded text(s) were cut short by the recorder, so what was cut cannot be quoted`,
  // M33 F: a helper's final report THIS REVIEW capped (the redactor's bound of the scrubbed report). The recorder kept
  // the whole report, so the cut is never credited to it: the adapter declares it with its own note
  // (HELPER_REPORT_CLIPPED_NOTE), and the header names it in the same terms.
  reports_capped: (counts = {}) => `${amount(counts)} helper report${one(counts) ? ' was' : 's were'} capped before `
    + `review, so ${one(counts) ? 'its' : 'their'} elided middle cannot be quoted`,
  // M33 F repair 3: a closing statement THIS REVIEW capped (the redactor's bound of the statement it scrubbed whole; or
  // an older slicer's cut, Sonah's too). The recorder kept the whole statement, so the cut is never credited to it: the
  // adapter declares it with its own note (CLOSING_STATEMENT_CLIPPED_NOTE), and the header names it in the same terms.
  statements_capped: (counts = {}) => `${amount(counts)} closing statement${one(counts) ? ' was' : 's were'} capped `
    + `before review, so ${one(counts) ? 'its' : 'their'} elided middle cannot be quoted`,
  // M33 R: a file body an earlier Sonah capped (redaction's cap of the body it scrubbed whole, the slicer's memory bound,
  // or an older slicer's cut — each Sonah's; D68 E deleted them all, so only a persisted ledger declares one). The recorder kept the whole body, so the cut is never credited to it: the
  // adapter declares it with its own note (BODY_CAPPED_NOTE), and the header names it in the same terms.
  bodies_capped: (counts = {}) => `${amount(counts)} file ${one(counts) ? 'body was' : 'bodies were'} capped before `
    + 'review, so what was cut cannot be quoted',
  unsupported_message: (counts) => `${amount(counts)} record(s) were in a shape the adapter does not support`,
  unrecorded_body: (counts) => `${amount(counts)} write(s) have no recorded body, so the code they wrote cannot be quoted from the session`,
  write_outcome_unknown: (counts) => `${amount(counts)} attempted write(s) have no provable outcome`,
  command_outcome_unknown: (counts) => `${amount(counts)} shell or test command(s) have no provable exit status`,
  input_limit: (counts) => `${amount(counts)} action/result pair(s) were reviewed in separate windows`,
  // M33 X second recheck: earlier evidence code selected for a window (the retired carry) that its request cap kept out.
  // Declared as an `input_limit` with its own closed note (CARRY_CAPPED_NOTE), and named in these terms, never as a split
  // pair. M35 (windowing): no review declares it any more; kept to read a report written before.
  carry_capped: (counts = {}) => `${amount(counts)} earlier item${one(counts) ? '' : 's'} selected for a review window `
    + `${one(counts) ? 'was' : 'were'} not carried into it: its request byte cap could not hold ${one(counts) ? 'it' : 'them'}`,
  // A code outside GAP_CODES (a report written before a code was retired, M72) still caps, and is
  // still said to — with the count it declared (M33), never its code.
  other_gap: (counts = {}) => (isCount(counts.n) && counts.n > 0
    ? `${amount(counts)} loss(es) of a coverage gap this version does not name were declared`
    : 'a coverage gap was declared'),
  code_unreviewable: (counts) => `${amount(counts)} changed file(s) could not be reviewed`,
  pr_hunks_withheld: (counts) => `${amount(counts)} changed hunk(s) were withheld by redaction`,
  // M33: counted by what declared it short — an enumeration that was not complete, and each listed
  // file whose content was not.
  pr_files_incomplete: (counts = {}) => (isCount(counts.n) && counts.n > 0
    ? `the PR file list was incomplete (${amount(counts)} declared shortfall${one(counts) ? '' : 's'})`
    : 'the PR file list was incomplete'),
});

// F170. Which header cause names a declared gap, by its code: its own, or — where a fact above
// already counts the same loss, by every route that declares it — that fact's, so one loss is named
// once. One entry per member of GAP_CODES (asserted equal as sets in test/review-header-footer.test.js),
// so no code can be declared, cap coverage, and go unnamed in the header. F191: an ambiguous
// delegation is the one loss a fact counts (`delegationsUnlinked`) that keeps a cause of its own,
// because the fact's sentence is not true of it; `coverageCauses` takes it out of the fact's count.
export const GAP_HEADER_CAUSE = Object.freeze({
  missing_child: 'delegations_unlinked',
  ambiguous_child: 'delegations_ambiguous',
  incomplete_inventory: 'incomplete_inventory',
  source_clipped: 'source_clipped',
  unsupported_message: 'unsupported_message',
  code_unreviewable: 'code_unreviewable',
  unrecorded_body: 'unrecorded_body',
  write_outcome_unknown: 'write_outcome_unknown',
  command_outcome_unknown: 'command_outcome_unknown',
  input_limit: 'input_limit',
  identity_redacted: 'incomplete_inventory',
  identity_conflict: 'incomplete_inventory',
  source_changed: 'incomplete_inventory',
  source_unreadable: 'incomplete_inventory',
  storage_limit: 'incomplete_inventory',
  missing_result: 'observations_incomplete',
  redacted_content: 'pr_hunks_withheld',
});
// The one code that is a fact above on one channel only: the adapter declares the asks the recorder
// elided as an `incomplete_inventory` on the `instructions` channel, and `instructionsElided` counts
// those same asks. On any other channel it is the code's own cause.
const GAP_HEADER_CAUSE_ON_CHANNEL = Object.freeze({
  instructions: Object.freeze({ incomplete_inventory: 'instructions_elided' }),
  observations: Object.freeze({ incomplete_inventory: 'observations_incomplete' }),
});
// W3e-5 / F212. There the loss has two causes, and the declaration's note — from the adapter's closed
// table (W3e-4 / F204) — says which: the recorder shortened the ask, or redaction withheld every word
// of it (`instructionsWithheld` counts those). A declaration with neither note is named as it was.
const INSTRUCTION_NOTE_CAUSE = Object.freeze({
  [INSTRUCTION_GAP_NOTES.recorder_shortened]: 'instructions_elided',
  [INSTRUCTION_GAP_NOTES.redaction_withheld]: 'instructions_withheld',
  // M33 R: an ask Sonah capped before review, never one the recorder shortened.
  [INSTRUCTION_GAP_NOTES.capped_before_review]: 'instructions_capped',
  // M33 R repair: an ask whose pasted material Sonah stripped before review.
  [INSTRUCTION_GAP_NOTES.stripped_before_review]: 'instructions_stripped',
  // Gain I: nontext content in the human's input, placed at a message or not.
  [INSTRUCTION_GAP_NOTES.nontext_attached]: 'instructions_nontext',
  [INSTRUCTION_GAP_NOTES.nontext_unplaced]: 'instructions_nontext_unplaced',
  // M34 labels: each instructions-channel label gap, by its own note.
  [LABEL_GAP_NOTES.legacy_recorder[1]]: 'labels_legacy_recorder',
  [LABEL_GAP_NOTES.interrupt_untyped[1]]: 'interruptions_untyped',
  [LABEL_GAP_NOTES.command_args_unrecorded[1]]: 'commands_args_unrecorded',
  [LABEL_GAP_NOTES.answer_unrecorded[1]]: 'answers_unrecorded',
  [LABEL_GAP_NOTES.origin_unknown[1]]: 'origins_unknown',
  // L1 review: failed calls on a recorder that types no refusal.
  [INSTRUCTION_GAP_NOTES.refusal_untyped]: 'instructions_refusal_untyped',
  // L1 session-type review: calls refused in a session whose type was not recorded.
  [INSTRUCTION_GAP_NOTES.refusal_session_unknown]: 'instructions_refusal_session_unknown',
  // M33 brittleness L3 review: a recorder schema that cannot say which actions asked the human — no instruction elided.
  [HUMAN_INTERACTION_UNKNOWN_NOTE]: 'human_interaction_unknown',
});
// M33 T. Likewise on the `actions` channel: a brief the recorder encrypted is named as that, not as a part of the
// session evidence that was incomplete. A brief redaction withheld keeps the cause it always had.
const ACTION_NOTE_CAUSE = Object.freeze({
  [DELEGATION_BRIEF_GAP_NOTES.recorder_encrypted]: 'briefs_encrypted',
});
// M33 F. And on the `children` channel: inter-agent messages the recorder encrypted are named as that. Every other
// communication loss (an unparsed row, a final report not attached) keeps the cause it always had.
const CHILDREN_NOTE_CAUSE = Object.freeze({
  [INTER_AGENT_GAP_NOTES.encrypted]: 'messages_encrypted',
});
// M33 F. And on the `observations` channel: a helper report this review capped is named as that, never as a text the
// recorder cut. Every other clipped observation keeps the cause it always had.
const OBSERVATION_NOTE_CAUSE = Object.freeze({
  [HELPER_REPORT_CLIPPED_NOTE]: 'reports_capped',
  // M34 labels: background-task notifications whose carried call id names a call the recording does not hold.
  [LABEL_GAP_NOTES.notification_unmatched[1]]: 'notifications_unmatched',
});
// M33 F repair 3. And on the `commentary` channel: a closing statement this review capped is named as that, never as a
// text the recorder cut. A clipped commentary gap declared without that note keeps the cause it always had.
const COMMENTARY_NOTE_CAUSE = Object.freeze({
  [CLOSING_STATEMENT_CLIPPED_NOTE]: 'statements_capped',
});
// M33 R. And on the `code` channel: a file body this review capped is named as that, never as a text the recorder cut.
// A clipped code gap declared without that note (a PR's, an older report's) keeps the cause it always had.
const CODE_NOTE_CAUSE = Object.freeze({
  [BODY_CAPPED_NOTE]: 'bodies_capped',
});
/** The causes a cut Sonah made is named by: its line under "What was not checked" carries its own note only. */
const SONAH_CUT_CAUSES = Object.freeze(['reports_capped', 'statements_capped', 'instructions_capped',
  'instructions_stripped', 'bodies_capped', 'carry_capped']);
const headerCauseOf = (gap) => {
  if (gap.channel === 'observations' && gap.code === 'input_limit' && gap.note === CARRY_CAPPED_NOTE) return 'carry_capped';
  if (gap.channel === 'code' && gap.code === 'source_clipped' && typeof gap.note === 'string'
      && Object.hasOwn(CODE_NOTE_CAUSE, gap.note)) return CODE_NOTE_CAUSE[gap.note];
  if (gap.channel === 'observations' && gap.code === 'source_clipped' && typeof gap.note === 'string'
      && Object.hasOwn(OBSERVATION_NOTE_CAUSE, gap.note)) return OBSERVATION_NOTE_CAUSE[gap.note];
  if (gap.channel === 'commentary' && gap.code === 'source_clipped' && typeof gap.note === 'string'
      && Object.hasOwn(COMMENTARY_NOTE_CAUSE, gap.note)) return COMMENTARY_NOTE_CAUSE[gap.note];
  if (gap.channel === 'instructions' && gap.code === 'incomplete_inventory' && typeof gap.note === 'string'
      && Object.hasOwn(INSTRUCTION_NOTE_CAUSE, gap.note)) return INSTRUCTION_NOTE_CAUSE[gap.note];
  if (gap.channel === 'actions' && gap.code === 'incomplete_inventory' && typeof gap.note === 'string'
      && Object.hasOwn(ACTION_NOTE_CAUSE, gap.note)) return ACTION_NOTE_CAUSE[gap.note];
  if (gap.channel === 'children' && gap.code === 'incomplete_inventory' && typeof gap.note === 'string'
      && Object.hasOwn(CHILDREN_NOTE_CAUSE, gap.note)) return CHILDREN_NOTE_CAUSE[gap.note];
  const onChannel = Object.hasOwn(GAP_HEADER_CAUSE_ON_CHANNEL, gap.channel) ? GAP_HEADER_CAUSE_ON_CHANNEL[gap.channel] : null;
  if (onChannel && Object.hasOwn(onChannel, gap.code)) return onChannel[gap.code];
  return Object.hasOwn(GAP_HEADER_CAUSE, gap.code) ? GAP_HEADER_CAUSE[gap.code] : 'other_gap';
};

/** What `unrecordedCover` needs from a report: its PR, and what the joined code review placed. */
const coverContextOf = (report) => ({ pr: report.pr ?? null,
  placed: Array.isArray(report.codeCoverageFacts?.placed) ? report.codeCoverageFacts.placed : null });

/** Does the ledger classify this declaration write by write (W3c-10 / F133)? Only an
 *  `unrecorded_body` on the `code` channel scoped to the session: ledger.js `gapCaps`. */
const coverClassified = (gap) => gap.code === 'unrecorded_body' && gap.channel === 'code' && gap.scope === 'session';

/**
 * F170. How much of one declared gap caps coverage: `undefined` when it caps nothing, otherwise
 * `{ n, exact }`. As ledger.js decides it (`gapCaps`, which `honestStatuses` and `buildLedger`
 * apply): every declared gap caps the review it is a loss of, except a declaration the ledger
 * classifies write by write, which caps by the writes nothing covered and no others. Mirrored,
 * because ledger.js exports the rule only through the statuses it computes;
 * test/review-header-footer.test.js asserts the two agree for every gap code on every channel.
 *
 * M33 (C-06): "a cause whose items carry no count is counted by its declarations". A capping
 * declaration that states no positive count is one loss at least — `{ n: 1, exact: false }` — never
 * a count of zero and never an unstated one. A write-by-write declaration that stated no count caps
 * at least the writes it lists (at least one), as `unrecordedCover` computes it.
 */
function cappingCount(gap, context) {
  if (!coverClassified(gap))
    return Number.isSafeInteger(gap.count) && gap.count > 0 ? { n: gap.count, exact: true } : { n: 1, exact: false };
  const { capping, counted } = unrecordedCover(gap, context);
  return capping > 0 ? { n: capping, exact: counted } : undefined;
}

/** Every gap a report declares, once: `runReview` copies the adapter's gap objects onto
 *  `report.gaps`, so the same object can sit on both lists, and a reloaded report carries an equal
 *  copy of it. F164: one declaration per `gapKey`, the first seen. F190: the one list both the
 *  header (`coverageCauses`) and the body (`coverageSection`) read, so they cannot disagree. */
function declaredGapList(report) {
  const list = (value) => (Array.isArray(value) ? value.filter((g) => g !== null && typeof g === 'object') : []);
  const byKey = new Map();
  for (const gap of [...list(report.gaps), ...list(report.session?.adapterGaps)])
    if (!byKey.has(gapKey(gap))) byKey.set(gapKey(gap), gap);
  return [...byKey.values()];
}

/**
 * D69 f (g): where each cause's losses were recorded — the event ids every capping declaration of that cause lists
 * (`declaredGapList`, named by `headerCauseOf` as `coverageCauses` names them), as a Map cause -> ids, in declaration
 * order. Structure only: a declaration that lists no event is not placed. The session page reads it to put a cause
 * beside the steps, decisions, claims and requests it affects; no status or cause reads it.
 */
export function coverageCauseEvents(report) {
  const context = coverContextOf(report);
  const out = new Map();
  for (const gap of declaredGapList(report)) {
    if (cappingCount(gap, context) === undefined || !Array.isArray(gap.eventIds)) continue;
    const ids = gap.eventIds.filter((id) => typeof id === 'string' && id);
    if (!ids.length) continue;
    const cause = headerCauseOf(gap);
    out.set(cause, [...new Set([...(out.get(cause) ?? []), ...ids])]);
  }
  return out;
}

/**
 * Which causes the report's OWN facts establish, in COVERAGE_CAUSES order. Every entry is a fact the
 * code observed or a gap the code declared; none of them is a model field.
 *
 * F170: every declared gap that caps coverage is named, once, under its header cause — not a hand
 * list of the codes someone remembered. Counts are summed across the declarations of one cause, and
 * unstated when any of them stated none. A cause a fact already names keeps the fact's count, which
 * counts that loss by every route that declares it. W3c-10 / F133: of the unrecorded writes, only
 * those nothing covered are a cause; the others are still listed below, and are not why coverage fell.
 */
export function coverageCauses(report) {
  const facts = report.coverageFacts;
  const named = new Map();
  if (facts) {
    if (facts.windows === 0) named.set('no_windows', {});
    if ((Number.isSafeInteger(facts.reviewableEvents) ? facts.reviewableEvents : facts.actions) === 0)
      named.set('no_actions', {});
    if (facts.windowsFailed > 0) named.set('windows_incomplete', { n: facts.windowsFailed, m: facts.windows });
    // W3e-5 / F212: each cause of a missing instruction by its own count. Facts written before the
    // split carry one count of every omitted instruction and no `instructionsWithheld`: the ones
    // redaction withheld are then the ones its declarations say (by their notes), and only the rest
    // are the recorder's — never the whole count.
    const elided = isCount(facts.instructionsWithheld) ? facts.instructionsElided
      : facts.instructionsElided - declaredGapList(report).filter((gap) => headerCauseOf(gap) === 'instructions_withheld')
        .reduce((n, gap) => n + (isCount(gap.count) ? gap.count : 0), 0);
    if (elided > 0) named.set('instructions_elided', { n: elided });
    if (facts.instructionsWithheld > 0) named.set('instructions_withheld', { n: facts.instructionsWithheld });
    if (facts.delegationsUnlinked > 0) named.set('delegations_unlinked', { n: facts.delegationsUnlinked });
    // M33: the declared pair gaps, counted by the code that declared them (`splitPairGaps`) — the
    // same losses its `input_limit` declarations name, so the fact's count is the one kept. M35: only a report
    // written before M35 windowing still carries one (no window cuts an action from its result now).
    if (facts.pairGaps > 0) named.set('input_limit', { n: facts.pairGaps });
  }
  const context = coverContextOf(report);
  // M33 (C-06): every declared cause carries a count. Summed across the cause's declarations; a
  // declaration that stated none counts as one, and makes the sum a lower bound (`atLeast`).
  const declared = new Map();
  for (const gap of declaredGapList(report)) {
    const capping = cappingCount(gap, context);
    if (capping === undefined) continue;
    const cause = headerCauseOf(gap);
    const sum = declared.get(cause) ?? { n: 0, exact: true };
    declared.set(cause, { n: sum.n + capping.n, exact: sum.exact && capping.exact });
  }
  const countsOf = ({ n, exact }) => (exact ? { n } : { n, atLeast: true });
  const unlinkedByFact = named.get('delegations_unlinked');
  for (const [cause, sum] of declared) if (!named.has(cause)) named.set(cause, countsOf(sum));
  // F191. The fact counts every delegation left unlinked, the ambiguous ones with the rest, and its
  // sentence says they have no verified child evidence. The ambiguous cases have a more precise
  // statement of why, so name them once under their own cause and leave the rest under the fact.
  // When the ambiguous count is only a lower bound the rest is unknown, and it is said by the rest's
  // own declarations if any; a rest of zero is not said at all.
  if (unlinkedByFact && declared.has('delegations_ambiguous')) {
    const ambiguous = declared.get('delegations_ambiguous');
    const unlinked = declared.get('delegations_unlinked');
    if (ambiguous.exact) {
      const rest = unlinkedByFact.n - ambiguous.n;
      if (rest > 0) named.set('delegations_unlinked', { n: rest });
      else named.delete('delegations_unlinked');
    } else if (unlinked) named.set('delegations_unlinked', countsOf(unlinked));
    else named.delete('delegations_unlinked');
  }
  // M33: the PR file list is counted by what declared it short: an enumeration that was not
  // complete, and each listed file whose content was not.
  const files = report.pr?.files ?? [];
  const shortFiles = files.filter((f) => f?.contentState !== 'complete').length;
  const shortList = files.length > 0 && report.pr.enumeration !== 'complete' ? 1 : 0;
  if (shortFiles + shortList > 0) named.set('pr_files_incomplete', { n: shortFiles + shortList });
  return COVERAGE_CAUSES.filter((cause) => named.has(cause)).map((cause) => [cause, named.get(cause)]);
}

const RELEVANCE_LABEL = Object.freeze({
  survives: 'in this PR',
  reverted: 'not in this PR',
  'session-effect': 'ran, changed no code',
  // "ran" is itself a claim. An invocation that was denied, cancelled, or has no recorded
  // outcome was attempted and nothing more.
  attempted: 'no record that it ran',
  unchecked: 'unchecked',
});

/** New PR reviews carry counts, not candidate text. Older saved reviews have no funnel. */
function findingFunnelSection(funnel, sessionOnly = false) {
  const valid = (value, keys) => value && keys.every((key) => isCount(value[key]));
  const directKeys = ['proposed', 'responseUnusable', 'deterministicRejected', 'challengeEligible',
    'challengeVoted', 'challengeComplete', 'challengeSurvived', 'grounded'];
  const claimKeys = ['proposed', 'challengeEligible', 'challengeVoted', 'challengeComplete',
    'challengeSurvived', 'grounded'];
  const code = funnel?.direct?.code, session = funnel?.direct?.session;
  const claims = funnel?.narrativeContradictedClaims, final = funnel?.final;
  if (!valid(code, directKeys) || !valid(session, directKeys) || !valid(claims, claimKeys)
      || !valid(final, ['published', 'code', 'session', 'merged'])) return [];
  // An all-zero pipeline is diagnostic bookkeeping, not an outcome. The status and coverage
  // statement already say what the review established, without a wall of zeroes above the gaps.
  if ([...directKeys.map((key) => code[key]), ...directKeys.map((key) => session[key]),
    ...claimKeys.map((key) => claims[key]), final.published, final.code, final.session, final.merged]
    .every((value) => value === 0)) return [];
  const directLine = (label, row) => `- ${label}: ${row.proposed} proposed; `
    + `${row.responseUnusable} in unusable replies; ${row.deterministicRejected} rejected before challenge; `
    + `${row.challengeEligible} eligible; ${row.challengeVoted} voted; ${row.challengeComplete} complete; `
    + `${row.challengeSurvived} survived; ${row.grounded} grounded.`;
  return ['### Finding checks', '',
    ...(sessionOnly ? [] : [directLine('Code', code)]), directLine('Session', session),
    `- Narrative contradiction claims reaching preflight: ${claims.proposed} proposed; ${claims.challengeEligible} eligible; `
      + `${claims.challengeVoted} voted; ${claims.challengeComplete} complete; `
      + `${claims.challengeSurvived} survived; ${claims.grounded} grounded.`,
    sessionOnly
      ? `- Published: ${final.published} session finding(s) after deduplication (${final.merged} merged duplicates).`
      : `- Published: ${final.published} after deduplication (${final.code} code; ${final.session} session; `
        + `${final.merged} merged duplicates).`, '',
    '_These counts describe candidates Sonah received and checked, not bugs it may have missed._', ''];
}

/** An empty decision list has three distinct causes: no session, no grounded choice in a
 * completed reading, or proposed choices that could not be published. Do not call all three a
 * capture gap. The challenge result is code-owned and typed; no candidate text reaches here. */
function emptyDecisionsLine(report) {
  if (report.hasSessionEvidence === false)
    return report.reviewScope === 'session-only'
      ? '_No coding session was supplied, so no decision review was possible. This is a coverage gap: the decisions were not checked._'
      : '_No coding session was linked to this PR, so no decision review was possible. This is a coverage gap: the decisions were not checked._';
  const windows = Array.isArray(report.windowResults) ? report.windowResults : [];
  const unsettled = windows.flatMap((window) => Array.isArray(window?.challenge?.results)
    ? window.challenge.results : [])
    .filter((item) => item?.type === 'decision' && item.executionComplete === true
      && item.resolved !== true && item.survived !== true).length;
  const rejected = Array.isArray(report.rejectedDecisions) ? report.rejectedDecisions.length : 0;
  const uncovered = report.coverage !== 'complete' ? ' Other session evidence was not checked.' : '';
  if (unsettled)
    return `_${unsettled} proposed decision${unsettled === 1 ? '' : 's'} could not be settled by the challengers, so none was published.${uncovered}_`;
  if (rejected)
    return `_${rejected} proposed decision${rejected === 1 ? '' : 's'} could not be grounded, so none was published.${uncovered}_`;
  if (report.coverage === 'complete')
    return '_No grounded decisions were identified in the checked session._';
  return '_No decision was published from the checked session material; the rest was not checked._';
}

/** The primary review surface, as Markdown suitable for a PR comment. D71 (a), owner decision 2026-10-08: no verdict
 *  anywhere — no headline status, no DECIDE / FYI / CLEAN / NO_FINDINGS / UNCHECKED, on any route. The front is the
 *  checklist: whether Sonah's own review ran, what it could not cover, then where your attention is needed. D88 (owner
 *  decision 2026-10-14): it leads with the agent's judgment and the settled problems; the rows Sonah could not check are
 *  listed last, collapsed, and not counted in the summary. Every finding is listed under one heading, with its recorded
 *  facts beside it. */
export function renderReview(report, { title = 'Sonah review' } = {}) {
  // The renderer recomputes what it says of coverage from the report's own facts, whatever an intermediate step wrote
  // (audit A3).
  report = { ...report, ...honestStatuses(report) };
  const out = [];
  const { decisions, findings, counts, coverage } = report;
  const sessionOnly = report.reviewScope === 'session-only';
  // The order findings are listed in: those with no recorded disclosure fact first, then those the agent corrected,
  // undid or told you about, or a helper's own (the review's internal FYI). Only the order reads it; no word does.
  const listed = [...findings.filter((f) => f.status !== 'FYI'), ...findings.filter((f) => f.status === 'FYI')];
  // Put the specific unchecked cause before anything else. A completed review window can coexist with an unlinked
  // result, so a bare coverage state is not an explanation.
  const causes = coverage === 'complete' && report.codeCoverage !== 'partial' ? [] : coverageCauses(report);

  out.push(`## ${title} — ${sessionOnly ? 'session only' : `PR #${report.pr?.number ?? '?'}`}`, '');
  if (sessionOnly) out.push('Scope: coding session only. PR code and diff relevance were outside this review.', '');
  out.push(RUN_STATE_SENTENCE[reviewRunState(report) === 'complete' ? 'complete' : 'incomplete'], '');
  if (causes.length)
    out.push(`Not covered: ${causes.map(([cause, counts]) => COVERAGE_SENTENCE[cause](counts)).join('; ')}.`, '');

  // Plain coverage statement, before any row, so a reader never mistakes a partial read for a whole one. C-06 requires
  // this exact distinction to survive: a PR with no recordings still gets a real code review, and must not be described
  // as though its session had been read. M33 (C-06): an incomplete REVIEW and a recording with declared limits are said
  // apart. D71 (a): each part of the review is said by whether it ran, never by a status.
  const reviewIncomplete = report.sessionReview !== 'complete';
  const coverageNote = report.hasSessionEvidence === false
    ? sessionOnly
      ? 'Session evidence unavailable. No coding session was supplied, so the decisions ledger is not checked, not empty.'
      : `${report.codeCoverage === 'complete' ? 'Code review complete; ' : ''}session evidence unavailable. No coding session was linked to this PR, so the decisions ledger is not checked, not empty.`
    : coverage === 'complete'
      ? `Session evidence complete.${reviewIncomplete ? ' The session review did not complete.' : ''}`
      : coverage === 'partial'
        ? reviewIncomplete
          ? 'Session evidence incomplete; some of this session could not be checked. The session review did not complete.'
          : 'Session evidence incomplete; session coverage is partial because of the recording limits named above. The session review itself completed.'
        : 'Session evidence unavailable; the session review did not complete.';
  // Say plainly when a capability did not run: a review nobody performed is never shown as one that read everything.
  const codeLine = `Code review: **${report.codeCoverage === 'missing' ? sessionOnly ? 'outside this review' : 'not run'
    : RUN_PART_WORDS.code[report.codeCoverage === 'complete' ? 'complete' : 'partial']}**`;
  out.push(`${coverageNote} ${codeLine} · Session review: **${RUN_PART_WORDS.session[reviewIncomplete ? 'incomplete' : 'complete']}**`, '');

  // D71 (a), (S4); D88 (owner decision 2026-10-14): the checklist, in its order (the session page's): where your
  // attention is needed; the agent's judgment — what it decided, its choices not to act marked, its changes of approach;
  // what you asked; the failures it passed over; what the agent told you (its contradicted claims first); the edits
  // against what you said and the statements it wrote into files; what the code review found; and last, collapsed, what
  // Sonah could not check. Then the parts, the session's timeline and what could not be covered. No verdict.
  const { contradicted, edits, codeFindings } = findingParts(listed);
  out.push(...attentionSection(report, { contradicted, edits, codeFindings }, causes.length > 0));
  // D87: the code pass's upheld findings are listed with the code review's (`attentionList` counts them itself).
  codeFindings.push(...codePassFindings(report));
  out.push(...decisionSection(report, sessionOnly));
  out.push(...requirementSection(report));
  out.push(...failuresSection(report));
  out.push(...promiseSection(report, contradicted, sessionOnly));
  out.push(...editsSection(report, edits, sessionOnly));
  out.push(...findingList(CHECKLIST_HEADINGS.code, codeFindings, sessionOnly));
  out.push(...foldedSection(report));
  out.push(...partSection(report));
  out.push(...findingFunnelSection(report.findingFunnel, sessionOnly));
  if (report.session) out.push(...renderTimeline(report.session, report));
  out.push(...coverageSection(report));
  out.push(...withheldSection(report));
  out.push('---', '',
    // M33 brittleness H4: in the order the table lists its rows (C-06 decision order), unasked first.
    '**How to read the columns.** ' +
    DECISION_ORDER.map((c) => `*${COLUMN_LABELS[c]}* — ${COLUMN_HELP[c]}.`).join(' ') +
    ' An unasked choice is neutral: it means nobody asked, not that it is wrong.', '');
  // F77: the per-line mark says which; this says how many. Nothing is printed when nothing was
  // repaired. F172: how many is the report's own count, `counts.receiptsRepaired` — which also
  // counts a settled value code snapped to the instruction's text (F158), a string with no line of
  // its own to mark. A report that carries no count is counted from its marked receipts, as before.
  const counted = report.counts?.receiptsRepaired;
  const repaired = isCount(counted) ? counted
    : new Set(directReceipts(report).filter((r) => r.repaired === true)).size;
  if (repaired) out.push(`_${repaired} receipt quote(s) were snapped to the exact recorded text by code._`, '');
  // M33 X (G01): a claim's contradictedBy or supportedBy that cited a command's action id for its result, moved by
  // code to that action's one recorded result. Counted apart from a snap: the quote did not change, its event did.
  const moved = report.counts?.eventRepairedReceipts;
  if (isCount(moved) && moved > 0) out.push(`_${moved} claim receipt(s) citing an action were moved to its one recorded result by code._`, '');
  // M35 (windowing): a window's agent's earlier thoughts that its carried context's cap left out are declared to the
  // window (the window states how many older thoughts were left out) and in its record, and do not lower
  // coverage — the cap is the design. Said here too, so a CLEAN never reads to a human as if every earlier thought had
  // been read beside every window. Counted per window, as each window's record counts them.
  const older = olderNotCarried(report);
  if (older) out.push(`_${older.windows} review window(s) were not carried all of their agent's earlier messages: ${older.thoughts} `
    + 'older message(s), left out by the carried context\'s cap (counted per window), were not read beside those windows._', '');
  const challengeWork = challengeFooter(report);
  if (challengeWork) out.push(challengeWork, '');
  out.push('_Decisions are advisory. Nothing here approves, merges or changes code. Read it before you share it._');

  return out.join('\n');
}

/** D71 (S4): findings under a checklist heading, each its block, at most `DISPLAY_LIMITS.findings`, the rest counted. */
function findingList(heading, findings, sessionOnly, { lead = [] } = {}) {
  if (!findings.length) return [];
  const lines = [heading, '', ...lead];
  for (const f of findings.slice(0, DISPLAY_LIMITS.findings)) lines.push(...findingBlock(f, sessionOnly));
  if (findings.length > DISPLAY_LIMITS.findings)
    lines.push(`_${findings.length - DISPLAY_LIMITS.findings} further finding(s) are not shown here._`, '');
  return lines;
}

/** D71 (d), S4: a published decision code carried `notActing` on (a choice not to act, anchored on the agent's own
 *  words, its proposition judged by the challenge): highlighted wherever it is listed. */
const notActing = (d) => d?.notActing === true;
export const NOT_ACTING_WORDS = Object.freeze({ mark: '**A choice not to act**',
  count: (n) => `**${n === 1 ? 'One is a choice' : `${n} are choices`} not to act**, marked below: the agent decided not to `
    + 'do something, in its own words.' });

/** What the agent decided (D71 S4: the checklist's third section): the count, the table and the cards in the C-06
 *  decision order, each choice not to act marked; then its changes of approach. */
function decisionSection(report, sessionOnly) {
  const { decisions, counts } = report;
  const out = [CHECKLIST_HEADINGS.decisions, ''];
  if (!decisions.length) {
    out.push(emptyDecisionsLine(report), '');
  } else {
    // M33 brittleness H4: counted in the order the rows below are listed (C-06 decision order).
    out.push(`${counts.decisions} decision${counts.decisions === 1 ? '' : 's'} — ` +
      DECISION_ORDER.map((c) => `${counts.byColumn[c]} ${COLUMN_LABELS[c].toLowerCase()}`).join(' · ') +
      (counts.uncheckedColumn ? ` · ${counts.uncheckedColumn} unchecked` : ''), '');
    const choices = decisions.filter(notActing).length;
    if (choices) out.push(NOT_ACTING_WORDS.count(choices), '');

    out.push(sessionOnly
      ? '| Decision | Relationship to your instructions | Weight |'
      : '| Decision | Relationship to your instructions | Weight | Survives |',
    sessionOnly ? '| --- | --- | --- |' : '| --- | --- | --- | --- |');
    for (const d of decisions) {
      const cells = `| ${notActing(d) ? `${NOT_ACTING_WORDS.mark} — ` : ''}${escapeSource(d.dimension)} — ${escapeSource(d.chosen)} `
        + `| ${columnCell(d)} | ${d.materiality} |`;
      out.push(sessionOnly ? cells : `${cells} ${RELEVANCE_LABEL[d.relevance]} |`);
    }
    out.push('');

    // M33 brittleness H4: the cards follow the table's order (C-06 decision order: who decided, then the order
    // the session recorded them), so a cut leaves out the last rows of that order and says which groups they are
    // in. Materiality is shown on every row and card as a fact; it never picks which rows get a card.
    const shown = decisions.slice(0, DISPLAY_LIMITS.decisionCards);
    for (const d of shown) out.push(...decisionCard(d));
    if (decisions.length > shown.length) {
      // H4 owner decision: the cut states how many decisions it left out, by group, and points to the review page,
      // which lists every one (DECISION_CARD_CUT_WORDS).
      const hidden = decisions.slice(shown.length);
      const groups = [...DECISION_ORDER.map((c) => [c, COLUMN_LABELS[c].toLowerCase()]), [null, 'unchecked']];
      const left = groups.map(([c, words]) => [hidden.filter((d) => (DECISION_ORDER.includes(d.column) ? d.column : null) === c).length, words])
        .filter(([n]) => n > 0).map(([n, words]) => `${n} ${words}`).join(' · ');
      out.push(`_${DECISION_CARD_CUT_WORDS.shown(shown.length, groups.map(([, words]) => words).join(' · '))} `
        + `${DECISION_CARD_CUT_WORDS.left(hidden.length, left)} ${DECISION_CARD_CUT_WORDS.page}_`, '');
    }
  }
  out.push(...pivotSection(report, sessionOnly));
  return out;
}

/** D71 (S4): the edits against what you said (the session's forbidden-edit findings) and the statements the agent
 *  wrote into files. D88: the contradicted statements; the ones not checked are listed under What Sonah could not check
 *  (`foldedSection`), and said so here. */
function editsSection(report, edits, sessionOnly) {
  const written = writtenSection(report, 'writtenContradicted');
  const folded = writtenStatements(report).filter((w) => writtenRowKind(w) === 'writtenOpen').length;
  if (!edits.length && !written.length && !folded) return [];
  return [CHECKLIST_HEADINGS.edits, '', ...findingList('#### Edits against what you said', edits, sessionOnly), ...written,
    ...(folded ? [`_${FOLDED_SECTION_WORDS.here(folded, 'statement')}_`, ''] : [])];
}

export const FAILURE_SECTION_WORDS = Object.freeze({
  intro: 'Every result that failed, did not run, or recorded no end, with what the agent did about it: the review\'s '
    + 'reading, checked against the recording.',
  none: 'No result was recorded as failed, not run, or without an end.',
  more: (n) => `_${n} more not shown here; the session page lists every one._`,
});
/**
 * D71 (c), S4: the failures it passed over — every RESULT code listed (`report.failures`, a checklist report's), with what
 * the agent did about it: the ones it passed over first, in bold, then the ones it acted on or told you about (S7: no
 * fold of calls "nothing came back from" any more — a RESULT recorded with none of its output shown is output-no-status
 * `unread`, never listed). D88: the ones not checked, with why, are listed under What Sonah could not check
 * (`foldedSection`), and this section says how many. Each names its RESULT and action by event id and the tool as
 * recorded; the response by its receipt. A report from before the checklist has no section.
 */
function failuresSection(report) {
  const rows = failureRows(report);
  if (rows === null) return [];
  const lines = [CHECKLIST_HEADINGS.failures, ''];
  if (!rows.length) return [...lines, FAILURE_SECTION_WORDS.none, ''];
  lines.push(FAILURE_SECTION_WORDS.intro, '');
  // D88: the failures it passed over, then the ones it acted on or told you about; the ones whose handling could not be
  // checked are folded under What Sonah could not check (`foldedSection`), and said so here.
  for (const group of [rows.filter((row) => failureRowKind(row) === 'passedOver'),
    rows.filter((row) => failureRowKind(row) === null)]) {
    for (const row of group.slice(0, DISPLAY_LIMITS.findings)) lines.push(...failureLine(row));
    if (group.length > DISPLAY_LIMITS.findings) lines.push(FAILURE_SECTION_WORDS.more(group.length - DISPLAY_LIMITS.findings));
  }
  const folded = rows.filter((row) => failureRowKind(row) === 'failuresNotChecked').length;
  if (folded) lines.push('', `_${FOLDED_SECTION_WORDS.here(folded, 'failure')}_`);
  lines.push('');
  return lines;
}
/** A checklist report's failure rows (each with its RESULT's event id), or null for a report from before the checklist. */
const failureRows = (report) => (Array.isArray(report.failures)
  ? report.failures.filter((row) => row !== null && typeof row === 'object' && typeof row.eventId === 'string') : null);
/** One failure row: what the agent did about it (a handling outside the vocabulary reads not checked), the action and
 *  its result by event id, the outcome in plain words, why it is not checked, and the agent's words or action it cites
 *  (the end of its turn, for one passed over). */
function failureLine(row) {
  const h = Object.hasOwn(CHECKLIST_FAILURE_WORDS, row.handling) ? row.handling : 'not-checked';
  const outcome = Object.hasOwn(CHECKLIST_OUTCOME_WORDS, row.outcome) ? CHECKLIST_OUTCOME_WORDS[row.outcome](null, row.form ?? null) : '';
  const what = `\`${escapeSource(row.action ?? '?')}\`${typeof row.tool === 'string' && row.tool ? ` (${escapeSource(row.tool)})` : ''}`;
  const head = `- ${h === 'passed-over' ? `**${CHECKLIST_FAILURE_WORDS[h]}**` : CHECKLIST_FAILURE_WORDS[h]} — ${what}, `
    + `result \`${escapeSource(row.eventId)}\`: ${outcome}`;
  const why = h === 'not-checked' && Object.hasOwn(CHECKLIST_FAILURE_REASON_WORDS, row.reason)
    ? ` Why it is not checked: ${CHECKLIST_FAILURE_REASON_WORDS[row.reason]}.` : '';
  const said = h !== 'not-checked' && shownReceipt(row.response)
    ? [`  ${receiptLine(row.response, h === 'passed-over' ? { label: 'its turn ended with' } : {})}`] : [];
  return [`${head}${why}`, ...said];
}

/** M35: the windows whose carried context's cap left out some of their agent's earlier thoughts, and how many, counted
 *  per window (`windowResults[].carried.thoughtsLeftOut`), or null when none. */
function olderNotCarried(report) {
  let windows = 0, thoughts = 0;
  for (const result of Array.isArray(report.windowResults) ? report.windowResults : []) {
    const left = result?.carried?.thoughtsLeftOut;
    if (!isCount(left) || left === 0) continue;
    windows++; thoughts += left;
  }
  return windows ? { windows, thoughts } : null;
}

const UNCHECKED_CAUSE = Object.freeze({
  instructions_partial: 'instruction history incomplete',
  receipt_rejected: 'the cited instruction did not check out',
  ambiguous_authority: 'no applicable earlier human instruction',
  column_unchecked: 'the claimed instruction was contradictory',
  // S6 (S5 review H1): a decision kept "could not tell" because its own challenge did not settle (UNSETTLED_CHALLENGE).
  unsettled: "the review's own check on it did not settle",
  unreviewed_scope: "the review's own check on it did not run",
  // W1 A: a decision kept "could not tell" because its check refuted who decided it and no other answer held.
  decision_column_refuted: "the review's own check rejected who it first said decided it, and no other answer held",
});

/**
 * M33 (C-06 "M33 per-part verdicts"). Every part with something to list, with each closed reason's sentence; the parts
 * with nothing to list collapsed into one count; the session-wide limits entry listed once, blamed on no part; and the
 * part counts — the session-wide entry named apart from the parts (review-WP2): not checked, limited, or not at all.
 * D71 (a): never a part's status. Part names, closed reasons and counts only — no session text.
 */
function partSection(report) {
  const parts = Array.isArray(report.parts) ? report.parts : [];
  if (!parts.length) return [];
  const known = (reasons) => (Array.isArray(reasons) ? PART_REASONS.filter((r) => reasons.includes(r)) : []);
  const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
  const countsOf = (counts = {}) => [
    isCount(counts.findings) && counts.findings > 0 ? plural(counts.findings, 'finding') : null,
    isCount(counts.windowsIncomplete) && counts.windowsIncomplete > 0 && isCount(counts.windows)
      ? `${counts.windowsIncomplete} of ${plural(counts.windows, 'window')} incomplete` : null,
    isCount(counts.gaps) && counts.gaps > 0 ? plural(counts.gaps, 'gap') : null,
  ].filter(Boolean);
  const said = (reasons, counts) => {
    const sentences = known(reasons).map((reason) => PART_REASON_SENTENCE[reason]);
    const tally = countsOf(counts);
    return `${sentences.join('; ')}${tally.length ? ` (${tally.join(', ')})` : ''}`;
  };
  const lines = ['### Review by part', ''];
  // A part with nothing to list (the review's internal CLEAN) is only counted; the status itself is never printed.
  const nothing = (part) => part?.status === 'CLEAN';
  for (const part of parts) {
    if (nothing(part)) continue;
    const reasons = said(part?.reasons, part?.counts);
    lines.push(`- \`${escapeSource(part?.part)}\`: ${reasons || 'the review recorded no reason'}.`);
  }
  const quiet = parts.filter(nothing).length;
  if (quiet) lines.push(`- ${plural(quiet, 'part')} with nothing to list.`);
  const wide = report.sessionWideLimits;
  if (wide && (wide.limited === true || known(wide.reasons).length))
    lines.push(`- Session-wide (in no part): ${said(wide.reasons, wide.counts)}.`);
  const causes = report.partCounts;
  if (causes && [causes.parts_fully_checked, causes.parts_partial, causes.parts_unchecked].every(isCount)) {
    const wideState = causes.session_wide_unchecked > 0 ? 'not checked' : wide?.limited === true ? 'limited' : null;
    // M33 K: the parts a check on a contradicted claim or a forbidden edit left unsettled, named only when there are any.
    const unsettled = isCount(causes.parts_decide_unsettled) && causes.parts_decide_unsettled > 0
      ? `${causes.parts_decide_unsettled} with a check that did not settle, ` : '';
    lines.push('', `Parts: ${plural(causes.parts_fully_checked, 'part')} fully checked, ${causes.parts_partial} partial, `
      + `${unsettled}${causes.parts_unchecked} not checked${wideState ? `; session-wide: ${wideState}` : ''}.`);
  }
  lines.push('');
  return lines;
}

function columnCell(d) {
  if (d.column != null) return COLUMN_LABELS[d.column];
  // Naming the real cause matters: "we could not read your instructions" and "the model cited
  // an instruction that does not support this" are different things to tell a reader.
  const cause = d.reasons?.map((r) => UNCHECKED_CAUSE[r]).find(Boolean) ?? 'not established';
  return `**not checked** — ${cause}`;
}

/** Owner decision D83 (2) on the normal column path: the heading of a decision's covering words when a project
 *  instruction file the agent was given holds them (`constrainedBy.referredFrom`, its recorded path): the person's
 *  words written for the agent, never said in the session. (7db6ae5's words.) Later: a path outside the working
 *  tree as written is named by its file name alone (session.js `referredPath`), as on the page and in the story. */
export const REFERRED_FROM_HEADING = (path) => `**Referred from ${escapeSource(referredPath(path))}** (the project's`
  + ' instruction file the agent was given, not said in this session).';

function decisionCard(d) {
  // D71 (d), S4: a choice not to act is marked on its card's own line too.
  const lines = ['<details>', `<summary>${notActing(d) ? '<b>A choice not to act:</b> ' : ''}<b>${escapeSource(d.dimension)}</b> — `
    + `${escapeSource(d.chosen)} · ${columnCellPlain(d)}</summary>`, ''];
  lines.push(`**What was adopted.** ${d.valueState === 'grounded'
    ? `\`${escapeSource(d.value)}\``
    : `_${uncheckedValueSentence(d)}_`}`, '');

  if (d.constrainedBy) {
    const file = d.constrainedBy.instruction?.role === 'project-instructions'
      && typeof d.constrainedBy.referredFrom === 'string' ? d.constrainedBy.referredFrom : null;
    lines.push(file === null ? '**Your instruction.**' : REFERRED_FROM_HEADING(file),
      receiptLine(d.constrainedBy.instruction), '');
    // Name the reversal explicitly. Without this, an amended choice reads as a broken rule.
    //
    // Deliberately no excerpt of the superseded instruction: `supersedes` records THAT this
    // amends it, not WHICH sentence it reversed. Printing the opening of a long brief would
    // show chatty context and imply it was the reversed part — an inference nothing grounds.
    // The full earlier instruction is in the session timeline below.
    if (d.amends?.length) {
      const ids = d.amends.map((id) => `\`${escapeSource(id)}\``).join(', ');
      lines.push(`**This amends your earlier instruction** (${ids}, in the session timeline below). ` +
        'The agent followed the later one. Which part of the earlier instruction it reverses is ' +
        'not recorded, so it is not guessed here.', '');
    }
  } else if (d.column === 'unasked') {
    lines.push('**Your instruction.** None found covering this. The instruction history was complete, so this is a real gap rather than an unread one.', '');
  }

  if (d.stated) lines.push('**What the agent said.**', receiptLine(d.stated), '');
  if (d.valueReceipt) lines.push('**Where it landed.**', receiptLine(d.valueReceipt), '');

  lines.push(`**Weight.** ${d.materiality} (rule \`${d.materialityRule}\`) — a deterministic rule, not a severity score.`, '');
  if (d.reasons?.length) lines.push(`**Not fully checked:** ${d.reasons.map((r) => `\`${r}\``).join(', ')}`, '');
  lines.push('</details>', '');
  return lines;
}

const eventList = (ids) => ids.map((id) => `\`${escapeSource(id)}\``).join(', ');
const citing = (ids) => (ids.length ? ` (${eventList(ids)})` : '');

// M33 (G3, G4). Why a decision's value is shown unchecked, one sentence per cause the LEDGER
// recorded on the row (`valueUnchecked`, ledger.js VALUE_UNCHECKED_CAUSES), in one place. The row
// keeps no value receipt once its value is unchecked (but a `value_paraphrased` row, D79, whose checked receipt
// the ledger keeps and the card shows under "Where it landed"), and the renderer never infers a cause from the
// session: a value that was never proposed is never said to have failed a check, and a write is
// named only when the ledger recorded that write as the cause.
//   not_proposed           no value was proposed: nothing was checked, so nothing failed
//   unquoted               a value was proposed without a quote of the action that adopted it
//   unmatched              the value's quote did not check out against the actions it cites
//   write_outcome_unknown  the value's own write has no established outcome (C-05: a written value
//                          is adopted only from a reported successful write)
//   write_unsuccessful     the value's own write is recorded as failed or cancelled
//   value_paraphrased      (D79) the value's quote is verbatim in its succeeded write but the value is not word for
//                          word in that quote (the only fact code checked): the receipt is kept and shown ("Where
//                          it landed"), the value is not
//   write_command_not_run_or_failed  (D80) the value's quote is only in the body of a write whose command did not run,
//                          failed or stopped before it finished (ledger.js `unrunEnd`)
//   unrecorded            the row carries no recorded cause (a report written before G4, or a cause
//                          outside the vocabulary): no cause is named, because none was recorded
export const VALUE_UNCHECKED_SENTENCE = Object.freeze({
  not_proposed: () => 'No specific value was proposed for this choice, so none is shown.',
  unquoted: () => 'A specific value was proposed without a quote of the recorded action that adopted it, so it is '
    + 'shown as unchecked rather than guessed.',
  unmatched: () => 'The specific value did not check out against the recorded text of the actions it cites, so it is '
    + 'shown as unchecked rather than guessed.',
  write_outcome_unknown: (ids = []) => 'The specific value is shown as unchecked rather than guessed: the recording does '
    + `not establish whether the write it was quoted from${citing(ids)} completed, and this review counts a written value `
    + 'as adopted only when its write is recorded as succeeding.',
  write_unsuccessful: (ids = []) => 'The specific value is shown as unchecked rather than guessed: the write it was quoted '
    + `from${citing(ids)} is recorded as failed or cancelled, so this review counts nothing it wrote as adopted.`,
  value_paraphrased: (ids = []) => 'The specific value is shown as unchecked rather than guessed: the value the review '
    + `gave is not word for word in the code it quoted from the write${citing(ids)}, so that code is shown in its `
    + 'place.',
  [UNRUN_WRITE_REASON]: (ids = []) => 'The specific value is shown as unchecked rather than guessed: the code it was '
    + `quoted from is only in a write${citing(ids)} whose command did not run, failed or ${STOPPED_WORDS}, so it may `
    + 'never have been written.',
  unrecorded: () => 'The specific value was not confirmed from the recorded actions, so it is shown as unchecked '
    + 'rather than guessed.',
});

/** The cause the ledger recorded for an unchecked value, or null when it recorded none it can read. */
function recordedValueCause(d) {
  const cause = d?.valueUnchecked?.cause;
  return typeof cause === 'string' && VALUE_UNCHECKED_CAUSES.includes(cause) ? cause : null;
}

/** The sentence for one unchecked value: the cause the ledger recorded, and the write it recorded
 *  only when the decision itself cites it. */
function uncheckedValueSentence(d) {
  const cause = recordedValueCause(d);
  if (cause === null) return VALUE_UNCHECKED_SENTENCE.unrecorded();
  const action = d.valueUnchecked.action;
  const cited = typeof action === 'string' && Array.isArray(d.actions) && d.actions.includes(action) ? [action] : [];
  return VALUE_UNCHECKED_SENTENCE[cause](cited);
}

function columnCellPlain(d) {
  return d.column == null ? 'not checked' : COLUMN_LABELS[d.column];
}

// M33 (C-06 "M33 self-corrected claims"): one sentence per member of DISCLOSURE_REASONS, and no others
// (asserted equal as sets in test/m33-h1-self-corrected.test.js). `claimed` is the display form of
// the claim's own verified quote, never the model's paraphrase of it. M33 H (C-06 "M33 helper-internal claims",
// owner decision 2026-10-01): `helper_internal` says in plain words that the claim was a helper agent's internal
// statement, which the human was not shown.
export const DISCLOSURE_SENTENCE = Object.freeze({
  self_corrected: (claimed) => `Claimed ${claimed}; a recorded result contradicted it; corrected later in the same turn.`,
  helper_internal: (claimed) => `Claimed ${claimed} by a helper agent, in its own work or its report to the main agent: `
    + 'an internal statement you were not shown; a recorded result contradicted it. If the main agent passed it on to '
    + 'you, that statement is reviewed as the main agent\'s own claim.',
  // M33 brittleness M4: an edit against your instruction the agent told you about, as its own statement shows — a
  // proposition checked by code and upheld by the challengers, never a statement merely cited among the receipts.
  // D64 wording (owner decision 2026-10-07): it says what the challengers upheld — the agent told you it went against
  // your instruction — not only that it told you about the change.
  disclosed: (said) => `The agent told you it went against your instruction: ${said}.`,
});
/** M33 H: the header tag of a helper-internal contradiction, beside its FYI status. */
export const HELPER_INTERNAL_TAG = 'helper\'s internal statement';

const [SELF_CORRECTED, HELPER_INTERNAL, DISCLOSED] = DISCLOSURE_REASONS;
const shownReceipt = (r) => r !== null && typeof r === 'object' && typeof r.eventId === 'string' && typeof r.quote === 'string';
/** The claim's verified quote of an FYI `claim_contradicted` row carrying the disclosure `reason`, or null. */
function disclosedClaim(f, reason) {
  if (f?.kind !== 'claim_contradicted' || f.status !== 'FYI' || f.disclosureReason !== reason) return null;
  return (Array.isArray(f.receipts) ? f.receipts : []).find((r) => shownReceipt(r) && r.role === 'commentary') ?? null;
}

/**
 * The parts a self-corrected contradiction is shown with — the claim's verified quote and the two
 * resolution receipts — or null. Only an FYI `claim_contradicted` row carrying a closed disclosure
 * and both receipts is one (M33 H: a helper's own claim that was also self-corrected keeps them under
 * `helper_internal`); any other row, whatever it carries, renders as the status it has.
 */
function selfCorrection(f) {
  const claimed = disclosedClaim(f, SELF_CORRECTED) ?? disclosedClaim(f, HELPER_INTERNAL);
  const { observation, statement } = f?.resolvedBy ?? {};
  return claimed && shownReceipt(observation) && shownReceipt(statement) ? { claimed, observation, statement } : null;
}

/**
 * M33 N (C-06 "M33 forbidden edits"): the plain words a forbidden edit is shown with — what you said beside what the
 * agent wrote, ran or removed (M33 brittleness M3), and the undoing code proved. Closed: one label per
 * FORBIDDEN_EDIT_BREACHES member. M33 brittleness M4 session route (owner decision 2026-10-06): no "The agent told you"
 * line from a statement code only verified — the agent's statement is shown only as an upheld disclosure, by
 * DISCLOSURE_SENTENCE.disclosed, on both routes.
 */
export const FORBIDDEN_EDIT_WORDS = Object.freeze({
  instruction: 'You said', wrote: 'The agent wrote', ran: 'The agent ran',
  // W1 B (owner decision 2026-10-13): a rule the project's instruction file holds, given to the agent before the change.
  file: "The project's instruction file",
  // M33 brittleness M3: what an edit took out of a file.
  removed: 'The agent removed',
  reverted: 'The agent undid it later in the same turn',
});
/** The header tag of a forbidden edit code proved undone in the same turn, beside its FYI status. */
export const FORBIDDEN_EDIT_REVERTED_TAG = 'undone in the same turn';

/** A forbidden edit's parts — its instruction and violation receipts and what the violation is — or null for any
 *  other row. Only an `edit_under_negative_requirement` row carrying a closed `breach` (code-set) is one. */
function forbiddenEditOf(f) {
  if (f?.kind !== 'edit_under_negative_requirement' || !FORBIDDEN_EDIT_BREACHES.includes(f.breach)) return null;
  const receipts = Array.isArray(f.receipts) ? f.receipts : [];
  // W1 B: the rule is your instruction or the project's instruction file (role project-instructions, code's).
  const instruction = receipts.find((r) => shownReceipt(r) && ['instruction', 'project-instructions'].includes(r.role));
  const violation = receipts.find((r) => shownReceipt(r) && (r.role === 'code' || r.role === 'action'));
  if (!instruction || !violation) return null;
  return { instruction, violation, breach: f.breach,
    reverted: f.status === 'FYI' && f.disclosureReason === SELF_CORRECTED && shownReceipt(f.revertedBy) ? f.revertedBy : null };
}

/** M33 N: a forbidden edit's quotes side by side, in plain words, then the undoing. */
function forbiddenEditLines(edit) {
  const cell = (r) => `${quoteDisplay(r.quote)} \`${escapeSource(r.eventId)}\``;
  const rule = edit.instruction.role === 'project-instructions' ? FORBIDDEN_EDIT_WORDS.file
    : FORBIDDEN_EDIT_WORDS.instruction;
  const lines = [`| ${rule} | ${FORBIDDEN_EDIT_WORDS[edit.breach]} |`, '| --- | --- |',
    `| ${cell(edit.instruction)} | ${cell(edit.violation)} |`, ''];
  if (edit.reverted) lines.push(`${FORBIDDEN_EDIT_WORDS.reverted}: \`${escapeSource(edit.reverted.eventId)}\` `
    + `(\`${escapeSource(edit.reverted.quote)}\`).`, '');
  return lines;
}

function findingBlock(f, sessionOnly = false) {
  // f.kind and the anchor line numbers originate in model output and were the only strings in
  // the render that bypassed escaping. Line numbers are coerced to integers rather than escaped,
  // because a non-integer line number is not a location at all.
  // F19: the caller marks which findings it has not reported before. The header said how many
  // were new while the body said which was which nowhere, so a reader could not tell them apart.
  // `isNew` is a caller fact, and only strictly true counts — a truthy value is not a claim.
  const tag = f.isNew === true ? ' · `new`' : '';
  const corrected = selfCorrection(f);
  // M33 H: a helper's own statement says so, in its header and in words, before anything else about it.
  const helper = disclosedClaim(f, HELPER_INTERNAL);
  // M33 N: a forbidden edit shows what you said beside what the agent wrote or ran, in plain words.
  const forbidden = forbiddenEditOf(f);
  // D71 (a): the header names the finding's kind and its recorded facts, never its status.
  const lines = [`**${escapeSource(f.title)}**  \`${escapeSource(f.kind)}\``
    + `${helper ? ` · ${HELPER_INTERNAL_TAG}` : ''}${corrected ? ' · self-corrected' : ''}`
    + `${forbidden?.reverted ? ` · ${FORBIDDEN_EDIT_REVERTED_TAG}` : ''}${tag}`,
  '', escapeSource(f.explanation), ''];
  if (helper) lines.push(DISCLOSURE_SENTENCE.helper_internal(quoteDisplay(helper.quote)), '');
  else if (corrected) lines.push(DISCLOSURE_SENTENCE.self_corrected(quoteDisplay(corrected.claimed.quote)), '');
  // M33 brittleness M4: an FYI edit the agent disclosed, by its upheld statement — on either route (owner decision
  // 2026-10-06), a session-only forbidden edit's included.
  const disclosed = f?.kind === 'edit_under_negative_requirement' && f.status === 'FYI' && f.disclosureReason === DISCLOSED
    && shownReceipt(f.disclosedBy) ? f.disclosedBy : null;
  if (disclosed) lines.push(DISCLOSURE_SENTENCE.disclosed(`${quoteDisplay(disclosed.quote)} \`${escapeSource(disclosed.eventId)}\``), '');
  if (forbidden) lines.push(...forbiddenEditLines(forbidden));
  const startLine = Number.isSafeInteger(f.anchor?.startLine) ? f.anchor.startLine : null;
  const endLine = Number.isSafeInteger(f.anchor?.endLine) ? f.anchor.endLine : null;
  if (f.anchor && startLine != null && endLine != null)
    lines.push(`Location: \`${escapeSource(f.anchor.path)}\` lines ${startLine}–${endLine}`, '');
  else if (f.scope === 'session-effect')
    lines.push(sessionOnly
      ? '_This concerns recorded session events; no PR location was reviewed._'
      : '_This concerns what happened during the session, so it has no line in the diff._', '');
  // M33 H repair: a helper-internal row's statements — its claim and, when self-corrected, its correction — are the
  // helper's own (code proved every commentary receipt of it is), so they are labelled the helper's, as the story does.
  const said = { helper: helper !== null };
  const source = f.kind === CLAIM_FINDING_KIND && Object.hasOwn(CONTRADICTING_ROLE_LABEL, f.contradictionSource)
    ? f.contradictionSource : null;
  lines.push('Receipts:', ...f.receipts.map((r) => receiptLine(r, source && r.role === 'code'
    ? { ...said, label: CONTRADICTING_ROLE_LABEL[source] } : said)), '');
  if (corrected)
    lines.push('Corrected later in the same turn:', receiptLine(corrected.observation, said), receiptLine(corrected.statement, said), '');
  // W3-6: the same defect reached the ledger twice in two framings and merged into this row.
  // Naming the other framing keeps the merge visible — a finding that simply vanished would be
  // indistinguishable from one that was never reported.
  if (f.alsoReportedAs?.length)
    lines.push(`_(also reported as: ${f.alsoReportedAs.map((t) => escapeSource(t)).join('; ')})_`, '');
  return lines;
}

// One sentence per member of GAP_CODES, and no others — the two are asserted equal as sets in
// packages/evidence/test/vocabulary.test.js (M72).
export const GAP_SENTENCE = Object.freeze({
  source_clipped: 'the recorder stripped some source text, so quotes from it cannot be checked',
  unsupported_message: 'some records were in a shape the adapter does not support',
  incomplete_inventory: 'some session evidence was incomplete',
  missing_child: 'work was delegated but no child recording matched a verified inventory, so that work is unreviewed',
  ambiguous_child: 'work was delegated but could not be matched to exactly one sub-agent session',
  identity_redacted: 'a required recording identity was withheld by redaction, so the child link could not be verified',
  identity_conflict: 'recording identities conflicted, so the child link could not be verified',
  source_changed: 'a recording changed between verification and reading, so its evidence could not be trusted',
  source_unreadable: 'a recording could not be read, so its evidence was not reviewed',
  storage_limit: 'a recording exceeded a declared reading limit, so its evidence was not reviewed',
  missing_result: 'a recorded tool call has no verifiable matching result',
  redacted_content: 'some diff hunks were withheld by redaction; retained hunks can be checked but code coverage remains partial',
  // F106: the code review's own loss. Nothing was cut by a recorder; the review could not read it.
  code_unreviewable: 'the code review could not read these changed files, so nothing in them was checked',
  // F96: a shell write (`sed -i`, a heredoc, `tee`) or a write the recorder kept no text for.
  // F163: printed only where no per-cover line is (`unrecordedLines`): a declaration the ledger caps
  // whole, or one that lists no write and states no count — so it never sits above a line saying the
  // diff covered some of the code it says none of can be checked.
  unrecorded_body: 'the recording does not contain the body these writes put on disk, so none of that code can be quoted or checked from the session',
  // M28: an attempted status-bearing action whose outcome cannot be established, even if no
  // finding was proposed about it. Any dependent finding is separately withheld.
  write_outcome_unknown: 'the recording does not establish whether these attempted writes completed',
  command_outcome_unknown: 'the recording does not establish whether these shell or test commands completed',
  input_limit: 'an action and its recorded result were shown in separate review windows, so their relationship was not checked together',
});

// W3c-10 / F133. What covered the writes of one `unrecorded_body` declaration, one sentence per
// member of UNRECORDED_COVER plus `none` for the writes nothing covered — asserted equal as sets
// in test/vocabulary.test.js. Printed under the gap, counted, so a covered write stays visible.
// F163: each is the whole sentence for its writes — that their body is not recorded AND what that
// means for them — so the gap needs no generic headline, which said none of the code could be
// checked while the line under it said the diff had covered some of it.
export const UNRECORDED_COVER_SENTENCE = Object.freeze({
  diff: 'write(s) with no recorded body are covered by the reviewed diff — the code review read these files in the pull request, so they do not limit session coverage',
  outside: 'write(s) with no recorded body are outside the repository — not code under review, so they do not limit session coverage',
  none: 'write(s) with no recorded body are covered by nothing — the code they wrote cannot be quoted or checked from the session, so they limit session coverage',
});

/**
 * The per-cover lines under one `unrecorded_body` declaration, in a fixed order, only the covers
 * present. F163: only for a declaration the ledger classifies write by write (`coverClassified`).
 * Any other — one on the `children` channel, say — caps the session whole, whatever covered its
 * writes, so a cover line saying they "do not limit session coverage" would contradict the verdict
 * above it; its one phrasebook sentence, which is true of it, stands instead.
 */
function unrecordedLines(gap, report) {
  if (!coverClassified(gap)) return [];
  const { byCover } = unrecordedCover(gap, coverContextOf(report));
  return ['diff', 'outside', 'none'].filter((cover) => byCover[cover] > 0)
    .map((cover) => `  - ${byCover[cover]} ${UNRECORDED_COVER_SENTENCE[cover]}.`);
}

// The same code means something more specific on the `children` channel: a loss there is about
// DELEGATED work, not about this session's own record (F50). An `incomplete_inventory` declared
// by a linked child read as "the session inventory was incomplete", which is a statement about
// the wrong session. One variant per member of GAP_CODES, in the phrasebook rather than built
// at the call site, so a per-code rate stays computable on both channels.
export const GAP_SENTENCE_CHILDREN = Object.freeze({
  source_clipped: 'the recorder stripped source text from a delegated sub-agent session, so quotes from that work cannot be checked',
  unsupported_message: 'a hand-off result or delegated-session record was in a shape the adapter does not support',
  incomplete_inventory: 'sub-agent work could not be fully verified against the available recording inventory',
  missing_child: 'work was delegated but no child recording matched a verified inventory, so that work is unreviewed',
  ambiguous_child: 'work was delegated but could not be matched to exactly one sub-agent session',
  identity_redacted: 'a required delegated-session identity was withheld by redaction, so the child link could not be verified',
  identity_conflict: 'delegated-session identities conflicted, so the child link could not be verified',
  source_changed: 'a delegated recording changed between verification and reading, so its work was not reviewed',
  source_unreadable: 'a delegated recording could not be read, so its work was not reviewed',
  storage_limit: 'a delegated recording exceeded a declared reading limit, so its work was not reviewed',
  missing_result: 'a hand-off tool call has no verifiable matching result',
  redacted_content: 'some diff hunks were withheld by redaction; retained hunks can be checked but code coverage remains partial',
  // A code-review loss is never a child's; the variant exists so the book stays one per code.
  code_unreviewable: 'the code review could not read these changed files, so nothing in them was checked',
  // F163: the same defect as the session entry could have — a sentence saying none of the code can be
  // checked above cover lines saying the diff covered some — cannot arise here: the ledger caps a
  // children-channel declaration whole and classifies none of its writes, so no cover line is printed
  // beside it (`unrecordedLines`), and this sentence is true of every write it declares.
  unrecorded_body: 'a delegated sub-agent session made writes whose bodies its recording does not contain, so that code cannot be quoted or checked',
  write_outcome_unknown: 'the delegated sub-agent recording does not establish whether these attempted writes completed',
  command_outcome_unknown: 'the delegated sub-agent recording does not establish whether these shell or test commands completed',
  input_limit: 'a delegated action and its result were shown in separate review windows, so their relationship was not checked together',
});

/** What was tried and thrown away. The diff contains only the survivor, so this section is the
 *  one a reviewer cannot reconstruct from the code at any level of effort. */
function pivotSection(report, sessionOnly = false) {
  const pivots = report.pivots ?? [];
  if (!pivots.length) return [];
  const lines = [CHECKLIST_HEADINGS.pivots, '',
    sessionOnly
      ? '_These approaches were attempted and abandoned in the recorded session._'
      : '_These approaches were attempted and abandoned. Only the survivor appears in the diff._', ''];
  for (const p of pivots) {
    lines.push(`**${escapeSource(p.abandoned)}** → **${escapeSource(p.adopted)}**`, '');
    if (p.whyAbandoned) lines.push(escapeSource(p.whyAbandoned), '');
    lines.push('Receipts:', ...p.receipts.map((r) => receiptLine(r)), '');
  }
  return lines;
}

/**
 * D71 (a), (S4), owner decisions 2026-10-08: where the checklist points your attention — one line per place with anything
 * in it, each a count and the section that lists it, in the checklist's order; a choice not to act and a failure passed
 * over in bold. Counts of rows the report holds only, by their closed tokens; nothing done is counted (no grade), no
 * status, no rank, no word of the model's. When nothing is counted it says so, and that this is not a statement that the
 * work is right. D88: only ATTENTION_ROWS are counted; then one plain line says how many rows Sonah could not check are
 * folded, and where.
 */
function attentionSection(report, parts, notCovered) {
  const { lines, folded } = attentionList(report, parts, notCovered);
  return [ATTENTION_HEADING, '', ...(lines.length ? lines.map((words) => `- ${words}`) : [ATTENTION_WORDS.none]),
    ...(folded ? ['', folded] : []), ''];
}

/** The report's findings by where the checklist places them: a contradicted claim under what the agent told you, an edit
 *  against what you said under the edits, any other (the code review's) under what the code review found. */
const findingParts = (findings) => ({ contradicted: findings.filter((f) => f.kind === CLAIM_FINDING_KIND),
  edits: findings.filter((f) => f.kind === FORBIDDEN_FINDING_KIND),
  codeFindings: findings.filter((f) => f.kind !== CLAIM_FINDING_KIND && f.kind !== FORBIDDEN_FINDING_KIND) });

/**
 * D71 (a), (d); S6 (S5 review M2); D88: the checklist's attention summary for a reader with the report only (the CLI, the
 * PR comment): the same lines, in the same order, as the review's "Where your attention is needed" — counts and fixed
 * words, a choice not to act and a failure passed over in bold — and the one plain line that says how many rows Sonah
 * could not check are folded and where (`folded`, null when none is), and the counts by kind they say (`counts`:
 * `checklistRowCounts`). Never a status.
 */
export function attentionSummary(report) {
  const read = { ...report, findings: Array.isArray(report?.findings) ? report.findings.filter((f) => f !== null
    && typeof f === 'object') : [] };
  let honest = read;
  try { honest = { ...read, ...honestStatuses(read) }; } catch { honest = read; }
  let causes = [];
  if (!(honest.coverage === 'complete' && honest.codeCoverage !== 'partial'))
    try { causes = coverageCauses(honest); } catch { causes = [{}]; }
  return attentionList(honest, findingParts(honest.findings), causes.length > 0);
}
/** The attention summary's counted lines alone (`attentionSummary`), as before D88: the lines that point attention. */
export const attentionLines = (report) => attentionSummary(report).lines;

/**
 * D88: the checklist rows the report holds, counted by kind — every member of ATTENTION_ROWS and FOLDED_ROWS, each read
 * from its closed tokens (`askRowKind`, `claimRowKind`, `failureRowKind`, `writtenRowKind`, `decisionRowKinds`) — over
 * the rows the review lists: the claims beside the findings (`promisesBesideFindings`), the failure rows with a RESULT,
 * the written statements with words. `contradicted`, `edits`, `codeFindings`: the findings by where the checklist places
 * them (`findingParts`); the code pass's rows and findings are counted from the report (D87: it lowers no count).
 */
export function checklistRowCounts(report, { contradicted = [], edits = [], codeFindings = [] } = {}) {
  const rows = (value) => (Array.isArray(value) ? value.filter((row) => row !== null && typeof row === 'object') : []);
  return rowKindCounts({ decisions: rows(report.decisions), pivots: rows(report.pivots).length,
    requirements: rows(report.requirements), contradicted: contradicted.length,
    codeContradicted: codeContradictedRows(report).length, failures: failureRows(report) ?? [], forbidden: edits.length,
    written: rows(report.writtenClaims).filter((w) => typeof w.text === 'string'),
    codeFindings: codeFindings.length + codePassFindings(report).length, promises: listedPromises(report) });
}
/**
 * The judgment-first review (low, one counting): the one function every reader counts its rows with, by kind — every
 * member of ATTENTION_ROWS and FOLDED_ROWS, each row read by the shared rules (`decisionRowKinds`, `askRowKind`,
 * `failureRowKind`, `writtenRowKind`, `claimRowKind`). A reader passes the rows it lists (the CLI and the PR comment the
 * report's, through `checklistRowCounts`; the page its own, which list the same claims, `listedPromises`, and read who
 * decided by the same rule, `derivedColumn`) and the counts of what it places by finding. Pure.
 */
export function rowKindCounts({ decisions = [], pivots = 0, requirements = [], contradicted = 0, codeContradicted = 0,
  failures = [], forbidden = 0, written = [], codeFindings = 0, promises = [] } = {}) {
  const counts = Object.fromEntries([...ATTENTION_ROWS, ...FOLDED_ROWS].map((kind) => [kind, 0]));
  const add = (kind) => { if (kind !== null && Object.hasOwn(counts, kind)) counts[kind] += 1; };
  for (const d of decisions) decisionRowKinds(d).forEach(add);
  counts.pivots = pivots;
  for (const r of requirements) add(askRowKind(r));
  counts.contradicted = contradicted;
  counts.codeContradicted = codeContradicted;
  for (const row of failures) add(failureRowKind(row));
  counts.forbidden = forbidden;
  for (const w of written) add(writtenRowKind(w));
  counts.codeFindings = codeFindings;
  for (const p of promises) add(claimRowKind(p));
  return counts;
}
/** The claims the review lists: those beside the findings (C-06 M33 G3: one a contradicted-claim finding cites is that
 *  finding), each with words. The judgment-first review (low, one counting): every reader lists these, the page and the
 *  story included. */
export const listedPromises = (report) => promisesBesideFindings(Array.isArray(report.promises) ? report.promises : [],
  Array.isArray(report.findings) ? report.findings : []).promises
  .filter((p) => p !== null && typeof p === 'object' && typeof p.text === 'string');

/** The attention lines' words, in ATTENTION_ROWS' order, one per kind with anything in it (`attentionSection`), the line
 *  for what the review could not cover, and (D88) the plain line for the folded rows, or null. */
function attentionList(report, parts, notCovered) {
  const counts = checklistRowCounts(report, parts);
  const lines = ATTENTION_ROWS.filter((kind) => counts[kind] > 0).map((kind) => ATTENTION_WORDS[kind](counts[kind]));
  if (notCovered) lines.push(ATTENTION_WORDS.notCovered);
  const folded = FOLDED_ROWS.reduce((n, kind) => n + counts[kind], 0);
  return { lines, folded: folded > 0 ? ATTENTION_WORDS.folded(folded) : null, counts };
}

/** The status cell of a requirement row, by its token: the legacy statuses as before, a checklist's in its words. */
const REQUIREMENT_CELL_WORDS = Object.freeze({ addressed: 'done', open: '**open**', 'partly-addressed': 'partly',
  done: 'done', 'partly-done': 'partly done', 'not-done': '**not done**', 'not-checked': 'not checked' });
const CHECKLIST_STATUSES = Object.freeze(['done', 'partly-done', 'not-done', 'not-checked']);

/** D71 (S4): a checklist ask's evidence cell — what settles it, what is missing, the checks it rests on that never
 *  completed (by event id), why it is not checked, the fact beside it — each receipt as recorded (event and quote). */
function evidenceCell(r) {
  const quote = (receipt) => (shownReceipt(receipt) ? `${quoteDisplay(receipt.quote)} \`${escapeSource(receipt.eventId)}\`` : null);
  const parts = [
    quote(r.deliverable) && `settled by ${quote(r.deliverable)}`,
    quote(r.shortfall) && `missing: ${quote(r.shortfall)}`,
    Array.isArray(r.restsOn) && r.restsOn.length ? `rests on a check that never completed: ${r.restsOn
      .filter((id) => typeof id === 'string').map((id) => `\`${escapeSource(id)}\``).join(', ')}` : null,
    Object.hasOwn(CHECKLIST_REQUIREMENT_REASON_WORDS, r.reason) ? `why not checked: ${CHECKLIST_REQUIREMENT_REASON_WORDS[r.reason]}` : null,
    ...(Array.isArray(r.facts) ? r.facts.filter((fact) => Object.hasOwn(CHECKLIST_REQUIREMENT_FACT_WORDS, fact))
      .map((fact) => CHECKLIST_REQUIREMENT_FACT_WORDS[fact]) : []),
  ].filter(Boolean);
  return parts.length ? parts.join('; ') : '—';
}

/** Requirements are a LEDGER, never accusations. "Still open" is a neutral status, and the
 *  product deliberately withdrew "asked and never done" as a finding. D71 (S4): what you asked, first after the summary;
 *  no tally of what is done (a count that reads as a grade); a checklist ask shows your words and, beside its status,
 *  the evidence code checked it against, or why it is not checked. D88: after the agent's judgment, the settled asks —
 *  not done, partly done, done; an ask not checked is listed under What Sonah could not check (`foldedSection`), and
 *  this section says how many. */
function requirementSection(report) {
  const requirements = report.requirements ?? [];
  if (!requirements.length) return [];
  const checklist = requirements.some((r) => CHECKLIST_STATUSES.includes(r?.status));
  const folded = requirements.filter((r) => askRowKind(r) === 'asksNotChecked');
  const shown = requirements.filter((r) => askRowKind(r) !== 'asksNotChecked');
  const lines = [CHECKLIST_HEADINGS.requests, '',
    checklist ? 'Each status was checked by code against the evidence beside it. A row the review could not settle is kept as '
      + 'not checked, with why, under What Sonah could not check.'
      : 'This is a ledger, not a list of faults — an open item is simply still open.', ''];
  if (shown.length) lines.push(...requirementTable(shown, checklist), '');
  if (folded.length) lines.push(`_${FOLDED_SECTION_WORDS.here(folded.length, 'ask')}_`, '');
  return lines;
}

/** The requirement rows as a table, least addressed first, at most `DISPLAY_LIMITS.findings`, the rest counted: a
 *  checklist row with your words and its evidence cell, a legacy row with the review's words. */
function requirementTable(requirements, checklist) {
  // D71 (S2): a checklist's statuses (ledger.js REQUIREMENT_STATUSES) in the page's words, beside the legacy ones.
  const rank = { open: 0, 'not-done': 0, 'partly-addressed': 1, 'partly-done': 1, 'not-checked': 2, addressed: 3, done: 3 };
  const sorted = [...requirements].sort((a, b) => (rank[a.status] ?? 4) - (rank[b.status] ?? 4));
  const lines = checklist ? ['| Status | What you asked | What settles it, or what is missing |', '| --- | --- | --- |']
    : ['| Status | Requirement |', '| --- | --- |'];
  for (const r of sorted.slice(0, DISPLAY_LIMITS.findings)) {
    const status = REQUIREMENT_CELL_WORDS[r.status] ?? 'partly';
    if (!checklist) { lines.push(`| ${status} | ${escapeSource(r.text)} |`); continue; }
    // Code's own row for a message no row cites has no quote: its text is code's fixed words, its reason says what it is.
    const asked = r.codeMade !== true && shownReceipt(r.instruction) ? `${quoteDisplay(r.instruction.quote)} \`${escapeSource(r.instruction.eventId)}\``
      : `_${escapeSource(r.text)}_${typeof r.instruction?.eventId === 'string' ? ` \`${escapeSource(r.instruction.eventId)}\`` : ''}`;
    lines.push(`| ${status} | ${asked} | ${evidenceCell(r)} |`);
  }
  if (sorted.length > DISPLAY_LIMITS.findings)
    lines.push('', `_${sorted.length - DISPLAY_LIMITS.findings} more tracked and not shown._`);
  return lines;
}

/** M33 G4 (C-06): "`counts.promisesAsFindings` records how many and the renderer states it". One
 *  closed sentence; `n` is a positive count. */
export const PROMISES_AS_FINDINGS_SENTENCE = (n) => `${n} claim${n === 1 ? '' : 's'} the agent made `
  + `${n === 1 ? 'is' : 'are'} reported as ${n === 1 ? 'a contradicted-claim finding' : 'contradicted-claim findings'}, `
  + 'not also listed here as a claim.';

/** M33 C (C-06 "M33 claims are facts"): what each promise status says to a reader, in plain words. `open` is
 *  never shown as "open": nothing this review checked settles the claim either way. Any other value — a
 *  status a producer outside this code wrote — reads as not checked. */
export const PROMISE_STATUS_WORDS = Object.freeze({ open: 'not checked', verified: 'confirmed by a recorded result',
  // D71 (S2): every action the claim rests on has a typed outcome that never completed.
  incomplete: 'the check it rests on never completed' });
const [PROMISE_OPEN] = PROMISE_STATUSES;
const promiseWords = (status) => PROMISE_STATUS_WORDS[Object.hasOwn(PROMISE_STATUS_WORDS, status) ? status : PROMISE_OPEN];

const CLAIMS_HEADING = CHECKLIST_HEADINGS.claims;

/** C-06 (M33): the agent's own claims that were grounded in its recorded words and survived the
 *  challenge. A LEDGER, like the requirements: M33 C: "not checked" (status `open`) means nothing this review
 *  checked settles it — never that it was kept, and never an accusation; "confirmed by a recorded result"
 *  (`verified`) means a result recorded after it, or before it in its own turn with no change to the code between
 *  (owner decision 2026-10-05), confirms it. A claim a recorded result contradicts is not
 *  here; it is a `claim_contradicted` finding above.
 *  M33 G5: the promisesAsFindings sentence is a statement about the agent's claims, so it is always
 *  said under this section's own heading — also when every claim became its finding and no open
 *  claim is left to list. Pushed bare, it read as part of whichever section preceded it. */
function promiseSection(report, contradicted = [], sessionOnly = false) {
  // C-06 (M33 G3): a claim whose stated receipt a published claim_contradicted finding cites is that
  // finding, never also listed here as open — whichever producer built the report.
  const beside = promisesBesideFindings(Array.isArray(report.promises) ? report.promises : [],
    Array.isArray(report.findings) ? report.findings : []);
  const promises = listedPromises(report);
  // G4: how many claims are their findings — the producer's count, plus any a producer that did not
  // apply the rule left here for this renderer to take out. A value that is not a count adds nothing.
  const counted = report.counts?.promisesAsFindings;
  const asFindings = (isCount(counted) ? counted : 0) + beside.asFindings;
  const asFindingsLine = asFindings > 0 ? [`_${PROMISES_AS_FINDINGS_SENTENCE(asFindings)}_`, ''] : [];
  // D71 (S4): the contradicted claims first, each its finding, labelled by what contradicts it (its title, code's words).
  const findingLines = findingList('#### Contradicted', contradicted, sessionOnly);
  const closing = closingLinesLine(report);
  // D88: here the claims confirmed by a recorded result; the ones not checked, or resting on a check that never
  // completed, are listed under What Sonah could not check (`foldedSection`), and said so here.
  const confirmed = promises.filter((p) => claimRowKind(p) === null);
  const folded = promises.length - confirmed.length;
  if (!promises.length) return asFindingsLine.length || findingLines.length || closing.length
    ? [CLAIMS_HEADING, '', ...findingLines, ...asFindingsLine, ...closing] : [];
  const lines = [CLAIMS_HEADING, '', ...findingLines];
  if (confirmed.length) {
    lines.push(`${confirmed.length} claim${confirmed.length === 1 ? '' : 's'} the agent made in its own recorded words `
      + `${confirmed.length === 1 ? 'is' : 'are'} ${PROMISE_STATUS_WORDS.verified}: a result recorded after the claim, or `
      + 'before it in the same turn with no change to the code in between, shows what it claimed.', '');
    lines.push(...promiseList(confirmed));
  }
  if (folded) lines.push(`_${FOLDED_SECTION_WORDS.here(folded, 'claim')}_`, '');
  lines.push(...asFindingsLine, ...closing);
  return lines;
}

/** Claims as a list: each its status in words, the review's words for it, the actions it rests on that never completed
 *  (by event id), why it is not checked, and its receipts — at most `DISPLAY_LIMITS.findings`, the rest counted. */
function promiseList(promises) {
  const lines = [];
  for (const p of promises.slice(0, DISPLAY_LIMITS.findings)) {
    const receipts = [p.stated, ...(Array.isArray(p.receipts) ? p.receipts : [])]
      .filter((r) => r && typeof r.eventId === 'string' && typeof r.quote === 'string');
    const shown = receipts.filter((r, at) => receipts.findIndex((o) => o.eventId === r.eventId && o.quote === r.quote
      && o.role === r.role) === at);
    // D71 (S2, S4): the actions a claim rests on whose check never completed, by event id. S6 (S5 review M3): the review's
    // mark that a claim is an assumption (D71 f) is not shown: no challenge checks it, so it is counted for the owner only
    // (`counts.checklist.assumptions`).
    const rests = promiseWords(p.status) === PROMISE_STATUS_WORDS.incomplete && Array.isArray(p.restsOn) && p.restsOn.length
      ? ` — it rests on ${p.restsOn.filter((id) => typeof id === 'string').map((id) => `\`${escapeSource(id)}\``).join(', ')}` : '';
    // S6 (S5 review H1): a claim kept although its own check did not settle says why it is not checked.
    const why = Object.hasOwn(CHECKLIST_CLAIM_REASON_WORDS, p.reason) ? ` — not checked: ${CHECKLIST_CLAIM_REASON_WORDS[p.reason]}` : '';
    lines.push(`- **${promiseWords(p.status)}** — ${escapeSource(p.text)}${rests}${why}`, ...shown.map((r) => `  ${receiptLine(r)}`));
  }
  if (promises.length > DISPLAY_LIMITS.findings)
    lines.push('', `_${promises.length - DISPLAY_LIMITS.findings} more claims recorded and not shown._`);
  lines.push('');
  return lines;
}

/** S6 (S5 review M4): how many lines of the agent's closing messages no claim covers, and how many the review read as
 *  asserting nothing (`windowResults[].closingLines`, positions only) — counts and fixed words; the session page lists
 *  them as recorded. Nothing when there are none. */
export function closingLinesLine(report) {
  const entries = (Array.isArray(report?.windowResults) ? report.windowResults : [])
    .flatMap((w) => (Array.isArray(w?.closingLines) ? w.closingLines : []));
  const count = (field) => new Set(entries.flatMap((e) => (Array.isArray(e?.[field]) ? e[field] : [])
    .filter((k) => Number.isSafeInteger(k)).map((k) => `${e.eventId}:${k}`))).size;
  const unreviewed = count('unreviewed'), listed = count('listed');
  if (!unreviewed && !listed) return [];
  const lines = (n) => `${n} line${n === 1 ? '' : 's'}`;
  return [`_Of the agent's closing messages, ${[unreviewed && `${lines(unreviewed)} ${unreviewed === 1 ? 'is' : 'are'} in no claim`,
    listed && `${lines(listed)} the review read as asserting nothing`].filter(Boolean).join(', and ')}: the session page lists `
    + `${unreviewed + listed === 1 ? 'it' : 'them'} as recorded._`, ''];
}

export const WRITTEN_HEADING = '#### Statements the agent wrote into files';

/** M33 (C-06 "M33 written statements"): what each closed side label says, in one fixed phrase. */
export const WRITTEN_LABEL_SENTENCE = Object.freeze({
  unverified: 'nothing this review checked settles it either way',
  contradicted: 'a result recorded after the write contradicts it, and the challenge upheld that',
});
/** W2 (owner decision 2026-10-13): the `contradicted` legend when the text the agent itself wrote before a statement
 *  (written.js, the `own_written` source) contradicts one of them. */
export const WRITTEN_OWN_WRITTEN_SENTENCE = 'a result recorded after the write, or text the agent itself wrote before '
  + 'it, contradicts it, and the challenge upheld that';

/** M33 (C-06 "M33 written statements"): what the agent wrote into files as statements about its work,
 *  each with its closed side label and receipts. A side note in its own section: never a finding, never
 *  an accusation, never part of any status. A label outside WRITTEN_LABELS is not shown as one. D88: the edits section
 *  lists the contradicted ones (`kind` writtenContradicted) under `heading`; the ones not checked (writtenOpen) are listed
 *  under What Sonah could not check. */
function writtenSection(report, kind, heading = WRITTEN_HEADING) {
  const statements = writtenStatements(report).filter((w) => writtenRowKind(w) === kind);
  if (!statements.length) return [];
  const labels = WRITTEN_LABELS.filter((label) => statements.some((w) => w.label === label));
  // W2: when the text the agent itself wrote before a statement contradicts it, the legend says that too.
  const sentenceOf = (label) => (label === 'contradicted' && statements.some((w) => w.label === label
    && w.contradictionSource === OWN_WRITTEN_SOURCE) ? WRITTEN_OWN_WRITTEN_SENTENCE : WRITTEN_LABEL_SENTENCE[label]);
  const lines = [heading, '',
    `${statements.length} statement${statements.length === 1 ? '' : 's'} the agent wrote into files, quoted from what it wrote. ` +
    'A side note, never a finding: ' + labels.map((label) => `**${label}** — ${sentenceOf(label)}`).join('; ') + '.', ''];
  for (const w of statements.slice(0, DISPLAY_LIMITS.findings)) {
    const receipts = (Array.isArray(w.receipts) ? w.receipts : [w.stated])
      .filter((r) => r && typeof r.eventId === 'string' && typeof r.quote === 'string');
    lines.push(`- **${w.label}** — ${escapeSource(w.text)}`, ...receipts.map((r) => `  ${receiptLine(r)}`));
  }
  if (statements.length > DISPLAY_LIMITS.findings)
    lines.push('', `_${statements.length - DISPLAY_LIMITS.findings} more written statements recorded and not shown._`);
  lines.push('');
  return lines;
}
/** The statements the agent wrote into files that the review lists: each with words and a closed label. */
const writtenStatements = (report) => (Array.isArray(report.writtenClaims) ? report.writtenClaims : [])
  .filter((w) => w !== null && typeof w === 'object' && typeof w.text === 'string' && WRITTEN_LABELS.includes(w.label));

/**
 * D88 (owner decision 2026-10-14): what Sonah could not check — every row of FOLDED_ROWS the report holds, last of the
 * checklist, collapsed (a `<details>` block): the asks not checked (each with your words and why), the claims not
 * checked against a recorded result and those resting on a check that never completed (each with its receipts), the
 * failures whose handling could not be checked (each with why), and the statements written into files and not checked.
 * Each group is headed by how many rows of its kind the report holds and lists at most DISPLAY_LIMITS.findings of them in
 * full, the rest counted as not shown. None is counted where your attention is needed; the summary's one plain line
 * counts them all. Nothing when the report holds none.
 */
function foldedSection(report) {
  const asks = (Array.isArray(report.requirements) ? report.requirements : []).filter((r) => askRowKind(r) === 'asksNotChecked');
  const promises = listedPromises(report);
  const open = promises.filter((p) => claimRowKind(p) === 'claimsOpen');
  const incomplete = promises.filter((p) => claimRowKind(p) === 'claimsIncomplete');
  const failures = (failureRows(report) ?? []).filter((row) => failureRowKind(row) === 'failuresNotChecked');
  const written = writtenStatements(report).filter((w) => writtenRowKind(w) === 'writtenOpen');
  const n = asks.length + open.length + incomplete.length + failures.length + written.length;
  if (!n) return [];
  const W = FOLDED_SECTION_WORDS.groups;
  const group = (kind, rows, body) => (rows.length ? [`#### ${W[kind]} (${rows.length})`, '', ...body()] : []);
  return [`${CHECKLIST_HEADINGS.folded} (${n})`, '', `_${FOLDED_SECTION_WORDS.lead}_`, '', '<details>',
    `<summary>${FOLDED_SECTION_WORDS.show(n)}</summary>`, '',
    ...group('asksNotChecked', asks, () => [...requirementTable(asks, true), '']),
    ...group('claimsOpen', open, () => ['Not checked means nothing this review checked settles it either way: it is what '
      + 'the agent said, not something this review checked as done.', '', ...promiseList(open)]),
    ...group('claimsIncomplete', incomplete, () => promiseList(incomplete)),
    ...group('failuresNotChecked', failures, () => [...failures.slice(0, DISPLAY_LIMITS.findings).flatMap(failureLine),
      ...(failures.length > DISPLAY_LIMITS.findings ? [FAILURE_SECTION_WORDS.more(failures.length - DISPLAY_LIMITS.findings)] : []),
      '']),
    ...(written.length ? writtenSection(report, 'writtenOpen', `#### ${W.writtenOpen} (${written.length})`) : []),
    '</details>', ''];
}

// W3-1. One sentence per way a window can fall short, keyed on the shortfall tokens the run
// records. Closed: a shortfall with no sentence would print as a bare token, and a sentence with
// no token is dead text. The counts in these lines are code's own, never the model's.
export const SHORTFALL_SENTENCE = Object.freeze({
  budget: 'the request did not fit the review input budget, so the model never saw this window',
  model_unavailable: 'the model could not be reached',
  no_json: 'the model returned no parseable JSON',
  schema: 'the model returned JSON outside the response contract',
  tool_use: 'the model tried to use a tool instead of answering',
  // W3e-6 / F214: the judge refused the request before sending it — retrying cannot help.
  input_invalid: 'the request contained bytes the model transport cannot carry, so it was never sent',
  // W3f-1 / F216: the model answered, but its reply could not be taken whole.
  output_limit: 'the model\'s reply was longer than the output limit, so none of it was read',
  response_incomplete: 'the model stopped before finishing its reply, so none of it was read',
});

const CHALLENGE_SENTENCE = Object.freeze({
  budget_exhausted: 'the challenge did not fit the review input budget',
  votes_invalid: 'a challenge pass returned no usable vote',
  items_unresolved: 'the challenge left a candidate unresolved',
});

// W3d-2: one parenthetical per TRANSPORT_SHORTFALL class (run-review.js), asserted equal as
// sets. A class is how the transport says its call failed — from an exit status or an error code,
// never from anything it printed — so this is all a reader is ever told about it.
export const TRANSPORT_SENTENCE = Object.freeze({
  timeout: 'timeout',
  exit_nonzero: 'the model process exited with an error',
  output_limit: 'the reply exceeded the output limit',
  spawn_failed: 'the model process could not be started',
  no_output: 'no reply',
  unknown: 'cause not recorded',
});

// W3d-2: the two halves of a window's grounding (W3d-1), in words. `sessionGrounded` is a
// fact about the session's own quotes; `relevanceUnchecked` counts decisions whose place in the PR
// could not be checked because the file they concern (or the file list) was only partly supplied.
// F157: which of the two RELEVANCE_UNKNOWN reasons (ledger.js). With no PR file list at all every
// unplaceable decision is `file_list_missing`; with one, every one is `file_partial` — so the report's
// own PR says which sentence a window's count takes.
const GROUNDING_SENTENCE = Object.freeze({
  sessionUngrounded: 'the session evidence did not ground',
  relevanceUnchecked: (n) => `${n} decision(s) concern a file the PR supplied only partly`,
  relevanceNoFileList: (n) => `${n} decision(s) could not be placed in the PR: the PR file list was not available`,
});

const isCount = (n) => Number.isSafeInteger(n) && n >= 0;

/**
 * Every line one window fell short by, in a fixed order: narrative, transport, grounding
 * (session, relevance), challenge. (D60: there is no reuse line — no answer is refused or
 * revalidated; an answer to the same bytes is simply the answer.) D58: its receipts that did not verify are listed
 * under "Checked, inconclusive — withheld" instead (`windowReceipts`); a window can appear in both.
 *
 * F91: this used to stop at the first. A window whose receipts did not verify AND whose
 * challenge fell short showed only the receipts, so the second fact was simply not there.
 * One exception, and it is not a hidden fact: a challenge only runs on a narrative, so when the
 * narrative itself failed the run records the untouched default challenge, and its reason
 * describes a challenge that never happened ("left a candidate unresolved" with no candidate).
 */
function windowShortfalls(shortfall, report = null) {
  const lines = [];
  const narrativeOk = shortfall.narrative === 'ok';
  if (!narrativeOk) lines.push(SHORTFALL_SENTENCE[shortfall.narrative] ?? 'the window was not reviewed');
  // W3d-2: how the call failed, when the transport classified it. Closed: an unlisted class
  // prints the bare sentence, never itself.
  if (shortfall.transport != null) {
    const how = Object.hasOwn(TRANSPORT_SENTENCE, shortfall.transport) ? TRANSPORT_SENTENCE[shortfall.transport] : null;
    lines.push(how ? `the model call failed (${how})` : 'the model call failed');
  }
  // D58: the window's receipts that did not verify are an inconclusive check, not an unchecked
  // one — `windowReceipts` prints them in the withheld section. Every other line here is a check
  // that did not run, or evidence that was missing.
  const { sessionGrounded, relevanceUnchecked } = shortfall.grounding ?? {};
  // W3d-2. Only for a window the model answered: a failed call leaves `sessionGrounded` false
  // too, and saying its evidence "did not ground" would blame the evidence for the call (the same
  // exception the challenge line below makes). Strictly `false`: an absent flag says nothing.
  if (narrativeOk && sessionGrounded === false) lines.push(GROUNDING_SENTENCE.sessionUngrounded);
  if (report?.reviewScope !== 'session-only' && isCount(relevanceUnchecked) && relevanceUnchecked > 0) {
    const listed = Array.isArray(report?.pr?.files) && report.pr.files.length > 0;
    lines.push((listed ? GROUNDING_SENTENCE.relevanceUnchecked : GROUNDING_SENTENCE.relevanceNoFileList)(relevanceUnchecked));
  }
  const challenge = shortfall.challenge;
  if (narrativeOk && challenge?.reason) {
    // F89: the same closed fallback SHORTFALL_SENTENCE has. An unmatched token rendered the
    // literal `undefined`; a bare token would be no better.
    const votes = isCount(challenge.validVotes) && isCount(challenge.passes)
      ? ` (${challenge.validVotes} valid votes of ${challenge.passes} passes)` : '';
    lines.push(`${CHALLENGE_SENTENCE[challenge.reason] ?? 'the challenge did not complete'}${votes}`);
  }
  return lines;
}

/**
 * W3d-2. What the challenge did to reach its votes, from `report.challenge` (the windows) and
 * every code-review challenge the report carries: slots re-asked once because a reply left them
 * out (W3d-1), and vote quotes snapped to the recorded text (W3d-1). Code's own counts;
 * nothing is printed when both are zero, and a count that is not a count adds nothing.
 */
function challengeFooter(report) {
  const sum = (key) => [report.challenge, ...(Array.isArray(report.codeChallenges) ? report.codeChallenges : [])]
    .reduce((n, c) => n + (isCount(c?.[key]) ? c[key] : 0), 0);
  const reasked = sum('reaskedSlots'), snapped = sum('repairedVotes'), moved = sum('eventRepairedVotes');
  const parts = [];
  if (reasked) parts.push(`${reasked} challenge item(s) were re-asked once`);
  if (snapped) parts.push(`${snapped} vote quote(s) were snapped by code`);
  // M33 (G3): a vote receipt that cited an action's id for its result, moved to that one result.
  if (moved) parts.push(`${moved} vote receipt(s) citing an action were moved to its one recorded result by code`);
  return parts.length ? `_${parts.join('; ')}._` : null;
}

/** One line per shortfall, window by window in window order, from the closed phrasebooks. */
function shortfallLines(report, of = windowShortfalls) {
  const lines = [];
  for (const [index, window] of (report.windowResults ?? []).entries()) {
    if (!window?.shortfall) continue;
    for (const sentence of of(window.shortfall, report))
      lines.push(`- window ${index + 1}: ${sentence}.`);
  }
  return lines;
}

/** D58: how many of one window's cited receipts did not verify — each one belongs to a proposal
 *  that was withheld, or to a decision cell shown UNCHECKED. A count that is not a non-negative
 *  integer is not a count, and never prints as one (F89). */
function windowReceipts(shortfall) {
  const { rejected, receipts } = shortfall.grounding ?? {};
  if (!isCount(rejected) || rejected === 0) return [];
  return [isCount(receipts) && receipts >= rejected
    ? `${rejected} of ${receipts} receipts did not verify`
    : `${rejected} receipts did not verify`];
}

// D58 (W3d-3). One sentence per kind of inconclusive result — a check that RAN and could not
// settle its item — in one place, never built at the call site, so a per-kind rate stays
// computable. Asserted equal to WITHHELD_CAUSES as a set in test/inconclusive-withheld.test.js.
// Nothing counted here is ever shown as a finding, a decision column or an accusation, and nothing
// counted here limits coverage; a check that did not run is "What was not checked" instead.
// W3d-4: a withheld proposal is said to be withheld for the check it actually failed. Each member
// of WITHHELD_REJECTION_CAUSES (ledger.js) has its own sentence; `proposals` is the rest — a quote
// that did not match the record, the default a rejection with no cause means.
// M33 (C-06 "M33 written statements"): each WRITTEN_WITHHELD_CAUSES member has its own sentence too.
// (M33 C recheck 2: code withholds no chat claim as not a claim, so no claim has a withheld sentence.)
export const WITHHELD_CAUSES = Object.freeze(['proposals', ...WITHHELD_REJECTION_CAUSES, ...WRITTEN_WITHHELD_CAUSES,
  FORBIDDEN_WITHHELD_CAUSE, 'unsettled', 'columns', 'values']);
export const WITHHELD_SENTENCE = Object.freeze({
  proposals: ({ n }) => `${n} proposal(s) withheld: their quotes did not match the record`,
  no_frozen_code: ({ n }) => `${n} finding(s) about the current code withheld: none of their receipts quotes the pull request's frozen code`,
  role_missing: ({ n }) => `${n} finding(s) withheld: they do not cite a receipt of every kind their finding requires`,
  rule_after_action: ({ n }) => `${n} finding(s) withheld: the rule they cite was given only after the action`,
  action_failed: ({ n }) => `${n} finding(s) withheld: an action they cite is recorded as failed`,
  // M33 G4 (C-06): the grounding check ran and could not name one actor for the decision.
  actor_ambiguous: ({ n }) => `${n} decision(s) withheld: the actions they cite belong to more than one agent, `
    + 'or to none this recording verifies',
  // M36 phase 3 (D68 F, c6): a result of another session never contradicts what an agent said.
  other_session: ({ n }) => `${n} finding(s) withheld: the result they cite was recorded in another agent's session, `
    + 'which the agent that made the claim never received',
  // D71 (S3, owner decisions D71 e, g): a contradiction that is not a result holds only as the recorded source it names.
  source_not_before: ({ n }) => `${n} finding(s) withheld: the message, edit or instruction file they cite was not recorded `
    + 'before what the agent said',
  source_not_human: ({ n }) => `${n} finding(s) withheld: the message they cite is not one of your own`,
  source_not_file_content: ({ n }) => `${n} finding(s) withheld: the lines they cite are not lines an edit that ran `
    + 'recorded of the file before it changed them',
  // W2 (owner decision 2026-10-13): text the agent's own edit added, changed again before what it said.
  source_rewritten: ({ n }) => `${n} finding(s) withheld: the text they cite, which the agent's own edit wrote, was `
    + 'changed again before what the agent said',
  written_unreadable: ({ n }) => `${n} written statement(s) withheld: they were not in the response contract's shape`,
  written_not_own_write: ({ n }) => `${n} written statement(s) withheld: they do not quote a write, create or edit `
    + 'action of the agent',
  written_ungrounded: ({ n }) => `${n} written statement(s) withheld: their quotes are not in the text that action `
    + 'wrote as its window was shown it',
  written_not_landed: ({ n }) => `${n} written statement(s) withheld: the write they quote is recorded as failed `
    + 'or cancelled, so the text never reached the file',
  // D80: the text is only in the body of a write whose command did not run, failed or was stopped.
  [UNRUN_WRITE_REASON]: ({ n }) => `${n} written statement(s) withheld: the text they quote is only in a write whose `
    + `command did not run, failed or ${STOPPED_WORDS}, so it may never have reached the file`,
  // M33 N (C-06 "M33 forbidden edits"): each reason is counted in the report (`counts.forbiddenEdits.withheld`).
  [FORBIDDEN_WITHHELD_CAUSE]: ({ n }) => `${n} change(s) said to go against your instruction withheld: a code check of `
    + 'their quotes, their events or their order did not pass',
  unsettled: ({ n }) => `${n} item(s) the challengers could not settle`,
  columns: ({ n }) => `${n} decision(s) whose authority could not be determined (shown with not-checked cells)`,
  // G3: said of the value, never of the write — a write with a proven outcome was grounded; its
  // decision card says which cited write, if any, has no established outcome. G4: only a value that
  // was proposed — one the ledger recorded as never proposed had no check to be inconclusive.
  values: ({ n }) => `${n} decision(s) whose adopted value was not confirmed from the recorded actions (shown as unchecked)`,
});

/** Which inconclusive kinds the report's own counts establish, in a fixed order, with their counts.
 *  A report written before D58 carries no `withheld`: its ledger rejections are still counted.
 *  W3d-4: of the withheld proposals, those a producer declared with a specific cause
 *  (`withheld.causes`) are said by that cause; the rest are quotes that did not match. A producer
 *  that declared no causes said none, and every one of its proposals reads as before. */
export function withheldCauses(report) {
  const declared = report?.withheld;
  const decisions = Array.isArray(report?.decisions) ? report.decisions : [];
  const rejections = [...(report?.rejectedDecisions ?? []), ...(report?.rejectedFindings ?? [])];
  const total = isCount(declared?.proposals) ? declared.proposals : rejections.filter(withheldRejection).length;
  const byCause = declared ? declared.causes : withheldCauseCounts(rejections);
  const specific = Object.fromEntries([...WITHHELD_REJECTION_CAUSES, ...WRITTEN_WITHHELD_CAUSES, FORBIDDEN_WITHHELD_CAUSE].map((cause) =>
    [cause, isCount(byCause?.[cause]) ? byCause[cause] : 0]));
  const counted = Object.values(specific).reduce((n, k) => n + k, 0);
  const counts = {
    // A cause is a subset of the declared total; the remainder never reads below zero.
    proposals: Math.max(0, total - counted),
    ...specific,
    unsettled: isCount(declared?.unsettled) ? declared.unsettled : 0,
    columns: decisions.filter((d) => d?.column == null).length,
    values: decisions.filter((d) => d?.valueState !== 'grounded' && recordedValueCause(d) !== 'not_proposed').length,
  };
  return WITHHELD_CAUSES.filter((cause) => counts[cause] > 0).map((cause) => [cause, { n: counts[cause] }]);
}

function withheldSection(report) {
  const causes = withheldCauses(report);
  const receipts = shortfallLines(report, windowReceipts);
  if (!causes.length && !receipts.length) return [];
  return ['### Checked, inconclusive — withheld', '',
    ...causes.map(([cause, counts]) => `- ${WITHHELD_SENTENCE[cause](counts)}.`),
    ...receipts, '',
    '_Each of these checks ran on the evidence and could not settle its item either way. A withheld item ' +
    'is never shown as a finding or an accusation, and it does not limit coverage._', ''];
}

function coverageSection(report) {
  const { coverage } = report;
  // F190: the declarations the header reads, from the one function it reads them with — the report's
  // and the session's, each once. `report.gaps` alone listed a reloaded copy twice, and left a gap
  // declared only on the session named in the header and listed nowhere.
  const gaps = declaredGapList(report);
  // D58: only what did not run, or could not be evaluated. A proposal withheld because its quote
  // did not match the record is inconclusive, and is counted in the withheld section instead.
  const rejectedDecisions = (report.rejectedDecisions ?? []).filter((r) => !withheldRejection(r));
  const rejectedFindings = (report.rejectedFindings ?? []).filter((r) => !withheldRejection(r));
  const shortfalls = shortfallLines(report);
  if (coverage === 'complete' && !rejectedDecisions.length && !rejectedFindings.length && !gaps.length
      && !shortfalls.length) return [];
  const lines = ['### What was not checked', ''];
  for (const gap of gaps) {
    const where = gap.eventIds?.[0] ? ` at \`${escapeSource(gap.eventIds[0])}\`` : '';
    const count = Number.isFinite(gap.count) ? ` (${gap.count})` : '';
    // The phrasebook says what the CODE means; a declared note says what THIS instance was.
    // Printing only the sentence hid the note a declaration went to the trouble of computing.
    // F50: a gap on the children channel is about delegated work, and reads from the children
    // phrasebook — its note is what names the hand-off.
    const book = gap.channel === 'children' ? GAP_SENTENCE_CHILDREN : GAP_SENTENCE;
    // M33 F: a helper report (or, M33 F repair 3, a closing statement) this review capped is Sonah's cut, and its own
    // note says so; the code's phrasebook sentence credits a cut to the recorder, which kept the whole text, so it is
    // not printed beside that note.
    const why = SONAH_CUT_CAUSES.includes(headerCauseOf(gap)) ? null
      : gap.channel === 'observations' && gap.code === 'incomplete_inventory'
        ? 'action results were missing, withheld, or could not be linked to their actions'
        : book[gap.code] ?? GAP_SENTENCE[gap.code] ?? 'a coverage gap was declared';
    // F163: an unrecorded write is said by what covered it, one sentence per cover type below; the
    // gap's line keeps only its declaration (where, how many, its own note). The phrasebook sentence
    // stands only when there is no breakdown to say — nothing listed, or a declaration the ledger
    // caps whole (W3d-7), for which a cover line would contradict the verdict.
    const covers = unrecordedLines(gap, report);
    // M33 (G3): each clause once. A declared note that repeats the phrasebook sentence (the adapter
    // declares an outcome-unknown gap with exactly that sentence), or repeats one of its own clauses,
    // printed "X; X". Only a clause equal to one already said is left out; every other clause, the
    // code, the event, the count and the header cause stay exactly as declared.
    const shown = covers.length ? null : why;
    const noteClauses = gap.note ? String(gap.note).split('; ')
      .filter((clause, at, all) => clause && clause !== shown && all.indexOf(clause) === at) : [];
    const said = [shown, noteClauses.length ? escapeSource(noteClauses.join('; ')) : null].filter(Boolean).join('; ');
    lines.push(`- \`${gap.code}\`${where}${count}${said ? ` — ${said}` : ''}${covers.length ? ':' : '.'}`);
    lines.push(...covers);
  }
  lines.push(...shortfalls);
  if (rejectedDecisions.length)
    lines.push(`- ${rejectedDecisions.length} proposed decision(s) were rejected before display: ` +
      `${rejectedDecisions.map((r) => `\`${r.reason}\``).join(', ')}.`);
  if (rejectedFindings.length)
    lines.push(`- ${rejectedFindings.length} proposed finding(s) were rejected before display: ` +
      `${rejectedFindings.map((r) => `\`${r.reason}\``).join(', ')}.`);
  // D58: a pivot or requirement whose quote did not match is counted in the withheld section. One
  // that could not be evaluated, or whose challenge never ran, left its window short, and that
  // window's line above says so.
  lines.push('', '_A rejected item is not a finding that was cleared — it is one the evidence could not ' +
    'support, so it was withheld rather than shown as an accusation._', '');
  return lines;
}

// ---- session timeline -------------------------------------------------------------------

const EXCERPT_CHARS = 160;
const TIMELINE_MAX_EVENTS = 40;

const TAO_LABEL = Object.freeze({
  instruction: 'ASK',
  commentary: 'SAID',
  invocation: 'DID',
  observation: 'GOT',
  boundary: '—',
});

const RESULT_MARK = Object.freeze({
  succeeded: 'ok', failed: 'FAILED', cancelled: 'cancelled', unknown: 'unknown result',
});

// The four buckets a timeline event can be selected for, in priority order. Fixed and closed:
// the footer names every one of them by this exact phrase, every time, so a per-tier count
// stays legible instead of being assembled from ad hoc prose at each call site.
const TIMELINE_TIERS = Object.freeze(['cited', 'touched', 'delegation', 'other']);
const TIMELINE_TIER_PHRASE = Object.freeze({
  cited: 'cited by findings',
  touched: 'touching changed files',
  delegation: 'delegations',
  other: 'others',
});

// A cited quote is shown with enough on each side to read it in context, and no more (F54).
const WINDOW_CONTEXT = 60;
// The widest one window may be. A quote wider than this is shown alone between ellipses rather
// than dragging two more screenfuls of source with it.
const WINDOW_CHARS = 2 * EXCERPT_CHARS;

/** The distinct quotes cited on one event, flattened the same way the source text is, so a
 *  quote recorded with a newline still finds itself in the flattened line. */
function quoteList(quotes) {
  const out = [];
  for (const raw of Array.isArray(quotes) ? quotes : quotes == null ? [] : [quotes]) {
    const flat = String(raw ?? '').replace(/\s+/g, ' ').trim();
    if (flat && !out.includes(flat)) out.push(flat);
  }
  return out;
}

/**
 * The leading excerpt of `text`, plus one BOUNDED window around each cited quote that falls
 * outside it. Windows are ordered by position and merged where they overlap.
 *
 * F54: the rule "a cited event's line must not cut the receipt's own quote off mid-way" was
 * implemented as "extend the cap to the END of the quote", which is unbounded — a 27-character
 * quote 5,000 characters into a tool result rendered the whole 5,000-character run-up with it.
 * The reader wants the quote and its surroundings, never everything that preceded it. Output is
 * at most EXCERPT_CHARS plus WINDOW_CHARS per window, with one documented exception: a quote
 * longer than a whole window is shown alone, because cutting it is the thing this must not do.
 */
function excerpt(text, quotes) {
  const flat = String(text ?? '').replace(/\s+/g, ' ').trim();
  const scalars = [...flat];
  if (!scalars.length) return null;

  const head = Math.min(EXCERPT_CHARS, scalars.length);
  const segments = [[0, head]];
  for (const quote of quoteList(quotes)) {
    const at = flat.indexOf(quote);
    if (at < 0) continue;                                     // not in this source; nothing to window
    const start = [...flat.slice(0, at)].length;              // code units in, scalars out
    const end = start + [...quote].length;
    if (end <= head) continue;                                // already inside the leading excerpt
    segments.push(end - start > WINDOW_CHARS
      ? [start, end]
      : [Math.max(0, start - WINDOW_CONTEXT), Math.min(scalars.length, end + WINDOW_CONTEXT)]);
  }

  segments.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const merged = [];
  for (const [start, end] of segments) {
    const last = merged[merged.length - 1];
    if (last && start <= last[1]) last[1] = Math.max(last[1], end);
    else merged.push([start, end]);
  }

  // An ellipsis marks every place text was left out, and nowhere else — a gap the reader is not
  // told about is an undeclared truncation, which reads as "that is all there was".
  const lead = merged[0][0] > 0 ? '… ' : '';
  const trail = merged[merged.length - 1][1] < scalars.length ? ' …' : '';
  return lead + merged.map(([start, end]) => escapeSource(scalars.slice(start, end).join('')))
    .join(' … ') + trail;
}

/** The first non-blank line of a block of text. A delegation's brief can run for pages; its
 *  opening line is the part that says what was handed off. */
function firstLine(text) {
  return String(text ?? '').split(/[\r\n\u2028\u2029]/).map((line) => line.trim()).find(Boolean) ?? '';
}

/** The bounded excerpt of the first change whose written source actually contains one of the
 *  cited code quotes (F37). Nothing is shown when no change holds the quote: a line that showed
 *  some OTHER change would be a receipt pointing at the wrong text. */
function citedChange(session, event, quotes) {
  const wanted = quoteList(quotes);
  if (!wanted.length) return null;
  for (const change of event.changes ?? []) {
    for (const after of session.textSpansOf(change, 'after')) {
      const flat = after.replace(/\s+/g, ' ').trim();
      const present = wanted.filter((quote) => flat.includes(quote));
      if (present.length) return excerpt(after, present);
    }
  }
  return null;
}

const displayText = (session, event, field) => session.textSpansOf(event, field).join(' [… omitted …] ');

/** Every receipt a finding, decision, pivot or requirement in the report carries, in one flat
 *  list. Only DIRECT citations — nothing here follows a paired observation or a turn's opening
 *  instruction; that expansion happens once, in citedEventIds. */
function directReceipts(report) {
  const receipts = [];
  for (const f of report.findings ?? []) {
    receipts.push(...(f.receipts ?? []));
    // M33: a self-corrected contradiction also cites the result and statement that corrected it.
    const corrected = selfCorrection(f);
    if (corrected) receipts.push(corrected.observation, corrected.statement);
  }
  for (const d of report.decisions ?? []) {
    if (d.constrainedBy?.instruction) receipts.push(d.constrainedBy.instruction);
    if (d.stated) receipts.push(d.stated);
    if (d.valueReceipt) receipts.push(d.valueReceipt);
  }
  for (const p of report.pivots ?? []) receipts.push(...(p.receipts ?? []));
  for (const r of report.requirements ?? []) if (r.instruction) receipts.push(r.instruction);
  for (const p of Array.isArray(report.promises) ? report.promises : []) {
    if (p?.stated) receipts.push(p.stated);
    if (Array.isArray(p?.receipts)) receipts.push(...p.receipts);
  }
  // M33 (C-06 "M33 written statements"): the writes a published written statement quotes, and the
  // result that contradicts it.
  for (const w of Array.isArray(report.writtenClaims) ? report.writtenClaims : [])
    if (Array.isArray(w?.receipts)) receipts.push(...w.receipts);
  return receipts.filter((r) => r && typeof r.eventId === 'string' && typeof r.quote === 'string');
}

/**
 * Every distinct quote the direct receipts cite, per event id — one window each in that event's
 * line. Keeping only the LONGEST was how a second cited quote on the same event disappeared, and
 * how the surviving one dragged the whole run-up to it into the line (F54).
 *
 * `only` narrows the receipts considered, so a caller can ask for one role's quotes.
 */
function citedQuoteById(report, only = () => true) {
  const byId = new Map();
  for (const receipt of directReceipts(report)) {
    if (!only(receipt)) continue;
    if (!byId.has(receipt.eventId)) byId.set(receipt.eventId, []);
    const quotes = byId.get(receipt.eventId);
    if (!quotes.includes(receipt.quote)) quotes.push(receipt.quote);
  }
  return byId;
}

/** The instruction event whose turn a later event fell within: the latest instruction at or
 *  before its sequence. A "turn" is not a field on the event — it is everything between one
 *  instruction and the next — so this is derived from sequence order, never from an id prefix
 *  (adapters shape ids differently; sequence is the one thing every adapter guarantees). */
function instructionOfTurn(sortedInstructions, event) {
  if (event.kind === 'instruction') return event;
  let found = null;
  for (const instruction of sortedInstructions) {
    if (instruction.sequence > event.sequence) break;
    found = instruction;
  }
  return found;
}

/** Tier 1: every event any finding, decision, pivot or requirement cites by eventId in a
 *  receipt — a decision's `amends` ids count too, since the decision card sends the reader
 *  straight to this timeline to find them (see decisionCard above) — plus each cited event's
 *  paired observation/invocation and the instruction event of its turn. */
function citedEventIds(session, report) {
  const directIds = new Set(directReceipts(report).map((r) => r.eventId));
  for (const d of report.decisions ?? []) for (const id of d.amends ?? []) directIds.add(id);

  const sortedInstructions = session.events.filter((e) => e.kind === 'instruction')
    .slice().sort((a, b) => a.sequence - b.sequence);

  const ids = new Set();
  for (const id of directIds) {
    const event = session.event(id);
    if (!event) continue; // a dangling id grounds nothing; this timeline only shows what exists
    ids.add(event.id);
    if (event.kind === 'invocation') {
      const observation = session.observationFor(event.id);
      if (observation) ids.add(observation.id);
    } else if (event.kind === 'observation' && event.invocation) {
      const invocation = session.event(event.invocation);
      if (invocation) ids.add(invocation.id);
    }
    const turnInstruction = instructionOfTurn(sortedInstructions, event);
    if (turnInstruction) ids.add(turnInstruction.id);
  }
  return ids;
}

/** Tier 2: invocations whose paths or changed files intersect the PR's file list, plus their
 *  recorded outcome — this is where a reader checks "did this line actually touch my diff". */
function touchedEventIds(session, report) {
  const files = new Set((report.pr?.files ?? []).map((f) => f.path).filter(Boolean));
  const ids = new Set();
  if (!files.size) return ids;
  for (const event of session.events) {
    if (event.kind !== 'invocation') continue;
    const paths = [...(event.paths ?? []).map((p) => p.path), ...(event.changes ?? []).map((c) => c.path)];
    if (!paths.some((p) => files.has(p))) continue;
    ids.add(event.id);
    const observation = session.observationFor(event.id);
    if (observation) ids.add(observation.id);
  }
  return ids;
}

/** Tier 3: every delegation, plus its recorded outcome. F55: tiers 1 and 2 both carry an
 *  invocation's paired observation and tier 3 did not, so a hand-off showed what was assigned
 *  and never what came back — the half of a delegation a reader cannot reconstruct. */
function delegationEventIds(session) {
  const ids = new Set();
  for (const delegation of session.delegations()) {
    ids.add(delegation.id);
    const observation = session.observationFor(delegation.id);
    if (observation) ids.add(observation.id);
  }
  return ids;
}

/** Which fixed tier an already-selected event was chosen for, in priority order — an event
 *  cited by a finding is still counted as 'cited' even when it also happens to touch a PR
 *  file, so the footer's buckets stay disjoint and sum to what was shown. */
function tierOf(id, citedIds, touchedIds, delegationIds) {
  if (citedIds.has(id)) return 'cited';
  if (touchedIds.has(id)) return 'touched';
  if (delegationIds.has(id)) return 'delegation';
  return 'other';
}

/** Order events by relevance, then by sequence within each tier, capped at TIMELINE_MAX_EVENTS
 *  (never above it — the cap is a promise about worst-case size, not a target to fill). */
function selectTimelineEvents(session, report) {
  const bySequence = session.events.slice().sort((a, b) => a.sequence - b.sequence);
  const citedIds = citedEventIds(session, report);
  const touchedIds = touchedEventIds(session, report);
  const delegationIds = delegationEventIds(session);

  const selected = [];
  const seen = new Set();
  const take = (ids) => {
    for (const event of bySequence) {
      if (selected.length >= TIMELINE_MAX_EVENTS) return;
      if (seen.has(event.id) || !ids.has(event.id)) continue;
      seen.add(event.id);
      selected.push(event);
    }
  };
  take(citedIds);
  take(touchedIds);
  take(delegationIds);
  // Tier 4: everything else, in sequence order, only if room remains — filling from the START
  // of the session, never continuing from wherever the cap would have cut off a plain slice.
  for (const event of bySequence) {
    if (selected.length >= TIMELINE_MAX_EVENTS) break;
    if (seen.has(event.id)) continue;
    seen.add(event.id);
    selected.push(event);
  }

  const counts = Object.fromEntries(TIMELINE_TIERS.map((t) => [t, 0]));
  for (const event of selected) counts[tierOf(event.id, citedIds, touchedIds, delegationIds)]++;

  return { selected: selected.sort((a, b) => a.sequence - b.sequence), counts, citedIds };
}

/** One line per event, in order: what was asked, said, done and observed.
 *
 * This answers the question a diff cannot — "what happened before this?" — which is the whole
 * reason session evidence is worth carrying. It is a bounded excerpt, never a transcript dump:
 * every line is truncated and escaped, and clipping is declared rather than hidden.
 *
 * Bounded to TIMELINE_MAX_EVENTS, but no longer just the first N in the transcript: an event a
 * finding cites, or one that touched a changed file, is worth more than one that is neither —
 * this is where a reader comes to check a finding, so the cap should spend itself on the events
 * the report actually talks about (W3-8), not on whatever happened to load first.
 *
 * `renderChild` is an optional hook for a delegation's child-session line, if a child-session
 * renderer exists at the call site; this function does not implement one itself.
 */
export function renderTimeline(session, report = {}, { renderChild } = {}) {
  const { selected, counts, citedIds } = selectTimelineEvents(session, report);
  const quotes = citedQuoteById(report);
  // A `role: 'code'` receipt quotes an invocation's WRITTEN SOURCE, not its command line, so it
  // needs its own lookup: the quote will never be found in the text the line otherwise shows.
  const codeQuotes = citedQuoteById(report, (r) => r.role === 'code');
  // Only the hand-offs themselves take a child-session line — never the observations that
  // `delegationEventIds` pairs with them for selection.
  const delegationIds = new Set(session.delegations().map((e) => e.id));
  const lines = ['<details>', '<summary><b>What happened in the session</b></summary>', ''];

  for (const event of selected) {
    const label = TAO_LABEL[event.kind] ?? event.kind;
    let body;
    if (event.kind === 'invocation') {
      const paths = (event.paths ?? []).map((p) => p.path).filter(Boolean);
      const command = displayText(session, event, 'command');
      const what = command || paths.join(', ') || event.tool || 'action';
      const tool = `\`${escapeSource(event.tool ?? '?')}\``;
      if (event.operation === 'delegate') {
        // F51: a hand-off carries no command and no paths, so `what` fell through to the tool
        // name and the line read `Agent` Agent — the tool twice and nothing about the work.
        // What was delegated is the assignment it was given.
        const assignment = excerpt(firstLine(displayText(session, event, 'input')), quotes.get(event.id));
        body = `${tool} ${assignment ?? escapeSource(what)}`;
      } else {
        // F37: a code receipt points at what this invocation WROTE. Without this the reader
        // followed a receipt to a line showing only the path it was written to.
        const cited = citedChange(session, event, codeQuotes.get(event.id));
        // F61: the command (or path list) is bounded like every other line — a 4,000-character
        // shell command rendered a 4,000-character line. A cited action quote keeps its window.
        const shown = excerpt(what, quotes.get(event.id)) ?? escapeSource(what);
        body = `${tool} ${shown}${cited ? ` — ${cited}` : ''}`;
      }
    } else if (event.kind === 'observation') {
      const mark = RESULT_MARK[event.result] ?? event.result;
      const exit = event.exitCode == null ? '' : ` (exit ${event.exitCode})`;
      const out = excerpt(displayText(session, event, 'output'), quotes.get(event.id));
      // The result and the exit code are kept as separate evidence: a process exiting zero
      // does not certify that the tests inside it passed.
      body = `**${mark}**${exit}${out ? ` — ${out}` : ''}`;
    } else {
      body = excerpt(session.sourcesFor(event).map((s) => s.text).filter(Boolean).join(' [… omitted …] '),
        quotes.get(event.id)) ?? '_(no text)_';
    }
    // Tier-1 lines are marked so a reader can spot the events behind a finding at a glance.
    const marker = citedIds.has(event.id) ? '▸' : '-';
    // B2: a transferred sub-agent's events sit in this timeline directly behind the hand-off
    // that assigned them. Mark whose work each one is, so the reader never reads a child's
    // action as the parent agent's own.
    const child = typeof event.childId === 'string' && event.childId
      ? `↳ child ${escapeSource(event.childId.slice(0, 8))} ` : '';
    lines.push(`${marker} ${child}\`${event.id}\` **${label}** ${body}`);
    if (delegationIds.has(event.id) && typeof renderChild === 'function') {
      const extra = renderChild(event);
      if (extra) lines.push(...(Array.isArray(extra) ? extra : [extra]));
    }
  }

  // The footer stays honest and gets more specific than "the first N": it names which tiers
  // filled the cap, and the counts always sum to what was shown.
  if (selected.length < session.events.length) {
    const parts = TIMELINE_TIERS.map((tier) => `${counts[tier]} ${TIMELINE_TIER_PHRASE[tier]}`);
    lines.push('', `_Showing ${selected.length} of ${session.events.length} events: ${parts.join(', ')}._`);
  } else {
    lines.push('', `_All ${session.events.length} events shown._`);
  }
  lines.push('', '_Excerpts are truncated for reading. Retained evidence stays in the local evidence store; declared gaps remain unavailable._', '', '</details>', '');
  return lines;
}
