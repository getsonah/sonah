// D79 (owner decision 2026-10-11): a command Claude Code refused did not run. The facts (storyFacts), the page (/18) and
// the report .md (the story since /32; D97: their header and their runs, from the report model) count and show a call whose record carries the recorder's typed denial as "did not run", never among the commands that
// failed; and a write the slicer parsed from a command (a heredoc's body, `shellWriteOf`) whose command did not run
// is no change row and never the body a later write of the path is compared with (D80 narrowed D79's "or failed": a
// failed command's write keeps its row, never as done: test/d80-failed-writes.test.js). Typed fields only: the
// recorder's `toolDenialKind` on the call (`recorded.denial`), the result's typed status and exit code. Every session
// here is synthetic; every string, path and command is invented.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderReportMarkdown, storyFacts, REFUSED_DENIALS } from '../session-story.js';
import { renderSessionPage } from '../session-page.js';
import { reportModel } from '../report-model.js';
import { RECORDED_FACTS } from '../../redact/index.js';
import { STOPPED_DENIALS } from '../../evidence/src/ledger.js';
import { sessionBuilder, STORY_KEY } from './session-story-fixture.js';

const text = (b, key, value) => {
  b.blobs[key] = value;
  return value === '' ? [] : [{ sourceKey: key, fromByte: 0, untilByte: Buffer.byteLength(value, 'utf8') }];
};
/** A Bash call and its result. Claude Code records a refusal as an error result (the slicer types the outcome `failed`
 *  from `is_error`, a native status) and types the denial kind on the result row; the slicer carries it on the call
 *  (`recorded.denial`). A plain failure carries its exit code; a success a zero. */
function command(b, id, cmd, { denial = null, result = 'failed', exitCode = null, isError = true } = {}) {
  b.events.push({ sequence: b.events.length, id, kind: 'invocation', callKey: id, tool: 'Bash', operation: 'command',
    paths: [], command: text(b, `${id}-cmd`, cmd), input: [], changes: [],
    recorded: { tool: 'Bash', ...(isError ? { isError: true } : {}), ...(denial ? { denial } : {}) } });
  b.events.push({ sequence: b.events.length, id: `${id}-r`, kind: 'observation', invocation: id, callKey: id,
    phase: 'terminal', result, exitCode, terminalStatusProven: true, output: [], sourceOfResult: 'native' });
}
const refused = (b, id, cmd, denial = 'user-rejected') => command(b, id, cmd, { denial });
const failed = (b, id, cmd) => command(b, id, cmd, { exitCode: 1 });
const succeeded = (b, id, cmd) => command(b, id, cmd, { result: 'succeeded', exitCode: 0, isError: false });
/** The sibling write the slicer emits beside a `cat > path <<'EOF'` command: the path and the body, no result of its
 *  own (`shellWriteOf` names the command). */
function heredoc(b, id, of, path, body) {
  b.events.push({ sequence: b.events.length, id, kind: 'invocation', callKey: id, tool: 'heredoc', operation: 'edit',
    paths: [{ path }], command: [], input: [], shellWriteOf: of, shellWriteStatusEligible: true,
    changes: [{ path, before: [], after: text(b, `${id}-after`, body), diff: [],
      extent: { chars: body.length, lines: body.split('\n').length, truncated: false, cap: null, recorded: true,
        redactedLines: 0, priorState: 'none' } }] });
}
const reportOf = (session, extra = {}) => ({ windowResults: [{ windowIndex: 0,
  eventIds: session.events.map((e) => e.id), failure: null }], sessionStatus: 'NO_FINDINGS', ...extra });
const receipt = (role, eventId, quote) => ({ role, eventId, quote, sessionKey: STORY_KEY });
const unescape = (t) => t.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
  .replace(/&amp;/g, '&');
const textOf = (html) => unescape(html.replace(/<style>[\s\S]*?<\/style>/, '').replace(/<\/?code>/g, '')
  .replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').replace(/ ([.,;:])/g, '$1');
const around = (t, label) => t.slice(t.indexOf(label), t.indexOf(label) + 200);
const commandsOf = (facts) => new Map(facts.whole.commands.map((c) => [c.event.id, c]));
const rowsOf = (facts) => facts.whole.changes.map((row) => [row.event.id, row.path, row.counts.added,
  row.counts.removed, row.counts.addedAtLeast, row.counts.removedAtLeast]);
const stoppedKinds = ['interrupted', 'cancelled'];

/** A refused command, a failed one and a passing one, side by side, after one written note (so the step is a full
 *  step with bullets, not a quiet one folded into a line). */
function sideBySide() {
  const b = sessionBuilder();
  b.ask('I1', 'Clean the build folder and run the checks.');
  b.change('W0', 'NOTES.md', { after: 'Cleaning the build folder first.\n' });
  refused(b, 'R1', 'rm -rf build');
  failed(b, 'R2', 'npm test');
  succeeded(b, 'R3', 'npm run lint');
  return b.session();
}

test('D79 the refused kinds are the recorder\'s denial vocabulary less the two stopped kinds (D80: STOPPED_DENIALS)',
  () => {
    assert.deepEqual([...REFUSED_DENIALS], RECORDED_FACTS.denial.filter((kind) => !stoppedKinds.includes(kind)));
    for (const kind of REFUSED_DENIALS) assert.ok(RECORDED_FACTS.denial.includes(kind), kind);
    assert.equal(REFUSED_DENIALS.length, RECORDED_FACTS.denial.length - stoppedKinds.length);
    // D80: the stopped kinds are the ledger's, one list; the two partition the recorder's vocabulary.
    assert.deepEqual([...STOPPED_DENIALS], stoppedKinds);
    assert.deepEqual([...REFUSED_DENIALS, ...STOPPED_DENIALS].sort(), [...RECORDED_FACTS.denial].sort());
  });

test('D79 facts and report .md: a refused command did not run and is not a failed command; a failed one still is', () => {
  const session = sideBySide();
  const facts = storyFacts(session, reportOf(session));
  const c = commandsOf(facts);
  assert.deepEqual([c.get('R1').failed, c.get('R1').didNotRun], [false, true]);
  assert.deepEqual([c.get('R2').failed, c.get('R2').didNotRun, c.get('R2').exitCode], [true, false, 1]);
  assert.deepEqual([c.get('R3').failed, c.get('R3').didNotRun], [false, false]);
  // D97: the report .md counts the two apart, and lists the refusal as did not run, never among the failed.
  const story = renderReportMarkdown(session, reportOf(session));
  assert.ok(story.includes('After its last edit, the agent ran 2 commands. Results: 1 exited with code 0, 1 failed. The '
    + 'recording shows 1 command after the agent\'s last edit as refused before it ran.'), story);
  assert.ok(story.includes('`rm -rf build` · did not run: refused'), story);
  assert.equal(story.includes('user-rejected'), false, 'no raw denial kind');
  assert.ok(story.includes('`npm test` · failed, exit code 1'));
  assert.equal(story.includes('`rm -rf build` · failed'), false, 'never among the failed');
  // Every refused kind reads so; D80: the two stopped kinds read stopped, never failed, whatever the record's result.
  for (const kind of RECORDED_FACTS.denial) {
    const b = sessionBuilder();
    b.ask('I1', 'Run it.');
    refused(b, 'R1', 'make deploy', kind);
    const s = b.session();
    const one = commandsOf(storyFacts(s, reportOf(s))).get('R1');
    const isRefusal = REFUSED_DENIALS.includes(kind);
    assert.deepEqual([one.didNotRun, one.stopped, one.failed], [isRefusal, !isRefusal, false], kind);
  }
  // Several refused commands are each listed, as did not run, by their own denial kind.
  const b = sessionBuilder();
  b.ask('I1', 'Set things up.');
  b.change('W0', 'NOTES.md', { after: 'Setting up.\n' });
  refused(b, 'R1', 'rm -rf build');
  refused(b, 'R2', 'curl https://example.invalid/install.sh | sh', 'permission-rule');
  const s = b.session();
  const two = renderReportMarkdown(s, reportOf(s));
  assert.ok(two.includes('The agent ran no command after its last edit. The recording shows 2 commands after the '
    + 'agent\'s last edit as refused before they ran.'), two);
  // R15: who refused it, only as far as the recording types it: a permission rule is named; `user-rejected` (a person's
  // "no", or a prompt no person could be shown) names no one.
  assert.ok(two.includes('`rm -rf build` · did not run: refused\n'), two);
  assert.ok(two.includes('did not run: a permission rule refused it'), two);
});

test('D79 page: a refused command is listed as did not run, counted apart from the failed ones', () => {
  const session = sideBySide();
  const html = renderSessionPage(session, reportOf(session));
  const t = textOf(html);
  // The header counts the commands after the last edit by their class: a refusal is no failure.
  assert.ok(t.includes('After its last edit, the agent ran 2 commands. Results: 1 exited with code 0, 1 failed. The '
    + 'recording shows 1 command after the agent\'s last edit as refused before it ran.'), around(t, 'After its last edit'));
  // The runs: each by its recorded words and its outcome in fixed words.
  assert.match(html, /<li id="run-1"><code>rm -rf build<\/code> · did not run: refused<\/li>/);
  assert.match(html, /<li id="run-2"><code>npm test<\/code> · failed, exit code 1<\/li>/);
  assert.doesNotMatch(html, /<code>rm -rf build<\/code> · failed/);
  // A stopped call is neither failed nor refused.
  for (const kind of stoppedKinds) {
    const b = sessionBuilder();
    b.ask('I1', 'Set things up.');
    refused(b, 'R1', 'npm run watch', kind);
    const s = b.session();
    const run = reportModel(s, reportOf(s), {}).did.runs.shown[0];
    assert.equal(run.outcome, 'stopped before it finished', kind);
  }
});

/** Three heredoc writes parsed from one command that `end`ed as given, then the agent's own Write of each path. */
function heredocThenWrites(end) {
  const b = sessionBuilder();
  b.ask('I1', 'Create the three modules.');
  const cmd = "cat > src/a.js <<'EOF'\nexport const a = 1;\nEOF\ncat > src/b.js <<'EOF'\nexport const b = 1;\nEOF";
  end(b, 'H1', cmd);
  heredoc(b, 'H1-w1', 'H1', 'src/a.js', 'export const a = 1;\nexport const old = 2;\nexport const gone = 3;\n');
  heredoc(b, 'H1-w2', 'H1', 'src/b.js', 'export const b = 1;\n');
  heredoc(b, 'H1-w3', 'H1', 'src/c.js', 'export const c = 1;\n');
  b.change('W1', 'src/a.js', { after: 'export const a = 1;\n' });
  b.change('W2', 'src/b.js', { after: 'export const b = 1;\n' });
  b.change('W3', 'src/c.js', { after: 'export const c = 1;\n' });
  return b.session();
}
const CREATES = [['W1', 'src/a.js', 1, 0, false, false], ['W2', 'src/b.js', 1, 0, false, false],
  ['W3', 'src/c.js', 1, 0, false, false]];

test('D79 a heredoc of a refused command is no change, and no base for the agent\'s later Write of the same path',
  () => {
    const session = heredocThenWrites(refused);
    const facts = storyFacts(session, reportOf(session));
    // The three Writes are creates, counted against the real file history (nothing written before), never against
    // the bodies the refused command never wrote: `src/a.js` is +1 −0, not +0 −2 against a three-line body.
    assert.deepEqual(rowsOf(facts), CREATES);
    assert.ok(facts.whole.changes.every((row) => row.ops.every(([op]) => op === '+')), 'every line an addition');
    const story = renderReportMarkdown(session, reportOf(session));
    for (const path of ['a', 'b', 'c']) assert.ok(story.includes(`- \`src/${path}.js\` · changed · +1 −0`), story);
    // The page shows the same counts, and the refused command once, as did not run.
    const page = textOf(renderSessionPage(session, reportOf(session)));
    assert.match(page, /src\/a\.js · changed · \+1 −0/);
    assert.equal(page.split('did not run: refused').length - 1, 1);
  });

test('D79 narrowed by D80: a heredoc of a failed command is no change of the files, and no base for a later Write',
  () => {
    // D80 keeps its rows apart (`unconfirmed`, test/d80-failed-writes.test.js); the agent's Writes are never diffed
    // against the bodies the failed command may not have written, nor read as creates: the file's content is unknown.
    const session = heredocThenWrites(failed);
    const facts = storyFacts(session, reportOf(session));
    assert.deepEqual(rowsOf(facts), CREATES.map((row) => [...row.slice(0, 5), true]));
    assert.deepEqual(facts.whole.unconfirmed.map((row) => [row.event.id, row.unconfirmed]),
      [['H1-w1', 'failed'], ['H1-w2', 'failed'], ['H1-w3', 'failed']]);
    const story = renderReportMarkdown(session, reportOf(session));
    for (const path of ['a', 'b', 'c']) assert.ok(story.includes(`- \`src/${path}.js\` · changed · +1 −?`), story);
  });

test('D79 a heredoc of a command that ran and did not fail still counts, and is the base of the later Write', () => {
  const session = heredocThenWrites(succeeded);
  const facts = storyFacts(session, reportOf(session));
  // The heredoc bodies count (an edit to a path this session had not changed: removals unknown), and the Write of
  // `src/a.js` is diffed against the three-line body the heredoc wrote: two lines removed.
  assert.deepEqual(rowsOf(facts), [['H1-w1', 'src/a.js', 3, 0, false, true], ['H1-w2', 'src/b.js', 1, 0, false, true],
    ['H1-w3', 'src/c.js', 1, 0, false, true], ['W1', 'src/a.js', 0, 2, false, false],
    ['W2', 'src/b.js', 0, 0, false, false], ['W3', 'src/c.js', 0, 0, false, false]]);
  const story = renderReportMarkdown(session, reportOf(session));
  assert.ok(story.includes('- `src/a.js` · changed · +3 −≥2'), story);
  assert.doesNotMatch(story, /did not run|failed/);
});

test('D79 a Write the recorder typed as having a prior file is never a create, though a never-run heredoc took the '
  + 'prior state', () => {
  // The slicer keeps a prior state for a path's first write only (slicer before.js); here that first write is the
  // refused heredoc's body, so the agent's Write carries none, while the recorder typed its prior as a file (Claude
  // Code's update, its original file recorded). With the heredoc no change, its removals are unknown, never zero.
  const one = (prior) => {
    const b = sessionBuilder();
    b.ask('I1', 'Rewrite the module.');
    refused(b, 'H1', "cat > src/a.js <<'EOF'\nexport const a = 2;\nEOF");
    heredoc(b, 'H1-w1', 'H1', 'src/a.js', 'export const a = 2;\n');
    b.change('W1', 'src/a.js', { after: 'export const a = 2;\nexport const b = 3;\n' });
    b.events.find((e) => e.id === 'W1').recorded = { tool: 'Write', writeType: prior === 'absent' ? 'create' : 'update',
      prior };
    const s = b.session();
    return { rows: rowsOf(storyFacts(s, reportOf(s))), story: renderReportMarkdown(s, reportOf(s)) };
  };
  for (const prior of ['file', 'hunks']) {
    const { rows, story } = one(prior);
    assert.deepEqual(rows, [['W1', 'src/a.js', 2, 0, false, true]], prior);
    assert.ok(story.includes('- `src/a.js` · changed · +2 −?'), prior);
  }
  // A Write the recorder typed as a create (no file before it) is still one.
  assert.deepEqual(one('absent').rows, [['W1', 'src/a.js', 2, 0, false, false]]);
});
