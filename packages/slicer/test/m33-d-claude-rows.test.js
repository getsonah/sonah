// M33 D (C-03, Claude Code row drift): the rows a Claude Code recording writes besides its
// conversation turns, classified by one closed map instead of all landing on the identity channel.
//
//   harness context  — dates, model, tool/skill/agent listings, reminders, memory files, prompt
//                      snapshots, API retry notices. Not T/A/O evidence: scaffold, but COUNTED
//                      (capture.harnessContextRows), never dropped silently.
//   content-bearing  — hook output, files the user or a formatter changed, @-mentioned files,
//                      queued prompts and notifications. Not read yet, so each stays a declared,
//                      counted loss, now on its own channel instead of `identity`. (OWNER DECISION B,
//                      2026-10-01: a queued prompt is now also read as a human instruction; its row
//                      stays counted for the readers of `ask` alone.)
//   anything else    — an unknown type, an unknown payload key, an unknown row key, a wrong value
//                      type: unclassified, exactly as before (fail closed). D128 amends this: such a row is read
//                      by its structure, and is harness context when nothing the lists do not name on it can hold
//                      session content (no string but a token, no conversation carrier, no content block); it stays
//                      unclassified when something can.
//
// Every row here is synthetic and mirrors only the recorder's key sets; no real
// recording is read.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readSession, claudeRowClass, CLAUDE_ROW_CLASSES } from '../src/records.js';
import { sliceLineage, hasCaptureGaps } from '../index.js';
import { redact } from '../../redact/index.js';
import { sessionFromLedger } from '../../evidence/adapters/sonah-ledger.js';

const SESSION = 'b1c2d3e4-0000-4000-8000-00000000d155';
const CHILD = 'a0123456789abcdef';
let uuid = 0;
const row = (extra) => ({ cwd: '/repo', entrypoint: 'claude-desktop', gitBranch: 'main', isSidechain: false,
  parentUuid: null, sessionId: SESSION, timestamp: '2026-09-24T00:00:00Z', userType: 'external',
  uuid: `u-${++uuid}`, version: '2.1.260', ...extra });
const rendered = [{ content: 'Synthetic rendered context.' }];
const attachment = (payload, extra = {}) => row({ type: 'attachment', attachment: payload, ...extra });
// M34 labels: a human's prompt row carries the host's typed origin, as Claude Code 2.1.219 and later records it.
const user = (text) => row({ type: 'user', origin: { kind: 'human' }, message: { role: 'user', content: text } });
const bash = (id) => row({ type: 'assistant', message: { role: 'assistant', content: [
  { type: 'tool_use', id, name: 'Bash', input: { command: 'node --test' } }] } });
const result = (id) => row({ type: 'user', message: { role: 'user', content: [
  { type: 'tool_result', tool_use_id: id, content: 'ℹ pass 1\nℹ fail 0' }] } });

async function recording(t, rows, name = 'session.jsonl') {
  const dir = await mkdtemp(join(tmpdir(), 'sonah-m33-d-rows-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const file = join(dir, name);
  await writeFile(file, rows.map((r) => JSON.stringify(r)).join('\n') + '\n');
  return file;
}
const conversation = (...middle) => [user('Run the tests.'), ...middle, bash('b-1'), result('b-1')];
const gapsOf = async (file) => sessionFromLedger(redact(await sliceLineage([file], { cwd: '/repo' })).ledger).adapterGaps;

// One payload per known harness-context shape, with its optional keys exercised.
const HARNESS = [
  { type: 'total_tokens_reminder', text: 'x' },
  { type: 'silent_turn_reminder', text: 'x' },
  { type: 'batching_reminder_sent', model: 'm', text: 'x', clearAt: 1 },
  { type: 'batching_reminder_sent', model: 'm', text: 'x' },
  { type: 'environment', snapshot: {} },
  { type: 'environment', snapshot: {}, changes: [] },
  { type: 'model', identity: 'm', text: 'x' },
  { type: 'deferred_tools_delta', addedLines: [], addedNames: [], readdedNames: [], removedNames: [],
    wireHiddenNames: [], failedMcpServers: [], needsAuthMcpServers: [], pendingMcpServers: [], surfacedNames: [] },
  { type: 'deferred_tools_delta', addedLines: [], addedNames: [], removedNames: [] },
  { type: 'deferred_tools_record', entries: [], toolInputCopies: [] },
  { type: 'agent_listing_delta', addedLines: [], addedTypes: [], isInitial: true, removedTypes: [], showConcurrencyNote: false },
  { type: 'mcp_instructions_delta', addedBlocks: [], addedNames: [], removedNames: [] },
  { type: 'skill_listing', content: 'x', isInitial: true, names: [], skillCount: 0 },
  { type: 'auto_mode', autoModeConsentFlow: 'x', bashFirst: true, bashFirstSteer: 'x', bypass: false, steerOnly: false },
  { type: 'instructions', files: [] },
  { type: 'instructions', files: [], changed: true, reason: 'x' },
  { type: 'nested_memory', content: 'x', displayPath: 'x', path: 'x' },
  { type: 'session_context', context: 'x' },
  { type: 'date', date: 'x' },
  { type: 'date', date: 'x', changed: true },
  { type: 'date_change', newDate: 'x' },
  { type: 'remote_session_change', commit: 'x', pr: 'x', sendUserFileHint: 'x', url: 'x', managedCommit: 'x', managedPr: 'x' },
  { type: 'prompt_snapshot', systemPrompt: 'x' },
  { type: 'prompt_snapshot', systemPrompt: 'x', cliPrefix: 'x', tools: [], reminderFold: true, contextRendering: 'x',
    echoWireToolInputs: true, inlineTools: [], keptReminders: [], systemTurns: [], toolChangeHeader: 'x' },
  { type: 'ultra_effort_enter', reminderType: 'x' },
  { type: 'ultra_effort_exit' },
  { type: 'thinking_drop', blockHashes: [], clientChange: false, firstReportForThreadInProcess: true, model: 'm',
    newlyDropped: 0, querySource: 'x', requestId: 'x', thinkingBlocksSent: 0, thinkingTurnsSent: 0 },
  { type: 'thinking_stripped', scope: 'x' },
  { type: 'command_permissions', allowedTools: [] },
  { type: 'credential_org', organizationUuid: 'x' },
  { type: 'invoked_skills', skills: [] },
  { type: 'task_reminder', content: [], itemCount: 0 },
  { type: 'todo_reminder', content: [], itemCount: 0 },
];

test('M33 D: every known harness-context attachment is scaffold, counted, and declares no gap', async (t) => {
  const rows = HARNESS.flatMap((payload, index) => [
    attachment(payload, { rendered }),                       // with the rendered block
    attachment(payload, index % 2 ? { slug: 'synthetic-slug' } : {}),   // 2.1.234–2.1.258: no `rendered`
  ]);
  const file = await recording(t, conversation(...rows));
  const parsed = await readSession(file);
  assert.equal(parsed.meta.capture.unclassifiedRows, undefined);
  assert.equal(parsed.meta.capture.harnessContextRows, rows.length);
  assert.equal(parsed.meta.capture.incomplete, false);
  const ledger = await sliceLineage([file], { cwd: '/repo' });
  assert.equal(ledger.capture.harnessContextRows, rows.length);
  assert.equal(hasCaptureGaps(ledger), false);
  assert.deepEqual((await gapsOf(file)).filter((gap) => gap.code === 'unsupported_message'), []);
});

test('M33 D: a harness attachment with an unknown payload key, row key or rendered shape stays unclassified', async (t) => {
  // D128: each unlisted part here can hold session content (a content block, a conversation carrier, words), or the
  // envelope or rendering facts are not the recorder's, or the row is a queued command.
  const drift = [
    attachment({ type: 'total_tokens_reminder', text: 'x', toolUse: { type: 'tool_use', name: 'Edit' } }),   // new payload key
    attachment({ type: 'date', date: 'x' }, { body: { role: 'user', content: 'x' } }),     // new row carrier
    attachment({ type: 'model', identity: 'm', text: 'x' }, { rendered: [{ content: 'x', tool: 'Edit' }] }),
    attachment({ type: 'model', identity: 'm', text: 'x' }, { rendered: 'x' }),
    attachment({ type: 'future_context', text: 'Words of a future context.' }),             // unknown type
    attachment({ type: 'date', date: 'x' }, { userType: 'internal' }),
    attachment({ type: 'queued_command', commandMode: 'prompt', prompt: 'x' }, { renderedInHumanTurn: 'x' }),
    attachment({ type: 'queued_command', commandMode: 'prompt', prompt: 'x' }, { renderedInHumanTurn: true }),
    attachment({ type: 'queued_command', commandMode: 'prompt', prompt: 'x' }, { renderedInHumanTurn: [{ content: 'x', tool: 'y' }] }),
    attachment({ type: 'date', date: 'x' }, { agentId: CHILD }),   // agentId on a non-sidechain row
  ];
  const file = await recording(t, conversation(...drift));
  const parsed = await readSession(file);
  assert.equal(parsed.meta.capture.unclassifiedRows, drift.length);
  assert.equal(parsed.meta.capture.harnessContextRows, undefined);
  assert.ok((await gapsOf(file)).some((gap) => gap.channel === 'identity'
    && gap.code === 'unsupported_message' && gap.count === drift.length));

  // D128: the same kinds of drift with nothing that can hold session content are read by their structure.
  const structural = [
    attachment({ type: 'total_tokens_reminder', text: 'x', toolUse: { name: 'Edit' } }),   // a key of tokens
    attachment({ type: 'future_context', count: 3, id: 'a-1' }),                            // a type of numbers and tokens
    attachment({ type: 'date' }),                                                            // a missing key
  ];
  const read = await readSession(await recording(t, conversation(...structural)));
  assert.equal(read.meta.capture.unclassifiedRows, undefined);
  assert.equal(read.meta.capture.harnessContextRows, structural.length);
  assert.deepEqual(read.meta.structuralRows, [{ kind: 'attachment.date', version: '2.1.260', count: 1 },
    { kind: 'attachment.future_context', version: '2.1.260', count: 1 },
    { kind: 'attachment.total_tokens_reminder', version: '2.1.260', count: 1 }]);
});

test('M33 D: a child row may carry agentId only when it is the recording\'s own single child identity', async (t) => {
  const child = (extra) => ({ ...extra, isSidechain: true, agentId: CHILD });
  const own = [user('Brief.'), bash('b-1'), result('b-1')].map(child);
  const reminder = (agentId) => attachment({ type: 'total_tokens_reminder', text: 'x' },
    { isSidechain: true, agentId, slug: 's', rendered });
  const batching = attachment({ type: 'batching_reminder_sent', model: 'm', text: 'x' }, { isSidechain: true, agentId: CHILD });
  const mine = await recording(t, [...own, reminder(CHILD), batching], `agent-${CHILD}.jsonl`);
  const parsed = await readSession(mine, { sidechainAsMain: true, childRecording: true });
  assert.equal(parsed.meta.capture.unclassifiedRows, undefined);
  assert.equal(parsed.meta.capture.harnessContextRows, 2);
  assert.equal(parsed.records.length, own.length);

  // A different agentId is another agent's row: never this child's scaffold.
  const foreign = await recording(t, [...own, reminder('afedcba9876543210')], `agent-${CHILD}.jsonl`);
  const read = await readSession(foreign, { sidechainAsMain: true });
  assert.equal(read.meta.capture.unclassifiedRows, 1);
  assert.equal(read.meta.capture.harnessContextRows, undefined);
});

test('M33 D: known recording metadata rows are scaffold like the rows already known', async (t) => {
  const meta = [
    { type: 'bridge-session', bridgeSessionId: 'x', lastSequenceNum: 1, ownerAccountUuid: 'x', ownerOrganizationUuid: 'x', sessionId: SESSION },
    { type: 'bridge-session', bridgeSessionId: 'x', lastSequenceNum: 1, sessionId: SESSION },
    { type: 'artifact-autoreact-ledger', accountUuid: 'x', artifacts: [], sessionId: SESSION, v: 1 },
    { type: 'artifact-comment-monitor', artifacts: [], sessionId: SESSION, v: 1 },
    { type: 'frame-link', frameUrl: 'x', path: 'x', sessionId: SESSION, timestamp: 'x', title: 'x' },
    { type: 'last-prompt', leafUuid: 'x', sessionId: SESSION },
    { type: 'queue-operation', operation: 'enqueue', sessionId: SESSION, timestamp: 'x' },
    { type: 'queue-operation', operation: 'remove', sessionId: SESSION, timestamp: 'x' },
  ];
  const file = await recording(t, conversation(...meta));
  const parsed = await readSession(file);
  assert.equal(parsed.meta.capture, undefined);
  assert.equal(hasCaptureGaps(await sliceLineage([file], { cwd: '/repo' })), false);

  const drifted = [
    { type: 'bridge-session', bridgeSessionId: 'x', lastSequenceNum: 1, ownerAccountUuid: 'x', sessionId: SESSION },
    { type: 'artifact-comment-monitor', artifacts: [], sessionId: SESSION, v: 1, message: { role: 'user', content: 'x' } },
    { type: 'queue-operation', operation: 'dequeue', sessionId: SESSION, timestamp: 'x', content: 'x' },
  ];
  const other = await recording(t, conversation(...drifted));
  const read = await readSession(other);
  // D128: the bridge row's key set is not listed, but it holds only tokens: read by its structure, harness context.
  // The dequeue's `content` is a conversation carrier: unclassified.
  assert.equal(read.meta.capture.unclassifiedRows, 1);
  assert.equal(read.meta.capture.harnessContextRows, 1);
  assert.equal(read.meta.capture.unsupportedRowChannels.instructions, 1);
});

test('M33 D: an API retry notice is a counted system notice; other new system subtypes stay unclassified', async (t) => {
  const retry = (extra = {}) => row({ type: 'system', subtype: 'api_error', level: 'error', error: { status: 529 },
    maxRetries: 10, retryAttempt: 1, retryInMs: 500, ...extra });
  const known = [retry(), retry({ source: 'x' }), retry({ slug: 's', source: 'x' })];
  const file = await recording(t, conversation(...known));
  const parsed = await readSession(file);
  assert.equal(parsed.meta.capture.unclassifiedRows, undefined);
  assert.equal(parsed.meta.capture.harnessContextRows, 3);

  const unknown = [
    retry({ content: 'x' }),                         // a content carrier
    retry({ error: 'An error written as words.' }),  // not the typed error object, and words
    row({ type: 'system', subtype: 'informational', content: 'x', isMeta: false, level: 'info', slug: 's' }),
    row({ type: 'system', subtype: 'model_refusal_fallback', content: 'x', isMeta: true, level: 'info' }),
  ];
  const other = await recording(t, conversation(...unknown));
  assert.equal((await readSession(other)).meta.capture.unclassifiedRows, unknown.length);
  // D128: a new subtype with nothing that can hold session content is read by its structure.
  const timed = await readSession(await recording(t, conversation(row({ type: 'system', subtype: 'turn_duration',
    durationMs: 1200, messageCount: 4, isMeta: false }))));
  assert.equal(timed.meta.capture.unclassifiedRows, undefined);
  assert.equal(timed.meta.capture.harnessContextRows, 1);
  assert.deepEqual(timed.meta.structuralRows, [{ kind: 'system.turn_duration', version: '2.1.260', count: 1 }]);
});

test('M33 D: content-bearing attachments are declared on their own channel, never read and never on identity', async (t) => {
  const observed = [
    { type: 'hook_additional_context', content: 'x', hookEvent: 'PostToolUse', hookName: 'x', toolUseID: 'b-1' },
    { type: 'hook_success', command: 'x', content: 'x', durationMs: 1, exitCode: 0, hookEvent: 'PostToolUse',
      hookName: 'x', stderr: '', stdout: '', toolUseID: 'b-1' },
    { type: 'hook_non_blocking_error', command: 'x', durationMs: 1, exitCode: 1, hookEvent: 'PostToolUse',
      hookName: 'x', stderr: '', stdout: '', toolUseID: 'b-1' },
    { type: 'edited_text_file', filename: 'src/a.js', snippet: 'x' },
    { type: 'edited_text_file', filename: 'src/a.js', snippet: 'x', displayPath: 'src/a.js' },
    { type: 'read_truncation_notice', banner: 'x', toolUseID: 'b-1' },
    { type: 'task_status', deltaSummary: 'x', description: 'x', outputFilePath: 'x', status: 'x', taskId: 'x', taskType: 'x' },
    { type: 'structured_output', data: {}, toolUseID: 'b-1' },
    { type: 'queued_command', commandMode: 'task-notification', prompt: '<task-notification></task-notification>' },
  ];
  const instructed = [
    { type: 'file', content: 'x', displayPath: 'x', filename: 'x' },
    { type: 'directory', content: 'x', displayPath: 'x', path: 'x' },
    { type: 'pdf_reference', displayPath: 'x', fileSize: 1, filename: 'x', pageCount: 1 },
    { type: 'compact_file_reference', displayPath: 'x', filename: 'x' },
    { type: 'queued_command', commandMode: 'prompt', prompt: 'x', origin: { kind: 'human' }, source_uuid: 'x', timestamp: 'x' },
  ];
  // M34 labels review (F1): an @-mention's row hangs from the prompt it was submitted with (its recorded `parentUuid`).
  const prompt = user('Run the tests.');
  const rows = [...observed.map((p) => attachment(p)), ...instructed.map((p) => attachment(p, { slug: 's',
    parentUuid: prompt.uuid })),
    attachment({ type: 'queued_command', commandMode: 'prompt', prompt: 'x' }, { rendered, renderedInHumanTurn: rendered })];
  const file = await recording(t, [prompt, ...rows, bash('b-1'), result('b-1')]);
  const parsed = await readSession(file);
  assert.equal(parsed.meta.capture.unclassifiedRows, undefined);
  // Release fix 3b (2026-10-12): the two rows the labeller gives to the harness — the compaction's file reference and
  // the queued prompt with no origin on a typed recorder — are harness context, no instructions loss.
  assert.equal(parsed.meta.capture.harnessContextRows, 2);
  // D150 amends this test: a queued task notification is read by its typed status, as one written as a user row is, and
  // is no declared loss.
  assert.deepEqual(parsed.meta.capture.unsupportedRowChannels,
    { instructions: instructed.length + 1 - 2, commentary: 0, actions: 0, observations: observed.length - 1 });
  const ledger = await sliceLineage([file], { cwd: '/repo' });
  assert.equal(hasCaptureGaps(ledger), true);
  const gaps = await gapsOf(file);
  const unsupported = (channel) => gaps.filter((gap) => gap.code === 'unsupported_message' && gap.channel === channel)
    .reduce((n, gap) => n + gap.count, 0);
  assert.equal(unsupported('identity'), 0);
  assert.equal(unsupported('observations'), observed.length - 1);
  // OWNER DECISION B (2026-10-01) amends this test: a queued prompt the human submitted is read as an in-turn human
  // instruction at its row. M34 labels: so is a file or directory the human attached (an @-mention that records text;
  // a PDF reference records none and a compaction's file reference is the harness's); a queued prompt with no origin on
  // a typed recorder is not provably the human's, and is not read. The slicer still counts every such row (a reader of
  // `ask` alone has not read them, above); the evidence adapter, which reads them, declares only the rest.
  // Release fix 3b: and the harness's two are counted as harness context above, so only the PDF reference is left.
  assert.equal(unsupported('instructions'), instructed.length + 1 - 2 - 3);
  assert.deepEqual(ledger.interjections.map((i) => [i.kind, i.text]), [['attached', 'x'], ['attached', 'x'],
    ['queued', 'x']]);
  // Not read: no other attachment text became an instruction or an observation, and no queued prompt became an ask.
  assert.deepEqual(ledger.ask.map((a) => a.text), ['Run the tests.']);

  // An unknown commandMode is not a queued prompt or notification.
  const odd = await recording(t, conversation(attachment({ type: 'queued_command', commandMode: 'bash', prompt: 'x' })));
  assert.equal((await readSession(odd)).meta.capture.unclassifiedRows, 1);
});

test('M33 D: the row classifier is pure and closed', () => {
  assert.deepEqual(claudeRowClass(attachment({ type: 'date', date: 'x' })), { cls: CLAUDE_ROW_CLASSES.harness, agentId: null });
  assert.deepEqual(claudeRowClass(attachment({ type: 'file', content: 'x', displayPath: 'x', filename: 'x' },
    { isSidechain: true, agentId: CHILD })), { cls: CLAUDE_ROW_CLASSES.instructions, agentId: CHILD });
  assert.deepEqual(claudeRowClass(attachment({ type: 'queued_command', commandMode: 'task-notification', prompt: 'x' })),
    { cls: CLAUDE_ROW_CLASSES.observations, agentId: null });
  assert.deepEqual(claudeRowClass({ type: 'last-prompt', leafUuid: 'x', sessionId: SESSION }), { cls: CLAUDE_ROW_CLASSES.metadata, agentId: null });
  for (const value of [null, [], 'x', attachment({ type: 'date', date: 'x', extra: 'two words' }),
    { type: 'future-row', note: 'two words' }, { type: 'future-row', message: {} }])
    assert.equal(claudeRowClass(value), null);
  // D128: read by its structure when nothing unlisted can hold session content.
  assert.deepEqual(claudeRowClass(attachment({ type: 'date', date: 'x', extra: 1 })),
    { cls: CLAUDE_ROW_CLASSES.harness, agentId: null, structural: 'attachment.date' });
  assert.deepEqual(claudeRowClass({ type: 'future-row' }), { cls: CLAUDE_ROW_CLASSES.harness, agentId: null,
    structural: 'future-row' });
  assert.ok(Object.isFrozen(CLAUDE_ROW_CLASSES));
});
