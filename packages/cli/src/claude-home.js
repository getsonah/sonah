// Where Claude Code keeps its data on this machine: one rule, in one place (W3d-8, F178).
//
// Claude Code stores its settings and session recordings under $CLAUDE_CONFIG_DIR when that is
// set, else under ~/.claude. Sonah used to join ~/.claude/projects itself at seven call sites, so
// a user who set the variable got no sub-agent links.
//
// SONAH_CLAUDE_PROJECTS points Sonah at another projects tree — typically a copy, because a review
// needs a recording that does not change under it, and a live session does. The copy keeps the
// layout <root>/<slug>/<session>.jsonl plus <root>/<slug>/<session>/subagents/. It never moves
// what reads the LIVE recordings: adapter detection (`sonah doctor`) uses `claudeLiveProjectsDir` (F180).
//
// Pure: reads only the env and home it is given; no filesystem access. An empty value is unset.
// A caller that already takes an injected `home` or projects dir keeps that precedence itself.
import { homedir } from 'node:os';
import { dirname, isAbsolute, join, resolve, sep } from 'node:path';

const given = (value) => (typeof value === 'string' && value !== '' ? resolve(value) : null);

/** $CLAUDE_CONFIG_DIR (absolute) when set and non-empty, else <home>/.claude. */
export function claudeConfigDir({ env = process.env, home = homedir() } = {}) {
  return given(env.CLAUDE_CONFIG_DIR) ?? join(home, '.claude');
}

/** $SONAH_CLAUDE_PROJECTS (absolute) when set and non-empty, else <config dir>/projects. */
export function claudeProjectsDir({ env = process.env, home = homedir() } = {}) {
  return given(env.SONAH_CLAUDE_PROJECTS) ?? join(claudeConfigDir({ env, home }), 'projects');
}

/** A Codex rollout's file name: `rollout-<year>-<month>-<day>T<hour>-<minute>-<second>-<id>.jsonl`, digits (Codex's own
 *  layout; every local Codex recording is named so). The date is captured. */
const ROLLOUT_NAME = /^rollout-(\d{4})-(\d{2})-(\d{2})T\d{2}-\d{2}-\d{2}-[^/\\]+\.jsonl$/;

/**
 * Claude Code's name for a project's folder under `<home>/projects`: the working directory the session ran in, with
 * every character that is not an ASCII letter or digit replaced by `-` (`/srv/my app` is `-srv-my-app`). Read off Claude
 * Code's own layout: every local recording lies in the folder so named after the working directory it states.
 */
export const claudeProjectFolder = (cwd) => cwd.replace(/[^A-Za-z0-9]/g, '-');

/** The folder names under `<home>/projects` a helper's recording may lie in, for the working directory `cwd` it
 *  states: its own (`claudeProjectFolder`) and each folder holding it but the file system's root. A helper's folder is
 *  its parent session's, and a helper may run in a folder under the parent's (a worktree under its `.claude`, a
 *  sub-folder). */
function helperProjectFolders(cwd) {
  const names = [claudeProjectFolder(cwd)];
  for (let at = dirname(cwd); dirname(at) !== at; at = dirname(at)) names.push(claudeProjectFolder(at));
  return names;
}

/**
 * The release review (low), and the second release review (medium): the harness home that wrote `file`, read from where
 * the recording itself lies, only when it lies in its recorder's own layout below that home, never from a variable set
 * at review time and never by the home's own name. Claude Code (`adapter` 'claude') writes
 * `<home>/projects/<project>/<session>.jsonl`, a helper's under `<home>/projects/<project>/<session>/subagents/`, where
 * `<project>` is its own name for the working directory the recording states (`cwd`; `claudeProjectFolder`; for a
 * helper, that of the folder it ran in or of one holding it). Codex writes
 * `<home>/sessions/<year>/<month>/<day>/rollout-<that date>T….jsonl`, the date in digits, and
 * `<home>/archived_sessions/rollout-….jsonl` once archived (`ROLLOUT_NAME`). The home is the same whether it was the
 * default or set by CLAUDE_CONFIG_DIR or CODEX_HOME when the session ran, so a home set then and not now is known too.
 * A recording kept anywhere else, as in a folder that only happens to be named `projects` (`~/projects/app/s.jsonl`),
 * names no home: null, as for any other path or adapter, or a Claude Code recording that states no absolute working
 * directory. String work only.
 */
export function recordingHarnessHome(file, adapter, cwd = null) {
  if (typeof file !== 'string' || !isAbsolute(file)) return null;
  const parts = resolve(file).split(sep);
  const name = parts.at(-1);
  if (!name?.endsWith('.jsonl')) return null;
  const up = (depth) => (parts.length > depth + 2 ? parts.slice(0, -depth - 1).join(sep) : null);
  if (adapter === 'claude') {
    if (typeof cwd !== 'string' || !isAbsolute(cwd)) return null;
    if (parts.at(-3) === 'projects' && parts.at(-2) === claudeProjectFolder(cwd)) return up(2);
    if (parts.at(-2) === 'subagents' && parts.at(-5) === 'projects' && helperProjectFolders(cwd).includes(parts.at(-4)))
      return up(4);
    return null;
  }
  const date = adapter === 'codex' ? ROLLOUT_NAME.exec(name) : null;
  if (date) {
    if (parts.at(-2) === 'archived_sessions') return up(1);
    if (parts.at(-5) === 'sessions' && [1, 2, 3].every((at) => parts.at(at - 5) === date[at])) return up(4);
  }
  return null;
}

/** <config dir>/projects, whatever SONAH_CLAUDE_PROJECTS says (F180). For what reads the LIVE
 *  recordings — adapter detection — never a copy a review was pointed at. */
export function claudeLiveProjectsDir({ env = process.env, home = homedir() } = {}) {
  return join(claudeConfigDir({ env, home }), 'projects');
}
