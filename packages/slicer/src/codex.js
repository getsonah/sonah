// Codex adapter.
//
// Codex rollouts are a different shape from Claude Code, and the differences are not cosmetic:
//
//   - Records are {type, timestamp, payload}. The interesting ones are `response_item`, whose
//     payload carries its own type: message | reasoning | function_call | function_call_output |
//     custom_tool_call | custom_tool_call_output.
//   - A message's `content` is a STRINGIFIED Python-ish list — `[{'type': 'input_text', 'text': …}]`
//     — with single quotes. It is not JSON and JSON.parse rejects it.
//   - Edits arrive as `apply_patch` with a `*** Begin Patch / *** Update File: <path>` body, not as
//     structured file_path arguments.
//   - **Codex reports exit codes.** `Process exited with code 0` is in the output text. Claude Code
//     transcripts have no exit codes at all, so this is strictly better evidence and the outcome
//     detector should prefer it over output-tail pattern matching.
//   - `reasoning` payloads are encrypted and carry nothing usable. Dropped whole.
//
// Everything here normalises into the same record stream `buildEvents` already consumes, so
// nothing downstream needs knowledge that Codex exists.

import { recordingStream } from './recording-stream.js';
import { createInterface } from 'node:readline';
import { posix } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { readExecCalls, execResults, duplicateJsonKeys, CODEX_CAPTURE_REASONS as REASON }
  from './codex-exec.js';
import { strictJson } from './strict-json.js';
import { isDelegationTool } from './delegation.js';
import { readAgentMessage, agentMessageArrival, INTER_AGENT_COUNTS, AGENT_REPORT_RECORD } from './inter-agent.js';
import { AGENT_ARRIVAL_RECORD } from './helper-deliveries.js';
import { recordingIdentity } from './recording-identity.js';
import { recordedParsedCmd, parseUnifiedHunks } from './recorded.js';
import { MARK_SOURCES, ACTION_PROVENANCE } from './events.js';
import { LABELS, LABEL_BASIS, LABEL_GAPS, MARKERS, LINEAGE_ROLES, labelOf, applyLabel } from './labels.js';
import { PRIVATE_LABEL, textOf } from './records.js';
import { isWhollyElements } from './harness-context.js';

// C-02 M33 native-first. The paginated `item_completed` row carries exactly these fields.
const ITEM_ROW_FIELDS = Object.freeze(['type', 'item', 'completed_at_ms', 'started_at_ms', 'thread_id', 'turn_id']);
// The item families whose native records replace a wrapper's parsed inner calls, keyed by the
// parsed tool name. A poll (`write_stdin`) continues a command; it is never an item of its own.
const NATIVE_FAMILIES = Object.freeze(['command', 'file', 'mcp']);
const ITEM_FAMILY = Object.freeze({ CommandExecution: 'command', FileChange: 'file', McpToolCall: 'mcp' });
const familyOf = (name) => typeof name !== 'string' ? null
  : ['exec_command', 'shell', 'local_shell'].includes(name) ? 'command'
    : name === 'apply_patch' ? 'file'
      : /^mcp__[^_].*__[^_]/.test(name) ? 'mcp' : null;
// An argv runs one script only as exactly [shell, -lc|-c, script] (C-02 shell-family rule).
const SHELL_ARGV0 = /^(?:(?:\/usr\/local\/bin|\/usr\/bin|\/bin)\/)?(?:bash|zsh|sh)$/;
const shellScript = (argv) => Array.isArray(argv) && argv.length === 3 && typeof argv[0] === 'string'
  && SHELL_ARGV0.test(argv[0]) && ['-lc', '-c'].includes(argv[1])
  && typeof argv[2] === 'string' && argv[2].length > 0 ? argv[2] : null;
// Wrappers whose turn is not one exact recorded turn share this bucket; no native item is in it.
const NO_EXACT_TURN = Symbol('no exact turn');
// A record position reserved for the native item recorded on that row; filled after the scan.
const NATIVE_SLOT = 'codex-native-slot';

/** A strict-key paginated item row with a nonempty turn: the stream this recording persists. */
function paginatedItemRow(payload, raw) {
  return payload?.type === 'item_completed' && keysWithin(payload, ITEM_ROW_FIELDS)
    && typeof payload.turn_id === 'string' && payload.turn_id.length > 0
    && typeof payload.thread_id === 'string' && payload.thread_id.length > 0
    && typeof payload.item?.type === 'string' && !duplicateJsonKeys(raw);
}

/**
 * C-02 M33 native-first: does this recording's OWN thread persist the paginated item stream? Read
 * before the main scan, because a wrapper's inner calls are resolved as its result row arrives and
 * the mode must not depend on where the first item row happens to sit. Identity is observed from
 * the same session_meta rows, in the same way, as the main scan does.
 */
async function ownPaginatedItemStream(file, byteEnd = null) {
  const identity = recordingIdentity('codex');
  const threads = new Set();
  const rl = createInterface({ input: recordingStream(file, byteEnd), crlfDelay: Infinity });
  for await (const raw of rl) {
    if (!raw.trim()) continue;
    let d;
    try { d = JSON.parse(raw); } catch { continue; }
    if (!d || typeof d !== 'object' || Array.isArray(d)) continue;
    if (d.type === 'session_meta') identity.observe(d, { repeatedKeys: duplicateJsonKeys(raw) });
    else if (d.type === 'event_msg' && d.payload?.type === 'item_completed'
      && EVENT_ITEMS.has(d.payload?.item?.type) && paginatedItemRow(d.payload, raw))
      threads.add(d.payload.thread_id);
  }
  const own = identity.value();
  return !own.identityConflict && typeof own.sessionId === 'string' && threads.has(own.sessionId);
}

/**
 * M5 (C-02 "M5 Codex human channel"). A rollout whose own thread persists the paginated
 * item stream (`ownPaginatedItemStream`) types every input its thread received from the user as a `UserMessage` item,
 * and records the same input as a `role=user` message the model was sent. Each typed item of the own thread names the
 * one message carrying its words verbatim: the item's text (its `text` parts, joined) is that message's text (its text
 * blocks, joined) or exactly one of its text blocks (the others then being the harness's image wrappers). Of the unnamed
 * messages that carry them, the nearest in recorded order is named (the earlier one on a tie): an item is recorded
 * beside the message it types, and a harness re-sending the same words (after a compaction) leaves a copy farther away.
 * Every named message is marked `codexUserMessage: true`; every other `role=user` message the stream covers `false` — it
 * is context the harness sent, whatever its words. An item of the own thread that is not a strict row, has unreadable
 * text, or names no message is a typed human input this reader could not place: it is counted (the returned number) and
 * declared by the caller as an unsupported message, never silently. Items of another thread are not this thread's
 * input. Pure; reads no wording.
 *
 * Review finding M5-typed-scope-whole-rollout-silent-loss: the stream decides by absence only where it recorded. When
 * its first row (`streamAt`, the own thread's first item row) precedes the model's first output (`modelOutputAt`: an
 * assistant message, a reasoning row or a tool call, as read), or the model never spoke, it recorded the whole rollout:
 * every unnamed message is context. When the model spoke first, the rows before the stream's first row are a stretch of
 * turns it did not record — a segment written before the recorder typed its human channel (a resumed older session:
 * its opening ask, too, precedes the model's first output), or history read alone that another thread recorded — so an
 * unnamed message there is left unmarked, and the declared structural fallback decides it, counted (records.js
 * `codexTurnBasis`); every message after the stream's first row keeps the typed decision.
 */
function markCodexUserMessages(items, messages, ownThread, { modelOutputAt = null, streamAt = null } = {}) {
  let unread = 0;
  const named = new Set();
  for (const typed of items) {
    if (typeof ownThread !== 'string' || typed.threadId !== ownThread) continue;
    const parts = Array.isArray(typed.item?.content) ? typed.item.content : null;
    const texts = parts?.filter((part) => part?.type === 'text');
    if (!typed.strict || !parts || !texts.every((part) => typeof part.text === 'string')) { unread++; continue; }
    const words = texts.map((part) => part.text).join('');
    let best = null;
    for (const message of messages) {
      if (named.has(message)) continue;
      const carries = message.texts.join('') === words || (words !== '' && message.texts.includes(words));
      if (carries && (best === null || Math.abs(message.line - typed.line) < Math.abs(best.line - typed.line)))
        best = message;
    }
    if (best === null) { unread++; continue; }
    named.add(best);
    // M34 labels: where the item's words are exactly one of several text blocks, that block is the human's and the others
    // are the harness's (its image wrappers, an injected context part); and a typed item recorded in a turn that had
    // already recorded other items was submitted while the agent worked (`queued`).
    if (best.texts.join('') !== words) best.raw.codexHumanBlock = best.blockIndex[best.texts.indexOf(words)];
    if (typed.queued === true) best.raw.codexQueued = true;
  }
  const streamFirst = modelOutputAt === null || (streamAt !== null && streamAt < modelOutputAt);
  const covered = (message) => streamFirst || (streamAt !== null && message.line > streamAt);
  for (const message of messages) {
    if (named.has(message)) message.raw.codexUserMessage = true;
    else if (covered(message)) message.raw.codexUserMessage = false;
  }
  return unread;
}

/** M34 labels: the task path Codex records for a root thread, under which every helper's path is nested. */
const CODEX_ROOT_PATH = '/root';
/** M34 labels: Codex's question tools, synchronous (its output carries the answer) and asynchronous (the answer arrives
 *  as a later message with no typed link to the call: a counted gap). */
const CODEX_QUESTION = /(?:^|\.)request_user_input$/;
const CODEX_QUESTION_ASYNC = /(?:^|\.)request_user_input_async$/;

/**
 * M34 labels (C-02 "Slice-time labels"). Codex's one labelling function, over a rollout's records in
 * recorded order, by the rollout's own structure only:
 *   - a `role=user` message a typed `UserMessage` item names → human (where the item names one of several text blocks,
 *     that block; the others are harness), `queued` when its item's turn had already recorded another item; a message
 *     the typed channel covers but names no item for → harness; a message no typed channel covers (a rollout with no
 *     item stream) → the declared legacy fallback (only top-level elements → harness, else human), each message it
 *     sets aside as harness counted (`legacy_recorder`, as M5 counted them);
 *   - the first human message after a typed `turn_aborted` carries `after_interrupt`, linked to that row;
 *   - assistant text → thought; a call → action; its output → observation, except a synchronous `request_user_input`
 *     output, which carries the human's answer → human + answer (M34 labels review, F4: its text is the recorder's, with
 *     no typed answer field, so events.js declares the call's answer unread rather than reading it); an asynchronous
 *     question's answer has no typed link → a counted gap (`answer_unrecorded`);
 *   - a compaction → harness + compaction; a `turn_aborted` → harness; a helper's report → observation; an arrival → the
 *     inter-agent label its author gave it (reader, `agentMessageLabel`).
 * Developer and system messages, encrypted reasoning and inter-agent messages kept as no record are counted by the
 * reader. Returns the counted gaps that belong to no record.
 */
export function labelCodexRecords(records, lineage) {
  const L = LABELS, B = LABEL_BASIS, M = MARKERS, G = LABEL_GAPS;
  const extra = [];
  const calls = new Map();
  let interrupted = null;
  const human = (basis, markers, gap = null) => {
    const all = [...markers];
    let links = null;
    if (interrupted !== null) { all.push(M.afterInterrupt); links = { interrupted }; interrupted = null; }
    return labelOf(L.human, basis, { markers: all, gap, links });
  };
  const message = (d) => {
    const blocks = Array.isArray(d?.message?.content) ? d.message.content : [];
    const queued = d?.codexQueued === true ? [M.queued] : [];
    if (d?.codexUserMessage === true) {
      if (!Number.isSafeInteger(d.codexHumanBlock)) return human(B.codexUserMessage, queued);
      const own = human(B.codexUserMessage, queued);
      return { parts: blocks.map((block, i) => (i === d.codexHumanBlock ? own
        : block?.type === 'text' ? labelOf(L.harness, B.codexContext) : own)) };
    }
    if (d?.codexUserMessage === false) return labelOf(L.harness, B.codexContext);
    return isWhollyElements(textOf(d)) ? labelOf(L.harness, B.legacyFallback, { gap: G.legacyRecorder })
      : human(B.legacyFallback, []);
  };
  for (const rec of records) {
    const d = rec.raw;
    let value;
    if (rec.kind === 'compaction') value = labelOf(L.harness, B.compactBoundary, { markers: [M.compaction] });
    else if (rec.kind === TURN_ABORTED.record) { value = labelOf(L.harness, B.codexTurnAborted); interrupted = rec.line; }
    else if (rec.kind === AGENT_REPORT_RECORD) value = labelOf(L.observation, B.codexChildReport);
    else if (rec.kind === AGENT_ARRIVAL_RECORD) value = rec.codexLabel ?? labelOf(null, B.originOther,
      { gap: G.originUnknown });
    else if (rec.kind === 'assistant') {
      const blocks = Array.isArray(d?.message?.content) ? d.message.content : [];
      const parts = blocks.map((block) => {
        if (block?.type === 'tool_use') {
          const name = block.sourceName ?? block.name;
          calls.set(JSON.stringify(block.id), name);
          if (typeof name === 'string' && CODEX_QUESTION_ASYNC.test(name)) extra.push({ gapOnly: G.answerUnrecorded });
          return labelOf(L.action, B.toolUse);
        }
        if (block?.type === 'text' && typeof block.text === 'string') return labelOf(L.thought, B.assistantText);
        return labelOf(null, B.assistantText, { gap: G.unknownBlock });
      });
      value = parts.length === 1 ? parts[0] : { parts };
    } else if (rec.kind === 'user') {
      const blocks = Array.isArray(d?.message?.content) ? d.message.content : [];
      if (blocks.some((block) => block?.type === 'tool_result')) {
        value = { parts: blocks.map((block) => {
          if (block?.type !== 'tool_result') return labelOf(null, B.toolResult, { gap: G.unknownBlock });
          const name = calls.get(JSON.stringify(block.tool_use_id));
          return typeof name === 'string' && CODEX_QUESTION.test(name)
            ? labelOf(L.human, B.askAnswer, { markers: [M.answer], links: { answerTo: block.tool_use_id } })
            : labelOf(L.observation, B.toolResult);
        }) };
        if (value.parts.length === 1) value = value.parts[0];
      } else value = message(d);
    } else value = labelOf(null, B.codexContext, { gap: G.unknownRow });
    delete rec.codexLabel;
    applyLabel(rec, value, lineage);
  }
  return extra;
}

/**
 * Review finding M5-fallback-population-mischaracterized. Whether the recorder DECLARES its typed human channel for this
 * rollout: every `session_meta` row of the own thread (`payload.id` is the recording's own id) records
 * `history_mode: "paginated"` — the history mode whose rollouts persist the paginated item stream, and with it a
 * `UserMessage` item for every input the thread receives from the user — and none repeats a key. Read only where the
 * stream itself cannot show it: a rollout in which no turn ran (no `task_started` row, no model output) has no item to
 * record, so the declaration alone types its human channel, and a message there that no item names is the session's
 * opening context. A conflicting identity, a missing own row or any other value declares nothing. Pure.
 */
function declaresTypedChannel(metas, ownThread) {
  if (typeof ownThread !== 'string') return false;
  const own = metas.filter((meta) => meta.id === ownThread);
  return own.length > 0 && own.every((meta) => !meta.repeated && meta.historyMode === 'paginated');
}

/** Codex tool names → the canonical names the event builder already understands. */
const TOOL_ALIAS = {
  exec_command: 'Bash', shell: 'Bash', local_shell: 'Bash', run_terminal_cmd: 'Bash',
  apply_patch: 'Edit', str_replace_editor: 'Edit',
  read_file: 'Read', view_file: 'Read',
  write_file: 'Write', create_file: 'Write',
};

// C-02: Codex writes a command's exit only in the response header before its first `Output:`
// line (openai/codex codex-rs/core/src/tools/context.rs `response_header`): an optional chunk
// ID, the wall time, the exit OR running session, an optional token count. The same words
// after `Output:`, in a trailer or without that header are the command's own output.
// Integers are canonical, as Rust prints them: no signed zero, no leading zero.
const NATIVE_HEADER = [/^Chunk ID: \S+$/, /^Wall time: \d+(?:\.\d+)? seconds$/,
  /^Process exited with code (0|-?[1-9]\d*)$/, /^Process running with session ID (0|[1-9]\d*)$/, /^Original token count: \d+$/];
function nativeHeader(text) {
  const lines = text.split('\n');
  const end = lines.indexOf('Output:');
  if (end < 0) return null;
  let next = 0; let exit = null; let wall = false; let session = null;
  for (const line of lines.slice(0, end)) {
    const at = NATIVE_HEADER.findIndex((pattern, index) => index >= next && pattern.test(line));
    if (at < 0) return null;
    next = at + 1;
    if (at === 1) wall = true;
    if (at === 2) exit = Number(NATIVE_HEADER[2].exec(line)[1]);
    if (at === 3) session = Number(NATIVE_HEADER[3].exec(line)[1]);
  }
  if (!wall || (exit !== null) === (session !== null)) return null;
  if (exit !== null) return Number.isSafeInteger(exit) ? { exit } : null;
  return Number.isSafeInteger(session) ? { session } : null;
}
// C-02: shell-family tools and apply_patch format their result with a different native
// header (codex-rs/core/src/tools/mod.rs `format_exec_output_for_model`).
const SHELL_HEADER = [/^Exit code: (0|-?[1-9]\d*)$/, /^Wall time: \d+(?:\.\d+)? seconds$/, /^Total output lines: \d+$/];
function shellHeaderExit(text) {
  const lines = text.split('\n');
  const end = lines.indexOf('Output:');
  if (end < 2 || end > 3 || !SHELL_HEADER[1].test(lines[1]) || (end === 3 && !SHELL_HEADER[2].test(lines[2]))) return null;
  const exit = Number(SHELL_HEADER[0].exec(lines[0])?.[1] ?? NaN);
  return Number.isSafeInteger(exit) ? exit : null;
}
// Which native header a direct result may carry, by the recorded tool name.
const headerOf = (name) => /^(?:functions\.)?(?:exec_command|write_stdin)$/.test(name) ? 'unified'
  : /^(?:functions\.)?(?:shell|local_shell|container\.exec|apply_patch)$/.test(name) ? 'shell' : null;
const headerExit = (text, header) => header === 'unified' ? nativeHeader(text)?.exit ?? null
  : header === 'shell' ? shellHeaderExit(text) : null;
const PATCH_FILE = /^\*\*\* (?:Update|Add|Delete) File: (.+)$/gm;
const METADATA_ROWS = new Set(['turn_context', 'world_state', 'token_usage_record',
  'inter_agent_communication_metadata']);
const EVENT_NOTIFICATIONS = new Set(['token_count', 'item_completed', 'task_started',
  'task_complete', 'thread_settings_applied', 'agent_message', 'patch_apply_end']);
const EVENT_ITEMS = new Set(['CommandExecution', 'FileChange', 'McpToolCall', 'Extension',
  'CollabAgentToolCall', 'SubAgentActivity', 'ContextCompaction', 'ImageView',
  'UserMessage', 'AgentMessage', 'Reasoning', 'WebSearch']);
/** D68 (C 4): the native items that record a web search the agent ran: a `WebSearch` item (its query and action; the
 *  recorder kept no result) and a `web.search` Extension item (its query, action and results). Each is an action of its
 *  own row when its shape is clean, else a counted unsupported-shape gap. Never an inventory family (no wrapper
 *  dispatches one). */
const isWebSearchItem = (item) => item?.type === 'WebSearch' || (item?.type === 'Extension' && item?.kind === 'web.search');
const keysWithin = (value, names) => value && typeof value === 'object'
  && !Array.isArray(value) && Object.keys(value).every((key) => names.includes(key));
// C-02 M33 (4): Codex persists `TurnAbortedEvent` (protocol.rs) as event_msg `turn_aborted`. Only
// its closed reason enum is read; `error`, timestamps and duration are shape-checked, never read.
const TURN_ABORTED = Object.freeze({
  type: 'turn_aborted',
  record: 'interrupt',
  // The closed source that makes its mark a typed interrupt boundary (events.js MARK_SOURCES).
  markSource: MARK_SOURCES.codexTurnAborted,
  reasons: Object.freeze(['interrupted', 'replaced', 'review_ended', 'budget_limited']),
  fields: Object.freeze(['type', 'turn_id', 'reason', 'error', 'started_at', 'completed_at', 'duration_ms']),
  times: Object.freeze(['started_at', 'completed_at', 'duration_ms']),
  errorFields: Object.freeze(['message', 'codex_error_info']),
});
/** A strict-key turn_aborted row with a nonempty turn and a typed reason; anything else is a gap. */
function turnAbortedBoundary(payload, raw) {
  if (!keysWithin(payload, TURN_ABORTED.fields) || payload.type !== TURN_ABORTED.type
    || duplicateJsonKeys(raw)
    || typeof payload.turn_id !== 'string' || !payload.turn_id
    || typeof payload.reason !== 'string' || !TURN_ABORTED.reasons.includes(payload.reason)) return false;
  if (TURN_ABORTED.times.some((field) => Object.hasOwn(payload, field)
    && payload[field] !== null && !Number.isSafeInteger(payload[field]))) return false;
  // JSON has no undefined: `error` is absent, null, or an ErrorEvent object.
  return payload.error == null
    || !!keysWithin(payload.error, TURN_ABORTED.errorFields) && typeof payload.error.message === 'string';
}

// A FileChange path is usable as a join key only after it is reduced to one repository-relative path. D90 (owner
// decision 2026-10-15): whatever file it names (a credential-shaped one was never a key before), and nothing scans it
// or reads what its characters say (a redaction mark in it is part of the path as recorded).
function safeChangePath(raw, cwd) {
  if (typeof raw !== 'string' || !raw || raw.length > 4096 || !posix.isAbsolute(cwd)
    || raw.includes('\0') || raw.includes('\\')
    || raw.startsWith('~') || raw.includes('://')) return null;
  let path = raw;
  if (posix.isAbsolute(path)) {
    if (!posix.isAbsolute(cwd)) return null;
    const root = posix.normalize(cwd);
    path = posix.relative(root, posix.normalize(path));
  }
  if (!path || path === '.' || path.startsWith('/') || path.split('/').includes('..')) return null;
  path = posix.normalize(path);
  return !path || path === '.' || path.startsWith('../') ? null : path;
}

/** D68 (C 1; C-02 "M36 recorded facts"): what a FileChange update's `unified_diff` gives its change: the recorder's
 *  line-numbered hunks (`parseUnifiedHunks`), or, for a diff they cannot be read from, a mark that the recorder recorded
 *  hunks Sonah did not carry (`recordedHunksUnread`: the facts say `withheld`), never silence. */
const recordedUpdate = (diff) => {
  const recordedHunks = parseUnifiedHunks(diff);
  return recordedHunks ? { recordedHunks } : { recordedHunksUnread: true };
};

function patchChangeKeys(call, cwd) {
  if (!call?.awaited || !['apply_patch', 'functions.apply_patch'].includes(call.name)) return null;
  const normalized = normalCalls(call.name, call.input);
  if (!normalized.length) return null;
  const kinds = { Write: 'add', Edit: 'update', mcp__codex__delete_file: 'delete' };
  const keys = normalized.map((entry) => {
    const kind = kinds[entry.name];
    const path = safeChangePath(entry.input?.file_path, cwd);
    return kind && path ? `${kind}\0${path}` : null;
  });
  return keys.every(Boolean) && new Set(keys).size === keys.length ? keys.sort() : null;
}

// CommandExecution uses a canonical file URL for cwd, while the call records an
// absolute path. Reject alternate spellings rather than normalizing two uncertain
// identities into one. The host's UI process ID is never a join key.
function commandExecutionCwd(raw) {
  if (typeof raw !== 'string' || raw.length > 8192) return null;
  try {
    const url = new URL(raw);
    if (url.protocol !== 'file:' || url.hostname || url.username || url.password
      || url.search || url.hash) return null;
    const cwd = fileURLToPath(url);
    return posix.isAbsolute(cwd) && pathToFileURL(cwd).href === raw ? cwd : null;
  } catch { return null; }
}

// Both halves are checked for consistency only AFTER an exact recorded call-ID join. They never establish ownership.
// D90 (owner decision 2026-10-15): nothing scans them (a redaction pass once had to leave both unchanged).
function safeCommandExecutionKey(cmd, cwd) {
  if (typeof cmd !== 'string' || !cmd || cmd.length > 1_000_000
    || typeof cwd !== 'string' || !posix.isAbsolute(cwd) || cwd.length > 8192) return null;
  return JSON.stringify([cmd, cwd]);
}

const COMMAND_EXECUTION_FIELDS = ['id', 'type', 'status', 'command', 'cwd', 'exit_code',
  'stdout', 'stderr', 'aggregated_output', 'formatted_output', 'parsed_cmd',
  'process_id', 'source', 'duration'];
function commandExecutionStatus(item) {
  if (!item || item.type !== 'CommandExecution'
    || !keysWithin(item, COMMAND_EXECUTION_FIELDS)
    || !Array.isArray(item.command) || item.command.length !== 3
    || item.command[0] !== '/bin/zsh' || item.command[1] !== '-lc'
    || typeof item.command[2] !== 'string'
    || !Number.isSafeInteger(item.exit_code) || item.exit_code < 0
    || !(item.status === 'completed' && item.exit_code === 0
      || item.status === 'failed' && item.exit_code > 0)) return null;
  return item.exit_code;
}

function sidecarChangeKeys(item, cwd) {
  if (!item || item.type !== 'FileChange' || item.status !== 'completed'
    || !keysWithin(item, ['id', 'type', 'status', 'changes', 'duration',
      'auto_approved', 'autoApproved', 'stdout', 'stderr'])) return null;
  let changes;
  if (Array.isArray(item.changes)) {
    changes = item.changes.map((change) => {
      if (!keysWithin(change, ['path', 'kind', 'diff'])
        || Object.hasOwn(change, 'diff') && typeof change.diff !== 'string'
        || !['add', 'update', 'delete'].includes(change.kind)) return null;
      return { path: change.path, kind: change.kind };
    });
  } else if (item.changes && typeof item.changes === 'object') {
    changes = Object.entries(item.changes).map(([path, change]) => {
      if (!change || typeof change !== 'object' || Array.isArray(change)
        || !['add', 'update', 'delete'].includes(change.type)) return null;
      if (change.type === 'add' && (!keysWithin(change, ['type', 'content'])
        || typeof change.content !== 'string')) return null;
      if (change.type === 'update' && (!keysWithin(change, ['type', 'unified_diff', 'move_path'])
        || typeof change.unified_diff !== 'string'
        || Object.hasOwn(change, 'move_path') && change.move_path !== null)) return null;
      if (change.type === 'delete' && !(keysWithin(change, ['type'])
        || keysWithin(change, ['type', 'content']) && typeof change.content === 'string')) return null;
      return { path, kind: change.type };
    });
  } else return null;
  if (!changes.length || changes.length > 256 || changes.some((change) => !change)) return null;
  const keys = changes.map((change) => {
    const path = safeChangePath(change.path, cwd);
    return path ? `${change.kind}\0${path}` : null;
  });
  return keys.every(Boolean) && new Set(keys).size === keys.length ? keys.sort() : null;
}

export function isCodexRollout(file) {
  return /rollout-\d{4}-\d{2}-\d{2}T/.test(file) || /\/\.codex\/sessions\//.test(file);
}

/**
 * Read a Codex rollout into the same normalised shape `readSession` produces for Claude Code.
 * @returns {Promise<{records: object[], meta: object, corrupt: number}>}
 */
export async function readCodexSession(file, { childRecording = false, noForkChildProof = null, byteEnd = null } = {}) {
  const identity = recordingIdentity('codex');
  const records = [];
  const meta = { sessionId: null, cwd: null, version: null, gitBranch: null, file, agent: 'codex' };
  const capture = { calls: 0, wrappers: 0, captured: 0, unsupported: 0, missing: 0,
    unmapped: 0, interAgentMessagesUnparsed: 0, interAgentMessagesSoleIncomplete: false,
    reasons: [], incomplete: false };
  meta.capture = capture;
  const reason = (name) => { if (!capture.reasons.includes(name)) capture.reasons.push(name); };
  // D99 (F1 guard): every row of a shape this reader does not know is one unsupported row under the shape reason, as
  // before, and is counted by its carrier (labels.js CODEX_SHAPE_CARRIERS) for the recorder census (`meta.shapeMisses`).
  const shapeMisses = {};
  const shapeMiss = (carrier) => {
    capture.unsupported++; reason(REASON.shape);
    shapeMisses[carrier] = (shapeMisses[carrier] ?? 0) + 1;
  };
  let corrupt = 0;
  let sourceRows = 0;
  let unknownRows = 0;
  let eventMessages = 0;
  // M33 F: inter-agent messages whose payload the recorder encrypted, and helper final reports read (joined later).
  let interAgentEncrypted = 0;
  let finalAnswersRead = 0;
  let childHistoryInvalid = false;
  let lastOrdinal = -1;
  let noForkOpeningRowSeen = false;
  const noFork = childRecording && noForkChildProof?.contract === 'codex-v2-no-fork/1'
    && typeof noForkChildProof.sessionId === 'string'
    && typeof noForkChildProof.parentThreadId === 'string'
    && typeof noForkChildProof.taskPath === 'string';
  const startOf = () => identity.value().historyStart ?? (noFork ? 0 : null);

  // C-02 M33 native-first. Only a recording whose own thread persists the paginated item stream
  // changes mode; every other recording keeps the static-parse and emitter rules unchanged.
  const paginated = await ownPaginatedItemStream(file, byteEnd);
  // The exact turn a wrapper was called in: the strict `task_started` row's turn_id, until that
  // turn completes, aborts, or a turn_context names another turn. Anything else is no exact turn.
  let turnKey = null;
  const turnStats = new Map();
  const statsOf = (key) => {
    const at = key ?? NO_EXACT_TURN;
    if (!turnStats.has(at)) turnStats.set(at, { inexact: false, wrappers: [],
      p: { command: 0, file: 0, mcp: 0 }, n: { command: 0, file: 0, mcp: 0 } });
    return turnStats.get(at);
  };
  // Every recorded call ID (and every candidate of a repeated-key call row): an item carrying one
  // is that call's receipt or ambiguous, never a separate recorded action.
  const recordedCallIds = new Set();
  // Every item_completed row's item.id, of any type: a native action's identity must be unique.
  const recordedItemIds = new Map();
  // M5: the typed UserMessage items of the paginated stream, and every role=user message
  // record, in recorded order; `markCodexUserMessages` names the human's messages by them after the scan.
  const typedUserMessages = [];
  const userMessages = [];
  // M5 review findings: what decides whether the stream covers a message — each session_meta row's declared history
  // mode, whether a turn started, the first model output read, and each thread's first strict item row.
  const historyModes = [];
  // M34 labels: the turns that recorded an item other than a UserMessage; and the label values of rows that are counted
  // but are no record (developer and system messages, encrypted reasoning, inter-agent messages kept as no record).
  const turnsWithItems = new Set();
  const labelled = [];
  // M34 labels: an inter-agent message by its typed author, against this thread's own recorded task path (a root thread's
  // is `/root`): from a descendant, a report (observation); from this helper's parent thread, the parent's message
  // (human, from the parent agent); from any other agent, a peer's.
  const agentMessageLabel = (author) => {
    const self = identity.value();
    const own = typeof self.taskPath === 'string' ? self.taskPath : self.nested === true ? null : CODEX_ROOT_PATH;
    // No typed author (or no own path to place it by): unlabelled, its row already counted by the inter-agent capture.
    if (typeof author !== 'string' || own === null)
      return labelOf(null, LABEL_BASIS.originOther, { gap: LABEL_GAPS.unknownRow });
    if (author.startsWith(`${own}/`)) return labelOf(LABELS.observation, LABEL_BASIS.codexChildReport);
    const parent = own.lastIndexOf('/') > 0 ? own.slice(0, own.lastIndexOf('/')) : null;
    if (parent !== null && author === parent) return labelOf(LABELS.human, LABEL_BASIS.codexParentMessage);
    return labelOf(LABELS.peer, LABEL_BASIS.originPeer);
  };
  let turnStarted = false;
  let modelOutputAt = null;
  const firstItemRow = new Map();

  // Calls stay at their original position/turn. A wrapper placeholder is filled only after its
  // completion record proves the supported unconditional prefix was reached.
  const pending = new Map();
  const wrappers = [];
  // C-02 M33 (5): every direct poll call, and the commands that polls of duplicated wrapper calls
  // named, so a poll whose own result never arrives usably still joins its command.
  const directPolls = [];
  const duplicateWrapperPollJoins = [];
  const uiFileChanges = [];
  const uiWebSearches = [];
  const uiCommandExecutions = [];
  const legacyPatchEnds = [];
  const directCalls = [];
  const toolUsesById = new Map();
  const emittedToolIds = new Set();
  const uniqueToolId = (sourceId, line) => {
    let id = sourceId;
    if (emittedToolIds.has(id)) {
      id = `sonah-duplicate-call-${line}`;
      while (emittedToolIds.has(id)) id += '-';
    }
    emittedToolIds.add(id);
    return id;
  };
  // A duplicate-key call row cannot supply a trusted call_id. Collect every lexically
  // recorded candidate only to DISQUALIFY later joins, including an earlier value that
  // JSON.parse would otherwise discard. Never use these strings as positive identities.
  const callIdsInUnsafeRow = (raw) => {
    const ids = new Set();
    for (const match of raw.matchAll(/"((?:\\.|[^"\\])*)"\s*:\s*("(?:\\.|[^"\\])*")/g)) {
      let key, value;
      try { key = JSON.parse(`"${match[1]}"`); value = JSON.parse(match[2]); } catch { continue; }
      if (key === 'call_id' && typeof value === 'string') ids.add(value);
    }
    return ids;
  };
  const waiting = new Map(); // yielded wrapper cell -> original wrapper descriptor
  const sessions = new Map(); // exec_command session id -> its accumulated synthetic result
  const resultGroups = new Map(); // synthetic result -> one captured invocation's outcomes
  const discardedResults = new Set();
  const uiMcpItems = [];
  let turn = 0;
  let nativeTurn = 0;
  let nativeCwd = null;
  let nativeCwdUnsafe = false;
  let metaCwdUnsafe = false;
  const unmatchedPoll = () => {
    // A continuation is folded into the original command only when a typed session_id
    // joined them. Display text alone cannot identify its owner or prove its outcome.
    capture.unsupported++; capture.unmapped++;
    reason(REASON.pollUnmatched); reason(REASON.unmapped);
  };
  const isPoll = (name) => name === 'write_stdin' || name === 'functions.write_stdin';
  // C-02 M33 (5): a poll whose typed session_id joined an exactly registered command, but whose
  // own result no proved emitter attributes, is that command's outcome-unknown chunk: no later
  // typed exit can prove the command. It is joined, so it is never an unmatched poll.
  const unknownChunk = (previous, owner = null) => {
    const group = resultGroups.get(previous);
    if (group && owner) owner.outcomeGroups.add(group);
    previous.raw.outcomeUnknown = true;
  };
  // The registered commands a wrapper's parsed polls name when the wrapper is called. A poll the
  // model wrote names a session it had already seen, so this is the command it addressed.
  const wrapperPollJoins = (parsed) => parsed.calls.filter((call) => isPoll(call.name))
    .map((call) => sessions.get(call.input?.session_id)).filter(Boolean);
  // A direct poll's own result row is null or not strict JSON: joined if its session is registered.
  const unusablePollResult = (desc) => {
    desc.resolved = true;
    const previous = sessions.get(desc.session);
    if (!previous) { unmatchedPoll(); return; }
    unknownChunk(previous, desc);
    capture.unmapped++; reason(REASON.unmapped);
  };

  // C-01 event identity: `nativeId` is the id the RECORDER wrote for the call (its `call_id`, or a native item's own
  // `id`), never one this reader made up (`codex-line-…`, `sonah-duplicate-call-…`): the slicer names the call by it.
  const toolRecord = (id, calls, line, sourceCallId = id, nativeId = null) => {
    const content = calls.map((call, i) => ({ type: 'tool_use', id: `${id}:${i}`, sourceCallId,
      ...(typeof nativeId === 'string' ? { nativeId } : {}), sourceLocator: { record: line, part: i }, ...call }));
    for (const use of content) toolUsesById.set(use.id, use);
    return { kind: 'assistant', line,
      raw: { type: 'assistant', message: { role: 'assistant', content } } };
  };
  const singleText = (value) => {
    if (typeof value === 'string') return value;
    if (!Array.isArray(value)) return null;
    const blocks = value.filter((b) => b && ['text', 'input_text'].includes(b.type) && typeof b.text === 'string');
    return blocks.length === 1 ? blocks[0].text : null;
  };
  // C-02 strict JSON: text that parses but repeats a key supplies no exit, error or session.
  const repeatsKeys = (value) => {
    const text = singleText(value);
    if (text == null) return false;
    const decoded = strictJson(text);
    return decoded.json && !decoded.strict;
  };
  const toolValue = (value) => {
    if (Array.isArray(value)) {
      const blocks = value.filter((b) => b && ['text', 'input_text'].includes(b.type) && typeof b.text === 'string');
      if (blocks.length === 1) return toolValue(blocks[0].text);
    }
    if (typeof value === 'string') {
      const { strict, value: parsed } = strictJson(value);
      if (strict && parsed && typeof parsed === 'object' && !Array.isArray(parsed) && typeof parsed.output === 'string'
        && (Number.isInteger(parsed.exit_code) || Number.isInteger(parsed.session_id))) return parsed;
    }
    return value;
  };
  // C-02: a code-mode tool result is a structured value. Inside a wrapper only a decoded
  // object's own fields are typed; a string is tool text, never a header or a second envelope.
  const wrapperText = (value, opts) => opts?.wrapperResult === true && opts.rawOutput !== true
    && !(value && typeof value === 'object' && !Array.isArray(value));
  const resultRecord = (id, value, line, { rawOutput = false, outcomeUnknown = false,
    visiblePayload = undefined, wrapperResult = false, header = null, envelope = true } = {}) => {
    // Keep the original carrier before the convenience result parser unwraps it.
    // Generic calls can quote only explicitly visible text or an exact wrapper emission.
    const codexVisibleOutput = visiblePayload === undefined ? value : visiblePayload;
    if (wrapperText(value, { wrapperResult, rawOutput })) rawOutput = true;
    if (!rawOutput && envelope && repeatsKeys(value)) {
      // Its owner is known and its text stays visible; its outcome is not.
      value = singleText(value); rawOutput = true; outcomeUnknown = true;
    }
    // C-02: only a command's direct output or a code-mode value may be a structured envelope;
    // any other tool's JSON-looking text (a read file, a patch report) is that tool's text.
    if (!rawOutput) value = envelope ? toolValue(value) : singleText(value) ?? value;
    const structured = value && !Array.isArray(value) && typeof value === 'object' ? value : null;
    const out = typeof structured?.output === 'string' ? structured.output : typeof value === 'string' ? value : JSON.stringify(value ?? '');
    const typedHeaderExit = !rawOutput && typeof value === 'string' ? headerExit(value, header) : null;
    const exitCode = Number.isInteger(structured?.exit_code) ? structured.exit_code : typedHeaderExit;
    const isError = structured?.isError === true || structured?.is_error === true || (exitCode != null && exitCode !== 0);
    return { kind: 'user', line, raw: { type: 'user',
      message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content: out, is_error: isError }] },
      toolUseResult: out, exitCode,
      codexVisibleOutput,
      ...(outcomeUnknown ? { outcomeUnknown: true } : {}),
    } };
  };
  function attach(id, value, line, opts, group) {
    const visiblePayload = opts?.wrapperResult
      ? (Object.hasOwn(opts, 'visiblePayload')
        ? opts.visiblePayload : { type: 'unsupported_content' })
      : value;
    if (!opts?.rawOutput && !wrapperText(value, opts))
      value = opts?.envelope === false ? singleText(value) ?? value : toolValue(value);
    const record = resultRecord(id, value, line, { ...opts, visiblePayload });
    records.push(record);
    if (group) { group.records.add(record); resultGroups.set(record, group); }
    if (Number.isInteger(value?.session_id)) sessions.set(value.session_id, record);
    // C-02: a direct exec_command's native running header names the same process id a poll uses.
    else if (opts?.header === 'unified' && opts.execSession === true && typeof value === 'string') {
      const session = nativeHeader(value)?.session;
      if (session != null) sessions.set(session, record);
    }
    return record;
  }
  // C-02 M33 native-first refreeze (lane g3): in a paginated recording a wrapper exec_command is
  // not emitted (its native item is the recorded execution), but a typed result that a proved
  // emitter attributes to it still registers its session, typed exactly as `attach` types it: only
  // a decoded object's own integer session_id. The registered result is never pushed as a record,
  // so a poll that continues it adds no observation; a later identity or replay conflict of the
  // wrapper retracts the registration (it was no observation, so it counts no unmapped result).
  function registerSession(desc, index, value, line) {
    const opts = { ...value, wrapperResult: true };
    let typed = value.value;
    if (!opts.rawOutput && !wrapperText(typed, opts)) typed = toolValue(typed);
    if (!Number.isInteger(typed?.session_id)) return;
    const record = resultRecord(`${desc.id}:session:${index}`, typed, line, opts);
    const group = { records: new Set([record]), unmapped: false, registration: true };
    desc.outcomeGroups.add(group);
    resultGroups.set(record, group);
    sessions.set(typed.session_id, record);
  }
  function continueResult(previous, value, opts, line = previous.line) {
    const next = resultRecord(previous.raw.message.content[0].tool_use_id, value, previous.line, opts);
    const before = previous.raw.toolUseResult;
    if (before) {
      const joined = before + '\n' + next.raw.toolUseResult;
      next.raw.toolUseResult = joined; next.raw.message.content[0].content = joined;
    }
    if (previous.raw.message.content[0].is_error) next.raw.message.content[0].is_error = true;
    // C-02: an unknown chunk keeps the whole command unknown; a later poll cannot clear it.
    if (previous.raw.outcomeUnknown === true) next.raw.outcomeUnknown = true;
    previous.raw = next.raw;
    const use = toolUsesById.get(next.raw.message.content[0].tool_use_id);
    if (use?.sourceLocator) use.sourceLocator.resultRecord = line;
  }
  function invalidateOutcomes(desc) {
    desc.chunksExact = false;
    for (const inner of desc.innerUses?.values() ?? [])
      for (const use of inner.uses) delete use.sourceLocator.resultRecord;
    for (const use of desc.record?.raw?.message?.content ?? [])
      if (use?.sourceLocator) delete use.sourceLocator.resultRecord;
    for (const group of desc.outcomeGroups ?? []) {
      if (group.unmapped) continue;
      group.unmapped = true;
      if (!group.registration) { capture.unmapped++; reason(REASON.unmapped); }
      for (const record of group.records) {
        discardedResults.add(record);
        const toolId = record.raw?.message?.content?.[0]?.tool_use_id;
        const use = toolUsesById.get(toolId);
        if (use?.sourceLocator) delete use.sourceLocator.resultRecord;
        for (const [id, previous] of sessions) if (previous === record) sessions.delete(id);
      }
    }
  }
  function invalidateIdentity(desc) {
    if (!desc || desc.ambiguous) return;
    desc.identityConflict = true;
    invalidateOutcomes(desc);
    if (desc.wrapperOwner) invalidateOutcomes(desc.wrapperOwner);
    for (const record of desc.resultRecords ?? []) discardedResults.add(record);
  }
  // This reader supports one canonical chunk per exec/wait call. Exact replays add no
  // emissions. Additional headerless notify records and conflicting replays remain gaps;
  // even a conflict after completion must retract previously mapped outcomes.
  function firstOutput(call, output, owner) {
    const key = JSON.stringify(output);
    if (call.outputSeen) {
      if (call.outputKey !== key) {
        reason(REASON.identity);
        call.outputConflict = true;
        if (owner) invalidateOutcomes(owner);
      }
      return false;
    }
    call.outputSeen = true; call.outputKey = key;
    return true;
  }
  function completeWrapper(desc, output, line) {
    if (desc.done || desc.failed) return;
    const blocks = typeof output === 'string' ? [{ type: 'input_text', text: output }] : output;
    const textBlock = (b) => b && ['text', 'input_text'].includes(b.type) && typeof b.text === 'string';
    if (!Array.isArray(blocks) || !blocks.length || !textBlock(blocks[0])) {
      desc.chunksExact = false;
      return;
    }
    if (!blocks.every(textBlock)) desc.chunksExact = false;
    const header = blocks[0].text;
    const cell = /^Script running with cell ID ([^\s]+)(?:\r?\n|$)/.exec(header)?.[1];
    const completed = /^Script completed(?:\r?\n|$)/.test(header);
    if (!cell && !completed) {
      desc.chunksExact = false;
      if (/^Script (?:failed|terminated)\b/.test(header)) desc.failed = true;
      return;
    }
    if (cell) {
      // Cell ownership is established by the original exec result, then fixed. Conflicting
      // cells cannot prove which wrapper a later wait completed.
      if ((desc.cell && desc.cell !== cell) || (waiting.has(cell) && waiting.get(cell) !== desc)) {
        const other = waiting.get(cell);
        if (other) other.chunksExact = false;
        desc.chunksExact = false;
        waiting.set(cell, null);
        if (desc.cell) waiting.set(desc.cell, null);
        return;
      }
      desc.cell = cell;
      waiting.set(cell, desc);
    }
    for (const block of blocks.slice(1)) if (textBlock(block)) desc.chunks.push(block);
    if (!completed) return;
    const result = execResults([blocks[0], ...desc.chunks], {
      ...desc.parsed, transportExact: desc.chunksExact && desc.waits.size === 0,
    });
    desc.done = true;
    desc.terminalLine = line;
    desc.chunks = [];
    if (desc.cell && waiting.get(desc.cell) === desc) waiting.delete(desc.cell);
    for (const [index, call] of desc.parsed.calls.entries()) {
      if (!call.awaited) {
        // C-02 M33 (5): a poll the wrapper did not await still ran and may have taken a chunk of
        // its command's output. Its call is already an unsupported action; the command's outcome
        // is unknown when its typed session_id joined it.
        const previous = isPoll(call.name) ? sessions.get(call.input?.session_id) : null;
        if (previous) unknownChunk(previous, desc);
        continue;
      }
      const value = result.results.get(index);
      if (isPoll(call.name)) {
        const previous = sessions.get(call.input?.session_id);
        if (previous && value) {
          // A later conflict invalidates the whole accumulated outcome, including any
          // intervening polls; rolling back only one chunk could manufacture success.
          const group = resultGroups.get(previous);
          if (group) desc.outcomeGroups.add(group);
          continueResult(previous, value.value, { ...value, wrapperResult: true }, line);
        } else if (previous) {
          // C-02 M33 (5): the typed session_id joined an exactly registered command, but no
          // proved emitter attributes this poll's own result. It is that command's
          // outcome-unknown chunk: no later typed exit can prove the command, and the poll
          // keeps its unmapped-result gap. It is joined, so it is not an unmatched poll.
          unknownChunk(previous, desc);
          capture.unmapped++; reason(REASON.unmapped);
        } else unmatchedPoll();
        // C-02 M33 native-first refreeze: a poll whose session_id joins no registered command
        // keeps its unmatched-poll gap in every mode, with or without the paginated item stream.
        // No native item is ever joined to it by text, order or process id.
        continue;
      }
      // C-02 M33 native-first: the native items are the recorded executions of these families.
      // Their parsed calls are neither actions nor observations here; the per-turn bound counts
      // them. Every other parsed inner tool keeps the rules below.
      if (paginated && familyOf(call.name)) {
        // Refreeze (lane g3): an exec_command whose typed result a proved emitter attributes still
        // registers its typed session_id, so a later write_stdin joins it exactly with its
        // unchanged chunk rules. The registered result is never a record of its own.
        if (call.name === 'exec_command' && value) registerSession(desc, index, value, line);
        continue;
      }
      const tools = normalCalls(call.name, call.input);
      if (!tools.length) { capture.unsupported++; reason(REASON.arguments); continue; }
      const base = desc.record.raw.message.content.length;
      const uses = tools.map((tool, i) => ({ type: 'tool_use', id: `${desc.id}:${base + i}`,
        sourceCallId: desc.id, ...(typeof desc.nativeId === 'string' ? { nativeId: desc.nativeId } : {}),
        sourceLocator: { record: desc.line, part: base + i }, ...tool }));
      desc.record.raw.message.content.push(...uses);
      for (const use of uses) toolUsesById.set(use.id, use);
      desc.innerUses ??= new Map();
      const inner = { uses, resultRecords: [] };
      desc.innerUses.set(index, inner);
      capture.captured++;
      if (!value) { capture.unmapped++; reason(REASON.unmapped); }
      else {
        const group = { records: new Set(), unmapped: false }; desc.outcomeGroups.add(group);
        uses.forEach((use) => {
          use.sourceLocator.resultRecord = line;
          inner.resultRecords.push(attach(use.id, value.value, line,
            { ...value, wrapperResult: true }, group));
        });
      }
    }
  }

  // C-02 M33 native-first: the code cell's observation is its own first output row, attributed by
  // its own call ID. A replay conflict or later identity conflict retracts it with the wrapper's
  // other outcomes; a repeated-key or absent output supplies nothing and stays unmapped.
  function attachCellOutput(desc, output, line, repeated) {
    const cell = desc.record.raw.message.content[0];
    if (repeated || output == null) { capture.unmapped++; reason(REASON.unmapped); return; }
    const blocks = Array.isArray(output) ? output : [output];
    const text = blocks.map((block) => typeof block === 'string' ? block
      : block && typeof block.text === 'string' ? block.text : '').filter(Boolean).join('\n');
    const group = { records: new Set(), unmapped: false };
    desc.outcomeGroups.add(group);
    cell.sourceLocator.resultRecord = line;
    const record = resultRecord(cell.id, text, line, { rawOutput: true, visiblePayload: output });
    records.push(record); group.records.add(record); resultGroups.set(record, group);
  }

  const rl = createInterface({ input: recordingStream(file, byteEnd), crlfDelay: Infinity });
  let line = 0;

  for await (const raw of rl) {
    line++;
    if (!raw.trim()) continue;
    let d;
    try { d = JSON.parse(raw); } catch { corrupt++; if (noFork) childHistoryInvalid = true; continue; }
    if (!d || typeof d !== 'object' || Array.isArray(d)) {
      corrupt++; if (noFork) childHistoryInvalid = true; continue;
    }
    if (noFork && !noForkOpeningRowSeen) {
      noForkOpeningRowSeen = true;
      if (d.type !== 'session_meta' || d.ordinal !== 0) childHistoryInvalid = true;
    }

    if (d.type === 'session_meta') {
      // C-02: a repeated identity key makes the recording identity conflicting.
      const metaRepeated = duplicateJsonKeys(raw);
      identity.observe(d, { repeatedKeys: metaRepeated });
      const p = d.payload ?? {};
      if (metaRepeated) metaCwdUnsafe = true;
      meta.sessionId ??= p.id ?? null;
      meta.cwd ??= p.cwd ?? null;
      meta.version ??= p.cli_version ?? null;
      historyModes.push({ id: p.id, historyMode: p.history_mode, repeated: metaRepeated });
      if (childRecording) {
        if (!Number.isSafeInteger(d.ordinal) || d.ordinal < 0) {
          if (noFork) childHistoryInvalid = true;
        } else {
          if (d.ordinal <= lastOrdinal) childHistoryInvalid = true;
          const start = startOf();
          if (start != null && d.ordinal >= start && d.ordinal > Math.max(lastOrdinal + 1, start)) childHistoryInvalid = true;
          lastOrdinal = d.ordinal;
        }
      }
      continue;
    }

    // Child rollouts can contain inherited fork history. Only the source's explicit ordinal
    // boundary identifies newly performed child work. Legacy/missing boundaries stay empty.
    if (childRecording) {
      const start = startOf();
      if (start == null || !Number.isSafeInteger(d.ordinal) || d.ordinal < 0 || d.ordinal <= lastOrdinal) {
        childHistoryInvalid = true;
        continue;
      }
      if (d.ordinal >= start && d.ordinal > Math.max(lastOrdinal + 1, start)) childHistoryInvalid = true;
      lastOrdinal = d.ordinal;
      if (d.ordinal < start) continue;
    }

    // Codex writes the PRE-compaction history alongside the replacement. That is the higher-fidelity
    // half and the one the vendor's own durable store discards.
    if (d.type === 'compacted' || d.payload?.type === 'compacted') {
      sourceRows++;
      records.push({ kind: 'compaction', line, raw: d });
      continue;
    }

    // event_msg is a parallel notification stream. In particular, agent_message may be a
    // child's report; it has no authority as a root human turn. A rollout containing only
    // this stream has no parseable source activity and is declared below as unknown schema.
    if (d.type === 'event_msg') {
      const type = d.payload?.type;
      if (type !== 'token_count') eventMessages++;
      if (type === 'task_started') turnStarted = true;
      // C-02 M33 native-first: the exact turn of the wrapper calls that follow, and the identity
      // inventory of every item row. Neither is ever an item-to-call join.
      let native = null;
      if (paginated) {
        // M5 review finding: each thread's first strict item row, where its stream starts recording.
        if (type === 'item_completed' && EVENT_ITEMS.has(d.payload?.item?.type) && paginatedItemRow(d.payload, raw)
          && !firstItemRow.has(d.payload.thread_id)) firstItemRow.set(d.payload.thread_id, line);
        if (type === 'task_started')
          turnKey = !duplicateJsonKeys(raw) && typeof d.payload.turn_id === 'string' && d.payload.turn_id
            ? d.payload.turn_id : null;
        else if (type === 'task_complete' || type === TURN_ABORTED.type) turnKey = null;
        if (type === 'item_completed' && typeof d.payload?.item?.id === 'string')
          recordedItemIds.set(d.payload.item.id, (recordedItemIds.get(d.payload.item.id) ?? 0) + 1);
        // M34 labels: a UserMessage item whose turn already recorded another item was submitted while
        // the agent worked — by the item's own typed `turn_id`, never its position (the ≤0.125 trap).
        if (type === 'item_completed' && d.payload?.item?.type === 'UserMessage')
          typedUserMessages.push({ line, threadId: d.payload.thread_id, item: d.payload.item,
            strict: paginatedItemRow(d.payload, raw),
            queued: typeof d.payload.turn_id === 'string' && turnsWithItems.has(d.payload.turn_id) });
        else if (type === 'item_completed' && typeof d.payload?.turn_id === 'string')
          turnsWithItems.add(d.payload.turn_id);
        const family = type === 'item_completed' && Object.hasOwn(ITEM_FAMILY, d.payload?.item?.type)
          ? ITEM_FAMILY[d.payload.item.type] : null;
        if (family) {
          // The item's own row position is its action's position; filled after the scan.
          const slot = { kind: NATIVE_SLOT, line, records: [] };
          records.push(slot);
          native = { family, slot, turnId: d.payload.turn_id, rowStrict: paginatedItemRow(d.payload, raw) };
        }
      }
      if (type === TURN_ABORTED.type) {
        // An interrupt boundary for the turn in progress. It proves no action's result and
        // promotes none of its text; any other shape stays an unsupported row with its gap.
        if (turnAbortedBoundary(d.payload, raw))
          records.push({ kind: TURN_ABORTED.record, line, raw: null, markSource: TURN_ABORTED.markSource });
        else { shapeMiss('turn_aborted'); }
        continue;
      }
      if (!EVENT_NOTIFICATIONS.has(type)
        || type === 'item_completed' && !EVENT_ITEMS.has(d.payload?.item?.type)) {
        shapeMiss('event_msg');
      }
      if (type === 'item_completed' && !keysWithin(d.payload,
        ['type', 'item', 'completed_at_ms', 'started_at_ms', 'thread_id', 'turn_id'])) {
        shapeMiss('item_completed');
      }
      if (type === 'item_completed' && d.payload?.item?.type === 'McpToolCall') {
        const item = d.payload.item;
        const shapeSafe = keysWithin(item, ['id', 'type', 'server', 'tool', 'arguments', 'result',
          'status', 'duration', 'pluginId', 'readOnlyHint'])
          && keysWithin(item.result, ['content', 'isError', '_meta']);
        const unsafe = !shapeSafe || duplicateJsonKeys(raw);
        if (unsafe) { shapeMiss('mcp_tool_call'); }
        uiMcpItems.push({ line, threadId: d.payload.thread_id, item, unsafe, native });
      }
      if (type === 'item_completed' && isWebSearchItem(d.payload?.item)) {
        // D68 (C 4): its position is its row's; it becomes an action after the scan, or a counted gap.
        const unsafe = duplicateJsonKeys(raw) || !keysWithin(d.payload,
          ['type', 'item', 'completed_at_ms', 'started_at_ms', 'thread_id', 'turn_id']);
        const slot = paginated ? { kind: NATIVE_SLOT, line, records: [] } : null;
        if (slot) records.push(slot);
        uiWebSearches.push({ line, threadId: d.payload.thread_id, item: d.payload.item, unsafe,
          native: slot ? { family: 'web', slot, turnId: d.payload.turn_id, rowStrict: paginatedItemRow(d.payload, raw) } : null });
      }
      if (type === 'item_completed' && d.payload?.item?.type === 'FileChange') {
        const unsafe = duplicateJsonKeys(raw) || !keysWithin(d.payload,
          ['type', 'item', 'completed_at_ms', 'started_at_ms', 'thread_id', 'turn_id']);
        if (unsafe) { shapeMiss('file_change'); }
        uiFileChanges.push({ line, threadId: d.payload.thread_id, item: d.payload.item, unsafe, native });
      }
      if (type === 'item_completed' && d.payload?.item?.type === 'CommandExecution') {
        const duplicate = duplicateJsonKeys(raw);
        const outerSafe = keysWithin(d.payload,
          ['type', 'item', 'completed_at_ms', 'started_at_ms', 'thread_id', 'turn_id']);
        const typed = commandExecutionStatus(d.payload.item) !== null;
        // C-02 M33 native-first: a native command's own typed status decides its outcome (a
        // negative exit on a failed item is a sentinel), so an otherwise strict row's untyped
        // status is declared after the scan only if the item does not become that action.
        const deferUntyped = paginated && !duplicate && outerSafe && !typed;
        if (duplicate || !outerSafe || !typed && !deferUntyped) { shapeMiss('command_execution'); }
        uiCommandExecutions.push({ line, threadId: d.payload.thread_id, item: d.payload.item,
          unsafe: duplicate || !outerSafe || !typed, deferUntyped, native });
      }
      if (type === 'patch_apply_end') {
        const unsafe = duplicateJsonKeys(raw) || !keysWithin(d.payload,
          ['type', 'call_id', 'success', 'status', 'changes']);
        if (unsafe) { shapeMiss('patch_apply_end'); }
        legacyPatchEnds.push({ line, item: { id: d.payload.call_id }, payload: d.payload, unsafe });
      }
      continue;
    }
    if (d.type === 'turn_context') {
      nativeTurn++;
      nativeCwd = d.payload?.cwd ?? null;
      nativeCwdUnsafe = duplicateJsonKeys(raw) || nativeCwd != null
        && (typeof nativeCwd !== 'string' || !posix.isAbsolute(nativeCwd));
      // C-02 M33 native-first: a turn context that names another turn, or cannot be read
      // strictly, leaves the following wrappers without one exact turn.
      if (paginated && d.payload && typeof d.payload === 'object' && Object.hasOwn(d.payload, 'turn_id')
        && (duplicateJsonKeys(raw) || d.payload.turn_id !== turnKey)) turnKey = null;
      continue;
    }
    if (METADATA_ROWS.has(d.type)) continue;
    if (d.type !== 'response_item') {
      unknownRows++; shapeMiss('row_type');
      continue;
    }
    const p = d.payload ?? {};

    // M5 review finding: the model's first output read (a message whose role a repeated key leaves unproved counts too).
    if (modelOutputAt === null && (['reasoning', 'function_call', 'custom_tool_call'].includes(p.type)
      || p.type === 'message' && (p.role === 'assistant' || duplicateJsonKeys(raw)))) modelOutputAt = line;
    if (p.type === 'reasoning') { labelled.push(PRIVATE_LABEL); continue; }   // encrypted, carries nothing usable
    if (p.type === 'agent_message') {
      // Inter-agent content can contain both text and encrypted blocks. Its author and
      // recipient cannot be mapped to a root human ask or a verified child commentary unit.
      // A duplicate JSON key could have overwritten the native row type. Keep that row in
      // the generic unsupported inventory rather than treating its parsed value as proof.
      sourceRows++;
      if (duplicateJsonKeys(raw)) {
        labelled.push(labelOf(null, LABEL_BASIS.codexContext, { gap: LABEL_GAPS.unknownRow }));
        shapeMiss('inter_agent_message'); continue;
      }
      const agentLabel = agentMessageLabel(p.author);
      // M33 F: the recorded header, read exactly (inter-agent.js). A helper's plaintext final report is kept WHOLE,
      // on this row (where the parent received it), for the join to the one hand-off it belongs to
      // (delegation-records.js); nothing bounds or masks it (D68 E, D90). A payload the recorder
      // encrypted is counted as that and never kept; anything else stays unparsed.
      const message = readAgentMessage(p);
      if (message.type === 'final_answer') {
        // Sender (the helper, confirmed by the row's author) and recipient (confirmed by the row's recipient) only
        // join; neither is evidence text. Either is null when the row does not record it the same way.
        labelled.push(agentLabel);
        records.push({ kind: AGENT_REPORT_RECORD, line, raw: { sender: message.sender, recipient: message.recipient,
          text: message.text } });
        finalAnswersRead++;
      } else if (message.type === 'encrypted') {
        interAgentEncrypted++;
        // M33 P: an encrypted NEW_TASK or MESSAGE addressed to its recipient by its own header is an ARRIVAL: the
        // work a helper received. Its token joins the one parent send that recorded the same bytes, in memory only
        // (helper-deliveries.js); the row stays counted as encrypted. A `compacted` row's copy is never read here.
        const arrival = agentMessageArrival(p);
        if (arrival) records.push({ kind: AGENT_ARRIVAL_RECORD, line, raw: arrival, codexLabel: agentLabel });
        else labelled.push(agentLabel);
      } else { capture.interAgentMessagesUnparsed++; labelled.push(agentLabel); }
      continue;
    }
    if (!['message', 'function_call', 'custom_tool_call', 'function_call_output', 'custom_tool_call_output'].includes(p.type)) {
      unknownRows++; shapeMiss('response_item');
      continue;
    }
    sourceRows++;

    if (p.type === 'message') {
      if (duplicateJsonKeys(raw)) {
        // Neither the role nor the content of a repeated-key row is trustworthy. Treat it
        // as an opaque turn boundary so later sidecars cannot reach across unknown dialogue.
        turn++;
        shapeMiss('message');
        continue;
      }
      if (p.role === 'user') turn++;
      // `developer` is harness scaffolding (sandbox policy, tool descriptions), not a human turn.
      if (p.role === 'developer' || p.role === 'system') {
        // M34 labels: harness the model was shown, counted (never a record).
        labelled.push(labelOf(LABELS.harness, LABEL_BASIS.codexDeveloper));
        continue;
      }
      if (!['user','assistant'].includes(p.role)) {
        shapeMiss('message');
        continue;
      }
      if (p.role === 'assistant' && ['analysis','reasoning'].includes(p.channel)) continue;
      const blocks = visibleContentBlocks(p.content);
      if (!blocks.length) continue;
      // A human message whose content this adapter cannot read is a missing INSTRUCTION: declared
      // as a capture gap so the review renders UNCHECKED, never as silence that could read as
      // 'unasked' (found by the 2026-09-14 review of the legacy string form).
      if (blocks.some((b) => b.type === 'unsupported_content')) { capture.unsupported++; reason(REASON.message); }
      const unknownChannel = p.role === 'assistant' && p.channel != null && !['commentary','final'].includes(p.channel);
      if (unknownChannel) { capture.unsupported++; reason(REASON.message); }
      const message = {
        kind: p.role === 'assistant' ? 'assistant' : 'user',
        line,
        // C-01 event identity: the message's item id, where the recorder wrote one (event-identity.js).
        ...(typeof p.id === 'string' ? { nativeId: p.id } : {}),
        raw: { type: p.role === 'assistant' ? 'assistant' : 'user',
          ...(unknownChannel ? { commentaryUnchecked: true } : {}),
          message: { role: p.role, content: unknownChannel ? [{ type:'unsupported_content' }] : blocks } },
      };
      records.push(message);
      if (p.role === 'user') userMessages.push({ line, raw: message.raw,
        texts: blocks.filter((b) => b.type === 'text').map((b) => b.text),
        blockIndex: blocks.map((b, i) => (b.type === 'text' ? i : -1)).filter((i) => i >= 0) });
      continue;
    }

    if (p.type === 'function_call' || p.type === 'custom_tool_call') {
      capture.calls++;
      const commandCallUnsafe = duplicateJsonKeys(raw);
      if (commandCallUnsafe) {
        shapeMiss('function_call');
        // C-02 M33 native-first: this row may be a wrapper or a direct call; its turn's
        // inventory cannot be proved complete, and none of its candidate IDs is a native action.
        if (paginated) statsOf(turnKey).inexact = true;
        for (const candidate of callIdsInUnsafeRow(raw)) {
          invalidateIdentity(pending.get(candidate));
          pending.set(candidate, { ambiguous: true });
          recordedCallIds.add(candidate);
        }
        // Keep one event for the source row, without accepting a last-wins name, input,
        // child identity or result owner from that row. The native call result is unmapped.
        const id = uniqueToolId(`codex-unverified-line-${line}`, line);
        records.push(toolRecord(id, [{ name: 'codex_unverified_call', input: {} }], line));
        continue;
      }
      const sourceId = p.call_id ?? `codex-line-${line}`;
      if (typeof p.call_id === 'string') recordedCallIds.add(p.call_id);
      // A producer call ID is an identity, not an ordering hint. Reusing it could mean a
      // replay or a distinct invocation; neither licenses assigning any result by position.
      // Direct calls still have their own recorded action, so give each duplicate a separate
      // synthetic event ID while retaining the original sourceCallId for provenance.
      const duplicate = pending.has(sourceId);
      if (duplicate) {
        invalidateIdentity(pending.get(sourceId));
        pending.set(sourceId, { ambiguous: true });
        capture.unsupported++; reason(REASON.identity);
      }
      // Keep synthetic event IDs printable: a NUL reaches a review prompt and the model
      // transport rejects that entire window. Reserve every emitted ID so a later producer ID
      // that resembles this marker still receives a distinct event identity.
      const id = uniqueToolId(sourceId, line);
      if (isDelegationTool(p.name, 'codex')) {
        // Preserve the exact supported invocation fields as delegation evidence. The brief
        // remains separate from both the parent's human asks and the child's instructions.
        // M33 T: a message that is one encrypted token is recognised in delegation.js
        // (`isEncryptedBrief`), which records the encrypted fact and never the token.
        const args = parseArgs(p.arguments ?? p.input);
        const target = ['followup_task', 'collaboration.followup_task'].includes(p.name) ? args?.target : undefined;
        const message = args?.message;
        // Keep only the exact no-history value. Missing/default and every other form remain
        // unproved; this is a typed spawn receipt, never prompt or completion prose.
        const forkTurns = ['spawn_agent', 'collaboration.spawn_agent'].includes(p.name)
          && args?.fork_turns === 'none' ? 'none' : undefined;
        // M33 F: the task name a spawn's call recorded, which Codex nests under the caller's own path. It only
        // names the helper a final report joins (inter-agent.js); it is never evidence text.
        const taskName = ['spawn_agent', 'collaboration.spawn_agent'].includes(p.name) ? args?.task_name : undefined;
        records.push({ kind: 'assistant', line, raw: { type: 'assistant', message: { role: 'assistant',
          content: [{ type: 'tool_use', id,
            sourceCallId: p.call_id ?? null, ...(typeof p.call_id === 'string' ? { nativeId: p.call_id } : {}), name: p.name,
            input: { ...(typeof target === 'string' ? { target } : {}),
              ...(typeof message === 'string' ? { message } : {}),
              ...(forkTurns ? { fork_turns: forkTurns } : {}),
              ...(typeof taskName === 'string' ? { task_name: taskName } : {}) } }],
        } } });
        // C-02: a call row that repeats a key cannot own its result, only show its action.
        if (!duplicate) pending.set(sourceId, commandCallUnsafe ? { ambiguous: true }
          : { delegation: true, id: p.call_id ?? null, resultRecords: new Set() });
      } else if (p.name === 'functions.exec' || p.name === 'exec') {
        capture.wrappers++;
        const parsed = readExecCalls(p.input ?? p.arguments);
        if (parsed.syntaxInvalid === true) {
          capture.unsupported++;
          reason(REASON.syntaxInvalid);
        }
        capture.unsupported += parsed.unsupported;
        if (parsed.unsupported) reason(REASON.unsupported);
        // C-02 M33 native-first: the wrapper call is itself one generic code-cell action whose
        // input is its recorded script (part 0 of its row); its parsed inner calls follow it.
        const record = toolRecord(id, paginated ? [{ name: p.name, input: p.input ?? p.arguments,
          provenance: ACTION_PROVENANCE.codexCodeCell }] : [],
          line, id, p.call_id);
        records.push(record);
        if (!duplicate) {
          const descriptor = { wrapper: true, id, nativeId: p.call_id, record, line, turn, nativeTurn, parsed, done: false,
            nativeCwd, commandStatusUnsafe: commandCallUnsafe || nativeCwdUnsafe || metaCwdUnsafe,
            chunks: [], chunksExact: !commandCallUnsafe, cell: null, waits: new Set(), outcomeGroups: new Set(),
            pollJoins: wrapperPollJoins(parsed) };
          pending.set(sourceId, descriptor);
          wrappers.push(descriptor);
          if (paginated) statsOf(turnKey).wrappers.push(descriptor);
        } else {
          duplicateWrapperPollJoins.push(...wrapperPollJoins(parsed));
          if (paginated) statsOf(turnKey).inexact = true;
        }
      } else if (p.name === 'functions.wait' || p.name === 'wait') {
        const input = parseArgs(p.arguments ?? p.input);
        const cell = typeof input?.cell_id === 'string' && /^\S+$/.test(input.cell_id) ? input.cell_id : null;
        // Bind when the wait was called, not when its result happens to arrive. A missing or
        // overlapping wait leaves output order unproven, even if payload counts happen to fit.
        const wrapper = cell ? waiting.get(cell) : null;
        if (!duplicate && wrapper && !wrapper.done) {
          if (wrapper.waits.size || commandCallUnsafe) wrapper.chunksExact = false;
          wrapper.waits.add(id);
        }
        if (!duplicate) pending.set(sourceId, { wait: true, waitFor: cell, wrapperOwner: wrapper });
      } else if (isPoll(p.name)) {
        const input = parseArgs(p.arguments ?? p.input);
        const session = input?.session_id;
        // C-02 M33 (5): the command its typed session_id names when the poll was called.
        const poll = { poll: true, session, joined: sessions.get(session) ?? null, resolved: false,
          outcomeGroups: new Set() };
        // C-02 M33 native-first (lane g4): a DIRECT write_stdin is a recorded agent action — the
        // chars it typed. Where it continues a command that was emitted, its chunk joins that
        // command's observation (the legacy rule). Where it joins a wrapper command's session, that
        // command is not emitted (its native item is the recorded execution, and the registration
        // is never a record), so the poll is emitted as its own generic action at its call row, with
        // its own result as its observation. Only wrapper-internal polls are covered by native items.
        if (paginated && poll.joined && resultGroups.get(poll.joined)?.registration === true) {
          const record = toolRecord(id, normalCalls(p.name, input), line, sourceId, p.call_id);
          records.push(record);
          capture.captured++;
          poll.own = { id, use: record.raw.message.content[0] };
        }
        if (!commandCallUnsafe) directPolls.push(poll);
        if (!duplicate) pending.set(sourceId, commandCallUnsafe ? { ambiguous: true } : poll);
      } else {
        const input = p.type === 'custom_tool_call'
          ? (Object.hasOwn(p, 'input') ? p.input : undefined) : parseArgs(p.arguments);
        // D68 (c5): every call keeps the name the recorder wrote for it (`recorderName`), whatever it normalizes to.
        const calls = normalCalls(p.name, input).map((call) => ({ ...call, recorderName: p.name }));
        const record = toolRecord(id, calls, line, sourceId, p.call_id); records.push(record);
        if (calls.length) {
          capture.captured++;
          if (!duplicate && commandCallUnsafe) pending.set(sourceId, { ambiguous: true });
          else if (!duplicate) {
            const descriptor = { id, sourceId: p.call_id, name: p.name, input, record,
              count: calls.length, done: false, line, header: headerOf(p.name),
            execSession: calls.length === 1 && /^(?:functions\.)?exec_command$/.test(p.name),
              resultRecords: [], outcomeGroups: new Set() };
            pending.set(sourceId, descriptor);
            directCalls.push(descriptor);
          }
        }
        else { capture.unsupported++; reason(REASON.arguments); }
      }
      continue;
    }

    if (p.type === 'function_call_output' || p.type === 'custom_tool_call_output') {
      const desc = pending.get(p.call_id);
      if (!desc) { capture.unmapped++; reason(REASON.unmapped); continue; }
      if (desc.ambiguous) { capture.unmapped++; reason(REASON.unmapped); continue; }
      if (desc.ignored) continue;
      // C-02: a result ROW that repeats a key is not a serializer product. Neither its call_id,
      // its output nor any typed field is evidence; the call keeps its unmapped or unknown gap.
      if (!desc.wrapper && !desc.wait && duplicateJsonKeys(raw)) {
        shapeMiss('function_call_output');
        if (desc.delegation) {
          const record = { kind: 'user', line, raw: { type: 'user', toolUseResult: undefined,
            message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: desc.id, content: '', is_error: false }] } } };
          records.push(record); desc.resultRecords.add(record);
        } else if (desc.poll) { if (firstOutput(desc, p.output, desc)) unusablePollResult(desc); }
        else if (!desc.done) { desc.done = true; capture.unmapped++; reason(REASON.unmapped); }
        continue;
      }
      if (desc.delegation) {
        let value = p.output;
        // C-02: a repeated key keeps the text unparsed, so it can settle neither failure nor identity.
        if (typeof value === 'string') { const decoded = strictJson(value); if (decoded.strict) value = decoded.value; }
        // Command exit text is not a spawn failure. Only an explicit tool error can settle
        // that the handoff failed; all other cases keep child coverage UNCHECKED.
        const isError = value?.is_error === true || value?.isError === true;
        const content = typeof p.output === 'string' ? p.output : JSON.stringify(p.output ?? '');
        const record = { kind: 'user', line, raw: { type: 'user', toolUseResult: value,
          message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: desc.id, content, is_error: isError }] },
        } };
        records.push(record); desc.resultRecords.add(record);
      } else if (desc.wrapper) {
        const outputRepeated = duplicateJsonKeys(raw);
        if (outputRepeated) {
          desc.commandStatusUnsafe = true;
          desc.chunksExact = false;
          desc.outputUnsafe = true;
        }
        if (firstOutput(desc, p.output, desc)) {
          if (paginated) attachCellOutput(desc, p.output, line, outputRepeated);
          completeWrapper(desc, p.output, line);
        }
      } else if (desc.wait) {
        const wrapper = desc.wrapperOwner;
        if (wrapper && duplicateJsonKeys(raw)) wrapper.chunksExact = false;
        if (firstOutput(desc, p.output, wrapper) && wrapper && !wrapper.done) {
          wrapper.waits.delete(p.call_id);
          if (waiting.get(desc.waitFor) === wrapper) completeWrapper(wrapper, p.output, line);
          else wrapper.chunksExact = false;
        }
      } else if (desc.poll) {
        if (!firstOutput(desc, p.output, desc)) continue;
        const previous = sessions.get(desc.session);
        // Lane g4: the emitted direct poll's own observation is its own result text. It types no
        // outcome — the process exit its header may carry is the command's, whose status is its
        // native item's — and, by the chunk rules, it is outcome-unknown where the command's
        // accumulated outcome already is. A later replay or identity conflict retracts it.
        if (desc.own && p.output != null) {
          const record = resultRecord(`${desc.own.id}:0`, p.output, line, { envelope: false,
            outcomeUnknown: previous?.raw?.outcomeUnknown === true });
          records.push(record);
          desc.own.use.sourceLocator.resultRecord = line;
          const group = { records: new Set([record]), unmapped: false };
          desc.outcomeGroups.add(group);
          resultGroups.set(record, group);
          desc.resultRecords = [record];
        }
        if (previous && p.output != null) {
          desc.resolved = true;
          const group = resultGroups.get(previous);
          if (group) desc.outcomeGroups.add(group);
          continueResult(previous, p.output, { header: 'unified' }, line);
        } else unusablePollResult(desc);
      } else {
        if (!firstOutput(desc, p.output, desc)) continue;
        desc.done = true;
        if (p.output == null) { capture.unmapped++; reason(REASON.unmapped); continue; }
        desc.outcomeGroup ??= { records: new Set(), unmapped: false };
        desc.outcomeGroups.add(desc.outcomeGroup);
        // C-02: one patch exit covers every file it names. Exit 0 settles each; a nonzero exit
        // may follow a committed prefix, so it settles no single file of a multi-file patch.
        const outputText = toolValue(p.output);
        const header = desc.count > 1 && (typeof outputText !== 'string' || headerExit(outputText, desc.header) !== 0)
          ? null : desc.header;
        for (let i = 0; i < desc.count; i++) {
          desc.record.raw.message.content[i].sourceLocator.resultRecord = line;
          desc.resultRecords.push(attach(`${desc.id}:${i}`, p.output, line,
            { header, execSession: desc.execSession === true,
              envelope: desc.header === 'unified' }, desc.outcomeGroup));
        }
      }
      continue;
    }
  }

  // C-02 M33 (5): a joined poll whose own result never arrived usably (its wrapper did not
  // complete, its direct result row is missing, or its call ID was repeated) is an outcome-unknown
  // chunk of the command it named. It keeps its own gap below; before any native sidecar is read,
  // so no sidecar can type that command's status either.
  for (const poll of directPolls) if (!poll.resolved && poll.joined) poll.joined.raw.outcomeUnknown = true;
  for (const desc of wrappers) if (!desc.done) for (const joined of desc.pollJoins) joined.raw.outcomeUnknown = true;
  for (const joined of duplicateWrapperPollJoins) joined.raw.outcomeUnknown = true;

  // Native item IDs may certify a direct response call with the same persisted call_id.
  // The wrapper's inner calls have no such ID, so text, path and timing are never owners.
  const ownIdentity = identity.value();
  const ownThread = ownIdentity.identityConflict ? null : ownIdentity.sessionId;
  const items = [...uiFileChanges, ...uiCommandExecutions, ...uiMcpItems, ...legacyPatchEnds];
  const itemIdCounts = new Map();
  for (const ui of items) if (typeof ui.item?.id === 'string' && ui.item.id)
    itemIdCounts.set(ui.item.id, (itemIdCounts.get(ui.item.id) ?? 0) + 1);
  const directById = new Map(directCalls.filter((desc) => typeof desc.sourceId === 'string'
    && desc.sourceId).map((desc) => [desc.sourceId, desc]));
  const exactOwner = (ui) => {
    if (ui.unsafe || !ownThread || ui.threadId !== ownThread
      || typeof ui.item?.id !== 'string' || !ui.item.id
      || itemIdCounts.get(ui.item.id) !== 1) return null;
    const desc = directById.get(ui.item.id);
    return desc && pending.get(ui.item.id) === desc && desc.done
      && !desc.identityConflict && desc.resultRecords.length === desc.count
      && desc.resultRecords.every((record) => records.includes(record)
        && !discardedResults.has(record)) && !desc.outcomeGroup?.unmapped ? desc : null;
  };
  const unmatchedNative = () => { capture.unsupported++; reason(REASON.nativeUnmatched); };

  // C-02 M33 native-first: each strict-key, own-thread item with a unique ID that is no recorded
  // call's ID is itself a recorded action at its own row, in its own exact turn. Its identity is
  // its item.id; no item is ever attributed to a wrapper or to one of its parsed calls.
  const emittedNative = new Set();
  let nativeItems = 0;
  if (paginated) {
    const candidates = [...uiCommandExecutions, ...uiFileChanges, ...uiMcpItems]
      .filter((ui) => ui.native).sort((a, b) => a.line - b.line);
    for (const ui of candidates) {
      const id = ui.item?.id;
      if (!ui.native.rowStrict || !ownThread || ui.threadId !== ownThread
        || typeof id !== 'string' || !id || recordedItemIds.get(id) !== 1 || recordedCallIds.has(id)) continue;
      const built = ui.native.family === 'command' ? nativeCommand(ui)
        : ui.native.family === 'file' ? nativeFileChange(ui) : nativeMcpCall(ui);
      if (!built) continue;
      ui.native.slot.records.push(...built);
      emittedNative.add(ui);
      statsOf(ui.native.turnId).n[ui.native.family]++;
      nativeItems++;
    }
  }
  // D68 (C 4): each web search item of the own thread with a unique id and a clean shape is an action of its row;
  // any other is the counted unsupported-shape gap it always was.
  for (const ui of uiWebSearches) {
    const id = ui.item?.id;
    const built = paginated && ui.native?.rowStrict && ownThread && ui.threadId === ownThread && !ui.unsafe
      && typeof id === 'string' && id && recordedItemIds.get(id) === 1 && !recordedCallIds.has(id)
      ? nativeWebSearch(ui) : null;
    if (!built) { shapeMiss('web_search'); continue; }
    ui.native.slot.records.push(...built);
    nativeItems++;
  }
  // The native action's use, carrying the item ID as its call key and the closed provenance.
  function nativeUses(ui, calls) {
    const id = uniqueToolId(ui.item.id, ui.line);
    // D68 (c5): a native item's own recorded name is its type (CommandExecution, FileChange, McpToolCall, …).
    const action = toolRecord(id, calls.map((call) => ({ recorderName: ui.item.type, ...call,
      provenance: ACTION_PROVENANCE.codexNativeItem })), ui.line, ui.item.id, ui.item.id);
    for (const use of action.raw.message.content) use.sourceLocator.resultRecord = ui.line;
    return action;
  }
  function nativeResult(use, line, { output = '', visible = output, isError = false, exitCode = null,
    outcomeUnknown = false, fileChangeSuccess = false, commandFailed = false } = {}) {
    return { kind: 'user', line, raw: { type: 'user',
      message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: use.id, content: output, is_error: isError }] },
      toolUseResult: output, exitCode, codexVisibleOutput: visible,
      ...(outcomeUnknown ? { outcomeUnknown: true } : {}),
      ...(fileChangeSuccess ? { codexFileChangeSuccess: true } : {}),
      ...(commandFailed ? { codexNativeCommandFailed: true } : {}) } };
  }
  // CommandExecution: an agent command with its recorded command and cwd, typed only by its own
  // status and integer exit. Any other source is not an agent command and keeps its item gap.
  function nativeCommand(ui) {
    const item = ui.item;
    if (!['agent', 'unified_exec_startup'].includes(item.source)
      || !keysWithin(item, COMMAND_EXECUTION_FIELDS)) return null;
    const script = shellScript(item.command);
    const cwd = commandExecutionCwd(item.cwd);
    const output = item.aggregated_output ?? '';
    if (!script || !cwd || typeof output !== 'string') return null;
    const exit = Number.isSafeInteger(item.exit_code) ? item.exit_code : null;
    const typed = item.status === 'completed' && exit !== null
      ? { exitCode: exit, isError: exit !== 0 }
      : item.status === 'failed' && exit !== null && exit !== 0
        // A negative exit on a failed item is a sentinel, not an exit code: failed, no code.
        ? { exitCode: exit > 0 ? exit : null, isError: true, commandFailed: exit < 0 }
        : null;
    const sessionCwd = typeof meta.cwd === 'string' && posix.isAbsolute(meta.cwd) ? posix.normalize(meta.cwd) : null;
    // Without a workdir the command runs in the session cwd, exactly as a direct call does.
    const input = { command: script, ...(sessionCwd === posix.normalize(cwd) ? {} : { workdir: cwd }) };
    // Status fact (review F1): the item records the line as the script of its own shell process (`shellScript`): a
    // typed fact, so the line's own errexit is read (events.js `exitStatusGap`, `ownShell`).
    // D68 (C 3, c5): the recorder's typed reading of the command (`parsed_cmd`), carried as recorded.
    const action = nativeUses(ui, [{ name: 'Bash', input, sourceInput: input, sourceName: 'exec_command', ownShell: true,
      ...recordedParsedCmd(item.parsed_cmd) }]);
    const [use] = action.raw.message.content;
    if (typed) use.sourceLocator.commandExecutionRecord = ui.line;
    return [action, nativeResult(use, ui.line, typed ? { output, ...typed } : { output, outcomeUnknown: true })];
  }
  // FileChange: one write, edit or delete per recorded change, with its content or diff, exactly
  // as apply_patch records them. Completed settles each file; a failed single file failed; a failed
  // multi-file change may have committed a prefix, so each file's outcome stays unknown.
  function nativeFileChange(ui) {
    const item = ui.item;
    if (!keysWithin(item, ['id', 'type', 'status', 'changes', 'duration', 'auto_approved', 'autoApproved',
      'stdout', 'stderr']) || !item.changes || typeof item.changes !== 'object' || Array.isArray(item.changes))
      return null;
    const entries = Object.entries(item.changes);
    if (!entries.length || entries.length > 256) return null;
    const calls = [];
    for (const [path, change] of entries) {
      if (!path || path.includes('\0') || !change || typeof change !== 'object' || Array.isArray(change)) return null;
      if (change.type === 'add' && keysWithin(change, ['type', 'content']) && typeof change.content === 'string')
        calls.push({ name: 'Write', input: { file_path: path, content: change.content } });
      else if (change.type === 'update' && keysWithin(change, ['type', 'unified_diff', 'move_path'])
        && typeof change.unified_diff === 'string'
        && (!Object.hasOwn(change, 'move_path') || change.move_path === null)) {
        const [before, after] = splitPatch(change.unified_diff, { unified: true });
        // D68 (C 1): the change's recorded hunks, their line numbers kept (`parseUnifiedHunks`).
        calls.push({ name: 'Edit', input: { file_path: path, old_string: before, new_string: after },
          ...recordedUpdate(change.unified_diff) });
      } else if (change.type === 'delete' && keysWithin(change, ['type']))
        calls.push({ name: 'mcp__codex__delete_file', input: { file_path: path } });
      // D68 (C 2): a delete that carries the whole file it removed: that file is its recorded prior state.
      else if (change.type === 'delete' && keysWithin(change, ['type', 'content']) && typeof change.content === 'string')
        calls.push({ name: 'mcp__codex__delete_file', input: { file_path: path }, priorContent: change.content });
      else return null;
    }
    const completed = item.status === 'completed';
    const failedSingle = item.status === 'failed' && calls.length === 1;
    const action = nativeUses(ui, calls);
    for (const use of action.raw.message.content) if (completed) use.sourceLocator.fileChangeRecord = ui.line;
    return [action, ...action.raw.message.content.map((use) => nativeResult(use, ui.line,
      completed ? { fileChangeSuccess: true } : failedSingle ? { isError: true } : { outcomeUnknown: true }))];
  }
  // D68 (C 4): a web search the agent ran. A `WebSearch` item records the query and its action and no result: an action
  // whose outcome and output are unrecorded. A `web.search` Extension item records its results too: each result's
  // title, URL and snippet, verbatim, one quotable source each. Any other shape is no action (the caller counts it).
  function nativeWebSearch(ui) {
    const item = ui.item;
    const action = item.action;
    if (typeof item.query !== 'string' || !(action === undefined || action === null
      || keysWithin(action, ['type', 'query', 'queries', 'url', 'pattern']) && typeof action.type === 'string')) return null;
    const input = { query: item.query, ...(action ? { action } : {}) };
    if (item.type === 'WebSearch') {
      if (!keysWithin(item, ['id', 'type', 'query', 'action'])) return null;
      const built = nativeUses(ui, [{ name: 'web_search', input }]);
      const [use] = built.raw.message.content;
      return [built, nativeResult(use, ui.line, { outcomeUnknown: true })];
    }
    const fields = ['type', 'ref_id', 'title', 'url', 'domain', 'snippet', 'thumbnail_url'];
    if (!keysWithin(item, ['id', 'type', 'kind', 'query', 'action', 'results']) || !Array.isArray(item.results)
      || !item.results.every((result) => keysWithin(result, fields)
        && Object.values(result).every((value) => value === null || typeof value === 'string'))) return null;
    const blocks = item.results.flatMap((result) => ['title', 'url', 'snippet'].map((key) => result[key])
      .filter((value) => typeof value === 'string' && value.length).map((text) => ({ type: 'text', text })));
    const built = nativeUses(ui, [{ name: 'web.search', input }]);
    const [use] = built.raw.message.content;
    return [built, nativeResult(use, ui.line, { output: blocks })];
  }
  // McpToolCall: a generic tool action with its own recorded result content.
  function nativeMcpCall(ui) {
    const item = ui.item;
    if (ui.unsafe || typeof item.server !== 'string' || !item.server
      || typeof item.tool !== 'string' || !item.tool) return null;
    const name = `mcp__${item.server}__${item.tool}`;
    if (name.length > 512 || !/^[\p{L}\p{M}\p{N}_.$:/@+\-]+$/u.test(name)) return null;
    const content = item.result?.content ?? null;
    const action = nativeUses(ui, [{ name, input: item.arguments }]);
    const [use] = action.raw.message.content;
    const output = Array.isArray(content) ? content.map((block) => typeof block?.text === 'string' ? block.text : '')
      .filter(Boolean).join('\n') : typeof content === 'string' ? content : '';
    return [action, nativeResult(use, ui.line, { output, visible: content,
      isError: item.result?.isError === true || item.status === 'failed',
      outcomeUnknown: !['completed', 'failed'].includes(item.status) })];
  }

  for (const ui of uiFileChanges) {
    if (emittedNative.has(ui)) continue;
    const desc = exactOwner(ui);
    const expected = desc && patchChangeKeys({ name: desc.name, input: desc.input, awaited: true }, meta.cwd);
    const observed = sidecarChangeKeys(ui.item, meta.cwd);
    if (!expected || !observed || expected.length !== observed.length
      || expected.some((key, index) => key !== observed[index])) { unmatchedNative(); continue; }
    // D68 (C 1, C 2): the item that settles an apply_patch records each update's line-numbered hunks and each delete's
    // whole prior file; joined to the patch's own change of the same path and kind (the exact key join just proved),
    // never by position.
    const updates = new Map();
    const deletes = new Map();
    if (ui.item.changes && typeof ui.item.changes === 'object' && !Array.isArray(ui.item.changes))
      for (const [path, change] of Object.entries(ui.item.changes)) {
        if (change?.type === 'update' && typeof change.unified_diff === 'string')
          updates.set(safeChangePath(path, meta.cwd), change.unified_diff);
        if (change?.type === 'delete' && typeof change.content === 'string')
          deletes.set(safeChangePath(path, meta.cwd), change.content);
      }
    for (const [index, use] of desc.record.raw.message.content.entries()) {
      use.sourceLocator.fileChangeRecord = ui.line;
      desc.resultRecords[index].raw.codexFileChangeSuccess = true;
      const key = safeChangePath(use.input?.file_path, meta.cwd);
      if (use.name === 'Edit' && updates.has(key)) Object.assign(use, recordedUpdate(updates.get(key)));
      if (use.name === 'mcp__codex__delete_file' && deletes.has(key)) use.priorContent = deletes.get(key);
    }
  }
  for (const ui of legacyPatchEnds) {
    // Legacy events carry call_id directly and have no paginated thread_id field.
    if (emittedNative.has(ui)) continue;
    const desc = exactOwner({ ...ui, threadId: ownThread });
    const expected = desc && patchChangeKeys({ name: desc.name, input: desc.input, awaited: true }, meta.cwd);
    const observed = ui.payload?.success === true && ui.payload.status === 'completed'
      ? sidecarChangeKeys({ type: 'FileChange', status: 'completed', changes: ui.payload.changes }, meta.cwd)
      : null;
    if (!expected || !observed || expected.length !== observed.length
      || expected.some((key, index) => key !== observed[index])) { unmatchedNative(); continue; }
    for (const [index, use] of desc.record.raw.message.content.entries()) {
      use.sourceLocator.fileChangeRecord = ui.line;
      desc.resultRecords[index].raw.codexFileChangeSuccess = true;
    }
  }
  for (const ui of uiCommandExecutions) {
    if (emittedNative.has(ui)) continue;
    // An untyped status on a row that did not become a native action is the row-shape gap it is
    // in every other recording (declared here rather than at the row; see deferUntyped).
    if (ui.deferUntyped) { shapeMiss('command_execution'); }
    // A typed user shell notification describes a human command, not missing agent work.
    if (ui.item?.source === 'user_shell' && !ui.unsafe) {
      if (exactOwner(ui)) unmatchedNative();
      continue;
    }
    const desc = exactOwner(ui);
    const input = desc?.input;
    const eligibleSource = ['agent', 'unified_exec_startup'].includes(ui.item?.source);
    const expected = desc && ['exec_command', 'functions.exec_command'].includes(desc.name)
      && input && typeof input === 'object' && !Array.isArray(input)
      ? safeCommandExecutionKey(input.cmd,
        Object.hasOwn(input, 'workdir') ? input.workdir : meta.cwd) : null;
    const cwd = commandExecutionCwd(ui.item?.cwd);
    const observed = cwd && Array.isArray(ui.item?.command)
      ? safeCommandExecutionKey(ui.item.command[2], cwd) : null;
    const use = desc?.record.raw.message.content[0];
    const record = desc?.resultRecords[0];
    if (!eligibleSource || !expected || expected !== observed || desc.count !== 1
      || use?.name !== 'Bash' || !record || record.raw.outcomeUnknown === true) {
      unmatchedNative(); continue;
    }
    const priorCode = record.raw.exitCode;
    const isError = record.raw.message?.content?.[0]?.is_error === true;
    if (Number.isSafeInteger(priorCode) && priorCode !== ui.item.exit_code
      || isError && ui.item.exit_code === 0) {
      record.raw.codexCommandExecutionConflict = true;
      unmatchedNative();
      continue;
    }
    record.raw.exitCode = ui.item.exit_code;
    use.sourceLocator.commandExecutionRecord = ui.line;
    // D68 (C 3, c5): the item that settles this call carries the recorder's typed reading of its command.
    Object.assign(use, recordedParsedCmd(ui.item.parsed_cmd));
    // Status fact (review F1): the same typed fact when the item that settles this call records its line as the script
    // of its own shell process.
    if (shellScript(ui.item.command) === use.input?.command) use.ownShell = true;
  }

  // H43: a call whose RESULT ROW never arrived at all — the rollout ends mid-call. That is not
  // the same as an outcome that could not be mapped after a proven completion (invalidateOutcomes
  // above, reason codex_wrapper_output_unmapped), where the action itself is fully evidenced and
  // only its exit code is unknown. Both bump `unmapped`; only this one is a capture gap, and it
  // was declared as codex_tool_result_missing while leaving capture.incomplete false, so the
  // session could still read CLEAN.
  let resultMissing = false;
  for (const desc of pending.values()) {
    if (desc.wrapper && !desc.done && (desc.parsed.calls.length || desc.parsed.unsupported)) {
      capture.missing++; reason(REASON.incomplete);
    } else if (desc.poll && !desc.outputSeen) {
      capture.missing++; reason(REASON.missing);
    } else if (desc.count && !desc.done) { capture.unmapped++; resultMissing = true; reason(REASON.missing); }
  }
  // An MCP item can disappear only with the same persisted ID and a compatible direct
  // call/result. Its UI result is never promoted to a model-visible observation.
  for (const ui of uiMcpItems) {
    if (emittedNative.has(ui)) continue;
    const desc = exactOwner(ui);
    const names = typeof ui.item?.tool === 'string' && typeof ui.item?.server === 'string'
      ? [ui.item.tool, `mcp__${ui.item.server}__${ui.item.tool}`] : [];
    if (!desc || !names.includes(desc.name) || desc.count !== 1
      || JSON.stringify(desc.input) !== JSON.stringify(ui.item.arguments)) {
      capture.unsupported++; reason(REASON.uiUnmatched);
    }
  }
  // C-02 M33 native-first completeness, per exact turn T and family F: P counts the inner calls of
  // F that static parsing proves T's wrappers dispatched (a completed wrapper reached every parsed
  // statement), N the native items of F emitted in T. F is complete for T only when every wrapper
  // in T parsed exactly and N === P; otherwise T declares max(P - N, 1). This bounds an inventory;
  // it never joins an item to a wrapper or to a parsed call.
  // Refreeze: "parsed exactly" is the reader's `inventoryExact` — not syntax-invalid (the reader's
  // screen is conservative, so a script it rejects may still have run), no unsupported or rejected
  // statement, and no dynamic dispatch route or indirect `tools` reference anywhere in the source.
  let nativeInventoryGaps = 0;
  let nativeInventoryShortfall = 0;
  let nativeCommandShortfall = 0;
  let nativeWriteShortfall = 0;
  if (paginated) {
    for (const stats of turnStats.values()) {
      for (const desc of stats.wrappers) {
        const completed = desc.done && !desc.failed;
        if (!completed || desc.parsed.inventoryExact !== true || desc.parsed.syntaxInvalid === true
          || desc.parsed.unsupported > 0 || desc.identityConflict || desc.outputConflict
          || desc.outputUnsafe || !desc.chunksExact) stats.inexact = true;
        if (completed) for (const call of desc.parsed.calls) {
          const family = familyOf(call.name);
          if (family) stats.p[family]++;
        }
      }
      for (const family of NATIVE_FAMILIES) {
        const dispatched = stats.p[family];
        const recorded = stats.n[family];
        if (!stats.inexact && dispatched === recorded) continue;
        // Refreeze (lane g3): the counters are split. A (turn, family) whose inventory is not
        // proved complete adds max(P - N, 1) to the inventory shortfall only; the command and
        // write shortfall count just the dispatched calls no native item can account for,
        // max(P - N, 0), so an unproved but balanced turn declares no outcome gap it cannot name.
        const unaccounted = Math.max(dispatched - recorded, 0);
        nativeInventoryGaps++;
        nativeInventoryShortfall += Math.max(unaccounted, 1);
        if (family === 'command') nativeCommandShortfall += unaccounted;
        if (family === 'file') nativeWriteShortfall += unaccounted;
      }
    }
    if (nativeInventoryShortfall > 0) reason(REASON.nativeInventory);
    Object.assign(capture, { nativeItems, nativeInventoryGaps, nativeInventoryShortfall,
      nativeCommandShortfall, nativeWriteShortfall });
  }
  // M5: in a rollout whose own thread persists the item stream, its typed UserMessage items are the human channel. M5
  // review finding: so they are in one whose recorder declares the stream (`declaresTypedChannel`) and in which no turn
  // ran, so there was no item to record; a declared rollout in which a turn ran must show the stream to be decided by it.
  if (paginated || (!turnStarted && modelOutputAt === null && declaresTypedChannel(historyModes, ownThread))) {
    const unread = markCodexUserMessages(typedUserMessages, userMessages, ownThread,
      { modelOutputAt, streamAt: firstItemRow.get(ownThread) ?? null });
    if (unread > 0) { capture.unsupported += unread; reason(REASON.message); }
  }
  const unknownSchema = sourceRows === 0 && (unknownRows > 0 || eventMessages > 0);
  if (unknownSchema) reason(REASON.shape);
  // M33 F: an encrypted inter-agent payload is withheld communication, counted apart from an unparsed row and carried
  // only when there is one. A final report read here is no loss yet: whether it is attributed is decided by the join
  // over the whole lineage's hand-offs (slicer index.js), which declares an unattached one there.
  if (interAgentEncrypted > 0) capture[INTER_AGENT_COUNTS.encrypted] = interAgentEncrypted;
  let communicationLoss = capture.interAgentMessagesUnparsed + interAgentEncrypted;
  capture.incomplete = capture.unsupported > 0 || capture.missing > 0 || resultMissing
    || unknownSchema || communicationLoss > 0 || nativeInventoryShortfall > 0;
  const childIdentity = identity.value();
  const noForkVerified = noFork && childIdentity.historyStart == null && childIdentity.nested === true
    && childIdentity.identityConflict === false && childIdentity.forked === false
    && childIdentity.multiAgentVersion === 'v2'
    && childIdentity.sessionId === noForkChildProof.sessionId
    && childIdentity.parentThreadId === noForkChildProof.parentThreadId
    && childIdentity.taskPath === noForkChildProof.taskPath;
  const childBoundaryMissing = childRecording && childIdentity.historyStart == null && !noForkVerified;
  if (childRecording && (childBoundaryMissing || childHistoryInvalid)) {
    capture.incomplete = true;
    reason(REASON.childHistory);
    // M33 F: the whole history is withheld below, so no final report read here can reach the join. Each is still
    // counted, as a report that could name no hand-off, never dropped silently with the records.
    if (finalAnswersRead > 0) {
      capture[INTER_AGENT_COUNTS.unattributed] = finalAnswersRead;
      communicationLoss += finalAnswersRead;
    }
  }
  const otherSourceLoss = capture.unsupported > 0 || capture.missing > 0
    || capture.unmapped > 0 || resultMissing || unknownSchema || unknownRows > 0
    || corrupt > 0 || childBoundaryMissing || childHistoryInvalid
    || childIdentity.identityConflict || capture.reasons.length > 0;
  capture.interAgentMessagesSoleIncomplete = communicationLoss > 0 && !otherSourceLoss;
  // The typed communication loss names its own channel. An unmapped result is a separate
  // observation loss, but does not by itself imply a missing parent action inventory.
  // Refreeze (lane g3): so does a native inventory shortfall — its counted gap already states the
  // loss — when it is the recording's only incomplete cause. Both together stay generic.
  const soleTypedCause = communicationLoss > 0
    ? nativeInventoryShortfall === 0 : nativeInventoryShortfall > 0;
  capture.attributedIncomplete = soleTypedCause
    && capture.unsupported === 0 && capture.missing === 0 && !resultMissing
    && !unknownSchema && corrupt === 0 && !childBoundaryMissing && !childHistoryInvalid
    && !childIdentity.identityConflict;
  // Each native slot becomes the records emitted at its row (none when the item stayed a gap).
  const ordered = paginated ? records.flatMap((record) => record.kind === NATIVE_SLOT ? record.records : [record])
    : records;
  // M34 labels: Codex's one labelling function, over the records in recorded order. A counted row is `{uuid, value}`, as
  // the Claude reader's (records.js); a Codex row records no uuid.
  meta.labelled = [...labelled, ...labelCodexRecords(ordered,
    childIdentity.nested === true ? LINEAGE_ROLES.helper : LINEAGE_ROLES.root)].map((value) => ({ uuid: null, value }));
  return { records: childRecording && (childBoundaryMissing || childHistoryInvalid)
    ? [] : ordered.filter((record) => !discardedResults.has(record)),
    meta: { ...meta, sourceIdentity: childIdentity, ...(Object.keys(shapeMisses).length ? { shapeMisses } : {}) },
    corrupt, unknownSchema };
}

/**
 * A message's content is a stringified Python-ish list with single quotes. Not JSON.
 * Recover the text without `eval` and without pretending it parses.
 */
export function decodeContent(content) {
  if (typeof content !== 'string') {
    if (Array.isArray(content)) return content.map((b) => b?.text ?? '').filter(Boolean).join('\n');
    return '';
  }
  const s = content.trim();
  if (!s.startsWith('[')) return s;
  const out = [];
  // 'text': '...' or "text": "..." — take the value, handling escaped quotes.
  const re = /['"]text['"]\s*:\s*(['"])((?:\\.|(?!\1).)*)\1/gs;
  let m;
  while ((m = re.exec(s)) !== null) out.push(unescape(m[2]));
  return out.join('\n') || s;
}

/**
 * Gain I (2026-10-13): a data URL (RFC 2397) of base64 data, its media type a `type/subtype` token pair — the form
 * Codex records a pasted image's `image_url` in. A formal grammar, never fitted to recorded words.
 */
const BASE64_DATA_URL = /^data:([A-Za-z0-9!#$&^_.+-]+\/[A-Za-z0-9!#$&^_.+-]+);base64,([A-Za-z0-9+/]*={0,2})$/;

/** Gain I: an image block of a message. One Codex recorded whole as a base64 data URL (`input_image`, or the `image`
 *  of a typed item) keeps its media type and data as a Claude image block records them (`source`); any other — a path,
 *  a remote URL, an audio or document block — is a block with nothing this reader can carry. */
function imageBlock(b) {
  const url = ['input_image', 'image'].includes(b?.type) && typeof b.image_url === 'string'
    ? BASE64_DATA_URL.exec(b.image_url) : null;
  return url ? { type: 'image', source: { type: 'base64', media_type: url[1], data: url[2] } } : { type: 'image' };
}

/** Preserve supported message block boundaries. Never promote private/unknown blocks to prose. */
export function visibleContentBlocks(content) {
  if (typeof content === 'string') {
    if (!content.trimStart().startsWith('[')) return [{ type:'text', text:content }];
    const decoded = strictJson(content);
    if (decoded.json) return decoded.strict && Array.isArray(decoded.value)
      ? visibleContentBlocks(decoded.value) : [{ type:'unsupported_content' }];
    // The historical adapter supports this narrowly defined string representation. Consume the
    // entire list; an unsupported field or malformed suffix is a gap, not a guessed text block.
    const re = /\{\s*['"]type['"]\s*:\s*['"](input_text|output_text|text)['"]\s*,\s*['"]text['"]\s*:\s*(['"])((?:\\.|(?!\2).)*)\2\s*\}/gs;
    const matches=[...content.matchAll(re)];
    const residue=content.replace(re,'').replace(/[\s,\[\]]/g,'');
    if (!matches.length || residue) return [{ type:'unsupported_content' }];
    return matches.map(m=>({type:'text',text:unescape(m[3])}));
  }
  if (!Array.isArray(content)) return [{ type:'unsupported_content' }];
  return content.map(b => ['text','input_text','output_text'].includes(b?.type) && typeof b.text === 'string'
    ? { type:'text',text:b.text } : ['thinking','redacted_thinking','reasoning'].includes(b?.type)
      ? {type:'reasoning'} : ['image','input_image','audio','document'].includes(b?.type)
        ? imageBlock(b) : {type:'unsupported_content'});
}

function unescape(t) {
  return t.replace(/\\n/g, '\n').replace(/\\t/g, '\t').replace(/\\'/g, "'").replace(/\\"/g, '"').replace(/\\\\/g, '\\');
}

function parseArgs(args) {
  if (args == null) return undefined;
  if (typeof args === 'object') return args;
  // C-02: model-written arguments with a repeated key name no single action; the harness does
  // not decode them by JSON.parse's last-wins rule. Keep them as unparsed tool input.
  const decoded = strictJson(String(args));
  return decoded.strict ? decoded.value
    : { __unparsedToolInput: { raw: String(args), len: String(args).length } };
}

/** Canonical calls have validated, literal input. A multi-file patch becomes one call per file. */
function normalCalls(name, input) {
  if (typeof name !== 'string' || !name) return [];
  const leaf = name.split('.').pop();
  const vettedAlias = name === leaf || name === 'functions.' + leaf;
  if (vettedAlias && leaf === 'apply_patch') {
    const patch = typeof input === 'string' ? input : input?.patch ?? input?.input;
    if (typeof patch !== 'string' || !/^\*\*\* Begin Patch\r?\n/.test(patch) || !/\n\*\*\* End Patch\s*$/.test(patch))
      return [{ name, input }];
    // A move can include unchanged content that the patch does not contain. Do not invent a
    // complete newly-created file; leave this uncommon shape as an explicit capture gap.
    if (/^\*\*\* Move to:/m.test(patch)) return [{ name, input }];
    const sections = [...patch.matchAll(/^\*\*\* (Update|Add|Delete) File: (.+)\r?$/gm)];
    if (!sections.length) return [{ name, input }];
    return sections.map((section, i) => {
      const path = section[2].trim();
      const body = patch.slice(section.index + section[0].length, sections[i + 1]?.index ?? patch.indexOf('*** End Patch', section.index));
      if (section[1] === 'Add') return { name: 'Write', input: { file_path: path, content: addedText(body) } };
      if (section[1] === 'Delete') return { name: 'mcp__codex__delete_file', input: { file_path: path } };
      const [before, after] = splitPatch(body);
      return { name: 'Edit', input: { file_path: path, old_string: before, new_string: after } };
    });
  }
  const canonical = vettedAlias && Object.hasOwn(TOOL_ALIAS, leaf) ? TOOL_ALIAS[leaf] : null;
  if (canonical === 'Bash') {
    const raw = input?.command ?? input?.cmd;
    // C-02: Codex's shell tool takes an argv. Only the exact [shell, -lc|-c, script] triple for
    // bash, zsh or sh names one command; any other argv stays a generic tool call.
    const command = Array.isArray(raw) && raw.length === 3 && typeof raw[0] === 'string'
      && /^(?:(?:\/usr\/local\/bin|\/usr\/bin|\/bin)\/)?(?:bash|zsh|sh)$/.test(raw[0])
      && ['-lc', '-c'].includes(raw[1]) && typeof raw[2] === 'string' ? raw[2] : raw;
    return typeof command === 'string' && command.length
      ? [{ name: canonical, input: { ...input, command }, sourceInput: input, sourceName: name }]
      : [{ name, input }];
  }
  if (canonical) {
    if (!input || typeof input !== 'object' || Array.isArray(input))
      return [{ name, input }];
    const path = input.file_path ?? input.path;
    if (typeof path !== 'string' || !path) return [{ name, input }];
    return [{ name: canonical, input: { ...input, file_path: path },
      sourceInput: input, sourceName: name }];
  }
  return [{ name, input }];
}

/**
 * apply_patch carries the whole patch as text. Extract the file it touches and keep the body as the
 * args excerpt so before/after deltas still work downstream. M33 R: a patch naming no file keeps its
 * WHOLE body as the command; a cut here (it was 200 characters) would lose the rest of it.
 */
export function patchInput(input) {
  const body = typeof input === 'string' ? input : JSON.stringify(input ?? '');
  PATCH_FILE.lastIndex = 0;
  const files = [...body.matchAll(PATCH_FILE)].map((m) => m[1].trim());
  const path = files[0] ?? null;
  const [before, after] = splitPatch(body);
  return path
    ? { file_path: path, old_string: before, new_string: after, _files: files }
    : { command: body };
}

/** A unified diff's hunk header, `@@ -a,b +c,d @@`, and the section heading after it (the enclosing line, if any). */
const HUNK_RANGE = /^@@ -\d+(?:,\d+)? \+\d+(?:,\d+)? @@ ?(.*)$/;
/** A unified diff's file header line, `--- …` or `+++ …`: only before its first hunk. */
const FILE_HEADER = /^(?:---|\+\+\+)(?:[ \t]|$)/;

/**
 * A patch body as the two texts it changes: `[old, new]`. The old text is every context line and every `-` line, in
 * order; the new text every context line and every `+` line. A hunk's anchor (apply_patch `@@ <line>`) or section
 * heading (unified `@@ -a,b +c,d @@ <line>`) is a line of the file above the hunk: context in both. An empty line in a
 * hunk is an empty context line, as apply_patch reads it; the empty lines that only frame the body are not lines of
 * it. A `\ No newline…` marker and apply_patch's `*** …` lines are not file text.
 *
 * M33 R repair 2: this used to keep only the `-` and `+` lines, and to drop every one whose own text starts with `--`
 * or `++` as a file header. It ran before redaction, so it cut away the line that makes the lines below it secret — a
 * YAML block's `signing_key: |` kept as context, a PEM BEGIN line removed (`------BEGIN …`) or kept as context, the
 * first line of a continued value — and redaction judged the block's other lines without it. Now that line travels
 * with its block, in each text that holds it. `unified`: the body is a unified diff, whose `---`/`+++` lines before
 * its first hunk are its file headers; an apply_patch body has none, so there every such line is a changed line.
 *
 * M33 R repair 3: a hunk line with no marker — not a context, `-` or `+` line, not empty, not one of apply_patch's own
 * lines nor a `\ No newline…` marker (`PATCH_OWN_LINE`) — makes a malformed patch, which Codex rejects. It used to be
 * dropped from both texts, silently: a YAML key or a PEM BEGIN line written without its marker left the block's body
 * lines in a text without the line that makes them secret, and redaction showed them verbatim. Now it is kept, whole,
 * as a context line of both texts, so a body never travels without its key. (Withholding the section instead would
 * fail closed too; this keeps the change visible. D90: nothing in it is masked.) Before a unified diff's first hunk, an unmarked line is
 * one of its headers (`diff --git …`, `index …`) and is not file text, as before.
 */
function splitPatch(body, { unified = false } = {}) {
  const lines = String(body).split('\n');
  let from = 0;
  let to = lines.length;
  while (from < to && lines[from] === '') from++;
  while (to > from && lines[to - 1] === '') to--;
  const old = [];
  const neu = [];
  let hunks = !unified;
  for (let i = from; i < to; i++) {
    const line = lines[i];
    if (line.startsWith('@@')) {
      hunks = true;
      const anchor = HUNK_RANGE.exec(line)?.[1] ?? (line.startsWith('@@ ') ? line.slice(3) : '');
      if (anchor.trim()) { old.push(anchor); neu.push(anchor); }
      continue;
    }
    if (!hunks && FILE_HEADER.test(line)) continue;
    const marker = line[0];
    if (marker === '-') old.push(line.slice(1));
    else if (marker === '+') neu.push(line.slice(1));
    else if (marker === ' ' || line === '') { old.push(line.slice(1)); neu.push(line.slice(1)); }
    else if (hunks && !PATCH_OWN_LINE.test(line)) { old.push(line); neu.push(line); }
  }
  return [old.join('\n'), neu.join('\n')];
}

/** apply_patch's own lines (`*** Begin Patch`, a section's header, `*** Move to:`, `*** End of File`, `*** End Patch`)
 *  and a diff's `\ No newline at end of file` marker: never a line of the file. */
const PATCH_OWN_LINE = /^(?:\*\*\* (?:Begin Patch|End Patch|End of File|(?:Update|Add|Delete) File: .*|Move to: .*)|\\ .*)\r?$/;

/**
 * An Add File body's text: its `+` lines, every one of them, as apply_patch writes the file.
 *
 * M33 R repair 3: and every line with no `+` (a malformed Add, which Codex rejects), kept whole, in its place — it used
 * to be dropped silently, so a YAML key or a PEM BEGIN line written without its `+` left the block's body in a file text
 * without its key. The empty lines that only frame the body are not lines of it, and apply_patch's own lines never are.
 */
function addedText(body) {
  const lines = String(body).split('\n');
  let from = 0;
  let to = lines.length;
  while (from < to && lines[from] === '') from++;
  while (to > from && lines[to - 1] === '') to--;
  const text = [];
  for (const line of lines.slice(from, to)) {
    if (line.startsWith('+')) text.push(line.slice(1));
    else if (!PATCH_OWN_LINE.test(line)) text.push(line);
  }
  return text.join('\n');
}

/** Group Codex rollouts into lineages. Codex chains explicitly via forked_from_id when it exists. */
export function codexLineageKey(meta, firstRecord) {
  return firstRecord?.raw?.forked_from_id ?? meta.sessionId ?? null;
}
