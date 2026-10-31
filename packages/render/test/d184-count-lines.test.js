// D184 (0.3.0-beta.11; the owner, 2026-10-30, "Ready items first"): two count lines that said more than they showed.
// (a) "Sonah did not check N claims. The claims under What the agent did list them." counts every such row, while the
// list holds its first 50 (and a reader can cut it again): each fact now says how many of them the list holds, in each
// reader, of the rows that reader lists. (b) The fold's "Results: …" line, which has no "After its last edit" sentence
// before it, says that it covers the commands after the agent's last edit. Counts, positions and which part of the
// report only.
import test from 'node:test';
import assert from 'node:assert/strict';
import { reportModel, listedThereParts, NOT_CHECKED_LISTS, REPORT_LIMITS } from '../report-model.js';
import { renderSessionPage as renderSessionPageRaw, sessionPage as sessionPageRaw, PAGE_LIMITS } from '../session-page.js';
import { renderReportMarkdown } from '../session-story.js';
import { REPORT_NOT_CHECKED_WORDS, REPORT_HEADER_WORDS, REPORT_RESULT_PARTS, REPORT_DID_WORDS } from '../report-words.js';
import { reportSession, triagedReport, repoFacts } from './report-fixture.js';
import { sessionBuilder, STORY_KEY } from './session-story-fixture.js';
/** D195: the page's tab labels read back as the in-page links they stand for (`data-href`), so these checks read links. */
const asLinks = (html) => html.replace(/<label class="xl[^"]*" for="t-[^"]+" data-href="(#[^"]+)">([\s\S]*?)<\/label>/g,
  '<a href="$1">$2</a>');
/** D197: the page's marks on a run's outcome and a claim's status read back as plain words, so these checks read them. */
const asWords = (html) => html.replace(/<span class="out o-[^"]*">([^<]*)<\/span>/g, '$1')
  .replace(/<span class="tag c-[^"]*">/g, '<span class="tag">');
const renderSessionPage = (...args) => asWords(asLinks(renderSessionPageRaw(...args)));
const sessionPage = (...args) => { const p = sessionPageRaw(...args); return { ...p, html: asWords(asLinks(p.html)) }; };

const r = (role, eventId, quote) => ({ role, eventId, quote, sessionKey: STORY_KEY });
const esc = (text) => text.replace(/&/g, '&amp;').replace(/'/g, '&#39;');
const NOT_CHECKED = [REPORT_DID_WORDS.claimStatus.notChecked, REPORT_DID_WORDS.claimStatus.incomplete];
/** The page's claim rows of `source` that it lists as not checked (or check not seen to finish). */
const pageRows = (html, written) => [...html.matchAll(/<li id="claim-(w?)\d+"><span class="tag">([^<]*)<\/span>/g)]
  .filter(([, w, status]) => (w === 'w') === written && NOT_CHECKED.includes(status)).length;
/** The .md's claim rows of `source` that it lists as not checked, under its Claims heading. */
const mdRows = (md, written) => {
  const at = md.indexOf('#### Claims');
  if (at < 0) return 0;
  const part = md.slice(at, md.indexOf('\n#### ', at + 1));
  return part.split('\n').filter((line) => NOT_CHECKED.some((s) => line.startsWith(`- ${s} `))
    && line.includes('written into') === written).length;
};
const factOf = (text, kind) => {
  const said = kind === 'written' ? 'statement' : 'claim';
  const m = new RegExp(`Sonah did not check (\\d+) ${said}s?(?: that the agent wrote into (?:a file|files))?\\. The claims under `
    + 'What the agent did (list (?:(\\d+) of them|it|them)|do not list (?:it|them))\\.').exec(text);
  if (!m) return null;
  return { n: Number(m[1]), listed: m[2].startsWith('do not') ? 0 : m[3] ? Number(m[3]) : Number(m[1]) };
};

/** The fixture's review with `extra` more promises stated at F1 after its own: `open` (not checked) ones last. */
function manyClaims(verified, open) {
  const session = reportSession();
  const report = triagedReport(session);
  const extra = [...Array.from({ length: verified }, (_, k) => ({ status: 'verified', k })),
    ...Array.from({ length: open }, (_, k) => ({ status: 'open', k: verified + k }))].map(({ status, k }) => ({
    id: String(k).padStart(64, 'e'), stated: { ...report.promises[0].stated }, text: `Claim ${k}`, status,
    receipts: [{ ...report.promises[0].stated }] }));
  return { session, report: { ...report, promises: [...report.promises, ...extra] } };
}

test('D184 (a): a list cut to its 50 rows — the model, the page and the .md each say how many of them it lists', () => {
  const { session, report } = manyClaims(50, 4);
  const model = reportModel(session, report, repoFacts());
  assert.ok(model.did.claims.total > REPORT_LIMITS.claims && model.did.claims.shown.length === REPORT_LIMITS.claims);
  const fact = model.notChecked.facts.find((f) => f.listed?.kind === 'claims');
  // The fixture's 3 not checked, inside the 50; the 4 more past it.
  assert.deepEqual([fact.listed.n, fact.listed.at.length], [7, 3]);
  assert.equal(fact.parts[0].text, REPORT_NOT_CHECKED_WORDS.claimsThere(7, 3));
  assert.match(fact.parts[0].text, /The claims under What the agent did list 3 of them\.$/);
  const page = renderSessionPage(session, report, repoFacts());
  const md = renderReportMarkdown(session, report, repoFacts());
  for (const [text, rows] of [[page, pageRows(page, false)], [md, mdRows(md, false)]]) {
    assert.deepEqual(factOf(text, 'claims'), { n: 7, listed: rows });
    assert.equal(rows, 3);
  }
  // The written statement is inside the list: "list it", as before.
  assert.deepEqual(factOf(md, 'written'), { n: 1, listed: 1 });
});

test('D184 (a): every row inside the list — the words of beta.10, byte for byte', () => {
  const session = reportSession();
  const report = triagedReport(session);
  const model = reportModel(session, report, repoFacts());
  const texts = model.notChecked.facts.filter((f) => f.listed).map((f) => f.parts.map((p) => p.text).join(''));
  assert.deepEqual(texts, ['Sonah did not check 3 claims. The claims under What the agent did list them.',
    'Sonah did not check 1 statement that the agent wrote into a file. The claims under What the agent did list it.']);
  for (const text of [renderSessionPage(session, report, repoFacts()), renderReportMarkdown(session, report, repoFacts())])
    for (const t of texts) assert.ok(text.includes(esc(t)) || text.includes(t), t);
});

test('D184 (a): the words and the one helper: all, some, none; one or many; each kind apart', () => {
  const W = REPORT_NOT_CHECKED_WORDS;
  assert.equal(W.claimsThere(3), W.claimsThere(3, 3));
  assert.match(W.claimsThere(26, 21), /list 21 of them\.$/);
  assert.match(W.claimsThere(3, 0), /do not list them\.$/);
  assert.match(W.claimsThere(1, 0), /do not list it\.$/);
  assert.match(W.writtenThere(1, 0), /^Sonah did not check 1 statement that the agent wrote into a file\. .* do not list it\.$/);
  assert.match(W.writtenThere(26, 21), /list 21 of them\.$/);
  const text = (listed, rows) => listedThereParts(listed, rows).map((p) => p.text).join('');
  assert.equal(text({ kind: 'claims', n: 3, at: [0, 4, 60] }, 50), W.claimsThere(3, 2));
  assert.equal(text({ kind: 'claims', n: 3, at: [0, 4, 60] }, 0), W.claimsThere(3, 0));
  assert.equal(text({ kind: 'written', n: 2, at: [1, 2] }, 50), W.writtenThere(2));
  assert.equal(listedThereParts({ kind: 'claims', n: 1, at: [0] }, 1)[0].href, 'did');
  assert.deepEqual(NOT_CHECKED_LISTS, ['claims', 'written']);
});

test('D184 (a): the .md that counts its claims in place of listing them says the list there lists none', () => {
  // A long review whose .md leaves out the rows of What the agent did (`didCounts`) and no later step's: 40 more asks not
  // done (each an item of Must act, never shortened) and 200 more files of the change (rows of What the agent did).
  // D199: the .md says fewer notes, so it takes more asks to reach that step (was 30; 32 to 55 do).
  const { session, report } = manyClaims(0, 0);
  const asks = Array.from({ length: 40 }, (_, k) => ({ text: `ask ${k}`, status: 'not-done',
    instruction: report.requirements[0].instruction, shortfall: report.requirements[1].shortfall }));
  const files = Array.from({ length: 200 }, (_, k) => ({ path: `src/a/rather/long/folder/name/for/the/file/number/${k}`
    + `/of/the/change/module-${k}.js`, type: 'added', state: 'shown', sha256: 'f'.repeat(64), hunks: 1 }));
  const long = { ...report, requirements: [...report.requirements, ...asks],
    codePass: { ...report.codePass, files: [...report.codePass.files, ...files] } };
  const md = renderReportMarkdown(session, long, repoFacts());
  assert.ok(md.includes('#### Claims\n\nSonah does not show'), 'premise: the .md counts its claims');
  assert.ok(!/#### The session review\n\n[^\n]+\n\nSonah does not show/.test(md), 'premise: it lists its facts');
  assert.equal(mdRows(md, false), 0);
  assert.deepEqual(factOf(md, 'claims'), { n: 3, listed: 0 });
  assert.deepEqual(factOf(md, 'written'), { n: 1, listed: 0 });
  // The page lists them, and says so.
  const page = renderSessionPage(session, long, repoFacts());
  assert.deepEqual(factOf(page, 'claims'), { n: 3, listed: pageRows(page, false) });
});

test('D184 (a): the page cut to its size says how many of them the rows it keeps hold', () => {
  const b = sessionBuilder();
  const asks = [];
  // D195: the page's marks of your asks are shorter, so it takes more of them to reach the bound (was 1,344). D199: an
  // ask's checklist row is a row of columns, so it takes fewer to reach it and stay in it (was 1,368; 1,352 to 1,360 do).
  // D202: the legend's lines and the done asks' fold take room, so it takes fewer (was 1,354; 1,300 to 1,352 do).
  for (let a = 0; a < 1_340; a++) {
    b.ask(`I${a}`, `Ask number ${a}: please make the case ${a} pass. ${'Some long context words here. '.repeat(20)}`);
    asks.push({ text: `pass ${a}`, instruction: r('instruction', `I${a}`, `please make the case ${a} pass.`), status: 'done',
      deliverable: r('code', 'W1', 'export const a = 1;') });
  }
  b.change('W1', 'src/a.js', { after: 'export const a = 1;\n' });
  b.say('F1', 'It works. It is fast. It is safe. It is small.', 'final');
  const session = b.session();
  const said = ['It works.', 'It is fast.', 'It is safe.', 'It is small.'];
  const promises = Array.from({ length: 48 }, (_, k) => ({ id: String(k).padStart(64, 'c'), stated: r('commentary', 'F1',
    said[k % 4]), text: `claim ${k}`, status: k % 12 === 0 ? 'open' : 'verified', receipts: [r('commentary', 'F1', said[k % 4])] }));
  const report = { windowResults: [{ windowIndex: 0, eventIds: session.events.map((e) => e.id), failure: null }],
    sessionReview: 'complete', coverage: 'complete', requirements: asks, promises };
  const { html, whole } = sessionPage(session, report, {});
  assert.equal(whole, false, 'premise: the page is cut to its bound');
  assert.ok(Buffer.byteLength(html, 'utf8') <= PAGE_LIMITS.maxBytes);
  const listed = pageRows(html, false);
  const model = reportModel(session, report, {});
  assert.equal(model.did.claims.notChecked.claims, 4);
  assert.ok(listed < 4, `premise: the page lists fewer (${listed})`);
  assert.deepEqual(factOf(html, 'claims'), { n: 4, listed });
});

test('D184 (b): the fold\'s results line says what it covers; the header\'s open line is unchanged', () => {
  const b = sessionBuilder();
  b.ask('I1', 'Fix the parser.');
  b.change('W1', 'src/p.js', { after: 'export const p = 1;\n' });
  b.run('R1', 'npm test', 'succeeded', 'ok');
  // E1: a command after the last edit with no result that Sonah read (a part that says what Sonah could not read).
  b.events.push({ sequence: b.events.length, id: 'E1', kind: 'invocation', callKey: 'E1', tool: 'bash',
    operation: 'command', paths: [], command: [], input: [], changes: [] });
  const session = b.session();
  const report = { windowResults: [{ windowIndex: 0, eventIds: session.events.map((e) => e.id), failure: null }],
    sessionReview: 'complete', coverage: 'complete', requirements: [] };
  const model = reportModel(session, report, {});
  const read = model.notChecked.quiet.filter((line) => line.startsWith('Results'));
  assert.deepEqual(read, [REPORT_HEADER_WORDS.resultsAfterEdit(REPORT_RESULT_PARTS['no-result'](1))]);
  assert.deepEqual(read, ["Results of the commands after the agent's last edit: for 1 Sonah found no result."]);
  // The header keeps its open line, after its scoped sentence, as before.
  assert.deepEqual(model.header.runs, ['After its last edit, the agent ran 2 commands.', 'Results: 1 exited with code 0.']);
  const page = renderSessionPage(session, report, {});
  const md = renderReportMarkdown(session, report, {});
  assert.ok(page.includes(`<li>${esc(read[0])}</li>`));
  assert.ok(md.includes(`- ${read[0]}`));
  assert.ok(!page.includes('<li>Results: ') && !md.includes('\n- Results: '));
});
