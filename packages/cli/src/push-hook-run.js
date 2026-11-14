// D225 (item 10, C3): the hidden `sonah pre-push <remote> <url>`, which the push script (push-hook.js) runs at each push
// of a repository with Sonah's push hook. Ported from the private laptop client's pre-push.mjs (sonah-hosted
// client/pre-push.mjs). git's ref lines arrive on standard input; each pushed branch leaves one ticket in the
// repository's queue (push-queue.js), and a newer push of a branch replaces its waiting ticket. It reviews at most
// PUSH_BRANCHES_MAX branches of one push, the newest tips first, and names the rest in one line (the plan's A7).
//
// It starts nothing, and leaves no ticket, when: the repository is not on Sonah's list (team/hooks.json); this computer
// has no connection, or one that Sonah cannot read; the connection carries the refused mark (its server no longer takes
// its token); CI is set (the plan's decision 6); or the connection is to another server than the hook's (risk 4). The
// last three, and no connection, are said in one line each, since they need the person; a repository not on the list
// and CI say nothing. A deleted branch and a tag leave nothing.
// D227 (item 10, C4): each ticket's run is recorded as `waiting` in team/runs.json (a replaced one `replaced`), and the
// hook starts the repository's runner, `sonah push-run --repo <its folder>` (push-run.js), when none is going
// (push-queue.js `runnerGoing`): detached in a session and process group of its own, with no terminal and nothing on
// its standard streams, at low priority (`nice -n 10`, else as it is with its priority lowered), in the hook's
// environment without the GIT_ settings git gave the hook (`runEnv`). A runner that is going takes the new tickets too.
// Its line says that Sonah reviews the branches in the background. D227 review 0: not under macOS's background policy
// (`taskpolicy -b`), which runs a process only on what the rest of the computer leaves: on a computer kept busy, the
// review was starved until its time ran out. At nice 10 it yields to the person's work and still gets its share.
//
// The hook never slows, stops or fails a push. The entry (bin/sonah.js) dispatches it before anything else, with a crash
// handler of its own (any crash: exit 0 and no word) and a 5-second cap; this reads standard input for at most 2 seconds,
// keeps at most 1 MB of it and drains the rest. Its lines go to standard error, each after `sonah: `; standard output
// stays empty. It makes no network call and no model call, and loads only Node's modules and the light team modules.
// D225 review (second look 1): that last line is now held by a test, since Node evaluates the whole static import
// closure of this module before a push goes on, and nothing else would show an import added behind it. The closure is
// named, module by module, in d225-push-hook.test.js (`PRE_PUSH_MODULES`), and any change to it fails that test. It
// reached visual-command.js through push-queue.js and team-home.js, and the code snapshot, the code pass and the whole
// decisions ledger behind it — 36 files and 2.0 MB of frozen data to evaluate at every push — for one address check
// (`visualServer`, now visual-server.js) and two closed lists (now evidence/src/push-run-states.js).
// D229 (item 10, C6): the hook also says how many comments of your team wait for you on a branch of this push, from
// the cache the push run keeps (fix-waiting.js `readWaiting`, `waitingOn`): no network call of its own, and nothing of
// the words of a teammate, only the count and the pull request. One line for each branch it reviews, so a push of many
// branches says at most PUSH_BRANCHES_MAX of them, as its own lines do. The repository is the one the URL git gave the
// hook names (team-git.js `remoteRepository`, which this module reads without visual-command.js, as the closure
// requires). A comment that `sonah fix` started Claude Code on is left out until the next refresh says how it stands.
// Nothing here stops the lines of the push: the reading sits in its own try.
//
// No work at import.
import { spawn } from 'node:child_process';
import { realpath } from 'node:fs/promises';
import { setPriority } from 'node:os';
import { fileURLToPath } from 'node:url';
import { readWaiting, repoKeyOf, waitingOn } from './fix-waiting.js';
import { PUSH_BRANCHES_MAX, leaveTicket, runnerGoing } from './push-queue.js';
import { commitTimes, commonDirOf, gitOut, isRemoteName, remoteRepository, SHA } from './team-git.js';
import { isRefused, readConnection, readHooks, updateRuns } from './team-home.js';

/** How long the hook reads standard input, and the most of it that it keeps. */
export const PRE_PUSH_STDIN_MS = 2000;
export const PRE_PUSH_STDIN_BYTES = 1024 * 1024;
/** The most branches the line of the rest names; it counts any more. */
const REST_NAMED_MAX = 10;
const ZERO = /^0+$/;

/** D227: the entry that the runner runs (this install's), and the runner's CPU priority. */
const SONAH_CLI = fileURLToPath(new URL('../bin/sonah.js', import.meta.url));
const NICE = 10;

/** The lines of `sonah pre-push`, each said on standard error after `sonah: `. */
export const PRE_PUSH_WORDS = Object.freeze({
  // D227: the runner started, or one that is going takes the tickets; `queued` when no runner could start.
  started: (branches) => `Sonah reviews ${branches.join(', ')} in the background (sonah status).`,
  behind: (branches) => `Sonah reviews ${branches.join(', ')} in the background, after the push that it reviews now `
    + '(sonah status).',
  queued: (branches) => `Sonah keeps ${branches.join(', ')} for review (sonah status).`,
  rest: (branches, more) => `Sonah reviews at most ${PUSH_BRANCHES_MAX} branches of one push, the newest first. It `
    + `leaves out ${branches.join(', ')}${more ? ` and ${more} more` : ''}.`,
  // D229: the comments that wait for you on one pushed branch, from the cache (fix-waiting.js `waitingOn`); `where` is
  // the pull request they are all on, else the branch.
  waiting: (count, where) => `${count === 1 ? '1 comment waits' : `${count} comments wait`} for you on ${where} `
    + '(sonah fixes).',
  notConnected: 'This computer has no connection to Sonah Team, so Sonah does not review this push. Run sonah connect '
    + '<code> to connect it.',
  unreadable: 'Sonah cannot read its connection to Sonah Team, so Sonah does not review this push. Run sonah status.',
  refused: (server) => `${server} no longer takes the token of this computer, so Sonah does not review this push. Run `
    + 'sonah disconnect, then sonah connect with a new code.',
  otherServer: (hook, server) => `The push hook of this repository is for ${hook}, and this computer has its connection `
    + `to ${server}. Sonah does not review this push. Run sonah hook add --push to move the hook to ${server}.`,
});

/** git's pre-push lines -> `[{ branch, sha }]`: pushed branches only (no deletes, no tags); a branch's last line wins. */
export function pushedBranches(text) {
  const out = new Map();
  for (const line of String(text ?? '').split('\n')) {
    const [, sha, ref] = line.trim().split(' ');
    if (!SHA.test(sha ?? '') || ZERO.test(sha) || !ref?.startsWith('refs/heads/') || ref.length <= 11) continue;
    out.set(ref.slice(11), sha);
  }
  return [...out].map(([branch, sha]) => ({ branch, sha }));
}

/** What git gave the hook as the remote: a name, or a URL with any user and password in it taken out; null for a word
 *  that git would read as an option, or one with a NUL or a line break. */
export function remoteArg(text) {
  if (typeof text !== 'string' || !text || text.startsWith('-') || /[\0\n\r]/.test(text)) return null;
  return text.replace(/^([a-z][a-z0-9+.-]*:\/\/)[^/@]*@/i, '$1');
}

/** Standard input, as git gives the hook its refs: at most PRE_PUSH_STDIN_BYTES kept, the rest read and dropped, for at
 *  most PRE_PUSH_STDIN_MS. A terminal is not read. */
export function readRefs(input, { ms = PRE_PUSH_STDIN_MS, max = PRE_PUSH_STDIN_BYTES } = {}) {
  if (!input || input.isTTY) return Promise.resolve('');
  return new Promise((done) => {
    let text = '';
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      input.removeListener('data', onData);
      input.pause?.();
      done(text);
    };
    const onData = (chunk) => { if (text.length < max) text += String(chunk).slice(0, max - text.length); };
    const timer = setTimeout(finish, ms);
    input.setEncoding?.('utf8');
    input.on('data', onData);
    input.once('end', finish); input.once('close', finish); input.once('error', finish);
  });
}

// D227: the environment of the runner: the hook's, without the GIT_ settings that git gave the hook (the runner finds
// its own repository) but those of SSH and of where git reads its config, and without the test runner's marker.
const GIT_KEPT = Object.freeze(['GIT_SSH', 'GIT_SSH_COMMAND', 'GIT_SSH_VARIANT', 'GIT_CONFIG_GLOBAL', 'GIT_CONFIG_SYSTEM',
  'GIT_CONFIG_NOSYSTEM']);
export function runEnv(env = process.env) {
  const out = {};
  for (const [key, value] of Object.entries(env)) {
    if ((key.startsWith('GIT_') && !GIT_KEPT.includes(key)) || key === 'NODE_TEST_CONTEXT') continue;
    out[key] = value;
  }
  return out;
}

/** D227: the ways to start the runner, best first: nice, then as it is (its priority then lowered by its pid). D227
 *  review 0: the same on every platform, with no `taskpolicy -b` on macOS. */
export function launchers(argv) {
  const nice = ['nice', ['-n', String(NICE), ...argv]];
  const plain = [argv[0], argv.slice(1), true];
  return [nice, plain];
}

/** D227: starts `sonah push-run --repo <repo>` detached, in its own session and process group, with no terminal and
 *  nothing on its standard streams: true once one way started it, false when none could. */
export function startPushRun({ repo, env = process.env, spawnFn = spawn, node = process.execPath, cli = SONAH_CLI }) {
  const ways = launchers([node, cli, 'push-run', '--repo', repo]);
  return new Promise((done) => {
    const launch = (i) => {
      if (i >= ways.length) { done(false); return; }
      const [command, args, renice] = ways[i];
      let child, started = false;
      try { child = spawnFn(command, args, { cwd: repo, env: runEnv(env), detached: true, stdio: 'ignore' }); }
      catch { launch(i + 1); return; }
      child.once('error', () => { if (!started) launch(i + 1); });
      child.once('spawn', () => {
        started = true;
        if (renice) try { setPriority(child.pid, NICE); } catch { /* it still runs */ }
        child.unref();
        done(true);
      });
    };
    launch(0);
  });
}

/** The pushes, the newest tip first (its committer time; a tip git cannot date goes last), then in git's order. */
async function newestFirst(dir, pushes, git) {
  const times = await commitTimes(dir, pushes.map((p) => p.sha), { git, timeoutMs: 3000 });
  return pushes.map((p, i) => ({ ...p, i, time: times.get(p.sha) ?? -Infinity }))
    .sort((a, b) => b.time - a.time || a.i - b.i).map(({ branch, sha }) => ({ branch, sha }));
}

/** `sonah pre-push <remote> <url>`: leaves the tickets and says its lines; never throws for a reason of its own, and
 *  its caller exits 0 whatever happens. `env.CI` set to anything but the empty string turns it off. D227: `start`
 *  starts the runner (`startPushRun`'s shape; tests pass their own). */
export async function runPrePush(argv, { stdin = process.stdin, stderr = process.stderr, env = process.env,
  cwd = process.cwd(), git = gitOut, platform = process.platform, now = Date.now, start = startPushRun } = {}) {
  const text = await readRefs(stdin);
  if (platform === 'win32' || (typeof env.CI === 'string' && env.CI !== '')) return;
  const pushes = pushedBranches(text);
  if (!pushes.length) return;
  const where = { env };
  const common = await commonDirOf(cwd, { git });
  if (common === null) return;
  const listed = await readHooks(where);
  const entry = listed.state === 'ok' ? listed.repos.find((r) => r.common === common) : null;
  if (!entry) return;
  const say = (line) => stderr.write(`sonah: ${line}\n`);
  const saved = await readConnection(where);
  if (saved.state === 'absent') { say(PRE_PUSH_WORDS.notConnected); return; }
  if (saved.state === 'invalid') { say(PRE_PUSH_WORDS.unreadable); return; }
  const { server, login } = saved.connection;
  if (await isRefused(saved.connection, where)) { say(PRE_PUSH_WORDS.refused(server)); return; }
  if (entry.server !== server) { say(PRE_PUSH_WORDS.otherServer(entry.server, server)); return; }
  const ordered = await newestFirst(cwd, pushes, git);
  const kept = ordered.slice(0, PUSH_BRANCHES_MAX), rest = ordered.slice(PUSH_BRANCHES_MAX);
  const dir = await realpath(cwd);
  const remote = remoteArg(argv[0]);
  const left = [];
  for (const { branch, sha } of kept) {
    left.push(await leaveTicket(where, { common, dir, branch, sha, remote, server, login, at: now() }));
  }
  // D227: each ticket's run waits, a replaced one is replaced; a failure here never stops the push.
  await updateRuns(where, (runs) => {
    const replaced = new Set(left.map((l) => l.replaced?.id).filter(Boolean));
    const at = new Date().toISOString();
    return [...runs.map((r) => (replaced.has(r.id) && (r.state === 'waiting' || r.state === 'queued')
      ? { ...r, state: 'replaced', why: 'newer_push', updatedAt: at } : r)),
    ...left.map(({ ticket: t }) => ({ id: t.id, state: 'waiting', why: null, common, dir, branch: t.branch, sha: t.sha,
      server, login, at: new Date(t.at).toISOString(), updatedAt: at,
      remote: isRemoteName(remote) ? remote : null }))];
  }).catch(() => {});
  const names = kept.map((p) => p.branch);
  // one runner per repository: a going one takes these tickets too
  if (await runnerGoing(where, common)) say(PRE_PUSH_WORDS.behind(names));
  else if (await start({ repo: dir, env, platform })) say(PRE_PUSH_WORDS.started(names));
  else say(PRE_PUSH_WORDS.queued(names));
  if (rest.length) {
    const named = rest.slice(0, REST_NAMED_MAX).map((p) => p.branch);
    say(PRE_PUSH_WORDS.rest(named, rest.length - named.length));
  }
  // D229: one line a pushed branch that comments wait on, from the cache of this connection. Only a reminder: a cache
  // that cannot be read says nothing, and the push goes on.
  try { for (const line of await waitingLines(where, saved.connection, kept, argv[1])) say(line); }
  catch { /* only a reminder */ }
}

/** D229: the lines of the comments that wait on the branches of this push that Sonah reviews, from the cache of the
 *  repository that git pushes to (its URL, as git gave the hook). No network call. */
export async function waitingLines(where, connection, pushes, url) {
  const named = remoteRepository(remoteArg(url) ?? '');
  if (!named) return [];
  const entry = (await readWaiting(where, connection))[repoKeyOf(named.owner, named.name)];
  if (!entry) return [];
  const lines = [];
  for (const { branch } of pushes) {
    const waits = waitingOn(entry, branch);
    if (waits) lines.push(PRE_PUSH_WORDS.waiting(waits.count, waits.number === null ? branch : `PR #${waits.number}`));
  }
  return lines;
}

/** The kind of each of this file's word tables, for the style linter (packages/render/test/style-lint.js). */
export const STYLE_KINDS = Object.freeze({ PRE_PUSH_WORDS: 'notice' });
const SERVER = 'https://pr.sonah.dev';
export const STYLE_FIXTURES = Object.freeze({
  'PRE_PUSH_WORDS.started': [[['feature-x']], [['feature-x', 'fix-y']]],
  'PRE_PUSH_WORDS.behind': [[['feature-x']], [['feature-x', 'fix-y']]],
  'PRE_PUSH_WORDS.queued': [[['feature-x']], [['feature-x', 'fix-y']]],
  'PRE_PUSH_WORDS.rest': [[['old-a', 'old-b'], 0], [['old-a'], 12]],
  'PRE_PUSH_WORDS.waiting': [[1, 'PR #12'], [3, 'feature-x']],
  'PRE_PUSH_WORDS.refused': [[SERVER]],
  'PRE_PUSH_WORDS.otherServer': [[SERVER, 'http://127.0.0.1:8080']],
});
