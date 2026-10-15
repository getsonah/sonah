// C-02 M33 (4) refreeze: only a typed Codex `turn_aborted` row becomes a canonical
// `boundary: "interrupt"` event, at the row's position, with `relatedSession: null`. It never
// splits review windows. A Claude text-derived interrupt stays a ledger mark. Synthetic only.
import test from 'node:test';
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import * as adapterModule from '../adapters/sonah-ledger.js';
import { planWindows } from '../src/windows.js';
import * as windowsModule from '../src/windows.js';
import { planWindowRequests } from '../src/run-review.js';
import { Session } from '../src/session.js';
import * as slicerEvents from '../../slicer/src/events.js';
import { sliceLineage } from '../../slicer/index.js';
import { redact } from '../../redact/index.js';
import { scratchDir } from '../../slicer/test/scratch-dir.js';

const { sessionFromLedger } = adapterModule;
const TYPED = 'codex_turn_aborted';
const typedMark = (fields) => ({ kind: 'interrupt', source: TYPED, stream: 0, ...fields });

// Turn 1: commentary, two commands, and commentary on both sides of an abort row between them.
const ledger = (marks = []) => ({
  ask: [{ turn: 1, text: 'Run the synthetic checks.' }, { turn: 2, text: 'Continue with the next step.' }],
  ledger: [
    { turn: 1, seq: 0, kind: 'test', cmd: 'synthetic-first', outcome: 'passed', exitCode: 0,
      exitCodeSource: 'native', tailLines: ['ok'] },
    { turn: 1, seq: 1, kind: 'bash', cmd: 'synthetic-second', outcome: 'failed', exitCode: 1,
      exitCodeSource: 'native', tailLines: ['no'] },
    { turn: 2, seq: 0, kind: 'bash', cmd: 'synthetic-third', outcome: 'passed', exitCode: 0,
      exitCodeSource: 'native', tailLines: ['ok'] },
  ],
  commentary: [
    { turn: 1, source: 0, record: 3, block: 0, beforeEvent: 0, text: 'Starting the first synthetic check.' },
    { turn: 1, source: 0, record: 6, block: 0, beforeEvent: 1, text: 'Recorded before the abort row.' },
    { turn: 1, source: 0, record: 8, block: 0, beforeEvent: 1, text: 'Recorded after the abort row.' },
    { turn: 2, source: 0, record: 12, block: 0, beforeEvent: 2, text: 'Working on the next step.' },
  ],
  sayings: [],
  marks,
});
const ids = (session) => session.events.map((event) => event.id);
const boundaries = (session) => session.events.filter((event) => event.kind === 'boundary');
const identityAndSequence = (session) => {
  assert.equal(new Set(ids(session)).size, session.events.length, 'event ids are unique');
  assert.deepEqual(session.events.map((event) => event.sequence), session.events.map((_, index) => index));
};

test('the typed interrupt source is one frozen closed value shared by the slicer and the adapter', () => {
  assert.ok(Object.isFrozen(slicerEvents.MARK_SOURCES));
  assert.deepEqual(Object.values(slicerEvents.MARK_SOURCES ?? {}), [TYPED]);
  assert.ok(Object.isFrozen(adapterModule.LEDGER_TYPED_INTERRUPT_SOURCES));
  assert.deepEqual(adapterModule.LEDGER_TYPED_INTERRUPT_SOURCES, [TYPED]);
  // An interrupt is not a window boundary (M35: no recorded boundary is; WINDOW_BOUNDARIES went with the splitter).
  assert.equal(Object.hasOwn(windowsModule, 'WINDOW_BOUNDARIES'), false);
});

test('a typed mark becomes one interrupt boundary at the row position, between commentary that brackets it', () => {
  const plain = sessionFromLedger(ledger());
  const adapted = sessionFromLedger(ledger([typedMark({ turn: 1, record: 7, beforeEvent: 1 })]));
  const [boundary] = boundaries(adapted);
  assert.equal(boundaries(adapted).length, 1);
  // M33 H1: like every event of its turn, the boundary records the slicer's turn (C-02 `turn`).
  assert.deepEqual({ ...boundary }, { id: 'B1-i0', kind: 'boundary', sequence: boundary.sequence,
    boundary: 'interrupt', relatedSession: null, turn: 'T1' });
  const at = adapted.events.indexOf(boundary);
  assert.equal(adapted.textOf(adapted.events[at - 1]), 'Recorded before the abort row.');
  assert.equal(adapted.textOf(adapted.events[at + 1]), 'Recorded after the abort row.');
  assert.equal(adapted.events[at + 2].id, 'A1-1');
  // Every other event keeps its identity, text and relative order; sequences stay contiguous.
  const work = adapted.events.filter((event) => event.kind !== 'boundary');
  assert.deepEqual(work.map((event) => event.id), ids(plain));
  assert.deepEqual(work.map((event) => adapted.sourcesFor(event)), plain.events.map((event) => plain.sourcesFor(event)));
  identityAndSequence(adapted);
  // Emitting the boundary declares no loss.
  assert.deepEqual(adapted.adapterGaps, plain.adapterGaps);
});

test('a typed mark after the last action of its turn lands after that action and before the next turn', () => {
  const adapted = sessionFromLedger(ledger([typedMark({ turn: 1, record: 10, beforeEvent: 2 })]));
  const at = adapted.events.findIndex((event) => event.kind === 'boundary');
  assert.equal(adapted.events[at - 1].id, 'A1-1-r');
  assert.equal(adapted.events[at + 1].id, 'I2');
  // A mark-only turn is retained too.
  const only = sessionFromLedger({ ask: [], ledger: [], commentary: [], sayings: [],
    marks: [typedMark({ turn: 0, record: 2, beforeEvent: 0 })] });
  assert.deepEqual(only.events.map((event) => [event.id, event.boundary]), [['B0-i0', 'interrupt']]);
  identityAndSequence(only);
});

test('after the last action, a typed mark is ordered by its row against the turn\'s hand-offs', () => {
  const withHandOff = (marks) => ({ ...ledger(marks),
    delegations: [{ adapter: 'codex', callId: null, turn: 1, childId: null, status: 'unresolved',
      reason: 'delegation_result_malformed', source: 0, record: 9,
      parentInstruction: { tool: 'spawn_agent', text: 'Review the synthetic parser.' } }] });
  const order = (session) => session.events.filter((event) => ['B1-i0', 'D1-0', 'I2'].includes(event.id))
    .map((event) => event.id);
  assert.deepEqual(order(sessionFromLedger(withHandOff([typedMark({ turn: 1, record: 8, beforeEvent: 2 })]))),
    ['B1-i0', 'D1-0', 'I2']);
  assert.deepEqual(order(sessionFromLedger(withHandOff([typedMark({ turn: 1, record: 10, beforeEvent: 2 })]))),
    ['D1-0', 'B1-i0', 'I2']);
  // A later stream is later whatever its record number.
  assert.deepEqual(order(sessionFromLedger(withHandOff([typedMark({ turn: 1, stream: 1, record: 2, beforeEvent: 2 })]))),
    ['D1-0', 'B1-i0', 'I2']);
});

test('near misses: text-derived, untyped or foreign-source interrupt marks emit no boundary and no gap', () => {
  const plain = sessionFromLedger(ledger());
  for (const marks of [
    [{ turn: 1, kind: 'interrupt' }],
    [{ turn: 1, kind: 'interrupt', stream: 0, record: 7, beforeEvent: 1 }],
    [{ turn: 1, kind: 'interrupt', source: 'claude_text', stream: 0, record: 7, beforeEvent: 1 }],
    [{ turn: 1, kind: 'interrupt', source: 0, stream: 0, record: 7, beforeEvent: 1 }],
    [{ turn: 1, kind: 'notification', source: TYPED, stream: 0, record: 7, beforeEvent: 1 }],
    [{ turn: 1, kind: 'subagent' }],
  ]) {
    const adapted = sessionFromLedger(ledger(marks));
    assert.equal(boundaries(adapted).length, 0, JSON.stringify(marks));
    assert.deepEqual(ids(adapted), ids(plain), JSON.stringify(marks));
    assert.deepEqual(adapted.adapterGaps, plain.adapterGaps, JSON.stringify(marks));
  }
});

test('near misses: a typed mark without a valid turn or position keeps its loss as a declared gap', () => {
  const bad = [
    typedMark({ turn: -1, record: 7, beforeEvent: 1 }),
    typedMark({ turn: '1', record: 7, beforeEvent: 1 }),
    typedMark({ record: 7, beforeEvent: 1 }),
    typedMark({ turn: 1, record: 0, beforeEvent: 1 }),
    typedMark({ turn: 1, record: 7 }),
    typedMark({ turn: 1, record: 7, beforeEvent: -1 }),
    typedMark({ turn: 1, record: 7, beforeEvent: 1.5 }),
    typedMark({ turn: 1, stream: null, record: 7, beforeEvent: 1 }),
  ];
  const good = typedMark({ turn: 1, record: 7, beforeEvent: 1 });
  const adapted = sessionFromLedger(ledger([...bad, good]));
  // The one located mark keeps its ordinal among typed marks: stable whatever precedes it.
  assert.deepEqual(boundaries(adapted).map((event) => event.id), [`B1-i${bad.length}`]);
  const gaps = adapted.adapterGaps.filter((gap) => gap.code === 'unsupported_message'
    && gap.channel === 'observations' && gap.scope === 'session' && gap.count === bad.length);
  assert.equal(gaps.length, 1);
  identityAndSequence(adapted);
});

test('M35 neither an interrupt nor a compaction splits a review window: each rides in its segment', () => {
  const plain = planWindows(sessionFromLedger(ledger()));
  const interrupted = sessionFromLedger(ledger([typedMark({ turn: 1, record: 7, beforeEvent: 1 })]));
  const windows = planWindows(interrupted);
  assert.equal(windows.length, plain.length);
  assert.equal(windows.length, 1);
  assert.ok(windows[0].events.some((event) => event.boundary === 'interrupt'));

  const both = sessionFromLedger(ledger([{ turn: 1, kind: 'compaction' },
    typedMark({ turn: 1, record: 7, beforeEvent: 1 })]));
  const split = planWindows(both);
  assert.equal(split.length, 1);
  assert.ok(split[0].events.some((event) => event.id === 'B1-i0') && split[0].events.some((event) => event.id === 'B1-0'));
  identityAndSequence(both);
});

test('event identity is stable on append: a later mark at the same turn does not rename the interrupt', () => {
  const before = sessionFromLedger(ledger([typedMark({ turn: 1, record: 7, beforeEvent: 1 })]));
  // The slicer sorts marks by turn then kind, so an appended compaction at turn 1 sorts first.
  const after = sessionFromLedger(ledger([{ turn: 1, kind: 'compaction' },
    typedMark({ turn: 1, record: 7, beforeEvent: 1 }),
    typedMark({ turn: 2, record: 13, beforeEvent: 3 })]));
  const prefix = ids(before).slice(0, ids(before).indexOf('I2'));
  assert.deepEqual(ids(after).slice(0, prefix.length), prefix);
  assert.ok(ids(after).includes('B1-i0'));
  assert.ok(ids(after).includes('B2-i1'));
  identityAndSequence(after);
});

// ---------------------------------------------------------------------------------------------
// End to end through the slicer, the redactor and the adapter.
// ---------------------------------------------------------------------------------------------
const rec = (payload) => JSON.stringify({ type: 'response_item', payload });
const complete = (value) => [{ type: 'input_text', text: 'Script completed\nWall time: 0.1 seconds' },
  { type: 'input_text', text: JSON.stringify(value) }];
const wrapper = (cmd, id) => rec({ type: 'custom_tool_call', name: 'exec', call_id: id,
  input: `text(await tools.exec_command({cmd: "${cmd}"}));` });
const wrapperResult = (id) => rec({ type: 'custom_tool_call_output', call_id: id,
  output: complete({ wall_time_seconds: 1, exit_code: 0, output: 'ok\n' }) });
const aborted = JSON.stringify({ type: 'event_msg', payload: { type: 'turn_aborted', turn_id: 'turn-1', reason: 'interrupted' } });
async function codexFixture(rows) {
  const dir = await scratchDir('m33-interrupt-');
  const file = join(dir, 'rollout-2026-09-10T12-00-00-synthetic.jsonl');
  await writeFile(file, [JSON.stringify({ type: 'session_meta', payload: { id: 'synthetic', cwd: '/repo' } }),
    rec({ type: 'message', role: 'user', content: 'Run the checks.' }), ...rows].join('\n'), { mode: 0o600 });
  return file;
}
const adapt = async (file) => sessionFromLedger(redact(await sliceLineage([file])).ledger, { sessionKey: 'synthetic' });

test('end to end: a typed Codex turn_aborted row is carried as one interrupt boundary at its row', async () => {
  const session = await adapt(await codexFixture([
    wrapper('npm test', 'a'), wrapperResult('a'),
    rec({ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'Tests ran.' }] }),
    aborted,
    rec({ type: 'message', role: 'user', content: 'Now lint.' }),
    wrapper('npm run lint', 'b'), wrapperResult('b'),
  ]));
  assert.deepEqual(session.events.map((event) => [event.kind, event.boundary ?? null]), [
    ['instruction', null], ['invocation', null], ['observation', null], ['commentary', null],
    ['boundary', 'interrupt'], ['instruction', null], ['invocation', null], ['observation', null],
  ]);
  const [boundary] = boundaries(session);
  assert.equal(boundary.relatedSession, null);
  identityAndSequence(session);
  assert.equal(planWindows(session).length, 1);
  assert.ok(!session.adapterGaps.some((gap) => gap.code === 'unsupported_message'));
});

test('end to end near miss; M34 labels: a Claude interruption notice is harness — no mark, no boundary', async () => {
  const dir = await scratchDir('m33-claude-interrupt-');
  const file = join(dir, 'claude-synthetic.jsonl');
  const row = (value) => JSON.stringify({ sessionId: 'claude-synthetic', cwd: '/repo', ...value });
  await writeFile(file, [
    row({ type: 'user', uuid: 'u1', message: { role: 'user', content: 'Run the checks.' } }),
    row({ type: 'assistant', uuid: 'a1', message: { role: 'assistant', content: [
      { type: 'tool_use', id: 't1', name: 'Bash', input: { command: 'npm test' } }] } }),
    row({ type: 'user', uuid: 'u2', message: { role: 'user', content: [
      { type: 'tool_result', tool_use_id: 't1', content: 'ok' }] } }),
    row({ type: 'user', uuid: 'u3', message: { role: 'user', content: [
      { type: 'text', text: '[Request interrupted by user for tool use]' }] } }),
  ].join('\n'), { mode: 0o600 });
  const raw = await sliceLineage([file]);
  // M34 labels (C-02 "Slice-time labels"): Claude Code types no interruption, so its notice is harness (on this recorder
  // of no plain version, set aside by the declared legacy fallback and counted); no mark reads its words. M34 labels
  // review (F2): its row keeps only the positional mark of its counted label gap, which is never a boundary; (F6) the
  // prompt the fallback read as the human's is counted and marked too.
  const gapMark = (turn, beforeEvent, record) => ({ turn, kind: 'label_gap', gap: 'legacy_recorder', beforeEvent,
    stream: 0, record });
  assert.deepEqual(raw.marks, [gapMark(0, 0, 1), gapMark(1, 1, 4)]);
  assert.deepEqual(raw.capture.labelGaps, { legacy_recorder: 2 });
  const session = sessionFromLedger(redact(raw).ledger, { sessionKey: 'synthetic' });
  assert.equal(boundaries(session).length, 0);
});

test('end to end: a typed turn_aborted row recorded before a command\'s result row lands between the call and its result', async () => {
  const call = (cmd, id) => rec({ type: 'function_call', name: 'exec_command', arguments: JSON.stringify({ cmd }), call_id: id });
  const output = (id, text) => rec({ type: 'function_call_output', call_id: id, output: text });
  const done = 'Wall time: 1.0 seconds\nProcess exited with code 0\nOutput:\nok\n';
  const kinds = (session) => session.events.map((event) => `${event.kind}${event.boundary ? `:${event.boundary}` : ''}`);
  // The abort row comes after the call row and before the result row.
  const late = await adapt(await codexFixture([call('npm test', 'a'), aborted,
    output('a', 'Wall time: 1.0 seconds\nProcess exited with code 130\nOutput:\naborted\n')]));
  assert.deepEqual(kinds(late), ['instruction', 'invocation', 'boundary:interrupt', 'observation']);
  identityAndSequence(late);
  // Near miss: the result row is recorded before the abort row, so the boundary follows the result.
  const early = await adapt(await codexFixture([call('npm test', 'a'), output('a', done), aborted]));
  assert.deepEqual(kinds(early), ['instruction', 'invocation', 'observation', 'boundary:interrupt']);
  // Placing the boundary moves no other event and renames nothing.
  const work = (session) => session.events.filter((event) => event.kind !== 'boundary').map((event) => event.id);
  assert.deepEqual(work(late), work(early));
  // The call and its result are in one window, the boundary between them (M35: no window splits a segment's pair).
  assert.equal(planWindows(late).length, 1);
});

// ---------------------------------------------------------------------------------------------
// G1: the boundary is placed from the recorded row positions, and never reorders another event.
// ---------------------------------------------------------------------------------------------
const located = (record, resultRecord, extra = {}) => ({ sourceLocator: { stream: 0, record, part: 0,
  ...(resultRecord == null ? {} : { resultRecord }) }, ...extra });
const commandsLedger = (acts, marks, commentary = []) => ({
  ask: [{ turn: 1, text: 'Run the synthetic checks.' }],
  ledger: acts.map((extra, seq) => ({ turn: 1, seq, kind: 'bash', cmd: `synthetic-${seq}`, outcome: 'failed',
    exitCode: 130, exitCodeSource: 'native', tailLines: ['aborted'], ...extra })),
  commentary, sayings: [], marks });
const order = (session) => session.events.map((event) => event.id);

test('G1 an interrupt row recorded before its command\'s result row is placed before that result only', () => {
  // Call at record 3, abort at record 4, result at record 5: the boundary sits between them.
  assert.deepEqual(order(sessionFromLedger(commandsLedger([located(3, 5)],
    [typedMark({ turn: 1, record: 4, beforeEvent: 1 })]))), ['I1', 'A1-0', 'B1-i0', 'A1-0-r']);
  // Two calls, the second one's result after the abort: the boundary moves past that result only;
  // the first result keeps its place after its own call (no other event is reordered).
  const both = sessionFromLedger(commandsLedger([located(3, 6), located(4, 7)],
    [typedMark({ turn: 1, record: 5, beforeEvent: 2 })]));
  assert.deepEqual(order(both), ['I1', 'A1-0', 'A1-0-r', 'A1-1', 'B1-i0', 'A1-1-r']);
  identityAndSequence(both);
  // Near misses: the boundary stays after the result.
  for (const [name, act] of [
    ['result before the abort row', located(3, 4)],
    ['no result record', located(3, null)],
    ['another stream', { sourceLocator: { stream: 1, record: 3, part: 0, resultRecord: 9 } }],
    ['call recorded after the abort row', located(6, 9)],
    ['no locator', {}],
  ]) {
    assert.deepEqual(order(sessionFromLedger(commandsLedger([act], [typedMark({ turn: 1, record: 5, beforeEvent: 1 })]))),
      ['I1', 'A1-0', 'A1-0-r', 'B1-i0'], name);
  }
  // Commentary recorded between the call and the abort keeps its place before the boundary, and
  // the boundary does not jump it to reach the result.
  assert.deepEqual(order(sessionFromLedger(commandsLedger([located(3, 6)], [typedMark({ turn: 1, record: 5, beforeEvent: 1 })],
    [{ turn: 1, source: 0, record: 4, block: 0, beforeEvent: 1, text: 'Recorded before the abort row.' }]))),
  ['I1', 'A1-0', 'A1-0-r', 'C1-1-3', 'B1-i0']);
});

test('G1 a child\'s typed interrupt renames no event: every other id is the same with and without it', () => {
  const act = (cmd) => ({ turn: 0, seq: 0, kind: 'bash', cmd, outcome: 'passed', exitCode: 0,
    exitCodeSource: 'native', tailLines: ['ok'] });
  const grandchild = (marks) => ({ ask: [], sayings: [], marks, ledger: [act('grandchild-cmd')],
    commentary: [{ turn: 0, source: 0, record: 2, block: 0, beforeEvent: 1, text: 'Grandchild after its command.' }] });
  const child = (marks, grandMarks) => ({ ask: [], sayings: [], marks, ledger: [act('child-cmd')],
    commentary: [{ turn: 0, source: 0, record: 2, block: 0, beforeEvent: 0, text: 'Child starts.' },
      { turn: 1, source: 0, record: 9, block: 0, beforeEvent: 1, text: 'Child after the hand-off.' }],
    delegations: [{ adapter: 'codex', callId: 'g1', turn: 0, childId: 'grandchild-1', status: 'linked', kind: 'spawn',
      source: 0, record: 5, link: { source: 1 }, parentInstruction: { tool: 'spawn_agent', text: 'Check the detail.' } }],
    children: [{ source: 1, ledger: grandchild(grandMarks) }] });
  const parent = (marks, grandMarks) => ({
    ask: [{ turn: 1, text: 'Delegate the check.' }, { turn: 2, text: 'Now summarise.' }],
    ledger: [], sayings: [], marks: [],
    commentary: [{ turn: 2, source: 0, record: 9, block: 0, beforeEvent: 0, text: 'Summary after the child.' },
      { turn: 2, source: 0, record: 10, block: 1, beforeEvent: 0, text: 'A second summary block.' }],
    delegations: [{ adapter: 'codex', callId: 'c1', turn: 1, childId: 'child-1', status: 'linked', kind: 'spawn',
      source: 0, record: 4, link: { source: 1 }, parentInstruction: { tool: 'spawn_agent', text: 'Check it.' } }],
    children: [{ source: 1, ledger: child(marks, grandMarks) }],
  });
  const without = sessionFromLedger(parent([], []));
  const untyped = sessionFromLedger(parent([{ turn: 0, kind: 'interrupt' }], [{ turn: 0, kind: 'interrupt' }]));
  const typed = sessionFromLedger(parent([typedMark({ turn: 0, record: 3, beforeEvent: 1 })],
    [typedMark({ turn: 0, record: 3, beforeEvent: 1 })]));
  const others = (session) => session.events.filter((event) => event.boundary !== 'interrupt').map((event) => event.id);
  assert.equal(typed.events.filter((event) => event.boundary === 'interrupt').length, 2, 'both typed rows are carried');
  assert.deepEqual(others(typed), others(without));
  assert.deepEqual(others(untyped), others(without));
  identityAndSequence(typed);
});

// ---------------------------------------------------------------------------------------------
// G1, M35: an interrupt boundary never opens or constitutes a review window of its own. The old splitter's riders are
// gone with it: a boundary is an event of the segment it was recorded in, and a window of boundaries only is never formed.
// ---------------------------------------------------------------------------------------------
test('G1, M35 an interrupt is an event of its segment; no window is boundaries only', () => {
  const blobs = {};
  let n = 0;
  const text = (value) => { const key = `t${n++}`; blobs[key] = value;
    return [{ sourceKey: key, fromByte: 0, untilByte: Buffer.byteLength(value, 'utf8') }]; };
  const build = (spec) => {
    const events = spec.map((kind, sequence) => {
      const id = `${kind}${sequence}`;
      if (kind === 'X') return { id, kind: 'boundary', sequence, boundary: 'interrupt', relatedSession: null };
      if (kind === 'K') return { id, kind: 'boundary', sequence, boundary: 'compaction', relatedSession: null };
      return { id, kind: 'instruction', sequence, authority: 'human', supersedes: [], text: text(`Synthetic instruction ${sequence}.`) };
    });
    return new Session({ sessionKey: 'synthetic', adapter: 'codex', events, blobs });
  };
  for (const [spec, expected] of [
    [['X', 'I', 'I'], [['X0', 'I1', 'I2']]],
    [['I', 'X', 'K', 'I'], [['I0', 'X1', 'K2', 'I3']]],
    [['X', 'K', 'I'], [['X0', 'K1', 'I2']]],
    [['I', 'K', 'X'], [['I0', 'K1', 'X2']]],
    [['X'], []],
    [['X', 'K', 'X'], []],
  ]) {
    const windows = planWindows(build(spec));
    assert.deepEqual(windows.map((window) => window.events.map((event) => event.id)), expected, spec.join(''));
  }
});
