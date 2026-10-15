// M33 F (helper final answers). Synthetic Codex rollouts whose inter-agent messages carry the header Codex writes,
// shared by the slicer, adapter, story and CLI tests and by the one-off request-byte capture run against an export
// of the code before this change. It imports only node built-ins, so the same file runs against both trees.
//
// The shapes follow what Codex rollouts record (shapes only; every byte here is
// invented): an inter-agent message is a `response_item` of type `agent_message` { author, recipient, content, id,
// internal_chat_message_metadata_passthrough } whose readable `input_text` block always opens with a fixed header
//   "Message Type: <TYPE>\nTask name: <task path>\nSender: <path>\nPayload:\n"
// followed by the payload. NEW_TASK and MESSAGE carry an EMPTY payload there, the real one being in an
// `encrypted_content` block; FINAL_ANSWER carries the helper's final report to its parent in plaintext.
//
// M33 F repair. Which header line names whom: `Task name` is the RECIPIENT's task path (the row's `recipient`, in
// FINAL_ANSWER, NEW_TASK and MESSAGE rows alike) and `Sender` is the AUTHOR's (the row's `author`). So a helper's
// FINAL_ANSWER in its parent's recording reads `Task name: /root` (the parent) and `Sender: /root/<helper>`; the
// helper's path is on the Sender line (the task path a same-file spawn recorded), never on the Task name line. Every
// row below is built in that shape.
import { createHash } from 'node:crypto';
import { mkdtemp, writeFile, rm, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/** A deterministic Fernet-shaped token of `length` base64url characters (lower, then upper x3, as Codex's). */
export function syntheticToken(seed, length = 640) {
  let out = 'gAAAAA';
  for (let i = 0; out.length < length; i++) out += createHash('sha256').update(`${seed}:${i}`).digest('base64url');
  return out.slice(0, length);
}

export const TOKENS = Object.freeze({
  task: syntheticToken('m33-f synthetic new task payload', 1_204),
  message: syntheticToken('m33-f synthetic message payload', 988),
  answer: syntheticToken('m33-f synthetic final answer payload', 1_512),
});

/** A secret-shaped value a helper could paste into its report: an Anthropic-style API key. */
export const SECRET = `sk-ant-api03-${'Q7x9'.repeat(20)}`;

export const TEXT = Object.freeze({
  ask: 'Split the parser work between two helpers and report back when both are done.',
  plan: 'I will hand the parser fix and the changelog entry to two helpers.',
  fixBrief: 'Fix the nested-input parser bug and add a regression test for it.',
  notesBrief: 'Write the changelog entry for the parser fix and keep it under five lines.',
  fixReport: 'Fixed the nested-input parser in src/parser.js. Added test/parser-nested.test.js; all 13 tests pass.',
  notesReport: 'Wrote the changelog entry under Unreleased. It is four lines long.',
  limitReport: 'You have hit your usage limit. Upgrade to Pro or try again in 2 hours.',
  done: 'Both helpers are done: the parser fix landed with its regression test.',
  // A late report (`lateReportRows`): the parent is asked again and makes a claim before the helper reports back.
  followUp: 'Is the parser fixed yet?',
  claim: 'The parser fix is already merged and every test passes.',
  check: 'Check what the parser helper reported.',
});

/** The readable header Codex writes in front of every inter-agent payload. */
export const header = (type, task, sender, payload = '') =>
  `Message Type: ${type}\nTask name: ${task}\nSender: ${sender}\nPayload:\n${payload}`;

const response = (payload) => ({ type: 'response_item', payload });
export const said = (text) => response({ type: 'message', role: 'assistant', content: [{ type: 'output_text', text }] });
/** A Codex compaction row: the recorder replaced the history before it, so review windows split there. */
export const compacted = () => ({ type: 'compacted', payload: { message: 'Synthetic compaction summary.' } });
export const call = (name, callId, args) => response({ type: 'function_call', name, call_id: callId,
  arguments: JSON.stringify(args) });
export const output = (callId, value) => response({ type: 'function_call_output', call_id: callId,
  output: typeof value === 'string' ? value : JSON.stringify(value) });

/** One `agent_message` row: the header text and, when given, the recorder's encrypted payload block. */
export function agentMessage(text, { encrypted = null, author = '/root/helper', recipient = '/root', id = 'msg',
  extra = {}, blocks = null } = {}) {
  return response({ type: 'agent_message', author, recipient,
    content: blocks ?? [{ type: 'input_text', text },
      ...(encrypted ? [{ type: 'encrypted_content', encrypted_content: encrypted }] : [])],
    id, internal_chat_message_metadata_passthrough: {}, ...extra });
}
/**
 * A helper's plaintext final report to its parent, as the parent's recording holds it: `Task name` is the parent (the
 * recipient, `to`, `/root` unless given), `Sender` is the helper (the author, `helper`).
 */
export const finalAnswer = (helper, payload, { to = '/root', ...opts } = {}) =>
  agentMessage(header('FINAL_ANSWER', to, helper, payload), { author: helper, recipient: to, ...opts });
/** A new task handed to a helper: its payload encrypted, as every real NEW_TASK row carries it. The helper is the
 *  recipient, so its path is the `Task name`; the parent (`from`, `/root` unless given) is the sender. */
export const newTask = (task, { from = '/root', ...opts } = {}) =>
  agentMessage(header('NEW_TASK', task, from), { encrypted: TOKENS.task, author: from, recipient: task, ...opts });
/** A message from a helper to its parent (`to`, `/root` unless given): its payload encrypted, as every real MESSAGE
 *  row carries it. `Task name` is the recipient, `Sender` the helper. */
export const message = (helper, { to = '/root', ...opts } = {}) =>
  agentMessage(header('MESSAGE', to, helper), { encrypted: TOKENS.message, author: helper, recipient: to, ...opts });

export const rootMeta = (id = 'root') => ({ type: 'session_meta', payload: { id, cwd: '/repo' } });
export const ask = (text = TEXT.ask) => response({ type: 'message', role: 'user', content: text });

/** A spawn of `task` (relative name) with its brief, and its result recording the canonical path (or `result`). */
export const spawn = (callId, task, brief, result = { task_name: `/root/${task}` }) => [
  call('spawn_agent', callId, { message: brief, task_name: task }),
  output(callId, result),
];

/**
 * The root rollout: one ask, a plan, spawns of `fix_parser` and `write_changelog`, then `reports` (rows placed after
 * the spawns), one command, and a final statement.
 */
export function rootRows(reports = [], { sessionId = 'root' } = {}) {
  return [
    rootMeta(sessionId),
    ask(),
    said(TEXT.plan),
    ...spawn('spawn-fix', 'fix_parser', TEXT.fixBrief),
    ...spawn('spawn-notes', 'write_changelog', TEXT.notesBrief),
    ...reports,
    call('exec_command', 'cmd-1', { cmd: 'npm test' }),
    output('cmd-1', 'Process exited with code 0\nOutput:\nok 13 tests'),
    said(TEXT.done),
  ];
}

/**
 * M33 F placement. A report that arrives turns after its spawn: turn 1 hands the parser fix to a helper; turn 2 asks
 * again and the parent CLAIMS the fix is in; the recorder compacts; turn 3 asks for the helper's report, and only then
 * does the helper's FINAL_ANSWER row arrive, followed by the parent's closing statement.
 */
export const lateReportRows = () => [
  rootMeta(),
  ask(),
  said(TEXT.plan),
  ...spawn('spawn-fix', 'fix_parser', TEXT.fixBrief),
  ask(TEXT.followUp),
  said(TEXT.claim),
  compacted(),
  ask(TEXT.check),
  finalAnswer('/root/fix_parser', TEXT.fixReport),
  said(TEXT.done),
];

/** Both helpers report back, in plaintext: each report is attributed to exactly one hand-off. */
export const attributedRows = () => rootRows([
  newTask('/root/fix_parser'),
  finalAnswer('/root/fix_parser', TEXT.fixReport, { id: 'msg-fix' }),
  finalAnswer('/root/write_changelog', TEXT.notesReport, { id: 'msg-notes' }),
]);

/**
 * Nothing is attached: encrypted NEW_TASK and MESSAGE rows, a report naming no hand-off of this recording, a report
 * whose task was also followed up (two hand-offs name it), and a row of an unknown message type.
 */
export const unattachedRows = () => rootRows([
  newTask('/root/fix_parser'),
  message('/root/fix_parser'),
  finalAnswer('/root/someone_else', 'I was never spawned here.', { id: 'msg-other' }),
  call('followup_task', 'follow-notes', { target: 'write_changelog', message: 'Also mention the test.' }),
  output('follow-notes', { ok: true }),
  finalAnswer('/root/write_changelog', TEXT.notesReport, { id: 'msg-notes' }),
  agentMessage(header('STATUS_UPDATE', '/root', '/root/fix_parser', 'still working'),
    { author: '/root/fix_parser', recipient: '/root' }),
]);

/** JSONL bytes of `rows`. */
export const jsonl = (rows) => rows.map((row) => typeof row === 'string' ? row : JSON.stringify(row)).join('\n') + '\n';

/**
 * M33 F. Every review request planned and sent for the synthetic final-answer cases, as `captureCase` digests
 * (cli/test/m33-fast-profile-fixture.js). `m` carries the modules of the tree under test, so the same function runs
 * against an export of base 2e05794 and against this tree: { sliceLineage, redact, sessionFromLedger, runReview,
 * planWindowRequests, captureCase, windowNarrative }. Cases:
 *   unattached — encrypted NEW_TASK and MESSAGE rows, an unattributed and an ambiguous report, an unknown type:
 *                nothing is attached, so no request byte may change;
 *   attributed — both helpers' reports attributed: the reports become quotable results, so requests change.
 */
export async function captureFinalAnswerCases(m) {
  const dir = await realpath(await mkdtemp(join(tmpdir(), 'sonah-m33-f-bytes-')));
  try {
    const narrativeOf = (session, request) => m.windowNarrative(session, request.window);
    const modules = { runReview: m.runReview, planWindowRequests: m.planWindowRequests };
    const cases = [];
    for (const [name, rows] of [['unattached', unattachedRows()], ['attributed', attributedRows()]]) {
      const file = join(dir, `rollout-2026-10-01T12-00-00-${name}.jsonl`);
      await writeFile(file, jsonl(rows), { mode: 0o600 });
      const session = m.sessionFromLedger(m.redact(await m.sliceLineage([file])).ledger, { sessionKey: `m33-f-${name}` });
      cases.push(await m.captureCase(modules, { name, session, narrativeOf }));
    }
    return cases;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
