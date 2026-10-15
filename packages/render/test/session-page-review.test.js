// D69 f (g), the page review (2026-10-08): what each finding of the review changed on the session page, checked on
// synthetic sessions and reports only. Every session, path, command and report here is invented.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderSessionPage, PAGE_CSS, PAGE_LIMITS, PAGE_SENTENCES, PAGE_LABELS, PAGE_COLUMN_REASON_WORDS,
  PAGE_ANSWER_WORDS, PAGE_CAUSE_WORDS, PAGE_GAP_WORDS } from '../session-page.js';
import { sessionBuilder, storySession, storyReport, STORY_KEY } from './session-story-fixture.js';
import { JUDGMENT_REASONS } from '../../evidence/src/ledger.js';
import { COVERAGE_CAUSES, FOLDED_SECTION_WORDS } from '../../evidence/src/review.js';

const page = (session = storySession(), report = storyReport(), options = {}) => renderSessionPage(session, report, options);
const unescape = (text) => text.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
  .replace(/&amp;/g, '&');
const textOf = (html) => unescape(html.replace(/<style>[\s\S]*?<\/style>/, '').replace(/<q class="said[^"]*">/g, '“')
  .replace(/<\/q>/g, '”').replace(/<\/?code>/g, '').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ')
  .replace(/“ /g, '“').replace(/ ”/g, '”').replace(/ ([.,;:])/g, '$1');
/** A row's markup, to its own close (a row may hold a list of its own). */
const itemOf = (html, id) => html.slice(html.indexOf(`id="${id}"`), html.indexOf('</div></li>', html.indexOf(`id="${id}"`)));
const sectionOf = (html, id) => html.slice(html.indexOf(`id="${id}"`), html.indexOf('</section>', html.indexOf(`id="${id}"`)));
const receipt = (role, eventId, quote) => ({ role, eventId, quote, sessionKey: STORY_KEY });
const windowsOf = (...lists) => lists.map((eventIds, windowIndex) => ({ windowIndex, eventIds, failure: null }));
const decided = (fields) => ({ actorSession: STORY_KEY, dimension: 'store', chosen: 'a store', value: null, valueReceipt: null,
  valueState: 'unchecked', actions: [], stated: null, constrainedBy: null, instructionReview: null, column: 'asked-chose',
  columnState: 'grounded', amends: [], materiality: 'material', materialityRule: 'synthetic', relevance: 'unchecked', reasons: [],
  ...fields });
const HASH = 'c'.repeat(64);
const idOf = (n) => `sha256:${String(n).repeat(64).slice(0, 64)}`;
const linksIn = (html) => [...html.matchAll(/href="#([^"]*)"/g)].map((m) => m[1]);
const allLinked = (html) => { for (const target of linksIn(html)) assert.ok(html.includes(`id="${target}"`), `#${target} exists`); };

test('D69 f (g) finding 1: each decision carries its short ledger id; the command that records your answer is printed once', () => {
  const html = page(storySession(), storyReport(), { sessionHash: HASH });
  for (const [k, id] of [[1, 'd1'], [2, 'd2'], [3, 'd3'], [4, 'd4']])
    assert.ok(itemOf(html, `decision-${k}`).includes(`<p class="note meta"><span class="label">Decision id</span> <code>${id}${'0'.repeat(10)}</code></p>`),
      `decision ${k}`);
  // /14: the command is printed once, under where your attention is needed, with the session's hash and the parts to
  // replace; where the report is kept is said in words that name no folder of this computer's. No row repeats it.
  const intro = html.slice(html.indexOf('<div class="attention'), html.indexOf('id="requests"'));
  assert.ok(textOf(intro).includes(PAGE_SENTENCES.answerIntro));
  assert.ok(intro.includes(`<p class="cmd"><code>sonah decision accept|change|clarify ${HASH} ROW_ID --report REPORT `
    + '--reason &quot;YOUR REASON&quot;</code></p>'));
  assert.ok(textOf(intro).includes(PAGE_SENTENCES.answerReport));
  assert.deepEqual([html.match(/sonah decision/g).length, html.match(/class="cmd"/g).length], [1, 1]);
  // Without the session's hash the command cannot be run: the same id under each row, and no command.
  const bare = page();
  assert.match(itemOf(bare, 'decision-1'), /<span class="label">Decision id<\/span> <code>d10000000000<\/code>/);
  for (const k of [1, 2, 3, 4]) assert.equal(itemOf(bare, `decision-${k}`), itemOf(html, `decision-${k}`), `decision ${k}`);
  assert.doesNotMatch(bare, /sonah decision|class="cmd"/);
  assert.equal(textOf(bare).includes(PAGE_SENTENCES.answerIntro), false);
  assert.equal(textOf(bare).includes(PAGE_SENTENCES.answerReport), false);
  // A decision with no ledger id (an older report) has neither; a hash not of its form is not used.
  const old = storyReport();
  delete old.decisions[0].id;
  assert.doesNotMatch(itemOf(page(storySession(), old, { sessionHash: HASH }), 'decision-1'), /sonah decision|Decision id/);
  assert.doesNotMatch(page(storySession(), storyReport(), { sessionHash: 'not-a-hash' }), /sonah decision/);
});

test('D69 f (g) finding 1: your earlier answer is shown under its decision, in your words, escaped and never as a quote', () => {
  const answers = new Map([[`sha256:d1${'0'.repeat(62)}`, { verb: 'change', reason: 'Use the <shared> store & keep it.' }],
    [`sha256:d4${'0'.repeat(62)}`, { verb: 'accept', reason: 'Fine.' }],
    // Ignored: a verb the page has no words for, an empty reason, an id of another form.
    [`sha256:d2${'0'.repeat(62)}`, { verb: 'approve', reason: 'x' }], [`sha256:d3${'0'.repeat(62)}`, { verb: 'accept', reason: '  ' }],
    ['d9', { verb: 'accept', reason: 'x' }]]);
  const html = page(storySession(), storyReport(), { sessionHash: HASH, decisionReviews: answers });
  assert.match(itemOf(html, 'decision-1'), /<p class="note answer"><span class="label">Your answer<\/span> You asked to change it\. Your reason: Use the &lt;shared&gt; store &amp; keep it\.<\/p>/);
  assert.ok(textOf(itemOf(html, 'decision-4')).includes(`${PAGE_LABELS.answer} ${PAGE_ANSWER_WORDS.accept} Your reason: Fine.`));
  for (const k of [2, 3]) assert.doesNotMatch(itemOf(html, `decision-${k}`), /class="note answer"/);
  assert.doesNotMatch(html, /<q class="said">[^<]*shared/);
  // The same answers as a plain object read the same.
  assert.equal(page(storySession(), storyReport(), { sessionHash: HASH, decisionReviews: Object.fromEntries(answers) }), html);
  assert.deepEqual(Object.keys(PAGE_ANSWER_WORDS), ['accept', 'change', 'clarify']);
});

/** A session of two requests and three steps; the review proposed each requirement in the windows it names. */
function requested() {
  const b = sessionBuilder();
  b.ask('I1', 'Add the cache and keep the old API working.');
  b.say('C1', 'I will add a cache layer.');
  b.change('W1', 'src/cache.js', { after: 'export const cache = new Map();\n' });
  b.run('R1', 'npm test', 'failed', 'fail 1');
  b.ask('I2', 'Now document it.');
  b.change('W2', 'docs/cache.md', { after: '# Cache\n' });
  b.say('F1', 'The cache is documented.', 'final');
  const session = b.session();
  const narrative = (rows) => ({ requirements: rows });
  const row = (eventId, quote, status) => ({ instruction: receipt('instruction', eventId, quote), text: quote, status });
  const windowResults = [
    { windowIndex: 0, eventIds: ['I1', 'C1', 'W1', 'W1-r'], failure: null,
      narrative: narrative([row('I1', 'Add the cache', 'addressed'), row('I1', 'keep the old API working', 'open')]) },
    { windowIndex: 1, eventIds: ['R1', 'R1-r'], failure: null,
      narrative: narrative([row('I1', 'Add the cache', 'addressed'), row('I1', 'keep the old API working', 'partly-addressed')]) },
    { windowIndex: 2, eventIds: ['I2', 'W2', 'W2-r', 'F1'], failure: null, narrative: narrative([row('I2', 'document it', 'addressed')]) }];
  const report = { windowResults, sessionStatus: 'FYI', coverage: 'complete', sessionReview: 'complete',
    requirements: [row('I1', 'Add the cache', 'addressed'), row('I1', 'keep the old API working', 'partly-addressed'),
      row('I2', 'document it', 'addressed')],
    promises: [{ stated: receipt('commentary', 'F1', 'The cache is documented'), text: 'Docs written', status: 'open' }],
    decisions: [decided({ id: idOf(1), dimension: 'cache store', chosen: 'a Map', actions: ['W1'],
      stated: receipt('commentary', 'C1', 'add a cache layer'),
      constrainedBy: { instruction: receipt('instruction', 'I1', 'Add the cache and'), settles: false, settledValueQuote: null } })],
    findings: [{ origin: 'session-review', kind: 'claim_contradicted', status: 'FYI', title: 'The old API',
      receipts: [receipt('instruction', 'I1', 'keep the old API'), receipt('commentary', 'C1', 'I will add a cache layer')] }] };
  return { session, report };
}

test('D69 f (g) finding 2: a requirement links the rows citing its words, and folds what its steps did; its status is untouched', () => {
  const { session, report } = requested();
  const html = page(session, report);
  allLinked(html);
  const rows = [...sectionOf(html, 'requests').matchAll(/<li><span class="pill reading">[\s\S]*?<\/li>/g)].map((m) => m[0]);
  assert.equal(rows.length, 3);
  // "Add the cache": the decision's instruction quote overlaps it by half the shorter, in the same request.
  assert.match(rows[0], /<span class="label">Cited in<\/span> <a href="#decision-1">decision 1<\/a>/);
  // "keep the old API working": the finding's instruction receipt overlaps it.
  assert.match(rows[1], /<span class="pill reading">partly addressed<\/span>[\s\S]*<span class="label">Cited in<\/span> <a href="#finding-1">finding 1<\/a>/);
  assert.doesNotMatch(rows[1], /decision-1/, 'a quote of other words of the same request is not linked');
  assert.doesNotMatch(rows[2], /Cited in/);
  // Folded: what its own steps did — the failed command and the file changed, both in request 1's step (story /14, D77 C:
  // a step is one of your requests, so the two windows that reviewed request 1 are one step); the claim of request 2's
  // step is the third row's.
  assert.match(rows[1], /<details class="row-steps"><summary>What its steps did<\/summary><p class="note meta">1 command failed \(<a href="#step-1">step 1<\/a>\) · no claim · changed 1 file: <code>src\/cache\.js<\/code><\/p><\/details>/);
  assert.match(rows[2], /no command failed · claim <a href="#claim-1">claim 1<\/a> · changed 1 file: <code>docs\/cache\.md<\/code>/);
  // The status is the review's, as before.
  assert.ok(textOf(sectionOf(html, 'requests')).includes(PAGE_SENTENCES.statusReading));
  assert.deepEqual(rows.map((r) => /pill reading">([^<]*)</.exec(r)[1]), ['addressed', 'partly addressed', 'addressed']);
});

test('D69 f (g) finding 5, D71 (a), (S4): the checklist in its order, each finding linked to the request and decision its receipts cite', () => {
  const { session, report } = requested();
  const html = page(session, report);
  // D88: the judgment first, then the settled problems; what Sonah could not check last.
  const order = ['<div class="attention', 'id="decisions"', 'id="requests"', 'id="failures"', 'id="claims"', 'id="edits"',
    'id="unchecked"', 'id="steps"', 'id="files"', '<footer'].map((part) => html.indexOf(part));
  assert.deepEqual(order, [...order].sort((a, b) => a - b));
  assert.ok(order.every((at) => at > 0));
  // D71 (a): no verdict; where your attention is needed links to each place: the findings, what could not be checked.
  assert.doesNotMatch(html, /class="verdict|Needs your decision|Not fully checked/);
  assert.match(page(), /<li><a href="#claims">1 claim of the agent&#39;s contradicted by the recording<\/a><\/li>/);
  // Story /14 (D77 C): the fixture's seven review windows review two requests, so they are two steps.
  assert.match(page(), /<li><a href="#unchecked">1 of 2 steps was not reviewed<\/a><\/li>/);
  assert.match(html, /<li><a href="#unchecked">The session review did not complete<\/a><\/li>/);
  assert.match(itemOf(html, 'finding-1'), /<span class="label">Concerns<\/span> <a href="#request-1">request 1<\/a> and <a href="#decision-1">decision 1<\/a>/);
  assert.doesNotMatch(html, /<dl class="facts">/);
});

test('D69 f (g) finding 7: requests are chosen by status, the fully addressed folded, the rest one line each', () => {
  const b = sessionBuilder();
  const n = PAGE_LIMITS.asks + 5;
  for (let k = 1; k <= n; k++) b.ask(`I${k}`, `Request number ${k}.`);
  const session = b.session();
  const status = (k) => (k % 10 === 0 ? 'open' : 'addressed');
  const report = { windowResults: windowsOf(session.events.map((e) => e.id)), sessionStatus: 'CLEAN',
    requirements: Array.from({ length: n }, (_, i) => ({ instruction: receipt('instruction', `I${i + 1}`, `Request number ${i + 1}`),
      text: 'x', status: status(i + 1) })) };
  const html = page(session, report);
  allLinked(html);
  const requests = sectionOf(html, 'requests');
  // Every request short of addressed is shown whole and open, first (k = 10, 20, 30, 40)…
  const open = requests.slice(0, requests.indexOf('<details class="fold">'));
  assert.deepEqual([...open.matchAll(/<li class="finding" id="request-(\d+)">/g)].map((m) => Number(m[1])), [10, 20, 30, 40]);
  // …then the fully addressed ones folded, up to the bound, then one line each; none only counted.
  assert.match(requests, /<details class="fold"><summary>Show the 36 requests the review read as fully addressed<\/summary>/);
  assert.match(textOf(requests), /5 more requests, one line each:/);
  assert.deepEqual([...requests.matchAll(/<li id="request-(\d+)">/g)].map((m) => Number(m[1])), [41, 42, 43, 44, 45]);
  assert.match(itemOf(html, 'request-41'), /<span class="mono">41<\/span> <span class="pill reading">1 addressed<\/span> <span class="turn">/);
  for (let k = 1; k <= n; k++) assert.equal(html.split(`id="request-${k}"`).length, 2, `request ${k} once`);
  assert.doesNotMatch(textOf(requests), /requests? (is|are) not shown/);
  // Within a request, every instruction short of addressed is shown first; the ones left out are counted by status.
  const c = sessionBuilder();
  c.ask('I1', 'a b c d e f g h i j k');
  const many = { windowResults: windowsOf(['I1']), sessionStatus: 'CLEAN', requirements: 'abcdefghijk'.split('')
    .map((w, i) => ({ instruction: receipt('instruction', 'I1', w), text: w, status: i >= 9 ? 'open' : 'addressed' })) };
  const one = itemOf(page(c.session(), many), 'request-1');
  assert.equal((one.match(/<span class="pill reading">open<\/span>/g) ?? []).length, 2);
  assert.match(textOf(one), /3 more instructions are not shown: 3 addressed\./);
});

test('D69 f (g) finding 8: one section says what could not be checked, in reader words, placed by structure', () => {
  // The closed reasons stay closed: the page's words are keyed by members of the vocabularies.
  for (const reason of Object.keys(PAGE_COLUMN_REASON_WORDS)) assert.ok(JUDGMENT_REASONS.includes(reason), reason);
  for (const cause of Object.keys(PAGE_CAUSE_WORDS)) assert.ok(COVERAGE_CAUSES.includes(cause), cause);
  for (const words of [...Object.values(PAGE_CAUSE_WORDS).map((say) => say({ n: 2, m: 3 })), ...Object.values(PAGE_GAP_WORDS)])
    assert.doesNotMatch(words, /adapter|declares|inventory|provable|shape/, words);
  const b = sessionBuilder();
  b.ask('I1', 'Build it.');
  b.say('C1', 'Writing the module.');
  b.change('W1', 'src/m.js', { after: 'export const m = 1;\n' });
  b.run('R1', 'npm test', 'succeeded', 'ok');
  const session = b.session();
  const report = { windowResults: windowsOf(['I1', 'C1'], ['W1', 'W1-r', 'R1', 'R1-r']), sessionStatus: 'NO_FINDINGS', coverage: 'partial',
    sessionReview: 'complete', coverageFacts: { windows: 2, actions: 2 },
    gaps: [{ code: 'command_outcome_unknown', channel: 'observations', scope: 'session', count: 1, eventIds: ['R1'] },
      { code: 'unsupported_message', channel: 'observations', scope: 'session', count: 2 }],
    decisions: [decided({ id: idOf(2), dimension: 'module', actions: ['W1'], column: null, columnState: 'unchecked',
      reasons: ['instructions_partial'], stated: receipt('commentary', 'C1', 'Writing the module') })],
    promises: [{ stated: receipt('commentary', 'C1', 'Writing the module'), text: 'A module', status: 'open' }],
    // A requirement whose quote is not in your request: shown only in the review's words.
    requirements: [{ instruction: receipt('instruction', 'I1', 'Build all of it'), text: 'Something else entirely', status: 'addressed' }] };
  const html = page(session, report);
  allLinked(html);
  // D71 (a): where your attention is needed links here — no verdict does.
  assert.match(html, /<li><a href="#unchecked">[^<]*<\/a><\/li>/);
  const section = textOf(sectionOf(html, 'unchecked'));
  // Story /14 (D77 C): the two review windows review one request, so they are one step, which holds every row.
  // One step "holds" its rows (D84 (4) c review).
  assert.ok(section.includes(`Not covered ${PAGE_CAUSE_WORDS.command_outcome_unknown({ n: 1 })
    .replace(/^./, (c) => c.toUpperCase())}: in step 1, which holds decision 1, claim 1 and request 1.`), section);
  assert.ok(section.includes(`Not covered ${PAGE_CAUSE_WORDS.unsupported_message({ n: 2 }).replace(/^./, (c) => c.toUpperCase())}.`));
  assert.ok(section.includes(`Whether you asked ${PAGE_COLUMN_REASON_WORDS.instructions_partial.replace(/^./, (c) => c.toUpperCase())}: decision 1.`));
  assert.ok(section.includes(`${PAGE_LABELS.reviewWords} ${PAGE_SENTENCES.reviewWordsRows(1)} request 1.`));
  // D88: the claim not checked is listed here in full, no longer pointed at.
  assert.ok(section.includes(`${FOLDED_SECTION_WORDS.groups.claimsOpen} (1) 01 Agent said step 1 “Writing the module” not checked`),
    section);
  // The stored review state is not trusted: recomputed, this review did not complete, and it says so first.
  assert.ok(section.includes(`What Sonah could not check (1) The review ${PAGE_SENTENCES.reviewIncomplete}`), section);
  // The recorder's terms never reach the reader; the footer holds only how to read the page.
  assert.doesNotMatch(textOf(html), /shape the adapter|provable|Not covered:/);
  assert.doesNotMatch(textOf(html.slice(html.indexOf('<footer'))), /step|covered|recorded result/);
  assert.match(itemOf(html, 'decision-1'), /<span class="label">Why it could not check<\/span> Your instructions before it were not all recorded in full/);
});

test('D69 f (g) finding 10: every text colour holds 4.5:1 on its backgrounds, in both themes', () => {
  const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
  const lin = (c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  const lum = (rgb) => 0.2126 * lin(rgb[0]) + 0.7152 * lin(rgb[1]) + 0.0722 * lin(rgb[2]);
  const ratio = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
  const blend = (fg, a, bg) => fg.map((c, i) => c * a + bg[i] * (1 - a));
  const token = (block, name) => new RegExp(`--${name}: (#[0-9a-f]{6}|rgba\\([^)]*\\))`).exec(block)[1];
  const rgba = (value) => { const [r, g, b, a] = value.slice(5, -1).split(',').map(Number); return [[r / 255, g / 255, b / 255], a]; };
  const light = PAGE_CSS.slice(PAGE_CSS.indexOf(':root {'), PAGE_CSS.indexOf('@media'));
  const dark = PAGE_CSS.slice(PAGE_CSS.indexOf(':root[data-theme="dark"]'));
  for (const block of [light, dark]) {
    const card = hex(token(block, 'card')), wash = hex(token(block, 'wash'));
    const [soft, alpha] = rgba(token(block, 'accent-soft'));
    const backs = [card, wash, blend(soft, alpha, card)];
    for (const name of ['faint', 'muted', 'ink', 'accent-ink'])
      for (const back of backs) assert.ok(ratio(hex(token(block, name)), back) >= 4.5, `${name} ${ratio(hex(token(block, name)), back).toFixed(2)}`);
  }
  // An accent label's text is in the accent's ink; the accent itself only draws borders and marks.
  assert.match(PAGE_CSS, /\.label\.accent \{ color: var\(--accent-ink\); \}/);
  assert.match(PAGE_CSS, /\.finding\.alert \.n \{ color: var\(--accent-ink\); \}/);
  assert.doesNotMatch(PAGE_CSS, /[;{]\s*color: var\(--accent\);/);
});

test('D69 f (g) finding 12: your settled choices folded, a change of approach beside the decision it shares an event with', () => {
  const html = page();
  const settled = html.slice(html.indexOf('<details class="group fold">'), html.indexOf('</details>', html.indexOf('<details class="group fold">')));
  assert.match(settled, /<summary><span class="label">You settled \(1\)<\/span><\/summary>/);
  assert.match(textOf(itemOf(html, 'decision-3')), /Decision step 1 Auth checks You settled it “Keep the existing auth checks intact”/);
  assert.doesNotMatch(itemOf(html, 'decision-3'), /<details class="change">|Files its cited actions/);
  // The fixture's change of approach cites the statement the unasked decision was made in: shown inside it, once.
  assert.match(textOf(itemOf(html, 'decision-1')), /It changed approach here In the review's words: Moved from Redis-backed counter store to in-process token bucket/);
  assert.doesNotMatch(html, /id="pivot-|id="approach"/);
  assert.equal((html.match(/so I am switching to an in-process token bucket/g) ?? []).length, 1, 'its own quote, once');
  // One that shares no event with a decision is listed among the decisions, after the agent's own judgments.
  const report = storyReport();
  report.pivots[0].receipts = [receipt('commentary', 'C1-0', 'I will read the middleware first')];
  const loose = page(storySession(), report);
  const at = (part) => loose.indexOf(part);
  // (D71 S4: your settled ones folded in the checklist's order, before the decisions it could not check.)
  assert.ok(at('<details class="group fold">') < at('Could not check whether you asked (1)') && at('Could not check whether you asked (1)') < at('Changes of approach (1)'));
  assert.match(itemOf(loose, 'pivot-1'), /Moved from Redis-backed counter store to in-process token bucket/);
  assert.ok(textOf(loose).includes(PAGE_SENTENCES.decidedPivots(1)));
});

test('D69 f (g) finding 14: a request held in several recorded spans is quoted span by span, the join outside the quotes', () => {
  const b = sessionBuilder();
  b.ask('I1', 'First half of the ask.');
  b.blobs.extra = 'Second half of it.';
  b.events.at(-1).text.push({ sourceKey: 'extra', fromByte: 0, untilByte: Buffer.byteLength(b.blobs.extra) });
  const session = b.session();
  const html = page(session, { windowResults: windowsOf(['I1']), sessionStatus: 'CLEAN' });
  assert.match(itemOf(html, 'request-1'), /<p class="title"><q class="said">First half of the ask\.<\/q> … <q class="said">Second half of it\.<\/q><\/p>/);
  assert.doesNotMatch(html, /<q class="said">[^<]* … [^<]*<\/q>/);
});
