// D142 (the owner, 2026-10-23): the recording that a session id names. `/sonah` passes the agent's session id (Claude
// Code's `${CLAUDE_SESSION_ID}`), and Sonah reviews the recording whose file name carries it: never the newest
// recording, and never by the id a recording's rows name (a forked or resumed Claude Code recording can open with rows
// copied from another session, under that session's id), because the file name is what both harnesses key a session's
// id to. Structure only: folder and file names, no file is opened. No clock, no network.
import { lstat, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { SESSION_ID_PROBLEMS } from '../../evidence/src/ledger.js';

/** A session id as both harnesses write it: a UUID (Claude Code a version 4, Codex a version 7), any case. */
export const SESSION_ID_SHAPE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const [NOT_FOUND, AMBIGUOUS, COMPRESSED] = SESSION_ID_PROBLEMS;
const failure = (code, extra = {}) => Object.assign(new Error(code), { code, ...extra });
/** Codex's folders of one day: `sessions/YYYY/MM/DD`. */
const CODEX_DAY = Object.freeze([/^\d{4}$/, /^\d{2}$/, /^\d{2}$/]);

async function entries(folder) {
  try { return await readdir(folder, { withFileTypes: true }); } catch { return []; }
}
async function isFile(path) {
  try { return (await lstat(path)).isFile(); } catch { return false; }
}

/**
 * Whether a Codex rollout's file name carries this thread id: `rollout-<time>-<id>.jsonl`, or the file Codex writes
 * after a revert, `rollout-<time>-<id>_<rollout id>.jsonl` (openai/codex `rollout/src/recorder.rs`); either may be
 * compressed (`.jsonl.zst`). `id` in lower case.
 */
export function codexNameCarries(name, id) {
  if (typeof name !== 'string' || !name.startsWith('rollout-')) return false;
  const stem = name.endsWith('.jsonl.zst') ? name.slice(0, -'.jsonl.zst'.length)
    : name.endsWith('.jsonl') ? name.slice(0, -'.jsonl'.length) : null;
  if (stem === null) return false;
  if (stem.endsWith(`-${id}`)) return true;
  const at = stem.indexOf(`-${id}_`);
  return at !== -1 && at + id.length + 2 < stem.length && !stem.slice(at + id.length + 2).includes('/');
}

/**
 * The recordings whose file names carry `id`, in code-unit order of their paths: Claude Code's
 * `<projects>/<folder>/<id>.jsonl`, Codex's `<codexHome>/sessions/YYYY/MM/DD/` and `<codexHome>/archived_sessions/`
 * rollouts (`codexNameCarries`). Regular files only; a symbolic link is none.
 */
export async function recordingsNamed(id, { claudeProjects, codexHome }) {
  const want = String(id).toLowerCase();
  const found = [];
  if (typeof claudeProjects === 'string' && claudeProjects)
    for (const project of await entries(claudeProjects)) if (project.isDirectory()) {
      const file = join(claudeProjects, project.name, `${want}.jsonl`);
      if (await isFile(file)) found.push({ file, adapter: 'claude' });
    }
  if (typeof codexHome === 'string' && codexHome) {
    const days = [join(codexHome, 'archived_sessions')];
    const walk = async (folder, depth) => {
      for (const entry of await entries(folder)) if (entry.isDirectory() && CODEX_DAY[depth].test(entry.name)) {
        if (depth === CODEX_DAY.length - 1) days.push(join(folder, entry.name));
        else await walk(join(folder, entry.name), depth + 1);
      }
    };
    await walk(join(codexHome, 'sessions'), 0);
    for (const day of days) for (const entry of await entries(day))
      if (entry.isFile() && codexNameCarries(entry.name, want)) found.push({ file: join(day, entry.name), adapter: 'codex' });
  }
  return found.sort((a, b) => (a.file < b.file ? -1 : a.file > b.file ? 1 : 0));
}

/**
 * The one recording `id` names: `{ file, adapter }`. None: `session_id_not_found`. More than one (a Codex thread after a
 * revert, or the same name in two folders): `session_id_ambiguous`, with `matches`, their paths. One compressed Codex
 * rollout (`.zst`, which Sonah does not read): `session_id_compressed`, with `matches`, its path. Codes of ledger.js
 * SESSION_ID_PROBLEMS.
 */
export async function resolveSessionId(id, roots) {
  const found = await recordingsNamed(id, roots);
  if (!found.length) throw failure(NOT_FOUND);
  if (found.length > 1) throw failure(AMBIGUOUS, { matches: found.map((match) => match.file) });
  if (found[0].file.endsWith('.zst')) throw failure(COMPRESSED, { matches: [found[0].file] });
  return found[0];
}
