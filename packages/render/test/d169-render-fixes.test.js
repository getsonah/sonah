// D169 (0.3.0-beta.10; beta.9's release check, known issues 7 to 9): three render defects. (1) A run that an item names
// (a failure's Where, a run that an incomplete claim rests on) and that the page's list leaves out (past its first 40,
// or a quiet exit 0) pointed to nothing, on the page and in the .md: it is now listed apart on the page, under its
// sentence, and the .md keeps its line; the counts of the runs not shown leave it out. (2) Good to know with no item was
// an empty fold, said folded on the count line: it is now a heading, as an empty Must act is. (3) The page listed the
// facts about the code review under The session review: it now groups them as the .md does. Structure only, every
// session and report synthetic.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { reportModel } from '../report-model.js';
import { renderSessionPage, sessionPage, PAGE_LIMITS } from '../session-page.js';
import { renderReportMarkdown } from '../session-story.js';
import { REPORT_DID_WORDS, REPORT_SECTION_WORDS, REPORT_ITEM_WORDS, REPORT_NOT_CHECKED_WORDS, REPORT_COUNT_WORDS,
  REPORT_TIER_WORDS } from '../report-words.js';
import { REPORT_LIMITS } from '../report-model.js';
import { REPORT_SHAPES, reportSession, triagedReport, repoFacts } from './report-fixture.js';
import { sessionBuilder, STORY_KEY } from './session-story-fixture.js';

const r = (role, eventId, quote) => ({ role, eventId, quote, sessionKey: STORY_KEY });
const windowOf = (session) => [{ windowIndex: 0, eventIds: session.events.map((e) => e.id), failure: null }];
const escapeHtml = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
  .replace(/'/g, '&#39;');
/** The .md's Runs part: from its heading to the next heading. */
const runsPart = (md) => {
  const at = md.indexOf(`#### ${REPORT_SECTION_WORDS.runs}`);
  return at < 0 ? '' : md.slice(at, md.indexOf('\n#### ', at + 1) + 1);
};
const mdRunLines = (md) => [...runsPart(md).matchAll(/^- run (\d+) · /gm)].map((m) => Number(m[1]));
const pageRunIds = (html) => new Set([...html.matchAll(/ id="run-(\d+)"/g)].map((m) => Number(m[1])));
/** Every run an item of the model names, by the target of a Where or a link (`run-<k>`). */
function itemRuns(model) {
  const ks = new Set();
  const visit = (v) => {
    if (Array.isArray(v)) { v.forEach(visit); return; }
    if (v === null || typeof v !== 'object') return;
    for (const key of ['href', 'anchor']) if (typeof v[key] === 'string' && /^run-\d+$/.test(v[key])) ks.add(Number(v[key].slice(4)));
    Object.values(v).forEach(visit);
  };
  visit([...Object.values(model.tiers).flat(), ...model.decisions.groups.flatMap((g) => g.items)]);
  return ks;
}
/** The runs the .md names outside its Runs part, in its own words for a run (`REPORT_ITEM_WORDS.run`). */
const mdNamed = (md) => [...new Set([...md.split(runsPart(md)).join('').matchAll(/\brun (\d+)\b/g)].map((m) => Number(m[1])))];
/** Every run that a part names has its line: on the page by its id, in the .md by its line in the Runs part. */
function assertEveryNamedRunListed(session, report, options, why) {
  const model = reportModel(session, report, options);
  const page = renderSessionPage(session, report, options);
  const md = renderReportMarkdown(session, report, options);
  const ids = pageRunIds(page);
  for (const k of itemRuns(model)) assert.ok(ids.has(k), `${why}: the page holds run ${k}`);
  // On the page, a link to a run is kept only where the page holds it (`heldLinks`): every Where to a run is a link.
  for (const k of itemRuns(model)) assert.ok(page.includes(`<a href="#run-${k}">${REPORT_ITEM_WORDS.run(k)}</a>`)
    || !page.includes(`${REPORT_ITEM_WORDS.run(k)}`), `${why}: run ${k} is linked`);
  const lines = mdRunLines(md);
  for (const k of mdNamed(md)) assert.ok(lines.includes(k), `${why}: the .md keeps run ${k}'s line`);
  const { runs } = model.did;
  assert.equal(runs.shown.length + runs.named.length + runs.quietExit0 + runs.cut, runs.total, `${why}: runs counted once`);
  return { model, page, md };
}

/** 44 failed runs before a failure that the agent passed over (run 45), then the edit. */
function longFailures(n = 44) {
  const b = sessionBuilder();
  b.ask('I1', 'Make the suite pass.');
  for (let k = 0; k < n; k++) b.run(`R${k}`, `npm test -- --grep "case ${k}"`, 'failed', `FAIL ${k}`);
  b.run('RX', 'npm run e2e', 'failed', 'FAIL e2e');
  b.change('W1', 'src/a.js', { after: 'export const a = 1;\n' });
  b.say('F1', 'Done.', 'final');
  const session = b.session();
  const report = { windowResults: windowOf(session), sessionReview: 'complete', coverage: 'complete',
    requirements: [{ text: 'pass', instruction: r('instruction', 'I1', 'Make the suite pass.'), status: 'done',
      deliverable: r('code', 'W1', 'export const a = 1;') }],
    failures: [{ eventId: 'RX-r', action: 'RX', outcome: 'ran-failed', form: 'exit', tool: 'bash', handling: 'passed-over',
      response: r('commentary', 'F1', 'Done.') }] };
  return { session, report };
}

test('D169: a run that an item names past the page\'s 40 is listed after the list, and the .md keeps its line', () => {
  const { session, report } = longFailures();
  const { model, page, md } = assertEveryNamedRunListed(session, report, {}, 'long failures');
  const { runs } = model.did;
  assert.equal(REPORT_LIMITS.runs, 40);
  assert.deepEqual([runs.total, runs.shown.length, runs.named.map((x) => x.k), runs.cut, runs.quietExit0],
    [45, 40, [45], 4, 0]);
  assert.deepEqual(runs.cutRuns, [41, 42, 43, 44]);
  assert.deepEqual(runs.cutParts, ['4 failed']);
  const item = model.tiers.must_know.concat(model.tiers.must_act, model.tiers.good_to_know)
    .find((x) => x.kind === 'failure_passed_over');
  assert.deepEqual(item.where.map((w) => w.anchor), ['run-45']);
  // The page: the 40, then the sentence, then run 45's line, its number first; the count of the rest leaves it out.
  const list = page.indexOf('<ol class="rows runs">'), apart = page.indexOf(REPORT_DID_WORDS.runsNamedApart);
  assert.ok(list > 0 && apart > list, 'the sentence comes after the list');
  assert.ok(page.slice(apart).startsWith(`${REPORT_DID_WORDS.runsNamedApart}</p><ul class="rows"><li id="run-45">`
    + `${REPORT_ITEM_WORDS.run(45)} · <code>npm run e2e</code> · `), page.slice(apart, apart + 200));
  assert.equal([...page.matchAll(/<li id="run-\d+">/g)].length, 41);
  assert.ok(page.includes(escapeHtml(REPORT_DID_WORDS.runsCut(41, 4, '4 failed'))));
  assert.ok(page.includes(`<a href="#run-45">${REPORT_ITEM_WORDS.run(45)}</a>`), 'the Where is a link');
  // The .md: the Where's run keeps its line, after the label; the page holds runs it does not show.
  assert.ok(md.includes(`Where: ${REPORT_ITEM_WORDS.run(45)}`));
  assert.deepEqual(mdRunLines(md), [45]);
  assert.ok(runsPart(md).includes(`\n${REPORT_DID_WORDS.runsNamed}\n\n- run 45 · \`npm run e2e\` · `), runsPart(md));
  assert.ok(md.includes(`\n${REPORT_DID_WORDS.runsOnPage}\n`));
});

test('D169: with no run past the list, the page lists none apart and says no sentence for them', () => {
  const { session, report } = longFailures(30);
  const { model, page } = assertEveryNamedRunListed(session, report, {}, 'short');
  assert.deepEqual([model.did.runs.named, model.did.runs.cut], [[], 0]);
  assert.equal(page.includes(REPORT_DID_WORDS.runsNamedApart), false);
});

test('D169: a quiet run that an incomplete claim rests on is listed apart, and no longer counted quiet', () => {
  const b = sessionBuilder();
  b.ask('I1', 'Speed up the build.');
  b.run('Q0', 'npm ci', 'succeeded', 'added 12 packages');
  b.run('Q1', 'npm run lint', 'succeeded', 'ok');
  b.change('W1', 'src/build.js', { after: 'export const build = () => 1;\n' });
  b.run('R1', 'npm run build', 'failed', 'Error: out of memory');
  b.say('F1', 'The lint passes.', 'final');
  const session = b.session();
  const claim = { id: `sha256:${'e'.repeat(64)}`, stated: r('commentary', 'F1', 'The lint passes.'), text: 'The lint passes',
    status: 'incomplete', restsOn: ['Q1'], receipts: [r('commentary', 'F1', 'The lint passes.')] };
  const report = { windowResults: windowOf(session), sessionReview: 'complete', coverage: 'complete',
    requirements: [{ text: 'speed', instruction: r('instruction', 'I1', 'Speed up the build.'), status: 'done',
      deliverable: r('code', 'W1', 'export const build = () => 1;') }],
    promises: [claim], codePass: { triage: [{ ref: { source: 'promises', index: 0 }, level: 'high' }] } };
  const { model, page, md } = assertEveryNamedRunListed(session, report, {}, 'quiet');
  const item = Object.values(model.tiers).flat().find((x) => x.kind === 'claim_incomplete');
  assert.ok(item, 'premise: the incomplete claim is an item');
  assert.ok(itemRuns(model).has(2), 'premise: it links run 2, a quiet exit 0');
  const { runs } = model.did;
  assert.deepEqual([runs.shown.map((x) => x.k), runs.named.map((x) => x.k), runs.quietExit0, runs.cut], [[3], [2], 1, 0]);
  assert.ok(page.includes(`<li id="run-2">${REPORT_ITEM_WORDS.run(2)} · <code>npm run lint</code>`));
  assert.ok(page.includes(escapeHtml(REPORT_DID_WORDS.moreRuns(1))), 'the other quiet run is counted');
  assert.ok(mdRunLines(md).includes(2));
});

test('D169: with no run in the list above, the runs listed apart are headed as the .md heads them', () => {
  // Every other run is a quiet exit 0, so the page's list shows none.
  const b = sessionBuilder();
  b.ask('I1', 'Speed up the build.');
  b.run('Q0', 'npm ci', 'succeeded', 'added 12 packages');
  b.run('Q1', 'npm run lint', 'succeeded', 'ok');
  b.change('W1', 'src/build.js', { after: 'export const build = () => 1;\n' });
  b.say('F1', 'The lint passes.', 'final');
  const session = b.session();
  const report = { windowResults: windowOf(session), sessionReview: 'complete', coverage: 'complete',
    requirements: [{ text: 'speed', instruction: r('instruction', 'I1', 'Speed up the build.'), status: 'done',
      deliverable: r('code', 'W1', 'export const build = () => 1;') }],
    promises: [{ id: `sha256:${'f'.repeat(64)}`, stated: r('commentary', 'F1', 'The lint passes.'), text: 'The lint passes',
      status: 'incomplete', restsOn: ['Q1'], receipts: [r('commentary', 'F1', 'The lint passes.')] }],
    codePass: { triage: [{ ref: { source: 'promises', index: 0 }, level: 'high' }] } };
  const { model, page } = assertEveryNamedRunListed(session, report, {}, 'all quiet');
  assert.deepEqual([model.did.runs.shown.length, model.did.runs.named.map((x) => x.k), model.did.runs.quietExit0], [0, [2], 1]);
  assert.equal(page.includes(REPORT_DID_WORDS.runsNamedApart), false, 'no sentence points to a list above');
  assert.ok(page.includes(`<p class="note">${REPORT_DID_WORDS.runsNamed}</p><ul class="rows"><li id="run-2">`));
});

test('D169: a run listed apart with no command and no tool says its number, then its result', () => {
  // A failure row whose call the recording does not hold, with no tool, after 44 failed runs.
  const { session, report } = longFailures();
  const bare = { ...report, failures: [{ eventId: 'ZZ-r', action: 'ZZ', outcome: 'ran-failed', form: 'exit',
    handling: 'passed-over', response: r('commentary', 'F1', 'Done.') }] };
  const { model, page } = assertEveryNamedRunListed(session, bare, {}, 'no call');
  const run = model.did.runs.named.at(-1);
  assert.deepEqual([run.text, run.tool], [null, null]);
  assert.ok(page.includes(`<li id="run-${run.k}">${REPORT_ITEM_WORDS.run(run.k)} · ${escapeHtml(run.outcome)}`), 'one separator');
});

test('D169: the size trim keeps the runs listed apart whole, so an item\'s run keeps its line and its link', () => {
  // Long asks push the page past its bound, so its lists are cut.
  const b = sessionBuilder();
  const asks = [];
  for (let a = 0; a < 1_344; a++) {
    b.ask(`I${a}`, `Ask number ${a}: please make the case ${a} pass. ${'Some long context words here. '.repeat(20)}`);
    asks.push({ text: `pass ${a}`, instruction: r('instruction', `I${a}`, `please make the case ${a} pass.`), status: 'done',
      deliverable: r('code', 'W1', 'export const a = 1;') });
  }
  for (let k = 0; k < 44; k++) b.run(`R${k}`, `npm test -- --grep "case ${k}"`, 'failed', `FAIL ${k}`);
  b.run('RX', 'npm run e2e', 'failed', 'FAIL e2e');
  b.change('W1', 'src/a.js', { after: 'export const a = 1;\n' });
  b.say('F1', 'Done.', 'final');
  const session = b.session();
  const report = { windowResults: windowOf(session), sessionReview: 'complete', coverage: 'complete', requirements: asks,
    failures: [{ eventId: 'RX-r', action: 'RX', outcome: 'ran-failed', form: 'exit', tool: 'bash', handling: 'passed-over',
      response: r('commentary', 'F1', 'Done.') }] };
  const { html, whole } = sessionPage(session, report, {});
  assert.equal(whole, false, 'premise: the page is cut to its bound');
  assert.ok(Buffer.byteLength(html, 'utf8') <= PAGE_LIMITS.maxBytes);
  const shown = [...html.slice(html.indexOf('<ol class="rows runs">'), html.indexOf('</ol>', html.indexOf('<ol class="rows runs">')))
    .matchAll(/<li id="run-/g)].length;
  assert.ok(shown < 40, `premise: the list is cut (${shown})`);
  assert.ok(html.includes(`<li id="run-45">${REPORT_ITEM_WORDS.run(45)} · <code>npm run e2e</code>`));
  assert.ok(html.includes(`<a href="#run-45">${REPORT_ITEM_WORDS.run(45)}</a>`), 'the Where keeps its link');
  // The cut line counts the run listed apart among those it shows (its parts are the model's cut runs').
  const cutLine = escapeHtml(REPORT_DID_WORDS.runsCut(shown + 1, 45 - shown - 1, ''));
  assert.ok(html.includes(cutLine.slice(0, cutLine.indexOf(':'))), cutLine);
});

test('D169: on every page and .md the fixtures hold, every run a part names has its line', () => {
  const session = reportSession();
  for (const [name, shape] of Object.entries(REPORT_SHAPES)) assertEveryNamedRunListed(session, shape(session), repoFacts(), name);
  assertEveryNamedRunListed(session, triagedReport(session), repoFacts(), 'triaged');
});

test('D169: Good to know with no item is a heading, never an empty fold, and the count line does not say folded', () => {
  const session = reportSession();
  const empty = { windowResults: [], sessionReview: 'complete', coverage: 'complete' };
  const model = reportModel(session, empty, {});
  assert.equal(model.tiers.good_to_know.length, 0);
  assert.deepEqual(model.countLine.tiers.map((t) => t.folded), [false, false, false]);
  const page = renderSessionPage(session, empty, {});
  const md = renderReportMarkdown(session, empty, {});
  const heading = REPORT_SECTION_WORDS.tier(REPORT_TIER_WORDS.good_to_know, 0);
  assert.ok(page.includes(`<section class="part tier" id="good-to-know"><h2>${heading}</h2></section>`));
  assert.equal(page.includes('class="part tier fold-tier"'), false);
  assert.ok(page.includes(`<a href="#good-to-know">${REPORT_COUNT_WORDS.tier(REPORT_TIER_WORDS.good_to_know, 0)}</a>`));
  assert.ok(md.includes(`\n### ${heading}\n`));
  assert.equal(md.includes(`<details><summary>${heading}</summary>`), false);
  for (const text of [page, md]) assert.equal(text.includes(`Good to know 0 ${REPORT_COUNT_WORDS.folded}`), false);
  // With an item, as before: a fold, said folded.
  const full = triagedReport(session);
  const n = reportModel(session, full, repoFacts()).tiers.good_to_know.length;
  assert.ok(n > 0, 'premise: the triaged report holds Good to know');
  const fullPage = renderSessionPage(session, full, repoFacts()), fullMd = renderReportMarkdown(session, full, repoFacts());
  assert.ok(fullPage.includes(`<details class="part tier fold-tier" id="good-to-know">`));
  assert.ok(fullMd.includes(`<details><summary>${REPORT_SECTION_WORDS.tier(REPORT_TIER_WORDS.good_to_know, n)}</summary>`));
  for (const text of [fullPage, fullMd]) assert.ok(text.includes(`Good to know ${n} ${REPORT_COUNT_WORDS.folded}`));
});

test('D169: the page puts each fact about the code review under The code review, as the .md does', () => {
  const session = reportSession();
  const report = triagedReport(session);
  const model = reportModel(session, report, repoFacts());
  const code = model.notChecked.facts.filter((f) => f.group === 'code');
  assert.ok(code.length > 0, 'premise: a fact about the code review');
  const page = renderSessionPage(session, report, repoFacts());
  const md = renderReportMarkdown(session, report, repoFacts());
  const at = page.indexOf('id="not-checked"');
  const sessionH = page.indexOf(`<h3 class="sub-h">${REPORT_NOT_CHECKED_WORDS.sessionReview}</h3>`, at);
  const codeH = page.indexOf(`<h3 class="sub-h">${REPORT_NOT_CHECKED_WORDS.codeReview}</h3>`, at);
  const withheld = page.indexOf('<details class="fold">', codeH);
  assert.ok(sessionH > at && codeH > sessionH && withheld > codeH);
  const textOf = (f) => f.parts.map((p) => p.text).join('');
  for (const f of code) {
    const li = page.indexOf(`<li>${escapeHtml(textOf(f))}</li>`, at);
    assert.ok(li > codeH && li < withheld, `under The code review, before the withheld fold: ${textOf(f)}`);
  }
  // The session review's facts stay under its own heading; the .md's order is the same.
  for (const f of model.notChecked.facts.filter((x) => x.group !== 'code')) {
    const text = escapeHtml(textOf(f));
    const li = page.indexOf(text, sessionH);
    assert.ok(li > sessionH && li < codeH, `under The session review: ${textOf(f)}`);
  }
  const mdAt = md.indexOf(`#### ${REPORT_NOT_CHECKED_WORDS.codeReview}`);
  for (const f of code) assert.ok(md.indexOf(textOf(f), mdAt) > mdAt, `the .md, too: ${textOf(f)}`);
});
