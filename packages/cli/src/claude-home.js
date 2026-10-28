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
import { isAbsolute, join, resolve } from 'node:path';

const given = (value) => (typeof value === 'string' && value !== '' ? resolve(value) : null);

/** $CLAUDE_CONFIG_DIR (absolute) when set and non-empty, else <home>/.claude. */
export function claudeConfigDir({ env = process.env, home = homedir() } = {}) {
  return given(env.CLAUDE_CONFIG_DIR) ?? join(home, '.claude');
}

/**
 * D151: $CLAUDE_CONFIG_DIR as every claude process Sonah starts is given it (review-judge.js `claudeEnvironment`), or
 * null when it is unset or empty. An absolute value goes exactly as written: Claude Code names a login after the
 * variable's own string, not the folder it names (2.1.310: on macOS the keychain entry is named after a hash of the
 * value, unresolved), so another spelling of the same folder (a trailing slash, `//`, a `.` segment) is another login.
 * A relative value is resolved against Sonah's own working folder, the folder `claudeConfigDir` reads from: as written
 * it would name another folder from each call's own working folder (a fresh temporary folder, the repository), and on
 * macOS its keychain login does not follow it (doctor says so).
 */
export function claudeConfigDirForCalls(env = process.env) {
  const value = env.CLAUDE_CONFIG_DIR;
  if (typeof value !== 'string' || value === '') return null;
  return isAbsolute(value) ? value : resolve(value);
}

/** $SONAH_CLAUDE_PROJECTS (absolute) when set and non-empty, else <config dir>/projects. */
export function claudeProjectsDir({ env = process.env, home = homedir() } = {}) {
  return given(env.SONAH_CLAUDE_PROJECTS) ?? join(claudeConfigDir({ env, home }), 'projects');
}

/** <config dir>/projects, whatever SONAH_CLAUDE_PROJECTS says (F180). For what reads the LIVE
 *  recordings — adapter detection — never a copy a review was pointed at. */
export function claudeLiveProjectsDir({ env = process.env, home = homedir() } = {}) {
  return join(claudeConfigDir({ env, home }), 'projects');
}

/**
 * Where the coding agents keep their own files on this machine, which any session of theirs writes while it runs — the
 * person's own, and the code step's review agents (Claude Code, run with this HOME and, D151, the person's
 * CLAUDE_CONFIG_DIR when set: review-judge.js `claudeEnvironment`): Claude Code's folder (`claudeConfigDir`, and
 * `<home>/.claude`) and its
 * state file beside it (`<home>/.claude.json`; with CLAUDE_CONFIG_DIR, the one inside that folder), and Codex's home
 * ($CODEX_HOME, else `<home>/.codex`). Absolute, each once. Not a rule about what is read or shown: the code step's
 * repository state leaves these out (code-snapshot.js `repositoryState`), so a write by a harness during the review is
 * not read as the repository changing.
 */
export function harnessHomePlaces({ env = process.env, home = homedir() } = {}) {
  return [...new Set([claudeConfigDir({ env, home }), join(home, '.claude'), join(home, '.claude.json'),
    given(env.CODEX_HOME) ?? join(home, '.codex')].map((place) => resolve(place)))];
}
