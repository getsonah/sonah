// D150: the page says what Sonah could not read by kind. The slicer counts each recording row it left unread
// once, by its recorder structure (`unreadRows`: a copy of a message sent to the agent that no structural twin settles,
// a hook's row, a file changed outside the agent's edits, any other); the adapter carries the count beside the session
// (with the in-turn instructions it could not place, and each transferred child's); the coverage causes name each kind
// in place of the row declarations' counts, which count a row once on each channel it carries. Any other
// `unsupported_message` declaration keeps its count.
//
// Synthetic sessions and gaps only; the judge is a stub that answers every window with nothing.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Session } from '../src/session.js';
import { runReview } from '../src/run-review.js';
import { coverageCauses, COVERAGE_SENTENCE } from '../src/review.js';
import { sessionFromLedger, UNSUPPORTED_ROW_NOTES, UNREAD_ROW_KINDS } from '../adapters/sonah-ledger.js';
import { UNREAD_ROW_KINDS as SLICER_KINDS } from '../../slicer/src/records.js';
import { sliceLineage } from '../../slicer/index.js';
import { redact } from '../../redact/index.js';

const EMPTY = { decisions: [], pivots: [], claims: [], requirements: [] };
const TEXT = { ask: 'SYNTHETIC_D150_ASK: run the synthetic checks.', cmd: 'npm test', out: 'SYNTHETIC_D150_OUT: 3 passed' };
const whole = (key) => [{ sourceKey: key, fromByte: 0, untilByte: Buffer.byteLength(TEXT[key], 'utf8') }];
function declaring(gaps, unreadRows) {
  const session = new Session({ sessionKey: 's', blobs: { ...TEXT }, events: [
    { id: 'I1', kind: 'instruction', sequence: 0, authority: 'human', supersedes: [], text: whole('ask') },
    { id: 'A1', kind: 'invocation', sequence: 1, callKey: 'a1', tool: 'Bash', operation: 'command',
      paths: [], command: whole('cmd'), input: [], changes: [] },
    { id: 'A1-r', kind: 'observation', sequence: 2, invocation: 'A1', callKey: 'a1', phase: 'terminal',
      result: 'succeeded', exitCode: 0, terminalStatusProven: true, output: whole('out'), sourceOfResult: 'native' }] });
  session.adapterGaps = gaps.map((gap, lossOrdinal) => ({ scope: 'session', sessionKey: 's', lossOrdinal, ...gap }));
  if (unreadRows) Object.defineProperty(session, 'unreadRows', { value: Object.freeze(unreadRows) });
  return session;
}
const review = (gaps, unreadRows) => runReview({ session: declaring(gaps, unreadRows), pr: null,
  reviewScope: 'session-only', judge: async () => EMPTY });
const GAPS = [
  { code: 'unsupported_message', channel: 'identity', count: 3, note: UNSUPPORTED_ROW_NOTES.identity },
  { code: 'unsupported_message', channel: 'observations', count: 4, note: UNSUPPORTED_ROW_NOTES.channel },
  { code: 'unsupported_message', channel: 'actions', count: 2, note: UNSUPPORTED_ROW_NOTES.channel },
  { code: 'unsupported_message', channel: 'commentary', count: 1 },
];

test('D150: the rows Sonah left unread are named by kind, each once; any other such declaration keeps its count',
  async () => {
    const report = await review(GAPS, { request_copy: 2, hook_output: 2, edited_file: 1, other: 1 });
    assert.deepEqual(coverageCauses(report), [['unsupported_message', { n: 2 }], ['request_copies_unread', { n: 2 }],
      ['hook_outputs_unread', { n: 2 }], ['edited_files_unread', { n: 1 }]]);
    assert.deepEqual(coverageCauses(report).map(([cause, counts]) => COVERAGE_SENTENCE[cause](counts)), [
      '2 records have a form that Sonah cannot read',
      'Sonah could not match 2 copies of messages sent to the agent with the records of the session',
      'Sonah did not read 2 hook outputs', "Sonah did not read 1 notice of a file changed outside the agent's edits"]);
    // No other row and no other declaration: no "form" line at all.
    const only = await review(GAPS.slice(0, 3), { request_copy: 3, hook_output: 0, edited_file: 0, other: 0 });
    assert.deepEqual(coverageCauses(only), [['request_copies_unread', { n: 3 }]]);
    // With no count by kind (a ledger written before D150, another recorder), every declaration is summed as before.
    const before = await review(GAPS, null);
    assert.deepEqual(coverageCauses(before), [['unsupported_message', { n: 10 }]]);
  });

test('D150: the adapter carries the slicer\'s count by kind beside the session, never among its own fields', async (t) => {
  assert.deepEqual(UNREAD_ROW_KINDS, Object.values(SLICER_KINDS));
  const dir = await mkdtemp(join(tmpdir(), 'evidence-d150-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const file = join(dir, 'd150.jsonl');
  const env = (x) => ({ cwd: '/repo', entrypoint: 'cli', gitBranch: 'main', sessionId: 's-d150', isSidechain: false, parentUuid: null, userType: 'external',
    uuid: `u-${Math.random().toString(16).slice(2)}`, version: '2.1.308', timestamp: '2026-10-24T10:00:00.000Z', ...x });
  const rows = [env({ type: 'user', origin: { kind: 'human' }, promptSource: 'typed', message: { role: 'user', content: 'Go.' } }),
    { type: 'api-request-blob', hash: 'h1', sessionId: 's-d150', message: { role: 'assistant', content: [
      { type: 'text', text: 'Synthetic words.' }, { type: 'tool_use', id: 't-9', name: 'Bash', input: {} }] } },
    env({ type: 'attachment', attachment: { type: 'hook_success', command: 'x', content: '', durationMs: 1, exitCode: 0,
      hookEvent: 'PostToolUse', hookName: 'x', stderr: '', stdout: 'Synthetic output.', toolUseID: 't-1' } }),
    // A row of a new type with a message and a separate body: a loss on its channel and unclassified, one row.
    { type: 'future-turn', sessionId: 's-d150', message: { role: 'user', content: 'Synthetic words.' }, body: { n: 1 } },
    // A prompt the person queued is read at its row: its counted loss is no unread row.
    env({ type: 'attachment', attachment: { type: 'queued_command', commandMode: 'prompt', prompt: 'Also this.',
      origin: { kind: 'human' } } })];
  await writeFile(file, rows.map((r) => JSON.stringify(r)).join('\n') + '\n');
  const ledger = redact(await sliceLineage([file], { cwd: '/repo' })).ledger;
  // The blob carries two channels and is one row.
  assert.deepEqual(ledger.unreadRows, { request_copy: 1, hook_output: 1, other: 1 });
  assert.deepEqual([ledger.capture.unsupportedRowChannels.commentary, ledger.capture.unsupportedRowChannels.actions], [1, 1]);
  const session = sessionFromLedger(ledger);
  assert.deepEqual({ ...session.unreadRows }, { request_copy: 1, hook_output: 1, edited_file: 0, other: 1 });
  assert.ok(!Object.keys(session).includes('unreadRows'));
});

test('D150: a PDF the person attached, beside a hook\'s row, stays among what Sonah could not read', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'evidence-d150-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const file = join(dir, 'd150-pdf.jsonl');
  let n = 0;
  const env = (x) => ({ cwd: '/repo', entrypoint: 'cli', gitBranch: 'main', sessionId: 's-d150-pdf', isSidechain: false,
    parentUuid: n ? `p-${n}` : null, userType: 'external', uuid: `p-${++n}`, version: '2.1.308',
    timestamp: '2026-10-24T10:00:00.000Z', ...x });
  const rows = [env({ type: 'user', origin: { kind: 'human' }, promptSource: 'typed',
    message: { role: 'user', content: 'Implement what the attached spec says.' } }),
  env({ type: 'attachment', attachment: { type: 'pdf_reference', displayPath: 'spec.pdf', fileSize: 1000,
    filename: '/repo/spec.pdf', pageCount: 3 } }),
  env({ type: 'assistant', message: { role: 'assistant', content: [
    { type: 'tool_use', id: 'b-1', name: 'Bash', input: { command: 'npm test' } }] } }),
  env({ type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'b-1', content: 'ok' }] } }),
  env({ type: 'attachment', attachment: { type: 'hook_success', command: 'x', content: '', durationMs: 1, exitCode: 0,
    hookEvent: 'PostToolUse', hookName: 'x', stderr: '', stdout: 'Synthetic output.', toolUseID: 'b-1' } })];
  await writeFile(file, rows.map((r) => JSON.stringify(r)).join('\n') + '\n');
  const ledger = redact(await sliceLineage([file], { cwd: '/repo' })).ledger;
  // The PDF records no words, so nothing of it is read: it is an unread row, as its declared loss says.
  assert.equal(ledger.interjections, undefined);
  assert.deepEqual(ledger.unreadRows, { hook_output: 1, other: 1 });
  const session = sessionFromLedger(ledger);
  assert.deepEqual(session.adapterGaps.filter((gap) => gap.channel === 'instructions').map((gap) => gap.count), [1]);
  const report = await runReview({ session, pr: null, reviewScope: 'session-only', judge: async () => EMPTY });
  const causes = new Map(coverageCauses(report));
  assert.deepEqual(causes.get('unsupported_message'), { n: 1 });
  assert.deepEqual(causes.get('hook_outputs_unread'), { n: 1 });
});

test('D150: the count carries each linked helper once, a grandchild once, and each in-turn instruction the adapter '
  + 'could not place', async () => {
  const unit = (source, ledger) => ({ source, ledger, parentInstructions: [] });
  const assignment = (text) => ({ ask: [], instructions: [{ turn: 1, text }], instructionAuthority: 'unchecked',
    capture: { incomplete: true, reasons: ['child_instruction_authority_unchecked'] } });
  const grandchild = { ...assignment('Grandchild assignment.'), unreadRows: { edited_file: 1, other: 1 },
    ledger: [{ turn: 1, seq: 0, kind: 'edit', path: 'src/grandchild.js', via: 'Write' }] };
  const worker = { ...assignment('Worker assignment.'), unreadRows: { request_copy: 1, hook_output: 2 },
    ledger: [{ turn: 1, seq: 0, kind: 'edit', path: 'src/worker.js', via: 'Write' }],
    delegations: [{ adapter: 'codex', callId: 'g', turn: 1, childId: 'grand-1', status: 'linked',
      reason: 'child_recording_linked', source: 0, link: { source: 0 } }],
    children: [unit(0, grandchild)] };
  const parent = (extra) => ({ ask: [{ turn: 1, text: 'Do the work.' }], ledger: [], children: [unit(0, worker)],
    unreadRows: { hook_output: 1 },
    // Two hand-offs to one helper: its rows are counted once.
    delegations: [
      { adapter: 'codex', kind: 'spawn', callId: 's', turn: 1, childId: 'worker-1', status: 'linked',
        reason: 'child_recording_linked', source: 0, link: { source: 0 },
        parentInstruction: { text: 'Build the worker.', tool: 'collaboration.spawn_agent', field: 'message' } },
      { adapter: 'codex', kind: 'followup', callId: 'f', turn: 1, status: 'linked', reason: 'child_followup_linked',
        source: 0, link: { source: 0 },
        parentInstruction: { text: 'One more thing.', tool: 'collaboration.followup_task', field: 'message' } }],
    ...extra });
  const linked = sessionFromLedger(parent({}), { sessionKey: 'parent' });
  assert.deepEqual({ ...linked.unreadRows }, { request_copy: 1, hook_output: 3, edited_file: 1, other: 1 });
  // An answer naming no recorded call cannot be placed: the adapter declares it, and counts its row once more.
  const unplaced = sessionFromLedger(parent({ interjections: [{ kind: 'answer', turn: 1, beforeEvent: 0, source: 0,
    record: 3, text: 'Yes.', call: { turn: 1, seq: 9 } }] }), { sessionKey: 'parent' });
  assert.deepEqual({ ...unplaced.unreadRows }, { request_copy: 1, hook_output: 3, edited_file: 1, other: 2 });
  assert.deepEqual(unplaced.adapterGaps.filter((gap) => gap.note === UNSUPPORTED_ROW_NOTES.channel)
    .map((gap) => [gap.channel, gap.count]), [['instructions', 1]]);
  const causes = new Map(coverageCauses(await runReview({ session: unplaced, pr: null, reviewScope: 'session-only',
    judge: async () => EMPTY })));
  assert.deepEqual([causes.get('unsupported_message'), causes.get('request_copies_unread'),
    causes.get('hook_outputs_unread'), causes.get('edited_files_unread')], [{ n: 2 }, { n: 1 }, { n: 3 }, { n: 1 }]);
});
