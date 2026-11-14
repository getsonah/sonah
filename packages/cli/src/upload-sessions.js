// D227 (item 10, C4): the upload's `sessions` field (sonah-hosted FIXLOOP.md "Linking the fix back" and "Shapes"), from
// the private laptop client's sessions.mjs (sonah-hosted client/sessions.mjs), built by the push run: the agent sessions
// that the range's commits name in Agent-Session lines (D143, read by commit-sessions.js `commitsOf`), the commits that
// name each, the paths those commits changed that are among the version's files, and the comments each session was
// started to answer. Git only: no recording is read, and nothing of a session's content leaves. The comments come from
// the launch records of `sonah fix`, which arrive with the plan's C6; until then each `answers` is empty.
//
// No work at import.
import { SESSION_HARNESSES } from '../../visual/src/fix-prompt.mjs';
import { commitsOf } from './commit-sessions.js';
import { changedPaths } from './team-git.js';

/** The limits the server checks (Shapes): entries, and commits, files and answers in each. */
export const SESSIONS_LIMITS = Object.freeze({ entries: 100, commits: 1000, files: 3000, answers: 100 });
/** D143 stamps Claude Code's commits only. */
const [HARNESS] = SESSION_HARNESSES;

/**
 * The sessions field of an upload of `facts` (its range and files) from the repository at `dir`:
 * `[{ id, harness, commits, files, answers }]`, each session once, in the order of its newest commit; [] when no commit
 * of the range names one. `answers` maps a session's id to the comment ids it was started to answer (none by default).
 * `git` runs git (team-git.js `gitOut`'s shape) and `run` is commit-sessions.js's runner. Throws when git cannot read
 * the range (the caller then sends no field).
 */
export async function uploadSessions({ dir, facts, answers = new Map(), env, git, run }) {
  const range = `${facts.range.base}..${facts.range.head}`;
  const { commits } = await commitsOf(range, { cwd: dir, ...(run ? { run } : {}) });
  const naming = commits.filter((c) => c.ids.length);
  if (!naming.length) return [];
  const changed = await changedPaths(dir, range, { env, ...(git ? { git } : {}) });
  if (changed === null) throw new Error('changed_paths_unreadable');
  const inVersion = new Set((facts.files ?? []).map((f) => f.path));
  const byId = new Map();
  for (const c of naming) {
    for (const id of c.ids) {
      if (!byId.has(id)) byId.set(id, []);
      byId.get(id).push(c.hash);
    }
  }
  const L = SESSIONS_LIMITS;
  return [...byId].slice(0, L.entries).map(([id, hashes]) => {
    const mine = hashes.slice(0, L.commits);
    const files = [...new Set(mine.flatMap((h) => changed.get(h) ?? []))].filter((p) => inVersion.has(p)).sort()
      .slice(0, L.files);
    return { id, harness: HARNESS, commits: mine, files,
      answers: [...(answers.get(id) ?? [])].sort().slice(0, L.answers) };
  });
}
