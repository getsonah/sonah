// M33 P (helper placement by recorded delivery and receipt). Synthetic Codex rollouts and Claude Code projects trees in
// which a helper works CONCURRENTLY with its parent, plus a deterministic probe judge. Node built-ins only. Every byte
// here is invented; the shapes follow the recorded ones (M33 F/T fixtures: a Codex hand-off's `message` is one
// encrypted token, which the helper's own rollout receives in an `agent_message` row addressed to it).
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/** A deterministic Fernet-shaped token (lower, then upper x3, base64url), as Codex records an encrypted payload. */
export function token(seed, length = 720) {
  let out = 'gAAAAA';
  for (let i = 0; out.length < length; i++) out += createHash('sha256').update(`m33-p:${seed}:${i}`).digest('base64url');
  return out.slice(0, length);
}
export const TOKENS = Object.freeze({ spawn: token('spawn'), follow: token('follow'), message: token('message'),
  stranger: token('stranger'), notes: token('notes') });

export const TEXT = Object.freeze({
  ask: 'SYNTHETIC_P_ASK: fix the parser so every parser test passes.',
  ask2: 'SYNTHETIC_P_ASK2: also cover the nested-input case.',
  plan: 'SYNTHETIC_P_PLAN: I will run the suite and hand the regression test to a helper.',
  claim: 'SYNTHETIC_P_CLAIM: All parser tests pass now and the fix is complete.',
  claimQuote: 'All parser tests pass now and the fix is complete.',
  relay: 'SYNTHETIC_P_RELAY: All parser tests pass; the branch is ready to merge.',
  relayQuote: 'All parser tests pass; the branch is ready to merge.',
  helperSaid: 'SYNTHETIC_P_HELPER: adding the nested-input regression test.',
  helperMore: 'SYNTHETIC_P_HELPER_MORE: covering the follow-up case.',
  report: 'SYNTHETIC_P_REPORT: the nested-input regression test fails.',
  report2: 'SYNTHETIC_P_REPORT2: the follow-up case is covered.',
  pass: 'Process exited with code 0\nOutput:\nPASS test/parser.test.js\nTests: 12 passed, 12 total',
  passQuote: 'Tests: 12 passed, 12 total',
  fail: 'Process exited with code 1\nOutput:\nFAIL test/parser.test.js\nnested input > keeps arrays FAILED\nTests: 1 failed, 12 passed, 13 total',
  failQuote: 'nested input > keeps arrays FAILED',
});

const response = (payload) => ({ type: 'response_item', payload });
export const said = (text) => response({ type: 'message', role: 'assistant', content: [{ type: 'output_text', text }] });
export const userAsk = (text) => response({ type: 'message', role: 'user', content: text });
export const call = (name, callId, args) => response({ type: 'function_call', name, call_id: callId,
  arguments: JSON.stringify(args) });
export const output = (callId, value) => response({ type: 'function_call_output', call_id: callId,
  output: typeof value === 'string' ? value : JSON.stringify(value) });
const header = (type, task, sender, payload = '') => `Message Type: ${type}\nTask name: ${task}\nSender: ${sender}\nPayload:\n${payload}`;
/** A helper's report to its parent, as the parent's rollout receives it (M33 F header). */
export const finalAnswer = (helper, payload, id = 'fa') => response({ type: 'agent_message', author: helper,
  recipient: '/root', id, internal_chat_message_metadata_passthrough: {},
  content: [{ type: 'input_text', text: header('FINAL_ANSWER', '/root', helper, payload) }] });
/** Work a helper receives: an encrypted NEW_TASK or MESSAGE addressed to it, its payload `secret`. */
export const arrival = (helper, secret, type = 'NEW_TASK', id = 'msg') => response({ type: 'agent_message',
  author: '/root', recipient: helper, id, internal_chat_message_metadata_passthrough: {},
  content: [{ type: 'input_text', text: header(type, helper, '/root') }, { type: 'encrypted_content', encrypted_content: secret }] });
/** A compaction row: a copy of an earlier row is never an arrival. */
export const compacted = (copy = null) => ({ type: 'compacted', payload: { message: 'Synthetic compaction.',
  ...(copy ? { replacement_history: [copy.payload] } : {}) } });
export const exec = (callId, cmd, out) => [call('exec_command', callId, { cmd }), output(callId, out)];
export const patch = (callId, path) => [response({ type: 'custom_tool_call', name: 'apply_patch', call_id: callId,
  input: `*** Begin Patch\n*** Add File: ${path}\n+// synthetic\n*** End Patch` }),
  response({ type: 'custom_tool_call_output', call_id: callId, output: 'Done.' })];
export const spawn = (callId, task, message) => [call('spawn_agent', callId, { message, task_name: task, fork_turns: 'none' }),
  output(callId, { task_name: `/root/${task}` })];
export const followup = (callId, task, message) => [call('followup_task', callId, { target: task, message }),
  output(callId, { ok: true })];
export const sendMessage = (callId, task, message) => [call('send_message', callId, { target: task, message }),
  output(callId, { ok: true })];

export const rootMeta = () => ({ type: 'session_meta', payload: { id: 'root', cwd: '/repo' } });
export const helperMeta = (path = '/root/fix_parser', id = 'helper-fix') => ({ type: 'session_meta', payload: { id, cwd: '/repo',
  multi_agent_version: 'v2', source: { subagent: { thread_spawn: { parent_thread_id: 'root', agent_path: path } } } } });
export const ordinals = (rows) => rows.map((row, ordinal) => ({ ordinal, ...row }));

/**
 * The concurrent Codex helper shape. The parent ran the suite (PASS), handed the regression test to a helper, and — 70 s
 * later, before the helper's work arrived — claimed the suite passes. The helper's edit and FAILING run were recorded in its own
 * rollout; the parent received its report only after its claim. With `relay`, the parent then relays that failing
 * result and claims again: a true contradiction.
 */
export function codexConcurrentRows({ relay = false, report = true } = {}) {
  return [rootMeta(), userAsk(TEXT.ask), said(TEXT.plan), ...exec('cmd-pass', 'npm test', TEXT.pass),
    ...spawn('spawn-fix', 'fix_parser', TOKENS.spawn), said(TEXT.claim),
    ...(report ? [finalAnswer('/root/fix_parser', TEXT.report)] : []), ...(relay ? [said(TEXT.relay)] : [])];
}
export function codexConcurrentHelperRows({ arrivals = [arrival('/root/fix_parser', TOKENS.spawn)] } = {}) {
  return ordinals([helperMeta(), ...arrivals, said(TEXT.helperSaid), ...patch('edit-test', 'test/parser-nested.test.js'),
    ...exec('cmd-fail', 'npm test', TEXT.fail)]);
}

/**
 * Follow-up segments. Turn 1: the parent spawns the helper, receives its first report, claims. Turn 2: the parent
 * follows up (or messages it, `via: 'send'`) with more work, then receives its second report. The helper's rollout
 * receives both payloads, so its history splits into two segments, each placed at its own receipt.
 */
export function followupRows({ via = 'followup', secondReport = true } = {}) {
  const more = via === 'send' ? sendMessage('send-fix', 'fix_parser', TOKENS.message)
    : followup('follow-fix', 'fix_parser', TOKENS.follow);
  return [rootMeta(), userAsk(TEXT.ask), said(TEXT.plan), ...spawn('spawn-fix', 'fix_parser', TOKENS.spawn),
    ...exec('cmd-pass', 'npm test', TEXT.pass), finalAnswer('/root/fix_parser', TEXT.report, 'fa-1'), said(TEXT.claim),
    userAsk(TEXT.ask2), ...more, ...exec('cmd-again', 'npm run lint', 'Process exited with code 0\nOutput:\nlint ok'),
    ...(secondReport ? [finalAnswer('/root/fix_parser', TEXT.report2, 'fa-2')] : []), said(TEXT.relay)];
}
export function followupHelperRows({ via = 'followup' } = {}) {
  return ordinals([helperMeta(), arrival('/root/fix_parser', TOKENS.spawn), said(TEXT.helperSaid),
    ...exec('cmd-fail', 'npm test', TEXT.fail),
    arrival('/root/fix_parser', via === 'send' ? TOKENS.message : TOKENS.follow, via === 'send' ? 'MESSAGE' : 'NEW_TASK', 'msg-2'),
    said(TEXT.helperMore), ...patch('edit-more', 'test/parser-more.test.js')]);
}

/**
 * M33 P repair: a QUEUED assignment. The parent spawns the helper and sends it more work (a follow-up, or a message)
 * BEFORE the helper's first report arrives; the helper receives that work only after finishing its first assignment,
 * so the first report answers the first assignment only. The second assignment's work (an edit and a FAILING run)
 * happened after that report, after the parent's claim; it was received at the helper's second report: in the same
 * request (`second: 'same'`), in the next request (`'next'`), or never (`false`).
 */
export function queuedRows({ via = 'followup', second = 'same' } = {}) {
  const more = via === 'send' ? sendMessage('send-fix', 'fix_parser', TOKENS.message)
    : followup('follow-fix', 'fix_parser', TOKENS.follow);
  const report2 = finalAnswer('/root/fix_parser', TEXT.report2, 'fa-2');
  return [rootMeta(), userAsk(TEXT.ask), said(TEXT.plan), ...exec('cmd-pass', 'npm test', TEXT.pass),
    ...spawn('spawn-fix', 'fix_parser', TOKENS.spawn), ...more, finalAnswer('/root/fix_parser', TEXT.report, 'fa-1'),
    said(TEXT.claim),
    ...(second === 'same' ? [report2] : second === 'next' ? [userAsk(TEXT.ask2), report2, said(TEXT.relay)] : [])];
}
export function queuedHelperRows({ via = 'followup' } = {}) {
  return ordinals([helperMeta(), arrival('/root/fix_parser', TOKENS.spawn), said(TEXT.helperSaid),
    ...patch('edit-test', 'test/parser-nested.test.js'),
    arrival('/root/fix_parser', via === 'send' ? TOKENS.message : TOKENS.follow, via === 'send' ? 'MESSAGE' : 'NEW_TASK', 'msg-2'),
    said(TEXT.helperMore), ...patch('edit-more', 'test/parser-more.test.js'), ...exec('cmd-fail', 'npm test', TEXT.fail)]);
}

/**
 * M33 P repair: a delivery CONFLICT. The parent spawns two helpers; each spawn's payload is received, byte for byte, by
 * the OTHER helper's rollout, so the exact token evidence contradicts both links.
 */
export function crossedRows() {
  return [rootMeta(), userAsk(TEXT.ask), said(TEXT.plan), ...exec('cmd-pass', 'npm test', TEXT.pass),
    ...spawn('spawn-fix', 'fix_parser', TOKENS.spawn), ...spawn('spawn-notes', 'write_notes', TOKENS.notes),
    said(TEXT.claim), finalAnswer('/root/fix_parser', TEXT.report, 'fa-1'), finalAnswer('/root/write_notes', TEXT.report2, 'fa-2')];
}
export function crossedHelperRows() {
  return [codexConcurrentHelperRows({ arrivals: [arrival('/root/fix_parser', TOKENS.notes)] }),
    ordinals([helperMeta('/root/write_notes', 'helper-notes'), arrival('/root/write_notes', TOKENS.spawn),
      said(TEXT.helperMore), ...patch('edit-notes', 'NOTES.md')])];
}

export const jsonl = (rows) => rows.map((row) => JSON.stringify(row)).join('\n') + '\n';

/** A Codex sessions directory holding the parent rollout and each helper rollout. Returns { root, dir }. */
export async function codexTree(parentRows, helpers = [codexConcurrentHelperRows()]) {
  const dir = await realpath(await mkdtemp(join(tmpdir(), 'sonah-m33-p-codex-')));
  const root = join(dir, 'rollout-2026-10-01T12-00-00-root.jsonl');
  await writeFile(root, jsonl(parentRows), { mode: 0o600 });
  for (const [k, rows] of helpers.entries())
    await writeFile(join(dir, `rollout-2026-10-01T12-00-0${k + 1}-helper-${k}.jsonl`), jsonl(rows), { mode: 0o600 });
  return { dir, root };
}

// ---- Claude Code ------------------------------------------------------------------------------------------------------

export const SID = '5f0c2d1e-7a3b-4c1d-9e2f-00000000a0f1';
export const AGENT = 'a7777777777777777';
const TIME = '2026-10-01T09:00:00.000Z';
const uuid = (seed) => { const h = createHash('sha256').update(seed).digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`; };
export const claudeRow = (type, content, extra = {}, seed = '') => ({ parentUuid: null, isSidechain: false,
  userType: 'external', entrypoint: 'cli', cwd: '/repo', sessionId: SID, version: '2.1.284', gitBranch: 'main', type,
  message: { role: type, content }, uuid: uuid(`p:${type}:${seed}`), timestamp: TIME, ...extra });
/** M34 labels: a human's prompt row, as Claude Code 2.1.219 and later records one (the host's typed origin). */
const HUMAN_PROMPT = Object.freeze({ origin: Object.freeze({ kind: 'human' }), promptSource: 'sdk' });
export const CLAUDE_TEXT = Object.freeze({
  ask: 'SYNTHETIC_P_CC_ASK: fix the parser and have a helper write the regression test.',
  claim: 'SYNTHETIC_P_CC_CLAIM: the parser fix is in and the suite passes.',
  brief: 'Write test/parser-nested.test.js for the nested-input case.',
  helperSaid: 'Wrote the regression test.',
});
const agentCall = (id, background) => claudeRow('assistant', [{ type: 'tool_use', id, name: 'Agent',
  input: { description: 'regression test', prompt: CLAUDE_TEXT.brief, subagent_type: 'general-purpose',
    ...(background ? { run_in_background: true } : {}) } }], {}, `${id}:call`);
// L2: each result carries the typed sidecar Claude Code writes for an Agent/Task
// result, since the launch mode is read from it alone.
const agentResult = (id, background) => claudeRow('user', [{ type: 'tool_result', tool_use_id: id,
  content: background ? `Async agent launched.\nagentId: ${AGENT}\nThe agent is working in the background.`
    : `The helper wrote the test.\nagentId: ${AGENT}` }], { toolUseResult: background
  ? { status: 'async_launched', isAsync: true, agentId: AGENT, description: 'regression test' }
  : { status: 'completed', agentId: AGENT, content: [{ type: 'text', text: 'The helper wrote the test.' }] } },
`${id}:result`);
const bash = (id, command, out) => [claudeRow('assistant', [{ type: 'tool_use', id, name: 'Bash', input: { command } }], {}, `${id}`),
  claudeRow('user', [{ type: 'tool_result', tool_use_id: id, content: out }], {}, `${id}:r`)];
export const agentNotification = (id, status = 'completed', task = AGENT) => claudeRow('user',
  `<task-notification>\n<task-id>${task}</task-id>\n<tool-use-id>${id}</tool-use-id>\n<status>${status}</status>\n`
  + '<summary>Agent finished</summary>\n</task-notification>', { origin: { kind: 'task-notification' } }, `${id}:n:${status}`);

/** A Claude parent: an Agent hand-off (synchronous, or `background`), its own result, the parent's own command, then
 *  (background only) the agent's completion notification (`notification`), then the parent's claim. */
export function claudeParentRows({ background = false, notification = true, status = 'completed', task = AGENT } = {}) {
  return [claudeRow('user', CLAUDE_TEXT.ask, HUMAN_PROMPT, 'ask'), agentCall('toolu_01SyntheticAgentP0001', background),
    agentResult('toolu_01SyntheticAgentP0001', background), ...bash('toolu_01SyntheticBashP0001', 'npm run build', 'built'),
    ...(background && notification ? [agentNotification('toolu_01SyntheticAgentP0001', status, task)] : []),
    claudeRow('assistant', [{ type: 'text', text: CLAUDE_TEXT.claim }], {}, 'claim')];
}
const agentRow = (type, content, seed) => ({ parentUuid: null, isSidechain: true, agentId: AGENT, type,
  message: { role: type, content }, uuid: uuid(`p:agent:${seed}`), timestamp: TIME, userType: 'external',
  entrypoint: 'cli', cwd: '/repo', sessionId: SID, version: '2.1.284', gitBranch: 'main' });
export function claudeAgentRows() {
  return [agentRow('user', CLAUDE_TEXT.brief, 'brief'),
    agentRow('assistant', [{ type: 'tool_use', id: 'toolu_agent_write', name: 'Write',
      input: { file_path: '/repo/test/parser-nested.test.js', content: '// nested input\n' } }], 'write'),
    agentRow('user', [{ type: 'tool_result', tool_use_id: 'toolu_agent_write', content: 'File created successfully' }], 'write:r'),
    agentRow('assistant', [{ type: 'text', text: CLAUDE_TEXT.helperSaid }], 'said')];
}
// ---- M33 P repair: Claude Code shapes ---------------------------------------------------------------------------------

export const CLAUDE_RUNS = Object.freeze({
  parentPass: 'PASS test/parser.test.js\nTests: 12 passed, 12 total',
  parentPassQuote: 'Tests: 12 passed, 12 total',
  parentFail: 'FAIL test/parser.test.js\nparser > keeps key order FAILED\nTests: 1 failed, 11 passed, 12 total',
  parentFailQuote: 'parser > keeps key order FAILED',
  agentPass: 'PASS test/parser-nested.test.js\nTests: 13 passed, 13 total',
  agentPassQuote: 'Tests: 13 passed, 13 total',
  agentFail: 'FAIL test/parser-nested.test.js\nnested input > keeps arrays FAILED\nTests: 1 failed, 12 passed, 13 total',
  agentFailQuote: 'nested input > keeps arrays FAILED',
  claimQuote: 'the parser fix is in and the suite passes.',
  midClaim: 'SYNTHETIC_P_CC_MID: the suite passes; committing the fix now.',
  midClaimQuote: 'the suite passes; committing the fix now.',
});
export const AGENT_CALL = 'toolu_01SyntheticAgentP0001';
const PARENT_TEST = 'toolu_01SyntheticBashP0002';
const POLL = 'toolu_01SyntheticPollP0001';
const bashUse = (id, command) => ({ type: 'tool_use', id, name: 'Bash', input: { command } });
const agentUse = (id, background) => ({ type: 'tool_use', id, name: 'Agent', input: { description: 'regression test',
  prompt: CLAUDE_TEXT.brief, subagent_type: 'general-purpose', ...(background ? { run_in_background: true } : {}) } });
const testResult = (id, passing, out) => claudeRow('user', [{ type: 'tool_result', tool_use_id: id,
  ...(passing ? {} : { is_error: true }), content: out }], {}, `${id}:r`);
const claimRow = () => claudeRow('assistant', [{ type: 'text', text: CLAUDE_TEXT.claim }], {}, 'claim');
/** The parent's own test run (call and result), passing or failing. */
export const parentTestRows = (passing) => [claudeRow('assistant', [bashUse(PARENT_TEST, 'npm test')], {}, PARENT_TEST),
  testResult(PARENT_TEST, passing, passing ? CLAUDE_RUNS.parentPass : CLAUDE_RUNS.parentFail)];

/**
 * A synchronous Agent called in PARALLEL with the parent's own test run (Claude Code writes each tool_use block as its
 * own row). `shape`: 'agent-first' (Agent row 2, Bash row 3, Bash result 4, agent result 5, claim 6), 'same-row' (both
 * calls on row 2, Bash result 3, agent result 4, claim 5), 'bash-first' (Bash row 2, Agent row 3, Bash result 4, agent
 * result 5, claim 6). The parent received the agent's result on its own row, after the Bash result.
 */
export function claudeParallelRows({ shape = 'agent-first', parentPassing = false, agentAnsweredFirst = false } = {}) {
  const [bashCall, bashResult] = parentTestRows(parentPassing);
  const agent = claudeRow('assistant', [agentUse(AGENT_CALL, false)], {}, `${AGENT_CALL}:call`);
  const calls = shape === 'same-row' || shape === 'one-result-row'
    ? [claudeRow('assistant', [agentUse(AGENT_CALL, false), bashUse(PARENT_TEST, 'npm test')], {}, 'both')]
    : shape === 'bash-first' ? [bashCall, agent] : [agent, bashCall];
  // M33 P second repair: both results on ONE row (the sibling's block first), as older Claude Code wrote parallel calls.
  if (shape === 'one-result-row') {
    const bashBlock = bashResult.message.content[0];
    const agentBlock = agentResult(AGENT_CALL, false).message.content[0];
    return [claudeRow('user', CLAUDE_TEXT.ask, HUMAN_PROMPT, 'ask'), ...calls,
      claudeRow('user', [bashBlock, agentBlock], {}, 'both:r'), claimRow()];
  }
  // M33 P second repair: the agent's result recorded BEFORE the sibling's (`agentAnsweredFirst`).
  const results = agentAnsweredFirst ? [agentResult(AGENT_CALL, false), bashResult] : [bashResult, agentResult(AGENT_CALL, false)];
  return [claudeRow('user', CLAUDE_TEXT.ask, HUMAN_PROMPT, 'ask'), ...calls, ...results, claimRow()];
}

/** A typed TaskOutput poll of the agent's task and its completed result (C-02 M33 D's typed shape). */
export const pollRows = (task = AGENT) => [claudeRow('assistant', [{ type: 'tool_use', id: POLL, name: 'TaskOutput',
  input: { task_id: task, block: true } }], {}, 'poll'),
claudeRow('user', [{ type: 'tool_result', tool_use_id: POLL, content: `<task_id>${task}</task_id>\n<status>completed</status>` }],
  { toolUseResult: { retrieval_status: 'success', task: { status: 'completed', task_id: task, output: 'done' } } }, 'poll:r')];

/**
 * A BACKGROUND Agent whose completion the parent received through a typed TaskOutput completion BEFORE its claim; its
 * completion notification is recorded only after the claim (`notification`), or never. `ownPassFirst`: the parent ran
 * its own passing suite before launching.
 */
export function claudePolledRows({ notification = true, ownPassFirst = false, task = AGENT } = {}) {
  return [claudeRow('user', CLAUDE_TEXT.ask, HUMAN_PROMPT, 'ask'), ...(ownPassFirst ? parentTestRows(true) : []),
    agentCall(AGENT_CALL, true), agentResult(AGENT_CALL, true), ...pollRows(task), claimRow(),
    ...(notification ? [agentNotification(AGENT_CALL)] : [])];
}

/**
 * A BACKGROUND Agent with NO receipt: the parent claims mid-turn (`claim: 'mid'`, then commits), or at the end of its
 * turn after its own passing run (`claim: 'end'`); the agent's completion is never recorded.
 */
export function claudeUnreceivedRows({ claim = 'mid' } = {}) {
  return [claudeRow('user', CLAUDE_TEXT.ask, HUMAN_PROMPT, 'ask'), agentCall(AGENT_CALL, true), agentResult(AGENT_CALL, true),
    ...(claim === 'mid'
      ? [claudeRow('assistant', [{ type: 'text', text: CLAUDE_RUNS.midClaim }], {}, 'mid'),
        ...bash('toolu_01SyntheticCommitP0001', 'git commit -am fix', '[main 1234567] fix')]
      : [...parentTestRows(true), claimRow()])];
}

/** The agent's own recording: its brief, its own test run (passing or failing), its closing statement. */
export function claudeAgentTestRows({ passing = true } = {}) {
  return [agentRow('user', CLAUDE_TEXT.brief, 'brief'),
    agentRow('assistant', [bashUse('toolu_agent_test', 'npm test')], 'test'),
    agentRow('user', [{ type: 'tool_result', tool_use_id: 'toolu_agent_test', ...(passing ? {} : { is_error: true }),
      content: passing ? CLAUDE_RUNS.agentPass : CLAUDE_RUNS.agentFail }], 'test:r'),
    agentRow('assistant', [{ type: 'text', text: CLAUDE_TEXT.helperSaid }], 'said')];
}

/** A Claude projects tree: the parent recording and its agent's sidechain recording. Returns { dir, projects, parent }. */
export async function claudeTree(parentRows, agentRows = claudeAgentRows()) {
  const dir = await realpath(await mkdtemp(join(tmpdir(), 'sonah-m33-p-claude-')));
  const projects = join(dir, 'projects');
  const slug = join(projects, '-srv-synthetic-p');
  await mkdir(join(slug, SID, 'subagents'), { recursive: true });
  const parent = join(slug, `${SID}.jsonl`);
  await writeFile(parent, jsonl(parentRows), { mode: 0o600 });
  await writeFile(join(slug, SID, 'subagents', `agent-${AGENT}.jsonl`), jsonl(agentRows), { mode: 0o600 });
  return { dir, projects, parent };
}

// ---- the probe judge --------------------------------------------------------------------------------------------------

const receipt = (eventId, role, quote) => ({ eventId, role, quote });
const ownReceipt = (candidate) => candidate.contradictedBy ?? candidate.supportedBy ?? candidate.stated
  ?? candidate.instruction ?? candidate.receipts?.[0];
const at = (prompt, id, kind) => prompt.indexOf(`[${id}] ${kind}`);

/**
 * The probe judge, deterministic. NARRATIVE: in a window showing a claim (`claims`: [{id, quote}]), propose the claim
 * contradicted by the LAST failing result (`failures`: [{id, quote}]) the prompt shows BEFORE that claim — a reviewer
 * reading the evidence in its order; nothing else. CHALLENGE: an honest challenger that REFUTES whenever its prompt
 * shows a later supersession — a passing result (`passes`: [{id, quote}]) shown after the cited failure — and upholds
 * otherwise, citing the item's own receipt.
 */
export function probeJudge({ claims, failures, passes }, seen = []) {
  return async (request) => {
    seen.push(request);
    const prompt = request.prompt ?? '';
    if (!request.challenge) {
      const proposed = [];
      for (const claim of claims) {
        const said = at(prompt, claim.id, 'AGENT SAID');
        if (said < 0) continue;
        const failure = failures.filter((f) => { const shown = at(prompt, f.id, 'RESULT'); return shown >= 0 && shown < said; })
          .sort((a, b) => at(prompt, a.id, 'RESULT') - at(prompt, b.id, 'RESULT')).at(-1);
        if (failure) proposed.push({ text: 'The agent said the parser tests pass.', stated: receipt(claim.id, 'commentary', claim.quote),
          contradictedBy: receipt(failure.id, 'observation', failure.quote) });
      }
      return { decisions: [], pivots: [], requirements: [], claims: proposed };
    }
    return { votes: request.challenge.items.map((item) => {
      const cited = item.candidate?.contradictedBy?.eventId;
      const failedAt = cited ? at(prompt, cited, 'RESULT') : -1;
      const pass = failedAt >= 0 ? passes.find((p) => at(prompt, p.id, 'RESULT') > failedAt && prompt.includes(p.quote)) : undefined;
      return pass ? { key: item.key, verdict: 'refuted', explanation: 'A later recorded run passed.',
        receipts: [receipt(pass.id, 'observation', pass.quote)] }
        : { key: item.key, verdict: 'not-refuted', explanation: 'Synthetic.', receipts: [ownReceipt(item.candidate)].filter(Boolean) };
    }) };
  };
}
export const decided = (report) => report.findings.filter((f) => f.kind === 'claim_contradicted').map((f) => f.status);
export { rm };

// ---- M33 P second repair: Claude Code shapes ---------------------------------------------------------------------------

/** An Agent (or the older Task) hand-off call, its input running it in the background (`flag`) or not. */
export const agentCallRow = ({ flag = false, name = 'Agent', id = AGENT_CALL, seed = '' } = {}) => claudeRow('assistant',
  [{ ...agentUse(id, flag), name }], {}, `${id}:call${seed}`);
/**
 * The ASYNCHRONOUS LAUNCH STUB, as Claude Code writes it whatever the call's input records: 'b2-sidecar' (the repo's B2
 * fixture's text — the visible launch line and the agentId line — with its typed sidecar), 'm33d' (the M33 D fixture,
 * Claude Code 2.1.222: `... successfully.`, the internal-ID line, a sidecar recording isAsync and status), 'typed' (a
 * sidecar recording the launch beside a visible text that does not say so), 'contradicted' (the visible launch line
 * beside a sidecar recording a completed run: L2, the typed status decides). L2: 'b2' (the
 * B2 text with NO sidecar) records no launch mode: it is declared unknown, never read from its words.
 */
export function agentStubRow({ stub = 'b2-sidecar', id = AGENT_CALL, agent = AGENT } = {}) {
  const text = stub === 'm33d' ? `Async agent launched successfully.\nagentId: ${agent} (internal ID)\nThe agent is working.`
    : stub === 'typed' ? `Started the helper.\nagentId: ${agent}`
      : `Async agent launched.\nagentId: ${agent}\nUse SendMessage to reach it.`;
  const sidecar = stub === 'm33d' ? { agentId: agent, canReadOutputFile: true, description: 'regression test', isAsync: true,
    outputFile: '/private/tmp/out', prompt: CLAUDE_TEXT.brief, resolvedModel: 'm', status: 'async_launched' }
    : stub === 'b2-sidecar' || stub === 'typed' ? { status: 'async_launched', agentId: agent, description: 'regression test' }
      : stub === 'contradicted' ? { status: 'completed', agentId: agent, content: [{ type: 'text', text: 'done' }] } : null;
  return claudeRow('user', [{ type: 'tool_result', tool_use_id: id, content: text }],
    sidecar ? { toolUseResult: sidecar } : {}, `${id}:stub:${stub}`);
}
/** A hand-off's own result that is the agent's completed REPORT (no launch stub), whatever the call's input records,
 *  with the typed sidecar Claude Code writes for it (L2: the status decides). */
export const agentReportRow = ({ id = AGENT_CALL, agent = AGENT } = {}) => claudeRow('user', [{ type: 'tool_result',
  tool_use_id: id, content: `The helper ran the suite.\nagentId: ${agent}` }], { toolUseResult: { status: 'completed',
  agentId: agent, content: [{ type: 'text', text: 'The helper ran the suite.' }] } }, `${id}:report`);
const midClaimRows = () => [claudeRow('assistant', [{ type: 'text', text: CLAUDE_RUNS.midClaim }], {}, 'mid'),
  ...bash('toolu_01SyntheticCommitP0001', 'git commit -am fix', '[main 1234567] fix')];

/**
 * M33 P second repair: an Agent/Task hand-off whose own result is the launch stub (`stub`), its input running it in the
 * background (`flag`) or — as the repo's B2 and M33 D fixtures model Claude Code — not. After the launch: 'mid' (a
 * mid-turn claim, then a commit; the completion never recorded), 'notified' (the same, then the completion
 * notification), 'polled' (a mid-turn claim, then a typed TaskOutput completion), 'end-notified' (a build, the end-of-turn
 * claim, then the notification). The agent's own run (`claudeAgentTestRows`) happened while the parent worked.
 */
export function claudeStubRows({ stub = 'b2-sidecar', flag = false, name = 'Agent', after = 'mid' } = {}) {
  const head = [claudeRow('user', CLAUDE_TEXT.ask, HUMAN_PROMPT, 'ask'), agentCallRow({ flag, name }), agentStubRow({ stub })];
  if (after === 'polled') return [...head, claudeRow('assistant', [{ type: 'text', text: CLAUDE_RUNS.midClaim }], {}, 'mid'),
    ...pollRows()];
  if (after === 'end-notified') return [...head, ...bash('toolu_01SyntheticBashP0001', 'npm run build', 'built'), claimRow(),
    agentNotification(AGENT_CALL), claudeRow('assistant', [{ type: 'text', text: 'Noted.' }], {}, 'noted')];
  return [...head, ...midClaimRows(), ...(after === 'notified' ? [agentNotification(AGENT_CALL),
    claudeRow('assistant', [{ type: 'text', text: 'Noted.' }], {}, 'noted')] : [])];
}
/** A hand-off run in the background by its input (`flag`) whose own result is the agent's completed report, then the
 *  claim: the parent received the agent's failing run before claiming. */
export const claudeFlaggedReportRows = () => [claudeRow('user', CLAUDE_TEXT.ask, HUMAN_PROMPT, 'ask'), agentCallRow({ flag: true }),
  agentReportRow(), claimRow()];

export const SEND_MESSAGE_CALL = 'toolu_01SyntheticSendP0001';
export const CONTINUE_TEXT = 'SYNTHETIC_P_CC_CONTINUE: now run the full suite.';
/**
 * M33 P second repair: an agent the parent CONTINUED (SendMessage) after its first receipt. The agent's own recording:
 * its brief, a passing lint run and its first statement; then the parent's message — a new user turn of its own
 * recording — its FAILING test run and its second statement.
 */
export function claudeContinuedAgentRows() {
  return [agentRow('user', CLAUDE_TEXT.brief, 'c:brief'),
    agentRow('assistant', [bashUse('toolu_agent_lint', 'npm run lint')], 'c:lint'),
    agentRow('user', [{ type: 'tool_result', tool_use_id: 'toolu_agent_lint', content: 'lint ok' }], 'c:lint:r'),
    agentRow('assistant', [{ type: 'text', text: 'Lint is clean.' }], 'c:said1'),
    agentRow('user', CONTINUE_TEXT, 'c:continue'),
    agentRow('assistant', [bashUse('toolu_agent_test', 'npm test')], 'c:test'),
    agentRow('user', [{ type: 'tool_result', tool_use_id: 'toolu_agent_test', is_error: true, content: CLAUDE_RUNS.agentFail }],
      'c:test:r'),
    agentRow('assistant', [{ type: 'text', text: 'The suite fails.' }], 'c:said2')];
}
/**
 * The parent's side: the hand-off received (its synchronous result, or — `background` — its launch and completion
 * notification), the claim, then a SendMessage continuing the same agent (and, background, a second notification).
 */
export function claudeContinuedRows({ background = false } = {}) {
  const send = [claudeRow('assistant', [{ type: 'tool_use', id: SEND_MESSAGE_CALL, name: 'SendMessage',
    input: { to: AGENT, message: CONTINUE_TEXT } }], {}, 'send'),
  claudeRow('user', [{ type: 'tool_result', tool_use_id: SEND_MESSAGE_CALL, content: 'Message sent.' }], {}, 'send:r')];
  return [claudeRow('user', CLAUDE_TEXT.ask, HUMAN_PROMPT, 'ask'), agentCallRow({ flag: background }),
    ...(background ? [agentStubRow(), agentNotification(AGENT_CALL)] : [agentReportRow()]), claimRow(), ...send,
    ...(background ? [claudeRow('user', `<task-notification>\n<task-id>${AGENT}</task-id>\n<tool-use-id>${AGENT_CALL}`
      + '</tool-use-id>\n<status>completed</status>\n<summary>Agent finished again</summary>\n</task-notification>',
    { origin: { kind: 'task-notification' } }, 'n2')] : []),
    claudeRow('assistant', [{ type: 'text', text: 'Sent.' }], {}, 'sent')];
}

// ---- M33 P second repair: Codex shapes --------------------------------------------------------------------------------

const H = '/root/fix_parser';
const LINT_OK = 'Process exited with code 0\nOutput:\nlint ok';
/** A SIBLING helper's encrypted message, addressed to this helper: no delivery of its parent (a stray arrival). */
export const siblingArrival = () => response({ type: 'agent_message', author: '/root/write_notes', recipient: H, id: 'sib',
  internal_chat_message_metadata_passthrough: {}, content: [{ type: 'input_text', text: header('MESSAGE', H, '/root/write_notes') },
    { type: 'encrypted_content', encrypted_content: token('sibling') }] });

/**
 * M33 P second repair: a helper that REPORTS more often than its parent assigned it work, so which report received which
 * assignment is not recorded. `shape`:
 *   'sibling-before' (N60) — a sibling's message makes the helper work and report again (its third report) after the
 *     parent's follow-up was sent, before the claim; the follow-up's own (failing) work is reported only after the claim;
 *   'sibling-after' (N61) — the sibling's message arrives after the follow-up: the follow-up's report comes before the
 *     claim, the sibling-triggered (failing) work's report after it;
 *   'extra-report' (N59) — a queued follow-up; the helper reports twice for its first assignment before the claim; the
 *     follow-up's (failing) work is reported after the claim.
 * Returns { rows, helper }.
 */
export function extraReportShape(shape) {
  const base = [rootMeta(), userAsk(TEXT.ask), said(TEXT.plan), ...exec('cmd-pass', 'npm test', TEXT.pass),
    ...spawn('spawn-fix', 'fix_parser', TOKENS.spawn)];
  const report = (text, id) => finalAnswer(H, text, id);
  if (shape === 'sibling-before') return {
    rows: [...base, report(TEXT.report, 'fa-1'), ...followup('follow-fix', 'fix_parser', TOKENS.follow),
      report('SYNTHETIC_P_NOTES: notes acknowledged.', 'fa-sib'), said(TEXT.claim), report(TEXT.report2, 'fa-2')],
    helper: ordinals([helperMeta(), arrival(H, TOKENS.spawn), said(TEXT.helperSaid), ...exec('h1', 'npm run lint', LINT_OK),
      siblingArrival(), said('SYNTHETIC_P_HELPER_NOTES: acknowledging the notes.'),
      arrival(H, TOKENS.follow, 'NEW_TASK', 'msg-2'), said(TEXT.helperMore), ...patch('edit-more', 'test/parser-more.test.js'),
      ...exec('cmd-fail', 'npm test', TEXT.fail)]) };
  if (shape === 'sibling-after') return {
    rows: [...base, report(TEXT.report, 'fa-1'), ...followup('follow-fix', 'fix_parser', TOKENS.follow),
      report(TEXT.report2, 'fa-2'), said(TEXT.claim), report('SYNTHETIC_P_NOTES: notes acknowledged.', 'fa-sib')],
    helper: ordinals([helperMeta(), arrival(H, TOKENS.spawn), said(TEXT.helperSaid), ...exec('h1', 'npm run lint', LINT_OK),
      arrival(H, TOKENS.follow, 'NEW_TASK', 'msg-2'), said(TEXT.helperMore), ...exec('h2', 'npm run lint', LINT_OK),
      siblingArrival(), said('SYNTHETIC_P_HELPER_NOTES: acting on the notes.'), ...patch('edit-notes', 'test/notes.test.js'),
      ...exec('cmd-fail', 'npm test', TEXT.fail)]) };
  return {
    rows: [...base, ...followup('follow-fix', 'fix_parser', TOKENS.follow), report(TEXT.report, 'fa-1'),
      report('SYNTHETIC_P_ADDENDUM: one more note.', 'fa-1b'), said(TEXT.claim), report(TEXT.report2, 'fa-2')],
    helper: ordinals([helperMeta(), arrival(H, TOKENS.spawn), said(TEXT.helperSaid), ...exec('h1', 'npm run lint', LINT_OK),
      arrival(H, TOKENS.follow, 'NEW_TASK', 'msg-2'), said(TEXT.helperMore), ...patch('edit-more', 'test/parser-more.test.js'),
      ...exec('cmd-fail', 'npm test', TEXT.fail)]) };
}

/**
 * M33 P second repair (N34, pinned): a MERGED message — it arrives while the helper is still working on its first
 * assignment, and the helper's single report, received BEFORE the claim, carries both. Which (queued or merged) is not
 * recorded by any identity, so the message's segment is `shared` with no next report.
 */
export function mergedMessageShape() {
  return { rows: [rootMeta(), userAsk(TEXT.ask), said(TEXT.plan), ...spawn('spawn-fix', 'fix_parser', TOKENS.spawn),
    ...sendMessage('send-fix', 'fix_parser', TOKENS.message), finalAnswer(H, TEXT.report, 'fa-1'), said(TEXT.claim)],
  helper: ordinals([helperMeta(), arrival(H, TOKENS.spawn), said(TEXT.helperSaid), arrival(H, TOKENS.message, 'MESSAGE', 'msg-2'),
    ...patch('edit-more', 'test/parser-more.test.js'), ...exec('cmd-fail', 'npm test', TEXT.fail)]) };
}

/** M33 P second repair (N41): a queued follow-up with no second report; the claim is in the NEXT request. */
export function queuedClaimLaterRows() {
  return [rootMeta(), userAsk(TEXT.ask), said(TEXT.plan), ...exec('cmd-pass', 'npm test', TEXT.pass),
    ...spawn('spawn-fix', 'fix_parser', TOKENS.spawn), ...followup('follow-fix', 'fix_parser', TOKENS.follow),
    finalAnswer(H, TEXT.report, 'fa-1'), said('SYNTHETIC_P_FIRST_IN: the first report is in.'), userAsk(TEXT.ask2), said(TEXT.claim)];
}
