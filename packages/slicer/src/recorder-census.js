// D99 (F1 guard; labels.js RECORDER_CENSUS_REASONS): the recorder census of one lineage.
//
// What a reader of a recorder fact met and another could not read, each counted once under its closed reason with the
// recorder version of its row. Pure: counts only, no text of any row. Deterministic: the same records give the same
// census, its entries in code-unit order.

import { partsOf, LABEL_BASIS, RECORDER_CENSUS_REASONS, CENSUS_KEY_SHAPE, BACKGROUND_RUN_KINDS } from './labels.js';
import { taskNotificationRead, BACKGROUND_ENDS, COMMAND_STATUS_SOURCES } from './events.js';
import { notificationOriginOf, NOTIFICATION_ORIGIN_KEYS } from './harness-context.js';

/**
 * The census of one lineage:
 *   notices   the Claude rows the labeller labelled a task notification and the status join's own reading
 *             (events.js `taskNotificationRead`) also takes for one (`labelled`, a row copied from another file of the
 *             lineage counted once), those the join typed (`typed`), and every other one under the first test of the
 *             join it failed: labelled - typed = the sum of the `notification_*` entries. A row the labeller and the
 *             join disagree on (one takes it for a task notification, the other not) is counted once, as a
 *             `reader_disagreement` entry only, and is not in `labelled` (reader agreement: none such). D99: the
 *             census reads every row the labeller labelled, kept as a record or only counted (`counted`), so a row
 *             it labelled a task notification and no reader kept as a record — which the status join therefore never
 *             read, whichever carrier — is a `reader_disagreement` too, never a row counted nowhere;
 *   launches  the Claude Bash results that record a background task id (`background`), by how their end was read:
 *             `typed` (a completion or failure joined), `stopped` (stopped or killed), `unread` (an `end_unread_*`
 *             entry of kind `bash` each, marked `unread` or `unchecked`), `absent` (code proved the recording holds no end) and `other` (an end of
 *             their own: an error flag, an interrupt, an exit code, a denial); `linked`, those a notification is linked
 *             to, and `linkedOther`, those of them with an end of their own. Link conservation: linked = typed +
 *             stopped + the `end_unread_linked` entries of kind `bash` + linkedOther;
 *   entries   `{ reason, kind?, carrier?, key?, version, count }`, in code-unit order: each untyped notice; each origin
 *             key beside a notice's kind that no known recorder writes (`key`); each Bash result whose background id
 *             registered no launch (by each sidecar key the reader does not know, `key`); each run whose end is unread,
 *             by the run's kind (`kind`, BACKGROUND_RUN_KINDS: Workflow and Agent runs too); each Codex shape miss
 *             by its carrier (`carrier`); and (D128) each Claude row read by its structure, by its kind (`key`).
 * `records` are the lineage's records (labelled), `counted` the labels of its rows that are no record (`{uuid, value,
 * version}`, records.js `meta.labelled`), `events` its ledger, `backgroundRuns` and `ends` the runs the
 * absence search read and its verdict for each (background-ends.js), `launchMisses` the launches that registered none
 * (events.js), `codexShapeMisses` each Codex file's misses by carrier, and (D128) `structuralRows` each Claude file's rows
 * read by their structure, `{ kind, version, count }` (records.js `meta.structuralRows`), each an entry
 * `row_read_by_structure` with its kind as `key`. Null when there is nothing to count.
 */
export function recorderCensusOf({ records, counted = [], events, backgroundRuns, ends, launchMisses,
  codexShapeMisses, structuralRows = [] }) {
  const R = RECORDER_CENSUS_REASONS;
  const tally = new Map();
  const count = (reason, version, { n = 1, kind = null, carrier = null, name = null } = {}) => {
    const key = JSON.stringify([reason, BACKGROUND_RUN_KINDS.includes(kind) ? kind : null, carrier,
      typeof name === 'string' && CENSUS_KEY_SHAPE.test(name) ? name : null,
      typeof version === 'string' ? version : null]);
    tally.set(key, (tally.get(key) ?? 0) + n);
  };
  const notices = { labelled: 0, typed: 0 };
  const seen = new Set();
  for (const rec of records) {
    if ((rec.adapter ?? 'claude') !== 'claude') continue;
    const uuid = typeof rec.raw?.uuid === 'string' && rec.raw.uuid ? rec.raw.uuid : null;
    if (uuid !== null && seen.has(uuid)) continue;
    if (uuid !== null) seen.add(uuid);
    const labelled = partsOf(rec).some((part) => part.basis === LABEL_BASIS.taskNotification);
    // The status join's own reading of the row: null when it takes the row for no task notification.
    const read = rec.raw !== null && typeof rec.raw === 'object' ? taskNotificationRead(rec.raw) : null;
    if (labelled !== (read !== null)) { count(R.readerDisagreement, rec.raw?.version); continue; }
    if (!labelled) continue;
    notices.labelled++;
    // Any key beside the origin's kind is accepted (D98); one no known recorder writes is logged by its name.
    for (const name of Object.keys(notificationOriginOf(rec.raw) ?? {}))
      if (!NOTIFICATION_ORIGIN_KEYS.includes(name)) count(R.originUnknownKeys, rec.raw?.version, { name });
    if (read.notice) notices.typed++;
    else count(read.miss, rec.raw?.version);
  }
  // A row labelled a task notification that no reader kept as a record: the status join never read it.
  for (const { uuid, value, version } of counted) {
    if (typeof uuid === 'string' && uuid && seen.has(uuid)) continue;
    if (typeof uuid === 'string' && uuid) seen.add(uuid);
    if (partsOf(value).some((part) => part.basis === LABEL_BASIS.taskNotification)) count(R.readerDisagreement, version);
  }
  for (const miss of launchMisses) count(miss.reason, miss.version, { name: miss.key ?? null });
  const launches = { background: 0, typed: 0, stopped: 0, unread: 0, absent: 0, other: 0, linked: 0, linkedOther: 0 };
  // The Bash runs the search read (each one's verdict: null when code proved its recording holds no end).
  const searched = new Map(backgroundRuns.map((run, i) => [run, ends[i]]).filter(([run]) => run.kind === 'bash')
    .map(([run, end]) => [run.index, end]));
  for (const [index, ev] of events.entries()) {
    const id = ev?.recorded?.backgroundTaskId;
    if (typeof id !== 'string' || !id) continue;
    launches.background++;
    const linked = Number.isSafeInteger(ev.notified) && ev.notified > 0;
    if (linked) launches.linked++;
    if (ev.statusSource === COMMAND_STATUS_SOURCES.claudeTaskNotification) launches.typed++;
    else if (ev.backgroundEnd === BACKGROUND_ENDS.stopped) launches.stopped++;
    else if (ev.backgroundEnd === BACKGROUND_ENDS.unread || ev.backgroundEnd === BACKGROUND_ENDS.unchecked)
      launches.unread++;
    else if (searched.get(index) === null) launches.absent++;
    else { launches.other++; if (linked) launches.linkedOther++; }
  }
  for (const [i, run] of backgroundRuns.entries())
    if (ends[i] !== null) count(ends[i], run.version, { kind: run.kind });
  for (const { carrier, count: n, version } of codexShapeMisses)
    if (Number.isSafeInteger(n) && n > 0) count(R.codexShapeMiss, version, { n, carrier });
  for (const { kind, count: n, version } of structuralRows)
    if (Number.isSafeInteger(n) && n > 0) count(R.rowReadByStructure, version, { n, name: kind });
  const entries = [...tally].map(([key, n]) => {
    const [reason, kind, carrier, name, version] = JSON.parse(key);
    return { reason, ...(kind !== null ? { kind } : {}), ...(carrier !== null ? { carrier } : {}),
      ...(name !== null ? { key: name } : {}), version, count: n };
  }).sort(censusEntryOrder);
  if (!notices.labelled && !launches.background && !entries.length) return null;
  return { notices, launches, entries };
}

/** Code-unit order (never locale-aware: M86). */
const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
/** The census entries' one order: by reason, kind, carrier, key and version, in code-unit order. The loader sums a
 *  lineage's census with its helpers' in the same order (cli session-evidence.js). */
export const censusEntryOrder = (a, b) => cmp(a.reason, b.reason) || cmp(a.kind ?? '', b.kind ?? '')
  || cmp(a.carrier ?? '', b.carrier ?? '') || cmp(a.key ?? '', b.key ?? '') || cmp(a.version ?? '', b.version ?? '');
