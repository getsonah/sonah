// D189 (0.3.0-beta.11; the owner, 2026-10-30: "Name the source"): the reason the session review's check gave for an ask
// done only in part (D185) is labelled "Its check, in the session review's words:", in D163's form, so it never reads as
// the code review's check line, which keeps "Its check:". Synthetic records; structure and provenance only.
import test from 'node:test';
import assert from 'node:assert/strict';
import { reportModel, reportItems } from '../report-model.js';
import { renderSessionPage, escapeHtml as esc } from '../session-page.js';
import { renderReportMarkdown } from '../session-story.js';
import { REPORT_ITEM_WORDS } from '../report-words.js';
import { triageSession, triageReport, truthOnlyReport, ROWS } from '../../evidence/test/report-triage-fixture.js';

const WHY = 'SYNTHETIC the retry wait ignores the timeout the ask names.';
/** The triage fixture's report (`make`: before the premise contract, or under it and the tie rule), with one window whose
 *  check upheld its ask done only in part (D185's match). */
function bothChecks(make = triageReport) {
  const session = triageSession();
  const report = make(session);
  const row = report.requirements[ROWS.askTimeout];
  assert.equal(row.status, 'partly-done', 'premise: an ask done only in part');
  const result = { type: 'requirement', survived: true, candidate: { text: row.text, status: row.status,
    instruction: row.instruction, deliverable: row.deliverable, shortfall: row.shortfall },
  votes: [{ pass: 1, valid: true, verdict: 'not-refuted', explanation: WHY }] };
  report.windowResults = [{ windowIndex: 0, eventIds: session.events.map((e) => e.id), failure: null,
    groundingComplete: true, challenge: { complete: true, results: [result] } }];
  return { session, report };
}
const lines = (model, label) => reportItems(model).flatMap((item) => [item, ...(item.members ?? [])])
  .flatMap((item) => item.evidence.filter((e) => e.label === label).map((e) => ({ kind: item.kind, by: e.parts.map((p) => p.by) })));

test('D189: the session review\'s check line has its own label; the code review\'s keep "Its check:"', () => {
  for (const make of [triageReport, truthOnlyReport]) {
    const { session, report } = bothChecks(make);
    const model = reportModel(session, report, {});
    const review = lines(model, REPORT_ITEM_WORDS.checkReview);
    assert.deepEqual(review, [{ kind: 'ask_partly_done', by: ['session-review'] }], make.name);
    const code = lines(model, REPORT_ITEM_WORDS.check);
    assert.ok(code.some((line) => line.kind.startsWith('code_')), `${make.name}: premise: the code review's check lines`);
    // Under "Its check:" only the code review's words or Sonah's own, never the session review's.
    for (const line of code) {
      assert.ok(!line.by.includes('session-review'), line.kind);
      assert.notEqual(line.kind, 'ask_partly_done');
    }
  }
  const { session, report } = bothChecks();
  const page = renderSessionPage(session, report, {}), md = renderReportMarkdown(session, report, {});
  assert.ok(page.includes(`<span class="label">${esc(REPORT_ITEM_WORDS.checkReview)}</span> <em class="by-session-review">`
    + `${esc(WHY)}</em>`));
  assert.ok(md.includes(`${REPORT_ITEM_WORDS.checkReview} *${WHY}*`));
  // The code review's line on both readers, as before.
  assert.ok(page.includes(`<span class="label">${esc(REPORT_ITEM_WORDS.check)}</span>`));
  assert.ok(md.includes(`${REPORT_ITEM_WORDS.check} `));
  // The session review's words never follow the code review's label.
  assert.ok(!page.includes(`<span class="label">${esc(REPORT_ITEM_WORDS.check)}</span> <em class="by-session-review">`));
  assert.ok(!md.includes(`${REPORT_ITEM_WORDS.check} *${WHY}*`));
});

test('D189: the label names the session review, in D163\'s form', () => {
  assert.equal(REPORT_ITEM_WORDS.checkReview, "Its check, in the session review's words:");
  assert.equal(REPORT_ITEM_WORDS.reviewWhy.replace(/^Why it changed/, 'Its check'), REPORT_ITEM_WORDS.checkReview);
  assert.notEqual(REPORT_ITEM_WORDS.checkReview, REPORT_ITEM_WORDS.check);
});
