// M33 W repair 2 (Claude Code Workflow agents): two shapes that kept the M33 D "agents not linked" loss are now
// linked by exact recorded identity, and nothing else is.
//   A. RESUMED RUNS. Two calls name one runId: the one whose recorded input has no resumeFromRunId (the origin) owns
//      the run; every other names it by input.resumeFromRunId. The run's agents link once, as helpers of the origin.
//   B. CALLS COPIED FROM AN EARLIER SESSION FILE. Claude Code continues a conversation in a new file that repeats
//      earlier rows with the same row uuid, rewriting their sessionId. A recorded transcriptDir under that earlier
//      session X is accepted only when <slug>/<X>.jsonl records the call's own rows (same uuid, call id, session X, run).
// Synthetic projects trees only (cli/test/m33-w-workflow-fixture.js); no recording, no model, no network.
import test from 'node:test';
import assert from 'node:assert/strict';
import { appendFile, lstat, open } from 'node:fs/promises';
import { join } from 'node:path';
import { loadSessionEvidence } from '../src/session-evidence.js';
import { readRecordingRows } from '../src/recording-read.js';
import { redact } from '../../redact/index.js';
import { WORKFLOW_GAP_NOTES, WORKFLOW_RUN_GAP_NOTES } from '../../evidence/adapters/sonah-ledger.js';
// C-01 event identity: sessions are registered, and their events named by positional labels (stable-ids-fixture.js).
import { adapt, named, labelOf } from '../../evidence/test/stable-ids-fixture.js';
import { WORKFLOW_LIMITS } from '../../slicer/src/workflow-runs.js';
import { AGENTS, CALL, RESULTS, RUN, SID, SID_COPIED, SLUG, copiedRows, fixerRows, jsonl, linkedRun, mkdir,
  parentRows, resulted, rm, scratch, started, symlink, testerRows, workflowRows, writeFile, writeTree }
  from './m33-w-workflow-fixture.js';

const CALL2 = 'toolu_01SyntheticWorkflowCall0002';
const CALL3 = 'toolu_01SyntheticWorkflowCall0003';
const OTHER_RUN = 'wf_0d0d0d0d-0d0';
const runDir = (root, session = SID, runId = RUN) => join(root, 'projects', SLUG, session, 'subagents', 'workflows', runId);
const slugDir = (root) => join(root, 'projects', SLUG);

async function load(t, { parent, run = linkedRun(), extraRuns = [], root = null, before = null } = {}) {
  const dir = root ?? await scratch();
  if (!root) t.after(() => rm(dir, { recursive: true, force: true }));
  const previous = process.env.SONAH_HOME;
  process.env.SONAH_HOME = join(dir, 'sonah-home');
  t.after(() => { if (previous === undefined) delete process.env.SONAH_HOME; else process.env.SONAH_HOME = previous; });
  const tree = await writeTree(dir, { parent, run, extraRuns });
  await before?.(dir, tree);
  const codex = join(dir, 'codex-sessions');
  await mkdir(codex, { recursive: true });
  const raw = await loadSessionEvidence([tree.parent], { outcomes: new Map(), reviewLinkedChildren: true,
    recordingRoots: { claude: tree.projects, codex } });
  const ledger = redact(raw).ledger;
  return { dir, tree, raw, ledger, session: adapt(ledger, { sessionKey: 'm33-w' }) };
}
const workflowAgents = (ledger) => (ledger.delegations ?? []).filter((d) => d.kind === 'workflow-agent');
// C-01 event identity: a gap's events are shown by their positional labels (stable-ids-fixture.js `labelOf`).
const agentsLoss = (session) => session.adapterGaps.filter((gap) => gap.note === WORKFLOW_GAP_NOTES.agents)
  .flatMap((gap) => gap.eventIds.map((id) => labelOf(session, id)));
const runGaps = (session) => session.adapterGaps.filter((gap) => gap.channel === 'children'
  && Object.values(WORKFLOW_RUN_GAP_NOTES).includes(gap.note) && gap.note !== WORKFLOW_GAP_NOTES.agents)
  .map((gap) => ({ ...gap, ...(gap.eventIds ? { eventIds: gap.eventIds.map((id) => labelOf(session, id)) } : {}) }));

/** An origin call and a call resuming its run, in this order unless `reversed`. */
function resumedParent(dir, { reversed = false, resume = {}, origin = {} } = {}) {
  const first = workflowRows({ transcriptDir: runDir(dir), ...origin });
  const second = workflowRows({ call: CALL2, task: 'wtask_synthetic_002', transcriptDir: runDir(dir),
    resumeFromRunId: RUN, ...resume });
  return parentRows({ workflows: reversed ? [second, first] : [first, second] });
}

/** Neither call linked; each launched call keeps its own M33 D declaration. */
function neitherLinked(loaded, events, why) {
  assert.equal(loaded.ledger.workflowRuns, undefined, why);
  assert.deepEqual(workflowAgents(loaded.ledger), [], why);
  assert.deepEqual(agentsLoss(loaded.session), events, why);
  assert.equal(loaded.session.events.some((e) => typeof e.workflowRun === 'string'), false, why);
}

// ---- A. resumed runs ------------------------------------------------------------------------------------------------

test('M33 W a resumed run links once, as helpers of its origin call; the resume names the run and carries no loss', async (t) => {
  const dir = await scratch();
  t.after(() => rm(dir, { recursive: true, force: true }));
  const { ledger, session } = await load(t, { root: dir, parent: resumedParent(dir) });
  // M33 W2: a resumed run's receipt is its LAST call's (the resume's notification, row 7), never the origin's.
  // M33 P (W2 recheck minor): both calls recorded a receipt; the earlier one is counted (`earlierReceipts`), and declared.
  assert.deepEqual(ledger.workflowRuns, [{ turn: 1, seq: 0, linked: 2, resumes: [{ turn: 1, seq: 1 }], receipt: { turn: 1, beforeEvent: 2, source: 0, record: 7 },
    earlierReceipts: 1 }]);
  assert.deepEqual(workflowAgents(ledger).map((d) => [d.childId, d.callId, d.turn, d.workflowSeq, d.runId]),
    [[AGENTS.fixer, CALL, 1, 0, RUN], [AGENTS.tester, CALL, 1, 0, RUN]], 'linked once, as the origin\'s helpers');
  assert.equal(ledger.children.length, 2);
  // No M33 D loss for either call, and no run loss: every agent the run names was linked.
  assert.deepEqual(agentsLoss(session), []);
  assert.deepEqual(runGaps(session), []);
  // The resume records a plain reference to the run (the origin's event), never quotable source text.
  const resume = session.event(named(session, 'A1-1'));
  assert.equal(resume.tool, 'Workflow');
  assert.equal(resume.workflowRun, named(session, 'A1-0'));
  assert.equal(session.event(named(session, 'A1-0')).workflowRun, undefined, 'the origin is the run');
  // (Its own recorded input, resumeFromRunId included, stays quotable as before: that is source text.)
  assert.equal(session.sourcesFor(resume).some((source) => source.text.includes(named(session, 'A1-0'))), false);
  assert.ok(session.sourcesFor(resume).some((source) => source.text.includes(RUN)), 'its recorded input is its own');
  // The agents are the origin's helpers, placed by the existing C-03 child placement rule from the origin's row.
  const order = session.events.map((e) => labelOf(session, e.id));
  assert.deepEqual(session.delegations().map((e) => [labelOf(session, e.id), labelOf(session, e.workflowCall)]),
    [['D1-0', 'A1-0'], ['D1-1', 'A1-0']]);
  assert.ok(order.indexOf('D1-0') > order.indexOf('A1-0-r'), 'after the origin and its own result');
  // The resume's own declared loss for its unrecorded script text stays (an actions gap, not a children loss).
  assert.ok(session.adapterGaps.some((gap) => gap.channel === 'actions' && gap.eventIds?.includes(named(session, 'A1-1'))));
});

test('M33 W the origin is the call with no resumeFromRunId, never the first by order', async (t) => {
  const dir = await scratch();
  t.after(() => rm(dir, { recursive: true, force: true }));
  const { ledger, session } = await load(t, { root: dir, parent: resumedParent(dir, { reversed: true }) });
  // M33 W2: the LAST call of the chain in recorded order is the origin here: its receipt (row 7) is the run's.
  assert.deepEqual(ledger.workflowRuns, [{ turn: 1, seq: 1, linked: 2, resumes: [{ turn: 1, seq: 0 }], receipt: { turn: 1, beforeEvent: 2, source: 0, record: 7 },
    earlierReceipts: 1 }]);
  assert.deepEqual(workflowAgents(ledger).map((d) => [d.callId, d.workflowSeq]), [[CALL, 1], [CALL, 1]]);
  assert.equal(session.event(named(session, 'A1-0')).workflowRun, named(session, 'A1-1'));
  assert.deepEqual(agentsLoss(session), []);
});

test('M33 W anything but one origin and resumes naming its run keeps today\'s declaration: neither is linked', async (t) => {
  // A resume with no origin: the run's agents are not this call's to claim.
  let dir = await scratch();
  t.after(() => rm(dir, { recursive: true, force: true }));
  neitherLinked(await load(t, { root: dir, parent: parentRows({ workflows: [workflowRows({ transcriptDir: runDir(dir),
    resumeFromRunId: RUN })] }) }), ['A1-0'], 'a resume with no origin');

  // Two origins (and a resume of their run).
  dir = await scratch();
  t.after(() => rm(dir, { recursive: true, force: true }));
  neitherLinked(await load(t, { root: dir, parent: parentRows({ workflows: [workflowRows({ transcriptDir: runDir(dir) }),
    workflowRows({ call: CALL2, task: 'wtask_synthetic_002', transcriptDir: runDir(dir) }),
    workflowRows({ call: CALL3, task: 'wtask_synthetic_003', transcriptDir: runDir(dir), resumeFromRunId: RUN })] }) }),
  ['A1-0', 'A1-1', 'A1-2'], 'two origins');

  // A resume whose input names another run than its result records.
  dir = await scratch();
  t.after(() => rm(dir, { recursive: true, force: true }));
  neitherLinked(await load(t, { root: dir, parent: resumedParent(dir, { resume: { resumeFromRunId: OTHER_RUN } }) }),
    ['A1-0', 'A1-1'], 'resumeFromRunId naming a different runId');

  // A call resuming this run whose own result names another run: whose agents the journal holds is not proven.
  dir = await scratch();
  t.after(() => rm(dir, { recursive: true, force: true }));
  neitherLinked(await load(t, { root: dir, parent: resumedParent(dir, { resume: { runId: OTHER_RUN,
    transcriptDir: runDir(dir, SID, OTHER_RUN) } }), extraRuns: [linkedRun({ runId: OTHER_RUN, agents: {} })] }),
  ['A1-0', 'A1-1'], 'a resume whose result names another runId');

  // A resume that recorded another run directory: its agents could be elsewhere, so nothing is said to be linked.
  dir = await scratch();
  t.after(() => rm(dir, { recursive: true, force: true }));
  neitherLinked(await load(t, { root: dir, parent: resumedParent(dir, { resume: { transcriptDir: runDir(dir, SID_COPIED) } }) }),
    ['A1-0', 'A1-1'], 'a resume recording another transcriptDir');
});

test('M33 W a resumed run\'s journal agent with two different result lines stays withheld, linked once', async (t) => {
  const dir = await scratch();
  t.after(() => rm(dir, { recursive: true, force: true }));
  const run = linkedRun({ journal: [started(AGENTS.fixer), started(AGENTS.tester), resulted(AGENTS.fixer, RESULTS.fixer),
    resulted(AGENTS.tester, RESULTS.tester), started(AGENTS.fixer), resulted(AGENTS.fixer, { status: 'done' })] });
  const { ledger, session } = await load(t, { root: dir, parent: resumedParent(dir), run });
  assert.deepEqual(ledger.workflowRuns, [{ turn: 1, seq: 0, linked: 2, losses: { workflow_agent_result_conflict: 1 },
    resumes: [{ turn: 1, seq: 1 }], receipt: { turn: 1, beforeEvent: 2, source: 0, record: 7 }, earlierReceipts: 1 }]);
  assert.equal(workflowAgents(ledger)[0].finalAnswer, undefined, 'neither result is attached');
  assert.deepEqual(runGaps(session).map((gap) => [gap.note, gap.eventIds]),
    [[WORKFLOW_RUN_GAP_NOTES.workflow_agent_result_conflict, ['A1-0', 'D1-0']]]);
  assert.deepEqual(agentsLoss(session), []);
});

test('M33 W a resume chain past the frozen nesting depth is declared on its origin, never followed', async (t) => {
  const NESTED = 'wf_0b0b0b0b-0b0';
  const DEEPEST = 'wf_0c0c0c0c-0c0';
  const call = (id, input) => (row) => row('assistant', [{ type: 'tool_use', id, name: 'Workflow', input }], {}, id);
  const result = (id, runId, task) => (row) => row('user', [{ type: 'tool_result', tool_use_id: id,
    content: `Workflow launched in the background.\nTask ID: ${task}` }], { toolUseResult: { runId, status: 'async_launched',
    taskId: task, taskType: 'local_workflow', workflowName: 'nested-run' } }, `${id}:r`);
  const script = { description: 'nested', script: 'export default async function run() {}' };
  const resume = { description: 'nested again', resumeFromRunId: DEEPEST, scriptPath: '/srv/synthetic/nested.js' };
  const deepRows = fixerRows({ agentId: AGENTS.deep, brief: 'Check the nested branch.', extra: [
    call('toolu_deep_wf', script), result('toolu_deep_wf', DEEPEST, 'wtask_deep'),
    call('toolu_deep_wf_resume', resume), result('toolu_deep_wf_resume', DEEPEST, 'wtask_deep_2')] });
  const fixer = fixerRows({ extra: [call('toolu_fixer_wf', script), result('toolu_fixer_wf', NESTED, 'wtask_fixer')] });
  const run = linkedRun({ agents: { [AGENTS.fixer]: fixer, [AGENTS.tester]: testerRows() } });
  const nested = { session: SID, runId: NESTED, journal: [started(AGENTS.deep), resulted(AGENTS.deep, 'checked')],
    agents: { [AGENTS.deep]: deepRows } };
  const deepest = { session: SID, runId: DEEPEST, journal: [started(AGENTS.deeper), resulted(AGENTS.deeper, 'x')],
    agents: { [AGENTS.deeper]: testerRows({ agentId: AGENTS.deeper }) } };
  const dir = await scratch();
  t.after(() => rm(dir, { recursive: true, force: true }));
  const { session, ledger } = await load(t, { root: dir, run, extraRuns: [nested, deepest],
    parent: parentRows({ workflows: [workflowRows({ transcriptDir: runDir(dir) })] }) });
  const deepLedger = ledger.children[0].ledger.children[0].ledger;
  assert.deepEqual(deepLedger.workflowRuns, [{ turn: 1, seq: 2, linked: 0, losses: { workflow_nested_unlinked: 1 },
    resumes: [{ turn: 1, seq: 3 }] }]);
  assert.equal(session.events.some((e) => e.childId === AGENTS.deeper), false);
  const prefix = `child:${AGENTS.fixer}:child:${AGENTS.deep}:`;
  assert.deepEqual(session.adapterGaps.filter((gap) => gap.note === WORKFLOW_RUN_GAP_NOTES.workflow_nested_unlinked)
    .map((gap) => gap.eventIds.map((id) => labelOf(session, id))), [[`${prefix}A1-2`]]);
  assert.equal(session.event(named(session, `${prefix}A1-3`)).workflowRun, named(session, `${prefix}A1-2`),
    'the reference travels with the child');
  assert.equal(agentsLoss(session).some((id) => id.startsWith(prefix)), false);
});

// ---- B. calls copied from an earlier session file --------------------------------------------------------------------

const EARLIER_ONLY = 'Only the earlier session file recorded this sentence.';

/**
 * A continuing parent (session SID) whose one Workflow call is a copy of session SID_COPIED's: same row uuids, the
 * sessionId rewritten. The run lives under SID_COPIED, its agents record SID_COPIED. `earlier(rows)` returns the
 * earlier file's rows (null: no file), `place` writes it (default: <slug>/<SID_COPIED>.jsonl).
 */
async function copiedCase(t, { earlier = (rows) => rows, place = null, agentsSession = SID_COPIED, before = null } = {}) {
  const dir = await scratch();
  t.after(() => rm(dir, { recursive: true, force: true }));
  const call = workflowRows({ sessionId: SID_COPIED, transcriptDir: runDir(dir, SID_COPIED) });
  const earlierRows = [...parentRows({ sessionId: SID_COPIED, workflows: [call] }),
    ...parentRows({ sessionId: SID_COPIED, workflows: [] }).slice(0, 1).map((row) => ({ ...row,
      uuid: '5f0c2d1e-0000-4000-8000-0000000000e1', message: { role: 'user', content: EARLIER_ONLY } }))];
  const parent = parentRows({ workflows: [copiedRows(call, SID)] });
  const run = { ...linkedRun({ session: SID_COPIED }), agents: {
    [AGENTS.fixer]: fixerRows({ sessionId: agentsSession }), [AGENTS.tester]: testerRows({ sessionId: agentsSession }) } };
  const loaded = await load(t, { root: dir, parent, run, before: async (root, tree) => {
    const rows = earlier(earlierRows, call);
    if (rows !== null) {
      const file = place ? await place(root) : join(slugDir(root), `${SID_COPIED}.jsonl`);
      await mkdir(join(file, '..'), { recursive: true });
      await writeFile(file, jsonl(rows), { mode: 0o600 });
    }
    await before?.(root, tree);
  } });
  return { ...loaded, call };
}

test('M33 W a call copied from an earlier session file links that session\'s run when the file records the call', async (t) => {
  const { ledger, session, raw } = await copiedCase(t);
  assert.deepEqual(ledger.workflowRuns, [{ turn: 1, seq: 0, linked: 2, receipt: { turn: 1, beforeEvent: 1, source: 0, record: 4 } }]);
  assert.deepEqual(workflowAgents(ledger).map((d) => [d.childId, d.status]), [[AGENTS.fixer, 'linked'], [AGENTS.tester, 'linked']]);
  assert.deepEqual(agentsLoss(session), []);
  assert.deepEqual(runGaps(session), []);
  // Nothing else of the earlier file reaches the ledger, and neither its path nor its name is quotable.
  for (const value of [raw, ledger]) {
    const json = JSON.stringify(value);
    assert.equal(json.includes(EARLIER_ONLY), false);
    assert.equal(json.includes(`${SID_COPIED}.jsonl`), false);
    assert.equal(json.includes('/subagents/workflows/'), false);
  }
  assert.equal(Object.values(session.blobs).some((blob) => blob.includes(EARLIER_ONLY) || blob.includes(`${SID_COPIED}.jsonl`)), false);
});

test('M33 W a copied run\'s agents must record the earlier session, the run directory\'s own', async (t) => {
  const { ledger, session } = await copiedCase(t, { agentsSession: SID });
  assert.deepEqual(ledger.workflowRuns, [{ turn: 1, seq: 0, linked: 0, losses: { workflow_agent_identity_mismatch: 2 },
    receipt: { turn: 1, beforeEvent: 1, source: 0, record: 4 } }]);
  assert.deepEqual(agentsLoss(session), []);
});

test('M33 W anything less than the earlier file recording the call itself keeps today\'s declaration', async (t) => {
  const changed = (index, change) => (rows) => rows.map((row, i) => {
    if (i !== index) return row;
    const copy = structuredClone(row);
    change(copy);
    return copy;
  });
  // rows[0] is the ask; rows[1] the call's tool_use row; rows[2] its result row.
  for (const [why, options] of [
    ['no earlier file', { earlier: () => null }],
    ['the earlier file misses the tool_use row', { earlier: (rows) => rows.filter((_, i) => i !== 1) }],
    ['the earlier file misses the result row', { earlier: (rows) => rows.filter((_, i) => i !== 2) }],
    ['the same uuid with another tool_use id', { earlier: changed(1, (row) => { row.message.content[1].id = 'toolu_01Other'; }) }],
    ['the same uuid with another sessionId', { earlier: changed(1, (row) => { row.sessionId = SID; }) }],
    ['the result row with the same uuid records another runId', { earlier: changed(2, (row) => {
      row.toolUseResult.runId = OTHER_RUN; }) }],
    ['the earlier file outside the slug', { place: async (root) => join(root, 'projects', '-other-repo', `${SID_COPIED}.jsonl`) }],
    ['the earlier file as a symlink inside the slug', { place: async (root) => join(slugDir(root), 'stash', 'kept.jsonl'),
      before: async (root) => symlink(join(slugDir(root), 'stash', 'kept.jsonl'), join(slugDir(root), `${SID_COPIED}.jsonl`)) }],
    ['the earlier file as a symlink out of the slug', { place: async (root) => join(root, 'elsewhere', `${SID_COPIED}.jsonl`),
      before: async (root) => symlink(join(root, 'elsewhere', `${SID_COPIED}.jsonl`), join(slugDir(root), `${SID_COPIED}.jsonl`)) }],
  ]) {
    const loaded = await copiedCase(t, options);
    neitherLinked(loaded, ['A1-0'], why);
  }
});

test('M33 W an earlier session file that changes while it is read proves nothing', async (t) => {
  let changed = false;
  const loaded = await copiedCase(t, { before: async (root) => {
    const file = join(slugDir(root), `${SID_COPIED}.jsonl`);
    const { ino } = await lstat(file, { bigint: true });
    const handle = await open(file, 'r');
    const prototype = Object.getPrototypeOf(handle);
    const read = prototype.read;
    await handle.close();
    t.mock.method(prototype, 'read', async function (...args) {
      const result = await read.apply(this, args);
      if (!changed && (await this.stat({ bigint: true })).ino === ino) { changed = true; await appendFile(file, '\n'); }
      return result;
    });
  } });
  assert.equal(changed, true, 'the earlier file was read, and changed while it was');
  neitherLinked(loaded, ['A1-0'], 'changed while read');
});

test('M33 W at most 8 earlier session files are read per recording; beyond, every copied call is declared', async (t) => {
  const build = async (count) => {
    const dir = await scratch();
    t.after(() => rm(dir, { recursive: true, force: true }));
    const cases = Array.from({ length: count }, (_, i) => {
      const session = `5f0c2d1e-7a3b-4c1d-9e2f-00000000c1${String(i).padStart(2, '0')}`;
      const runId = `wf_0000000${i}-abc`;
      const agentId = `a${String(i).repeat(16)}`;
      const call = workflowRows({ sessionId: session, call: `toolu_01SyntheticWorkflowCopy00${i}`, task: `wtask_copy_${i}`,
        runId, transcriptDir: runDir(dir, session, runId), notification: false });
      return { session, runId, agentId, call };
    });
    const runs = cases.map(({ session, runId, agentId }) => ({ session, runId,
      journal: [started(agentId), resulted(agentId, 'done')], agents: { [agentId]: testerRows({ agentId, sessionId: session }) } }));
    const parent = parentRows({ workflows: cases.map(({ call }) => copiedRows(call, SID)) });
    return load(t, { root: dir, parent, run: runs[0], extraRuns: runs.slice(1), before: async (root) => {
      for (const { session, call } of cases)
        await writeFile(join(slugDir(root), `${session}.jsonl`), jsonl(parentRows({ sessionId: session, workflows: [call] })),
          { mode: 0o600 });
    } });
  };
  assert.equal(WORKFLOW_LIMITS.copiedSessions, 8);
  const eight = await build(8);
  assert.equal(eight.ledger.workflowRuns?.length, 8, 'eight earlier files: each read, each run linked');
  assert.deepEqual(agentsLoss(eight.session), []);
  const nine = await build(9);
  neitherLinked(nine, Array.from({ length: 9 }, (_, i) => `A1-${i}`), 'nine: none is read, every copied call declared');
});

test('M33 W a copied call that resumes the earlier session\'s run links through its copied origin', async (t) => {
  // Both calls copied from the earlier file: the origin's transcriptDir is proven there, the resume names its run.
  const dir = await scratch();
  t.after(() => rm(dir, { recursive: true, force: true }));
  const origin = workflowRows({ sessionId: SID_COPIED, transcriptDir: runDir(dir, SID_COPIED) });
  const resume = workflowRows({ sessionId: SID_COPIED, call: CALL2, task: 'wtask_synthetic_002',
    transcriptDir: runDir(dir, SID_COPIED), resumeFromRunId: RUN });
  const { ledger, session } = await load(t, { root: dir, run: linkedRun({ session: SID_COPIED }),
    parent: parentRows({ workflows: [copiedRows(origin, SID), copiedRows(resume, SID)] }),
    before: async (root) => writeFile(join(slugDir(root), `${SID_COPIED}.jsonl`),
      jsonl(parentRows({ sessionId: SID_COPIED, workflows: [origin, resume] })), { mode: 0o600 }) });
  // M33 P (W2 recheck minor): both calls recorded a receipt; the earlier one is counted (`earlierReceipts`), and declared.
  assert.deepEqual(ledger.workflowRuns, [{ turn: 1, seq: 0, linked: 2, resumes: [{ turn: 1, seq: 1 }], receipt: { turn: 1, beforeEvent: 2, source: 0, record: 7 },
    earlierReceipts: 1 }]);
  assert.deepEqual(agentsLoss(session), []);
});

test('M33 W the earlier file is read row by row: only lines naming a wanted uuid are parsed, only its own rows kept', async (t) => {
  const dir = await scratch();
  t.after(() => rm(dir, { recursive: true, force: true }));
  const namespace = join(dir, 'ns');
  await mkdir(namespace, { recursive: true });
  const [U1, U2, U3, U4] = ['5f0c2d1e-0000-4000-8000-0000000000b1', '5f0c2d1e-0000-4000-8000-0000000000b2',
    '5f0c2d1e-0000-4000-8000-0000000000b3', '5f0c2d1e-0000-4000-8000-0000000000b4'];
  const own = { uuid: U1, sessionId: SID_COPIED, type: 'assistant' };
  const file = join(namespace, `${SID_COPIED}.jsonl`);
  await writeFile(file, [JSON.stringify(own), JSON.stringify({ uuid: U4, parentUuid: U1, type: 'user' }),
    `{"uuid":"${U2}","type":`, `{"uuid":"${U3}","uuid":"${U3}"}`, 'not json, and naming no wanted row',
    JSON.stringify({ uuid: U4, text: 'unwanted' }), ''].join('\n'), { mode: 0o600 });
  const options = { namespace, uuids: [U1, U2, U3], maxBytes: 1_000_000, maxRows: 10 };
  const rows = await readRecordingRows(file, options);
  assert.deepEqual([...rows.entries()], [[U1, [own]], [U2, [null]], [U3, [null]]],
    'a row naming a wanted uuid only as its parent is not that row; an unreadable line naming one reads as null');
  await assert.rejects(readRecordingRows(file, { ...options, maxRows: 2 }), (error) => error.reason === 'records');
  await assert.rejects(readRecordingRows(file, { ...options, maxBytes: 64, maxLineBytes: 64 }),
    (error) => error.reason === 'bytes');
  const alias = join(namespace, 'alias.jsonl');
  await symlink(file, alias);
  await assert.rejects(readRecordingRows(alias, options), (error) => error.reason === 'unverified');
  await assert.rejects(readRecordingRows(file, { ...options, namespace: join(dir, 'elsewhere') }));
});
