// D87 (owner decisions 2026-10-13/14), reworked as the code step: how the page and
// the story show a code pass — "What the code review found" in its order (the findings that follow from a row of the
// session review beside that row, then the rest in table-of-contents order, then the open questions, then the coverage
// footer), a finding's kind, input and trace, the code check beside each checked row, and every quote shown only when it
// is found again (a code quote in the span stored with a file the pass read with the same sha256, on its side; a session
// quote in the recording). Pure renders of a synthetic session and report: no model, no network.
import test from 'node:test';
import assert from 'node:assert/strict';
import { renderSessionPage, PAGE_CODE_WORDS, PAGE_REQUIREMENT_FACT_WORDS, PAGE_ATTENTION_WORDS }
  from '../session-page.js';
import { renderSessionStory, STORY_CODE_WORDS, codeQuoteOf, sessionQuoteOf, codeSectionPlan, codeFooterLines }
  from '../session-story.js';
import { ATTENTION_ROWS, ATTENTION_WORDS, attentionSummary, checklistRowCounts } from '../../evidence/src/review.js';
import { honestStatuses } from '../../evidence/src/ledger.js';
import { attentionCliLines } from '../../cli/src/session-review-command.js';
import { publicCommentText } from '../../github/index.js';
import { codeSession } from '../../cli/test/code-pass-fixture.js';

const R = (eventId, role, quote) => ({ eventId, role, quote });
const QUOTE = 'const parts = input.split(",");';
const BEFORE = 'const parts = input.split(";");';
const SHA = 'a'.repeat(64), BASE_SHA = 'c'.repeat(64);
const receipt = (over = {}) => ({ eventId: 'file:0123456789abcdef', role: 'code', side: 'new', quote: QUOTE,
  path: 'src/parse.js', startLine: 2, endLine: 2, sha256: SHA, span: `  ${QUOTE}`, ...over });
const codeCheck = (outcome, over = {}) => ({ outcome, receipts: outcome === 'not-checked-in-code' ? [] : [receipt(over)],
  reason: outcome === 'not-checked-in-code' ? 'challenge_unsettled' : null });
/** A published code-step finding: its trace a step quoting the person's words, a step on the old side and one on the
 *  file now. */
const finding = (over = {}) => ({ origin: 'code-review', lens: 'behaviour', kind: 'bug', title: 'Empty input gives [""]',
  explanation: 'split on an empty string returns one empty part.', input: 'parse("")',
  trace: [{ step: 'You asked for [] on empty input.', source: 'session', eventId: 'I1', role: 'instruction',
    quote: 'returns [] for empty input' },
  { step: 'It used to split on semicolons.', source: 'base', ...receipt({ eventId: 'base:0123456789abcdef', side: 'old',
    quote: BEFORE, sha256: BASE_SHA, span: `  ${BEFORE}` }) },
  { step: 'An empty string splits into one empty part.', source: 'file', ...receipt() }],
  anchor: { path: 'src/parse.js', side: 'new', startLine: 2, endLine: 3 }, receipts: [receipt()], status: 'DECIDE',
  votes: [1, 2, 3].map((pass) => ({ pass, verdict: 'upheld', reason: null })), foundByLenses: ['behaviour', 'tests'],
  scope: 'current-code', id: `sha256:${'3'.repeat(64)}`,
  leadsFrom: [{ key: 'S2', kind: 'claim', source: 'promises', index: 0, id: `sha256:${'1'.repeat(64)}` }], ...over });

/** A finished session review of `codeSession`, with a code pass joined: the claim contradicted by the code, the ask not
 *  checked in it, the decision shown in it; one finding following from the claim, one from no row, an open question about
 *  the ask, and a footer. */
function report({ findings = [finding(), finding({ title: 'SYNTHETIC rest finding', leadsFrom: [], foundByLenses: ['contracts'],
  kind: 'contract_break', id: `sha256:${'4'.repeat(64)}`, anchor: { path: 'src/parse.js', side: 'new', startLine: 1,
    endLine: 1 } })], files = [{ path: 'src/parse.js', state: 'shown', sha256: SHA, bytes: 90, lines: 5, type: 'modified',
  diff: 'recorded', hunks: 1, baseSha256: BASE_SHA }, { path: 'big.js', state: 'not_shown', sha256: 'd'.repeat(64), bytes: 9,
  lines: 1 }, { path: '.env', state: 'credential_path' }] } = {}) {
  return {
    repo: { host: 'github.com', id: '0' }, reviewScope: 'session-only', pr: null, codeCoverage: 'missing',
    coverage: 'complete', sessionReview: 'complete', findings: [], failures: [], writtenClaims: [], pivots: [],
    promises: [{ id: `sha256:${'1'.repeat(64)}`, stated: R('C1', 'commentary', 'parse now returns an empty list for empty input.'),
      text: 'The agent said parse returns an empty list for empty input.', status: 'open', receipts: [],
      codeCheck: codeCheck('contradicted-by-code') }],
    requirements: [{ text: 'Return [] for empty input.', instruction: R('I1', 'instruction',
      'SYNTHETIC_CODE_ASK: add a parse function that returns [] for empty input, and do not touch the README.'),
    status: 'partly-done', deliverable: R('W1', 'code', 'export function parse(input) {'),
    shortfall: R('C1', 'commentary', 'parse now returns an empty list for empty input.'),
    codeCheck: codeCheck('not-checked-in-code') }],
    decisions: [{ id: `sha256:${'2'.repeat(64)}`, dimension: 'How to split the input', chosen: 'Split on commas',
      actions: ['W1'], column: 'unasked', stated: null, codeCheck: codeCheck('shown-in-code') }],
    codePass: { ran: true, coverage: 'partial', files, rows: 3, base: { kind: 'git', commit: 'b'.repeat(40), how: 'reflog' },
      findings,
      questions: [{ question: 'Should an empty input be an error instead?', lens: 'ask',
        concerns: { key: 'S1', kind: 'ask', source: 'requirements', index: 0, id: null },
        quote: { source: 'session', eventId: 'I1', role: 'instruction', quote: 'returns [] for empty input' } }],
      footer: { listed_by_name: ['big.js'], clipped: [], withheld: [{ path: '.env', state: 'credential_path' }],
        failed: [{ step: 'lens', lens: 'tests', group: 1 }] } },
  };
}
const codeSectionOf = (page) => {
  const from = page.indexOf('<section class="part" id="code">');
  return page.slice(from, page.indexOf('</section>', from));
};

test('code step page: what the code review found, in the method\'s order, each finding beside the row it follows from', () => {
  const page = renderSessionPage(codeSession(), report());
  const section = codeSectionOf(page);
  assert.match(section, /<h2 class="label">What the code review found<\/h2>/);
  assert.match(section, /The change runs from the commit the session started from \(bbbbbbbbbbbb\) to the files now\./);
  assert.match(section, /It showed the reviewer 1 of the 3 files the session changed or read, or that differ from where it started; the others: 1 not shown whole for lack of room, 1 withheld as credential-shaped\./);
  // 1: the rows with a finding or a contradicted check, each with its code check and the findings beside it.
  const at = (text) => section.indexOf(text);
  assert.ok(at('Beside what the session review found (1)') > 0);
  assert.ok(at('The claim:') < at('Empty input gives'), 'the finding sits beside the claim it follows from');
  // 2: the rest, in table-of-contents order; 3: the open questions; 4: the footer.
  assert.ok(at('Empty input gives') < at('Other findings of the code review') && at('Other findings of the code review')
    < at('SYNTHETIC rest finding') && at('SYNTHETIC rest finding') < at('Open questions for you (1)')
    && at('Open questions for you (1)') < at('What the code review did not cover'));
  // A finding: its kind, place, title, explanation, input, trace with checked quotes, and the lenses that reached it.
  assert.match(section, /<span class="label accent">Code review finding · a bug<\/span> <code>src\/parse\.js:2–3<\/code>/);
  assert.match(section, /<span class="label">For the input<\/span> <code>parse\(&quot;&quot;\)<\/code>/);
  assert.match(section, /<span class="label">How it gets there<\/span>/);
  assert.match(section, /<span class="label">Recorded in the session<\/span><blockquote><q class="said">returns \[\] for empty input<\/q>/);
  assert.match(section, /<span class="label">The code before the session <code>src\/parse\.js:2<\/code><\/span>/);
  assert.ok(section.includes(`<code>${BEFORE.replace(/"/g, '&quot;')}</code>`), 'the old side\'s quote, checked by its sha256');
  assert.ok(section.includes(`<code>${QUOTE.replace(/"/g, '&quot;')}</code>`));
  assert.match(section, /<span class="label">Found through<\/span> behaviour, tests/);
  assert.match(section, /<span class="label">It concerns<\/span> The ask: In the review&#39;s words: Return \[\] for empty input\./);
  assert.match(section, /1 file not shown whole for lack of room: big\.js/);
  assert.match(section, /1 file withheld \(1 withheld as credential-shaped\)/);
  assert.match(section, /calls that did not answer: the lens tests \(part 1\)/);
  assert.doesNotMatch(section, /\.env/, 'a withheld file is counted, never named');
  for (const word of ['severity', 'confidence', 'verified']) assert.doesNotMatch(section, new RegExp(word, 'i'));
  // Beside each row elsewhere on the page, in fixed words.
  assert.match(page, /<span class="label">Code check<\/span> the code at review time contradicts it\./);
  assert.match(page, /<span class="label">Code check<\/span> the code at review time shows it\./);
  assert.match(page, /<a href="#code">1 claim \(asks, decisions\) contradicted by the code at review time<\/a>/);
  assert.match(page, /<a href="#code">2 findings of the code review<\/a>/);
  assert.equal(PAGE_CODE_WORDS, STORY_CODE_WORDS);
});

test('code step page and story: a quote is shown only when it is found again — a code span on its side, a session quote in the recording', () => {
  const tamperings = [{ span: `  ${BEFORE}` }, { sha256: 'b'.repeat(64) }, { path: '.env' }, { side: 'old' }];
  for (const over of tamperings) {
    const tampered = receipt(over);
    const r = report({ findings: [finding({ trace: [{ step: 'One step.', source: 'file', ...tampered }] })] });
    assert.equal(codeQuoteOf(r, tampered), null, JSON.stringify(over));
    const item = codeSectionOf(renderSessionPage(codeSession(), r));
    assert.ok(item.includes(PAGE_CODE_WORDS.quoteUnchecked.replace(/'/g, '&#39;')), JSON.stringify(over));
    assert.ok(!item.slice(item.indexOf('id="code-finding-1"')).includes(`<code>${QUOTE.replace(/"/g, '&quot;')}</code>`));
    const story = renderSessionStory(codeSession(), r);
    assert.ok(story.slice(story.indexOf('## What the code review found')).includes(STORY_CODE_WORDS.quoteUnchecked));
  }
  assert.equal(codeQuoteOf(report(), receipt()), QUOTE);
  assert.equal(codeQuoteOf(report(), receipt({ side: 'old', quote: BEFORE, sha256: BASE_SHA, span: `  ${BEFORE}` })), BEFORE);
  // A session quote the recording does not hold is not shown.
  const session = codeSession();
  assert.equal(sessionQuoteOf(session, { eventId: 'I1', role: 'instruction', quote: 'returns [] for empty input' }),
    'returns [] for empty input');
  assert.equal(sessionQuoteOf(session, { eventId: 'I1', role: 'instruction', quote: 'SYNTHETIC never said' }), null);
  assert.equal(sessionQuoteOf(session, { eventId: 'C1', role: 'instruction', quote: 'parse now returns' }), null);
  const unheld = report({ findings: [finding({ trace: [{ step: 'Asked.', source: 'session', eventId: 'I1', role: 'instruction',
    quote: 'SYNTHETIC never said' }] })] });
  const story = renderSessionStory(codeSession(), unheld);
  assert.ok(!story.includes('SYNTHETIC never said'));
  assert.ok(!codeSectionOf(renderSessionPage(codeSession(), unheld)).includes('SYNTHETIC never said'));
});

test('code step story: the section in the method\'s order, a finding\'s trace, and the code check after each checked row', () => {
  const story = renderSessionStory(codeSession(), report());
  const section = story.slice(story.indexOf('## What the code review found'));
  assert.match(section, /^\*\*Beside what the session review found\*\*$/m);
  assert.match(section, /^\*\*Code review finding\*\* \(a bug\) · `src\/parse\.js:2–3` — Empty input gives \\\[""\\\]$/m);
  assert.match(section, /^For the input: `parse\(""\)`$/m);
  assert.match(section, /^1\. You asked for \\\[\\\] on empty input\.$/m);
  assert.match(section, /> \*\*Recorded in the session:\*\* returns \\\[\\\] for empty input/);
  assert.match(section, /> \*\*The code before the session src\/parse\.js:2:\*\* const parts = input\.split\(";"\);/);
  assert.match(section, /> \*\*The code now src\/parse\.js:2:\*\* const parts = input\.split\(","\);/);
  assert.match(section, /^Found through: behaviour, tests$/m);
  const at = (text) => section.indexOf(text);
  assert.ok(at('**Beside what the session review found**') < at('**Other findings of the code review**')
    && at('**Other findings of the code review**') < at('**Open questions for you**')
    && at('**Open questions for you**') < at('**What the code review did not cover**'));
  assert.match(story, /— code check: the code at review time contradicts it \(`src\/parse\.js:2`\)/);
  assert.match(story, /— code check: not checked in the code: the checking passes did not all uphold the reviewer's answer/);
  // Without a code pass, no word of it.
  const { codePass: _pass, ...plain } = report();
  const strip = (rows) => rows.map(({ codeCheck: _c, ...row }) => row);
  const without = renderSessionStory(codeSession(), { ...plain, promises: strip(plain.promises),
    requirements: strip(plain.requirements), decisions: strip(plain.decisions) });
  assert.doesNotMatch(without, /code review found|code check/);
});

test('code step: the reading order and the footer are code\'s, shared by the page and the story', () => {
  const r = report();
  const plan = codeSectionPlan(r);
  assert.deepEqual(plan.beside.map((b) => [b.source, b.index, b.findings.length]), [['promises', 0, 1]]);
  assert.deepEqual(plan.rest.map((f) => f.title), ['SYNTHETIC rest finding']);
  assert.equal(plan.questions.length, 1);
  // The rest, in table-of-contents order: by path, then line.
  const order = codeSectionPlan(report({ findings: [finding({ leadsFrom: [], title: 'b', anchor: { path: 'b.js', side: 'new',
    startLine: 1, endLine: 1 } }), finding({ leadsFrom: [], title: 'a2', anchor: { path: 'a.js', side: 'new', startLine: 9,
    endLine: 9 } }), finding({ leadsFrom: [], title: 'a1', anchor: { path: 'a.js', side: 'new', startLine: 2, endLine: 2 } })] }));
  assert.deepEqual(order.rest.map((f) => f.title), ['a1', 'a2', 'b']);
  assert.deepEqual(codeFooterLines(r), ['1 file not shown whole for lack of room: big.js',
    '1 file withheld (1 withheld as credential-shaped)', 'calls that did not answer: the lens tests (part 1)']);
  assert.deepEqual(codeFooterLines({ codePass: { footer: { listed_by_name: [], clipped: [], withheld: [], failed: [] } } }), []);
  // The review of the code step (page /32, story /27; built as /31 and /26, renumbered at the merge with D88): paths
  // that differ outside the working directory are counted, never named, on the page and in the story alike.
  const outside = report();
  outside.codePass.base = { ...outside.codePass.base, outside: 3 };
  const line = '3 paths outside the working directory also differ from where the session started: not reviewed, and not named';
  assert.equal(codeFooterLines(outside).at(-1), line);
  assert.ok(renderSessionStory(codeSession(), outside).includes(line));
  assert.ok(renderSessionPage(codeSession(), outside).includes(line));
  assert.ok(!codeFooterLines(r).some((l) => l.includes('outside the working directory also')));
});

// D88 with the code step (their merge): the attention summary counts the code step's findings, the one beside the
// row it follows from and the one that follows from no row alike, under `codeFindings`, and the rows its step 1 found
// contradicted under `codeContradicted`, on every reader, by the same shared reading (code-pass.js `codePassFindings`,
// `codeContradictedRows`). An open question is no finding and is not counted. The section keeps D88's place: after the
// agent's judgment and the settled problems, before What Sonah could not check.
test('D88 with the code step: the summary counts its findings and the rows it found contradicted, on every reader', () => {
  const r = report();
  const counts = checklistRowCounts(r);
  assert.deepEqual([counts.codeFindings, counts.codeContradicted], [2, 1]);
  const none = { ...r, codePass: { ...r.codePass, findings: [] } };
  assert.equal(checklistRowCounts(none).codeFindings, 0, 'the open question is not counted');
  const beside = { ...r, codePass: { ...r.codePass, findings: [r.codePass.findings[0]] } };
  const rest = { ...r, codePass: { ...r.codePass, findings: [r.codePass.findings[1]] } };
  assert.deepEqual([checklistRowCounts(beside).codeFindings, checklistRowCounts(rest).codeFindings], [1, 1],
    'a finding beside its row and one that follows from no row are each counted');
  // The PR comment's and the CLI's lines, in ATTENTION_ROWS' order, the code step's two lines among them.
  const { lines } = attentionSummary(r);
  const code = [ATTENTION_WORDS.codeContradicted(1), ATTENTION_WORDS.codeFindings(2)];
  for (const line of code) assert.ok(lines.includes(line), line);
  assert.ok(lines.indexOf(code[0]) < lines.indexOf(code[1]));
  assert.equal(lines.at(-1), code[1], 'the code review\'s findings are the last kind counted');
  const cli = attentionCliLines(r).join('\n');
  for (const line of code) assert.ok(cli.includes(line), line);
  const { summary } = publicCommentText({ ...r, ...honestStatuses(r) });
  const plain = summary.replace(/\\(.)/g, '$1').replace(/&#64;/g, '@');
  for (const line of code) assert.ok(plain.includes(line), line);
  // The page: the same two kinds, linked to What the code review found.
  const page = renderSessionPage(codeSession(), r);
  const from = page.indexOf('<div class="attention">');
  const block = page.slice(from, page.indexOf('</div>', from));
  const items = [...block.matchAll(/<li( class="hl")?><a href="#([a-z]+)">([^<]*)<\/a><\/li>/g)].map((m) => [m[2], m[3]]);
  assert.deepEqual(items.filter(([id]) => id === 'code'), [['code', PAGE_ATTENTION_WORDS.codeContradicted(1)],
    ['code', PAGE_ATTENTION_WORDS.codeFindings(2)]]);
  // One counting for every reader (the judgment-first review, low): the decision's column was not derived by the ledger
  // (no `columnState`), so every reader counts it where the review could not tell whether you asked.
  assert.deepEqual([counts.unasked, counts.whetherAsked], [0, 1]);
  assert.ok(block.includes(PAGE_ATTENTION_WORDS.whetherAsked(1)));
  assert.deepEqual(items.map(([id]) => id), ATTENTION_ROWS.filter((kind) => counts[kind] > 0).map((kind) =>
    ({ codeContradicted: 'code', codeFindings: 'code', whetherAsked: 'decisions', asksNotDone: 'requests' })[kind]));
  // D88's order: the judgment first, what the code review found after it, What Sonah could not check last.
  const at = (text) => page.indexOf(text);
  assert.ok(at('id="decisions"') > 0 && at('id="decisions"') < at('id="code"') && at('id="code"') < at('id="unchecked"'));
  const story = renderSessionStory(codeSession(), r);
  const storyAt = (heading) => story.indexOf(`\n## ${heading}\n`);
  assert.ok(storyAt(STORY_CODE_WORDS.heading) > 0);
  assert.ok(storyAt(STORY_CODE_WORDS.heading) < story.indexOf('\n## What Sonah could not check'));
});

// An ask the code pass checks can also carry a fact of code's (here `no_deliverable_by_end`, beside an ask not checked,
// the only requirement fact). Both are shown on the page: the fact first, then the code check, for every outcome; the
// story says the code check (it never says that fact). D88: an ask not checked is listed under What Sonah could not
// check, on the page and in the story.
test('D87: an ask with a fact and each code-check outcome shows the fact, then its code check', () => {
  const pageFact = PAGE_REQUIREMENT_FACT_WORDS.no_deliverable_by_end;
  const asked = (check) => ({ text: 'Return [] for empty input.', instruction: R('I1', 'instruction',
    'SYNTHETIC_CODE_ASK: add a parse function that returns [] for empty input, and do not touch the README.'),
  status: 'not-checked', facts: ['no_deliverable_by_end'], ...(check ? { codeCheck: check } : {}) });
  const only = (check) => ({ ...report(), promises: [], decisions: [], requirements: [asked(check)],
    codePass: { ...report().codePass, findings: [], questions: [] } });
  const esc = (text) => text.replace(/'/g, '&#39;');
  for (const outcome of ['shown-in-code', 'contradicted-by-code', 'not-checked-in-code']) {
    const r = only(codeCheck(outcome));
    const page = renderSessionPage(codeSession(), r);
    const from = page.indexOf('Asks not checked (1)');
    const item = page.slice(from, page.indexOf('</ul>', from));
    assert.ok(from > page.indexOf('<details class="unchecked">'), `${outcome}: listed under What Sonah could not check`);
    const fact = item.indexOf(`<p class="note">${esc(pageFact)}</p>`);
    const code = item.indexOf(`<span class="label">${PAGE_CODE_WORDS.label}</span> ${PAGE_CODE_WORDS.outcomes[outcome]}`);
    assert.ok(fact > 0 && code > fact, `${outcome}: the fact, then the code check`);
    assert.equal(item.split(esc(pageFact)).length, 2, `${outcome}: the fact once`);
    if (outcome === 'not-checked-in-code') assert.ok(item.includes(esc(PAGE_CODE_WORDS.reasons.challenge_unsettled)));
    else assert.ok(item.includes('<code>src/parse.js:2</code>'), `${outcome}: the code it cites`);
    // Contradicted by the code: also listed beside its row under what the code review found.
    const listed = page.includes('Beside what the session review found (1)');
    assert.equal(listed, outcome === 'contradicted-by-code', outcome);
    const line = renderSessionStory(codeSession(), r).split('\n')
      .filter((l) => l.startsWith('- You asked (request 1): ') && l.includes(`— code check: ${STORY_CODE_WORDS.outcomes[outcome]}`));
    assert.equal(line.length, 1, outcome);
  }
  const plainPage = renderSessionPage(codeSession(), only(null));
  const from = plainPage.indexOf('Asks not checked (1)');
  const item = plainPage.slice(from, plainPage.indexOf('</ul>', from));
  assert.ok(item.includes(esc(pageFact)) && !item.includes(PAGE_CODE_WORDS.label));
  // A reason of step 1's own: "could not tell" has its own words.
  assert.equal(STORY_CODE_WORDS.reasons.cannot_tell, 'the reviewer could not tell from the code');
});
