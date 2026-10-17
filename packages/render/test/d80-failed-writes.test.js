// D80 (owner decision 2026-10-12), the first and fourth answers. (1) D79's "or failed" is narrowed: a write the slicer
// parsed from a command (a heredoc's body, `shellWriteOf`) has no change row only when its command did not run; one
// whose command failed keeps its row, never as done — named apart with its own closed words (its command failed, so
// Sonah could not read whether this write happened) in the report .md, on the page and as the write's evidence outcome
// (ledger.js `actionOutcome`, the form `command-failed`). (2) One phrase for a stopped command: a call the recorder
// typed with a stopped denial kind (`interrupted`, `cancelled`: ledger.js STOPPED_DENIALS) reads "stopped before it
// finished" in the report .md, on the page and in the evidence alike — never failed, never did not run. Typed fields only.
// D97: the page and the report .md (the story since /32) show them in their runs list and their header, by the
// report's own words (REPORT_OUTCOME_WORDS); the edit previews, the rows' cited commands, the story's step titles and
// bullets are gone with the checklist page and the story.
// Every session here is synthetic; every string, path and command is invented.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderReportMarkdown, storyFacts } from '../session-story.js';
import { renderSessionPage } from '../session-page.js';
import { reportModel } from '../report-model.js';
import { REPORT_OUTCOME_WORDS, REPORT_DID_WORDS } from '../report-words.js';
import { resultOutcome, actionOutcome, STOPPED_DENIALS, STOPPED_WORDS, RESULT_OUTCOME_WORDS }
  from '../../evidence/src/ledger.js';
import { CHECKLIST_OUTCOME_WORDS } from '../../evidence/src/review.js';
import { effectOf } from '../../evidence/src/session.js';
import { codeSnapshotPlan } from '../../evidence/src/code-pass.js';
import { sessionBuilder, STORY_KEY } from './session-story-fixture.js';
import { checklistSession, checklistReport } from './session-page-checklist-fixture.js';

const text = (b, key, value) => {
  b.blobs[key] = value;
  return value === '' ? [] : [{ sourceKey: key, fromByte: 0, untilByte: Buffer.byteLength(value, 'utf8') }];
};
/** A Bash call and its result, as d79-refusals.test.js builds them: Claude Code records a denial as an error result and
 *  types the kind on the result row, which the slicer carries on the call (`recorded.denial`). */
function command(b, id, cmd, { denial = null, result = 'failed', exitCode = null, isError = true } = {}) {
  b.events.push({ sequence: b.events.length, id, kind: 'invocation', callKey: id, tool: 'Bash', operation: 'command',
    paths: [], command: text(b, `${id}-cmd`, cmd), input: [], changes: [],
    recorded: { tool: 'Bash', ...(isError ? { isError: true } : {}), ...(denial ? { denial } : {}) } });
  b.events.push({ sequence: b.events.length, id: `${id}-r`, kind: 'observation', invocation: id, callKey: id,
    phase: 'terminal', result, exitCode, terminalStatusProven: true, output: [], sourceOfResult: 'native' });
}
const ends = {
  refused: (b, id, cmd) => command(b, id, cmd, { denial: 'user-rejected' }),
  failed: (b, id, cmd) => command(b, id, cmd, { exitCode: 1 }),
  interrupted: (b, id, cmd) => command(b, id, cmd, { denial: 'interrupted' }),
  cancelled: (b, id, cmd) => command(b, id, cmd, { denial: 'cancelled' }),
};
/** The sibling write the slicer emits beside a `cat > path <<'EOF'` command (`shellWriteOf` names the command). */
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

const FAILED_WORDS = 'its command failed, so Sonah could not read whether this write happened';
const STOPPED_WRITE_WORDS = 'its command stopped before it finished, so Sonah could not read whether this write '
  + 'happened';

/** One heredoc write of `src/a.js` by a command that ended as `end`, beside one plain Write of `NOTES.md`. */
function heredocBy(end) {
  const b = sessionBuilder();
  b.ask('I1', 'Write the module and run its checks.');
  b.change('W0', 'NOTES.md', { after: 'Writing the module.\n' });
  ends[end](b, 'H1', "cat > src/a.js <<'EOF'\nexport const a = 1;\nEOF\nnpm test");
  heredoc(b, 'H1-w1', 'H1', 'src/a.js', 'export const a = 1;\n');
  return b.session();
}

test('D80 the words: one phrase for a stopped call, and one for a write its failed or stopped command may not have '
  + 'made', () => {
    assert.equal(STOPPED_WORDS, 'stopped before it finished');
    assert.deepEqual([...STOPPED_DENIALS], ['interrupted', 'cancelled']);
    assert.equal(REPORT_OUTCOME_WORDS['no-terminal-status'].interrupted(), STOPPED_WORDS);
    const words = RESULT_OUTCOME_WORDS['no-terminal-status'];
    assert.equal(words.interrupted, `no terminal status recorded (${STOPPED_WORDS})`);
    assert.equal(CHECKLIST_OUTCOME_WORDS['no-terminal-status'](null, 'interrupted'), 'It stopped before it finished.');
    assert.equal(words['command-failed'], `no terminal status recorded (${FAILED_WORDS})`);
    assert.equal(words['command-stopped'], `no terminal status recorded (${STOPPED_WRITE_WORDS})`);
    assert.equal(REPORT_OUTCOME_WORDS['no-terminal-status']['command-failed'](),
      'its command failed, so Sonah could not read whether this write happened');
    assert.equal(REPORT_OUTCOME_WORDS['no-terminal-status']['command-stopped'](),
      'its command stopped, so Sonah could not read whether this write happened');
  });

test('D80 facts and report .md: a heredoc whose command failed keeps its row, named apart, never as done', () => {
  const session = heredocBy('failed');
  const facts = storyFacts(session, reportOf(session));
  // Its row is kept, marked; it is none of the changed files (no title verb, no file list, no "files changed").
  assert.deepEqual(facts.whole.unconfirmed.map((row) => [row.event.id, row.path, row.unconfirmed, row.counts.added]),
    [['H1-w1', 'src/a.js', 'failed', 1]]);
  assert.deepEqual(facts.whole.files.map((file) => file.path), ['NOTES.md']);
  assert.deepEqual(facts.whole.commands.map((c) => [c.failed, c.didNotRun, c.stopped]), [[true, false, false]]);
  // D97: the report .md lists the plain write only among the files, and says the failed command's write apart.
  const story = renderReportMarkdown(session, reportOf(session));
  assert.ok(story.includes('- `NOTES.md` · changed · +1 −0'), story);
  assert.ok(story.includes(REPORT_DID_WORDS.unconfirmed(1)));
  assert.equal(/`src\/a\.js` · /.test(story), false);
  assert.match(story, / · 1 file changed, \+1 −0 · /);
});

test('D80 facts and report .md: a heredoc of a refused command still has no row and no line', () => {
  const session = heredocBy('refused');
  const facts = storyFacts(session, reportOf(session));
  assert.deepEqual([facts.whole.unconfirmed.length, facts.whole.changes.map((row) => row.event.id)], [0, ['W0']]);
  const story = renderReportMarkdown(session, reportOf(session));
  assert.equal(story.includes(REPORT_DID_WORDS.unconfirmed(1)), false);
  assert.equal(story.includes('`src/a.js` · '), false);
  const page = textOf(renderSessionPage(session, reportOf(session)));
  assert.equal(page.includes(REPORT_DID_WORDS.unconfirmed(1)), false);
});

test('D80 page: the failed command\'s write is listed apart from the changed files', () => {
  const session = heredocBy('failed');
  const plain = textOf(renderSessionPage(session, reportOf(session)));
  // The files: the plain write only; the failed command's write said apart, never among them.
  assert.ok(plain.includes(`NOTES.md · changed · +1 −0 ${REPORT_DID_WORDS.unconfirmed(1)}`), plain);
  assert.equal(/src\/a\.js · /.test(plain), false);
  assert.deepEqual(actionOutcome(session, session.event('H1-w1')).form, 'command-failed');
});

test('D80 an interrupted and a cancelled denial read the same, stopped before it finished, in the facts, the page, '
  + 'the report .md and the evidence', () => {
    const read = (kind) => {
      const session = heredocBy(kind);
      const facts = storyFacts(session, reportOf(session));
      const c = facts.whole.commands.find((x) => x.event.id === 'H1');
      const story = renderReportMarkdown(session, reportOf(session));
      const page = renderSessionPage(session, reportOf(session));
      const t = textOf(page);
      const result = session.event('H1-r');
      return {
        story: [c.failed, c.didNotRun, c.stopped,
          story.includes("`cat > src/a.js <<'EOF' export const a = 1; EOF npm test` · stopped before it finished"),
          story.includes(REPORT_DID_WORDS.unconfirmed(1)), /failed, exit code|did not run: refused/.test(story)],
        page: [/<li id="run-1"><code>[^<]*<\/code> · stopped before it finished<\/li>/.test(page),
          // The write parsed from the command is its last recorded edit, after the command itself.
          t.includes('Sonah found no command that the agent ran after its last edit.'),
          t.includes(REPORT_DID_WORDS.unconfirmed(1)), /failed, exit code|did not run: refused/.test(page)],
        evidence: [resultOutcome(session, result), actionOutcome(session, session.event('H1-w1')).form,
          REPORT_OUTCOME_WORDS[resultOutcome(session, result).class][resultOutcome(session, result).form]()],
      };
    };
    const interrupted = read('interrupted');
    assert.deepEqual(read('cancelled'), interrupted);
    assert.deepEqual(interrupted.story, [false, false, true, true, true, false]);
    assert.deepEqual(interrupted.page, [true, true, true, false]);
    assert.deepEqual(interrupted.evidence, [{ class: 'no-terminal-status', form: 'interrupted',
      words: 'no terminal status recorded (stopped before it finished)' }, 'command-stopped',
    'stopped before it finished']);
  });

test('D80 page: the header and the runs count failed, refused and stopped commands apart',
  () => {
    const b = sessionBuilder();
    b.ask('I1', 'Set things up and run the checks.');
    // One written note, so the step is a full step with bullets, not a quiet one folded into a line.
    b.change('W0', 'NOTES.md', { after: 'Setting up.\n' });
    ends.failed(b, 'R1', 'npm test');
    ends.refused(b, 'R2', 'rm -rf build');
    ends.interrupted(b, 'R3', 'npm run watch');
    ends.cancelled(b, 'R4', 'npm run long');
    const s = b.session();
    const html = renderSessionPage(s, reportOf(s));
    const t = textOf(html);
    // D99 (F1 guard): a stopped or cancelled command has a recorded end: it is said as stopped, never "no recorded end".
    assert.ok(t.includes('After its last edit, the agent ran 3 commands. Results: 1 failed, 2 stopped before they '
      + 'finished. The recording shows 1 command after the agent\'s last edit as refused before it ran.'), t);
    assert.match(html, /<code>npm test<\/code> · failed, exit code 1<\/li>/);
    assert.match(html, /<code>rm -rf build<\/code> · did not run: refused<\/li>/);
    assert.match(html, /<code>npm run watch<\/code> · stopped before it finished<\/li>/);
    assert.match(html, /<code>npm run long<\/code> · stopped before it finished<\/li>/);
    // The report .md: the same header and the same runs, each kind apart.
    const story = renderReportMarkdown(s, reportOf(s));
    assert.ok(story.includes('After its last edit, the agent ran 3 commands. Results: 1 failed, 2 stopped before they '
      + 'finished. The recording shows 1 command after the agent\'s last edit as refused before it ran.'), story);
    for (const line of ['`npm test` · failed, exit code 1', '`rm -rf build` · did not run: refused',
      '`npm run watch` · stopped before it finished', '`npm run long` · stopped before it finished'])
      assert.ok(story.includes(line), line);
  });

test('D80 page: a failure row of a stopped call reads stopped before it finished, read again from the recording',
  () => {
    // The checklist fixture's refused call (`X2`, a failure row the report keeps as did-not-run), typed as stopped
    // instead.
    for (const kind of STOPPED_DENIALS) {
      const session = checklistSession();
      session.event('X2').recorded.denial = kind;
      const html = renderSessionPage(session, checklistReport());
      const run = reportModel(session, checklistReport(), {}).did.runs.shown.find((r) => r.text === 'rm -rf build');
      const at = html.indexOf(`id="run-${run.k}"`);
      const item = textOf(html.slice(at, html.indexOf('</li>', at)));
      assert.ok(item.includes('stopped before it finished'), item);
      assert.equal(item.includes('did not run'), false, kind);
    }
  });

test('D98 (review of A1a): a direct write the recorder typed as stopped is listed apart, never as a changed file', () => {
  // The one effect rule reads a call typed with a stopped denial kind as `unknown`, whatever its result says (D98), and
  // the code step names its path among the writes of unknown outcome. The story, the page and the report .md list it
  // apart, as they list a write its failed or stopped command may not have made: never "1 file changed".
  for (const kind of STOPPED_DENIALS) {
    const b = sessionBuilder();
    b.ask('I1', 'Write the notes.');
    b.change('W1', 'NOTES.md', { after: 'hello world\n', result: 'failed' });
    b.events.find((e) => e.id === 'W1').recorded = { denial: kind };
    const session = b.session();
    assert.equal(effectOf(session, session.event('W1')), 'unknown', kind);
    assert.deepEqual(codeSnapshotPlan(session).map((entry) => entry.path), ['NOTES.md'], kind);
    const facts = storyFacts(session, reportOf(session));
    assert.deepEqual(facts.whole.unconfirmed.map((row) => [row.event.id, row.path, row.unconfirmed]),
      [['W1', 'NOTES.md', 'stopped']], kind);
    assert.deepEqual([facts.whole.changes, facts.whole.files], [[], []], kind);
    assert.equal(reportModel(session, reportOf(session), {}).did.files.unconfirmed, 1, kind);
    const story = renderReportMarkdown(session, reportOf(session));
    assert.ok(story.includes(REPORT_DID_WORDS.unconfirmed(1)), story);
    assert.equal(/`NOTES\.md` · changed|1 file changed/.test(story), false, story);
    const page = textOf(renderSessionPage(session, reportOf(session)));
    assert.ok(page.includes(REPORT_DID_WORDS.unconfirmed(1)), page);
    assert.equal(/NOTES\.md · changed|1 file changed/.test(page), false, page);
  }
  // A direct write whose own result the record proved failed left nothing: no row, listed nowhere (effect undone).
  const b = sessionBuilder();
  b.ask('I1', 'Write the notes.');
  b.change('W1', 'NOTES.md', { after: 'hello world\n', result: 'failed' });
  const undone = b.session();
  assert.equal(effectOf(undone, undone.event('W1')), 'undone');
  const facts = storyFacts(undone, reportOf(undone));
  assert.deepEqual([facts.whole.unconfirmed, facts.whole.changes], [[], []]);
});
