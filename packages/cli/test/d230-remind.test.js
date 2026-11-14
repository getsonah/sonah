// D230 (item 10, C7): `sonah remind on|off`, the Claude Code start reminder, and the hidden `remind-hook` and
// `remind-refresh` its entry runs. A port of the private laptop client's test/client/remind.test.js (3 tests), with
// getsonah's words and exit codes, and what the port adds: the private client's own entry left alone, the refusals on
// Windows and from a folder made for one run, `sonah status`'s line and its checks of the install the entry runs, a
// cache of another connection or a refused token that says nothing, one GET however many sessions start at once, a 401
// that marks the connection refused, and the hook's import closure held to the push hook's rule.
// Real git in a throwaway repository under a sealed HOME and SONAH_HOME with spaces in their paths, a stand-in Sonah
// Team server on 127.0.0.1 (team-helpers.js `teamServer`), and Claude Code's folder named by CLAUDE_CONFIG_DIR in the
// sealed home, or that home's own ~/.claude: no test reads or writes the Claude Code folder of this computer. No model
// and no network.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { lstat, mkdir, mkdtemp, readFile, realpath, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { REMIND_CHECKS, REMIND_PROBLEMS, REMIND_STATES } from '../../evidence/src/ledger.js';
import { runDisconnectCommand, runStatusCommand } from '../src/connect-command.js';
import { entryLines as fixesEntryLines } from '../src/fix-command.js';
import { PRIVATE_REMIND_MARK, REMIND_MARK, REMIND_WORDS, parseRemindCommand, remindCommand, remindEntry,
  runRemindCommand } from '../src/remind.js';
import { readWaiting } from '../src/fix-waiting.js';
import { stableNode } from '../src/push-hook.js';
import { FORGET_CODES, REFRESH_AFTER_MS, REMIND_SHOWN_MAX, entryLines, hookAnswer, inputFolder, remoteLines, reminder,
  runRemindRefresh } from '../src/remind-hook.js';
import { forgetOtherConnection, isRefused, markRefused, readConnection, remindPath, writeConnection,
  writeWhole } from '../src/team-home.js';
import { BIN, pushRepo, refreshesUnder, sealedHome, staticClosure, streams, teamServer } from './team-helpers.js';

const PERSON = { login: 'octo', team: 'Acme', seat: 'paid' };
const ID = 'c_00112233445566ff';
const SECOND = 'c_8899aabbccddeeff';
/** Someone else's settings, which every change of Sonah's must leave exactly as they are. */
const THEIRS = Object.freeze({ model: 'opus', permissions: { allow: ['Bash(npm test)'] },
  hooks: { SessionStart: [{ matcher: 'startup', hooks: [{ type: 'command', command: 'echo theirs' }] }],
    PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'check-bash' }] }] } });
const OLD = '2020-01-01T00:00:00.000Z';

const mode = async (path) => (await stat(path)).mode & 0o777;
const exists = (path) => lstat(path).then(() => true, () => false);
const median = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
const clone = (value) => JSON.parse(JSON.stringify(value));
/** Waits for `check` to hold, 20 s at most. */
async function waitFor(check, what) {
  for (const until = Date.now() + 20_000; Date.now() < until;) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  assert.fail(`waited for ${what}`);
}

/** `sonah remind ...` in-process: `{ code, stdout, stderr }`. */
async function remind(args, { env, ...rest }) {
  const out = streams();
  const code = await runRemindCommand(args, { env, stdout: out.stdout, stderr: out.stderr, ...rest });
  return { code, ...out.chunks };
}
/** `sonah status ...` in-process, with no server to ask (no connection) unless the env has one. */
async function status(args, env) {
  const out = streams();
  const code = await runStatusCommand(args, { env, stdout: out.stdout, stderr: out.stderr });
  return { code, ...out.chunks };
}

/** A sealed home with Claude Code's folder named by CLAUDE_CONFIG_DIR (a space in its path), made. */
async function claudeHome(t) {
  const home = await sealedHome(t, 'sonah-remind-');
  const cfg = join(home.root, 'claude cfg');
  await mkdir(cfg);
  return { ...home, cfg, file: join(cfg, 'settings.json'), env: { ...home.env, CLAUDE_CONFIG_DIR: cfg } };
}

/** A waiting list as GET /api/fixes answers it: two comments on PR #12 of the branch. */
const waitingList = (head) => [
  { comment: { id: ID, by: 'ben', act: 'question', at: '2026-11-08T11:00:00.000Z',
    first: 'Can add still take strings?' },
  item: { kind: 'finding', key: 'k_0123456789abcdef', tier: 'must-act',
    title: 'add now throws on anything but numbers' },
  pr: { number: 12, branch: 'feature' }, head, state: null },
  { comment: { id: SECOND, by: 'cy', act: 'override', at: '2026-11-08T11:05:00.000Z', first: null },
    item: { kind: 'function', key: 'math.js#clamp', tier: null, title: 'clamp' },
    pr: { number: 12, branch: 'feature' }, head, state: 'opened' },
];

// ---------- remind on and off ----------

test('remind on adds one SessionStart entry, again changes nothing, and off removes only its own', async (t) => {
  const home = await claudeHome(t);
  await writeFile(home.file, JSON.stringify(THEIRS, null, 2));
  const on = await remind(['on'], { env: home.env });
  assert.equal(on.code, 0, on.stderr);
  assert.equal(on.stdout.split('\n')[0], REMIND_WORDS.added(home.file));
  assert.ok(on.stdout.includes(REMIND_WORDS.about) && on.stdout.includes(REMIND_WORDS.stopIt));
  assert.ok(on.stdout.includes(REMIND_WORDS.notConnected), 'no connection yet: it says so');
  const json = JSON.parse(await readFile(home.file, 'utf8'));
  assert.deepEqual({ ...json, hooks: { ...json.hooks, SessionStart: json.hooks.SessionStart.slice(0, 1) } }, THEIRS,
    'everything else as it was');
  assert.equal(json.hooks.SessionStart.length, 2);
  const mine = json.hooks.SessionStart[1];
  assert.deepEqual(Object.keys(mine), ['matcher', 'hooks']);
  assert.equal(mine.matcher, 'startup|resume');
  assert.deepEqual(Object.keys(mine.hooks[0]).sort(), ['command', 'timeout', 'type']);
  assert.deepEqual([mine.hooks.length, mine.hooks[0].type, mine.hooks[0].timeout], [1, 'command', 10]);
  // The entry names this install and the SONAH_HOME this command saw, so the hook reads the same connection.
  const install = parseRemindCommand(mine.hooks[0].command);
  assert.deepEqual([install.cli, install.home], [await realpath(BIN), home.sonahHome]);
  assert.ok(mine.hooks[0].command.endsWith(` remind-hook # ${REMIND_MARK}`));
  assert.deepEqual(mine, remindEntry(remindCommand(install)));
  const bytes = await readFile(home.file, 'utf8');
  const again = await remind(['on'], { env: home.env });
  assert.deepEqual([again.code, again.stdout.split('\n')[0]], [0, REMIND_WORDS.present(home.file)]);
  assert.equal(await readFile(home.file, 'utf8'), bytes, 'one entry, not two');

  const off = await remind(['off'], { env: home.env });
  assert.deepEqual([off.code, off.stdout, off.stderr], [0, `${REMIND_WORDS.removed(home.file)}\n`, '']);
  assert.deepEqual(JSON.parse(await readFile(home.file, 'utf8')), THEIRS, 'back to theirs exactly');
  assert.deepEqual([(await remind(['off'], { env: home.env })).stdout], [`${REMIND_WORDS.none(home.file)}\n`]);

  // No settings yet: the file is made, not writable by others; off leaves an empty object behind.
  await rm(home.file);
  assert.equal((await remind(['on'], { env: home.env })).code, 0);
  assert.equal(JSON.parse(await readFile(home.file, 'utf8')).hooks.SessionStart.length, 1);
  assert.equal((await mode(home.file)) & 0o022, 0);
  assert.equal((await remind(['off'], { env: home.env })).code, 0);
  assert.deepEqual(JSON.parse(await readFile(home.file, 'utf8')), {});
  // D230 review 2: a SessionStart group that holds someone else's hook beside Sonah's keeps theirs, in place, whether
  // Sonah's is changed (another install) or removed.
  const shared = { model: 'opus', hooks: { SessionStart: [{ matcher: 'startup|resume', hooks: [
    { type: 'command', command: '~/bin/load-env' },
    { type: 'command', command: `'/old/node' '/old/sonah.js' remind-hook # ${REMIND_MARK}`, timeout: 10 },
    { type: 'command', command: 'echo after' }] }] } };
  await writeFile(home.file, JSON.stringify(shared, null, 2));
  assert.equal((await remind(['on'], { env: home.env })).stdout.split('\n')[0], REMIND_WORDS.updated(home.file));
  const updated = JSON.parse(await readFile(home.file, 'utf8')).hooks.SessionStart;
  assert.equal(updated.length, 1);
  assert.deepEqual([updated[0].hooks[0], updated[0].hooks[2]], [shared.hooks.SessionStart[0].hooks[0],
    shared.hooks.SessionStart[0].hooks[2]], 'theirs untouched');
  assert.equal(parseRemindCommand(updated[0].hooks[1].command).cli, await realpath(BIN));
  assert.equal((await remind(['off'], { env: home.env })).code, 0);
  assert.deepEqual(JSON.parse(await readFile(home.file, 'utf8')), { model: 'opus', hooks: { SessionStart: [
    { matcher: 'startup|resume', hooks: [shared.hooks.SessionStart[0].hooks[0], shared.hooks.SessionStart[0].hooks[2]] }] } });
  await writeFile(home.file, '{}');

  // A usage error writes nothing.
  for (const args of [[], ['maybe'], ['on', 'now'], ['off', '--repo', '.']]) {
    const r = await remind(args, { env: home.env });
    assert.deepEqual([r.code, r.stdout, r.stderr], [2, '', 'usage: sonah remind on|off\n'], args.join(' '));
  }
  assert.deepEqual(JSON.parse(await readFile(home.file, 'utf8')), {});
});

test('without CLAUDE_CONFIG_DIR it is ~/.claude; settings not plain JSON, or no folder, are left alone; a link is kept',
  async (t) => {
    const home = await sealedHome(t, 'sonah-remind-');
    const env = home.env; // no CLAUDE_CONFIG_DIR
    const folder = join(home.root, '.claude');
    const noFolder = await remind(['on'], { env });
    assert.deepEqual([noFolder.code, noFolder.stdout], [1, `${REMIND_WORDS.noFolder(folder)}\n`]);
    assert.equal(await exists(folder), false, 'no folder made');

    await mkdir(folder);
    const file = join(folder, 'settings.json');
    const jsonc = '{\n  // my settings\n  "model": "opus",\n}\n';
    await writeFile(file, jsonc);
    const r = await remind(['on'], { env });
    assert.equal(r.code, 1);
    assert.equal(await readFile(file, 'utf8'), jsonc, 'left as it is');
    const entry = JSON.parse(r.stdout.split('\n').slice(2).join('\n'));
    assert.deepEqual(r.stdout.split('\n').slice(0, 2), [REMIND_WORDS.notPlain(file), REMIND_WORDS.addEntry]);
    assert.equal(entry.matcher, 'startup|resume');
    assert.ok(entry.hooks[0].command.endsWith(`# ${REMIND_MARK}`), 'the entry to add');
    const off = await remind(['off'], { env });
    assert.deepEqual([off.code, off.stdout], [1, `${REMIND_WORDS.notPlain(file)}\n${REMIND_WORDS.removeEntry}\n`]);
    assert.equal(await readFile(file, 'utf8'), jsonc);
    // Not of its shape, or a key given twice (JSON.parse would keep the last one, and Sonah would write the other
    // away): each left exactly as it is.
    for (const odd of ['[]', '{"hooks": []}', '{"hooks": {"SessionStart": {}}}', '{"model": "a", "model": "b"}', '']) {
      await writeFile(file, odd);
      assert.equal((await remind(['on'], { env })).code, 1, odd);
      assert.equal((await remind(['off'], { env })).code, 1, odd);
      assert.equal(await readFile(file, 'utf8'), odd);
    }
    // A folder where the file goes: nothing read, nothing written.
    await rm(file);
    await mkdir(file);
    assert.equal((await remind(['on'], { env })).code, 1);
    await rm(file, { recursive: true });

    // settings.json as a link (a dotfiles folder): written through it, and it stays a link with its own mode.
    const real = join(home.root, 'dotfiles', 'claude-settings.json');
    await mkdir(join(home.root, 'dotfiles'));
    await writeFile(real, '{"model":"opus"}', { mode: 0o640 });
    await symlink(real, file);
    assert.equal((await remind(['on'], { env })).code, 0);
    assert.ok((await lstat(file)).isSymbolicLink());
    assert.equal(JSON.parse(await readFile(real, 'utf8')).hooks.SessionStart.length, 1);
    assert.equal(await mode(real), 0o640, 'its own mode');
    assert.equal((await remind(['off'], { env })).code, 0);
    assert.ok((await lstat(file)).isSymbolicLink());
    assert.deepEqual(JSON.parse(await readFile(real, 'utf8')), { model: 'opus' });
    // A link to a file that is not there: never replaced by a file of Sonah's.
    await rm(real);
    assert.equal((await remind(['on'], { env })).code, 1);
    assert.ok((await lstat(file)).isSymbolicLink());
    assert.equal(await exists(real), false);
  });

test("the private client's reminder is left alone, and remind on says to turn it off first", async (t) => {
  const home = await claudeHome(t);
  const theirs = clone(THEIRS);
  theirs.hooks.SessionStart.push(remindEntry(`'/usr/bin/node' '/x/sonah-hosted/client/remind.mjs' # ${PRIVATE_REMIND_MARK}`));
  const text = JSON.stringify(theirs, null, 2);
  await writeFile(home.file, text);
  const on = await remind(['on'], { env: home.env });
  assert.deepEqual([on.code, on.stdout], [1, `${REMIND_WORDS.privateClient(home.file)}\n`]);
  const off = await remind(['off'], { env: home.env });
  assert.deepEqual([off.code, off.stdout], [0, `${REMIND_WORDS.none(home.file)}\n`]);
  assert.equal(await readFile(home.file, 'utf8'), text, 'never touched');
  const said = await status([], home.env);
  assert.ok(said.stdout.endsWith(`\n\n${REMIND_WORDS.report.privateClient(home.file)}\n`), said.stdout);
  assert.equal(said.code, 0);
});

test('remind on refuses on Windows and from a folder made for one run, and writes nothing', async (t) => {
  const home = await claudeHome(t);
  const windows = await remind(['on'], { env: home.env, platform: 'win32' });
  assert.deepEqual([windows.code, windows.stdout, windows.stderr],
    [2, '', `${REMIND_WORDS.problems.remind_windows}\n`]);
  const npx = join(home.root, '.npm', '_npx', '0a1b2c', 'node_modules', 'getsonah', 'packages', 'cli', 'bin');
  await mkdir(npx, { recursive: true });
  await writeFile(join(npx, 'sonah.js'), '');
  const once = await remind(['on'], { env: home.env, cliPath: join(npx, 'sonah.js') });
  assert.deepEqual([once.code, once.stdout, once.stderr],
    [2, '', `${REMIND_WORDS.problems.remind_temporary_install(await realpath(join(npx, 'sonah.js')))}\n`]);
  assert.equal(await exists(home.file), false, 'nothing written');
  assert.deepEqual([...REMIND_PROBLEMS].sort(), Object.keys(REMIND_WORDS.problems).sort());
});

test('status says the reminder is on, and flags an entry whose node or Sonah is gone or is another install',
  async (t) => {
    const home = await claudeHome(t);
    // Off: status says nothing of it, and --json says off.
    const quiet = await status([], home.env);
    assert.equal(quiet.stdout.includes('reminder'), false);
    assert.deepEqual(JSON.parse((await status(['--json'], home.env)).stdout).remind,
      { state: 'off', file: home.file, checks: [] });
    const write = (install) => writeFile(home.file, JSON.stringify({ hooks: { SessionStart: [
      remindEntry(remindCommand({ home: home.sonahHome, ...install }))] } }, null, 2));
    const r = REMIND_WORDS.report;

    await write({ node: join(home.root, 'gone', 'node'), cli: join(home.root, 'gone', 'sonah.js') });
    const gone = await status([], home.env);
    assert.equal(gone.code, 1, 'a reminder that runs nothing needs you');
    assert.ok(gone.stdout.endsWith(`\n\n${[r.on(home.file), `  ${r.nodeGone(join(home.root, 'gone', 'node'))}`,
      `  ${r.sonahGone(join(home.root, 'gone', 'sonah.js'))}`, `  ${r.refresh}`].join('\n')}\n`), gone.stdout);
    assert.deepEqual(JSON.parse((await status(['--json'], home.env)).stdout).remind,
      { state: 'on', file: home.file, checks: ['node_gone', 'sonah_gone'] });

    const other = join(home.root, 'other', 'sonah.js');
    await mkdir(join(home.root, 'other'));
    await writeFile(other, '');
    await write({ node: process.execPath, cli: other });
    const elsewhere = await status([], home.env);
    assert.equal(elsewhere.code, 1);
    assert.ok(elsewhere.stdout.includes(`  ${r.otherInstall(other)}\n  ${r.refresh}\n`), elsewhere.stdout);

    // remind on points the entry at this install, in place.
    const on = await remind(['on'], { env: home.env });
    assert.deepEqual([on.code, on.stdout.split('\n')[0]], [0, REMIND_WORDS.updated(home.file)]);
    assert.equal(JSON.parse(await readFile(home.file, 'utf8')).hooks.SessionStart.length, 1);
    const fine = await status([], home.env);
    assert.deepEqual([fine.code, fine.stdout.endsWith(`\n\n${r.on(home.file)}\n`)], [0, true], fine.stdout);

    // D230 review 1: an entry that names another Sonah folder shows another connection's comments at every start.
    const cli = await realpath(BIN);
    const work = join(home.root, 'work home');
    await write({ node: process.execPath, cli, home: work });
    const named = await status([], home.env);
    assert.equal(named.code, 1);
    assert.ok(named.stdout.endsWith(`\n\n${[r.on(home.file), `  ${r.otherHome(work, home.sonahHome)}`,
      `  ${r.refresh}`].join('\n')}\n`), named.stdout);
    assert.deepEqual(JSON.parse((await status(['--json'], home.env)).stdout).remind.checks, ['other_home']);
    // D230 review 2: an entry that names none reads the SONAH_HOME that Claude Code runs with, which this command
    // cannot see, so it is not called another folder's.
    await write({ node: process.execPath, cli, home: null });
    const unnamed = await status([], home.env);
    assert.deepEqual([unnamed.code, unnamed.stdout.endsWith(`\n\n${r.on(home.file)}\n`)], [0, true], unnamed.stdout);
    assert.deepEqual(REMIND_CHECKS, ['node_gone', 'sonah_gone', 'other_install', 'other_home']);

    // Settings that are not plain JSON say nothing, unless they hold Sonah's mark.
    await writeFile(home.file, '{\n  // mine\n}\n');
    assert.equal((await status([], home.env)).stdout.includes('reminder'), false);
    await writeFile(home.file, `{ "hooks": { "SessionStart": [ { "hooks": [ { "command": "x # ${REMIND_MARK}" } ] } ] },\n}`);
    assert.ok((await status([], home.env)).stdout.endsWith(`\n\n${r.notChecked(home.file)}\n`));
    assert.deepEqual(REMIND_STATES, ['off', 'on', 'private_client', 'not_checked']);
  });

// ---------- the hook, as Claude Code runs it ----------

/** A clone of acme/widgets connected to a stand-in server whose list holds two comments, with the reminder on:
 *  `{ home, repo, server, env, where, command, cache(at, fixes), gets(), input(cwd), start(opts) }`. */
async function remindRepo(t) {
  const home = await sealedHome(t, 'sonah-remind-');
  const repo = await pushRepo(home);
  const head = repo.git(['rev-parse', 'HEAD']);
  const list = waitingList(head);
  const server = await teamServer(t, { fixes: { 'acme/widgets': list } });
  const cfg = join(home.root, 'claude cfg');
  await mkdir(cfg);
  const env = { ...repo.env, CLAUDE_CONFIG_DIR: cfg };
  const where = { env };
  await writeConnection({ server: server.url, token: server.addToken(PERSON), login: PERSON.login }, where);
  assert.equal((await remind(['on'], { env })).code, 0);
  const command = JSON.parse(await readFile(join(cfg, 'settings.json'), 'utf8')).hooks.SessionStart[0].hooks[0].command;
  const cache = (at, fixes = list, { server: s = server.url, login = PERSON.login } = {}) => writeWhole(where,
    'waiting.json', `${JSON.stringify({ v: 1, server: s, login, repos: { 'acme/widgets': { at, total: fixes.length,
      fixes } } })}\n`);
  const input = (cwd = repo.work) => JSON.stringify({ session_id: '3c3c3c3c-0000-4000-8000-000000000000',
    transcript_path: '/x.jsonl', cwd, hook_event_name: 'SessionStart', source: 'startup' });
  // As Claude Code runs a command hook: a shell, the hook's JSON on stdin, in the project's folder.
  const start = ({ cwd = repo.work, stdin = input() } = {}) => {
    const t0 = performance.now();
    const r = spawnSync('/bin/sh', ['-c', command], { cwd, env: { ...env, CLAUDECODE: '1' }, input: stdin,
      encoding: 'utf8', timeout: 30_000 });
    return { code: r.status, stdout: r.stdout, stderr: r.stderr, ms: performance.now() - t0 };
  };
  const gets = () => server.calls.filter((c) => c.method === 'GET' && c.path === '/api/fixes').length;
  /** The refreshes the hook started have ended. */
  const settled = () => waitFor(() => refreshesUnder(home.root).length === 0, 'the refresh to end');
  return { home, repo, server, list, env, where, command, cache, gets, input, start, settled,
    message: [`sonah: 2 comments wait for you on acme/widgets (sonah fixes).`,
      '  @ben asked on PR #12 · Must act: add now throws on anything but numbers', '    Can add still take strings?',
      `    ${server.url}/c/${ID}`, '  @cy overrode it on PR #12 · clamp', `    ${server.url}/c/${SECOND}`].join('\n') };
}

test("the entry's command shows the cached comments as a systemMessage only, and starts one detached refresh",
  async (t) => {
    const s = await remindRepo(t);
    // A list refreshed just now: the message, and no refresh.
    await s.cache(new Date().toISOString());
    const times = [];
    let r;
    for (let i = 0; i < 5; i++) {
      r = s.start();
      times.push(r.ms);
      assert.deepEqual([r.code, r.stderr], [0, '']);
    }
    t.diagnostic(`the start reminder answers in ${Math.round(median(times))} ms (median of 5)`);
    assert.ok(median(times) < 3000, `the reminder took ${median(times)} ms`);
    const out = JSON.parse(r.stdout);
    assert.deepEqual(Object.keys(out), ['systemMessage'], 'never additionalContext');
    assert.equal(out.systemMessage, s.message);
    assert.equal(r.stdout.split('\n').length, 2, 'one JSON line');
    await s.settled();
    assert.equal(s.gets(), 0, 'fresh: no GET');

    // A comment Claude Code is on (sonah fix marked it launched; this may be its own session): not shown, not counted.
    await s.cache(new Date().toISOString(), s.list.map((f) => (f.comment.id === ID ? { ...f, state: 'launched' } : f)));
    assert.equal(JSON.parse(s.start().stdout).systemMessage, ['sonah: 1 comment waits for you on acme/widgets '
      + '(sonah fixes).', '  @cy overrode it on PR #12 · clamp', `    ${s.server.url}/c/${SECOND}`].join('\n'));

    // An older list: the message from it, then one detached refresh, the list kept with its new time.
    await s.cache(OLD);
    assert.equal(JSON.parse(s.start().stdout).systemMessage, s.message);
    const cacheFile = join(s.home.sonahHome, 'team', 'waiting.json');
    await waitFor(async () => JSON.parse(await readFile(cacheFile, 'utf8')).repos['acme/widgets'].at > OLD,
      'the refresh');
    await s.settled();
    assert.equal(s.gets(), 1, 'one GET');
    assert.deepEqual(s.server.calls.at(-1).query, { owner: 'acme', repo: 'widgets' });
    assert.equal(await mode(cacheFile), 0o600);
    const asked = join(s.home.sonahHome, 'team', 'locks', 'remind.json');
    assert.equal(await mode(asked), 0o600);
    assert.deepEqual(Object.keys(JSON.parse(await readFile(asked, 'utf8')).repos), ['acme/widgets']);
    s.start();
    await s.settled();
    assert.equal(s.gets(), 1, 'refreshed: none again within a minute');

    // An old list, but its repository was asked about within the minute (another session started the refresh): the
    // message, and no second GET.
    await s.cache(OLD);
    assert.equal(JSON.parse(s.start().stdout).systemMessage, s.message);
    await s.settled();
    assert.equal(s.gets(), 1, 'asked within the minute: no GET');

    // A folder of no repository: nothing. Input that is not JSON: the folder the hook runs in.
    const elsewhere = s.start({ cwd: s.home.root, stdin: s.input(s.home.root) });
    assert.deepEqual([elsewhere.code, elsewhere.stdout, elsewhere.stderr], [0, '', '']);
    const notJson = s.start({ stdin: 'not json' });
    assert.deepEqual([notJson.code, JSON.parse(notJson.stdout).systemMessage], [0, s.message]);
    await s.settled();
    assert.equal(s.gets(), 1);
  });

test('the reminder says nothing for a cache of another connection, a refused token or no connection', async (t) => {
  const s = await remindRepo(t);
  // The cache another server or login left: not this connection's, so not shown and not refreshed.
  for (const other of [{ server: 'https://other.example' }, { login: 'someone' }]) {
    await s.cache(OLD, s.list, other);
    assert.deepEqual(Object.values(s.start()).slice(0, 3), [0, '', '']);
  }
  await s.cache(OLD);
  assert.equal(JSON.parse(s.start().stdout).systemMessage, s.message);
  await s.settled();
  const before = s.gets();
  // A token the server refused: quiet, and no refresh, whatever the cache holds.
  const saved = await readConnection(s.where);
  await markRefused(saved.connection, s.where);
  await s.cache(OLD);
  assert.deepEqual(Object.values(s.start()).slice(0, 3), [0, '', '']);
  // No connection at all.
  await rm(join(s.home.sonahHome, 'team', 'connection.json'));
  assert.deepEqual(Object.values(s.start()).slice(0, 3), [0, '', '']);
  await s.settled();
  assert.equal(s.gets(), before);
});

test('two refreshes at once ask once, and a 401 marks the connection refused', async (t) => {
  const s = await remindRepo(t);
  await s.cache(OLD);
  // D230 review 2: no folder, a relative one, two, or one with a NUL ask nothing, with a live connection and an old
  // list that a good folder would ask for.
  for (const argv of [[], ['work'], [s.repo.work, s.repo.work], [`${s.repo.work}\0x`]])
    assert.equal(await runRemindRefresh(argv, { env: s.env }), 0, JSON.stringify(argv));
  assert.equal(s.gets(), 0);
  // D230 review 2: git answers all three only once all three asked, so their claims run at the same time; only the
  // lock lets one of them through.
  let arrived = 0, release;
  const together = new Promise((done) => { release = done; });
  const atOnce = async (dir, options) => {
    const out = await remoteLines(dir, options);
    if (++arrived === 3) release();
    await together;
    return out;
  };
  const calls = await Promise.all([1, 2, 3].map(() => runRemindRefresh([s.repo.work], { env: s.env, git: atOnce })));
  assert.deepEqual(calls.sort(), [0, 0, 1], 'one of three asked');
  assert.equal(s.gets(), 1);
  assert.equal(await runRemindRefresh([s.repo.work], { env: s.env }), 0, 'fresh now');
  // An old list again, a minute later by the refresh's clock: the server no longer takes the token.
  await s.cache(OLD);
  s.server.once('GET', '/api/fixes', { status: 401, json: { error: 'bad_token' } });
  const later = () => Date.now() + REFRESH_AFTER_MS + 1000;
  assert.equal(await runRemindRefresh([s.repo.work], { env: s.env, now: later }), 1);
  const saved = await readConnection(s.where);
  assert.equal(await isRefused(saved.connection, s.where), true);
  assert.equal(await runRemindRefresh([s.repo.work], { env: s.env, now: () => later() + REFRESH_AFTER_MS }), 0,
    'refused: no call');
  assert.equal(s.gets(), 2);
});

test('D230 review 1: a refresh claims nothing once the connection changed, and sonah disconnect removes the claims',
  async (t) => {
    const s = await remindRepo(t);
    await s.cache(OLD);
    // The connection changes between the refresh's first read of it and its claim (another login connects).
    const swapped = async (dir, options) => {
      await writeConnection({ server: s.server.url, token: s.server.addToken({ ...PERSON, login: 'someone' }),
        login: 'someone' }, s.where);
      return remoteLines(dir, options);
    };
    assert.equal(await runRemindRefresh([s.repo.work], { env: s.env, git: swapped }), 0);
    assert.deepEqual([s.gets(), await exists(remindPath(s.where))], [0, false], 'no call, no claim');
    // Back as octo: a claim is made, and disconnect takes it with the connection.
    await writeConnection({ server: s.server.url, token: s.server.addToken(PERSON), login: PERSON.login }, s.where);
    await s.cache(OLD);
    assert.equal(await runRemindRefresh([s.repo.work], { env: s.env }), 1);
    assert.equal(await exists(remindPath(s.where)), true);
    // D230 review 2: a connection as another login takes them too (forgetOtherConnection, which sonah connect runs).
    await forgetOtherConnection(s.where, { server: s.server.url, login: 'someone' });
    assert.equal(await exists(remindPath(s.where)), false, 'a new connection takes the claims');
    await s.cache(OLD);
    assert.equal(await runRemindRefresh([s.repo.work], { env: s.env }), 1);
    assert.equal(await exists(remindPath(s.where)), true);
    const out = streams();
    assert.equal(await runDisconnectCommand([], { env: s.env, stdout: out.stdout, stderr: out.stderr }), 0);
    assert.equal(await exists(remindPath(s.where)), false, 'the claims go with the connection');
  });

test('D230 review 1: a 403 by which the server says it lists no comments there drops that repository\'s list only',
  async (t) => {
    const s = await remindRepo(t);
    const who = { server: s.server.url, login: PERSON.login };
    // Two repositories cached; the folder's remote names one of them.
    const both = (at) => writeWhole(s.where, 'waiting.json', `${JSON.stringify({ v: 1, ...who, repos: {
      'acme/widgets': { at, total: s.list.length, fixes: s.list }, 'acme/other': { at, total: 0, fixes: [] } } })}\n`);
    let clock = Date.now();
    const refresh = (answer) => {
      clock += 2 * REFRESH_AFTER_MS;
      s.server.once('GET', '/api/fixes', answer);
      return runRemindRefresh([s.repo.work], { env: s.env, now: () => clock });
    };
    // D230 review 2: a 403 or a 404 that the server does not send for that — a proxy's or a load balancer's page,
    // with no code, or a code of another meaning — changes nothing.
    for (const answer of [{ status: 403 }, { status: 404 }, { status: 404, json: { error: 'not_found' } },
      { status: 403, json: { error: 'rate_limited' } }]) {
      await both(OLD);
      assert.equal(await refresh(answer), 1, JSON.stringify(answer));
      assert.deepEqual(Object.keys(await readWaiting(s.where, who)).sort(), ['acme/other', 'acme/widgets'],
        JSON.stringify(answer));
    }
    for (const code of FORGET_CODES) {
      await both(OLD);
      assert.equal(JSON.parse(s.start().stdout).systemMessage, s.message);
      await s.settled();
      const before = s.gets();
      assert.equal(await refresh({ status: 403, json: { error: code } }), 1, code);
      assert.equal(s.gets(), before + 1);
      assert.deepEqual(Object.keys(await readWaiting(s.where, who)), ['acme/other'], `${code}: that repository only`);
      assert.deepEqual(Object.values(s.start()).slice(0, 3), [0, '', ''], 'nothing shown');
      assert.equal(await runRemindRefresh([s.repo.work], { env: s.env, now: () => clock + 2 * REFRESH_AFTER_MS }), 0,
        'nothing asked');
    }
    assert.deepEqual(FORGET_CODES, ['not_member', 'not_installed', 'forbidden']);
    const saved = await readConnection(s.where);
    assert.equal(await isRefused(saved.connection, s.where), false, 'only a 401 marks the token refused');
  });

test('D230 review 2: a start of Claude Code waits for no call, and starts a refresh only when one is due', async (t) => {
  const s = await remindRepo(t);
  // The server holds the refresh's call and never answers it: the start still answers at once, with the message.
  await s.cache(OLD);
  s.server.once('GET', '/api/fixes', () => new Promise(() => {}));
  const r = s.start();
  assert.deepEqual([r.code, r.stderr, JSON.parse(r.stdout).systemMessage], [0, '', s.message]);
  assert.ok(r.ms < 3000, `the start took ${r.ms} ms`);
  await waitFor(() => s.gets() === 1, 'the refresh to ask');
  assert.equal(refreshesUnder(s.home.root).length, 1, 'the refresh still waits, the start does not');
  for (const pid of refreshesUnder(s.home.root)) process.kill(pid, 'SIGKILL');
  await s.settled();
  // Whether a refresh is due, as the hook decides it (no network): a fresh list, or one asked about within the minute,
  // starts none.
  const git = async () => 'origin\tssh://example.invalid/acme/widgets.git (fetch)\n';
  const due = async () => (await hookAnswer(s.input(), { env: s.env, git, now: Date.now() })).refresh;
  await rm(remindPath(s.where), { force: true });
  await s.cache(new Date().toISOString());
  assert.equal(await due(), false, 'fresh');
  await s.cache(OLD);
  assert.equal(await due(), true, 'old, and not asked about');
  await writeWhole(s.where, 'locks/remind.json', `${JSON.stringify({ v: 1, server: s.server.url, login: PERSON.login,
    repos: { 'acme/widgets': new Date().toISOString() } })}\n`);
  assert.equal(await due(), false, 'asked about within the minute');
});

test('D230 review 1: the node an entry names is never a link of fnm\'s folder for one shell', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'sonah-node-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const shell = join(root, 'fnm_multishells', '4242_1731456000000', 'bin');
  const kept = join(root, 'fnm', 'aliases', 'default', 'bin');
  for (const dir of [shell, kept]) {
    await mkdir(dir, { recursive: true });
    await symlink(process.execPath, join(dir, 'node'));
  }
  assert.equal(await stableNode({ PATH: `${shell}:${kept}` }), join(kept, 'node'));
  assert.equal(await stableNode({ PATH: shell }), process.execPath);
});

// ---------- the parts ----------

test("the reminder's lines are those of sonah fixes, at most five a repository with the rest counted", () => {
  const head = 'a'.repeat(40);
  const entries = [...waitingList(head),
    { comment: { id: 'c_0000000000000001', by: 'dee', act: 'reply', at: '2026-11-08T12:00:00.000Z',
      first: `Look \u001b[31mhere‮` },
    item: { kind: 'finding', key: 'k_00000000000000aa', tier: 'good-to-know', title: 'x'.repeat(200) },
    pr: { number: null, branch: 'feature/y' }, head, state: null }];
  for (const entry of entries) assert.deepEqual(entryLines(entry), fixesEntryLines(entry));
  const many = Array.from({ length: 8 }, (_, i) => ({ ...entries[0],
    comment: { ...entries[0].comment, id: `c_${String(i).padStart(16, '0')}` } }));
  const text = reminder([{ owner: 'Acme', name: 'Widgets', entry: { at: OLD, total: 9, fixes: many } }],
    'https://pr.sonah.dev');
  const lines = text.split('\n');
  assert.equal(lines[0], 'sonah: 9 comments wait for you on Acme/Widgets (sonah fixes).');
  assert.equal(lines.filter((line) => line.startsWith('    https://pr.sonah.dev/c/')).length, REMIND_SHOWN_MAX);
  assert.equal(lines.at(-1), '  and 4 more');
  assert.equal(reminder([{ owner: 'a', name: 'b', entry: { at: OLD, total: 0, fixes: [] } }], 'https://x.dev'), null);
  assert.equal(inputFolder('{"cwd":"relative"}'), null);
  assert.equal(inputFolder('{"cwd":"/a","cwd":"/b"}'), null, 'a key given twice');
  assert.equal(inputFolder(JSON.stringify({ cwd: '/work/a b' })), '/work/a b');
});

test('hookAnswer reads no network and no folder outside its own', async (t) => {
  const s = await remindRepo(t);
  await s.cache(OLD);
  const git = async () => `origin\t${'ssh://example.invalid/acme/widgets.git'} (fetch)\n`
    + 'upstream\thttps://github.com/ACME/Widgets.git (push)\nlocal\t/srv/x/y (fetch)\n';
  const answer = await hookAnswer(s.input('/nowhere'), { env: s.env, git, now: Date.now() });
  assert.deepEqual([answer.folder, answer.refresh, JSON.parse(answer.stdout).systemMessage],
    ['/nowhere', true, s.message]);
  assert.equal(s.gets(), 0);
});

test('D230: the hidden remind-hook loads these modules and no more, so a start of Claude Code stays light',
  async (t) => {
    const closure = await staticClosure('packages/cli/src/remind-hook.js');
    const bytes = [...closure.values()].reduce((all, size) => all + size, 0);
    t.diagnostic(`the hidden remind-hook loads ${closure.size} modules, ${bytes} bytes`);
    assert.deepEqual([...closure.keys()].sort(), [
      'packages/cli/src/fix-waiting.js', 'packages/cli/src/remind-hook.js', 'packages/cli/src/settings.js',
      'packages/cli/src/team-git.js', 'packages/cli/src/team-home.js', 'packages/cli/src/visual-lock.js',
      'packages/cli/src/visual-server.js', 'packages/evidence/src/push-run-states.js',
      'packages/slicer/src/strict-json.js', 'packages/visual/src/fix-prompt.mjs',
    ], 'a module was added to or taken out of the reminder: it is paid for at every start of Claude Code');
    assert.ok(bytes < 150 * 1024, `the reminder reads ${bytes} bytes`);
    for (const module of ['packages/cli/src/visual-command.js', 'packages/cli/src/code-snapshot.js',
      'packages/evidence/src/ledger.js', 'packages/evidence/src/code-pass.js', 'packages/cli/src/team-api.js',
      'packages/cli/src/remind.js', 'packages/cli/src/fix-command.js'])
      assert.equal(closure.has(module), false, module);
  });
