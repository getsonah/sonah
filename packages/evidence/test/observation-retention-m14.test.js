import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildEvents } from '../../slicer/src/events.js';
import { redact } from '../../redact/index.js';
import { sessionFromLedger } from '../adapters/sonah-ledger.js';
import { verifyReceipt } from '../src/session.js';
import { planWindows, shownFields } from '../src/windows.js';

const call = (id, name, input) => ({ type: 'tool_use', id, name, input });
const result = (id, content, extra = {}) => ({ type: 'tool_result', tool_use_id: id, content, ...extra });
const assistant = (...content) => ({ kind: 'assistant', raw: { type: 'assistant',
  message: { role: 'assistant', content } } });
const user = (...content) => ({ kind: 'user', raw: { type: 'user',
  message: { role: 'user', content } } });
const sessionOf = (events) => sessionFromLedger(redact({ ask: [], ledger: events,
  claim: { finalMessage: '' }, dropped: [] }).ledger);

test('Read, Write and failed Edit keep their model-visible textual observations', () => {
  const built = buildEvents([
    assistant(call('r', 'Read', { file_path: '/repo/src/a.js' }),
      call('w', 'Write', { file_path: '/repo/src/b.js', content: 'export const b = 1;' }),
      call('e', 'Edit', { file_path: '/repo/src/a.js', old_string: 'a', new_string: 'b' })),
    user(result('r', 'VISIBLE_READ_CONTENT'), result('w', 'File created successfully at: src/b.js'),
      result('e', 'VISIBLE_EDIT_ERROR', { is_error: true })),
  ], { cwd: '/repo' });
  const session = sessionOf(built.events);
  const observations = session.events.filter((event) => event.kind === 'observation');
  assert.equal(observations.length, 3);
  for (const [index, quote] of ['VISIBLE_READ_CONTENT', 'File created successfully at: src/b.js',
    'VISIBLE_EDIT_ERROR'].entries()) {
    assert.equal(verifyReceipt(session, { eventId: observations[index].id, role: 'observation', quote }).ok, true);
  }
  assert.deepEqual(session.adapterGaps.filter((gap) => gap.channel === 'observations').map((gap) => gap.code),
    ['write_outcome_unknown'], 'visible success text does not prove the Write completed');
});

test('a richer native sidecar never replaces the text the worker actually saw', () => {
  const built = buildEvents([assistant(call('r', 'Read', { file_path: '/repo/src/a.js' })),
    { ...user(result('r', 'VISIBLE_BLOCK')),
      raw: { ...user(result('r', 'VISIBLE_BLOCK')).raw,
        toolUseResult: { type: 'update', originalFile: 'HIDDEN_SIDECAR_CONTENT',
          metadata: 'SIDE_CAR_VALUE' } } },
  ], { cwd: '/repo' });
  assert.deepEqual(built.events[0].tailLines, ['VISIBLE_BLOCK']);
  const session = sessionOf(built.events);
  const observation = session.events.find((event) => event.kind === 'observation');
  assert.equal(verifyReceipt(session, { eventId: observation.id, role: 'observation', quote: 'VISIBLE_BLOCK' }).ok, true);
  assert.equal(verifyReceipt(session, { eventId: observation.id, role: 'observation', quote: 'HIDDEN_SIDECAR_CONTENT' }).ok, false);
});

test('mixed text and image keeps quotable text but declares its unreadable portion', () => {
  const built = buildEvents([
    assistant(call('r', 'Read', { file_path: '/repo/src/a.js' })),
    user(result('r', [{ type: 'text', text: 'VISIBLE_TEXT_PART' },
      { type: 'image', source: { type: 'base64', data: 'SYNTHETIC_IMAGE' } }])),
  ], { cwd: '/repo' });
  assert.deepEqual(built.events[0].tailLines, ['VISIBLE_TEXT_PART']);
  assert.equal(built.events[0].observationNonText, true);
  const session = sessionOf(built.events);
  const observation = session.events.find((event) => event.kind === 'observation');
  assert.equal(verifyReceipt(session, { eventId: observation.id, role: 'observation', quote: 'VISIBLE_TEXT_PART' }).ok, true);
  assert.ok(session.adapterGaps.some((gap) => gap.channel === 'observations'
    && gap.code === 'incomplete_inventory' && gap.note.includes('nontext')));
});

test('an object-shaped image result is an observation gap too', () => {
  const built = buildEvents([
    assistant(call('r', 'Read', { file_path: '/repo/src/a.js' })),
    user(result('r', { type: 'image', source: { type: 'base64', data: 'SYNTHETIC_IMAGE' } })),
  ], { cwd: '/repo' });
  assert.equal(built.events[0].observationNonText, true);
  const session = sessionOf(built.events);
  assert.ok(session.adapterGaps.some((gap) => gap.channel === 'observations'
    && gap.code === 'incomplete_inventory' && gap.note.includes('nontext')));
});

test('an opaque base64 object never becomes quotable observation text', () => {
  const built = buildEvents([
    assistant(call('r', 'Read', { file_path: '/repo/src/a.js' })),
    user(result('r', { file: { base64: 'SYNTHETIC_BINARY_PAYLOAD' } })),
  ], { cwd: '/repo' });
  assert.equal(built.events[0].observationNonText, true);
  assert.equal(built.events[0].tailLines, undefined);
  const session = sessionOf(built.events);
  assert.equal(JSON.stringify(session.events).includes('SYNTHETIC_BINARY_PAYLOAD'), false);
  assert.ok(session.adapterGaps.some((gap) => gap.channel === 'observations'
    && gap.code === 'incomplete_inventory' && gap.note.includes('nontext')));
});

test('D90: credential and harness file results are shown as every other folder\'s; external still marks the write scope', () => {
  const built = buildEvents([
    assistant(call('credential', 'Read', { file_path: '/repo/.env' }),
      call('external', 'Read', { file_path: '/tmp/external.txt' }),
      call('relative', 'Read', { file_path: '../private/notes.txt' }),
      call('nested', 'Read', { file_path: 'src/../../private/other.txt' }),
      call('home', 'Read', { file_path: '~/.claude/memory/notes.md' }),
      call('harness', 'Read', { file_path: '/srv/u/.claude/projects/p/s.jsonl' }),
      call('absolute', 'Read', { file_path: '/repo/../private/hidden.txt' }),
      call('windows', 'Read', { file_path: 'C:\\Users\\other\\notes.txt' }),
      call('scratch', 'Read', { file_path: '/private/tmp/claude-501/p/s/scratchpad/plan.md' })),
    user(result('credential', 'SYNTHETIC_CREDENTIAL_BODY'),
      result('external', 'SYNTHETIC_EXTERNAL_BODY'),
      result('relative', 'SYNTHETIC_RELATIVE_BODY'),
      result('nested', 'SYNTHETIC_NESTED_BODY'),
      result('home', 'SYNTHETIC_HOME_BODY'),
      result('harness', 'SYNTHETIC_HARNESS_BODY'),
      result('absolute', 'SYNTHETIC_ABSOLUTE_BODY'),
      result('windows', 'SYNTHETIC_WINDOWS_BODY'),
      result('scratch', 'SYNTHETIC_SCRATCH_BODY')),
  ], { cwd: '/repo' });
  assert.equal(built.events.length, 9);
  // D90 (owner decision 2026-10-15): no result is withheld for the file it read (D68 R withheld a credential-shaped
  // file's, D69 b a harness home folder's): the reviewer sees what the agent saw.
  assert.equal(built.events.filter((event) => event.observationWithheld === true).length, 0);
  assert.deepEqual(built.events.map((event) => event.tailLines[0]), ['SYNTHETIC_CREDENTIAL_BODY',
    'SYNTHETIC_EXTERNAL_BODY', 'SYNTHETIC_RELATIVE_BODY', 'SYNTHETIC_NESTED_BODY', 'SYNTHETIC_HOME_BODY',
    'SYNTHETIC_HARNESS_BODY', 'SYNTHETIC_ABSOLUTE_BODY', 'SYNTHETIC_WINDOWS_BODY', 'SYNTHETIC_SCRATCH_BODY']);
  // `external` still marks what lies outside the write scope: all but the project's own file.
  assert.deepEqual(built.events.map((event) => event.external === true), [false, true, true, true, true, true, true, true,
    true]);
  const session = sessionOf(built.events);
  const output = session.events.filter((event) => event.kind === 'observation');
  assert.equal(output.length, 9);
  assert.equal(output.filter((event) => event.output.length === 0).length, 0);
  assert.ok(!session.adapterGaps.some((gap) => gap.channel === 'observations' && gap.note.includes('withheld')));
});

test('a Windows path inside a Windows workspace retains the visible result', () => {
  const built = buildEvents([
    assistant(call('r', 'Read', { file_path: 'C:\\repo\\src\\a.js' })),
    user(result('r', 'SYNTHETIC_WINDOWS_SOURCE')),
  ], { cwd: 'C:\\repo' });
  assert.equal(built.events[0].path, 'src/a.js');
  assert.equal(built.events[0].external, undefined);
  assert.deepEqual(built.events[0].tailLines, ['SYNTHETIC_WINDOWS_SOURCE']);
});

test('an oversized visible result remains recorded whole; a window shows its first and last 1k tokens, declared (M35)', () => {
  const visible = Array.from({ length: 450 }, (_, index) => `line ${index}: ${'x'.repeat(490)}`).join('\n');
  const built = buildEvents([
    assistant(call('r', 'Read', { file_path: '/repo/src/large.js' })),
    user(result('r', visible)),
  ], { cwd: '/repo' });
  assert.equal(built.events[0].tailLines.join('\n'), visible);
  const session = sessionOf(built.events);
  const observation = session.events.find((event) => event.kind === 'observation');
  assert.ok(session.textOf(observation, 'output').length > 196608);
  assert.equal(session.adapterGaps.some((gap) => gap.code === 'source_clipped'), false);
  const windows = planWindows(session);
  assert.equal(windows.length, 1);
  assert.equal(windows[0].oversize, false, 'trimmed to 2k tokens in its window, by position');
  const [shown] = shownFields(session, observation);
  assert.ok(shown.omittedBytes > 0 && shown.spans.length === 2);
});
