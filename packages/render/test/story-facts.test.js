// The facts every reader reads from a recording and its review (session-story.js `storyFacts`, `diffLines`,
// `durationWord`), ported from the session story's tests when the story became the report .md (D97, story /32): the
// line counts of each change, read from the recorded bodies only; your messages, read from the slicer's decision of
// which recorded message is a human's (harness context is never one); the asks the review tied to each message, grouped
// by the human words they cite and never merged by a guess; and how long the recording ran, from its own timestamps.
// Where a rule shows on the report, the report .md is read too. Every session and report here is synthetic.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { storyFacts, diffLines, durationWord, lineWord, renderReportMarkdown } from '../session-story.js';
import { REPORT_DID_WORDS } from '../report-words.js';
import { sessionBuilder, storySession, storyReport, STORY_KEY } from './session-story-fixture.js';
import { longSession, longReport, LONG_ASKS, LONG_HARNESS, LONG_SCHEDULED } from './session-story-long-fixture.js';
import { redisPivotSession, redisPivotPr, REDIS_PIVOT_TEXT } from '../../evidence/fixtures/redis-pivot.js';
import { DECISION_CANDIDATES, FINDING_CANDIDATES } from '../../evidence/fixtures/redis-pivot-candidates.js';
import { buildLedger } from '../../evidence/src/ledger.js';
import { planWindows } from '../../evidence/src/windows.js';
import { isWhollyElements } from '../../slicer/src/harness-context.js';
import * as story from '../session-story.js';

const receipt = (role, eventId, quote) => ({ role, eventId, quote, sessionKey: STORY_KEY });
/** A report of one window per list of event ids. */
const windowsOf = (lists, narratives = []) => lists.map((eventIds, windowIndex) => ({ windowIndex, eventIds, failure: null,
  ...(narratives[windowIndex] ? { narrative: { decisions: [], pivots: [], claims: [], requirements: narratives[windowIndex] } } : {}) }));
/** A session of `count` windows built by `each(b, i)`; the report holds one window per call. */
function built(count, each) {
  const b = sessionBuilder();
  const windows = [];
  for (let i = 0; i < count; i++) {
    const before = b.events.length;
    each(b, i);
    windows.push(b.events.slice(before).map((e) => e.id));
  }
  return { session: b.session(), report: { windowResults: windows.map((eventIds, windowIndex) =>
    ({ windowIndex, eventIds, failure: null })), sessionStatus: 'NO_FINDINGS' } };
}
/** The files a step changed, each with its line counts summed over its changes, as the readers print them. */
function filesOfStep(facts, n) {
  const step = facts.steps[n - 1];
  const files = new Map();
  for (const change of facts.whole.changes.filter((c) => step.events.includes(c.event))) {
    const c = files.get(change.path) ?? { added: 0, removed: 0, addedAtLeast: false, removedAtLeast: false };
    c.added += change.counts.added; c.removed += change.counts.removed;
    c.addedAtLeast ||= change.counts.addedAtLeast; c.removedAtLeast ||= change.counts.removedAtLeast;
    files.set(change.path, c);
  }
  return [...files].map(([path, counts]) => `${path} ${lineWord(counts)}`);
}
/** The asks of a review as the readers hold them: each by its status token and its words (quoted when they are the
 *  human's own, located in the message), in the order the readers number them. */
const asksOf = (session, report) => storyFacts(session, report).asks.flatMap((ask) => ask.requirements)
  .map((r) => `${r.status}: ${r.quoted ? `"${r.text}"` : r.text}`);

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

const RETRIES = 'Add retries to the upload client and log every retry to the audit file.';
const UPLOADS = 'Add retries to the upload client';
const LOGGED = 'log every retry to the audit file';
const BOTH = 'Add retries to the upload client and log every retry to the audit file';
const FLAKY = 'Fix the flaky upload test and update the changelog.';
const SENTENCE = 'Fix the flaky upload test and update the changelog';

// ---- line counts ---------------------------------------------------------------------------------------------------

test('M33 S line counts come from the recorded change bodies', () => {
  assert.deepEqual(diffLines(['a', 'b', 'c'], ['a', 'x', 'c']),
    { ops: [[' ', 'a'], ['-', 'b'], ['+', 'x'], [' ', 'c']], added: 1, removed: 1, exact: true });
  assert.deepEqual(diffLines([], ['a', 'b']), { ops: [['+', 'a'], ['+', 'b']], added: 2, removed: 0, exact: true });
  assert.deepEqual(diffLines(['a', 'b'], []), { ops: [['-', 'a'], ['-', 'b']], added: 0, removed: 2, exact: true });
  // Myers agrees with a plain LCS on seeded pseudo-random inputs.
  let seed = 7;
  const next = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed; };
  const lcs = (a, b) => {
    const t = Array.from({ length: a.length + 1 }, () => new Array(b.length + 1).fill(0));
    for (let i = a.length - 1; i >= 0; i--) for (let j = b.length - 1; j >= 0; j--)
      t[i][j] = a[i] === b[j] ? t[i + 1][j + 1] + 1 : Math.max(t[i + 1][j], t[i][j + 1]);
    return t[0][0];
  };
  for (let round = 0; round < 200; round++) {
    const a = Array.from({ length: next() % 30 }, () => String.fromCharCode(97 + (next() % 5)));
    const b = Array.from({ length: next() % 30 }, () => String.fromCharCode(97 + (next() % 5)));
    const d = diffLines(a, b);
    const common = lcs(a, b);
    assert.equal(d.added, b.length - common);
    assert.equal(d.removed, a.length - common);
    assert.deepEqual(d.ops.filter((op) => op[0] !== '+').map((op) => op[1]), a, 'the script replays the old side');
    assert.deepEqual(d.ops.filter((op) => op[0] !== '-').map((op) => op[1]), b, 'and the new side');
  }
  // Past its work bound the diff stops, and falls back to lower-bound counts with no script.
  const wide = Array.from({ length: 400 }, (_, i) => `a${i}`), other = Array.from({ length: 400 }, (_, i) => `b${i}`);
  assert.deepEqual(diffLines(wide, other, { maxWork: 1000 }), { ops: null, added: 400, removed: 400, exact: false });
  // Through the facts: create, delete, segment edit, whole-file-prior edit, replace-all, and no body.
  const { session, report } = built(1, (b) => {
    b.ask('I1', 'Change things.');
    b.change('W1', 'created.js', { after: 'one\ntwo\nthree\n' });
    b.change('W2', 'deleted.js', { operation: 'delete', before: 'x\ny\n' });
    b.change('W3', 'segment.js', { operation: 'edit', before: 'keep\nold\n', after: 'keep\nnew\nmore\n', priorState: 'edit-text' });
    b.change('W4', 'whole.js', { operation: 'edit', before: 'a\nb\nc\n', after: 'z\n' });
    b.change('W5', 'all.js', { operation: 'edit', before: 'p', after: 'q\nr', priorState: 'edit-text', extent: { replaceAll: true } });
    b.change('W6', 'shell.js', { after: '', extent: { recorded: false } });
    b.change('W7', 'failed.js', { after: 'never\n', result: 'failed' });
    // Two terminal receipts, one failed: the Session reads the outcome as unknown, so the write counts.
    b.change('W8', 'twice.js', { after: 'maybe\n' });
    b.events.push({ id: 'W8-r2', sequence: b.events.length, kind: 'observation', invocation: 'W8', callKey: 'W8',
      phase: 'terminal', result: 'failed', exitCode: 1, terminalStatusProven: true, output: [], sourceOfResult: 'native' });
  });
  assert.equal(session.actionOutcomeOf('W7'), 'failed');
  assert.equal(session.actionOutcomeOf('W8'), 'unknown');
  assert.deepEqual(filesOfStep(storyFacts(session, report), 1), ['created.js +3 −0', 'deleted.js +0 −2', 'segment.js +2 −1',
    'whole.js +1 −?', 'all.js +≥2 −≥1', 'shell.js +? −?', 'twice.js +1 −0'], 'a write the record says failed changed nothing');
});

test('M33 S a rewrite is diffed against the body written before it, never counted as a create', () => {
  const v1 = 'one\ntwo\nthree\nfour\n', v2 = 'one\nTWO\nthree\nfour\n';
  const { session, report } = built(2, (b, i) => {
    if (!i) {
      b.ask('I1', 'Write things twice.');
      b.change('W1', 'a.js', { after: v1 });                          // a create
      b.change('D1', 'gone.js', { operation: 'delete', before: 'old\n' });
      b.change('E1', 'edited.js', { after: 'e1\ne2\n' });
      b.change('E2', 'edited.js', { operation: 'edit', before: 'e1', after: 'E1', priorState: 'edit-text' });
      b.change('H1', 'shell.txt', { operation: 'edit', tool: 'heredoc', after: 'h1\nh2\n' });
      b.change('H2', 'expanded.txt', { operation: 'edit', tool: 'heredoc', after: 'x $HOME\n', extent: { expanded: true } });
    } else {
      b.ask('I2', 'Now write them again.');                           // a message of its own: a step of its own
      b.change('W2', 'a.js', { after: v2 });                          // the record keeps no prior: +1 −1
      b.change('W3', 'gone.js', { after: 'new\nfile\n' });            // after a delete: a create
      b.change('E3', 'edited.js', { after: 'x\n' });                  // after an edit: prior unknown
      b.change('H3', 'shell.txt', { operation: 'edit', tool: 'heredoc', after: 'h1\nh2\nh3\n' });   // after a heredoc body
      b.change('W4', 'cut.js', { after: 'c\n' });
      b.change('W5', 'cut.js', { after: 'c\nd\n', extent: { truncated: true } });
    }
  });
  const facts = storyFacts(session, report);
  assert.deepEqual(filesOfStep(facts, 1), ['a.js +4 −0', 'gone.js +0 −1', 'edited.js +3 −1', 'shell.txt +2 −?',
    'expanded.txt +≥1 −?']);
  // A rewrite of a body the recorder cut cannot be counted: the create before it is exact, the rewrite is not.
  assert.deepEqual(filesOfStep(facts, 2), ['a.js +1 −1', 'gone.js +2 −0', 'edited.js +1 −?', 'shell.txt +1 −0',
    'cut.js +≥1 −?']);
  // The report's size line sums the session's files.
  assert.match(renderReportMarkdown(session, report), / · 6 files changed, \+≥16 −≥3 · /);
});

test('M33 S redacted lines and CRLF line ends are counted honestly', () => {
  const { session, report } = built(1, (b) => {
    b.ask('I1', 'Change things.');
    b.change('W1', 'dropped.js', { after: 'a\nb\n', extent: { redactedLines: 2 } });
    b.change('W2', 'prior.js', { operation: 'edit', before: 'k\nsecret\n', after: 'k\n', priorState: 'edit-text',
      beforeExtent: { redactedLines: 1 } });
    b.change('W3', 'crlf.js', { after: 'x\r\ny\r\nz\r\nw\r\nv\r\n', before: 'x\ny\n' });
  });
  assert.deepEqual(filesOfStep(storyFacts(session, report), 1), ['dropped.js +≥2 −0', 'prior.js +0 −≥1', 'crlf.js +3 −0']);
});

test('M33 S writes outside the repository are counted and named (D90), never previewed', () => {
  const secret = Array.from({ length: 30 }, (_, i) => `private memory line ${i}`).join('\n');
  const outsidePath = 'Users/jdoe/.claude/projects/-Users-jdoe-acme/memory/feedback.md';
  const { session, report } = built(2, (b, i) => {
    if (!i) {
      b.ask('I1', 'Fix the typo.');
      b.change('W1', 'src/a.js', { operation: 'edit', before: 'teh', after: 'the', priorState: 'edit-text' });
      b.change('M1', outsidePath, { after: secret, outside: true });
    } else {
      b.delegate('D1', 'Look around.', 'k1');
      b.change('child:k1:M', 'tmp/claude-1/scratchpad/notes.md', { after: 'scratch\n', outside: true, childId: 'k1' });
    }
  });
  const facts = storyFacts(session, report);
  // The files are the repository's: a write outside it is counted and named, its text never previewed.
  assert.deepEqual(facts.whole.files.map((f) => `${f.path} ${lineWord(f.counts)}`), ['src/a.js +1 −1']);
  assert.deepEqual([facts.whole.outside, [...facts.whole.outsidePaths]], [2, [outsidePath, 'tmp/claude-1/scratchpad/notes.md']]);
  const md = renderReportMarkdown(session, report);
  for (const body of ['private memory', 'scratch\n']) assert.equal(md.includes(body), false, body);
  // Each path named as a code span, so a posted report pings no one and links nothing.
  assert.ok(md.includes(REPORT_DID_WORDS.outside(2, [outsidePath, 'tmp/claude-1/scratchpad/notes.md']
    .map((path) => `\`${path}\``).join(', '))), md);
});

test('M33 S duration is read only from timestamps the recording carries', () => {
  assert.equal(durationWord(storySession().events), null);
  const session = storySession();
  session.events[0].timestamp = '2026-09-30T10:00:00Z';
  session.events[session.events.length - 1].timestamp = '2026-09-30T11:05:30.500Z';
  assert.equal(durationWord(session.events), '1 h 6 min');
  assert.match(renderReportMarkdown(session, storyReport()), /^Claude Code recording · 1 h 6 min · /m);
  session.events[session.events.length - 1].timestamp = 'yesterday';
  assert.equal(durationWord(session.events), null, 'a timestamp the recording does not carry in ISO form counts nothing');
});

test('M33 S, D97 a real ledger report of the redis-pivot session reads its grounded rows on the report .md', () => {
  const session = redisPivotSession();
  const report = buildLedger({ repo: { host: 'github.com', id: '42' }, session, pr: redisPivotPr(),
    candidates: DECISION_CANDIDATES, findingCandidates: FINDING_CANDIDATES, sessionCoverage: 'complete' });
  const { session: omitted, ...saved } = report;
  assert.ok(omitted !== undefined);
  saved.windowResults = planWindows(session, { workTokens: 111, carriedTokens: 0, skimSideBytes: 3_600 })
    .map((w) => ({ windowIndex: w.index, eventIds: w.events.map((e) => e.id), failure: null }));
  const md = renderReportMarkdown(session, JSON.parse(JSON.stringify(saved)));
  // The contradicted claim, in the agent's words, and the recorded result against it.
  assert.ok(md.includes('“verified it works — the tests pass”'), md);
  assert.ok(md.includes('- A recorded result shows: “Tests: 1 failed, 11 passed, 12 total”'));
  assert.ok(md.includes('`config/redis.yml` · changed · +5 −0') || md.includes('`config/redis.yml` · new · +5 −0'));
  // M1: the failed command, by its recorded words and exit, in the runs.
  assert.ok(md.includes('`npm run test:integration` · failed, exit code 1'));
  // No ask of the review cites the message, so the report has no title of your words, and says so in its count line.
  assert.ok(md.startsWith('## Sonah review\n') && md.includes('Your prompt: Sonah found no ask to check.'), md.slice(0, 400));
  assert.ok(md.includes(`> ${REDIS_PIVOT_TEXT.ask.slice(0, 40)}`), 'the message is shown, folded, as recorded');
});

// ---- your messages: the slicer decides which recorded message is a human's ------------------------------------------

test('M33 S2, M5: harness context is never a message; the readers read the slicer\'s decision', () => {
  const { session, windows } = longSession();
  const report = longReport(session, windows);
  const facts = storyFacts(session, report);
  assert.equal(facts.asks.length, LONG_ASKS.length);
  assert.ok(LONG_HARNESS.every(({ id }) => session.event(id) === undefined || session.event(id) === null));
  const md = renderReportMarkdown(session, report);
  assert.ok(md.startsWith('## Sonah review · “Repair the session evidence so every review window sees the whole instruction'),
    'the title is the first human message');
  for (const tag of ['recommended_plugins', 'environment_context', 'user_instructions', 'permissions', 'skills', 'apps',
    'collaboration_mode']) assert.equal(md.includes(`&lt;${tag.replace(/_/g, '\\_')}`), false, tag);
  assert.equal(md.includes('Search the product docs'), false);
  assert.equal(md.includes('Follow the repository rules'), false, 'an ask read from harness context is not one');
  // One fold a message that holds an ask: its whole message, or its start when the report is shortened.
  assert.equal(md.split(/<details><summary>(?:Your whole message|The start of your message) /).length - 1,
    facts.asks.filter((ask) => ask.requirements.length).length, 'one fold a message that holds an ask');
  // Every human instruction event is a message, by its recorded words, whatever its shape: no tag list decides it.
  const b = sessionBuilder();
  const texts = ['  <environment_context>x</environment_context>  ', '<a>one</a> <a>two</a>', 'Please fix <b>this</b>',
    '<send_user_message_question_reply>yes</send_user_message_question_reply>'];
  texts.forEach((text, i) => b.ask(`I${i}`, text));
  b.run('C', 'echo', 'succeeded');
  const small = b.session();
  const smallReport = { windowResults: [{ windowIndex: 0, failure: null, eventIds: [...texts.map((_, i) => `I${i}`), 'C', 'C-r'] }] };
  assert.equal(storyFacts(small, smallReport).asks.length, 4);
  assert.equal(storyFacts(small, smallReport).steps.length, 4, 'one window holding four messages is four steps');
});

test('M33 S3, M5: every human instruction the slicer read is a message, shown as recorded; no reader decides an actor', () => {
  assert.equal((PLUGINS.match(/<\//g) ?? []).length, 8);
  const b = sessionBuilder();
  b.ask('I1', 'Add a retry to the upload client.');
  b.run('C1', 'cat src/upload.js', 'succeeded', 'x');
  b.ask('I2', REPLY);
  b.change('W2', 'src/upload.js', { operation: 'edit', before: 'send()', after: 'retry(send)', priorState: 'edit-text' });
  b.ask('I3', UNKNOWN);
  b.change('W3', 'src/legacy.js', { after: 'old\n' });
  const session = b.session('codex');
  const report = { windowResults: windowsOf([['I1', 'C1', 'C1-r'], ['I2', 'W2', 'W2-r'], ['I3', 'W3', 'W3-r']]),
    sessionStatus: 'NO_FINDINGS' };
  assert.deepEqual(storyFacts(session, report).asks.map((ask) => session.textSpansOf(ask.event, 'text').join('')),
    ['Add a retry to the upload client.', REPLY, UNKNOWN]);
  const md = renderReportMarkdown(session, report);
  assert.ok(md.includes('> Add a retry to the upload client.'), md);
  assert.ok(md.includes('> &lt;my\\_notes&gt;keep the old client around&lt;/my\\_notes&gt;'), md);
});

test('M5: the readers export no actor rule; the one structural rule is whole top-level elements', () => {
  for (const name of ['CONTEXT_TAGS', 'HUMAN_REPLY_TAGS', 'isHarnessContext', 'isHarnessContextSpans', 'humanReplyText'])
    assert.equal(Object.hasOwn(story, name), false, name);
  const whole = [PLUGINS, REPLY, UNKNOWN, '  <environment_context>x</environment_context>  ', '<permissions instructions="w">\nz\n</permissions>',
    '<skills>a</skills>\n\n<apps>b</apps>', '<environment_context><environment_context>n</environment_context></environment_context>',
    '<turn_aborted>\n</turn_aborted>', '<skills>a</skills><my_notes>b</my_notes>', '<Skills>x</Skills>', '<x-y a="1">\nz\n</x-y>',
    '<a>one</a> <a>two</a>', '<permissions instructions>\nNetwork access is restricted.\n</permissions>', '<apps/>',
    '<skills>a</skills>\n<apps />', '<apps note="x">b</apps>', "<skills kind='all'>a</skills>", '<my_notes/>'];
  for (const text of whole) assert.equal(isWhollyElements(text), true, text);
  const words = ['<skills>a</skills> and more', 'Please read <skills>a</skills>', '<skills>unclosed', '', '   ', 'plain words',
    '<skills>a</skills>x<apps>b</apps>', '<skills>a</apps>', '# AGENTS.md instructions for /repo\n\n<INSTRUCTIONS>\nx\n</INSTRUCTIONS>',
    '<skills>a</skills> <apps please fix the login bug>b</apps>', '<skills>Fix it</skills and ship it>',
    '<apps please fix the login bug>b</apps>', '<apps/> fix it', '<apps note=x>b</apps>'];
  for (const text of words) assert.equal(isWhollyElements(text), false, text);
});

// ---- the asks of an earlier report, grouped by the human words they cite ------------------------------------------

test('M33 S2 an earlier report\'s asks are one a distinct ask, with the last window\'s status', () => {
  const { session, windows } = longSession();
  const report = longReport(session, windows);
  const asks = storyFacts(session, report).asks.flatMap((ask) => ask.requirements);
  // L6: Q11's two asks cite the same words in every window, so a later window's pair ties between them, and no wording
  // similarity breaks the tie: each window's pair stands on its own. Every other ask cites words of its own: one each.
  const Q11 = LONG_ASKS.find((ask) => ask.id === 'Q11');
  const OWN = LONG_ASKS.filter((ask) => ask !== Q11);
  const q11Windows = report.windowResults.filter((w) => w.narrative.requirements.some((r) => r.instruction.eventId === Q11.id)).length;
  const distinct = OWN.reduce((n, ask) => n + ask.requirements.length, 0) + 1;
  assert.equal(asks.length, distinct + Q11.requirements.length * q11Windows);
  for (const ask of OWN) for (const r of ask.requirements) {
    const shared = ask.requirements.filter((x) => x.quote === r.quote).length > 1;
    const matching = asks.filter((x) => x.quoted && x.text === r.quote && (!shared || x.wording === r.text));
    assert.equal(matching.length, 1, r.quote);
    assert.ok(ask.text.includes(r.quote), 'the words shown are the ask\'s own');
    assert.equal(matching[0].status, r.final, `${r.quote} reads ${r.final}`);
  }
  // Two asks proposed side by side in every window, citing the same words, are never one: an open one stays open.
  assert.ok(asks.filter((x) => x.ask === Q11.id).some((x) => x.status === 'open'));
  // The last window that proposed it decides, not the last report row; without window narratives, the least addressed
  // of the report rows gives the status.
  assert.ok(asks.some((x) => x.text === LONG_SCHEDULED.quote && x.status === 'addressed'));
  const byRow = report.requirements.filter((r) => r.text.toLowerCase() === LONG_SCHEDULED.text.toLowerCase());
  assert.equal(byRow.at(-1).status, 'partly-addressed', 'the fixture makes the last report row disagree');
  const bare = { ...report, windowResults: report.windowResults.map(({ narrative, ...rest }) => rest) };
  assert.ok(storyFacts(session, bare).asks.flatMap((ask) => ask.requirements)
    .some((x) => x.text === LONG_SCHEDULED.quote && x.status === 'partly-addressed'));
  // A requirement reads in the human's own words.
  assert.ok(asks.some((x) => x.quoted && x.text === 'every review window sees the whole instruction history' && x.status === 'addressed'));
  assert.ok(asks.some((x) => x.quoted && x.text === 'fails on main; make it pass' && x.status === 'open'));
});

test('M33 S3 review, L6: a review that cites the same words of a message for every ask shows each window\'s on its own', () => {
  const { session, windows } = longSession();
  const report = longReport(session, windows);
  const opening = new Map(LONG_ASKS.map((ask) => [ask.id, ask.text.slice(0, 24)]));
  const requote = (r) => (opening.has(r.instruction.eventId) && r.instruction.quote !== 'a quote the ask never said'
    ? { ...r, instruction: { ...r.instruction, quote: opening.get(r.instruction.eventId) } } : r);
  const requoted = { ...report, requirements: report.requirements.map(requote), windowResults: report.windowResults.map((w) =>
    ({ ...w, narrative: { ...w.narrative, requirements: w.narrative.requirements.map(requote) } })) };
  const asks = storyFacts(session, requoted).asks.flatMap((ask) => ask.requirements);
  assert.ok(asks.length > LONG_ASKS.reduce((n, ask) => n + ask.requirements.length, 0) + 1, 'more asks, never a guessed merge');
});

test('M33 S3 an ask re-proposed in 30 windows, in 30 wordings, is one ask in the human\'s own words', () => {
  const { session, report } = repeatedRequirement();
  assert.equal(new Set(report.requirements.map((r) => r.text.toLowerCase())).size, 32, 'text normalisation cannot merge them');
  assert.deepEqual(asksOf(session, report), [`addressed: "${CORE}"`, 'open: "never retry a request that already succeeded"']);
  for (const row of asksOf(session, report)) assert.ok(RETRY_ASK.includes(row.match(/"(.*)"/)[1]), 'the words are the message\'s');
  // The status is the LAST window's that proposed any row of the group, not that of the group's last report row.
  const early = { ...report, windowResults: report.windowResults.map((w, i) => (i === 29
    ? { ...w, narrative: { ...w.narrative, requirements: w.narrative.requirements.map((r, k) => (k ? r : { ...r, status: 'open' })) } } : w)) };
  assert.deepEqual(asksOf(session, early).slice(0, 1), [`open: "${CORE}"`]);
  // Without window narratives, each report row keeps the status of its own latest window: the least addressed.
  assert.deepEqual(asksOf(session, bareOf(report)), [`open: "${CORE}"`, 'open: "never retry a request that already succeeded"']);
});

test('M33 S3 overlapping quotes form one ask only when they share half of the shorter one, and words with every other', () => {
  const b = sessionBuilder();
  b.ask('I1', 'alpha beta gamma delta epsilon zeta eta theta');
  b.run('R', 'echo', 'succeeded');
  const row = (quote, text, status = 'open') => ({ instruction: receipt('instruction', 'I1', quote), text, status });
  const read = (requirements) => asksOf(b.session(), { windowResults: windowsOf([['I1', 'R', 'R-r']]), requirements });
  assert.deepEqual(read([row('gamma delta', 'one'), row('delta epsilon', 'two')]), ['open: "gamma delta"', 'open: "delta epsilon"']);
  assert.deepEqual(read([row('beta gamma delta', 'one'), row('gamma delta epsilon', 'two')]), ['open: "gamma delta epsilon"']);
  assert.deepEqual(read([row('eta theta', 'z'), row('alpha beta gamma', 'a'), row('gamma delta epsilon', 'c'),
    row('beta gamma delta', 'b')]), ['open: "eta theta"', 'open: "alpha beta gamma"', 'open: "gamma delta epsilon"']);
  assert.deepEqual(read([row('alpha beta gamma', 'a', 'addressed'), row('delta epsilon zeta', 'd'),
    row('alpha beta gamma delta epsilon zeta', 'a and d', 'addressed')]), ['addressed: "alpha beta gamma"', 'open: "delta epsilon zeta"']);
});

test('M33 S3 an ask whose quote cannot be located falls back to its text', () => {
  const b = sessionBuilder();
  b.ask('I1', RETRY_ASK);
  b.run('R', 'echo', 'succeeded');
  const requirements = [
    { instruction: receipt('instruction', 'I1', CORE), text: 'Failed uploads are retried', status: 'addressed' },
    { instruction: receipt('instruction', 'I1', 'words the human never wrote'), text: 'failed uploads are retried.', status: 'open' },
    { instruction: receipt('instruction', 'I1', 'also never said'), text: 'every retry is logged.', status: 'open' },
    { instruction: receipt('instruction', 'I1', 'nor this'), text: 'Every retry is logged', status: 'partly-addressed' },
  ];
  assert.deepEqual(asksOf(b.session(), { windowResults: windowsOf([['I1', 'R', 'R-r']]), requirements }),
    [`open: "${CORE}"`, 'open: Every retry is logged']);
  // A quote found at more than one place in its message is not located, and falls back to its text.
  const twice = sessionBuilder();
  twice.ask('I1', 'Run npm test, fix what fails, then run npm test again.');
  twice.run('R', 'echo', 'succeeded');
  assert.deepEqual(asksOf(twice.session(), { windowResults: windowsOf([['I1', 'R', 'R-r']]), requirements: [
    { instruction: receipt('instruction', 'I1', 'npm test'), text: 'The suite is run', status: 'addressed' },
    { instruction: receipt('instruction', 'I1', 'npm test'), text: 'The suite is run again', status: 'open' }] }),
  ['addressed: The suite is run', 'open: The suite is run again']);
});

test('M33 S3 review: a quote that spans two asks never joins them; asks one window proposed side by side stay apart', () => {
  const { session, report } = narrated(RETRIES, [
    [['Uploads retry', UPLOADS, 'open'], ['Retries are logged', LOGGED, 'open']],
    [['Uploads retry and every retry is logged', BOTH, 'partly-addressed'], ['Retries are logged', LOGGED, 'open']],
    [['Uploads retry', UPLOADS, 'addressed']],
  ]);
  assert.deepEqual(asksOf(session, report), [`addressed: "${UPLOADS}"`, `open: "${LOGGED}"`]);
  assert.deepEqual(asksOf(session, bareOf(report)), [`addressed: "${UPLOADS}"`, `open: "${LOGGED}"`]);
  const side = narrated(FLAKY, [
    [['Changelog updated', SENTENCE, 'open'], ['Flaky upload test fixed', SENTENCE, 'open']],
    [['The flaky upload test is fixed', SENTENCE, 'addressed']],
  ]);
  assert.deepEqual(asksOf(side.session, side.report), [`open: "${SENTENCE}"`, `open: "${SENTENCE}"`, `addressed: "${SENTENCE}"`]);
  assert.deepEqual(storyFacts(side.session, side.report).asks[0].requirements.map((r) => r.wording),
    ['Changelog updated', 'Flaky upload test fixed', 'The flaky upload test is fixed'], 'each says which it is, in the review\'s words');
  // Without window narratives nothing tells them apart: one ask, the least addressed status.
  assert.deepEqual(asksOf(side.session, bareOf(side.report)), [`open: "${SENTENCE}"`]);
  // A window that proposes one ask twice, in the same words at the same place, holds it once.
  const dup = narrated(RETRIES, [
    [['Uploads retry', UPLOADS, 'open'], ['Uploads retry.', UPLOADS, 'open'], ['Retries are logged', LOGGED, 'open']],
    [['Uploads retry', UPLOADS, 'addressed'], ['Retries are logged', LOGGED, 'addressed']],
  ]);
  assert.deepEqual(asksOf(dup.session, dup.report), [`addressed: "${UPLOADS}"`, `addressed: "${LOGGED}"`]);
});

test('M33 S3 review, L6: rows that fit every ask equally merge none of them, and the grouping stays bounded', () => {
  const changelog = ['Changelog updated', 'The changelog is updated', 'Update the changelog', 'Changelog entry added',
    'The changelog has a new entry', 'A changelog line is written'];
  const flaky = ['Flaky upload test fixed', 'The flaky test is fixed', 'Upload test no longer flaky', 'The upload test passes reliably',
    'Flakiness in the upload test is gone', 'The upload test is stable'];
  const quotes = [SENTENCE, 'the flaky upload test and update the changelog', 'Fix the flaky upload test and update'];
  const windows = Array.from({ length: 30 }, (_, w) => [
    [changelog[w % 6], quotes[w % 3], 'open'],
    [flaky[w % 6], quotes[w % 3], w === 29 ? 'addressed' : w < 20 ? 'open' : 'partly-addressed']]);
  const { session, report } = narrated(FLAKY, windows);
  const asks = storyFacts(session, report).asks[0].requirements;
  assert.ok(asks.length > 2, 'more asks, never a guessed merge');
  for (const r of asks.filter((x) => changelog.includes(x.wording))) assert.equal(r.status, 'open', 'an open one is never closed');
  // 400 windows of 10 rows, all citing the same words in wordings that share none: past the work bound the later
  // windows are grouped by their text; every row is its own ask.
  const many = Array.from({ length: 400 }, (_, w) => Array.from({ length: 10 }, (__, k) => [`zq${w}x${k}`, SENTENCE,
    (w + k) % 3 ? 'open' : 'addressed']));
  const big = narrated(FLAKY, many);
  assert.equal(storyFacts(big.session, big.report).asks[0].requirements.length, 4000);
});
