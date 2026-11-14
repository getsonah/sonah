// D227 (item 10, C4): the hidden `sonah push-run --repo DIR`, the background review of the branches a push left in one
// repository's queue (push-queue.js). Ported from the private laptop client's run.mjs (sonah-hosted client/run.mjs),
// with getsonah's drawing in place of the client's own job: `sonah pre-push` (push-hook-run.js) starts it detached, in
// a process group of its own, at low priority (nice 10; D227 review 0: not macOS's background policy), when no runner
// of the repository is going; it takes the tickets in turn and ends when none is left.
//
// Each ticket, in turn (the oldest push whose commit the remote shows first):
//   1. The remote shows the commit: the remote-tracking ref git updated after the push (no network), or, for a remote
//      given as a URL or one with no such ref, ls-remote. A ticket the remote never shows within 10 minutes fails.
//   2. The place: the pushed worktree, or, when it is gone, another worktree of the same git common dir (the plan's A2:
//      the drawing reads only git objects).
//   3. The connection: the ticket's server and login must still be this computer's (A5), and not marked refused.
//   4. Owner and name: visual-command.js `remoteRepository` of the push URL (`git remote get-url --push`).
//   5. The probe, once a repository and connection a pass: GET /api/fixes?owner&repo (decision 8, in place of GET
//      /api/prs). 401: the connection is marked refused (team-home.js `markRefused`) and the pass ends, every ticket
//      after it failed; 403 `not_member`: failed; 200: the waiting comments kept (fix-waiting.js); 429, 503, another
//      answer or none: the run goes on (decision 16), and the upload says what the server takes (an upload's 403
//      `not_member` then counts as the probe's, so the repository's next tickets draw nothing). A 401 to a token that
//      the connection no longer holds (connected again as the same login since) is asked again with the token it holds.
//   6. The base: the merge base with the remote's default branch (refs/remotes/<remote>/HEAD, else ls-remote --symref).
//      A commit already on it is skipped.
//   7. The drawing: visual-command.js `drawVisualPage` with the full model id, the environment with no
//      ANTHROPIC_API_KEY (`visualCallEnvironment`), the folder `visualOutDir` gives (so a `sonah visual` of the same
//      range shares its stored answers), the ticket's deadline (30 minutes after its push; D226 stops the calls still
//      running) and a signal that SIGTERM aborts. It runs only while this runner holds the laptop's one job slot
//      (team/locks/job.lock), and another drawer of the same folder (`folder_in_use`) is waited for. The run is
//      `running` only while it holds the slot: it leaves `running` before the slot goes (D227 review 0), so no two
//      runs on the computer are `running` at once. `usage_limit`, `auth` and `billing` end the pass: every ticket after
//      it fails with the same words.
//   8. The upload: under the connection as it is now (the same server and login, with the token it holds now; none if
//      it is marked refused), the folder's lock held again while its page is drawn anew in mode 'hosted' (job.mjs
//      `renderFinished`) and its files read; upload.mjs `uploadBody` with the pushed branch, plus `sessions`
//      (upload-sessions.js, with the comments each session was opened to answer from the launch records of `sonah fix`,
//      D229 fix-launches.js); the 25 MB check; POST /api/uploads, a 5xx or no answer tried again after 5 s and 20 s. Still
//      no answer, a 5xx or a 429: `pending_upload`, which the next pass of the repository sends again (the newest of
//      each branch only, by the commit its branch holds on the remote and then by the commits, D228 reviews 1, 4 and
//      5; the ones whose place it took `replaced`), as it does one whose process ended while it sent it (D227 review
//      1: the first send too, whose taken ticket the next runner finds).
// D227 review 1: the person may turn the push hook off (`sonah hook remove --push`) or end the connection (`sonah
// disconnect`, another server or login) after a runner took a ticket: before each step that spends or sends (the
// probe, each look for the job slot, each upload) and at each poll while it draws, the runner reads hooks.json and the
// connection again, and the run ends `skipped`, `hook_removed` or `failed`, `connection_changed`: a drawing that runs
// is stopped as SIGTERM stops it, and nothing more is spent or sent.
// After the queue: the uploads that wait (none once the server refused the token), the waiting comments of each
// repository the pass probed under the connection it has now (one GET each), and the logs older than 30 days pruned;
// none of it once the push hook of the repository is off.
// The visual folders are never deleted (PRIVACY: Sonah never deletes them).
//
// Each run's state and why go to team/runs.json (team-home.js; ledger.js PUSH_RUN_STATES and PUSH_RUN_REASONS), and
// what it did to its log, team/logs/<name>-<sha>.log (0600 in 0700), in fixed words and codes: never the token, a
// remote URL, git's or the provider's text. A backstop ends the process a minute after a ticket's deadline, whatever
// still runs (an exit listener of the transport kills the calls' process groups; the locks' release theirs). The entry
// (bin/sonah.js) gives it its own crash handler: it always exits 0 and prints nothing.
//
// No work at import.
import { getPriority, setPriority } from 'node:os';
import { appendFile, mkdir, readdir, readFile, rm, stat } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
import { gitEnv } from '../../visual/src/extract.mjs';
import { shown } from '../../visual/src/fix-prompt.mjs';
import { DEADLINE_MIN_MS } from '../../visual/src/transport-claude.mjs';
import { UPLOAD_MAX_BYTES, uploadBody } from '../../visual/src/upload.mjs';
import { answersBySession } from './fix-launches.js';
import { checkList, readWaiting, repoKeyOf, saveWaiting, waitingCount } from './fix-waiting.js';
import { doneWith, giveBack, orphans, takeJobSlot, takeRunner, takeTicket, waitingTickets } from './push-queue.js';
import { TEAM_API_TIMEOUT_MS, TeamApiError, teamApi } from './team-api.js';
import { commonDirOf, defaultBranch, gitOut, isRemoteName, localDefaultBranch, mergeBase, pushUrlOf, remoteTip, revParse,
  topOf, trackingRef, worktreesOf } from './team-git.js';
import { isRefused, logsPath, markRefused, readConnection, readHooks, readRuns, updateRun, updateRuns,
  waitsToSend } from './team-home.js';
import { uploadSessions } from './upload-sessions.js';
import { drawVisualPage, remoteRepository, VISUAL_DEFAULT_MODEL, visualOutDir } from './visual-command.js';
import { lockHeld, processStart, takeVisualLock } from './visual-lock.js';

/** The limits of a run: the wait for the remote, the time a ticket has from its push, how often the runner looks, the
 *  backstop after a deadline, and the waits before an upload is tried again. The environment may only shorten them
 *  (tests): SONAH_PUSH_REMOTE_WAIT_MS, SONAH_PUSH_GIVE_UP_MS, SONAH_PUSH_POLL_MS, SONAH_PUSH_BACKSTOP_MS and
 *  SONAH_PUSH_RETRY_MS (each wait at most). */
export const PUSH_RUN_LIMITS = Object.freeze({ remoteWaitMs: 10 * 60_000, giveUpMs: 30 * 60_000, pollMs: 2_000,
  backstopMs: 60_000, retryMs: Object.freeze([5_000, 20_000]) });
/** The runner looks at its waiting tickets at least this often. */
const IDLE_MAX_MS = 5_000;
/** The logs kept, in days. */
export const PUSH_LOG_DAYS = 30;
/** The runner's CPU priority (nice). */
export const PUSH_RUN_NICE = 10;
/** The drawing's stops that end the pass (the plan's section 2: no more jobs on a plan or an account that refuses). */
const PASS_STOPS = Object.freeze(['usage_limit', 'auth', 'billing']);
/** The drawing's other stops, each a reason of its own. */
const RUN_STOPS = Object.freeze(['cli_missing', 'model_not_found']);
/** The states of a run that a process works on now (`queued` once the runner took its ticket, and named its pid), and
 *  those of a run that has not ended. */
const RUNNING = Object.freeze(['running', 'uploading']);
const WORKING = Object.freeze(['waiting', 'queued', 'running', 'uploading']);

/** The limits in `env` (only shorter ones are taken). */
export function limitsFrom(env = process.env) {
  const pick = (name, longest) => {
    const n = Number(env[name]);
    return Number.isSafeInteger(n) && n > 0 ? Math.min(n, longest) : longest;
  };
  const L = PUSH_RUN_LIMITS;
  const retry = pick('SONAH_PUSH_RETRY_MS', Math.max(...L.retryMs));
  return { remoteWaitMs: pick('SONAH_PUSH_REMOTE_WAIT_MS', L.remoteWaitMs),
    giveUpMs: pick('SONAH_PUSH_GIVE_UP_MS', L.giveUpMs), pollMs: pick('SONAH_PUSH_POLL_MS', L.pollMs),
    backstopMs: pick('SONAH_PUSH_BACKSTOP_MS', L.backstopMs), retryMs: L.retryMs.map((ms) => Math.min(ms, retry)) };
}

/** A span of time in words: whole minutes from two minutes on, else whole seconds. */
export const span = (ms) => (ms >= 120_000 ? `${Math.round(ms / 60_000)} minutes`
  : `${Math.round(ms / 1000)} ${Math.round(ms / 1000) === 1 ? 'second' : 'seconds'}`);

/** The words of a run's why (ledger.js PUSH_RUN_REASONS), and `sonah status`'s lines of the runs and the waiting
 *  comments. A run's why words take the run's own fields. */
export const PUSH_RUN_WORDS = Object.freeze({
  why: Object.freeze({
    remote_not_seen: 'Sonah does not see this commit on its branch of the remote yet. It looks again until it does.',
    job_slot: 'Sonah reviews another push on this computer now. It reviews one push at a time, and this one waits.',
    folder_in_use: 'Another Sonah draws the page of the same change now. Sonah waits for it, then uses its answers.',
    folder_held: 'Another Sonah held the folder of this page, so sonah share sent nothing. The next push of this '
      + 'repository, or sonah share, sends this review.',
    newer_push: (branch) => `A newer review of ${branch} took the place of this one.`,
    on_default_branch: (remote) => `Sonah found this commit on the default branch of ${remote} already, so it did not `
      + 'review it.',
    hook_removed: 'You turned off the push hook of this repository, so Sonah sent no review of this push.',
    remote_never_showed: (wait) => `Sonah did not see this commit on its branch of the remote within ${wait} of the `
      + 'push. Check that git push ended with no error.',
    not_connected: 'This computer has no connection to Sonah Team now. Run sonah connect <code> to connect it.',
    connection_unreadable: 'Sonah cannot read its connection to Sonah Team. Run sonah status.',
    connection_changed: 'This computer has another connection to Sonah Team now. Sonah sends a review only to the '
      + 'connection of its push or its share.',
    refused: (server) => `${server} no longer takes the token of this computer. Run sonah disconnect, then sonah connect `
      + 'with a new code.',
    not_member: (server) => `You are in no team on ${server}, so the server takes no review from you. Join a team there, `
      + 'then push or share again.',
    no_repository: 'The URL of the push remote names no owner and repository, so Sonah Team cannot keep a review of it.',
    repository_gone: 'No worktree of this repository is on this computer now, so Sonah cannot read the change.',
    no_base: (remote) => `Sonah cannot find where the change starts: the default branch of ${remote} is not in this `
      + `repository. Run git fetch ${remote}, then push again.`,
    usage_limit: 'Your Claude Code plan reached its usage limit, so Sonah stopped each review of this push. Push again '
      + 'after the limit resets.',
    auth: 'Claude Code needs you to sign in. Run claude auth login with your Claude subscription account, then push '
      + 'again.',
    billing: 'Your Claude Code account cannot pay for the calls. Check its plan and its payment details, then push '
      + 'again.',
    cli_missing: 'Sonah could not start Claude Code. Install it, then run sonah hook add --push again in this '
      + 'repository.',
    model_not_found: `Your Claude Code account cannot use ${VISUAL_DEFAULT_MODEL}, which Sonah asks for.`,
    draw_failed: (code) => `Sonah could not draw the page of this change: ${code}. A new push of the branch, or sonah `
      + 'share, tries again with the answers that came back.',
    too_large: 'This review is over the 25 MB that an upload can hold, so Sonah did not send it.',
    upload_refused: (server, status, code) => `${server} refused the upload with the status ${status}`
      + `${code ? ` (${code})` : ''}.`,
    time_limit: (wait) => `Sonah stopped this review ${wait} after the push.`,
    upload_failed: (server, status) => `${status === null ? `Sonah could not reach ${server}.`
      : `${server} answered with the status ${status}.`} The next push of this repository, or sonah share, sends this `
      + 'review again.',
    uploaded: (server) => `Sonah put this review on ${server}.`,
    process_ended: 'Sonah\'s process ended while it ran this review.',
  }),
  // D228 review 3: `sonah share` writes a run of a page it put online, with no push and no push hook, and the list
  // this heading stands over holds those runs too (share-command.js; `runsReport` prints every run of runs.json).
  heading: 'Reviews of your pushes and shares, newest first:',
  // D229 (amending D227's decision 14, which left the count with no command until `sonah fixes` was there): the count
  // names the command that lists them.
  waiting: (count, repo) => `${count === 1 ? '1 comment waits' : `${count} comments wait`} for you on ${repo} `
    + '(sonah fixes).',
});

/** The words of a run's why, from its own fields; null when it has none. */
export function whyWords(run) {
  const said = PUSH_RUN_WORDS.why[run.why];
  if (said === undefined) return null;
  if (typeof said === 'string') return said;
  const remote = run.remote ?? 'the remote';
  const server = run.server ?? 'the server';
  switch (run.why) {
    case 'newer_push': return said(run.branch ?? 'the branch');
    case 'on_default_branch': case 'no_base': return said(remote);
    case 'remote_never_showed': case 'time_limit': return said(span(run.ms ?? 0));
    case 'refused': case 'not_member': case 'uploaded': return said(server);
    case 'draw_failed': return said(run.code ?? 'visual_failed');
    case 'upload_refused': return said(server, run.status ?? 0, run.code);
    case 'upload_failed': return said(server, run.status);
    default: return null;
  }
}

const sleep = (ms) => new Promise((done) => setTimeout(done, Math.max(0, ms)));
const short = (sha) => String(sha ?? '').slice(0, 7);
/** A name as one file name: the log of a run is named by it, and D228: `sonah share` names the same file. */
export const safeName = (text) => String(text ?? '').replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 80) || 'repository';
/** A wait of at most `cap`, never past `until`, and at least a second, so a call can still answer. */
const within = (until, cap, now = Date.now()) => Math.max(1000, Math.min(cap, until - now));
const exists = (path) => stat(path).then(() => true, () => false);

/** The environment of the runner's own git calls (extract.mjs `gitEnv`'s kept names), and of those that reach the
 *  remote: the SSH agent and git's own SSH settings too, and never a prompt (no terminal is there). */
const REMOTE_KEPT = Object.freeze(['SSH_AUTH_SOCK', 'SSH_AGENT_PID', 'GIT_SSH', 'GIT_SSH_COMMAND', 'GIT_SSH_VARIANT']);
export const localGitEnv = (env) => gitEnv({}, env);
export function remoteGitEnv(env) {
  const extra = { GIT_TERMINAL_PROMPT: '0', GCM_INTERACTIVE: 'never' };
  for (const key of REMOTE_KEPT) if (typeof env[key] === 'string') extra[key] = env[key];
  return gitEnv(extra, env);
}

/** A log's line writer: one line a call, after the time, appended to `file` (0600 in a 0700 folder), the token of the
 *  connection taken out. A log Sonah cannot write is skipped. */
export function openLog(file, secrets = []) {
  let made = null;
  return async (line) => {
    try {
      made ??= mkdir(join(file, '..'), { recursive: true, mode: 0o700 });
      await made;
      let text = String(line);
      for (const secret of secrets) if (typeof secret === 'string' && secret.length >= 8) text = text.split(secret)
        .join('[token]');
      await appendFile(file, `${new Date().toISOString()} ${text}\n`, { mode: 0o600 });
    } catch { /* a log is never what stops a run */ }
  };
}

/** Prunes the logs older than PUSH_LOG_DAYS from `folder` (`.log` files only). */
export async function pruneLogs(folder, { now = Date.now() } = {}) {
  let names = [];
  try { names = await readdir(folder); } catch { return; }
  const oldest = now - PUSH_LOG_DAYS * 86_400_000;
  for (const name of names.filter((n) => n.endsWith('.log'))) {
    try { if ((await stat(join(folder, name))).mtimeMs < oldest) await rm(join(folder, name), { force: true }); }
    catch { /* gone already */ }
  }
}

/** The working folder of a ticket's repository: the pushed worktree when it is there and still of `common`, else
 *  another worktree of `common` that is there (A2); null when none is. */
async function placeOf(dir, common, { git, env: personal }) {
  const env = localGitEnv(personal);
  const of = async (path) => {
    const top = await topOf(path, { env, git });
    return top !== null && (await commonDirOf(top, { git: (d, a) => git(d, a, { env }) })) === common ? top : null;
  };
  if (await exists(dir)) {
    const top = await of(dir);
    if (top) return top;
  }
  for (const tree of await worktreesOf(common, { git: (d, a) => git(d, a, { env }) })) {
    if (tree.bare || !(await exists(tree.path))) continue;
    const top = await of(tree.path);
    if (top) return top;
  }
  return null;
}

/** Whether the remote shows a ticket's commit on its branch: true, or false. */
async function remoteShows(t, top, { git, env }) {
  const remote = t.remote ?? 'origin';
  const local = localGitEnv(env);
  // git updates the remote-tracking ref once the push went through (no network); a remote with none is asked
  const ref = await trackingRef(top, remote, t.branch, { env: local, git });
  if (ref) return (await revParse(top, ref, { env: local, git })) === t.sha;
  return (await remoteTip(top, remote, `refs/heads/${t.branch}`, { env: remoteGitEnv(env), git })) === t.sha;
}

/** The base of a ticket's change: `{ base }`, `{ skip }` (on the default branch already) or `{ error }`. */
async function findBase({ top, remote, head, deadline, git, env, log }) {
  const local = localGitEnv(env);
  let found = await localDefaultBranch(top, remote, { env: local, git });
  if (!found) {
    await log(`${isRemoteName(remote) ? `refs/remotes/${remote}/HEAD` : 'the remote\'s HEAD'} is not set here, so `
      + 'Sonah asks the remote for its default branch');
    found = await defaultBranch(top, remote, { env: remoteGitEnv(env), git, timeoutMs: within(deadline, 30_000) });
  }
  const names = found ? [found.sha, `refs/remotes/${remote}/${found.branch}`, `refs/heads/${found.branch}`]
    : [`refs/remotes/${remote}/HEAD`];
  for (const name of names) {
    const commit = name ? await revParse(top, name, { env: local, git }) : null;
    const met = commit ? await mergeBase(top, commit, head, { env: local, git }) : null;
    if (!met) continue;
    return met === head ? { skip: true } : { base: met };
  }
  return { error: true };
}

/** A failed upload, by what its error says: `pending` (no answer, a 5xx or a 429), `refused` (401), `not_member` (403
 *  `not_member`), `too_large` (413) or `upload_refused` (any other refusal or a redirect). */
function uploadEnd(error) {
  if (error.kind === 'unreachable') return { why: 'upload_failed', status: null };
  if (error.kind === 'refused' && (error.status >= 500 || error.status === 429))
    return { why: 'upload_failed', status: error.status };
  if (error.kind === 'refused' && error.status === 401) return { why: 'refused' };
  if (error.kind === 'refused' && error.status === 403 && error.code === 'not_member') return { why: 'not_member' };
  if (error.kind === 'refused' && error.status === 413) return { why: 'too_large' };
  return { why: 'upload_refused', status: error.status ?? null, code: error.code ?? null };
}

/** `sonah push-run` as the entry runs it: SIGTERM aborts the signal (the call running stops, and the run ends
 *  `stopped`), and the process ends 10 s later whatever runs. */
export async function pushRunMain(argv) {
  const controller = new AbortController();
  process.once('SIGTERM', () => {
    controller.abort();
    setTimeout(() => process.exit(0), 10_000).unref();
  });
  return runPushRun(argv, { signal: controller.signal });
}

/**
 * `sonah push-run --repo DIR`: the runner of the repository that holds DIR. Resolves when no ticket is left, when
 * another runner holds the repository, or when the pass ended; never rejects for a reason of its own. `draw` is
 * visual-command.js `drawVisualPage`, `fetch` makes the server's calls, `git` runs git (team-git.js `gitOut`'s shape),
 * `exit` ends the process (the backstop), `slot` takes the laptop's job slot (push-queue.js `takeJobSlot`), each
 * injectable for the tests.
 */
export async function runPushRun(argv, { env = process.env, git = gitOut, fetch = globalThis.fetch,
  draw = drawVisualPage, limits = limitsFrom(env), exit = (code) => process.exit(code), signal = null,
  slot = takeJobSlot } = {}) {
  if (argv.length !== 2 || argv[0] !== '--repo' || !argv[1]) return 'none';
  if (typeof env.CI === 'string' && env.CI !== '') return 'none';
  try { if (getPriority() < PUSH_RUN_NICE) setPriority(PUSH_RUN_NICE); } catch { /* it still runs */ }
  const where = { env };
  const local = localGitEnv(env);
  const common = await commonDirOf(resolve(argv[1]), { git: (d, a) => git(d, a, { env: local }) });
  if (common === null) return 'none';
  let runner = await takeRunner(where, common);
  if (!runner) return 'busy';
  const start = await processStart(process.pid);
  const pass = { probes: new Map(), probed: new Map(), end: null, places: new Map(), said: new Map(),
    pending: new Set() };
  const ctx = { where, env, git, fetch, draw, slot, limits, exit, signal, start, pass, common };
  try {
    // Tickets an earlier runner took and left: their run is `stopped`, unless it ended already (the backstop's). D227
    // review 1: one whose process ended while it sent the review (`uploading`) was drawn whole: it waits to be sent,
    // and this pass sends it after the queue (sendPending), drawing nothing again.
    const before = (await readRuns(where)).runs;
    const ended = new Set(before.filter((r) => !WORKING.includes(r.state)).map((r) => r.id));
    const sending = new Set(before.filter((r) => r.state === 'uploading').map((r) => r.id));
    for (const t of await orphans(where, common)) {
      if (!ended.has(t.id) && !sending.has(t.id))
        await updateRun(where, t.id, { ...ticketFields(t), state: 'stopped', why: 'process_ended' });
    }
    let wait = limits.pollMs;
    for (;;) {
      if (signal?.aborted) return 'stopped';
      const list = await waitingTickets(where, common);
      if (!list.length) {
        await afterQueue(ctx);
        // Leave, then look once more: a push between the two finds no runner and starts one, or this one goes on.
        await runner.release();
        runner = null;
        if (!(await waitingTickets(where, common)).length) return 'done';
        runner = await takeRunner(where, common);
        if (!runner) return 'done';
        continue;
      }
      // A pass that ended (a refused token, a plan or account that stops the calls): each ticket fails the same way.
      if (pass.end !== null) {
        let taken = false;
        for (const t of list) taken = (await endTicket(ctx, t, { state: 'failed', why: pass.end })) || taken;
        if (!taken) await sleep(limits.pollMs);
        continue;
      }
      const next = await nextTicket(ctx, list);
      if (!next) {
        await sleep(wait);
        wait = Math.min(Math.round(wait * 1.5), IDLE_MAX_MS);
        continue;
      }
      wait = limits.pollMs;
      const t = await takeTicket(where, next.ticket);
      if (!t) { await sleep(limits.pollMs); continue; }
      // the file may hold a newer push of the branch by now: its commit must be on the remote too
      if (t.sha !== next.ticket.sha && !(await remoteShows(t, next.top, ctx))) {
        if (!(await giveBack(where, t)))
          await updateRun(where, t.id, { ...ticketFields(t), state: 'replaced', why: 'newer_push' });
        continue;
      }
      try { await review(ctx, t, next.top); } finally { await doneWith(t); }
    }
  } finally {
    await runner?.release();
  }
}

/** A ticket's own fields in its run, so a run that the hook did not record (or whose record is gone) still names its
 *  repository, branch and commit. */
const ticketFields = (t) => ({ common: t.common, branch: t.branch, sha: t.sha, server: t.server, login: t.login,
  at: new Date(t.at).toISOString(), remote: isRemoteName(t.remote) ? t.remote : null });

/** Takes a waiting ticket and ends its run as `end` says: whether it took it. D227 review: when its file holds a newer
 *  push of the branch by then (it came after the list was read), that one is put back to wait for its own turn, never
 *  ended with this one's end, and this one was replaced. */
async function endTicket(ctx, t, end) {
  const taken = await takeTicket(ctx.where, t);
  if (!taken) return false;
  if (taken.id !== t.id) {
    if (!(await giveBack(ctx.where, taken)))
      await updateRun(ctx.where, taken.id, { ...ticketFields(taken), state: 'replaced', why: 'newer_push' });
    await updateRun(ctx.where, t.id, { ...ticketFields(t), state: 'replaced', why: 'newer_push' });
    return false;
  }
  await doneWith(taken);
  await updateRun(ctx.where, taken.id, { ...ticketFields(taken), ...end });
  return true;
}

/** The ticket to review next, `{ ticket, top }`: the oldest push whose commit the remote shows. Tickets past their
 *  time, whose remote never showed their commit, or whose repository has no worktree here, end on the way. */
async function nextTicket(ctx, list) {
  const { where, limits, pass } = ctx;
  let next = null;
  for (const t of list) {
    const now = Date.now();
    if (now > t.at + limits.giveUpMs) {
      await endTicket(ctx, t, { state: 'gave_up', why: 'time_limit', ms: limits.giveUpMs });
      continue;
    }
    if (!pass.places.has(t.id)) pass.places.set(t.id, await placeOf(t.dir, t.common, ctx));
    const top = pass.places.get(t.id);
    if (top === null) {
      await endTicket(ctx, t, { state: 'failed', why: 'repository_gone' });
      continue;
    }
    if (await remoteShows(t, top, ctx)) {
      if (!next) next = { ticket: t, top };
      else if (pass.said.get(t.id) !== 'queued') {
        pass.said.set(t.id, 'queued');
        await updateRun(where, t.id, { ...ticketFields(t), state: 'queued', why: null });
      }
      continue;
    }
    if (pass.said.get(t.id) !== 'remote_not_seen') {
      pass.said.set(t.id, 'remote_not_seen');
      await updateRun(where, t.id, { ...ticketFields(t), state: 'waiting', why: 'remote_not_seen' });
    }
    if (now > t.at + limits.remoteWaitMs) {
      await endTicket(ctx, t, { state: 'failed', why: 'remote_never_showed', ms: limits.remoteWaitMs });
    }
  }
  return next;
}

/** D227 review: the key of a repository's probe in a pass: the connection's server and login, and the owner and name,
 *  so what the server said to one connection is never taken for another's (A5). */
const probeKey = (connection, named) => JSON.stringify([connection.server, connection.login,
  repoKeyOf(named.owner, named.name)]);

/** D227 review: after a 401 to `connection`'s token, the connection on file when it is of the same server and login
 *  with another token (connected again as the same login since: the call is made again with it); else null, and the
 *  connection is marked refused (team-home.js `markRefused`, only while its file holds the token refused). */
async function newerOrRefused(where, connection) {
  const now = await readConnection(where);
  if (now.state === 'ok' && now.connection.server === connection.server && now.connection.login === connection.login
    && now.connection.token !== connection.token) return now.connection;
  await markRefused(connection, where).catch(() => {});
  return null;
}

/** D227 review 1: whether the push hook of the repository whose git common dir is `common` is still on: hooks.json
 *  lists it (`sonah hook remove --push` takes it off). A list Sonah cannot read says neither, and the run goes on. */
async function hookOn(where, common) {
  const listed = await readHooks(where);
  return listed.state === 'invalid' || (listed.state === 'ok' && listed.repos.some((r) => r.common === common));
}

/** D227 review 1: whether a taken ticket's run may still spend or send, read again before each such step: `{
 *  connection }`, the one on file now (the server and login of `asked`, with the token it holds now), or `{ end }`:
 *  `skipped`, `hook_removed` once the push hook of the repository is off; `failed`, `connection_changed` once the
 *  connection is gone or another server's or login's (`sonah disconnect`, `sonah connect`), as push-queue.js
 *  `forgetTickets` ends the tickets no runner took; `failed`, `refused` once it is marked refused. */
async function stillOn(ctx, asked) {
  if (!(await hookOn(ctx.where, ctx.common))) return { end: { state: 'skipped', why: 'hook_removed' } };
  return connectionStill(ctx.where, asked);
}

/** D228: `stillOn` without the push hook (`sonah share` sends with no hook): `{ connection }`, the one on file now when
 *  it is of `asked`'s server and login and not marked refused, else `{ end }`. */
export async function connectionStill(where, asked) {
  const now = await readConnection(where);
  if (now.state !== 'ok' || now.connection.server !== asked.server || now.connection.login !== asked.login)
    return { end: { state: 'failed', why: 'connection_changed' } };
  if (await isRefused(now.connection, where)) return { end: { state: 'failed', why: 'refused' } };
  return { connection: now.connection };
}

/** The probe of a repository, once a pass for a connection (decision 8): 'ok', 'refused' (401: the connection is
 *  marked), 'not_member' (403) or 'unanswered' (any other answer, or none: decision 16). A 200 keeps the waiting
 *  comments. */
async function probe(ctx, named, connection, deadline, log) {
  const key = probeKey(connection, named);
  if (ctx.pass.probes.has(key)) return ctx.pass.probes.get(key);
  let result;
  for (let asked = connection; ;) {
    try {
      const json = await teamApi({ server: asked.server, token: asked.token, fetch: ctx.fetch })
        .fixes(named, { timeoutMs: within(deadline, TEAM_API_TIMEOUT_MS.fixes) });
      const list = checkList(json, named);
      if (list) await saveWaiting(ctx.where, asked, list);
      await log(list ? `GET /api/fixes: 200, ${list.total} waiting`
        : 'GET /api/fixes: 200, an answer not of its shape');
      result = 'ok';
      ctx.pass.probed.set(key, { named, server: asked.server, login: asked.login });
    } catch (error) {
      if (!(error instanceof TeamApiError)) throw error;
      await log(`GET /api/fixes: ${error.kind}${error.status === null ? '' : ` ${error.status}`}`);
      if (error.status === 401) {
        const newer = await newerOrRefused(ctx.where, asked);
        if (newer) { asked = newer; continue; }
      }
      result = error.status === 401 ? 'refused' : error.status === 403 && error.code === 'not_member' ? 'not_member'
        : 'unanswered';
    }
    break;
  }
  ctx.pass.probes.set(key, result);
  return result;
}

/** One review of a taken ticket: the connection, the probe, the base, the drawing and the upload, each step's end
 *  written to runs.json and its log. */
async function review(ctx, t, top) {
  const { where, env, limits, pass } = ctx;
  const deadline = t.at + limits.giveUpMs;
  const remote = t.remote ?? 'origin';
  const url = await pushUrlOf(top, remote, { env: localGitEnv(env), git: ctx.git });
  const named = remoteRepository(url);
  const logFile = join(logsPath(where), `${safeName(named ? named.name : basename(top))}-${t.sha}.log`);
  const saved = await readConnection(where);
  const log = openLog(logFile, saved.state === 'ok' ? [saved.connection.token] : []);
  const repo = named ? `${named.owner}/${named.name}` : null;
  // The run is `queued` until it draws (`running`): it may wait for the laptop's job slot first.
  await updateRun(where, t.id, { ...ticketFields(t), dir: top, repo, log: logFile, state: 'queued', why: null,
    pid: process.pid, start: ctx.start });
  await log(`run ${t.id}: ${repo ?? basename(top)} ${t.branch} ${t.sha}`);
  const end = async (state, why, extra = {}) => {
    const run = await updateRun(where, t.id, { state, why, ...extra });
    await log(`${state}${why ? `: ${whyWords(run) ?? why}` : ''}`);
    return run;
  };
  // Nothing keeps a review past its time: the calls stop at the deadline, and this backstop ends the process a little
  // after it, whatever still runs.
  const backstop = setTimeout(async () => {
    const bye = setTimeout(() => ctx.exit(0), 5000);
    try {
      await end('gave_up', 'time_limit', { ms: limits.giveUpMs });
      await doneWith(t);
    } finally { clearTimeout(bye); ctx.exit(0); }
  }, Math.max(0, deadline - Date.now()) + limits.backstopMs);
  backstop.unref?.();
  // The laptop's job slot while this run draws (drawInTurn). D227 review 0: it goes only once the run has left
  // `running` (its end written, or `uploading`), so no two runs on the computer are `running` at once (decision 3).
  const turn = { slot: null };
  try {
    if (!(await hookOn(where, ctx.common))) return await end('skipped', 'hook_removed');
    if (saved.state === 'absent') return await end('failed', 'not_connected');
    if (saved.state !== 'ok') return await end('failed', 'connection_unreadable');
    const connection = saved.connection;
    if (connection.server !== t.server || connection.login !== t.login) return await end('failed', 'connection_changed');
    if (await isRefused(connection, where)) { pass.end = 'refused'; return await end('failed', 'refused'); }
    if (!named) return await end('failed', 'no_repository');
    const probed = await probe(ctx, named, connection, deadline, log);
    if (probed === 'refused') {
      pass.end = 'refused';
      return await end('failed', 'refused');
    }
    if (probed === 'not_member') return await end('failed', 'not_member');
    const found = await findBase({ top, remote, head: t.sha, deadline, git: ctx.git, env, log });
    if (found.skip) return await end('skipped', 'on_default_branch');
    if (found.error) return await end('failed', 'no_base');
    await updateRun(where, t.id, { base: found.base });
    const outDir = visualOutDir({ top, base: found.base, head: t.sha, model: VISUAL_DEFAULT_MODEL, env });
    await log(`drawing ${short(found.base)}..${short(t.sha)} into ${outDir}`);
    const drawn = await drawInTurn(ctx, t, { top, base: found.base, outDir, connection, deadline, log, turn });
    if (drawn === null) return await end('gave_up', 'time_limit', { ms: limits.giveUpMs });
    if (drawn.ended) {
      if (drawn.ended.why === 'refused') pass.end = 'refused';
      return await end(drawn.ended.state, drawn.ended.why);
    }
    if (drawn.status !== 'complete') {
      await log(`the drawing ended ${drawn.status}: ${drawn.code ?? 'pending'}`);
      if (ctx.signal?.aborted) return await end('stopped', 'process_ended', { out: outDir });
      if (drawn.code === 'timeout' && deadline - Date.now() < DEADLINE_MIN_MS)
        return await end('gave_up', 'time_limit', { ms: limits.giveUpMs, out: outDir });
      if (PASS_STOPS.includes(drawn.code)) {
        pass.end = drawn.code;
        return await end('failed', drawn.code, { out: outDir });
      }
      if (RUN_STOPS.includes(drawn.code)) return await end('failed', drawn.code, { out: outDir });
      return await end('failed', 'draw_failed', { code: drawn.code ?? 'pending', out: outDir });
    }
    const totals = drawn.run?.totals ?? {};
    await log(`the drawing ended complete: ${totals.calls ?? 0} calls, $${totals.costUsd ?? 0}`);
    const sent = await uploadFolder(ctx, { id: t.id, top, named, branch: t.branch, outDir, connection, deadline, log,
      sending: () => turn.slot?.release() });
    // D228 review 1: another process holds this run and sends it: its end is that process's to write.
    if (sent.state === 'taken') { await log('another Sonah sends this review now'); return null; }
    if (sent.state === 'gave_up') return await end('gave_up', 'time_limit', { ms: limits.giveUpMs, out: outDir });
    if (sent.why === 'refused') pass.end = 'refused';
    return await end(sent.state, sent.why, { out: outDir, url: sent.url ?? null, status: sent.status ?? null,
      code: sent.code ?? null });
  } catch {
    // An error of Sonah's own: the run says so, and the runner goes on with the next ticket.
    return await end('failed', 'draw_failed', { code: 'visual_failed' });
  } finally {
    clearTimeout(backstop);
    await turn.slot?.release();
  }
}

/** The drawing, while this runner holds the laptop's job slot and no other drawer holds the folder: the result of
 *  `drawVisualPage`, or null when the ticket's time ran out while it waited. D227 review 0: the slot it holds is kept
 *  in `turn.slot` once the drawing ran, and the review lets it go once the run has left `running`; while it waits for
 *  the folder, the run is `queued` first, then the slot goes. D227 review 1: each time it looks for the slot, and at
 *  each poll while it draws (`watchWhileDrawing`), the push hook and the connection are read again (`stillOn`): `{
 *  ended }` once either ended, with no call started after it. */
async function drawInTurn(ctx, t, { top, base, outDir, connection, deadline, log, turn }) {
  const { where, env, limits } = ctx;
  let said = null;
  const queue = async (why) => {
    if (said === why) return;
    said = why;
    await updateRun(where, t.id, { state: 'queued', why });
    await log(why === 'job_slot' ? 'waiting for the job slot' : 'waiting for the folder');
  };
  for (;;) {
    if (ctx.signal?.aborted) return { status: 'failed', code: 'call_failed' };
    if (deadline - Date.now() < DEADLINE_MIN_MS) return null;
    const on = await stillOn(ctx, connection);
    if (on.end) return { ended: on.end };
    const slot = await ctx.slot(where);
    if (!slot) { await queue('job_slot'); await sleep(Math.min(limits.pollMs, deadline - Date.now())); continue; }
    turn.slot = slot;
    said = null;
    await updateRun(where, t.id, { state: 'running', why: null });
    const watch = watchWhileDrawing(ctx, connection);
    let drawn;
    try {
      drawn = await ctx.draw({ top, base, head: t.sha, model: VISUAL_DEFAULT_MODEL, outDir, env,
        server: connection.server, deadline, signal: watch.signal,
        onStart: () => updateRun(where, t.id, { out: outDir }).catch(() => {}) });
    } finally { watch.done(); }
    if (watch.ended()) return { ended: watch.ended() };
    if (drawn.status === 'failed' && drawn.code === 'folder_in_use') {
      await queue('folder_in_use');
      turn.slot = null;
      await slot.release();
      await sleep(Math.min(limits.pollMs, deadline - Date.now()));
      continue;
    }
    return drawn;
  }
}

/** D227 review 1: the signal of a drawing: aborted by the runner's own (SIGTERM), or once, at a poll while it draws,
 *  the push hook or the connection has ended (`stillOn`), so the call running stops and none starts after it (D226).
 *  `ended()` is then that end; `done()` stops the polls. */
function watchWhileDrawing(ctx, connection) {
  const controller = new AbortController();
  const stop = () => controller.abort();
  if (ctx.signal?.aborted) stop();
  else ctx.signal?.addEventListener('abort', stop, { once: true });
  let end = null, looking = false;
  const timer = setInterval(async () => {
    if (looking || controller.signal.aborted) return;
    looking = true;
    try {
      const on = await stillOn(ctx, connection);
      if (on.end && !controller.signal.aborted) { end = on.end; stop(); }
    } catch { /* read again at the next poll */ } finally { looking = false; }
  }, ctx.limits.pollMs);
  return { signal: controller.signal, ended: () => end,
    done: () => { clearInterval(timer); ctx.signal?.removeEventListener('abort', stop); } };
}

/** The files of a finished folder, read while this process holds its lock (D226), with its page drawn anew in mode
 *  'hosted': the upload's body, or null when the folder holds no finished drawing. Waits for another drawer of the
 *  folder until `deadline`: 'gave_up' then. */
async function readFolder({ outDir, named, branch, deadline, pollMs }) {
  for (;;) {
    let lock;
    try { lock = await takeVisualLock(outDir); } catch { return null; }
    if (lock.release) {
      try {
        const { renderFinished } = await import('../../visual/src/job.mjs');
        const page = await renderFinished(outDir, { mode: 'hosted' });
        const read = async (name) => JSON.parse(await readFile(join(outDir, name), 'utf8'));
        return uploadBody({ owner: named.owner, name: named.name, branch, page, facts: await read('facts.json'),
          meaning: await read('meaning.json'), findings: await read('findings.json'), run: await read('run.json') });
      } catch { return null; } finally { await lock.release(); }
    }
    if (Date.now() + pollMs > deadline) return 'gave_up';
    await sleep(pollMs);
  }
}

/** The upload of a finished folder (step 8): `{ state, why, url?, status?, code? }`. D227 review: it goes under the
 *  connection read now, not the drawing's: the same server and login (A5), with the token the connection holds now (a
 *  new connection of the same login revoked the old one), and nothing when the connection is marked refused. The run is
 *  `uploading` under this process (its pid and start), so `sonah status` reads a send again as this process's. D227
 *  review 1: the push hook and the connection are read again before each try (`stillOn`), so nothing is sent once the
 *  person turned the hook off or ended the connection. */
async function uploadFolder(ctx, { id, top, named, branch, outDir, connection, deadline, log, sending = null }) {
  const sent = await sendFolder({ where: ctx.where, env: ctx.env, git: ctx.git, fetch: ctx.fetch, limits: ctx.limits,
    start: ctx.start, check: (asked) => stillOn(ctx, asked), id, top, named, branch, outDir, connection, deadline, log,
    sending });
  // A 403 `not_member` stands for the probe's: the repository's next tickets under this connection draw nothing.
  if (sent.why === 'not_member') ctx.pass.probes.set(probeKey(sent.using ?? connection, named), 'not_member');
  if (sent.why === 'upload_failed') ctx.pass.pending.add(id);
  return sent;
}

/** D228 review 1: takes the run `id` for this process's send: `uploading`, under this process's id and start, while no
 *  other one holds it (a run this process wrote itself, or one that waits to be sent, team-home.js `waitsToSend`) and
 *  while the run is still as it was read, under runs.json's lock. Whether it took it: a run that another process sends
 *  now is left to it, so one review is never sent twice and one run never names two senders (a share and a runner's
 *  pass can both read it while it waits). */
async function claimRun(where, id, start) {
  const seen = (await readRuns(where)).runs.find((r) => r.id === id) ?? null;
  if (!(seen === null || (seen.pid === process.pid && seen.start === start) || await waitsToSend(seen))) return false;
  let took = false;
  await updateRuns(where, (runs) => {
    const run = runs.find((r) => r.id === id) ?? null;
    // the run must still be as it was read: another process may have taken it between that read and this lock
    took = run === null ? seen === null
      : seen !== null && run.state === seen.state && run.pid === seen.pid && run.start === seen.start;
    if (!took) return runs;
    const mine = { state: 'uploading', why: null, pid: process.pid, start, updatedAt: new Date().toISOString() };
    return run === null ? [...runs, { id, ...mine }] : runs.map((r) => (r.id === id ? { ...r, ...mine } : r));
  });
  return took;
}

/**
 * D228: step 8, the upload of a finished folder, as the runner (`uploadFolder`) and `sonah share` (share-command.js)
 * both send one: `{ state, why, url?, status?, code?, using? }`, `using` the connection it last sent under. `check(asked)`
 * reads the connection again before the run is `uploading` and before each try (the runner's `stillOn`, share's
 * `connectionStill`): `{ connection }` to go on with, or `{ end }`. The run `id` is `uploading` under this process
 * while it sends; `sending()` is called once it is. D228 review 1: `{ state: 'taken' }`, and nothing sent, when
 * another process holds that run (`claimRun`); its caller leaves the run to that process.
 */
export async function sendFolder({ where, env, git, fetch, limits, start, check, id, top, named, branch, outDir,
  connection, deadline, log, sending = null }) {
  const first = await check(connection);
  if (first.end) return first.end;
  let using = first.connection;
  if (!(await claimRun(where, id, start))) return { state: 'taken' };
  // D227 review 0: the run is `uploading` now, so a review's job slot goes (`sending`)
  await sending?.();
  const body = await readFolder({ outDir, named, branch, deadline, pollMs: limits.pollMs });
  if (body === 'gave_up') return { state: 'gave_up' };
  if (body === null) return { state: 'failed', why: 'draw_failed', code: 'visual_failed' };
  try {
    // D229: which comments each session was opened to answer, from the launch records of `sonah fix` on this computer
    // (fix-launches.js), so the server can mark a fix pushed. None of them: every `answers` is empty.
    const answers = await answersBySession(where, repoKeyOf(named.owner, named.name)).catch(() => new Map());
    body.sessions = await uploadSessions({ dir: top, facts: body.facts, answers, env: localGitEnv(env), git });
  } catch {
    await log('the upload names no session: git cannot read the range here');
  }
  const size = Buffer.byteLength(JSON.stringify(body));
  if (size > UPLOAD_MAX_BYTES) return { state: 'failed', why: 'too_large' };
  for (let i = 0; ;) {
    const on = await check(using);
    if (on.end) return on.end;
    using = on.connection;
    try {
      const { url } = await teamApi({ server: using.server, token: using.token, fetch })
        .upload(body, { timeoutMs: within(deadline + limits.backstopMs - 10_000, TEAM_API_TIMEOUT_MS.upload) });
      await log(`POST /api/uploads: taken${url ? `, ${url}` : ''}`);
      return { state: 'done', why: 'uploaded', url, using };
    } catch (error) {
      if (!(error instanceof TeamApiError)) throw error;
      await log(`POST /api/uploads: ${error.kind}${error.status === null ? '' : ` ${error.status}`}`);
      // a 401 marks the connection refused (newerOrRefused), unless it holds a newer token: sent again with it
      if (error.kind === 'refused' && error.status === 401) {
        const newer = await newerOrRefused(where, using);
        if (newer) { using = newer; continue; }
      }
      const again = (error.kind === 'unreachable' || (error.kind === 'refused' && error.status >= 500))
        && i < limits.retryMs.length && Date.now() + limits.retryMs[i] < deadline;
      if (again) { await sleep(limits.retryMs[i]); i += 1; continue; }
      const ended = uploadEnd(error);
      return { state: ended.why === 'upload_failed' ? 'pending_upload' : 'failed', ...ended, using };
    }
  }
}

/** After the queue: the uploads that wait, the waiting comments of the repositories the pass probed (neither once the
 *  server refused the token), and the logs. D227 review: a repository's comments are asked again only under the
 *  connection that probed it (A5: a repository pushed under one connection is never named to another's server). D227
 *  review 1: neither once the push hook of the repository is off. */
async function afterQueue(ctx) {
  const { where, pass } = ctx;
  const usable = async () => {
    if (!(await hookOn(where, ctx.common))) return null;
    const saved = await readConnection(where);
    return saved.state === 'ok' && pass.end !== 'refused' && !(await isRefused(saved.connection, where))
      ? saved.connection : null;
  };
  if (await usable()) await sendPending(ctx).catch(() => {});
  const connection = await usable();
  const probed = [...pass.probed.values()];
  pass.probed.clear();
  for (const { named, server, login } of connection ? probed : []) {
    if (server !== connection.server || login !== connection.login) continue;
    try {
      const json = await teamApi({ server: connection.server, token: connection.token, fetch: ctx.fetch })
        .fixes(named);
      const list = checkList(json, named);
      if (list) await saveWaiting(where, connection, list);
    } catch (error) { if (!(error instanceof TeamApiError)) throw error; }
  }
  await pruneLogs(logsPath(where));
}

/**
 * D228 review 1: whether the review of `run` takes the place of `older`'s, both of one repository and branch: its
 * commit holds the other's (the merge base of the two is the other's), else, where git cannot say which holds which (a
 * push that moved the branch to another line of commits, or a commit this computer no longer holds), the newer of the
 * two by its time, and by its id for two of one time. The time alone will not do: `sonah share` puts up the page of any
 * commit of the repository at any time, so a share of an older page would take the place of a newer review that waits
 * to be sent, and that review would never be sent. `dir` is a folder of the repository, `seen` the merge bases read.
 * D228 review 2: exactly one of a pair takes the other's place, and no more than that holds: the two orders it reads
 * do not order three reviews, which can stand in a ring. A caller that needs one newest review of a branch takes it
 * with this relation over the whole set (`sendPending`'s `newestOf`), or judges every other run against one fixed
 * review of its own, as share's `replaceOlder` does; a caller may never read "nobody took mine" as "mine is newest".
 * D228 review 4: `head`, the commit the branch holds (null when this computer cannot say; D228 review 5: the branch
 * on the remote, `pushedTip`), decides before the two of them: a review of a commit the branch holds takes the place
 * of one of a commit it does not. Without it, the commits read backwards whenever the branch moved back onto a commit
 * it already held (`git reset --hard HEAD~1` and a force-push, a commit dropped in a rebase): the dropped commit's
 * review holds the tip's, which is the newer push's, and nothing then sends the tip's. The same read keeps a share of
 * a page of another line of commits from taking the place of the waiting review of the tip, which the times alone
 * gave it.
 * D228 review (second look 2, review 1): `head` decides two more pairs that the times decided before, both of them
 * reached only since the set the election reads spans this computer's clones (`sendPending`'s `newestOf`):
 *   - The review of the very commit the remote's branch holds takes the place of one of any other commit, whether or
 *     not git here can relate the two. That is what the team reads a review of, so no commit git here cannot say a
 *     word about may stand over it. Read as "the branch's line only", a candidate whose object this computer holds
 *     nowhere (another clone's commit, a commit never pushed) left the pair to the commits and then to the times,
 *     where the newer `at` won: a share of another clone's unpushed commit was elected the branch's newest, the pass
 *     then left the whole review to that clone (`newer.common !== common`), and the only review of the commit the
 *     remote holds was never sent — not by that pass and not by any pass after it, since every pass reads the same
 *     rows and the same order.
 * D228 review (second look 2, review 2): and the times are the last order across the clones too, as they are within
 * one. Review 1 put a `clone` order under the commits — where neither of git's orders could say a word, the run of
 * the pass's own git common dir took the place of another clone's — so that a dormant clone's row could not hold this
 * clone's waiting review off the sends for good. That is each pass's own order and not one order of the set, which is
 * what one newest review of a branch needs (review 2), and a pass that elects its own run of a pair nothing can order
 * sends it: it POSTed this clone's older page over the newer review another clone had already put on the server
 * (nothing written `replaced`, both rows reading `done`, two urls — the very failure second look 2 widened the set to
 * end), and two live clones each elected their own run and both POSTed the one review the server keeps, the team
 * reading whichever landed last. The times say nothing across clones, but they say the same thing in every clone: one
 * clone sends and every other leaves it alone. The waiting review nothing can order against another clone's keeps
 * waiting instead (`sonah status` says so), and the next push of either clone gives the commits something to say.
 */
export async function takesPlaceOf(run, older, options) {
  return (await placeOrder(run, older, options)).takes;
}

/** D228 review 4: `takesPlaceOf` with the order it read: `{ takes, by }`, `by` the branch's line (`line`), the commits
 *  (`commits`) or the times (`time`). Only `sendPending`'s `newestOf` needs it: git's own two orders hold over the
 *  times when one newest review of a branch is taken out of a set the relation leaves in a ring. */
async function placeOrder(run, older, { dir, env, git = gitOut, seen = new Map(), head = null }) {
  const after = run.at === older.at ? run.id > older.id : String(older.at ?? '') < String(run.at ?? '');
  if (dir === null || run.sha === null || older.sha === null || run.sha === older.sha) {
    return { takes: after, by: 'time' };
  }
  const baseOf = async (a, b) => {
    const key = `${a} ${b}`;
    if (!seen.has(key)) seen.set(key, await mergeBase(dir, a, b, { env, git }));
    return seen.get(key);
  };
  // The branch's line, where git can say of both commits whether the branch holds it: null is "git cannot say", which
  // is not "the branch does not hold it" (a commit this computer no longer holds is still the newer push's commit).
  // D228 review 5: `head` is the branch on the remote (`pushedTip`), which is the branch the team reads a review of.
  if (head !== null) {
    // D228 review (second look 2, review 1): the review of the commit the branch holds there is the one the team
    // reads, so it takes the place of a review of any other commit — the shas are not equal here, so one of these
    // runs at most is of it, and nothing git cannot say of the other can outrank the branch itself.
    if (run.sha === head || older.sha === head) return { takes: run.sha === head, by: 'line' };
    const holds = async (sha) => {
      const held = await baseOf(head, sha);
      return held === null ? null : held === sha;
    };
    const ours = await holds(run.sha);
    const theirs = await holds(older.sha);
    if (ours !== null && theirs !== null && ours !== theirs) return { takes: ours, by: 'line' };
  }
  const base = await baseOf(older.sha, run.sha);
  if (base === older.sha) return { takes: true, by: 'commits' };
  if (base === run.sha) return { takes: false, by: 'commits' };
  // D228 review (second look 2, review 2): and the times across clones too — one order of the set, the same in every
  // clone's pass, where review 1's `clone` order was each pass's own and had two of them POST one review.
  return { takes: after, by: 'time' };
}

/**
 * D228 review 5: the commit the branch of `runs` (the runs of one repository and branch) holds on the remote: the
 * remote-tracking ref that a push of the branch moves, as git last saw it here (`trackingRef`, no network), else, when
 * the remote's refspecs map no such ref, the commit the remote itself names (`remoteTip`, `ls-remote`), read in `dir`,
 * a folder of the repository or its git common dir; null when this computer cannot say.
 * `takesPlaceOf`'s `head` is this and never `refs/heads/<branch>`: a run's branch is the branch its push named on the
 * remote (push-hook-run.js `pushedBranches` keeps git's remote ref, so `git push origin work:main` is a run of
 * `main`), a review is of a commit that was pushed, and the server keeps each review under that branch, while the
 * local branch moves with no push at all — `git commit --amend`, a rebase, `git reset --hard`, `git checkout -B`.
 * Read from the local branch, review 4's own rule then elected the review of an ancestor as the branch's newest and
 * ended the review of the commit the remote holds `replaced`, `newer_push`, which `waitsToSend` is false for: nothing
 * sent the only review of the commit the team can see, and `sonah status` said a newer review took its place.
 * D228 review (second look 1), two reads that answered about a branch no push of these runs went to:
 *   - The remote is the one name every run of the set names, and null with anything else — never `origin` by default.
 *     A push made with a URL rather than a remote's name leaves `remote` null on its run (`ticketFields`), so with
 *     `origin` as the default this read gave the commit *this* computer's `origin` holds on a branch of that name:
 *     `takesPlaceOf` reads `head` before the commits and the times, so an older review of an ancestor of that commit
 *     was elected as the branch's newest and the pushed commit's review ended `replaced`, `newer_push`, which nothing
 *     sends again. A share names the remote it sent under (share-command.js), so the runs of a branch that is only
 *     ever shared still agree on one.
 *   - `ls-remote` when no refspec maps the branch, which D227 review (second look 2) widened to a refspec that maps
 *     it into any namespace but `refs/remotes/` — a mirror-style or backup remote's `+refs/*:refs/*` mapped it onto
 *     this computer's own branch, and this read then gave that branch's commit as the remote's.
 *     A clone made with `--single-branch` or `--depth` keeps one
 *     refspec (`+refs/heads/main:refs/remotes/origin/main`), so a push of any other branch moves no
 *     remote-tracking ref and this read was null for every branch but that one: the pair fell to the commits and the
 *     times, which is the order review 4 was added to correct, so a `git reset --hard` and a force-push there sent the
 *     review of a commit the branch no longer holds and ended the tip's `replaced`. Step 1 pays for the same call in
 *     the same case (`remoteShows`).
 * D228 review (second look 2, review 1): the runs may name several remotes of the one repository, and the remote
 * itself is asked whenever this computer's own cache of the branch cannot answer for them:
 *   - Every run must still name a remote's name (D228 review, second look 2, review 2: at least one must, and a run
 *     that names none is left out of the names rather than turning this read off — see below),
 *     but several names are read, not refused: second look 2 keys a review by the repository as the server folds it,
 *     so `origin` -> `git@github.com:acme/widgets.git` and `gh` -> `https://github.com/Acme/widgets.git` are one
 *     review here where they were two, and `https`-and-`ssh` pairs of one repository are an everyday remote list.
 *     Refused as a disagreement, a second name turned this read off for the whole review — `head` is read before the
 *     commits and the times, so that is review 4's and review 5's own bug back: after a `git reset --hard` and a
 *     force-push the commits elect the dropped commit's review and end the tip's `replaced`, `newer_push`. Each name
 *     is read and the ones that answer must agree on the commit; a name whose branch this computer knows nothing of
 *     (a remote never pushed or fetched here) says nothing rather than null for all of them, and two names that
 *     answer differently leave this null, since a guess outranks both other orders.
 *   - `fresh` asks the remote itself (`remoteTip`) instead of the ref this computer keeps. That ref is a cache that
 *     this clone's own pushes and fetches move and nothing else does, so it can answer about this clone's own runs
 *     and not about another clone's: with the election's set spanning the clones of one repository (`sendPending`),
 *     clone A's push of P1 left `refs/remotes/origin/feature` at P1, clone B pushed P2 on top of it and A never
 *     fetched, and this read gave P1 as the commit the branch holds — so A elected its own review of P1 as the
 *     branch's newest and POSTed it, and the page the team reads went backwards over the review of P2 that the
 *     server had taken. Several names are asked the same way, since two caches of one repository are two ages.
 * D228 review (second look 2, review 2), three reads that were null where something could still be said, each of them
 * `head` null for the whole review — which is review 4's and review 5's own mis-election, since the commits then read
 * backwards after a `git reset --hard` and a force-push and end the tip's review `replaced`, `newer_push`:
 *   - A run that names no remote (a push made with an address, `ticketFields`) is left out of the names, and the
 *     names that are there are read, where review 1 refused the whole set for it. That is not second look 1's
 *     `origin` by default: a name here is a name a push *of this review* went out through, and the set is of one
 *     repository as the server keys it (`reviewKey`), while second look 1's default read a remote no run named at
 *     all. One push made with a URL — the branch force-pushed with its address pasted in — turned the read off for
 *     the clone's own force-push case and elected the dropped commit's review. With no name at all this is still
 *     null, with second look 1's test of it. Such a set is asked of the remote (`ask`), since an address push moves
 *     no ref here and this clone's cache is behind the branch by construction.
 *   - Where `git ls-remote` gives no answer at all (the remote cannot be reached, its credentials are not there for a
 *     detached runner, the call ran out of time — `remoteTip`'s `undefined`, which is not its null for "the remote has
 *     no such branch"), this clone's own remote-tracking ref answers for that name. Review 1 took no answer for null
 *     and `sendPending` asks as soon as another clone has a run of the review, and a pass runs up to half an hour
 *     after the push (`afterQueue`), so an outage with any clone's row in runs.json left this read null for pairs that
 *     are wholly this clone's own, where the ref is no guess at all — it is what this clone's own force-push moved.
 *     A cache that is behind can be wrong across clones, which is what asking first is for; with no answer from the
 *     remote it is the only thing either order has.
 *   - And a name that neither the remote nor this computer can say a word about leaves this null for the whole review,
 *     where review 1 let the names that did answer stand for it: one name's answer is a guess about a review the
 *     others may hold another commit of — a mirror that lags behind the remote the branch was really pushed to — and
 *     a wrong `head` outranks both other orders. "The remote has no such branch" stays an answer, not a gap.
 * `until`, a time by which the reads should be done, bounds each `ls-remote` (`sonah share` gives it one: review 2,
 * finding 7, where two names could hold the person's terminal for a minute after the page was already online).
 */
export async function pushedTip(dir, runs, branch, { env, git = gitOut, fresh = false, until = null } = {}) {
  if (typeof branch !== 'string' || branch === '') return null;
  const names = new Set(runs.map((r) => r.remote));
  const named = [...names].filter((name) => isRemoteName(name));
  if (!named.length) return null;
  const local = localGitEnv(env);
  const ask = fresh || named.length > 1 || named.length !== names.size;
  // What this computer keeps of that remote's branch: the sha, null where the ref is there and git cannot read it,
  // undefined where no refspec maps the branch at all (nothing of this computer's to read).
  const cached = async (remote) => {
    const ref = await trackingRef(dir, remote, branch, { env: local, git });
    return ref === null ? undefined : await revParse(dir, ref, { env: local, git });
  };
  // What the remote itself says: the sha, null for no such branch, undefined where git gave no answer.
  const asked = (remote) => remoteTip(dir, remote, `refs/heads/${branch}`, { env: remoteGitEnv(env), git,
    ...(until === null ? {} : { timeoutMs: within(until, 30_000) }) });
  const shas = new Set();
  for (const remote of named) {
    let sha = ask ? await asked(remote) : await cached(remote);
    if (sha === undefined) sha = ask ? await cached(remote) : await asked(remote);
    if (sha === undefined) return null;
    if (sha !== null) shas.add(sha);
  }
  return shas.size === 1 ? [...shas][0] : null;
}

/**
 * D228 review (second look 1): the review a run belongs to on the server, as the server keys one: the repository and
 * the branch, never the branch alone. The server keeps one branch review per team, owner, repository and branch
 * (sonah-hosted HOSTING.md), and a run names the repository of its own push's remote (`review`, from `pushUrlOf`), so
 * two runs of one branch name two reviews whenever they went to two remotes — a fork's `origin` and the team's
 * `upstream` is the everyday case. Keyed by the branch alone, the newest-review election (`sendPending`'s `newestOf`)
 * and share's `replaceOlder` took them for one: the review of one repository was elected and the other's ended
 * `replaced`, `newer_push`, which `waitsToSend` is false for, so the review the team reads was never sent while
 * `sonah status` said a newer one had taken its place — and the newer one had gone to a different repository.
 * D228 review (second look 2): the repository as the server keys it, which is its owner and name in lower case
 * (`repoKeyOf`, the key the probe's answer is already read under: fix-waiting.js `checkList` takes the server's own
 * answer for this repository's whatever case it names it in). A run's `repo` is the owner and name of its push URL
 * with no folding (visual-command.js `remoteRepository`), and one repository is reached under two casings every day —
 * `https://github.com/Acme/widgets.git` and `git@github.com:acme/widgets.git` are one GitHub repository. Two keys
 * here and one review there: a waiting review of an older commit under one casing was never ordered against the newer
 * one already sent under the other, `newestOf` found it alone in its group and elected it, and the POST put the older
 * commit's page up as the branch's review over the newer one the team was reading, with nothing written `replaced`
 * and both rows reading `done`.
 * A run whose `repo` is no owner and name (a row of an older Sonah, a file edited by hand) is a review of its own, by
 * its id: nothing is ordered against it, so no other run is ever written `replaced` under the name of a repository
 * this computer cannot read.
 */
export function reviewKey(run) {
  const parts = String(run.repo ?? '').split('/');
  const repo = parts.length === 2 && parts[0] && parts[1] ? repoKeyOf(parts[0], parts[1]) : null;
  return JSON.stringify(repo === null ? [null, run.branch, run.id ?? null] : [repo, run.branch]);
}

/** D228 review 4: ends the run `seen` `replaced`, `newer_push`, while it is still the pass's to write (`endRun`). */
async function replaceRun(where, seen) {
  return endRun(where, seen, { state: 'replaced', why: 'newer_push' });
}

/**
 * D228 review 4: writes `patch` on the run `seen` that the pass read, while that row is still the pass's to write
 * under runs.json's lock: still as the pass read it (its state, pid and start, as `claimRun` and team-home.js
 * `endPendingUploads` read theirs), or (D228 review 5) taken up by this process for its own send, which `claimRun`
 * wrote this pid and `start` on. `sendPending` decides from one read of runs.json and sends under a deadline of half
 * an hour, so a `sonah share` the person ran meanwhile may have taken one of the runs it read up and put it online: an
 * unguarded write then said "A newer review of this branch took the place of this one." or "This computer has another
 * connection to Sonah Team now." over the row of the page they were just given the link to, that row no longer read
 * `shared`, and nothing sends again a run that left `waitsToSend`. Whether it was written.
 */
async function endRun(where, seen, patch, { start = null } = {}) {
  let wrote = false;
  await updateRuns(where, (runs) => runs.map((r) => {
    const read = r.state === seen.state && r.pid === seen.pid && r.start === seen.start;
    const mine = start !== null && r.state === 'uploading' && r.pid === process.pid && r.start === start;
    if (r.id !== seen.id || !(read || mine)) return r;
    wrote = true;
    return { ...r, ...patch, updatedAt: new Date().toISOString() };
  }));
  return wrote;
}

/**
 * The uploads of this repository that wait (`pending_upload`, and D227 review: `uploading` whose process ended, a send
 * again that was killed): of each review the server keeps (`reviewKey`, D228 review, second look 1) only the newest
 * finished drawing is sent again (the others end `replaced`;
 * D228 review 1: `takesPlaceOf` reads the commits, not the times alone; D228 review 2: `newestOf` picks that one
 * review, since the pair that relation judges does not order three; D228 review 4: it reads the commit the branch
 * holds now before them both, and the run it ends `replaced` must still be the one this pass read, `replaceRun`), and
 * only under the connection it was drawn under (else `failed`, `connection_changed`). One that this pass made wait
 * is left for the next pass. D227 review: once the server refused the token (this pass's 401 or the mark), nothing more
 * is sent; what waits stays for a new connection of the same login.
 * D228 review (second look 2): which review is the newest is read over every run of runs.json, this git common dir's
 * and another clone's alike, since the server keeps one review of each owner, repository and branch while two clones
 * of one repository on one computer are two passes of their own. What a pass may send and what it may write stay this
 * clone's: it sends only a run whose page files are in its own folders, and it writes an end only on a row it read
 * (`endRun`). Read from this clone's runs alone, two clones both hooked and both pushing one branch were never
 * ordered: clone A's push of an older commit waited for a 503 while clone B pushed a descendant and the server took
 * it, and clone A's next pass found its own waiting review alone, elected it as the branch's newest and POSTed it, so
 * the page the team reads went back to the older commit with nothing written `replaced` and `sonah status` reading
 * `done` in both clones.
 */
async function sendPending(ctx) {
  const { where, common, env, git, limits, pass, start } = ctx;
  const { runs } = await readRuns(where);
  const named = runs.filter((r) => r.branch !== null);
  const waits = new Set();
  for (const r of named) if (await waitsToSend(r)) waits.add(r.id);
  // What this pass may send: the runs that wait whose page this clone holds.
  const pending = named.filter((r) => r.common === common && waits.has(r.id));
  if (!pending.length) return;
  // D228 review (second look 1): the repositories and branches another process is uploading now, read from every run
  // and not only this repository's, since the server keeps one review of each owner, repository and branch and two
  // clones of one repository are two passes of their own. Such a branch is left to that process this pass: nothing of
  // it is sent and nothing of it is ended. One snapshot of runs.json decides the whole pass, and `waitsToSend` is
  // false for a row a live process holds, so a `sonah share` that took a run up and started its own upload a moment
  // before this read was in neither arm of the set below: the pass elected an older review of the branch as its
  // newest and POSTed it, and nothing orders the two POSTs — the server takes the last one as the branch's head, so
  // the team could be left reading the review of the older commit while the person was handed the link of the newer.
  // That process writes the ends: a share's `replaceOlder` ends what its page replaced, and a run this pass leaves
  // still waits, so the next pass or the next share sends it, as one this pass made wait is left.
  const sending = new Set();
  for (const r of named) {
    if (r.state !== 'uploading' || r.pid === null || r.pid === process.pid) continue;
    if (await lockHeld({ pid: r.pid, start: r.start })) sending.add(reviewKey(r));
  }
  const saved = await readConnection(where);
  // D228 review 1: which review of a branch is the newest is read from the commits, not from the times alone.
  const seen = new Map();
  const local = localGitEnv(env);
  // D228 review 2: the pass takes one newest review of a branch, and only the others end `replaced`. `takesPlaceOf`
  // judges a pair, and it reads two orders: the commits where git relates the two, the times where it cannot. The two
  // together do not order three, so the reviews of one branch can stand in a ring, each taking another's place (a
  // commit, a commit of another line after a push that moved the branch, and an ancestor of the first, drawn in that
  // order). Asking each only "did another take my place?" then wrote `replaced` over every one of them and sent none:
  // the server held no review of the branch, while `sonah status` said of each that a newer one took its place, and
  // every one of them was drawn on the person's own Claude Code plan.
  const newest = new Map();
  // D228 review 4: and the commit each branch holds, which `takesPlaceOf` reads before the two orders below. D228
  // review 5: the branch on the remote the runs name, never this computer's own branch (`pushedTip`), which an amend,
  // a rebase or a `git reset --hard` moves with no push and no review of its own. D228 review (second look 2): read
  // in this clone, of the one remote every run of the set names — the set is of one repository on the server
  // (`reviewKey`), so a remote of that name here is a remote of that repository, and `pushedTip` is null the moment
  // the runs do not agree on one name.
  // D228 review (second look 2, review 1): of the remotes THIS clone's own runs of the review name, and asked of the
  // remote itself as soon as another clone's run is in the set. A remote's name is each clone's own word for a
  // repository — a fork's `origin` beside the team's `upstream`, an `https` remote beside an `ssh` one — so with the
  // set widened to every clone, one foreign row naming the same repository by another name (or by a URL, which
  // leaves `remote` null) turned this read off for this clone's own election: `head` is read before the commits and
  // the times, so after a `git reset --hard` and a force-push the commits elected the dropped commit's review, the
  // pass POSTed the page of a commit the remote does not hold, and the only review of the commit it does hold ended
  // `replaced`, `newer_push`, which nothing sends again — review 4's and review 5's own bug, restored by a row this
  // pass neither sends nor ends. A remote-tracking ref is this clone's own cache, which its own pushes and fetches
  // move and another clone's do not, so a set that spans clones is ordered against the remote's own answer.
  // D228 review (second look 2, review 2): and where that answer does not come (`fresh` is true as soon as any other
  // clone has a row of the review, and a pass runs up to half an hour after the push, so a remote this computer
  // cannot reach is an everyday state), this clone's own cache answers for it rather than leaving `head` null for
  // pairs that are wholly this clone's own — null there is review 4's and review 5's mis-election in full
  // (`pushedTip`). One of this clone's rows naming no remote no longer turns the read off either.
  const heads = new Map();
  const headOf = async (key, branch, ours) => {
    if (!heads.has(key)) {
      const mine = ours.filter((x) => x.common === common);
      heads.set(key, await pushedTip(common, mine, branch, { env, git, fresh: mine.length !== ours.length }));
    }
    return heads.get(key);
  };
  const newestOf = async (run) => {
    const key = reviewKey(run);
    if (!newest.has(key)) {
      // D228 review (second look 2): every clone's runs of this review, not this clone's alone.
      const ours = named.filter((x) => reviewKey(x) === key
        && (['done', 'shared'].includes(x.state) || waits.has(x.id)));
      // D228 review (second look 2, review 2): one relation over the set, the same in every clone's pass — review 1's
      // `clone` order (this pass's own common dir winning where git's orders say nothing) was each pass's own, so two
      // clones elected two newest reviews of the one branch and both POSTed it (`takesPlaceOf`).
      const of = { dir: common, env: local, git, seen, head: await headOf(key, run.branch, ours) };
      let found = ours[0] ?? null;
      for (const x of ours.slice(1)) if ((await placeOrder(x, found, of)).takes) found = x;
      // D228 review 4: the reduce above holds whichever review the ones after it did not take the place of, and the
      // times are one of the two orders it reads, so in a ring it can hold a review that a review it passed over takes
      // the place of by the commits or by the branch's line — a pass then put an ancestor's review up as the branch's
      // page and ended the tip's `replaced`. Each round takes a review that takes the place of the one found by one of
      // git's own two orders, which are a partial order of the commits: each round rises in it, so the rounds end, and
      // one pass over the set is enough where the relation orders it at all. D228 review (second look 2, review 1):
      // those two orders by name (`line` and `commits`), the times being the only other one.
      for (let round = 0; found !== null && round < ours.length; round += 1) {
        let took = false;
        for (const x of ours) {
          if (x.id === found.id) continue;
          const order = await placeOrder(x, found, of);
          if (order.takes && ['line', 'commits'].includes(order.by)) { found = x; took = true; }
        }
        if (!took) break;
      }
      newest.set(key, found);
    }
    return newest.get(key);
  };
  for (const r of pending) {
    if (sending.has(reviewKey(r))) continue;
    const newer = await newestOf(r);
    if (newer !== null && newer.id !== r.id) {
      // D228 review (second look 2): the newest review of this one is another clone's run, so the whole review is
      // left to that clone's own pass this pass, as a review a live process is uploading is: this pass holds no page
      // of it to send, and an end it wrote there would be a terminal `replaced` on a row whose own clone can still
      // send it (`waitsToSend` is false for `replaced`). Nothing is lost: the run keeps waiting, and every pass reads
      // the same order, so this one is never sent while that one stands.
      // D228 review (second look 2, review 2): which is also what holds where no order of the commits can say a word
      // at all (a push made with an address and no name to read the branch from, a branch deleted on the remote, two
      // clones whose commits git here cannot relate) and the times leave the newest with a clone that may never run
      // again: this review waits, and `sonah status` says it waits to be sent. Review 1 sent it here instead, by an
      // order each pass read its own way, and so put this clone's older page over the newer review the server already
      // held and had two live clones POST the one review between them.
      if (newer.common !== common) continue;
      await replaceRun(where, r);
      continue;
    }
    if (pass.pending.has(r.id)) continue;
    const connection = saved.state === 'ok' ? saved.connection : null;
    // D228 review 5: guarded as the `replaced` write above is. A share may have re-homed this very run to this
    // connection and put its page online while the pass was sending an earlier one (share-command.js writes `server`
    // and `login` before its upload for just that reason), and the pass holds the snapshot from before that share.
    if (!connection || connection.server !== r.server || connection.login !== r.login) {
      await endRun(where, r, { state: 'failed', why: 'connection_changed' });
      continue;
    }
    if (pass.end === 'refused' || await isRefused(connection, where)) continue;
    const [owner, name] = String(r.repo ?? '').split('/');
    const top = r.out ? await placeOf(r.dir ?? '/', common, ctx) : null;
    if (!owner || !name || !top) { await endRun(where, r, { state: 'failed', why: 'repository_gone' }); continue; }
    const log = r.log ? openLog(r.log, [connection.token]) : async () => {};
    await log(`sending the upload that waits, of ${r.branch} ${r.sha}`);
    const sent = await uploadFolder(ctx, { id: r.id, top, named: { owner, name }, branch: r.branch, outDir: r.out,
      connection, deadline: Date.now() + limits.giveUpMs, log });
    // D228 review 1: a share (or another pass) holds this run and sends it: its end is that process's to write.
    if (sent.state === 'taken') { await log('another Sonah sends this review now'); continue; }
    if (sent.why === 'refused') pass.end = 'refused';
    // D228 review 5: the end goes on the row this pass took up for its send (`claimRun`), or, for an end
    // `sendFolder` read before it took the run (the hook or the connection ended while the pass sent an earlier
    // review), on the row as the pass read it: a share that took this run up meanwhile keeps its `shared` row, where
    // this write erased the very link the person was given (`url: sent.url ?? null`).
    const end = { state: sent.state === 'gave_up' ? 'pending_upload' : sent.state,
      why: sent.state === 'gave_up' ? 'upload_failed' : sent.why, url: sent.url ?? null, status: sent.status ?? null,
      code: sent.code ?? null };
    if (!(await endRun(where, r, end, { start }))) { await log('another Sonah sends this review now'); continue; }
    await log(`${end.state}: ${whyWords({ ...r, ...end }) ?? end.why}`);
  }
}

/**
 * `sonah status`'s runs (no network): the newest 10, or all, each as `{ id, repo, branch, sha, state, why, words, code,
 * status, url, log, out, at, updatedAt }`, a run whose process ended while it ran shown as `stopped`; and the waiting
 * comments of the connection's cache, `[{ repo, waiting, total, at }]`. `lines` are the text lines of both.
 */
export async function runsReport({ where, connection = null, all = false }) {
  const { runs } = await readRuns(where);
  const listed = [];
  for (const r of [...runs].reverse().slice(0, all ? undefined : 10)) {
    const working = RUNNING.includes(r.state) || (r.state === 'queued' && r.pid !== null);
    const gone = working && (r.pid === null || !(await lockHeld({ pid: r.pid, start: r.start })));
    const run = gone ? { ...r, state: 'stopped', why: 'process_ended' } : r;
    listed.push({ id: run.id, repo: run.repo, branch: run.branch, sha: run.sha, state: run.state, why: run.why,
      words: whyWords(run), code: run.code, status: run.status, url: run.url, log: run.log, out: run.out, at: run.at,
      updatedAt: run.updatedAt });
  }
  const cached = connection ? await readWaiting(where, connection) : {};
  const waiting = Object.entries(cached).map(([repo, entry]) => ({ repo, waiting: waitingCount(entry),
    total: entry.total, at: entry.at }));
  const lines = [];
  if (listed.length) {
    lines.push(PUSH_RUN_WORDS.heading);
    for (const r of listed) {
      lines.push(`  ${shown(r.repo ?? '-')} ${shown(r.branch ?? '-')} ${short(r.sha)}: ${r.state}`);
      if (r.words) lines.push(`    ${shown(r.words)}`);
      if (r.url) lines.push(`    page: ${shown(r.url)}`);
      if (r.log) lines.push(`    log: ${r.log}`);
    }
  }
  for (const w of waiting) if (w.waiting > 0) lines.push(PUSH_RUN_WORDS.waiting(w.waiting, shown(w.repo)));
  return { runs: listed, waiting, lines };
}

/** The kind of each of this file's word tables, for the style linter (packages/render/test/style-lint.js). */
export const STYLE_KINDS = Object.freeze({ PUSH_RUN_WORDS: 'notice', 'PUSH_RUN_WORDS.heading': 'heading' });
export const STYLE_ALLOW = Object.freeze({ 'PUSH_RUN_WORDS.why.auth': ['quoted-term'] });
const SERVER = 'https://pr.sonah.dev';
export const STYLE_FIXTURES = Object.freeze({
  'PUSH_RUN_WORDS.why.newer_push': [['feature-x']],
  'PUSH_RUN_WORDS.why.on_default_branch': [['origin']],
  'PUSH_RUN_WORDS.why.remote_never_showed': [['10 minutes']],
  'PUSH_RUN_WORDS.why.refused': [[SERVER]],
  'PUSH_RUN_WORDS.why.not_member': [[SERVER]],
  'PUSH_RUN_WORDS.why.no_base': [['origin']],
  'PUSH_RUN_WORDS.why.draw_failed': [['timeout']],
  'PUSH_RUN_WORDS.why.upload_refused': [[SERVER, 400, 'bad_upload'], [SERVER, 404, null]],
  'PUSH_RUN_WORDS.why.time_limit': [['30 minutes']],
  'PUSH_RUN_WORDS.why.upload_failed': [[SERVER, null], [SERVER, 503]],
  'PUSH_RUN_WORDS.why.uploaded': [[SERVER]],
  'PUSH_RUN_WORDS.waiting': [[1, 'acme/widgets'], [3, 'acme/widgets']],
});
