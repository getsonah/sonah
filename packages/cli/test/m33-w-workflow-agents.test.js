// M33 W (Claude Code Workflow agents), end to end through the loader a session-only review uses: a Workflow call's
// agents are linked by exact recorded identity, read and reviewed as helpers of that call; every agent that does not
// link is declared under exactly one closed note naming the call's event; nothing is guessed. Synthetic projects
// trees in a temp directory (cli/test/m33-w-workflow-fixture.js); no recording, no model, no network.
import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { loadSessionEvidence } from '../src/session-evidence.js';
import { keptIdentities, locateWorkflowRun } from '../src/workflow-agents.js';
import { redact } from '../../redact/index.js';
import { sessionFromLedger, WORKFLOW_GAP_NOTES, WORKFLOW_RUN_GAP_NOTES } from '../../evidence/adapters/sonah-ledger.js';
// C-01 event identity: sessions are registered, and their events named by positional labels (stable-ids-fixture.js).
import { adapt, named, labelOf, withoutIdentity, withoutRecordedFacts } from '../../evidence/test/stable-ids-fixture.js';
import { runReview, planWindowRequests } from '../../evidence/src/run-review.js';
import { renderReportMarkdown } from '../../render/session-story.js';
import { captureCase, windowNarrative, fixtureJudge } from './m33-fast-profile-fixture.js';
import { modulesBeforeRelayRule } from '../../evidence/test/m33-h-relay-rule-fixture.js';
import { modulesBeforeForbiddenEdit, modulesBeforeDisclosureWords } from '../../evidence/test/m33-n-forbidden-edit-fixture.js';
import { modulesBeforeStatusFact } from '../../evidence/test/status-fact-fixture.js';
import { modulesBeforeHedgedClaims } from '../../evidence/test/h3-hedged-claims-fixture.js';
import { modulesBeforeM36Conversation, modulesBeforeW1, modulesBeforeW2, modulesBeforeW3, modulesBeforeFixReview }
  from '../../evidence/test/m33-integration-fixture.js';
import { AGENTS, CALL, RESULTS, RUN, SID, SID_EARLIER, SLUG, TEXT, captureStableCases, fixerRows, journalKey,
  linkedRun, mkdir, parentRows, resulted, rm, scratch, started, symlink, testerRows, workflowRows, writeFile, writeTree }
  from './m33-w-workflow-fixture.js';

const runDir = (root, session = SID, runId = RUN) => join(root, 'projects', SLUG, session, 'subagents', 'workflows', runId);

/** Build a tree, load it as a session-only review does, and adapt it. */
async function load(t, { parent, run = linkedRun(), extraRuns = [], transcriptDir, root = null, roots = {} } = {}) {
  const dir = root ?? await scratch();
  if (!root) t.after(() => rm(dir, { recursive: true, force: true }));
  const previous = process.env.SONAH_HOME;
  process.env.SONAH_HOME = join(dir, 'sonah-home');
  t.after(() => { if (previous === undefined) delete process.env.SONAH_HOME; else process.env.SONAH_HOME = previous; });
  const parentRowsOf = parent ?? parentRows({ workflows: [workflowRows({
    transcriptDir: transcriptDir === undefined ? runDir(dir) : transcriptDir })] });
  const tree = await writeTree(dir, { parent: parentRowsOf, run, extraRuns });
  await roots.before?.(dir, tree);
  const codex = join(dir, 'codex-sessions');
  await mkdir(codex, { recursive: true });
  const raw = await loadSessionEvidence([tree.parent], { outcomes: new Map(), reviewLinkedChildren: true,
    recordingRoots: { claude: tree.projects, codex } });
  const ledger = redact(raw).ledger;
  return { dir, tree, raw, ledger, session: adapt(ledger, { sessionKey: 'm33-w' }) };
}

const childrenGaps = (session) => session.adapterGaps.filter((gap) => gap.channel === 'children');
const workflowGaps = (session) => childrenGaps(session)
  .filter((gap) => Object.values(WORKFLOW_RUN_GAP_NOTES).includes(gap.note));
// C-01 event identity: an event is named here by its id or its positional label (stable-ids-fixture.js `named`).
const idOf = (session, id) => (session.event(id) ? id : named(session, id));
const text = (session, id, field) => session.textSpansOf(session.event(idOf(session, id)), field).join('');
const relabelled = (session, ids) => (ids ?? []).map((id) => labelOf(session, id));

test('M33 W a linked run: both agents are helpers of the Workflow call, briefs and reports attached, the M33 D loss gone', async (t) => {
  const { ledger, session, raw } = await load(t);
  // M33 W2: the run record names where the parent received the run's completion (its notification, row 4).
  assert.deepEqual(ledger.workflowRuns, [{ turn: 1, seq: 0, linked: 2, receipt: { turn: 1, beforeEvent: 1, source: 0, record: 4 } }]);
  const agents = ledger.delegations.filter((d) => d.kind === 'workflow-agent');
  assert.deepEqual(agents.map((d) => [d.childId, d.status, d.runId, d.callId, d.turn, d.workflowSeq, d.workflowName]),
    [[AGENTS.fixer, 'linked', RUN, CALL, 1, 0, 'fix-parser'], [AGENTS.tester, 'linked', RUN, CALL, 1, 0, 'fix-parser']]);
  // The report is the exact recorded JSON text of the journal's result value: a literal substring of its line.
  assert.equal(agents[0].finalAnswer.text, JSON.stringify(RESULTS.fixer));
  assert.equal(agents[1].finalAnswer.text, JSON.stringify(RESULTS.tester));
  assert.ok(resulted(AGENTS.fixer, RESULTS.fixer).includes(agents[0].finalAnswer.text));
  assert.equal(ledger.children.length, 2);
  // The side channel never leaves the loader; no path of the recording is in the ledger.
  for (const value of [raw, ledger]) {
    const json = JSON.stringify(value);
    assert.equal(json.includes('workflowLaunches'), false);
    assert.equal(json.includes('transcriptDir'), false);
    assert.equal(json.includes('/subagents/workflows/'), false);
  }

  const delegates = session.delegations();
  assert.deepEqual(delegates.map((e) => [labelOf(session, e.id), e.tool, labelOf(session, e.workflowCall), e.workflowName,
    e.input.length]), [['D1-0', 'Workflow', 'A1-0', 'fix-parser', 0], ['D1-1', 'Workflow', 'A1-0', 'fix-parser', 0]]);
  for (const [label, agentId, brief] of [['D1-0', AGENTS.fixer, TEXT.fixerBrief], ['D1-1', AGENTS.tester, TEXT.testerBrief]]) {
    const id = named(session, label);
    const link = session.childFor(id);
    assert.equal(link.state, 'verified');
    assert.equal(link.childId, agentId);
    // The brief the agent received: its first instruction, agent authority, whole.
    const instruction = session.events.find((e) => e.childId === agentId && e.kind === 'instruction');
    assert.equal(instruction.authority, 'agent');
    assert.equal(session.textSpansOf(instruction, 'text').join(''), brief);
    // The report: the hand-off's own result, after the agent's history (closing its block), quotable as observation.
    const result = session.observationFor(id);
    assert.equal(result.helperReported, true);
    assert.equal(result.result, 'unknown');
    const order = session.events.map((e) => e.id);
    const own = order.filter((eventId) => session.event(eventId).childId === agentId);
    assert.ok(order.indexOf(result.id) > order.indexOf(own[own.length - 1]), 'the report closes the agent block');
    assert.ok(session.sourcesFor(result).some((s) => s.role === 'observation' && s.text.includes('"')), 'quotable');
  }
  assert.equal(text(session, 'D1-0-r', 'output'), JSON.stringify(RESULTS.fixer));
  // No children-channel loss names the call any more: every agent the run named was linked.
  assert.deepEqual(childrenGaps(session).filter((gap) => gap.eventIds?.includes(named(session, 'A1-0'))), []);
  assert.equal(session.adapterGaps.some((gap) => gap.note === WORKFLOW_GAP_NOTES.agents), false);
  // The call keeps its own observation gap: its notification's result text is still not read.
  assert.ok(session.adapterGaps.some((gap) => gap.note === WORKFLOW_GAP_NOTES.notified
    && gap.eventIds.includes(named(session, 'A1-0'))));
});

test('M35 W the helpers are reviewed, each as a session of its own: an agent\'s failing run is in its own session', async (t) => {
  // M35 windowing: a Workflow agent is a helper, and a helper is a session of its own, reviewed right after the parent
  // window that launched it — so the agent's failing run and the parent's "all tests pass" are not one session (they were
  // under M33 W; D67 states the loss). M36 phase 3 (D68 K): small sessions share a window,
  // each under its own heading — the agent's run is its own session's, never evidence against the parent's statement
  // (c6: `other_session`).
  const { session } = await load(t);
  const plan = planWindowRequests({ session, reviewScope: 'session-only' });
  assert.equal(plan.windows.length, 1, 'one window');
  const parts = plan.windows[0].parts;
  assert.equal(parts.length, 3, 'the parent\'s session and one for each agent');
  const ids = parts[0].events.map((e) => e.id);
  const failing = named(session, `child:${AGENTS.fixer}:A1-1-r`);
  const claim = session.events.find((e) => e.kind === 'commentary' && text(session, e.id, 'text') === TEXT.claim).id;
  assert.equal(session.event(failing).result, 'failed');
  assert.ok(ids.includes(claim) && !ids.includes(failing), 'the parent\'s session holds its claim, never the agent\'s run');
  const fixer = parts.find((part) => part.events.some((e) => e.id === failing));
  assert.ok(fixer.session.helper && fixer.session.launchedBy === named(session, 'D1-0'));
  const [{ request }] = plan.requests;
  assert.ok(request.evidencePrompt.includes('FAIL test/parser.test.js'));
  assert.ok(request.evidencePrompt.includes(TEXT.fixerBrief), 'the agent\'s section shows the brief it was given');
  const tester = parts.find((part) => part.session.helper
    && part.events.some((e) => e.id === named(session, `child:${AGENTS.tester}:A1-0`)));
  assert.ok(tester && request.evidencePrompt.includes(TEXT.testerBrief));
  for (const quote of [TEXT.claim, '"Ran npm test: 12 passed."']) assert.ok(request.evidencePrompt.includes(quote), quote);
  for (const id of ['D1-0', 'D1-1']) assert.ok(ids.includes(named(session, id)), id);
  // Reviewed like any helper: a full review of this session completes its window.
  const report = await runReview({ session, pr: null, reviewScope: 'session-only', concurrency: 1,
    judge: fixtureJudge({ narrativeOf: (r) => windowNarrative(session, r.window) }) });
  assert.equal(report.windowFailures.length, 0);
});

test('M33 W moving request bytes is intended for a linked session, and only for it', async (t) => {
  const linked = await load(t);
  const unlinked = await load(t, { run: null });
  const capture = (session) => captureCase({ runReview, planWindowRequests },
    { name: 'x', session, narrativeOf: (s, r) => windowNarrative(s, r.window) });
  assert.notEqual((await capture(linked.session)).planned, (await capture(unlinked.session)).planned);
  assert.deepEqual(unlinked.ledger.workflowRuns, undefined);
  assert.ok(unlinked.session.adapterGaps.some((gap) => gap.note === WORKFLOW_GAP_NOTES.agents
    && gap.eventIds.includes(named(unlinked.session, 'A1-0'))),
  'an unresolved run keeps its M33 D declaration (workflow_run_unresolved)');
});

test('M33 W a run that resolves but links no agent moves the ledger and its gaps only, never a request, and the report only where it says them', async (t) => {
  // D97: the report .md (the story since /32) says what Sonah could not check, the gaps among it: that section is the
  // only one a gap moves, so it is left out of the comparison; every other byte of the report holds.
  const unchecked = (md) => md.slice(0, md.indexOf('<details><summary>What Sonah could not check'));
  const capture = async (session) => {
    const requests = await captureCase({ runReview, planWindowRequests },
      { name: 'x', session, narrativeOf: (s, r) => windowNarrative(s, r.window) });
    const report = await runReview({ session, pr: null, reviewScope: 'session-only', concurrency: 1,
      judge: fixtureJudge({ narrativeOf: (r) => windowNarrative(session, r.window) }) });
    return { ...requests, story: unchecked(renderReportMarkdown(session, report)) };
  };
  const unresolved = await capture((await load(t, { run: null })).session);
  const base = linkedRun();
  for (const run of [{ ...base, journal: null }, { ...base, journal: ['not json'] }, { ...base, agents: {} },
    { ...base, agents: { [AGENTS.fixer]: testerRows({ agentId: AGENTS.stray }) }, journal: [started(AGENTS.fixer)] }]) {
    const loaded = await load(t, { run });
    assert.equal(loaded.ledger.workflowRuns.length, 1);
    assert.deepEqual(await capture(loaded.session), unresolved);
  }
});

/** Load a run variant; return its Workflow gaps and linked agent ids. */
async function variant(t, run, options = {}) {
  const loaded = await load(t, { run, ...options });
  return { ...loaded, gaps: workflowGaps(loaded.session),
    linked: (loaded.ledger.delegations ?? []).filter((d) => d.kind === 'workflow-agent').map((d) => d.childId) };
}
/** Exactly one Workflow gap: this note, naming the call's event (first), with this count and code; no M33 D loss. */
function declaredOnce(session, gaps, note, { count = 1, code, extra = [] } = {}) {
  assert.deepEqual(gaps.map((gap) => gap.note), [WORKFLOW_RUN_GAP_NOTES[note]], note);
  assert.equal(labelOf(session, gaps[0].eventIds[0]), 'A1-0');
  assert.deepEqual(relabelled(session, gaps[0].eventIds.slice(1)), extra);
  assert.equal(gaps[0].count, count);
  if (code) assert.equal(gaps[0].code, code);
  assert.equal(session.adapterGaps.some((gap) => gap.note === WORKFLOW_GAP_NOTES.agents), false, 'replaced, not doubled');
  assert.equal(session.adapterGaps.filter((gap) => gap.note === WORKFLOW_RUN_GAP_NOTES[note]).length, 1);
}

test('M33 W each run loss is declared exactly once, with the Workflow call\'s event', async (t) => {
  const base = linkedRun();
  let v = await variant(t, { ...base, journal: null });
  declaredOnce(v.session, v.gaps, 'workflow_journal_missing', { code: 'incomplete_inventory' });
  assert.deepEqual(v.linked, []);
  assert.deepEqual(v.ledger.workflowRuns, [{ turn: 1, seq: 0, linked: 0, losses: { workflow_journal_missing: 1 },
    receipt: { turn: 1, beforeEvent: 1, source: 0, record: 4 } }]);

  v = await variant(t, { ...base, journal: [...base.journal, '{"type":"started","agentId":"broken"'] });
  declaredOnce(v.session, v.gaps, 'workflow_journal_unreadable', { code: 'incomplete_inventory' });
  assert.deepEqual(v.linked, [], 'an unreadable journal is not read: nothing links');

  v = await variant(t, { ...base, agents: { [AGENTS.tester]: testerRows() } });
  declaredOnce(v.session, v.gaps, 'workflow_agent_recording_missing', { code: 'missing_child' });
  assert.deepEqual(v.linked, [AGENTS.tester]);

  v = await variant(t, { ...base, journal: [started(AGENTS.fixer), resulted(AGENTS.fixer, RESULTS.fixer)] });
  declaredOnce(v.session, v.gaps, 'workflow_agent_unstarted', { code: 'incomplete_inventory' });
  assert.deepEqual(v.linked, [AGENTS.fixer], 'a recording no started line names is never linked');

  for (const agents of [
    { [AGENTS.fixer]: fixerRows(), [AGENTS.tester]: testerRows({ agentId: AGENTS.stray }) },
    { [AGENTS.fixer]: fixerRows(), [AGENTS.tester]: testerRows({ sessionId: SID_EARLIER }) },
    { [AGENTS.fixer]: fixerRows(), [AGENTS.tester]: [...testerRows(), ...testerRows({ agentId: AGENTS.stray }).slice(1)] },
  ]) {
    v = await variant(t, { ...base, agents });
    declaredOnce(v.session, v.gaps, 'workflow_agent_identity_mismatch', { code: 'identity_conflict' });
    assert.deepEqual(v.linked, [AGENTS.fixer], 'rows whose agentId or sessionId disagree are never linked');
  }

  v = await variant(t, { ...base, journal: [started(AGENTS.fixer), started(AGENTS.tester), resulted(AGENTS.fixer, RESULTS.fixer)] });
  declaredOnce(v.session, v.gaps, 'workflow_agent_no_result', { code: 'missing_result', extra: ['D1-1'] });
  assert.deepEqual(v.linked, [AGENTS.fixer, AGENTS.tester], 'linked and reviewed; only its report is missing');
  assert.equal(v.session.observationFor(named(v.session, 'D1-1')), null, 'no report is inferred from its last statement');

  v = await variant(t, { ...base, journal: [...base.journal, resulted(AGENTS.tester, 'Ran npm test: 11 passed.')] });
  declaredOnce(v.session, v.gaps, 'workflow_agent_result_conflict', { code: 'missing_result', extra: ['D1-1'] });
  assert.equal(v.session.observationFor(named(v.session, 'D1-1')), null, 'neither conflicting result is attached');
  assert.equal(v.session.observationFor(named(v.session, 'D1-0')).helperReported, true);

  // Both report losses on one call stay two declarations (distinct events), never collapsed into one.
  v = await variant(t, { ...base, journal: [started(AGENTS.fixer), started(AGENTS.tester),
    resulted(AGENTS.tester, 'one'), resulted(AGENTS.tester, 'two')] });
  assert.deepEqual(v.gaps.map((gap) => [gap.note, relabelled(v.session, gap.eventIds)]), [
    [WORKFLOW_RUN_GAP_NOTES.workflow_agent_no_result, ['A1-0', 'D1-0']],
    [WORKFLOW_RUN_GAP_NOTES.workflow_agent_result_conflict, ['A1-0', 'D1-1']]]);
});

test('M33 W a nested run is linked to the frozen depth, and declared past it', async (t) => {
  const NESTED = 'wf_0b0b0b0b-0b0';
  const DEEPEST = 'wf_0c0c0c0c-0c0';
  const nestedCall = (call, runId) => (row) => row('assistant', [{ type: 'tool_use', id: call, name: 'Workflow',
    input: { description: 'nested', script: 'export default async function run() {}' } }], {}, call);
  const nestedResult = (call, runId, task) => (row) => row('user', [{ type: 'tool_result', tool_use_id: call,
    content: `Workflow launched in the background.\nTask ID: ${task}` }], { toolUseResult: { runId, status: 'async_launched',
    taskId: task, taskType: 'local_workflow', workflowName: 'nested-run' } }, `${call}:r`);
  const deepRows = fixerRows({ agentId: AGENTS.deep, brief: 'Check the nested branch.',
    extra: [nestedCall('toolu_deep_wf', DEEPEST), nestedResult('toolu_deep_wf', DEEPEST, 'wtask_deep')] });
  const fixer = fixerRows({ extra: [nestedCall('toolu_fixer_wf', NESTED), nestedResult('toolu_fixer_wf', NESTED, 'wtask_fixer')] });
  const run = linkedRun({ agents: { [AGENTS.fixer]: fixer, [AGENTS.tester]: testerRows() } });
  const nested = { session: SID, runId: NESTED, journal: [started(AGENTS.deep), resulted(AGENTS.deep, 'checked')],
    agents: { [AGENTS.deep]: deepRows } };
  const deepest = { session: SID, runId: DEEPEST, journal: [started(AGENTS.deeper), resulted(AGENTS.deeper, 'x')],
    agents: { [AGENTS.deeper]: testerRows({ agentId: AGENTS.deeper }) } };
  const { session, ledger } = await load(t, { run, extraRuns: [nested, deepest] });
  // The fixer's own Workflow call (one hand-off down) linked its agent through the same rules.
  const fixerLedger = ledger.children[0].ledger;
  assert.deepEqual(fixerLedger.workflowRuns, [{ turn: 1, seq: 2, linked: 1 }]);
  assert.equal(fixerLedger.delegations[0].childId, AGENTS.deep);
  assert.ok(session.events.some((e) => e.childId === AGENTS.deep), 'the nested agent\'s work is reviewed too');
  // The deep agent's own Workflow call sits past the frozen depth: declared, never followed.
  const deepLedger = fixerLedger.children[0].ledger;
  assert.deepEqual(deepLedger.workflowRuns, [{ turn: 1, seq: 2, linked: 0, losses: { workflow_nested_unlinked: 1 } }]);
  assert.equal(session.events.some((e) => e.childId === AGENTS.deeper), false);
  const nestedGaps = session.adapterGaps.filter((gap) => gap.note === WORKFLOW_RUN_GAP_NOTES.workflow_nested_unlinked);
  assert.equal(nestedGaps.length, 1);
  assert.deepEqual(relabelled(session, nestedGaps[0].eventIds), [`child:${AGENTS.fixer}:child:${AGENTS.deep}:A1-2`]);
  assert.ok(session.event(nestedGaps[0].eventIds[0])?.tool === 'Workflow', 'it names the nested call\'s own event');
});

test('M33 W a transcriptDir outside the parent\'s projects slug is never linked', async (t) => {
  const outsideRun = async (dir) => {
    const elsewhere = join(dir, 'projects', '-other-repo', SID, 'subagents', 'workflows', RUN);
    await mkdir(elsewhere, { recursive: true });
    const { journal, agents } = linkedRun();
    await writeFile(join(elsewhere, 'journal.jsonl'), journal.join('\n') + '\n', { mode: 0o600 });
    for (const [agentId, rows] of Object.entries(agents))
      await writeFile(join(elsewhere, `agent-${agentId}.jsonl`), rows.map((r) => JSON.stringify(r)).join('\n') + '\n', { mode: 0o600 });
    return elsewhere;
  };
  const dir = await scratch();
  t.after(() => rm(dir, { recursive: true, force: true }));
  const elsewhere = await outsideRun(dir);
  const { ledger, session } = await load(t, { root: dir, run: null, transcriptDir: elsewhere });
  assert.equal(ledger.workflowRuns, undefined);
  assert.equal((ledger.delegations ?? []).length, 0);
  assert.ok(session.adapterGaps.some((gap) => gap.note === WORKFLOW_GAP_NOTES.agents
    && gap.eventIds.includes(named(session, 'A1-0'))));
});

test('M33 W a resumed parent\'s run under its other recorded session of the same slug is linked; another session\'s is not', async (t) => {
  const earlierRun = linkedRun({ session: SID_EARLIER });
  // The recorded transcriptDir names the earlier session's run directory; its agents' rows record that session.
  const dir = await scratch();
  t.after(() => rm(dir, { recursive: true, force: true }));
  const rows = parentRows({ earlier: true, workflows: [workflowRows({ transcriptDir: runDir(dir, SID_EARLIER) })] });
  const { ledger, raw } = await load(t, { root: dir, parent: rows, run: earlierRun });
  assert.equal(raw.sources[0].sessionIdConflictOnly, true, 'the known resumed shape');
  assert.deepEqual(ledger.workflowRuns, [{ turn: 2, seq: 0, linked: 2, receipt: { turn: 2, beforeEvent: 1, source: 0, record: 6 } }]);
  assert.deepEqual(ledger.delegations.filter((d) => d.kind === 'workflow-agent').map((d) => d.childId),
    [AGENTS.fixer, AGENTS.tester]);

  // A session id the lineage never recorded: not linked, whatever the directory holds.
  const stranger = '5f0c2d1e-7a3b-4c1d-9e2f-00000000a999';
  const dir2 = await scratch();
  t.after(() => rm(dir2, { recursive: true, force: true }));
  const rows2 = parentRows({ workflows: [workflowRows({ transcriptDir: runDir(dir2, stranger) })] });
  const second = await load(t, { root: dir2, parent: rows2, run: linkedRun({ session: stranger }) });
  assert.equal(second.ledger.workflowRuns, undefined);
  assert.ok(second.session.adapterGaps.some((gap) => gap.note === WORKFLOW_GAP_NOTES.agents));
});

test('M33 W a recorded transcriptDir that no longer exists falls back to the parent session\'s own run directory only', async (t) => {
  const { ledger } = await load(t, { transcriptDir: `/srv/synthetic-moved/${SID}/subagents/workflows/${RUN}` });
  assert.deepEqual(ledger.workflowRuns, [{ turn: 1, seq: 0, linked: 2, receipt: { turn: 1, beforeEvent: 1, source: 0, record: 4 } }]);
  const none = await load(t, { transcriptDir: null, run: null });
  assert.equal(none.ledger.workflowRuns, undefined);
});

test('M33 W two calls naming one run link it to neither, never to the first by order', async (t) => {
  const dir = await scratch();
  t.after(() => rm(dir, { recursive: true, force: true }));
  const parent = parentRows({ workflows: [workflowRows({ transcriptDir: runDir(dir) }),
    workflowRows({ call: 'toolu_01SyntheticWorkflowCall0002', task: 'wtask_synthetic_002', transcriptDir: runDir(dir) })] });
  const { ledger, session } = await load(t, { root: dir, parent });
  assert.equal(ledger.workflowRuns, undefined);
  assert.equal((ledger.delegations ?? []).length, 0);
  assert.deepEqual(session.adapterGaps.filter((gap) => gap.note === WORKFLOW_GAP_NOTES.agents)
    .map((gap) => relabelled(session, gap.eventIds)), [['A1-0', 'A1-1']]);
});

test('M33 W a run directory is accepted only at its exact recorded place', async (t) => {
  const dir = await scratch();
  t.after(() => rm(dir, { recursive: true, force: true }));
  const namespace = join(dir, 'projects', SLUG);
  const own = runDir(dir);
  await mkdir(own, { recursive: true });
  await mkdir(join(namespace, SID, 'subagents', 'other', RUN), { recursive: true });
  await mkdir(join(namespace, SID, 'subagents', 'workflows', RUN, 'deeper', RUN), { recursive: true });
  const at = (transcriptDir, extra = {}) => locateWorkflowRun({ namespace, runId: RUN, transcriptDir, sessionIds: [SID],
    callSessionId: null, ...extra });
  assert.deepEqual(await at(own), { dir: own, sessionId: SID });
  assert.deepEqual(await at(`${own}/`), { dir: own, sessionId: SID }, 'the same directory, however spelled');
  assert.deepEqual(await at(join(own, '..', RUN)), { dir: own, sessionId: SID });
  for (const path of [join(namespace, SID, 'subagents', 'other', RUN), join(own, 'deeper', RUN),
    join('projects', SLUG, SID, 'subagents', 'workflows', RUN), join(own, '..', '..', 'workflows', RUN, '..', 'x'), null, 7])
    assert.equal(await at(path), null, String(path));
  assert.equal(await at(own, { runId: 'wf_ffff' }), null, 'the basename must be the runId');
  assert.equal(await at(own, { sessionIds: ['someone-else'] }), null, 'a session the lineage never recorded');
  assert.deepEqual(await at('/nowhere', { sessionIds: [], callSessionId: SID }), { dir: own, sessionId: SID },
    'else the call\'s own session\'s run directory');
  // D90 (owner decision 2026-10-15): nothing scans an identity: every text is kept (its shape is checked where it names
  // a directory, above); a value that is not text is never a key.
  assert.deepEqual(keptIdentities([RUN, SID, `ghp_${'Zk3Qw8Rt'.repeat(4)}Ab9x`, null, 7, {}]),
    [RUN, SID, `ghp_${'Zk3Qw8Rt'.repeat(4)}Ab9x`]);
});

test('M33 W a symlink never links a run or an agent', async (t) => {
  // The parent session's run directory is a symlink to a directory outside the projects tree.
  const escape = await load(t, { run: null, roots: { before: async (dir) => {
    const outside = join(dir, 'outside', RUN);
    await mkdir(outside, { recursive: true });
    const { journal, agents } = linkedRun();
    await writeFile(join(outside, 'journal.jsonl'), journal.join('\n') + '\n', { mode: 0o600 });
    for (const [agentId, rows] of Object.entries(agents))
      await writeFile(join(outside, `agent-${agentId}.jsonl`), rows.map((r) => JSON.stringify(r)).join('\n') + '\n', { mode: 0o600 });
    await mkdir(join(runDir(dir), '..'), { recursive: true });
    await symlink(outside, runDir(dir));
  } } });
  assert.equal(escape.ledger.workflowRuns, undefined, 'symlink escape: not linked');
  assert.ok(escape.session.adapterGaps.some((gap) => gap.note === WORKFLOW_GAP_NOTES.agents));

  // A recorded transcriptDir that is itself a symlink to a run the lineage could own is not followed: a resumed
  // parent whose recorded path is an alias of its earlier session's run links nothing (the real path would link).
  const aliasRoot = await scratch();
  t.after(() => rm(aliasRoot, { recursive: true, force: true }));
  const aliasPath = join(aliasRoot, 'alias', RUN);
  const alias = await load(t, { root: aliasRoot, run: linkedRun({ session: SID_EARLIER }),
    parent: parentRows({ earlier: true, workflows: [workflowRows({ transcriptDir: aliasPath })] }),
    roots: { before: async (dir) => {
      await mkdir(join(dir, 'alias'), { recursive: true });
      await symlink(runDir(dir, SID_EARLIER), aliasPath);
    } } });
  assert.equal(alias.ledger.workflowRuns, undefined, 'an aliased transcriptDir is not accepted');

  // An agent recording that is a symlink is a started agent with no readable recording.
  const linkedAgent = await load(t, { run: { ...linkedRun(), agents: { [AGENTS.tester]: testerRows() } },
    roots: { before: async (dir) => {
      const outside = join(dir, 'outside-agent.jsonl');
      await writeFile(outside, fixerRows().map((r) => JSON.stringify(r)).join('\n') + '\n', { mode: 0o600 });
      await symlink(outside, join(runDir(dir), `agent-${AGENTS.fixer}.jsonl`));
    } } });
  const gaps = workflowGaps(linkedAgent.session);
  assert.deepEqual(gaps.map((gap) => gap.note), [WORKFLOW_RUN_GAP_NOTES.workflow_agent_recording_missing]);
  assert.equal(linkedAgent.session.events.some((e) => e.childId === AGENTS.fixer), false);
});

test('M33 W linking is deterministic: identical bytes twice, whatever order the files were written or listed in', async (t) => {
  const dir = await scratch();
  t.after(() => rm(dir, { recursive: true, force: true }));
  const first = await load(t, { root: join(dir, 'a'), run: linkedRun({ order: 'forward' }) });
  const again = await loadSessionEvidence([first.tree.parent], { outcomes: new Map(), reviewLinkedChildren: true,
    recordingRoots: { claude: first.tree.projects, codex: join(dir, 'a', 'codex-sessions') } });
  const reversed = await load(t, { root: join(dir, 'b'), run: linkedRun({ order: 'reverse' }) });
  const bytes = (ledger) => JSON.stringify(redact(ledger).ledger);
  assert.equal(bytes(again), bytes(first.raw));
  assert.equal(bytes(reversed.raw), bytes(first.raw), 'no path, listing order or creation order reaches the ledger');
  const story = async (s) => renderReportMarkdown(s, await runReview({ session: s, pr: null, reviewScope: 'session-only',
    concurrency: 1, judge: fixtureJudge({ narrativeOf: (r) => windowNarrative(s, r.window) }) }));
  assert.equal(await story(reversed.session), await story(first.session));
});

/**
 * Base fd5d129, captured ONCE by running `captureStableCases` (m33-w-workflow-fixture.js, node built-ins only) against
 * a `git archive fd5d129` export with this fixture copied in, twice there at different temp paths (identical). A
 * session with no Workflow call, and one whose Workflow calls link nothing (no runId recorded; a recorded
 * transcriptDir that does not exist and no run directory of the session's own; a call that failed to start), keep the
 * base's ledger, gaps, every planned and sent review request, and story, byte for byte. M33 W repair: `conflicted`
 * (a parent whose rows interleave two sessions, beside a complete run of its call's own session, which it must not
 * link) was captured the same way from a fresh `git archive fd5d129` export, twice; the first two entries are unchanged
 * and the M33 R merge moved none of them.
 */
const BASE_FD5D129 = Object.freeze([
  { name: 'none', ledger: '4980f773c42237105f99a0bc3ab22dec5af5c58e06b43c16cd6ded6f4a47ca2e',
    gaps: '4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945', windows: 1,
    planned: '75e0693d92f7d188aad59db75c24fce48d0be3fac9bda153bb3dfe433329904f', sentCount: 5,
    sentInOrder: 'cd15e854b6ef8557ca0e3f710771c39884c4b0cd73462b9a35d12cd326429651',
    sentSorted: 'd5ae25dfd4295413b6d1db5056b62545faa3bccc7bf89d11db2b91a0ce0fa085',
    labels: '75d10cb3d3d7d9d9824ed96454ab4d75787e567b89c960d843bb563652c01f73', windowFailures: '',
    story: 'c4302cf563b70fee20293390eda974ad4472e60dd19a855b1c45c5e8fb6dae75' },
  { name: 'unresolved', ledger: 'd4a98d3c304de60ba3384ae9d7e3012458e79e4d4a6904d9024587d2e5881d62',
    gaps: '50ace09b611a994dbf4ed10bb751120fc4f0f3f84343a769e604132587f71d96', windows: 1,
    planned: '430398daadfdc3d7cc0d2cbd6dc500e38a01b4ba78c985354f7135a7a86f3140', sentCount: 5,
    sentInOrder: '1ca5a46194ebf7e51acdd2d739da2fd62db3c2db4ca7dc0a4d714701e4170629',
    sentSorted: '9879b35ebee7dad90349642df4b64cf9351059c13aeb3f9f36fea285319af104',
    labels: '75d10cb3d3d7d9d9824ed96454ab4d75787e567b89c960d843bb563652c01f73', windowFailures: '',
    story: 'c358ae6cccd9825f8d8911b67a5ebd799c00c3d2a418c4d9466b21c31c69ccfc' },
  { name: 'conflicted', ledger: '28006caa600e907bbc4cfb2c26f23c3a36f7ca4f1f46f3960a6cff35ba42a6b5',
    gaps: '1a88c87002b869f456733404a1e06aff5aba35ac55b640a45de816c6f7b424b2', windows: 1,
    planned: 'e65fe5c49b630754070841bbdb8a3454362e39da2b48661b16f8f051cc16e44c', sentCount: 5,
    sentInOrder: 'a60e171dd6366c59499ff089106679dc1a107945f85295d033dfb7e8562e95eb',
    sentSorted: '293546e0642b6d084702323c29ef1ebf2af760052cf545aec05386f467092f81',
    labels: '75d10cb3d3d7d9d9824ed96454ab4d75787e567b89c960d843bb563652c01f73', windowFailures: '',
    story: '611696c26426ad819ac846c534530bb4f4a59f1d5b2aad2b2a23be89d0d33069' },
]);

/**
 * M33 C2 (`sonah.challenge/9`, the verbatim quote decides) moved each case's challenge requests on purpose, and nothing
 * else: a batch holding a claim-class item shows each such item's stated quote as `claim` and its narrative text as
 * `reviewersReading`, and is sent CLAIM_WORDS_NOTE after the unchanged system prompt (`sentInOrder`, `sentSorted`).
 * Rendering every challenge request back as /8 rendered it (no note, candidates as proposed), this tree reproduces
 * fd5d129's values byte for byte. The ledger, the gaps, the planned narrative requests, the number of requests sent,
 * their labels, the window failures and the story did not move. M33 C2 repair (still /9) moved the same values again,
 * and only they: each claim-class item shows code's grounded words and their `context`, and the note names them;
 * rendered back as /8, fd5d129's values still reproduce byte for byte.
 */
const MOVED_BY_M33_C2 = Object.freeze([
  { sentInOrder: 'db749b546caa997b003ff343ee3f9244e1befbd91c1b5604892f10213c353465',
    sentSorted: '3418409decbe42af12de9a566f9f8cef4ae36cbe31363d1217587263f3a203c9' },
  { sentInOrder: '05bd85ee42715b6c2a7d0e887a6aae980fdfc95219622b7603a6746d732f514f',
    sentSorted: '926414712ebd769c78a4167f5f920f8012b6c804b4941d14e3e82c8cfe05ab19' },
  { sentInOrder: 'd0f2d2927395b8d5b05eb7ef967e582b432a2b1430e9f7d0e0e3c13b884836d3',
    sentSorted: 'b17e8e3e603342119fd0d6d2d096a575a994fb97d1bcbfb78987481889305e44' },
]);

/**
 * M33 H's repair (`sonah.narrative/13`, `sonah.challenge/10`: a relay of another agent's report is the passing agent's
 * own claim) moved each case's narrative and challenge requests on purpose, by the relay rule's words alone (`planned`,
 * `sentInOrder`, `sentSorted`). Rendered back as /12 and /9 sent them (m33-h-relay-rule-fixture.js), every case is M33
 * C2's byte for byte. The ledger, the gaps, the number of requests sent, their labels, the window failures and the story
 * did not move.
 */
const MOVED_BY_M33_H = Object.freeze([
  { planned: '30e29e5c7bbeb2551673dd3d8a9f1c54c17441499684c23389f0f8547ad494c9',
    sentInOrder: '808e713b09057155c97315e0cc3502646eec997963d08330d0c7ff117382370b',
    sentSorted: '341a6a9a2dd9dbc69674f0803689d99b9af7395ae5a041a4cadd534b962305f7' },
  { planned: 'bfab2ea06dab9b7418aeb8354ca3ec59c4d8c8e46b1414f7cfbb5ee7e8b26934',
    sentInOrder: 'e640ad40508f74d7d859606ccfadea315e8644cba4e4321c082771e1a2bd8f28',
    sentSorted: '7de8cf01f3320ad566499640daa8445b84f79d5dd2e4b90c4529cfa11628f8fb' },
  { planned: 'd1585ab9ea063c54c94e1eb52d3556319ec55d6ba0c241555aed28c9639a2f46',
    sentInOrder: 'f62c895f2b5e00446c351138b1005426605b717a9c9185c4e10ac051bc388964',
    sentSorted: '608740a29ab7087029362d8e88630a7922389d2057e5177c8cb6bdbe5608e391' },
]);
/**
 * M33 brittleness H4 (C-06 decision order: every decision made without asking leads, whatever its materiality) moved
 * each case's story on purpose, by one line alone: the counts row's header reads "Decided without asking", no longer
 * "Decided without asking (behaviour or structure)". Rendered with the renderer before H4, every story is the pin above
 * byte for byte. The ledger, the gaps, every planned and sent request, their labels and the window failures did not move.
 */
const MOVED_BY_H4 = Object.freeze([
  { story: 'f99de11d931d4d107503c5f10b3d90e7983b86b05a0999984c7c01088590bf49' },
  { story: 'f830464fcc38cbf85d07129a1a430406c966340d109446712558c0ef8972607e' },
  { story: '869c487f09837a75937da906a3eec98ceffabd373f1bdb59946595e11b79e264' },
]);
/**
 * M1: the ONLY values that moved, of the first case alone — its `npm test` is a `bash`
 * command, no longer `test`: the ledger's kind, the requests that show its action (`tool=bash`), and the story, whose
 * step no longer says "ran tests" (`planned`, `sentInOrder`, `sentSorted`, `story`, at both render-back levels).
 */
const MOVED_BY_M1 = Object.freeze({
  n13: [{ ledger: '3adf89ed96073b3b0d5c3dbf98eb7b65ee0a674a7e078614adfc93ca24155d3b',
    planned: '765ceecb60ee75d2c920b7b2f99a3d2084a683f5b752957aae97821bb6e93b45',
    sentInOrder: '562a1f104b2d1214a5198803aeaa831438724c886ac1b8c2b96ec5fbefb4dd32',
    sentSorted: 'a3a4f62bfdf396d31d7790f7c25f3d6b98819e716f800eb6e37122842925eb32',
    story: '78eb8675b63525d2dce442cc79282341c44f0d9038ae5fee63fd1dc80ba2a31a' }, {}, {}],
  n12: [{ ledger: '3adf89ed96073b3b0d5c3dbf98eb7b65ee0a674a7e078614adfc93ca24155d3b',
    planned: '67ef85b42a9857d5dcb6da85405032b266aa78a5beca90fe0f56cca8468bb228',
    sentInOrder: '5423135d3532d0a68084706223cc3cb0c46205d91596d3e7237bf7a039c8503a',
    sentSorted: '86c7d775a8f397ec6da29c0d71060258f6056a93398aa2d44c1d00896a3761e9',
    story: '78eb8675b63525d2dce442cc79282341c44f0d9038ae5fee63fd1dc80ba2a31a' }, {}, {}],
});
/**
 * H3 (`sonah.narrative/16`, `sonah.challenge/13`: a claim is every statement the agent
 * makes about the state or the outcome of its work, hedged or not) moved each case's narrative and challenge requests on
 * purpose, by the claims definition's words alone (`planned`, `sentInOrder`, `sentSorted`, as /16 and /13 send them).
 * Rendered back as /14 and /11 sent them (h3-hedged-claims-fixture.js), then as /13 (M33 N), every case is M33 H's byte
 * for byte. The ledger, the gaps, the number of requests sent, their labels, the window failures and the story did not
 * move.
 * H3's review repair (2026-10-06; /16 and /13, were /15 and /12) re-pinned these values once, in place: the relay and
 * supportedBy rules' example phrasings are gone and a hedge on a relay is not doubt — the same requests moved, by the
 * same fixture's texts, and the render-back still reproduces the values before H3.
 * The owner's decision of 2026-10-06 (still /13) re-pinned every case once more, in place: CLAIM_WORDS_NOTE lists no
 * kinds of statement (the quoted text may narrow what the words assert and never widens it), so only `sentInOrder` and
 * `sentSorted` moved, by the same fixture's text; the render-back still reproduces the values before H3.
 */
const MOVED_BY_H3 = Object.freeze([
  { planned: 'fd7df7034594126c065d9305e33892d921e0bdfa7296bcdca0bb5637853bb413',
    sentInOrder: '034584e47b723b12d450292e483a188f520e8b20b0f4b89398912c58ee88bbd8',
    sentSorted: 'ebff6877c78c2d5187ddfc97d4247814b6380e370642f1a94432a710b9ecd2e7' },
  { planned: 'e0a1d988f09d3ee4dbe29d5df840dfe4cda96396a5a812ca98f49f299a89c09e',
    sentInOrder: '80c6430f5aa1ca1af774a7e84b5364782bc59d5bcba7b6ecea6fc08646dc8dcf',
    sentSorted: 'c25e2c2137750d55f64c41fb9dad1940e7056095ce7d335ce41ce60bc9790129' },
  { planned: '663c19d6df996eaa467c706cfbcb930f224decb6794e4fe3146981b0d689bf32',
    sentInOrder: '33eb13bf227d90c297a6a83d656d356aced0323cea31cf0cc1ea589299f1cd08',
    sentSorted: '3a0a5527b176fb33c1226e875a3c5d350a139b3964d9ab5fa81767f46ec1713c' },
]);
/**
 * M33 integration (2026-10-06; `sonah.narrative/17`, `sonah.challenge/15`, `sonah.session-story/7`): the ONLY values no
 * branch's constant above holds. (1) `story`: the first case's story, which H4's counts-row header and M1's step (no
 * "ran tests") moved together, at every render-back level (a story renders no request, so no render-back moves it).
 * (2) `current`: every case's narrative and challenge requests as the merged code sends them — H3's, the status fact's,
 * G3's and M3's texts, with M1's `tool=bash` in the first. Rendered back through every branch's fixture, each case is
 * M33 H's and M33 C2's with H4's story and M1's moves, byte for byte (but for that one story).
 */
const MOVED_BY_INTEGRATION = Object.freeze({
  story: Object.freeze([{ story: 'bddf753086769631dfa2be45a842ed8819a831d5521f90e49301da76e817c27b' }, {}, {}]),
  current: Object.freeze([
    { planned: 'c293c6cb145a30b3c038c7e27b537a35a2202f4f038da96b265be55aed30a793',
      sentInOrder: '9dfb3d8d8a3d9205efb54fffe5dda666c26bcc3fb3a620aad8582be0bdaea9e4',
      sentSorted: '32391b486c425094dab36e6e726e8fc2420d2dd6a623dfb4e123c6187f1f45f3',
      story: 'bddf753086769631dfa2be45a842ed8819a831d5521f90e49301da76e817c27b' },
    { planned: '5eff471040f6185bd4e484e0194eee3696db1f9fba5530450bb0b9ca08e02dd6',
      sentInOrder: '93c40cba3955eb8543effa60c9319b488d288a59891f8cb021ab271e32bd40ee',
      sentSorted: '34f246afe8de581b2d6d02a93baa154ec99f76b5966d93acb51a274ead3a145a' },
    { planned: '8e47411cfce5a87288f62d6eee2ad96ba6621e945f7be4f76816d9405af4c1c4',
      sentInOrder: '8c15a5959a9675e13d5c78b7ceffec1b1e6c403cdaf7d531db3d3ed4028d826e',
      sentSorted: '1e6fb0ca5d212b50b871df451b841e445a4fc504fa2a3969a92951481a85efcc' },
  ]),
});
const STABLE_MODULES = Object.freeze({ loadSessionEvidence, redact, sessionFromLedger, runReview, planWindowRequests,
  captureCase, windowNarrative, fixtureJudge, renderStory: renderReportMarkdown });

/**
 * M34 labels (C-02 "Slice-time labels"): the one value the labels moved in this file — each case's whole-ledger digest,
 * and nothing else (gaps, requests, labels, story hold). Every ledger now carries its label counts (`capture.labels`),
 * and the untyped `notification` marks the slicer read off a row's words (no consumer read them) are deleted with the
 * role guessers: `unresolved` held two, `conflicted` one (diffed against M33 human-words repair: nothing else differs). M34
 * labels review (F5): the Workflow call each of those notifications names by its carried id records how many were
 * linked to it (`notified`), the link set at slicing; nothing else moves.
 * `withoutCounts` is each ledger with the label counts taken out: `none` is fd5d129's; the other two differ from it by
 * the deleted marks and the linked-notification counts alone.
 */
const MOVED_BY_LABELS = Object.freeze([
  { ledger: 'ff6c8cd67c9c28aa1d6af0f12484ded293d7f0a4938f1794a76d68f612f51626',
    withoutCounts: '4980f773c42237105f99a0bc3ab22dec5af5c58e06b43c16cd6ded6f4a47ca2e' },
  { ledger: '289fbdabe730b751f4f23eca9108ccb731e7c23cad1ff3284519f3e86a0ae00e',
    withoutCounts: 'bdb46aeebb7d9a15a3fa2af39a315cc347295c75d5ccd9041a3e7573d256179f' },
  { ledger: 'bdf3ab5eaf30fd7e4f359a7158811276c89feffca4c2e3467b6acf4b909b2712',
    withoutCounts: 'b7365a33f5ad324d6834515883d5d6b0aa80c80a10a8eaa0154b32cd3d9791b1' },
]);
/** The modules with the label counts taken out of every redacted ledger: the ledger an M33 slicer kept. */
const withoutLabelCounts = (m) => ({ ...m, redact: (raw) => {
  const out = m.redact(raw);
  if (out.ledger?.capture) {
    const { labels, ...capture } = out.ledger.capture;
    if (Object.keys(capture).length) out.ledger.capture = capture;
    else delete out.ledger.capture;
  }
  return out;
} });

/**
 * M33 integration merged with M33 labels (2026-10-06): the ONLY values that moved from M33 integration's capture — each
 * case's whole-ledger digest, by the labels alone (`MOVED_BY_LABELS` above, the labels branch's own, says what they hold:
 * the label counts, the deleted untyped notification marks, the linked-notification counts). `none` holds M1's `bash`
 * kind beside the label counts, a ledger neither branch built; `unresolved` and `conflicted` are the labels branch's
 * ledgers exactly (M1 moved neither). With the label counts taken out (`withoutLabelCounts`), `none` is M1's ledger and
 * the other two the labels branch's `withoutCounts`. No gap, request, label, window failure or story moved, at any
 * render-back level.
 */
const MOVED_BY_LABELS_MERGE = Object.freeze({
  current: Object.freeze([{ ledger: 'e3b61d5f59856cad07648f48e813227e53e7311106719b9ef61f666db786971a' },
    { ledger: '289fbdabe730b751f4f23eca9108ccb731e7c23cad1ff3284519f3e86a0ae00e' },
    { ledger: 'bdf3ab5eaf30fd7e4f359a7158811276c89feffca4c2e3467b6acf4b909b2712' }]),
  withoutCounts: Object.freeze([{ ledger: MOVED_BY_M1.n13[0].ledger }, { ledger: MOVED_BY_LABELS[1].withoutCounts },
    { ledger: MOVED_BY_LABELS[2].withoutCounts }]),
});

/**
 * Stable event ids (C-01 event identity, 2026-10-07; `sonah.narrative/19`): every ledger element now records where the
 * recorder wrote it (`identity`), and every event of these sliced recordings is named by its row's uuid and block, so each
 * case's whole-ledger digest, its gaps (they name events), its narrative and challenge requests (`planned`, `sentInOrder`,
 * `sentSorted`) and its story (the fixture judge's synthetic claims quote event ids as their words) moved — by the
 * identities and the ids alone: adapted with the identities taken out (`positionalModules`), every case is the values
 * pinned before, at every render-back level (the test below). No window count, number of requests, label, order or window
 * failure moved.
 */
const MOVED_BY_STABLE_IDS = Object.freeze([
  { ledger: 'fd5046a6f49b19a7373afc514f44d734b79850325f54d75e794d66be36f7f97b',
    gaps: '4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945',
    planned: '5df38cd0500e0a20d714f76ea264d86a340cf726fa4b5dc0ea2a5045dea09ad2',
    sentInOrder: '297a760814c806ba8fe9f0d140370655deebf75d62aa82734dbbc1a7cd4a4a5d',
    sentSorted: '97dea03cd86faa2ad16c7ec517928e47e7cc9e7b6511a4cc8bd31cc14878b789',
    story: 'd0c04b8aa51076934c6745d27b4c6785a31a2ccf0bb8ce666fe6c2c0817b5d42' },
  { ledger: '1980585702f0af6b452f694173756df6b2b11bc58ff2246958065ff87f468cff',
    gaps: '29381717aedae05b3f8e33f97250402695acb61a05caa7039bc2beb5ef978069',
    planned: '370ad43906e33d581473803282ddaf7a75780498d4f1a7b324db0faeaf8e53fd',
    sentInOrder: '6a8a43455675f4f877b0d37b369cf76100f0acdc9ac015115660967eaccdbcd4',
    sentSorted: 'a83407a8c53da5879b35ba47d3debbe1ee2f4a5f90624671c2410fa8238f686b',
    story: '992241dcd919184fa72091dc66f662354e1367114d422c1f88347db18c6d46e4' },
  { ledger: '592abe96b27108b7185f16e4d64b718791f3b1583573149b6aff3312a5304483',
    gaps: '2bb8f5821d4424d9fd7f72f123cf5933a6761b65f75c264897674fe5363f7557',
    planned: '1af998c56141685ae39c1574d3d819c18bf6b9d3376285620260ba4408ba7c53',
    sentInOrder: 'efce8ff6e0416be79aa136cb75ff00b42539b235c8b59fbe8484faa454fde48b',
    sentSorted: '519a27850cc1064348631b67585b80c7788bbdfb832b34811a6051dd4221c999',
    story: 'e362d3e82d1e1e4d2231192afc70ed2509afc3414a0f2cdfa05667dac405cd2a' },
]);
/** The modules with every recorded identity taken out of each redacted ledger, and its format version put back (the
 *  slicer's SCHEMA_VERSION moved 1 → 2 with them): the ledger, and so the session (its positional ids), a slicer before
 *  stable ids kept. */
const positionalModules = (m) => ({ ...m, redact: (raw) => {
  const out = m.redact(raw);
  return { ...out, ledger: { ...withoutIdentity(out.ledger), ...(out.ledger.schemaVersion === 2 ? { schemaVersion: 1 } : {}) } };
} });

/**
 * D64 wording (owner decision 2026-10-07; `sonah.narrative/20`): every session-only narrative request's item 6 sentence
 * and output-contract rule ask for the agent's statement that it went against the human's instruction, so every case's
 * narrative requests moved by those two texts alone: `planned`, `sentInOrder`, `sentSorted`. Rendered back
 * (`modulesBeforeDisclosureWords`), every case is the values pinned before, at every level (the tests below). No ledger,
 * gap, story, window count, number of requests, label, order or window failure moved.
 */
const MOVED_BY_DISCLOSURE_WORDS = Object.freeze([
  { planned: '191b5187822dc6c4af6e14108e5de33aa8e50c42a804363972d882c519090d64',
    sentInOrder: 'f95edd9c2d5c8d4623c098df3c6690184e24c12ee3e6d6543ea7ad2f90c2cabe',
    sentSorted: '2324dd345d31913cf1933781f558f3e3692c5ad85a48e2a386514ad086a1ee91' },
  { planned: 'af99b1374e90a0c75ee9e954600c0fa4b5d7bee531e3ce63014502581ac2d210',
    sentInOrder: 'c487b82d26dfbd5147406ef638d32ce6cd547a7da0142886d0541944a53b237b',
    sentSorted: 'f27e1ad3fd896d2a53b6b930b3c7d0efa768995c25187fdca2ada5439a7e961a' },
  { planned: '0d47051d54e3626004614a60d9d82bd7742d9e1b086f8c53d393b6e582601ce6',
    sentInOrder: 'ac8ef72c205438e9c5c7227a61387ce9f5b595415ee8061f4d3bb6871c0ee9f3',
    sentSorted: 'b7c60acaec619826170af7f8c97edadaf28c6ea1e27368ee9407d514867a9bde' },
]);

/**
 * M35 windowing (C-07 "M35 windowing"; `sonah.narrative/21`, `sonah.challenge/18`): the ONLY values that moved from
 * `MOVED_BY_DISCLOSURE_WORDS` — every case's narrative and challenge requests (`planned`, `sentInOrder`, `sentSorted`):
 * windows by segment, carried context, trims and aliases. No case links a helper, so no ledger, gap, story, window
 * count, number of requests, label, order or window failure moved. A text render-back can no longer reproduce an older
 * request capture (every window moved): those values are kept as the record, and every other value is still compared
 * at every render-back level (`withoutRequests`).
 */
const MOVED_BY_WINDOWING = Object.freeze([
  { planned: 'ab6afaa251d9ed38d225939aa0a7c177e0346e7ca786cd5b0e3da7e5de3b3913',
    sentInOrder: 'b0fcb75bfa8f2d95164488779634aa62bbc0cc6df2851e9a063d54ae3ac33845',
    sentSorted: '18c81e1c678ce2ee0131b0bb4865c1d14b5b8b992c477460c20bb70017c6e66a' },
  { planned: '284e89d341a910a08b8d732e80aabe73235ab32f1d651525f5ca1f9ccee96003',
    sentInOrder: 'b99d5b7aab85d5174e44d10433f5f752224b003d2628d1ee4b6d5f28c8d061da',
    sentSorted: 'c3df47d83630613984e3cf1bcc9b51512a3cedf841b7ac679e24a6f9d522ea45' },
  { planned: '4c1f990e1db465241b5bc973f3b95ae4d816033644909da58d913e3705232e68',
    sentInOrder: 'e5fee4551822a392cce499d7e874f5d6220a2a71e80d73b72f6e262ed05956e2',
    sentSorted: 'd336cbab4e72e8957f73ae48fbd050872e9a0c60eab3f230b693fc8290849053' },
]);
/**
 * D68 (C-02 "M36 recorded facts"): each case's ledger carries the recorder's typed facts (`recorded` on every action) and
 * the ledger format moved 2 → 3 with them; each case's whole-ledger digest is the only value that moved (gaps, requests
 * and story hold: no request or story reads the facts yet). Rendered back (`modulesBeforeRecordedFacts`: the facts taken
 * out, the format put back), every level below is the pin before them.
 */
const MOVED_BY_RECORDED_FACTS = Object.freeze([
  { ledger: '35021cfac3d13b8d9023ba9e1a7fb558fb66147ef91528868247d2192b6765ee' },
  { ledger: 'b9e2f531383c037a4118d9ea855a570a7f587a664cfb79203ec4be885d9fc193' },
  { ledger: '9f5f7dfd2b9e67ff0f3dd102d4b822502d4504b94690c02a350f15e0e8c2d186' }]);
const modulesBeforeRecordedFacts = (m) => ({ ...m, redact: (raw) => {
  const out = m.redact(raw);
  return { ...out, ledger: withoutRecordedFacts(out.ledger) };
} });

/** A capture less the request values M35 windowing moved. */
const withoutRequests = ({ planned, sentInOrder, sentSorted, ...rest }) => rest;
/**
 * D71 (a), owner decision 2026-10-08 (no verdict anywhere the human sees): the ONLY value that moved in this file is each
 * case's story digest — the story names every finding "Finding" under one heading and its head table says whether the
 * review completed, never a status. The story renderer before it is not kept, so every level below compares every value
 * but the story (`withoutStory`), and the story as the code renders it now is pinned here; no ledger, gap, request,
 * label, window or window failure moved.
 */
const withoutStory = ({ story, ...rest }) => rest;
/**
 * D71 (S2, the reviewer brief as the checklist): the values that moved from D71 (a)'s. Every case's narrative and challenge
 * requests (the brief, the checklist window format, one proposition per item: nothing renders them back); every story
 * (each human message no row of the answer cites is code's own not-checked row now, `ask_unreviewed`); and the first
 * case's ledger, by a failed command's `attempted` alone (`withoutCommandAttempted` renders it back). No gap, label,
 * window or window failure moved.
 */
const MOVED_BY_D71_BRIEF = Object.freeze([
  { ledger: 'b7dbddbddc9dad3b8a71a89cbcc2ff416ebf723116a1d0bb0113f02920ca4930', planned: 'db170d847d811e66f932135421b670876a0ef2a56baed48e88f6d7f15929f9ac', sentInOrder: 'd7f6b71a6d37e6c42902c230fecaad761270b5d6fc544144259d1c8007bada9f', sentSorted: 'bcc65bbc383b50ab0f007dd14ccc3d335d6183a8f9c86dfbdc8dd9a2b6f99a10', story: '21ea8f89c768fc4d92a4ed6ad0c377f03a11242f60b01e1da2f3d8b6b4f86caa' },
  { planned: '8bcc871ce7964f1cd3dc3607aa48c066738a6b7214a84f0d475f1c7f4a67f0c7', sentInOrder: 'a38944592253c8861d7a247711d0da7b55101945ae6ce4711c271d8fadca2984', sentSorted: '3562daf44ae480e8382a6fe744dcd4924d21b3b7bdb6977968897efc88af37c1', story: 'e7401ede32a69fdcfc61e98e879c9f2b795df57dbf7e888c7aa8fdc70b8af935' },
  { planned: '4458d82049e2d658bf002d3b58ee9bcd40f209aa45418d7d177f051c4f9c3597', sentInOrder: 'e4334094b1ebbe3ed22adbbb3832dcef327168b346076012df81f3a68fc4bba1', sentSorted: 'f6eabef5a377b6ec1afd39a06317016c5b33db7ada953137fbe77969150d688b', story: 'd6d4e269a4f8ff7077b69505bbe7895fc9727a3a42d4e8c34cfea29c268c02d4' },
]);
/** D71 (S3, the new channels): the ONLY values that moved from D71 (S2)'s — every case's narrative requests ("About this
 *  window" lists the RESULTs step 4 answers for; the brief's last step is step 6; the brief itself) and challenge requests
 *  (the session core's sixth role, the claim note). Nothing renders them back; no other value moved. */
const MOVED_BY_D71_CHANNELS = Object.freeze([
  { planned: 'd3703e841e59fb4e97914d0b5b16df5fc36bddc9c15d97bf70a8899dddc45c1e', sentInOrder: '5119a774fb07563d718a1fc09be52cd36d655d6177e752e8f87e212e62c28398', sentSorted: 'a5d6b6d11a230bf5b80da7bcf818c90e7380dbe6c9b7320ed73c096d65c1b5d0' },
  { planned: 'a77cea847cb62c8ff275c3293cb8afc972048e7eeb0bed390b05c9ed8173aa5b', sentInOrder: '60ea9ff6ddf616b32f6befeb991c5d4a6dadb7a6d900b956abca0a1ec9891c6e', sentSorted: '05bbc8795529b87a57bb92c698e48da07f93f2b43d179e0ff20a826a4311156b' },
  { planned: '4db6ef16eb580ea628616b49b2e4dafc34f6cf0db0bf1872de80adb5348edc44', sentInOrder: '83f8c355c7a013141e155e9db22ba0bd852b98f7135bc45ff75a5dfa8a1a8944', sentSorted: 'c498c0d2d1c873856f847f5c4ee7184fef49f2cb5552ac2c8b952b37ab67dfeb' },
]);
/** S6 (the fixes of the S5 review): the ONLY values that moved from S3's — every case's narrative requests (the brief: a
 *  choice not to act with no actions, a claim's `restsOn`) and its story: the fixture judge's decision whose challenge did
 *  not settle is kept "could not tell" (S5 review H1; owner decision D71 b), so the story lists it among the other
 *  decisions. Nothing renders them back; no other value moved. */
const MOVED_BY_D71_FIX = Object.freeze([
  { planned: '8a7609394b6b895565207d82b6348fe765a6ceb7b988ade236d82338bb265df2', sentInOrder: '34fe5b0ab4c5a70ab7ab05bc474054a1a8e5ed49dba19359e9ac59302ac804ae', sentSorted: '0b69a5ffef547b79d68452799f659ec658ee34976fd351bf381f9edc15b2116f', story: '08294e6b54f5aa8192f01e392ca6d62c898a5dd5ffd87e2d6c13235313f2f7e6' },
  { planned: 'decd1e27cad6b600838281001893efdd4285303763d0fc7609e6f94c022fb845', sentInOrder: 'cb01a1c2c45772c6299137351b7098d2577d4294df9c7b7be15ed13cefab839d', sentSorted: '411632bee74f92727e15c5c2e67858eb9ac48cc860d79b767fe7a7bf0bd77bf1', story: '52ea7d10e1b3c5a78345b8b0aa2abadb8a7d5b85ca2b3d345fa9f9c8225fb789' },
  { planned: '8cea68acff9cb1a020f58c24afc90d3823b372bb6e85f979e0a6ad0da70bac6a', sentInOrder: 'db697832d9e4e3c6844c260ac065ac18fad37816514a2161702e51283e939628', sentSorted: '311829f335e5136d1ddcd6e70cbffe4fdc4e540d64a8ec1755b500dcffcbaa37', story: '211ed640f2755037735ba9fe4ac3a55517b19f8f2dd106fb39b61c9f0ce4debf' },
]);
/** S7: the ONLY values that moved from S6's — every case's requests (the brief's
 *  restsOn and step 4 sentences, the failures line and the failure note name failed, did not run or no terminal status
 *  only). Nothing renders them back; no other value moved. */
const MOVED_BY_S7 = Object.freeze([
  { planned: '19c9fd393bf422a5b77200330abe0433e4754fb2b784f15bf0f070cbb7a9564c', sentInOrder: '0c0148c81979349657278804cfeb7730a669488e1afbc4c150fce215723d7561', sentSorted: '99b231ae5bda1c1fafa8c93af44756b40592d653645657fb5481f85f2ac28c0e' },
  { planned: '487b9f58eb285a46bc78f95de83955864f77bae53e7b5e4cde6cc365c3e6971f', sentInOrder: 'b86b8262e94cd43ac0ef13aa4dede0ef0b4e5a84d44b291357fdb2c3474151d0', sentSorted: '291d8f0241e9293853aa26c09a43f2e58ca2cf9a5a87d679de459a54e34258a1' },
  { planned: '7c4067e5bae9f250a6d6ffd2d6fc320cc008068c8f124b85616dc0506d34665b', sentInOrder: 'a8ecea44e99ceaac48d02b1b74585a6dffd506482ecb1ff1c287bd0a18ccf1d3', sentSorted: 'b252e90d8cb229caad41a4c32d92d39690d51a76eb3b5ade84009ab8d1201768' },
]);
/** The column fix (owner decisions D83 (2) and D84): the ONLY values that moved from S7's and D77 C's — every
 *  case's requests (the brief says who decided a decision; D84: and that "made without asking you"
 *  checks the shown project instruction files too; 2026-10-13: and that "you settled it" is words that state the
 *  choice's own answer, and DECISION_NOTE never says to refute a decision those words settle, D84 (3);
 *  The settled-words gain: and that such a choice is reported settled at the level the words address). Nothing
 *  renders them back; no other value moved (no case holds a decision a project instruction file covers, so no story
 *  moved). */
const MOVED_BY_FIX_COLUMN = Object.freeze([
  { planned: '58b6b18407355d97c6f5bce9ee9b505b582fbe31372fabc1d65b2a01dda8c7b2',
    sentInOrder: '628dc9df212502821d0f301a0a8cda3026cc01a854663af4b5d24fa491048897',
    sentSorted: '9f7970e8104e59174a6e66e549a1111ac26c7fbd373d946d1f74be8a60695b41' },
  { planned: 'f40105af341966d69fc0baddf0cfdb1692fd28d877e87fb079fb9a2b35ecc8af',
    sentInOrder: 'c4e453221a15ded269d65a9198a8eccfbda1dae59c7cd2c65cc04c33df267988',
    sentSorted: 'cf88494546385deb9138b6c253a1095ad7e3edff83ba8110cbeab3f405ca5240' },
  { planned: 'bd0128a733ea8a4f7894685d72ee596fab316ed6d53b8244175ed0a7c6ae48ee',
    sentInOrder: 'a06675b6e66b9c9f7e74b2b2561b85416ea580aed6b4340606dad3251545fe21',
    sentSorted: '237857b3259c9ab9431573111add09e2ad624769d8b4f8e97ed84d931b3c78c7' },
]);
/** The asks fixes (P1): the ONLY values that moved from the column fix's — every case's requests, by the brief's one
 *  sentence on a run the human asked for, refused at every attempt (`sonah.session-review-agent/9`). S3 moved none: no
 *  case's challenge refutes a requirement. No ledger, story, label or window moved. */
const MOVED_BY_ASKS_FIXES = Object.freeze([
  { planned: '7ceaaa0d2de8c99389c92c64242d5a9d5db7c5bd32a70e55fc1bbbf3d8a3e089',
    sentInOrder: '6aa879eff1d124c0ccaa785c3ca58a451d3c545cb8d3d923e213f0552c5cfb32',
    sentSorted: '17a70cd9abe6554eb392304feb65ed18b4d92b16079cdc62c9a2067b6f32933a' },
  { planned: '02c578a2c334a8f2e6cad718e7329936b0d4ca4fbd8b5731f1661af7127da4a9',
    sentInOrder: '8783a84943399d88e1c450692aeb361004ed9f281deabc89735a52bae57dbe16',
    sentSorted: '486a6500b74b8514fa71ed5f6bb5f96f53c0331c4c7bbc3a943f112cbcf445ec' },
  { planned: '3fe82e253a1d0e1322486c5e67a9f5ee7a3447d9cdb885794a7386b951de2f3c',
    sentInOrder: '5fa2ad8fcd519ed86b6eece751c23002de3d0125ab76d90b565e024aef2eeae0',
    sentSorted: '57df90750c68a64d1c2110b75a8041b9acf86d2bd69bc0ccf6036fe60322638e' },
]);
/** W1 B: the ONLY values that moved from the asks fixes' — every case's requests, by the brief's texts (W1_TEXTS;
 *  `sonah.session-review-agent/10`). W1 A moved none: no case's challenge refutes a decision. Rendered back
 *  (`modulesBeforeW1`), each is the asks fixes'. No ledger, story, label or window moved. */
const MOVED_BY_W1 = Object.freeze([
  { planned: 'a67c1bae8610c1e341b01a614df4f397ce979d9915f391bcca4327db0af354e5',
    sentInOrder: '281ecf436914a002e5ed7a2c496dc701ea387fb98281149f99df4cd183e54533',
    sentSorted: '684026508d801cba4c6ff49a425b67b30590f471634f267baa03cf727bb8680c' },
  { planned: '29a2043bee02a1be05ca449ba41a4e6e72138d53e3413bfee994d5853c1baccf',
    sentInOrder: 'f677e97e804f23c4c1359186944483316cf122f94f07ab689ba39c5941036db6',
    sentSorted: 'c1c715fe6cd97028d3997b48e7425bf0e54e52e976f05b334bcd6f33646a09cf' },
  { planned: 'b022d582869d628ada1a3fa02a63cfbc15a5958583bc790fe53a18d78e9d59cc',
    sentInOrder: '071457e89319f13c0b571e21f66cd1d8e258d736b3b1b5cfcfcfe9c4520aed93',
    sentSorted: '60fdabbaff4bcb7b7f2656ac8ff2af4176f393aa75f1c48a7979d731012893fc' },
]);
/** W2 (3): every case's requests moved once more, by the brief's texts (W2_TEXTS; `sonah.session-review-agent/11`) and,
 *  in a batch holding a claim-class item, CLAIM_NOTE (`sonah.challenge/32`). Rendered back (`modulesBeforeW2`), each is
 *  W1's. No ledger, story, label or window moved. */
const MOVED_BY_W2 = Object.freeze([
  { planned: '75263867eb4ea446270e9f0133ebb6aa1d65048b0032da635df2877d05dad1f3',
    sentInOrder: '9012cbb44ac225a33318cd8e404de30e1a63f5b69b66b714dd60da336f48554e',
    sentSorted: 'f591da24e35d996492407acafc43c418eca46c75adb13450065dd06ba9ab2396' },
  { planned: 'a8d0c5a5f5a1563692c7a1de27349a4088ca4a9924dc74ace1fc48d330aa5ddf',
    sentInOrder: '15dff90e3b5a8b745d959f047b1d6ca20203a782cb6647062e3fa442e54076c4',
    sentSorted: '5a2bc314dc75eb544f5cedf2168fe309c3bc729937f674a5af429d9db97ccd27' },
  { planned: '71e1f95c882405a8d6eb4f503565d710987ad7936254f5eea6cdad2558d49d0b',
    sentInOrder: '7730e4ba7ea3f45fe885d1552b919501b3bb95bc72288bd9ad8a4de88c78a0ab',
    sentSorted: '3247264ca5be0d1d3cb613afe2439b49439295d1781197f796996c36e0b35446' },
]);
/** W3 F1(b) and F2: the challenge requests moved once more, by CLAIM_NOTE's changed-since criterion and its
 *  failed-result sentence (W3_TEXTS; `sonah.challenge/34`), in a batch holding a claim-class item; no narrative request
 *  moved. Rendered back (`modulesBeforeW3`), each is W2's. */
const MOVED_BY_W3 = Object.freeze([
  { planned: '75263867eb4ea446270e9f0133ebb6aa1d65048b0032da635df2877d05dad1f3',
    sentInOrder: 'a2bd41f46a061d8f0223d4c0fbee90845546f3cb152f2c1f1c5c8f841d1e8d54',
    sentSorted: '4248d314f32fe346651e301a1d8967c7ae7072ce482f026b114f3d980c59a0a9' },
  { planned: 'a8d0c5a5f5a1563692c7a1de27349a4088ca4a9924dc74ace1fc48d330aa5ddf',
    sentInOrder: 'c293ada459623373537cafd82e06c183b160e1ffb8107d8f8e9ea0569569a9fe',
    sentSorted: 'e33de9575f0ac4381d7b0a4679f4ce29aae49792af939fc7a26e69a04d720418' },
  { planned: '71e1f95c882405a8d6eb4f503565d710987ad7936254f5eea6cdad2558d49d0b',
    sentInOrder: 'b3057988c725cf3792aff630d6900d92ecfcead755b1d408d7cb63d9793eb9c8',
    sentSorted: 'fba1c3b26263f034cdd852404bf7a19f1370ddd46c13e0a4c615846b18967919' },
]);
/** The fix review: the challenge requests moved once more, by CLAIM_NOTE's failed-result sentence (FIX_REVIEW_TEXTS;
 *  `sonah.challenge/35`), in a batch holding a claim-class item; no narrative request moved. Rendered back
 *  (`modulesBeforeFixReview`), each is W3's. */
const MOVED_BY_FIX_REVIEW = Object.freeze([
  { planned: '75263867eb4ea446270e9f0133ebb6aa1d65048b0032da635df2877d05dad1f3',
    sentInOrder: 'c511a0f466d028db3db0e6405a95eaa3e102bda7075e1281407da8924fe45684',
    sentSorted: '0448c67b78ca11f82755c47be193ccee85312357bb68c11123c3ccbea153b71b' },
  { planned: 'a8d0c5a5f5a1563692c7a1de27349a4088ca4a9924dc74ace1fc48d330aa5ddf',
    sentInOrder: '6487afbd0f2203e1e6a0c1874deb3166a7c4359a39359de6ed49468b4c743b8f',
    sentSorted: '177ad499b9f96f3b2941f94b51071261b5f8244813a95f587b173d0904b7692d' },
  { planned: '71e1f95c882405a8d6eb4f503565d710987ad7936254f5eea6cdad2558d49d0b',
    sentInOrder: 'caa3f9ff0dd1e6611163d9b1a071b9db5619d4ad8c57cc1f86bef464af171c87',
    sentSorted: '879a5e82f74d8dc9db4287c00b9e8334cbb1c825c4e92c18b27008f17f0620cf' },
]);
/** D88 (owner decision 2026-10-14; story /25): every case's story, by its order alone — the agent's judgment first, the
 *  rows Sonah could not check folded under their own heading last. Nothing renders a story back, so every capture below
 *  carries it. No ledger, gap, request, label, window or window failure moved. */
const MOVED_BY_JUDGMENT_FIRST = Object.freeze([
  { story: 'f47a4d705a2df11f8992b3a8e787f3ef95d0473452960f3466b45eadaad9d2fe' },
  { story: 'c4abb0c395d9948dccebae7d8bc24aa83df603be04882b4a80e7ad93bd838ec5' },
  { story: '7df06cb837b7f49ec3ff19d2cc697c6f5e6460e66a6cb7e8d8021ef54051350b' }]);
/** D90 (owner decision 2026-10-15; story /30, the agentic code step's release item): every case's story, by its footer
 *  alone — it is generated from the recorded session, no longer "from a redacted recording" (nothing is masked for a
 *  person). Nothing renders a story back, so every capture below carries it. No ledger, gap, request, label, window or
 *  window failure moved. */
const MOVED_BY_AGENTIC = Object.freeze([
  { story: 'f46231e377eda71968b8f7142ac551ba0e2aab8f9c90089676c95330ca1fc971' },
  { story: 'b9ff29033506a2eeed76a03a3c93174635aafc14b8d12df7d74df3a35b0ba904' },
  { story: 'c80799e91498322e46c1abd1bd1608060abb6571f405b5e6dd7d3eaae762e6d5' }]);
/** D97 (STE at about 80%): every case's story, by the fixed words it reads from review.js and code-report.js alone
 *  (the attention lines, the folded section, the coverage causes and the code review's words, rewritten in STE).
 *  Nothing renders a story back, so every capture below carries it. No ledger, gap, request, label, window or window
 *  failure moved. */
const MOVED_BY_STE = Object.freeze([
  { story: '385936d63c52c70e5cb034bc3301cb25e40d8e6e1eb3b06af307886c9ac68d32' },
  { story: '9942528a0abb93402c1f0ddd1bf13b37e61c77ed80d71a0b10ca22839e46dd5f' },
  { story: 'febbb1e8e711547e91b58657b923fa0706b741d83624174760a7f4ee48c74b82' }]);
/** D97 (owner decisions 2026-10-16; story /32): every case's story, by what the story is — the report .md, the report
 *  model rendered for a pull request comment, in the STE words (MOVED_BY_STE's tables). Nothing renders a story back,
 *  so every capture below carries it. No ledger, gap, request, label, window or window failure moved. */
const MOVED_BY_REPORT_MD = Object.freeze([
  { story: '6dbadfc7f5ec2c3d3649935fc707d00728348b231a020f8fd5d38bbc0b3c0ec0' },
  { story: '08cbf4a58e4a4f0111ca8bc31b323f6d22b3972cf331538974170120aa1ba925' },
  { story: 'eafd2147169b2d8db8e956b93d576f2bc299d9c9b30b76af8b75f749fa012394' }]);
/** D97 (the review of the .md and its samples, story /32 unreleased): every case's story, by the report's fixes alone —
 *  the word count, the prompt table's one coverage line, code spans, labels that name their item, a repository's
 *  missing links said once, the tiers of "you asked, the agent decided how" (D96 amended). Nothing renders a story
 *  back, so every capture below carries it. No ledger, gap, request, label, window or window failure moved. */
const MOVED_BY_MD_FIXES = Object.freeze([
  { story: '9da95f12bc363d397e3d0c1073ae800878f86319672eba01ed3ab3fbddb38b86' },
  { story: '717a74c510fa5c786d27699b4b793b3737854100d6b024d41a57272a98220a42' },
  { story: '076cd70a85f709bd946fb40afe7755154dad86d148c8d8574cc8d65b4c50da3d' }]);
/** The beta.2 release check's render fixes (story /32 unreleased): every case's story, by the report's words alone — no
 *  sentence of silence for an unlinked quote, a decision's dimension in its what line, the evidence fold's count gone,
 *  a refused command said apart, and the claims list's own statuses and words; and, as none of these cases has an edit
 *  that landed, no line about a last edit, and an empty list of what the agent said it did not do said as what Sonah
 *  found. Nothing renders a story back, so every capture below carries it. No ledger, gap, request, label, window or
 *  window failure moved. */
const MOVED_BY_RELEASE_CHECK = Object.freeze([
  { story: 'ef0c7dfed30b560cd0c19ae6de28da70c69656b39d107c2be5054367aa980579' },
  { story: '24eafcef3838bea79e0b0790bf321ebc8842e683c67ee218177bde7c95a0a6e2' },
  { story: '9f50a0cce2915bdfd6f772c4ac85e36b8ca4ad21a3d0ea9be69062c4fb3152e8' }]);
/** D100 (the audit of absence sentences, story /35): every case's story, by the report's words alone — what the agent
 *  did and the runs say what Sonah found or read ("Sonah found no file in the repository that the agent changed", "Sonah
 *  found no command in the recording", "Sonah found no decision that you settled", "Sonah read no exit code"), and what
 *  Sonah could not check says what Sonah holds or could not read, never the recording's word. Nothing renders a story
 *  back, so every capture below carries it. No ledger, gap, request, label, window or window failure moved. */
const MOVED_BY_ABSENCE_AUDIT = Object.freeze([
  { story: '71b459519eeaec6bb5aa0b03cd36bae3fbc1879ca4f31f373a239aa5e8ec57f3' },
  { story: 'f66b219968923b61f38a6cfae78ee5d54a6f3991612347ad42504abacdaa2ac7' },
  { story: 'f52da61943ee432e3eb78e83ae2d1b5e09124f02f21e1f3b1acf470115008f87' }]);
/** D101 (owner decision 2026-10-17; story /36, report model /2): every case's story, by the report model's version in its
 *  footer alone (no ask of these cases is lowered at the quote gate, so no cause's words show; rendered with the model's
 *  /1, each is MOVED_BY_ABSENCE_AUDIT's, byte for byte). Nothing renders a story back, so every capture below carries it.
 *  No ledger, gap, request, label, window or window failure moved. */
const MOVED_BY_GROUNDING_CAUSES = Object.freeze([
  { story: '5ad4060990cc1101652a2b7358dac683d32f6916995a9f3e31a0659ab8d1db9f' },
  { story: 'c410e29ca7998e8f4b4ff505bddfdb2fb080219ce3d74523c14d03c5d85d9729' },
  { story: 'ba8302866a93f79aa8e1f21986e48b00b37e421d0f1df2a89fbb7e4a08be0767' }]);
/** D104 (F5 part 4, the mark; story /37, report model /3): every case's story, by the report model's version in its
 *  footer alone — none of these cases holds a result a window showed in part, so no mark and no count moved (rendered with
 *  the model's /2, each is MOVED_BY_GROUNDING_CAUSES's, byte for byte). Nothing renders a story back, so every capture
 *  below carries it. No ledger, gap, request, label, window or window failure moved. */
const MOVED_BY_SEEN_IN_PART = Object.freeze([
  { story: '277026d0a2c9cdde768d9f720508a22310d833ae8e57863f4f1997075b541cbf' },
  { story: 'ffd8c3fdb783ca0cc78a7e816f553b6b8fec01432630eae3083ef181688636f1' },
  { story: '764db68935e4b58a346ae6ca235bf37efb1f140ec5c4aad75697b00dd1d115ae' }]);
/** D77 C (story /14, a step is one of your requests): the ONLY value that moved from S7's — the `conflicted` case's story,
 *  whose one review window holds its three requests: three steps now, one per request (each heading followed by its own
 *  step, the overview A1 -> S1 -> A2 -> S2 -> A3 -> S3, each request's rows in its own step). The other two cases hold one
 *  request each and keep their bytes; no ledger, gap, request, label, window or window failure moved. (The other design
 *  considered, Option A, produced the same digest for this case: with each request's work inside its own window the two
 *  designs agree byte for byte.) */
const MOVED_BY_REQUEST_STEPS = Object.freeze([{}, {},
  { story: 'f880bed60c37ed1c05349c03291b366ae442288f77a06d3a012fdba7a7817183' }]);
const MOVED_BY_D71 = Object.freeze([{ story: '362bd47b0b91381dd62e78fad6a3f0e63c5d8a6d294f1fd60ac73c3c122d2ed0' },
  { story: '193abe685846a3544e233d67fa317efb6a8b601bc38587e5ac04505846c184a1' },
  { story: '52379721a36d2c9303bf2d1fac0f431d555f5b04f490aa8c834f44021b6a61dd' }]);
/**
 * M36 phase 2, the window format (D68 L; C-07 "M36 window format"; `sonah.narrative/23`, `sonah.challenge/20`):
 * the ONLY values that moved from `MOVED_BY_RECORDED_FACTS` — each case's narrative and challenge requests (each RESULT
 * opens with its label line built from the recorder's typed fields). No ledger, gap, story, window count, number of
 * requests, label, order or window failure moved (`withoutRequests`).
 */
const MOVED_BY_M36_FORMAT = Object.freeze([
  { planned: '05d3721c1c61aa69a17fac6814cb60bc98e0a1c72d46f1dd161cf4b414674986',
    sentInOrder: '66fb140763bd378f7dac043e0665ee86c2b225ec2a06259f2d7611b5542543d0',
    sentSorted: '070bb12720338a2f2dceff9cec29d8d99703b85998f0bc3809144e4116ef76bc' },
  { planned: '54d93fc638c9a3e9d0827b2ff35c329c3c8885e3c5b5c2d472a6fd44f1f11494',
    sentInOrder: '4aee828efdb7aad10c8147feb6bf270cfa235aa1253adbe47298bc54eb52b5bc',
    sentSorted: '83c6583077ed6bab3b4b43d31f973186eae66088d4a7ef75f7042e5f03812b9a' },
  { planned: 'fd49098c825a10abe08607ba328d9e116be9479b636d32fb6a7657f036a808a1',
    sentInOrder: 'e666f720d5f8044436c1e032171e5f7e2c019bb2971c2c351081e27f47a8aac1',
    sentSorted: 'c34190f181526e754991aa668f31e858608d80f638f896cae20f87cb29b13405' },
]);

/**
 * M36 phase 3 (D68 K, Q, F; `sonah.narrative/24`, `sonah.challenge/21`): the ONLY values that moved from
 * `MOVED_BY_M36_FORMAT` — each case's narrative requests, by item 1's actor sentence and the session-only contract's
 * `evidenceRequests` member and rules alone (rendered back, `modulesBeforeM36Conversation`, they are phase 2's). No case
 * links a helper or carries a proven failure: no ledger, gap, story, window count, number of requests, label, order or
 * window failure moved.
 */
const MOVED_BY_M36_CONVERSATION = Object.freeze([
  { planned: '83abc3194725b719c7bf2c0bb03db9c0563faf4e15123e538a68604b77d852b8',
    sentInOrder: '589697462428cb8cef51b6445d06a47832d80b4807f5a5102cd1957cd77c4471',
    sentSorted: '400696ffd28bf1df79c273b94227c4a5da05769643c536c55e6df1cf2e406935' },
  { planned: '01861f6bbb4a4068ca8589271794fc86f51acb91bbcac1d0a9e5f2d2c758987a',
    sentInOrder: '3777642cb503ea7e8d2e3c191059503e7479cd69c71d1aae89bc052a519cf3a6',
    sentSorted: '24b09aede42df308ac6d9d92d78eba7e4304fe51c05e105e0e073a59d36b2d80' },
  { planned: '8c6b90db46e90812e835dd3114e10630341170998376ab698e11b5b69c29992b',
    sentInOrder: '0319b1e48f2894cc89335984fb87a45fd06355dfe9a1f661cd01921059bb7b3a',
    sentSorted: '94296bcafabf8997aa6f45d97332c6c6fdd5510526922cdf2ceb29b1198c02cc' },
]);

/**
 * D69 (c) (owner decision 2026-10-08): the "first error line" is deleted with the patterns that picked it. The one value
 * that moved in this file is case `unresolved`'s whole-ledger digest: its failed Workflow call carried `firstErrorLine:
 * null` (an output no pattern matched), right after `attempted`, and carries none now. Rendered back
 * (`modulesBeforeD69`: the key put back where it stood), every level below is as before; no gap, request, label, story,
 * window or window failure moved.
 */
const MOVED_BY_D69 = Object.freeze([{}, { ledger: '4824932c309b7c1d050cc154f7b19a332ad8824b58a3869835a2b713e4ae023e' }, {}]);
const withLegacyFirstErrorLine = (ledger) => ({ ...ledger, ledger: ledger.ledger.map((event) => {
  if (event?.kind !== 'error' || !Object.hasOwn(event, 'attempted') || Object.hasOwn(event, 'firstErrorLine')) return event;
  const out = {};
  for (const [key, value] of Object.entries(event)) { out[key] = value; if (key === 'attempted') out.firstErrorLine = null; }
  return out;
}) });
const modulesBeforeD69 = (m) => ({ ...m, redact: (raw, ...more) => {
  const out = m.redact(raw, ...more);
  return { ...out, ledger: withLegacyFirstErrorLine(withoutCommandAttempted(out.ledger)) };
} });
/**
 * D71 (S2): a failed command keeps the kind it attempted (`attempted`: `bash`, `test`) beside the
 * legacy `error` kind, so a case whose ledger holds one moved by that field alone. Rendered back (the field taken off a
 * failed command, as the slicer wrote it before), every level below is as before: `modulesBeforeD69` applies it first.
 */
const withoutCommandAttempted = (ledger) => ({ ...ledger, ledger: ledger.ledger.map((event) => {
  if (event?.kind !== 'error' || !['bash', 'test'].includes(event.attempted)) return event;
  const { attempted: _attempted, ...rest } = event;
  return rest;
}) });

test('C-01 stable event ids: a session with no Workflow call, or whose calls link nothing, moved by its identities alone', async () => {
  const fd5d129 = (at) => ({ ...BASE_FD5D129[at], ...MOVED_BY_M33_C2[at], ...MOVED_BY_M33_H[at] });
  const now = (at) => ({ ...fd5d129(at), ...MOVED_BY_H4[at], ...MOVED_BY_M1.n13[at], ...MOVED_BY_H3[at],
    ...MOVED_BY_INTEGRATION.current[at], ...MOVED_BY_LABELS_MERGE.current[at] });
  // As /19 sent them: the D64 wording's proposer sentences rendered back (`modulesBeforeDisclosureWords`) — every value
  // M35 windowing did not move (`withoutRequests`): the requests rendered back reproduce no capture before it.
  // D68: the recorded facts rendered back first (`modulesBeforeRecordedFacts`).
  assert.deepEqual((await captureStableCases(modulesBeforeDisclosureWords(modulesBeforeRecordedFacts(modulesBeforeD69(STABLE_MODULES)))))
    .map(withoutRequests).map(withoutStory),
    BASE_FD5D129.map((c, at) => withoutStory(withoutRequests({ ...now(at), ...MOVED_BY_STABLE_IDS[at] }))), 'as /19 sends them');
  // As the code sends them: moved by the D64 wording's two texts (MOVED_BY_DISCLOSURE_WORDS), then by M35 windowing
  // (MOVED_BY_WINDOWING), then by the recorded facts (MOVED_BY_RECORDED_FACTS).
  const phase2 = BASE_FD5D129.map((c, at) => ({ ...now(at), ...MOVED_BY_STABLE_IDS[at],
    ...MOVED_BY_DISCLOSURE_WORDS[at], ...MOVED_BY_WINDOWING[at], ...MOVED_BY_RECORDED_FACTS[at], ...MOVED_BY_M36_FORMAT[at] }));
  // M36 phase 3: rendered back (`modulesBeforeM36Conversation`), every case is phase 2's, byte for byte — but for the
  // requests D71 (S2) moved, which nothing renders back (`withoutRequests`).
  assert.deepEqual((await captureStableCases(modulesBeforeM36Conversation(modulesBeforeD69(STABLE_MODULES))))
    .map(withoutStory).map(withoutRequests), phase2.map(withoutStory).map(withoutRequests), 'as phase 2 sent them');
  // D69: rendered back (`modulesBeforeD69`), every case is M36 phase 3's; as the code sends them, one ledger moved.
  const m36 = phase2.map((c, at) => ({ ...c, ...MOVED_BY_M36_CONVERSATION[at] }));
  assert.deepEqual((await captureStableCases(modulesBeforeD69(STABLE_MODULES))).map(withoutStory).map(withoutRequests),
    m36.map(withoutStory).map(withoutRequests), 'as M36 phase 3 sent them');
  // D71 (a): as the code sends them, one ledger moved (D69) and every story (D71); D71 (S2): every case's requests, and
  // a failed command's `attempted` (MOVED_BY_D71_BRIEF).
  const current = await captureStableCases(STABLE_MODULES);
  // D71 (S3): and every case's requests once more (MOVED_BY_D71_CHANNELS).
  // S6: and every case's requests and story once more (MOVED_BY_D71_FIX). S7: and every case's requests (MOVED_BY_S7).
  // D77 C: and one case's story (MOVED_BY_REQUEST_STEPS). The column fix: and every case's requests
  // (MOVED_BY_FIX_COLUMN). The asks fixes: and every case's requests once more (MOVED_BY_ASKS_FIXES). W1 B: and once
  // more (MOVED_BY_W1); rendered back (`modulesBeforeW1`), the asks fixes', byte for byte. D88: and every story once
  // more (MOVED_BY_JUDGMENT_FIRST), in every capture: nothing renders a story back. D90: and every story once more
  // (MOVED_BY_AGENTIC), the same way. D97: and every story once more (MOVED_BY_STE), the same way; and once more
  // (MOVED_BY_REPORT_MD), the story now the report .md; and once more (MOVED_BY_MD_FIXES), by the report's fixes; and
  // once more (MOVED_BY_RELEASE_CHECK), by the release check's render fixes; and once more (MOVED_BY_ABSENCE_AUDIT), by
  // the audit of absence sentences; and D101 once more (MOVED_BY_GROUNDING_CAUSES), by the report model's version; and
  // D104 once more (MOVED_BY_SEEN_IN_PART), by the report model's version in the footer.
  const asksFixes = m36.map((c, at) => ({ ...c, ...MOVED_BY_D69[at], ...MOVED_BY_D71[at], ...MOVED_BY_D71_BRIEF[at],
    ...MOVED_BY_D71_CHANNELS[at], ...MOVED_BY_D71_FIX[at], ...MOVED_BY_S7[at], ...MOVED_BY_REQUEST_STEPS[at],
    ...MOVED_BY_FIX_COLUMN[at], ...MOVED_BY_ASKS_FIXES[at], ...MOVED_BY_JUDGMENT_FIRST[at], ...MOVED_BY_AGENTIC[at],
    ...MOVED_BY_STE[at], ...MOVED_BY_REPORT_MD[at], ...MOVED_BY_MD_FIXES[at], ...MOVED_BY_RELEASE_CHECK[at],
    ...MOVED_BY_ABSENCE_AUDIT[at], ...MOVED_BY_GROUNDING_CAUSES[at], ...MOVED_BY_SEEN_IN_PART[at] }));
  // W2: and once more (MOVED_BY_W2); rendered back (`modulesBeforeW2`), W1's, byte for byte.
  // W3 F1(b): and once more (MOVED_BY_W3); rendered back (`modulesBeforeW3`), W2's, byte for byte.
  // The fix review: and once more (MOVED_BY_FIX_REVIEW); rendered back (`modulesBeforeFixReview`), W3's, byte for byte.
  assert.deepEqual(current, asksFixes.map((c, at) => ({ ...c, ...MOVED_BY_W1[at], ...MOVED_BY_W2[at], ...MOVED_BY_W3[at],
    ...MOVED_BY_FIX_REVIEW[at] })), 'as the code sends them');
  assert.deepEqual(await captureStableCases(modulesBeforeFixReview(STABLE_MODULES)),
    asksFixes.map((c, at) => ({ ...c, ...MOVED_BY_W1[at], ...MOVED_BY_W2[at], ...MOVED_BY_W3[at] })), 'as W3 sent them');
  assert.deepEqual(await captureStableCases(modulesBeforeW3(STABLE_MODULES)),
    asksFixes.map((c, at) => ({ ...c, ...MOVED_BY_W1[at], ...MOVED_BY_W2[at] })), 'as W2 sent them');
  assert.deepEqual(await captureStableCases(modulesBeforeW2(STABLE_MODULES)),
    asksFixes.map((c, at) => ({ ...c, ...MOVED_BY_W1[at] })), 'as W1 sent them');
  assert.deepEqual(await captureStableCases(modulesBeforeW1(STABLE_MODULES)), asksFixes, 'as the asks fixes sent them');
});

test('M33 W a session with no Workflow call, or whose Workflow calls link nothing, keeps fd5d129\'s bytes but its requests', async () => {
  // M33 N (`sonah.narrative/14`) moved every session-only narrative request by its three forbidden-edit texts alone:
  // rendered back as /13 sent them (`modulesBeforeForbiddenEdit`), the capture is M33 H's below, byte for byte. H3 moved
  // them once more (MOVED_BY_H3), and the status fact: their texts are rendered back first (`modulesBeforeStatusFact`,
  // `modulesBeforeHedgedClaims`).
  // M34 labels (merged): every level below holds the merged ledgers (`MOVED_BY_LABELS_MERGE.current`); no request moved.
  const fd5d129 = (at) => ({ ...BASE_FD5D129[at], ...MOVED_BY_M33_C2[at], ...MOVED_BY_M33_H[at] });
  const now = (at) => ({ ...fd5d129(at), ...MOVED_BY_H4[at], ...MOVED_BY_M1.n13[at], ...MOVED_BY_H3[at],
    ...MOVED_BY_INTEGRATION.current[at] });
  // C-01 event identity: adapted as before stable ids (`positionalModules`), at every level below; and the D64 wording's
  // proposer sentences rendered back as /19 sent them (`modulesBeforeDisclosureWords`).
  // M35 windowing moved every request (MOVED_BY_WINDOWING): at every level below, every value but the requests
  // (`withoutRequests`) is compared; the request values before M35 are kept as the record.
  const POSITIONAL = modulesBeforeDisclosureWords(positionalModules(modulesBeforeRecordedFacts(modulesBeforeD69(STABLE_MODULES))));
  // D71 (a): and every value but the story (`withoutStory`), pinned as the code renders it in the test above.
  const capture = async (modules) => (await captureStableCases(modules)).map(withoutRequests).map(withoutStory);
  const expect = (values) => values.map(withoutRequests).map(withoutStory);
  assert.deepEqual(await capture(POSITIONAL), expect(BASE_FD5D129.map((c, at) => ({ ...now(at),
    ...MOVED_BY_LABELS_MERGE.current[at] }))), 'as the code sends them');
  // With the label counts taken out, the ledger moved by the deleted untyped marks and the linked notifications alone.
  assert.deepEqual(await capture(withoutLabelCounts(POSITIONAL)), expect(BASE_FD5D129.map((c, at) => ({ ...now(at),
    ...MOVED_BY_LABELS_MERGE.withoutCounts[at] }))), 'without the label counts');
  const back = (modules) => modulesBeforeForbiddenEdit(modulesBeforeStatusFact(modulesBeforeHedgedClaims(modules)));
  // fd5d129's capture, but for the challenge-request values M33 C2 moved and the request values M33 H's repair moved.
  // M33 brittleness H4 moved the story's counts-row header, and only it; M1 moved the first case's command kind.
  assert.deepEqual(await capture(back(POSITIONAL)), expect(BASE_FD5D129.map((c, at) => ({ ...fd5d129(at), ...MOVED_BY_H4[at],
    ...MOVED_BY_M1.n13[at], ...MOVED_BY_INTEGRATION.story[at], ...MOVED_BY_LABELS_MERGE.current[at] }))));
  // Rendered back as /12 and /9 sent them, every case is M33 C2's byte for byte (with H4's story and M1's command kind).
  assert.deepEqual(await capture(modulesBeforeRelayRule(back(POSITIONAL))),
    expect(BASE_FD5D129.map((c, at) => ({ ...c, ...MOVED_BY_M33_C2[at], ...MOVED_BY_H4[at], ...MOVED_BY_M1.n12[at],
      ...MOVED_BY_INTEGRATION.story[at], ...MOVED_BY_LABELS_MERGE.current[at] }))));
});

test('M33 W the journal key is opaque: never compared, never shown', async (t) => {
  const { ledger, session } = await load(t);
  for (const agentId of [AGENTS.fixer, AGENTS.tester]) {
    assert.equal(JSON.stringify(ledger).includes(journalKey(agentId)), false);
    assert.equal(Object.values(session.blobs).some((blob) => blob.includes(journalKey(agentId))), false);
  }
});

// ---- M33 W repair ---------------------------------------------------------------------------------------------------

test('M33 W a run directory is claimed once per review: a nested call naming its own run links nothing', async (t) => {
  // The fixer's own recording runs a Workflow call whose recorded sidecar names the run the fixer belongs to. The
  // parent's call claimed that run first (its agents are read only after it is claimed), so the nested claim is
  // unresolved and keeps its M33 D declaration; every agent of the run stays the parent call's helper.
  const dir = await scratch();
  t.after(() => rm(dir, { recursive: true, force: true }));
  const nestedCall = (row) => row('assistant', [{ type: 'tool_use', id: 'toolu_fixer_own_run', name: 'Workflow',
    input: { description: 'again', script: 'export default async function run() {}' } }], {}, 'own-run');
  const nestedResult = (row) => row('user', [{ type: 'tool_result', tool_use_id: 'toolu_fixer_own_run',
    content: 'Workflow launched in the background.\nTask ID: wtask_own' }], { toolUseResult: { runId: RUN,
    status: 'async_launched', taskId: 'wtask_own', taskType: 'local_workflow', transcriptDir: runDir(dir),
    workflowName: 'fix-parser' } }, 'own-run:r');
  const run = linkedRun({ agents: { [AGENTS.fixer]: fixerRows({ extra: [nestedCall, nestedResult] }),
    [AGENTS.tester]: testerRows() } });
  const { ledger, session } = await load(t, { root: dir, run });
  assert.deepEqual(ledger.workflowRuns, [{ turn: 1, seq: 0, linked: 2, receipt: { turn: 1, beforeEvent: 1, source: 0, record: 4 } }]);
  assert.deepEqual(ledger.delegations.filter((d) => d.kind === 'workflow-agent').map((d) => d.childId),
    [AGENTS.fixer, AGENTS.tester], 'both agents are the parent call\'s helpers');
  const fixerLedger = ledger.children[0].ledger;
  assert.equal(fixerLedger.workflowRuns, undefined, 'the nested call resolved no run');
  assert.equal((fixerLedger.delegations ?? []).length, 0);
  assert.deepEqual(workflowGaps(session).filter((gap) => gap.note !== WORKFLOW_GAP_NOTES.agents), [],
    'no agent is declared mismatched or otherwise lost');
  const nested = named(session, `child:${AGENTS.fixer}:A1-2`);
  assert.equal(session.event(nested)?.tool, 'Workflow');
  assert.ok(session.adapterGaps.some((gap) => gap.note === WORKFLOW_GAP_NOTES.agents && gap.eventIds.includes(nested)),
    'the nested call keeps its M33 D declaration');
});

test('M33 W a parent with conflicting recorded identities links no Workflow agent, as it links no Agent/Task child', async (t) => {
  // Rows of two sessions interleaved: not the resumed shape (two contiguous blocks), so the parent links nothing.
  const dir = await scratch();
  t.after(() => rm(dir, { recursive: true, force: true }));
  const rows = parentRows({ earlier: true, workflows: [workflowRows({ transcriptDir: runDir(dir) })] });
  const stray = { ...rows[0], uuid: '5f0c2d1e-0000-4000-8000-0000000000ff', message: { role: 'user',
    content: 'One more note from the earlier session.' } };
  const { ledger, session, raw } = await load(t, { root: dir, parent: [...rows.slice(0, -1), stray, rows.at(-1)] });
  assert.equal(raw.sources[0].identityConflict, true);
  assert.notEqual(raw.sources[0].sessionIdConflictOnly, true, 'not the resumed shape');
  assert.equal(ledger.workflowRuns, undefined);
  assert.equal((ledger.delegations ?? []).filter((d) => d.kind === 'workflow-agent').length, 0);
  assert.ok(session.adapterGaps.some((gap) => gap.note === WORKFLOW_GAP_NOTES.agents
    && gap.eventIds.includes(named(session, 'A2-0'))),
    'the call keeps its M33 D declaration');
});

test('M33 W every other entry of a linked run directory is declared, never passed over', async (t) => {
  const { ledger, session } = await load(t, { roots: { before: async (dir) => {
    // A subdirectory holding an agent-shaped recording, a stray file, and a meta file whose name is no agent's.
    await mkdir(join(runDir(dir), 'subagents'), { recursive: true });
    await writeFile(join(runDir(dir), 'subagents', `agent-${AGENTS.stray}.jsonl`),
      testerRows({ agentId: AGENTS.stray }).map((r) => JSON.stringify(r)).join('\n') + '\n', { mode: 0o600 });
    await writeFile(join(runDir(dir), 'notes.txt'), 'synthetic\n', { mode: 0o600 });
    await writeFile(join(runDir(dir), 'agent-zz.meta.json'), '{}\n', { mode: 0o600 });
  } } });
  assert.deepEqual(ledger.workflowRuns, [{ turn: 1, seq: 0, linked: 2, losses: { workflow_run_entry_unread: 3 },
    receipt: { turn: 1, beforeEvent: 1, source: 0, record: 4 } }]);
  const gaps = workflowGaps(session);
  assert.deepEqual(gaps.map((gap) => [gap.note, gap.code, gap.count, relabelled(session, gap.eventIds)]),
    [[WORKFLOW_RUN_GAP_NOTES.workflow_run_entry_unread, 'incomplete_inventory', 3, ['A1-0']]]);
  assert.equal(session.events.some((e) => e.childId === AGENTS.stray), false, 'never read');
  // The run's own meta files are known entries: a plain linked run declares nothing.
  const plain = await load(t);
  assert.deepEqual(plain.ledger.workflowRuns, [{ turn: 1, seq: 0, linked: 2,
    receipt: { turn: 1, beforeEvent: 1, source: 0, record: 4 } }]);
});
