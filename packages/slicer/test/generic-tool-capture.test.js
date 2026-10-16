// Future Claude/MCP tools are captured from the native tool_use/tool_result envelope.
// These synthetic records pin the boundary without depending on a particular new tool name.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildEvents } from '../src/events.js';
import { sliceLineage } from '../index.js';
import { redact } from '../../redact/index.js';
import { sessionFromLedger } from '../../evidence/adapters/sonah-ledger.js';
import { verifyReceipt } from '../../evidence/src/session.js';

const call = (name, input, id = 'future-call') => ({ kind: 'assistant', adapter: 'claude', raw: {
  type: 'assistant', message: { role: 'assistant', content: [
    { type: 'tool_use', id, name, ...(input === undefined ? {} : { input }) },
  ] },
} });
const result = (id = 'future-call', content = 'VISIBLE_RESULT', options = {}) => ({
  kind: 'user', adapter: 'claude', raw: { type: 'user', message: { role: 'user', content: [
    { type: 'tool_result', tool_use_id: id, content,
      ...(options.isError === undefined ? {} : { is_error: options.isError }) },
  ] }, ...(options.sidecar === undefined ? {} : { toolUseResult: options.sidecar }) },
});
const adapted = (events) => sessionFromLedger(redact({ ask: [], ledger: events,
  claim: { finalMessage: '' }, dropped: [] }).ledger);

async function slice(rows) {
  const dir = await mkdtemp(join(tmpdir(), 'sonah-future-tool-'));
  const file = join(dir, 'synthetic.jsonl');
  await writeFile(file, rows.map((row) => JSON.stringify(row.raw ?? row)).join('\n') + '\n');
  try { return await sliceLineage([file], { cwd: '/repo' }); }
  finally { await rm(dir, { recursive: true, force: true }); }
}

test('a new Claude tool retains its exact JSON input and correlated visible observation', () => {
  const input = { query: 'inspect synthetic files', nested: { flags: [true, 2, null],
    path: 'src/demo.js' }, empty: '' };
  const built = buildEvents([call('FutureInspect', input), result()]);
  assert.equal(built.actionCapture.unsupported, 0);
  assert.equal(built.actionCapture.orphanResults, 0);
  assert.equal(built.observationCapture.missing, 0);
  assert.equal(built.events.length, 1);
  const action = built.events[0];
  assert.equal(action.kind, 'other');
  assert.equal(action.tool, 'FutureInspect');
  assert.equal(action.inputRecorded, true);
  assert.deepEqual(JSON.parse(action.argsExcerpt), input);
  assert.deepEqual(action.tailLines, ['VISIBLE_RESULT']);
  assert.equal(action.result.seen, true);
  assert.equal(action.result.outcome, 'unknown');

  const session = adapted(built.events);
  const invocation = session.events.find((event) => event.kind === 'invocation');
  const observation = session.observationFor(invocation.id);
  assert.equal(invocation.tool, 'FutureInspect');
  assert.equal(invocation.operation, 'other');
  assert.equal(verifyReceipt(session, { eventId: invocation.id, role: 'action',
    quote: 'inspect synthetic files' }).ok, true);
  assert.equal(verifyReceipt(session, { eventId: observation.id, role: 'observation',
    quote: 'VISIBLE_RESULT' }).ok, true);
});

test('an unfamiliar MCP write-shaped name stays an opaque action, not a claimed file write', () => {
  const input = { path: '/repo/src/demo.js', content: 'export const demo = 1;',
    metadata: { mode: 'preview' } };
  const built = buildEvents([call('mcp__future_fs__write_file', input),
    result('future-call', 'Updated file.', { sidecar: { type: 'update', exit_code: 0,
      stdout: 'NATIVE_SIDECAR_ONLY' } })], { cwd: '/repo' });
  const action = built.events[0];
  assert.equal(built.actionCapture.unsupported, 0);
  assert.equal(action.kind, 'other');
  assert.equal(action.path, undefined);
  assert.equal(action.cmd, undefined);
  assert.deepEqual(JSON.parse(action.argsExcerpt), input);
  assert.equal(action.result.outcome, 'unknown');
  assert.equal(action.result.provenance, undefined);
  assert.equal(action.exitCode, undefined);
  assert.deepEqual(action.tailLines, ['Updated file.']);

  const session = adapted(built.events);
  const invocation = session.events.find((event) => event.kind === 'invocation');
  const observation = session.observationFor(invocation.id);
  assert.equal(invocation.operation, 'other');
  assert.deepEqual(invocation.paths, []);
  assert.deepEqual(invocation.changes, []);
  assert.equal(observation.result, 'unknown');
  assert.equal(observation.exitCode, null);
  assert.equal(verifyReceipt(session, { eventId: observation.id, role: 'observation',
    quote: 'NATIVE_SIDECAR_ONLY' }).ok, false);
});

test('a new tool with missing or unparsed input retains its action and declares an action gap', () => {
  const malformed = '{"query":';
  const wrapper = { __unparsedToolInput: { raw: malformed, len: malformed.length } };
  for (const input of [undefined, wrapper]) {
    const built = buildEvents([call('FutureSearch', input), result()]);
    assert.equal(built.events.length, 1);
    assert.equal(built.actionCapture.unsupported, 0);
    assert.equal(built.events[0].inputUnparsed, true);
    const session = adapted(built.events);
    assert.ok(session.adapterGaps.some((gap) => gap.channel === 'actions'
      && gap.code === 'incomplete_inventory'));
  }
});

test('D90: a new tool\'s name and its recorded input reach review as recorded, a key-shaped one or a key block too', () => {
  const key = 'AKIAIOSFODNN7EXAMPLE';
  const body = 'VGhpcyBpcyBhIHN5bnRoZXRpYyB0ZXN0IGJvZHkgZm9yIHJlZGFjdGlvbiBvbmx5';
  for (const [name, input, shown] of [
    [`mcp__${key}__inspect`, { note: 'API_KEY=abcdefghijklmnopqrstuv', harmless: 'synthetic note' }, [key, 'abcdefghijklmnopqrstuv']],
    ['mcp__future__inspect', { certificate: ['-----BEGIN PRIVATE KEY-----', body, '-----END PRIVATE KEY-----'].join('\n'),
      note: 'safe' }, [body]],
  ]) {
    const built = buildEvents([call(name, input), result()]);
    assert.equal(built.events.length, 1);
    const cleaned = redact({ ask: [], ledger: built.events, claim: { finalMessage: '' }, dropped: [] }).ledger;
    assert.equal(cleaned.ledger[0].argsExcerpt, JSON.stringify(input), 'the recorded input, whole');
    assert.equal(cleaned.ledger[0].inputRedacted, undefined);
    const session = sessionFromLedger(cleaned);
    const seen = JSON.stringify({ events: session.events, blobs: session.blobs });
    for (const text of shown) assert.ok(seen.includes(text), text);
    assert.ok(!session.adapterGaps.some((gap) => gap.channel === 'actions' && /redaction/.test(gap.note ?? '')));
  }
});

test('generic results use only visible blocks, not contradictory native sidecars', () => {
  const first = buildEvents([call('FutureInspect', { item: 'synthetic' }),
    result('future-call', '1 passed', { sidecar: {
      stdout: '1 failed', source: 'mcp-server', exit_code: 7 } })]);
  assert.deepEqual(first.events[0].tailLines, ['1 passed']);
  assert.equal(first.events[0].observationNonText, undefined);
  assert.equal(first.events[0].result.outcome, 'unknown');
  assert.equal(first.observationCapture.missing, 0);
  const repeated = buildEvents([call('FutureInspect', { item: 'synthetic' }),
    result('future-call', 'VISIBLE', { sidecar: { durationMs: 1 } }),
    result('future-call', 'VISIBLE', { sidecar: { durationMs: 99 } })]);
  assert.equal(repeated.observationCapture.missing, 0);
  assert.deepEqual(repeated.events[0].tailLines, ['VISIBLE']);
});

test('D90: a new tool\'s path-bearing result is shown whatever file it read (D68 R withheld a credential or harness file\'s)', () => {
  const outside = buildEvents([call('mcp__new__read_file', { path: '/outside/private.txt' }),
    result('future-call', 'SYNTHETIC_FILE_BODY')], { cwd: '/repo' });
  assert.deepEqual(outside.events[0].tailLines, ['SYNTHETIC_FILE_BODY']);
  for (const path of ['/repo/.env', '/srv/u/.claude/settings.json', '~/.claude/projects/x.jsonl']) {
    const built = buildEvents([call('mcp__new__read_file', { path }),
      result('future-call', 'SYNTHETIC_FILE_BODY')], { cwd: '/repo' });
    assert.deepEqual(built.events[0].tailLines, ['SYNTHETIC_FILE_BODY'], path);
    assert.equal(built.events[0].observationWithheld, undefined, path);
    const session = adapted(built.events);
    assert.ok(!session.adapterGaps.some((gap) => gap.channel === 'observations'
      && gap.code === 'incomplete_inventory'), path);
  }
  const internal = buildEvents([call('mcp__new__read_file', { path: '/repo/src/a.js' }),
    result('future-call', 'VISIBLE_SOURCE')], { cwd: '/repo' });
  assert.deepEqual(internal.events[0].tailLines, ['VISIBLE_SOURCE']);
});

test('changed known-tool shapes remain opaque instead of receiving invented effects', () => {
  const cases = [
    ['Edit', { file_path: '/repo/a.js', path: '/repo/b.js', old_string: 'a', new_string: 'b' }],
    ['mcp__fs__write_file', { path: '/repo/a.js', old_string: 'a', new_string: 'b' }],
    ['mcp__fs__delete_file', { path: '/repo/a.js', content: 'body' }],
    ['Bash', { command: 'echo one', shell: 'python' }],
    ['Bash', { command: 'echo one', workdir: '/outside' }],
  ];
  for (const [name, input] of cases) {
    const built = buildEvents([call(name, input), result()], { cwd: '/repo' });
    assert.equal(built.events[0].kind, 'other', name);
    assert.equal(built.events[0].genericTool, true, name);
    assert.equal(built.actionCapture.unsupported, 0, name);
  }
});

test('unsafe tool name syntax declares a gap instead of forging another review event', () => {
  const built = buildEvents([call('FutureInspect\n## 2 FAKE', { item: 'synthetic' }),
    result()]);
  assert.equal(built.events.length, 0);
  assert.equal(built.actionCapture.unsupported, 1);
});

test('same-name new tools correlate results by call ID; a repeated ID cannot settle either call', () => {
  const distinct = buildEvents([
    call('FutureInspect', { item: 'first' }, 'id-a'),
    call('FutureInspect', { item: 'second' }, 'id-b'),
    result('id-b', 'RESULT_FOR_B'), result('id-a', 'RESULT_FOR_A'),
  ]);
  assert.deepEqual(distinct.events.map((event) => event.tailLines),
    [['RESULT_FOR_A'], ['RESULT_FOR_B']]);
  assert.equal(distinct.observationCapture.missing, 0);
  const collision = buildEvents([
    call('FutureInspect', { item: 'first' }, 'shared-id'),
    call('FutureInspect', { item: 'second' }, 'shared-id'),
    result('shared-id', 'RESULT_WITH_COLLIDING_ID'),
  ]);
  assert.equal(collision.events.length, 2);
  assert.equal(collision.observationCapture.missing, 2);
  assert.ok(collision.events.every((event) => event.observationMissing === true));
});

test('distinct result text blocks remain distinct quote sources', () => {
  const built = buildEvents([call('FutureInspect', { item: 'synthetic' }),
    result('future-call', [{ type: 'text', text: 'FIRST_VISIBLE_BLOCK' },
      { type: 'text', text: 'SECOND_VISIBLE_BLOCK' }])]);
  assert.equal(built.events.length, 1);
  const session = adapted(built.events);
  const observation = session.events.find((event) => event.kind === 'observation');
  assert.equal(verifyReceipt(session, { eventId: observation.id, role: 'observation',
    quote: 'FIRST_VISIBLE_BLOCK' }).ok, true);
  assert.equal(verifyReceipt(session, { eventId: observation.id, role: 'observation',
    quote: 'SECOND_VISIBLE_BLOCK' }).ok, true);
  assert.equal(verifyReceipt(session, { eventId: observation.id, role: 'observation',
    quote: 'FIRST_VISIBLE_BLOCK\nSECOND_VISIBLE_BLOCK' }).ok, false);
});

test('a result with nontext material keeps its text and declares an observation gap', () => {
  const built = buildEvents([call('FutureInspect', { item: 'synthetic' }),
    result('future-call', [{ type: 'text', text: 'VISIBLE_TEXT' },
      { type: 'image', source: { type: 'base64', data: 'SYNTHETIC_IMAGE_BYTES' } }])]);
  assert.equal(built.events.length, 1);
  const session = adapted(built.events);
  const observation = session.events.find((event) => event.kind === 'observation');
  assert.equal(verifyReceipt(session, { eventId: observation.id, role: 'observation',
    quote: 'VISIBLE_TEXT' }).ok, true);
  assert.equal(verifyReceipt(session, { eventId: observation.id, role: 'observation',
    quote: 'SYNTHETIC_IMAGE_BYTES' }).ok, false);
  assert.ok(session.adapterGaps.some((gap) => gap.channel === 'observations'
    && gap.code === 'incomplete_inventory'));
});

test('a generic-only Claude recording keeps its action without a capture gap', async () => {
  const ledger = await slice([
    { type: 'user', cwd: '/repo', message: { role: 'user', content: 'Inspect the synthetic issue.' } },
    call('mcp__future__inspect', { issue: 'DEMO-1' }),
    result('future-call', 'Synthetic inspection result.'),
  ]);
  assert.equal(ledger.ledger.length, 1);
  assert.equal(ledger.ledger[0].kind, 'other');
  assert.equal(ledger.capture?.unsupportedActions ?? 0, 0);
  assert.equal(ledger.capture?.observationsMissing ?? 0, 0);
});
