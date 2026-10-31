// D104 (owner pick 2026-10-17; F5 part 4, the mark), in the readers: the report model showed each row's shown-in-part
// mark where it placed the row — an item's evidence (its own rows and the rows folded into it), an ask's lines, a claim,
// a run and a decision you settled — naming the result's place and what Sonah left out; What Sonah could not check counts
// the results whatever the coverage. D199 (the owner, 2026-10-30: "Remove too many disclaimers present with everything",
// "All of them"): no reader shows the mark any more. The evidence package still records each row's results seen in part
// (evidence/src/seen-in-part.js, its own tests), and What Sonah could not check still counts them, as a coverage cause.
//
// Invariants, as tests: a report with marks reads byte for byte as the same report without them, on the model, the page
// and the Markdown report; no place a reader puts a marked row shows a mark, and the model's `seen` lists are empty; no
// reader says a mark's words (the result's place, what Sonah left out); the count is the report's fact; every in-page
// link of the page has its target on the page.
//
// Synthetic sessions and judges only (evidence/test/d104-seen-in-part-fixture.js, report-fixture.js). Nothing prints.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { reportModel, reportItems } from '../report-model.js';
import { sessionPage as sessionPageRaw } from '../session-page.js';
import { renderReportMarkdown } from '../session-story.js';
import { seenInPartOf, SEEN_IN_PART_SOURCES } from '../../evidence/src/seen-in-part.js';
import { COVERAGE_SENTENCE } from '../../evidence/src/review.js';
import { oneTurn, cutShapes, reviewed, ROWS, CUT_ROWS, markedRows } from '../../evidence/test/d104-seen-in-part-fixture.js';
import { reportSession, sessionOnlyReport, triagedReport, repoFacts } from './report-fixture.js';
/** D195: the page's tab labels read back as the in-page links they stand for (`data-href`), so these checks read links. */
const asLinks = (html) => html.replace(/<label class="xl[^"]*" for="t-[^"]+" data-href="(#[^"]+)">([\s\S]*?)<\/label>/g,
  '<a href="$1">$2</a>');
const sessionPage = (...args) => { const p = sessionPageRaw(...args); return { ...p, html: asLinks(p.html) }; };

const textOf = (parts) => parts.map((p) => (p.quote ? `“${p.text}”` : p.text)).join('');
const itemsOf = (model) => reportItems(model);
// D199: the words were removed; as literals. The mark's label, its lead and its places (report-words.js
// REPORT_SEEN_WORDS, as D104 had them).
const grouped = (n) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
const OLD_MARK = Object.freeze({ label: 'Seen in part:', lead: 'Sonah first showed the session review only part of',
  ofRun: (k) => `the result of run ${k}`, atEvent: (n) => `the result at event ${grouped(n)} of the recording`,
  aResult: 'a recorded result' });
/** The start of the words a mark entry said of what Sonah left out (its `cut`, as a literal): a mark's whole line holds
 *  it, so a reader without it holds no such line. */
const cutOf = ({ fromLine, throughLine, partFrom, partThrough }) => (fromLine === throughLine
  ? `It left out ${partFrom || partThrough ? 'part of ' : ''}line ${grouped(fromLine)}`
  : `It left out lines ${grouped(fromLine)} to ${grouped(throughLine)}`);
const isMark = (line) => line.startsWith(OLD_MARK.lead);
/** The words that open a mark's line, whatever its place, and its label: What Sonah could not check's count shares the
 *  lead (COVERAGE_SENTENCE.results_seen_in_part), never a place. */
const MARK_WORDS = [OLD_MARK.label, ...[OLD_MARK.ofRun(1), OLD_MARK.atEvent(1),
  OLD_MARK.aResult].map((place) => `${OLD_MARK.lead} ${place.split(' 1')[0]}`)];
/** The lines the model shows beside one row, at the place it puts the row: an item's mark lines, an ask's mark lines,
 *  or the `seen` lines of a claim, a run or a decision you settled. */
function shownFor(model, source, index) {
  const place = model.placement.rows[`${source}:${index}`];
  if (place?.item || place?.foldedInto) {
    const item = itemsOf(model).find((x) => x.n === (place.item ?? place.foldedInto));
    return item.evidence.filter((e) => e.label === OLD_MARK.label).map((e) => textOf(e.parts));
  }
  const lines = (seen) => (seen ?? []).map(textOf);
  if (place?.ask) return lines(model.prompt.asks[place.ask - 1].lines).filter(isMark);
  if (place?.list === 'claims') return lines(model.did.claims.shown.find((c) => c.source === source && c.index === index)?.seen);
  if (place?.list === 'runs') return lines(model.did.runs.shown.find((r) => r.failureIndex === index)?.seen);
  if (place?.list === 'settled') return lines(model.did.settled.find((d) => d.index === index)?.seen);
  return [];
}
/** A report with every mark taken off its rows: what the readers show of it is the report's words without the mark. */
const unmarked = (report) => JSON.parse(JSON.stringify(report, (key, value) => (key === 'seenInPart' ? undefined : value)));
/** Every `seen` list of the model's did lists. */
const seenLists = (model) => [...model.did.runs.shown, ...model.did.runs.named, ...model.did.claims.shown,
  ...model.did.settled].map((row) => row.seen);

async function reviewedModel(session = oneTurn(), rows = ROWS) {
  const { report } = await reviewed(session, [rows]);
  return { s: session, report, model: reportModel(session, report, {}) };
}

test('D104 D199: no place a reader puts a marked row shows a mark — an item, an ask, a claim, a run — and every seen list is empty', async () => {
  for (const { report, model } of [await reviewedModel(), await reviewedModel(cutShapes(), CUT_ROWS)]) {
    const marked = new Set(markedRows(report));
    assert.ok(marked.size >= 4, `premise: rows of several lists are marked (${[...marked]})`);
    for (const source of SEEN_IN_PART_SOURCES) for (const [index] of (report[source] ?? []).entries())
      assert.deepEqual(shownFor(model, source, index), [], `${source}:${index}`);
    assert.ok(seenLists(model).every((seen) => Array.isArray(seen) && seen.length === 0));
    const all = JSON.stringify(model);
    for (const words of MARK_WORDS) assert.equal(all.includes(words), false, words);
  }
});

test('D104 D199: a report with marks reads byte for byte as the same report without them — the model, the page and the .md', async () => {
  for (const { s, report, model } of [await reviewedModel(), await reviewedModel(cutShapes(), CUT_ROWS)]) {
    // The failure row the session review did not check carries the mark (its "not checked" is about what the agent did
    // after the result, ledger.js FAILURE_HANDLINGS), and its run shows none.
    const open = report.failures.findIndex((row) => row.handling === 'not-checked' && row.seenInPart);
    if (open >= 0) assert.deepEqual(model.did.runs.shown.find((r) => r.failureIndex === open)?.seen ?? [], []);
    const plain = unmarked(report);
    assert.deepEqual(model, reportModel(s, plain, {}));
    assert.equal(sessionPage(s, report, {}).html, sessionPage(s, plain, {}).html);
    assert.equal(renderReportMarkdown(s, report, {}), renderReportMarkdown(s, plain, {}));
  }
  const { report } = await reviewedModel();
  assert.ok(report.failures.some((row) => row.handling === 'not-checked' && row.seenInPart),
    'premise: a failure row not checked carries the mark');
});

test('D104 D199: no mark names the run that produced the result, or its event in the recording, on any reader', async () => {
  const { s, report, model } = await reviewedModel();
  // The suite's failure row: its result is run 1's, which the Runs list shows.
  const suite = model.did.runs.shown.find((r) => r.failureIndex === report.failures.findIndex((f) => f.eventId === 'A1-r'));
  assert.ok(suite, 'premise: the Runs list shows the suite run');
  assert.deepEqual(suite.seen, []);
  // The config file's read is no run: its event, counted from 1.
  const config = model.did.claims.shown.find((c) => c.source === 'promises'
    && report.promises[c.index].receipts.some((rc) => rc.eventId === 'R1-r'));
  assert.ok(report.promises[config.index].seenInPart?.length, 'premise: the claim is marked');
  assert.deepEqual(config.seen, []);
  const at = s.events.findIndex((event) => event.id === 'R1-r') + 1;
  const { html } = sessionPage(s, report, {});
  const md = renderReportMarkdown(s, report, {});
  for (const text of [html, md]) for (const words of [OLD_MARK.ofRun(suite.k), OLD_MARK.atEvent(at),
    OLD_MARK.aResult]) assert.equal(text.includes(words), false, words);
});

test('D104 D199: a run the Runs list does not name (a quiet exit 0) is named by no mark either', async () => {
  const { s, report, model } = await reviewedModel(cutShapes(), CUT_ROWS);
  // The passing suite run: exit 0 before any edit, answered for by no failure row, so the Runs list leaves it out.
  assert.ok(model.did.runs.quietExit0 >= 1, 'premise: a quiet run');
  assert.equal(model.did.runs.shown.some((run) => run.text?.includes('npm test')), false,
    'premise: the Runs list does not show it');
  const claim = model.did.claims.shown.find((c) => c.source === 'promises'
    && report.promises[c.index].receipts.some((rc) => rc.eventId === 'A7-r'));
  assert.equal(report.promises[claim.index].status, 'verified', 'premise: a confirmed claim, marked');
  assert.ok(report.promises[claim.index].seenInPart?.length, 'premise: a confirmed claim, marked');
  assert.deepEqual(claim.seen, []);
  const at = s.events.findIndex((event) => event.id === 'A7-r') + 1;
  const { html } = sessionPage(s, report, {});
  for (const text of [html, renderReportMarkdown(s, report, {})])
    assert.equal(text.includes(OLD_MARK.atEvent(at)), false);
});

test('D104 D199: what the request left out of a result — a cut inside a line, a line shown in part, a numbered read\'s file lines — is recorded, and no reader says it', async () => {
  const { s, report, model } = await reviewedModel(cutShapes(), CUT_ROWS);
  // The records the mark read: one line of 30,011 bytes at 12,000 a side, cut inside it; a first line longer than the
  // skim's side, shown in part; a read from line 101 of its file.
  const one = report.failures.find((row) => row.eventId === 'A5-r').seenInPart[0];
  assert.deepEqual([one.fromLine, one.throughLine, one.partFrom, one.partThrough, one.bytes], [1, 1, true, true, 6_011]);
  const wide = report.failures.find((row) => row.eventId === 'A6-r').seenInPart[0];
  assert.deepEqual([wide.fromLine, wide.partFrom, wide.partThrough], [1, true, false]);
  const read = report.promises.find((row) => row.seenInPart?.[0].eventId === 'R2-r').seenInPart[0];
  assert.deepEqual(read.fileLines, { from: read.fromLine + 100, through: read.throughLine + 100 });
  // No reader says any of it.
  const { html } = sessionPage(s, report, {});
  const md = renderReportMarkdown(s, report, {});
  const all = JSON.stringify(model);
  for (const record of [one, wide, read]) for (const text of [html, md, all])
    assert.equal(text.includes(cutOf(record)), false, cutOf(record));
  for (const text of [html, md]) for (const words of ['It showed part of line', 'In the file, th'])
    assert.equal(text.includes(words), false, words);
});

test('D104 What Sonah could not check counts the results seen in part, whatever the coverage, and says no more', async () => {
  const { report, model } = await reviewedModel();
  assert.equal(report.coverage, 'complete', 'premise: nothing capped the coverage');
  const n = report.coverageFacts.resultsSeenInPart;
  const lead = COVERAGE_SENTENCE.results_seen_in_part({ n: 2 }).split(' 2 ')[0];
  const facts = model.notChecked.facts.map((f) => textOf(f.parts)).filter((text) => text.startsWith(lead));
  // One sentence: the count. It claims nothing of where the rows that cite them say so, which a trim or a list's bound
  // can leave out.
  assert.deepEqual(facts, [`${COVERAGE_SENTENCE.results_seen_in_part({ n })}.`]);
  // A report with no such result says nothing of it.
  const session = reportSession();
  const plain = reportModel(session, sessionOnlyReport(session), repoFacts());
  assert.equal(plain.notChecked.facts.some((f) => textOf(f.parts).startsWith(lead)), false);
});

test('D104 D199: the page and the Markdown report show no mark of any marked row; both keep the count', async () => {
  const { s, report, model } = await reviewedModel();
  const { html } = sessionPage(s, report, {});
  const md = renderReportMarkdown(s, report, {});
  const lines = new Set();
  for (const key of markedRows(report)) {
    const [source, at] = key.split(':');
    for (const entry of seenInPartOf(report[source][Number(at)])) lines.add(cutOf(entry));
  }
  assert.ok(lines.size >= 3, 'premise: several marks');
  for (const line of lines) {
    assert.equal(html.includes(line), false, `page: ${line}`);
    assert.equal(md.includes(line), false, `md: ${line}`);
  }
  for (const out of [html, md]) for (const words of MARK_WORDS) assert.equal(out.includes(words), false, words);
  // No link names a run as a mark did; the runs keep their place in the Runs list.
  for (const run of model.did.runs.shown) {
    assert.equal(html.includes(`>${OLD_MARK.ofRun(run.k)}</a>`), false, `run ${run.k}`);
    assert.ok(html.includes(`id="run-${run.k}"`), `run ${run.k}`);
  }
  const counted = `${COVERAGE_SENTENCE.results_seen_in_part({ n: report.coverageFacts.resultsSeenInPart })}`;
  for (const out of [html, md]) assert.ok(out.includes(counted), counted);
});

test('D104 the page never links to a place it does not hold, whole or trimmed (D199: and no mark names a run its trim left out)', async () => {
  const { s, report } = await reviewedModel();
  const unheld = (html) => {
    const ids = new Set([...html.matchAll(/ id="([^"]+)"/g)].map((m) => m[1]));
    return [...html.matchAll(/<a href="#([^"]+)">/g)].map((m) => m[1]).filter((id) => !ids.has(id));
  };
  assert.deepEqual(unheld(sessionPage(s, report, {}).html), [], 'a whole page: every link has its place');
  // Thousands of decisions you settled put the page past its bound: the lists of what the agent did are cut, the Runs
  // list with them, while your prompt keeps each ask's lines.
  const long = (k) => `${'word '.repeat(31)}${k}`;
  const big = { ...report, decisions: [...(report.decisions ?? []), ...Array.from({ length: 3000 }, (_, k) => ({
    id: `sha256:${String(k).padStart(64, '0')}`, dimension: long(k), chosen: long(k), column: 'asked-settled',
    columnState: 'grounded', actions: [], stated: null }))] };
  const { html, whole } = sessionPage(s, big, {});
  assert.equal(whole, false, 'premise: the page was trimmed');
  assert.equal(html.includes('id="run-1"'), false, 'premise: the trim left run 1 out');
  assert.equal(html.includes(OLD_MARK.ofRun(1)), false, 'D199: no mark names run 1');
  assert.deepEqual(unheld(html), [], 'and links to nothing the page does not hold');
  // A page whose links all have their place keeps every one: a link the page holds is never taken off.
  const kept = sessionPage(reportSession(), triagedReport(reportSession()), repoFacts()).html;
  assert.deepEqual(unheld(kept), []);
  assert.ok([...kept.matchAll(/<a href="#/g)].length > 3, 'premise: the page links');
});

test('D104 D199: a mark on every row of every list — an item\'s own, one folded into it, an ask, a claim, a run, a decision you settled — shows at none of their places, and every reader reads as without them', () => {
  const session = reportSession();
  const base = sessionOnlyReport(session);
  // Each row of every list cites a result of its own, with a cut of its own (a result the session does not hold: its
  // place is its recorded sequence).
  const report = { ...base };
  let k = 0;
  const markOf = () => { k++;
    return [{ eventId: `D104-${k}`, sequence: 2_000 - k, fromLine: 7_000 + k, throughLine: 7_040 + k,
      partFrom: false, partThrough: false, fileLines: null, bytes: 9_000 + k }]; };
  for (const source of SEEN_IN_PART_SOURCES)
    report[source] = (base[source] ?? []).map((row) => ({ ...row, seenInPart: markOf() }));
  const model = reportModel(session, report, repoFacts());
  const places = new Set();
  for (const source of SEEN_IN_PART_SOURCES) for (const [index] of (report[source] ?? []).entries()) {
    const place = model.placement.rows[`${source}:${index}`];
    if (place?.notChecked) continue;
    places.add(Object.keys(place).find((key) => key !== 'shown') + (place.list ? `:${place.list}` : ''));
    assert.deepEqual(shownFor(model, source, index), [], `${source}:${index}`);
  }
  for (const where of ['item', 'foldedInto', 'ask', 'list:claims', 'list:runs', 'list:settled'])
    assert.ok(places.has(where), `premise: a row placed at ${where}`);
  assert.ok(model.did.settled.length > 0 && model.did.settled.every((d) => d.seen.length === 0));
  // The model, the page and the Markdown report are those of the report without the marks, byte for byte.
  assert.deepEqual(model, reportModel(session, base, repoFacts()));
  const { html } = sessionPage(session, report, repoFacts());
  const md = renderReportMarkdown(session, report, repoFacts());
  assert.equal(html, sessionPage(session, base, repoFacts()).html);
  assert.equal(md, renderReportMarkdown(session, base, repoFacts()));
});

test('D104 a report written before the mark shows none, and (D199) neither does one with a mark', () => {
  const session = reportSession();
  const model = reportModel(session, sessionOnlyReport(session), repoFacts());
  const all = JSON.stringify(model);
  assert.equal(all.includes(OLD_MARK.lead), false);
  assert.equal(all.includes(OLD_MARK.label), false);
  const mark = { eventId: 'R1-r', sequence: 1, fromLine: 2, throughLine: 9, partFrom: false, partThrough: false,
    fileLines: null, bytes: 100 };
  // A mark is code's, on the session review's own rows: one on a row of the code step is not read.
  const code = triagedReport(session);
  code.codePass = { ...code.codePass, findings: code.codePass.findings.map((f) => ({ ...f, seenInPart: [mark] })) };
  assert.ok(code.codePass.findings.length, 'premise: the code step published findings');
  assert.equal(JSON.stringify(reportModel(session, code, repoFacts())).includes(OLD_MARK.lead), false);
  // A malformed mark is no mark; D199: a well-formed one is shown by no reader either.
  const bad = sessionOnlyReport(session);
  bad.promises = bad.promises.map((row) => ({ ...row, seenInPart: [{ ...mark, fromLine: 9, throughLine: 2 }, 'R1-r',
    { ...mark, partFrom: undefined }] }));
  assert.equal(JSON.stringify(reportModel(session, bad, repoFacts())).includes(OLD_MARK.lead), false);
  const good = sessionOnlyReport(session);
  good.promises = good.promises.map((row) => ({ ...row, seenInPart: [mark] }));
  assert.equal(seenInPartOf(good.promises[0]).length, 1, 'premise: the evidence package reads the mark');
  assert.equal(JSON.stringify(reportModel(session, good, repoFacts())).includes(OLD_MARK.lead), false);
  for (const text of [sessionPage(session, good, repoFacts()).html, renderReportMarkdown(session, good, repoFacts())])
    assert.equal(text.includes(cutOf(mark)), false);
});
