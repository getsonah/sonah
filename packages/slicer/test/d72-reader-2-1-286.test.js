// D72 (2026-10-09, M43 reader): Claude Code 2.1.286+ attachment rows. From 2.1.286 the recorder adds the row keys
// `renderedRole` and `renderedBesideToolResult`, and from 2.1.286–2.1.293 the `queued_command` payload keys
// `delivery_id`, `reminderId`, `runId`, the `agent_listing_delta` payload key `builtInTypes` and, on a `queue-operation`
// removal, `commandUuid` and `deliveryId`. The reader listed none
// of them, so every such row was unclassified: queued human prompts, @-mentioned files and the project's instruction
// files went unread. They are now listed as data (records.js CLAUDE_ATTACHMENTS, CLAUDE_RENDERED_ROLES); the label of
// every row is still decided by the existing typed fields only (`attachment.type`, `commandMode`, `origin`, `isMeta`,
// the `parentUuid` chain), never by `renderedRole`; a shape the reader does not list stays unclassified and declared.
//
// Every row here is synthetic and mirrors only the recorder's key sets; no real
// recording is read and nothing here holds a secret.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sliceLineage, SLICE_REASONS } from '../index.js';
import { readSession, claudeRowClass, labelClaudeRows, CLAUDE_ROW_CLASSES, CLAUDE_RENDERED_ROLES } from '../src/records.js';
import { INTERJECTION_KINDS } from '../src/events.js';
import { redact } from '../../redact/index.js';
import { sessionFromLedger } from '../../evidence/adapters/sonah-ledger.js';

const SESSION = 'd72d72d7-0000-4000-8000-000000000286';
const CHILD = 'a0123456789abcdef';
let seq = 0;
const uid = () => `d72-${String(++seq).padStart(6, '0')}`;
const RENDERED = [{ content: 'Synthetic rendered context.' }];
const NEW = { renderedRole: 'system', rendered: RENDERED };
const row = (extra) => ({ cwd: '/repo', entrypoint: 'cli', gitBranch: 'main', isSidechain: false, parentUuid: null,
  sessionId: SESSION, timestamp: '2026-10-09T10:00:00.000Z', userType: 'external', uuid: uid(), version: '2.1.286',
  ...extra });
const attachment = (payload, extra = {}) => row({ type: 'attachment', attachment: payload, ...NEW, ...extra });
const ask = (text, extra = {}) => row({ type: 'user', origin: { kind: 'human' }, promptSource: 'typed',
  message: { role: 'user', content: text }, ...extra });
const said = (text, extra = {}) => row({ type: 'assistant', message: { role: 'assistant',
  content: [{ type: 'text', text }] }, ...extra });
const call = (id, input) => row({ type: 'assistant', message: { role: 'assistant',
  content: [{ type: 'tool_use', id, name: 'Bash', input }] } });
const result = (id, content) => row({ type: 'user', message: { role: 'user',
  content: [{ type: 'tool_result', tool_use_id: id, content }] } });

/** A human prompt queued while the agent worked, in the known 2.1.286 shape. */
const queuedPrompt = (prompt, extra = {}) => attachment({ type: 'queued_command', commandMode: 'prompt', prompt,
  delivery_id: 'dlv-1', origin: { kind: 'human' }, source_uuid: 'src-1', timestamp: '2026-10-09T10:00:02.000Z' },
{ renderedInHumanTurn: RENDERED, ...extra });
/** A file the human @-mentioned, hung from the prompt it was submitted with. */
const attachedFile = (content, parentUuid, extra = {}) => attachment({ type: 'file', displayPath: 'docs/spec.md',
  filename: '/repo/docs/spec.md', content: { type: 'text', file: { filePath: '/repo/docs/spec.md', content,
    numLines: 1, startLine: 1, totalLines: 1 } } }, { parentUuid, ...extra });
const PROJECT_RULES = '# Project rules\nNever add a runtime dependency.';
/** A file under the harness home folders that the recorder typed `Project`, spelled as the slicer spells a path outside
 *  the working directory. */
const HARNESS_PROJECT_FILE = '/synthetic/machine/.claude/CLAUDE.md';
/** The harness giving the agent its instruction files (rendered `user`, as recorded). */
const instructionFiles = (extra = {}) => attachment({ type: 'instructions', files: [
  { path: '/repo/CLAUDE.md', type: 'Project', content: PROJECT_RULES },
  { path: '/synthetic/machine/.claude/CLAUDE.md', type: 'Project', content: 'A harness home file.' },
  { path: '/synthetic/machine/.claude/projects/repo/memory/MEMORY.md', type: 'AutoMem', content: 'A private memory line.' }] },
{ renderedRole: 'user', ...extra });

async function recording(t, rows) {
  const dir = await mkdtemp(join(tmpdir(), 'slicer-d72-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const file = join(dir, `${SESSION}.jsonl`);
  await writeFile(file, rows.map((r) => JSON.stringify(r)).join('\n') + '\n');
  return file;
}
const slice = async (t, rows) => sliceLineage([await recording(t, rows)], { cwd: '/repo' });
const kindsAndText = (ledger) => (ledger.interjections ?? []).map((entry) => [entry.kind, entry.text]);

// One payload per known 2.1.286–2.1.293 harness shape that carries a new key, with `renderedRole` set.
const HARNESS_2_1_286 = [
  [{ type: 'total_tokens_reminder', text: 'x' }, {}],
  [{ type: 'agent_listing_delta', addedLines: [], addedTypes: [], builtInTypes: ['general'], isInitial: true,
    removedTypes: [], showConcurrencyNote: false }, {}],
  [{ type: 'session_context', context: 'x' }, { renderedRole: 'user' }],
  [{ type: 'remote_session_change', commit: 'x', pr: 'x', sendUserFileHint: 'x', url: 'x', managedCommit: 'x',
    managedPr: 'x' }, { renderedRole: 'user', renderedBesideToolResult: true }],
  [{ type: 'queued_command', commandMode: 'prompt', prompt: 'x', isMeta: true, reminderId: 'r-1',
    origin: { kind: 'peer' }, delivery_id: 'd-1', source_uuid: 's', timestamp: 't' }, {}],
  [{ type: 'queued_command', commandMode: 'task-notification', prompt: 'x', runId: 'run-1', delivery_id: 'd-2',
    origin: { kind: 'task-notification' }, source_uuid: 's', timestamp: 't' }, {}],
];

test('D72: the 2.1.286+ keys are listed as data: each known shape is classified, and renderedRole is closed', () => {
  assert.deepEqual(CLAUDE_RENDERED_ROLES, ['system', 'user']);
  assert.ok(Object.isFrozen(CLAUDE_RENDERED_ROLES));
  for (const [payload, extra] of HARNESS_2_1_286)
    assert.ok(claudeRowClass(attachment(payload, extra)) !== null, payload.type);
  assert.equal(claudeRowClass(attachment(HARNESS_2_1_286[0][0])).cls, CLAUDE_ROW_CLASSES.harness);
  assert.equal(claudeRowClass(queuedPrompt('x')).cls, CLAUDE_ROW_CLASSES.instructions);
  assert.equal(claudeRowClass(attachedFile('x', 'p')).cls, CLAUDE_ROW_CLASSES.instructions);
  assert.equal(claudeRowClass(instructionFiles()).cls, CLAUDE_ROW_CLASSES.harness);
  // The same rows of an older recorder, without the new keys, classify exactly as before.
  const older = ({ renderedRole: _r, renderedBesideToolResult: _b, ...rest }) => ({ ...rest, version: '2.1.284' });
  assert.equal(claudeRowClass(older(attachment({ type: 'total_tokens_reminder', text: 'x' }))).cls,
    CLAUDE_ROW_CLASSES.harness);
});

test('D72: a 2.1.286 queued human prompt is human + queued and read at its row', async (t) => {
  const prompt = ask('Fix the parser.');
  const rows = [prompt, call('b1', { command: 'make' }), result('b1', 'ok'),
    queuedPrompt('Also keep the CLI flags.'), said('Fixed.', { timestamp: '2026-10-09T10:00:05.000Z' })];
  const labelled = labelClaudeRows(rows);
  assert.deepEqual([labelled[3].label, labelled[3].markers], ['human', ['queued']]);
  const ledger = await slice(t, rows);
  assert.deepEqual(kindsAndText(ledger), [[INTERJECTION_KINDS.queued, 'Also keep the CLI flags.']]);
  assert.equal(ledger.capture?.unclassifiedRows ?? 0, 0);
  // The evidence adapter reads it as the human's own instruction, beside the opening ask.
  const session = sessionFromLedger(redact(ledger).ledger, { sessionKey: 'd72' });
  const humans = session.events.filter((event) => event.kind === 'instruction' && event.authority === 'human');
  assert.deepEqual(humans.length, 2);
});

test('D72: a 2.1.286 sidechain attachment with agentId, slug and renderedRole belongs only to its own helper', async (t) => {
  const helper = { isSidechain: true, agentId: CHILD };
  const own = [ask('Check the parser.', { ...helper, origin: { kind: 'coordinator' } }),
    said('Checked.', helper)];
  const reminder = (agentId) => attachment({ type: 'total_tokens_reminder', text: 'Synthetic reminder.' },
    { ...helper, agentId, slug: 'synthetic-helper' });
  assert.deepEqual(claudeRowClass(reminder(CHILD)), { cls: CLAUDE_ROW_CLASSES.harness, agentId: CHILD });
  const mine = await readSession(await recording(t, [...own, reminder(CHILD)]), { childRecording: true });
  assert.equal(mine.meta.sourceIdentity.childId, CHILD);
  assert.equal(mine.meta.capture.harnessContextRows, 1);
  assert.equal(mine.meta.capture.unclassifiedRows ?? 0, 0);
  assert.deepEqual(mine.records.map((rec) => rec.raw.uuid), own.map((r) => r.uuid));

  const foreign = await readSession(await recording(t, [...own, reminder('afedcba9876543210')]),
    { childRecording: true });
  assert.equal(foreign.meta.sourceIdentity.identityConflict, true);
  assert.equal(foreign.meta.capture.unclassifiedRows, 1);
  assert.equal(foreign.meta.capture.harnessContextRows ?? 0, 0);
  assert.deepEqual(foreign.records, [], 'an attachment of another helper cannot establish this helper\'s identity');
  assert.ok(foreign.meta.capture.reasons.includes(SLICE_REASONS.CHILD_HISTORY_UNCHECKED));
});

test('D72: a 2.1.286 helper queued_command with coordinator origin is its parent\'s instruction', async (t) => {
  const helper = { isSidechain: true, agentId: CHILD };
  const queued = queuedPrompt('Also check the CLI flags.', { ...helper, slug: 'synthetic-helper' });
  queued.attachment.origin = { kind: 'coordinator' };
  const rows = [ask('Check the parser.', { ...helper, origin: { kind: 'coordinator' } }), queued,
    said('Checked.', helper)];
  const labelled = labelClaudeRows(rows);
  assert.deepEqual([labelled[1].label, labelled[1].markers, labelled[1].basis, labelled[1].lineage],
    ['human', ['queued'], 'from_parent_agent', 'helper']);
  const ledger = await slice(t, rows);
  assert.equal(ledger.lineage.role, 'helper');
  assert.deepEqual(ledger.ask.map((entry) => entry.text), ['Check the parser.']);
  assert.deepEqual(kindsAndText(ledger), [[INTERJECTION_KINDS.queued, 'Also check the CLI flags.']]);
  assert.equal(ledger.capture?.unclassifiedRows ?? 0, 0);
});

test('D72: a 2.1.286 @-mentioned file is human + attached; one the recorder restored is harness', async (t) => {
  const prompt = ask('Add a verbose flag.');
  const mentioned = attachedFile('The spec says X.', prompt.uuid);
  const summary = row({ type: 'user', isCompactSummary: true, isVisibleInTranscriptOnly: true,
    message: { role: 'user', content: 'Summary of earlier work.' } });
  const restored = attachedFile('restored file', summary.uuid);
  const rows = [prompt, mentioned, said('Reading it.'), summary, restored, said('Continuing.')];
  const labelled = labelClaudeRows(rows);
  assert.deepEqual([labelled[1].label, labelled[1].markers], ['human', ['attached']]);
  assert.deepEqual([labelled[4].label, labelled[4].markers], ['harness', undefined]);
  const ledger = await slice(t, rows);
  assert.deepEqual(kindsAndText(ledger), [[INTERJECTION_KINDS.attached, 'The spec says X.']]);
});

test('D72: a 2.1.286 instruction attachment shows the files the recorder typed Project (D71 g), never human', async (t) => {
  // D90 (owner decision 2026-10-15): one under the harness home folders is shown too (D69 b withheld it); the recorder's
  // type alone decides (a memory file, typed AutoMem, is no project instruction file).
  const rows = [ask('Run the tests.'), instructionFiles(), call('b1', { command: 'npm test' }), result('b1', 'ok')];
  const labelled = labelClaudeRows(rows);
  assert.equal(labelled[1].label, 'harness', 'rendered `user`, still the harness');
  const ledger = await slice(t, rows);
  assert.deepEqual((ledger.projectInstructions ?? []).map((entry) => [entry.path, entry.text]),
    [['CLAUDE.md', PROJECT_RULES], [HARNESS_PROJECT_FILE, 'A harness home file.']]);
  assert.equal(ledger.capture.labels.human, 1);
  assert.equal(ledger.capture?.unclassifiedRows ?? 0, 0);
});

test('D72: a 2.1.286 nested_memory shows only the files typed Project and keeps its harness label', async (t) => {
  const nested = (path, type, content) => attachment({ type: 'nested_memory', path, displayPath: path,
    content: { path, type, content } }, { renderedRole: 'user' });
  const rows = [ask('Check the parser.'), nested('/repo/CLAUDE.md', 'Project', PROJECT_RULES),
    nested('/synthetic/machine/.claude/CLAUDE.md', 'Project', 'A harness home file.'),
    nested('/repo/memory/MEMORY.md', 'AutoMem', 'A synthetic memory line.'), said('Checked.')];
  for (const r of rows.filter((r) => r.type === 'attachment')) {
    assert.equal(claudeRowClass(r).cls, CLAUDE_ROW_CLASSES.harness);
    assert.equal(labelClaudeRows([r])[0].label, 'harness');
  }
  const ledger = await slice(t, rows);
  assert.deepEqual((ledger.projectInstructions ?? []).map((entry) => [entry.path, entry.text]),
    [['CLAUDE.md', PROJECT_RULES], [HARNESS_PROJECT_FILE, 'A harness home file.']]);
  assert.deepEqual(kindsAndText(ledger), []);
  assert.equal(ledger.capture.labels.human, 1);
  assert.equal(ledger.capture?.unclassifiedRows ?? 0, 0);
});

test('D72: renderedRole never decides a label or what is read: system, user and absent slice alike', async (t) => {
  const prompt = ask('Fix it.');
  const base = [prompt, queuedPrompt('And this.'), attachedFile('X.', prompt.uuid), instructionFiles()];
  const rows = (role) => base.map((r) => {
    const { renderedRole: _role, ...rest } = r;
    return r.type !== 'attachment' || role === null ? rest : { ...rest, renderedRole: role };
  });
  const labels = (list) => labelClaudeRows(list).map((rec) => [rec.label, rec.markers ?? null]);
  const user = labels(rows('user'));
  assert.deepEqual(labels(rows('system')), user);
  assert.deepEqual(labels(rows(null)), user);
  assert.deepEqual(user.slice(1), [['human', ['queued']], ['human', ['attached']], ['harness', null]]);
  const read = ({ interjections, projectInstructions }) => ({ interjections, projectInstructions });
  const baseline = read(await slice(t, rows('user')));
  assert.deepEqual(kindsAndText(baseline), [[INTERJECTION_KINDS.queued, 'And this.'], [INTERJECTION_KINDS.attached, 'X.']]);
  assert.deepEqual(baseline.projectInstructions.map((entry) => [entry.path, entry.text]),
    [['CLAUDE.md', PROJECT_RULES], [HARNESS_PROJECT_FILE, 'A harness home file.']]);
  assert.deepEqual(read(await slice(t, rows('system'))), baseline);
  assert.deepEqual(read(await slice(t, rows(null))), baseline);
});

test('D72: a shape the reader does not list stays unclassified and declared, never read and never guessed', async (t) => {
  const prompt = ask('Fix the parser.');
  const unread = [
    // A role outside the closed vocabulary.
    queuedPrompt('Unknown role.', { renderedRole: 'assistant' }),
    // A role with no rendered blocks.
    attachment({ type: 'total_tokens_reminder', text: 'x' }, { rendered: undefined }),
    // A placement that is not a boolean.
    attachment({ type: 'remote_session_change', commit: 'x', pr: 'x', sendUserFileHint: 'x', url: 'x' },
      { renderedBesideToolResult: 'yes' }),
    // D150 amends this list: the coordinator reminder with no `commandMode` but `isMeta: true` is the harness's (below).
    // A payload key not known.
    attachment({ type: 'queued_command', commandMode: 'prompt', prompt: 'Future key.', origin: { kind: 'human' },
      futureKey: 1 }),
  ];
  for (const r of unread) assert.equal(claudeRowClass(JSON.parse(JSON.stringify(r))), null);
  const ledger = await slice(t, [prompt, call('b1', { command: 'make' }), result('b1', 'ok'), ...unread,
    said('Done.')]);
  assert.deepEqual(kindsAndText(ledger), [], 'no unclassified prompt is read as the human\'s');
  assert.equal(ledger.capture.incomplete, true);
  assert.ok(ledger.capture.reasons.includes(SLICE_REASONS.CAPTURE_INCOMPLETE));
  assert.equal(ledger.capture.unclassifiedRows, unread.length);
  // D150: a queued command with no `commandMode` that the recorder flagged `isMeta: true` (the coordinator's reminder) is
  // the harness's, as every `isMeta` queued command is (Release fix 3b): harness context, never read as anyone's words.
  // With no `isMeta`, or with one that is not `true`, it stays unclassified.
  const reminder = (extra = {}) => attachment({ type: 'queued_command', isMeta: true, origin: { kind: 'coordinator' },
    prompt: 'x', reminderId: 'r', source_uuid: 's', ...extra });
  assert.deepEqual(claudeRowClass(JSON.parse(JSON.stringify(reminder()))), { cls: 'harness', agentId: null });
  for (const other of [reminder({ isMeta: false }), reminder({ isMeta: 'true' }),
    reminder({ isMeta: undefined, reminderId: undefined })])
    assert.equal(claudeRowClass(JSON.parse(JSON.stringify(other))), null, JSON.stringify(other.attachment.isMeta));
  const meta = await slice(t, [prompt, call('b1', { command: 'make' }), result('b1', 'ok'), reminder(), said('Done.')]);
  assert.deepEqual(kindsAndText(meta), []);
  assert.deepEqual([meta.capture.unclassifiedRows, meta.capture.harnessContextRows], [undefined, 1]);
});

test('D72: the new keys add no decision: a 2.1.286 recording slices as the same rows without them', async (t) => {
  const build = (fresh) => {
    seq = 1000;
    const strip = (r) => {
      if (fresh || r.type !== 'attachment') return r;
      const { renderedRole: _r, renderedBesideToolResult: _b, ...rest } = r;
      const { delivery_id: _d, runId: _u, reminderId: _m, builtInTypes: _t, ...payload } = rest.attachment;
      return { ...rest, attachment: payload };
    };
    const prompt = ask('Fix the parser.');
    return [prompt, attachedFile('The spec says X.', prompt.uuid), instructionFiles(), call('b1', { command: 'make' }),
      result('b1', 'ok'), queuedPrompt('Also keep the flags.'), said('Fixed.', { timestamp: '2026-10-09T10:00:05.000Z' })]
      .map(strip);
  };
  // Everything but the temporary file's own path (`lineage.files`).
  const ledgerOf = async (rows) => { const ledger = await slice(t, rows); return { ...ledger,
    lineage: { ...ledger.lineage, files: ledger.lineage.files.length } }; };
  assert.deepEqual(await ledgerOf(build(true)), await ledgerOf(build(false)));
});

test('D72: a 2.1.286 queue removal naming its delivery is bookkeeping; any other new key stays unclassified', async (t) => {
  const remove = (extra = {}) => ({ type: 'queue-operation', operation: 'remove', content: 'Also keep the CLI flags.',
    reason: 'absorbed_mid_turn', commandUuid: 'src-1', deliveryId: 'dlv-1', sessionId: SESSION,
    timestamp: '2026-10-09T10:00:03.000Z', ...extra });
  assert.equal(claudeRowClass(remove()).cls, CLAUDE_ROW_CLASSES.metadata);
  for (const odd of [remove({ futureKey: 'x' }), remove({ deliveryId: 7 }), remove({ operation: 'enqueue' }),
    (({ reason: _r, ...rest }) => rest)(remove())])
    assert.equal(claudeRowClass(odd), null);
  // The removal follows the queued command it absorbed (recorded order); the prompt is still read once, as queued.
  const rows = [ask('Fix the parser.'), call('b1', { command: 'make' }), result('b1', 'ok'),
    queuedPrompt('Also keep the CLI flags.'), remove(), said('Fixed.', { timestamp: '2026-10-09T10:00:05.000Z' })];
  const ledger = await slice(t, rows);
  assert.deepEqual(kindsAndText(ledger), [[INTERJECTION_KINDS.queued, 'Also keep the CLI flags.']]);
  assert.equal(ledger.capture?.unclassifiedRows ?? 0, 0);
  assert.deepEqual(ledger.ask.map((entry) => entry.text), ['Fix the parser.']);
});

test('D72 (R1R review): reminderId and runId are read only beside the structure recorded with them; a human prompt carrying either stays unclassified and unread', async (t) => {
  // As Claude Code 2.1.286 records them: `reminderId` only on a queued command flagged `isMeta: true`, `runId` only on
  // a task notification.
  assert.notEqual(claudeRowClass(attachment(HARNESS_2_1_286[4][0])), null);
  assert.equal(claudeRowClass(attachment(HARNESS_2_1_286[5][0])).cls, CLAUDE_ROW_CLASSES.observations);
  const prompt = ask('Fix the parser.');
  const unread = [
    // A prompt of human origin delivered by a reminder (no `isMeta`): it would be labelled human + queued.
    queuedPrompt('Delivered by a reminder.'),
    // The same with `isMeta` present but not the known `true`.
    queuedPrompt('Delivered by a reminder, odd flag.'),
    // A prompt of human origin delivered by a workflow run.
    queuedPrompt('Delivered by a run.'),
    // A run id beside a flagged prompt: still not a task notification.
    queuedPrompt('Flagged run.'),
  ];
  Object.assign(unread[0].attachment, { reminderId: 'r-2' });
  Object.assign(unread[1].attachment, { reminderId: 'r-3', isMeta: 1 });
  Object.assign(unread[2].attachment, { runId: 'run-2' });
  Object.assign(unread[3].attachment, { runId: 'run-3', isMeta: true });
  for (const r of unread) assert.equal(claudeRowClass(r), null);
  const ledger = await slice(t, [prompt, call('b1', { command: 'make' }), result('b1', 'ok'), ...unread,
    said('Done.', { timestamp: '2026-10-09T10:00:05.000Z' })]);
  assert.deepEqual(kindsAndText(ledger), [], 'no reminder- or run-delivered prompt is read as the human\'s');
  assert.equal(ledger.capture.unclassifiedRows, unread.length);
  assert.ok(ledger.capture.reasons.includes(SLICE_REASONS.CAPTURE_INCOMPLETE));
});
