// M33 Y: the session page. One self-contained HTML review page of one recorded session, rendered from the redacted
// Session and a finished review report only, styled as sonah.dev. Every session and report here is synthetic.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { renderSessionPage, escapeHtml, commandText, PAGE_VERSION, PAGE_LIMITS, PAGE_SENTENCES, PAGE_LABELS,
  PAGE_GROUP_WORDS, PAGE_ATTENTION_WORDS, PAGE_CSS, PAGE_GAP_WORDS, PAGE_ASK_CAUSES,
  PAGE_CAUSE_WORDS } from '../session-page.js';
import { renderSessionStory, visible, STORY_PROMISE_WORDS, STORY_SENTENCES, STORY_FORBIDDEN_EDIT_LABELS,
  STORY_WRITTEN_WORDS } from '../session-story.js';
import { sessionBuilder, storySession, storyReport, STORY_KEY, STORY_WINDOWS, TEXT } from './session-story-fixture.js';
import { longSession, longReport } from './session-story-long-fixture.js';
import { helpersSession, manyRequestSession, decideSession } from './session-story-charts-fixture.js';
import { redisPivotSession, redisPivotPr } from '../../evidence/fixtures/redis-pivot.js';
import { DECISION_CANDIDATES, FINDING_CANDIDATES } from '../../evidence/fixtures/redis-pivot-candidates.js';
import { buildLedger, honestStatuses, PUBLIC_STATUSES, groundDecision } from '../../evidence/src/ledger.js';
import { planWindows } from '../../evidence/src/windows.js';
import { runReview } from '../../evidence/src/run-review.js';
import { COVERAGE_CAUSES, COVERAGE_SENTENCE } from '../../evidence/src/review.js';
import { PART_REASONS } from '../../evidence/src/ledger.js';
import { ownReceipt, turnNarrative, turnSession } from '../../cli/test/m33-fast-profile-fixture.js';

const SNAPSHOT = new URL('./snapshots/session-page.html', import.meta.url);
const STORY_SNAPSHOT = new URL('./snapshots/session-story.md', import.meta.url);
const page = (session = storySession(), report = storyReport(), options = {}) => renderSessionPage(session, report, options);

/** The closed tokens no reader may see (the long story test's regex), searched in the WHOLE page: text, attributes,
 *  class names and the stylesheet. */
const TOKENS = /\b(DECIDE|FYI|CLEAN|NO_FINDINGS|UNCHECKED)\b|asked-settled|asked-chose|partly-addressed|\bunasked\b|\bmaterial\b|\bstructural\b|\bunverified\b/;
// D71 (a), owner decision 2026-10-08: no verdict in words — none of the statuses' former sentences or chips.
const NO_VERDICT = /Needs your decision|Worth a look|No finding needs|Not fully checked|No findings, with gaps|No findings, but not clean|for your information|not a clean result/i;
const unescape = (text) => text.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
  .replace(/&amp;/g, '&');
/** The page's text as a reader reads it: the stylesheet dropped, a verified quote in the quotation marks its style
 *  draws, other tags read as spaces, entities read back, whitespace collapsed. */
const textOf = (html) => unescape(html.replace(/<style>[\s\S]*?<\/style>/, '').replace(/<q class="said[^"]*">/g, '“')
  .replace(/<\/q>/g, '”').replace(/<\/?code>/g, '').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ')
  .replace(/“ /g, '“').replace(/ ”/g, '”').replace(/ ([.,;:])/g, '$1');
/** Every verified-quote element's text, as the reader reads it. */
const quotesOf = (html) => [...html.matchAll(/<q class="said[^"]*">([\s\S]*?)<\/q>/g)].map((m) => unescape(m[1].replace(/<[^>]+>/g, '')));
const norm = (text) => text.replace(/\s+/g, ' ');
/** The recorded role each quote label speaks for. A quote with no label of its own (a requirement row, a checked
 *  instruction) is the human's words. */
const ROLE_OF_LABEL = Object.freeze({
  'You said': 'human', 'You settled it': 'human', Asked: 'human', 'You asked': 'human', 'You replied': 'human',
  [STORY_FORBIDDEN_EDIT_LABELS.instruction]: 'human',
  'Agent said': 'agent', [STORY_FORBIDDEN_EDIT_LABELS.reported]: 'agent', 'Helper said': 'helper',
  'Code written': 'written', [STORY_FORBIDDEN_EDIT_LABELS.wrote]: 'code', 'Recorded result': 'result',
  'Agent did': 'action', 'Agent ran': 'action', [STORY_FORBIDDEN_EDIT_LABELS.ran]: 'action',
  ...Object.fromEntries(Object.values(STORY_WRITTEN_WORDS).map((label) => [label, 'written'])),
});
/** What the recording holds for each role, as the page displays text (an invisible or bidi character as its code
 *  point), whitespace collapsed: the human's instructions; the agent's and a helper's statements apart; recorded
 *  results; code inside the repository (`written`: after sides only); and an action's command, tool input and the paths
 *  of its changes inside the repository — never a path it only read or wrote outside the repository. */
function recordedRoles(session) {
  const roles = { human: [], agent: [], helper: [], result: [], written: [], code: [], action: [] };
  for (const event of session.events) {
    const text = session.textSpansOf(event, 'text');
    if (event.kind === 'instruction' && event.authority === 'human') roles.human.push(...text);
    if (event.kind === 'commentary') roles[event.childId == null ? 'agent' : 'helper'].push(...text);
    if (event.kind === 'observation') roles.result.push(...session.textSpansOf(event, 'output'));
    if (event.kind !== 'invocation') continue;
    roles.action.push(...session.textSpansOf(event, 'command'), ...session.textSpansOf(event, 'input'));
    for (const change of event.changes ?? []) {
      if (change.outsideRepository === true) continue;
      roles.action.push(change.path);
      roles.written.push(...session.textSpansOf(change, 'after'));
      roles.code.push(...session.textSpansOf(change, 'after'), ...session.textSpansOf(change, 'before'));
    }
  }
  return Object.fromEntries(Object.entries(roles).map(([role, spans]) => [role, spans.map((span) => norm(visible(span)))]));
}
/** Every shown quote, with the label it is shown under: the nearest label before it, unless an item or another quote
 *  begins between them. */
function labelledQuotes(html) {
  return [...html.matchAll(/<q class="said[^"]*">([\s\S]*?)<\/q>/g)].map((m) => {
    const before = html.slice(0, m.index);
    const at = before.lastIndexOf('<span class="label');
    const label = at > Math.max(before.lastIndexOf('<li'), before.lastIndexOf('</q>'))
      ? unescape(before.slice(before.indexOf('>', at) + 1, before.indexOf('</span>', at))) : null;
    return { label, quote: unescape(m[1].replace(/<[^>]+>/g, '')) };
  });
}
/** Every shown quote is found in the recording's text FOR ITS ROLE: each piece between cut marks, in one span of what
 *  its label says it is — so a statement is never shown under the human's label, a result never as the
 *  agent's words, a helper's words never as the agent's, removed code never as code written. */
function assertGrounded(html, session) {
  const roles = recordedRoles(session);
  const shown = labelledQuotes(html);
  for (const { label, quote } of shown) {
    const role = label === null ? 'human' : ROLE_OF_LABEL[label];
    assert.ok(role, `a quote is shown under a label with no recorded role: ${label}`);
    for (const piece of quote.split('…').map((part) => norm(part).trim()).filter(Boolean))
      assert.ok(roles[role].some((span) => span.includes(piece)), `quote not in the recording as ${role} (${label}): ${piece}`);
  }
  return shown.map(({ quote }) => quote);
}
/** A decision as the ledger publishes it (column derived). */
const decided = (fields) => ({ actorSession: STORY_KEY, dimension: 'store', chosen: 'a store', value: null, valueReceipt: null,
  valueState: 'unchecked', actions: [], stated: null, constrainedBy: null, instructionReview: null, column: 'asked-chose',
  columnState: 'grounded', amends: [], materiality: 'material', materialityRule: 'synthetic', relevance: 'unchecked', reasons: [],
  ...fields });
const receipt = (role, eventId, quote) => ({ role, eventId, quote, sessionKey: STORY_KEY });
const windowsOf = (...lists) => lists.map((eventIds, windowIndex) => ({ windowIndex, eventIds, failure: null }));
/** The decision item with this id, as markup. */
const itemOf = (html, id) => html.slice(html.indexOf(`id="${id}"`), html.indexOf('</li>', html.indexOf(`id="${id}"`)));

test('M33 Y the synthetic page renders exactly its snapshot', () => {
  assert.equal(page(), readFileSync(SNAPSHOT, 'utf8'));
});

test('M33 Y the same inputs give the same bytes, and the report is only read', () => {
  const report = storyReport();
  const before = JSON.stringify(report);
  const first = page(storySession(), report);
  assert.equal(JSON.stringify(report), before, 'the report is not changed by rendering');
  assert.equal(Buffer.compare(Buffer.from(first), Buffer.from(page())), 0);
  assert.equal(page(storySession(), JSON.parse(JSON.stringify(storyReport()))), first, 'a report read back from JSON');
  for (const table of [PAGE_LIMITS, PAGE_SENTENCES, PAGE_GROUP_WORDS, PAGE_ATTENTION_WORDS])
    assert.ok(Object.isFrozen(table));
  // The story it shares its facts with keeps its bytes.
  assert.equal(renderSessionStory(storySession(), storyReport()), readFileSync(STORY_SNAPSHOT, 'utf8'));
  // A report whose findings are not a list renders as the story renders it: with no finding.
  for (const findings of [{}, 'x', 5, true]) assert.doesNotMatch(page(storySession(), { ...storyReport(), findings }), /id="findings"/);
});

test('M33 Y the page is laid out as the sonah.dev review card, then the sections, then the footer', () => {
  const html = page(storySession(), storyReport(), { title: 'Rate limiting' });
  // D71 (a), (S4): no verdict — the page is the checklist. D88: where your attention is needed; what the agent decided
  // (your settled choices folded in their place); what you asked, each request whole; the failures (a report from before
  // the checklist: its failed commands); what the agent told you; the edits against what you said; and last, collapsed,
  // what Sonah could not check — the claim not checked and the statement written into a file and not checked among it;
  // then the steps and files folded.
  const order = ['<!doctype html>', '<meta http-equiv="Content-Security-Policy"', `<meta name="generator" content="${PAGE_VERSION}">`,
    '<title>Rate limiting</title>', '<header class="masthead">', '<p class="title-words">Rate limiting</p>',
    '<figure class="card-ui review"', '<h1 id="review-title">Sonah review</h1>', 'Claude Code recording, 2 steps',
    '<div class="attention"><span class="label">Where your attention is needed</span>',
    'id="decisions"', '<p class="decided">',
    'Made without asking you (1)', 'You asked, the agent chose how (1)',
    '<details class="group fold"><summary><span class="label">You settled (1)', 'Could not check whether you asked (1)',
    'id="requests"', '<q class="said">Add rate limiting to the public API middleware.',
    'id="failures"', 'Commands that failed', 'id="claims"', 'Contradicted (1)',
    'id="edits"', 'Edits against what you said (1)',
    'id="unchecked"><details class="unchecked"><summary>', 'What Sonah could not check (2)',
    'Claims not checked against a recorded result (1)', 'Statements written into files, not checked (1)',
    '</figure>', 'id="steps"><details class="card-fold">', 'id="files"><details class="card-fold">',
    '<footer class="foot">', PAGE_SENTENCES.generated, '</html>'];
  let at = -1;
  for (const part of order) {
    const next = html.indexOf(part, at + 1);
    assert.ok(next > at, `${part} comes next`);
    at = next;
  }
  // Every in-page link has its target, and every anchor id is built from numbers only.
  for (const [, target] of html.matchAll(/href="#([^"]*)"/g)) assert.ok(html.includes(`id="${target}"`), `#${target} exists`);
  for (const [, id] of html.matchAll(/ id="([^"]*)"/g)) assert.match(id, /^(?:(?:step|decision|finding|request|claim|pivot|failure)-\d+|review-title|decisions|requests|unchecked|claims|failures|edits|steps|files)$/);
  // Story /14 (D77 C): a step is one of your requests — the fixture's seven review windows review two requests.
  for (let n = 1; n <= 2; n++) assert.equal(html.split(`id="step-${n}"`).length, 2, `step ${n} has one anchor`);
  // D69 f (g): no facts strip (its counts are each said where its rows are); no separate card of changes of approach.
  assert.doesNotMatch(html, /<dl class="facts">|id="approach"/);
  // D71 (S4): no tally of what is done (it reads as a grade): the summary counts only what needs your attention.
  assert.doesNotMatch(html, /class="ledger|3 addressed/);
  assert.match(textOf(html), /The review recorded 4 decisions: 1 made without asking you, 1 where you asked and the agent chose how, 1 you settled and 1 where it could not check whether you asked\./);
  // D71 (a): where your attention is needed — a count and a link for each place, the steps the review did not finish
  // among them, linked to what could not be checked, which names them. No verdict, no status chip.
  const attention = html.slice(html.indexOf('<div class="attention'), html.indexOf('id="decisions"'));
  // D88: the judgment first, then the settled problems; the rows Sonah could not check (the claim and the statement
  // written into a file, neither checked against a recorded result) in one plain line.
  assert.equal(textOf(attention.slice(0, attention.indexOf('</div>'))).replace(/\s+/g, ' ').trim(),
    'Where your attention is needed 1 decision made without asking you 1 decision where you asked and the agent chose '
    + 'how 1 decision where the review could not check whether you asked 1 change of approach 2 asks of yours are shown '
    + "not done or partly done: 1 partly addressed and 1 open 1 claim of the agent's contradicted by the recording 1 edit "
    + 'against what you said 1 of 2 steps was not reviewed 2 rows Sonah could not check: folded under What Sonah could not '
    + 'check, at the end');
  assert.match(attention, /<li><a href="#claims">1 claim of the agent&#39;s contradicted by the recording<\/a><\/li>/);
  assert.match(attention, /<li><a href="#edits">1 edit against what you said<\/a><\/li>/);
  assert.match(attention, /<li><a href="#unchecked">1 of 2 steps was not reviewed<\/a><\/li>/);
  assert.doesNotMatch(html, /class="verdict|Needs your decision|Worth a look|No finding needs|Not fully checked|No findings, with gaps/);
  // The failed review window (the sixth) held request 2's work, so request 2's step is the one not reviewed.
  assert.match(textOf(html), /Steps not reviewed 1 of 2 steps was not reviewed: step 2\. The review of that step did not finish\./);
});

test('M33 Y sonah.dev light tokens, a derived warm dark, and no font or stylesheet fetched', () => {
  const html = page();
  for (const token of ['--bg: #f7f7f4', '--card: #ffffff', '--footer: #eeede6', '--ink: #251f19', '--muted: #68615a',
    '--faint: #746b62', '--line: #ebe8e4', '--line-strong: #d4cdc7', '--wash: #f7f6f2', '--accent: #f48d16', '--accent-ink: #9a5300',
    '--bg: #161310', '--ink: #f1ece6', '--accent: #f59a2e', '"Geist", "Inter"', '"DM Sans", "Inter"', '"Geist Mono", ui-monospace'])
    assert.ok(PAGE_CSS.includes(token), token);
  assert.match(PAGE_CSS, /@media \(prefers-color-scheme: dark\) \{\s*:root:not\(\[data-theme="light"\]\) \{/);
  assert.match(PAGE_CSS, /:root\[data-theme="dark"\] \{/);
  assert.match(PAGE_CSS, /body \{[^}]*background: var\(--bg\)/);
  // D69 f (g): the reader's own setting unless asked: no theme attribute, both colour schemes.
  assert.match(html, /<html lang="en">/);
  assert.match(html, /<meta name="color-scheme" content="light dark">/);
  assert.equal(html.split('<style>').length, 2, 'one stylesheet, inline');
  // The site's logo, inline, recoloured by the page's own tokens; no xmlns, so no URL at all.
  assert.match(html, /<svg class="logo" viewBox="0 0 64 64" aria-hidden="true"><rect class="l-bg"/);
  assert.doesNotMatch(html, /xmlns/);
});

test('M33 Y every shown quote is found again in this recording; a quote that is not is never shown', () => {
  const session = storySession();
  const html = page(session);
  const quotes = assertGrounded(html, session);
  assert.ok(quotes.length >= 12, `${quotes.length} quotes`);
  // The class `said` marks verified quotes and nothing else.
  for (const [, tag, cls] of html.matchAll(/<([a-z0-9]+)[^>]*\bclass="([^"]*)"/g))
    if (cls.split(' ').includes('said')) assert.equal(tag, 'q', `${tag}.${cls}`);
  // The review's words are never in quotation marks: titles, dimensions, choices, pivots, claim paraphrases.
  for (const words of ['Limiter algorithm', 'limiter algorithm', 'The final message says', 'Redis-backed counter store',
    'The limiter defaults will be documented', 'Existing auth checks stay intact'])
    assert.ok(!quotes.some((q) => q.includes(words)), words);
  for (const words of ['in-process token bucket', 'HTTP 429 with Retry-After', 'kept before the limiter'])
    assert.ok(!quotes.includes(words), `a decision's choice is the review's words: ${words}`);

  // A decision's statement that does not ground: gone, and a fixed sentence says so.
  const report = storyReport();
  report.decisions[0].stated = receipt('commentary', 'C2-1', 'switching to Redis after all (edited)');
  const edited = page(storySession(), report);
  assert.doesNotMatch(edited, /\(edited\)/);
  assert.ok(itemOf(edited, 'decision-1').includes(PAGE_SENTENCES.decisionQuotesMissing));
  // The human's words: an instruction quote that does not ground is not shown; a settled value still grounds alone.
  const settled = storyReport();
  settled.decisions[2].constrainedBy = { ...settled.decisions[2].constrainedBy,
    instruction: receipt('instruction', 'I1', 'Keep the auth checks (edited)') };
  // (D71 S4: your settled decisions are folded third, so this one is decision 3.)
  const one = itemOf(page(storySession(), settled), 'decision-3');
  assert.doesNotMatch(one, /\(edited\)/);
  assert.match(one, /You settled it<\/span><blockquote><q class="said">Keep the existing auth checks intact<\/q>/);
  settled.decisions[2].constrainedBy.settledValueQuote = 'Keep it intact (edited)';
  assert.ok(itemOf(page(storySession(), settled), 'decision-3').includes(PAGE_SENTENCES.decisionQuotesMissing));
  // A quote of the agent's words cited as the human's: the role does not match the event, so it is never "You said".
  const borrowed = storyReport();
  borrowed.decisions[1].constrainedBy = { instruction: receipt('instruction', 'C2-1', 'switching to an in-process token bucket'),
    settles: false, settledValueQuote: null };
  assert.doesNotMatch(itemOf(page(storySession(), borrowed), 'decision-2'), /You said/);
  // A claim whose quote does not ground reads in the review's words, unquoted.
  const claim = storyReport();
  claim.promises[0].stated = receipt('commentary', 'F7', 'I will document everything (edited)');
  const claimed = page(storySession(), claim);
  assert.doesNotMatch(claimed, /\(edited\)/);
  assert.match(textOf(claimed), /In the review's words: The limiter defaults will be documented in the README/);
  // A finding whose receipts do not ground says so.
  const finding = storyReport();
  finding.findings[1].receipts = finding.findings[1].receipts.map((r) => ({ ...r, quote: `${r.quote} (edited)` }));
  const found = page(storySession(), finding);
  assert.doesNotMatch(found, /\(edited\)/);
  assert.ok(itemOf(found, 'finding-1').includes(PAGE_SENTENCES.findingQuotesMissing));
});

test('M33 Y who said it is read from the recording: the human, the agent, a helper, the code written', () => {
  const b = sessionBuilder();
  b.ask('I1', 'Store sessions somewhere durable, and keep the cookie name.');
  b.say('C1', 'I will keep the session store in memory for now.');
  b.change('W1', 'src/store.js', { operation: 'edit', before: 'export const store = new Redis();\n',
    after: 'export const store = new Map();\n', priorState: 'edit-text' });
  b.delegate('D1', 'Write the store tests', 'h1');
  b.ask('child:h1:I0', 'Write the store tests', 'agent', 'h1');
  b.say('child:h1:C0', 'The helper will use an in-memory fake.', 'working', 'h1');
  b.change('child:h1:W0', 'test/store.test.js', { after: 'test(\'store\', () => {});\n', childId: 'h1' });
  b.run('R1', 'npm test', 'failed', 'the session store tests fail');
  const session = b.session();
  const report = { windowResults: windowsOf(['I1', 'C1', 'W1', 'W1-r'], ['D1', 'child:h1:I0', 'child:h1:C0', 'child:h1:W0', 'child:h1:W0-r'],
    ['R1', 'R1-r']),
    decisions: [
      decided({ dimension: 'session store', chosen: 'in-memory Map', actions: ['W1'], value: 'new Map()', valueState: 'grounded',
        valueReceipt: { eventId: 'W1', field: 'added-code', role: 'code', quote: 'new Map()', sessionKey: STORY_KEY },
        stated: receipt('commentary', 'C1', 'keep the session store in memory'),
        constrainedBy: { instruction: receipt('instruction', 'I1', 'Store sessions somewhere durable'), settles: false, settledValueQuote: null } }),
      // A value quote on the BEFORE side of the write: verifyReceipt accepts it, the page never calls it code written.
      decided({ dimension: 'old store', chosen: 'Redis', actions: ['W1'], value: 'new Redis()', valueState: 'grounded',
        valueReceipt: { eventId: 'W1', field: 'added-code', role: 'code', quote: 'new Redis()', sessionKey: STORY_KEY } }),
      decided({ dimension: 'test double', chosen: 'an in-memory fake', actions: ['child:h1:W0'], column: null, columnState: 'unchecked',
        stated: receipt('commentary', 'child:h1:C0', 'use an in-memory fake') }),
      // A statement that cites a recorded result: it grounds as a result, and is never the agent's words.
      decided({ dimension: 'store tests', chosen: 'left failing', actions: ['R1'], column: null, columnState: 'unchecked',
        stated: receipt('observation', 'R1-r', 'the session store tests fail') }),
    ], sessionStatus: 'CLEAN' };
  const html = page(session, report);
  assertGrounded(html, session);
  const first = itemOf(html, 'decision-1');
  // D70 (b): a decision of how shows the words of yours it served as what you asked.
  assert.match(first, /You asked<\/span><blockquote><q class="said">Store sessions somewhere durable<\/q>/);
  assert.match(first, /Agent said<\/span><blockquote><q class="said">keep the session store in memory<\/q>/);
  assert.match(first, /Code written<\/span><blockquote><q class="said"><code>new Map\(\)<\/code><\/q>/);
  // Its edit is shown, the line the quote is on marked.
  assert.match(first, /The edit it was made in: <code>src\/store\.js<\/code> <span class="mono">\+1 −1<\/span>/);
  assert.match(first, /<span class="ln del">-export const store = new Redis\(\);<\/span><span class="ln add key">\+export const store = new Map\(\);<\/span>/);
  const second = itemOf(html, 'decision-2');
  assert.doesNotMatch(second, /Code written/);
  assert.ok(second.includes(PAGE_SENTENCES.howCodeMissing), 'D70 (b): the code it cites is said not found');
  // A helper's statement is the helper's, never the agent's.
  const helper = itemOf(html, 'decision-3');
  assert.match(helper, /Helper said<\/span><blockquote><q class="said">use an in-memory fake<\/q>/);
  assert.doesNotMatch(helper, /Agent said/);
  const result = itemOf(html, 'decision-4');
  assert.doesNotMatch(result, /store tests fail/);
  assert.ok(result.includes(PAGE_SENTENCES.decisionQuotesMissing));
  // The grounding check pairs each quote with its label: a recorded result shown as the agent's words is caught.
  assert.throws(() => assertGrounded(html.replace('<span class="label">Agent said</span><blockquote><q class="said">keep the session store in memory',
    '<span class="label">Agent said</span><blockquote><q class="said">the session store tests fail'), session), /as agent/);
  assert.throws(() => assertGrounded(html.replace('<span class="label">Helper said</span>', '<span class="label">Agent said</span>'), session),
    /as agent/, 'a helper\'s words shown as the agent\'s are caught');
});

// D79 (owner decision 2026-10-11): a value receipt the ledger kept without its value — the quote verbatim on the
// after side of a cited write that succeeded, the review's value not word for word in it (`value_paraphrased`) — is
// shown as code written and picks its hunk exactly as a grounded value's; a value dropped with its receipt shows
// neither, as before.
test('D79 a value receipt kept without its value is shown as code written, with the edit it was made in', () => {
  const b = sessionBuilder();
  b.ask('I1', 'Store sessions somewhere durable, and keep the cookie name.');
  b.say('C1', 'I will keep the session store in memory for now.');
  b.change('W1', 'src/store.js', { operation: 'edit', before: 'export const store = new Redis();\n',
    after: 'export const store = new Map();\n', priorState: 'edit-text' });
  b.change('W2', 'src/cookie.js', { after: 'export const cookie = "sid";\n' });
  const session = b.session();
  const kept = { valueState: 'unchecked', value: null, valueUnchecked: { cause: 'value_paraphrased', action: 'W1' },
    reasons: ['value_unchecked'],
    valueReceipt: { eventId: 'W1', field: 'added-code', role: 'code', quote: 'new Map()', sessionKey: STORY_KEY } };
  // Premise: these are the ledger's own fields for a paraphrased value whose quote is verbatim in W1's after side.
  const grounded = groundDecision({ repo: 'synthetic/d79', session, pr: null, instructionHistoryComplete: true,
    candidate: { actorSession: STORY_KEY, dimension: 'store type', chosen: 'a plain map', actions: ['W1'],
      value: 'an in-memory map in place of Redis', stated: null, constrainedBy: null,
      valueReceipt: { eventId: 'W1', role: 'code', field: 'added-code', quote: 'new Map()' } } });
  assert.equal(grounded.ok, true);
  for (const field of ['valueState', 'value', 'valueUnchecked', 'valueReceipt'])
    assert.deepEqual(grounded.decision[field], kept[field], field);
  assert.ok(grounded.decision.reasons.includes('value_unchecked'));
  const report = { windowResults: windowsOf(['I1', 'C1', 'W1', 'W1-r', 'W2', 'W2-r']), sessionStatus: 'CLEAN',
    decisions: [
      // You asked, the agent chose how: its how is the code it wrote.
      decided({ dimension: 'session store', chosen: 'an in-memory map', actions: ['W1', 'W2'], ...kept,
        stated: receipt('commentary', 'C1', 'keep the session store in memory'),
        constrainedBy: { instruction: receipt('instruction', 'I1', 'Store sessions somewhere durable'), settles: false,
          settledValueQuote: null } }),
      // Made without asking: the same receipt, the same code written.
      decided({ dimension: 'store type', chosen: 'a plain map', actions: ['W1'], column: 'unasked', ...kept }),
      // The receipt dropped with its value (any other cause): the files its actions changed, never code written.
      decided({ dimension: 'cookie name', chosen: 'the existing one', actions: ['W2'], column: 'unasked',
        valueState: 'unchecked', valueUnchecked: { cause: 'unmatched', action: null }, reasons: ['value_unchecked'] }),
    ] };
  const html = page(session, report);
  assertGrounded(html, session);
  // The rows are grouped (made without asking first), so each is found by its heading.
  const byTitle = (title) => {
    const at = html.indexOf(`<h4 class="title">${title}</h4>`);
    assert.ok(at >= 0, `premise: the row ${title} is shown`);
    return html.slice(html.lastIndexOf('<li class="finding', at), html.indexOf('</li>', at));
  };
  for (const title of ['Session store', 'Store type']) {
    const item = byTitle(title);
    assert.match(item, /Code written<\/span><blockquote><q class="said"><code>new Map\(\)<\/code><\/q>/, title);
    assert.match(item, /The edit it was made in: <code>src\/store\.js<\/code> <span class="mono">\+1 −1<\/span>/,
      title);
    assert.match(item, /<span class="ln add key">\+export const store = new Map\(\);<\/span>/,
      `${title}: the written line is marked`);
    assert.doesNotMatch(item, /<code>an in-memory map<\/code>|<code>a plain map<\/code>/,
      `${title}: the paraphrase is never code`);
  }
  const how = byTitle('Session store');
  assert.ok(how.includes('class="finding how"'), 'premise: shown as a decision of how');
  assert.ok(!how.includes(PAGE_SENTENCES.howCodeMissing) && !how.includes(PAGE_SENTENCES.howCodeNone),
    'its how is shown');
  assert.ok(how.includes(PAGE_SENTENCES.moreEdits(true, 1)) && how.includes('src/cookie.js'),
    'its other edit is named');
  const dropped = byTitle('Cookie name');
  assert.doesNotMatch(dropped, /Code written/);
  assert.doesNotMatch(dropped, /The edit it was made in/);
  assert.match(dropped, /Files its cited actions changed<\/span> <code>src\/cookie\.js<\/code>/);
  assert.doesNotMatch(html, TOKENS);
  assert.doesNotMatch(textOf(html), /value_paraphrased|unmatched/, 'no cause token reaches the page');
});

test('M33 Y no closed token reaches the page, in its text, its attributes or its stylesheet', () => {
  const { session, windows } = longSession();
  const renders = [page(), page(session, longReport(session, windows)),
    ...[helpersSession(), manyRequestSession(), decideSession({ requests: 4, perRequest: 2 })].map((x) => page(x.session, x.report))];
  for (const html of renders) assert.equal(html.match(TOKENS)?.[0] ?? null, null, 'a closed token reached the page');
  // D71 (a): no status reaches the page in words either.
  for (const html of renders) assert.doesNotMatch(textOf(html), NO_VERDICT, 'a verdict reached the page');
});

test('M33 Y the page is inert: no script, no resource, no link out; hostile recorded text renders escaped', () => {
  const html = page();
  for (const banned of ['<script', 'src=', 'http://', 'https://', 'url(', '@import', 'javascript:', '<iframe', '<img', '<link', 'on'
    + 'error'])
    assert.equal(html.toLowerCase().includes(banned), false, banned);
  assert.match(html, /<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'">/);
  assert.match(html, /<meta name="referrer" content="no-referrer">/);
  const hostile = 'Ship it </style><script>alert(1)</script> "><img src=x onerror=alert(1)> javascript:alert(1) \u202Eevil\u200B & \'quoted\'';
  const b = sessionBuilder();
  b.ask('I1', hostile);
  b.say('C1', hostile);
  b.change('W1', 'src/"><img src=x>.js', { after: `${hostile}\n` });
  b.run('R1', `cd "/srv/x" && npm test -- ${hostile}`, 'succeeded', hostile);
  const session = b.session();
  const report = { windowResults: windowsOf(['I1', 'C1', 'W1', 'W1-r', 'R1', 'R1-r']), sessionStatus: 'FYI',
    decisions: [decided({ dimension: hostile, chosen: hostile, actions: ['W1'], stated: receipt('commentary', 'C1', hostile),
      valueState: 'grounded', value: 'alert(1)', valueReceipt: { eventId: 'W1', field: 'added-code', role: 'code', quote: hostile, sessionKey: STORY_KEY } })],
    findings: [{ origin: 'session-review', kind: 'claim_contradicted', status: 'FYI', title: hostile,
      receipts: [receipt('commentary', 'C1', hostile), receipt('observation', 'R1-r', hostile)] }],
    pivots: [{ abandoned: hostile, adopted: hostile, receipts: [receipt('commentary', 'C1', hostile)] }],
    requirements: [{ instruction: receipt('instruction', 'I1', hostile), text: hostile, status: 'open' }],
    promises: [{ stated: receipt('commentary', 'C1', hostile), text: hostile, status: 'open' }] };
  const out = page(session, report, { title: hostile });
  assert.equal(out.split('</style>').length, 2, 'the one real stylesheet ends once');
  assert.doesNotMatch(out, /<script|<img|<iframe/i);
  for (const [tag] of out.matchAll(/<[a-z][^>]*>/gi)) assert.doesNotMatch(tag, /\son[a-z]+=/i, `no event handler attribute: ${tag}`);
  assert.doesNotMatch(out, /[\u202E\u200B]/, 'bidi and invisible characters are shown as code points');
  assert.match(out, /‹U\+202E›evil‹U\+200B›/);
  assert.match(out, /&lt;\/style&gt;&lt;script&gt;alert\(1\)&lt;\/script&gt; &quot;&gt;&lt;img src=x onerror=alert\(1\)&gt;/);
  assert.match(out, /&#39;quoted&#39;/);
  for (const [, href] of out.matchAll(/href="([^"]*)"/g)) assert.match(href, /^#(?:step|decision|finding|request|claim|pivot)-\d+$|^#(?:requests|findings|decisions|claims|unchecked)$/);
  for (const [, attrs] of out.matchAll(/<[a-z0-9]+(\s[^>]*)>/g)) assert.doesNotMatch(attrs, /alert\(|javascript|evil/, attrs);
  assertGrounded(out, session);
});

test('M33 Y nothing is upgraded: impact, who decided, claims, explanations, rejected text, outside paths, status', () => {
  // D69 f (g): no Impact row at all — the path keyword rules it was read by never reach the page, whatever the
  // materiality and its rule.
  const report = storyReport();
  report.decisions[2] = { ...report.decisions[2], materialityRule: 'unknown-structural' };
  for (const html of [page(), page(storySession(), report)])
    assert.doesNotMatch(textOf(html), /Impact|not classified|changes structure|changes behaviour|cosmetic/);
  // A column the review could not check is never "made without asking", whatever the column says.
  const unchecked = storyReport();
  unchecked.decisions = [{ ...unchecked.decisions[0], column: 'unasked', columnState: 'unchecked' }];
  const could = page(storySession(), unchecked);
  assert.doesNotMatch(textOf(could), /without asking/i);
  assert.match(textOf(could), /Could not check whether you asked \(1\)/);
  assert.match(textOf(could), /The review recorded 1 decision: 1 where it could not check whether you asked\./);
  // An open claim reads "not checked" even beside a passing command in the same step; a verified one is confirmed.
  const b = sessionBuilder();
  b.ask('I1', 'Fix the parser and make sure the tests pass.');
  b.say('C1', 'The parser is fixed and the tests pass.');
  b.run('R1', 'npm test', 'succeeded', 'tests 4\npass 4\nfail 0');
  const session = b.session();
  const claims = (status) => ({ windowResults: windowsOf(['I1', 'C1', 'R1', 'R1-r']), sessionStatus: 'CLEAN',
    promises: [{ stated: receipt('commentary', 'C1', 'the tests pass'), text: 'The tests pass', status }] });
  const open = page(session, claims('open'));
  const openClaims = open.slice(open.indexOf('id="claims"'));
  assert.match(textOf(openClaims), new RegExp(`the tests pass” ${STORY_PROMISE_WORDS.open}`));
  assert.doesNotMatch(open, /confirmed by a recorded result/);
  // M1: a passing command is no listed fact; the failed list says none failed (/18, D79: nor was refused). D88: the
  // failures come before what the agent told you, and the claim not checked is folded under What Sonah could not check.
  assert.match(textOf(open),
    /Commands that failed or did not run No command was recorded as failed or refused\./);
  assert.match(textOf(page(session, claims('verified'))), /the tests pass” confirmed by a recorded result/);
  assert.match(textOf(page(session, claims('mystery'))), /the tests pass” not checked/);
  // The unasked decision's check: counted, the checked instructions folded, never the review's explanations.
  const reviewed = storyReport();
  reviewed.decisions[0].instructionReview = { dimension: 'limiter algorithm', scopeDigest: 'sha256:x', noRelevantInstruction: true,
    checks: [{ instruction: receipt('instruction', 'I1', 'do not add a new datastore'), relevant: false,
      explanation: 'EXPLANATION-SENTINEL the store choice is unrelated' }] };
  reviewed.rejectedDecisions = [{ candidate: { dimension: 'REJECTED-SENTINEL', chosen: 'REJECTED-SENTINEL' }, ok: false, reason: 'receipt_rejected' }];
  reviewed.windowResults[0].narrative = { decisions: [{ dimension: 'NARRATIVE-SENTINEL', value: 'NARRATIVE-SENTINEL' }] };
  const shown = page(storySession(), reviewed);
  for (const sentinel of ['EXPLANATION-SENTINEL', 'REJECTED-SENTINEL', 'NARRATIVE-SENTINEL']) assert.equal(shown.includes(sentinel), false, sentinel);
  assert.match(textOf(itemOf(shown, 'decision-1')), /The review checked your 1 earlier instruction; it did not cover this\. Show the instructions it checked “do not add a new datastore”/);
  // The plan written outside the repository, and the files only read, are never shown.
  const html = page();
  for (const hidden of [TEXT.planPath, 'rate-limit-plan', TEXT.planBody.trim(), 'src/middleware/auth.js']) assert.equal(html.includes(hidden), false, hidden);
  // What the page says of the review is what honestStatuses recomputes, never the stored status — and (D71 (a)) never a
  // status at all: a stored CLEAN over a review that did not complete reads as that review not completing.
  const stored = { ...storyReport(), findings: [], sessionStatus: 'CLEAN', reviewStatus: 'CLEAN',
    windowResults: storyReport().windowResults.map((w) => ({ ...w, failure: null })) };
  assert.equal(honestStatuses(stored).sessionStatus, 'UNCHECKED');
  const recomputed = page(storySession(), stored);
  assert.match(recomputed, /<li><a href="#unchecked">The session review did not complete<\/a><\/li>/);
  assert.doesNotMatch(textOf(recomputed), NO_VERDICT);
  assert.match(textOf(recomputed), /The session review did not complete\./);
});

test('M33 Y a session-only review says the code is reviewed separately; a clean one says so plainly', () => {
  const b = sessionBuilder();
  b.ask('I1', 'Rename the helper.');
  b.change('W1', 'src/a.js', { operation: 'edit', before: 'old()\n', after: 'renamed()\n' });
  const session = b.session();
  const report = { repo: { host: 'github.com', id: '0' }, pr: null, reviewScope: 'session-only', codeCoverage: 'missing',
    coverage: 'complete', sessionStatus: 'CLEAN', findings: [], decisions: [], windowResults: windowsOf(['I1', 'W1', 'W1-r']) };
  const honest = honestStatuses(report);
  assert.equal(honest.reviewScope, 'session-only');
  const html = page(session, report);
  // D71 (a): a session with nothing to point to says so — and that this is not a statement that the work is right.
  assert.equal(honest.sessionStatus, 'CLEAN', 'premise');
  assert.ok(html.includes(`<p>${escapeHtml(PAGE_ATTENTION_WORDS.none)}</p>`));
  assert.doesNotMatch(textOf(html), NO_VERDICT);
  assert.ok(html.includes(PAGE_SENTENCES.sessionOnly));
  assert.ok(!page().includes(PAGE_SENTENCES.sessionOnly), 'a combined review does not say it');
  assert.match(textOf(html), /The review recorded no decisions\./);
});

test('M1 every command the record says failed is listed by its recorded words; a pass is not; a runner name changes nothing', () => {
  assert.equal(commandText('cd "/srv/work tree" && npm test'), 'npm test');
  assert.equal(commandText("cd '/srv/a b'; cd sub && node --test test/x.test.js"), 'node --test test/x.test.js');
  assert.equal(commandText('npm test && cd /srv/x'), null, 'a path outside the working tree is never named');
  assert.equal([...commandText(`npm test -- ${'x'.repeat(200)}`)].length, PAGE_LIMITS.commandChars);
  const b = sessionBuilder();
  b.ask('I1', 'Run the checks.');
  b.run('R1', 'cd "/srv/work tree" && npm test', 'failed', 'fail 1');
  b.run('R2', 'cd /srv/x; node --test', 'succeeded', 'pass');
  b.run('R3', 'make lint', 'failed', '');
  b.run('R4', 'cat /srv/x/build.log', 'failed', '');
  const session = b.session();
  const windowResults = windowsOf(['I1', 'R1', 'R1-r', 'R2', 'R2-r', 'R3', 'R3-r', 'R4', 'R4-r']);
  // D69 f: no row cites them, so they are counted, with the step they ran in; D69 f (g): and listed, folded, by their
  // recorded words — the session's last command first, when it failed (here it is: R4).
  const folded = page(session, { windowResults, sessionStatus: 'CLEAN' });
  assert.match(textOf(folded), /Commands that failed or did not run 3 of 4 commands failed; 3 are cited by no row on this page, in step 1\. The session's last command failed; it is listed first below\. Show the 3 failed commands no row cites/);
  const list = folded.slice(folded.indexOf('<details class="failed">'), folded.indexOf('</details>', folded.indexOf('<details class="failed">')));
  assert.deepEqual([...list.matchAll(/<li>(<code>[^<]*<\/code>|<span class="note">[^<]*<\/span>)/g)].map((m) => textOf(m[1]).trim()),
    [PAGE_SENTENCES.commandWithheld, 'npm test', 'make lint']);
  assert.match(list, /<span class="pill">last command of the session<\/span><\/li>/);
  assert.equal(folded.includes('/srv/'), false);
  // A finding citing their results (or the command itself) shows each beside it, by its recorded words.
  const html = page(session, { windowResults, sessionStatus: 'FYI', findings: [{ origin: 'session-review', kind: 'claim_contradicted',
    status: 'FYI', title: 'The checks fail', receipts: [receipt('observation', 'R1-r', 'fail 1'), receipt('action', 'R3', 'make lint'),
      receipt('action', 'R4', 'cat /srv/x/build.log')] }] });
  assert.equal(html.includes('/srv/'), false, 'the directory a command ran from, or a path outside the repository, is not shown');
  const cited = itemOf(html, 'finding-1');
  assert.match(cited, /Failed command it cites<\/span> <code>npm test<\/code> <span class="flagchip">failed, exit 1<\/span>/);
  assert.match(cited, /<code>make lint<\/code> <span class="flagchip">failed, exit 1<\/span>/, 'whatever command it was');
  assert.match(cited, new RegExp(`<span class="note">${PAGE_SENTENCES.commandWithheld.replace(/\./g, '\\.')}</span> <span class="flagchip">failed, exit 1</span>`));
  assert.match(textOf(html), /Commands that failed or did not run 3 of 4 commands failed; 3 are shown beside the row that cites them\. The session's last command failed; it is shown beside the row that cites it\./);
  assert.doesNotMatch(html, /<details class="failed">/, 'nothing left to list');
  assert.doesNotMatch(html, /node --test/, 'a command that passed is not listed');
  assert.doesNotMatch(html, /Tests the agent ran|test run/);
});

test('M33 Y a long session stays within the page bound, and every cut is stated', () => {
  const { session, windows } = longSession();
  const html = page(session, longReport(session, windows));
  assert.ok(Buffer.byteLength(html) <= PAGE_LIMITS.maxBytes, `${Buffer.byteLength(html)} bytes`);
  assert.match(textOf(html), /\d+ more changes? of approach (is|are) not shown\./);
  // D69 f (g): a request's instructions are chosen by status — every one short of addressed first — and the ones left
  // out are counted by status.
  assert.match(textOf(html), /\d+ more instructions? (is|are) not shown: \d+ (open|partly addressed|addressed)[^.]*\./);
  assert.match(textOf(html), /Commands that failed or did not run \d+ of \d+ commands failed/);
  assertGrounded(html, session);

  // Past the bounds: more decisions than are listed, more steps than are shown, a page past maxBytes.
  const b = sessionBuilder();
  b.ask('I0', 'Generate the tables.');
  const lists = [['I0']];
  const body = (i) => Array.from({ length: 40 }, (_, line) => `export const row${i}_${line} = '${'v'.repeat(140)}';`).join('\n');
  for (let i = 0; i < 420; i++) {
    // Story /14 (D77 C): a step is one of your requests, so each table is asked for in a request of its own: 421 steps.
    b.ask(`I${i + 1}`, `Table ${i}.`);
    b.say(`C${i}`, `I will write table ${i} now.`);
    b.change(`W${i}`, `src/tables/table-${i}.js`, { after: `${body(i)}\n` });
    lists.push([`I${i + 1}`, `C${i}`, `W${i}`, `W${i}-r`]);
  }
  const big = { windowResults: windowsOf(...lists), sessionStatus: 'CLEAN',
    // Each with the code it wrote grounded, so its edit is previewed (D69 f (g): a hunk only where a code quote picks it).
    decisions: Array.from({ length: 170 }, (_, i) => decided({ dimension: `table ${i}`, chosen: 'generated', actions: [`W${i}`],
      column: 'unasked', stated: receipt('commentary', `C${i}`, `write table ${i}`), valueState: 'grounded', value: `row${i}_0`,
      valueReceipt: { eventId: `W${i}`, field: 'added-code', role: 'code', quote: `export const row${i}_0 =`, sessionKey: STORY_KEY } })) };
  big.windowResults[3].failure = 'model_unavailable';
  const huge = page(b.session(), big);
  assert.ok(Buffer.byteLength(huge) <= PAGE_LIMITS.maxBytes, `${Buffer.byteLength(huge)} bytes`);
  const text = textOf(huge);
  assert.match(text, /Made without asking you \(170\)/);
  assert.match(text, /20 more decisions in this group are not shown\./);
  assert.equal((huge.match(/<li class="finding alert" id="decision-/g) ?? []).length, PAGE_LIMITS.decisions);
  assert.match(text, /Steps 401–421 are not shown\./);
  assert.equal((huge.match(/<li class="turn-row/g) ?? []).length, PAGE_LIMITS.steps);
  assert.ok(text.includes(PAGE_SENTENCES.stepsTrimmed));
  assert.ok(text.includes(PAGE_SENTENCES.filesTrimmed));
  assert.ok(text.includes(PAGE_SENTENCES.editsTrimmed));
  assert.doesNotMatch(huge, /<details class="change"/);
  // A link never points at a step the page does not show.
  for (const [, target] of huge.matchAll(/href="#([^"]*)"/g)) assert.ok(huge.includes(`id="${target}"`), `#${target} exists`);
});

test('M33 Y a long hunk is windowed on the grounded line, and the cut is stated', () => {
  const b = sessionBuilder();
  b.ask('I1', 'Add the flag.');
  const lines = Array.from({ length: 60 }, (_, i) => `const line${i} = ${i};`);
  b.change('W1', 'src/flags.js', { after: `${lines.join('\n')}\n` });
  const session = b.session();
  const html = page(session, { windowResults: windowsOf(['I1', 'W1', 'W1-r']), sessionStatus: 'CLEAN', decisions: [
    decided({ dimension: 'flag', chosen: 'line 50', actions: ['W1'], valueState: 'grounded', value: 'line50',
      valueReceipt: { eventId: 'W1', field: 'added-code', role: 'code', quote: 'const line50 = 50;', sessionKey: STORY_KEY } })] });
  const diff = itemOf(html, 'decision-1');
  assert.equal((diff.match(/<span class="ln/g) ?? []).length, PAGE_LIMITS.snippetLines);
  assert.match(diff, /<span class="ln add key">\+const line50 = 50;<\/span>/);
  assert.match(diff, /<p class="cut">Lines 37–60 of 60\.<\/p>/);
  assert.doesNotMatch(diff, /line0 = 0/);
  // A change the record kept no text of says so; a write outside the repository is never previewed. D69 f (g), D70 review
  // (S0): a decision of how no grounded code quote anchors shows the edit its cited action made, folded — here, that its
  // text was not kept.
  const c = sessionBuilder();
  c.ask('I1', 'Write the plan.');
  c.change('W1', 'src/x.js', { after: 'a\n', extent: { recorded: false } });
  c.change('W2', 'srv/plans/plan.md', { after: 'secret plan\n', outside: true });
  const none = page(c.session(), { windowResults: windowsOf(['I1', 'W1', 'W1-r', 'W2', 'W2-r']), sessionStatus: 'FYI', decisions: [
    decided({ actions: ['W1'] }), decided({ dimension: 'plan', actions: ['W2'] })],
  findings: [{ origin: 'session-review', kind: 'claim_contradicted', status: 'FYI', title: 'The file', receipts: [receipt('action', 'W1', 'src/x.js')] }] });
  assert.match(textOf(itemOf(none, 'decision-1')), /What it wrote or ran for it The edit it was made in: src\/x\.js \+\? −\? The recording did not keep this change's text\./);
  assert.match(itemOf(none, 'decision-1'), /<details class="change">/);
  assert.ok(itemOf(none, 'finding-1').includes(escapeHtml(PAGE_SENTENCES.noText)));
  assert.doesNotMatch(none, /plan\.md|secret plan/);
});

test('M33 Y a real ledger report of the redis-pivot session renders its grounded rows', () => {
  const session = redisPivotSession();
  const report = buildLedger({ repo: { host: 'github.com', id: '42' }, session, pr: redisPivotPr(),
    candidates: DECISION_CANDIDATES, findingCandidates: FINDING_CANDIDATES, sessionCoverage: 'complete' });
  const { session: omitted, ...saved } = report;
  // M35 windowing: a small work budget (111 tokens, about 400 bytes) cuts the session into two windows.
  saved.windowResults = planWindows(session, { workTokens: 111, carriedTokens: 0, trimTokens: 2_000 })
    .map((w) => ({ windowIndex: w.index, eventIds: w.events.map((e) => e.id), failure: null }));
  const html = page(session, JSON.parse(JSON.stringify(saved)));
  assertGrounded(html, session);
  assert.equal(html.match(TOKENS)?.[0] ?? null, null);
  const text = textOf(html);
  // D71 (S4): a contradicted claim is under what the agent told you, headed by what contradicts it.
  assert.match(text, /Contradicted by a recorded result step \d Agent said “verified it works — the tests pass” Recorded result “Tests: 1 failed, 11 passed, 12 total”/);
  // D70 (b): your words it served, then its choice in its own words and the review's, then what it wrote or ran for it.
  assert.match(text, /Decision step \d Cache backend You asked “Add response caching to the products API” Agent said “add a small Redis layer” Chosen Redis as a shared cache store What it wrote or ran for it Agent did “config\/redis\.yml”/);
  // D69 f (g): its value is an action (a path), not code written, so no hunk is picked by a quote; D70 review (S0): the
  // edit its cited action made is shown, folded, from its first hunk.
  assert.match(text, /Agent did “config\/redis\.yml” The edit it was made in: config\/redis\.yml/);
  assert.doesNotMatch(html, /Files its cited actions changed/);
  assert.match(text, /npm run test:integration failed/);
  assert.ok(text.includes(`${PAGE_GROUP_WORDS['asked-chose']} (`));
  assert.ok(Object.values(PAGE_GROUP_WORDS).every((words) => !TOKENS.test(words)));
  assert.ok(text.includes(STORY_SENTENCES.noAsks) === false);
});

test('M33 Y findings keep the story\'s labels: a forbidden edit, a helper\'s own statement, an edit cited', () => {
  const b = sessionBuilder();
  b.ask('I1', 'Fix the cache bug. Do not touch the config file.');
  b.say('C1', 'I changed the config file to fix it.');
  b.change('W1', 'config/app.yml', { operation: 'edit', before: 'ttl: 10\n', after: 'ttl: 60\n', priorState: 'edit-text' });
  b.delegate('D1', 'Check the cache', 'h1');
  b.ask('child:h1:I0', 'Check the cache', 'agent', 'h1');
  b.say('child:h1:C0', 'The cache tests all pass.', 'final', 'h1');
  b.run('child:h1:R0', 'npm test', 'failed', 'fail 2', 'h1');
  const session = b.session();
  const report = { windowResults: windowsOf(['I1', 'C1', 'W1', 'W1-r'], ['D1', 'child:h1:I0', 'child:h1:C0', 'child:h1:R0', 'child:h1:R0-r']),
    sessionStatus: 'DECIDE', findings: [
      { origin: 'session-review', kind: 'edit_under_negative_requirement', status: 'DECIDE', breach: 'wrote',
        title: 'Did what you said not to: the config file was changed',
        receipts: [receipt('instruction', 'I1', 'Do not touch the config file'), receipt('code', 'W1', 'ttl: 60')],
        reportedBy: receipt('commentary', 'C1', 'I changed the config file') },
      { origin: 'session-review', kind: 'claim_contradicted', status: 'FYI', disclosureReason: 'helper_internal',
        title: 'Claim contradicted by a recorded result: the cache tests pass',
        receipts: [receipt('commentary', 'child:h1:C0', 'The cache tests all pass'), receipt('observation', 'child:h1:R0-r', 'fail 2')] }] };
  const html = page(session, report);
  assertGrounded(html, session);
  const forbidden = textOf(itemOf(html, 'finding-1'));
  assert.ok(forbidden.includes(STORY_SENTENCES.forbiddenEdit));
  // M33 brittleness M4 session route (owner decision 2026-10-06): a statement code only verified is never shown as
  // "The agent told you" — a report saved with the old `reportedBy` reads as without it.
  assert.match(forbidden, /You said “Do not touch the config file” The agent wrote “ttl: 60”/);
  assert.doesNotMatch(forbidden, /The agent told you/);
  assert.ok(!forbidden.includes(STORY_SENTENCES.editDisclosed));
  // Only an upheld disclosure (FYI `disclosed`, its statement as `disclosedBy`) says so, with the agent's words.
  const [edit, helperRow] = report.findings;
  const { reportedBy: told, ...plainEdit } = edit;
  const both = page(session, { ...report, findings: [helperRow,
    { ...plainEdit, status: 'FYI', disclosureReason: 'disclosed', disclosedBy: told }] });
  assertGrounded(both, session);
  const disclosed = ['finding-1', 'finding-2'].map((id) => textOf(itemOf(both, id)))
    .find((text) => text.includes('Do not touch the config file'));
  assert.ok(disclosed.includes(STORY_SENTENCES.forbiddenEdit));
  assert.ok(disclosed.includes(STORY_SENTENCES.editDisclosed));
  // D64 wording (owner decision 2026-10-07): the statement is labelled with what the challengers upheld.
  assert.match(disclosed, /You said “Do not touch the config file” The agent wrote “ttl: 60” The agent told you it went against your instruction “I changed the config file”/);
  assert.match(forbidden, /The edit it cites: config\/app\.yml \+1 −1 -ttl: 10 \+ttl: 60/);
  assert.match(itemOf(html, 'finding-1'), /<span class="ln add key">\+ttl: 60<\/span>/);
  const helper = textOf(itemOf(html, 'finding-2'));
  assert.ok(helper.includes(STORY_SENTENCES.helperInternal));
  assert.match(helper, /A helper agent said this .* Helper said “The cache tests all pass” Recorded result “fail 2”/);
  assert.doesNotMatch(helper, NO_VERDICT);
  assert.doesNotMatch(helper, /Agent said/);
});

/** A home directory, built at run time: a secret scan flags one written out in a source file. */
const HOME = ['', 'Users', 'dev'].join('/');

test('M33 Y a quote of a write outside the repository, a file only read or a home directory never reaches the page', () => {
  // The real ledger grounds a decision's value on the plan written outside the repository — by its path and by its
  // body — and nothing stops a written claim, a pivot or a finding citing it. The page withholds every one, and counts it.
  const session = storySession();
  const ledger = buildLedger({ repo: { host: 'github.com', id: '0' }, session, pr: null, sessionCoverage: 'complete',
    candidates: [
      { actorSession: STORY_KEY, dimension: 'where the plan lives', chosen: 'a private plan file', value: TEXT.planPath,
        valueReceipt: { role: 'action', field: 'path', eventId: 'A5-2', quote: TEXT.planPath }, actions: ['A5-2'],
        stated: null, constrainedBy: null },
      { actorSession: STORY_KEY, dimension: 'fallback order', chosen: 'a store first', value: 'try Redis first',
        valueReceipt: { role: 'code', field: 'added-code', eventId: 'A5-2', quote: 'Private plan: try Redis first' },
        actions: ['A5-2'], stated: null, constrainedBy: null }] });
  assert.deepEqual(ledger.decisions.map((d) => d.valueState), ['grounded', 'grounded'], 'the ledger grounds both values');
  const { session: omitted, ...saved } = ledger;
  saved.windowResults = STORY_WINDOWS.map((eventIds, windowIndex) => ({ windowIndex, eventIds: [...eventIds], failure: null }));
  saved.writtenClaims = [{ stated: receipt('code', 'A5-2', 'try Redis first, then fall back'), text: 'The plan names a fallback',
    label: 'unverified' }];
  saved.pivots = [{ abandoned: 'one plan', adopted: 'another', receipts: [receipt('code', 'A5-2', 'Private plan'),
    receipt('action', 'A5-2', TEXT.planPath), receipt('commentary', 'C2-1', 'switching to an in-process token bucket')] }];
  saved.findings = [{ origin: 'session-review', kind: 'claim_contradicted', status: 'FYI', title: 'A plan was written',
    receipts: [receipt('code', 'A5-2', 'then fall back'), receipt('action', 'A5-2', TEXT.planPath)] }];
  const report = JSON.parse(JSON.stringify(saved));
  const html = page(session, report);
  assertGrounded(html, session);
  for (const hidden of [TEXT.planPath, 'Users/', 'rate-limit-plan', 'Private plan', 'try Redis first', 'fall back'])
    assert.equal(html.includes(hidden), false, hidden);
  const text = textOf(html);
  assert.doesNotMatch(text, /Code written|Agent did/);
  // Each withheld quote is counted where it would have been.
  for (const id of ['decision-1', 'decision-2']) {
    assert.ok(textOf(itemOf(html, id)).includes(PAGE_SENTENCES.quotesWithheld(1)), id);
    assert.ok(!itemOf(html, id).includes(PAGE_SENTENCES.decisionQuotesMissing), `${id} quotes were found, not missing`);
  }
  assert.ok(textOf(itemOf(html, 'finding-1')).includes(PAGE_SENTENCES.quotesWithheld(2)));
  assert.ok(!itemOf(html, 'finding-1').includes(PAGE_SENTENCES.findingQuotesMissing));
  // D69 f (g): the change of approach shares the plan's write with the decision made in it, so it is shown inside it,
  // its own quotes with it.
  const pivot = itemOf(html, 'decision-1');
  assert.match(textOf(pivot), /It changed approach here In the review's words: Moved from one plan to another Agent said “switching to an in-process token bucket”/);
  assert.ok(textOf(pivot.slice(pivot.indexOf('It changed approach here'))).includes(PAGE_SENTENCES.quotesWithheld(2)));
  assert.doesNotMatch(html, /id="pivot-/);
  // A written claim in the plan reads in the review's words, as the story shows it.
  assert.match(text, /In the review's words: The plan names a fallback/);

  // A value that cites a file only read, and commands that name a home directory: the read path and the home
  // directory are never shown; a leading `cd <home> &&` is dropped, as it is from a test command.
  const b = sessionBuilder();
  b.ask('I1', 'Set up deploy keys and run the tests.');
  b.read('R0', 'Users/dev/.ssh/config');
  b.run('R1', `cd ${HOME}/proj && npm test`, 'succeeded', 'pass 3');
  b.run('R2', `cat ${HOME}/.zshrc`, 'succeeded', 'export X=1');
  b.change('W1', 'deploy/keys.md', { after: 'Keys live in the vault.\n' });
  const s2 = b.session();
  const value = (eventId, field, quote) => ({ eventId, field, role: field === 'added-code' ? 'code' : 'action', quote, sessionKey: STORY_KEY });
  const r2 = { windowResults: windowsOf(['I1', 'R0', 'R0-r', 'R1', 'R1-r', 'R2', 'R2-r', 'W1', 'W1-r']), sessionStatus: 'CLEAN',
    decisions: [
      decided({ dimension: 'ssh config', chosen: 'reuse it', actions: ['R0'], valueState: 'grounded', value: 'x',
        valueReceipt: value('R0', 'path', 'Users/dev/.ssh/config') }),
      decided({ dimension: 'test command', chosen: 'npm test', actions: ['R1'], valueState: 'grounded', value: 'npm test',
        valueReceipt: value('R1', 'command', `cd ${HOME}/proj && npm test`) }),
      decided({ dimension: 'shell profile', chosen: 'read it', actions: ['R2'], valueState: 'grounded', value: 'x',
        valueReceipt: value('R2', 'command', `cat ${HOME}/.zshrc`) }),
      decided({ dimension: 'key notes', chosen: 'a notes file', actions: ['W1'], valueState: 'grounded', value: 'deploy/keys.md',
        valueReceipt: value('W1', 'path', 'deploy/keys.md') })],
    findings: [{ origin: 'session-review', kind: 'claim_contradicted', status: 'FYI', title: 'Keys were read',
      receipts: [receipt('action', 'R0', 'Users/dev/.ssh/config'), receipt('action', 'R2', `cat ${HOME}/.zshrc`)] }] };
  const out = page(s2, r2);
  assertGrounded(out, s2);
  for (const hidden of ['Users/', '.ssh', '.zshrc', '/proj']) assert.equal(out.includes(hidden), false, hidden);
  assert.ok(textOf(itemOf(out, 'decision-1')).includes(PAGE_SENTENCES.quotesWithheld(1)));
  assert.match(itemOf(out, 'decision-2'), /Agent ran<\/span><blockquote><q class="said"><code>npm test<\/code><\/q>/);
  assert.ok(textOf(itemOf(out, 'decision-3')).includes(PAGE_SENTENCES.quotesWithheld(1)));
  assert.match(itemOf(out, 'decision-4'), /Agent did<\/span><blockquote><q class="said"><code>deploy\/keys\.md<\/code><\/q>/);
  assert.ok(textOf(itemOf(out, 'finding-1')).includes(PAGE_SENTENCES.quotesWithheld(2)));

  // A command that wrote a file outside the repository carries the file's body in its own text (a heredoc): no quote
  // of that command is shown, whatever it holds.
  const c = sessionBuilder();
  c.ask('I1', 'Write the plan down.');
  c.change('W1', 'srv/plans/plan.md', { after: 'Private plan line\n', outside: true, tool: 'bash' });
  const heredoc = "cat > /srv/plans/plan.md <<'EOF'\nPrivate plan line\nEOF";
  c.blobs.heredoc = heredoc;
  c.events.find((event) => event.id === 'W1').command = [{ sourceKey: 'heredoc', fromByte: 0, untilByte: Buffer.byteLength(heredoc) }];
  const s3 = c.session();
  const r3 = { windowResults: windowsOf(['I1', 'W1', 'W1-r']), sessionStatus: 'FYI',
    decisions: [decided({ dimension: 'plan', chosen: 'a plan file', actions: ['W1'], valueState: 'grounded', value: 'x',
      valueReceipt: value('W1', 'command', 'Private plan line') })],
    findings: [{ origin: 'session-review', kind: 'claim_contradicted', status: 'FYI', title: 'A plan was written',
      receipts: [receipt('action', 'W1', 'Private plan line'), receipt('action', 'W1', '<<\'EOF\'')] }] };
  const planned = page(s3, r3);
  assertGrounded(planned, s3);
  for (const hidden of ['Private plan', 'plan.md', 'EOF']) assert.equal(planned.includes(hidden), false, hidden);
  assert.ok(textOf(itemOf(planned, 'decision-1')).includes(PAGE_SENTENCES.quotesWithheld(1)));
  assert.ok(textOf(itemOf(planned, 'finding-1')).includes(PAGE_SENTENCES.quotesWithheld(2)));
});

test('M33 Y a step that read files is titled without where they are: a read path can be a home directory\'s', () => {
  // The slicer keeps a path read outside the working directory with its leading slash stripped.
  const b = sessionBuilder();
  b.ask('I1', 'Check the config.');
  b.read('R1', 'Users/dev/.claude/CLAUDE.md');
  b.read('R2', 'Users/dev/.claude/settings.json');
  b.read('R3', 'src/app/a.js');
  b.read('R4', 'src/app/b.js');
  const session = b.session();
  const report = { windowResults: windowsOf(['I1', 'R1', 'R1-r', 'R2', 'R2-r'], ['R3', 'R3-r', 'R4', 'R4-r']), sessionStatus: 'CLEAN' };
  const html = page(session, report);
  // Story /14 (D77 C): the two review windows review one request, so they are one step, titled by every file it read.
  assert.deepEqual([...html.matchAll(/<p class="said-line">([^<]*)<\/p>/g)].map((m) => m[1]), ['Read 4 files']);
  for (const hidden of ['Users/', '.claude', 'CLAUDE.md', 'src/app']) assert.equal(html.includes(hidden), false, hidden);
});

/** A judge for the fast-profile turn: its narrative, and every challenge vote not-refuted but the contradicted
 *  claim's (`claims:0`), which votes `vote` (null: never voted). */
const turnJudge = (vote) => async (request) => {
  if (!request.challenge) return turnNarrative();
  return { votes: request.challenge.items.flatMap((item) => {
    const verdict = item.key === 'claims:0' ? vote : 'not-refuted';
    return verdict === null ? [] : [{ key: item.key, verdict, explanation: 'Synthetic.',
      receipts: verdict === 'uncertain' ? [] : [ownReceipt(item.candidate)] }];
  }) };
};
async function turnReport(vote) {
  const report = await runReview({ session: turnSession(), pr: null, reviewScope: 'session-only', speedProfile: 'm33-lean',
    judge: turnJudge(vote) });
  const { session: omitted, ...saved } = report;
  return JSON.parse(JSON.stringify(saved));
}

test('M33 Y an unsettled check is said as one, never as missing evidence; a step is reviewed only when the review says so', async () => {
  const session = turnSession();
  // The contradicted claim's check did not settle: NO_FINDINGS over complete coverage and a completed review.
  const unsettled = await turnReport('uncertain');
  const honest = honestStatuses(unsettled);
  assert.deepEqual([honest.sessionStatus, honest.coverage, honest.sessionReview], ['NO_FINDINGS', 'complete', 'complete']);
  const html = page(session, unsettled);
  assertGrounded(html, session);
  const text = textOf(html);
  // D71 (a): no verdict says so; the gap beside the request does (below).
  assert.doesNotMatch(text, NO_VERDICT);
  assert.doesNotMatch(text, /Some evidence was missing|does not say which evidence/);
  // D69 f: the gap is said beside the request whose turn it is, as what it means for judging that request.
  assert.ok(textOf(itemOf(html, 'request-1')).includes(`${PAGE_LABELS.partlyChecked} ${PAGE_GAP_WORDS.decide_unsettled}.`));
  assert.doesNotMatch(text, /part of the session|parts of the session|review window/);
  assert.match(text, /The session's one step was reviewed\./);
  assert.equal(html.match(TOKENS)?.[0] ?? null, null);
  assert.doesNotMatch(text, /\bT1\b/, 'a part is counted, never named');

  // The same check never voted: the window did not complete, though no step failed. The step is not called reviewed.
  const unexecuted = await turnReport(null);
  assert.equal(honestStatuses(unexecuted).sessionStatus, 'UNCHECKED');
  const short = textOf(page(session, unexecuted));
  assert.doesNotMatch(short, /step was reviewed|steps were reviewed/);
  // D69 f (g): said in one section of what could not be checked.
  // D84 (4) c: and names the step, from the report's window results, with the rows it holds. D88: the section is What
  // Sonah could not check, counted by the rows it lists.
  assert.match(short, /What Sonah could not check \(\d+\) The review The session review did not complete\. Not covered 1 of 1 step was not fully reviewed: step 1, which holds decision 1, claim 1, claim 2, claim 3 and request 1\./);
  assert.ok(textOf(itemOf(page(session, unexecuted), 'request-1')).includes(PAGE_GAP_WORDS.window_incomplete));
  assert.doesNotMatch(short, /review window/);
  assert.doesNotMatch(short, /does not say which evidence/);
});

test('M33 Y a combined report: the page is the session\'s, and the code review\'s findings are counted, not listed', () => {
  const b = sessionBuilder();
  b.ask('I1', 'Rename the helper.');
  b.say('C1', 'The helper is renamed everywhere.');
  b.change('W1', 'src/a.js', { operation: 'edit', before: 'old()\n', after: 'renamed()\n' });
  const session = b.session();
  const codeFinding = { origin: 'code-review', kind: 'code_issue', status: 'DECIDE', title: 'renamed() is never defined',
    receipts: [receipt('code', 'W1', 'renamed()')], scope: 'current-code', anchor: null };
  const report = { repo: { host: 'github.com', id: '0' }, pr: { number: 7 }, reviewScope: 'combined', codeCoverage: 'complete',
    coverage: 'complete', sessionReview: 'complete', sessionStatus: 'CLEAN', decisions: [], findings: [codeFinding],
    windowResults: windowsOf(['I1', 'C1', 'W1', 'W1-r']) };
  const honest = honestStatuses(report);
  assert.deepEqual([honest.reviewScope, honest.sessionStatus, honest.reviewStatus], ['combined', 'CLEAN', 'DECIDE']);
  const html = page(session, report);
  const text = textOf(html);
  assert.ok(text.includes(`${PAGE_ATTENTION_WORDS.heading} ${PAGE_ATTENTION_WORDS.none} ${PAGE_ATTENTION_WORDS.codeReviewNote(1)}`));
  assert.doesNotMatch(html, /id="findings"|never defined/);
  assert.doesNotMatch(text, NO_VERDICT);
  assert.ok(text.includes(PAGE_SENTENCES.codeFindings(1)));
  assert.doesNotMatch(html, /<li class="turn-row flag"/, 'a code finding flags no step');
  // A session finding beside it is listed, and only it.
  const both = { ...report, findings: [codeFinding, { origin: 'session-review', kind: 'claim_contradicted', status: 'FYI',
    title: 'The rename claim is not checked', receipts: [receipt('commentary', 'C1', 'The helper is renamed everywhere')] }] };
  const mixed = page(session, both);
  assert.equal(honestStatuses(both).sessionStatus, 'FYI');
  assert.match(textOf(mixed), /Where your attention is needed 1 claim of the agent's contradicted by the recording This page covers the session only: the code review's 1 finding is not on it\./);
  assert.doesNotMatch(textOf(mixed), NO_VERDICT);
  assert.equal((mixed.match(/id="finding-\d+"/g) ?? []).length, 1);
  assert.doesNotMatch(mixed, /never defined/);
  // A report with no code finding says nothing of one.
  assert.ok(!page().includes(PAGE_SENTENCES.codeFindings(1)));
});

test('M33 Y a helper\'s statement in any finding is the helper\'s, never the agent\'s', () => {
  const b = sessionBuilder();
  b.ask('I1', 'Fix the cache bug.');
  b.delegate('D1', 'Check the cache', 'h1');
  b.ask('child:h1:I0', 'Check the cache', 'agent', 'h1');
  b.say('child:h1:C0', 'The cache tests all pass.', 'final', 'h1');
  b.run('child:h1:R0', 'npm test', 'failed', 'fail 2', 'h1');
  const session = b.session();
  // A DECIDE row (a merged row keeps no helper_internal disclosure) whose statement is a helper's.
  const report = { windowResults: windowsOf(['I1', 'D1', 'child:h1:I0', 'child:h1:C0', 'child:h1:R0', 'child:h1:R0-r']),
    sessionStatus: 'DECIDE', findings: [{ origin: 'session-review', kind: 'claim_contradicted', status: 'DECIDE', title: 'Contradicted',
      receipts: [receipt('commentary', 'child:h1:C0', 'The cache tests all pass'), receipt('observation', 'child:h1:R0-r', 'fail 2')] }] };
  const html = page(session, report);
  assertGrounded(html, session);
  const item = itemOf(html, 'finding-1');
  assert.match(item, /Helper said<\/span><blockquote><q class="said">The cache tests all pass<\/q>/);
  assert.doesNotMatch(item, /Agent said/);
});

test('M33 Y a row that cites several edits previews one and names the others', () => {
  const b = sessionBuilder();
  b.ask('I1', 'Tidy the modules.');
  for (const [k, name] of ['a', 'b', 'c', 'd', 'e'].entries()) b.change(`W${k + 1}`, `src/${name}.js`, { after: `export const ${name} = ${k};\n` });
  const session = b.session();
  const report = { windowResults: windowsOf(['I1', 'W1', 'W1-r', 'W2', 'W2-r', 'W3', 'W3-r', 'W4', 'W4-r', 'W5', 'W5-r']),
    sessionStatus: 'FYI', decisions: [decided({ actions: ['W1', 'W2'], valueState: 'grounded', value: 'a',
      valueReceipt: { eventId: 'W1', field: 'added-code', role: 'code', quote: 'export const a = 0;', sessionKey: STORY_KEY } }),
    decided({ dimension: 'layout', actions: ['W1', 'W2', 'W3', 'W4', 'W5'], valueState: 'grounded', value: 'a',
      valueReceipt: { eventId: 'W1', field: 'added-code', role: 'code', quote: 'export const a = 0;', sessionKey: STORY_KEY } }),
    // D69 f (g): with no code quote to pick a hunk — D70 review (S0): in the how group, its actions' first edits, folded,
    // the rest named; in any other group, the files its actions changed, named.
    decided({ dimension: 'names', actions: ['W1', 'W2', 'W3', 'W4', 'W5'] }),
    decided({ dimension: 'order', actions: ['W1', 'W2', 'W3', 'W4', 'W5'], columnState: 'unchecked' })],
    findings: [{ origin: 'session-review', kind: 'claim_contradicted', status: 'FYI', title: 'Two files',
      receipts: [receipt('code', 'W2', 'export const b = 1;'), receipt('action', 'W3', 'src/c.js')] }] };
  const html = page(session, report);
  const two = textOf(itemOf(html, 'decision-1'));
  assert.match(two, /The edit it was made in: src\/a\.js \+1 −0 \+export const a = 0; It was also made in 1 more edit, not shown here: src\/b\.js\./);
  assert.match(textOf(itemOf(html, 'decision-2')), /It was also made in 4 more edits, not shown here: src\/b\.js, src\/c\.js, src\/d\.js and 1 more file\./);
  const how = itemOf(html, 'decision-3');
  assert.match(textOf(how), /What it wrote or ran for it The edit it was made in: src\/a\.js \+1 −0 \+export const a = 0; The edit it was made in: src\/b\.js \+1 −0 \+export const b = 1; The edit it was made in: src\/c\.js \+1 −0 \+export const c = 2; It was also made in 2 more edits, not shown here: src\/d\.js and src\/e\.js\./);
  assert.equal((how.match(/<details class="change">/g) ?? []).length, PAGE_LIMITS.namedEdits, 'each folded');
  const files = itemOf(html, 'decision-4');
  assert.match(textOf(files), /Files its cited actions changed src\/a\.js, src\/b\.js, src\/c\.js and 2 more files/);
  assert.doesNotMatch(files, /<details class="change">|The edit it was made in/);
  assert.match(textOf(itemOf(html, 'finding-1')), /The edit it cites: src\/b\.js \+1 −0 \+export const b = 1; It also cites 1 more edit, not shown here: src\/c\.js\./);
  // A row with one edit says nothing more.
  assert.doesNotMatch(itemOf(page(), 'decision-1'), /more edit/);
  // A long path in a cut line wraps at phone width rather than being clipped by its card.
  assert.match(PAGE_CSS, /\.cut \{[^}]*overflow-wrap: anywhere;/);
});

test('M33 Y the line marked for code written is the line written, never the one it replaced', () => {
  const run = (before, after, quote) => {
    const b = sessionBuilder();
    b.ask('I1', 'Set the cache ttl.');
    b.change('W1', 'src/cache.js', { operation: 'edit', before, after, priorState: 'edit-text' });
    return itemOf(page(b.session(), { windowResults: windowsOf(['I1', 'W1', 'W1-r']), sessionStatus: 'CLEAN', decisions: [
      decided({ actions: ['W1'], value: quote, valueState: 'grounded',
        valueReceipt: { eventId: 'W1', field: 'added-code', role: 'code', quote, sessionKey: STORY_KEY } })] }), 'decision-1');
  };
  // The quote is a substring of the removed line too.
  assert.match(run('ttl: 600\n', 'ttl: 60\n', 'ttl: 60'), /<span class="ln del">-ttl: 600<\/span><span class="ln add key">\+ttl: 60<\/span>/);
  assert.match(run('x = formatDate(a)\n', '  x = formatDate(a);\n', 'x = formatDate(a)'),
    /<span class="ln del">-x = formatDate\(a\)<\/span><span class="ln add key">\+  x = formatDate\(a\);<\/span>/);
  // A line moved from the top of the file to its end: the hunk shown is the one that adds it.
  const keys = Array.from({ length: 12 }, (_, i) => `k${i}: ${i}`);
  const moved = run(['timeout: 30', ...keys].join('\n') + '\n', [...keys, 'timeout: 30'].join('\n') + '\n', 'timeout: 30');
  assert.match(moved, /<span class="ln add key">\+timeout: 30<\/span>/);
  assert.doesNotMatch(moved, /-timeout: 30/);
  assert.match(moved, /<p class="cut">Hunk 2 of 2\.<\/p>/);
  // A finding's code quote is marked on the side it is on: the added line for one on the after side, the removed line
  // for one only on the before side.
  const cited = (quote) => {
    const b = sessionBuilder();
    b.ask('I1', 'Set the cache ttl.');
    b.change('W1', 'src/cache.js', { operation: 'edit', before: 'ttl: 10\n', after: 'ttl: 100\n', priorState: 'edit-text' });
    return itemOf(page(b.session(), { windowResults: windowsOf(['I1', 'W1', 'W1-r']), sessionStatus: 'FYI', findings: [{ origin: 'session-review',
      kind: 'claim_contradicted', status: 'FYI', title: 'The ttl', receipts: [receipt('code', 'W1', quote)] }] }), 'finding-1');
  };
  assert.match(cited('ttl: 100'), /<span class="ln del">-ttl: 10<\/span><span class="ln add key">\+ttl: 100<\/span>/);
  assert.match(cited('ttl: 10\n'), /<span class="ln del key">-ttl: 10<\/span><span class="ln add">\+ttl: 100<\/span>/);
});

test('M33 Y the page bound is hard: every list filled with text that escapes long still fits, and every cut is stated', () => {
  // Every character below is shown in four to twelve bytes: markup escapes to an entity, a bidi control to its code
  // point, and the last is four bytes of UTF-8.
  const unit = ['<', '&', '"', "'", '>', '‮', '\u{1D4B3}', ' '];
  const heavy = (n, tag) => `${tag} ${Array.from({ length: n }, (_, i) => unit[i % unit.length]).join('')}`;
  const head = (text, n) => Array.from(text).slice(0, n).join('');
  const b = sessionBuilder();
  const asks = Array.from({ length: PAGE_LIMITS.asks }, (_, i) => heavy(PAGE_LIMITS.askChars + 40, `ask${i}`));
  asks.forEach((text, i) => b.ask(`I${i}`, text));
  const lists = [asks.map((_, i) => `I${i}`)];
  const said = [], body = [];
  for (let i = 0; i < PAGE_LIMITS.steps; i++) {
    said.push(heavy(300, `say${i}`));
    body.push(Array.from({ length: 30 }, (_, line) => heavy(PAGE_LIMITS.snippetLineChars, `l${i}_${line}`)).join('\n'));
    // Story /14 (D77 C): a step is one of your requests, so each window's work is asked for in a short request of its own.
    b.ask(`J${i}`, `Step ${i}.`);
    b.say(`C${i}`, said[i]);
    b.change(`W${i}`, `src/${heavy(20, `f${i}`).replace(/[^\w]/g, '_')}.js`, { after: `${body[i]}\n` });
    const ids = [`J${i}`, `C${i}`, `W${i}`, `W${i}-r`];
    if (i < 50) { b.run(`R${i}`, heavy(PAGE_LIMITS.commandChars + 20, `npm test ${i}`), 'failed', heavy(200, `out${i}`)); ids.push(`R${i}`, `R${i}-r`); }
    lists.push(ids);
  }
  const session = b.session();
  const quoteOf = (i) => head(said[i], PAGE_LIMITS.quoteChars + 20);
  const checks = asks.slice(0, PAGE_LIMITS.checks).map((text, i) => ({ instruction: receipt('instruction', `I${i}`, head(text, 200)), relevant: false }));
  const report = { windowResults: windowsOf(...lists), sessionStatus: 'DECIDE',
    decisions: Array.from({ length: PAGE_LIMITS.decisions }, (_, i) => decided({ dimension: heavy(200, `dim${i}`), chosen: heavy(200, `ch${i}`),
      actions: [`W${i}`, `W${i + 1}`], column: i % 2 ? 'unasked' : 'asked-chose', stated: receipt('commentary', `C${i}`, quoteOf(i)),
      constrainedBy: i % 2 ? null : { instruction: receipt('instruction', `I${i % PAGE_LIMITS.asks}`, head(asks[i % PAGE_LIMITS.asks], 150)), settles: false, settledValueQuote: null },
      instructionReview: i % 2 ? { checks } : null, valueState: 'grounded', value: 'x',
      valueReceipt: { eventId: `W${i}`, field: 'added-code', role: 'code', quote: body[i].split('\n')[20], sessionKey: STORY_KEY } })),
    findings: Array.from({ length: PAGE_LIMITS.findings + 5 }, (_, i) => ({ origin: 'session-review', kind: 'claim_contradicted', status: 'DECIDE',
      title: heavy(200, `t${i}`), receipts: [receipt('commentary', `C${i}`, quoteOf(i)), receipt('code', `W${i}`, body[i].split('\n')[25]),
        ...[i, i + 1, i + 2, i + 3].filter((k) => k < 50).map((k) => receipt('observation', `R${k}-r`, `out${k}`))] })),
    promises: Array.from({ length: PAGE_LIMITS.promises }, (_, i) => ({ stated: receipt('commentary', `C${i}`, quoteOf(i)), text: heavy(200, `p${i}`), status: 'open' })),
    // Changes of approach that share no event with a decision (D69 f (g): one that does is shown inside it).
    pivots: Array.from({ length: PAGE_LIMITS.pivots + 3 }, (_, i) => ({ abandoned: heavy(80, `a${i}`), adopted: heavy(80, `b${i}`),
      receipts: [receipt('commentary', `C${i + 200}`, quoteOf(i + 200)), receipt('code', `W${i + 200}`, body[i + 200].split('\n')[3])] })),
    requirements: asks.flatMap((text, k) => Array.from({ length: PAGE_LIMITS.rowsPerAsk + 1 }, (_, j) => ({
      instruction: receipt('instruction', `I${k}`, head(text, 100 + j)), text: heavy(200, `r${k}_${j}`), status: 'open' }))) };
  const html = page(session, report);
  assert.ok(Buffer.byteLength(html) <= PAGE_LIMITS.maxBytes, `${Buffer.byteLength(html)} bytes`);
  const text = textOf(html);
  for (const sentence of [PAGE_SENTENCES.stepsTrimmed, PAGE_SENTENCES.filesTrimmed, PAGE_SENTENCES.editsTrimmed,
    PAGE_SENTENCES.asksTrimmed, PAGE_SENTENCES.listsTrimmed])
    assert.ok(text.includes(sentence), sentence);
  assert.doesNotMatch(html, /<details class="whole"/, 'a long request is shown only in part');
  assert.doesNotMatch(html, /<details class="checked"/, 'the checked instructions are only counted');
  // Every list it shortened says how many it leaves out.
  // D71 (S4): a finding past the bound is counted in its checklist section (a contradicted claim among the claims).
  assert.match(text, /\d+ (more )?claims? (is|are) not shown\./);
  assert.match(text, /\d+ (more )?decisions? in this group (is|are) not shown\./);
  // D69 f (g): a request past the bound is one line (its number, its statuses, its steps), never only counted, while the
  // one-line list has room.
  assert.match(text, /(One more request|\d+ more requests), one line each:/);
  for (let k = 1; k <= PAGE_LIMITS.asks; k++) assert.ok(html.includes(`id="request-${k}"`), `request ${k} has its line`);
  assert.match(text, /\d+ (more )?claims? (is|are) not shown\./);
  assert.match(text, /50 of \d+ commands failed; \d+ (is|are) shown beside the row that cites (it|them); \d+ (is|are) cited by no row on this page, in steps? \d/);
  assert.match(text, /And \d+ more failed commands? it cites\./);
  assert.match(text, /\d+ (more )?changes? of approach (is|are) not shown\./);
  assert.match(text, /Steps \d+–\d+ are not shown\./);
  assert.equal(html.match(TOKENS)?.[0] ?? null, null);
  for (const [, target] of html.matchAll(/href="#([^"]*)"/g)) assert.ok(html.includes(`id="${target}"`), `#${target} exists`);
  assertGrounded(html, session);
  assert.equal(page(session, JSON.parse(JSON.stringify(report))), html, 'the bound is deterministic');
});

test('a decision heading is in sentence case unless it starts with a code name, and each row is labelled Decision', () => {
  const report = storyReport();
  report.decisions[0] = { ...report.decisions[0], dimension: 'summarizeOrder date formatting' };
  report.decisions[1] = { ...report.decisions[1], dimension: 'date-range boundary' };
  const text = textOf(page(storySession(), report));
  assert.ok(text.includes('summarizeOrder date formatting'));
  assert.ok(!text.includes('SummarizeOrder'));
  assert.ok(text.includes('Date-range boundary'));
  assert.ok(!/You asked; the agent chose how|You settled this/.test(text), 'the group heading is not repeated on each row');
});

test('D69 f (g) the page follows the reader\'s setting by default, light or dark only when asked; every fold starts collapsed', () => {
  const system = page();
  assert.equal(page(storySession(), storyReport(), { theme: 'system' }), system);
  assert.equal(page(storySession(), storyReport(), { theme: 'purple' }), system, 'an unknown theme is the reader\'s own');
  assert.match(system, /<html lang="en">/);
  assert.match(system, /<meta name="color-scheme" content="light dark">/);
  const dark = page(storySession(), storyReport(), { theme: 'dark' });
  assert.match(dark, /<html lang="en" data-theme="dark">/);
  assert.match(dark, /<meta name="color-scheme" content="dark">/);
  const light = page(storySession(), storyReport(), { theme: 'light' });
  assert.match(light, /<html lang="en" data-theme="light">/);
  assert.match(light, /<meta name="color-scheme" content="light">/);
  assert.equal(light.replace(/<html[^>]*>/, '').replace(/<meta name="color-scheme"[^>]*>/, ''),
    dark.replace(/<html[^>]*>/, '').replace(/<meta name="color-scheme"[^>]*>/, ''), 'the theme changes nothing else');
  for (const html of [light, dark, system]) {
    assert.ok(html.includes('<details class="card-fold">'), 'the steps and files are folded');
    assert.doesNotMatch(html, /<details[^>]*\bopen\b/, 'no details element starts open');
  }
});

// ---- D69 f: the judgment-first page (its audit, 2026-10-08) -------------------------------------------------------

/** A session of asks (ids I1…, each its own turn T1…) and runs, and a report over one step holding every event. */
function asked(asks, build = () => {}) {
  const b = sessionBuilder();
  asks.forEach((text, i) => { b.ask(`I${i + 1}`, text); b.events.at(-1).turn = `T${i + 1}`; });
  build(b);
  const session = b.session();
  return { session, windowResults: windowsOf(session.events.map((event) => event.id)) };
}
const requirement = (eventId, quote, status) => ({ instruction: receipt('instruction', eventId, quote), text: quote, status });

test('D69 f, D71 (S4): what you asked for is pointed to at the top by what is not shown done, never by a tally of what is', () => {
  const { session, windowResults } = asked(['Add the flag and document it.', 'Thanks, ship it.']);
  // D71 (a): no verdict; (S4) no tally of what is done (it reads as a grade). Where your attention is needed counts the
  // asks not shown done, by status, linked to what you asked.
  const report = { repo: { host: 'github.com', id: '0' }, pr: null, reviewScope: 'session-only', codeCoverage: 'missing',
    coverage: 'complete', sessionReview: 'complete', sessionStatus: 'CLEAN', findings: [], decisions: [], windowResults,
    requirements: [requirement('I1', 'Add the flag', 'addressed'), requirement('I1', 'document it', 'open')] };
  const html = page(session, report);
  // D88: an ask shown not done or partly done (a legacy report's open one, the review's reading) is counted.
  assert.match(html, /<div class="attention"><span class="label">Where your attention is needed<\/span><ul><li><a href="#requests">One ask of yours is shown not done or partly done: 1 open<\/a><\/li>\n<\/ul><\/div>/);
  assert.doesNotMatch(textOf(html), NO_VERDICT);
  assert.doesNotMatch(html, /class="ledger|1 addressed/);
  // Each status is said to be the review's reading beside the statuses, and drawn apart from a checked chip.
  const requests = html.slice(html.indexOf('id="requests"'), html.indexOf('id="failures"'));
  assert.ok(textOf(requests).includes(PAGE_SENTENCES.statusReading));
  assert.equal((requests.match(/<span class="pill reading">/g) ?? []).length, 2);
  // The instructions and claims the review named but did not keep are counted (never shown), beside what they bear on.
  const kept = page(session, { ...report, requirements: [requirement('I1', 'Add the flag', 'addressed')], requirementsRejected: 2,
    claimsRejected: 1 });
  assert.ok(textOf(kept.slice(kept.indexOf('id="requests"'), kept.indexOf('id="failures"'))).includes(PAGE_SENTENCES.requirementsRejected(2)));
  assert.ok(textOf(kept.slice(kept.indexOf('id="claims"'), kept.indexOf('id="edits"'))).includes(PAGE_SENTENCES.claimsRejected(1)));
  // Everything addressed: nothing is pointed to, and the page says that is not a statement that the work is right.
  const done = page(session, { ...report, requirements: [requirement('I1', 'Add the flag', 'addressed')] });
  assert.ok(done.includes(`<p>${escapeHtml(PAGE_ATTENTION_WORDS.none)}</p>`));
  // None named: each request says so where it is listed; no request at all: said so, never a count of nothing.
  assert.ok(textOf(page(session, { windowResults, sessionStatus: 'CLEAN' })).includes(STORY_SENTENCES.noRequirements));
  const none = sessionBuilder();
  none.say('C1', 'Working.');
  assert.ok(textOf(page(none.session(), { windowResults: windowsOf(['C1']), sessionStatus: 'CLEAN' })).includes(STORY_SENTENCES.noAsks));
});

test('D69 f a request is shown whole, in its own words: a long one folded with its line breaks, a short one as it is', () => {
  const long = `Please do these things:\n${Array.from({ length: 12 }, (_, i) => `- item ${i}: change the module named part${i} carefully`).join('\n')}`;
  assert.ok(long.length > PAGE_LIMITS.askChars);
  const { session, windowResults } = asked([long, 'Short one.']);
  const html = page(session, { windowResults, sessionStatus: 'CLEAN' });
  const first = itemOf(html, 'request-1');
  assert.match(first, /<p class="title"><q class="said">Please do these things: - item 0/, 'its start, on one line');
  assert.match(first, /<\/q>…<\/p><details class="whole"><summary>Show the whole request<\/summary><p class="ask-whole"><q class="said">Please do these things:\n- item 0/);
  assert.ok(first.includes('item 11: change the module named part11 carefully</q>'), 'to its last word');
  assert.match(PAGE_CSS, /\.ask-whole \{[^}]*white-space: pre-wrap;/);
  assert.match(itemOf(html, 'request-2'), /<p class="title"><q class="said">Short one\.<\/q><\/p>/);
  assert.doesNotMatch(itemOf(html, 'request-2'), /<details/);
  assertGrounded(html, session);
});

test('D69 f each gap is said beside the request it affects, in the page\'s words; one no request opens is said apart', () => {
  // The words: every gap reason has them (the two finding reasons are listed as findings), none says "part" or "window".
  assert.deepEqual(Object.keys(PAGE_GAP_WORDS), PART_REASONS.slice(2));
  for (const words of [...Object.values(PAGE_GAP_WORDS), ...Object.keys(PAGE_CAUSE_WORDS).map((cause) => PAGE_CAUSE_WORDS[cause]({ n: 2, m: 3 }))])
    assert.doesNotMatch(words, /\bparts?\b|\bwindows?\b|proposal/, words);
  for (const cause of [...PAGE_ASK_CAUSES, ...Object.keys(PAGE_CAUSE_WORDS)]) assert.ok(COVERAGE_CAUSES.includes(cause), cause);
  const counts = (fields = {}) => ({ findings: 0, decisions: 0, windows: 1, windowsIncomplete: 0, gaps: 0, ...fields });
  const { session, windowResults } = asked(['First ask.', 'Second ask.']);
  const report = { windowResults, sessionStatus: 'NO_FINDINGS', coverage: 'partial', coverageFacts: { windows: 1, actions: 3,
    instructionsElided: 1, instructionsWithheld: 0 },
  parts: [
    { part: 'T1', status: 'UNCHECKED', reasons: ['window_incomplete', 'instruction_omitted'], counts: counts({ windowsIncomplete: 1, gaps: 1 }) },
    { part: 'T2', status: 'CLEAN', reasons: [], counts: counts() },
    { part: 'T3', status: 'NO_FINDINGS', reasons: ['gap_declared'], counts: counts({ gaps: 1 }) }],
  sessionWideLimits: { status: 'NO_FINDINGS', limited: true, reasons: ['limit_unattributed'], counts: { events: 0, ...counts({ windows: 0 }) } } };
  const html = page(session, report);
  const text = textOf(html);
  assert.ok(textOf(itemOf(html, 'request-1')).includes(`${PAGE_LABELS.partlyChecked} ${PAGE_GAP_WORDS.window_incomplete}; `
    + `${PAGE_GAP_WORDS.instruction_omitted}.`));
  assert.doesNotMatch(itemOf(html, 'request-2'), /class="note gap"/);
  // A turn no request opens (T3), and the session-wide entry: said apart, in the footer, never by a part's name.
  assert.ok(text.includes(PAGE_SENTENCES.noRequestTied(`${PAGE_GAP_WORDS.gap_declared}; ${PAGE_GAP_WORDS.limit_unattributed}`)));
  assert.doesNotMatch(text, /\bT[123]\b|part of the session|parts of the session|review window/);
  // The coverage causes that say your words may be missing are said above the requests, not in the footer.
  const requests = textOf(html.slice(html.indexOf('id="requests"'), html.indexOf('id="failures"')));
  assert.ok(requests.includes(`${PAGE_LABELS.missingWords} ${COVERAGE_SENTENCE.instructions_elided({ n: 1 })}.`));
  assert.doesNotMatch(textOf(html.slice(html.indexOf('<footer'))), /elided by the recorder/);
});

test('D69 f a decision with no word or action of the agent\'s is said so and listed apart; one it could not check sits beside your instructions', () => {
  const html = page();
  const text = textOf(html);
  // D69 f (g): a change its cited actions made inside the repository is an action of the agent's, so only the test-runner
  // decision (a command, no change, no quote) rests on the review's words alone — listed under its own heading, after
  // the decisions of its group the agent's own words or actions ground, its rows carrying no chip of their own.
  assert.ok(text.includes(PAGE_SENTENCES.reviewWordsOnly(1)));
  // (D71 S4: the groups in the checklist's order, so it is decision 4, after your settled one.)
  const group = html.slice(html.indexOf('Could not check whether you asked (1)'), html.indexOf('id="requests"'));
  assert.match(group, /<h4 class="label sub">No word or action of the agent&#39;s \(1\)<\/h4><ol class="findings"><li class="finding" id="decision-4">/);
  assert.doesNotMatch(html, /<span class="pill">No (quote|word)/);
  // D70 (b): a decision of how says which of its three parts the review did not record; D70 review (S0): with no code
  // quote, the edit its cited action made is shown, folded.
  assert.ok(textOf(itemOf(html, 'decision-2')).includes(`${PAGE_SENTENCES.howAskedNone} ${PAGE_SENTENCES.howWordsNone} `
    + `${PAGE_LABELS.chosen} HTTP 429 with Retry-After ${PAGE_LABELS.howCode} ${PAGE_LABELS.editMade} src/middleware/index.js`));
  // The decision it could not check: why (its closed reason, in the page's words), and your grounded instructions of the
  // request its step worked on, linked. (The whole row: it holds a list of its own, so it ends at the row's own close.)
  const unchecked = html.slice(html.indexOf('id="decision-4"'), html.indexOf('</div></li>', html.indexOf('id="decision-4"')));
  assert.ok(textOf(unchecked).includes(`${PAGE_LABELS.whyUnchecked} Your instructions before it were not all recorded in full, so whether one covered it could not be checked.`));
  assert.ok(textOf(unchecked).includes(`${PAGE_LABELS.stepAsk} ${PAGE_SENTENCES.stepInstructions(2)} request 2 “add tests for the limiter” “make sure the whole suite passes”`));
  assert.match(unchecked, /<a class="more" href="#request-2">request 2<\/a>/);
  // Only that group: a decision whose column the ledger derived carries none.
  for (const id of ['decision-1', 'decision-2', 'decision-3']) assert.doesNotMatch(itemOf(html, id), /Your instructions here|Why it could not check/);
  // And it is listed, by its reason, under what could not be checked.
  assert.match(textOf(html.slice(html.indexOf('id="unchecked"'))), /Whether you asked Your instructions before it were not all recorded in full, so whether one covered it could not be checked: decision 4\./);
  assertGrounded(html, storySession());
});

test('D69 f a failed command is shown beside the row that cites it, the rest counted; the changed files are listed once', () => {
  const html = page();
  // The finding citing the last run's result shows that command; the other failed run is counted with its step.
  // Story /14 (D77 C): the fixture's seven windows are two steps, one per request.
  assert.match(itemOf(html, 'finding-1'), /Failed command it cites<\/span> <code>npm test<\/code> <span class="flagchip">failed, exit 1<\/span> <a class="turn" href="#step-2">step 2<\/a>/);
  assert.ok(textOf(html).includes('Commands that failed or did not run 2 of 7 commands failed; 1 is shown beside the row that cites it; 1 is cited by no row on this page, in step 1.'));
  // A file is listed once: in "Files changed", with the steps that changed it; never again under a step.
  const steps = html.slice(html.indexOf('id="steps"'), html.indexOf('id="files"'));
  assert.doesNotMatch(steps, /redis-store|token-bucket|middleware\/index/);
  assert.match(html.slice(html.indexOf('id="files"')), /<code>src\/middleware\/index\.js<\/code> <span class="mono">\+7 −\?<\/span> <span class="turn"><a href="#step-1">step 1<\/a><\/span>/);
});

test('D69 page audit: a command or input quote is withheld by the shell\'s and JSON\'s grammars, never by a home-folder shape', () => {
  const b = sessionBuilder();
  b.ask('I1', 'Run the build.');
  b.run('R1', 'npm run build > /tmp/build.log 2>&1', 'succeeded', 'ok');
  b.run('R2', 'node scripts/gen.mjs --out=~/gen/x.json --fast', 'succeeded', 'ok');
  b.run('R3', 'git commit -F - <<EOF\nAdd the build flag\nEOF', 'succeeded', 'ok');
  b.run('R4', 'node ../other/tool.js && npm test', 'succeeded', 'ok');
  const generic = (id, input) => {
    b.run(id, 'unused', 'succeeded', 'ok');
    Object.assign(b.events.find((event) => event.id === id), { operation: 'other', tool: 'mcp', command: [] });
    b.blobs[`in-${id}`] = input;
    b.events.find((event) => event.id === id).input = [{ sourceKey: `in-${id}`, fromByte: 0, untilByte: Buffer.byteLength(input) }];
  };
  generic('G1', '{"path":"/srv/data/rows.csv","query":"select rows"}');
  generic('G2', '{"path":"docs/rows.md","query":"select rows"}');
  const session = b.session();
  const ids = session.events.map((event) => event.id);
  const value = (eventId, quote) => ({ eventId, field: 'command', role: 'action', quote, sessionKey: STORY_KEY });
  const report = { windowResults: windowsOf(ids), sessionStatus: 'FYI', decisions: [
    decided({ dimension: 'a', actions: ['R1'], valueState: 'grounded', value: 'x', valueReceipt: value('R1', 'npm run build') }),
    decided({ dimension: 'b', actions: ['R1'], valueState: 'grounded', value: 'x', valueReceipt: value('R1', 'tmp/build.log') }),
    decided({ dimension: 'c', actions: ['R2'], valueState: 'grounded', value: 'x', valueReceipt: value('R2', '--fast') }),
    decided({ dimension: 'd', actions: ['R2'], valueState: 'grounded', value: 'x', valueReceipt: value('R2', 'gen/x.json') }),
    decided({ dimension: 'e', actions: ['R3'], valueState: 'grounded', value: 'x', valueReceipt: value('R3', 'Add the build flag') }),
    decided({ dimension: 'f', actions: ['R4'], valueState: 'grounded', value: 'x', valueReceipt: value('R4', 'npm test') }),
    decided({ dimension: 'g', actions: ['R4'], valueState: 'grounded', value: 'x', valueReceipt: value('R4', 'other/tool.js') })],
  findings: [{ origin: 'session-review', kind: 'claim_contradicted', status: 'FYI', title: 'Inputs',
    receipts: [receipt('action', 'G1', 'select rows'), receipt('action', 'G1', 'srv/data'), receipt('action', 'G2', 'docs/rows.md')] }] };
  const html = page(session, report);
  assertGrounded(html, session);
  const shown = (id) => /Agent ran<\/span>/.test(itemOf(html, id));
  // The words a quote touches decide (widened to the blanks around it: a path cut by the quote is still that path).
  assert.deepEqual(['decision-1', 'decision-2', 'decision-3', 'decision-4', 'decision-5', 'decision-6', 'decision-7'].map(shown),
    [true, false, true, false, true, true, false]);
  for (const hidden of ['/tmp/', 'tmp/build.log', '~/gen', 'gen/x.json', '../other', 'other/tool.js', '/srv/', 'srv/data'])
    assert.equal(html.includes(hidden), false, hidden);
  // A JSON input: the string value the quote is in decides, read whole — a quote of a value naming a path outside the
  // working tree is withheld, one of another value of the same input is not.
  const finding = itemOf(html, 'finding-1');
  assert.deepEqual(quotesOf(finding), ['select rows', 'docs/rows.md']);
  assert.ok(textOf(finding).includes(PAGE_SENTENCES.quotesWithheld(1)));
});
