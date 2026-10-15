// M34 slice-time labels (C-02 "Slice-time labels"). Every record of a session gets
// exactly one label — or one per content block — set once at slicing from the recorder's structure, never its wording;
// a record that cannot be labelled is counted by a closed reason. These tests replace H2's (h2-actor-provenance.test.js,
// deleted with the role guessers it tested).
//
// Every fixture here is synthetic. No real recording is read.

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sliceLineage } from '../index.js';
import { labelClaudeRows, humanWordsOf, CLAUDE_TYPED_LABEL_RECORDER } from '../src/records.js';
import { LABELS, MARKERS, LABEL_BASIS, LABEL_GAPS, LINEAGE_ROLES, COUNT_KEYS, opensTurn, partsOf, labelOf }
  from '../src/labels.js';
import { collectDelegations } from '../src/delegation-records.js';
import { buildEvents, INTERJECTION_KINDS } from '../src/events.js';

let seq = 0;
const uid = () => `m34-${String(++seq).padStart(6, '0')}`;
const base = { sessionId: 'sess-m34', cwd: '/repo', version: '2.1.284', gitBranch: 'main', isSidechain: false,
  parentUuid: 'p' };
const HUMAN = { origin: { kind: 'human' }, promptSource: 'sdk' };
const user = (content, extra = {}) => ({ ...base, type: 'user', uuid: uid(), message: { role: 'user', content }, ...extra });
const ask = (text, extra = {}) => user(text, { ...HUMAN, ...extra });
const said = (text) => ({ ...base, type: 'assistant', uuid: uid(), message: { role: 'assistant',
  content: [{ type: 'text', text }] } });
const call = (id, name, input = {}) => ({ ...base, type: 'assistant', uuid: uid(), message: { role: 'assistant',
  content: [{ type: 'tool_use', id, name, input }] } });
const result = (id, content, extra = {}) => user([{ type: 'tool_result', tool_use_id: id, content,
  ...(extra.is_error ? { is_error: true } : {}) }], extra.row ?? {});
const labelOne = (row) => labelClaudeRows([row])[0];
const slash = (name, args) => `<command-message>${name} is running…</command-message>\n<command-name>/${name}</command-name>`
  + (args === undefined ? '' : `\n<command-args>${args}</command-args>`);

async function slice(rows, { dir: sub = null } = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'slicer-m34-'));
  try {
    const where = sub ? join(dir, sub) : dir;
    await mkdir(where, { recursive: true });
    const file = join(where, 'session.jsonl');
    await writeFile(file, rows.map((r) => JSON.stringify(r)).join('\n') + '\n');
    return await sliceLineage([file]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test('M34: the label, marker, basis, lineage and gap vocabularies are closed, distinct and frozen', () => {
  for (const vocabulary of [LABELS, MARKERS, LABEL_BASIS, LABEL_GAPS, LINEAGE_ROLES]) {
    const values = Object.values(vocabulary);
    assert.equal(new Set(values).size, values.length);
    assert.ok(Object.isFrozen(vocabulary));
  }
  assert.deepEqual(Object.values(LABELS), ['human', 'harness', 'thought', 'action', 'observation', 'peer']);
  assert.deepEqual(Object.values(MARKERS), ['queued', 'answer', 'refusal', 'command', 'attached', 'after_interrupt',
    'compaction']);
  assert.deepEqual(COUNT_KEYS, ['human', 'harness', 'thought', 'action', 'observation', 'peer', 'unlabelled', 'private']);
  assert.deepEqual(CLAUDE_TYPED_LABEL_RECORDER, { field: 'version', oldest: '2.1.219' });
  // A value outside a vocabulary is refused, and an unlabelled record must carry a closed reason (fail closed).
  assert.throws(() => labelOf('person', LABEL_BASIS.originHuman));
  assert.throws(() => labelOf(LABELS.human, 'opening_words'));
  assert.throws(() => labelOf(null, LABEL_BASIS.originHuman));
  assert.throws(() => labelOf(LABELS.human, LABEL_BASIS.originHuman, { markers: ['urgent'] }));
});

test('M34: a typed recorder labels a user row by its typed fields, whatever its words', () => {
  const words = 'Please refactor the parser and keep the public API unchanged.';
  const cases = [
    [ask(words), 'human', LABEL_BASIS.originHuman],
    [user(words, { promptSource: 'typed' }), 'human', LABEL_BASIS.promptSourceHuman],
    [user(words, { origin: { kind: 'task-notification' } }), 'observation', LABEL_BASIS.taskNotification],
    [user(words, { origin: { kind: 'peer' }, isMeta: true }), 'peer', LABEL_BASIS.originPeer],
    [user(words, { origin: { kind: 'coordinator' }, isMeta: true }), 'peer', LABEL_BASIS.originPeer],
    [user(words, { isMeta: true }), 'harness', LABEL_BASIS.recorderMeta],
    [user(words, { sourceToolUseID: 'toolu_1' }), 'harness', LABEL_BASIS.recorderToolRow],
    [user(words, { isCompactSummary: true }), 'harness', LABEL_BASIS.compactSummary],
    // The first prompt of an SDK run: submitted by a script, which stands where the human does.
    [user(words, { parentUuid: null, promptSource: 'sdk' }), 'human', LABEL_BASIS.scriptFirstPrompt],
    // No origin and no flag on a typed recorder: harness — where Claude Code writes its interruption notice, untyped.
    [user(words), 'harness', LABEL_BASIS.untypedUserRow],
    [user([{ type: 'text', text: '[Request interrupted by user]' }]), 'harness', LABEL_BASIS.untypedUserRow],
    // Only top-level elements, no origin: a local command's own rows.
    [user(slash('model', 'opus')), 'harness', LABEL_BASIS.untypedElements],
    [user('<local-command-stdout>Set model to opus</local-command-stdout>'), 'harness', LABEL_BASIS.untypedElements],
  ];
  for (const [row, label, basis] of cases) {
    const rec = labelOne(row);
    assert.deepEqual([rec.label, rec.basis], [label, basis], JSON.stringify(row).slice(0, 160));
  }
  // The untyped row counts toward the interruption gap; its words are never read.
  assert.equal(labelOne(user(words)).gap, LABEL_GAPS.interruptUntyped);
  assert.equal(labelOne(user(words, { origin: { kind: 'stranger' } })).gap, LABEL_GAPS.originUnknown);
  assert.equal(labelOne(user(words, { origin: { kind: 'stranger' } })).label, null);
  // A coordinator's message inside a helper is its parent's.
  const helper = labelOne(user(words, { origin: { kind: 'coordinator' }, isMeta: true, isSidechain: true, agentId: 'a1' }));
  assert.deepEqual([helper.label, helper.basis, helper.lineage], ['human', LABEL_BASIS.fromParentAgent, 'helper']);
});

test('M34: a legacy recorder (or a row of no plain version) is labelled by the declared fallback only; every row it labels is counted', () => {
  for (const version of ['2.1.205', '2.1.218', undefined, 'unknown']) {
    const extra = version === undefined ? { version: undefined } : { version };
    // M34 labels review (F6): a row the fallback reads as the human's is counted too — it is not proven the human's.
    const human = labelOne(user('Fix the parser.', extra));
    assert.deepEqual([human.label, human.basis, human.gap], ['human', LABEL_BASIS.legacyFallback,
      LABEL_GAPS.legacyRecorder], String(version));
    for (const row of [user(slash('review', 'the parser'), extra), user([{ type: 'text', text: 'Fix it.' }], extra),
      user('<system-reminder>x</system-reminder>\nFix it.', extra)]) {
      const harness = labelOne(row);
      assert.deepEqual([harness.label, harness.basis, harness.gap], ['harness', LABEL_BASIS.legacyFallback,
        LABEL_GAPS.legacyRecorder], JSON.stringify(row.message.content));
    }
  }
  // A queued prompt the fallback reads as the human's is counted likewise.
  const queued = labelOne({ ...base, version: '2.1.205', type: 'attachment', uuid: uid(), userType: 'external',
    entrypoint: 'cli', timestamp: 't', attachment: { type: 'queued_command', commandMode: 'prompt', prompt: 'And X.' } });
  assert.deepEqual([queued.label, queued.markers, queued.gap], ['human', ['queued'], LABEL_GAPS.legacyRecorder]);
  // Never mixed into a typed recorder's rows: the same words on 2.1.219 have no origin, so they are not the human's.
  assert.equal(labelOne(user('Fix the parser.', { version: '2.1.219' })).label, 'harness');
  // A typed field still decides on a legacy row.
  assert.equal(labelOne(user('Fix the parser.', { version: '2.1.205', isMeta: true })).basis, LABEL_BASIS.recorderMeta);
});

test('M34: slash commands — a local command is harness, a prompt command the human\'s with its typed arguments', () => {
  // A prompt command the human ran (origin human): human + command; its words are the command and its arguments.
  const prompt = labelOne(ask(slash('review', 'the parser module')));
  assert.deepEqual([prompt.label, prompt.markers, prompt.gap], ['human', ['command'], undefined]);
  assert.equal(humanWordsOf(prompt), '/review the parser module');
  // 2.1.255 and later: the invocation row is isMeta with the recorder's own command elements and no arguments: human +
  // command, its arguments declared unrecorded.
  const meta = labelOne(user('<command-message>review</command-message>\n<command-name>/review</command-name>\n'
    + '<skill-format>true</skill-format>', { isMeta: true }));
  assert.deepEqual([meta.label, meta.basis, meta.markers, meta.gap], ['human', LABEL_BASIS.promptCommand, ['command'],
    LABEL_GAPS.commandArgsUnrecorded]);
  assert.equal(humanWordsOf(meta), '/review');
  // A skill's expansion (isMeta prose) and a local-command caveat stay harness.
  assert.equal(labelOne(user('Review the parser carefully.', { isMeta: true })).label, 'harness');
  assert.equal(labelOne(user('<local-command-caveat>Caveat</local-command-caveat>', { isMeta: true })).label, 'harness');
});

test('M34: assistant blocks, results, answers, refusals and synthetic rows are labelled per block', () => {
  const rows = labelClaudeRows([
    ask('Ask me first.'),
    { ...base, type: 'assistant', uuid: uid(), message: { role: 'assistant', content: [{ type: 'thinking', thinking: 'x' },
      { type: 'text', text: 'One question.' }, { type: 'tool_use', id: 'q1', name: 'AskUserQuestion', input: {} }] } },
    result('q1', 'User answered', { row: { toolUseResult: { questions: [{ question: 'Which?' }], answers: { 'Which?': 'A' } } } }),
    call('b1', 'Bash', { command: 'rm -rf build' }),
    result('b1', 'User rejected tool use', { is_error: true, row: { toolDenialKind: 'user-rejected' } }),
    call('b2', 'Bash', { command: 'ls' }),
    result('b2', 'denied', { is_error: true, row: { toolDenialKind: 'permission-rule' } }),
    { ...base, type: 'assistant', uuid: uid(), message: { role: 'assistant', model: '<synthetic>',
      content: [{ type: 'text', text: 'API Error' }] }, isApiErrorMessage: true },
    { ...base, type: 'system', subtype: 'compact_boundary', uuid: uid() },
  ]);
  assert.deepEqual(rows[1].parts.map((part) => part.private ? 'private' : part.label), ['private', 'thought', 'action']);
  assert.deepEqual([rows[2].label, rows[2].parts[0].markers, rows[2].parts[0].links], ['human', ['answer'], { answerTo: 'q1' }]);
  assert.equal(opensTurn(rows[2]), false, 'an answer is recorded within a turn');
  assert.deepEqual([rows[4].label, rows[4].parts[0].markers, rows[4].parts[0].links], ['human', ['refusal'], { refuses: 'b1' }]);
  assert.equal(opensTurn(rows[4]), false);
  assert.equal(rows[6].label, 'observation', 'a permission rule\'s denial is no human\'s');
  assert.deepEqual([rows[7].label, rows[7].basis], ['harness', LABEL_BASIS.syntheticAssistant]);
  assert.deepEqual([rows[8].label, rows[8].markers], ['harness', ['compaction']]);
});

test('M34: a refusal in a session no human submitted is no human\'s (OWNER DECISION 2026-10-06)', () => {
  const rows = labelClaudeRows([
    user('Run the build.', { parentUuid: null, promptSource: 'sdk' }),
    call('b1', 'Bash', { command: 'make' }),
    result('b1', 'User rejected tool use', { is_error: true, row: { toolDenialKind: 'user-rejected' } }),
  ]);
  assert.equal(rows[2].label, 'observation');
  assert.equal(rows[2].parts[0].markers, undefined);
});

const fileAttachment = (content, parentUuid) => ({ ...base, type: 'attachment', uuid: uid(), parentUuid,
  userType: 'external', entrypoint: 'cli', timestamp: 't',
  attachment: { type: 'file', displayPath: 'docs/spec.md', filename: '/repo/docs/spec.md',
    content: { type: 'text', file: { filePath: '/repo/docs/spec.md', content, numLines: 1, startLine: 1,
      totalLines: 1 } } } });

test('M34: queued prompts, @-mentioned files and peers are read at their rows; a Q2 prompt keeps its turn', async () => {
  const queued = { ...base, type: 'attachment', uuid: uid(), userType: 'external', entrypoint: 'cli', timestamp: 't',
    attachment: { type: 'queued_command', commandMode: 'prompt', prompt: 'Also keep the CLI flags.',
      origin: { kind: 'human' } } };
  // An @-mention: the recorder hangs the file's row from the prompt it was submitted with (its `parentUuid`).
  const prompt = ask('Fix the parser.');
  const attached = fileAttachment('The spec says X.', prompt.uuid);
  const enqueue = { type: 'queue-operation', operation: 'enqueue', content: 'Then ship it.', sessionId: 'sess-m34',
    timestamp: '2026-10-06T10:00:01.000Z' };
  // The agent worked after the prompt was enqueued: an assistant row recorded, and timestamped, after it.
  const ledger = await slice([prompt, attached, call('b1', 'Bash', { command: 'make' }), enqueue,
    result('b1', 'ok'), queued, { ...said('Fixed.'), timestamp: '2026-10-06T10:00:05.000Z' },
    user('Hello from the reviewer agent.', { origin: { kind: 'peer' }, isMeta: true, promptSource: 'system' }),
    ask('Then ship it.')]);
  assert.deepEqual(ledger.interjections.map((entry) => [entry.kind, entry.text]), [
    [INTERJECTION_KINDS.attached, 'The spec says X.'], [INTERJECTION_KINDS.queued, 'Also keep the CLI flags.'],
    [INTERJECTION_KINDS.peer, 'Hello from the reviewer agent.']]);
  // A prompt enqueued while the agent worked and delivered as the next turn opens that turn, marked `queued`.
  assert.deepEqual(ledger.ask.map((entry) => [entry.turn, entry.text, entry.markers]), [[1, 'Fix the parser.', undefined],
    [2, 'Then ship it.', ['queued']]]);
  assert.equal(ledger.capture.labels.peer, 1);
  assert.equal(ledger.capture.labels.human, 4);
});

test('M34 review (F1): a file attachment is the human\'s only when its recorded chain hangs from the human\'s submission', async () => {
  // An @-mention, through another attachment row of the same submission: human + attached.
  const prompt = ask('Add a verbose flag to the CLI.');
  const listing = { ...base, type: 'attachment', uuid: uid(), parentUuid: prompt.uuid, userType: 'external',
    entrypoint: 'cli', timestamp: 't', attachment: { type: 'date', date: '2026-10-06' } };
  const mentioned = fileAttachment('The spec says X.', listing.uuid);
  // After a compaction Claude Code restores the files the agent had read: each hangs from the compaction summary.
  const boundary = { ...base, type: 'system', subtype: 'compact_boundary', uuid: uid(), parentUuid: null,
    content: 'Conversation compacted', compactMetadata: { trigger: 'auto', preTokens: 1 } };
  const summary = user('Summary of earlier work.', { isCompactSummary: true, isVisibleInTranscriptOnly: true,
    parentUuid: boundary.uuid });
  const restored = fileAttachment('// TODO delete the legacy parser', summary.uuid);
  // A file written into the turn after a tool result, one whose parent was never recorded, and a loop: none is human.
  const read = call('r1', 'Read', { file_path: '/repo/src/cli.js' });
  const readResult = { ...result('r1', 'export const flags = [];'), parentUuid: read.uuid };
  const midTurn = fileAttachment('mid-turn', readResult.uuid);
  const orphan = fileAttachment('orphan', 'never-recorded');
  const loopA = fileAttachment('loop', 'loop-b');
  const loopB = { ...fileAttachment('loop', loopA.uuid), uuid: 'loop-b' };
  const rows = labelClaudeRows([prompt, listing, mentioned, read, readResult, midTurn, boundary, summary, restored,
    orphan, loopA, loopB]);
  const byRow = (row) => rows.find((rec) => rec.raw === row);
  assert.deepEqual([byRow(mentioned).label, byRow(mentioned).basis, byRow(mentioned).markers],
    ['human', LABEL_BASIS.attachedFile, ['attached']]);
  for (const row of [restored, midTurn, orphan, loopA, loopB])
    assert.deepEqual([byRow(row).label, byRow(row).basis, byRow(row).markers], ['harness', LABEL_BASIS.attachmentRow,
      undefined], row.attachment.content.file.content);
  // A prompt the human queued (itself an attachment row) is the human's submission too.
  const queued = { ...base, type: 'attachment', uuid: uid(), userType: 'external', entrypoint: 'cli', timestamp: 't',
    attachment: { type: 'queued_command', commandMode: 'prompt', prompt: 'Also read this.', origin: { kind: 'human' } } };
  const withQueued = fileAttachment('queued file', queued.uuid);
  assert.equal(labelClaudeRows([prompt, queued, withQueued]).at(-1).label, 'human');
  // Sliced: the restored file is no instruction; only the @-mention is read at its row.
  const ledger = await slice([prompt, listing, mentioned, read, readResult, boundary, summary, restored,
    said('Continuing.')]);
  assert.deepEqual((ledger.interjections ?? []).map((entry) => [entry.kind, entry.text]),
    [[INTERJECTION_KINDS.attached, 'The spec says X.']]);
});

test('M34: every reader counts turns by the same labels: asks, compaction boundaries and delegation turns agree', async () => {
  const rows = [ask('first'), call('a1', 'Agent', { prompt: 'brief', description: 'd', subagent_type: 'x' }),
    result('a1', 'done'), user('[Request interrupted by user]'), ask('second'), call('a2', 'Agent', { prompt: 'b2',
      description: 'd', subagent_type: 'x' }), result('a2', 'done')];
  const ledger = await slice(rows);
  assert.deepEqual(ledger.ask.map((entry) => entry.turn), [1, 2]);
  assert.deepEqual(collectDelegations(rows.map((raw) => ({ kind: raw.type, raw }))).map((d) => d.turn), [1, 2]);
  // The interruption notice is harness; its session declares interruptions untyped, once per row. No untyped interrupt
  // mark reads its words: its row keeps only the positional mark of its counted gap (M34 labels review, F2).
  assert.deepEqual(ledger.capture.labelGaps, { interrupt_untyped: 1 });
  assert.deepEqual(ledger.marks, [{ turn: 1, kind: 'label_gap', gap: 'interrupt_untyped', beforeEvent: 0, stream: 0,
    record: 4 }]);
});

test('M34: a helper\'s recording is read by its structure, never its path; its brief is its parent\'s', async () => {
  const agent = { isSidechain: true, agentId: 'a0123456789abcdef' };
  const rows = [user('Write the regression test.', { ...agent, parentUuid: null }),
    { ...call('w1', 'Write', { file_path: '/repo/t.js', content: 'x' }), ...agent }, { ...result('w1', 'ok'), ...agent },
    user([{ type: 'text', text: '[Request interrupted by user]' }], agent)];
  for (const dir of [null, 'subagents', 'elsewhere']) {
    const ledger = await slice(rows, { dir });
    assert.equal(ledger.lineage.role, 'helper', String(dir));
    assert.deepEqual(ledger.ask.map((entry) => entry.text), ['Write the regression test.'], String(dir));
    assert.deepEqual(ledger.capture.labelGaps, { interrupt_untyped: 1 });
  }
  const root = await slice([ask('Fix it.')]);
  assert.equal(Object.hasOwn(root.lineage, 'role'), false, 'a root ledger keeps its lineage bytes');
});

test('M34: copied rows are labelled once — a copy carries its first row\'s label and is counted once', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'slicer-m34-copy-'));
  try {
    // M34 labels review (F8): a counted-only row (a harness attachment) is folded by its uuid too.
    const reminder = { ...base, type: 'attachment', uuid: uid(), userType: 'external', entrypoint: 'cli', timestamp: 't',
      attachment: { type: 'date', date: '2026-10-06' } };
    const first = [ask('Fix the parser.'), reminder, said('Done.'),
      user([{ type: 'text', text: '[Request interrupted by user]' }])];
    const files = [join(dir, 'a.jsonl'), join(dir, 'b.jsonl')];
    await writeFile(files[0], first.map((r) => JSON.stringify(r)).join('\n') + '\n');
    await writeFile(files[1], [...first, ask('And the docs.')].map((r) => JSON.stringify(r)).join('\n') + '\n');
    const ledger = await sliceLineage(files);
    assert.equal(ledger.capture.labels.human, 2);
    assert.equal(ledger.capture.labels.thought, 1);
    // The copied reminder is one harness row; the notice is the other.
    assert.equal(ledger.capture.labels.harness, 2);
    // M34 labels review (F2): a copied row's positioned gap is counted once and marked once, so the two agree.
    assert.deepEqual(ledger.capture.labelGaps, { interrupt_untyped: 1 });
    assert.deepEqual(ledger.marks.filter((mark) => mark.kind === 'label_gap').map((mark) => [mark.stream, mark.record]),
      [[0, 4]]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('M34: labels never read wording — the same words take the label their structure gives them', () => {
  const words = '[Request interrupted by user for tool use]';
  assert.equal(labelOne(ask(words)).label, 'human');
  assert.equal(labelOne(user(words)).label, 'harness');
  const built = buildEvents(labelClaudeRows([ask(words), said('ok')]).map((rec) => ({ ...rec, kind: rec.raw.type })));
  assert.deepEqual(built.ask.map((entry) => entry.text), [words]);
  assert.deepEqual(built.marks, []);
});

test('M34: a recording with only typed human asks keeps its ledger bytes but for the label counts', async () => {
  const rows = [ask('Fix the parser.'), call('e1', 'Edit', { file_path: '/repo/p.js', old_string: 'a',
    new_string: 'b' }), result('e1', 'ok'), said('Done.')];
  const ledger = await slice(rows);
  assert.deepEqual(ledger.capture, { labels: { human: 1, harness: 0, thought: 1, action: 1, observation: 1, peer: 0,
    unlabelled: 0, private: 0 } });
  // C-01 event identity (2026-10-07) adds where the recorder wrote it: its row, block and uuid.
  assert.deepEqual(ledger.ask, [{ turn: 1, text: 'Fix the parser.',
    identity: { stream: 0, record: 1, block: 0, native: rows[0].uuid } }]);
  assert.equal(partsOf({ label: 'human', basis: LABEL_BASIS.originHuman }).length, 1);
});

test('M34: a task notification is linked by the call id it carries; one naming no recorded call is counted, one carrying no id is not', async () => {
  const note = (id, extra = {}) => user(`<task-notification>\n<task-id>bg1</task-id>\n${id ? `<tool-use-id>${id}</tool-use-id>\n` : ''}`
    + '<status>completed</status>\n</task-notification>', { origin: { kind: 'task-notification', ...extra } });
  const rows = (notice) => [ask('Build it.'), call('b1', 'Bash', { command: 'make', run_in_background: true }),
    result('b1', 'Command running in background with ID: bg1'), notice];
  // Owner decision 2026-10-07: a notification that carries no call id is an observation with no link and declares no
  // gap; the gap stays only for one whose carried id names a call the recording does not hold.
  for (const [notice, unmatched, notified, why] of [[note('b1'), 0, 1, 'its call is recorded'],
    [note('b1', { from: 'runtime' }), 0, 1, 'whatever else its origin records'],
    [note(null), 0, undefined, 'it carries no call id'], [note('b9'), 1, undefined, 'it names no recorded call']]) {
    const ledger = await slice(rows(notice));
    assert.equal(ledger.capture.labelGaps?.notification_unmatched ?? 0, unmatched, why);
    assert.equal(ledger.capture.labels.observation, 2, why);
    // M34 labels review (F5): the link is set at slicing, on the label, and carried onto the action it names.
    assert.equal(ledger.ledger[0].notified, notified, why);
  }
  const [, , , linked] = labelClaudeRows(rows(note('b1')));
  assert.deepEqual([linked.label, linked.basis, linked.links, linked.gap], ['observation', LABEL_BASIS.taskNotification,
    { notifies: 'b1' }, undefined]);
  // The gap is the label's, set at slicing: on one naming no recorded call, never on one carrying no id.
  const [, , , named] = labelClaudeRows(rows(note('b9')));
  assert.deepEqual([named.label, named.links, named.gap], ['observation', undefined, 'notification_unmatched']);
  const [, , , bare] = labelClaudeRows(rows(note(null)));
  assert.deepEqual([bare.label, bare.links, bare.gap], ['observation', undefined, undefined]);
  // A notification recorded before the call it names carries no link (and the gap); one naming none carries neither.
  assert.deepEqual(['links', 'gap'].map((key) => labelClaudeRows([note('b1'), ...rows(note(null)).slice(0, 3)])[0][key]),
    [undefined, 'notification_unmatched']);
  // A queued notification attachment is linked the same way.
  const queued = { ...base, type: 'attachment', uuid: uid(), userType: 'external', entrypoint: 'cli', timestamp: 't',
    attachment: { type: 'queued_command', commandMode: 'task-notification',
      prompt: '<task-notification>\n<task-id>bg1</task-id>\n<tool-use-id>b1</tool-use-id>\n<status>completed</status>\n</task-notification>' } };
  assert.deepEqual(labelClaudeRows([...rows(note(null)).slice(0, 3), queued]).at(-1).links, { notifies: 'b1' });
  // A copied notification (a resumed recording) is linked and counted once.
  const dir = await mkdtemp(join(tmpdir(), 'slicer-m34-notified-'));
  try {
    const copied = rows(note('b1'));
    const files = [join(dir, 'a.jsonl'), join(dir, 'b.jsonl')];
    await writeFile(files[0], copied.map((r) => JSON.stringify(r)).join('\n') + '\n');
    await writeFile(files[1], [...copied, note('b9')].map((r) => JSON.stringify(r)).join('\n') + '\n');
    const ledger = await sliceLineage(files);
    assert.equal(ledger.ledger[0].notified, 1);
    assert.equal(ledger.capture.labelGaps.notification_unmatched, 1);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('M34: a prompt enqueued and delivered as the next turn is `queued` only when the agent worked after it (by recorded time)', () => {
  const enqueue = (at) => ({ type: 'queue-operation', operation: 'enqueue', content: 'Ship it.', sessionId: 's', timestamp: at });
  const late = { ...said('Done.'), timestamp: '2026-10-06T10:00:05.000Z' };
  const early = { ...said('Done.'), timestamp: '2026-10-06T09:59:00.000Z' };
  const marked = (rows) => labelClaudeRows(rows).at(-1).markers;
  assert.deepEqual(marked([ask('Fix it.'), enqueue('2026-10-06T10:00:01.000Z'), late, ask('Ship it.')]), ['queued']);
  // An assistant row written after the enqueue but timestamped before it: the agent had finished; not queued.
  assert.equal(marked([ask('Fix it.'), enqueue('2026-10-06T10:00:01.000Z'), early, ask('Ship it.')]), undefined);
  // No recorded time: never marked.
  assert.equal(marked([ask('Fix it.'), enqueue(undefined), said('Done.'), ask('Ship it.')]), undefined);
});
