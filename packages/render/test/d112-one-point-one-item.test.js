// E1-F8 (D112, owner 2026-10-17: "go for C and E"): one point, one item. The invariants of FIXES-GLOBAL F8 as tests, on
// synthetic sessions only (report-fixture.js, session-story-fixture.js): a question the code review wrote is shown inside
// the item of the row it concerns, at the higher of the two tiers; two decisions whose stated quotes nest are one item,
// led by the longer quote; inside each section the items come by final level (high, medium, low, then none), then by
// kind; a passed-over call defaults to Good to know only when the recorder typed it as a refused read. Nothing is
// dropped, no row sits below the tier it has alone, no member is lifted, and the same input gives the same bytes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { reportModel, reportPlacement, refusedRead, itemVisibleText } from '../report-model.js';
import { renderSessionPage } from '../session-page.js';
import { renderReportMarkdown } from '../session-story.js';
import { REPORT_TIER_WHY, REPORT_ITEM_WORDS, REPORT_KIND_WORDS, REPORT_TIER_WORDS } from '../report-words.js';
import { boundTier } from '../../evidence/src/triage.js';
import { REPORT_GROUP_TIES, REPORT_TIER_SOURCES, nestedReceipts } from '../../evidence/src/ledger.js';
import { REPORT_SHAPES, reportSession, triagedReport, repoFacts } from './report-fixture.js';
import { sessionBuilder, STORY_KEY } from './session-story-fixture.js';

const TIERS = ['must_act', 'must_know', 'good_to_know'];
const RANK = { good_to_know: 0, must_know: 1, must_act: 2 };
const itemsOf = (model) => TIERS.flatMap((tier) => model.tiers[tier]);
const textOf = (parts) => parts.map((p) => (p.quote ? `“${p.text}”${p.cut ? '…' : ''}` : p.text)).join('');
const holds = (entry, source, index) => entry.rows.some((r) => r.source === source && r.index === index);
const receipt = (role, eventId, quote) => ({ role, eventId, quote, sessionKey: STORY_KEY });
const id = (c) => `sha256:${c.repeat(64).slice(0, 64)}`;
/** A final level's rank for the order (high, medium, low, then none), from a tier record. */
const LEVEL = { must_act: 0, must_know: 1, good_to_know: 2 };
const levelRank = (tier) => (tier.proposed === null ? 3 : LEVEL[tier.proposed]);

// ---- the invariants on every fixture shape ------------------------------------------------------------------------

/** Each invariant of D112 that code checks on every review, on one model. */
function assertInvariants(model, label) {
  const items = itemsOf(model);
  for (const item of items) {
    // No group lowers a row: the item is at or above its lead's own tier and every member's.
    assert.ok(RANK[item.tier.final] >= RANK[item.own.final], `${label} item ${item.n}: not below its lead`);
    for (const m of item.members) {
      assert.ok(RANK[item.tier.final] >= RANK[m.tier.final], `${label} item ${item.n}: not below a member`);
      // No group lifts a member: it keeps its own tier, and is folded when that tier is below the item's or it repeats
      // the lead.
      assert.equal(m.folded, m.tie === 'nested' || RANK[m.tier.final] < RANK[item.tier.final], `${label} ${item.n}`);
      assert.ok(REPORT_GROUP_TIES.includes(m.tie), `${label}: a closed tie`);
      // A member's rows are the item's too.
      for (const r of m.rows) assert.ok(holds(item, r.source, r.index), `${label} item ${item.n} holds ${r.source}:${r.index}`);
    }
    // The item takes the higher tier: from its lead, unless a member's own tier is higher.
    assert.ok(REPORT_TIER_SOURCES.includes(item.tier.from), label);
    const top = Math.max(RANK[item.own.final], ...item.members.map((m) => RANK[m.tier.final]));
    assert.equal(RANK[item.tier.final], top, `${label} item ${item.n}: the highest of its rows`);
    assert.equal(item.tier.from === 'member', RANK[item.own.final] < top, `${label} item ${item.n}: from`);
  }
  // Inside each section: by final level first, then as before.
  for (const tier of TIERS) {
    const levels = model.tiers[tier].map((item) => Math.min(...[item, ...item.members]
      .filter((x) => x.tier.final === item.tier.final).map((x) => levelRank(x.tier))));
    assert.deepEqual(levels, [...levels].sort((a, b) => a - b), `${label} ${tier}: by final level`);
  }
  // One anchor, one item: no row in two items, and no two items joined by a checked tie.
  const held = items.flatMap((item) => item.rows.map((r) => `${r.source}:${r.index}`));
  assert.equal(new Set(held).size, held.length, `${label}: no row in two items`);
  const placement = reportPlacement(model);
  for (const [key, place] of Object.entries(placement)) if (place.memberOf)
    assert.ok(items.find((item) => item.n === place.memberOf).members.some((m) => `${m.rows[0].source}:${m.rows[0].index}`
      === key), `${label} ${key}: a member of its item`);
}

test('D112: every invariant holds on every fixture shape, with and without the repository\'s facts', () => {
  for (const [letter, shape] of Object.entries(REPORT_SHAPES)) {
    const session = reportSession();
    const report = shape(session);
    assertInvariants(reportModel(session, report, repoFacts()), letter);
    assertInvariants(reportModel(session, report, {}), `${letter} without facts`);
  }
});

test('D112: the same stored state gives the same model bytes, page bytes and .md bytes', () => {
  const once = () => { const session = reportSession(); const report = triagedReport(session);
    return [JSON.stringify(reportModel(session, report, repoFacts())), renderSessionPage(session, report, repoFacts()),
      renderReportMarkdown(session, report, repoFacts())]; };
  assert.deepEqual(once(), once());
});

// ---- (1) a question of the code review inside the item it concerns ------------------------------------------------

test('D112 (1): a question the code review wrote joins the item of the row it concerns, with its lines, at the higher tier', () => {
  const session = reportSession();
  const report = triagedReport(session);
  // Q1 concerns decisions[3] (Sonah could not check whether you asked: Good to know); its check ran (Must know). Its own
  // triage entry gives it an impact and an action. D112 amended: its quote is the code that the decision's edit wrote
  // (W2, an action of the decision), so the two name one place.
  report.codePass.questions[0] = { ...report.codePass.questions[0], quote: receipt('code', 'W2', 'app.use(limiter(10));') };
  report.codePass.triage.push({ ref: { question: 'Q1' }, level: 'medium', impact: 'One client can use the whole limit.',
    action: 'Choose a limit per client.', label: 'choose the limit scope', where: null });
  const model = reportModel(session, report, repoFacts());
  assert.equal(itemsOf(model).some((item) => item.rows[0].source === 'codePass.questions' && item.rows[0].index === 0),
    false, 'not an item of its own');
  const item = itemsOf(model).find((x) => holds(x, 'decisions', 3));
  assert.deepEqual(item.rows[0], { source: 'decisions', index: 3 }, 'the decision leads');
  const [question] = item.members;
  assert.deepEqual([question.kind, question.tie, question.rows], ['code_question', 'concerns',
    [{ source: 'codePass.questions', index: 0 }]]);
  assert.deepEqual(reportPlacement(model)['codePass.questions:0'], { memberOf: item.n });
  // The higher of the two tiers: the decision alone is Good to know, the question Must know.
  assert.deepEqual([item.own.final, question.tier.final, item.tier.final, item.tier.from],
    ['good_to_know', 'must_know', 'must_know', 'member']);
  assert.equal(item.why, REPORT_TIER_WHY.held(REPORT_KIND_WORDS.code_question, 'Must know'));
  assert.equal(question.why, 'The code review proposed medium, and Sonah kept it.');
  // Its question, its impact and action, and its check, inside the item, open (its tier is the item's).
  assert.equal(question.folded, false);
  assert.equal(textOf(question.what.parts), 'Should the limit be per client or global? The ask does not say.');
  assert.deepEqual([textOf(question.impact), textOf(question.action)], ['One client can use the whole limit.',
    'Choose a limit per client.']);
  assert.ok(question.evidence.some((e) => e.label === REPORT_ITEM_WORDS.check
    && textOf(e.parts) === 'The code keeps one global counter.'));
  assert.deepEqual(question.where, [], 'it names no item: it is inside its own');
  const visible = itemVisibleText(item);
  for (const line of [REPORT_ITEM_WORDS.members(1), 'Decide: Should the limit be per client or global? The ask does not say. · '
    + 'Must know', 'Impact on you: One client can use the whole limit.', 'Action: Choose a limit per client.'])
    assert.ok(visible.includes(line), line);
  // Every reader shows it, inside the item.
  const page = renderSessionPage(session, report, repoFacts());
  const at = page.indexOf(`id="item-${item.n}"`);
  const block = page.slice(at, page.indexOf('</article>', at));
  for (const text of ['Should the limit be per client or global? The ask does not say.', 'One client can use the whole limit.',
    'Choose a limit per client.', 'The code keeps one global counter.', REPORT_ITEM_WORDS.members(1)])
    assert.ok(block.includes(text), text);
  const md = renderReportMarkdown(session, report, repoFacts());
  const mdAt = md.indexOf(`<a name="item-${item.n}"></a>`);
  const mdBlock = md.slice(mdAt, md.indexOf('<a name="item-', mdAt + 1));
  for (const text of ['*Should the limit be per client or global? The ask does not say.*', '*One client can use the whole limit.*',
    '*Choose a limit per client.*', '*The code keeps one global counter.*']) assert.ok(mdBlock.includes(text), text);
});

test('D112 (1): a member whose own tier is below its item\'s is shown folded, under its own tier word', () => {
  const session = reportSession();
  const report = triagedReport(session);
  // Q1 with no check (Good to know) on the decision not to act (Must know), quoting its statement (one place).
  report.codePass.questions[0] = { ...report.codePass.questions[0], concerns: { key: 'S10', kind: 'decision',
    source: 'decisions', index: 0, id: report.decisions[0].id }, quote: receipt('commentary', 'C1', 'I will not add Redis'),
  check: undefined };
  delete report.codePass.questions[0].check;
  const model = reportModel(session, report, repoFacts());
  const item = itemsOf(model).find((x) => holds(x, 'decisions', 0));
  const [question] = item.members;
  assert.deepEqual([item.tier.final, item.tier.from, question.tier.final, question.folded],
    ['must_know', 'lead', 'good_to_know', true]);
  assert.equal(question.why, REPORT_TIER_WHY.byDefault(REPORT_KIND_WORDS.code_question, 'Good to know'));
  const page = renderSessionPage(session, report, repoFacts());
  const at = page.indexOf(`id="item-${item.n}"`);
  assert.match(page.slice(at, page.indexOf('</article>', at)), /<details class="member"><summary><strong class="type">Decide:<\/strong> <em class="by-code-review">Should the limit be per client or global\? The ask does not say\.<\/em> · <span class="tier-word">Good to know<\/span><\/summary>/);
  // Its item's visible text shows its head alone.
  assert.ok(itemVisibleText(item).endsWith('Decide: Should the limit be per client or global? The ask does not say. · Good to know'));
});

test('D112 (1): a question on an ask, one routed from a finding, and one whose row no item holds stay items of their own', () => {
  const session = reportSession();
  const report = triagedReport(session);
  // Q3 concerns an ask (requirements[0]); Q2 is routed from a finding; a fourth question concerns a decision you settled
  // (decisions[4]: a list row, no item).
  report.codePass.questions[1] = { ...report.codePass.questions[1], concerns: { key: 'S12', kind: 'decision',
    source: 'decisions', index: 3, id: report.decisions[3].id } };
  // Q1 names the decision's place (its edit W2), so it joins; every other question stays its own item.
  report.codePass.questions[0] = { ...report.codePass.questions[0], quote: receipt('code', 'W2', 'app.use(limiter(10));') };
  report.codePass.questions.push({ id: 'Q4', question: 'Is auth first the order you want?', from: 'review',
    concerns: { key: 'S14', kind: 'decision', source: 'decisions', index: 4, id: report.decisions[4].id }, quote: null,
    check: { verdict: 'sound', explanation: 'It is first.' } });
  // A fifth on an ask that is an item (ask 6, not done): your prompt shows its line, so it stays an item too.
  report.codePass.questions.push({ id: 'Q5', question: 'Should the test cover a burst?', from: 'review',
    concerns: { key: 'S6', kind: 'ask', source: 'requirements', index: 5, id: null }, quote: null,
    check: { verdict: 'sound', explanation: 'No test exists.' } });
  const model = reportModel(session, report, repoFacts());
  const own = (index) => itemsOf(model).find((item) => item.rows[0].source === 'codePass.questions'
    && item.rows[0].index === index);
  for (const index of [1, 2, 3, 4]) assert.ok(own(index), `question ${index} is an item of its own`);
  assert.ok(itemsOf(model).some((item) => item.kind === 'ask_not_done' && holds(item, 'requirements', 5)
    && !item.members.length), 'the ask\'s item has no member');
  assert.deepEqual(reportPlacement(model)['codePass.questions:2'], { item: own(2).n });
  // The question on an ask still points to the ask, as before.
  assert.deepEqual(own(2).where.map((w) => w.anchor), ['ask-1']);
  // Only the question the code review wrote on an item's row joined it.
  const decision = itemsOf(model).find((x) => holds(x, 'decisions', 3));
  assert.deepEqual(decision.members.map((m) => m.rows[0]), [{ source: 'codePass.questions', index: 0 }]);
});

// ---- (2) two decisions with nested stated quotes ------------------------------------------------------------------

function decisionsSession() {
  const b = sessionBuilder();
  b.ask('I1', 'Add a cache to the client.');
  b.say('C1', 'I will not add Redis. An in-process cache is enough, so I will not add Redis or any server.');
  b.say('C2', 'Again: I will not add Redis or any server.');
  b.change('W1', 'src/cache.js', { after: 'export const cache = new Map();\n' });
  b.say('F1', 'Done.', 'final');
  return b.session();
}
const decided = (fields) => ({ actorSession: STORY_KEY, dimension: 'store', chosen: 'a store', value: null,
  valueReceipt: null, valueState: 'unchecked', actions: [], stated: null, constrainedBy: null, instructionReview: null,
  column: 'unasked', columnState: 'grounded', amends: [], materiality: 'structural', materialityRule: 'synthetic',
  relevance: 'unchecked', reasons: [], ...fields });
function decisionsReport(session, decisions) {
  return { reviewScope: 'session-only', coverage: 'complete', sessionReview: 'complete', windowResults: [{ windowIndex: 0,
    eventIds: session.events.map((e) => e.id), failure: null, challenge: { complete: true }, groundingComplete: true }],
  requirements: [], decisions };
}

test('D112 (2): two decisions whose stated quotes nest on one event are one item, led by the longer quote', () => {
  const session = decisionsSession();
  const short = 'I will not add Redis.';
  const long = 'An in-process cache is enough, so I will not add Redis or any server.';
  const decisions = [
    decided({ id: id('1'), dimension: 'store', chosen: 'no Redis', notActing: true, stated: receipt('commentary', 'C1', short) }),
    decided({ id: id('2'), dimension: 'cache', chosen: 'an in-process cache', stated: receipt('commentary', 'C1', long) }),
    // The same words on another event: not the same place, so not the same point.
    decided({ id: id('3'), dimension: 'store again', chosen: 'no Redis', notActing: true,
      stated: receipt('commentary', 'C2', 'I will not add Redis or any server.') }),
    // Another sentence of the first event that nests in neither: its own item.
    decided({ id: id('4'), dimension: 'servers', chosen: 'none', stated: receipt('commentary', 'C1', 'An in-process cache') }),
  ];
  assert.equal(nestedReceipts(decisions[0].stated, decisions[1].stated), false, 'the two sentences do not nest');
  // The first decision's quote lies inside the second's: make it so.
  decisions[0] = { ...decisions[0], stated: receipt('commentary', 'C1', 'I will not add Redis or any server.') };
  assert.ok(nestedReceipts(decisions[0].stated, decisions[1].stated));
  const report = decisionsReport(session, decisions);
  const model = reportModel(session, report, {});
  const lead = itemsOf(model).find((item) => holds(item, 'decisions', 1));
  assert.deepEqual(lead.rows[0], { source: 'decisions', index: 1 }, 'the longer quote leads');
  assert.deepEqual(lead.members.map((m) => [m.rows[0].index, m.tie, m.folded]), [[0, 'nested', true],
    [3, 'nested', true]], 'decision 4\'s quote lies inside the lead\'s too');
  assert.deepEqual(reportPlacement(model)['decisions:0'], { memberOf: lead.n });
  assert.deepEqual(reportPlacement(model)['decisions:1'], { item: lead.n });
  // Another event's decision stays its own item.
  assert.deepEqual(reportPlacement(model)['decisions:2'], { item: itemsOf(model).find((x) => holds(x, 'decisions', 2)).n });
  // Shown once: one item; the member's own lines are folded inside it, never dropped.
  assert.equal(itemsOf(model).length, 2);
  // The member decision not to act is still listed under what the agent said it did not do, by its item.
  assert.ok(model.did.leftOut.some((x) => x.item === lead.n && x.quote.text === 'I will not add Redis or any server.'));
  // The item takes the higher tier: the decision not to act (Must know) over the lead (Must know): from the lead.
  assert.deepEqual([lead.tier.final, lead.tier.from], ['must_know', 'lead']);
  const md = renderReportMarkdown(session, report, {});
  assert.ok(md.includes('<details><summary>Decide: The agent decided not to act. About: <em>store</em>. Its decision: '
    + '<em>no Redis</em>. · Must know</summary>'), md);
});

test('D112 (2): a member of a higher tier than the longer quote\'s lifts the item, and the item says why', () => {
  const session = decisionsSession();
  const report = decisionsReport(session, [
    // The longer quote: you asked, the agent decided how (Good to know).
    decided({ id: id('1'), dimension: 'cache', chosen: 'a Map', column: 'asked-chose',
      stated: receipt('commentary', 'C1', 'An in-process cache is enough, so I will not add Redis or any server.'),
      constrainedBy: { instruction: receipt('instruction', 'I1', 'Add a cache to the client.'), settles: false,
        settledValueQuote: null } }),
    // The shorter: a decision not to act (Must know).
    decided({ id: id('2'), dimension: 'store', chosen: 'no Redis', notActing: true,
      stated: receipt('commentary', 'C1', 'I will not add Redis or any server.') }),
  ]);
  const model = reportModel(session, report, {});
  const [item] = itemsOf(model);
  assert.equal(itemsOf(model).length, 1);
  assert.deepEqual([item.kind, item.own.final, item.tier.final, item.tier.from], ['decision_chose', 'good_to_know',
    'must_know', 'member']);
  assert.equal(item.why, REPORT_TIER_WHY.held(REPORT_KIND_WORDS.decision_not_acting, 'Must know'));
  assert.ok(model.tiers.must_know.includes(item));
});

// ---- (3) the order inside a section --------------------------------------------------------------------------------

test('D112 (3): inside each section, items come by final level (high, medium, low, then none), then by kind', () => {
  const model = reportModel(reportSession(), triagedReport(reportSession()), repoFacts());
  const order = (tier) => model.tiers[tier].map((item) => [item.kind, item.tier.proposed]);
  // Must act: the two items the code review rated high, then the unrated ones by kind.
  assert.deepEqual(order('must_act').slice(0, 3), [['code_bug', 'must_act'], ['decision_unasked', 'must_act'],
    ['ask_not_done', null]]);
  // Must know: rated high (held at Must know by a ceiling), then medium, then low (lifted by a floor), then none.
  const levels = model.tiers.must_know.map((item) => levelRank(item.tier));
  assert.deepEqual(levels, [0, 0, 0, 0, 1, 1, 2, 3, 3, 3, 3]);
  assert.deepEqual(order('must_know').slice(6, 7), [['code_bug', 'good_to_know']], 'the floored bug follows the rated');
  // Good to know: the low-rated weak test before the unrated items.
  assert.deepEqual(order('good_to_know')[0], ['code_weak_test', 'good_to_know']);
});

// ---- (4) default tiers from recorder-typed operations ---------------------------------------------------------------

/** A call and its terminal result, as the adapter spells them (`recorded`: the recorder's typed facts on the call). */
function call(b, callId, { tool, operation = 'other', command = null, recorded = null, result = 'failed' }) {
  const put = (text) => { const key = `${callId}-c`; b.blobs[key] = text;
    return [{ sourceKey: key, fromByte: 0, untilByte: Buffer.byteLength(text, 'utf8') }]; };
  b.events.push({ sequence: b.events.length, id: callId, kind: 'invocation', callKey: callId, tool, operation,
    paths: [], command: command === null ? [] : put(command), input: [], changes: [], ...(recorded ? { recorded } : {}) });
  b.events.push({ sequence: b.events.length, id: `${callId}-r`, kind: 'observation', invocation: callId, callKey: callId,
    phase: 'terminal', result, exitCode: null, terminalStatusProven: false, output: [], sourceOfResult: 'native' });
}
function failuresSession() {
  const b = sessionBuilder();
  b.ask('I1', 'Fix the parser.');
  call(b, 'X1', { tool: 'read', recorded: { denial: 'user-rejected' } });                     // a refused read
  call(b, 'X2', { tool: 'read', recorded: { denial: 'permission-rule' } });                   // a read a rule refused
  call(b, 'X3', { tool: 'bash', operation: 'command', command: 'cat src/parser.js', recorded: { denial: 'user-rejected' } });
  call(b, 'X4', { tool: 'edit', operation: 'edit', recorded: { denial: 'user-rejected' } }); // a refused write
  call(b, 'X5', { tool: 'read' });                                                           // a read that failed
  call(b, 'X6', { tool: 'read', recorded: { denial: 'interrupted' } });                      // a read stopped
  // A command the recorder typed as only reading (a Codex `parsed_cmd`), refused: no read by tool, a read by type.
  call(b, 'X7', { tool: 'bash', operation: 'command', command: 'rg parser', recorded: { denial: 'user-rejected',
    parsedCmd: [{ type: 'search' }] } });
  b.say('F1', 'Done.', 'final');
  return b.session();
}
const failureRow = (callId, outcome = 'did-not-run') => ({ eventId: `${callId}-r`, action: callId, outcome, form: 'denial',
  tool: 'read', handling: 'passed-over' });

test('D112 (4): a passed-over call defaults to Good to know only when the recorder typed it as a refused read', () => {
  const session = failuresSession();
  const report = { ...decisionsReport(session, [
    decided({ id: id('9'), dimension: 'tests', chosen: 'no new test', notActing: true,
      stated: receipt('commentary', 'F1', 'Done.') })]),
  failures: ['X1', 'X2', 'X3', 'X4', 'X5', 'X6', 'X7'].map((x) => failureRow(x)) };
  assert.deepEqual(['X1', 'X2', 'X3', 'X4', 'X5', 'X6', 'X7'].map((x) => refusedRead(session, failureRow(x))),
    [true, true, false, false, false, false, true]);
  const model = reportModel(session, report, {});
  const tierOf = (index) => itemsOf(model).find((item) => holds(item, 'failures', index));
  assert.deepEqual([0, 1, 2, 3, 4, 5, 6].map((i) => tierOf(i).tier.final), ['good_to_know', 'good_to_know', 'must_know',
    'must_know', 'must_know', 'must_know', 'good_to_know']);
  assert.equal(tierOf(0).why, REPORT_TIER_WHY.refusedRead('Good to know'));
  assert.equal(tierOf(2).why, REPORT_TIER_WHY.byDefault(REPORT_KIND_WORDS.failure_passed_over, 'Must know'));
  // A decision not to act stays in Must know.
  assert.equal(itemsOf(model).find((item) => item.kind === 'decision_not_acting').tier.final, 'must_know');
  // The code review's level still moves a refused read, inside its bounds.
  const rated = { ...report, codePass: { ran: true, findings: [], questions: [], withheld: [], files: [], footer: [],
    triage: [{ ref: { source: 'failures', index: 0, id: null }, level: 'medium', impact: 'It may matter.',
      action: 'Read the file.', label: 'read the file', where: null }] } };
  const moved = itemsOf(reportModel(session, rated, {})).find((item) => holds(item, 'failures', 0));
  assert.deepEqual([moved.tier.default, moved.tier.proposed, moved.tier.final], ['good_to_know', 'must_know', 'must_know']);
  // A row that is no failure the agent handled, or names no call the session holds, is none.
  assert.equal(refusedRead(session, { ...failureRow('X1'), handling: undefined }), false);
  assert.equal(refusedRead(session, { eventId: 'nope-r', action: 'nope', handling: 'passed-over' }), false);
  assert.deepEqual(boundTier('failure_passed_over', null, { refusedRead: true }).final, 'good_to_know');
});
