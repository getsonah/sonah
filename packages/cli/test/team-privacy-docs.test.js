// Item 10, C8 (the plan's A4: privacy is a release gate), held to the code: docs/PRIVACY.md and README.md name each
// call that the team commands make to a Sonah Team server, each file they keep on this computer, and each number of
// those calls and files, as the code has them, so a change to one asks the other to change. The calls are read from
// team-api.js itself: each of its methods is made against a stand-in `fetch` that records what would be sent, and
// AbortSignal.timeout is watched for how long each call waits. The files come from the modules' own paths and names
// (team-home.js's header is their map), the numbers from their constants. A reverse check holds PRIVACY to naming no
// file under ~/.sonah/team/ that the code does not write. No server, no network, no recording, no model: the git
// repositories are temporary ones, for the upload's `sessions` and (C8 review 4) a folder and its partial clone.
// C8 review 1: the list of files is held to every file and folder name and every path that team-home.js and
// push-queue.js export, and the queue's file names to a ticket left and taken; the git calls that reach a remote are
// read from team-git.js, and no other source names one; the calls whose `401` marks nothing are named (d227-push-run
// and d229-fix hold the code to it); and the one call that deletes logs is found in the sources.
// C8 review 3: what the server does with each upload besides keeping it (the team's webhooks, whatever the seat, and a
// fix marked pushed), the hosting's request log, and a server with a GitHub App that comments on the pull request are
// named; `sonah disconnect` revokes a token given with `--token`; `sonah fix` leaves the shell's ANTHROPIC_API_KEY to
// Claude Code (d229-fix holds the code); what a killed review leaves in the queue stays, as the queue's own calls
// show; and the scan for git calls that reach a remote reads every quoted subcommand, wherever it sits.
// C8 review 4: the page's buttons send to the server of the connection read when the page was drawn, which the page
// keeps; in a partial clone the team commands' git reads fetch what the clone lacks from its remote (a real partial
// clone of a folder, over git's file transport, shows it); and the server's rate limits count every code tried and
// every token call, rows that https://pr.sonah.dev keeps for a day.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FIRST_LINE_MAX, SESSION_HARNESSES } from '../../visual/src/fix-prompt.mjs';
import { layout } from '../../visual/src/layout.mjs';
import { render, shareLink } from '../../visual/src/render.mjs';
import { UPLOAD_MAX_BYTES, uploadBody } from '../../visual/src/upload.mjs';
import { gitEnvironment } from '../src/code-snapshot.js';
import { VISUAL_LOCK_FILE } from '../src/visual-lock.js';
import { SCRIPT_FOLDER } from '../src/agent-session-hook.js';
import { TOKEN_NAME_MAX, runDisconnectCommand, tokenName } from '../src/connect-command.js';
import { FIRST_WORD, FIX_LAUNCHED_TIMEOUT_MS, claudeArgv } from '../src/fix-command.js';
import { checkList, saveWaiting } from '../src/fix-waiting.js';
import { launchPath } from '../src/fix-launches.js';
import { PUSH_HOOK_EVENT, PUSH_SCRIPT_NAME } from '../src/push-hook.js';
import * as PUSH_QUEUE from '../src/push-queue.js';
import { JOB_LOCK_FILE, PUSH_BRANCHES_MAX, RUNNER_LOCK_FILE, forgetTickets, leaveTicket, orphans, queueFolderOf,
  takeRunner, takeTicket } from '../src/push-queue.js';
import { PUSH_LOG_DAYS, PUSH_RUN_LIMITS, localGitEnv, pushedTip } from '../src/push-run.js';
import { REMIND_MARK, REMIND_WORDS, remindCommand, remindEntry, runRemindCommand,
  settingsFile } from '../src/remind.js';
import { FORGET_CODES, REFRESH_AFTER_MS, hookAnswer } from '../src/remind-hook.js';
import { SHARE_DEADLINE_MS, SHARE_ORDER_MS } from '../src/share-command.js';
import { TEAM_API_TIMEOUT_MS, TEAM_USER_AGENT, teamApi } from '../src/team-api.js';
import { defaultBranch, remoteTip, revParse } from '../src/team-git.js';
import * as TEAM_HOME from '../src/team-home.js';
import { CONNECTION_FILE, FIXES_FOLDER, HOOKS_FILE, LOCKS_FOLDER, REFUSED_FILE, REMIND_FILE, RUNS_FILE, RUNS_KEPT,
  WAITING_FILE, connectionPath, fixesPath, hooksPath, locksPath, logsPath, queuePath, remindPath, runsPath, teamHome,
  waitingPath, withFileLock, writeConnection } from '../src/team-home.js';
import { uploadSessions } from '../src/upload-sessions.js';
import { VISUAL_DEFAULT_SERVER, defaultVisualServer, visualCallEnvironment } from '../src/visual-command.js';
import { newToken, streams } from './team-helpers.js';

const text = async (path) => readFile(new URL(`../../../${path}`, import.meta.url), 'utf8');
const PRIVACY = await text('docs/PRIVACY.md');
const README = await text('README.md');
const INSTALL = await text('docs/INSTALL.md');
const TROUBLESHOOTING = await text('docs/TROUBLESHOOTING.md');
const CHANGELOG = await text('CHANGELOG.md');
const ENTRY = await readFile(new URL('../bin/sonah.js', import.meta.url), 'utf8');
/** Every source file of the packages (`src/`, at any depth): `[{ path, text }]`, the path from the repository's top. */
async function sources() {
  const top = new URL('../../', import.meta.url);
  const out = [];
  for (const pkg of (await readdir(top)).sort()) {
    const src = new URL(`${pkg}/src/`, top);
    let names;
    try { names = await readdir(src, { recursive: true }); } catch { continue; }
    for (const name of names.filter((n) => /\.m?js$/.test(n)).sort()) {
      out.push({ path: `packages/${pkg}/src/${name}`, text: await readFile(new URL(name, src), 'utf8') });
    }
  }
  return out;
}
const flat = (words) => words.replace(/\s+/g, ' ');
/** The part of a document under `heading` (its own line), up to the next heading of that level or above. */
function sectionOf(doc, heading) {
  const at = doc.indexOf(`\n${heading}\n`);
  assert.ok(at >= 0, `the heading ${heading}`);
  const level = heading.split(' ')[0];
  const next = doc.slice(at + heading.length + 2).search(new RegExp(`\\n#{1,${level.length}} `));
  return next < 0 ? doc.slice(at) : doc.slice(at, at + heading.length + 2 + next);
}
const CALLS = sectionOf(PRIVACY, '### Sonah Team: each call, and what the server keeps');
const PUSH = flat(sectionOf(PRIVACY, '### Sonah Team: the push hook'));
const SHARE = flat(sectionOf(PRIVACY, '### Sonah Team: `sonah share`'));
const FIXES = flat(sectionOf(PRIVACY, '### Sonah Team: `sonah fixes` and `sonah fix`'));
const REMIND = flat(sectionOf(PRIVACY, '### Sonah Team: the Claude Code start reminder'));
const STAYS = sectionOf(PRIVACY, '## What stays on your computer, and where');
/** How a doc says a wait: whole minutes from 2 minutes on, else seconds. */
const span = (ms) => (ms >= 120_000 && ms % 60_000 === 0 ? `${ms / 60_000} minutes` : `${ms / 1000} seconds`);

const SERVER = 'https://pr.sonah.dev';
const COMMENT = 'c_0123456789abcdef';
const SESSION = '1f0c6a52-8e4b-4c3d-9a71-2b5d0e9f4c86';
/** This computer's host name, as the docs write it. */
const HOST = '<your computer\'s host name>';

/** Every method of team-api.js made once against a stand-in `fetch`: `[{ method, name, doc, url, headers, body,
 *  redirect, timeoutMs }]`, `doc` the call as the docs name it (the query's values and the comment id as their
 *  placeholders). The token is one of the server's shape, made at random. */
async function recordedCalls() {
  const token = newToken();
  const answers = {
    'POST /api/device/exchange': () => Response.json({ token: newToken(), login: 'octo', server: SERVER },
      { status: 201 }),
    'GET /api/token': () => Response.json({ login: 'octo', team: { name: 'Acme' }, seat: 'paid' }),
    'DELETE /api/token': () => new Response(null, { status: 204 }),
    'GET /api/fixes': () => Response.json({ repo: { owner: 'acme', name: 'widgets' }, total: 0, fixes: [] }),
    [`GET /api/fixes/${COMMENT}`]: () => Response.json({}),
    [`POST /api/fixes/${COMMENT}/launched`]: () => Response.json({}),
    'POST /api/uploads': () => Response.json({ url: `${SERVER}/r/1` }, { status: 201 }),
  };
  const calls = [];
  const timeout = AbortSignal.timeout;
  let waits = [];
  AbortSignal.timeout = (ms) => { waits.push(ms); return timeout.call(AbortSignal, ms); };
  const fetch = async (url, init) => {
    const u = new URL(url);
    const answer = answers[`${init.method} ${u.pathname}`];
    assert.ok(answer, `${init.method} ${u.pathname} is a route the stand-in knows`);
    calls.push({ method: init.method, url: u, headers: init.headers, redirect: init.redirect,
      body: init.body === undefined ? undefined : JSON.parse(init.body) });
    return answer();
  };
  const made = [];
  const api = teamApi({ server: SERVER, token, fetch });
  const open = teamApi({ server: SERVER, fetch });
  const named = { owner: 'acme', name: 'widgets' };
  try {
    for (const [name, call] of [
      ['exchange', () => open.exchange('ABCD-EFGH', tokenName(HOST))],
      ['whoami', () => api.whoami()],
      ['revoke', () => api.revoke()],
      ['fixes', () => api.fixes(named)],
      ['upload', () => api.upload({ review: 'as uploadBody builds it' })],
      ['one', () => api.one(COMMENT)],
      ['launched', () => api.launched(COMMENT, { session: SESSION, forkOf: null })],
    ]) {
      waits = [];
      await call();
      assert.equal(waits.length, 1, `${name}: one call, with one time limit`);
      made.push({ name, ...calls.at(-1), timeoutMs: waits[0] });
    }
  } finally {
    AbortSignal.timeout = timeout;
  }
  assert.deepEqual(Object.keys(api).sort(), made.map((c) => c.name).sort(), 'every method of team-api.js is made here');
  for (const call of made) {
    const query = [...call.url.searchParams].map(([key, value]) =>
      `${key}=<${Object.keys(named).find((k) => named[k] === value)}>`).join('&');
    call.path = call.url.pathname.replace(COMMENT, '<comment id>');
    call.doc = `${call.method} ${call.path}${query ? `?${query}` : ''}`;
  }
  return { token, calls: made };
}
const { token: TOKEN, calls: CALLS_MADE } = await recordedCalls();

/** The rows of PRIVACY's table of calls: `{ call, by, sends, waits }`, the call without its backticks. */
const callRows = () => CALLS.split('\n').filter((line) => line.startsWith('| `')).map((line) => {
  const [call, by, sends, waits] = line.slice(2, -2).split(' | ');
  return { call: call.replace(/^`|`$/g, ''), by, sends, waits };
});

test('C8 premise: team-api.js makes seven calls, each to a route of its own, and only the device code\'s exchange '
  + 'goes with no token', () => {
  assert.deepEqual(CALLS_MADE.map((c) => c.doc), [
    'POST /api/device/exchange', 'GET /api/token', 'DELETE /api/token', 'GET /api/fixes?owner=<owner>&repo=<name>',
    'POST /api/uploads', 'GET /api/fixes/<comment id>', 'POST /api/fixes/<comment id>/launched']);
  for (const call of CALLS_MADE) {
    assert.equal('authorization' in call.headers, call.name !== 'exchange', `${call.doc}: the token, or none`);
    if (call.name !== 'exchange') assert.equal(call.headers.authorization, `Bearer ${TOKEN}`);
    assert.ok(!call.url.href.includes(TOKEN), `${call.doc}: the token is never in an address`);
    assert.equal(call.redirect, 'manual', `${call.doc}: no redirect is followed`);
    assert.equal(call.headers['user-agent'], TEAM_USER_AGENT);
  }
});

test('C8 PRIVACY: its table of calls lists each call team-api.js makes, and no other, each with the time it waits',
  () => {
  const rows = callRows();
  assert.deepEqual(rows.map((r) => r.call).sort(), CALLS_MADE.map((c) => c.doc).sort());
  for (const call of CALLS_MADE) {
    const row = rows.find((r) => r.call === call.doc);
    assert.equal(row.waits, span(call.timeoutMs), `${call.doc} waits ${call.timeoutMs} ms`);
  }
  // The time limits as team-api.js names them, and `sonah fix`'s own for the call it makes best effort.
  assert.deepEqual(CALLS_MADE.map((c) => c.timeoutMs), [TEAM_API_TIMEOUT_MS.exchange, TEAM_API_TIMEOUT_MS.token,
    TEAM_API_TIMEOUT_MS.token, TEAM_API_TIMEOUT_MS.fixes, TEAM_API_TIMEOUT_MS.upload, TEAM_API_TIMEOUT_MS.fixes,
    TEAM_API_TIMEOUT_MS.launched]);
  assert.equal(FIX_LAUNCHED_TIMEOUT_MS, TEAM_API_TIMEOUT_MS.launched);
  assert.ok(FIXES.includes(`That call is best effort, with ${span(FIX_LAUNCHED_TIMEOUT_MS)} to answer`));
  // What travels with the calls, as the table's lead and rows say it.
  const words = flat(CALLS);
  assert.ok(words.includes(`Each call names Sonah as \`${TEAM_USER_AGENT}\` in its \`User-Agent\` header.`));
  assert.ok(words.includes('The token goes only in the call\'s `Authorization` header, never in an address'));
  assert.ok(words.includes('Sonah follows no redirect'));
});

test('C8 PRIVACY: what each call sends besides the token is what the code puts in its body: the code and the token\'s '
  + 'name for the exchange, the two session ids for `launched`, nothing for the others but the upload', () => {
  const rows = callRows();
  const bodyKeys = Object.fromEntries(CALLS_MADE.map((c) => [c.name, c.body === undefined ? null
    : Object.keys(c.body).sort()]));
  assert.deepEqual(bodyKeys, { exchange: ['code', 'name'], whoami: null, revoke: null, fixes: null,
    upload: ['review'], one: null, launched: ['forkOf', 'session'] });
  const exchange = CALLS_MADE.find((c) => c.name === 'exchange');
  assert.equal(exchange.body.name, tokenName(HOST));
  const sends = (name) => rows.find((r) => r.call === CALLS_MADE.find((c) => c.name === name).doc).sends;
  assert.ok(sends('exchange').startsWith(`The code, and the name of the token it makes: \`${tokenName(HOST)}\` `
    + `(${TOKEN_NAME_MAX} characters at most).`), sends('exchange'));
  assert.ok(sends('launched').startsWith('The id of the Claude Code session it starts, and the id of the session that '
    + 'one forks'), sends('launched'));
  for (const name of ['whoami', 'revoke']) assert.ok(sends(name).startsWith('Nothing.'), name);
  assert.ok(sends('fixes').startsWith('The owner and name of a repository'));
  assert.ok(sends('one').startsWith('The comment\'s id.'));
  assert.ok(sends('upload').includes('`sessions`'));
});

test('C8: the token\'s name holds the host name, cut to what the server keeps, and PRIVACY and README name it so',
  () => {
  assert.equal(tokenName('h'.repeat(200)).length, TOKEN_NAME_MAX);
  const named = `\`${tokenName(HOST)}\``;
  assert.equal(named, `\`sonah on ${HOST}\``);
  assert.ok(flat(PRIVACY).includes(`${named} (${TOKEN_NAME_MAX} characters at most)`));
  assert.ok(flat(README).includes(named));
});

test('C8 README: "What is sent where" names each call the team commands make, and no longer says that nothing else '
  + 'about you or your work leaves your computer', () => {
  const words = flat(README);
  for (const call of CALLS_MADE) assert.ok(words.includes(`\`${call.method} ${call.path}`), call.doc);
  assert.ok(!words.includes('Nothing else about you or your work leaves your computer'));
  assert.ok(!words.includes('Sonah sends nothing to us on its own'));
  assert.ok(words.includes('Sonah has no telemetry and no analytics.'));
  // A8: where a code comes from, and the way in until the server's page offers one.
  assert.ok(words.includes('The code for `sonah connect` comes from the Sonah Team server\'s page for connecting a '
    + 'laptop. Until that page offers one'));
  assert.ok(words.includes('`/settings/tokens` page and run `sonah connect --token`'));
});

test('C8 PRIVACY: no sentence of before the team commands is left that they made false', () => {
  const words = flat(PRIVACY);
  for (const stale of ['Sonah sends nothing to us on its own', 'Three commands send anything to a model, and nothing '
    + 'else does', 'The only other requests are', 'comment ids: none yet'])
    assert.ok(!words.includes(stale), stale);
  assert.ok(words.includes('Three commands send anything to a model, and so does the review of a push once you turn '
    + 'the push hook on; nothing else does'));
  assert.ok(words.includes('Sonah has no telemetry and no analytics.'));
});

/** A path of the code as the docs write it: Sonah's folder as `~/.sonah`. */
const WHERE = { env: { HOME: '/you' } };
const shownPath = (path) => path.replace('/you/.sonah', '~/.sonah');
/** Every file and folder the team commands keep in Sonah's folder, by the code's own paths and names. */
const TEAM_FILES = {
  connection: shownPath(connectionPath(WHERE)),
  hooks: shownPath(hooksPath(WHERE)),
  refused: shownPath(join(teamHome(WHERE), REFUSED_FILE)),
  queue: `${shownPath(queuePath(WHERE))}/`,
  runs: shownPath(runsPath(WHERE)),
  logs: `${shownPath(logsPath(WHERE))}/`,
  waiting: shownPath(waitingPath(WHERE)),
  job: shownPath(join(locksPath(WHERE), JOB_LOCK_FILE)),
  remind: shownPath(remindPath(WHERE)),
  fixes: `${shownPath(fixesPath(WHERE))}/`,
  launch: shownPath(launchPath(WHERE, '<comment id>')),
};

test('C8 premise: the team commands keep their files under ~/.sonah/team/, as the docs write their paths', () => {
  assert.deepEqual(TEAM_FILES, {
    connection: '~/.sonah/team/connection.json', hooks: '~/.sonah/team/hooks.json',
    refused: '~/.sonah/team/refused.json', queue: '~/.sonah/team/queue/', runs: '~/.sonah/team/runs.json',
    logs: '~/.sonah/team/logs/', waiting: '~/.sonah/team/waiting.json', job: '~/.sonah/team/locks/job.lock',
    remind: '~/.sonah/team/locks/remind.json', fixes: '~/.sonah/team/fixes/',
    launch: '~/.sonah/team/fixes/<comment id>.json' });
});

test('C8 PRIVACY: "What stays on your computer" names every file the team commands keep, the push hook\'s files, the '
  + 'locks and Claude Code\'s settings entry; INSTALL\'s table names the same files', () => {
  for (const [what, path] of Object.entries(TEAM_FILES)) {
    if (what === 'logs') assert.ok(STAYS.includes(`\`${path}<repository name>-<commit>.log\``), path);
    else if (what === 'queue') assert.ok(STAYS.includes(`\`${path}<a hash of the repository's git folder>/\``), path);
    else if (what === 'fixes') assert.ok(STAYS.includes(path), path);
    else assert.ok(STAYS.includes(`\`${path}\``), path);
    assert.ok(INSTALL.includes(path), `INSTALL: ${path}`);
  }
  for (const name of [RUNNER_LOCK_FILE, VISUAL_LOCK_FILE, `${HOOKS_FILE}.lock`, `${RUNS_FILE}.lock`,
    `${WAITING_FILE}.lock`, `${LOCKS_FOLDER}/${REMIND_FILE}.lock`, `${FIXES_FOLDER}/<comment id>.json.lock`])
    assert.ok(STAYS.includes(`\`${name}\``), name);
  // The push hook: the hook git runs and Sonah's script beside it, in the repository's git folder.
  assert.ok(STAYS.includes(`\`.git/hooks/${PUSH_HOOK_EVENT}\``));
  assert.ok(STAYS.includes(`\`.git/${SCRIPT_FOLDER}/${PUSH_SCRIPT_NAME}\``));
  // The start reminder: one entry of settings.json in Claude Code's folder, which ends with Sonah's mark.
  assert.equal(settingsFile({ HOME: '/you' }), '/you/.claude/settings.json');
  assert.equal(settingsFile({ HOME: '/you', CLAUDE_CONFIG_DIR: '/cfg' }), '/cfg/settings.json');
  const words = flat(STAYS);
  assert.ok(words.includes('`settings.json` in Claude Code\'s folder (`CLAUDE_CONFIG_DIR`, else `~/.claude`)'));
  assert.ok(words.includes(`ends with \`# ${REMIND_MARK}\``));
  assert.ok(words.includes('every file under `~/.sonah/team/`, is readable by you only'));
});

test('C8 PRIVACY: every path it names under ~/.sonah/team/ is one the code writes', () => {
  const known = Object.values(TEAM_FILES);
  const named = [...PRIVACY.matchAll(/`(~\/\.sonah\/team\/[^`]*)`/g)].map((m) => m[1]);
  assert.ok(named.length >= known.length);
  for (const path of named) {
    const ok = path === '~/.sonah/team/' || known.some((k) => (k.endsWith('/') ? path.startsWith(k) : path === k));
    assert.ok(ok, `${path} is not a file the team commands write`);
  }
});

test('C8 review 1: that list holds every file and folder name, and every path, that team-home.js and push-queue.js '
  + 'export, so a file the code adds to the team folder is a file PRIVACY must name', () => {
  const segments = new Set(Object.values(TEAM_FILES).flatMap((path) => path.split('/')));
  const names = Object.entries({ ...TEAM_HOME, ...PUSH_QUEUE })
    .filter(([key]) => /_(FILE|FOLDER)$/.test(key) && key !== 'TEAM_FOLDER');
  assert.ok(names.some(([key]) => key === 'CONNECTION_FILE') && names.some(([key]) => key === 'QUEUE_FOLDER'));
  for (const [key, name] of names) {
    // The runner's lock is the one file of a repository's queue folder that is not a ticket.
    if (name === RUNNER_LOCK_FILE) {
      assert.ok(STAYS.includes(`\`${name}\` in a repository's folder of \`${TEAM_FILES.queue}\``), key);
      continue;
    }
    assert.ok(segments.has(name), `${key} (${name}) is a file or folder of the list`);
  }
  for (const [key, of] of Object.entries(TEAM_HOME).filter(([k, v]) => /Path$/.test(k) && typeof v === 'function')) {
    const path = shownPath(of(WHERE));
    assert.ok(Object.values(TEAM_FILES).some((p) => p === path || p.startsWith(`${path}/`)), `${key}: ${path}`);
  }
});

test('C8 review 1: the queue holds what PRIVACY names, in a folder named by a hash of the git folder: '
  + '`q-<a hash of the branch>.json` while a branch waits, `run-<its id>.json` once its review took it, each written '
  + 'as a `.tmp` beside it first', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'sonah-c8-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const where = { env: { HOME: root, SONAH_HOME: join(root, 'sonah') } };
  const sha256 = (words) => createHash('sha256').update(words).digest('hex');
  const common = join(root, 'widgets', '.git');
  const { ticket } = await leaveTicket(where, { common, dir: join(root, 'widgets'), branch: 'feature',
    sha: 'a'.repeat(40), remote: 'origin', server: SERVER, login: 'octo' });
  const folder = queueFolderOf(where, common);
  assert.equal(folder, join(queuePath(where), sha256(common).slice(0, 16)));
  assert.deepEqual(await readdir(folder), [`q-${sha256('feature').slice(0, 12)}.json`]);
  assert.equal((await takeTicket(where, ticket)).id, ticket.id);
  assert.deepEqual(await readdir(folder), [`run-${ticket.id}.json`]);
  const words = flat(STAYS);
  assert.ok(words.includes(`\`${TEAM_FILES.queue}<a hash of the repository's git folder>/\``));
  assert.ok(words.includes('One file for each pushed branch that waits (`q-<a hash of the branch>.json`), and while '
    + 'its review runs, the file that review took (`run-<its id>.json`)'));
  // A file of the team folder is written whole: its new text in a `.tmp` file beside it, then put in its place.
  for (const { path, text: code } of (await sources()).filter((f) => /\/(team-home|push-queue)\.js$/.test(f.path)))
    assert.match(code, /\.tmp`\);/, path);
  assert.ok(words.includes('and a `.tmp` file beside a file that Sonah writes'));
});

test('C8 review 1: PRIVACY names the calls whose `401` marks nothing, and no doc says that every call marks it', () => {
  const route = (name) => {
    const call = CALLS_MADE.find((c) => c.name === name);
    return `\`${call.method} ${call.path}\``;
  };
  // d227-push-run.test.js and d229-fix.test.js hold the code to it: a `401` to either of the two writes no mark.
  assert.ok(flat(CALLS).includes('These calls mark nothing on a `401`: those of `sonah connect` and '
    + `\`sonah disconnect\`, the ${route('fixes')} that the review of a push makes after its queue, and `
    + `\`sonah fix\`'s ${route('launched')}.`));
  assert.ok(PUSH.includes('only while the connection is the one that asked first (the same server and login). '
    + 'A `401` to this call marks nothing'));
  assert.ok(FIXES.includes('a failure says so and the fix goes on, and a `401` to it marks nothing'));
  assert.ok(REMIND.includes('A `401` marks the connection refused, as a `401` to `sonah fixes` does.'));
  assert.ok(flat(STAYS).includes('Only after a `401` to the token the connection holds, from a call whose `401` marks '
    + 'it'));
  assert.ok(flat(TROUBLESHOOTING).includes('A `401` here does not mark the connection refused'));
  for (const [doc, words] of [['PRIVACY', PRIVACY], ['README', README], ['INSTALL', INSTALL],
    ['TROUBLESHOOTING', TROUBLESHOOTING], ['CHANGELOG', CHANGELOG]]) {
    for (const stale of ['from any call but', 'as every other call does', 'a `401` to a call made with it'])
      assert.ok(!flat(words).includes(stale), `${doc}: ${stale}`);
  }
});

test('C8 review 1: the git calls that reach a remote are team-git.js\'s two `ls-remote` and no other, the docs name '
  + 'each where it is made, and none says that Sonah reaches no remote, or GitHub only with `--github`', async () => {
  const asked = [];
  const git = async (dir, args) => { asked.push(args); return null; };
  await remoteTip('/widgets', 'origin', 'refs/heads/feature', { git });
  await defaultBranch('/widgets', 'origin', { git });
  const [tip, base] = asked.map((args) => `git ${args.slice(0, args.indexOf('--')).join(' ')}`);
  assert.deepEqual([tip, base], ['git ls-remote', 'git ls-remote --symref']);
  // C8 review 3: every quoted word of the sources that names a git subcommand able to reach a remote, wherever it sits
  // in its arguments (after `-C <dir>` or `-c <name>=<value>`, after a spread constant, or in a constant of its own),
  // comment lines left out. `remote` reaches one with `show`, `update`, `prune` or `set-head`, so a `remote` reads as
  // reaching unless `-v`, `get-url` or the array's end follows it.
  const scan = (path, code) => [...code.matchAll(/(['"])(ls-remote|fetch|pull|push|clone|submodule|archive|remote)\1/g)]
    .filter((m) => !/^(\/\/|\/\*|\*)/.test(code.slice(code.lastIndexOf('\n', m.index) + 1, m.index).trimStart()))
    .filter((m) => m[2] !== 'remote' || !/^\s*(?:,\s*'(-v|get-url)'|\])/.test(code.slice(m.index + m[0].length)))
    .map((m) => `${path} ${m[2]}`);
  for (const [shape, code] of [['-C first', "git(dir, ['-C', dir, 'fetch', remote])"],
    ['-c first', "git(dir, ['-c', 'protocol.version=2', 'ls-remote', '--', remote])"],
    ['a spread first', "execFile('git', [...GIT_FLAGS, 'pull'])"], ['a constant', "const ASK = ['clone'];"],
    ['remote show', "git(dir, ['remote', 'show', remote])"], ['remote, a value after', 'git(dir, [\'remote\', sub])']])
    assert.equal(scan('x.js', code).length, 1, `the scan sees ${shape}`);
  for (const code of ["git(dir, ['remote'])", "git(dir, ['-C', dir, 'remote', '-v'])", "git(dir, ['remote', 'get-url', "
    + "'--push', '--', r])", "// git(dir, ['fetch'])", " * `git(dir, ['fetch'])`"])
    assert.deepEqual(scan('x.js', code), [], code);
  const reaching = (await sources()).flatMap(({ path, text: code }) => scan(path, code));
  assert.deepEqual(reaching, ['packages/cli/src/team-git.js ls-remote', 'packages/cli/src/team-git.js ls-remote']);
  // The review of a push makes both; `sonah share` the first, through the same read of which review is the newest.
  assert.ok(PUSH.includes(`else by asking the remote for its default branch (\`${base}\`)`));
  assert.ok(PUSH.includes(`which may ask your remote for that branch's commit (\`${tip}\`, the same call as the first `
    + 'step above'));
  assert.ok(SHARE.includes(`that read asks your remote for the branch's commit (\`${tip}\``));
  const readme = flat(README), install = flat(INSTALL), privacy = flat(PRIVACY);
  assert.ok(readme.includes(`Sonah may ask your remote for the branch's commit (\`${tip}\`, for at most `
    + `${span(SHARE_ORDER_MS)}, and a second more for each remote name after the first)`));
  assert.ok(readme.includes(`git asks your remote with \`${tip}\`, as \`git fetch\` would`));
  assert.ok(readme.includes(`The \`${tip}\` calls above go to the remote you push to, on GitHub or elsewhere.`));
  assert.ok(install.includes(`Sonah asks the remote (\`${base}\`)`));
  assert.ok(install.includes(`may also ask your remote about its branches with \`${tip}\``));
  assert.ok(privacy.includes('That review, and `sonah share`, may also ask the remote you push to, on GitHub or '
    + `elsewhere, about its branches with \`${tip}\``));
  for (const [doc, words] of [['README', readme], ['PRIVACY', privacy], ['INSTALL', install]]) {
    for (const stale of ['reaches no remote: its git calls read this computer', 'Sonah asks GitHub only about',
      'requests to GitHub, only when', 'The other requests go to GitHub,',
      'Nothing else about you or your work leaves your computer'])
      assert.ok(!words.includes(stale), `${doc}: ${stale}`);
  }
});

test('C8 review 1: only the review of a push deletes logs, once its queue is done, those that nothing wrote to in '
  + `${PUSH_LOG_DAYS} days; \`sonah share\` deletes none, and the docs say so`, async () => {
  const all = await sources();
  // pruneLogs's definition and its one call, both in push-run.js, the call in afterQueue (the end of a pass).
  assert.deepEqual(all.flatMap(({ path, text: code }) => [...code.matchAll(/\bpruneLogs\(/g)].map(() => path)),
    ['packages/cli/src/push-run.js', 'packages/cli/src/push-run.js']);
  const run = all.find((f) => f.path === 'packages/cli/src/push-run.js').text;
  const after = run.indexOf('async function afterQueue(');
  const call = run.indexOf('await pruneLogs(');
  assert.ok(after >= 0 && call > after && call < run.indexOf('\n}\n', after), 'the call is afterQueue\'s');
  const days = `that nothing wrote to in ${PUSH_LOG_DAYS} days, a log of \`sonah share\` too; \`sonah share\` deletes `
    + 'none';
  assert.ok(flat(STAYS).includes(`A review of a push, once its queue is done, deletes each log here ${days}`));
  assert.ok(flat(INSTALL).includes(`When the reviews of a push are done, Sonah deletes each log there ${days}.`));
  for (const [doc, words] of [['PRIVACY', PRIVACY], ['README', README], ['INSTALL', INSTALL],
    ['CHANGELOG', CHANGELOG]]) {
    for (const stale of ['Deleted after', 'kept for 30 days', 'kept 30 days', 'in fixed words, for 30 days'])
      assert.ok(!flat(words).includes(stale), `${doc}: ${stale}`);
  }
});

test('C8: a file of the team folder is written under a lock file beside it, named as PRIVACY names the locks',
  async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'sonah-c8-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const where = { env: { HOME: root, SONAH_HOME: join(root, 'sonah') } };
  const seen = await withFileLock(where, hooksPath(where), () => readdir(teamHome(where)));
  assert.deepEqual(seen, [`${HOOKS_FILE}.lock`]);
  assert.ok(STAYS.includes(`\`${HOOKS_FILE}.lock\``));
});

test('C8 PRIVACY and README: the numbers of the push hook, its review, `sonah share`, `sonah fixes` and the reminder '
  + 'are the code\'s', () => {
  const minute = (ms) => (ms === 60_000 ? 'a minute' : `${ms / 60_000} minutes`);
  assert.ok(PUSH.includes(`at most ${PUSH_BRANCHES_MAX} of one push`));
  assert.ok(flat(README).includes(`a review of each pushed branch (at most ${PUSH_BRANCHES_MAX})`));
  const [first, second] = PUSH_RUN_LIMITS.retryMs;
  const retries = `tries again after ${first / 1000} and ${second / 1000} seconds`;
  assert.ok(PUSH.includes(retries) && SHARE.includes(retries), retries);
  assert.ok(PUSH.includes(`Sonah looks for ${span(PUSH_RUN_LIMITS.remoteWaitMs)}`));
  assert.ok(PUSH.includes(`Its calls stop ${span(PUSH_RUN_LIMITS.giveUpMs)} after the push.`));
  assert.ok(SHARE.includes(`gives up ${span(SHARE_DEADLINE_MS)} after the command started`));
  assert.ok(SHARE.includes(`for at most ${span(SHARE_ORDER_MS)}, and a second more for each remote name after the `
    + 'first'));
  assert.ok(FIXES.includes(`the first line of their words (at most ${FIRST_LINE_MAX} characters)`));
  const stays = flat(STAYS);
  assert.ok(stays.includes(`The newest ${RUNS_KEPT}.`));
  assert.ok(stays.includes(`that nothing wrote to in ${PUSH_LOG_DAYS} days`));
  assert.equal(UPLOAD_MAX_BYTES, 25 * 1024 * 1024);
  assert.ok(flat(PRIVACY).includes('Over 25 MB the page holds no review'));
  // The reminder asks again for a list at most once a minute a repository.
  assert.ok(REMIND.includes(`is ${minute(REFRESH_AFTER_MS)} old or more`));
  assert.ok(REMIND.includes(`at most once a ${minute(REFRESH_AFTER_MS).replace(/^a /, '')}`));
  assert.ok(flat(README).includes(`When that list is ${minute(REFRESH_AFTER_MS)} old or more`));
});

test('C8 PRIVACY: the codes by which the server stops listing a repository for the reminder are the code\'s, and no '
  + 'other', () => {
  const from = REMIND.indexOf('with a `403` whose code says why (');
  assert.ok(from >= 0);
  const said = REMIND.slice(from, REMIND.indexOf(')', from));
  assert.deepEqual([...said.matchAll(/`([a-z_]+)`/g)].map((m) => m[1]).sort(), [...FORGET_CODES].sort());
});

test('C8 PRIVACY: an upload\'s `sessions` holds what PRIVACY lists and nothing of a session\'s content', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'sonah-c8-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const env = { PATH: process.env.PATH, HOME: root, GIT_CONFIG_NOSYSTEM: '1', XDG_CONFIG_HOME: join(root, '.config'),
    LANG: 'C', GIT_AUTHOR_NAME: 'synthetic', GIT_AUTHOR_EMAIL: 's@example.invalid', GIT_COMMITTER_NAME: 'synthetic',
    GIT_COMMITTER_EMAIL: 's@example.invalid' };
  const git = (...args) => {
    const r = spawnSync('git', args, { cwd: root, env, encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
    return r.stdout.trim();
  };
  git('init', '-q', '-b', 'main');
  git('config', 'commit.gpgsign', 'false');
  await writeFile(join(root, 'README.md'), 'Widgets.\n');
  git('add', '.');
  git('commit', '-q', '-m', 'Start');
  const base = git('rev-parse', 'HEAD');
  await writeFile(join(root, 'math.js'), 'export const add = (a, b) => a + b;\n');
  git('add', '.');
  git('commit', '-q', '-m', `Add add\n\nAgent-Session: ${SESSION}`);
  const named = git('rev-parse', 'HEAD');
  await writeFile(join(root, 'notes.txt'), 'by hand\n');
  git('add', '.');
  git('commit', '-q', '-m', 'Notes');
  const head = git('rev-parse', 'HEAD');
  const sessions = await uploadSessions({ dir: root, env, facts: { range: { base, head },
    files: [{ path: 'math.js' }, { path: 'notes.txt' }] }, answers: new Map([[SESSION, [COMMENT]]]) });
  assert.deepEqual(sessions, [{ id: SESSION, harness: SESSION_HARNESSES[0], commits: [named], files: ['math.js'],
    answers: [COMMENT] }]);
  // Each of its five fields, as the push hook's section and `sonah share`'s name them.
  const listed = `its id, \`${SESSION_HARNESSES[0]}\`, the ids of the commits that name it, the paths those commits `
    + 'changed that are among the review\'s files, and the ids of the review comments it was started to answer';
  assert.ok(PUSH.includes(listed) && SHARE.includes(listed));
  assert.ok(PUSH.includes('No recording is read, and nothing of a session\'s content is sent.'));
});

test('C8 PRIVACY: the reminder gives Claude Code its lines as a systemMessage only, which PRIVACY says, with what '
  + 'Claude Code keeps of what a hook prints', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'sonah-c8-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const env = { HOME: root, SONAH_HOME: join(root, 'sonah') };
  const where = { env };
  const connection = { server: SERVER, token: newToken(), login: 'octo' };
  await writeConnection(connection, where);
  const words = 'Can add still take strings?';
  const list = checkList({ repo: { owner: 'acme', name: 'widgets' }, total: 1, fixes: [
    { comment: { id: COMMENT, by: 'ben', act: 'question', at: '2026-11-08T11:00:00.000Z', first: words },
      item: { kind: 'finding', key: 'k_0123456789abcdef', tier: 'must-act', title: 'add throws on strings' },
      pr: { number: 12, branch: 'feature' }, head: 'a'.repeat(40), state: null }] },
  { owner: 'acme', name: 'widgets' });
  assert.equal(await saveWaiting(where, connection, list), true);
  const answer = await hookAnswer(JSON.stringify({ cwd: root }), { env, cwd: root,
    git: async () => 'origin\tgit@github.com:acme/widgets.git (fetch)\n', now: Date.now() });
  const out = JSON.parse(answer.stdout);
  assert.deepEqual(Object.keys(out), ['systemMessage']);
  assert.ok(out.systemMessage.includes(words), 'a teammate\'s first line is in what the hook prints');
  assert.ok(REMIND.includes('as a message for you (`systemMessage`), never as `additionalContext`'));
  assert.ok(REMIND.includes('Claude Code writes what a hook prints into its own recording of the session'));
  assert.ok(REMIND.includes('a teammate\'s first line and the link to its thread among them, are in Claude Code\'s '
    + 'recordings'));
  // The hook and its refresh are the hidden commands PRIVACY names, each dispatched by the entry.
  for (const hidden of ['remind-hook', 'remind-refresh', 'push-run', 'pre-push']) {
    assert.ok(ENTRY.includes(`if (cmd === '${hidden}')`), hidden);
  }
  assert.ok(REMIND.includes('`sonah remind-hook`') && REMIND.includes('`sonah remind-refresh`'));
  assert.ok(PUSH.includes('`sonah push-run`'));
});

test('C8 PRIVACY, README and INSTALL: the steps to delete everything and to uninstall name each undo before the end',
  () => {
  const del = flat(PRIVACY.slice(PRIVACY.indexOf('To delete everything Sonah stored'),
    PRIVACY.indexOf('## The Agent-Session line')));
  const readme = flat(README.slice(README.indexOf('To remove\nSonah'), README.indexOf('## Requirements')));
  const install = flat(sectionOf(INSTALL, '## Uninstall'));
  for (const undo of ['sonah hook remove --push', 'sonah remind off', 'sonah disconnect', 'sonah hook remove`',
    'sonah skill remove']) {
    assert.ok(del.indexOf(undo) >= 0 && del.indexOf(undo) < del.indexOf('Then remove `~/.sonah`'), `PRIVACY ${undo}`);
    assert.ok(readme.indexOf(undo) >= 0 && readme.indexOf(undo) < readme.indexOf('npm uninstall -g getsonah'),
      `README ${undo}`);
    assert.ok(install.indexOf(undo) >= 0 && install.indexOf(undo) < install.indexOf('npm uninstall -g getsonah'),
      `INSTALL ${undo}`);
  }
  // `sonah connect` can turn on either hook, so each says so.
  for (const [doc, words] of [['PRIVACY', del], ['README', readme], ['INSTALL', install]])
    assert.ok(words.includes('sonah connect'), doc);
});

/** The paragraph "What the server keeps", in one line. */
const KEEPS = flat(CALLS.slice(CALLS.indexOf('**What the server keeps.**')));

test('C8 review 2: "What the server keeps" names each call that sends the server more than the token, the token\'s id '
  + 'kept with an upload, the log line of an upload, and the line and the usage that `launched` leaves', () => {
  assert.ok(KEEPS.startsWith('**What the server keeps.**'));
  const sending = CALLS_MADE.filter((c) => c.body !== undefined);
  assert.deepEqual(sending.map((c) => c.name), ['exchange', 'upload', 'launched']);
  for (const call of sending) assert.ok(KEEPS.includes(`\`${call.method} ${call.path}\``), call.doc);
  // sonah-hosted keeps an upload with the token's id (uploads.mjs `putUpload`, tokenId) and logs it with the login;
  // `launched` adds a line with the session ids to the fix's log (fixes.mjs `addLine`) and counts a use (app.mjs).
  for (const said of [
    'It keeps each upload (`POST /api/uploads`) with your account and login, the id of the token that sent it and the '
      + 'time',
    'adds a line to that comment\'s fix: your account and login, the time, the id of the Claude Code session and the '
      + 'id of the session it forks',
    'What the writer and the webhooks are told, of a fix started or pushed, holds no session id.',
    'Its log notes your login when a computer connects with a code, when one revokes its own token, and at each '
      + 'upload, with the repository and the first 7 characters of the commit',
    'each computer that connects with a code, each upload made with a token and each `launched` call that it takes',
    'it changes and deletes none of their lines',
  ]) assert.ok(KEEPS.includes(said), said);
  assert.ok(!KEEPS.includes('each computer that connects with a code and each upload made with a token,'));
  assert.ok(flat(CHANGELOG).includes('the session ids of each fix that `sonah fix` starts or a push marks pushed; its '
    + 'log lines and its usage counts'));
});

test('C8 review 3: "What the server keeps" says that every upload reaches the team\'s webhooks whatever the seat, and '
  + 'the `pushed` line an upload\'s `sessions` leave; the push hook, `sonah share` and the launch records point to it',
() => {
  // sonah-hosted: uploads.mjs `intoTeam` calls fixes.mjs `attach` for every upload in accounts mode; `attach` emits
  // `version.added` (the review's link, repository and pull request, the range's two commits), and for each comment a
  // kept session answers with new commits appends a `pushed` line (`by`, `session`, `forkOf`, `head`, `commits`) and
  // emits `fix.pushed` (the comment in full, the item's title, the commits) to the writer; webhooks.mjs `deliver`
  // sends every event of the team to each endpoint that asks for its type, with no seat check.
  for (const said of [
    'Whatever your seat, every upload, from the review of a push or from `sonah share`, also reaches your team\'s '
      + 'webhooks',
    'an address outside Sonah Team that your team\'s admins chose',
    'with the review\'s link, the repository, the pull request and the range\'s two commits',
    'the server adds a `pushed` line to that comment\'s fix: your account and login, the time, the id of the session, '
      + 'the id of the session it forks, the head and those commits\' ids',
    'It may then tell the comment\'s writer, and it tells your team\'s webhooks, that the fix was pushed, with those '
      + 'commits\' ids, the item\'s title and the comment\'s words in full',
    'What the writer and the webhooks are told, of a fix started or pushed, holds no session id.',
    'The server keeps what it sent each webhook for up to 30 days.',
  ]) assert.ok(KEEPS.includes(said), said);
  assert.ok(PUSH.includes('whatever your seat, it tells your team\'s webhooks of each upload, and tells them, and may '
    + 'tell the comment\'s writer, of each fix that its `sessions` mark pushed'));
  assert.ok(SHARE.includes('and tells your team\'s webhooks of it and of each fix it marks pushed, exactly as for a '
    + 'push\'s'));
  assert.ok(FIXES.includes('which is what lets the server mark the fix pushed (it keeps a `pushed` line with the '
    + 'session ids, and tells the comment\'s writer and your team\'s webhooks'));
  assert.ok(flat(STAYS).includes('which is what lets the server mark the fix pushed (a line the server keeps with the '
    + 'session ids, and tells the comment\'s writer and your team\'s webhooks of)'));
  assert.ok(flat(README).includes('Whatever your seat, the server tells your team\'s webhooks of each upload, and of '
    + 'each fix it marks pushed.'));
  // The one sentence that said it of `launched` alone is gone.
  assert.ok(!KEEPS.includes('that the fix started; what it tells them holds no session id'));
});

test('C8 review 3: the docs name the hosting\'s request log, which keeps each call\'s path and query, where the '
  + 'repository and the comment id travel, with the caller\'s IP address', () => {
  // The calls that name a repository or a comment in their address, not their body: the request log has those names.
  const inAddress = CALLS_MADE.filter((c) => c.url.search !== '' || c.path.includes('<comment id>'))
    .map((c) => c.doc);
  assert.deepEqual(inAddress, ['GET /api/fixes?owner=<owner>&repo=<name>', 'GET /api/fixes/<comment id>',
    'POST /api/fixes/<comment id>/launched']);
  // sonah-hosted HOSTING.md: "Cloud Run's own request log keeps paths and queries"; deploy/cloudrun.sh sets no
  // exclusion and no retention, and log.mjs's own line names the route's pattern, never the path.
  assert.ok(KEEPS.includes('On https://pr.sonah.dev, which runs on Google Cloud Run, the platform\'s own request log '
    + 'also notes every call to it, Sonah\'s and your browser\'s: its path with the query (so a repository\'s owner '
    + 'and name, or a comment\'s id), the IP address it came from, its `User-Agent`, the time and the answer\'s '
    + 'status.'));
  assert.ok(KEEPS.includes('Only the project\'s owners can read it, and Google Cloud keeps it for 30 days unless they '
    + 'change that'));
  assert.ok(flat(PRIVACY).includes('on https://pr.sonah.dev, the hosting\'s own request log also notes the call, with '
    + 'your IP address'));
  assert.ok(flat(README).includes('On https://pr.sonah.dev, the hosting\'s request log also notes each call to it, its '
    + 'path and query with your IP address'));
  assert.ok(flat(CHANGELOG).includes('the hosting\'s request log of each call, with your IP address'));
});

test('C8 review 3: a Sonah Team server with a GitHub App comments on the pull request of an upload on its own, and no '
  + 'doc says that nothing is posted unless you ask', () => {
  // sonah-hosted: on the file store with the App, uploads.mjs `accept` attaches an upload to its sender's open PRs with
  // that head (and `onPr` to one opened later) and calls the commenter, whose comment.mjs `commentBody` writes the
  // head's 7 characters, the version's one line, the counts, the fixes and the link; accounts mode runs no App.
  const sharing = flat(sectionOf(PRIVACY, '## Sharing'));
  for (const said of [
    'A Sonah Team server that runs with a GitHub App (one you run yourself and name with `--server`; '
      + 'https://pr.sonah.dev runs none) posts on its own.',
    'who can read a review is whoever can read the repository on GitHub, not your team as your seat allows',
    'that server writes one comment on the pull request and keeps it up to date: the first 7 characters of the commit, '
      + 'the review\'s one line (the model\'s summary of the change)',
    'It asks you nothing first, and in a public repository that comment is public.',
    'Sonah itself posts nothing unless you ask.',
  ]) assert.ok(sharing.includes(said), said);
  assert.ok(KEEPS.includes('(on a server with a GitHub App, for whoever can read the repository on GitHub: '
    + '[Sharing](#sharing))'));
  assert.ok(PUSH.includes('On a server with a GitHub App, it also writes a comment on your pull request '
    + '([Sharing](#sharing)).'));
  assert.ok(flat(README).includes('a Sonah Team server you run with a GitHub App (not https://pr.sonah.dev) comments '
    + 'on your open pull request on its own when your review reaches it'));
  for (const [doc, words] of [['PRIVACY', PRIVACY], ['README', README]]) {
    for (const stale of ['Nothing is ever posted unless you ask', 'and posts nothing to GitHub unless you ask'])
      assert.ok(!flat(words).includes(stale), `${doc}: ${stale}`);
  }
});

test('C8 review 3: `sonah disconnect` revokes the token it keeps, wherever it came from, a token given with --token '
  + 'among them, as the docs say', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'sonah-c8-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const env = { HOME: root, SONAH_HOME: join(root, 'sonah') };
  // The connection file holds no word of where its token came from: one made on /settings/tokens is kept as any.
  const token = newToken();
  await writeConnection({ server: SERVER, token, login: 'octo' }, { env });
  const calls = [];
  const fetch = async (url, init) => {
    calls.push({ call: `${init.method} ${new URL(url).pathname}`, authorization: init.headers.authorization });
    return new Response(null, { status: 204 });
  };
  const out = streams();
  assert.equal(await runDisconnectCommand([], { env, fetch, stdout: out.stdout, stderr: out.stderr }), 0);
  assert.deepEqual(calls, [{ call: 'DELETE /api/token', authorization: `Bearer ${token}` }]);
  const connecting = flat(sectionOf(PRIVACY, '### Sonah Team: connecting this computer'));
  assert.ok(connecting.includes('When you answer no, or Sonah cannot keep it, Sonah leaves that token live. Once kept, '
    + 'it is this computer\'s token like one a code made: `sonah disconnect` revokes it, and so does a later '
    + 'connection that replaces this one, so it stops working wherever else you use it too.'));
  assert.ok(!flat(PRIVACY).includes('Sonah never revokes a token you gave it this way'));
  assert.ok(flat(INSTALL).includes('Once kept, `sonah disconnect` revokes it, as does a later connection that replaces '
    + 'it, so it stops working wherever else you use it: make one for each computer.'));
  assert.ok(flat(README).includes('`sonah disconnect` revokes it with `DELETE /api/token`, a token you gave with '
    + '`--token` too.'));
});

test('C8 review 3: the review of a push takes the shell\'s ANTHROPIC_API_KEY out and `sonah fix` does not, as the docs '
  + 'say (d229-fix holds `sonah fix` to it)', () => {
  const env = { HOME: '/you', PATH: '/bin', ANTHROPIC_API_KEY: 'synthetic-key-of-the-shell' };
  assert.equal('ANTHROPIC_API_KEY' in visualCallEnvironment(env), false, 'the push\'s drawing runs on the login');
  assert.ok(PUSH.includes('through your own `claude` login and never with an `ANTHROPIC_API_KEY` of your shell'));
  assert.ok(FIXES.includes('Claude Code then runs with your shell\'s environment as it is: unlike the review of a '
    + 'push, `sonah fix` takes no `ANTHROPIC_API_KEY` out of it, so a key your shell sets reaches Claude Code, which '
    + 'may then run that session on the key, billed to its account and sent to it'));
  assert.ok(!FIXES.includes('Claude Code then runs on your Claude Code login and counts toward your plan'));
  assert.ok(flat(README).includes('with your shell\'s environment: on your own `claude` login, or on an '
    + '`ANTHROPIC_API_KEY` your shell sets, which `sonah fix`, unlike the review of a push, does not take out.'));
  assert.ok(flat(INSTALL).includes('with your shell\'s environment: on your own Claude Code login, or on an '
    + '`ANTHROPIC_API_KEY` your shell sets, which `sonah fix` does not take out as the review of a push does.'));
  for (const [doc, words] of [['README', README], ['INSTALL', INSTALL]]) {
    for (const stale of ['with that branch, on your own `claude` login, and sends',
      'in that folder and on this terminal, on your own Claude Code login.'])
      assert.ok(!flat(words).includes(stale), `${doc}: ${stale}`);
  }
});

test('C8 review 3: what a killed review leaves in the queue (the file it took and the runner\'s lock) outlives '
  + '`sonah hook remove --push` and `sonah disconnect`, until the next runner of the repository takes it back, as '
  + 'PRIVACY says', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'sonah-c8-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const where = { env: { HOME: root, SONAH_HOME: join(root, 'sonah') } };
  const common = join(root, 'widgets', '.git');
  const { ticket } = await leaveTicket(where, { common, dir: join(root, 'widgets'), branch: 'feature',
    sha: 'a'.repeat(40), remote: 'origin', server: SERVER, login: 'octo' });
  await takeTicket(where, ticket);
  const runner = await takeRunner(where, common);
  assert.ok(runner, 'a runner of the repository');
  const folder = queueFolderOf(where, common);
  try {
    // `sonah hook remove --push` (push-hook.js) and `sonah disconnect` (connect-command.js) call forgetTickets alone.
    await forgetTickets(where, { common });
    await forgetTickets(where);
    assert.deepEqual((await readdir(folder)).sort(), [`run-${ticket.id}.json`, RUNNER_LOCK_FILE].sort());
  } finally {
    await runner.release();
  }
  // The next runner of the repository takes the file back (push-run.js calls `orphans` before it takes any ticket).
  assert.deepEqual((await orphans(where, common)).map((o) => o.id), [ticket.id]);
  assert.deepEqual(await readdir(folder).catch(() => []), []);
  const stays = flat(STAYS);
  assert.ok(stays.includes('`sonah hook remove --push` deletes the `q-` files of a repository, `sonah disconnect` '
    + 'those of all of them, and a connection to another server or login those of the old one; a review deletes its '
    + '`run-` file when it ends. A `run-` file that a review cut off by a kill or a power loss left, and `runner.lock` '
    + 'beside it, stay until the next review of that repository\'s pushes takes them back'));
  assert.ok(stays.includes('A lock that a review cut off by a kill or a power loss left stays until a later review '
    + 'takes it back'));
  assert.ok(!stays.includes('Only while a review of a push runs'));
  assert.ok(PUSH.includes('None of them deletes what a review cut off by a kill or a power loss left'));
  assert.ok(flat(INSTALL).includes('a `run-` file while its review runs, or, after a review was killed, until the next '
    + 'review takes it back'));
});

test('C8 review 2: `sonah fix` gives Claude Code its prompt as the first message of a session it records, and the docs '
  + 'say that removing Sonah\'s copy leaves Claude Code\'s', () => {
  const prompt = `${FIRST_WORD} the comment, as the frame opens it`;
  const fresh = claudeArgv({ prompt, session: SESSION });
  const forked = claudeArgv({ prompt, session: SESSION, forkOf: '0e1d2c3b-4a59-4687-9a1b-2c3d4e5f6a7b' });
  for (const argv of [fresh, forked]) {
    assert.equal(argv.at(-1), prompt, 'the prompt is the session\'s first message');
    assert.ok(!argv.some((a) => ['-p', '--print'].includes(a)), 'a session of its own, which Claude Code records');
  }
  assert.ok(forked.includes('--fork-session'));
  assert.ok(FIXES.includes('Removing `~/.sonah/team/fixes/` takes Sonah\'s copy of the prompts away, but not the '
    + 'prompts themselves: each prompt is the first message of the Claude Code session that `sonah fix` started, so '
    + 'Claude Code keeps it in its own recording of that session'));
  assert.ok(FIXES.includes('the recording of a fork also holds the session it forked'));
  assert.ok(flat(STAYS).includes('Removing the folder takes Sonah\'s copy of the prompts away; Claude Code\'s '
    + 'recording of each session that `sonah fix` started holds its prompt too, and stays.'));
  const del = flat(PRIVACY.slice(PRIVACY.indexOf('To delete everything Sonah stored'),
    PRIVACY.indexOf('## The Agent-Session line')));
  assert.ok(del.includes('each prompt that `sonah fix` gave Claude Code '
    + '([above](#sonah-team-sonah-fixes-and-sonah-fix)), stay in Claude Code\'s recordings'));
  for (const stale of ['when you no longer want the prompts on this computer', 'when you no longer want the prompts '
    + 'here', 'with it go the prompts']) assert.ok(!flat(PRIVACY).includes(stale), stale);
});

test('C8 review 2: `sonah share`\'s read of the remote waits 5 seconds for its first remote name and at least a second '
  + 'for each one after, as the docs say', async () => {
  let clock = 1_800_000_000_000;
  const waits = [];
  const git = async (dir, args, opts = {}) => {
    if (args[0] === 'ls-remote') {
      // The remote gives no answer: the call runs out its whole time, and the branch this clone remembers answers.
      waits.push(opts.timeoutMs);
      clock += opts.timeoutMs;
      return null;
    }
    if (args[0] === 'config') return `+refs/heads/*:refs/remotes/${args[2].split('.')[1]}/*\n`;
    if (args[0] === 'rev-parse') return `${'a'.repeat(40)}\n`;
    return null;
  };
  const now = Date.now;
  Date.now = () => clock;
  try {
    const runs = [{ remote: 'origin' }, { remote: 'gh' }, { remote: 'mirror' }];
    const head = await pushedTip('/widgets', runs, 'feature', { env: {}, git, until: clock + SHARE_ORDER_MS });
    assert.equal(head, 'a'.repeat(40));
  } finally {
    Date.now = now;
  }
  assert.deepEqual(waits, [SHARE_ORDER_MS, 1000, 1000], 'one call a name, the later ones a second each');
  const said = `for at most ${span(SHARE_ORDER_MS)}, and a second more for each remote name after the first`;
  assert.ok(SHARE.includes(said) && flat(README).includes(said), said);
  assert.ok(SHARE.includes('The first call waits at most 5 seconds, and each later one what is left of those 5 seconds '
    + 'but never less than a second'));
  assert.ok(flat(INSTALL).includes('gives up after five seconds, and a second more for each remote name after the '
    + 'first'));
  for (const [doc, words] of [['PRIVACY', PRIVACY], ['README', README], ['INSTALL', INSTALL]]) {
    for (const stale of ['seconds in all', 'gives up after five seconds:'])
      assert.ok(!flat(words).includes(stale), `${doc}: ${stale}`);
  }
});

test('C8 review 2: `sonah remind off` checks neither the platform nor a folder made for one run, and the one list of '
  + 'exit codes gives its `2` to `sonah remind on` only', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'sonah-c8-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const env = { HOME: root, CLAUDE_CONFIG_DIR: join(root, 'cc') };
  await mkdir(env.CLAUDE_CONFIG_DIR);
  const file = settingsFile(env);
  const npx = join(root, '.npm', '_npx', '0a1b2c', 'node_modules', 'getsonah', 'packages', 'cli', 'bin');
  await mkdir(npx, { recursive: true });
  await writeFile(join(npx, 'sonah.js'), '');
  const remind = async (args, rest) => {
    const out = streams();
    const code = await runRemindCommand(args, { env, stdout: out.stdout, stderr: out.stderr, ...rest });
    return { code, ...out.chunks };
  };
  for (const where of [{ platform: 'win32' }, { cliPath: join(npx, 'sonah.js') }]) {
    await writeFile(file, JSON.stringify({ hooks: { SessionStart: [remindEntry(remindCommand({ node: '/usr/bin/node',
      cli: '/opt/sonah/packages/cli/bin/sonah.js' }))] } }, null, 2));
    const off = await remind(['off'], where);
    assert.deepEqual([off.code, off.stdout, off.stderr], [0, `${REMIND_WORDS.removed(file)}\n`, ''],
      JSON.stringify(where));
    assert.deepEqual(JSON.parse(await readFile(file, 'utf8')), {});
    assert.equal((await remind(['on'], where)).code, 2, `on: ${JSON.stringify(where)}`);
  }
  const words = flat(TROUBLESHOOTING);
  assert.ok(words.includes('for `sonah remind on`, Windows or a Sonah run by npx, pnpm dlx, bunx or yarn dlx, which '
    + '`sonah remind off` does not check)'));
  assert.ok(!words.includes('for `sonah remind on` and `sonah remind off`, Windows'));
});

test('C8 review 2: each sentence that lists what leaves your computer besides the model names the `git ls-remote` '
  + 'calls to your remote, and INSTALL\'s also names the push hook, the start reminder and the page\'s two buttons',
() => {
  let lists = 0;
  for (const [doc, words] of [['PRIVACY', PRIVACY], ['README', README], ['INSTALL', INSTALL],
    ['TROUBLESHOOTING', TROUBLESHOOTING], ['CHANGELOG', CHANGELOG]]) {
    const all = flat(words);
    for (const m of all.matchAll(/on your computer except/g)) {
      const rest = all.slice(m.index);
      const sentence = rest.slice(0, rest.search(/\.(\s|$)/));
      assert.ok(sentence.includes('`git ls-remote`'), `${doc}: ${sentence}`);
      lists += 1;
    }
  }
  assert.ok(lists >= 1);
  const item = flat(INSTALL.slice(INSTALL.indexOf('- keep everything on your computer except'),
    INSTALL.indexOf('\nIt does not:')));
  for (const named of ['the push hook and the start reminder', '"Save online" or "Invite your team"',
    'the review of a push and `sonah share` may ask your remote about its branches'])
    assert.ok(item.includes(named), named);
});

test('C8 review 4: the page\'s buttons post to the server of the connection Sonah read when it drew the page, which '
  + 'the page keeps after a new connection, and no doc says that one computer sends to one server', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'sonah-c8-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const env = { HOME: root, SONAH_HOME: join(root, 'sonah') };
  // visual-command.js `defaultVisualServer`, which `drawVisualPage` calls once as it draws: the connection then.
  assert.equal(await defaultVisualServer(env), VISUAL_DEFAULT_SERVER);
  const first = 'https://sonah.first.example', second = 'https://sonah.second.example';
  await writeConnection({ server: first, token: newToken(), login: 'octo' }, { env });
  assert.equal(await defaultVisualServer(env), first);
  // The page as job.mjs writes it then (render.mjs, mode 'local'): the address goes into the file.
  const fixture = new URL('../../visual/test/fixtures/d211/', import.meta.url);
  const part = async (name) => JSON.parse(await readFile(new URL(name, fixture), 'utf8'));
  const x = { facts: await part('facts.json'), meaning: await part('meaning.json'),
    findings: await part('findings.json'), run: await part('run.json') };
  const placed = await layout(x.facts, x.meaning, x.findings);
  const upload = uploadBody({ owner: 'acme', name: 'widgets', branch: 'feature', page: render({ ...x, layout: placed }),
    ...x });
  const shareUrl = shareLink(await defaultVisualServer(env), { owner: 'acme', repo: 'widgets',
    head: x.facts.range.head });
  const page = render({ ...x, layout: placed, mode: 'local', upload, shareUrl });
  const action = /<script type="application\/json" id="sonah-upload" data-action="([^"]*)">/.exec(page)?.[1];
  assert.equal(action, `${first}/share`);
  // A new connection changes what the next drawing reads, not the file already drawn; the page's script posts to the
  // address the page holds, and reads it from nothing else.
  await writeConnection({ server: second, token: newToken(), login: 'octo' }, { env });
  assert.equal(await defaultVisualServer(env), second);
  const client = await readFile(new URL('../../visual/src/page.client.js', import.meta.url), 'utf8');
  assert.ok(client.includes('const action = upload && upload.getAttribute(\'data-action\');'));
  assert.ok(client.includes('form.action = action;'));
  assert.equal(/connection|fetch\(|XMLHttpRequest/.test(client.replace(/^\s*(\/\/|\*).*$/gm, '')), false,
    'the page asks nothing for its server');
  const privacy = flat(PRIVACY);
  for (const said of [
    'that server is the one this computer was connected to with `sonah connect` '
      + '([below](#sonah-team-connecting-this-computer)) when Sonah drew the page',
    'Sonah writes that address into the page when it draws it, and the buttons post to the address the page holds, '
      + 'whenever you press them: a page drawn before you connected, or under a connection you have since ended or '
      + 'replaced, still sends its review to the server it names, not to the one this computer is connected to now.',
    'Drawing the same range again writes the page anew with the server of the connection then, and `sonah share` sends '
      + 'a page to the server of this computer\'s connection whichever server the page names',
  ]) assert.ok(privacy.includes(said), said);
  assert.ok(flat(README).includes('the buttons name the server this computer was connected to with `sonah connect` '
    + 'when Sonah drew the page'));
  assert.ok(flat(README).includes('keeps it after you connect, disconnect or connect to another server, until that '
    + 'range\'s page is drawn again'));
  assert.ok(flat(INSTALL).includes('A page keeps the server it was drawn with: one drawn before you connected, or '
    + 'under a connection you have since ended or replaced, still sends to the server it names'));
  assert.ok(flat(CHANGELOG).includes('send the review to the Sonah Team server that this computer was connected to '
    + 'when Sonah drew the page'));
  assert.ok(flat(CHANGELOG).includes('A page keeps the server it was drawn with'));
  for (const [doc, words] of [['PRIVACY', PRIVACY], ['README', README], ['INSTALL', INSTALL],
    ['CHANGELOG', CHANGELOG]]) {
    for (const stale of ['one computer sends to one server', 'so a laptop sends to one server',
      'now send the review to the Sonah Team server that this computer is connected to',
      'the buttons name the server you connected this computer to'])
      assert.ok(!flat(words).includes(stale), `${doc}: ${stale}`);
  }
});

test('C8 review 4: in a partial clone, a git read of the team commands fetches a commit the clone does not hold from '
  + 'its remote, which the drawing\'s reads never do, and the docs say so where they said the reads stay here',
async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'sonah-c8-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const env = { PATH: process.env.PATH, HOME: root, GIT_CONFIG_NOSYSTEM: '1', XDG_CONFIG_HOME: join(root, '.config'),
    LANG: 'C', GIT_AUTHOR_NAME: 'synthetic', GIT_AUTHOR_EMAIL: 's@example.invalid', GIT_COMMITTER_NAME: 'synthetic',
    GIT_COMMITTER_EMAIL: 's@example.invalid' };
  const git = (cwd, ...args) => {
    const r = spawnSync('git', args, { cwd, env, encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
    return r.stdout.trim();
  };
  // The remote is a folder here, reached with git's file transport: no host, no network.
  const origin = join(root, 'origin'), clone = join(root, 'clone');
  await mkdir(origin);
  git(origin, 'init', '-q', '-b', 'main');
  git(origin, 'config', 'commit.gpgsign', 'false');
  git(origin, 'config', 'uploadpack.allowFilter', 'true');
  const commit = async (name) => {
    await writeFile(join(origin, name), `${name}\n`);
    git(origin, 'add', name);
    git(origin, 'commit', '-q', '-m', name);
    return git(origin, 'rev-parse', 'HEAD');
  };
  await commit('one');
  git(root, 'clone', '-q', '--filter=blob:none', `file://${origin}`, clone);
  const promisorPacks = async () => (await readdir(join(clone, '.git', 'objects', 'pack')))
    .filter((name) => name.endsWith('.promisor')).length;
  // The remote moves on: the clone does not hold its new commit.
  const later = await commit('two');
  const packs = await promisorPacks();
  // The team commands' reads (push-run.js `localGitEnv`, which `sonah share` and `sonah fix` use too) leave lazy
  // fetching on: team-git.js `revParse` of that commit gets it from the remote, and git keeps it in .git/objects.
  const team = localGitEnv(env);
  assert.equal('GIT_NO_LAZY_FETCH' in team, false);
  assert.equal(await revParse(clone, later, { env: team }), later);
  assert.ok(await promisorPacks() > packs, 'git fetched the commit and kept it');
  // The drawing's reads turn it off (code-snapshot.js `gitEnvironment`; `drawVisualPage` sets it for the job), and
  // git honours that from 2.44 on: the same read of a commit the clone lacks then finds nothing.
  assert.equal(gitEnvironment(env).GIT_NO_LAZY_FETCH, '1');
  const [major, minor] = git(root, 'version').replace(/^git version /, '').split('.').map(Number);
  if (major > 2 || (major === 2 && minor >= 44)) {
    const third = await commit('three');
    assert.equal(await revParse(clone, third, { env: localGitEnv({ ...env, GIT_NO_LAZY_FETCH: '1' }) }), null);
  }
  const privacy = flat(PRIVACY);
  for (const said of [
    'In a partial clone (one made with `git clone --filter`, as Scalar makes), git itself fetches from the remote an '
      + 'object that a command reads and the clone does not hold, unless it is told not to.',
    'Sonah tells it not to when it draws the graphs page (for `sonah visual`, plain `sonah`, `sonah review --format '
      + 'html` and the review of a push), so that drawing never fetches.',
    'The other git reads of the review of a push, `sonah share` and `sonah fix` do not',
    'git keeps what it fetched in your clone\'s `.git/objects`',
  ]) assert.ok(privacy.includes(said), said);
  assert.ok(PUSH.includes('In a partial clone, git may then fetch that branch\'s commit, and the commits before it, '
    + 'from your remote'));
  assert.ok(PUSH.includes('and, in a partial clone, git\'s own fetch of that commit when it reads it'));
  assert.ok(SHARE.includes('In a partial clone, git may also fetch from your remote the commit that call named, or the '
    + 'commit of a page that `--dir` names'));
  assert.ok(SHARE.includes('in a partial clone, git keeps in `.git/objects` the commits it fetched for those reads'));
  assert.ok(FIXES.includes('in a partial clone, git fetches from your remote the review\'s head and the commits of its '
    + 'range when your clone does not hold them'));
  assert.ok(FIXES.includes('in a partial clone, git keeps in `.git/objects` the commits it fetched for its reads'));
  assert.ok(flat(README).includes('In a partial clone (`git clone --filter`), the git reads of the review of a push, '
    + '`sonah share` and `sonah fix` may also make git fetch from your remote a commit your clone does not hold'));
  assert.ok(flat(INSTALL).includes('with, in a partial clone, the fetches git makes from that remote for their reads '
    + 'and those of `sonah fix`'));
  for (const [doc, words] of [['PRIVACY', PRIVACY], ['README', README], ['INSTALL', INSTALL]]) {
    for (const stale of ['Its git calls read this computer only', 'it reaches no remote at all',
      'and no other kind of call)', 'It changes nothing in your repository.', 'It never changes your repository,'])
      assert.ok(!flat(words).includes(stale), `${doc}: ${stale}`);
  }
});

test('C8 review 4: "What the server keeps" says that its limits count every code tried and every token call but the '
  + 'revoke, and that https://pr.sonah.dev keeps those rows for a day', () => {
  // sonah-hosted: device.mjs `exchangeCode` adds a `device_miss` hit for the address before it looks the code up, so
  // a code that matches is counted too; uploads.mjs `allow` adds an `upload` or `prs` hit for the token's id on each
  // token call but the revoke (app.mjs tokenApi, tokenSelf's GET, fixTokenApi); store-records.mjs `bucketOf` keeps
  // the SHA-256 of the address or the id; on the Supabase store `sonah_rate` inserts a row of the bucket and the time,
  // and the hourly `sonah_prune` deletes those older than a day. The minute and the hour are the windows counted.
  const withToken = CALLS_MADE.filter((c) => c.name !== 'exchange').map((c) => c.doc);
  assert.ok(withToken.includes('DELETE /api/token') && withToken.length === CALLS_MADE.length - 1);
  for (const said of [
    'For its limits, it counts each code tried from your address, whether it matches or not, over a minute, and each '
      + 'call made with a token but the revoke, over an hour.',
    'each try is a row that holds a SHA-256 hash of your address (an IPv4 address can be found from it by hashing '
      + 'every address) and the time, and each call a row that holds a SHA-256 hash of the token\'s id and the time',
    'its hourly clean-up deletes these rows once they are a day old, so for a day it holds when each of your tokens '
      + 'made each call',
  ]) assert.ok(KEEPS.includes(said), said);
  assert.ok(!KEEPS.includes('the codes from your address that do not match'));
  assert.ok(!KEEPS.includes('each token\'s calls but the revoke, for an hour'));
  assert.ok(flat(README).includes('for its limits, https://pr.sonah.dev also keeps for a day a row with the time of '
    + 'each code tried from your address and of each call made with the token'));
  assert.ok(flat(CHANGELOG).includes('the rows of its rate limits, one for each code tried from your address, whether '
    + 'it matches or not, and for each call made with a token, which https://pr.sonah.dev keeps for a day'));
});
