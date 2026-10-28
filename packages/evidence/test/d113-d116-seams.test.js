// The seams of 0.3.0-beta.5's join that no lane could test alone: the code step's lane (D113: the change under
// review is the session's own; D114: the person's asks are the session review's listed asks) and the session review's
// lane (D115: a sentence about a row of the session review says no more than that row; D116: a question of the code
// review points only where code checked the tie), each built from the released 0.3.0-beta.4 (7089e662) and joined
// after its review. Each test holds one place where the two lanes meet, and fails if either side stops holding its
// part there:
//   1. D114 x D115/D116: an ask that the session review did not check and whose row cites nothing (D115's row
//      sentence), that the code review ties to by its listed key (D114). The page says what the row cites, beside the
//      code review's finding on the ask and the question that quotes the ask's own words. D152: a second finding on
//      the ask, its check holding, is a finding tied by the ask (before D152, its check routed it to you as a question,
//      which pointed nowhere and stood beside no ask: D116, read on reports saved before D152 by
//      render d115-d116-report-truth.test.js).
//   2. D113 x D116, under D152: a finding about a file named apart as changed outside the session's recorded writes (no
//      part of the change, never given to the code review; its notes name it), its check holding, is a finding tied
//      by the decision it follows from, related to that decision whatever its recorded place; no question comes from
//      it.
//   3. D114 x D115: an ask that an agent wrote into a helper's brief, read by one lineage on both sides: every check of
//      the code step is shown it by its key and whose words it is alone, never its words (D89), while the review is
//      shown its words as the agent's; and the page names it as an ask that an agent wrote into a helper's brief,
//      never as one Sonah could not read or place, and never under your prompt.
//
// Synthetic sessions and files, an in-memory repository reader and deterministic fake agents: no recording, no
// model, no network. Nothing prints.
import test from 'node:test';
import assert from 'node:assert/strict';
import { codeSnapshotPlan, freezeCodeSnapshot, runCodePass, withCodePass } from '../src/code-pass.js';
import { withAskCodeLinks } from '../src/ask-code-links.js';
import { codeChangedOutsideLine } from '../src/code-report.js';
import { CHECKLIST_REQUIREMENT_FACT_WORDS } from '../src/review.js';
import { sessionsOwnChange } from '../../cli/src/code-snapshot.js';
import { buildCodeSession, CODE_FILES, holds, allSound, verifiedFinding, batchItems, accountsHold, reviewFinding,
  dossierItems, askedItems, memoryRepo, PARSE_QUOTE } from '../../cli/test/code-pass-fixture.js';
import { reportModel, reportItems } from '../../render/report-model.js';
import { REPORT_PROMPT_WORDS, REPORT_NOT_CHECKED_WORDS } from '../../render/report-words.js';

const enc = (text) => new TextEncoder().encode(text);
const ROOT = '/work/d113-d116';
const GIT = Object.freeze({ kind: 'git', commit: 'c'.repeat(40), how: 'reflog' });
const BASE_PARSE = CODE_FILES['src/parse.js'].replace('split(",")', 'split(";")');
const PARSE_PATCH = ['diff --git a/src/parse.js b/src/parse.js', 'index 1111111..2222222 100644', '--- a/src/parse.js',
  '+++ b/src/parse.js', '@@ -1,4 +1,4 @@ export function parse(input) {', ' export function parse(input) {',
  '-  const parts = input.split(";");', '+  const parts = input.split(",");', '   return parts.map((part) => part.trim());',
  ' }', ''].join('\n');
const R = (eventId, role, quote) => ({ eventId, role, quote });
const TIERS = ['must_act', 'must_know', 'good_to_know'];
const every = (model) => reportItems(model).flatMap((item) => [item, ...item.members]);
const textOf = (parts) => parts.map((p) => p.text).join('');
const ofRow = (model, source, index) => every(model).find((x) => x.rows.some((r) => r.source === source
  && r.index === index));
const pointers = (item) => item.where.filter((w) => /^(?:item|ask)-\d+$/.test(w.anchor ?? '')).map((w) => w.anchor);
const QUESTION_LINE = /^The code review asks you about this ask\./;

/** The snapshot of the session's recorded writes (src/parse.js, modified from the start commit), with `base`. */
const snapshotOf = (session, base) => {
  const plan = codeSnapshotPlan(session, { root: ROOT });
  return freezeCodeSnapshot(plan, plan.map((entry) => ({ path: entry.path, bytes: enc(CODE_FILES[entry.path]),
    type: 'modified', base: { bytes: enc(BASE_PARSE) }, patch: PARSE_PATCH })), { base });
};
/** One code step over `report`, the review answering `review(prompt)` and each finding's check `verify(finding)`; every
 *  request kept. Returns the report as the review command saves it (the code step and each ask's links joined). */
async function codeStep({ session, report, review, verify = holds, base = GIT, now = CODE_FILES, before = {} }) {
  const seen = [];
  const judge = async (request) => {
    seen.push(request);
    if (request.label === 'code-review:agent') return review(request.prompt);
    if (/^code-verify:F\d+/.test(request.label)) return verify(verifiedFinding(request.prompt));
    if (/^code-verify:batch/.test(request.label)) return allSound(batchItems(request.prompt));
    if (/^code-account:\d+/.test(request.label)) return accountsHold(request.prompt);
    throw new Error(`unexpected ${request.label}`);
  };
  const result = await runCodePass({ report, session, snapshot: snapshotOf(session, base), judge, base, root: ROOT,
    repo: memoryRepo({ root: ROOT, now, before: { 'src/parse.js': BASE_PARSE, ...before } }) });
  return { seen, codePass: result.codePass, saved: withAskCodeLinks(withCodePass(report, result), session) };
}
// D152 (the check judges truth only): no check routes a finding to you as a question any more. A finding whose check
// holds is published as a finding; the place rule of D116 for a question routed from a finding is read on reports saved
// before D152 (render d115-d116-report-truth.test.js builds them).

// ---- 1. D114 x D115/D116: one ask row of the session review, tied to by its listed key ---------------------------

const ASK = 'SYNTHETIC_ASK: split the input on commas. Keep the parser total on empty input.';
const TOTAL = 'Keep the parser total on empty input.';
const keyedSession = () => buildCodeSession('s-d113-d116-1', { ask: ASK, body: CODE_FILES['src/parse.js'],
  wrote: 'File created successfully', note: 'SYNTHETIC_NOTE: parse splits on commas now.',
  final: 'SYNTHETIC_FINAL: done.' }, [
  { id: 'I1', kind: 'instruction', blob: 'ask', turn: 'T1' },
  { id: 'W1', kind: 'invocation', write: 'src/parse.js', blob: 'body', turn: 'T1' },
  { id: 'W1-r', kind: 'observation', invocation: 'W1', blob: 'wrote', turn: 'T1' },
  { id: 'C1', kind: 'commentary', blob: 'note', turn: 'T1' },
  { id: 'C2', kind: 'commentary', blob: 'final', phase: 'final', turn: 'T1' }]);
/** Two asks of your message: the first done by the write; the second not checked, its row citing nothing, its part of
 *  the recording holding the end (the fact D115 words as what the row cites). */
const keyedReport = () => ({ repo: { host: 'github.com', id: '0' }, reviewScope: 'session-only', pr: null,
  codeCoverage: 'missing', coverage: 'complete', sessionReview: 'complete', findings: [], writtenClaims: [],
  failures: [], pivots: [], promises: [], decisions: [],
  requirements: [
    { text: 'Split the input on commas', instruction: R('I1', 'instruction', 'split the input on commas'), status: 'done',
      deliverable: R('W1', 'code', PARSE_QUOTE) },
    { text: TOTAL, instruction: R('I1', 'instruction', TOTAL), status: 'not-checked', facts: ['no_deliverable_by_end'] }],
});
const TOTAL_FINDING = 'SYNTHETIC parse("") returns [""], not the total parse you asked for';
const BLANK_FINDING = 'SYNTHETIC parse(" ") keeps one blank part';
const QUESTION = 'SYNTHETIC should parse("") return [] or throw?';
/** The review: on the second ask, by its listed key, a finding that it is not met, a second finding (before D152, its
 *  check routed it to you as a question), and a question quoting the ask's own words. */
const keyedReview = (prompt) => {
  const total = askedItems(prompt).find((a) => a.asked === TOTAL);
  return { findings: [reviewFinding({ kind: 'ask_not_met', lens: 'ask', title: TOTAL_FINDING, leadsFrom: [total.key] }),
    reviewFinding({ kind: 'missed_case', title: BLANK_FINDING, claims: ['A blank part is kept.'], input: 'parse(" ")',
      leadsFrom: [total.key] })],
  questions: [{ question: QUESTION, key: total.key, quote: TOTAL }] };
};
const keyedVerify = holds;

test('seam D114 x D115/D116: an ask row that cites nothing, tied to by its listed key, says what it cites and names only the question whose place is its own', async () => {
  const session = keyedSession();
  const report = keyedReport();
  const { seen, codePass, saved } = await codeStep({ session, report, review: keyedReview, verify: keyedVerify });
  // D114: the review is shown the ask by its key, in your words, among exactly the session review's asks.
  const listed = askedItems(seen[0].prompt);
  assert.deepEqual(listed.map((a) => a.asked), ['split the input on commas', TOTAL]);
  const totalKey = listed[1].key;
  assert.equal(dossierItems(seen[0].prompt).find((item) => item.key === totalKey).kind, 'ask');
  // Its key is the row: both findings' asks and the question's `concerns` name requirements[1]. D152: the second
  // finding, its check holding, is a finding tied by the row it follows from, never a question.
  const toTotal = (ref) => ref?.kind === 'ask' && ref.source === 'requirements' && ref.index === 1;
  for (const title of [TOTAL_FINDING, BLANK_FINDING])
    assert.ok(codePass.findings.some((f) => f.title === title && f.leadsFrom.some(toTotal)), title);
  const reviewQ = codePass.questions.findIndex((q) => q.from === 'review');
  assert.deepEqual([reviewQ, codePass.questions.filter((q) => q.from === 'finding'), codePass.open], [0, [], []]);
  assert.ok(toTotal(codePass.questions[reviewQ].concerns));
  // The question is linked to the row by the key alone (ask-code-links.js reads only a ref to an ask row).
  assert.deepEqual(saved.requirements[1].codeLinks.filter((l) => l.link === 'question_concerns').map((l) => l.question),
    [reviewQ]);

  const model = reportModel(session, saved, {});
  const ask = model.prompt.asks[1];
  const lines = [...ask.lines, ...ask.folded].map(textOf); // D133 (R2): its open lines and its own fold's
  // D115: the row's own sentence, what it cites and what the session review did not check, beside the code review's.
  assert.ok(lines.includes(CHECKLIST_REQUIREMENT_FACT_WORDS.no_deliverable_by_end), JSON.stringify(lines));
  assert.equal(CHECKLIST_REQUIREMENT_FACT_WORDS.no_deliverable_by_end,
    'The session review did not check whether the agent did this ask: it cited nothing that does it.');
  assert.ok(lines.some((l) => l.startsWith('The code review found a problem here.')), JSON.stringify(lines));
  // D116: the line beside the ask names the question whose place (your words of this ask, one recorded event with the
  // row) is the row's.
  const asked = ofRow(model, 'codePass.questions', reviewQ);
  assert.deepEqual(lines.filter((l) => QUESTION_LINE.test(l)), [REPORT_PROMPT_WORDS.codeQuestion(asked.n)]);
  // Its pointer goes to the ask (no item holds a row that is not checked). D152: the second finding is an item of its
  // kind, at its place in src/parse.js, related to the ask it follows from.
  assert.equal(ofRow(model, 'requirements', 1), undefined);
  assert.deepEqual(pointers(asked), [`ask-${ask.n}`]);
  const blank = ofRow(model, 'codePass.findings', codePass.findings.findIndex((f) => f.title === BLANK_FINDING));
  assert.equal(blank.kind, 'code_bug');
  assert.deepEqual(blank.where.map((w) => w.path), ['src/parse.js']);
  assert.deepEqual(blank.related.asks, [ask.n]);
});

// ---- 2. D113 x D116: a question about a file named apart ---------------------------------------------------------

const NOTES = 'SYNTHETIC_NOTES: split on commas; a blank part is an error.\n';
const NOTES_BEFORE = 'SYNTHETIC_NOTES: split on semicolons.\n';
const apartSession = () => buildCodeSession('s-d113-d116-2', { ask: 'SYNTHETIC_ASK: split the input as the notes say.',
  notes: 'docs/notes.md', body: CODE_FILES['src/parse.js'], wrote: 'File created successfully',
  final: 'SYNTHETIC_FINAL: done.' }, [
  { id: 'I1', kind: 'instruction', blob: 'ask', turn: 'T1' },
  { id: 'R1', kind: 'invocation', read: 'docs/notes.md', blob: 'notes', turn: 'T1' },
  { id: 'W1', kind: 'invocation', write: 'src/parse.js', blob: 'body', turn: 'T1' },
  { id: 'W1-r', kind: 'observation', invocation: 'W1', blob: 'wrote', turn: 'T1' },
  { id: 'C1', kind: 'commentary', blob: 'final', phase: 'final', turn: 'T1' }]);
/** Your ask, done; two decisions nobody asked about: how to split (acted on by the write of src/parse.js) and which
 *  notes to follow (acted on by the read of docs/notes.md). */
const apartReport = () => ({ repo: { host: 'github.com', id: '0' }, reviewScope: 'session-only', pr: null,
  codeCoverage: 'missing', coverage: 'complete', sessionReview: 'complete', findings: [], writtenClaims: [],
  failures: [], pivots: [], promises: [],
  requirements: [{ text: 'Split the input as the notes say', instruction: R('I1', 'instruction',
    'split the input as the notes say'), status: 'done', deliverable: R('W1', 'code', PARSE_QUOTE) }],
  decisions: [
    { id: `sha256:${'2'.repeat(64)}`, dimension: 'How to split the input', chosen: 'Split on commas', actions: ['W1'],
      column: 'unasked', stated: null },
    { id: `sha256:${'3'.repeat(64)}`, dimension: 'Which notes to follow', chosen: 'docs/notes.md', actions: ['R1'],
      column: 'unasked', stated: null }] });
/** The review: a claim_false finding (a kind that may anchor outside the change when a step of its trace quotes a
 *  changed line) anchored in docs/notes.md, following from the decision at `decision` (before D152, its check routed
 *  it to you). */
const apartReview = (decision) => (prompt) => {
  const item = dossierItems(prompt).filter((x) => x.kind === 'decision')[decision];
  return { findings: [reviewFinding({ kind: 'claim_false', lens: 'claims', title: 'SYNTHETIC the notes say a blank part '
    + 'is an error; parse keeps it', claims: ['The notes forbid a blank part.'], input: 'parse(" ")',
  trace: [{ step: 'parse splits on commas.', path: 'src/parse.js', side: 'new', startLine: 2, endLine: 2,
    quote: PARSE_QUOTE }, { step: 'The notes forbid a blank part.', path: 'docs/notes.md', side: 'new', startLine: 1,
    endLine: 1, quote: 'a blank part is an error' }],
  anchor: { path: 'docs/notes.md', side: 'new', startLine: 1, endLine: 1 }, leadsFrom: [item.key] })], questions: [] };
};

test('seam D113 x D116 (D152): a finding about a file named apart as changed outside the session, its check holding, is a finding tied by the row it follows from, never a question', async () => {
  const session = apartSession();
  // D113: git shows two paths differing from the start commit; only src/parse.js was written by a recorded write, and
  // docs/notes.md last changed after the session's recorded window: it is named apart, no part of the change.
  const window = { start: Date.parse('2026-10-18T09:00:00Z'), end: Date.parse('2026-10-18T09:05:00Z') };
  const own = await sessionsOwnChange(codeSnapshotPlan(session, { root: ROOT }), [
    { path: 'docs/notes.md', recordedPath: `${ROOT}/docs/notes.md`, mtimeMs: window.end + 3_600_000 },
    { path: 'src/parse.js', recordedPath: `${ROOT}/src/parse.js`, mtimeMs: null }], { dir: ROOT, window });
  assert.deepEqual([own.plan.map((e) => e.path), own.changedOutside], [['src/parse.js'], ['docs/notes.md']]);
  const base = { ...GIT, changedOutside: own.changedOutside, written: own.plan.length };
  const run = (decision) => codeStep({ session, report: apartReport(), review: apartReview(decision),
    verify: holds, base, now: { ...CODE_FILES, 'docs/notes.md': NOTES },
    before: { 'docs/notes.md': NOTES_BEFORE } });

  for (const [decision, names] of [[1, true], [0, false]]) {
    const { seen, codePass, saved } = await run(decision);
    const at = `the question follows from decisions[${decision}]`;
    // D113: the review was given the session's own change, never the file named apart; the record names it apart.
    assert.ok(!seen[0].prompt.includes('SYNTHETIC_NOTES'), at);
    assert.deepEqual(codePass.files.map((f) => f.path), ['src/parse.js'], at);
    assert.deepEqual(codePass.base.changedOutside, ['docs/notes.md'], at);
    // D152: the finding is published, tied by the decision it follows from, its anchor a line of the file named apart;
    // no question comes from it.
    assert.deepEqual(codePass.questions, [], at);
    assert.equal(codePass.findings.length, 1, `${at}: ${JSON.stringify(codePass.withheld)}`);
    const [finding] = codePass.findings;
    assert.deepEqual([finding.leadsFrom.map((r) => [r.source, r.index]), finding.anchor.path],
      [[['decisions', decision]], 'docs/notes.md'], at);

    const model = reportModel(session, saved, {});
    // The code review's notes name the file apart (D113), as What Sonah could not check.
    const outside = codeChangedOutsideLine(codePass);
    assert.ok(outside && outside.includes('docs/notes.md'), at);
    assert.ok(model.notChecked.code.some((parts) => textOf(parts).includes('docs/notes.md')), at);
    // A finding names its anchor as its place, and the row it follows from among its related items, whatever that
    // row's recorded place: the place rule of D116 is a question's.
    const item = ofRow(model, 'codePass.findings', 0);
    const target = ofRow(model, 'decisions', decision);
    assert.ok(target && item && !item.memberOf, `${at} (${names ? 'its place names the file' : 'its place does not'})`);
    assert.equal(item.kind, 'code_claim_false', at);
    assert.deepEqual(item.where.map((w) => w.path), ['docs/notes.md'], at);
    assert.deepEqual(item.related.items, [target.n], at);
  }
});

// ---- 3. D114 x D115: an ask that an agent wrote into a helper's brief ------------------------------------------

const BRIEF = 'SYNTHETIC_BRIEF: never print the input you parse.';
const briefSession = () => buildCodeSession('s-d113-d116-3', { ask: 'SYNTHETIC_ASK: split the input on commas.',
  delegate: BRIEF, brief: BRIEF, body: CODE_FILES['src/parse.js'], wrote: 'File created successfully',
  childDone: 'SYNTHETIC_CHILD: done.', final: 'SYNTHETIC_FINAL: done.' }, [
  { id: 'I1', kind: 'instruction', blob: 'ask', turn: 'T1' },
  { id: 'child:c1:H1', kind: 'instruction', authority: 'agent', childId: 'c1', blob: 'brief', turn: 'T1' },
  { id: 'W1', kind: 'invocation', write: 'src/parse.js', blob: 'body', turn: 'T1' },
  { id: 'W1-r', kind: 'observation', invocation: 'W1', blob: 'wrote', turn: 'T1' },
  { id: 'C1', kind: 'commentary', blob: 'final', phase: 'final', turn: 'T1' }]);
const briefReport = () => ({ repo: { host: 'github.com', id: '0' }, reviewScope: 'session-only', pr: null,
  codeCoverage: 'missing', coverage: 'complete', sessionReview: 'complete', findings: [], writtenClaims: [],
  failures: [], pivots: [], promises: [], decisions: [],
  requirements: [
    { text: 'Split the input on commas', instruction: R('I1', 'instruction', 'split the input on commas'), status: 'done',
      deliverable: R('W1', 'code', PARSE_QUOTE) },
    { text: 'Never print the input', instruction: R('child:c1:H1', 'instruction', BRIEF), status: 'not-checked' }] });

test('seam D114 x D115: an ask an agent wrote into a helper\'s brief is shown to every check by its key and actor alone, and named on the page as a brief', async () => {
  const session = briefSession();
  const report = briefReport();
  const { seen, saved } = await codeStep({ session, report, review: (prompt) => {
    const brief = askedItems(prompt).find((a) => typeof a.asked !== 'string');
    return { findings: [reviewFinding()], questions: [{ question: 'SYNTHETIC may a helper print the input?',
      key: brief.key, quote: BRIEF.slice(0, 60) }] };
  } });
  assert.deepEqual(seen.map((r) => r.label), ['code-review:agent', 'code-verify:F1', 'code-verify:batch',
    'code-account:1']);
  // D114: the review is shown the brief's words as the agent's; a finding's and the questions' checks its key and actor
  // alone (D89); the accounting, which accounts for it, its words as the agent's.
  for (const request of seen) {
    const shown = askedItems(request.prompt);
    assert.equal(shown.length, 2, request.label);
    const brief = shown[1];
    if (/^code-verify:/.test(request.label)) {
      assert.deepEqual(Object.keys(brief).sort(), ['actor', 'key'], request.label);
      assert.equal(brief.actor, 'agent', request.label);
      assert.ok(!request.prompt.includes('SYNTHETIC_BRIEF'), request.label);
    } else assert.deepEqual(brief.asked, { actor: 'agent', quote: BRIEF }, request.label);
  }
  // D115: the page, by the same lineage, names it as a brief an agent wrote for a helper: not under your prompt, never
  // as one Sonah could not read, never as one it could not place.
  const model = reportModel(session, saved, {});
  assert.deepEqual(model.prompt.asks.map((a) => textOf(a.words)), ['split the input on commas']);
  assert.deepEqual(model.notChecked.unreadAsks, [REPORT_NOT_CHECKED_WORDS.briefAsks(1, '')]);
});
