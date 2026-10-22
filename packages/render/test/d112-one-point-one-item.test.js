// E1-F8 (D112, owner 2026-10-17: "go for C and E"): one point, one item. The invariants of FIXES-GLOBAL F8 as tests, on
// synthetic sessions only (report-fixture.js, session-story-fixture.js): a question the code review wrote is shown inside
// the item of the row it concerns, at the higher of the two tiers; (D112 amended, 2026-10-18) two decisions whose stated
// quotes nest stay two items; inside each section the items come by final level (high, medium, low, then none), then by
// kind; (D122 (b), the beta.5 integration) a passed-over call defaults to Must know whatever its call: the refused-read
// default is removed. Nothing is dropped, no row sits below the tier it has alone, no member is lifted, and the same
// input gives the same bytes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as reportModelModule from '../report-model.js';
import { reportModel, reportPlacement, itemVisibleText } from '../report-model.js';
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
      // No group lifts a member: it keeps its own tier, and is folded when that tier is below the item's.
      assert.equal(m.folded, RANK[m.tier.final] < RANK[item.tier.final], `${label} ${item.n}`);
      assert.ok(REPORT_GROUP_TIES.includes(m.tie), `${label}: a closed tie`);
      // D112 amended (its nested join removed; D122): a member is only a question of the code review.
      assert.equal(m.kind, 'code_question', `${label} item ${item.n}: a member is a question`);
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
  // What the agent said it did not do lists each decision not to act by its own item, once (D122: no member is one).
  const notActing = items.filter((item) => item.kind === 'decision_not_acting').map((item) => item.n);
  for (const row of model.did.leftOut) assert.ok(notActing.includes(row.item), `${label}: listed by its own item`);
  assert.equal(new Set(model.did.leftOut.map((row) => row.item)).size, model.did.leftOut.length, `${label}: once`);
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
  // D116: it points to the ask only where code checked the tie (its own place overlaps the ask's): with no quote it
  // names no place, so no pointer; quoting your words of the ask, it points to the ask, as before.
  assert.deepEqual(own(2).where.map((w) => w.anchor), []);
  report.codePass.questions[2] = { ...report.codePass.questions[2], quote: receipt('instruction', 'I1',
    'Return 429 with a Retry-After header in seconds.') };
  const quoted = reportModel(session, report, repoFacts());
  assert.deepEqual(itemsOf(quoted).find((item) => item.rows[0].source === 'codePass.questions'
    && item.rows[0].index === 2).where.map((w) => w.anchor), ['ask-1']);
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

test('D112 amended (2026-10-18): two decisions whose stated quotes nest on one event stay two items; nothing joins them',
  () => {
  // The owner (2026-10-18): D112's nested-decision join is removed.
  const session = decisionsSession();
  const decisions = [
    decided({ id: id('1'), dimension: 'store', chosen: 'no Redis', notActing: true,
      stated: receipt('commentary', 'C1', 'I will not add Redis or any server.') }),
    decided({ id: id('2'), dimension: 'cache', chosen: 'an in-process cache',
      stated: receipt('commentary', 'C1', 'An in-process cache is enough, so I will not add Redis or any server.') }),
    decided({ id: id('3'), dimension: 'store again', chosen: 'no Redis', notActing: true,
      stated: receipt('commentary', 'C2', 'I will not add Redis or any server.') }),
    decided({ id: id('4'), dimension: 'servers', chosen: 'none', stated: receipt('commentary', 'C1', 'An in-process cache') }),
  ];
  assert.ok(nestedReceipts(decisions[0].stated, decisions[1].stated), 'the first quote lies inside the second');
  assert.ok(nestedReceipts(decisions[3].stated, decisions[1].stated), 'so does the fourth');
  const report = decisionsReport(session, decisions);
  const model = reportModel(session, report, {});
  // Each decision is an item of its own, with no member; every row is placed as its own item.
  assert.equal(itemsOf(model).length, 4);
  for (const item of itemsOf(model)) assert.deepEqual([item.rows.length, item.members.length], [1, 0]);
  const placement = reportPlacement(model);
  for (const index of [0, 1, 2, 3]) {
    const own = itemsOf(model).find((item) => holds(item, 'decisions', index));
    assert.deepEqual(placement[`decisions:${index}`], { item: own.n });
  }
  // The decision not to act is listed under what the agent said it did not do, by its own item.
  const notActing = itemsOf(model).find((item) => holds(item, 'decisions', 0));
  assert.ok(model.did.leftOut.some((x) => x.item === notActing.n && x.quote.text === 'I will not add Redis or any server.'));
  assertInvariants(model, 'nested decisions');
});

test('D112 amended (2026-10-18): a decision cut from the same sentence as a decision not to act keeps its own tier', () => {
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
  const of = (kind) => itemsOf(model).find((item) => item.kind === kind);
  assert.equal(itemsOf(model).length, 2);
  // Nothing lifts the "you asked" decision: it stays in Good to know, by its own default.
  assert.deepEqual([of('decision_chose').own.final, of('decision_chose').tier.final, of('decision_chose').tier.from],
    ['good_to_know', 'good_to_know', 'lead']);
  assert.ok(model.tiers.must_know.includes(of('decision_not_acting')));
});

// ---- (3) the order inside a section --------------------------------------------------------------------------------

test('D112 (3): inside each section, items come by final level (high, medium, low, then none), then by kind', () => {
  const model = reportModel(reportSession(), triagedReport(reportSession()), repoFacts());
  const order = (tier) => model.tiers[tier].map((item) => [item.kind, item.tier.proposed]);
  // Must act: the two items the code review rated high, then the unrated ones; D138: among those, the two backed by two
  // recorded quotes that disagree first, then by kind.
  assert.deepEqual(order('must_act').slice(0, 5), [['code_bug', 'must_act'], ['decision_unasked', 'must_act'],
    ['claim_contradicted', null], ['edit_against_instruction', null], ['ask_not_done', null]]);
  // Must know: rated high (held at Must know by a ceiling), then medium, then low (lifted by a floor), then none.
  const levels = model.tiers.must_know.map((item) => levelRank(item.tier));
  // D122 (b): the fixture's refused read, a failure passed over, is unrated Must know (no refused-read default).
  assert.deepEqual(levels, [0, 0, 0, 0, 1, 1, 2, 3, 3, 3, 3, 3]);
  assert.deepEqual(order('must_know').slice(6, 7), [['code_bug', 'good_to_know']], 'the floored bug follows the rated');
  // Good to know: the low-rated weak test before the unrated items.
  assert.deepEqual(order('good_to_know')[0], ['code_weak_test', 'good_to_know']);
});

// ---- (4) default tiers: D112's refused-read default, removed at the beta.5 integration (D122 (b)) --------------------

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

test('D122 (b): a passed-over call defaults to Must know whatever its call — a refused read, a read a rule refused, a '
  + 'command typed as a search, a refused command or write, a read that failed or was stopped', () => {
  const session = failuresSession();
  const report = { ...decisionsReport(session, [
    decided({ id: id('9'), dimension: 'tests', chosen: 'no new test', notActing: true,
      stated: receipt('commentary', 'F1', 'Done.') })]),
  failures: ['X1', 'X2', 'X3', 'X4', 'X5', 'X6', 'X7'].map((x) => failureRow(x)) };
  // The rule and its reader are gone.
  assert.equal(reportModelModule.refusedRead, undefined);
  assert.equal(Object.hasOwn(REPORT_TIER_WHY, 'refusedRead'), false);
  const model = reportModel(session, report, {});
  const tierOf = (index) => itemsOf(model).find((item) => holds(item, 'failures', index));
  assert.deepEqual([0, 1, 2, 3, 4, 5, 6].map((i) => tierOf(i).tier.final), Array(7).fill('must_know'));
  for (const i of [0, 1, 2, 3, 4, 5, 6])
    assert.equal(tierOf(i).why, REPORT_TIER_WHY.byDefault(REPORT_KIND_WORDS.failure_passed_over, 'Must know'), String(i));
  // A decision not to act stays in Must know.
  assert.equal(itemsOf(model).find((item) => item.kind === 'decision_not_acting').tier.final, 'must_know');
  // The code review's level still moves a refused read, inside its bounds.
  const rated = { ...report, codePass: { ran: true, findings: [], questions: [], withheld: [], files: [], footer: [],
    triage: [{ ref: { source: 'failures', index: 0, id: null }, level: 'low', impact: 'It may matter.',
      action: 'Read the file.', label: 'read the file', where: null }] } };
  const moved = itemsOf(reportModel(session, rated, {})).find((item) => holds(item, 'failures', 0));
  assert.deepEqual([moved.tier.default, moved.tier.proposed, moved.tier.final], ['must_know', 'good_to_know',
    'good_to_know']);
  assert.deepEqual(boundTier('failure_passed_over', null, { refusedRead: true }).final, 'must_know');
});
