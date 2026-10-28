// D133 (R2): what Sonah could not check is said in its fold, with its counts; the first screen keeps the count line.
// Quiet, folded, never false: each line about what Sonah could not check moves, word for word and with its count, into
// a fold — What Sonah could not check, an ask row's own fold, or an item's evidence fold — and "Sonah checked only the
// marked parts of your message." is said once, in the page's legend.
// The invariants, over every review the render tests hold (the fixtures' shapes, the story and long sessions, the
// checklist session, and a generated session of many asks): outside a fold no sentence of Sonah's about what it could
// not check appears more than twice; each moved count equals the fold's; every moved line is in the fold, never open.
//
// Every session and report here is synthetic.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readdir } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { join } from 'node:path';
import { renderSessionPage, sessionPage, escapeHtml } from '../session-page.js';
import { renderReportMarkdown } from '../session-story.js';
import { reportModel, REPORT_FOLD_CHOICES, reportItems } from '../report-model.js';
import { REPORT_PROMPT_WORDS, REPORT_NOT_CHECKED_PARTS, REPORT_HEADER_WORDS, REPORT_COUNT_WORDS, REPORT_ITEM_WORDS,
  REPORT_TRIM_WORDS, REPORT_NOT_CHECKED_WORDS, REPORT_SECTION_WORDS } from '../report-words.js';
import { coverageCauses } from '../../evidence/src/review.js';
import { honestStatuses } from '../../evidence/src/ledger.js';
import { moduleEntries, WORD_MODULE_DIRS, WORD_MODULES_NAMED } from './style-lint.js';
import { READ_CENSUS } from './absence-audit.js';
import { REPORT_SHAPES, reportSession, triagedReport, repoFacts } from './report-fixture.js';
import { sessionBuilder, storySession, storyReport, STORY_KEY } from './session-story-fixture.js';
import { longSession, longReport } from './session-story-long-fixture.js';
import { checklistSession, checklistReport } from './session-page-checklist-fixture.js';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));

/** Every fixed sentence of Sonah's that says what it, its session review or its code review could not read, find,
 *  check, keep, show or run (the absence audit's class `sonah`, read by a person: never by a word of the sentence), as
 *  rendered by the linter's fixtures: whole sentences of four words or more. */
async function sonahSentences() {
  const paths = [...WORD_MODULES_NAMED];
  for (const dir of WORD_MODULE_DIRS)
    for (const name of (await readdir(join(ROOT, dir))).sort()) if (name.endsWith('.js')) paths.push(`${dir}/${name}`);
  const out = new Set();
  for (const path of [...new Set(paths)]) {
    const ns = await import(pathToFileURL(join(ROOT, path)).href);
    if (!Object.hasOwn(ns, 'STYLE_KINDS')) continue;
    for (const entry of moduleEntries(path, ns).entries) {
      if (READ_CENSUS[path]?.[entry.key]?.[0] !== 'sonah') continue;
      for (const sentence of String(entry.text).split(/(?<=\.)\s+(?=[A-Z])/))
        if (sentence.endsWith('.') && sentence.split(/\s+/).length >= 4) out.add(sentence);
    }
  }
  return [...out];
}

const unescape = (text) => text.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
  .replace(/&#39;/g, "'").replace(/&amp;/g, '&');
/** The page's text with every fold closed: a `<details>` shows only its own summary; styles go. Structure only. */
function closedText(html) {
  const body = html.replace(/<style>[\s\S]*?<\/style>/g, '');
  let out = '', depth = 0, summary = 0, last = 0;
  for (const m of body.matchAll(/<\/?(details|summary)\b[^>]*>|<[^>]+>/g)) {
    if (depth === 0 || summary) out += body.slice(last, m.index);
    last = m.index + m[0].length;
    const close = m[0][1] === '/';
    if (m[1] === 'details') depth += close ? -1 : 1;
    else if (m[1] === 'summary' && depth === 1) summary += close ? -1 : 1;
    out += ' ';
  }
  out += body.slice(last);
  return unescape(out).replace(/\s+/g, ' ');
}
/** The page's fold What Sonah could not check, as markup. */
const notCheckedFold = (html) => html.slice(html.indexOf('id="not-checked"'), html.indexOf('<footer'));
/** The .md's fold What Sonah could not check, as text with Markdown's escapes taken out. */
const mdFoldText = (md) => md.slice(md.indexOf('<details><summary>What Sonah could not check')).replace(/\\(.)/g, '$1');
const count = (text, part) => text.split(part).length - 1;
const list = (value) => (Array.isArray(value) ? value : []);

/** A session of many asks: done ones that cite only the agent's words, not-checked ones, and a result of a run that
 *  Sonah read no exit code of, across three messages — the lines that repeat on a long session. */
function manySession() {
  const b = sessionBuilder();
  const asks = [];
  for (let k = 1; k <= 3; k++) {
    const words = Array.from({ length: 4 }, (_, i) => `Do task ${k}${i}.`);
    b.ask(`I${k}`, words.join(' '));
    asks.push(...words.map((text) => [`I${k}`, text]));
    b.say(`C${k}`, `I did all four tasks of part ${k}.`, 'commentary');
  }
  b.change('W1', 'src/a.js', { after: 'export const a = 1;\n' });
  b.say('F1', 'Done.', 'final');
  const session = b.session();
  const r = (role, eventId, quote) => ({ role, eventId, quote, sessionKey: STORY_KEY });
  const report = { coverage: 'complete', sessionReview: 'complete', windowResults: [{ windowIndex: 0,
    eventIds: session.events.map((e) => e.id), failure: null }],
  requirements: asks.map(([id, text], i) => (i % 3 === 2
    ? { text, instruction: r('instruction', id, text), status: 'not-checked', reason: 'deliverable_ungrounded' }
    : { text, instruction: r('instruction', id, text), status: 'done',
      deliverable: r('commentary', `C${id.slice(1)}`, `I did all four tasks of part ${id.slice(1)}.`) })) };
  return { session, report };
}

/** Every review the render tests hold, by name: `{ session, report, options }`. */
function cases() {
  const out = {};
  for (const [letter, shape] of Object.entries(REPORT_SHAPES)) {
    const session = reportSession();
    out[`shape ${letter}`] = { session, report: shape(session), options: repoFacts() };
  }
  out.story = { session: storySession(), report: storyReport(), options: {} };
  const long = longSession();
  out.long = { session: long.session, report: longReport(long.session, long.windows), options: {} };
  out.checklist = { session: checklistSession(), report: checklistReport(), options: {} };
  out.many = { ...manySession(), options: {} };
  out['missing quote'] = { ...missingQuote(), options: repoFacts() };
  out.unlocated = { ...unlocatedSession(), options: {} };
  return out;
}

/** One message whose three asks the session review gave in its own words (none found in your message): the .md said
 *  that on each row (D133's review). */
function unlocatedSession() {
  const b = sessionBuilder();
  b.ask('I1', 'Please clean up the parser, write docs for it, and speed up the tests.');
  b.say('F1', 'Done.', 'final');
  const session = b.session();
  const r = (role, eventId, quote) => ({ role, eventId, quote, sessionKey: STORY_KEY });
  const report = { windowResults: [{ windowIndex: 0, eventIds: session.events.map((e) => e.id), failure: null }],
    sessionReview: 'complete', coverage: 'complete', requirements: ['Refactor the parsing code', 'Document the parser module',
      'Make the test suite faster'].map((text) => ({ text, status: 'not-checked', ask: 'I1',
      instruction: r('instruction', 'I1', text), located: false })) };
  return { session, report };
}

/** The fixture's report with a finding whose quote the recording does not hold (as session-page-report D97 (9)): its item
 *  says that Sonah did not find the quote. */
function missingQuote(base = null) {
  const session = reportSession();
  const report = base ?? triagedReport(session);
  report.findings[0] = { ...report.findings[0], receipts: [{ ...report.findings[0].receipts[0],
    quote: 'The limiter uses Redis everywhere.' }, report.findings[0].receipts[1]] };
  return { session, report };
}

test('D133: the two placements the owner confirmed (2026-10-22) are on', () => {
  assert.deepEqual(REPORT_FOLD_CHOICES, { notCheckedLine: true, continuedUnread: true });
  assert.ok(Object.isFrozen(REPORT_FOLD_CHOICES));
});

test('D133: outside a fold, no sentence of Sonah\'s about what it could not check appears more than twice', async () => {
  const sentences = await sonahSentences();
  // The audit's class holds the moved sentences, so the invariant reads them.
  for (const s of [REPORT_PROMPT_WORDS.coverage, REPORT_PROMPT_WORDS.agentOnly, REPORT_ITEM_WORDS.askedUnknown,
    REPORT_ITEM_WORDS.quoteMissing, REPORT_PROMPT_WORDS.codeHoldsUnchecked]) assert.ok(sentences.includes(s), s);
  let messages = 0, agentOnly = 0, unlocated = 0;
  for (const [name, { session, report, options }] of Object.entries(cases())) {
    const html = renderSessionPage(session, report, { sessionHash: 'a'.repeat(64), ...options });
    const model = reportModel(session, report, options);
    messages += model.prompt.messages.length;
    agentOnly += model.prompt.asks.filter((a) => a.folded.some((l) => l[0]?.text === REPORT_PROMPT_WORDS.agentOnly)).length;
    const closed = closedText(html);
    for (const s of sentences) assert.ok(count(closed, s) <= 2, `${name}: ${count(closed, s)} × ${s}`);
    // The legend says the coverage sentence once, when the page marks a message.
    assert.equal(count(closed, REPORT_PROMPT_WORDS.coverage), model.prompt.messages.length ? 1 : 0, name);
    // D133's review: the same in the .md, its text outside every fold, Markdown's escapes taken out.
    const md = closedText(renderReportMarkdown(session, report, options)).replace(/\\(.)/g, '$1');
    for (const s of sentences) assert.ok(count(md, s) <= 2, `${name} (.md): ${count(md, s)} × ${s}`);
    unlocated += model.prompt.messages.reduce((n, m) => Math.max(n, m.unlocated.length), 0) >= 3 ? 1 : 0;
  }
  assert.ok(unlocated >= 1, 'a message with three asks Sonah could not find in it');
  // The cases reach the lines that repeat: many messages, and many asks that cite only the agent's words.
  assert.ok(messages >= 20 && agentOnly >= 6, `${messages} messages, ${agentOnly} asks`);
});

test('D133: each moved line is in its fold, word for word, never open; each moved count equals the fold\'s', () => {
  let quiet = 0, folded = 0;
  for (const [name, { session, report, options }] of Object.entries(cases())) {
    const model = reportModel(session, report, options);
    const html = renderSessionPage(session, report, { sessionHash: 'a'.repeat(64), ...options });
    const md = renderReportMarkdown(session, report, options);
    const closed = closedText(html);
    const fold = notCheckedFold(html);
    // The first screen's lines: in the page's fold and the .md's, never open; the header says none of them.
    assert.equal(model.header.didNotCheck, null, name);
    for (const line of model.notChecked.quiet) {
      quiet++;
      assert.ok(fold.includes(escapeHtml(line)), `${name}: ${line}`);
      assert.ok(!closed.includes(line), `${name}: open: ${line}`);
      assert.ok(mdFoldText(md).includes(`- ${line}`), `${name}: .md: ${line}`);
    }
    // The fold's heading counts what it counted before D133: the moved lines are shown uncounted.
    const nc = model.notChecked;
    assert.equal(nc.total, nc.facts.length + nc.withheldTotal + nc.unreadAsks.length + nc.unreadRows.length, name);
    assert.ok(fold.includes(escapeHtml(REPORT_SECTION_WORDS.notCheckedCounted(nc.total))), name);
    // The header's line, as the fold says it, counts what the rows' folds hold: the asks not checked, and the done asks
    // that cite only the agent's words.
    const phrases = nc.didNotCheck?.phrases ?? [];
    const asks = model.prompt.asks;
    const notChecked = asks.filter((a) => ['notChecked', 'notCheckedCode'].includes(a.state)).length;
    const cited = asks.filter((a) => a.folded.some((l) => l[0]?.text === REPORT_PROMPT_WORDS.agentOnly)).length;
    if (notChecked) assert.ok(phrases.includes(REPORT_NOT_CHECKED_PARTS.asks(notChecked)) || nc.didNotCheck?.more, name);
    if (cited) assert.ok(phrases.includes(REPORT_NOT_CHECKED_PARTS.agentOnly(cited)) || nc.didNotCheck?.more, name);
    if (nc.didNotCheck) assert.ok(nc.quiet.includes(`${REPORT_HEADER_WORDS.notCheckedLead} ${phrases.join(' · ')}`
      + `${nc.didNotCheck.more ? ` ${nc.didNotCheck.more}` : ''}`), name);
    // An ask's folded lines are in its own fold on the page, after its status, and in its .md row.
    for (const ask of asks.filter((a) => a.folded.length)) {
      folded++;
      const li = new RegExp(`<li(?: id="ask-${ask.n}")?>ask ${ask.n} · [\\s\\S]*?</li>`).exec(html)?.[0] ?? '';
      const at = li.indexOf('<details class="row-evidence">');
      assert.ok(at > 0, `${name}: ask ${ask.n}`);
      for (const line of ask.folded) assert.ok(li.indexOf(escapeHtml(line.map((p) => p.text).join(''))) > at,
        `${name}: ask ${ask.n}`);
    }
    // Must act and Must know empty: the count line says what Sonah found; the sentence after it is in the fold.
    if (model.countLine.empty) {
      assert.equal(model.countLine.empty, REPORT_COUNT_WORDS.emptyTiers);
      assert.ok(nc.quiet.includes(REPORT_COUNT_WORDS.notCorrect), name);
    }
  }
  assert.ok(quiet >= 8 && folded >= 10, `${quiet} lines in the fold, ${folded} rows with a fold`);
});

test('D133: a page past its size keeps, in each evidence fold it shortens, what Sonah could not check of the item', () => {
  // 1,500 more decisions that Sonah could not tie to an ask: the page leaves out the evidence folds' lines to fit.
  const session = reportSession();
  const r = triagedReport(session);
  const d = r.decisions.find((x) => x.dimension === 'limit per client');
  const big = { ...r, decisions: [...r.decisions, ...Array.from({ length: 1_500 }, (_, i) => ({ ...d,
    dimension: `${d.dimension} ${i}`, chosen: `${d.chosen} ${i} ${'x'.repeat(200)}` }))] };
  const page = sessionPage(session, big, {});
  assert.equal(page.whole, false, 'the page left something out');
  const items = reportItems(reportModel(session, big, {})).filter((item) => item.scope?.askedUnknown
    && !item.scope?.notAsked);
  assert.ok(items.length > 1_500);
  assert.equal(count(page.html, REPORT_ITEM_WORDS.askedUnknown), items.length);
});

/** A report whose .md is shortened past the step that cuts the lists of What Sonah could not check to counts: 100 more
 *  decisions and 100 more withheld proposals, with a coverage that two causes cut short. */
function shortenedCase() {
  const session = reportSession();
  const r = triagedReport(session);
  const d = r.decisions.find((x) => x.dimension === 'limit per client');
  const w = r.codePass.withheld[0];
  const report = { ...r, coverage: 'partial', coverageFacts: { windows: 1, windowsFailed: 0, actions: 5,
    instructionsElided: 2, delegationsUnlinked: 3 },
  decisions: [...r.decisions, ...Array.from({ length: 100 }, (_, i) => ({ ...d, dimension: `${d.dimension} ${i}`,
    chosen: `${d.chosen} ${i} ${'x'.repeat(200)}` }))],
  codePass: { ...r.codePass, withheld: [...r.codePass.withheld, ...Array.from({ length: 100 }, (_, i) => ({ ...w,
    text: `${w.text} ${i} ${'y'.repeat(200)}` }))] } };
  return { session, report };
}

test('D133 (its review): a shortened .md keeps every coverage cause with its count, and every line moved off the first '
  + 'screen, whole', () => {
  const { session, report } = shortenedCase();
  const md = renderReportMarkdown(session, report, {});
  const fold = mdFoldText(md);
  assert.ok(md.includes(REPORT_TRIM_WORDS.mdShortened));
  // The fold's other lists are cut to counts here.
  assert.match(fold, new RegExp(REPORT_NOT_CHECKED_WORDS.rowsNotShown(3).replace(/[.]/g, '\\.')));
  const model = reportModel(session, report, {});
  const causes = model.notChecked.facts.filter((f) => f.cause === true).map((f) => f.parts.map((p) => p.text).join(''));
  // Every cause the review declares (the terminal's "Not covered" line before D133), each with its count.
  const declared = coverageCauses({ ...report, ...honestStatuses({ ...report, findings: [] }) });
  assert.equal(causes.length, declared.length);
  assert.ok(declared.length >= 2);
  for (const [cause, counts] of declared) assert.ok(causes.some((t) => t.includes(String(counts.n))), cause);
  for (const line of causes) assert.ok(fold.includes(`- ${line}`), line);
  // The lines moved off the first screen, whole.
  assert.ok(model.notChecked.quiet.length >= 1);
  for (const line of model.notChecked.quiet) assert.ok(fold.includes(`- ${line}`), line);
});

test('D133 (its review): "Sonah did not find this quote in the recording." is its item\'s evidence fold\'s first line, '
  + 'never on the item\'s visible lines, also when the fold is shortened', () => {
  const said = REPORT_ITEM_WORDS.quoteMissing;
  const { session, report } = missingQuote();
  const items = reportItems(reportModel(session, report, repoFacts())).filter((i) => i.quoteMissing);
  assert.ok(items.length >= 1 && items.some((i) => i.tier.final !== 'good_to_know'), 'an open item without its quote');
  const html = renderSessionPage(session, report, repoFacts());
  assert.equal(count(closedText(html), said), 0);
  for (const item of items) {
    const at = html.indexOf(`id="item-${item.n}"`);
    const fold = html.indexOf('<details class="evidence"><summary>', at);
    const body = html.indexOf('</summary>', fold) + '</summary>'.length;
    assert.ok(html.startsWith(`<p class="note">${escapeHtml(said)}</p>`, body), `item ${item.n}`);
  }
  const md = renderReportMarkdown(session, report, repoFacts());
  // In the .md: only as the first line of an evidence fold.
  const lines = md.split('\n');
  const at = lines.flatMap((line, i) => (line.includes(said) ? [i] : []));
  assert.equal(at.length, items.length);
  for (const i of at) {
    assert.equal(lines[i], `- ${said}`);
    assert.match(lines[i - 2], /^<details><summary>Evidence · Why /);
  }
  // Shortened past Must act's evidence (150 more code findings): the item's fold keeps it (`foldNotes`), and only it.
  const f = report.codePass.findings[0];
  const big = { ...report, codePass: { ...report.codePass, findings: [...report.codePass.findings,
    ...Array.from({ length: 150 }, (_, i) => ({ ...f, id: `sha256:${String(i).padStart(64, 'a')}`, title: `${f.title} ${i}`,
      trace: list(f.trace).map((t) => ({ ...t, step: `${t.step} ${'w'.repeat(200)} ${i}` })) }))] } };
  const shortMd = renderReportMarkdown(session, big, repoFacts());
  assert.ok(shortMd.includes(REPORT_TRIM_WORDS.mdShortened));
  const kept = [...shortMd.matchAll(/<details><summary>Evidence · Why Must act<\/summary>\n\n([\s\S]*?)\n\n<\/details>/g)]
    .map((m) => m[1]);
  assert.deepEqual(kept, [`- ${said}`], 'Must act\'s evidence is cut; the missing quote\'s note stays');
});
