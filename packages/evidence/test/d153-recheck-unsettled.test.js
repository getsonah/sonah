// D153 (the owner, 2026-10-26, and its fix round): the one rule every reader reads for an accusing row the after-point
// re-check reaffirmed or left unsettled (triage.js `unsettledRow`), by closed tokens only: which rows it holds, which of
// them a later window checked (`laterChecked`), the kind every reader and the code review's dossier name them by, and the
// attention counts. Pure rows only.
import test from 'node:test';
import assert from 'node:assert/strict';
import { unsettledRow, unsettledAsk, laterChecked, itemKindOf, SHOWN_NOT_CHECKED_LATER } from '../src/triage.js';
import { RECHECK_OUTCOMES, REQUIREMENT_STATUSES, LEGACY_REQUIREMENT_STATUSES, WRITTEN_LABELS, DISCLOSURE_REASONS }
  from '../src/ledger.js';
import { askRowKind, writtenRowKind, checklistRowCounts, attentionSummary, ATTENTION_WORDS, ATTENTION_ROWS, FOLDED_ROWS,
  LATER_WORK_ROW } from '../src/review.js';

const R = (eventId, role, quote) => ({ eventId, role, quote });
const ASK = { text: 'x', instruction: R('I1', 'instruction', 'fix it'), shortfall: R('C1', 'commentary', 'not yet') };
const CLAIM = { id: 'c'.repeat(16), kind: 'claim_contradicted', status: 'DECIDE', explanation: 'x',
  receipts: [R('C1', 'commentary', 'All tests pass.'), R('A1-r', 'observation', 'not ok 1')] };
const WRITTEN = { id: 'w'.repeat(16), text: 'x', label: 'contradicted', stated: R('WR1', 'code', 'It works.'),
  receipts: [R('WR1', 'code', 'It works.'), R('A1-r', 'observation', 'not ok 1')] };
const at = (row, outcome) => (outcome === undefined ? row : { ...row, recheck: { outcome } });

test('D153: the outcomes shown with no accusing word, closed', () => {
  assert.deepEqual(SHOWN_NOT_CHECKED_LATER, ['reaffirmed', 'not_checked_after_later_work']);
  assert.ok(Object.isFrozen(SHOWN_NOT_CHECKED_LATER));
  for (const outcome of SHOWN_NOT_CHECKED_LATER) assert.ok(RECHECK_OUTCOMES.includes(outcome));
});

test('D153: `unsettledRow` — an accusing row of each kind, reaffirmed or left unsettled; nothing else', () => {
  const accusing = ['not-done', 'partly-done', 'open', 'partly-addressed'];
  for (const outcome of [undefined, ...RECHECK_OUTCOMES]) {
    const shown = SHOWN_NOT_CHECKED_LATER.includes(outcome);
    for (const status of [...REQUIREMENT_STATUSES, ...LEGACY_REQUIREMENT_STATUSES])
      assert.equal(unsettledRow('requirements', at({ ...ASK, status }, outcome)), shown && accusing.includes(status),
        `${status} ${outcome}`);
    assert.equal(unsettledRow('findings', at(CLAIM, outcome)), shown, `claim ${outcome}`);
    for (const label of WRITTEN_LABELS)
      assert.equal(unsettledRow('writtenClaims', at({ ...WRITTEN, label }, outcome)), shown && label === 'contradicted',
        `${label} ${outcome}`);
    assert.equal(unsettledAsk(at({ ...ASK, status: 'not-done' }, outcome)), shown);
    // A later window checked it: reaffirmed, or a claim with a later RESULT kept beside it.
    assert.equal(laterChecked('requirements', at({ ...ASK, status: 'not-done' }, outcome)), outcome === 'reaffirmed');
    assert.equal(laterChecked('findings', at(CLAIM, outcome)), outcome === 'reaffirmed');
    const recontradicted = { ...CLAIM, recheck: { outcome, window: 3, later: { observation: R('A3-r', 'observation',
      'not ok 1') } } };
    assert.equal(laterChecked('findings', recontradicted), shown, `later RESULT ${outcome}`);
    assert.equal(laterChecked('requirements', { ...ASK, status: 'not-done', recheck: recontradicted.recheck }),
      outcome === 'reaffirmed', 'a later RESULT is a claim\'s structure alone');
  }
  const unsettled = 'not_checked_after_later_work';
  // A corrected claim (FYI), the retired route's finding, another finding kind, a corrected statement: none.
  assert.equal(unsettledRow('findings', at({ ...CLAIM, status: 'FYI' }, unsettled)), false);
  assert.equal(unsettledRow('findings', at({ ...CLAIM, origin: 'code-review' }, unsettled)), false);
  assert.equal(unsettledRow('findings', at({ ...CLAIM, kind: 'edit_under_negative_requirement' }, unsettled)), false);
  for (const reason of DISCLOSURE_REASONS)
    assert.equal(unsettledRow('writtenClaims', at({ ...WRITTEN, disclosureReason: reason }, unsettled)), false, reason);
  // Another source, a row that is not an object, a re-check that is not an object.
  assert.equal(unsettledRow('promises', at({ status: 'unverified' }, unsettled)), false);
  assert.equal(unsettledRow('decisions', at({}, unsettled)), false);
  assert.equal(unsettledRow('requirements', null), false);
  assert.equal(unsettledRow('requirements', { ...ASK, status: 'not-done', recheck: 'not_checked_after_later_work' }), false);
});

test('D153: the kind every reader shows, and the code review is sent', () => {
  const cases = [
    ['requirements', { ...ASK, status: 'partly-done' }, 'ask_partly_done'],
    ['requirements', { ...ASK, status: 'not-done' }, 'ask_not_done'],
    ['findings', CLAIM, 'claim_contradicted'],
    ['writtenClaims', WRITTEN, 'written_contradicted'],
  ];
  const shown = { requirements: 'ask_not_checked_after_later_work', findings: 'claim_not_checked_after_later_work',
    writtenClaims: 'written_not_checked_after_later_work' };
  for (const [source, row, recorded] of cases) for (const outcome of [undefined, ...RECHECK_OUTCOMES]) {
    const r = at(row, outcome);
    const unsettled = SHOWN_NOT_CHECKED_LATER.includes(outcome);
    assert.equal(itemKindOf(source, r), unsettled ? shown[source] : recorded, `${source} ${outcome}`);
  }
  assert.equal(itemKindOf('requirements', at({ ...ASK, status: 'done' }, 'moved')), null);
});

test('D153: the attention counts read a reaffirmed or unsettled row as an item that later work followed, never as accusing', () => {
  const report = (outcome, instruction = ASK.instruction) => ({ requirements: [at({ ...ASK, instruction,
    status: 'partly-done' }, outcome)], findings: [at(CLAIM, outcome)], writtenClaims: [at(WRITTEN, outcome)], promises: [],
  decisions: [], pivots: [], failures: [], recheck: {} });
  const parts = (r) => ({ contradicted: r.findings.filter((f) => !unsettledRow('findings', f)),
    notCheckedLater: r.findings.filter((f) => unsettledRow('findings', f)) });
  for (const outcome of [undefined, ...RECHECK_OUTCOMES]) {
    const r = report(outcome);
    const unsettled = SHOWN_NOT_CHECKED_LATER.includes(outcome);
    assert.equal(askRowKind(r.requirements[0], r), unsettled ? 'laterWork' : 'asksNotDone', outcome);
    assert.equal(writtenRowKind(r.writtenClaims[0]), unsettled ? 'laterWork' : 'writtenContradicted', outcome);
    const counts = checklistRowCounts(r, parts(r));
    assert.deepEqual([counts.asksNotDone, counts.contradicted, counts.writtenContradicted],
      unsettled ? [0, 0, 0] : [1, 1, 1], outcome);
    assert.deepEqual([counts.laterWork, counts.asksNotChecked, counts.claimsOpen, counts.writtenOpen],
      unsettled ? [3, 0, 0, 0] : [0, 0, 0, 0], outcome);
    // The attention summary reads the same parts: one line, apart from the rows Sonah could not check.
    const summary = attentionSummary({ ...r, coverage: 'complete' });
    assert.deepEqual(summary.counts, counts, outcome);
    if (unsettled) assert.deepEqual([summary.lines, summary.folded], [[ATTENTION_WORDS.laterWork(3)], null], outcome);
  }
  // A helper's ask (its instruction a helper's brief) is listed with the asks Sonah could not read as yours: folded, as
  // the page lists it.
  const helper = report('not_checked_after_later_work', { ...ASK.instruction, childId: 'w' });
  assert.equal(askRowKind(helper.requirements[0], helper), 'asksNotChecked');
  assert.deepEqual(checklistRowCounts(helper, parts(helper)).laterWork, 2);
  // A report the re-check did not run on counts as it always did: no such kind.
  const { recheck: _none, ...plainReport } = report(undefined);
  assert.equal(Object.hasOwn(checklistRowCounts(plainReport, parts(plainReport)), LATER_WORK_ROW), false);
  assert.deepEqual(Object.keys(attentionSummary(plainReport).counts), [...ATTENTION_ROWS, ...FOLDED_ROWS]);
  assert.deepEqual(Object.keys(attentionSummary(report(undefined)).counts), [...ATTENTION_ROWS, LATER_WORK_ROW,
    ...FOLDED_ROWS]);
});
