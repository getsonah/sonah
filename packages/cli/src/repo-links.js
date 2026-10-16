// The repository's facts the report's code links need (D97): read with local git only, after the
// review, in the same process, from the code step's snapshot of the repository (`snapshot.top`, the repository's real
// top folder; `snapshot.realRoot`, the session's working directory). Nothing here reaches the network: every git call
// is one of the argv shapes `REPO_FACT_GIT_ARGS` lists, and none of them fetches, pushes or asks a remote. The render
// stays pure: the CLI passes these facts in (`options.repo`, `options.github`), and the report model validates them
// again before it builds a link.
//
// Parsing a remote's URL in GitHub's documented forms is structure, not meaning: any other host or form gives no
// GitHub facts, so no link.
import { createHash } from 'node:crypto';
import { realpath } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, relative, sep } from 'node:path';
import { runGit } from './code-snapshot.js';

/**
 * Every git argv this file may run, as a shape: a literal word, or a slot (`<remote>`, `<object>`, `<commit>`,
 * `<path>`) that takes one value which never starts with `-`. Local reads only: the HEAD commit, the current branch's
 * upstream, the remotes and their URLs, a blob or an object's presence at a commit, the remote-tracking branches that
 * hold a commit, and whether git ignores a path. `repoGitAllowed` checks an argv against it before every call.
 */
export const REPO_FACT_GIT_ARGS = Object.freeze([
  Object.freeze(['rev-parse', '--verify', '--quiet', 'HEAD^{commit}']),
  Object.freeze(['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{upstream}']),
  Object.freeze(['remote']),
  Object.freeze(['remote', 'get-url', '<remote>']),
  Object.freeze(['cat-file', 'blob', '<object>']),
  Object.freeze(['cat-file', '-e', '<object>']),
  Object.freeze(['branch', '-r', '--contains', '<commit>']),
  Object.freeze(['check-ignore', '-q', '--', '<path>']),
]);
const SLOT = /^<[a-z]+>$/;
/** Whether an argv is one of `REPO_FACT_GIT_ARGS`: the same words, each slot one value that does not start with `-`
 *  and holds no line break. */
export const repoGitAllowed = (args) => Array.isArray(args) && REPO_FACT_GIT_ARGS.some((shape) => shape.length === args.length
  && shape.every((word, i) => (SLOT.test(word) ? typeof args[i] === 'string' && args[i] !== '' && !args[i].startsWith('-')
    && !/[\r\n\0]/.test(args[i]) : args[i] === word)));

const HASH = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;
const NAME = /^[A-Za-z0-9._-]+$/;
/** A GitHub owner or repository name: the characters GitHub allows, never `.` or `..`. */
const githubName = (name) => typeof name === 'string' && NAME.test(name) && name !== '.' && name !== '..';
/** A path of the change as the report links it: relative, forward slashes, no empty, `.` or `..` segment. */
const linkablePath = (path) => typeof path === 'string' && path !== '' && !path.startsWith('/') && !path.includes('\\')
  && !/[\r\n\0]/.test(path) && path.split('/').every((part) => part !== '' && part !== '.' && part !== '..');

/**
 * The GitHub repository a remote URL names, in one of GitHub's documented forms — `https://github.com/O/R`,
 * `git@github.com:O/R` or `ssh://git@github.com/O/R`, each with or without `.git` — as `{ owner, repo }`; null for any
 * other host (GitHub Enterprise's included) or form.
 */
export function githubRemoteOf(url) {
  if (typeof url !== 'string') return null;
  const m = /^(?:https:\/\/github\.com\/|git@github\.com:|ssh:\/\/git@github\.com\/)([^/]+)\/([^/]+)$/.exec(url.trim());
  if (!m) return null;
  const owner = m[1];
  const repo = m[2].endsWith('.git') ? m[2].slice(0, -4) : m[2];
  return githubName(owner) && githubName(repo) ? { owner, repo } : null;
}

/** Runs an allowed git argv; anything else is refused without running. `{ ok, stdout }` (a Buffer), never a throw. */
async function allowedGit(git, args, cwd) {
  if (!repoGitAllowed(args)) return { ok: false, stdout: null, refused: true };
  try { return await git(args, { cwd }); } catch { return { ok: false, stdout: null }; }
}
const text = (result) => (result?.ok && result.stdout ? result.stdout.toString('utf8') : null);
const lines = (value) => (value ?? '').split('\n').map((line) => line.trim()).filter(Boolean);

/** Whether a remote-tracking branch of `remote` holds `commit`: true, false, or null when git could not say. */
async function onRemote(git, top, remote, commit) {
  if (!HASH.test(commit ?? '') || typeof remote !== 'string') return null;
  const listed = text(await allowedGit(git, ['branch', '-r', '--contains', commit], top));
  if (listed === null) return null;
  return lines(listed).some((ref) => ref.startsWith(`${remote}/`));
}

/**
 * The facts of the repository the code step reviewed, for the report's code links (D97):
 *   - `repo`: `{ head, start, prefix, atHead, goneAtHead }`, or null when the code step took no snapshot on a git base.
 *     `head` is HEAD's commit (null before the first commit); `start` the session's start commit (`codePass.base`);
 *     `prefix` the working directory under the repository's top folder (`''` at the top); `atHead` the paths of the
 *     change's files whose bytes at HEAD hash to the sha256 the code step read; `goneAtHead` the paths of its deleted
 *     files that HEAD does not hold.
 *   - `github`: `{ owner, repo, remote, pushed, startPushed }`, or null when no remote is a GitHub repository (and
 *     undefined with no git base). `remote` is the current branch's upstream remote, else `origin`, else the only remote;
 *     `pushed` and `startPushed` whether a remote-tracking branch of it holds HEAD and the start commit (null when git
 *     could not say, or there is no such commit).
 * `git` runs git (a test passes another); it is only ever asked argv shapes of `REPO_FACT_GIT_ARGS`.
 */
export async function readRepoFacts({ snapshot, codePass, git = runGit } = {}) {
  const top = typeof snapshot?.top === 'string' && isAbsolute(snapshot.top) ? snapshot.top : null;
  const dir = typeof snapshot?.realRoot === 'string' ? snapshot.realRoot : typeof snapshot?.dir === 'string' ? snapshot.dir : null;
  if (snapshot?.root !== true || !top || !dir || codePass?.base?.kind !== 'git') return { repo: null, github: undefined };
  const realTop = await realpath(top).catch(() => top);
  const realDir = await realpath(dir).catch(() => dir);
  const below = relative(realTop, realDir);
  if (below.startsWith('..') || isAbsolute(below)) return { repo: null, github: undefined };
  const prefix = below.split(sep).join('/');
  const head = text(await allowedGit(git, ['rev-parse', '--verify', '--quiet', 'HEAD^{commit}'], realTop))?.trim() ?? null;
  const headSha = HASH.test(head ?? '') ? head : null;
  const start = HASH.test(codePass.base.commit ?? '') ? codePass.base.commit : null;
  const files = (Array.isArray(codePass.files) ? codePass.files : []).filter((f) => f && typeof f === 'object'
    && f.state !== 'outside_root' && linkablePath(f.path));
  const atHead = [], goneAtHead = [];
  if (headSha) {
    for (const f of files) {
      const object = `${headSha}:${prefix ? `${prefix}/${f.path}` : f.path}`;
      if (typeof f.sha256 === 'string' && /^[0-9a-f]{64}$/.test(f.sha256)) {
        const blob = await allowedGit(git, ['cat-file', 'blob', object], realTop);
        if (blob?.ok && Buffer.isBuffer(blob.stdout)
          && createHash('sha256').update(blob.stdout).digest('hex') === f.sha256) atHead.push(f.path);
      } else if (f.type === 'deleted' || f.state === 'deleted') {
        const there = await allowedGit(git, ['cat-file', '-e', object], realTop);
        if (!there?.ok && !there?.refused) goneAtHead.push(f.path);
      }
    }
  }
  const repo = { head: headSha, start, prefix, atHead, goneAtHead };
  // The remote: the current branch's upstream's, else origin, else the only one.
  const remotes = lines(text(await allowedGit(git, ['remote'], realTop)));
  const upstream = text(await allowedGit(git, ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{upstream}'],
    realTop))?.trim() ?? '';
  const ofUpstream = remotes.filter((name) => upstream.startsWith(`${name}/`)).sort((a, b) => b.length - a.length)[0];
  const remote = ofUpstream ?? (remotes.includes('origin') ? 'origin' : remotes.length === 1 ? remotes[0] : null);
  if (remote === null) return { repo, github: null };
  const named = githubRemoteOf(text(await allowedGit(git, ['remote', 'get-url', remote], realTop))?.trim() ?? null);
  if (!named) return { repo, github: null };
  return { repo, github: { owner: named.owner, repo: named.repo, remote,
    pushed: headSha ? await onRemote(git, realTop, remote, headSha) : null,
    startPushed: start ? await onRemote(git, realTop, remote, start) : null } };
}

/**
 * Whether any of the report files Sonah wrote (`paths`, absolute) lies in the repository the code step reviewed and is
 * not ignored by git: such a file is new to the repository on the next run, so the code step's stored answers would
 * not be reused and it would review the report as part of the change (D97). By structure: the path's place
 * under the repository's top folder and `git check-ignore`.
 */
export async function outputsInRepository({ snapshot, paths, git = runGit } = {}) {
  const top = typeof snapshot?.top === 'string' && isAbsolute(snapshot.top) ? snapshot.top : null;
  if (snapshot?.root !== true || !top) return false;
  const realTop = await realpath(top).catch(() => top);
  for (const path of Array.isArray(paths) ? paths : []) {
    if (typeof path !== 'string' || !isAbsolute(path)) continue;
    // A file's real path; one not there yet, by its folder's.
    const real = await realpath(path).catch(async () => join(await realpath(dirname(path)).catch(() => dirname(path)),
      basename(path)));
    const below = relative(realTop, real);
    if (!below || below.startsWith('..') || isAbsolute(below)) continue;
    const ignored = await allowedGit(git, ['check-ignore', '-q', '--', below.split(sep).join('/')], realTop);
    if (!ignored?.ok) return true;
  }
  return false;
}
