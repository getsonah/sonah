// D88 (owner decision 2026-10-14, amending D71 S2's "every row short of done points attention"): the review leads with
// the agent's judgment and the settled problems. The rows Sonah could not check are folded into one collapsed section,
// "What Sonah could not check (N)", last, listed in full and never counted in the attention summary, which carries one
// plain line saying how many and where. One closed definition (review.js ATTENTION_ROWS, FOLDED_ROWS) for the page, the
// story, the PR comment and the CLI. Every session and report here is synthetic.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ATTENTION_ROWS, FOLDED_ROWS, ATTENTION_WORDS, FOLDED_SECTION_WORDS, ASK_ROW_KINDS, DECISION_ROW_KINDS,
  askRowKind, claimRowKind, failureRowKind, writtenRowKind, decisionRowKinds, attentionSummary, attentionLines,
  checklistRowCounts, rowKindCounts, derivedColumn, listedPromises, renderReview, CHECKLIST_HEADINGS, CHECKLIST_REQUIREMENT_REASON_WORDS, CHECKLIST_FAILURE_REASON_WORDS }
  from '../../evidence/src/review.js';
import { REQUIREMENT_STATUSES, LEGACY_REQUIREMENT_STATUSES, PROMISE_STATUSES, FAILURE_HANDLINGS, WRITTEN_LABELS,
  DECISION_COLUMNS } from '../../evidence/src/ledger.js';
import { requirementRowId, failureRowId } from '../../evidence/src/checklist.js';
import { renderSessionPage, PAGE_ATTENTION_WORDS, PAGE_LABELS } from '../session-page.js';
import { renderSessionStory, STORY_CHECKLIST_HEADINGS } from '../session-story.js';
import { attentionCliLines, ATTENTION_CLI_HEADING, ATTENTION_CLI_NONE } from '../../cli/src/session-review-command.js';
import { publicCommentText } from '../../github/index.js';
import { checklistSession, checklistReport } from './session-page-checklist-fixture.js';
import { STORY_KEY } from './session-story-fixture.js';

const receipt = (role, eventId, quote) => ({ role, eventId, quote, sessionKey: STORY_KEY });
const idOf = (c) => `sha256:${c.repeat(64).slice(0, 64)}`;
const shortId = (id) => id.slice('sha256:'.length, 'sha256:'.length + 12);
const unescape = (text) => text.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
  .replace(/&amp;/g, '&');

/** The checklist report with one statement written into a file of each label: one contradicted (counted), one not
 *  checked (folded). Its rows: asks done, not done, partly done and two not checked; claims contradicted (2), confirmed,
 *  resting on a check that never completed and not checked; a choice not to act made without asking you and a decision
 *  of how; failures passed over, not checked and told you about. */
function report() {
  return { ...checklistReport(), codeStatus: 'CLEAN', reviewStatus: 'DECIDE',
    writtenClaims: [
      { id: idOf('7'), text: 'The README names version 3', label: 'contradicted',
        stated: receipt('code', 'W2', 'Version 2.1 of the fetcher.'), contradictedBy: receipt('observation', 'R2-r', 'lint ok') },
      { id: idOf('8'), text: 'The fetcher retries three times', label: 'unverified',
        stated: receipt('code', 'W1', 'return retry(3, () => fetch(url));') },
    ] };
}
/** The folded rows of `report()`: asks not checked 2 (one quoted, code's own row for the unreviewed ask), a claim not
 *  checked, a claim resting on a check that never completed, a failure not checked, a written statement not checked. */
const FOLDED = 6;

test('D88: the closed lists of counted and folded rows, in their order, one definition for every reader', () => {
  assert.deepEqual(ATTENTION_ROWS, ['notActing', 'unasked', 'chose', 'whetherAsked', 'pivots', 'asksNotDone',
    'contradicted', 'codeContradicted', 'passedOver', 'forbidden', 'writtenContradicted', 'codeFindings']);
  assert.deepEqual(FOLDED_ROWS, ['asksNotChecked', 'claimsOpen', 'claimsIncomplete', 'failuresNotChecked', 'writtenOpen']);
  for (const list of [ATTENTION_ROWS, FOLDED_ROWS, ASK_ROW_KINDS, DECISION_ROW_KINDS, FOLDED_SECTION_WORDS,
    FOLDED_SECTION_WORDS.groups]) assert.ok(Object.isFrozen(list));
  assert.equal(ATTENTION_ROWS.filter((kind) => FOLDED_ROWS.includes(kind)).length, 0, 'no kind is both counted and folded');
  // Every counted kind has its words on every reader, under the same key; every folded kind a group heading.
  for (const kind of ATTENTION_ROWS) {
    assert.equal(typeof ATTENTION_WORDS[kind], 'function', kind);
    assert.equal(typeof PAGE_ATTENTION_WORDS[kind], 'function', kind);
  }
  for (const kind of FOLDED_ROWS) {
    assert.equal(typeof FOLDED_SECTION_WORDS.groups[kind], 'string', kind);
    assert.ok(!Object.hasOwn(ATTENTION_WORDS, kind) && !Object.hasOwn(PAGE_ATTENTION_WORDS, kind), `${kind} has no attention words`);
  }
  // A row's kind is read from its closed token only, every member of each vocabulary placed.
  const ask = (status) => askRowKind({ status });
  assert.deepEqual(REQUIREMENT_STATUSES.map(ask), [null, 'asksNotDone', 'asksNotDone', 'asksNotChecked']);
  assert.deepEqual(LEGACY_REQUIREMENT_STATUSES.map(ask), [null, 'asksNotDone', 'asksNotDone']);
  assert.equal(ask('anything else'), null);
  assert.deepEqual(PROMISE_STATUSES.map((status) => claimRowKind({ status })), ['claimsOpen', null, 'claimsIncomplete']);
  assert.equal(claimRowKind({ status: 'anything else' }), 'claimsOpen', 'any other status reads not checked, and folds');
  assert.deepEqual(FAILURE_HANDLINGS.map((handling) => failureRowKind({ handling })),
    [null, null, 'passedOver', 'failuresNotChecked']);
  assert.equal(failureRowKind({ handling: 'anything else' }), 'failuresNotChecked');
  assert.deepEqual(WRITTEN_LABELS.map((label) => writtenRowKind({ label })), ['writtenOpen', 'writtenContradicted']);
  assert.equal(writtenRowKind({ label: 'anything else' }), null);
  const derived = { columnState: 'grounded' };
  assert.deepEqual(DECISION_COLUMNS.map((column) => decisionRowKinds({ column, ...derived })), [[], ['chose'], ['unasked']]);
  assert.deepEqual(decisionRowKinds({ column: null }), ['whetherAsked']);
  assert.deepEqual(decisionRowKinds({ column: 'unasked', notActing: true, ...derived }), ['notActing', 'unasked'],
    'a choice not to act is counted beside its column, as D71 (d) highlights it wherever it is');
  // The judgment-first review (low, one counting): a column counts only when the ledger derived it, as the page's and
  // the story's groups read it (`derivedColumn`); any other is where the review could not tell whether you asked.
  for (const state of [undefined, 'unchecked', 'grounded ', null])
    assert.deepEqual(decisionRowKinds({ column: 'unasked', columnState: state }), ['whetherAsked'], String(state));
  assert.equal(derivedColumn({ column: 'asked-chose', columnState: 'grounded' }), 'asked-chose');
  assert.equal(derivedColumn({ column: 'made up', columnState: 'grounded' }), null);
  for (const value of [null, undefined, 'x', 5, []])
    assert.deepEqual([askRowKind(value), claimRowKind(value), failureRowKind(value), writtenRowKind(value),
      decisionRowKinds(value)], [null, null, null, null, []]);
});

test('D88: the summary counts only the judgment and the settled problems, in the same order on every reader', () => {
  const r = report();
  const counts = checklistRowCounts(r, { contradicted: r.findings, edits: [], codeFindings: [] });
  assert.deepEqual(Object.keys(counts), [...ATTENTION_ROWS, ...FOLDED_ROWS]);
  assert.deepEqual(Object.fromEntries(Object.entries(counts).filter(([, n]) => n > 0)), { notActing: 1, unasked: 1, chose: 1,
    asksNotDone: 2, contradicted: 2, passedOver: 1, writtenContradicted: 1, asksNotChecked: 2, claimsOpen: 1,
    claimsIncomplete: 1, failuresNotChecked: 1, writtenOpen: 1 });
  const { lines, folded } = attentionSummary(r);
  assert.deepEqual(lines, [ATTENTION_WORDS.notActing(1), ATTENTION_WORDS.unasked(1), ATTENTION_WORDS.chose(1),
    ATTENTION_WORDS.asksNotDone(2), ATTENTION_WORDS.contradicted(2), ATTENTION_WORDS.passedOver(1),
    ATTENTION_WORDS.writtenContradicted(1)]);
  assert.deepEqual(attentionLines(r), lines);
  assert.equal(folded, ATTENTION_WORDS.folded(FOLDED));
  assert.equal(folded, `${FOLDED} rows Sonah could not check — folded under What Sonah could not check.`);
  // Nothing Sonah could not check is counted where your attention is needed, on any reader.
  const NOT_CHECKED = /not checked against|never completed|could not check what the agent did|not shown done/;
  for (const line of lines) assert.doesNotMatch(line, NOT_CHECKED);
  // The CLI: the same lines, a choice not to act and a failure passed over marked, then the plain line, unmarked.
  assert.deepEqual(attentionCliLines(r), [ATTENTION_CLI_HEADING,
    ...lines.map((line) => `  ${line.includes('**') ? '!' : '-'} ${line.split('**').join('')}`), `  ${folded}`]);
  // The PR comment: the same lines, then the plain line after them.
  const { summary } = publicCommentText(r);
  const plain = (text) => text.replace(/\\(.)/g, '$1').replace(/&#64;/g, '@');
  const at = lines.map((line) => plain(summary).indexOf(line.split('**').join('')));
  assert.ok(at.every((i) => i > 0) && at.every((i, k) => k === 0 || i > at[k - 1]), 'every line, in order');
  assert.ok(plain(summary).indexOf(folded) > at.at(-1), 'the plain line comes after the counted lines');
  assert.doesNotMatch(plain(summary), NOT_CHECKED);
  // The page: the same kinds in the same order, linked to their sections, then the plain line to the folded section.
  const html = renderSessionPage(checklistSession(), r);
  const block = html.slice(html.indexOf('<div class="attention">'), html.indexOf('</div>', html.indexOf('<div class="attention">')));
  const items = [...block.matchAll(/<li( class="hl")?><a href="#([a-z]+)">([^<]*)<\/a><\/li>/g)]
    .map((m) => [m[2], unescape(m[3]), m[1] !== undefined]);
  assert.deepEqual(items, [['decisions', PAGE_ATTENTION_WORDS.notActing(1), true],
    ['decisions', PAGE_ATTENTION_WORDS.unasked(1), false], ['decisions', PAGE_ATTENTION_WORDS.chose(1), false],
    ['requests', PAGE_ATTENTION_WORDS.asksNotDone(2, '1 partly done and 1 not done'), false],
    ['claims', PAGE_ATTENTION_WORDS.contradicted(2), false], ['failures', PAGE_ATTENTION_WORDS.passedOver(1), true],
    ['edits', PAGE_ATTENTION_WORDS.writtenContradicted(1), false]]);
  assert.ok(block.includes(`<p class="folded"><a href="#unchecked">${PAGE_ATTENTION_WORDS.folded(FOLDED)}</a></p>`));
  assert.doesNotMatch(unescape(block), NOT_CHECKED);
});

test('D88: with nothing folded no plain line is added; with nothing counted the summary still says it lists nothing', () => {
  const r = report();
  const settled = { ...r, requirements: r.requirements.filter((row) => row.status !== 'not-checked'),
    promises: r.promises.filter((p) => p.status === 'verified'), failures: r.failures.filter((f) => f.handling !== 'not-checked'),
    writtenClaims: r.writtenClaims.filter((w) => w.label === 'contradicted') };
  assert.equal(attentionSummary(settled).folded, null);
  assert.ok(!attentionCliLines(settled).some((line) => line.includes('Sonah could not check')));
  assert.doesNotMatch(renderSessionPage(checklistSession(), settled), /<p class="folded">/);
  assert.doesNotMatch(renderSessionStory(checklistSession(), settled), /## What Sonah could not check/);
  // Only folded rows: no line is counted, so the summary says it lists nothing, then the plain line.
  const onlyFolded = { ...r, decisions: [], findings: [], requirements: r.requirements.filter((row) => row.status === 'not-checked'),
    promises: r.promises.filter((p) => p.status !== 'verified'), failures: r.failures.filter((f) => f.handling === 'not-checked'),
    writtenClaims: r.writtenClaims.filter((w) => w.label !== 'contradicted') };
  assert.deepEqual(attentionCliLines(onlyFolded), [ATTENTION_CLI_HEADING, `  ${ATTENTION_CLI_NONE}`,
    `  ${ATTENTION_WORDS.folded(FOLDED)}`]);
  const md = renderReview(onlyFolded);
  const head = md.slice(md.indexOf('### Where your attention is needed'), md.indexOf(CHECKLIST_HEADINGS.decisions));
  assert.ok(head.includes(ATTENTION_WORDS.none) && head.indexOf(ATTENTION_WORDS.folded(FOLDED)) > head.indexOf(ATTENTION_WORDS.none));
  const html = renderSessionPage(checklistSession(), onlyFolded);
  const block = html.slice(html.indexOf('<div class="attention">'), html.indexOf('</div>', html.indexOf('<div class="attention">')));
  assert.ok(block.includes(`<p>${PAGE_ATTENTION_WORDS.none}</p>`) && block.includes(`${PAGE_ATTENTION_WORDS.folded(FOLDED)}`));
});

test('D88: every folded row is kept under What Sonah could not check, listed with its evidence and its id within the display bounds', () => {
  const r = report();
  const session = checklistSession();
  const html = renderSessionPage(session, r);
  const start = html.indexOf('<details class="unchecked">');
  const end = html.indexOf('</details></section>', start);
  assert.ok(start > 0 && end > start);
  const folded = html.slice(start, end);
  const outside = html.slice(0, start) + html.slice(end);
  // Each folded row's id is printed inside the folded section and nowhere else on the page.
  const ids = [requirementRowId(r.requirements[2]), requirementRowId(r.requirements[4]), r.promises[0].id, r.promises[1].id,
    failureRowId(r.failures[1]), r.writtenClaims[1].id].map(shortId);
  for (const id of ids) {
    assert.ok(folded.includes(`<code>${id}</code>`), `row ${id} is listed in the folded section`);
    assert.ok(!outside.includes(`<code>${id}</code>`), `row ${id} is listed once, folded`);
  }
  // And every counted row's id outside it.
  for (const id of [requirementRowId(r.requirements[1]), requirementRowId(r.requirements[3]), failureRowId(r.failures[0]),
    r.findings[0].id, r.decisions[0].id, r.writtenClaims[0].id].map(shortId))
    assert.ok(outside.includes(`<code>${id}</code>`) && !folded.includes(`<code>${id}</code>`), `row ${id} stays where it was`);
  // Its evidence: why an ask and a failure are not checked, the action a claim rests on, the written statement's code.
  const text = unescape(folded);
  for (const words of [CHECKLIST_REQUIREMENT_REASON_WORDS.deliverable_ungrounded, CHECKLIST_REQUIREMENT_REASON_WORDS.ask_unreviewed,
    CHECKLIST_FAILURE_REASON_WORDS.response_ungrounded, PAGE_LABELS.restsOn, 'return retry(3, () => fetch(url));'])
    assert.ok(text.includes(words.replace(/^\w/, (c) => c.toUpperCase())) || text.includes(words), words);
  // Each group in FOLDED_ROWS' order, counted under its heading.
  const groups = ['asksNotChecked', 'claimsOpen', 'claimsIncomplete', 'failuresNotChecked', 'writtenOpen']
    .map((kind) => folded.indexOf(`${FOLDED_SECTION_WORDS.groups[kind]} (`));
  assert.ok(groups.every((i, k) => i > 0 && (k === 0 || i > groups[k - 1])), 'the groups in FOLDED_ROWS order');
  // Each section that holds folded rows says how many, linked to the folded section.
  for (const [section, words] of [['requests', FOLDED_SECTION_WORDS.here(1, 'ask')], ['claims', FOLDED_SECTION_WORDS.here(2, 'claim')],
    ['failures', FOLDED_SECTION_WORDS.here(1, 'failure')], ['edits', FOLDED_SECTION_WORDS.here(1, 'statement')]]) {
    const at = html.indexOf(`id="${section}"`);
    const part = html.slice(at, html.indexOf('</section>', at));
    assert.ok(part.includes(`<a href="#unchecked">${words}</a>`), `${section}: ${words}`);
  }

  // The PR comment (review.md): the same rows, folded, last of the checklist.
  const md = renderReview(r);
  const mdAt = md.indexOf(`${CHECKLIST_HEADINGS.folded} (${FOLDED})`);
  assert.ok(mdAt > md.indexOf(CHECKLIST_HEADINGS.edits) && md.indexOf('<details>', mdAt) > mdAt);
  const mdFolded = md.slice(mdAt, md.indexOf('</details>', md.indexOf('<details>', mdAt)));
  for (const words of ['Keep the timeout at 5 seconds', 'It parses JSON', 'The tests pass', '`X1-r`',
    'The fetcher retries three times', CHECKLIST_FAILURE_REASON_WORDS.response_ungrounded])
    assert.ok(mdFolded.includes(words), words);
  assert.ok(!md.slice(0, mdAt).includes('It parses JSON') && !md.slice(0, mdAt).includes('The fetcher retries three times'));

  // The story: under its own heading, after the checklist, folded.
  const story = renderSessionStory(session, r);
  const storyAt = story.indexOf(`## ${FOLDED_SECTION_WORDS.summary(FOLDED)}`);
  assert.ok(storyAt > story.indexOf(`## ${STORY_CHECKLIST_HEADINGS.edits}`));
  const storyFolded = story.slice(storyAt, story.indexOf('</details>', storyAt));
  assert.ok(storyFolded.includes(`<summary>${FOLDED_SECTION_WORDS.show(FOLDED)}</summary>`));
  for (const words of ['Keep the timeout at 5 seconds', 'It parses JSON', 'The tests pass', 'npm run e2e',
    'The fetcher retries three times', CHECKLIST_FAILURE_REASON_WORDS.response_ungrounded])
    assert.ok(storyFolded.includes(words), words);
  for (const words of ['It parses JSON', 'The fetcher retries three times'])
    assert.ok(!story.slice(story.indexOf('## <a name="for-leads">'), storyAt).includes(words), `${words}: listed once, folded`);
});

test('D88: the page leads with the judgment; the folded section is last, a native details element, closed, no script', () => {
  const html = renderSessionPage(checklistSession(), { ...report(), codePass: { ran: true, coverage: 'complete', files: [] } });
  const card = html.slice(html.indexOf('<figure class="card-ui review"'), html.indexOf('</figure>'));
  const sections = [...card.matchAll(/<section class="part" id="([a-z]+)">/g)].map((m) => m[1]);
  assert.deepEqual(sections, ['decisions', 'requests', 'failures', 'claims', 'edits', 'code', 'unchecked']);
  assert.ok(card.indexOf('<div class="attention">') < card.indexOf('id="decisions"'), 'the summary first');
  // The judgment: the choice not to act highlighted, first among the decisions.
  const decisions = card.slice(card.indexOf('id="decisions"'), card.indexOf('id="requests"'));
  assert.ok(decisions.indexOf('class="finding alert not-acting"') > 0);
  // The folded section: one native disclosure element, closed, its summary the heading with its count, last in the card.
  assert.equal((html.match(/<details class="unchecked">/g) ?? []).length, 1);
  assert.doesNotMatch(html, /<details class="unchecked" open/);
  assert.ok(card.includes(`<section class="part" id="unchecked"><details class="unchecked"><summary><h2 class="label">`
    + `${FOLDED_SECTION_WORDS.summary(FOLDED)}</h2></summary>`));
  assert.ok(card.trimEnd().endsWith('</details></section></div>'), 'nothing of the card after it');
  // Still script-free: no script element, no handler attribute, no javascript URL, the CSP allows no script.
  assert.doesNotMatch(html, /<script|\son[a-z]+=|javascript:/i);
  assert.ok(html.includes(`<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline';`));
  // The PR comment and the story follow the same order.
  const md = renderReview(report());
  const mdOrder = [CHECKLIST_HEADINGS.decisions, CHECKLIST_HEADINGS.requests, CHECKLIST_HEADINGS.failures,
    CHECKLIST_HEADINGS.claims, CHECKLIST_HEADINGS.edits, CHECKLIST_HEADINGS.folded].map((h) => md.indexOf(`${h}`));
  assert.ok(mdOrder.every((i, k) => i > 0 && (k === 0 || i > mdOrder[k - 1])), `review.md order: ${mdOrder}`);
  const story = renderSessionStory(checklistSession(), report());
  const storyOrder = ['## <a name="for-leads">', '## <a name="for-product">', `## ${STORY_CHECKLIST_HEADINGS.failures}`,
    `## ${STORY_CHECKLIST_HEADINGS.claims}`, `## ${STORY_CHECKLIST_HEADINGS.edits}`, `## ${FOLDED_SECTION_WORDS.heading}`,
    '## What happened', '## <a name="for-engineers">'].map((h) => story.indexOf(h));
  assert.ok(storyOrder.every((i, k) => i > 0 && (k === 0 || i > storyOrder[k - 1])), `story order: ${storyOrder}`);
});

// ---- the judgment-first review (low findings) --------------------------------------------------------------------------

/** Each reader's folded section, and the rest of it: the page's `<details class="unchecked">`, review.md's and the
 *  story's "What Sonah could not check (N)" through the end of its `<details>`. */
function foldedParts(r, session = checklistSession()) {
  const html = renderSessionPage(session, r);
  const pageFrom = html.indexOf('<details class="unchecked">');
  const pageTo = html.indexOf('</details></section>', pageFrom);
  const md = renderReview(r);
  const mdFrom = md.indexOf(`${CHECKLIST_HEADINGS.folded} (`);
  const mdTo = md.indexOf('</details>', md.indexOf('<details>', mdFrom));
  const story = renderSessionStory(session, r);
  const storyFrom = story.indexOf(`## ${FOLDED_SECTION_WORDS.heading} (`);
  const storyTo = story.indexOf('</details>', storyFrom);
  const split = (text, from, to) => (from > 0 && to > from ? { folded: text.slice(from, to), rest: text.slice(0, from)
    + text.slice(to) } : { folded: '', rest: text });
  // The story's checklist runs from its leads to the folded section; the step-by-step log after it tells each step's
  // events, the agent's words among them, and lists no row.
  const checklist = story.indexOf('## <a name="for-leads">');
  return { page: split(html, pageFrom, pageTo), md: split(md, mdFrom, mdTo),
    story: { folded: story.slice(storyFrom, storyTo), rest: story.slice(checklist, storyFrom) },
    html, markdown: md, storyText: story };
}
const occurrences = (text, words) => text.split(words).length - 1;

test('judgment-first review (medium, test gap): every folded row is listed once, inside the folded section, on every reader', () => {
  const r = report();
  const parts = foldedParts(r);
  // The page: each folded row's id once, inside its details; review.md and the story: each folded row's own words —
  // the ask's why, the failure's why, the claim's and the statement's text — once, inside the folded section.
  const ids = [requirementRowId(r.requirements[2]), requirementRowId(r.requirements[4]), r.promises[0].id, r.promises[1].id,
    failureRowId(r.failures[1]), r.writtenClaims[1].id].map(shortId);
  for (const id of ids) assert.deepEqual([occurrences(parts.page.folded, `<code>${id}</code>`),
    occurrences(parts.page.rest, `<code>${id}</code>`)], [1, 0], `page ${id}`);
  const rows = { 'ask not checked': CHECKLIST_REQUIREMENT_REASON_WORDS.deliverable_ungrounded,
    'ask the review did not name': CHECKLIST_REQUIREMENT_REASON_WORDS.ask_unreviewed,
    'failure not checked': CHECKLIST_FAILURE_REASON_WORDS.response_ungrounded, 'claim not checked': 'It parses JSON',
    'claim on a check that never completed': 'The tests pass', 'statement not checked': 'The fetcher retries three times' };
  // And each ask by its own words as the reader lists an ask: review.md's table cell, the story's quoted line.
  const asks = { md: { 'ask not checked': 'Keep the timeout at 5 seconds' },
    story: { 'ask not checked': '"Keep the timeout at 5 seconds"' } };
  for (const reader of ['md', 'story'])
    for (const [row, words] of Object.entries({ ...rows, ...asks[reader],
      'unnamed ask': 'the review named no ask from this message' }))
      assert.deepEqual([occurrences(parts[reader].folded, words), occurrences(parts[reader].rest, words)], [1, 0],
        `${reader}: the ${row} is listed once, folded`);
  // A settled ask and a failure it acted on stay where they were, outside the folded section, on each reader.
  for (const reader of ['md', 'story']) {
    assert.ok(parts[reader].rest.includes('log each failure') && !parts[reader].folded.includes('log each failure'), reader);
    assert.ok(!parts[reader].folded.includes('I left the logging for later'), reader);
  }
});

test('judgment-first review (low): every reader counts with the one counting, the page included — the reviewer\'s two probes', () => {
  // (1) A claim a contradicted-claim finding still cites, which a producer left among the claims: no reader lists it
  // as a claim (C-06 M33 G3). (2) A decision whose column the ledger did not derive: every reader counts it where the
  // review could not tell whether you asked, as the page's groups place it.
  const base = report();
  const cited = { ...base.promises[1], id: idOf('9'), stated: base.findings[0].receipts[0], text: 'SYNTHETIC_CITED_CLAIM' };
  const r = { ...base, promises: [...base.promises, cited],
    decisions: base.decisions.map((d, i) => (i === 0 ? { ...d, columnState: 'unchecked' } : d)) };
  assert.deepEqual(listedPromises(r).map((p) => p.id), base.promises.map((p) => p.id));
  const { lines, folded, counts } = attentionSummary(r);
  assert.equal(folded, ATTENTION_WORDS.folded(FOLDED), 'the cited claim is folded nowhere');
  assert.equal(counts.whetherAsked, 1);
  assert.equal(counts[DECISION_ROW_KINDS[base.decisions[0].column]], 0, 'its column is not counted');
  assert.deepEqual(rowKindCounts({ decisions: r.decisions, promises: listedPromises(r) }).whetherAsked, 1);
  // The page: the same kinds, the same counts, the same folded line; every reader's folded section the same N.
  const parts = foldedParts(r);
  const block = parts.html.slice(parts.html.indexOf('<div class="attention">'),
    parts.html.indexOf('</div>', parts.html.indexOf('<div class="attention">')));
  const pageLines = [...block.matchAll(/<li(?: class="hl")?><a href="#[a-z]+">([^<]*)<\/a><\/li>/g)].map((m) => unescape(m[1]));
  const kinds = ATTENTION_ROWS.filter((kind) => counts[kind] > 0);
  assert.equal(pageLines.length, kinds.length);
  assert.ok(kinds.includes('whetherAsked') && pageLines.includes(PAGE_ATTENTION_WORDS.whetherAsked(1)));
  assert.ok(block.includes(PAGE_ATTENTION_WORDS.folded(FOLDED)));
  assert.equal(lines.length, kinds.length);
  assert.ok(parts.html.includes(`${FOLDED_SECTION_WORDS.summary(FOLDED)}</h2>`));
  assert.ok(parts.markdown.includes(`${CHECKLIST_HEADINGS.folded} (${FOLDED})`));
  assert.ok(parts.storyText.includes(`## ${FOLDED_SECTION_WORDS.summary(FOLDED)}`));
  for (const reader of ['page', 'md', 'story'])
    assert.ok(!parts[reader].folded.includes('SYNTHETIC_CITED_CLAIM'), `${reader}: the cited claim is its finding`);
});

test('judgment-first review (low): a folded group is headed by how many rows of its kind there are, and says what is not shown inside it', () => {
  // More claims than the page's shared bound for claims and written statements, more than review.md's per group: every
  // reader heads each group by its whole count, lists what fits, and says how many more are not shown, in that group.
  const base = report();
  const claim = base.promises[1];
  const promises = Array.from({ length: 55 }, (_, k) => ({ ...claim, id: `sha256:${String(k).padStart(64, '0')}`,
    text: `SYNTHETIC_OPEN_CLAIM_${k}` }));
  const written = Array.from({ length: 3 }, (_, k) => ({ ...base.writtenClaims[1], id: `sha256:${String(k + 100).padStart(64, '0')}`,
    text: `SYNTHETIC_OPEN_STATEMENT_${k}` }));
  const r = { ...base, promises, writtenClaims: [base.writtenClaims[0], ...written] };
  const parts = foldedParts(r);
  const W = FOLDED_SECTION_WORDS.groups;
  const page = unescape(parts.page.folded);
  // The page: 55 claims not checked, 50 shown (the bound claims and written statements share), so the written group is
  // headed though none of its rows fit, and each cut line stands inside its own group.
  assert.ok(page.includes(`${W.claimsOpen} (55)`), 'claims headed by their count');
  assert.ok(page.includes(`${W.writtenOpen} (3)`), 'a group none of whose rows fit is still headed');
  const groupOf = (heading) => {
    const at = page.indexOf(heading);
    const next = page.indexOf('<h3 class="label">', at);
    return page.slice(at, next < 0 ? undefined : next);
  };
  assert.match(groupOf(`${W.claimsOpen} (55)`), /5 more claims are not shown\./);
  assert.match(groupOf(`${W.writtenOpen} (3)`), /3 statements are not shown\./);
  assert.doesNotMatch(groupOf(`${W.failuresNotChecked} (1)`), /not shown/);
  assert.equal([...page.matchAll(/<li class="finding" id="claim-\d+">/g)].length, 50, 'the 50 the bound holds');
  // review.md: each group headed by its count, at most 20 listed, the rest counted.
  assert.ok(parts.md.folded.includes(`#### ${W.claimsOpen} (55)`));
  assert.ok(parts.md.folded.includes(`#### ${W.writtenOpen} (3)`));
  assert.match(parts.md.folded, /35 more claims recorded and not shown\./);
  // The story: each group headed by its count.
  assert.ok(parts.story.folded.includes(`**${W.claimsOpen} (55)**`));
  assert.ok(parts.story.folded.includes(`**${W.writtenOpen} (3)**`));
});
