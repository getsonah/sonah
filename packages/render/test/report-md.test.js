// The Markdown report (D97): the report model rendered for a pull request comment — the page's
// sections, order and counts; its folds; hostile text kept inert (no block, fold, table or fence opened or closed by a
// quote); no pings; the GitHub permalinks on their own lines, or a fenced excerpt where there is none; the 60,000-byte
// bound and its shortening order; the same bytes for the same inputs; and its snapshot. Every session and report here
// is synthetic.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { renderReportMarkdown, neutraliseMentions, REPORT_MD_LIMITS, REPORT_MD_WORDS, STORY_VERSION }
  from '../session-story.js';
import { renderSessionPage, sessionPage, escapeHtml } from '../session-page.js';
import { reportModel, REPORT_LIMITS, foldNotes } from '../report-model.js';
import { REPORT_SECTION_WORDS, REPORT_TIER_WORDS, REPORT_TRIM_WORDS, REPORT_FOOTER_WORDS, REPORT_TYPE_WORDS,
  REPORT_COUNT_WORDS, REPORT_PROMPT_WORDS, REPORT_HEADER_WORDS, REPORT_DID_WORDS, REPORT_NOT_CHECKED_WORDS }
  from '../report-words.js';
import { REPORT_SHAPES, reportSession, triagedReport, repoFacts, HEAD, START } from './report-fixture.js';
import { sessionBuilder, STORY_KEY } from './session-story-fixture.js';

const SNAPSHOT = new URL('./snapshots/report.md', import.meta.url);
const md = (shape = triagedReport, options = repoFacts()) => {
  const session = reportSession();
  return renderReportMarkdown(session, shape(session), options);
};
const modelOf = (shape = triagedReport, options = repoFacts()) => {
  const session = reportSession();
  return reportModel(session, shape(session), options);
};
const bytes = (text) => Buffer.byteLength(text, 'utf8');
/** A fold's summary line: HTML, which GitHub does not read as Markdown (a backtick there makes no code span). */
const SUMMARY_LINE = /^<details><summary>(.*)<\/summary>$/gm;
/** The Markdown GitHub reads as text: outside the folds' summary lines, fences and code spans. */
const prose = (text) => text.replace(SUMMARY_LINE, ' ').replace(/^(`{3,})[^\n]*\n[\s\S]*?^\1$/gm, ' ')
  .replace(/(`+)[^`]*?\1/g, ' ');
/** What GitHub would link or ping: that Markdown, and each fold's summary outside its `<code>` elements. */
const linkable = (text) => [prose(text), ...[...text.matchAll(SUMMARY_LINE)]
  .map(([, html]) => html.replace(/<code>[^<]*<\/code>/g, ' '))].join('\n');
/** The tags of each fold's summary: only the report's own (its item anchor, the review's words in italics, code). */
const summaryTags = (text) => [...text.matchAll(SUMMARY_LINE)].flatMap(([, html]) => html.match(/<[^>]*>/g) ?? []);
const OWN_SUMMARY_TAG = /^(?:<a name="item-\d+">|<\/a>|<em>|<\/em>|<code>|<\/code>)$/;
const r = (role, eventId, quote) => ({ role, eventId, quote, sessionKey: STORY_KEY });
const windowOf = (session) => [{ windowIndex: 0, eventIds: session.events.map((e) => e.id), failure: null }];

test('D97 (snapshot): the synthetic report renders exactly its .md snapshot', () => {
  assert.equal(md(), readFileSync(SNAPSHOT, 'utf8'));
  // D101 moved it once more (sonah.session-story/36): an ask says which test refused its quote.
  // D104 moved it once more (sonah.session-story/37): the shown-in-part mark. Bucket B once more
  // (sonah.session-story/38): what the code review saw short of whole (D105), and why no repaired version was checked,
  // by identity (D107). In the same move (D110): the premise contract, a finding to verify, no second reviewer;
  // (D111) the accounting's footer counts; and (D112) an item's members, and the order by final level. D112 amended
  // (2026-10-18, unreleased, no version move): the fixture's Q1 names no place (quote null), so it is an item of its own.
  // D113 and D114 once more (sonah.session-story/39, 0.3.0-beta.5): the session's own change, and the files changed
  // outside it.
  // In the same move (D115 and D116): a row of the session review in words no wider than the field it rests on, and a
  // question's pointer only where code checked its tie. D122 (b) (the beta.5 integration, no version move: /39 is
  // beta.5's one move): the fixture's refused read, a failure passed over, is in Must know (no refused-read default).
  // D126 and D127 once more (sonah.session-story/40, 0.3.0-beta.6): the line beside the title for a session that opens on a
  // compaction, each compaction among your messages, and the first compaction after an ask. In the same move (D129, C7):
  // the footer says what the review cost.
  assert.equal(STORY_VERSION, 'sonah.session-story/40');
});

test('D97 (1): the .md has the report model\'s sections in order, with the page\'s counts, for every report shape', () => {
  for (const [letter, shape] of Object.entries(REPORT_SHAPES)) {
    const session = reportSession();
    const report = shape(session);
    const text = renderReportMarkdown(session, report, repoFacts());
    const page = renderSessionPage(session, report, repoFacts());
    const model = reportModel(session, report, repoFacts());
    const at = (marker) => { const i = text.indexOf(marker); assert.ok(i >= 0, `${letter}: ${marker}`); return i; };
    // D131 (R1, B12): Must act and Must know before your prompt.
    const headings = [
      '## Sonah review',
      `### ${REPORT_SECTION_WORDS.tier(REPORT_TIER_WORDS.must_act, model.tiers.must_act.length)}`,
      `### ${REPORT_SECTION_WORDS.tier(REPORT_TIER_WORDS.must_know, model.tiers.must_know.length)}`,
      `### ${REPORT_SECTION_WORDS.promptCounted(model.prompt.asks.length, model.prompt.parts.join(', '))}`,
      `<details><summary>${REPORT_SECTION_WORDS.tier(REPORT_TIER_WORDS.good_to_know, model.tiers.good_to_know.length)}</summary>`,
      `<details><summary>${REPORT_SECTION_WORDS.didCounted(model.did.files.total, model.did.runs.commands, model.did.runs.others,
        model.did.claims.total)}</summary>`,
      `<details><summary>${REPORT_SECTION_WORDS.notCheckedCounted(model.notChecked.total)}</summary>`,
      `\n---\n`];
    const order = headings.map(at);
    assert.deepEqual(order, [...order].sort((a, b) => a - b), letter);
    // The page holds the same section counts (its headings and fold summaries).
    for (const heading of headings.slice(1, 7)) {
      const words = heading.replace(/^#+ |<details><summary>|<\/summary>/g, '');
      assert.ok(page.includes(words.replace(/'/g, '&#39;')), `${letter}: the page says ${words}`);
    }
    // The count line, with "(folded)", and each item numbered once, its type word first.
    const tiers = model.countLine.tiers.map((t) => `${REPORT_COUNT_WORDS.tier(t.words, t.n)}${t.folded ? ' (folded)' : ''}`);
    assert.ok(text.includes(`${tiers.join(' · ')} · ${model.countLine.prompt}`), letter);
    for (const item of [...model.tiers.must_act, ...model.tiers.must_know])
      assert.equal(text.split(`<a name="item-${item.n}"></a>**${item.n} ${REPORT_TYPE_WORDS[item.type]}:**`).length - 1, 1,
        `${letter}: item ${item.n}`);
    for (const item of model.tiers.good_to_know)
      assert.equal(text.split(`<summary><a name="item-${item.n}"></a>${item.n} ${REPORT_TYPE_WORDS[item.type]}: `).length - 1, 1,
        `${letter}: item ${item.n}`);
    // No answer command: teammates cannot run it. The footer says who "you" is, and to read the report first.
    assert.equal(text.includes('sonah decision'), false, letter);
    assert.ok(text.includes(REPORT_FOOTER_WORDS.youMeans) && text.endsWith(`${REPORT_FOOTER_WORDS.share}\n`), letter);
  }
});

test('D97 (1, D93): the count line counts an ask with a code finding apart, never as done', () => {
  const text = md();
  assert.match(text, /Your prompt: 1 done, 1 done with a code finding, 1 partly done, 2 not done, 1 not checked/);
  // The prompt table: one row an ask, its status word, your words cut after 12 words, and Sonah's note.
  assert.match(text, /\n\| Status \| You asked \| Sonah's note \|\n\|---\|---\|---\|\n/);
  assert.match(text, /\n\| Done \| “Add rate limiting to the API” \| The code review found a problem here\. See item \d+\. \|\n/);
  // The fixture's first message holds 30 words, its second 7: counted as written, punctuation is no word.
  assert.equal(REPORT_MD_WORDS.wholeMessage(30), 'Your whole message (30 words)');
  assert.ok(text.includes('<details><summary>Your whole message (30 words)</summary>'));
  assert.ok(text.includes('<details><summary>Your whole message (7 words)</summary>'));
});

test('D97 (1): a message\'s word count is the count of its words as written, whatever the asks cut it into', () => {
  const counted = (message, quotes) => {
    const b = sessionBuilder();
    b.ask('I1', message);
    b.say('F1', 'Done.', 'final');
    const session = b.session();
    const text = renderReportMarkdown(session, { windowResults: windowOf(session), sessionReview: 'complete',
      coverage: 'complete', requirements: quotes.map((quote) => ({ text: quote, instruction: r('instruction', 'I1', quote),
        status: 'done', deliverable: r('commentary', 'F1', 'Done.') })) }, {});
    return Number(/<details><summary>Your whole message \((\d+) words?\)<\/summary>/.exec(text)?.[1]);
  };
  assert.equal(counted('Fix the bug in parse.js, then add a test. Keep the API stable; do not touch CI.',
    ['Fix the bug in parse.js', 'add a test', 'Keep the API stable', 'do not touch CI']), 17);
  assert.equal(counted('Also add a test for the limiter.', ['add a test for the limiter']), 7);
  assert.equal(counted('Also add a test for the limiter.', ['Also add a test for the limiter.']), 7);
});

test('D97 (1): the .md says once, after the table, that Sonah checked only what the table lists; the page keeps its line',
  () => {
  const text = md();
  // Nothing in the .md's messages is marked: the table names the asks.
  assert.equal(text.includes(REPORT_PROMPT_WORDS.coverage), false);
  assert.equal(text.split(REPORT_MD_WORDS.coverage).length - 1, 1);
  assert.match(text, new RegExp(`\\|\\n\\n${REPORT_MD_WORDS.coverage.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\n`));
  assert.equal(REPORT_MD_WORDS.coverage, 'Sonah checked only the parts of your prompt that the table above lists.');
  // The page marks each ask in its message, and says so under each message.
  const session = reportSession();
  assert.ok(renderSessionPage(session, triagedReport(session), repoFacts()).includes(REPORT_PROMPT_WORDS.coverage));
});

test('D97 (2): a message line made of "=" never makes the line above it a heading', () => {
  const b = sessionBuilder();
  b.ask('I1', 'Release notes\n=============\nAdd the limiter.');
  b.say('F1', 'Done.', 'final');
  const session = b.session();
  const text = renderReportMarkdown(session, { windowResults: windowOf(session), sessionReview: 'complete',
    coverage: 'complete', requirements: [{ text: 'limiter', instruction: r('instruction', 'I1', 'Add the limiter.'),
      status: 'done', deliverable: r('commentary', 'F1', 'Done.') }] }, {});
  assert.ok(text.includes('\n> Release notes\n> \\=============\n> Add the limiter.\n'), text);
  assert.equal(/^> =/m.test(text), false);
});

test('D97 (2): a path or a command that holds backticks is one code span, its fence longer than any run in it', () => {
  const b = sessionBuilder();
  b.ask('I1', 'Stamp the build.');
  b.change('W1', 'src/odd`name.js', { after: 'x\n' });
  b.run('R1', 'echo `date` && echo ``twice``', 'failed', 'boom');
  b.say('F1', 'Done.', 'final');
  const session = b.session();
  const text = renderReportMarkdown(session, { windowResults: windowOf(session), sessionReview: 'complete',
    coverage: 'complete', requirements: [{ text: 'stamp', instruction: r('instruction', 'I1', 'Stamp the build.'),
      status: 'done', deliverable: r('code', 'W1', 'x') }] }, {});
  assert.ok(text.includes('- ``src/odd`name.js`` · '), text);
  // A span whose text ends with a backtick is padded with a space on each side, which GitHub takes off.
  assert.ok(text.includes(' · ``` echo `date` && echo ``twice`` ``` · '), text);
});

test('D97 (1): the table cuts an ask after 12 words, the cut outside the quotation marks; a quoted line keeps its indent',
  () => {
  const b = sessionBuilder();
  const ask = 'Add a limiter that keeps ten requests a second for each client and answers 429 when it is full.';
  b.ask('I1', `${ask}\n    - keep the auth first\n\tthen the limiter`);
  b.say('F1', 'Done.', 'final');
  const session = b.session();
  const text = renderReportMarkdown(session, { windowResults: windowOf(session), sessionReview: 'complete',
    coverage: 'complete', requirements: [{ text: 'limit', instruction: r('instruction', 'I1', ask), status: 'done',
      deliverable: r('commentary', 'F1', 'Done.') }] }, {});
  assert.match(text, /\n\| Done \| “Add a limiter that keeps ten requests a second for each client”… \| /);
  // In the whole message, a line's leading spaces are no-break spaces (a tab two): no line opens a list or a code block.
  assert.ok(text.includes('\n> &nbsp;&nbsp;&nbsp;&nbsp;\\- keep the auth first\n> &nbsp;&nbsp;then the limiter\n'), text);
});

test('D97 (2): hostile text cannot open a block, end a fold, or break the table or a fence', () => {
  const hostile = '</details> # Heading | cell ``` fence `tick` <b>bold</b> - [x] *em* ~~struck~~ $x^2$';
  const b = sessionBuilder();
  b.ask('I1', `Fix it. ${hostile}`);
  b.say('C1', 'I switch the store.');
  b.say('F1', `Done. ${hostile}`, 'final');
  b.change('W1', 'src/a.js', { after: `const a = "${hostile}";\n` });
  const session = b.session();
  const report = { windowResults: windowOf(session), sessionReview: 'complete', coverage: 'complete',
    requirements: [{ text: 'fix', instruction: r('instruction', 'I1', hostile), status: 'not-done',
      shortfall: r('commentary', 'F1', hostile) }],
    decisions: [{ dimension: `x ${hostile}`, chosen: hostile, column: 'unasked', columnState: 'grounded', actions: ['W1'],
      stated: r('commentary', 'F1', hostile) },
    // Good to know: its words are in the item's fold summary, which is HTML, not Markdown.
    { dimension: 'y', chosen: `y ${hostile}`, column: null, columnState: 'unchecked', reasons: ['instructions_partial'],
      actions: ['W1'] }],
    pivots: [{ abandoned: hostile, adopted: `z ${hostile}`, receipts: [r('commentary', 'C1', 'I switch the store.')] }],
    promises: [{ id: 'sha256:'.padEnd(71, 'a'), stated: r('commentary', 'F1', hostile), text: hostile, status: 'open',
      receipts: [r('commentary', 'F1', hostile)] }] };
  const model = reportModel(session, report, {});
  assert.deepEqual(model.tiers.good_to_know.map((item) => item.kind), ['pivot', 'decision_whether_asked']);
  const text = renderReportMarkdown(session, report, {});
  const lines = text.split('\n');
  // Every fold this report opens, it closes, and only its own lines open or close one.
  const opens = lines.filter((l) => l.startsWith('<details>')).length;
  assert.ok(opens >= 4);
  assert.equal(lines.filter((l) => l === '</details>').length, opens);
  assert.equal(text.split('</details>').length - 1, opens, 'no quote closes a fold');
  assert.equal(text.split('<details>').length - 1, opens, 'no quote opens a fold');
  // A fold's summary holds the review's words as text: no tag but the report's own, the markup escaped.
  for (const tag of summaryTags(text)) assert.match(tag, OWN_SUMMARY_TAG);
  for (const item of model.tiers.good_to_know) {
    const summary = lines.find((l) => l.startsWith(`<details><summary><a name="item-${item.n}"></a>`));
    // A balanced single-backtick span is a <code> element; the rest is text.
    assert.ok(summary.includes('&lt;/details&gt; # Heading | cell ``` fence <code>tick</code> &lt;b&gt;bold&lt;/b&gt;'),
      summary);
  }
  // No heading but the report's own.
  for (const line of lines.filter((l) => /^ {0,3}#{1,6}(?:\s|$)/.test(l)))
    assert.match(line, /^(?:## Sonah review|### |#### )/, line);
  // Every table row has its three cells: four pipes no backslash escapes.
  const rows = lines.filter((l) => l.startsWith('| '));
  assert.equal(rows.length, 2, "the heading row and one ask");
  for (const row of rows) assert.equal(row.match(/(?<!\\)\|/g).length, 4, row);
  // No fence but an excerpt's, and none here: the hostile backticks are escaped.
  assert.equal(lines.some((l) => /^\s*(?:```|~~~)/.test(l)), false);
  // Markup is text: no tag of the recording reaches the comment, no text strikes itself through or renders as math.
  assert.equal(/<b>|<\/b>/.test(text), false);
  const outside = prose(text);
  assert.equal(/(?<!\\)~~/.test(outside), false, 'no unescaped ~~');
  assert.equal(/(?<!\\)\$/.test(outside), false, 'no unescaped $');
  assert.ok(text.includes('\\~\\~struck\\~\\~') && text.includes('\\$x^2\\$'));
  assert.ok(text.includes('&lt;/details&gt;'));
  // A fenced excerpt holding a backtick run is fenced by a longer one.
  const session2 = reportSession();
  const fenced = triagedReport(session2);
  const lines4 = ['const a = 1;', 'const b = "````";'];
  fenced.codePass.findings[0] = { ...fenced.codePass.findings[0], anchorSpan: { startLine: 2, lines: lines4, linesCut: 0,
    charsCut: 0 } };
  const noLinks = renderReportMarkdown(session2, fenced, {});
  assert.match(noLinks, /\n`````\nconst a = 1;\nconst b = "````";\n`````\n/);
});

test('D97 (2): a balanced single-backtick span is code in the .md and on the page; inside it nothing pings or renders',
  () => {
  const message = 'In ufo, `withTrailingSlash` must leave `mailto:` alone. Ping `@octocat` about `#12`, not `</details><b>x</b>`. '
    + 'Keep `a|b` and `` `` and `x';
  const b = sessionBuilder();
  b.ask('I1', message);
  b.say('F1', 'Done.', 'final');
  b.change('W1', 'src/utils.ts', { after: 'const x = 1;\n' });
  const session = b.session();
  const report = { windowResults: windowOf(session), sessionReview: 'complete', coverage: 'complete',
    requirements: [{ text: 'leave', instruction: r('instruction', 'I1', '`withTrailingSlash` must leave `mailto:` alone'),
      status: 'not-done', shortfall: r('commentary', 'F1', 'Done.') }],
    decisions: [{ id: `sha256:${'d'.repeat(64)}`, dimension: 'the `opts` shape', chosen: 'a `TrailingSlashOptions` type',
      column: 'unasked', columnState: 'grounded', actions: ['W1'], stated: null }] };
  const text = renderReportMarkdown(session, report, {});
  // The title, the whole message, the table and the review's words: each span a code span, the rest escaped as before.
  assert.ok(text.startsWith('## Sonah review · “In ufo, `withTrailingSlash` must leave `mailto:` alone.”'), text);
  assert.ok(text.includes('> In ufo, `withTrailingSlash` must leave `mailto:` alone. Ping `@octocat` about `#12`, not '
    + '`</details><b>x</b>`. Keep `a|b` and \\`\\` \\`\\` and \\`x\n'), text);
  assert.ok(text.includes('| “`withTrailingSlash` must leave `mailto:` alone” |'), text);
  assert.ok(text.includes('*a `TrailingSlashOptions` type*'), text);
  // Nothing pings outside a code span, and only the report's own lines open or close a fold.
  assert.doesNotMatch(linkable(text), /@octocat|#12|<b>|<\/details><b>/);
  assert.equal(text.split('\n').filter((l) => l === '</details>').length,
    text.split('\n').filter((l) => l.startsWith('<details>')).length);
  // In the table a span keeps its cell: its pipe is escaped, as GitHub reads a table.
  const b2 = sessionBuilder();
  b2.ask('I1', 'Keep `a|b` as is.');
  b2.say('F1', 'Done.', 'final');
  const s2 = b2.session();
  const cellText = renderReportMarkdown(s2, { windowResults: windowOf(s2), requirements: [{ text: 'keep',
    instruction: r('instruction', 'I1', 'Keep `a|b` as is.'), status: 'done', deliverable: r('commentary', 'F1', 'Done.') }] }, {});
  assert.ok(cellText.includes('| Done | “Keep `a\\|b` as is.” |'), cellText);
  // A span a neutralised token touches stays text: two backtick runs never meet.
  assert.equal(neutraliseMentions('x'), 'x');
  const b3 = sessionBuilder();
  b3.ask('I1', 'See #12`x` now.');
  b3.say('F1', 'Done.', 'final');
  const s3 = b3.session();
  const touching = renderReportMarkdown(s3, { windowResults: windowOf(s3), requirements: [{ text: 'see',
    instruction: r('instruction', 'I1', 'See #12`x` now.'), status: 'done', deliverable: r('commentary', 'F1', 'Done.') }] }, {});
  assert.ok(touching.includes('> See `#12`\\`x\\` now.\n'), touching);
  // The page shows the same spans as <code>, its text escaped.
  const page = renderSessionPage(session, report, {});
  assert.ok(page.includes('In ufo, <code>withTrailingSlash</code> must leave <code>mailto:</code> alone.'));
  assert.ok(page.includes('<code>&lt;/details&gt;&lt;b&gt;x&lt;/b&gt;</code>'));
  assert.ok(page.includes('a <code>TrailingSlashOptions</code> type'));
  assert.equal(page.includes('<b>x</b>'), false);
});

// Ported from the Markdown review's and the story's test (both deleted, D97): a finding's kind and anchor lines come from
// a model, so a kind outside the closed list, or a line number that is not a number, never reaches a reader as sent.
test('D97 (2): a finding kind and anchor line numbers are read by structure, never printed as sent', () => {
  const b = sessionBuilder();
  b.ask('I1', 'Synthetic ask.');
  b.change('W0', 'src/a.js', { after: 'a\nb\n' });
  const session = b.session();
  const anchor = { path: 'src/a.js', side: 'RIGHT', startLine: '1</b>', endLine: 2 };
  const report = { windowResults: windowOf(session), sessionReview: 'complete', coverage: 'complete',
    findings: ['session-review', 'code-review'].map((origin) => ({ origin, kind: '**injected**',
      title: `SYNTHETIC ${origin} title`, explanation: 'e', receipts: [], scope: 'current-code', status: 'DECIDE', anchor })) };
  const model = reportModel(session, report, {});
  // The code review's finding of an unknown kind is an earlier code review's finding; the other is a row Sonah could not
  // read, placed and named, never dropped.
  assert.deepEqual(Object.values(model.tiers).flat().map((item) => item.kind), ['code_finding_legacy']);
  assert.deepEqual(model.placement.rows['findings:0'], { notChecked: 'unreadRows' });
  for (const text of [renderReportMarkdown(session, report, {}), renderSessionPage(session, report, {})]) {
    assert.match(text, /SYNTHETIC code-review title/);
    assert.doesNotMatch(text, /injected|1<\/b>|1&lt;\/b&gt;|src\/a\.js:1/);
  }
});

test('D97 (2a): no pings — mentions, issues and bare commit hashes in recorded and reviewers\' text are code spans', () => {
  const sha = 'abcdef0123456789abcdef0123456789abcdef01';
  const words = `cc @octocat on #12 and getsonah/sonah#12 at ${sha}`;
  assert.equal(neutraliseMentions(words), `cc \`@octocat\` on \`#12\` and \`getsonah/sonah#12\` at \`${sha}\``);
  // A hash is a run of 7 to 64 hexadecimal characters that stands alone: shorter, longer or inside a word, it is text.
  assert.equal(neutraliseMentions('abcdef0 abcdef'), '`abcdef0` abcdef');
  assert.equal(neutraliseMentions(`${'a'.repeat(64)} ${'b'.repeat(65)} x${'c'.repeat(8)}`),
    `\`${'a'.repeat(64)}\` ${'b'.repeat(65)} x${'c'.repeat(8)}`);
  const session = reportSession();
  const report = triagedReport(session);
  // A quote (the session holds it), a finding's title and an impact line.
  report.codePass.findings[0] = { ...report.codePass.findings[0], title: words };
  report.codePass.triage[0] = { ...report.codePass.triage[0], impact: words };
  // Good to know items, whose words are in their fold's summary (HTML): a finding triaged low, a question of the code
  // review with no check, and a change of approach.
  const marked = `</details> <b>x</b> ${words}`;
  report.codePass.findings[4] = { ...report.codePass.findings[4], title: marked };
  report.codePass.questions[2] = { ...report.codePass.questions[2], question: marked };
  report.pivots = [{ ...report.pivots[0], abandoned: marked, adopted: words }];
  const gtk = reportModel(session, report, repoFacts()).tiers.good_to_know;
  assert.deepEqual(gtk.filter((item) => ['code_weak_test', 'code_question', 'pivot'].includes(item.kind)).length, 3);
  const all = renderReportMarkdown(session, report, repoFacts());
  for (const item of gtk.filter((x) => ['code_weak_test', 'code_question', 'pivot'].includes(x.kind))) {
    const summary = all.split('\n').find((l) => l.startsWith(`<details><summary><a name="item-${item.n}"></a>`));
    for (const token of ['<code>@octocat</code>', '<code>#12</code>', '<code>getsonah/sonah#12</code>',
      `<code>${sha}</code>`, '&lt;/details&gt; &lt;b&gt;x&lt;/b&gt;']) assert.ok(summary.includes(token), `${token}: ${summary}`);
  }
  for (const tag of summaryTags(all)) assert.match(tag, OWN_SUMMARY_TAG);
  // Every fold closes one that opens at the start of a line; D133 (R2): or an ask row's fold, which opens and closes
  // inside its table cell, on the row's own line.
  const rowFolds = all.split('\n').filter((l) => l.startsWith('| ')).reduce((n, l) => n + l.split('<details>').length - 1,
    0);
  assert.ok(all.split('\n').filter((l) => l.startsWith('| ')).every((l) => l.split('<details>').length
    === l.split('</details>').length), 'a row fold closes on its own line');
  assert.equal(all.split('</details>').length - 1, all.split('\n').filter((l) => l.startsWith('<details>')).length
    + rowFolds);
  const b = sessionBuilder();
  b.ask('I1', `Please ${words}.`);
  b.say('F1', 'Done.', 'final');
  const quoted = b.session();
  const quoteMd = renderReportMarkdown(quoted, { windowResults: windowOf(quoted), requirements: [{ text: 'x',
    instruction: r('instruction', 'I1', words), status: 'done', deliverable: r('commentary', 'F1', 'Done.') }] }, {});
  for (const text of [renderReportMarkdown(session, report, repoFacts()), quoteMd]) {
    const outside = linkable(text);
    assert.doesNotMatch(outside, /@octocat|#12\b|abcdef0123456789/);
    for (const token of ['`@octocat`', '`#12`', '`getsonah/sonah#12`', `\`${sha}\``]) assert.ok(text.includes(token), token);
  }
  // Sonah's own text is not wrapped: the footer's commit and the permalinks stay links.
  const text = renderReportMarkdown(session, report, repoFacts());
  assert.match(text, new RegExp(`\\n${REPORT_FOOTER_WORDS.provenance('0.9.0', 'sonah.report-model/6', HEAD.slice(0, 7))
    .replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')}  \\n`));
  assert.match(text, new RegExp(`\\nhttps://github\\.com/example-org/example-api/blob/${HEAD}/src/limiter\\.js#L2-L3\\n`));
});

test('D97 (2a): a recorded path in Sonah\'s own sentences is a code span, so it pings no one and links nothing', () => {
  const b = sessionBuilder();
  b.ask('I1', 'Write the notes.');
  b.change('W1', '@octocat', { after: 'Ping.\n' });
  b.change('W2', '/tmp/#12/@octocat.md', { after: 'Scratch.\n', outside: true });
  b.change('W3', 'docs/@hubot', { after: 'The notes are complete.\n' });
  b.say('F1', 'Done.', 'final');
  const session = b.session();
  const report = { windowResults: windowOf(session), sessionReview: 'complete', coverage: 'complete',
    requirements: [{ text: 'notes', instruction: r('instruction', 'I1', 'Write the notes.'), status: 'done',
      deliverable: r('code', 'W3', 'The notes are complete.') }],
    writtenClaims: [{ id: `sha256:${'f'.repeat(64)}`, stated: r('code', 'W3', 'The notes are complete.'),
      text: 'complete', label: 'unverified', receipts: [r('code', 'W3', 'The notes are complete.')] }] };
  const text = renderReportMarkdown(session, report, {});
  assert.doesNotMatch(linkable(text), /@octocat|@hubot|#12/);
  for (const line of ['\nThe agent also changed 1 file outside the repository: `/tmp/#12/@octocat.md`.\n',
    '\nSonah found no command that ran after the last edit of: `@octocat`, `docs/@hubot`.\n',
    ' · written into `docs/@hubot`\n']) assert.ok(text.includes(line), line);
});

test('D97 (3): permalinks are bare URLs on their own lines, at most 8 lines; old-side links need the start commit pushed',
  () => {
  const session = reportSession();
  const report = triagedReport(session);
  report.codePass.findings[4] = { ...report.codePass.findings[4], anchor: { ...report.codePass.findings[4].anchor,
    startLine: 2, endLine: 30 } };
  report.codePass.findings[5] = { ...report.codePass.findings[5], anchor: { ...report.codePass.findings[5].anchor,
    side: 'old', startLine: 1, endLine: 1 } };
  const text = renderReportMarkdown(session, report, repoFacts());
  const urls = text.split('\n').filter((l) => l.startsWith('https://'));
  assert.ok(urls.length >= 8);
  for (const url of urls) {
    assert.match(url, new RegExp(`^https://github\\.com/example-org/example-api/blob/(?:${HEAD}|${START})/\\S+$`));
    const range = /#L(\d+)(?:-L(\d+))?$/.exec(url);
    if (range?.[2]) assert.ok(Number(range[2]) - Number(range[1]) + 1 <= REPORT_LIMITS.permalinkLines, url);
    // Its own paragraph: a blank line before and after it.
    assert.ok(text.includes(`\n\n${url}\n\n`), url);
  }
  assert.ok(urls.includes(`https://github.com/example-org/example-api/blob/${HEAD}/src/limiter.js#L2-L9`));
  assert.ok(urls.includes(`https://github.com/example-org/example-api/blob/${START}/src/limiter.js#L1`));
  // A commit not on GitHub is said once, in the header, of when Sonah wrote the report (so it stays true after you push
  // and post it), by the side whose links are missing and naming only those: a place on the other side keeps its link.
  const blob = (sha) => new RegExp(`https://github\\.com/[^\\n]*/blob/${sha}/`);
  // The .md of `options`, and the header's sentences on links: each said once in it, and no other such sentence.
  const said = (options, r = report) => {
    const text = renderReportMarkdown(session, r, options);
    const notes = reportModel(session, r, options).header.noLinks;
    for (const note of notes) assert.equal(text.split(note).length - 1, 1, note);
    assert.equal(text.split('on GitHub').length - 1, notes.length);
    return { text, notes };
  };
  const startNote = REPORT_HEADER_WORDS.notOnGitHub.old(START.slice(0, 7));
  const headNote = REPORT_HEADER_WORDS.notOnGitHub.new(HEAD.slice(0, 7));
  assert.equal(startNote, 'When Sonah wrote this report, git did not show commit 2222222 on GitHub. The report has no links to '
    + 'the code as it was before the session.');
  assert.equal(headNote, 'When Sonah wrote this report, git did not show commit 1111111 on GitHub. The report has no links to '
    + 'the code as the agent left it.');
  // The start commit not on GitHub: no old-side link; the links to the code as the agent left it stay.
  const unpushed = said(repoFacts({ github: { startPushed: false } }));
  assert.equal(blob(START).test(unpushed.text), false);
  assert.equal(blob(HEAD).test(unpushed.text), true, 'a new-side place keeps its link');
  assert.deepEqual(unpushed.notes, [startNote]);
  assert.ok(unpushed.text.indexOf(startNote) < unpushed.text.indexOf('### Your prompt'));
  assert.equal(unpushed.text.includes('not on GitHub yet, so Sonah gives no link'), false);
  // HEAD not on GitHub: no new-side link, and each such place is its path and line only; the old-side link stays.
  const headUnpushed = said(repoFacts({ github: { pushed: false } }));
  assert.equal(blob(HEAD).test(headUnpushed.text), false);
  assert.equal(blob(START).test(headUnpushed.text), true, 'an old-side place keeps its link');
  assert.deepEqual(headUnpushed.notes, [headNote]);
  assert.equal(headUnpushed.text.includes('not on GitHub yet'), false, 'never a present-tense claim that goes stale');
  assert.equal(headUnpushed.text.includes('so Sonah gives no link'), false, 'no place repeats a reason of the repository');
  assert.deepEqual(said(repoFacts({ github: { pushed: false } }), triagedReport(session)).notes, [headNote],
    'with no old-side place');
  // Both commits not on GitHub: no link at all, and each side's sentence names its own commit.
  const neither = said(repoFacts({ github: { pushed: false, startPushed: false } }));
  assert.equal(/https:\/\/github\.com/.test(neither.text), false);
  assert.deepEqual(neither.notes, [headNote, startNote]);
  // One commit that both sides need, not on GitHub: no link at all, said once.
  const one = said(repoFacts({ repo: { start: HEAD }, github: { pushed: false, startPushed: false } }));
  assert.equal(/https:\/\/github\.com/.test(one.text), false);
  assert.deepEqual(one.notes, [REPORT_HEADER_WORDS.notOnGitHub.both(HEAD.slice(0, 7))]);
  assert.equal(one.notes[0], 'When Sonah wrote this report, git did not show commit 1111111 on GitHub, so the report has no code '
    + 'links.');
  // No GitHub remote: said once, the same way.
  const noRemote = renderReportMarkdown(session, triagedReport(session), { ...repoFacts(), github: null });
  assert.equal(noRemote.split(REPORT_HEADER_WORDS.noGitHubRemote).length - 1, 1);
  assert.equal(renderSessionPage(session, triagedReport(session), { ...repoFacts(), github: null })
    .split(REPORT_HEADER_WORDS.noGitHubRemote).length - 1, 1);
  assert.equal(renderSessionPage(session, triagedReport(session), repoFacts({ github: { pushed: false } }))
    .split(headNote).length - 1, 1);
  // No facts, or the file not at HEAD: `path:line` and a fenced excerpt of at most 8 lines, no URL.
  for (const options of [{}, repoFacts({ repo: { atHead: [] } })]) {
    const plain = renderReportMarkdown(session, triagedReport(session), options);
    assert.equal(/https:\/\/github\.com/.test(plain), false);
    const fence = /\n```\n([\s\S]*?)\n```\n/.exec(plain);
    assert.ok(fence, 'an excerpt is fenced');
    assert.ok(fence[1].split('\n').length <= REPORT_LIMITS.excerptLines);
    assert.match(plain, /Where: `src\/limiter\.js:2-3`/);
  }
  assert.match(renderReportMarkdown(session, triagedReport(session), repoFacts({ repo: { atHead: [] } })),
    /- This file differs from the last commit, so Sonah gives no link\./);
  // With a permalink, the excerpt is not repeated as a fence: GitHub shows the code from the link.
  assert.equal(/\n```\n/.test(md()), false);
});

/** A review whose evidence and lists are the bulk: the same report with many decisions made without asking (Must
 *  know items, each with the session review's long words in its evidence fold), decisions you settled (a list of what
 *  the agent did) and long pasted messages. */
function oversized(session, { settled = 1500, unasked = 60 } = {}) {
  const report = triagedReport(session);
  const long = (k) => `${'word '.repeat(60)}${k}`;
  report.decisions = [...report.decisions,
    ...Array.from({ length: settled }, (_, k) => ({ id: `sha256:${String(k).padStart(64, '0')}`, dimension: long(k),
      chosen: long(k), column: 'asked-settled', columnState: 'grounded', actions: [], stated: null })),
    ...Array.from({ length: unasked }, (_, k) => ({ id: `sha256:${String(k + 5000).padStart(64, '0')}`,
      dimension: long(k), chosen: `pick ${k}`, column: 'unasked', columnState: 'grounded', actions: ['W1'], stated: null }))];
  return report;
}

test('D97 (4), D131: past 60,000 bytes the report is shortened in order; header, count line, not-done asks and Must lines stay', () => {
  const session = reportSession();
  const report = oversized(session);
  const model = reportModel(session, report, repoFacts());
  const full = renderReportMarkdown(session, report, repoFacts());
  assert.ok(bytes(full) <= REPORT_MD_LIMITS.maxBytes, `${bytes(full)} bytes`);
  // D131 (R1): said once, at the top of the first section it shortened, in reading order: your prompt, after Must act and
  // Must know, whose table keeps the asks that are not done and whose messages are counted.
  assert.equal(full.split(REPORT_TRIM_WORDS.mdShortened).length - 1, 1);
  const promptHeading = `### ${REPORT_SECTION_WORDS.promptCounted(model.prompt.asks.length, model.prompt.parts.join(', '))}`;
  assert.ok(full.includes(`${promptHeading}\n\n${REPORT_TRIM_WORDS.mdShortened}\n\n`));
  // Never shortened: the header, the count line, the prompt's counts and its rows of asks not done, and every visible
  // line of Must act and Must know.
  for (const line of [model.header.size.join(' · '), model.header.runs.join(' '), model.countLine.prompt])
    assert.ok(full.includes(line), line);
  const rows = full.split('\n').filter((l) => l.startsWith('| '));
  const notDone = model.prompt.asks.filter((ask) => ask.state !== 'done');
  assert.ok(notDone.length > 0 && notDone.length < model.prompt.asks.length);
  assert.equal(rows.length, notDone.length + 1, 'the prompt table: its heading and one row an ask that is not done');
  for (const ask of notDone) assert.ok(rows.some((row) => row.startsWith(`| ${ask.status} | “${ask.words[0].text}”`)));
  assert.ok(full.includes(`|\n\n${REPORT_NOT_CHECKED_WORDS.rowsNotShown(model.prompt.asks.length - notDone.length)}\n\n`));
  assert.ok(full.includes(REPORT_MD_WORDS.messagesNotShown(model.prompt.messages.length + model.prompt.emptyMessages.length)));
  assert.equal(full.includes('<details><summary>Your whole message'), false, 'your messages are counted, not shown');
  for (const item of [...model.tiers.must_act, ...model.tiers.must_know]) {
    assert.ok(full.includes(`<a name="item-${item.n}"></a>**${item.n} `), `item ${item.n}`);
    if (item.impact) assert.ok(full.includes(`Impact on you: *${item.impact[0].text}*`), `item ${item.n} impact`);
  }
  // D131 (R1): before any evidence of Must act or Must know, the lists of what the agent did keep their counts; every
  // evidence fold of Must act and Must know keeps its evidence here.
  assert.equal(full.includes('*auth order*: *auth first*'), false, 'the settled list keeps its count only');
  assert.ok(full.includes(REPORT_SECTION_WORDS.didCounted(model.did.files.total, model.did.runs.commands,
    model.did.runs.others, model.did.claims.total)));
  const kept = (text, tier) => (text.match(new RegExp(`Why ${tier}</summary>\\n\\n-`, 'g')) ?? []).length;
  assert.equal(kept(full, 'Must act'), model.tiers.must_act.length);
  assert.equal(kept(full, 'Must know'), model.tiers.must_know.length);
  // A larger overflow cuts Must know's evidence, then Must act's: never an evidence fold with nothing in it.
  const midReport = oversized(session, { settled: 0, unasked: 90 });
  const mid = renderReportMarkdown(session, midReport, repoFacts());
  const midModel = reportModel(session, midReport, repoFacts());
  assert.ok(bytes(mid) <= REPORT_MD_LIMITS.maxBytes, `${bytes(mid)} bytes`);
  assert.equal(kept(mid, 'Must know'), 0, 'Must know shows no evidence fold');
  assert.equal(kept(mid, 'Must act'), midModel.tiers.must_act.length, 'Must act keeps its evidence');
  assert.equal(mid.split(REPORT_TRIM_WORDS.mdShortened).length - 1, 1);
  const small = renderReportMarkdown(session, oversized(session, { settled: 0, unasked: 0 }), repoFacts());
  assert.equal(small.includes(REPORT_TRIM_WORDS.mdShortened), false, 'within the bound, nothing is said');
  // The parts never shortened, longer than the bound on their own, are kept whole: every shortening is applied, said
  // once, and the report is over the bound (the CLI then prints no gh line: report-output.js).
  const hugeReport = oversized(session, { settled: 0, unasked: 175 });
  const huge = renderReportMarkdown(session, hugeReport, repoFacts());
  assert.ok(bytes(huge) > REPORT_MD_LIMITS.maxBytes, `${bytes(huge)} bytes`);
  // Then the sentence says that the report is still too long for one comment: "to fit" would be false.
  assert.equal(huge.split(REPORT_TRIM_WORDS.mdStillLong).length - 1, 1);
  assert.equal(huge.includes(REPORT_TRIM_WORDS.mdShortened), false);
  assert.equal(full.includes(REPORT_TRIM_WORDS.mdStillLong), false);
  assert.equal(REPORT_TRIM_WORDS.mdStillLong, 'Sonah shortened this report. It is still too long for one GitHub comment.');
  for (const item of reportModel(session, hugeReport, repoFacts()).tiers.must_know)
    assert.ok(huge.includes(`<a name="item-${item.n}"></a>**${item.n} `), `item ${item.n}`);
  // D131 (R1): no evidence fold is printed empty, at any length.
  for (const text of [full, mid, small, huge]) assert.doesNotMatch(text, /Evidence · Why [^<]*<\/summary>\n\n<\/details>/);
});

/** The triaged report made larger in one part at a time, for the shortening order: `gtk` Good to know questions
 *  from findings whose evidence holds the long words of their checks, `withheld` withheld proposals of the code review (What Sonah
 *  could not check), `fences` Must act findings each with an 8-line excerpt and no permalink, and `pivots` Good to know
 *  changes of approach with long words in their one-line summaries. */
function grown({ gtk = 0, withheld = 0, fences = 0, pivots = 0, withheldWords = 25 } = {}) {
  const session = reportSession();
  const report = triagedReport(session);
  const hex = (k) => `sha256:${String(k).padStart(64, '0')}`;
  const long = (k, n = 30) => `${'word '.repeat(n)}${k}`;
  report.codePass.questions = [...report.codePass.questions, ...Array.from({ length: gtk }, (_, k) => ({ id: `G${k}`,
    question: `Question ${k}`, from: 'finding', finding: { title: `Finding ${k}`, kind: 'bug' }, concerns: null,
    quote: null, check: { verdict: 'refuted', reason: 'not_against_goal', explanation: long(k, 50) } }))];
  report.pivots = [...report.pivots, ...Array.from({ length: pivots }, (_, k) => ({ abandoned: long(k),
    adopted: long(k + 1), receipts: [] }))];
  report.codePass.withheld = [...report.codePass.withheld, ...Array.from({ length: withheld }, (_, k) => ({
    what: 'finding', text: long(k, withheldWords), kind: 'bug', lens: 'behaviour', reason: 'verify_refuted',
    check: { verdict: 'refuted', reason: 'incorrect', explanation: long(k, withheldWords) } }))];
  if (fences) {
    const lines = Array.from({ length: fences * 8 }, (_, i) => `const line${i} = "${'x'.repeat(130)}";`);
    const text = `${lines.join('\n')}\n`;
    const path = 'src/big.js';
    const hash = createHash('sha256').update(text).digest('hex');
    report.codePass.files = [...report.codePass.files, { path, type: 'added', state: 'shown', sha256: hash, hunks: 1 }];
    for (let k = 0; k < fences; k++) {
      const from = k * 8 + 1;
      report.codePass.findings.push({ origin: 'code-review', status: 'DECIDE', scope: 'current-code', lens: 'behaviour',
        foundByLenses: ['behaviour'], claims: [], input: '', leadsFrom: [], receipts: [], id: hex(k + 9000), kind: 'bug',
        title: `Bug number ${k}`, check: { verdict: 'holds', explanation: 'It holds.', receipts: [] },
        trace: [{ step: 'It starts here.', source: 'file', eventId: `file:${path}`, role: 'code', side: 'new',
          quote: `line${k * 8}`, path, startLine: from, endLine: from, sha256: hash, span: lines[from - 1] }],
        anchor: { path, side: 'new', startLine: from, endLine: from + 7 },
        anchorSpan: { startLine: from, lines: lines.slice(from - 1, from + 7), linesCut: 0, charsCut: 0 },
        anchorSha256: hash, anchorChanged: [from] });
    }
  }
  return renderReportMarkdown(session, report, {});
}
/** Which shortening steps a rendered report shows, each by what it leaves in the text: no evidence fold of the
 *  tier lists its lines; a list of what the agent did or of what Sonah could not check gives its count; no fence; Good
 *  to know as counts by kind. */
/** D133 (R2): the lines of an item's evidence fold that a shortened fold keeps (`foldNotes`), taken out first. */
const FOLD_NOTE_LINES = new RegExp(`^- (?:${[{ quoteMissing: true, quote: null }, { quote: null, scope: { askedUnknown: true } }]
  .flatMap(foldNotes).map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})\n`, 'gm');
const shortened = (whole) => { const text = whole.replace(FOLD_NOTE_LINES, ''); return {
  gtkEvidence: !/Why Good to know<\/summary>\n\n-/.test(text),
  askRows: /Sonah does not show your \d+ messages? here\./.test(text),
  knowEvidence: !/Why Must know<\/summary>\n\n-/.test(text),
  actEvidence: !/Why Must act<\/summary>\n\n-/.test(text),
  didCounts: /#### Files\n\nSonah does not show \d+ more of this list here\./.test(text),
  notCheckedCounts: /#### The session review\n\n[^\n]+\n\nSonah does not show \d+ more of this list here\./.test(text)
    && /<summary>Proposals of the code review that Sonah withheld \(\d+\)<\/summary>\n\nSonah does not show/.test(text),
  excerpts: !/\n```\n/.test(text),
  gtkCounts: /\n- A change of approach: \d+\n/.test(text),
}; };
// D131 (R1): your prompt's asks that are done and your messages, then the lists, then the excerpts and Good to know's
// items, and the evidence of Must know and Must act last of all.
const STEPS = ['gtkEvidence', 'askRows', 'didCounts', 'notCheckedCounts', 'excerpts', 'gtkCounts', 'knowEvidence',
  'actEvidence'];
/** The steps up to and including `last`, applied; the rest, not. */
const upTo = (last) => Object.fromEntries(STEPS.map((step, i) => [step, i <= STEPS.indexOf(last)]));

test('D97 (4): each shortening step is applied in its order, and only until the report fits', () => {
  // Good to know's evidence is enough: Must know and Must act keep theirs.
  const a = grown({ gtk: 120 });
  assert.ok(bytes(a) <= REPORT_MD_LIMITS.maxBytes);
  assert.deepEqual(shortened(a), upTo('gtkEvidence'));
  // D133 (R2) with D131: Good to know's shortened evidence folds are left out whole, their items' notes too (a Must act
  // or Must know fold keeps them: d133-quiet-gaps).
  assert.equal(a.includes(`Why Good to know</summary>\n\n- ${foldNotes({ quote: null, scope: { askedUnknown: true } })[0]}`),
    false);
  // D131 (R1): then your prompt's done asks and your messages, then the lists of what the agent did keep their counts;
  // Must know and Must act keep their evidence. (What Sonah could not check keeps its count next: case c applies it.)
  const b = grown({ gtk: 130, withheld: 100 });
  assert.ok(bytes(b) <= REPORT_MD_LIMITS.maxBytes);
  assert.deepEqual(shortened(b), upTo('didCounts'));
  // Then the lists of what Sonah could not check keep their counts; the excerpts, Good to know and every evidence fold
  // of Must act and Must know stay.
  const b2 = grown({ withheld: 100, withheldWords: 40 });
  assert.ok(bytes(b2) <= REPORT_MD_LIMITS.maxBytes);
  assert.deepEqual(shortened(b2), upTo('notCheckedCounts'));
  // The excerpts give way to their place, which the Where line keeps; Good to know stays.
  const c = grown({ fences: 40 });
  assert.ok(bytes(c) <= REPORT_MD_LIMITS.maxBytes);
  assert.deepEqual(shortened(c), upTo('excerpts'));
  assert.match(c, /Where: `src\/big\.js:1-8`/);
  // Last, Good to know becomes counts by kind.
  const d = grown({ pivots: 200 });
  assert.ok(bytes(d) <= REPORT_MD_LIMITS.maxBytes);
  assert.deepEqual(shortened(d), upTo('gtkCounts'));
  assert.match(d, /\n- A change of approach: 201\n/);
  for (const text of [a, b, c, d]) assert.equal(text.split(REPORT_TRIM_WORDS.mdShortened).length - 1, 1);
});

test('D97 (4): the shortening order — messages, then Good to know\'s evidence, before any Must evidence', () => {
  const b = sessionBuilder();
  const log = Array.from({ length: 3000 }, (_, i) => `line ${i} of a pasted log`).join('\n');
  b.ask('I1', `Fix the parser.\n${log}`);
  b.say('F1', 'Done.', 'final');
  const session = b.session();
  const report = { windowResults: windowOf(session), sessionReview: 'complete', coverage: 'complete',
    requirements: [{ text: 'fix', instruction: r('instruction', 'I1', 'Fix the parser.'), status: 'not-done',
      shortfall: r('commentary', 'F1', 'Done.') }] };
  const text = renderReportMarkdown(session, report, {});
  assert.ok(bytes(text) <= REPORT_MD_LIMITS.maxBytes);
  // The message is cut to its start, said once at the top of your prompt; the item keeps its evidence.
  assert.ok(text.includes(`### ${REPORT_SECTION_WORDS.promptCounted(1, '1 not done')}\n\n${REPORT_TRIM_WORDS.mdShortened}`));
  assert.equal(text.split(REPORT_TRIM_WORDS.mdShortened).length - 1, 1);
  assert.match(text, /> Fix the parser\.\n> line 0 of a pasted log/);
  assert.equal(text.includes('line 2999 of a pasted log'), false);
  // Its fold's summary says that it holds the start, with the whole message's count: never "Your whole message".
  assert.ok(text.includes(`<details><summary>${REPORT_MD_WORDS.messageStart(3 + 3000 * 6)}</summary>`));
  assert.equal(REPORT_MD_WORDS.messageStart(18003), 'The start of your message (18003 words in all)');
  assert.equal(text.includes('Your whole message'), false);
  assert.match(text, /- The agent said: “Done\.”/);
});

test('R2: a shortened report says the HTML page holds every part only when the same run wrote a whole page', () => {
  // `--format md` (the default) writes no page: "The HTML page holds every part." pointed to a page that does not exist.
  const b = sessionBuilder();
  const log = Array.from({ length: 3000 }, (_, i) => `line ${i} of a pasted log`).join('\n');
  b.ask('I1', `Fix the parser.\n${log}`);
  b.say('F1', 'Done.', 'final');
  const session = b.session();
  const report = { windowResults: windowOf(session), sessionReview: 'complete', coverage: 'complete',
    requirements: [{ text: 'fix', instruction: r('instruction', 'I1', 'Fix the parser.'), status: 'not-done',
      shortfall: r('commentary', 'F1', 'Done.') }] };
  const mdOnly = renderReportMarkdown(session, report, {});
  assert.ok(mdOnly.includes(`${REPORT_TRIM_WORDS.mdShortened}\n\n`), 'shortened, and said');
  assert.equal(mdOnly.includes('HTML page'), false);
  assert.equal(renderReportMarkdown(session, report, { page: { whole: false } }).includes('HTML page'), false,
    'a page that left something out does not hold every part');
  const withPage = renderReportMarkdown(session, report, { page: { whole: true } });
  assert.ok(withPage.includes(`${REPORT_TRIM_WORDS.mdShortened} ${REPORT_TRIM_WORDS.pageWhole}\n\n`), withPage.slice(0, 400));
  assert.equal(REPORT_TRIM_WORDS.pageWhole, 'The HTML page holds every part.');
  // The page says whether it kept every part.
  assert.deepEqual(Object.keys(sessionPage(session, report, {})), ['html', 'whole']);
  assert.equal(sessionPage(session, report, {}).whole, true);
});

test('D97: a decision with no words of the agent linked shows no line about its words; silence is never inferred', () => {
  const session = reportSession();
  const report = triagedReport(session);
  // The deploy decision: the session review linked no statement of the agent's (`stated` null).
  assert.equal(report.decisions[1].stated, null);
  const model = reportModel(session, report, repoFacts());
  const item = [...model.tiers.must_act, ...model.tiers.must_know, ...model.tiers.good_to_know]
    .find((x) => x.rows[0].source === 'decisions' && x.rows[0].index === 1);
  assert.equal(item.agentSaid, null);
  const text = renderReportMarkdown(session, report, repoFacts());
  const at = text.indexOf(`<a name="item-${item.n}"></a>`);
  const visible = text.slice(at, text.indexOf('<details>', at));
  assert.equal(/The agent said/.test(visible), false, visible);
  assert.equal(/said nothing|gave no words/.test(text), false);
});

test('D97: what the agent said it did not do lists only the agent\'s own words that ground', () => {
  // The heading says the agent said it: a row with no words of the agent's that ground (a decision not to act whose
  // quote does not ground, an ask not done) is not listed under it. Each stays its own item.
  const session = reportSession();
  const report = triagedReport(session);
  const heading = `#### ${REPORT_SECTION_WORDS.leftOut}`;
  const section = (text) => text.slice(text.indexOf(heading) + heading.length, text.indexOf('#### ', text.indexOf(heading)
    + heading.length)).trim();
  const model = reportModel(session, report, repoFacts());
  assert.ok(model.prompt.asks.some((ask) => ask.state === 'notDone'), 'the fixture holds an ask not done');
  const notActing = (m) => [...m.tiers.must_act, ...m.tiers.must_know, ...m.tiers.good_to_know]
    .find((x) => x.kind === 'decision_not_acting');
  assert.deepEqual(model.did.leftOut.map((x) => [x.item, x.quote.text]),
    [[notActing(model).n, 'I will not add Redis, an in-process bucket is enough.']]);
  assert.equal(section(renderReportMarkdown(session, report, repoFacts())),
    `- “I will not add Redis, an in-process bucket is enough.” → item ${notActing(model).n}`);
  // Its quote does not ground: the list is empty, and says only what Sonah found; the decision is still its item.
  report.decisions[0] = { ...report.decisions[0], stated: { ...report.decisions[0].stated, quote: 'not in the recording' } };
  const ungrounded = reportModel(session, report, repoFacts());
  assert.deepEqual(ungrounded.did.leftOut, []);
  assert.ok(notActing(ungrounded), 'the decision not to act is still an item');
  assert.equal(section(renderReportMarkdown(session, report, repoFacts())), REPORT_DID_WORDS.noLeftOut);
  assert.equal(REPORT_DID_WORDS.noLeftOut, "Sonah found no decision not to act in the agent's own words.");
  const page = renderSessionPage(session, report, repoFacts());
  const at = page.indexOf(`>${REPORT_SECTION_WORDS.leftOut}</h3>`);
  assert.ok(page.slice(at, page.indexOf('<h3', at)).includes(escapeHtml(REPORT_DID_WORDS.noLeftOut)));
});

test('D97: an evidence fold names no count of quotes, on the page and in the .md alike', () => {
  // A count of the fold's own lines read "Evidence (0 quotes)" under an item that shows a quote open (6 of 13 paid
  // reports): the summary names the fold and the tier's why, nothing to count.
  const session = reportSession();
  const report = triagedReport(session);
  const model = reportModel(session, report, repoFacts());
  const text = renderReportMarkdown(session, report, repoFacts());
  const html = renderSessionPage(session, report, repoFacts());
  const items = [...model.tiers.must_act, ...model.tiers.must_know, ...model.tiers.good_to_know];
  assert.ok(items.some((item) => item.quote || item.agentSaid), 'an item shows a quote open');
  for (const item of items) {
    const summary = `<summary>Evidence · Why ${REPORT_TIER_WORDS[item.tier.final]}</summary>`;
    assert.ok(text.includes(summary) && html.includes(summary), `item ${item.n}`);
  }
  assert.equal(/Evidence \(/.test(text) || /Evidence \(/.test(html), false);
});

test('D97 (10): the same inputs give the same bytes, and the report is only read', () => {
  const session = reportSession();
  const report = triagedReport(session);
  const before = JSON.stringify(report);
  assert.equal(renderReportMarkdown(session, report, repoFacts()), renderReportMarkdown(session, report, repoFacts()));
  assert.equal(JSON.stringify(report), before);
  // Its bounds are the report model's own.
  assert.equal(REPORT_MD_LIMITS.askWords, REPORT_LIMITS.askPrefixWords);
  assert.equal(REPORT_MD_LIMITS.messageChars, REPORT_LIMITS.messageChars);
});

test('D97: the report .md and the report model import each other; either may be loaded first', () => {
  const root = fileURLToPath(new URL('..', import.meta.url));
  for (const first of ['./session-story.js', './report-model.js', './session-page.js']) {
    const out = execFileSync(process.execPath, ['--input-type=module', '-e', `await import(${JSON.stringify(first)}); `
      + "const m = await import('./session-story.js'); console.log(typeof m.renderReportMarkdown);"], { cwd: root });
    assert.equal(out.toString().trim(), 'function', first);
  }
});

test('D97: no verdict word in the report\'s own words', () => {
  const VERDICT = /\b(?:approve|approval|LGTM|safe|clean|ready to merge|looks good|score|confidence)\b/i;
  const own = Object.values(REPORT_MD_WORDS).map((w) => (typeof w === 'function' ? w(2, 2) : w)).join(' ');
  assert.doesNotMatch(own, VERDICT);
  assert.doesNotMatch(md(REPORT_SHAPES.c, {}).replace(/“[^”]*”|`[^`]*`|\*[^*]*\*/g, ''), VERDICT);
});
