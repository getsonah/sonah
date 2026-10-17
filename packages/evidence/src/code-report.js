// The code step's report as every reader reads it — the session page and the story: the one word table
// (CODE_REPORT_WORDS; render/session-story.js STORY_CODE_WORDS and render/session-page.js PAGE_CODE_WORDS are this
// object), the one reading order (`codeSectionPlan`), the coverage and footer lines (`codeCoverageLines`,
// `codeFooterLines`) and whether a code quote may be shown (`codeReceiptFound`). Each reader escapes, clips and lays out
// what these give it; none decides anything of its own about the report.
//
// Pure: no disk, clock, network or model. Fixed words filled with counts, paths, line numbers and the report's own
// texts. Every choice here reads structure (which list a row is in, its index, a closed token, whether a quote is
// literally in the span stored with it), never a word of a finding, a statement or a question.
import { CODE_CHECK_OUTCOMES, CODE_FILE_STATES, CODE_WITHHELD_ITEMS, CODE_CLAIM_VERDICTS } from './ledger.js';
import { codeContradictedRows, codePassFindings, codePassQuestions, codePassWithheld } from './code-pass.js';

const plain = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const list = (v) => (Array.isArray(v) ? v : []);
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const SHA256 = /^[0-9a-f]{64}$/;
const [CONTRADICTED_BY_CODE] = CODE_CHECK_OUTCOMES;
const [CLAIM_HOLDS] = CODE_CLAIM_VERDICTS;
const [WITHHELD_FINDING] = CODE_WITHHELD_ITEMS;
// Three CODE_FILE_STATES members, a CODE_FOOTER_KINDS member and a CODE_WITHHELD_REASONS member, named here by value:
// their index differs between versions of the lists (the word table's test pins that each is a member).
const OUTSIDE_ROOT = 'outside_root';
const DELETED = 'deleted';
const CHANGED_SINCE_SESSION = 'changed_since_session';
const FOOTER_WITHHELD = 'withheld';
const VERIFY_REFUTED = 'verify_refuted';

/**
 * The code step's words, one table for every reader. What the code contradicts is said as what the code at review time
 * shows, never as verified: the code was read, never run. A finding's own texts (its title, its supporting claims, its
 * input, its steps), a question and a check's explanation are the review's words, and every reader labels them so; the
 * rest is these fixed words. No reader says the code bears a row out or that a statement holds, and none shows a
 * supporting claim its check found false.
 */
export const CODE_REPORT_WORDS = Object.freeze({
  heading: 'What the code review found', label: 'Code check',
  footer: 'The code review read the code as it is now, after the session. It ran nothing.',
  // A row's code check: only what the code contradicts (a row the step did not contradict carries none).
  outcomes: Object.freeze({ [CONTRADICTED_BY_CODE]: 'the code at review time contradicts it' }),
  how: 'Sonah reviewed the change that the session made, as a code reviewer reviews a pull request. The code review '
    + 'read the change, ran nothing, and could open, search and list any file of the repository. A second reviewer '
    + 'with the same access tried to refute each finding and checked each open question. Sonah publishes a finding '
    + 'only when that check found the same problem. If the problem is real but not against your ask, the finding '
    + 'becomes an open question for you. Sonah folds the rest at the end, with the reason, and shows a quote only '
    + 'where code found it again.',
  base: (commit) => (commit ? `The change runs from the commit where the session started (${commit}) to the files as `
    + 'they are now.'
    // D100 (the audit of absence sentences): git can fail to say for any reason, so said as what Sonah could not read.
    : 'Sonah could not read from git where the session started, so the change is the edits that the session recorded.'),
  files: (shown, total, others) => `The change covers ${plural(total, 'file')}, and the code review saw the change of `
    + `${shown}.${others ? ` The others: ${others}.` : ''}`,
  // A report of an earlier code step, whose list held the files the session read beside those of the change.
  earlierFiles: (shown, total, others) => `The code review saw ${shown} of ${plural(total, 'file')} that the session `
    + `changed or read, or that differ from its start.${others ? ` The others: ${others}.` : ''}`,
  // D100: the recording may name none, or one Sonah cannot read here: said as what Sonah could not read.
  noRoot: 'The code review did not run. Sonah could not read a working directory of the session on this computer, so it '
    + 'read no file.',
  // Why the step did not run, by its gap (the report's `gaps[].code`), when it names one.
  notRun: Object.freeze({ code_step_backend: 'The code review did not run. It needs Claude Code and its read-only tools, '
    + 'and this review used another backend.' }),
  // The session changed no file: the code review had no change to read, and no reader says every file was shown.
  // D100: with no git base the change is the recorded edits only: said as what Sonah found.
  noFile: 'The code review had no change to review. Sonah found no file in the working directory that differs from where '
    + 'the session started.',
  coverage: Object.freeze({ partial: 'The code review did not finish every part of its work. The list below shows '
    + 'what it did not cover.', missing: 'The code review did not finish. The list below shows what it did not cover.' }),
  besideGroup: 'Beside what the session review found', restGroup: 'Other problems that the code review found',
  questionsGroup: 'Open questions for you',
  // Shown only when something was not covered: with nothing to list, no line says the review covered everything.
  footerGroup: 'What the code review did not cover',
  finding: 'Code review finding', codeNow: 'The code now', codeBefore: 'The code before the session',
  sessionSaid: 'Recorded in the session', input: 'For the input', trace: 'How it gets there', foundBy: 'Found through',
  concerns: 'It concerns',
  // A published finding's check. A supporting claim it found false is not shown (the report keeps it, with its verdict).
  checkLabel: 'Its check', checkHolds: 'A second reviewer traced it and found the same problem.',
  // An open question that comes from a finding the check found real but not against what you asked.
  fromFinding: 'From a finding of the code review',
  fromFindingWords: 'A second reviewer found that the code does this. It also found that this does not go against '
    + 'your ask or the contract with callers. Is it what you want?',
  withheldLabel: 'Withheld', withheldNoText: 'The code review gave no text for it.',
  withheldWhat: Object.freeze({ finding: 'A finding', question: 'An open question' }),
  withheldReasons: Object.freeze({
    malformed: 'it broke the answer\'s contract, even after one repair',
    evidence_grounding_failed: 'Sonah did not find, word for word, a quote that it rests on, even after one repair',
    out_of_scope: 'it is not about lines that the change touched',
    verify_refuted: 'its check refuted it',
    verify_cannot_tell: 'its check could not settle it from the repository',
    verify_unexecuted: 'its check did not finish',
    false_premise: 'it rests on a premise that the code shows is false',
    request_failed: 'the call that would check it failed' }),
  // A reason said without "even after one repair", for an item of which Sonah checked no repaired version (its
  // `repair`); the reasons that say nothing of a repair are said as they are.
  unrepairedReasons: Object.freeze({ malformed: 'it broke the answer\'s contract',
    evidence_grounding_failed: 'Sonah did not find, word for word, a quote that it rests on' }),
  // Why Sonah checked no repaired version of it (ledger.js CODE_REPAIR_UNCHECKED), said after the reason and its cause;
  // what the repair returned at its place, by what it is (CODE_WITHHELD_ITEMS). `different` says the fact code checked:
  // a member that names the item and that the answer gave valid (code-pass.js `sameItem`) is not the same there.
  unrepaired: Object.freeze({
    different: Object.freeze({
      finding: 'Sonah did not use the repair\'s finding at its place, because that finding differs in kind, file or file '
        + 'version',
      question: 'Sonah did not use the repair\'s question at its place, because that question differs in the item that it '
        + 'concerns' }),
    absent: Object.freeze({
      finding: 'Sonah did not check a repaired version of it, because the one repair returned no finding at its place',
      question: 'Sonah did not check a repaired version of it, because the one repair returned no question at its '
        + 'place' }),
    repeated: Object.freeze({
      finding: 'Sonah did not use the repair\'s finding at its place, because that finding repeats another finding of the '
        + 'code review',
      question: 'Sonah did not use the repair\'s question at its place, because that question repeats another question of '
        + 'the code review' }),
    failed: 'the call that would repair it failed',
    spent: 'Sonah did not ask for its repair, because the one repair asked again for the whole answer',
    unasked: 'Sonah did not check it or ask for its repair, because it is past the most items that its list may hold' }),
  // Why a check refuted it (ledger.js CODE_REFUTATION_REASONS), said after "its check refuted it".
  refutations: Object.freeze({ incorrect: 'it misreads the code', step_unsupported: 'a step does not follow from its quote',
    mitigation_shown: 'another line handles the case', input_unreachable: 'the input cannot reach it',
    rests_on_unshown_code: 'it rests on code that the reviewer did not see', out_of_scope: 'its cause is not in the change',
    unverifiable: 'the code that the reviewer saw cannot settle it',
    not_against_goal: 'the code does this, but this does not go against your ask or the contract with callers' }),
  // The closed cause beside a reason (ledger.js CODE_ITEM_ERRORS, CODE_VOID_CAUSES).
  causes: Object.freeze({ key_missing: 'a member that it needs is not there',
    key_outside_contract: 'it holds a member outside the contract', value_outside_list: 'a value is outside its closed list',
    text_over_limit: 'a text is over its length limit',
    dossier_key_unknown: 'it names a key that the session review does not hold',
    ask_key_required: 'an ask not met must name the ask',
    claim_key_required: 'a claim that the code contradicts must name the claim or decision',
    // D100 (the audit of absence sentences): the cause also stands for a receipt of the wrong shape or length, and for
    // a session quote, so it says what Sonah did not find, never what a file lacks.
    quote_ungrounded: 'Sonah found nothing in what it names that matches the quote word for word',
    // D100: two checks give this cause (code-pass.js `groundCodeReceipt`, a quote that is not on the lines that it
    // names; `groundFinding`, lines that no code step of the trace quotes), and the words name both.
    anchor_off_quote: 'the lines that it names do not hold the code that it quotes, or no step of its trace quotes '
      + 'the lines that it is about',
    file_not_readable: 'it names a file that Sonah could not read', out_of_scope: 'it is not about lines that the change '
      + 'touched',
    shape: 'the check\'s answer broke its contract',
    receipt_ungrounded: 'Sonah did not find a quote of the check\'s word for word',
    support_off_anchor: 'the check upheld it without a quote of the lines that it is about',
    support_off_trace: 'the check upheld it without a quote of another line of its trace',
    refutation_uncited: 'the check refuted it without a quote of the code that shows it' }),
  kinds: Object.freeze({ bug: 'a bug', missed_case: 'a missed case', weak_test: 'a test that would still pass with the bug',
    contract_break: 'a broken contract', ask_not_met: 'an ask not met', rule_break: 'a broken rule',
    claim_false: 'a claim of the agent\'s that the code contradicts' }),
  lenses: Object.freeze({ behaviour: 'behaviour', tests: 'tests', contracts: 'contracts', ask: 'your ask',
    rules: 'the rules', claims: 'the agent\'s claims' }),
  // The closed state of a file of the change (ledger.js CODE_FILE_STATES), with the states of earlier reports.
  states: Object.freeze({ not_shown: 'not shown whole for lack of room', binary: 'binary',
    credential_path: 'withheld as credential-shaped', harness_home: 'withheld as harness files',
    // R16: the footer's words: the file changed after the last recorded edit, which can be during the session (the
    // agent's own formatter), so never "since the session".
    oversize: 'too large for one call', changed_since_session: 'changed after the session\'s last recorded edit',
    deleted: 'not there any more', outside_root: 'outside the working directory', unreadable: 'not readable' }),
  // The footer, one line per kind (ledger.js CODE_FOOTER_KINDS, with an earlier report's `listed_by_name`), in this
  // order, each given every entry of its kind: their paths, their files' states, the parts of the calls, a count.
  footerKinds: Object.freeze({
    listed_by_name: (e) => `${plural(e.paths.length, 'file')} not shown whole for lack of room: ${e.paths.join(', ')}`,
    clipped: (e) => `${plural(e.paths.length, 'file')} whose change was too large for the code review to read: `
      + `${e.paths.join(', ')}`,
    withheld: (e) => `${plural(e.n, 'file')} whose change the code review did not see${e.states.length ? ` (${e.states
      .map(([state, k]) => `${k} ${state}`).join(', ')})` : ''}${e.paths.length ? `: ${e.paths.join(', ')}` : ''}`,
    failed: (e) => `${plural(e.count, 'call')} that did not answer${e.parts.length ? `: ${e.parts.join(', ')}` : ''}`,
    outside_root: (e) => `${plural(e.count, 'path')} outside the repository that the session wrote to, which Sonah `
      + 'counts but did not review',
    source_changed: () => 'The repository changed while the code review ran, so a file that it quotes can differ now' }),
  // A file of the change that changed after the session's last recorded edit (its state `changed_since_session`) whose
  // change the request showed: a fact, said after the files whose change it did not show.
  changedSince: (paths) => `${plural(paths.length, 'file')} changed after the session's last recorded edit, so Sonah `
    + `cannot tell whether all of ${paths.length === 1 ? 'its' : 'their'} lines are the agent's: ${paths.join(', ')}`,
  outsideLine: (n) => `${plural(n, 'path')} outside the working directory also ${n === 1 ? 'differs' : 'differ'} from `
    + 'where the session started, which Sonah did not review or name',
  // A report of an earlier code step: the repository was the home folder or held it.
  homeLine: (n) => `The repository is your home folder, so Sonah read only the files that the session changed or read.${n
    > 0 ? ` Sonah did not read, name or send ${plural(n, 'other path')} that ${n === 1 ? 'differs' : 'differ'} from `
      + 'where the session started.' : ''} Sonah did not look for untracked files that the session did not change or read`,
  // A failed call's part (ledger.js CODE_STEP_PARTS), with the parts of earlier reports.
  parts: Object.freeze({ review: 'the code review', repair: 'the repair of the code review', verify: 'a finding\'s check',
    batch: 'the check of its questions',
    check: 'the check of the session review against the code', lens: 'the lens',
    check_challenge: 'the checking passes of that check', finding_challenge: 'the checking passes of the findings' }),
  quoteUnchecked: 'Sonah does not show its quote, because it did not find the quote again where the code review read it.',
  // When no finding is published: whether the review proposed none, or how many its check withheld and where.
  noFindings: 'The code review published no finding.',
  proposedNone: 'The code review proposed no finding.',
  // A finding the second reviewer found real but not against your ask is a question for you: an item of the report, in
  // the section its tier puts it in (no one section, so none is named). Sonah withholds a finding by its own checks or by
  // the second reviewer's; every reader lists them under the section named here (render/report-words.js
  // REPORT_SECTION_WORDS.withheld, with its count).
  notPublished: (withheld, asked) => `The code review published no finding.${asked ? ` ${plural(asked, 'finding')} `
    + `that it proposed ${asked === 1 ? 'is an item' : 'are items'} of this report, as ${asked === 1 ? 'a question'
      : 'questions'} for you.` : ''}${withheld
    ? ` Sonah withheld ${withheld} of its findings. ${withheld === 1 ? 'It is' : 'They are'} under Proposals of the code `
      + `review that Sonah withheld, ${withheld === 1 ? 'with' : 'each with'} the reason.` : ''}`,
  rowKinds: Object.freeze({ promises: 'the claim', writtenClaims: 'the statement that the agent wrote into a file',
    findings: 'the contradicted claim', requirements: 'the ask', decisions: 'the decision', failures: 'the failure',
    pivots: 'the change of approach' }),
});
/** The kind of each text of CODE_REPORT_WORDS, for the style linter (packages/render/test/style-lint.js): a fragment is
 *  a part a reader joins into its own sentence or list. */
export const STYLE_KINDS = Object.freeze({
  CODE_REPORT_WORDS: 'description', 'CODE_REPORT_WORDS.heading': 'heading', 'CODE_REPORT_WORDS.label': 'label',
  'CODE_REPORT_WORDS.outcomes': 'fragment',
  ...Object.fromEntries(['besideGroup', 'restGroup', 'questionsGroup', 'footerGroup']
    .map((key) => [`CODE_REPORT_WORDS.${key}`, 'heading'])),
  ...Object.fromEntries(['finding', 'codeNow', 'codeBefore', 'sessionSaid', 'input', 'trace', 'foundBy',
    'concerns', 'checkLabel', 'fromFinding', 'withheldLabel', 'withheldWhat'].map((key) => [`CODE_REPORT_WORDS.${key}`,
    'label'])),
  ...Object.fromEntries(['withheldReasons', 'unrepairedReasons', 'unrepaired', 'refutations', 'causes', 'kinds',
    'lenses', 'states', 'footerKinds', 'changedSince', 'outsideLine', 'parts', 'rowKinds']
    .map((key) => [`CODE_REPORT_WORDS.${key}`, 'fragment'])),
});
/** The arguments each function of CODE_REPORT_WORDS is rendered with for the style linter. */
export const STYLE_FIXTURES = Object.freeze({
  'CODE_REPORT_WORDS.base': [['0123456789ab'], [null]],
  'CODE_REPORT_WORDS.files': [[1, 2, '1 binary'], [2, 2, '']],
  'CODE_REPORT_WORDS.earlierFiles': [[1, 3, '2 not shown whole for lack of room'], [2, 2, '']],
  'CODE_REPORT_WORDS.footerKinds.listed_by_name': [[{ paths: ['src/big.js'] }]],
  'CODE_REPORT_WORDS.footerKinds.clipped': [[{ paths: ['src/big.js', 'src/huge.js'] }]],
  'CODE_REPORT_WORDS.footerKinds.withheld': [[{ n: 2, states: [['binary', 1], ['deleted', 1]], paths: ['a.png', 'b.js'] }],
    [{ n: 1, states: [], paths: [] }]],
  'CODE_REPORT_WORDS.footerKinds.failed': [[{ count: 2, parts: ['the code review'] }], [{ count: 1, parts: [] }]],
  'CODE_REPORT_WORDS.footerKinds.outside_root': [[{ count: 1 }], [{ count: 3 }]],
  'CODE_REPORT_WORDS.footerKinds.source_changed': [[]],
  'CODE_REPORT_WORDS.changedSince': [[['src/a.js']], [['src/a.js', 'src/b.js']]],
  'CODE_REPORT_WORDS.outsideLine': [[1], [3]],
  'CODE_REPORT_WORDS.homeLine': [[0], [1], [2]],
  'CODE_REPORT_WORDS.notPublished': [[3, 0], [0, 1], [1, 2]],
});
/** "Working directory" and "checking passes" are technical nouns, not verbs in progress. */
export const STYLE_ALLOW = Object.freeze(Object.fromEntries(['noRoot', 'noFile', 'outsideLine', 'states.outside_root',
  'parts.check_challenge', 'parts.finding_challenge'].map((key) => [`CODE_REPORT_WORDS.${key}`, ['technical-noun']])));

const W = CODE_REPORT_WORDS;

// ---- what each reader reads ---------------------------------------------------------------------------------------

/** The items the code step withheld, each with what it is and its reason, both closed (an item with no text is still
 *  listed, said so in fixed words): code-pass.js `codePassWithheld`; null for a report of an earlier code step, which
 *  kept no text of them (its `rejected`). */
export const codeStepWithheld = (report) => (Array.isArray(report?.codePass?.withheld) ? codePassWithheld(report) : null);
/** The supporting claims a reader shows of a finding: those its check found to hold, in order. A claim it found false is
 *  cut and shown nowhere (the report keeps it, with its verdict), and neither is a claim with no closed verdict. */
export const findingClaims = (f) => list(f?.claims).filter((c) => plain(c) && typeof c.text === 'string' && c.text.trim()
  && c.verdict === CLAIM_HOLDS);
/** Is this trace step or receipt one of the session's (the person's words or a recorded result), not of a file? */
export const sessionStep = (r) => plain(r) && (r.side === 'session' || r.source === 'session');

/**
 * May a reader show this code receipt's quote? Only when it is found literally in the span the report stored with it,
 * on a side of the file (`new`, the file at review time; `old`, at the start commit) with a content hash, and — when
 * the report's list of the change's files records that side's hash — the same hash. The page never reads the
 * repository: the span is what the review read there, and code grounded the quote in it.
 */
export function codeReceiptFound(report, r) {
  if (!plain(r) || typeof r.quote !== 'string' || !r.quote || typeof r.span !== 'string' || !r.span.includes(r.quote)
      || typeof r.path !== 'string' || !r.path || !Number.isSafeInteger(r.startLine) || !Number.isSafeInteger(r.endLine)
      || !['new', 'old'].includes(r.side ?? 'new') || typeof r.sha256 !== 'string' || !SHA256.test(r.sha256)) return false;
  const file = list(report?.codePass?.files).find((f) => plain(f) && f.path === r.path);
  const sha = r.side === 'old' ? file?.baseSha256 : file?.sha256;
  return typeof sha !== 'string' || sha === r.sha256;
}

/** The order of the rows a code finding or a contradicted check may stand beside: the checklist's, your asks first. */
export const CODE_ROW_ORDER = Object.freeze(['requirements', 'promises', 'writtenClaims', 'findings', 'decisions',
  'pivots', 'failures']);
const rowAt = (report, ref) => (plain(ref) && CODE_ROW_ORDER.includes(ref.source) && Number.isSafeInteger(ref.index)
  && ref.index >= 0 && plain(list(report?.[ref.source])[ref.index]) ? { source: ref.source, index: ref.index } : null);
const byRow = (a, b) => CODE_ROW_ORDER.indexOf(a.source) - CODE_ROW_ORDER.indexOf(b.source) || a.index - b.index;
/** The row a finding sits beside: of the rows it follows from (`leadsFrom`) that the report holds, the first in the
 *  checklist's order (an ask before a claim, whatever order the review listed them in); null when it holds none. */
export const firstRowOf = (report, refs) => list(refs).map((ref) => rowAt(report, ref)).filter(Boolean).sort(byRow)[0]
  ?? null;

/**
 * What the code review found, in the order every reader shows it:
 *   beside    each row of the session review a published finding follows from (beside the first of its rows in the
 *             checklist's order: `firstRowOf`) or the code contradicts, in the checklist's order, with its findings;
 *   rest      the other findings, in table-of-contents order (by path, then line);
 *   questions the open questions for you;
 *   withheld  what the review proposed and its check withheld (null for an earlier report, which kept no text).
 * Pure: the page and the story share it.
 */
export function codeSectionPlan(report) {
  const rows = new Map();
  const at = (source, index) => {
    const key = `${source}:${index}`;
    if (!rows.has(key)) rows.set(key, { source, index, findings: [] });
    return rows.get(key);
  };
  for (const { source, row } of codeContradictedRows(report)) {
    const ref = rowAt(report, { source, index: list(report[source]).indexOf(row) });
    if (ref) at(ref.source, ref.index);
  }
  const rest = [];
  for (const f of codePassFindings(report)) {
    const ref = firstRowOf(report, f.leadsFrom);
    if (ref) at(ref.source, ref.index).findings.push(f);
    else rest.push(f);
  }
  const place = (f) => [plain(f.anchor) && typeof f.anchor.path === 'string' ? f.anchor.path : '\uffff',
    Number.isSafeInteger(f.anchor?.startLine) ? f.anchor.startLine : 0];
  rest.sort((a, b) => { const [pa, la] = place(a), [pb, lb] = place(b); return pa < pb ? -1 : pa > pb ? 1 : la - lb; });
  return { beside: [...rows.values()].sort(byRow), rest, questions: codePassQuestions(report),
    withheld: codeStepWithheld(report) };
}

/** The sentence a reader shows when no finding is published: the review proposed none; or, of the findings it
 *  proposed, how many are open questions for you (its check found them real but not against what you asked) and how
 *  many its check withheld, and where each is listed; or, for a review that did not complete or an earlier report that
 *  kept no text of what it withheld, only that none was published. Counts of the plan's lists, never their words. */
export function codeNoFindingLine(pass, withheld, questions = []) {
  if (withheld === null || pass?.coverage === 'missing' || pass?.ran !== true) return W.noFindings;
  const findings = withheld.filter((w) => w.what === WITHHELD_FINDING).length;
  const asked = list(questions).filter((q) => plain(q?.finding)).length;
  return findings || asked ? W.notPublished(findings, asked) : W.proposedNone;
}

/** The fixed words of why an item was withheld: its reason, the refutation's reason when its check refuted it, and the
 *  closed cause when there is one; for an item of which Sonah checked no repaired version (its `repair`, a
 *  CODE_REPAIR_UNCHECKED member), the reason without "even after one repair", then why (what the one repair returned at
 *  its place, by what the item is: none said for an item that is neither a finding nor a question). */
export function withheldWhy(w) {
  if (!Object.hasOwn(W.withheldReasons, w?.reason)) return null;
  const unchecked = typeof w.repair === 'string' && Object.hasOwn(W.unrepaired, w.repair);
  const words = unchecked ? W.unrepaired[w.repair] : null;
  const why = typeof words === 'string' ? words
    : plain(words) && typeof w.what === 'string' && Object.hasOwn(words, w.what) ? words[w.what] : null;
  const reason = unchecked && Object.hasOwn(W.unrepairedReasons, w.reason) ? W.unrepairedReasons[w.reason]
    : W.withheldReasons[w.reason];
  const refuted = w.reason === VERIFY_REFUTED && plain(w.check) && Object.hasOwn(W.refutations, w.check.reason)
    ? `: ${W.refutations[w.check.reason]}` : '';
  const cause = typeof w.cause === 'string' && Object.hasOwn(W.causes, w.cause) && W.causes[w.cause] !== reason
    ? ` (${W.causes[w.cause]})` : '';
  return `${reason}${refuted}${cause}${why !== null ? `, and ${why}` : ''}`;
}

// ---- coverage and the footer ----------------------------------------------------------------------------------------

const clipPath = (path, n = 120) => {
  const points = [...String(path).replace(/\s+/g, ' ')];
  if (points.length <= n) return points.join('');
  const name = [...points.join('').slice(points.join('').lastIndexOf('/') + 1)];
  if (name.length + 2 >= n) return `…${name.slice(-(n - 1)).join('')}`;
  return `${points.slice(0, n - name.length - 2).join('')}…/${name.join('')}`;
};

/** The footer's entries, each `{ kind, path?, part?, count?, state? }`: the report's list as it stands, or an earlier
 *  report's footer object (`{ listed_by_name, clipped, withheld, failed }`) read the same way. */
function footerEntries(footer) {
  if (Array.isArray(footer)) return footer.filter((e) => plain(e) && typeof e.kind === 'string');
  if (!plain(footer)) return [];
  const [LISTED, CLIPPED, WITHHELD, FAILED] = ['listed_by_name', 'clipped', 'withheld', 'failed'];
  return [...list(footer[LISTED]).map((path) => ({ kind: LISTED, path })),
    ...list(footer[CLIPPED]).map((path) => ({ kind: CLIPPED, path })),
    ...list(footer[WITHHELD]).filter(plain).map((w) => ({ kind: WITHHELD, path: w.path, state: w.state })),
    ...list(footer[FAILED]).filter(plain).map((x) => ({ ...x, kind: FAILED }))];
}

/**
 * What the code review did not cover, as reader lines (after PR-Agent's), one per footer kind in the word
 * table's order: the files whose change was too large for the request, the other files whose change it did not show
 * (with their states, from the change's list of files; a recorded write outside the working directory that lies in the
 * repository among them), and after them the files whose change it showed that changed after the session's last
 * recorded edit (a fact, `changedSince`: in a report that keeps what its check withheld, a file of the change whose
 * state is `changed_since_session` and that the footer does not name as not shown), the calls that did not answer (by
 * part, counted), the writes outside the repository (counted), whether the repository changed while the review ran;
 * then an earlier report's count of differing paths outside the working directory and its home-folder line. A path is
 * named once. None when everything was covered: a reader then shows no footer at all, never an all-clear.
 */
export function codeFooterLines(report) {
  const pass = report?.codePass;
  const entries = footerEntries(pass?.footer);
  const files = list(pass?.files).filter((f) => plain(f) && typeof f.path === 'string');
  const stateOf = new Map(files.map((f) => [f.path, f.state]));
  const clipped = new Set(entries.filter((e) => e.kind === 'clipped').map((e) => e.path));
  const unshown = new Set(entries.filter((e) => e.kind === FOOTER_WITHHELD || e.kind === 'clipped').map((e) => e.path));
  const changedSince = Array.isArray(pass?.withheld) ? [...new Set(files.filter((f) => f.state === CHANGED_SINCE_SESSION
    && !unshown.has(f.path)).map((f) => f.path))] : [];
  const lines = [];
  for (const [kind, line] of Object.entries(W.footerKinds)) {
    const mine = entries.filter((e) => e.kind === kind && !(kind === FOOTER_WITHHELD && clipped.has(e.path)));
    if (mine.length) {
      const named = [...new Set(mine.map((e) => e.path).filter((p) => typeof p === 'string' && p))];
      const paths = named.map((p) => clipPath(p));
      const stateFor = (e) => e.state ?? stateOf.get(e.path);
      const states = Object.keys(W.states).map((state) => [W.states[state], mine.filter((e) => stateFor(e) === state)
        .length]).filter(([, n]) => n > 0);
      const partOf = (x) => x.part ?? x.step;
      const parts = [...new Set(mine.filter((x) => Object.hasOwn(W.parts, partOf(x))).map((x) => (partOf(x) === 'lens'
        && Object.hasOwn(W.lenses, x.lens) ? `${W.parts.lens} ${W.lenses[x.lens]}${Number.isSafeInteger(x.group)
          ? ` (part ${x.group})` : ''}` : W.parts[partOf(x)])))];
      const count = mine.reduce((n, e) => n + (Number.isSafeInteger(e.count) && e.count > 0 ? e.count : 1), 0);
      const total = Math.max(named.length, states.reduce((k, [, m]) => k + m, 0));
      if (!((kind === 'listed_by_name' || kind === 'clipped') && !paths.length))
        lines.push(line({ paths, states, parts, count, n: total }));
    }
    if (kind === FOOTER_WITHHELD && changedSince.length)
      lines.push(W.changedSince(changedSince.map((p) => clipPath(p))));
  }
  const outside = pass?.base?.outside;
  if (Number.isSafeInteger(outside) && outside > 0) lines.push(W.outsideLine(outside));
  if (pass?.base?.homeRepository === true)
    lines.push(W.homeLine(Number.isSafeInteger(pass.base.unrecorded) && pass.base.unrecorded > 0 ? pass.base.unrecorded : 0));
  return lines;
}

/**
 * The code review's coverage lines, the same on every reader: that it did not run (why, by its gap, when the report
 * names one: else no working directory here) or had no change to review; else how many files of the change it was
 * shown (the others counted by closed state, a write outside the working directory the footer names among them), and,
 * when it ran short of complete, that it did not finish or did not complete. Fixed words and counts.
 */
export function codeCoverageLines(pass) {
  const files = list(pass?.files).filter(plain);
  if (pass?.ran !== true) {
    const gap = list(pass?.gaps).map((g) => (plain(g) ? g.code : g)).find((code) => Object.hasOwn(W.notRun, code));
    return [gap ? W.notRun[gap] : W.noRoot];
  }
  const [SHOWN] = CODE_FILE_STATES;
  const coverage = Object.hasOwn(W.coverage, pass.coverage) ? [W.coverage[pass.coverage]] : [];
  const tally = (rest) => Object.keys(W.states).map((state) => [state, rest.filter((f) => f.state === state).length])
    .filter(([, n]) => n > 0).map(([state, n]) => `${n} ${W.states[state]}`).join(', ');
  // An earlier report (no `withheld` list) listed the files the session read beside the change's: its own words.
  if (!Array.isArray(pass.withheld)) {
    if (!files.length) return [W.noFile];
    const shown = files.filter((f) => f.state === SHOWN);
    return [W.earlierFiles(shown.length, files.length, tally(files.filter((f) => f.state !== SHOWN))), ...coverage];
  }
  // A recorded write outside the working directory is listed with the change's files. One the footer names as a path
  // whose change the request did not show (it lies in the repository) is a part of the change the review did not
  // cover, counted here by its state; any other (outside the repository) is no part of the change: the footer counts
  // it. A deleted path's change is shown when its removed lines are (it has hunks); a file that changed after the
  // session's last recorded edit, when the footer does not name it as not shown.
  const unshown = new Set(footerEntries(pass.footer).filter((e) => e.kind === FOOTER_WITHHELD).map((e) => e.path));
  const change = files.filter((f) => f.state !== OUTSIDE_ROOT || unshown.has(f.path));
  if (!change.length) return [W.noFile];
  const seen = (f) => f.state === SHOWN || (f.state === DELETED && Number.isSafeInteger(f.hunks) && f.hunks > 0)
    || (f.state === CHANGED_SINCE_SESSION && !unshown.has(f.path));
  return [W.files(change.filter(seen).length, change.length, tally(change.filter((f) => !seen(f)))), ...coverage];
}
