// D99 (F1 guard): a background run's end is said to be absent only when code proves it, and every record a reader
// recognised and another could not read is counted.
//
//   - "the recording shows no end of it" (and the Workflow and Agent "no receipt") need proof: no notification is linked
//     to the run, its task id is in no later row of the lineage the agent did not write, and in no row before its
//     launch (background-ends.js). Otherwise the run's end is unread (events.js BACKGROUND_ENDS `unread`).
//   - a run its own notification typed stopped or killed was stopped before it finished (BACKGROUND_ENDS `stopped`).
//   - the recorder census (labels.js RECORDER_CENSUS_REASONS) counts each such record once, by reason and version.
//
// Every row is synthetic and mirrors only the recorder's known key sets. No real recording is read.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sliceLineage } from '../index.js';
import { readSession } from '../src/records.js';
import { BACKGROUND_ENDS, STOPPED_NOTIFICATION_STATUSES, TASK_NOTIFICATION_STATUSES, COMMAND_STATUS_SOURCES,
  claudeTaskNotification, taskNotificationRead } from '../src/events.js';
import { TASK_NOTIFICATION_KIND } from '../src/harness-context.js';
import { RECORDER_CENSUS_REASONS as R, CODEX_SHAPE_CARRIERS, END_UNREAD_REASONS, BACKGROUND_RUN_KINDS,
  END_MENTIONED_REASONS }
  from '../src/labels.js';
import { readBackgroundEnds } from '../src/background-ends.js';
import { recorderCensusOf } from '../src/recorder-census.js';
import { LABELS, LABEL_BASIS } from '../src/labels.js';
import { HELPER_DELIVERY_REASONS } from '../src/helper-deliveries.js';

const SESSION = 'c0ffee00-0000-4000-8000-0000000000d9';
let uuidN = 0;
const row = (extra) => ({ sessionId: SESSION, cwd: '/repo', isSidechain: false, version: '2.1.296',
  uuid: `u-${uuidN++}`, ...extra });
const ask = (text) => row({ type: 'user', origin: { kind: 'human' }, message: { role: 'user', content: text } });
const say = (text) => row({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text }] } });
const use = (id, name, input) => row({ type: 'assistant', message: { role: 'assistant',
  content: [{ type: 'tool_use', id, name, input }] } });
const answer = (id, content, { isError, sidecar, version } = {}) => row({ type: 'user', ...(version ? { version } : {}),
  message: { role: 'user',
    content: [{ type: 'tool_result', tool_use_id: id, content, ...(isError === undefined ? {} : { is_error: isError }) }] },
  ...(sidecar === undefined ? {} : { toolUseResult: sidecar }) });
const SUCCESS = Object.freeze({ stdout: '', stderr: '', interrupted: false, isImage: false, noOutputExpected: false });
const header = ({ taskId, callId, status }) => [taskId === undefined ? '' : `<task-id>${taskId}</task-id>\n`,
  callId === undefined ? '' : `<tool-use-id>${callId}</tool-use-id>\n`,
  status === undefined ? '' : `<status>${status}</status>\n`].join('');
const body = (fields) => `<task-notification>\n${header(fields)}<summary>Background command ended</summary>\n`
  + '</task-notification>';
/** A notification on a user row of the notification kind, its header fields as given (one left out when undefined). */
const notice = (fields, version) => row({ type: 'user', ...(version ? { version } : {}),
  origin: { kind: TASK_NOTIFICATION_KIND, producer: 'session-task' }, message: { role: 'user', content: body(fields) } });
/** A Bash launch run in the background: its typed sidecar id, named by its visible stub. */
const launch = (id, taskId, command) => [use(id, 'Bash', { command, run_in_background: true }),
  answer(id, `Command running in background with ID: ${taskId}. Output is being written to: /tmp/${taskId}.output`,
    { isError: false, sidecar: { ...SUCCESS, backgroundTaskId: taskId } })];
/** A Workflow run in the background, and a background Agent: each launch's typed id, its result row at `version`. */
const workflow = (taskId, call, version) => [use(call, 'Workflow', { script: 'x', run_in_background: true }),
  answer(call, `Workflow launched. Task ID: ${taskId}`, { isError: false, version,
    sidecar: { status: 'async_launched', taskId, runId: 'r1', transcriptDir: '/t', workflowName: 'w' } })];
const agent = (agentId, call, version) => [use(call, 'Agent', { description: 'd', prompt: 'p', subagent_type: 'general' }),
  answer(call, [{ type: 'text', text: `Async agent launched successfully.\nagentId: ${agentId} (use it)` }],
    { isError: false, version, sidecar: { status: 'async_launched', agentId, isAsync: true } })];
/** A harness row of a kind no reader keeps as a record (an attachment the recorder writes), its text as given. */
const attachment = (text) => row({ type: 'attachment', attachment: { type: 'task_progress', content: text } });

async function sliced(t, files, opts = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'sonah-d99-ends-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const paths = [];
  for (const [i, rows] of files.entries()) {
    const file = join(dir, `${i}-${SESSION}.jsonl`);
    await writeFile(file, rows.map((r) => (typeof r === 'string' ? r : JSON.stringify(r))).join('\n') + '\n');
    paths.push(file);
  }
  return { paths, raw: await sliceLineage(paths, { cwd: '/repo', ...opts }) };
}
const act = (raw, cmd) => raw.ledger.find((e) => e.cmd === cmd);
const one = (rows) => [[ask('Run it in the background.'), ...rows]];

// ---- E: stopped and killed are recorded ends -------------------------------------------------------------------

test('D99 F1 guard: a run its own notification typed stopped or killed was stopped before it finished', async (t) => {
  assert.deepEqual(TASK_NOTIFICATION_STATUSES, ['completed', 'failed', 'stopped', 'killed']);
  assert.deepEqual(STOPPED_NOTIFICATION_STATUSES, ['stopped', 'killed']);
  assert.deepEqual(BACKGROUND_ENDS, { stopped: 'stopped', unread: 'unread', unchecked: 'unchecked' });
  const { raw } = await sliced(t, one([
    ...launch('k1', 'bgk1', 'make serve'), notice({ taskId: 'bgk1', callId: 'k1', status: 'killed' }),
    ...launch('k2', 'bgk2', 'make watch'), notice({ taskId: 'bgk2', callId: 'k2', status: 'stopped' }),
    ...launch('k3', 'bgk3', 'make both'), notice({ taskId: 'bgk3', callId: 'k3', status: 'stopped' }),
    notice({ taskId: 'bgk3', callId: 'k3', status: 'completed' }),
  ]));
  for (const cmd of ['make serve', 'make watch']) {
    const ev = act(raw, cmd);
    assert.equal(ev.backgroundEnd, BACKGROUND_ENDS.stopped, cmd);
    // No upgrade without a closed completion: a stop types no status, and no outcome but unknown.
    assert.equal(ev.statusSource, undefined, cmd);
    assert.equal(ev.outcome, 'unknown', cmd);
  }
  // Two disagreeing statuses settle nothing: the end is not read, and it is never said to be absent.
  assert.equal(act(raw, 'make both').statusSource, undefined);
  assert.equal(act(raw, 'make both').backgroundEnd, BACKGROUND_ENDS.unread);
});

// ---- C: an absence only where code proves it -------------------------------------------------------------------

test('D99 F1 guard: a run no later record mentions keeps its absence; the agent\'s own words prove nothing', async (t) => {
  const { raw } = await sliced(t, one([
    ...launch('a1', 'bga1', 'make quiet'),
    // The agent names the id in its own words: not the recorder's word on the run.
    say('I will check bga1 later.'), use('a2', 'Read', { file_path: '/repo/bga1.log' }),
    answer('a2', 'nothing here'),
  ]));
  assert.equal(Object.hasOwn(act(raw, 'make quiet'), 'backgroundEnd'), false);
});

test('D99 F1 guard: a run whose end a later record may hold is unread, under the first test that failed',
  async (t) => {
    const census = async (rows) => (await sliced(t, one(rows), { recorderCensus: true })).raw;
    // 1. A notification is linked (by its call id) whose status no reader of this release knows.
    const linked = await census([...launch('l1', 'bgl1', 'make linked'),
      notice({ taskId: 'bgl1', callId: 'l1', status: 'archived' })]);
    assert.equal(act(linked, 'make linked').notified, 1);
    assert.equal(act(linked, 'make linked').backgroundEnd, BACKGROUND_ENDS.unread);
    // 2. The id is in a later harness row that carries no call id, and in a row no reader keeps as a record.
    for (const later of [notice({ taskId: 'bgm1', status: 'completed' }), attachment('task bgm1 finished: exit 0'),
      answer('m9', 'tail /tmp/bgm1.output: done')]) {
      const mentioned = await census([...launch('m1', 'bgm1', 'make mentioned'), use('m9', 'Bash', { command: 'tail x' }),
        later]);
      assert.equal(act(mentioned, 'make mentioned').backgroundEnd, BACKGROUND_ENDS.unread, JSON.stringify(later));
      assert.deepEqual(mentioned.recorderCensus.entries.filter((e) => END_UNREAD_REASONS.includes(e.reason)),
        [{ reason: R.endUnreadMentioned, kind: 'bash', version: '2.1.296', count: 1 }]);
    }
    // 3. The id is in a row before the launch: no search for it proves anything, and no later record is shown to
    // mention the run, so Sonah could not check whether the recording holds an end of it (review of A1b).
    const early = await census([say('ok'), attachment('earlier bgb1 note'), ...launch('b1', 'bgb1', 'make early')]);
    assert.equal(act(early, 'make early').backgroundEnd, BACKGROUND_ENDS.unchecked);
    assert.deepEqual(early.recorderCensus.entries.map((e) => e.reason), [R.endUnreadBefore]);
    assert.deepEqual(linked.recorderCensus.entries.map((e) => e.reason).filter((r) => END_UNREAD_REASONS.includes(r)),
      [R.endUnreadLinked]);
  });

test('D99 F1 guard: a resumed recording\'s copy of the launch is no later mention', async (t) => {
  const rows = [ask('Run it.'), ...launch('c1', 'bgc1', 'make copied')];
  // The second file copies the first one's rows (the same uuids), then goes on.
  const { raw } = await sliced(t, [rows, [...rows, ask('And now?'), say('Done.')]]);
  assert.equal(Object.hasOwn(act(raw, 'make copied'), 'backgroundEnd'), false);
  // A later file whose own row (a new uuid) holds the id is a mention.
  const { raw: again } = await sliced(t, [rows, [...rows, attachment('bgc1 still running')]]);
  assert.equal(act(again, 'make copied').backgroundEnd, BACKGROUND_ENDS.unread);
});

test('D99 F1 guard: the search reads each line as recorded, and fails closed', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'sonah-d99-scan-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const file = join(dir, 'a.jsonl');
  // Line 4 holds the id `a/b/c` as a JSON writer may spell it, its slashes escaped.
  await writeFile(file, [JSON.stringify(ask('go')), 'x bgz1 y', JSON.stringify(say('ok')),
    '{"type":"attachment","attachment":{"type":"task_progress","content":"a\\/b\\/c done"}}'].join('\n') + '\n');
  const run = (taskId, record, linked = 0) => ({ taskId, row: { source: 0, record }, linked });
  const records = (await readSession(file)).records;
  assert.deepEqual(await readBackgroundEnds([file], [run('bgz1', 1), run('bgz1', 2), run('bgz1', 3)], records),
    [R.endUnreadMentioned, null, R.endUnreadBefore]);
  // A slash written escaped is the same id; an id of no id's shape cannot be searched; a link is checked first.
  assert.deepEqual(await readBackgroundEnds([file], [run('a/b/c', 1), run('a/b/c', 4), run('a b', 1), run('bgz1', 1, 2)],
    records), [R.endUnreadMentioned, null, R.endUnreadIdUnsearchable, R.endUnreadLinked]);
  // A linked run is counted as linked whatever its id's shape, so every linked run is in the census's link count.
  assert.deepEqual(await readBackgroundEnds([file], [run('a b', 1, 1)], records), [R.endUnreadLinked]);
  assert.equal(END_UNREAD_REASONS[0], R.endUnreadLinked);
  // A line the first read did not take is not read again.
  assert.deepEqual(await readBackgroundEnds([file], [run('bgz1', 1)], records, { lines: [1] }), [null]);
  assert.deepEqual(await readBackgroundEnds([join(dir, 'gone.jsonl')], [run('bgz1', 1)], []), [R.endUnreadScanFailed]);
});

// ---- Workflow and Agent runs with no receipt -------------------------------------------------------------------

const AG1 = 'aaaaaaaaaaaaaa01', AG2 = 'aaaaaaaaaaaaaa02';
test('D99 F1 guard: a Workflow or Agent run with no receipt is marked unread when a later record names it',
  async (t) => {
    // Each launch's result row at its own recorder version: the census counts an unread end by its run's own row.
    const { raw } = await sliced(t, one([...workflow('wt1', 'w1', '2.1.297'), attachment('wt1 progress'),
      ...workflow('wt2', 'w2'), ...agent(AG1, 'g1', '2.1.298'), attachment(`${AG1} progress`), ...agent(AG2, 'g2')]),
    { helperDeliveries: true, recorderCensus: true });
    const flows = raw.ledger.filter((e) => e.tool === 'Workflow');
    assert.deepEqual(flows.map((e) => e.backgroundEnd), [BACKGROUND_ENDS.unread, undefined]);
    assert.deepEqual(raw.helperDeliveries.agents.map((a) => [a.agentId, a.endUnread === true]),
      [[AG1, true], [AG2, false]]);
    assert.equal(HELPER_DELIVERY_REASONS.endUnread, 'helper_end_unread');
    // Each unread end is counted under its reason, its run's kind and the recorder version of its launch's own row.
    assert.deepEqual(raw.recorderCensus.entries.filter((e) => END_UNREAD_REASONS.includes(e.reason)), [
      { reason: R.endUnreadMentioned, kind: 'agent', version: '2.1.298', count: 1 },
      { reason: R.endUnreadMentioned, kind: 'workflow', version: '2.1.297', count: 1 }]);
  });

const AG4 = 'aaaaaaaaaaaaaa04';
test('D99 (review of A1b): a run is marked unread only where a later record mentions it, else unchecked', async (t) => {
  // Two of the five unread reasons establish a later mention (a linked notice, the id in a later row the agent did not
  // write); under the other three Sonah could not check whether the recording holds an end of the run, and its mark
  // says that. The partition is closed, and every reason is in exactly one part.
  assert.deepEqual(END_MENTIONED_REASONS, [R.endUnreadLinked, R.endUnreadMentioned]);
  assert.ok(END_MENTIONED_REASONS.every((reason) => END_UNREAD_REASONS.includes(reason)));
  const { raw } = await sliced(t, one([
    // Its id in a row before its launch: a Bash run, a Workflow run and a background Agent.
    attachment('earlier bgu1 wtu1 and aaaaaaaaaaaaaa04 notes'),
    ...launch('u1', 'bgu1', 'make early'), ...workflow('wtu1', 'wu1'), ...agent(AG4, 'gu1'),
    // An id of no shape a verbatim search is sound for (the recorder typed it; no launch registered it).
    use('u2', 'Bash', { command: 'make odd', run_in_background: true }),
    answer('u2', 'Command running in background with ID: bg u2.', { isError: false,
      sidecar: { ...SUCCESS, backgroundTaskId: 'bg u2' } }),
    // A later mention and a linked notice: both unread.
    ...launch('u3', 'bgu3', 'make mentioned'), attachment('bgu3 still running'),
    ...launch('u4', 'bgu4', 'make linked'), notice({ taskId: 'bgu4', callId: 'u4', status: 'archived' }),
  ]), { recorderCensus: true, helperDeliveries: true });
  assert.deepEqual(['make early', 'make odd', 'make mentioned', 'make linked'].map((cmd) => act(raw, cmd).backgroundEnd),
    [BACKGROUND_ENDS.unchecked, BACKGROUND_ENDS.unchecked, BACKGROUND_ENDS.unread, BACKGROUND_ENDS.unread]);
  assert.equal(raw.ledger.find((e) => e.tool === 'Workflow').backgroundEnd, BACKGROUND_ENDS.unchecked);
  const helper = raw.helperDeliveries.agents.find((a) => a.agentId === AG4);
  assert.deepEqual([helper.endUnchecked, helper.endUnread], [true, undefined]);
  // The census counts every unread end by its reason, whichever mark it gave; `unread` counts both marks of Bash runs.
  const reasons = raw.recorderCensus.entries.filter((e) => END_UNREAD_REASONS.includes(e.reason))
    .map((e) => `${e.reason} ${e.kind}`).sort();
  assert.deepEqual(reasons, ['end_unread_before agent', 'end_unread_before bash', 'end_unread_before workflow',
    'end_unread_id_unsearchable bash', 'end_unread_linked bash', 'end_unread_mentioned bash']);
  assert.equal(raw.recorderCensus.launches.unread, 4);
});

// ---- D: the recorder census --------------------------------------------------------------------------------------

test('D99 F1 guard: every notice the labeller labels and the join does not type is counted once, by reason and version',
  async (t) => {
    const copied = notice({ callId: 'n1', status: 'completed' });
    // An origin key beside the kind that no known recorder writes is accepted and logged; `producer` and `runId` are known.
    const keyed = row({ type: 'user', origin: { kind: TASK_NOTIFICATION_KIND, producer: 'p', runId: 'r', lane: 'x' },
      message: { role: 'user', content: body({ taskId: 'bgn1', callId: 'n1', status: 'completed' }) } });
    const rows = one([
      ...launch('n1', 'bgn1', 'make n1'), notice({ taskId: 'bgn1', callId: 'n1', status: 'completed' }), keyed,
      notice({ taskId: 'bgn1', status: 'completed' }, '2.1.299'),
      copied, notice({ taskId: 'bgn1', callId: 'n1' }),
      notice({ taskId: 'bgn1', callId: 'n1', status: 'archived' }),
      row({ type: 'user', origin: { kind: TASK_NOTIFICATION_KIND }, message: { role: 'user', content: 'not a block' } }),
    ]);
    // A copy of a labelled row in a later file of the lineage (the same uuid) is counted once.
    const { paths, raw } = await sliced(t, [...rows, [ask('again'), copied]], { recorderCensus: true });
    const { notices, entries } = raw.recorderCensus;
    assert.deepEqual(notices, { labelled: 7, typed: 2 });
    assert.deepEqual(entries.filter((e) => e.reason === R.originUnknownKeys),
      [{ reason: R.originUnknownKeys, key: 'lane', version: '2.1.296', count: 1 }]);
    const untyped = entries.filter((e) => e.reason.startsWith('notification_'));
    assert.deepEqual(untyped, [
      { reason: R.notificationNoCallId, version: '2.1.299', count: 1 },
      { reason: R.notificationNoTaskId, version: '2.1.296', count: 1 },
      { reason: R.notificationStatusUnknown, version: '2.1.296', count: 2 },
      { reason: R.notificationUnparsed, version: '2.1.296', count: 1 },
    ]);
    // Census completeness: labelled - typed = the sum of the notification entries; and no reader disagrees.
    assert.equal(notices.labelled - notices.typed, untyped.reduce((n, e) => n + e.count, 0));
    assert.equal(entries.some((e) => e.reason === R.readerDisagreement), false);
    // The census is a side channel: asking for it moves no ledger byte.
    const { recorderCensus, ...rest } = raw;
    assert.ok(recorderCensus);
    assert.deepEqual(rest, await sliceLineage(paths, { cwd: '/repo' }));
  });

test('D99 F1 guard: a row the labeller and the join disagree on is counted once, apart from the labelled notices', () => {
  // Both readers call the one carrier rule, so no recording makes them disagree; the census is fed records whose label
  // and raw row disagree on purpose, as a reader that drifted from the other would leave them.
  const labelled = { label: LABELS.harness, basis: LABEL_BASIS.taskNotification };
  const typedRow = notice({ taskId: 'bgr1', callId: 'r1', status: 'completed' });
  const records = [
    { kind: 'user', raw: typedRow, ...labelled },
    // Labelled a task notification, and no task notification to the join (no notification origin).
    { kind: 'user', raw: { ...typedRow, uuid: 'u-lab-only', origin: { kind: 'human' } }, ...labelled },
    // A task notification to the join, labelled none by the labeller, at another version.
    { kind: 'user', raw: { ...typedRow, uuid: 'u-join-only', version: '2.1.299' }, label: LABELS.human,
      basis: LABEL_BASIS.promptSourceHuman },
  ];
  const census = recorderCensusOf({ records, events: [], backgroundRuns: [], ends: [], launchMisses: [],
    codexShapeMisses: [] });
  assert.deepEqual(census.notices, { labelled: 1, typed: 1 });
  assert.deepEqual(census.entries, [{ reason: R.readerDisagreement, version: '2.1.296', count: 1 },
    { reason: R.readerDisagreement, version: '2.1.299', count: 1 }]);
  // Census completeness holds with them: labelled - typed = the sum of the notification entries.
  assert.equal(census.notices.labelled - census.notices.typed,
    census.entries.filter((e) => e.reason.startsWith('notification_')).reduce((n, e) => n + e.count, 0));
});

test('D99 (review of A1b): a row labelled a task notification that no reader kept as a record is counted, whichever carrier', () => {
  // The census reads every row the labeller labelled, kept as a record or only counted (records.js `meta.labelled`). A
  // row it labelled a task notification and no reader kept was never read by the status join: a reader disagreement,
  // by its own row's version. A counted row that copies a record (its uuid) is that record, and is not counted again.
  const notified = { label: LABELS.harness, basis: LABEL_BASIS.taskNotification };
  const typedRow = notice({ taskId: 'bgk1', callId: 'k1', status: 'completed' });
  const counted = [
    { uuid: 'u-queued-drift', value: notified, version: '2.1.301' },
    { uuid: typedRow.uuid, value: notified, version: '2.1.296' },
    { uuid: 'u-harness', value: { label: LABELS.harness, basis: LABEL_BASIS.attachmentRow }, version: '2.1.301' },
    { uuid: null, value: { label: LABELS.harness, basis: LABEL_BASIS.attachmentRow } },
    { uuid: null, value: { private: true } },
  ];
  const census = recorderCensusOf({ records: [{ kind: 'user', raw: typedRow, ...notified }], counted, events: [],
    backgroundRuns: [], ends: [], launchMisses: [], codexShapeMisses: [] });
  assert.deepEqual(census.notices, { labelled: 1, typed: 1 });
  assert.deepEqual(census.entries, [{ reason: R.readerDisagreement, version: '2.1.301', count: 1 }]);
});

test('D99 (review of A1b): a queued notice whose row the strict classifier rejects is counted and linked like any other', async (t) => {
  // A queued notice with one row key no recorder wrote yet (records.js `claudeAttachment` rejects the row): it is kept
  // as a notification record by the one carrier rule, so the census counts it under labelled, typed or the first test
  // of the join it failed, and the launch it names counts its link.
  let n = 0;
  const queued = (fields) => row({ type: 'attachment', entrypoint: 'claude-desktop', gitBranch: 'main',
    parentUuid: null, timestamp: '2026-10-17T00:00:00Z', userType: 'external', promptId: `p-${n++}`,
    attachment: { type: 'queued_command', commandMode: TASK_NOTIFICATION_KIND,
      origin: { kind: TASK_NOTIFICATION_KIND, producer: 'session-task' }, prompt: body(fields) } });
  const { raw } = await sliced(t, one([
    ...launch('d1', 'bgd1', 'make drift-typed'), queued({ taskId: 'bgd1', callId: 'd1', status: 'completed' }),
    ...launch('d2', 'bgd2', 'make drift-unread'), queued({ taskId: 'bgd2', callId: 'd2', status: 'archived' }),
    queued({ taskId: 'bgd2', status: 'completed' }),
  ]), { recorderCensus: true });
  assert.equal(act(raw, 'make drift-typed').statusSource, COMMAND_STATUS_SOURCES.claudeTaskNotification);
  assert.equal(act(raw, 'make drift-unread').backgroundEnd, BACKGROUND_ENDS.unread);
  const { notices, launches, entries } = raw.recorderCensus;
  assert.deepEqual(notices, { labelled: 3, typed: 1 });
  const untyped = entries.filter((e) => e.reason.startsWith('notification_'));
  assert.deepEqual(untyped, [{ reason: R.notificationNoCallId, version: '2.1.296', count: 1 },
    { reason: R.notificationStatusUnknown, version: '2.1.296', count: 1 }]);
  // Census completeness, reader agreement and link conservation hold on this carrier too.
  assert.equal(notices.labelled - notices.typed, untyped.reduce((s, e) => s + e.count, 0));
  assert.equal(entries.some((e) => e.reason === R.readerDisagreement), false);
  const unreadLinked = entries.filter((e) => e.reason === R.endUnreadLinked && e.kind === 'bash');
  assert.deepEqual([launches.linked, launches.typed, unreadLinked.reduce((s, e) => s + e.count, 0)], [2, 1, 1]);
  assert.equal(launches.linked, launches.typed + launches.stopped + unreadLinked.reduce((s, e) => s + e.count, 0)
    + launches.linkedOther);
});

test('D99 F1 guard: the join\'s one reading types exactly what it did, and names the test it failed', () => {
  const read = (fields) => taskNotificationRead(notice(fields));
  assert.deepEqual(read({ taskId: 't1', callId: 'c1', status: 'completed' }).notice,
    { taskId: 't1', toolUseId: 'c1', status: 'completed' });
  assert.deepEqual(read({ taskId: 't1', status: 'completed' }), { miss: R.notificationNoCallId });
  assert.deepEqual(read({ callId: 'c1', status: 'completed' }), { miss: R.notificationNoTaskId });
  assert.deepEqual(read({ taskId: 't1', callId: 'c1' }), { miss: R.notificationStatusUnknown });
  const twice = row({ type: 'user', origin: { kind: TASK_NOTIFICATION_KIND }, message: { role: 'user',
    content: '<task-notification><task-id>a</task-id><task-id>b</task-id><tool-use-id>c</tool-use-id>'
      + '<status>completed</status></task-notification>' } });
  assert.deepEqual(taskNotificationRead(twice), { miss: R.notificationUnparsed });
  assert.equal(claudeTaskNotification(twice), null);
  assert.equal(taskNotificationRead(ask('<task-notification></task-notification>')), null, 'no carrier, no reading');
});

const AG3 = 'aaaaaaaaaaaaaa03';
test('D99 F1 guard: link conservation, and a launch the join could not register counted under its reason',
  async (t) => {
    const { raw } = await sliced(t, one([
      ...launch('p1', 'bgp1', 'make typed'), notice({ taskId: 'bgp1', callId: 'p1', status: 'completed' }),
      // A linked Bash launch with an end of its own (its sidecar typed it interrupted), and a Workflow and an Agent run
      // whose linked notice no reader of this release types: none of the three is a typed, stopped or unread Bash end.
      use('p7', 'Bash', { command: 'make interrupted', run_in_background: true }),
      answer('p7', 'Command running in background with ID: bgp7.', { isError: false,
        sidecar: { ...SUCCESS, interrupted: true, backgroundTaskId: 'bgp7' } }),
      notice({ taskId: 'bgp7', callId: 'p7', status: 'completed' }),
      ...workflow('wt3', 'w3'), notice({ taskId: 'wt3', callId: 'w3', status: 'archived' }),
      ...agent(AG3, 'g3'), notice({ taskId: AG3, callId: 'g3', status: 'archived' }),
      ...launch('p2', 'bgp2', 'make stopped'), notice({ taskId: 'bgp2', callId: 'p2', status: 'killed' }),
      ...launch('p3', 'bgp3', 'make unread'), notice({ taskId: 'bgp3', callId: 'p3', status: 'archived' }),
      ...launch('p4', 'bgp4', 'make absent'),
      // A sidecar with a key no reader knows, and a stub that does not name the typed id.
      use('p5', 'Bash', { command: 'make drift', run_in_background: true }),
      answer('p5', 'Command running in background with ID: bgp5.', { isError: false,
        sidecar: { ...SUCCESS, backgroundTaskId: 'bgp5', assistantAutoBackgrounded: true } }),
      use('p6', 'Bash', { command: 'make silent', run_in_background: true }),
      answer('p6', 'Started.', { isError: false, sidecar: { ...SUCCESS, backgroundTaskId: 'bgp6' } }),
    ]), { recorderCensus: true, helperDeliveries: true });
    assert.equal(act(raw, 'make typed').statusSource, COMMAND_STATUS_SOURCES.claudeTaskNotification);
    const { launches, entries } = raw.recorderCensus;
    assert.deepEqual(launches, { background: 7, typed: 1, stopped: 1, unread: 1, absent: 3, other: 1, linked: 4,
      linkedOther: 1 });
    // Every linked Bash launch ends typed, stopped, unread under a counted reason of kind bash, or in an end of its own.
    const unreadLinked = entries.filter((e) => e.reason === R.endUnreadLinked);
    assert.deepEqual(unreadLinked.map((e) => e.kind), ['agent', 'bash', 'workflow']);
    assert.ok(unreadLinked.every((e) => BACKGROUND_RUN_KINDS.includes(e.kind)));
    assert.equal(launches.linked, launches.typed + launches.stopped
      + unreadLinked.filter((e) => e.kind === 'bash').reduce((n, e) => n + e.count, 0) + launches.linkedOther);
    // The sidecar key the reader does not know is logged by its name.
    assert.deepEqual(entries.filter((e) => [R.sidecarUnknownKeys, R.launchTextLacksId].includes(e.reason)),
      [{ reason: R.launchTextLacksId, version: '2.1.296', count: 1 },
        { reason: R.sidecarUnknownKeys, version: '2.1.296', count: 1 },
        { reason: R.sidecarUnknownKeys, key: 'assistantAutoBackgrounded', version: '2.1.296', count: 1 }]);
  });

test('D99 F1 guard: every Codex shape miss is counted by its carrier and the rollout\'s recorder version', async (t) => {
  const meta = { timestamp: '2026-10-17T00:00:00Z', type: 'session_meta', payload: { id: 'cdx-d99', cwd: '/repo',
    cli_version: '0.99.0', originator: 'codex_cli_rs', timestamp: '2026-10-17T00:00:00Z' } };
  const lines = [meta,
    { timestamp: '2026-10-17T00:00:01Z', type: 'response_item', payload: { type: 'message', role: 'user',
      content: [{ type: 'input_text', text: 'go' }] } },
    { timestamp: '2026-10-17T00:00:02Z', type: 'mystery_row', payload: {} },
    { timestamp: '2026-10-17T00:00:03Z', type: 'response_item', payload: { type: 'mystery_item' } },
    { timestamp: '2026-10-17T00:00:04Z', type: 'response_item', payload: { type: 'message', role: 'oracle',
      content: [{ type: 'output_text', text: 'x' }] } }];
  const dir = await mkdtemp(join(tmpdir(), 'sonah-d99-codex-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const file = join(dir, 'rollout-2026-10-17T00-00-00-cdx-d99.jsonl');
  await writeFile(file, lines.map((l) => JSON.stringify(l)).join('\n') + '\n');
  const raw = await sliceLineage([file], { recorderCensus: true });
  const shapes = raw.recorderCensus.entries.filter((e) => e.reason === R.codexShapeMiss);
  assert.deepEqual(shapes, [
    { reason: R.codexShapeMiss, carrier: 'message', version: '0.99.0', count: 1 },
    { reason: R.codexShapeMiss, carrier: 'response_item', version: '0.99.0', count: 1 },
    { reason: R.codexShapeMiss, carrier: 'row_type', version: '0.99.0', count: 1 },
  ]);
  for (const entry of shapes) assert.ok(CODEX_SHAPE_CARRIERS.includes(entry.carrier));
  // Every shape miss is one unsupported row, as before: the census splits the count, it adds none.
  assert.equal(raw.capture.unsupported, shapes.reduce((n, e) => n + e.count, 0));
});

test('D99 F1 guard: every Codex shape miss names a carrier of the closed list, and every carrier has a reader',
  async () => {
    // Structure of the reader's own code: each call that counts a shape miss names its carrier as a literal of
    // CODEX_SHAPE_CARRIERS, so a carrier misspelt at a call site (most are not reached by a synthetic rollout) fails.
    const source = await readFile(new URL('../src/codex.js', import.meta.url), 'utf8');
    const calls = [...source.matchAll(/\bshapeMiss\(([^)]*)\)/g)].map((m) => m[1].trim());
    assert.ok(calls.length >= CODEX_SHAPE_CARRIERS.length, 'every call site is read');
    const named = calls.map((arg) => arg.match(/^'([a-z_]+)'$/)?.[1] ?? null);
    assert.deepEqual(calls.filter((arg, i) => named[i] === null || !CODEX_SHAPE_CARRIERS.includes(named[i])), []);
    assert.deepEqual([...new Set(named)].sort(), [...CODEX_SHAPE_CARRIERS].sort());
  });

test('D99 F1 guard: the census reasons are a closed vocabulary of tokens', () => {
  const reasons = Object.values(R);
  assert.equal(new Set(reasons).size, reasons.length);
  for (const reason of reasons) assert.match(reason, /^[a-z][a-z_]*$/);
  assert.ok(Object.isFrozen(R) && Object.isFrozen(CODEX_SHAPE_CARRIERS) && Object.isFrozen(END_UNREAD_REASONS));
  for (const reason of END_UNREAD_REASONS) assert.ok(reasons.includes(reason));
});
