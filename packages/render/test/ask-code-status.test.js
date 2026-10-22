// An ask's status never contradicts Sonah's own findings (D87 and D88, amended). The status pill stays the session
// review's; what the code step tied to the ask (its `codeLinks`, ask-code-links.js) is shown with it in fixed words
// chosen by structure, linked to the finding, and an ask read done or not checked that a finding bears on is counted on
// every reader (review.js `asksCodeFinding`), never folded as fully addressed or as not checked. A not-checked ask the
// code check shows in the code is listed under What you asked, neither counted nor folded. Synthetic session and report:
// no recording, no model, no network.
import test from 'node:test';
import assert from 'node:assert/strict';
import { renderSessionPage } from '../session-page.js';
import { reportModel } from '../report-model.js';
import { REPORT_PROMPT_WORDS } from '../report-words.js';
import { renderReportMarkdown } from '../session-story.js';
import { ATTENTION_ROWS, ATTENTION_WORDS, ASK_CODE_WORDS, askRowKind, askCodeNotes, attentionSummary, checklistRowCounts,
  escapeSource } from '../../evidence/src/review.js';
import { honestStatuses, REQUIREMENT_STATUSES } from '../../evidence/src/ledger.js';
import { withAskCodeLinks } from '../../evidence/src/ask-code-links.js';
import { withheldWhy } from '../../evidence/src/code-report.js';
import { countLines } from '../../cli/src/report-output.js';
import { publicCommentText } from '../../github/index.js';
import { buildCodeSession } from '../../cli/test/code-pass-fixture.js';

const A1 = 'make parse return [] for empty input';
const A2 = 'keep the README as it is';
const A3 = 'add a test that fails before the fix';
const A4 = 'run the tests';
const A5 = 'write the changelog line';
const TEXT = { i1: `SYNTHETIC_ASK_ONE: ${A1}. SYNTHETIC_ASK_TWO: ${A2}.`,
  i2: `SYNTHETIC_ASK_THREE: ${A3}. SYNTHETIC_ASK_FOUR: ${A4}.`, i3: `SYNTHETIC_ASK_FIVE: ${A5}.`,
  said: 'SYNTHETIC: done, the tests pass.' };
const session = () => buildCodeSession('sess-ask-status', TEXT, [
  { id: 'I1', kind: 'instruction', blob: 'i1', turn: 'T1' }, { id: 'C1', kind: 'commentary', blob: 'said', turn: 'T1' },
  { id: 'I2', kind: 'instruction', blob: 'i2', turn: 'T2' }, { id: 'C2', kind: 'commentary', blob: 'said', turn: 'T2' },
  { id: 'I3', kind: 'instruction', blob: 'i3', turn: 'T3' }, { id: 'C3', kind: 'commentary', blob: 'said', turn: 'T3' },
]);
const R = (eventId, role, quote) => ({ eventId, role, quote });
const SHA = 'a'.repeat(64);
const id = (c) => `sha256:${c.repeat(64)}`;
const receipt = { eventId: 'file:0123456789abcdef', role: 'code', side: 'new', quote: 'return input.split(",");',
  path: 'src/parse.js', startLine: 2, endLine: 2, sha256: SHA, span: '  return input.split(",");' };
const NOT_MET = 'SYNTHETIC parse("") still returns [""]';
const WEAK = 'SYNTHETIC the new test passes on the old code too';
const ask = (text, instruction, status, over = {}) => ({ text, instruction: R(instruction, 'instruction', over.quote ?? text),
  status, deliverable: status === 'done' ? R(`C${instruction.slice(1)}`, 'commentary', TEXT.said) : null, shortfall: null,
  restsOn: [], reason: null, facts: [], ...over });

/** Three requests. Request 1: two asks read done, the first a finding of kind ask_not_met follows from. Request 2: an
 *  ask not checked whose words a finding's trace quotes, and one not checked that an earlier code step marked shown in
 *  the code (a code check no reader shows any more, and no link). Request 3: an ask read done that an open question of
 *  the code review concerns (a line, never counted). */
function joined({ notMetLeads = [{ key: 'S1', kind: 'ask', source: 'requirements', index: 0, id: null }] } = {}) {
  const report = {
    repo: { host: 'github.com', id: '0' }, reviewScope: 'session-only', pr: null, codeCoverage: 'missing',
    coverage: 'complete', sessionReview: 'complete', findings: [], failures: [], writtenClaims: [], pivots: [],
    promises: [], decisions: [],
    requirements: [ask('Return [] for empty input.', 'I1', 'done', { quote: A1 }), ask('Keep the README.', 'I1', 'done', { quote: A2 }),
      ask('A failing test first.', 'I2', 'not-checked', { quote: A3 }),
      ask('Run the tests.', 'I2', 'not-checked', { quote: A4, codeCheck: { outcome: 'shown-in-code', receipts: [receipt],
        reason: null } }),
      ask('A changelog line.', 'I3', 'done', { quote: A5 })],
    codePass: { ran: true, coverage: 'complete', base: { kind: 'git', commit: 'b'.repeat(40) },
      files: [{ path: 'src/parse.js', state: 'shown', sha256: SHA, bytes: 40, lines: 3 }],
      findings: [
        { id: id('1'), origin: 'code-review', status: 'DECIDE', scope: 'current-code', kind: 'ask_not_met', lens: 'ask',
          title: NOT_MET, explanation: 'SYNTHETIC.', input: 'parse("")', trace: [{ step: 'It splits.', source: 'file',
            ...receipt }], anchor: { path: 'src/parse.js', side: 'new', startLine: 2, endLine: 2 }, receipts: [receipt],
          leadsFrom: notMetLeads, foundByLenses: ['ask'] },
        { id: id('2'), origin: 'code-review', status: 'DECIDE', scope: 'current-code', kind: 'weak_test', lens: 'tests',
          title: WEAK, explanation: 'SYNTHETIC.', input: 'the old code', trace: [{ step: 'You asked for it.',
            source: 'session', eventId: 'I2', role: 'instruction', quote: 'a test that fails before the fix' },
          { step: 'It passes anyway.', source: 'file', ...receipt }],
          anchor: { path: 'src/parse.js', side: 'new', startLine: 2, endLine: 2 }, receipts: [receipt], leadsFrom: [],
          foundByLenses: ['tests'] }],
      questions: [{ question: 'SYNTHETIC should the changelog name the issue?', lens: 'ask',
        concerns: { key: 'S5', kind: 'ask', source: 'requirements', index: 4, id: null }, quote: R('I3', 'instruction', A5) }],
      rejected: [], footer: {} },
  };
  return withAskCodeLinks(report, session());
}
/** The same report as an earlier build joined it: no links. */
const unlinked = (r) => ({ ...r, requirements: r.requirements.map(({ codeLinks: _links, ...row }) => row) });
const pageOf = (r) => renderSessionPage(session(), r);
const modelOf = (r) => reportModel(session(), r, {});
/** The page's line for ask `n` under your prompt, as text. */
const askLineOf = (page, n) => { const m = new RegExp(`<li(?: id="ask-${n}")?>ask ${n} · [\\s\\S]*?</li>`).exec(page);
  return m ? m[0].replace(/<[^>]+>/g, '').replace(/&quot;/g, '"') : ''; };
const itemNumberOf = (model, title) => [...model.tiers.must_act, ...model.tiers.must_know, ...model.tiers.good_to_know]
  .find((item) => item.what.parts.some((p) => p.text === title))?.n ?? null;
const plainComment = (text) => text.replace(/\\(.)/g, '$1').replace(/&#64;/g, '@');

test('every ask kind by its status and its links: done or not checked with a counting link is asksCodeFinding', () => {
  const r = joined();
  assert.deepEqual(r.requirements.map(askRowKind), ['asksCodeFinding', null, 'asksCodeFinding', 'asksNotChecked', null]);
  assert.deepEqual(unlinked(r).requirements.map(askRowKind), [null, null, 'asksNotChecked', 'asksNotChecked', null]);
  // By status, for each counting link: done (a legacy addressed) and not checked move; not done and partly done keep
  // their kind and get the line; a line-only link never moves a kind.
  for (const link of ['leads_from', 'trace_quotes_ask', 'contradicted_by_code']) {
    const kinds = [...REQUIREMENT_STATUSES, 'addressed'].map((status) => askRowKind({ status, codeLinks: [{ link }] }));
    assert.deepEqual(kinds, ['asksCodeFinding', 'asksNotDone', 'asksNotDone', 'asksCodeFinding', 'asksCodeFinding'], link);
  }
  for (const link of ['withheld_finding', 'question_concerns']) {
    assert.deepEqual(REQUIREMENT_STATUSES.map((status) => askRowKind({ status, codeLinks: [{ link }] })),
      [null, 'asksNotDone', 'asksNotDone', 'asksNotChecked'], link);
  }
  // An earlier report's `shown_in_code` is no link any more: every ask keeps the kind its status gives it, a not-checked
  // one folded.
  assert.deepEqual(REQUIREMENT_STATUSES.map((status) => askRowKind({ status, codeLinks: [{ link: 'shown_in_code' }] })),
    [null, 'asksNotDone', 'asksNotDone', 'asksNotChecked']);
  for (const links of [undefined, 'x', [null, { link: 'made_up' }, 5]])
    assert.equal(askRowKind({ status: 'done', codeLinks: links }), null, JSON.stringify(links));
  // (D97: the story's "fully addressed" cell and its `metAsk` are gone with the story; the count line's split counts an
  // ask met with a code finding apart, below.)
});

test('one counting on every reader: the CLI, the PR comment and the report model count the asks a finding bears on', () => {
  const r = joined();
  const counts = checklistRowCounts(r);
  assert.deepEqual([counts.asksCodeFinding, counts.asksNotChecked, counts.codeFindings], [2, 1, 2]);
  assert.deepEqual([checklistRowCounts(unlinked(r)).asksCodeFinding, checklistRowCounts(unlinked(r)).asksNotChecked], [0, 2]);
  const { lines, folded } = attentionSummary(r);
  assert.deepEqual(lines, [ATTENTION_WORDS.asksCodeFinding(2), ATTENTION_WORDS.codeFindings(2)]);
  assert.equal(folded, ATTENTION_WORDS.folded(1), 'the ask an earlier code step marked shown in the code is folded');
  assert.equal(ATTENTION_WORDS.asksCodeFinding(2), '2 asks that a finding of the code review concerns: see What you asked.');
  assert.ok(ATTENTION_ROWS.indexOf('asksCodeFinding') === ATTENTION_ROWS.indexOf('asksNotDone') + 1);
  // D97: the terminal prints the report model's count line, with the same split (D93).
  const [cli] = countLines(modelOf(r));
  assert.ok(cli.endsWith('Your prompt: 2 done, 1 done with a code finding, 1 not checked, 1 not checked with a code finding'),
    cli);
  const { summary } = publicCommentText({ ...r, ...honestStatuses(r) });
  assert.ok(plainComment(summary).includes(ATTENTION_WORDS.asksCodeFinding(2)));
  // The report model (D97): the count line counts an ask read done or not checked that a finding bears on apart (D93).
  assert.deepEqual(modelOf(r).prompt.parts, ['2 done', '1 done with a code finding', '1 not checked',
    '1 not checked with a code finding']);
  assert.deepEqual(modelOf(unlinked(r)).prompt.parts, ['3 done', '2 not checked']);
});

test('the page: a done ask a finding bears on keeps its status word, and its line says so, linked to the finding\'s item', () => {
  const r = joined();
  const page = pageOf(r);
  const model = modelOf(r);
  const notMet = itemNumberOf(model, NOT_MET), weak = itemNumberOf(model, WEAK);
  const question = itemNumberOf(model, 'SYNTHETIC should the changelog name the issue?');
  assert.ok(notMet && weak && question);
  // The ask keeps the session review's status; its line says what the code review found, linked to the item.
  // D100: the words of an ask that rests only on the agent's words name what the session review cited (an apostrophe,
  // escaped on the page).
  const agentOnly = REPORT_PROMPT_WORDS.agentOnly.replaceAll("'", '&#39;');
  // D133 (R2): what the session review cited is in the row's own fold, after its open lines.
  assert.equal(askLineOf(page, 1), `ask 1 · Done · ${REPORT_PROMPT_WORDS.codeFinding(notMet)} · Evidence${agentOnly}`);
  assert.match(page, new RegExp(`<mark class="ask s-doneCode" id="ask-1"><span class="tag">Done</span>`));
  // A not-checked ask whose words a finding's trace quotes: its status as it was, and the line.
  assert.ok(askLineOf(page, 3).startsWith('ask 3 · Not checked · '));
  assert.ok(askLineOf(page, 3).endsWith(REPORT_PROMPT_WORDS.codeFinding(weak)));
  // The question about request 3's ask: a line, linked to the question's item, never a count.
  assert.equal(askLineOf(page, 5), `ask 5 · Done · ${REPORT_PROMPT_WORDS.codeQuestion(question)} · Evidence${agentOnly}`);
  // Without the links (an earlier build's report) no ask has such a line.
  const before = pageOf(unlinked(joined()));
  assert.equal(before.includes(REPORT_PROMPT_WORDS.codeFinding(notMet)), false);
  assert.doesNotMatch(before, /class="ask s-(?:doneCode|notCheckedCode)"/);
});

test('a not-checked ask an earlier code step marked shown in the code is folded, and no reader says the code shows it', () => {
  const page = pageOf(joined());
  // D97: every ask is in your prompt, by its status; the one an earlier code step marked shown in the code is not checked.
  assert.match(page, /<mark class="ask s-notChecked" id="ask-4"><span class="tag">Not checked<\/span>/);
  assert.doesNotMatch(page, /the code at review time shows it|shown in (?:the )?code/i);
  // The report .md places it the same way, and says nothing of the code showing it.
  const story = renderReportMarkdown(session(), joined());
  assert.ok(story.includes(`\n| Not checked | “${escapeSource(A4)}” |`), story);
  assert.doesNotMatch(story, /shown in (?:the )?code|the code at review time shows it/i);
});

test('the report .md: the line beside the ask; its status stays the session review\'s', () => {
  // D97: the prompt table keeps the session review's status and says what the code review found, by the item's number.
  const story = renderReportMarkdown(session(), joined());
  const model = modelOf(joined());
  // D133 (R2): what the session review cited is in the row's own fold, after the line.
  assert.ok(story.includes(`\n| Done | “${escapeSource(A1)}” | ${REPORT_PROMPT_WORDS.codeFinding(itemNumberOf(model, NOT_MET))} `
    + `<details><summary>Evidence</summary>${REPORT_PROMPT_WORDS.agentOnly}</details> |`), story);
  assert.ok(story.includes(`\n| Not checked | “${escapeSource(A3)}” |`));
  assert.ok(story.includes(REPORT_PROMPT_WORDS.codeFinding(itemNumberOf(model, WEAK))));
});

test('the words are chosen by structure: an ask_not_met names the ask only through leadsFrom; anything else bears on it', () => {
  // The same finding, tied to the ask only by a trace step quoting its words: "bears on it", never "not met".
  const r = joined({ notMetLeads: [] });
  const withTrace = { ...r, codePass: { ...r.codePass, findings: [{ ...r.codePass.findings[0], trace: [{ step: 'Asked.',
    source: 'session', eventId: 'I1', role: 'instruction', quote: A1 }, ...r.codePass.findings[0].trace] },
  r.codePass.findings[1]] } };
  const linked = withAskCodeLinks(unlinked(withTrace), session());
  assert.deepEqual(linked.requirements[0].codeLinks, [{ link: 'trace_quotes_ask', finding: id('1') }]);
  assert.deepEqual(askCodeNotes(linked, linked.requirements[0]).map((n) => n.words),
    ['The session review marked it done, and a finding of the code review concerns it']);
  // One line per finding, however many links tie it; the status words follow the status token.
  const both = { ...joined(), requirements: joined().requirements.map((row, i) => (i === 0 ? { ...row, codeLinks:
    [{ link: 'leads_from', finding: id('1') }, { link: 'trace_quotes_ask', finding: id('1') }] } : row)) };
  assert.equal(askCodeNotes(both, both.requirements[0]).length, 1);
  for (const [status, words] of [['partly-done', 'The session review marked it partly done'], ['not-done',
    'The session review marked it not done'], ['not-checked', 'The session review did not check it']])
    assert.equal(askCodeNotes(both, { ...both.requirements[0], status })[0].words.split(', and ')[0], words);
  // A link to an item the report does not hold, a code check with no finding: no line (the code check says it).
  assert.deepEqual(askCodeNotes(both, { status: 'done', codeLinks: [{ link: 'leads_from', finding: id('9') },
    { link: 'contradicted_by_code' }, { link: 'shown_in_code' }, { link: 'question_concerns', question: 7 }] }), []);
  // The code step's withheld findings, when it keeps them: their own words, after the fixed words; a withheld finding's
  // line says why, in the code step's closed reason words (code-report.js `withheldWhy`), as What the code review found
  // does. An earlier report's statement found to hold, and its link, give no line.
  const later = { codePass: { findings: [], held: [{ statement: 'SYNTHETIC it holds' }],
    withheld: [{ what: 'finding', reason: 'verify_refuted', text: 'SYNTHETIC withheld',
      check: { verdict: 'refuted', reason: 'incorrect' } }, { what: 'finding' },
    { what: 'finding', reason: 'malformed', cause: 'text_over_limit', text: 'SYNTHETIC over' }] } };
  assert.deepEqual(askCodeNotes(later, { status: 'done', codeLinks: [{ link: 'shown_in_code', held: 0 },
    { link: 'withheld_finding', withheld: 0 }, { link: 'withheld_finding', withheld: 1 },
    { link: 'withheld_finding', withheld: 2 }] })
    .map(({ words, subject }) => [words, subject]), [
    [`${ASK_CODE_WORDS.withheld} (${withheldWhy(later.codePass.withheld[0])})`, 'SYNTHETIC withheld'],
    [ASK_CODE_WORDS.withheld, null],
    [`${ASK_CODE_WORDS.withheld} (${withheldWhy(later.codePass.withheld[2])})`, 'SYNTHETIC over']]);
  assert.equal(withheldWhy(later.codePass.withheld[0]), 'its check refuted it: it misreads the code');
  assert.equal(withheldWhy(later.codePass.withheld[2]),
    'it broke the answer\'s contract, even after one repair (a text or a list is over its length limit)');
  for (const key of [...REQUIREMENT_STATUSES, 'addressed', 'partly-addressed', 'open'])
    assert.equal(typeof ASK_CODE_WORDS.status[key], 'string', key);
  assert.equal(Object.hasOwn(ASK_CODE_WORDS, 'held'), false, 'no words say the code review found a statement holds');
  assert.ok(Object.isFrozen(ASK_CODE_WORDS) && Object.isFrozen(ASK_CODE_WORDS.status));
});

test('a report whose code findings link no ask renders as before: the join adds no byte to the page or the report .md', () => {
  const r = unlinked(joined());
  const none = { ...r, requirements: r.requirements.map((row) => { const { codeCheck: _c, ...rest } = row; return rest; }),
    codePass: { ...r.codePass, findings: r.codePass.findings.map((f) => ({ ...f, leadsFrom: [], trace: f.trace.filter((t) =>
      t.source !== 'session') })), questions: [] } };
  const again = withAskCodeLinks(none, session());
  assert.ok(again.requirements.every((row, i) => row === none.requirements[i]));
  assert.equal(pageOf(again), pageOf(none));
  assert.equal(renderReportMarkdown(session(), again), renderReportMarkdown(session(), none));
});

test('a not-checked ask only a question concerns is not counted apart, and gets its line, on the page and in the report .md', () => {
  const r = unlinked(joined());
  const asked = withAskCodeLinks({ ...r, requirements: r.requirements.map((row) => { const { codeCheck: _c, ...rest } = row;
    return rest; }), codePass: { ...r.codePass, findings: [], questions: [{ ...r.codePass.questions[0],
    concerns: { key: 'S3', kind: 'ask', source: 'requirements', index: 2, id: null }, quote: R('I2', 'instruction', A3) }] } },
  session());
  assert.deepEqual(asked.requirements[2].codeLinks, [{ link: 'question_concerns', question: 0 }]);
  assert.equal(askRowKind(asked.requirements[2]), 'asksNotChecked');
  const line = `${ASK_CODE_WORDS.question}: SYNTHETIC should the changelog name the issue?`;
  assert.ok(line);
  const story = renderReportMarkdown(session(), asked);
  const page = pageOf(asked);
  const model = modelOf(asked);
  assert.ok(story.includes(`\n| Not checked | “${escapeSource(A3)}” |`) && story.includes(REPORT_PROMPT_WORDS
    .codeQuestion(itemNumberOf(model, 'SYNTHETIC should the changelog name the issue?'))), story);
  assert.deepEqual(model.prompt.parts, ['3 done', '2 not checked'], 'a question gives a line, never a count');
  assert.ok(askLineOf(page, 3).endsWith(REPORT_PROMPT_WORDS.codeQuestion(itemNumberOf(model,
    'SYNTHETIC should the changelog name the issue?'))));
});
