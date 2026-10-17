// D99 (F1 guard): whether a recording proves that a background run has no end.
//
// A background run (a Bash command run in the background, a Workflow, an Agent) ends in a notification the recorder
// writes later. Sonah reads that notification by its recorder shape. When a release changes the shape, the reader no
// longer reads it, and a reader that took "not read" for "not there" would print an absence: "the recording shows no
// end of it". So an absence is said only when code proves it, by three tests on the recording itself, in order:
//   1. no notification is linked to the run (the labeller's link by the call id the notification carries);
//   2. the run's task id is in no later row of its lineage that the agent did not write — a row the recorder wrote,
//      or one no reader labelled (a shape it no longer reads is exactly such a row); and
//   3. the task id is in no row before the run's launch, so a search for it can prove anything at all (a short id
//      that is already in the recording before it was assigned is no proof).
// Any test that fails leaves the end unread, under its census reason (labels.js RECORDER_CENSUS_REASONS); the evidence
// then says "later records mention this run, but Sonah could not read whether or how it ended", never an absence.
//
// The search is verbatim, over each raw line of the lineage's files as recorded, so it reads every row, kept as a record
// or not. A line that repeats the uuid of an earlier line holding the id is a copy (a resumed recording copies its
// history) and is not a later mention. Rows the agent wrote — every labelled part of the record a thought or an action,
// or private reasoning — are not the recorder's word on the run and are skipped for test 2. Structure only: positions,
// labels, uuids and a literal id; no word of any row is read. Deterministic: the same files give the same answers.

import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';
import { LABELS, RECORDER_CENSUS_REASONS, partsOf } from './labels.js';

/** The shape of a task id a verbatim search is sound for (events.js `taskId`, the ids the slicer types): letters, digits
 *  and `_./:-`, nothing JSON would escape but `/`, which is searched in both spellings. */
const SEARCHABLE_ID = /^[A-Za-z0-9_][A-Za-z0-9_./:-]{0,199}$/;
/** The spellings a recorded line may hold an id in: as is, and with `/` escaped as JSON may write it. */
const spellings = (id) => (id.includes('/') ? [id, id.replaceAll('/', '\\/')] : [id]);
const escapeRegExp = (text) => text.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
const before = (a, b) => a.source < b.source || (a.source === b.source && a.record < b.record);
const same = (a, b) => a.source === b.source && a.record === b.record;
/** A record the agent wrote: every labelled part of it a thought or an action, or only private reasoning. */
const agentWrote = (rec) => {
  if (rec?.private === true && !Array.isArray(rec.parts)) return true;
  const parts = partsOf(rec);
  if (Array.isArray(rec?.parts) && parts.length === 0) return rec.parts.length > 0;
  return parts.length > 0 && parts.every((part) => part.label === LABELS.thought || part.label === LABELS.action);
};

/**
 * For each run (`{ taskId, row: {source, record}, linked }`, events.js `backgroundRunsOf`), in order: null when the
 * recording proves it holds no end of the run, else the census reason its end is unread. `files` are the lineage's
 * files (a row's `source` is its index there) and `records` the records read from them (`{source, line}`, labelled), for
 * which rows the agent wrote. `lines` bounds how many lines of each file are read (the count the first read took), so a
 * file that grew since is read as it was then; a file that cannot be read again leaves every run unread.
 */
export async function readBackgroundEnds(files, runs, records, { lines = [] } = {}) {
  const R = RECORDER_CENSUS_REASONS;
  // Test 1 first, whatever the id's shape: a linked run is counted as linked (the census's link conservation).
  const verdicts = runs.map((run) => (run.linked > 0 ? R.endUnreadLinked
    : !SEARCHABLE_ID.test(String(run.taskId ?? '')) ? R.endUnreadIdUnsearchable : undefined));
  const open = runs.map((run, i) => (verdicts[i] === undefined ? i : -1)).filter((i) => i >= 0);
  if (!open.length) return verdicts.map((v) => v ?? null);
  const ids = [...new Set(open.map((i) => runs[i].taskId))];
  const any = new RegExp(ids.flatMap(spellings).sort((a, b) => b.length - a.length).map(escapeRegExp).join('|'));
  const agentRows = new Set(records.filter(agentWrote).map((rec) => `${rec.source ?? 0}:${rec.line}`));
  // id -> the positions of the lines that hold it (copies left out): { at, agent }
  const found = new Map(ids.map((id) => [id, []]));
  const seenUuids = new Set();
  try {
    for (const [source, file] of files.entries()) {
      const limit = Number.isSafeInteger(lines[source]) ? lines[source] : Infinity;
      const rl = createInterface({ input: createReadStream(file, { encoding: 'utf8' }), crlfDelay: Infinity });
      let record = 0;
      for await (const line of rl) {
        record++;
        if (record > limit) break;
        if (!any.test(line)) continue;
        let uuid = null;
        try { const row = JSON.parse(line); uuid = typeof row?.uuid === 'string' && row.uuid ? row.uuid : null; }
        catch { uuid = null; }
        if (uuid !== null && seenUuids.has(uuid)) continue;
        if (uuid !== null) seenUuids.add(uuid);
        const at = { source, record };
        const agent = agentRows.has(`${source}:${record}`);
        for (const id of ids) if (spellings(id).some((spelling) => line.includes(spelling))) found.get(id).push({ at, agent });
      }
    }
  } catch {
    for (const i of open) verdicts[i] = R.endUnreadScanFailed;
    return verdicts;
  }
  for (const i of open) {
    const { taskId, row } = runs[i];
    const hits = found.get(taskId).filter((hit) => !same(hit.at, row));
    if (hits.some((hit) => before(row, hit.at) && !hit.agent)) verdicts[i] = R.endUnreadMentioned;
    else if (hits.some((hit) => before(hit.at, row))) verdicts[i] = R.endUnreadBefore;
    else verdicts[i] = null;
  }
  return verdicts;
}
