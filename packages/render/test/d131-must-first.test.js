// D131 (R1, B12; the owner: "Must act comes first"): Must act and Must know come before your prompt on the
// page and in the report .md (report-model.js `promptAfterTiers`); a long session's prompt (more than
// `REPORT_LIMITS.openAsks` asks) is folded after them, its count in the fold's summary; a shortened .md cuts your
// prompt's done asks and your messages, then the lists, before any evidence of Must act or Must know, and never prints an
// evidence fold with nothing in it.
//
// The invariant over every review the tests hold (the report fixtures, the story and checklist fixtures, a long
// session, an oversized one, and the two snapshots as stored): no number of the first screen differs from the body's —
// each tier's count on the count line is its section's heading and its items, the prompt's counts are its heading's and
// its asks', and the Must act labels and "and N more" add up to Must act's count. Read from the rendered bytes, never
// from the model. Every session and report here is synthetic.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { renderSessionPage } from '../session-page.js';
import { renderReportMarkdown, REPORT_MD_LIMITS, REPORT_MD_WORDS } from '../session-story.js';
import { reportModel, REPORT_LIMITS, MUST_FIRST_ON_EVERY_PAGE, promptAfterTiers } from '../report-model.js';
import { REPORT_NOT_CHECKED_WORDS, REPORT_PROMPT_PARTS, REPORT_PROMPT_WORDS } from '../report-words.js';
import { REPORT_SHAPES, reportSession, repoFacts } from './report-fixture.js';
import { sessionBuilder, storySession, storyReport, STORY_KEY } from './session-story-fixture.js';
import { checklistSession, checklistReport } from './session-page-checklist-fixture.js';

const r = (role, eventId, quote) => ({ role, eventId, quote, sessionKey: STORY_KEY });
const STATUSES = ['done', 'partly-done', 'not-done', 'not-checked'];

/** A session of `n` messages, each one ask, their statuses in turn: done, partly done, not done, not checked; each
 *  message followed by `filler` more words of yours. */
function longReview(n, filler = 0, compactAfter = []) {
  const b = sessionBuilder();
  for (let k = 0; k < n; k++) {
    b.ask(`I${k}`, `Please make change number ${k} to the parser module.${' And keep it tidy.'.repeat(filler)}`);
    // A compaction after message `k` (a boundary event with the recorder's typed counts, as the adapter emits it).
    if (compactAfter.includes(k)) b.events.push({ id: `B${k}`, kind: 'boundary', sequence: b.events.length,
      boundary: 'compaction', relatedSession: null, compacted: { trigger: 'auto', before: 900_000, after: 10_000 } });
  }
  b.say('F1', 'Done.', 'final');
  const session = b.session();
  const report = { windowResults: [{ windowIndex: 0, eventIds: session.events.map((e) => e.id), failure: null }],
    sessionReview: 'complete', coverage: 'complete',
    requirements: Array.from({ length: n }, (_, k) => ({ text: `change ${k}`, status: STATUSES[k % 4],
      instruction: r('instruction', `I${k}`, `make change number ${k} to the parser module`),
      ...(STATUSES[k % 4] === 'done' || STATUSES[k % 4] === 'partly-done' ? { deliverable: r('commentary', 'F1', 'Done.') }
        : {}), ...(STATUSES[k % 4] === 'not-done' || STATUSES[k % 4] === 'partly-done'
        ? { shortfall: r('commentary', 'F1', 'Done.') } : {}) })) };
  return { session, report };
}
/** The oversized review of report-md.test.js: many Must know items with long evidence, and a long settled list. */
function oversized() {
  const session = reportSession();
  const report = REPORT_SHAPES.a(session);
  const long = (k) => `${'word '.repeat(60)}${k}`;
  report.decisions = [...report.decisions,
    ...Array.from({ length: 1500 }, (_, k) => ({ id: `sha256:${String(k).padStart(64, '0')}`, dimension: long(k),
      chosen: long(k), column: 'asked-settled', columnState: 'grounded', actions: [], stated: null })),
    ...Array.from({ length: 90 }, (_, k) => ({ id: `sha256:${String(k + 5000).padStart(64, '0')}`,
      dimension: long(k), chosen: `pick ${k}`, column: 'unasked', columnState: 'grounded', actions: ['W1'], stated: null }))];
  return { session, report };
}
/** Every review the tests hold, rendered both ways. */
function reviews() {
  const out = [];
  for (const [letter, shape] of Object.entries(REPORT_SHAPES)) {
    const session = reportSession();
    out.push({ name: `shape ${letter}`, session, report: shape(session), options: repoFacts() });
  }
  const story = storySession();
  out.push({ name: 'story', session: story, report: storyReport(story), options: {} });
  const checklist = checklistSession();
  out.push({ name: 'checklist', session: checklist, report: checklistReport(checklist), options: {} });
  for (const n of [REPORT_LIMITS.openAsks, REPORT_LIMITS.openAsks + 1, 133]) out.push({ name: `${n} asks`, ...longReview(n),
    options: {} });
  out.push({ name: 'oversized', ...oversized(), options: repoFacts() });
  return out.map((x) => ({ ...x, model: reportModel(x.session, x.report, x.options),
    page: renderSessionPage(x.session, x.report, x.options), md: renderReportMarkdown(x.session, x.report, x.options) }));
}

const text = (html) => html.replace(/<[^>]*>/g, '').replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<')
  .replace(/&gt;/g, '>').replace(/&amp;/g, '&');
/** The count line's numbers, from its text: each tier's count, (D161) the agent's decisions and their Must tags, and the
 *  prompt's parts. */
function countLineOf(line) {
  const m = /^Must act (\d+) · Must know (\d+) · Good to know (\d+) \(folded\)(?: · (\d+) decisions?(?: \(([^)]*)\))?)? · Your prompt: (.*)$/
    .exec(line);
  assert.ok(m, line);
  const tag = (word) => Number(new RegExp(`(\\d+) ${word}`).exec(m[5] ?? '')?.[1] ?? 0);
  return { act: Number(m[1]), know: Number(m[2]), good: Number(m[3]), decisions: Number(m[4] ?? 0),
    tagged: [tag('Must act'), tag('Must know')], parts: m[6] };
}
/** D161: the second part's numbers in a slice of a page or a .md: its heading's count, its decisions and their tags. */
function trailNumbers(part, items) {
  const heading = /The agent(?:&#39;|')s decisions, in order \((\d+)\)/.exec(part);
  // D163: a decision that the first part shows is a line of its own here, its tag last (`</p>` on the page).
  const tags = [...part.matchAll(/(?:<span class="tag tier-tag">| · )(Must act|Must know|Good to know)(?:<\/span>)?(?:<\/summary>|<\/p>|$)/gm)]
    .map((m) => m[1]);
  return { heading: heading ? Number(heading[1]) : 0, items, tagged: [tags.filter((t) => t === 'Must act').length,
    tags.filter((t) => t === 'Must know').length] };
}
/** D161: the same, read from a report .md: one anchor a decision shown, and (shortened, its review) the decisions tagged
 *  Good to know that a group counts and does not show. */
function trailMd(part) {
  // D163: and one line a decision that the first part shows.
  const anchors = (part.match(/<a name="item-\d+"><\/a>/g) ?? []).length
    + (part.match(/ · \[shown in item \d+ above\]\(#item-\d+\) · /g) ?? []).length;
  const hidden = [...part.matchAll(/^Sonah does not show (\d+) decisions? tagged Good to know here\.$/gm)]
    .reduce((n, m) => n + Number(m[1]), 0);
  return { ...trailNumbers(part, anchors + hidden) };
}
/** The index of the first of `marks` found in `text` after `from`, else `text.length`. */
const nextOf = (text, from, marks) => Math.min(...marks.map((mark) => text.indexOf(mark, from)).filter((i) => i >= 0),
  text.length);
/** "3 done, 1 partly done" read by the prompt part words, as `{ state: n }`; "Sonah found no ask…" as none. */
function partsOf(parts) {
  const out = {};
  if (parts.startsWith('Sonah found no ask')) return out;
  for (const piece of parts.split(', ')) {
    const state = Object.keys(REPORT_PROMPT_PARTS).find((s) => REPORT_PROMPT_PARTS[s](Number(piece.split(' ')[0])) === piece);
    assert.ok(state, piece);
    out[state] = Number(piece.split(' ')[0]);
  }
  return out;
}
const sum = (o) => Object.values(o).reduce((a, b) => a + b, 0);
/** The status word of each state, as the table and the marks show it. */
const WORD = { done: 'done', doneCode: 'done', partly: 'partly', notDone: 'notDone', notChecked: 'notChecked',
  notCheckedCode: 'notChecked' };
const byWord = (states) => Object.entries(states).reduce((o, [s, n]) => ({ ...o, [WORD[s]]: (o[WORD[s]] ?? 0) + n }), {});

/** The first screen's numbers and the body's, read from a page. */
function pageNumbers(html) {
  const head = countLineOf(text(/<p class="count">([\s\S]*?)<\/p>/.exec(html)[1]));
  const section = (id, next) => html.slice(html.indexOf(`id="${id}"`), html.indexOf(next, html.indexOf(`id="${id}"`)));
  const act = section('must-act', '</section>'), know = section('must-know', '</section>');
  // D161: Good to know ends where the agent's decisions begin, or your prompt, or What the agent did.
  const goodAt = html.indexOf('id="good-to-know"');
  const good = html.slice(goodAt, nextOf(html, goodAt, ['id="decisions"', 'id="prompt"', 'id="did"']));
  const trailAt = html.indexOf('id="decisions"');
  const trailPart = trailAt < 0 ? '' : html.slice(trailAt, html.indexOf('</section>', trailAt));
  const heading = (part) => Number(/<h2>[^<(]*\((\d+)\)<\/h2>/.exec(part)[1]);
  const promptHeading = text(/id="prompt">(?:<div|<summary) class="card-bar">(<h2>[\s\S]*?<\/h2>)/.exec(html)[1]);
  const asks = {};
  for (const m of html.matchAll(/<mark class="ask s-(\w+)" id="ask-\d+">|<li id="ask-\d+">ask \d+ · <span class="tag s-(\w+)">/g)) {
    const state = m[1] ?? m[2];
    asks[state] = (asks[state] ?? 0) + 1;
  }
  const labels = /<p class="count-labels">([\s\S]*?)<\/p>/.exec(html);
  const targets = labels ? [...labels[1].matchAll(/href="#item-(\d+)"/g)].map((m) => Number(m[1])) : [];
  const more = labels ? Number(/and (\d+) more/.exec(text(labels[1]))?.[1] ?? 0) : 0;
  // D163: Must act holds its items and its pointers to the decisions tagged Must act.
  const actItems = [...[...act.matchAll(/<article class="item[^"]*" id="item-(\d+)"/g)].map((m) => Number(m[1])),
    ...[...act.matchAll(/<li><a href="#item-(\d+)">/g)].map((m) => Number(m[1]))];
  return { head, body: { act: heading(act), know: heading(know), good: heading(good), actItems: actItems.length,
    knowItems: (know.match(/<article class="item/g) ?? []).length,
    goodItems: (good.match(/<details class="item gtk/g) ?? []).length, promptHeading, asks, targets, more, actIds: actItems,
    trail: trailNumbers(trailPart, (trailPart.match(/<details class="item gtk trail-item|<p class="trail-above">/g)
      ?? []).length) } };
}

/** Good to know's items in the .md: one anchor each, or (shortened to counts by kind) the sum of its kinds' counts. */
function goodItems(part) {
  const anchors = (part.match(/<a name="item-\d+"><\/a>/g) ?? []).length;
  const counts = [...part.matchAll(/^- [^\n]*: (\d+)$/gm)].reduce((n, m) => n + Number(m[1]), 0);
  return anchors || counts;
}
/** The same, read from a report .md. */
function mdNumbers(md) {
  const head = countLineOf(md.split('\n').find((l) => l.startsWith('Must act ') && l.includes(' · Your prompt')).replace(/ {2}$/, ''));
  const at = (re) => { const m = re.exec(md); assert.ok(m, String(re)); return m; };
  const actH = at(/^### Must act \((\d+)\)$/m), knowH = at(/^### Must know \((\d+)\)$/m);
  const promptH = at(/^(?:### |<details><summary>)(Your prompt \([^\n]*\))(?:<\/summary>)?$/m);
  const goodH = at(/^<details><summary>Good to know \((\d+)\)<\/summary>$/m);
  const didH = md.indexOf('<details><summary>What the agent did');
  // D161: the agent's decisions, after Good to know and before your prompt, when the report holds one.
  const trailH = /^### The agent's decisions, in order \((\d+)\)$/m.exec(md);
  const anchors = (from, to) => [...md.slice(from, to).matchAll(/<a name="item-(\d+)"><\/a>/g)].map((m) => Number(m[1]));
  // Must act, then Must know, then Good to know, then the agent's decisions, then your prompt (D131, D161); the sections
  // end where the next begins.
  const actEnd = knowH.index, knowEnd = goodH.index;
  const goodEnd = trailH ? trailH.index : promptH.index;
  const trailPart = trailH ? md.slice(trailH.index, promptH.index) : '';
  const rows = md.split('\n').filter((l) => /^\| (Done|Partly done|Not done|Not checked) \|/.test(l));
  const words = Object.fromEntries(Object.entries(REPORT_PROMPT_WORDS.status).map(([k, w]) => [w, k]));
  const asks = {};
  for (const row of rows) { const w = words[row.split(' | ')[0].slice(2)]; asks[w] = (asks[w] ?? 0) + 1; }
  const notShown = new RegExp(`^${REPORT_NOT_CHECKED_WORDS.rowsNotShown(999).replace('999', '(\\d+)').replace(/\./g, '\\.')}$`, 'm');
  const promptPart = md.slice(promptH.index, didH);
  const hidden = Number(notShown.exec(promptPart)?.[1] ?? 0);
  const labels = md.split('\n').find((l) => l.startsWith('Must act: ['));
  const targets = labels ? [...labels.matchAll(/\]\(#item-(\d+)\)/g)].map((m) => Number(m[1])) : [];
  const more = labels ? Number(/and (\d+) more/.exec(labels)?.[1] ?? 0) : 0;
  return { head, body: { act: Number(actH[1]), know: Number(knowH[1]), good: Number(goodH[1]),
    // D163: Must act holds its items and its pointers to the decisions tagged Must act (a link each, kept shortened).
    actIds: [...anchors(actH.index, actEnd), ...[...md.slice(actH.index, actEnd).matchAll(/\[\d+[^\]]*\]\(#item-(\d+)\)/g)]
      .map((m) => Number(m[1]))], knowItems: anchors(knowH.index, knowEnd).length,
    goodItems: goodItems(md.slice(goodH.index, goodEnd)), promptHeading: promptH[1], asks, hidden, targets, more,
    trail: trailMd(trailPart),
    order: [actH.index, knowH.index, goodH.index, ...(trailH ? [trailH.index] : []), promptH.index, didH] } };
}

/** The invariant: no first-screen number differs from the body's. */
function sameNumbers(name, { head, body }, kind) {
  const where = `${name} (${kind})`;
  assert.deepEqual([head.act, head.know, head.good], [body.act, body.know, body.good], `${where}: tier counts and headings`);
  assert.equal(body.actIds.length, head.act, `${where}: Must act items`);
  assert.equal(body.knowItems, head.know, `${where}: Must know items`);
  assert.equal(body.goodItems, head.good, `${where}: Good to know items`);
  const parts = partsOf(head.parts);
  const asked = /^Your prompt \((\d+) asks?(?:: (.*))?\)$/.exec(body.promptHeading);
  assert.ok(asked, `${where}: ${body.promptHeading}`);
  assert.equal(asked[2] ?? head.parts, head.parts.startsWith('Sonah found no ask') ? head.parts : asked[2],
    `${where}: the prompt's parts`);
  assert.equal(Number(asked[1]), sum(parts), `${where}: the prompt's count is the sum of its parts`);
  const shown = { ...body.asks };
  if (kind === 'md' && body.hidden) shown.done = (shown.done ?? 0) + body.hidden;
  assert.deepEqual(shown, kind === 'md' ? byWord(parts) : parts, `${where}: the asks by status`);
  if (kind === 'md' && body.hidden) assert.equal(body.hidden, parts.done, `${where}: the rows not shown are the done asks`);
  assert.equal(body.targets.length + body.more, head.act, `${where}: Must act's labels and "and N more"`);
  // D161: the agent's decisions, counted on the count line as in their part, with their Must tags.
  assert.deepEqual([head.decisions, head.decisions], [body.trail.heading, body.trail.items], `${where}: decisions`);
  assert.deepEqual(head.tagged, body.trail.tagged, `${where}: the decisions' Must tags`);
  for (const n of body.targets) assert.ok(body.actIds.includes(n), `${where}: label item ${n} is in Must act`);
}

test('D131: no first-screen number differs from the body\'s, on every page and report .md the tests hold', () => {
  const all = reviews();
  for (const x of all) {
    sameNumbers(x.name, pageNumbers(x.page), 'page');
    const md = mdNumbers(x.md);
    sameNumbers(x.name, md, 'md');
    // Must act, Must know, Good to know, the agent's decisions, your prompt, What the agent did: in that order (D131,
    // D161).
    assert.deepEqual(md.body.order, [...md.body.order].sort((a, b) => a - b), x.name);
  }
  // The snapshots hold to it as written.
  sameNumbers('page snapshot', pageNumbers(readFileSync(new URL('./snapshots/session-page-report.html', import.meta.url),
    'utf8')), 'page');
  sameNumbers('md snapshot', mdNumbers(readFileSync(new URL('./snapshots/report.md', import.meta.url), 'utf8')), 'md');
  // The cases reach what they are for: a folded prompt, a shortened report that hides done asks, a Must act list longer
  // than its labels.
  assert.ok(all.some((x) => x.model.prompt.folded === true));
  assert.ok(all.some((x) => mdNumbers(x.md).body.hidden > 0));
  assert.ok(all.some((x) => x.model.countLine.more > 0));
  // D161: and a report whose decisions carry a Must tag.
  assert.ok(all.some((x) => x.model.decisions.tagged.must_know > 0 && x.model.decisions.tagged.must_act > 0));
});

test('D131: Must act and Must know come before your prompt; a session of more than 30 asks folds it after them', () => {
  assert.equal(REPORT_LIMITS.openAsks, 30);
  assert.equal(MUST_FIRST_ON_EVERY_PAGE, true);
  for (const n of [1, REPORT_LIMITS.openAsks, REPORT_LIMITS.openAsks + 1]) {
    const { session, report } = longReview(n);
    const model = reportModel(session, report, {});
    const folded = n > REPORT_LIMITS.openAsks;
    assert.equal(model.prompt.folded === true, folded, `${n} asks`);
    assert.equal(promptAfterTiers(model), true);
    const page = renderSessionPage(session, report, {});
    const md = renderReportMarkdown(session, report, {});
    // Page: the first Must act item comes before your prompt, and the prompt is a closed fold only on a long session.
    assert.ok(page.indexOf('id="must-act"') < page.indexOf('id="must-know"'));
    assert.ok(page.indexOf('id="must-know"') < page.indexOf('id="prompt"'));
    // D161: Good to know, folded, and the agent's decisions come before your prompt too.
    assert.ok(page.indexOf('id="good-to-know"') < page.indexOf('id="prompt"'));
    assert.equal(page.includes('<details class="card-ui part fold-part" id="prompt">'), folded, `${n} asks: page fold`);
    assert.equal(page.includes('<section class="card-ui part" id="prompt">'), !folded, `${n} asks: page section`);
    // Its count stays in sight: the fold's summary is the prompt's heading, with every count.
    const heading = `Your prompt (${n} ${n === 1 ? 'ask' : 'asks'}: ${model.prompt.parts.join(', ')})`;
    assert.ok(page.includes(`<h2>${heading}</h2>`), heading);
    assert.ok(md.includes(folded ? `<details><summary>${heading}</summary>` : `### ${heading}`), `${n} asks: md heading`);
    assert.ok(md.indexOf('### Must know') < md.indexOf(heading));
    // Every ask keeps its place on the page, folded or not: links to it still land.
    for (let k = 1; k <= n; k++) assert.ok(page.includes(`id="ask-${k}"`), `ask ${k}`);
  }
});

test('D131: a long session\'s shortened .md says so once, above its folded prompt and outside it', () => {
  const { session, report } = longReview(133, 13);
  const model = reportModel(session, report, {});
  assert.equal(model.prompt.folded, true);
  assert.ok(model.prompt.messages.every((m) => m.chars <= REPORT_LIMITS.messageChars), 'no message is cut: the asks are');
  const md = renderReportMarkdown(session, report, {});
  assert.ok(Buffer.byteLength(md, 'utf8') <= REPORT_MD_LIMITS.maxBytes);
  const notice = /Sonah shortened this report to fit a GitHub comment\./;
  assert.equal(md.split(notice).length - 1, 1, 'said once');
  const heading = `<details><summary>Your prompt (133 asks: ${model.prompt.parts.join(', ')})</summary>`;
  const at = md.indexOf(heading);
  assert.ok(at > 0);
  assert.match(md.slice(0, at), /Sonah shortened this report to fit a GitHub comment\.[^\n]*\n\n$/, 'right above the fold');
  // The fold holds the asks that are not done, and counts the rest and your messages.
  const fold = md.slice(at, md.indexOf('\n</details>', at));
  assert.doesNotMatch(fold, notice);
  assert.equal(fold.split('\n').filter((l) => /^\| (Partly done|Not done|Not checked) \|/.test(l)).length,
    model.prompt.asks.filter((ask) => ask.state !== 'done').length);
  assert.ok(fold.includes(REPORT_NOT_CHECKED_WORDS.rowsNotShown(model.prompt.counts.done)));
  assert.ok(fold.includes('Sonah does not show your 133 messages here.'));
  // The table does not show every ask, so its sentence names the asks, not the table (D131's review).
  assert.ok(fold.includes(REPORT_MD_WORDS.coverageAsks));
  assert.equal(fold.includes(REPORT_MD_WORDS.coverage), false);
  // Unshortened, a long session shows every row: the notice is the shortening's alone, and the table's sentence holds.
  // (D144: each ask not done or done only in part leads in Must act with a prompt for the agent, so at 133 asks the
  // report no longer fits whole; 100 asks, still a long session, does.)
  const short = longReview(100);
  const whole = renderReportMarkdown(short.session, short.report, {});
  assert.doesNotMatch(whole, notice);
  assert.ok(whole.includes(REPORT_MD_WORDS.coverage));
  assert.equal(whole.includes(REPORT_MD_WORDS.coverageAsks), false);
});

test('D131 (review): a .md shortened past its done asks keeps one "Before compaction N." line above each kept run', () => {
  const { session, report } = longReview(133, 13, [40, 90]);
  const model = reportModel(session, report, {});
  assert.equal(model.prompt.compactions.length, 2);
  const md = renderReportMarkdown(session, report, {});
  assert.match(md, /Sonah does not show your 133 messages here\./, 'shortened past the done asks');
  const blocks = md.slice(md.indexOf('<details><summary>Your prompt (')).split('\n\n');
  const kept = model.prompt.asks.filter((ask) => ask.state !== 'done');
  for (const n of [1, 2]) {
    const line = REPORT_PROMPT_WORDS.beforeCompaction(n);
    const at = blocks.indexOf(line);
    assert.ok(at >= 0, line);
    assert.equal(blocks.filter((b) => b === line).length, 1, `${line} once`);
    // Right above a table of the kept asks given before that compaction (and after the one before it), each a row.
    const rows = blocks[at + 1].split('\n').filter((l) => /^\| (Partly done|Not done|Not checked) \|/.test(l));
    assert.equal(rows.length, kept.filter((ask) => ask.compaction === n).length, line);
    assert.ok(rows.length > 0);
  }
});

test('D131: a shortened .md keeps Must act and Must know evidence before the lists, and prints no empty evidence fold', () => {
  const { session, report } = oversized();
  const model = reportModel(session, report, repoFacts());
  const md = renderReportMarkdown(session, report, repoFacts());
  assert.ok(Buffer.byteLength(md, 'utf8') <= REPORT_MD_LIMITS.maxBytes);
  // Must act keeps every evidence fold, with its lines; Must know, cut later, shows none; none is printed empty. D161 (its
  // review): the fixture's 90 decisions made without asking you are tagged Must know in the report's second part and are
  // shortened as Must know is, never their lines: so they still push Must know's evidence out, in both parts.
  const filled = (tier) => (md.match(new RegExp(`<details><summary>Evidence · Why ${tier}</summary>\\n\\n- `, 'g'))
    ?? []).length;
  assert.equal(filled('Must act'), model.tiers.must_act.length + model.decisions.tagged.must_act);
  assert.equal(filled('Must know'), 0);
  assert.ok(model.decisions.total >= 90);
  // D161's review: lowest tier first across both parts: the decisions tagged Good to know are counted in their group;
  // those tagged Must know keep their line and anchor, as Must know of the first part does.
  for (const item of model.decisions.groups.flatMap((g) => g.items))
    assert.equal(md.includes(`<a name="item-${item.n}"></a>`), item.tier.final !== 'good_to_know', `decision ${item.n}`);
  assert.doesNotMatch(md, /<summary>[^\n]*<\/summary>\n\n<\/details>/, 'no fold is printed with nothing in it');
  // Your prompt keeps its counts and the rows of the asks that are not done; your messages are counted.
  const notDone = model.prompt.asks.filter((ask) => ask.state !== 'done');
  assert.equal(md.split('\n').filter((l) => /^\| (Done|Partly done|Not done|Not checked) \|/.test(l)).length, notDone.length);
  assert.ok(md.includes(REPORT_NOT_CHECKED_WORDS.rowsNotShown(model.prompt.asks.length - notDone.length)));
});
