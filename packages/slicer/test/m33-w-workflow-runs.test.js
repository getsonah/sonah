// M33 W (Claude Code Workflow agents), the pure half: the closed vocabulary, the recorded identity rules, the run
// journal reader, the run plan, and the slicer's launch side channel. Every recording here is synthetic.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sliceLineage } from '../index.js';
import { WORKFLOW_RUN_NOTES, WORKFLOW_RUN_LOSSES, WORKFLOW_LIMITS, WORKFLOW_AGENT_KIND, WORKFLOW_AGENT_LINKED,
  safeRunId, safeAgentId, safeSessionId, plainWorkflowName, agentFileName, agentIdOfFile, readJournal,
  topLevelValueSpans, planWorkflowRun, workflowLaunched, runRecord, workflowCallRoles, copiedCallProven }
  from '../src/workflow-runs.js';
import { AGENTS, RESULTS, RUN, SID, SID_COPIED, TEXT, copiedRows, jsonl, parentRows, resulted, started, workflowRows,
  journalKey } from '../../cli/test/m33-w-workflow-fixture.js';

async function recording(t, rows) {
  const dir = await mkdtemp(join(tmpdir(), 'sonah-m33-w-slicer-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const file = join(dir, `${SID}.jsonl`);
  await writeFile(file, jsonl(rows), { mode: 0o600 });
  return file;
}

test('M33 W the run notes are one closed, frozen table; a ledger carries every one but run_unresolved', () => {
  assert.ok(Object.isFrozen(WORKFLOW_RUN_NOTES) && Object.isFrozen(WORKFLOW_RUN_LOSSES) && Object.isFrozen(WORKFLOW_LIMITS));
  assert.deepEqual(Object.values(WORKFLOW_RUN_NOTES), ['workflow_run_unresolved', 'workflow_journal_missing',
    'workflow_journal_unreadable', 'workflow_agent_recording_missing', 'workflow_agent_unstarted',
    'workflow_agent_identity_mismatch', 'workflow_agent_no_result', 'workflow_agent_result_conflict',
    'workflow_nested_unlinked', 'workflow_run_entry_unread']);
  assert.deepEqual(WORKFLOW_RUN_LOSSES, Object.values(WORKFLOW_RUN_NOTES).filter((note) => note !== 'workflow_run_unresolved'));
  assert.equal(WORKFLOW_AGENT_KIND, 'workflow-agent');
  assert.equal(WORKFLOW_AGENT_LINKED, 'workflow_agent_linked');
  assert.equal(WORKFLOW_LIMITS.nestingDepth, 2);
  assert.equal(WORKFLOW_LIMITS.copiedSessions, 8, 'at most 8 earlier session files read per recording (frozen)');
});

test('M33 W identities are the recorded shapes only', () => {
  for (const id of [RUN, 'wf_a', 'wf_0-0']) assert.equal(safeRunId(id), true, id);
  for (const id of ['wf_', 'WF_1a2b', 'wf_1A2B', 'wf_1a2b/..', 'run_1a2b', `wf_${'a'.repeat(200)}`, null, 7])
    assert.equal(safeRunId(id), false, String(id));
  for (const id of [AGENTS.fixer, 'a4a6288c5dc896831', '4a6288c5dc896831']) assert.equal(safeAgentId(id), true, id);
  for (const id of ['a4a6288c5dc8968', 'g4a6288c5dc89683', 'b4a6288c5dc896831', 'a4a6288c5dc8968311', 'A4A6288C5DC896831', '../a'])
    assert.equal(safeAgentId(id), false, id);
  assert.equal(safeSessionId(SID), true);
  for (const id of ['..', '', 'a/b', '.hidden']) assert.equal(safeSessionId(id), false, id);
  assert.equal(plainWorkflowName('fix-parser'), true);
  assert.equal(plainWorkflowName('fix_parser2'), true);
  for (const name of ['fix parser', '-fix', 'fix/parser', 'x'.repeat(65), 'fix\nparser', ''])
    assert.equal(plainWorkflowName(name), false, name);
  assert.equal(agentFileName(AGENTS.fixer), `agent-${AGENTS.fixer}.jsonl`);
  assert.equal(agentIdOfFile(`agent-${AGENTS.fixer}.jsonl`), AGENTS.fixer);
  for (const name of [`agent-${AGENTS.fixer}.meta.json`, 'agent-zz.jsonl', 'journal.jsonl', `x-${AGENTS.fixer}.jsonl`])
    assert.equal(agentIdOfFile(name), null, name);
});

test('M33 W a report is the exact recorded JSON text of the result value: a literal substring of its line', () => {
  const line = '{"type":"result", "agentId":"a1111111111111111","key":"k","result" :  {"a": "x\\n\\u00e9 \\"q\\"", "b":[1, 2]} }';
  const spans = topLevelValueSpans(line);
  const [from, until] = spans.get('result');
  assert.equal(line.slice(from, until), '{"a": "x\\n\\u00e9 \\"q\\"", "b":[1, 2]}');
  assert.equal(line.slice(...spans.get('type')), '"result"');
  for (const bad of ['[1]', '{"a":1,"a":2}', '{"a":1} x', '{"a":', 'null']) assert.equal(topLevelValueSpans(bad), null, bad);
  const journal = readJournal([started(AGENTS.fixer), started(AGENTS.tester), started(AGENTS.fixer),
    resulted(AGENTS.fixer, RESULTS.fixer), resulted(AGENTS.fixer, RESULTS.fixer), resulted(AGENTS.tester, RESULTS.tester),
    ''].join('\n'));
  assert.deepEqual(journal.started, [AGENTS.fixer, AGENTS.tester], 'first-recorded order; identical repeats are one fact');
  assert.deepEqual(journal.results.get(AGENTS.fixer), [JSON.stringify(RESULTS.fixer)]);
  assert.deepEqual(journal.results.get(AGENTS.tester), [JSON.stringify(RESULTS.tester)], 'a string result keeps its quotes');
  assert.equal(journal.unreadable, 0);
  const two = readJournal([started(AGENTS.fixer), resulted(AGENTS.fixer, 'one'), resulted(AGENTS.fixer, 'two')].join('\n'));
  assert.deepEqual(two.results.get(AGENTS.fixer), ['"one"', '"two"'], 'two different results are both kept: a conflict');
});

test('M33 W a journal line outside the two recorded shapes is unreadable', () => {
  const key = journalKey(AGENTS.fixer);
  const bad = [
    '{"type":"started"', 'not json', JSON.stringify({ type: 'started', agentId: AGENTS.fixer }),
    JSON.stringify({ type: 'started', agentId: AGENTS.fixer, key, extra: 1 }),
    JSON.stringify({ type: 'begun', agentId: AGENTS.fixer, key }),
    JSON.stringify({ type: 'started', agentId: 'A1111111111111111', key }),
    JSON.stringify({ type: 'started', agentId: AGENTS.fixer, key: '' }),
    JSON.stringify({ type: 'result', agentId: AGENTS.fixer, key, result: 7 }),
    JSON.stringify({ type: 'result', agentId: AGENTS.fixer, key, result: null }),
    JSON.stringify({ type: 'result', agentId: AGENTS.fixer, key }),
    `{"type":"started","agentId":"${AGENTS.fixer}","agentId":"${AGENTS.tester}","key":"${key}"}`,
    '[]', '"started"',
  ];
  for (const line of bad) assert.equal(readJournal(line).unreadable, 1, line);
  assert.equal(readJournal(bad.join('\n')).unreadable, bad.length);
});

test('M33 W the run plan: every agent the run names is a candidate or exactly one loss, in any listing order', () => {
  const files = (names) => new Map(names.map((name) => [name, true]));
  const journal = readJournal([started(AGENTS.fixer), started(AGENTS.tester), started(AGENTS.deep),
    resulted(AGENTS.fixer, 'done'), resulted(AGENTS.stray, 'orphan')].join('\n'));
  const names = [agentFileName(AGENTS.fixer), agentFileName(AGENTS.tester), agentFileName(AGENTS.deeper), 'agent-bad.jsonl'];
  const a = planWorkflowRun({ journal, files: files(names) });
  const b = planWorkflowRun({ journal, files: files([...names].reverse()) });
  assert.deepEqual(a, b, 'independent of the order entries were listed in');
  assert.deepEqual(a.candidates.map((c) => c.agentId), [AGENTS.fixer, AGENTS.tester], 'journal order');
  assert.deepEqual(a.candidates[0].results, ['"done"']);
  assert.deepEqual(a.candidates[1].results, []);
  assert.equal(a.losses.workflow_agent_recording_missing, 1, 'started, no file');
  assert.equal(a.losses.workflow_agent_unstarted, 3, 'a file with no started line, an unnamed file, a result with none');
  const symlinked = planWorkflowRun({ journal, files: new Map([[agentFileName(AGENTS.fixer), false]]) });
  assert.equal(symlinked.losses.workflow_agent_recording_missing, 3, 'a recording that is not a regular file is not read');
  assert.deepEqual(planWorkflowRun({ journal: null, files: files(names) }).losses.workflow_journal_missing, 1);
  const unreadable = planWorkflowRun({ journal: { ...journal, unreadable: 2 }, files: files(names) });
  assert.equal(unreadable.losses.workflow_journal_unreadable, 2);
  assert.deepEqual(unreadable.candidates, [], 'an unreadable journal is not read at all: nothing links');
  assert.deepEqual(runRecord({ turn: 1, seq: 0, linked: 2, losses: { ...a.losses } }), { turn: 1, seq: 0, linked: 2,
    losses: { workflow_agent_recording_missing: 1, workflow_agent_unstarted: 3 } });
  assert.deepEqual(runRecord({ turn: 1, seq: 0, linked: 2, losses: {} }), { turn: 1, seq: 0, linked: 2 });
  // M33 W repair: every other entry of the run directory (not its journal, an agent recording or an agent's meta file)
  // is counted under its own note, whatever else the run holds: never passed over.
  assert.equal(planWorkflowRun({ journal, files: files(names), others: 2 }).losses.workflow_run_entry_unread, 2);
  assert.equal(planWorkflowRun({ journal: null, files: files(names), others: 1 }).losses.workflow_run_entry_unread, 1);
  assert.equal(planWorkflowRun({ journal: { ...journal, unreadable: 1 }, files: files(names), others: 3 })
    .losses.workflow_run_entry_unread, 3);
  assert.equal(a.losses.workflow_run_entry_unread, 0, 'none by default');
  for (const others of [-1, 1.5, 'x']) assert.throws(() => planWorkflowRun({ journal, files: files(names), others }));
});

test('M33 W the launch side channel exists only on request, so every other ledger keeps its bytes', async (t) => {
  const file = await recording(t, parentRows({ workflows: [workflowRows({ transcriptDir: '/srv/x/subagents/workflows/' + RUN })] }));
  const plain = await sliceLineage([file]);
  const asked = await sliceLineage([file], { workflowLaunches: true });
  assert.equal(Object.hasOwn(plain, 'workflowLaunches'), false);
  const { workflowLaunches, ...rest } = asked;
  assert.deepEqual(rest, plain, 'asking adds the side channel and changes nothing else');
  assert.deepEqual(workflowLaunches.sessionIds, [SID]);
  assert.equal(workflowLaunches.calls.length, 1);
  const [call] = workflowLaunches.calls;
  const rows = parentRows({ workflows: [workflowRows({ transcriptDir: '/srv/x/subagents/workflows/' + RUN })] });
  // M33 W repair 2: the call's own row uuids (its tool_use row, then each result row) ride in the side channel, for
  // the copied-call proof only; no resumeFromRunId is recorded, so none is kept.
  assert.deepEqual(call, { turn: 1, seq: 0, callId: 'toolu_01SyntheticWorkflowCall0001', record: 2, source: 0,
    // C-01 event identity: the call's own, from which each agent its run started is named.
    identity: { stream: 0, record: 2, block: 1, native: rows[1].uuid },
    sessionId: SID, uuid: rows[1].uuid, resultUuids: [rows[2].uuid],
    runId: RUN, transcriptDir: '/srv/x/subagents/workflows/' + RUN, workflowName: 'fix-parser',
    // M33 W2: where the parent received the run's completion: its settled notification's row (row 4).
    receipt: { turn: 1, beforeEvent: 1, source: 0, record: 4 } });
  const act = asked.ledger.find((event) => event.turn === call.turn && event.seq === call.seq);
  assert.equal(workflowLaunched(act), true);
  for (const field of ['runId', 'transcriptDir', 'workflowName'])
    assert.equal(JSON.stringify(plain).includes(field === 'runId' ? RUN : field === 'workflowName' ? '"fix-parser"' : '/srv/x'), false, field);
});

test('M33 W a call records its run only when every result row agrees on one launch sidecar', async (t) => {
  const repeat = (sidecar) => {
    const rows = workflowRows({ notification: false });
    const again = structuredClone(rows[1]);
    again.toolUseResult = { ...again.toolUseResult, ...sidecar };
    return parentRows({ workflows: [[...rows, again]] });
  };
  const launchOf = async (rows) => (await sliceLineage([await recording(t, rows)], { workflowLaunches: true })).workflowLaunches.calls[0];
  assert.equal((await launchOf(repeat({})))?.runId, RUN, 'an identical repeat is one launch');
  for (const sidecar of [{ runId: 'wf_0000ffff-fff' }, { transcriptDir: '/srv/other' }, { workflowName: 'other' }]) {
    const launch = await launchOf(repeat(sidecar));
    assert.equal(launch.runId, undefined, JSON.stringify(sidecar));
    assert.equal(launch.transcriptDir, undefined);
  }
  assert.equal((await launchOf(parentRows({ workflows: [workflowRows({ withRunId: false })] }))).runId, undefined);
  const failed = await launchOf(parentRows({ workflows: [workflowRows({ error: true })] }));
  assert.equal(failed.runId, undefined, 'an error result records no launch sidecar');
  const noResult = parentRows({ workflows: [workflowRows().slice(0, 1)] });
  assert.equal((await launchOf(noResult)).runId, undefined, 'no result row: no run');
});

test('M33 W a Workflow agent brief takes every ask\'s path: kept in full, no cut declared or made', async (t) => {
  // M33 W repair: no option of its own. Windowing (M35): every ask is kept in full — no budget, no declared cut;
  // redaction scrubs it whole and bounds none.
  const long = `${TEXT.fixerBrief}\n${'Context line about the parser module and its nested inputs.\n'.repeat(500)}End of brief.`;
  assert.ok(long.length > 20_000);
  const rows = [{ type: 'user', isSidechain: true, agentId: AGENTS.fixer, sessionId: SID, message: { role: 'user', content: long } }];
  const file = await recording(t, rows);
  const sliced = await sliceLineage([file], { sidechainAsMain: true, childRecording: true, wholeAsks: true });
  const plain = await sliceLineage([file], { sidechainAsMain: true, childRecording: true });
  assert.deepEqual(sliced, plain, 'no wholeAsks option: a workflow agent\'s brief is sliced as any ask is');
  assert.equal(plain.ask[0].text, long, 'kept whole, byte for byte, until redaction');
  assert.equal(plain.ask[0].elided, undefined, 'no cut is due');
});

// ---- M33 W repair 2: resumed runs and calls copied from an earlier session file ----------------------------------

test('M33 W a resume call\'s recorded resumeFromRunId and every result row uuid ride in the side channel', async (t) => {
  const OTHER = 'wf_0d0d0d0d-0d0';
  const origin = workflowRows({ transcriptDir: '/srv/x/subagents/workflows/' + RUN });
  const resume = workflowRows({ call: 'toolu_01SyntheticWorkflowCall0002', task: 'wtask_synthetic_002',
    transcriptDir: '/srv/x/subagents/workflows/' + RUN, resumeFromRunId: RUN, notification: false });
  const again = { ...structuredClone(resume[1]), uuid: '5f0c2d1e-0000-4000-8000-0000000000aa' };
  const odd = workflowRows({ call: 'toolu_01SyntheticWorkflowCall0003', task: 'wtask_synthetic_003', runId: OTHER,
    resumeFromRunId: RUN, notification: false });
  odd[0].message.content[1].input.resumeFromRunId = 7;
  const rows = parentRows({ workflows: [origin, [...resume, again], odd] });
  const file = await recording(t, rows);
  const { workflowLaunches } = await sliceLineage([file], { workflowLaunches: true });
  const [first, second, third] = workflowLaunches.calls;
  assert.equal(Object.hasOwn(first, 'resumeFromRunId'), false, 'no resumeFromRunId recorded: none kept');
  assert.equal(second.resumeFromRunId, RUN);
  assert.deepEqual([second.uuid, second.resultUuids], [resume[0].uuid, [resume[1].uuid, again.uuid]],
    'an identical repeat is one launch, and each of its rows is named by its own uuid');
  assert.equal(second.runId, RUN);
  assert.equal(third.resumeFromRunId, null, 'a recorded resumeFromRunId that is not a string is kept as present, unusable');
});

test('M33 W a run named by several calls links only to its one origin, every other call naming it by resumeFromRunId', () => {
  const dir = '/srv/x/subagents/workflows/' + RUN;
  const call = (extra = {}) => ({ runId: RUN, transcriptDir: dir, sessionId: SID, launched: true, ...extra });
  const resume = (extra = {}) => call({ resumeFromRunId: RUN, ...extra });
  assert.deepEqual(workflowCallRoles([call()]), [{ origin: true, resumes: [] }], 'one call, no resume: today\'s rule');
  assert.deepEqual(workflowCallRoles([call(), resume(), resume()]),
    [{ origin: true, resumes: [1, 2] }, { resumeOf: 0 }, { resumeOf: 0 }]);
  assert.deepEqual(workflowCallRoles([resume(), call()]), [{ resumeOf: 1 }, { origin: true, resumes: [0] }],
    'the origin is the call with no resumeFromRunId, never the first by order');
  // Another run named by other calls is its own group.
  const OTHER = 'wf_0e0e0e0e-0e0';
  assert.deepEqual(workflowCallRoles([call(), call({ runId: OTHER })]),
    [{ origin: true, resumes: [] }, { origin: true, resumes: [] }]);
  for (const [why, calls] of [
    ['a resume with no origin', [resume()]],
    ['two origins', [call(), call()]],
    ['two origins and a resume', [call(), call(), resume()]],
    ['a resume naming another run', [call(), resume({ resumeFromRunId: OTHER })]],
    ['a resume of this run whose result names another run', [call(), resume({ runId: OTHER })]],
    ['a resume of this run whose result names no run', [call(), resume({ runId: undefined })]],
    ['a resumeFromRunId that is not a string', [call(), resume({ resumeFromRunId: null })]],
    ['a resume that did not launch', [call(), resume({ launched: false })]],
    ['an origin that did not launch', [call({ launched: false }), resume()]],
    ['a resume recording another transcriptDir', [call(), resume({ transcriptDir: dir + '-other' })]],
    ['a resume recording no transcriptDir', [call(), resume({ transcriptDir: undefined })]],
    ['neither recording a transcriptDir, in two sessions', [call({ transcriptDir: undefined }),
      resume({ transcriptDir: undefined, sessionId: SID_COPIED })]],
  ]) assert.deepEqual(workflowCallRoles(calls), calls.map(() => null), why);
  assert.deepEqual(workflowCallRoles([call({ transcriptDir: undefined }), resume({ transcriptDir: undefined })]),
    [{ origin: true, resumes: [1] }, { resumeOf: 0 }], 'neither recording a transcriptDir, in one recorded session');
  assert.deepEqual(workflowCallRoles([call({ runId: undefined }), call({ runId: 'not-a-run' })]), [null, null],
    'no safe recorded runId: nothing');
  // A call outside any valid group never disturbs another run's group.
  assert.deepEqual(workflowCallRoles([call(), resume(), resume({ runId: OTHER, resumeFromRunId: OTHER })]),
    [{ origin: true, resumes: [1] }, { resumeOf: 0 }, null]);
});

test('M33 W a copied call is proven only by its own rows of the earlier session file: same uuid, call id, session, run', () => {
  const xRows = workflowRows({ sessionId: SID_COPIED, transcriptDir: '/srv/x' });
  const [use, result] = xRows;
  const proof = { sessionId: SID_COPIED, callId: 'toolu_01SyntheticWorkflowCall0001', runId: RUN, uuid: use.uuid,
    resultUuids: [result.uuid] };
  const rowsOf = (...list) => {
    const map = new Map();
    for (const row of list) map.set(row?.uuid ?? 'null', [...(map.get(row?.uuid ?? 'null') ?? []), row]);
    return map;
  };
  assert.equal(copiedCallProven({ ...proof, rows: rowsOf(use, result) }), true);
  const changed = (row, change) => { const copy = structuredClone(row); change(copy); return copy; };
  for (const [why, rows] of [
    ['no tool_use row', rowsOf(result)],
    ['no result row', rowsOf(use)],
    ['the tool_use row records another session', rowsOf(copiedRows([use], SID)[0], result)],
    ['the result row records another session', rowsOf(use, copiedRows([result], SID)[0])],
    ['the same uuid with another tool_use id', rowsOf(changed(use, (r) => { r.message.content[1].id = 'toolu_other'; }), result)],
    ['the same uuid with another tool name', rowsOf(changed(use, (r) => { r.message.content[1].name = 'Agent'; }), result)],
    ['the result names another call', rowsOf(use, changed(result, (r) => { r.message.content[0].tool_use_id = 'toolu_other'; }))],
    ['the result records another runId', rowsOf(use, changed(result, (r) => { r.toolUseResult.runId = 'wf_0f0f0f0f-0f0'; }))],
    ['the result records no sidecar', rowsOf(use, changed(result, (r) => { delete r.toolUseResult; }))],
    ['two result blocks share the sidecar', rowsOf(use, changed(result, (r) => {
      r.message.content.push({ type: 'tool_result', tool_use_id: 'toolu_other', content: 'x' }); }))],
    ['a second row with the uuid disagrees', rowsOf(use, result, changed(use, (r) => { r.sessionId = SID; }))],
    ['a row with the uuid could not be read', new Map([[use.uuid, [use, null]], [result.uuid, [result]]])],
  ]) assert.equal(copiedCallProven({ ...proof, rows }), false, why);
  for (const [why, change] of [['no uuid', { uuid: null }], ['no result uuid', { resultUuids: [] }],
    ['a result uuid that is the tool_use row\'s', { resultUuids: [use.uuid] }], ['no run', { runId: undefined }],
    ['no session', { sessionId: null }], ['no call id', { callId: null }]])
    assert.equal(copiedCallProven({ ...proof, ...change, rows: rowsOf(use, result) }), false, why);
});

test('M33 W a run record names its resume calls; a run with none keeps its bytes', () => {
  assert.deepEqual(runRecord({ turn: 1, seq: 0, linked: 2, losses: {}, resumes: [{ turn: 1, seq: 1 }] }),
    { turn: 1, seq: 0, linked: 2, resumes: [{ turn: 1, seq: 1 }] });
  assert.deepEqual(runRecord({ turn: 1, seq: 0, linked: 2, losses: {}, resumes: [] }), { turn: 1, seq: 0, linked: 2 });
});
