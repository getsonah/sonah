// D158: the struggle map — where the record shows an agent's commands failing, a file the failed run named edited after
// it, then a passing run of that agent, and the files in the repository no command that may have passed followed.
//
// Built from typed facts and recorded order alone (ledger.js STRUGGLE_SIGNALS): an event's kind and operation, its actor
// (`actorKeyOf`), the typed outcome of its last result (`resultOutcome`, `recordedFailure`), its effect on files
// (session.js `effectReader`), and whether a path's file name stands literally, as a whole name, in a failed run's
// command or output. No word is read for meaning: the file name selects an edit, it concludes
// nothing, and a signal is a place to look, never an item or a status. Pure: no model, network, clock or random
// source; the same session gives the same bytes. Never throws.

import { recordedFailure, effectReader, ACTION_EFFECTS, CHANGING_EFFECTS, MIN_QUOTE_CHARS } from './session.js';
import { statusUncovered } from './status-fact.js';
import { STRUGGLE_SIGNALS, STRUGGLE_PASSING_OUTCOMES, STRUGGLE_MAY_PASS_OUTCOMES, RESULT_OUTCOME_CLASSES, resultOutcome,
  actorKeyOf } from './ledger.js';

const [FAILED_RUN, EDIT_AFTER_FAILED_RUN, EDITED_AFTER_LAST_PASSING_RUN] = STRUGGLE_SIGNALS;
/** The typed class of a command that ran and failed (RESULT_OUTCOME_CLASSES). */
const RAN_FAILED = RESULT_OUTCOME_CLASSES[2];
const [NO_EFFECT, , LANDED] = ACTION_EFFECTS;
/** The recorded operations that change a file (as the code step reads them, code-context.js). */
const EDIT_OPERATIONS = Object.freeze(['write', 'edit', 'delete']);
/** The characters a file name is made of: a name stands whole in a text only where none of these is beside it. A `.`
 *  just before it, or just after it with one of these after the `.`, makes it part of another name. */
const NAME_CHARACTER = /[A-Za-z0-9_-]/;

const list = (value) => (Array.isArray(value) ? value : []);
const object = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const ordered = (event) => object(event) && typeof event.id === 'string' && Number.isSafeInteger(event.sequence);

/** The last segment of a recorded path (`/` or `\` separated), or null. */
export function fileNameOf(path) {
  if (typeof path !== 'string') return null;
  const name = path.split(/[/\\]/).at(-1);
  return name ? name : null;
}

/**
 * Whether `text` holds the file name `name` literally as a whole name: no name character (`NAME_CHARACTER`) or `.` just
 * before it, and no name character just after it, nor a `.` followed by one. So `greet.js` stands in `src/greet.js:12`
 * and `(greet.js)`, never in `greet.json`, `xgreet.js` or `a.greet.js`. Literal string work only. Pure.
 */
export function holdsFileName(text, name) {
  if (typeof text !== 'string' || typeof name !== 'string' || !name) return false;
  const nameChar = (c) => c !== undefined && NAME_CHARACTER.test(c);
  for (let at = text.indexOf(name); at >= 0; at = text.indexOf(name, at + 1)) {
    const before = text[at - 1], after = text[at + name.length];
    if (nameChar(before) || before === '.') continue;
    if (nameChar(after) || (after === '.' && nameChar(text[at + name.length + 1]))) continue;
    return true;
  }
  return false;
}

/** A field's stored text (`Session.textRegionsOf`); empty when it cannot be read. */
function fieldText(session, event, field) {
  try {
    const regions = session.textRegionsOf(event, field);
    return { text: typeof regions?.text === 'string' ? regions.text : '' };
  } catch { return { text: '' }; }
}

/**
 * The facts the maps read from one session, bounded by `until` (a sequence: only events recorded at or before it): the
 * ordered events; every command run (`runs`: `{ event, result, actor, failed, passing, mayPass, refused }`, `result` its
 * last terminal result; `passing` its class one of STRUGGLE_PASSING_OUTCOMES and its zero status covering every command
 * of its line (status-fact.js `statusUncovered` false: a pipeline's, a sequence's or an or-list's last status proves no
 * pass); `mayPass` its class one of STRUGGLE_MAY_PASS_OUTCOMES, covered or not); and every edit, write or delete in the
 * repository that could have changed a file (`edits`: `{ event, result, actor, paths, effect, parent, place }`), by D98's
 * one effect rule (session.js CHANGING_EFFECTS), as every reader of a file's last edit reads it (code-context.js
 * `commandsAfterLastEdit`, claims.js `staleRun`): `effect` is `landed` when the record proves it, `unknown` when it
 * proves neither way (it may have changed the file); `result` the terminal result of the call (its own, or its command's
 * for a write parsed from one), null when none is recorded; `parent` the id of the command a write was parsed from
 * (`shellWriteOf`, provenance: the slicer records such a write after its command's own result, but it is that command's
 * own write), else null; `place` where the edit stands in the order: its parent command's invocation for a parsed write,
 * else its own. Every event stands where the adapter places it (C-03 M33 P): a helper's segment at its proven receipt;
 * one whose receipt is not proven at the helper's next report or after the session's last request; the whole history of
 * a helper that no valid delivery record cuts right after its spawn. No recorded timestamp is read. A change outside the
 * repository (`outsideRepository`), or with no path, is not read. Events with no recorded order are not read
 * (`unordered` counts them), nor an event whose actor cannot be named (`actorKeyOf`). Shared by the struggle map and the
 * claims-against-runs join (claims.js), so the two read one set of facts.
 */
export function sessionFacts(session, { until = null } = {}) {
  const bounded = Number.isSafeInteger(until);
  const all = list(session?.events);
  const events = all.filter((event) => ordered(event) && (!bounded || event.sequence <= until))
    .sort((a, b) => a.sequence - b.sequence);
  const unordered = all.filter((event) => !ordered(event)).length;
  const last = new Map(), byId = new Map();
  for (const event of events) {
    byId.set(event.id, event);
    if (event.kind === 'observation' && event.phase === 'terminal' && typeof event.invocation === 'string')
      last.set(event.invocation, event);
  }
  const effectOf = effectReader(session);
  const read = (event) => effectOf(event, { until: bounded ? until : null });
  const runs = [], edits = [];
  for (const event of events) {
    if (event.kind !== 'invocation') continue;
    const actor = actorKeyOf(session, event);
    if (actor === undefined) continue;
    if (event.operation === 'command') {
      const result = last.get(event.id) ?? null;
      const refused = read(event) === NO_EFFECT;
      const outcome = result ? resultOutcome(session, result).class : null;
      runs.push({ event, result, actor, refused,
        failed: result !== null && !refused && recordedFailure(result) && outcome === RAN_FAILED,
        passing: result !== null && !refused && STRUGGLE_PASSING_OUTCOMES.includes(outcome) && !statusUncovered(result),
        mayPass: result !== null && !refused && STRUGGLE_MAY_PASS_OUTCOMES.includes(outcome) });
      continue;
    }
    if (!EDIT_OPERATIONS.includes(event.operation)) continue;
    const effect = read(event);
    if (!CHANGING_EFFECTS.includes(effect)) continue;
    const paths = [...new Set(list(event.changes).filter((change) => object(change)
      && change.outsideRepository !== true && typeof change.path === 'string' && change.path)
      .map((change) => change.path))];
    if (!paths.length) continue;
    const parent = typeof event.shellWriteOf === 'string' && event.shellWriteOf ? event.shellWriteOf : null;
    const command = parent === null ? null : byId.get(parent) ?? null;
    const result = last.get(parent ?? event.id) ?? null;
    edits.push({ event, result, actor, paths, effect, parent,
      place: command !== null && command.sequence < event.sequence ? command.sequence : event.sequence });
  }
  return { events, unordered, runs, edits };
}

/** Where an edit's call is known to have ended: its result's place, else its own. */
const editEnd = (edit) => (edit.result ? Math.max(edit.result.sequence, edit.event.sequence) : edit.event.sequence);

/** One failed run's texts a file name may stand in: its command (role action) and its last result's output. */
function failedTexts(session, run) {
  return [{ eventId: run.event.id, field: 'command', ...fieldText(session, run.event, 'command') },
    { eventId: run.result.id, field: 'output', ...fieldText(session, run.result, 'output') }];
}

/**
 * The struggle map of one session (D158; ledger.js STRUGGLE_SIGNALS): `{ runs: { total, failed, passing }, edits: {
 * landed, unknown }, unordered, signals }`. `signals`, in the recorded order of the event each starts at, then by kind:
 *   { signal: 'failed_run', actor, run, result }
 *   { signal: 'edit_after_failed_run', actor, failed, edits, passed }
 *                                                            failed: the run; edits: [{ eventId, path, effect,
 *                                                            namedIn: { eventId, field } }]; passed: the agent's first
 *                                                            passing run started after the last of those edits ended
 *   { signal: 'edited_after_last_passing_run', actor, path, lastEdit, effect }
 * Each id is an event id; `actor` is null for the main agent, else the helper's child id (`actorKeyOf`). A run refused
 * before it ran is no run. An edit is one that could have changed a file (`sessionFacts`), its `effect` beside it. Every
 * event stands where the adapter places it (`sessionFacts`, C-03 M33 P). `until` bounds the session (a sequence). Never
 * throws: a session it cannot read gives no signal.
 */
export function struggleMap(session, { until = null } = {}) {
  try {
    const facts = sessionFacts(session, { until });
    const signals = [];
    for (const run of facts.runs)
      if (run.failed) signals.push({ at: run.event.sequence, signal: FAILED_RUN, actor: run.actor, run: run.event.id,
        result: run.result.id });
    signals.push(...failedRunEdits(session, facts), ...unpassedFiles(facts));
    const rank = (signal) => STRUGGLE_SIGNALS.indexOf(signal.signal);
    const text = (signal) => JSON.stringify(signal);
    signals.sort((a, b) => a.at - b.at || rank(a) - rank(b) || (text(a) < text(b) ? -1 : text(a) > text(b) ? 1 : 0));
    return { runs: { total: facts.runs.filter((run) => !run.refused).length,
      failed: facts.runs.filter((run) => run.failed).length, passing: facts.runs.filter((run) => run.passing).length },
    edits: { landed: facts.edits.filter((edit) => edit.effect === LANDED).length,
      unknown: facts.edits.filter((edit) => edit.effect !== LANDED).length }, unordered: facts.unordered,
    signals: signals.map(({ at: _at, ...signal }) => signal) };
  } catch {
    return { runs: { total: 0, failed: 0, passing: 0 }, edits: { landed: 0, unknown: 0 }, unordered: 0, signals: [] };
  }
}

/**
 * `edit_after_failed_run`: each edit of a file whose name (MIN_QUOTE_CHARS or longer) stands literally in the command or
 * output of a failed run of the same agent whose result is recorded before the edit's place (`holdsFileName`; the latest
 * such run: a write parsed from a command stands at that command, so a failed run's own write is never after it), when
 * a passing run of that agent was started after the edit ended (`editEnd`). One signal per failed run, its
 * edits in order, `passed` the agent's first passing run started after the last of them ended. The file name selects;
 * it concludes nothing.
 */
function failedRunEdits(session, facts) {
  const failed = facts.runs.filter((run) => run.failed);
  if (!failed.length) return [];
  const texts = new Map(failed.map((run) => [run, failedTexts(session, run)]));
  const passing = facts.runs.filter((run) => run.passing);
  const groups = new Map();
  for (const edit of facts.edits) {
    if (!passing.some((run) => run.actor === edit.actor && run.event.sequence > editEnd(edit))) continue;
    for (const path of edit.paths) {
      const name = fileNameOf(path);
      if (!name || name.length < MIN_QUOTE_CHARS) continue;
      for (let k = failed.length - 1; k >= 0; k--) {
        const run = failed[k];
        if (run.actor !== edit.actor || !(run.result.sequence < edit.place)) continue;
        const hit = texts.get(run).find((field) => holdsFileName(field.text, name));
        if (!hit) continue;
        if (!groups.has(run)) groups.set(run, []);
        groups.get(run).push({ edit, path, namedIn: { eventId: hit.eventId, field: hit.field } });
        break;
      }
    }
  }
  return [...groups].flatMap(([run, named]) => {
    const lastEnd = Math.max(...named.map(({ edit }) => editEnd(edit)));
    const passed = passing.find((other) => other.actor === run.actor && other.event.sequence > lastEnd);
    return passed ? [{ at: run.event.sequence, signal: EDIT_AFTER_FAILED_RUN, actor: run.actor, failed: run.event.id,
      edits: named.map(({ edit, path, namedIn }) => ({ eventId: edit.event.id, path, effect: edit.effect, namedIn })),
      passed: passed.event.id }] : [];
  });
}

/** `edited_after_last_passing_run`: each file whose last edit (one that could have changed it, as the code step's
 *  `never_ran` reads a last edit; a parsed write placed at its command, `place`) has no result of a run that may have
 *  passed (`mayPass`), of any agent, recorded after it: a command's own result follows the write parsed from it.
 *  Ordering only. */
function unpassedFiles(facts) {
  const lastEdit = new Map();
  for (const edit of facts.edits) for (const path of edit.paths) {
    const prior = lastEdit.get(path);
    if (!prior || edit.place >= prior.place) lastEdit.set(path, edit);
  }
  const ends = facts.runs.filter((run) => run.mayPass).map((run) => run.result.sequence);
  const lastPass = ends.length ? Math.max(...ends) : -Infinity;
  return [...lastEdit].filter(([, edit]) => !(lastPass > edit.place))
    .map(([path, edit]) => ({ at: edit.place, signal: EDITED_AFTER_LAST_PASSING_RUN, actor: edit.actor, path,
      lastEdit: edit.event.id, effect: edit.effect }));
}
