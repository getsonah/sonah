// D79 (owner decision 2026-10-11): a command Claude Code refused did not run. The story (/16) and the page (/18) count
// and show a call whose record carries the recorder's typed denial as "did not run", never among the commands that
// failed; and a write the slicer parsed from a command (a heredoc's body, `shellWriteOf`) whose command did not run
// is no change row and never the body a later write of the path is compared with (D80 narrowed D79's "or failed": a
// failed command's write keeps its row, never as done: test/d80-failed-writes.test.js). Typed fields only: the
// recorder's `toolDenialKind` on the call (`recorded.denial`), the result's typed status and exit code. Every session
// here is synthetic; every string, path and command is invented.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderSessionStory, storyFacts, activityPhrases, REFUSED_DENIALS, STORY_BULLETS, STORY_SENTENCES }
  from '../session-story.js';
import { renderSessionPage, PAGE_LABELS, PAGE_SENTENCES, PAGE_LIMITS, PAGE_OUTCOME_WORDS } from '../session-page.js';
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

test('D79 story: a refused command did not run and is not a failed command; a failed one still is', () => {
  const session = sideBySide();
  const facts = storyFacts(session, reportOf(session));
  const c = commandsOf(facts);
  assert.deepEqual([c.get('R1').failed, c.get('R1').didNotRun, c.get('R1').shown], [false, true, 'rm -rf build']);
  assert.deepEqual([c.get('R2').failed, c.get('R2').didNotRun, c.get('R2').exitCode], [true, false, 1]);
  assert.deepEqual([c.get('R3').failed, c.get('R3').didNotRun], [false, false]);
  // The title phrases count the two apart; a refusal is no alarm.
  assert.deepEqual(activityPhrases(facts.whole).map((p) => [p.key, p.text, p.tiny, p.alarm]),
    [['edit', 'wrote 1 file', 'wrote 1 file', false], ['failed', '1 command failed', '1 failed', true],
      ['didNotRun', '1 command did not run', '1 did not run', false]]);
  const story = renderSessionStory(session, reportOf(session));
  assert.match(story, /Step 1 — Wrote 1 file · 1 command failed · 1 command did not run\n/);
  assert.match(story, /\n- Failed: `npm test` \(exit 1\)\n- Did not run: `rm -rf build`\n/);
  assert.equal(story.includes(`${STORY_BULLETS.failed}: \`rm -rf build\``), false, 'never among the failed');
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
  // Several refused commands fold like several failed ones, and are kept past the bullet cap.
  const b = sessionBuilder();
  b.ask('I1', 'Set things up.');
  b.change('W0', 'NOTES.md', { after: 'Setting up.\n' });
  refused(b, 'R1', 'rm -rf build');
  refused(b, 'R2', 'curl https://example.invalid/install.sh | sh', 'permission-rule');
  const s = b.session();
  const two = renderSessionStory(s, reportOf(s));
  assert.match(two, /Step 1 — Wrote 1 file · 2 commands did not run\n/);
  assert.match(two, new RegExp(`- Did not run: 2 commands\\n\\n<details>\\n<summary>${STORY_SENTENCES.didNotRunSummary}`
    + '</summary>'));
});

test('D79 page: a refused command is listed and cited as did not run, counted apart from the failed ones', () => {
  const session = sideBySide();
  const html = renderSessionPage(session, reportOf(session));
  const t = textOf(html);
  assert.ok(t.includes(`${PAGE_LABELS.failed} 1 of 3 commands failed, and 1 did not run (refused before it ran); `
    + '2 are cited by no row on this page, in step 1.'), around(t, PAGE_LABELS.failed));
  assert.ok(t.includes(PAGE_LABELS.flaggedList(2)), 'a fold holding both kinds names commands, not failed commands');
  assert.match(html, /<code>npm test<\/code> <span class="flagchip">failed, exit 1<\/span>/);
  assert.match(html, /<code>rm -rf build<\/code> <span class="flagchip">did not run<\/span>/);
  assert.doesNotMatch(html, /<code>rm -rf build<\/code> <span class="flagchip">failed/);
  assert.match(t, /1 command failed · 1 command did not run/, 'the step title counts them apart');
  // Cited by a row: shown beside it under its own label, and folded out of the list.
  const finding = { origin: 'session-review', kind: 'claim_contradicted', status: 'FYI',
    title: 'The build folder was not cleaned', receipts: [receipt('action', 'R1', 'rm -rf build')] };
  const cited = renderSessionPage(session, reportOf(session, { sessionStatus: 'FYI', findings: [finding] }));
  assert.match(cited, new RegExp(`${PAGE_LABELS.didNotRunCited}</span> <code>rm -rf build</code> `
    + '<span class="flagchip">did not run</span>'));
  assert.doesNotMatch(cited, new RegExp(`${PAGE_LABELS.failedCited}</span> <code>rm -rf build`));
  assert.ok(textOf(cited).includes('1 of 3 commands failed, and 1 did not run (refused before it ran); 1 is shown '
    + 'beside the row that cites it; 1 is cited by no row on this page, in step 1.'));
  // Only refused commands: the sentence counts no failure, the fold names commands.
  const b = sessionBuilder();
  b.ask('I1', 'Set things up.');
  refused(b, 'R1', 'rm -rf build');
  succeeded(b, 'R2', 'npm test');
  const only = textOf(renderSessionPage(b.session(), reportOf(b.session())));
  assert.ok(only.includes(`${PAGE_LABELS.failed} 1 of 2 commands did not run (refused before it ran); 1 is cited by `
    + `no row on this page, in step 1. ${PAGE_LABELS.flaggedList(1)}`), around(only, PAGE_LABELS.failed));
  // No command failed or was refused: the fixed sentence says both.
  assert.equal(PAGE_SENTENCES.noFailed, 'No command was recorded as failed or refused.');
  // The page's chip and counts read the story's one phrase.
  assert.equal(PAGE_LABELS.didNotRun, STORY_SENTENCES.didNotRun);
});

test('D79 page: past the cited bound, the cut names failed commands only while every one it leaves out failed', () => {
  const cut = (order) => {
    const b = sessionBuilder();
    b.ask('I1', 'Run the checks.');
    const commands = ['npm test', 'npm run lint', 'npm run build', 'rm -rf build'];
    order.forEach((end, i) => end(b, `R${i + 1}`, commands[i]));
    const s = b.session();
    const finding = { origin: 'session-review', kind: 'claim_contradicted', status: 'FYI',
      title: 'The checks did not pass', receipts: commands.map((cmd, i) => receipt('action', `R${i + 1}`, cmd)) };
    const html = renderSessionPage(s, reportOf(s, { sessionStatus: 'FYI', findings: [finding] }));
    return [...html.matchAll(/<p class="cut">([^<]*)<\/p>/g)].map((m) => m[1]);
  };
  assert.equal(PAGE_LIMITS.citedFailed, 3);
  // The fourth cited command, left out, did not run: the cut counts commands.
  assert.deepEqual(cut([failed, failed, failed, refused]), ['And 1 more command it cites.']);
  // The fourth failed: the cut counts failed commands, as before.
  assert.deepEqual(cut([refused, failed, failed, failed]), ['And 1 more failed command it cites.']);
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
    const story = renderSessionStory(session, reportOf(session));
    assert.match(story, /Step 1 — Wrote 3 files in src · 1 command did not run\n/);
    assert.match(story, /\nFiles: `src\/a\.js` \+1 −0, `src\/b\.js` \+1 −0, `src\/c\.js` \+1 −0\n/);
    // The page shows the same counts, and the refused command once, as did not run.
    const page = textOf(renderSessionPage(session, reportOf(session)));
    assert.match(page, /src\/a\.js \+1 −0/);
    assert.ok(page.includes('1 of 1 command did not run (refused before it ran)'));
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
    const story = renderSessionStory(session, reportOf(session));
    assert.match(story, /Step 1 — Wrote 3 files in src · 1 command failed\n/);
    assert.match(story, /\nFiles: `src\/a\.js` \+1 −\?, `src\/b\.js` \+1 −\?, `src\/c\.js` \+1 −\?\n/);
  });

test('D79 a heredoc of a command that ran and did not fail still counts, and is the base of the later Write', () => {
  const session = heredocThenWrites(succeeded);
  const facts = storyFacts(session, reportOf(session));
  // The heredoc bodies count (an edit to a path this session had not changed: removals unknown), and the Write of
  // `src/a.js` is diffed against the three-line body the heredoc wrote: two lines removed.
  assert.deepEqual(rowsOf(facts), [['H1-w1', 'src/a.js', 3, 0, false, true], ['H1-w2', 'src/b.js', 1, 0, false, true],
    ['H1-w3', 'src/c.js', 1, 0, false, true], ['W1', 'src/a.js', 0, 2, false, false],
    ['W2', 'src/b.js', 0, 0, false, false], ['W3', 'src/c.js', 0, 0, false, false]]);
  const story = renderSessionStory(session, reportOf(session));
  assert.match(story, /Step 1 — Changed 3 files in src\n/);
  assert.doesNotMatch(story, /did not run|Failed:/);
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
    return { rows: rowsOf(storyFacts(s, reportOf(s))), story: renderSessionStory(s, reportOf(s)) };
  };
  for (const prior of ['file', 'hunks']) {
    const { rows, story } = one(prior);
    assert.deepEqual(rows, [['W1', 'src/a.js', 2, 0, false, true]], prior);
    assert.match(story, /\nFiles: `src\/a\.js` \+2 −\?\n/, prior);
  }
  // A Write the recorder typed as a create (no file before it) is still one.
  assert.deepEqual(one('absent').rows, [['W1', 'src/a.js', 2, 0, false, false]]);
});

test('D79 page: a check a row rests on that is a refused command\'s write did not run; any other one\'s has no result',
  () => {
    // The evidence reads a shell write through its command (C-06 item 6): a refused command's write did not run; the
    // write of any other command keeps no result recorded (C-02: its status never proves the write); D80: a failed
    // command's says its command failed.
    const b = sessionBuilder();
    b.ask('I1', 'Create the three modules.');
    refused(b, 'H1', "cat > src/a.js <<'EOF'\nexport const a = 1;\nEOF");
    heredoc(b, 'H1-w1', 'H1', 'src/a.js', 'export const a = 1;\n');
    failed(b, 'H2', "cat > src/b.js <<'EOF'\nexport const b = 1;\nEOF");
    heredoc(b, 'H2-w1', 'H2', 'src/b.js', 'export const b = 1;\n');
    succeeded(b, 'H3', "cat > src/c.js <<'EOF'\nexport const c = 1;\nEOF");
    heredoc(b, 'H3-w1', 'H3', 'src/c.js', 'export const c = 1;\n');
    const s = b.session();
    const row = { text: 'Create the three modules',
      instruction: receipt('instruction', 'I1', 'Create the three modules'),
      status: 'not-checked', reason: 'deliverable_ungrounded', restsOn: ['H1-w1', 'H2-w1', 'H3-w1'] };
    const narrative = { requirements: [{ text: row.text, instruction: row.instruction, status: row.status }] };
    const t = textOf(renderSessionPage(s, reportOf(s, { reviewScope: 'session-only', requirements: [row],
      windowResults: [{ windowIndex: 0, eventIds: s.events.map((e) => e.id), failure: null, narrative }] })));
    assert.ok(t.includes(`${PAGE_LABELS.restsOn} Tool heredoc ${PAGE_OUTCOME_WORDS['did-not-run'](null, 'denial')} `
      + `step 1 Tool heredoc ${PAGE_OUTCOME_WORDS['no-terminal-status'](null, 'command-failed')} step 1 Tool heredoc `
      + `${PAGE_OUTCOME_WORDS['no-terminal-status'](null, 'none')} step 1`),
    around(t, PAGE_LABELS.restsOn));
  });
