// D87 (owner decisions 2026-10-13/14), reworked as the code step and then as the agentic code step
// (D90), and (D97) how the report model shows its report on the page and in the report .md (the story since /32) — each
// published finding an item, its question an item, its coverage and what its check withheld under What Sonah could not
// check. Every reader shows a finding's supporting
// claims its check found to hold (nothing of a false one), its input, trace and check, the code check beside each row
// the code contradicts, and every quote only when it is found again (a code quote in the span stored with it, on its
// side; a session quote in the recording). An earlier report's statements found to hold and its rows marked shown in the
// code are shown nowhere. Pure renders of a synthetic session and report: no model, no network.
import test from 'node:test';
import assert from 'node:assert/strict';
import { renderSessionPage, PAGE_VERSION } from '../session-page.js';
import { reportModel } from '../report-model.js';
import { REPORT_SECTION_WORDS, REPORT_ITEM_WORDS } from '../report-words.js';
import { CHECKLIST_REQUIREMENT_FACT_WORDS, escapeSource } from '../../evidence/src/review.js';
import { renderReportMarkdown, STORY_VERSION } from '../session-story.js';
import { codeSectionPlan, codeFooterLines, codeCoverageLines, codeReceiptFound } from '../../evidence/src/code-report.js';
import { verifyReceipt } from '../../evidence/src/session.js';
import { ATTENTION_ROWS, ATTENTION_WORDS, attentionSummary, checklistRowCounts } from '../../evidence/src/review.js';
import { CODE_REPORT_WORDS, codeNoFindingLine, codeStepWithheld, withheldWhy } from '../../evidence/src/code-report.js';
import { honestStatuses, CODE_FINDING_KINDS, CODE_PASS_LENSES, CODE_REFUTATION_REASONS, CODE_WITHHELD_REASONS,
  CODE_WITHHELD_ITEMS, CODE_ITEM_ERRORS, CODE_VOID_CAUSES, CODE_STEP_PARTS, CODE_FOOTER_KINDS, CODE_FILE_STATES,
  CODE_CHECK_OUTCOMES, CODE_VERIFY_VERDICTS, CODE_CLAIM_VERDICTS, CODE_QUESTION_VERDICTS, GAP_CODES, DECISION_COLUMNS,
  CODE_REPAIR_UNCHECKED, CODE_ACCOUNT_SCOPE } from '../../evidence/src/ledger.js';
import { countLines } from '../../cli/src/report-output.js';
import { publicCommentText } from '../../github/index.js';
import { codeSession } from '../../cli/test/code-pass-fixture.js';
import { AGENTIC_READER_VERSIONS, RELEASE_REVIEW_READER_VERSIONS, CLEANUP_READER_VERSIONS, REPORT_READER_VERSIONS,
  REPORT_MD_READER_VERSIONS, ONE_READING_READER_VERSIONS, ABSENCE_READER_VERSIONS, ABSENCE_AUDIT_READER_VERSIONS,
  GROUNDING_CAUSE_READER_VERSIONS, SEEN_READER_VERSIONS,
  ONE_BOUND_READER_VERSIONS, REPAIR_MERGE_READER_VERSIONS, PREMISE_READER_VERSIONS, ACCOUNT_READER_VERSIONS,
  ONE_ITEM_READER_VERSIONS }
  from '../../evidence/test/m33-integration-fixture.js';

const R = (eventId, role, quote) => ({ eventId, role, quote });
const QUOTE = 'const parts = input.split(",");';
const BEFORE = 'const parts = input.split(";");';
const UTIL = 'export const SEPARATOR = ",";';
const SHA = 'a'.repeat(64), BASE_SHA = 'c'.repeat(64), UTIL_SHA = 'e'.repeat(64);
const receipt = (over = {}) => ({ eventId: 'file:0123456789abcdef', role: 'code', side: 'new', quote: QUOTE,
  path: 'src/parse.js', startLine: 2, endLine: 2, sha256: SHA, span: `  ${QUOTE}`, ...over });
const before = () => receipt({ eventId: 'base:0123456789abcdef', side: 'old', quote: BEFORE, sha256: BASE_SHA,
  span: `  ${BEFORE}` });
/** A receipt of a file the change did not touch: the agentic code step may quote any file of the repository (D90). */
const util = () => receipt({ eventId: 'file:fedcba9876543210', path: 'src/util.js', startLine: 1, endLine: 1, quote: UTIL,
  sha256: UTIL_SHA, span: UTIL });
const codeCheck = (outcome, over = {}) => ({ outcome, receipts: [receipt(over)], by: 'finding' });
const ref = (key, kind, source, index) => ({ key, kind, source, index, id: null });
const ASK = ref('S1', 'ask', 'requirements', 0), CLAIM = ref('S2', 'claim', 'promises', 0),
  DECISION = ref('S3', 'decision', 'decisions', 0);
const TRUE_CLAIM = 'SYNTHETIC a supporting claim its check found true.';
const FALSE_CLAIM = 'SYNTHETIC a supporting claim its check found false.';
/** A published finding of the agentic code step (as the code step writes it): its trace a step quoting the
 *  person's words, a step on the old side and one on the file now; one supporting claim that holds and one its check
 *  found false. The review named the claim first and the ask second. */
const finding = (over = {}) => ({ id: `sha256:${'3'.repeat(64)}`, origin: 'code-review', status: 'DECIDE',
  scope: 'current-code', kind: 'ask_not_met', lens: 'ask', foundByLenses: ['ask'], title: 'Empty input gives [""]',
  claims: [{ text: TRUE_CLAIM, verdict: 'holds' }, { text: FALSE_CLAIM, verdict: 'false' }], input: 'parse("")',
  trace: [{ step: 'You asked for [] on empty input.', source: 'session', eventId: 'I1', role: 'instruction',
    quote: 'returns [] for empty input' },
  { step: 'It used to split on semicolons.', source: 'base', ...before() },
  { step: 'An empty string splits into one empty part.', source: 'file', ...receipt() }],
  anchor: { path: 'src/parse.js', side: 'new', startLine: 2, endLine: 3 }, leadsFrom: [CLAIM, ASK], receipts: [receipt()],
  check: { verdict: 'holds', explanation: 'SYNTHETIC check traced parse("") to line 2.', receipts: [receipt()] }, ...over });
const restFinding = () => finding({ id: `sha256:${'4'.repeat(64)}`, kind: 'contract_break', lens: 'contracts',
  foundByLenses: ['contracts'], title: 'SYNTHETIC rest finding', claims: [], leadsFrom: [],
  anchor: { path: 'src/parse.js', side: 'new', startLine: 1, endLine: 1 } });
/** What an earlier code step published as traced and found to hold (the cleanup: shown on no reader). */
const held = () => [
  { id: 'H1', statement: 'SYNTHETIC held: the decision to split on commas is carried through.', concerns: DECISION,
    receipts: [receipt()], check: { verdict: 'holds', explanation: 'SYNTHETIC held check words.' } },
  { id: 'H2', statement: 'SYNTHETIC held with no row: the separator is one constant.', concerns: null, receipts: [util()],
    check: { verdict: 'holds', explanation: 'SYNTHETIC second held check.' } }];
const questions = () => [
  { id: 'Q1', question: 'Should an empty input be an error instead?', from: 'review', concerns: ASK,
    quote: { source: 'session', eventId: 'I1', role: 'instruction', quote: 'returns [] for empty input' },
    check: { verdict: 'sound', explanation: 'SYNTHETIC premise holds.' } },
  { id: 'Q2', question: 'SYNTHETIC not against your goal: trailing spaces are kept', from: 'finding', concerns: ASK,
    quote: null, finding: { title: 'SYNTHETIC not against your goal: trailing spaces are kept', kind: 'missed_case',
      anchor: { path: 'src/parse.js', side: 'new', startLine: 3, endLine: 3 } },
    check: { verdict: 'refuted', reason: 'not_against_goal',
      explanation: 'SYNTHETIC behaviour as stated, and the ask does not cover it.' } }];
const withheld = () => [
  { what: 'finding', reason: 'verify_refuted', text: 'SYNTHETIC withheld finding: split drops the last part.', kind: 'bug',
    lens: 'behaviour', anchor: { path: 'src/parse.js', side: 'new', startLine: 2, endLine: 2 }, leadsFrom: [ASK],
    check: { verdict: 'refuted', reason: 'incorrect', explanation: 'SYNTHETIC refutation: line 3 keeps every part.' } },
  { what: 'finding', reason: 'verify_cannot_tell', text: 'SYNTHETIC withheld finding its check could not settle.',
    kind: 'missed_case', check: { verdict: 'cannot_tell', explanation: 'SYNTHETIC settling it needs a run.' } },
  { what: 'question', reason: 'false_premise', text: 'SYNTHETIC withheld question?',
    check: { verdict: 'false_premise', explanation: 'SYNTHETIC the premise is false.' } },
  { what: 'finding', reason: 'malformed', cause: 'text_over_limit', text: 'SYNTHETIC malformed finding', kind: 'bug' },
  { what: 'finding', reason: 'malformed', cause: 'key_missing', text: null }];

/** An earlier report's withheld statement found to hold (the cleanup: listed nowhere). */
const EARLIER_WITHHELD = Object.freeze({ what: 'held', reason: 'verify_cannot_tell',
  text: 'SYNTHETIC withheld statement found to hold.', check: { verdict: 'cannot_tell', explanation: 'SYNTHETIC run.' } });

/** A finished session review of `codeSession`, with the agentic code step's report joined (as the code step
 *  writes it): the claim contradicted by the code (a claim_false finding's join), the decision and the ask with no code
 *  check; one finding that names the claim first and the ask second, one that follows from no row, two open questions
 *  (one from a finding its check found not against your goal), five withheld items (one with no text) and a footer of
 *  every kind. `earlier`: as an earlier code step wrote it besides — two statements found to hold, a withheld one, and
 *  the decision's code check reading shown in the code. */
const FOOTER = [{ kind: 'withheld', path: 'big.js' }, { kind: 'withheld', path: 'logo.png' }, { kind: 'clipped', path: 'big.js' },
  { kind: 'failed', part: 'verify', count: 1 }, { kind: 'outside_root', count: 2 }, { kind: 'source_changed' }];
function report({ findings = [finding(), restFinding()], questionList = questions(), withheldList = withheld(),
  footer = FOOTER, coverage = 'partial', earlier = false, heldList = held(), files = [{ path: 'src/parse.js',
    type: 'modified', state: 'shown', sha256: SHA, hunks: 1 }, { path: 'big.js', type: 'added', state: 'oversize' },
  { path: 'logo.png', type: 'added', state: 'binary' }, { path: '../scratch.txt', state: 'outside_root' }] } = {}) {
  return {
    repo: { host: 'github.com', id: '0' }, reviewScope: 'session-only', pr: null, codeCoverage: 'missing',
    coverage: 'complete', sessionReview: 'complete', findings: [], failures: [], writtenClaims: [], pivots: [],
    counts: { decisions: 1, byColumn: { ...Object.fromEntries(DECISION_COLUMNS.map((c) => [c, 0])), unasked: 1 },
      uncheckedColumn: 0 },
    promises: [{ id: `sha256:${'1'.repeat(64)}`, stated: R('C1', 'commentary', 'parse now returns an empty list for empty input.'),
      text: 'The agent said parse returns an empty list for empty input.', status: 'open', receipts: [],
      codeCheck: codeCheck('contradicted-by-code') }],
    requirements: [{ text: 'Return [] for empty input.', instruction: R('I1', 'instruction',
      'SYNTHETIC_CODE_ASK: add a parse function that returns [] for empty input, and do not touch the README.'),
    status: 'partly-done', deliverable: R('W1', 'code', 'export function parse(input) {'),
    shortfall: R('C1', 'commentary', 'parse now returns an empty list for empty input.') }],
    decisions: [{ id: `sha256:${'2'.repeat(64)}`, dimension: 'How to split the input', chosen: 'Split on commas',
      actions: ['W1'], column: 'unasked', stated: null,
      ...(earlier ? { codeCheck: { ...codeCheck('shown-in-code'), by: 'held' } } : {}) }],
    codePass: { version: 'SYNTHETIC', ran: true, coverage, required: false, gaps: [], files,
      base: { kind: 'git', commit: 'b'.repeat(40), how: 'reflog' },
      agent: { turns: 12, tools: { Read: 9, Grep: 3, Glob: 1 }, reads: 6, terminal: 'answered' },
      calls: { review: 1, repair: 0, verify: 3, verifyRepeat: 0, batch: 1, batchRepeat: 0 },
      findings, questions: questionList, withheld: withheldList, footer,
      ...(earlier ? { held: heldList, withheld: [...withheldList, EARLIER_WITHHELD] } : {}) },
  };
}
const esc = (text) => text.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/'/g, '&#39;').replace(/</g, '&lt;')
  .replace(/>/g, '&gt;');
/** D97: the page's items and What Sonah could not check, where the code step's report is shown (the code section is gone). */
const codeSectionOf = (page) => page.slice(page.indexOf('id="must-act"'), page.indexOf('<footer'));
const PAGE_CODE_WORDS = CODE_REPORT_WORDS;
const itemsOf = (model) => [...model.tiers.must_act, ...model.tiers.must_know, ...model.tiers.good_to_know];
const itemByTitle = (model, title) => itemsOf(model).find((item) => item.what.parts.some((p) => p.text === title));
const itemHtml = (page, n) => { const at = page.indexOf(`id="item-${n}"`);
  const end = Math.min(...['</article>', '</details>\n<details class="item', '</details></details>'].map((m) => {
    const i = page.indexOf(m, at); return i < 0 ? Infinity : i; }));
  return page.slice(at, end); };
/** The report .md (D97: the story since /32) of a report, on the code session. */
const mdOf = (r) => renderReportMarkdown(codeSession(), r);
/** Markdown text as the report .md writes it: escaped (review.js `escapeSource`, and `~` and `$`). */
const mdEsc = (text) => escapeSource(text).replace(/[~$]/g, (c) => `\\${c}`);
/** The quote-grounding rule every reader applies (the report model, through code-report.js `codeReceiptFound` and
 *  session.js `verifyReceipt`): a code receipt's quote, or a session step's, as a reader may show it, or null. */
const codeQuoteOf = (report, r) => (codeReceiptFound(report, r) ? r.quote : null);
const sessionQuoteOf = (session, r) => {
  if (r === null || typeof r !== 'object' || typeof r.quote !== 'string' || !r.quote || typeof r.eventId !== 'string') return null;
  try { return verifyReceipt(session, { eventId: r.eventId, role: r.role, quote: r.quote }).ok ? r.quote : null; }
  catch { return null; }
};

test('agentic code step page (D97): each published finding is an item, with its trace, its holding claims and its check', () => {
  const session = codeSession();
  const r = report();
  const page = renderSessionPage(session, r);
  const model = reportModel(session, r, {});
  // The ask_not_met finding names the partly done ask: one item, the ask folded into it (D97).
  const notMet = itemByTitle(model, 'Empty input gives [""]');
  assert.deepEqual([notMet.kind, notMet.tier.final], ['code_ask_not_met', 'must_act']);
  assert.deepEqual(notMet.rows.map((x) => x.source), ['codePass.findings', 'requirements']);
  const rest = itemByTitle(model, 'SYNTHETIC rest finding');
  assert.deepEqual([rest.kind, rest.tier.final], ['code_contract', 'must_act']);
  const item = itemHtml(page, notMet.n);
  assert.match(item, /<em class="by-code-review">Empty input gives \[&quot;&quot;\]<\/em>/);
  assert.match(item, /<code>src\/parse\.js:2-3<\/code>/);
  // Its holding claim as the code review's words; nothing of the false one, anywhere.
  assert.ok(item.includes(`<em class="by-code-review">${esc(TRUE_CLAIM)}</em>`));
  assert.ok(!page.includes(esc(FALSE_CLAIM)) && !page.includes('<s>'), 'a claim its check found false is shown nowhere');
  assert.ok(item.includes(`${REPORT_ITEM_WORDS.forExample}</span> <em class="by-code-review">parse(&quot;&quot;)</em>`));
  // The trace: a step quoting your words, a step on the old side and one on the file now, each quote checked.
  assert.ok(item.includes('<q class="said">returns [] for empty input</q>'));
  // A code step's quote is the code as the code review read it, under its side's label, never in the recording's
  // quotation marks (only a quote of the recording is).
  assert.match(item, new RegExp(`<span class="label">${REPORT_ITEM_WORDS.codeBefore}</span> <code>[^<]+</code> `
    + `<code>${esc(BEFORE).replace(/[()[\]]/g, '\\$&')}</code>`), 'the old side\'s code, checked by its span');
  assert.match(item, new RegExp(`<span class="label">${REPORT_ITEM_WORDS.codeNow}</span> <code>[^<]+</code> `
    + `<code>${esc(QUOTE).replace(/[()[\]]/g, '\\$&')}</code>`));
  assert.ok(!item.includes(`<q class="said"><code>${esc(BEFORE)}</code></q>`)
    && !item.includes(`<q class="said"><code>${esc(QUOTE)}</code></q>`));
  assert.ok(item.includes(`${esc(CODE_REPORT_WORDS.checkHolds)} <em class="by-code-review">SYNTHETIC check traced `
    + 'parse(&quot;&quot;) to line 2.</em>'));
  assert.doesNotMatch(page, /found to hold|found it holds|code-held-/);
  // The questions: the review's (checked: Must know), and one from a finding its check found not against your goal.
  const q1 = itemByTitle(model, 'Should an empty input be an error instead?');
  const q2 = itemByTitle(model, 'SYNTHETIC not against your goal: trailing spaces are kept');
  assert.deepEqual([q1.kind, q1.tier.final, q2.kind, q2.tier.final], ['code_question', 'must_know',
    'code_question_finding', 'good_to_know']);
  assert.ok(itemHtml(page, q2.n).includes(esc(CODE_REPORT_WORDS.fromFindingWords)));
  assert.equal(page.split('SYNTHETIC not against your goal').length, 2, 'its title once, not again as the question');
  // The footer's kinds, under What Sonah could not check.
  const section = page.slice(page.indexOf('id="not-checked"'));
  // D109: hunks left out for room are said so, never "too large".
  assert.match(section, /1 file whose change Sonah left out of the code review&#39;s input for room: big\.js/);
  assert.match(section, /1 file whose change the code review did not see \(1 binary\): logo\.png/);
  assert.match(section, /1 call that did not answer: a finding&#39;s check/);
  assert.match(section, /The repository changed while the code review ran, so a file that it quotes can differ now/);
  assert.ok(section.includes(esc(CODE_REPORT_WORDS.how)));
  assert.match(section, /The change runs from the commit where the session started \(b{40}\) to the files as they are now\./);
  for (const word of ['severity', 'confidence', 'verified']) assert.doesNotMatch(codeSectionOf(page), new RegExp(word, 'i'));
  // A row the code contradicts says so, in fixed words: here the claim, in the claims list.
  assert.ok(page.includes('<span class="tag">contradicted by the code review</span>'));
  assert.doesNotMatch(page, /the code at review time shows it/);
});

test('agentic code step page: what its check withheld is folded under What Sonah could not check, each with its text, why and its check\'s words', () => {
  const page = renderSessionPage(codeSession(), report());
  const section = page.slice(page.indexOf('id="not-checked"'));
  const from = section.indexOf(esc(REPORT_SECTION_WORDS.withheld(5)));
  assert.ok(from > 0, 'under What Sonah could not check, counted');
  const fold = section.slice(from, section.indexOf('</details>', from));
  assert.ok(fold.includes('<span class="label">A finding</span> <em class="by-code-review">SYNTHETIC withheld finding: '
    + 'split drops the last part.</em> · Why Sonah withheld it: its check refuted it: it misreads the code.'));
  assert.ok(fold.includes('SYNTHETIC refutation: line 3 keeps every part.'));
  assert.ok(fold.includes('its check could not settle it from the repository.'));
  assert.ok(fold.includes('<span class="label">An open question</span>'));
  assert.ok(fold.includes('it rests on a premise that the code shows is false.'));
  assert.ok(fold.includes('it broke the answer&#39;s contract, even after one repair (a text or a list is over its length '
    + 'limit).'));
  assert.ok(fold.includes('The code review gave no text for it.'), 'an item with no text, in fixed words');
  assert.ok(fold.includes('(a member that it needs is not there)'));
  // Nothing withheld is anywhere else on the page.
  for (const w of withheld().filter((x) => x.text)) assert.equal(page.split(esc(w.text)).length, 2, `${w.text}: once, in the fold`);
  // An item the review gave no text member at all is still listed and counted in the fold, on every reader.
  const bare = report({ withheldList: [{ what: 'question', reason: 'malformed', cause: 'key_missing' }] });
  const bareFold = codeSectionOf(renderSessionPage(codeSession(), bare));
  assert.ok(bareFold.includes(REPORT_SECTION_WORDS.withheld(1)) && bareFold.includes('The code review gave no text for it.'));
  assert.ok(mdOf(bare).includes('- An open question The code review gave no text for it.'), mdOf(bare));
});

test('agentic code step: an item in whose place no item of the repair stood never reads "even after one repair"; it says why, saying only what code compared, on every reader', () => {
  const W = CODE_REPORT_WORDS;
  // The members a report writes now, then an earlier report's (code-pass/10, read at the item's index), kept with the
  // words it was written with.
  const EARLIER = ['different', 'absent', 'repeated'];
  assert.deepEqual(Object.keys(W.unrepaired), [...CODE_REPAIR_UNCHECKED, ...EARLIER]);
  assert.ok(EARLIER.every((repair) => !CODE_REPAIR_UNCHECKED.includes(repair)));
  // What code compared is said by what the item is: a finding or a question (D107, F3a: which item of the repair
  // matched it, by identity). `unplaced` is a finding's alone (a question has no anchor), so a question that came with
  // it would get no words of why, and never a finding's.
  for (const repair of ['unmatched', 'uncompared', 'ambiguous', 'matched_past_limit', 'unnamed', ...EARLIER])
    assert.deepEqual(Object.keys(W.unrepaired[repair]), [...CODE_WITHHELD_ITEMS]);
  assert.deepEqual(Object.keys(W.unrepaired.unplaced), ['finding']);
  const item = (reason, cause, repair, what = 'finding') => ({ what, reason, cause, ...(repair ? { repair } : {}),
    text: `SYNTHETIC ${reason} ${repair ?? 'checked'}`, kind: 'bug' });
  // A repair that was checked (the same item, which failed again): the words as they were.
  assert.equal(withheldWhy(item('malformed', 'value_outside_list')),
    'it broke the answer\'s contract, even after one repair (a value is outside its closed list)');
  assert.equal(withheldWhy(item('evidence_grounding_failed', 'anchor_off_quote')), 'Sonah did not find, word for word, '
    + 'a quote that it rests on, even after one repair (the lines that it names do not hold the code that it quotes, or '
    + 'no step of its trace quotes the lines that it is about)');
  // None stood in its place: the reason without the repair, its cause, then what code compared. No sentence says that
  // Sonah checked no repaired version, or that a copy repeats another item: a repair that corrects the very part an
  // identity reads (an anchor's lines, a missing anchor, a question's words) matches nothing, and is checked as a new
  // item.
  const contract = 'it broke the answer\'s contract (a value is outside its closed list), and ';
  assert.deepEqual(CODE_REPAIR_UNCHECKED.map((repair) => withheldWhy(item('malformed', 'value_outside_list', repair))), [
    `${contract}no finding of the repair matched it by kind, file version and lines`,
    `${contract}Sonah could not compare it by kind, file version and lines with every finding of the repair, and none `
      + 'that it could compare that way matched it: the anchor of each other one is missing, is not in the shape of the '
      + 'answer\'s contract, names lines that are not all lines of a file version that Sonah could read, or ends before '
      + 'it starts',
    `${contract}a finding of the repair matched it, but Sonah put none in its place, because more than one finding of `
      + 'the repair matched it, or the one that matched it also matched another finding of the code review',
    `${contract}a finding of the repair matched it, but Sonah did not check that finding, because it is past the most `
      + 'items that its list may hold',
    `${contract}no finding of the repair could match it by kind, file version and lines, because its anchor is missing `
      + 'or is not in the shape of the answer\'s contract',
    `${contract}no finding of the repair could match it by kind, file version and lines, because the lines that its `
      + 'anchor names are not all lines of a file version that Sonah could read, or its last line is before its first',
    `${contract}Sonah did not ask for its repair, because it came in the one repair`,
    `${contract}the call that would repair it failed`,
    `${contract}Sonah did not ask for its repair, because the one repair asked again for the whole answer`,
    `${contract}Sonah did not check it or ask for its repair, because it is past the most items that its list may hold`,
    // D105: a repair too large to send is never said as a call that failed.
    `${contract}Sonah did not ask for its repair, because the repair's input was too large to send`,
    // F3b (D111): a finding of the accounting, for which no repair is asked.
    `${contract}Sonah did not ask for its repair, because it came with the code review's item-by-item check of the `
      + 'session review\'s asks, of the statements that the agent wrote into a file and of the agent\'s decisions not to '
      + 'act']);
  for (const repair of CODE_REPAIR_UNCHECKED)
    assert.doesNotMatch(withheldWhy(item('malformed', 'value_outside_list', repair)),
      /checked no repaired version|repeats another/, repair);
  const grounding = 'Sonah did not find, word for word, a quote that it rests on (Sonah found nothing in what it names '
    + 'that matches the quote word for word), and ';
  assert.deepEqual(['unmatched', 'uncompared', 'ambiguous', 'matched_past_limit', 'unnamed', 'unplaced'].map((repair) =>
    withheldWhy(item('evidence_grounding_failed', 'quote_ungrounded', repair, 'question'))), [
    `${grounding}no question of the repair matched it by its words and its item`,
    `${grounding}Sonah could not compare it by its words and its item with every question of the repair, and none that `
      + 'it could compare that way matched it: each other one gives no text of a question',
    `${grounding}a question of the repair matched it, but Sonah put none in its place, because more than one question `
      + 'of the repair matched it, or the one that matched it also matched another question of the code review',
    `${grounding}a question of the repair matched it, but Sonah did not check that question, because it is past the most `
      + 'items that its list may hold',
    `${grounding}no question of the repair could match it by its words and its item, because it gives no text of a `
      + 'question',
    // A question never comes with `unplaced`; were one to, it reads the reason and its cause alone, never "even after
    // one repair".
    'Sonah did not find, word for word, a quote that it rests on (Sonah found nothing in what it names that matches the '
      + 'quote word for word)']);
  // An earlier report's member keeps the words it was written with (what the repair returned at the item's index),
  // never "even after one repair": that report checked no repaired version of it.
  assert.deepEqual(EARLIER.flatMap((repair) => CODE_WITHHELD_ITEMS.map((what) => withheldWhy(item('malformed',
    'value_outside_list', repair, what)))), [
    `${contract}Sonah did not use the repair's finding at its place, because that finding differs in kind, file or file `
      + 'version',
    `${contract}Sonah did not use the repair's question at its place, because that question differs in the item that `
      + 'it concerns',
    `${contract}Sonah did not check a repaired version of it, because the one repair returned no finding at its place`,
    `${contract}Sonah did not check a repaired version of it, because the one repair returned no question at its place`,
    `${contract}Sonah did not use the repair's finding at its place, because that finding repeats another finding of `
      + 'the code review',
    `${contract}Sonah did not use the repair's question at its place, because that question repeats another question `
      + 'of the code review']);
  // A reason that says nothing of a repair is said as it is, its cause once.
  assert.equal(withheldWhy(item('out_of_scope', 'out_of_scope', 'failed')),
    'it is not about lines that the change touched, and the call that would repair it failed');
  assert.equal(withheldWhy(item('out_of_scope', 'out_of_scope', 'unmatched')), 'it is not about lines that the change '
    + 'touched, and no finding of the repair matched it by kind, file version and lines');
  // A value outside the list is no word at all: the record reads as one whose repair was checked.
  assert.equal(withheldWhy(item('malformed', 'key_missing', 'SYNTHETIC')),
    'it broke the answer\'s contract, even after one repair (a member that it needs is not there)');
  // An item that is neither a finding nor a question: no words of what code compared, and never "even after".
  assert.equal(withheldWhy(item('malformed', 'key_missing', 'unmatched', 'SYNTHETIC')),
    'it broke the answer\'s contract (a member that it needs is not there)');
  // The page and the report .md say it in the fold of what Sonah withheld, and in the ask's row the finding is about.
  for (const repair of [...CODE_REPAIR_UNCHECKED, ...EARLIER]) {
    const w = { ...item('malformed', 'value_outside_list', repair), leadsFrom: [ASK] };
    const r = report({ withheldList: [w] });
    const why = withheldWhy(w);
    const page = renderSessionPage(codeSession(), r);
    const md = mdOf(r);
    assert.ok(page.includes(esc(why)) && md.includes(why), repair);
    for (const text of [page, md]) assert.doesNotMatch(text, /even after one repair/, repair);
  }
});

test('agentic code step: a quote is shown only when it is found again — a code span on its side, a session quote in the recording', () => {
  const tamperings = [{ span: `  ${BEFORE}` }, { sha256: 'b'.repeat(64) }, { sha256: 'not-a-hash' },
    { side: 'session-ish' }, { startLine: null }, { path: '' }];
  for (const over of tamperings) {
    const tampered = receipt(over);
    const r = report({ findings: [finding({ trace: [{ step: 'One step.', ...tampered }] })] });
    assert.equal(codeQuoteOf(r, tampered), null, JSON.stringify(over));
    // The page: the step's words, and no quote of it, nor an excerpt from its span.
    const item = codeSectionOf(renderSessionPage(codeSession(), r));
    assert.ok(item.includes('One step.') && !item.includes(esc(QUOTE)), JSON.stringify(over));
    // The report .md: the step's words, and no quote of it, nor an excerpt from its span.
    const story = mdOf(r);
    assert.ok(story.includes('One step.') && !story.includes(QUOTE), JSON.stringify(over));
  }
  // The same trace step, untampered: shown on each.
  const held = report({ findings: [finding({ trace: [{ step: 'One step.', ...receipt() }] })] });
  assert.ok(mdOf(held).includes(`- The code now: \`src/parse.js:2\` \`${QUOTE}\``), mdOf(held));
  assert.equal(codeQuoteOf(report(), receipt()), QUOTE);
  assert.equal(codeQuoteOf(report(), before()), BEFORE);
  // D90: a quote of any file of the repository, outside the change's list, is shown when its stored span holds it; so is
  // a quote of a file of the change whose hash on that side the list does not record.
  assert.equal(codeQuoteOf(report(), util()), UTIL);
  // A hash the change's list records for that side must match: the file now's, or (an earlier report's) the start
  // commit's.
  assert.equal(codeQuoteOf(report(), receipt({ sha256: 'b'.repeat(64) })), null, 'a recorded hash must match');
  const earlier = report({ files: [{ path: 'src/parse.js', type: 'modified', state: 'shown', sha256: SHA,
    baseSha256: BASE_SHA }] });
  assert.equal(codeQuoteOf(earlier, before()), BEFORE);
  assert.equal(codeQuoteOf(earlier, receipt({ side: 'old' })), null, 'the old side against its own recorded hash');
  assert.equal(codeQuoteOf(report(), { ...util(), span: 'export const SEPARATOR = ";";' }), null);
  // A session quote the recording does not hold is not shown.
  const session = codeSession();
  assert.equal(sessionQuoteOf(session, { eventId: 'I1', role: 'instruction', quote: 'returns [] for empty input' }),
    'returns [] for empty input');
  assert.equal(sessionQuoteOf(session, { eventId: 'I1', role: 'instruction', quote: 'SYNTHETIC never said' }), null);
  assert.equal(sessionQuoteOf(session, { eventId: 'C1', role: 'instruction', quote: 'parse now returns' }), null);
  const unheld = report({ findings: [finding({ trace: [{ step: 'Asked.', side: 'session', eventId: 'I1', role: 'instruction',
    quote: 'SYNTHETIC never said' }] })] });
  assert.ok(!mdOf(unheld).includes('SYNTHETIC never said'));
  assert.ok(!codeSectionOf(renderSessionPage(codeSession(), unheld)).includes('SYNTHETIC never said'));
});

test('agentic code step report .md (D97): a finding\'s holding claims and check, the questions and the fold; no false claim', () => {
  const story = mdOf(report());
  assert.ok(story.includes(`- *${mdEsc(TRUE_CLAIM)}*`), story);
  assert.ok(!story.includes(FALSE_CLAIM) && !story.includes('~~'), 'a claim its check found false is shown nowhere');
  assert.doesNotMatch(story, /found to hold|found it holds/);
  // An open question from a finding: its fixed sentence and its check's explanation.
  assert.ok(story.includes(CODE_REPORT_WORDS.fromFindingWords));
  // What the check withheld: folded, counted, each with why.
  assert.ok(story.includes(`<details><summary>${REPORT_SECTION_WORDS.withheld(5)}</summary>`));
  assert.ok(story.includes('Why Sonah withheld it: its check refuted it: it misreads the code.'));
  // A row the code contradicts says so, in the claims list, with its words and the item of the finding that follows
  // from it; nothing says the code shows a row.
  assert.match(story, /- contradicted by the code review → item \d+ “parse now returns/, story);
  assert.doesNotMatch(story, /the code at review time shows it|not checked in the code/);
  // Without a code pass, no word of it.
  const { codePass: _pass, ...plain } = report();
  const strip = (rows) => rows.map(({ codeCheck: _c, ...row }) => row);
  const without = mdOf({ ...plain, promises: strip(plain.promises), requirements: strip(plain.requirements),
    decisions: strip(plain.decisions) });
  assert.doesNotMatch(without, /contradicted by the code review|Proposals of the code review/);
});

test('agentic code step: a review question with no session receipt shows its question and its row, and no quote, on every reader', () => {
  // A question whose quote was found only in the words its item's dossier line showed (a decision's own words, which no
  // session text holds): published with quote null.
  const q = { id: 'Q1', question: 'SYNTHETIC should the input be split on commas?', from: 'review', concerns: DECISION,
    quote: null, check: { verdict: 'sound', explanation: 'SYNTHETIC the split is on commas.' } };
  const r = report({ questionList: [q] });
  const model = reportModel(codeSession(), r, {});
  // D112 amended (2026-10-18): a question that names no recorded place (quote null, no anchor) shares no place with the
  // decision's item, so it is an item of its own, never a member of the decision it concerns.
  const asked = itemByTitle(model, 'SYNTHETIC should the input be split on commas?');
  assert.equal(asked.kind, 'code_question');
  const decision = itemsOf(model).find((item) => item.rows[0].source === 'decisions');
  assert.deepEqual(decision.members, [], 'the decision holds no member');
  assert.equal(asked.quote, null);
  const pageItem = itemHtml(renderSessionPage(codeSession(), r), asked.n);
  assert.ok(pageItem.includes('SYNTHETIC should the input be split on commas?'), pageItem);
  assert.ok(!pageItem.includes('<q class="said">') && !/null|undefined/.test(pageItem), pageItem);
  const story = mdOf(r);
  const at = story.indexOf(`<a name="item-${asked.n}"></a>`);
  const block = story.slice(at, story.indexOf('<a name="item-', at + 1) === -1 ? undefined
    : story.indexOf('<a name="item-', at + 1));
  assert.ok(block.includes('*SYNTHETIC should the input be split on commas?*'), block);
  assert.ok(!block.includes('“') && !/null|undefined/.test(block), block);
});

// An earlier report, as the code step wrote it before the cleanup: its statements found to hold, its withheld statement
// and its row marked shown in the code are on no reader — not the page, the report .md, the count lines or the
// PR comment — and each reader is byte for byte what it is for the report without them.
test('agentic code step: an earlier report\'s statements found to hold and its rows shown in the code are on no reader', () => {
  const earlier = report({ earlier: true });
  const now = report();
  assert.equal(renderSessionPage(codeSession(), earlier), renderSessionPage(codeSession(), now));
  assert.equal(mdOf(earlier), mdOf(now));
  assert.deepEqual(countLines(reportModel(codeSession(), earlier)), countLines(reportModel(codeSession(), now)));
  assert.equal(publicCommentText({ ...earlier, ...honestStatuses(earlier) }).summary,
    publicCommentText({ ...now, ...honestStatuses(now) }).summary);
  for (const text of [renderSessionPage(codeSession(), earlier), mdOf(earlier)]) {
    assert.doesNotMatch(text, /SYNTHETIC (?:held|withheld statement)|found to hold|found it holds|shows it|code-held-/);
  }
  assert.equal(Object.hasOwn(codeSectionPlan(earlier), 'held'), false);
  assert.equal(codeStepWithheld(earlier).length, withheld().length, 'its withheld statement is listed nowhere');
});

// What the check withheld is listed by its closed kind and reason: an item outside either list is not one Sonah's code
// step wrote, and no reader lists or counts it.
test('agentic code step: a withheld item outside the closed lists is listed and counted nowhere', () => {
  const r = report({ withheldList: [...withheld(), { what: 'finding', reason: 'SYNTHETIC_reason', text: 'SYNTHETIC open reason' },
    { what: 'SYNTHETIC_item', reason: 'malformed', text: 'SYNTHETIC open item' }] });
  assert.equal(codeStepWithheld(r).length, 5);
  const page = codeSectionOf(renderSessionPage(codeSession(), r));
  const story = mdOf(r);
  assert.ok(page.includes(REPORT_SECTION_WORDS.withheld(5)) && story.includes(REPORT_SECTION_WORDS.withheld(5)));
  for (const text of [page, story]) {
    assert.ok(!text.includes('SYNTHETIC open reason') && !text.includes('SYNTHETIC open item'));
  }
});

test('agentic code step: a supporting claim its check found false is shown nowhere, on any reader; the report keeps it', () => {
  const r = report({ findings: [finding()] });
  assert.deepEqual(r.codePass.findings[0].claims.map((c) => c.verdict), ['holds', 'false'], 'the record keeps both');
  const page = renderSessionPage(codeSession(), r);
  assert.ok(page.includes(`<em class="by-code-review">${esc(TRUE_CLAIM)}</em>`));
  assert.ok(!page.includes(esc(FALSE_CLAIM)) && !page.includes('<s>'));
  const story = mdOf(r);
  assert.ok(story.includes(`*${mdEsc(TRUE_CLAIM)}*`) && !story.includes(FALSE_CLAIM));
  for (const text of [page, story]) assert.doesNotMatch(text, /found this false/);
  // Only false claims: no list of claims at all.
  const allFalse = report({ findings: [finding({ claims: [{ text: FALSE_CLAIM, verdict: 'false' }] })] });
  const item = codeSectionOf(renderSessionPage(codeSession(), allFalse));
  assert.ok(!item.includes(esc(FALSE_CLAIM)));
  // A claim with no closed verdict is shown as neither.
  const odd = report({ findings: [finding({ claims: [{ text: 'SYNTHETIC unjudged claim', verdict: 'maybe' }] })] });
  assert.ok(!renderSessionPage(codeSession(), odd).includes('SYNTHETIC unjudged claim'));
  assert.ok(!mdOf(odd).includes('SYNTHETIC unjudged claim'));
  // No text strikes itself through (GFM `~~`) in the report .md: a holding claim's own tildes, a step's
  // and a quote's are escaped (in the report .md a code quote is a code span); a false claim's are shown nowhere.
  const tildes = report({ findings: [finding({ claims: [{ text: '~~SYNTHETIC looks struck~~', verdict: 'holds' },
    { text: 'SYNTHETIC a ~~ b', verdict: 'false' }], trace: [{ step: 'Step ~~one~~.', ...receipt({ quote: 'n = ~~x;',
      span: 'const n = ~~x;' }) }] })] });
  const tildesMd = mdOf(tildes);
  assert.ok(tildesMd.includes('*\\~\\~SYNTHETIC looks struck\\~\\~*') && !tildesMd.includes('SYNTHETIC a '), tildesMd);
  assert.ok(tildesMd.includes('*Step \\~\\~one\\~\\~.*') && tildesMd.includes('`n = ~~x;`'), tildesMd);
  // Outside fences and code spans (which GitHub never strikes through), no unescaped `~~`.
  assert.equal((tildesMd.replace(/^(`{3,})\n[\s\S]*?^\1$/gm, '').replace(/`[^`\n]*`/g, '').replace(/\\~/g, '')
    .match(/~~/g) ?? []).length, 0, 'no strike');
});

// Placement: a finding sits beside the first of its rows in the checklist's order (asks first), whatever order the
// review named them in; a row the report does not hold is passed over.
test('agentic code step: the reading order is code\'s — beside the first of its rows in the checklist\'s order', () => {
  const plan = codeSectionPlan(report());
  assert.deepEqual(plan.beside.map((b) => [b.source, b.index, b.findings.length]), [['requirements', 0, 1], ['promises', 0, 0]]);
  assert.deepEqual(plan.rest.map((f) => f.title), ['SYNTHETIC rest finding']);
  assert.deepEqual(Object.keys(plan), ['beside', 'rest', 'questions', 'withheld']);
  assert.equal(plan.questions.length, 2);
  assert.equal(plan.withheld.length, 5);
  const beside = (leadsFrom) => codeSectionPlan(report({ findings: [finding({ leadsFrom })] })).beside
    .filter((b) => b.findings.length).map((b) => [b.source, b.index]);
  assert.deepEqual(beside([CLAIM, ASK]), [['requirements', 0]], 'the claim listed first, the ask second: beside the ask');
  assert.deepEqual(beside([ASK, CLAIM]), [['requirements', 0]]);
  assert.deepEqual(beside([DECISION, CLAIM]), [['promises', 0]]);
  assert.deepEqual(beside([ref('S9', 'ask', 'requirements', 7), DECISION]), [['decisions', 0]], 'a row the report does not hold');
  assert.deepEqual(beside([ref('S9', 'x', 'elsewhere', 0)]), []);
  // The rest, in table-of-contents order: by path, then line.
  const rest = (title, path, line) => finding({ leadsFrom: [], title, anchor: { path, side: 'new', startLine: line, endLine: line } });
  const order = codeSectionPlan(report({ findings: [rest('b', 'b.js', 1), rest('a2', 'a.js', 9), rest('a1', 'a.js', 2)] }));
  assert.deepEqual(order.rest.map((f) => f.title), ['a1', 'a2', 'b']);
});

test('agentic code step: the footer and coverage lines, shared by every reader', () => {
  const r = report();
  // A path too large for the request is named once, there; another path whose change was not shown, with its state.
  // D109: hunks left out for room are said so, never "too large"; a write is counted only outside every folder the code
  // review could read.
  assert.deepEqual(codeFooterLines(r), ['1 file whose change Sonah left out of the code review\'s input for room: big.js',
    '1 file whose change the code review did not see (1 binary): logo.png', '1 call that did not answer: a finding\'s check',
    '2 paths that the session wrote to outside the folders that the code review could read, which Sonah counts but did '
      + 'not review',
    'The repository changed while the code review ran, so a file that it quotes can differ now']);
  const failed = report({ footer: [{ kind: 'failed', part: 'review', count: 1 }, { kind: 'failed', part: 'batch', count: 2 },
    { kind: 'failed', count: 2 }] });
  assert.deepEqual(codeFooterLines(failed), ['5 calls that did not answer: the code review, the check of its questions']);
  assert.deepEqual(codeFooterLines(report({ footer: [{ kind: 'failed', count: 2 }] })), ['2 calls that did not answer']);
  assert.deepEqual(codeFooterLines(report({ footer: [] })), []);
  // Everything covered: no footer group on any reader, and no line saying every file was shown and every call answered.
  const covered = report({ footer: [], coverage: 'complete', files: [{ path: 'src/parse.js', type: 'modified',
    state: 'shown', sha256: SHA, hunks: 1 }] });
  for (const text of [codeSectionOf(renderSessionPage(codeSession(), covered)),
    mdOf(covered)]) {
    assert.ok(!text.includes('What the code review did not cover'), text.slice(0, 200));
    assert.doesNotMatch(text, /Nothing:|every file of the change was shown|every call answered/);
  }
  assert.equal(Object.hasOwn(CODE_REPORT_WORDS, 'footerNone'), false);
  // The session changed no file: every reader says the code review had no change to review, never that every file was
  // shown, and shows no footer group.
  const noChange = report({ findings: [], questionList: [], withheldList: [], footer: [], coverage: 'complete',
    files: [] });
  for (const text of [codeSectionOf(renderSessionPage(codeSession(), noChange)),
    mdOf(noChange)]) {
    assert.ok(text.includes(CODE_REPORT_WORDS.noFile), text.slice(0, 400));
    assert.ok(!text.includes('What the code review did not cover'));
    assert.doesNotMatch(text, /Nothing:|every file of the change was shown/);
  }
  // An earlier report's footer object reads the same way.
  assert.deepEqual(codeFooterLines({ codePass: { footer: { listed_by_name: ['big.js'], clipped: [],
    withheld: [{ path: '.env', state: 'credential_path' }], failed: [{ step: 'lens', lens: 'tests', group: 1 }] } } }),
  ['1 file not shown whole for lack of room: big.js',
    '1 file whose change the code review did not see (1 withheld as credential-shaped): .env',
    '1 call that did not answer: the lens tests (part 1)']);
  const outside = report();
  outside.codePass.base = { ...outside.codePass.base, outside: 3 };
  const line = '3 paths outside the working directory also differ from where the session started, which Sonah did not '
    + 'review or name';
  assert.equal(codeFooterLines(outside).at(-1), line);
  // Coverage: the step did not run because the reviewer is not Claude Code; no working directory; no change.
  assert.deepEqual(codeCoverageLines({ ran: false, gaps: [{ code: 'code_step_backend' }] }),
    [CODE_REPORT_WORDS.notRun.code_step_backend]);
  assert.deepEqual(codeCoverageLines({ ran: false, gaps: [] }), [CODE_REPORT_WORDS.noRoot]);
  assert.deepEqual(codeCoverageLines({ ran: true, files: [], withheld: [] }), [CODE_REPORT_WORDS.noFile]);
  assert.deepEqual(codeCoverageLines({ ran: true, files: [{ path: '../x', state: 'outside_root' }], withheld: [],
    footer: [{ kind: 'outside_root', count: 1 }] }), [CODE_REPORT_WORDS.noFile],
  'a write outside the repository is no change to review');
  // A recorded write outside the working directory that lies in the repository (a sibling folder) is a part of the
  // change the review did not cover: the footer names it, and the coverage line counts it with the change's files.
  const sibling = report({ coverage: 'partial', footer: [{ kind: 'withheld', path: '../lib/other.js' }], files: [
    { path: 'src/parse.js', type: 'modified', state: 'shown', sha256: SHA, hunks: 1 },
    { path: '../lib/other.js', state: 'outside_root' }] });
  assert.deepEqual(codeCoverageLines(sibling.codePass), ['The change covers 2 files, and the code review saw the '
    + 'change of 1. The others: 1 outside the working directory.', CODE_REPORT_WORDS.coverage.partial]);
  assert.deepEqual(codeFooterLines(sibling), ['1 file whose change the code review did not see (1 outside the working '
    + 'directory): ../lib/other.js']);
  const scratch = report({ coverage: 'complete', footer: [{ kind: 'outside_root', count: 1 }], files: [
    { path: 'src/parse.js', type: 'modified', state: 'shown', sha256: SHA, hunks: 1 },
    { path: '/tmp/scratch/out.txt', state: 'outside_root' }] });
  assert.deepEqual(codeCoverageLines(scratch.codePass), ['The change covers 1 file, and the code review saw the change of 1.']);
  assert.deepEqual(codeFooterLines(scratch), ['1 path that the session wrote to outside the folders that the code review '
    + 'could read, which Sonah counts but did not review']);
  for (const [r, line] of [[sibling, 'The change covers 2 files'], [scratch, 'The change covers 1 file,']]) {
    assert.ok(codeSectionOf(renderSessionPage(codeSession(), r)).includes(line), line);
    assert.ok(mdOf(r).includes(line), line);
  }
  // A deleted path's change is shown when its removed lines are (it has hunks); without them it is counted apart.
  assert.ok(['deleted', 'outside_root'].every((state) => CODE_FILE_STATES.includes(state)));
  const deleted = (hunks) => codeCoverageLines({ ran: true, coverage: 'complete', withheld: [], files: [
    { path: 'a.js', type: 'modified', state: 'shown', hunks: 1 }, { path: 'gone.js', type: 'deleted', state: 'deleted', hunks }] });
  assert.deepEqual(deleted(2), ['The change covers 2 files, and the code review saw the change of 2.']);
  assert.deepEqual(deleted(0), ['The change covers 2 files, and the code review saw the change of 1. The '
    + 'others: 1 not there any more.']);
  // An earlier report (no withheld list) listed the files the session read beside the change's: its own words.
  assert.deepEqual(codeCoverageLines({ ran: true, coverage: 'partial', files: [{ path: 'a.js', state: 'shown' },
    { path: 'read.js', state: 'not_shown' }, { path: '.env', state: 'credential_path' }] }),
  ['The code review saw 1 of 3 files that the session changed or read, or that differ from its start. The '
    + 'others: 1 not shown whole for lack of room, 1 withheld as credential-shaped.', CODE_REPORT_WORDS.coverage.partial]);
  const notRun = report();
  notRun.codePass = { ...notRun.codePass, ran: false, coverage: 'missing', gaps: [{ code: 'code_step_backend' }],
    findings: [], held: [], questions: [], withheld: [], files: [] };
  assert.ok(mdOf(notRun).includes(CODE_REPORT_WORDS.notRun.code_step_backend));
  assert.ok(codeSectionOf(renderSessionPage(codeSession(), notRun)).includes(esc(CODE_REPORT_WORDS.notRun.code_step_backend)));
});

test('agentic code step: a file changed after the session\'s last recorded edit, its change shown, is a fact in the footer on every reader; its coverage is not lowered', () => {
  const since = { path: 'src/parse.js', type: 'modified', state: 'changed_since_session', sha256: SHA, hunks: 1 };
  const line = '1 file changed after the session\'s last recorded edit, so Sonah cannot tell whether all of its lines '
    + 'are the agent\'s: src/parse.js';
  // Alone: shown, counted with the change's files shown, and the fact said; nothing else in the footer.
  const alone = report({ coverage: 'complete', footer: [], files: [since] });
  assert.deepEqual(codeCoverageLines(alone.codePass),
    ['The change covers 1 file, and the code review saw the change of 1.']);
  assert.deepEqual(codeFooterLines(alone), [line]);
  const page = codeSectionOf(renderSessionPage(codeSession(), alone));
  const story = mdOf(alone);
  assert.ok(page.includes(esc(line)) && !page.includes('Nothing:'));
  for (const text of [story]) {
    assert.ok(text.includes('changed after the session\'s last recorded edit, so Sonah cannot tell whether all of its '
      + 'lines are the agent'), text);
    assert.ok(!text.includes('Nothing:'));
  }
  // After the files whose change was not shown, and before the calls; two such files are named together.
  const two = report({ coverage: 'partial', footer: [{ kind: 'withheld', path: 'logo.png' },
    { kind: 'failed', part: 'verify', count: 1 }], files: [since, { ...since, path: 'src/util.js' },
    { path: 'logo.png', type: 'added', state: 'binary' }] });
  assert.deepEqual(codeFooterLines(two), ['1 file whose change the code review did not see (1 binary): logo.png',
    '2 files changed after the session\'s last recorded edit, so Sonah cannot tell whether all of their lines are '
      + 'the agent\'s: src/parse.js, src/util.js', '1 call that did not answer: a finding\'s check']);
  assert.deepEqual(codeCoverageLines(two.codePass), ['The change covers 3 files, and the code review saw the '
    + 'change of 2. The others: 1 binary.', CODE_REPORT_WORDS.coverage.partial]);
  // One the footer names as not shown (the session deleted it and it is there again, or a report that withheld such a
  // file): no fact line, counted apart, as before.
  const unshown = report({ coverage: 'partial', footer: [{ kind: 'withheld', path: 'src/parse.js' }],
    files: [{ path: 'src/parse.js', type: 'modified', state: 'changed_since_session', hunks: 0 }] });
  // R16: "changed since the session" was wrong on timing (the agent's own formatter changed the file during the
  // session); the state says the footer's words.
  assert.deepEqual(codeFooterLines(unshown), ['1 file whose change the code review did not see (1 changed after the '
    + 'session\'s last recorded edit): src/parse.js']);
  assert.deepEqual(codeCoverageLines(unshown.codePass), ['The change covers 1 file, and the code review saw the '
    + 'change of 0. The others: 1 changed after the session\'s last recorded edit.', CODE_REPORT_WORDS.coverage.partial]);
  assert.equal(CODE_REPORT_WORDS.states.changed_since_session, 'changed after the session\'s last recorded edit');
  // An earlier report, which kept no list of what its check withheld, never reads a file of that state as shown.
  const earlier = report({ footer: [], files: [{ path: 'src/parse.js', state: 'changed_since_session' }] });
  delete earlier.codePass.withheld;
  assert.deepEqual(codeFooterLines(earlier), []);
});

test('agentic code step: with no finding published, every reader says whether the review proposed none or where the ones it proposed are', () => {
  const W = CODE_REPORT_WORDS;
  const reviewQuestion = questions().filter((q) => q.from === 'review');
  const none = report({ findings: [], withheldList: [], questionList: reviewQuestion });
  const some = report({ findings: [], questionList: reviewQuestion });
  const asked = report({ findings: [], withheldList: [] });
  const both = report({ findings: [] });
  const questionOnly = report({ findings: [], withheldList: withheld().filter((w) => w.what !== 'finding'),
    questionList: reviewQuestion });
  const failed = report({ findings: [], coverage: 'missing' });
  const earlier = report({ findings: [] });
  delete earlier.codePass.withheld;
  earlier.codePass.rejected = [{ reason: 'challenge_unsettled', lens: 'behaviour' }];
  const cases = [[none, W.proposedNone], [some, W.notPublished(4, 0)], [asked, W.notPublished(0, 1)],
    [both, W.notPublished(4, 1)], [questionOnly, W.proposedNone], [failed, W.noFindings], [earlier, W.noFindings]];
  // Sonah withholds a finding by its own checks or by the second reviewer's: the line says Sonah, and names the section
  // every reader lists them under. A finding sent to you as a question is an item of the report, in the section its
  // tier puts it in: the line names no section for it.
  assert.equal(W.notPublished(3, 0), 'The code review published no finding. Sonah withheld 3 of its findings. They are '
    + 'under Proposals of the code review that Sonah withheld, each with the reason.');
  assert.equal(W.notPublished(0, 1), 'The code review published no finding. 1 finding that it proposed is an item of '
    + 'this report, as a question for you.');
  assert.equal(W.notPublished(1, 2), 'The code review published no finding. 2 findings that it proposed are items of '
    + 'this report, as questions for you. Sonah withheld 1 of its findings. It is under Proposals of the code review '
    + 'that Sonah withheld, with the reason.');
  assert.ok(W.notPublished(1, 0).includes(` under ${REPORT_SECTION_WORDS.withheld(1).replace(/ \(1\)$/, '')}, `));
  assert.ok(!W.notPublished(1, 2).includes(W.questionsGroup), 'no reader has a section of that name');
  for (const [r, line] of cases) {
    assert.equal(codeNoFindingLine(r.codePass, codeStepWithheld(r), codeSectionPlan(r).questions), line);
    assert.ok(codeSectionOf(renderSessionPage(codeSession(), r)).includes(esc(line)), line);
    assert.ok(mdOf(r).includes(line), line);
  }
  // With a finding published, none of them.
  for (const line of [W.proposedNone, W.noFindings, W.notPublished(4, 1)])
    assert.ok(!codeSectionOf(renderSessionPage(codeSession(), report())).includes(esc(line)));
  assert.equal(codeStepWithheld(earlier), null, 'an earlier report kept no text of what it withheld');
});

// D88 with the code step: the attention summary counts the code step's published findings, the one beside the row it
// follows from and the one that follows from no row alike, under `codeFindings`, and the rows the code contradicts under
// `codeContradicted`, on every reader, by the same shared reading. An open question and what its check withheld are
// never counted. The section keeps D88's place: after the agent's judgment and the settled
// problems, before What Sonah could not check.
test('D88 with the agentic code step: one counting — published findings only, never a question or what was withheld', () => {
  const r = report();
  const counts = checklistRowCounts(r);
  assert.deepEqual([counts.codeFindings, counts.codeContradicted], [2, 1]);
  const bare = report({ questionList: [], withheldList: [] });
  assert.deepEqual(checklistRowCounts(bare), counts, 'questions and withheld items move no count');
  const none = report({ findings: [] });
  assert.equal(checklistRowCounts(none).codeFindings, 0, 'five withheld items, four of them findings, count nothing');
  const beside = report({ findings: [finding()] });
  const rest = report({ findings: [restFinding()] });
  assert.deepEqual([checklistRowCounts(beside).codeFindings, checklistRowCounts(rest).codeFindings], [1, 1],
    'a finding beside its row and one that follows from no row are each counted');
  // The PR comment's and the CLI's lines, in ATTENTION_ROWS' order, the code step's two lines among them.
  const { lines } = attentionSummary(r);
  const code = [ATTENTION_WORDS.codeContradicted(1), ATTENTION_WORDS.codeFindings(2)];
  for (const line of code) assert.ok(lines.includes(line), line);
  assert.ok(lines.indexOf(code[0]) < lines.indexOf(code[1]));
  assert.deepEqual(attentionSummary(bare).lines, lines);
  // D97: the terminal prints the count line: items, and nothing withheld is one.
  const cli = countLines(reportModel(codeSession(), r)).join('\n');
  assert.equal(cli, countLines(reportModel(codeSession(), report({ withheldList: [] }))).join('\n'));
  assert.doesNotMatch(cli, /withheld/);
  const { summary } = publicCommentText({ ...r, ...honestStatuses(r) });
  const plain = summary.replace(/\\(.)/g, '$1').replace(/&#64;/g, '@');
  for (const line of code) assert.ok(plain.includes(line), line);
  assert.doesNotMatch(plain, /withheld by the check|SYNTHETIC withheld/i);
  // D97: the page counts items, not D88's kinds (report-model.test.js); nothing withheld is an item.
  const page = renderSessionPage(codeSession(), r);
  const model = reportModel(codeSession(), r, {});
  assert.equal(itemsOf(model).filter((item) => item.rows[0].source === 'codePass.findings').length, 2);
  assert.doesNotMatch(page.slice(0, page.indexOf('id="not-checked"')), /SYNTHETIC withheld/);
  assert.doesNotMatch(mdOf(r).slice(0, mdOf(r).indexOf('<details><summary>What Sonah could not check')), /SYNTHETIC withheld/);
});

// R9: "The recording ends here." beside ask 2 of 6 read as if the recording stopped at that ask (s2), though the fact
// says only that the part which reported the row holds the recording's last event. Its words name no place.
test('R9: the end-of-recording fact beside an ask names no place in the recording', () => {
  const words = CHECKLIST_REQUIREMENT_FACT_WORDS.no_deliverable_by_end;
  assert.equal(words, 'The session review found nothing that does this ask before the recording ended.');
  assert.doesNotMatch(words, /\bhere\b|\bends\b/);
});

// An ask the code step contradicts can also carry a fact of code's (here `no_deliverable_by_end`, beside an ask not
// checked, the only requirement fact). Both are shown on the page: the fact first, then the code check, when the code
// contradicts it; a row the code step did not contradict carries no code check (the per-row "not checked in the code"
// note is gone, and an earlier report's "shown in the code" says nothing either). The story says the code check (it
// never said that fact; D97: the report .md says both, as the page does). D88: an ask not checked is listed under What
// Sonah could not check, on the page and in the report .md.
test('agentic code step: an ask with a fact shows the fact, then its code check — and none for a row it did not contradict', () => {
  const pageFact = CHECKLIST_REQUIREMENT_FACT_WORDS.no_deliverable_by_end;
  const asked = (check) => ({ text: 'Return [] for empty input.', instruction: R('I1', 'instruction',
    'SYNTHETIC_CODE_ASK: add a parse function that returns [] for empty input, and do not touch the README.'),
  status: 'not-checked', facts: ['no_deliverable_by_end'], ...(check ? { codeCheck: check } : {}) });
  const only = (check) => ({ ...report(), promises: [], decisions: [], requirements: [asked(check)],
    codePass: { ...report().codePass, findings: [], questions: [], withheld: [] } });
  const askLine = (page) => { const m = /<li(?: id="ask-1")?>ask 1 · [\s\S]*?<\/li>/.exec(page); return m ? m[0] : ''; };
  const contradicts = `${CODE_REPORT_WORDS.outcomes['contradicted-by-code'][0].toUpperCase()}`
    + `${CODE_REPORT_WORDS.outcomes['contradicted-by-code'].slice(1)}.`;
  for (const outcome of ['contradicted-by-code']) {
    const r = only(codeCheck(outcome));
    const item = askLine(renderSessionPage(codeSession(), r));
    const fact = item.indexOf(esc(pageFact));
    const code = item.indexOf(contradicts);
    assert.ok(fact > 0 && code > fact, `${outcome}: the fact, then the code check`);
    assert.equal(item.split(esc(pageFact)).length, 2, `${outcome}: the fact once`);
    // The report .md: the ask's row in your prompt says the fact, then the code check, in the page's words.
    const row = mdOf(r).split('\n').find((l) => l.startsWith('| Not checked | '));
    assert.ok(row && row.indexOf(pageFact) > 0 && row.indexOf(contradicts) > row.indexOf(pageFact), row);
  }
  // An earlier report's "not checked in the code" or "shown in the code" (or no code check at all): no code check on the
  // row.
  for (const check of [{ outcome: 'not-checked-in-code', receipts: [], reason: 'challenge_unsettled' },
    { ...codeCheck('shown-in-code'), by: 'held' }, null]) {
    const r = only(check);
    const item = askLine(renderSessionPage(codeSession(), r));
    assert.ok(item.includes(esc(pageFact)) && !item.includes(contradicts), JSON.stringify(check));
    assert.ok(!mdOf(r).includes(contradicts), JSON.stringify(check));
  }
});

test('agentic code step: one word table — every closed token of the report has its reader words', () => {
  const W = CODE_REPORT_WORDS;
  const covered = (tokens, table, name) => {
    for (const token of tokens) assert.ok(Object.hasOwn(table, token), `${name}: ${token}`);
  };
  covered([...CODE_FINDING_KINDS, 'rule_break', 'claim_false'], W.kinds, 'kinds');
  covered([...CODE_PASS_LENSES, 'rules', 'claims'], W.lenses, 'lenses');
  covered([...CODE_REFUTATION_REASONS, 'not_against_goal'], W.refutations, 'refutations');
  covered(CODE_WITHHELD_REASONS, W.withheldReasons, 'withheld reasons');
  covered(CODE_WITHHELD_ITEMS, W.withheldWhat, 'withheld items');
  covered([...CODE_ITEM_ERRORS, ...CODE_VOID_CAUSES], W.causes, 'causes');
  covered([...CODE_STEP_PARTS, 'review', 'repair', 'verify', 'batch'], W.parts, 'parts');
  // F3b (D111): the accounting's footer kind has its words by scope, one line each.
  covered(CODE_FOOTER_KINDS.filter((kind) => kind !== 'unaccounted'), W.footerKinds, 'footer kinds');
  covered(CODE_ACCOUNT_SCOPE, W.unaccounted, 'unaccounted scopes');
  covered(CODE_FILE_STATES.slice(1), W.states, 'file states');
  // A row's code check has words only when the code contradicts it; nothing says the code shows a row or that a
  // statement holds, and nothing marks a claim found false.
  assert.deepEqual(Object.keys(W.outcomes), ['contradicted-by-code']);
  assert.deepEqual(Object.keys(W.outcomes), CODE_CHECK_OUTCOMES.slice(0, 1));
  assert.ok(!Object.hasOwn(W.outcomes, CODE_CHECK_OUTCOMES[1]), 'no words for a row the step did not settle');
  for (const key of ['heldGroup', 'heldLabel', 'heldCheck', 'claimFalse', 'footerNone'])
    assert.equal(Object.hasOwn(W, key), false, key);
  assert.deepEqual(Object.keys(W.withheldWhat), ['finding', 'question']);
  assert.equal(W.parts.batch, 'the check of its questions');
  // D110: no word says that a second or independent reviewer checked a finding (one model reviews and checks); a
  // report made before the premise contract keeps a check line that claims no second reviewer.
  assert.equal(W.checkHolds, 'It traced the finding and found the same problem.');
  for (const text of [W.how, ...Object.values(W).filter((v) => typeof v === 'string')])
    assert.doesNotMatch(text, /found it holds|found to hold|statement the review/);
  // The members code-report.js names by value, not by index, are members of their lists.
  assert.ok(CODE_WITHHELD_REASONS.includes('verify_refuted') && CODE_FOOTER_KINDS.includes('withheld')
    && ['deleted', 'outside_root', 'changed_since_session'].every((state) => CODE_FILE_STATES.includes(state)));
  assert.deepEqual([CODE_VERIFY_VERDICTS, CODE_CLAIM_VERDICTS, CODE_QUESTION_VERDICTS, CODE_WITHHELD_REASONS,
    CODE_WITHHELD_ITEMS, CODE_ITEM_ERRORS, CODE_VOID_CAUSES], [['holds', 'refuted', 'cannot_tell'], ['holds', 'false'],
    ['sound', 'false_premise'], ['malformed', 'evidence_grounding_failed', 'out_of_scope', 'verify_refuted',
      'verify_cannot_tell', 'verify_unexecuted', 'false_premise', 'request_failed', 'request_too_large'],
    ['finding', 'question'],
    ['key_missing', 'key_outside_contract', 'value_outside_list', 'text_over_limit', 'dossier_key_unknown',
      'ask_key_required', 'claim_key_required', 'quote_ungrounded', 'anchor_off_quote', 'file_not_readable', 'out_of_scope'],
    ['shape', 'receipt_ungrounded', 'support_off_anchor', 'support_off_trace', 'refutation_uncited']]);
  for (const list of [CODE_VERIFY_VERDICTS, CODE_CLAIM_VERDICTS, CODE_QUESTION_VERDICTS, CODE_WITHHELD_REASONS,
    CODE_WITHHELD_ITEMS, CODE_ITEM_ERRORS, CODE_VOID_CAUSES]) assert.ok(Object.isFrozen(list));
  assert.doesNotMatch(W.how, /three independent|checking passes/);
  for (const text of Object.values(W).filter((v) => typeof v === 'string'))
    for (const word of ['severity', 'confidence', 'verified']) assert.doesNotMatch(text, new RegExp(`\\b${word}\\b`, 'i'));
});

// The gap the code step records when its reviewer is not Claude Code has its words; once that gap is in
// the closed list, every gap the coverage line names is one of it.
test('agentic code step: the words for why the step did not run name only closed gaps', { skip: !GAP_CODES
  .includes('code_step_backend') && 'the code step\'s gap code lands with its own build' }, () => {
  for (const code of Object.keys(CODE_REPORT_WORDS.notRun)) assert.ok(GAP_CODES.includes(code), code);
});

// One link in the version chain for the readers of the agentic code step: the page and the story moved once each, one
// number after the release review's, and render back to it. The cleanup is the next link: once each again.
test('agentic code step: the page and the story moved once, one link after the release review\'s, then once by the cleanup', () => {
  // D97: the page moved once more, one link after the cleanup's (REPORT_READER_VERSIONS); the story, now the report .md,
  // once more by its own link (REPORT_MD_READER_VERSIONS).
  // D98: both once more, one link after D97's (ONE_READING_READER_VERSIONS): one effect rule.
  assert.deepEqual([ONE_READING_READER_VERSIONS.page.before, ONE_READING_READER_VERSIONS.story.before],
    [REPORT_READER_VERSIONS.page.after, REPORT_MD_READER_VERSIONS.story.after]);
  // D99: both once more, one link after D98's (ABSENCE_READER_VERSIONS): an absence only where code proves it.
  assert.deepEqual([ABSENCE_READER_VERSIONS.page.before, ABSENCE_READER_VERSIONS.story.before],
    [ONE_READING_READER_VERSIONS.page.after, ONE_READING_READER_VERSIONS.story.after]);
  // D100: both once more, one link after D99's (ABSENCE_AUDIT_READER_VERSIONS): the audit of absence sentences.
  assert.deepEqual([ABSENCE_AUDIT_READER_VERSIONS.page.before, ABSENCE_AUDIT_READER_VERSIONS.story.before],
    [ABSENCE_READER_VERSIONS.page.after, ABSENCE_READER_VERSIONS.story.after]);
  // D101: both once more, one link after D100's (GROUNDING_CAUSE_READER_VERSIONS): an ask says which test refused its
  // quote.
  assert.deepEqual([GROUNDING_CAUSE_READER_VERSIONS.page.before, GROUNDING_CAUSE_READER_VERSIONS.story.before],
    [ABSENCE_AUDIT_READER_VERSIONS.page.after, ABSENCE_AUDIT_READER_VERSIONS.story.after]);
  // D104: both once more by the shown-in-part mark, one link after D101's (SEEN_READER_VERSIONS).
  assert.deepEqual([SEEN_READER_VERSIONS.page.before, SEEN_READER_VERSIONS.story.before],
    [GROUNDING_CAUSE_READER_VERSIONS.page.after, GROUNDING_CAUSE_READER_VERSIONS.story.after]);
  // Bucket B: both once more, one link after D104's, in one move: D105's (ONE_BOUND_READER_VERSIONS), what the code
  // review saw short of whole, and D107's (REPAIR_MERGE_READER_VERSIONS), the repair kept by identity.
  assert.deepEqual(REPAIR_MERGE_READER_VERSIONS, ONE_BOUND_READER_VERSIONS);
  assert.deepEqual([ONE_BOUND_READER_VERSIONS.page.before, ONE_BOUND_READER_VERSIONS.story.before],
    [SEEN_READER_VERSIONS.page.after, SEEN_READER_VERSIONS.story.after]);
  // Bucket C and E1-F8, in the same move (0.3.0-beta.4 moves each reader once): D110's, the premise contract
  // (PREMISE_READER_VERSIONS), D111's, the accounting (ACCOUNT_READER_VERSIONS), and D112's, an item's members and the
  // order by final level (ONE_ITEM_READER_VERSIONS).
  assert.deepEqual(PREMISE_READER_VERSIONS, ONE_BOUND_READER_VERSIONS);
  assert.deepEqual(ACCOUNT_READER_VERSIONS, ONE_BOUND_READER_VERSIONS);
  assert.deepEqual(ONE_ITEM_READER_VERSIONS, ONE_BOUND_READER_VERSIONS);
  assert.deepEqual([PAGE_VERSION, STORY_VERSION], [ONE_BOUND_READER_VERSIONS.page.after,
    ONE_BOUND_READER_VERSIONS.story.after]);
  assert.equal(REPORT_READER_VERSIONS.page.before, CLEANUP_READER_VERSIONS.page.after);
  assert.equal(REPORT_MD_READER_VERSIONS.story.before, CLEANUP_READER_VERSIONS.story.after);
  assert.deepEqual(CLEANUP_READER_VERSIONS, { page: { before: AGENTIC_READER_VERSIONS.page, after: 'sonah.session-page/36' },
    story: { before: AGENTIC_READER_VERSIONS.story, after: 'sonah.session-story/31' } });
  assert.deepEqual(AGENTIC_READER_VERSIONS, { page: 'sonah.session-page/35', story: 'sonah.session-story/30' });
  const back = (version) => version.replace(/\d+$/, (n) => String(Number(n) - 1));
  assert.deepEqual([back(AGENTIC_READER_VERSIONS.page), back(AGENTIC_READER_VERSIONS.story)],
    [RELEASE_REVIEW_READER_VERSIONS.page.after, RELEASE_REVIEW_READER_VERSIONS.story.after]);
});
