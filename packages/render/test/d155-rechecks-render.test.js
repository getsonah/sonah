// D155, in the readers: a review that left decisions out because their second check did not run says how many, and the
// remedy, in What Sonah could not check — on the page and in the Markdown report, whole also when that fold's lists are
// shortened to counts. A review whose second checks all ran shows the same bytes as before: nothing is said of them.
// The fix round: the review's own count by identity (`report.counts.rechecksUnexecuted`) is the one said; a report
// written before it is counted from its windows' records. Only this uncapped cause is said whole, never
// `results_seen_in_part`.
//
// Synthetic reports only (report-fixture.js). Nothing prints.
import test from 'node:test';
import assert from 'node:assert/strict';
import { reportModel } from '../report-model.js';
import { sessionPage, escapeHtml } from '../session-page.js';
import { renderReportMarkdown } from '../session-story.js';
import { REPORT_SECTION_WORDS, REPORT_TRIM_WORDS, REPORT_NOT_CHECKED_WORDS } from '../report-words.js';
import { COVERAGE_SENTENCE } from '../../evidence/src/review.js';
import { RESOLUTION_CHALLENGE_OUTCOMES } from '../../evidence/src/ledger.js';
import { reportSession, sessionOnlyReport, triagedReport, repoFacts } from './report-fixture.js';

const outcomes = (unexecuted) => Object.fromEntries(RESOLUTION_CHALLENGE_OUTCOMES.map((outcome) => [outcome,
  outcome === 'unexecuted' ? unexecuted : outcome === 'refuted' ? 1 : 0]));
/** A second check's run record that asking again can run: one batch, three passes, every call planned. */
const RUN = Object.freeze({ plannedBatches: 1, plannedCalls: 3, profile: Object.freeze({ passes: 3 }) });
/** The report with its first window's records holding a second check that ended `unexecuted` for `recolumn` decisions
 *  (W1 A) and `reanchor` choices (G2) — counts only, as the window records keep them — and, with `stated`, the review's
 *  own count by identity, as a review since D155's fix round states it. */
const withRechecks = (report, { recolumn = 0, reanchor = 0, stated } = {}) => ({ ...report,
  ...(stated === undefined ? {} : { counts: { ...report.counts, rechecksUnexecuted: stated } }),
  windowResults: report.windowResults.map((window, i) => ({ ...window,
    ...(i === 0 ? { recolumn: { refuted: recolumn + 1, existence: outcomes(recolumn), asked: 0 },
      recolumnExistsChallenge: RUN, reanchor: { refuted: 1, asked: 1, existence: outcomes(reanchor) },
      reanchorExistsChallenge: RUN } : {}) })) });
const textOf = (parts) => parts.map((p) => (p.quote ? `“${p.text}”` : p.text)).join('');
const said = (n) => `${COVERAGE_SENTENCE.rechecks_unexecuted({ n })[0].toUpperCase()}`
  + `${COVERAGE_SENTENCE.rechecks_unexecuted({ n }).slice(1)}.`;

test('D155 What Sonah could not check says how many decisions the second check left out, and the remedy', () => {
  const session = reportSession();
  for (const shape of [sessionOnlyReport, triagedReport]) {
    const before = shape(session);
    const report = withRechecks(before, { recolumn: 2, reanchor: 1 });
    const model = reportModel(session, report, repoFacts());
    const facts = model.notChecked.facts.filter((f) => textOf(f.parts) === said(3));
    assert.equal(facts.length, 1, shape.name);
    assert.equal(facts[0].group, 'session');
    assert.equal(facts[0].cause, true, 'said whole when the fold is shortened, as a capping cause is');
    // One fact more, and nothing else in the model moves.
    const plain = reportModel(session, before, repoFacts());
    assert.equal(model.notChecked.facts.length, plain.notChecked.facts.length + 1);
    assert.deepEqual(model.notChecked.facts.filter((f) => f !== facts[0]), plain.notChecked.facts);
    assert.deepEqual(model.header, plain.header, `${shape.name}: the header and its status stay`);
    assert.deepEqual(model.tiers, plain.tiers, `${shape.name}: no item moves`);
    // The page and the Markdown report: the line, and the fold's count one higher.
    const md = renderReportMarkdown(session, report, repoFacts());
    assert.ok(md.includes(`\n- ${said(3)}\n`), `${shape.name}: md`);
    assert.ok(md.includes(REPORT_SECTION_WORDS.notCheckedCounted(plain.notChecked.total + 1)), shape.name);
    const { html } = sessionPage(session, report, repoFacts());
    assert.ok(html.includes(escapeHtml(said(3))), `${shape.name}: page`);
    // The review's own count by identity, when it states one, is the count said.
    const stated = reportModel(session, withRechecks(before, { recolumn: 2, reanchor: 1, stated: 1 }), repoFacts());
    assert.equal(stated.notChecked.facts.filter((f) => textOf(f.parts) === said(1)).length, 1, shape.name);
    assert.equal(stated.notChecked.facts.some((f) => textOf(f.parts) === said(3)), false, shape.name);
  }
});

test('D155 a review whose second checks all ran shows the same bytes as before', () => {
  const session = reportSession();
  for (const shape of [sessionOnlyReport, triagedReport]) {
    const before = shape(session);
    // Every check ran; or the only one that did not was of a decision another window kept (the review states 0).
    for (const ran of [withRechecks(before, { recolumn: 0, reanchor: 0 }),
      withRechecks(before, { recolumn: 1, stated: 0 })]) {
      assert.equal(renderReportMarkdown(session, ran, repoFacts()), renderReportMarkdown(session, before, repoFacts()),
        shape.name);
      assert.equal(sessionPage(session, ran, repoFacts()).html, sessionPage(session, before, repoFacts()).html,
        shape.name);
    }
  }
});

test('D155 a shortened Markdown report still says the line whole, and only it of the uncapped causes', () => {
  // A report shortened past the step that cuts the lists of What Sonah could not check to counts (d133-quiet-gaps).
  const session = reportSession();
  const r = triagedReport(session);
  const d = r.decisions.find((x) => x.dimension === 'limit per client');
  const w = r.codePass.withheld[0];
  const big = { ...r, decisions: [...r.decisions, ...Array.from({ length: 100 }, (_, i) => ({ ...d,
    dimension: `${d.dimension} ${i}`, chosen: `${d.chosen} ${i} ${'x'.repeat(200)}` }))],
  codePass: { ...r.codePass, withheld: [...r.codePass.withheld, ...Array.from({ length: 100 }, (_, i) => ({ ...w,
    text: `${w.text} ${i} ${'y'.repeat(200)}` }))] } };
  // With the results the session review saw only in part too: an uncapped cause that is counted, not said whole.
  const both = { ...withRechecks(big, { recolumn: 1, stated: 1 }),
    coverageFacts: { ...big.coverageFacts, resultsSeenInPart: 2 } };
  const seen = `${COVERAGE_SENTENCE.results_seen_in_part({ n: 2 })[0].toUpperCase()}`
    + `${COVERAGE_SENTENCE.results_seen_in_part({ n: 2 }).slice(1)}.`;
  const facts = reportModel(session, both, {}).notChecked.facts;
  assert.equal(facts.find((f) => textOf(f.parts) === said(1))?.cause, true, 'said whole');
  assert.equal(Object.hasOwn(facts.find((f) => textOf(f.parts) === seen) ?? {}, 'cause'), false,
    'premise: the other uncapped cause is in the fold, and not marked');
  const md = renderReportMarkdown(session, both, {});
  assert.ok(md.includes(REPORT_TRIM_WORDS.mdShortened), 'premise: the report is shortened');
  const fold = md.slice(md.indexOf(`#### ${REPORT_NOT_CHECKED_WORDS.sessionReview}`));
  assert.match(fold, /Sonah does not show \d+ more of this list here\./, 'premise: the fold\'s lists are counts');
  assert.ok(fold.includes(`\n- ${said(1)}\n`), 'the line, whole');
  assert.equal(fold.includes(seen), false, 'the results seen in part are counted, not said');
  // The same report not shortened says both.
  const whole = renderReportMarkdown(session, { ...withRechecks(r, { recolumn: 1, stated: 1 }),
    coverageFacts: { ...r.coverageFacts, resultsSeenInPart: 2 } }, {});
  assert.ok(whole.includes(`\n- ${said(1)}\n`) && whole.includes(`\n- ${seen}\n`));
});
