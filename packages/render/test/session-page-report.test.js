// The session page renders the report model (D97): its order, its folds, its links,
// its rules (ported from the checklist page's: one escape, a CSP, no script, no resource, quotes grounded, the same bytes
// for the same inputs, a hard byte bound) and its snapshot. Every session and report here is synthetic.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { renderSessionPage, sessionPage, PAGE_VERSION, PAGE_LIMITS, PAGE_CSS } from '../session-page.js';
import { reportModel, REPORT_MODEL_VERSION } from '../report-model.js';
import { REPORT_TRIM_WORDS, REPORT_FOOTER_WORDS, REPORT_PROMPT_WORDS, REPORT_HEADER_WORDS } from '../report-words.js';
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
const itemOf = (html, n) => { const at = html.indexOf(`id="item-${n}"`); return html.slice(at, html.indexOf('</article>', at)); };
const modelOf = (shape = triagedReport, options = repoFacts()) => {
  const session = reportSession();
  return reportModel(session, shape(session), options);
};

test('D97: the synthetic report page renders exactly its snapshot', () => {
  // D112 amended (2026-10-18, unreleased, no version move): the fixture's Q1 names no place, so it is an item of its own.
  // D122 (b) (no version move): the fixture's refused read, a failure passed over, is in Must know.
  assert.equal(page(), readFileSync(SNAPSHOT, 'utf8'));
});

test('D97, D131: the page is the report model in its order — header, count line, Must act, Must know, prompt, then the folds', () => {
  const html = page();
  const at = (marker) => { const i = html.indexOf(marker); assert.ok(i >= 0, marker); return i; };
  // D131 (R1, B12): Must act and Must know before your prompt, on every page (report-model.js `promptAfterTiers`).
  const order = ['id="review-title"', 'class="count"', 'id="must-act"', 'id="must-know"', 'id="prompt"',
    'id="good-to-know"', 'id="did"', 'id="not-checked"', 'class="foot"'].map(at);
  assert.deepEqual(order, [...order].sort((a, b) => a - b));
  // Must act and Must know are open sections; Good to know, what the agent did and what Sonah could not check are
  // native folds, closed (no `open` attribute: the page runs no script).
  assert.match(html, /<section class="part tier" id="must-act">/);
  assert.match(html, /<details class="part tier fold-tier" id="good-to-know">/);
  assert.match(html, /<details class="card-ui part fold-part" id="did">/);
  assert.equal(/<details[^>]* open/.test(html), false);
  // Every fold's summary carries its count.
  const model = modelOf();
  assert.match(html, new RegExp(`Good to know \\(${model.tiers.good_to_know.length}\\)`));
  // R17: the fold counts the commands as the header does, and the calls of other tools apart.
  assert.match(html, new RegExp(`What the agent did \\(${model.did.files.total} files · ${model.did.runs.commands} commands · `
    + `${model.did.runs.others} other calls? · ${model.did.claims.total} claims\\)`));
  assert.ok(model.header.size.includes(`${model.did.runs.commands} commands`));
  assert.match(html, new RegExp(`What Sonah could not check \\(${model.notChecked.total} facts?\\)`));
  // Each item is numbered once; each Good to know item is one line that opens to the full item.
  for (const item of [...model.tiers.must_act, ...model.tiers.must_know])
    assert.match(html, new RegExp(`<article class="item t-[a-z]+" id="item-${item.n}">`));
  for (const item of model.tiers.good_to_know)
    assert.match(html, new RegExp(`<details class="item gtk t-[a-z]+" id="item-${item.n}"><summary>`));
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
  assert.equal(PAGE_VERSION, 'sonah.session-page/46');
});

test('D97 (13): the page is inert: one CSP, no script, no resource; the only link out is a validated GitHub permalink', () => {
  const html = page();
  assert.match(html, /<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'">/);
  assert.equal(/<script|<link|<img|<iframe|<object|<embed|<form|src=|@import|url\(/i.test(html), false);
  const hrefs = [...html.matchAll(/href="([^"]*)"/g)].map((m) => unescape(m[1]));
  const out = hrefs.filter((h) => !h.startsWith('#'));
  assert.ok(out.length > 0, 'the fixture has permalinks');
  for (const href of out) assert.match(href, new RegExp(`^https://github\\.com/example-org/example-api/blob/(?:${HEAD}|2{40})/`));
  for (const tag of html.matchAll(/<a [^>]*href="https:[^>]*>/g)) assert.match(tag[0], /rel="noreferrer noopener"/);
  for (const href of hrefs.filter((h) => h.startsWith('#')))
    assert.match(href, /^#(?:ask|item|run|claim|not-checked|did|prompt|must-act|must-know|good-to-know)(?:-[A-Za-z0-9]+)?$/);
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
  assert.match(missing, /Sonah did not find this quote in the recording\./);
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
  // R2: the page says it left something out, so the .md beside it never says that the page holds every part.
  assert.deepEqual([sessionPage(session, report, repoFacts()).html === html, sessionPage(session, report, repoFacts()).whole],
    [true, false]);
  const model = reportModel(session, report, repoFacts());
  for (const item of [...model.tiers.must_act, ...model.tiers.must_know]) {
    assert.ok(html.includes(`id="item-${item.n}"`), `item ${item.n} stays`);
    // Its visible lines stay whole: the quote, the impact, what the agent said, the action and where.
    const shown = itemOf(html, item.n);
    if (item.quote) assert.ok(shown.includes('<blockquote class="item-quote">'), `item ${item.n} quote`);
    if (item.impact) assert.ok(shown.includes('<p class="line impact">'), `item ${item.n} impact`);
    if (item.action) assert.ok(shown.includes('<p class="line action">'), `item ${item.n} action`);
    if (item.agentSaid) assert.ok(shown.includes('<p class="line agent-said">'), `item ${item.n} agent said`);
    if (item.where.length) assert.ok(shown.includes('<p class="line where">'), `item ${item.n} where`);
  }
  // No message was long: the page says nothing of messages.
  assert.equal(html.includes(REPORT_TRIM_WORDS.messagesTrimmed), false);
  // Each trim says so once where it happens.
  const said = (sentence) => html.split(sentence).length - 1;
  // The evidence folds of Good to know, then of Must act and Must know: said once in each place the trim happens.
  assert.equal(said(REPORT_TRIM_WORDS.trimmed), 2);
  // The lists of what the agent did are cut, and so is the list of messages that hold no ask: said once in each place.
  const prompt = html.slice(html.indexOf('id="prompt"'), html.indexOf('id="good-to-know"'));
  const did = html.slice(html.indexOf('id="did"'), html.indexOf('id="not-checked"'));
  assert.equal(said(REPORT_TRIM_WORDS.listsTrimmed), 2);
  assert.equal([prompt, did].map((part) => part.split(REPORT_TRIM_WORDS.listsTrimmed).length - 1).join(), '1,1');
  assert.ok(prompt.includes('Sonah does not show 1 more of this list here.'), 'the list counts what it leaves out');
  assert.match(html, /<details class="evidence"><summary>[^<]*<\/summary><\/details>/, 'an evidence fold keeps its summary');
  // A page within its bound says nothing of trims.
  const small = page();
  assert.equal(small.includes(REPORT_TRIM_WORDS.trimmed) || small.includes(REPORT_TRIM_WORDS.listsTrimmed)
    || small.includes(REPORT_TRIM_WORDS.messagesTrimmed), false);
});

test('D97 (23): the reviews\' words are set apart by source; the legend says whose; your answer command is printed once', () => {
  const html = page();
  assert.match(html, /<em class="by-code-review">The bucket refills before the first request<\/em>/);
  assert.match(html, /<em class="by-code-review">A burst of requests passes the limit at start\.<\/em>/);
  assert.match(html, /<em class="by-code-review">Refill the bucket after the first request\.<\/em>/);
  assert.match(html, /<em class="by-code-review">adds a token bucket limiter<\/em>/);
  assert.match(html, /<em class="by-session-review">seconds<\/em>/);
  for (const line of [REPORT_FOOTER_WORDS.legend, REPORT_FOOTER_WORDS.legendCodeReview,
    REPORT_FOOTER_WORDS.legendSessionReview, REPORT_FOOTER_WORDS.triageLegend, REPORT_FOOTER_WORDS.share])
    assert.ok(textOf(html).includes(unescape(line)), line);
  assert.equal(html.split('sonah decision accept|change|clarify').length - 1, 1);
  // The title is your words, in quotation marks.
  assert.match(html, /<p class="title-words"><q class="said">Add rate limiting to the API\.<\/q><\/p>/);
  // A review with no code step says so on the header, and shows no impact or action line.
  const plain = page(sessionReviewOnlyReport, {});
  // D118 (a): the owner's sentence and its one closed reason, first after your words.
  assert.match(plain, /<p class="title-words">[^\n]*?<\/p><p class="meta no-code">No code was reviewed\. Reason: this review ran without the code review\. The items show no impact and no action\.<\/p>/);
  assert.equal(/Impact on you:|Action:/.test(plain), false);
});

test('D97: the page follows the reader\'s theme unless asked; the colours stay those of sonah.dev', () => {
  assert.match(page(), /<html lang="en">/);
  assert.match(page(triagedReport, { ...repoFacts(), theme: 'dark' }), /<html lang="en" data-theme="dark">/);
  assert.match(PAGE_CSS, /--accent: #f48d16;/);
  assert.match(PAGE_CSS, /@media \(prefers-color-scheme: dark\)/);
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
  const of = (chosen) => itemOf(html, [...model.tiers.must_know, ...model.tiers.good_to_know]
    .find((item) => item.what.parts.some((p) => p.text === chosen)).n);
  const first = of('in-memory Map');
  assert.match(first, /You asked:<\/span> <q class="said">Store sessions somewhere durable<\/q>/);
  assert.match(first, /The agent said:<\/span> <q class="said">keep the session store in memory<\/q>/);
  assert.match(first, /Code written:<\/span> <q class="said">new Map\(\)<\/q>/);
  assert.doesNotMatch(of('Redis'), /Code written/);
  assert.match(of('an in-memory fake'), /A helper said:<\/span> <q class="said">use an in-memory fake<\/q>/);
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
  const prompt = html.slice(html.indexOf('id="prompt"'), html.indexOf('id="good-to-know"'));
  // The start, then the whole message folded with its line breaks; each ask's id given once.
  assert.match(prompt, /<details class="whole"><summary>Show the whole message<\/summary><p class="message">Please do these things:\n- item 0/);
  assert.equal((prompt.match(/id="ask-1"/g) ?? []).length, 1);
  assert.equal((prompt.match(/id="ask-2"/g) ?? []).length, 1);
  assert.match(prompt, /<mark class="ask s-done" id="ask-2"><span class="tag">Done<\/span>change the module named part11 carefully<\/mark>/);
  // A message held in two recorded spans: the join is Sonah's, outside both spans.
  assert.match(prompt, /First half of the ask\.<span class="join"> … <\/span><mark class="ask s-notChecked" id="ask-3">/);
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
  const blend = (fg, a, bg) => fg.map((c, i) => c * a + bg[i] * (1 - a));
  const token = (block, name) => new RegExp(`--${name}: (#[0-9a-f]{6}|rgba\\([^)]*\\))`).exec(block)[1];
  const rgba = (value) => { const [r0, g, b, a] = value.slice(5, -1).split(',').map(Number); return [[r0 / 255, g / 255, b / 255], a]; };
  const light = PAGE_CSS.slice(PAGE_CSS.indexOf(':root {'), PAGE_CSS.indexOf('@media'));
  const dark = PAGE_CSS.slice(PAGE_CSS.indexOf(':root[data-theme="dark"]'));
  for (const block of [light, dark]) {
    const card = hex(token(block, 'card')), wash = hex(token(block, 'wash'));
    const backs = [card, wash];
    for (const tint of ['accent-soft', 'mark']) { const [c, a] = rgba(token(block, tint)); backs.push(blend(c, a, card)); }
    for (const name of ['faint', 'muted', 'ink', 'accent-ink'])
      for (const back of backs) assert.ok(ratio(hex(token(block, name)), back) >= 4.5, `${name} ${ratio(hex(token(block, name)), back).toFixed(2)}`);
  }
  // The accent itself only draws borders and marks, never text.
  assert.doesNotMatch(PAGE_CSS, /[;{]\s*color: var\(--accent\);/);
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
  const prompt = html.slice(html.indexOf('id="prompt"'), html.indexOf('id="good-to-know"'));
  assert.equal(html.split(REPORT_TRIM_WORDS.messagesTrimmed).length - 1, 1);
  assert.ok(prompt.includes(REPORT_TRIM_WORDS.messagesTrimmed));
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
  assert.equal(whole.includes(REPORT_TRIM_WORDS.messagesTrimmed), false);
  assert.ok(whole.includes('<p class="message">Thanks.</p>'));
});
