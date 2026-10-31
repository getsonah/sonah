// D152 (0.3.0-beta.9): the readers of the truth-only check. A confirmed code finding tied to nothing it breaks is an item
// of its own kind (`code_finding_open`: Decide, Good to know by default, never Must act), checked, its evidence led by the
// line that Sonah found nothing it breaks; a finding tied by a receipt of what it breaks alone keeps its kind's tier; the
// paragraph on how the code review works said that the check judges truth only (D199: no reader says that paragraph any
// more); and with only open findings published, no line says that the code review published none. The report is the
// triage contract's fixture (h).
import test from 'node:test';
import assert from 'node:assert/strict';
import { reportModel, reportItems } from '../report-model.js';
import { renderSessionPage } from '../session-page.js';
import { renderReportMarkdown } from '../session-story.js';
import { REPORT_KIND_WORDS, REPORT_TIER_WHY } from '../report-words.js';
import { CODE_REPORT_WORDS as W } from '../../evidence/src/code-report.js';
import { triageSession, truthOnlyReport, premiseReport, OPEN_ID, BREAKS_TIED_ID }
  from '../../evidence/test/report-triage-fixture.js';

const TIERS = ['must_act', 'must_know', 'good_to_know'];
const itemsOf = (model) => reportItems(model);
const textOf = (parts) => parts.map((p) => (p.quote ? `“${p.text}”` : p.text)).join('');
// D199: the words were removed; as literals (the first sentence of the paragraph on how the code review works, the same
// in D109's `how` and in its tie-rule form `howTied`).
const OLD_HOW_LEAD = 'Sonah asked for a review of the change as a code reviewer reviews a pull request';
const unescape = (html) => html.replace(/&#39;/g, '\'').replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/&amp;/g, '&');

test('D152: an open finding is an item of its own kind, checked, its first line saying that Sonah found nothing it breaks', () => {
  const session = triageSession();
  const report = truthOnlyReport(session);
  const model = reportModel(session, report, {});
  const items = itemsOf(model);
  const open = items.find((item) => item.rowId === OPEN_ID);
  assert.ok(open, 'the open finding is an item');
  assert.deepEqual([open.kind, open.type, open.rows[0].source], ['code_finding_open', 'decide', 'codePass.open']);
  // Its proposal of high is bounded by the kind's ceiling: Must know, and the why line says so (the model's; D199: no
  // reader prints it).
  assert.deepEqual([open.tier.default, open.tier.proposed, open.tier.final, open.tier.bound],
    ['good_to_know', 'must_act', 'must_know', 'kind_ceiling']);
  assert.equal(open.why, REPORT_TIER_WHY.bounded('high', REPORT_KIND_WORDS.code_finding_open, 'Must act'));
  assert.equal(textOf(open.evidence[0].parts), W.openFinding);
  assert.equal(textOf(open.what.parts), 'The wait is fixed, not read from the server');
  assert.deepEqual(open.where.map((w) => [w.path, w.startLine]), [['src/retry.js', 7]]);
  // The weak test, tied by the doc line it breaks alone, keeps its kind; no item is a question from a finding.
  assert.equal(items.find((item) => item.rowId === BREAKS_TIED_ID).kind, 'code_weak_test');
  assert.ok(!items.some((item) => item.kind === 'code_question_finding'));
  // D199 (the owner, 2026-10-30, "All of them"): the code section holds no paragraph on how the code review works.
  const code = model.notChecked.code.map(textOf);
  assert.ok(!code.some((line) => line.includes(OLD_HOW_LEAD)), JSON.stringify(code));
  // The page and the .md show the open finding with its line; neither says the paragraph or the why line.
  const page = unescape(renderSessionPage(session, report, {}));
  const md = renderReportMarkdown(session, report, {});
  for (const text of [page, md]) {
    assert.ok(text.includes('The wait is fixed, not read from the server'));
    assert.ok(text.includes(W.openFinding));
    assert.ok(!text.includes(OLD_HOW_LEAD));
    assert.ok(!text.includes(open.why), open.why);
  }
});

test('D152: a report before the tie rule reads as it was written — no open item (D199: and no paragraph of its day)', () => {
  const session = triageSession();
  const model = reportModel(session, premiseReport(session), {});
  assert.ok(!itemsOf(model).some((item) => item.kind === 'code_finding_open'));
  assert.ok(itemsOf(model).some((item) => item.kind === 'code_question_finding'), 'its routed question stands');
  const code = model.notChecked.code.map(textOf);
  // D199: neither paragraph on how the code review works.
  assert.ok(!code.some((line) => line.includes(OLD_HOW_LEAD)), JSON.stringify(code));
});

test('D152: with only open findings published, no line says that the code review published none', () => {
  const session = triageSession();
  const base = truthOnlyReport(session);
  const onlyOpen = { ...base, codePass: { ...base.codePass, findings: [], unconfirmed: [],
    open: [...base.codePass.open, ...base.codePass.findings.map((f) => ({ ...f, leadsFrom: [],
      check: { ...f.check, breaks: [] } }))] } };
  const model = reportModel(session, onlyOpen, {});
  const code = model.notChecked.code.map(textOf);
  assert.ok(!code.some((line) => line.startsWith(W.noFindings.slice(0, -1)) || line === W.proposedNone),
    JSON.stringify(code));
  assert.ok(itemsOf(model).filter((item) => item.kind === 'code_finding_open').length >= 2);
});
