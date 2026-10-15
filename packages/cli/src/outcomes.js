// Capture-time exit codes, recorded by early previews' PostToolUse hook (`sonah capture-outcome`, installed by
// `sonah init`; both retired, D76) and read here.
//
// Claude Code transcripts carry no exit codes, so slice-time outcome detection there is pattern
// matching over runner output (packages/slicer/src/outcome.js) — strictly weaker evidence. The
// PostToolUse hook payload for Bash carried `tool_response.exit_code` and `tool_response.interrupted`,
// and the hook wrote them, never the output, to
// ~/.sonah/outcomes/<session_id>.ndjson, one line per call: `{k: tool_use_id, tool, exitCode, interrupted}`.
// Nothing writes these files any more; the slicer still joins the ones on disk by tool_use_id at slice time.

import { homedir } from 'node:os';
import { join } from 'node:path';
import { readFile } from 'node:fs/promises';

const HOME = () => process.env.SONAH_HOME ?? join(homedir(), '.sonah');

// session_id becomes a filename: allow only a flat token, no separators, no leading dot (rejects `.`, `..`, dotfiles,
// traversal, and absolute paths).
const SESSION_ID = /^[A-Za-z0-9_.-]{1,128}$/;
const validSessionId = (s) => typeof s === 'string' && SESSION_ID.test(s) && !s.startsWith('.');

const outcomesFile = (home, sessionId) => join(home ?? HOME(), 'outcomes', `${sessionId}.ndjson`);

/**
 * Load recorded outcomes for one session, for the slicer to join at slice time.
 *
 * The join key is the transcript's own tool_use block id (`toolu_...`) — byte-identical to the
 * hook's `tool_use_id`, collision-free, and it survives compaction. Outcomes are per session
 * FILE: a compaction lineage should load each file's own session id and union the maps.
 *
 * Never throws. Missing file, invalid session id, or garbage content yield an empty Map;
 * individually unparseable lines are skipped. Replayed rows may add missing fields, but
 * contradictory evidence for one tool_use_id stays ambiguous even if another row follows.
 *
 * @param {string} sessionId
 * @param {{home?: string}} [opts]
 * @returns {Promise<Map<string, {exitCode: number|null, interrupted: boolean|null, tool: string|null, ambiguous?: true}>>}
 */
export async function loadOutcomes(sessionId, { home } = {}) {
  const out = new Map();
  if (!validSessionId(sessionId)) return out;

  let text;
  try { text = await readFile(outcomesFile(home, sessionId), 'utf8'); } catch { return out; }

  for (const raw of text.split('\n')) {
    if (!raw.trim()) continue;
    let rec;
    try { rec = JSON.parse(raw); } catch { continue; }
    if (typeof rec !== 'object' || rec === null || typeof rec.k !== 'string') continue;
    const evidence = {
      exitCode: Number.isInteger(rec.exitCode) ? rec.exitCode : null,
      interrupted: typeof rec.interrupted === 'boolean' ? rec.interrupted : null,
      tool: typeof rec.tool === 'string' ? rec.tool : null,
    };
    out.set(rec.k, combineEvidence(out.get(rec.k), evidence));
  }
  return out;
}

const AMBIGUOUS = Object.freeze({ exitCode: null, interrupted: null, tool: null, ambiguous: true });

// A repeated hook can be an exact replay or a partial copy of the same observation. Known
// fields can be combined only when they agree. A disagreement may also be an ID collision, so
// no row (including a later replay) is allowed to pick a winner by file or append order.
function combineEvidence(previous, incoming) {
  if (!previous) return incoming;
  if (previous.ambiguous === true || incoming.ambiguous === true) return AMBIGUOUS;
  for (const field of ['exitCode', 'interrupted', 'tool']) {
    if (previous[field] !== null && incoming[field] !== null
      && previous[field] !== incoming[field]) return AMBIGUOUS;
  }
  return {
    exitCode: previous.exitCode ?? incoming.exitCode,
    interrupted: previous.interrupted ?? incoming.interrupted,
    tool: previous.tool ?? incoming.tool,
  };
}

/** The capture-time outcomes for every file of a lineage, merged — the ONE loader every
 *  sliceLineage must use, or two surfaces slice the same session to different bytes and
 *  different hashes (found by the web-UI review). */
export async function outcomesFor(files, opts = {}) {
  const m = new Map();
  for (const f of files) {
    const sid = String(f).split('/').pop().replace(/\.jsonl$/, '');
    for (const [k, v] of await loadOutcomes(sid, opts)) m.set(k, combineEvidence(m.get(k), v));
  }
  return m;
}
