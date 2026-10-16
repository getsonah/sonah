// D71 (S4), owner decisions 2026-10-08: the checklist's rows, their ids and the PR comment, on a synthetic session and
// report only (session-page-checklist-fixture.js); every string, path, command and id is invented. D97: the page
// renders the report model (session-page-report.test.js holds its order and layout); the rules of the checklist page
// that stay — every row's id and the command printed once, every quote found again, the byte bound — are checked here
// on the new page, and the PR comment (review.js) is unchanged.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderSessionPage, PAGE_LIMITS } from '../session-page.js';
import { reportModel } from '../report-model.js';
import { REPORT_FOOTER_WORDS } from '../report-words.js';
import { checklistSession, checklistReport } from './session-page-checklist-fixture.js';
import { answerableRowIds, requirementRowId, failureRowId } from '../../evidence/src/checklist.js';
import { resolveDecisionId } from '../../cli/src/decision-command.js';
import { ATTENTION_WORDS, attentionSummary, FOLDED_SECTION_WORDS } from '../../evidence/src/review.js';

const HASH = 'c'.repeat(64);
const page = (report = checklistReport(), options = { sessionHash: HASH }) => renderSessionPage(checklistSession(), report, options);
const unescape = (text) => text.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
  .replace(/&amp;/g, '&');
const textOf = (html) => unescape(html.replace(/<style>[\s\S]*?<\/style>/, '').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ');
const ROW_ID = /Item id:<\/span> <code>([0-9a-f]{12})<\/code>/g;

test('D71 (S4) every item carries the id that answers it, the command is printed once, and `sonah decision` resolves each id', () => {
  const report = checklistReport();
  const html = page(report);
  const printed = [...html.matchAll(ROW_ID)].map((m) => m[1]);
  // Each item with a ledger or a computed id: 2 asks, 2 contradicted claims, 1 failure passed over and 2 decisions.
  const model = reportModel(checklistSession(), report, {});
  const items = [...model.tiers.must_act, ...model.tiers.must_know, ...model.tiers.good_to_know];
  assert.equal(printed.length, items.filter((item) => item.rowId?.startsWith('sha256:')).length);
  assert.equal(printed.length, 7);
  assert.equal(new Set(printed).size, printed.length);
  // The command, once, with the session's hash and ROW_ID for the id in each item's fold.
  assert.equal(html.match(/sonah decision accept\|change\|clarify c{64} ROW_ID --report REPORT /g)?.length, 1);
  assert.equal(html.match(/sonah decision/g).length, 1);
  for (const id of printed) assert.ok(resolveDecisionId(report, `sha256:${id}`).id, id);
  assert.equal(answerableRowIds(report).length, 5 + 3 + 2 + 2 + 3);
  assert.equal(requirementRowId(report.requirements[0]), requirementRowId(JSON.parse(JSON.stringify(report.requirements[0]))));
  assert.notEqual(failureRowId(report.failures[0]), failureRowId(report.failures[1]));
  assert.equal(requirementRowId({ status: 'addressed', instruction: { eventId: 'I1', quote: 'x' } }), null);
  // Your earlier answer is shown with the item it answers.
  const answers = new Map([[requirementRowId(report.requirements[1]), { verb: 'change', reason: 'Add the logging now.' }]]);
  assert.ok(textOf(page(report, { sessionHash: HASH, decisionReviews: answers }))
    .includes('Your answer: You asked to change it. Add the logging now.'));
  // Without the session's hash: the same ids, and no command.
  const bare = page(report, {});
  assert.deepEqual([...bare.matchAll(ROW_ID)].map((m) => m[1]), printed);
  assert.doesNotMatch(bare, /sonah decision/);
  assert.equal(textOf(bare).includes(REPORT_FOOTER_WORDS.answerIntro), false);
});

test('D71 (S4) every shown quote is found again, word for word, in this recording', () => {
  const session = checklistSession();
  const html = page();
  const all = [...session.events, ...session.projectInstructions].flatMap((event) => ['text', 'output', 'command', 'input']
    .flatMap((field) => session.textSpansOf(event, field)).concat(...(event.changes ?? []).flatMap((c) =>
      [...session.textSpansOf(c, 'after'), ...session.textSpansOf(c, 'before')]))).join('\n');
  const quotes = [...html.matchAll(/<q class="said[^"]*">([\s\S]*?)<\/q>/g)].map((m) => unescape(m[1].replace(/<[^>]+>/g, '')));
  assert.ok(quotes.length > 10);
  for (const quote of quotes) assert.ok(all.includes(quote), quote);
});

test('D71 (S4) the page bound holds with many failure rows, and every one is placed', () => {
  const report = checklistReport();
  const row = report.failures[1];
  report.failures = Array.from({ length: 4000 }, (_, i) => ({ ...row, eventId: i ? `X1-r${i}` : row.eventId }));
  const html = page(report);
  assert.ok(Buffer.byteLength(html) <= PAGE_LIMITS.maxBytes);
  const model = reportModel(checklistSession(), report, {});
  assert.equal(Object.keys(model.placement.rows).filter((key) => key.startsWith('failures:')).length, 4000);
});

test('D71 (S4) the attention summary the CLI and the PR comment read counts the judgment and the settled problems only', () => {
  const { lines, folded } = attentionSummary(checklistReport());
  // A choice not to act and a failure passed over in bold; the calls nothing came back from are not counted there.
  assert.ok(lines.includes(ATTENTION_WORDS.notActing(1)) && ATTENTION_WORDS.notActing(1).includes('**'));
  assert.ok(lines.includes(ATTENTION_WORDS.passedOver(1)));
  // S6 (S5 review M3): no attention line for the review's unchallenged assumption mark.
  assert.ok(!Object.hasOwn(ATTENTION_WORDS, 'assumptions') && !lines.some((line) => /assumption/i.test(line)));
  // D88: the failure not checked, the claim resting on a check that never completed, the claim and the asks not checked
  // are not counted: one plain line says how many are folded, and where.
  assert.equal(folded, ATTENTION_WORDS.folded(5));
  assert.ok(!lines.some((line) => /could not check what the agent did|never completed|check that did not finish|not checked against|not shown done/.test(line)));
});
