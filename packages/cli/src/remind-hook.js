// D230 (item 10, C7): what Claude Code runs when it starts or resumes, through the entry that `sonah remind on` writes
// (remind.js), and the refresh it starts. Ported from the private laptop client's remind.mjs (sonah-hosted
// client/remind.mjs, its hook half), with the cache of fix-waiting.js and the connection of team-home.js.
//   hidden `sonah remind-hook`  reads Claude Code's hook input on standard input (its `cwd`: 1 s and 64 KB at most, the
//        rest read and dropped), then, with no network call: the connection, one `git remote -v` of that folder (2 s),
//        and the comments that wait for you on its repositories in the cache of this connection, those Claude Code is
//        already on (launched) left out. When any wait, it prints one JSON line, `{"systemMessage": ...}`, which Claude
//        Code shows to you; never `additionalContext`, which would hand a teammate's words to the model unasked. Each
//        comment links to its thread on the server, since `sonah fix` does not run inside Claude Code. With no
//        connection, a token the server refused, or no comment, it prints nothing.
//   hidden `sonah remind-refresh <folder>`  started detached by the hook when the cache of one of the folder's
//        repositories is a minute old or more: one `GET /api/fixes` a repository of the folder that the cache of this
//        connection already holds, so no repository reaches the server that `sonah fixes` or a push did not already
//        name to it, each answer kept as `sonah fixes` keeps it. At most once a minute a repository, whatever the number
//        of sessions that start: `team/locks/remind.json` holds when each was last asked, read and written under its
//        lock. A 401 marks the connection refused, as every other call does. D230 review 1: the claim is made only while
//        the connection on file is still the one the refresh read, and a refusal by which the server says it no longer
//        lists that repository for this person drops that repository's list from the cache, so it is neither shown nor
//        asked for again. D230 review 2: only a 403 whose code is one the server sends for that (`FORGET_CODES`); a 403
//        or a 404 with no such code is a proxy's or a load balancer's page, and changes nothing, as in the push run.
// Both are hidden commands with crash handlers of their own (bin/sonah.js): they always exit 0 and print nothing but
// that one line, so a start of Claude Code is never failed, slowed past the entry's own limit, or shown an error. The
// hook loads Node's own modules and the modules the push hook loads, never the review's (d230-remind.test.js pins the
// list); the refresh loads team-api.js only once it has a repository to ask about.
//
// No work at import.
import { execFile, spawn } from 'node:child_process';
import { isAbsolute, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { strictJson } from '../../slicer/src/strict-json.js';
import { CUT, FRAME, isLogin, isTime, shown } from '../../visual/src/fix-prompt.mjs';
import { checkList, forgetWaiting, notLaunched, readWaiting, repoKeyOf, saveWaiting,
  waitingCount } from './fix-waiting.js';
import { remoteRepository } from './team-git.js';
import { isRefused, LOCKS_FOLDER, markRefused, readConnection, readOwnText, REMIND_FILE, remindPath,
  withFileLock, writeWhole } from './team-home.js';

/** A cached list younger than this is not asked for again, and a repository asked for this long ago is not either. */
export const REFRESH_AFTER_MS = 60_000;
/** How long the hook reads its input, and how much of it it keeps. */
export const HOOK_INPUT_MS = 1000;
export const HOOK_INPUT_BYTES = 64 * 1024;
/** How long the hook's one git call may take. */
export const HOOK_GIT_MS = 2000;
/** The comments the reminder shows a repository; the count says them all. */
export const REMIND_SHOWN_MAX = 5;
const REFRESH_VERSION = 1;
const MAX_REFRESH_BYTES = 64 * 1024;
/** D230 review 2: the codes of a 403 by which the server says it lists no comments of that repository for this
 *  person (sonah-hosted server/uploads.mjs and app.mjs: no team, the GitHub app not on the repository, no right to
 *  push to it). Any other refusal leaves the cache as it is. */
export const FORGET_CODES = Object.freeze(['not_member', 'not_installed', 'forbidden']);
/** What a listing shows of an item's title, as `sonah fixes` shows it (fix-command.js). */
const TITLE_SHOWN_MAX = 90;
/** This install's entry, which the hook starts the refresh with. */
const SONAH_CLI = fileURLToPath(new URL('../bin/sonah.js', import.meta.url));
const plainObject = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);

/** The reminder's lines. A repository, a title and a teammate's words are shown through fix-prompt.mjs `shown`. */
export const REMIND_HOOK_WORDS = Object.freeze({
  waiting: (count, repo) => `${count === 1 ? '1 comment waits' : `${count} comments wait`} for you on ${repo} `
    + '(sonah fixes).',
  // A comment as `sonah fixes` lists it (fix-command.js `entryLines`, which d230-remind.test.js holds this to).
  entry: (login, verb, where, what) => `@${login} ${verb} on ${where} · ${what}`,
  more: (count) => `and ${count} more`,
});

const clip = (text, max) => {
  const chars = Array.from(text);
  return chars.length <= max ? text : `${chars.slice(0, max - 1).join('').trimEnd()}${CUT}`;
};

/** How one waiting comment reads: who wrote, how, on what; and the first line of their words. */
export function entryLines(entry) {
  const what = entry.item.kind === 'finding' ? `${FRAME.tiers[entry.item.tier]}: ${entry.item.title}`
    : entry.item.title;
  const where = entry.pr.number === null ? entry.pr.branch : `PR #${entry.pr.number}`;
  const head = REMIND_HOOK_WORDS.entry(entry.comment.by, FRAME.verbs[entry.comment.act], where,
    shown(clip(what, TITLE_SHOWN_MAX)));
  return entry.comment.first === null ? [head] : [head, shown(entry.comment.first)];
}

/** The folder Claude Code gave the hook (its input's `cwd`, an absolute path), or null. */
export function inputFolder(input) {
  const parsed = strictJson(String(input ?? ''));
  const cwd = parsed.json && plainObject(parsed.value) ? parsed.value.cwd : null;
  return typeof cwd === 'string' && isAbsolute(cwd) && !cwd.includes('\0') && cwd.length <= 4096 ? cwd : null;
}

/** git's environment for the hook's one call: the person's, with no GIT_ variable of the session's (a GIT_DIR would
 *  read another repository than the folder). */
const hookGitEnv = (env) => Object.fromEntries(Object.entries(env).filter(([key]) => !key.startsWith('GIT_')));

/** `git -C dir remote -v`: its standard output, or null. Its own short limit: Claude Code waits for the hook. */
export function remoteLines(dir, { env = process.env, timeoutMs = HOOK_GIT_MS } = {}) {
  return new Promise((done) => {
    execFile('git', ['-C', dir, 'remote', '-v'], { env: hookGitEnv(env), timeout: timeoutMs, encoding: 'utf8',
      maxBuffer: 1024 * 1024, killSignal: 'SIGKILL' }, (error, stdout) => done(error ? null : stdout));
  });
}

/** The repositories the remotes of `dir` name, fetch and push URLs alike, each once: `[{ owner, name, key }]`. One git
 *  call; `git` is a call of `remoteLines`'s shape. */
export async function folderRepositories(dir, { env = process.env, git = remoteLines } = {}) {
  const found = new Map();
  for (const line of String((await git(dir, { env })) ?? '').split('\n')) {
    const tab = line.indexOf('\t');
    if (tab < 1) continue;
    const named = remoteRepository(line.slice(tab + 1).replace(/ \((?:fetch|push)\)$/, ''));
    if (named && !found.has(repoKeyOf(named.owner, named.name)))
      found.set(repoKeyOf(named.owner, named.name), { ...named, key: repoKeyOf(named.owner, named.name) });
  }
  return [...found.values()];
}

/** Whether a time is less than a minute old by this clock; a time ahead of it is no fresher. */
const fresh = (at, now) => {
  const age = now - Date.parse(at);
  return age >= 0 && age < REFRESH_AFTER_MS;
};

/**
 * The systemMessage of the comments that wait on the folder's repositories, `found` as `[{ owner, name, entry }]`, or
 * null when none waits. A comment Claude Code is already on is not shown or counted (it may be this very session).
 * Each links to its thread on `server`.
 */
export function reminder(found, server) {
  const lines = [];
  for (const { owner, name, entry } of found) {
    const count = waitingCount(entry);
    if (!count) continue;
    lines.push(`sonah: ${REMIND_HOOK_WORDS.waiting(count, shown(`${owner}/${name}`))}`);
    const listed = notLaunched(entry).slice(0, REMIND_SHOWN_MAX);
    for (const f of listed) {
      const [what, first] = entryLines(f);
      lines.push(`  ${what}`, ...(first ? [`    ${first}`] : []), `    ${server}/c/${f.comment.id}`);
    }
    if (count > listed.length) lines.push(`  ${REMIND_HOOK_WORDS.more(count - listed.length)}`);
  }
  return lines.length ? lines.join('\n') : null;
}

/** When the refresh last asked about each repository under the connection `{ server, login }`: `{ key: time }`. */
async function readAsked(where, { server, login }) {
  const read = await readOwnText(remindPath(where), MAX_REFRESH_BYTES);
  if (read.state !== 'ok') return {};
  const parsed = strictJson(read.text);
  const value = parsed.json && parsed.strict ? parsed.value : null;
  if (!plainObject(value) || value.v !== REFRESH_VERSION || value.server !== server || value.login !== login
    || !isLogin(value.login) || !plainObject(value.repos)) return {};
  return Object.fromEntries(Object.entries(value.repos).filter(([, at]) => isTime(at)));
}

/**
 * What the hook prints for `input` (Claude Code's hook input), and the folder to refresh: `{ folder, stdout,
 * refresh }`, `refresh` true when the cache of one of the folder's repositories is a minute old or more and no refresh
 * asked about it in the last minute. No network call. `git` is a call of `remoteLines`'s shape.
 */
export async function hookAnswer(input, { env = process.env, cwd = process.cwd(), git = remoteLines,
  now = Date.now() } = {}) {
  const folder = inputFolder(input) ?? cwd;
  const quiet = { folder, stdout: '', refresh: false };
  const where = { env };
  const saved = await readConnection(where);
  if (saved.state !== 'ok' || await isRefused(saved.connection, where)) return quiet;
  const cached = await readWaiting(where, saved.connection);
  const found = (await folderRepositories(folder, { env, git })).filter((r) => cached[r.key])
    .map((r) => ({ ...r, entry: cached[r.key] }));
  if (!found.length) return quiet;
  const message = reminder(found, saved.connection.server);
  const asked = await readAsked(where, saved.connection);
  const refresh = found.some((r) => !fresh(r.entry.at, now) && !(asked[r.key] && fresh(asked[r.key], now)));
  return { folder, stdout: message ? `${JSON.stringify({ systemMessage: message })}\n` : '', refresh };
}

/** Claude Code's hook input from `stdin`: `{ text, ended }`, `text` the first HOOK_INPUT_BYTES of it once it ends or after
 *  HOOK_INPUT_MS, and `ended` a promise of its end. The rest is read and dropped as it comes, so a writer gets no
 *  EPIPE. A terminal is not read. */
export async function readHookInput(stdin = process.stdin, { ms = HOOK_INPUT_MS, max = HOOK_INPUT_BYTES } = {}) {
  if (stdin.isTTY) return { text: '', ended: Promise.resolve() };
  let text = '';
  const ended = new Promise((done) => {
    stdin.setEncoding('utf8');
    stdin.on('data', (chunk) => { if (text.length < max) text += chunk.slice(0, max - text.length); })
      .once('end', done).once('close', done).once('error', done);
    stdin.resume?.();
  });
  await Promise.race([ended, new Promise((done) => setTimeout(done, ms).unref?.())]);
  return { text, ended };
}

/** The refresh, started detached in a process group of its own, with no input or output: whether it started. */
export function startRefresh(folder, { env = process.env, spawnFn = spawn, node = process.execPath,
  cli = SONAH_CLI } = {}) {
  try {
    const child = spawnFn(node, [cli, 'remind-refresh', folder], { env, detached: true, stdio: 'ignore' });
    child.on('error', () => {});
    child.unref();
    return true;
  } catch { return false; }
}

/** `sonah remind-hook`: reads the input, writes the one line when comments wait, and starts the refresh when one is
 *  due. Never throws for anything Claude Code did; bin/sonah.js ends it with exit 0 whatever happens. */
export async function runRemindHook(argv, { stdin = process.stdin, stdout = process.stdout, env = process.env,
  cwd = process.cwd(), git = remoteLines, start = startRefresh } = {}) {
  const input = await readHookInput(stdin);
  const answer = await hookAnswer(input.text, { env, cwd, git });
  if (answer.refresh) start(answer.folder, { env });
  if (answer.stdout) await new Promise((done) => stdout.write(answer.stdout, () => done()));
  await Promise.race([input.ended, new Promise((done) => setTimeout(done, HOOK_INPUT_MS).unref?.())]);
}

/**
 * `sonah remind-refresh <folder>`: one GET /api/fixes a repository of the folder whose cached list is a minute old or
 * more, for the connection on file, and not asked about in the last minute; each answer checked by shape and kept
 * (fix-waiting.js). The repositories it asks about are claimed under the lock of `team/locks/remind.json` first, so
 * two sessions that start at once ask once; D230 review 1: and only while the connection on file is the one read
 * first, since `sonah disconnect` removes the claims under that lock. A 403 of `FORGET_CODES` drops the repository's
 * list (fix-waiting.js `forgetWaiting`). Returns the number of calls it made.
 */
export async function runRemindRefresh(argv, { env = process.env, fetch = globalThis.fetch, git = remoteLines,
  now = () => Date.now() } = {}) {
  const [folder] = argv;
  if (argv.length !== 1 || typeof folder !== 'string' || !isAbsolute(folder) || folder.includes('\0')) return 0;
  const where = { env };
  const saved = await readConnection(where);
  if (saved.state !== 'ok' || await isRefused(saved.connection, where)) return 0;
  const { connection } = saved;
  const cached = await readWaiting(where, connection);
  const due = (await folderRepositories(folder, { env, git }))
    .filter((r) => cached[r.key] && !fresh(cached[r.key].at, now()));
  if (!due.length) return 0;
  const claimed = await withFileLock(where, remindPath(where), async () => {
    const onFile = await readConnection(where);
    if (onFile.state !== 'ok' || onFile.connection.server !== connection.server
      || onFile.connection.login !== connection.login || onFile.connection.token !== connection.token) return [];
    const asked = await readAsked(where, connection);
    const mine = due.filter((r) => !(asked[r.key] && fresh(asked[r.key], now())));
    if (!mine.length) return [];
    const at = new Date(now()).toISOString();
    const kept = Object.fromEntries(Object.entries(asked).filter(([, time]) => fresh(time, now())));
    for (const r of mine) kept[r.key] = at;
    await writeWhole(where, join(LOCKS_FOLDER, REMIND_FILE),
      `${JSON.stringify({ v: REFRESH_VERSION, server: connection.server, login: connection.login, repos: kept })}\n`);
    return mine;
  });
  if (!claimed.length) return 0;
  const { TeamApiError, teamApi } = await import('./team-api.js');
  const api = teamApi({ server: connection.server, token: connection.token, fetch });
  let calls = 0;
  for (const repo of claimed) {
    let answer;
    calls += 1;
    try { answer = await api.fixes({ owner: repo.owner, name: repo.name }); }
    catch (error) {
      if (!(error instanceof TeamApiError)) throw error;
      if (error.kind === 'refused' && error.status === 401) {
        await markRefused(connection, where).catch(() => {});
        return calls;
      }
      if (error.kind === 'refused' && error.status === 403 && FORGET_CODES.includes(error.code))
        await forgetWaiting(where, connection, repo.key);
      continue;
    }
    const list = checkList(answer, { owner: repo.owner, name: repo.name });
    if (list !== null) await saveWaiting(where, connection, list);
  }
  return calls;
}

/** The kind of each of this file's word tables, for the style linter (packages/render/test/style-lint.js). */
export const STYLE_KINDS = Object.freeze({ REMIND_HOOK_WORDS: 'notice', 'REMIND_HOOK_WORDS.entry': 'label',
  'REMIND_HOOK_WORDS.more': 'label' });
export const STYLE_FIXTURES = Object.freeze({
  'REMIND_HOOK_WORDS.waiting': [[1, 'acme/widgets'], [3, 'acme/widgets']],
  'REMIND_HOOK_WORDS.entry': [['ben', 'asked', 'PR #12', 'Must act: add throws on strings']],
  'REMIND_HOOK_WORDS.more': [[4]],
});
