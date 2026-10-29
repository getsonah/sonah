// Reading Claude Code / Codex session files into a normalised record stream.
//
// Everything here is defensive against schema drift. The vendors document WHERE the file is and
// roughly WHAT is in it; none of them documents the schema, and Anthropic declares its entry schema
// internal and unstable. So: never assume a field exists, never assume a type, and never let one
// malformed line kill a session.
//
// Traps encoded here:
//   - `toolUseResult` is sometimes an object, sometimes a string, sometimes an array.
//   - `is_error` is three-valued in practice: true / false / absent.
//   - a user record's `.message.content` can be a plain string, not a block array.
//   - every record of a nested subagent transcript is isSidechain:true — reading them without
//     `sidechainAsMain` yields zero tool calls, silently.
//   - a continued session keeps the ORIGINAL sessionId in its records.
//   - much of a file's bytes is per-line scaffolding (uuid/parentUuid/cwd/version/gitBranch).

import { createInterface } from 'node:readline';
import { recordingIdentity } from './recording-identity.js';
import { recordingStream } from './recording-stream.js';
import { duplicateJsonKeys } from './strict-json.js';
import { requestCopyIndex } from './request-copies.js';
import { isWhollyElements, startsWithElement, recorderCommand, recorderNotificationCallId, claudeNotificationCarrier,
  isLocalCommandCaveat, LOCAL_COMMAND_OUTPUT_SUBTYPE } from './harness-context.js';
import { LABELS, LABEL_BASIS, LABEL_GAPS, MARKERS, LINEAGE_ROLES, SONAH_SKILL_NAMES, labelOf, applyLabel, humanPart,
  opensTurn, partsOf } from './labels.js';

// 2 (C-01 event identity, 2026-10-07): every ledger element that becomes a canonical event records where the recorder
// wrote it (`identity`: its row, block and the recorder's own id for it, src/event-identity.js), so the evidence adapter
// names events by the recorder's identity, never by turn and sequence.
// 3 (D68, 2026-10-07; C-02 "M36 recorded facts"): every action carries `recorded`, the recorder's typed facts about it
// (its own tool name, a Codex command's parsed meaning and class, a change's recorded hunks, a sidecar's numbers), a
// Codex delete its recorded prior state, a Claude Code Agent hand-off its typed status; no body is cut.
export const SCHEMA_VERSION = 3;

/** Conversation record kinds. Other row types need a coverage decision before being dropped. */
const KEPT_TYPES = new Set(['user', 'assistant', 'system']);

// These native row types describe recording metadata rather than conversation turns. A row of
// one of these types is only harmless scaffolding while it has no separate content carrier.
// Unknown types must fail closed: a future Claude row can carry a tool call outside `message`.
const exactKeys = (value, fields) => value !== null && typeof value === 'object'
  && !Array.isArray(value) && Object.keys(value).length === fields.length
  && fields.every((key) => Object.hasOwn(value, key));
const plainObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
/** Every key of `value` is in `required` or `optional`, and every `required` key is present. */
const keySet = (value, required, optional = []) => plainObject(value)
  && required.every((key) => Object.hasOwn(value, key))
  && Object.keys(value).every((key) => required.includes(key) || optional.includes(key));
const validAgentId = (value) => typeof value === 'string' && value.length > 0 && value.length <= 200;

/**
 * C-03 M33 D (Claude Code row drift): the closed map of Claude `attachment.type` values this reader
 * classifies, each with its exact payload keys (`type` plus `required`, and `optional`) and its class:
 *   harness       — harness context the model was shown: dates, the model, tool/skill/agent listings,
 *                   reminders, memory and instruction files, prompt snapshots. Not T/A/O evidence:
 *                   scaffold, and COUNTED in `capture.harnessContextRows`, never dropped silently.
 *   instructions  — a payload the user supplied: an @-mentioned file, directory or PDF, a queued prompt.
 *   observations  — a harness observation: hook output, a file the user or a formatter changed, a
 *                   truncation notice, a task status, a structured output, a task notification.
 * The two content-bearing classes are not read yet. Each such row stays a declared, counted loss
 * (`unsupported_message`) on its own channel instead of an identity-channel row of unknown channel.
 * OWNER DECISION B (2026-10-01); M34 labels: a queued prompt labelled `human` + `queued`, and an attachment labelled
 * `human` + `attached` (an @-mention), are also read as human instructions (`claudeLabeller`, events.js
 * `interjections`); their rows stay counted here for every reader of `ask` alone.
 * Release fix 3b (2026-10-12): the class says what a row of that type MAY carry; its label says whose it is
 * (`claudeLabeller`, by structure: `origin`, `isMeta`, the `parentUuid` chain). An instructions-class row the labeller
 * labels harness with no gap — a `file` whose chain reaches no human submission (restored after a compaction, or
 * attached mid-turn), a `compact_file_reference`, a queued command the recorder flagged `isMeta` or, on a typed
 * recorder, wrote with no origin — is no one's input but the harness's: it is counted as harness context
 * (`readClaudeSession`), never as an instructions loss. A row labelled the human's, a peer's or an observation, or
 * carrying a label gap (the legacy recorder's, `legacy_recorder`), keeps its class (fail closed). Before this rule,
 * such harness rows were declared instructions lost.
 * Any other type, payload key, row key or value shape is read by its structure (D128, `structuralAttachment` below):
 * harness context, or the listed type's class, when nothing unlisted can hold session content; else unclassified
 * (fail closed). Key sets are the known ones (Claude Code 2.1.121–2.1.296); nothing is inferred from values.
 * D72 (2026-10-09, M43 reader): from 2.1.286 the recorder adds keys the reader did not list, and every row carrying
 * them was unclassified (attachment rows of 2.1.286, 2.1.289 and 2.1.293): the
 * row keys `renderedRole` and `renderedBesideToolResult` (CLAUDE_RENDERED_ROLES below), the `queued_command` payload
 * keys `delivery_id`, `reminderId` and `runId`, and the `agent_listing_delta` payload key `builtInTypes` (and, on 586
 * `queue-operation` removals, `commandUuid` and `deliveryId`: `knownQueueRow`). They are listed
 * here as data, by key. `delivery_id`, `reminderId`, `runId` and `builtInTypes` have no value-type check; the
 * rendering fields are checked below. None of these values is read for a class or a label, which stay the recorder's typed
 * `attachment.type`, `commandMode`, `origin`, `isMeta` and `parentUuid` chain (`claudeLabeller`). `reminderId` and
 * `runId` are accepted only beside the structure the recorder writes them with (`claudeAttachment`, R1R review).
 */
export const CLAUDE_ROW_CLASSES = Object.freeze({ harness: 'harness', instructions: 'instructions',
  observations: 'observations', metadata: 'metadata' });
const shape = (cls, required, optional = []) => Object.freeze({ cls, required: Object.freeze(['type', ...required]),
  optional: Object.freeze(optional) });
const H = CLAUDE_ROW_CLASSES.harness, I = CLAUDE_ROW_CLASSES.instructions, O = CLAUDE_ROW_CLASSES.observations;
/** D150: the reader's own count of a queued task notification it reads by its status (`readClaudeSession`): no class a
 *  classifier returns, no loss, and another agent's still unclassified. */
const NOTICE = 'notice';
/**
 * D150: the kinds of row the reader leaves unread (a declared loss on a channel, or unclassified), each row
 * counted once, by its recorder structure: a request blob no structural twin settles as a copy, a hook's row, a file
 * changed outside the agent's edits, any other. Closed, so the page can say what it could not read by kind.
 */
export const UNREAD_ROW_KINDS = Object.freeze({ requestCopy: 'request_copy', hookOutput: 'hook_output',
  editedFile: 'edited_file', other: 'other' });
const HOOK_ATTACHMENTS = Object.freeze(['hook_additional_context', 'hook_success', 'hook_non_blocking_error']);
const unreadKindOf = (d) => (d?.type === 'api-request-blob' ? UNREAD_ROW_KINDS.requestCopy
  : d?.type === 'attachment' && HOOK_ATTACHMENTS.includes(d.attachment?.type) ? UNREAD_ROW_KINDS.hookOutput
    : d?.type === 'attachment' && d.attachment?.type === 'edited_text_file' ? UNREAD_ROW_KINDS.editedFile
      : UNREAD_ROW_KINDS.other);
/** D150: canonical JSON (object keys sorted at every depth), for a structured output's twin. */
const canonicalJson = (value) => JSON.stringify(value, (key, item) => (item !== null && typeof item === 'object'
  && !Array.isArray(item) ? Object.fromEntries(Object.keys(item).sort().map((k) => [k, item[k]])) : item));
const CLAUDE_ATTACHMENTS = Object.freeze({
  total_tokens_reminder: shape(H, ['text']),
  silent_turn_reminder: shape(H, ['text']),
  batching_reminder_sent: shape(H, ['model', 'text'], ['clearAt']),
  environment: shape(H, ['snapshot'], ['changes']),
  model: shape(H, ['identity', 'text']),
  // D123: `surfacedDefinitions`, the definitions of the tools named in `surfacedNames` (seen from recorder 2.1.295 on).
  deferred_tools_delta: shape(H, ['addedLines', 'addedNames', 'removedNames'], ['readdedNames',
    'failedMcpServers', 'needsAuthMcpServers', 'pendingMcpServers', 'surfacedNames', 'surfacedDefinitions',
    'wireHiddenNames']),
  deferred_tools_record: shape(H, ['entries'], ['toolInputCopies', 'nameOnlyAnnouncements']),
  agent_listing_delta: shape(H, ['addedLines', 'addedTypes', 'isInitial', 'removedTypes', 'showConcurrencyNote'],
    ['builtInTypes']),
  mcp_instructions_delta: shape(H, ['addedBlocks', 'addedNames', 'removedNames']),
  skill_listing: shape(H, ['content', 'isInitial', 'skillCount'], ['names']),
  auto_mode: shape(H, ['autoModeConsentFlow', 'bashFirst', 'bypass', 'steerOnly'], ['bashFirstSteer']),
  instructions: shape(H, ['files'], ['changed', 'reason']),
  nested_memory: shape(H, ['content', 'displayPath', 'path']),
  session_context: shape(H, ['context']),
  date: shape(H, ['date'], ['changed']),
  date_change: shape(H, ['newDate']),
  remote_session_change: shape(H, ['commit', 'pr', 'sendUserFileHint', 'url'], ['managedCommit', 'managedPr']),
  prompt_snapshot: shape(H, ['systemPrompt'], ['cliPrefix', 'tools', 'reminderFold', 'contextRendering',
    'echoWireToolInputs', 'inlineTools', 'keptReminders', 'systemTurns', 'toolChangeHeader']),
  ultra_effort_enter: shape(H, ['reminderType']),
  ultra_effort_exit: shape(H, [], ['reminderType']),
  thinking_drop: shape(H, ['blockHashes', 'clientChange', 'firstReportForThreadInProcess', 'model',
    'newlyDropped', 'querySource', 'requestId', 'thinkingBlocksSent', 'thinkingTurnsSent']),
  thinking_stripped: shape(H, ['scope']),
  command_permissions: shape(H, ['allowedTools']),
  credential_org: shape(H, ['organizationUuid']),
  // Release fix 3b (2026-10-12): the recorder's notice that a run stopped at its turn limit (`--max-turns`): two
  // counts, no text. Before, it was the one row that left such a recording's channel unknown (`unclassifiedRows`).
  max_turns_reached: shape(H, ['maxTurns', 'turnCount']),
  invoked_skills: shape(H, ['skills']),
  task_reminder: shape(H, ['content', 'itemCount']),
  todo_reminder: shape(H, ['content', 'itemCount']),
  hook_additional_context: shape(O, ['content', 'hookEvent', 'hookName', 'toolUseID']),
  hook_success: shape(O, ['command', 'content', 'durationMs', 'exitCode', 'hookEvent', 'hookName',
    'stderr', 'stdout', 'toolUseID']),
  hook_non_blocking_error: shape(O, ['command', 'durationMs', 'exitCode', 'hookEvent', 'hookName',
    'stderr', 'stdout', 'toolUseID']),
  edited_text_file: shape(O, ['filename', 'snippet'], ['displayPath']),
  read_truncation_notice: shape(O, ['banner', 'toolUseID']),
  task_status: shape(O, ['deltaSummary', 'description', 'outputFilePath', 'status', 'taskId', 'taskType'], ['shell']),
  structured_output: shape(O, ['data', 'toolUseID']),
  file: shape(I, ['content', 'displayPath', 'filename']),
  directory: shape(I, ['content', 'displayPath', 'path']),
  pdf_reference: shape(I, ['displayPath', 'fileSize', 'filename', 'pageCount']),
  compact_file_reference: shape(I, ['displayPath', 'filename']),
  // Its class is decided by its closed `commandMode` below.
  // D150: `commandMode` may be absent only on a command the recorder flagged `isMeta: true` (below).
  queued_command: shape(null, ['prompt'], ['commandMode', 'origin', 'source_uuid', 'timestamp', 'humanTurn',
    'isMeta', 'usage', 'delivery_id', 'reminderId', 'runId']),
});
const QUEUED_COMMAND_CLASSES = Object.freeze({ prompt: I, 'task-notification': O });
const ATTACHMENT_ROW_KEYS = Object.freeze(['attachment', 'cwd', 'entrypoint', 'gitBranch', 'isSidechain',
  'parentUuid', 'sessionId', 'timestamp', 'type', 'userType', 'uuid', 'version']);
// `rendered` is absent from 2.1.234–2.1.258 rows; `slug` names a titled session; `agentId` is on
// every child row of 2.1.260–2.1.284 (checked against the recording's own child identity below).
// D72: `renderedRole` and `renderedBesideToolResult` from 2.1.286 (CLAUDE_RENDERED_ROLES).
const ATTACHMENT_ROW_OPTIONAL = Object.freeze(['rendered', 'slug', 'agentId', 'renderedRole',
  'renderedBesideToolResult']);
/**
 * D72 (2026-10-09, M43 reader): the closed values of a 2.1.286+ attachment row's `renderedRole` — the role the
 * recorder rendered the row's `rendered` blocks in for the model, `system` or `user`; it sits on exactly the rows that
 * carry `rendered`. It is a rendering fact, not
 * an author: the human's own queued prompts and @-mentioned files are rendered `system`, and `user` is carried
 * only by harness context (`instructions`, `session_context`, `remote_session_change`). It is therefore listed as data
 * and never read for a class or a label. `renderedBesideToolResult` (2.1.289+, 59 rows, all `true`, on
 * `remote_session_change`) is a boolean placement fact of the same kind. Another value, a `renderedRole` with no
 * `rendered`, or a non-boolean placement stays unclassified (fail closed, `unclassifiedRows`). The placement fact
 * alone does not require `rendered`; unlike `renderedRole`, it has no dependency on the rendered blocks.
 */
export const CLAUDE_RENDERED_ROLES = Object.freeze(['system', 'user']);
const renderedBlocks = (value) => value === undefined || Array.isArray(value) && value.length > 0
  && value.every((block) => exactKeys(block, ['content']) && typeof block.content === 'string');
const renderedFacts = (row) => (row.renderedRole === undefined
  || CLAUDE_RENDERED_ROLES.includes(row.renderedRole) && row.rendered !== undefined)
  && (row.renderedBesideToolResult === undefined || typeof row.renderedBesideToolResult === 'boolean');
/** The row's own agentId, when it may carry one: only a sidechain row, only a valid value. The caller
 *  admits it only if it equals the recording's single child identity at the end of the read.
 *  D150: a row that records no `isSidechain` at all may carry one too. The recorder writes its request rows
 *  (`api-request`, `api-request-shape`, `api-request-blob`) without that key, and a helper's own carry its agentId; the
 *  key's absence is the recorder's structure, a recorded `false` beside an agentId is not (it stays refused). Such a row
 *  is admitted as the recording's own only by the same end-of-read check: its agentId is the recording's single child
 *  identity. */
function rowAgent(row) {
  if (!Object.hasOwn(row, 'agentId')) return { ok: true, agentId: null };
  return (row.isSidechain === true || !Object.hasOwn(row, 'isSidechain')) && validAgentId(row.agentId)
    ? { ok: true, agentId: row.agentId } : { ok: false, agentId: null };
}
/**
 * D128 (A05+B23+D6; the owner, 2026-10-22): a Claude row of a form no list in this file
 * names — a row type, an attachment type or a system subtype the reader does not list, or a listed one with a key it
 * does not list or without one it lists — is read by its structure, never by its name. The parts of the row that no
 * list names are tested for whether they can hold session content (`canHoldSessionContent`): a string that is not a
 * token (more than CLAUDE_TOKEN_MAX_LENGTH UTF-16 code units, or any white space), a value or a key alike (D128's review:
 * the recorder keys free text too, as a question's answers by the question), a key of the recorder's own conversation
 * carriers (CLAUDE_CONTENT_CARRIERS), or an object whose `type` is one of the recorder's content blocks
 * (CLAUDE_CONTENT_BLOCK_TYPES), at any depth. A row whose unlisted parts cannot hold session content is harness context:
 * counted (`harnessContextRows`, never a loss; a listed attachment type keeps its own class) and named by its kind and
 * recorder version in the recorder census (`meta.structuralRows`; labels.js RECORDER_CENSUS_REASONS.rowReadByStructure).
 * A row whose unlisted parts can stays unclassified (`unclassifiedRows`, fail closed): a new row that carries message
 * text under a new key still marks the recording incomplete. What stays strict: a queued command (its class rests on its
 * typed `commandMode`, and a human's queued words ride on it), an attachment row's envelope and rendering facts, and a
 * row that carries a message channel. An attachment's `rendered` blocks are the recorder's rendering of its payload for
 * the model: the payload is tested, its rendering is not (D128 judgment call 1). A token can still be one word of a
 * person's (D128 judgment call 6: no structure tells `commit` from `acceptEdits`); a row that holds only such words reads
 * as harness context.
 *
 * CLAUDE_TOKEN_MAX_LENGTH: 64, the length of a SHA-256 digest in hex, the longest identifier a recorder row was seen to
 * carry (2.1.303's request digests); a uuid is 36 and a timestamp 24. A frozen literal, never fitted per repository.
 */
export const CLAUDE_TOKEN_MAX_LENGTH = 64;
/** D128: the recorder's own conversation carriers — the keys a turn's words, calls or results ride on (`message`, and
 *  the alternate carriers this reader already refuses on a conversation row, below). */
export const CLAUDE_CONTENT_CARRIERS = Object.freeze(['message', 'content', 'body', 'payload', 'tool']);
/** D128: the recorder's content block types (a message's `content` blocks, as the API names them). */
export const CLAUDE_CONTENT_BLOCK_TYPES = Object.freeze(['text', 'image', 'document', 'audio', 'tool_use',
  'tool_result', 'thinking', 'redacted_thinking']);
/** D128: the row envelope — the recorder's identity facts on a row. A scalar under one of these keys is never tested
 *  (a working directory may hold a space); an object or an array under one is. */
const CLAUDE_ROW_ENVELOPE = Object.freeze(['cwd', 'entrypoint', 'gitBranch', 'isSidechain', 'parentUuid', 'sessionId',
  'timestamp', 'type', 'userType', 'uuid', 'version', 'slug', 'agentId']);
const WHITE_SPACE = /\s/u;
const isToken = (value) => value.length <= CLAUDE_TOKEN_MAX_LENGTH && !WHITE_SPACE.test(value);
/**
 * D128: whether a JSON value can hold session content, by structure alone: a string that is not a token, an object with
 * a key that is not a token (D128's review) or a key in CLAUDE_CONTENT_CARRIERS, or an object whose `type` is in
 * CLAUDE_CONTENT_BLOCK_TYPES, at any depth. A number, a boolean, null, a token, and arrays and objects of them keyed by
 * tokens cannot. Pure; iterative, so depth costs no stack.
 */
export function canHoldSessionContent(value) {
  const stack = [value];
  while (stack.length) {
    const next = stack.pop();
    if (typeof next === 'string') { if (!isToken(next)) return true; continue; }
    if (next === null || typeof next !== 'object') continue;
    if (Array.isArray(next)) { for (const item of next) stack.push(item); continue; }
    if (CLAUDE_CONTENT_CARRIERS.some((key) => Object.hasOwn(next, key))
      || CLAUDE_CONTENT_BLOCK_TYPES.includes(next.type)) return true;
    for (const [key, item] of Object.entries(next)) { if (!isToken(key)) return true; stack.push(item); }
  }
  return false;
}
/** D128: whether any `[key, value]` pair can hold session content: its key is a conversation carrier or not a token, or
 *  its value can (`canHoldSessionContent`). */
const unlistedHoldContent = (pairs) => pairs.some(([key, value]) => CLAUDE_CONTENT_CARRIERS.includes(key)
  || !isToken(key) || canHoldSessionContent(value));
/**
 * D150: the recorder's record of a model request's shape (Claude Code 2.1.303 and later), `api-request-shape`: the
 * request's system prompt and its tool definitions (`shape`, exactly `system` and `tools`), stored once under their hash
 * (`shapeHash`). What the harness gave the model, as a `prompt_snapshot` attachment's `systemPrompt` and `tools` are:
 * harness context, listed by its keys. Its words are never read. Another key on the row or in `shape` (a request's
 * messages above all) is no listed form: the row is read by its structure, as before (`claudeOtherRow`).
 */
const REQUEST_SHAPE_ROW = Object.freeze({ type: 'api-request-shape',
  required: Object.freeze(['sessionId', 'shape', 'shapeHash', 'timestamp', 'type', 'version']),
  optional: Object.freeze(['agentId']), shape: Object.freeze(['system', 'tools']) });
const requestShapeRow = (row) => row.type === REQUEST_SHAPE_ROW.type
  && keySet(row, REQUEST_SHAPE_ROW.required, REQUEST_SHAPE_ROW.optional) && exactKeys(row.shape, REQUEST_SHAPE_ROW.shape)
  && ['sessionId', 'shapeHash', 'timestamp', 'version'].every((key) => typeof row[key] === 'string');
/**
 * D150: the recorder's copy of one message of a model request (Claude Code 2.1.303 and later), `api-request-blob`, of its
 * listed form: exactly `hash`, `message`, `sessionId`, `type` (and an `agentId` the row may carry, `rowAgent`), a
 * `message` of exactly `role` (a string) and `content` (a string or a list), and an `output_config` that can hold no
 * session content. Its class stays unclassified (its message can hold content: `claudeOtherRow`); its label decides
 * (`claudeLabeller`): harness when every block of its message has its structural twin in the same recording
 * (request-copies.js, LABEL_BASIS `request_copy`), else no label and the gap `unknown_row`. The reader counts it at the
 * end of the read by that label (`readClaudeSession`).
 */
export const REQUEST_BLOB_TYPE = 'api-request-blob';
export function requestBlobRow(row) {
  return plainObject(row) && row.type === REQUEST_BLOB_TYPE && keySet(row, ['hash', 'message', 'sessionId', 'type'], ['agentId'])
    && typeof row.hash === 'string' && typeof row.sessionId === 'string'
    && keySet(row.message, ['content', 'role'], ['output_config']) && typeof row.message.role === 'string'
    && (typeof row.message.content === 'string' || Array.isArray(row.message.content))
    && !canHoldSessionContent(row.message.output_config) && rowAgent(row).ok;
}
/** The message channels a row outside the conversation carries (`message.role` and its content blocks): `instructions`
 *  and `commentary` for a user's or an assistant's prose, `actions` for a tool call, `observations` for a result. */
function messageChannels(d) {
  const blocks = d.message?.content;
  const role = d.message?.role;
  const has = (types) => Array.isArray(blocks) && blocks.some((block) => types.includes(block?.type));
  const prose = typeof blocks === 'string' && !!blocks.trim() || has(['text', 'image', 'document', 'audio']);
  const channels = [];
  if (role === 'user' && prose) channels.push('instructions');
  if (role === 'assistant' && prose) channels.push('commentary');
  if (has(['tool_use'])) channels.push('actions');
  if (has(['tool_result'])) channels.push('observations');
  return channels;
}
/** D128: a row of a type this reader does not list (not a conversation row, an attachment, a queue operation or a listed
 *  metadata row, which the caller tries first), read by its structure: harness context when nothing beside its envelope
 *  can hold session content, else null (unclassified). Its kind is its row type. D150: an `api-request-shape` row of its
 *  listed form (`requestShapeRow`) is harness context, not read by its structure. */
function claudeOtherRow(row) {
  if (typeof row.type !== 'string' || KEPT_TYPES.has(row.type) || row.type === 'attachment') return null;
  if (requestShapeRow(row)) {
    const agent = rowAgent(row);
    return agent.ok ? { cls: H, agentId: agent.agentId } : null;
  }
  const unlisted = Object.entries(row).filter(([key, value]) => !(CLAUDE_ROW_ENVELOPE.includes(key)
    && (value === null || typeof value !== 'object')));
  if (unlistedHoldContent(unlisted)) return null;
  const agent = rowAgent(row);
  return agent.ok ? { cls: H, agentId: agent.agentId, structural: row.type } : null;
}
/** A Claude attachment row: its class and the agentId it carries, or null (unclassified). D128: one of a listed form
 *  (`listedAttachment`), else one read by its structure (`structuralAttachment`). */
function claudeAttachment(row) {
  if (row.type !== 'attachment' || row.userType !== 'external' || typeof row.isSidechain !== 'boolean') return null;
  return listedAttachment(row) ?? structuralAttachment(row);
}
/** D128: an attachment row that no listed form fits, read by its structure: the payload keys its type does not list
 *  (every key but `type` for a type not listed) and the row keys no attachment row lists. Harness context, or the listed
 *  type's own class, when none of them can hold session content; else null. Never a queued command (above); the
 *  rendering facts and the agentId are checked as for a listed row. Its kind is `attachment.<type>`. */
function structuralAttachment(row) {
  const item = row.attachment;
  if (!plainObject(item) || typeof item.type !== 'string' || item.type === 'queued_command') return null;
  if (!renderedBlocks(row.rendered) || (row.slug !== undefined && typeof row.slug !== 'string')
    || !renderedFacts(row)) return null;
  const known = Object.hasOwn(CLAUDE_ATTACHMENTS, item.type) ? CLAUDE_ATTACHMENTS[item.type] : null;
  const listed = known ? [...known.required, ...known.optional] : ['type'];
  const rowListed = [...ATTACHMENT_ROW_KEYS, ...ATTACHMENT_ROW_OPTIONAL];
  if (unlistedHoldContent([...Object.entries(item).filter(([key]) => !listed.includes(key)),
    ...Object.entries(row).filter(([key]) => !rowListed.includes(key))])) return null;
  const agent = rowAgent(row);
  return agent.ok ? { cls: known ? known.cls : H, agentId: agent.agentId, structural: `attachment.${item.type}` } : null;
}
/** An attachment row of a listed form: its class and the agentId it carries, or null. */
function listedAttachment(row) {
  const item = row.attachment;
  const known = plainObject(item) && typeof item.type === 'string' && Object.hasOwn(CLAUDE_ATTACHMENTS, item.type)
    ? CLAUDE_ATTACHMENTS[item.type] : null;
  if (!known || !keySet(item, known.required, known.optional)) return null;
  const queued = item.type === 'queued_command';
  if (!keySet(row, ATTACHMENT_ROW_KEYS, queued ? [...ATTACHMENT_ROW_OPTIONAL, 'renderedInHumanTurn']
    : ATTACHMENT_ROW_OPTIONAL)) return null;
  if (!renderedBlocks(row.rendered) || (row.slug !== undefined && typeof row.slug !== 'string')
    || !renderedFacts(row)) return null;
  // A queued command's `renderedInHumanTurn` is the same block list as `rendered` (as recorded).
  // D150: a queued command with no `commandMode` is listed only when the recorder flagged it `isMeta: true` (a reminder
  // it wrote itself, as Release fix 3b reads every `isMeta` queued command): harness context. Any other stays unclassified.
  const meta = queued && item.commandMode === undefined && item.isMeta === true;
  if (queued && (row.renderedInHumanTurn !== undefined && !renderedBlocks(row.renderedInHumanTurn)
    || typeof item.prompt !== 'string' || !meta && (typeof item.commandMode !== 'string'
    || !Object.hasOwn(QUEUED_COMMAND_CLASSES, item.commandMode)))) return null;
  // D72 (R1R review): `reminderId` and `runId` are listed only in the co-occurrence the recorder writes:
  // `reminderId` on a command the recorder flagged `isMeta: true`, `runId` on a `task-notification`. Elsewhere, above all beside a `prompt` of human origin (which the labeller reads as the human's own
  // words), either key stays unclassified: a reminder or a workflow run is not shown to be a human (fail closed).
  if (queued && (Object.hasOwn(item, 'reminderId') && item.isMeta !== true
    || Object.hasOwn(item, 'runId') && item.commandMode !== 'task-notification')) return null;
  const agent = rowAgent(row);
  if (!agent.ok) return null;
  return { cls: meta ? H : queued ? QUEUED_COMMAND_CLASSES[item.commandMode] : known.cls, agentId: agent.agentId };
}
/** The one new system row that carries no conversation: an API retry notice. Harness
 *  context, counted like an attachment. `informational` and `model_refusal_fallback` carry text or
 *  retract messages, so they stay unclassified. */
const SYSTEM_ROW_KEYS = Object.freeze(['cwd', 'entrypoint', 'gitBranch', 'isSidechain', 'parentUuid',
  'sessionId', 'timestamp', 'type', 'userType', 'uuid', 'version', 'subtype']);
/** A system row that is no conversation: the API retry notice, else (D128) one read by its structure — harness context
 *  when nothing beside its envelope can hold session content (`content` is a carrier: an `informational`, a
 *  `local_command` output or a `model_refusal_*` row stays unclassified), else null. Its kind is `system.<subtype>`. */
function claudeSystemNotice(row) {
  if (row.type !== 'system' || typeof row.isSidechain !== 'boolean') return null;
  const notice = apiErrorNotice(row);
  if (notice) return notice;
  const unlisted = Object.entries(row).filter(([key, value]) => !(CLAUDE_ROW_ENVELOPE.includes(key)
    && (value === null || typeof value !== 'object')));
  if (unlistedHoldContent(unlisted)) return null;
  const agent = rowAgent(row);
  return agent.ok ? { cls: H, agentId: agent.agentId,
    structural: typeof row.subtype === 'string' ? `system.${row.subtype}` : 'system' } : null;
}
function apiErrorNotice(row) {
  if (row.subtype !== 'api_error') return null;
  if (!keySet(row, [...SYSTEM_ROW_KEYS, 'error', 'level', 'maxRetries', 'retryAttempt', 'retryInMs'],
    ['slug', 'source', 'agentId'])) return null;
  if (!plainObject(row.error) || typeof row.level !== 'string'
    || !['maxRetries', 'retryAttempt', 'retryInMs'].every((key) => Number.isFinite(row[key]))
    || (row.source !== undefined && typeof row.source !== 'string')
    || (row.slug !== undefined && typeof row.slug !== 'string')) return null;
  const agent = rowAgent(row);
  return agent.ok ? { cls: H, agentId: agent.agentId } : null;
}
function knownMechanicalAttachment(row) {
  return claudeAttachment(row)?.cls === H;
}
function knownQueueRow(row) {
  if (row.type !== 'queue-operation' || typeof row.operation !== 'string') return false;
  if (row.operation === 'dequeue')
    return exactKeys(row, ['operation', 'sessionId', 'timestamp', 'type']);
  if (row.operation === 'enqueue' || row.operation === 'remove') {
    // M33 D: an enqueue/remove may record no content at all (as recorded): nothing to read.
    if (exactKeys(row, ['operation', 'sessionId', 'timestamp', 'type'])) return true;
    // D72 (M43 reader): from 2.1.286 a `remove` that absorbed a queued prompt mid-turn also names the delivery it
    // removed (`deliveryId`, the queued command's `delivery_id`; `commandUuid`, its `source_uuid`): 586 rows, every one
    // with a `reason`. Listed as data; the labeller still matches a removal by its content only.
    if (row.operation === 'remove' && exactKeys(row, ['commandUuid', 'content', 'deliveryId', 'operation', 'reason',
      'sessionId', 'timestamp', 'type'])) return ['commandUuid', 'content', 'deliveryId', 'reason']
      .every((key) => typeof row[key] === 'string');
    const keys = row.reason === undefined
      ? ['content', 'operation', 'sessionId', 'timestamp', 'type']
      : ['content', 'operation', 'reason', 'sessionId', 'timestamp', 'type'];
    return exactKeys(row, keys) && typeof row.content === 'string'
      && (row.reason === undefined || typeof row.reason === 'string');
  }
  return false;
}
function knownMetadataRow(row) {
  switch (row.type) {
    case 'mode':
      return exactKeys(row, ['mode', 'sessionId', 'type']);
    case 'atis-latch':
      return exactKeys(row, ['atis', 'sessionId', 'type']);
    case 'custom-title':
      return exactKeys(row, ['customTitle', 'sessionId', 'type'])
        && typeof row.customTitle === 'string';
    case 'ai-title':
      return exactKeys(row, ['aiTitle', 'sessionId', 'type'])
        && typeof row.aiTitle === 'string';
    case 'last-prompt':
      return exactKeys(row, ['lastPrompt', 'leafUuid', 'sessionId', 'type'])
        && typeof row.lastPrompt === 'string'
        || exactKeys(row, ['leafUuid', 'sessionId', 'type']);   // M33 D: no prompt text recorded
    // M33 D: recording bookkeeping rows with no conversation carrier (known key sets).
    case 'bridge-session':
      return exactKeys(row, ['bridgeSessionId', 'lastSequenceNum', 'sessionId', 'type'])
        || exactKeys(row, ['bridgeSessionId', 'lastSequenceNum', 'ownerAccountUuid',
          'ownerOrganizationUuid', 'sessionId', 'type']);
    case 'artifact-autoreact-ledger':
      return exactKeys(row, ['accountUuid', 'artifacts', 'sessionId', 'type', 'v']);
    case 'artifact-comment-monitor':
      return exactKeys(row, ['artifacts', 'sessionId', 'type', 'v']);
    case 'agent-name':
      return exactKeys(row, ['agentName', 'sessionId', 'type'])
        && typeof row.agentName === 'string';
    case 'file-history-snapshot':
      return (exactKeys(row, ['isSnapshotUpdate', 'messageId', 'snapshot', 'type'])
        || exactKeys(row, ['sessionId', 'snapshot', 'type']))
        && row.snapshot !== null && typeof row.snapshot === 'object'
        && !Array.isArray(row.snapshot);
    case 'file-history-delta':
      return exactKeys(row, ['backup', 'messageId', 'snapshotMessageId',
        'timestamp', 'trackingPath', 'type']);
    case 'frame-link':
      return exactKeys(row, ['artifactCount', 'sessionId', 'timestamp', 'type'])
        || exactKeys(row, ['artifactCount', 'frameUrl', 'path', 'sessionId',
          'timestamp', 'title', 'type'])
        || exactKeys(row, ['frameUrl', 'path', 'sessionId', 'timestamp', 'title', 'type']);
    case 'cost-state':
      return exactKeys(row, ['hasUnknownModelCost', 'modelUsage', 'sessionId',
        'startTime', 'totalAPIDuration', 'totalAPIDurationWithoutRetries',
        'totalCostUSD', 'totalDuration', 'totalLinesAdded', 'totalLinesRemoved',
        'totalToolDuration', 'type']);
    case 'summary':
      return exactKeys(row, ['sessionId', 'summary', 'type'])
        && typeof row.summary === 'string';
    case 'progress':
      return exactKeys(row, ['data', 'sessionId', 'type'])
        && exactKeys(row.data, ['type']) && row.data.type === 'hook_progress';
    default:
      return false;
  }
}
const isOrdinaryScaffoldRow = (row) => knownMechanicalAttachment(row) || knownQueueRow(row)
  || knownMetadataRow(row);
/** The alternate carriers a conversation or system row may not carry: a turn moved into one is not read. */
const ALTERNATE_CARRIERS = Object.freeze(['body', 'content', 'payload', 'tool']);
/** A system row the reader keeps as a record and classifies neither way: a `stop_hook_summary` with no alternate carrier
 *  and no message content. */
const keptSystemRow = (row) => row.type === 'system' && row.subtype === 'stop_hook_summary'
  && !ALTERNATE_CARRIERS.some((key) => Object.hasOwn(row, key))
  && typeof row.message?.content !== 'string' && !Array.isArray(row.message?.content);

/** A `user` or `assistant` row whose turn the reader cannot read where it reads one: a user row with no content, a role
 *  that is not its type, or an alternate carrier (unclassified). */
const driftedTurn = (row) => (row.type === 'user' || row.type === 'assistant')
  && (row.type === 'user' && row.message?.content == null
    || row.message?.role != null && row.message.role !== row.type
    || ALTERNATE_CARRIERS.some((key) => Object.hasOwn(row, key)));
/** D128's review: whether the reader keeps this Claude row as a record and counts it neither way (no harness context, no
 *  declared loss, not unclassified): a compaction marker, a `user` or `assistant` row that is not drifted
 *  (`driftedTurn`), or an ordinary `stop_hook_summary` (`keptSystemRow`). As a main recording's reader reads it (a
 *  helper's row in a parent's recording is skipped by its kind). Pure. */
export function claudeRecordRow(row) {
  if (row === null || typeof row !== 'object' || Array.isArray(row)) return false;
  if (isCompactionMarker(row)) return true;
  if (row.type === 'user' || row.type === 'assistant') return !driftedTurn(row);
  return keptSystemRow(row);
}
/**
 * C-03 M33 D: how this reader classifies one Claude row outside the conversation turns — pure, so
 * tests and count-only probes can name a row's class without reading a recording. Returns
 * `{cls, agentId}` for a typed attachment or system notice (`cls` from CLAUDE_ROW_CLASSES; an agentId
 * still has to equal the recording's own child identity), `{cls: 'metadata', agentId: null}` for
 * recording bookkeeping (`metadata`: scaffold, not counted, as before M33 D), or null (unclassified).
 * D128: a row read by its structure carries `structural`, its kind (`attachment.<type>`, `system.<subtype>` or its row
 * type), beside its class. D128's review: a row the reader keeps as a record and does not classify (a conversation row,
 * a compaction marker, an ordinary `stop_hook_summary`) is not one this names: null, as before D128, so a probe that
 * counts what this returns counts what the reader does (`claudeRecordRow` says which rows those are).
 */
export function claudeRowClass(row) {
  if (row === null || typeof row !== 'object' || Array.isArray(row) || claudeRecordRow(row)) return null;
  const typed = claudeAttachment(row) ?? claudeSystemNotice(row);
  if (typed) return typed;
  if (knownQueueRow(row) || knownMetadataRow(row)) return { cls: CLAUDE_ROW_CLASSES.metadata, agentId: null };
  return claudeOtherRow(row);
}

/**
 * Stream one session file into normalised records.
 * Malformed lines are counted, never thrown.
 *
 * @returns {Promise<{records: object[], meta: object, corrupt: number}>}
 */
export async function readSession(file, { sidechainAsMain = undefined, childRecording = false,
  noForkChildProof = null, throughUuid = null, byteEnd = null } = {}) {
  // Codex rollouts are a different schema entirely. Route before parsing, not after failing.
  // D142: with `byteEnd`, only the file's first `byteEnd` bytes are read (recording-stream.js).
  const { isCodexRollout, readCodexSession } = await import('./codex.js');
  if (isCodexRollout(file)) return readCodexSession(file, { childRecording, noForkChildProof, byteEnd });
  // Cursor transcripts are Claude-style JSONL with quirks (role vs type, wrapped user text,
  // omitted tool outputs). Route by their session-dir convention, same idea as the rollout check.
  const { isCursorSession, readCursorSession } = await import('./cursor.js');
  if (isCursorSession(file)) return readCursorSession(file);
  const claude = await readClaudeSession(file, { sidechainAsMain, childRecording, throughUuid, byteEnd });
  // Imported rollouts may lose the native filename/path convention. A short Codex file used
  // to produce zero Claude records without reaching the >=10-row unknown-schema threshold.
  if (claude.records.length === 0 && await hasCodexRows(file, byteEnd))
    return readCodexSession(file, { childRecording, noForkChildProof, byteEnd });
  return claude;
}

async function hasCodexRows(file, byteEnd = null) {
  const rl = createInterface({ input: recordingStream(file, byteEnd), crlfDelay: Infinity });
  let seen = 0;
  for await (const line of rl) {
    if (!line.trim()) continue;
    let row;
    try { row = JSON.parse(line); } catch { continue; }
    if (!row || typeof row !== 'object' || Array.isArray(row)) continue;
    if ((row.type === 'session_meta' || row.type === 'response_item')
      && row.payload && typeof row.payload === 'object') return true;
    if (row.type === 'user' || row.type === 'assistant') return false;
    if (++seen >= 8) break;
  }
  return false;
}

/** A row's recorded `uuid` (a non-empty string), or null. */
const rowUuid = (d) => (typeof d?.uuid === 'string' && d.uuid ? d.uuid : null);
/** Code-unit order (never locale-aware). */
const cmpUnits = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

async function readClaudeSession(file, { sidechainAsMain = undefined, childRecording = false, throughUuid = null,
  byteEnd = null } = {}) {
  const identity = recordingIdentity('claude');
  const records = [];
  // M34 labels: every row is labelled once, in recorded order (`claudeLabeller`); a row that becomes a record carries its
  // label, and one that is only counted (a harness attachment) is counted (`meta.labelled`: `{uuid, value, version}`, its
  // recorded uuid kept so a lineage counts a copied row once — M34 labels review, F8 — and its recorder version, so the
  // recorder census can count a row no reader kept by its version — D99).
  const labeller = claudeLabeller();
  const labelled = [];
  let label = null;
  const push = (rec) => { records.push(rec); labelled.push({ rec, value: label, uuid: null }); };
  const countOnly = (d) => labelled.push({ rec: null, value: label, uuid: rowUuid(d),
    version: typeof d.version === 'string' ? d.version : null });
  // M34 labels (C-02 "Slice-time labels"): whether this recording is a helper's is read from its structure, never its
  // path: the first row that records `isSidechain` says whose rows these are.
  let asMain = sidechainAsMain;
  // M34 labels review (F7): the first `isSidechain` the recording records, whoever reads it (a caller may read it whole):
  // the lineage role the slicer gives it (index.js), and the only one the CLI loader decides a helper by.
  let firstSidechain = null;
  const meta = { sessionId: null, cwd: null, version: null, gitBranch: null, file };
  let corrupt = 0;
  let lineNo = 0;
  let validLines = 0;   // parseable JSON lines, kept or not — the unknown-schema signal
  let unsupportedContentRows = 0;
  let unclassifiedRows = 0;
  const unsupportedRowChannels = { instructions: 0, commentary: 0, actions: 0, observations: 0 };
  // C-03 M33 D: harness-context rows, counted and never read; per-agentId tallies await the end.
  let harnessContextRows = 0;
  const pendingByAgent = new Map();
  const deferredBlobs = [];
  // D128: each row read by its structure, by its kind and its row's recorder version (the recorder census).
  const structuralRows = new Map();
  const readByStructure = (kind, d) => {
    const key = JSON.stringify([kind, typeof d.version === 'string' ? d.version : null]);
    structuralRows.set(key, (structuralRows.get(key) ?? 0) + 1);
  };
  // D150: each row left unread, once, in order, with whether its loss is on its channel. It is counted by its
  // kind (`UNREAD_ROW_KINDS`) once every label is settled: a row whose words are read at its record (a queued prompt or a
  // file the human attached, `interjectionWordsOf`) is then no unread row, though its loss stays counted for readers of
  // `ask`; one whose record yields no words (a PDF, an image, an empty prompt) stays one.
  const unreadList = [];
  const unreadSeen = new WeakSet();
  const unread = (d, onChannel = false) => {
    if (unreadSeen.has(d)) return;
    unreadSeen.add(d);
    unreadList.push([d, onChannel]);
  };
  const classify = ({ cls, agentId, structural }, d) => {
    if (typeof structural === 'string') readByStructure(structural, d);
    if (agentId !== null) {
      const pending = pendingByAgent.get(agentId) ?? { harness: 0, instructions: 0, observations: 0, notices: 0,
        rows: [] };
      pending[cls === H ? 'harness' : cls === NOTICE ? 'notices' : cls]++;
      pending.rows.push({ d, lost: cls !== H && cls !== NOTICE });
      pendingByAgent.set(agentId, pending);
    } else if (cls === H) harnessContextRows++;
    else if (cls !== NOTICE) {
      unsupportedContentRows++; unsupportedRowChannels[cls]++;
      unread(d, true);
    }
  };

  const rl = createInterface({
    input: recordingStream(file, byteEnd),
    crlfDelay: Infinity,
  });

  // D126 (N0): an earlier recording of a session that opens on a compaction is read through the row the compaction
  // links to (`throughUuid`, the boundary's `logicalParentUuid`) and no further: what follows it there is the later
  // recording's to read. `meta.through` says whether that row was found.
  const through = typeof throughUuid === 'string' && throughUuid ? throughUuid : null;
  let reached = false;
  for await (const line of rl) {
    if (reached) break;
    lineNo++;
    if (!line.trim()) continue;

    let d;
    try {
      d = JSON.parse(line);
          validLines++;
    } catch {
      corrupt++;
      continue;
    }
    // `null`, `42` and `"str"` are valid JSON and reach here. The fuzz test found that a single
    // bare `null` line crashed the entire session read — one bad line must cost one line, never
    // the session.
    if (d === null || typeof d !== 'object' || Array.isArray(d)) { corrupt++; continue; }
    // C-02: a row that repeats a key is not a serializer product. It costs its line, declared,
    // and its identity values make the recording identity conflicting instead of picking one.
    if (duplicateJsonKeys(line)) { corrupt++; identity.observe(d, { repeatedKeys: true }); continue; }

    identity.observe(d);
    if (through !== null && d.uuid === through) reached = true;
    // Session-level facts land on whichever record carries them first.
    if (meta.sessionId === null && typeof d.sessionId === 'string') meta.sessionId = d.sessionId;
    if (meta.cwd === null && typeof d.cwd === 'string') meta.cwd = d.cwd;
    if (meta.version === null && typeof d.version === 'string') meta.version = d.version;
    if (meta.gitBranch === null && typeof d.gitBranch === 'string') meta.gitBranch = d.gitBranch;

    // isSidechain is only ever true / null / absent. A nested subagent file is entirely sidechain,
    // so for those we deliberately promote them rather than filter them out.
    if (asMain === undefined && typeof d.isSidechain === 'boolean') asMain = d.isSidechain;
    if (firstSidechain === null && typeof d.isSidechain === 'boolean') firstSidechain = d.isSidechain;
    if (d.isSidechain === true && !asMain) {
      // The parent does not claim the child's known conversation rows. An unfamiliar row
      // may itself be the only record of a future child tool, however; silently skipping it
      // would certify the parent's source as complete without proof of that child's schema.
      // D128: a row read by its structure that can hold no session content is no unknown scope either.
      if (!KEPT_TYPES.has(d.type) && !isCompactionMarker(d)) {
        const attached = claudeAttachment(d);
        const scaffold = attached?.cls === H ? attached : knownQueueRow(d) || knownMetadataRow(d) ? {}
          : claudeOtherRow(d);
        if (!scaffold) { unclassifiedRows++; unread(d); }
        else if (typeof scaffold.structural === 'string') readByStructure(scaffold.structural, d);
      }
      continue;
    }

    // Compaction is checked BEFORE the kept-types branch, for every record. Claude Code writes
    // the in-file boundary as a `system` record with subtype `compact_boundary`, and the resumed
    // conversation as a synthetic `user` turn it marks `isCompactSummary` (H2) — both types
    // are in KEPT_TYPES, so a kept-types-first check classified them as ordinary records and no
    // mark was ever produced for a compaction that happened inside one file (H45).
    label = labeller.label(d);
    if (isCompactionMarker(d)) { push({ kind: 'compaction', line: lineNo, raw: d }); continue; }

    if (!KEPT_TYPES.has(d.type)) {
      // D150: a request blob of its listed form is counted at the end of the read, by its settled label.
      if (requestBlobRow(d)) { deferredBlobs.push({ d, value: label }); continue; }
      const channels = messageChannels(d);
      if (channels.length) {
        unsupportedContentRows++;
        for (const channel of channels) unsupportedRowChannels[channel]++;
        unread(d);
      }
      // C-03 M33 D: a typed Claude attachment is harness context (counted scaffold) or a declared
      // loss on its own channel; a row carrying an agentId waits for the recording's own identity.
      const attached = channels.length ? null : claudeAttachment(d);
      // D128: a row of a type no list names, read by its structure (`claudeOtherRow`).
      const other = channels.length || attached || isOrdinaryScaffoldRow(d) ? null : claudeOtherRow(d);
      if (attached) {
        // Release fix 3b: an instructions-class row its label gives to the harness (no gap) is harness context.
        // D150: a queued task notification (the one carrier rule, labelled an observation of a task notification) is
        // read, as one the recorder writes as a user row is: by its typed status (events.js), never as a loss.
        const notice = attached.cls === O && claudeNotificationCarrier(d) && label?.label === LABELS.observation
          && label.basis === LABEL_BASIS.taskNotification;
        // D150: a structured output its label gives to the harness as a copy of the agent's own call is harness context.
        const copy = label?.label === LABELS.harness && label.basis === LABEL_BASIS.structuredOutputCopy;
        // A queued prompt or a file the human attached whose words are read at its record (below) is no unread row: that
        // is settled with the labels (`interjectionWordsOf`), never by its label alone.
        classify(notice ? { ...attached, cls: NOTICE }
          : copy || attached.cls === I && label?.label === LABELS.harness && !Object.hasOwn(label, 'gap')
            ? { ...attached, cls: H } : attached, d);
      } else if (other) classify(other, d);
      else if ((!channels.length && !isOrdinaryScaffoldRow(d))
        || (channels.length && Object.hasOwn(d, 'body'))) {
        // A future row or separate body can carry any T/A/O channel. In a mixed file, the
        // zero-record unknown-schema guard cannot see this one row; declare unknown scope.
        unclassifiedRows++;
        unread(d);
      }
      // C-02 M33 D: a queued task notification's typed status may close the launch it names (events.js); its text is not
      // read. D150: one of a listed form is read so, as one written as a user row is (above); one whose key sets are not
      // the ones the classifier knows stays unclassified. D98 (F1): which row is one is the one carrier rule
      // every reader of the fact calls (harness-context.js `claudeNotificationCarrier`), alone. The classifier's
      // closed key sets decide only how the row's loss is counted, never whether it is a notification: a recorder key
      // added to the row or to its attachment no longer drops the notice here while the labeller still labels it.
      if (claudeNotificationCarrier(d)) push({ kind: 'notification', line: lineNo, raw: d });
      else if (attached) {
        // OWNER DECISION B (2026-10-01); M34 labels: a prompt labelled `human` + `queued` (a human's, or in a helper its
        // parent's) is read at its row too (events.js). It stays counted above: a reader of `ask` alone — every reader
        // but the evidence adapter — has still not read it, and keeps its declared loss.
        if (label?.label === LABELS.human && label.markers?.includes(MARKERS.queued))
          push({ kind: QUEUED_PROMPT_RECORD, line: lineNo, raw: d });
        // M34 labels: a file, directory or PDF the human attached (an @-mention), labelled `human` + `attached`, is read
        // at its row (events.js) as the human's; it stays counted above for every reader of `ask` alone, as a queued
        // prompt does.
        else if (label?.label === LABELS.human && label.markers?.includes(MARKERS.attached))
          push({ kind: ATTACHED_RECORD, line: lineNo, raw: d });
        // D71 (g): a typed attachment giving the agent instruction files is read at its row (events.js), for the project's
        // own files only; it keeps its harness label (counted with its record, as a queued prompt's is with its own).
        else if (INSTRUCTION_ATTACHMENTS.includes(d.attachment.type))
          push({ kind: PROJECT_INSTRUCTIONS_RECORD, line: lineNo, raw: d });
        // D150: a file changed outside the agent's edit calls (an `edited_text_file` attachment) is read at its row
        // (events.js `editedFiles`: its path and recorded snippet). Its label stays the harness's and it keeps its declared
        // loss until a reader of a review reads it: then its relabel and its place in slice_hash land together, so no
        // hash moves twice for it.
        else if (d.attachment.type === EDITED_TEXT_FILE_TYPE)
          push({ kind: EDITED_FILE_RECORD, line: lineNo, raw: d });
        else if (label) countOnly(d);
      }
      // M34 labels: any other attachment row (one this reader does not classify included) is still counted by its label.
      else if (label && d.type === 'attachment') countOnly(d);
      continue;
    }

    // A familiar row type alone does not mean its payload was read. Claude can move a
    // user/assistant turn into a new top-level carrier while leaving type unchanged.
    if (driftedTurn(d)) { unclassifiedRows++; unread(d); }
    if (d.type === 'system' && !keptSystemRow(d)) {
      const notice = claudeSystemNotice(d);
      if (notice) classify(notice, d);
      else { unclassifiedRows++; unread(d); }
    }

    push({ kind: d.type, line: lineNo, raw: d });
  }
  // M34 labels: settle the recording-wide labels, then put each on its record (with the row's own lineage).
  labeller.finish();
  // D150: each request blob by its settled label. One labelled harness (a request copy; or, D142, a row of Sonah's own
  // turn) is harness context, its agentId waiting for the recording's own identity as any row's does. Any other is
  // counted as before: a declared loss on each channel its message carries, else unclassified.
  for (const { d, value } of deferredBlobs) {
    if (value?.label === LABELS.harness) { classify({ cls: H, agentId: rowAgent(d).agentId }, d); continue; }
    const channels = messageChannels(d);
    if (channels.length) {
      unsupportedContentRows++;
      for (const channel of channels) unsupportedRowChannels[channel]++;
    } else unclassifiedRows++;
    unread(d);
  }
  const counted = [];
  // D142: a row of Sonah's own turn is not read: no record is kept of it, and it is counted by its label, so the
  // command is no ask, and nothing the agent did or said in that turn is an action, an observation or a claim.
  const notRead = new Set();
  for (const { rec, value, uuid, version } of labelled) {
    if (value === null) continue;
    const lineage = (rec?.raw ?? null)?.isSidechain === true ? LINEAGE_ROLES.helper : LINEAGE_ROLES.root;
    if (rec && value.basis === LABEL_BASIS.sonahTurn) {
      notRead.add(rec);
      counted.push({ uuid: rowUuid(rec.raw), value, version: typeof rec.raw?.version === 'string' ? rec.raw.version : null });
    } else if (rec) applyLabel(rec, value, lineage);
    else counted.push({ uuid, value, version });
  }
  if (notRead.size) records.splice(0, records.length, ...records.filter((rec) => !notRead.has(rec)));
  meta.labelled = counted;
  // D99 (F1 guard): how many lines this read took, so a second read of the file (background-ends.js) reads the same.
  meta.lines = lineNo;
  if (through !== null) meta.through = reached;
  // D128: the rows read by their structure, `{ kind, version, count }` in code-unit order (the recorder census); only
  // when there is one.
  if (structuralRows.size) meta.structuralRows = [...structuralRows].map(([key, count]) => {
    const [kind, version] = JSON.parse(key);
    return { kind, version, count };
  }).sort((a, b) => cmpUnits(a.kind, b.kind) || cmpUnits(a.version ?? '', b.version ?? ''));
  // M34 labels review (F7): a helper's recording by its rows (the first row that records `isSidechain` records true).
  if (firstSidechain === true) meta.helperRows = true;
  // C-03 M33 D: a classified row that carried an agentId is this recording's own only when that
  // agentId is its single child identity. Any other agentId is another agent's row: unclassified.
  const ownChild = identity.value().childId;
  for (const [agentId, pending] of pendingByAgent) {
    if (agentId === ownChild) {
      harnessContextRows += pending.harness;
      for (const channel of ['instructions', 'observations']) {
        unsupportedContentRows += pending[channel];
        unsupportedRowChannels[channel] += pending[channel];
      }
      for (const { d, lost } of pending.rows) if (lost) unread(d, true);
    } else {
      unclassifiedRows += pending.harness + pending.instructions + pending.observations + pending.notices;
      for (const { d } of pending.rows) unread(d);
    }
  }
  // D150: the rows left unread by kind, in UNREAD_ROW_KINDS order; only when there is one. A row whose loss
  // is on its channel and whose words are read at its record (`interjectionWordsOf`, on its settled label) is read.
  const readAtRecord = new WeakSet(records.filter((rec) => interjectionWordsOf(rec) !== '').map((rec) => rec.raw));
  const unreadRows = new Map();
  for (const [d, onChannel] of unreadList) {
    if (onChannel && readAtRecord.has(d)) continue;
    const kind = unreadKindOf(d);
    unreadRows.set(kind, (unreadRows.get(kind) ?? 0) + 1);
  }
  if (unreadRows.size) meta.unreadRows = Object.fromEntries(Object.values(UNREAD_ROW_KINDS)
    .filter((kind) => unreadRows.has(kind)).map((kind) => [kind, unreadRows.get(kind)]));

  // A transcript full of valid JSON that yields ZERO records is not an empty session — it is a
  // schema this parser does not speak (locality audit: an unadapted harness must be a declared
  // incapacity, never an empty ledger indistinguishable from "no work happened").
  // A short, parseable foreign recording is still an unsupported source, not a complete
  // zero-event session. Metadata-only files are likewise unable to certify that no work ran.
  const unknownSchema = records.length === 0 && validLines > 0;
  if (unsupportedContentRows > 0 || unclassifiedRows > 0) {
    const { SLICE_REASONS } = await import('../index.js');
    meta.capture = { incomplete: true, reasons: [SLICE_REASONS.CAPTURE_INCOMPLETE],
      unsupportedContentRows, unsupportedRowChannels,
      ...(unclassifiedRows ? { unclassifiedRows } : {}), attributedIncomplete: true };
  }
  // C-03 M33 D: counted, not a loss. It never makes a capture incomplete on its own.
  if (harnessContextRows > 0)
    meta.capture = { ...(meta.capture ?? { incomplete: false, reasons: [] }), harnessContextRows };
  if (childRecording) {
    // A child record carries two markers: `isSidechain:true` and the child's own agentId.
    //   both    — the child's record, kept.
    //   one     — drift: child-origin, damaged shape. Dropped and DECLARED, and the rest of the
    //             child survives (F52: one vendor schema drift used to empty a linked child).
    //   neither — inherited main-thread history, whose provenance this file cannot settle. With
    //             no single child identity or no record of the child's own, the same holds. The
    //             whole history is withheld as unchecked, exactly as before.
    //
    // Both reasons are read from the slicer's declared table (F15, F111); imported here, as
    // codex.js is above, so the table's module and this one do not import each other at load time.
    const { SLICE_REASONS } = await import('../index.js');
    const childId = identity.value().childId;
    const own = (record) => record.raw?.isSidechain === true && record.raw?.agentId === childId;
    const marked = (record) => record.raw?.isSidechain === true || record.raw?.agentId === childId;
    if (!childId || !records.some(own) || !records.every(marked)) {
      return { records: [], meta: { ...meta, sourceIdentity: identity.value(),
        capture: { ...meta.capture, incomplete: true, attributedIncomplete: false,
          reasons: [...new Set([...(meta.capture?.reasons ?? []), SLICE_REASONS.CHILD_HISTORY_UNCHECKED])] } },
      corrupt, unknownSchema };
    }
    const kept = records.filter(own);
    if (kept.length < records.length) {
      return { records: kept, meta: { ...meta, sourceIdentity: identity.value(),
        capture: { ...meta.capture, incomplete: true, attributedIncomplete: false,
          reasons: [...new Set([...(meta.capture?.reasons ?? []), SLICE_REASONS.CHILD_HISTORY_PARTIAL])] } },
      corrupt, unknownSchema };
    }
  }
  return { records, meta: { ...meta, sourceIdentity: identity.value() }, corrupt, unknownSchema };
}

/**
 * Claude Code writes compaction as a system record or as a summary user row it marks `isCompactSummary`; Codex as a
 * field. H2: read by those recorded marks only, never by the summary's opening words.
 * The continuation sentence (and a `<compact` opening) matched only rows marked `isCompactSummary`, so the sentence
 * rule added nothing and was deleted.
 */
export function isCompactionMarker(d) {
  if (d.type === 'compaction' || d.subtype === 'compact_boundary') return true;
  if (d.compacted === true) return true;
  return d.isCompactSummary !== undefined && d.isCompactSummary !== false;
}

/**
 * Pull plain text out of a record whose content may be a string or a block array.
 * Returns '' rather than throwing on any shape we do not recognise.
 */
export function textOf(d) {
  const m = d?.message ?? d;
  const c = m?.content;
  if (typeof c === 'string') return c;
  if (!Array.isArray(c)) return '';
  return c
    .filter((b) => b && b.type === 'text' && typeof b.text === 'string')
    .map((b) => b.text)
    .join('\n');
}

/** Tool-use blocks in an assistant record. One record may carry several. */
export function toolUsesOf(d) {
  const c = d?.message?.content;
  if (!Array.isArray(c)) return [];
  return c.filter((b) => b && b.type === 'tool_use' && typeof b.name === 'string');
}

/**
 * Tool results live on the FOLLOWING user record, either as content blocks or on `toolUseResult`.
 * Returns a map of tool_use_id -> {text, isError}.
 *
 * `is_error` absence is not the same as false — a backgrounded Bash returns a stub with no error
 * flag at all and its real output arrives later as a separate record.
 */
export function toolResultsOf(d) {
  const out = new Map();
  const c = d?.message?.content;
  if (Array.isArray(c)) {
    for (const b of c) {
      if (!b || b.type !== 'tool_result') continue;
      // The content block is what the assistant received. `toolUseResult` can be a richer
      // native sidecar, so keep it separate from text used for a quotable observation.
      const visible = visibleToolContent(b.content);
      const prior = out.get(b.tool_use_id);
      // M33 D: an explicit `is_error: false` is a recorded fact, unlike an absent flag. Every
      // repeated block of one result must record it for the result to carry it.
      const next = { text: visible.text, visibleText: visible.text, visibleSpans: visible.spans,
        isError: b.is_error === true, isErrorFalse: b.is_error === false,
        nonText: visible.nonText, visibleNonText: visible.nonText,
        outcomeUnknown: d?.outcomeUnknown === true };
      // A Map overwrite used to turn a recorded failure followed by a conflicting success
      // into one apparently settled result. Identical repeats are harmless; disagreement is
      // an observation that cannot be attributed to one terminal outcome.
      const visibleConflict = prior && (prior.visibleText !== next.visibleText
        || JSON.stringify(prior.visibleSpans) !== JSON.stringify(next.visibleSpans)
        || prior.isError !== next.isError || prior.visibleNonText !== next.visibleNonText
        || prior.outcomeUnknown !== next.outcomeUnknown);
      out.set(b.tool_use_id, prior ? { ...prior,
        isErrorFalse: prior.isErrorFalse === true && next.isErrorFalse,
        visibleAmbiguous: prior.visibleAmbiguous === true || visibleConflict,
        ambiguous: prior.ambiguous === true || visibleConflict } : next);
    }
  }
  // Some versions duplicate the payload here, and it is occasionally richer than the block.
  const tur = d?.toolUseResult;
  if (tur !== undefined && out.size === 1) {
    const [id, prev] = [...out.entries()][0];
    const raw = tur && typeof tur === 'object' ? tur : undefined;
    // M33 D: a Claude Edit sidecar has no text carrier. Its JSON is not what the assistant read,
    // and it used to replace the visible result the outcome is parsed from; keep the visible text.
    const extra = editSidecarShape(raw) ? '' : flatten(tur);
    const nonText = prev.nonText || raw?.type === 'image' || raw?.source != null
      || raw?.data != null || typeof raw?.file?.base64 === 'string';
    const exitCode = Number.isFinite(raw?.exit_code) ? raw.exit_code
      : Number.isFinite(raw?.exitCode) ? raw.exitCode : null;
    const blockAgentIds = new Set([...prev.text.matchAll(/^[ \t]*agentId:[ \t]*([A-Za-z0-9_./:-]{1,200})(?![A-Za-z0-9_./:-])/gm)]
      .map((match) => match[1]));
    const childIdentityConflict = typeof raw?.agentId === 'string' && blockAgentIds.size > 0
      && (blockAgentIds.size > 1 || !blockAgentIds.has(raw.agentId));
    // H1: the two carriers' TEXT is never compared for a status: no status is read from text at all.
    out.set(id, { ...prev, text: extra.length > prev.text.length ? extra : prev.text,
      ambiguous: prev.ambiguous === true || childIdentityConflict,
      exitCode, raw, nonText });
  }
  return out;
}

/** Only explicit text carriers can become a model-visible quote. JSON-stringifying an opaque
 * result object can expose image data or native fields the assistant never saw as text. */
export function visibleToolContent(value) {
  if (value == null) return { text: '', spans: [], nonText: false };
  if (typeof value === 'string') return { text: value, spans: value ? [value] : [], nonText: false };
  if (typeof value === 'number' || typeof value === 'boolean')
    return { text: String(value), spans: [String(value)], nonText: false };
  if (Array.isArray(value)) {
    const parts = value.map(visibleToolContent);
    return { text: parts.map((part) => part.text).filter(Boolean).join('\n'),
      spans: parts.flatMap((part) => part.spans),
      nonText: parts.some((part) => part.nonText) };
  }
  if (typeof value === 'object') {
    const hasText = typeof value.text === 'string';
    const text = hasText && (value.type == null || ['text', 'input_text', 'output_text'].includes(value.type))
      ? value.text : '';
    const extras = Object.keys(value).filter((key) => !['type', 'text'].includes(key));
    const knownText = value.type == null || ['text', 'input_text', 'output_text'].includes(value.type);
    return { text, spans: text ? [text] : [],
      nonText: !knownText || extras.length > 0 || !hasText };
  }
  return { text: '', spans: [], nonText: true };
}

/** The key family of a Claude Code Edit result sidecar, whatever its values. */
const editSidecarShape = (value) => plainObject(value) && ['filePath', 'oldString', 'newString']
  .every((key) => Object.hasOwn(value, key)) && !Object.hasOwn(value, 'type');

/** toolUseResult / tool_result content: object | string | array. Flatten all three to text. */
function flatten(v) {
  if (v == null) return '';
  if (typeof v === 'string') return v;
  // Image/document blocks (base64 payloads) are never text evidence.
  if (Array.isArray(v)) return v.filter((x) => !(x && typeof x === 'object' && x.type && x.type !== 'text')).map(flatten).join('\n');
  if (typeof v === 'object') {
    if (typeof v.text === 'string') return v.text;
    // A Claude Code Read result recorded as its toolUseResult object: the file content IS the text.
    if (typeof v.file?.content === 'string') return v.file.content;
    if (v.type && v.type !== 'text' && (v.source || v.data)) return '';
    if (typeof v.stdout === 'string' || typeof v.stderr === 'string') {
      return [v.stdout, v.stderr].filter(Boolean).join('\n');
    }
    if (typeof v.content === 'string') return v.content;
    try {
      return JSON.stringify(v);
    } catch {
      return '';
    }
  }
  return String(v);
}

/** L1 session type (moved here from events.js with the M34 labels, which read it; events.js re-exports it). */
const own = (value, key) => Object.hasOwn(value, key);
const plain = (value) => value !== null && typeof value === 'object' && !Array.isArray(value)
  && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
/**
 * L1 session-type review (finding L1S-absent-origin-read-as-no-human; OWNER DECISION 2026-10-06; C-02 "L1 refused
 * calls", session type). The oldest Claude Code recorder whose own code was read and carries a host's declared
 * submission `origin` onto the prompt row it writes: 2.1.237 — its SDK input accepts `origin: {kind: 'human'}` and the
 * prompt row it writes holds that origin beside `promptSource` (2.1.251 and 2.1.278 do the same; 2.1.141 writes no
 * `promptSource` at all; no recorder between them was read). The same code presumes a prompt with no declared origin is
 * a human's (it counts that presumption, `tengu_human_origin_presumed`), so
 * an `sdk` prompt with no origin says no human submitted it only where the recorder would have carried a host's
 * declaration of one: on a row whose recorded `version` (a plain `x.y.z`) is at or above this one. On an older row, or
 * one with no plain version, the absence proves nothing — locally two multi-prompt Claude Desktop recordings (2.1.165,
 * 2.1.170) type every prompt `sdk` with no origin — and such a row makes the session `unknown` (`claudeSessionType`,
 * fail closed).
 */
export const CLAUDE_HOST_ORIGIN_RECORDER = Object.freeze({ field: 'version', oldest: '2.1.237' });
const VERSION_SHAPE = /^(0|[1-9]\d{0,5})\.(0|[1-9]\d{0,5})\.(0|[1-9]\d{0,5})$/;
/** How a Claude row's recorded version (`field`, a plain `x.y.z`) orders against `reference`: -1, 0 or 1; null when the
 *  row records no plain version. */
export function recordedVersionOrder(row, field, reference) {
  const recorded = VERSION_SHAPE.exec(typeof row?.[field] === 'string' ? row[field] : '');
  if (!recorded) return null;
  const ref = VERSION_SHAPE.exec(reference);
  for (let i = 1; i <= 3; i++) {
    if (Number(recorded[i]) !== Number(ref[i])) return Number(recorded[i]) < Number(ref[i]) ? -1 : 1;
  }
  return 0;
}
/** Whether a Claude row was written by a recorder that carries a host-declared origin (`CLAUDE_HOST_ORIGIN_RECORDER`). */
function hostOriginRecorder(row) {
  const order = recordedVersionOrder(row, CLAUDE_HOST_ORIGIN_RECORDER.field, CLAUDE_HOST_ORIGIN_RECORDER.oldest);
  return order !== null && order >= 0;
}
/**
 * OWNER DECISION 2026-10-06 (C-02 "L1 refused calls", session type). Whether a human was there to answer a Claude Code
 * permission prompt is a fact about the session, and the recorder types it on every prompt row it writes:
 *   - `promptSource`: `typed`, `queued` or `suggestion_accepted` — a prompt a human entered at the recorder's own
 *     interactive terminal; `sdk` — a prompt it received while running non-interactively (print mode, `claude -p`, or
 *     under an SDK host); `system` — the harness's own (a meta prompt);
 *   - `origin`: the submission's origin as its host declared it, `{kind: 'human'}` for a human's own submission (on a
 *     prompt row, or on the `queued_command` attachment of a prompt the human queued);
 *   - `turnOrigin`: the recorder's own classification of that turn (newer recorders), `human` or `sdk` among others.
 * A host that puts a human in front of an SDK session (Claude Desktop) declares the human's prompts `human`, so
 * `promptSource: 'sdk'` alone does not say no human was there; a prompt the recorder typed `sdk` with no declared origin
 * (and, where it classified the turn, `turnOrigin: 'sdk'`) on a row of a recorder that carries a host's declared origin
 * (`CLAUDE_HOST_ORIGIN_RECORDER`) was not submitted by a human. Read on the recorder's typed fields only, never on any
 * text: the session is
 *   - `interactive` when any row records a human's submission (a human-typed `promptSource`, a `human` origin or turn);
 *   - `non-interactive` when at least one prompt row is typed `sdk` with no declared origin, every such row is of a
 *     recorder that carries a host's declared origin, and every other typed prompt row is the harness's own (`system`,
 *     no declared origin);
 *   - `unknown` otherwise: no prompt row the recorder typed (a recorder older than the field, a helper's own recording,
 *     a synthetic row), an `sdk` prompt row of an older recorder or of no plain version, a value outside this
 *     vocabulary, or a host-declared origin that is not a human's (a peer, a coordinator, a task notification) with no
 *     human row — fail closed.
 * Only `non-interactive` drops a declaration: a refusal it records (`CLAUDE_USER_REFUSAL`) was typed `user-rejected` for
 * a prompt no human could be shown, so it declares no unread human answer. An `interactive` session keeps L1 as built;
 * an `unknown` one keeps the declaration under its own counted reason (`refusalSessionUnknown`, L1 session-type review).
 * Not decided here (open owner decision): an SDK host other than Claude Desktop that shows a human its permission
 * prompts but declares no origin reads `non-interactive` from 2.1.237 on.
 */
export const CLAUDE_SESSION_TYPE = Object.freeze({
  humanPromptSources: Object.freeze(['typed', 'queued', 'suggestion_accepted']),
  sdkPromptSource: 'sdk',
  systemPromptSource: 'system',
  humanOrigin: 'human',
  sdkTurnOrigin: 'sdk',
  systemTurnOrigin: 'system',
});
/** The closed session types `claudeSessionType` returns. */
export const SESSION_TYPES = Object.freeze({ interactive: 'interactive', nonInteractive: 'non-interactive',
  unknown: 'unknown' });
/** A lineage's session type (`CLAUDE_SESSION_TYPE`), from its Claude records' recorded rows (`rec.raw`). */
export function claudeSessionType(records) {
  const T = CLAUDE_SESSION_TYPE;
  const humanOrigin = (origin) => plain(origin) && origin.kind === T.humanOrigin;
  let human = false, sdk = false, other = false;
  for (const rec of Array.isArray(records) ? records : []) {
    if (!(rec?.adapter === 'claude' || rec?.adapter == null) || !plain(rec.raw)) continue;
    const d = rec.raw;
    if (d.type === 'attachment' && plain(d.attachment) && d.attachment.type === 'queued_command') {
      if (humanOrigin(d.attachment.origin)) human = true;
      continue;
    }
    if (d.type !== 'user' || !['promptSource', 'origin', 'turnOrigin'].some((key) => own(d, key))) continue;
    if (humanOrigin(d.origin) || d.turnOrigin === T.humanOrigin || T.humanPromptSources.includes(d.promptSource)) {
      human = true;
      continue;
    }
    const undeclared = !own(d, 'origin');
    const turnIs = (value) => !own(d, 'turnOrigin') || d.turnOrigin === value;
    // L1 session-type review: an `sdk` prompt with no origin, on a recorder that would not have carried a host's
    // declaration (or of no plain version), proves nothing (`CLAUDE_HOST_ORIGIN_RECORDER`): fail closed.
    if (undeclared && d.promptSource === T.sdkPromptSource && turnIs(T.sdkTurnOrigin) && hostOriginRecorder(d)) sdk = true;
    else if (!(undeclared && d.promptSource === T.systemPromptSource && turnIs(T.systemTurnOrigin))) other = true;
  }
  return human ? SESSION_TYPES.interactive : sdk && !other ? SESSION_TYPES.nonInteractive : SESSION_TYPES.unknown;
}

/** OWNER DECISION B: the record kind of a `queued_command` attachment labelled `human` with marker `queued`. */
export const QUEUED_PROMPT_RECORD = 'queued_prompt';
/** D150: the record kind of an `edited_text_file` attachment (its attachment type, `EDITED_TEXT_FILE_TYPE`). */
export const EDITED_FILE_RECORD = 'edited_file';
export const EDITED_TEXT_FILE_TYPE = 'edited_text_file';
/** M34 labels: the record kind of an attachment the human attached (an @-mention), labelled `human` + `attached`. */
export const ATTACHED_RECORD = 'attached_file';
/**
 * D71 (g), owner decision 2026-10-08: the record kind of a typed attachment by which Claude Code gave the agent
 * instruction files — `instructions` (its `files`: each `{ path, type, content }`) and `nested_memory` (one file, its
 * `content`). The recorder types each file's kind (`type`: `Project`, `User`, `Local`, `AutoMem`, …); the slicer reads
 * only the project's own (PROJECT_INSTRUCTION_TYPES, events.js). The row stays labelled harness and counted as before.
 */
export const PROJECT_INSTRUCTIONS_RECORD = 'project_instructions';
/** D71 (g): the known attachment types that carry instruction files (records.js CLAUDE_ATTACHMENTS). */
export const INSTRUCTION_ATTACHMENTS = Object.freeze(['instructions', 'nested_memory']);

/**
 * M34 labels (C-02 "Slice-time labels"). The oldest Claude Code recorder that types
 * every submission it writes — a host's declared `origin` (`human`, `task-notification`, `peer`, `coordinator`) beside
 * `promptSource` — so that a row it writes with neither is provably not a human's: from 2.1.219 every human row
 * carries `origin.kind: human`. A row of an older
 * recorder, or one that records no plain version, is labelled by the declared legacy fallback only, counted
 * (`LABEL_GAPS.legacyRecorder`), never mixed into a typed recorder's rows.
 */
export const CLAUDE_TYPED_LABEL_RECORDER = Object.freeze({ field: 'version', oldest: '2.1.219' });
const typedLabelRecorder = (row) => (recordedVersionOrder(row, CLAUDE_TYPED_LABEL_RECORDER.field,
  CLAUDE_TYPED_LABEL_RECORDER.oldest) ?? -1) >= 0;
/** The attachment types Claude Code writes for a file, directory or PDF the human @-mentioned (main thread only). */
const ATTACHED_TYPES = Object.freeze(['file', 'directory', 'pdf_reference']);
/** Assistant blocks of private reasoning: counted, never labelled, never used. */
const PRIVATE_BLOCKS = Object.freeze(['thinking', 'redacted_thinking']);
/** The label value of a record or block of private reasoning (`COUNT_KEYS.private`). */
export const PRIVATE_LABEL = Object.freeze({ private: true });
/** A recorder flag read as present: present and not `false` (or `null`, for an id). */
const flagged = (value) => value !== undefined && value !== false && value !== null;
/** An AskUserQuestion result's typed answer sidecar: exactly `{questions, answers}` (events.js reads its answers). */
const askSidecar = (value) => plain(value) && keySet(value, ['questions', 'answers'])
  && Array.isArray(value.questions) && plain(value.answers);

/**
 * M34 labels (C-02 "Slice-time labels"). Claude Code's one labelling function: every row of a recording, in recorded
 * order, gets exactly one label (`labels.js` LABELS) — or, where the row holds several content blocks, one per block —
 * with its markers, a closed basis, its links and, where structure cannot settle it, a closed gap. Read from the
 * recorder's own structure only — row type, block type, `origin`, `promptSource`, `isMeta`, `sourceToolUseID`,
 * `isCompactSummary`, `isSidechain`, `parentUuid`, `toolDenialKind`, the tool a result answers, and the recorder's own
 * command elements — never from what the text says. Stateful across one recording: a result is labelled by the call it
 * answers, and a prompt by the enqueue rows before it. `finish()` settles what only the whole recording shows (a
 * refusal in a session no human submitted). D150: it returns null for no row (before, it did for every row that is no
 * record, recording metadata among them).
 *
 *   other      any other row type (a queue operation, recording metadata, a request record, a form no list names) and a
 *              row that is no JSON object: labelled by the class the reader gives it (`claudeRowClass`), never by a
 *              word: harness context or recording metadata → harness (`recorder_row`); a form the reader leaves
 *              unclassified → no label, the gap `unknown_row` (the reader's own unclassified count declares the row).
 *   assistant  `text` → thought; `tool_use` → action; thinking → private (never used); a row the recorder wrote itself
 *              (`model: <synthetic>`, `isApiErrorMessage`) → harness.
 *   system     harness; `compact_boundary` also carries `compaction`. D120: a `local_command` output row (the recorder's
 *              typed output of a local command) settles the row its recorded `parentUuid` names when that row hangs
 *              from the recorder's own local-command caveat (an `isMeta` row that is only its `local-command-caveat`
 *              element): a row between the caveat and the command's output is a command the person ran in the harness
 *              itself, never a message to the agent, so it is harness (`local_command`) whatever its own fields said
 *              (Claude Code 2.1.295 types some with `origin: human`). No command's name is read.
 *   attachment `queued_command` of a human prompt → human + queued; a task notification (`claudeNotificationCarrier`, the
 *              rule every reader of the fact reads) → observation; an @-mentioned
 *              file, directory or PDF on the main thread whose recorded `parentUuid` chain (through attachment rows)
 *              reaches the human's own submission → human + attached, unless (D127, A19) the latest compaction before
 *              it lists that submission among the messages it kept (`preservedMessages`) → harness
 *              (`compaction_restored`); any other (a file the recorder restored after a compaction, one attached
 *              mid-turn) → harness.
 *   user       `isCompactSummary` → harness + compaction; a tool result → observation, or human + answer (an
 *              AskUserQuestion result with its typed answer sidecar) or human + refusal (`toolDenialKind:
 *              user-rejected`; observation again in a session no human submitted); otherwise, in order:
 *              `origin` human → human; task-notification → observation; peer → peer; coordinator → human from the
 *              parent agent in a helper, else peer; any other origin → unlabelled (`origin_unknown`).
 *              `isMeta` → harness (`recorder_meta`); D170: one whose text is only the recorder's command elements too
 *              (`meta_command`: a command the harness wrote, such as the skill it loads beside the person's prompt).
 *              `sourceToolUseID` → harness. `promptSource` typed/queued/suggestion_accepted → human.
 *              A helper's (`isSidechain`) string row → human from the parent agent (its brief, and the parent's later
 *              messages); its other rows → harness, untyped.
 *              A recorder before 2.1.219 (or of no plain version): the declared legacy fallback — a string that does
 *              not open with an element → human, anything else → harness. Every row it labels carries its basis
 *              (`legacy_fallback`) and is counted (`legacy_recorder`), whichever way it read it: which of them hold a
 *              human's words is not proven by a typed field (M34 labels review, F6).
 *              A typed recorder's first SDK prompt (`parentUuid` null, `promptSource: sdk`) → human, by a script.
 *              Text that is only top-level elements → harness (a local command's own rows); anything else → harness,
 *              where the recorder writes its interruption notice untyped (`interrupt_untyped`). Its words are never read.
 * A human row whose text is a prompt command (only the recorder's command elements) carries `command`; one whose words a
 * `queue-operation` enqueue recorded while the agent worked (an assistant row recorded after it and timestamped after
 * it — the recorder's own ISO timestamps, compared as recorded; a row with none is never marked) carries `queued`.
 * D142: Sonah's own turn, settled by `finish()` on the final labels (after D120 has settled every local command):
 * a main-thread row labelled `human` + `command` whose recorded command name is one of Sonah's own skill names (labels.js
 * `SONAH_SKILL_NAMES`) opens it; it, and every main-thread row after it, is harness (`sonah_turn`), whole, up to the first
 * main-thread row that starts other work (`startsWork`): a row on which `opensTurn` opens a turn (a `user` row with a
 * human label, whole or in a block, that is no answer and no refusal), a queued prompt, a background task's
 * notification, or another agent's message. That row and everything after it are read as before. A compaction row and a
 * private-only row keep their labels and end nothing. Read from the recorded command element and the labels' structure,
 * never from what the person or the agent wrote, never from where the recording ends.
 */
export function claudeLabeller() {
  const L = LABELS, B = LABEL_BASIS, M = MARKERS, G = LABEL_GAPS;
  const calls = new Map();
  const callInputs = new Map();
  const enqueues = [];
  const refusals = [];
  const typedRows = [];
  // M34 labels review (F1): each labelled row by its recorded `uuid` — whether it is an attachment row, its recorded
  // `parentUuid` and its label — so an attachment is read by the row its recorded chain hangs from.
  const rows = new Map();
  // M34 labels review (F5): every call id this recording recorded so far, so a notification is linked to the call it
  // names when it is labelled.
  const callIds = new Set();
  // D120: the recorded uuids of the recorder's own local-command caveats, so a local command's output settles its command.
  const caveats = new Set();
  const value = (label, basis, opts) => labelOf(label, basis, opts);
  /** A background task's notification: an observation, linked (`links.notifies`) to the call whose id it carries when
   *  this recording recorded that call before it (`recorderNotificationCallId`). Owner decision 2026-10-07: one whose
   *  carried id names a call this recording did not record before it is unlinked and carries the counted gap
   *  (`notification_unmatched`); one that carries no call id names nothing to link: an observation with no link and
   *  no gap. */
  const notification = (text) => {
    const id = recorderNotificationCallId(text);
    if (id === null) return value(L.observation, B.taskNotification);
    return value(L.observation, B.taskNotification,
      callIds.has(JSON.stringify(id)) ? { links: { notifies: id } } : { gap: G.notificationUnmatched });
  };
  /**
   * M34 labels review (F1). Whether an attachment row was submitted with the human's own words: its recorded
   * `parentUuid` chain, followed through attachment rows only, reaches a row labelled `human` — the prompt it was
   * submitted with, or a prompt the human queued (itself an attachment row) — and not an answer or a refusal (words the
   * human gave inside a tool result). Any other row it reaches (a compaction summary or boundary, a tool result, a
   * notification carried as a user row), a parent this recording did not record before it, or a chain that loops,
   * is no human's submission. Attachment rows are traversed even when labelled observation or peer: an accepted risk
   * beside D72 (C1), since a stop rule on a row's label would decide by more than the links; no wording decides the walk.
   * Structure only: the recorder's own `uuid`/`parentUuid` links, never the attachment's content.
   */
  const submittedWithHuman = (d) => {
    const seen = new Set();
    let at = d.parentUuid;
    while (typeof at === 'string' && rows.has(at) && !seen.has(at)) {
      seen.add(at);
      const row = rows.get(at);
      const human = row.value !== null && row.value.label === L.human
        && !(row.value.markers ?? []).some((marker) => marker === M.answer || marker === M.refusal);
      if (human) return at;
      if (!row.attachment) return null;
      at = row.parent;
    }
    return null;
  };
  /**
   * D127 (A19, the owner's go of 2026-10-22). The messages the latest compaction kept: the recorded uuids its boundary
   * row lists in `compactMetadata.preservedMessages` (`uuids` and `allUuids`), or null before any compaction. A message
   * the compaction kept was submitted before it; a file attachment recorded after the compaction whose chain reaches that
   * message is Claude Code restoring the kept message's context in a recording that continues the session, never a file
   * the person attached: it is the harness's. Structure only: the boundary's typed fields and the recorded uuid chain.
   */
  let keptByCompaction = null;
  const keptOf = (d) => {
    const listed = plain(d.compactMetadata) && plain(d.compactMetadata.preservedMessages)
      ? d.compactMetadata.preservedMessages : {};
    return new Set(['uuids', 'allUuids'].flatMap((key) => (Array.isArray(listed[key]) ? listed[key] : []))
      .filter((uuid) => typeof uuid === 'string' && uuid));
  };

  /** A human value for a user row, with the markers its structure gives it. */
  const human = (d, basis, extra = {}) => {
    const markers = [];
    let gap = extra.gap ?? null;
    const text = textOf(d);
    const command = typeof d.message?.content === 'string' || Array.isArray(d.message?.content)
      ? recorderCommand(text) : null;
    if (command && command.name) {
      markers.push(M.command);
      if (command.args === null && gap === null) gap = G.commandArgsUnrecorded;
    }
    const words = typeof d.message?.content === 'string' ? d.message.content : text;
    const at = enqueues.findIndex((entry) => entry.content === words);
    if (at !== -1) {
      if (enqueues[at].working) markers.push(M.queued);
      enqueues.splice(at, 1);
    }
    return value(L.human, basis, { markers, gap });
  };

  const textRow = (d) => {
    const content = d.message?.content;
    const text = textOf(d);
    const helperRow = d.isSidechain === true;
    // D98 (F1): a notification by the one carrier rule (harness-context.js `claudeNotificationCarrier`), whatever
    // recorder keys sit beside the origin's kind.
    const carried = claudeNotificationCarrier(d);
    if (carried) return notification(carried.text);
    if (own(d, 'origin')) {
      const kind = plain(d.origin) ? d.origin.kind : undefined;
      if (kind === 'human') return human(d, B.originHuman);
      if (kind === 'peer') return value(L.peer, B.originPeer);
      if (kind === 'coordinator') return helperRow ? human(d, B.fromParentAgent) : value(L.peer, B.originPeer);
      return value(null, B.originOther, { gap: G.originUnknown });
    }
    // D170 (the owner, 2026-10-28, the broad form; reverses M34's rule): every `isMeta` row reaching here (no
    // notification carrier, no `origin`) is the harness's, one whose text is only the recorder's command elements too
    // (`meta_command`). Read from the recorder's flag and its own command elements; `turnCompanion` and the command's
    // name are not read.
    if (flagged(d.isMeta)) {
      const command = recorderCommand(text);
      return value(L.harness, command && command.name ? B.metaCommand : B.recorderMeta);
    }
    if (flagged(d.sourceToolUseID)) return value(L.harness, B.recorderToolRow);
    if (CLAUDE_SESSION_TYPE.humanPromptSources.includes(d.promptSource)) return human(d, B.promptSourceHuman);
    if (helperRow) return typeof content === 'string' ? human(d, B.fromParentAgent)
      : value(L.harness, B.untypedUserRow, { gap: G.interruptUntyped });
    // M34 labels review (F6): every row the declared legacy fallback labels — read as the human's or set aside — is
    // counted under its one closed gap, so a session it labelled declares it.
    if (!typedLabelRecorder(d)) {
      return typeof content === 'string' && !startsWithElement(content)
        ? human(d, B.legacyFallback, { gap: G.legacyRecorder })
        : value(L.harness, B.legacyFallback, { gap: G.legacyRecorder });
    }
    if (d.parentUuid === null && d.promptSource === CLAUDE_SESSION_TYPE.sdkPromptSource) return human(d, B.scriptFirstPrompt);
    return isWhollyElements(text) ? value(L.harness, B.untypedElements)
      : value(L.harness, B.untypedUserRow, { gap: G.interruptUntyped });
  };

  const resultBlock = (d, block, single) => {
    const id = block.tool_use_id;
    const name = id !== undefined && id !== null ? calls.get(JSON.stringify(id)) : undefined;
    if (single && name === 'AskUserQuestion' && askSidecar(d.toolUseResult))
      return value(L.human, B.askAnswer, { markers: [M.answer], links: { answerTo: id } });
    if (single && block.is_error === true && d.toolDenialKind === 'user-rejected') {
      const refused = value(L.human, B.userRejected, { markers: [M.refusal], links: { refuses: id } });
      refusals.push(refused);
      return refused;
    }
    return value(L.observation, B.toolResult);
  };

  const assistantRow = (d) => {
    if (d.message?.model === '<synthetic>' || d.isApiErrorMessage === true) return value(L.harness, B.syntheticAssistant);
    const content = d.message?.content;
    const blocks = typeof content === 'string' ? [{ type: 'text', text: content }] : content;
    if (!Array.isArray(blocks)) return value(null, B.assistantText, { gap: G.unknownRow });
    const parts = blocks.map((block) => {
      if (block?.type === 'text' && typeof block.text === 'string') return value(L.thought, B.assistantText);
      if (block?.type === 'tool_use') {
        if (block.id !== undefined && block.id !== null) callIds.add(JSON.stringify(block.id));
        if (block.id !== undefined && block.id !== null && typeof block.name === 'string')
          calls.set(JSON.stringify(block.id), block.name);
        // D150: each call's input, by its id, for a structured output's twin (`structuredOutputCopy`).
        if (block.id !== undefined && block.id !== null) callInputs.set(JSON.stringify(block.id), block.input);
        return value(L.action, B.toolUse);
      }
      if (PRIVATE_BLOCKS.includes(block?.type)) return PRIVATE_LABEL;
      return value(null, B.assistantText, { gap: G.unknownBlock });
    });
    return parts.length === 1 ? parts[0] : { parts };
  };

  const attachmentRow = (d) => {
    const item = d.attachment;
    if (!plain(item)) return value(null, B.attachmentRow, { gap: G.unknownRow });
    if (item.type === 'queued_command') {
      // D98 (F1): a notification by the one carrier rule (harness-context.js `claudeNotificationCarrier`): its mode is
      // the kind, and an origin recorded beside it is of that kind too, whatever recorder keys sit beside the kind.
      const carried = claudeNotificationCarrier(d);
      if (carried) return notification(carried.text);
      if (flagged(item.isMeta)) return value(L.harness, B.recorderMeta);
      if (own(item, 'origin')) {
        const kind = plain(item.origin) ? item.origin.kind : undefined;
        if (kind === 'human') return item.commandMode === 'prompt'
          ? value(L.human, B.queuedPrompt, { markers: [M.queued] }) : value(L.harness, B.attachmentRow);
        // D98 (F1): a notification's origin beside a mode that is not one contradicts the recorder's kind field: no
        // reader takes it as a notification, nor as a human's words. It stays unlabelled under its counted gap, so the
        // row's declared loss stands.
        if (kind === 'task-notification') return value(null, B.originOther, { gap: G.originUnknown });
        if (kind === 'peer') return value(L.peer, B.originPeer);
        if (kind === 'coordinator') return d.isSidechain === true
          ? value(L.human, B.fromParentAgent, { markers: [M.queued] }) : value(L.peer, B.originPeer);
        return value(null, B.originOther, { gap: G.originUnknown });
      }
      if (item.commandMode !== 'prompt' || typeof item.prompt !== 'string')
        return value(null, B.attachmentRow, { gap: G.unknownRow });
      if (!typedLabelRecorder(d)) return startsWithElement(item.prompt)
        ? value(L.harness, B.legacyFallback, { gap: G.legacyRecorder })
        : value(L.human, B.legacyFallback, { markers: [M.queued], gap: G.legacyRecorder });
      return value(L.harness, B.attachmentRow);
    }
    // M34 labels review (F1): an @-mention only when its recorded chain hangs from the human's submission; a file the
    // recorder restored after a compaction, or attached mid-turn, is harness. D127 (A19): and only when that submission
    // is not one that the latest compaction before it kept (`keptByCompaction`).
    // D150: hook rows by their type, the harness's (their content stays a declared loss: no review reads it yet); a
    // structured output whose data is the recorded input of the call it names is the harness's copy of that call.
    if (item.type === 'hook_additional_context') return value(L.harness, B.hookContext);
    if (item.type === 'hook_success' || item.type === 'hook_non_blocking_error') return value(L.harness, B.hookRun);
    if (item.type === 'structured_output' && item.toolUseID !== undefined && item.toolUseID !== null
      && callInputs.has(JSON.stringify(item.toolUseID))
      && canonicalJson(callInputs.get(JSON.stringify(item.toolUseID))) === canonicalJson(item.data))
      return value(L.harness, B.structuredOutputCopy);
    const submission = ATTACHED_TYPES.includes(item.type) && d.isSidechain === false ? submittedWithHuman(d) : null;
    if (submission !== null) return keptByCompaction?.has(submission)
      ? value(L.harness, B.compactionRestored) : value(L.human, B.attachedFile, { markers: [M.attached] });
    return value(L.harness, B.attachmentRow);
  };

  /**
   * D120 (owner 2026-10-18, DF3 part 1): a local command's typed output row (`system`, subtype `local_command`) settles
   * the row its recorded `parentUuid` names, when that row hangs from the recorder's own local-command caveat: the row
   * between the two is a command the person ran in the harness, never a message to the agent. Labelled the human's by
   * its own fields, it becomes harness (`local_command`), in place, before any label is applied; its markers, gap and
   * links go with the human label. Structure only: the recorder's uuid chain, its `isMeta` flag, its caveat element and
   * the output's typed subtype; no command's name is read. A row with no caveat before it, or no output after it, keeps
   * its label (a prompt command the person sent the agent has neither).
   */
  const settleLocalCommand = (d) => {
    const command = typeof d.parentUuid === 'string' ? rows.get(d.parentUuid) : undefined;
    if (!command || command.attachment || !caveats.has(command.parent) || command.value?.label !== L.human) return;
    for (const key of ['markers', 'gap', 'links']) delete command.value[key];
    Object.assign(command.value, { label: L.harness, basis: B.localCommand });
  };

  /**
   * D142: every main-thread row's label value, in recorded order, with what the span of Sonah's own turn needs of
   * its row: its kind, and whether its text is a prompt command of Sonah's own name (the recorded `command-name`
   * element, a name Sonah owns). `finish()` settles the span on the final values (`settleSonahTurns`).
   */
  const mainRows = [];
  const sonahNamed = (d) => SONAH_SKILL_NAMES.includes((recorderCommand(textOf(d))?.name ?? '').replace(/^\//, ''));
  const wholeValue = (v) => v !== null && !Object.hasOwn(v, 'parts') && v.private !== true;
  /** A row that starts work other than Sonah's turn: a turn `opensTurn` opens, a queued prompt, a background task's
   *  notification, or another agent's message. */
  const startsWork = (kind, v) => {
    const rec = { kind, ...(Object.hasOwn(v, 'parts') ? { parts: v.parts } : v) };
    return opensTurn(rec) || partsOf(rec).some((part) => (part.label === L.human
      && (part.markers ?? []).includes(M.queued)) || part.basis === B.taskNotification || part.label === L.peer);
  };
  const settleSonahTurns = () => {
    let inTurn = false;
    for (const { kind, value: v, named } of mainRows) {
      if (v === null || v.private === true) continue;
      if (wholeValue(v) && v.label === L.human && named && (v.markers ?? []).includes(M.command)) inTurn = true;
      else if (!inTurn || startsWork(kind, v)) { inTurn = false; continue; }
      for (const key of ['parts', 'markers', 'gap', 'links']) delete v[key];
      Object.assign(v, { label: L.harness, basis: B.sonahTurn });
    }
  };

  // D150: the rows a request blob's twins are looked for in, each with its label value, and the blobs (`finish`).
  const recordedRows = [];
  const requestBlobs = [];
  /** The label of one row (`label` below), remembered by its recorded uuid for the attachment chain (F1). */
  const labelRow = (d) => {
    const result = labelOne(d);
    if (plain(d) && d.type === REQUEST_BLOB_TYPE) requestBlobs.push([d, result]);
    else if (plain(d) && ['user', 'assistant', 'system', 'attachment'].includes(d.type)) recordedRows.push([d, result]);
    if (result !== null && plain(d) && d.isSidechain !== true && !isCompactionMarker(d))
      mainRows.push({ kind: d.type, value: result, named: result.label === L.human && sonahNamed(d) });
    if (plain(d) && typeof d.uuid === 'string' && d.uuid && !rows.has(d.uuid))
      rows.set(d.uuid, { attachment: d.type === 'attachment', parent: d.parentUuid,
        value: result !== null && !Object.hasOwn(result, 'parts') && result.private !== true ? result : null });
    return result;
  };

  /** D150: a row of any other row type, or one that is no JSON object, by the class the reader gives it (a compaction
   *  mark of another row type as the reader keeps it: a compaction record). */
  const otherRow = (d) => {
    if (plain(d) && isCompactionMarker(d)) return value(L.harness, B.compactBoundary, { markers: [M.compaction] });
    return plain(d) && claudeRowClass(d) !== null ? value(L.harness, B.recorderRow)
      : value(null, B.recorderRow, { gap: G.unknownRow });
  };
  const labelOne = (d) => {
    if (!plain(d)) return otherRow(d);
    if (d.type === 'queue-operation') {
      if (d.operation === 'enqueue' && typeof d.content === 'string')
        enqueues.push({ content: d.content, at: typeof d.timestamp === 'string' ? d.timestamp : null, working: false });
      else if (d.operation === 'remove' && typeof d.content === 'string') {
        const at = enqueues.findIndex((entry) => entry.content === d.content);
        if (at !== -1) enqueues.splice(at, 1);
      }
      return otherRow(d);
    }
    if (!['user', 'assistant', 'system', 'attachment'].includes(d.type)) return otherRow(d);
    if (d.type === 'user' || d.type === 'attachment') typedRows.push({ adapter: 'claude', raw: d });
    if (d.type === 'assistant') {
      // The agent was working after the prompt was enqueued: an assistant row recorded, and timestamped, after it.
      // Recorded timestamps are compared as the recorder wrote them (ISO strings); never the clock.
      const at = typeof d.timestamp === 'string' ? d.timestamp : null;
      for (const entry of enqueues) if (entry.at !== null && at !== null && at > entry.at) entry.working = true;
      return assistantRow(d);
    }
    if (d.type === 'system') {
      if (d.subtype === LOCAL_COMMAND_OUTPUT_SUBTYPE) settleLocalCommand(d);
      if (d.subtype === 'compact_boundary') keptByCompaction = keptOf(d);
      return isCompactionMarker(d) ? value(L.harness, B.compactBoundary, { markers: [M.compaction] })
        : value(L.harness, B.systemRow);
    }
    if (d.type === 'attachment') return attachmentRow(d);
    if (isCompactionMarker(d)) return value(L.harness, B.compactSummary, { markers: [M.compaction] });
    // D120: the recorder's own caveat before a local command (`isMeta`, only its caveat element), remembered by uuid.
    if (flagged(d.isMeta) && typeof d.uuid === 'string' && d.uuid && isLocalCommandCaveat(textOf(d))) caveats.add(d.uuid);
    const content = d.message?.content;
    if (Array.isArray(content) && content.some((block) => block?.type === 'tool_result')) {
      const single = content.filter((block) => block?.type === 'tool_result').length === 1;
      const rest = content.some((block) => block?.type !== 'tool_result') ? textRow(d) : null;
      return { parts: content.map((block) => (block?.type === 'tool_result' ? resultBlock(d, block, single) : rest)) };
    }
    return textRow(d);
  };

  return {
    label: labelRow,
    /** Settle what only the whole recording shows; returns its session type (`claudeSessionType`). */
    finish() {
      const sessionType = claudeSessionType(typedRows);
      // OWNER DECISION 2026-10-06: a refusal in a session no human submitted is no human's.
      if (sessionType === SESSION_TYPES.nonInteractive) {
        for (const refused of refusals) {
          refused.label = L.observation; refused.basis = B.toolResult;
          delete refused.markers; delete refused.links;
        }
      }
      // D150: a request blob every block of whose message has its structural twin in this recording is a copy of it.
      if (requestBlobs.length) {
        const index = requestCopyIndex(recordedRows);
        for (const [d, v] of requestBlobs) {
          if (v.gap !== G.unknownRow || !requestBlobRow(d) || !index.copies(d.message)) continue;
          delete v.gap;
          Object.assign(v, { label: L.harness, basis: B.requestCopy });
        }
      }
      // D142: Sonah's own turn, on the final labels.
      settleSonahTurns();
      return { sessionType };
    },
  };
}

/**
 * M34 labels. Records handed to an event builder without the reader's labels (a caller that builds records itself): the
 * Claude Code ones are labelled here, in order, by the same labelling function the reader runs (`claudeLabeller`) — never
 * re-decided: a record that carries a label keeps it. Mutates and returns `records`.
 */
export function ensureClaudeLabels(records) {
  const missing = (Array.isArray(records) ? records : []).filter((rec) => plain(rec) && plain(rec.raw)
    && (rec.adapter === 'claude' || rec.adapter == null) && !own(rec, 'label') && rec.private !== true);
  if (!missing.length) return records;
  const labeller = claudeLabeller();
  const pairs = missing.map((rec) => [rec, labeller.label(rec.raw)]);
  labeller.finish();
  for (const [rec, value] of pairs)
    if (value !== null) applyLabel(rec, value, rec.raw.isSidechain === true ? LINEAGE_ROLES.helper : LINEAGE_ROLES.root);
  return records;
}

/**
 * M34 labels. Label raw Claude Code rows read outside the slicer's reader: each row as a record `{ kind, raw, label, … }`
 * the label helpers (`labels.js` `opensTurn`, `humanWordsOf`) read, in order.
 */
export function labelClaudeRows(rows) {
  const labeller = claudeLabeller();
  const out = (Array.isArray(rows) ? rows : []).map((raw) => {
    const value = labeller.label(raw);
    return { kind: raw?.type, raw, value };
  });
  labeller.finish();
  return out.map(({ kind, raw, value }) => (value === null ? { kind, raw }
    : applyLabel({ kind, raw }, value, raw?.isSidechain === true ? LINEAGE_ROLES.helper : LINEAGE_ROLES.root)));
}

/**
 * M34 labels. The human's words of a record labelled `human` (whole, or in its blocks): the text of its human-labelled
 * text blocks, joined as `textOf` joins them, kept whole — no harness block is cut out of a human block (C-02 "Slice-time
 * labels": a block is labelled whole). A prompt command's words are its name and the arguments it recorded, read from
 * the recorder's own command elements. A queued prompt's are its prompt; an attachment's are its content when it
 * records text (a file's text, a directory listing); an answer's and a refusal's are read where their result is
 * (events.js). '' when there are none.
 */
export function humanWordsOf(rec) {
  const d = rec?.raw;
  const human = humanPart(rec);
  if (!human || !plain(d)) return '';
  if (rec.kind === QUEUED_PROMPT_RECORD) return typeof d.attachment?.prompt === 'string' ? d.attachment.prompt : '';
  if (rec.kind === ATTACHED_RECORD) {
    const content = d.attachment?.content;
    if (typeof content === 'string') return content;
    if (plain(content) && content.type === 'text' && plain(content.file) && typeof content.file.content === 'string')
      return content.file.content;
    return '';
  }
  const content = d.message?.content;
  let text;
  if (typeof content === 'string') text = content;
  else if (Array.isArray(content)) {
    const blocks = new Set(human.map((part) => part.block));
    text = content.filter((block, i) => (blocks.has(null) || blocks.has(i)) && block?.type === 'text'
      && typeof block.text === 'string').map((block) => block.text).join('\n');
  } else return '';
  if (human.some((part) => (part.markers ?? []).includes(MARKERS.command))) {
    const command = recorderCommand(text.trim());
    if (command) return [command.name, command.args ?? ''].filter(Boolean).join(' ');
  }
  return text;
}

/**
 * D150: the words of a queued prompt or of a file the human attached that are read at its record (events.js makes them
 * an in-turn instruction), or '' when none are (a PDF, an image, an empty prompt). The one predicate of whether such a
 * row is read: the reader counts a row it reads no words of as unread (`readClaudeSession`).
 */
export function interjectionWordsOf(rec) {
  if (rec?.kind !== QUEUED_PROMPT_RECORD && rec?.kind !== ATTACHED_RECORD) return '';
  const words = humanWordsOf(rec);
  return words.trim() ? words : '';
}

/** D150: whether a Claude row is a `user` or `assistant` row the reader counts as unclassified, and as an unread row,
 *  because it cannot read its turn where it reads one (`driftedTurn`). */
export const claudeDriftedTurn = (row) => row !== null && typeof row === 'object' && !Array.isArray(row)
  && driftedTurn(row);

/** The recorder block types a human message's nontext content arrives as (counted as `instructionsNonText`, events.js).
 */
export const NONTEXT_BLOCK_TYPES = Object.freeze(['image', 'document', 'audio']);

/**
 * Gain I (2026-10-13). The nontext blocks of a record's human-labelled content, in block order, each `{ block, type }`:
 * its index in the message's content and its recorded type. An image the recorder kept whole as base64 (`source.type`
 * `base64`, with a string media type and data: Claude Code's own block, and a Codex data URL as codex.js reads it) also
 * carries `mediaType` and `data` exactly as recorded. Structure only: nothing is decoded, sized or judged here (what a
 * reviewer request can carry is decided by the evidence package). [] when there are none.
 */
export function humanNonTextOf(rec) {
  const d = rec?.raw;
  const human = humanPart(rec);
  const content = plain(d) && plain(d.message) ? d.message.content : null;
  if (!human || !Array.isArray(content)) return [];
  const blocks = new Set(human.map((part) => part.block));
  const out = [];
  content.forEach((block, i) => {
    if (!(blocks.has(null) || blocks.has(i)) || !NONTEXT_BLOCK_TYPES.includes(block?.type)) return;
    const source = block.source;
    const whole = block.type === 'image' && plain(source) && source.type === 'base64'
      && typeof source.media_type === 'string' && typeof source.data === 'string';
    out.push({ block: i, type: block.type, ...(whole ? { mediaType: source.media_type, data: source.data } : {}) });
  });
  return out;
}
