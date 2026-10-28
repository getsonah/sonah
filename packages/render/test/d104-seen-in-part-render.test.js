// D104 (owner pick 2026-10-17; F5 part 4, the mark), in the readers: the report model shows each row's shown-in-part
// mark where it places the row — an item's evidence (its own rows and the rows folded into it), an ask's lines, a claim,
// a run and a decision you settled — naming the result's place and what Sonah left out, in the facts the request's own
// omission line names; What Sonah could not check counts the results whatever the coverage. The page and the Markdown
// report show the model's words, and the page never links to a place it does not hold.
//
// Invariants, as tests: every marked row shows each of its results at its placement, one line each and nothing more,
// and no row without a mark shows one; the place is the run that produced the result, linked, when the Runs list shows
// it, else its event; a mark claims nothing of what the left-out lines would settle; the count is the report's fact;
// every in-page link of the page has its target on the page.
//
// Synthetic sessions and judges only (evidence/test/d104-seen-in-part-fixture.js, report-fixture.js). Nothing prints.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { reportModel, reportItems } from '../report-model.js';
import { sessionPage } from '../session-page.js';
import { renderReportMarkdown } from '../session-story.js';
import { REPORT_SEEN_WORDS } from '../report-words.js';
import { seenInPartOf, SEEN_IN_PART_SOURCES } from '../../evidence/src/seen-in-part.js';
import { COVERAGE_SENTENCE } from '../../evidence/src/review.js';
import { oneTurn, cutShapes, reviewed, ROWS, CUT_ROWS, markedRows } from '../../evidence/test/d104-seen-in-part-fixture.js';
import { reportSession, sessionOnlyReport, triagedReport, repoFacts } from './report-fixture.js';

const textOf = (parts) => parts.map((p) => (p.quote ? `“${p.text}”` : p.text)).join('');
const itemsOf = (model) => reportItems(model);
/** The words a mark entry says of what Sonah left out. */
const cutOf = (seen) => REPORT_SEEN_WORDS.cut(seen);
const isMark = (line) => line.startsWith(REPORT_SEEN_WORDS.lead);
/** The lines the model shows beside one row, at the place it puts the row: an item's mark lines, an ask's mark lines,
 *  or the `seen` lines of a claim, a run or a decision you settled. */
function shownFor(model, source, index) {
  const place = model.placement.rows[`${source}:${index}`];
  if (place?.item || place?.foldedInto) {
    const item = itemsOf(model).find((x) => x.n === (place.item ?? place.foldedInto));
    return item.evidence.filter((e) => e.label === REPORT_SEEN_WORDS.label).map((e) => textOf(e.parts));
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

async function reviewedModel(session = oneTurn(), rows = ROWS) {
  const { report } = await reviewed(session, [rows]);
  return { s: session, report, model: reportModel(session, report, {}) };
}

test('D104 every marked row shows each result it cites at its place, one line each, and no other row shows a mark', async () => {
  for (const { report, model } of [await reviewedModel(), await reviewedModel(cutShapes(), CUT_ROWS)]) {
    const marked = new Set(markedRows(report));
    assert.ok(marked.size >= 4, `premise: rows of several lists are marked (${[...marked]})`);
    for (const source of SEEN_IN_PART_SOURCES) for (const [index, row] of (report[source] ?? []).entries()) {
      const place = model.placement.rows[`${source}:${index}`];
      const shown = shownFor(model, source, index);
      if (!marked.has(`${source}:${index}`)) {
        // A row placed alone (an ask, a claim, a run) shows no mark; an item shows one only for another row it holds.
        if (!place?.item && !place?.foldedInto) assert.deepEqual(shown, [], `${source}:${index}`);
        continue;
      }
      const seen = seenInPartOf(row);
      for (const entry of seen)
        assert.ok(shown.some((line) => line.endsWith(cutOf(entry))), `${source}:${index} shows ${entry.eventId}`);
      // Beside a row placed alone, the mark is all that is added: one line a result, each a mark, nothing else.
      if (!place?.item && !place?.foldedInto) assert.deepEqual(shown.map(isMark), seen.map(() => true), `${source}:${index}`);
    }
  }
});

test('D104 a mark claims nothing of what the left-out lines would settle: beside a row not checked, only the mark', async () => {
  const { report, model } = await reviewedModel();
  // The failure row the session review did not check: its "not checked" is about what the agent did after the result
  // (ledger.js FAILURE_HANDLINGS), which the left-out middle of the result cannot settle.
  const open = report.failures.findIndex((row) => row.handling === 'not-checked' && row.seenInPart);
  assert.ok(open >= 0, 'premise: a failure row not checked carries the mark');
  const run = model.did.runs.shown.find((r) => r.failureIndex === open);
  assert.deepEqual(run.seen.map(textOf), seenInPartOf(report.failures[open]).map((seen) => `${REPORT_SEEN_WORDS.lead} `
    + `${REPORT_SEEN_WORDS.ofRun(run.k)}. ${cutOf(seen)}`));
  // Everywhere the model places a row, the mark adds its lines and nothing else: the model of the same report without
  // its marks differs only by them.
  const plain = reportModel(oneTurn(), unmarked(report), {});
  for (const item of itemsOf(model)) {
    const other = itemsOf(plain).find((x) => x.n === item.n);
    assert.deepEqual(item.evidence.filter((e) => e.label !== REPORT_SEEN_WORDS.label), other.evidence, `item ${item.n}`);
  }
  for (const [k, ask] of model.prompt.asks.entries())
    assert.deepEqual(ask.lines.filter((line) => !isMark(textOf(line))), plain.prompt.asks[k].lines, `ask ${ask.n}`);
  for (const list of [model.did.runs.shown, model.did.claims.shown, model.did.settled])
    for (const row of list) assert.ok(row.seen.every((line) => isMark(textOf(line))));
});

test('D104 a mark names the run that produced the result, linked, or else its event in the recording', async () => {
  const { s, report, model } = await reviewedModel();
  // The suite's failure row: its result is run 1's, which the Runs list shows.
  const suite = model.did.runs.shown.find((r) => r.failureIndex === report.failures.findIndex((f) => f.eventId === 'A1-r'));
  const link = suite.seen[0].find((p) => p.href);
  assert.deepEqual([link.text, link.href], [REPORT_SEEN_WORDS.ofRun(suite.k), `run-${suite.k}`]);
  // The config file's read is no run: its event, counted from 1.
  const config = model.did.claims.shown.find((c) => c.source === 'promises'
    && report.promises[c.index].receipts.some((rc) => rc.eventId === 'R1-r'));
  const at = s.events.findIndex((event) => event.id === 'R1-r') + 1;
  assert.equal(textOf(config.seen[0]), `${REPORT_SEEN_WORDS.lead} ${REPORT_SEEN_WORDS.atEvent(at)}. `
    + `${cutOf(report.promises[config.index].seenInPart[0])}`);
  assert.equal(config.seen[0].some((p) => p.href), false);
});

test('D104 a run the Runs list does not name (a quiet exit 0) is named by its event, never by a link to nowhere', async () => {
  const { s, report, model } = await reviewedModel(cutShapes(), CUT_ROWS);
  // The passing suite run: exit 0 before any edit, answered for by no failure row, so the Runs list leaves it out.
  assert.ok(model.did.runs.quietExit0 >= 1, 'premise: a quiet run');
  assert.equal(model.did.runs.shown.some((run) => run.text?.includes('npm test')), false,
    'premise: the Runs list does not show it');
  const claim = model.did.claims.shown.find((c) => c.source === 'promises'
    && report.promises[c.index].receipts.some((rc) => rc.eventId === 'A7-r'));
  assert.equal(report.promises[claim.index].status, 'verified', 'premise: a confirmed claim, marked');
  const at = s.events.findIndex((event) => event.id === 'A7-r') + 1;
  assert.equal(textOf(claim.seen[0]), `${REPORT_SEEN_WORDS.lead} ${REPORT_SEEN_WORDS.atEvent(at)}. `
    + `${cutOf(report.promises[claim.index].seenInPart[0])}`);
  assert.equal(claim.seen[0].some((p) => p.href), false, 'no link');
  const { html } = sessionPage(s, report, {});
  assert.ok(html.includes(REPORT_SEEN_WORDS.atEvent(at)));
});

test('D104 the mark says a cut inside a line, a line shown in part and a numbered read\'s file lines as the request does', async () => {
  const { report, model } = await reviewedModel(cutShapes(), CUT_ROWS);
  const lines = [...model.did.runs.shown.flatMap((run) => run.seen), ...model.did.claims.shown.flatMap((c) => c.seen)]
    .map(textOf);
  const say = (sentence) => assert.ok(lines.some((line) => line.endsWith(sentence)), sentence);
  // One line of 30,011 bytes at 12,000 a side: Sonah showed its start and its end, and left out 6,011 bytes of it.
  say('It left out part of line 1 (6,011 bytes).');
  // A first line longer than the skim's side: the head shows its start.
  const wide = report.failures.find((row) => row.eventId === 'A6-r').seenInPart[0];
  say(`It left out lines 1 to ${wide.throughLine.toLocaleString('en-US')} (${wide.bytes.toLocaleString('en-US')} bytes). `
    + 'It showed part of line 1.');
  // A read from line 101 of its file: the output's lines, and the file's.
  const read = report.promises.find((row) => row.seenInPart?.[0].eventId === 'R2-r').seenInPart[0];
  say(`It left out lines ${read.fromLine} to ${read.throughLine} (${read.bytes.toLocaleString('en-US')} bytes). `
    + `In the file, these are lines ${read.fromLine + 100} to ${read.throughLine + 100}.`);
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

test('D104 the page and the Markdown report show every mark the model shows', async () => {
  const { s, report, model } = await reviewedModel();
  const { html } = sessionPage(s, report, {});
  const md = renderReportMarkdown(s, report, {});
  const lines = new Set();
  for (const key of markedRows(report)) {
    const [source, at] = key.split(':');
    for (const entry of seenInPartOf(report[source][Number(at)])) lines.add(cutOf(entry));
  }
  assert.ok(lines.size >= 3);
  for (const line of lines) {
    assert.ok(html.includes(line), `page: ${line}`);
    assert.ok(md.includes(line), `md: ${line}`);
  }
  for (const out of [html, md]) assert.ok(out.includes(REPORT_SEEN_WORDS.label));
  // The run link is an in-page anchor on the page; the run it names is in the Runs list.
  const run = model.did.runs.shown.find((r) => r.seen.length);
  assert.ok(html.includes(`<a href="#run-${run.k}">${REPORT_SEEN_WORDS.ofRun(run.k)}</a>`));
  assert.ok(html.includes(`id="run-${run.k}"`));
});

test('D104 the page never links to a place it does not hold: a run its size trim left out keeps its words, unlinked', async () => {
  const { s, report } = await reviewedModel();
  const unheld = (html) => {
    const ids = new Set([...html.matchAll(/ id="([^"]+)"/g)].map((m) => m[1]));
    return [...html.matchAll(/<a href="#([^"]+)">/g)].map((m) => m[1]).filter((id) => !ids.has(id));
  };
  assert.deepEqual(unheld(sessionPage(s, report, {}).html), [], 'a whole page: every link has its place');
  // Thousands of decisions you settled put the page past its bound: the lists of what the agent did are cut, the Runs
  // list with them, while your prompt keeps each ask's lines and the mark that names run 1.
  const long = (k) => `${'word '.repeat(31)}${k}`;
  const big = { ...report, decisions: [...(report.decisions ?? []), ...Array.from({ length: 3000 }, (_, k) => ({
    id: `sha256:${String(k).padStart(64, '0')}`, dimension: long(k), chosen: long(k), column: 'asked-settled',
    columnState: 'grounded', actions: [], stated: null }))] };
  const { html, whole } = sessionPage(s, big, {});
  assert.equal(whole, false, 'premise: the page was trimmed');
  assert.equal(html.includes('id="run-1"'), false, 'premise: the trim left run 1 out');
  assert.ok(html.includes(REPORT_SEEN_WORDS.ofRun(1)), 'the mark still names run 1');
  assert.deepEqual(unheld(html), [], 'and links to nothing the page does not hold');
  // A page whose links all have their place keeps every one: a link the page holds is never taken off.
  const kept = sessionPage(reportSession(), triagedReport(reportSession()), repoFacts()).html;
  assert.deepEqual(unheld(kept), []);
  assert.ok([...kept.matchAll(/<a href="#/g)].length > 3, 'premise: the page links');
});

test('D104 a mark on a row folded into an item, and on a decision you settled, shows at their place, in recorded order', () => {
  const session = reportSession();
  const base = sessionOnlyReport(session);
  // Each row of every list cites a result of its own, with a cut of its own (a result the session does not hold: its
  // place is its recorded sequence), so each mark's words are its own row's: the readers place each mark where they place
  // the row. The places run against the lists' order, so an item that holds several rows must sort their marks.
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
    const shown = shownFor(model, source, index).filter(isMark);
    assert.ok(shown.some((line) => line.endsWith(cutOf(report[source][index].seenInPart[0]))), `${source}:${index}`);
  }
  for (const where of ['item', 'foldedInto', 'ask', 'list:claims', 'list:runs', 'list:settled'])
    assert.ok(places.has(where), `premise: a row placed at ${where}`);
  // The page and the Markdown report show the mark of each decision you settled, beside it.
  const { html } = sessionPage(session, report, repoFacts());
  const md = renderReportMarkdown(session, report, repoFacts());
  for (const settled of model.did.settled) {
    const line = cutOf(report.decisions[settled.index].seenInPart[0]);
    assert.equal(html.split(line).length - 1, 1, `page: settled ${settled.index}, once`);
    const { sequence } = report.decisions[settled.index].seenInPart[0];
    assert.ok(textOf(settled.seen[0]).includes(REPORT_SEEN_WORDS.atEvent(sequence + 1)));
    assert.ok(md.split('\n').some((row) => row.startsWith('- ') && row.includes(line)), `md: settled ${settled.index}`);
  }
  // An item holding several rows shows each result once, in recorded order, whatever order it holds the rows in.
  const marks = SEEN_IN_PART_SOURCES.flatMap((source) => (report[source] ?? []).map((row, index) => ({ row,
    place: model.placement.rows[`${source}:${index}`], words: cutOf(row.seenInPart[0]) })));
  let unsorted = 0;
  for (const item of itemsOf(model)) {
    const shown = item.evidence.filter((e) => e.label === REPORT_SEEN_WORDS.label).map((e) => textOf(e.parts));
    assert.equal(new Set(shown).size, shown.length, `item ${item.n}`);
    const order = shown.map((line) => marks.find((m) => line.endsWith(m.words)).row.seenInPart[0].sequence);
    assert.deepEqual(order, [...order].sort((a, b) => a - b), `item ${item.n}: in recorded order`);
    // The rows the item holds, its own first: when their marks are not already in recorded order, the item sorts them.
    const held = marks.filter((m) => m.place?.item === item.n || m.place?.foldedInto === item.n)
      .sort((a, b) => Number(Boolean(a.place.foldedInto)) - Number(Boolean(b.place.foldedInto)))
      .map((m) => m.row.seenInPart[0].sequence);
    if (held.some((n, i) => i > 0 && n < held[i - 1])) unsorted++;
  }
  assert.ok(unsorted > 0, 'premise: an item holds rows whose marks are not already in recorded order');
});

test('D104 a report written before the mark shows none', () => {
  const session = reportSession();
  const model = reportModel(session, sessionOnlyReport(session), repoFacts());
  const all = JSON.stringify(model);
  assert.equal(all.includes(REPORT_SEEN_WORDS.lead), false);
  assert.equal(all.includes(REPORT_SEEN_WORDS.label), false);
  const mark = { eventId: 'R1-r', sequence: 1, fromLine: 2, throughLine: 9, partFrom: false, partThrough: false,
    fileLines: null, bytes: 100 };
  // A mark is code's, on the session review's own rows: one on a row of the code step is not read.
  const code = triagedReport(session);
  code.codePass = { ...code.codePass, findings: code.codePass.findings.map((f) => ({ ...f, seenInPart: [mark] })) };
  assert.ok(code.codePass.findings.length, 'premise: the code step published findings');
  assert.equal(JSON.stringify(reportModel(session, code, repoFacts())).includes(REPORT_SEEN_WORDS.lead), false);
  // A malformed mark is no mark; a well-formed one is read.
  const bad = sessionOnlyReport(session);
  bad.promises = bad.promises.map((row) => ({ ...row, seenInPart: [{ ...mark, fromLine: 9, throughLine: 2 }, 'R1-r',
    { ...mark, partFrom: undefined }] }));
  assert.equal(JSON.stringify(reportModel(session, bad, repoFacts())).includes(REPORT_SEEN_WORDS.lead), false);
  const good = sessionOnlyReport(session);
  good.promises = good.promises.map((row) => ({ ...row, seenInPart: [mark] }));
  assert.equal(JSON.stringify(reportModel(session, good, repoFacts())).includes(REPORT_SEEN_WORDS.lead), true);
});
