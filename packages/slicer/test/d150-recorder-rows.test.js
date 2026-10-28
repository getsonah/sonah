// D150: read every row current Claude Code writes, by its recorder structure. Claude Code 2.1.303 and later record each
// model request: `api-request` (digests, parameters, hash lists), `api-request-shape` (the request's system prompt and
// tools) and `api-request-blob` (one message of a request). A helper's request rows carry its agentId and no
// `isSidechain`, so the reader refused that agentId and every such row was "a form Sonah cannot read"; the shape row,
// harness context, was unread too; and the labeller returned no label at all for any row outside user, assistant,
// system and attachment rows.
//
//   - a row that records no `isSidechain` may carry an agentId; it is the recording's own only when that agentId is
//     the recording's single child identity, as for every other row (a recorded `false` beside it stays refused);
//   - an `api-request-shape` row of its recorded form is harness context, listed by its keys;
//   - the labeller labels every row: one outside the conversation by the class its reader gives it, harness or no
//     label under the closed gap `unknown_row`, never null.
//
// Every row is synthetic; no recording is read and no model is called.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readSession, claudeRowClass, claudeLabeller, labelClaudeRows } from '../src/records.js';
import { sliceLineage } from '../index.js';
import { LABELS, LABEL_BASIS, LABEL_GAPS } from '../src/labels.js';
import { RECORDER_ROWS as D128_ROWS } from './d128-recorder-rows-fixture.js';
import { RECORDER_ROWS, SESSION, CHILD, apiRequest, apiRequestShape, apiRequestBlob } from './d150-recorder-rows-fixture.js';

let seq = 0;
const envelope = (extra) => ({ cwd: '/repo', entrypoint: 'cli', gitBranch: 'main', isSidechain: false, parentUuid: null,
  sessionId: SESSION, timestamp: '2026-10-24T10:00:00.000Z', userType: 'external', uuid: `d150-t-${++seq}`,
  version: '2.1.308', ...extra });
const ask = (text) => envelope({ type: 'user', origin: { kind: 'human' }, promptSource: 'typed',
  message: { role: 'user', content: text } });
const bash = (id, extra = {}) => envelope({ type: 'assistant', ...extra, message: { role: 'assistant', content: [
  { type: 'tool_use', id, name: 'Bash', input: { command: 'node --test' } }] } });
const result = (id, extra = {}) => envelope({ type: 'user', ...extra, message: { role: 'user', content: [
  { type: 'tool_result', tool_use_id: id, content: 'pass 1\nfail 0' }] } });
/** A helper's own rows: `isSidechain: true` and its agentId, its brief first. */
const helper = (agentId = CHILD) => [envelope({ type: 'user', isSidechain: true, agentId,
  message: { role: 'user', content: 'Run the tests and report.' } }),
bash('h-1', { isSidechain: true, agentId }), result('h-1', { isSidechain: true, agentId })];

async function recording(t, rows, name = `${SESSION}.jsonl`) {
  const dir = await mkdtemp(join(tmpdir(), 'slicer-d150-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const file = join(dir, name);
  await writeFile(file, rows.map((r) => JSON.stringify(r)).join('\n') + '\n');
  return file;
}

test('D150: a helper\'s request rows (its agentId, no isSidechain) are its harness context', async (t) => {
  const rows = [...helper(), apiRequest({ agentId: CHILD }), apiRequestShape({ agentId: CHILD }),
    apiRequest({ agentId: CHILD })];
  const file = await recording(t, rows, `agent-${CHILD}.jsonl`);
  const { meta, records } = await readSession(file, { sidechainAsMain: true, childRecording: true });
  assert.deepEqual([meta.capture.incomplete, meta.capture.unclassifiedRows, meta.capture.harnessContextRows],
    [false, undefined, 3]);
  assert.equal(records.length, 3, 'the helper\'s own rows stay its records');
  assert.equal(meta.sourceIdentity.childId, CHILD);
  // The census names the two `api-request` rows (read by their structure), never the listed shape row.
  assert.deepEqual(meta.structuralRows, [{ kind: 'api-request', version: '2.1.308', count: 2 }]);
  const ledger = await sliceLineage([file], { sidechainAsMain: true, childRecording: true, includeSources: true });
  assert.deepEqual([ledger.capture.unclassifiedRows, ledger.capture.harnessContextRows], [undefined, 3]);
});

test('D150: an agentId with no isSidechain is admitted only as the recording\'s own child identity', async (t) => {
  const refused = [
    apiRequest({ agentId: 'aotheragent000000' }),        // another agent's: two child identities, none admitted
    apiRequest({ agentId: CHILD, isSidechain: false }),  // a recorded `false` beside an agentId
    apiRequest({ agentId: '' }),                         // no valid id
    apiRequest({ agentId: 'a'.repeat(201) }),
    apiRequest({ agentId: 7 }),
  ];
  for (const one of refused) {
    const { meta } = await readSession(await recording(t, [...helper(), one], `agent-${CHILD}.jsonl`),
      { sidechainAsMain: true });
    assert.equal(meta.capture.unclassifiedRows, 1, JSON.stringify(one.agentId));
    assert.equal(meta.capture.harnessContextRows, undefined, JSON.stringify(one.agentId));
  }
  // An attachment or system row still needs its boolean `isSidechain`: the rule is the request rows' (D72, M33 D).
  const date = envelope({ type: 'attachment', attachment: { type: 'date', date: '2026-10-24' }, agentId: CHILD });
  delete date.isSidechain;
  assert.equal(claudeRowClass(date), null);
  // In a main recording, request rows with no agentId are its harness context as before.
  const { meta } = await readSession(await recording(t, [ask('Run the tests.'), apiRequest(), bash('b-1'),
    result('b-1')]));
  assert.deepEqual([meta.capture.unclassifiedRows, meta.capture.harnessContextRows], [undefined, 1]);
});

test('D150: an api-request-shape row of its recorded form is harness context; any other form is read by its '
  + 'structure', async (t) => {
  assert.deepEqual(claudeRowClass(apiRequestShape()), { cls: 'harness', agentId: null });
  assert.deepEqual(claudeRowClass(apiRequestShape({ agentId: CHILD })), { cls: 'harness', agentId: CHILD });
  const other = [
    apiRequestShape({}, { messages: [{ role: 'user', content: 'Synthetic words.' }] }),   // a request's messages
    apiRequestShape({ note: 'Synthetic words of a new key.' }),                           // a new row key of words
    (() => { const r = apiRequestShape(); delete r.shapeHash; return r; })(),              // a missing key
    apiRequestShape({ version: 2 }),                                                       // a value of another kind
    apiRequestShape({ isSidechain: false, uuid: 'u-1', cwd: '/repo' }),                    // an envelope it never has
  ];
  for (const one of other) {
    assert.equal(claudeRowClass(one), null, JSON.stringify(Object.keys(one)));
    const { meta } = await readSession(await recording(t, [ask('Go.'), one, bash('b-1'), result('b-1')]));
    assert.deepEqual([meta.capture.unclassifiedRows, meta.structuralRows], [1, undefined]);
  }
  // A shape of tokens alone, in another form, is read by its structure as before (D128).
  const tokens = apiRequestShape({ extra: 'tok_1' }, { system: [], tools: [] });
  assert.deepEqual(claudeRowClass(tokens), { cls: 'harness', agentId: null, structural: 'api-request-shape' });
});

/** Rows of every other row type (no user, assistant, system or attachment row) the fixtures hold, and more. */
const CONVERSATION_TYPES = ['user', 'assistant', 'system', 'attachment'];
const OTHER_ROWS = [
  ...[...D128_ROWS, ...RECORDER_ROWS].map((entry) => entry.row).filter((one) => !CONVERSATION_TYPES.includes(one.type)),
  { type: 'mode', mode: 'normal', sessionId: SESSION },
  { type: 'last-prompt', leafUuid: 'x', sessionId: SESSION },
  { type: 'file-history-snapshot', messageId: 'm-1', snapshot: {}, isSnapshotUpdate: false },
  { type: 'queue-operation', operation: 'enqueue', content: 'Synthetic words.', sessionId: SESSION,
    timestamp: '2026-10-24T10:00:00.000Z' },
  { type: 'queue-operation', operation: 'dequeue', sessionId: SESSION, timestamp: '2026-10-24T10:00:01.000Z' },
  { type: 'queue-operation', operation: 'dequeue', sessionId: SESSION, timestamp: 'x', content: 'Synthetic words.' },
  { type: 'future-row', note: 'Synthetic words under a new key.' },
  { type: 'future-row', count: 3 },
  { type: 7 }, {}, apiRequestBlob({ role: 'assistant', content: [{ type: 'text', text: 'Synthetic words.' }] }),
];
const NOT_OBJECTS = [null, 42, 'x', []];

test('D150: the labeller labels every row — one outside the conversation by the class its reader gives it, never '
  + 'null', () => {
  const labeller = claudeLabeller();
  const values = [...OTHER_ROWS, ...NOT_OBJECTS].map((one) => [one, labeller.label(one)]);
  labeller.finish();
  for (const [one, value] of values) {
    const name = JSON.stringify(one)?.slice(0, 80);
    assert.notEqual(value, null, name);
    assert.equal(value.basis, LABEL_BASIS.recorderRow, name);
    const classified = one !== null && typeof one === 'object' && !Array.isArray(one) && claudeRowClass(one) !== null;
    if (classified) assert.deepEqual(value, { label: LABELS.harness, basis: LABEL_BASIS.recorderRow }, name);
    else assert.deepEqual(value, { label: null, basis: LABEL_BASIS.recorderRow, gap: LABEL_GAPS.unknownRow }, name);
  }
  // A compaction mark of another row type is labelled as a compaction is.
  assert.deepEqual(claudeLabeller().label({ type: 'compaction', compacted: true }),
    { label: LABELS.harness, basis: LABEL_BASIS.compactBoundary, markers: ['compaction'] });
  // Rows labelled outside the reader carry the label too.
  assert.ok(labelClaudeRows(OTHER_ROWS).every((rec) => rec.label === LABELS.harness || rec.gap === LABEL_GAPS.unknownRow));
});

test('D150: in a recording, each row the labeller leaves unlabelled is one the reader declares; each it labels harness '
  + 'is harness context or metadata', async (t) => {
  const labeller = claudeLabeller();
  const values = OTHER_ROWS.map((one) => labeller.label(one));
  // Each in a recording of its own: the reader declares exactly the rows left unlabelled (unclassified, or a message
  // channel's loss), and counts each labelled harness as harness context or keeps it as metadata (no loss).
  for (const [i, one] of OTHER_ROWS.entries()) {
    const { meta } = await readSession(await recording(t, [ask('Go.'), one, bash('b-1'), result('b-1')]));
    const capture = meta.capture ?? {};
    const lost = (capture.unclassifiedRows ?? 0) + Object.values(capture.unsupportedRowChannels ?? {})
      .reduce((n, k) => n + k, 0);
    const name = JSON.stringify(one).slice(0, 80);
    if (values[i].gap === LABEL_GAPS.unknownRow) assert.equal(lost, 1, name);
    else assert.deepEqual([values[i].label, lost], [LABELS.harness, 0], name);
  }
  const gaps = values.filter((value) => value.gap === LABEL_GAPS.unknownRow).length;
  assert.ok(gaps > 0 && gaps < OTHER_ROWS.length);
});

test('D150: a 2.1.308 session and its helper, sliced — every request row read, the counts as recorded', async (t) => {
  const main = [ask('Run the tests.'), apiRequestShape(), apiRequest(),
    { type: 'queue-operation', operation: 'dequeue', sessionId: SESSION, timestamp: '2026-10-24T10:00:01.000Z' },
    bash('b-1'), apiRequest(), result('b-1'), { type: 'mode', mode: 'normal', sessionId: SESSION }];
  const mainLedger = await sliceLineage([await recording(t, main)], { cwd: '/repo', includeSources: true });
  const capture = { calls: 0, wrappers: 0, captured: 0, unsupported: 0, missing: 0, unmapped: 0,
    interAgentMessagesUnparsed: 0, reasons: [], incomplete: false, harnessContextRows: 3, genericIncomplete: false,
    interAgentMessagesSoleIncomplete: false,
    labels: { human: 1, harness: 0, thought: 0, action: 1, observation: 1, peer: 0, unlabelled: 0, private: 0 } };
  assert.deepEqual(mainLedger.capture, capture);
  const own = [...helper(), apiRequestShape({ agentId: CHILD }), apiRequest({ agentId: CHILD }),
    apiRequest({ agentId: CHILD })];
  const child = await sliceLineage([await recording(t, own, `agent-${CHILD}.jsonl`)],
    { sidechainAsMain: true, childRecording: true, includeSources: true });
  assert.deepEqual(child.capture, capture);
});

test('D150 (review F1): a shape without its tools or without its system prompt is no listed form, and a recorded '
  + '`isSidechain: null` beside an agentId is refused', async (t) => {
  const noTools = apiRequestShape(); delete noTools.shape.tools;
  const noSystem = apiRequestShape(); delete noSystem.shape.system;
  for (const one of [noTools, noSystem]) {
    assert.equal(claudeRowClass(one), null, JSON.stringify(Object.keys(one.shape)));
    const { meta } = await readSession(await recording(t, [ask('Go.'), one, bash('b-1'), result('b-1')]));
    assert.deepEqual([meta.capture.unclassifiedRows, meta.capture.harnessContextRows], [1, undefined]);
  }
  const nulled = apiRequest({ agentId: CHILD, isSidechain: null });
  assert.equal(claudeRowClass(nulled), null);
  const { meta } = await readSession(await recording(t, [...helper(), nulled], `agent-${CHILD}.jsonl`),
    { sidechainAsMain: true });
  assert.deepEqual([meta.capture.unclassifiedRows, meta.capture.harnessContextRows], [1, undefined]);
});
