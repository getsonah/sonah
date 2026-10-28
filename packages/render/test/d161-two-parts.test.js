// D161 (the owner, 2026-10-27): the report has two parts. First what to act on (Must act, Must know, Good to know); then
// the decisions the agent took, each with its tier as a tag, in the order the session recorded them, grouped by the
// message of yours that they follow. And a question of the code review that Sonah could not tie (D116) is at most Good to
// know. Structure only: which items leave the tiers, their order and groups, their numbers and every pointer to them, the
// counts on every reader, and no prompt for the agent in the second part.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { reportModel, reportItems, reportPlacement, trailItem, TRAIL_PART } from '../report-model.js';
import { renderSessionPage } from '../session-page.js';
import { renderReportMarkdown } from '../session-story.js';
import { countLines } from '../../cli/src/report-output.js';
import { boundTier, UNTIED_TIER_RULE, ITEM_KIND_TABLE, kindBounds } from '../../evidence/src/triage.js';
import { REPORT_TRAIL_WORDS, REPORT_COUNT_WORDS, REPORT_TIER_WHY } from '../report-words.js';
import { reportSession, triagedReport, repoFacts } from './report-fixture.js';
import { sessionBuilder, STORY_KEY } from './session-story-fixture.js';

const DECIDE = ['decision_not_acting', 'decision_unasked', 'decision_chose', 'decision_whether_asked', 'pivot'];
const r = (role, eventId, quote) => ({ role, eventId, quote, sessionKey: STORY_KEY });
const id = (c) => `sha256:${c.repeat(64)}`;
const decided = (fields) => ({ actorSession: STORY_KEY, dimension: 'store', chosen: 'a store', value: null,
  valueReceipt: null, valueState: 'unchecked', actions: [], stated: null, constrainedBy: null, instructionReview: null,
  column: 'unasked', columnState: 'grounded', amends: [], materiality: 'structural', materialityRule: 'synthetic',
  relevance: 'unchecked', reasons: [], ...fields });
const trailOf = (model) => model.decisions.groups.flatMap((g) => g.items);

/** A session of two messages that each hold an ask, with work before the first, between them and after the second. */
function timedSession() {
  const b = sessionBuilder();
  b.change('W0', 'src/setup.js', { after: 'export const setup = 1;\n' });
  b.say('C0', 'I set up the project first.');
  b.ask('I1', 'Add a cache to the client.');
  b.change('W1', 'src/cache.js', { after: 'export const cache = new Map();\n' });
  b.say('C1', 'I will not add Redis.');
  b.change('W2', 'src/keys.js', { after: 'export const keys = [];\n' });
  b.ask('I2', 'Now add a queue.');
  b.change('W3', 'src/queue.js', { after: 'export const queue = [];\n' });
  b.say('F1', 'Done.', 'final');
  return b.session();
}
/** The review's frame of a session (one window, complete), with no row. */
const timedReportBase = (session) => ({ reviewScope: 'session-only', coverage: 'complete', sessionReview: 'complete',
  windowResults: [{ windowIndex: 0, eventIds: session.events.map((e) => e.id), failure: null, challenge: { complete: true },
    groundingComplete: true }] });
/** Its review: one ask a message, done; decisions in the order given (not the order taken), and a change of approach. */
function timedReport(session, extra = {}) {
  const asks = [['I1', 'Add a cache to the client.', 'W1', 'export const cache = new Map();'],
    ['I2', 'Now add a queue.', 'W3', 'export const queue = [];']];
  return { reviewScope: 'session-only', coverage: 'complete', sessionReview: 'complete', windowResults: [{ windowIndex: 0,
    eventIds: session.events.map((e) => e.id), failure: null, challenge: { complete: true }, groundingComplete: true }],
  requirements: asks.map(([eventId, text, write, code]) => ({ text, status: 'done', instruction: r('instruction', eventId,
    text), deliverable: r('code', write, code) })),
  decisions: [
    // Taken after your second message (its action W3).
    decided({ id: id('a'), dimension: 'queue', chosen: 'an array', actions: ['W3'] }),
    // Taken after your first message, at W2 and W1: its moment is its earliest action, W1.
    decided({ id: id('b'), dimension: 'keys', chosen: 'a list', actions: ['W2', 'W1'] }),
    // A choice not to act with no action: its moment is its stated words, C1.
    decided({ id: id('c'), dimension: 'server', chosen: 'no Redis', notActing: true, stated: r('commentary', 'C1',
      'I will not add Redis.') }),
    // Taken before your first message (W0), and Good to know (you asked, the agent chose how).
    decided({ id: id('d'), dimension: 'setup', chosen: 'one file', actions: ['W0'], column: 'asked-chose',
      constrainedBy: { instruction: r('instruction', 'I1', 'Add a cache to the client.'), settles: false,
        settledValueQuote: null } }),
    // An action the session does not hold: no position, last.
    decided({ id: id('e'), dimension: 'elsewhere', chosen: 'a guess', actions: ['NOT-RECORDED'] }),
  ],
  pivots: [{ abandoned: 'one big file', adopted: 'a file a part', receipts: [r('code', 'W2', 'export const keys = [];')] }],
  ...extra };
}

test('D161: the agent\'s decisions leave the tiers for the second part, each keeping its whole tier record', () => {
  const session = reportSession();
  const report = triagedReport(session);
  const model = reportModel(session, report, repoFacts());
  const firstPart = Object.values(model.tiers).flat();
  assert.equal(firstPart.some((item) => DECIDE.includes(item.kind)), false, 'no decision in the tiers');
  const trail = trailOf(model);
  assert.ok(trail.length >= 5 && trail.every((item) => DECIDE.includes(item.kind)));
  assert.equal(model.decisions.total, trail.length);
  // Every decision of the fixture is in the second part; its tier record is what the tiers would hold (the tag).
  for (const item of trail) {
    assert.deepEqual(Object.keys(item.tier).sort(), ['bound', 'default', 'final', 'from', 'proposed']);
    assert.ok(['must_act', 'must_know', 'good_to_know'].includes(item.tier.final));
  }
  const tagged = Object.fromEntries(['must_act', 'must_know', 'good_to_know'].map((tier) => [tier,
    trail.filter((item) => item.tier.final === tier).length]));
  assert.deepEqual(model.decisions.tagged, tagged);
  assert.deepEqual(tagged, { must_act: 1, must_know: 3, good_to_know: 3 });
  // The rows it holds are placed in that part, each once.
  const placement = reportPlacement(model);
  for (const item of trail) for (const ref of item.rows)
    assert.equal(placement[`${ref.source}:${ref.index}`].part, TRAIL_PART, `${ref.source}:${ref.index}`);
  for (const item of firstPart) for (const ref of item.rows)
    assert.equal(placement[`${ref.source}:${ref.index}`].part, undefined, `${ref.source}:${ref.index}`);
});

test('D161: an item that holds a Must row of another kind stays with what to act on, accusing ones among them', () => {
  // A member by its own final tier (accusing kinds have a floor of Must know, so they always keep the item here).
  const lead = (kind, held = [], tier = 'must_know') => ({ kind, members: held.map((k) => ({ kind: k, folded: [],
    tier: { final: tier } })), folded: [] });
  assert.equal(trailItem(lead('decision_unasked')), true);
  assert.equal(trailItem(lead('pivot', ['code_question'], 'good_to_know')), true, 'a question in Good to know');
  assert.equal(trailItem(lead('pivot', ['code_question'], 'must_know')), false, 'a question in Must know');
  assert.equal(trailItem(lead('pivot', ['code_question'], 'must_act')), false, 'a question in Must act');
  for (const kind of Object.keys(ITEM_KIND_TABLE).filter((k) => ITEM_KIND_TABLE[k].floor !== null))
    assert.equal(trailItem(lead('decision_unasked', [kind])), false, kind);
  // A row folded into the item is read by its own kind.
  assert.equal(trailItem({ kind: 'decision_chose', members: [], folded: [{ source: 'requirements', row: {
    status: 'not-done' } }] }), false);
  // No kind that is not a decision is ever in the second part, whatever it holds.
  for (const kind of Object.keys(ITEM_KIND_TABLE).filter((k) => !DECIDE.includes(k)))
    assert.equal(trailItem(lead(kind)), false, kind);
  // And no accusing kind's tier or floor moved: the table is the code step's, unchanged.
  assert.equal(kindBounds('code_bug').floor, 'must_know');
});

test('D161: the decisions come in the order the session recorded them, by the moment their row names', () => {
  const session = timedSession();
  const model = reportModel(session, timedReport(session), {});
  const order = trailOf(model).map((item) => item.what.parts.map((p) => p.text).join(''));
  // W0 (setup), W1 (keys: its earliest action), C1 (no Redis: its words), W2 (the change of approach: its receipt), W3
  // (queue), then the one with no recorded position.
  assert.deepEqual(order.map((t) => /setup|keys|server|approach|queue|elsewhere/.exec(t)?.[0]), ['setup', 'keys', 'server',
    'approach', 'queue', 'elsewhere']);
  // Numbered once across the report, after the tiers, in reading order.
  const all = reportItems(model);
  assert.deepEqual(all.map((item) => item.n), all.map((_, i) => i + 1));
});

test('D161: one group a message of yours that holds an ask, the decisions before your first ask and those Sonah could not place apart', () => {
  const session = timedSession();
  const model = reportModel(session, timedReport(session), {});
  const groups = model.decisions.groups;
  assert.deepEqual(groups.map((g) => [g.key, g.asks, g.words, g.items.length]), [
    ['before', [], REPORT_TRAIL_WORDS.beforeAsks, 1],
    ['message:1', [1], REPORT_TRAIL_WORDS.afterAsks(1, 1), 3],
    ['message:2', [2], REPORT_TRAIL_WORDS.afterAsks(2, 2), 1],
    ['unplaced', [], REPORT_TRAIL_WORDS.unplaced, 1]]);
  // A group lists its message's asks with their status words, as your prompt marks them.
  const promptAsk = new Map(model.prompt.asks.map((a) => [a.n, a]));
  for (const g of groups) for (const a of g.askLines) assert.deepEqual([a.state, a.status], [promptAsk.get(a.n).state,
    promptAsk.get(a.n).status]);
  // Open by default exactly when it holds an item tagged Must act or Must know: the setup decision alone is Good to know.
  assert.deepEqual(groups.map((g) => g.open), [false, true, true, true]);
  assert.equal(groups[0].items[0].tier.final, 'good_to_know');
  assert.deepEqual(groups.map((g) => g.count), [REPORT_COUNT_WORDS.decisions(1, 0, 0),
    REPORT_COUNT_WORDS.decisions(3, 0, 2), REPORT_COUNT_WORDS.decisions(1, 0, 1), REPORT_COUNT_WORDS.decisions(1, 0, 1)]);
  // A decision whose instruction ties it to an ask says so on its line.
  const page = renderSessionPage(session, timedReport(session), {});
  const setup = groups[0].items[0];
  assert.deepEqual(setup.scope.asks, [1]);
  assert.match(page, new RegExp(`id="item-${setup.n}"><summary>[^\\n]*<a href="#ask-1">ask 1</a> · <span class="tag `
    + 'tier-tag">Good to know</span></summary>'));
  // The page opens the same groups, and so does the .md.
  assert.equal((page.match(/<details class="trail-group" open>/g) ?? []).length, 3);
  const md = renderReportMarkdown(session, timedReport(session), {});
  assert.equal((md.match(/^<details open><summary>/gm) ?? []).length, 3);
  for (const g of groups) assert.ok(md.includes(`${g.words} · ${g.count}</summary>`), g.key);
});

test('D161: the counts agree on the model, the page, the .md and the terminal', () => {
  for (const [session, report, options] of [[reportSession(), null, repoFacts()], [timedSession(), null, {}]]) {
    const rep = report ?? (session.events.some((e) => e.id === 'W0') ? timedReport(session) : triagedReport(session));
    const model = reportModel(session, rep, options);
    const words = REPORT_COUNT_WORDS.decisions(model.decisions.total, model.decisions.tagged.must_act,
      model.decisions.tagged.must_know);
    assert.equal(model.countLine.decisions.words, words);
    assert.equal(model.countLine.decisions.n, trailOf(model).length);
    assert.ok(countLines(model)[0].includes(` · ${words} · `), countLines(model)[0]);
    const page = renderSessionPage(session, rep, options);
    assert.ok(page.includes(`<a href="#decisions">${words}</a>`));
    assert.ok(page.includes(`${REPORT_TRAIL_WORDS.heading(model.decisions.total).replace(/'/g, '&#39;')}</h2>`));
    assert.equal((page.match(/<details class="item gtk trail-item/g) ?? []).length, model.decisions.total);
    const md = renderReportMarkdown(session, rep, options);
    assert.ok(md.includes(` · ${words} · `));
    assert.ok(md.includes(`### ${REPORT_TRAIL_WORDS.heading(model.decisions.total)}`));
    const trailMd = md.slice(md.indexOf("### The agent's decisions"));
    for (const item of trailOf(model)) assert.equal(trailMd.split(`<a name="item-${item.n}"></a>`).length - 1, 1);
  }
  // A report with no decision has no second part and no count of it.
  const b = sessionBuilder();
  b.ask('I1', 'Rename the helper.');
  b.change('W1', 'src/a.js', { after: 'export const b = 1;\n' });
  const s = b.session();
  const plain = { windowResults: [{ windowIndex: 0, eventIds: s.events.map((e) => e.id), failure: null }] };
  const none = reportModel(s, plain, {});
  assert.deepEqual([none.decisions.total, none.decisions.groups, none.countLine.decisions], [0, [], null]);
  assert.equal(renderSessionPage(s, plain, {}).includes('id="decisions"'), false);
  assert.equal(renderReportMarkdown(s, plain, {}).includes("The agent's decisions"), false);
});

test('D161: every pointer keeps its item after the renumbering — a question tied to a decision, files, runs, what the agent left out', () => {
  const session = reportSession();
  const report = triagedReport(session);
  // Q2 is routed from a finding anchored in src/limiter.js, the file the decision on how to do your ask wrote: tied.
  report.codePass.questions[1] = { ...report.codePass.questions[1], concerns: { key: 'S3', kind: 'decision',
    source: 'decisions', index: 2, id: report.decisions[2].id } };
  report.codePass.triage.push({ ref: { question: 'Q2' }, level: 'medium', impact: 'A preflight uses up the limit.',
    action: 'Decide whether preflights count.', label: 'decide on preflights', where: null });
  const model = reportModel(session, report, repoFacts());
  const chose = trailOf(model).find((item) => item.kind === 'decision_chose');
  const q2 = reportItems(model).find((item) => item.kind === 'code_question_finding');
  assert.ok(chose && q2);
  assert.ok(chose.n > Object.values(model.tiers).flat().length, 'numbered after the tiers');
  assert.deepEqual(q2.related.items, [chose.n]);
  assert.equal(chose.tier.final, 'must_know');
  assert.equal(chose.why, REPORT_TIER_WHY.tied(q2.n, 'Must know'));
  // The page holds that number once, inside the second part, and the question's links land there.
  const page = renderSessionPage(session, report, repoFacts());
  const trailPage = page.slice(page.indexOf('id="decisions"'), page.indexOf('id="prompt"'));
  assert.equal(page.split(`id="item-${chose.n}"`).length - 1, 1);
  assert.ok(trailPage.includes(`id="item-${chose.n}"`));
  // What the agent said it did not do names the decision not to act by its own number; every item number any list
  // names exists.
  const notActing = trailOf(model).find((item) => item.kind === 'decision_not_acting');
  assert.ok(model.did.leftOut.some((x) => x.item === notActing.n));
  const numbers = new Set(reportItems(model).map((item) => item.n));
  for (const n of [...model.did.files.groups.flatMap((g) => g.files.flatMap((f) => f.items)),
    ...model.did.runs.shown.map((run) => run.item).filter(Boolean), ...model.did.claims.shown.map((c) => c.item)
      .filter(Boolean), ...reportItems(model).flatMap((item) => item.related.items)]) assert.ok(numbers.has(n), `item ${n}`);
  for (const m of page.matchAll(/href="#item-(\d+)"/g)) assert.ok(page.includes(`id="item-${m[1]}"`), `item ${m[1]}`);
});

test('D161, amended by D163: a decision tagged Must act gets its prompt as any item in Must act of its kind, and Must act names it', () => {
  const session = reportSession();
  const report = triagedReport(session);
  const model = reportModel(session, report, repoFacts());
  const high = trailOf(model).find((item) => item.tier.final === 'must_act');
  assert.ok(high, 'the fixture\'s decision rated high');
  // D163: D144's rule for its kind (a decision's kind has no prompt in this cut: its closed reason); D161 gave it none.
  assert.deepEqual([high.agentPrompt, high.agentPromptNone], [null, 'kind_not_covered']);
  for (const item of trailOf(model)) assert.equal(item.agentPrompt, null);
  for (const item of trailOf(model).filter((x) => x.tier.final !== 'must_act')) assert.equal(item.agentPromptNone, null);
  const page = renderSessionPage(session, report, repoFacts());
  assert.equal(page.slice(page.indexOf('id="decisions"'), page.indexOf('id="prompt"')).includes('agent-prompt'), false);
  const md = renderReportMarkdown(session, report, repoFacts());
  assert.equal(md.slice(md.indexOf("### The agent's decisions"), md.indexOf('### Your prompt')).includes(
    'Prompt for the agent'), false);
  // D163: the count line's Must act counts it and its labels name it, after the first part's items.
  assert.equal(model.countLine.counts.must_act, model.tiers.must_act.length + 1);
  assert.deepEqual(model.pointers.must_act.map((p) => p.n), [high.n]);
  const named = [...model.tiers.must_act, high].map((item) => item.n);
  for (const label of model.countLine.labels) assert.ok(named.includes(label.n), `label ${label.n}`);
  assert.equal(model.countLine.labels.length + model.countLine.more, named.length);
});

test('D161: a question of the code review with no checked tie is at most Good to know; a tied one keeps its tier', () => {
  // The rule beside the table: the table and its version, which the code step's profile names, do not move.
  assert.deepEqual(UNTIED_TIER_RULE.ceilings, { code_question: 'good_to_know' });
  assert.equal(ITEM_KIND_TABLE.code_question.ceiling, null);
  for (const level of ['high', 'medium', 'low', null]) {
    const capped = boundTier('code_question', level, { untied: true });
    assert.equal(capped.final, 'good_to_know', String(level));
    assert.equal(capped.bound, level === 'low' ? null : UNTIED_TIER_RULE.bound, String(level));
    assert.deepEqual(boundTier('code_question', level, {}), boundTier('code_question', level, { untied: false }));
  }
  assert.equal(boundTier('code_question', 'high', {}).final, 'must_act');
  // Only the kinds the rule names: a question from a finding and every other kind ignore the flag.
  for (const kind of Object.keys(ITEM_KIND_TABLE).filter((k) => k !== 'code_question'))
    for (const level of ['high', null]) assert.deepEqual(boundTier(kind, level, { untied: true }), boundTier(kind, level),
      kind);
  // On the report: Q1 names no place (quote null), so no code checked its tie; proposed high, it stays in Good to know,
  // and its tier sentence says why.
  const session = reportSession();
  const report = triagedReport(session);
  report.codePass.triage.push({ ref: { question: 'Q1' }, level: 'high', impact: 'One client can use the whole limit.',
    action: 'Choose a limit per client.', label: 'choose the limit scope', where: null });
  const model = reportModel(session, report, repoFacts());
  const q1 = reportItems(model).find((item) => item.rows[0].source === 'codePass.questions' && item.rows[0].index === 0);
  assert.deepEqual([q1.tier.proposed, q1.tier.final, q1.tier.bound], ['must_act', 'good_to_know', 'untied_ceiling']);
  assert.equal(q1.why, REPORT_TIER_WHY.untied('high', 'Good to know'));
  assert.equal(q1.agentPrompt, null);
  // The same question quoting the decision's own statement shares its place: tied, so it keeps the tier proposed, as a
  // member of the decision's item; a member in Must act keeps that item in the first part, in Must act, with D144's
  // record (a decision's kind has no prompt: its closed reason).
  report.codePass.questions[0] = { ...report.codePass.questions[0], concerns: { key: 'S3', kind: 'decision',
    source: 'decisions', index: 2, id: report.decisions[2].id }, quote: report.decisions[2].stated };
  const tied = reportModel(session, report, repoFacts());
  const holderOf = (model) => reportItems(model).find((item) => item.members.some((m) => m.rows[0].source
    === 'codePass.questions' && m.rows[0].index === 0));
  const holder = holderOf(tied);
  const member = holder.members.find((m) => m.rows[0].index === 0);
  assert.deepEqual([member.tier.final, member.tier.bound], ['must_act', null]);
  assert.deepEqual([holder.kind, holder.tier.final], ['decision_chose', 'must_act']);
  assert.ok(tied.tiers.must_act.includes(holder));
  assert.equal(trailOf(tied).includes(holder), false);
  assert.deepEqual([holder.agentPrompt, holder.agentPromptNone], [null, 'kind_not_covered']);
  // D163: with the decision of the second part tagged Must act (the fixture's, rated high).
  assert.ok(countLines(tied)[0].startsWith(`Must act ${tied.tiers.must_act.length + tied.pointers.must_act.length} ·`));
  // Proposed low, the tied member is Good to know: the decision goes to the second part with it.
  report.codePass.triage.at(-1).level = 'low';
  const low = reportModel(session, report, repoFacts());
  assert.equal(holderOf(low).members[0].tier.final, 'good_to_know');
  assert.ok(trailOf(low).includes(holderOf(low)));
  // A question with no `concerns` at all names no row, so nothing ties it: proposed high, it is Good to know.
  const bare = triagedReport(session);
  const { concerns: _gone, ...q3 } = bare.codePass.questions[2];
  bare.codePass.questions[2] = { ...q3, check: { verdict: 'sound', explanation: 'SYNTHETIC checked.' } };
  bare.codePass.triage.push({ ref: { question: bare.codePass.questions[2].id }, level: 'high', impact: 'x.',
    action: 'y.', label: 'z', where: null });
  const q3item = reportItems(reportModel(session, bare, repoFacts())).find((item) => item.rows[0].source
    === 'codePass.questions' && item.rows[0].index === 2);
  assert.deepEqual([q3item.tier.proposed, q3item.tier.final, q3item.tier.bound], ['must_act', 'good_to_know',
    'untied_ceiling']);
});

test('D161 (its review): the .md shortens lowest tier first across both parts; a decision tagged Must know keeps its line', () => {
  const b = sessionBuilder();
  b.ask('I1', 'Add a cache to the client.');
  b.change('W1', 'src/cache.js', { after: 'export const cache = new Map();\n' });
  b.say('F1', 'Done.', 'final');
  const session = b.session();
  const long = (k) => `${'word '.repeat(40)}${k}`;
  const report = { ...timedReportBase(session), decisions: [
    decided({ id: id('f'), dimension: 'server', chosen: 'none', column: 'unasked', actions: ['W1'] }),
    ...Array.from({ length: 400 }, (_, k) => decided({ id: `sha256:${String(k).padStart(64, '0')}`, dimension: long(k),
      chosen: long(k), actions: ['W1'], column: 'asked-chose', constrainedBy: { instruction: r('instruction', 'I1',
        'Add a cache to the client.'), settles: false, settledValueQuote: null } }))] };
  const model = reportModel(session, report, {});
  assert.deepEqual([model.decisions.total, model.decisions.tagged.must_know], [401, 1]);
  const must = trailOf(model).find((item) => item.tier.final === 'must_know');
  const md = renderReportMarkdown(session, report, {});
  assert.ok(md.includes('Sonah shortened this report'));
  assert.ok(md.includes(' · 401 decisions (1 Must know) · '));
  // The Must know decision keeps its anchor and line; the 400 tagged Good to know are counted in their group.
  assert.equal(md.split(`<a name="item-${must.n}"></a>`).length - 1, 1);
  assert.ok(md.includes(REPORT_TRAIL_WORDS.goodToKnowNotShown(400)));
  // The page shows that line too.
  const page = renderSessionPage(session, report, {});
  assert.ok(page.includes(`id="item-${must.n}"`));
});

test('D161 (its review): with no message that holds an ask, no group says "Before your first ask"', () => {
  const session = timedSession();
  const report = { ...timedReport(session), requirements: [] };
  const model = reportModel(session, report, {});
  assert.deepEqual(model.prompt.asks, []);
  assert.deepEqual(model.decisions.groups.map((g) => [g.key, g.words]), [['all', REPORT_TRAIL_WORDS.inOrder],
    ['unplaced', REPORT_TRAIL_WORDS.unplaced]]);
  for (const text of [renderReportMarkdown(session, report, {}), renderSessionPage(session, report, {})])
    assert.equal(text.includes(REPORT_TRAIL_WORDS.beforeAsks), false);
});
