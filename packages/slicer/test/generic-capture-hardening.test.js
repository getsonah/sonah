import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { buildEvents } from '../src/events.js';
import { readSession, toolResultsOf, ensureClaudeLabels } from '../src/records.js';
import { opensTurn } from '../src/labels.js';
import { sliceLineage, hasCaptureGaps, hasActionGaps } from '../index.js';
import { sessionFromLedger } from '../../evidence/adapters/sonah-ledger.js';
import { runReview } from '../../evidence/src/run-review.js';
import { collectDelegations } from '../src/delegation-records.js';
import { scratchDir } from './scratch-dir.js';

const call = (id = 'tool-1') => ({ kind: 'assistant', adapter: 'claude', raw: {
  type: 'assistant', message: { role: 'assistant', content: [
    { type: 'tool_use', id, name: 'Bash', input: { command: 'node --test' } },
  ] },
} });
const result = (id, content, isError = false) =>
  ({ type: 'tool_result', tool_use_id: id, content, is_error: isError });
const user = (blocks) => ({ kind: 'user', adapter: 'claude', raw: {
  type: 'user', message: { role: 'user', content: blocks },
} });

test('a mixed Claude result/human turn keeps the outcome and the human instruction separately', () => {
  // M34 labels (C-02 "Slice-time labels"): the result block is an observation and the text block the human's (a typed
  // origin on a 2.1.219+ recorder), labelled per block; a block is kept whole — the harness text inside the human's
  // block is no longer cut out by its tags (HARNESS_BLOCK is deleted), and is counted as a mixed block instead.
  const mixed = user([result('tool-1', '1 failed', true),
    { type: 'text', text: '<system-reminder>harness instruction</system-reminder>\nPlease fix the failing test.' }]);
  Object.assign(mixed.raw, { version: '2.1.284', origin: { kind: 'human' } });
  ensureClaudeLabels([mixed]);
  assert.deepEqual(mixed.parts.map((part) => part.label), ['observation', 'human']);
  assert.equal(opensTurn(mixed), true);
  const built = buildEvents([call(), mixed]);
  assert.equal(built.events.length, 1);
  assert.equal(built.events[0].outcome, 'failed');
  assert.equal(built.observationCapture.missing, 0);
  assert.deepEqual(built.ask.map((a) => a.text), ['<system-reminder>harness instruction</system-reminder>\nPlease fix the failing test.']);
});

test('M34 labels: harness text inside a human block is kept whole as the human\'s, never cut out by its tags', () => {
  // The owner's rule (2026-10-06, C-02 "Slice-time labels"): a block is labelled whole. Harness text the recorder wrote
  // into the human's own block stays in it; no tag list cuts it out.
  const row = user([{ type: 'text', text:
    '<task-notification>Agent finished unrelated work.</task-notification>\nPlease update the parser.' }]);
  Object.assign(row.raw, { version: '2.1.284', origin: { kind: 'human' } });
  const built = buildEvents([row]);
  assert.deepEqual(built.ask.map((a) => a.text),
    ['<task-notification>Agent finished unrelated work.</task-notification>\nPlease update the parser.']);
});

test('conflicting same-record Claude results leave O unverified and declare a gap', async () => {
  const blocks = [result('tool-1', '1 failed', true), result('tool-1', 'all passed', false)];
  assert.equal(toolResultsOf(user(blocks).raw).get('tool-1').ambiguous, true);
  const built = buildEvents([call(), user(blocks)]);
  assert.equal(built.events[0].observationMissing, true);
  assert.equal(built.events[0].outcome, undefined);
  assert.equal(built.observationCapture.missing, 1);

  const dir = await scratchDir('sonah-claude-conflict-');
  const file = join(dir, 'session.jsonl');
  const lines = [call().raw, user(blocks).raw];
  await writeFile(file, `${lines.map((line) => JSON.stringify(line)).join('\n')}\n`);
  const ledger = await sliceLineage([file], { cwd: '/repo' });
  assert.equal(ledger.capture.observationsMissing, 1);
  const session = sessionFromLedger(ledger);
  assert.ok(session.adapterGaps.some((gap) => gap.channel === 'observations'));
});

test('H1: two carriers\' text is never compared for a status, and neither makes a command pass', () => {
  const carrier = { ...user([result('tool-1', '1 failed', false)]).raw,
    toolUseResult: { stdout: '1 passed; all tests passed with additional output' } };
  assert.notEqual(toolResultsOf(carrier).get('tool-1').ambiguous, true, 'no status is read from either text');
  const built = buildEvents([call(), { kind: 'user', adapter: 'claude', raw: carrier }]);
  assert.equal(built.events[0].outcome, 'unknown', 'no typed exit, no error flag, no known verdict: unknown');
  assert.equal(built.events[0].observationMissing, undefined);
});

test('a native nonzero Claude test exit cannot be certified by a green-looking excerpt', () => {
  const carrier = { ...user([result('tool-1', '1 passed')]).raw,
    toolUseResult: { stdout: '1 passed', exit_code: 2 } };
  const built = buildEvents([call(), { kind: 'user', adapter: 'claude', raw: carrier }]);
  assert.equal(built.events[0].exitCode, 2);
  assert.equal(built.events[0].outcome, 'failed', 'H1: the typed exit decides; the excerpt is never read');
  assert.equal(built.events[0].outcomeSource, 'native');
  assert.equal(built.observationCapture.missing, 0);
});

test('a conflicting PostToolUse sidecar withholds O even when output looks green', () => {
  const built = buildEvents([call(), user([result('tool-1', '1 passed')])],
    { outcomes: new Map([['tool-1', { exitCode: null, interrupted: null, tool: null, ambiguous: true }]]) });
  assert.equal(built.events[0].outcome, undefined);
  assert.equal(built.events[0].observationMissing, true);
  assert.equal(built.observationCapture.missing, 1);
});

test('conflicting Claude Agent child IDs in block and structured result never establish a link', () => {
  const agentUse = { kind: 'assistant', adapter: 'claude', source: 0, raw: {
    type: 'assistant', message: { role: 'assistant', content: [
      { type: 'tool_use', id: 'agent-call', name: 'Agent', input: { prompt: 'Fix one test.' } }] } } };
  const agentResult = { kind: 'user', adapter: 'claude', source: 0, raw: {
    type: 'user', message: { role: 'user', content: [
      result('agent-call', 'agentId: 0123456789abcdef') ] },
    toolUseResult: { agentId: 'fedcba9876543210' } } };
  assert.equal(toolResultsOf(agentResult.raw).get('agent-call').ambiguous, true);
  const [delegation] = collectDelegations([agentUse, agentResult]);
  assert.equal(delegation.childId, null);
  assert.equal(delegation.reason, 'delegation_result_ambiguous');
});

test('a conflicting later result retracts the first outcome; an identical replay does not', () => {
  const failed = user([result('tool-1', '1 failed', true)]);
  const passed = user([result('tool-1', 'all passed', false)]);
  const conflict = buildEvents([call(), failed, passed]);
  assert.equal(conflict.events[0].outcome, undefined);
  assert.equal(conflict.events[0].observationMissing, true);
  assert.equal(conflict.observationCapture.missing, 1);

  const replay = buildEvents([call(), failed, failed]);
  assert.equal(replay.events[0].outcome, 'failed');
  assert.equal(replay.observationCapture.missing, 0);
});

test('a result can settle its call across a compaction file boundary', () => {
  const first = { ...call(), source: 0 };
  const foreign = { ...user([result('tool-1', '1 passed', true)]), source: 1 };
  const built = buildEvents([first, foreign]);
  assert.equal(built.events[0].observationMissing, undefined);
  assert.equal(built.events[0].outcome, 'failed', 'settled by its typed error flag (H1: never by its text)');
  assert.equal(built.actionCapture.orphanResults, 0);
});

test('a repeated tool-use ID in one source does not erase either action or settle an outcome', () => {
  const built = buildEvents([call(), call(), user([result('tool-1', 'all passed')])]);
  assert.equal(built.events.length, 2);
  assert.equal(built.observationCapture.missing, 2);
  assert.ok(built.events.every((event) => event.observationMissing === true));
});

test('a Claude user image is counted as missing instruction evidence even beside text', async () => {
  const dir = await scratchDir('sonah-claude-image-');
  const file = join(dir, 'session.jsonl');
  // M34 labels: a human's row with an image, as a typed recorder writes it (a legacy recorder's array row is the
  // fallback's harness).
  const lines = [{ ...user([{ type: 'text', text: 'Please implement this diagram.' },
    { type: 'image', source: { type: 'base64', data: 'c3ludGhldGlj' } }]).raw, version: '2.1.284', origin: { kind: 'human' } },
  call().raw,
    user([result('tool-1', '1 passed')]).raw];
  await writeFile(file, `${lines.map((line) => JSON.stringify(line)).join('\n')}\n`);
  const ledger = await sliceLineage([file], { cwd: '/repo' });
  assert.equal(ledger.capture.instructionsNonText, 1);
  assert.equal(ledger.ask.length, 1);
  assert.ok(sessionFromLedger(ledger).adapterGaps.some((gap) => gap.channel === 'instructions'));
});

test('contradictory Claude source identity and a mixed unsupported message row declare gaps', async () => {
  const dir = await scratchDir('sonah-claude-identity-');
  const file = join(dir, 'session.jsonl');
  const lines = [
    { type: 'user', sessionId: 'first', message: { role: 'user', content: 'Fix it.' } },
    { type: 'assistant', sessionId: 'second', message: { role: 'assistant', content: [
      { type: 'tool_use', id: 'tool-1', name: 'Bash', input: { command: 'node --test' } }] } },
    { type: 'future_assistant_record', message: { role: 'assistant', content: [
      { type: 'tool_use', id: 'tool-2', name: 'Bash', input: { command: 'node --test' } }] } },
  ];
  await writeFile(file, `${lines.map((line) => JSON.stringify(line)).join('\n')}\n`);
  const ledger = await sliceLineage([file], { cwd: '/repo', includeSources: true });
  assert.equal(ledger.sources[0].identityConflict, true);
  assert.equal(ledger.capture.incomplete, true);
  const gaps = sessionFromLedger(ledger).adapterGaps;
  assert.ok(gaps.some((gap) => gap.channel === 'identity'));
  assert.ok(gaps.some((gap) => gap.channel === 'actions'));
});

test('an unsupported Claude human row declares instruction loss without inventing action loss', async () => {
  const dir = await scratchDir('sonah-claude-unsupported-human-');
  const file = join(dir, 'session.jsonl');
  const lines = [
    user('Run the test.').raw,
    { type: 'future_user_record', message: { role: 'user', content: 'Also check the boundary.' } },
    call().raw, user([result('tool-1', '1 passed')]).raw,
  ];
  await writeFile(file, `${lines.map((line) => JSON.stringify(line)).join('\n')}\n`);
  const ledger = await sliceLineage([file], { cwd: '/repo' });
  assert.equal(ledger.capture.unsupportedRowChannels.instructions, 1);
  const gaps = sessionFromLedger(ledger).adapterGaps;
  assert.ok(gaps.some((gap) => gap.channel === 'instructions' && gap.code === 'unsupported_message'));
  assert.ok(!gaps.some((gap) => gap.channel === 'actions'), 'a human-only loss is not an action gap');
});

test('a mixed unsupported Claude row declares both its instruction and result channels', async () => {
  const dir = await scratchDir('sonah-claude-unsupported-mixed-');
  const file = join(dir, 'session.jsonl');
  const lines = [call().raw, { type: 'future_user_record', message: { role: 'user', content: [
    { type: 'text', text: 'Continue with the fix.' }, result('tool-1', '1 passed') ] } }];
  await writeFile(file, `${lines.map((line) => JSON.stringify(line)).join('\n')}\n`);
  const ledger = await sliceLineage([file], { cwd: '/repo' });
  assert.equal(ledger.capture.unsupportedRowChannels.instructions, 1);
  assert.equal(ledger.capture.unsupportedRowChannels.observations, 1);
  const gaps = sessionFromLedger(ledger).adapterGaps;
  assert.ok(gaps.some((gap) => gap.channel === 'instructions' && gap.code === 'unsupported_message'));
  assert.ok(gaps.some((gap) => gap.channel === 'observations' && gap.code === 'unsupported_message'));
  assert.ok(!gaps.some((gap) => gap.channel === 'actions'));
});

test('a future block in a kept Claude user row declares unknown scope even beside valid work', async () => {
  const dir = await scratchDir('sonah-claude-future-block-');
  const file = join(dir, 'session.jsonl');
  const lines = [user('Fix the bug.').raw,
    user([{ type: 'future_block', text: 'Additional requirement.' }]).raw,
    call().raw, user([result('tool-1', '1 passed')]).raw];
  await writeFile(file, `${lines.map((line) => JSON.stringify(line)).join('\n')}\n`);
  const ledger = await sliceLineage([file], { cwd: '/repo' });
  assert.equal(ledger.capture.unclassifiedRows, 1);
  assert.equal(hasCaptureGaps(ledger), true);
  assert.equal(hasActionGaps(ledger), false);
  const session = sessionFromLedger(ledger);
  assert.ok(session.adapterGaps.some((gap) => gap.channel === 'identity'
    && gap.code === 'unsupported_message'));
  const report = await runReview({ session, pr: { repo: { host: 'github.com', id: '42' }, files: [] },
    judge: async () => ({ decisions: [], pivots: [], claims: [], requirements: [] }) });
  // M33 (C-06): the review completed; the unknown scope is a declared recorder limit, so the session
  // reads NO_FINDINGS — partial, named, never CLEAN. Before M33 it read UNCHECKED.
  assert.equal(report.sessionStatus, 'NO_FINDINGS');
});

test('a future object content in a kept user row also declares unknown scope', async () => {
  const dir = await scratchDir('sonah-claude-future-object-');
  const file = join(dir, 'session.jsonl');
  const lines = [user('Fix the bug.').raw,
    user({ type: 'text', text: 'Additional requirement.' }).raw,
    call().raw, user([result('tool-1', '1 passed')]).raw];
  await writeFile(file, `${lines.map((line) => JSON.stringify(line)).join('\n')}\n`);
  const ledger = await sliceLineage([file], { cwd: '/repo' });
  assert.equal(ledger.capture.unclassifiedRows, 1);
  assert.ok(sessionFromLedger(ledger).adapterGaps.some((gap) => gap.channel === 'identity'));
});

test('an unfamiliar top-level Claude row with only a body declares unknown scope in a mixed file', async () => {
  const dir = await scratchDir('sonah-claude-future-row-');
  const file = join(dir, 'session.jsonl');
  const lines = [user('Run the test.').raw,
    { type: 'future_agent_event', body: { role: 'assistant', tool: {
      name: 'mcp__example__new_tool', input: { task: 'check a file' } } } },
    call().raw, user([result('tool-1', '1 passed')]).raw];
  await writeFile(file, `${lines.map((line) => JSON.stringify(line)).join('\n')}\n`);

  const parsed = await readSession(file);
  assert.equal(parsed.records.length, 3, 'known conversation rows still parse');
  assert.equal(parsed.unknownSchema, false, 'the file is mixed, not wholly foreign');
  assert.equal(parsed.meta.capture.unclassifiedRows, 1);
  const ledger = await sliceLineage([file], { cwd: '/repo' });
  assert.equal(ledger.capture.unclassifiedRows, 1);
  assert.equal(hasCaptureGaps(ledger), true);
  assert.equal(ledger.ledger.filter((event) => event.kind === 'bash').length, 1);
  assert.ok(sessionFromLedger(ledger).adapterGaps.some((gap) => gap.channel === 'identity'
    && gap.code === 'unsupported_message' && gap.count === 1));
});

// Kept from the legacy compiler's tier.test.js (removed with the compiler): the wholly foreign file.
test('AUDIT-FIX: an unknown transcript schema is a declared incapacity, not an empty session', async () => {
  const dir = await scratchDir('sonah-schema-');
  const f = join(dir, 'openhands.jsonl');
  await writeFile(f, Array.from({ length: 15 }, (_, i) =>
    JSON.stringify({ action: 'run', observation: 'ok', step: i })).join('\n'));
  const r = await readSession(f, {});
  assert.equal(r.records.length, 0);
  assert.equal(r.unknownSchema, true, 'valid JSON, zero records: this parser does not speak it');
});

test('unknown sidechain rows and familiar row types with new body carriers declare gaps', async () => {
  const dir = await scratchDir('sonah-claude-carrier-drift-');
  const file = join(dir, 'session.jsonl');
  const lines = [user('Run the test.').raw,
    { type: 'future_tool_record', isSidechain: true, body: { tool: 'FutureInspect' } },
    { type: 'user', body: { role: 'user', content: 'A further requirement.' } },
    call().raw, user([result('tool-1', '1 passed')]).raw];
  await writeFile(file, lines.map((line) => JSON.stringify(line)).join(String.fromCharCode(10))
    + String.fromCharCode(10));
  const ledger = await sliceLineage([file], { cwd: '/repo' });
  assert.equal(ledger.capture.unclassifiedRows, 2);
  assert.ok(sessionFromLedger(ledger).adapterGaps.some((gap) =>
    gap.channel === 'identity' && gap.count === 2));
});

test('ordinary Claude metadata rows add no capture gap beside known tools', async () => {
  const dir = await scratchDir('sonah-claude-scaffold-');
  const file = join(dir, 'session.jsonl');
  const lines = [user('Run the test.').raw,
    { type: 'progress', sessionId: 'session-1', data: { type: 'hook_progress' } },
    { type: 'file-history-snapshot', sessionId: 'session-1', snapshot: {} },
    { type: 'summary', sessionId: 'session-1', summary: 'Synthetic summary.' },
    call().raw, user([result('tool-1', '1 passed')]).raw];
  await writeFile(file, `${lines.map((line) => JSON.stringify(line)).join('\n')}\n`);

  const parsed = await readSession(file);
  assert.equal(parsed.records.length, 3);
  assert.equal(parsed.meta.capture, undefined);
  const ledger = await sliceLineage([file], { cwd: '/repo' });
  assert.equal(hasCaptureGaps(ledger), false);
  assert.equal(ledger.ledger.filter((event) => event.kind === 'bash').length, 1);
});

test('a future progress payload cannot hide a tool call behind a scaffold type', async () => {
  const dir = await scratchDir('sonah-progress-drift-');
  const file = join(dir, 'session.jsonl');
  const rows = [user('Run the test.').raw,
    { type: 'progress', sessionId: 'session-1', data: {
      type: 'tool_use', name: 'FutureTool', input: { task: 'change a file' } } },
    call().raw, user([result('tool-1', '1 passed')]).raw];
  await writeFile(file, rows.map((row) => JSON.stringify(row)).join('\n') + '\n');
  const parsed = await readSession(file);
  assert.equal(parsed.meta.capture.unclassifiedRows, 1);
  const ledger = await sliceLineage([file], { cwd: '/repo' });
  assert.equal(hasCaptureGaps(ledger), true);
});

test('only a typed mechanical attachment is excluded from Claude T/A/O', async () => {
  const dir = await scratchDir('sonah-attachment-shape-');
  const file = join(dir, 'session.jsonl');
  const envelope = {
    cwd: '/repo', entrypoint: 'cli', gitBranch: 'main', isSidechain: false,
    parentUuid: null, sessionId: 'session-1', timestamp: '2026-09-24T00:00:00Z',
    type: 'attachment', userType: 'external', uuid: 'attach-1', version: '1',
  };
  const mechanical = { ...envelope,
    attachment: { type: 'total_tokens_reminder', text: 'Synthetic token count.' },
    rendered: [{ content: 'Synthetic token count.' }] };
  const unseen = { ...envelope, uuid: 'attach-2',
    attachment: { type: 'hook_additional_context', text: 'Synthetic extra instruction.' },
    rendered: [{ content: 'Synthetic extra instruction.' }] };
  const rows = [user('Run the test.').raw, mechanical, unseen,
    call().raw, user([result('tool-1', '1 passed')]).raw];
  await writeFile(file, rows.map((row) => JSON.stringify(row)).join('\n') + '\n');
  const parsed = await readSession(file);
  assert.equal(parsed.meta.capture.unclassifiedRows, 1);
  const ledger = await sliceLineage([file], { cwd: '/repo' });
  assert.equal(hasCaptureGaps(ledger), true);
});

test('a short Codex rollout renamed outside the native path still routes by content', async () => {
  const dir = await scratchDir('sonah-renamed-codex-');
  const file = join(dir, 'imported-session.jsonl');
  const lines = [
    { type: 'session_meta', payload: { id: 'codex-synthetic', cwd: '/repo' } },
    { type: 'response_item', payload: { type: 'message', role: 'user', content: 'Run a test.' } },
    { type: 'response_item', payload: { type: 'function_call', call_id: 'cmd-1',
      name: 'exec_command', arguments: JSON.stringify({ cmd: 'node --test' }) } },
    { type: 'response_item', payload: { type: 'function_call_output', call_id: 'cmd-1',
      output: JSON.stringify({ output: '1 passed', exit_code: 0 }) } },
  ];
  await writeFile(file, `${lines.map((line) => JSON.stringify(line)).join('\n')}\n`);
  const normalized = await readSession(file);
  assert.equal(normalized.meta.agent, 'codex');
  const ledger = await sliceLineage([file], { cwd: '/repo' });
  assert.equal(ledger.ledger.filter((event) => event.kind === 'bash').length, 1);
});

test('one unsupported source row is an unknown schema, not an empty complete session', async () => {
  const dir = await scratchDir('sonah-foreign-schema-');
  const file = join(dir, 'foreign.jsonl');
  await writeFile(file, `${JSON.stringify({ type: 'future_agent_event', body: {
    role: 'assistant', tool: { name: 'edit', path: 'f.js' } } })}\n`);
  const ledger = await sliceLineage([file], { cwd: '/repo' });
  assert.ok(ledger.dropped.some((drop) => drop.reason === 'unknown_schema_files'));
  assert.ok(sessionFromLedger(ledger).adapterGaps.some((gap) => gap.channel === 'identity'));
});

test('one malformed source row amid valid work declares incomplete canonical coverage', async () => {
  const dir = await scratchDir('sonah-corrupt-row-');
  const file = join(dir, 'session.jsonl');
  await writeFile(file, [JSON.stringify(user([{ type: 'text', text: 'Run the test.' }]).raw),
    '{broken', JSON.stringify(call().raw), JSON.stringify(user([result('tool-1', '1 passed')]).raw)].join('\n') + '\n');
  const ledger = await sliceLineage([file], { cwd: '/repo' });
  assert.ok(ledger.dropped.some((drop) => drop.reason === 'unparseable_lines'));
  assert.ok(sessionFromLedger(ledger).adapterGaps.some((gap) => gap.channel === 'identity'));
});
