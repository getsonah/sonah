// Adapter: the inherited slicer's ledger -> the canonical Session model.
//
// This is the bridge that lets the new review pipeline run on real recordings today, using the
// capture that already works, instead of waiting for a fresh adapter per agent.
//
// One honest loss, declared rather than papered over:
//   - an `edit` carries no recorded outcome. Failures are a separate `error` kind, so an edit
//     entry implies success — but that is an INFERENCE from the record's shape, not a recorded
//     result, so the observation is marked sourceOfResult:'parsed-output', never 'native'.

import { createHash } from 'node:crypto';
import { Session, effectReader, ACTION_EFFECTS, CHANGING_EFFECTS } from '../src/session.js';

// H1: a ledger command's `unproven` (a zero status that does not speak for every command of its line) and an older
// slicer's `errored` (read from text) are `unknown` here: neither is a recorded pass or failure.
const OUTCOME = Object.freeze({ passed: 'succeeded', failed: 'failed', unknown: 'unknown' });
/** H1: the sources a command's result may be concluded from (the slicer's outcome.js `NATIVE_STATUS_SOURCES`,
 *  re-declared: this package never imports the slicer). */
const NATIVE_STATUS = Object.freeze(['native', 'hook']);
// An older slicer spliced this into an over-long saying (6000 + '\n[…]\n' + 2000, cut BEFORE redaction); a ledger
// persisted then still carries it. The slicer now keeps the whole saying and redaction bounds it (STATEMENT_OMISSION).
const ELISION = '[\u2026]';
const COMMAND_KINDS = Object.freeze(['bash', 'test', 'error']);

/** The stubs spliced into an ask where pasted material was stripped — "[<what>, N lines, M chars]" for an over-long
 *  attachment/fence/traceback/indented block — and an older slicer's turn budget "[\u2026 N chars elided \u2026]".
 *  Both are Sonah's: the recorder kept the whole turn (M33 R: the older cut was made before redaction; M33 R repair:
 *  the strips are made by redaction, once it has scrubbed the whole ask — an older slicer made them before it). A
 *  ledger persisted then still carries either. They are never the human's words, so an instruction receipt must never
 *  be able to quote one or span across one (audit G4/B6, same rule the final-saying split applies to ELISION). */
const ASK_ELISION = /\[(?:attachment|code block|traceback|indented block), \d+ lines, \d+ chars\]|\[\u2026 \d+ chars elided \u2026\]/g;
/** M33 R repair. What an ask's strip is named in its `elided` entry and its stub (redact/index.js `ASK_STRIP_KINDS`,
 *  re-declared: this package never imports it; asserted equal in test/m33-r-whole-before-cut.test.js). M6: no Sonah strips an ask any more; read only to declare a strip a persisted ledger still carries. */
export const ASK_STRIP_KINDS = Object.freeze(['attachment', 'code block', 'traceback', 'indented block']);
/** M33 R. Sonah's own marker, on a line of its own, where it cut the middle of an over-long ask: the REDACTOR writes it
 *  when it bounds the ask it has already scrubbed whole (redact/index.js `ASK_OMISSION`, re-declared: this package
 *  never imports it). It is this review's words, never the human's, so it is never inside a quotable span. The slicer
 *  declares that cut (`elided: [{ what: 'middle of turn' }]`) and redaction settles it. */
const ASK_OMISSION = /(?:^|\n)\[… instruction middle omitted before review …\](?=\n|$)/g;
const ASK_MIDDLE = 'middle of turn';

/** What redaction wrote in place of an ask it dropped whole, before W3e-3 (F198): the REDACTOR's
 *  words, never the human's. Only read, from a ledger persisted then; redaction no longer writes it. */
const DROPPED_ASK_LITERAL = '[line dropped: unclassified high-entropy content]';

/** W3e-4 / F204. Why the human instruction inventory is incomplete: the closed set of notes an
 *  `incomplete_inventory` gap on the `instructions` channel carries — the recorder shortened an ask,
 *  redaction withheld every word of one, or (M33 R, M33 R repair) Sonah capped one or stripped its
 *  pasted material before review. */
export const INSTRUCTION_GAP_NOTES = Object.freeze({
  // An elision this adapter knows no maker of (an `elided` entry of a kind no version of Sonah writes).
  recorder_shortened: 'instruction text was elided by the recorder',
  redaction_withheld: 'instruction text was withheld by redaction',
  // M33 R: an ask over Sonah's budget, cut by redaction's bound after it was scrubbed whole (or by an older slicer
  // before redaction, Sonah's too). The recorder kept the whole ask; the review names it `instructions_capped`.
  capped_before_review: 'instruction text was capped before review; its head and tail are quotable, the elided middle is not',
  // M33 R repair: pasted material in an ask (an attachment, a code fence, a traceback, an indented block) replaced by
  // Sonah's stub — by redaction once it has scrubbed the whole ask, or by an older slicer. The recorder kept the whole
  // ask, so the strip is never credited to it; the review names it `instructions_stripped`.
  stripped_before_review: 'pasted material in instruction text was replaced by a stub before review; the text around it is quotable, the stripped material is not',
  // L1 review (OWNER DECISION 2026-10-06): calls a Claude Code recorder that types no refusal recorded as failed (slicer
  // events.js `CLAUDE_UNTYPED_DENIAL_RECORDER`): any of them may be the human's refusal, holding an answer this review
  // did not read. The review names it `instructions_refusal_untyped`.
  refusal_untyped: 'failed calls were recorded by a recorder that does not record which calls the human refused, so any of them may hold a human answer that was not incorporated into the human instruction history',
  // L1 session-type review (finding L1S-unknown-type-not-counted; OWNER DECISION 2026-10-06): calls refused in a
  // session whose type the recorder did not record (slicer events.js `claudeSessionType` unknown), so whether a human
  // was there to answer is not known; each keeps its declaration (fail closed) under this reason, apart from a refusal
  // in a human's session (UNREAD_ANSWER_NOTE). The review names it `instructions_refusal_session_unknown`.
  refusal_session_unknown: 'calls were refused in a session whose recorder did not record whether a human was present to answer, so any of them may hold a human answer that was not incorporated into the human instruction history',
  // Gain I (2026-10-13): nontext blocks (an image the human pasted) in human input this adapter cannot place at a
  // message of theirs (a message with no words opens no instruction; a row the slicer counted but did not read): a loss
  // at every bound. The literal this adapter always wrote.
  nontext_unplaced: 'human input contained nontext blocks that this reviewer could not read',
  // Gain I: the human messages that carried nontext blocks beside their words, named by their instruction events. A
  // review request that carries a message's images (evidence images.js) clears its loss for that request.
  nontext_attached: 'human messages carried images or other nontext content that this reviewer was not shown',
  // D126 (N0): a session that opens on a compaction whose earlier part Sonah did not read (`lineage.continued.unread`,
  // the slicer's CONTINUED_REASONS): the human messages recorded before that compaction are in no event of this session.
  // One note per reason, so each reason's rate stays computable. The review names each `instructions_earlier_<reason>`.
  earlier_recording_missing: 'the session opens on a compaction and no recording in its folder holds the part before it',
  earlier_recording_ambiguous: 'the session opens on a compaction and more than one differing recording holds the part before it',
  earlier_recording_unread: 'the session opens on a compaction and the recording that holds the part before it could not be read',
  earlier_recording_cycle: 'the session opens on a compaction whose link leads back to a recording already read with it',
});

/** D126 (N0): the slicer's CONTINUED_REASONS (slicer/src/continued.js), re-declared: this package never imports the
 *  slicer. Each reason is its own instructions note above. */
export const CONTINUED_UNREAD_REASONS = Object.freeze(['earlier_recording_missing', 'earlier_recording_ambiguous',
  'earlier_recording_unread', 'earlier_recording_cycle']);

/**
 * D127 (B10d): the typed facts of the compaction a mark records (the slicer's `compacted`, on the mark of a Claude Code
 * compaction boundary row), as the boundary event keeps them: `{ compacted: { trigger?, before?, after? } }` — a
 * `trigger` of `auto` or `manual`, and the agent's context in tokens before and after it (safe integers >= 0). A mark
 * without them (a summary row's, another recorder's) gives nothing, so its event is as before. No request shows them:
 * a window shows a boundary by its id and kind alone (prompt.js); the readers count the gap from them.
 */
function compactedFactsOf(mark) {
  const value = mark?.compacted;
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return {};
  const count = (n) => Number.isSafeInteger(n) && n >= 0;
  return { compacted: { ...(['auto', 'manual'].includes(value.trigger) ? { trigger: value.trigger } : {}),
    ...(count(value.before) ? { before: value.before } : {}), ...(count(value.after) ? { after: value.after } : {}) } };
}

/** D126 (N0): a ledger's `lineage.continued` as the slicer writes it — `{ earlier, unread? }` — or null: a ledger of a
 *  recording that does not open on a compaction (or a malformed field, which no slicer writes) has none. */
function continuedOf(ledger) {
  const value = ledger?.lineage?.continued;
  if (value === null || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).some((key) => key !== 'earlier' && key !== 'unread')
    || !Number.isSafeInteger(value.earlier) || value.earlier < 0
    || (value.unread !== undefined && !CONTINUED_UNREAD_REASONS.includes(value.unread))) return null;
  return { earlier: value.earlier, unread: value.unread ?? null };
}

/** Gain I (2026-10-13): the recorder block types of a human message's nontext content (slicer records.js
 *  `NONTEXT_BLOCK_TYPES`, re-declared: this package never imports the slicer). */
export const NONTEXT_BLOCK_TYPES = Object.freeze(['image', 'document', 'audio']);

/** Gain I: an ask's nontext blocks as this adapter carries them on its instruction event (`nonText`): each `{ block,
 *  type }` (null where the ledger's is not one), with `mediaType` and `data` only where both are text, as recorded. */
function askNonText(ask) {
  return (Array.isArray(ask?.nonText) ? ask.nonText : []).map((entry) => ({
    block: Number.isSafeInteger(entry?.block) && entry.block >= 0 ? entry.block : null,
    type: NONTEXT_BLOCK_TYPES.includes(entry?.type) ? entry.type : null,
    ...(typeof entry?.mediaType === 'string' && typeof entry?.data === 'string'
      ? { mediaType: entry.mediaType, data: entry.data } : {}) }));
}

/**
 * M34 labels (C-02 "Slice-time labels"; owner decisions 2026-10-06). The slicer labels every record once, from the
 * recorder's structure (slicer labels.js), and counts each label gap by its closed reason (`capture.labelGaps`;
 * slicer labels.js `LABEL_GAPS`, re-declared here — this package never imports the slicer — and held equal by
 * test/m34-labels-adapter.test.js). Each reason is declared as its own counted gap, one closed note per reason, so its
 * rate stays computable: `[channel, note]`. `unknown_block` and `unknown_row` (an unlabelled block or row) are already
 * declared by the capture counts that count the same rows (`unsupportedActions`, `unclassifiedRows`, commentary), so
 * they carry no note of their own and are not declared twice.
 */
export const LABEL_GAP_NOTES = Object.freeze({
  unknown_block: null,
  unknown_row: null,
  origin_unknown: Object.freeze(['instructions', 'recorded user rows carry an origin of a kind the recorder\'s typed vocabulary does not name, so they were not labelled and may hold a human instruction']),
  legacy_recorder: Object.freeze(['instructions', 'legacy recorder labels: rows of a recorder that types no human channel were labelled by the declared fallback (their structure, not a typed origin), so which of them hold a human instruction is not proven']),
  interrupt_untyped: Object.freeze(['instructions', 'interruptions not typed by this recorder: it writes its interruption notice as an untyped row, so where the human interrupted the agent is not recorded']),
  command_args_unrecorded: Object.freeze(['instructions', 'slash commands the human ran were recorded without their arguments, so the words typed with them are not in the instruction history']),
  // Owner decision 2026-10-07: only a notification whose carried call id names a call the recording does not hold; one
  // that carries no call id is an observation with no link and no gap.
  notification_unmatched: Object.freeze(['observations', 'background-task notifications name a background call the recording does not hold, so they could not be linked to the work they report on']),
  answer_unrecorded: Object.freeze(['instructions', 'questions the agent asked the human have no answer the recording links to them, so the human\'s answers are not in the instruction history']),
});

/** M33 U repair (OWNER DECISION B, 2026-10-01). The note of the instructions-channel gap that declares the human's words
 *  inside a tool result this reviewer did not read as an instruction: a Claude question whose answer was not read (its
 *  call is named), the answer a call the human refused may hold (L1: by the recorder's typed denial kind, whatever its
 *  words; its call is named), or such an answer no ledger action carries (named by nothing: a loss at every bound). One
 *  literal, as 269cf6d wrote it. */
export const UNREAD_ANSWER_NOTE = 'a user answer inside a tool result was not incorporated into the human instruction history';

/**
 * M33 brittleness L3. Which recorded actions ask the human a question and wait for the answer (`asksHuman`), and which
 * record a choice the human made in their result (`humanChoice`: a plan the human approves or rejects) — read from each
 * recorder's own schema, by the name it records for its own built-in tool, exactly as `answerTo` is set from it. This
 * is recorder schema, never judgment: evidence code reads only the flags, never a tool name. Per harness:
 *   claude  AskUserQuestion asks (its answer is a typed sidecar); ExitPlanMode is a choice (the human approves or rejects
 *           the plan the call carries).
 *   codex   request_user_input and request_user_input_async ask (built-in: the recorder writes them with no MCP
 *           namespace); the schema has no tool whose result records a human choice (`update_plan` is the agent's own).
 * A harness absent here (Cursor, a mixed or unrecognised source set) has no schema this adapter knows: its flags stay
 * unset and its session declares that it cannot tell (HUMAN_INTERACTION_UNKNOWN_NOTE), so nothing is certified on
 * their absence.
 */
export const HUMAN_INTERACTION_TOOLS = Object.freeze({
  claude: Object.freeze({ asksHuman: Object.freeze(['AskUserQuestion']), humanChoice: Object.freeze(['ExitPlanMode']) }),
  codex: Object.freeze({ asksHuman: Object.freeze(['request_user_input', 'request_user_input_async']),
    humanChoice: Object.freeze([]) }),
});
/** M33 brittleness L3. The note of the instructions-channel gap a session declares when its recorder's schema is not one
 *  HUMAN_INTERACTION_TOOLS names: which of its actions asked the human (whose answer is then missing from the human
 *  instruction history) or recorded a human choice cannot be told. Counted by the session's own actions, unlocated: a
 *  loss at every bound. */
export const HUMAN_INTERACTION_UNKNOWN_NOTE = 'the recorder schema does not say which actions asked the human or recorded a human choice';
/** The recorder-schema flags of one action whose recorded tool name is `tool`, under `adapter`'s schema: `asksHuman`
 *  and `humanChoice`, each present only when true. */
const humanInteractionFlags = (adapter, tool) => {
  const schema = Object.hasOwn(HUMAN_INTERACTION_TOOLS, adapter) ? HUMAN_INTERACTION_TOOLS[adapter] : null;
  if (schema === null || typeof tool !== 'string') return {};
  return { ...(schema.asksHuman.includes(tool) ? { asksHuman: true } : {}),
    ...(schema.humanChoice.includes(tool) ? { humanChoice: true } : {}) };
};

/** OWNER DECISION B (2026-10-01). The kinds of in-turn human instruction the slicer reads (`interjections`): a prompt
 *  the human queued while the agent worked, and the human's answer to an AskUserQuestion call (slicer events.js
 *  `INTERJECTION_KINDS`, re-declared: this package never imports the slicer; asserted equal in
 *  test/m33-u-unasked-adapter.test.js). Closed: any other kind is not placed, and is declared. */
export const INTERJECTION_KINDS = Object.freeze(['queued', 'answer', 'attached', 'peer']);
/** D150: the notes of the `unsupported_message` gaps that count recording rows the slicer left unread (its
 *  `capture.unclassifiedRows` and `unsupportedRowChannels`), whose rows the slicer also counts once each by kind
 *  (`unreadRows`, records.js UNREAD_ROW_KINDS, re-declared below; this package never imports the slicer). */
export const UNSUPPORTED_ROW_NOTES = Object.freeze({
  identity: 'unsupported recording rows carried content whose T/A/O channel could not be identified',
  channel: 'recording rows in an unsupported schema carried content for this channel',
});
/** D150: the kinds of an unread row (slicer records.js UNREAD_ROW_KINDS), re-declared and held equal by a test. */
export const UNREAD_ROW_KINDS = Object.freeze(['request_copy', 'hook_output', 'edited_file', 'other']);
/** D150: the session's own rows the slicer left unread, by kind (its ledger's `unreadRows`, each a count), with the
 *  in-turn instructions this adapter could not place (`other`, counted as the instructions gap counts them) and every
 *  transferred child's; null when it holds none. Read by the coverage facts only (ledger.js `sessionCoverageFacts`). */
function unreadRowsOf(ledger, unplacedHeard, transfers) {
  const out = Object.fromEntries(UNREAD_ROW_KINDS.map((kind) => [kind, 0]));
  const own = ledger?.unreadRows !== null && typeof ledger?.unreadRows === 'object' ? ledger.unreadRows : {};
  for (const kind of UNREAD_ROW_KINDS) if (Number.isSafeInteger(own[kind]) && own[kind] > 0) out[kind] += own[kind];
  if (Number.isSafeInteger(unplacedHeard) && unplacedHeard > 0) out.other += unplacedHeard;
  for (const transfer of transfers ?? []) {
    const child = transfer?.session?.unreadRows;
    for (const kind of UNREAD_ROW_KINDS) if (Number.isSafeInteger(child?.[kind]) && child[kind] > 0) out[kind] += child[kind];
  }
  return UNREAD_ROW_KINDS.some((kind) => out[kind] > 0) ? Object.freeze(out) : null;
}
const [QUEUED_KIND, ANSWER_KIND, ATTACHED_KIND, PEER_KIND] = INTERJECTION_KINDS;
/** M34 labels: the markers an instruction event carries (slicer labels.js `MARKERS`, those an instruction can carry;
 *  re-declared, held equal by test/m34-labels-adapter.test.js). Closed, in this order. M34 labels review (F3): a refusal
 *  is never read as an instruction (its result's text is the recorder's), so no instruction carries `refusal`. */
export const INSTRUCTION_MARKERS = Object.freeze(['queued', 'answer', 'command', 'attached', 'after_interrupt']);
/** M34 labels: the authority of an instruction, from the recorded lineage and label: the human's on a root lineage, the
 *  parent agent's (`agent`) on a helper's, another agent's (`peer`) for a peer-labelled message. */
const PEER_AUTHORITY = 'peer';

/** M33 T. Why a hand-off's brief is missing from the evidence: the closed set of notes an `incomplete_inventory`
 *  gap on the `actions` channel carries for delegation briefs. Redaction withheld part of the brief's text, or the
 *  recorder encrypted the whole brief (the slicer's `parentInstruction.encrypted`, a Codex token it never keeps).
 *  The two are separate declarations: an encrypted brief is never counted as a redaction. */
export const DELEGATION_BRIEF_GAP_NOTES = Object.freeze({
  redaction_withheld: 'a delegation brief was partly withheld by redaction',
  recorder_encrypted: 'delegation brief(s) were encrypted by the recorder, so they cannot be shown or checked',
});
/** A brief the recorder encrypted: the fact, and no text at all. A brief that carries text is read as text. */
const encryptedBrief = (delegation) => delegation?.parentInstruction?.encrypted === true
  && typeof delegation.parentInstruction.text !== 'string';
/** A Codex canonical task path (slicer delegation.js `canonicalTask`), within the identity length bound. */
const CANONICAL_TASK = /^\/root\/[a-z0-9_]+(?:\/[a-z0-9_]+)*$/;
/** M33 T. The hand-off's task name as a plain delegate-event field: only a canonical task path that survived
 *  redaction (the redactor nulls a flagged identity and names it in `identityUncheckedFields`). */
const verifiedTaskName = (delegation) => {
  const task = delegation?.taskName;
  const lost = Array.isArray(delegation?.identityUncheckedFields) && delegation.identityUncheckedFields.includes('taskName');
  return !lost && typeof task === 'string' && task.length <= 200 && CANONICAL_TASK.test(task) ? task : null;
};

/** The head-truncation stub, written once per capped body by an earlier Sonah — M33 R to D68 (E): by redaction,
 *  after it scrubbed the body whole (redact/index.js `capBody`, `capEdit`), or by the slicer's memory bound
 *  (slicer/src/before.js `retainHead`); an older slicer wrote it before redaction. D68 (E) (owner decision 2026-10-07)
 *  deleted every one of those cuts: nothing writes the stub any more, and it is recognised only in a persisted ledger.
 *  Each is Sonah's cut, never the recorder's (it kept the whole body), and each is declared as Sonah's
 *  (`BODY_CAPPED_NOTE`). Same rule as the two elisions above: those are not the session's words, so a
 *  `code` receipt must never be able to quote one. It is also the only place downstream can learn
 *  WHICH cap was applied \u2014 reproducing `BEFORE_CAP` here would put one number in two packages and
 *  lie the day either moved.
 *
 *  W3d-6 \u00a73 / F169: the recorder writes it on a line of its own, with its leading newline, and
 *  redaction keeps it there (`scrubLines` never joins a continued line into it). There is one way
 *  it still arrives WITHOUT that newline: redaction dropped every kept line in front of it (an
 *  unclassifiable high-entropy head \u2014 one long single-line data blob cut at the cap), so the stub
 *  opens the field. It is still the recorder's words and still the cut, so it is matched there too;
 *  anywhere else a stub must stand at the start of a line. */
const BODY_TRUNCATION = /(?:^|\n)\[\u2026 truncated at (\d+) chars \u2026\]/g;

/** W3e-1 / F184. The REDACTOR's note, written by an earlier Sonah's redactor (`scrubLines`) on a line of its
 *  own at the end of each segment it dropped lines from — the end of a whole body, or the end of
 *  one side of an Edit, just before the separator. It is the redactor's words, not the session's,
 *  so it is recognised exactly as the recorder's stub is: never inside a quotable span, never part
 *  of any edit side, never counted as a character or line of one. The count it states is already
 *  on the field (`redactedLines`), and only a field that declares one is read for it.
 *
 *  W3e-3 / F199: the note names why the lines were dropped, one phrase per reason (that redactor's
 *  `DROPPED_NOTE_PHRASES`: a key block, a secret-named value, unclassified content\u2026), one note per reason.
 *  Every phrase is letters, spaces and hyphens, which is what this matches. D90 (owner decision 2026-10-15): no Sonah
 *  writes the note now (the redactor's detectors are deleted); a ledger an earlier one persisted is still read. */
const REDACTION_NOTE = /(?:^|\n)\[\u2026 \d+ line\(s\) dropped: [A-Za-z][A-Za-z -]*[A-Za-z] \u2026\](?=\n|$)/g;
const REDACTION_TOKEN = /‹redacted(?::[^›\n]+)?›/g;
const DROPPED_TOKEN = /‹dropped(?::[^›\n]+)?›/g;
const OUTPUT_OMISSION = /(?:^|\n)\[… output omitted by recorder …\](?=\n|$)/g;
/** M33 F. Sonah's own marker, on a line of its own, where it cut the middle of a helper's final report: the REDACTOR
 *  wrote it when it bounded the report it had already scrubbed whole (redact/index.js `FINAL_ANSWER_OMISSION`,
 *  re-declared: this package never imports it). D68 (E): a report is what the helper produced, kept whole; nothing
 *  writes the marker any more, and it is recognised only in a persisted ledger. It is this review's words, never the helper's or the recorder's —
 *  Codex kept the whole report, and its output stub (`OUTPUT_OMISSION`) is never used for this cut — so it is
 *  recognised exactly as the recorder's stub is: never inside a quotable span. */
const REPORT_OMISSION = /(?:^|\n)\[… report middle omitted before review …\](?=\n|$)/g;
/** M33 F repair 3. Sonah's own marker, on a line of its own, where it cut the middle of a closing statement (a
 *  `sayings` entry): the REDACTOR wrote it when it bounded the statement it had already scrubbed whole (redact/index.js
 *  `STATEMENT_OMISSION`, re-declared: this package never imports it). D68 (E): nothing cuts a statement any more (what
 *  the agent produced is kept whole); the marker is recognised only in a persisted ledger. It is this review's words,
 *  never the agent's, so it is never inside a quotable span. */
const STATEMENT_OMISSION_LINE = '[… statement middle omitted before review …]';
const STATEMENT_OMISSION = /(?:^|\n)\[… statement middle omitted before review …\](?=\n|$)/g;
/** The code points of a statement over which an earlier redaction bounded it (redact/index.js `STATEMENT_CAP.chars`,
 *  M33 F repair 3 to D68 E): read only to recognise a persisted bound. */
const STATEMENT_CAP_CHARS = 8000;
const hasRedactionNote = (value) => new RegExp(REDACTION_NOTE.source).test(String(value ?? ''));
/** An ask's own cuts, Sonah's or an older slicer's, read where its `elided` declares one. */
const ASK_CUTS = new RegExp(`${ASK_ELISION.source}|${ASK_OMISSION.source}`, 'g');
const INSTRUCTION_OMISSION = new RegExp(`${ASK_ELISION.source}|${ASK_OMISSION.source}|${REDACTION_NOTE.source}|${REDACTION_TOKEN.source}|${DROPPED_TOKEN.source}`, 'g');
const PROSE_OMISSION = new RegExp(`${REDACTION_NOTE.source}|${REDACTION_TOKEN.source}|${DROPPED_TOKEN.source}`, 'g');
/** Does `value` hold mark-shaped text: a masked value, a dropped token, a dropped-lines note? It is an earlier
 *  redactor's mark only where the record declares that redactor's work (`redactorDeclared`). */
const hasRedactionToken = (value) => String(value ?? '').includes('‹redacted')
  || String(value ?? '').includes('‹dropped') || hasRedactionNote(value);
/**
 * D90 (owner decision 2026-10-15). Where the record declares an earlier Sonah's redactor's work, mark-shaped text
 * (`‹redacted…›`, `‹dropped…›`, a dropped-lines note) is that redactor's: kept out of every quotable span and declared
 * as withheld, as it always was. The record declares it in two places, both that redactor's own fields: the ledger's
 * list of what it dropped (`dropped`, an entry with one of its closed `redacted:` or `dropped:` reasons:
 * `redactorLedger`), and the field itself (its `redacted`, or a count of the lines or tokens it dropped:
 * `declaresRedaction`). No Sonah writes a mark or either declaration now, and nothing derives one from a text's
 * characters (redact/index.js), so in a ledger a review slices today the same characters are the recording's own text
 * (a person pasted an earlier page, an agent printed one): placed whole, quotable, and never read as a redaction.
 * Provenance by the record's structure, never by what its text says.
 */
const REDACTOR_REASON = /^(?:redacted|dropped):/;
const redactorLedger = (ledger) => Array.isArray(ledger?.dropped)
  && ledger.dropped.some((drop) => typeof drop?.reason === 'string' && REDACTOR_REASON.test(drop.reason));
const declaresRedaction = (field) => field !== null && typeof field === 'object'
  && (field.redacted === true || Number(field.redactedLines) > 0 || Number(field.redactedTokens) > 0);
/** `redactorDeclared(ledger)(field)`: does the record declare an earlier redactor's work on this field? */
const redactorDeclared = (ledger) => {
  const whole = redactorLedger(ledger);
  return (field) => whole || declaresRedaction(field);
};

/** A write whose body the record simply does not carry (a shell write, a delete, an `Edit`
 *  whose tool call names old/new strings rather than a whole body). Declared on the change so
 *  the prompt can say so where the action is shown, instead of implying complete evidence. */
const UNRECORDED_EXTENT = Object.freeze({ chars: 0, lines: 0, truncated: false, cap: null,
  recorded: false, redactedLines: 0 });
const INTER_AGENT_MESSAGE_NOTE = 'native inter-agent messages were recorded without attributable communication evidence';
/**
 * M33 F. Why an inter-agent message is missing from the evidence: the closed set of notes an `incomplete_inventory`
 * gap on the `children` channel carries, one per closed loss counter of the slicer (slicer inter-agent.js
 * `INTER_AGENT_LOSS_COUNTS`, re-declared: this package reads the ledger and never imports the slicer; the two are
 * asserted equal in test/m33-f-final-answers.test.js). A row not in the recorded shape keeps the note it always had;
 * a message whose payload the recorder encrypted, a helper's final report no hand-off of its recording matched by its
 * recorded sender and recipient, and one more than one hand-off could own are each declared as what they are.
 */
export const INTER_AGENT_GAP_NOTES = Object.freeze({
  unparsed: INTER_AGENT_MESSAGE_NOTE,
  encrypted: 'inter-agent messages were encrypted by the recorder, so they cannot be shown or checked',
  unattributed: 'helper final reports matched no hand-off of this recording by their recorded sender and recipient, '
    + 'so they were not attached to one',
  ambiguous: 'helper final reports could belong to more than one hand-off, so they were not attached to one',
});
/** `[capture key, note]` per closed communication loss, in declaration order. */
export const INTER_AGENT_LOSS_GAPS = Object.freeze([
  Object.freeze(['interAgentMessagesUnparsed', INTER_AGENT_GAP_NOTES.unparsed]),
  Object.freeze(['interAgentMessagesEncrypted', INTER_AGENT_GAP_NOTES.encrypted]),
  Object.freeze(['interAgentFinalAnswersUnattributed', INTER_AGENT_GAP_NOTES.unattributed]),
  Object.freeze(['interAgentFinalAnswersAmbiguous', INTER_AGENT_GAP_NOTES.ambiguous]),
]);
/** A capture's communication loss counters: every value a safe count (absent is 0), and their sum. */
const communicationLoss = (capture) => {
  let total = 0;
  let counted = true;
  for (const [key] of INTER_AGENT_LOSS_GAPS) {
    if (capture === null || typeof capture !== 'object' || !Object.hasOwn(capture, key)) continue;
    const n = capture[key];
    if (Number.isSafeInteger(n) && n >= 0) total += n;
    else counted = false;
  }
  return { total, counted };
};
/**
 * M33 F repair. The note of the `source_clipped` gap on `observations` that declares a helper's final report this
 * review capped (the redactor's bound of the scrubbed report: the statement budget, at line boundaries). Its own
 * declaration, apart from recorded tool output's ("the recorder retained only head and tail…"): the recorder kept the
 * whole report; this review cut it. The review names it by its own coverage cause (`reports_capped`), never as a text
 * the recorder cut short.
 */
export const HELPER_REPORT_CLIPPED_NOTE =
  'a helper final report was capped before review; its head and tail are quotable, the elided middle is not';
/**
 * M33 F repair 3. The note of the `source_clipped` gap on `commentary` that declares a closing statement this review
 * capped: the redactor's bound of the statement it scrubbed whole (`STATEMENT_OMISSION`), or an older slicer's cut
 * ('[…]', Sonah's too). The recorder kept the whole statement, so the cut is never credited to it; the review names it
 * by its own coverage cause (`statements_capped`).
 */
export const CLOSING_STATEMENT_CLIPPED_NOTE =
  'a closing statement was capped before review; its head and tail are quotable, the elided middle is not';
/**
 * M33 R. The note of the `source_clipped` gap on `code` that declares the file bodies an earlier Sonah capped (M33 R to
 * D68 E, read from a persisted ledger): redaction's cap of a body it scrubbed whole, the slicer's memory bound, or an
 * older slicer's cut before redaction — each Sonah's, written as the same stub (`BODY_TRUNCATION`). The recorder kept the whole body,
 * so the cut is never credited to it; the review names it by its own coverage cause (`bodies_capped`).
 */
export const BODY_CAPPED_NOTE = 'a file body was capped before review; only its head is quotable as code';
/**
 * M33 F. A hand-off's attached final report (slicer `finalAnswer`), as redaction left it: its text, whether this
 * review cut it (`truncated`, the redactor's bound of the scrubbed text), whether redaction withheld part of it, and
 * where the parent RECEIVED it — the row (`record`, in the hand-off's own recording) and human turn (`turn`) of its
 * FINAL_ANSWER row, or null when not recorded as a count. Anything that is not that shape is no report.
 */
const helperReport = (delegation, declared = declaresRedaction) => {
  const report = delegation?.finalAnswer;
  if (report === null || typeof report !== 'object' || Array.isArray(report) || typeof report.text !== 'string') return null;
  return { text: report.text, truncated: report.truncated === true,
    redacted: report.redacted === true || declared(report) && hasRedactionToken(report.text),
    record: Number.isSafeInteger(report.record) && report.record >= 1 ? report.record : null,
    turn: Number.isSafeInteger(report.turn) && report.turn >= 0 ? report.turn : null };
};
/**
 * C-02 M33 native-first refreeze: the slicer's closed capture reason for a per-turn native inventory
 * shortfall (slicer codex-exec.js CODEX_CAPTURE_REASONS.nativeInventory). Re-declared, as the typed
 * interrupt source below is: this package reads the ledger and never imports the slicer.
 */
const NATIVE_INVENTORY_REASON = 'codex_native_inventory_incomplete';
/** Capture counters each of which, when not exactly 0, names a loss other than the native
 *  inventory shortfall. Absent is 0; any other value (a count, or not a number) is another cause. */
const OTHER_CAPTURE_LOSS_COUNTS = Object.freeze(['unsupported', 'missing', 'unmapped',
  'interAgentMessagesUnparsed', 'instructionsNonText', 'unclassifiedRows', 'unsupportedActions',
  'orphanResults', 'observationsMissing', 'instructionsFeedbackUnplaced', 'instructionsRefusalUntyped',
  'instructionsRefusalSessionUnknown',
  // M33 F: the other closed communication losses (an attributed report is none).
  'interAgentMessagesEncrypted', 'interAgentFinalAnswersUnattributed', 'interAgentFinalAnswersAmbiguous']);
/**
 * C-02 "M33 native-first Codex code-mode evidence" (refreeze): the slicer's per-turn shortfall
 * counters, and the counted gap each one is declared as — `[capture key, code, channel, note]`, in
 * declaration order. One fixed table, so the codes and notes are never built at the call site.
 */
export const NATIVE_SHORTFALL_GAPS = Object.freeze([
  Object.freeze(['nativeInventoryShortfall', 'incomplete_inventory', 'actions',
    'native command, file or tool items do not account for every call the turn\'s code cells dispatched']),
  Object.freeze(['nativeCommandShortfall', 'command_outcome_unknown', 'observations',
    'commands a turn\'s code cells dispatched have no native execution record, so their exit status is unknown']),
  Object.freeze(['nativeWriteShortfall', 'write_outcome_unknown', 'observations',
    'patches a turn\'s code cells dispatched have no native file-change record, so whether they were applied is unknown']),
]);

/**
 * B1b/F69. WHY a change does or does not carry a before side, stated on every change so a
 * reader never has to infer the recorder's rule from an empty field. Closed set:
 *   first-write    — the file as the record found it. The recorder keeps a path's file state at
 *                    its FIRST write only, so a later write of the same path cannot have one.
 *   edit-text      — this Edit's own replaced text. A patch, not a file state.
 *   deleted-state  — the last body the record saw at a path the session then deleted.
 *   redacted       — this Edit's replaced text was recorded, and redaction removed all of it (a key
 *                    block, unclassifiable lines): the record had a prior state, none of it can be
 *                    shown, and the extent counts what was dropped (W3e-1 / F185).
 *   none           — the record observed no prior state for this change, and none is invented.
 */
export const PRIOR_STATE = Object.freeze({ firstWrite: 'first-write', editText: 'edit-text',
  deleted: 'deleted-state', redacted: 'redacted', none: 'none' });

/**
 * W3e-6 / F213. How a NUL (U+0000) in the record is stored: as U+2400 SYMBOL FOR NULL. Tool output
 * carries NULs into a session, and no model request can carry one — the review judge refuses any
 * request that contains it (cli/src/review-judge.js), because a process argument or a stdin protocol
 * cannot. Nothing upstream removed them, so a window holding one could never be reviewed, in any run.
 *
 * One character for one (one UTF-16 unit each), so every character count, line count and extent is
 * what it was; byte offsets are computed from the stored text, after the replacement, as they always
 * are. Deterministic, and applied to every text this adapter stores or renders from the record — the
 * blobs every quotable source resolves to, and the written paths — so a request built from the
 * session holds no NUL, and a quote containing the symbol verifies by string search like any other.
 * The text is complete; one symbol is spelled differently. That is counted on the session
 * (`controlCharsReplaced`) and declared by no gap.
 */
const NUL = /\u0000/g;
export const NUL_SYMBOL = '\u2400';

/** A body whose retained text is less than what the write actually put on disk. */
const clipped = (change) => change.extent?.truncated === true
  || change.beforeExtent?.truncated === true;

/** Redaction appends a trailer per field ("[… N line(s) dropped: …]", redact/index.js:420); the
 *  saying and the blocks are redacted separately, so their trailers disagree — a two-block record
 *  yields "3" and "4" on the blocks and "7" on the saying. Strip them before comparing (M70). */
const REDACTION_TRAILER = /^\[… \d+ line\(s\) dropped:.*\]$/;
const normalise = (s) => s.split('\n').filter((l) => !REDACTION_TRAILER.test(l.trim())).join('\n').trim();

// C-02 operations. A failure does not change what was attempted, so the operation is derived
// from the attempted kind the slicer preserves across its legacy `kind`-to-'error' flip.
const OPERATION = Object.freeze({ create: 'write', edit: 'edit', delete: 'delete' });
const INPUT_PART = '\n⟪→⟫\n';
export const LEDGER_BOUNDARY_VERSION = 'sonah.ledger-boundaries/1';

/**
 * D68 (owner decision 2026-10-07; C-02 "M36 recorded facts"). The recorder's TYPED facts about a call, as the ledger
 * carries them (`recorded`), already rebuilt by redaction from its closed vocabulary (redact/index.js
 * `RECORDED_FACTS.keys`, re-declared here: this package never imports the redactor; asserted equal in
 * test/m36-recorded-facts.test.js). They ride on the canonical invocation (`recorded`) as data for the windows to
 * render (phase 2): the recorder's own tool name and, for Codex, the command's class (c5); a Codex command's parsed
 * meaning; a change's recorded hunks, line-numbered as the recorder wrote them, and what they were scrubbed with (c2),
 * or why they are withheld whole (D68 R); what the record holds of a write and of the file before it (c1); a sidecar's numbers, booleans and strings; and an
 * unrecorded change of the file since an earlier call (E), its turn-and-seq references named by event id. Nothing here
 * is a source: no review request reads it yet, and nothing in it is quotable.
 */
export const RECORDED_FACT_KEYS = Object.freeze(['tool', 'commandClass', 'parsedCmd', 'hunks', 'hunkScrub', 'hunksWithheld',
  'writeType', 'prior', 'patch', 'isError', 'denial', 'interrupted', 'noOutputExpected', 'backgroundTaskId', 'editDiff',
  'read', 'search', 'fetch', 'webSearch', 'unrecordedChange', 'withheld']);
/** A Claude Code Agent hand-off's typed facts on its delegation receipt (redact `RECORDED_FACTS.agent`). */
export const RECORDED_AGENT_KEYS = Object.freeze(['tool', 'status', 'totalToolUseCount', 'withheld']);
/** D69 review (F6): the closed reasons a prior state is withheld for (slicer before.js `PRIOR_WITHHELD`, re-declared: the
 *  adapter imports nothing of the slicer), with M36's `harness files` an earlier slicer wrote: a credential-shaped file
 *  or a harness folder — the meaning of a `withheld` refusal. */
export const PRIOR_WITHHELD_REASONS = Object.freeze(['credential-shaped path', 'harness home', 'harness files']);
function recordedFactsOf(recorded, ids, spellField, keys = RECORDED_FACT_KEYS) {
  if (recorded === null || typeof recorded !== 'object' || Array.isArray(recorded)) return {};
  const spelled = (value) => (typeof value === 'string' ? spellField(value)
    : Array.isArray(value) ? value.map(spelled)
    : value !== null && typeof value === 'object'
      ? Object.fromEntries(Object.entries(value).map(([key, item]) => [key, spelled(item)])) : value);
  const out = {};
  for (const key of keys) if (Object.hasOwn(recorded, key)) out[key] = spelled(recorded[key]);
  const change = out.unrecordedChange;
  if (change) {
    const since = ids.actAt(change.since?.turn, change.since?.seq);
    const commands = (change.commands ?? []).map((ref) => ids.actAt(ref?.turn, ref?.seq)).filter(Boolean);
    if (since) out.unrecordedChange = { since, commands }; else delete out.unrecordedChange;
  }
  return Object.keys(out).length ? { recorded: out } : {};
}
/**
 * C-02 M33 (4) refreeze: the closed sources of a TYPED interrupt mark (the slicer's
 * events.js MARK_SOURCES; this package reads the ledger and never imports the slicer). Only such a
 * mark becomes a `boundary: "interrupt"` event, at its row's position, with `relatedSession: null`.
 * A text-derived interrupt (a Claude interruption notice) carries no source and stays a mark. An
 * interrupt is not a window boundary (M35: no boundary is; a window holds whole segments, windows.js).
 */
export const LEDGER_TYPED_INTERRUPT_SOURCES = Object.freeze(['codex_turn_aborted']);
/**
 * M34 labels review (F2; C-02 "Slice-time labels", positional label gaps): the kind of the mark the slicer leaves at each
 * row whose label carries a positioned gap (events.js `LABEL_GAP_MARK`, re-declared: this package never imports the
 * slicer; a test holds the two equal), and the gaps it is left for (labels.js `POSITIONED_GAPS`, re-declared likewise).
 * Its position (`turn`, `beforeEvent`, `stream`, `record`) names where that row's loss is (`labelGapAnchors`). It is
 * never an event. It restores H2's positional gap (`opening_fallback`) under the labels.
 */
export const LEDGER_LABEL_GAP_MARK = 'label_gap';
export const LEDGER_POSITIONED_GAPS = Object.freeze(['legacy_recorder', 'interrupt_untyped']);
/**
 * C-02 M33 D: the closed sources of a command's terminal status proved without a numeric exit code
 * (the slicer's events.js COMMAND_STATUS_SOURCES, re-declared: this package never imports the
 * slicer). Either proves termination only: `exitCode` stays null, so no shell-write sibling can
 * borrow it (that needs a typed exit 0), and a test's semantic label is never upgraded by it.
 */
export const LEDGER_COMMAND_STATUS_SOURCES = Object.freeze(['claude_native_verdict', 'claude_task_notification']);
/**
 * D99 (F1 guard): what the slicer read of a background run's end that is no typed completion or failure (its event's
 * `backgroundEnd`; slicer events.js BACKGROUND_ENDS, re-declared: this package never imports the slicer; asserted equal
 * in the tests): `stopped` (its notification typed it stopped or killed), `unread` (no end read, none proved absent,
 * and a later record mentions the run) or `unchecked` (no end read, and Sonah could not check whether the recording
 * holds one: no later mention is established; review of A1b). Carried on the invocation as recorded; any other value
 * is not carried. The typed outcome reads it (ledger.js `resultOutcome`).
 */
export const LEDGER_BACKGROUND_ENDS = Object.freeze({ stopped: 'stopped', unread: 'unread', unchecked: 'unchecked' });
/** D99 (F1 guard): the note of the `command_outcome_unknown` gap that names the background runs whose end the slicer
 *  could not read while a later record mentions them (`backgroundEnd` `unread`), apart from every other command whose
 *  status the recording does not establish; review.js names it by its own cause (`ends_unread`). */
export const END_UNREAD_NOTE = 'later records mention these background runs, but Sonah could not read whether or how '
  + 'they ended';
/** D99 (review of A1b): the note of the `command_outcome_unknown` gap that names the background runs whose end the
 *  slicer could not read and could not check for (`backgroundEnd` `unchecked`): no later mention is established, so the
 *  note claims none. review.js names it by its own cause (`ends_unchecked`). */
export const END_UNCHECKED_NOTE = 'Sonah could not check whether the recording holds an end of these background runs';
/**
 * Status fact (owner decision 2026-10-06; C-02): why a zero status does not speak for every command of its line — the
 * slicer's events.js EXIT_STATUS_GAPS, re-declared (this package never imports the slicer; asserted equal in
 * test/status-fact.test.js). A ledger reason outside it is never copied.
 */
export const LEDGER_STATUS_GAPS = Object.freeze(['unreadable', 'substitution', 'sequence', 'or_list', 'pipeline',
  'background', 'negation', 'eval', 'nested_shell']);
/** Status fact: the typed verdicts a command's last status may be recorded by when it has no exit code (closed). */
export const LAST_STATUS_VERDICTS = Object.freeze(['completed', 'failed']);
/** C-02 M33 D: the Claude task-notification statuses that record a Workflow's final state. */
const WORKFLOW_NOTIFICATION_FINAL = Object.freeze(['completed', 'failed']);
/** C-03 M33 D: fixed notes for the Workflow losses (never built at a call site). */
export const WORKFLOW_GAP_NOTES = Object.freeze({
  agents: 'a workflow ran agents whose recordings are not linked or reviewed',
  unlaunched: 'a workflow call recorded no successful launch; any agents it started are not linked or reviewed',
  launched: 'a workflow was launched asynchronously without an attributable completed result',
  // The owner's answer of 2026-10-17 ("all as suggested", answer 8): such a launch whose end the slicer could not read
  // (D99 `backgroundEnd`), in the words approved for each reason: a later record mentions the run (`unread`), or no
  // later mention is established (`unchecked`). review.js names each by the background-end cause.
  launchedEndUnread: 'later records mention a workflow run that was launched asynchronously, but Sonah could not read '
    + 'whether or how it ended',
  launchedEndUnchecked: 'Sonah could not check whether the recording holds an end of a workflow run that was launched '
    + 'asynchronously',
  notified: 'a workflow completion was recorded only by a harness notification whose result text is not read',
  // C-03 M33 W2: a linked run's agents stand where the parent received the run's completion; with no receipt recorded
  // (the session ended first, or no completion joined the chain's last call) they keep the launch placement, declared.
  // M33 P repair: never ahead of parent work recorded after the launch (a run is asynchronous: unreceived, it may have
  // finished after any of it). Before the repair: at its launch, where d7226ec read it.
  unreceived: 'a workflow\'s agents are placed after the session\'s last request because the parent recorded no '
    + 'receipt of its completion',
  // D99 (F1 guard): a run with no receipt read whose end the slicer could not read, and could not prove absent.
  endUnread: 'later records mention a workflow run, but Sonah could not read whether or how it ended; its agents are '
    + 'placed after the session\'s last request',
  // D99 (review of A1b): the same, where no later mention of the run is established.
  endUnchecked: 'Sonah could not check whether the recording holds an end of a workflow run; its agents are placed '
    + 'after the session\'s last request',
  // M33 P (W2 recheck minor): a resumed run's agents stand at its LAST call's receipt, while an earlier call of the same
  // run recorded a receipt of its own; the journal records no call per agent, so which agent's work the parent received
  // at that earlier receipt is not recorded.
  resumedEarlier: 'a resumed workflow\'s agents are placed at its last call\'s receipt, though an earlier call of the run '
    + 'recorded its own receipt; which agent work the parent received earlier is not recorded',
});
/**
 * C-03 M33 W: a Claude Workflow run whose directory resolved is recorded on the ledger (`workflowRuns`: the call's
 * `turn` and `seq`, how many agents were `linked`, and each closed loss with its count). Its notes — the slicer's
 * closed vocabulary (slicer workflow-runs.js `WORKFLOW_RUN_NOTES`, re-declared: this package never imports the slicer;
 * asserted equal in the tests) — each become one `children` gap naming the Workflow call's event, with the code and
 * fixed note below, in this order. `workflow_run_unresolved` is never on a ledger: an unresolved run keeps the call's
 * M33 D declaration, whose note says exactly that (`WORKFLOW_GAP_NOTES.agents`).
 */
export const WORKFLOW_RUN_GAP_NOTES = Object.freeze({
  workflow_run_unresolved: WORKFLOW_GAP_NOTES.agents,
  workflow_journal_missing: 'a workflow run was found without its journal, so none of its agents were linked or reviewed',
  workflow_journal_unreadable: 'a workflow run journal had lines not in its recorded shape, so it was not read and none '
    + 'of its agents were linked or reviewed',
  workflow_agent_recording_missing: 'workflow agents were started but their recordings were missing, unreadable or past '
    + 'this review\'s reading limits, so their work was not reviewed',
  workflow_agent_unstarted: 'workflow agent recordings or results that no started line of their run names were not '
    + 'linked or reviewed',
  workflow_agent_identity_mismatch: 'workflow agent recordings whose recorded identity did not match their run, or could '
    + 'not be checked, were not linked or reviewed',
  workflow_agent_no_result: 'linked workflow agents recorded no result, so no report of theirs was attached',
  workflow_agent_result_conflict: 'linked workflow agents recorded conflicting results, so none of them was attached',
  workflow_nested_unlinked: 'a workflow run inside a helper past the frozen nesting depth was not linked or reviewed',
  workflow_run_entry_unread: 'entries of a workflow run directory that are not its journal, an agent recording or an '
    + 'agent meta file were not read or reviewed',
});
/** The closed notes of the calls whose recorded input Sonah holds only in part (each counted by call, naming each call's
 *  event): text redaction withheld (an earlier Sonah's; D90 masks nothing now), a field boundary the recorder separator
 *  hides, a payload with no validated fields, and a resumed workflow's script that this recording does not hold. D119
 *  names them by one cause (review.js). */
export const CALL_INPUT_GAP_NOTES = Object.freeze({
  code_redacted: 'recorded code bodies contain redacted or omitted source text',
  command_redacted: 'recorded command text was partly withheld by redaction',
  input_redacted: 'recorded tool input was partly withheld by redaction',
  tool_name_redacted: 'recorded tool name or input metadata was partly withheld by redaction',
  input_ambiguous: 'a tool input contained the recorder field separator, so its exact field boundaries were not preserved',
  input_unparsed: 'a tool input was recorded only as an unparsed payload, without validated fields',
  workflow_script_unrecorded: 'a resumed workflow named an earlier script path but did not record that script text here',
});
/** The closed note of a linked helper whose own ledger declares its capture incomplete (counted with no count, naming
 *  the hand-off's assignment event). D119 names it by its own cause (review.js). */
export const CHILD_CAPTURE_INCOMPLETE_NOTE = 'the linked child session declares an incomplete capture of its own';
/** `[note, gap code]` of every loss a run record may carry, in declaration order. */
export const WORKFLOW_RUN_GAPS = Object.freeze([
  Object.freeze(['workflow_journal_missing', 'incomplete_inventory']),
  Object.freeze(['workflow_journal_unreadable', 'incomplete_inventory']),
  Object.freeze(['workflow_agent_recording_missing', 'missing_child']),
  Object.freeze(['workflow_agent_unstarted', 'incomplete_inventory']),
  Object.freeze(['workflow_agent_identity_mismatch', 'identity_conflict']),
  Object.freeze(['workflow_agent_no_result', 'missing_result']),
  Object.freeze(['workflow_agent_result_conflict', 'missing_result']),
  Object.freeze(['workflow_nested_unlinked', 'incomplete_inventory']),
  Object.freeze(['workflow_run_entry_unread', 'incomplete_inventory']),
]);
/** C-03 M33 W: the delegation kind of a linked Workflow agent (slicer `WORKFLOW_AGENT_KIND`). */
const WORKFLOW_AGENT_KIND = 'workflow-agent';
/**
 * C-03 M33 P. The boundary that heads a helper's work placed where the parent RECEIVED its result. It carries no text.
 * `delivery` is the hand-off's event id, `assignments` the hand-offs whose work it heads. M33 P repair: a block whose
 * receipt is NOT proven (none recorded, or a queued assignment's `shared` report) is headed by the same boundary marked
 * `unproven: true`. M35 windowing (C-07): a helper is a session of its own, reviewed in its own windows, so no review
 * window shows this boundary or states a placement line any more (the prompt.js helper lines are gone); the placement
 * stays in the canonical session, where the session story reads it (render/session-story.js).
 */
export const HELPER_RECEIPT_BOUNDARY = 'helper_receipt';
/**
 * C-03 M33 P: the closed notes of a helper segment whose receipt is not proven. `unreceived`: none recorded — placed
 * after its delivery request's own work (M33 P repair: never ahead of parent work recorded after its delivery).
 * `shared` (M33 P repair): a queued assignment whose first report after its delivery received an earlier assignment —
 * placed at the helper's next report, or after the request that received the earlier one.
 */
export const HELPER_PLACEMENT_NOTES = Object.freeze({
  // M33 P second repair: after the SESSION's last request (before it, the delivery request's).
  unreceived: 'a helper\'s work is placed after the session\'s last request because the parent recorded no receipt '
    + 'of its result',
  shared: 'a helper\'s assignment was sent before its earlier assignment\'s report arrived, so that report is not proven '
    + 'to be its receipt; its work is placed at the helper\'s next report, or after the session\'s last request',
  // M33 P second repair: a helper that reported more often than its parent assigned it work, or received an encrypted
  // message that is no assignment of its parent: which report received the work from there on is not recorded.
  ambiguous: 'a helper reported more often than its parent assigned it work, or received a message that is no '
    + 'assignment of its parent, so which report received this work is not recorded; it is placed after the session\'s '
    + 'last request',
});
/**
 * C-03 M33 P: the fixed notes of a send that split no helper history, by the slicer's closed reason
 * (helper-deliveries.js `HELPER_DELIVERY_REASONS`, re-declared: this package never imports the slicer; asserted equal
 * in the tests). Each is one counted `children` `incomplete_inventory` gap naming the sends' events. `unreadable`
 * declares a recorded loss this adapter could not read (never dropped).
 */
export const HELPER_DELIVERY_GAP_NOTES = Object.freeze({
  helper_delivery_unmatched: 'an assignment\'s encrypted payload was found in no linked helper\'s recording, so its '
    + 'delivery is not proven',
  helper_delivery_ambiguous: 'an assignment\'s encrypted payload was recorded more than once, so its delivery is not proven',
  helper_delivery_conflict: 'an assignment\'s encrypted payload was received by another helper than the one its hand-off '
    + 'linked, so its delivery is not proven',
  helper_delivery_order: 'a helper received its assignments in another order than the parent sent them, so its history '
    + 'is not split by assignment',
  helper_followup_unproven: 'a follow-up\'s delivery is not proven, so its helper\'s history is not split by assignment',
  helper_arrival_unmatched: 'a helper received an encrypted message that matched no assignment of its parent, so its '
    + 'history is not split there',
  // M33 P second repair: a Claude agent the parent continued (its own recording records a later request).
  helper_continued_unproven: 'a helper\'s own recording received a later request from its parent whose receipt is not '
    + 'recorded, so its work after that request is placed after the session\'s last request',
  // L2: a Claude agent whose hand-off result recorded no typed launch status.
  helper_launch_mode_unknown: 'a helper\'s hand-off result recorded no typed launch status, so whether the parent waited '
    + 'for it or received it later is not recorded; its work is placed after the session\'s last request',
  // D99 (F1 guard): a Claude agent run in the background whose end Sonah could not read, and could not prove absent.
  helper_end_unread: 'later records mention a helper that ran in the background, but Sonah could not read whether or '
    + 'how it ended; its work is placed after the session\'s last request',
  // D99 (review of A1b): the same, where no later mention of it is established.
  helper_end_unchecked: 'Sonah could not check whether the recording holds an end of a helper that ran in the '
    + 'background; its work is placed after the session\'s last request',
  unreadable: 'a recorded helper delivery loss could not be read',
});
/** D99 (F1 guard): the helper delivery losses of a background agent whose end the slicer could not read. */
const HELPER_END_UNREAD = Object.freeze(['helper_end_unread', 'helper_end_unchecked']);
/** C-03 M33 P: the exact Codex names of a send_message action (slicer helper-deliveries.js `CODEX_SEND_NAMES`). */
const CODEX_SEND_NAMES = Object.freeze(['send_message', 'collaboration.send_message']);
/** C-03 D175: the exact Claude Code name of the action whose typed result records the helper it resumed (slicer
 *  events.js, the `resume` launch). */
const CLAUDE_SEND_NAMES = Object.freeze(['SendMessage']);
/** Internal options of `sessionFromLedger` (never part of its public shape). */
const LAUNCH_LAYOUT = Symbol('the launch layout: every helper at its delivery, only to read commentary ids');
const CHILD_SESSIONS = Symbol('child sessions already adapted in this review');
const PLACEMENT_FACTS = Symbol('where each event of a session was recorded, for a parent to cut its history');
const COMMENTARY_IDS = Symbol('the ids of a session\'s working commentary, in emission order');
const countOf = (value, least = 0) => Number.isSafeInteger(value) && value >= least;
/** C-03 M33 P: a recorded row, exactly `{turn, beforeEvent, source, record}`, or null (slicer `helperRow`). */
function receiptRow(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length !== 4
    || !['turn', 'beforeEvent', 'source', 'record'].every((key) => Object.hasOwn(value, key))
    || !countOf(value.turn) || !countOf(value.beforeEvent) || !countOf(value.source) || !countOf(value.record, 1)) return null;
  return { turn: value.turn, beforeEvent: value.beforeEvent, source: value.source, record: value.record };
}
/** Recorded order of two rows of one lineage (its files are read in order). */
const rowAfterRow = (a, b) => a.source > b.source || (a.source === b.source && a.record > b.record);
/** The two losses of a LINKED agent (its report), each also named on the agent's delegation (`reportLoss`). */
const WORKFLOW_REPORT_LOSSES = Object.freeze(['workflow_agent_no_result', 'workflow_agent_result_conflict']);
/** Is `d` a linked Workflow agent of the call at `turn`/`seq`? */
const workflowAgentOf = (d, { turn, seq }) => d?.kind === WORKFLOW_AGENT_KIND && d.status === 'linked'
  && d.turn === turn && d.workflowSeq === seq;
/** A recorded workflowName shown as a plain field: a plain identifier only (slicer `plainWorkflowName`), else none. */
const plainWorkflowName = (value) => typeof value === 'string' && value.length <= 64
  && /^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(value);
const SOURCE_ADAPTERS = new Set(['claude', 'codex', 'cursor']);

/** Numeric native locators retain a proof trail without exporting opaque call IDs or source
 *  text. Optional result/sidecar records are accepted only after the slicer proved their links.
 *  Invalid or historical locator shapes are omitted, never repaired by position. */
function sourceLocatorOf(act) {
  const locator = act?.sourceLocator;
  if (!locator || !Number.isSafeInteger(locator.stream) || locator.stream < 0
    || !Number.isSafeInteger(locator.record) || locator.record < 1
    || !Number.isSafeInteger(locator.part) || locator.part < 0
    || (locator.resultRecord != null && (!Number.isSafeInteger(locator.resultRecord) || locator.resultRecord < 1))
    || (locator.fileChangeRecord != null && (!Number.isSafeInteger(locator.fileChangeRecord) || locator.fileChangeRecord < 1))
    || (locator.commandExecutionRecord != null && (!Number.isSafeInteger(locator.commandExecutionRecord)
      || locator.commandExecutionRecord < 1))) return null;
  return { stream: locator.stream, record: locator.record, part: locator.part,
    ...(locator.resultRecord != null ? { resultRecord: locator.resultRecord } : {}),
    ...(locator.fileChangeRecord != null ? { fileChangeRecord: locator.fileChangeRecord } : {}),
    ...(locator.commandExecutionRecord != null ? { commandExecutionRecord: locator.commandExecutionRecord } : {}) };
}

/** The slicer supplies one parser-owned source identity per recording when it includes sources.
 *  A conflict in a source's session ID does not undo the parser's adapter classification (Cursor
 *  has no in-band session identity at all). A mixed or unrecognised parser set establishes no
 *  single canonical adapter; it also leaves coverage incomplete. Persisted pre-source ledgers
 *  keep their historical Claude default. Neither paths nor prose are used as a source label. */
function adapterOf(ledger) {
  const sources = ledger.sources;
  if (!Array.isArray(sources) || sources.length === 0) return 'claude';
  const adapters = sources.map((source) => source?.adapter);
  return adapters.every((adapter) => adapter === adapters[0]) && SOURCE_ADAPTERS.has(adapters[0])
    ? adapters[0] : 'unknown';
}

/**
 * C-01 event identity (stable event ids, 2026-10-07; contract C-01 "Event identity"). Every canonical event is
 * named by the RECORDER's own identity of what it was read from — the ledger element's `identity` (slicer
 * event-identity.js): a Claude Code row's uuid and content block, a Codex call's call_id (or a message's item id) and
 * part, else the row's position (`s<stream>.L<line>`) — and a derived sub-event by a fixed suffix of the event it is
 * derived from (`.r` an observation of its call, `.head`/`.tail` a cut closing statement, `.receipt<k>` a helper's
 * receipt boundary). Never by a turn, a sequence or an ordinal: an id is opaque, and order is `sequence`. An element
 * whose id cannot be derived from what the recorder wrote is still named — and counted under one closed reason:
 *   event_id_unrecorded        the ledger records no identity for it (an older slicer's ledger, or one a caller built):
 *                              its id is the positional one every ledger had before (`A<turn>-<seq>`, …);
 *   event_id_row_unidentified  a Claude Code row that recorded no uuid: named by its row position;
 *   event_id_withheld          redaction withheld the recorder's id (fails closed): named by its row position;
 *   event_id_duplicate         the recorder's id names an earlier element too (a row repeated in the lineage): named by
 *                              its row position.
 * (A Codex or Cursor row the recorder wrote no id for is named by its position by the recorder's own rule: no gap.)
 * Counted per event over the session's own events (`eventIdCounts`), never a coverage loss: nothing is missing.
 */
export const EVENT_ID_GAPS = Object.freeze({
  unrecorded: 'event_id_unrecorded',
  rowUnidentified: 'event_id_row_unidentified',
  withheld: 'event_id_withheld',
  duplicate: 'event_id_duplicate',
});
/** The slicer's event-identity.js `NATIVE_ID`, `IDENTITY_SUB` and `IDENTITY_KEYS`, re-declared (this package never
 *  imports the slicer; test/stable-event-ids.test.js holds them equal). */
export const IDENTITY_NATIVE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;
export const IDENTITY_SUB = /^(?:[wag](?:0|[1-9]\d{0,5})|final|compaction|join|interrupt)$/;
export const IDENTITY_KEYS = Object.freeze(['stream', 'record', 'block', 'native', 'sub', 'unidentified', 'withheld']);
const EVENT_ID_COUNTS = Symbol('how each of a session\'s own events was named (C-01 event identity)');

/** Is `value` an identity the slicer writes (or redaction left)? Anything else is no identity: the element keeps its
 *  positional id (`event_id_unrecorded`). */
function recordedIdentity(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).some((key) => !IDENTITY_KEYS.includes(key))) return false;
  return countOf(value.stream) && countOf(value.record, 1)
    && (value.block === undefined || countOf(value.block))
    && (value.native === undefined || (typeof value.native === 'string' && IDENTITY_NATIVE.test(value.native)))
    && (value.sub === undefined || (typeof value.sub === 'string' && IDENTITY_SUB.test(value.sub)))
    && (value.unidentified === undefined || value.unidentified === true && value.native === undefined)
    && (value.withheld === undefined || value.withheld === true && value.native === undefined)
    && (value.block !== undefined || value.sub !== undefined);
}

/** The parts after an identity's base: its block, then its sub-event. */
const identityParts = (identity) => [...(identity.block !== undefined ? [String(identity.block)] : []),
  ...(identity.sub !== undefined ? [identity.sub] : [])];

/** The ledger fields whose elements become canonical events, in the order their ids are claimed (each in ledger order,
 *  which is recorded order: of two elements one recorded id names, the first keeps it). */
const IDENTIFIED_FIELDS = Object.freeze(['ask', 'instructions', 'interjections', 'ledger', 'commentary', 'sayings',
  'marks', 'delegations', 'projectInstructions']);

/**
 * C-01 event identity: the id of every ledger element that carries an identity, claimed once per adaptation and handed
 * to every reader of that ledger in it, so all of them read the same ids. `of(element)` is the element's id, or null
 * when it has none (the caller names it by its positional id); `gapOf(id)` the closed reason an id was not derived from
 * the recorder's own id, or null; `derived(id)` whether the id was derived from an identity (its sub-events take
 * `.<suffix>`; a positional id's take `-<suffix>`, as they always did). `actAt(turn, seq)` names the ledger's action at
 * that recorded position.
 */
function ledgerEventIds(ledger) {
  const named = new Map();
  const gaps = new Map();
  for (const field of IDENTIFIED_FIELDS) {
    for (const element of Array.isArray(ledger?.[field]) ? ledger[field] : []) {
      if (element === null || typeof element !== 'object' || !recordedIdentity(element.identity)) continue;
      const identity = element.identity;
      const byRow = [`s${identity.stream}`, `L${identity.record}`, ...identityParts(identity)].join('.');
      let id = identity.native !== undefined ? [identity.native, ...identityParts(identity)].join('.') : byRow;
      let gap = identity.native !== undefined ? null : identity.withheld === true ? EVENT_ID_GAPS.withheld
        : identity.unidentified === true ? EVENT_ID_GAPS.rowUnidentified : null;
      if (gaps.has(id)) { id = byRow; gap = EVENT_ID_GAPS.duplicate; }
      // A row position names one element of one block; a second claim of it is no identity (positional, counted).
      if (gaps.has(id)) continue;
      gaps.set(id, gap);
      named.set(element, id);
    }
  }
  const acts = new Map();
  for (const act of Array.isArray(ledger?.ledger) ? ledger.ledger : []) {
    const key = `${act?.turn}:${act?.seq}`;
    if (!acts.has(key)) acts.set(key, act);
  }
  const ids = {
    of: (element) => named.get(element) ?? null,
    gapOf: (id) => (gaps.has(id) ? gaps.get(id) : EVENT_ID_GAPS.unrecorded),
    derived: (id) => gaps.has(id),
    /** The id of an action: derived from its identity, else positional (`A<turn>-<seq>`). */
    act: (act) => named.get(act) ?? `A${act?.turn}-${act?.seq}`,
    /** The id of the ledger's action recorded at `turn`/`seq` (positional when the ledger records none there). */
    actAt: (turn, seq) => ids.actAtKey(`${turn}:${seq}`),
    /** The same, by a run record's `turn:seq` key. */
    actAtKey: (key) => (acts.has(key) ? ids.act(acts.get(key)) : `A${String(key).replace(':', '-')}`),
    /** Does the ledger record an action at `turn`/`seq`? */
    hasActAt: (turn, seq) => acts.has(`${turn}:${seq}`),
    /** The id of a hand-off: derived from its identity, else positional (`D<turn>-<index>`). */
    delegation: (delegation, index) => named.get(delegation) ?? `D${delegation?.turn}-${index}`,
    /** A sub-event of `id`: `<id>.<suffix>` when `id` was derived from an identity (and counted as `id` is),
     *  `<id>-<suffix>` (as before) else. */
    sub: (id, suffix) => {
      if (!gaps.has(id)) return `${id}-${suffix}`;
      const sub = `${id}.${suffix}`;
      if (!gaps.has(sub)) gaps.set(sub, gaps.get(id));
      return sub;
    },
  };
  return ids;
}

/** `ledger` with every recorded identity taken out (its children's too): the ledger an adapter before stable ids read. */
function withoutIdentity(ledger) {
  if (ledger === null || typeof ledger !== 'object' || Array.isArray(ledger)) return ledger;
  const out = { ...ledger };
  for (const field of IDENTIFIED_FIELDS) if (Array.isArray(out[field]))
    out[field] = out[field].map((element) => (element !== null && typeof element === 'object' && !Array.isArray(element)
      && Object.hasOwn(element, 'identity') ? (({ identity, ...rest }) => rest)(element) : element));
  if (Array.isArray(out.children)) out.children = out.children.map((unit) => (unit !== null && typeof unit === 'object'
    && unit.ledger ? { ...unit, ledger: withoutIdentity(unit.ledger) } : unit));
  return out;
}

/**
 * C-01 event identity, for migration only: the positional id each event of `ledger` had before stable ids (`A<turn>-<seq>`,
 * `I<turn>`, `C<turn>-<slot>-<ordinal>`, …), mapped to the id it has now. The same ledger is adapted twice — as it is,
 * and with every recorded identity taken out — and the two sessions hold the same events in the same order (an id
 * orders nothing), so the map pairs them by position. For re-keying what was stored under the old ids (a stored
 * report); the review never reads it. Throws when the two sessions do not pair event for event.
 */
export function positionalEventIds(ledger, options = {}) {
  const now = sessionFromLedger(ledger, options);
  const before = sessionFromLedger(withoutIdentity(ledger), options);
  if (now.events.length !== before.events.length || now.events.some((event, at) => event.kind !== before.events[at].kind
    || event.sequence !== before.events[at].sequence))
    throw new Error('positionalEventIds: the two adaptations do not pair event for event');
  return new Map(before.events.map((event, at) => [event.id, now.events[at].id]));
}

/** C-01 event identity: how a session's own events were named — `{ events, derived, gaps: { <closed reason>: n } }`
 *  (a transferred child's events are counted by the child's own session), or null for a session this adapter did not
 *  build. */
export function eventIdCounts(session) {
  return session?.[EVENT_ID_COUNTS] ?? null;
}

/** A failed launch has a known terminal outcome and started no child to review. All other
 *  unlinked hand-offs remain unreviewed, with their exact failure reason mapped below. */
const unlinkedDelegations = (ledger) => (ledger.delegations ?? [])
  .filter((d) => d && d.status !== 'linked' && d.status !== 'failed');

// Closed, source-owned reasons. An incomplete inventory proves neither that a child exists nor
// that it is absent. A complete inventory's unmatched *spawn* can establish absence; a follow-up
// with no earlier verified spawn cannot. Notes are fixed strings, never raw parser or tool text.
const CHILD_GAP_BY_REASON = Object.freeze({
  child_inventory_incomplete: ['incomplete_inventory', 'the child recording inventory could not be verified'],
  child_recording_limit: ['storage_limit', 'the child recording exceeded a declared reading limit'],
  child_recording_cycle: ['identity_conflict', 'the child recording link formed a cycle'],
  child_recording_unavailable: ['source_unreadable', 'the linked child recording could not be read'],
  child_recording_changed: ['source_changed', 'the child recording changed between identity and action reads'],
  child_link_identity_redacted: ['identity_redacted', 'a required child-link identity was redacted'],
  child_link_source_conflict: ['identity_conflict', 'candidate child source identities conflicted'],
  child_link_identity_conflict: ['identity_conflict', 'independent child identities disagreed'],
  child_link_ambiguous: ['ambiguous_child', 'the hand-off matched more than one child recording'],
  child_link_order_unchecked: ['incomplete_inventory', 'the follow-up order could not be verified'],
  child_link_parent_invalid: ['incomplete_inventory', 'the parent recording identity could not be verified'],
  child_link_source_invalid: ['incomplete_inventory', 'the child source identity could not be verified'],
  child_link_descriptor_invalid: ['incomplete_inventory', 'the hand-off identity could not be verified'],
  delegation_child_unchecked: ['incomplete_inventory', 'the hand-off could not be verified against a child recording'],
  delegation_turn_invalid: ['incomplete_inventory', 'the hand-off turn could not be verified'],
  delegation_source_invalid: ['incomplete_inventory', 'the hand-off source could not be verified'],
  delegation_call_invalid: ['identity_conflict', 'the hand-off call identity was invalid'],
  delegation_call_ambiguous: ['identity_conflict', 'the hand-off call identity was ambiguous'],
  delegation_child_ambiguous: ['ambiguous_child', 'the hand-off matched more than one child identity'],
  delegation_result_ambiguous: ['ambiguous_child', 'the hand-off has conflicting result receipts'],
  delegation_result_malformed: ['unsupported_message', 'the hand-off result was not in a supported shape'],
  delegation_result_missing: ['missing_result', 'the hand-off has no recorded result'],
  delegation_result_unmatched: ['missing_result', 'the hand-off result did not match its call'],
});
/**
 * C-02 M33 native-first refreeze: is the counted native inventory shortfall this recording's ONLY
 * incomplete cause? Then the generic uncounted `actions` gap is not declared beside it — the counted
 * gap already states the loss — exactly as a communication-only capture's is not. Fails closed: the
 * shortfall must be a positive count, the slicer's only capture reason and only drop, and every
 * other capture loss counter, row channel, source identity and hand-off must be clean.
 * Anything else keeps the generic gap.
 */
function nativeShortfallOnly(ledger) {
  const capture = ledger?.capture;
  if (capture === null || typeof capture !== 'object' || capture.incomplete !== true) return false;
  if (!Number.isSafeInteger(capture.nativeInventoryShortfall) || capture.nativeInventoryShortfall <= 0) return false;
  if (!Array.isArray(capture.reasons) || capture.reasons.length !== 1
    || capture.reasons[0] !== NATIVE_INVENTORY_REASON) return false;
  if (OTHER_CAPTURE_LOSS_COUNTS.some((key) => Object.hasOwn(capture, key) && capture[key] !== 0)) return false;
  const clean = (value, ok) => value == null || (typeof value === 'object' && !Array.isArray(value)
    && Object.values(value).every(ok));
  if (!clean(capture.unsupportedRowChannels, (count) => count === 0)) return false;
  const dropped = ledger.dropped ?? [];
  if (!Array.isArray(dropped) || dropped.some((drop) => drop?.reason !== NATIVE_INVENTORY_REASON)) return false;
  const sources = ledger.sources ?? [];
  if (!Array.isArray(sources) || sources.some((source) => source?.identityConflict === true
    || source?.identityUnchecked === true)) return false;
  return unlinkedDelegations(ledger).length === 0;
}

function unlinkedChildGap(delegation) {
  if (delegation?.reason === 'child_link_unavailable') return delegation.kind === 'followup'
    ? ['incomplete_inventory', 'the follow-up has no earlier verified child link']
    : ['missing_child', 'a complete inventory had no matching child recording'];
  return CHILD_GAP_BY_REASON[delegation?.reason]
    ?? ['incomplete_inventory', 'the hand-off could not be verified against a child recording'];
}

// B2. A linked child is TRANSFERRED, not merely declared: its events are spliced into the
// reviewed session directly after the delegate event that assigned the work, because in an
// agent-delegated workflow the children's sessions ARE the session. Flattened, not nested:
// `windows.js`, `run-review.js` and `review.js` all read `session.events` in order, and the
// C-03 ChildLink on `session.children` is the only other shape `ledger.js` already consumes
// (it suppresses the missing_child gap on `state: 'verified'`). A nested review would need a
// third shape and a second pass in run-review.js, which this change does not own.
//
// Renaming is mechanical: every id and every blob key the child owns is prefixed, so nothing
// it carries can collide with, or be mistaken for, the parent's own evidence.
const CHILD_PREFIX = (childId) => `child:${childId}:`;
/** A Codex task tuple can prove a child even when its opaque ID was redacted. The source-array
 * ordinal cannot name that child: linking an earlier sibling shifts every later ordinal. Hash
 * only the already-redacted, verified parent ID and canonical task path. `|` is excluded from
 * native opaque IDs, so this namespace cannot collide with one of those IDs. */
function tupleChildId(ledger, delegation) {
  const parent = ledger.sources?.[delegation.source];
  const parentId = parent?.sessionId;
  const task = delegation.taskName;
  if (delegation.adapter !== 'codex' || parent?.adapter !== 'codex'
    || parent.identityConflict === true
    || typeof parentId !== 'string' || parentId.length > 200
    || !/^[A-Za-z0-9_][A-Za-z0-9_./:-]*$/.test(parentId)
    || typeof task !== 'string' || task.length > 200
    || !CANONICAL_TASK.test(task)) return null;
  return `tuple|${createHash('sha256').update(JSON.stringify([parentId, task])).digest('hex')}`;
}
const TEXT_REF_FIELDS = Object.freeze(['text', 'command', 'input', 'output']);
const EVENT_ID_FIELDS = Object.freeze(['invocation', 'callKey', 'beforeInvocation', 'shellWriteOf', 'workflowCall',
  'workflowRun', 'deliveredBy', 'delivery', 'answerTo', 'interruptedBy']);

/** C-02 `turn`: the slicer's recorded human-turn index, as the string the contract types it as. */
const turnIdentity = (turn) => `T${turn}`;

function renameChildEvent(event, prefix, childId) {
  // An event transferred through two hand-offs keeps the id of the agent that performed it.
  const moved = { ...event, id: prefix + event.id, childId: event.childId ?? childId };
  // Its turn is the child's own, named under the same prefix: a child's first turn is never the
  // parent's first turn.
  if (typeof moved.turn === 'string' && moved.turn) moved.turn = prefix + moved.turn;
  for (const field of EVENT_ID_FIELDS)
    if (typeof moved[field] === 'string' && moved[field]) moved[field] = prefix + moved[field];
  // M33 P: the hand-offs a receipt boundary heads are this child's events too.
  if (Array.isArray(moved.assignments))
    moved.assignments = moved.assignments.map((id) => (typeof id === 'string' && id ? prefix + id : id));
  // M33 P second repair: so are the actions a receipt boundary names as held before the helper's events.
  if (Array.isArray(moved.held)) moved.held = moved.held.map((id) => (typeof id === 'string' && id ? prefix + id : id));
  const refs = (list) => list.map((ref) => ({ ...ref, sourceKey: prefix + ref.sourceKey }));
  for (const field of TEXT_REF_FIELDS)
    if (Array.isArray(moved[field])) moved[field] = refs(moved[field]);
  // M36 phase 2 review: every text ref and event id a change carries is the child's — an Edit's own replaced text
  // (`replaced`, M36 phase 2) and the event that recorded its prior state (`priorRecord.eventId`) too — and so is every
  // event the recorder facts name (`recorded.unrecordedChange`).
  if (Array.isArray(moved.changes))
    moved.changes = moved.changes.map((c) => ({ ...c,
      ...(Array.isArray(c?.after) && c.after.length ? { after: refs(c.after) } : {}),
      ...(Array.isArray(c?.before) && c.before.length ? { before: refs(c.before) } : {}),
      ...(Array.isArray(c?.replaced) && c.replaced.length ? { replaced: refs(c.replaced) } : {}),
      ...(typeof c?.priorRecord?.eventId === 'string' && c.priorRecord.eventId
        ? { priorRecord: { ...c.priorRecord, eventId: prefix + c.priorRecord.eventId } } : {}) }));
  const change = moved.recorded?.unrecordedChange;
  if (change && typeof change.since === 'string') {
    moved.recorded = { ...moved.recorded, unrecordedChange: { ...change, since: prefix + change.since,
      commands: (Array.isArray(change.commands) ? change.commands : [])
        .map((id) => (typeof id === 'string' && id ? prefix + id : id)) } };
  }
  return moved;
}

const relationOf = (delegation) => (delegation.kind === 'followup' ? 'followup' : 'spawn');

/**
 * One C-03 ChildLink, plus a handle on the child's own Session for a caller that wants to read
 * it as a session in its own right. The handle is deliberately NOT enumerable: `children` was
 * hashed into every window's reuse key (the removed PR route's `reviewDependencies`), and a
 * serialized child session there would re-encode the child's whole evidence once per window
 * while changing nothing — the child's events are already in `window.events`. The link's own
 * facts stay enumerable, so what a digest of `children` depends on is visible.
 */
function childLink(fields, session) {
  return Object.defineProperty({ ...fields }, 'session',
    { value: session, enumerable: false, writable: false, configurable: false });
}

export function sessionFromLedger(ledger, options = {}) {
  const { sessionKey = 'session' } = options ?? {};
  // C-03 M33 P: the launch layout places every helper at its delivery (the placement before W2 and P). It is read only
  // for the ids of this session's working commentary, so placement at a receipt renumbers none of them.
  const launchLayout = options?.[LAUNCH_LAYOUT] === true;
  // Each linked child is adapted once per review: both layouts, and every piece of its history, share that session.
  const childSessions = options?.[CHILD_SESSIONS] instanceof WeakMap ? options[CHILD_SESSIONS] : new WeakMap();
  const adapter = adapterOf(ledger);
  // C-01 event identity: every element's id, claimed once for this adaptation (`ledgerEventIds`).
  const ids = ledgerEventIds(ledger);
  // D90: does the record declare an earlier redactor's work on a field (`redactorDeclared`)? Only then is a field's
  // mark-shaped text that redactor's.
  const redactorField = redactorDeclared(ledger);
  const blobs = {};
  const events = [];
  let sequence = 0;
  let blobN = 0;
  let boundaryN = 0;
  let interruptN = 0;           // typed interrupt boundaries emitted for this session's own marks
  let childInterruptN = 0;      // interrupt boundaries transferred in with a linked child's events
  let receiptN = 0;             // M33 P: helper receipt boundaries emitted for this session's own helpers
  const receiptsOf = new Map(); // C-01 event identity: receipt boundaries emitted so far, by their delivery's id
  let childReceiptN = 0;        // M33 P: helper receipt boundaries transferred in with a linked child's events
  const commentaryIds = [];     // M33 P: the ids of this session's working commentary, in emission order
  let launchIds = null;         // M33 P: the same ids in the launch layout, when a placement crossed a turn
  // M33 P: where each of this session's own events was recorded (turn, the actions recorded before it, its row): the
  // facts a parent cuts this session's history by, at the arrival of each assignment it delivered.
  const factOf = new Map();
  let clippedSayings = 0;
  let elidedAsks = 0;
  let cappedAsks = 0;
  let strippedAsks = 0;
  // OWNER DECISION B (2026-10-01): the instruction event ids each of those three gaps names.
  const elidedIds = [], cappedIds = [], strippedIds = [];
  const withheldAsks = [];    // W3e-4 / F204: instruction event ids redaction left no words of
  let heardN = 0;             // OWNER DECISION B: in-turn human instructions emitted (never counted in a commentary id)
  let controlCharsReplaced = 0; // W3e-6 / F213: NULs stored as NUL_SYMBOL, this session's and its children's

  /** W3e-6 / F213. `text` as this session stores it: every NUL spelled as NUL_SYMBOL, and counted.
   *  Every text the adapter stores or renders from the record passes through here exactly once. */
  const spell = (text) => {
    const whole = String(text ?? '');
    if (!whole.includes('\u0000')) return whole;
    return whole.replace(NUL, () => { controlCharsReplaced++; return NUL_SYMBOL; });
  };
  /** The same, for an event field that may be absent or not text: only a string is stored spelled. */
  const spellField = (value) => (typeof value === 'string' ? spell(value) : value);

  const put = (text) => {
    const key = `b${blobN++}`;
    blobs[key] = spell(text);
    return [{ sourceKey: key, fromByte: 0, untilByte: Buffer.byteLength(blobs[key], 'utf8') }];
  };

  /** Store `text`, but expose it as the ranges BETWEEN the recorder's elision stubs: head and
   *  tail are two refs, never one span across a marker the human never wrote. The byte offsets are
   *  measured on the stored (spelled) text, which is the text they index. */
  const putAround = (text, marker) => {
    const key = `b${blobN++}`;
    const whole = spell(text);
    blobs[key] = whole;
    const refs = [];
    let cursor = 0;
    marker.lastIndex = 0;
    for (const match of whole.matchAll(marker)) {
      if (match.index > cursor)
        refs.push({ sourceKey: key, fromByte: Buffer.byteLength(whole.slice(0, cursor), 'utf8'),
          untilByte: Buffer.byteLength(whole.slice(0, match.index), 'utf8') });
      cursor = match.index + match[0].length;
    }
    if (cursor < whole.length)
      refs.push({ sourceKey: key, fromByte: Buffer.byteLength(whole.slice(0, cursor), 'utf8'),
        untilByte: Buffer.byteLength(whole, 'utf8') });
    return refs.length ? refs : [{ sourceKey: key, fromByte: 0, untilByte: 0 }];
  };
  /** A text a person or an agent wrote, placed whole; around an earlier redactor's marks only where its field declares
   *  them (`declared`, from `declaresRedaction`). */
  const putProse = (text, declared = false) => (declared ? putAround(text, PROSE_OMISSION) : put(text));
  const withMarks = (declared, marker) => new RegExp(declared ? `${PROSE_OMISSION.source}|${marker.source}` : marker.source, 'g');
  const putOutput = (text, clipped, declared = false) => clipped
    ? putAround(text, withMarks(declared, OUTPUT_OMISSION))
    : putProse(text, declared);
  /** M33 F repair. A helper's final report: its cut is this review's own marker (`REPORT_OMISSION`). */
  const putReport = (text, clipped, declared = false) => clipped
    ? putAround(text, withMarks(declared, REPORT_OMISSION))
    : putProse(text, declared);
  /** M33 F repair 3. A closing statement this review cut: its marker (and any older '[…]' line) is never quotable. */
  const putStatement = (text, declared = false) => putAround(text,
    withMarks(declared, new RegExp(`${STATEMENT_OMISSION.source}|(?:^|\\n)\\[\u2026\\](?=\\n|$)`)));
  /**
   * M33 F. The helper's final report, attached by the slicer by exact recorded identity, is what the parent RECEIVED:
   * the hand-off `id`'s own recorded result, an observation like any tool result (`<id>-r`), emitted where it arrived
   * (see `reportArrivals`). It proves the helper reported back and nothing more: the result is not judged (`unknown`,
   * never `succeeded`), so no status, link or gap of the hand-off changes. Its text is quotable (role observation);
   * this review's cut is never inside a quotable span (`putReport`).
   */
  const emitReport = (id, report, turnOf = null) => events.push({ id: ids.sub(id, 'r'), kind: 'observation',
    sequence: sequence++,
    invocation: id, callKey: id, phase: 'terminal', result: 'unknown', exitCode: null,
    output: putReport(report.text, report.truncated, report.redacted), sourceOfResult: 'native', helperReported: true,
    // M33 P: a W2 agent's closing report placed at a later turn's receipt keeps its hand-off's C-02 turn (and part).
    ...(turnOf !== null ? { turn: turnIdentity(turnOf) } : {}) });

  /**
   * B1. One side of a C-02 Change: the file body the recorder kept, as the REDACTOR left it.
   *
   * The only input is `before.text` / `after.text` on the ledger entry. `redact()` scrubs both
   * with `scrubLines` — PEM blocks dropped whole, secret-named values masked in place,
   * unclassifiable high-entropy lines dropped and declared — and it does so BEFORE `slice_hash`
   * is computed, so by the time a ledger reaches this adapter every body has already been
   * through that scrub. Nothing here reads `argsExcerpt`, the raw tool input or any other
   * field: those are separate channels with separate postures, and one of them is the reason
   * write bodies were never placed in the first place.
   *
   * The blob stores exactly what redaction produced. The REFS say which parts of it are the
   * session's own text: a head-truncation stub is excluded, so the recorder's words can never
   * be quoted as written code, and the extent states the cut instead. The redactor's note is
   * excluded the same way (W3e-1 / F184) whenever the field declares dropped lines, and the
   * extent's `redactedLines` states them instead.
   *
   * F128: an EMPTY written body is a recorded fact — a `Write` whose content is '' wrote the
   * empty string, and since W3c-9 the recorder keeps that `after`. Reading it as absent made it
   * `recorded: false`, a write the recording supposedly lacks. With `empty: true` (the written
   * side only) it is placed as what it is: recorded, zero characters, nothing quotable. The same
   * rule F107 gave `placeBodyParts`. A body with no `text` field at all still states nothing.
   */
  const placeBody = (body, { empty = false } = {}) => {
    if (!body || typeof body.text !== 'string') return null;
    if (!body.text.length) {
      if (!empty) return null;
      const redactedLines = Number.isFinite(body.redactedLines) ? body.redactedLines : 0;
      return { refs: [], redacted: redactedLines > 0 || body.redacted === true,
        extent: { chars: 0, lines: 0, truncated: false, cap: null, recorded: true, redactedLines } };
    }
    const whole = body.text;
    const truncated = body.truncated === true;
    const redactedLines = Number.isFinite(body.redactedLines) ? body.redactedLines : 0;
    const noted = redactedLines > 0;
    // D90: a mark-shaped string is an earlier redactor's only where the record declares its work (`redactorDeclared`).
    const declared = redactorField(body);
    const markers = [truncated ? BODY_TRUNCATION.source : null,
      noted ? REDACTION_NOTE.source : null,
      declared && whole.includes('‹redacted') ? REDACTION_TOKEN.source : null,
      declared && whole.includes('‹dropped') ? DROPPED_TOKEN.source : null].filter(Boolean);
    const words = markers.length ? new RegExp(markers.join('|'), 'g') : null;
    const refs = words ? putAround(whole, words) : put(whole);
    const placed = words ? whole.replace(words, '') : whole;
    // One source for the pattern: a second literal would drift from the one that splits the refs.
    const cap = truncated ? Number(whole.match(new RegExp(BODY_TRUNCATION.source))?.[1]) : NaN;
    return {
      refs,
      // A masked value ("‹redacted:aws-key›") drops no line, so the line count alone would report an untouched body; D90:
      // it is a mask only where the record declares an earlier redactor's work.
      redacted: redactedLines > 0 || body.redacted === true || declared && hasRedactionToken(whole),
      extent: {
        chars: placed.length,
        lines: placed.length ? placed.split('\n').length : 0,
        truncated,
        cap: Number.isFinite(cap) ? cap : null,
        recorded: true,
        redactedLines,
      },
    };
  };

  /**
   * B1b. The same placement for a body the recorder JOINED from several segments: an `Edit` or
   * `MultiEdit` records its own text as `parts` written segments followed by `priorParts`
   * replaced ones, separated by the marker `slicer/src/events.js` uses for the same reason
   * (`ARG_SEP`, vanishingly unlikely in source and visible if it is ever rendered). The marker
   * is re-declared here rather than imported, exactly as `BODY_TRUNCATION` above is: the
   * recorder and the reader must not share a literal they would have to migrate together.
   *
   * Both newlines are optional in the split. Redaction keeps the marker on a line of its own
   * (`scrubLines` never continues a line into it, W3e-1), but when it drops every line in front
   * of one the marker opens the field, and a note it writes after one shares its newline; the
   * marker's own three characters are what identifies it.
   *
   * The marker and the truncation stub are the RECORDER's words, and the dropped-lines note the
   * REDACTOR's. None is inside any ref, so none can ever be quoted as written code or counted in
   * a segment; the extent states the cut and the drop instead. The redactor writes its note at
   * the end of the segment it dropped lines from (W3e-1 / F184), so a segment it emptied can be
   * told from one the record kept empty: the first is `redactedAway` (F185).
   */
  const EDIT_PART = /\n?⟪→⟫\n?/g;

  const placeBodyParts = (body) => {
    if (!body || typeof body.text !== 'string' || !body.text.length) return [];
    // W3e-6: spelled before any offset is measured, so every byte offset indexes the stored text.
    const whole = spell(body.text);
    const key = `b${blobN++}`;
    blobs[key] = whole;
    const at = (index) => Buffer.byteLength(whole.slice(0, index), 'utf8');
    const truncated = body.truncated === true;
    const cap = truncated ? Number(whole.match(new RegExp(BODY_TRUNCATION.source))?.[1]) : NaN;
    // The redactor counts dropped lines per recorded FIELD, not per segment, so every segment of
    // one field declares that field's count. Over-declaring redaction is the safe direction.
    const redactedLines = Number.isFinite(body.redactedLines) ? body.redactedLines : 0;
    // D90: a mark-shaped string is an earlier redactor's only where the record declares its work (`redactorDeclared`).
    const declared = redactorField(body);

    const regions = [];
    for (const m of whole.matchAll(EDIT_PART)) regions.push({ start: m.index, end: m.index + m[0].length, cut: true });
    for (const m of whole.matchAll(BODY_TRUNCATION))
      regions.push({ start: m.index, end: m.index + m[0].length, cut: false, cap: Number(m[1]) });
    if (redactedLines > 0)
      for (const m of whole.matchAll(REDACTION_NOTE)) regions.push({ start: m.index, end: m.index + m[0].length, note: true });
    if (declared) {
      for (const m of whole.matchAll(REDACTION_TOKEN)) regions.push({ start: m.index, end: m.index + m[0].length, note: true });
      for (const m of whole.matchAll(DROPPED_TOKEN)) regions.push({ start: m.index, end: m.index + m[0].length, note: true });
    }
    regions.sort((a, b) => a.start - b.start);

    const segments = [];
    let refs = [];
    let text = '';
    let cursor = 0;
    let stub = null;     // the truncation stub this segment carries, if the recorder cut it
    let noted = false;   // whether the redactor declared lines dropped from this segment
    const flush = () => { segments.push({ refs, text, stub, noted }); refs = []; text = ''; stub = null; noted = false; };
    for (const region of regions) {
      if (region.start > cursor) {
        refs.push({ sourceKey: key, fromByte: at(cursor), untilByte: at(region.start) });
        text += whole.slice(cursor, region.start);
      }
      cursor = Math.max(cursor, region.end);
      if (region.cut) flush();
      else if (region.note) noted = true;
      else stub = { cap: Number.isFinite(region.cap) ? region.cap : null };
    }
    if (cursor < whole.length) {
      refs.push({ sourceKey: key, fromByte: at(cursor), untilByte: at(whole.length) });
      text += whole.slice(cursor);
    }
    flush();

    // W3d-4 / F155: the recorder caps an Edit's written and replaced sides separately, so a
    // stub can end either side — and the segment it ends is the one that was cut, with its own
    // cap. A field capped whole (older recordings) carries one stub, at the end of its last
    // surviving segment, which reads exactly as it always did. A field declared truncated whose
    // stub cannot be found fails closed onto its last segment, as before.
    const last = segments.length - 1;
    const stubbed = segments.some((segment) => segment.stub);
    // F107: a segment the separator delimits is a recorded fact even when it is empty — an Edit
    // whose `new_string` is '' wrote the empty string, and the record says so. Only a field with
    // no separator in it at all leaves an empty segment that states nothing, and that stays null.
    const delimited = segments.length > 1;
    return segments.map((segment, i) => {
      if (!segment.text.length && !delimited) return null;
      const cut = truncated && (stubbed ? segment.stub !== null : i === last);
      return {
        refs: segment.refs,
        redacted: redactedLines > 0 || body.redacted === true || declared && hasRedactionToken(whole),
        extent: {
          chars: segment.text.length,
          lines: segment.text.length ? segment.text.split('\n').length : 0,
          truncated: cut,
          cap: !cut ? null : segment.stub ? segment.stub.cap : Number.isFinite(cap) ? cap : null,
          recorded: true,
          redactedLines,
        },
        // W3e-1 / F185: redaction dropped lines from this segment and left none of its text.
        // Not a cut (a segment past the recorder's budget is its stub alone, with no note) and not
        // an empty string the agent wrote (the redactor declares nothing there).
        ...(segment.noted && !segment.text.length ? { redactedAway: true } : {}),
      };
    });
  };

  /**
   * M36 phase 2 review (critique c1; C-02 Change `priorRecord`). Where a prior state was recorded: `{ source, eventId,
   * partial, window? }` — `source` the slicer's (`original`: the recorder kept the file with this call; `read`: a Read
   * of the path; `write`: a whole body written to it), `eventId` that recording event (null when the ledger names none
   * this session holds: a ledger an older slicer wrote), `partial` whether a read was part of the file, `window` a
   * read's typed lines `{ from, to, total }` when less than the file. Structure only.
   */
  const priorRecordOf = (before) => {
    if (!['original', 'read', 'write'].includes(before?.source)) return null;
    const eventId = Number.isSafeInteger(before.turn) && Number.isSafeInteger(before.seq) && ids.hasActAt(before.turn, before.seq)
      ? ids.actAt(before.turn, before.seq) : null;
    const w = before.window;
    const window = w && Number.isSafeInteger(w.from) && Number.isSafeInteger(w.to)
      ? { from: w.from, to: w.to, total: Number.isSafeInteger(w.total) ? w.total : null } : null;
    return { source: before.source, eventId, partial: before.partial === true, ...(window ? { window } : {}) };
  };

  /**
   * The C-02 `changes` of one write-shaped action. Emitted for create/edit/delete only: a read
   * is in the same ledger array and has no change to declare.
   *
   * A file's PRIOR STATE is carried only when the record observed one — the edit tool's own
   * `originalFile`, a Read of the path before its first write, or (F69) the last read/write of a
   * path the session then deleted. The slicer also fills `before` from a create's OWN body
   * (before.js source 'write'), which is the pre-edit channel's baseline for LATER edits, not
   * the state before this write; placing it on the create would count every created file twice
   * against the window budget, show it twice in the prompt, and assert a prior state the record
   * never saw. On a DELETE that same source IS the prior state — the last body the record saw
   * at that path — so it is carried there and nowhere else.
   *
   * B1b/F67: an Edit's own text arrives as one recorded field with `parts` written segments and
   * `priorParts` replaced ones. Each entry becomes its own change, in order. The whole-file
   * prior state, when the record has one, belongs to the FIRST change only: it is the state of
   * the FILE, not of one edit entry, and it already contains the replaced span.
   */
  const changesOf = (act, id, path = act.path) => {
    const attempted = act.attempted ?? act.kind;
    const prior = act.before && !act.before.withheld
      && (act.before.source !== 'write' || attempted === 'delete') ? placeBody(act.before) : null;
    const priorRule = attempted === 'delete' ? PRIOR_STATE.deleted : PRIOR_STATE.firstWrite;
    // M36 phase 2 review (owner decision D68 H, critique c1): the event whose record holds that prior state — the call
    // itself for the recorder's own `originalFile`, the Read before the first write, the write (or Read) before a delete
    // — named by the slicer's turn and seq, with a Read's typed line window and whether the read was part of the file,
    // so a window labels the state by the event that recorded it. Carried on the change that carries the state.
    const priorRecord = prior ? priorRecordOf(act.before) : null;
    // M36 phase 3 review (D68 R, Q): a prior state the slicer withheld before review (a credential-shaped file or a
    // harness folder) is said on the change that would carry it (`priorWithheld`, present only then), so a request for
    // the file before the call is refused `withheld`, not as a call with no recorded file before it. D69 review (F6): only
    // for those closed reasons (`PRIOR_WITHHELD_REASONS`), the meaning `withheld` has: a ledger an earlier slicer wrote
    // with an "unreadable" prior state carries none, and a request for it is `not_requestable`, never `withheld`.
    const priorWithheld = PRIOR_WITHHELD_REASONS.includes(act.before?.withheld);
    const withRecord = (change) => (priorRecord ? Object.assign(change, { priorRecord })
      : priorWithheld ? Object.assign(change, { priorWithheld: true }) : change);

    const build = (after, before, rule, extra = null) => {
      const change = {
        path: path ?? null,
        before: before?.refs ?? [],
        after: after?.refs ?? [],
        diff: [],
        extent: { ...(after?.extent ?? UNRECORDED_EXTENT),
          ...(extra ?? {}),
          priorState: before ? rule : PRIOR_STATE.none },
        ...(before ? { beforeExtent: before.extent } : {}),
        ...(after?.extent.truncated ? { truncated: true } : {}),
        ...(after?.redacted || before?.redacted ? { redacted: true } : {}),
        // W3c-10 / F133. The slicer's verdict that this path is outside the work under review: a
        // path outside the recorder's working directory, or in the harness home folders (slicer/src/
        // events.js finalizeExternal; D69 c, the review's F5). D69 review (F7): such a path keeps its
        // spelling as recorded (an absolute one its leading `/`), but this flag is the write scope
        // downstream reads, never the spelling. Carried on the change, not only the gap, so a
        // transferred child's writes keep it; present only when true, so a session with no such
        // write is unchanged byte for byte.
        ...(act.external === true ? { outsideRepository: true } : {}),
      };
      return change;
    };

    const parts = Number.isSafeInteger(act.after?.parts) && act.after.parts > 0 ? act.after.parts : 0;
    if (!parts) {
      // F136 (W3c-11): what a recorded body IS when it is not the file's new whole state — text
      // appended at the end (`>>`), text the file received after shell expansion (an unquoted
      // heredoc delimiter), or a new notebook cell (`insert`). Declared on the extent beside the
      // body, present only when true, so every other change is byte-for-byte unchanged.
      const placed = placeBody(act.after, { empty: true });
      const shape = placed ? Object.fromEntries(['append', 'expanded', 'insert']
        .filter((flag) => act.after[flag] === true).map((flag) => [flag, true])) : {};
      return [withRecord(build(placed, prior, priorRule, Object.keys(shape).length ? shape : null))];
    }

    const placed = placeBodyParts(act.after);
    const replaceAll = Array.isArray(act.after.replaceAll) ? act.after.replaceAll : [];
    return Array.from({ length: parts }, (_, i) => {
      const written = placed[i] ?? null;
      const replaced = placed[parts + i] ?? null;
      const before = i === 0 && prior ? prior : replaced;
      // W3e-1 / F185: a replaced side the record had and redaction removed says so. It used to
      // read as `none` (its separator dropped with a cut key block) or as an edit text that was
      // the redactor's own note.
      const rule = i === 0 && prior ? priorRule
        : replaced?.redactedAway ? PRIOR_STATE.redacted : PRIOR_STATE.editText;
      const change = build(written, before, rule, replaceAll[i] === true ? { replaceAll: true } : null);
      // M36 phase 2 (owner decision D68 H; C-02 "M36 window format"): a window no longer inlines the file as the record
      // found it, so the edit's own replaced text — what the agent produced, which the file state stood in for — is kept
      // beside it (`replaced`, its extent `replacedExtent`); every other change is unchanged byte for byte.
      if (i === 0 && prior && replaced) {
        change.replaced = replaced.refs;
        change.replacedExtent = replaced.extent;
      }
      return i === 0 && (prior || priorWithheld) ? withRecord(change) : change;
    });
  };

  // A CHILD evidence unit carries its assignment on `instructions` with an empty `ask`
  // (cli/src/session-evidence.js): the text is the parent agent's brief, and a brief is not a
  // human instruction. It is still the thing the child worked under, so it is recorded as an
  // instruction event with agent authority — which is what makes `unasked` uncertifiable
  // against it (ledger.js deriveColumn / instructionReviewScope), rather than invisible.
  // M34 labels (C-02 "Slice-time labels"): the slicer reads an ask only from a row it labelled `human`, so no entry here
  // is re-decided, and no canonical event carries `meta`. The authority is derived from the recorded lineage
  // (`ledger.lineage.role`, set from structure): a helper's human-labelled rows are its parent agent's words (`agent`), a
  // root's the human's. A child unit's `instructions` (cli/src/session-evidence.js) keep agent authority, as before.
  // Kept for ledgers persisted by an M33 N slicer (before H2), which marked the recorder's own rows `meta: true` in
  // `ask`: such an entry is still no instruction (with human authority it would ground a request on a loaded skill's text
  // or a slash command's expansion). No slicer writes it any more.
  const persistedMeta = (ask) => ask?.meta === true;
  const lineageAuthority = ledger.lineage?.role === 'helper' ? 'agent' : 'human';
  // C-01 event identity: each instruction's id, by the copy read below (its recorded row's, else `I<turn>`).
  const askIds = new Map();
  const asks = [...(ledger.ask ?? []).filter((ask) => !persistedMeta(ask)).map((ask) => ({ ask, authority: lineageAuthority })),
    ...(ledger.instructions ?? []).filter((ask) => !persistedMeta(ask)).map((ask) => ({ ask, authority: 'agent' }))]
    .map(({ ask, authority }) => {
      const copy = { ...ask, authority };
      if (ids.of(ask) !== null) askIds.set(copy, ids.of(ask));
      return copy;
    })
    .sort((a, b) => a.turn - b.turn);
  // The inherited ledger records only the current human turn, not the mark's position within
  // it. Place a mark after that complete turn and declare this precision below; do not invent
  // a mid-turn position from an unrelated action index. Keep duplicate marks as source facts.
  const compactions = (ledger.marks ?? []).map((mark, index) => ({ ...mark, index, eventId: ids.of(mark) }))
    .filter((mark) => mark.kind === 'compaction'
      && Number.isSafeInteger(mark.turn) && mark.turn >= 0);
  // C-02 M33 (4): typed interrupt marks, each named by its ordinal among ALL typed marks in ledger
  // order. That is source order (the slicer sorts marks by turn, then kind, stably), so a mark
  // appended later never renames an earlier one. A typed mark is placed by its row: the actions
  // recorded before it (`beforeEvent`, as commentary is placed) and its stream/record against the
  // commentary and hand-offs around it. One without a valid turn and position is declared below.
  const typedInterrupts = (ledger.marks ?? []).filter((mark) => mark?.kind === 'interrupt'
    && LEDGER_TYPED_INTERRUPT_SOURCES.includes(mark.source));
  const interrupts = typedInterrupts.map((mark, ordinal) => ({ mark, ordinal }))
    .filter(({ mark }) => Number.isSafeInteger(mark.turn) && mark.turn >= 0
      && Number.isSafeInteger(mark.beforeEvent) && mark.beforeEvent >= 0
      && Number.isSafeInteger(mark.stream) && mark.stream >= 0
      && Number.isSafeInteger(mark.record) && mark.record >= 1);
  // M34 labels: the id of the typed interrupt boundary recorded at a row (`{stream, record}`), or null.
  const interruptBoundaryOf = (row) => {
    const found = interrupts.find(({ mark }) => mark.stream === row?.stream && mark.record === row?.record);
    return found ? ids.of(found.mark) ?? `B${found.mark.turn}-i${found.ordinal}` : null;
  };
  // True when the typed row came before `other` (commentary or a hand-off) in the recording. An
  // item without a numeric stream and record cannot be ordered, and keeps its place first.
  const rowBefore = (mark, other) => Number.isSafeInteger(other?.source) && Number.isSafeInteger(other?.record)
    && (mark.stream < other.source || (mark.stream === other.source && mark.record < other.record));
  /**
   * OWNER DECISION B (2026-10-01). The human's words recorded within a turn (the slicer's `interjections`: a prompt
   * queued while the agent worked, an AskUserQuestion answer) are human instructions, each placed by its row exactly as
   * commentary is: after the turn's actions recorded before it (`beforeEvent`), among its slot's commentary by row
   * (`source`, `record`). `I<turn>-<n>`: n counts the turn's placed ones in ledger order, so an appended row renames none.
   * An answer names its call (`answerTo`) by the call's recorded turn and seq, and only a call this ledger recorded
   * before it. One that cannot be placed — a field out of shape, a kind this adapter does not know, an answer naming no
   * such call — is declared (`unplacedHeard`, adapterGaps), never dropped.
   */
  const heardEntries = Array.isArray(ledger.interjections) ? ledger.interjections : [];
  const recordedCalls = new Map((ledger.ledger ?? []).map((act, index) => [`${act?.turn}:${act?.seq}`, index]));
  const heard = [];
  let unplacedHeard = 0;
  for (const entry of heardEntries) {
    const call = entry?.call;
    const linked = entry?.kind === ANSWER_KIND;
    const callAt = linked && call !== null && typeof call === 'object'
      && Number.isSafeInteger(call.turn) && Number.isSafeInteger(call.seq) ? recordedCalls.get(`${call.turn}:${call.seq}`) : undefined;
    const placeable = entry !== null && typeof entry === 'object' && !Array.isArray(entry)
      && INTERJECTION_KINDS.includes(entry.kind) && typeof entry.text === 'string'
      && Number.isSafeInteger(entry.turn) && entry.turn >= 0
      && Number.isSafeInteger(entry.beforeEvent) && entry.beforeEvent >= 0
      && Number.isSafeInteger(entry.source) && entry.source >= 0
      && Number.isSafeInteger(entry.record) && entry.record >= 1
      && (!linked || (callAt !== undefined && call.turn === entry.turn && entry.beforeEvent > callAt));
    if (!placeable) { unplacedHeard++; continue; }
    const n = heard.filter((other) => other.entry.turn === entry.turn).length + 1;
    // M34 labels: an in-turn instruction carries its markers (replacing `queued: true`) and its link: an answer names the
    // question it answers (`answerTo`). A peer's message carries peer authority and no marker.
    const link = ids.actAt(call?.turn, call?.seq);
    heard.push({ entry, id: ids.of(entry) ?? `I${entry.turn}-${n}`,
      recordedAs: entry.kind === ANSWER_KIND ? { markers: [ANSWER_KIND], answerTo: link }
        : entry.kind === PEER_KIND ? {} : { markers: [entry.kind] },
      authority: entry.kind === PEER_KIND ? PEER_AUTHORITY : lineageAuthority });
  }
  // Every queued prompt and every attachment the slicer read came from a row it also counted as an unsupported
  // instructions row.
  const queuedRead = heardEntries.filter((entry) => entry?.kind === QUEUED_KIND || entry?.kind === ATTACHED_KIND).length;
  const recordedTurns = [...new Set([...asks.map((a) => a.turn), ...heard.map(({ entry }) => entry.turn),
    ...(ledger.ledger ?? []).map((e) => e.turn),
    ...(ledger.commentary ?? []).map((c) => c.turn),
    ...(ledger.sayings ?? []).map((s) => s.turn)])];
  // A delegation can be the only thing that happened on its turn: the Task call produces no
  // ledger action, so without this the turn vanished and the hand-off was never visible (B1/G6).
  // EVERY delegation gets its event, linked or not (B2): the hand-off is what the child's
  // transferred work hangs from, and what a coverage gap names when there is no child. The index
  // is its position in the recorded list, so two hand-offs in one turn keep distinct ids.
  const delegations = (ledger.delegations ?? [])
    .map((delegation, index) => ({ delegation, index }))
    .filter(({ delegation }) => delegation
      && Number.isSafeInteger(delegation.turn) && delegation.turn >= 0);
  const hasRow = (delegation) => Number.isSafeInteger(delegation?.source) && delegation.source >= 0
    && Number.isSafeInteger(delegation.record) && delegation.record >= 1;
  /**
   * M33 F placement. A helper's attached report is placed where the parent RECEIVED it — the human turn and row of its
   * own FINAL_ANSWER row, in the hand-off's recording — never beside the hand-off: the report stays that hand-off's
   * result (`invocation`, `<delegate id>-r`), but windows and order show when it arrived. In its arrival turn it is a
   * block of its own, like a follow-up: ordered among that turn's hand-offs by recorded row (before the first one
   * recorded after it on its stream), then moved to its row among the turn's own events exactly as a hand-off is
   * (`placeHandOffs`) — back past work proven recorded after it, never ahead of work that preceded it. Only a report
   * whose position cannot place it after its own hand-off — no recorded turn (a ledger written before this rule), an
   * earlier turn, or the hand-off's turn with no row to order it by or a row before the hand-off's — stays where it
   * was: right after the delegate event, inside the hand-off's block. No other order is inferred.
   */
  const reportArrivals = new Map();       // arrival turn -> [{ delegation, index, report, row }]
  const gluedReports = new Set();         // hand-offs whose report stays inside their own block
  for (const { delegation, index } of delegations) {
    const report = delegation.status === 'failed' ? null : helperReport(delegation, redactorField);
    if (!report) continue;
    const row = hasRow(delegation) && report.record !== null ? { source: delegation.source, record: report.record } : null;
    if (report.turn === null || report.turn < delegation.turn
      || report.turn === delegation.turn && (row === null || report.record <= delegation.record)) {
      gluedReports.add(delegation);
      continue;
    }
    if (!reportArrivals.has(report.turn)) reportArrivals.set(report.turn, []);
    reportArrivals.get(report.turn).push({ delegation, index, report, row });
  }
  /**
   * C-03 M33 W2 (placement at receipt). A Workflow runs asynchronously: the parent keeps working and receives the run's
   * completion later (a typed task notification the C-02 M33 D join attaches to the launch by its exact recorded call id
   * and taskId). A linked Workflow agent whose run's VALID record names that receipt (`workflowRunRecords`: the chain's
   * last call's own) is placed where the parent received it, never at the launch: its whole block (delegate event, the
   * agent's transferred history, its report) is a block of the receipt's turn, ordered among that turn's hand-offs by the
   * receipt's row as an M33 F report is, then moved back past the turn's own work proven recorded after the receipt —
   * every action the slicer counted at or past it (`beforeEvent`, as commentary is placed among Claude actions, which
   * record no row), and commentary or a typed interrupt recorded after its row — and no further. Its identity (`D<call
   * turn>-<index>`, the call it names) does not move; only its order does. Never by timestamp. With no valid receipt the
   * launch placement (the C-03 child rule from the call's row) stands, declared (`WORKFLOW_GAP_NOTES.unreceived`).
   * M33 P repair: a run is asynchronous, so with no valid receipt its agents' blocks are never moved back past parent
   * work recorded after the launch: they stand after the launch request's own work (`unmovedAgents`), still declared.
   * M33 P second repair: after the SESSION's last request's own work — unreceived, the run may have finished after any
   * parent work recorded after its launch, a later request's included — headed by the unproven receipt boundary.
   */
  const workflowRuns = workflowRunRecords(ledger);
  const helperRecords = launchLayout ? new Map() : helperSegmentRecords(ledger, ids);
  /**
   * C-03 M33 P second repair: the session's last request — where work whose receipt the parent never recorded stands (a
   * helper segment with no receipt, or with no proven one and no next report; a Workflow run with no receipt). The
   * highest turn the parent recorded anything in, or received anything at.
   */
  const sessionLastTurn = Math.max(0, ...[...recordedTurns, ...compactions.map((mark) => mark.turn),
    ...interrupts.map(({ mark }) => mark.turn), ...delegations.map(({ delegation }) => delegation.turn),
    ...reportArrivals.keys(), ...[...workflowRuns.runs.values()].map((run) => run.receipt?.turn),
    ...[...helperRecords.values()].flat().flatMap((segment) => [segment.receipt, segment.shared, segment.next]
      .map((row) => row?.turn))].filter((turn) => Number.isSafeInteger(turn) && turn >= 0));
  const receiptArrivals = new Map();      // receipt turn -> [{ delegation, index, receipt, row, unreceivedRun? }]
  const atReceipt = new Set();            // Workflow agents placed where their run's completion was received
  const unmovedAgents = new Set();        // M33 P repair: linked Workflow agents with no valid receipt (never moved back)
  let crossTurn = false;                  // M33 P: did any placement at a receipt cross into a later turn?
  for (const { delegation, index } of delegations) {
    const linkedAgent = delegation.kind === WORKFLOW_AGENT_KIND && delegation.status === 'linked';
    const receipt = !launchLayout && linkedAgent
      ? workflowRuns.runs.get(`${delegation.turn}:${delegation.workflowSeq}`)?.receipt ?? null : null;
    if (!receipt && linkedAgent) {
      unmovedAgents.add(delegation);
      // M33 P second repair: never received, it stands after the session's last request, not its launch request's.
      if (!launchLayout && sessionLastTurn > delegation.turn) {
        atReceipt.add(delegation);
        crossTurn = true;
        if (!receiptArrivals.has(sessionLastTurn)) receiptArrivals.set(sessionLastTurn, []);
        receiptArrivals.get(sessionLastTurn).push({ delegation, index, receipt: null, row: null, unreceivedRun: true });
      }
    }
    if (!receipt) continue;
    atReceipt.add(delegation);
    if (receipt.turn > delegation.turn) crossTurn = true;
    if (!receiptArrivals.has(receipt.turn)) receiptArrivals.set(receipt.turn, []);
    receiptArrivals.get(receipt.turn).push({ delegation, index, receipt,
      row: { source: receipt.source, record: receipt.record } });
  }
  /**
   * C-03 M33 P (placement by recorded delivery and receipt). A linked helper's history is cut into SEGMENTS at each
   * recorded arrival of an assignment its parent sent (a valid `helperSegments` record: helperSegmentRecords), and each
   * segment is placed where the parent RECEIVED the helper's result: a block of the receipt's turn, ordered among its
   * hand-offs by the receipt's row, moved back past the turn's own work recorded after it (as a W2 Workflow agent is),
   * headed by a receipt boundary that states the concurrency (only when the parent recorded work between the delivery
   * and the receipt). The hand-off events themselves stay at their own rows. Only order moves: every identity, and each
   * event's C-02 turn, is the delivery's. M33 P repair: a segment whose receipt is not proven is never placed ahead of
   * parent work it may have followed: a queued one (`shared`) at the helper's `next` report, else after the request
   * that received the shared report; one with no receipt after its delivery request's own work (a block with no row:
   * never moved back). Each is headed by the receipt boundary marked `unproven`, and declared. M33 P second repair:
   * every segment with no proven receipt and no next report — none recorded, a `shared` one, an `ambiguous` one (its
   * helper reported more often than it was assigned work, or received a stray message), and a Claude helper's work
   * after its own later `request` — stands after the SESSION's last request's own work: unreceived, it may have
   * finished after any parent work recorded after its delivery, a later request's included.
   */
  const pieceArrivals = new Map();        // turn -> [{ piece, delegation, row, receipt, unproven, index }]
  const provenFollowups = new Set();      // follow-ups whose delivery a valid record proves (assignmentEffectProven)
  // D175: the Claude SendMessage actions whose resume a VALID record proves (a resume segment): their later child
  // history is attributed, so their `childFollowupUnresolved` gap is not declared; a rejected record keeps it.
  const resumedSends = new Set();
  const piecesOf = new Map();             // child source -> its pieces, in segment order
  for (const [child, segments] of helperRecords) {
    const pieces = segments.map((segment, k) => ({ ...segment, child, k }));
    piecesOf.set(child, pieces);
    for (const piece of pieces) {
      if (piece.delegation?.kind === 'followup') provenFollowups.add(piece.delegation);
      if (Object.hasOwn(piece.delivery, 'action') && piece.request !== null) resumedSends.add(piece.deliveryId);
      // Where it is placed: at its receipt; at the next report (queued); else (M33 P second repair) at the end of the
      // session's last request — a block with no row.
      const at = piece.receipt ?? piece.next ?? null;
      const turn = at ? at.turn : sessionLastTurn;
      // The launch layout held the whole history behind the spawn: a piece placed in a later turn than the spawn's
      // would renumber the commentary of the turns between.
      if (turn > piece.spawn.turn) crossTurn = true;
      if (!pieceArrivals.has(turn)) pieceArrivals.set(turn, []);
      pieceArrivals.get(turn).push({ piece, delegation: piece.delegation, receipt: at, unproven: !piece.receipt,
        row: at ? { source: at.source, record: at.record } : null, index: delegations.length + pieceN(piece) });
    }
  }
  function pieceN(piece) {
    let n = 0;
    for (const [child, pieces] of piecesOf) { if (child === piece.child) return n + piece.k; n += pieces.length; }
    return n;
  }
  // The launch layout's ids of this session's working commentary: a piece placed in a later turn than its delivery
  // would otherwise renumber the commentary of every turn between (an id counts the events emitted before it). C-01
  // event identity: only a positional commentary id counts them; one the recorder's identity names is never renumbered.
  if (crossTurn && !launchLayout && (ledger.commentary ?? []).some((say) => ids.of(say) === null))
    launchIds = sessionFromLedger(ledger, { sessionKey, [LAUNCH_LAYOUT]: true, [CHILD_SESSIONS]: childSessions })[COMMENTARY_IDS] ?? null;
  const turns = [...new Set([...recordedTurns, ...compactions.map((mark) => mark.turn),
    ...interrupts.map(({ mark }) => mark.turn),
    ...delegations.map(({ delegation }) => delegation.turn), ...reportArrivals.keys(), ...receiptArrivals.keys(),
    ...pieceArrivals.keys()])]
    .sort((a, b) => a - b);
  /**
   * This turn's hand-offs, in recorded order, with each report that arrived this turn inserted before the first of them
   * recorded after it on its own stream (and never before its own hand-off); a report with no row to order it by goes
   * last. Reports are taken in row order, so two that arrived together keep theirs. M33 W2: a Workflow agent whose run's
   * completion was received this turn is such an arrival too (at its receipt's row), and is no hand-off of its call's
   * turn.
   */
  const handOffOrder = (turn) => {
    const items = delegations.filter((d) => d.delegation.turn === turn && !atReceipt.has(d.delegation));
    const rank = (arrival) => (arrival.row ? 0 : 1);
    // M33 P: a helper's work received at a row comes before the report the parent received at that same row.
    const kindRank = (arrival) => (arrival.report ? 1 : 0);
    const arrivals = [...(reportArrivals.get(turn) ?? []), ...(receiptArrivals.get(turn) ?? []),
      ...(pieceArrivals.get(turn) ?? [])].sort((a, b) => rank(a) - rank(b)
      || (a.row && b.row ? a.row.source - b.row.source || a.row.record - b.row.record : 0) || kindRank(a) - kindRank(b)
      || a.index - b.index);
    for (const arrival of arrivals) {
      const own = items.findIndex((item) => !item.arrival && item.delegation === arrival.delegation);
      let at = arrival.row === null ? -1 : items.findIndex((item, k) => k > own && !item.arrival
        && item.delegation.source === arrival.row.source && Number.isSafeInteger(item.delegation.record)
        && item.delegation.record > arrival.row.record);
      if (at < 0) at = items.length;
      items.splice(at, 0, { arrival });
    }
    return items;
  };
  const delegationEventIds = new Map();   // slicer delegation record -> canonical event id
  // C-03 M33 W: this ledger's own Workflow actions, by `turn:seq`: the only events a Workflow agent can name.
  const workflowActions = new Set((ledger.ledger ?? []).filter((act) => act?.tool === 'Workflow'
    && Number.isSafeInteger(act.turn) && Number.isSafeInteger(act.seq)).map((act) => `${act.turn}:${act.seq}`));
  // M33 W repair 2: each call a valid run record names as resuming a run, and that run's own call.
  const workflowResumeOf = workflowRuns.resumeOf;
  const children = [];                    // C-03 ChildLink[]
  const transferred = new Map();          // ledger.children index -> the child already spliced in
  // C-03 M33 child placement: the recorded row [stream, record] of each of this session's own
  // commentary, typed interrupt and located action events — the only facts a hand-off is ordered by.
  const rowOf = new Map();
  const rowFrom = (stream, record) => (Number.isSafeInteger(stream) && stream >= 0
    && Number.isSafeInteger(record) && record >= 1 ? [stream, record] : undefined);
  // C-03 M33 W2: the slot of each of this session's own action-loop events — an action's (its invocation and result)
  // is its index among the turn's actions; commentary's and a typed interrupt's, how many of them were recorded before
  // it. The facts a Workflow agent block received at a receipt (`beforeEvent`) is ordered by, where no row is recorded.
  const slotOf = new Map();

  /**
   * C-03 "M33 child placement". Each hand-off of a turn is first emitted where it always was — after
   * the turn's own work — as one block: its delegate event, that assignment's own recorded result
   * and, for a verified spawn, the child's whole transferred history. Only then is the block moved,
   * whole, to its assignment's row in parent order: back past the turn's own events that are PROVEN
   * recorded after the hand-off's row on the same stream (a located action, its result and its shell
   * writes; commentary; a typed interrupt), and no further. An event with no recorded row, or one
   * recorded before the hand-off, stops it, so nothing is ever placed ahead of work that preceded it
   * and an action is never separated from its result. A follow-up is its own block of one delegate
   * event: it never carries, splits or moves the child history. A hand-off with no valid row keeps
   * its place. Every id was assigned in the unmoved layout, so identities do not change; only
   * `sequence` (which is order) is renumbered. No other cross-session order is inferred. A child's
   * own hand-offs were already placed by its own adaptation, so a nested child sits after its own
   * spawn inside the child's history.
   */
  const placeHandOffs = (turnStart, handOffs) => {
    if (!handOffs.some(({ delegation }) => hasRow(delegation))) return;
    const moving = new Set();
    const startingAt = new Map(handOffs.map((handOff) => [handOff.start, handOff]));
    for (const handOff of handOffs) for (let i = handOff.start; i < handOff.end; i++) moving.add(i);
    const own = [];           // the turn's own events, in order; `after` counts those before a block
    for (let i = turnStart; i < events.length; i++) {
      if (startingAt.has(i)) startingAt.get(i).after = own.length;
      if (!moving.has(i)) own.push(events[i]);
    }
    for (const handOff of handOffs) {
      const { delegation } = handOff;
      if (!hasRow(delegation)) continue;
      const later = (event) => {
        const row = rowOf.get(event);
        return row !== undefined && row[0] === delegation.source && row[1] > delegation.record;
      };
      const laterActions = new Set(own.filter((event) => event.kind === 'invocation' && later(event))
        .map((event) => event.id));
      const rowLater = (event) => event.kind === 'invocation'
        ? laterActions.has(event.id) || (typeof event.shellWriteOf === 'string' && laterActions.has(event.shellWriteOf))
        : event.kind === 'observation' ? laterActions.has(event.invocation)
          : (event.kind === 'commentary' || event.kind === 'instruction' || event.kind === 'boundary' && event.boundary === 'interrupt')
            && later(event);
      // M33 W2: a Workflow agent block received at a receipt moves back past the turn's own events recorded after it:
      // an action the slicer counted at or past the receipt (with its result), and commentary or a typed interrupt in a
      // later slot, or in the receipt's slot on a later row of its stream. Anything else stops it.
      const receiptLater = (event) => {
        const at = slotOf.get(event);
        return at !== undefined && (at.action ? at.slot >= handOff.receiptSlot
          : at.slot > handOff.receiptSlot || at.slot === handOff.receiptSlot && later(event));
      };
      // M33 P repair: a Claude hand-off block that carries its helper's whole history (no valid M33 P record) never
      // moves back past a parent action, whatever rows the ledger records — d7226ec's placement: a synchronous agent's
      // result may have been received after a sibling call's (its receipt row is not known here).
      const noActionLater = (event) => (event.kind === 'commentary' || event.kind === 'instruction'
        || event.kind === 'boundary' && event.boundary === 'interrupt') && later(event);
      const provenLater = handOff.receiptSlot !== undefined ? receiptLater
        : handOff.pastActions === false ? noActionLater : rowLater;
      while (handOff.after > 0 && provenLater(own[handOff.after - 1])) handOff.after--;
    }
    const placed = [...handOffs].sort((a, b) => a.after - b.after || a.start - b.start);
    const order = [];
    for (let slot = 0, next = 0; slot <= own.length; slot++) {
      for (; next < placed.length && placed[next].after === slot; next++)
        for (let i = placed[next].start; i < placed[next].end; i++) order.push(events[i]);
      if (slot < own.length) order.push(own[slot]);
    }
    events.length = turnStart;
    for (const event of order) { event.sequence = events.length; events.push(event); }
  };

  /**
   * One instruction event for an ask (or, OWNER DECISION B, an in-turn instruction), with the cuts the ledger declares
   * on it counted, and (OWNER DECISION B) its id kept for the gap that names it.
   */
  const instructionEvent = (ask, id) => {
    // What was removed from the ask is recorded in `ask.elided`. The retained text is then NOT
    // the instruction: a hard constraint can be sitting in the elided middle, and certifying
    // `unasked` against the remainder is a false accusation (G4/B6, B14).
    // M33 R: an entry `middle of turn` is Sonah's cut of an ask over its budget (redaction's bound
    // of the scrubbed ask, or an older slicer's): declared apart, as capped before review. M33 R
    // repair: an entry of a strip's kind is Sonah's strip of pasted material (redaction's, after it
    // scrubbed the whole ask, or an older slicer's): declared apart too, as stripped before review.
    // Only an entry of a kind no version of Sonah writes is still credited to the recorder. An ask
    // Sonah alone cut is marked `capped` and/or `stripped`, so it is never counted as one the
    // recorder shortened.
    const elisions = Array.isArray(ask.elided) ? ask.elided : [];
    const cappedAsk = elisions.some((entry) => entry?.what === ASK_MIDDLE);
    const strippedAsk = elisions.some((entry) => ASK_STRIP_KINDS.includes(entry?.what));
    const shortenedAsk = elisions.some((entry) => entry?.what !== ASK_MIDDLE && !ASK_STRIP_KINDS.includes(entry?.what));
    const elided = cappedAsk || strippedAsk || shortenedAsk;
    if (shortenedAsk) { elidedAsks++; elidedIds.push(id); }
    if (strippedAsk) { strippedAsks++; strippedIds.push(id); }
    if (cappedAsk) { cappedAsks++; cappedIds.push(id); }
    // W3e-3 / F198: redaction left nothing of this instruction that can be shown. Its words are
    // MISSING, not empty and never the redactor's: the event keeps its place in the order, carries
    // no quotable text, and is omitted — so the instruction history reads incomplete
    // (ledger.js instructionReviewScope). A ledger persisted before W3e-3 carries the redactor's
    // old literal in the human's place instead; it is read the same way.
    // D90: a mark-shaped string is an earlier redactor's only where the record declares its work (`redactorDeclared`);
    // in any other ask it is the human's own words (a pasted page), kept whole and quotable.
    const declared = redactorField(ask);
    const redactedAway = ask.redacted === true && typeof ask.text === 'string'
      && (!ask.text.trim() || ask.text === DROPPED_ASK_LITERAL);
    const partlyRedacted = (Number(ask.redactedLines) > 0 || declared && hasRedactionToken(ask.text))
      && !redactedAway;
    if (redactedAway || partlyRedacted) withheldAsks.push(id);
    // Gain I (2026-10-13): the nontext blocks the message carried (an image the human pasted), on its event.
    const nonText = askNonText(ask);
    return { id, kind: 'instruction', sequence: sequence++,
      authority: ask.authority ?? 'human', supersedes: [],
      ...(nonText.length ? { nonText } : {}),
      ...(elided || redactedAway || partlyRedacted ? { omitted: true } : {}),
      ...(cappedAsk && !shortenedAsk ? { capped: true } : {}),
      ...(strippedAsk && !shortenedAsk ? { stripped: true } : {}),
      ...(redactedAway || partlyRedacted ? { redacted: true } : {}),
      text: redactedAway ? [] : elided || partlyRedacted
        ? putAround(ask.text, declared ? INSTRUCTION_OMISSION : ASK_CUTS) : put(ask.text) };
  };

  // M33 P: each hand-off event and report placed by a row of its own (not by an action's), for `workBetween`.
  const headRow = new Map();
  // The global count of this ledger's actions recorded before the action at (turn, seq): its position.
  const ledgerActs = (ledger.ledger ?? []).filter((act) => Number.isSafeInteger(act?.turn) && Number.isSafeInteger(act?.seq));
  const actionPos = (turn, seq) => ledgerActs.filter((act) => act.turn < turn || act.turn === turn && act.seq < seq).length;
  /** M33 P: each linked child adapted once per review (both layouts and every piece of its history share it). */
  const adaptChild = (unit, key) => {
    let byKey = childSessions.get(unit.ledger);
    if (!byKey) { byKey = new Map(); childSessions.set(unit.ledger, byKey); }
    if (!byKey.has(key)) byKey.set(key, sessionFromLedger(unit.ledger, { sessionKey: key, [CHILD_SESSIONS]: childSessions }));
    return byKey.get(key);
  };
  /**
   * B2. A linked child's evidence is transferred ONCE, by the hand-off that spawned it: its blobs (prefixed), its
   * spelled count and its own links. Its events are emitted by whoever places them — the spawn's block, or (M33 P)
   * each piece of its history at that piece's placement.
   */
  const transferChild = (delegation, id, unit, childId) => {
    const key = `${sessionKey}/${CHILD_PREFIX(childId).slice(0, -1)}`;
    const child = adaptChild(unit, key);
    const prefix = CHILD_PREFIX(childId);
    // Already spelled by the child's own adapter run; its count becomes part of this session's.
    for (const [blobKey, text] of Object.entries(child.blobs)) blobs[prefix + blobKey] = text;
    controlCharsReplaced += Number.isSafeInteger(child.controlCharsReplaced) ? child.controlCharsReplaced : 0;
    // The child's own hand-offs are now events of THIS session, so their links travel with
    // them; without this a transferred grandchild would read as a missing child (ledger.js
    // resolves every delegate event against `children`).
    for (const link of child.children)
      children.push(childLink({ ...link, assignmentEvent: prefix + link.assignmentEvent }, link.session));
    transferred.set(delegation.link.source, { childId, session: child, ledger: unit.ledger, assignmentEvent: id });
    return child;
  };
  /** One transferred child event, renamed into this session; a transferred boundary is counted as it rides. */
  const emitChildEvent = (event, prefix, childId, deliveredBy = null) => {
    events.push({ ...renameChildEvent(event, prefix, childId), sequence: sequence++,
      // M33 P: the helper's own events of a segment another assignment delivered are that delivery's (C-06 part).
      ...(deliveredBy !== null && event.childId == null ? { deliveredBy } : {}) });
    // C-02 M33 (4): like this session's own, a transferred interrupt boundary is not counted in a later commentary
    // id, so a child's typed row renames none of the parent's events; nor (M33 P) is a transferred receipt boundary.
    if (event.kind === 'boundary' && event.boundary === 'interrupt') childInterruptN++;
    if (event.kind === 'boundary' && event.boundary === HELPER_RECEIPT_BOUNDARY) childReceiptN++;
  };
  // M33 P: each child's cut points, once: [0, start of segment 1, …, its event count].
  const cutsOf = new Map();
  const emitPieceEvents = (piece) => {
    let transfer = transferred.get(piece.child);
    if (!transfer) {
      // Never expected (the spawn's block is emitted first); the history is still never dropped.
      transferChild(piece.spawn, piece.spawnId, piece.unit, piece.childId);
      transfer = transferred.get(piece.child);
    }
    const child = transfer.session;
    if (!cutsOf.has(piece.child)) {
      const pieces = piecesOf.get(piece.child);
      const cuts = [0];
      // M33 P second repair: a Claude helper's later piece starts at its own later request (its recording's turn).
      for (const start of segmentStartsOf(child, pieces.slice(1).map((p) => (p.request !== null ? { request: p.request } : p.arrival))))
        cuts.push(Math.max(cuts.at(-1), start));
      cuts.push(child.events.length);
      cutsOf.set(piece.child, cuts);
    }
    const cuts = cutsOf.get(piece.child);
    const prefix = CHILD_PREFIX(transfer.childId);
    // A piece another assignment delivered is that assignment's (C-06 part), a Claude helper's resumed work (D175) its
    // resuming SendMessage's; a Claude helper's work after its own later request was delivered by no recorded parent
    // event: it stays its hand-off's.
    for (const event of child.events.slice(cuts[piece.k], cuts[piece.k + 1]))
      emitChildEvent(event, prefix, transfer.childId, piece.k > 0 && !Object.hasOwn(piece.delivery, 'request')
        ? piece.deliveryId : null);
  };

  for (const turn of turns) {
    const turnStart = events.length;
    const handOffs = [];        // this turn's hand-off blocks, [start, end) in emission order
    let openHandOff = null;
    const closeHandOff = () => {
      if (openHandOff) handOffs.push({ ...openHandOff, end: events.length });
      openHandOff = null;
    };
    for (const ask of asks.filter((a) => a.turn === turn)) {
      // M34 labels: the markers the slicer read from the row's structure (closed; anything else is not carried), and an
      // `after_interrupt` instruction's link to the typed interrupt boundary it follows.
      const markers = Array.isArray(ask.markers) ? INSTRUCTION_MARKERS.filter((marker) => ask.markers.includes(marker)) : [];
      const after = markers.includes('after_interrupt') ? interruptBoundaryOf(ask.interrupted) : null;
      events.push({ ...instructionEvent(ask, askIds.get(ask) ?? `I${turn}`), ...(markers.length ? { markers } : {}),
        ...(after ? { interruptedBy: after } : {}) });
      factOf.set(events[events.length - 1], { turn, kind: 'instruction' });
    }

    const acts = (ledger.ledger ?? []).filter((e) => e.turn === turn).sort((a, b) => a.seq - b.seq);
    const priorActions = (ledger.ledger ?? []).filter((e) => e.turn < turn).length;
    const says = (ledger.commentary ?? []).filter((c) => c.turn === turn);

    // CRD-A1/G3: beforeEvent is a GLOBAL action index (slicer events.js:172 writes
    // events.length), while `seq` restarts per turn. Clamping the global index straight into
    // this turn's local slots pushed later-turn commentary AFTER the action it preceded: on
    // turn 2 a statement with global index 1 clamped to the turn's single action and landed
    // behind it. Subtract the actions of prior turns first, then clamp.
    //
    // The clamp itself stays: a block recorded after the turn's last action carries an index
    // past the end, and dropping those silently lost two thirds of the agent's stated intent.
    const slotFor = (say) => {
      const local = (say.beforeEvent ?? 0) - priorActions;
      return Math.max(0, Math.min(acts.length, local));
    };
    // This turn's typed interrupts, in source order, each in the slot its row was recorded in.
    // An interrupt boundary carries no text; it is not counted in a commentary event's id.
    const turnInterrupts = interrupts.filter(({ mark }) => mark.turn === turn)
      .map((interrupt) => ({ ...interrupt, slot: slotFor(interrupt.mark) }));
    // A result of this turn's call is known to be recorded after the typed row when its locator
    // puts the call before the row and the result after it, on the row's own stream.
    const turnActIds = new Set(acts.map((act) => ids.act(act)));
    const recordedAfter = (event, mark) => event?.kind === 'observation' && turnActIds.has(event.invocation)
      && event.sourceLocator?.stream === mark.stream && event.sourceLocator.record < mark.record
      && Number.isSafeInteger(event.sourceLocator.resultRecord) && event.sourceLocator.resultRecord > mark.record;
    // The boundary goes where its row was recorded: back past the results just emitted that were
    // recorded after it, and no further, so no other event changes its relative order. Later events
    // keep contiguous sequences.
    const emitInterrupt = ({ mark, ordinal, slot }) => {
      let at = events.length;
      while (at > 0 && recordedAfter(events[at - 1], mark)) at--;
      const boundary = { id: ids.of(mark) ?? `B${turn}-i${ordinal}`, kind: 'boundary', sequence: at,
        boundary: 'interrupt', relatedSession: null };
      rowOf.set(boundary, [mark.stream, mark.record]);
      slotOf.set(boundary, { slot, action: false });
      factOf.set(boundary, { turn, pos: priorActions + slot, row: [mark.stream, mark.record] });
      events.splice(at, 0, boundary);
      for (let later = at + 1; later < events.length; later++) events[later].sequence = later;
      sequence++;
      interruptN++;
    };
    let lastSlotInterrupts = [];
    // OWNER DECISION B: this turn's in-turn human instructions, each in the slot its row was recorded in.
    const turnHeard = heard.filter(({ entry }) => entry.turn === turn).map((item) => ({ ...item, slot: slotFor(item.entry) }));
    const heardBefore = (item, other) => Number.isSafeInteger(other?.source) && Number.isSafeInteger(other?.record)
      && (item.entry.source < other.source || (item.entry.source === other.source && item.entry.record < other.record));
    const emitHeard = ({ entry, id, recordedAs, authority, slot }) => {
      const event = { ...instructionEvent({ ...entry, authority }, id), ...recordedAs };
      events.push(event);
      heardN++;
      slotOf.set(event, { slot, action: false });
      rowOf.set(event, [entry.source, entry.record]);
      factOf.set(event, { turn, pos: priorActions + slot, row: [entry.source, entry.record] });
    };
    // Commentary emitted for this turn, so a final saying can be matched against it below.
    const turnCommentary = [];
    // A shell write (`sed -i`, `tee`, a heredoc) is emitted by the slicer as a sibling `edit`
    // event immediately after the bash event that performed it (events.js:200-207), carrying
    // `via` and a path but never an id, so it never receives a result of its own. Record which
    // command it belongs to: the sibling holds the path, the command holds the outcome, and
    // reading either alone made the ledger state something false about the patch (audit B10).
    let shellParent = null;
    for (let i = 0; i <= acts.length; i++) {
      const slotInterrupts = turnInterrupts.filter((interrupt) => interrupt.slot === i);
      const slotHeard = turnHeard.filter((item) => item.slot === i);
      for (const say of says.filter((s) => slotFor(s) === i)) {
        while (slotInterrupts.length && rowBefore(slotInterrupts[0].mark, say)) emitInterrupt(slotInterrupts.shift());
        while (slotHeard.length && heardBefore(slotHeard[0], say)) emitHeard(slotHeard.shift());
        // M33 P: an id counts the events emitted before it, never this session's or a transferred child's receipt
        // boundaries (they were never in the launch layout); and when a placement crossed a turn, the launch layout's
        // own id is used, so placing a helper at its receipt renumbers no commentary.
        const ordinal = events.length - boundaryN - interruptN - childInterruptN - receiptN - childReceiptN - heardN;
        const commentaryId = ids.of(say) ?? launchIds?.[commentaryIds.length] ?? `C${turn}-${i}-${ordinal}`;
        commentaryIds.push(commentaryId);
        const event = { id: commentaryId,
          kind: 'commentary', sequence: sequence++,
          phase: 'working', beforeInvocation: i < acts.length ? ids.act(acts[i]) : null,
          text: putProse(say.text, redactorField(say)) };
        events.push(event);
        slotOf.set(event, { slot: i, action: false });
        const row = rowFrom(say.source, say.record);
        if (row) rowOf.set(event, row);
        factOf.set(event, { turn, pos: priorActions + i, ...(row ? { row } : {}) });
        // `record` and `block` come from the slicer (events.js:170) and are what makes the dedup
        // below structural rather than textual. Do not strip them here.
        turnCommentary.push({ event, text: String(say.text ?? ''), record: say.record, block: say.block });
      }
      // OWNER DECISION B: the rest of the slot's in-turn instructions, recorded after its commentary and before its action.
      while (slotHeard.length) emitHeard(slotHeard.shift());
      // After the turn's last action, a typed interrupt may still follow a hand-off below.
      if (i === acts.length) { lastSlotInterrupts = slotInterrupts; break; }
      while (slotInterrupts.length) emitInterrupt(slotInterrupts.shift());

      const act = acts[i];
      const id = ids.act(act);
      // What was ATTEMPTED, not what the outcome turned the record into.
      const attempted = act.attempted ?? act.kind;
      const isCommand = COMMAND_KINDS.includes(attempted);
      // Only an event the slicer wrote directly after a command, with `via` set, is that
      // command's shell write. A structured Write/Edit never carries `via`, and a gap in the
      // chain ends it — an inferred parent would attach a real outcome to an unrelated write.
      const shellWriteOf = !isCommand && act.via && shellParent ? shellParent : null;
      shellParent = isCommand ? id : (shellWriteOf ? shellParent : null);
      const operation = isCommand ? 'command' : (OPERATION[attempted] ?? 'other');
      // W3e-6 / F213: the path is rendered and quotable (role=action) without passing through a
      // blob, and the tool is rendered in the event's header, so both are spelled as a blob is.
      // Spelled once here: every change of this action carries the same stored path.
      const path = spellField(act.path);
      const otherInput = attempted === 'other' && typeof act.argsExcerpt === 'string'
        ? act.argsExcerpt.split(INPUT_PART).flatMap((part) => part ? putProse(part, redactorField({ redacted: act.inputRedacted })) : []) : [];
      const metadataInput = typeof act.inputMetadata === 'string'
        ? putProse(act.inputMetadata, redactorField({ redacted: act.inputMetadataRedacted })) : [];
      const sourceLocator = sourceLocatorOf(act);
      const recordedTool = attempted === 'other' && typeof act.tool === 'string' ? act.tool : act.via ?? attempted;
      const invocation = { id, kind: 'invocation', sequence: sequence++, callKey: id,
        tool: spellField(recordedTool),
        operation,
        // M33 brittleness L3: whether it asked the human, or recorded a human choice, by this recorder's own schema.
        ...humanInteractionFlags(adapter, recordedTool),
        ...(sourceLocator ? { sourceLocator } : {}),
        paths: path ? [{ path }] : [],
        command: isCommand && act.cmd ? putProse(act.cmd, redactorField(null)) : [],
        ...(shellWriteOf ? { shellWriteOf } : {}),
        ...(shellWriteOf && act.shellWriteStatusEligible === true
          ? { shellWriteStatusEligible: true } : {}),
        input: [...otherInput, ...metadataInput],
        // M33 W repair 2: a Workflow call that resumed a run names the run's own call, a plain event id (no source
        // text: no review request reads it, and no quote can cite it). Its agents are that call's helpers.
        ...(act.tool === 'Workflow' && workflowResumeOf.has(`${turn}:${act.seq}`)
          ? { workflowRun: ids.actAtKey(workflowResumeOf.get(`${turn}:${act.seq}`)) } : {}),
        // M34 labels review (F5): how many background-task notifications the slicer linked to this call by the id they
        // carry (its label's `links.notifies`). A count only: their text is not read (C-02 M33 D), and a notification
        // whose carried id names no recorded call is declared (`notification_unmatched`; one carrying no id is not).
        ...(Number.isSafeInteger(act.notified) && act.notified > 0 ? { notified: act.notified } : {}),
        // D99 (F1 guard): how the slicer read a background run's end that is no typed completion or failure. Present
        // only when it is a member of the closed set, so every other invocation keeps its bytes.
        ...(Object.values(LEDGER_BACKGROUND_ENDS).includes(act.backgroundEnd) ? { backgroundEnd: act.backgroundEnd } : {}),
        // D68 (C-02 "M36 recorded facts"): the recorder's typed facts about the call, as data for the windows to render.
        ...recordedFactsOf(act.recorded, ids, spellField),
        // D71 (S2): the slicer's mark on a call a recorder that types no refusal recorded as failed
        // (L1, `refusalUntyped`): its result's typed outcome is failed-or-refused (ledger.js `resultOutcome`). Present
        // only when true, so every other invocation keeps its bytes.
        ...(act.refusalUntyped === true ? { refusalUntyped: true } : {}),
        changes: Object.hasOwn(OPERATION, attempted) ? changesOf(act, id, path) : [] };
      events.push(invocation);
      slotOf.set(invocation, { slot: i, action: true });
      if (sourceLocator) rowOf.set(invocation, [sourceLocator.stream, sourceLocator.record]);
      factOf.set(invocation, { turn, pos: priorActions + i, action: true });

      const output = Array.isArray(act.tailLines) ? act.tailLines.join('\n') : '';
      // ToolSearch's exact tool_reference blocks are distinct native sources. The redactor scans
      // their names in tailLines; place each surviving name in its own blob so a quote can name
      // one reference but cannot cross the newline we only added for display.
      const outputDeclared = redactorField({ redacted: act.observationRedacted });
      const outputRefs = () => act.toolReferenceSpans === true && Array.isArray(act.tailLines)
        ? act.tailLines.flatMap((name) => typeof name === 'string' && name
          ? putOutput(name, false, outputDeclared) : [])
        : act.genericTool === true && act.observationRedacted === true ? []
        : act.genericTool === true && Array.isArray(act.outputSpans)
          ? act.outputSpans.flatMap((span) => typeof span === 'string' && span
            ? putOutput(span, false, outputDeclared) : [])
        : output ? putOutput(output, act.tailClipped === true, outputDeclared) : [];
      // A terminal observation is emitted ONLY when the record actually carries one. Commands
      // carry `outcome`; write-shaped events carry the structured `result` evidence added for
      // CRD-A1/G2. Absent both, no result was recorded -- and inventing a successful one is how
      // an attempted write became an adopted decision.
      const typedExit = Number.isInteger(act.exitCode)
        && ['native', 'hook'].includes(act.exitCodeSource);
      // H1: a command's recorded outcome counts only from a native or hook status. A label an older slicer parsed from
      // the output text (`parsed-output`), or one recorded with no source at all, is `unknown`: text never concludes.
      const commandSource = act.outcomeSource ?? act.exitCodeSource ?? 'unknown';
      const parsedLabel = act.outcome != null && !NATIVE_STATUS.includes(commandSource);
      // M1: a ledger that records a typed exit but no outcome is read by one rule for every command: a nonzero exit
      // failed; a zero exit is `unknown`, because no slicer recorded whether it speaks for every command of the line
      // (H1's `unproven`). Never "is it a test" (the old rule distrusted exit 0 for a runner name only).
      const commandOutcome = act.outcome != null ? (parsedLabel ? 'unknown' : OUTCOME[act.outcome] ?? 'unknown')
        : isCommand && typedExit ? (act.exitCode === 0 ? 'unknown' : 'failed') : null;
      const writeResult = act.result?.seen ? act.result : null;
      const outcome = commandOutcome ?? writeResult?.outcome ?? null;
      if (outcome !== null && act.observationMissing !== true) {
        const sourceOfResult = commandOutcome != null ? (parsedLabel ? 'unknown' : commandSource)
          : (writeResult?.provenance ?? 'unknown');
        // C-02 M33 D: a closed Claude status source proves termination with no exit code.
        const claudeStatus = isCommand && LEDGER_COMMAND_STATUS_SOURCES.includes(act.statusSource)
          && !Number.isFinite(act.exitCode) && act.isError !== true;
        const terminalStatusProven = act.interrupted !== true && act.conflict !== true
          && act.outcomeUnknown !== true && writeResult?.conflict !== true
          && (isCommand
            ? typedExit || claudeStatus || (['native', 'hook'].includes(sourceOfResult)
              && ['failed', 'cancelled'].includes(outcome))
            : ['native', 'hook'].includes(sourceOfResult)
              && ['succeeded', 'failed', 'cancelled'].includes(outcome));
        // Status fact (owner decision 2026-10-06; C-02): the status of the line's LAST command as the record types it —
        // `lastStatus`: its exit code, or with none Claude Code's typed verdict (`completed`, a zero status; `failed`) —
        // kept apart from whether a zero one speaks for every command of the line: `coversAll` (the slicer's `passed`)
        // and, when it does not, `statusGap`, the slicer's closed reason (its `unproven`). Only a believed status
        // (`terminalStatusProven`) from a native or hook source states one; an error flag alone types no last status.
        const lastStatus = !isCommand || !terminalStatusProven || parsedLabel ? null
          : typedExit ? { exitCode: act.exitCode, verdict: null }
          : claudeStatus ? { exitCode: null, verdict: act.outcome === 'failed' ? 'failed' : 'completed' } : null;
        const zeroStatus = lastStatus !== null && (lastStatus.exitCode === 0 || lastStatus.verdict === 'completed');
        const statusGap = zeroStatus && act.outcome === 'unproven' && LEDGER_STATUS_GAPS.includes(act.statusGap)
          ? act.statusGap : null;
        events.push({ id: ids.sub(id, 'r'), kind: 'observation', sequence: sequence++,
          invocation: id, callKey: id, phase: 'terminal',
          ...(sourceLocator ? { sourceLocator } : {}),
          result: outcome,
          terminalStatusProven,
          // The actual recorded exit code, never reconstructed from an error flag.
          exitCode: Number.isFinite(act.exitCode) ? act.exitCode
            : Number.isFinite(writeResult?.exitCode) ? writeResult.exitCode : null,
          output: outputRefs(),
          // M36 phase 2 review (D68 R; C-02 "M36 withholding narrowed"): the slicer withheld this output (a credential-
          // shaped path or the harness's own files), so its empty `output` is Sonah's withholding, never a recorded empty
          // result. Present only when true: every other result keeps its bytes.
          ...(act.observationWithheld === true ? { outputWithheld: true } : {}),
          // Old ledgers did not record whether a command status came from the harness,
          // a hook, or parsed text. Their source cannot be upgraded to native by default.
          sourceOfResult,
          ...(lastStatus ? { lastStatus } : {}),
          ...(zeroStatus ? { coversAll: act.outcome === 'passed' } : {}),
          ...(statusGap ? { statusGap } : {}) });
        slotOf.set(events[events.length - 1], { slot: i, action: true });
        factOf.set(events[events.length - 1], { turn, pos: priorActions + i, action: true });
      }
    }

    /**
     * M33 P. Did the parent record work of its own between a helper's delivery and the receipt of its result? A later
     * turn did (its request, at least); else an own event of this turn recorded strictly between the delivery's row and
     * the receipt's (commentary, a located action, a typed interrupt, another hand-off or a received report); an
     * action with no row is compared by its count (`beforeEvent`) when the delivery has one, and otherwise counts. Only
     * then is the concurrency stated: a receipt right after its delivery leaves nothing of the parent's to order.
     */
    const workBetween = ({ deliveryId, deliveryTurn, deliveryRow, deliveryPos }, receipt) => {
      if (receipt.turn > deliveryTurn) return true;
      for (let at = turnStart; at < events.length; at++) {
        const event = events[at];
        // The delivering event itself (a send action, a Workflow call) is the delivery, never work between.
        if (event.childId != null || event.kind === 'instruction' || event.kind === 'observation' && !headRow.has(event)
          || event.kind === 'boundary' && event.boundary !== 'interrupt' || event.id === deliveryId) continue;
        const row = rowOf.get(event) ?? headRow.get(event);
        if (row) {
          const recorded = { source: row[0], record: row[1] };
          if (!deliveryRow || rowAfterRow(recorded, deliveryRow) && rowAfterRow(receipt, recorded)) return true;
          // M33 P repair: an action called at or before the delivery's row whose RESULT the parent recorded after it and
          // before the receipt (parallel calls on one row, or a sibling called first) ran concurrently with the helper.
          const result = event.kind === 'invocation' ? event.sourceLocator?.resultRecord : undefined;
          if (Number.isSafeInteger(result) && event.sourceLocator.stream === row[0]
            && rowAfterRow({ source: row[0], record: result }, deliveryRow)
            && rowAfterRow(receipt, { source: row[0], record: result })) return true;
          continue;
        }
        const fact = factOf.get(event);
        if (Number.isSafeInteger(fact?.pos) && Number.isSafeInteger(deliveryPos)) {
          if (fact.pos > deliveryPos && fact.pos < receipt.beforeEvent) return true;
          continue;
        }
        return true;
      }
      return false;
    };
    // M33 P: one receipt boundary per delivery and receipt row (a Workflow run's agents share theirs). M33 P repair: a
    // block whose receipt is not proven is headed by it too, marked `unproven` (at a row, or at the request's end).
    const receiptBoundaries = new Map();
    /** The end of a request: where a block with no row stands (after the request's own work). */
    const endOf = (at) => ({ turn: at, beforeEvent: Number.MAX_SAFE_INTEGER, source: Number.MAX_SAFE_INTEGER,
      record: Number.MAX_SAFE_INTEGER, end: true });
    /**
     * M33 P second repair. This turn's own actions called on a row before a proven receipt's and answered at or after
     * it (same stream): a call and its result are never separated, so their results stand before the helper's events,
     * though the parent received the helper's result no later than them. Recorded on the boundary (`held`); M35
     * windowing states it in no review window (C-07).
     * A TaskOutput poll answered on the receipt's own row is that receipt (C-02 M33 D), never held.
     */
    const heldBehind = (receipt) => {
      const held = [];
      for (let at = turnStart; at < events.length; at++) {
        const event = events[at];
        if (event.kind !== 'invocation' || event.childId != null || event.operation === 'delegate') continue;
        const row = rowOf.get(event);
        const result = event.sourceLocator?.resultRecord;
        if (row && Number.isSafeInteger(result) && event.sourceLocator.stream === row[0] && row[0] === receipt.source
          && row[1] < receipt.record && result >= receipt.record
          && !(event.tool === 'TaskOutput' && result === receipt.record)) held.push(event.id);
      }
      return held;
    };
    const receiptBoundary = (delivery, receipt, assignment, unproven = false) => {
      const key = `${delivery.deliveryId}|${receipt.end ? `end:${turn}` : `${receipt.source}:${receipt.record}`}`;
      const existing = receiptBoundaries.get(key);
      if (existing !== undefined) {
        if (existing && assignment && !existing.assignments.includes(assignment)) existing.assignments.push(assignment);
        return;
      }
      const held = unproven || receipt.end ? [] : heldBehind(receipt);
      if (!held.length && !workBetween(delivery, receipt)) { receiptBoundaries.set(key, false); return; }
      // C-01 event identity: the k-th receipt boundary of its delivery (positional, `R<turn>-<n>`, beside a delivery
      // that has no recorded identity).
      const k = receiptsOf.get(delivery.deliveryId) ?? 0;
      receiptsOf.set(delivery.deliveryId, k + 1);
      const boundaryId = ids.derived(delivery.deliveryId) ? ids.sub(delivery.deliveryId, `receipt${k}`) : `R${turn}-${receiptN}`;
      const boundary = { id: boundaryId, kind: 'boundary', sequence: sequence++,
        boundary: HELPER_RECEIPT_BOUNDARY, relatedSession: null, delivery: delivery.deliveryId,
        assignments: assignment ? [assignment] : [], turn: turnIdentity(delivery.deliveryTurn),
        ...(unproven ? { unproven: true } : {}), ...(held.length ? { held } : {}) };
      receiptN++;
      receiptBoundaries.set(key, boundary);
      events.push(boundary);
      factOf.set(boundary, receipt.end ? { turn, end: true } : { turn, row: [receipt.source, receipt.record] });
    };

    // Work handed to a sub-agent is an action the ledger has to be able to see. It carries no
    // path, no command and no outcome: declaring it is the point, transferring the child's
    // evidence is not (that is B2). The brief goes on `input`, which `sourcesFor` exposes only
    // with the action role — a parent's assignment is never a human instruction.
    for (const item of handOffOrder(turn)) {
      closeHandOff();
      if (item.arrival?.piece) {
        // M33 P: one segment of a helper's history, at its receipt. M33 P repair: or, unproven, at the helper's next
        // report, or (no row) after this request's own work — a block that is never moved back.
        const { piece, receipt, unproven } = item.arrival;
        const at = item.arrival.row;
        while (lastSlotInterrupts.length && (at === null || rowBefore(lastSlotInterrupts[0].mark, at)))
          emitInterrupt(lastSlotInterrupts.shift());
        openHandOff = { delegation: at ?? {}, start: events.length, ...(receipt ? { receiptSlot: slotFor(receipt) } : {}) };
        receiptBoundary(piece, receipt ?? endOf(turn), piece.spawnId, unproven);
        emitPieceEvents(piece);
        continue;
      }
      if (item.arrival && !item.arrival.receipt && item.arrival.unreceivedRun !== true) {
        // M33 F placement: a report that arrived this turn, its own block at its own row (see `reportArrivals`).
        const at = item.arrival.row ?? {};
        while (lastSlotInterrupts.length && rowBefore(lastSlotInterrupts[0].mark, at))
          emitInterrupt(lastSlotInterrupts.shift());
        openHandOff = { delegation: at, start: events.length };
        emitReport(ids.delegation(item.arrival.delegation, item.arrival.index), item.arrival.report);
        const report = events[events.length - 1];
        if (item.arrival.row) {
          headRow.set(report, [item.arrival.row.source, item.arrival.row.record]);
          factOf.set(report, { turn, row: [item.arrival.row.source, item.arrival.row.record] });
        } else factOf.set(report, { turn });
        continue;
      }
      const { delegation, index } = item.arrival ?? item;
      // M33 W2: a Workflow agent received this turn is ordered by its receipt's row and slot, never its call's.
      const receipt = item.arrival?.receipt ?? null;
      // M33 P second repair: a Workflow agent never received, moved to the session's last request (no row: at its end).
      const moved = item.arrival?.unreceivedRun === true;
      const placedAt = receipt ? item.arrival.row : delegation;
      // M33 P repair: a linked Workflow agent with no valid receipt is never moved back (after this request's own work);
      // a linked Claude Agent/Task whose whole history rides in its block (no valid M33 P record) never moves back past
      // a parent action (`placeHandOffs`).
      const unmoved = !receipt && unmovedAgents.has(delegation);
      const pastActions = !receipt && !unmoved && delegation.adapter === 'claude' && delegation.status === 'linked'
        && !piecesOf.has(delegation.link?.source) ? false : undefined;
      while (lastSlotInterrupts.length && (unmoved || rowBefore(lastSlotInterrupts[0].mark, placedAt)))
        emitInterrupt(lastSlotInterrupts.shift());
      // C-03 M33 child placement: this hand-off's block starts here (see `placeHandOffs`).
      openHandOff = { delegation: unmoved ? {} : placedAt, start: events.length,
        ...(receipt ? { receiptSlot: slotFor(receipt) } : {}), ...(pastActions === false ? { pastActions } : {}) };
      // Its identity is its call's (C-01 event identity: the recorder's), wherever it is placed.
      const id = ids.delegation(delegation, index);
      delegationEventIds.set(delegation, id);
      // M33 T: two plain facts ride beside it, neither of them source text (`sourcesFor` never reads them, so no
      // review request byte changes): the hand-off's verified task name, and that the recorder encrypted its brief.
      const taskName = verifiedTaskName(delegation);
      // M33 W: a Workflow agent is a helper of its Workflow call: its delegate event names that call's event and the
      // workflow's recorded name as plain fields (never source text, so no review request reads them), and carries no
      // brief of its own (the parent recorded none: the agent's recording holds the brief it received).
      const workflowAgent = delegation.kind === WORKFLOW_AGENT_KIND;
      const workflowCall = workflowAgent && workflowActions.has(`${delegation.turn}:${delegation.workflowSeq}`)
        ? ids.actAt(delegation.turn, delegation.workflowSeq) : null;
      // M33 P: a run received here, after parent work recorded since its call, is headed by its receipt boundary.
      const runDelivery = workflowCall ? { deliveryId: workflowCall, deliveryTurn: delegation.turn,
        deliveryRow: hasRow(delegation) ? { source: delegation.source, record: delegation.record } : null,
        deliveryPos: actionPos(delegation.turn, delegation.workflowSeq) } : null;
      if (receipt && runDelivery) receiptBoundary(runDelivery, receipt, id);
      // M33 P second repair: a run never received is headed by the unproven boundary (C-03 M33 P repair (5)) when the
      // parent recorded work of its own between its launch and the block (after its request, or the session's last).
      else if (unmoved && runDelivery) receiptBoundary(runDelivery, endOf(turn), id, true);
      const handOff = { id, kind: 'invocation', sequence: sequence++, callKey: id,
        tool: workflowAgent ? 'Workflow' : spellField(delegation.parentInstruction?.tool ?? 'delegation'),
        operation: 'delegate', paths: [], command: [], changes: [],
        input: !workflowAgent && delegation.parentInstruction?.text
          ? putProse(delegation.parentInstruction.text, redactorField(delegation.parentInstruction)) : [],
        ...(taskName ? { taskName } : {}), ...(encryptedBrief(delegation) ? { briefEncrypted: true } : {}),
        ...(workflowCall ? { workflowCall } : {}),
        ...(workflowAgent && plainWorkflowName(delegation.workflowName) ? { workflowName: delegation.workflowName } : {}),
        // M33 P: placed at a receipt, it keeps its call's C-02 turn (its part is the request that launched it); so does
        // (M33 P second repair) a run never received, placed after the session's last request.
        ...(receipt || moved ? { turn: turnIdentity(delegation.turn) } : {}),
        // D68 (C-02 "M36 recorded facts"): a Claude Code Agent call's typed result facts, as data.
        ...recordedFactsOf(delegation.recorded, ids, spellField, RECORDED_AGENT_KEYS) };
      events.push(handOff);
      const blockRow = receipt ? [receipt.source, receipt.record] : moved ? null
        : hasRow(delegation) ? [delegation.source, delegation.record] : null;
      if (blockRow) headRow.set(handOff, blockRow);
      factOf.set(handOff, moved ? { turn, end: true } : { turn, ...(blockRow ? { row: blockRow } : {}) });
      // M33 W: a Workflow agent's report is its run journal's record of what the agent returned: no parent row
      // received it, so it closes the agent's own block, after its transferred history — never moved elsewhere.
      const closingReport = workflowAgent && gluedReports.has(delegation);
      const closeBlock = () => { if (closingReport) emitReport(id, helperReport(delegation, redactorField), receipt || moved ? delegation.turn : null); };
      if (delegation.status === 'failed') {
        events.push({ id: ids.sub(id, 'r'), kind: 'observation', sequence: sequence++, invocation: id,
          callKey: id, phase: 'terminal', result: 'failed', exitCode: null, output: [],
          sourceOfResult: 'native' });
      } else if (gluedReports.has(delegation) && !closingReport) {
        // M33 F: a report whose recorded position cannot place it after this hand-off stays right after it.
        emitReport(id, helperReport(delegation, redactorField));
      }
      if (delegation.status !== 'linked') { closeBlock(); continue; }

      // B2. The child's own evidence, spliced in behind its assignment. A follow-up reuses the
      // child an earlier spawn already transferred: a second hand-off to the same agent is a
      // second edge, never a second copy of its actions.
      const source = delegation.link?.source;
      const already = transferred.get(source);
      const unit = already ? null : (ledger.children ?? []).find((c) => c?.source === source);
      // Linked, but this ledger carries no child evidence: that is unreviewed work, and the
      // C-03 state for it is `missing`, which is what makes buildLedger declare the gap.
      if (!already && !unit?.ledger) {
        children.push(childLink({ assignmentEvent: id, childSession: null,
          childId: delegation.childId ?? null, relation: relationOf(delegation),
          state: 'missing', historyStart: null }, null));
        closeBlock();
        continue;
      }
      // A task-named Codex spawn may have no visible opaque child ID. Its verified parent/task
      // tuple is stable across inventory growth; the candidate source ordinal is not. If the
      // tuple is unavailable, do not transfer evidence under a fabricated identity.
      const childId = already?.childId ?? delegation.childId ?? tupleChildId(ledger, delegation);
      if (!childId) {
        children.push(childLink({ assignmentEvent: id, childSession: null,
          childId: null, relation: relationOf(delegation),
          state: 'missing', historyStart: null }, null));
        closeBlock();
        continue;
      }
      let child = already?.session;
      if (!already) {
        child = transferChild(delegation, id, unit, childId);
        // M33 P: a helper whose history a valid record cuts emits none of it here: each piece is placed by its receipt
        // (M33 P repair: or, unproven, after a request's own work); any other helper's whole history follows its spawn.
        if (!piecesOf.has(source)) for (const event of child.events) emitChildEvent(event, CHILD_PREFIX(childId), childId);
      }
      children.push(childLink({ assignmentEvent: id, childSession: child.sessionKey,
        sessionKey: child.sessionKey, childId,
        relation: relationOf(delegation), state: 'verified', historyStart: null,
        // A verified follow-up target says which child was addressed. That identity alone, or the child's
        // already-transferred history, proves no delivery or later child work. M33 P: an arrival of its own payload,
        // byte for byte, in that child's recording, and the segment of history it delivered, prove both.
        ...(delegation.kind === 'followup' ? { assignmentEffectProven: provenFollowups.has(delegation) } : {}) }, child));
      closeBlock();
    }
    closeHandOff();

    // CRD-A1: `sayings` is the turn's LAST assistant record, re-serialised — slicer events.js
    // joins that record's text blocks with '\n' and trims; redaction scrubs it whole and bounds it
    // (M33 F repair 3: at line boundaries around STATEMENT_OMISSION; an older slicer capped it at
    // 6000 + '\n[…]\n' + 2000 before redaction). The same blocks are in `commentary`. Emitting
    // both let two findings cite one sentence.
    //
    // Per-line coverage was tried and dropped real statements that shared a code fence with an
    // earlier block (audit B7). The only honest test is structural: rebuild what the slicer
    // built, from the blocks of the turn's last record, and compare whole. Equal → duplicate,
    // mark that record's last block final, emit nothing. Not equal → a real recorded span, emit it.
    const sayings = (ledger.sayings ?? []).filter((x) => x.turn === turn);
    // F6: a final assistant record whose only text block is empty or whitespace rebuilds to the
    // empty string while the saying still belongs to the record before it — and an empty rebuild
    // matches nothing, so that saying would be emitted a second time beside the blocks that
    // already carry it. Fall back to the last record that actually has text. The branch is
    // rare; the cost of being wrong is a duplicated accusation.
    const records = [...new Set(turnCommentary
      .map((c) => (Number.isFinite(c.record) ? c.record : -1)))].sort((a, b) => b - a);
    const hasText = (record) => turnCommentary.some((c) => (Number.isFinite(c.record) ? c.record : -1) === record
      && String(c.text ?? '').trim() !== '');
    const lastRecord = records.find(hasText) ?? records[0] ?? -1;
    const ofLast = lastRecord >= 0
      ? turnCommentary.filter((c) => c.record === lastRecord).sort((a, b) => (a.block ?? 0) - (b.block ?? 0))
      : turnCommentary;                                   // compact ledger: no record ids, use the turn
    const rebuilt = normalise(ofLast.map((c) => String(c.text ?? '')).join('\n').trim());
    const capped = rebuilt.length > 8000 ? `${rebuilt.slice(0, 6000)}\n${ELISION}\n${rebuilt.slice(-2000)}` : rebuilt;
    // An older slicer cut at 6000/2000 of the text BEFORE redaction, while `rebuilt` is the
    // redaction of the whole record — so the exact cap only matches when redaction changed
    // nothing inside the head. A capped saying that lost characters of its head to a scrubbed
    // line would otherwise be emitted as a duplicate of a block that already carried it.
    // The redaction-proof form of the same structural question — is this string that slicer's
    // cap of THIS record? — is the shape a cap has: an initial segment of the rebuild, the
    // synthetic marker, a terminal segment, and a non-empty elided middle between them. Whole
    // spans, compared once; never a line, a prefix of a line, or a coverage count.
    const isCapOf = (text, whole) => {
      const cut = text.indexOf(`\n${ELISION}\n`);
      if (cut <= 0 || whole.length <= text.length) return false;
      const head = text.slice(0, cut);
      const tail = text.slice(cut + ELISION.length + 2);
      return tail.length > 0 && head.length + tail.length < whole.length
        && whole.startsWith(head) && whole.endsWith(tail);
    };
    // M33 F repair 3. The same structural question for redaction's bound: the lines before Sonah's marker are an
    // initial segment of the rebuild, the lines after it a terminal one, and something between them was elided. A
    // side the bound left empty (no line break within it) proves nothing about the rebuild, so a statement cut to
    // nothing but its marker is its record's only when that record was long enough to be cut.
    const isBoundOf = (text, whole) => {
      const lines = text.split('\n');
      const at = lines.indexOf(STATEMENT_OMISSION_LINE);
      if (at < 0 || lines.lastIndexOf(STATEMENT_OMISSION_LINE) !== at) return false;
      const head = lines.slice(0, at).join('\n');
      const tail = lines.slice(at + 1).join('\n');
      return (head !== '' || tail !== '' || [...whole].length > STATEMENT_CAP_CHARS)
        && head.length + tail.length < whole.length && whole.startsWith(head) && whole.endsWith(tail);
    };

    const sayingsFrom = events.length;
    sayings.forEach((say, index) => {
      const text = normalise(String(say.text ?? '').trim());
      if (ofLast.length && (text === rebuilt || text === capped || isCapOf(text, rebuilt)
        || isBoundOf(text, rebuilt))) {
        ofLast[ofLast.length - 1].event.phase = 'final';
        return;
      }
      // An independent closing statement (compact ledgers). Emit it — but never the synthetic
      // elision marker, and never a span that crosses it (audit H29): head and tail are two events.
      const id = ids.of(say) ?? (sayings.length > 1 ? `F${turn}-${index}` : `F${turn}`);
      const raw = String(say.text ?? '');
      // M33 F repair 3: redaction's bound of the statement it scrubbed whole. One event whose
      // marker is never inside a quotable span, emitted only when some text of it survived; the
      // cut is declared either way.
      if (raw.split('\n').includes(STATEMENT_OMISSION_LINE)) {
        if (raw.replace(STATEMENT_OMISSION, '').trim() !== '')
          events.push({ id, kind: 'commentary', sequence: sequence++, phase: 'final', beforeInvocation: null, text: putStatement(raw, redactorField(say)) });
        clippedSayings++;
        return;
      }
      const cut = raw.indexOf(`\n${ELISION}\n`);
      if (cut === -1) {
        events.push({ id, kind: 'commentary', sequence: sequence++, phase: 'final', beforeInvocation: null, text: putProse(raw, redactorField(say)) });
      } else {
        events.push({ id: ids.sub(id, 'head'), kind: 'commentary', sequence: sequence++, phase: 'final', beforeInvocation: null, text: putProse(raw.slice(0, cut), redactorField(say)) });
        events.push({ id: ids.sub(id, 'tail'), kind: 'commentary', sequence: sequence++, phase: 'final', beforeInvocation: null, text: putProse(raw.slice(cut + ELISION.length + 2), redactorField(say)) });
        clippedSayings++;
      }
    });

    // M33 P: a closing statement ends its turn: recorded after everything of the turn a parent could cut at.
    for (let at = sayingsFrom; at < events.length; at++) if (!factOf.has(events[at])) factOf.set(events[at], { turn, end: true });
    // The rest end the turn: after its hand-offs and its closing statement (the turn's last
    // assistant text, recorded before the abort that ended the turn), before any compaction,
    // which this bridge can place only after the whole turn.
    while (lastSlotInterrupts.length) emitInterrupt(lastSlotInterrupts.shift());

    for (const mark of compactions.filter((m) => m.turn === turn)) {
      events.push({ id: mark.eventId ?? `B${turn}-${mark.index}`, kind: 'boundary', sequence: sequence++,
        boundary: 'compaction', relatedSession: null, ...compactedFactsOf(mark) });
      factOf.set(events[events.length - 1], { turn, end: true });
      boundaryN++;
    }
    // C-02 `turn` (M33 self-corrected claims): every event this turn emitted records the slicer's
    // own human-turn index it was emitted under — the recorded identity, never inferred from an id,
    // an order or a time. A transferred child event keeps its own child's turn (`renameChildEvent`).
    for (let i = turnStart; i < events.length; i++)
      if (!Object.hasOwn(events[i], 'turn')) events[i].turn = turnIdentity(turn);
    // Every id of the turn is assigned; now each hand-off block moves to its row in parent order.
    // The turn keeps its length, so no later turn's id or sequence moves.
    placeHandOffs(turnStart, handOffs);
  }

  // D71 (g), owner decision 2026-10-08: the project's own instruction files the harness gave the agent (the slicer's
  // `projectInstructions`, scrubbed before slice_hash), kept BESIDE the events (session.js `projectInstructions`), never
  // among them: no event's id, sequence or order moves. Each is placed by the rule an in-turn row is cut by
  // (`segmentStartsOf`: the longest prefix of events proven recorded before its row), `afterSequence` the sequence of
  // the last of them (-1 before any). An entry out of shape, or with no text left after redaction, is not read.
  const projectRows = (Array.isArray(ledger.projectInstructions) ? ledger.projectInstructions : []).filter((entry) =>
    entry !== null && typeof entry === 'object' && typeof entry.path === 'string' && entry.path
    && typeof entry.text === 'string' && entry.text.trim()
    && [entry.turn, entry.beforeEvent, entry.source].every((n) => Number.isSafeInteger(n) && n >= 0)
    && Number.isSafeInteger(entry.record) && entry.record >= 1);
  const projectStarts = segmentStartsOf({ [PLACEMENT_FACTS]: events.map((event) => factOf.get(event) ?? null) },
    projectRows.map(({ turn, beforeEvent, source, record }) => ({ turn, beforeEvent, source, record })));
  const projectInstructions = projectRows.map((entry, k) => ({ id: ids.of(entry) ?? `P${entry.turn}-${k}`,
    kind: 'project-instructions', afterSequence: projectStarts[k] > 0 ? events[projectStarts[k] - 1].sequence : -1,
    childId: null, path: spellField(entry.path), text: putProse(entry.text, redactorField(entry)),
    ...(entry.redacted ? { redacted: true } : {}) }));
  const session = new Session({ sessionKey, adapter, events, blobs, children, projectInstructions });
  // The second release review (low): the working directory the recording states (the slicer's `cwd`, whose prefix it
  // strips from the paths it spells), non-enumerable like the facts below, so no reader of the session's own fields
  // changes. Read only to compare a project instruction file's path with a change's (ledger.js `fileKey`).
  Object.defineProperty(session, 'workingDirectory', {
    value: typeof ledger.cwd === 'string' && ledger.cwd ? ledger.cwd : null });
  // M33 P: two facts no caller sees (non-enumerable): the working commentary's ids in emission order (what the launch
  // layout is read for), and where each event was recorded (what a parent cuts this session's history by).
  Object.defineProperty(session, COMMENTARY_IDS, { value: Object.freeze([...commentaryIds]) });
  Object.defineProperty(session, PLACEMENT_FACTS, { value: Object.freeze(events.map((event) => factOf.get(event) ?? null)) });
  // C-01 event identity: how each of this session's own events was named (a transferred child's are its own session's).
  const idCounts = { events: 0, derived: 0, gaps: {} };
  for (const event of events) {
    if (event.childId != null) continue;
    idCounts.events++;
    const gap = ids.gapOf(event.id);
    if (gap === null) idCounts.derived++;
    else idCounts.gaps[gap] = (idCounts.gaps[gap] ?? 0) + 1;
  }
  Object.defineProperty(session, EVENT_ID_COUNTS, { value: Object.freeze({ ...idCounts, gaps: Object.freeze(
    Object.fromEntries(Object.values(EVENT_ID_GAPS).filter((gap) => idCounts.gaps[gap] > 0)
      .map((gap) => [gap, idCounts.gaps[gap]]))) }) });
  if (launchLayout) return session;
  session.adapterGaps = adapterGaps(ledger, clippedSayings, { elidedAsks, cappedAsks, strippedAsks, elidedIds, cappedIds,
    strippedIds, queuedRead, unplacedHeard, labelGapIds: Object.fromEntries(LEDGER_POSITIONED_GAPS.map((gap) =>
      [gap, labelGapAnchors(ledger, session, gap)])), resumedSends }, delegationEventIds,
    [...transferred.values()], unrecordedWrites(events), withheldAsks, events, ids);
  // D150: the rows left unread, by kind, non-enumerable like the facts above (no reader of the session's
  // own fields changes); the coverage facts name them by kind.
  Object.defineProperty(session, 'unreadRows', { value: unreadRowsOf(ledger, unplacedHeard, [...transferred.values()]) });
  // C-03 M33 P: every helper segment whose receipt is not proven is declared once per closed note — none recorded
  // (`unreceived`), or a queued assignment's shared report (`shared`, M33 P repair) — counted by segment, naming each
  // such segment's delivery and its helper's spawn; and every send that split nothing, by its closed reason, naming the
  // sends (a loss this adapter cannot read is still declared, uncounted by event).
  // M33 P second repair: an `ambiguous` piece under its own note; a Claude helper's work after its own later request is
  // declared once by its hand-off's recorded loss (`helper_continued_unproven`), not here.
  const unprovenPieces = [...piecesOf.values()].flat().filter((piece) => !piece.receipt && piece.request === null);
  // D99 (F1 guard): a hand-off whose end the slicer could not read is declared as that, by its own recorded loss
  // (`helper_end_unread`), and never as a helper whose parent recorded no receipt of its result.
  const endUnread = new Set((Array.isArray(ledger.helperDeliveryLosses) ? ledger.helperDeliveryLosses : [])
    .filter((loss) => HELPER_END_UNREAD.includes(loss?.reason) && countOf(loss.delivery?.delegation))
    .map((loss) => loss.delivery.delegation));
  for (const [note, pieces] of [[HELPER_PLACEMENT_NOTES.unreceived,
    unprovenPieces.filter((piece) => !piece.shared && !piece.ambiguous && !endUnread.has(piece.delivery?.delegation))],
  [HELPER_PLACEMENT_NOTES.shared, unprovenPieces.filter((piece) => piece.shared)],
  [HELPER_PLACEMENT_NOTES.ambiguous, unprovenPieces.filter((piece) => piece.ambiguous)]])
    if (pieces.length) session.adapterGaps.push({ code: 'incomplete_inventory', channel: 'children', scope: 'session',
      count: pieces.length, eventIds: [...new Set(pieces.flatMap((piece) => [piece.deliveryId, piece.spawnId]))], note });
  session.adapterGaps.push(...helperDeliveryGaps(ledger, delegationEventIds, ids));
  for (const link of children) {
    if (link.relation !== 'followup' || link.state !== 'verified'
      || link.assignmentEffectProven === true) continue;
    const note = 'the follow-up target was linked, but delivery and later child work were not causally established';
    if (session.adapterGaps.some((gap) => gap.code === 'incomplete_inventory'
      && gap.channel === 'children' && gap.scope === 'session'
      && gap.eventIds?.length === 1 && gap.eventIds[0] === link.assignmentEvent
      && gap.note === note)) continue;
    session.adapterGaps.push({ code: 'incomplete_inventory', channel: 'children', scope: 'session',
      count: 1, eventIds: [link.assignmentEvent],
      note });
  }
  if (adapter === 'unknown') session.adapterGaps.push({ code: 'incomplete_inventory',
    channel: 'identity', scope: 'session', count: ledger.sources.length,
    note: 'recording sources did not establish one supported adapter' });
  // M33 brittleness L3: a recorder whose schema HUMAN_INTERACTION_TOOLS does not name leaves every action's
  // `asksHuman`/`humanChoice` unset — unknown, never false. Declared, counted by this session's own actions and
  // unlocated, so no history is certified on their absence (no decision is `unasked`, no forbidden edit is asked).
  const ownActions = events.filter((event) => event.kind === 'invocation' && event.childId == null).length;
  if (!Object.hasOwn(HUMAN_INTERACTION_TOOLS, adapter) && ownActions > 0) session.adapterGaps.push({
    code: 'incomplete_inventory', channel: 'instructions', scope: 'session', count: ownActions,
    note: HUMAN_INTERACTION_UNKNOWN_NOTE });
  // D126 (N0): a session that opens on a compaction: how many earlier recordings were read with it, and why its
  // earliest part was not read, when it was not (`session.continued`, `{ earlier, unread }`; absent for any other
  // session). The part not read holds messages of the person's that no event of this session holds: one part, declared
  // on the instructions channel by its reason's own note, located at no event.
  const continued = continuedOf(ledger);
  if (continued) {
    session.continued = continued;
    if (continued.unread !== null) session.adapterGaps.push({ code: 'incomplete_inventory', channel: 'instructions',
      scope: 'session', count: 1, note: INSTRUCTION_GAP_NOTES[continued.unread] });
  }
  // Declared on the session as well, so a reader of the canonical model alone can see that the
  // instruction history it is looking at is not the whole one — whether the recorder shortened an
  // ask or redaction withheld one (W3e-4 / F204), or (D126) Sonah did not read the part before a compaction.
  session.instructionScopeIncomplete = elidedAsks > 0 || cappedAsks > 0 || strippedAsks > 0 || withheldAsks.length > 0
    || continued?.unread != null;
  // W3e-6 / F213: how many NULs this session's stored text spells as NUL_SYMBOL, a transferred
  // child's included. A count, never a gap: nothing is missing.
  session.controlCharsReplaced = controlCharsReplaced;
  const recordedCompactions = (ledger.marks ?? []).filter((mark) => mark?.kind === 'compaction').length;
  const lastRecordedTurn = recordedTurns.reduce((last, turn) => Number.isSafeInteger(turn)
    ? Math.max(last, turn) : last, 0);
  session.adapterSegmentation = {
    version: LEDGER_BOUNDARY_VERSION,
    compactionMarks: recordedCompactions,
    emittedCompactions: boundaryN,
    unlocatedCompactions: recordedCompactions - boundaryN,
    outOfRangeCompactions: compactions.filter((mark) => mark.turn > lastRecordedTurn).length,
    position: 'after-turn',
    positionPrecision: 'turn',
  };
  if (recordedCompactions !== boundaryN) {
    session.adapterGaps.push({ code: 'unsupported_message', channel: 'observations', scope: 'session',
      count: recordedCompactions - boundaryN, note: 'compaction marks without a valid turn cannot be located' });
  }
  // C-02 M33 (4): until its boundary is emitted, a typed interrupt row keeps its loss.
  if (typedInterrupts.length !== interruptN) {
    session.adapterGaps.push({ code: 'unsupported_message', channel: 'observations', scope: 'session',
      count: typedInterrupts.length - interruptN,
      note: 'typed interrupt marks without a valid turn or row position cannot be located' });
  }
  // C-03: the owner and source-local identity of every adapter loss travel with copied/reloaded
  // reports. Child losses already carry their child's key and ordinal from recursive adaptation;
  // assign ordinals only to this source's eventless losses, in their stable production order.
  let lossOrdinal = 0;
  for (const gap of session.adapterGaps) {
    if (typeof gap.sessionKey !== 'string' || !gap.sessionKey) gap.sessionKey = sessionKey;
    if (gap.sessionKey !== sessionKey || Array.isArray(gap.eventIds) && gap.eventIds.length) continue;
    if (Number.isSafeInteger(gap.lossOrdinal) && gap.lossOrdinal >= 0)
      lossOrdinal = Math.max(lossOrdinal, gap.lossOrdinal + 1);
    else gap.lossOrdinal = lossOrdinal++;
  }
  return session;
}

/**
 * F96. Every write whose body this session's record does not contain, read off the per-change
 * extent the changes already declare (`recorded: false` — a shell write, a write the recorder kept
 * no text for). Counted over the FINAL event list, so a transferred child's writes are counted
 * under the ids they carry here. A delete is not one: it writes no body, and the file's absence
 * is its whole after-state, so nothing is missing from the record.
 *
 * W3c-10: each write is also listed — its event id, its path and whether the recorder placed it
 * outside the repository — because whether it caps session coverage depends on what covered it,
 * and that is decided where the PR and the code review's placement are known (ledger.js
 * `unrecordedCover`), never here.
 *
 * D98 (F9): only a write that could have changed its file (session.js `effectOf`: landed or unknown). One the recorder
 * typed as refused before it ran, or that failed or was cancelled, did no work, so the record lacks nothing of it.
 */
function unrecordedWrites(events) {
  let count = 0, shell = 0;
  const eventIds = [], writes = [];
  const effect = effectReader({ events });
  for (const event of events) {
    if (event.kind !== 'invocation' || event.operation === 'delete') continue;
    if (!CHANGING_EFFECTS.includes(effect(event))) continue;
    const missing = (event.changes ?? []).filter((c) => c?.extent?.recorded === false);
    if (!missing.length) continue;
    count += missing.length;
    if (event.shellWriteOf) shell += missing.length;
    eventIds.push(event.id);
    for (const change of missing)
      writes.push({ eventId: event.id, path: change.path ?? null, outsideRepository: change.outsideRepository === true });
  }
  return { count, shell, eventIds, writes };
}

/** An invocation is evidence of an attempt, never proof that a status-bearing action finished.
 * Only a structurally proved single direct shell write may inherit a typed zero exit.
 * The observation index is built from the final transferred event list, so linked children obey
 * the same rule. A duplicate terminal row is ambiguous even if its labels happen to agree.
 * D98 (F9): a write's outcome is unknown exactly when its effect is (session.js `effectOf`, the one rule every reader
 * reads): one refused before it ran (its own call or the command it was parsed from) changed nothing and says so, so
 * it is no unknown write. A command refused before it ran is never an unknown command, by construction: its effect is
 * `none` only once a result of it is recorded, and the slicer types a refused call's result by the call's own error
 * flag, so that one terminal row has a proven status. test/d98-effect-rule.test.js checks it on every fixture
 * session. */
function unknownActionOutcomes(events) {
  const terminals = new Map();
  for (const event of events) {
    if (event.kind !== 'observation' || event.phase !== 'terminal'
      || typeof event.invocation !== 'string') continue;
    const prior = terminals.get(event.invocation) ?? [];
    prior.push(event);
    terminals.set(event.invocation, prior);
  }
  const effect = effectReader({ events });
  // A command can have a typed exit while its semantic test label was parsed from output;
  // sourceOfResult names the latter.
  const known = (id) => {
    const rows = terminals.get(id) ?? [];
    return rows.length === 1 && rows[0].terminalStatusProven === true;
  };
  const writes = events.filter((event) => event.kind === 'invocation'
    && ['write', 'edit', 'delete'].includes(event.operation)
    && effect(event) === UNKNOWN_EFFECT).map((event) => event.id);
  const unknownCommands = events.filter((event) => event.kind === 'invocation'
    && event.operation === 'command'
    && !known(event.id));
  // D99 (F1 guard): a background run whose end the slicer could not read is that loss, named apart; review of A1b: by
  // whether a later record mentions it (`unread`) or Sonah could not check for its end (`unchecked`).
  const marked = (end) => (event) => event.backgroundEnd === end;
  const { unread, unchecked } = LEDGER_BACKGROUND_ENDS;
  return { writes, commands: unknownCommands.filter((event) => !marked(unread)(event) && !marked(unchecked)(event))
    .map((event) => event.id), unread: unknownCommands.filter(marked(unread)).map((event) => event.id),
  unchecked: unknownCommands.filter(marked(unchecked)).map((event) => event.id) };
}
/** D98 (F9): the effect (session.js ACTION_EFFECTS) the write gap reads. */
const [, , , UNKNOWN_EFFECT] = ACTION_EFFECTS;

/** C-03 M33 D: did this Workflow action launch? A recorded own result that is not an error or failure, not
 *  interrupted, conflicting, retracted or recorder-withheld (`outcomeUnknown`). The slicer states the same rule
 *  (slicer workflow-runs.js `workflowLaunched`; asserted to agree in the tests): this package never imports it. */
const workflowLaunched = (act) => (act.result?.seen === true || act.workflowAsyncUnresolved === true)
  && act.isError !== true && act.observationMissing !== true && act.interrupted !== true
  && act.conflict !== true && act.outcomeUnknown !== true && act.result?.outcome !== 'failed';

/**
 * C-03 M33 W: the ledger's valid Workflow run records, by the call's `turn:seq`. A record is valid only when it is
 * exactly `{turn, seq, linked, losses?, resumes?}` with safe nonnegative integers, `losses` (when present) a nonempty
 * object of closed notes with positive safe counts, it names a Workflow action of this ledger once, its `linked` count
 * equals the linked `workflow-agent` hand-offs of that call, and it accounts for something (a linked agent or a loss).
 * M33 W repair 2: `resumes` (when present) is a nonempty list of exactly `{turn, seq}`, each naming another launched
 * Workflow action of this ledger, and no call is named twice across all records (as a run's own call or a resume).
 * M33 W2: `receipt` (when present) is exactly `{turn, beforeEvent, source, record}` (safe nonnegative integers, `record`
 * at least 1) naming a row recorded after the LAST call of the run's chain (the run's own call and its resumes, the
 * last by (turn, seq)): its turn is not earlier than that call's, and `beforeEvent` — the slicer's count of the
 * ledger's actions recorded before the row — lies within its turn's own actions and past that call's position.
 * Anything else is not a record: its call, and every call it names as a resume, keeps its M33 D declaration. Returns
 * `{ runs: Map<turn:seq, {linked, losses, resumes, receipt}>, resumeOf: Map<turn:seq of a resume, turn:seq of its run's
 * call> }`, `receipt` null when none is recorded.
 */
function workflowRunRecords(ledger) {
  const out = new Map();
  const resumeOf = new Map();
  const runs = Array.isArray(ledger?.workflowRuns) ? ledger.workflowRuns : [];
  const count = (n, least) => Number.isSafeInteger(n) && n >= least;
  const losses = new Set(WORKFLOW_RUN_GAPS.map(([key]) => key));
  const object = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
  const workflowAct = (turn, seq) => (ledger.ledger ?? []).find((act) => act?.tool === 'Workflow'
    && act.turn === turn && act.seq === seq);
  // M33 W2: a receipt, checked against the ledger's own recorded order of actions: the slicer counts them in (turn,
  // seq) order, as the placement of commentary among them does (`slotFor`). `chain`: the run's own call and resumes.
  const acts = Array.isArray(ledger?.ledger) ? ledger.ledger : [];
  const runReceiptOf = (value, chain) => {
    if (!object(value) || Object.keys(value).length !== 4
      || !['turn', 'beforeEvent', 'source', 'record'].every((field) => Object.hasOwn(value, field))
      || !count(value.turn, 0) || !count(value.beforeEvent, 0) || !count(value.source, 0) || !count(value.record, 1)) return null;
    const last = chain.reduce((a, b) => (b.turn > a.turn || b.turn === a.turn && b.seq > a.seq ? b : a));
    const from = acts.filter((act) => act?.turn < value.turn).length;
    const until = from + acts.filter((act) => act?.turn === value.turn).length;
    const lastAt = acts.filter((act) => act?.turn < last.turn || act?.turn === last.turn && act.seq < last.seq).length;
    if (value.turn < last.turn || value.beforeEvent < from || value.beforeEvent > until || value.beforeEvent <= lastAt) return null;
    return { turn: value.turn, beforeEvent: value.beforeEvent, source: value.source, record: value.record };
  };
  // Every call any record names, as its own call or as a resume: a call named twice is no record's.
  const seen = new Map();
  const named = (run) => [run, ...(Array.isArray(run.resumes) ? run.resumes : [])].filter(object)
    .map((entry) => `${entry.turn}:${entry.seq}`);
  for (const run of runs) if (object(run)) for (const key of named(run)) seen.set(key, (seen.get(key) ?? 0) + 1);
  for (const run of runs) {
    if (!object(run)) continue;
    if (Object.keys(run).some((field) => !['turn', 'seq', 'linked', 'losses', 'resumes', 'receipt', 'earlierReceipts']
      .includes(field))) continue;
    if (!count(run.turn, 0) || !count(run.seq, 0) || !count(run.linked, 0)) continue;
    const lost = run.losses === undefined ? {} : run.losses;
    if (lost === null || typeof lost !== 'object' || Array.isArray(lost)
      || (run.losses !== undefined && Object.keys(lost).length === 0)
      || Object.entries(lost).some(([note, n]) => !losses.has(note) || !count(n, 1))) continue;
    const resumes = run.resumes === undefined ? [] : run.resumes;
    if (!Array.isArray(resumes) || (run.resumes !== undefined && resumes.length === 0)
      || resumes.some((resume) => !object(resume) || Object.keys(resume).length !== 2 || !count(resume.turn, 0)
        || !count(resume.seq, 0) || !workflowAct(resume.turn, resume.seq)
        || !workflowLaunched(workflowAct(resume.turn, resume.seq)))) continue;
    const key = `${run.turn}:${run.seq}`;
    if (named(run).some((name) => seen.get(name) !== 1) || !workflowAct(run.turn, run.seq)) continue;
    const agents = (ledger.delegations ?? []).filter((d) => workflowAgentOf(d, run));
    if (agents.length !== run.linked || (run.linked === 0 && Object.keys(lost).length === 0)
      || agents.some((d) => d.reportLoss !== undefined && !WORKFLOW_REPORT_LOSSES.includes(d.reportLoss))
      || WORKFLOW_REPORT_LOSSES.some((note) => (lost[note] ?? 0) !== agents.filter((d) => d.reportLoss === note).length))
      continue;
    const receipt = Object.hasOwn(run, 'receipt') ? runReceiptOf(run.receipt, [run, ...resumes]) : null;
    if (Object.hasOwn(run, 'receipt') && receipt === null) continue;
    // M33 P (W2 recheck minor): how many earlier calls of a resumed run's chain recorded a receipt of their own — a
    // positive count no greater than its resumes, and only beside the receipt of its last call.
    if (Object.hasOwn(run, 'earlierReceipts') && (receipt === null || !count(run.earlierReceipts, 1)
      || run.earlierReceipts > resumes.length)) continue;
    const resumeKeys = resumes.map((resume) => `${resume.turn}:${resume.seq}`);
    out.set(key, { linked: run.linked, losses: Object.fromEntries(WORKFLOW_RUN_GAPS.map(([note]) => [note, lost[note] ?? 0])),
      resumes: resumeKeys, receipt, earlierReceipts: Object.hasOwn(run, 'earlierReceipts') ? run.earlierReceipts : 0 });
    for (const resume of resumeKeys) resumeOf.set(resume, key);
  }
  return { runs: out, resumeOf };
}

/** Losses this adapter knows it is taking, so coverage can state them instead of implying none. */
/**
 * C-03 M33 P. The ledger's valid helper segment records (`helperSegments`, written by the loader from the exact delivery
 * and receipt joins), by child source: Map<child source, segment[]>, each segment `{ delivery, deliveryId,
 * deliveryTurn, deliveryRow, deliveryPos, delegation, arrival, receipt, shared, next, spawn, spawnId, unit, childId }`.
 * A record is valid only when it is exactly `{child, segments}`; `child` names one unit of `ledger.children` with a
 * ledger and no other record names it; its FIRST segment is delivered by the one linked hand-off of that child that is
 * not a follow-up (`{delegation: index}`), whose child identity is known; every LATER one (but a Claude helper's, below)
 * by a linked follow-up of that same child or a recorded Codex send_message action (`{action: {turn, seq}}`, its row
 * recorded), and carries an `arrival`; the arrivals (the first segment's when present, then every later one's) rows
 * strictly after one another;
 * no delivery named twice; and each `receipt` (when present) a row recorded after its delivery's row, in a turn not
 * before the delivery's, its count of earlier actions within that turn's own and past a send action's own position.
 * M33 P repair: a LATER segment may instead record `shared` (exactly the report the segment before it was placed at:
 * its `receipt`, its `next`, or its own `shared` when it had no `next`) and optionally `next` (a later report), each such
 * a row; never with a `receipt`. Placements follow one another: a receipt or a `next` strictly after the report the
 * segment before was placed at, and none at all after a segment that found no report. M33 P second repair: a Codex
 * helper's segment may instead record `ambiguous: true` (no report tied to it: never beside a `receipt`, `shared` or
 * `next`, and every segment after one is ambiguous too). A Claude helper's record holds after its first segment D175's
 * resume segments, each exactly `{delivery: {action: {turn, seq}}, request, receipt}` and no `arrival`: the action one
 * recorded Claude SendMessage (`CLAUDE_SEND_NAMES`, its row recorded) named by no other segment of any record; `request`
 * a turn its own recording records after an earlier one, and after the request of the segment before; `receipt` a row
 * recorded after that action, past its own position, strictly after the report the segment before was placed at (so
 * none after a first segment with no receipt). It may then end with exactly `{delivery: {request: <turn>}}` (M33 P
 * second repair) — the helper's own later request, at a later turn than any resume segment's — with nothing else.
 * Anything else is not a record: that helper keeps the placement it had before M33 P (its whole history behind its
 * spawn).
 */
function helperSegmentRecords(ledger, ids = ledgerEventIds(ledger)) {
  const out = new Map();
  const object = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
  const exactly = (value, keys) => object(value) && Object.keys(value).length === keys.length
    && keys.every((key) => Object.hasOwn(value, key));
  const records = Array.isArray(ledger?.helperSegments) ? ledger.helperSegments : [];
  const delegations = Array.isArray(ledger?.delegations) ? ledger.delegations : [];
  const units = Array.isArray(ledger?.children) ? ledger.children : [];
  const acts = (Array.isArray(ledger?.ledger) ? ledger.ledger : [])
    .filter((act) => countOf(act?.turn) && countOf(act?.seq));
  const position = (turn, seq) => acts.filter((act) => act.turn < turn || act.turn === turn && act.seq < seq).length;
  const named = new Map();
  for (const record of records)
    if (object(record) && countOf(record.child)) named.set(record.child, (named.get(record.child) ?? 0) + 1);
  const delivered = new Set();
  for (const record of records) {
    if (!exactly(record, ['child', 'segments']) || !countOf(record.child) || named.get(record.child) !== 1
      || !Array.isArray(record.segments) || !record.segments.length) continue;
    const unit = units.find((candidate) => candidate?.source === record.child);
    if (!object(unit?.ledger)) continue;
    const spawns = delegations.map((d, index) => ({ d, index })).filter(({ d }) => d?.status === 'linked'
      && d.kind !== 'followup' && d.kind !== WORKFLOW_AGENT_KIND && d.link?.source === record.child);
    if (spawns.length !== 1) continue;
    const [{ d: spawn, index: spawnIndex }] = spawns;
    const childId = spawn.childId ?? tupleChildId(ledger, spawn);
    if (!childId || !countOf(spawn.turn) || !countOf(spawn.source) || !countOf(spawn.record, 1)) continue;
    const spawnId = ids.delegation(spawn, spawnIndex);
    const segments = [];
    let last = null;
    let valid = true;
    let placedAt;                  // the report the segment before was placed at (null: it found none)
    let ambiguousFrom = false;     // M33 P second repair: once a segment is `ambiguous`, every later one is
    let requested = false;         // M33 P second repair: a Claude helper's later request ends its record
    let resumed = 0;               // D175: the Claude resume segments so far (after the first segment)
    let lastRequest = null;        // D175: the helper's own turn the segment before was delivered at
    const resumedActs = new Set(); // D175: the resuming actions this record names
    const childTurns = ['instructions', 'ask', 'ledger', 'sayings', 'commentary', 'marks']
      .flatMap((field) => (Array.isArray(unit.ledger?.[field]) ? unit.ledger[field] : [])).map((item) => item?.turn)
      .filter((turn) => countOf(turn));
    // A helper's own later turn: recorded by its recording, after one before it, after the one the segment before took.
    const laterTurn = (request) => countOf(request, 1) && childTurns.includes(request)
      && childTurns.some((turn) => turn < request) && (lastRequest === null || request > lastRequest);
    // A report row recorded after `delivery` (its row, its turn, its count of earlier actions), or null.
    const reportAt = (value, delivery) => {
      const at = receiptRow(value);
      const from = at ? acts.filter((act) => act.turn < at.turn).length : 0;
      const until = at ? from + acts.filter((act) => act.turn === at.turn).length : 0;
      return !at || at.turn < delivery.deliveryTurn || !rowAfterRow(at, delivery.deliveryRow)
        || at.beforeEvent < from || at.beforeEvent > until
        || (delivery.deliveryPos !== null && at.beforeEvent <= delivery.deliveryPos) ? null : at;
    };
    for (const [k, segment] of record.segments.entries()) {
      // D175: a Claude helper's later request that a typed resume delivered — exactly `{delivery: {action: {turn, seq}},
      // request, receipt}`, after its first segment and the resume segments before it: the action one recorded
      // SendMessage of this ledger (`CLAUDE_SEND_NAMES`, its row recorded) named by no other segment, `request` a later
      // turn of the helper's own recording than the one before it, `receipt` a row recorded after that action and
      // strictly after the report the segment before was placed at (so none after a first segment with no receipt, or
      // after the bare `{delivery: {request}}`, which is placed at none). Anything else is no record.
      if (k > 0 && spawn.adapter === 'claude' && object(segment) && Object.hasOwn(segment, 'request')) {
        const action = exactly(segment, ['delivery', 'request', 'receipt']) && exactly(segment.delivery, ['action'])
          && exactly(segment.delivery.action, ['turn', 'seq']) && countOf(segment.delivery.action.turn)
          && countOf(segment.delivery.action.seq) ? segment.delivery.action : null;
        const found = action ? acts.filter((act) => act.turn === action.turn && act.seq === action.seq) : [];
        const locator = found.length === 1 ? sourceLocatorOf(found[0]) : null;
        const key = action ? `a:${action.turn}:${action.seq}` : null;
        if (!locator || !CLAUDE_SEND_NAMES.includes(found[0].tool) || !laterTurn(segment.request)
          || delivered.has(key) || resumedActs.has(key)) { valid = false; break; }
        const { turn, seq } = action;
        const delivery = { deliveryId: ids.actAt(turn, seq), deliveryTurn: turn,
          deliveryRow: { source: locator.stream, record: locator.record }, deliveryPos: position(turn, seq) };
        const receipt = reportAt(segment.receipt, delivery);
        if (!receipt || !placedAt || !rowAfterRow(receipt, placedAt)) { valid = false; break; }
        segments.push({ delivery: { action: { turn, seq } }, ...delivery, delegation: null, arrival: null, receipt,
          shared: null, next: null, ambiguous: false, request: segment.request, spawn, spawnId, unit, childId });
        resumedActs.add(key);
        resumed++;
        lastRequest = segment.request;
        placedAt = receipt;
        continue;
      }
      if (!object(segment) || !Object.hasOwn(segment, 'delivery') || requested
        || Object.keys(segment).some((key) => !['delivery', 'arrival', 'receipt', 'shared', 'next', 'ambiguous'].includes(key))
        || Object.hasOwn(segment, 'receipt') && Object.hasOwn(segment, 'shared')
        || Object.hasOwn(segment, 'next') && !Object.hasOwn(segment, 'shared')
        || k === 0 && Object.hasOwn(segment, 'shared')
        // M33 P second repair: `ambiguous` is exactly true, beside no report, on a Codex helper's segment only, and
        // every segment after an ambiguous one is ambiguous too.
        || Object.hasOwn(segment, 'ambiguous') && (segment.ambiguous !== true || spawn.adapter !== 'codex'
          || ['receipt', 'shared', 'next'].some((key) => Object.hasOwn(segment, key)))
        || ambiguousFrom && segment.ambiguous !== true) { valid = false; break; }
      if (segment.ambiguous === true) ambiguousFrom = true;
      let delivery = null;
      if (k === 1 + resumed && spawn.adapter === 'claude' && exactly(segment.delivery, ['request'])) {
        // M33 P second repair: a Claude helper's own later request (a turn of its own recording after its first): the
        // rest of its history, received by no recorded receipt. Only that delivery key, after its one first segment
        // (D175: and the resume segments after it, at a later turn than theirs).
        const request = segment.delivery.request;
        if (!(Object.keys(segment).length === 1 && laterTurn(request))) { valid = false; break; }
        requested = true;
        segments.push({ delivery: { request }, deliveryId: spawnId, deliveryTurn: spawn.turn,
          deliveryRow: { source: spawn.source, record: spawn.record }, deliveryPos: null, delegation: null, request,
          arrival: null, receipt: null, shared: null, next: null, ambiguous: false, spawn, spawnId, unit, childId });
        placedAt = null;
        continue;
      }
      if (exactly(segment.delivery, ['delegation']) && countOf(segment.delivery.delegation)) {
        const index = segment.delivery.delegation;
        const d = delegations[index];
        const ok = k === 0 ? index === spawnIndex : index !== spawnIndex && d?.kind === 'followup'
          && d.status === 'linked' && d.link?.source === record.child;
        if (ok && countOf(d.turn) && countOf(d.source) && countOf(d.record, 1))
          delivery = { delivery: { delegation: index }, deliveryId: ids.delegation(d, index), deliveryTurn: d.turn,
            deliveryRow: { source: d.source, record: d.record }, deliveryPos: null, delegation: d, key: `d:${index}` };
      } else if (k > 0 && exactly(segment.delivery, ['action']) && exactly(segment.delivery.action, ['turn', 'seq'])
        && countOf(segment.delivery.action.turn) && countOf(segment.delivery.action.seq)) {
        const { turn, seq } = segment.delivery.action;
        const found = acts.filter((act) => act.turn === turn && act.seq === seq);
        const locator = found.length === 1 ? sourceLocatorOf(found[0]) : null;
        if (locator && CODEX_SEND_NAMES.includes(found[0].tool))
          delivery = { delivery: { action: { turn, seq } }, deliveryId: ids.actAt(turn, seq), deliveryTurn: turn,
            deliveryRow: { source: locator.stream, record: locator.record }, deliveryPos: position(turn, seq),
            delegation: null, key: `a:${turn}:${seq}` };
      }
      if (!delivery || delivered.has(delivery.key)) { valid = false; break; }
      const arrival = Object.hasOwn(segment, 'arrival') ? receiptRow(segment.arrival) : null;
      if ((Object.hasOwn(segment, 'arrival') && !arrival) || (k > 0 && !arrival)
        || (arrival && last && !rowAfterRow(arrival, last))) { valid = false; break; }
      if (arrival) last = arrival;
      // A report row recorded after this delivery (a receipt, a shared report or the next one), or null.
      const reportRow = (field) => reportAt(segment[field], delivery);
      const [receipt, shared, next] = ['receipt', 'shared', 'next'].map((field) => (Object.hasOwn(segment, field)
        ? reportRow(field) : null));
      if (['receipt', 'shared', 'next'].some((field, i) => Object.hasOwn(segment, field) && [receipt, shared, next][i] === null)
        || next && !rowAfterRow(next, shared)) { valid = false; break; }
      // M33 P repair: placements follow one another; one report receives at most one assignment.
      const report = receipt ?? next;
      if (k > 0 && (shared ? !placedAt || ['turn', 'beforeEvent', 'source', 'record'].some((f) => shared[f] !== placedAt[f])
        : report ? placedAt === null || placedAt && !rowAfterRow(report, placedAt) : false)) { valid = false; break; }
      placedAt = report ?? shared ?? null;
      const { key, ...fields } = delivery;
      segments.push({ ...fields, arrival, receipt, shared, next, ambiguous: segment.ambiguous === true, request: null,
        spawn, spawnId, unit, childId });
    }
    if (!valid) continue;
    for (const segment of segments) delivered.add(Object.hasOwn(segment.delivery, 'request') ? `r:${record.child}:${segment.request}`
      : segment.delegation ? `d:${segment.delivery.delegation}` : `a:${segment.delivery.action.turn}:${segment.delivery.action.seq}`);
    out.set(record.child, segments);
  }
  return out;
}

/**
 * C-03 M33 P. Whether an event with the recorded placement fact `fact` (`PLACEMENT_FACTS`) is proven recorded before the
 * row `arrival` (`{turn, beforeEvent, source, record}`): an earlier turn; the turn's own request; an action counted
 * before the row; commentary, an in-turn row, a typed interrupt, a hand-off or a received report on an earlier row.
 */
function recordedBeforeRow(fact, arrival) {
  if (fact.turn !== arrival.turn) return fact.turn < arrival.turn;
  if (fact.kind === 'instruction') return true;
  if (fact.end === true) return false;
  if (Number.isSafeInteger(fact.pos) && (fact.action === true || fact.pos !== arrival.beforeEvent))
    return fact.pos < arrival.beforeEvent;
  return Array.isArray(fact.row) && rowAfterRow(arrival, { source: fact.row[0], record: fact.row[1] });
}

/**
 * C-03 M33 P. Where each assignment's arrival cuts a transferred helper's history: for each arrival row (`{turn,
 * beforeEvent, source, record}`, in the helper's own recording), the index in the helper session's events of the first
 * event NOT proven recorded before it — the longest prefix of events each proven before it by the helper's own recorded
 * facts (`PLACEMENT_FACTS`: an earlier turn; the turn's own request; an action counted before the arrival; commentary,
 * a typed interrupt, a hand-off or a received report on an earlier row). A transferred grandchild's event follows the
 * hand-off that heads its block. Nothing is inferred from time or resemblance. M33 P second repair: a `{request: turn}`
 * cut (a Claude helper's own later request) starts at the first event of that turn of its own or later.
 */
function segmentStartsOf(session, arrivals) {
  const facts = Array.isArray(session?.[PLACEMENT_FACTS]) ? session[PLACEMENT_FACTS] : [];
  return arrivals.map((arrival) => {
    let start = 0;
    let before = true;
    for (let at = 0; at < facts.length; at++) {
      // M33 P second repair: a Claude helper's own later request cuts at its turn: every event of an earlier turn first.
      if (facts[at] !== null) before = Number.isSafeInteger(arrival?.request) ? facts[at].turn < arrival.request
        : recordedBeforeRow(facts[at], arrival);
      if (!before) break;
      start = at + 1;
    }
    return start;
  });
}


/**
 * M34 labels review (F2; C-02 "Slice-time labels", positional label gaps). Where the loss of each row whose label carries
 * the positioned gap `gap` is (`LEDGER_LABEL_GAP_MARK` marks of that gap, one per counted label, in ledger order): the id
 * of the first of this session's own events NOT proven recorded before that row (`segmentStartsOf`, by the facts a
 * helper's history is cut by at an arrival: `recordedBeforeRow`). Every bound at or after that event can reach the row
 * and none before it can. That holds only while every own event proven recorded before the row comes before the named
 * one: when one comes after it, the placed order is not the row's, and the whole answer is null. A row recorded after
 * every event reaches no bound but the last: it names the session's last own event. Null — the gap stays unlocated, a
 * loss at every bound — also when a mark is out of shape or this session has no own event to name. H2's
 * `openingFallbackAnchors`, read by the label gap's own marks.
 */
function labelGapAnchors(ledger, session, gap) {
  const marks = (Array.isArray(ledger?.marks) ? ledger.marks : [])
    .filter((mark) => mark?.kind === LEDGER_LABEL_GAP_MARK && mark.gap === gap);
  const atLeast = (value, least) => Number.isSafeInteger(value) && value >= least;
  if (!marks.every((mark) => atLeast(mark.turn, 0) && atLeast(mark.beforeEvent, 0) && atLeast(mark.stream, 0)
    && atLeast(mark.record, 1))) return null;
  const facts = Array.isArray(session?.[PLACEMENT_FACTS]) ? session[PLACEMENT_FACTS] : [];
  let last = facts.length - 1;
  while (last >= 0 && facts[last] === null) last--;
  if (last < 0) return marks.length ? null : [];
  const rows = marks.map((mark) => ({ turn: mark.turn, beforeEvent: mark.beforeEvent, source: mark.stream,
    record: mark.record }));
  const starts = segmentStartsOf(session, rows);
  const ordered = starts.every((start, k) => facts.every((fact, at) => at <= start || fact === null
    || !recordedBeforeRow(fact, rows[k])));
  return ordered ? starts.map((start) => session.events[start < facts.length ? start : last].id) : null;
}

/**
 * C-03 M33 P. The ledger's recorded delivery losses (`helperDeliveryLosses`: `{delivery, reason}` from the loader's
 * exact join), each counted under its closed reason's fixed note (`HELPER_DELIVERY_GAP_NOTES`, in that order), one
 * `children` `incomplete_inventory` gap per reason naming the sends' events. An entry this adapter cannot read is never
 * dropped: it is counted under `unreadable`, with no event named.
 */
function helperDeliveryGaps(ledger, delegationEventIds, ids = ledgerEventIds(ledger)) {
  const entries = Array.isArray(ledger?.helperDeliveryLosses) ? ledger.helperDeliveryLosses : [];
  if (!entries.length) return [];
  const object = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
  const acts = Array.isArray(ledger?.ledger) ? ledger.ledger : [];
  const reasons = Object.keys(HELPER_DELIVERY_GAP_NOTES).filter((reason) => reason !== 'unreadable');
  const byReason = new Map(reasons.map((reason) => [reason, { count: 0, ids: [] }]));
  let unreadable = 0;
  for (const entry of entries) {
    let id = null;
    const delivery = entry?.delivery;
    if (object(entry) && Object.keys(entry).length === 2 && reasons.includes(entry.reason) && object(delivery)
      && Object.keys(delivery).length === 1) {
      if (countOf(delivery.delegation)) id = delegationEventIds.get((ledger.delegations ?? [])[delivery.delegation]) ?? null;
      else if (object(delivery.action) && Object.keys(delivery.action).length === 2 && countOf(delivery.action.turn)
        && countOf(delivery.action.seq) && acts.some((act) => act?.turn === delivery.action.turn
          && act.seq === delivery.action.seq)) id = ids.actAt(delivery.action.turn, delivery.action.seq);
    }
    if (id === null) { unreadable++; continue; }
    const tally = byReason.get(entry.reason);
    tally.count++;
    if (!tally.ids.includes(id)) tally.ids.push(id);
  }
  const gaps = [];
  for (const [reason, { count, ids }] of byReason) if (count) gaps.push({ code: 'incomplete_inventory',
    channel: 'children', scope: 'session', count, eventIds: ids, note: HELPER_DELIVERY_GAP_NOTES[reason] });
  if (unreadable) gaps.push({ code: 'incomplete_inventory', channel: 'children', scope: 'session', count: unreadable,
    note: HELPER_DELIVERY_GAP_NOTES.unreadable });
  return gaps;
}

function adapterGaps(ledger, clippedSayings, { elidedAsks = 0, cappedAsks = 0, strippedAsks = 0, elidedIds = [], cappedIds = [],
  strippedIds = [], queuedRead = 0, unplacedHeard = 0, labelGapIds = {}, resumedSends = new Set() } = {},
  delegationEventIds = new Map(),
  transfers = [], unrecorded = { count: 0, shell: 0, eventIds: [], writes: [] }, withheldAsks = [], events = [],
  ids = ledgerEventIds(ledger)) {
  const gaps = [];
  // D90: a mark-shaped string is an earlier redactor's only where the record declares its work (`redactorDeclared`).
  const redactorField = redactorDeclared(ledger);
  const marked = (field, text) => redactorField(field) && hasRedactionToken(text);
  // M33 F: the typed communication loss is every closed inter-agent loss counter together; each must be a count.
  const communicationOnlyCapture = (capture) => {
    if (capture?.incomplete !== true || capture.interAgentMessagesSoleIncomplete !== true
      || capture.genericIncomplete === true) return false;
    const { total, counted } = communicationLoss(capture);
    return counted && total > 0;
  };
  const unknown = unknownActionOutcomes(events);
  if (unknown.writes.length) gaps.push({ code: 'write_outcome_unknown', channel: 'observations',
    scope: 'session', count: unknown.writes.length, eventIds: unknown.writes,
    note: 'the recording does not establish whether these attempted writes completed' });
  if (unknown.commands.length) gaps.push({ code: 'command_outcome_unknown', channel: 'observations',
    scope: 'session', count: unknown.commands.length, eventIds: unknown.commands,
    note: 'the recording does not establish whether these shell or test commands completed' });
  // D99 (F1 guard): the background runs whose end the slicer could not read, declared apart under their own note.
  if (unknown.unread.length) gaps.push({ code: 'command_outcome_unknown', channel: 'observations',
    scope: 'session', count: unknown.unread.length, eventIds: unknown.unread, note: END_UNREAD_NOTE });
  if (unknown.unchecked.length) gaps.push({ code: 'command_outcome_unknown', channel: 'observations',
    scope: 'session', count: unknown.unchecked.length, eventIds: unknown.unchecked, note: END_UNCHECKED_NOTE });
  // Delegated, unreviewed work is DECLARED as what it is. Relabelling it `incomplete_inventory`
  // (or dropping it) is how a session that handed its work to an uncaptured sub-agent rendered
  // CLEAN (audit B1/G6). A LINKED child is transferred instead, and declares its own losses
  // below — a child whose capture is partial is not a child nobody captured (B2).
  unlinkedDelegations(ledger).forEach((delegation) => {
    const [code, note] = unlinkedChildGap(delegation);
    gaps.push({
      code,
      channel: 'children', scope: 'session', count: 1,
      ...(delegationEventIds.has(delegation) ? { eventIds: [delegationEventIds.get(delegation)] } : {}),
      note,
      delegationUnresolved: true,
    });
  });
  const redactedBriefs = (ledger.delegations ?? []).filter((delegation) =>
    delegation?.parentInstruction && (declaresRedaction(delegation.parentInstruction)
      || marked(delegation.parentInstruction, delegation.parentInstruction.text)));
  if (redactedBriefs.length) gaps.push({ code: 'incomplete_inventory', channel: 'actions',
    scope: 'session', count: redactedBriefs.length,
    eventIds: redactedBriefs.map((delegation) => delegationEventIds.get(delegation)).filter(Boolean),
    note: DELEGATION_BRIEF_GAP_NOTES.redaction_withheld });
  // M33 T: a brief the recorder encrypted is missing evidence too, declared as what it is — never as a redaction.
  // Same code, channel and scope as the redacted brief above, so it caps session coverage at least as much.
  const encryptedBriefs = (ledger.delegations ?? []).filter(encryptedBrief);
  if (encryptedBriefs.length) gaps.push({ code: 'incomplete_inventory', channel: 'actions',
    scope: 'session', count: encryptedBriefs.length,
    eventIds: encryptedBriefs.map((delegation) => delegationEventIds.get(delegation)).filter(Boolean),
    note: DELEGATION_BRIEF_GAP_NOTES.recorder_encrypted });
  // A child gap is not automatically missing child capture. Its typed channel and scope travel
  // with the transferred evidence below; an outside-repository unrecorded body, for example,
  // does not cap either review. A native communication counter is already a children-channel
  // capture loss; suppress the broad duplicate only when the slicer proved it is the sole cause
  // and that exact typed gap is present on the child being transferred.
  for (const transfer of transfers) {
    const capture = transfer.ledger?.capture;
    if (capture?.incomplete !== true) continue;
    // M33 F: every closed communication loss the child counted must travel as its own typed gap, count and note.
    const communicationOnly = communicationOnlyCapture(capture)
      && INTER_AGENT_LOSS_GAPS.every(([key, note]) => !(capture[key] > 0)
        || transfer.session.adapterGaps.some((gap) => gap.code === 'incomplete_inventory'
          && gap.channel === 'children' && gap.scope === 'session'
          && gap.count === capture[key] && gap.note === note));
    if (communicationOnly) continue;
    gaps.push({ code: 'incomplete_inventory', channel: 'children', scope: 'session', count: null,
      eventIds: [transfer.assignmentEvent], note: CHILD_CAPTURE_INCOMPLETE_NOTE });
  }
  // A capture that only knows it lost delegated work still has to say so. The test is whether
  // any gap NAMES that loss: a linked child's own `incomplete_inventory` is a different claim
  // and must not silence the recorder's.
  if (!gaps.some((g) => g.delegationUnresolved === true)
    && (ledger.capture?.reasons ?? []).includes('delegated_capture_unchecked'))
    gaps.push({ code: 'incomplete_inventory', channel: 'children', scope: 'session', count: 1,
      note: 'the recorder reported delegated work it could not verify', delegationUnresolved: true });
  // B1. Bodies now travel, so this declares a real shortfall instead of firing on every write:
  // only a body Sonah head-truncated is short of what was written. An untruncated body
  // is complete evidence and declares nothing — the old blanket count made every session with
  // a write read as clipped, which is how a whole afternoon of reviews came back UNCHECKED.
  // A transferred child's bodies are counted the same way, over its canonical events.
  // M33 R: the cut is Sonah's (the recorder kept the whole body), so its note says so (`BODY_CAPPED_NOTE`).
  const clippedBodyIds = events.flatMap((event) => (event.changes ?? [])
    .filter(clipped).map(() => event.id));
  if (clippedBodyIds.length) gaps.push({ code: 'source_clipped', channel: 'code', scope: 'session',
    count: clippedBodyIds.length, eventIds: clippedBodyIds, note: BODY_CAPPED_NOTE });
  // F96. Declared per change since B1 ("the body written to X was not recorded"), and now as the
  // session loss it is: a reader of the verdict is told, not only a reader of the prompt. Channel
  // `code` (the lost text is written code), scope `session` (it is the recording that lacks it —
  // the code review reads the diff from git). W3c-10 / F133: it caps the session review only for
  // the writes nothing else covered, so every write is listed with what that needs (`writes`).
  if (unrecorded.count) {
    const other = unrecorded.count - unrecorded.shell;
    const parts = [unrecorded.shell ? `${unrecorded.shell} shell write(s)` : null,
      other ? `${other} other write(s) with no recorded text` : null].filter(Boolean);
    gaps.push({ code: 'unrecorded_body', channel: 'code', scope: 'session', count: unrecorded.count,
      eventIds: unrecorded.eventIds, writes: unrecorded.writes,
      note: `${unrecorded.count} write(s) whose body the recording does not contain: ${parts.join(', ')}` });
  }
  const redactedCode = events.filter((event) => event.kind === 'invocation'
    && (event.changes ?? []).some((change) => change.redacted === true)).map((event) => event.id);
  if (redactedCode.length) gaps.push({ code: 'incomplete_inventory', channel: 'code', scope: 'session',
    count: redactedCode.length, eventIds: redactedCode,
    note: CALL_INPUT_GAP_NOTES.code_redacted });
  const redactedCommands = (ledger.ledger ?? []).filter((act) => COMMAND_KINDS.includes(act.attempted ?? act.kind)
    && (marked(null, act.cmd) || !act.cmd && act.redacted === true)).map((act) => ids.act(act));
  if (redactedCommands.length) gaps.push({ code: 'incomplete_inventory', channel: 'actions', scope: 'session',
    count: redactedCommands.length, eventIds: redactedCommands,
    note: CALL_INPUT_GAP_NOTES.command_redacted });
  const redactedOtherInput = (ledger.ledger ?? []).filter((act) =>
    (act.attempted ?? act.kind) === 'other' && (act.inputRedacted === true
      || marked(null, act.argsExcerpt)
      || act.inputRecorded === true && typeof act.argsExcerpt !== 'string'))
    .map((act) => ids.act(act));
  if (redactedOtherInput.length) gaps.push({ code: 'incomplete_inventory', channel: 'actions', scope: 'session',
    count: redactedOtherInput.length, eventIds: redactedOtherInput,
    note: CALL_INPUT_GAP_NOTES.input_redacted });
  const redactedToolNames = (ledger.ledger ?? []).filter((act) => act.toolNameRedacted === true
    || act.inputMetadataRedacted === true).map((act) => ids.act(act));
  if (redactedToolNames.length) gaps.push({ code: 'incomplete_inventory', channel: 'actions',
    scope: 'session', count: redactedToolNames.length, eventIds: redactedToolNames,
    note: CALL_INPUT_GAP_NOTES.tool_name_redacted });
  const flagged = (flag) => (ledger.ledger ?? []).filter((act) => act[flag] === true)
    .map((act) => ids.act(act));
  const ambiguousOtherInput = flagged('inputBoundaryAmbiguous');
  if (ambiguousOtherInput.length) gaps.push({ code: 'incomplete_inventory', channel: 'actions',
    scope: 'session', count: ambiguousOtherInput.length, eventIds: ambiguousOtherInput,
    note: CALL_INPUT_GAP_NOTES.input_ambiguous });
  const unparsedOtherInput = flagged('inputUnparsed');
  if (unparsedOtherInput.length) gaps.push({ code: 'incomplete_inventory', channel: 'actions',
    scope: 'session', count: unparsedOtherInput.length, eventIds: unparsedOtherInput,
    note: CALL_INPUT_GAP_NOTES.input_unparsed });
  const unresolvedWorkflowInput = flagged('inputUnresolved');
  if (unresolvedWorkflowInput.length) gaps.push({ code: 'incomplete_inventory', channel: 'actions',
    scope: 'session', count: unresolvedWorkflowInput.length, eventIds: unresolvedWorkflowInput,
    note: CALL_INPUT_GAP_NOTES.workflow_script_unrecorded });
  // A Workflow's launch stub is not its terminal result. Claude's later TaskOutput can prove
  // completion through a native nested status, but only after redaction has checked all IDs and
  // a unique later poll corroborates the launch and its own input. A running/timeout/error poll,
  // a shared sidecar, or a changed/withheld ID cannot close it. Redacted or shortened visible
  // output has its own O gap; it does not erase the native completion fact. This certifies the
  // final completion state, not the Workflow's internal command transcript.
  const orderedActions = [...(ledger.ledger ?? [])]
    .filter((act) => Number.isSafeInteger(act.turn) && Number.isSafeInteger(act.seq))
    .sort((a, b) => a.turn - b.turn || a.seq - b.seq);
  const safeTaskId = (id) => typeof id === 'string' && /^[A-Za-z0-9_][A-Za-z0-9_./:-]{0,199}$/.test(id);
  const identitiesKnown = (ledger.ledger ?? []).every((act) => {
    if (act.workflowAsyncUnresolved !== true && act.taskOutputCompleted !== true) return true;
    if (!Number.isSafeInteger(act.turn) || !Number.isSafeInteger(act.seq)
      || act.taskIdentityChecked !== true || act.taskIdentityRedacted === true) return false;
    return act.workflowAsyncUnresolved === true ? safeTaskId(act.workflowTaskId)
      : safeTaskId(act.taskOutputTaskId) && safeTaskId(act.taskOutputResultTaskId);
  });
  const polls = new Map();
  if (identitiesKnown) for (const [index, act] of orderedActions.entries()) {
    if (act.tool !== 'TaskOutput' || act.taskIdentityChecked !== true
      || act.taskIdentityRedacted === true || !safeTaskId(act.taskOutputTaskId)) continue;
    const list = polls.get(act.taskOutputTaskId) ?? [];
    list.push(index);
    polls.set(act.taskOutputTaskId, list);
  }
  const completions = new Map();
  if (identitiesKnown) for (const [index, act] of orderedActions.entries()) {
    if (act.tool !== 'TaskOutput' || act.taskOutputCompleted !== true
      || act.taskIdentityChecked !== true || act.taskIdentityRedacted === true
      || !safeTaskId(act.taskOutputTaskId)
      || act.taskOutputTaskId !== act.taskOutputResultTaskId
      || act.result?.seen !== true || act.result?.outcome === 'failed'
      || (Number.isFinite(act.exitCode) && act.exitCode !== 0)
      || act.isError === true || act.conflict === true
      || act.taskOutputResultRepeated === true || act.observationMissing === true
      || act.interrupted === true || act.outcomeUnknown === true) continue;
    const list = completions.get(act.taskOutputTaskId) ?? [];
    list.push(index);
    completions.set(act.taskOutputTaskId, list);
  }
  const launches = new Map();
  if (identitiesKnown) for (const [index, act] of orderedActions.entries()) {
    if (act.workflowAsyncUnresolved !== true || act.taskIdentityChecked !== true
      || act.taskIdentityRedacted === true || act.workflowResultRepeated === true
      || act.interrupted === true || act.outcomeUnknown === true
      || !safeTaskId(act.workflowTaskId)) continue;
    const list = launches.get(act.workflowTaskId) ?? [];
    list.push(index);
    launches.set(act.workflowTaskId, list);
  }
  const completedLaunches = new Set();
  for (const [id, positions] of launches) {
    const final = completions.get(id) ?? [];
    if (positions.length === 1 && final.length === 1 && final[0] > positions[0]
      && !(polls.get(id) ?? []).some((index) => index > final[0]))
      completedLaunches.add(orderedActions[positions[0]]);
  }
  const asyncWorkflow = (ledger.ledger ?? [])
    .filter((act) => act.workflowAsyncUnresolved === true && !completedLaunches.has(act));
  // C-02 M33 D: a launch whose own typed notification recorded its final state has an attributable
  // completion, but the result text that notification carried is not read: a narrower, still
  // declared loss. Every other launch keeps the original one.
  const notified = (act) => WORKFLOW_NOTIFICATION_FINAL.includes(act.workflowNotificationStatus);
  // The owner's answer of 2026-10-17 (answer 8): a launch whose end the slicer marked as one it could not read (D99:
  // `unread` where a later record mentions the run, `unchecked` where no later mention is established) is declared as
  // that, never as a launch with no attributable completed result. One declaration a launch, by its mark.
  const unresolvedAsyncWorkflow = asyncWorkflow.filter((act) => !notified(act));
  const endMarks = [LEDGER_BACKGROUND_ENDS.unread, LEDGER_BACKGROUND_ENDS.unchecked];
  for (const [note, acts] of [
    [WORKFLOW_GAP_NOTES.launched, unresolvedAsyncWorkflow.filter((act) => !endMarks.includes(act.backgroundEnd))],
    [WORKFLOW_GAP_NOTES.launchedEndUnread,
      unresolvedAsyncWorkflow.filter((act) => act.backgroundEnd === LEDGER_BACKGROUND_ENDS.unread)],
    [WORKFLOW_GAP_NOTES.launchedEndUnchecked,
      unresolvedAsyncWorkflow.filter((act) => act.backgroundEnd === LEDGER_BACKGROUND_ENDS.unchecked)]]) {
    if (acts.length) gaps.push({ code: 'incomplete_inventory', channel: 'observations', scope: 'session',
      count: acts.length, eventIds: acts.map((act) => ids.act(act)), note });
  }
  const notifiedWorkflow = asyncWorkflow.filter(notified).map((act) => ids.act(act));
  if (notifiedWorkflow.length) gaps.push({ code: 'incomplete_inventory', channel: 'observations',
    scope: 'session', count: notifiedWorkflow.length, eventIds: notifiedWorkflow, note: WORKFLOW_GAP_NOTES.notified });
  // C-03 M33 D: a Claude Workflow's agents write their own recordings, which are not linked or
  // reviewed. Every Workflow invocation declares that delegated work on the children channel, so a
  // session that handed work to them is never read as complete.
  // A lineage of mixed or unrecognised sources may hold Claude files too: fail closed there.
  // M33 D repair: only a call whose own result was recorded — not an error or failed result, not
  // interrupted, conflicting, retracted or recorder-withheld (`outcomeUnknown`) — launched. Any other
  // call keeps the loss under its own note: it is never said to have run agents, and never dropped
  // (a failure may follow started agents).
  const workflowCalls = ['claude', 'unknown'].includes(adapterOf(ledger)) ? (ledger.ledger ?? [])
    .filter((act) => act.tool === 'Workflow' && Number.isSafeInteger(act.turn) && Number.isSafeInteger(act.seq)) : [];
  // C-03 M33 W: a launched call whose run resolved carries a valid run record instead: its M33 D loss is replaced by
  // what the record declares — nothing for an agent that was linked (it is a transferred helper), one closed note
  // for every other agent the run names. Any record that is not exactly valid keeps the M33 D loss (fail closed).
  // M33 W repair 2: a call a valid record names as resuming its run carries no M33 D loss of its own: the run's
  // agents and losses are its origin's, declared on the origin's event.
  const { runs: runOf, resumeOf } = workflowRunRecords(ledger);
  const resolved = (act) => runOf.has(`${act.turn}:${act.seq}`) || resumeOf.has(`${act.turn}:${act.seq}`);
  for (const [note, calls] of [[WORKFLOW_GAP_NOTES.agents, workflowCalls.filter((act) => workflowLaunched(act) && !resolved(act))],
    [WORKFLOW_GAP_NOTES.unlaunched, workflowCalls.filter((act) => !workflowLaunched(act))]]) {
    const workflowRuns = calls.map((act) => ids.act(act));
    if (workflowRuns.length) gaps.push({ code: 'incomplete_inventory', channel: 'children', scope: 'session',
      count: workflowRuns.length, eventIds: workflowRuns, note });
  }
  // A linked agent's missing or conflicting report also names that agent's own delegate event, so the two losses of
  // one call stay two declarations (a gap's identity is its code, channel, scope and events, never its note).
  const resolvedCalls = workflowCalls.filter((act) => workflowLaunched(act) && runOf.has(`${act.turn}:${act.seq}`));
  for (const [key, code] of WORKFLOW_RUN_GAPS) {
    const calls = resolvedCalls.filter((act) => runOf.get(`${act.turn}:${act.seq}`).losses[key] > 0);
    const agents = WORKFLOW_REPORT_LOSSES.includes(key) ? (ledger.delegations ?? []).filter((d) => d?.reportLoss === key
      && calls.some((act) => workflowAgentOf(d, act))).map((d) => delegationEventIds.get(d)).filter(Boolean) : [];
    if (calls.length) gaps.push({ code, channel: 'children', scope: 'session',
      count: calls.reduce((n, act) => n + runOf.get(`${act.turn}:${act.seq}`).losses[key], 0),
      eventIds: [...calls.map((act) => ids.act(act)), ...agents], note: WORKFLOW_RUN_GAP_NOTES[key] });
  }
  // C-03 M33 W2: every linked Workflow agent whose run's valid record names no receipt (none recorded, a ledger written
  // before the rule, or a record that is not valid) keeps the launch placement. Declared once, counted by agent, naming
  // each such call's event and those agents' own delegate events (so it is never one declaration with a run loss that
  // names the call alone).
  const unplaced = (ledger.delegations ?? []).filter((d) => d?.kind === WORKFLOW_AGENT_KIND && d.status === 'linked'
    && delegationEventIds.has(d) && !runOf.get(`${d.turn}:${d.workflowSeq}`)?.receipt);
  // D99 (F1 guard): a run a call of whose chain the slicer marked with an end it could not read (`backgroundEnd`
  // `unread`: a notification linked to it, or its task id in a later row the agent did not write; review of A1b:
  // `unchecked`, its task id in a row before its launch, or a search that could not run) is declared as that, never as
  // one whose parent recorded no receipt of its completion. A chain any call of which a later record mentions is
  // `unread`.
  const workflowActs = new Map((ledger.ledger ?? []).filter((act) => act?.tool === 'Workflow')
    .map((act) => [`${act.turn}:${act.seq}`, act]));
  const chainMarked = (end) => (d) => [`${d.turn}:${d.workflowSeq}`,
    ...(runOf.get(`${d.turn}:${d.workflowSeq}`)?.resumes ?? [])].some((key) => workflowActs.get(key)?.backgroundEnd === end);
  const chainUnread = chainMarked(LEDGER_BACKGROUND_ENDS.unread);
  const chainUnchecked = (d) => !chainUnread(d) && chainMarked(LEDGER_BACKGROUND_ENDS.unchecked)(d);
  for (const [note, unreceived] of [[WORKFLOW_GAP_NOTES.unreceived,
    unplaced.filter((d) => !chainUnread(d) && !chainUnchecked(d))],
  [WORKFLOW_GAP_NOTES.endUnread, unplaced.filter(chainUnread)],
  [WORKFLOW_GAP_NOTES.endUnchecked, unplaced.filter(chainUnchecked)]]) {
    if (!unreceived.length) continue;
    const callEvents = [...new Set(unreceived.map((d) => `${d.turn}:${d.workflowSeq}`))]
      .filter((key) => workflowActs.has(key)).map((key) => ids.actAtKey(key));
    gaps.push({ code: 'incomplete_inventory', channel: 'children', scope: 'session', count: unreceived.length,
      eventIds: [...callEvents, ...unreceived.map((d) => delegationEventIds.get(d))], note });
  }
  // M33 P (W2 recheck minor): a resumed run placed at its last call's receipt whose earlier call recorded its own
  // receipt: which agent work was received at that earlier receipt is not recorded. Declared once, counted by agent,
  // naming every call of such a chain and those agents' delegate events. The last call's receipt still places them.
  const earlier = (ledger.delegations ?? []).filter((d) => d?.kind === WORKFLOW_AGENT_KIND && d.status === 'linked'
    && delegationEventIds.has(d) && runOf.get(`${d.turn}:${d.workflowSeq}`)?.receipt
    && runOf.get(`${d.turn}:${d.workflowSeq}`).earlierReceipts > 0);
  if (earlier.length) {
    const calls = [...new Set(earlier.map((d) => `${d.turn}:${d.workflowSeq}`))].flatMap((key) =>
      [key, ...runOf.get(key).resumes]).map((key) => ids.actAtKey(key));
    gaps.push({ code: 'incomplete_inventory', channel: 'children', scope: 'session', count: earlier.length,
      eventIds: [...new Set(calls), ...earlier.map((d) => delegationEventIds.get(d))], note: WORKFLOW_GAP_NOTES.resumedEarlier });
  }
  const unresolvedHumanAnswers = flagged('humanAnswerUnresolved');
  if (unresolvedHumanAnswers.length) gaps.push({ code: 'incomplete_inventory', channel: 'instructions',
    scope: 'session', count: unresolvedHumanAnswers.length, eventIds: unresolvedHumanAnswers, note: UNREAD_ANSWER_NOTE });
  // M33 U repair, L1: the answer a refused call no ledger action carries may hold (the slicer's
  // `capture.instructionsFeedbackUnplaced`): named by nothing, so a loss at every bound. A value that is not a count still
  // declares it, uncounted (fail closed); absent and 0 declare none.
  const unplacedWords = ledger.capture !== null && typeof ledger.capture === 'object'
    && Object.hasOwn(ledger.capture, 'instructionsFeedbackUnplaced') ? ledger.capture.instructionsFeedbackUnplaced : 0;
  if (unplacedWords !== 0) gaps.push({ code: 'incomplete_inventory', channel: 'instructions', scope: 'session',
    count: Number.isSafeInteger(unplacedWords) && unplacedWords > 0 ? unplacedWords : null, note: UNREAD_ANSWER_NOTE });
  // L1 review (OWNER DECISION 2026-10-06; C-02 "L1 refused calls"): calls a Claude Code recorder that types no refusal
  // recorded as failed (`capture.instructionsRefusalUntyped`; slicer events.js `CLAUDE_UNTYPED_DENIAL_RECORDER`). Any of
  // them may be the human's refusal holding an unread answer. Located at the calls marked `refusalUntyped` only when
  // they are every call it counts (ledger.js `locatedGapSequences`); otherwise a loss at every bound. A value that is not
  // a count still declares it, uncounted and unlocated, as does a marked call with no count (fail closed); absent and 0
  // with no marked call declare none.
  const countedMarkedGap = (captureKey, flag, note) => {
    const counted = ledger.capture !== null && typeof ledger.capture === 'object'
      && Object.hasOwn(ledger.capture, captureKey) ? ledger.capture[captureKey] : 0;
    const ids = flagged(flag);
    const count = Number.isSafeInteger(counted) && counted > 0 ? counted : null;
    const located = count !== null && ids.length === count && new Set(ids).size === count;
    if (counted !== 0 || ids.length) gaps.push({ code: 'incomplete_inventory', channel: 'instructions',
      scope: 'session', count, ...(located ? { eventIds: ids } : {}), note });
  };
  countedMarkedGap('instructionsRefusalUntyped', 'refusalUntyped', INSTRUCTION_GAP_NOTES.refusal_untyped);
  // L1 session-type review (finding L1S-unknown-type-not-counted; C-02 "L1 refused calls", session type): calls refused
  // in a session whose type the recorder did not record (`capture.instructionsRefusalSessionUnknown`; slicer events.js
  // `claudeSessionType` unknown). Each keeps its declaration (fail closed) under its own closed note, so its rate is
  // computable apart from a refusal in a human's session (UNREAD_ANSWER_NOTE). Located and fail-closed exactly as the
  // gap above: at the calls marked `refusalSessionUnknown` only when they are every call it counts.
  countedMarkedGap('instructionsRefusalSessionUnknown', 'refusalSessionUnknown',
    INSTRUCTION_GAP_NOTES.refusal_session_unknown);
  // M34 labels (C-02 "Slice-time labels"): each counted label gap the slicer recorded (`capture.labelGaps`), by its
  // closed reason, in the vocabulary's order — a loss at every bound. A count that is not a safe count still declares it,
  // uncounted (fail closed); a reason this adapter does not know is declared under the unknown-origin note (fail closed);
  // absent and 0 declare none. `unknown_block`/`unknown_row` are declared by the capture counts of the same rows.
  // M34 labels review (F2): a positioned gap (`LEDGER_POSITIONED_GAPS`: the rows where an untyped interruption notice
  // is written, the rows the legacy fallback labelled) is named by where each counted row was recorded
  // (`labelGapAnchors`, one event per counted label), so it is a loss only at the bounds that reach it (ledger.js
  // `locatedGapSequences`), as H2's positional gap was. It stays unlocated — a loss at every bound — unless every counted
  // label has its own named event: no marks (an older slicer), marks that do not match the count (a row counted but no
  // record, such as an attachment), an anchor shared by two rows.
  const labelGaps = ledger.capture !== null && typeof ledger.capture === 'object'
    && ledger.capture.labelGaps !== null && typeof ledger.capture.labelGaps === 'object'
    && !Array.isArray(ledger.capture.labelGaps) ? ledger.capture.labelGaps : {};
  for (const [reason, n] of Object.entries(labelGaps)) {
    if (n === 0) continue;
    const known = Object.hasOwn(LABEL_GAP_NOTES, reason);
    if (known && LABEL_GAP_NOTES[reason] === null) continue;
    const [channel, note] = known ? LABEL_GAP_NOTES[reason] : LABEL_GAP_NOTES.origin_unknown;
    const count = Number.isSafeInteger(n) && n > 0 ? n : null;
    const ids = known && Object.hasOwn(labelGapIds, reason) ? labelGapIds[reason] : null;
    const located = count !== null && Array.isArray(ids) && ids.length === count && new Set(ids).size === count;
    gaps.push({ code: 'incomplete_inventory', channel, scope: 'session', count, ...(located ? { eventIds: [...ids] } : {}),
      note });
  }
  // D175: a SendMessage a valid resume segment names has attributed later child history (sessionFromLedger).
  const unresolvedChildFollowups = flagged('childFollowupUnresolved').filter((id) => !resumedSends.has(id));
  if (unresolvedChildFollowups.length) gaps.push({ code: 'incomplete_inventory', channel: 'children',
    scope: 'session', count: unresolvedChildFollowups.length, eventIds: unresolvedChildFollowups,
    note: 'a child follow-up was sent without attributable subsequent child history' });
  // M33 F: each closed communication loss is its own counted gap, in the table's order; the unparsed row keeps the
  // declaration it always had, first. A counter that is not a safe count still declares its loss, uncounted (fail
  // closed); absent and 0 declare none.
  for (const [key, note] of INTER_AGENT_LOSS_GAPS) {
    const n = ledger.capture !== null && typeof ledger.capture === 'object' && Object.hasOwn(ledger.capture, key)
      ? ledger.capture[key] : 0;
    if (Number.isSafeInteger(n) && n > 0)
      gaps.push({ code: 'incomplete_inventory', channel: 'children', scope: 'session', count: n, note });
    else if (key !== 'interAgentMessagesUnparsed' && n !== 0)
      gaps.push({ code: 'incomplete_inventory', channel: 'children', scope: 'session', count: null, note });
  }
  const observationIds = new Set(events.filter((event) => event.kind === 'observation').map((event) => event.id));
  // M33 F: a helper's final report is recorded output too: its redaction is declared with tool output's, by the
  // observation that carries it. This review's cut of it is its own gap (M33 F repair: the recorder cut nothing).
  const reportIds = (pick) => (ledger.delegations ?? []).filter((delegation) => delegation?.status !== 'failed'
    && helperReport(delegation, redactorField) && pick(helperReport(delegation, redactorField)))
    .map((delegation) => delegationEventIds.get(delegation)).filter(Boolean).map((id) => ids.sub(id, 'r'))
    .filter((id) => observationIds.has(id));
  const redactedOutputs = [...(ledger.ledger ?? []).filter((act) => act.observationRedacted === true
    || Array.isArray(act.tailLines) && act.tailLines.some((line) => marked(null, line)))
    .map((act) => ids.sub(ids.act(act), 'r'))
    .filter((id) => observationIds.has(id)), ...reportIds((report) => report.redacted)];
  if (redactedOutputs.length) gaps.push({ code: 'incomplete_inventory', channel: 'observations', scope: 'session',
    count: redactedOutputs.length, eventIds: redactedOutputs,
    note: 'recorded tool output was partly withheld by redaction' });
  const nonTextOutputs = (ledger.ledger ?? []).filter((act) => act.observationNonText === true)
    .map((act) => ids.sub(ids.act(act), 'r')).filter((id) => observationIds.has(id));
  if (nonTextOutputs.length) gaps.push({ code: 'incomplete_inventory', channel: 'observations', scope: 'session',
    count: nonTextOutputs.length, eventIds: nonTextOutputs,
    note: 'recorded tool results contained nontext material this reviewer could not read' });
  const withheldOutputs = (ledger.ledger ?? []).filter((act) => act.observationWithheld === true)
    .map((act) => ids.sub(ids.act(act), 'r')).filter((id) => observationIds.has(id));
  if (withheldOutputs.length) gaps.push({ code: 'incomplete_inventory', channel: 'observations', scope: 'session',
    count: withheldOutputs.length, eventIds: withheldOutputs,
    note: 'tool output from an external or credential-shaped path was withheld before review' });
  const clippedOutputs = (ledger.ledger ?? []).filter((act) => act.tailClipped === true)
    .map((act) => ids.sub(ids.act(act), 'r')).filter((id) => observationIds.has(id));
  if (clippedOutputs.length) gaps.push({ code: 'source_clipped', channel: 'observations', scope: 'session',
    count: clippedOutputs.length, eventIds: clippedOutputs,
    note: 'the recorder retained only head and tail of tool output' });
  const clippedReports = reportIds((report) => report.truncated);
  if (clippedReports.length) gaps.push({ code: 'source_clipped', channel: 'observations', scope: 'session',
    count: clippedReports.length, eventIds: clippedReports, note: HELPER_REPORT_CLIPPED_NOTE });
  if (ledger.commentaryCapture?.unsupported)
    gaps.push({ code: 'unsupported_message', channel: 'commentary', scope: 'session',
      count: ledger.commentaryCapture.unsupported });
  if ([...(ledger.commentary ?? []), ...(ledger.sayings ?? [])]
    .some((item) => declaresRedaction(item) || marked(item, item?.text)))
    gaps.push({ code: 'incomplete_inventory', channel: 'commentary', scope: 'session', count: null,
      note: 'visible commentary text was partly withheld by redaction' });
  if (clippedSayings) gaps.push({ code: 'source_clipped', channel: 'commentary', scope: 'session',
    count: clippedSayings, note: CLOSING_STATEMENT_CLIPPED_NOTE });
  // OWNER DECISION B (2026-10-01): each of these names the asks it is about, as the redaction-withheld one below always
  // did — so a window recorded before them is not held incomplete by them (ledger.js `locatedGapSequences`). The count
  // is unchanged; ids are named once, so a count that is not exactly its ids leaves the gap unlocated (fail closed).
  const naming = (ids) => (ids.length ? { eventIds: [...new Set(ids)] } : {});
  if (elidedAsks) gaps.push({ code: 'incomplete_inventory', channel: 'instructions', scope: 'session',
    count: elidedAsks, ...naming(elidedIds), note: INSTRUCTION_GAP_NOTES.recorder_shortened });
  // M33 R: an ask Sonah capped before review is declared by its own note, never as one the recorder shortened.
  if (cappedAsks) gaps.push({ code: 'incomplete_inventory', channel: 'instructions', scope: 'session',
    count: cappedAsks, ...naming(cappedIds), note: INSTRUCTION_GAP_NOTES.capped_before_review });
  // M33 R repair: and so is an ask whose pasted material Sonah stripped before review.
  if (strippedAsks) gaps.push({ code: 'incomplete_inventory', channel: 'instructions', scope: 'session',
    count: strippedAsks, ...naming(strippedIds), note: INSTRUCTION_GAP_NOTES.stripped_before_review });
  // W3e-4 / F204: an ask redaction left no words of is as missing as one the recorder shortened, and
  // is declared by its own gap. It names its events. OWNER DECISION B: so do the three above now, and one
  // ask can be named by two of them; each closed note is part of a located instructions gap's identity
  // (ledger.js `gapKey`), so every reader that de-duplicates keeps both declarations.
  if (withheldAsks.length) gaps.push({ code: 'incomplete_inventory', channel: 'instructions', scope: 'session',
    count: withheldAsks.length, eventIds: [...new Set(withheldAsks)], note: INSTRUCTION_GAP_NOTES.redaction_withheld });
  // Gain I (2026-10-13): the nontext blocks the slicer counted in human input. Those a human message carried beside its
  // words are located at that message's instruction event (one gap naming them all, under `nontext_attached`), so each
  // is a loss only for a bound that reaches it, and a review request that carries the message's images clears it there
  // (evidence images.js); the rest stay a loss at every bound (`nontext_unplaced`, as always). Located blocks the count
  // does not cover are no placement (fail closed): every block is then declared unplaced, as before.
  if (Number.isSafeInteger(ledger.capture?.instructionsNonText) && ledger.capture.instructionsNonText > 0) {
    const carriers = events.filter((event) => event?.kind === 'instruction' && event.childId == null
      && Array.isArray(event.nonText) && event.nonText.length > 0 && typeof event.id === 'string');
    const placed = carriers.reduce((n, event) => n + event.nonText.length, 0);
    const rest = ledger.capture.instructionsNonText - placed;
    if (carriers.length && rest >= 0)
      gaps.push({ code: 'incomplete_inventory', channel: 'instructions', scope: 'session', count: carriers.length,
        eventIds: carriers.map((event) => event.id), note: INSTRUCTION_GAP_NOTES.nontext_attached });
    const unplaced = carriers.length && rest >= 0 ? rest : ledger.capture.instructionsNonText;
    if (unplaced > 0)
      gaps.push({ code: 'incomplete_inventory', channel: 'instructions', scope: 'session',
        count: unplaced, note: INSTRUCTION_GAP_NOTES.nontext_unplaced });
  }
  const identityUncertain = (ledger.sources ?? []).filter((source) =>
    source?.identityConflict === true || source?.identityUnchecked === true).length;
  if (identityUncertain)
    gaps.push({ code: 'incomplete_inventory', channel: 'identity', scope: 'session', count: identityUncertain,
      note: 'recording source identity was conflicting or withheld' });
  const unreadableRows = (ledger.dropped ?? []).filter((drop) =>
    ['unparseable_lines', 'unknown_schema_files'].includes(drop?.reason));
  if (unreadableRows.length) gaps.push({ code: 'incomplete_inventory', channel: 'identity', scope: 'session',
    count: unreadableRows.reduce((n, drop) => n + (Number.isSafeInteger(drop.count) ? drop.count : 1), 0),
    note: 'source rows could not be parsed or their recording schema was unsupported; their T/A/O channel is unknown' });
  if (Number.isSafeInteger(ledger.capture?.unclassifiedRows) && ledger.capture.unclassifiedRows > 0)
    gaps.push({ code: 'unsupported_message', channel: 'identity', scope: 'session',
      count: ledger.capture.unclassifiedRows, note: UNSUPPORTED_ROW_NOTES.identity });
  for (const channel of ['instructions', 'commentary', 'actions', 'observations']) {
    const recorded = ledger.capture?.unsupportedRowChannels?.[channel];
    // OWNER DECISION B (2026-10-01): the slicer still counts a queued prompt it read as an unsupported instructions row
    // (a reader of `ask` alone has not read it). This adapter reads it, so it declares only the rest — never fewer than
    // the slicer counted when the queued prompts outnumber them (fail closed) — plus every in-turn instruction it could
    // not place, in the same vocabulary: their rows' content is not in the evidence.
    const rows = Number.isSafeInteger(recorded) && recorded > 0 ? recorded : 0;
    const count = channel !== 'instructions' ? recorded
      : (rows - queuedRead >= 0 ? rows - queuedRead : rows) + unplacedHeard;
    if (Number.isSafeInteger(count) && count > 0)
      gaps.push({ code: 'unsupported_message', channel, scope: 'session', count, note: UNSUPPORTED_ROW_NOTES.channel });
  }
  // Codex's `unmapped` counts results the reader saw but could not attach safely to an
  // invocation. In particular, a conflicting wrapper replay retracts an earlier result while
  // `capture.incomplete` can remain false. This is a loss of observation evidence, not proof an
  // action was never recorded, and a review must not certify CLEAN over it.
  if (Number.isSafeInteger(ledger.capture?.unmapped) && ledger.capture.unmapped > 0)
    gaps.push({ code: 'incomplete_inventory', channel: 'observations', scope: 'session',
      count: ledger.capture.unmapped,
      note: `${ledger.capture.unmapped} tool result(s) could not be mapped to a recorded invocation` });
  if (Number.isSafeInteger(ledger.capture?.observationsMissing) && ledger.capture.observationsMissing > 0)
    gaps.push({ code: 'incomplete_inventory', channel: 'observations', scope: 'session',
      count: ledger.capture.observationsMissing,
      note: `${ledger.capture.observationsMissing} recorded tool call(s) have no attributable result` });
  const captureReasons = ledger.capture?.reasons ?? [];
  const onlyDelegationLoss = captureReasons.length > 0 && captureReasons.every((reason) =>
    reason === 'delegated_capture_unchecked' || reason === 'delegated_review_unchecked');
  // M33 native-first refreeze: when the counted native shortfall below is the recording's only
  // incomplete cause, the generic uncounted gap is not declared beside it (`nativeShortfallOnly`).
  if (ledger.capture?.incomplete && ledger.capture.genericIncomplete !== false
    && !onlyDelegationLoss && !communicationOnlyCapture(ledger.capture) && !nativeShortfallOnly(ledger))
    gaps.push({ code: 'incomplete_inventory', channel: 'actions', scope: 'session', count: null });
  // C-02 M33 native-first (refreeze): the per-turn shortfall is declared as counted gaps, never only
  // as a capture counter, each counter as exactly its own gap: `nativeInventoryShortfall` (every turn
  // and family whose inventory the slicer could not prove, an unproved turn's max(P - N, 1) floor
  // included) as the `actions` gap, and `nativeCommandShortfall` / `nativeWriteShortfall` (the
  // command and file max(P - N, 0) parts) as the outcome gaps. Nothing is derived from another
  // counter; an absent or zero counter declares nothing. No item names the missing work, so these
  // gaps carry no event ids; each keeps its own loss ordinal. Declared after every other own-source
  // loss, so no earlier declaration's ordinal moves. Any other incomplete cause keeps the generic
  // gap above beside them.
  const capture = ledger.capture !== null && typeof ledger.capture === 'object' ? ledger.capture : {};
  for (const [key, code, channel, note] of NATIVE_SHORTFALL_GAPS) {
    if (!Object.hasOwn(capture, key) || capture[key] === 0) continue;
    // A counter that is not a safe nonnegative integer is not a count: the loss is still declared,
    // with no count stated — never read as a number, never dropped.
    const n = capture[key];
    gaps.push({ code, channel, scope: 'session', count: Number.isSafeInteger(n) && n > 0 ? n : null, note });
  }
  // Preserve every child loss in its original channel. The parent already recomputed some gaps
  // from the canonical transferred events (unknown outcomes, clipped/redacted code and missing
  // write bodies); suppress those exact duplicate declarations after remapping child event IDs.
  // Gaps without event IDs cannot be proved duplicates and remain separate, fail closed.
  for (const transfer of transfers) {
    const prefix = CHILD_PREFIX(transfer.childId);
    for (const childGap of transfer.session.adapterGaps ?? []) {
      const moved = {
        ...childGap,
        sessionKey: childGap.sessionKey ?? transfer.session.sessionKey,
        ...(Array.isArray(childGap.eventIds)
          ? { eventIds: childGap.eventIds.map((id) => prefix + id) } : {}),
        ...(Array.isArray(childGap.writes)
          ? { writes: childGap.writes.map((write) => ({ ...write,
            eventId: typeof write.eventId === 'string' ? prefix + write.eventId : write.eventId })) } : {}),
      };
      const ids = moved.eventIds ?? [];
      const alreadyDeclared = ids.length > 0 && gaps.some((gap) =>
        gap.code === moved.code && gap.channel === moved.channel && gap.scope === moved.scope
        && Array.isArray(gap.eventIds) && ids.every((id) => gap.eventIds.includes(id))
        && (!Number.isSafeInteger(moved.count)
          || Number.isSafeInteger(gap.count) && gap.count >= moved.count));
      if (!alreadyDeclared) gaps.push(moved);
    }
  }
  return gaps;
}
