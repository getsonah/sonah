// What every reader of a report shares: the kinds of its checklist rows and how they are counted, the causes of what the
// review could not cover, and the fixed words they are said in (the page, the story, the PR comment and the CLI). Built
// without a model (C-10): the report is already decided by the time it gets here, and a summarizing model call would be
// an unverifiable layer over verified data. The Markdown review (`renderReview`, review.md) had no product caller and is
// deleted; its tables went with it. This file renders no source text.
//
// `escapeSource` stays for the Markdown report for GitHub, which is to escape recorded and model text with it; until
// that report reads it, only its tests call it. A transcript containing </details> or **bold** must not be able to
// restructure a Markdown reader or impersonate a product control (C-10, hostile-pr).

import { DECISION_ORDER, honestStatuses, unrecordedCover,
  withheldRejection, withheldCauseCounts, gapKey, WITHHELD_REJECTION_CAUSES, VALUE_UNCHECKED_CAUSES,
  WRITTEN_LABELS, WRITTEN_WITHHELD_CAUSES, PART_REASONS, reviewRunState,
  PROMISE_STATUSES, DISCLOSURE_REASONS, FORBIDDEN_EDIT_BREACHES, FORBIDDEN_WITHHELD_CAUSE, STOPPED_WORDS, FAILURE_HANDLINGS,
  DECISION_COLUMNS,
  shellWriteWords, UNRUN_WRITE_REASON, OWN_WRITTEN_SOURCE,
  REQUIREMENT_STATUSES, LEGACY_REQUIREMENT_STATUSES, ASK_CODE_LINKS, ASK_CODE_ATTENTION_LINKS, CODE_FINDING_KINDS,
  claimRowKind, derivedColumn, DERIVED_COLUMN_STATE }
  from './ledger.js';
import { INSTRUCTION_GAP_NOTES, DELEGATION_BRIEF_GAP_NOTES, INTER_AGENT_GAP_NOTES, HELPER_REPORT_CLIPPED_NOTE, LABEL_GAP_NOTES,
  CLOSING_STATEMENT_CLIPPED_NOTE, BODY_CAPPED_NOTE, HUMAN_INTERACTION_UNKNOWN_NOTE } from '../adapters/sonah-ledger.js';
import { promisesBesideFindings } from './run-review.js';
import { codeContradictedRows, codePassFindings } from './code-pass.js';
import { withheldWhy } from './code-report.js';

/** M33 X second recheck's closed note (the retired carry's, `sonah.carry`): a window whose request cap kept earlier
 *  evidence out of its carry. M35 (windowing) deleted the carry, so no review declares it; kept, word for word, only to
 *  read a report written before (its coverage cause `carry_capped`). */
export const CARRY_CAPPED_NOTE = 'earlier evidence selected for this review window was not carried: its request byte cap could not hold it';

/** The finding kinds the checklist places (ledger.js FINDING_KINDS): a contradicted claim under what the agent told you,
 *  a forbidden edit under the edits against what you said; any other (the code review's) under its own heading. */
const CLAIM_FINDING_KIND = 'claim_contradicted';
const FORBIDDEN_FINDING_KIND = 'edit_under_negative_requirement';

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

const counted = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

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
 *     bound, the rest of a group counted in it as not shown (the page and the story by their own bounds); none is counted
 *     in the summary, which carries one plain line saying how many and where. Nothing is deleted.
 * Why: a judgment row or a settled problem is what a reader acts on, while a row Sonah could not check is less often a
 * problem.
 * A row's kind is read from its closed tokens only (a status, a handling, a label, a column, `notActing`, the links the
 * code step joined to an ask), never from its words.
 * An ask's status never contradicts Sonah's own findings (D87 and D88, amended): an ask the session review read done (or
 * addressed) or not checked that the code step tied a finding or a contradicting code check to (ledger.js
 * ASK_CODE_ATTENTION_LINKS) is counted, `asksCodeFinding`, right after the asks shown not done or partly done, and is
 * listed under What you asked with its status unchanged.
 */
export const ATTENTION_ROWS = Object.freeze(['notActing', 'unasked', 'chose', 'whetherAsked', 'pivots', 'asksNotDone',
  'asksCodeFinding', 'contradicted', 'codeContradicted', 'passedOver', 'forbidden', 'writtenContradicted', 'codeFindings']);
export const FOLDED_ROWS = Object.freeze(['asksNotChecked', 'claimsOpen', 'claimsIncomplete', 'failuresNotChecked',
  'writtenOpen']);
/** D88: an ask by its status token (ledger.js REQUIREMENT_STATUSES; a legacy report's LEGACY_REQUIREMENT_STATUSES, the
 *  review's reading before the checklist) — not done or partly done counts (a legacy open or partly addressed ask too,
 *  as before); not checked is folded; done (or addressed) is neither. */
export const ASK_ROW_KINDS = Object.freeze({ 'not-done': 'asksNotDone', 'partly-done': 'asksNotDone',
  open: 'asksNotDone', 'partly-addressed': 'asksNotDone', 'not-checked': 'asksNotChecked' });
/** The statuses an attention link moves to `asksCodeFinding`: done (a legacy report's addressed) and not checked. Not
 *  done and partly done are counted already (`asksNotDone`) and keep their kind; their link is a line beside them. */
const [ASK_DONE, , , ASK_NOT_CHECKED] = REQUIREMENT_STATUSES;
const [ASK_ADDRESSED] = LEGACY_REQUIREMENT_STATUSES;
const ASK_CODE_FINDING_STATUSES = Object.freeze([ASK_DONE, ASK_ADDRESSED, ASK_NOT_CHECKED]);
const [FAILURE_ACTED_ON, FAILURE_TOLD_HUMAN, FAILURE_PASSED_OVER] = FAILURE_HANDLINGS;
const [, WRITTEN_CONTRADICTED_LABEL] = WRITTEN_LABELS;
const rowObject = (row) => row !== null && typeof row === 'object' && !Array.isArray(row);
/** The closed links the code step joined to an ask row (ask-code-links.js: its `codeLinks`), by name. */
const askLinksOf = (r) => (Array.isArray(r.codeLinks) ? r.codeLinks : []).filter((l) => rowObject(l)
  && ASK_CODE_LINKS.includes(l.link)).map((l) => l.link);
/**
 * D88: the kind of one ask row, or null when it is neither counted nor folded. By its status token, and the links the
 * code step joined to it (ledger.js ASK_CODE_LINKS), never its words:
 *   - done (or addressed) or not checked, with an attention link (ASK_CODE_ATTENTION_LINKS: a published finding that
 *     follows from it or whose trace quotes its words, or its code check contradicting it): `asksCodeFinding`, counted;
 *   - otherwise by its status (ASK_ROW_KINDS): not done or partly done counts, not checked is folded, done is neither.
 * Nothing the code step says makes a not-checked ask read as checked: it is folded unless a link counts it.
 */
export const askRowKind = (r) => {
  if (!rowObject(r)) return null;
  const links = askLinksOf(r);
  if (ASK_CODE_FINDING_STATUSES.includes(r.status) && links.some((link) => ASK_CODE_ATTENTION_LINKS.includes(link)))
    return 'asksCodeFinding';
  return Object.hasOwn(ASK_ROW_KINDS, r.status) ? ASK_ROW_KINDS[r.status] : null;
};
/** D88: the kind of one claim, and who decided a decision (`claimRowKind`, `derivedColumn`, DERIVED_COLUMN_STATE):
 *  moved to ledger.js so the code step's triage reads them without importing this file (no import cycle); re-exported
 *  here by name, so no reader's import changes. */
export { claimRowKind, derivedColumn, DERIVED_COLUMN_STATE };
/** D88: the kind of one failure row by its handling (ledger.js FAILURE_HANDLINGS): passed over counts; acted on and
 *  told you are neither; any other (not checked, or a handling outside the vocabulary, which reads not checked) is
 *  folded. */
export const failureRowKind = (row) => (!rowObject(row) ? null : row.handling === FAILURE_PASSED_OVER ? 'passedOver'
  : row.handling === FAILURE_ACTED_ON || row.handling === FAILURE_TOLD_HUMAN ? null : 'failuresNotChecked');
/** D88: the kind of one statement written into a file by its label (ledger.js WRITTEN_LABELS): contradicted counts, the
 *  other label is folded; a label outside the vocabulary is no row. */
export const writtenRowKind = (w) => (!rowObject(w) || !WRITTEN_LABELS.includes(w.label) ? null
  : w.label === WRITTEN_CONTRADICTED_LABEL ? 'writtenContradicted' : 'writtenOpen');
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
 *  group's heading (by FOLDED_ROWS kind), and the line a section says where it holds folded rows (`one` and `many`
 *  name the reader's row, for example `ask`). */
export const FOLDED_SECTION_WORDS = Object.freeze({
  heading: 'What Sonah could not check',
  summary: (n) => `What Sonah could not check (${n})`,
  lead: 'Sonah could not check these items. This section keeps each one, with the reason when the session review '
    + 'recorded one. Sonah does not count them in the summary of what needs your attention.',
  groups: Object.freeze({ asksNotChecked: 'Asks not checked', claimsOpen: 'Claims not checked against a recorded result',
    claimsIncomplete: 'Claims that rest on a check that did not finish', failuresNotChecked: 'Failures not checked',
    writtenOpen: 'Statements that the agent wrote into files, not checked' }),
  here: (n, one, many) => `Sonah could not check ${counted(n, one, many)}. ${n === 1 ? 'It is' : 'They are'} under What `
    + 'Sonah could not check.',
  show: (n) => `Show the ${counted(n, 'item')} that Sonah could not check`,
});
/** The attention summary's lines (`attentionSummary`; the CLI and the PR comment read them), by ATTENTION_ROWS kind: a
 *  count, what it counts and where the page lists it. A decision not to act and a failure passed over are in bold. */
export const ATTENTION_WORDS = Object.freeze({
  notActing: (n) => `**${counted(n, 'decision')} not to act**: see What the agent decided.`,
  unasked: (n) => `${counted(n, 'decision')} that you did not ask for: see What the agent decided.`,
  chose: (n) => `${counted(n, 'decision')} where you asked and the agent chose how: see What the agent decided.`,
  whetherAsked: (n) => `${counted(n, 'decision')} where Sonah could not check whether you asked: see What the agent `
    + 'decided.',
  pivots: (n) => `${counted(n, 'change')} of approach: see What the agent decided.`,
  asksNotDone: (n) => `${counted(n, 'ask')} that the session review marks not done or partly done: see What you asked.`,
  // An ask's status never contradicts Sonah's own findings: an ask read done or not checked that a finding of the code
  // review (or the code check) concerns.
  asksCodeFinding: (n) => `${counted(n, 'ask')} that a finding of the code review concerns: see What you asked.`,
  contradicted: (n) => `${counted(n, 'claim')} of the agent's that the recording contradicts: see What the agent told you.`,
  // D87 (owner decisions 2026-10-13/14): the rows the code pass's check found contradicted by the code at review time —
  // claims, asks and decisions (a failure's check is shown on its row only).
  codeContradicted: (n) => `${n} ${n === 1 ? 'claim' : 'claims'} (asks, decisions) that the code at review time `
    + 'contradicts: see What the code review found.',
  passedOver: (n) => `**${counted(n, 'failure')} that the agent did not act on or tell you about**: see Failures it passed `
    + 'over.',
  forbidden: (n) => `${counted(n, 'edit')} against what you said: see Edits against what you said.`,
  writtenContradicted: (n) => `${counted(n, 'statement')} that the agent wrote into ${n === 1 ? 'a file' : 'files'} `
    + 'and that the recording contradicts: see Edits against what you said.',
  codeFindings: (n) => `${counted(n, 'finding')} of the code review: see What the code review found.`,
  // What the review could not cover (the coverage causes), apart from the rows it could not check (`folded`, the folded
  // section of that name): one thing, one term.
  notCovered: 'What Sonah could not cover: see the Not covered line at the top.',
  // D88: the one plain line for the folded rows: never counted with the rest, never highlighted.
  folded: (n) => `${counted(n, 'item')} that Sonah could not check: see What Sonah could not check.`,
  none: 'Sonah found nothing that needs your attention. This does not mean that the work is correct.',
});

/** D71 (S4), owner decision (b): why an ask was kept as not checked — its closed reason (ledger.js
 *  REQUIREMENT_UNCHECKED_REASONS) in plain words; and the fact code adds beside a row (REQUIREMENT_FACTS). One table for
 *  the session page and the PR comment; the vocabularies stay closed in ledger.js, these are only their reader words. */
export const CHECKLIST_REQUIREMENT_REASON_WORDS = Object.freeze({
  deliverable_ungrounded: 'Sonah did not find, word for word, the evidence that the session review cited for it',
  deliverable_not_after: 'the evidence that Sonah cited comes from before your ask',
  check_not_completed: 'the result, command or edit that the session review cited for it did not run to an end',
  shortfall_ungrounded: 'Sonah did not find, word for word after your ask, what the session review said is missing',
  ask_unreviewed: 'the session review did not name what you asked in this message, so nothing shows whether the agent '
    + 'did it',
  challenge_refuted: "the session review's own check did not uphold the status that it first gave",
  challenge_unsettled: "the session review's own check on it did not settle",
  challenge_unexecuted: "the session review's own check on it did not run",
  // D80: a deliverable quoted only from the body of a write whose command did not run, failed or was stopped.
  [UNRUN_WRITE_REASON]: 'the code that the session review cited for it is only in a file write whose command did not '
    + `run, failed or ${STOPPED_WORDS}, so the recording does not show that the write happened`,
});
/** S6 (S5 review H1), owner decision D71 (b): why a claim is kept as not checked although the review proposed a basis
 *  for it — its own challenge did not settle (ledger.js PROMISE_UNCHECKED_REASONS), in plain words (the page and the PR
 *  comment). */
export const CHECKLIST_CLAIM_REASON_WORDS = Object.freeze({
  challenge_unsettled: "the session review's own check on it did not settle",
  challenge_unexecuted: "the session review's own check on it did not run",
});
/** The reader's words for a fact code adds beside an ask (ledger.js REQUIREMENT_FACTS). `no_deliverable_by_end` is
 *  set when the reporting part of a not-checked row with no deliverable holds the recording's last event: it says
 *  nothing about where the ask stands, so its words name no place ("ends here" read as if the recording stopped at
 *  the ask). Reader-facing only: no model request carries them. */
export const CHECKLIST_REQUIREMENT_FACT_WORDS = Object.freeze({
  no_deliverable_by_end: 'The session review found nothing that does this ask before the recording ended.',
});
/**
 * An ask's status never contradicts Sonah's own findings: the words of the line an ask row shows beside its status for
 * each item the code step tied to it (`askCodeNotes`), one table for the page and the story. Fixed words,
 * chosen by structure — the row's status token (`status`), the link and the linked finding's kind (`notMet` only for a
 * finding of kind ask_not_met that names this ask) — never by any word of the finding; the item's own words follow
 * them. The status pill keeps the session review's status: these words show the conflict and never rule on it.
 */
export const ASK_CODE_WORDS = Object.freeze({
  label: 'Code review',
  status: Object.freeze({ done: 'The session review marked it done', addressed: 'The session review marked it done',
    'partly-done': 'The session review marked it partly done',
    'partly-addressed': 'The session review marked it partly done',
    'not-done': 'The session review marked it not done', open: 'The session review marked it not done',
    'not-checked': 'The session review did not check it' }),
  notMet: 'the code review found that the agent did not meet it',
  bearsOn: 'a finding of the code review concerns it',
  withheld: 'Sonah withheld a finding of the code review about this ask',
  question: 'The code review asks you about this ask',
  /** The line of a finding beside the session review's status: the status, then what the code review found. */
  withStatus: (status, words) => `${status}, and ${words}`,
});
const [LEADS_FROM_LINK, , , WITHHELD_FINDING_LINK, QUESTION_CONCERNS_LINK] = ASK_CODE_LINKS;
const [, , , , ASK_NOT_MET_KIND] = CODE_FINDING_KINDS;
const capitalized = (text) => `${text[0].toUpperCase()}${text.slice(1)}`;
/**
 * The lines an ask row (a report row with the `codeLinks` the code step joined) shows beside its status, one per item
 * the code step tied to it, in the order of its links: `{ link, words, subject }` and the item — `finding` (the
 * published finding), `withheld` or `question` (its index in the code step's list). `words` are ASK_CODE_WORDS
 * by structure: for a finding, the row's status and whether the finding is an ask not met that names this ask (any
 * other link reads "bears on it"); for a withheld finding, why it was withheld in the code step's closed reason words
 * (code-report.js `withheldWhy`: its CODE_WITHHELD_REASONS member, the refutation's reason, the closed cause), as What
 * the code review found says it; `subject` is the item's own words (a finding's title, a withheld finding's text, a
 * question), or null. A link with no such item — a code check with no finding, an item the report no longer holds —
 * has no line here: the row's code check says it. Pure.
 */
export function askCodeNotes(report, row) {
  if (!rowObject(row) || !Array.isArray(row.codeLinks)) return [];
  const links = row.codeLinks.filter((l) => rowObject(l) && ASK_CODE_LINKS.includes(l.link));
  const pass = rowObject(report?.codePass) ? report.codePass : {};
  const item = (key, k) => (Number.isSafeInteger(k) && k >= 0 && Array.isArray(pass[key]) && rowObject(pass[key][k])
    ? pass[key][k] : null);
  const findings = codePassFindings(report);
  const status = Object.hasOwn(ASK_CODE_WORDS.status, row.status) ? ASK_CODE_WORDS.status[row.status] : null;
  const notes = [];
  const seen = new Set();
  const once = (key) => (seen.has(key) ? false : (seen.add(key), true));
  for (const l of links) {
    if (typeof l.finding === 'string') {
      const f = findings.find((x) => x.id === l.finding);
      if (!f || !once(`finding ${f.id}`)) continue;
      const names = links.some((x) => x.link === LEADS_FROM_LINK && x.finding === f.id);
      const verb = f.kind === ASK_NOT_MET_KIND && names ? ASK_CODE_WORDS.notMet : ASK_CODE_WORDS.bearsOn;
      notes.push({ link: l.link, finding: f, words: status ? ASK_CODE_WORDS.withStatus(status, verb) : capitalized(verb),
        subject: f.title });
    } else if (l.link === WITHHELD_FINDING_LINK) {
      const w = item('withheld', l.withheld);
      if (!w || !once(`withheld ${l.withheld}`)) continue;
      const why = withheldWhy(w);
      notes.push({ link: l.link, withheld: l.withheld, words: why ? `${ASK_CODE_WORDS.withheld} (${why})`
        : ASK_CODE_WORDS.withheld, subject: typeof w.text === 'string' && w.text.trim() ? w.text : null });
    } else if (l.link === QUESTION_CONCERNS_LINK) {
      const q = item('questions', l.question);
      if (!q || typeof q.question !== 'string' || !once(`question ${l.question}`)) continue;
      notes.push({ link: l.link, question: l.question, words: ASK_CODE_WORDS.question, subject: q.question });
    }
  }
  return notes;
}
/** D71 (S4), owner decision (c): what the agent did about one failure (ledger.js FAILURE_HANDLINGS), and why a row is not
 *  checked (FAILURE_UNCHECKED_REASONS), in plain words (the page and the PR comment). */
export const CHECKLIST_FAILURE_WORDS = Object.freeze({
  'passed-over': 'Not acted on: the agent ended its turn and did not act on it or tell you',
  'told-human': 'The agent told you', 'acted-on': 'The agent acted on it', 'not-checked': 'Not checked',
});
export const CHECKLIST_FAILURE_REASON_WORDS = Object.freeze({
  response_ungrounded: 'Sonah did not find, word for word, what the session review cited for what the agent did',
  response_not_after: 'what the session review cited comes from before the failure',
  response_other_agent: "what the session review cited is another agent's",
  response_not_shown_to_human: "the words that the session review cited are a helper's, and you do not see them",
  turn_end_not_cited: "the session review did not cite the end of the agent's turn after it",
  failure_unreviewed: 'the session review said nothing about it',
  challenge_refuted: "the session review's own check did not uphold what it first said",
  challenge_unsettled: "the session review's own check on it did not settle",
  challenge_unexecuted: "the session review's own check on it did not run",
  // D80: an acted-on response quoted only from the body of a write whose command did not run, failed or was stopped.
  [UNRUN_WRITE_REASON]: 'the code that the session review cited for what the agent did is only in a file write whose '
    + `command did not run, failed or ${STOPPED_WORDS}, so the recording does not show that the write happened`,
});
/** D71 (S4): a result's typed outcome (ledger.js `resultOutcome`: its class and, where a class has several phrases, its
 *  form — recorder fields only) in plain words, never the recorder's terms (the page
 *  and the PR comment). */
export const CHECKLIST_OUTCOME_WORDS = Object.freeze({
  'ran-failed': (exit) => (Number.isSafeInteger(exit) && exit !== 0 ? `It ran and failed with exit code ${exit}.`
    : 'It ran and failed.'),
  // A recorder that types no refusal: a refusal before a call runs is the harness's (its rules, or your answer to it).
  'failed-or-refused': () => 'The command failed, or the harness refused it before it ran. The recording does not say '
    + 'which.',
  // A refusal before a call runs is the harness's, as above (its rules, or your answer to it); the recorder's denial
  // kind says which, beside these words.
  'did-not-run': () => 'It did not run: the harness refused the call.',
  // S7: `stopped` left the table; an interrupted or cancelled call is a form of no terminal
  // status, and a result recorded with none of its output shown is no longer listed (output-no-status `unread`).
  // D80: the one phrase for a stopped call (`STOPPED_WORDS`), and a write whose command failed or was stopped
  // (SHELL_WRITE_OUTCOME_WORDS).
  'no-terminal-status': (exit, form) => (form === 'background' ? 'It started in the background. The recording shows no '
    + 'end of it.'
    : form === 'interrupted' || form === 'cancelled' ? `It ${STOPPED_WORDS}.`
      : form === 'command-failed' || form === 'command-stopped' ? SHELL_WRITE_OUTCOME_WORDS[form]
        : form === 'none' ? 'The recording holds no result of it.' : 'The recording shows no end of it.'),
});
/** D80: what is said of a write whose command failed or was stopped: the ledger's own words (`shellWriteWords`, which a
 *  model request carries), so the page, the story and the evidence say it alike, and they are not rewritten here. */
export const SHELL_WRITE_OUTCOME_WORDS = Object.freeze({ 'command-failed': `Its ${shellWriteWords('failed')}.`,
  'command-stopped': `Its ${shellWriteWords('stopped')}.` });
/** D71 (e), (g), S4: what contradicts a claim, by the finding's code-set source (ledger.js CONTRADICTION_SOURCES). */
export const CHECKLIST_CONTRADICTION_WORDS = Object.freeze({ result: 'A recorded result contradicts it',
  human_message: 'Your own message contradicts it', file_content: "A file's recorded content contradicts it",
  project_instructions: "The project's instruction file contradicts it",
  // W2 (owner decision 2026-10-13): the text the agent's own edit or write added.
  own_written: 'What the agent itself wrote contradicts it' });

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

/** A count's noun: the first form for one, the second for any other count (or none). */
const nounOf = (counts, singular, plural) => (one(counts) ? singular : plural);

export const COVERAGE_SENTENCE = Object.freeze({
  no_windows: () => 'Sonah found nothing in the session to review',
  no_actions: () => 'the recording holds no action of the agent',
  windows_incomplete: ({ n, m }) => `${n} of ${m} review windows did not finish`,
  // F170: these two are also how a declared missing child, or an elided ask, is named when no fact
  // counted it (GAP_HEADER_CAUSE) — and a declaration may state no count.
  instructions_elided: (counts) => `the recorder shortened ${amount(counts)} ${nounOf(counts, 'message', 'messages')} `
    + 'of yours',
  // W3e-5 / F212: an ask redaction left no words of (W3e-3 / F198) is missing too, but not by the
  // recorder's hand, and is never credited to it.
  instructions_withheld: (counts) => `redaction removed ${amount(counts)} ${nounOf(counts, 'message', 'messages')} of `
    + 'yours',
  // M33 R: an ask THIS REVIEW capped (redaction's bound of the ask it scrubbed whole; or an older slicer's cut, Sonah's
  // too). The recorder kept the whole ask, so the cut is never credited to it: the adapter declares it with its own note
  // (INSTRUCTION_GAP_NOTES.capped_before_review), and the header names it in the same terms.
  instructions_capped: (counts = {}) => `Sonah cut the middle out of ${amount(counts)} `
    + `${nounOf(counts, 'message', 'messages')} of yours before its review, so it cannot quote that part`,
  // M33 R repair: an ask whose pasted material THIS REVIEW replaced by a stub (redaction's strip of the ask it scrubbed
  // whole; or an older slicer's, Sonah's too). The recorder kept the whole ask, so the strip is never credited to it:
  // the adapter declares it with its own note (INSTRUCTION_GAP_NOTES.stripped_before_review).
  instructions_stripped: (counts = {}) => `Sonah put a stub in place of material that you pasted into ${amount(counts)} `
    + `${nounOf(counts, 'message', 'messages')} of yours, so it cannot quote that material`,
  // Gain I (2026-10-13): messages of the human's that carried an image (or other content that is not text) the review
  // was not shown — the adapter's located note (INSTRUCTION_GAP_NOTES.nontext_attached), counted by message — and such
  // parts it could not place at a message (`nontext_unplaced`, counted by part). Before, both read "elided by the
  // recorder", which no recorder did.
  instructions_nontext: (counts = {}) => `${amount(counts)} ${nounOf(counts, 'message', 'messages')} of yours held an `
    + 'image or other content that is not text, and the session review did not see it',
  instructions_nontext_unplaced: (counts = {}) => `the session review did not see ${amount(counts)} `
    + `${nounOf(counts, 'image or other part', 'images or other parts')} of your input that ${nounOf(counts, 'is',
      'are')} not text, and Sonah could not tie ${nounOf(counts, 'it', 'them')} to a message`,
  // M34 labels (C-02 "Slice-time labels"): each counted label gap, declared by the adapter with its own closed note
  // (sonah-ledger.js `LABEL_GAP_NOTES`), is named by its own cause, never by another's.
  // M34 labels review (F6): every row the fallback labelled is counted, whichever way it read it.
  labels_legacy_recorder: (counts = {}) => `${amount(counts)} ${nounOf(counts, 'record comes', 'records come')} from an `
    + `old recorder that does not mark your messages, so Sonah could not check whether ${nounOf(counts, 'it holds',
      'they hold')} a message of yours`,
  interruptions_untyped: (counts = {}) => `the recorder did not mark ${amount(counts)} `
    + `${nounOf(counts, 'record', 'records')} where it writes that you stopped the agent, so the recording does not `
    + 'show where you stopped it',
  commands_args_unrecorded: (counts = {}) => `the recorder kept ${amount(counts)} slash `
    + `${nounOf(counts, 'command', 'commands')} that you ran without ${nounOf(counts, 'its', 'their')} arguments, so `
    + `Sonah does not have the words that you typed with ${nounOf(counts, 'it', 'them')}`,
  answers_unrecorded: (counts = {}) => `the recording links no answer of yours to ${amount(counts)} `
    + `${nounOf(counts, 'question', 'questions')} that the agent asked you`,
  origins_unknown: (counts = {}) => `${amount(counts)} ${nounOf(counts, 'record carries', 'records carry')} a source `
    + `that the recorder does not name, so Sonah did not label ${nounOf(counts, 'it', 'them')}`,
  // Owner decision 2026-10-07: only notifications whose carried call id names a call the recording does not hold.
  notifications_unmatched: (counts = {}) => `${amount(counts)} ${nounOf(counts, 'notice', 'notices')} from background `
    + `tasks ${nounOf(counts, 'names', 'name')} a call that the recording does not hold, so Sonah could not tie `
    + `${nounOf(counts, 'it', 'them')} to the work`,
  // L1 review (OWNER DECISION 2026-10-06): calls a Claude Code recorder that types no refusal recorded as failed. Any of
  // them may be the human's refusal holding an unread answer: the adapter declares them with its own note
  // (INSTRUCTION_GAP_NOTES.refusal_untyped).
  instructions_refusal_untyped: (counts = {}) => `${amount(counts)} failed ${nounOf(counts, 'call comes',
    'calls come')} from a recorder version that does not record which calls you refused, so `
    + `${nounOf(counts, 'the call', 'any of them')} can hold an answer that Sonah did not read`,
  // L1 session-type review (finding L1S-unknown-type-not-counted): calls refused in a session whose recorder did not
  // record whether a human was there to answer. Each keeps its declaration under the adapter's own note
  // (INSTRUCTION_GAP_NOTES.refusal_session_unknown).
  instructions_refusal_session_unknown: (counts = {}) => `${amount(counts)} refused ${nounOf(counts, 'call is',
    'calls are')} in a session that does not record whether you were there to answer, so `
    + `${nounOf(counts, 'the call', 'any of them')} can hold an answer that Sonah did not read`,
  // M33 brittleness L3 review: a recorder whose schema the adapter does not know (HUMAN_INTERACTION_UNKNOWN_NOTE) cannot
  // say which of its actions asked the human or recorded the human's choice. Nothing was elided and no instruction is
  // counted: the declaration's count is the session's actions, so the sentence states none.
  human_interaction_unknown: () => 'the format of the recorder does not say which actions asked you a question or kept '
    + 'your answer',
  delegations_unlinked: (counts) => `Sonah found no checked recording for ${amount(counts)} `
    + `${nounOf(counts, 'delegation', 'delegations')} to a helper`,
  // F191: an `ambiguous_child` had candidate child sessions — more than one — not none, so the
  // sentence above is not true of it. These are the words its declaration's note uses.
  delegations_ambiguous: (counts) => `${amount(counts)} ${nounOf(counts, 'delegation', 'delegations')} to a helper `
    + `${nounOf(counts, 'matches', 'match')} more than one helper recording`,
  // M33 T: a hand-off brief the recorder encrypted (Codex). Missing evidence, but not redaction's doing, and never
  // credited to it: the adapter declares it with its own note (DELEGATION_BRIEF_GAP_NOTES.recorder_encrypted).
  briefs_encrypted: (counts = {}) => `the recorder encrypted ${amount(counts)} ${nounOf(counts, 'brief', 'briefs')} `
    + `that the agent gave a helper, so Sonah cannot show or check ${nounOf(counts, 'it', 'them')}`,
  // M33 F: an inter-agent message whose payload the recorder encrypted (every Codex NEW_TASK and MESSAGE). The adapter
  // declares it on the `children` channel with its own note (INTER_AGENT_GAP_NOTES.encrypted).
  messages_encrypted: (counts = {}) => `the recorder encrypted ${amount(counts)} `
    + `${nounOf(counts, 'message', 'messages')} between agents, so Sonah cannot show or check `
    + `${nounOf(counts, 'it', 'them')}`,
  // F170: every other code a declared gap can cap with. A count no declaration stated is not
  // invented: `coverageCauses` counts such a declaration as one, and says "at least". W3c-8:
  // `unrecorded_body` (F96) and `code_unreviewable` (F106) were the first two.
  incomplete_inventory: (counts = {}) => `${positiveAmount(counts)} ${nounOf(counts, 'part', 'parts')} of the session `
    + `evidence ${nounOf(counts, 'is', 'are')} incomplete`,
  observations_incomplete: (counts = {}) => `the recording does not show the result of ${positiveAmount(counts)} `
    + `${nounOf(counts, 'action', 'actions')}, so Sonah cannot tell whether ${nounOf(counts, 'it', 'they')} succeeded`,
  source_clipped: (counts) => `the recorder shortened ${amount(counts)} recorded ${nounOf(counts, 'text', 'texts')}, so `
    + 'Sonah cannot quote what it left out',
  // M33 F: a helper's final report THIS REVIEW capped (the redactor's bound of the scrubbed report). The recorder kept
  // the whole report, so the cut is never credited to it: the adapter declares it with its own note
  // (HELPER_REPORT_CLIPPED_NOTE), and the header names it in the same terms.
  reports_capped: (counts = {}) => `Sonah cut the middle out of ${amount(counts)} helper `
    + `${nounOf(counts, 'report', 'reports')} before its review, so it cannot quote that part`,
  // M33 F repair 3: a closing statement THIS REVIEW capped (the redactor's bound of the statement it scrubbed whole; or
  // an older slicer's cut, Sonah's too). The recorder kept the whole statement, so the cut is never credited to it: the
  // adapter declares it with its own note (CLOSING_STATEMENT_CLIPPED_NOTE), and the header names it in the same terms.
  statements_capped: (counts = {}) => `Sonah cut the middle out of ${amount(counts)} closing `
    + `${nounOf(counts, 'message', 'messages')} of the agent before its review, so it cannot quote that part`,
  // M33 R: a file body an earlier Sonah capped (redaction's cap of the body it scrubbed whole, the slicer's memory bound,
  // or an older slicer's cut — each Sonah's; D68 E deleted them all, so only a persisted ledger declares one). The recorder kept the whole body, so the cut is never credited to it: the
  // adapter declares it with its own note (BODY_CAPPED_NOTE), and the header names it in the same terms.
  bodies_capped: (counts = {}) => `Sonah shortened ${amount(counts)} file ${nounOf(counts, 'body', 'bodies')} before `
    + 'its review, so it cannot quote what it left out',
  unsupported_message: (counts) => `${amount(counts)} ${nounOf(counts, 'record has', 'records have')} a form that Sonah `
    + 'cannot read',
  unrecorded_body: (counts) => `the recording holds no text for ${amount(counts)} ${nounOf(counts, 'write', 'writes')}, `
    + `so Sonah cannot quote the code that ${nounOf(counts, 'it', 'they')} wrote`,
  write_outcome_unknown: (counts) => `the recording does not show whether ${amount(counts)} `
    + `${nounOf(counts, 'write', 'writes')} succeeded`,
  command_outcome_unknown: (counts) => `the recording does not show the exit status of ${amount(counts)} `
    + `${nounOf(counts, 'command', 'commands')}`,
  input_limit: (counts) => `Sonah reviewed ${amount(counts)} ${nounOf(counts, 'action and its result',
    'actions and their results')} in separate windows`,
  // M33 X second recheck: earlier evidence code selected for a window (the retired carry) that its request cap kept out.
  // Declared as an `input_limit` with its own closed note (CARRY_CAPPED_NOTE), and named in these terms, never as a split
  // pair. M35 (windowing): no review declares it any more; kept to read a report written before.
  carry_capped: (counts = {}) => `${amount(counts)} earlier ${nounOf(counts, 'item', 'items')} did not fit in the size `
    + `limit of a review window, so Sonah left ${nounOf(counts, 'it', 'them')} out`,
  // A code outside GAP_CODES (a report written before a code was retired, M72) still caps, and is
  // still said to — with the count it declared (M33), never its code.
  other_gap: (counts = {}) => (isCount(counts.n) && counts.n > 0
    ? `${amount(counts)} ${nounOf(counts, 'gap', 'gaps')} of a kind that this version of Sonah does not name`
    : 'a gap of a kind that this version of Sonah does not name'),
  code_unreviewable: (counts) => `the code review could not read ${amount(counts)} changed `
    + `${nounOf(counts, 'file', 'files')}`,
  pr_hunks_withheld: (counts) => `redaction removed ${amount(counts)} changed ${nounOf(counts, 'hunk', 'hunks')}`,
  // M33: counted by what declared it short — an enumeration that was not complete, and each listed
  // file whose content was not.
  pr_files_incomplete: (counts = {}) => (isCount(counts.n) && counts.n > 0
    ? `the file list of the pull request is incomplete (${amount(counts)} ${nounOf(counts, 'shortfall', 'shortfalls')})`
    : 'the file list of the pull request is incomplete'),
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
  // The agentic code step: kept in the code pass's own record, never among the report's gaps.
  code_step_backend: 'other_gap',
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
 *  copy of it. F164: one declaration per `gapKey`, the first seen. F190: the one list the causes (`coverageCauses`) and
 *  where they were recorded (`coverageCauseEvents`) read, so they cannot disagree. */
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

/** The words of the failures a reader lists: what the list holds, and the sentence for none. */
export const FAILURE_SECTION_WORDS = Object.freeze({
  intro: 'These results failed, did not run or have no recorded end. Each one shows what the agent did about it. '
    + 'Sonah checked what the session review found against the recording.',
  none: 'The recording shows no result that failed, did not run or has no end.',
});
/** A checklist report's failure rows (each with its RESULT's event id), or null for a report from before the checklist. */
const failureRows = (report) => (Array.isArray(report.failures)
  ? report.failures.filter((row) => row !== null && typeof row === 'object' && typeof row.eventId === 'string') : null);
/** The report's findings by where the checklist places them: a contradicted claim under what the agent told you, an edit
 *  against what you said under the edits, any other (the code review's) under what the code review found. */
const findingParts = (findings) => ({ contradicted: findings.filter((f) => f.kind === CLAIM_FINDING_KIND),
  edits: findings.filter((f) => f.kind === FORBIDDEN_FINDING_KIND),
  codeFindings: findings.filter((f) => f.kind !== CLAIM_FINDING_KIND && f.kind !== FORBIDDEN_FINDING_KIND) });

/**
 * D71 (a), (d); S6 (S5 review M2); D88: the checklist's attention summary for a reader with the report only (the CLI, the
 * PR comment): the same lines, in the same order, as the page's attention summary — counts and fixed
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

/** The attention lines' words, in ATTENTION_ROWS' order, one per kind with anything in it, the line
 *  for what the review could not cover, and (D88) the plain line for the folded rows, or null. */
function attentionList(report, parts, notCovered) {
  const counts = checklistRowCounts(report, parts);
  const lines = ATTENTION_ROWS.filter((kind) => counts[kind] > 0).map((kind) => ATTENTION_WORDS[kind](counts[kind]));
  if (notCovered) lines.push(ATTENTION_WORDS.notCovered);
  const folded = FOLDED_ROWS.reduce((n, kind) => n + counts[kind], 0);
  return { lines, folded: folded > 0 ? ATTENTION_WORDS.folded(folded) : null, counts };
}

const isCount = (n) => Number.isSafeInteger(n) && n >= 0;

// ---- style (docs/STYLE.md) ------------------------------------------------------------------------------------------

/** The kind of each word table's text, for the style linter (packages/render/test/style-lint.js): a fragment is a part
 *  a reader joins into its own sentence. */
export const STYLE_KINDS = Object.freeze({
  FOLDED_SECTION_WORDS: 'heading', 'FOLDED_SECTION_WORDS.lead': 'description', 'FOLDED_SECTION_WORDS.here': 'notice',
  'FOLDED_SECTION_WORDS.show': 'label',
  ATTENTION_WORDS: 'description',
  CHECKLIST_REQUIREMENT_REASON_WORDS: 'fragment', CHECKLIST_CLAIM_REASON_WORDS: 'fragment',
  CHECKLIST_REQUIREMENT_FACT_WORDS: 'notice',
  ASK_CODE_WORDS: 'description', 'ASK_CODE_WORDS.label': 'label',
  CHECKLIST_FAILURE_WORDS: 'status', CHECKLIST_FAILURE_REASON_WORDS: 'fragment',
  CHECKLIST_OUTCOME_WORDS: 'description', CHECKLIST_CONTRADICTION_WORDS: 'label',
  COVERAGE_SENTENCE: 'fragment',
  FAILURE_SECTION_WORDS: 'description', SHELL_WRITE_OUTCOME_WORDS: 'description',
});
const counts = Object.freeze([[{ n: 1 }], [{ n: 2 }], [{ n: 3, atLeast: true }], [{}]]);
/** The arguments each function of a word table is rendered with for the style linter. */
export const STYLE_FIXTURES = Object.freeze({
  'FOLDED_SECTION_WORDS.summary': [[1], [6]], 'FOLDED_SECTION_WORDS.here': [[1, 'ask'], [2, 'ask']],
  'FOLDED_SECTION_WORDS.show': [[1], [6]],
  ...Object.fromEntries(Object.keys(ATTENTION_WORDS).filter((key) => typeof ATTENTION_WORDS[key] === 'function')
    .map((key) => [`ATTENTION_WORDS.${key}`, [[1], [2]]])),
  'ASK_CODE_WORDS.withStatus': [[ASK_CODE_WORDS.status.done, ASK_CODE_WORDS.notMet],
    [ASK_CODE_WORDS.status['not-checked'], ASK_CODE_WORDS.bearsOn]],
  'CHECKLIST_OUTCOME_WORDS.ran-failed': [[1], [null]], 'CHECKLIST_OUTCOME_WORDS.failed-or-refused': [[]],
  'CHECKLIST_OUTCOME_WORDS.did-not-run': [[]],
  // Its own forms; the two that read the ledger's words are SHELL_WRITE_OUTCOME_WORDS, linted there.
  'CHECKLIST_OUTCOME_WORDS.no-terminal-status': ['background', 'interrupted', 'cancelled', 'none', 'other']
    .map((form) => [null, form]),
  ...Object.fromEntries(COVERAGE_CAUSES.map((cause) => [`COVERAGE_SENTENCE.${cause}`,
    cause === 'windows_incomplete' ? [[{ n: 1, m: 2 }], [{ n: 2, m: 3 }]] : counts])),
});
/** The style rules a table's words pass by a closed reason: a write whose command failed or stopped reads the ledger's
 *  words, which a model request carries, and only those words carry the reason. */
export const STYLE_ALLOW = Object.freeze({ SHELL_WRITE_OUTCOME_WORDS: ['request-bytes'] });
