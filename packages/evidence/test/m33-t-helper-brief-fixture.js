// M33 T (helper briefs). Synthetic Codex rollouts with helper hand-offs, shared by the adapter test, the CLI
// end-to-end test and the one-off request-byte capture run against an export of the code before this change.
// It imports only node built-ins, so the same file runs against both trees.
//
// The shapes follow what real Codex rollouts record (shapes only; every byte here is invented): a hand-off is a
// `function_call` named `spawn_agent` whose JSON arguments are { message, task_name, fork_turns? }, and whose
// message is one Fernet-style encrypted token; the helper's own recording receives the brief as an
// `agent_message` whose only readable part is a fixed header, with the payload in `encrypted_content`.
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, writeFile, rm, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/** A deterministic Fernet-shaped token of `length` base64url characters (lower, then upper x3, as Codex's). */
export function syntheticToken(seed, length = 640) {
  let out = 'gAAAAA';
  for (let i = 0; out.length < length; i++) out += createHash('sha256').update(`${seed}:${i}`).digest('base64url');
  return out.slice(0, length);
}

export const TOKENS = Object.freeze({
  fix: syntheticToken('m33-t synthetic fix-parser brief', 812),
  follow: syntheticToken('m33-t synthetic follow-up brief', 604),
  child: syntheticToken('m33-t synthetic child payload', 1_560),
});
/** M33 T repair. Readable briefs with no whitespace, 100+ characters of the base64url alphabet: plaintext, which the
 *  code before this change kept as text and which must never be called encrypted. `camel` even opens with the
 *  recorder's shape (lower, then three upper); `hex` is the redactor's pre-existing, unchanged business. */
export const READABLE_BRIEFS = Object.freeze({
  snake: 'fix_the_nested_input_parser_bug_and_add_a_regression_test_for_it_and_report_back_to_the_root_agent_when_done',
  kebab: 'fix-the-nested-input-parser-bug-and-add-a-regression-test-for-it-and-report-back-to-the-root-agent-when-done',
  camel: 'iOSAppFixTheNestedInputParserBugAndAddARegressionTestForItAndReportBackToTheRootAgentWhenDoneWithEverything',
  hex: 'a4abd4448c49562d828115d13a1fccea927f52b4d5459297f8b43e42da89238bc13626e43dcb38ddb082488927ec904fb42057443983e88585179d50551afe62',
});

export const TEXT = Object.freeze({
  ask: 'Split the parser work between two helpers and report back when both are done.',
  plan: 'I will hand the parser fix and the changelog entry to two helpers.',
  fixBrief: 'Fix the nested-input parser bug and add a regression test for it.',
  notesBrief: 'Write the changelog entry for the parser fix and keep it under five lines.',
  followBrief: 'Also rerun the parser tests once the fix is in.',
  done: 'Both helpers are done: the parser fix landed with its regression test.',
  harness: '<recommended_plugins>\nsynthetic plugin list\n</recommended_plugins>',
  childSaid: 'Reading the parser module before changing the nested-input branch.',
});

const response = (payload) => ({ type: 'response_item', payload });
const said = (text) => response({ type: 'message', role: 'assistant', content: [{ type: 'output_text', text }] });
const call = (name, callId, args) => response({ type: 'function_call', name, call_id: callId,
  arguments: JSON.stringify(args) });
const output = (callId, value) => response({ type: 'function_call_output', call_id: callId,
  output: typeof value === 'string' ? value : JSON.stringify(value) });

/**
 * The parent rollout: one ask, a plan, a spawn of `fix_parser` (encrypted, or plaintext when `encrypted` is
 * false), a plaintext spawn of `write_changelog`, an encrypted (or plaintext) follow-up to `fix_parser`, one
 * command, and a final statement. `fixMessage` and `followMessage`, when given, replace the two messages.
 */
export function rootRows({ encrypted = true, sessionId = 'root', fixMessage, followMessage } = {}) {
  return [
    { type: 'session_meta', payload: { id: sessionId, cwd: '/repo' } },
    response({ type: 'message', role: 'user', content: TEXT.ask }),
    said(TEXT.plan),
    call('spawn_agent', 'spawn-fix', { message: fixMessage ?? (encrypted ? TOKENS.fix : TEXT.fixBrief),
      task_name: 'fix_parser', fork_turns: 'none' }),
    output('spawn-fix', { task_name: '/root/fix_parser' }),
    call('spawn_agent', 'spawn-notes', { message: TEXT.notesBrief, task_name: 'write_changelog' }),
    output('spawn-notes', { task_name: '/root/write_changelog' }),
    call('followup_task', 'follow-fix', { target: 'fix_parser',
      message: followMessage ?? (encrypted ? TOKENS.follow : TEXT.followBrief) }),
    output('follow-fix', { ok: true }),
    call('exec_command', 'cmd-1', { cmd: 'npm test' }),
    output('cmd-1', 'Process exited with code 0\nOutput:\nok 12 tests'),
    said(TEXT.done),
  ];
}

/**
 * The `fix_parser` helper's own rollout, linked to `parentId`: its brief arrives as an inter-agent message whose
 * payload is encrypted, then harness context, then its first statement and one write.
 */
export function childRows({ parentId = 'root', childId = 'child-fix', taskPath = '/root/fix_parser' } = {}) {
  return [
    { type: 'session_meta', payload: { id: childId, cwd: '/repo', multi_agent_version: 'v2',
      source: { subagent: { thread_spawn: { parent_thread_id: parentId, agent_path: taskPath } } } } },
    response({ type: 'agent_message', author: '/root', recipient: taskPath, id: 'msg-1',
      internal_chat_message_metadata_passthrough: {},
      content: [{ type: 'input_text', text: `Message Type: NEW_TASK\nTask name: ${taskPath}\nSender: /root\nPayload:\n` },
        { type: 'encrypted_content', encrypted_content: TOKENS.child }] }),
    response({ type: 'message', role: 'user', content: TEXT.harness }),
    said(TEXT.childSaid),
    response({ type: 'custom_tool_call', name: 'apply_patch', call_id: 'edit-child',
      input: '*** Begin Patch\n*** Add File: test/parser-nested.test.js\n+// nested input regression\n*** End Patch' }),
    response({ type: 'custom_tool_call_output', call_id: 'edit-child', output: 'Done.' }),
  ].map((row, ordinal) => ({ ordinal, ...row }));
}

/** JSONL bytes of `rows`. */
export const jsonl = (rows) => rows.map((row) => JSON.stringify(row)).join('\n') + '\n';

/** The delegate events of a session without the two plain fields this change adds: what the adapter emitted before. */
export function withoutHelperFields(session) {
  const events = session.events.map((event) => {
    if (event.kind !== 'invocation' || event.operation !== 'delegate') return event;
    const { taskName: _task, briefEncrypted: _encrypted, ...rest } = event;
    return rest;
  });
  const copy = Object.assign(Object.create(Object.getPrototypeOf(session)), session, { events });
  copy.byId = new Map(events.map((event) => [event.id, event]));
  return copy;
}

/**
 * M33 T repair. Every review request planned and sent for the synthetic helper cases, as `captureCase` digests
 * (cli/test/m33-fast-profile-fixture.js). `m` carries the modules of the tree under test, so the same function
 * runs against an export of base 23afc8a and against this tree: { sliceLineage, redact, sessionFromLedger,
 * loadSessionEvidence, runReview, planWindowRequests, captureCase, windowNarrative }. Cases:
 *   encrypted — encrypted spawn and follow-up, a plaintext spawn, one command;
 *   plaintext — the same session with every brief in plaintext;
 *   readable  — readable briefs with no whitespace (snake_case spawn, camelCase follow-up), which base kept as text;
 *   linked    — the encrypted session with its linked `fix_parser` helper, through loadSessionEvidence.
 */
export async function captureHelperCases(m) {
  const dir = await realpath(await mkdtemp(join(tmpdir(), 'sonah-m33-t-bytes-')));
  try {
    const narrativeOf = (session, request) => m.windowNarrative(session, request.window);
    const modules = { runReview: m.runReview, planWindowRequests: m.planWindowRequests };
    const sliced = async (name, rows) => {
      const file = join(dir, `rollout-2026-10-01T12-00-00-${name}.jsonl`);
      await writeFile(file, jsonl(rows), { mode: 0o600 });
      return m.sessionFromLedger(m.redact(await m.sliceLineage([file])).ledger, { sessionKey: `m33-t-${name}` });
    };
    const cases = [];
    for (const [name, rows] of [['encrypted', rootRows()], ['plaintext', rootRows({ encrypted: false })],
      ['readable', rootRows({ fixMessage: READABLE_BRIEFS.snake, followMessage: READABLE_BRIEFS.camel })]])
      cases.push(await m.captureCase(modules, { name, session: await sliced(name, rows), narrativeOf }));
    const linkedDir = join(dir, 'linked');
    await mkdir(linkedDir);
    const root = join(linkedDir, 'rollout-2026-10-01T12-00-00-root.jsonl');
    await writeFile(root, jsonl(rootRows()), { mode: 0o600 });
    await writeFile(join(linkedDir, 'rollout-2026-10-01T12-00-01-child.jsonl'), jsonl(childRows()), { mode: 0o600 });
    const ledger = await m.loadSessionEvidence([root], { recordingRoots: { codex: linkedDir }, reviewLinkedChildren: true });
    cases.push(await m.captureCase(modules, { name: 'linked',
      session: m.sessionFromLedger(ledger, { sessionKey: 'm33-t-linked' }), narrativeOf }));
    return cases;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
