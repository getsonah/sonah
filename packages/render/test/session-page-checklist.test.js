// D71 (S4), owner decisions 2026-10-08: the session page is the checklist. Checked on a synthetic session and report only
// (session-page-checklist-fixture.js); every string, path, command and id is invented.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { renderSessionPage, PAGE_SENTENCES, PAGE_LABELS, PAGE_LIMITS, PAGE_REQUIREMENT_REASON_WORDS, PAGE_FAILURE_REASON_WORDS,
  PAGE_FAILURE_WORDS, PAGE_OUTCOME_WORDS, PAGE_CONTRADICTION_WORDS } from '../session-page.js';
import { STORY_CONTRADICTION_LABELS } from '../session-story.js';
import { checklistSession, checklistReport } from './session-page-checklist-fixture.js';
import { REQUIREMENT_UNCHECKED_REASONS, FAILURE_UNCHECKED_REASONS, FAILURE_HANDLINGS, FAILURE_OUTCOMES, CONTRADICTION_SOURCES }
  from '../../evidence/src/ledger.js';
import { answerableRowIds, requirementRowId, failureRowId } from '../../evidence/src/checklist.js';
import { resolveDecisionId } from '../../cli/src/decision-command.js';
import { renderReview, ATTENTION_HEADING, ATTENTION_WORDS, CHECKLIST_HEADINGS, CHECKLIST_REQUIREMENT_REASON_WORDS,
  NOT_ACTING_WORDS, FOLDED_SECTION_WORDS } from '../../evidence/src/review.js';

const SNAPSHOT = new URL('./snapshots/session-page-checklist.html', import.meta.url);
const HASH = 'c'.repeat(64);
const page = (report = checklistReport(), options = { sessionHash: HASH }) => renderSessionPage(checklistSession(), report, options);
const unescape = (text) => text.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
  .replace(/&amp;/g, '&');
const textOf = (html) => unescape(html.replace(/<style>[\s\S]*?<\/style>/, '').replace(/<q class="said[^"]*">/g, '“')
  .replace(/<\/q>/g, '”').replace(/<\/?code>/g, '').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ')
  .replace(/“ /g, '“').replace(/ ”/g, '”').replace(/ ([.,;:])/g, '$1');
const itemOf = (html, id) => html.slice(html.indexOf(`id="${id}"`), html.indexOf('</div></li>', html.indexOf(`id="${id}"`)));
const sectionOf = (html, id) => html.slice(html.indexOf(`id="${id}"`), html.indexOf('</section>', html.indexOf(`id="${id}"`)));
const NO_VERDICT = /Needs your decision|Worth a look|No finding needs|Not fully checked|for your information|not a clean result|\b(DECIDE|FYI|CLEAN|NO_FINDINGS|UNCHECKED)\b/;
// No closed token of the checklist's vocabularies reaches a reader: only their words.
const CLOSED = new RegExp(`\\b(${[...REQUIREMENT_UNCHECKED_REASONS, ...FAILURE_UNCHECKED_REASONS, ...FAILURE_HANDLINGS,
  ...FAILURE_OUTCOMES, ...CONTRADICTION_SOURCES.filter((source) => source !== 'result'), 'no_deliverable_by_end', 'partly-done',
  'not-done'].join('|')})\\b`);

test('D71 (S4) the synthetic checklist page renders exactly its snapshot', () => {
  assert.equal(page(), readFileSync(SNAPSHOT, 'utf8'));
});

test('D71 (S4) the page is the checklist, in its order, with no verdict and no closed token anywhere', () => {
  const html = page();
  // D88: the judgment first, then the settled problems; what Sonah could not check last, collapsed.
  const order = ['<div class="attention', 'id="decisions"', 'Made without asking you (1)', 'You asked, the agent chose how (1)',
    'id="requests"', 'id="failures"', 'Passed over (1)', PAGE_LABELS.handledFold(1), 'Commands that failed',
    'id="claims"', 'Contradicted (2)', PAGE_LABELS.confirmedFold(1),
    'id="edits"', 'id="unchecked"><details class="unchecked">', 'Asks not checked (2)',
    'Claims not checked against a recorded result (1)', 'Claims resting on a check that never completed (1)',
    'Failures not checked (1)', '</details></section>', '</figure>', 'id="steps"', 'id="files"', '<footer'];
  let at = -1;
  for (const part of order) {
    const next = html.indexOf(part, at + 1);
    assert.ok(next > at, `${part} comes next`);
    at = next;
  }
  assert.doesNotMatch(textOf(html), NO_VERDICT);
  assert.equal(textOf(html).match(CLOSED)?.[0] ?? null, null);
  // The summary counts only what needs your attention: nothing done is counted (no grade). D88: the judgment and the
  // settled problems only; the rows Sonah could not check in one plain line.
  const summary = textOf(html.slice(html.indexOf('<div class="attention'), html.indexOf('</div>', html.indexOf('<div class="attention')))).trim();
  assert.equal(summary, "Where your attention is needed 1 choice not to act 1 decision made without asking you 1 decision "
    + 'where you asked and the agent chose how 2 asks of yours are shown not done or partly done: 1 partly done and 1 not '
    + "done 2 claims of the agent's contradicted by the recording 1 failure the agent passed over 5 rows Sonah could not "
    + 'check: folded under What Sonah could not check, at the end');
  assert.doesNotMatch(summary, /\bdone: \d+ done|confirmed|acted on|told you|not checked against|never completed/);
  for (const [, target] of html.matchAll(/href="#([^"]*)"/g)) assert.ok(html.includes(`id="${target}"`), `#${target} exists`);
  assert.equal(page(), html, 'deterministic');
  const report = checklistReport();
  const before = JSON.stringify(report);
  page(report);
  assert.equal(JSON.stringify(report), before, 'the report is only read');
});

test('D71 (S4, b) an ask shows the status code published and the evidence that settles it, or what is missing, or why not', () => {
  const html = page();
  const requests = sectionOf(html, 'requests');
  assert.ok(textOf(requests).includes(PAGE_SENTENCES.statusChecked));
  // D88: the settled asks here; the ones not checked under What Sonah could not check, each with its request.
  const folded = sectionOf(html, 'unchecked');
  const rows = [...`${requests}${folded}`.matchAll(/<li><span class="pill">([^<]*)<\/span>([\s\S]*?)<\/li>\n/g)]
    .map((m) => [m[1], textOf(m[2]).replace(/ request \d+ /, ' ')]);
  assert.deepEqual(rows.map(([status]) => status), ['done', 'not done', 'partly done', 'not checked', 'not checked']);
  assert.equal((requests.match(/<span class="pill">not checked<\/span>/g) ?? []).length, 0);
  assert.ok(textOf(requests).includes(`${FOLDED_SECTION_WORDS.here(1, 'ask')}`));
  const row = (quote) => rows.find(([, text]) => text.startsWith(`“${quote}”`))[1];
  assert.match(row('Add a retry to the fetcher'), /What settles it Code written “return retry\(3, \(\) => fetch\(url\)\);”/);
  assert.match(row('log each failure'), /What is missing Agent said “I left the logging for later”/);
  assert.ok(row('Keep the timeout at 5 seconds').includes(`${PAGE_LABELS.whyNotChecked} ${PAGE_REQUIREMENT_REASON_WORDS.deliverable_ungrounded[0].toUpperCase()}`));
  assert.match(row('The API returns XML'), /What settles it Agent said “so I parse it as JSON” What is missing Agent said “The API returns JSON”/);
  // Code's own row for the message no row cites: no words of its own, its reason and the end-of-recording fact.
  const own = rows.at(-1)[1];
  assert.ok(own.includes(PAGE_REQUIREMENT_REASON_WORDS.ask_unreviewed.slice(1)) && own.includes('The recording ends here'));
  assert.doesNotMatch(own, /In the review's words/);
  // The status is code's: an answer that proposed "done" for a row code lowered never shows "done".
  const report = checklistReport();
  report.windowResults[0].narrative.requirements[2].status = 'done';
  const lowered = sectionOf(page(report), 'requests');
  assert.equal((lowered.match(/<span class="pill">done<\/span>/g) ?? []).length, 1);
  // A deliverable that does not ground here is said so; it is never shown.
  const moved = checklistReport();
  moved.requirements[0].deliverable = { ...moved.requirements[0].deliverable, quote: 'return retry(9)' };
  assert.ok(sectionOf(page(moved), 'requests').includes(PAGE_SENTENCES.evidenceMissing));
  assert.doesNotMatch(page(moved), /retry\(9\)/);
  // Every reason and fact has the page's words.
  assert.deepEqual(Object.keys(PAGE_REQUIREMENT_REASON_WORDS), [...REQUIREMENT_UNCHECKED_REASONS]);
});

test('D71 (S4, e, f, S2) what the agent told you: contradictions by their source, a check never completed, no assumption mark (S6)', () => {
  const html = page();
  const claims = textOf(sectionOf(html, 'claims'));
  assert.match(claims, new RegExp(`${PAGE_CONTRADICTION_WORDS.human_message} step 1 Agent said “The API returns JSON” You said “The API returns XML”`));
  // An edit's removed lines are the file's recorded content, never code written.
  assert.ok(claims.includes(`${PAGE_CONTRADICTION_WORDS.file_content} step 1 Agent said “The README said version 3” `
    + `${STORY_CONTRADICTION_LABELS.file_content} “Version 2.0 of the fetcher.”`));
  assert.doesNotMatch(itemOf(html, 'finding-2'), /Code written/);
  // The check a claim rests on that never completed: the action and what the recording shows of it.
  assert.ok(textOf(itemOf(html, 'claim-1')).includes(`${PAGE_LABELS.restsOn} ${PAGE_LABELS.ran} npm run e2e `
    + `${PAGE_OUTCOME_WORDS['no-terminal-status'](null, 'background')}`));
  assert.match(itemOf(html, 'claim-1'), /<span class="flagchip">the check it rests on never completed<\/span>/);
  // S6 (S5 review M3): the review's mark that a claim is an assumption is not shown — no challenge checks it; it is
  // counted for the owner only.
  assert.doesNotMatch(textOf(sectionOf(html, 'claims')), /assumption/i);
  assert.equal(Object.hasOwn(PAGE_LABELS, 'assumption'), false);
  // Confirmed, folded, with the result's words.
  assert.match(html, /<details class="group fold"><summary><span class="label">Show the claim confirmed by a recorded result<\/span><\/summary><ol class="findings"><li class="finding" id="claim-3">/);
  assert.deepEqual(Object.keys(PAGE_CONTRADICTION_WORDS), [...CONTRADICTION_SOURCES]);
});

test('D71 (S4, d) a choice not to act is highlighted wherever it is: its row, the decisions\' lead, the summary, a fold', () => {
  const html = page();
  assert.match(html, /<li class="finding alert not-acting" id="decision-1">/);
  assert.match(itemOf(html, 'decision-1'), /<p class="mark"><span class="flagchip">A choice not to act<\/span><\/p>/);
  assert.match(textOf(itemOf(html, 'decision-1')), /step 1 A choice not to act Backoff Chosen no backoff Agent said “I will not add a backoff/);
  assert.ok(textOf(sectionOf(html, 'decisions')).includes(PAGE_SENTENCES.notActingLead(1)));
  assert.match(html, /<li class="hl"><a href="#decisions">1 choice not to act<\/a><\/li>/);
  assert.doesNotMatch(itemOf(html, 'decision-2'), /not-acting|A choice not to act/);
  // A settled one is highlighted on its fold's own line; one of how in its row (the how still shown).
  const settled = checklistReport();
  settled.decisions[0] = { ...settled.decisions[0], column: 'asked-settled',
    constrainedBy: { instruction: { role: 'instruction', eventId: 'I1', quote: 'Add a retry to the fetcher', sessionKey: 'story' },
      settles: true, settledValueQuote: null } };
  assert.match(page(settled), /You settled \(1\)<\/span> <span class="flagchip">A choice not to act \(1\)<\/span><\/summary>/);
  const how = checklistReport();
  how.decisions[1].notActing = true;
  assert.match(page(how), /<li class="finding how not-acting" id="decision-2">/);
  assert.ok(textOf(itemOf(page(how), 'decision-2')).includes(PAGE_LABELS.howCode));
});

test('D71 (S4, c) the failures: passed over first and highlighted; S7: no fold of calls nothing came back from', () => {
  const html = page();
  const failures = sectionOf(html, 'failures');
  assert.ok(textOf(itemOf(html, 'failure-1')).includes(`01 ${PAGE_FAILURE_WORDS['passed-over']} step 1 ${PAGE_LABELS.ran} npm test `
    + `${PAGE_OUTCOME_WORDS['ran-failed'](1)} ${PAGE_LABELS.turnEnded} “Done: retries are added and the tests pass.”`));
  assert.match(html, /<li class="hl"><a href="#failures">1 failure the agent passed over<\/a><\/li>/);
  assert.ok(textOf(itemOf(html, 'failure-2')).includes(`${PAGE_LABELS.whyNotChecked} ${PAGE_FAILURE_REASON_WORDS.response_ungrounded[0].toUpperCase()}`));
  assert.ok(textOf(itemOf(html, 'failure-3')).includes(`${PAGE_OUTCOME_WORDS['did-not-run']()} Agent said “I left the logging for later”`));
  // S7: a RESULT recorded with none of its output shown is no failure row
  // (output-no-status `unread`), so the web lookups are not listed and nothing is folded as "nothing came back".
  // D88: the one not checked is listed under What Sonah could not check, never counted in the summary.
  assert.equal((failures.match(/id="failure-\d+"/g) ?? []).length, 2);
  assert.equal((sectionOf(html, 'unchecked').match(/id="failure-\d+"/g) ?? []).length, 1);
  assert.doesNotMatch(textOf(html), /nothing came back/i);
  assert.doesNotMatch(html, /could not check what the agent did about it/);
  assert.ok(textOf(failures).includes(FOLDED_SECTION_WORDS.here(1, 'failure')));
  // A row the review read as passed over is highlighted, whatever its outcome.
  const passed = checklistReport();
  passed.failures[1] = { ...passed.failures[1], handling: 'passed-over', response: { role: 'commentary', eventId: 'F1',
    quote: 'Done: retries are added', sessionKey: 'story' } };
  delete passed.failures[1].reason;
  const shown = page(passed);
  assert.equal((sectionOf(shown, 'failures').match(/id="failure-\d+"/g) ?? []).length, 3);
  assert.ok(sectionOf(shown, 'failures').includes('Passed over (2)'));
  assert.doesNotMatch(sectionOf(shown, 'unchecked'), /id="failure-\d+"/);
  // S7: an interrupted or cancelled call is a form of no terminal status, said in plain words.
  for (const form of ['interrupted', 'cancelled']) assert.equal(PAGE_OUTCOME_WORDS['no-terminal-status'](null, form), 'It stopped before it finished.');
  // A report from before the checklist has no failure rows: its failed commands, as before.
  const legacy = checklistReport();
  delete legacy.failures;
  assert.match(sectionOf(page(legacy), 'failures'), /<h2 class="label">Commands that failed or did not run<\/h2>/);
  assert.deepEqual(Object.keys(PAGE_FAILURE_REASON_WORDS), [...FAILURE_UNCHECKED_REASONS]);
  assert.deepEqual(Object.keys(PAGE_FAILURE_WORDS).sort(), [...FAILURE_HANDLINGS].sort());
  for (const outcome of FAILURE_OUTCOMES) assert.equal(typeof PAGE_OUTCOME_WORDS[outcome], 'function', outcome);
});

test('D71 (S4) every row carries the id that answers it, the command is printed once, and `sonah decision` resolves each id', () => {
  const report = checklistReport();
  const html = page(report);
  const printed = [...html.matchAll(/<span class="label">(?:Row|Decision) id<\/span> <code>([0-9a-f]{12})<\/code>/g)].map((m) => m[1]);
  // 5 asks, 3 claims, 2 contradicted claims, 2 decisions, the 3 failures shown as rows.
  assert.equal(printed.length, 15);
  assert.equal(new Set(printed).size, 15);
  // /14: the command, once, with the session's hash and ROW_ID for the id under each row.
  assert.equal(html.match(/sonah decision accept\|change\|clarify c{64} ROW_ID --report REPORT /g)?.length, 1);
  assert.equal(html.match(/sonah decision/g).length, 1);
  for (const id of printed) assert.ok(resolveDecisionId(report, `sha256:${id}`).id, id);
  assert.equal(answerableRowIds(report).length, 5 + 3 + 2 + 2 + 3);
  assert.equal(requirementRowId(report.requirements[0]), requirementRowId(JSON.parse(JSON.stringify(report.requirements[0]))));
  assert.notEqual(failureRowId(report.failures[0]), failureRowId(report.failures[1]));
  assert.equal(requirementRowId({ status: 'addressed', instruction: { eventId: 'I1', quote: 'x' } }), null);
  // Your earlier answer is shown under the row it answers.
  const answers = new Map([[requirementRowId(report.requirements[1]), { verb: 'change', reason: 'Add the logging now.' }]]);
  assert.ok(textOf(sectionOf(page(report, { sessionHash: HASH, decisionReviews: answers }), 'requests'))
    .includes('Your answer You asked to change it. Your reason: Add the logging now.'));
  // Without the session's hash: the same ids, and no command.
  const bare = page(report, {});
  assert.deepEqual([...bare.matchAll(/<span class="label">(?:Row|Decision) id<\/span> <code>([0-9a-f]{12})<\/code>/g)].map((m) => m[1]),
    printed);
  assert.doesNotMatch(bare, /sonah decision/);
  assert.equal(textOf(bare).includes(PAGE_SENTENCES.answerIntro), false);
});

test('D71 (S4) every shown quote is found again, word for word, in this recording', () => {
  const session = checklistSession();
  const html = page();
  const all = [...session.events, ...session.projectInstructions].flatMap((event) => ['text', 'output', 'command', 'input']
    .flatMap((field) => session.textSpansOf(event, field)).concat(...(event.changes ?? []).flatMap((c) =>
      [...session.textSpansOf(c, 'after'), ...session.textSpansOf(c, 'before')]))).join('\n');
  const quotes = [...html.matchAll(/<q class="said[^"]*">([\s\S]*?)<\/q>/g)].map((m) => unescape(m[1].replace(/<[^>]+>/g, '')));
  assert.ok(quotes.length > 20);
  for (const quote of quotes) assert.ok(all.includes(quote), quote);
});

test('D71 (S4) the page bound holds with many failure rows, and the cut is stated', () => {
  const report = checklistReport();
  const row = report.failures[0];
  report.failures = Array.from({ length: 400 }, (_, i) => ({ ...row, eventId: i ? `R1-r${i}` : row.eventId }));
  const html = page(report);
  assert.ok(Buffer.byteLength(html) <= PAGE_LIMITS.maxBytes);
  assert.match(textOf(html), /\d+ more failures are not shown\./);
});

test('D71 (S4) the PR comment carries the same checklist, condensed, in the same order, with no verdict', () => {
  const md = renderReview(checklistReport());
  // D88: the judgment first, then the settled problems; what Sonah could not check last, collapsed.
  const order = [ATTENTION_HEADING, CHECKLIST_HEADINGS.decisions, CHECKLIST_HEADINGS.requests, CHECKLIST_HEADINGS.failures,
    CHECKLIST_HEADINGS.claims, '#### Contradicted', `${CHECKLIST_HEADINGS.folded} (5)`, '<details>',
    `#### ${FOLDED_SECTION_WORDS.groups.asksNotChecked} (2)`, `#### ${FOLDED_SECTION_WORDS.groups.claimsOpen} (1)`,
    `#### ${FOLDED_SECTION_WORDS.groups.claimsIncomplete} (1)`, `#### ${FOLDED_SECTION_WORDS.groups.failuresNotChecked} (1)`,
    '</details>'];
  let at = -1;
  for (const part of order) {
    const next = md.indexOf(`\n${part}\n`, at + 1);
    assert.ok(next > at, `${part} comes next`);
    at = next;
  }
  assert.doesNotMatch(md, /Needs your decision|Worth a look|\b(DECIDE|FYI|CLEAN|NO_FINDINGS|UNCHECKED)\b|tracked ·/);
  // The summary: what needs your attention only, a choice not to act and a failure passed over in bold; the calls nothing
  // came back from are not counted there.
  const summary = md.slice(md.indexOf(ATTENTION_HEADING), md.indexOf(CHECKLIST_HEADINGS.decisions));
  assert.ok(summary.includes(`- ${ATTENTION_WORDS.notActing(1)}`) && summary.includes('**1 choice not to act**'));
  assert.ok(summary.includes(`- ${ATTENTION_WORDS.passedOver(1)}`));
  // S6 (S5 review M3): no attention line for the review's unchallenged assumption mark.
  assert.ok(!Object.hasOwn(ATTENTION_WORDS, 'assumptions') && !/assumption/i.test(summary));
  // D88: the failure not checked, the claim resting on a check that never completed, the claim and the asks not checked
  // are not counted: one plain line says how many are folded, and where.
  assert.ok(summary.includes(`\n\n${ATTENTION_WORDS.folded(5)}\n`));
  assert.doesNotMatch(summary, /could not check what the agent did|never completed|not checked against|not shown done/);
  // What you asked: your words, the status code published, and its evidence or why not; code's own row has no quote.
  assert.ok(md.includes('| done | “Add a retry to the fetcher” `I1` | settled by “return retry(3, () =&gt; fetch(url));” `W1` |'));
  assert.ok(md.includes('| **not done** | “log each failure” `I1` | missing: “I left the logging for later” `F1` |'));
  assert.ok(md.includes(`| not checked | _the review named no ask from this message_ \`I2\` | why not checked: ${CHECKLIST_REQUIREMENT_REASON_WORDS.ask_unreviewed}; `));
  // What the agent told you: what contradicts a claim, labelled by its source; a check never completed; an assumption.
  assert.ok(md.includes("- **file's recorded content** `W2` — “Version 2.0 of the fetcher.”"));
  assert.ok(md.includes('- **the check it rests on never completed** — The tests pass — it rests on `X1`'));
  assert.ok(md.includes('- **not checked** — It parses JSON\n'));
  // What the agent decided: a choice not to act marked in the table and on its card.
  assert.ok(md.includes(`| ${NOT_ACTING_WORDS.mark} — backoff — no backoff | Unasked | material |`));
  assert.ok(md.includes('<summary><b>A choice not to act:</b> <b>backoff</b>'));
  // The failures: passed over first, in bold, with the end of its turn (S7: no line of calls nothing came back from).
  const failures = md.slice(md.indexOf(CHECKLIST_HEADINGS.failures));
  assert.ok(failures.includes('- **Passed over: its turn ended without acting on it or telling you** — `R1` (bash), result `R1-r`: It ran and failed.\n  - **its turn ended with** `F1`'));
  for (const id of ['S1', 'S2', 'S3', 'S4']) assert.ok(!failures.includes(`\`${id}\``), id);
  assert.doesNotMatch(failures, /nothing came back/i);
  // A report from before the checklist: no failures section, the legacy table.
  const legacy = checklistReport();
  delete legacy.failures;
  legacy.requirements = [{ text: 'Add the retry', instruction: legacy.requirements[0].instruction, status: 'addressed' }];
  const old = renderReview(legacy);
  assert.ok(!old.includes(CHECKLIST_HEADINGS.failures) && old.includes('| Status | Requirement |'));
});
