// D99 (F1 guard), the page: a background run whose end Sonah could not read is never said to have no end, never
// counted with the runs that have none, and is named under what Sonah could not check; one its notification typed
// stopped or killed reads "stopped before it finished". Synthetic sessions only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { reportModel } from '../report-model.js';
import * as words from '../report-words.js';
import { sessionBuilder } from './session-story-fixture.js';

function model(failures = [], { unchecked = false } = {}) {
  const b = sessionBuilder();
  b.ask('I1', 'Change it, then run the jobs.');
  b.change('W1', 'src/a.js', { after: 'a\n' });
  const push = (id, recorded, extra = {}) => {
    b.events.push({ sequence: b.events.length, id, kind: 'invocation', callKey: id, tool: 'bash', operation: 'command',
      paths: [], command: [], input: [], changes: [], recorded, ...extra });
    b.events.push({ sequence: b.events.length, id: `${id}-r`, kind: 'observation', invocation: id, callKey: id,
      phase: 'terminal', sourceOfResult: 'unknown', output: [], result: 'unknown', exitCode: null,
      terminalStatusProven: false });
  };
  push('E1', { backgroundTaskId: 'job1' });
  push('E2', { backgroundTaskId: 'job2' }, { backgroundEnd: 'unread' });
  push('E3', { backgroundTaskId: 'job3' }, { backgroundEnd: 'stopped' });
  if (unchecked) push('E4', { backgroundTaskId: 'job4' }, { backgroundEnd: 'unchecked' });
  const session = b.session();
  return reportModel(session, { windowResults: [{ windowIndex: 0, eventIds: session.events.map((e) => e.id),
    failure: null }], failures }, {});
}
const textOf = (parts) => parts.map((p) => p.text).join('');

test('D99 F1 guard: the header counts an unread end apart, and never as a run with no recorded end', () => {
  const { header, notChecked } = model();
  // D133 (R2): the part that says what Sonah could not read is in What Sonah could not check, with its count.
  assert.deepEqual(header.runs, ['After its last edit, the agent ran 3 commands.',
    'Results: 1 has no recorded end, 1 stopped before it finished.']);
  assert.ok(notChecked.quiet.includes('Results: for 1 Sonah could not read whether or how it ended.'), notChecked.quiet);
});

test('D99 F1 guard: the Runs list says what Sonah read of each run\'s end', () => {
  const { did } = model();
  assert.deepEqual(did.runs.shown.map((run) => run.outcome), [
    'started in the background, no end recorded',
    'later records mention this run, but Sonah could not read whether or how it ended',
    'stopped before it finished']);
  assert.equal(words.REPORT_OUTCOME_WORDS['end-unread'].background().includes('no end'), false);
  // Words that presume no end: the run may still be running.
  assert.equal(words.REPORT_RESULT_PARTS['end-unread'](2), 'for 2 Sonah could not read whether or how they ended');
  assert.doesNotMatch(words.REPORT_RESULT_PARTS['end-unread'](1), /\b(has|have) an end\b|no end/);
});

test('D99 F1 guard: a failure stopped before it finished says so, never that it has no recorded end', () => {
  const failure = (id, outcome, form) => ({ eventId: `${id}-r`, action: id, outcome, form, tool: 'Bash',
    handling: 'passed-over' });
  const items = [...Object.values(model([failure('E1', 'no-terminal-status', 'background'),
    failure('E3', 'no-terminal-status', 'interrupted')]).tiers).flat()].filter((item) => item.kind === 'failure_passed_over');
  assert.deepEqual(items.map((item) => textOf(item.what.parts)), [
    'A bash call has no recorded end. The agent did not act on it or tell you.',
    'A bash call stopped before it finished. The agent did not act on it or tell you.']);
});

test('D99 (review of A1b): a run no later record is shown to mention says Sonah could not check for its end', () => {
  // The slicer marks a run `unchecked` where no later mention is established (its id only in rows before its launch, an
  // id no search is sound for, a file it could not read again): the Runs list claims no later mention for it, and the
  // header counts it with the other runs whose end Sonah could not read, in words true of both.
  const { header, did, notChecked } = model([], { unchecked: true });
  assert.deepEqual(did.runs.shown.map((run) => run.outcome).slice(1), [
    'later records mention this run, but Sonah could not read whether or how it ended',
    'stopped before it finished',
    'Sonah could not check whether the recording holds an end of this run']);
  assert.deepEqual(header.runs, ['After its last edit, the agent ran 4 commands.',
    'Results: 1 has no recorded end, 1 stopped before it finished.']);
  assert.ok(notChecked.quiet.includes('Results: for 2 Sonah could not read whether or how they ended.'));
});
