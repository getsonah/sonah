// Tool call + result -> Event.
//
// Field extraction is an ORDERED ALLOW-LIST for tools whose effects we understand. Session records carry
// `uuid`, `parentUuid`, `cwd`, `sessionId`, `version`, `usage`, `ttftMs`, `stop_reason` and more on
// every single line; an allow-list means none of it needs an exclusion rule and none of it can leak
// into a model payload by accident when a vendor adds a field.
//
// The budgets below are the whole compression story, and the first row is ~all of it: an LLM span's
// INPUT is the entire assembled prompt, re-sent and growing every turn. Never emitting it is where
// nearly all of the reduction comes from. Tool output stays intact here. Review-window and request limits
// decide whether a long observation can be reviewed, without losing its middle at capture time.

import { editDiff, createDiff, DIFF_BUDGET } from './diff.js';
import { isWriteSuccessLine } from './outcome.js';
import { compressAsk } from './ask.js';
import { isDelegationTool, isEncryptedBrief, recordedAgentId } from './delegation.js';
import { WORKFLOW_RECEIPT_STATUSES } from './workflow-runs.js';
import { AGENT_ARRIVAL_RECORD, CODEX_SEND_NAMES, HELPER_RECEIPT_STATUSES } from './helper-deliveries.js';
import { AGENT_REPORT_RECORD } from './inter-agent.js';
import { posix, win32 } from 'node:path';

/** Vanishingly unlikely in source, and visible if it is ever rendered. */
export const ARG_SEP = '\n⟪→⟫\n';


/**
 * C-02 M33 (4) refreeze: the closed sources of a TYPED interrupt mark. Only such a mark, with its
 * row position, is carried into the canonical session as a `boundary: "interrupt"` event
 * (evidence/adapters/sonah-ledger.js LEDGER_TYPED_INTERRUPT_SOURCES). A text-derived interrupt
 * (a Claude interruption notice) carries no source and stays a ledger mark.
 */
export const MARK_SOURCES = Object.freeze({ codexTurnAborted: 'codex_turn_aborted' });
/**
 * OWNER DECISION B (2026-10-01); M34 labels (C-02 "Slice-time labels"): the closed kinds of the human's words — and a
 * peer's — recorded within a turn (`interjections`), each read at the row the slicer labelled it (`labels.js`): a prompt
 * the human queued while the agent worked (`queued`), the human's answer to an AskUserQuestion call (`answer`), a file
 * or directory the human attached (`attached`, an @-mention), and another agent's message (`peer`). The evidence adapter
 * re-declares them (sonah-ledger.js `INTERJECTION_KINDS`; it never imports the slicer) and a test holds the two equal.
 * M34 labels review (F3): a refusal is no kind here — its result's text is the recorder's, not the human's (below).
 */
export const INTERJECTION_KINDS = Object.freeze({ queued: 'queued', answer: 'answer', attached: 'attached',
  peer: 'peer' });
/**
 * D71 (g), owner decision 2026-10-08: the kinds of instruction file the slicer reads from Claude Code's typed instruction
 * attachments (records.js PROJECT_INSTRUCTIONS_RECORD) — the recorder's own closed vocabulary of a file's `type`, compared
 * exactly. Only the project's own (`Project`: a repository CLAUDE.md, or an AGENTS.md it names): never the user's, a
 * local or managed file, or the agent's memory (`User`, `Local`, `Managed`, `AutoMem`, …), which the harness keeps under
 * its home folders or outside the repository. The recorder's type decides, never where the file lies (D90: one under the
 * harness home folders is no longer withheld). Project files come in `instructions` and in `nested_memory`; `AutoMem`
 * is read by none.
 */
export const PROJECT_INSTRUCTION_TYPES = Object.freeze(['Project']);
/**
 * M34 labels review (F2; C-02 "Slice-time labels", positional label gaps). The kind of the mark each record's label
 * carrying a positioned gap (labels.js `POSITIONED_GAPS`) leaves at its row: `{turn, kind, gap, beforeEvent, stream,
 * record}`, placed as an in-turn row is (the actions recorded before it, its stream and one-based record). One mark per
 * counted label — a row copied from another recording of the lineage (its `uuid` read before) leaves none, as it is
 * counted once — so the evidence adapter can locate the gap (sonah-ledger.js `LEDGER_LABEL_GAP_MARK`, re-declared; it
 * never imports the slicer; a test holds the two equal). It is never a boundary. It restores H2's positional mark
 * (`opening_fallback`) under the labels.
 */
export const LABEL_GAP_MARK = 'label_gap';
/**
 * L1 (C-02 "L1 refused calls"). Claude Code's typed record that the human refused a tool
 * call: the result row's own `toolDenialKind` is `user-rejected` — the recorder's closed denial vocabulary
 * (`user-rejected`, `permission-rule`, `automode-blocked`, `automode-unavailable`, `automode-parsing-error`,
 * `interrupted`, `cancelled`), whose `user-rejected` covers a human's "no" at a permission prompt (with or without
 * words) and a prompt no human could be shown — beside the call's single result block marked `is_error`. Whatever the
 * model-visible words say, the human may have answered the call. Tool-result text is never read as an instruction
 * (C-02), so every such call declares its answer unread (`humanAnswerUnresolved`, or
 * `instructionCapture.feedbackUnplaced` when no ledger action carries it). It replaces M33 U repair's English opening and "the user said:" phrase
 * (`CLAUDE_REJECTION_FEEDBACK`), a reading of words that the recorder's typed denial kind makes unnecessary. Any other denial kind (a
 * permission rule, the auto-mode classifier, an interrupt, a cancelled background call) is no human's answer, and
 * (OWNER DECISION 2026-10-06) neither is a refusal in a session no human submitted (`CLAUDE_SESSION_TYPE`). A refusal
 * in a session whose type the recorder did not record keeps its declaration under its own counted reason instead
 * (`refusalSessionUnknown`, `instructionCapture.refusalSessionUnknown`; L1 session-type review).
 */
export const CLAUDE_USER_REFUSAL = Object.freeze({ field: 'toolDenialKind', kind: 'user-rejected' });
/** Whether a Claude tool result records the human's refusal of the call (`CLAUDE_USER_REFUSAL`): M34 labels — its block
 *  is labelled `human` + `refusal` (records.js `claudeLabeller`: its one result block is an error and the row's typed
 *  denial kind is the human's; a row with several result blocks attributes its row fields to none of them). */
const refusedByHuman = (label) => label?.label === LABELS.human && (label.markers ?? []).includes(MARKERS.refusal);
/**
 * L1 review (finding L1-pre-typed-recorder-fail-open; OWNER DECISION 2026-10-06; C-02 "L1 refused calls"). The newest
 * Claude Code recorder whose own code was read and types no refusal: 2.1.141 holds neither `toolDenialKind` nor its
 * vocabulary, nor `promptSource` (2.1.237, 2.1.251 and 2.1.278 hold all three). On a result row whose recorded
 * `version` (a plain `x.y.z`) is at or below it, a human's refusal is an error like any other and the session type of
 * the row is not recorded either: every call whose result block there is an error may be a refusal holding the human's
 * answer, unread, whatever the session type read from later rows. Each such call is marked `refusalUntyped`, and every
 * one of them, marked or carried by no ledger action, is counted (`instructionCapture.refusalUntyped`), so the evidence
 * adapter declares the refusal channel unreadable — located at the marked calls only when it names all of them. A row
 * of a later recorder, or with no plain version, gives no such signal and is read as L1 reads it.
 */
export const CLAUDE_UNTYPED_DENIAL_RECORDER = Object.freeze({ field: 'version', newest: '2.1.141' });
/** Whether a Claude row was written by a recorder that types no refusal (`CLAUDE_UNTYPED_DENIAL_RECORDER`). */
function untypedDenialRecorder(row) {
  const order = recordedVersionOrder(row, CLAUDE_UNTYPED_DENIAL_RECORDER.field, CLAUDE_UNTYPED_DENIAL_RECORDER.newest);
  return order !== null && order <= 0;
}
const TYPED_MARK_SOURCES = new Set(Object.values(MARK_SOURCES));

/**
 * C-02 M33 native-first: the closed provenance of an action an adapter recorded from a source
 * other than a direct tool call. `codex_native_item` is a paginated CommandExecution, FileChange
 * or McpToolCall item (its call key is its item.id); `codex_code_cell` is an `exec` wrapper call
 * recorded as one generic code-cell action. Every other action carries no provenance field.
 */
export const ACTION_PROVENANCE = Object.freeze({
  codexNativeItem: 'codex_native_item',
  codexCodeCell: 'codex_code_cell',
});
const PROVENANCES = new Set(Object.values(ACTION_PROVENANCE));

/**
 * C-02 M33 D (Claude Code status drift): the closed sources of a command's terminal status that is
 * proved without a numeric exit code. `exitCode` stays null for both; neither can type an exit, so
 * neither can prove a shell-write sibling, and neither turns a test command's label into a pass.
 *   claude_native_verdict    — a parent Bash result with an explicit `is_error: false` and exactly the
 *                              known success sidecar (`claudeBashSidecar`), not interrupted, not a
 *                              background launch, and no `returnCodeInterpretation` (a benign nonzero).
 *   claude_task_notification — a background Bash launch's own later typed task notification
 *                              (`claudeTaskNotification`) with a closed `completed`/`failed` status.
 */
export const COMMAND_STATUS_SOURCES = Object.freeze({
  claudeNativeVerdict: 'claude_native_verdict',
  claudeTaskNotification: 'claude_task_notification',
});
/** C-02 M33 D: the closed header statuses of a Claude task notification. D99 (F1 guard): `killed` is one of them, a
 *  recorded end that is no completion, as `stopped` is (STOPPED_NOTIFICATION_STATUSES). */
export const TASK_NOTIFICATION_STATUSES = Object.freeze(['completed', 'failed', 'stopped', 'killed']);
/** D99 (F1 guard): the notification statuses that say a background run was stopped before it finished. Neither types a
 *  completion or a failure, and neither is a receipt (WORKFLOW_RECEIPT_STATUSES). */
export const STOPPED_NOTIFICATION_STATUSES = Object.freeze(['stopped', 'killed']);
/**
 * D99 (F1 guard): what the slicer read of a background Bash run's end when the run has no typed completion or failure,
 * on its launch event as `backgroundEnd` (and, `unread` or `unchecked` only, on a Workflow launch with no receipt). A
 * closed set:
 *   stopped    its own notification typed it stopped or killed (STOPPED_NOTIFICATION_STATUSES);
 *   unread     no end was read, and a later record mentions the run: a notification is linked to it, or its task id is
 *              in a later row of the lineage that the agent did not write (labels.js END_MENTIONED_REASONS);
 *   unchecked  no end was read, and code could not check whether the recording holds one: its task id is in a row
 *              before its launch, is of no shape a verbatim search is sound for, or a file could not be read again
 *              (background-ends.js `readBackgroundEnds`; D99, review of A1b).
 * A launch with no typed end and no mark is one whose recording code proved holds no end of it. The evidence adapter
 * re-declares the set (sonah-ledger.js `LEDGER_BACKGROUND_ENDS`; it never imports the slicer) and a test holds the two
 * equal.
 */
export const BACKGROUND_ENDS = Object.freeze({ stopped: 'stopped', unread: 'unread', unchecked: 'unchecked' });

/** The input fields that locate what a read tool read: they become the call's path, never its input. */
const READ_LOCATORS = Object.freeze(['file_path', 'notebook_path', 'path']);

/** name -> {kind, fields} in priority order. Unknown valid calls take the generic path below. */
const TOOLS = {
  Edit:         { kind: 'edit',   fields: ['file_path', 'old_string', 'new_string'],
    extras: ['replace_all', 'path'] },
  MultiEdit:    { kind: 'edit',   fields: ['file_path', 'edits'] },
  NotebookEdit: { kind: 'edit',   fields: ['notebook_path', 'new_source'],
    extras: ['cell_id', 'cell_type', 'edit_mode'] },
  Write:        { kind: 'create', fields: ['file_path', 'content'], extras: ['path', 'contents'] },
  Read:         { kind: 'read',   fields: ['file_path', 'offset', 'limit'], extras: ['path'] },
  NotebookRead: { kind: 'read',   fields: ['notebook_path'] },
  Bash:         { kind: 'bash',   fields: ['command', 'description', 'run_in_background'],
    extras: ['timeout', 'dangerouslyDisableSandbox', 'cmd', 'workdir', 'yield_time_ms',
      'max_output_tokens', 'shell', 'login', 'tty', 'sandbox_permissions',
      'justification', 'prefix_rule',
      // Codex's native shell tool (C-02): its argv becomes `command`; these are its own options.
      'timeout_ms', 'with_escalated_permissions'] },
  Glob:         { kind: 'read',   fields: ['pattern', 'path'],
    extras: ['glob_pattern', 'target_directory'] },
  Grep:         { kind: 'read',   fields: ['pattern', 'path'],
    extras: ['glob', 'type', 'output_mode', '-i', 'head_limit', 'offset', 'multiline'] },
};

// Claude Code also records tools whose work is not a filesystem operation. They still have an
// invocation and a correlated result: dropping the whole call makes the action inventory look
// incomplete, and hiding its output can erase the reason for a later code change. Match only
// observed, typed shapes. A changed input schema takes the generic path without a guessed effect.
const CLAUDE_OTHER = Object.freeze({
  ToolSearch: { fields: ['query', 'max_results'] },
  Workflow: { fields: ['description', 'script', 'resumeFromRunId', 'scriptPath'] },
  TaskOutput: { fields: ['task_id', 'block', 'timeout'] },
  SendUserFile: { fields: ['files', 'caption', 'display', 'status'] },
  TaskStop: { fields: ['task_id'] },
  Artifact: { fields: ['action', 'intent', 'design_systems', 'file_path', 'label', 'description', 'icon'] },
  SendMessage: { fields: ['to', 'recipient', 'type', 'message', 'content', 'summary'] },
  AskUserQuestion: { fields: ['questions'] },
  mcp__ccd_session__mark_chapter: { fields: ['title', 'summary'] },
});

const own = (value, key) => Object.hasOwn(value, key);
const plain = (value) => value !== null && typeof value === 'object' && !Array.isArray(value)
  && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
const keysAre = (value, allowed) => plain(value)
  && Object.keys(value).every((key) => allowed.includes(key));
const string = (value) => typeof value === 'string';
const taskId = (value) => string(value) && /^[A-Za-z0-9_][A-Za-z0-9_./:-]{0,199}$/.test(value);
// The name is evidence, not a list of supported tools. Accept new vendor/MCP identifiers,
// including Unicode letters, while refusing header delimiters and line/bidi controls that
// could forge a second review event in a rendered prompt.
const genericToolName = (value) => string(value) && value.length > 0 && value.length <= 512
  && /^[\p{L}\p{M}\p{N}_.$:/@+\-]+$/u.test(value);
function recordedJson(value) {
  if (value === undefined) return null;
  const seen = new Set();
  const valid = (item, depth) => {
    if (depth > 64) return false;
    if (item === null || typeof item === 'string' || typeof item === 'boolean') return true;
    if (typeof item === 'number') return Number.isFinite(item);
    if (Array.isArray(item)) {
      if (seen.has(item)) return false;
      seen.add(item);
      const okay = item.every((entry) => valid(entry, depth + 1));
      seen.delete(item);
      return okay;
    }
    if (!plain(item) || seen.has(item)) return false;
    seen.add(item);
    const okay = Object.values(item).every((entry) => valid(entry, depth + 1));
    seen.delete(item);
    return okay;
  };
  try { return valid(value, 0) ? JSON.stringify(value) ?? null : null; }
  catch { return null; }
}
/** A recorded `structuredPatch` with at least one entry (an empty list records no change). */
const recordedPatch = (value) => (Array.isArray(value) ? value.length > 0 : value !== undefined && value !== null);

/**
 * D127 (B10d, the owner's go of 2026-10-22). The recorder's typed facts of one compaction, on the mark of a Claude Code
 * `compact_boundary` row that records its `compactMetadata` (the row that records the compaction; its summary row's mark
 * carries none): `{ compacted: { trigger?, before?, after? } }` — `trigger` when `compactMetadata.trigger` is `auto` or
 * `manual`, and the agent's context in tokens before and after it (`preTokens`, `postTokens`) when each is a safe
 * integer >= 0 (an empty object when it types none of them). Any other compaction mark carries nothing, so its bytes are
 * as before. Never a word of the summary.
 */
function compactedOf(rec) {
  const d = rec?.raw;
  if ((rec?.adapter ?? 'claude') !== 'claude' || !plain(d) || d.type !== 'system' || d.subtype !== 'compact_boundary'
    || !plain(d.compactMetadata)) return {};
  const metadata = d.compactMetadata;
  const count = (value) => Number.isSafeInteger(value) && value >= 0;
  return { compacted: { ...(['auto', 'manual'].includes(metadata.trigger) ? { trigger: metadata.trigger } : {}),
    ...(count(metadata.preTokens) ? { before: metadata.preTokens } : {}),
    ...(count(metadata.postTokens) ? { after: metadata.postTokens } : {}) } };
}

function visibleTaskIdAgrees(text, nativeId) {
  if (typeof text !== 'string') return false;
  const labels = [...text.matchAll(/\btask[ _-]?id\s*[:=]/gi)];
  const values = [...text.matchAll(/\btask[ _-]?id\s*[:=]\s*[`'"]?([A-Za-z0-9_][A-Za-z0-9_./:-]{0,199})(?![A-Za-z0-9_./:-])/gi)];
  const xmlOpens = [...text.matchAll(/<task_id>/gi)];
  const xmlCloses = [...text.matchAll(/<\/task_id>/gi)];
  const xmlValues = [...text.matchAll(/<task_id>\s*([A-Za-z0-9_][A-Za-z0-9_./:-]{0,199})\s*<\/task_id>/gi)];
  const keyedLabels = [...text.matchAll(/(["'])task_id\1\s*:/gi)];
  const keyedValues = [...text.matchAll(/(["'])task_id\1\s*:\s*(["'])([A-Za-z0-9_][A-Za-z0-9_./:-]{0,199})\2/gi)];
  // A label with no parseable ID is ambiguous; an unlabeled block is allowed only because the
  // native sidecar and the call's own input can still agree. Claude also uses XML task_id
  // tags in TaskOutput results. Every explicit identity, including a complete XML tag, must
  // agree; malformed tag boundaries cannot certify a native completion.
  return labels.length === values.length && values.every((match) => match[1] === nativeId)
    && xmlOpens.length === xmlValues.length && xmlCloses.length === xmlValues.length
    && xmlValues.every((match) => match[1] === nativeId)
    && keyedLabels.length === keyedValues.length
    && keyedValues.every((match) => match[3] === nativeId);
}

function claudeOtherSpec(name, input) {
  // Claude sometimes preserves an unparsed SendUserFile payload in this exact wrapper. The
  // bytes are useful action evidence, but they are not a validated file list. Capture them as
  // opaque input and leave a declared action gap instead of dropping the entire call/result.
  if (name === 'SendUserFile' && keysAre(input, ['__unparsedToolInput'])
    && own(input, '__unparsedToolInput')
    && keysAre(input.__unparsedToolInput, ['raw', 'len'])
    && string(input.__unparsedToolInput.raw)
    && Number.isSafeInteger(input.__unparsedToolInput.len)
    && input.__unparsedToolInput.len === input.__unparsedToolInput.raw.length)
    return { kind: 'other', fields: ['__unparsedToolInput'], inputUnparsed: true };
  if (!own(CLAUDE_OTHER, name) || !keysAre(input, CLAUDE_OTHER[name].fields)) return null;
  const present = (key) => own(input, key);
  const strings = (...keys) => keys.every((key) => !present(key) || string(input[key]));
  let valid = false;
  let inputUnresolved = false;
  switch (name) {
    case 'ToolSearch':
      valid = present('query') && string(input.query) && strings('query')
        && (!present('max_results') || Number.isSafeInteger(input.max_results) && input.max_results > 0);
      break;
    case 'Workflow': {
      const script = present('script') && string(input.script)
        && !present('resumeFromRunId') && !present('scriptPath');
      const resume = present('resumeFromRunId') && present('scriptPath') && !present('script')
        && strings('resumeFromRunId', 'scriptPath');
      valid = strings('description') && (script || resume);
      inputUnresolved = resume; // a path to an earlier script is not that script's recorded text
      break;
    }
    case 'TaskOutput':
      valid = present('task_id') && string(input.task_id)
        && (!present('block') || typeof input.block === 'boolean')
        && (!present('timeout') || Number.isSafeInteger(input.timeout) && input.timeout >= 0);
      break;
    case 'SendUserFile':
      valid = present('files') && Array.isArray(input.files) && input.files.every(string)
        && strings('caption', 'display', 'status');
      break;
    case 'TaskStop':
      valid = present('task_id') && string(input.task_id);
      break;
    case 'Artifact':
      valid = strings('action', 'intent', 'file_path', 'label', 'description', 'icon')
        && (!present('design_systems') || typeof input.design_systems === 'boolean')
        && (present('action') && present('intent') || present('file_path'));
      break;
    case 'SendMessage':
      valid = present('message') && string(input.message)
        && (present('to') || present('recipient'))
        && strings('to', 'recipient', 'type', 'message', 'content', 'summary');
      break;
    case 'AskUserQuestion':
      valid = present('questions') && Array.isArray(input.questions)
        && input.questions.every((question) => keysAre(question, ['header', 'multiSelect', 'options', 'question'])
          && string(question.question) && (!own(question, 'header') || string(question.header))
          && (!own(question, 'multiSelect') || typeof question.multiSelect === 'boolean')
          && Array.isArray(question.options) && question.options.every((option) =>
            keysAre(option, ['label', 'description']) && string(option.label)
              && (!own(option, 'description') || string(option.description))));
      break;
    case 'mcp__ccd_session__mark_chapter':
      valid = present('title') && string(input.title) && strings('summary');
      break;
  }
  return valid ? { kind: 'other', fields: CLAUDE_OTHER[name].fields,
    ...(inputUnresolved ? { inputUnresolved: true } : {}) } : null;
}

// ---------------------------------------------------------------------------------------------
// C-02 M33 D: the typed completion evidence Claude Code writes (versions 2.1.121 and later; D98 reads a
// notification by its kind whatever keys sit beside it, and a launch by its typed id).
// ---------------------------------------------------------------------------------------------
const BASH_SIDECAR_REQUIRED = Object.freeze(['stdout', 'stderr', 'interrupted', 'isImage', 'noOutputExpected']);
const BASH_SIDECAR_OPTIONAL = Object.freeze(['bashEditDiff', 'gitOperation', 'dangerouslyDisableSandbox',
  'persistedOutputPath', 'persistedOutputSize', 'returnCodeInterpretation', 'staleReadFileStateHint']);
const BASH_SIDECAR_BACKGROUND = Object.freeze(['backgroundTaskId', 'backgroundCwdHint', 'timedOutAfterMs']);
/**
 * A parent Bash result's typed sidecar, read only with the block's own explicit `is_error: false`:
 *   {kind: 'succeeded'}       the known success sidecar, not interrupted, no background id and no
 *                             `returnCodeInterpretation` — the harness's completion verdict;
 *   {kind: 'benign_nonzero'}  the same with `returnCodeInterpretation`: a nonzero exit the harness
 *                             judged benign, whose nature is not recorded — proves nothing;
 *   {kind: 'background', taskId}  a background launch (`backgroundTaskId`), not a completion;
 *   null                      any other shape, key or value type (fail closed).
 * Sub-agent recordings write no sidecar on a success, so this never applies to them.
 */
function claudeBashSidecar(res) {
  const s = res?.raw;
  if (res?.isErrorFalse !== true || res.isError === true || !plain(s)) return null;
  if (!BASH_SIDECAR_REQUIRED.every((key) => own(s, key)) || !keysAre(s,
    [...BASH_SIDECAR_REQUIRED, ...BASH_SIDECAR_OPTIONAL, ...BASH_SIDECAR_BACKGROUND])) return null;
  if (!string(s.stdout) || !string(s.stderr) || s.interrupted !== false
    || typeof s.isImage !== 'boolean' || typeof s.noOutputExpected !== 'boolean') return null;
  const optional = (key, ok) => !own(s, key) || ok(s[key]);
  if (!optional('bashEditDiff', plain) || !optional('gitOperation', plain)
    || !optional('dangerouslyDisableSandbox', (v) => typeof v === 'boolean')
    || !optional('returnCodeInterpretation', string) || !optional('staleReadFileStateHint', string)
    || own(s, 'persistedOutputPath') !== own(s, 'persistedOutputSize')
    || !optional('persistedOutputPath', string)
    || !optional('persistedOutputSize', (v) => Number.isSafeInteger(v) && v >= 0)) return null;
  if (BASH_SIDECAR_BACKGROUND.some((key) => own(s, key))) {
    return taskId(s.backgroundTaskId) && optional('backgroundCwdHint', string)
      && optional('timedOutAfterMs', (v) => Number.isSafeInteger(v) && v >= 0)
      ? { kind: 'background', taskId: s.backgroundTaskId } : null;
  }
  return own(s, 'returnCodeInterpretation') ? { kind: 'benign_nonzero' } : { kind: 'succeeded' };
}
/** The characters of a task id's own token: a neighbour of one of these continues the token, so an id standing beside
 *  one is part of another token. */
const ID_TOKEN_CHAR = /[A-Za-z0-9_-]/;
/**
 * D98 (F1, audit L2 applied to Bash): a background launch is identified by its typed sidecar id alone, and its visible
 * result names that very id. True when `id` (a typed task id) appears literally in `text` as a token of its own: the
 * characters around it are not id characters. No harness sentence decides it, so the stub of a launched command, the
 * stub of a command moved to the background at its timeout, and any later rewording of either are read alike.
 */
export function resultNamesTypedId(text, id) {
  if (typeof text !== 'string' || !taskId(id)) return false;
  for (let at = text.indexOf(id); at !== -1; at = text.indexOf(id, at + 1)) {
    const before = at > 0 ? text[at - 1] : '';
    const after = text[at + id.length] ?? '';
    if (!ID_TOKEN_CHAR.test(before) && !ID_TOKEN_CHAR.test(after)) return true;
  }
  return false;
}
const EDIT_SIDECAR_REQUIRED = Object.freeze(['filePath', 'oldString', 'newString', 'originalFile', 'replaceAll',
  'structuredPatch', 'userModified']);
const EDIT_SIDECAR_OPTIONAL = Object.freeze(['memdirStamped', 'contentNotInModelContext', 'staleRecovered']);
/**
 * A parent Edit result's sidecar proves the edit landed only when it has exactly the known keys and
 * types, `userModified: false`, and repeats the call's own recorded path, old and new text and
 * replace-all flag. A user-modified or otherwise different edit is not the recorded one.
 */
function claudeEditSidecarProves(raw, input) {
  if (!plain(raw) || !plain(input) || !EDIT_SIDECAR_REQUIRED.every((key) => own(raw, key))
    || !keysAre(raw, [...EDIT_SIDECAR_REQUIRED, ...EDIT_SIDECAR_OPTIONAL])) return false;
  if (!string(raw.filePath) || !string(raw.oldString) || !string(raw.newString)
    || !(raw.originalFile === null || string(raw.originalFile)) || typeof raw.replaceAll !== 'boolean'
    || !Array.isArray(raw.structuredPatch) || raw.userModified !== false
    || EDIT_SIDECAR_OPTIONAL.some((key) => own(raw, key) && typeof raw[key] !== 'boolean')) return false;
  return raw.filePath === input.file_path && raw.oldString === input.old_string
    && raw.newString === input.new_string && raw.replaceAll === (input.replace_all === true);
}
/**
 * M33 D repair: a sidecar carrying typed write evidence — a Write's `type: create|update` (resultEvidence)
 * or any sidecar naming a `filePath` (the Edit sidecar claudeEditSidecarProves reads, with the
 * `originalFile` attachResult keeps as the pre-edit source). The whole sidecar, for the repeat
 * fingerprint only: two result rows for one call recording different sidecars are not one result.
 */
function claudeWriteSidecar(raw) {
  return plain(raw) && (raw.type === 'create' || raw.type === 'update' || string(raw.filePath)) ? raw : null;
}
/**
 * A Claude task notification, on one of its two typed carriers (D98, F1: the one carrier rule every reader of the
 * fact calls, harness-context.js `claudeNotificationCarrier`):
 *   - a `user` row whose `origin` is of the `task-notification` kind, its string content; or
 *   - a `queued_command` attachment (records.js kind `notification`) whose `commandMode` is exactly
 *     `task-notification`, its string `prompt` (an `origin`, if recorded, must be that same kind).
 * Recorder keys beside an origin's kind (`producer`, `runId`) are its metadata. The text is one `<task-notification>`
 * block. Its header (before any `<summary>` or `<result>`, which carry model-written text) holds the one `<task-id>`,
 * `<tool-use-id>` and `<status>` of the whole text. Returns those three, or null. Status only: no summary or result
 * text is read.
 */
export function claudeTaskNotification(d) {
  return taskNotificationRead(d)?.notice ?? null;
}

/**
 * D99 (F1 guard): the status join's one reading of a row (`claudeTaskNotification` is its `notice`): null when the row is
 * no task notification by the carrier rule; `{ notice }` when the join types it; else `{ miss }`, the census reason
 * (labels.js RECORDER_CENSUS_REASONS) of the first test of the join it fails, so every carrier the join does not type is
 * counted under exactly one reason. The tests and their order are the join's, unchanged: one block; each header element
 * recorded at most once (one recorded twice, or unbalanced, is unparsed); then the call id, the task id and the status.
 */
export function taskNotificationRead(d) {
  const carrier = claudeNotificationCarrier(d);
  if (carrier === null) return null;
  const R = RECORDER_CENSUS_REASONS;
  if (!string(carrier.text)) return { miss: R.notificationUnparsed };
  const text = carrier.text.trim();
  if (!text.startsWith('<task-notification>') || !text.endsWith('</task-notification>'))
    return { miss: R.notificationUnparsed };
  const count = (tag) => [text.split(`<${tag}>`).length - 1, text.split(`</${tag}>`).length - 1];
  const times = (tag, n) => count(tag).every((k) => k === n);
  if (!times('task-notification', 1) || ['task-id', 'tool-use-id', 'status'].some((tag) => !times(tag, 1)
    && !times(tag, 0))) return { miss: R.notificationUnparsed };
  const bodyAt = [text.indexOf('<summary>'), text.indexOf('<result>')].filter((at) => at >= 0);
  const header = bodyAt.length ? text.slice(0, Math.min(...bodyAt)) : text;
  const field = (tag) => header.match(new RegExp(`<${tag}>\\s*([^<\\s]+)\\s*</${tag}>`))?.[1];
  const id = field('task-id'), callId = field('tool-use-id'), status = field('status');
  if (!taskId(callId)) return { miss: R.notificationNoCallId };
  if (!taskId(id)) return { miss: R.notificationNoTaskId };
  if (!TASK_NOTIFICATION_STATUSES.includes(status)) return { miss: R.notificationStatusUnknown };
  return { notice: { taskId: id, toolUseId: callId, status } };
}


/** Only these already-vetted filesystem adapter names can imply file effects. A new server or
 * suffix remains a generic invocation; a verb in an arbitrary name proves no filesystem effect. */
function mcpSpec(name, input) {
  const names = {
    mcp__fs__write_file: { kind: 'create', body: 'content' },
    mcp__fs__create_file: { kind: 'create', body: 'content' },
    mcp__fs__edit_file: { kind: 'edit', body: 'replacement' },
    mcp__fs__append_file: { kind: 'edit', body: 'content' },
    mcp__fs__save_file: { kind: 'edit', body: 'content' },
    mcp__fs__delete_file: { kind: 'delete', body: 'none' },
    mcp__fs__trash_file: { kind: 'delete', body: 'none' },
    mcp__fs__read_file: { kind: 'read', body: 'none' },
    mcp__codex__delete_file: { kind: 'delete', body: 'none' },
  };
  if (!Object.hasOwn(names, name) || !plain(input)) return null;
  const { kind, body } = names[name];
  const fields = ['file_path', 'path', ...(body === 'content'
    ? ['content', 'text', 'contents'] : body === 'replacement'
      ? ['old_string', 'new_string', 'edits'] : [])];
  if (!keysAre(input, fields)) return null;
  if (own(input, 'path') && own(input, 'file_path')
    && input.path !== input.file_path) return null;
  const bodies = ['content', 'text', 'contents'].filter((key) => own(input, key));
  if (bodies.length > 1 && bodies.some((key) => input[key] !== input[bodies[0]])) return null;
  const path = input.file_path ?? input.path;
  if (!string(path) || !path) return null;
  if (body === 'content' && bodies.length === 0) return null;
  if (body === 'replacement' && !(own(input, 'old_string') && own(input, 'new_string'))
    && !own(input, 'edits')) return null;
  if (body === 'replacement' && own(input, 'old_string') !== own(input, 'new_string'))
    return null;
  if (body === 'replacement' && own(input, 'edits')
    && (own(input, 'old_string') || own(input, 'new_string'))) return null;
  if (['content', 'text', 'contents', 'old_string', 'new_string'].some((key) =>
    own(input, key) && !string(input[key]))) return null;
  if (own(input, 'edits') && (!Array.isArray(input.edits)
    || !input.edits.every((edit) => keysAre(edit, ['old_string', 'new_string', 'replace_all'])
      && string(edit.old_string) && string(edit.new_string)
      && (!own(edit, 'replace_all') || typeof edit.replace_all === 'boolean')))) return null;
  return { kind, fields };
}

/**
 * Lane g3: whether `workdir` names the recorded session cwd, lexically. Never resolved against the
 * host (posix.resolve reads process.cwd() for a relative cwd, so the same records would slice
 * differently from another working directory). A relative cwd compares only with a relative
 * workdir joined onto it; an absolute workdir cannot be proved to equal a relative cwd.
 */
function sameDirectory(cwd, workdir) {
  if (!cwd.startsWith('/') && workdir.startsWith('/')) return false;
  const lexical = (path) => { const normal = posix.normalize(path); return normal.length > 1 ? normal.replace(/\/+$/, '') : normal; };
  return lexical(workdir.startsWith('/') ? workdir : `${cwd}/${workdir}`) === lexical(cwd);
}

function coreSpec(name, input, cwd, sourceName = name) {
  if (!own(TOOLS, name)) return null;
  const spec = TOOLS[name];
  if (!keysAre(input, [...spec.fields, ...(spec.extras ?? [])])) return null;
  const present = (key) => own(input, key);
  const optionalString = (...fields) => fields.every((key) => !present(key) || string(input[key]));
  const sameWorkdir = present('workdir') && string(input.workdir) && string(cwd) && cwd
    && sameDirectory(cwd, input.workdir);
  const codexOwnWorkdir = present('workdir')
    && ['exec_command', 'functions.exec_command'].includes(sourceName)
    && string(input.workdir) && input.workdir.length > 0 && input.workdir.length <= 8192
    && posix.isAbsolute(input.workdir);
  const path = input.file_path ?? input.notebook_path ?? input.path;
  if (['Edit', 'MultiEdit', 'NotebookEdit', 'Write', 'Read', 'NotebookRead'].includes(name)
    && (!string(path) || !path)) return null;
  if (present('file_path') && present('path') && input.file_path !== input.path)
    return null;
  if (name === 'Bash' && (!string(input.command) || !input.command
    || !optionalString('description')
    || present('cmd') && input.cmd !== input.command
    || present('shell') && (!string(input.shell)
      || !/(^|\/)(bash|zsh|sh)$/.test(input.shell))
    || present('workdir') && !sameWorkdir && !codexOwnWorkdir
    || present('run_in_background') && typeof input.run_in_background !== 'boolean'
    || present('dangerouslyDisableSandbox') && typeof input.dangerouslyDisableSandbox !== 'boolean'
    || present('timeout') && (!Number.isSafeInteger(input.timeout) || input.timeout < 0))) return null;
  if (name === 'Edit' && (!optionalString('old_string', 'new_string')
    || present('replace_all') && typeof input.replace_all !== 'boolean')) return null;
  if (name === 'MultiEdit' && present('edits') && (!Array.isArray(input.edits)
    || !input.edits.every((edit) => keysAre(edit, ['old_string', 'new_string', 'replace_all'])
      && string(edit.old_string) && string(edit.new_string)
      && (!own(edit, 'replace_all') || typeof edit.replace_all === 'boolean')))) return null;
  if (name === 'NotebookEdit' && (!optionalString('new_source')
    || !optionalString('cell_id', 'cell_type', 'edit_mode')
    || present('edit_mode') && !['insert', 'replace', 'delete'].includes(input.edit_mode)))
    return null;
  if (name === 'Write' && (!optionalString('content', 'contents')
    || present('contents') && present('content') && input.contents !== input.content)) return null;
  if (name === 'Read' && ['offset', 'limit'].some((key) =>
    present(key) && (!Number.isSafeInteger(input[key]) || input[key] < 0))) return null;
  if (['Glob', 'Grep'].includes(name) && (!string(input.pattern) || !input.pattern
    || !optionalString('path', 'glob', 'type', 'output_mode')
    || !optionalString('glob_pattern', 'target_directory')
    || present('glob_pattern') && input.glob_pattern !== input.pattern
    || present('target_directory') && present('path')
      && input.target_directory !== input.path
    || ['head_limit', 'offset'].some((key) => present(key)
      && (!Number.isSafeInteger(input[key]) || input[key] < 0))
    || ['-i', 'multiline'].some((key) => present(key) && typeof input[key] !== 'boolean')))
    return null;
  return name === 'Bash' && codexOwnWorkdir && !sameWorkdir
    ? { ...spec, distinctWorkdir: true } : spec;
}

// ToolSearch returns references, not text blocks. An exact reference block exposes its recorded
// tool name to the assistant, so that name is a quotable O. Any unknown block/field remains
// nontext and keeps its observation gap; never stringify opaque native sidecars into evidence.
function toolSearchResultOf(record, id, result) {
  const blocks = record?.message?.content;
  if (!Array.isArray(blocks)) return result;
  const matches = blocks.filter((block) => block?.type === 'tool_result' && block.tool_use_id === id);
  if (matches.length !== 1 || !Array.isArray(matches[0].content)) return result;
  const refs = matches[0].content;
  if (!refs.every((ref) => plain(ref) && Object.keys(ref).length === 2
    && ref.type === 'tool_reference' && string(ref.tool_name) && ref.tool_name.length > 0
    && !/[\\\r\n]/.test(ref.tool_name))) return result;
  const names = refs.map((ref) => ref.tool_name);
  if (result.raw && (!Array.isArray(result.raw.matches)
    || result.raw.matches.length !== names.length
    || !result.raw.matches.every((name, index) => name === names[index]))) return result;
  const visible = names.join('\n');
  // Keep the native block boundaries separately from the convenience text. The names are each
  // independently visible, but their joined form never occurred as one quotable source span.
  return { ...result, text: visible, visibleText: visible, referenceNames: names, nonText: false };
}

// Codex / other harnesses use different names for the same operations.
const ALIASES = {
  apply_patch: 'Edit', str_replace_editor: 'Edit', edit_file: 'Edit',
  create_file: 'Write', write_file: 'Write',
  read_file: 'Read', view_file: 'Read',
  shell: 'Bash', run_terminal_cmd: 'Bash', exec_command: 'Bash', local_shell: 'Bash',
};

// Exact adapter names with a known command or filesystem mutation effect. A schema miss on
// one of these remains an attempted generic call, but cannot certify action coverage.
// Unknown MCP/vendor tools are never classified from a verb-like suffix.
const KNOWN_CODE_EFFECT = new Set([
  'Bash', 'Edit', 'MultiEdit', 'NotebookEdit', 'Write',
  'exec_command', 'functions.exec_command', 'shell', 'functions.shell',
  'local_shell', 'functions.local_shell', 'container.exec', 'run_terminal_cmd',
  'apply_patch', 'functions.apply_patch', 'write_file', 'functions.write_file',
  'create_file', 'functions.create_file', 'str_replace_editor', 'functions.str_replace_editor',
  'edit_file', 'functions.edit_file',
  'mcp__fs__write_file', 'mcp__fs__create_file', 'mcp__fs__edit_file',
  'mcp__fs__append_file', 'mcp__fs__save_file', 'mcp__fs__delete_file',
  'mcp__fs__trash_file', 'mcp__codex__delete_file',
]);

/** Shell forms that write a file. A `sed -i` edit is invisible to the tool stream otherwise.
 *  This is the line scan used where a command cannot be lexed, and over heredoc body lines. A
 *  command that lexes (almost all of them) reads `sed -i` and `cat > path <<DELIM` from its words
 *  instead (`sedTargets`, `catHeredoc`) and the other forms below from each command's own text. */
const SHELL_WRITES = [
  { re: /\bsed\s+(-[a-z]*i[a-z]*)\s+(?:''\s+|"[^"]*"\s+)?(?:-e\s+\S+\s+)*['"]?[^'"\s]+['"]?\s+(\S+)/, g: 2, how: 'sed -i' },
  { re: /\btee\s+(?:-a\s+)?(\S+)/, g: 1, how: 'tee' },
  { re: /\bcat\s*>\s*(\S+)\s*<<\s*['"]?\w+/, g: 1, how: 'heredoc' },
  { re: /(?:^|\s)>>?\s*(\S+\.\w{1,6})(?:\s|$)/, g: 1, how: 'redirect' },
  // A LICENSE fetched with `curl -o` once made most of a review's "explained by nothing"
  // lines. Download-to-file is a shell write like any other.
  { re: /\bcurl\b[^|;&]*\s-[a-zA-Z]*o\s+(\S+)/, g: 1, how: 'curl -o' },
  { re: /\bwget\b[^|;&]*\s-O\s+(\S+)/, g: 1, how: 'wget -O' },
];
/** A lexed command's `sed -i` comes from its words: the regex above cannot see a quoted script
 *  holding a space (`sed -i 's/max: 100/max: 120/' f`, W3c-8) and read its second word as the file. */
const LEXED_FORMS = SHELL_WRITES.filter((f) => f.how !== 'sed -i');

// Extensions a shell write is allowed to claim. Docs and config belong here: a heredoc writing
// README.md is as much an edit as one writing handler.py, and excluding them cost commits their
// session link.
const SOURCE_EXT = /\.(js|mjs|cjs|jsx|ts|tsx|py|rb|go|rs|java|kt|swift|c|h|cc|cpp|hpp|cs|php|scala|sh|bash|sql|yaml|yml|toml|md|json|jsonl|txt|cfg|ini|env|lock|html|htm|css|scss|sass|less|vue|svelte|xml|svg|graphql|proto)$/i;

/**
 * Build the event stream.
 * @param {object[]} records  from readSession
 * @param {{cwd?: string}} opts
 * @returns {{events: object[], ask: object[], claim: object, marks: object[]}}
 */
export function buildEvents(records, { cwd = '', outcomes = null, claudeLocators = false, home = null } = {}) {
  // D69 (b): where a path stands, for the harness home folders' rule: the recording's home (sliceLineage
  // `recordingHome`, from where the recorder wrote it) and the recorder's working directory.
  const place = Object.freeze({ home, cwd });
  // M34 labels: records a caller built itself carry no reader's labels; label them once, by the reader's own function.
  ensureClaudeLabels(records);
  const events = [];
  const ask = [];
  // OWNER DECISION B (2026-10-01): the human's own words recorded within a turn — a prompt queued while the agent
  // worked, and an AskUserQuestion answer — each at its recorded row (`rowAt`), in record order. Not asks: no turn
  // starts, and every reader of `ask` keeps its bytes; the evidence adapter reads them as human instructions.
  const interjections = [];
  // D71 (g), owner decision 2026-10-08: the project's own instruction files the harness gave the agent, each at the row
  // of the typed attachment that carried it (`rowAt`), in record order — `{ turn, beforeEvent, source, record, path, text,
  // identity }`. Never one of a kind other than the project's (PROJECT_INSTRUCTION_TYPES). D90 (owner decision
  // 2026-10-15): none is withheld for where it lies (D69 b withheld one under the harness home folders or at a
  // credential-shaped path, as their reads were). Not asks and not events.
  const projectInstructions = [];
  // D150: each file the harness noticed changed outside the agent's edit calls (records.js EDITED_FILE_RECORD), at its row.
  const editedFiles = [];
  // OWNER DECISION B: each Claude AskUserQuestion call's recorded questions (each one's text and whether it lets the
  // human choose several options, `multiSelect`), by call key, and the answers read from its result (the entries above,
  // and the sidecar they were read from), so a retraction withdraws them.
  const askQuestions = new Map();
  const answered = new Map();
  // M33 U repair, L1: the actions the human refused (`CLAUDE_USER_REFUSAL`), whose answer may hold the human's words,
  // marked `humanAnswerUnresolved` once every result is attached, so no retraction can undo the mark; and the refused
  // calls no ledger action carries (a hand-off, a result for no recorded call, a later result for a call already found
  // ambiguous), counted.
  const rejectedWithWords = new Set();
  const unplacedWords = new Set();
  // M34 labels review (F4): the calls whose result the slicer labelled the human's answer on a recorder whose answer
  // this reader does not read (a synchronous Codex `request_user_input`: its output is the recorder's text, not a typed
  // answer field): declared unread at the call (`humanAnswerUnresolved`), or counted unplaced with the words above.
  const unreadAnswers = new Set();
  // OWNER DECISION 2026-10-06: a session the recorder shows no human submitted (`CLAUDE_SESSION_TYPE`) had no one to
  // answer a permission prompt, so a refusal it records declares no unread answer.
  const sessionType = claudeSessionType(records);
  const headless = sessionType === SESSION_TYPES.nonInteractive;
  // L1 session-type review (finding L1S-unknown-type-not-counted; OWNER DECISION 2026-10-06): in a session whose type
  // the recorder did not record, a refusal keeps its declaration (fail closed) under its own counted reason — the
  // actions marked `refusalSessionUnknown` once every result is attached, and such calls no ledger action carries — so
  // its rate stays computable apart from a refusal a human was there to give (`humanAnswerUnresolved`).
  const typeUnrecorded = sessionType === SESSION_TYPES.unknown;
  const unrecordedTypeRefusals = new Set();
  const unrecordedTypeUnplaced = new Set();
  // L1 review (OWNER DECISION 2026-10-06): the calls whose result a recorder that types no refusal recorded as an error
  // (`CLAUDE_UNTYPED_DENIAL_RECORDER`), marked `refusalUntyped` once every result is attached; and such calls no ledger
  // action carries. All of them are counted.
  const untypedRefusals = new Set();
  const untypedUnplaced = new Set();
  const marks = [];
  let turn = 0;
  let seq = 0;
  let lastAssistantText = '';
  // Last assistant text PER HUMAN TURN — the per-arc claim channel (D1/D23: a workspace session
  // is many trajectories, and each arc's closing message is that arc's claim). Kept WHOLE (M33 F
  // repair 3, D68 E): nothing bounds it and nothing masks it (D90) — what the agent produced is kept whole.
  const sayings = new Map();
  // Closing claims remain a compatibility view. They must never overwrite the visible working
  // narrative. beforeEvent locates a statement relative to captured actions, not its cause.
  const commentary = [];
  const commentaryCapture = { version: 1, blocks: 0, bytes: 0, unsupported: 0, privateExcluded: 0, nonTextExcluded:0 };
  // D150: `unreadRows` counts the user rows of `unclassifiedRows` the reader did not already count as unread rows (a
  // drifted Claude turn it counts itself, records.js `claudeDriftedTurn`), so each row is counted once by kind.
  const instructionCapture = { nonTextExcluded: 0, unclassifiedRows: 0, unreadRows: 0, feedbackUnplaced: 0,
    refusalUntyped: 0, refusalSessionUnknown: 0, notificationUnmatched: 0 };
  // M33 W: each Claude Workflow call's own recorded launch sidecar (runId, transcriptDir, workflowName), by event
  // index. Kept apart from the events, so no ledger byte changes; slicer/index.js hands it only to a caller that asks
  // (cli/src/session-evidence.js), which reads it, links the run by exact recorded identity, and drops it.
  const workflowCalls = new Map();
  // M33 P: what places a helper's work where the parent RECEIVED it (helper-deliveries.js), kept apart from the events
  // as the Workflow launches are, so no ledger byte changes: each Claude background Agent launch and the row of its
  // earliest recorded completed receipt (a settled notification or, M33 P repair, a typed TaskOutput completion); each
  // synchronous Agent/Task hand-off and the row of its own single result (M33 P repair); each Codex send (its encrypted token, in memory only, never stored); each
  // encrypted arrival a helper's own recording received; each helper FINAL_ANSWER row of this recording. Only a caller
  // that asks receives it (slicer/index.js `helperDeliveries`), and it drops it before any ledger is kept.
  // M33 P second repair: each Claude Agent/Task hand-off, by its call's result key. Whether it ran in the background is
  // read from what its own single result RECORDS (`handOffResult`), never from its input alone: Claude Code writes the
  // asynchronous launch stub for calls whose input records no `run_in_background`. A LAUNCH (`mode: 'launch'`) is
  // received later, by its notification or a typed TaskOutput completion; any other single result (`mode: 'sync'`) is
  // where the parent, which waited for it, received it (a sibling call recorded between its call and that row ran
  // concurrently with it).
  const handOffCalls = new Map();        // result key -> { callId, source, record, turn, results, conflict, mode, ... }
  const sends = [];
  const arrivals = [];
  const reports = [];
  // M33 P (W2 minor P4): each typed TaskOutput completion and the row where the parent received it.
  const taskOutputReceipts = [];
  // D175: each typed resume of a launched Claude helper (a SendMessage whose one result records `resumedAgentId`), with
  // the row of the one final notification that names its call and that agentId (its receipt), when one settled.
  const resumes = [];
  // D175 fix round: each row on which a task notification reached this recording's agent as a message of its own — a
  // `user` row the labeller labelled a task notification (records.js `claudeLabeller`; not a `queued_command` attachment,
  // which joins a request in progress; not a copy read in another recording of the lineage) — `{turn, source, record}`.
  // In a helper's own recording it is a task of its own waking it after a reply, within the same turn: its work in that
  // turn may go on after its parent received that reply.
  const wakes = [];

  // tool_use_id -> index in `events`, so the following user record can attach its result.
  const pending = new Map();
  const knownCallIds = new Set();
  const settled = new Map();
  const ambiguousIds = new Set();
  // A result may arrive after a compaction in a later file of the same lineage. Match its
  // recorded ID across that boundary; if an ID is reused for another call, withhold both O's.
  const resultKey = (id) => JSON.stringify(id);
  const resultFingerprint = (res, d, id, generic = false) => JSON.stringify(generic ? [
    res.visibleText, res.visibleSpans, res.isError, res.visibleNonText,
    res.outcomeUnknown === true,
  ] : [
    res.text, res.visibleText, res.visibleSpans, res.isError, res.nonText,
    res.visibleNonText,
    d.exitCode ?? res.exitCode ?? outcomes?.get(id)?.exitCode ?? null,
    res.raw?.interrupted === true || outcomes?.get(id)?.interrupted === true,
    res.outcomeUnknown === true,
    res.raw?.status === 'async_launched',
    res.raw?.retrieval_status === 'success',
    res.raw?.task?.status === 'completed',
    // M33 D: a repeat recording a different typed verdict or background id is not the same result.
    res.isErrorFalse === true, claudeBashSidecar(res),
    // M33 D repair: nor one recording a different typed write sidecar. An Edit sidecar no longer
    // reaches `text`, and a Write's type, path and prior file never did.
    claudeWriteSidecar(res.raw),
  ]);
  // C-02 M33 D: launches a later typed task notification may close, by the launch call's result key:
  // {index, taskId, kind: 'bash' | 'workflow', statuses, conflict}. Only launches whose result was
  // attached before the notification row are here, so a notification is always a later row.
  const notificationLaunches = new Map();
  // C-02 M33 D: a Claude Edit call's recorded input, by call key, for its sidecar's exact repeat.
  const claudeEditInputs = new Map();
  // D175: a Claude SendMessage's call id, row and recorded message (a string, else null), by call key, for the resume its
  // one typed result may record (`resumes` below).
  const sendCalls = new Map();
  // M34 labels review (F5): each ledger action's count of the task notifications linked to it (by event index).
  const notified = new Map();
  // D99 (F1 guard): the row of each Claude command's own result, by event index — `{source, record, uuid}` — where a
  // background launch's verbatim search starts (background-ends.js); and each Claude Bash result whose recorded
  // background task id registered no launch, `{reason, version}` (the recorder census).
  const resultRows = new Map();
  const launchMisses = [];
  // M33 W2: `at` is where the row was read — its human turn, the actions recorded before it (as commentary and a typed
  // interrupt mark record it) and its row. A Workflow launch keeps the EARLIEST row that joined it (`receipt`): where
  // the parent received the run's completion, kept only if the join settles (below). Never a timestamp.
  const joinNotification = (row, at, rec = null, copy = false) => {
    const notice = claudeTaskNotification(row);
    // M34 labels (C-02 "Slice-time labels"): a row labelled a task notification is an observation linked, at slicing, to
    // the call whose id it carries (records.js `claudeLabeller`: `links.notifies`, the one `tool-use-id` element of its
    // text, a call the recording recorded before it; whatever its status). M34 labels review (F5): the link is read here,
    // never re-decided: a call a ledger action carries counts the notification on that action (`notified`), and a link
    // that names no call the lineage recorded is counted (`notification_unmatched`), never linked. Owner decision
    // 2026-10-07: an unlinked notification is the labeller's to count — its label carries that gap when its carried id
    // names no call recorded before it (counted with every label, index.js), and none when it carries no call id.
    // A row copied from another recording of the lineage was read there: neither counts again.
    const part = copy ? undefined : partsOf(rec).find((entry) => entry.basis === LABEL_BASIS.taskNotification);
    if (part && row?.type === 'user') wakes.push({ turn: at.turn, source: at.source, record: at.record });
    const key = part?.links && Object.hasOwn(part.links, 'notifies') ? resultKey(part.links.notifies) : null;
    if (key !== null) {
      if (!knownCallIds.has(key)) instructionCapture.notificationUnmatched++;
      else {
        const index = pending.get(key) ?? settled.get(key)?.index;
        if (index !== undefined) notified.set(index, (notified.get(index) ?? 0) + 1);
        // D99 (F1 guard): a notification linked to an Agent hand-off (no ledger action) counts on the hand-off.
        else if (handOffCalls.has(key)) handOffCalls.get(key).notified = (handOffCalls.get(key).notified ?? 0) + 1;
      }
    }
    const launch = notice ? notificationLaunches.get(resultKey(notice.toolUseId)) : undefined;
    if (launch && launch.taskId === notice.taskId) {
      launch.statuses.add(notice.status);
      // M33 P: a background Agent's launch keeps its earliest joined row the same way.
      // D175: and a typed resume (a SendMessage that resumed a launched helper) likewise.
      if ((launch.kind === 'workflow' || launch.kind === 'agent' || launch.kind === 'resume') && launch.receipt === undefined)
        launch.receipt = at;
    } else if (launch) launch.conflict = true;
  };
  /**
   * M33 P. A Claude Agent/Task hand-off is recorded here until its own result says how it ran (`handOffResult`). An
   * asynchronous LAUNCH: the parent keeps working and receives the agent's completion later, as a typed task
   * notification (or a typed TaskOutput completion). Its own result row is its launch only when it is that call's one
   * result, not an error, and names exactly one agentId on its receipt line (delegation.js `recordedAgentId`, the M33 D
   * child identity) with which a sidecar agentId, when recorded, agrees. That agentId is the native id the notification
   * must name beside this call's id (the C-02 M33 D join). A call id recorded twice, or a second result, launches
   * nothing and receives nothing.
   */
  const noteHandOff = (rec, recordIndex, use) => {
    const input = plain(use?.input) ? use.input : {};
    if ((rec.adapter === 'claude' || rec.adapter == null) && use.id != null) {
      const key = resultKey(use.id);
      // A call id recorded twice, or also an action's, identifies no one launch (and no one synchronous call).
      if (handOffCalls.has(key)) { handOffCalls.get(key).conflict = true; notificationLaunches.delete(key); return; }
      if (pending.has(key) || settled.has(key) || ambiguousIds.has(key)) return;
      handOffCalls.set(key, { callId: use.id, source: rec.source ?? 0, record: rec.line ?? recordIndex + 1, turn,
        results: 0, mode: null, launched: false, conflict: false });
    } else if (rec.adapter === 'codex' && isEncryptedBrief(input.message)) {
      // A spawn_agent or followup_task payload: joined to its arrival in the helper by exact token equality only.
      sends.push({ kind: 'delegation', callId: use.sourceCallId ?? use.id, source: rec.source ?? 0,
        record: rec.line ?? recordIndex + 1, turn, token: input.message });
    }
  };
  /**
   * M33 P second repair. A hand-off's own result decides how it ran, by what that result RECORDS — never by the call's
   * input alone (Claude Code writes the launch stub for calls whose input records no `run_in_background`, and a call
   * whose input asked for the background can be answered by the agent's report). L2: by
   * its TYPED status only, never by its text. It is the asynchronous LAUNCH STUB when a single-block sidecar records
   * `status: "async_launched"` or `isAsync: true`; a sidecar that records another status or an `isAsync` other than
   * true beside either contradicts it, and the result proves nothing (no launch, no receipt). A launch stub is never a
   * receipt: it is received only by its later notification or typed TaskOutput completion. A sidecar that records
   * another status (or `isAsync` other than true) and no launch is the SYNCHRONOUS hand-off's: the row where the parent
   * received the agent's result, kept only when it is that call's one result and not ambiguous (an error result is still
   * where the parent received it). A result with no single-block sidecar, or one that records neither field, records no
   * launch mode: the mode is UNKNOWN (`mode: 'unknown'`), never guessed from the result's words, so it is neither a launch
   * nor a receipt, and the loader declares it (session-evidence.js, `helper_launch_mode_unknown`). The recorder
   * types the status of an Agent/Task result; the launch sentence this replaced matched only results that were typed
   * already. A second result proves neither.
   */
  const handOffResult = (call, key, res, d, blocks, at) => {
    call.results++;
    if (call.results > 1 || res.ambiguous === true) {
      call.conflict = true;
      notificationLaunches.delete(key);
      return;
    }
    const sidecar = blocks === 1 && plain(d?.toolUseResult) ? d.toolUseResult : null;
    const typedLaunch = sidecar !== null && (sidecar.status === 'async_launched' || sidecar.isAsync === true);
    const typedOther = sidecar !== null && (own(sidecar, 'status') && sidecar.status !== 'async_launched'
      || own(sidecar, 'isAsync') && sidecar.isAsync !== true);
    if (typedLaunch && typedOther) { call.conflict = true; return; }
    if (!typedLaunch && !typedOther) { call.mode = 'unknown'; return; }
    if (!typedLaunch) {
      call.mode = 'sync';
      call.receipt = at;
      return;
    }
    call.mode = 'launch';
    const agentId = res.isError === true ? null : recordedAgentId(res.visibleText ?? res.text);
    if (agentId === null || (sidecar !== null && own(sidecar, 'agentId') && sidecar.agentId !== agentId)) {
      call.conflict = true;
      return;
    }
    call.launched = true;
    call.agentId = agentId;
    // D99 (F1 guard): the launch's own row, where the verbatim search for its agentId starts (background-ends.js).
    call.launchRow = { source: at.source, record: at.record, version: d?.version };
    notificationLaunches.set(key, { kind: 'agent', taskId: agentId, statuses: new Set(), conflict: false, agent: call, at });
  };
  const rowAt = (rec, recordIndex) => ({ turn, beforeEvent: events.length, source: rec.source ?? 0,
    record: rec.line ?? recordIndex + 1 });
  /** C-01 event identity: the content block of a row's first human-labelled part (0 for a row labelled whole). */
  const humanBlock = (rec) => humanPart(rec)?.[0]?.block ?? 0;
  /** OWNER DECISION B: the answers read from a call's result, withdrawn — the call's answer is unresolved again. */
  const withdrawAnswers = (key, index) => {
    if (!answered.has(key)) return;
    const { entries } = answered.get(key);
    answered.delete(key);
    for (let at = interjections.length - 1; at >= 0; at--) if (entries.includes(interjections[at])) interjections.splice(at, 1);
    if (events[index]) events[index].humanAnswerUnresolved = true;
  };
  const retractResult = (key) => {
    notificationLaunches.delete(key);
    // M33 W: a retracted call has no single recorded launch sidecar either.
    for (const index of [settled.get(key)?.index, pending.get(key)])
      if (workflowCalls.has(index)) workflowCalls.get(index).retracted = true;
    const previous = settled.get(key);
    if (previous) {
      const event = events[previous.index];
      for (const field of Object.keys(event)) delete event[field];
      Object.assign(event, previous.before);
      withdrawAnswers(key, previous.index);
      // Preserve the action, but never use either conflicting terminal outcome.
      awaitingObservation.set(previous.index, previous.adapter);
      settled.delete(key);
    }
    pending.delete(key);
    ambiguousIds.add(key);
  };
  let unsupportedActions = 0;
  let knownCodeEffectDemoted = 0;
  let orphanResults = 0;
  // Index -> source adapter. A call with no result row is a missing observation, even when
  // its input was captured and the action can still be reviewed. Shell-write siblings are
  // not added: they are effects of their parent command, not separate tool invocations.
  const awaitingObservation = new Map();

  // M34 labels review (F2): each recorded uuid read so far, so a copied row leaves no second positional mark.
  const markedUuids = new Set();
  for (const [recordIndex, rec] of records.entries()) {
    const d = rec.raw;
    // D142: a row of Sonah's own turn is never read (records.js `claudeLabeller`), whoever built the record.
    if (rec.basis === LABEL_BASIS.sonahTurn) continue;

    // M34 labels review (F2): a label carrying a positioned gap (`POSITIONED_GAPS`) marks its row, before the row is
    // read — a row that opens a turn is placed before that turn's instruction, so the loss reaches it.
    const uuid = plain(d) && string(d.uuid) && d.uuid ? d.uuid : null;
    const copy = uuid !== null && markedUuids.has(uuid);
    if (!copy) {
      if (uuid !== null) markedUuids.add(uuid);
      for (const part of partsOf(rec)) {
        if (!POSITIONED_GAPS.includes(part.gap)) continue;
        const { turn: at, beforeEvent, source: stream, record } = rowAt(rec, recordIndex);
        marks.push({ turn: at, kind: LABEL_GAP_MARK, gap: part.gap, beforeEvent, stream, record });
      }
    }

    // C-01 event identity: a mark that becomes an event is named by its own row (event-identity.js).
    if (rec.kind === 'compaction') {
      marks.push({ turn, kind: 'compaction', identity: rowIdentity(rec, recordIndex, null, IDENTITY_SUBS.compaction),
        ...compactedOf(rec) });
      continue;
    }
    // C-02 M33 (4): an adapter's typed interrupt row (Codex `turn_aborted`) carries no text and
    // no result. Its mark names its closed source and the row's position: the stream, the
    // one-based record and, as commentary does, the actions recorded before it (`beforeEvent`).
    // M34 labels: only a typed interrupt is marked; the untyped interrupt mark (a Claude notice, read by its words) is
    // deleted — Claude Code's notice is harness, its session declares interruptions untyped (`interrupt_untyped`).
    if (rec.kind === 'interrupt') {
      if (TYPED_MARK_SOURCES.has(rec.markSource))
        marks.push({ turn, kind: 'interrupt', source: rec.markSource, stream: rec.source ?? 0,
          record: rec.line ?? recordIndex + 1, beforeEvent: events.length,
          identity: rowIdentity(rec, recordIndex, null, IDENTITY_SUBS.interrupt) });
      continue;
    }

    // M33 P: an encrypted arrival a helper received, and a helper's FINAL_ANSWER this recording received: where each
    // row was read (its turn, the actions recorded before it, its row), for the delivery and receipt joins only.
    if (rec.kind === AGENT_ARRIVAL_RECORD) {
      if (rec.adapter === 'codex' && plain(d) && string(d.token) && d.token && string(d.recipient))
        arrivals.push({ ...rowAt(rec, recordIndex), recipient: d.recipient, token: d.token });
      continue;
    }
    if (rec.kind === AGENT_REPORT_RECORD) {
      if (rec.adapter === 'codex' && plain(d))
        reports.push({ ...rowAt(rec, recordIndex), sender: string(d.sender) ? d.sender : null,
          recipient: string(d.recipient) ? d.recipient : null });
      continue;
    }

    // OWNER DECISION B: a prompt the human queued while the agent worked; M34 labels: and a file or directory the human
    // attached (an @-mention). Each is read where its row is labelled `human` (records.js `claudeLabeller`), as the
    // human's instruction at its row, kept whole with the cuts due on it declared, exactly as an ask is (redaction makes
    // them; an attachment is bounded like an observation, `ATTACHED_CAP`). An attachment that records no text (a PDF) is
    // not read, and keeps its declared loss. D150: whether one is read is the one predicate the reader counts it by
    // (records.js `interjectionWordsOf`).
    if (rec.kind === QUEUED_PROMPT_RECORD || rec.kind === ATTACHED_RECORD) {
      const words = interjectionWordsOf(rec);
      if (words) {
        const attachedFile = rec.kind === ATTACHED_RECORD;
        const { text: kept, elided } = compressAsk(words, attachedFile ? ATTACHED_CAP : null);
        const { turn: at, ...row } = rowAt(rec, recordIndex);
        interjections.push({ turn: at, kind: attachedFile ? INTERJECTION_KINDS.attached : INTERJECTION_KINDS.queued,
          ...row, text: kept, ...(elided.length ? { elided } : {}), identity: rowIdentity(rec, recordIndex, humanBlock(rec)) });
      }
      continue;
    }

    // D71 (g): a typed attachment giving the agent instruction files: each of the project's own files, whole (redaction
    // validates it before slice_hash), at its row. Its block is its index in the attachment's file list.
    if (rec.kind === PROJECT_INSTRUCTIONS_RECORD) {
      const item = plain(d) ? d.attachment : null;
      const files = item?.type === 'instructions' ? (Array.isArray(item.files) ? item.files : [])
        : item?.type === 'nested_memory' && plain(item.content) ? [item.content] : [];
      files.forEach((file, block) => {
        if (!plain(file) || !PROJECT_INSTRUCTION_TYPES.includes(file.type) || !string(file.path) || !file.path
            || !string(file.content) || !file.content.trim()) return;
        // Spelled as every path of the slice is: repo-relative under the recorder's working directory (`relative`).
        projectInstructions.push({ ...rowAt(rec, recordIndex), path: relative(file.path, cwd), text: file.content,
          identity: rowIdentity(rec, recordIndex, block) });
      });
      continue;
    }

    // D150: a file changed outside the agent's edit calls (an `edited_text_file` attachment labelled an observation, never
    // the agent's): its file, spelled as every path of the slice is, and the snippet the harness recorded, at its row. One
    // that records no file name or no snippet as a string is not read.
    if (rec.kind === EDITED_FILE_RECORD) {
      const item = plain(d) ? d.attachment : null;
      if (plain(item) && string(item.filename) && item.filename && string(item.snippet))
        editedFiles.push({ ...rowAt(rec, recordIndex), path: relative(item.filename, cwd), text: item.snippet,
          identity: rowIdentity(rec, recordIndex, 0) });
      continue;
    }

    // C-02 M33 D: a queued task-notification attachment carries only a launch's typed status.
    if (rec.kind === 'notification') {
      if (rec.adapter === 'claude' || rec.adapter == null) joinNotification(d, rowAt(rec, recordIndex), rec, copy);
      continue;
    }

    if (rec.kind === 'user') {
      const userBlocks = d?.message?.content;
      let unreadBlock = false;
      if (Array.isArray(userBlocks)) {
        instructionCapture.nonTextExcluded += userBlocks.filter((block) =>
          NONTEXT_BLOCK_TYPES.includes(block?.type)).length;
        unreadBlock = userBlocks.some((block) => !(
          block?.type === 'tool_result'
          || block?.type === 'text' && typeof block.text === 'string'
          || NONTEXT_BLOCK_TYPES.includes(block?.type)));
      } else if (userBlocks != null && typeof userBlocks !== 'string') {
        // An object or scalar content schema may hold a request or result. No channel can be
        // proven from it; never let a mixed, otherwise readable session certify completeness.
        unreadBlock = true;
      }
      if (unreadBlock) {
        instructionCapture.unclassifiedRows++;
        if (!((rec.adapter === 'claude' || rec.adapter == null) && claudeDriftedTurn(d))) instructionCapture.unreadRows++;
      }
      // Results first: a user record is usually the carrier for the previous turn's tool results.
      const results = toolResults(d);
      // A native sidecar beside several result blocks has no tool_use_id. records.js therefore
      // cannot attach it to any one block. If it reports an async Workflow launch, keep the
      // visible per-tool results but declare the Workflow's later work unresolved; otherwise a
      // multi-tool row can look complete solely because its sidecar was discarded.
      const unattributedAsyncWorkflow = (rec.adapter === 'claude' || rec.adapter == null) && results.size > 1
        && plain(d?.toolUseResult) && d.toolUseResult.status === 'async_launched';
      // M34 labels: each result block's label (records.js `claudeLabeller`, codex.js `labelCodexRecords`), by its call
      // id — a block's own, or the whole record's where it carries one label for all its blocks.
      const resultLabels = new Map();
      if (Array.isArray(userBlocks))
        for (const part of partsOf(rec)) {
          const blocks = part.block === null ? userBlocks : [userBlocks[part.block]];
          for (const block of blocks)
            if (block?.type === 'tool_result') resultLabels.set(resultKey(block.tool_use_id), part);
        }
      for (const [id, sourceResult] of results) {
        const key = resultKey(id);
        // M33 U repair, L1: a Claude call the human refused may carry the human's answer, whatever its words: declared
        // at the call's action — or, where no ledger action carries the call, counted unplaced. Never read as an
        // instruction. Not in a session no human submitted (OWNER DECISION 2026-10-06): no one was there to answer.
        // M34 labels review (F3): the refusal is labelled the human's (`human` + `refusal`, linked to the refused call),
        // but its result's text is not: Claude Code records no separate field for the human's feedback, and writes its
        // own rejection words into every refusal's result (the text is harness), so reading that text
        // would put the recorder's words under the human's authority. It keeps L1's declarations below.
        const humanWords = (rec.adapter === 'claude' || rec.adapter == null) && !headless
          && refusedByHuman(resultLabels.get(key));
        const wordsAt = humanWords ? pending.get(key) ?? settled.get(key)?.index : undefined;
        // M34 labels review (F4): a Codex result labelled the human's answer (a synchronous `request_user_input`
        // output) is not read — the recorder types no answer field in it — so its call's answer is declared unread.
        if (rec.adapter === 'codex' && (resultLabels.get(key)?.markers ?? []).includes(MARKERS.answer)) {
          const at = pending.get(key) ?? settled.get(key)?.index;
          if (at !== undefined) unreadAnswers.add(at);
          else unplacedWords.add(key);
        }
        // L1 session-type review: in a session whose type was not recorded, declared under its own counted reason.
        if (humanWords && typeUnrecorded && wordsAt !== undefined) unrecordedTypeRefusals.add(wordsAt);
        else if (humanWords && typeUnrecorded) unrecordedTypeUnplaced.add(key);
        else if (humanWords && wordsAt !== undefined) rejectedWithWords.add(wordsAt);
        else if (humanWords) unplacedWords.add(key);
        // L1 review: on a recorder that types no refusal, any error may be one (whatever the session type).
        if ((rec.adapter === 'claude' || rec.adapter == null) && sourceResult?.isError === true
          && untypedDenialRecorder(d)) {
          const at = pending.get(key) ?? settled.get(key)?.index;
          if (at !== undefined) untypedRefusals.add(at);
          else untypedUnplaced.add(key);
        }
        // M33 P: an Agent/Task hand-off's own result — its launch, or (M33 P repair) where the parent received a
        // synchronous agent's result (it is no event: a hand-off is a delegation). M33 P second repair: which, the
        // result records.
        const handOff = handOffCalls.get(key);
        if (handOff && !pending.has(key) && !settled.has(key)) {
          handOffResult(handOff, key, sourceResult, d, results.size, rowAt(rec, recordIndex));
          continue;
        }
        const expected = pending.get(key) ?? settled.get(key)?.index;
        let res = expected !== undefined && !events[expected]?.genericTool
          && events[expected]?.tool === 'ToolSearch'
          ? toolSearchResultOf(d, id, sourceResult) : sourceResult;
        if (expected !== undefined && events[expected]?.genericTool
          && own(d, 'codexVisibleOutput')) {
          const visible = visibleToolContent(d.codexVisibleOutput);
          res = { ...sourceResult, text: visible.text, visibleText: visible.text,
            visibleSpans: visible.spans, nonText: visible.nonText,
            visibleNonText: visible.nonText, isError: false, exitCode: null, raw: undefined };
        }
        if (ambiguousIds.has(key)) continue;
        const previous = settled.get(key);
        if (previous) {
          if ((events[previous.index]?.genericTool
            ? res.visibleAmbiguous === true : res.ambiguous === true)
            || previous.fingerprint !== resultFingerprint(res, d, id,
              events[previous.index]?.genericTool === true))
            retractResult(key);
          else if (answered.has(key) && JSON.stringify(res.raw ?? null) !== answered.get(key).sidecar)
            // OWNER DECISION B: an identical result recording another answer sidecar: which answer, is not recorded.
            withdrawAnswers(key, previous.index);
          else if (workflowCalls.has(previous.index) && (events[previous.index]?.tool === 'Workflow')) {
            // M33 W: an identical repeat may still carry another launch sidecar; every one is compared.
            workflowCalls.get(previous.index).results.push({ raw: results.size === 1 ? res.raw : undefined,
              sessionId: d?.sessionId, uuid: d?.uuid });
            if (!events[previous.index]?.genericTool) events[previous.index].workflowResultRepeated = true;
          } else if (!events[previous.index]?.genericTool
            && (events[previous.index]?.tool === 'TaskOutput'
              || events[previous.index]?.tool === 'Workflow')) {
            // The repeated row might carry a different opaque native ID despite identical
            // visible text/status. Do not use either as unique completion proof downstream.
            if (events[previous.index].tool === 'TaskOutput')
              events[previous.index].taskOutputResultRepeated = true;
            else events[previous.index].workflowResultRepeated = true;
          }
          continue;
        }
        const idx = pending.get(key);
        if (idx === undefined) {
          // A result for an action that never appeared is an action-inventory gap.
          // A duplicate result or a result for a deliberately excluded tool is a
          // separate case; neither proves a second missing invocation.
          if (d.syntheticMissingToolResults !== true && !knownCallIds.has(key)) orphanResults++;
          continue;
        }
        if (events[idx].genericTool ? res.visibleAmbiguous === true
          : res.ambiguous === true || outcomes?.get(id)?.ambiguous === true) {
          // The result record contradicts itself. Leave the invocation's O unresolved so the
          // existing observation-gap path carries this loss to the review status. A conflicting
          // PostToolUse sidecar for the same call is equally unable to certify one exit result.
          pending.delete(key);
          ambiguousIds.add(key);
          continue;
        }
        // Cursor's output-omitting mode appends an empty compatibility result so shell
        // outcomes stay explicitly unknown. It is not a recorded environment response.
        if (d.syntheticMissingToolResults === true) {
          if (events[idx].kind === 'bash' || events[idx].kind === 'test') events[idx].outcome = 'unknown';
          continue;
        }
        // Exit-code precedence: transcript-native (Codex) > capture-time recorded (the PostToolUse
        // hook, packages/cli/src/outcomes.js) > pattern matching over output. A real code beats
        // inference; an inference beats nothing.
        //
        // `interrupted` travels the same road and was never joined at all (M90): the hook records
        // `tool_response.interrupted` next to the exit code, and a command that was cut short is
        // not a command that passed, however complete its partial output happens to read.
        const before = { ...events[idx] };
        const nativeExitCode = d.exitCode ?? res.exitCode ?? null;
        const hookExitCode = outcomes?.get(id)?.exitCode ?? null;
        // C-02 M33 D: Claude-only typed evidence. A command's sidecar verdict or background id, an
        // Edit sidecar's exact repeat of its call, and a Workflow launched outside the typed schema.
        const claudeRecord = rec.adapter === 'claude' || rec.adapter == null;
        const command = !events[idx].genericTool && ['bash', 'test'].includes(events[idx].kind);
        const sidecar = claudeRecord && command ? claudeBashSidecar(res) : null;
        const editInput = claudeRecord ? claudeEditInputs.get(key) : undefined;
        attachResult(events[idx], { ...res,
          fileChangeSuccess: rec.adapter === 'codex' && d.codexFileChangeSuccess === true,
          commandStatusConflict: rec.adapter === 'codex' && d.codexCommandExecutionConflict === true,
          // C-02 M33 native-first: a failed native command item whose negative exit is a sentinel.
          nativeCommandFailed: rec.adapter === 'codex' && d.codexNativeCommandFailed === true,
          exitCode: nativeExitCode ?? hookExitCode,
          exitCodeSource: Number.isFinite(nativeExitCode) ? 'native'
            : Number.isFinite(hookExitCode) ? 'hook' : null,
          interrupted: res.raw?.interrupted === true || outcomes?.get(id)?.interrupted === true,
          claudeVerdict: sidecar?.kind === 'succeeded',
          claudeBackground: sidecar?.kind === 'background',
          claudeEditSucceeded: editInput !== undefined && events[idx].kind === 'edit'
            && claudeEditSidecarProves(res.raw, editInput),
          claudeWorkflow: claudeRecord && events[idx].genericTool === true && events[idx].tool === 'Workflow',
          // M36 phase 3 review (D68 F): the row's typed denial kind, only where the row holds this one result.
          toolDenialKind: claudeRecord && results.size === 1 ? d.toolDenialKind : undefined,
          claudeRecord, cwd, place });
        // OWNER DECISION B: the human's answers to a Claude AskUserQuestion, read from its typed sidecar, each a human
        // instruction at this result's row (the answer text only). Anything else keeps the call's answer unresolved.
        if (claudeRecord && !events[idx].genericTool && events[idx].tool === 'AskUserQuestion'
          && events[idx].humanAnswerUnresolved === true && res.isError !== true
          && (resultLabels.get(key)?.markers ?? []).includes(MARKERS.answer)) {
          const answers = askUserAnswers(res.raw, askQuestions.get(key), res.visibleText);
          if (answers !== null) {
            const { turn: at, ...row } = rowAt(rec, recordIndex);
            // C-01 event identity: each answer is the k-th answer of this result block.
            const block = Array.isArray(userBlocks)
              ? Math.max(0, userBlocks.findIndex((b) => b?.type === 'tool_result' && b.tool_use_id === id)) : 0;
            const entries = answers.map((answer, k) => {
              const { text: kept, elided } = compressAsk(answer);
              return { turn: at, kind: INTERJECTION_KINDS.answer, ...row, text: kept, ...(elided.length ? { elided } : {}),
                call: { turn: events[idx].turn, seq: events[idx].seq },
                identity: derivedIdentity(rowIdentity(rec, recordIndex, block), IDENTITY_SUBS.answer(k)) };
            });
            interjections.push(...entries);
            answered.set(key, { entries, sidecar: JSON.stringify(res.raw ?? null) });
            delete events[idx].humanAnswerUnresolved;
          }
        }
        // M33 P: a Claude action's row locator (asked for only by the loader) gains its result's row.
        if (events[idx].claudeLocator)
          events[idx].claudeLocator = { ...events[idx].claudeLocator, resultRecord: rec.line ?? recordIndex + 1 };
        // M33 P (W2 minor P4): a typed TaskOutput completion is where the parent received the task's completion.
        if (claudeRecord && events[idx].tool === 'TaskOutput' && events[idx].taskOutputCompleted === true
          && events[idx].taskOutputTaskId === events[idx].taskOutputResultTaskId)
          taskOutputReceipts.push({ index: idx, taskId: events[idx].taskOutputTaskId, at: rowAt(rec, recordIndex) });
        if (unattributedAsyncWorkflow && !events[idx].genericTool
          && events[idx].tool === 'Workflow')
          events[idx].workflowAsyncUnresolved = true;
        // M33 W: the call's own result row, with its sidecar only when it is that row's single result block.
        if (workflowCalls.has(idx))
          workflowCalls.get(idx).results.push({ raw: results.size === 1 ? res.raw : undefined, sessionId: d?.sessionId,
            uuid: d?.uuid });
        // A launch whose own result is typed and unambiguous may be closed by a later notification.
        const launched = events[idx];
        const namesId = sidecar?.kind === 'background' && resultNamesTypedId(res.visibleText, sidecar.taskId);
        // D99 (F1 guard): where a Claude command's own result is (its background run's verbatim search starts there), and
        // why a background task id it records registered no launch (the recorder census, labels.js).
        if (claudeRecord && command) {
          resultRows.set(idx, { source: rec.source ?? 0, record: rec.line ?? recordIndex + 1, version: d?.version });
          const recordsId = plain(res.raw) && own(res.raw, 'backgroundTaskId') && res.isErrorFalse === true
            && res.isError !== true;
          if (recordsId && sidecar?.kind !== 'background') {
            // Each key the reader does not know is logged by its name; a sidecar of known keys only had a type it does not
            // know, and is counted once with no name.
            const unknown = Object.keys(res.raw).filter((k) => ![...BASH_SIDECAR_REQUIRED, ...BASH_SIDECAR_OPTIONAL,
              ...BASH_SIDECAR_BACKGROUND].includes(k));
            for (const key of unknown.length ? unknown : [null])
              launchMisses.push({ reason: RECORDER_CENSUS_REASONS.sidecarUnknownKeys, version: d?.version, key });
          }
          else if (sidecar?.kind === 'background' && !namesId)
            launchMisses.push({ reason: RECORDER_CENSUS_REASONS.launchTextLacksId, version: d?.version });
        }
        // D98 (F1): by its typed sidecar id, which its visible result names; no harness sentence decides it.
        if (namesId
          && launched.interrupted !== true && launched.conflict !== true && launched.outcomeUnknown !== true)
          notificationLaunches.set(key, { index: idx, taskId: sidecar.taskId, kind: 'bash',
            statuses: new Set(), conflict: false });
        else if (claudeRecord && launched.tool === 'Workflow' && launched.workflowAsyncUnresolved === true
          && taskId(launched.workflowTaskId) && !unattributedAsyncWorkflow)
          notificationLaunches.set(key, { index: idx, taskId: launched.workflowTaskId, kind: 'workflow',
            statuses: new Set(), conflict: false, at: rowAt(rec, recordIndex), version: d?.version });
        // D175 (beta.9 known issue 3): a Claude SendMessage that RESUMED a launched helper — its one result, no error,
        // whose single-block typed sidecar records `success: true` and the helper's `resumedAgentId` (and
        // `revivedAgentId` only as the same id). A later typed notification naming this call's id and that agentId is
        // where the parent received the resumed work (the C-02 M33 D join, as for a launch). Side channel only. The one
        // block is the sidecar's own rule (records.js `toolResultsOf` gives a row of several results none); an interrupted
        // or outcome-unknown result resumes nothing (a command's outcome conflict is never set on a SendMessage).
        else if (claudeRecord && launched.tool === 'SendMessage' && sendCalls.has(key)
          && res.isError !== true && plain(res.raw) && res.raw.success === true
          && taskId(res.raw.resumedAgentId)
          && (!own(res.raw, 'revivedAgentId') || res.raw.revivedAgentId === res.raw.resumedAgentId)
          && launched.interrupted !== true && launched.outcomeUnknown !== true)
          notificationLaunches.set(key, { index: idx, taskId: res.raw.resumedAgentId, kind: 'resume',
            statuses: new Set(), conflict: false, send: sendCalls.get(key) });
        settled.set(key, { index: idx, before, adapter: rec.adapter ?? 'claude',
          fingerprint: resultFingerprint(res, d, id, events[idx].genericTool === true) });
        pending.delete(key);
        if (events[idx].conflict === true) awaitingObservation.set(idx, rec.adapter ?? 'claude');
        else awaitingObservation.delete(idx);
      }

      // C-02 M33 D: a typed task notification joins only the launch whose call ID it names, and
      // only while its task ID is that launch's own native ID. Status only: its text is not read.
      if (rec.adapter === 'claude' || rec.adapter == null) joinNotification(d, rowAt(rec, recordIndex), rec, copy);

      // M34 labels (C-02 "Slice-time labels"): the slicer labelled the row once (records.js `claudeLabeller`, codex.js
      // `labelCodexRecords`, cursor.js); nothing here re-decides it. A row labelled `human` (not an answer or a refusal)
      // opens a turn (`opensTurn`); its words are the human-labelled blocks, kept whole (`humanWordsOf`).
      if (opensTurn(rec)) {
        turn++;
        seq = 0;
        const words = humanWordsOf(rec);
        if (!words.trim()) continue;
        // M33 R repair: the turn whole, with the cuts due on it declared; redaction makes them (and names what they
        // cut) over the turn whole. M33 W: a Workflow agent's brief (its recording's first user row)
        // takes this same path, as every helper's ask does.
        const { text: t2, elided } = compressAsk(words);
        const entry = { turn, text: t2 };
        if (elided.length) entry.elided = elided;
        // C-01 event identity: the instruction is its row's first human-labelled block.
        entry.identity = rowIdentity(rec, recordIndex, humanBlock(rec));
        // M34 labels: the markers the human row carries (`command`, `queued`, `after_interrupt`), and for an
        // `after_interrupt` the typed interrupt row it follows.
        const markers = [...new Set(humanPart(rec).flatMap((part) => part.markers ?? []))];
        if (markers.length) entry.markers = markers;
        const interrupted = humanPart(rec).find((part) => Number.isSafeInteger(part.links?.interrupted))?.links.interrupted;
        if (interrupted !== undefined) entry.interrupted = { stream: rec.source ?? 0, record: interrupted };
        // Gain I (2026-10-13): the nontext blocks the human's message carried beside its words (an image they pasted),
        // each by its block and type, an image recorded whole with its media type and data (`humanNonTextOf`). They
        // stay counted in `instructionsNonText` (above) as before; the evidence adapter locates their loss at this
        // instruction, and a reviewer request that carries them clears it there. A message with no words opens no
        // ask, so its blocks stay counted only (a loss at every bound, as before).
        const nonText = humanNonTextOf(rec);
        if (nonText.length) entry.nonText = nonText;
        ask.push(entry);
      } else if (rec.label === LABELS.peer) {
        // M34 labels: another agent's message (a teammate, a coordinator), whole, at its row.
        const words = text(d);
        if (words.trim()) {
          const { text: kept, elided } = compressAsk(words);
          const { turn: at, ...row } = rowAt(rec, recordIndex);
          interjections.push({ turn: at, kind: INTERJECTION_KINDS.peer, ...row, text: kept, ...(elided.length ? { elided } : {}),
            identity: rowIdentity(rec, recordIndex) });
        }
      }
      continue;
    }

    if (rec.kind !== 'assistant') continue;

    if (['analysis', 'reasoning'].includes(d.channel ?? d.message?.channel)) {
      commentaryCapture.privateExcluded++; continue;
    }
    const channel = d.channel ?? d.message?.channel;
    if (channel != null && !['commentary','final'].includes(channel)) {
      commentaryCapture.unsupported++; continue;
    }
    if (d.commentaryUnchecked) { commentaryCapture.unsupported++; continue; }

    const t = text(d).trim();
    // C-01 event identity: a turn's closing statement is its last assistant row's (`final`).
    if (t) { lastAssistantText = t; sayings.set(turn, { text: t, identity: rowIdentity(rec, recordIndex, null, IDENTITY_SUBS.final) }); }

    const content = d.message?.content;
    const blocks = typeof content === 'string' ? [{ type: 'text', text: content }] : content;
    if (!Array.isArray(blocks)) { commentaryCapture.unsupported++; continue; }
    for (const [block, use] of blocks.entries()) {
      if (use?.type === 'text' && typeof use.text === 'string') {
        commentary.push({ turn, source: rec.source ?? 0, record: rec.line ?? recordIndex + 1,
          block, beforeEvent: events.length, text: use.text, identity: rowIdentity(rec, recordIndex, block) });
        commentaryCapture.blocks++; commentaryCapture.bytes += Buffer.byteLength(use.text);
        continue;
      }
      if (['thinking', 'redacted_thinking', 'reasoning'].includes(use?.type)) {
        commentaryCapture.privateExcluded++; continue;
      }
      if (['image','document','audio'].includes(use?.type)) { commentaryCapture.nonTextExcluded++; continue; }
      if (use?.type === 'tool_use' && use.id != null) knownCallIds.add(resultKey(use.id));
      if (use?.type !== 'tool_use') { commentaryCapture.unsupported++; continue; }
      if (typeof use.name !== 'string') { commentaryCapture.unsupported++; unsupportedActions++; continue; }
      const canonical = own(ALIASES, use.name) ? ALIASES[use.name] : use.name;
      const spec = coreSpec(canonical, use.input, cwd, use.sourceName ?? use.name)
        ?? (rec.adapter === 'claude' || rec.adapter == null ? claudeOtherSpec(use.name, use.input) : null)
        ?? mcpSpec(use.name, use.input)
        ?? (!isDelegationTool(use.name, rec.adapter ?? 'claude') && genericToolName(use.name)
          ? { kind: 'other', generic: true } : null);
      if (!spec) {
        if (isDelegationTool(use.name, rec.adapter ?? 'claude')) {
          noteHandOff(rec, recordIndex, use);
        } else unsupportedActions++;
        continue;
      }
      // M33 P: a Claude action's own row (its tool_use row, its block, and later its result row), as a Codex
      // action's is recorded — only when the loader asks, so every other ledger keeps its bytes.
      const claudeRow = claudeLocators && (rec.adapter === 'claude' || rec.adapter == null)
        ? { stream: rec.source ?? 0, record: rec.line ?? recordIndex + 1, part: block } : null;
      const ev = makeEvent(use, spec, { turn, seq: seq++, cwd, source: rec.source,
        adapter: rec.adapter, claudeRow });
      if (!ev) { unsupportedActions++; continue; }
      // C-01 event identity: the call the recorder wrote (its row and block; a Codex call's own call_id and part).
      ev.identity = callIdentity(rec, recordIndex, use, block);
      // D68 (C-02 "M36 recorded facts"): what the recorder typed about the call itself, set once here.
      callFacts(ev, use, rec.adapter ?? 'claude');
      if (spec.generic && KNOWN_CODE_EFFECT.has(use.sourceName ?? use.name))
        knownCodeEffectDemoted++;
      events.push(ev);
      const index = events.length - 1;
      awaitingObservation.set(index, rec.adapter ?? 'claude');
      // M33 U repair: a Claude question's answer is unresolved from the call until it is read — a result never recorded
      // or never attached included, and a call outside the known input schema (a generic tool) too. `attachResult`
      // keeps it where the answer can be (a result that is no error) at the place 269cf6d wrote it.
      if ((rec.adapter === 'claude' || rec.adapter == null) && ev.tool === 'AskUserQuestion') ev.humanAnswerUnresolved = true;
      // M33 P: a Codex send_message to an existing helper, its payload one encrypted token: a delivery to join.
      if (rec.adapter === 'codex' && spec.generic && CODEX_SEND_NAMES.includes(use.sourceName ?? use.name)
        && plain(use.input) && isEncryptedBrief(use.input.message))
        sends.push({ kind: 'action', turn, seq: ev.seq, source: rec.source ?? 0, record: rec.line ?? recordIndex + 1,
          token: use.input.message });
      // M33 W repair 2: also the call's own row uuid (a copied call is proven by it) and whether its recorded input
      // names a run it resumes (absent: undefined; a string; anything else: null, present but unusable).
      if ((rec.adapter === 'claude' || rec.adapter == null) && ev.tool === 'Workflow' && use.id != null)
        workflowCalls.set(index, { callId: use.id, record: rec.line ?? recordIndex + 1, source: rec.source ?? 0,
          sessionId: d?.sessionId, uuid: d?.uuid, results: [], retracted: false,
          resumeFromRunId: plain(use.input) && own(use.input, 'resumeFromRunId')
            ? (string(use.input.resumeFromRunId) ? use.input.resumeFromRunId : null) : undefined });
      if (use.id) {
        const key = resultKey(use.id);
        // M33 P: an action reusing a background Agent's call id leaves that launch unproven.
        if (handOffCalls.has(key)) { handOffCalls.get(key).conflict = true; notificationLaunches.delete(key); }
        if (pending.has(key) || settled.has(key)) retractResult(key);
        if (!ambiguousIds.has(key)) pending.set(key, index);
        if ((rec.adapter === 'claude' || rec.adapter == null) && use.name === 'Edit' && !spec.generic)
          claudeEditInputs.set(key, use.input);
        else claudeEditInputs.delete(key);
        // D175: a Claude SendMessage, for the resume its one typed result may record — whether or not its input is of
        // the known typed shape (Claude Code records `recipient_kind` beside it in later versions, a generic action):
        // the resume is the result's typed identity. The message is kept in memory only, in the delivery side channel
        // the loader asks for and drops (as a Codex token is).
        if ((rec.adapter === 'claude' || rec.adapter == null) && ev.tool === 'SendMessage')
          sendCalls.set(key, { callId: use.id, source: rec.source ?? 0, record: rec.line ?? recordIndex + 1,
            message: plain(use.input) && string(use.input.message) ? use.input.message : null });
        else sendCalls.delete(key);
        // OWNER DECISION B: the question texts the call recorded, which its answer sidecar must repeat exactly, and
        // (release fix 3c) whether each lets the human choose several options.
        if ((rec.adapter === 'claude' || rec.adapter == null) && use.name === 'AskUserQuestion' && !spec.generic)
          askQuestions.set(key, use.input.questions.map((question) => ({ text: question.question,
            multiSelect: question.multiSelect === true })));
        else askQuestions.delete(key);
      }

      // A shell write is a real edit the tool stream never reports. Emit it as a sibling event so
      // the review sees it, but keep `via` so downstream can weight it lower than a
      // structured Edit — a shell write is weaker evidence of intent.
      //
      // W3c-11: for EVERY recorded command, whatever its class. `npm test 2>&1 | tee out.txt` is
      // a test and stays one; it also wrote out.txt, and a class is not a reason to stop looking.
      //
      // A `cat > path <<DELIM` carries its whole body in the recorded command, so that body is
      // recorded as the write's `after`, taken from the command as recorded (`heredocBodies`). Only when the heredoc is the path's one write in this
      // command: a later `sed -i` of the same file would make the body a state the file left.
      if (typeof ev.cmd === 'string' && !spec.distinctWorkdir) {
        const writes = shellWrites(ev.cmd, cwd);
        const statusEligible = shellWriteStatusEligible(ev.cmd, cwd, writes);
        const bodies = writes.some((w) => w.heredoc) ? heredocBodies(ev.cmd) : null;
        for (const [k, w] of writes.entries()) {
          // C-01 event identity: the command's k-th shell write, a sub-event of its call.
          const sibling = { turn, seq: seq++, kind: 'edit', path: w.path, via: w.how,
                            ...(w.abs ? { _abs: w.abs } : {}),
                            ...(statusEligible ? { shellWriteStatusEligible: true } : {}),
                            identity: derivedIdentity(ev.identity, IDENTITY_SUBS.shellWrite(k)) };
          const doc = w.heredoc ? bodies.get(w.heredoc.index) : null;
          if (doc && doc.word === w.heredoc.word && doc.append === w.heredoc.append && doc.delim === w.heredoc.delim) {
            sibling._body = doc.body;
            sibling._heredoc = { append: doc.append, expanded: doc.expanded };
          }
          // D68 (c1): a write the slicer read from a command's own text: the recorder kept no patch of it and no
          // prior state (only a heredoc's body, when the command carried one), declared as such.
          sibling.recorded = { tool: ev.recorded.tool, prior: 'unrecorded',
            patch: typeof sibling._body === 'string' ? 'body' : 'none' };
          events.push(sibling);
        }
      }
    }
  }

  // M33 P (W2 minor P4): the earliest typed TaskOutput completion of task `id` the record still holds — its result
  // neither retracted (the event would no longer record the completion), repeated nor conflicting — recorded after the
  // launch's own result row `after` (M33 P repair: a poll before the launch named no task yet), or null.
  const earlier = (a, b) => a.source < b.source || a.source === b.source && a.record < b.record;
  const taskOutputReceipt = (id, after) => taskOutputReceipts.filter(({ index, taskId: polled, at }) => polled === id
    && events[index].taskOutputCompleted === true && events[index].taskOutputTaskId === id
    && events[index].taskOutputResultRepeated !== true && events[index].conflict !== true
    && (!after || earlier(after, at)))
    .map(({ at }) => at).sort((a, b) => a.source - b.source || a.record - b.record)[0] ?? null;
  // C-02 M33 D: a launch closes on exactly one agreeing notification status. Disagreeing statuses,
  // a foreign task ID, a repeated launch result or an already unprovable launch close nothing. A
  // Workflow records the status only: the result text its notification carries is not read, so the
  // ledger still declares that loss. A stopped command never proved what it finished.
  for (const launch of notificationLaunches.values()) {
    // M33 P: a background Agent's receipt — the earliest row of a join that settled a final state. Side channel only.
    // M33 P repair (W2 minor P4, as for a Workflow): or a typed TaskOutput completion of its own agentId recorded after
    // its launch, when no notification status joined it or it was recorded before the settling notification; the
    // EARLIEST recorded completed receipt wins. A stopped, conflicting or doubled status receives nothing.
    // D175: a resume is received by exactly one agreeing final status of the notifications naming its call and its
    // agentId (never by a TaskOutput poll: a poll of that agentId does not say which of its turns it answers). Every
    // registered resume is kept, a receipt only where one settled. Side channel only (`deliveries.resumes`).
    if (launch.kind === 'resume') {
      const [status] = launch.statuses;
      const ev = events[launch.index];
      resumes.push({ callId: launch.send.callId, agentId: launch.taskId, turn: ev.turn, seq: ev.seq,
        source: launch.send.source, record: launch.send.record, message: launch.send.message,
        ...(!launch.conflict && launch.statuses.size === 1 && HELPER_RECEIPT_STATUSES.includes(status)
          && launch.receipt ? { receipt: { ...launch.receipt } } : {}) });
      continue;
    }
    if (launch.kind === 'agent') {
      if (launch.conflict || launch.agent.conflict) continue;
      const polled = taskOutputReceipt(launch.taskId, launch.at);
      const [status] = launch.statuses;
      if (launch.statuses.size === 0) { if (polled) launch.agent.receipt = polled; }
      else if (launch.statuses.size === 1 && HELPER_RECEIPT_STATUSES.includes(status))
        launch.agent.receipt = polled && earlier(polled, launch.receipt) ? polled : launch.receipt;
      continue;
    }
    // M33 P (W2 minor P4): a sound Workflow launch may also be received by a typed TaskOutput completion of its own
    // task id; the EARLIEST recorded completed receipt wins, the notification's or the TaskOutput's.
    if (launch.kind === 'workflow' && !launch.conflict && launch.statuses.size === 0) {
      const ev = events[launch.index];
      if (ev.workflowResultRepeated !== true && ev.workflowIdentityConflict !== true && workflowCalls.has(launch.index)) {
        const polled = taskOutputReceipt(launch.taskId, launch.at);
        if (polled) workflowCalls.get(launch.index).receipt = polled;
      }
      continue;
    }
    if (launch.conflict || launch.statuses.size !== 1) continue;
    const [status] = launch.statuses;
    const ev = events[launch.index];
    if (launch.kind === 'workflow') {
      if (ev.workflowResultRepeated !== true && ev.workflowIdentityConflict !== true) {
        ev.workflowNotificationStatus = status;
        // M33 W2: a final state settled by this very join is where the parent received the run's completion: the
        // earliest row that joined it. Side channel only (`workflowLaunchesOf`): no ledger byte moves. M33 P (P4):
        // unless a typed TaskOutput completion of the same task was recorded earlier.
        if (WORKFLOW_RECEIPT_STATUSES.includes(status) && workflowCalls.has(launch.index)) {
          const polled = taskOutputReceipt(launch.taskId, launch.at);
          workflowCalls.get(launch.index).receipt = polled && earlier(polled, launch.receipt) ? polled : launch.receipt;
        }
      }
      continue;
    }
    if (ev.outcomeUnknown === true || ev.conflict === true
      || ev.interrupted === true || ev.isError === true || Number.isFinite(ev.exitCode)) continue;
    // D99 (F1 guard): a run its own notification typed stopped or killed was stopped before it finished: a recorded end
    // that is no completion and no failure. It types no status (it proved nothing it finished) and is never read as
    // having no end.
    if (STOPPED_NOTIFICATION_STATUSES.includes(status)) { ev.backgroundEnd = BACKGROUND_ENDS.stopped; continue; }
    ev.statusSource = COMMAND_STATUS_SOURCES.claudeTaskNotification;
    if (status === 'failed') { ev.outcome = 'failed'; ev.outcomeSource = 'native'; }
    // H1: `completed` is a zero status, read as `attachResult` reads one (`exitStatusCovers`), for every command.
    else { ev.outcome = zeroStatusOutcome(ev); ev.outcomeSource = 'native'; }
  }

  // D68 (H, last clause; C-02 "M36 recorded facts"): a file changed between two recorded states of it by something
  // not recorded as an edit. (D69 (c): no work root re-spells a path any more; one file is one path throughout.)
  unrecordedChanges(events);
  // External first, so attachBefore can skip paths outside the recorder's working directory (memory files,
  // scratchpads): they are not code under review (`external`, the write scope).
  finalizeExternal(events, cwd, place);
  // D90 (owner decision 2026-10-15, privacy is not a design constraint): no observation is withheld for the file it
  // read (D68 R and D69 b withheld a credential-shaped file's and a harness home folder's): the reviewer sees what the
  // agent saw. `external` is the write scope, never a reason to hide what the agent read. A ledger an earlier slicer
  // wrote may still say `observationWithheld`: the adapter reads it.
  attachBefore(events);
  for (const ev of events) if (ev.external && ev.before) delete ev.before;
  // M33 U repair, L1: every action the human refused, whatever became of that result.
  for (const index of rejectedWithWords) if (events[index]) events[index].humanAnswerUnresolved = true;
  // M34 labels review (F4): every Codex call whose output the slicer labelled the human's answer, whatever became of it.
  for (const index of unreadAnswers) if (events[index]) events[index].humanAnswerUnresolved = true;
  // M34 labels review (F5): the notifications linked to each action, whatever became of its result.
  for (const [index, n] of notified) if (events[index]) events[index].notified = n;
  instructionCapture.feedbackUnplaced = unplacedWords.size;
  // L1 review: every call a recorder that types no refusal recorded as failed, whatever became of its result.
  for (const index of untypedRefusals) if (events[index]) events[index].refusalUntyped = true;
  instructionCapture.refusalUntyped = untypedRefusals.size + untypedUnplaced.size;
  // L1 session-type review: every call refused in a session whose type was not recorded, whatever became of its result.
  for (const index of unrecordedTypeRefusals) if (events[index]) events[index].refusalSessionUnknown = true;
  instructionCapture.refusalSessionUnknown = unrecordedTypeRefusals.size + unrecordedTypeUnplaced.size;
  const missingByAdapter = { claude: 0, cursor: 0, codex: 0, unknown: 0 };
  for (const [index, adapter] of awaitingObservation) {
    events[index].observationMissing = true;
    const key = Object.hasOwn(missingByAdapter, adapter) ? adapter : 'unknown';
    missingByAdapter[key]++;
  }
  const agentLaunches = new Map([...handOffCalls.values()]
    .filter((call) => call.mode === 'launch' && call.launched && !call.conflict)
    .map((call) => [call, { callId: call.callId, agentId: call.agentId, source: call.source, record: call.record,
      turn: call.turn, ...(call.receipt ? { receipt: { ...call.receipt } } : {}) }]));

  return {
    events,
    ask,
    interjections,
    projectInstructions,
    editedFiles,
    workflowLaunches: workflowLaunchesOf(workflowCalls, events),
    // D99 (F1 guard): the background runs whose end the slicer has not read, for the verbatim search (index.js).
    backgroundRuns: backgroundRunsOf({ events, resultRows, notified, notificationLaunches, workflowCalls, agentLaunches }),
    launchMisses,
    deliveries: { agents: [...agentLaunches.values()],
    // M33 P repair: each synchronous hand-off with its receipt (its own single result row). M33 P second repair: a
    // hand-off is synchronous when its one result is not the launch stub, whatever its input records. L2: and records a
    // typed status that says so; a hand-off with no result keeps its place here, with no receipt, as before.
    calls: [...handOffCalls.values()].filter((call) => call.mode !== 'launch' && call.mode !== 'unknown' && !call.conflict)
      .map((call) => ({ callId: call.callId, source: call.source, record: call.record, turn: call.turn,
        ...(call.receipt ? { receipt: { ...call.receipt } } : {}) })),
    // L2: each hand-off whose one result recorded no typed launch status: neither a launch
    // nor a receipt, declared by the loader.
    unknown: [...handOffCalls.values()].filter((call) => call.mode === 'unknown' && !call.conflict)
      .map((call) => ({ callId: call.callId, source: call.source, record: call.record, turn: call.turn })),
    sends, arrivals, reports,
    // D175: each typed resume of a launched Claude helper, its message in memory only; and (fix round) each row on which
    // a task notification reached this recording's agent as a message of its own.
    resumes, wakes },
    claim: { finalMessage: lastAssistantText },
    sayings: [...sayings].map(([t, { text, identity }]) => ({ turn: t, text, identity })),
    commentary,
    commentaryCapture,
    instructionCapture,
    actionCapture: { unsupported: unsupportedActions, orphanResults, knownCodeEffectDemoted },
    observationCapture: { missing: awaitingObservation.size, missingByAdapter },
    marks,
  };
}

/**
 * D99 (F1 guard). Every background run whose end the slicer did not read, each `{ kind, taskId, row, linked, index?,
 * entry? }`: the run's own task id, the row of its launch's own result (`{source, record}`, where the verbatim search
 * starts) and the count of notifications the labeller linked to it. Three kinds, each read by its own typed launch:
 *   bash      a Claude Bash result that records a background task id (`recorded.backgroundTaskId`, what the evidence's
 *             typed outcome reads) with no typed end: no completion or failure joined (`statusSource`), not typed
 *             stopped (`backgroundEnd`), and no denial, interrupt, error flag or exit code (each its own end);
 *   workflow  a registered Workflow launch (its typed task id) with no receipt, whose own notification typed neither a
 *             stop nor a kill (a stopped run recorded its end: no completion, so "no receipt of its completion" is
 *             true of it);
 *   agent     a registered background Agent launch (its agentId) with no receipt and no stop or kill typed, `entry` its
 *             entry of the delivery side channel.
 * Structure only: the slicer's own typed fields, never a word of a result.
 */
function backgroundRunsOf({ events, resultRows, notified, notificationLaunches, workflowCalls, agentLaunches }) {
  const runs = [];
  for (const [index, row] of resultRows) {
    const ev = events[index];
    const id = ev?.recorded?.backgroundTaskId;
    if (typeof id !== 'string' || !id || ev.backgroundEnd !== undefined || ev.statusSource !== undefined
      || ev.recorded.denial !== undefined || ev.interrupted === true || ev.isError === true
      || Number.isFinite(ev.exitCode)) continue;
    runs.push({ kind: 'bash', index, taskId: id, row: { source: row.source, record: row.record },
      version: row.version, linked: notified.get(index) ?? 0 });
  }
  const stoppedOnly = (launch) => launch.statuses.size === 1 && STOPPED_NOTIFICATION_STATUSES.includes([...launch.statuses][0]);
  for (const launch of notificationLaunches.values()) {
    if (launch.kind === 'workflow') {
      const ev = events[launch.index];
      if (!workflowCalls.has(launch.index) || workflowCalls.get(launch.index).receipt
        || ev.workflowResultRepeated === true || ev.workflowIdentityConflict === true || stoppedOnly(launch)) continue;
      runs.push({ kind: 'workflow', index: launch.index, taskId: launch.taskId,
        row: { source: launch.at.source, record: launch.at.record }, version: launch.version,
        linked: notified.get(launch.index) ?? 0 });
    } else if (launch.kind === 'agent') {
      const entry = agentLaunches.get(launch.agent);
      if (!entry || launch.agent.receipt || !launch.agent.launchRow || stoppedOnly(launch)) continue;
      runs.push({ kind: 'agent', entry, taskId: launch.taskId,
        row: { source: launch.agent.launchRow.source, record: launch.agent.launchRow.record },
        version: launch.agent.launchRow.version, linked: launch.agent.notified ?? 0 });
    }
  }
  return runs;
}

/**
 * M33 W. Each Claude Workflow call's recorded launch, for the run linker (cli/src/session-evidence.js) and nothing
 * else: the call's event (`turn`, `seq`), its call id, row and stream, the sessionId its tool_use row recorded when
 * every result row repeated it, and — only when the call has at least one result row, was never retracted, and every
 * result row's sidecar records the very same `runId`, `transcriptDir` and `workflowName` — those three recorded values,
 * untouched. Anything else records none of them (the run is then unresolved). Nothing here is inferred. M33 W repair
 * 2: the recorded row `uuid` of the call's tool_use row and of each of its result rows (`resultUuids`, recorded order;
 * null where a row records none), and the input's `resumeFromRunId` only when the input records that key. M33 W2:
 * `receipt` — where the parent received the run's completion (`{turn, beforeEvent, source, record}` of the earliest
 * notification row the C-02 M33 D join attached to this launch) — only when that join settled a final state
 * (`WORKFLOW_RECEIPT_STATUSES`).
 */
function workflowLaunchesOf(workflowCalls, events) {
  const text = (value) => (typeof value === 'string' ? value : undefined);
  return [...workflowCalls].map(([index, call]) => {
    const ev = events[index];
    const sidecars = call.results.map(({ raw }) => (plain(raw) ? { runId: text(raw.runId),
      transcriptDir: text(raw.transcriptDir), workflowName: text(raw.workflowName) } : null));
    const agreed = !call.retracted && sidecars.length > 0 && sidecars.every((sidecar) => sidecar !== null
      && sidecar.runId !== undefined && sidecar.runId === sidecars[0].runId
      && sidecar.transcriptDir === sidecars[0].transcriptDir && sidecar.workflowName === sidecars[0].workflowName);
    const sessionId = typeof call.sessionId === 'string' && call.results.length > 0
      && call.results.every((result) => result.sessionId === call.sessionId) ? call.sessionId : null;
    const uuid = (value) => (typeof value === 'string' ? value : null);
    return { turn: ev.turn, seq: ev.seq, callId: typeof call.callId === 'string' ? call.callId : null,
      // C-01 event identity: the call's own, from which each agent its run started is named (session-evidence.js).
      ...(ev.identity ? { identity: { ...ev.identity } } : {}),
      record: call.record, source: call.source, sessionId, uuid: uuid(call.uuid),
      resultUuids: call.results.map((result) => uuid(result.uuid)),
      ...(call.resumeFromRunId !== undefined ? { resumeFromRunId: call.resumeFromRunId } : {}),
      ...(agreed ? { runId: sidecars[0].runId,
        ...(sidecars[0].transcriptDir !== undefined ? { transcriptDir: sidecars[0].transcriptDir } : {}),
        ...(sidecars[0].workflowName !== undefined ? { workflowName: sidecars[0].workflowName } : {}) } : {}),
      ...(call.receipt ? { receipt: { ...call.receipt } } : {}) };
  });
}

/**
 * OWNER DECISION B (2026-10-01). The human's answers to one Claude AskUserQuestion call, in the call's question order,
 * from its typed answer sidecar — or null. The sidecar is exactly `{questions, answers}`; its questions are the call's
 * own recorded question texts, in order (`questions`, from the call's input); its answers name each of them exactly
 * once with a non-empty string, and each answer is in the result text the agent read (`visibleText`). Only the
 * answers are returned: the questions are the agent's words, already the call's own input.
 * Release fix 3c (2026-10-12): a question the call recorded as `multiSelect: true` is answered by the list of the
 * options the human chose — the recorder's typed list, never text split here. Each chosen option is an answer of its
 * own, in the recorded order (a non-empty list of non-empty strings, each in the result text the agent read); an empty
 * list, or a list for a question that does not let the human choose several, reads nothing (the answer stays
 * unresolved). A list answer comes on a `multiSelect` question, every option in the result text; before this, each left its call's answer unread.
 */
function askUserAnswers(raw, questions, visibleText) {
  if (!plain(raw) || !keysAre(raw, ['questions', 'answers']) || !own(raw, 'questions') || !own(raw, 'answers')) return null;
  const texts = Array.isArray(questions) ? questions.map((question) => question?.text) : null;
  if (!texts || !texts.length || new Set(texts).size !== texts.length
    || !Array.isArray(raw.questions) || raw.questions.length !== texts.length
    || !raw.questions.every((question, i) => plain(question) && question.question === texts[i])) return null;
  if (!plain(raw.answers) || Object.keys(raw.answers).length !== texts.length) return null;
  const answers = [];
  for (const { text, multiSelect } of questions) {
    const answer = own(raw.answers, text) ? raw.answers[text] : undefined;
    const chosen = multiSelect === true && Array.isArray(answer) ? answer : [answer];
    if (!chosen.length || !chosen.every((one) => string(one) && one.trim() && string(visibleText)
      && visibleText.includes(one))) return null;
    answers.push(...chosen);
  }
  return answers;
}

/**
 * D69 (c) (owner decision 2026-10-08): which absolute-path events lie outside the work under review (`external`, the
 * write scope), by the recorder's own working directory — the cwd its rows recorded (Claude Code's rows, Codex's
 * `session_meta`/`turn_context`: `meta.cwd`, the one every path of the slice is spelled by) — and a harness worktree
 * under it (`<cwd>/.claude/worktrees/<name>/`, D40: inside the cwd, so the work under review). Inside the cwd a path
 * keeps its spelling; a harness home folder of the recording's user is never project work (D69 b); anything else is
 * external. D69 review (finding F5): the home folders' rule here is the KNOWN home's only (before.js `homeFolderPath`),
 * never withholding's fail-closed one (`harnessHomePath`): with the home unknown, a project's own `.claude` under the
 * cwd stays work under review (its change on the page and in the story), and a folder outside the cwd is outside it by
 * the cwd rule alone. It reads every spelling: an absolute path (`_abs`) and a relative one (the cwd's), so a home
 * folder spelled relative to a cwd that contains the home is outside the work as its absolute spelling is.
 * Deleted: the project folder guessed from absolute paths named in the human's messages (`askRoots`, `askSpells`), the
 * election of the folder most writes went to (`bucketOf`, the majority work root) and the re-spelling of paths by it,
 * and the scratchpad rule (`/tmp/claude-*…/scratchpad/`, or any `/scratchpad/` under a tmp folder: a form fitted to
 * what showed up, documented nowhere the recorder writes it; a scratchpad lies outside the cwd and is external by the
 * cwd rule alone).
 */
function finalizeExternal(events, cwd, place = {}) {
  const inCwd = (p) => !!cwd && within(p, cwd);
  for (const e of events) {
    if (e._abs) {
      const p = e._abs;
      delete e._abs;
      if (!inCwd(p) || homeFolderPath(p, place)) e.external = true;
    } else if (typeof e.path === 'string' && e.path && e.external !== true && homeFolderPath(e.path, place)) {
      e.external = true;
    }
  }
}

/**
 * D68 (C-02 "M36 recorded facts"). The facts the recorder typed about a call, read from the call itself, once: its own
 * tool name (c5: Claude Code's tool name; a Codex call's recorded name, or a native item's type), a Codex command's
 * parsed meaning and the class it makes (`read` only when every part is a read; a code cell's output mixes commands, and
 * a command the recorder typed no meaning for, legacy or direct, is a `command`), a Codex change's recorded hunks
 * (as recorded, recorded.js `carriedHunks`), and what the record holds of
 * a write (`patch`) and of the file before it (`prior`). A sidecar may add to them when the result is read
 * (`attachResult`).
 */
function callFacts(ev, use, adapter) {
  const facts = { tool: typeof use.recorderName === 'string' ? use.recorderName : (use.sourceName ?? use.name) };
  if (adapter === 'codex') {
    if (ev.provenance === ACTION_PROVENANCE.codexCodeCell) facts.commandClass = 'command';
    else if (ev.kind === 'bash' || ev.kind === 'test') {
      if (Array.isArray(use.parsedCmd)) facts.parsedCmd = use.parsedCmd;
      facts.commandClass = commandClassOf(use.parsedCmd);
    // M36 review: a call the recorder named a command tool (`CODEX_COMMAND_TOOLS`, by its recorded name) is a command
    // whatever kind the slicer gave it — a legacy `shell_command`, an `exec_command` whose input it could not read.
    } else if (codexCommandTool(facts.tool)) facts.commandClass = 'command';
    // The recorder typed a parsed command Sonah could not carry: the facts say so.
    if (use.parsedCmdUnread === true) facts.withheld = true;
  }
  if (ev.kind === 'create') {
    facts.patch = 'body';
    facts.prior = 'unrecorded';
    // M36 review: a Codex add — an apply_patch `*** Add File` section, a FileChange `add` change — is the recorder's verb
    // (`writeType: 'add'`), not an existence check: Codex writes the file whether or not it was there, so its prior state
    // is unrecorded. (Claude Code's Write `create` is one: the recorder checked, `prior: 'absent'`, claudeResultFacts.)
    if (adapter === 'codex' && use.name === 'Write'
      && /^(?:(?:functions\.)?apply_patch|FileChange)$/.test(String(use.recorderName ?? ''))) facts.writeType = 'add';
  } else if (ev.kind === 'edit') {
    facts.patch = ev._editParts ? 'strings' : typeof ev._body === 'string' ? 'body' : 'none';
    facts.prior = 'unrecorded';
    const hunks = Array.isArray(use.recordedHunks) ? use.recordedHunks : null;
    // D90: every file's hunks are carried (D68 R withheld a credential-shaped or harness home file's, `hunksWithheld`).
    const carried = carriedHunks(hunks);
    if (carried) {
      facts.hunks = carried;
      facts.patch = 'hunks';
      facts.prior = 'hunks';
    }
    // The recorder recorded hunks Sonah could not read as hunks: the facts say so.
    if (use.recordedHunksUnread === true || (hunks && !carried)) facts.withheld = true;
  } else if (ev.kind === 'delete') {
    facts.prior = typeof use.priorContent === 'string' ? 'file' : 'unrecorded';
    // C (2): the whole file the recorder kept before the delete is its prior state (attachBefore, source `original`).
    if (typeof use.priorContent === 'string') ev._orig = use.priorContent;
  }
  ev.recorded = facts;
}

function makeEvent(use, spec, { turn, seq, cwd, source, adapter, claudeRow = null }) {
  const input = use.input || {};
  const ev = { turn, seq, kind: spec.kind };
  const locator = use.sourceLocator;
  if (adapter === 'codex' && Number.isSafeInteger(source) && source >= 0
    && Number.isSafeInteger(locator?.record) && locator.record > 0
    && Number.isSafeInteger(locator?.part) && locator.part >= 0) {
    ev.sourceLocator = { stream: source, record: locator.record, part: locator.part };
    for (const field of ['resultRecord', 'fileChangeRecord', 'commandExecutionRecord'])
      if ((field !== 'commandExecutionRecord' || !spec.generic && use.name === 'Bash')
        && Number.isSafeInteger(locator[field]) && locator[field] > 0)
        ev.sourceLocator[field] = locator[field];
  }
  // M33 P: a Claude action's row, kept under its own key until the loader decides (cli/src/session-evidence.js): a
  // ledger that links a helper records it as `sourceLocator` (what places the helper among the parent's actions);
  // any other drops it, so its bytes do not move.
  if (claudeRow && Number.isSafeInteger(claudeRow.stream) && claudeRow.stream >= 0
    && Number.isSafeInteger(claudeRow.record) && claudeRow.record > 0
    && Number.isSafeInteger(claudeRow.part) && claudeRow.part >= 0)
    ev.claudeLocator = { stream: claudeRow.stream, record: claudeRow.record, part: claudeRow.part };
  // C-02 M33 native-first: a closed provenance member only, never free text.
  if (adapter === 'codex' && PROVENANCES.has(use.provenance)) ev.provenance = use.provenance;
  if (spec.generic) {
    const sourceInput = own(use, 'sourceInput') ? use.sourceInput : use.input;
    ev.tool = use.sourceName ?? use.name;
    ev.genericTool = true;
    const exactInput = recordedJson(sourceInput);
    if (exactInput === null) ev.inputUnparsed = true;
    else { ev.argsExcerpt = exactInput; ev.inputRecorded = true; }
    if (plain(sourceInput) && own(sourceInput, '__unparsedToolInput')) ev.inputUnparsed = true;
    return ev;
  }
  // M36 phase 2 review (owner decision D68 P: a tool input is what the agent produced, kept whole): a read tool's own
  // query fields — Grep's and Glob's `pattern`, Read's `offset` and `limit` — are kept as its input by the recorder's
  // field names whatever its path (the locator, `file_path`, `notebook_path` or `path`, is the call's path). Before, a
  // Grep or a Glob with a path kept none of its pattern.
  const queryFields = spec.kind === 'read' ? spec.fields.filter((key) => !READ_LOCATORS.includes(key)) : [];
  if (spec.extras?.length || use.name === 'Bash' || queryFields.length) {
    const additional = Object.fromEntries(
      [...queryFields, ...(spec.extras ?? []), ...(use.name === 'Bash' ? ['description'] : [])]
        .filter((key) => own(input, key)
          && !(key === 'cmd' && input.cmd === input.command)
          && !(key === 'path' && input.path === input.file_path)
          && !(key === 'contents' && input.contents === input.content)
          && !(key === 'glob_pattern' && input.glob_pattern === input.pattern)
          && !(key === 'target_directory' && input.target_directory === input.path))
        .map((key) => [key, input[key]]));
    if (Object.keys(additional).length) {
      const metadata = recordedJson(additional);
      if (metadata === null) ev.inputUnparsed = true;
      else ev.inputMetadata = metadata;
    }
  }

  const rawPath = input.file_path ?? input.notebook_path ?? input.path ?? null;
  if (rawPath) {
    const sourcePath = String(rawPath);
    if (sourcePath.startsWith('/')) {
      // Normalize before the cwd-prefix check: `/repo/../private` is outside `/repo`.
      ev._abs = posix.normalize(sourcePath);
      ev.path = relative(ev._abs, cwd);
    } else if (win32.isAbsolute(sourcePath)) {
      const absolute = win32.normalize(sourcePath);
      const within = win32.isAbsolute(cwd) ? win32.relative(cwd, absolute) : null;
      const inside = within !== null && !win32.isAbsolute(within) && !escapesRelativeRoot(within);
      ev.path = inside ? within.replaceAll('\\', '/') : absolute.replaceAll('\\', '/');
      if (!inside) ev.external = true;
    } else {
      ev.path = relative(sourcePath, cwd);
      if (escapesRelativeRoot(sourcePath)
        || /^(?:~[^/\\]*|\$(?:HOME|\{HOME\})|%USERPROFILE%)(?:[/\\]|$)/i.test(sourcePath)
        || /^[A-Za-z]:/.test(sourcePath) || /^[A-Za-z][\w+.-]*:\/\//.test(sourcePath))
        ev.external = true;
    }
  }

  if (spec.kind === 'bash') {
    const cmd = String(input.command ?? '');
    if (!cmd) return null;
    ev.cmd = cmd;
    // M1: every shell command is `bash`. Code no longer decides from a runner-name list
    // which command "is a test": that changed how much its exit code was trusted. Whether a run is a test is the
    // reviewer's reading of its command and output, quoted verbatim. (A ledger an older slicer wrote may still say
    // `test`; every reader takes it as a command.)
    if (input.run_in_background === true) ev.background = true;
    // Status fact (review F1): the Codex adapter types a command whose native item recorded it as the script of its own
    // shell process (`[shell, -c|-lc, line]`, codex.js); only there is the line's own errexit read (`exitStatusGap`).
    if (adapter === 'codex' && use.ownShell === true) OWN_SHELL.add(ev);
    return ev;
  }

  if (spec.kind === 'read') {
    // The call supplies a source locator; attachResult retains its textual observation.
    if (!ev.path && input.pattern) ev.path = null;
    if (Number.isFinite(input.offset)) ev.offset = input.offset;
    if (Number.isFinite(input.limit)) ev.limit = input.limit;
    // A glob can be rooted at the current workspace without an explicit path. Retain its
    // recorded query as input evidence rather than dropping the action for a missing locator.
    if (!ev.path && typeof input.pattern === 'string') ev.inputMetadata = recordedJson(input);
    return ev.path || typeof input.pattern === 'string' ? ev : null;
  }

  if (spec.kind === 'other') {
    ev.tool = use.name;
    if (use.name === 'TaskOutput' && taskId(input.task_id)) ev.taskOutputTaskId = input.task_id;
    // `argsExcerpt` is already a redactor-owned field. Unlike edit/create args, these inputs
    // are not capped here: a Workflow script can exceed 32 KiB, and clipping it while claiming
    // a complete action would hide precisely the work the review needs to inspect. Prompt
    // budgeting later may preview it, with a declared gap if its middle is not reviewed.
    const fields = spec.fields.filter((field) => own(input, field));
    if (fields.length) {
      ev.inputRecorded = true;
      const parts = spec.inputUnparsed
        ? [`unparsed input: ${input.__unparsedToolInput.raw}`]
        : fields.map((field) => `${field}: ${stringifyField(input[field])}`);
      // The separator is structural only between fields. A literal occurrence inside a field
      // cannot be distinguished downstream once flattened, so declare that lost boundary.
      if (parts.some((part) => part.includes(ARG_SEP))) ev.inputBoundaryAmbiguous = true;
      ev.argsExcerpt = parts.join(ARG_SEP);
    }
    if (spec.inputUnresolved) ev.inputUnresolved = true;
    if (spec.inputUnparsed) ev.inputUnparsed = true;
    return ev;
  }

  // edit | create — patch identity lives in the args, kept WHOLE (D69 review: what the agent wrote, as D68 E keeps it; the
  // window `excerptWindow` and redaction's 2,000-unit bound after it, `EXCERPT_CAPS`, are deleted).
  //
  // old_string and new_string are BOTH multi-line, so joining them with a newline makes the boundary
  // unrecoverable and every before/after delta (assertions, numeric thresholds) silently reads zero.
  // An explicit marker is the only way to keep the halves separable downstream.
  const args = spec.fields
    .filter((f) => f !== 'file_path' && f !== 'notebook_path')
    .map((f) => stringifyField(input[f]))
    .filter(Boolean)
    .join(ARG_SEP);
  if (args) ev.argsExcerpt = args;

  // The content channel (D31): what the write CHANGED, as a minimal diff. argsExcerpt stays
  // exactly as it was (the shortcut analyzer parses it); `diff` is what the judge reads.
  //
  // F67: an Edit's own text is evidence, not only a diff of it. `new_string` is what the agent
  // WROTE and `old_string` is what it replaced, and the recording carries both — most changes in a
  // session are Edits, so without this the review can quote almost nothing
  // the agent actually wrote. Both sides ride on ONE body field because redaction scrubbed exactly
  // two (`before.text` and `after.text`, before D90 deleted its detectors) and `before` is the whole-file pre-edit
  // channel: an edit fragment placed there would describe a fragment as the file's first version
  // in the session. So the edit's own text is one
  // recorded field with a declared shape — every WRITTEN segment first (they are the point of the
  // channel and must survive the cap), then every REPLACED segment, joined by ARG_SEP.
  // The adapter splits the field back into one change per edit entry. D68 (E): each side is kept whole (no cap, no
  // memory bound: F155's and F168's per-side cuts are gone with them).
  const editEntries = Array.isArray(input.edits)
    ? input.edits.filter((x) => x && typeof x.old_string === 'string' && typeof x.new_string === 'string')
    : (typeof input.old_string === 'string' && typeof input.new_string === 'string' ? [input] : []);
  if (editEntries.length) {
    // Each diff is rendered from its change as recorded (diff.js `editDiff`).
    const diffs = editEntries.map((x) => editDiff(x.old_string, x.new_string));
    ev.diff = diffs.length === 1 ? diffs[0] : joinDiffs(diffs).text;
    ev._body = editText(editEntries.map((x) => x.new_string), editEntries.map((x) => x.old_string));
    ev._editParts = editEntries.length;
    // `replace_all` changes WHERE the text landed, never what it was: the body stays the written
    // text once, and the repetition is declared on the extent instead of being materialised.
    if (editEntries.some((x) => x.replace_all === true))
      ev._replaceAll = editEntries.map((x) => x.replace_all === true);
  } else {
    const body = input.content ?? input.new_source ?? input.text ?? input.contents;
    // F108: an EMPTY body is recorded too. `content: ''` empties a file and `new_source: ''`
    // clears a notebook cell; the record says so exactly, and dropping it made the write read as
    // one whose body the recorder never kept. An absent body stays absent — nothing is invented —
    // and no diff is drawn for a body with no lines. Only where the body IS the whole new state:
    // a create-shaped write or a cell's new source. An empty field on an MCP edit verb (append,
    // patch, update…) says nothing certain about what the file became, so it stays unrecorded.
    const wholeState = spec.kind === 'create' || spec === TOOLS.NotebookEdit;
    // F131: a NotebookEdit's `edit_mode` decides what `new_source` is. `delete` removes the cell,
    // so nothing was written and there is no after and no diff for it, whatever `new_source`
    // holds; `insert` adds a cell whose source is the body, declared as an insert (a new cell,
    // not the replacement of an existing one). `replace`, the default, is unchanged.
    const cellMode = spec === TOOLS.NotebookEdit ? input.edit_mode : undefined;
    if (cellMode !== 'delete' && typeof body === 'string' && (body.length || wholeState)) {
      ev._body = body;
      if (body.length) ev.diff = createDiff(body);
      if (cellMode === 'insert') ev._insert = true;
    }
  }
  return ev.path ? ev : null;
}

/**
 * What the recording actually says about how one tool call ended.
 *
 * The whole rule is: an outcome comes from a POSITIVE recorded signal, never from the absence of
 * a negative one. `is_error` is three-valued in practice (true / false / absent), so "no error
 * flag" is not "it worked" — it is most often "nobody recorded anything", and claiming `succeeded`
 * with `native` provenance from that dressed a guess up as a harness report (H44, M92).
 *
 * Precedence, strongest first:
 *   1. two recordings of the same fact that DISAGREE (`is_error` with exit code 0). Neither wins:
 *      unknown, and the disagreement is stated rather than silently resolved (M91).
 *   2. an explicit failure: the error flag, or a recorded non-zero exit code.
 *   3. interrupted: the call never ran to completion, so its output describes nothing (M90).
 *   4. structured success: Claude Code stamps `toolUseResult.type` 'create'/'update' on a
 *      Write/Edit that landed; a recorded exit code of 0 is the same class of evidence.
 *   5. a file tool's own success sentence ("File created successfully at: …", outcome.js
 *      `isWriteSuccessLine`), read only for a write-shaped call (edit, create, delete): the only
 *      positive signal an older Claude Code write carries. Still text, so labelled `parsed-output`:
 *      it is never counted as something the harness reported. H1: no other output text is read for
 *      a status — a command's output, a read's file text and a tool's answer prove nothing.
 *   6. nothing. `unknown`, and no provenance at all: there is no source to name.
 *
 * @returns {{outcome: 'succeeded'|'failed'|'unknown', provenance?: string, conflict?: true}}
 */
function resultEvidence({ isError, exitCode, interrupted, out, writeType, fileChangeSuccess,
  commandStatusConflict, claudeEditSucceeded }) {
  const hasCode = Number.isFinite(exitCode);
  if (commandStatusConflict) return { outcome: 'unknown', provenance: 'native', conflict: true };
  if (fileChangeSuccess && (isError || hasCode && exitCode !== 0 || interrupted === true))
    return { outcome: 'unknown', provenance: 'native', conflict: true };
  if (isError && hasCode && exitCode === 0) return { outcome: 'unknown', provenance: 'native', conflict: true };
  if (isError) return { outcome: 'failed', provenance: 'native' };
  if (hasCode && exitCode !== 0) return { outcome: 'failed', provenance: 'native' };
  if (interrupted === true) return { outcome: 'unknown', provenance: 'native' };
  if (fileChangeSuccess) return { outcome: 'succeeded', provenance: 'native' };
  if (writeType === 'create' || writeType === 'update') return { outcome: 'succeeded', provenance: 'native' };
  // C-02 M33 D: a Claude Edit sidecar that repeats its own call exactly is the same class of evidence.
  if (claudeEditSucceeded === true) return { outcome: 'succeeded', provenance: 'native' };
  if (hasCode && exitCode === 0) return { outcome: 'succeeded', provenance: 'native' };
  if (isWriteSuccessLine(out)) return { outcome: 'succeeded', provenance: 'parsed-output' };
  return { outcome: 'unknown' };
}

function attachResult(ev, res) {
  if (!ev) return;
  const { text: out, visibleText, isError, exitCode, exitCodeSource, interrupted,
    outcomeUnknown, nonText, commandStatusConflict } = res;
  const fileChangeSuccess = res.fileChangeSuccess === true && ['edit', 'create', 'delete'].includes(ev.kind);
  if (isError) ev.isError = true;
  // C-02 M33 D: the typed sidecar says the command went to the background, with or without the
  // input flag (an auto-backgrounded call carries none). A launch stub is never a completion.
  if (res.claudeBackground === true && (ev.kind === 'bash' || ev.kind === 'test')) ev.background = true;
  if (!ev.genericTool && Number.isFinite(exitCode)) {
    ev.exitCode = exitCode;
    if (exitCodeSource === 'native' || exitCodeSource === 'hook')
      ev.exitCodeSource = exitCodeSource;
  }
  if (interrupted === true) ev.interrupted = true;
  if (outcomeUnknown === true) ev.outcomeUnknown = true;
  // Keep every model-visible textual tool result, not only command output. Nontext results
  // cannot safely be flattened to a quote and are declared as a loss by the adapter.
  if ((ev.genericTool ? res.visibleNonText : nonText) === true)
    ev.observationNonText = true;
  if (Array.isArray(res.referenceNames)) {
    ev.tailLines = [...res.referenceNames];
    ev.toolReferenceSpans = true;
  } else if (visibleText) ev.tailLines = visibleText.split('\n');
  if (ev.genericTool && Array.isArray(res.visibleSpans) && res.visibleSpans.length)
    ev.outputSpans = [...res.visibleSpans];
  // M33 U repair: a Claude question call is marked when it is made (buildEvents); its result keeps the mark — moved here,
  // where 269cf6d wrote it, so a ledger it already declared keeps its bytes — unless the result is an error: an
  // interrupt, or a decline, carries no answer here (L1: a call the human refused declares its answer unread by
  // `CLAUDE_USER_REFUSAL`, whatever its words).
  const asked = ev.tool === 'AskUserQuestion' && ev.humanAnswerUnresolved === true;
  if (asked) delete ev.humanAnswerUnresolved;
  if ((asked || !ev.genericTool && ev.tool === 'AskUserQuestion') && isError !== true)
    ev.humanAnswerUnresolved = true;
  // C-02 M33 D (F9): a Claude Workflow call outside the typed input schema is still a launch; its
  // async status is declared exactly as the typed call's is.
  if ((!ev.genericTool || res.claudeWorkflow === true) && ev.tool === 'Workflow'
    && res.raw?.status === 'async_launched') {
    ev.workflowAsyncUnresolved = true;
    // The native sidecar and the model-visible launch block are independent carriers. A
    // contradictory Task ID in the block cannot be resolved by choosing one carrier; keep the
    // async gap. Explicit visible labels must agree with the native ID.
    if (taskId(res.raw.taskId) && visibleTaskIdAgrees(visibleText, res.raw.taskId))
      ev.workflowTaskId = res.raw.taskId;
    else ev.workflowIdentityConflict = true;
  }
  if (!ev.genericTool && ev.tool === 'TaskOutput' && res.raw?.retrieval_status === 'success'
    && plain(res.raw.task) && res.raw.task.status === 'completed'
    && taskId(res.raw.task.task_id) && isError !== true && nonText !== true
    && interrupted !== true && outcomeUnknown !== true
    && (!Number.isFinite(exitCode) || exitCode === 0)
    && typeof visibleText === 'string' && visibleText.length > 0
    && visibleTaskIdAgrees(visibleText, res.raw.task.task_id)) {
    ev.taskOutputCompleted = true;
    ev.taskOutputResultTaskId = res.raw.task.task_id;
  }
  if (!ev.genericTool && ev.tool === 'SendMessage' && isError !== true)
    ev.childFollowupUnresolved = true;

  // Claude Code's Edit/Write results carry the file as the tool found it (originalFile) and whether
  // the write created or updated it — the best pre-edit source there is (experiment 3 ladder).
  if ((ev.kind === 'edit' || ev.kind === 'create') && res.raw) {
    if (typeof res.raw.originalFile === 'string' && res.raw.originalFile.length) ev._orig = res.raw.originalFile;
    if (typeof res.raw.type === 'string') ev._writeType = res.raw.type;
  }
  // D68 (C-02 "M36 recorded facts"): what a Claude Code result sidecar types about the call.
  if (res.claudeRecord === true && plain(ev.recorded)) claudeResultFacts(ev, res);

  const evidence = resultEvidence({ isError, exitCode: ev.genericTool ? null : exitCode, interrupted,
    // Arbitrary tool output may contain a successful command or a green test claim; that does
    // not prove the surrounding tool invocation succeeded. Only explicit native signals can, and
    // a file tool's own success sentence only for a write-shaped call (H1).
    out: ['edit', 'create', 'delete'].includes(ev.kind) ? out : '',
    writeType: ev.kind !== 'other' && typeof res.raw?.type === 'string' ? res.raw.type : null,
    fileChangeSuccess, commandStatusConflict,
    claudeEditSucceeded: ev.kind === 'edit' && res.claudeEditSucceeded === true });

  if (ev.kind === 'bash' || ev.kind === 'test') {
    // H1: a command's status comes from STRUCTURE only — the harness's typed exit code (Codex's native header, the
    // PostToolUse hook), its error flag, its typed completion verdict (Claude Code's success sidecar). Output text is
    // never read for a status: whether an output shows a failing suite is the reviewer's judgement, quoted verbatim
    // under challenge. A nonzero status is `failed`, whichever command of the line failed. A zero status (or the
    // verdict) is `passed` only when the shell grammar says it speaks for every command the line ran
    // (`exitStatusCovers`); else it is `unproven` — not failed, not passed. Two rows come first, because they are
    // about whether the recording can be believed at all: a flag contradicting its exit code, and an interrupted call.
    // One rule for every command: a test runner's zero exit is a zero exit (a suite that skipped what it should have
    // run is the reviewer's to read in the output, not code's to guess from the runner's name).
    // Status fact: an `unproven` zero status carries the closed reason it does not cover every command (`statusGap`).
    const zero = () => zeroStatusOutcome(ev);
    if (outcomeUnknown === true) ev.outcome = 'unknown';
    else if (evidence.conflict) { ev.outcome = 'unknown'; ev.conflict = true; }
    else if (interrupted === true) ev.outcome = 'unknown';
    // C-02 M33 native-first: a `failed` native command item is failed by its typed status even though its negative
    // exit is a sentinel; so is any error flag and any recorded nonzero exit.
    else if (isError === true || Number.isFinite(exitCode) && exitCode !== 0) ev.outcome = 'failed';
    else if (Number.isFinite(exitCode)) ev.outcome = zero();
    // C-02 M33 D: the Claude completion verdict proves termination with no exit code: a zero status.
    else if (res.claudeVerdict === true) {
      ev.statusSource = COMMAND_STATUS_SOURCES.claudeNativeVerdict;
      ev.outcome = zero();
    } else ev.outcome = 'unknown';
    // Source of the STATUS, never of the output text. A displayed, transformed wrapper block
    // proves an observation but may have discarded the native exit code and settled status.
    ev.outcomeSource = outcomeUnknown === true ? 'unknown'
      : evidence.conflict || interrupted === true ? (exitCodeSource ?? (isError ? 'native' : 'unknown'))
      : ev.outcome === 'unknown' ? 'unknown'
      : Number.isFinite(exitCode) ? (exitCodeSource ?? 'native')
      : 'native';   // the error flag, or the completion verdict
    // D71 (S2): a failed command keeps what it attempted, as the other branch below has since
    // CRD-A1/G2 — the legacy `kind` flip stays for existing consumers, and an adapter names the tool the call attempted
    // (`bash`, `test`), never `error`.
    if (isError && ev.outcome === 'failed') {
      ev.attempted = ev.attempted ?? ev.kind;
      ev.kind = 'error';
    }
  } else if (ev.kind === 'read') {
    ev.bytes = out ? out.length : 0; // size only in the ledger — the text is retained transiently
    // for the pre-edit channel; attachBefore() deletes it. Unwrap the toolUseResult object BEFORE
    // capping (a capped JSON blob defeats per-line scrubbing) and never retain image/document reads.
    if (!isError && outcomeUnknown !== true && out && !res.nonText) {
      // M33 R repair 3: the text redaction will see — unwrapped, its line numbers stripped (before.js
      // `stripLineNumbers`) — kept whole (D68 E: no memory bound). `_readPlain`: `_readText` is that text already;
      // attachBefore uses it as it is.
      const unwrapped = unwrapReadResult(out);
      if (unwrapped.length) {
        ev._readText = stripLineNumbers(unwrapped);
        ev._readPlain = true;
      }
      const f = res.raw?.file;
      if (f && Number.isFinite(f.numLines)) ev._readMeta = { startLine: f.startLine ?? 1, numLines: f.numLines, totalLines: Number.isFinite(f.totalLines) ? f.totalLines : null };
    }
  } else if (isError) {
    // CRD-A1/G2: a failure does not change what was attempted. The legacy `kind` flip stays for
    // existing consumers, but the attempted operation is preserved alongside it -- an adapter
    // that reads only `kind` would otherwise report a failed WRITE as a command.
    ev.attempted = ev.attempted ?? ev.kind;
    ev.kind = 'error';
  }

  // CRD-A1/G2: explicit result evidence for write-shaped events. Without this the ledger cannot
  // tell a write that SUCCEEDED from one whose result was never recorded -- both arrive as
  // kind:'create' with before/after -- and the adapter defaulted the difference to success.
  // attachResult only runs when a source result exists, so `seen` is true here; WHAT was seen is
  // resultEvidence's job, and it may well be nothing worth a verdict.
  if (ev.kind !== 'bash' && ev.kind !== 'test') {
    const unprovedOutcome = outcomeUnknown === true && !fileChangeSuccess;
    ev.result = {
      seen: true,
      outcome: unprovedOutcome ? 'unknown' : evidence.outcome,
      ...(!unprovedOutcome && evidence.provenance ? { provenance: evidence.provenance } : {}),
      ...(!unprovedOutcome && evidence.conflict ? { conflict: true } : {}),
      ...(!unprovedOutcome && !ev.genericTool && Number.isFinite(exitCode) ? { exitCode } : {}),
    };
  }
}

/**
 * D68 (H, last clause; C-02 "M36 recorded facts"). For consecutive RECORDED whole states of one file in one recording —
 * the file a Write left (its recorded content: `_fileState.after`) and the file as the next call's record found it (its
 * recorded `originalFile`: `_fileState.before`) — compared by exact string: when they differ, something not recorded as
 * an edit in this recording changed the file between them, and the later call records it (`recorded.unrecordedChange`):
 * the earlier call (`since`, its turn and seq) and every command between them whose recorded `bashEditDiff` lists the
 * file (`commands`). A state not recorded whole is never compared: the file an Edit left is not recorded (owner (H): NO
 * computed end state anywhere, so an Edit's recorded hunks are never applied to make one), so an Edit ends the run and a
 * later call compares with nothing until a Write records the file again. A shell write in between is no recorded state
 * (it is what the check finds). Each recording is sliced alone, so an edit a linked helper's recording holds is not seen
 * here (none is linked so). Structure only: exact strings, never the words of the file.
 */
function unrecordedChanges(events) {
  const states = new Map();
  const lists = (diff, path) => (diff.files ?? []).some((file) => file.path === path)
    || (diff.changedFiles ?? []).includes(path);
  for (const [i, ev] of events.entries()) {
    const state = ev._fileState;
    delete ev._fileState;
    if (!state || typeof ev.path !== 'string' || !ev.path || !plain(ev.recorded)) continue;
    const previous = states.get(ev.path);
    if (previous && typeof previous.after === 'string' && typeof state.before === 'string'
      && previous.after !== state.before) {
      const commands = [];
      for (let j = previous.index + 1; j < i; j++) {
        const diff = events[j].recorded?.editDiff;
        if (diff && lists(diff, ev.path)) commands.push({ turn: events[j].turn, seq: events[j].seq });
      }
      ev.recorded.unrecordedChange = { since: { turn: previous.ev.turn, seq: previous.ev.seq }, commands };
    }
    states.set(ev.path, { ev, index: i, after: state.after });
  }
}

/**
 * D68 (C-02 "M36 recorded facts"). A Claude Code result's typed facts (a parent recording's: helper recordings carry no
 * sidecar): the error flag as the result block typed it (`is_error` true or false; absent, nothing), the sidecar's
 * numbers, booleans and strings by tool (recorded.js `claudeSidecarFacts`), a Bash call's `bashEditDiff`, and an Edit's
 * or Write's recorded hunks (`structuredPatch`, as recorded: recorded.js `carriedHunks`), its
 * type, and what the record holds of the file before it. E: the file before and after it, as recorded, kept transient
 * (`_fileState`) for the unrecorded-change check. A failed result types none of the sidecar's facts.
 */
function claudeResultFacts(ev, res) {
  const facts = ev.recorded;
  if (res.isError === true) facts.isError = true;
  else if (res.isErrorFalse === true) facts.isError = false;
  // M36 phase 3 review (D68 F): the recorder's typed denial (the call was refused, blocked or cancelled: it never ran).
  const denial = claudeDenialFacts(res.toolDenialKind);
  if (denial.denial) facts.denial = denial.denial;
  if (denial.withheld) facts.withheld = true;
  const raw = plain(res.raw) ? res.raw : null;
  if (!raw || res.isError === true || res.outcomeUnknown === true) return;
  Object.assign(facts, claudeSidecarFacts(facts.tool, raw));
  if (facts.tool === 'Bash' && own(raw, 'bashEditDiff')) {
    const read = bashEditDiffFacts(raw.bashEditDiff, res.cwd);
    if (read) {
      facts.editDiff = read.editDiff;
      if (read.unread) facts.withheld = true;
    } else if (raw.bashEditDiff !== null) facts.withheld = true;
  }
  if ((ev.kind === 'edit' || ev.kind === 'create') && ['Edit', 'MultiEdit', 'Write'].includes(facts.tool)) {
    const original = typeof raw.originalFile === 'string' ? raw.originalFile : null;
    const hunks = recordedHunks(raw.structuredPatch);
    if (facts.tool === 'Write' && ['create', 'update'].includes(raw.type)) {
      facts.writeType = raw.type;
      if (raw.type === 'create') facts.prior = 'absent';
    }
    // D90: every file's hunks are carried (D68 R withheld a credential-shaped or harness home file's, `hunksWithheld`).
    const carried = carriedHunks(hunks);
    if (carried) facts.hunks = carried;
    if (carried && facts.tool !== 'Write') facts.patch = 'hunks';
    // M36 review: the recorder recorded hunks Sonah could not read as hunks: the facts say so, never silence.
    if (!hunks && recordedPatch(raw.structuredPatch)) facts.withheld = true;
    if (original !== null) facts.prior = 'file';
    else if (hunks && facts.prior !== 'absent') facts.prior = 'hunks';
    // E: the file as the recorder kept it before this call, and as the call left it — a Write's recorded content (its
    // sidecar's, else its input's) — or null: the file an Edit left is never computed (owner (H)).
    const written = facts.tool === 'Write' ? (typeof raw.content === 'string' ? raw.content
      : typeof ev._body === 'string' ? ev._body : null) : null;
    ev._fileState = { before: original, after: written };
  }
}

// D69 (c) (owner decision 2026-10-08): the "first error line" (`firstErrorLine`, its `ERR_LINE` patterns of what an error
// line reads like) is deleted with every consumer: a pattern list fitted to the outputs seen, deciding from an output's
// words which line is the error. A result is its recorded output, cut by position only (D68 P, T); a failure is what the
// recorder typed (an error flag, an exit code, a native status).

function shellWrites(cmd, cwd) {
  if (!cmd) return [];
  const text = String(cmd);
  const found = new Map();   // path -> {how, abs, heredoc?}, so `cat > f << EOF` is one write, not two
  const writes = new Map();  // path -> how many distinct operations in this command wrote it
  // Track the effective directory across `;`/`&&` parts: `D=/tmp/scratch; cd "$D"; touch a.txt`
  // writes a.txt in the scratch repo, not the project — read as the project's, such writes rendered
  // as blocking findings about a session that never touched the project outside its fence.
  // Conservative on purpose: external is only set when the cd target resolves to an ABSOLUTE
  // path outside cwd; anything unresolved stays internal (a wrong external flag hides a finding).
  const vars = new Map();
  for (const m of text.matchAll(/\b([A-Za-z_]\w*)=(\/[^\s;|&"']+)/g)) vars.set(m[1], m[2]);
  let dir = '';   // '' = the session cwd
  // W3c-11: the command is LEXED (`lexShell`), so a separator inside quotes no longer splits a
  // command and a heredoc's body is known for what it is. Its body lines are still scanned, one
  // line at a time, exactly as the whole command used to be — a heredoc feeding `bash` or
  // writing a script that is run next holds real writes. A command that does not lex falls back
  // to the line split it always had, with the line scan it always had, and records no body.
  const lexed = lexShell(text);
  // M33 (g2): the scan above stops a value at its first space. A lone quoted or escaped
  // assignment whose absolute value holds whitespace (`D="/tmp/my scratch"`) is read from its
  // lexed word instead; an expansion inside it stays unresolved.
  for (const part of lexed?.parts ?? []) {
    const exported = part.tokens?.length === 2 && part.tokens[0].word === 'export' && !part.tokens[0].quoted;
    const only = part.tokens?.length === 1 || exported ? part.tokens.at(-1) : null;
    const word = only && only.heredoc === undefined ? only.word : null;
    const assignment = typeof word === 'string' ? /^([A-Za-z_]\w*)=(\/[\s\S]*)$/.exec(word) : null;
    if (assignment && /\s/.test(assignment[2]) && !/[$`]/.test(assignment[2])) vars.set(assignment[1], assignment[2]);
  }
  // Newlines separate commands exactly like `;` — the live scratch-repo session used multiline
  // bash, and the cd context was lost at the split.
  // The same split as before, each piece with its offset in the command (`from`), so a scripted write is placed by the
  // directory in effect where it stands (`dirAt` below).
  const lines = (t, from = 0) => {
    const out = [];
    let at = 0;
    for (const m of t.matchAll(/\s*(?:&&|\|\||;|\n)\s*/g)) {
      out.push({ text: t.slice(at, m.index), from: from + at });
      at = m.index + m[0].length;
    }
    out.push({ text: t.slice(at), from: from + at });
    return out;
  };
  const parts = lexed ? lexed.parts.flatMap((p) => (p.tokens ? [p] : lines(p.text, p.from))) : lines(text);
  const placedAt = [];   // { from, dir }: the directory each part ran in, in source order
  for (const part of parts) {
    const t = part.text;
    placedAt.push({ from: part.from, dir });
    // `cd "$D"`, `cd "$D/sub"`, `cd /abs`, `cd rel` — the $VAR/suffix compound was the last live
    // escape (one scratch write per session stayed internal behind it).
    const cdVar = t.match(/^\s*cd\s+"?\$\{?([A-Za-z_]\w*)\}?([^\s"';|&]*)"?\s*$/);
    const cdLit = cdVar ? null : t.match(/^\s*cd\s+(['"]?)([^\s;|&"']+)\1\s*$/);
    // M33 (g2): a lexed `cd` whose one operand holds whitespace (a quoted or escaped directory,
    // such as a cwd with a space) is read from that word; the patterns above stop at the space.
    const spaced = cdVar || cdLit ? null : spacedCdOperand(part.tokens);
    const spacedVar = spaced !== null && /[$`]/.test(spaced)
      ? /^\$\{?([A-Za-z_]\w*)\}?([^$`]*)$/.exec(spaced) ?? [spaced, null, ''] : null;
    if (cdVar || cdLit || spaced !== null) {
      const variable = cdVar ?? spacedVar;
      if (variable && !vars.has(variable[1])) { dir = ''; continue; }   // unresolved: assume internal
      const target = variable ? vars.get(variable[1]) + (variable[2] ?? '') : cdLit ? cdLit[2] : spaced;
      if (target.startsWith('/')) dir = target;
      else if (target === '-') dir = '';
      // a relative cd keeps us where we were, as far as we can prove
      continue;
    }
    // Most-specific first: a heredoc also matches the redirect pattern, and reporting both
    // doubles the edit count for one command. The structured reads come before every regex.
    const hits = [];
    if (part.tokens) {
      const cat = catHeredoc(part.tokens);
      if (cat) hits.push({ p: cat.path, how: 'heredoc', heredoc: { index: cat.heredoc, word: cat.path,
        append: cat.append, delim: lexed.heredocs[cat.heredoc].delim } });
      for (const p of sedTargets(part.tokens)) hits.push({ p, how: 'sed -i' });
    }
    for (const { re, g, how } of part.tokens ? LEXED_FORMS : SHELL_WRITES) {
      const m = t.match(re);
      // Lane g3: in a lexed command a target that opens a quote it does not close was cut at a
      // space inside that quoted word (`"src/a.js b/c.md"` read as `"src/a.js`). It is no write of
      // its own; `spacedWriteTargets` reads the whole lexed word.
      if (m && part.tokens && /^['"]/.test(m[g]) && m[g].indexOf(m[g][0], 1) < 0) continue;
      if (m) hits.push({ p: m[g].replace(/^['"]|['"]$/g, ''), how });
    }
    if (part.tokens) hits.push(...spacedWriteTargets(part.tokens));
    const here = new Set();   // one command, one write per path, however many patterns saw it
    for (const { p, how, heredoc } of hits) {
      if (!SOURCE_EXT.test(p)) continue;
      const abs = p.startsWith('/') ? posix.normalize(p) : (dir ? posix.normalize(`${dir}/${p}`) : '');
      // D69 review (F7): a write is spelled by where it landed — its resolved absolute path when the command's `cd` placed
      // it (relative under the cwd, as recorded outside it) — never by its bare token: `cd /tmp/x && touch a.js` wrote
      // /tmp/x/a.js, not the project's `a.js`.
      const rel = shellSpelling(p, abs, cwd);
      if (here.has(rel)) continue;
      here.add(rel);
      writes.set(rel, (writes.get(rel) ?? 0) + 1);
      if (!found.has(rel)) found.set(rel, { how, abs: abs.startsWith('/') ? abs : null, ...(heredoc ? { heredoc } : {}) });
    }
  }
  // SCRIPTED writes: an inline python/node script piped through the shell writes files the
  // shell forms above never see — `open(p, 'w')` after `p = 'x.html'` was the exact shape that
  // hid a whole UI rewrite from the ledger and turned "update the ui" into a false unmet
  // (verified on this codebase's own session, 2026-09-02). The file APIs are formal syntax, so
  // the detection is code: literal paths, plus one-hop simple-variable resolution within the
  // same script text. Scanned over the WHOLE command (assignment and call live on different lines).
  const strVars = new Map();
  for (const m of text.matchAll(/\b([A-Za-z_]\w*)\s*=\s*(['"])([^'"\n]+\.\w{1,6})\2/g)) strVars.set(m[1], m[3]);
  const scriptForms = [
    { re: /\bopen\(\s*(['"])([^'"\n]+)\1\s*,\s*(['"])[wa]b?\3/g, lit: 2, how: 'script open(w)' },
    { re: /\bopen\(\s*([A-Za-z_]\w*)\s*,\s*(['"])[wa]b?\2/g, var: 1, how: 'script open(w)' },
    { re: /\bwriteFile(?:Sync)?\(\s*(['"])([^'"\n]+)\1/g, lit: 2, how: 'script writeFile' },
    { re: /\bwrite_text\(/g, skip: true },
  ];
  // A script runs in the directory its command ran in: a relative path it writes is resolved against the `cd` before
  // that command, exactly as the shell forms above resolve theirs (`dir`), never against the session's cwd when a `cd`
  // moved it. The directory at a script's offset is the one of the last part that starts at or before it.
  const dirAt = (offset) => {
    let best = null;
    for (const p of placedAt) if (typeof p.from === 'number' && p.from <= offset && (!best || p.from >= best.from)) best = p;
    return best ? best.dir : '';
  };
  for (const f of scriptForms) {
    if (f.skip) continue;
    for (const m of text.matchAll(f.re)) {
      const raw = f.lit ? m[f.lit] : strVars.get(m[f.var]);
      if (!raw || !SOURCE_EXT.test(raw)) continue;
      const at = raw.startsWith('/') ? '' : dirAt(m.index);
      const abs = at ? posix.normalize(`${at}/${raw}`) : '';
      const rel = abs ? shellSpelling(raw, abs, cwd) : relative(raw, cwd);
      writes.set(rel, (writes.get(rel) ?? 0) + 1);
      if (!found.has(rel)) found.set(rel, { how: f.how, abs: raw.startsWith('/') ? raw : abs || null });
    }
  }
  // A heredoc's body is the path's state only when the heredoc is the one write this command
  // made to it. Anything else — the same file then `sed -i`'d, two heredocs into it — leaves a
  // state the record does not hold, so the body is not claimed for it.
  return [...found].map(([path, v]) => ({ path, how: v.how, abs: v.abs,
    ...(v.heredoc && writes.get(path) === 1 ? { heredoc: v.heredoc } : {}) }));
}

const SHELL_PROGRAM = /^(?:bash|sh|zsh|dash|ksh)$/;
const SHELL_SCRIPT_FLAG = /^-[A-Za-z]*c[A-Za-z]*$/;

/** H1: why a zero exit status may not speak for every command of a command line (closed; `exitStatusGap`). */
export const EXIT_STATUS_GAPS = Object.freeze(['unreadable', 'substitution', 'sequence', 'or_list', 'pipeline',
  'background', 'negation', 'eval', 'nested_shell']);
const [UNREADABLE, SUBSTITUTION, SEQUENCE, OR_LIST, PIPELINE, BACKGROUND, NEGATION, EVAL, NESTED_SHELL] = EXIT_STATUS_GAPS;

/**
 * H1: does a zero exit status speak for EVERY command a command line ran? Shell grammar only, never a program's name.
 * Null when it does; else the first reason it does not (`EXIT_STATUS_GAPS`).
 *
 * A shell reports the status of the LAST command it ran: a pipeline's last stage (`npm test | tail -5` exits as `tail`
 * does), the last command of a `;` or newline sequence, whichever side of `||` ran last, a `&` job's launch, the outer
 * command around a command or process substitution (`echo $(make)`), and the inverse under `!`. Only commands joined
 * by `&&` alone — each runs only when the one before it exited 0 — share a zero status: so a zero exit (or the
 * harness's typed success verdict) proves every command passed only for a command line with no pipe, no `;` or
 * newline sequence, no `||`, no background job, no substitution and no `!`. A shell's script that the line itself
 * holds is read the same way, at most twice deep: the word after `bash|sh|zsh -c`, and the here-document body or
 * here-string word a shell reads on its stdin (`bash <<'EOF'`, `sh -s <<EOF`, `bash <<< '…'`). A shell given options
 * before `-c` (`bash -x -c`, `bash --norc -c`, `bash -o pipefail -c`) is not covered: which word is its script is not
 * read (fail closed). A shell given a script FILE (`bash run.sh`) is a program like any other. `eval` and anything the
 * lexer cannot read are not covered. A nonzero status needs none of this: a command line that exited nonzero failed,
 * whichever of its commands did.
 *
 * Status fact (owner decision 2026-10-06): the shell's own options, where the line itself sets them (`shellOptionsOf`).
 * With pipefail in effect (`set -o pipefail`, or `-o pipefail` inside a combined `set`) a pipeline covers its stages: it
 * exits 0 only when every stage did. With errexit in effect (`set -e`, `set -o errexit`, `set -eu…`) a `;` or newline
 * after a command covers it — but ONLY where the script provably runs at the top level of its own shell process
 * (`ownShell`): a shell ignores errexit for every command run while it evaluates the left side of an `&&` list or an
 * `if`/`while` test, and a harness may run the line in exactly such a place (Claude Code's Bash tool runs it as the left
 * of an `&&` on the user's shell; on zsh `set -e; false; echo x` there prints `x` and exits 0). So errexit is read for a
 * script the line itself hands to a fresh shell (`bash|sh|zsh -c`, a here-document or here-string a shell reads: a new
 * process the harness's wrapper cannot reach), and for the line itself only when the caller passes `ownShell`, a typed
 * per-recording fact (the harness recorded the line as the script of `[shell, -c|-lc, line]`: codex.js `ownShell`).
 * Errexit never covers a command before `||`, a command of an `&&` list followed by `;` or a newline (a failure of a
 * non-final member of an `&&` list does not stop the shell), a pipeline's earlier stages (pipefail does), `!`, a
 * substitution or a background job. Only what the line itself states counts, before the commands it covers, in this
 * shell (a nested shell's script starts with no options); anything uncertain leaves the line uncovered.
 */
export function exitStatusGap(cmd, { ownShell = false } = {}) {
  return statusGapOf(cmd, ownShell === true, 0);
}

function statusGapOf(cmd, ownShell, depth) {
  const lexed = lexShell(String(cmd ?? ''));
  if (!lexed || lexed.heredocs.some((doc) => !doc.terminated)) return UNREADABLE;
  if (lexed.substituted) return SUBSTITUTION;
  const parts = lexed.parts.filter((part) => Array.isArray(part.tokens) && part.tokens.length);
  if (!parts.length) return UNREADABLE;
  // A script handed to a fresh shell process runs at that process's top level: its own errexit is honoured.
  const nested = (script) => (depth >= 2 || typeof script !== 'string' ? NESTED_SHELL : statusGapOf(script, true, depth + 1));
  const options = shellOptionsOf(parts);
  for (let at = 0; at < parts.length; at++) {
    const { tokens, sep } = parts[at];
    if (at < parts.length - 1 && sep !== '&&') {
      if (sep === '||') return OR_LIST;
      // Errexit covers this separator only in a shell's own top level, and only for a command that is its own and-or
      // list: after `a && b;` a failure of `a` does not stop the shell. A `set` the line states is read whole
      // (`readSet`), so its own status is never at issue.
      if (!(ownShell && options[at].errexit && parts[at - 1]?.sep !== '&&' && parts[at - 1]?.sep !== '||'
        || options[at].set)) return SEQUENCE;
    }
    if (tokens.some((token) => token.op === '|' || token.op === '|&') && !options[at].pipefail) return PIPELINE;
    if (tokens.some((token) => token.op === '&')) return BACKGROUND;
    const head = tokens.find((token) => typeof token.word === 'string' && !/^[A-Za-z_][A-Za-z0-9_]*=/.test(token.word));
    if (head && !head.quoted && head.word === '!') return NEGATION;
    if (head && !head.quoted && head.word === 'eval') return EVAL;
    for (let k = 0; k < tokens.length; k++) {
      const word = tokens[k].word;
      if (typeof word !== 'string' || !SHELL_PROGRAM.test(word.slice(word.lastIndexOf('/') + 1))) continue;
      const flag = tokens[k + 1]?.word;
      const scriptFlag = (token) => typeof token?.word === 'string' && SHELL_SCRIPT_FLAG.test(token.word);
      if (scriptFlag(tokens[k + 1])) {
        if (k + 2 >= tokens.length) continue;   // `-c` as the line's last word: no script follows
        const inner = nested(tokens[k + 2].word);
        if (inner) return inner;
        continue;
      }
      // F2: an option before `-c` — the shell's options are not parsed (some take an argument), so the script word is
      // not known: fail closed.
      if (typeof flag === 'string' && /^[-+]/.test(flag) && tokens.slice(k + 2).some(scriptFlag)) return NESTED_SHELL;
      // F2: a script the shell reads on its stdin from this very line — a here-document's body, a here-string's word.
      for (let j = k + 1; j < tokens.length; j++) {
        const op = tokens[j].op;
        if (op !== '<<' && op !== '<<-' && op !== '<<<') continue;
        const next = tokens[j + 1];
        const inner = nested(op === '<<<' ? next?.word
          : Number.isInteger(next?.heredoc) ? lexed.heredocs[next.heredoc]?.body : undefined);
        if (inner) return inner;
      }
    }
  }
  return null;
}

/** H1: a zero exit status speaks for every command of the line (`exitStatusGap` names no reason). */
export const exitStatusCovers = (cmd, options) => exitStatusGap(cmd, options) === null;

// Status fact (review F1): the command events whose recording types the line as the script of its own shell process
// (`[shell, -c|-lc, line]`). Held beside the event, never in the ledger: no ledger byte moves for it.
const OWN_SHELL = new WeakSet();

/**
 * Status fact (owner decision 2026-10-06): a command event's outcome for a zero status (a typed exit 0, Claude Code's
 * typed completion verdict or task notification) — `passed` when it speaks for every command of the line, else
 * `unproven`, with the closed reason it does not (`exitStatusGap`, EXIT_STATUS_GAPS) recorded on the event as
 * `statusGap`. The zero status itself stays recorded where it always was: `exitCode` 0 with its source, or the verdict's
 * `statusSource`. A covered event carries no `statusGap`.
 */
function zeroStatusOutcome(ev) {
  const gap = exitStatusGap(ev.cmd, { ownShell: OWN_SHELL.has(ev) });
  if (gap === null) { delete ev.statusGap; return 'passed'; }
  ev.statusGap = gap;
  return 'unproven';
}

// Status fact: the shell options a `set` the line states may name, closed. `e` (errexit) and pipefail are the two that
// widen what a zero status covers; the others are known not to stop a command from running or to change what a status
// reports (nounset, xtrace, verbose, errtrace, functrace, noglob, noclobber). Any other letter or name — `-n` runs
// nothing, `-t` exits after one command, `-k`, `posix`, `onecmd` — leaves the line's options unknown (fail closed).
const SET_LETTERS = Object.freeze({ e: 'errexit', u: null, x: null, v: null, E: null, T: null, f: null, C: null });
const SET_NAMES = Object.freeze({ errexit: 'errexit', pipefail: 'pipefail', nounset: null, xtrace: null, verbose: null,
  errtrace: null, functrace: null, noglob: null, noclobber: null });
// A word that opens a compound command, or a group: a line holding one is not read for options at all (an `if`'s
// condition and a `while`'s test fail without stopping the shell; a group may run in a subshell).
const SHELL_RESERVED = new Set(['if', 'then', 'else', 'elif', 'fi', 'case', 'esac', 'for', 'select', 'while', 'until',
  'do', 'done', 'function', '{', '}', '[[', ']]', 'time', 'coproc', 'in']);
// A builtin that can change the shell's options or rewrite its exit status from where the line cannot show it: `trap`
// (an EXIT or ERR trap may `exit 0`), `source` and `.` (a sourced file may `set +e`), `eval` (its string may; zsh runs a
// pipeline's last stage in the shell itself), bash's `shopt -o` and zsh's `setopt`, `unsetopt` and `emulate` (each sets
// errexit or pipefail by another name), and `builtin`/`command`/`enable` and zsh's `noglob`/`nocorrect`, behind which a
// `set` is not read (review F2).
const OPTION_OPAQUE = new Set(['trap', 'source', '.', 'eval', 'shopt', 'setopt', 'unsetopt', 'emulate', 'builtin',
  'command', 'enable', 'noglob', 'nocorrect']);
// The operators that start a new command inside a part (a pipeline's stage, a background job's successor, a group);
// every other operator is a redirection, whose next token is its target word, never a command's head.
const COMMAND_STARTS = new Set(['|', '|&', '&', '(', ')']);
// A leading assignment (`X=1`, `X+=1`), quoted or not: never a command's head. Were it a quoted command word instead, the
// word after it is taken for the head, which reads the line less, never more.
const ASSIGNMENT_WORD = /^[A-Za-z_][A-Za-z0-9_]*\+?=/;
/** Status fact (review F2): a head the parsed line does not name literally — quoted or escaped (`\set`, `'set'`), or holding
 *  an expansion (`$s`, a glob, a brace, a tilde) — may be any command, `set` included. */
const uncertainHead = (token) => token.quoted || /[$`*?{}~]/.test(token.word) || token.word !== '[' && token.word.includes('[');

/**
 * Status fact (review F2): the head of every command in one part's tokens — the first word after its leading assignments
 * and redirections, at the part's start, after `|`, `|&`, `&`, `(` or `)`, and after a reserved word, `!` or an
 * OPTION_OPAQUE word (whose next word is a command's head too).
 */
function commandHeads(tokens) {
  const heads = [];
  let expect = true;
  for (let k = 0; k < tokens.length; k++) {
    const token = tokens[k];
    if (token.op !== undefined) {
      if (COMMAND_STARTS.has(token.op)) expect = true;
      else k++;   // a redirection: its target word is no head
      continue;
    }
    if (!expect || typeof token.word !== 'string' || ASSIGNMENT_WORD.test(token.word)) continue;
    heads.push(token);
    expect = !token.quoted && (SHELL_RESERVED.has(token.word) || OPTION_OPAQUE.has(token.word) || token.word === '!');
  }
  return heads;
}

/**
 * Status fact: one `set` command's option changes — `{ errexit?, pipefail? }`, each true (`-`) or false (`+`) — or null
 * when it is not read whole: a word that is not a plain literal (an expansion, a glob), an operator or redirection, an
 * assignment before it, or a letter or `-o` name outside SET_LETTERS / SET_NAMES. The first word that is not an option
 * (or `--`, `-`) ends the options: the rest are positional parameters.
 */
function readSet(tokens) {
  if (tokens[0]?.word !== 'set' || tokens[0].quoted) return null;
  if (tokens.some((token) => typeof token.word !== 'string' || /[$`*?[\]{}~]/.test(token.word))) return null;
  const words = tokens.map((token) => token.word);
  const changes = {};
  const apply = (name, on) => {
    if (!Object.hasOwn(SET_NAMES, name)) return false;
    if (SET_NAMES[name]) changes[SET_NAMES[name]] = on;
    return true;
  };
  for (let i = 1; i < words.length; i++) {
    const word = words[i];
    if (word === '--' || word === '-' || !/^[-+][A-Za-z]+$/.test(word)) break;
    const on = word[0] === '-';
    for (const letter of word.slice(1)) {
      if (letter === 'o') { if (!apply(words[++i], on)) return null; continue; }
      if (!Object.hasOwn(SET_LETTERS, letter)) return null;
      if (SET_LETTERS[letter]) changes[SET_LETTERS[letter]] = on;
    }
  }
  return changes;
}

/**
 * Status fact: the shell options in effect when each top-level part of a line runs — `[{ errexit, pipefail, set }]`,
 * `set` true for a part that is itself a `set` read whole. Read from the parsed line only: a `set` counts only as the
 * first word of a part (no assignment before it) that is outside every `(` … `)`, that starts its and-or list (after a
 * `;`, a newline or the line's start: after `a &&` it may not run) and that `readSet` reads whole. Fail closed, for the
 * rest of the line: every option is off after a `set` that does not count (at any other command's head, `commandHeads`:
 * behind an assignment or a redirection, after an operator), and for the whole line when it holds a compound command or
 * group (SHELL_RESERVED, a `(` or `)`), an OPTION_OPAQUE builtin at a command's head, or a head the line does not name
 * literally (`uncertainHead`: quoted, escaped or expanded — it may be `set`).
 */
function shellOptionsOf(parts) {
  const off = { errexit: false, pipefail: false, set: false };
  const opaque = parts.some(({ tokens }) => tokens.some((token) => token.op === '(' || token.op === ')')
    || commandHeads(tokens).some((token) => SHELL_RESERVED.has(token.word) || OPTION_OPAQUE.has(token.word)
      || uncertainHead(token)));
  if (opaque) return parts.map(() => off);
  let state = { errexit: false, pipefail: false };
  const out = [];
  for (let at = 0; at < parts.length; at++) {
    const { tokens } = parts[at];
    const startsList = at === 0 || ![ '&&', '||' ].includes(parts[at - 1].sep);
    const changes = startsList ? readSet(tokens) : null;
    out.push({ ...state, set: changes !== null });
    if (changes !== null) state = { ...state, ...changes };
    else if (commandHeads(tokens).some((token) => token.word === 'set')) state = { errexit: false, pipefail: false };
  }
  return out;
}

// This marker licenses only transfer of a *successful command's* typed exit-0
// receipt to its one directly written path. It says nothing about a changed
// diff, and a nonzero enclosing exit cannot certify that the write failed.
function shellWriteStatusEligible(cmd, cwd, writes) {
  if (writes.length !== 1) return false;
  const lexed = lexShell(cmd);
  if (!lexed?.simple || lexed.heredocs.some((doc) => !doc.terminated)) return false;
  const parts = lexed.parts.filter((part) => Array.isArray(part.tokens) && part.tokens.length);
  if (parts.length !== 1) return false;
  const tokens = parts[0].tokens;
  const head = tokens[0];
  if (typeof head?.word !== 'string' || head.quoted) return false;
  const write = writes[0];
  const pathMatches = (path) => typeof path === 'string'
    && shellSpelling(path, path.startsWith('/') ? posix.normalize(path) : '', cwd) === write.path;
  if (write.how === 'heredoc') {
    const cat = catHeredoc(tokens);
    return lexed.heredocs.length === 1 && cat !== null && pathMatches(cat.path);
  }
  if (write.how === 'sed -i') {
    // A simple substitution cannot execute sed's `e` command or hide a
    // second edit. Other sed programs remain observable writes without this
    // stronger status-transfer proof.
    if (!SED_PROGRAM.test(head.word) || tokens.length !== 4
      || tokens[1].word !== '-i' || typeof tokens[2].word !== 'string'
      || !/^s\/[^\/;\n]+\/[^\/;\n]*\/[gIp0-9]*$/.test(tokens[2].word)
      || sedTargets(tokens).length !== 1) return false;
    return pathMatches(tokens[3].word);
  }
  if (write.how === 'redirect') {
    if (!/(?:^|\/)(?:echo|printf)$/.test(head.word)) return false;
    const outputs = tokens.flatMap((token, index) =>
      ['>', '>>', '>|'].includes(token.op) ? [index] : []);
    if (outputs.length !== 1 || outputs[0] !== tokens.length - 2
      || tokens.some((token) => token.op && !['>', '>>', '>|'].includes(token.op))) return false;
    return pathMatches(tokens.at(-1)?.word);
  }
  return false;
}

/**
 * The heredoc bodies of one command, read from the command as recorded — keyed by the heredoc's position among the
 * command's operators, with what identifies it (target word, append, delimiter) so the caller pairs a body only with
 * the write it was detected as. D90 (owner decision 2026-10-15): the command is never masked, so neither is a body.
 */
function heredocBodies(cmd) {
  const bodies = new Map();
  const lexed = lexShell(cmd);
  if (!lexed) return bodies;
  for (const part of lexed.parts) {
    if (!part.tokens) continue;
    const cat = catHeredoc(part.tokens);
    const doc = cat ? lexed.heredocs[cat.heredoc] : null;
    // No terminating line: bash would read to the end, but the record does not say the command
    // was complete, so where the body ends is not known. Nothing is guessed.
    if (!doc?.terminated) continue;
    bodies.set(cat.heredoc, { word: cat.path, append: cat.append, delim: doc.delim,
      expanded: !doc.quoted, body: doc.body });
  }
  return bodies;
}

/**
 * `cat > path <<DELIM`, `cat >> path <<DELIM`, `cat <<DELIM > path` — a plain `cat` whose only
 * input is the heredoc and whose only output is one file. Any other word or operator (`cat -n`, a
 * file operand, a pipe, a second redirect) makes the file something other than the body, so the
 * form is not claimed. Returns { path, append, heredoc } or null.
 */
function catHeredoc(tokens) {
  const [head, ...rest] = tokens;
  if (head?.word !== 'cat' || head.quoted) return null;
  let out = null;
  let doc = null;
  for (let k = 0; k < rest.length; k++) {
    const t = rest[k];
    const next = rest[k + 1];
    if (t.op === '>' || t.op === '>>' || t.op === '>|') {
      if (out || next?.word === undefined || next.heredoc !== undefined) return null;
      out = { path: next.word, append: t.op === '>>' };
      k++;
    } else if (t.op === '<<' || t.op === '<<-') {
      if (doc !== null || next?.heredoc === undefined) return null;
      doc = next.heredoc;
      k++;
    } else return null;
  }
  return out && doc !== null && out.path ? { ...out, heredoc: doc } : null;
}

/**
 * The files a `sed -i` names, read from its words: `-i`, `-i ''` / `-i .bak` (BSD), `-i.bak` /
 * `-iSUFFIX` / `--in-place[=SUFFIX]` (GNU), any number of `-e`/`-f`/`--expression`, a script
 * whose quotes hold spaces or `;`, and every file operand after it. Without `-i`, sed writes
 * nothing it names (its redirect target is found by the redirect form). A `sed` inside a word
 * (quoted, or `xargs sed …` with no operands) names no file here.
 */
const SED_PROGRAM = /(?:^|\/)g?sed$/;   // `sed`, `/usr/bin/sed`, and GNU sed installed as `gsed`

/** M33 (g2): the one operand of a lexed `cd` when it holds whitespace (a quoted or escaped
 *  directory, which the line patterns stop at the space); otherwise null. */
function spacedCdOperand(tokens) {
  if (tokens?.length !== 2) return null;
  const [head, operand] = tokens;
  return head.word === 'cd' && !head.quoted && typeof operand.word === 'string'
    && operand.heredoc === undefined && /\s/.test(operand.word) ? operand.word : null;
}

/**
 * M33 (g2): the write targets the line patterns stop at a space — a quoted or escaped operand of a
 * `>`/`>>`/`>|` redirect, of `tee` (after an optional `-a`), of `curl -o` or of `wget -O` — read
 * from the lexed words. Only a word holding whitespace is returned: every other target is left to
 * the patterns, exactly as before, so no write is counted twice.
 */
function spacedWriteTargets(tokens) {
  const hits = [];
  const spaced = (k) => typeof tokens[k]?.word === 'string' && tokens[k].heredoc === undefined
    && /\s/.test(tokens[k].word) ? tokens[k].word : null;
  const program = (k, re) => typeof tokens[k]?.word === 'string' && !tokens[k].quoted && re.test(tokens[k].word);
  // The first option word of this command (up to the next operator) that matches `option`.
  const optionAfter = (k, option) => {
    for (let j = k + 1; j < tokens.length && tokens[j].word !== undefined; j++)
      if (!tokens[j].quoted && option.test(tokens[j].word)) return j;
    return -1;
  };
  for (let k = 0; k < tokens.length; k++) {
    let at = -1; let how = null;
    if (['>', '>>', '>|'].includes(tokens[k].op)) { at = k + 1; how = 'redirect'; }
    else if (program(k, /(?:^|\/)tee$/)) { at = k + 1 + Number(tokens[k + 1]?.word === '-a'); how = 'tee'; }
    else if (program(k, /(?:^|\/)curl$/)) { const o = optionAfter(k, /^-[a-zA-Z]*o$/); if (o >= 0) { at = o + 1; how = 'curl -o'; } }
    else if (program(k, /(?:^|\/)wget$/)) { const o = optionAfter(k, /^-O$/); if (o >= 0) { at = o + 1; how = 'wget -O'; } }
    const p = at >= 0 ? spaced(at) : null;
    if (p !== null) hits.push({ p, how });
  }
  return hits;
}

function sedTargets(tokens) {
  const files = [];
  for (let k = 0; k < tokens.length; k++) {
    if (typeof tokens[k].word !== 'string' || tokens[k].quoted || !SED_PROGRAM.test(tokens[k].word)) continue;
    let inPlace = false;
    let script = false;
    let options = true;
    const operands = [];
    let j = k + 1;
    for (; j < tokens.length; j++) {
      const w = tokens[j].word;
      if (w === undefined) break;                          // an operator ends the command
      if (options && w === '--') { options = false; continue; }
      if (options && w.startsWith('--')) {
        if (/^--in-place(=|$)/.test(w)) inPlace = true;
        else if (w === '--expression' || w === '--file') { script = true; j++; }
        else if (/^--(?:expression|file)=/.test(w)) script = true;
        else if (w === '--line-length') j++;
        continue;
      }
      if (options && w.length > 1 && w[0] === '-') {
        for (let x = 1; x < w.length; x++) {
          const ch = w[x];
          if (ch === 'i') {
            inPlace = true;
            // BSD takes the suffix as the NEXT word: '' or '.bak'. GNU takes the rest of this one.
            const next = tokens[j + 1];
            if (x === w.length - 1 && next?.word !== undefined && (next.word === '' || /^\.[\w.~-]*$/.test(next.word))) j++;
            break;
          }
          if (ch === 'e' || ch === 'f' || ch === 'l') {   // these take an argument: the rest, or the next word
            if (ch !== 'l') script = true;
            if (x === w.length - 1) j++;
            break;
          }
        }
        continue;
      }
      if (!script) { script = true; continue; }            // the first operand is the script
      operands.push(w);
    }
    if (inPlace) files.push(...operands);
    k = j;
  }
  return files;
}

const LEX_FAILED = Symbol('lex failed');

/**
 * A shell LEXER for write detection — never an interpreter: nothing is expanded, run or resolved.
 * It knows what the old `&&`/`;`/newline split did not: a separator inside quotes does not end a
 * command (`sed -i 's/a/b/; s/c/d/' f`), a backslash-newline continues one, a `#` comment is not a
 * command, and a heredoc's body is the text between its operator's line and its delimiter line —
 * input to the command, and the exact bytes a `cat > path <<'EOF'` put in the file.
 *
 * Returns null when the command does not lex (an unterminated quote or substitution, a heredoc
 * operator with no delimiter word). Otherwise { parts, heredocs }:
 *   parts    — in source order: each simple command as { text, tokens, heredocs } (its source
 *              text without comments or heredoc bodies; words with quotes removed, and operators),
 *              plus one { text } per heredoc body line, which the caller scans as it always did;
 *   heredocs — in operator order: { delim, quoted, strip, body, terminated }. `body` is exactly
 *              the lines between the operator's line and the delimiter line (tabs stripped for
 *              `<<-`, as bash does), or null when no delimiter line ever came.
 */
function lexShell(src) {
  const s = String(src);
  const heredocs = [];
  const cuts = [];      // [from, to): source that is not command text (bodies, comments, `\`+newline)
  const parts = [];
  let simple = true;
  let substituted = false;   // a command or process substitution: a command whose status no exit code reports
  const fail = () => { throw LEX_FAILED; };

  const textOf = (from, to) => {
    let t = '';
    let at = from;
    for (const [a, b] of cuts) {
      if (b <= at || a >= to) continue;
      if (a > at) t += s.slice(at, a);
      t += ' ';
      at = b;
    }
    return t + s.slice(at, to);
  };

  // Heredoc bodies start after the newline that ends their operator's line, one after another.
  const readBodies = (i, pending) => {
    for (const h of pending) {
      const from = i;
      const kept = [];
      while (i < s.length) {
        const nl = s.indexOf('\n', i);
        const stop = nl < 0 ? s.length : nl;
        const line = s.slice(i, stop);
        const lineFrom = i;
        i = nl < 0 ? s.length : nl + 1;
        const bare = h.strip ? line.replace(/^\t+/, '') : line;
        if (bare === h.delim) { h.terminated = true; break; }
        kept.push(nl < 0 ? bare : `${bare}\n`);
        parts.push({ text: line, from: lineFrom });
      }
      if (h.terminated) h.body = kept.join('');
      cuts.push([from, i]);
    }
    return i;
  };

  // `…` — a backquoted substitution, scanned to its closing backquote.
  const backquote = (i) => {
    substituted = true;
    for (let j = i + 1; j < s.length; j++) {
      if (s[j] === '\\') { j++; continue; }
      if (s[j] === '`') return j + 1;
    }
    return fail();
  };
  // `$…` in any of its forms; returns the index after it. A bare `$` is one character.
  const dollar = (i, pending) => {
    const c = s[i + 1];
    if (c === '(' && s[i + 2] === '(') {                  // $(( arithmetic ))
      let depth = 0;
      for (let j = i + 1; j < s.length; j++) {
        if (s[j] === '(') depth++;
        else if (s[j] === ')' && --depth === 0) return j + 1;
      }
      return fail();
    }
    if (c === '(') { substituted = true; return region(i + 2, pending); }   // $( command substitution )
    if (c === '{') {                                      // ${ parameter }
      let depth = 0;
      for (let j = i + 1; j < s.length; j++) {
        if (s[j] === '\\') { j++; continue; }
        if (s[j] === '$' && s[j + 1] === '(' || s[j] === '`') substituted = true;
        if (s[j] === '{') depth++;
        else if (s[j] === '}' && --depth === 0) return j + 1;
      }
      return fail();
    }
    return i + 1;
  };
  // "…": returns { end, value } — backslash keeps its meaning only before $ ` " \ and newline.
  const dquote = (i, pending) => {
    let value = '';
    for (let j = i + 1; j < s.length;) {
      const c = s[j];
      if (c === '"') return { end: j + 1, value };
      if (c === '\\') {
        const n = s[j + 1] ?? '';
        value += '$`"\\\n'.includes(n) ? (n === '\n' ? '' : n) : `\\${n}`;
        j += 2;
        continue;
      }
      const e = c === '$' ? dollar(j, pending) : c === '`' ? backquote(j) : j + 1;
      if (c === '$' || c === '`') simple = false;
      value += s.slice(j, e);
      j = e;
    }
    return fail();
  };
  // The word after `<<`: quoting anywhere in it means the body is taken literally.
  const delimiter = (i) => {
    let word = '';
    let quoted = false;
    while (i < s.length && !/[\s;&|<>()]/.test(s[i])) {
      const c = s[i];
      if (c === "'" || c === '"') {
        const e = s.indexOf(c, i + 1);
        if (e < 0) fail();
        word += s.slice(i + 1, e);
        quoted = true;
        i = e + 1;
      } else if (c === '\\') { word += s[i + 1] ?? ''; quoted = true; i += 2; }
      else { word += c; i++; }
    }
    if (!word) fail();
    return { word, quoted, end: i };
  };

  /**
   * Lex from `start`. At top level (`outer` undefined) every simple command becomes a part; inside
   * a `$( … )` the region ends at its closing `)`, its commands stay inside the enclosing word, and
   * any heredoc whose operator line had not ended yet is handed back to the enclosing region.
   */
  function region(start, outer) {
    let i = start;
    let part = null;
    let word = null;
    let pending = [];
    let depth = 0;
    const open = () => (part ??= { start: i, tokens: [], heredocs: [] });
    const flush = () => { if (word) { open().tokens.push(word); word = null; } };
    const w = () => { open(); return (word ??= { word: '', quoted: false }); };
    const op = (o) => { flush(); open().tokens.push({ op: o }); i += o.length; };
    // `sep`: what ended a top-level simple command — `&&`, `||`, `;` or a newline — or null at the end of the text.
    const end = (at, sep = null) => {
      flush();
      if (part && !outer && part.tokens.length)
        parts.push({ text: textOf(part.start, at), tokens: part.tokens, heredocs: part.heredocs, sep,
          from: part.start });
      part = null;
    };
    while (i < s.length) {
      const c = s[i];
      if (c === '\\') {
        if (s[i + 1] === '\n') { cuts.push([i, i + 2]); i += 2; continue; }   // a continued line
        const x = w(); x.word += s[i + 1] ?? ''; x.quoted = true; i += 2; continue;
      }
      if (c === "'") {
        const e = s.indexOf("'", i + 1);
        if (e < 0) fail();
        const x = w(); x.word += s.slice(i + 1, e); x.quoted = true; i = e + 1; continue;
      }
      if (c === '$' && s[i + 1] === "'") {                // $'…' ANSI-C quoting
        simple = false;
        let e = -1;
        for (let j = i + 2; j < s.length; j++) { if (s[j] === '\\') { j++; continue; } if (s[j] === "'") { e = j; break; } }
        if (e < 0) fail();
        const x = w(); x.word += s.slice(i + 2, e); x.quoted = true; i = e + 1; continue;
      }
      if (c === '"') {
        const r = dquote(i, pending);
        const x = w(); x.word += r.value; x.quoted = true; i = r.end; continue;
      }
      if (c === '$' || c === '`') {
        simple = false;
        const e = c === '$' ? dollar(i, pending) : backquote(i);
        w().word += s.slice(i, e); i = e; continue;
      }
      if (c === '#' && !word) {                           // a comment runs to the end of its line
        const nl = s.indexOf('\n', i);
        const e = nl < 0 ? s.length : nl;
        cuts.push([i, e]); i = e; continue;
      }
      if (c === ' ' || c === '\t' || c === '\r') { flush(); i++; continue; }
      if (c === '\n') {
        if (!pending.length && part?.tokens?.length && s.slice(i + 1).trim()) simple = false;
        end(i, '\n'); i++;
        if (pending.length) { i = readBodies(i, pending); pending = []; }
        continue;
      }
      if (c === ';') { simple = false; end(i, ';'); i++; continue; }
      if (c === '&') {
        simple = false;
        if (s[i + 1] === '&') { end(i, '&&'); i += 2; continue; }
        op(s[i + 1] === '>' ? (s[i + 2] === '>' ? '&>>' : '&>') : '&'); continue;
      }
      if (c === '|') {
        simple = false;
        if (s[i + 1] === '|') { end(i, '||'); i += 2; continue; }
        op(s[i + 1] === '&' ? '|&' : '|'); continue;
      }
      if (c === '<' || c === '>') {
        if (s[i + 1] === '(') {                          // <( … ) >( … ) process substitution
          simple = false;
          substituted = true;
          const e = region(i + 2, pending);
          w().word += s.slice(i, e); i = e; continue;
        }
        // A file-descriptor number glued to the operator (`2>`, `2>&1`) is not a word.
        if (word && !word.quoted && /^\d+$/.test(word.word) && /\d/.test(s[i - 1])) word = null;
        if (s.startsWith('<<<', i)) { op('<<<'); continue; }
        if (s.startsWith('<<', i)) {
          const strip = s[i + 2] === '-';
          op(strip ? '<<-' : '<<');
          while (s[i] === ' ' || s[i] === '\t') i++;
          const d = delimiter(i);
          const h = { delim: d.word, quoted: d.quoted, strip, body: null, terminated: false };
          heredocs.push(h);
          pending.push(h);
          open().heredocs.push(heredocs.length - 1);
          part.tokens.push({ word: d.word, quoted: d.quoted, heredoc: heredocs.length - 1 });
          i = d.end;
          continue;
        }
        const two = s.slice(i, i + 2);
        op(['>>', '>&', '>|', '<&', '<>'].includes(two) ? two : c); continue;
      }
      if (c === '(') { simple = false; depth++; op('('); continue; }
      if (c === ')') {
        simple = false;
        if (outer && depth === 0) { end(i); outer.push(...pending); return i + 1; }
        depth = Math.max(0, depth - 1); op(')'); continue;
      }
      w().word += c; i++;
    }
    if (outer) fail();                                    // a `$(` that never closed
    end(i);
    return i;
  }

  try {
    region(0, undefined);
  } catch (e) {
    if (e === LEX_FAILED) return null;
    throw e;
  }
  if (heredocs.some((doc) => !doc.quoted && /[$`]/.test(doc.body ?? ''))) simple = false;
  // An unquoted here-document body is expanded, so a substitution in it runs (`cat <<EOF` with `$(date)` inside).
  if (heredocs.some((doc) => !doc.quoted && /\$\(|`/.test(doc.body ?? ''))) substituted = true;
  return { parts, heredocs, simple, substituted };
}

function stringifyField(v) {
  if (v == null) return '';
  if (typeof v === 'string') return v;
  try {
    return JSON.stringify(v);
  } catch {
    return '';
  }
}

/**
 * M33 R. A MultiEdit's diffs joined within the event's diff budget by WHOLE diffs: the first, then the next ones in
 * order while they fit, then a note counting the ones left out. Each diff is already within the budget (diff.js
 * `budgetDiff`), so the first always fits. (They used to be joined and cut at 1,400 characters, mid-line, before
 * redaction.) D69 (c): a diff has no computed hunk header, so its length is its shown length.
 */
function joinDiffs(diffs) {
  const kept = [diffs[0]];
  let used = diffs[0].length;
  let i = 1;
  for (; i < diffs.length; i++) {
    const next = used + 3 + diffs[i].length;
    if (next > DIFF_BUDGET) break;
    kept.push(diffs[i]);
    used = next;
  }
  const joined = kept.join('\n…\n');
  return { text: i < diffs.length ? `${joined}\n[… ${diffs.length - i} more edit diff(s) elided …]` : joined, kept: i };
}

// Relative file-tool paths that walk above their working directory are never treated as
// project evidence. This check is lexical so it also holds when the recording has no cwd.
function escapesRelativeRoot(path) {
  let depth = 0;
  for (const part of path.split(/[\\/]/)) {
    if (part === '..') depth--;
    else if (part && part !== '.') depth++;
    if (depth < 0) return true;
  }
  return false;
}

/** How a shell write is spelled (`shellWrites`): by its resolved absolute path `abs` when it has one, else its token. */
const shellSpelling = (token, abs, cwd) => (abs ? relative(abs, cwd) : relative(token, cwd));

/** Repo-relative under the recorder's working directory, as recorded outside it (before.js `spelledPath`; D69 review
 *  F7: by whole path segments, and an outside absolute path keeps its `/`); it must survive a cwd containing spaces.
 *  No `$HOME` abbreviation: an environment read in a deterministic package is the machine leaking into a hashed
 *  structure whether or not it currently fires (F9). */
export function relative(p, cwd) {
  return spelledPath(p, cwd);
}

// Local re-exports so this module can be tested without importing records.js internals.
import { attachBefore, homeFolderPath, spelledPath, within, editText, unwrapReadResult, stripLineNumbers } from './before.js';
// D69 (b): the harness home folders' rule (before.js); re-exported for its readers.
export { harnessHomePath, recordingHome } from './before.js';
import { recordedHunks, carriedHunks, commandClassOf, codexCommandTool, bashEditDiffFacts, claudeSidecarFacts,
  claudeDenialFacts }
  from './recorded.js';
// The attached file's bound (redact/index.js applies it to the text this module keeps whole). Deterministic and
// dependency-free like this package; it imports nothing back.
import { ATTACHED_CAP } from '../../redact/index.js';
import { textOf as text, toolUsesOf as toolUses,
  toolResultsOf as toolResults, visibleToolContent, QUEUED_PROMPT_RECORD, ATTACHED_RECORD, PROJECT_INSTRUCTIONS_RECORD,
  EDITED_FILE_RECORD, interjectionWordsOf, claudeDriftedTurn,
  humanWordsOf, humanNonTextOf, NONTEXT_BLOCK_TYPES, ensureClaudeLabels,
  recordedVersionOrder, claudeSessionType, SESSION_TYPES } from './records.js';
import { LABELS, LABEL_BASIS, MARKERS, POSITIONED_GAPS, RECORDER_CENSUS_REASONS, opensTurn, humanPart, partsOf }
  from './labels.js';
import { claudeNotificationCarrier } from './harness-context.js';
import { rowIdentity, callIdentity, derivedIdentity, IDENTITY_SUBS } from './event-identity.js';
// L1 session type: moved to records.js with the M34 labels (the Claude labeller reads it); re-exported here.
export { claudeSessionType, SESSION_TYPES, CLAUDE_SESSION_TYPE, CLAUDE_HOST_ORIGIN_RECORDER } from './records.js';
