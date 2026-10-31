// D133 (R2): what Sonah could not check is said in its fold, with its counts; the first screen keeps the count line.
// Quiet, folded, never false: each line about what Sonah could not check moves, word for word and with its count, into
// a fold — What Sonah could not check, an ask row's own fold, or an item's evidence fold — and "Sonah checked only the
// marked parts of your message." is said once, in the page's legend.
// The invariants, over every review the render tests hold (the fixtures' shapes, the story and long sessions, the
// checklist session, and a generated session of many asks): outside a fold no sentence of Sonah's about what it could
// not check appears more than twice; each moved count equals the fold's; every moved line is in the fold, never open.
// D199 (the owner, 2026-10-30, "All of them"): an ask row's fold, an item's fold notes and the legend's coverage line are
// gone from every reader; What Sonah could not check keeps its lines and counts.
// D200 (the owner, 2026-10-31: "bring back the precision markers as short tags"): an ask's and an item's short tags are
// back on their rows, the sentence each stands for only as the tag's title on the page; the coverage line is said once on
// each reader again. D200 (review round): no title; the sentence is the tag's `.tip`, a span hidden until a pointer or
// focus shows it, read here as hidden as the title was (it is the sentence the tag stands for, not open text); the .md's
// coverage line is its own (REPORT_MD_WORDS.coverage, or coverageAsks when its table is shortened).
//
// Every session and report here is synthetic.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readdir } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { join } from 'node:path';
import { renderSessionPage, sessionPage, escapeHtml } from '../session-page.js';
import { renderReportMarkdown, REPORT_MD_WORDS } from '../session-story.js';
import { reportModel, REPORT_FOLD_CHOICES, reportItems } from '../report-model.js';
import { REPORT_PROMPT_WORDS, REPORT_NOT_CHECKED_PARTS, REPORT_HEADER_WORDS, REPORT_COUNT_WORDS, REPORT_ITEM_WORDS,
  REPORT_TRIM_WORDS, REPORT_NOT_CHECKED_WORDS, REPORT_SECTION_WORDS, REPORT_DECISION_TAGS } from '../report-words.js';
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

/** D200 (review round): a tag's sentence, its `.tip` span, hidden until a pointer or focus shows it: no open text. */
const withoutTips = (html) => html.replace(/ <span class="tip">[^<]*<\/span>/g, '');
const unescape = (text) => text.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
  .replace(/&#39;/g, "'").replace(/&amp;/g, '&');
/** The page's text with every fold closed: a `<details>` shows only its own summary; styles go. Structure only. */
function closedText(html) {
  let body = withoutTips(html).replace(/<style>[\s\S]*?<\/style>/g, '');
  // D193: a panel after the first is a tab the reader opens, closed as a fold is.
  const panels = [...body.matchAll(/<(?:div|section) class="[^"]*\bpanel\b[^"]*"/g)].map((m) => m.index);
  if (panels.length > 1) body = body.slice(0, panels[1]) + body.slice(body.indexOf('<footer'));
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
  // D199: the coverage sentence is gone from the words (and from every page and .md below). D200: it is back, said once
  // on each reader.
  assert.equal(REPORT_PROMPT_WORDS.coverage, 'Sonah checked only the marked parts of your message.');
  for (const s of [REPORT_PROMPT_WORDS.agentOnly, REPORT_ITEM_WORDS.askedUnknown,
    REPORT_ITEM_WORDS.quoteMissing, REPORT_PROMPT_WORDS.codeHoldsUnchecked, REPORT_PROMPT_WORDS.coverage])
    assert.ok(sentences.includes(s), s);
  let messages = 0, agentOnly = 0, unlocated = 0;
  for (const [name, { session, report, options }] of Object.entries(cases())) {
    const html = renderSessionPage(session, report, { sessionHash: 'a'.repeat(64), ...options });
    const model = reportModel(session, report, options);
    messages += model.prompt.messages.length;
    agentOnly += model.prompt.asks.filter((a) => a.folded.some((l) => l[0]?.text === REPORT_PROMPT_WORDS.agentOnly)).length;
    const closed = closedText(html);
    for (const s of sentences) assert.ok(count(closed, s) <= 2, `${name}: ${count(closed, s)} × ${s}`);
    // D199: no reader says which parts of your message Sonah checked (the legend said it once, when the page marked a
    // message; the .md under its table). D200: once on each reader again: the page's first line in the fold of your
    // messages, never open; the .md's under its table of your asks.
    const whole = renderReportMarkdown(session, report, options);
    assert.equal(count(html, REPORT_PROMPT_WORDS.coverage), model.prompt.messages.length ? 1 : 0, name);
    assert.equal(count(closed, REPORT_PROMPT_WORDS.coverage), 0, name);
    // D200 (review round): the .md's own words, the table's or (shortened) the asks', never the page's "marked parts".
    assert.equal(count(whole, REPORT_PROMPT_WORDS.coverage), 0, name);
    assert.equal(count(whole, REPORT_MD_WORDS.coverage) + count(whole, REPORT_MD_WORDS.coverageAsks),
      model.prompt.asks.length ? 1 : 0, name);
    // D133's review: the same in the .md, its text outside every fold, Markdown's escapes taken out.
    const md = closedText(whole).replace(/\\(.)/g, '$1');
    for (const s of sentences) assert.ok(count(md, s) <= 2, `${name} (.md): ${count(md, s)} × ${s}`);
    unlocated += model.prompt.messages.reduce((n, m) => Math.max(n, m.unlocated.length), 0) >= 3 ? 1 : 0;
  }
  assert.ok(unlocated >= 1, 'a message with three asks Sonah could not find in it');
  // The cases reach the lines that repeat: many messages, and many asks that cite only the agent's words.
  assert.ok(messages >= 20 && agentOnly >= 6, `${messages} messages, ${agentOnly} asks`);
});

test('D133: each moved line is in its fold, word for word, never open; each moved count equals the fold\'s', () => {
  let quiet = 0, folded = 0, tagged = 0;
  for (const [name, { session, report, options }] of Object.entries(cases())) {
    const model = reportModel(session, report, options);
    const html = renderSessionPage(session, report, { sessionHash: 'a'.repeat(64), ...options });
    const md = renderReportMarkdown(session, report, options);
    const closed = closedText(html);
    const fold = notCheckedFold(html);
    // The first screen's lines: in the page's fold and the .md's, never open; the header says none of them.
    assert.equal(model.header.didNotCheck, null, name);
    // D199: the page shows the line of what Sonah did not check as chips, its words the same: read as text.
    const foldText = unescape(fold.replace(/<[^>]+>/g, ''));
    for (const line of model.notChecked.quiet) {
      quiet++;
      assert.ok(foldText.includes(line), `${name}: ${line}`);
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
    // D199: an ask's folded lines (the model keeps them; the line above counts them) are in no fold of its row, on the
    // page or in the .md's table: no row holds a fold.
    assert.equal(html.slice(html.indexOf('<main')).includes('row-evidence'), false, name);
    const rows = md.split('\n').filter((l) => l.startsWith('| '));
    assert.equal(rows.some((row) => row.includes('<details>')), false, name);
    // D200: but a line its tag stands for is the tag's title on the page (never the row's text), and each tag's sentence
    // is one of the lines the model keeps folded. D200 (review round): the tag's `.tip`, hidden, in place of the title.
    for (const ask of asks.filter((a) => a.folded.length)) {
      folded++;
      const li = new RegExp(`<li id="ask-${ask.n}" class="ask-row">[\\s\\S]*?</li>`).exec(html)?.[0] ?? '';
      // D202: the row's one fold is its evidence (what does it, how the session review read it, the agent's message
      // before), never these lines.
      assert.equal(li.replace(/<div class="ad acts">[\s\S]*?<\/details><\/div>/g, '').includes('<details'), false,
        `${name}: ask ${ask.n}`);
      for (const line of ask.folded) {
        const words = line.map((p) => p.text).join('');
        assert.equal(count(li, escapeHtml(words)), count(li, `<span class="tip">${escapeHtml(words)}</span>`),
          `${name}: ask ${ask.n}: ${words}`);
        assert.equal(unescape(withoutTips(li).replace(/<[^>]+>/g, '')).includes(words), false, `${name}: ask ${ask.n}: ${words}`);
        assert.equal(rows.some((row) => row.replace(/\\(.)/g, '$1').includes(words)), false, `${name}: ask ${ask.n} (.md)`);
      }
    }
    for (const ask of asks) {
      const said = ask.folded.map((line) => line.map((p) => p.text).join(''));
      for (const tag of list(ask.tags).filter((t) => t.key !== 'withheld')) {
        tagged++;
        assert.ok(said.includes(tag.words), `${name}: ask ${ask.n}: ${tag.key}`);
      }
    }
    // Must act and Must know empty: the count line says what Sonah found; the sentence after it is in the fold.
    if (model.countLine.empty) {
      assert.equal(model.countLine.empty, REPORT_COUNT_WORDS.emptyTiers);
      assert.ok(nc.quiet.includes(REPORT_COUNT_WORDS.notCorrect), name);
    }
  }
  assert.ok(quiet >= 8 && folded >= 10 && tagged >= 10,
    `${quiet} lines in the fold, ${folded} rows with a fold, ${tagged} tags`);
});

test('D133, D199: a page past its size shortens each evidence fold to its summary; no fold says what Sonah could not check '
  + 'of the item', () => {
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
  // D199 (the owner, 2026-10-30, "All of them"): the model still knows each; no reader says it, shortened or not.
  assert.equal(count(page.html, REPORT_ITEM_WORDS.askedUnknown), 0);
  assert.equal(count(renderReportMarkdown(session, big, {}), REPORT_ITEM_WORDS.askedUnknown), 0);
  assert.ok(page.html.includes(`<details class="evidence"><summary>${REPORT_ITEM_WORDS.evidence}</summary></details>`),
    'a shortened fold keeps its summary');
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
  // The fold's other lists are cut to counts here (D199's review: the session's list holds one more fact, the done asks
  // whose row cites only the agent's words, so 4 where it was 3).
  assert.match(fold, new RegExp(REPORT_NOT_CHECKED_WORDS.rowsNotShown(4).replace(/[.]/g, '\\.')));
  const model = reportModel(session, report, {});
  const agentOnly = model.notChecked.facts.filter((f) => f.group === 'session'
    && f.parts.map((p) => p.text).join('').startsWith(REPORT_NOT_CHECKED_WORDS.agentOnlyAsks(1)));
  assert.equal(agentOnly.length, 1);
  assert.ok(!fold.includes(REPORT_NOT_CHECKED_WORDS.agentOnlyAsks(1)), 'among the facts cut to a count');
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

test('D133 (its review), D199, D200: "Sonah did not find this quote in the recording." is on no reader\'s lines (D200: only '
  + 'its tag\'s title), in no evidence fold and on no item\'s visible lines, also when the report is shortened', () => {
  // D199 (the owner, 2026-10-30, "All of them"): D133's review put it first in its item's evidence fold, kept when the fold
  // was shortened; no reader says it now. The model keeps `quoteMissing`, and the quote is never shown.
  const said = REPORT_ITEM_WORDS.quoteMissing;
  const { session, report } = missingQuote();
  const items = reportItems(reportModel(session, report, repoFacts())).filter((i) => i.quoteMissing);
  assert.ok(items.length >= 1 && items.some((i) => i.tier.final !== 'good_to_know'), 'an open item without its quote');
  const html = renderSessionPage(session, report, repoFacts());
  const md = renderReportMarkdown(session, report, repoFacts());
  // D200: the item's short tag says it (REPORT_DECISION_TAGS.quoteMissing), the sentence only as the tag's title on the
  // page; the .md's item head carries the tag. D200 (review round): the sentence is the tag's hidden `.tip`, no title.
  const missing = items.filter((i) => list(i.tags).some((t) => t.key === 'quoteMissing'));
  assert.equal(missing.length, items.length);
  const flag = `<span class="flag">${escapeHtml(REPORT_DECISION_TAGS.quoteMissing)} <span class="tip">${escapeHtml(said)}`
    + '</span></span>';
  // D202 (a tag's sentence showed on a pointer's hover only): and once in the opened row, under the tag's word, where a
  // keyboard and a touch reach it.
  const line = `<p class="line tag-why kv"><span class="label">${escapeHtml(REPORT_DECISION_TAGS.quoteMissing)}</span> `
    + `<span class="v">${escapeHtml(said)}</span></p>`;
  assert.ok(count(html, flag) >= 1 && count(html, escapeHtml(said)) === count(html, flag) + count(html, line),
    'the sentence as the tag\'s tip, and in the opened row');
  assert.equal(count(html, line), count(html, flag));
  assert.ok(md.includes(` · ${REPORT_DECISION_TAGS.quoteMissing}`), 'the .md\'s tag');
  for (const out of [html.split(line).join(''), md]) {
    assert.equal(count(withoutTips(out), said), 0);
    assert.equal(out.includes('Redis everywhere'), false);
  }
  // Shortened past Must act's evidence (150 more code findings): Must act keeps no evidence fold, and nothing says it.
  const f = report.codePass.findings[0];
  const big = { ...report, codePass: { ...report.codePass, findings: [...report.codePass.findings,
    ...Array.from({ length: 150 }, (_, i) => ({ ...f, id: `sha256:${String(i).padStart(64, 'a')}`, title: `${f.title} ${i}`,
      trace: list(f.trace).map((t) => ({ ...t, step: `${t.step} ${'w'.repeat(200)} ${i}` })) }))] } };
  const shortMd = renderReportMarkdown(session, big, repoFacts());
  assert.ok(shortMd.includes(REPORT_TRIM_WORDS.mdShortened));
  const act = shortMd.slice(shortMd.search(/^### Must act \(/m), shortMd.search(/^### Must know \(/m));
  assert.ok(act.includes('<a name="item-'), 'Must act keeps its items');
  assert.equal(act.includes(`<summary>${REPORT_ITEM_WORDS.evidence}</summary>`), false, 'Must act\'s evidence is cut');
  assert.equal(count(shortMd, said), 0);
});
