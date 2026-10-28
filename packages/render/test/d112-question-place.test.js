// D112 amended (2026-10-18; the owner: "go for fix first"): the truth check of real reports found a question of the code
// review (GATT write permission in one file lets any nearby device open the mic) folded inside an unrelated decision (the
// work queue of another file), because the review's `concerns` key named that decision; and a second one joined to a
// decision that shared only one file. A question now joins the item of the row it concerns only when the question's own
// place (the recorded events, files and lines its receipt or anchor names) overlaps the item's place; else it stays an
// item of its own. The item it joins is never below the question's own tier. Synthetic sessions only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { reportModel, reportPlacement, reportItems } from '../report-model.js';
import { renderSessionPage } from '../session-page.js';
import { renderReportMarkdown } from '../session-story.js';
import { reportSession, triagedReport, repoFacts } from './report-fixture.js';
import { sessionBuilder, STORY_KEY } from './session-story-fixture.js';

const TIERS = ['must_act', 'must_know', 'good_to_know'];
const RANK = { good_to_know: 0, must_know: 1, must_act: 2 };
const itemsOf = (model) => reportItems(model);
const holds = (item, source, index) => item.rows.some((r) => r.source === source && r.index === index);
const receipt = (role, eventId, quote) => ({ role, eventId, quote, sessionKey: STORY_KEY });
const id = (c) => `sha256:${c.repeat(64).slice(0, 64)}`;
const questionItem = (model, index) => itemsOf(model).find((item) => item.rows[0].source === 'codePass.questions'
  && item.rows[0].index === index);
const memberOf = (model, index) => itemsOf(model).find((item) => item.members.some((m) => m.rows[0].source
  === 'codePass.questions' && m.rows[0].index === index));

test('D112 amended: a question that names no place stays its own item at its own tier, though its key names a decision', () => {
  // The fixture's Q1 concerns decisions[3] (Good to know alone) and was checked (Must know): its quote was found only in
  // the words the session review wrote of the decision (quote null), so it names no recorded place.
  const session = reportSession();
  const report = triagedReport(session);
  report.codePass.triage.push({ ref: { question: 'Q1' }, level: 'medium', impact: 'One client can use the whole limit.',
    action: 'Choose a limit per client.', label: 'choose the limit scope', where: null });
  const model = reportModel(session, report, repoFacts());
  const own = questionItem(model, 0);
  assert.ok(own, 'an item of its own');
  assert.equal(memberOf(model, 0), undefined, 'no item holds it');
  assert.deepEqual(reportPlacement(model)['codePass.questions:0'], { item: own.n });
  // D161: the code review proposed medium, but no code checked its tie, so it is at most Good to know.
  assert.deepEqual([own.tier.proposed, own.tier.final, own.tier.bound], ['must_know', 'good_to_know', 'untied_ceiling']);
  assert.equal(own.why, 'The code review proposed medium. Sonah could not tie this question to an item or an ask, so it '
    + 'puts it in Good to know.');
  const decision = itemsOf(model).find((x) => holds(x, 'decisions', 3));
  assert.deepEqual(decision.members, []);
  // D116: it names no item either. Its key names the decision, but no code checked that tie (it names no place), so
  // the report prints no pointer from it (`concernsTied`).
  assert.equal(own.where.some((w) => /^item-/.test(w.anchor ?? '')), false, JSON.stringify(own.where));
  assert.deepEqual(own.related.items, []);
  // Every reader shows it as its own item.
  const page = renderSessionPage(session, report, repoFacts());
  assert.ok(page.includes(`id="item-${own.n}"`));
  assert.ok(renderReportMarkdown(session, report, repoFacts()).includes(`<a name="item-${own.n}"></a>`));
});

test('D112 amended: a question whose quote names a recorded event the item does not name stays its own item', () => {
  const session = reportSession();
  const report = triagedReport(session);
  // Q1 quotes the agent's change of approach (C2), which decisions[3] (its edit W2) does not name.
  report.codePass.questions[0] = { ...report.codePass.questions[0],
    quote: receipt('commentary', 'C2', 'I am switching to an in-process token bucket') };
  const model = reportModel(session, report, repoFacts());
  assert.ok(questionItem(model, 0), 'its own item');
  assert.equal(memberOf(model, 0), undefined);
  // The same question quoting the code that the decision's edit wrote shares the decision's place: it joins.
  report.codePass.questions[0] = { ...report.codePass.questions[0], quote: receipt('code', 'W2', 'app.use(limiter(10));') };
  const joined = reportModel(session, report, repoFacts());
  const item = memberOf(joined, 0);
  assert.ok(item && holds(item, 'decisions', 3), 'a member of the decision\'s item');
  // The item is never below the question's own tier.
  const member = item.members.find((m) => m.rows[0].source === 'codePass.questions');
  assert.ok(RANK[item.tier.final] >= RANK[member.tier.final]);
});

/** A session that edits one file twice and another once, and a decision whose action is the first edit. */
function fileSession() {
  const b = sessionBuilder();
  b.ask('I1', 'Add a cache to the client.');
  b.change('W1', 'src/cache.js', { after: 'export const cache = new Map();\n' });
  b.change('W2', 'src/cache.js', { operation: 'edit', before: 'export const cache = new Map();\n',
    after: 'export const cache = new Map();\nexport const limit = 100;\n', priorState: 'edit-text' });
  b.change('W3', 'src/queue.js', { after: 'export const queue = [];\n' });
  b.say('F1', 'Done.', 'final');
  return b.session();
}
const decided = (fields) => ({ actorSession: STORY_KEY, dimension: 'store', chosen: 'a store', value: null,
  valueReceipt: null, valueState: 'unchecked', actions: [], stated: null, constrainedBy: null, instructionReview: null,
  column: 'unasked', columnState: 'grounded', amends: [], materiality: 'structural', materialityRule: 'synthetic',
  relevance: 'unchecked', reasons: [], ...fields });
function fileReport(session, quote) {
  return { reviewScope: 'session-only', coverage: 'complete', sessionReview: 'complete', windowResults: [{ windowIndex: 0,
    eventIds: session.events.map((e) => e.id), failure: null, challenge: { complete: true }, groundingComplete: true }],
  requirements: [],
  decisions: [decided({ id: id('1'), dimension: 'cache', chosen: 'an in-process map', actions: ['W1'] })],
  codePass: { version: { pass: 'sonah.code-pass/10' }, ran: true, required: false, base: { kind: 'recorded_edits' },
    agent: { turns: 1, tools: { Read: 0, Grep: 0, Glob: 0 }, reads: 0, terminal: 'answered' }, gaps: [],
    coverage: 'complete', files: [], findings: [], withheld: [], footer: [], triage: [],
    questions: [{ id: 'Q1', question: 'Should the cache be bounded?', from: 'review', quote,
      concerns: { key: 'S1', kind: 'decision', source: 'decisions', index: 0, id: id('1') },
      check: { verdict: 'sound', explanation: 'It is not bounded.' } }] } };
}

test('D112 amended: a question joins by a file both places name — the decision\'s edit and the event its quote cites — and never by another file', () => {
  const session = fileSession();
  // The quote is the code a later edit of the same file wrote (W2): another event, the same file.
  const same = reportModel(session, fileReport(session, receipt('code', 'W2', 'export const limit = 100;')), {});
  const item = memberOf(same, 0);
  assert.ok(item && holds(item, 'decisions', 0), 'joined by the file');
  // The quote is the code of another file's edit (W3): no place in common, so its own item.
  const other = reportModel(session, fileReport(session, receipt('code', 'W3', 'export const queue = [];')), {});
  assert.ok(questionItem(other, 0), 'its own item');
  assert.equal(memberOf(other, 0), undefined);
  // No quote at all: no place, its own item.
  const none = reportModel(session, fileReport(session, null), {});
  assert.ok(questionItem(none, 0));
});

test('D112 amended: where both places name lines of one file, the lines decide', () => {
  // A claim the code review's claim_false finding contradicts is folded into the finding's item, whose place holds the
  // finding's anchor (src/limiter.js, its lines). A question on that claim whose receipt names lines of the same file
  // joins only when the lines overlap.
  const session = reportSession();
  const base = triagedReport(session);
  const at = base.codePass.findings.findIndex((f) => f.kind === 'claim_false');
  const finding = base.codePass.findings[at];
  const contradicted = finding.leadsFrom.find((ref) => ['promises', 'writtenClaims'].includes(ref.source));
  assert.ok(contradicted && finding.anchor, 'the fixture holds a claim_false finding on a claim');
  const question = (startLine, endLine) => {
    const report = triagedReport(session);
    report.codePass.questions[0] = { ...report.codePass.questions[0], concerns: { ...contradicted },
      quote: { eventId: `file:${finding.anchor.path}`, role: 'code', side: finding.anchor.side ?? 'new',
        path: finding.anchor.path, startLine, endLine, quote: 'x' } };
    return reportModel(session, report, repoFacts());
  };
  const inside = question(finding.anchor.startLine, finding.anchor.endLine);
  assert.ok(memberOf(inside, 0), 'overlapping lines: a member');
  const apart = question(finding.anchor.endLine + 50, finding.anchor.endLine + 51);
  assert.ok(questionItem(apart, 0), 'lines apart: its own item');
  assert.equal(memberOf(apart, 0), undefined);
});
