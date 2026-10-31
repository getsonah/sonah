// D191 (0.3.0-beta.11; the owner, 2026-10-30: "Cannot-tell open finding"): an open code finding (D152) says that Sonah
// found nothing it breaks, no ask or claim among them, only when no window of the session review failed (its first call
// failed or was not sent). The code review's asks and claims are the session review's rows, and a failed window gave
// none of its part, so beside any failed window (every class, mixed classes, all windows or some) the line says what
// Sonah cannot tell instead. What its check quotes of the repository (a doc, a caller, a test) is said as before.
// Synthetic records; structure only: the closed failure codes.
import test from 'node:test';
import assert from 'node:assert/strict';
import { reportModel, reportItems } from '../report-model.js';
import { renderSessionPage } from '../session-page.js';
import { renderReportMarkdown } from '../session-story.js';
import { REPORT_KIND_WORDS, REPORT_TIER_WHY } from '../report-words.js';
import { CODE_REPORT_WORDS as W } from '../../evidence/src/code-report.js';
import { WINDOW_FAILURE_CODES, WINDOW_FAILURE_CLASS, sessionCallsFact } from '../../evidence/src/run-review.js';
import { triageSession, truthOnlyReport, OPEN_ID } from '../../evidence/test/report-triage-fixture.js';

const textOf = (parts) => parts.map((p) => (p.quote ? `“${p.text}”` : p.text)).join('');
const unescape = (html) => html.replace(/&#39;/g, '\'').replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/&amp;/g, '&');
/** The fixture's report with its events split over two window records, failed as given (null: answered). */
function withWindows(session, failures) {
  const report = truthOnlyReport(session);
  const ids = session.events.map((e) => e.id), half = Math.ceil(ids.length / 2);
  report.windowResults = failures.map((failure, windowIndex) => ({ windowIndex,
    eventIds: windowIndex === 0 ? ids.slice(0, half) : ids.slice(half), failure, groundingComplete: failure === null,
    challenge: failure === null ? { complete: true, results: [] } : null }));
  if (failures.some((f) => f !== null)) report.sessionReview = 'incomplete';
  return report;
}
const openLines = (session, report) => {
  const model = reportModel(session, report, {});
  const opens = reportItems(model).filter((item) => item.kind === 'code_finding_open');
  return { model, opens, first: opens.map((item) => textOf(item.evidence[0].parts)) };
};

test('D191: with no failed window, an open finding says what Sonah found, as before', () => {
  const session = triageSession();
  for (const failures of [[], [null, null]]) {
    const report = withWindows(session, failures);
    const { opens, first } = openLines(session, report);
    assert.ok(opens.some((item) => item.rowId === OPEN_ID), 'premise: the open finding is an item');
    assert.deepEqual([...new Set(first)], [W.openFinding]);
  }
  // A record whose `failure` is outside the closed list is no failed window (membership, never text).
  const odd = withWindows(session, ['model unavailable', null]);
  assert.deepEqual([...new Set(openLines(session, odd).first)], [W.openFinding]);
});

test('D191: beside a failed window of the session review, every class, all windows or some, the cannot-tell line', () => {
  const session = triageSession();
  for (const code of WINDOW_FAILURE_CODES) for (const failures of [[code, code], [code, null], [null, code]]) {
    const report = withWindows(session, failures);
    const { opens, first } = openLines(session, report);
    assert.ok(opens.length > 0, code);
    assert.deepEqual([...new Set(first)], [W.openFindingCannotTell], `${code} ${failures}`);
    const page = unescape(renderSessionPage(session, report, {}));
    const md = renderReportMarkdown(session, report, {});
    for (const text of [page, md]) {
      assert.ok(text.includes(W.openFindingCannotTell), code);
      assert.ok(!text.includes(W.openFinding), code);
    }
  }
});

// Fix round: failed windows of two classes at once (no one class, `sessionCallsFact(...).cls` null) give the line too:
// every ordered pair of codes whose classes differ, on the model, the page and the .md.
test('D191: failed windows of mixed classes, every pair of codes, the cannot-tell line', () => {
  const session = triageSession();
  const pairs = new Set();
  for (const a of WINDOW_FAILURE_CODES) for (const b of WINDOW_FAILURE_CODES) {
    if (WINDOW_FAILURE_CLASS[a] === WINDOW_FAILURE_CLASS[b]) continue;
    const report = withWindows(session, [a, b]);
    const fact = sessionCallsFact(report.windowResults);
    assert.deepEqual([fact.failed, fact.cls], [2, null], `premise: two failed windows, mixed classes: ${a} ${b}`);
    const { opens, first } = openLines(session, report);
    assert.ok(opens.length > 0, `${a} ${b}`);
    assert.deepEqual([...new Set(first)], [W.openFindingCannotTell], `${a} ${b}`);
    const page = unescape(renderSessionPage(session, report, {}));
    const md = renderReportMarkdown(session, report, {});
    for (const text of [page, md]) {
      assert.ok(text.includes(W.openFindingCannotTell), `${a} ${b}`);
      assert.ok(!text.includes(W.openFinding), `${a} ${b}`);
    }
    pairs.add(`${WINDOW_FAILURE_CLASS[a]} ${WINDOW_FAILURE_CLASS[b]}`);
  }
  assert.equal(pairs.size, 6, 'every ordered pair of the three classes');
});

test('D191: the line and the kind\'s words claim no search over asks or claims that Sonah did not have', () => {
  const session = triageSession();
  const report = withWindows(session, ['model_unavailable', 'model_timeout']);
  const { opens } = openLines(session, report);
  // The tier sentence keeps the kind's words: what Sonah did (it tied the finding to nothing), true in every case.
  const open = opens.find((item) => item.rowId === OPEN_ID);
  assert.equal(open.why, REPORT_TIER_WHY.bounded('high', REPORT_KIND_WORDS.code_finding_open, 'Must act'));
  // The cannot-tell line keeps the repository's part of the open line, and drops its asks and claims.
  assert.ok(W.openFinding.startsWith('Checked: the code does this.') && W.openFindingCannotTell.startsWith('Checked: the code does this.'));
  assert.ok(W.openFindingCannotTell.includes('doc, caller or test'));
  assert.ok(!/no ask|no claim|ask, claim/.test(W.openFindingCannotTell));
});
