// D88 (owner decision 2026-10-14, amending D71 S2's "every row short of done points attention"): the review leads with
// the agent's judgment and the settled problems. The rows Sonah could not check are folded into one collapsed section,
// "What Sonah could not check (N)", last, listed in full and never counted in the attention summary, which carries one
// plain line saying how many and where. One closed definition (review.js ATTENTION_ROWS, FOLDED_ROWS) for the PR
// comment. D97: the page, the report .md (the story since /32) and the CLI no longer have the attention summary or the
// folded checklist (the report model's tiers, its count line and its What Sonah could not check replace them, and its
// placement test lists every row once: report-model.test.js, report-placement.test.js, report-md.test.js,
// report-output.test.js), and review.md is deleted, so these tests read the PR comment's counting. Every session and
// report here is synthetic.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ATTENTION_ROWS, FOLDED_ROWS, ATTENTION_WORDS, FOLDED_SECTION_WORDS, ASK_ROW_KINDS, DECISION_ROW_KINDS,
  askRowKind, claimRowKind, failureRowKind, writtenRowKind, decisionRowKinds, attentionSummary, attentionLines,
  checklistRowCounts, rowKindCounts, derivedColumn, listedPromises, CHECKLIST_REQUIREMENT_REASON_WORDS, CHECKLIST_FAILURE_REASON_WORDS }
  from '../../evidence/src/review.js';
import { REQUIREMENT_STATUSES, LEGACY_REQUIREMENT_STATUSES, PROMISE_STATUSES, FAILURE_HANDLINGS, WRITTEN_LABELS,
  DECISION_COLUMNS } from '../../evidence/src/ledger.js';
import { requirementRowId, failureRowId } from '../../evidence/src/checklist.js';
import { publicCommentText } from '../../github/index.js';
import { checklistSession, checklistReport } from './session-page-checklist-fixture.js';
import { STORY_KEY } from './session-story-fixture.js';

const receipt = (role, eventId, quote) => ({ role, eventId, quote, sessionKey: STORY_KEY });
const idOf = (c) => `sha256:${c.repeat(64).slice(0, 64)}`;
const shortId = (id) => id.slice('sha256:'.length, 'sha256:'.length + 12);
const unescape = (text) => text.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
  .replace(/&amp;/g, '&');

/** The checklist report with one statement written into a file of each label: one contradicted (counted), one not
 *  checked (folded). Its rows: asks done, not done, partly done and two not checked; claims contradicted (2), confirmed,
 *  resting on a check that never completed and not checked; a choice not to act made without asking you and a decision
 *  of how; failures passed over, not checked and told you about. */
function report() {
  return { ...checklistReport(), codeStatus: 'CLEAN', reviewStatus: 'DECIDE',
    writtenClaims: [
      { id: idOf('7'), text: 'The README names version 3', label: 'contradicted',
        stated: receipt('code', 'W2', 'Version 2.1 of the fetcher.'), contradictedBy: receipt('observation', 'R2-r', 'lint ok') },
      { id: idOf('8'), text: 'The fetcher retries three times', label: 'unverified',
        stated: receipt('code', 'W1', 'return retry(3, () => fetch(url));') },
    ] };
}
/** The folded rows of `report()`: asks not checked 2 (one quoted, code's own row for the unreviewed ask), a claim not
 *  checked, a claim resting on a check that never completed, a failure not checked, a written statement not checked. */
const FOLDED = 6;

test('D88: the closed lists of counted and folded rows, in their order, one definition for every reader', () => {
  // An ask's status never contradicts Sonah's own findings: an ask read done or not checked that a finding of the code
  // review bears on is counted right after the asks shown not done or partly done (ask-code-status.test.js).
  assert.deepEqual(ATTENTION_ROWS, ['notActing', 'unasked', 'chose', 'whetherAsked', 'pivots', 'asksNotDone',
    'asksCodeFinding', 'contradicted', 'codeContradicted', 'passedOver', 'forbidden', 'writtenContradicted', 'codeFindings']);
  assert.deepEqual(FOLDED_ROWS, ['asksNotChecked', 'claimsOpen', 'claimsIncomplete', 'failuresNotChecked', 'writtenOpen']);
  for (const list of [ATTENTION_ROWS, FOLDED_ROWS, ASK_ROW_KINDS, DECISION_ROW_KINDS, FOLDED_SECTION_WORDS,
    FOLDED_SECTION_WORDS.groups]) assert.ok(Object.isFrozen(list));
  assert.equal(ATTENTION_ROWS.filter((kind) => FOLDED_ROWS.includes(kind)).length, 0, 'no kind is both counted and folded');
  // Every counted kind has its words on every reader, under the same key; every folded kind a group heading.
  for (const kind of ATTENTION_ROWS) {
    assert.equal(typeof ATTENTION_WORDS[kind], 'function', kind);
  }
  for (const kind of FOLDED_ROWS) {
    assert.equal(typeof FOLDED_SECTION_WORDS.groups[kind], 'string', kind);
    assert.ok(!Object.hasOwn(ATTENTION_WORDS, kind), `${kind} has no attention words`);
  }
  // A row's kind is read from its closed token only, every member of each vocabulary placed.
  const ask = (status) => askRowKind({ status });
  assert.deepEqual(REQUIREMENT_STATUSES.map(ask), [null, 'asksNotDone', 'asksNotDone', 'asksNotChecked']);
  assert.deepEqual(LEGACY_REQUIREMENT_STATUSES.map(ask), [null, 'asksNotDone', 'asksNotDone']);
  assert.equal(ask('anything else'), null);
  assert.deepEqual(PROMISE_STATUSES.map((status) => claimRowKind({ status })), ['claimsOpen', null, 'claimsIncomplete']);
  assert.equal(claimRowKind({ status: 'anything else' }), 'claimsOpen', 'any other status reads not checked, and folds');
  assert.deepEqual(FAILURE_HANDLINGS.map((handling) => failureRowKind({ handling })),
    [null, null, 'passedOver', 'failuresNotChecked']);
  assert.equal(failureRowKind({ handling: 'anything else' }), 'failuresNotChecked');
  assert.deepEqual(WRITTEN_LABELS.map((label) => writtenRowKind({ label })), ['writtenOpen', 'writtenContradicted']);
  assert.equal(writtenRowKind({ label: 'anything else' }), null);
  const derived = { columnState: 'grounded' };
  assert.deepEqual(DECISION_COLUMNS.map((column) => decisionRowKinds({ column, ...derived })), [[], ['chose'], ['unasked']]);
  assert.deepEqual(decisionRowKinds({ column: null }), ['whetherAsked']);
  assert.deepEqual(decisionRowKinds({ column: 'unasked', notActing: true, ...derived }), ['notActing', 'unasked'],
    'a choice not to act is counted beside its column, as D71 (d) highlights it wherever it is');
  // The judgment-first review (low, one counting): a column counts only when the ledger derived it, as the page's and
  // the story's groups read it (`derivedColumn`); any other is where the review could not tell whether you asked.
  for (const state of [undefined, 'unchecked', 'grounded ', null])
    assert.deepEqual(decisionRowKinds({ column: 'unasked', columnState: state }), ['whetherAsked'], String(state));
  assert.equal(derivedColumn({ column: 'asked-chose', columnState: 'grounded' }), 'asked-chose');
  assert.equal(derivedColumn({ column: 'made up', columnState: 'grounded' }), null);
  for (const value of [null, undefined, 'x', 5, []])
    assert.deepEqual([askRowKind(value), claimRowKind(value), failureRowKind(value), writtenRowKind(value),
      decisionRowKinds(value)], [null, null, null, null, []]);
});

test('D88: the summary counts only the judgment and the settled problems, in the same order on every reader', () => {
  const r = report();
  const counts = checklistRowCounts(r, { contradicted: r.findings, edits: [], codeFindings: [] });
  assert.deepEqual(Object.keys(counts), [...ATTENTION_ROWS, ...FOLDED_ROWS]);
  assert.deepEqual(Object.fromEntries(Object.entries(counts).filter(([, n]) => n > 0)), { notActing: 1, unasked: 1, chose: 1,
    asksNotDone: 2, contradicted: 2, passedOver: 1, writtenContradicted: 1, asksNotChecked: 2, claimsOpen: 1,
    claimsIncomplete: 1, failuresNotChecked: 1, writtenOpen: 1 });
  const { lines, folded } = attentionSummary(r);
  assert.deepEqual(lines, [ATTENTION_WORDS.notActing(1), ATTENTION_WORDS.unasked(1), ATTENTION_WORDS.chose(1),
    ATTENTION_WORDS.asksNotDone(2), ATTENTION_WORDS.contradicted(2), ATTENTION_WORDS.passedOver(1),
    ATTENTION_WORDS.writtenContradicted(1)]);
  assert.deepEqual(attentionLines(r), lines);
  assert.equal(folded, ATTENTION_WORDS.folded(FOLDED));
  assert.equal(folded, `${FOLDED} items that Sonah could not check: see What Sonah could not check.`);
  // Nothing Sonah could not check is counted where your attention is needed, on any reader.
  const NOT_CHECKED = /not checked against|never completed|check that did not finish|could not check what the agent did|not shown done/;
  for (const line of lines) assert.doesNotMatch(line, NOT_CHECKED);
  // The PR comment: the same lines, then the plain line after them.
  const { summary } = publicCommentText(r);
  const plain = (text) => text.replace(/\\(.)/g, '$1').replace(/&#64;/g, '@');
  const at = lines.map((line) => plain(summary).indexOf(line.split('**').join('')));
  assert.ok(at.every((i) => i > 0) && at.every((i, k) => k === 0 || i > at[k - 1]), 'every line, in order');
  assert.ok(plain(summary).indexOf(folded) > at.at(-1), 'the plain line comes after the counted lines');
  assert.doesNotMatch(plain(summary), NOT_CHECKED);
});

test('D88: with nothing folded no plain line is added; with nothing counted the summary still says it lists nothing', () => {
  const r = report();
  const settled = { ...r, requirements: r.requirements.filter((row) => row.status !== 'not-checked'),
    promises: r.promises.filter((p) => p.status === 'verified'), failures: r.failures.filter((f) => f.handling !== 'not-checked'),
    writtenClaims: r.writtenClaims.filter((w) => w.label === 'contradicted') };
  assert.equal(attentionSummary(settled).folded, null);
  // Only folded rows: no line is counted, so the summary says it lists nothing, then the plain line.
  const onlyFolded = { ...r, decisions: [], findings: [], requirements: r.requirements.filter((row) => row.status === 'not-checked'),
    promises: r.promises.filter((p) => p.status !== 'verified'), failures: r.failures.filter((f) => f.handling === 'not-checked'),
    writtenClaims: r.writtenClaims.filter((w) => w.label !== 'contradicted') };
  const { lines, folded } = attentionSummary(onlyFolded);
  assert.deepEqual([lines, folded], [[], ATTENTION_WORDS.folded(FOLDED)]);
});

// ---- the judgment-first review (low findings) --------------------------------------------------------------------------

test('judgment-first review (low): every reader counts with the one counting, the page included — the reviewer\'s two probes', () => {
  // (1) A claim a contradicted-claim finding still cites, which a producer left among the claims: no reader lists it
  // as a claim (C-06 M33 G3). (2) A decision whose column the ledger did not derive: every reader counts it where the
  // review could not tell whether you asked, as the page's groups place it.
  const base = report();
  const cited = { ...base.promises[1], id: idOf('9'), stated: base.findings[0].receipts[0], text: 'SYNTHETIC_CITED_CLAIM' };
  const r = { ...base, promises: [...base.promises, cited],
    decisions: base.decisions.map((d, i) => (i === 0 ? { ...d, columnState: 'unchecked' } : d)) };
  assert.deepEqual(listedPromises(r).map((p) => p.id), base.promises.map((p) => p.id));
  const { lines, folded, counts } = attentionSummary(r);
  assert.equal(folded, ATTENTION_WORDS.folded(FOLDED), 'the cited claim is folded nowhere');
  assert.equal(counts.whetherAsked, 1);
  assert.equal(counts[DECISION_ROW_KINDS[base.decisions[0].column]], 0, 'its column is not counted');
  assert.deepEqual(rowKindCounts({ decisions: r.decisions, promises: listedPromises(r) }).whetherAsked, 1);
  const kinds = ATTENTION_ROWS.filter((kind) => counts[kind] > 0);
  assert.ok(kinds.includes('whetherAsked'));
  assert.equal(lines.length, kinds.length);
});

// ---- the agentic code step (D90) ------------------------------------------------------------------------------------

/** The agentic code step's report joined to the checklist report: two published findings, one that follows
 *  from the first ask and one from no row, an open question and three withheld items — and, as an earlier report kept
 *  them, a statement found to hold and the third withheld item a statement (shown nowhere since the cleanup). */
function withCodeStep(r) {
  const at = (path, line) => ({ path, side: 'new', startLine: line, endLine: line });
  const finding = (id, title, leadsFrom) => ({ id: idOf(id), origin: 'code-review', status: 'DECIDE', scope: 'current-code',
    kind: 'bug', lens: 'behaviour', foundByLenses: ['behaviour'], title, claims: [], input: 'x', trace: [],
    anchor: at('src/fetch.js', 2), leadsFrom, receipts: [], check: { verdict: 'holds', explanation: 'SYNTHETIC traced.' } });
  return { ...r, codePass: { ran: true, coverage: 'complete', files: [], gaps: [], footer: [],
    findings: [finding('a', 'SYNTHETIC_CODE_FINDING_ONE', [{ key: 'S1', kind: 'ask', source: 'requirements', index: 0 }]),
      finding('b', 'SYNTHETIC_CODE_FINDING_TWO', [])],
    held: [{ id: 'H1', statement: 'SYNTHETIC_HELD', concerns: { key: 'S1', kind: 'ask', source: 'requirements', index: 0 },
      receipts: [], check: { verdict: 'holds', explanation: 'SYNTHETIC held.' } }],
    questions: [{ id: 'Q1', question: 'SYNTHETIC_QUESTION?', from: 'review', concerns: null }],
    withheld: ['finding', 'finding', 'held'].map((what, k) => ({ what, reason: 'verify_refuted',
      text: `SYNTHETIC_WITHHELD_${k}`, kind: 'bug', check: { verdict: 'refuted', reason: 'incorrect', explanation: 'no' } })) } };
}

test('D88 with the agentic code step: one counting on every reader — its published findings only, never what held, a question or what its check withheld', () => {
  const base = report();
  const r = withCodeStep(base);
  const bare = { ...r, codePass: { ...r.codePass, held: [], questions: [], withheld: [] } };
  const none = { ...r, codePass: { ...r.codePass, findings: [] } };
  const counts = checklistRowCounts(r);
  assert.equal(counts.codeFindings, 2);
  assert.deepEqual(checklistRowCounts(bare), counts, 'held, questions and withheld items move no count');
  assert.equal(checklistRowCounts(none).codeFindings, 0, 'two withheld findings are no findings of the code review');
  const { lines, folded } = attentionSummary(r);
  assert.ok(lines.includes(ATTENTION_WORDS.codeFindings(2)));
  assert.equal(folded, ATTENTION_WORDS.folded(FOLDED), 'nothing withheld is folded under What Sonah could not check');
  assert.deepEqual(attentionSummary(bare), attentionSummary(r));
  assert.equal(publicCommentText(bare).summary, publicCommentText(r).summary);
});
