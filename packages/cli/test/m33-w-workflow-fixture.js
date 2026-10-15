// M33 W (Claude Code Workflow agents). Synthetic Claude Code projects trees: a parent recording that runs the
// `Workflow` tool, the run directory its agents write (`<slug>/<session>/subagents/workflows/<runId>/`: agent
// recordings, their meta files and the run journal) and the workflow script. Shared by the CLI, evidence and render
// tests and by the one-off capture of base digests against an export of fd5d129, so it imports node built-ins only.
//
// The shapes follow Claude Code's recordings (keys and types only); every byte here is invented. A parent's Workflow
// result row carries `toolUseResult = { runId, scriptPath, status: "async_launched", summary, taskId, taskType,
// transcriptDir, workflowName }`; its completion arrives later as a typed task notification. An agent recording is a
// Claude sidechain transcript whose every row records `isSidechain: true`, the agent's `agentId` and the parent's
// `sessionId`; its first row is a user row whose content is a STRING, the brief the workflow sent. Journal lines are
// `{ type: "started" | "result", agentId, key, result? }`.
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

export const SID = '5f0c2d1e-7a3b-4c1d-9e2f-00000000a001';
/** A resumed parent's earlier session (C-03 M33 D resumed shape: two sessionIds, two contiguous blocks). */
export const SID_EARLIER = '5f0c2d1e-7a3b-4c1d-9e2f-00000000a000';
export const SLUG = '-srv-synthetic-repo';
export const RUN = 'wf_1a2b3c4d-5e6';
export const RUN_NESTED = 'wf_7a8b9c0d-1e2';
export const AGENTS = Object.freeze({ fixer: 'a1111111111111111', tester: 'a2222222222222222',
  stray: 'a3333333333333333', deep: 'a4444444444444444', deeper: 'a5555555555555555' });
export const CALL = 'toolu_01SyntheticWorkflowCall0001';
export const TASK = 'wtask_synthetic_001';

export const TEXT = Object.freeze({
  ask: 'Fix the nested-input parser bug so the parser tests pass. Use a workflow for the fix and the test run.',
  plan: 'I will run a two-agent workflow: one agent fixes the parser, the other runs the test suite.',
  claim: 'All parser tests pass now; the nested-input fix is in.',
  fixerBrief: 'Fix the nested-input branch in src/parser.js so test/parser.test.js passes. Return a JSON summary of '
    + 'what you changed and whether the tests pass.',
  testerBrief: 'Run the parser test suite with npm test and report the result in one sentence.',
  fixerSaid: 'One nested-input test still fails after the change.',
  testerSaid: 'The parser suite ran.',
  failing: 'FAIL test/parser.test.js\n  nested input > keeps nested arrays\nTests: 1 failed, 11 passed, 12 total',
  passing: 'PASS test/parser.test.js\nTests: 12 passed, 12 total',
  oldLine: 'return parseFlat(input);',
  newLine: 'return Array.isArray(input) ? input.map(parseNested) : parseFlat(input);',
});
/** What each agent returned, as the run journal records it: an object, and a string. */
export const RESULTS = Object.freeze({
  fixer: { status: 'partial', changed: ['src/parser.js'], summary: 'One nested-input test still fails.' },
  tester: 'Ran npm test: 12 passed.',
});

const TIME = '2026-10-01T09:00:00.000Z';
const hex = (seed, n) => createHash('sha256').update(seed).digest('hex').slice(0, n);
const uuid = (seed) => { const h = hex(seed, 32); return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`; };
/** A 67-character journal key, as recorded (opaque; never joined). */
export const journalKey = (agentId) => `k${hex(`key:${agentId}`, 64)}:01`;

/** M34 labels: a human's prompt row, as Claude Code 2.1.219 and later records one (the host's typed origin). */
export const HUMAN = Object.freeze({ origin: Object.freeze({ kind: 'human' }), promptSource: 'sdk' });
const parentRow = (sessionId, type, content, extra = {}, seed = '') => ({ parentUuid: null, isSidechain: false,
  userType: 'external', entrypoint: 'cli', cwd: '/repo', sessionId, version: '2.1.284', gitBranch: 'main', type,
  message: { role: type, content }, uuid: uuid(`${sessionId}:${type}:${seed}:${JSON.stringify(content).length}`),
  timestamp: TIME, ...extra });

/** One Workflow call: its tool_use row, its own result row (with the launch sidecar), and its typed notification.
 *  `resumeFromRunId` (M33 W resumed runs) records the typed resume input instead of a script: `{description,
 *  resumeFromRunId, scriptPath}`, as Claude Code records a call that resumes an earlier run. */
export function workflowRows({ sessionId = SID, call = CALL, task = TASK, runId = RUN, transcriptDir = null,
  workflowName = 'fix-parser', withRunId = true, error = false, notification = true, resumeFromRunId = null } = {}) {
  const sidecar = { ...(withRunId ? { runId } : {}), scriptPath: '/srv/synthetic/workflows/scripts/fix-parser.js',
    status: 'async_launched', summary: 'Fix the parser and run its tests', taskId: task, taskType: 'local_workflow',
    ...(transcriptDir !== null ? { transcriptDir } : {}), ...(workflowName !== null ? { workflowName } : {}) };
  const input = resumeFromRunId === null
    ? { description: 'Fix the parser and run its tests',
      script: "export default async function run(ctx) {\n  await ctx.agent('fix');\n  await ctx.agent('test');\n}" }
    : { description: 'Resume the parser workflow', resumeFromRunId,
      scriptPath: '/srv/synthetic/workflows/scripts/fix-parser.js' };
  return [
    parentRow(sessionId, 'assistant', [{ type: 'text', text: TEXT.plan },
      { type: 'tool_use', id: call, name: 'Workflow', input }],
    {}, call),
    error
      ? parentRow(sessionId, 'user', [{ type: 'tool_result', tool_use_id: call, is_error: true,
        content: 'Workflow failed to start: synthetic error' }], {}, `${call}:r`)
      : parentRow(sessionId, 'user', [{ type: 'tool_result', tool_use_id: call,
        content: `Workflow launched in the background.\nTask ID: ${task}` }], { toolUseResult: sidecar }, `${call}:r`),
    ...(notification && !error ? [parentRow(sessionId, 'user', `<task-notification>\n<task-id>${task}</task-id>\n`
      + `<tool-use-id>${call}</tool-use-id>\n<status>completed</status>\n<summary>Workflow finished</summary>\n`
      + '</task-notification>', { origin: { kind: 'task-notification' } }, `${call}:n`)] : []),
  ];
}

/** The parent recording: the ask, the given Workflow rows (none: one Bash call instead), and the closing claim. */
export function parentRows({ sessionId = SID, workflows = [workflowRows()], earlier = false } = {}) {
  const rows = [];
  if (earlier) rows.push(parentRow(SID_EARLIER, 'user', 'Look at the parser first.', HUMAN, 'earlier-ask'),
    parentRow(SID_EARLIER, 'assistant', [{ type: 'text', text: 'Reading the parser.' }], {}, 'earlier-said'));
  rows.push(parentRow(sessionId, 'user', TEXT.ask, HUMAN, 'ask'));
  if (!workflows.length) rows.push(
    parentRow(sessionId, 'assistant', [{ type: 'tool_use', id: 'toolu_01SyntheticBash0001', name: 'Bash',
      input: { command: 'npm test', description: 'Run the parser tests' } }], {}, 'bash'),
    parentRow(sessionId, 'user', [{ type: 'tool_result', tool_use_id: 'toolu_01SyntheticBash0001', is_error: true,
      content: TEXT.failing }], {}, 'bash:r'));
  for (const rowsOfCall of workflows) rows.push(...rowsOfCall);
  rows.push(parentRow(sessionId, 'assistant', [{ type: 'text', text: TEXT.claim }], {}, 'claim'));
  return rows;
}

const agentRow = (agentId, sessionId, type, content, extra = {}, seed = '') => ({ parentUuid: null, isSidechain: true,
  promptId: `prompt-${agentId}`, agentId, type, message: { role: type, content },
  uuid: uuid(`${agentId}:${type}:${seed}`), timestamp: TIME, userType: 'external', entrypoint: 'cli', cwd: '/repo',
  sessionId, version: '2.1.284', gitBranch: 'main', ...extra });

/** The fixer agent: its brief, an Edit of the parser, a FAILING test run, and its last statement. */
export function fixerRows({ agentId = AGENTS.fixer, sessionId = SID, brief = TEXT.fixerBrief, rowAgentId = agentId,
  rowSessionId = sessionId, extra = [] } = {}) {
  const row = (type, content, more = {}, seed = '') => agentRow(rowAgentId, rowSessionId, type, content, more, seed);
  return [
    row('user', brief, {}, 'brief'),
    row('assistant', [{ type: 'tool_use', id: `toolu_${agentId}_edit`, name: 'Edit', input: { file_path: '/repo/src/parser.js',
      old_string: TEXT.oldLine, new_string: TEXT.newLine } }], {}, 'edit'),
    row('user', [{ type: 'tool_result', tool_use_id: `toolu_${agentId}_edit`,
      content: 'The file /repo/src/parser.js has been updated.' }], {}, 'edit:r'),
    row('assistant', [{ type: 'tool_use', id: `toolu_${agentId}_test`, name: 'Bash',
      input: { command: 'npm test', description: 'Run the parser tests' } }], {}, 'test'),
    row('user', [{ type: 'tool_result', tool_use_id: `toolu_${agentId}_test`, is_error: true, content: TEXT.failing }],
      {}, 'test:r'),
    ...extra.map((build) => build(row)),
    row('assistant', [{ type: 'text', text: TEXT.fixerSaid }], {}, 'said'),
  ];
}

/** The tester agent: its brief, one passing test run, its last statement. */
export function testerRows({ agentId = AGENTS.tester, sessionId = SID, brief = TEXT.testerBrief } = {}) {
  const row = (type, content, more = {}, seed = '') => agentRow(agentId, sessionId, type, content, more, seed);
  return [
    row('user', brief, {}, 'brief'),
    row('assistant', [{ type: 'tool_use', id: `toolu_${agentId}_test`, name: 'Bash',
      input: { command: 'npm test', description: 'Run the parser tests' } }], {}, 'test'),
    row('user', [{ type: 'tool_result', tool_use_id: `toolu_${agentId}_test`, content: TEXT.passing }], {}, 'test:r'),
    row('assistant', [{ type: 'text', text: TEXT.testerSaid }], {}, 'said'),
  ];
}

export const jsonl = (rows) => rows.map((row) => (typeof row === 'string' ? row : JSON.stringify(row))).join('\n') + '\n';
export const started = (agentId) => JSON.stringify({ type: 'started', agentId, key: journalKey(agentId) });
export const resulted = (agentId, result) => JSON.stringify({ type: 'result', agentId, key: journalKey(agentId), result });

/**
 * A synthetic projects tree under `root`. `run` describes the run directory (or null for none):
 *   { session (whose dir holds it), runId, journal: [lines] | null (no journal file), agents: { agentId: rows },
 *     meta: true, order: 'forward' | 'reverse' (file creation order) }
 * Returns { projects, slugDir, parent, runDir }.
 */
export async function writeTree(root, { parent, run = null, extraRuns = [], parentName = SID } = {}) {
  const projects = join(root, 'projects');
  const slugDir = join(projects, SLUG);
  await mkdir(slugDir, { recursive: true });
  const parentFile = join(slugDir, `${parentName}.jsonl`);
  await writeFile(parentFile, jsonl(parent), { mode: 0o600 });
  const runDirs = [];
  for (const spec of [run, ...extraRuns].filter(Boolean)) {
    const runDir = join(slugDir, spec.session ?? SID, 'subagents', 'workflows', spec.runId ?? RUN);
    await mkdir(runDir, { recursive: true });
    const scripts = join(slugDir, spec.session ?? SID, 'workflows', 'scripts');
    await mkdir(scripts, { recursive: true });
    await writeFile(join(scripts, 'fix-parser.js'), "export default async function run() {}\n", { mode: 0o600 });
    const writes = [];
    if (spec.journal !== null && spec.journal !== undefined)
      writes.push([join(runDir, 'journal.jsonl'), spec.journal.join('\n') + '\n']);
    for (const [agentId, rows] of Object.entries(spec.agents ?? {})) {
      writes.push([join(runDir, `agent-${agentId}.jsonl`), jsonl(rows)]);
      if (spec.meta !== false) writes.push([join(runDir, `agent-${agentId}.meta.json`),
        JSON.stringify({ agentType: 'general-purpose', spawnDepth: 1 }) + '\n']);
    }
    if (spec.order === 'reverse') writes.reverse();
    for (const [file, text] of writes) await writeFile(file, text, { mode: 0o600 });
    runDirs.push(runDir);
  }
  return { projects, slugDir, parent: parentFile, runDir: runDirs[0] ?? null, runDirs };
}

/**
 * A parent whose rows record two sessions INTERLEAVED (an earlier-session row after the current session began): an
 * identity conflict that is not the M33 D resumed shape. Its one Workflow call records no transcriptDir, so only the
 * call's own session's run directory could be its run.
 */
export function interleavedParentRows() {
  const rows = parentRows({ earlier: true, workflows: [workflowRows()] });
  const stray = { ...rows[0], uuid: '5f0c2d1e-0000-4000-8000-0000000000ff',
    message: { role: 'user', content: 'One more note from the earlier session.' } };
  return [...rows.slice(0, -1), stray, rows[rows.length - 1]];
}

/**
 * M33 W copied calls. Claude Code continues a conversation in a new session file that repeats earlier rows with the
 * SAME row uuid while rewriting their sessionId: these are `rows` as the continuing file records them.
 */
export const copiedRows = (rows, sessionId) => rows.map((row) => ({ ...row, sessionId }));
/** An earlier session (one the continuing parent never records) whose file the copied rows came from. */
export const SID_COPIED = '5f0c2d1e-7a3b-4c1d-9e2f-00000000c001';

/** The standard linked run: two started agents, both with recordings and results. */
export function linkedRun({ session = SID, runId = RUN, order = 'forward', journal = null, agents = null } = {}) {
  return { session, runId, order,
    journal: journal ?? [started(AGENTS.fixer), started(AGENTS.tester),
      resulted(AGENTS.fixer, RESULTS.fixer), resulted(AGENTS.tester, RESULTS.tester)],
    agents: agents ?? { [AGENTS.fixer]: fixerRows({ sessionId: session }), [AGENTS.tester]: testerRows({ sessionId: session }) } };
}

/** A scratch directory (realpath'd, so a macOS /var -> /private/var alias never reads as an escape). */
export async function scratch(prefix = 'sonah-m33-w-') {
  return realpath(await mkdtemp(join(tmpdir(), prefix)));
}
export { symlink, dirname, rm, mkdir, writeFile, join };

const sha256 = (text) => createHash('sha256').update(text).digest('hex');

/**
 * Byte capture of the sessions whose ledgers, review requests and stories must not move (M33 W byte stability):
 *   none       — a session with no Workflow call (one failing Bash run instead);
 *   unresolved — three Workflow calls that link nothing: one whose result recorded no runId, one whose recorded
 *                transcriptDir does not exist (and no run directory of its own), and one that failed to start;
 *   conflicted — (M33 W repair) a parent whose rows record two sessions interleaved (not the resumed shape) and whose
 *                launched call's own session holds a complete run: the parent links nothing, as for Agent/Task.
 * `m` carries the modules of the tree under test, so the same function runs against an export of fd5d129 and this
 * tree: { loadSessionEvidence, redact, sessionFromLedger, runReview, planWindowRequests, captureCase, windowNarrative,
 * fixtureJudge, renderSessionStory }. Every value is a digest; nothing prints.
 */
export async function captureStableCases(m) {
  const root = await scratch('sonah-m33-w-bytes-');
  const previousHome = process.env.SONAH_HOME;
  process.env.SONAH_HOME = join(root, 'sonah-home');
  try {
    const cases = [];
    const specs = [
      ['none', parentRows({ workflows: [] })],
      ['unresolved', parentRows({ workflows: [
        workflowRows({ withRunId: false }),
        workflowRows({ call: 'toolu_01SyntheticWorkflowCall0002', task: 'wtask_synthetic_002', runId: 'wf_0000aaaa-bbb',
          transcriptDir: '/srv/synthetic-elsewhere/subagents/workflows/wf_0000aaaa-bbb' }),
        workflowRows({ call: 'toolu_01SyntheticWorkflowCall0003', task: 'wtask_synthetic_003', error: true }),
      ] })],
      ['conflicted', interleavedParentRows(), linkedRun()],
    ];
    for (const [name, parent, run = null] of specs) {
      const dir = join(root, name);
      const tree = await writeTree(dir, { parent, run });
      const codex = join(dir, 'codex-sessions');
      await mkdir(codex, { recursive: true });
      const raw = await m.loadSessionEvidence([tree.parent], { outcomes: new Map(), reviewLinkedChildren: true,
        recordingRoots: { claude: tree.projects, codex } });
      const ledger = m.redact(raw).ledger;
      const session = m.sessionFromLedger(ledger, { sessionKey: `m33-w-${name}` });
      const narrativeOf = (s, request) => m.windowNarrative(s, request.window);
      const requests = await m.captureCase({ runReview: m.runReview, planWindowRequests: m.planWindowRequests },
        { name, session, narrativeOf });
      const report = await m.runReview({ session, pr: null, reviewScope: 'session-only', concurrency: 1,
        judge: m.fixtureJudge({ narrativeOf: (request) => narrativeOf(session, request) }) });
      cases.push({ name, ledger: sha256(JSON.stringify(ledger)), gaps: sha256(JSON.stringify(session.adapterGaps)),
        ...requests, story: sha256(m.renderSessionStory(session, report)) });
    }
    return cases;
  } finally {
    if (previousHome === undefined) delete process.env.SONAH_HOME; else process.env.SONAH_HOME = previousHome;
    await rm(root, { recursive: true, force: true });
  }
}
