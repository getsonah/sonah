// M33 F (helper final answers). Codex inter-agent messages, read by their recorded header only.
//
// Codex records a message between agents as a `response_item` of type `agent_message`
// { author, recipient, content, id, internal_chat_message_metadata_passthrough }. Its one readable block opens with
// a fixed header, then the payload:
//
//   Message Type: <TYPE>\nTask name: <task path>\nSender: <path>\nPayload:\n<payload>
//
// NEW_TASK and MESSAGE carry an EMPTY readable payload: the recorder encrypted the real one into an
// `encrypted_content` block, which this reader never keeps, hashes or prints. FINAL_ANSWER carries the helper's final
// report to its parent in plaintext — what the parent received, a harness error notice included.
//
// Which line names whom (M33 F repair): `Task name` is the RECIPIENT's task path — the row's `recipient` — and
// `Sender` is the AUTHOR's — the row's `author`. A helper's report in its parent's recording therefore
// reads `Task name: /root` (the parent) and `Sender: /root/<helper>`; the helper's path is on the Sender line only.
//
// A FINAL_ANSWER becomes the RESULT of the one hand-off it belongs to, joined by exact recorded identity only: its
// Sender (confirmed by the row's author) must equal the task path recorded for exactly one hand-off of the same
// recording, and its Task name (confirmed by the row's recipient) must equal that recording's own recorded task path.
// Never by position, time, order, resemblance or a fuzzy name — order can only refuse a join the recording disproves (a
// report received before the one hand-off it names). Zero candidates, several, or one hand-off answered twice: not
// attached, and counted under a closed reason. Deterministic: no clock, no model, no network.

import { detectDelegationRows, isCodexFollowup } from './delegation.js';
import { codexTaskPath, codexOwnTaskPath } from './child-links.js';
import { ARRIVAL_MESSAGE_TYPES } from './helper-deliveries.js';

/** The closed list of message types this reader knows. Any other type stays unparsed and counted. */
export const INTER_AGENT_MESSAGE_TYPES = Object.freeze(['NEW_TASK', 'MESSAGE', 'FINAL_ANSWER']);

/**
 * The closed capture counters, one per way an inter-agent message is handled. Every `agent_message` row a recording
 * holds (other than a repeated-key row, which stays in the generic unsupported inventory) lands in exactly one:
 *   unparsed     — not the exact recorded shape, or a message type outside the closed list;
 *   encrypted    — a known message type whose payload the recorder encrypted (every NEW_TASK and MESSAGE);
 *   attributed   — a helper's final report attached as the result of the one hand-off it belongs to;
 *   unattributed — a final report no hand-off of its recording matched by its recorded sender and recipient: its
 *                  sender names none, a header line disagrees with the row, it was addressed to another agent than
 *                  the recording's own, the recording's own path is not recorded, the one hand-off its sender names
 *                  was recorded after it, or the recording's history was withheld whole, so no hand-off was read;
 *   ambiguous    — a final report more than one hand-off could own, one of several reports to one hand-off, or a
 *                  report to a hand-off whose path a report recorded before that hand-off also named.
 * `interAgentMessagesUnparsed` keeps its name and meaning for every row that is still unread; the others are carried
 * only when they are not zero, so a recording without such rows keeps its bytes.
 */
export const INTER_AGENT_COUNTS = Object.freeze({
  unparsed: 'interAgentMessagesUnparsed',
  encrypted: 'interAgentMessagesEncrypted',
  attributed: 'interAgentFinalAnswersAttributed',
  unattributed: 'interAgentFinalAnswersUnattributed',
  ambiguous: 'interAgentFinalAnswersAmbiguous',
});
/** The counters that are a loss of communication evidence. An attributed report is evidence, not a loss. */
export const INTER_AGENT_LOSS_COUNTS = Object.freeze([INTER_AGENT_COUNTS.unparsed, INTER_AGENT_COUNTS.encrypted,
  INTER_AGENT_COUNTS.unattributed, INTER_AGENT_COUNTS.ambiguous]);
/** The closed reasons a final report is, or is not, attached (each counted by its `INTER_AGENT_COUNTS` member). */
export const FINAL_ANSWER_ATTRIBUTION = Object.freeze({
  attributed: 'attributed', unattributed: 'unattributed', ambiguous: 'ambiguous',
});

/*
 * A report is kept WHOLE here, exactly as the row recorded its payload. The slicer never cuts it: redaction scrubs the
 * whole report as tool output and, since D68 (E), bounds nothing: a helper's report is what it produced, kept whole.
 * A cut made before redaction would hand the redactor a tail whose secret-named key or key-block header was cut away
 * (M33 F placement / redaction repair).
 */

/** The record kind the Codex reader emits for a final report, joined in `collectDelegationEvidence`. */
export const AGENT_REPORT_RECORD = 'agent_report';

const ROW_FIELDS = Object.freeze(['type', 'author', 'recipient', 'content', 'id',
  'internal_chat_message_metadata_passthrough']);
const HEADER = /^Message Type: ([^\r\n]+)\nTask name: ([^\r\n]+)\nSender: ([^\r\n]+)\nPayload:\n/;
const UNPARSED = Object.freeze({ type: 'unparsed' });
const plain = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const keysWithin = (value, names) => plain(value) && Object.keys(value).every((key) => names.includes(key));
const encryptedBlock = (block) => plain(block) && block.type === 'encrypted_content'
  && keysWithin(block, ['type', 'encrypted_content'])
  && typeof block.encrypted_content === 'string' && block.encrypted_content.length > 0;
const readableBlock = (block) => plain(block) && block.type === 'input_text';

/**
 * One `agent_message` payload, read by its exact recorded shape: `{ type: 'final_answer', sender, recipient, text }`
 * for a helper's plaintext final report, `{ type: 'encrypted', messageType }` for a message whose payload the recorder
 * encrypted, `{ type: 'unparsed' }` for anything else. Nothing of an encrypted block is ever returned. `sender` is the
 * header's Sender line only when the row's own `author` records exactly the same path, and `recipient` its Task name
 * line only when the row's own `recipient` does; otherwise that side is `null`, and the report can join no hand-off.
 */
export function readAgentMessage(payload) {
  if (!plain(payload) || payload.type !== 'agent_message' || !keysWithin(payload, ROW_FIELDS)
    || !Array.isArray(payload.content)) return UNPARSED;
  const readable = payload.content.filter(readableBlock);
  const encrypted = payload.content.filter(encryptedBlock).length;
  if (readable.length !== 1 || readable.length + encrypted !== payload.content.length) return UNPARSED;
  const [block] = readable;
  if (!keysWithin(block, ['type', 'text']) || typeof block.text !== 'string') return UNPARSED;
  const match = HEADER.exec(block.text);
  if (!match || !INTER_AGENT_MESSAGE_TYPES.includes(match[1])) return UNPARSED;
  const text = block.text.slice(match[0].length);
  if (text === '') return encrypted > 0 ? { type: 'encrypted', messageType: match[1] } : UNPARSED;
  if (match[1] !== 'FINAL_ANSWER' || !text.trim()) return UNPARSED;
  return { type: 'final_answer', sender: payload.author === match[3] ? match[3] : null,
    recipient: payload.recipient === match[2] ? match[2] : null, text };
}

/**
 * M33 P. An encrypted NEW_TASK or MESSAGE row read as an ARRIVAL: the work a helper received. Exactly one readable
 * header block with an empty payload, exactly one `encrypted_content` block, nothing else, and a Task name line equal
 * to the row's own `recipient` (the helper the row is addressed to). Returns `{ recipient, token }` — the token only
 * for the exact join to the one parent send that recorded the same bytes (helper-deliveries.js), in memory: it is
 * never stored, hashed or printed. Anything else is no arrival (null); the row is still counted as encrypted.
 */
export function agentMessageArrival(payload) {
  if (!plain(payload) || payload.type !== 'agent_message' || !keysWithin(payload, ROW_FIELDS)
    || !Array.isArray(payload.content)) return null;
  const readable = payload.content.filter(readableBlock);
  const encrypted = payload.content.filter(encryptedBlock);
  if (readable.length !== 1 || encrypted.length !== 1 || payload.content.length !== 2) return null;
  const [block] = readable;
  if (!keysWithin(block, ['type', 'text']) || typeof block.text !== 'string') return null;
  const match = HEADER.exec(block.text);
  if (!match || !ARRIVAL_MESSAGE_TYPES.includes(match[1]) || block.text.length !== match[0].length) return null;
  if (typeof payload.recipient !== 'string' || payload.recipient !== match[2]) return null;
  return { recipient: match[2], token: encrypted[0].encrypted_content };
}

/**
 * The task path a hand-off recorded, exactly as Codex nests it (child-links.js `codexTaskPath`), or `null` when it
 * recorded none that can be read exactly. A follow-up names its target. A spawn names the canonical path its own
 * result recorded, else the task name its call recorded, nested under the recording's own recorded path; when both
 * are recorded and disagree, it names no single path.
 */
function handOffPath(entry, detected, identity) {
  const use = entry.use ?? {};
  const input = plain(use.input) ? use.input : {};
  if (isCodexFollowup(use.name)) return codexTaskPath(input.target, identity);
  const recorded = typeof detected.taskName === 'string' && codexTaskPath(detected.taskName, null) === detected.taskName
    ? detected.taskName : null;
  const called = typeof input.task_name === 'string' ? codexTaskPath(input.task_name, identity) : null;
  if (recorded !== null && called !== null && recorded !== called) return null;
  return recorded ?? called;
}

/**
 * M33 F repair 3. Order never makes a join; it can only refuse one. A report its own recording places before the
 * hand-off its sender names — on a row not after the hand-off's row, or in an earlier human turn, each compared only
 * when both are recorded as counts — was received before that hand-off was made, so it cannot be that hand-off's.
 */
const counted = (value) => Number.isSafeInteger(value) && value >= 0;
const recordedBefore = (report, entry) =>
  (counted(report.record) && counted(entry?.record) && report.record <= entry.record)
  || (counted(report.turn) && counted(entry?.turn) && report.turn < entry.turn);

/**
 * The hand-offs of `records` (delegation-records.js entries), with each helper's final report attached to the one
 * hand-off it belongs to. Per recording (`source`): every hand-off that was not refused (`status: 'failed'`, an
 * explicit tool error: it started no helper) is a candidate, by the task path it recorded (`handOffPath`); one that
 * recorded no readable path could be any helper's. A report is unattributed when its sender or recipient is not
 * confirmed by its row (`readAgentMessage`), when its recipient is not the recording's own recorded task path
 * (`codexOwnTaskPath`: it was addressed to another agent, or the recording cannot say who it is), when its sender
 * equals no candidate's path, or when the one candidate its sender names was recorded after it (`recordedBefore`: no
 * hand-off recorded before it matched it). One whose sender equals exactly one candidate's, with no path-less
 * candidate beside it, and recorded after that candidate, claims that hand-off; a report equal to several, or beside a
 * path-less candidate, is ambiguous, as is every report of a hand-off claimed twice, and every report of a hand-off an
 * earlier report already named (a helper answered to that path before this hand-off was made, so a later report could
 * be either's). Returns the final descriptors (a `finalAnswer: { text, record, turn }` on an attributed one: the whole
 * report, and the row and human turn of its own recording where the parent RECEIVED it, which place it in the review —
 * never the hand-off's) and the counts.
 */
export function attributeFinalAnswers(entries, reports, sources = []) {
  const rows = detectDelegationRows(entries);
  const counts = { attributed: 0, unattributed: 0, ambiguous: 0 };
  const bySource = new Map();
  const identities = Array.isArray(sources) ? sources : [];
  const of = (source) => {
    if (!bySource.has(source)) bySource.set(source, { own: codexOwnTaskPath(identities[source]), paths: new Map(),
      unnamed: 0, reports: [] });
    return bySource.get(source);
  };
  rows.forEach(({ entry, detected, descriptor }, index) => {
    if (entry.adapter !== 'codex' || descriptor.status === 'failed') return;
    const source = entry.source ?? 0;
    const path = handOffPath(entry, detected, identities[source]);
    const scope = of(source);
    if (path === null) { scope.unnamed++; return; }
    if (!scope.paths.has(path)) scope.paths.set(path, []);
    scope.paths.get(path).push(index);
  });
  for (const report of reports) of(report.source ?? 0).reports.push(report);
  const claims = new Map();
  const preceded = new Set();
  for (const scope of bySource.values()) {
    for (const report of scope.reports) {
      const received = typeof report.recipient === 'string' && scope.own !== null && report.recipient === scope.own;
      const matches = received && typeof report.sender === 'string' ? scope.paths.get(report.sender) ?? [] : [];
      if (!matches.length) counts.unattributed++;
      else if (matches.length > 1 || scope.unnamed > 0) counts.ambiguous++;
      else if (recordedBefore(report, rows[matches[0]].entry)) {
        counts.unattributed++;
        preceded.add(matches[0]);
      } else {
        if (!claims.has(matches[0])) claims.set(matches[0], []);
        claims.get(matches[0]).push(report);
      }
    }
  }
  const descriptors = rows.map((row) => row.descriptor);
  for (const [index, claimed] of claims) {
    if (claimed.length !== 1 || preceded.has(index)) { counts.ambiguous += claimed.length; continue; }
    const [report] = claimed;
    descriptors[index] = { ...descriptors[index], finalAnswer: { text: report.text, record: report.record,
      ...(Number.isSafeInteger(report.turn) && report.turn >= 0 ? { turn: report.turn } : {}) } };
    counts.attributed++;
  }
  return { delegations: descriptors, counts };
}
