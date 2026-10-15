// M34 slice-time labels at the evidence adapter (C-02 "Slice-time labels"):
//   - instruction events carry the markers the slicer read off the recorder's structure (queued, answer, command,
//     attached, after_interrupt) and their links (`answerTo`, `interruptedBy`), never `queued: true`; a refusal is
//     never one (M34 labels review, F3: its result's text is the recorder's);
//   - authority is derived from the recorded lineage (a helper's human-labelled rows are its parent agent's) and a
//     peer's message carries peer authority;
//   - each counted label gap (`capture.labelGaps`) is declared by its closed reason, with its own closed note;
//   - no canonical event carries `meta`.
// These replace H2's adapter tests (h2-actor-provenance-adapter.test.js, deleted with the opening fallback).
//
// Every fixture is synthetic. No model is called.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sessionFromLedger, LABEL_GAP_NOTES, INTERJECTION_KINDS, INSTRUCTION_MARKERS, INSTRUCTION_GAP_NOTES,
  LEDGER_LABEL_GAP_MARK, LEDGER_POSITIONED_GAPS } from '../adapters/sonah-ledger.js';
import { instructionReviewScope } from '../src/ledger.js';
import { adapt, labelOf, named } from './stable-ids-fixture.js';
import { LABEL_GAPS, MARKERS, POSITIONED_GAPS } from '../../slicer/src/labels.js';
import { INTERJECTION_KINDS as SLICER_INTERJECTION_KINDS, LABEL_GAP_MARK } from '../../slicer/src/events.js';
import { sliceLineage } from '../../slicer/index.js';
import { redact } from '../../redact/index.js';

const led = (over) => ({ ask: [], ledger: [{ turn: 1, seq: 0, kind: 'bash', cmd: 'npm test', outcome: 'passed',
  exitCode: 0, exitCodeSource: 'native' }], claim: { finalMessage: '' }, dropped: [], ...over });
const instructions = (session) => session.events.filter((event) => event.kind === 'instruction');

test('M34: the adapter re-declares the slicer\'s closed label vocabularies, and they agree', () => {
  assert.deepEqual(Object.keys(LABEL_GAP_NOTES), Object.values(LABEL_GAPS));
  assert.ok(Object.isFrozen(LABEL_GAP_NOTES));
  assert.deepEqual([...INTERJECTION_KINDS], Object.values(SLICER_INTERJECTION_KINDS));
  // M34 labels review (F3): a refusal is labelled (marker `refusal`) but never read as an instruction.
  assert.deepEqual([...INSTRUCTION_MARKERS], Object.values(MARKERS).filter((marker) => marker !== MARKERS.compaction
    && marker !== MARKERS.refusal));
  // Notes are distinct, and none reuses an instruction-gap note.
  const notes = Object.values(LABEL_GAP_NOTES).filter(Boolean).map(([, note]) => note);
  assert.equal(new Set(notes).size, notes.length);
  for (const note of notes) assert.ok(!Object.values(INSTRUCTION_GAP_NOTES).includes(note));
  // The H2 and M5 actor notes are deleted with their fallbacks.
  for (const key of ['actor_by_opening', 'slash_without_args', 'actor_by_structure'])
    assert.equal(Object.hasOwn(INSTRUCTION_GAP_NOTES, key), false, key);
  // M34 labels review (F2): the positional label-gap mark and the gaps it is left for.
  assert.equal(LEDGER_LABEL_GAP_MARK, LABEL_GAP_MARK);
  assert.deepEqual([...LEDGER_POSITIONED_GAPS], [...POSITIONED_GAPS]);
  assert.ok(Object.isFrozen(LEDGER_POSITIONED_GAPS) && Object.isFrozen(POSITIONED_GAPS));
});

test('M34 review (F2): an untyped interruption notice is a loss only at the bounds that reach its row', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'm34-interrupt-located-'));
  try {
    let n = 0;
    const row = (value) => JSON.stringify({ sessionId: 's', cwd: '/repo', version: '2.1.284', isSidechain: false,
      parentUuid: 'p', uuid: `u-${++n}`, ...value });
    const ask = (text) => row({ type: 'user', origin: { kind: 'human' }, message: { role: 'user', content: text } });
    const edit = (id) => row({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'tool_use', id,
      name: 'Edit', input: { file_path: '/repo/src/cli.js', old_string: 'a', new_string: 'b' } }] } });
    const done = (id) => row({ type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id,
      content: 'The file /repo/src/cli.js has been updated.' }] } });
    const notice = row({ type: 'user', message: { role: 'user', content: [{ type: 'text',
      text: '[Request interrupted by user for tool use]' }] } });
    const file = join(dir, 'session.jsonl');
    await writeFile(file, [ask('Add a verbose flag.'), edit('e1'), done('e1'), ask('Now add a quiet flag.'), edit('e2'),
      done('e2'), edit('e3'), notice].join('\n') + '\n', { mode: 0o600 });
    // C-01 event identity: registered, so events are shown by their positional labels (stable-ids-fixture.js).
    const session = adapt(redact(await sliceLineage([file])).ledger, { sessionKey: 'm34-interrupt' });
    const gap = session.adapterGaps.find((entry) => entry.note === LABEL_GAP_NOTES.interrupt_untyped[1]);
    assert.deepEqual([gap.count, gap.eventIds.map((id) => labelOf(session, id))], [1, ['A2-1']]);
    const complete = session.events.filter((event) => Number.isSafeInteger(event.sequence))
      .map((event) => [labelOf(session, event.id), instructionReviewScope(session, { upTo: event.sequence }).complete]);
    assert.deepEqual(complete, [['I1', true], ['A1-0', true], ['A1-0-r', true], ['I2', true], ['A2-0', true],
      ['A2-0-r', true], ['A2-1', false]]);
    assert.equal(instructionReviewScope(session).complete, false, 'the whole session still reaches the notice');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('M34 review (F2): a positioned label gap stays unlocated unless every counted label has its own named event', () => {
  const ask = [{ turn: 1, text: 'Fix the parser.' }];
  const ledger = [{ turn: 1, seq: 0, kind: 'bash', cmd: 'npm test', outcome: 'passed', exitCode: 0,
    exitCodeSource: 'native' }, { turn: 1, seq: 1, kind: 'bash', cmd: 'npm run lint', outcome: 'passed', exitCode: 0,
    exitCodeSource: 'native' }];
  const mark = (beforeEvent, record) => ({ turn: 1, kind: 'label_gap', gap: 'interrupt_untyped', beforeEvent, stream: 0,
    record });
  const gapOf = (marks, count) => sessionFromLedger(led({ ask, ledger, marks,
    capture: { reasons: [], incomplete: false, labelGaps: { interrupt_untyped: count } } }), { sessionKey: 'm34-f2' })
    .adapterGaps.find((gap) => gap.note === LABEL_GAP_NOTES.interrupt_untyped[1]);
  assert.deepEqual(gapOf([mark(1, 4)], 1).eventIds, ['A1-1']);
  // A row counted but not marked (an attachment is no record), marks out of shape, two rows sharing one anchor, and a
  // ledger with no marks (an older slicer): a loss at every bound.
  for (const [marks, count, why] of [[[mark(1, 4)], 2, 'count exceeds marks'], [[{ ...mark(1, 4), record: 0 }], 1,
    'out of shape'], [[mark(1, 4), mark(1, 5)], 2, 'shared anchor'], [[], 1, 'no marks']])
    assert.equal(Object.hasOwn(gapOf(marks, count), 'eventIds'), false, why);
});

test('M34: each counted label gap is declared by its own closed note; unlabelled rows are declared by their capture count', () => {
  const capture = { reasons: [], incomplete: false, labelGaps: { legacy_recorder: 2, interrupt_untyped: 1,
    command_args_unrecorded: 1, notification_unmatched: 3, unknown_block: 4 } };
  const session = sessionFromLedger(led({ ask: [{ turn: 1, text: 'Fix the parser.' }], capture }), { sessionKey: 'm34-gaps' });
  const declared = session.adapterGaps.filter((gap) => Object.values(LABEL_GAP_NOTES).some((value) => value?.[1] === gap.note));
  assert.deepEqual(declared.map(({ code, channel, scope, count, note }) => [code, channel, scope, count, note]), [
    ['incomplete_inventory', ...LABEL_GAP_NOTES.legacy_recorder.slice(0, 1), 'session', 2, LABEL_GAP_NOTES.legacy_recorder[1]],
    ['incomplete_inventory', 'instructions', 'session', 1, LABEL_GAP_NOTES.interrupt_untyped[1]],
    ['incomplete_inventory', 'instructions', 'session', 1, LABEL_GAP_NOTES.command_args_unrecorded[1]],
    ['incomplete_inventory', 'observations', 'session', 3, LABEL_GAP_NOTES.notification_unmatched[1]],
  ]);
  assert.equal(instructionReviewScope(session).complete, false, 'an instructions-channel label gap is a loss');
  // A value that is not a count still declares the loss, uncounted (fail closed); a reason this adapter does not know is
  // declared too; absent and 0 declare none.
  const odd = sessionFromLedger(led({ ask: [{ turn: 1, text: 'Fix it.' }], capture: { reasons: [], incomplete: false,
    labelGaps: { legacy_recorder: 'two', invented_reason: 1, interrupt_untyped: 0 } } }), { sessionKey: 'm34-odd' });
  assert.deepEqual(odd.adapterGaps.filter((gap) => gap.channel === 'instructions').map((gap) => [gap.count, gap.note]),
    [[null, LABEL_GAP_NOTES.legacy_recorder[1]], [1, LABEL_GAP_NOTES.origin_unknown[1]]]);
  const clean = sessionFromLedger(led({ ask: [{ turn: 1, text: 'Fix it.' }], capture: { reasons: [], incomplete: false,
    labels: { human: 1, harness: 0, thought: 0, action: 1, observation: 1, peer: 0, unlabelled: 0, private: 0 } } }),
  { sessionKey: 'm34-clean' });
  assert.deepEqual(clean.adapterGaps, []);
});

test('M34: instruction events carry markers and links, never `queued: true` or `meta`', () => {
  const session = sessionFromLedger(led({
    ask: [{ turn: 1, text: '/review the parser', markers: ['command'] }, { turn: 2, text: 'Then ship it.', markers: ['queued'] }],
    ledger: [{ turn: 1, seq: 0, kind: 'bash', cmd: 'npm test', outcome: 'passed', exitCode: 0, exitCodeSource: 'native' },
      { turn: 1, seq: 1, kind: 'other', tool: 'AskUserQuestion', genericTool: false }],
    interjections: [
      { turn: 1, kind: 'attached', beforeEvent: 0, source: 0, record: 2, text: 'The spec says X.' },
      { turn: 1, kind: 'queued', beforeEvent: 1, source: 0, record: 4, text: 'Keep the flags.' },
      // M34 labels review (F3): a refusal is no interjection kind: one persisted by the labels branch is not placed
      // (declared, never read as the human's).
      { turn: 1, kind: 'refusal', beforeEvent: 1, source: 0, record: 5, text: 'User rejected tool use', call: { turn: 1, seq: 0 } },
      { turn: 1, kind: 'answer', beforeEvent: 2, source: 0, record: 7, text: 'Option A', call: { turn: 1, seq: 1 } },
      { turn: 1, kind: 'peer', beforeEvent: 2, source: 0, record: 8, text: 'Reviewer says hi.' },
    ] }), { sessionKey: 'm34-markers' });
  const by = (id) => session.event(id);
  assert.deepEqual(by('I1').markers, ['command']);
  assert.deepEqual(by('I2').markers, ['queued']);
  const heard = instructions(session).filter((event) => /^I1-\d$/.test(event.id))
    .map((event) => [event.markers ?? null, event.answerTo ?? null, event.refuses ?? null, event.authority]);
  assert.deepEqual(heard, [[['attached'], null, null, 'human'], [['queued'], null, null, 'human'],
    [['answer'], 'A1-1', null, 'human'], [null, null, null, 'peer']]);
  assert.ok(session.adapterGaps.some((gap) => gap.channel === 'instructions' && gap.code === 'unsupported_message'
    && gap.count === 1), 'the refusal entry is declared, not read');
  for (const event of session.events) {
    assert.equal(Object.hasOwn(event, 'queued'), false, event.id);
    assert.equal(Object.hasOwn(event, 'meta'), false, event.id);
  }
  // The inventory says what each in-turn instruction is, by its markers and links.
  const inventory = instructionReviewScope(session).instructions;
  assert.deepEqual(inventory.find((entry) => entry.eventId === 'I1-3')?.answerTo, 'A1-1');
  assert.equal(inventory.some((entry) => Object.hasOwn(entry, 'refuses')), false);
  assert.deepEqual(inventory.find((entry) => entry.eventId === 'I1-2')?.markers, ['queued']);
});

test('M34: authority is derived from the recorded lineage; a persisted M33 N `meta` ask stays no instruction', () => {
  const helper = sessionFromLedger(led({ ask: [{ turn: 1, text: 'Write the regression test.' }],
    lineage: { rootSessionId: 's', files: ['f'], compactionBoundaries: [], role: 'helper' } }), { sessionKey: 'm34-helper' });
  assert.deepEqual(instructions(helper).map((event) => event.authority), ['agent']);
  const root = sessionFromLedger(led({ ask: [{ turn: 1, text: 'Fix the parser.' },
    { turn: 1, text: 'Base directory for this skill: /skills/deploy.', meta: true }] }), { sessionKey: 'm34-root' });
  assert.deepEqual(instructions(root).map((event) => [event.id, event.authority]), [['I1', 'human']]);
});

test('M34 end to end: a Codex human message after a typed interruption is marked and linked to its boundary', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'm34-codex-interrupt-'));
  try {
    const rec = (payload) => JSON.stringify({ type: 'response_item', payload });
    const file = join(dir, 'rollout-2026-10-06T00-00-00-m34.jsonl');
    await writeFile(file, [JSON.stringify({ type: 'session_meta', payload: { id: 'm34', cwd: '/repo' } }),
      rec({ type: 'message', role: 'user', content: 'Run the tests.' }),
      rec({ type: 'function_call', name: 'exec_command', arguments: JSON.stringify({ cmd: 'npm test' }), call_id: 'c1' }),
      JSON.stringify({ type: 'event_msg', payload: { type: 'turn_aborted', turn_id: 't1', reason: 'interrupted' } }),
      rec({ type: 'message', role: 'user', content: 'Stop, lint instead.' }),
    ].join('\n') + '\n', { mode: 0o600 });
    const raw = await sliceLineage([file]);
    assert.deepEqual(raw.ask.map((entry) => [entry.turn, entry.markers ?? null, entry.interrupted ?? null]),
      [[1, null, null], [2, ['after_interrupt'], { stream: 0, record: 4 }]]);
    const session = adapt(redact(raw).ledger, { sessionKey: 'm34-codex' });
    const boundary = session.events.find((event) => event.boundary === 'interrupt');
    const after = session.event(named(session, 'I2'));
    assert.deepEqual([after.markers, after.interruptedBy], [['after_interrupt'], boundary.id]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('M34 review (F5): a call the slicer linked notifications to carries their count onto its canonical invocation', () => {
  const ledger = [{ turn: 1, seq: 0, kind: 'bash', cmd: 'make', outcome: 'passed', exitCode: 0, exitCodeSource: 'native',
    background: true, notified: 2 }, { turn: 1, seq: 1, kind: 'bash', cmd: 'npm test', outcome: 'passed', exitCode: 0,
    exitCodeSource: 'native' }];
  const session = sessionFromLedger(led({ ask: [{ turn: 1, text: 'Build it.' }], ledger }), { sessionKey: 'm34-f5' });
  assert.deepEqual(session.events.filter((event) => event.kind === 'invocation').map((event) => [event.id,
    event.notified ?? null]), [['A1-0', 2], ['A1-1', null]]);
  // A value that is not a positive count carries nothing.
  const odd = sessionFromLedger(led({ ask: [{ turn: 1, text: 'Build it.' }], ledger: [{ ...ledger[0], notified: 'two' }] }),
    { sessionKey: 'm34-f5-odd' });
  assert.equal(Object.hasOwn(odd.event('A1-0'), 'notified'), false);
});
