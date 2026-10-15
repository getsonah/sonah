// D70 (b), owner decision 2026-10-08: "You asked, the agent chose how" is where the page shows the agent's own judgment on
// HOW to do the work the human asked for — each decision there shows the human's words it served, the choice the agent
// made (in its own words where the review grounded them, then the review's) and what it wrote or ran for it — always open,
// right after "Made without asking you", which stays first and marked as the more serious (D70 review S0: the how group
// is never folded; a row with no hunk its grounded code picks shows its cited actions' own edits, folded). The group is
// the ledger's derived column; nothing is re-decided from wording. Every session and report here is synthetic.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { renderSessionPage, PAGE_LABELS, PAGE_SENTENCES, PAGE_GROUP_WORDS, PAGE_VOICE_LABELS } from '../session-page.js';
import { honestStatuses } from '../../evidence/src/ledger.js';
import { sessionBuilder, STORY_KEY } from './session-story-fixture.js';

const SNAPSHOT = new URL('./snapshots/session-page-how.html', import.meta.url);
const TOKENS = /\b(DECIDE|FYI|CLEAN|NO_FINDINGS|UNCHECKED)\b|asked-settled|asked-chose|partly-addressed|\bunasked\b|\bmaterial\b|\bstructural\b|\bunverified\b/;
const unescape = (text) => text.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
  .replace(/&amp;/g, '&');
const textOf = (html) => unescape(html.replace(/<style>[\s\S]*?<\/style>/, '').replace(/<q class="said[^"]*">/g, '“')
  .replace(/<\/q>/g, '”').replace(/<\/?code>/g, '').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ')
  .replace(/“ /g, '“').replace(/ ”/g, '”').replace(/ ([.,;:])/g, '$1');
const itemOf = (html, id) => html.slice(html.indexOf(`id="${id}"`), html.indexOf('</li>', html.indexOf(`id="${id}"`)));
const receipt = (role, eventId, quote) => ({ role, eventId, quote, sessionKey: STORY_KEY });
const decided = (fields) => ({ actorSession: STORY_KEY, dimension: 'store', chosen: 'a store', value: null, valueReceipt: null,
  valueState: 'unchecked', actions: [], stated: null, constrainedBy: null, instructionReview: null, column: 'asked-chose',
  columnState: 'grounded', amends: [], materiality: 'material', materialityRule: 'synthetic', relevance: 'unchecked', reasons: [],
  ...fields });
const asked = (quote) => ({ instruction: receipt('instruction', 'I1', quote), settles: false, settledValueQuote: null });
const idOf = (n) => `sha256:${String(n).repeat(64).slice(0, 64)}`;

const ASK = 'Add a cache to the products API so repeat reads are fast, and log every cache miss.';
function howSession() {
  const b = sessionBuilder();
  b.ask('I1', ASK);
  b.say('C1', 'I will keep the cache in an LRU map with a five-minute TTL.');
  b.change('W1', 'src/cache.js', { after: 'export const cache = new LRUMap({ max: 500, ttlMs: 300_000 });\n' });
  b.say('C2', 'Misses go to the existing logger at debug level.');
  b.change('W2', 'src/products.js', { operation: 'edit', before: 'return db.find(id);\n',
    after: 'const hit = cache.get(id);\nif (!hit) logger.debug("cache miss", id);\nreturn hit ?? db.find(id);\n', priorState: 'edit-text' });
  b.say('C3', 'I am also upgrading the logger package to its next major version.');
  b.run('R1', 'npm install logger@3', 'succeeded', 'added 1 package');
  return b.session();
}
const windows = [{ windowIndex: 0, eventIds: ['I1', 'C1', 'W1', 'W1-r', 'C2', 'W2', 'W2-r', 'C3', 'R1', 'R1-r'], failure: null }];
function howReport({ unasked = true } = {}) {
  return { windowResults: windows, sessionStatus: 'CLEAN', findings: [], decisions: [
    ...(unasked ? [decided({ id: idOf(1), dimension: 'logger version', chosen: 'the logger\'s next major version', actions: ['R1'],
      column: 'unasked', stated: receipt('commentary', 'C3', 'upgrading the logger package to its next major version'),
      value: 'npm install logger@3', valueState: 'grounded',
      valueReceipt: { eventId: 'R1', field: 'command', role: 'action', quote: 'npm install logger@3', sessionKey: STORY_KEY } })] : []),
    // The agent's own words, the code it wrote and the hunk that code picks.
    decided({ id: idOf(2), dimension: 'cache store', chosen: 'an in-process LRU map, 500 entries, five-minute TTL', actions: ['W1'],
      constrainedBy: asked('Add a cache to the products API'), stated: receipt('commentary', 'C1', 'keep the cache in an LRU map with a five-minute TTL'),
      value: 'new LRUMap({ max: 500, ttlMs: 300_000 })', valueState: 'grounded',
      valueReceipt: { eventId: 'W1', field: 'added-code', role: 'code', quote: 'new LRUMap({ max: 500, ttlMs: 300_000 })', sessionKey: STORY_KEY } }),
    // No statement recorded: the review's words alone, and the file its action changed.
    decided({ id: idOf(3), dimension: 'miss logging level', chosen: 'debug level on the existing logger', actions: ['W2'],
      constrainedBy: asked('log every cache miss') }),
    // A statement and an instruction the recording does not hold: each said not found.
    decided({ id: idOf(4), dimension: 'cache key', chosen: 'the product id', actions: [],
      constrainedBy: asked('cache every product by its SKU'), stated: receipt('commentary', 'C2', 'keyed by SKU') }),
    decided({ id: idOf(5), dimension: 'cache size', chosen: '500 entries', column: 'asked-settled', actions: ['W1'],
      constrainedBy: { instruction: receipt('instruction', 'I1', 'repeat reads are fast'), settles: true,
        settledValueQuote: 'repeat reads are fast' } }),
  ] };
}
const page = (report = howReport()) => renderSessionPage(howSession(), report, { sessionHash: 'a'.repeat(64) });

test('D70 (b) the synthetic decisions-of-how page renders exactly its snapshot', () => {
  assert.equal(page(), readFileSync(SNAPSHOT, 'utf8'));
});

test('D70 (b) made without asking you stays first, open and marked; how you asked is open right after it', () => {
  const html = page();
  const unasked = html.indexOf(`${PAGE_GROUP_WORDS.unasked} (1)`);
  const how = html.indexOf(`${PAGE_GROUP_WORDS['asked-chose']} (3)`);
  assert.ok(unasked > 0 && how > unasked, 'the decisions made without asking you come first');
  assert.match(html, /<div class="group group-alert"><h3 class="label accent">Made without asking you \(1\)<\/h3><p class="note lead">/);
  assert.ok(html.includes(PAGE_SENTENCES.unaskedLead));
  // D70 review (S0): never folded, its heading kept — the page highlights the how.
  assert.match(html, /<\/div><div class="group how"><h3 class="label">You asked, the agent chose how \(3\)<\/h3><p class="note lead">/);
  assert.doesNotMatch(html, /class="group fold how"/);
  assert.ok(html.includes(PAGE_SENTENCES.howLead));
  assert.doesNotMatch(html, /<details[^>]* open/, 'every fold starts collapsed');
  assert.match(html, /\.group-alert \{[^}]*border-left: 3px solid var\(--accent\)/, 'the more serious group is marked');
  assert.ok(html.indexOf('id="decision-1"') < html.indexOf('id="decision-2"'));
});

test('D70 (b) with no decision made without asking you, how you asked is open as always', () => {
  const html = page(howReport({ unasked: false }));
  assert.doesNotMatch(html, /class="group group-alert"|class="group fold how"/);
  assert.match(html, /<div class="group how"><h3 class="label">You asked, the agent chose how \(3\)<\/h3><p class="note lead">/);
});

test('D70 (b) each decision of how shows your words, its choice in its own words, then the review\'s, then the code it wrote', () => {
  const html = page();
  const item = itemOf(html, 'decision-2');
  assert.equal(textOf(item).trim().replace(/^id="decision-2"> /, ''), '02 Decision step 1 Cache store '
    + `${PAGE_LABELS.youAsked} “Add a cache to the products API” `
    + `${PAGE_VOICE_LABELS.commentary} “keep the cache in an LRU map with a five-minute TTL” `
    + `${PAGE_LABELS.chosen} an in-process LRU map, 500 entries, five-minute TTL `
    + `${PAGE_LABELS.howCode} ${PAGE_VOICE_LABELS['added-code']} “new LRUMap({ max: 500, ttlMs: 300_000 })” `
    + `${PAGE_LABELS.editMade} src/cache.js +1 −0 +export const cache = new LRUMap({ max: 500, ttlMs: 300_000 }); `
    + `${PAGE_LABELS.decisionId} 222222222222`);
  assert.match(item, /<span class="ln add key">/, 'the line the code it wrote is on is marked');
  // No statement recorded: said so, and the review's words; no code quote picks a hunk, so the edit its cited action
  // made is shown, folded (D70 review S0), never only its file's name.
  const three = itemOf(html, 'decision-3');
  assert.ok(textOf(three).includes(`${PAGE_LABELS.youAsked} “log every cache miss” ${PAGE_SENTENCES.howWordsNone} `
    + `${PAGE_LABELS.chosen} debug level on the existing logger ${PAGE_LABELS.howCode} ${PAGE_LABELS.editMade} src/products.js +3 −1 `
    + '-return db.find(id); +const hit = cache.get(id); +if (!hit) logger.debug("cache miss", id); +return hit ?? db.find(id);'));
  assert.match(three, /<details class="change"><summary>The edit it was made in: <code>src\/products\.js<\/code>/);
  assert.doesNotMatch(three, new RegExp(PAGE_LABELS.changedFiles), 'not only the file names');
  // A recorded instruction and statement this recording does not hold: each said not found; nothing it wrote cited.
  assert.ok(textOf(itemOf(html, 'decision-4')).includes(`${PAGE_SENTENCES.howAskedMissing} ${PAGE_SENTENCES.howWordsMissing} `
    + `${PAGE_LABELS.chosen} the product id ${PAGE_LABELS.howCode} ${PAGE_SENTENCES.howCodeNone}`));
  assert.doesNotMatch(itemOf(html, 'decision-4'), /SKU/, 'an ungrounded quote is never shown');
  // The other groups keep their rows as they were: the unasked decision's choice first, its words, its command.
  assert.ok(textOf(itemOf(html, 'decision-1')).includes(`${PAGE_LABELS.chosen} the logger's next major version `
    + `${PAGE_VOICE_LABELS.commentary} “upgrading the logger package to its next major version” ${PAGE_VOICE_LABELS.command} “npm install logger@3”`));
});

test('D70 (b) nothing is re-decided: the groups are the ledger\'s columns, no verdict (D71), every quote grounded', () => {
  const report = howReport();
  const before = JSON.stringify(report);
  const html = renderSessionPage(howSession(), report, {});
  assert.equal(JSON.stringify(report), before, 'the report is only read');
  assert.equal(html.match(TOKENS)?.[0] ?? null, null, 'no closed token reaches the page');
  const columns = report.decisions.map((d) => d.column);
  assert.ok(html.includes(`${PAGE_GROUP_WORDS.unasked} (${columns.filter((c) => c === 'unasked').length})`));
  assert.ok(html.includes(`${PAGE_GROUP_WORDS['asked-chose']} (${columns.filter((c) => c === 'asked-chose').length})`));
  assert.ok(html.includes(`${PAGE_GROUP_WORDS['asked-settled']} (${columns.filter((c) => c === 'asked-settled').length})`));
  // D71 (a): no verdict, whatever the decisions' groups; what of the review did not complete is honestStatuses'.
  assert.doesNotMatch(html, /class="verdict|Needs your decision|Worth a look|Not fully checked|No findings/);
  assert.equal(honestStatuses({ ...report }).sessionReview, 'incomplete', 'premise');
  assert.ok(html.includes('<li><a href="#unchecked">The session review did not complete</a></li>'));
  assert.ok(html.includes('<li><a href="#decisions">3 decisions where you asked and the agent chose how</a></li>'));
  const session = howSession();
  const texts = session.events.flatMap((e) => [...session.textSpansOf(e, 'text'), ...session.textSpansOf(e, 'command'),
    ...(e.changes ?? []).flatMap((c) => session.textSpansOf(c, 'after'))]);
  for (const [, quote] of html.matchAll(/<q class="said">(?:<code>)?([\s\S]*?)(?:<\/code>)?<\/q>/g))
    assert.ok(texts.some((span) => span.includes(unescape(quote))), `quote not in the recording: ${quote}`);
});
