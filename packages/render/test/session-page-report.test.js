// The session page renders the report model (D97): its order, its folds, its links,
// its rules (ported from the checklist page's: one escape, a CSP, no script, no resource, quotes grounded, the same bytes
// for the same inputs, a hard byte bound; D199: one copy script, pinned by its hash) and its snapshot. Every session and
// report here is synthetic.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { renderSessionPage, sessionPage, escapeHtml, PAGE_VERSION, PAGE_LIMITS, PAGE_CSS, PAGE_SCRIPT,
  PAGE_SCRIPT_HASH } from '../session-page.js';
import { reportModel, REPORT_MODEL_VERSION, reportItems } from '../report-model.js';
import { renderReportMarkdown } from '../session-story.js';
import { REPORT_TRIM_WORDS, REPORT_FOOTER_WORDS, REPORT_PROMPT_WORDS, REPORT_HEADER_WORDS, REPORT_TIER_WORDS,
  REPORT_TAB_WORDS, REPORT_SECTION_WORDS, REPORT_DID_WORDS, REPORT_ITEM_WORDS, REPORT_DECISION_TAGS } from '../report-words.js';
/** The story's words for a message with no recorded words, before the story was the report .md (story /32): no reader
 *  shows them, and storyFacts no longer makes them. */
const STORY_SENTENCES = Object.freeze({ withheldAsk: '(no request text in the recording)' });
import { reportSession, triagedReport, sessionOnlyReport, sessionReviewOnlyReport, repoFacts, HEAD }
  from './report-fixture.js';
import { sessionBuilder, STORY_KEY } from './session-story-fixture.js';

const SNAPSHOT = new URL('./snapshots/session-page-report.html', import.meta.url);
const page = (shape = triagedReport, options = repoFacts()) => {
  const session = reportSession();
  return renderSessionPage(session, shape(session), { sessionHash: 'a'.repeat(64), ...options });
};
const unescape = (text) => text.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
  .replace(/&amp;/g, '&');
/** Every verified quote's text, as the reader reads it. */
const quotesOf = (html) => [...html.matchAll(/<q class="said">([\s\S]*?)<\/q>/g)].map((m) => unescape(m[1].replace(/<[^>]+>/g, '')));
const textOf = (html) => unescape(html.replace(/<style>[\s\S]*?<\/style>/, '').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ');
/** The markup of one item, to its own close. */
/** The markup of one item, to the next item or its section's end (D198: an item is a row, folds inside it). */
const itemOf = (html, n) => { const at = html.indexOf(`id="item-${n}"`); const ends = [html.indexOf(' id="item-', at + 1),
  html.indexOf('</section>', at)].filter((i) => i > 0); return html.slice(at, Math.min(...ends)); };
const modelOf = (shape = triagedReport, options = repoFacts()) => {
  const session = reportSession();
  return reportModel(session, shape(session), options);
};

test('D97: the synthetic report page renders exactly its snapshot', () => {
  // D112 amended (2026-10-18, unreleased, no version move): the fixture's Q1 names no place, so it is an item of its own.
  // D122 (b) (no version move): the fixture's refused read, a failure passed over, is in Must know.
  // D199 (no version move, beta.11): the prompt box with its copy button and script, the tabs' stats, no disclaimers.
  // D202 (no version move): your asks' evidence folds and the done asks' fold, a decision's recorded actions, the
  // untied question's tag, the code review's lines' tag, the tag sentences in the opened rows, the legend's lines.
  assert.equal(page(), readFileSync(SNAPSHOT, 'utf8'));
});

test('D97, D131: the page is the report model in its order — header, count line, Must act, Must know, prompt, then the folds', () => {
  const html = page();
  const at = (marker) => { const i = html.indexOf(marker); assert.ok(i >= 0, marker); return i; };
  // D131 (R1, B12): Must act and Must know before your prompt, on every page (report-model.js `promptAfterTiers`).
  // D161: then Good to know and the agent's decisions, before your prompt.
  const order = ['id="review-title"', 'class="count"', 'id="must-act"', 'id="must-know"', 'id="good-to-know"',
    'id="decisions"', 'id="prompt"', 'id="did"', 'id="not-checked"', 'class="foot"'].map(at);
  assert.deepEqual(order, [...order].sort((a, b) => a - b));
  // Must act and Must know are open sections; Good to know is a native fold, closed (no `open` attribute: the page runs
  // no script). D193: the findings, the agent's decisions, your prompt, what the agent did and what Sonah could not check
  // are each a panel that a tab names, in that order, and the first panel holds Must act.
  assert.match(html, /<section class="part tier" id="must-act">/);
  assert.match(html, /<details class="part tier fold-tier" id="good-to-know">/);
  assert.match(html, /<section class="part panel" id="did">/);
  const panels = [...html.matchAll(/<(?:div|section) class="[^"]*\bpanel\b[^"]*" id="([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(panels, ['review', 'decisions', 'prompt', 'did', 'not-checked']);
  // D195: each tab is the label of its panel's radio, the first checked.
  assert.deepEqual([...html.matchAll(/<label class="tab tab-([a-z-]+)" for="t-([a-z-]+)">/g)].map((m) => [m[1], m[2]]),
    panels.map((id) => [id, id]));
  assert.deepEqual([...html.matchAll(/<input class="tab-r" type="radio" name="tab" id="t-([a-z-]+)"[^>]*?( checked)?>/g)]
    .map((m) => [m[1], Boolean(m[2])]), panels.map((id, at) => [id, at === 0]));
  assert.ok(html.indexOf('id="review"') < html.indexOf('id="must-act"'));
  // D194: the agent's decisions are one list, no fold a group. D198: every item and decision is a closed row; no fold of
  // the page is open.
  const model0 = modelOf();
  assert.equal((html.match(/<details[^>]* open>/g) ?? []).length, 0);
  assert.equal(model0.decisions.groups.length, 1);
  assert.equal(model0.decisions.groups.length, 1);
  // Every fold's summary carries its count.
  const model = modelOf();
  assert.match(html, new RegExp(`Good to know \\(${model.tiers.good_to_know.length}\\)`));
  // R17: the header counts the commands. D199: the page's What the agent did is headed by its tab's word, its counts
  // the stats under it (files, runs: the commands and the calls of other tools, claims); the .md keeps the counted heading.
  // Its review (R17): the commands and the other calls are two stats, as the header counts them; none of all runs.
  assert.match(html, new RegExp(`<h2>${REPORT_TAB_WORDS.did}</h2>`));
  assert.equal(html.includes('What the agent did ('), false);
  const stat = (n, words) => `<span class="stat"><span class="num">${n}</span> <span class="k">${words}</span></span>`;
  assert.ok(model.did.runs.commands > 0 && model.did.runs.others > 0, 'premise: commands and other calls');
  // D201 (the owner, 2026-10-31: "move claims to the top on what the agent did"): the claims first, everywhere in the
  // panel: their stat before the files', the commands' and the other calls'; their chip line before the runs'; their list
  // before the files' and the runs', the other lists after, as before. The counts and the lists' words are as before.
  assert.ok(html.includes(`<div class="stats">${stat(model.did.claims.total, REPORT_SECTION_WORDS.claims)}`
    + `${stat(model.did.files.total, REPORT_SECTION_WORDS.files)}`
    + `${stat(model.did.runs.commands, REPORT_TAB_WORDS.commands)}${stat(model.did.runs.others, REPORT_TAB_WORDS.otherCalls)}`
    + '</div>'));
  const didPanel = html.slice(html.indexOf('<section class="part panel" id="did">'),
    html.indexOf('</section>', html.indexOf('<section class="part panel" id="did">')));
  const chipLines = [...didPanel.matchAll(/<p class="marks"><span class="k">([^<]+)<\/span>/g)].map((m) => m[1]);
  assert.deepEqual(chipLines, [REPORT_SECTION_WORDS.claims, REPORT_TAB_WORDS.runs]);
  const lists = [...didPanel.matchAll(/<h3 class="sub-h">([^<]+)<\/h3>/g)].map((m) => m[1]);
  assert.deepEqual(lists.slice(0, 3), [REPORT_SECTION_WORDS.claims, REPORT_SECTION_WORDS.files, REPORT_SECTION_WORDS.runs]
    .map(escapeHtml));
  assert.equal(html.includes(`<span class="k">${REPORT_TAB_WORDS.runs}</span></span>`), false);
  assert.equal(model.did.runs.total, model.did.runs.commands + model.did.runs.others);
  // D199: the claims by status, each the model's count, together every claim.
  const counts = Object.entries(model.did.claims.counts);
  for (const [key, n] of counts) assert.ok(html.includes(`>${n} ${REPORT_DID_WORDS.claimStatus[key]}</span>`), key);
  assert.equal(counts.reduce((sum, [, n]) => sum + n, 0), model.did.claims.total);
  assert.ok(model.header.size.includes(`${model.did.runs.commands} commands`));
  assert.match(html, new RegExp(`What Sonah could not check \\(${model.notChecked.total} facts?\\)`));
  // Each item is numbered once; each Good to know item is one line that opens to the full item.
  for (const item of [...model.tiers.must_act, ...model.tiers.must_know])
    assert.match(html, new RegExp(`<details class="item row t-[a-z]+" id="item-${item.n}">`));
  for (const item of model.tiers.good_to_know)
    assert.match(html, new RegExp(`<details class="item gtk row t-[a-z]+" id="item-${item.n}"><summary>`));
  // D161: each of the agent's decisions is one line that opens to the full item, its tier a tag.
  for (const item of model.decisions.groups.flatMap((g) => g.items))
    assert.match(html, new RegExp(`<details class="item gtk row trail-item t-[a-z]+" id="item-${item.n}"><summary>[^\\n]*`
      + `<span class="tag tier-tag tier-${item.tier.final.replace(/_/g, '-')}">${REPORT_TIER_WORDS[item.tier.final]}</span></span>`));
  // The generator meta names both versions.
  assert.match(html, new RegExp(`<meta name="generator" content="${PAGE_VERSION} ${REPORT_MODEL_VERSION}">`));
  // D101 moved it once more (sonah.session-page/41): an ask says which test refused its quote.
  // D104 moved it once more (sonah.session-page/42): the shown-in-part mark. Bucket B once more (sonah.session-page/43):
  // what the code review saw short of whole (D105), and why no repaired version was checked, by identity (D107). In
  // the same move (D110): the premise contract, a finding to verify, no second reviewer; (D111) the accounting's footer
  // counts; and (D112) an item's members, and the order by final level.
  // D113 and D114 once more (sonah.session-page/44, 0.3.0-beta.5): the session's own change, and the files changed
  // outside it.
  // In the same move (D115 and D116): a row of the session review in words no wider than the field it rests on, and a
  // question's pointer only where code checked its tie.
  // D126 and D127 once more (sonah.session-page/45, 0.3.0-beta.6): the line beside the title for a session that opens on a
  // compaction, and each compaction among your messages. In the same move (D129, C7): the footer says what the review
  // cost.
  // D144 once more (sonah.session-page/46, 0.3.0-beta.7): the prompt for the agent under an item that leads in Must
  // act, folded, in a block that one click selects.
  // D193 once more (sonah.session-page/47, 0.3.0-beta.11): the page's tabs and its new stylesheet.
  // D207 once more (sonah.session-page/48): a file's row says what places it in the change. D208 rides it: no colour
  // behind quoted words.
  assert.equal(PAGE_VERSION, 'sonah.session-page/48');
});

test('D97 (13), D199, D203: the page is inert: one CSP, one script only by its hash, no resource; the only link out is a validated GitHub permalink', () => {
  const html = page();
  // D199: one CSP; with a copy button (D203: or an in-page link), one inline script, its sha256 the policy's one
  // script-src and PAGE_SCRIPT_HASH.
  const csps = [...html.matchAll(/<meta http-equiv="Content-Security-Policy" content="([^"]*)">/g)].map((m) => m[1]);
  assert.equal(csps.length, 1);
  assert.equal((html.match(/Content-Security-Policy/g) ?? []).length, 1);
  assert.ok(html.includes('<button type="button" class="copy"'), 'the fixture has a prompt box');
  assert.equal(csps[0], `default-src 'none'; style-src 'unsafe-inline'; script-src '${PAGE_SCRIPT_HASH}'; base-uri 'none'; `
    + "form-action 'none'");
  const hashes = [...csps[0].matchAll(/'sha256-([^']+)'/g)].map((m) => m[1]);
  const scripts = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)];
  assert.deepEqual([scripts.length, (html.match(/<script/gi) ?? []).length, scripts[0][1]], [1, 1, '']);
  assert.deepEqual(hashes, [createHash('sha256').update(scripts[0][2]).digest('base64')]);
  assert.equal(`sha256-${hashes[0]}`, PAGE_SCRIPT_HASH);
  assert.equal(scripts[0][2], PAGE_SCRIPT);
  // The script copies a box's text and follows in-page links (D203): it loads, sends and stores nothing, and reads no
  // address.
  // D204: it reads the address's fragment alone, and writes its own history entries alone.
  assert.equal(/fetch|XMLHttpRequest|sendBeacon|WebSocket|import|eval|Function\(|location|cookie|Storage|src/.test(PAGE_SCRIPT
    .replace(/location\.hash/g, '')), false);
  const inert = html.replace(scripts[0][0], '');
  assert.equal(/<script|<link|<img|<iframe|<object|<embed|<form|src=|@import|url\(/i.test(inert), false);
  // D203: a page with no copy button still holds in-page links (its header's tiles open their tabs), so it carries the
  // same one script by the same hash, and nothing else.
  const b = sessionBuilder();
  b.ask('I1', 'Say hello.');
  b.say('F1', 'Hello.', 'final');
  const plain = renderSessionPage(b.session(), { windowResults: [{ windowIndex: 0, eventIds: ['I1', 'F1'], failure: null }] }, {});
  assert.equal(plain.includes('class="copy"'), false);
  assert.ok(/data-href="#/.test(plain), 'the header\'s tiles are in-page links');
  assert.ok(plain.includes(`content="default-src 'none'; style-src 'unsafe-inline'; script-src '${PAGE_SCRIPT_HASH}'; base-uri 'none'; form-action 'none'"`));
  assert.equal((plain.match(/Content-Security-Policy/g) ?? []).length, 1);
  const own = [...plain.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)];
  assert.deepEqual(own.map((m) => [m[1], m[2]]), [['', PAGE_SCRIPT]]);
  assert.equal(/<script|<link|<img|<iframe|<object|<embed|<form|src=|@import|url\(/i.test(plain.replace(own[0][0], '')), false);
  const hrefs = [...html.matchAll(/href="([^"]*)"/g)].map((m) => unescape(m[1]));
  const out = hrefs.filter((h) => !h.startsWith('#'));
  assert.ok(out.length > 0, 'the fixture has permalinks');
  for (const href of out) assert.match(href, new RegExp(`^https://github\\.com/example-org/example-api/blob/(?:${HEAD}|2{40})/`));
  for (const tag of html.matchAll(/<a [^>]*href="https:[^>]*>/g)) assert.match(tag[0], /rel="noreferrer noopener"/);
  for (const href of hrefs.filter((h) => h.startsWith('#')))
    // D161: and the agent's decisions (`#decisions`).
    assert.match(href, /^#(?:ask|item|run|claim|not-checked|did|prompt|must-act|must-know|good-to-know|decisions|review)(?:-[A-Za-z0-9]+)?$/);
  // Without the facts, no link leaves the page at all; facts that are not valid build none either.
  assert.equal(/href="https?:/.test(page(triagedReport, {})), false);
  assert.equal(/href="https?:/.test(page(triagedReport, repoFacts({ github: { owner: 'two words' } }))), false);
  assert.equal(/href="https?:/.test(page(triagedReport, repoFacts({ repo: { head: 'not-a-sha' } }))), false);
});

test('D97 (13): recorded and reviewers\' text that holds markup renders escaped, as text', () => {
  const b = sessionBuilder();
  const asked = 'Show <b>bold</b> & keep </details> and "quotes" as they are.';
  b.ask('I1', asked);
  b.say('F1', 'Done with <i>it</i>.', 'final');
  const session = b.session();
  const r = (role, eventId, quote) => ({ role, eventId, quote, sessionKey: STORY_KEY });
  const html = renderSessionPage(session, { windowResults: [{ windowIndex: 0, eventIds: ['I1', 'F1'], failure: null }],
    requirements: [{ text: 'Show bold', instruction: r('instruction', 'I1', 'Show <b>bold</b> & keep </details>'),
      status: 'not-done', shortfall: r('commentary', 'F1', 'Done with <i>it</i>.') }],
    decisions: [{ dimension: 'markup <em>', chosen: 'keep </summary> as text', column: 'unasked', columnState: 'grounded',
      actions: [], stated: null }] }, {});
  const body = html.slice(html.indexOf('<main'));
  assert.equal(/<b>|<i>|<em>markup|<\/summary> as text/.test(body), false);
  assert.match(body, /Show &lt;b&gt;bold&lt;\/b&gt; &amp; keep &lt;\/details&gt;/);
  assert.match(body, /keep &lt;\/summary&gt; as text/);
  assert.ok(quotesOf(html).includes('Show <b>bold</b> & keep </details>'));
  // The page's folds stay balanced: the recorded "</details>" opened or closed none.
  assert.equal((body.match(/<details/g) ?? []).length, (body.match(/<\/details>/g) ?? []).length);
});

test('D97 (9): every shown quote is found again, word for word, in this recording', () => {
  const session = reportSession();
  const html = renderSessionPage(session, triagedReport(session), repoFacts());
  const recorded = session.events.flatMap((event) => [...['text', 'output', 'command', 'input']
    .flatMap((field) => session.textSpansOf(event, field)), ...(event.changes ?? [])
    .flatMap((change) => [...session.textSpansOf(change, 'after'), ...session.textSpansOf(change, 'before')])]);
  const quotes = quotesOf(html);
  assert.ok(quotes.length > 10);
  for (const quote of quotes) for (const piece of quote.split(' … ').filter(Boolean))
    assert.ok(recorded.some((span) => span.replace(/\n/g, ' ').includes(piece)), piece);
  // A quote the recording does not hold is never shown, and the item says so.
  const report = triagedReport(session);
  report.findings[0] = { ...report.findings[0], receipts: [{ ...report.findings[0].receipts[0],
    quote: 'The limiter uses Redis everywhere.' }, report.findings[0].receipts[1]] };
  const missing = renderSessionPage(session, report, repoFacts());
  assert.equal(missing.includes('Redis everywhere'), false);
  // D199 (the owner, 2026-10-30, "All of them"): the model still knows the item's quote was not found; no reader says it
  // beside the item, on the page or in the .md. D200: its short tag does (REPORT_DECISION_TAGS.quoteMissing), the
  // sentence only as the tag's title on the page.
  const missingModel = reportModel(session, report, repoFacts());
  assert.ok(reportItems(missingModel).some((item) => item.quoteMissing && !item.quote
    && item.tags.some((t) => t.key === 'quoteMissing' && t.words === REPORT_ITEM_WORDS.quoteMissing)));
  const missingMd = renderReportMarkdown(session, report, repoFacts());
  assert.equal(missingMd.includes('Redis everywhere'), false);
  // D200 (review round): no title; the sentence is the flag's `.tip`, hidden until a pointer shows it.
  const flag = `<span class="flag">${REPORT_DECISION_TAGS.quoteMissing} <span class="tip">${REPORT_ITEM_WORDS.quoteMissing}`
    + '</span></span>';
  assert.ok(missing.includes(flag) && missingMd.includes(` · ${REPORT_DECISION_TAGS.quoteMissing}`));
  // D202: and once in the opened row, under the tag's word, where a keyboard and a touch reach it.
  const line = `<p class="line tag-why kv"><span class="label">${REPORT_DECISION_TAGS.quoteMissing}</span> `
    + `<span class="v">${REPORT_ITEM_WORDS.quoteMissing}</span></p>`;
  assert.ok(missing.includes(line));
  for (const out of [missing.replaceAll(flag, '').replaceAll(line, ''), missingMd])
    assert.equal(out.includes(REPORT_ITEM_WORDS.quoteMissing), false);
});

test('D97 (12): the same inputs give the same bytes, and the report is only read', () => {
  const session = reportSession();
  const report = triagedReport(session);
  const before = JSON.stringify(report);
  assert.equal(renderSessionPage(session, report, repoFacts()), renderSessionPage(session, report, repoFacts()));
  assert.equal(JSON.stringify(report), before);
});

test('D97 (14): a page past its bound folds the evidence first, then cuts the lists; items stay; each trim said once', () => {
  const session = reportSession();
  const report = triagedReport(session);
  // A review whose lists and evidence are the bulk: decisions you settled (a list of what the agent did) and decisions
  // made without asking (items, each with the session review's long words in its evidence fold).
  const long = (k) => `${'word '.repeat(31)}${k}`;
  report.decisions = [...report.decisions,
    ...Array.from({ length: 3000 }, (_, k) => ({ id: `sha256:${String(k).padStart(64, '0')}`, dimension: long(k),
      chosen: long(k), column: 'asked-settled', columnState: 'grounded', actions: [], stated: null })),
    ...Array.from({ length: 200 }, (_, k) => ({ id: `sha256:${String(k + 5000).padStart(64, '0')}`, dimension: long(k),
      chosen: `pick ${k}`, column: 'unasked', columnState: 'grounded', actions: ['W1'], stated: null }))];
  const untrimmed = reportModel(session, report, repoFacts());
  assert.ok(untrimmed.did.settled.length === 3001, 'the model keeps every row; the page trims what it shows');
  const html = renderSessionPage(session, report, repoFacts());
  assert.ok(Buffer.byteLength(html, 'utf8') <= PAGE_LIMITS.maxBytes);
  // R2: the page says it left something out, so the .md beside it never says that Sonah did not shorten the page.
  assert.deepEqual([sessionPage(session, report, repoFacts()).html === html, sessionPage(session, report, repoFacts()).whole],
    [true, false]);
  const model = reportModel(session, report, repoFacts());
  for (const item of [...model.tiers.must_act, ...model.tiers.must_know]) {
    assert.ok(html.includes(`id="item-${item.n}"`), `item ${item.n} stays`);
    // Its visible lines stay whole: the quote, the impact, what the agent said, the action and where.
    const shown = itemOf(html, item.n);
    // D194: a quote that leads is in the head, what it is under it; any other quote is its own line.
    // D198: the row's summary shows the action, else what kind of item it is; the row's body, every other line.
    if (item.quote) assert.ok(item.leadQuote ? (shown.includes('<p class="kind-line">') || shown.includes('<span class="pv">'))
      && shown.includes('<q class="said">') : shown.includes('<blockquote class="item-quote'), `item ${item.n} quote`);
    if (item.impact) assert.ok(shown.includes('<p class="line impact kv">'), `item ${item.n} impact`);
    if (item.action) assert.ok(shown.includes('<span class="pv act">'), `item ${item.n} action`);
    if (item.agentSaid) assert.ok(shown.includes('<p class="line agent-said kv">'), `item ${item.n} agent said`);
    if (item.where.length) assert.ok(shown.includes('<p class="line where kv">'), `item ${item.n} where`);
  }
  // No message was long: the page says nothing of messages.
  assert.equal(html.includes('Sonah shows only the start of'), false);
  // Each trim says so once where it happens.
  const said = (sentence) => html.split(sentence).length - 1;
  // The evidence folds of the agent's decisions (D161), of Good to know, then of Must act and Must know: said once in
  // each place the trim happens. D202: and your asks' evidence folds, left out with the decisions', said once in your
  // asks in words of their own (its review: they keep no summary).
  assert.equal(said(REPORT_TRIM_WORDS.trimmed), 3);
  const asked = html.slice(html.indexOf('id="prompt"'), html.indexOf('id="did"'));
  assert.equal(asked.split(REPORT_TRIM_WORDS.askEvidenceTrimmed).length - 1, 1, 'said once in your asks');
  assert.equal(asked.includes('<details class="evidence ae">'), false, 'no ask keeps its evidence fold');
  const trail = html.slice(html.indexOf('id="decisions"'), html.indexOf('id="prompt"'));
  assert.equal(trail.split(REPORT_TRIM_WORDS.trimmed).length - 1, 1, 'said once in the agent\'s decisions');
  for (const item of model.decisions.groups.flatMap((g) => g.items)) assert.ok(trail.includes(`id="item-${item.n}"`));
  // The lists of what the agent did are cut, and so is the list of messages that hold no ask: said once in each place.
  const prompt = html.slice(html.indexOf('id="prompt"'), html.indexOf('id="did"'));
  const did = html.slice(html.indexOf('id="did"'), html.indexOf('id="not-checked"'));
  assert.equal(said(REPORT_TRIM_WORDS.listsTrimmed), 2);
  assert.equal([prompt, did].map((part) => part.split(REPORT_TRIM_WORDS.listsTrimmed).length - 1).join(), '1,1');
  assert.ok(prompt.includes('Sonah does not show 1 more of this list here.'), 'the list counts what it leaves out');
  assert.match(html, /<details class="evidence"><summary>[^<]*<\/summary><\/details>/, 'an evidence fold keeps its summary');
  // A page within its bound says nothing of trims.
  const small = page();
  assert.equal(small.includes(REPORT_TRIM_WORDS.trimmed) || small.includes(REPORT_TRIM_WORDS.listsTrimmed)
    || small.includes('Sonah shows only the start of'), false);
});

test('D97 (23): the reviews\' words are set apart by source; the legend says whose; your answer command is printed once', () => {
  const html = page();
  assert.match(html, /<em class="by-code-review">The bucket refills before the first request<\/em>/);
  assert.match(html, /<em class="by-code-review">A burst of requests passes the limit at start\.<\/em>/);
  assert.match(html, /<em class="by-code-review">Refill the bucket after the first request\.<\/em>/);
  assert.match(html, /<em class="by-code-review">adds a token bucket limiter<\/em>/);
  assert.match(html, /<em class="by-session-review">seconds<\/em>/);
  for (const line of [REPORT_FOOTER_WORDS.legend, REPORT_FOOTER_WORDS.legendCodeReview,
    REPORT_FOOTER_WORDS.legendSessionReview])
    assert.ok(textOf(html).includes(unescape(line)), line);
  // D199 (the owner, 2026-10-30, "All of them"): no triage legend, no advice to read before you share, no line on what
  // "you" means and no line on which parts of your message Sonah checked, on the page or in the .md (the words are gone).
  // D200: the line on which parts Sonah checked is back, once on each reader, never in the legend (report-md.test.js
  // D97 (1)); the impact and action lines name the code review themselves, so the legend still does not.
  assert.deepEqual(['triageLegend', 'share', 'youMeans'].filter((k) => Object.hasOwn(REPORT_FOOTER_WORDS, k)), []);
  assert.equal(REPORT_PROMPT_WORDS.coverage, 'Sonah checked only the marked parts of your message.');
  const session = reportSession();
  const md = renderReportMarkdown(session, triagedReport(session), repoFacts());
  for (const out of [html, md]) for (const gone of ['The code review wrote the impact and action lines.',
    'Read this report before you share it.', 'means the person who ran the agent'])
    assert.equal(out.includes(gone), false, gone);
  for (const out of [html, md]) assert.equal(out.split('Sonah checked only the').length - 1, 1);
  assert.equal(html.slice(html.indexOf('<footer')).includes('Sonah checked only the'), false);
  assert.equal(html.split('sonah decision accept|change|clarify').length - 1, 1);
  // The title is your words, in quotation marks.
  assert.match(html, /<p class="title-words"><q class="said">Add rate limiting to the API\.<\/q><\/p>/);
  // A review with no code step says so on the header, and shows no impact or action line.
  const plain = page(sessionReviewOnlyReport, {});
  // D118 (a): the owner's sentence and its one closed reason, first after your words. D199: with no sentence after it that
  // the items show no impact and no action (the header's noCode.impact is null).
  assert.match(plain, /<p class="title-words">[^\n]*?<\/p><p class="meta no-code">No code was reviewed\. Reason: this review ran without the code review\.<\/p>/);
  assert.equal(plain.includes('The items show no impact and no action.'), false);
  // D200: in the words the lines now carry (REPORT_ITEM_WORDS.impact, .action), and the ones before.
  assert.equal(/Impact on you:|Action:|impact on you:|review&#39;s action:/.test(plain), false);
  assert.ok(/review&#39;s impact on you:/.test(html) && /review&#39;s action:/.test(html));
});

test('D97: the page follows the reader\'s theme unless asked; the colours stay those of sonah.dev', () => {
  assert.match(page(), /<html lang="en">/);
  assert.match(page(triagedReport, { ...repoFacts(), theme: 'dark' }), /<html lang="en" data-theme="dark">/);
  // D193: each colour one light-dark() pair, sonah.dev's light first; `data-theme` sets the colour scheme it picks by.
  assert.match(PAGE_CSS, /--accent: light-dark\(#f48d16, #f59a2e\);/);
  assert.match(PAGE_CSS, /:root \{\n  color-scheme: light dark;/);
  assert.match(PAGE_CSS, /:root\[data-theme="dark"\] \{ color-scheme: dark; \}/);
  // An ask's status is a word; no colour of a mark means safe: done and not checked share one look.
  assert.equal(/s-done[^{]*\{[^}]*green/i.test(PAGE_CSS), false);
});

// ---- the checklist page's rules, ported (D97) ----------------

const r = (role, eventId, quote) => ({ role, eventId, quote, sessionKey: STORY_KEY });
const windowOf = (session) => [{ windowIndex: 0, eventIds: session.events.map((e) => e.id), failure: null }];
const decided = (fields) => ({ actorSession: STORY_KEY, dimension: 'store', chosen: 'a store', value: null,
  valueReceipt: null, valueState: 'unchecked', actions: [], stated: null, constrainedBy: null, instructionReview: null,
  column: 'asked-chose', columnState: 'grounded', amends: [], materiality: 'material', materialityRule: 'synthetic',
  relevance: 'unchecked', reasons: [], ...fields });
test('ported (M33 Y): who said it is read from the recording — you, the agent, a helper, the code written; a result never', () => {
  const b = sessionBuilder();
  b.ask('I1', 'Store sessions somewhere durable, and keep the cookie name.');
  b.say('C1', 'I will keep the session store in memory for now.');
  b.change('W1', 'src/store.js', { operation: 'edit', before: 'export const store = new Redis();\n',
    after: 'export const store = new Map();\n', priorState: 'edit-text' });
  b.delegate('D1', 'Write the store tests', 'h1');
  b.ask('child:h1:I0', 'Write the store tests', 'agent', 'h1');
  b.say('child:h1:C0', 'The helper will use an in-memory fake.', 'working', 'h1');
  b.run('R1', 'npm test', 'failed', 'the session store tests fail');
  const session = b.session();
  const report = { windowResults: windowOf(session), decisions: [
    decided({ dimension: 'session store', chosen: 'in-memory Map', actions: ['W1'],
      valueReceipt: { eventId: 'W1', field: 'added-code', role: 'code', quote: 'new Map()', sessionKey: STORY_KEY },
      stated: r('commentary', 'C1', 'keep the session store in memory'),
      constrainedBy: { instruction: r('instruction', 'I1', 'Store sessions somewhere durable'), settles: false } }),
    // A value quote on the BEFORE side of the write: grounded, and never called code written.
    decided({ dimension: 'old store', chosen: 'Redis', actions: ['W1'],
      valueReceipt: { eventId: 'W1', field: 'added-code', role: 'code', quote: 'new Redis()', sessionKey: STORY_KEY } }),
    decided({ dimension: 'test double', chosen: 'an in-memory fake', column: null, columnState: 'unchecked',
      stated: r('commentary', 'child:h1:C0', 'use an in-memory fake') }),
    // A statement that cites a recorded result is never the agent's words.
    decided({ dimension: 'store tests', chosen: 'left failing', actions: ['R1'], column: null, columnState: 'unchecked',
      stated: r('observation', 'R1-r', 'the session store tests fail') }),
  ] };
  const html = renderSessionPage(session, report, {});
  const model = reportModel(session, report, {});
  // D161: the decisions are in the report's second part.
  const of = (chosen) => itemOf(html, reportItems(model).find((item) => item.what.parts.some((p) => p.text === chosen)).n);
  const first = of('in-memory Map');
  assert.match(first, /You asked:<\/span> (?:<span class="v">)?<q class="said">Store sessions somewhere durable<\/q>/);
  assert.match(first, /The agent said:<\/span> (?:<span class="v">)?<q class="said">keep the session store in memory<\/q>/);
  assert.match(first, /Code written:<\/span> (?:<span class="v">)?<q class="said">new Map\(\)<\/q>/);
  assert.doesNotMatch(of('Redis'), /Code written/);
  assert.match(of('an in-memory fake'), /A helper said:<\/span> (?:<span class="v">)?<q class="said">use an in-memory fake<\/q>/);
  assert.doesNotMatch(of('an in-memory fake'), /The agent said:<\/span> <q/);
  assert.doesNotMatch(of('left failing'), /store tests fail/);
  // No words of the agent's are linked: no line about its words at all. A missing quote is never read as silence.
  assert.doesNotMatch(of('left failing'), /class="line agent-said"/);
  assert.doesNotMatch(html, /said nothing|gave no words/);
});

test('ported (M33 Y): no closed token or verdict reaches the page, in its text, its attributes or its stylesheet', () => {
  const TOKENS = /\b(DECIDE|FYI|CLEAN|NO_FINDINGS|UNCHECKED)\b|asked-settled|asked-chose|partly-addressed|\bunasked\b|\bmaterial\b|\bstructural\b|\bunverified\b|must_act|must_know|good_to_know|kind_floor|kind_ceiling|refused_call_ceiling/;
  const VERDICT = /Needs your decision|Worth a look|No finding needs|looks good|ready to merge|LGTM/i;
  for (const shape of [triagedReport, sessionOnlyReport]) {
    const html = page(shape);
    assert.equal(html.match(TOKENS)?.[0] ?? null, null, 'a closed token reached the page');
    assert.doesNotMatch(textOf(html), VERDICT);
  }
});

test('ported (D90): a quote of a path outside the repository or a home directory is shown as recorded; a leading cd is not', () => {
  const b = sessionBuilder();
  b.ask('I1', 'Set up deploy keys and run the tests.');
  b.read('R0', 'Users/dev/.ssh/config');
  b.run('R1', 'cd /opt/proj && npm test', 'succeeded', 'pass 3');
  b.change('W1', 'srv/plans/plan.md', { after: 'Private plan: try Redis first\n', outside: true });
  const session = b.session();
  const value = (eventId, field, role, quote) => ({ eventId, field, role, quote, sessionKey: STORY_KEY });
  const html = renderSessionPage(session, { windowResults: windowOf(session), decisions: [
    decided({ dimension: 'ssh config', chosen: 'reuse it', column: 'unasked', actions: ['R0'],
      valueReceipt: value('R0', 'path', 'action', 'Users/dev/.ssh/config') }),
    decided({ dimension: 'test command', chosen: 'npm test', column: 'unasked', actions: ['R1'],
      valueReceipt: value('R1', 'command', 'action', 'cd /opt/proj && npm test') }),
    decided({ dimension: 'plan', chosen: 'a plan file', column: 'unasked', actions: ['W1'],
      valueReceipt: value('W1', 'added-code', 'code', 'Private plan: try Redis first') })] }, {});
  const quotes = quotesOf(html);
  assert.ok(quotes.includes('Users/dev/.ssh/config'));
  assert.ok(quotes.includes('npm test'));
  assert.ok(quotes.includes('Private plan: try Redis first'));
  assert.equal(html.includes('/proj'), false, 'the leading cd is dropped');
  assert.equal(/not shown: this page never shows/.test(html), false);
});

test('ported (D69 f): a long message is shown in part with its marks, folded whole; one held in several spans keeps each', () => {
  const long = `Please do these things:\n${Array.from({ length: 12 }, (_, i) => `- item ${i}: change the module named `
    + `part${i} carefully`).join('\n')}`;
  const b = sessionBuilder();
  b.ask('I1', long);
  b.ask('I2', 'First half of the ask.');
  b.blobs.extra = 'Second half of it.';
  b.events.at(-1).text.push({ sourceKey: 'extra', fromByte: 0, untilByte: Buffer.byteLength(b.blobs.extra) });
  const session = b.session();
  const html = renderSessionPage(session, { windowResults: windowOf(session), requirements: [
    { text: 'item 11', instruction: r('instruction', 'I1', 'change the module named part11 carefully'), status: 'done' },
    { text: 'item 0', instruction: r('instruction', 'I1', 'change the module named part0 carefully'), status: 'done' },
    { text: 'second half', instruction: r('instruction', 'I2', 'Second half of it.'), status: 'not-checked' }] }, {});
  const prompt = html.slice(html.indexOf('id="prompt"'), html.indexOf('id="did"'));
  // The start, then the whole message folded with its line breaks; each ask's id given once.
  assert.match(prompt, /<details class="whole"><summary>Show the whole message<\/summary><p class="message">Please do these things:\n- item 0/);
  assert.equal((prompt.match(/id="ask-1"/g) ?? []).length, 1);
  assert.equal((prompt.match(/id="ask-2"/g) ?? []).length, 1);
  assert.match(prompt, /<mark class="ask s-done"(?: id="ask-2")?><small>Done<\/small>change the module named part11 carefully<\/mark>/);
  // A message held in two recorded spans: the join is Sonah's, outside both spans.
  assert.match(prompt, /First half of the ask\.<span class="join"> … <\/span><mark class="ask s-notChecked"(?: id="ask-3")?>/);
});

test('ported (D69 f): the gaps of each message and of the whole session are said under What Sonah could not check', () => {
  const b = sessionBuilder();
  ['First ask.', 'Second ask.'].forEach((text, i) => { b.ask(`I${i + 1}`, text); b.events.at(-1).turn = `T${i + 1}`; });
  const session = b.session();
  const counts = (fields = {}) => ({ findings: 0, decisions: 0, windows: 1, windowsIncomplete: 0, gaps: 0, ...fields });
  const html = renderSessionPage(session, { windowResults: windowOf(session), sessionStatus: 'NO_FINDINGS',
    coverage: 'partial', coverageFacts: { windows: 1, actions: 3, instructionsElided: 1, instructionsWithheld: 0 },
    parts: [
      { part: 'T1', status: 'UNCHECKED', reasons: ['window_incomplete', 'instruction_omitted'],
        counts: counts({ windowsIncomplete: 1, gaps: 1 }) },
      { part: 'T2', status: 'CLEAN', reasons: [], counts: counts() },
      { part: 'T3', status: 'NO_FINDINGS', reasons: ['gap_declared'], counts: counts({ gaps: 1 }) }],
    sessionWideLimits: { status: 'NO_FINDINGS', limited: true, reasons: ['limit_unattributed'],
      counts: { events: 0, ...counts({ windows: 0 }) } } }, {});
  const section = textOf(html.slice(html.indexOf('id="not-checked"')));
  assert.ok(section.includes('In message 1: the session review did not finish some of this work, and the recorder or Sonah '
    + 'cut short one of your messages here.'), section);
  assert.ok(section.includes('For the whole session: Sonah does not hold all of this work, so the session review '
    + 'did not see all of it, and the session has a coverage limit that no message explains.'));
  assert.doesNotMatch(section, /\bT[123]\b|review window/);
});

test('ported (D69 f (g) finding 1): your earlier answer is shown in your words, escaped, never as a recorded quote', () => {
  const session = reportSession();
  const report = triagedReport(session);
  const id = report.decisions[0].id;
  const html = renderSessionPage(session, report, { ...repoFacts(), sessionHash: 'b'.repeat(64),
    decisionReviews: { [id]: { verb: 'change', reason: 'Use <Redis> & keep "it"' } } });
  assert.match(html, /Your answer:<\/span> You asked to change it\. <span class="answer-reason">Use &lt;Redis&gt; &amp; keep &quot;it&quot;<\/span>/);
  assert.equal(quotesOf(html).some((q) => q.includes('Use <Redis>')), false);
});

test('ported (D69 f (g) finding 10): every text colour holds 4.5:1 on its backgrounds, in both themes', () => {
  const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
  const lin = (c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  const lum = (rgb) => 0.2126 * lin(rgb[0]) + 0.7152 * lin(rgb[1]) + 0.0722 * lin(rgb[2]);
  const ratio = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
  // D193: each token is one light-dark() pair; a theme is its side of every pair.
  const pair = (name) => new RegExp(`--${name}: light-dark\\((#[0-9a-f]{6}|rgba\\([^)]*\\)), (#[0-9a-f]{6}|rgba\\([^)]*\\))\\)`)
    .exec(PAGE_CSS);
  const token = (side, name) => pair(name)[side];
  for (const block of [1, 2]) {
    const card = hex(token(block, 'card')), wash = hex(token(block, 'wash'));
    const backs = [card, wash];
    for (const name of ['faint', 'muted', 'ink', 'accent-ink'])
      for (const back of backs) assert.ok(ratio(hex(token(block, name)), back) >= 4.5, `${name} ${ratio(hex(token(block, name)), back).toFixed(2)}`);
  }
  // The accent itself only draws borders and marks, never text.
  assert.doesNotMatch(PAGE_CSS, /[;{]\s*color: var\(--accent\);/);
  // The owner, 2026-11-02: no colour behind quoted words: a quote keeps its marks, an ask's mark its underline.
  assert.doesNotMatch(PAGE_CSS, /q\.said \{[^}]*background/);
  assert.match(PAGE_CSS, /mark\.ask \{ background: none;/);
});

test('ported (D69 page audit): the rules the page no longer reads stay gone', async () => {
  const pageModule = await import('../session-page.js');
  for (const name of ['PAGE_SYMBOL_RULES', 'PAGE_TOUCH_WORDS', 'PAGE_METHOD_KEYWORDS', 'PAGE_READ_ONLY_PROGRAMS',
    'PAGE_READ_ONLY_GIT', 'PAGE_IMPACT_RULE_WORDS']) assert.equal(Object.hasOwn(pageModule, name), false, name);
  assert.doesNotMatch(textOf(page()), /Touches|changes behaviour|changes structure|cosmetic|not classified/);
});

test('ported (M33 Y): an excerpt shows at most 8 lines of its stored span, and says how many it leaves out', () => {
  const session = reportSession();
  const report = triagedReport(session);
  const lines = Array.from({ length: 12 }, (_, i) => `line ${i + 2}`);
  report.codePass.findings[0] = { ...report.codePass.findings[0], anchorSpan: { startLine: 2, lines, linesCut: 8,
    charsCut: 0 }, anchor: { ...report.codePass.findings[0].anchor, endLine: 21 } };
  const html = renderSessionPage(session, report, repoFacts());
  const model = reportModel(session, report, repoFacts());
  const bug = model.tiers.must_act.find((item) => item.where[0]?.excerpt?.more);
  assert.equal(bug.where[0].excerpt.lines.length, 8);
  assert.equal(bug.where[0].excerpt.more, 12);
  assert.match(itemOf(html, bug.n), /Sonah does not show 12 more lines here\./);
  // A permalink's range is at most 8 lines too.
  assert.match(itemOf(html, bug.n), /#L2-L9"/);
});

test('ported (D69 f (g) finding 14): the title, the messages with no ask and the closing lines quote each span alone', () => {
  const b = sessionBuilder();
  b.ask('I1', 'Please rename');
  b.blobs.extra1 = 'the helper. Then run the tests.';
  b.events.at(-1).text.push({ sourceKey: 'extra1', fromByte: 0, untilByte: Buffer.byteLength(b.blobs.extra1) });
  b.ask('I2', 'First half of the note.');
  b.blobs.extra2 = 'Second half of it.';
  b.events.at(-1).text.push({ sourceKey: 'extra2', fromByte: 0, untilByte: Buffer.byteLength(b.blobs.extra2) });
  b.ask('I3', '');
  b.events.at(-1).nonText = [{ type: 'image' }];
  // A closing line held in two runs of one blob, the text between them cut out of the refs.
  b.blobs.closing = 'All tests pass XXXX and the build is green.';
  b.events.push({ sequence: b.events.length, id: 'F1', kind: 'commentary', phase: 'final', beforeInvocation: null,
    text: [{ sourceKey: 'closing', fromByte: 0, untilByte: 15 }, { sourceKey: 'closing', fromByte: 20,
      untilByte: Buffer.byteLength(b.blobs.closing) }] });
  const session = b.session();
  const html = renderSessionPage(session, { windowResults: [{ windowIndex: 0, eventIds: session.events.map((e) => e.id),
    failure: null, closingLines: [{ eventId: 'F1', unreviewed: [1], listed: [] }] }],
  requirements: [{ text: 'rename the helper', status: 'not-checked',
    instruction: r('instruction', 'I1', 'the helper') }] }, {});
  // The title: each recorded span in quotation marks of its own; the join is Sonah's, outside them.
  assert.match(html, /<p class="title-words"><q class="said">Please rename<\/q> … <q class="said">the helper\.<\/q><\/p>/);
  // A message with no ask: its spans as recorded, the join outside; one with no words: Sonah's sentence, no quote.
  assert.match(html, /<p class="message">First half of the note\.<span class="join"> … <\/span>Second half of it\.<\/p>/);
  assert.ok(html.includes(`<span class="note">${REPORT_PROMPT_WORDS.withheldMessage}</span>`));
  // The closing line: two quotes, the join outside.
  assert.match(html, /<li><q class="said">All tests pass <\/q> … <q class="said">and the build is green\.<\/q><\/li>/);
  // No quotation marks hold Sonah's join or its sentence.
  assert.doesNotMatch(html, /<q class="said">[^<]* … [^<]*<\/q>/);
  for (const quote of quotesOf(html)) assert.ok(!quote.includes(STORY_SENTENCES.withheldAsk)
    && !quote.includes(REPORT_PROMPT_WORDS.withheldMessage), quote);
  // A first message with no recorded words gives no title: the page is named "Sonah review".
  const image = sessionBuilder();
  image.ask('I1', '');
  image.events.at(-1).nonText = [{ type: 'image' }];
  const imageSession = image.session();
  const none = renderSessionPage(imageSession, { windowResults: [{ windowIndex: 0, eventIds: ['I1'], failure: null }],
    requirements: [{ text: 'fix the layout', status: 'not-checked', instruction: r('instruction', 'I1', 'fix the layout') }] },
  {});
  assert.equal(none.includes('class="title-words"'), false);
  assert.ok(none.includes(`<title>${REPORT_HEADER_WORDS.review}</title>`));
  assert.equal(none.includes(STORY_SENTENCES.withheldAsk), false);
});

test('ported (M33 Y): the page bound is hard — long messages keep their start, said once; every ask keeps its line', () => {
  // Characters that are shown in four to twelve bytes: markup escapes to an entity, a bidi control to its code point,
  // and the last is four bytes of UTF-8. Two pasted logs, each holding an ask at its start and one at its end, and
  // messages that hold no ask.
  const unit = ['<', '&', '"', "'", '>', '\u202e', '\u{1D4B3}', ' '];
  const heavy = (n, tag) => `${tag} ${Array.from({ length: n }, (_, i) => unit[i % unit.length]).join('')}`;
  const b = sessionBuilder();
  const starts = [], ends = [];
  for (let i = 0; i < 2; i++) {
    starts.push(`Start ask ${i}: read the log below.`);
    ends.push(`End ask ${i}: keep the tests green.`);
    b.ask(`I${i}`, `${starts[i]}\n${heavy(150_000, `log${i}`)}\n${ends[i]}`);
  }
  for (let i = 0; i < 3; i++) b.ask(`N${i}`, heavy(60_000, `note${i}`));
  b.say('F1', 'Done.', 'final');
  const session = b.session();
  const requirements = [0, 1].flatMap((i) => [
    { text: starts[i], instruction: r('instruction', `I${i}`, starts[i]), status: 'done' },
    { text: ends[i], instruction: r('instruction', `I${i}`, ends[i]), status: 'not-checked' }]);
  const report = { windowResults: windowOf(session), requirements };
  const html = renderSessionPage(session, report, {});
  assert.ok(Buffer.byteLength(html, 'utf8') <= PAGE_LIMITS.maxBytes, `${Buffer.byteLength(html, 'utf8')} bytes`);
  // A long message is shown only in part: its start, with the cut said; the trim is said once, where it happens.
  assert.doesNotMatch(html, /<details class="whole"/, 'a long message is shown only in part');
  const prompt = html.slice(html.indexOf('id="prompt"'), html.indexOf('id="did"'));
  // D204 (the owner: "Cut longest first"): the trim cuts the longest messages first, one at a time, and counts them.
  const said = /To keep this page within its size, Sonah shows only the start of (?:one|(\d+)) of your long messages?\./
    .exec(prompt);
  assert.ok(said, 'the trim is said in your asks');
  assert.equal((html.match(/To keep this page within its size, Sonah shows only the start of/g) ?? []).length, 1);
  assert.ok(Number(said[1] ?? 1) >= 2, 'both pasted logs, the longest, are cut first');
  // Every ask has its place once: the start ones marked, the end ones listed with their words.
  for (let n = 1; n <= 4; n++) assert.equal(prompt.split(`id="ask-${n}"`).length - 1, 1, `ask ${n}`);
  for (const start of starts) assert.ok(prompt.includes(`${start}</mark>`), start);
  for (const end of ends) assert.ok(prompt.includes(`<q class="said">${end}</q>`), end);
  // The messages that hold no ask are counted whole; each one shown is its start.
  assert.ok(prompt.includes('Sonah found no ask in 3 more messages.'));
  // What the page shows is word for word from the recording, the cuts outside the quotation marks.
  const recorded = session.events.flatMap((event) => session.textSpansOf(event, 'text'));
  for (const quote of quotesOf(html)) assert.ok(recorded.some((span) => span.includes(quote)), quote.slice(0, 40));
  // The same review with short messages is shown whole, and says nothing of a cut.
  const short = sessionBuilder();
  short.ask('I0', `${starts[0]}\n${ends[0]}`);
  short.ask('N0', 'Thanks.');
  const shortSession = short.session();
  const whole = renderSessionPage(shortSession, { windowResults: windowOf(shortSession), requirements: [
    { text: starts[0], instruction: r('instruction', 'I0', starts[0]), status: 'done' }] }, {});
  assert.equal(whole.includes('Sonah shows only the start of'), false);
  assert.ok(whole.includes('<p class="message">Thanks.</p>'));
});
