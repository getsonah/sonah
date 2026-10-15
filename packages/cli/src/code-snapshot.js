// D87 (owner decisions 2026-10-13/14): what `sonah review --code-pass` reads from disk — the files the recorded
// session changed, then the files it read (evidence/src/code-pass.js `codeSnapshotPlan`), as they are at review time,
// under the recorded working directory. Read once, before the review's first call, and frozen
// (`freezeCodeSnapshot`): every request of the pass shows these bytes and nothing read later.
//
// Withheld by the path as recorded, before anything is resolved (slicer/src/before.js `withheldFileReason`): a
// credential-shaped path and a harness home folder; and a path outside the working directory, as recorded or by the
// slicer's write scope. Then withheld by where the file REALLY is (`realpath`, which follows every symbolic link at any
// depth: a linked folder anywhere on the path, or the file itself): a real path outside the working directory's own real
// path, a real path that is credential-shaped or in a harness home folder (the same rule, on the real path, with the
// home as given and as it really is), or one inside a harness home this computer names (`harness`: Claude Code's
// configuration folder, Codex's home) outside its worktrees, which the slicer exempts the same way (slicer/src/before.js
// `inHarnessHome`: a worktree there is the project under review). Only that real path is opened, never through a link
// at its last part, and only a regular file is read, at most `maxBytes` (a larger one is declared `oversize`, never
// clipped). Every refusal is a closed state (evidence/src/ledger.js CODE_FILE_STATES); nothing here reads a file's words.
//
// The code step (`sonah.code-snapshot/2`): and the diff the step
// reviews, from the session's start commit to these frozen files, read with git and never written: the start commit
// (the one the recording names, else the HEAD reflog entry in effect at the recording's first timestamp, else the newest
// first-parent commit of HEAD made by then), every path that differs from it (git's own list, and the untracked files a
// recorded edit wrote or that changed after the session began), each one's file at that commit and git's own patch of
// it. Every path passes the same withholding rules first: no line of a withheld file is read, before or after. When
// there is no git base (no repository, no start commit), the diff is the recorded edits (code-pass.js). Git runs with
// optional locks off, no external diff or text conversion, and no GIT_* variable of the caller's, so it reads the
// repository as it is and writes nothing.
//
// /3 (the review of the code step, 2026-10-14): git's lists stop at the working directory (a pathspec of it), so a
// working directory that is a folder of a larger repository never brings in the names of the repository's other paths;
// how many paths differ outside it is counted (`outside`), never named. An untracked file's patch is git's own
// (`git diff --no-index` from nothing), so a `binary` or `-diff` attribute withholds it as it withholds a tracked one.
//
// /4 (the second review of the code step, 2026-10-14): a file in a harness home — by its name as recorded, or by where it
// really is — is `harness_home` before any other rule, a credential-shaped one included, so no request names it by any
// name (with the working directory the user's home, as in a dotfiles repository, `.claude/secrets.json` was
// `credential_path` and named).
//
// /5 (the third review of the code step, 2026-10-14): `harness_home` is decided before every other state, by every name
// a file has and by wherever each name really leads, whether or not anything is there now (`wherever`: the real path of
// a file that is there; of one that is not — deleted since the start commit — its folder's real place and its own name;
// a link that leads nowhere now, where it leads). The harness homes are the default ones under the home folder, the ones
// this computer sets (CLAUDE_CONFIG_DIR, CODEX_HOME), and wherever each of those really leads. A tracked file deleted
// from a configured or linked home was `deleted` (its real path did not resolve), so it was named and its text at the
// start commit sent.
//
// /6 (the fourth review of the code step, 2026-10-14): the harness files a harness keeps in the home folder itself,
// beside its home folders — Claude Code's `~/.claude.json` and its backups — are harness home paths by the slicer's own
// list (slicer/src/before.js `isHomeFile`, read through `harnessHomePath`), so with the home folder as the repository
// that file is `harness_home`, never shown (it was read whole and sent). And a path that was a symbolic link at the
// start commit (git's mode 120000) whose target lies in a harness home — wherever it leads, there or not — is
// `harness_home` too (`startLinkInHarness`), so a tracked link into `~/.claude` deleted or changed since then never
// names its target: a link's text at the start commit is that target, and it was sent as a removed line.
//
// /7 (the release review, 2026-10-14): with the code step on by default, a repository whose real top folder is the
// home folder, or holds it (a dotfiles repository, a repository at the top of a disk), sent every file git saw as
// changed, or untracked and new since the session began: Sonah's own stores, another harness's settings and chats, shell
// history, credentials of every tool kept there. By structure (the real top folder against the home folder as given and
// as it really is), such a repository is read only at the paths the session itself recorded changing or reading; every
// other differing path is counted (`base.unrecorded`), never named, read or sent, and git is asked about untracked files
// by those paths alone, never over the home folder (`readGitBase`, `recordedUntracked`). And the harness home that wrote
// the recording is one, by where the recording lies (cli/src/claude-home.js `recordingHarnessHome`, passed in `harness`):
// a Claude Code home set by CLAUDE_CONFIG_DIR when the session ran (a second config folder, `~/.claude-2`) and unset
// now was neither a default nor a set home, and its files were named and sent.
//
// /8 (the second release review, 2026-10-15): /7 took any folder named `projects` two levels above a recording as a
// Claude Code home, so a recording kept in the person's own `~/projects/app/` made every file of the home folder
// `harness_home` and switched the code step off without a word. The recording now names a home only in its recorder's
// own layout (`recordingHarnessHome`): for Claude Code, under the folder it names after the working directory the
// recording states.
//
// Known limits. A hard link, like a copy, is a file of its own name: `config.js` hard-linked to `.env` is read as
// `config.js` (no path rule can tell; refusing every file with more than one link would also refuse a package manager's
// linked installs). A folder in the middle of the real path replaced by a link between `realpath` and `open` is
// followed, since only the last part is opened without following a link; that takes another process changing that
// path during the review. A file changed between its read and git's diff of it fails the diff's row-by-row check against
// the frozen file and is shown by name only (`unreadable`).
import { constants, createReadStream } from 'node:fs';
import { lstat, open, readlink, realpath, stat } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { createInterface } from 'node:readline';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { harnessHomePath, inHarnessHome, withheldFileReason } from '../../slicer/src/before.js';
import { strictJson } from '../../slicer/src/strict-json.js';
import { codeSnapshotPlan, freezeCodeSnapshot } from '../../evidence/src/code-pass.js';
import { displayPath, HOME_SPELLED, namedUnderRoot } from '../../evidence/src/code-context.js';
import { CODE_FILE_STATES, CODE_DIFF_BASES, CODE_START_COMMIT_SOURCES, CODE_CHANGE_TYPES } from '../../evidence/src/ledger.js';

const [GIT_BASE, RECORDED_EDITS_BASE] = CODE_DIFF_BASES;
const [FROM_RECORDING, FROM_REFLOG, FROM_COMMIT_DATE] = CODE_START_COMMIT_SOURCES;
const [ADDED, MODIFIED, DELETED_TYPE] = CODE_CHANGE_TYPES;

const [, , , , HARNESS_HOME, OVERSIZE, , DELETED, OUTSIDE_ROOT, UNREADABLE] = CODE_FILE_STATES;

/** How a file is opened: read only; never through a link at the last part of its real path (one there now was put
 *  there after the path was resolved); never waiting on a FIFO or a device, whose type is refused once it is open. */
const READ_FLAGS = constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0);

/** `path` lies at or under `root` (both absolute, normalized), by whole path segments. */
const inside = (path, root) => {
  const rel = relative(root, path);
  return rel === '' || (!rel.startsWith(`..${sep}`) && rel !== '..' && !isAbsolute(rel));
};

/** The errors that say a path is not there (it, or a folder on it, is missing). */
const GONE = new Set(['ENOENT', 'ENOTDIR']);
/** The most links `wherever` follows by hand: the length of a POSIX system's own chain (SYMLOOP_MAX is at least 8;
 *  Linux and macOS follow 40 and 32). A frozen literal. */
const MAX_LINKS = 40;

/**
 * Where `path` (absolute) really is, as far as the file system can say: `{ real, there }` — its real path when it is
 * there (`there`: true); else (`there`: false) for a link that leads nowhere now, where it leads, resolved the same way,
 * and for a path that is not there, its folder's place resolved the same way, then its own name — so a file deleted from
 * a folder a link leads to is placed where the link leads. Null when a part of it cannot be resolved for another reason
 * (no permission, a loop). Reads names only (`realpath`, `lstat`, `readlink`), never a file; follows at most MAX_LINKS
 * links by hand. Never throws.
 */
async function wherever(path, links = MAX_LINKS) {
  try { return { real: await realpath(path), there: true }; } catch (error) { if (!GONE.has(error?.code)) return null; }
  let info = null;
  try { info = await lstat(path); } catch (error) { if (!GONE.has(error?.code)) return null; }
  if (info?.isSymbolicLink()) {
    if (links <= 0) return null;
    let target;
    try { target = await readlink(path); } catch { return null; }
    const led = await wherever(resolve(dirname(path), target), links - 1);
    return led === null ? null : { real: led.real, there: false };
  }
  if (info) return null;
  const parent = dirname(path);
  if (parent === path) return null;
  const up = await wherever(parent, links);
  return up === null ? null : { real: join(up.real, basename(path)), there: false };
}

/** `real` lies in the harness home `dir` outside its worktrees: the slicer's own rule (`inHarnessHome`), on the path
 *  from `dir` to `real`, slashes forward. */
const inHarness = (real, dir) => inside(real, dir) && inHarnessHome(relative(dir, real).split(sep).join('/'));

/** The absolute place a recorded name gives, or null: a name the shell reads from the home folder (HOME_SPELLED) under
 *  `home` when it is known; an absolute name as it is; any other under `root`. String work only. */
function placeOf(named, { root, home }) {
  const spelled = HOME_SPELLED.exec(named);
  if (spelled) return home === null ? null : resolve(home, `.${sep}${named.slice(spelled[0].length)}`);
  return resolve(root, named);
}

/**
 * Whether a plan entry lies in a harness home, outside the homes' worktrees: by any name it has — the path rule's
 * harness half (`harnessHomePath`: under the home folder's `.claude` or `.codex`, or, outside the working directory,
 * any such folder), or under a harness home this computer names (`harness`) — or wherever each name's place really
 * leads, there or not (`placed`: each place and its `wherever`; a file deleted since the start commit from a home a link
 * leads to, or from one that is set). String work only.
 */
function inAnyHarnessHome(names, placed, { root, realRoot, home, homes, harness }) {
  if (names.some((named) => harnessHomePath(named, { home, cwd: root }))) return true;
  return [...placed].some(([place, found]) => harness.some((dir) => inHarness(place, dir))
    || (found !== null && (homes.some((at) => harnessHomePath(found.real, { home: at, cwd: realRoot }))
      || harness.some((dir) => inHarness(found.real, dir)))));
}

/** Why a file whose real path is `real` (in no harness home: `inAnyHarnessHome` decided that first) is withheld, or
 *  null: the path rule (`withheldFileReason`: a credential-shaped path, with each home as given and as it really is,
 *  against the real working directory), or a real path outside the real working directory. */
function realReason(real, { realRoot, homes }) {
  for (const home of homes) {
    const why = withheldFileReason(real, { home, cwd: realRoot });
    if (why !== null) return why;
  }
  return inside(real, realRoot) ? null : OUTSIDE_ROOT;
}

/**
 * What one plan entry is at review time: a closed state, a directory, or its bytes. Never throws. A file in a harness
 * home — by any name it has, or wherever it really is, there or not (`inAnyHarnessHome`) — is `harness_home` before every
 * other state (the second review of the code step: a credential-shaped file there was `credential_path`, and a request
 * named it; the third: a file deleted from a set or linked home was `deleted`, named, and its start-commit text sent),
 * so no request names it and no line of it is read, before or after; a credential-shaped name is then
 * `credential_path`, its content never read. Each name's place is resolved once (`wherever`), and the file is opened at
 * the real path that resolution gave.
 */
async function readEntry(entry, { root, realRoot, home, homes, harness, maxBytes }) {
  const at = { path: entry.path };
  const recorded = typeof entry.recordedPath === 'string' ? entry.recordedPath : entry.path;
  const names = [...new Set([recorded, entry.path])];
  const placed = new Map();
  for (const named of names) {
    const place = placeOf(named, { root, home });
    if (place !== null && !placed.has(place)) placed.set(place, await wherever(place));
  }
  if (inAnyHarnessHome(names, placed, { root, realRoot, home, homes, harness })) return { ...at, state: HARNESS_HOME };
  const byName = names.map((named) => withheldFileReason(named, { home, cwd: root })).find((why) => why !== null) ?? null;
  if (entry.outside === true || HOME_SPELLED.test(recorded) || HOME_SPELLED.test(entry.path))
    return { ...at, state: byName ?? OUTSIDE_ROOT };
  const absolute = resolve(root, entry.path);
  if (!inside(absolute, root)) return { ...at, state: byName ?? OUTSIDE_ROOT };
  const found = placed.get(absolute) ?? null;
  if (found === null || !found.there) return { ...at, state: byName ?? (found === null ? UNREADABLE : DELETED) };
  const real = found.real;
  const why = byName ?? realReason(real, { realRoot, homes });
  if (why !== null) return { ...at, state: why };
  let handle = null;
  try {
    try { handle = await open(real, READ_FLAGS); }
    catch (error) { return error?.code === 'EISDIR' ? { ...at, directory: true } : { ...at, state: UNREADABLE }; }
    const info = await handle.stat();
    if (info.isDirectory()) return { ...at, directory: true };
    if (!info.isFile()) return { ...at, state: UNREADABLE };
    if (info.size > maxBytes) return { ...at, state: OVERSIZE };
    const bytes = await handle.readFile();
    if (bytes.length > maxBytes) return { ...at, state: OVERSIZE };
    return { ...at, bytes: new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.length) };
  } catch { return { ...at, state: UNREADABLE }; }
  finally { await handle?.close().catch(() => {}); }
}

// ---- git, read only ---------------------------------------------------------------------------------------------------

/** Git's own arguments for every call: optional locks off (a `git diff` never refreshes and writes the index), no
 *  file-system monitor, no colour, paths unquoted. */
const GIT_FLAGS = Object.freeze(['--no-optional-locks', '-c', 'core.fsmonitor=false', '-c', 'core.quotePath=false',
  '-c', 'color.ui=never']);
/** The environment git runs in: the caller's, without any GIT_* variable (which could point it at another repository,
 *  index or diff program), with optional locks off. */
const gitEnvironment = (env = process.env) => ({ ...Object.fromEntries(Object.entries(env)
  .filter(([key]) => !key.startsWith('GIT_'))), GIT_OPTIONAL_LOCKS: '0', LC_ALL: 'C' });
/** Run git with `args` in `cwd`: `{ ok, stdout }` (a Buffer), never a throw. `maxBuffer` bounds what it may print;
 *  `differ` reads exit status 1 as an answer (`git diff --no-index` exits 1 when the two sides differ). */
export function runGit(args, { cwd, maxBuffer = 64 * 1024 * 1024, differ = false }) {
  return new Promise((done) => {
    execFile('git', [...GIT_FLAGS, ...args], { cwd, maxBuffer, encoding: 'buffer', env: gitEnvironment(),
      windowsHide: true }, (error, stdout) => {
      if (!error) return done({ ok: true, stdout });
      if (differ && error.code === 1 && Buffer.isBuffer(stdout)) return done({ ok: true, stdout });
      return done({ ok: false, stdout: null, overflow: error?.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER' });
    });
  });
}
const out = (result) => (result.ok ? result.stdout.toString('utf8') : null);
const HASH = /^[0-9a-f]{40}(?:[0-9a-f]{24})?$/;
/** A reflog selector as `git log -g --date=unix --format=%gd` prints it: `HEAD@{<unix seconds>}`. */
const REFLOG_SELECTOR = /^HEAD@\{(\d+)\}$/;

/**
 * The recording's opening facts, by structure: the first timestamp a row carries (Claude Code rows and Codex lines
 * carry an ISO `timestamp`) and the commit a Codex rollout's `session_meta` names (`payload.git.commit_hash`). Reads at
 * most the first `maxLines` lines; never a message's words. `{ at, commit }`, each null when not found.
 */
export async function recordingStart(file, { maxLines = 200 } = {}) {
  const found = { at: null, commit: null };
  if (typeof file !== 'string' || !file) return found;
  let input = null, lines = null;
  try {
    input = createReadStream(file, { encoding: 'utf8' });
    lines = createInterface({ input, crlfDelay: Infinity });
    let seen = 0;
    for await (const line of lines) {
      if (++seen > maxLines) break;
      if (!line.trim()) continue;
      const parsed = strictJson(line);
      if (!parsed.strict || !parsed.value || typeof parsed.value !== 'object' || Array.isArray(parsed.value)) continue;
      const row = parsed.value;
      if (found.at === null && typeof row.timestamp === 'string' && Number.isFinite(Date.parse(row.timestamp)))
        found.at = row.timestamp;
      const commit = row.type === 'session_meta' ? row.payload?.git?.commit_hash : null;
      if (found.commit === null && typeof commit === 'string' && HASH.test(commit)) found.commit = commit;
      if (found.at !== null && found.commit !== null) break;
    }
  } catch { /* an unreadable recording names no start */ }
  finally { lines?.close(); input?.destroy(); }
  return found;
}

/**
 * The session's start commit in the repository at `top`, by structure: the commit the recording names, when git has
 * it; else the HEAD reflog entry in effect at the recording's first timestamp (the newest one made at or before it);
 * else the newest first-parent commit of HEAD committed at or before it. `{ commit, how }` or null.
 */
export async function startCommit({ top, start, git = runGit }) {
  if (start?.commit && (await git(['cat-file', '-e', `${start.commit}^{commit}`], { cwd: top })).ok)
    return { commit: start.commit, how: FROM_RECORDING };
  const at = typeof start?.at === 'string' ? Date.parse(start.at) : NaN;
  if (!Number.isFinite(at)) return null;
  const seconds = Math.floor(at / 1000);
  const reflog = out(await git(['log', '-g', '--date=unix', '--format=%H%x09%gd', 'HEAD'], { cwd: top }));
  for (const line of (reflog ?? '').split('\n')) {
    const [hash, selector] = line.split('\t');
    const when = REFLOG_SELECTOR.exec(selector ?? '');
    if (HASH.test(hash ?? '') && when && Number(when[1]) <= seconds) return { commit: hash, how: FROM_REFLOG };
  }
  const dated = out(await git(['rev-list', '-1', '--first-parent', `--before=${seconds}`, 'HEAD'], { cwd: top }))?.trim();
  return dated && HASH.test(dated) ? { commit: dated, how: FROM_COMMIT_DATE } : null;
}

/** git's `--name-status -z` list: status letter, then path, NUL-separated (no renames are asked for). */
function nameStatus(text) {
  const parts = text.split('\0');
  const changes = [];
  for (let at = 0; at + 1 < parts.length; at += 2) {
    const status = parts[at][0];
    const type = status === 'A' ? ADDED : status === 'D' ? DELETED_TYPE : status === 'M' || status === 'T' ? MODIFIED : null;
    if (type && parts[at + 1]) changes.push({ gitPath: parts[at + 1], type });
  }
  return changes;
}

/** How many entries a `-z` list holds. */
const entries = (text) => text.split('\0').filter(Boolean).length;

/**
 * The git base of a review under `root`: the repository's top folder, the start commit (`startCommit`) and every path
 * under the working directory that differs from it now — git's own list of tracked paths, then the untracked ones (not
 * ignored) a recorded edit names (`recorded`, as the code step names them) or whose modification time is at or after
 * the session's start — each with its path as the code step names it (`displayPath` under `root`) and its type. Git is
 * asked for paths under the working directory alone (a literal pathspec of it, from the top folder): a path elsewhere
 * in the repository is never listed by name, only counted (`outside`: how many tracked paths differ outside it). Null
 * when there is none.
 */
export async function readGitBase({ root, start, recorded = new Set(), seen = recorded, homes = [], git = runGit }) {
  const topText = out(await git(['rev-parse', '--show-toplevel'], { cwd: root }));
  if (!topText) return null;
  const top = topText.endsWith('\n') ? topText.slice(0, -1) : topText;
  const realTop = await realpath(top).catch(() => null);
  if (!realTop) return null;
  const realRoot = await realpath(root).catch(() => null);
  if (!realRoot || !inside(realRoot, realTop)) return null;
  const found = await startCommit({ top: realTop, start, git });
  if (!found) return null;
  const below = relative(realTop, realRoot).split(sep).join('/');
  // The working directory as git's pathspec, from the top folder: every path under it, read literally.
  const scope = below ? [`:(top,literal)${below}`] : [];
  const listed = out(await git(['diff', '--name-status', '--no-renames', '-z', found.commit, '--', ...scope],
    { cwd: realTop }));
  if (listed === null) return null;
  let outside = 0;
  if (below) {
    const all = out(await git(['diff', '--name-only', '--no-renames', '-z', found.commit, '--'], { cwd: realTop }));
    if (all === null) return null;
    outside = Math.max(0, entries(all) - entries(listed) / 2);
  }
  const named = (gitPath) => displayPath(join(realTop, gitPath), realRoot);
  // The release review (medium): the repository is the home folder, or holds it — by structure, the repository's real
  // top folder against the home folder as given and as it really is (`homes`), never by a name. Then a path is read only
  // when the session itself recorded changing or reading it (`seen`: its typed changes and reads, as the code step names
  // them); every other path git shows differing is counted (`unrecorded`), never named or read, and git is never asked
  // to walk the home folder for untracked files: only the recorded paths are asked about, one by one.
  const homeRepository = homes.some((home) => typeof home === 'string' && isAbsolute(home) && inside(home, realTop));
  const all = nameStatus(listed).map((c) => ({ ...c, path: named(c.gitPath) }));
  const changes = homeRepository ? all.filter((c) => seen.has(c.path)) : all;
  const unrecorded = all.length - changes.length;
  const untracked = homeRepository ? await recordedUntracked({ seen, realTop, realRoot, git })
    : (out(await git(['ls-files', '--others', '--exclude-standard', '-z', '--', ...scope], { cwd: realTop })) ?? '')
      .split('\0').filter(Boolean);
  const since = typeof start?.at === 'string' ? Date.parse(start.at) : NaN;
  for (const gitPath of untracked) {
    const path = named(gitPath);
    if (homeRepository && !seen.has(path)) continue;
    let fresh = false;
    if (!recorded.has(path) && Number.isFinite(since)) {
      try { fresh = (await stat(join(realTop, gitPath))).mtimeMs >= since; } catch { fresh = false; }
    }
    if (recorded.has(path) || fresh) changes.push({ gitPath, type: ADDED, path, untracked: true });
  }
  return { top: realTop, commit: found.commit, how: found.how, changes, outside,
    ...(homeRepository ? { homeRepository: true, unrecorded } : {}) };
}

/** How many recorded paths one `git ls-files` call asks about: a frozen literal that keeps one command line short. */
const PATHSPECS_PER_CALL = 200;
/**
 * The release review (medium), with the home folder as the repository: which of the paths the session recorded
 * changing or reading (`seen`) git lists as untracked and not ignored — asked by those paths alone, each a literal
 * pathspec of a file there now under the working directory (never a folder, which would list everything under it, and
 * never the working directory itself), so git never walks the home folder. Git's paths, from the top folder. Names only.
 */
async function recordedUntracked({ seen, realTop, realRoot, git }) {
  const specs = [];
  for (const path of [...seen].sort()) {
    if (!namedUnderRoot(path)) continue;
    const absolute = join(realRoot, path);
    if (absolute === realRoot || !inside(absolute, realRoot)) continue;
    let info = null;
    try { info = await lstat(absolute); } catch { info = null; }
    if (info === null || info.isDirectory()) continue;
    specs.push(`:(top,literal)${relative(realTop, absolute).split(sep).join('/')}`);
  }
  const found = [];
  for (let at = 0; at < specs.length; at += PATHSPECS_PER_CALL) {
    const listed = out(await git(['ls-files', '--others', '--exclude-standard', '-z', '--',
      ...specs.slice(at, at + PATHSPECS_PER_CALL)], { cwd: realTop }));
    found.push(...(listed ?? '').split('\0').filter(Boolean));
  }
  return found;
}

/** git's mode of a symbolic link in a tree. */
const LINK_MODE = '120000';
/**
 * The fourth review of the code step (L1): whether a differing path was a symbolic link at the start commit (git's
 * mode LINK_MODE, from its tree entry) whose target, placed from the link's folder, lies in a harness home by any rule
 * `inAnyHarnessHome` reads, there or not (`wherever`). Reads git's tree entry, and for a link alone its target (the
 * blob of a link is its target path): names only, never a file's words. A path that was no link, or a link git cannot
 * read, is not one (its base and patch are read, or found unreadable, as before).
 */
async function startLinkInHarness(change, { top, commit, git, ...where }) {
  if (change.type === ADDED) return false;
  const entry = await git(['ls-tree', '-z', commit, '--', `:(literal)${change.gitPath}`], { cwd: top, maxBuffer: 65536 });
  if (!entry.ok || !entry.stdout.toString('utf8').startsWith(`${LINK_MODE} `)) return false;
  const blob = await git(['cat-file', 'blob', `${commit}:${change.gitPath}`], { cwd: top, maxBuffer: 65536 });
  if (!blob.ok) return false;
  const place = resolve(dirname(join(top, change.gitPath)), blob.stdout.toString('utf8'));
  return inAnyHarnessHome([place], new Map([[place, await wherever(place)]]), where);
}

/** The file at the start commit and git's own patch of one differing path, for a path the reader showed or found
 *  deleted:`{ base: { bytes } | { state } | null, patch: string | null }`. Nothing is read of any other. */
async function readGitSide(change, head, { top, commit, maxBytes, git }) {
  const readable = head.bytes instanceof Uint8Array;
  const deleted = head.state === DELETED;
  if (!(readable && change.type !== DELETED_TYPE) && !(deleted && change.type === DELETED_TYPE)) return {};
  let base = null;
  if (change.type !== ADDED) {
    const blob = await git(['cat-file', 'blob', `${commit}:${change.gitPath}`], { cwd: top, maxBuffer: maxBytes });
    base = blob.ok ? { bytes: new Uint8Array(blob.stdout.buffer, blob.stdout.byteOffset, blob.stdout.length) }
      : { state: blob.overflow ? OVERSIZE : UNREADABLE };
  }
  // An untracked file: git's own diff of it from nothing, so its attributes (`binary`, `-diff`) hold as for a tracked one.
  const patch = change.untracked
    ? await git(['diff', '--no-index', '--no-color', '--no-ext-diff', '--no-textconv', '-U3', '--', '/dev/null',
      change.gitPath], { cwd: top, maxBuffer: maxBytes * 4 + 65536, differ: true })
    : await git(['diff', '--no-color', '--no-ext-diff', '--no-textconv', '--no-renames', '-U3', commit, '--',
      `:(literal)${change.gitPath}`], { cwd: top, maxBuffer: maxBytes * 4 + 65536 });
  return { base, patch: patch.ok ? patch.stdout.toString('utf8') : null };
}

/**
 * The frozen snapshot of `session`'s files under `root` (the recorded working directory, absolute), as they are now,
 * and the diff the code step reviews: `{ root: true, dir, base, plan, files }`, or `{ root: false, plan, files: [] }`
 * when there is no root to read under (the recording names none, or it is not a directory now) — the pass then does
 * not run. `home` is the user's home folder; `harness` the absolute harness homes this computer names, and the one
 * that wrote the recording (a file whose real path lies in one, outside its worktrees, is `harness_home`); `maxBytes`
 * is the most one file may be (the
 * review's request bound); `recording` the recording's path (its opening timestamp and commit place the start commit);
 * `git` runs git (a test may pass another). `base` is `{ kind: 'git', commit, how }` or `{ kind: 'recorded_edits' }`.
 * Reads only; writes nothing.
 */
export async function readCodeSnapshot(session, { root, home = null, harness = [], maxBytes, recording = null,
  git = runGit }) {
  const none = { root: false, plan: codeSnapshotPlan(session), files: [] };
  if (typeof root !== 'string' || !isAbsolute(root)) return none;
  const dir = resolve(root);
  let realRoot = null;
  try { realRoot = await realpath(dir); } catch { return none; }
  try { if (!(await stat(realRoot)).isDirectory()) return none; }
  catch { return none; }
  const recordedPlan = codeSnapshotPlan(session, { root: dir });
  const given = typeof home === 'string' && isAbsolute(home) ? resolve(home) : null;
  const realHome = given === null ? null : (await wherever(given))?.real ?? null;
  const homes = given === null ? [null] : [...new Set([given, realHome ?? given])];
  // The harness homes: the default ones under the home folder, the ones this computer sets and the one that wrote the
  // recording (the caller's `harness`), each as given and wherever it really leads (a home that is a link, even one
  // whose folder is gone).
  const dirs = [];
  const defaults = given === null ? [] : [join(given, '.claude'), join(given, '.codex')];
  for (const entry of [...defaults, ...(Array.isArray(harness) ? harness : [])]) {
    if (typeof entry !== 'string' || !isAbsolute(entry)) continue;
    const resolved = resolve(entry);
    const real = (await wherever(resolved))?.real ?? null;
    for (const at of [resolved, real]) if (at !== null && !dirs.includes(at)) dirs.push(at);
  }
  // The diff's base: git's, when the working directory is in a repository whose start commit can be placed. With the
  // home folder as the repository (or inside it), only the paths the session recorded changing or reading are read.
  const recorded = new Set(recordedPlan.filter((e) => e.changed).map((e) => e.path));
  const seen = new Set(recordedPlan.map((e) => e.path));
  const gitBase = await readGitBase({ root: dir, start: await recordingStart(recording), recorded, seen,
    homes: homes.filter((at) => at !== null), git });
  const types = new Map((gitBase?.changes ?? []).map((c) => [c.path, c]));
  const plan = [];
  for (const entry of recordedPlan.filter((e) => e.changed)) plan.push(entry);
  for (const change of [...types.values()].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0)))
    if (!recorded.has(change.path)) plan.push({ path: change.path, recordedPath: join(gitBase.top, change.gitPath),
      changed: true, recorded: false, outside: false, last: null, edits: [] });
  for (const entry of recordedPlan.filter((e) => !e.changed)) if (!types.has(entry.path)) plan.push(entry);
  const reads = [];
  const where = { root: dir, realRoot, home: given, homes, harness: dirs };
  for (const entry of plan) {
    let head = await readEntry(entry, { ...where, maxBytes });
    const change = types.get(entry.path);
    if (!change) { reads.push(head); continue; }
    // A link into a harness home at the start commit: never named, its target never sent (`startLinkInHarness`).
    if (head.state !== HARNESS_HOME && await startLinkInHarness(change, { top: gitBase.top, commit: gitBase.commit, git,
      ...where })) head = { path: entry.path, state: HARNESS_HOME };
    const side = await readGitSide(change, head, { top: gitBase.top, commit: gitBase.commit, maxBytes, git });
    reads.push({ ...head, type: change.type, ...side });
  }
  const base = gitBase ? { kind: GIT_BASE, commit: gitBase.commit, how: gitBase.how, outside: gitBase.outside,
    ...(gitBase.homeRepository ? { homeRepository: true, unrecorded: gitBase.unrecorded } : {}) }
    : { kind: RECORDED_EDITS_BASE };
  return { root: true, dir, base, plan, files: freezeCodeSnapshot(plan, reads, { base }) };
}

/** The snapshot's file texts (readable files, and the start commit's text of each differing one): what the output
 *  masking scans (redact `peopleSecretsOfTexts`). */
export const snapshotTexts = (snapshot) => (Array.isArray(snapshot?.files) ? snapshot.files : [])
  .flatMap((file) => [file?.text, file?.base?.text]).filter((text) => typeof text === 'string');
