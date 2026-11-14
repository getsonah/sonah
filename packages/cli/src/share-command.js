// D228 (item 10, C5): `sonah share [--dir DIR] [--branch NAME] [--repo DIR]`, which puts a page that Sonah drew on this
// computer on the connected Sonah Team server: the page of the commit at HEAD that plain `sonah`, `sonah visual` or a
// push run drew (the newest finished one), or the folder --dir names. Ported from the private laptop client's `share`
// (sonah-hosted client/run.mjs `shareFolder`, `shareNewest`), with the push run's upload (push-run.js `sendFolder`):
//   the folder  --dir, else the newest finished folder of the repository under Sonah's visual folder
//               (visual-command.js `visualOutDir`), or of a run of the repository in team/runs.json, whose facts.json
//               names HEAD's commit; a page of any range ending there;
//   the branch  --branch, else the checked-out branch when its tip is the page's commit, else the first branch whose
//               tip is (visual-command.js `shareTarget`, as the page's own buttons name it); the server keeps each
//               review under its branch, so with none it stops;
//   the upload  as a push run's: the page drawn anew in mode 'hosted' under the folder's lock (D226), the branch, the
//               repository the push remote names, `sessions`, the 25 MB check, POST /api/uploads with the connection's
//               token, a 5xx or no answer tried again after 5 s and 20 s.
// The run of the page (team/runs.json) ends `shared`, with the page's link. A review of the same branch and commit that
// waits to be sent (`pending_upload`, decision 16) is that run: share sends it, and another process that holds it is
// left to send it (push-run.js `claimRun`). The ones of the branch that wait and whose place this page's took end
// `replaced` (push-run.js `takesPlaceOf`, D228 review 1: the commits say which, since share puts up the page of any
// commit of the repository; D228 review 4: the commit the branch holds says it first, read from the remote, D228 review
// 5). A 401 marks the connection refused, as a push run's does.
//
// Exit codes, as every command's (bin/sonah.js): 0 the server took the page (its link printed); 1 no finished page of
// HEAD (run sonah, or pass --dir); 2 a usage error, no connection, a problem named with its fix (ledger.js
// SHARE_PROBLEMS), or the server did not take the page (no answer: the page waits, and the next push or share sends it);
// 3 Sonah failed. What it prints is fixed words, paths, the server and the page's link: never the token.
//
// No work at import.
import { randomBytes } from 'node:crypto';
import { readdir, readFile, stat } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { isBranch, shown } from '../../visual/src/fix-prompt.mjs';
import { limitsFrom, connectionStill, localGitEnv, openLog, PUSH_RUN_WORDS, pushedTip, reviewKey, safeName,
  sendFolder, takesPlaceOf, whyWords } from './push-run.js';
import { commonDirOf, gitOut, isRemoteName, revParse, topOf } from './team-git.js';
import { isRefused, logsPath, readConnection, readRuns, updateRun, updateRuns, waitsToSend } from './team-home.js';
import { shareTarget, visualOutDir, VISUAL_DEFAULT_MODEL } from './visual-command.js';
import { lockHolder, processStart } from './visual-lock.js';

/** The command's usage, within 80 columns after `usage: `. */
export const SHARE_USAGE = 'sonah share [--dir DIR] [--branch NAME] [--repo DIR]';
/** How long a share may take, from its start: the folder's lock, the upload and its tries again. The environment may
 *  only shorten it (tests), as it may the push run's limits (push-run.js `limitsFrom`): SONAH_SHARE_DEADLINE_MS. */
export const SHARE_DEADLINE_MS = 10 * 60_000;
export function shareDeadlineMs(env = process.env) {
  const ms = Number(env.SONAH_SHARE_DEADLINE_MS);
  return Number.isSafeInteger(ms) && ms > 0 ? Math.min(ms, SHARE_DEADLINE_MS) : SHARE_DEADLINE_MS;
}
/** D228 review (second look 2, review 2): how long the reviews of the branch that wait may be ordered against this
 *  page for, once the server has taken it (`replaceOlder`). That read may ask each remote of the review which commit
 *  the branch holds (push-run.js `pushedTip`, `git ls-remote`), which is 30 seconds a name of its own and bounded by
 *  nothing else here: second look 1 gave the read to a share, second look 2 and its review 1 widened it to several
 *  names and to this clone's own cache being skipped, and the page's link was printed after it — so a share behind a
 *  proxy that blackholes the host sat a minute with the page already online and no link said, and a Ctrl-C in that
 *  window lost it from the terminal. The link is said first now, and this bounds the bookkeeping after it: the rows
 *  this read would end keep waiting, and the next pass or share orders them. */
export const SHARE_ORDER_MS = 5_000;

/** What `sonah share` says: its problems (ledger.js SHARE_PROBLEMS), each with its fix, and the page it put online. */
export const SHARE_WORDS = Object.freeze({
  problem: Object.freeze({
    share_not_git: 'This folder is in no git repository.',
    share_no_review: (sha) => `Sonah has no finished page of ${sha}, the commit at HEAD.`,
    share_not_a_review: (dir) => `${dir} holds no finished page of a commit in this repository.`,
    share_no_branch: (sha) => `No branch points at ${sha}, and Sonah Team keeps each review under its branch.`,
    share_bad_branch: 'Sonah Team takes no branch of that name.',
    share_no_repository: PUSH_RUN_WORDS.why.no_repository,
    share_folder_in_use: 'Another Sonah draws or reads the folder of this page now.',
  }),
  fix: Object.freeze({
    share_not_git: 'Run sonah share in the repository whose page you want to share, or pass --repo DIR.',
    share_no_review: 'Run sonah or sonah visual here to draw it, or pass --dir with the folder of a page.',
    share_not_a_review: 'Give --dir the folder of a page that sonah visual wrote for this repository.',
    share_no_branch: 'Give --branch the name of the branch.',
    share_bad_branch: 'Give --branch a branch name that git takes.',
    share_no_repository: 'Push this repository to a remote such as GitHub, such as with git push -u origin HEAD.',
    share_folder_in_use: 'Run sonah share again once the other Sonah ends.',
  }),
  sending: (dir) => `Sonah sends the page in ${dir}.`,
  shared: (server, branch) => `Sonah put this review of ${branch} on ${server}.`,
});

const usageError = (problem) => Object.assign(new Error('usage'), { code: 'usage', problem });
const VALUES = new Map([['--dir', 'dir'], ['--branch', 'branch'], ['--repo', 'repo']]);

/** `sonah share`'s options, or a thrown usage error: `{ dir, branch, repo }`, each a string or null. `--opt value` only;
 *  no value the person gave is put in the error's words. */
export function parseShareArgs(argv) {
  const options = { dir: null, branch: null, repo: null };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const key = VALUES.get(arg);
    if (!key) throw usageError(arg.startsWith('-') ? `unknown option ${arg.split('=')[0].slice(0, 40)}`
      : 'it takes no argument');
    if (options[key] !== null) throw usageError(`${arg} is given twice`);
    const value = argv[i + 1];
    if (value === undefined || value === '' || value.startsWith('--')) throw usageError(`${arg} needs a value`);
    options[key] = value;
    i += 1;
  }
  return options;
}

const short = (sha) => String(sha ?? '').slice(0, 7);
/** The injected git (team-git.js `gitOut`'s shape) as `runGit`'s, so visual-command.js's `shareTarget` runs this
 *  command's git, in its environment, as every other git call of share does. */
const asRunGit = (git, env) => async (args, { cwd }) => {
  const out = await git(cwd, args, { env });
  return out === null ? { ok: false, stdout: null } : { ok: true, stdout: Buffer.from(out, 'utf8') };
};
const readJson = async (dir, name) => JSON.parse(await readFile(join(dir, name), 'utf8'));
/** Whether `dir` holds a finished page (its run complete, every file `renderFinished` and the upload read) of a range
 *  that ends at `head` (any head with null): its facts, or null. */
async function finishedPage(dir, head = null) {
  try {
    const [facts, run] = [await readJson(dir, 'facts.json'), await readJson(dir, 'run.json')];
    if (run?.status !== 'complete' || typeof facts?.range?.head !== 'string') return null;
    if (head !== null && facts.range.head !== head) return null;
    for (const name of ['meaning.json', 'findings.json', 'dropped.json']) await readJson(dir, name);
    return facts;
  } catch { return null; }
}

/** The newest finished page of `head` in the repository's visual folder or a run of it: `{ dir, facts }`, or null. */
async function newestPage({ top, common, head, where, env }) {
  const place = dirname(visualOutDir({ top, base: head, head, model: VISUAL_DEFAULT_MODEL, env }));
  const dirs = new Set();
  try {
    for (const entry of await readdir(place, { withFileTypes: true })) if (entry.isDirectory())
      dirs.add(join(place, entry.name));
  } catch { /* no page drawn in this worktree */ }
  for (const r of (await readRuns(where)).runs) if (r.common === common && r.sha === head && r.out) dirs.add(r.out);
  let best = null;
  for (const dir of dirs) {
    const facts = await finishedPage(dir, head);
    if (!facts) continue;
    const at = (await stat(join(dir, 'run.json'))).mtimeMs;
    if (!best || at > best.at) best = { dir, facts, at };
  }
  return best;
}

/**
 * `sonah share [--dir DIR] [--branch NAME] [--repo DIR]`: the exit code. `cwd` is where it runs, `env` where Sonah's
 * folder and the connection are read from; `fetch` makes the server's calls and `git` runs git (team-git.js `gitOut`'s
 * shape), each injectable for the tests.
 */
export async function runShareCommand(argv, { stdout = process.stdout, stderr = process.stderr, env = process.env,
  cwd = undefined, fetch = globalThis.fetch, git = gitOut } = {}) {
  let options;
  try { options = parseShareArgs(argv); }
  catch (error) {
    if (error?.code !== 'usage') throw error;
    stderr.write(`sonah share: ${error.problem}.\nusage: ${SHARE_USAGE}\n`);
    return 2;
  }
  const where = { env };
  // Every git child gets extract.mjs `gitEnv`'s kept names, as a push run's do: a GIT_DIR or
  // GIT_WORK_TREE of whoever ran share names another repository than the folder it was run in.
  const local = localGitEnv(env);
  const said = (code, ...args) => {
    const words = SHARE_WORDS.problem[code];
    stderr.write(`${typeof words === 'function' ? words(...args) : words}\nFix: ${SHARE_WORDS.fix[code]}\n`);
    return code === 'share_no_review' ? 1 : 2;
  };
  // The connection first: with none, nothing of the repository is read.
  const saved = await readConnection(where);
  if (saved.state !== 'ok') {
    stderr.write(`${PUSH_RUN_WORDS.why[saved.state === 'absent' ? 'not_connected' : 'connection_unreadable']}\n`);
    return 2;
  }
  const connection = saved.connection;
  if (await isRefused(connection, where)) {
    stderr.write(`${whyWords({ why: 'refused', server: connection.server })}\n`);
    return 2;
  }
  let root;
  try { root = resolve(cwd ?? process.cwd(), options.repo ?? '.'); } catch { return said('share_not_git'); }
  const top = await topOf(root, { env: local, git });
  const common = top === null ? null : await commonDirOf(top, { git: (d, a) => git(d, a, { env: local }) });
  if (top === null || common === null) return said('share_not_git');
  // The page: --dir's, else the newest finished one of HEAD.
  let outDir, facts;
  if (options.dir !== null) {
    outDir = resolve(cwd ?? process.cwd(), options.dir);
    facts = await finishedPage(outDir);
    const head = facts ? await revParse(top, facts.range.head, { env: local, git }) : null;
    if (!facts || head !== facts.range.head) return said('share_not_a_review', shown(outDir));
  } else {
    const head = await revParse(top, 'HEAD', { env: local, git });
    const found = head ? await newestPage({ top, common, head, where, env }) : null;
    if (!found) return said('share_no_review', short(head ?? ''));
    ({ dir: outDir, facts } = found);
  }
  const head = facts.range.head;
  if (options.branch !== null && !isBranch(options.branch)) return said('share_bad_branch');
  const { branch, named, remote } = await shareTarget({ top, head, given: options.branch,
    git: asRunGit(git, local) });
  if (branch === null) return said('share_no_branch', short(head));
  if (!named) return said('share_no_repository');
  if (await lockHolder(join(outDir, 'draw.lock'))) return said('share_folder_in_use');
  stdout.write(`${SHARE_WORDS.sending(shown(outDir))}\n`);
  // The run of this page: one of the same branch and commit that waits to be sent is sent now (decision 16). The last
  // of them is this share's: runs.json keeps the runs in the order they were written, so that is the newest one, and
  // `replaceOlder` ends the older ones of the branch once the server took this page.
  const { runs } = await readRuns(where);
  const repo = `${named.owner}/${named.name}`;
  // D228 review (second look 1): of this repository too, not of the branch and commit alone (push-run.js
  // `reviewKey`). A clone with two remotes — a fork's `origin` and the team's `upstream` — holds a waiting review
  // of one repository's branch while a share of the same commit goes to the other's: taken for this share's run, that
  // review was re-homed to this share's repository (`server`, `login` and then the upload), so the review of the
  // repository it was pushed to was never sent anywhere and its row named the page of another one.
  // D228 review (second look 2): the repository as the server keys it, so the review this share is of is read under
  // either casing of the push URL's owner and name: matched on the text of `repo`, a waiting review of this very
  // commit and folder pushed under the other casing was not taken for this share's own, and the share wrote a second
  // run of the one review the server keeps, leaving the first waiting under a connection it may no longer be sent to.
  const key = reviewKey({ repo, branch });
  let waiting = null;
  for (const r of runs) if (r.common === common && reviewKey(r) === key && r.sha === head
    && r.out === outDir && await waitsToSend(r)) waiting = r;
  const id = waiting?.id ?? randomBytes(6).toString('hex');
  // The log of this page: the one the run that waits names, else the one a push run of it writes (push-run.js
  // `review` names it the same way), so a share and a push of the same page write one log.
  const logFile = waiting?.log ?? join(logsPath(where), `${safeName(named.name)}-${head}.log`);
  const start = await processStart(process.pid);
  // A new run, written as a push run's review writes one: with the state it is in, which runs.json keeps a run by
  // (team-home.js `runOf`), with this process, and with its log, which `sonah status` names.
  // D228 review 3: a run that waits to be sent goes up under this share's connection, so its server and login are
  // this connection's, not the ones its push was kept under (`endPendingUploads` leaves a run a process has taken up,
  // so a run of a connection that ended can still wait here). They are written before the upload: `sonah status` then
  // names the server Sonah put the page on, and a pass of the runner that finds the run after a share that was cut
  // off sends it to the server it was sent to, instead of ending it `connection_changed` (push-run.js `sendPending`).
  // D228 review (second look 1): a new run names the remote this share sends under, when it is a remote's name, as a
  // push's run names the one git gave the hook (push-run.js `ticketFields`): the commit the branch holds is read from
  // that remote (`pushedTip`), and a branch that is only ever shared named none, so there was no remote to read it
  // from. A run that waits keeps the remote of the push it was drawn for.
  if (waiting) await updateRun(where, id, { server: connection.server, login: connection.login });
  else await updateRun(where, id, { common, dir: top, repo, branch, sha: head, base: facts.range.base ?? null,
    server: connection.server, login: connection.login, at: new Date().toISOString(), out: outDir, log: logFile,
    remote: isRemoteName(remote) ? remote : null, state: 'uploading', why: null, pid: process.pid, start });
  const log = openLog(logFile, [connection.token]);
  await log(`sonah share: ${repo} ${branch} ${head}`);
  const sent = await sendFolder({ where, env, git, fetch, limits: limitsFrom(env), start,
    check: (asked) => connectionStill(where, asked), id, top, named, branch, outDir, connection,
    deadline: Date.now() + shareDeadlineMs(env), log });
  // D228 review 1: another Sonah holds this run and sends it; nothing of it is written here.
  if (sent.state === 'taken') return said('share_folder_in_use');
  // D228 review 1: the folder was held to the deadline, so nothing was drawn and nothing was sent: the page waits to
  // be sent, as it did before this share, and the next push of the repository or the next share sends it. A `failed`
  // run would take a review that a push drew out of the sends that come by themselves.
  // D228 review 2: in its own reason's words. `folder_in_use` is the runner's reason for a review that waits for the
  // folder and then draws, and it says so ("Sonah waits for it, then uses its answers"); this share's process is gone,
  // and nothing waits for that folder or sends this review until the person pushes or shares again.
  if (sent.state === 'gave_up') {
    await updateRun(where, id, { state: 'pending_upload', why: 'folder_held', status: null, code: null });
    await log('pending_upload: folder_held');
    return said('share_folder_in_use');
  }
  if (sent.state === 'done') {
    const run = await updateRun(where, id, { state: 'shared', why: 'uploaded', url: sent.url ?? null, status: null,
      code: null });
    await log(`shared: ${sent.url ?? ''}`);
    // D228 review (second look 2, review 2): the link before the bookkeeping of the reviews this page's took the place
    // of, which may ask each remote of the review for the branch's commit (`replaceOlder`, `SHARE_ORDER_MS`): the page
    // is already online, and the person waiting at a terminal for its link was given it after that read.
    stdout.write(`${SHARE_WORDS.shared(connection.server, shown(branch))}\n`);
    if (sent.url) stdout.write(`page: ${shown(sent.url)}\n`);
    await replaceOlder(where, run, { dir: top, env, git, until: Date.now() + SHARE_ORDER_MS });
    return 0;
  }
  const run = await updateRun(where, id, { state: sent.state, why: sent.why, status: sent.status ?? null,
    code: sent.code ?? null });
  await log(`${run.state}: ${run.why}`);
  stderr.write(`${whyWords(run) ?? run.why}\n`);
  return sent.why === 'draw_failed' ? 3 : 2;
}

/** D228 review (second look 1): the reviews are of one repository *and* branch, as the server keys a branch review
 *  (push-run.js `reviewKey`): matched on the branch alone, a share of a fork's review ended the waiting review of the
 *  team repository's branch of the same name `replaced`, `newer_push`, and nothing sent it again.
 *  D228 review (second look 2): that key is the owner and name in lower case, as the server folds them, so a review
 *  of this very branch pushed under another casing of the push URL is one review with this one here as it is there.
 *  This clone's runs only, though the pass's election now reads every clone's (push-run.js `sendPending`): a write
 *  here is an end, and an end is of a row this process read in a repository it can read git in. Of another clone's
 *  commit, git here may hold no object at all, so the pair would fall past the branch's line and the commits to the
 *  times, where a share of an older page takes the place of the newer review that waits — D228 review 1's own
 *  failure, and nothing sends a run again once it reads `replaced`. The pass of the clone that holds that review
 *  orders it against this share's run, which is `shared` in runs.json for every clone to read, and sends nothing of
 *  it while this one stands.
 *  The reviews of `run`'s repository and branch that wait to be sent and whose place `run`'s took end `replaced`: the
 *  server has a newer review of the branch (push-run.js `takesPlaceOf`, which reads the commits, as the push run's own
 *  sends do). D228 review 1: a share puts up the page of any commit, so one of an older commit replaces nothing.
 *  D228 review 4: with the commit the branch holds, so a share of a page of another line of commits — which is
 *  what an older page is after a `git commit --amend`, a rebase or a squash — leaves the waiting review of the tip
 *  alone, where the times gave it that review's place and nothing then sent it. D228 review 5: that commit is the one
 *  the branch holds on the remote (`pushedTip`), never this computer's own branch, which an amend moves with no push:
 *  read from the local branch, a share of the page of the commit the remote's branch holds left the waiting review of
 *  an ancestor of it to be sent, and the next pass then put that ancestor's review up over the page just shared.
 *  D228 review (second look 2, review 1): the runs of this one review may name several remotes of the one repository,
 *  which second look 2's fold made an everyday case here — `origin` by `https` and `gh` by `ssh` are one review now
 *  where two casings of one URL were two — and `pushedTip` reads each of them instead of refusing the set. Refused,
 *  the commit the branch holds was not read at all for such a share, and the times then gave the page of another
 *  line of commits the place of the waiting review of the branch's tip: review 1's own failure, in the shape review 4
 *  closed for one remote only.
 *  D228 review (second look 2, review 2): `until` bounds that read (`SHARE_ORDER_MS`), which runs after the page's
 *  link is said — several names are several `ls-remote` calls of 30 seconds each, and nothing else here bounded them.
 *  A read that runs out leaves the older reviews waiting, which the next pass or share orders. */
async function replaceOlder(where, run, { dir, env, git, until = null }) {
  const rows = (await readRuns(where)).runs;
  const key = reviewKey(run);
  const ours = [];
  for (const r of rows) {
    if (r.id !== run.id && r.common === run.common && reviewKey(r) === key && await waitsToSend(r)) ours.push(r);
  }
  // With nothing of this review's own branch waiting there is nothing to order, so no git call is made at all: the
  // commit the branch holds on the remote may cost an `ls-remote` (push-run.js `pushedTip`).
  if (!ours.length) return;
  const older = new Set();
  const seen = new Map();
  const local = localGitEnv(env);
  const head = await pushedTip(dir, [run, ...ours], run.branch, { env, git, until });
  for (const r of ours) {
    if (await takesPlaceOf(run, r, { dir, env: local, git, seen, head })) older.add(r.id);
  }
  if (!older.size) return;
  await updateRuns(where, (runs) => runs.map((r) => (older.has(r.id) && ['pending_upload', 'uploading'].includes(r.state)
    ? { ...r, state: 'replaced', why: 'newer_push', updatedAt: new Date().toISOString() } : r)));
}

/** The kind of each of this file's word tables, for the style linter (packages/render/test/style-lint.js). */
export const STYLE_KINDS = Object.freeze({ 'SHARE_WORDS.problem': 'notice', 'SHARE_WORDS.fix': 'action',
  'SHARE_WORDS.sending': 'notice', 'SHARE_WORDS.shared': 'notice' });
const SERVER = 'https://pr.sonah.dev';
// A folder of a page, as a fixture: never a path under a person's home folder, which the release audit reads as
// one of this computer's (scripts/release-audit.mjs `operator-path`), as local-page.js writes its own.
const FOLDER = '/tmp/sonah/visual/widgets-1a2b3c4d/x';
export const STYLE_FIXTURES = Object.freeze({
  'SHARE_WORDS.problem.share_no_review': [['3f1c2a9']],
  'SHARE_WORDS.problem.share_not_a_review': [[FOLDER]],
  'SHARE_WORDS.problem.share_no_branch': [['3f1c2a9']],
  'SHARE_WORDS.sending': [[FOLDER]],
  'SHARE_WORDS.shared': [[SERVER, 'feature-x']],
});
