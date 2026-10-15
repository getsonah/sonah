// M33 S3: three problems read on real stories (a 37-step and a 113-step Codex session), reproduced here with
// synthetic sessions only: harness context detected wrongly both ways, a requirement repeated once per window
// in different words, and step blocks that repeat themselves. The "review" tests pin what an adversarial review of
// the first repair found: a quote spanning two requirements merged them, requirements quoting the same words
// collapsed into one status, a failed test run or many contradicted statements could fall out of a step, and words
// inside a context tag were hidden.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as story from '../session-story.js';
import { isWhollyElements } from '../../slicer/src/harness-context.js';

const { renderSessionStory, STORY_LIMITS } = story;
import { sessionBuilder, STORY_KEY } from './session-story-fixture.js';

const receipt = (role, eventId, quote) => ({ role, eventId, quote, sessionKey: STORY_KEY });
const section = (story, from, to) => story.slice(story.indexOf(from), to ? story.indexOf(to, story.indexOf(from)) : undefined);
const productOf = (story) => section(story, '## <a name="for-product"></a>', '## <a name="for-leads"></a>');
const engineerOf = (story) => section(story, '## <a name="for-engineers"></a>');
const chartOf = (story) => story.slice(story.indexOf('```mermaid\n'), story.indexOf('\n```\n', story.indexOf('```mermaid\n')));
const requirementRows = (product) => product.split('\n').filter((line) => /^- (addressed|partly addressed|open): /.test(line));
/** A report of one window per list of event ids. */
const windowsOf = (lists, narratives = []) => lists.map((eventIds, windowIndex) => ({ windowIndex, eventIds, failure: null,
  ...(narratives[windowIndex] ? { narrative: { decisions: [], pivots: [], claims: [], requirements: narratives[windowIndex] } } : {}) }));

/** The plugin list Codex injects as ONE user message: several sibling elements, eight closing tags. */
const PLUGINS = [
  '<recommended_plugins>',
  '  <plugin name="docs">Search the product docs</plugin>',
  '  <plugin name="tracker">Read and file issues</plugin>',
  '</recommended_plugins>',
  '<skills>',
  '  <skill name="review">Review a pull request</skill>',
  '</skills>',
  '<apps>',
  '  <app name="browser">Open a page</app>',
  '</apps>',
  '<collaboration_mode>pair</collaboration_mode>',
].join('\n');
const REPLY = '<send_user_message_question_reply>Use exponential backoff, capped at 30 seconds.</send_user_message_question_reply>';
const UNKNOWN = '<my_notes>keep the old client around</my_notes>';

test('M33 S3, M5: every human instruction the slicer read is an ask, shown as recorded; the story decides no actor', () => {
  // M5: which recorded message is a human's is the slicer's decision (Codex: its typed
  // UserMessage channel), so a plugin list is no instruction event at all. The story re-decides nothing: a reply a harness
  // wrapped and an unknown tag are asks, each shown by its recorded words.
  assert.equal((PLUGINS.match(/<\//g) ?? []).length, 8);
  const b = sessionBuilder();
  b.ask('I1', 'Add a retry to the upload client.');
  b.run('C1', 'cat src/upload.js', 'succeeded', 'x');
  b.ask('I2', REPLY);
  b.change('W2', 'src/upload.js', { operation: 'edit', before: 'send()', after: 'retry(send)', priorState: 'edit-text' });
  b.ask('I3', UNKNOWN);
  b.change('W3', 'src/legacy.js', { after: 'old\n' });
  const session = b.session('codex');
  const text = renderSessionStory(session, { windowResults: windowsOf([['I1', 'C1', 'C1-r'],
    ['I2', 'W2', 'W2-r'], ['I3', 'W3', 'W3-r']]), sessionStatus: 'NO_FINDINGS' });
  assert.ok(text.startsWith('# Add a retry to the upload client.\n'), 'the title is the first human ask');
  assert.match(text, /^Codex recording · 3 asks · 3 steps · /m);
  assert.doesNotMatch(text, /context messages? not shown/);
  const headings = text.split('\n').filter((line) => line.startsWith('### You'));
  assert.deepEqual(headings, ['### You: Add a retry to the upload client.',
    '### You: \\<send\\_user\\_message\\_question\\_reply\\>Use exponential backoff, capped at 30 seconds.\\</send\\_user\\_message\\_question\\_reply\\>',
    '### You: \\<my\\_notes\\>keep the old client around\\</my\\_notes\\>']);
  const product = productOf(text);
  assert.ok(product.includes('**1. You asked:** Add a retry to the upload client.\n'));
  assert.ok(product.includes('**3. You asked:** \\<my\\_notes\\>keep the old client around\\</my\\_notes\\>\n'));
  assert.equal((chartOf(text).match(/^\s*A\d+\(\[/gm) ?? []).length, 3);
});

test('M5: the story exports no actor rule; the one structural rule is whole top-level elements', () => {
  for (const name of ['CONTEXT_TAGS', 'HUMAN_REPLY_TAGS', 'isHarnessContext', 'isHarnessContextSpans', 'humanReplyText'])
    assert.equal(Object.hasOwn(story, name), false, name);
  const whole = [PLUGINS, REPLY, UNKNOWN, '  <environment_context>x</environment_context>  ', '<permissions instructions="w">\nz\n</permissions>',
    '<skills>a</skills>\n\n<apps>b</apps>', '<environment_context><environment_context>n</environment_context></environment_context>',
    '<turn_aborted>\n</turn_aborted>', '<skills>a</skills><my_notes>b</my_notes>', '<Skills>x</Skills>', '<x-y a="1">\nz\n</x-y>',
    '<a>one</a> <a>two</a>'];
  for (const text of whole) assert.equal(isWhollyElements(text), true, text);
  const words = ['<skills>a</skills> and more', 'Please read <skills>a</skills>', '<skills>unclosed', '', '   ', 'plain words',
    '<skills>a</skills>x<apps>b</apps>', '<skills>a</apps>', '# AGENTS.md instructions for /repo\n\n<INSTRUCTIONS>\nx\n</INSTRUCTIONS>'];
  for (const text of words) assert.equal(isWhollyElements(text), false, text);
});

// ---- requirements, grouped by the human words they cite -------------------------------------------------

const RETRY_ASK = 'Make the upload client retry a failed request three times with exponential backoff, and never retry a '
  + 'request that already succeeded. Log every retry.';
const CORE = 'retry a failed request three times with exponential backoff';
const SUBJECTS = ['The upload client', 'The client', 'Uploads', 'Each failed request', 'A failed upload'];
const PREDICATES = ['retries three times with backoff', 'is retried three times', 'backs off exponentially between retries',
  'gets three retries with exponential backoff', 'retries with exponential backoff, three attempts', 'is retried up to three times'];

/** One request re-proposed in 30 windows, in 30 wordings that each quote a different span of the same words. */
function repeatedRequirement() {
  const words = CORE.split(' ');
  const spans = [];
  for (let from = 0; from < 4; from++) for (let until = words.length; until > 4; until--) spans.push(words.slice(from, until).join(' '));
  const b = sessionBuilder();
  const lists = [];
  const narratives = [];
  for (let w = 0; w < 30; w++) {
    const before = b.events.length;
    if (!w) b.ask('I1', RETRY_ASK);
    b.run(`R${w}`, `cat src/upload-${w}.js`, 'succeeded', 'x');
    lists.push(b.events.slice(before).map((e) => e.id));
    const rows = [{ text: `${SUBJECTS[w % 5]} ${PREDICATES[Math.floor(w / 5)]}`, instruction: receipt('instruction', 'I1', spans[w % spans.length]),
      status: w === 29 ? 'addressed' : w < 10 ? 'open' : 'partly-addressed' }];
    // A second requirement, proposed from window 5 on, in its own words, from other words of the same instruction.
    if (w >= 5) rows.push({ text: w % 2 ? 'Succeeded requests are never retried' : 'No retry after a success',
      instruction: receipt('instruction', 'I1', w % 3 ? 'never retry a request that already succeeded' : 'request that already succeeded'),
      status: 'open' });
    narratives.push(rows);
  }
  // The report merges the windows' rows the way the review does: one row per instruction and exact text.
  const merged = new Map();
  for (const rows of narratives) for (const row of rows) merged.set(JSON.stringify([row.instruction.eventId, row.text]), row);
  return { session: b.session('codex'), report: { windowResults: windowsOf(lists, narratives), requirements: [...merged.values()],
    sessionStatus: 'NO_FINDINGS' }, narratives };
}

test('M33 S3 a requirement re-proposed in 30 windows, in 30 wordings, is one row in the human\'s own words', () => {
  const { session, report } = repeatedRequirement();
  assert.equal(new Set(report.requirements.map((r) => r.text.toLowerCase())).size, 32, 'text normalisation cannot merge them');
  const story = renderSessionStory(session, report);
  const rows = requirementRows(productOf(story));
  assert.ok(rows.length >= 1 && rows.length <= 3, `${rows.length} rows`);
  // Story /14 (D77 C): the thirty windows review one request, so they are one step, and every row says "step 1".
  assert.deepEqual(rows, [`- addressed: "${CORE}" (step 1)`, '- open: "never retry a request that already succeeded" (step 1)']);
  for (const row of rows) assert.ok(RETRY_ASK.includes(row.match(/"(.*)"/)[1]), 'the quoted words are the instruction\'s own');
  assert.doesNotMatch(story, /more requirements?/);
  assert.match(story, /\| 0 of 1 request fully addressed · 1 partly addressed \|/, 'the head row counts the groups');
  // The status is the LAST window's that proposed any row of the group, not that of the group's last report row.
  const early = { ...report, windowResults: report.windowResults.map((w, i) => (i === 29
    ? { ...w, narrative: { ...w.narrative, requirements: w.narrative.requirements.map((r, k) => (k ? r : { ...r, status: 'open' })) } } : w)) };
  assert.deepEqual(requirementRows(productOf(renderSessionStory(session, early))).slice(0, 1), [`- open: "${CORE}" (step 1)`]);
  // Without window narratives, nothing says which wording is the latest: each report row keeps the status of its own
  // latest window, so the group reads as the least addressed of them, and no step range is claimed.
  const bare = { ...report, windowResults: report.windowResults.map(({ narrative, ...rest }) => rest) };
  assert.deepEqual(requirementRows(productOf(renderSessionStory(session, bare))),
    [`- open: "${CORE}"`, '- open: "never retry a request that already succeeded"']);
});

test('M33 S3 overlapping quotes form one requirement only when they share half of the shorter one, and words with every other', () => {
  const b = sessionBuilder();
  b.ask('I1', 'alpha beta gamma delta epsilon zeta eta theta');
  b.run('R', 'echo', 'succeeded');
  const row = (quote, text, status = 'open') => ({ instruction: receipt('instruction', 'I1', quote), text, status });
  const render = (requirements) => requirementRows(productOf(renderSessionStory(b.session(), {
    windowResults: windowsOf([['I1', 'R', 'R-r']]), requirements })));
  // 'gamma delta' shares 5 of its 11 characters with 'delta epsilon': less than half, two requirements.
  assert.deepEqual(render([row('gamma delta', 'one'), row('delta epsilon', 'two')]), ['- open: "gamma delta"', '- open: "delta epsilon"']);
  // 'beta gamma delta' and 'gamma delta epsilon' share 'gamma delta' (11 of 16): one, read as the longer quote.
  assert.deepEqual(render([row('beta gamma delta', 'one'), row('gamma delta epsilon', 'two')]), ['- open: "gamma delta epsilon"']);
  // No chain: 'alpha beta gamma' and 'gamma delta epsilon' share too little, so 'beta gamma delta', which overlaps
  // both, continues one of them (the one it shares more words with) and never makes them one. A disjoint quote stays
  // apart; requirements keep the order the report first lists them in; a quote the other requirement also overlaps
  // is not how one reads while it has one of its own.
  assert.deepEqual(render([row('eta theta', 'z'), row('alpha beta gamma', 'a'), row('gamma delta epsilon', 'c'),
    row('beta gamma delta', 'b')]), ['- open: "eta theta"', '- open: "alpha beta gamma"', '- open: "gamma delta epsilon"']);
  // A quote that spans two requirements whose quotes share no word never joins them, whatever it overlaps.
  assert.deepEqual(render([row('alpha beta gamma', 'a', 'addressed'), row('delta epsilon zeta', 'd'),
    row('alpha beta gamma delta epsilon zeta', 'a and d', 'addressed')]),
  ['- addressed: "alpha beta gamma"', '- open: "delta epsilon zeta"']);
});

test('M33 S3 a requirement whose quote cannot be located falls back to its text', () => {
  const b = sessionBuilder();
  b.ask('I1', RETRY_ASK);
  b.run('R', 'echo', 'succeeded');
  const requirements = [
    { instruction: receipt('instruction', 'I1', CORE), text: 'Failed uploads are retried', status: 'addressed' },
    // Not in the instruction: it joins the located row with the same text, never a row of its own.
    { instruction: receipt('instruction', 'I1', 'words the human never wrote'), text: 'failed uploads are retried.', status: 'open' },
    // Not located, and no located row shares its text: grouped by text as compared, tidiest wording shown.
    { instruction: receipt('instruction', 'I1', 'also never said'), text: 'every retry is logged.', status: 'open' },
    { instruction: receipt('instruction', 'I1', 'nor this'), text: 'Every retry is logged', status: 'partly-addressed' },
  ];
  const rows = requirementRows(productOf(renderSessionStory(b.session(), { windowResults: windowsOf([['I1', 'R', 'R-r']]), requirements })));
  // Without window narratives, a requirement reads as the least addressed status of its rows.
  assert.deepEqual(rows, [`- open: "${CORE}"`, '- open: Every retry is logged']);
});

// ---- step blocks --------------------------------------------------------------------------------------

test('M33 S3, M1 a step block says each thing once: statements and failed commands are counted, their lists folded', () => {
  const b = sessionBuilder();
  b.ask('I', 'Write the handoff and run the suites.');
  b.change('W', 'docs/HANDOFF.md', { after: 'The client retries three times.\nBackoff is capped at 30 seconds.\nAll tests pass.\n' });
  b.run('T1', 'npm test', 'succeeded', 'pass');
  b.run('T2', 'node --test test/upload.test.js', 'failed', 'fail 1');
  b.run('T3', 'npx vitest run', 'succeeded', 'pass');
  b.run('T4', 'pytest -q', 'cancelled', '');
  const eventIds = b.events.map((e) => e.id);
  const written = [['The client retries three times', 'unverified'], ['Backoff is capped at 30 seconds', 'unverified'],
    ['All tests pass', 'contradicted']].map(([text, label], i) => ({ id: `w${i}`, stated: receipt('code', 'W', text), text, label,
    receipts: [] }));
  const report = { windowResults: windowsOf([eventIds]), writtenClaims: written, sessionStatus: 'NO_FINDINGS',
    decisions: [{ dimension: 'retry count', chosen: 'three', actions: ['W'], column: null, columnState: 'unchecked', materiality: 'material' }] };
  const story = renderSessionStory(b.session(), report);
  const block = section(engineerOf(story), '#### <a name="step-1"></a>', '---');
  assert.equal(block, [
    '#### <a name="step-1"></a>Step 1 — Wrote 1 file in docs · 2 commands failed · ran test/upload.test.js and npx vitest',
    '',
    '4 commands · files +3 −0 · helpers 0',
    '',
    '- Written into a file, contradicted by a recorded result: All tests pass',
    '- Wrote 2 statements into files (not checked)',
    '- Failed: 2 commands',
    '',
    '<details>',
    '<summary>Show the statements written into files</summary>',
    '',
    '- The client retries three times',
    '- Backoff is capped at 30 seconds',
    '',
    '</details>',
    '',
    '<details>',
    '<summary>Show the failed commands</summary>',
    '',
    '- `node --test test/upload.test.js` (exit 1)',
    '- `pytest -q` (exit 1)',
    '',
    '</details>',
    '',
    'Files: `docs/HANDOFF.md` +3 −0',
    '',
    '<details>',
    '<summary>Snippet: <code>docs/HANDOFF.md</code> · +3 −0</summary>',
    '',
    '```diff',
    '+The client retries three times.',
    '+Backoff is capped at 30 seconds.',
    '+All tests pass.',
    '```',
    '',
    '</details>',
    '',
    '',
  ].join('\n'));
  // The decision the review could not check is counted for leads, never again in the step.
  assert.doesNotMatch(story, /Decisions the review could not check/);
  assert.match(story, /\*\*Other decisions: 1\*\* — 1 agent; could not check if you asked/);
  // M1: commands that passed are no bullet; one statement and one failed command keep their single line.
  const passing = { ...report, writtenClaims: written.slice(0, 1) };
  const quiet = sessionBuilder();
  quiet.ask('I', 'Write the handoff and run the suites.');
  quiet.change('W', 'docs/HANDOFF.md', { after: 'The client retries three times.\n' });
  for (const [i, command] of ['npm test', 'npm run test:unit'].entries()) quiet.run(`T${i}`, command, 'succeeded', 'pass');
  const two = renderSessionStory(quiet.session(), { ...passing, windowResults: windowsOf([quiet.events.map((e) => e.id)]) });
  assert.match(two, /\n- Written into a file, not checked: The client retries three times\n\nFiles: /);
  const one = sessionBuilder();
  one.ask('I', 'Run it.');
  one.change('W', 'docs/HANDOFF.md', { after: 'x\n' });
  one.run('T', 'npm test', 'failed', 'fail 1');
  assert.match(renderSessionStory(one.session(), { windowResults: windowsOf([one.events.map((e) => e.id)]) }),
    /\n- Failed: `npm test` \(exit 1\)\n\nFiles: /);
});

test('M33 S3 folded lists are bounded and every item is shown or counted', () => {
  const b = sessionBuilder();
  b.ask('I', 'Run everything.');
  b.change('W', 'docs/HANDOFF.md', { after: Array.from({ length: 30 }, (_, i) => `Statement ${i} holds.`).join('\n') });
  for (let i = 0; i < 30; i++) b.run(`T${i}`, `node --test test/part-${i}.test.js`, 'failed', 'fail 1');
  const writtenClaims = Array.from({ length: 30 }, (_, i) => ({ id: `w${i}`, stated: receipt('code', 'W', `Statement ${i} holds`),
    text: `Statement ${i} holds`, label: 'unverified', receipts: [] }));
  const story = renderSessionStory(b.session(), { windowResults: windowsOf([b.events.map((e) => e.id)]), writtenClaims });
  const block = section(engineerOf(story), '#### <a name="step-1"></a>', 'Files: ');
  assert.ok(block.includes('- Wrote 30 statements into files (not checked)\n- Failed: 30 commands\n'));
  const listed = (summary) => section(block, `<summary>${summary}</summary>`, '</details>').split('\n').filter((l) => l.startsWith('- '));
  for (const [summary, what] of [['Show the statements written into files', 'statements'], ['Show the failed commands', 'failed commands']]) {
    const lines = listed(summary);
    assert.equal(lines.length, STORY_LIMITS.listedPerStep + 1, summary);
    assert.equal(lines[lines.length - 1], `- _…and ${30 - STORY_LIMITS.listedPerStep} more ${what} not shown._`);
  }
});

// ---- M33 S3 review repairs: requirements never merge across words they do not share, and never lose an open one --

/** One ask, one review window per list of rows `[text, quote, status]`; the report merges the windows' rows the way
 *  the review does (one row per instruction and exact text, the latest window's value kept). */
function narrated(ask, perWindow) {
  const b = sessionBuilder();
  const lists = [];
  perWindow.forEach((_, w) => {
    const before = b.events.length;
    if (!w) b.ask('I1', ask);
    b.run(`R${w}`, `cat src/part-${w}.js`, 'succeeded', 'x');
    lists.push(b.events.slice(before).map((e) => e.id));
  });
  const narratives = perWindow.map((rows) => rows.map(([text, quote, status]) => ({ text, instruction: receipt('instruction', 'I1', quote),
    status })));
  const merged = new Map();
  for (const rows of narratives) for (const row of rows) merged.set(JSON.stringify([row.instruction.eventId, row.text]), row);
  return { session: b.session('codex'), report: { windowResults: windowsOf(lists, narratives), requirements: [...merged.values()],
    sessionStatus: 'NO_FINDINGS' } };
}
const bareOf = (report) => ({ ...report, windowResults: report.windowResults.map(({ narrative, ...rest }) => rest) });
const WORDS = ' — the review\'s words: ';

const RETRIES = 'Add retries to the upload client and log every retry to the audit file.';
const UPLOADS = 'Add retries to the upload client';
const LOGGED = 'log every retry to the audit file';
const BOTH = 'Add retries to the upload client and log every retry to the audit file';

test('M33 S3 review: a quote that spans two requirements never joins them, and the open one stays open', () => {
  assert.ok(RETRIES.includes(BOTH) && BOTH.startsWith(UPLOADS) && BOTH.endsWith(LOGGED));
  const { session, report } = narrated(RETRIES, [
    [['Uploads retry', UPLOADS, 'open'], ['Retries are logged', LOGGED, 'open']],
    [['Uploads retry and every retry is logged', BOTH, 'partly-addressed'], ['Retries are logged', LOGGED, 'open']],
    [['Uploads retry', UPLOADS, 'addressed']],
  ]);
  const story = renderSessionStory(session, report);
  // The whole-sentence quote shares words with both; it may continue one of them, never make them one.
  // Story /14 (D77 C): the three windows review one request, so they are one step.
  assert.deepEqual(requirementRows(productOf(story)), [`- addressed: "${UPLOADS}" (step 1)`, `- open: "${LOGGED}" (step 1)`]);
  assert.match(story, /\| 0 of 1 request fully addressed · 1 partly addressed \|/);
  // Without window narratives the same holds: no open requirement disappears, and the request is not fully addressed.
  const bare = renderSessionStory(session, bareOf(report));
  assert.deepEqual(requirementRows(productOf(bare)), [`- addressed: "${UPLOADS}"`, `- open: "${LOGGED}"`]);
  assert.doesNotMatch(bare, /1 of 1 request fully addressed/);
});

const FLAKY = 'Fix the flaky upload test and update the changelog.';
const SENTENCE = 'Fix the flaky upload test and update the changelog';

test('M33 S3 review: requirements one window proposed side by side stay apart, even when they quote the same words', () => {
  // Window 2 re-proposes one of them, quoting the same words. L6: the quotes tie, and
  // no wording similarity breaks the tie any more (the English stop-word `alike` is deleted), so nothing structural
  // tells which one it continues: it is shown on its own, and no open one is ever closed by a guess.
  const { session, report } = narrated(FLAKY, [
    [['Changelog updated', SENTENCE, 'open'], ['Flaky upload test fixed', SENTENCE, 'open']],
    [['The flaky upload test is fixed', SENTENCE, 'addressed']],
  ]);
  const story = renderSessionStory(session, report);
  // Requirements read as the same human words, so each also says which one it is, in the review's words. (Story /14,
  // D77 C: both windows review the one request, so each row's step is step 1.)
  assert.deepEqual(requirementRows(productOf(story)), [`- open: "${SENTENCE}"${WORDS}Changelog updated (step 1)`,
    `- open: "${SENTENCE}"${WORDS}Flaky upload test fixed (step 1)`,
    `- addressed: "${SENTENCE}"${WORDS}The flaky upload test is fixed (step 1)`]);
  assert.match(story, /\| 0 of 1 request fully addressed · 1 partly addressed \|/);
  // Whatever the later row's words, the same holds.
  const guess = narrated(FLAKY, [
    [['Changelog updated', SENTENCE, 'open'], ['Flaky upload test fixed', SENTENCE, 'open']],
    [['Stabilised', SENTENCE, 'addressed']],
  ]);
  assert.deepEqual(requirementRows(productOf(renderSessionStory(guess.session, guess.report))), [
    `- open: "${SENTENCE}"${WORDS}Changelog updated (step 1)`, `- open: "${SENTENCE}"${WORDS}Flaky upload test fixed (step 1)`,
    `- addressed: "${SENTENCE}"${WORDS}Stabilised (step 1)`]);
  // Without window narratives nothing tells them apart: they are one row, and the least addressed status stands.
  const bare = renderSessionStory(session, bareOf(report));
  assert.deepEqual(requirementRows(productOf(bare)), [`- open: "${SENTENCE}"`]);
  assert.match(bare, /\| 0 of 1 request fully addressed \|/);
});

test('M33 S3 review, L6: two requirements quoting one sentence in 30 windows, in 30 wordings — each window\'s rows stand on their own, none closed by a guess', () => {
  const changelog = ['Changelog updated', 'The changelog is updated', 'Update the changelog', 'Changelog entry added',
    'The changelog has a new entry', 'A changelog line is written'];
  const flaky = ['Flaky upload test fixed', 'The flaky test is fixed', 'Upload test no longer flaky', 'The upload test passes reliably',
    'Flakiness in the upload test is gone', 'The upload test is stable'];
  const quotes = [SENTENCE, 'the flaky upload test and update the changelog', 'Fix the flaky upload test and update'];
  // Both are proposed in every window, citing the same words that window: only the review's words tell them apart.
  // L6: no wording similarity reads those words any more (the English stop-word
  // `alike` is deleted), so a later window's rows tie between the two and each starts a requirement of its own.
  const windows = Array.from({ length: 30 }, (_, w) => [
    [changelog[w % 6], quotes[w % 3], 'open'],
    [flaky[w % 6], quotes[w % 3], w === 29 ? 'addressed' : w < 20 ? 'open' : 'partly-addressed']]);
  const { session, report } = narrated(FLAKY, windows);
  assert.ok(new Set(report.requirements.map((r) => r.text)).size >= 12);
  const story = renderSessionStory(session, report);
  const rows = requirementRows(productOf(story));
  assert.ok(rows.length > 2, 'more rows, never a guessed merge');
  assert.ok(rows.length <= STORY_LIMITS.requirementsPerAsk + STORY_LIMITS.rowsPerAsk, 'bounded by the story\'s own limits');
  assert.ok(rows.every((row) => /\(step \d+\)$/.test(row)), 'no row continues another window\'s');
  for (const row of rows.filter((r) => changelog.some((c) => r.endsWith(`${WORDS}${c}`) || r.includes(`${WORDS}${c} (`))))
    assert.ok(row.startsWith('- open: '), `an open requirement is never closed: ${row.slice(0, 40)}`);
  assert.match(story, /\| 0 of 1 request fully addressed · 1 partly addressed \|/);
});

test('M33 S3 review: a quote found at more than one place in its request is not located, and falls back to its text', () => {
  const b = sessionBuilder();
  b.ask('I1', 'Run npm test, fix what fails, then run npm test again.');
  b.run('R', 'echo', 'succeeded');
  const requirements = [{ instruction: receipt('instruction', 'I1', 'npm test'), text: 'The suite is run', status: 'addressed' },
    { instruction: receipt('instruction', 'I1', 'npm test'), text: 'The suite is run again', status: 'open' }];
  const rows = requirementRows(productOf(renderSessionStory(b.session(), { windowResults: windowsOf([['I1', 'R', 'R-r']]), requirements })));
  assert.deepEqual(rows, ['- addressed: The suite is run', '- open: The suite is run again']);
});

test('M33 S3 review, M5: an element carries attributes only in attribute syntax, and a self-closing one is an element', () => {
  for (const text of ['<permissions instructions>\nNetwork access is restricted.\n</permissions>', '<apps/>',
    '<skills>a</skills>\n<apps />', '<apps note="x">b</apps>', "<skills kind='all'>a</skills>", '<my_notes/>'])
    assert.equal(isWhollyElements(text), true, text);
  // Words in a tag that are not attribute syntax are a human's: the text is not only elements.
  for (const text of ['<skills>a</skills> <apps please fix the login bug>b</apps>', '<skills>Fix it</skills and ship it>',
    '<apps please fix the login bug>b</apps>', '<apps/> fix it', '<apps note=x>b</apps>'])
    assert.equal(isWhollyElements(text), false, text);
});

test('M33 S3 review, M1: a failed command bullet and the contradicted statements stay visible past the bullet cap, bounded', () => {
  const b = sessionBuilder();
  b.ask('I', 'Write the handoff and run the suites.');
  b.change('W', 'docs/HANDOFF.md', { after: 'All tests pass.\n' });
  b.run('T1', 'npm test', 'failed', 'fail 1');
  b.run('T2', 'npm run test:unit', 'succeeded', 'pass');
  const decisions = Array.from({ length: 10 }, (_, i) => ({ dimension: `choice ${i}`, chosen: `value ${i}`, actions: ['W'],
    column: 'asked-settled', columnState: 'grounded', materiality: 'material' }));
  const written = (n) => [...Array.from({ length: n }, (_, i) => ({ id: `w${i}`, stated: receipt('code', 'W', 'All tests pass'),
    text: `Statement ${i} says all tests pass`, label: 'contradicted', receipts: [] })),
  ...['one', 'two'].map((k) => ({ id: `u${k}`, stated: receipt('code', 'W', 'All tests pass'), text: `Unchecked ${k}`, label: 'unverified',
    receipts: [] }))];
  const report = (n) => ({ windowResults: windowsOf([b.events.map((e) => e.id)]), decisions, writtenClaims: written(n),
    sessionStatus: 'NO_FINDINGS' });
  const block = (story) => section(engineerOf(story), '#### <a name="step-1"></a>', 'Files: ');
  const two = block(renderSessionStory(b.session(), report(2)));
  // Ten decisions fill the cap; the statements written unchecked are counted; the contradicted ones and the failed
  // command are kept.
  assert.ok(two.includes('\n- Written into a file, contradicted by a recorded result: Statement 1 says all tests pass\n'
    + '- Failed: `npm test` (exit 1)\n- _…and 1 item not shown._\n'), 'the failed command bullet is kept');
  assert.equal(two.includes('npm run test:unit'), false, 'a command that passed is no bullet');
  // Many contradicted statements: a frozen number stay on their own lines, the rest are counted and folded.
  for (const n of [600, 3000]) {
    const story = renderSessionStory(b.session(), report(n));
    assert.ok(Buffer.byteLength(story) <= STORY_LIMITS.targetBytes, `${n}: ${Buffer.byteLength(story)} bytes`);
    const lines = block(story).split('\n');
    assert.equal(lines.filter((l) => l.startsWith('- Written into a file, contradicted by a recorded result: ')).length,
      STORY_LIMITS.contradictedPerStep, `${n}`);
    assert.ok(lines.includes(`- ${n - STORY_LIMITS.contradictedPerStep} more statements written into files, contradicted by recorded results`), `${n}`);
    assert.ok(lines.includes('- Failed: `npm test` (exit 1)'), `${n}`);
    const folded = section(block(story), '<summary>Show the other contradicted statements</summary>', '</details>').split('\n')
      .filter((l) => l.startsWith('- '));
    assert.equal(folded.length, STORY_LIMITS.listedPerStep + 1);
    assert.equal(folded[folded.length - 1], `- _…and ${n - STORY_LIMITS.contradictedPerStep - STORY_LIMITS.listedPerStep} more statements not shown._`);
  }
});

test('M33 S3 review: a window that proposes one requirement twice, in the same words at the same place, shows it once', () => {
  const { session, report } = narrated(RETRIES, [
    [['Uploads retry', UPLOADS, 'open'], ['Uploads retry.', UPLOADS, 'open'], ['Retries are logged', LOGGED, 'open']],
    [['Uploads retry', UPLOADS, 'addressed'], ['Retries are logged', LOGGED, 'addressed']],
  ]);
  assert.deepEqual(requirementRows(productOf(renderSessionStory(session, report))),
    [`- addressed: "${UPLOADS}" (step 1)`, `- addressed: "${LOGGED}" (step 1)`]);
});

test('M33 S3 review: a review whose every row fits every requirement equally merges none of them, and stays bounded', () => {
  // 400 windows of 10 rows, all citing the same words in wordings that share none: nothing tells which row continues
  // which requirement, window after window. Past the work bound the later windows are grouped by their text.
  const windows = Array.from({ length: 400 }, (_, w) => Array.from({ length: 10 }, (__, k) => [`zq${w}x${k}`, SENTENCE,
    (w + k) % 3 ? 'open' : 'addressed']));
  const { session, report } = narrated(FLAKY, windows);
  const story = renderSessionStory(session, report);
  assert.ok(Buffer.byteLength(story) <= STORY_LIMITS.maxBytes);
  const product = productOf(story);
  const rows = requirementRows(product);
  const counted = Number(product.match(/- _…and (\d+) requirements not shown\._/)?.[1] ?? 0);
  assert.ok(rows.length > STORY_LIMITS.rowsPerAsk && rows.length <= STORY_LIMITS.rowsPerAsk + STORY_LIMITS.requirementsPerAsk);
  assert.equal(rows.length + counted, 4000, 'every row is its own requirement, shown or counted');
  assert.match(story, /\| 0 of 1 request fully addressed · 1 partly addressed \|/);
});
