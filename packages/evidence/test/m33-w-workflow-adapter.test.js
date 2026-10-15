// M33 W (Claude Code Workflow agents), the ledger adapter. A Workflow call's run record replaces its M33 D children
// loss only when it is exactly valid; every loss it records is one closed note naming the call's event; a linked agent
// is a helper (delegate event, `Workflow`) of that call, its report closing its block. Synthetic ledgers only.
import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { sessionFromLedger, WORKFLOW_GAP_NOTES, WORKFLOW_RUN_GAP_NOTES, WORKFLOW_RUN_GAPS }
  from '../adapters/sonah-ledger.js';
import { adapt, named, labelOf } from './stable-ids-fixture.js';
import { GAP_CODES } from '../src/ledger.js';
import { WORKFLOW_RUN_NOTES, WORKFLOW_RUN_LOSSES, workflowLaunched } from '../../slicer/src/workflow-runs.js';
import { loadSessionEvidence } from '../../cli/src/session-evidence.js';
import { redact } from '../../redact/index.js';
import { AGENTS, RUN, SID, SLUG, fixerRows, linkedRun, mkdir, parentRows, rm, scratch, workflowRows, writeTree }
  from '../../cli/test/m33-w-workflow-fixture.js';

async function linkedLedger(t, run = linkedRun()) {
  const dir = await scratch();
  t.after(() => rm(dir, { recursive: true, force: true }));
  const previous = process.env.SONAH_HOME;
  process.env.SONAH_HOME = join(dir, 'home');
  t.after(() => { if (previous === undefined) delete process.env.SONAH_HOME; else process.env.SONAH_HOME = previous; });
  const transcriptDir = join(dir, 'projects', SLUG, SID, 'subagents', 'workflows', RUN);
  const tree = await writeTree(dir, { parent: parentRows({ workflows: [workflowRows({ transcriptDir })] }), run });
  await mkdir(join(dir, 'codex'), { recursive: true });
  return redact(await loadSessionEvidence([tree.parent], { outcomes: new Map(), reviewLinkedChildren: true,
    recordingRoots: { claude: tree.projects, codex: join(dir, 'codex') } })).ledger;
}
// C-01 event identity: a session adapted here is registered, so its events are named by their positional labels
// (stable-ids-fixture.js: `A<turn>-<seq>`, `D<turn>-<index>`), never by parsing an id; a gap's events are shown so.
const adapted = (ledger) => adapt(ledger, { sessionKey: 'session' });
const agentsLoss = (session) => session.adapterGaps.filter((gap) => gap.note === WORKFLOW_GAP_NOTES.agents)
  .map((gap) => ({ ...gap, ...(gap.eventIds ? { eventIds: gap.eventIds.map((id) => labelOf(session, id)) } : {}) }));

test('M33 W the adapter\'s run notes are the slicer\'s closed vocabulary, in its order, with known gap codes', () => {
  assert.deepEqual(Object.keys(WORKFLOW_RUN_GAP_NOTES), Object.values(WORKFLOW_RUN_NOTES));
  assert.deepEqual(WORKFLOW_RUN_GAPS.map(([note]) => note), WORKFLOW_RUN_LOSSES);
  assert.equal(WORKFLOW_RUN_GAP_NOTES.workflow_run_unresolved, WORKFLOW_GAP_NOTES.agents,
    'an unresolved run reuses the M33 D note, which says exactly that');
  for (const [, code] of WORKFLOW_RUN_GAPS) assert.ok(GAP_CODES.includes(code), code);
  const notes = Object.values(WORKFLOW_RUN_GAP_NOTES);
  assert.equal(new Set(notes).size, notes.length, 'one fixed note per loss');
  assert.ok(Object.isFrozen(WORKFLOW_RUN_GAP_NOTES) && Object.isFrozen(WORKFLOW_RUN_GAPS));
});

test('M33 W only an exactly valid run record replaces the call\'s M33 D loss (fail closed)', async (t) => {
  const ledger = await linkedLedger(t);
  assert.deepEqual(agentsLoss(adapted(ledger)), []);
  const forged = (change) => { const copy = structuredClone(ledger); change(copy); return adapted(copy); };
  for (const [why, change] of [
    ['no record', (l) => { delete l.workflowRuns; }],
    ['an unknown loss', (l) => { l.workflowRuns[0].losses = { workflow_something_else: 1 }; }],
    ['a zero count', (l) => { l.workflowRuns[0].losses = { workflow_agent_unstarted: 0 }; }],
    ['an empty loss table', (l) => { l.workflowRuns[0].losses = {}; }],
    ['a count that is not one', (l) => { l.workflowRuns[0].losses = { workflow_agent_unstarted: '1' }; }],
    ['a linked count no hand-off backs', (l) => { l.workflowRuns[0].linked = 3; }],
    ['a hand-off the record does not count', (l) => { l.workflowRuns[0].linked = 1; }],
    ['two records for one call', (l) => { l.workflowRuns.push({ ...l.workflowRuns[0] }); }],
    ['a record for no Workflow action', (l) => { l.workflowRuns[0].seq = 7; }],
    ['an extra field', (l) => { l.workflowRuns[0].note = 'x'; }],
    ['a report loss no hand-off names', (l) => { l.workflowRuns[0].losses = { workflow_agent_no_result: 1 }; }],
    ['a hand-off naming a report loss the record does not count', (l) => { l.delegations[0].reportLoss = 'workflow_agent_no_result'; }],
    ['a record that accounts for nothing', (l) => { l.workflowRuns[0].linked = 0; l.delegations = []; }],
  ]) {
    const session = forged(change);
    assert.deepEqual(agentsLoss(session).map((gap) => gap.eventIds), [['A1-0']], why);
  }
});

test('M33 W the M33 D launch rule is one rule: the slicer\'s and the adapter\'s agree on every launch shape', () => {
  const launched = { tool: 'Workflow', turn: 1, seq: 0, workflowAsyncUnresolved: true };
  const shapes = [launched, { ...launched, workflowAsyncUnresolved: undefined, result: { seen: true, outcome: 'unknown' } },
    { ...launched, isError: true }, { ...launched, observationMissing: true }, { ...launched, interrupted: true },
    { ...launched, conflict: true }, { ...launched, outcomeUnknown: true }, { ...launched, result: { outcome: 'failed' } },
    { tool: 'Workflow', turn: 1, seq: 0 }];
  for (const act of shapes) {
    const session = sessionFromLedger({ ask: [{ turn: 1, text: 'go' }], ledger: [act], claim: {}, dropped: [] });
    const declared = session.adapterGaps.find((gap) => gap.channel === 'children' && gap.eventIds?.includes('A1-0'));
    assert.equal(declared.note === WORKFLOW_GAP_NOTES.agents, workflowLaunched(act), JSON.stringify(act));
  }
});

test('M33 W a Workflow agent is a delegate event of the call: tool, the call\'s event and a plain workflow name only', async (t) => {
  const ledger = await linkedLedger(t);
  const session = adapted(ledger);
  const [first] = session.delegations();
  assert.deepEqual([first.tool, first.workflowCall, first.workflowName, first.input],
    ['Workflow', named(session, 'A1-0'), 'fix-parser', []]);
  // Neither field is source text: no review request reads them, and no quote can cite them.
  assert.equal(session.sourcesFor(first).some((source) => source.text.includes('fix-parser')), false);
  const renamed = structuredClone(ledger);
  for (const d of renamed.delegations) { d.workflowName = 'fix parser'; d.workflowSeq = 9; }
  const odd = adapted(renamed).delegations()[0];
  assert.equal(Object.hasOwn(odd, 'workflowName'), false, 'not a plain identifier: no name');
  assert.equal(Object.hasOwn(odd, 'workflowCall'), false, 'no Workflow action at that position: no call named');
});

test('M33 W a linked agent\'s own capture gaps flow up as an Agent helper\'s do', async (t) => {
  // The fixer's recording carries one row of a type no reader knows: its own declared loss.
  const odd = (row) => ({ ...row('user', 'x'), type: 'mystery_row', message: undefined, payload: { content: 'unknown' } });
  const ledger = await linkedLedger(t, linkedRun({ agents: { [AGENTS.fixer]: fixerRows({ extra: [odd] }),
    [AGENTS.tester]: linkedRun().agents[AGENTS.tester] } }));
  const session = adapted(ledger);
  assert.ok(ledger.children[0].ledger.capture?.incomplete, 'the agent declares its own loss');
  assert.ok(session.adapterGaps.some((gap) => gap.note === 'the linked child session declares an incomplete capture of its own'
    && gap.eventIds?.includes(named(session, 'D1-0'))), 'named on its hand-off');
  assert.ok(session.adapterGaps.some((gap) => gap.sessionKey === `session/child:${AGENTS.fixer}`),
    'and its own gaps travel with it');
  assert.deepEqual(agentsLoss(session), [], 'the run itself was linked whole');
});

// ---- M33 W repair 2: resumed runs -----------------------------------------------------------------------------------

async function resumedLedger(t) {
  const dir = await scratch();
  t.after(() => rm(dir, { recursive: true, force: true }));
  const previous = process.env.SONAH_HOME;
  process.env.SONAH_HOME = join(dir, 'home');
  t.after(() => { if (previous === undefined) delete process.env.SONAH_HOME; else process.env.SONAH_HOME = previous; });
  const transcriptDir = join(dir, 'projects', SLUG, SID, 'subagents', 'workflows', RUN);
  const parent = parentRows({ workflows: [workflowRows({ transcriptDir }), workflowRows({ call: 'toolu_01SyntheticWorkflowCall0002',
    task: 'wtask_synthetic_002', transcriptDir, resumeFromRunId: RUN })] });
  const tree = await writeTree(dir, { parent, run: linkedRun() });
  await mkdir(join(dir, 'codex'), { recursive: true });
  return redact(await loadSessionEvidence([tree.parent], { outcomes: new Map(), reviewLinkedChildren: true,
    recordingRoots: { claude: tree.projects, codex: join(dir, 'codex') } })).ledger;
}

test('M33 W a resume call named by a valid run record carries no M33 D loss and a plain reference to the run', async (t) => {
  const ledger = await resumedLedger(t);
  // M33 P (W2 recheck minor): the origin recorded a receipt of its own before the resume's (`earlierReceipts`).
  assert.deepEqual(ledger.workflowRuns, [{ turn: 1, seq: 0, linked: 2, resumes: [{ turn: 1, seq: 1 }],
    receipt: { turn: 1, beforeEvent: 2, source: 0, record: 7 }, earlierReceipts: 1 }]);
  const session = adapted(ledger);
  assert.deepEqual(agentsLoss(session), []);
  const resume = session.event(named(session, 'A1-1'));
  assert.equal(resume.workflowRun, named(session, 'A1-0'));
  assert.equal(session.sourcesFor(resume).some((source) => source.text.includes(named(session, 'A1-0'))), false,
    'never quotable');
});

test('M33 W only an exactly valid resume list replaces a resume call\'s M33 D loss, and a bad one keeps both (fail closed)', async (t) => {
  const ledger = await resumedLedger(t);
  const forged = (change) => { const copy = structuredClone(ledger); change(copy); return adapted(copy); };
  for (const [why, change, events] of [
    ['no resume list', (l) => { delete l.workflowRuns[0].resumes; delete l.workflowRuns[0].earlierReceipts; }, ['A1-1']],
    // M33 P: earlier receipts of a chain with no resume is no record.
    ['earlier receipts but no resume list', (l) => { delete l.workflowRuns[0].resumes; }, ['A1-0', 'A1-1']],
    ['more earlier receipts than resumes', (l) => { l.workflowRuns[0].earlierReceipts = 2; }, ['A1-0', 'A1-1']],
    ['earlier receipts that are not a count', (l) => { l.workflowRuns[0].earlierReceipts = 0; }, ['A1-0', 'A1-1']],
    ['an empty resume list', (l) => { l.workflowRuns[0].resumes = []; }, ['A1-0', 'A1-1']],
    ['a resume list that is not a list', (l) => { l.workflowRuns[0].resumes = { turn: 1, seq: 1 }; }, ['A1-0', 'A1-1']],
    ['a resume naming no Workflow action', (l) => { l.workflowRuns[0].resumes = [{ turn: 1, seq: 7 }]; }, ['A1-0', 'A1-1']],
    ['a resume naming the origin', (l) => { l.workflowRuns[0].resumes = [{ turn: 1, seq: 0 }]; }, ['A1-0', 'A1-1']],
    ['a resume named twice', (l) => { l.workflowRuns[0].resumes = [{ turn: 1, seq: 1 }, { turn: 1, seq: 1 }]; }, ['A1-0', 'A1-1']],
    ['a resume with an extra field', (l) => { l.workflowRuns[0].resumes = [{ turn: 1, seq: 1, runId: RUN }]; }, ['A1-0', 'A1-1']],
    ['a resume whose seq is not a count', (l) => { l.workflowRuns[0].resumes = [{ turn: 1, seq: '1' }]; }, ['A1-0', 'A1-1']],
    ['a resume another record also names', (l) => { l.workflowRuns.push({ turn: 1, seq: 1, linked: 0,
      losses: { workflow_journal_missing: 1 } }); }, ['A1-0', 'A1-1']],
  ]) {
    const session = forged(change);
    assert.deepEqual(agentsLoss(session).flatMap((gap) => gap.eventIds), events, why);
    assert.equal(session.event(named(session, 'A1-1')).workflowRun, undefined, why);
  }
  // A resume that did not launch is never a resume of the run: the record is not valid, and that call keeps its own
  // note that it recorded no successful launch.
  const failed = forged((l) => { l.ledger.find((act) => act.turn === 1 && act.seq === 1).isError = true; });
  assert.deepEqual(agentsLoss(failed).flatMap((gap) => gap.eventIds), ['A1-0']);
  assert.ok(failed.adapterGaps.some((gap) => gap.note === WORKFLOW_GAP_NOTES.unlaunched
    && gap.eventIds.includes(named(failed, 'A1-1'))));
});
