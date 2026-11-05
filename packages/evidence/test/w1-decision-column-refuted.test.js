// W1 A (owner decision 2026-10-13): a decision the challenge refuted only on who decided it is no longer dropped. Its
// choice is checked on its own (the existence proposition: the cited actions adopted the stated choice); a choice that
// check upholds is published "could not tell" with the closed reason `decision_column_refuted`. A decision refuted on
// existence stays out, as before. D212 (owner decision 2026-11-05): such a choice is no longer put to the reviewer once
// more for a new column, nor that column checked (`narrative:wN:recolumn:K`, `challenge:wN:recolumn:…`); the window's
// `recolumn` record holds only what was asked (`refuted`, `existence`), and a report written before D212, whose record
// also holds the asks it made, renders as it did; the code step's dossier states such a choice as it is published.
// Every recording here is synthetic; no model is called — the judges are code.
import test from 'node:test';
import assert from 'node:assert/strict';
import { load, humanAsk, said, call, result } from './m33-u-unasked-fixture.js';
import { runReview, windowIncompleteReasons, rechecksUnexecuted } from '../src/run-review.js';
import * as prompt from '../src/prompt.js';
import * as ledger from '../src/ledger.js';
import { CHECKLIST_PROPOSITIONS, checklistProposition, SESSION_DOSSIER_NOTE } from '../src/challenge.js';
import { renderSessionPage, PAGE_COLUMN_REASON_WORDS, escapeHtml } from '../../render/session-page.js';
import { renderReportMarkdown } from '../../render/session-story.js';
import { REPORT_DECISION_TAGS } from '../../render/report-words.js';
import { windowOfLabel } from '../../cli/src/session-review.js';
import { codeDossier, renderDossier, DOSSIER_COLUMN_WORDS } from '../src/code-context.js';

const { PROMPT_VERSION } = prompt;
const { DECISION_COLUMN_REFUTED, DECISION_RECOLUMN_RECORD, RESOLUTION_CHALLENGE_OUTCOMES, JUDGMENT_REASONS } = ledger;
const ASK = 'Fix greet.js so empty names give a friendly greeting.';
const CODE = 'return name || "guest"';

function rows() {
  return [
    humanAsk(ASK),
    call('t1', 'Edit', { file_path: '/repo/greet.js', old_string: 'return name', new_string: CODE }),
    result('t1', 'The file /repo/greet.js has been updated.', { filePath: '/repo/greet.js', oldString: 'return name',
      newString: CODE, originalFile: 'return name\n', structuredPatch: [], userModified: false, replaceAll: false }),
    said('Fixed greet.js: an empty name now gets "guest".'),
  ];
}
const quote = (eventId, role, text) => ({ eventId, role, quote: text });
const counts = (vocabulary, set = {}) => Object.fromEntries(vocabulary.map((token) => [token, set[token] ?? 0]));

function fixture(session) {
  const ask = session.events.find((event) => event.kind === 'instruction');
  const edit = session.events.find((event) => event.kind === 'invocation');
  return { ask, edit, words: quote(ask.id, 'instruction', 'empty names give a friendly greeting') };
}
/** The first answer's decision: filed "you settled it" on the human's words, which leave the greeting open. */
const settledDecision = (n) => ({ dimension: 'empty-name greeting', chosen: 'greet an empty name as "guest"',
  value: '"guest"', valueReceipt: { eventId: n.edit.id, field: 'added-code', role: 'code', quote: CODE },
  actions: [n.edit.id], constrainedBy: { instruction: n.words, settles: true,
    settledValueQuote: 'a friendly greeting' } });
/** The same choice, filed "you asked, the agent chose how" on the same words: the column W1 A's re-ask could give. */
const choseHow = (n, extra = {}) => ({ ...settledDecision(n), dimension: 'any words', chosen: 'any words',
  constrainedBy: { instruction: n.words, settles: false, settledValueQuote: null }, ...extra });
const narrative = (decisions) => ({ requirements: [], claims: [], pivots: [], decisions });

/**
 * A judge in code. The narrative request is answered with `first`; a request labelled as W1 A's re-ask
 * (`narrative:w1:recolumn:K`), were one sent, with `recolumn(request)` — by default a new column its check would uphold,
 * so a review that still re-asked would publish it. A challenge vote is `verdict(item, request)`, citing the decision's
 * action. Every request is kept in `seen`.
 */
function judgeOf({ first, recolumn = () => narrative([choseHow(first.n)]), verdict, seen = [] }) {
  return async (request) => {
    seen.push(request);
    if (request.challenge) return { votes: request.challenge.items.map((item) => ({ key: item.key,
      verdict: verdict(item, request), explanation: `Synthetic check of ${item.key}.`,
      receipts: [quote(item.candidate.actions[0], 'code', CODE)] })) };
    if (/:recolumn:/.test(request.label)) return recolumn(request);
    return first();
  };
}
/** The narrative answer `first` for fixture `n` (kept on the function, for the judge's default re-ask answer). */
const answer = (n, decisions) => Object.assign(() => narrative(decisions), { n });
/** The window's own check refutes the decision; the existence check gives `exists`; any other check upholds. */
const verdicts = ({ exists = 'not-refuted' } = {}) => (item, request) =>
  (/:exists/.test(request.label) ? exists : /:recolumn/.test(request.label) ? 'not-refuted'
    : item.type === 'decision' ? 'refuted' : 'not-refuted');
const review = (session, judge, extra = {}) => runReview({ session, pr: null, reviewScope: 'session-only', judge,
  ...extra });
const record = (report) => report.windowResults[0].recolumn;
const recolumnRequests = (seen) => seen.filter((request) => /:recolumn/.test(request.label));

test('W1 A and D212: the reason, the record, the version and the label', () => {
  assert.equal(DECISION_COLUMN_REFUTED, 'decision_column_refuted');
  assert.ok(JUDGMENT_REASONS.includes(DECISION_COLUMN_REFUTED), 'a member of the closed row reasons');
  assert.ok(Object.hasOwn(PAGE_COLUMN_REASON_WORDS, DECISION_COLUMN_REFUTED), 'the page has words for it');
  // D212: the record holds only what is asked; the re-ask, its fixed words and its counts are gone.
  assert.deepEqual([...DECISION_RECOLUMN_RECORD], ['refuted', 'existence']);
  assert.ok(Object.isFrozen(DECISION_RECOLUMN_RECORD));
  for (const name of ['recolumnRequest', 'RECOLUMN_HEADING', 'RECOLUMN_WORDS', 'RECOLUMN_NOW_ANSWER'])
    assert.equal(Object.hasOwn(prompt, name), false, name);
  assert.equal(Object.hasOwn(ledger, 'DECISION_RECOLUMN_WITHHELD'), false);
  // W1 A's one bump for its re-ask (/34). The release review moved it once more (sonah.narrative/35): a project
  // instruction file the session wrote is left out of the window's project files. The second release review moved it
  // once more (sonah.narrative/36): that file's path is compared under the working directory. G2 moved it once more
  // (sonah.narrative/37): the re-ask of a choice not to act whose existence check refuted its words. D103 moved it once
  // more (sonah.narrative/38): a Claude Code recording's results shown up to 12,000 bytes a side.
  // D212 moved it once more (sonah.narrative/39): W1 A's re-ask for a new column is withdrawn.
  assert.equal(PROMPT_VERSION, 'sonah.narrative/39');
  // An answer an earlier review stored for W1 A's re-ask stays its window's (F226), so it is forgotten with it.
  assert.equal(windowOfLabel('narrative:w2:recolumn:3'), 2);
});

test('D212: a choice refuted on its column, which exists, is published "could not tell" with its reason, and never '
  + 're-asked', async (t) => {
  const { session } = await load(t, rows());
  const n = fixture(session);
  const seen = [];
  // The judge would give a new column, and uphold it, were the reviewer asked once more: before D212 the decision was
  // published under it ('asked-chose').
  const report = await review(session, judgeOf({ seen, first: answer(n, [settledDecision(n)]), verdict: verdicts() }));
  assert.equal(report.decisions.length, 1, 'the decision is no longer dropped');
  assert.deepEqual(report.decisions.map((d) => [d.column, d.columnState, d.reasons[0], d.constrainedBy, d.dimension,
    d.chosen]), [[null, 'unchecked', DECISION_COLUMN_REFUTED, null, 'empty-name greeting',
    'greet an empty name as "guest"']], 'could not tell; the choice stays the row\'s own');
  assert.deepEqual(recolumnRequests(seen).map((request) => request.label), [], 'no re-ask and no check of a new column');
  assert.deepEqual(record(report), { refuted: 1, existence: counts(RESOLUTION_CHALLENGE_OUTCOMES, { upheld: 1 }) });
  assert.equal(Object.hasOwn(report.windowResults[0], 'recolumnChallenge'), false);
  assert.deepEqual(windowIncompleteReasons(report.windowResults[0]), [], 'the window is complete');
  // The existence check, as before: the choice alone, on its own proposition, three passes in the standard profile.
  const exists = seen.filter((request) => request.challenge && request.label.startsWith('challenge:w1:exists'));
  assert.deepEqual(exists.map((request) => request.label), ['challenge:w1:exists:b1:p1', 'challenge:w1:exists:b1:p2',
    'challenge:w1:exists:b1:p3']);
  const [existsItem] = exists[0].challenge.items;
  assert.equal(existsItem.key, 'decisions:0:exists');
  assert.ok(!Object.hasOwn(existsItem.candidate, 'constrainedBy') && !Object.hasOwn(existsItem.candidate,
    'instructionReview'), 'asked without who decided it');
  assert.equal(checklistProposition(existsItem), CHECKLIST_PROPOSITIONS.decision);
  assert.equal(report.windowResults[0].recolumnExistsChallenge.results.length, 1);
  // Nothing after the existence check: the window's last request is its last pass.
  assert.equal(seen.at(-1).label, 'challenge:w1:exists:b1:p3');
});

test('D212\'s second review: the code step\'s dossier states the choice "could not tell", so on a review whose re-ask '
  + 'had given it a column its check upheld, that line alone of the code review\'s dossier moves', async (t) => {
  const { session } = await load(t, rows());
  const n = fixture(session);
  const report = await review(session, judgeOf({ first: answer(n, [settledDecision(n)]), verdict: verdicts() }));
  // The same review as a report written before D212 published it: under the column the re-ask gave, grounded.
  const earlier = structuredClone(report);
  earlier.decisions[0] = { ...earlier.decisions[0], column: 'asked-chose', columnState: ledger.DERIVED_COLUMN_STATE,
    reasons: [], constrainedBy: choseHow(n).constrainedBy };
  const lines = (r) => renderDossier(codeDossier({ report: r, session })).split('\n');
  const [now, before] = [lines(report), lines(earlier)];
  assert.equal(now.length, before.length);
  const moved = now.flatMap((line, i) => (line === before[i] ? [] : [[JSON.parse(before[i]), JSON.parse(line)]]));
  assert.deepEqual(moved.map(([was, is]) => [was.kind, was.item, was.column, is.kind, is.item, is.column]),
    [['decision', 'decision_chose', DOSSIER_COLUMN_WORDS['asked-chose'], 'decision', 'decision_whether_asked',
      DOSSIER_COLUMN_WORDS.unchecked]], 'that decision\'s line, and no other');
});

test('W1 A: a decision published "could not tell" with its closed reason (D199: in the report, no reader says it; D200: '
  + 'its short tag does, the page in its tip)', async (t) => {
  const { session } = await load(t, rows());
  const n = fixture(session);
  // D199 (the owner, 2026-10-30, "All of them"): the report keeps the closed reason; no reader says it beside the
  // decision, the page or the .md.
  const report = await review(session, judgeOf({ first: answer(n, [settledDecision(n)]), verdict: verdicts() }));
  assert.deepEqual(report.decisions.map((d) => d.reasons[0]), [DECISION_COLUMN_REFUTED]);
  const html = renderSessionPage(session, report, { sessionHash: 'a'.repeat(64) });
  const md = renderReportMarkdown(session, report, {});
  const words = PAGE_COLUMN_REASON_WORDS[DECISION_COLUMN_REFUTED];
  assert.equal(typeof words, 'string');
  // D200 (the owner, 2026-10-31: "bring back the precision markers as short tags"): the decision carries the reason's
  // short tag, its sentence in the tag's tip on the page; the .md's head says the tag alone. D200's review: no title
  // any more; the sentence is a `.tip` span hidden until hover or focus, so the page's open text is the page without
  // the flag, as it was without the title.
  const tag = REPORT_DECISION_TAGS[DECISION_COLUMN_REFUTED];
  const flag = `<span class="flag">${escapeHtml(tag)} <span class="tip">${escapeHtml(words)}</span></span>`;
  assert.equal(html.split(flag).length - 1, 1, 'D200: the decision\'s tag on the page');
  assert.ok(md.includes(` · ${tag}`), 'D200: the decision\'s tag in the .md');
  // D202 (a tag's sentence showed on a pointer's hover only): and once in the opened row, under the tag's word.
  const line = `<p class="line tag-why kv"><span class="label">${escapeHtml(tag)}</span> `
    + `<span class="v">${escapeHtml(words)}</span></p>`;
  assert.equal(html.split(line).length - 1, 1, 'D202: the sentence in the opened row');
  assert.equal(html.split(flag).join('').split(line).join('').includes(words.replace(/'/g, '&#39;')), false);
  assert.equal(md.includes(words), false);
});

test('D212: a report written before it, whose window records the asks W1 A\'s re-ask made, renders as it did',
  async (t) => {
    const { session } = await load(t, rows());
    const n = fixture(session);
    const report = await review(session, judgeOf({ first: answer(n, [settledDecision(n)]), verdict: verdicts() }));
    const [window] = report.windowResults;
    // The same review as a report written before D212 holds it: the record's three members of the asks (one re-ask
    // sent, its row gave no column), and the check of a new column, run on another window's decision, upheld none.
    const earlier = structuredClone(report);
    earlier.windowResults[0] = { ...window,
      recolumn: { ...window.recolumn, asked: 1, withheld: { request_bound: 0, no_answer: 0, no_row: 0, could_not_tell: 1,
        ungrounded: 0, same_column: 0 }, challenged: counts(RESOLUTION_CHALLENGE_OUTCOMES) },
      recolumnChallenge: { ...structuredClone(window.recolumnExistsChallenge), results: [] } };
    const options = { sessionHash: 'a'.repeat(64) };
    assert.equal(renderSessionPage(session, earlier, options), renderSessionPage(session, report, options), 'the page');
    assert.equal(renderReportMarkdown(session, earlier, {}), renderReportMarkdown(session, report, {}), 'the .md');
    // D155's count reads the existence check alone, in either record.
    const unexecuted = (r) => { const copy = structuredClone(r); delete copy.counts.rechecksUnexecuted;
      copy.windowResults[0].recolumn.existence.unexecuted = 1; return rechecksUnexecuted(copy); };
    assert.equal(unexecuted(earlier), unexecuted(report));
    assert.equal(unexecuted(report), 1);
  });

test('W1 A: a choice its existence check does not uphold stays out, and is never re-asked', async (t) => {
  const { session } = await load(t, rows());
  const n = fixture(session);
  for (const [ended, exists] of [['refuted', 'refuted'], ['unsettled', 'uncertain']]) {
    const seen = [];
    const report = await review(session, judgeOf({ seen, first: answer(n, [settledDecision(n)]),
      verdict: verdicts({ exists }) }));
    assert.equal(report.decisions.length, 0, ended);
    assert.deepEqual(record(report), { refuted: 1, existence: counts(RESOLUTION_CHALLENGE_OUTCOMES, { [ended]: 1 }) },
      ended);
    assert.deepEqual(recolumnRequests(seen), [], ended);
    assert.ok(report.windowResults[0].recolumnExistsChallenge.results.length === 1, ended);
  }
});

test('W1 A: a refuted decision that names no column is not asked again; a window with none keeps its record',
  async (t) => {
    const { session } = await load(t, rows());
    const n = fixture(session);
    // No column filed (could not tell): its refutation can only be about the choice itself.
    const seen = [];
    const plainChoice = { ...settledDecision(n), constrainedBy: null };
    const refuted = await review(session, judgeOf({ seen, first: answer(n, [plainChoice]), verdict: verdicts() }));
    assert.equal(refuted.decisions.length, 0);
    assert.ok(!seen.some((request) => /:(exists|recolumn)/.test(request.label)));
    assert.equal(Object.hasOwn(refuted.windowResults[0], 'recolumn'), false);
    // Nothing refuted: no new request and no new record member.
    const upheld = await review(session, judgeOf({ seen, first: answer(n, [settledDecision(n)]),
      verdict: () => 'not-refuted' }));
    assert.equal(upheld.decisions[0].column, 'asked-settled');
    for (const key of ['recolumn', 'recolumnExistsChallenge', 'recolumnChallenge'])
      assert.equal(Object.hasOwn(upheld.windowResults[0], key), false, key);
  });

test('W1 A: in m33-lean the existence check runs on the decide tier\'s passes, on the whole window, and nothing after it',
  async (t) => {
    const { session } = await load(t, rows());
    const n = fixture(session);
    const seen = [];
    const report = await review(session, judgeOf({ seen, first: answer(n, [settledDecision(n)]), verdict: verdicts() }),
      { speedProfile: 'm33-lean' });
    assert.deepEqual(report.decisions.map((d) => [d.column, d.reasons[0]]), [[null, DECISION_COLUMN_REFUTED]]);
    const runs = seen.filter((request) => request.challenge && /^challenge:w1:(exists|recolumn)/.test(request.label));
    // The fix review: the existence check runs on the decide tier's passes, on the whole window (fix-review-existence).
    assert.deepEqual(runs.map((request) => request.label), ['challenge:w1:exists:b1:p1', 'challenge:w1:exists:b1:p2',
      'challenge:w1:exists:b1:p3']);
    assert.deepEqual(runs.map((request) => request.system.includes(SESSION_DOSSIER_NOTE)), [false, false, false]);
    assert.deepEqual(recolumnRequests(seen), []);
  });
