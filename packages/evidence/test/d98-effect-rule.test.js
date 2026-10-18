// D98 (F9): one effect rule, which every reader uses. The recorder can type a call as refused before it ran; a write
// the slicer parsed from such a call (a heredoc's body, a redirect target) has no result of its own, so only a reader
// that walks to the parent call sees the refusal. `effectOf` (session.js) gives what the record proves about an
// action's effect, from a closed set — none, undone, landed, unknown — from typed fields only, and every reader that
// asks "could this have changed something" reads it. This file is the agreement test: one recording through the whole
// pipeline (slicer, redaction, adapter), and every reader's answer checked against `effectOf`, event by event — the
// adapter's gaps, the code step's change list and outside count, the changed-since list, the same-path check, file
// ownership, the story's rows and runs, the written-statement and value checks, and the slicer's earlier-state rule.
//
// Every row is synthetic and mirrors only the recorder's known key sets. No real recording is read; no model is called.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { sliceLineage } from '../../slicer/index.js';
import { parsedFromRefusedCall, STOPPED_DENIAL_KINDS } from '../../slicer/src/before.js';
import { redact, RECORDED_FACTS } from '../../redact/index.js';
import { sessionFromLedger } from '../adapters/sonah-ledger.js';
import { Session, effectOf, effectReader, ACTION_EFFECTS, CHANGING_EFFECTS, REFUSED_DENIALS } from '../src/session.js';
import { STOPPED_DENIALS, actionOutcome, samePathChangedBetween, writtenInSession, groundDecision, UNRUN_WRITE_REASON,
  UNRUN_WRITE_ENDS }
  from '../src/ledger.js';
import { codeSnapshotPlan } from '../src/code-pass.js';
import { commandsAfterLastEdit, renderCommands } from '../src/code-context.js';

/** The commands listed after a path's last edit (code-pass/12, D105: each command once, numbered; a file names the first
 *  of them after its last edit): every command from that one on; none when the file names none. */
const commandsAfter = (listed, path) => {
  const file = listed.files.find((f) => f.path === path);
  return !file || file.first === null ? [] : listed.commands.filter((c) => c.n >= file.first);
};
import { supportCheck } from '../src/claims.js';
import { readWrittenStatement } from '../src/written.js';
import { storyFacts } from '../../render/session-story.js';
import { reportModel } from '../../render/report-model.js';
import { load, claudeRows, codexRows, CODEX_NAME } from './m33-u-unasked-fixture.js';

const [NONE, UNDONE, LANDED, UNKNOWN] = ACTION_EFFECTS;
const SESSION = 'c0ffee00-0000-4000-8000-0000000000e9';
const row = (extra) => ({ sessionId: SESSION, cwd: '/repo', isSidechain: false, version: '2.1.296', ...extra });
const ask = (text) => row({ type: 'user', origin: { kind: 'human' }, message: { role: 'user', content: text } });
const say = (text) => row({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text }] } });
const use = (id, name, input) => row({ type: 'assistant', message: { role: 'assistant',
  content: [{ type: 'tool_use', id, name, input }] } });
const answer = (id, content, { isError, sidecar, denial } = {}) => row({ type: 'user', message: { role: 'user',
  content: [{ type: 'tool_result', tool_use_id: id, content, ...(isError === undefined ? {} : { is_error: isError }) }] },
  ...(sidecar === undefined ? {} : { toolUseResult: sidecar }), ...(denial === undefined ? {} : { toolDenialKind: denial }) });
const SUCCESS = Object.freeze({ stdout: '', stderr: '', interrupted: false, isImage: false, noOutputExpected: false });
const REFUSED = 'The user doesn\'t want to proceed with this tool use. The tool use was rejected.';
/** A Bash call writing `path` through a here-document, and its result. */
const heredoc = (id, path, body) => use(id, 'Bash', { command: `cat > ${path} <<'EOF'\n${body}EOF`,
  description: 'Write the notes' });
const refusedBy = (id, denial) => answer(id, REFUSED, { isError: true, sidecar: `Error: ${REFUSED}`, denial });

// The bodies: each holds one line only its own write holds; the refused heredoc's second line is also in the Write
// that landed.
const SHARED = 'SYNTHETIC_E9 the parser skips blank lines';
const BODY = Object.freeze({
  plan: `SYNTHETIC_E9 refused plan body\n${SHARED}\n`, scratch: 'SYNTHETIC_E9 scratch body\n',
  failed: 'SYNTHETIC_E9 failed body\n', ran: 'SYNTHETIC_E9 ran body\n', stopped: 'SYNTHETIC_E9 stopped body\n',
  direct: `SYNTHETIC_E9 direct body\n${SHARED}\n`, refusedWrite: 'SYNTHETIC_E9 refused write body\n',
  halted: 'SYNTHETIC_E9 halted body\n',
});
const READ_TEXT = 'SYNTHETIC_E9 old plan\n';
const TESTS_OUT = 'SYNTHETIC_E9 tests: 3 passed';
const SAID = 'SYNTHETIC_E9 All tests pass.';

/** One recording holding every effect, in one turn: a read, a passing test run, then writes of every kind, then the
 *  agent's statement. Hook exit codes type the commands' exits (`outcomes`). */
function recording() {
  const rows = [
    ask('Write the notes and run the tests.'),
    use('r1', 'Read', { file_path: '/repo/notes/plan.md' }),
    answer('r1', `     1\t${READ_TEXT}`, { sidecar: { type: 'text', file: { filePath: '/repo/notes/plan.md',
      content: READ_TEXT, numLines: 1, startLine: 1, totalLines: 1 } } }),
    use('t1', 'Bash', { command: 'npm test', description: 'Run the tests' }),
    answer('t1', TESTS_OUT, { isError: false, sidecar: { ...SUCCESS, stdout: TESTS_OUT } }),
    // Refused before they ran: by the human, a permission rule, the auto-mode classifier (one outside the repository).
    heredoc('c1', 'notes/plan.md', BODY.plan), refusedBy('c1', 'user-rejected'),
    use('c5', 'Bash', { command: 'printf x > out/refused.txt', description: 'Write a marker' }),
    refusedBy('c5', 'permission-rule'),
    heredoc('c6', '/tmp/scratch.md', BODY.scratch), refusedBy('c6', 'automode-blocked'),
    // A command that failed, one that succeeded with a typed zero exit, one that was stopped.
    heredoc('c2', 'notes/failed.md', BODY.failed), answer('c2', 'boom', { isError: true }),
    heredoc('c3', 'notes/ran.md', BODY.ran), answer('c3', '', { isError: false, sidecar: SUCCESS }),
    heredoc('c4', 'notes/stopped.md', BODY.stopped),
    answer('c4', '[Request interrupted by user for tool use]', { isError: true, denial: 'interrupted' }),
    // Direct writes: one that landed, an edit that failed, one refused, and a later edit of the refused heredoc's path.
    use('w1', 'Write', { file_path: '/repo/notes/direct.md', content: BODY.direct }),
    answer('w1', 'File created successfully at: /repo/notes/direct.md', { sidecar: { type: 'create',
      filePath: '/repo/notes/direct.md', content: BODY.direct, originalFile: null, structuredPatch: [],
      userModified: false } }),
    use('e1', 'Edit', { file_path: '/repo/notes/direct.md', old_string: 'absent', new_string: 'SYNTHETIC_E9 lost' }),
    answer('e1', 'String to replace not found in file.', { isError: true }),
    use('w3', 'Write', { file_path: '/repo/notes/refused.md', content: BODY.refusedWrite }), refusedBy('w3', 'user-rejected'),
    // A direct write the recorder typed as stopped (D80): its error result says nothing of what it left.
    use('w4', 'Write', { file_path: '/repo/notes/halted.md', content: BODY.halted }),
    answer('w4', '[Request interrupted by user for tool use]', { isError: true, denial: 'interrupted' }),
    use('e2', 'Edit', { file_path: '/repo/notes/plan.md', old_string: 'old plan', new_string: 'new plan' }),
    answer('e2', 'The file /repo/notes/plan.md has been updated successfully.'),
    use('d1', 'mcp__fs__delete_file', { path: '/repo/notes/plan.md' }), answer('d1', 'Deleted.'),
    say(SAID),
  ];
  const outcomes = new Map([['t1', { exitCode: 0 }], ['c2', { exitCode: 1 }], ['c3', { exitCode: 0 }]]);
  return { rows, outcomes };
}

/** A landed Write, the tests run after it (a typed zero exit), then a heredoc of the same file the human refused. */
function lastEditRecording() {
  const rows = [
    ask('Write the notes and run the tests.'),
    use('w1', 'Write', { file_path: '/repo/a.md', content: BODY.direct }),
    answer('w1', 'File created successfully at: /repo/a.md', { sidecar: { type: 'create', filePath: '/repo/a.md',
      content: BODY.direct, originalFile: null, structuredPatch: [], userModified: false } }),
    use('t1', 'Bash', { command: 'npm test', description: 'Run the tests' }),
    answer('t1', TESTS_OUT, { isError: false, sidecar: { ...SUCCESS, stdout: TESTS_OUT } }),
    heredoc('c1', 'a.md', BODY.plan), refusedBy('c1', 'user-rejected'),
    say(SAID),
  ];
  return { rows, outcomes: new Map([['t1', { exitCode: 0 }]]) };
}

/** Slice, redact and adapt `rows` as one recording. */
async function slice(t, { rows, outcomes = new Map() }) {
  const dir = await mkdtemp(join(tmpdir(), 'sonah-d98-effect-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const file = join(dir, `${SESSION}.jsonl`);
  await writeFile(file, rows.map((r) => JSON.stringify(r)).join('\n') + '\n');
  const raw = await sliceLineage([file], { cwd: '/repo', outcomes });
  const session = sessionFromLedger(redact(raw).ledger, { sessionKey: 'd98-effect' });
  return { raw, session };
}
const pipeline = (t) => slice(t, recording());

const invocations = (session) => session.events.filter((e) => e.kind === 'invocation');
const commandOf = (session, words) => invocations(session).find((e) => session.textOf(e, 'command').includes(words));
const writeOf = (session, path) => invocations(session).filter((e) => (e.changes ?? []).some((c) => c.path === path));
const pathsOf = (event) => [...(event.paths ?? []), ...(event.changes ?? [])].map((p) => p.path);
const gapIds = (session, code) => new Set(session.adapterGaps.filter((g) => g.code === code)
  .flatMap((g) => g.eventIds ?? []));

test('D98 F9: the effect of every action, as the record types it', async (t) => {
  const { session } = await pipeline(t);
  const effect = effectReader(session);
  const of = (event) => effect(event);
  const parsed = (cmd) => invocations(session).filter((e) => e.shellWriteOf === commandOf(session, cmd).id);
  // A refused call, and every write parsed from it, changed nothing: effect never grows along a parent link.
  for (const cmd of ['notes/plan.md <<', 'out/refused.txt', '/tmp/scratch.md']) {
    assert.equal(of(commandOf(session, cmd)), NONE, cmd);
    assert.ok(parsed(cmd).length > 0, cmd);
    for (const write of parsed(cmd)) assert.equal(of(write), NONE, cmd);
  }
  assert.equal(of(writeOf(session, 'notes/refused.md')[0]), NONE, 'a refused Write');
  // A Write the recorder typed as stopped, with an error result: whether it left anything is not recorded (D80).
  assert.equal(of(writeOf(session, 'notes/halted.md')[0]), UNKNOWN, 'a stopped Write');
  // A failed command's write and a stopped command's write: whether they happened is not recorded.
  for (const cmd of ['notes/failed.md', 'notes/stopped.md']) for (const write of parsed(cmd)) assert.equal(of(write), UNKNOWN);
  // A single direct-write command with a typed zero exit proves its write; the run itself succeeded.
  for (const write of parsed('notes/ran.md')) assert.equal(of(write), LANDED);
  assert.equal(of(commandOf(session, 'npm test')), LANDED);
  // Direct writes: the typed Write landed, the failed Edit left nothing, the parsed-success Edit is not proved.
  const [w1, e1] = writeOf(session, 'notes/direct.md');
  assert.deepEqual([of(w1), of(e1)], [LANDED, UNDONE]);
  assert.equal(of(writeOf(session, 'notes/plan.md').find((e) => e.tool === 'Edit')), UNKNOWN);
  // `effectOf` and the Session's own method read the same rule.
  for (const event of invocations(session)) assert.equal(session.effectOf(event), of(event), event.id);
  for (const event of invocations(session)) assert.equal(effectOf(session, event), of(event), event.id);
});

test('D98 F9: none agrees with the ledger\'s did-not-run, and a stopped call is unknown, for every action', async (t) => {
  const { session } = await pipeline(t);
  const effect = effectReader(session);
  let none = 0, stopped = 0;
  for (const event of invocations(session)) {
    const end = actionOutcome(session, event);
    const didNotRun = end.class === 'did-not-run';
    assert.equal(effect(event) === NONE, didNotRun, event.id);
    none += didNotRun ? 1 : 0;
    // D80: a call typed as stopped, or a write parsed from one, has no terminal status in the ledger, whatever its
    // result says, and its effect is unknown: never undone, never landed.
    const call = event.shellWriteOf ? session.event(event.shellWriteOf) : event;
    if (!STOPPED_DENIALS.includes(call?.recorded?.denial)) continue;
    assert.equal(end.class, 'no-terminal-status', event.id);
    assert.equal(effect(event), UNKNOWN, event.id);
    stopped += 1;
  }
  // c1, c5, c6 and their three parsed writes, and the refused Write.
  assert.equal(none, 7);
  // c4 and its parsed write, and the stopped Write.
  assert.equal(stopped, 3);
});

test('D98 F9: the adapter\'s gaps name only actions whose effect is unknown, and every such write', async (t) => {
  const { session } = await pipeline(t);
  const effect = effectReader(session);
  const writes = invocations(session).filter((e) => ['write', 'edit', 'delete'].includes(e.operation));
  const unknown = gapIds(session, 'write_outcome_unknown');
  for (const write of writes) assert.equal(unknown.has(write.id), effect(write) === UNKNOWN, write.id);
  // The stopped Write is one: whether it landed is not recorded.
  assert.ok(unknown.has(writeOf(session, 'notes/halted.md')[0].id));
  for (const id of gapIds(session, 'command_outcome_unknown')) assert.notEqual(effect(session.event(id)), NONE, id);
  // An unrecorded body is a write that could have changed its file and whose body the record lacks: never one refused
  // before it ran, failed or cancelled (it did no work), and every such write is named.
  const unrecorded = gapIds(session, 'unrecorded_body');
  for (const write of writes) {
    const lacks = write.operation !== 'delete' && (write.changes ?? []).some((c) => c.extent?.recorded === false);
    assert.equal(unrecorded.has(write.id), lacks && CHANGING_EFFECTS.includes(effect(write)), write.id);
  }
  // The refused redirect's write was one: its body is not recorded, and it is no gap now.
  const [marker] = writeOf(session, 'out/refused.txt');
  assert.ok(marker.changes.some((c) => c.extent?.recorded === false));
  assert.equal(unrecorded.has(marker.id), false);
});

test('D98 F9: the code step\'s change list and outside count hold only changes that could have happened', async (t) => {
  const { session } = await pipeline(t);
  const effect = effectReader(session);
  const plan = codeSnapshotPlan(session);
  const changing = new Set(), outside = new Set();
  for (const event of invocations(session)) {
    if (!['write', 'edit', 'delete'].includes(event.operation) || !CHANGING_EFFECTS.includes(effect(event))) continue;
    for (const change of event.changes ?? []) {
      changing.add(change.path);
      if (change.outsideRepository === true) outside.add(change.path);
    }
  }
  assert.deepEqual(new Set(plan.map((entry) => entry.path)), changing);
  assert.deepEqual(new Set(plan.filter((entry) => entry.outside).map((entry) => entry.path)), outside);
  for (const path of ['out/refused.txt', '/tmp/scratch.md', 'notes/refused.md'])
    assert.equal(plan.some((entry) => entry.path === path), false, path);
  // The failed edit's path is in the change for the Write that landed, never for the edit itself.
  assert.ok(plan.some((entry) => entry.path === 'notes/direct.md'));
  // A stopped Write may have changed its file: its path stays part of the change (a true caveat is never lost).
  assert.ok(plan.some((entry) => entry.path === 'notes/halted.md'));
  // One count, one source: the story's files changed outside the repository (with the writes it lists apart, D80) are
  // the code step's outside paths.
  const facts = storyFacts(session, { windowResults: [{ windowIndex: 0, eventIds: session.events.map((e) => e.id),
    failure: null }], sessionStatus: 'NO_FINDINGS' });
  const storyOutside = new Set([...facts.whole.outsidePaths,
    ...facts.whole.unconfirmed.filter((row) => row.outside).map((row) => row.path)]);
  assert.deepEqual(storyOutside, outside);
});

test('D98 F9: the story\'s rows and runs read the same rule; every refused call is still listed once', async (t) => {
  const { session } = await pipeline(t);
  const effect = effectReader(session);
  const facts = storyFacts(session, { windowResults: [{ windowIndex: 0, eventIds: session.events.map((e) => e.id),
    failure: null }], sessionStatus: 'NO_FINDINGS' });
  const rowed = new Set([...facts.whole.changes, ...facts.whole.unconfirmed].map((row) => row.event.id));
  for (const event of invocations(session)) {
    if (!['write', 'edit', 'delete'].includes(event.operation)) continue;
    assert.equal(rowed.has(event.id), CHANGING_EFFECTS.includes(effect(event)), event.id);
  }
  // Removing an effect never removes the attempt: each refused command is listed once, as did not run.
  for (const cmd of ['notes/plan.md <<', 'out/refused.txt', '/tmp/scratch.md']) {
    const runs = facts.whole.commands.filter((c) => c.event.id === commandOf(session, cmd).id);
    assert.equal(runs.length, 1, cmd);
    assert.deepEqual([runs[0].didNotRun, runs[0].failed], [true, false], cmd);
  }
  for (const run of facts.whole.commands) assert.equal(run.didNotRun, effect(run.event) === NONE, run.event.id);
});

test('D98 F9: the code step\'s commands after a file\'s last edit read its last change that could have happened', async (t) => {
  // A refused heredoc of a file after the tests ran is no edit of it: the tests ran after its last edit. The dossier,
  // the change list and the page's Runs list read the one rule, so none says the file's final state never ran.
  const { session } = await slice(t, lastEditRecording());
  const effect = effectReader(session);
  const [heredocWrite] = invocations(session).filter((e) => e.shellWriteOf);
  assert.equal(effect(heredocWrite), NONE);
  assert.deepEqual(codeSnapshotPlan(session).map((entry) => entry.path), ['a.md']);
  const commands = commandsAfterLastEdit(session, ['a.md']);
  // The owner's answers of 2026-10-17 (code-pass/11): the refused heredoc ran nothing, so the dossier no longer lists it.
  assert.deepEqual(commandsAfter(commands, 'a.md').map((run) => run.text.split('\n')[0]), ['npm test']);
  assert.deepEqual(commandsAfter(commands, 'a.md')[0].exit, 0);
  assert.doesNotMatch(renderCommands(commands), /never_ran/);
  const model = reportModel(session, { windowResults: [{ windowIndex: 0, eventIds: session.events.map((e) => e.id),
    failure: null }] }, {});
  assert.deepEqual(model.did.runs.neverRan, []);
});

test('D98 (the owner\'s answer 1, 2026-10-17): the dossier lists no command refused before it ran, so a file that only '
  + 'such commands follow is never_ran, as the page\'s Runs list says it', async (t) => {
  // A Write that landed, then only commands the recorder typed as refused before they ran: the human's, a permission
  // rule's and the auto-mode classifier's. None ran, so the file's final state never ran; each attempt stays visible.
  const rows = [
    ask('Write the notes and run the tests.'),
    use('w1', 'Write', { file_path: '/repo/a.md', content: BODY.direct }),
    answer('w1', 'File created successfully at: /repo/a.md', { sidecar: { type: 'create', filePath: '/repo/a.md',
      content: BODY.direct, originalFile: null, structuredPatch: [], userModified: false } }),
    use('t1', 'Bash', { command: 'npm test', description: 'Run the tests' }), refusedBy('t1', 'user-rejected'),
    use('t2', 'Bash', { command: 'npm run lint', description: 'Lint' }), refusedBy('t2', 'permission-rule'),
    use('t3', 'Bash', { command: 'npm run build', description: 'Build' }), refusedBy('t3', 'automode-blocked'),
    say(SAID),
  ];
  const { session } = await slice(t, { rows });
  const effect = effectReader(session);
  const refused = ['npm test', 'npm run lint', 'npm run build'].map((cmd) => commandOf(session, cmd));
  assert.deepEqual(refused.map((event) => effect(event)), [NONE, NONE, NONE], 'premise: each typed refused before it ran');
  assert.deepEqual(codeSnapshotPlan(session).map((entry) => entry.path), ['a.md']);
  const commands = commandsAfterLastEdit(session, ['a.md']);
  assert.deepEqual(commandsAfter(commands, 'a.md'), [], 'no command that may have run follows the last edit');
  const text = renderCommands(commands);
  assert.match(text, /^\{"path":"a\.md","commandsAfterLastEdit":"none","move":"never_ran"\}$/m);
  for (const cmd of ['npm test', 'npm run lint', 'npm run build']) assert.equal(text.includes(cmd), false, cmd);
  // The page's Runs list says the same of the file, and still lists each refused command, as did not run.
  const model = reportModel(session, { windowResults: [{ windowIndex: 0, eventIds: session.events.map((e) => e.id),
    failure: null }] }, {});
  assert.deepEqual(model.did.runs.neverRan, ['a.md']);
  assert.equal(model.did.runs.commands, 3);
  const facts = storyFacts(session, { windowResults: [{ windowIndex: 0, eventIds: session.events.map((e) => e.id),
    failure: null }], sessionStatus: 'NO_FINDINGS' });
  assert.deepEqual(facts.whole.commands.map((run) => [run.event.id, run.didNotRun]),
    refused.map((event) => [event.id, true]));
  // A command that may have run after the refused ones (one that failed with the recorder marking no refusal) is
  // listed, and the file is no longer never_ran, in the dossier and on the page alike.
  const failed = [...rows.slice(0, -1), use('t4', 'Bash', { command: 'npm run check', description: 'Check' }),
    answer('t4', 'boom', { isError: true }), say(SAID)];
  const after = await slice(t, { rows: failed });
  const listed = commandsAfterLastEdit(after.session, ['a.md']);
  assert.deepEqual(commandsAfter(listed, 'a.md').map((run) => run.text), ['npm run check']);
  assert.doesNotMatch(renderCommands(listed), /never_ran/);
  assert.deepEqual(reportModel(after.session, { windowResults: [{ windowIndex: 0,
    eventIds: after.session.events.map((e) => e.id), failure: null }] }, {}).did.runs.neverRan, []);
});

test('D98 F9: changed-since, the same-path check and file ownership skip what changed nothing', async (t) => {
  const { session } = await pipeline(t);
  const effect = effectReader(session);
  // The test run's result supports the statement made after it, in its turn; what changed in the repository between
  // the two is listed, and only what could have changed.
  const run = commandOf(session, 'npm test');
  const result = session.events.find((e) => e.kind === 'observation' && e.invocation === run.id);
  const stated = session.events.find((e) => e.kind === 'commentary' && session.textOf(e).includes(SAID));
  const sourceMap = { [result.id]: [{ role: 'observation', text: session.textOf(result, 'output') }] };
  const check = supportCheck(session, { stated: { eventId: stated.id, role: 'commentary', quote: SAID },
    supportedBy: { eventId: result.id, role: 'observation', quote: TESTS_OUT } }, sourceMap, { checklist: true });
  assert.equal(check.ok, true);
  const listed = new Set(check.changedSince.map((c) => c.eventId));
  for (const event of invocations(session)) {
    const inside = (event.changes ?? []).some((c) => c.outsideRepository !== true);
    if (!inside || !(event.sequence > run.sequence && event.sequence < stated.sequence)) continue;
    assert.equal(listed.has(event.id), CHANGING_EFFECTS.includes(effect(event)), event.id);
  }
  // The same-path check: the refused Write of notes/refused.md, and the redirect of a refused command, changed nothing
  // after the run.
  assert.equal(samePathChangedBetween(session, run, ['notes/refused.md'], stated.sequence), false);
  assert.equal(samePathChangedBetween(session, run, ['out/refused.txt'], stated.sequence), false);
  assert.equal(samePathChangedBetween(session, run, ['notes/direct.md'], stated.sequence), true);
  // Ownership of a project file: a refused write of it, or a failed edit alone, never makes it the agent's.
  const entry = (path) => ({ id: `P-${path}`, kind: 'project-instructions', path, childId: null });
  assert.equal(writtenInSession(session, entry('notes/refused.md')), false);
  assert.equal(writtenInSession(session, entry('out/refused.txt')), false);
  assert.equal(writtenInSession(session, entry('notes/ran.md')), true);
});

test('D98 F9: a statement or a value quoted from a write that changed nothing is withheld by the rule', async (t) => {
  const { session } = await pipeline(t);
  const shown = Object.fromEntries(session.events.map((e) => [e.id, session.sourcesFor(e)]));
  const code = (event, quote) => ({ eventId: event.id, role: 'code', quote });
  const read = (stated) => readWrittenStatement({ text: 'SYNTHETIC_E9 the notes say so', stated, contradictedBy: null },
    { session, sourceMap: shown });
  const [refusedHeredoc] = writeOf(session, 'notes/plan.md');
  const [landed] = writeOf(session, 'notes/direct.md');
  // A line only the refused heredoc holds: D80's reason names the command that did not run, as before.
  assert.deepEqual(read(code(refusedHeredoc, 'SYNTHETIC_E9 refused plan body')), { withheld: UNRUN_WRITE_REASON });
  // A line a write that landed also holds: the quote is attested, but the refused heredoc still never wrote it.
  assert.deepEqual(read(code(refusedHeredoc, SHARED)), { withheld: 'written_not_landed' });
  // The failed edit never wrote its text either; the Write that landed did.
  assert.equal(read(code(landed, SHARED)).statement.stated.eventId, landed.id);
  // A value adopted by a write refused before it ran is never adopted: unsuccessful, never an unknown outcome.
  const value = (event, quote, v) => groundDecision({ repo: { host: 'github.com', id: '0' }, session, pr: null,
    instructionHistoryComplete: true, candidate: { actorSession: 'd98-effect', dimension: 'SYNTHETIC_E9_VALUE',
      chosen: 'SYNTHETIC_E9 parser', actions: [event.id], value: v, stated: null, constrainedBy: null,
      valueReceipt: { eventId: event.id, role: 'code', field: 'added-code', quote } } }).decision;
  assert.deepEqual(value(refusedHeredoc, SHARED, 'blank lines').valueUnchecked,
    { cause: 'write_unsuccessful', action: refusedHeredoc.id });
  assert.equal(value(landed, SHARED, 'blank lines').valueState, 'grounded');
});

test('D98 F9: the slicer\'s earlier-state rule agrees with the effect rule, and never takes a refused body', async (t) => {
  const { raw, session } = await pipeline(t);
  const effect = effectReader(session);
  // The ledger's actions and the adapter's invocations are one list, in one order.
  const actions = invocations(session);
  assert.equal(raw.ledger.length, actions.length);
  raw.ledger.forEach((ev, i) => {
    if (ev.path) assert.ok(pathsOf(actions[i]).includes(ev.path), `${i} ${ev.path}`);
    if (ev.via) assert.equal(parsedFromRefusedCall(raw.ledger, i), effect(actions[i]) === NONE, `${i} ${ev.path}`);
    else assert.equal(parsedFromRefusedCall(raw.ledger, i), false, `${i}`);
  });
  // No earlier state of type write comes from a write whose effect is none.
  const at = new Map(raw.ledger.map((ev, i) => [`${ev.turn}:${ev.seq}`, i]));
  for (const ev of raw.ledger) {
    if (ev.before?.source !== 'write') continue;
    const from = at.get(`${ev.before.turn}:${ev.before.seq}`);
    assert.notEqual(effect(actions[from]), NONE, `${ev.path}`);
  }
  // The delete of notes/plan.md removed the file the agent read, never the body its refused heredoc would have written;
  // the later edit, the first write of the path that could have happened, carries that read as its earlier state.
  const deleted = raw.ledger.find((ev) => ev.kind === 'delete');
  assert.deepEqual([deleted.before.source, deleted.before.text.trim()], ['read', READ_TEXT.trim()]);
  const edit = raw.ledger.find((ev) => ev.path === 'notes/plan.md' && !ev.via && ev.kind === 'edit');
  assert.equal(edit.before?.source, 'read');
  assert.equal(raw.ledger.find((ev) => ev.path === 'notes/plan.md' && ev.via).before, undefined);
});

// ---- every reader, on every fixture session -------------------------------------------------------------------------

const FILE_OPS = Object.freeze(['write', 'edit', 'delete']);
const GOLDEN = fileURLToPath(new URL('../../../corpus/golden/', import.meta.url));
const windowed = (session) => ({ windowResults: [{ windowIndex: 0, eventIds: session.events.map((e) => e.id),
  failure: null }] });

/**
 * Every reader of an action's effect, on one session (and the ledger the slicer made it from, `raw`), checked against
 * `effectOf` event by event: the ledger's typed end, the adapter's gaps, the code step's change list, outside count and
 * commands after each file's last edit, the story's rows, outside paths and runs, the page's Runs list, the same-path
 * check, file ownership, and the slicer's earlier-state rule. Nothing here is specific to one recording.
 */
function readersAgree({ raw, session }, label) {
  const effect = effectReader(session);
  const actions = invocations(session);
  const changing = (event) => CHANGING_EFFECTS.includes(effect(event));
  const callOf = (event) => (event.shellWriteOf ? session.event(event.shellWriteOf) : event);
  const writes = actions.filter((e) => FILE_OPS.includes(e.operation));
  const names = (event, path) => (event.changes ?? []).some((c) => c.path === path);
  // The rule itself, the Session's method, and the ledger's typed end (actionOutcome).
  for (const event of actions) {
    const of = effect(event), end = actionOutcome(session, event), at = `${label} ${event.id}`;
    assert.ok(ACTION_EFFECTS.includes(of), at);
    assert.equal(session.effectOf(event), of, at);
    assert.equal(effectOf(session, event), of, at);
    assert.equal(of === NONE, end.class === 'did-not-run', `${at}: none is did-not-run`);
    if (STOPPED_DENIALS.includes(callOf(event)?.recorded?.denial)) {
      assert.equal(of, UNKNOWN, `${at}: a stopped call is unknown`);
      assert.equal(end.class, 'no-terminal-status', at);
    }
    if (of === UNDONE) assert.ok(UNRUN_WRITE_ENDS.includes(end.class) || end.form === 'cancelled', at);
    if (of === NONE && event.shellWriteOf) assert.equal(effect(callOf(event)), NONE, `${at}: never grows along a link`);
  }
  // The adapter's gaps.
  const unknown = gapIds(session, 'write_outcome_unknown');
  for (const write of writes) assert.equal(unknown.has(write.id), effect(write) === UNKNOWN, `${label} ${write.id}`);
  for (const id of gapIds(session, 'command_outcome_unknown'))
    assert.notEqual(effect(session.event(id)), NONE, `${label} ${id}: no refused command is an unknown one`);
  const unrecorded = gapIds(session, 'unrecorded_body');
  for (const write of writes) {
    const lacks = write.operation !== 'delete' && (write.changes ?? []).some((c) => c.extent?.recorded === false);
    assert.equal(unrecorded.has(write.id), lacks && changing(write), `${label} ${write.id}`);
  }
  // The code step's change list and outside count.
  const plan = codeSnapshotPlan(session);
  const changed = new Set(), outside = new Set();
  for (const write of writes.filter(changing)) for (const change of write.changes ?? []) {
    if (typeof change.path !== 'string' || !change.path) continue;
    changed.add(change.path);
    if (change.outsideRepository === true) outside.add(change.path);
  }
  assert.deepEqual(new Set(plan.map((entry) => entry.path)), changed, label);
  assert.deepEqual(new Set(plan.filter((entry) => entry.outside).map((entry) => entry.path)), outside, label);
  // The code step's commands after each changed file's last edit: its last change that could have happened.
  const at = new Map(session.events.map((event, i) => [event.id, i]));
  const lastOf = (path) => writes.filter((w) => changing(w) && names(w, path)).reduce((last, w) => Math.max(last,
    at.get(w.id)), -1);
  const listed = commandsAfterLastEdit(session, [...changed]);
  assert.deepEqual(new Set(listed.files.map((f) => f.path)), changed, label);
  for (const { path } of listed.files) {
    const after = commandsAfter(listed, path);
    // The owner's answers of 2026-10-17 (code-pass/11): a command refused before it ran (effect none) is not listed.
    const later = session.events.slice(lastOf(path) + 1).filter((e) => e.kind === 'invocation' && e.operation === 'command'
      && effect(e) !== NONE);
    assert.equal(after?.length, later.length, `${label} ${path}`);
  }
  // The story: its change rows, its outside paths (with the writes it lists apart) and its runs.
  const facts = storyFacts(session, { ...windowed(session), sessionStatus: 'NO_FINDINGS' });
  const rowed = new Set([...facts.whole.changes, ...facts.whole.unconfirmed].map((row) => row.event.id));
  for (const write of writes) assert.equal(rowed.has(write.id), changing(write), `${label} ${write.id}`);
  // D98 (review of A1a): a write whose call (its own, or the command it was parsed from) the recorder typed as stopped has effect
  // unknown, and the story lists it apart as such, never among the changed files.
  const apart = new Map(facts.whole.unconfirmed.map((row) => [row.event.id, row.unconfirmed]));
  for (const write of writes.filter((w) => STOPPED_DENIALS.includes(callOf(w)?.recorded?.denial)))
    assert.equal(apart.get(write.id), 'stopped', `${label} ${write.id}: a stopped write is listed apart`);
  assert.deepEqual(new Set([...facts.whole.outsidePaths,
    ...facts.whole.unconfirmed.filter((row) => row.outside).map((row) => row.path)]), outside, label);
  for (const run of facts.whole.commands) assert.equal(run.didNotRun, effect(run.event) === NONE, `${label} ${run.event.id}`);
  // The page's Runs list: a changed file no command that may have run (effect not none) followed after its last change.
  const model = reportModel(session, windowed(session), {});
  const neverRan = facts.whole.files.map((f) => f.path).filter((path) => lastOf(path) >= 0 && !session.events
    .slice(lastOf(path) + 1).some((e) => e.kind === 'invocation' && e.operation === 'command' && effect(e) !== NONE));
  assert.deepEqual(model.did.runs.neverRan, neverRan, label);
  // The same-path check after each action, to the end of the recording, and the ownership of each changed file.
  const end = Math.max(...session.events.map((e) => e.sequence)) + 1;
  for (const path of changed) {
    for (const from of actions) {
      const expected = writes.some((w) => w !== from && names(w, path) && w.sequence > from.sequence && changing(w));
      assert.equal(samePathChangedBetween(session, from, [path], end), expected, `${label} ${from.id} ${path}`);
    }
    const entry = { id: `P-${path}`, kind: 'project-instructions', path, childId: null };
    assert.equal(writtenInSession(session, entry), true, `${label} ${path}`);
  }
  for (const write of writes.filter((w) => !changing(w))) for (const change of write.changes ?? []) {
    if (changed.has(change.path)) continue;
    const entry = { id: `P-${change.path}`, kind: 'project-instructions', path: change.path, childId: null };
    assert.equal(writtenInSession(session, entry), false, `${label} ${change.path}`);
  }
  // The slicer's earlier-state rule: the ledger's actions and the adapter's invocations are one list, in one order.
  if (raw === undefined) return;
  assert.equal(raw.ledger.length, actions.length, label);
  raw.ledger.forEach((ev, i) => assert.equal(parsedFromRefusedCall(raw.ledger, i), Boolean(ev.via)
    && effect(actions[i]) === NONE, `${label} ${i}`));
  const index = new Map(raw.ledger.map((ev, i) => [`${ev.turn}:${ev.seq}`, i]));
  for (const ev of raw.ledger) {
    if (ev.before?.source !== 'write') continue;
    assert.notEqual(effect(actions[index.get(`${ev.before.turn}:${ev.before.seq}`)]), NONE, `${label} ${ev.path}`);
  }
}

test('D98 F9: every reader agrees with the effect rule on every fixture session', async (t) => {
  const sessions = [['effects', await pipeline(t)], ['last edit', await slice(t, lastEditRecording())]];
  // The slicer's hand-checked golden sessions.
  const golden = (await readdir(GOLDEN)).filter((name) => name.endsWith('.jsonl')).sort();
  assert.ok(golden.length > 0);
  for (const name of golden) {
    const raw = await sliceLineage([join(GOLDEN, name)], { cwd: '/repo' });
    sessions.push([name, { raw, session: sessionFromLedger(redact(raw).ledger, { sessionKey: name }) }]);
  }
  // A Claude Code and a Codex recording of the unasked-column fixture, as the review loads them.
  sessions.push(['claude', await load(t, claudeRows({ ask: true }))]);
  sessions.push(['codex', await load(t, codexRows(), { name: CODEX_NAME })]);
  for (const [label, loaded] of sessions) readersAgree(loaded, label);
  // The fixtures hold every effect, a stopped call and a write parsed from a refused one.
  const all = sessions.flatMap(([, { session }]) => invocations(session).map((e) => [session, e]));
  const effects = new Set(all.map(([session, e]) => effectOf(session, e)));
  assert.deepEqual([...effects].sort(), [...ACTION_EFFECTS].sort());
  assert.ok(all.some(([session, e]) => e.shellWriteOf && effectOf(session, e) === NONE));
  assert.ok(all.some(([, e]) => !e.shellWriteOf && STOPPED_DENIALS.includes(e.recorded?.denial)
    && FILE_OPS.includes(e.operation)));
});

test('D98 F9: the closed lists — refused and stopped split the recorder\'s denial vocabulary, in both packages', () => {
  assert.deepEqual([...REFUSED_DENIALS, ...STOPPED_DENIALS].sort(), [...RECORDED_FACTS.denial].sort());
  assert.deepEqual([...STOPPED_DENIAL_KINDS], [...STOPPED_DENIALS]);
  assert.deepEqual([...ACTION_EFFECTS], ['none', 'undone', 'landed', 'unknown']);
  assert.deepEqual([...CHANGING_EFFECTS], ['landed', 'unknown']);
});

test('D98 F9: a call with no typed refusal is never none; a refusal counts once its result is recorded', () => {
  const event = (id, extra = {}) => ({ id, kind: 'invocation', operation: 'command', paths: [], command: [], input: [],
    changes: [], recorded: { tool: 'Bash' }, ...extra });
  const result = (of, sequence, extra = {}) => ({ id: `${of}.r`, kind: 'observation', phase: 'terminal', invocation: of,
    sequence, result: 'failed', terminalStatusProven: true, sourceOfResult: 'native', ...extra });
  const write = (id, of, sequence) => ({ id, kind: 'invocation', operation: 'edit', paths: [{ path: 'a.md' }], command: [],
    input: [], shellWriteOf: of, shellWriteStatusEligible: true, sequence, changes: [{ path: 'a.md' }] });
  const session = new Session({ sessionKey: 'd98', events: [
    { ...event('A', { recorded: { tool: 'Bash', denial: 'user-rejected' } }), sequence: 0 }, write('A1', 'A', 1),
    result('A', 2),
    { ...event('B', { refusalUntyped: true }), sequence: 3 }, write('B1', 'B', 4), result('B', 5),
    { ...event('C', { recorded: { tool: 'Bash', denial: 'interrupted' } }), sequence: 6 }, write('C1', 'C', 7),
    result('C', 8),
    { ...event('D', { recorded: { tool: 'Bash', denial: 'some-future-kind' } }), sequence: 9 }, write('D1', 'D', 10),
    result('D', 11),
    { ...event('E', { recorded: { tool: 'Bash', denial: 'permission-rule' } }), sequence: 12 }, write('E1', 'E', 13),
  ] });
  const of = (id, options) => effectOf(session, session.event(id), options);
  assert.deepEqual([of('A'), of('A1')], [NONE, NONE]);
  // Before its result is recorded (D59: a window that ends earlier), the refusal is not read.
  assert.deepEqual([of('A', { until: 1 }), of('A1', { until: 1 })], [UNKNOWN, UNKNOWN]);
  // An untyped refusal (a recorder that types none), a stopped call, a kind outside the vocabulary, a refusal with no
  // recorded result: never none.
  for (const id of ['B', 'B1', 'C', 'C1', 'D', 'D1', 'E', 'E1']) assert.notEqual(of(id), NONE, id);
  // A write whose parent the session does not hold proves nothing.
  assert.equal(effectOf(session, write('Z1', 'Z', 14)), UNKNOWN);
  assert.equal(effectOf(session, null), UNKNOWN);
});
