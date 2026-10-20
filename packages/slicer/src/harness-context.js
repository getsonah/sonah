// The element structure of recorded user text: whether a text is only top-level elements, whether it opens with one, and
// the recorder's own command elements.
//
// M34 labels (C-02 "Slice-time labels"): no reader decides from these which record is a human's by a list of tag
// names. The slicer labels every record once, from the recorder's structure (labels.js; records.js `claudeLabeller`,
// codex.js `labelCodexRecords`); these shape rules serve only where that structure IS the recorder's element format —
// a prompt command's own elements (`recorderCommand`), the declared legacy fallback's "opens with an element"
// (`startsWithElement`), and a modern Claude Code row with no origin that is only elements (a local command's own rows)
// or a Codex rollout with no typed channel (`isWhollyElements`), and (D120) the recorder's own caveat before a local
// command (`isLocalCommandCaveat`), which with the output row it types closes a local command. The tag lists the role guessers read
// (`SLASH_COMMAND_TAGS`, `LOCAL_COMMAND_OUTPUT_TAGS`, `EMBEDDED_CONTEXT_TAGS`) and their span reader
// (`contextElementSpans`) are deleted with them. Pure: no I/O, no clock, no model.

/** Attributes an opening tag may carry without a value: Codex writes `<permissions instructions>`. */
const BARE_ATTRIBUTES = Object.freeze(['instructions']);
/** One attribute in attribute syntax only: a name with a quoted value (no `<` or `>` in it), or a bare attribute
 *  the list names. Any other word in a tag (`<apps please fix it>`) is not a tag's: the message is a human's. */
const ATTRIBUTE = `\\s+(?:[A-Za-z_][A-Za-z0-9_.:-]*\\s*=\\s*(?:"[^"<>]*"|'[^'<>]*')|(?:${BARE_ATTRIBUTES.join('|')})(?=[\\s/>]))`;
/** An opening tag, from `at`: a name of letters, digits, `_` and `-`, attributes, and `/` when it closes itself. */
const OPENING_TAG = new RegExp(`<([A-Za-z_][A-Za-z0-9_-]*)(?:${ATTRIBUTE})*\\s*(/?)>`, 'y');
/** Every tag of one name: `</name>` (1: `/`), or an opening tag in the same syntax (2: `/` when it closes itself). */
const tagsNamed = (name) => new RegExp(`<(?:(/)${name}\\s*|${name}(?:${ATTRIBUTE})*\\s*(/?))>`, 'g');

/**
 * The top-level elements of a text made ONLY of elements, whitespace between them allowed, as
 * `[{ name, inner }]`; null when any other text is outside an element, a tag is not in tag syntax or is left
 * unclosed, or the text holds no element. An element runs from its opening tag to the closing tag of the same name
 * that brings the count of that name's open tags back to zero (a self-closing one of that name inside it is not
 * counted); a self-closing top-level tag is an element with no inner text.
 */
function topLevelElements(text) {
  const elements = [];
  let at = 0;
  for (;;) {
    while (at < text.length && /\s/.test(text[at])) at++;
    if (at === text.length) return elements.length ? elements : null;
    OPENING_TAG.lastIndex = at;
    const open = OPENING_TAG.exec(text);
    if (!open) return null;
    if (open[2]) {
      elements.push({ name: open[1], inner: '' });
      at += open[0].length;
      continue;
    }
    const tags = tagsNamed(open[1]);
    tags.lastIndex = at;
    let depth = 0, close = null;
    for (let tag; !close && (tag = tags.exec(text));) {
      if (tag[2]) continue;
      depth += tag[1] ? -1 : 1;
      if (depth === 0) close = tag;
    }
    if (!close) return null;
    elements.push({ name: open[1], inner: text.slice(at + open[0].length, close.index) });
    at = close.index + close[0].length;
  }
}

/**
 * M33 U repair (OWNER DECISION B, 2026-10-01); M5. Whether a text is ONLY top-level
 * elements (whitespace between them allowed), whatever their names — harness context, a teammate's, an agent's or a
 * hook's message, a slash command's parts. Such a text is not provably a human's own words. M34 labels: the one
 * structural rule a labeller with no typed origin to go by reads — a Claude Code row of a typed recorder with no origin
 * (a local command's own rows, `LABEL_BASIS.untypedElements`) and a Codex message of a rollout with no typed human
 * channel (the declared legacy fallback, counted as `LABEL_GAPS.legacyRecorder`) are harness by it.
 */
export function isWhollyElements(text) {
  return topLevelElements(String(text ?? '').trim()) !== null;
}

/**
 * M34 labels (C-02 "Slice-time labels"). Whether a text OPENS with an element in tag syntax (whitespace before it
 * allowed), whatever its name: the structure the declared legacy fallback reads — a recorder before 2.1.219 writes its
 * own rows (a command's parts, a local command's output, a notification) as elements, and records no origin. Pure.
 */
export function startsWithElement(text) {
  const s = String(text ?? '');
  let at = 0;
  while (at < s.length && /\s/.test(s[at])) at++;
  OPENING_TAG.lastIndex = at;
  return OPENING_TAG.exec(s) !== null;
}

/**
 * M34 labels (C-02 "Slice-time labels"). The elements Claude Code writes a prompt command's invocation row as — its
 * name, its message, the arguments the human typed and (2.1.255 and later, where the row is `isMeta` and records no
 * arguments) its skill format. The recorder's own structured format, read as structure: a closed list, compared exactly.
 */
export const RECORDER_COMMAND_ELEMENTS = Object.freeze(['command-name', 'command-message', 'command-args', 'skill-format']);

/**
 * M34 labels. A command invocation row, read by structure: when the trimmed text is ONLY top-level elements named in
 * `RECORDER_COMMAND_ELEMENTS`, none repeated and exactly one `command-name`, `{ name, args }` — the inner text of its
 * `command-name` element and of its `command-args` element (trimmed; null when the row records no `command-args`
 * element at all). Null for any other text.
 */
/**
 * M34 labels (C-02 "Slice-time labels"); moved here from events.js by the M34 labels review (F5), so the labeller links a
 * notification when it labels it. The call id a Claude Code task notification carries: the inner text of its one
 * `tool-use-id` element — the recorder's own structured notification format, read as structure — or null when the text
 * carries none or more than one. Only links the notification to the call it reports on (events.js
 * `claudeTaskNotification` keeps its own, stricter status join). Which rows carry a notification is decided by
 * `claudeNotificationCarrier` below, for every reader alike.
 */
export function recorderNotificationCallId(text) {
  if (typeof text !== 'string') return null;
  const ids = [...text.matchAll(/<tool-use-id>\s*([^<\s]+)\s*<\/tool-use-id>/g)];
  return ids.length === 1 ? ids[0][1] : null;
}

/** The kind the recorder writes on both carriers of a task notification: an origin's `kind` and a queued command's
 *  `commandMode`. */
export const TASK_NOTIFICATION_KIND = 'task-notification';
const plainRow = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
/** An origin of the task-notification kind: an object whose `kind` is that kind. Any other key beside it (Claude Code
 *  2.1.284 and later write `producer` and `runId`) is the recorder's metadata, never part of the test. */
const notificationOrigin = (origin) => plainRow(origin) && origin.kind === TASK_NOTIFICATION_KIND;
/** D99 (F1 guard): the keys a known recorder writes on a task notification's origin (`kind`; Claude Code 2.1.284 and
 *  later `producer` and `runId`). Any other key is accepted all the same (D98) and logged by the recorder census. */
export const NOTIFICATION_ORIGIN_KEYS = Object.freeze(['kind', 'producer', 'runId']);
/** D99: the origin a carrier of a task notification records (a user row's, or a queued command's), or null. */
export function notificationOriginOf(row) {
  const origin = row?.type === 'user' ? row.origin : row?.type === 'attachment' ? row.attachment?.origin : undefined;
  return plainRow(origin) ? origin : null;
}

/**
 * One reading per recorder fact (F1, D98): whether a Claude Code row carries a task notification, and the text it
 * carries, by the recorder's own kind field only. Every reader of this fact calls it: the labeller (records.js
 * `claudeLabeller`), the reader that keeps a queued notification as a record of its own (records.js `readSession`)
 * and the status join (events.js `claudeTaskNotification`), so a row is a notification for one exactly when it is
 * one for the others.
 *   - a `user` row whose `origin` is of the task-notification kind: its message content;
 *   - a `queued_command` attachment whose `commandMode` is that kind and whose `origin`, if recorded, is that kind too
 *     (an origin of another kind contradicts the mode: the row is no notification): its `prompt`.
 * `{ text }`, the text as recorded (not always a string), or null. Each reader reads the text's own format as it needs
 * it (the call id that links it, the header the status join reads); never its words.
 */
export function claudeNotificationCarrier(row) {
  if (!plainRow(row)) return null;
  if (row.type === 'user') return notificationOrigin(row.origin) ? { text: row.message?.content } : null;
  const item = row.type === 'attachment' ? row.attachment : null;
  if (!plainRow(item) || item.type !== 'queued_command' || item.commandMode !== TASK_NOTIFICATION_KIND) return null;
  return item.origin === undefined || notificationOrigin(item.origin) ? { text: item.prompt } : null;
}

export function recorderCommand(text) {
  const elements = topLevelElements(String(text ?? '').trim());
  if (elements === null || !elements.every((element) => RECORDER_COMMAND_ELEMENTS.includes(element.name))) return null;
  const names = elements.map((element) => element.name);
  if (new Set(names).size !== names.length || !names.includes('command-name')) return null;
  const args = elements.find((element) => element.name === 'command-args');
  return { name: elements.find((element) => element.name === 'command-name').inner.trim(),
    args: args === undefined ? null : args.inner.trim() };
}

/**
 * D120 (owner 2026-10-18, DF3 part 1): the element Claude Code writes its own caveat row as, just before a local command
 * (a command the person runs in the harness itself; the recorder chains it between that caveat and its output, a
 * `system` row it types with `LOCAL_COMMAND_OUTPUT_SUBTYPE`). The recorder's own structured format, read as structure
 * and compared exactly; no command's name is read.
 */
export const RECORDER_LOCAL_COMMAND_CAVEAT = 'local-command-caveat';
/** D120: the subtype Claude Code types a local command's output row with (a `system` row). */
export const LOCAL_COMMAND_OUTPUT_SUBTYPE = 'local_command';
/** D120: whether a text is only the recorder's local-command caveat: exactly one top-level element, of that name. */
export function isLocalCommandCaveat(text) {
  const elements = topLevelElements(String(text ?? '').trim());
  return elements !== null && elements.length === 1 && elements[0].name === RECORDER_LOCAL_COMMAND_CAVEAT;
}
