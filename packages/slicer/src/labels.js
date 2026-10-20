// M34 slice-time labels (C-02 "Slice-time labels"): the closed vocabularies every
// record of a session is labelled with, once, at slicing, from the recording's own structure — never from its wording.
//
// One constants file for the label, marker, basis, lineage and gap vocabularies, so every reader decides by the same
// words and each basis and gap stays countable (a project rule: reason strings are a closed vocabulary in one constants file).
// The labelling itself is done by one function per recorder, in that recorder's reader: Claude Code's in records.js
// (`claudeLabeller`), Codex's in codex.js (`labelCodexRecords`), Cursor's in cursor.js. Nothing downstream re-decides a
// label: every consumer reads `rec.label`, `rec.markers` and `rec.parts` through the helpers below.
//
// Pure: no I/O, no clock, no model.

/** The one label a record (or, where the recorder splits a record into content blocks, each block) carries. */
export const LABELS = Object.freeze({
  /** Words a human typed, submitted or chose — or, in a helper, the parent agent's brief and messages to it. */
  human: 'human',
  /** Text the harness wrote: recorder flags, system rows, attachments, synthetic rows, untyped notices. */
  harness: 'harness',
  /** The agent's visible message (its commentary). Private reasoning is never labelled (`COUNT_KEYS.private`). */
  thought: 'thought',
  /** A tool call. */
  action: 'action',
  /** A tool result, or a background task's notification. */
  observation: 'observation',
  /** A message from another agent (a teammate or coordinator) that is not this agent's parent. */
  peer: 'peer',
});
const LABEL_SET = new Set(Object.values(LABELS));

/** What a label can carry beside it. Closed; a record carries each at most once, in this order. */
export const MARKERS = Object.freeze({
  /** A human message submitted while the agent worked. */
  queued: 'queued',
  /** The human's answer to the agent's question (AskUserQuestion, Codex request_user_input). */
  answer: 'answer',
  /** The human's refusal of a tool call, typed by the recorder (`toolDenialKind: user-rejected`). */
  refusal: 'refusal',
  /** A slash command the human ran whose prompt reached the agent. */
  command: 'command',
  /** A file or directory the human attached (an @-mention). */
  attached: 'attached',
  /** The first human message after a typed interruption (Codex `turn_aborted`). */
  afterInterrupt: 'after_interrupt',
  /** A compaction boundary or the summary the recorder wrote for it. */
  compaction: 'compaction',
});
const MARKER_ORDER = Object.values(MARKERS);

/** Whether a record is the recording's own top-level agent or a helper (sub-agent) of another. */
export const LINEAGE_ROLES = Object.freeze({ root: 'root', helper: 'helper' });

/**
 * Why a record carries its label: the recorder structure it was read from. Closed, so each basis can be counted.
 * It generalises H2's `HUMAN_TURN_BASIS` (deleted with the role guessers it fed).
 */
export const LABEL_BASIS = Object.freeze({
  // ---- Claude Code, recorder 2.1.219 and later (and the typed fields of earlier ones) ----
  /** `origin.kind: human` — the host declared the submission a human's. */
  originHuman: 'origin_human',
  /** `promptSource` typed, queued or suggestion_accepted — the recorder's own interactive prompt (no host origin). */
  promptSourceHuman: 'prompt_source_human',
  /** The first prompt of an SDK run (`parentUuid` null, `promptSource: sdk`, no origin, not meta): submitted by a
   *  script, which stands where the human does. */
  scriptFirstPrompt: 'script_first_prompt',
  /** A helper's own recording: its brief and its parent's later messages (`isSidechain`, string content, or a
   *  coordinator origin). */
  fromParentAgent: 'from_parent_agent',
  /** `origin.kind: peer` (or a coordinator outside a helper): another agent's message. */
  originPeer: 'origin_peer',
  /** An `origin` of a kind outside the closed set: unlabelled (`LABEL_GAPS.originUnknown`). */
  originOther: 'origin_other',
  /** `origin.kind: task-notification`, or a queued task-notification attachment: a background task reported in. */
  taskNotification: 'task_notification',
  /** A `queued_command` attachment of mode `prompt` with a human origin. */
  queuedPrompt: 'queued_prompt',
  /** A `file`, `directory` or `pdf_reference` attachment on the main thread whose recorded `parentUuid` chain, through
   *  attachment rows, reaches a row labelled `human` (the prompt it was submitted with, or a queued prompt): an
   *  @-mention. Any other such attachment (a file restored after a compaction, one attached mid-turn) is harness. */
  attachedFile: 'attached_file',
  /** An AskUserQuestion result whose typed sidecar records the human's answers. */
  askAnswer: 'ask_answer',
  /** A tool result the recorder typed `toolDenialKind: user-rejected`, in a session a human submitted to. */
  userRejected: 'user_rejected',
  /** A prompt command's invocation row: `origin: human`, or (2.1.255 and later) `isMeta` whose text is only the
   *  recorder's own command elements. */
  promptCommand: 'prompt_command',
  /** `isMeta` — the recorder marks the row as the harness's own. */
  recorderMeta: 'recorder_meta',
  /** `sourceToolUseID` — a row a tool call produced (a skill's expansion). */
  recorderToolRow: 'recorder_tool_row',
  /** `isCompactSummary` — the summary written for a compaction. */
  compactSummary: 'compact_summary',
  /** A `compact_boundary` system row, or any recorder's compaction mark. */
  compactBoundary: 'compact_boundary',
  /** Any other `system` row. */
  systemRow: 'system_row',
  /** Any other attachment row (reminders, listings, hook output, …). */
  attachmentRow: 'attachment_row',
  /** An assistant row the recorder wrote itself (`model: <synthetic>`, `isApiErrorMessage`). */
  syntheticAssistant: 'synthetic_assistant',
  /** A user row of a modern recorder with no origin, no flag and text that is only top-level elements: a local
   *  command's own rows. */
  untypedElements: 'untyped_elements',
  /** D120: a row the recorder chained between its own local-command caveat (an `isMeta` row that is only its
   *  `local-command-caveat` element) and that command's typed output (a `system` row of subtype `local_command`): a
   *  command the person ran in the harness itself, never a message to the agent, whatever its own fields say. */
  localCommand: 'local_command',
  /** Any other user row of a modern recorder with no origin and no flag — where Claude Code writes its interruption
   *  notice, which it does not type (`LABEL_GAPS.interruptUntyped`). Its words are never read. */
  untypedUserRow: 'untyped_user_row',
  /** The declared legacy fallback (a recorder before 2.1.219, or a row with no plain version; a Codex rollout with no
   *  typed `UserMessage` channel), counted under `LABEL_GAPS.legacyRecorder` (every Claude row it labels; each Codex
   *  message it sets aside). */
  legacyFallback: 'legacy_fallback',
  // ---- every recorder ----
  /** A visible assistant text block. */
  assistantText: 'assistant_text',
  /** A tool call block. */
  toolUse: 'tool_use',
  /** A tool result block. */
  toolResult: 'tool_result',
  // ---- Codex ----
  /** A `role=user` message a typed `UserMessage` item of the rollout's own thread names. */
  codexUserMessage: 'codex_user_message',
  /** A `role=user` message (or a block of one) the typed channel covers but names no item for. */
  codexContext: 'codex_context',
  /** An inter-agent message from this helper's parent thread. */
  codexParentMessage: 'codex_parent_message',
  /** An inter-agent message from a descendant of this thread (a helper's report). */
  codexChildReport: 'codex_child_report',
  /** A developer or system message: harness the model was shown. */
  codexDeveloper: 'codex_developer',
  /** A typed `turn_aborted` event. */
  codexTurnAborted: 'codex_turn_aborted',
  // ---- Cursor ----
  /** A Cursor `user` row's text (Cursor types no other human channel). */
  cursorUserRole: 'cursor_user_role',
  /** A Cursor user text block the reader's strip of Cursor's own scaffolding (IDE tags, timestamps) left blank. */
  cursorScaffolding: 'cursor_scaffolding',
  /** A row the Cursor reader itself writes for its degraded mode (no recorded output). */
  readerCompatibility: 'reader_compatibility',
});

/**
 * Why a record has no label (`label: null`), or why a session's labels are only as good as a declared fallback. Closed;
 * each is counted in the ledger (`capture.labelGaps`) and the evidence adapter declares each it does not already
 * declare by another gap (sonah-ledger.js `LABEL_GAP_NOTES`, re-declared there and held equal by a test).
 */
export const LABEL_GAPS = Object.freeze({
  /** A content block of a type no rule labels (null label). Already declared by the commentary/action capture. */
  unknownBlock: 'unknown_block',
  /** A row of a shape no rule labels (null label). Already declared by the reader's unclassified-row count. */
  unknownRow: 'unknown_row',
  /** A user row whose origin kind is outside the closed set (null label). */
  originUnknown: 'origin_unknown',
  /** Rows the declared legacy fallback labelled (a recorder that types no human channel): a row it set aside as harness
   *  could hold a human's words, and one it read as the human's is not proven to be (a scheduled prompt and a typed one
   *  look alike there). M34 labels review (F6): on Claude Code every row the fallback labels is counted, whichever way
   *  it read it (the spec's "counted under one closed gap"); a Codex rollout's fallback (M5, kept) counts each message
   *  it sets aside. */
  legacyRecorder: 'legacy_recorder',
  /** Untyped rows of a recorder that does not type its interruption notice: interruptions are not typed there. */
  interruptUntyped: 'interrupt_untyped',
  /** Prompt commands whose arguments the recorder did not record. */
  commandArgsUnrecorded: 'command_args_unrecorded',
  /** Background-task notifications whose carried call id names a call the recording does not hold (none it recorded
   *  before the notification). Owner decision 2026-10-07: a notification that carries no call id is an observation with
   *  no link and declares no gap. */
  notificationUnmatched: 'notification_unmatched',
  /** Questions to the human whose answer the recording does not carry. */
  answerUnrecorded: 'answer_unrecorded',
});
const GAP_SET = new Set(Object.values(LABEL_GAPS));

/**
 * D99 (F1 guard; extends LABEL_GAPS and `notification_unmatched`): the recorder census. Each record of a recorder fact
 * that one reader recognised and another could not read is counted once, under one closed reason, with the recorder
 * version of its row (recorder-census.js `recorderCensusOf`). Recorders change their record shapes between releases; a
 * count by reason and version shows a new shape on the day it is first recorded, instead of a loss no one sees. The
 * census is a side channel for the run record (only a caller that asks receives it), so no ledger byte moves for it;
 * only an end that it leaves unread (`end_unread_*`, events.js BACKGROUND_ENDS `unread`) changes a ledger, and the
 * evidence adapter declares that as a gap. Closed, so each reason's rate stays computable.
 */
export const RECORDER_CENSUS_REASONS = Object.freeze({
  // ---- a Claude row the labeller labels a task notification that the status join does not type, by the first test
  //      of the join it fails (events.js `claudeTaskNotification`); every such row has exactly one ----
  /** Its text is not one `<task-notification>` block, or a header element is recorded more than once. */
  notificationUnparsed: 'notification_unparsed',
  /** Its header carries no call id (`<tool-use-id>`) of an id's shape. */
  notificationNoCallId: 'notification_no_call_id',
  /** Its header carries no task id (`<task-id>`) of an id's shape. */
  notificationNoTaskId: 'notification_no_task_id',
  /** Its header carries no status, or one outside the closed set (events.js TASK_NOTIFICATION_STATUSES). */
  notificationStatusUnknown: 'notification_status_unknown',
  /** A Claude row the labeller and the status join's own reading (events.js `taskNotificationRead`) disagree on: one
   *  takes it for a task notification, the other not. Counted once, under this reason only. Both call the one carrier
   *  rule (harness-context.js `claudeNotificationCarrier`), so none is expected; it is counted so that one would show. */
  readerDisagreement: 'reader_disagreement',
  /** A labelled task notification whose origin carries a key beside its kind that no known recorder writes
   *  (harness-context.js NOTIFICATION_ORIGIN_KEYS): accepted (D98), and logged by its name (`key`) and version. */
  originUnknownKeys: 'origin_unknown_keys',
  // ---- a Claude Bash result that records a background task id and registers no launch ----
  /** Its sidecar is not the known shape (a key or a type the reader does not know); each key it does not know is
   *  logged by its name (`key`). */
  sidecarUnknownKeys: 'sidecar_unknown_keys',
  /** Its visible result does not name the typed id as a token of its own (events.js `resultNamesTypedId`). */
  launchTextLacksId: 'launch_text_lacks_id',
  // ---- a background run (a Bash launch, a Workflow or an Agent with no receipt) whose end code could not read, and
  //      could not prove absent (background-ends.js), by the first test that failed ----
  /** A notification is linked to it (its `notified` count), and none typed its end. */
  endUnreadLinked: 'end_unread_linked',
  /** Its task id is in a later row of the lineage that the agent did not write. */
  endUnreadMentioned: 'end_unread_mentioned',
  /** Its task id is in a row before its launch, so no search for it can prove an absence. */
  endUnreadBefore: 'end_unread_before',
  /** Its task id is not of an id's shape, so no verbatim search for it is sound. */
  endUnreadIdUnsearchable: 'end_unread_id_unsearchable',
  /** A file of the lineage could not be read again for the search. */
  endUnreadScanFailed: 'end_unread_scan_failed',
  // ---- Codex ----
  /** A Codex row of a shape its reader does not know (each counted `unsupported` row), by its carrier
   *  (CODEX_SHAPE_CARRIERS). */
  codexShapeMiss: 'codex_shape_miss',
});
/** D99 (F1 guard): a recorder key the census logs by its name, when it has a key's shape; any other is counted with no
 *  name. */
export const CENSUS_KEY_SHAPE = /^[A-Za-z_$][A-Za-z0-9_$.-]{0,63}$/;
/** D99 (F1 guard): the Codex carriers a shape miss is counted by — the row type or item type each strict reader of
 *  codex.js reads. Closed. */
export const CODEX_SHAPE_CARRIERS = Object.freeze(['row_type', 'event_msg', 'turn_aborted', 'item_completed',
  'mcp_tool_call', 'web_search', 'file_change', 'command_execution', 'patch_apply_end', 'response_item',
  'inter_agent_message', 'message', 'function_call', 'function_call_output']);
/** D99: the kinds of background run whose end the absence search reads (events.js `backgroundRunsOf`): a Bash command
 *  run in the background, a Workflow run, a background Agent. An `end_unread_*` census entry names its run's kind, so
 *  the link-conservation identity over Bash launches is computable apart from Workflow and Agent runs. Closed. */
export const BACKGROUND_RUN_KINDS = Object.freeze(['bash', 'workflow', 'agent']);
/** D99: the census's `end_unread_*` reasons, in the order background-ends.js tests them. */
export const END_UNREAD_REASONS = Object.freeze([RECORDER_CENSUS_REASONS.endUnreadLinked,
  RECORDER_CENSUS_REASONS.endUnreadIdUnsearchable, RECORDER_CENSUS_REASONS.endUnreadScanFailed,
  RECORDER_CENSUS_REASONS.endUnreadMentioned, RECORDER_CENSUS_REASONS.endUnreadBefore]);
/** D99 (review of A1b): the `end_unread_*` reasons that establish that a later record mentions the run — a notification
 *  linked to it, or its task id in a later row of the lineage that the agent did not write — so a run read under one is
 *  marked `unread` (events.js BACKGROUND_ENDS): later records mention it, and Sonah could not read whether or how it
 *  ended. Under each other reason (its id in a row before its launch, an id no verbatim search is sound for, a file that
 *  could not be read again) no later mention is established: the run is marked `unchecked`, Sonah could not check
 *  whether the recording holds an end of it. */
export const END_MENTIONED_REASONS = Object.freeze([RECORDER_CENSUS_REASONS.endUnreadLinked,
  RECORDER_CENSUS_REASONS.endUnreadMentioned]);

/**
 * M34 labels review (F2; C-02 "Slice-time labels", positional label gaps). The label gaps whose loss is at a row: an
 * untyped row where Claude Code writes its interruption notice, and a row the declared legacy fallback labelled. Each
 * row carrying one leaves a mark at its position in the ledger (events.js `LABEL_GAP_MARK`), one per counted label, so
 * the evidence adapter can name where each loss is and a bound recorded before every such row stays complete — as H2's
 * positional gap did for the rows its fallback set aside. Every other gap is a loss of the whole session.
 */
export const POSITIONED_GAPS = Object.freeze([LABEL_GAPS.legacyRecorder, LABEL_GAPS.interruptUntyped]);

/** The keys of `capture.labels`: one count per label, the unlabelled records, and private reasoning (Claude thinking,
 *  Codex reasoning), which is counted and never used. A record split into blocks is counted per block. */
export const COUNT_KEYS = Object.freeze([...Object.values(LABELS), 'unlabelled', 'private']);

/** A label value: `{ label, basis, markers?, gap?, links? }`, checked against the vocabularies (fail closed). */
export function labelOf(label, basis, { markers = [], gap = null, links = null } = {}) {
  if (label !== null && !LABEL_SET.has(label)) throw new Error(`unknown label ${label}`);
  if (!Object.values(LABEL_BASIS).includes(basis)) throw new Error(`unknown label basis ${basis}`);
  if (gap !== null && !GAP_SET.has(gap)) throw new Error(`unknown label gap ${gap}`);
  if (label === null && gap === null) throw new Error('an unlabelled record needs a closed reason');
  const marked = MARKER_ORDER.filter((marker) => markers.includes(marker));
  if (marked.length !== new Set(markers).size) throw new Error(`unknown marker in ${markers}`);
  return { label, basis, ...(marked.length ? { markers: marked } : {}), ...(gap !== null ? { gap } : {}),
    ...(links ? { links } : {}) };
}

/** Put a label value (`labelOf`, or `{ parts }` for a record split into blocks) and the lineage onto a record. */
export function applyLabel(rec, value, lineage) {
  delete rec.label; delete rec.basis; delete rec.markers; delete rec.gap; delete rec.links; delete rec.parts;
  delete rec.private;
  if (value.parts) {
    rec.parts = value.parts;
    // A record whose labelled blocks all carry one label carries it whole as well (private reasoning blocks aside);
    // one whose blocks differ, or with an unlabelled block, carries none whole: read its blocks (`partsOf`).
    const labelled = value.parts.filter((part) => part && part.private !== true);
    const labels = new Set(labelled.map((part) => part.label));
    rec.label = labels.size === 1 && labelled.every((part) => part.label !== null) ? [...labels][0] : null;
    if (labelled.length === 0 && value.parts.length > 0) rec.private = true;
  } else if (value.private === true) { rec.private = true; rec.label = null; }
  else Object.assign(rec, value);
  rec.lineage = lineage;
  return rec;
}

/** The labels a record carries: its blocks' (each `{block, ...value}`), or the record's own as one. */
export function partsOf(rec) {
  if (Array.isArray(rec?.parts)) return rec.parts.map((part, block) => (part && part.private !== true
    ? { block, ...part } : null)).filter(Boolean);
  return rec && Object.hasOwn(rec, 'label') && (rec.label !== null || rec.gap) ? [{ block: null, label: rec.label,
    basis: rec.basis, markers: rec.markers, gap: rec.gap, links: rec.links }] : [];
}

/** The record's human part, when it has exactly one human-labelled label (record or block): `{block, ...}`, or null. */
export function humanPart(rec) {
  const human = partsOf(rec).filter((part) => part.label === LABELS.human);
  return human.length ? human : null;
}

/**
 * Whether a record opens a human turn: a `user` row labelled `human` (whole or in a block) that is not an answer or a
 * refusal — those, like a queued prompt's attachment row (a record of its own kind), are the human's words recorded
 * within a turn (`interjections`). A prompt queued and delivered as the next turn (`queued` on a user row) opens it.
 * Every turn counter reads this one predicate.
 */
export function opensTurn(rec) {
  if (rec?.kind !== 'user') return false;
  const human = humanPart(rec);
  return !!human && human.every((part) => !(part.markers ?? []).some((marker) =>
    marker === MARKERS.answer || marker === MARKERS.refusal));
}

/** An empty `capture.labels` count. */
export function emptyCounts() {
  return Object.fromEntries(COUNT_KEYS.map((key) => [key, 0]));
}

/** Count one label value (a whole record's, or one block's) into `counts`, and its gap into `gaps`. */
export function countLabel(counts, gaps, value) {
  if (value === null) return;
  counts[value.label === null ? 'unlabelled' : value.label]++;
  if (value.gap) gaps[value.gap] = (gaps[value.gap] ?? 0) + 1;
}
