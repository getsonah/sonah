// D99 (F1 guard), the evidence half: what a reader is told about a background run's end.
//
//   - "It started in the background. The recording shows no end of it." only for a run whose recording the slicer
//     proved holds no end (no `backgroundEnd` mark). Such a run is listed among the failures, as before.
//   - a run whose end the slicer could not read (`backgroundEnd` `unread`) is end-unread: "Later records mention this
//     run, but Sonah could not read whether or how it ended." It is shown under what Sonah could not check, never as a
//     failure, and a claim resting on it is open, never "a check that did not complete".
//   - a run its own notification typed stopped or killed was "stopped before it finished".
//   - Workflow and Agent runs with no receipt: the note says the parent recorded no receipt only when that is proved.
//
// Synthetic recordings only, sliced, bounded and adapted as a review loads them. No model call.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sliceLineage } from '../../slicer/index.js';
import { BACKGROUND_ENDS } from '../../slicer/src/events.js';
import { HELPER_DELIVERY_REASONS } from '../../slicer/src/helper-deliveries.js';
import { redact } from '../../redact/index.js';
import { sessionFromLedger, LEDGER_BACKGROUND_ENDS, END_UNREAD_NOTE, END_UNCHECKED_NOTE, WORKFLOW_GAP_NOTES,
  HELPER_PLACEMENT_NOTES, HELPER_DELIVERY_GAP_NOTES } from '../adapters/sonah-ledger.js';
import { resultOutcome, actionOutcome, FAILURE_OUTCOMES, RESTS_ON_OUTCOMES, NOT_COMPLETED_OUTCOMES,
  RESULT_OUTCOME_CLASSES, END_UNCHECKED_FORM } from '../src/ledger.js';
import { CHECKLIST_OUTCOME_WORDS, CHECKLIST_REQUIREMENT_REASON_WORDS, COVERAGE_CAUSES, COVERAGE_SENTENCE, coverageCauses }
  from '../src/review.js';
import { windowFailures, checkedRequirement, restsOnCheck } from '../src/checklist.js';
import { planWindowRequests } from '../src/run-review.js';
import { reportModel } from '../../render/report-model.js';
import { loadSessionEvidence } from '../../cli/src/session-evidence.js';
import { claudeParentRows, claudeTree, AGENT } from '../../cli/test/m33-p-placement-fixture.js';
import { RUN, SID as WORKFLOW_SID, SLUG, TASK, linkedRun, writeTree, scratch } from '../../cli/test/m33-w-workflow-fixture.js';
import { verifierBeforeFixRows, askRow, W2_TEXT } from '../../cli/test/m33-w2-placement-fixture.js';

const SESSION = 'c0ffee00-0000-4000-8000-0000000000e9';
let uuidN = 0;
const row = (extra) => ({ sessionId: SESSION, cwd: '/repo', isSidechain: false, version: '2.1.296',
  uuid: `e-${uuidN++}`, ...extra });
const ask = (text) => row({ type: 'user', origin: { kind: 'human' }, message: { role: 'user', content: text } });
const say = (text) => row({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text }] } });
const use = (id, name, input) => row({ type: 'assistant', message: { role: 'assistant',
  content: [{ type: 'tool_use', id, name, input }] } });
const answer = (id, content, sidecar) => row({ type: 'user', message: { role: 'user',
  content: [{ type: 'tool_result', tool_use_id: id, content, is_error: false }] }, toolUseResult: sidecar });
const SUCCESS = Object.freeze({ stdout: '', stderr: '', interrupted: false, isImage: false, noOutputExpected: false });
const notice = (taskId, callId, status) => row({ type: 'user', origin: { kind: 'task-notification', runId: 'r' },
  message: { role: 'user', content: `<task-notification>\n<task-id>${taskId}</task-id>\n<tool-use-id>${callId}`
    + `</tool-use-id>\n<status>${status}</status>\n<summary>ended</summary>\n</task-notification>` } });
const launch = (id, taskId, command) => [use(id, 'Bash', { command, run_in_background: true }),
  answer(id, `Command running in background with ID: ${taskId}.`, { ...SUCCESS, backgroundTaskId: taskId })];

/** One recording: a run with no end and no later mention (absent), one whose notice no reader of this release can
 *  type (unread), one typed killed (stopped), and a completed one. */
const ROWS = [ask('Run the four jobs in the background.'),
  ...launch('b1', 'bge1', 'make absent'),
  ...launch('b2', 'bge2', 'make unread'), notice('bge2', 'b2', 'archived'),
  ...launch('b3', 'bge3', 'make stopped'), notice('bge3', 'b3', 'killed'),
  ...launch('b4', 'bge4', 'make typed'), notice('bge4', 'b4', 'completed'),
  say('All four jobs ran.')];

async function loaded(t, rows = ROWS) {
  const dir = await mkdtemp(join(tmpdir(), 'sonah-d99-evidence-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const file = join(dir, `${SESSION}.jsonl`);
  await writeFile(file, rows.map((r) => JSON.stringify(r)).join('\n') + '\n');
  const raw = await sliceLineage([file], { cwd: '/repo' });
  const session = sessionFromLedger(redact(raw).ledger, { sessionKey: 'd99-evidence' });
  const call = (cmd) => session.events.find((e) => e.kind === 'invocation' && e.operation === 'command'
    && session.textSpansOf(e, 'command').join(' ').includes(cmd));
  const result = (cmd) => session.events.find((e) => e.kind === 'observation' && e.invocation === call(cmd).id);
  return { raw, session, call, result, file };
}

test('D99 F1 guard: the adapter re-declares the slicer\'s background ends, and carries them as recorded', async (t) => {
  assert.deepEqual(LEDGER_BACKGROUND_ENDS, BACKGROUND_ENDS);
  const { call } = await loaded(t);
  assert.deepEqual(['make absent', 'make unread', 'make stopped', 'make typed'].map((cmd) => call(cmd).backgroundEnd),
    [undefined, 'unread', 'stopped', undefined]);
});

test('D99 F1 guard: an absence is said only where it is proved; an unread end and a stop get true words', async (t) => {
  const { session, result, call } = await loaded(t);
  const outcome = (cmd) => resultOutcome(session, result(cmd));
  assert.deepEqual([outcome('make absent').class, outcome('make absent').form], ['no-terminal-status', 'background']);
  assert.deepEqual([outcome('make unread').class, outcome('make unread').form], ['end-unread', 'background']);
  assert.deepEqual([outcome('make stopped').class, outcome('make stopped').form], ['no-terminal-status', 'interrupted']);
  assert.equal(outcome('make typed').class, 'ran-completed');
  // An action reads its result's outcome.
  assert.equal(actionOutcome(session, call('make unread')).class, 'end-unread');
  // The words a person reads, and those a model request carries.
  const words = (cmd) => CHECKLIST_OUTCOME_WORDS[outcome(cmd).class](null, outcome(cmd).form);
  assert.equal(words('make absent'), 'It started in the background. The recording shows no end of it.');
  assert.equal(words('make unread'), 'Later records mention this run, but Sonah could not read whether or how it ended.');
  assert.equal(words('make stopped'), 'It stopped before it finished.');
  assert.doesNotMatch(outcome('make unread').words, /no terminal status|no end/);
  // Nor an end, or a later mention, that the run may not have: the words a model request carries.
  assert.equal(outcome('make unread').words, 'run in the background; Sonah could not read whether or how it ended');
  assert.match(outcome('make stopped').words, /stopped before it finished/);
});

test('D99 F1 guard: an unread end is no failure and no check that did not complete; it is not checked', async (t) => {
  assert.equal(RESULT_OUTCOME_CLASSES.at(-1), 'end-unread');
  assert.equal(RESULT_OUTCOME_CLASSES[4], 'no-terminal-status', 'no class moved');
  assert.equal(FAILURE_OUTCOMES.includes('end-unread'), false);
  assert.equal(RESTS_ON_OUTCOMES.includes('end-unread'), false);
  assert.equal(NOT_COMPLETED_OUTCOMES.includes('end-unread'), true, 'a deliverable citing it is not checked');
  const { session, call } = await loaded(t);
  const failures = windowFailures(session, { events: session.events })
    .map(({ event }) => session.textSpansOf(session.event(event.invocation), 'command').join(' '));
  assert.deepEqual(failures, ['make absent', 'make stopped']);
  assert.ok(call('make unread'));
});

test('D99 F1 guard: an ask resting on an unread end is not checked, in words that state no absence', async (t) => {
  const { session, call, result } = await loaded(t);
  const sourceMap = planWindowRequests({ session, reviewScope: 'session-only' }).requests[0].sourceMap;
  const ask = session.events.find((e) => e.kind === 'instruction');
  const askQuote = { eventId: ask.id, role: 'instruction', quote: 'Run the four jobs in the background.' };
  const checked = (cmd, taskId) => checkedRequirement(session, { text: 't', instruction: askQuote, status: 'done',
    deliverable: { eventId: result(cmd).id, role: 'observation', quote: `Command running in background with ID: ${taskId}` } },
  { sourceMap });
  assert.deepEqual([checked('make unread', 'bge2').candidate.status, checked('make unread', 'bge2').reason],
    ['not-checked', 'check_end_unread']);
  assert.equal(checked('make absent', 'bge1').reason, 'check_not_completed');
  assert.equal(CHECKLIST_REQUIREMENT_REASON_WORDS.check_end_unread, 'later records mention the run that the session '
    + 'review cited for it, but Sonah could not read whether or how it ended');
  // A claim never rests on an unread end as on a check that did not complete: it stays open.
  const rests = restsOnCheck(session, [call('make unread').id, call('make absent').id], { sourceMap, anchor: ask });
  assert.deepEqual(rests.accepted, [call('make absent').id]);
});

test('D99 F1 guard: unread ends are declared apart and named under what Sonah could not check', async (t) => {
  const { session, call } = await loaded(t);
  const gaps = session.adapterGaps.filter((gap) => gap.code === 'command_outcome_unknown');
  const named = (gap) => gap.eventIds.map((id) => session.textSpansOf(session.event(id), 'command').join(' '));
  assert.deepEqual(gaps.map((gap) => [gap.note === END_UNREAD_NOTE, named(gap)]),
    [[false, ['make absent', 'make stopped']], [true, ['make unread']]]);
  assert.ok(COVERAGE_CAUSES.includes('ends_unread'));
  const causes = coverageCauses({ session });
  assert.deepEqual(causes.find(([cause]) => cause === 'ends_unread'), ['ends_unread', { n: 1 }]);
  assert.deepEqual(causes.find(([cause]) => cause === 'command_outcome_unknown'), ['command_outcome_unknown', { n: 2 }]);
  assert.equal(COVERAGE_SENTENCE.ends_unread({ n: 1 }),
    'later records mention 1 background run, but Sonah could not read whether or how it ended');
  assert.ok(call('make unread'));
});

test('D99 F1 guard: no unverified absence — every absence the evidence states is one a plain search confirms',
  async (t) => {
    // The invariant, checked against an oracle of its own: a result carries the absence form only when no notice is
    // linked to its run, and its task id is in no later line the agent did not write and in no line before the launch.
    const extra = [...launch('c1', 'bgc1', 'make later'), row({ type: 'attachment',
      attachment: { type: 'task_progress', content: 'bgc1 still running' } }),
    row({ type: 'attachment', attachment: { type: 'task_progress', content: 'bgc2 queued' } }),
    ...launch('c2', 'bgc2', 'make reused'),
    ...launch('c3', 'bgc3', 'make mine'), say('Waiting on bgc3.')];
    const rows = [...ROWS, ...extra];
    const { session, raw } = await loaded(t, rows);
    const lines = rows.map((r) => JSON.stringify(r));
    let absences = 0;
    for (const event of session.events.filter((e) => e.kind === 'observation')) {
      const outcome = resultOutcome(session, event);
      if (outcome.class !== 'no-terminal-status' || outcome.form !== 'background') continue;
      absences++;
      const ev = raw.ledger.find((a) => a.recorded?.backgroundTaskId
        && session.textSpansOf(session.event(event.invocation), 'command').join(' ') === a.cmd);
      const id = ev.recorded.backgroundTaskId;
      const at = lines.findIndex((line) => line.includes(`"backgroundTaskId":"${id}"`));
      assert.equal(ev.notified ?? 0, 0, id);
      assert.equal(lines.slice(0, at).some((line) => line.includes(id)), false, `${id} before its launch`);
      assert.equal(lines.slice(at + 1).some((line) => line.includes(id) && !line.includes('"type":"assistant"')), false,
        `${id} after its launch`);
    }
    assert.equal(absences, 2, 'make absent and make mine');
  });

test('D99 F1 guard: a Workflow run with no receipt says no receipt was recorded only when that is proved', async (t) => {
  const ledgerOf = async (options) => {
    const dir = await scratch('sonah-d99-workflow-');
    t.after(() => rm(dir, { recursive: true, force: true }));
    const previous = process.env.SONAH_HOME;
    process.env.SONAH_HOME = join(dir, 'home');
    t.after(() => { if (previous === undefined) delete process.env.SONAH_HOME; else process.env.SONAH_HOME = previous; });
    const transcriptDir = join(dir, 'projects', SLUG, WORKFLOW_SID, 'subagents', 'workflows', RUN);
    const tree = await writeTree(dir, { parent: verifierBeforeFixRows({ transcriptDir, ...options }), run: linkedRun() });
    await mkdir(join(dir, 'codex'), { recursive: true });
    return redact(await loadSessionEvidence([tree.parent], { outcomes: new Map(), reviewLinkedChildren: true,
      recordingRoots: { claude: tree.projects, codex: join(dir, 'codex') } })).ledger;
  };
  const notes = (ledger) => sessionFromLedger(ledger, { sessionKey: 'd99-w' }).adapterGaps
    .filter((gap) => [WORKFLOW_GAP_NOTES.unreceived, WORKFLOW_GAP_NOTES.endUnread].includes(gap.note))
    .map((gap) => gap.note);
  // No notification at all, and the run's task id in no later row: proved.
  assert.deepEqual(notes(await ledgerOf({ notification: false })), [WORKFLOW_GAP_NOTES.unreceived]);
  // A notification is linked to the run, in a status no reader of this release types: not proved.
  const unread = await ledgerOf({ status: 'archived' });
  assert.equal(unread.ledger.find((act) => act.tool === 'Workflow').backgroundEnd, BACKGROUND_ENDS.unread);
  assert.deepEqual(notes(unread), [WORKFLOW_GAP_NOTES.endUnread]);
  // A run its notification typed stopped recorded its end, and no completion: the note stays true of it.
  assert.deepEqual(notes(await ledgerOf({ status: 'stopped' })), [WORKFLOW_GAP_NOTES.unreceived]);
});

test('D99 (the owner\'s answer 8, 2026-10-17): a Workflow run Sonah could not link to a completed result says Sonah could '
  + 'not read how it ended, where its end is unread', async (t) => {
  // A Workflow launched asynchronously (its typed task id), with no completion Sonah could link to it. Its run directory
  // is not there, so its agents are not linked either (a loss on the children channel, which this does not move).
  const workflow = (taskId, call) => [use(call, 'Workflow', { script: 'x', run_in_background: true }),
    answer(call, `Workflow launched. Task ID: ${taskId}`, { status: 'async_launched', taskId, runId: `run-${taskId}`,
      transcriptDir: `/tmp/missing-${taskId}`, workflowName: 'w' })];
  const progress = (text) => row({ type: 'attachment', attachment: { type: 'task_progress', content: text } });
  const cases = {
    // No later record mentions the run: proved, so the launched note stands.
    absent: [ask('Run the workflow.'), ...workflow('wfa1', 'w1'), say('It ran.')],
    // A later record the recorder wrote mentions the run (unread).
    mentioned: [ask('Run the workflow.'), ...workflow('wfm1', 'w1'), progress('wfm1 still running'), say('It ran.')],
    // A notice is linked to the run, in a status no reader of this release types (unread).
    linked: [ask('Run the workflow.'), ...workflow('wfl1', 'w1'), notice('wfl1', 'w1', 'archived'), say('It ran.')],
    // The run's id is in a record before its launch: Sonah could not check for an end (unchecked).
    early: [ask('Run the workflow; last time it was wfe1.'), ...workflow('wfe1', 'w1'), say('It ran.')],
  };
  const launchNotes = [WORKFLOW_GAP_NOTES.launched, WORKFLOW_GAP_NOTES.launchedEndUnread,
    WORKFLOW_GAP_NOTES.launchedEndUnchecked];
  const expected = { absent: [WORKFLOW_GAP_NOTES.launched, undefined, 'observations_incomplete'],
    mentioned: [WORKFLOW_GAP_NOTES.launchedEndUnread, BACKGROUND_ENDS.unread, 'ends_unread'],
    linked: [WORKFLOW_GAP_NOTES.launchedEndUnread, BACKGROUND_ENDS.unread, 'ends_unread'],
    early: [WORKFLOW_GAP_NOTES.launchedEndUnchecked, BACKGROUND_ENDS.unchecked, 'ends_unchecked'] };
  for (const [name, rows] of Object.entries(cases)) {
    const { session, raw } = await loaded(t, rows);
    const flow = raw.ledger.find((act) => act.tool === 'Workflow');
    assert.equal(flow.workflowAsyncUnresolved, true, `premise: ${name}, launched asynchronously`);
    assert.equal(flow.backgroundEnd, expected[name][1], name);
    const call = session.events.find((e) => e.kind === 'invocation' && e.tool === 'Workflow');
    // One declaration of the launch on the observations channel, by its end's mark; never the launched note beside it.
    const declared = session.adapterGaps.filter((gap) => gap.channel === 'observations' && launchNotes.includes(gap.note));
    assert.deepEqual(declared.map((gap) => [gap.code, gap.note, gap.count, gap.eventIds]),
      [['incomplete_inventory', expected[name][0], 1, [call.id]]], name);
    // Named under what Sonah could not check by its reason's cause, in the words approved for that reason.
    const causes = coverageCauses({ session });
    const cause = expected[name][2];
    assert.ok(causes.some(([c, counts]) => c === cause && counts.n >= 1), `${name}: ${cause}`);
    if (name !== 'absent') assert.equal(causes.some(([c]) => c === 'observations_incomplete'), false, name);
    // The children channel's loss of its agents is the same in every case: this changes no other declaration.
    assert.deepEqual(session.adapterGaps.filter((gap) => gap.channel === 'children').map((gap) => gap.note),
      [WORKFLOW_GAP_NOTES.agents], name);
    // The page's What Sonah could not check says it in those words.
    const page = reportModel(session, { session, gaps: [], windowResults: [{ windowIndex: 0,
      eventIds: session.events.map((e) => e.id), failure: null }] }, {});
    const said = page.notChecked.facts.map((f) => f.parts.map((part) => part.text).join(''));
    const words = { absent: /^Sonah could not read the result of 1 action/,
      mentioned: /^Later records mention 1 background run, but Sonah could not read whether or how it ended\.$/,
      linked: /^Later records mention 1 background run, but Sonah could not read whether or how it ended\.$/,
      early: /^Sonah could not check whether the recording holds an end of 1 background run\.$/ };
    assert.ok(said.some((text) => words[name].test(text)), `${name}: ${JSON.stringify(said)}`);
  }
  assert.equal(COVERAGE_SENTENCE.ends_unread({ n: 1 }),
    'later records mention 1 background run, but Sonah could not read whether or how it ended');
  assert.equal(COVERAGE_SENTENCE.ends_unchecked({ n: 1 }),
    'Sonah could not check whether the recording holds an end of 1 background run');
  // The notes themselves carry the approved words of each reason.
  assert.match(WORKFLOW_GAP_NOTES.launchedEndUnread, /^later records mention .*, but Sonah could not read whether or how it ended$/);
  assert.match(WORKFLOW_GAP_NOTES.launchedEndUnchecked, /^Sonah could not check whether the recording holds an end of /);
});

test('D99 F1 guard: an Agent run with no receipt says no receipt was recorded only when that is proved', async (t) => {
  const ledgerOf = async (options) => {
    const tree = await claudeTree(claudeParentRows({ background: true, ...options }));
    t.after(() => rm(tree.dir, { recursive: true, force: true }));
    await mkdir(join(tree.dir, 'codex'), { recursive: true });
    return redact(await loadSessionEvidence([tree.parent], { outcomes: new Map(), reviewLinkedChildren: true,
      recordingRoots: { claude: tree.projects, codex: join(tree.dir, 'codex') } })).ledger;
  };
  const notes = (ledger) => sessionFromLedger(ledger, { sessionKey: 'd99-a' }).adapterGaps
    .filter((gap) => [HELPER_PLACEMENT_NOTES.unreceived, HELPER_DELIVERY_GAP_NOTES.helper_end_unread].includes(gap.note))
    .map((gap) => gap.note);
  assert.equal(HELPER_DELIVERY_REASONS.endUnread, 'helper_end_unread');
  assert.ok(Object.hasOwn(HELPER_DELIVERY_GAP_NOTES, HELPER_DELIVERY_REASONS.endUnread));
  assert.deepEqual(notes(await ledgerOf({ notification: false })), [HELPER_PLACEMENT_NOTES.unreceived]);
  const unread = await ledgerOf({ status: 'archived' });
  assert.deepEqual(unread.helperDeliveryLosses.map((loss) => loss.reason), [HELPER_DELIVERY_REASONS.endUnread]);
  assert.deepEqual(notes(unread), [HELPER_DELIVERY_GAP_NOTES.helper_end_unread]);
  assert.deepEqual(notes(await ledgerOf({ status: 'killed' })), [HELPER_PLACEMENT_NOTES.unreceived]);
  // A notification linked to the hand-off by its call id, naming another task id: it joins nothing, and no later row
  // names the agent's own id, yet a record of the run's end may be there: not proved.
  assert.deepEqual(notes(await ledgerOf({ task: 'a9999999999999999' })), [HELPER_DELIVERY_GAP_NOTES.helper_end_unread]);
});

test('D99 (review of A1b): where no later mention of a run is established, every reader says Sonah could not check '
  + 'whether the recording holds an end of it', async (t) => {
  // A Bash run whose task id is in a row before its launch (`end_unread_before`): no search for it can prove an absence,
  // and none shows a later mention, so the slicer marks it `unchecked`, not `unread`.
  const rows = [ask('Run the job in the background; its id was bgk9 last time.'), ...launch('k9', 'bgk9', 'make early'),
    say('The job ran.')];
  const { session, call, result } = await loaded(t, rows);
  assert.equal(call('make early').backgroundEnd, LEDGER_BACKGROUND_ENDS.unchecked);
  const outcome = resultOutcome(session, result('make early'));
  assert.deepEqual([outcome.class, outcome.form], ['end-unread', END_UNCHECKED_FORM]);
  assert.equal(CHECKLIST_OUTCOME_WORDS[outcome.class](null, outcome.form),
    'Sonah could not check whether the recording holds an end of this run.');
  // A model request carries the words of the run's other form, which state neither an end nor a mention: no byte moves.
  assert.equal(outcome.words, 'run in the background; Sonah could not read whether or how it ended');
  // An ask resting on it is not checked, under a reason of its own whose words claim no later mention.
  const sourceMap = planWindowRequests({ session, reviewScope: 'session-only' }).requests[0].sourceMap;
  const instruction = session.events.find((e) => e.kind === 'instruction');
  const checked = checkedRequirement(session, { text: 't', instruction: { eventId: instruction.id, role: 'instruction',
    quote: 'Run the job in the background' }, status: 'done', deliverable: { eventId: result('make early').id,
    role: 'observation', quote: 'Command running in background with ID: bgk9' } }, { sourceMap });
  assert.deepEqual([checked.candidate.status, checked.reason], ['not-checked', 'check_end_unchecked']);
  assert.equal(CHECKLIST_REQUIREMENT_REASON_WORDS.check_end_unchecked, 'Sonah could not check whether the recording '
    + 'holds an end of the run that the session review cited for it');
  // Declared apart under its own note, and named under its own cause.
  const gaps = session.adapterGaps.filter((gap) => gap.code === 'command_outcome_unknown');
  assert.deepEqual(gaps.map((gap) => [gap.note, gap.count]), [[END_UNCHECKED_NOTE, 1]]);
  const causes = coverageCauses({ session });
  assert.deepEqual(causes.filter(([cause]) => cause.startsWith('ends_')), [['ends_unchecked', { n: 1 }]]);
  assert.ok(COVERAGE_CAUSES.indexOf('ends_unchecked') === COVERAGE_CAUSES.indexOf('ends_unread') + 1);
  assert.equal(COVERAGE_SENTENCE.ends_unchecked({ n: 1 }),
    'Sonah could not check whether the recording holds an end of 1 background run');

  // A Workflow run whose task id is in your message before its launch.
  const workflowLedger = async () => {
    const dir = await scratch('sonah-d99-workflow-unchecked-');
    t.after(() => rm(dir, { recursive: true, force: true }));
    const previous = process.env.SONAH_HOME;
    process.env.SONAH_HOME = join(dir, 'home');
    t.after(() => { if (previous === undefined) delete process.env.SONAH_HOME; else process.env.SONAH_HOME = previous; });
    const transcriptDir = join(dir, 'projects', SLUG, WORKFLOW_SID, 'subagents', 'workflows', RUN);
    const parent = verifierBeforeFixRows({ transcriptDir, notification: false });
    parent[0] = askRow(`${W2_TEXT.ask} (${TASK})`);
    const tree = await writeTree(dir, { parent, run: linkedRun() });
    await mkdir(join(dir, 'codex'), { recursive: true });
    return redact(await loadSessionEvidence([tree.parent], { outcomes: new Map(), reviewLinkedChildren: true,
      recordingRoots: { claude: tree.projects, codex: join(dir, 'codex') } })).ledger;
  };
  const flow = await workflowLedger();
  assert.equal(flow.ledger.find((act) => act.tool === 'Workflow').backgroundEnd, BACKGROUND_ENDS.unchecked);
  assert.deepEqual(sessionFromLedger(flow, { sessionKey: 'd99-wu' }).adapterGaps.map((gap) => gap.note)
    .filter((note) => [WORKFLOW_GAP_NOTES.unreceived, WORKFLOW_GAP_NOTES.endUnread, WORKFLOW_GAP_NOTES.endUnchecked]
      .includes(note)), [WORKFLOW_GAP_NOTES.endUnchecked]);

  // A background Agent whose agentId is in your message before its launch.
  const agentRows = claudeParentRows({ background: true, notification: false });
  agentRows[0] = { ...agentRows[0], message: { ...agentRows[0].message,
    content: `${agentRows[0].message.content} (${AGENT})` } };
  const tree = await claudeTree(agentRows);
  t.after(() => rm(tree.dir, { recursive: true, force: true }));
  await mkdir(join(tree.dir, 'codex'), { recursive: true });
  const helper = redact(await loadSessionEvidence([tree.parent], { outcomes: new Map(), reviewLinkedChildren: true,
    recordingRoots: { claude: tree.projects, codex: join(tree.dir, 'codex') } })).ledger;
  assert.equal(HELPER_DELIVERY_REASONS.endUnchecked, 'helper_end_unchecked');
  assert.deepEqual(helper.helperDeliveryLosses.map((loss) => loss.reason), [HELPER_DELIVERY_REASONS.endUnchecked]);
  const helperNotes = sessionFromLedger(helper, { sessionKey: 'd99-au' }).adapterGaps.map((gap) => gap.note)
    .filter((note) => [HELPER_PLACEMENT_NOTES.unreceived, ...Object.values(HELPER_DELIVERY_GAP_NOTES)].includes(note));
  assert.deepEqual(helperNotes, [HELPER_DELIVERY_GAP_NOTES.helper_end_unchecked]);
});
