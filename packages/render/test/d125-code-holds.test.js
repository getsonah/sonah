// D125 (2026-10-20; the owner: "Let's fix 1st, 2nd and 3rd are okay for now", the first of the observations of the
// paid end-to-end run of --code-repo on the smoke's S1), amended the same day (the owner: "go for option 3"): an ask
// that the session review left not checked and that the code review checked in the code says so on its row. S1's
// shape: a script changed the files, so the session review never saw them and left three asks not checked (it cited a
// place that its window was not shown), while the code review's item-by-item check (D111) recorded each of them
// `holds`, with receipts that Sonah found word for word. Before, the row said "Not checked" and nothing of that
// verdict. D125 gave such an ask its own status, "Holds in the code"; its review found that no check of Sonah's tests
// a `holds` verdict (on stored long sessions 5 of 12 such verdicts were doubtful, 2 misleading), and the owner chose
// option 3: the status stays "Not checked" and every count is as before (the header, the footer, the count line, the
// heading, the terminal and the PR comment count these asks as not checked), and the row gains one note after the
// session review's reason: the code review's verdict, where Sonah found its quotes, and that Sonah did not check it.
// One definition (review.js `askCodeHoldsNote`, on code-pass.js `askCodeHolds`) serves the page and the report .md.
// Without such a verdict nothing changes: a `holds` entry renders as any other examined outcome (D111 I9) on every
// other ask. D125's review: no note over a not-checked reason that is a check of Sonah's that speaks against the ask
// or did not settle it (ledger.js ASK_CODE_HOLDS_REASONS, and no reason), and none whose quotes are of the start commit.
//
// Synthetic session and report: no recording, no model, no network.
import test from 'node:test';
import assert from 'node:assert/strict';
import { renderSessionPage } from '../session-page.js';
import { reportModel } from '../report-model.js';
import { REPORT_PROMPT_WORDS, REPORT_NOT_CHECKED_WORDS, REPORT_HEADER_WORDS } from '../report-words.js';
import { renderReportMarkdown } from '../session-story.js';
import { ATTENTION_WORDS, askRowKind, askCodeHoldsNote, attentionSummary, checklistRowCounts, escapeSource }
  from '../../evidence/src/review.js';
import { honestStatuses, REQUIREMENT_UNCHECKED_REASONS, ASK_CODE_HOLDS_REASONS } from '../../evidence/src/ledger.js';
import { askCodeHolds } from '../../evidence/src/code-pass.js';
import { withAskCodeLinks } from '../../evidence/src/ask-code-links.js';
import { countLines } from '../../cli/src/report-output.js';
import { publicCommentText } from '../../github/index.js';
import { buildCodeSession } from '../../cli/test/code-pass-fixture.js';

const ASKS = ['formatCents groups thousands with commas', 'add removeItem to src/cart.js', 'add tests for both changes',
  'mention removeItem in the README', 'make the edits with a short script', 'run the project tests',
  'tell me what changed'];
const TEXT = { i1: `SYNTHETIC: ${ASKS.join('. ')}.`, said: 'SYNTHETIC: done, the tests pass.' };
const session = () => buildCodeSession('sess-d125', TEXT, [
  { id: 'I1', kind: 'instruction', blob: 'i1', turn: 'T1' }, { id: 'C1', kind: 'commentary', blob: 'said', turn: 'T1' }]);
const R = (eventId, role, quote) => ({ eventId, role, quote });
const SHA = 'c'.repeat(64);
const REPO = '/synthetic/app';
const receipt = (path, line, quote) => ({ eventId: `file:${path.length.toString(16).padStart(16, '0')}`, role: 'code',
  side: 'new', quote, path: `${REPO}/${path}`, startLine: line, endLine: line, sha256: SHA, span: `  ${quote}` });
const MONEY = receipt('src/money.js', 5, 'const grouped = String(dollars).replace(');
const CART = receipt('src/cart.js', 22, 'if (index !== -1) cart.splice(index, 1);');
const TESTS = receipt('test/cart.test.js', 26, "test('formatCents groups thousands with commas', () => {");
const README = receipt('README.md', 7, '`removeItem(cart, sku)` removes the line with that sku');
/** The session review's row of ask `i`: done (citing the agent's words), or not checked by `reason`. */
const row = (i, status, reason = null) => ({ text: `SYNTHETIC ${ASKS[i]}`, instruction: R('I1', 'instruction', ASKS[i]),
  status, deliverable: status === 'done' ? R('C1', 'commentary', TEXT.said) : null, shortfall: null, restsOn: [], reason,
  facts: [] });
/** The item-by-item check's entry of ask `i`: `holds` with its receipts, or another fate. */
const entry = (i, fate, receipts = [], more = {}) => ({ key: `S${i + 1}`, scope: 'ask',
  ref: { source: 'requirements', index: i, id: null }, fate, ...(receipts.length ? { receipts } : {}), ...more });

/** S1 as the paid run gap2-2 recorded it, by structure: asks 1, 2 and 4 not checked (`deliverable_ungrounded`) and
 *  held in the code; ask 3 done and held; ask 5 not checked (`challenge_unsettled`) and outside; asks 6 and 7 done and
 *  outside. `fates` replaces an entry's fate by its ask's index. */
function s1({ fates = {}, rows = {}, entries = null, more = {} } = {}) {
  const requirements = [row(0, 'not-checked', 'deliverable_ungrounded'), row(1, 'not-checked', 'deliverable_ungrounded'),
    row(2, 'done'), row(3, 'not-checked', 'deliverable_ungrounded'), row(4, 'not-checked', 'challenge_unsettled'),
    row(5, 'done'), row(6, 'done')].map((r, i) => (rows[i] ? { ...r, ...rows[i] } : r));
  const held = [[MONEY], [CART], [TESTS], [README]];
  const account = entries ?? requirements.map((_, i) => {
    const fate = fates[i] ?? (i < 4 ? 'holds' : 'outside');
    const receipts = fate === 'not_examined' ? [] : fate === 'missing' ? [] : held[i] ?? [CART];
    return entry(i, fate, receipts, fate === 'missing' ? { cause: 'not_returned' } : {});
  });
  const report = { repo: { host: 'github.com', id: '0' }, reviewScope: 'session-only', pr: null, codeCoverage: 'complete',
    coverage: 'complete', sessionReview: 'complete', findings: [], failures: [], writtenClaims: [], pivots: [],
    promises: [], decisions: [], requirements,
    codePass: { ran: true, coverage: 'complete', base: { kind: 'git', commit: 'b'.repeat(40) },
      files: ['src/money.js', 'src/cart.js', 'test/cart.test.js', 'README.md'].map((p) => ({ path: `${REPO}/${p}`,
        state: 'shown', sha256: SHA })),
      findings: [], questions: [], withheld: [], footer: [], rejected: [],
      account: { batches: [{ n: 1, keys: requirements.map((_, i) => `S${i + 1}`), state: 'ok', answers: 1 }],
        entries: account, reviewCoverage: 'complete' }, ...more } };
  return withAskCodeLinks(report, session());
}
const modelOf = (r) => reportModel(session(), r, {});
const pageOf = (r) => renderSessionPage(session(), r);
const mdOf = (r) => renderReportMarkdown(session(), r);
const commentOf = (r) => publicCommentText({ ...r, ...honestStatuses(r) }).summary;
/** Every surface of one report: the page, the report .md, the terminal's count lines and the PR comment. */
const surfaces = (r) => ({ page: pageOf(r), md: mdOf(r), terminal: countLines(modelOf(r)).join('\n'), comment: commentOf(r) });
/** The page's line for ask `n` under your prompt, as text. */
const askLineOf = (page, n) => { const m = new RegExp(`<li(?: id="ask-${n}")?>ask ${n} · [\\s\\S]*?</li>`).exec(page);
  return m ? m[0].replace(/<[^>]+>/g, '').replace(/&#39;/g, "'") : ''; };
const UNGROUNDED = 'Sonah did not find, word for word, the evidence that the session review cited for it.';
/** The note as the .md says it, for its places (each `path:line`, as code). */
const noteMd = (places) => `${REPORT_PROMPT_WORDS.codeHolds(places.length)} ${places.map((p) => `\`${p}\``)
  .reduce((out, p, at) => `${out}${at ? (at === places.length - 1 ? ' and ' : ', ') : ''}${p}`, '')}). `
  + REPORT_PROMPT_WORDS.codeHoldsUnchecked;
const escape = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** D133 (R2): the note is two parts — the code review's verdict and where Sonah found its quotes, on the row's open
 *  line, and that Sonah did not check it, in the row's own fold after the session review's reason. Each surface with the
 *  note taken out: on the page the line ` · <verdict>` and the fold's paragraph, in the .md the verdict after its row's
 *  other words and the sentence in the row's fold; a fold left empty goes with it. What is left must be byte for byte
 *  the surface without the verdict. */
const VERDICT = escape(REPORT_PROMPT_WORDS.codeHolds(1)).replace('its quote', 'its quotes?');
const UNCHECKED = escape(REPORT_PROMPT_WORDS.codeHoldsUnchecked);
const NOTE_PAGE = new RegExp(` · ${VERDICT} (?:<code>[^<]*</code>(?:, | and )?)+\\)\\.`, 'g');
const NOTE_PAGE_FOLD = new RegExp(`<p class="note">${UNCHECKED}</p>`, 'g');
const NOTE_MD = new RegExp(`${VERDICT} (?:\`[^\`]*\`(?:, | and )?)+\\)\\.`, 'g');
const NOTE_MD_FOLD = new RegExp(` ${UNCHECKED}(?=</details>)|(?<=<summary>Evidence</summary>)${UNCHECKED}`, 'g');
/** The page lists a marked ask only when it has a line (session-page.js), so an item left with its status alone, and a
 *  list left empty, go with the note. */
const withoutNote = (s) => ({ ...s, md: s.md.replace(new RegExp(`${NOTE_MD.source} `, 'g'), '').replace(NOTE_MD_FOLD, '')
  .replaceAll('<details><summary>Evidence</summary></details>', ''),
page: s.page.replace(NOTE_PAGE, '').replace(NOTE_PAGE_FOLD, '')
  .replaceAll(' · <details class="row-evidence"><summary>Evidence</summary></details>', '')
  .replace(/<li>ask \d+ · <span class="tag s-[A-Za-z]+">[^<]*<\/span><\/li>\n/g, '')
  .replace('<ul class="rows ask-lines"></ul>', '') });
/** D133 (R2): a row of the .md's asks table with the note: the verdict, then the row's fold with the reason (if any)
 *  and that Sonah did not check it. */
const noteRowMd = (places, reason = null) => `${REPORT_PROMPT_WORDS.codeHolds(places.length)} ${places.map((p) => `\`${p}\``)
  .reduce((out, p, at) => `${out}${at ? (at === places.length - 1 ? ' and ' : ', ') : ''}${p}`, '')}). `
  + `<details><summary>Evidence</summary>${reason ? `${reason} ` : ''}${REPORT_PROMPT_WORDS.codeHoldsUnchecked}</details>`;
/** The report with every `holds` entry made `outside` (an examined outcome that renders no byte, D111 I9). */
const asOutside = (r) => ({ ...r, codePass: { ...r.codePass, account: { ...r.codePass.account,
  entries: r.codePass.account.entries.map((e) => (e.fate === 'holds' ? { ...e, fate: 'outside' } : e)) } } });

test('D125 amended, S1\'s shape: the three asks the session review left not checked and the code review found to hold keep "Not checked" and every count, and their rows say the verdict, where Sonah found its quotes and that Sonah did not check it', () => {
  const r = s1();
  // The one definition: the note's, and the kind of every ask as before (not checked, folded).
  assert.deepEqual(r.requirements.map((x) => askCodeHoldsNote(x, r)?.receipts ?? null), [[MONEY], [CART], null, [README],
    null, null, null]);
  assert.deepEqual(r.requirements.map((x) => askRowKind(x, r)), ['asksNotChecked', 'asksNotChecked', null,
    'asksNotChecked', 'asksNotChecked', null, null]);
  // The model: every status as the session review left it; the count line and the heading as before.
  const model = modelOf(r);
  assert.deepEqual(model.prompt.asks.map((a) => [a.state, a.status]), [['notChecked', 'Not checked'],
    ['notChecked', 'Not checked'], ['done', 'Done'], ['notChecked', 'Not checked'], ['notChecked', 'Not checked'],
    ['done', 'Done'], ['done', 'Done']]);
  assert.deepEqual(model.prompt.parts, ['3 done', '4 not checked']);
  // The header's and the footer's count of the asks that Sonah did not check: all four.
  assert.deepEqual(model.notChecked.didNotCheck.phrases.slice(0, 1), ['4 asks']);
  const s = surfaces(r);
  assert.ok(s.md.includes(`${REPORT_HEADER_WORDS.notCheckedLead} 4 asks · `), s.md);
  assert.ok(s.md.includes(REPORT_NOT_CHECKED_WORDS.asksThere(4)));
  // The terminal's count line (D97), the page's and the .md's.
  assert.ok(s.terminal.split('\n')[0].endsWith('Your prompt: 3 done, 4 not checked'), s.terminal);
  assert.ok(s.page.includes('Your prompt: 3 done, 4 not checked'));
  assert.ok(s.md.includes('### Your prompt (7 asks: 3 done, 4 not checked)'), s.md);
  // The rows: "Not checked", the session review's reason, unchanged, then the note as one line, with the grounded
  // file:line; the page's mark says "Not checked".
  for (const [n, rc] of [[1, MONEY], [2, CART], [4, README]]) {
    const at = `${rc.path}:${rc.startLine}`;
    // D133 (R2): the verdict on the row's open line; the reason and that Sonah did not check it in the row's own fold.
    assert.ok(s.md.includes(`\n| Not checked | “${escapeSource(ASKS[n - 1])}” | ${noteRowMd([at], UNGROUNDED)} |`),
      `ask ${n}\n${s.md}`);
    assert.equal(askLineOf(s.page, n), `ask ${n} · Not checked · ${REPORT_PROMPT_WORDS.codeHolds(1)} `
      + `${at}). · Evidence${UNGROUNDED}${REPORT_PROMPT_WORDS.codeHoldsUnchecked}`);
    assert.match(s.page, new RegExp(`<mark class="ask s-notChecked" id="ask-${n}"><span class="tag">Not checked</span>`));
    assert.deepEqual([model.prompt.asks[n - 1].lines.length, model.prompt.asks[n - 1].folded.length], [1, 2],
      `ask ${n}: the verdict; the reason, then that Sonah did not check it`);
  }
  // Ask 3, done and held: Done, as before, no note; ask 5, outside: Not checked, as before, no note.
  assert.ok(s.md.includes(`\n| Done | “${escapeSource(ASKS[2])}” |`));
  assert.ok(s.md.includes(`\n| Not checked | “${escapeSource(ASKS[4])}” | <details><summary>Evidence</summary>The `
    + 'session review\'s own check on it did not settle.</details> |'), s.md);
  assert.equal(s.md.match(NOTE_MD).length, 3);
  // The PR comment: the folded line counts them among the rows that Sonah could not check, as before.
  assert.equal(checklistRowCounts(r).asksNotChecked, 4);
  assert.equal(attentionSummary(r).folded, ATTENTION_WORDS.folded(4));
  assert.ok(s.comment.replace(/\\(.)/g, '$1').includes(ATTENTION_WORDS.folded(4)), s.comment);
  // Every surface without the note lines is byte for byte the one without the verdict: no count and no status moves,
  // and the terminal and the PR comment hold no note.
  assert.deepEqual(withoutNote(s), surfaces(asOutside(r)));
  assert.deepEqual([s.terminal, s.comment], [surfaces(asOutside(r)).terminal, surfaces(asOutside(r)).comment]);
  // No surface says "Holds in the code" as a status, or "Done" of a not-checked row.
  for (const text of Object.values(s)) assert.doesNotMatch(text, /Holds in the code|holds? in the code[,)]/);
  assert.doesNotMatch(s.md, /\| Done \| “(?:formatCents|add removeItem|mention removeItem)/);
});

test('D125 amended: the words of the note', () => {
  assert.equal(noteMd(['a.js:5']), 'The code review found that it holds in the code (Sonah found its quote word for word '
    + 'at `a.js:5`). Sonah did not check whether it holds.');
  assert.equal(REPORT_PROMPT_WORDS.codeHolds(2), 'The code review found that it holds in the code (Sonah found its quotes '
    + 'word for word at');
  // A row with no reason (the session review's own not checked): the note is its first line.
  const r = s1({ rows: { 0: { reason: null } } });
  const md = mdOf(r);
  assert.ok(md.includes(`\n| Not checked | “${escapeSource(ASKS[0])}” | ${noteRowMd([`${MONEY.path}:5`])} |`), md);
  assert.deepEqual(withoutNote(surfaces(r)), surfaces(asOutside(r)));
});

test('D125: several quotes are each named once, in their order', () => {
  const twice = s1({ entries: null, fates: {} });
  twice.codePass.account.entries[0] = entry(0, 'holds', [MONEY, TESTS, MONEY, { ...CART, startLine: 20, endLine: 22 }]);
  const md = mdOf(twice);
  assert.ok(md.includes(noteRowMd([`${MONEY.path}:5`, `${TESTS.path}:26`, `${CART.path}:20-22`], UNGROUNDED)), md);
  assert.ok(md.includes(`${REPORT_PROMPT_WORDS.codeHolds(3)} \`${MONEY.path}:5\`, \`${TESTS.path}:26\` and `
    + `\`${CART.path}:20-22\`). `), md);
  assert.deepEqual(withoutNote(surfaces(twice)), surfaces(asOutside(twice)));
});

test('D125: without the verdict on a not-checked ask nothing changes: a holds entry renders as any examined outcome on every other ask, on every surface', () => {
  const cases = {
    // The asks the session review read done, not done or partly done.
    'done, not done, partly done': s1({ rows: { 0: { status: 'done', reason: null, deliverable: R('C1', 'commentary', TEXT.said) },
      1: { status: 'not-done', reason: null, shortfall: R('C1', 'commentary', TEXT.said) },
      3: { status: 'partly-done', reason: null, deliverable: R('C1', 'commentary', TEXT.said),
        shortfall: R('C1', 'commentary', TEXT.said) } } }),
    // A not-checked ask that the code step tied anything else to: a question (ask 1), a withheld finding (ask 2); ask 4
    // outside.
    'a link': s1({ fates: { 3: 'outside' }, more: { questions: [{ question: 'SYNTHETIC is the grouping right for negative amounts?', lens: 'ask',
      concerns: { key: 'S1', kind: 'ask', source: 'requirements', index: 0, id: null }, quote: R('I1', 'instruction', ASKS[0]) }],
    withheld: [{ what: 'finding', reason: 'verify_refuted', text: 'SYNTHETIC withheld', check: { verdict: 'refuted',
      reason: 'incorrect' }, leadsFrom: [{ key: 'S2', kind: 'ask', source: 'requirements', index: 1, id: null }] }] } }),
    // Code's own row for a message that the session review named no ask from (`codeMade`): no ask of the session review.
    "code's own row": s1({ fates: { 1: 'outside', 3: 'outside' }, rows: { 0: { codeMade: true, reason: 'ask_unreviewed',
      text: 'the review named no ask from this message' } } }),
    // Two entries name one ask; an entry that names no path or no lines; an entry of another scope or another source.
    'two entries': s1({ entries: [entry(0, 'holds', [MONEY]), entry(0, 'holds', [MONEY])] }),
    'no place': s1({ entries: [entry(0, 'holds', [{ ...MONEY, path: '' }]), entry(1, 'holds', [{ ...CART, startLine: null }]),
      entry(3, 'holds', [])] }),
    'other scope': s1({ entries: [{ ...entry(0, 'holds', [MONEY]), scope: 'written_claim' },
      { ...entry(1, 'holds', [CART]), ref: { source: 'promises', index: 1, id: null } }] }),
  };
  assert.deepEqual(cases['a link'].requirements.slice(0, 2).map((x) => x.codeLinks.map((l) => l.link)),
    [['question_concerns'], ['withheld_finding']]);
  assert.equal(cases['a link'].requirements.filter((x) => askCodeHolds(cases['a link'], x)).length, 2,
    'the verdict is there: the links alone keep the two asks without the note');
  assert.equal(cases['a link'].requirements.filter((x) => askCodeHoldsNote(x, cases['a link'])).length, 0);
  assert.equal(cases["code's own row"].codePass.account.entries[0].fate, 'holds');
  for (const [name, r] of Object.entries(cases)) {
    assert.deepEqual(surfaces(r), surfaces(asOutside(r)), name);
    const s = surfaces(r);
    for (const text of [s.page, s.md, s.terminal]) assert.doesNotMatch(text, /holds? in the code/i, name);
  }
  // A report before the accounting (no `account`), and one whose code step did not run: no note.
  const { account: _a, ...before } = s1().codePass;
  const r = { ...s1(), codePass: before };
  assert.deepEqual(r.requirements.map((x) => askCodeHoldsNote(x, r)), [null, null, null, null, null, null, null]);
  assert.deepEqual(modelOf(r).prompt.parts, ['3 done', '4 not checked']);
  assert.doesNotMatch(mdOf(r), /holds? in the code/i);
  // With no report to read the entries from, a row has no note.
  assert.equal(askCodeHoldsNote(s1().requirements[0]), null);
});

test('D125: an ask that the code review says does not hold never reads better than before', () => {
  // A `breaks` entry on a not-checked ask, by a finding that leads from it: D93's line and count, as before.
  const finding = { id: `sha256:${'1'.repeat(64)}`, origin: 'code-review', status: 'DECIDE', scope: 'current-code',
    kind: 'ask_not_met', lens: 'ask', title: 'SYNTHETIC removeItem keeps the line', explanation: 'SYNTHETIC.',
    input: 'removeItem(cart, "x")', trace: [{ step: 'It splices.', source: 'file', ...CART }],
    anchor: { path: CART.path, side: 'new', startLine: 22, endLine: 22 }, receipts: [CART],
    leadsFrom: [{ key: 'S2', kind: 'ask', source: 'requirements', index: 1, id: null }], foundByLenses: ['ask'] };
  const r = s1({ fates: { 1: 'breaks' }, more: { findings: [finding] } });
  r.codePass.account.entries[1] = { ...r.codePass.account.entries[1], by: 'F1' };
  const linked = withAskCodeLinks(r, session());
  assert.equal(askRowKind(linked.requirements[1], linked), 'asksCodeFinding');
  assert.equal(askCodeHoldsNote(linked.requirements[1], linked), null);
  const model = modelOf(linked);
  assert.deepEqual([model.prompt.asks[1].state, model.prompt.asks[1].status], ['notCheckedCode', 'Not checked']);
  assert.ok(model.prompt.asks[1].lines.some((l) => l.some((p) => p.text.startsWith('The code review found a problem here.'))));
  // Every fate but `holds` on a not-checked ask reads as `outside` does, the ask not checked, with no note.
  for (const fate of ['breaks', 'outside', 'not_examined', 'missing']) {
    const each = s1({ fates: { 0: fate, 1: fate, 3: fate } });
    const base = s1({ fates: { 0: 'outside', 1: 'outside', 3: 'outside' } });
    assert.equal(mdOf(each).split('\n### Must act')[0].replace(/\n.*item-by-item check.*\n/g, '\n'),
      mdOf(base).split('\n### Must act')[0].replace(/\n.*item-by-item check.*\n/g, '\n'), fate);
    assert.deepEqual(modelOf(each).prompt.parts, ['3 done', '4 not checked'], fate);
    assert.doesNotMatch(mdOf(each), /holds? in the code/i, fate);
  }
});

test('D125\'s review: no note over a check of Sonah\'s that speaks against the ask or did not settle it', () => {
  // The admitted reasons, by name: the session review proposed the ask delivered, and Sonah could only not find, or not
  // place after the ask, the evidence that it cited; and no reason, the session review's own not checked.
  assert.deepEqual(ASK_CODE_HOLDS_REASONS, ['deliverable_ungrounded', 'deliverable_not_after']);
  assert.ok(ASK_CODE_HOLDS_REASONS.every((reason) => REQUIREMENT_UNCHECKED_REASONS.includes(reason)));
  for (const reason of [...REQUIREMENT_UNCHECKED_REASONS, null, undefined, 'SYNTHETIC_not_a_reason']) {
    const rows = Object.fromEntries([0, 1, 3].map((i) => [i, { reason }]));
    const r = s1({ rows });
    const admitted = reason === null || reason === undefined || ASK_CODE_HOLDS_REASONS.includes(reason);
    assert.equal(r.requirements.filter((x) => askCodeHoldsNote(x, r)).length, admitted ? 3 : 0, String(reason));
    // The counts as before either way.
    assert.deepEqual(modelOf(r).prompt.parts, ['3 done', '4 not checked'], String(reason));
    if (admitted) {
      assert.equal(mdOf(r).match(NOTE_MD).length, 3, String(reason));
      assert.deepEqual(withoutNote(surfaces(r)), surfaces(asOutside(r)), String(reason));
      continue;
    }
    // Every surface as if the entries were `outside`: the asks not checked, with no note.
    assert.deepEqual(surfaces(r), surfaces(asOutside(r)), String(reason));
    for (const text of Object.values(surfaces(r))) assert.doesNotMatch(text, /holds? in the code/i, String(reason));
  }
});

test('D125\'s review: a verdict that quotes the start commit is no line of the code as it is, and gives no note', () => {
  const old = (rc) => ({ ...rc, side: 'old' });
  const r = s1({ entries: [entry(0, 'holds', [old(MONEY)]), entry(1, 'holds', [CART, old(CART)]), entry(3, 'holds', [README])] });
  assert.deepEqual(r.requirements.map((x) => askCodeHoldsNote(x, r)?.receipts ?? null), [null, null, null, [README], null,
    null, null]);
  assert.deepEqual(modelOf(r).prompt.parts, ['3 done', '4 not checked']);
  // Asks 1 and 2 read as if their entries were `outside`; ask 4 names only its line of the file as it is now.
  const outside = { ...r, codePass: { ...r.codePass, account: { ...r.codePass.account,
    entries: r.codePass.account.entries.map((e, i) => (i < 2 ? { ...e, fate: 'outside' } : e)) } } };
  assert.deepEqual(surfaces(r), surfaces(outside));
  const md = mdOf(r);
  assert.ok(md.includes(noteRowMd([`${README.path}:7`], UNGROUNDED)), md);
  assert.equal(md.match(NOTE_MD).length, 1);
  assert.ok(!md.includes(`${MONEY.path}:5`) && !md.includes(`${CART.path}:22`), md);
});

test('D125 amended: one definition on every surface — a note exactly when the verdict holds, and every status and count as without it, over generated reports', () => {
  let seed = 125;
  // The generator's high bits (D125's review: its low bits repeat every few draws); and what the rounds held, so that a
  // generator that reaches no case fails here.
  const next = (n) => { seed = (seed * 1103515245 + 12345) % 2147483648; return Math.floor(seed / 65536) % n; };
  const reached = { notChecked: 0, noted: 0, reason: 0, side: 0 };
  const STATUSES = ['done', 'not-done', 'partly-done', 'not-checked'];
  const FATES = ['holds', 'breaks', 'outside', 'not_examined', 'missing', 'none'];
  for (let round = 0; round < 120; round++) {
    const rows = {}, fates = {}, reasons = {}, current = {};
    const entries = [];
    for (let i = 0; i < 7; i++) {
      const status = STATUSES[next(4)];
      // Half the not-checked asks carry an admitted reason, the others any reason of the closed list.
      const reason = status !== 'not-checked' ? null : next(2) === 0 ? [null, ...ASK_CODE_HOLDS_REASONS][next(3)]
        : REQUIREMENT_UNCHECKED_REASONS[next(REQUIREMENT_UNCHECKED_REASONS.length)];
      reasons[i] = reason;
      rows[i] = { status, reason,
        deliverable: ['done', 'partly-done'].includes(status) ? R('C1', 'commentary', TEXT.said) : null,
        shortfall: ['not-done', 'partly-done'].includes(status) ? R('C1', 'commentary', TEXT.said) : null };
      fates[i] = FATES[next(FATES.length)];
      // A receipt of the start commit, one time in five.
      const receipts = ['not_examined', 'missing'].includes(fates[i]) ? []
        : [[MONEY], [CART], [TESTS], [README]][next(4)].map((rc) => (next(5) === 0 ? { ...rc, side: 'old' } : rc));
      current[i] = receipts.every((rc) => rc.side === 'new');
      if (fates[i] !== 'none') entries.push(entry(i, fates[i], receipts, fates[i] === 'missing' ? { cause: 'not_returned' }
        : {}));
    }
    const r = s1({ rows, entries });
    const model = modelOf(r);
    const expected = r.requirements.map((x, i) => x.status === 'not-checked' && fates[i] === 'holds'
      && [null, 'deliverable_ungrounded', 'deliverable_not_after'].includes(reasons[i]) && current[i]);
    r.requirements.forEach((x, i) => {
      if (x.status !== 'not-checked') return;
      reached.notChecked++;
      if (expected[i]) reached.noted++;
      else if (fates[i] === 'holds' && reasons[i] !== null && !ASK_CODE_HOLDS_REASONS.includes(reasons[i])) reached.reason++;
      else if (fates[i] === 'holds' && !current[i]) reached.side++;
    });
    assert.deepEqual(r.requirements.map((x) => askCodeHoldsNote(x, r) !== null), expected, `round ${round}`);
    // The note is on the rows where the definition holds, and nowhere else.
    const md = mdOf(r);
    assert.equal(md.match(NOTE_MD)?.length ?? 0, expected.filter(Boolean).length, `round ${round}: the .md's notes`);
    // Every status and count as without the verdict: the model's states, the count line, the header, the footer, the
    // terminal and the PR comment's fold; the page and the .md without the note lines byte for byte.
    const outside = asOutside(r);
    assert.deepEqual(model.prompt.asks.map((a) => a.state), modelOf(outside).prompt.asks.map((a) => a.state), `round ${round}`);
    assert.deepEqual(model.prompt.counts, modelOf(outside).prompt.counts, `round ${round}`);
    const notChecked = r.requirements.filter((x) => x.status === 'not-checked').length;
    assert.equal(model.prompt.counts.notChecked + model.prompt.counts.notCheckedCode, notChecked, `round ${round}`);
    assert.equal(checklistRowCounts(r).asksNotChecked, checklistRowCounts(outside).asksNotChecked, `round ${round}`);
    assert.deepEqual(withoutNote(surfaces(r)), surfaces(outside), `round ${round}`);
  }
  // Each case was reached: not-checked asks, asks with the note, and verdicts refused for their reason or their side.
  for (const [what, n] of Object.entries(reached)) assert.ok(n >= 3, `${what}: ${n}`);
});
