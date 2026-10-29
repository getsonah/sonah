// D179 (0.3.0-beta.10): the readers of one finding that several places of the change hold byte for byte (its record's
// `places`, evidence code-pass.js `samePlacesLeads`). The item's Where line names each place after its own anchor (no
// excerpt), cut at REPORT_LIMITS.where with "N more places"; its evidence fold says, in one closed sentence
// (REPORT_ITEM_WORDS.samePlaces), in how many places Sonah read the same bytes of the file; a record without `places`,
// or with one place, reads as before. A note that repeats the key of an earlier note (`triage_key_repeated`: each merged
// copy brings its own; a key the agent repeated in its own list is one too, and the record cannot tell them apart) is
// not counted as a note that failed Sonah's checks. Pure renders of the triage contract's fixture (h).
import test from 'node:test';
import assert from 'node:assert/strict';
import { reportModel, reportItems, REPORT_LIMITS } from '../report-model.js';
import { renderSessionPage } from '../session-page.js';
import { renderReportMarkdown } from '../session-story.js';
import { REPORT_ITEM_WORDS, REPORT_NOT_CHECKED_WORDS } from '../report-words.js';
import { triageSession, truthOnlyReport, OPEN_ID } from '../../evidence/test/report-triage-fixture.js';

const textOf = (parts) => parts.map((p) => (p.quote ? `“${p.text}”` : p.text)).join('');
const unescape = (html) => html.replace(/&#39;/g, '\'').replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/&amp;/g, '&');
const OWN = { path: 'src/retry.js', side: 'new', startLine: 7, endLine: 7 };
const placeIn = (k) => ({ ...OWN, path: `/work/wt-${k}/src/retry.js` });
/** The fixture's open finding (src/retry.js:7) with `places`: its own anchor, then `n - 1` other worktrees'. */
function withPlaces(session, places) {
  const report = truthOnlyReport(session);
  const open = report.codePass.open.map((f) => (f.id === OPEN_ID ? { ...f, places } : f));
  return { ...report, codePass: { ...report.codePass, open } };
}
const itemOf = (session, report) => reportItems(reportModel(session, report, {})).find((i) => i.rowId === OPEN_ID);
const evidenceOf = (item) => item.evidence.map((e) => textOf(e.parts));

test('D179: two places — the Where line names both, the fold says how many; the page and the .md say it', () => {
  const session = triageSession();
  const report = withPlaces(session, [OWN, placeIn('b')]);
  const item = itemOf(session, report);
  assert.deepEqual(item.where.map((w) => [w.path, w.startLine]), [['src/retry.js', 7], ['/work/wt-b/src/retry.js', 7]]);
  assert.ok(item.where[0].excerpt, 'its own place keeps its excerpt');
  assert.equal(item.where[1].excerpt, null, 'another place shows none');
  assert.equal(item.whereMore, 0);
  const sentence = REPORT_ITEM_WORDS.samePlaces(2);
  assert.equal(sentence, 'Sonah read the same bytes of this file in 2 repositories or folders.');
  assert.ok(evidenceOf(item).includes(sentence), JSON.stringify(evidenceOf(item)));
  const page = unescape(renderSessionPage(session, report, {}));
  const md = renderReportMarkdown(session, report, {});
  for (const text of [page, md]) {
    assert.ok(text.includes(sentence));
    assert.ok(text.includes('/work/wt-b/src/retry.js:7'));
  }
});

test('D179: past REPORT_LIMITS.where places, the rest are counted: "N more places"; the fold counts every place', () => {
  const session = triageSession();
  const report = withPlaces(session, [OWN, placeIn('b'), placeIn('c'), placeIn('d'), placeIn('e')]);
  const item = itemOf(session, report);
  assert.equal(REPORT_LIMITS.where, 3);
  assert.deepEqual(item.where.map((w) => w.path), ['src/retry.js', '/work/wt-b/src/retry.js', '/work/wt-c/src/retry.js']);
  assert.equal(item.whereMore, 2);
  assert.ok(evidenceOf(item).includes(REPORT_ITEM_WORDS.samePlaces(5)));
  const more = REPORT_ITEM_WORDS.morePlaces(2);
  assert.equal(more, '2 more places');
  const page = unescape(renderSessionPage(session, report, {}));
  const md = renderReportMarkdown(session, report, {});
  for (const text of [page, md]) {
    assert.ok(text.includes(more));
    assert.ok(text.includes(REPORT_ITEM_WORDS.samePlaces(5)));
    assert.ok(!text.includes('/work/wt-e/src/retry.js'));
  }
});

test('D179: no places, one place, or places out of their shape read as before, byte for byte', () => {
  const session = triageSession();
  const before = truthOnlyReport(session);
  const page = renderSessionPage(session, before, {});
  const md = renderReportMarkdown(session, before, {});
  for (const places of [[OWN], [OWN, { path: '/work/wt-b/src/retry.js', side: 'session', startLine: 7, endLine: 7 }],
    [OWN, { ...OWN }], [OWN, null, 'x'], 'not a list']) {
    const report = withPlaces(session, places);
    assert.equal(renderSessionPage(session, report, {}), page, JSON.stringify(places));
    assert.equal(renderReportMarkdown(session, report, {}), md, JSON.stringify(places));
  }
  assert.ok(!page.includes('repositories or folders.'));
});

test('D179: a note that repeats an earlier note\'s key is not a note that failed Sonah\'s checks', () => {
  const session = triageSession();
  const base = truthOnlyReport(session);
  const factsOf = (triageDropped) => reportModel(session, { ...base, codePass: { ...base.codePass, triageDropped,
    filesDropped: [] } }, {}).notChecked.facts.map((f) => textOf(f.parts));
  const repeated = [{ key: 'F2', index: 1, cause: 'triage_key_repeated' }];
  assert.ok(!factsOf(repeated).includes(REPORT_NOT_CHECKED_WORDS.triageDropped(1)));
  assert.ok(!factsOf(repeated).some((t) => t.startsWith('The code review wrote ')));
  // A note that failed a check is counted as before.
  assert.ok(factsOf([...repeated, { key: 'S99', index: 2, cause: 'triage_key_unknown' }])
    .includes(REPORT_NOT_CHECKED_WORDS.triageDropped(1)));
});
