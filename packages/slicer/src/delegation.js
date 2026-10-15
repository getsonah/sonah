// A spawn receipt proves only that work was delegated. It never proves the child's
// actions were captured, or makes the child's brief/summary a human instruction.
import { claudeAgentFacts } from './recorded.js';
import { strictJson } from './strict-json.js';
import { validIdentity } from './event-identity.js';
import { entropy, ENTROPY_MIN } from '../../redact/index.js';

const SPAWN_NAMES = Object.freeze({
  claude: Object.freeze(['Task', 'Agent']),
  codex: Object.freeze(['collaboration.spawn_agent', 'spawn_agent']),
});
const CHILD_FIELDS = Object.freeze({ claude: 'agentId', codex: 'agent_id' });
const FOLLOWUP_NAMES = Object.freeze(['followup_task', 'collaboration.followup_task']);
export const DELEGATION_REASONS = Object.freeze({
  CHILD_UNCHECKED: 'delegation_child_unchecked',
  TURN_INVALID: 'delegation_turn_invalid',
  SOURCE_INVALID: 'delegation_source_invalid',
  CALL_INVALID: 'delegation_call_invalid',
  RESULT_MISSING: 'delegation_result_missing',
  RESULT_MALFORMED: 'delegation_result_malformed',
  RESULT_UNMATCHED: 'delegation_result_unmatched',
  RESULT_AMBIGUOUS: 'delegation_result_ambiguous',
  SPAWN_FAILED: 'delegation_spawn_failed',
  CALL_AMBIGUOUS: 'delegation_call_ambiguous',
  CHILD_AMBIGUOUS: 'delegation_child_ambiguous',
});
const MAX_ID = 200;
const MAX_RESULT = 16_384;
const own = (object, key) => Object.hasOwn(object, key);
const object = (value) => value !== null && typeof value === 'object'
  && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
const identity = (value) => typeof value === 'string' && value.length > 0
  && value.length <= MAX_ID && /^[A-Za-z0-9_][A-Za-z0-9_./:-]*$/.test(value);
const canonicalTask = (value) => typeof value === 'string' && value.length <= MAX_ID
  && /^\/root\/[a-z0-9_]+(?:\/[a-z0-9_]+)*$/.test(value);
const relativeTask = (value) => typeof value === 'string' && /^[a-z0-9_]+$/.test(value);
const field = (value, key) => {
  if (!object(value)) return undefined;
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  return descriptor && own(descriptor, 'value') ? descriptor.value : undefined;
};

/**
 * M33 T. Codex records a hand-off's `message` as one encrypted token (Fernet-style, "gAAAAA…"): no whitespace,
 * at least 100 characters of the base64url alphabet, optionally `=`-padded, opening with the shape of a Codex
 * token (one lowercase letter, then three uppercase). Such a value carries no readable brief, and
 * it is not a secret the session wrote either — it is the RECORDER's encryption of the brief.
 *
 * The shape alone also fits readable words with no spaces (`fix_the_parser_…`, `iOSAppFix…`), which are a brief.
 * So a token must also be as unreadable as the redactor's own entropy floor (redact ENTROPY_MIN, the backstop
 * that drops an unclassified high-entropy token). That makes every value called encrypted here one that
 * redaction would have dropped whole anyway: no brief the code before this rule showed is ever lost to it. Any
 * other value — whitespace, shorter, another alphabet or opening, or readable — is plaintext and stays agent
 * prose for redaction.
 */
const ENCRYPTED_BRIEF = /^[a-z][A-Z]{3}[A-Za-z0-9_-]{96,}={0,2}$/;
export const isEncryptedBrief = (value) => typeof value === 'string' && ENCRYPTED_BRIEF.test(value)
  && entropy(value) >= ENTROPY_MIN;

function parentInstruction(use, adapter) {
  const name = field(use, 'name');
  const input = field(use, 'input');
  const key = adapter === 'claude' ? 'prompt' : 'message';
  if (!object(input) || typeof field(input, key) !== 'string') return null;
  // The brief exists, but only the recorder can read it: record that fact and never the token — not as
  // text, not hashed, not printed. Codex only: another adapter's brief of this shape is text redaction judges.
  if (adapter === 'codex' && isEncryptedBrief(field(input, key))) return { tool: name, field: key, encrypted: true };
  return { text: field(input, key), tool: name, field: key };
}

/** M33 F. Is this exact Codex name a follow-up hand-off (more work for an existing helper), not a spawn? */
export const isCodexFollowup = (name) => typeof name === 'string' && FOLLOWUP_NAMES.includes(name);

/** Shared exact-name check for adapters before they normalize tool records. */
export function isDelegationTool(name, adapter) {
  return typeof adapter === 'string' && own(SPAWN_NAMES, adapter)
    && typeof name === 'string' && (SPAWN_NAMES[adapter].includes(name) ||
      (adapter === 'codex' && FOLLOWUP_NAMES.includes(name)));
}

/**
 * The child identity Claude Code writes into the Agent/Task tool RESULT, as a line of its own:
 * `agentId: <id>`. Anchored at the start of a line on purpose — a report that
 * quotes the words "agentId: …" mid-sentence is a transcript, not a receipt, and precision here
 * costs a reviewer nothing while a wrong link would attach another session's work to this one.
 * Two DIFFERENT ids in one result are ambiguous; the same id repeated is one identity.
 * C-03 M33 D: the id is 16 lowercase hex (older recordings) or `a` + 16 lowercase hex, which is
 * the id Claude Code 2.1.121–2.1.284 writes (in a receipt, and as every `agent-<id>.jsonl`). A
 * child recording writes no result sidecar, so this line is the only carrier of a grandchild's id.
 */
const AGENT_ID_LINE = /^[ \t]*agentId:[ \t]*([0-9a-f]{16}|a[0-9a-f]{16})(?![0-9a-zA-Z_-])/gm;
const AMBIGUOUS = Symbol('ambiguous child identity');
function agentIdLine(value) {
  if (typeof value !== 'string' || value.length > MAX_RESULT) return undefined;
  AGENT_ID_LINE.lastIndex = 0;
  const found = new Set();
  for (const match of value.matchAll(AGENT_ID_LINE)) found.add(match[1]);
  if (found.size > 1) return AMBIGUOUS;
  return found.size === 1 ? [...found][0] : undefined;
}

/**
 * M33 P. The one agentId a Claude Agent/Task result names on its receipt line (`agentIdLine`, the M33 D child
 * identity), or null when it names none or two different ones. A background launch's native id: the id its later
 * typed task notification must name beside the call's own id.
 */
export function recordedAgentId(value) {
  const id = agentIdLine(value);
  return typeof id === 'string' ? id : null;
}

function structuredResult(value) {
  if (typeof value === 'string') {
    if (value.length > MAX_RESULT) return null;
    // Parse the whole value only. Fences, explanatory prose and text blocks are
    // not structured identity, even when they contain JSON-looking fragments.
    // C-02: a repeated key (two agent_id values, say) is not one identity either.
    const decoded = strictJson(value);
    if (!decoded.strict) return null;
    value = decoded.value;
  }
  return object(value) ? value : null;
}

/**
 * Pure root-record detector. `use` is an actual normalized tool-use block;
 * `result` is its correlated {callId, value, isError?} envelope. If multiple
 * results matched, pass those envelopes as an array to preserve ambiguity.
 * The caller must
 * preserve the original call ID on both sides (not a rewritten code-event ID).
 * A supported call always remains unresolved unless its matched result reports
 * an explicit failure. Even a proven child ID leaves child coverage UNCHECKED.
 */
export function detectDelegation(use, result, context = {}) {
  const adapter = field(context, 'adapter');
  if (field(use, 'type') !== 'tool_use' || !isDelegationTool(field(use, 'name'), adapter)) return null;

  const id = field(use, 'id');
  const instruction = parentInstruction(use, adapter);
  const turn = field(context, 'turn');
  const source = field(context, 'source');
  const descriptor = {
    adapter,
    callId: identity(id) ? id : null,
    turn: Number.isSafeInteger(turn) && turn >= 0 ? turn : null,
    childId: null,
    status: 'unresolved',
    reason: DELEGATION_REASONS.CHILD_UNCHECKED,
    ...(instruction ? { parentInstruction: instruction } : {}),
    ...(source !== undefined ? { source: Number.isSafeInteger(source) && source >= 0 ? source : null } : {}),
    ...(Number.isSafeInteger(field(context, 'record')) && field(context, 'record') > 0 ? { record: field(context, 'record') } : {}),
    // C-01 event identity: where the recorder wrote the hand-off's call (event-identity.js), carried as recorded.
    ...(validIdentity(field(context, 'identity')) ? { identity: { ...field(context, 'identity') } } : {}),
  };
  // D68 (C-02 "M36 recorded facts"): a Claude Code Agent call's one matched result sidecar types its status and how many
  // tools the helper used; carried as recorded, beside the recorder's tool name, whatever the result proves.
  if (adapter === 'claude' && object(result) && field(result, 'callId') === id) {
    const facts = claudeAgentFacts(field(use, 'name'), field(result, 'value'));
    if (facts) descriptor.recorded = facts;
  }
  if (source !== undefined && descriptor.source === null) return { ...descriptor, reason: DELEGATION_REASONS.SOURCE_INVALID };
  if (descriptor.turn === null) return { ...descriptor, reason: DELEGATION_REASONS.TURN_INVALID };
  if (descriptor.callId === null) return { ...descriptor, reason: DELEGATION_REASONS.CALL_INVALID };
  if (result == null) return { ...descriptor, reason: DELEGATION_REASONS.RESULT_MISSING };
  if (Array.isArray(result) && result.filter((r) => field(r, 'callId') === id).length > 1) {
    return { ...descriptor, reason: DELEGATION_REASONS.RESULT_AMBIGUOUS };
  }
  if (!object(result)) return { ...descriptor, reason: DELEGATION_REASONS.RESULT_MALFORMED };
  if (field(result, 'callId') !== id) return { ...descriptor, reason: DELEGATION_REASONS.RESULT_UNMATCHED };
  const isError = field(result, 'isError');
  if (isError === true) return { ...descriptor, status: 'failed', reason: DELEGATION_REASONS.SPAWN_FAILED };
  if (isError !== undefined && isError !== false) return { ...descriptor, reason: DELEGATION_REASONS.RESULT_MALFORMED };

  // A follow-up starts more child work, but its target can be a display name or task path.
  // Neither that input nor an echo of it establishes a child recording's identity.
  if (adapter === 'codex' && FOLLOWUP_NAMES.includes(field(use, 'name'))) {
    const target = field(field(use, 'input'), 'target');
    return canonicalTask(target) || relativeTask(target) ? { ...descriptor, kind: 'followup', target }
      : { ...descriptor, kind: 'followup', reason: DELEGATION_REASONS.RESULT_MALFORMED };
  }

  const raw = field(result, 'value');
  const value = structuredResult(raw);
  const structured = field(value, CHILD_FIELDS[adapter]);
  // B2: Claude's Agent/Task result is PROSE. The identity of the child it launched appears only
  // as the receipt line `agentId: <16 hex>`, so for that adapter the line is the transport and
  // reading it is not inference. Codex keeps its structured-only rule: there `agent_id` is a
  // real field, and prose that looks like one is an echo, not an identity.
  const spoken = structured === undefined && adapter === 'claude' ? agentIdLine(raw) : undefined;
  if (spoken === AMBIGUOUS) return { ...descriptor, reason: DELEGATION_REASONS.CHILD_AMBIGUOUS };
  const childId = structured === undefined ? spoken : structured;
  const task = adapter === 'codex' ? field(value, 'task_name') : undefined;
  if (childId !== undefined && !identity(childId)) return { ...descriptor, reason: DELEGATION_REASONS.RESULT_MALFORMED };
  if (task !== undefined && !canonicalTask(task)) return { ...descriptor, reason: DELEGATION_REASONS.RESULT_MALFORMED };
  if (!identity(childId) && !canonicalTask(task)) return { ...descriptor, reason: DELEGATION_REASONS.RESULT_MALFORMED };
  // C-03 M33 D: a Claude hand-off carries the sessionId its own tool_use AND result rows recorded
  // (the caller supplies it only when both agree). A resumed recording has no single file identity;
  // this recorded value, not the file's, is what its child's recorded sessionId must equal.
  const sessionId = adapter === 'claude' && identity(field(context, 'sessionId')) ? field(context, 'sessionId') : undefined;
  return { ...descriptor, ...(identity(childId) ? { childId } : {}),
    ...(sessionId !== undefined ? { sessionId } : {}),
    // Only a matched, explicitly non-error spawn result may certify the no-fork invocation.
    ...(adapter === 'codex' && SPAWN_NAMES.codex.includes(field(use, 'name'))
      && isError === false && field(field(use, 'input'), 'fork_turns') === 'none'
      ? { forkTurns: 'none' } : {}),
    ...(canonicalTask(task) ? { kind: 'spawn', taskName: task } : {}) };
}

/**
 * Batch detection adds ambiguity checks within a source recording and adapter.
 * Entries are {use, result, adapter, turn, source?, record?}; unsupported calls still
 * participate in duplicate-call checks so their result cannot identify a spawn.
 */
export function detectDelegations(entries) {
  return detectDelegationRows(entries).map((row) => row.descriptor);
}

/**
 * M33 F. `detectDelegations`, row by row: each supported hand-off's `entry`, its `detected` descriptor as the
 * call and its own result record it (before the batch ambiguity checks null any identity), and its final
 * `descriptor` (what `detectDelegations` returns, in the same order). The final-answer join (inter-agent.js) reads
 * the task path a hand-off recorded from the first two; nothing else is exported from them.
 */
export function detectDelegationRows(entries) {
  if (!Array.isArray(entries)) return [];
  const callCounts = new Map();
  const rows = [];
  for (const entry of entries) {
    const adapter = field(entry, 'adapter');
    const use = field(entry, 'use');
    const callId = field(use, 'id');
    if (typeof adapter === 'string' && own(SPAWN_NAMES, adapter) && field(use, 'type') === 'tool_use' && identity(callId)) {
      const key = JSON.stringify([field(entry, 'source') ?? 0, adapter, callId]);
      callCounts.set(key, (callCounts.get(key) ?? 0) + 1);
    }
    const descriptor = detectDelegation(use, field(entry, 'result'), entry);
    if (descriptor) rows.push({ entry, detected: descriptor });
  }
  const descriptors = rows.map((row) => row.detected);
  const childCounts = new Map();
  const taskCounts = new Map();
  for (const descriptor of descriptors) {
    if (descriptor.childId) {
      const key = JSON.stringify([descriptor.source ?? 0, descriptor.adapter, descriptor.childId]);
      childCounts.set(key, (childCounts.get(key) ?? 0) + 1);
    }
    if (descriptor.kind === 'spawn' && descriptor.taskName) {
      const taskKey = JSON.stringify([descriptor.source ?? 0, descriptor.adapter, descriptor.taskName]);
      taskCounts.set(taskKey, (taskCounts.get(taskKey) ?? 0) + 1);
    }
  }
  const disambiguated = (descriptor) => {
    if (descriptor.callId && callCounts.get(JSON.stringify([descriptor.source ?? 0, descriptor.adapter, descriptor.callId])) > 1) {
      return { ...descriptor, childId: null, taskName: null, target: null,
        status: 'unresolved', reason: DELEGATION_REASONS.CALL_AMBIGUOUS };
    }
    if (descriptor.childId && childCounts.get(JSON.stringify([descriptor.source ?? 0, descriptor.adapter, descriptor.childId])) > 1) {
      return { ...descriptor, childId: null, taskName: null, target: null,
        status: 'unresolved', reason: DELEGATION_REASONS.CHILD_AMBIGUOUS };
    }
    if (descriptor.taskName && taskCounts.get(JSON.stringify([descriptor.source ?? 0, descriptor.adapter, descriptor.taskName])) > 1) {
      return { ...descriptor, childId: null, taskName: null, target: null,
        status: 'unresolved', reason: DELEGATION_REASONS.CHILD_AMBIGUOUS };
    }
    return descriptor;
  };
  return rows.map((row) => ({ ...row, descriptor: disambiguated(row.detected) }));
}
