// D163 (the owner, 2026-10-28: "Move 'decided on its own' up", "Layout + code review"; "Show the agent's reason when it
// changed approach", "Labels + Sonah's reading"). The report's first part points to each decision of the second part
// tagged Must act or Must know, and Must act counts and names the ones tagged Must act; the second part lists every
// decision end to end, a decision that the first part keeps by one line that says where it is; an open group folds its
// decisions tagged Good to know under one counted line after its Must ones; a change of approach labels each quote by its
// receipt's role and shows the session review's reading of why on its own line, as the session review's words. Structure
// only, on every reader: the model, the page, the .md (its shortening too) and the terminal count line.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { reportModel, reportItems, visibleWords, pointerLineText, trailEntryText } from '../report-model.js';
import { renderSessionPage } from '../session-page.js';
import { renderReportMarkdown } from '../session-story.js';
import { countLines } from '../../cli/src/report-output.js';
import { REPORT_TRAIL_WORDS, REPORT_ITEM_WORDS, REPORT_TIER_WORDS, REPORT_COUNT_WORDS, REPORT_SECTION_WORDS,
  REPORT_FOOTER_WORDS } from '../report-words.js';
import { reportSession, triagedReport, repoFacts } from './report-fixture.js';
import { sessionBuilder, STORY_KEY } from './session-story-fixture.js';

const r = (role, eventId, quote) => ({ role, eventId, quote, sessionKey: STORY_KEY });
const id = (c) => `sha256:${c.repeat(64)}`;
const decided = (fields) => ({ actorSession: STORY_KEY, dimension: 'store', chosen: 'a store', value: null,
  valueReceipt: null, valueState: 'unchecked', actions: [], stated: null, constrainedBy: null, instructionReview: null,
  column: 'unasked', columnState: 'grounded', amends: [], materiality: 'structural', materialityRule: 'synthetic',
  relevance: 'unchecked', reasons: [], ...fields });
const trailOf = (model) => model.decisions.groups.flatMap((g) => g.items);
const entriesOf = (model) => model.decisions.groups.flatMap((g) => g.entries);
const esc = (text) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
  .replace(/'/g, '&#39;');
const high = (index, c) => ({ ref: { source: 'decisions', index, id: id(c) }, level: 'high', impact: 'It changed the store.',
  action: 'Check the store.', label: 'check the store', where: null });

/** One message that holds an ask; work after it, a failed run, the agent's words, a helper's brief, more work. */
function smallSession() {
  const b = sessionBuilder();
  b.ask('I1', 'Add a cache to the client.');
  b.change('W1', 'src/cache.js', { after: 'export const cache = new Map();\n' });
  b.run('R1', 'npm test', 'failed', 'FAIL cache.test.js expected 2 got 3');
  b.say('C1', 'The map does not evict, so I will use an LRU.');
  b.ask('H1', 'Check the docs for the cache.', 'agent', 'helper-1');
  b.change('W2', 'src/lru.js', { after: 'export const lru = new LRU(10);\n' });
  b.change('W3', 'src/keys.js', { after: 'export const keys = [];\n' });
  b.say('F1', 'Done.', 'final');
  return b.session();
}
/** Its review: the ask done; a change of approach; a decision the code review rated high (tagged Must act, alone: the
 *  first part has no Must act item of its own), one tagged Must know by default, one Good to know. */
function smallReport(session, extra = {}) {
  return { reviewScope: 'session-only', coverage: 'complete', sessionReview: 'complete',
    windowResults: [{ windowIndex: 0, eventIds: session.events.map((e) => e.id), failure: null, challenge: { complete: true },
      groundingComplete: true }],
    requirements: [{ text: 'Add a cache to the client.', status: 'done', instruction: r('instruction', 'I1',
      'Add a cache to the client.'), deliverable: r('code', 'W2', 'export const lru = new LRU(10);') }],
    decisions: [
      decided({ id: id('a'), dimension: 'eviction', chosen: 'an LRU', actions: ['W2'] }),
      decided({ id: id('b'), dimension: 'keys', chosen: 'a list', actions: ['W3'] }),
      decided({ id: id('c'), dimension: 'file', chosen: 'one file', actions: ['W1'], column: 'asked-chose',
        constrainedBy: { instruction: r('instruction', 'I1', 'Add a cache to the client.'), settles: false,
          settledValueQuote: null } })],
    pivots: [{ abandoned: 'a plain map', adopted: 'an LRU', whyAbandoned: '  The test showed that the map grew without bound.  ',
      receipts: [r('commentary', 'C1', 'The map does not evict, so I will use an LRU.'), r('code', 'W1',
        'export const cache = new Map();'), r('observation', 'R1-r', 'FAIL cache.test.js expected 2 got 3')] }],
    codePass: { ran: true, triage: [high(0, 'a')] }, ...extra };
}

test('D163 (L1): Must act counts, names and points to a decision tagged Must act, so it never reads 0 while one is', () => {
  const session = smallSession();
  const report = smallReport(session);
  const model = reportModel(session, report, {});
  const tagged = trailOf(model).find((item) => item.tier.final === 'must_act');
  assert.ok(tagged);
  assert.deepEqual(model.tiers.must_act, [], 'the first part holds no Must act item of its own');
  assert.equal(model.countLine.counts.must_act, 1);
  assert.equal(model.countLine.tiers[0].n, 1);
  assert.equal(model.countLine.empty, null);
  assert.deepEqual(model.countLine.labels.map((l) => l.n), [tagged.n]);
  // Its D144 record, as any item in Must act of its kind (a decision's kind has no prompt in this cut).
  assert.deepEqual([tagged.agentPrompt, tagged.agentPromptNone], [null, 'kind_not_covered']);
  // The pointer: its number and line fields, no number of its own.
  assert.deepEqual(model.pointers.must_act, [{ n: tagged.n, type: tagged.type, what: tagged.what, scope: tagged.scope }]);
  assert.equal(reportItems(model).length, new Set(reportItems(model).map((i) => i.n)).size);
  // The terminal, the page and the .md say the same count and name it.
  const lines = countLines(model);
  assert.ok(lines[0].startsWith('Must act 1 · Must know 0 · Good to know 0 · '), lines[0]);
  assert.ok(lines[0].includes(` · ${REPORT_COUNT_WORDS.decisions(4, 1, 1)} · `), lines[0]);
  assert.equal(lines[1], `${REPORT_COUNT_WORDS.mustActLead} check the store`);
  const page = renderSessionPage(session, report, {});
  assert.ok(page.includes('<a href="#must-act">Must act 1</a>'));
  const act = page.slice(page.indexOf('id="must-act"'), page.indexOf('id="must-know"'));
  assert.ok(act.includes(`<h2>${esc(REPORT_SECTION_WORDS.tier('Must act', 1))}</h2>`));
  assert.ok(act.includes(`<h3 class="sub-h">${esc(REPORT_TRAIL_WORDS.taggedHere('Must act', 1))}</h3>`));
  assert.ok(act.includes(`<li><a href="#item-${tagged.n}"><span class="n">${tagged.n}</span>`));
  assert.equal(page.split(`id="item-${tagged.n}"`).length - 1, 1, 'one anchor, in the second part');
  const md = renderReportMarkdown(session, report, {});
  const mdAct = md.slice(md.indexOf('### Must act'), md.indexOf('### Must know'));
  assert.ok(mdAct.startsWith(`### ${REPORT_SECTION_WORDS.tier('Must act', 1)}`));
  assert.ok(mdAct.includes(`#### ${REPORT_TRAIL_WORDS.taggedHere('Must act', 1)}\n\n- [${tagged.n} Decide: The agent `
    + `decided on *eviction*: *an LRU*.](#item-${tagged.n}) ${REPORT_ITEM_WORDS.notAsked}`), mdAct);
  assert.equal(pointerLineText(model.pointers.must_act[0]), `${tagged.n} Decide: The agent decided on eviction: an LRU. `
    + REPORT_ITEM_WORDS.notAsked);
  assert.equal(md.split(`<a name="item-${tagged.n}"></a>`).length - 1, 1);
  assert.ok(md.includes('Must act: [*check the store*](#item-'));
});

test('D163 (L1): Must know points to its decisions under its own heading and does not count them (D161, judgment call 4)', () => {
  const session = smallSession();
  const report = smallReport(session);
  const model = reportModel(session, report, {});
  const know = trailOf(model).filter((item) => item.tier.final === 'must_know');
  assert.equal(know.length, 1);
  assert.deepEqual(model.pointers.must_know.map((p) => p.n), know.map((item) => item.n));
  assert.equal(model.countLine.counts.must_know, model.tiers.must_know.length);
  assert.equal(model.countLine.decisions.words, REPORT_COUNT_WORDS.decisions(4, 1, 1));
  const page = renderSessionPage(session, report, {});
  const knowPart = page.slice(page.indexOf('id="must-know"'), page.indexOf('id="good-to-know"'));
  assert.ok(knowPart.includes(`<h2>${esc(REPORT_SECTION_WORDS.tier('Must know', 0))}</h2>`));
  assert.ok(knowPart.includes(esc(REPORT_TRAIL_WORDS.taggedHere('Must know', 1))));
  assert.ok(knowPart.includes(`href="#item-${know[0].n}"`));
  const md = renderReportMarkdown(session, report, {});
  const mdKnow = md.slice(md.indexOf('### Must know'), md.indexOf('Good to know ('));
  assert.ok(mdKnow.includes(`#### ${REPORT_TRAIL_WORDS.taggedHere('Must know', 1)}`));
  assert.ok(mdKnow.includes(`](#item-${know[0].n})`));
  // A pointer is a visible line of the first part: the first screen's words count it.
  const words = (text) => text.split(/\s+/).filter(Boolean).length;
  const without = { ...model, pointers: { must_act: [], must_know: [] } };
  assert.equal(visibleWords(model) - visibleWords(without), words([REPORT_TRAIL_WORDS.taggedHere('Must act', 1),
    ...model.pointers.must_act.map(pointerLineText), REPORT_TRAIL_WORDS.taggedHere('Must know', 1),
    ...model.pointers.must_know.map(pointerLineText)].join('\n')));
  // A tier with no decision tagged with it has no heading for them.
  const none = reportModel(session, smallReport(session, { codePass: { ran: true, triage: [] } }), {});
  assert.deepEqual(none.pointers.must_act, []);
  assert.equal(renderSessionPage(session, smallReport(session, { codePass: { ran: true, triage: [] } }), {})
    .includes(esc(REPORT_TRAIL_WORDS.taggedHere('Must act', 0))), false);
});

test('D163: the second part lists every decision, one that the first part keeps by a line at its place, counted and tagged', () => {
  // The fixture's decision on how to do your ask, with a question of the code review proposed high that quotes its own
  // words: the question joins it as a member in Must act, so the first part keeps it (D161's `trailItem`).
  const session = reportSession();
  const report = triagedReport(session);
  report.codePass.questions[0] = { ...report.codePass.questions[0], concerns: { key: 'S3', kind: 'decision',
    source: 'decisions', index: 2, id: report.decisions[2].id }, quote: report.decisions[2].stated };
  report.codePass.triage.push({ ref: { question: 'Q1' }, level: 'high', impact: 'One client can use the whole limit.',
    action: 'Choose a limit per client.', label: 'choose the limit scope', where: null });
  const model = reportModel(session, report, repoFacts());
  const holder = model.tiers.must_act.find((item) => item.kind === 'decision_chose');
  assert.ok(holder, 'the first part keeps the decision with its Must act member');
  const above = entriesOf(model).filter((e) => e.above);
  assert.deepEqual(above.map((e) => [e.n, e.tier, e.type]), [[holder.n, 'must_act', holder.type]]);
  assert.deepEqual(above[0].what, holder.what);
  // Counted in the part's total and its group's, and tagged as what it is; the part's items are its own decisions.
  assert.equal(model.decisions.total, trailOf(model).length + 1);
  assert.equal(model.decisions.tagged.must_act, trailOf(model).filter((i) => i.tier.final === 'must_act').length + 1);
  const group = model.decisions.groups.find((g) => g.entries.some((e) => e.above));
  assert.equal(group.count, REPORT_COUNT_WORDS.decisions(group.entries.length, group.tagged.must_act,
    group.tagged.must_know));
  assert.equal(group.items.length, group.entries.length - 1);
  // At its place in the order: by the moment its row names (its earliest action, else its stated words; a change of
  // approach's earliest receipt), read here from the rows themselves, among the others; not last.
  const at = new Map(session.events.map((e, i) => [e.id, i]));
  const momentOf = (n) => {
    const item = reportItems(model).find((x) => x.n === n);
    const row = report[item.rows[0].source][item.rows[0].index];
    const ids = item.rows[0].source === 'pivots' ? row.receipts.map((x) => x.eventId) : row.actions;
    const known = ids.filter((x) => at.has(x)).map((x) => at.get(x));
    return known.length ? Math.min(...known) : at.get(row.stated?.eventId) ?? Infinity;
  };
  const moments = group.entries.map((e) => momentOf(e.n));
  assert.deepEqual(moments, [...moments].sort((a, b) => a - b));
  assert.ok(group.entries.findIndex((e) => e.above) < group.entries.length - 1, 'at its place, not appended');
  // Never a pointer of its own: it is in the first part already.
  assert.equal(model.pointers.must_act.some((p) => p.n === holder.n), false);
  assert.equal(model.countLine.counts.must_act, model.tiers.must_act.length + model.pointers.must_act.length);
  // The readers: one line, linked to its item above, its tag last; never a second anchor.
  const page = renderSessionPage(session, report, repoFacts());
  const trail = page.slice(page.indexOf('id="decisions"'), page.indexOf('id="prompt"'));
  assert.ok(trail.includes(`<a href="#item-${holder.n}">${REPORT_TRAIL_WORDS.shownAbove(holder.n)}</a> · `
    + `<span class="tag tier-tag">Must act</span></p>`));
  assert.equal(page.split(`id="item-${holder.n}"`).length - 1, 1);
  const md = renderReportMarkdown(session, report, repoFacts());
  const mdTrail = md.slice(md.indexOf("### The agent's decisions"), md.indexOf('### Your prompt'));
  assert.ok(mdTrail.includes(` · [${REPORT_TRAIL_WORDS.shownAbove(holder.n)}](#item-${holder.n}) · Must act\n`));
  assert.equal(md.split(`<a name="item-${holder.n}"></a>`).length - 1, 1);
  assert.equal(trailEntryText(above[0]).endsWith(` · ${REPORT_TRAIL_WORDS.shownAbove(holder.n)} · Must act`), true);
  // The page's and the .md's second part count it: heading and count line.
  assert.ok(page.includes(`<a href="#decisions">${model.countLine.decisions.words}</a>`));
  assert.ok(md.includes(`### ${REPORT_TRAIL_WORDS.heading(model.decisions.total)}`));
  // Its review: the pointers' heading counts the decisions further down alone; the count line's tags count this entry
  // too, which its own section shows.
  assert.equal(model.pointers.must_act.length, model.decisions.tagged.must_act - 1);
  assert.ok(md.includes(`#### ${REPORT_TRAIL_WORDS.taggedHere('Must act', model.pointers.must_act.length)}\n`));
  assert.equal(REPORT_TRAIL_WORDS.taggedHere('Must act', 1), 'Decisions further down tagged Must act (1)');
});

/** Its review: the fixture's decision on how to do your ask (asked, Good to know of its own) with a question of the code
 *  review proposed high that joins it, so the first part keeps it in Must act; every other decision asked and chosen
 *  (Good to know), none rated by the code review; and `extra` more like it, with long words. */
function keptAlone(extra = 0) {
  const session = reportSession();
  const report = triagedReport(session);
  report.codePass.questions[0] = { ...report.codePass.questions[0], concerns: { key: 'S3', kind: 'decision',
    source: 'decisions', index: 2, id: report.decisions[2].id }, quote: report.decisions[2].stated };
  report.codePass.triage = [...report.codePass.triage.filter((t) => t.ref.source !== 'decisions'), { ref: { question: 'Q1' },
    level: 'high', impact: 'One client can use the whole limit.', action: 'Choose a limit per client.',
    label: 'choose the limit scope', where: null }];
  const asked = report.decisions[2];
  const long = (k) => `${'word '.repeat(40)}${k}`;
  report.decisions = [...report.decisions.map((d, i) => (i === 2 ? d : { ...d, column: 'asked-chose',
    columnState: 'grounded', constrainedBy: asked.constrainedBy, notActing: undefined, reasons: [] })),
  ...Array.from({ length: extra }, (_, k) => ({ ...asked, id: `sha256:${String(k + 8000).padStart(64, '0')}`,
    dimension: long(k), chosen: long(k) }))];
  return { session, report };
}

test('D163\'s review: a group whose one Must entry is a decision the first part keeps is open, and keeps that line', () => {
  const { session, report } = keptAlone();
  const model = reportModel(session, report, repoFacts());
  const group = model.decisions.groups.find((g) => g.entries.some((e) => e.above));
  const above = group.entries.find((e) => e.above);
  assert.equal(group.items.some((item) => item.tier.final !== 'good_to_know'), false, 'no Must decision of its own');
  // Judgment call 2: the entry opens it, as a decision of the part tagged Must does; its Good to know ones fold.
  assert.equal(above.tier, 'must_act');
  assert.deepEqual([group.open, group.shown, group.more.length], [true, [above], group.entries.length - 1]);
  assert.equal(group.moreWords, REPORT_TRAIL_WORDS.moreTagged(group.entries.length - 1, REPORT_TIER_WORDS.good_to_know));
  assert.ok(group.askLines.length > 0);
  const page = renderSessionPage(session, report, repoFacts());
  const trail = page.slice(page.indexOf('id="decisions"'), page.indexOf('id="prompt"'));
  const opened = trail.slice(trail.indexOf('<details class="trail-group" open>'));
  assert.ok(trail.includes('<details class="trail-group" open>'));
  const line = opened.indexOf(`<a href="#item-${above.n}">${REPORT_TRAIL_WORDS.shownAbove(above.n)}</a>`);
  assert.ok(opened.indexOf('class="rows trail-asks"') < line && line < opened.indexOf('class="trail-more"'));
  const md = renderReportMarkdown(session, report, repoFacts());
  const mdTrail = md.slice(md.indexOf("### The agent's decisions"), md.indexOf('### Your prompt'));
  assert.ok(mdTrail.startsWith(`### ${REPORT_TRAIL_WORDS.heading(model.decisions.total)}\n\n<details open><summary>`));
  assert.ok(mdTrail.indexOf(`[${REPORT_TRAIL_WORDS.shownAbove(above.n)}]`) < mdTrail.indexOf(`<summary>${group.moreWords}`));
  // Past 60,000 bytes, at the groups' counts: the line stays (Must is never cut before Good to know), and the group
  // counts its decisions tagged Good to know alone.
  const big = keptAlone(100);
  const bigModel = reportModel(big.session, big.report, repoFacts());
  const bigGroup = bigModel.decisions.groups.find((g) => g.entries.some((e) => e.above));
  const bigMd = renderReportMarkdown(big.session, big.report, repoFacts());
  assert.ok(Buffer.byteLength(bigMd) <= 60_000);
  assert.ok(bigMd.includes(` · [${REPORT_TRAIL_WORDS.shownAbove(above.n)}](#item-${above.n}) · Must act\n`));
  assert.ok(bigMd.includes(REPORT_TRAIL_WORDS.goodToKnowNotShown(bigGroup.entries.filter((e) => e.tier === 'good_to_know')
    .length)));
  assert.equal(bigGroup.entries.filter((e) => e.tier !== 'good_to_know').length, 1);
});

test('D163\'s review: a pointer to a decision tied to your ask names that ask on every reader', () => {
  const session = smallSession();
  const report = smallReport(session, { codePass: { ran: true, triage: [high(2, 'c')] } });
  const model = reportModel(session, report, {});
  const [p] = model.pointers.must_act;
  assert.ok(p && p.scope.asks.length === 1, 'the decision on how to do your ask, rated high');
  const asked = REPORT_ITEM_WORDS.asked(p.scope.asks[0]);
  assert.ok(pointerLineText(p).endsWith(` · ${asked}`));
  const md = renderReportMarkdown(session, report, {});
  const at = md.indexOf(`#### ${REPORT_TRAIL_WORDS.taggedHere('Must act', 1)}`);
  assert.ok(at > 0);
  const line = md.slice(at).split('\n')[2];
  assert.ok(line.startsWith(`- [${p.n} `) && line.endsWith(` · ${asked}`), line);
  const page = renderSessionPage(session, report, {});
  const act = page.slice(page.indexOf('id="must-act"'), page.indexOf('id="must-know"'));
  assert.ok(act.includes(` · <a href="#ask-${p.scope.asks[0]}">${esc(asked)}</a></li>`));
});

test('D163\'s review: a change of approach labels a result a recorded result only when the recording types its call', () => {
  // The result of a tool the slicer does not type (an MCP tool: what it returns may be another model's words) keeps no
  // label (evidence code-context.js `actorOf`); a command's result is a recorded result.
  const b = sessionBuilder();
  b.ask('I1', 'Add a cache to the client.');
  b.say('C1', 'The map does not evict, so I will use an LRU.');
  b.run('M1', 'ask-the-other-agent', 'succeeded', 'Another model says: an LRU is the right choice.');
  Object.assign(b.events.find((e) => e.id === 'M1'), { tool: 'mcp__peer__ask', operation: 'other', command: [] });
  b.run('R1', 'npm test', 'failed', 'FAIL cache.test.js expected 2 got 3');
  b.change('W1', 'src/lru.js', { after: 'export const lru = new LRU(10);\n' });
  const session = b.session();
  const peer = r('observation', 'M1-r', 'Another model says: an LRU is the right choice.');
  const run = r('observation', 'R1-r', 'FAIL cache.test.js expected 2 got 3');
  const report = { windowResults: [{ windowIndex: 0, eventIds: session.events.map((e) => e.id), failure: null }],
    pivots: [{ abandoned: 'a plain map', adopted: 'an LRU', whyAbandoned: 'The peer said so.',
      receipts: [r('commentary', 'C1', 'The map does not evict, so I will use an LRU.'), peer, run] }] };
  const pivot = reportItems(reportModel(session, report, {})).find((i) => i.kind === 'pivot');
  assert.deepEqual(pivot.evidence.map((e) => [e.label, e.parts[0].text]), [[null,
    'Another model says: an LRU is the right choice.'], [REPORT_ITEM_WORDS.recordedResult,
    'FAIL cache.test.js expected 2 got 3']]);
  const page = renderSessionPage(session, report, {});
  assert.equal(page.includes(`<span class="label">${REPORT_ITEM_WORDS.recordedResult}</span> <q class="said">Another`), false);
});

test('D163 (L5): an open group shows its Must decisions, then one counted fold of those tagged Good to know, in order', () => {
  const session = smallSession();
  const report = smallReport(session);
  const model = reportModel(session, report, {});
  const [group] = model.decisions.groups;
  assert.equal(group.open, true);
  assert.ok(group.shown.every((e) => e.tier !== 'good_to_know') && group.shown.length === 2);
  assert.ok(group.more.every((e) => e.tier === 'good_to_know') && group.more.length === 2);
  assert.equal(group.moreWords, REPORT_TRAIL_WORDS.moreTagged(2, REPORT_TIER_WORDS.good_to_know));
  // Each in the part's order: the fold keeps the order of the whole.
  const at = (n) => group.entries.findIndex((e) => e.n === n);
  for (const part of [group.shown, group.more])
    assert.deepEqual(part.map((e) => at(e.n)), part.map((e) => at(e.n)).sort((a, b) => a - b));
  assert.equal(group.shown.length + group.more.length, group.entries.length);
  const page = renderSessionPage(session, report, {});
  const trail = page.slice(page.indexOf('id="decisions"'), page.indexOf('id="prompt"'));
  const fold = trail.indexOf(`<details class="trail-more"><summary>${group.moreWords}</summary>`);
  assert.ok(fold > 0);
  for (const e of group.shown) assert.ok(trail.indexOf(`id="item-${e.n}"`) < fold, `Must ${e.n} before the fold`);
  for (const e of group.more) assert.ok(trail.indexOf(`id="item-${e.n}"`) > fold, `Good to know ${e.n} inside it`);
  const md = renderReportMarkdown(session, report, {});
  const mdTrail = md.slice(md.indexOf("### The agent's decisions"));
  const mdFold = mdTrail.indexOf(`<details><summary>${group.moreWords}</summary>`);
  assert.ok(mdFold > 0);
  for (const e of group.shown) assert.ok(mdTrail.indexOf(`<a name="item-${e.n}">`) < mdFold);
  for (const e of group.more) assert.ok(mdTrail.indexOf(`<a name="item-${e.n}">`) > mdFold);
  // The first screen counts the fold's line, never the lines inside it.
  const words = (t) => t.split(/\s+/).filter(Boolean).length;
  const swap = (g) => ({ ...model, decisions: { ...model.decisions, groups: [g] } });
  assert.equal(visibleWords(model) - visibleWords(swap({ ...group, more: [], moreWords: null })), words(group.moreWords));
  assert.equal(visibleWords(swap({ ...group, shown: group.entries, more: [], moreWords: null })) - visibleWords(model),
    words(group.more.map(trailEntryText).join('\n')) - words(group.moreWords));
  // A group with no Must decision stays folded, every decision in it, no fold of its own.
  const quiet = smallReport(session, { codePass: { ran: true, triage: [] }, decisions: [decided({ id: id('c'),
    dimension: 'file', chosen: 'one file', actions: ['W1'], column: 'asked-chose', constrainedBy: {
      instruction: r('instruction', 'I1', 'Add a cache to the client.'), settles: false, settledValueQuote: null } })] });
  const closed = reportModel(session, quiet, {}).decisions.groups[0];
  assert.deepEqual([closed.open, closed.more, closed.moreWords, closed.shown.length], [false, [], null, 2]);
  assert.equal(renderSessionPage(session, quiet, {}).includes('class="trail-more"'), false);
  assert.equal(renderReportMarkdown(session, quiet, {}).includes(REPORT_TRAIL_WORDS.moreTagged(2, 'Good to know')), false);
});

test('D163: a change of approach labels each quote by its receipt\'s role, and shows the session review\'s reading of why', () => {
  const session = smallSession();
  const report = smallReport(session);
  const model = reportModel(session, report, {});
  const pivot = trailOf(model).find((item) => item.kind === 'pivot');
  assert.equal(pivot.agentSaid.text, 'The map does not evict, so I will use an LRU.');
  assert.deepEqual(pivot.evidence.map((e) => [e.label, e.parts.map((p) => p.text).join('')]), [
    [REPORT_ITEM_WORDS.changeShows, 'export const cache = new Map();'],
    [REPORT_ITEM_WORDS.recordedResult, 'FAIL cache.test.js expected 2 got 3']]);
  // The reading: the session review's words, on one line, trimmed, never a quote and never under the agent's label.
  assert.deepEqual(pivot.reviewWhy.map((p) => [p.text, p.by, p.quote]), [['The test showed that the map grew without bound.',
    'session-review', false]]);
  const page = renderSessionPage(session, report, {});
  const body = page.slice(page.indexOf(`id="item-${pivot.n}"`));
  const said = body.indexOf('class="line agent-said"'), why = body.indexOf('class="line review-why"');
  assert.ok(said > 0 && why > said, 'the agent\'s own words first');
  assert.ok(body.includes(`<p class="line review-why"><span class="label">${esc(REPORT_ITEM_WORDS.reviewWhy)}</span> `
    + '<em class="by-session-review">The test showed that the map grew without bound.</em></p>'));
  assert.ok(body.includes(`<span class="label">${REPORT_ITEM_WORDS.recordedResult}</span> <q class="said">`));
  const md = renderReportMarkdown(session, report, {});
  assert.ok(md.includes(`${REPORT_ITEM_WORDS.reviewWhy} *The test showed that the map grew without bound.*`));
  assert.ok(md.includes(`- ${REPORT_ITEM_WORDS.changeShows} “export const cache = new Map();”`));
  // The footer still says whose words the italics are.
  assert.ok(model.footer.legend.includes(REPORT_FOOTER_WORDS.legendSessionReview));
  // Clipped by the review's own bound (160), on one line; blank or not a string, no line.
  const long = reportModel(session, smallReport(session, { pivots: [{ ...report.pivots[0], whyAbandoned: `${'why '.repeat(60)}end` }] }), {});
  const text = trailOf(long).find((i) => i.kind === 'pivot').reviewWhy[0].text;
  assert.equal([...text].length, 160);
  assert.ok(text.endsWith('…'));
  for (const whyAbandoned of ['  ', '', null, 7, undefined]) {
    const m = reportModel(session, smallReport(session, { pivots: [{ ...report.pivots[0], whyAbandoned }] }), {});
    assert.equal(trailOf(m).find((i) => i.kind === 'pivot').reviewWhy, null, String(whyAbandoned));
  }
});

test('D163: an instruction a helper\'s session recorded is never "You said:"; yours is', () => {
  const session = smallSession();
  const brief = r('instruction', 'H1', 'Check the docs for the cache.');
  const yours = r('instruction', 'I1', 'Add a cache to the client.');
  const pivotWith = (receipts) => trailOf(reportModel(session, smallReport(session, { pivots: [{ abandoned: 'a plain map',
    adopted: 'an LRU', receipts }] }), {})).find((i) => i.kind === 'pivot');
  const helper = pivotWith([r('commentary', 'C1', 'The map does not evict, so I will use an LRU.'), brief]);
  assert.deepEqual(helper.evidence.map((e) => [e.label, e.parts[0].text]), [[null, 'Check the docs for the cache.']]);
  const person = pivotWith([yours]);
  assert.deepEqual(person.evidence.map((e) => [e.label, e.parts[0].text]), [[REPORT_ITEM_WORDS.youSaid,
    'Add a cache to the client.']]);
  // A helper's words are a helper's, by the recording.
  const b = sessionBuilder();
  b.ask('I1', 'Add a cache to the client.');
  b.say('C9', 'I looked at the docs.', 'working', 'helper-1');
  b.change('W1', 'src/cache.js', { after: 'export const cache = new Map();\n' });
  const s2 = b.session();
  const m2 = reportModel(s2, { windowResults: [{ windowIndex: 0, eventIds: s2.events.map((e) => e.id), failure: null }],
    pivots: [{ abandoned: 'x', adopted: 'y', receipts: [r('code', 'W1', 'export const cache = new Map();'),
      r('commentary', 'C9', 'I looked at the docs.')] }] }, {});
  const p2 = reportItems(m2).find((i) => i.kind === 'pivot');
  assert.equal(p2.agentSaidLabel, REPORT_ITEM_WORDS.helperSaid);
});

test('D163: the .md keeps every pointer and Must decision until Good to know is counts; then each pointer keeps its number', () => {
  const b = sessionBuilder();
  b.ask('I1', 'Add a cache to the client.');
  b.change('W1', 'src/cache.js', { after: 'export const cache = new Map();\n' });
  b.say('F1', 'Done.', 'final');
  const session = b.session();
  const long = (k) => `${'word '.repeat(40)}${k}`;
  const report = { reviewScope: 'session-only', coverage: 'complete', sessionReview: 'complete',
    windowResults: [{ windowIndex: 0, eventIds: session.events.map((e) => e.id), failure: null }],
    decisions: [...Array.from({ length: 70 }, (_, k) => decided({ id: `sha256:${String(k).padStart(64, '1')}`,
      dimension: long(k), chosen: long(k), actions: ['W1'], column: 'unasked' })),
    ...Array.from({ length: 200 }, (_, k) => decided({ id: `sha256:${String(k).padStart(64, '0')}`, dimension: long(k),
      chosen: long(k), actions: ['W1'], column: 'asked-chose', constrainedBy: { instruction: r('instruction', 'I1',
        'Add a cache to the client.'), settles: false, settledValueQuote: null } }))] };
  const model = reportModel(session, report, {});
  assert.deepEqual([model.pointers.must_know.length, model.decisions.tagged.good_to_know], [70, 200]);
  const md = renderReportMarkdown(session, report, {});
  assert.ok(Buffer.byteLength(md) <= 60_000, `${Buffer.byteLength(md)} bytes`);
  // Good to know went first (counted in its group); every Must decision keeps its line and anchor; every pointer its link.
  assert.ok(md.includes(REPORT_TRAIL_WORDS.goodToKnowNotShown(200)));
  for (const p of model.pointers.must_know) {
    assert.ok(md.includes(`<a name="item-${p.n}"></a>`), `decision ${p.n}`);
    assert.ok(md.includes(`[${p.n}](#item-${p.n})`) || md.includes(`](#item-${p.n})`), `pointer ${p.n}`);
  }
  // A smaller report keeps each pointer's whole line.
  const small = { ...report, decisions: report.decisions.slice(0, 3) };
  const smallMd = renderReportMarkdown(session, small, {});
  const smallModel = reportModel(session, small, {});
  for (const p of smallModel.pointers.must_know) assert.ok(smallMd.includes(`- [${p.n} Decide: `), `pointer ${p.n}`);
  // The page keeps them whole, a line each.
  const page = renderSessionPage(session, report, {});
  assert.equal((page.slice(page.indexOf('id="must-know"'), page.indexOf('id="good-to-know"')).match(/<li><a href="#item-/g)
    ?? []).length, 70);
});
