// M33 W2 (a Workflow run's agents are placed where the parent RECEIVED the run's completion). Synthetic Claude Code
// parent recordings built on the M33 W fixture (m33-w-workflow-fixture.js): a Workflow call runs asynchronously, the
// parent keeps working, and the run's completion arrives later as a typed task notification. Node built-ins only, so
// the byte capture below also runs against an export of d7226ec (the base this work package started from). Every byte
// here is invented.
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { CALL, RUN, SID, SLUG, TASK, TEXT, linkedRun, mkdir, parentRows, rm, scratch, workflowRows, writeTree }
  from './m33-w-workflow-fixture.js';

const TIME = '2026-10-01T09:00:00.000Z';
const hex = (seed, n) => createHash('sha256').update(seed).digest('hex').slice(0, n);
const uuid = (seed) => { const h = hex(seed, 32); return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`; };

/** A parent row, in the M33 W fixture's shape (every row records the parent's session). */
export const row = (type, content, extra = {}, seed = '', sessionId = SID) => ({ parentUuid: null, isSidechain: false,
  userType: 'external', entrypoint: 'cli', cwd: '/repo', sessionId, version: '2.1.284', gitBranch: 'main', type,
  message: { role: type, content }, uuid: uuid(`w2:${sessionId}:${type}:${seed}`), timestamp: TIME, ...extra });

export const CALL_RESUME = 'toolu_01SyntheticWorkflowCall0002';
export const TASK_RESUME = 'wtask_synthetic_002';

export const W2_TEXT = Object.freeze({
  ask: 'Fix the nested-input parser bug so the parser tests pass. Verify it with a workflow.',
  fixed: 'The verifier reported a failing nested-input test; fixing the branch now.',
  claim: 'All parser tests pass now; the nested-input fix is in.',
  readmeAsk: 'Also note the nested-input behaviour in the README.',
  readme: 'Nested arrays are parsed element by element.',
});

/** A typed task notification for one launch, on a `user` row (`origin: {kind: 'task-notification'}`) or as a queued
 *  command attachment (`commandMode: 'task-notification'`): the two carriers C-02 M33 D reads. */
export function notificationRow({ call = CALL, task = TASK, status = 'completed', seed = 'n', carrier = 'user',
  sessionId = SID } = {}) {
  const text = `<task-notification>\n<task-id>${task}</task-id>\n<tool-use-id>${call}</tool-use-id>\n`
    + `<status>${status}</status>\n<summary>Workflow ${status}</summary>\n</task-notification>`;
  if (carrier === 'user') return row('user', text, { origin: { kind: 'task-notification' } }, `${call}:${seed}`, sessionId);
  return { parentUuid: null, isSidechain: false, userType: 'external', entrypoint: 'cli', cwd: '/repo', sessionId,
    version: '2.1.284', gitBranch: 'main', type: 'attachment', uuid: uuid(`w2:${call}:${seed}:queued`), timestamp: TIME,
    attachment: { type: 'queued_command', prompt: text, commandMode: 'task-notification' } };
}

/** A Workflow call's tool_use row and its own launch result row (no notification: callers place it). */
export const launchRows = (options = {}) => workflowRows({ notification: false, ...options });

/** The parent's own fix: one Edit of the parser and its result. */
export const parentEditRows = (seed = 'fix') => [
  row('assistant', [{ type: 'text', text: W2_TEXT.fixed },
    { type: 'tool_use', id: `toolu_01SyntheticParent${seed}`, name: 'Edit', input: { file_path: '/repo/src/parser.js',
      old_string: TEXT.oldLine, new_string: TEXT.newLine } }], {}, `${seed}:edit`),
  row('user', [{ type: 'tool_result', tool_use_id: `toolu_01SyntheticParent${seed}`,
    content: 'The file /repo/src/parser.js has been updated.' }], {}, `${seed}:edit:r`),
];
/** The parent's own test run, passing or failing, and its result. */
/** H1: a passing run is recorded as Claude Code records one — `is_error: false` and its typed success sidecar (the
 *  status a parent's passing Bash carries); its output text is never read for a status. */
export const parentTestRows = (seed = 'rerun', { passing = true } = {}) => [
  row('assistant', [{ type: 'tool_use', id: `toolu_01SyntheticParent${seed}`, name: 'Bash',
    input: { command: 'npm test', description: 'Run the parser tests' } }], {}, `${seed}:bash`),
  row('user', [{ type: 'tool_result', tool_use_id: `toolu_01SyntheticParent${seed}`,
    is_error: !passing, content: passing ? TEXT.passing : TEXT.failing }],
  passing ? { toolUseResult: { stdout: TEXT.passing, stderr: '', interrupted: false, isImage: false, noOutputExpected: false } } : {},
  `${seed}:bash:r`),
];
export const claimRow = () => row('assistant', [{ type: 'text', text: W2_TEXT.claim }], {}, 'claim');
// M34 labels: a human's prompt row carries the host's typed origin, as Claude Code 2.1.219 and later records it.
export const askRow = (text = W2_TEXT.ask, seed = 'ask') => row('user', text, { origin: { kind: 'human' }, promptSource: 'sdk' }, seed);
export const compactRow = () => ({ ...row('system', 'Conversation compacted', {}, 'compact'), subtype: 'compact_boundary',
  message: undefined, content: 'Conversation compacted' });

/**
 * The verifier-before-fix shape (a false DECIDE): the parent launches a Workflow whose agents test the parser
 * (the fixer's run FAILS); the run's completion is received; THEN the parent fixes the parser itself and reruns the
 * tests (PASS) and claims they pass. The agents' failing run predates the fix: it must never read as recorded after
 * the parent's passing rerun. `notification: false` — the session ended before any completion was recorded.
 */
export function verifierBeforeFixRows({ transcriptDir, notification = true, status = 'completed', carrier = 'user' } = {}) {
  return [askRow(), ...launchRows({ transcriptDir }),
    ...(notification ? [notificationRow({ status, carrier })] : []),
    ...parentEditRows(), ...parentTestRows(), claimRow()];
}

/** The completion is received in a LATER human turn, after a compaction and after the parent's own README edit. */
export function receivedLaterRows({ transcriptDir } = {}) {
  return [askRow(), ...launchRows({ transcriptDir }), compactRow(), askRow(W2_TEXT.readmeAsk, 'readme-ask'),
    row('assistant', [{ type: 'tool_use', id: 'toolu_01SyntheticParentReadme', name: 'Write',
      input: { file_path: '/repo/README.md', content: `${W2_TEXT.readme}\n` } }], {}, 'readme'),
    row('user', [{ type: 'tool_result', tool_use_id: 'toolu_01SyntheticParentReadme',
      content: 'File created successfully at: /repo/README.md' }], {}, 'readme:r'),
    notificationRow(), claimRow()];
}

/**
 * A resumed run (M33 W repair 2): the origin call and its own notification, the parent's fix, a call resuming the run
 * by its recorded input, the parent's rerun, and the resume's own notification (`resumeNotification: false` — none).
 */
export function resumedRows({ transcriptDir, resumeNotification = true, originStatus = 'failed' } = {}) {
  return [askRow(), ...launchRows({ transcriptDir }), notificationRow({ status: originStatus }), ...parentEditRows(),
    ...launchRows({ call: CALL_RESUME, task: TASK_RESUME, transcriptDir, resumeFromRunId: RUN }),
    ...parentTestRows(),
    ...(resumeNotification ? [notificationRow({ call: CALL_RESUME, task: TASK_RESUME, seed: 'resume-n' })] : []),
    claimRow()];
}

const sha256 = (text) => createHash('sha256').update(text).digest('hex');

/**
 * Byte capture of a session whose linked run was received right after its launch (the M33 W fixture's standard shape:
 * the notification row directly follows the launch result): its agents stand where they stood, so its gaps, review
 * requests and story keep d7226ec's bytes; only its ledger moves (the run record names its receipt). `m` carries the
 * modules of the tree under test: { loadSessionEvidence, redact, sessionFromLedger, runReview, planWindowRequests,
 * captureCase, windowNarrative, fixtureJudge, renderSessionStory }. Every value is a digest; nothing prints.
 */
export async function captureReceivedCases(m) {
  const root = await scratch('sonah-m33-w2-bytes-');
  const previousHome = process.env.SONAH_HOME;
  process.env.SONAH_HOME = join(root, 'sonah-home');
  try {
    const cases = [];
    for (const name of ['received']) {
      const dir = join(root, name);
      const transcriptDir = join(dir, 'projects', SLUG, SID, 'subagents', 'workflows', RUN);
      const tree = await writeTree(dir, { parent: parentRows({ workflows: [workflowRows({ transcriptDir })] }),
        run: linkedRun() });
      const codex = join(dir, 'codex-sessions');
      await mkdir(codex, { recursive: true });
      const raw = await m.loadSessionEvidence([tree.parent], { outcomes: new Map(), reviewLinkedChildren: true,
        recordingRoots: { claude: tree.projects, codex } });
      const session = m.sessionFromLedger(m.redact(raw).ledger, { sessionKey: `m33-w2-${name}` });
      const narrativeOf = (s, request) => m.windowNarrative(s, request.window);
      const requests = await m.captureCase({ runReview: m.runReview, planWindowRequests: m.planWindowRequests },
        { name, session, narrativeOf });
      const report = await m.runReview({ session, pr: null, reviewScope: 'session-only', concurrency: 1,
        judge: m.fixtureJudge({ narrativeOf: (request) => narrativeOf(session, request) }) });
      cases.push({ name, events: sha256(JSON.stringify(session.events.map((event) => [event.id, event.sequence]))),
        gaps: sha256(JSON.stringify(session.adapterGaps)), ...requests, story: sha256(m.renderSessionStory(session, report)) });
    }
    return cases;
  } finally {
    if (previousHome === undefined) delete process.env.SONAH_HOME; else process.env.SONAH_HOME = previousHome;
    await rm(root, { recursive: true, force: true });
  }
}
