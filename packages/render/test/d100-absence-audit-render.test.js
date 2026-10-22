// D100 (the audit of absence sentences), the page: a run Sonah read no result of is said as what Sonah found, never as a
// run with no recorded end; "no recorded end" stays only where the slicer proved the recording holds none (D99's verified
// absence). Synthetic sessions only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { reportModel } from '../report-model.js';
import * as words from '../report-words.js';
import { RESULT_OUTCOME_CLASSES, resultOutcome } from '../../evidence/src/ledger.js';
import { sliceLineage } from '../../slicer/index.js';
import { COMMAND_STATUS_SOURCES } from '../../slicer/src/events.js';
import { redact } from '../../redact/index.js';
import { sessionFromLedger } from '../../evidence/adapters/sonah-ledger.js';
import { CHECKLIST_OUTCOME_WORDS, COVERAGE_SENTENCE } from '../../evidence/src/review.js';
import { sessionBuilder } from './session-story-fixture.js';

const textOf = (parts) => parts.map((p) => p.text).join('');
const window = (session) => [{ windowIndex: 0, eventIds: session.events.map((e) => e.id), failure: null }];

/** A session whose last edit is followed by a command with no result Sonah read (E1) and, with `background`, a
 *  background launch whose recording the slicer proved holds no end of it (E2: no `backgroundEnd` mark). */
function session({ background = false } = {}) {
  const b = sessionBuilder();
  b.ask('I1', 'Change it, then test it.');
  b.change('W1', 'src/a.js', { after: 'a\n' });
  b.events.push({ sequence: b.events.length, id: 'E1', kind: 'invocation', callKey: 'E1', tool: 'bash',
    operation: 'command', paths: [], command: [], input: [], changes: [] });
  if (background) {
    // E3: a background launch whose end the slicer could not read (`backgroundEnd: 'unread'`).
    b.events.push({ sequence: b.events.length, id: 'E3', kind: 'invocation', callKey: 'E3', tool: 'bash',
      operation: 'command', paths: [], command: [], input: [], changes: [], recorded: { backgroundTaskId: 'job3' },
      backgroundEnd: 'unread' });
    b.events.push({ sequence: b.events.length, id: 'E3-r', kind: 'observation', invocation: 'E3', callKey: 'E3',
      phase: 'terminal', sourceOfResult: 'unknown', output: [], result: 'unknown', exitCode: null,
      terminalStatusProven: false });
    b.events.push({ sequence: b.events.length, id: 'E2', kind: 'invocation', callKey: 'E2', tool: 'bash',
      operation: 'command', paths: [], command: [], input: [], changes: [], recorded: { backgroundTaskId: 'job1' } });
    b.events.push({ sequence: b.events.length, id: 'E2-r', kind: 'observation', invocation: 'E2', callKey: 'E2',
      phase: 'terminal', sourceOfResult: 'unknown', output: [], result: 'unknown', exitCode: null,
      terminalStatusProven: false });
  }
  return b.session();
}

test('D100: a command Sonah read no result of is said as what Sonah found, never as having no recorded end', () => {
  const s = session();
  const model = reportModel(s, { windowResults: window(s) }, {});
  // D133 (R2): what Sonah could not read of a run is said in What Sonah could not check, with its count.
  assert.deepEqual(model.header.runs, ['After its last edit, the agent ran 1 command.']);
  assert.ok(model.notChecked.quiet.includes('Results: for 1 Sonah found no result.'), model.notChecked.quiet);
  assert.deepEqual(model.did.runs.shown.map((run) => run.outcome), ['Sonah found no result of it']);
});

test('D100: "no recorded end" stays only for a background run whose recording the slicer proved holds none', () => {
  const s = session({ background: true });
  const model = reportModel(s, { windowResults: window(s) }, {});
  assert.deepEqual(model.header.runs, ['After its last edit, the agent ran 3 commands.', 'Results: 1 has no recorded end.']);
  assert.ok(model.notChecked.quiet.includes('Results: for 1 Sonah found no result, for 1 Sonah could not read whether or '
    + 'how it ended.'), model.notChecked.quiet);
  assert.deepEqual(model.did.runs.shown.map((run) => run.outcome), ['Sonah found no result of it',
    'later records mention this run, but Sonah could not read whether or how it ended',
    'started in the background, no end recorded']);
});

test('D100: a failure whose result Sonah cannot find, or now reads otherwise, states no absence', () => {
  const s = session({ background: true });
  const failure = (eventId, action, outcome, form) => ({ eventId, action, outcome, form, tool: 'Bash',
    handling: 'passed-over' });
  // E9-r names a result this session does not hold; E2-r is a run Sonah reads as having no recorded end (proved); E3-r a
  // stored failure row whose run Sonah now reads as one whose end it could not read.
  const model = reportModel(s, { windowResults: window(s), failures: [failure('E9-r', 'E9', 'no-terminal-status',
    'none'), failure('E2-r', 'E2', 'no-terminal-status', 'background'),
  failure('E3-r', 'E3', 'no-terminal-status', 'background')] }, {});
  const items = Object.values(model.tiers).flat().filter((item) => item.kind === 'failure_passed_over');
  assert.deepEqual(items.map((item) => textOf(item.what.parts)).sort(), [
    'A Bash call has no result that Sonah found. The agent did not act on it or tell you.',
    'A bash call has an outcome that Sonah could not read as a failure. The agent did not act on it or tell you.',
    'A bash call has no recorded end. The agent did not act on it or tell you.']);
});

test('D100: every result part, the stopped part and the no-result part have words', () => {
  assert.deepEqual(Object.keys(words.REPORT_RESULT_PARTS).sort(), [...RESULT_OUTCOME_CLASSES, 'stopped', 'no-result']
    .sort());
  assert.equal(words.REPORT_RESULT_PARTS['no-result'](3), 'for 3 Sonah found no result');
  assert.equal(words.REPORT_WHAT_WORDS.failure.other, 'has an outcome that Sonah could not read as a failure.');
});

// ---- a completion the recorder typed by a notice: its text can hold an exit code -------------------------------------

const SESSION = 'c0ffee00-0000-4000-8000-0000000000d1';
let uuidN = 0;
const row = (extra) => ({ sessionId: SESSION, cwd: '/repo', isSidechain: false, version: '2.1.296',
  uuid: `d100-${uuidN++}`, ...extra });
const use = (id, name, input) => row({ type: 'assistant', message: { role: 'assistant',
  content: [{ type: 'tool_use', id, name, input }] } });
const answer = (id, content, sidecar) => row({ type: 'user', message: { role: 'user',
  content: [{ type: 'tool_result', tool_use_id: id, content, is_error: false }] }, toolUseResult: sidecar });
const SUCCESS = Object.freeze({ stdout: '', stderr: '', interrupted: false, isImage: false, noOutputExpected: false });
const launch = (id, taskId, command) => [use(id, 'Bash', { command, run_in_background: true }),
  answer(id, `Command running in background with ID: ${taskId}.`, { ...SUCCESS, backgroundTaskId: taskId })];
/** Claude Code's task notice, as it records one: a typed status, and a summary in its own words that can name the exit
 *  code. */
const notice = (taskId, callId, summary) => row({ type: 'user', origin: { kind: 'task-notification', runId: 'r' },
  message: { role: 'user', content: `<task-notification>\n<task-id>${taskId}</task-id>\n<tool-use-id>${callId}`
    + `</tool-use-id>\n<status>completed</status>\n<summary>${summary}</summary>\n</task-notification>` } });

test('D100: a run that its notice typed completed reads as what Sonah read, never as one with no exit code', async (t) => {
  const rows = [row({ type: 'user', origin: { kind: 'human' }, message: { role: 'user', content: 'Change it, then build.' } }),
    use('w1', 'Write', { file_path: '/repo/src/a.js', content: 'a\n' }),
    answer('w1', 'File created successfully at: /repo/src/a.js', { type: 'create', filePath: '/repo/src/a.js',
      content: 'a\n', originalFile: null, structuredPatch: [], userModified: false }),
    ...launch('b1', 'bgd1', 'npm run build'), notice('bgd1', 'b1', 'Background command "build" completed (exit code 0)'),
    ...launch('b2', 'bgd2', 'grep -r TODO src'),
    notice('bgd2', 'b2', 'Background command "search" completed (exit code 1: No matches found)')];
  const dir = await mkdtemp(join(tmpdir(), 'sonah-d100-notice-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const file = join(dir, `${SESSION}.jsonl`);
  await writeFile(file, rows.map((r) => JSON.stringify(r)).join('\n') + '\n');
  const raw = await sliceLineage([file], { cwd: '/repo' });
  const s = sessionFromLedger(redact(raw).ledger, { sessionKey: 'd100-notice' });
  // Both runs are closed by their own notice, typed completed, with no exit code that Sonah read: the class whose words
  // these are.
  assert.deepEqual(raw.ledger.filter((e) => e.background).map((e) => e.statusSource),
    [COMMAND_STATUS_SOURCES.claudeTaskNotification, COMMAND_STATUS_SOURCES.claudeTaskNotification]);
  const results = s.events.filter((e) => e.kind === 'observation' && s.event(e.invocation)?.recorded?.backgroundTaskId);
  assert.deepEqual(results.map((e) => [resultOutcome(s, e).class, e.exitCode]), [['ran-completed', null],
    ['ran-completed', null]]);
  const model = reportModel(s, { windowResults: window(s) }, {});
  assert.deepEqual(model.did.runs.shown.map((run) => run.outcome), ['completed, Sonah read no exit code',
    'completed, Sonah read no exit code']);
  assert.deepEqual(model.header.runs, ['After its last edit, the agent ran 2 commands.']);
  assert.ok(model.notChecked.quiet.includes('Results: 2 completed with no exit code that Sonah read.'),
    model.notChecked.quiet);
});

// ---- a recorder that types no refusal: its result text can still say which ----------------------------------------

test('D100: a call that failed or was refused names the recorder, which marks neither, never the recording', () => {
  // The proof (slicer CLAUDE_UNTYPED_DENIAL_RECORDER) is the recorder version, which types no refusal; the result text
  // that it records ("The user doesn't want to proceed …") can still say which.
  const which = 'The recorder does not mark which.';
  assert.equal(words.REPORT_HEADER_WORDS.unclearAfterEdit(2), 'After the agent\'s last edit, 2 commands failed or '
    + `the harness refused them. ${which}`);
  assert.equal(words.REPORT_WHAT_WORDS.failure['failed-or-refused'], `failed, or was refused before it ran. ${which}`);
  assert.equal(words.REPORT_OUTCOME_WORDS['failed-or-refused'].untyped(), `failed, or refused before it ran. ${which}`);
  assert.equal(CHECKLIST_OUTCOME_WORDS['failed-or-refused'](), 'The command failed, or the harness refused it before '
    + `it ran. ${which}`);
  assert.equal(COVERAGE_SENTENCE.instructions_refusal_untyped({ n: 2 }), '2 failed calls come from a recorder version '
    + 'that does not mark which calls you refused, so any of them can hold an answer that Sonah did not read');
});
