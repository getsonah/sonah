// D79 (owner decision 2026-10-11) under C-02: a write the slicer parsed from a command (`shellWriteOf`: a heredoc's
// body) has no result of its own, so its typed outcome (ledger.js `actionOutcome`) is read through its command's and
// takes only one of them: did-not-run when the recorder typed the command as denied (it never ran, nor did the write).
// Any other end — a failure, any success (even the one C-02 licenses: `shellWriteStatusEligible`, one terminal
// receipt, a typed exit 0), two receipts, no result — leaves it "no terminal status recorded (no result recorded)", as
// before D79: never a completed check. A structured write with no result still reads so.
// D80 (owner decision 2026-10-12): that unknown outcome says why when its command failed (the form `command-failed`) or
// was stopped by a stopped denial kind (`command-stopped`): its class stays no-terminal-status, so no check moves.
// Every session here is synthetic and hand-built.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { actionOutcome, RESTS_ON_OUTCOMES, NOT_COMPLETED_OUTCOMES, FILE_CONTENT_OUTCOMES, STOPPED_DENIALS }
  from '../src/ledger.js';
import { checkedRequirement, restsOnCheck } from '../src/checklist.js';
import { Session } from '../src/session.js';

function build() {
  const events = [];
  const blobs = {};
  const push = (event) => { events.push({ sequence: events.length, ...event }); return event.id; };
  const receipt = (id, result, n = '') => push({ id: `${id}-r${n}`, kind: 'observation', invocation: id, callKey: id,
    phase: 'terminal', terminalStatusProven: true, output: [], sourceOfResult: 'native', ...result });
  const command = (id, recorded, ...results) => {
    push({ id, kind: 'invocation', callKey: id, tool: 'Bash', operation: 'command', paths: [], command: [], input: [],
      changes: [], recorded });
    results.forEach((result, n) => receipt(id, result, n || ''));
  };
  const sibling = (id, of, eligible = true) => push({ id, kind: 'invocation', callKey: id, tool: 'heredoc',
    operation: 'edit', paths: [{ path: `notes/${id.toLowerCase()}.md` }], command: [], input: [], changes: [],
    shellWriteOf: of, shellWriteStatusEligible: eligible });
  const ask = 'Write the release notes into the notes folder.';
  blobs.ask = ask;
  push({ id: 'I0', kind: 'instruction', authority: 'human',
    text: [{ sourceKey: 'ask', fromByte: 0, untilByte: Buffer.byteLength(ask, 'utf8') }] });
  const exit0 = { result: 'succeeded', exitCode: 0 };
  command('C1', { tool: 'Bash', isError: true, denial: 'user-rejected' }, { result: 'failed', exitCode: null });
  sibling('S1', 'C1');
  command('C2', { tool: 'Bash', isError: true }, { result: 'failed', exitCode: 1 });
  sibling('S2', 'C2');
  command('C3', { tool: 'Bash' }, exit0);
  sibling('S3', 'C3');
  command('C4', { tool: 'Bash' });
  sibling('S4', 'C4');
  // A compound command (`cd notes && cat > … <<EOF`): the slicer marks its write not eligible; it ran to exit 0.
  command('C5', { tool: 'Bash' }, exit0);
  sibling('S5', 'C5', false);
  // A typed exit 0 on a call the recorder flagged as an error: the command's own outcome is ran-failed.
  command('C6', { tool: 'Bash', isError: true }, exit0);
  sibling('S6', 'C6');
  // Two terminal receipts: no one unambiguous receipt (C-02).
  command('C7', { tool: 'Bash' }, exit0, exit0);
  sibling('S7', 'C7');
  // D80: a command the recorder typed as stopped (each stopped denial kind), recorded as an error result.
  command('C8', { tool: 'Bash', isError: true, denial: 'interrupted' }, { result: 'failed', exitCode: null });
  sibling('S8', 'C8');
  command('C9', { tool: 'Bash', isError: true, denial: 'cancelled' }, { result: 'failed', exitCode: null });
  sibling('S9', 'C9');
  push({ id: 'W1', kind: 'invocation', callKey: 'W1', tool: 'Write', operation: 'write',
    paths: [{ path: 'notes/b.md' }], command: [], input: [], changes: [] });
  return new Session({ sessionKey: 'd79', adapter: 'claude', events, blobs, children: [] });
}

const NONE = ['no-terminal-status', 'none'];
const COMMAND_FAILED = ['no-terminal-status', 'command-failed'];
const COMMAND_STOPPED = ['no-terminal-status', 'command-stopped'];
const WRITES = ['S1', 'S2', 'S3', 'S4', 'S5', 'S6', 'S7', 'S8', 'S9'];

test('D79 a shell write takes its command\'s did-not-run, and no other end of it', () => {
  const session = build();
  const of = (id, options) => {
    const o = actionOutcome(session, session.event(id), options);
    return [o.class, o.form];
  };
  // The command reads its own end; its write reads did-not-run only when the command did not run.
  assert.deepEqual(of('C1'), ['did-not-run', 'denial']);
  assert.deepEqual(of('S1'), ['did-not-run', 'denial']);
  assert.equal(actionOutcome(session, session.event('S1')).words,
    'did not run (the recorder typed the call as user-rejected)');
  // A failed command's write: the command ran-failed, its write's outcome stays unknown (a nonzero exit never proves
  // whether the write happened, C-02); D80: and says so.
  assert.deepEqual(of('C2'), ['ran-failed', 'exit']);
  assert.deepEqual(of('S2'), COMMAND_FAILED);
  assert.equal(actionOutcome(session, session.event('S2')).words,
    'no terminal status recorded (its command failed, so Sonah could not read whether this write happened)');
  // A command C-02 licenses (eligible, one terminal receipt, a typed exit 0): it ran to exit 0, its write's outcome
  // stays unknown, as before D79.
  assert.equal(session.actionOutcomeOf(session.event('S3')), 'succeeded', 'premise');
  assert.deepEqual(of('C3'), ['ran-exit-0', 'exit']);
  assert.deepEqual(of('S3'), NONE);
  // No result for the command; a structured write with no result.
  assert.deepEqual(of('S4'), NONE);
  assert.deepEqual(of('W1'), NONE);
  // A compound command that ran to exit 0: its write is not eligible; its outcome stays unknown.
  assert.deepEqual(of('C5'), ['ran-exit-0', 'exit']);
  assert.equal(session.actionOutcomeOf(session.event('S5')), 'unknown', 'premise');
  assert.deepEqual(of('S5'), NONE);
  // A typed exit 0 on a call flagged as an error: the command's own outcome is a failure; its write's stays unknown.
  assert.equal(session.actionOutcomeOf(session.event('S6')), 'succeeded', 'premise');
  assert.deepEqual(of('C6'), ['ran-failed', 'flag']);
  assert.deepEqual(of('S6'), COMMAND_FAILED);
  // Two receipts of exit 0: its write's outcome stays unknown.
  assert.deepEqual(of('C7'), ['ran-exit-0', 'exit']);
  assert.deepEqual(of('S7'), NONE);
  // D80: a stopped command (either stopped kind) reads stopped before it finished, never did not run; its write says
  // its command stopped, and whether the write happened is not recorded.
  assert.deepEqual([...STOPPED_DENIALS], ['interrupted', 'cancelled']);
  for (const [command, write] of [['C8', 'S8'], ['C9', 'S9']]) {
    assert.deepEqual(of(command), ['no-terminal-status', 'interrupted'], command);
    assert.equal(actionOutcome(session, session.event(command)).words,
      'no terminal status recorded (stopped before it finished)');
    assert.deepEqual(of(write), COMMAND_STOPPED, write);
    assert.equal(actionOutcome(session, session.event(write)).words, 'no terminal status recorded (its command stopped '
      + 'before it finished, so Sonah could not read whether this write happened)');
  }
  // D59: the window bound applies to the command's result, as it does to the command itself.
  const refusedAt = session.event('C1').sequence;
  assert.deepEqual(of('S1', { until: refusedAt }), NONE);
  assert.deepEqual(of('S1', { until: refusedAt + 1 }), ['did-not-run', 'denial']);
  // What the checks read from it: no shell write's check completed, and no shell write's content may contradict a
  // claim.
  for (const id of WRITES) {
    assert.ok(RESTS_ON_OUTCOMES.includes(of(id)[0]) && NOT_COMPLETED_OUTCOMES.includes(of(id)[0]), id);
    assert.ok(!FILE_CONTENT_OUTCOMES.includes(of(id)[0]), id);
  }
});

test('D79 a done ask whose deliverable is a shell write is not checked, whatever its command\'s end', () => {
  const session = build();
  const writes = WRITES;
  const sourceMap = Object.fromEntries(['I0', ...writes].map((id) => [id, [{ role: id === 'I0' ? 'instruction'
    : 'action' }]]));
  const row = (id) => ({ text: 'write the release notes', status: 'done',
    instruction: { eventId: 'I0', role: 'instruction', quote: 'Write the release notes' },
    deliverable: { eventId: id, role: 'action', quote: `notes/${id.toLowerCase()}.md` } });
  const checked = Object.fromEntries(writes.map((id) => {
    const { candidate, reason } = checkedRequirement(session, row(id), { sourceMap });
    return [id, [candidate.status, reason]];
  }));
  const lowered = ['not-checked', 'check_not_completed'];
  assert.deepEqual(checked, Object.fromEntries(writes.map((id) => [id, lowered])));
  // A row may rest on every one of them: no shell write's check completed.
  const rests = restsOnCheck(session, writes, { sourceMap, anchor: session.event('I0') });
  assert.deepEqual([rests.accepted, rests.rejected.completed], [writes, 0]);
});
