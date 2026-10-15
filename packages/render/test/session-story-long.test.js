// M33 S2: the session story of a LONG session stays readable. The session here is synthetic
// (session-story-long-fixture.js) and reproduces the problems these tests pin:
// harness context shown as asks, "Ran N commands" titles, requirements repeated once per window, a
// "decided without asking" count swollen by decisions nobody could check, raw closed tokens, and length.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderSessionStory, commandFacts, STORY_LIMITS, STORY_SENTENCES, STORY_ENGINEER_CUTS } from '../session-story.js';
import { longSession, longReport, LONG_ASKS, LONG_HARNESS, LONG_SCHEDULED, LONG_STEPS, NOTABLE_STEPS, EDIT_STEPS,
  CONFIDENT_DECISIONS, UNCHECKED_DECISIONS, PIVOT_STEPS, BUSY_STEP, LONG_SHARED_QUOTE, editPath, testPath } from './session-story-long-fixture.js';
import { sessionBuilder, STORY_KEY } from './session-story-fixture.js';

const render = (options = {}) => {
  const { session, windows } = longSession();
  const report = longReport(session, windows);
  return { session, report, story: renderSessionStory(session, report, options) };
};
const { session: SESSION, report: REPORT, story: STORY } = render();

const section = (story, from, to) => story.slice(story.indexOf(from), to ? story.indexOf(to, story.indexOf(from)) : undefined);
// D88 (story /25): the leads' section first (the agent's judgment), then the product's; each ends where the next section
// starts.
const PRODUCT = section(STORY, '## <a name="for-product"></a>', '\n## ');
const LEAD = section(STORY, '## <a name="for-leads"></a>', '## <a name="for-product"></a>');
const ENGINEER = section(STORY, '## <a name="for-engineers"></a>');
/** Every Mermaid block of a story, as its lines: the overview first, then each request's step chart (M33 S5). */
function mermaidBlocks(story) {
  const blocks = [];
  for (let at = 0; ;) {
    const start = story.indexOf('```mermaid\n', at);
    if (start === -1) return blocks;
    const end = story.indexOf('\n```\n', start);
    blocks.push(story.slice(start + '```mermaid\n'.length, end).split('\n'));
    at = end;
  }
}
const chartLines = (story) => mermaidBlocks(story)[0];
const NODE = /^\s*([A-Za-z][A-Za-z0-9_]*)(\(\["|\{\{"|\{"|>"|\[\["|\[")(.*?)("\]\)|"\}\}|"\}|"\]\]|"\])$/;
/** The overview's nodes. */
const nodes = (story) => chartLines(story).map((line) => line.match(NODE)).filter(Boolean);
/** The nodes of every step chart. */
const stepChartNodes = (story) => mermaidBlocks(story).slice(1).flat().map((line) => line.match(NODE)).filter(Boolean);
const normalized = (text) => text.toLowerCase().replace(/[\p{P}\p{S}]+/gu, ' ').replace(/\s+/g, ' ').trim();
const steps = (from, to) => Array.from({ length: to - from + 1 }, (_, i) => from + i);
/** Story /14 (owner decision D77 C): a step is one of your requests, so the fixture's 113 review windows are eleven steps.
 *  The step (1-based) that holds the fixture's window step `s` is its request's number. */
const requestOf = (s) => LONG_ASKS.filter((ask) => ask.step <= s).length;
/** The story's Markdown escaping of a short plain text (session-story.js `md`), for the texts these tests compare. */
const md = (text) => text.replace(/[\\`*_[\]<>|~&#$]/g, (c) => `\\${c}`);

test('M33 S2, M5: harness context is never an ask, a title or a heading; the story reads the slicer\'s decision', () => {
  // M5: which recorded message is a human's is decided once, by the slicer (Codex: its
  // typed UserMessage channel), so harness context is no instruction event and the story counts none.
  assert.ok(STORY.startsWith('# Repair the session evidence so every review window sees the whole instruction h…\n'),
    'the title is the first HUMAN ask');
  for (const tag of ['recommended_plugins', 'environment_context', 'user_instructions', 'permissions', 'skills', 'apps', 'collaboration_mode'])
    for (const form of [tag, tag.replace(/_/g, '\\_')]) assert.equal(STORY.includes(`<${form}`) || STORY.includes(`\\<${form}`), false, tag);
  assert.equal(STORY.includes('Search the product docs'), false);
  assert.equal(STORY.includes('Follow the repository rules'), false, 'a requirement read from harness context is not a request');
  const headings = STORY.split('\n').filter((line) => line.startsWith('### You: '));
  assert.equal(headings.length, LONG_ASKS.length);
  assert.ok(headings.includes('### You: \\<code\\>npm test\\</code\\> fails on main; make it pass without skipping tests, then rerun \\<code\\>npm test\\</code\\>'),
    'text outside its elements makes a human ask');
  // Story /14 (D77 C): a step is one of your requests — eleven, over the fixture's 113 review windows.
  assert.match(STORY, new RegExp(`^Codex recording · ${LONG_ASKS.length} asks · ${LONG_ASKS.length} steps · `, 'm'));
  assert.doesNotMatch(STORY, /context messages? not shown/, 'the story re-decides no actor, so it counts no context');
  assert.ok(LONG_HARNESS.every(({ id }) => SESSION.event(id) === undefined || SESSION.event(id) === null));
  assert.ok(PRODUCT.includes(`**${LONG_ASKS.length}. You asked:**`) && !PRODUCT.includes(`**${LONG_ASKS.length + 1}. You asked:**`));
  const askNodes = nodes(STORY).filter(([, id]) => /^A\d+$/.test(id));
  assert.equal(askNodes.length, LONG_ASKS.length, 'one chart node per human ask');
  const commands = SESSION.events.filter((e) => e.kind === 'invocation' && e.operation === 'command').length;
  assert.match(STORY, new RegExp(`· ${commands} commands ·`));
  assert.equal(STORY.split(`<a name="step-${LONG_ASKS.length}"></a>`).length, 2);
  assert.equal(STORY.includes('<a name="step-30"></a>'), false, 'story /14: a step is a request, not a review window');
  // Every human instruction event is an ask, by its recorded words, whatever its shape: no tag list decides it here.
  const b = sessionBuilder();
  const texts = ['  <environment_context>x</environment_context>  ', '<a>one</a> <a>two</a>', 'Please fix <b>this</b>',
    '<send_user_message_question_reply>yes</send_user_message_question_reply>'];
  texts.forEach((text, i) => b.ask(`I${i}`, text));
  b.run('C', 'echo', 'succeeded');
  const story = renderSessionStory(b.session(), { windowResults: [{ windowIndex: 0, failure: null,
    eventIds: [...texts.map((_, i) => `I${i}`), 'C', 'C-r'] }] });
  // Story /14 (D77 C): one review window holding four requests is four steps, one per request (the first three hold
  // only the ask).
  assert.match(story, /^Claude Code recording · 4 asks · 4 steps · /m);
  assert.doesNotMatch(story, /context messages? not shown/);
  assert.ok(story.startsWith('# \\<environment\\_context\\>x\\</environment\\_context\\>\n'));
  assert.ok(story.includes('### You: \\<send\\_user\\_message\\_question\\_reply\\>yes'), 'shown as recorded, never re-read');
});

test('M33 S2, M1 step titles say what happened: edits, failed commands, commits, reads, scripts, helpers', () => {
  assert.doesNotMatch(STORY, /\bRan \d+ commands?\b/i, 'no step of this session needs the bare count');
  const heading = (n) => STORY.split('\n').find((line) => line.startsWith(`#### <a name="step-${n}"></a>Step ${n} — `));
  // Story /14 (D77 C): a step is one of your requests, so each title sums a request's windows: its edits (the agent's
  // and its helpers'), its failed commands, its commits and merges, its reads and its scripts — at most three phrases.
  // Request 1 (windows 1–7) edited two source files and two test files, ran five distinct scripts and read 19 files.
  assert.equal(heading(1), '#### <a name="step-1"></a>Step 1 — Edited 4 files in packages · read 19 files in packages · ran 5 scripts');
  // Request 2 (windows 8–19): three edit windows (two source files, three test files) and its helpers' two files, a
  // commit (window 10), and reads; a directory holding most, not all, of the files read.
  assert.equal(heading(2), '#### <a name="step-2"></a>Step 2 — Changed 7 files in packages · committed · read 22 files mostly in packages');
  // M1: a failed command leads where there is one; a passing runner command is no title word.
  assert.match(heading(3), /^#### <a name="step-3"><\/a>Step 3 — Edited 6 files in packages · 1 command failed · read \d+ files in packages$/);
  assert.match(heading(requestOf(44)), / · 1 command failed · merged$/);
  assert.match(heading(requestOf(60)), / · 1 command failed · managed worktrees$/);
  assert.match(heading(requestOf(BUSY_STEP.step)), / · 3 commands failed · committed$/);
  // Every request's step changed files, so none is quiet: eleven blocks, no folded line.
  for (let n = 1; n <= LONG_ASKS.length; n++) assert.ok(heading(n), `step ${n} has its block`);
  assert.equal(ENGINEER.split('\n').filter((line) => line.startsWith('<a name="step-')).length, 0);
  assert.doesNotMatch(STORY, /spawned \d+ helpers/, 'three phrases at most: the helpers give way to files, failures and reads');
  // Commands are classified segment by segment.
  const facts = (command) => commandFacts(command);
  assert.deepEqual(facts("sed -n '1,80p' ./packages/a.js").reads, ['packages/a.js']);
  assert.deepEqual(facts('nl -ba src/a.js | sed -n "1,20p"').reads, ['src/a.js']);
  assert.deepEqual(facts('rg -n "x.js" packages/src').reads, [], 'a pattern and a directory are not files read');
  assert.equal(facts('rg -n "x" packages/src').readOnly, true);
  assert.deepEqual(facts('git show HEAD:src/a.js').reads, []);
  assert.deepEqual(facts('git diff -- src/a.js src/b.md').reads, ['src/a.js', 'src/b.md']);
  assert.deepEqual(facts('cd pkg && git -C repo commit -m "fix a.js" && git push').git, ['commit', 'push']);
  assert.deepEqual(facts('git checkout -b topic').git, ['checkout']);
  assert.deepEqual(facts('node scripts/x.mjs --flag').scripts, ['scripts/x.mjs']);
  assert.deepEqual(facts('node -e "require(\'./a.js\')"').scripts, []);
  assert.deepEqual(facts('node --test a.test.js').scripts, ['a.test.js'], 'M1: a script file is a script, whatever runs it');
  assert.equal(Object.hasOwn(facts('node --test a.test.js'), 'test'), false, 'M1: no test fact');
  assert.deepEqual(facts('npx prettier --check .').scripts, ['npx prettier']);
  assert.deepEqual(facts('npx vitest run').scripts, ['npx vitest']);
  assert.deepEqual(facts('bash -lc "ls"').scripts, []);
  assert.equal(facts('python3 -m pip install requests').install, true);
  assert.equal(facts('npm i -D jest').install, true);
  assert.equal(facts('npm run lint').install, false);
  assert.deepEqual(facts("sed -i 's/a/b/' src/a.js").reads, [], 'an in-place sed writes');
  assert.equal(facts("sed -i 's/a/b/' src/a.js").readOnly, false);
  assert.equal(facts('cat a.js > b.js').readOnly, false, 'an output redirection writes');
  assert.deepEqual(facts('cat a.js 2>/dev/null').reads, ['a.js']);
  assert.deepEqual(facts("cat > out.md <<'EOF'\ncat secret.js\nEOF").reads, [], 'a heredoc body is not a command');
  assert.deepEqual(facts('constructor test && __proto__ x').git, []);
  // A step whose only commands are reads without a file named, and one with nothing classified.
  const b = sessionBuilder();
  b.ask('I', 'Go.');
  for (const [i, command] of ['git status', 'ls src', 'rg -n "x" src'].entries()) b.run(`A${i}`, command, 'succeeded');
  b.change('W', 'src/x.js', { after: 'x\n' });
  b.run('B0', 'echo one', 'succeeded');
  b.run('B1', 'make lint', 'succeeded');
  b.change('W2', 'src/y.js', { after: 'y\n' });
  const story = renderSessionStory(b.session(), { windowResults: [
    { windowIndex: 0, failure: null, eventIds: ['I', 'A0', 'A0-r', 'A1', 'A1-r', 'A2', 'A2-r', 'W', 'W-r'] },
    { windowIndex: 1, failure: null, eventIds: ['B0', 'B0-r', 'B1', 'B1-r', 'W2', 'W2-r'] }] });
  // Story /14: the two windows review one request, so they are one step, titled by what both did.
  assert.match(story, /Step 1 — Wrote 2 files in src\n/);
  assert.equal(story.includes('<a name="step-2"></a>'), false);
  const quiet = sessionBuilder();
  quiet.ask('I', 'Go.');
  for (const [i, command] of ['git status', 'ls src'].entries()) quiet.run(`A${i}`, command, 'succeeded');
  quiet.run('B0', 'echo one', 'succeeded');
  const two = renderSessionStory(quiet.session(), { windowResults: [
    { windowIndex: 0, failure: null, eventIds: ['I', 'A0', 'A0-r', 'A1', 'A1-r'] },
    { windowIndex: 1, failure: null, eventIds: ['B0', 'B0-r'] }] });
  assert.match(two, /\*\*Step 1\*\* · 3 commands · no changes/);
  assert.match(mermaidBlocks(two)[1].join('\n'), /S1\["1 · Ran 3 commands"\]/);
  assert.match(chartLines(two).join('\n'), /S1\["Step 1 · ran 3 commands"\]/, 'one reading phase in the overview');
});

test('M33 S2 requirements are one row per distinct requirement, with the last window\'s status', () => {
  const rows = PRODUCT.split('\n').filter((line) => /^- (addressed|partly addressed|open): /.test(line));
  // L6: Q11's two requirements cite the same words in every window, so a later window's
  // pair ties between them, and no wording similarity breaks the tie any more (the English stop-word `alike` is
  // deleted): each window's pair stands on its own. Every other requirement cites words of its own: one row each.
  const Q11 = LONG_ASKS.find((ask) => ask.id === 'Q11');
  const OWN = LONG_ASKS.filter((ask) => ask !== Q11);
  const q11Windows = REPORT.windowResults.filter((w) => w.narrative.requirements.some((r) => r.instruction.eventId === Q11.id)).length;
  const distinct = OWN.reduce((n, ask) => n + ask.requirements.length, 0) + 1;
  assert.equal(rows.length, distinct + Q11.requirements.length * q11Windows,
    'one row per distinct requirement, never one per window — except where only the review\'s words tell two apart');
  // M33 S3: the review reworded every requirement in every window, so text as compared cannot merge them; the
  // human words each row cites do. A requirement reads as those words, in quotation marks.
  const wordings = new Set(REPORT.requirements.map((r) => `${r.instruction.eventId} ${normalized(r.text)}`));
  assert.ok(wordings.size >= 3 * distinct, `${wordings.size} wordings in the report`);
  for (const ask of OWN) for (const r of ask.requirements) {
    // Requirements that cite the same words also say which they are, in the review's words (M33 S3 review).
    const shared = ask.requirements.filter((x) => x.quote === r.quote).length > 1;
    const matching = rows.filter((row) => row.includes(`: "${r.quote}"`) && (!shared || normalized(row).includes(normalized(r.text))));
    assert.equal(matching.length, 1, r.quote);
    assert.equal(matching[0].includes(' — the review\'s words: '), shared, r.text);
    assert.ok(ask.text.includes(r.quote), 'the words shown are the ask\'s own');
    const word = { addressed: 'addressed', 'partly-addressed': 'partly addressed', open: 'open' }[r.final];
    assert.ok(matching[0].startsWith(`- ${word}: "`), `${r.quote} reads ${word}`);
    // Story /14 (D77 C): a request's windows are one step, its own.
    const k = LONG_ASKS.indexOf(ask) + 1;
    assert.ok(matching[0].endsWith(` (step ${k})`), `${r.quote} was worked on in step ${k}`);
  }
  // Two requirements proposed side by side in every window, citing the same words, are never one: each window shows
  // its two, and the open one reads open in every window — none is closed by a guess.
  const q11 = rows.filter((row) => row.includes(' — the review\'s words: ') && /\(step 11\)$/.test(row));
  assert.equal(q11.length, Q11.requirements.length * q11Windows);
  for (const step of new Set(q11.map((row) => row.slice(row.lastIndexOf('(')))))
    assert.ok(q11.filter((row) => row.endsWith(step)).some((row) => row.startsWith('- open: ')), step);
  assert.ok(q11.some((row) => row.includes(`: "${LONG_SHARED_QUOTE}" — `)));
  // The last window that proposed it decides, not the last report row, and an ungrounded proposal is not one.
  assert.ok(rows.includes(`- addressed: "${LONG_SCHEDULED.quote}" (step ${requestOf(LONG_SCHEDULED.steps[0])})`));
  const byRow = REPORT.requirements.filter((r) => normalized(r.text) === normalized(LONG_SCHEDULED.text));
  assert.equal(byRow[byRow.length - 1].status, 'partly-addressed', 'the fixture makes the last report row disagree');
  // Eight visible per request, the rest in a details block.
  const q1 = PRODUCT.slice(PRODUCT.indexOf('**1. You asked:**'), PRODUCT.indexOf('**2. You asked:**'));
  const [visible, folded] = q1.split('<details>');
  assert.equal(visible.split('\n').filter((line) => line.startsWith('- ')).length, STORY_LIMITS.rowsPerAsk);
  assert.match(folded, /^\n<summary>Show 3 more requirements<\/summary>\n/);
  assert.equal(folded.split('\n').filter((line) => line.startsWith('- ')).length, 3);
  // The counts cell counts requests over distinct requirements, never rows.
  const full = LONG_ASKS.filter((ask) => ask.requirements.every((r) => r.final === 'addressed')
    && (ask.id !== LONG_SCHEDULED.ask || LONG_SCHEDULED.status === 'addressed')).length;
  assert.equal(full, 5);
  assert.match(STORY, /\| 5 of 11 requests fully addressed · 6 partly addressed \|/);
  assert.doesNotMatch(STORY, /\d+ of \d+ requirements/);
  // Without window narratives, the least addressed of the report rows gives the status and no step range is claimed.
  const bare = { ...REPORT, windowResults: REPORT.windowResults.map(({ narrative, ...rest }) => rest) };
  const plain = renderSessionStory(SESSION, bare);
  assert.ok(plain.includes(`- partly addressed: "${LONG_SCHEDULED.quote}"\n`));
});

test('M33 S3 review, L6: a review that cites the same words of a request for every requirement shows each window\'s rows on their own, none closed by a guess', () => {
  // The shape the S2 fixture had: every row of a request cites its first 24 characters, in every window. Every later
  // row then ties between the requirements of its request, and no wording similarity breaks the tie any more (L6: the English stop-word `alike` is deleted): each starts a requirement of its own.
  const opening = new Map(LONG_ASKS.map((ask) => [ask.id, ask.text.slice(0, 24)]));
  const requote = (r) => (opening.has(r.instruction.eventId) && r.instruction.quote !== 'a quote the ask never said'
    ? { ...r, instruction: { ...r.instruction, quote: opening.get(r.instruction.eventId) } } : r);
  const report = { ...REPORT, requirements: REPORT.requirements.map(requote), windowResults: REPORT.windowResults.map((w) =>
    ({ ...w, narrative: { ...w.narrative, requirements: w.narrative.requirements.map(requote) } })) };
  const story = renderSessionStory(SESSION, report);
  const product = section(story, '## <a name="for-product"></a>', '\n## ');
  const rows = product.split('\n').filter((line) => /^- (addressed|partly addressed|open): /.test(line));
  assert.ok(rows.length > LONG_ASKS.reduce((n, ask) => n + ask.requirements.length, 0) + 1, 'more rows, never a guessed merge');
  assert.ok(rows.every((row) => /\(step \d+\)$/.test(row)), 'no row continues another window\'s');
  // Every row reads as the request's own words and says which requirement it is in the review's words; rows past the
  // visible few of a request are folded and counted.
  assert.ok(rows.every((row) => / — the review's words: /.test(row)));
  assert.match(product, /<summary>Show \d+ more requirements<\/summary>/);
  // No request reads fully addressed while a row an earlier window proposed for it is still open.
  assert.match(story, /\| 0 of 11 requests fully addressed · 11 partly addressed \|/);
});

test('M33 S2 leads see only decisions the review is sure nobody asked for, in plain words', () => {
  // M33 brittleness H4: every one of them, whatever its materiality; the impact is shown beside it as a fact.
  const headline = CONFIDENT_DECISIONS.filter((d) => d.column === 'unasked').sort((a, b) => a.step - b.step);
  assert.equal(headline.length, 13);
  assert.match(STORY, /\| 5 of 11 requests fully addressed[^|]*\| 3 \| 13 \| 20 \|/, 'Decided without asking counts 13, not 113');
  const table = LEAD.split('\n').filter((line) => /^\| (\[\d+\]\(#step-\d+\)|\d+) \|/.test(line));
  assert.equal(table.length, headline.length);
  const words = { material: 'changes behaviour', structural: 'changes structure', cosmetic: 'cosmetic' };
  for (const [i, row] of table.entries()) {
    const d = headline[i];
    assert.match(row, new RegExp(`\\| ${words[d.materiality]} \\|$`));
  }
  assert.ok(LEAD.includes(`**Other decisions: ${CONFIDENT_DECISIONS.length - 13 + UNCHECKED_DECISIONS}** — 2 you asked, agent chose · `
    + `2 you settled · ${UNCHECKED_DECISIONS} agent; could not check if you asked`));
  const others = LEAD.slice(LEAD.indexOf('<summary>Show the other decisions</summary>'));
  assert.ok(others.split('\n').filter((line) => line.startsWith('- ')).length > 0, 'the rest are listed in a details block');
  assert.ok(LEAD.includes(STORY_SENTENCES.materialityLegend));
  // Changes of approach: fifteen visible, the rest in a details block.
  const approach = LEAD.slice(LEAD.indexOf('**Changes of approach**'));
  const [shown, rest] = approach.split('<details>');
  assert.equal(shown.split('\n').filter((line) => line.startsWith('- ')).length, 15);
  assert.equal(rest.split('\n').filter((line) => line.startsWith('- ')).length, PIVOT_STEPS.length + 3 - 15);
  // No closed token reaches a reader: not in prose, not in a chart label (the overview's or a step chart's).
  const prose = STORY.replace(/```mermaid[\s\S]*?```/g, '');
  const labels = [...nodes(STORY), ...stepChartNodes(STORY)].map(([, , , label]) => label).join('\n');
  const TOKENS = /\b(DECIDE|FYI|CLEAN|NO_FINDINGS|UNCHECKED)\b|asked-settled|asked-chose|partly-addressed|\bunasked\b|\bmaterial\b|\bstructural\b|\bunverified\b/;
  for (const text of [prose, labels]) assert.equal(text.match(TOKENS)?.[0] ?? null, null, 'a closed token reached a reader');
  // D71 (a): every finding is a "Finding", never a status.
  assert.match(STORY, /\*\*Finding\*\* · \[step 11\]\(#step-11\) — The final message says all checks pass/);
  assert.match(STORY, /\*\*Finding\*\* · \[step 3\]\(#step-3\) — /);
  assert.doesNotMatch(STORY, /Needs your decision|Worth a look|needs your decision|worth a look/);
});

test('M33 S2 the 113-window, eleven-request story stays under 70 KB with an overview of at most 30 nodes', () => {
  const size = Buffer.byteLength(STORY);
  assert.ok(size <= 70_000, `${size} bytes`);
  assert.ok(size <= STORY_LIMITS.targetBytes);
  const drawn = nodes(STORY);
  assert.ok(drawn.length <= STORY_LIMITS.overviewNodes, `${drawn.length} nodes`);
  assert.ok(new Set(drawn.map(([, id]) => id)).size === drawn.length);
  // Story /14 (D77 C): a step is one of your requests. Every step keeps one anchor, and every link points at one.
  for (let n = 1; n <= LONG_ASKS.length; n++) assert.equal(STORY.split(`<a name="step-${n}"></a>`).length, 2, `step ${n}`);
  assert.equal(STORY.includes(`<a name="step-${LONG_ASKS.length + 1}"></a>`), false);
  for (const [, n] of STORY.matchAll(/\(#step-(\d+)\)/g)) assert.ok(Number(n) >= 1 && Number(n) <= LONG_ASKS.length);
  // Every request's step edited files, so each keeps its full block, and nothing folds.
  for (let n = 1; n <= LONG_ASKS.length; n++) assert.match(ENGINEER, new RegExp(`^#### <a name="step-${n}"></a>Step ${n} — `, 'm'));
  assert.equal(ENGINEER.split('\n').filter((line) => line.startsWith('<a name="step-')).length, 0);
  // The two review windows that did not finish (68 and 71) both held request 7's work: its step says so, on its block.
  assert.deepEqual([68, 71].map(requestOf), [7, 7]);
  assert.match(ENGINEER, /Step 7 — [^\n]*\n\n\d+ commands · files \+\d+ −\d+ · helpers 0 · not reviewed \(the review of this step did not finish\)\n/);
  assert.match(STORY, /\| did not complete · 1 of 11 steps not reviewed \|/);
  // The overview states how it was simplified, and draws every request and the finding that needs a decision.
  assert.match(STORY, new RegExp(`${STORY_SENTENCES.overviewSimplified.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} `));
  const ids = new Set(drawn.map(([, id]) => id));
  assert.ok(ids.has('S11') && ids.has('F11'));
  for (let k = 1; k <= LONG_ASKS.length; k++) assert.ok(ids.has(`A${k}`) && ids.has(`S${k}`), `request ${k} and its step drawn`);
  for (const n of EDIT_STEPS) assert.match(STORY, new RegExp(`<a name="step-${requestOf(n)}"></a>Step ${requestOf(n)} — (Edited|Changed) \\d+ files in packages`));
});

test('M33 S2 past its target the engineer section sheds snippets before it stops, and says so', () => {
  const sized = (maxBytes) => render({ maxBytes }).story;
  const anchors = (story) => steps(1, LONG_ASKS.length).every((n) => story.split(`<a name="step-${n}"></a>`).length === 2);
  // Story /14 (D77 C): eleven steps, one per request, 49.6 KB at full detail (story /25, D88: the sections above the
  // engineer section hold what Sonah could not check too, 1.7 KB more). The step charts give way first (from 45 KB down),
  // then the cuts. Within 41 KB: snippets only where a finding or a decision made without asking is cited (opened).
  const forty = sized(41_000);
  assert.ok(Buffer.byteLength(forty) <= 41_000);
  assert.ok(forty.includes('_To keep this file short, snippets are shown only for steps with a finding or a decision made without asking._'));
  const snippets = forty.split('\n').filter((line) => line.startsWith('<summary>Snippet'));
  assert.ok(snippets.length > 0);
  assert.equal(forty.split('<details open>\n<summary>Snippet').length - 1, snippets.length, 'every snippet left is an open one');
  assert.ok(anchors(forty), 'every step is still shown');
  // Within 34 KB: no snippet, every step still shown.
  const small = sized(34_000);
  assert.ok(Buffer.byteLength(small) <= 34_000);
  assert.ok(small.includes('_To keep this file short, snippets are not shown._'));
  assert.doesNotMatch(small, /<summary>Snippet/);
  assert.ok(anchors(small));
  // Within 30.4 KB: no snippet, and file lists and failed commands only where a finding or a decision made without
  // asking is; every step still shown, and its title still names its files and failed commands. (Step 6 is the one
  // request with neither a finding nor a decision made without asking: it loses its file list.)
  const cut = sized(30_400);
  assert.ok(Buffer.byteLength(cut) <= 30_400);
  assert.ok(cut.includes(`_To keep this file short, ${STORY_ENGINEER_CUTS[3]}._`));
  assert.ok(anchors(cut));
  assert.match(cut, /Step 6 — Changed 4 files in packages · 1 command failed · managed worktrees\n/);
  assert.equal(section(cut, '<a name="step-6"></a>', '<a name="step-7"></a>').includes('Files: '), false);
  assert.ok(section(cut, '<a name="step-4"></a>', '<a name="step-5"></a>').includes('Files: '), 'a step with a decision made without asking keeps its files');
  assert.ok(section(cut, '<a name="step-11"></a>', '---').includes('- Failed: 3 commands'), 'a step with a finding keeps its failed commands');
  // Within 22 KB even that does not fit: the section stops, and says where.
  const tiny = sized(22_000);
  assert.ok(Buffer.byteLength(tiny) <= 22_000);
  assert.match(tiny, /_Stopped here to keep this file under 22 KB: steps \d+–11 are not shown\._/);
  for (const cut of STORY_ENGINEER_CUTS.slice(1)) assert.equal(STORY.includes(`_To keep this file short, ${cut}._`), false,
    'the default story needed no cut of its steps');
});

test('M33 S2 the long story is deterministic', () => {
  assert.equal(render().story, STORY);
});

// ---- M33 S2 repair (after adversarial review) ---------------------------------------------------------

const receipt = (role, eventId, quote) => ({ role, eventId, quote, sessionKey: STORY_KEY });
/** A session of `count` windows built by `each(b, i)`, and a report of one window per call plus `report`. */
function built(count, each, report = {}, adapter = 'codex') {
  const b = sessionBuilder();
  const windows = [];
  for (let i = 0; i < count; i++) {
    const before = b.events.length;
    each(b, i);
    windows.push(b.events.slice(before).map((e) => e.id));
  }
  return { session: b.session(adapter), report: { windowResults: windows.map((eventIds, windowIndex) =>
    ({ windowIndex, eventIds, failure: null })), sessionStatus: 'NO_FINDINGS', ...report } };
}

test('M33 S2 a claim written into a file is never folded away, even when the file is outside the repository', () => {
  // Step 2 only reads, runs a failing test and writes a PR body outside the repository: the claim that body
  // makes is the one place the story shows it, so the step keeps its block.
  // Story /14 (D77 C): a step is one of your requests, so each window here is asked for in a request of its own.
  const b = sessionBuilder();
  b.ask('I', 'Open a pull request for the fix.');
  b.run('A0', 'cat src/a.js', 'succeeded', 'x');
  b.ask('I2', 'Write the PR body.');
  b.run('A1', 'cat src/b.js', 'succeeded', 'x');
  b.run('T', 'npm test', 'failed', 'fail 2');
  b.change('W', '/tmp/pr-body.md', { after: 'All tests pass.\nThe fix is small.\n', outside: true });
  b.ask('I3', 'Add the notes.');
  b.run('A2', 'git status', 'succeeded', '');
  b.change('W2', '/tmp/notes.md', { after: 'The fix is small.\n', outside: true });
  b.ask('I4', 'Check the status.');
  b.run('A3', 'git status', 'succeeded', '');
  const report = { windowResults: [['I', 'A0', 'A0-r'], ['I2', 'A1', 'A1-r', 'T', 'T-r', 'W', 'W-r'], ['I3', 'A2', 'A2-r', 'W2', 'W2-r'],
    ['I4', 'A3', 'A3-r']].map((eventIds, windowIndex) => ({ windowIndex, eventIds, failure: null })),
  writtenClaims: [
    { id: 'w1', stated: receipt('code', 'W', 'All tests pass'), text: 'All tests pass', label: 'contradicted', receipts: [] },
    { id: 'w2', stated: receipt('code', 'W2', 'The fix is small'), text: 'The fix is small', label: 'unverified', receipts: [] }] };
  const story = renderSessionStory(b.session(), report);
  assert.match(story, /#### <a name="step-2"><\/a>Step 2 — Changed 1 file outside the repository · 1 command failed · read 1 file in src\n/);
  assert.ok(story.includes('- Written into a file, contradicted by a recorded result: All tests pass\n'));
  assert.match(story, /#### <a name="step-3"><\/a>Step 3 — /);
  assert.ok(story.includes('- Written into a file, not checked: The fix is small\n'));
  assert.equal(story.includes('/tmp/'), false, 'the outside paths are still never named');
  // The steps around them still fold.
  assert.match(story, /^<a name="step-1"><\/a>\*\*Step 1\*\* · /m);
  assert.match(story, /^<a name="step-4"><\/a>\*\*Step 4\*\* · /m);
});

test('M33 S2 every request keeps its heading and its visible rows, however many requirements each has', () => {
  // Each requirement cites its own words of its request (M33 S3 groups requirements by the words they cite).
  const clause = (a, k) => `clause ${k + 1} of request ${a + 1} keeps every grounded receipt and states each cut it makes`;
  for (const [asks, per] of [[11, 14], [11, 20], [40, 20]]) {
    const b = sessionBuilder();
    const windows = [];
    const ids = [];
    for (let s = 0; s < 113; s++) {
      const before = b.events.length;
      if (s % Math.floor(113 / asks) === 0 && ids.length < asks) {
        ids.push(`Q${ids.length + 1}`);
        b.ask(ids[ids.length - 1], `Request ${ids.length} asks for one more careful change to the evidence pipeline: `
          + `${Array.from({ length: per }, (_, k) => clause(ids.length - 1, k)).join('; ')}.`);
      }
      b.run(`R${s}`, `cat src/part-${s}.js`, 'succeeded');
      windows.push(b.events.slice(before).map((e) => e.id));
    }
    const requirements = ids.flatMap((id, a) => Array.from({ length: per }, (_, k) => ({
      instruction: receipt('instruction', id, clause(a, k)), status: k % 3 ? 'addressed' : 'open',
      text: `Requirement ${k + 1} of request ${a + 1}: the pipeline keeps every grounded receipt and states each cut it makes` })));
    const story = renderSessionStory(b.session('codex'), { windowResults: windows.map((eventIds, windowIndex) =>
      ({ windowIndex, eventIds, failure: null })), requirements, sessionStatus: 'NO_FINDINGS' });
    const product = section(story, '## <a name="for-product"></a>', '\n## ');
    assert.ok(Buffer.byteLength(product) <= Math.floor(STORY_LIMITS.targetBytes * 0.25), `${asks}×${per}: ${Buffer.byteLength(product)} bytes`);
    assert.doesNotMatch(product, /requests? not shown/, `${asks}×${per}: no request is dropped`);
    const parts = product.split(/\*\*\d+\. You asked:\*\* /).slice(1);
    assert.equal(parts.length, asks, `${asks}×${per}: every request is shown`);
    for (const [a, part] of parts.entries()) {
      const [visible, folded = ''] = part.split('<details>');
      const rows = (text) => text.split('\n').filter((line) => /^- (addressed|open): /.test(line)).length;
      const stated = [...part.matchAll(/…and (\d+) requirements? not shown/g)].reduce((n, m) => n + Number(m[1]), 0);
      assert.equal(rows(visible) + rows(folded) + stated, per, `request ${a + 1}: every requirement is shown or counted`);
      if (asks === 11) assert.equal(rows(visible), STORY_LIMITS.rowsPerAsk, `request ${a + 1} keeps its eight visible rows`);
      assert.match(part, /Worked on in /);
    }
  }
});

test('M33 S2 a script outside the working tree is counted in a title, never named', () => {
  const titleOf = (commands) => {
    const b = sessionBuilder();
    b.ask('I', 'Go.');
    commands.forEach((command, i) => b.run(`C${i}`, command, 'succeeded'));
    b.change('W', 'src/a.js', { after: 'a\n' });
    const story = renderSessionStory(b.session(), { windowResults: [{ windowIndex: 0, failure: null,
      eventIds: b.events.map((e) => e.id) }] });
    return story.split('\n').find((line) => line.startsWith('#### <a name="step-1"></a>'));
  };
  assert.equal(titleOf(['node /srv/scratch/probe.mjs']), '#### <a name="step-1"></a>Step 1 — Wrote 1 file in src · ran 1 script');
  assert.equal(titleOf(['python3 ~/notes/x.py', 'bash ../other/run.sh']), '#### <a name="step-1"></a>Step 1 — Wrote 1 file in src · ran 2 scripts');
  assert.equal(titleOf(['node scripts/a.mjs', 'npx /opt/tools/lint']), '#### <a name="step-1"></a>Step 1 — Wrote 1 file in src · ran 2 scripts');
  assert.equal(titleOf(['node scripts/a.mjs', 'npx prettier --check .']),
    '#### <a name="step-1"></a>Step 1 — Wrote 1 file in src · ran scripts/a.mjs and npx prettier');
});

test('M33 S2 the changes of approach are counted once, whatever room they get', () => {
  const b = sessionBuilder();
  b.ask('I', 'Go.');
  const pivots = [];
  for (let i = 0; i < 30; i++) {
    b.say(`P${i}`, `Switching ${i}`);
    pivots.push({ abandoned: `approach ${i} `.padEnd(80, 'x'), adopted: `plan ${i} `.padEnd(80, 'y'),
      receipts: [receipt('commentary', `P${i}`, `Switching ${i}`)] });
  }
  const report = { windowResults: [{ windowIndex: 0, failure: null, eventIds: b.events.map((e) => e.id) }], pivots };
  const session = b.session();
  for (let maxBytes = 20_000; maxBytes <= 70_000; maxBytes += 50) {
    const story = renderSessionStory(session, report, { maxBytes });
    const lead = section(story, '**Changes of approach**', '## <a name="for-product"></a>');
    const shown = lead.split('\n').filter((line) => /^- approach \d+ /.test(line)).length;
    const statements = [...lead.matchAll(/…and (\d+) changes? not shown/g)];
    assert.ok(statements.length <= 1, `${maxBytes}: one statement of what is left out`);
    assert.equal(shown + statements.reduce((n, m) => n + Number(m[1]), 0), pivots.length, `${maxBytes}: every change is shown or counted`);
    assert.ok(!/not shown\._\n\n<details>/.test(lead), `${maxBytes}: no details block after a cut`);
  }
});

test('M33 S2 leads read what the other decisions are first, and nothing claims a list that was cut', () => {
  assert.equal(STORY.includes('listed for leads'), false);
  // M33 S3: a step no longer repeats the count of decisions the review could not check; leads count them.
  assert.doesNotMatch(ENGINEER, /Decisions the review could not check/);
  assert.match(LEAD, new RegExp(`· ${UNCHECKED_DECISIONS} agent; could not check if you asked\\*?\\n`));
  const others = section(LEAD, '<summary>Show the other decisions</summary>', '</details>').split('\n').filter((line) => line.startsWith('- '));
  // M33 brittleness H4: in the C-06 decision order — you asked and the agent chose how, then you settled — each in step order.
  const confident = ['asked-chose', 'asked-settled'].flatMap((column) => CONFIDENT_DECISIONS.filter((d) => d.column === column)
    .sort((a, b) => a.step - b.step));
  // Story /14 (D77 C): each decision's step is its request's.
  assert.deepEqual(others.slice(0, confident.length).map((line) => Number(line.match(/step (\d+)/)[1])), confident.map((d) => requestOf(d.step)),
    'the decisions whose column the review derived come first, by who decided, each in step order');
  assert.ok(others.slice(confident.length).every((line) => line.includes('could not check') || line.includes('not shown')));
  assert.match(STORY, /\| Requests addressed \| Findings \| Decided without asking \| Changes of approach \| Review \|/);
});

test('M33 S2 a step that holds file changes is not drawn as quiet', () => {
  // In a step chart (M33 S5: the step-level chart of each request). Story /14 (D77 C): a request is one step, so each
  // chart holds one step node — its request's — and no group (there is nothing left to group).
  mermaidBlocks(STORY).slice(1).forEach((lines, k) => {
    const classes = new Map();
    for (const line of lines) {
      const m = line.match(/^\s*class (\S+) (\w+)$/);
      if (m) for (const id of m[1].split(',')) classes.set(id, m[2]);
    }
    const stepNodes = lines.map((line) => line.match(NODE)).filter(Boolean).filter(([, id]) => /^S\d+/.test(id));
    assert.deepEqual(stepNodes.map(([, id]) => id), [`S${k + 1}`], `chart ${k + 1} holds its request's one step`);
    for (const [, id, , label] of stepNodes) assert.equal(classes.get(id), label.includes(' · files ') ? 'step' : 'quiet', `${id}: ${label}`);
  });
  // In the overview, a phase that changed files is never drawn dashed.
  const classes = new Map();
  for (const line of chartLines(STORY)) {
    const m = line.match(/^\s*class (\S+) (\w+)$/);
    if (m) for (const id of m[1].split(',')) classes.set(id, m[2]);
  }
  for (const [, id, , label] of nodes(STORY).filter(([, id]) => /^S\d+/.test(id)))
    if (/(edited|changed|wrote|deleted) \d+ files?/.test(label)) assert.equal(classes.get(id), 'step', `${id}: ${label}`);
});

test('M33 S2 a requirement reads in the human\'s own words, and a request ends where its work ends', () => {
  // Story /14 (D77 C): a request's windows are one step, its own, so a request's rows and its "worked on" line name it.
  assert.ok(PRODUCT.includes('- addressed: "every review window sees the whole instruction history" (step 1)\n'));
  assert.ok(PRODUCT.includes('- open: "fails on main; make it pass" (step 5)\n'));
  const q5 = PRODUCT.slice(PRODUCT.indexOf('**5. You asked:**'), PRODUCT.indexOf('**6. You asked:**'));
  assert.match(q5, /Worked on in \[step 5\]\(#step-5\)\.\n/);
});

test('M33 S2 a long session whose every step is notable still lands within the target, and says what it left out', () => {
  // 113 steps that each read 15 files, edit 3, run two test commands and a status; a helper every fourth step
  // (27); 107 decisions the review could not check.
  // Story /14 (D77 C): a step is one of your requests, so each window's work is asked for in a request of its own.
  const { session, report } = built(113, (b, s) => {
    b.ask(`Q${s}`, `Request ${s}: change the next three modules of the evidence pipeline, keeping every receipt grounded.`);
    for (let c = 0; c < 15; c++) b.run(`R${s}-${c}`, `sed -n '1,80p' packages/evidence-pipeline/src/stage-${s}/module-${c}.js`, 'succeeded');
    for (let f = 0; f < 3; f++)
      b.change(`E${s}-${f}`, `packages/evidence-pipeline/src/stage-${s}/module-${f}-with-a-longer-name.js`, { operation: 'edit',
        before: `const a${f} = ${s};\nconst b = 1;\n`, after: `const a${f} = ${s + 1};\nconst b = 2;\n`, priorState: 'edit-text' });
    b.run(`T${s}-a`, `node --test --test-concurrency=1 packages/evidence-pipeline/test/stage-${s}.test.js`, s % 9 ? 'succeeded' : 'failed');
    b.run(`T${s}-b`, `npm test -- --grep stage-${s}`, 'succeeded');
    b.run(`G${s}`, 'git status --short', 'succeeded');
    if (s % 4 === 0 && s < 108) b.delegate(`D${s}`, `Check module ${s} of the evidence pipeline for regressions`, `c${s}`);
  }, {});
  report.decisions = Array.from({ length: 107 }, (_, k) => ({ dimension: `window rule ${k} for the evidence split`,
    chosen: `keep option ${k % 4} for the carried instruction history`, actions: [`E${(k * 37) % 113}-0`], column: null,
    columnState: 'unchecked', materiality: 'material' }));
  const story = renderSessionStory(session, report);
  assert.ok(Buffer.byteLength(story) <= STORY_LIMITS.targetBytes, `${Buffer.byteLength(story)} bytes`);
  for (let n = 1; n <= 113; n++) assert.equal(story.split(`<a name="step-${n}"></a>`).length, 2, `step ${n} is shown`);
  assert.ok(story.includes(`_To keep this file short, ${STORY_ENGINEER_CUTS[STORY_ENGINEER_CUTS.length - 1]}._`));
  assert.doesNotMatch(story, /_Stopped here/);
  // What the cut leaves out of a plain step is still in its title; a step with a finding keeps everything.
  assert.match(story, /Step 2 — Edited 3 files in packages\/evidence-pipeline\/src\/stage-1 · read 15 files/);
  assert.doesNotMatch(section(story, '## <a name="for-engineers"></a>'), /^Files: /m);
});

// ---- M33 S3 (long stories) -----------------------------------------------------------------------------------

test('M33 S3 in the long story a busy step says each thing once, and no step repeats the leads\' count', () => {
  // Story /14 (D77 C): the busy window is request 11's, the last step, whose block runs to the footer.
  const n = requestOf(BUSY_STEP.step);
  assert.equal(n, LONG_ASKS.length);
  const block = section(ENGINEER, `#### <a name="step-${n}"></a>`, '\n---');
  assert.match(block, new RegExp(`^#### <a name="step-${n}"></a>Step ${n} — Changed 4 files in packages · 3 commands failed · committed`));
  // M1: the failed commands, counted on one line with their recorded words folded (three in this request: the busy
  // window's, a quiet window's test run and the session's last run); the passing ones are no bullet.
  assert.ok(block.includes('\n- Written into a file, contradicted by a recorded result: All tests pass\n'
    + '- Wrote 2 statements into files (not checked)\n- Failed: 3 commands\n'));
  const listed = (summary) => section(block, `<summary>${summary}</summary>`, '</details>').split('\n').filter((l) => l.startsWith('- '));
  assert.deepEqual(listed('Show the statements written into files'), BUSY_STEP.written.filter(([, label]) => label === 'unverified')
    .map(([text]) => `- ${text}`));
  assert.deepEqual(listed('Show the failed commands'), ['- `node --test --test-concurrency=1 packages/evidence/test/window-split-3.test.js` (exit 1)',
    '- `npm run test:unit` (exit 1)', '- `npm test` (exit 1)']);
  assert.equal(ENGINEER.includes('could not check'), false);
  assert.doesNotMatch(ENGINEER, /- Tests: /, 'M1: no runner-name bullet');
  assert.ok(Buffer.byteLength(STORY) <= STORY_LIMITS.targetBytes);
});
