// D229 (item 10, C6): `sonah fixes` and `sonah fix`, the laptop half of the fix loop. A port of the private laptop
// client's test/client/fix.test.js (11 tests) and test/client/waiting.test.js (5), modelled on d227-push-run.test.js
// and d228-share.test.js: real git in throwaway repositories under a sealed HOME and SONAH_HOME with spaces in their
// paths, a stand-in Sonah Team server on 127.0.0.1 (team-helpers.js `teamServer`), a stand-in claude on PATH that
// records its argv, folder and environment and runs nothing (`recordingClaude`), Claude Code recordings written as
// Claude Code writes them (`writeRecording`), and a terminal whose answers the test gives (`terminalWith`).
// No model and no network: every call goes to that stand-in, `sonah fix` never starts the real claude, and no test
// reads the Claude Code folder of this computer (CLAUDE_CONFIG_DIR names one in the sealed home).
// What these pin: the session that wrote the change is forked only when D142 finds one plain recording of it and D143
// shows the commit in it; two recordings stop and are named; anything else is a new session, with its reason; the
// worktree with the branch is used and no branch is ever checked out; the whole prompt is shown and nothing reaches
// Claude Code without a yes; the launch record (0600) and the second fix of one comment; an answer of the server that
// is not of its shape is refused before anything runs, and a teammate's words go only into the one prompt argument;
// the exit codes of each refusal; the cache that the push hook's line and `sonah status`'s count read; and the
// `answers` of the upload, which is what lets the server mark a fix pushed.
// The prompt is pinned byte for byte against a golden text (`GOLDEN_PROMPT`), since a public test cannot import the
// private client that the panel of the server builds the same prompt with.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { Readable } from 'node:stream';
import { mkdir, readFile, readdir, realpath, rename, rm, stat, utimes, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative } from 'node:path';
import { FIX_PROBLEMS } from '../../evidence/src/ledger.js';
import { FIX_FINAL_STATES, FIX_STATES, THREAD_MAX, fixPrompt, isSessionId, shown } from '../../visual/src/fix-prompt.mjs';
import { runStatusCommand, TEAM_PROBLEM_WORDS } from '../src/connect-command.js';
import { FIRST_WORD, FIX_USAGE, FIX_WORDS, FIXES_USAGE, claudeArgv, claudeFolders, connectedRepositories, pickSession,
  planFix, repositoryOf, runFixCommand, runFixesCommand, sendable } from '../src/fix-command.js';
import { LAUNCH_RECORDS_MAX, answersBySession, launchPath } from '../src/fix-launches.js';
import { WAITING_STATES, checkEntry, checkList, markLaunched, readWaiting, saveWaiting, waitingCount,
  waitingOn } from '../src/fix-waiting.js';
import { PRE_PUSH_WORDS, runPrePush } from '../src/push-hook-run.js';
import { gitOut } from '../src/team-git.js';
import { writeConnection } from '../src/team-home.js';
import { PUSH_REMOTE, pushRepo, recordingClaude, runEntry, sealedHome, streams, teamServer, terminalWith,
  writeRecording } from './team-helpers.js';

const PERSON = { login: 'octo', team: 'Acme', seat: 'paid' };
/** The session that wrote the change under review, and one that nothing wrote. */
const SESSION = '1f0c6a52-8e4b-4c3d-9a71-2b5d0e9f4c86';
const OTHER = '2a1b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d';
const ID = 'c_00112233445566ff';
const SECOND = 'c_8899aabbccddeeff';
/** The time of the agent commit, which a recording's tool call spans. */
const AT = '2026-11-08T10:00:05Z';
const QUOTE = "throw new TypeError('add needs numbers')";
const MATH_V2 = "export const add = (a, b) => {\n  if (typeof a !== 'number' || typeof b !== 'number') throw new "
  + "TypeError('add needs numbers');\n  return a + b;\n};\nexport const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, "
  + 'x));\n';
const ESC = String.fromCharCode(0x1b), RLO = String.fromCharCode(0x202e);

const sealedGit = (env) => (dir, args, options = {}) => gitOut(dir, args, { ...options, env });
const exists = (path) => stat(path).then(() => true, () => false);
const mode = async (path) => (await stat(path)).mode & 0o777;

/** GET /api/fixes/<id>'s answer for a question on add, overridden by part. */
const fixAnswer = ({ base, head, server, comment = {}, item = {}, review = {}, fix = {} }) => ({
  comment: { id: ID, by: 'ben', act: 'question', at: '2026-11-08T11:00:00.000Z',
    words: 'Can add still take strings?\nIt used to.', ...comment },
  item: { kind: 'finding', key: 'k_0123456789abcdef', tier: 'must-act',
    title: 'add now throws on anything but numbers',
    oneLine: 'Callers that pass strings to add now get a TypeError.', fns: ['math.js#add'], quote: QUOTE,
    files: ['math.js'], ...item },
  review: { url: `${server}/r/acme/widgets/pull/12`, owner: 'acme', name: 'widgets', pr: 12, branch: 'feature',
    base, head, ...review },
  fix: { state: null, at: null, ...fix },
});

/** A waiting list as GET /api/fixes answers it: two comments on PR #12 of the branch. */
const waitingList = ({ head, fixes = null } = {}) => (fixes ?? [
  { comment: { id: ID, by: 'ben', act: 'question', at: '2026-11-08T11:00:00.000Z',
    first: 'Can add still take strings?' },
  item: { kind: 'finding', key: 'k_0123456789abcdef', tier: 'must-act',
    title: 'add now throws on anything but numbers' },
  pr: { number: 12, branch: 'feature' }, head, state: null },
  { comment: { id: SECOND, by: 'cy', act: 'override', at: '2026-11-08T11:05:00.000Z', first: null },
    item: { kind: 'function', key: 'math.js#clamp', tier: null, title: 'clamp' },
    pr: { number: 12, branch: 'feature' }, head, state: 'opened' },
]);

/**
 * A sealed home with a clone of acme/widgets whose branch `feature` has one agent commit at AT that names SESSION, a
 * second worktree with that branch checked out, a Claude Code folder of its own, a stand-in claude and a stand-in
 * server that the clone is connected to: `{ home, root, repo, server, token, where, env, cfg, claude, wt, base, head,
 * answer, fix(args, answers, options), fixes(args, options), status(args), waiting() }`.
 */
async function setup(t, { person = PERSON, connect = true, env: extraEnv = {} } = {}) {
  const home = await sealedHome(t, 'sonah d229 ');
  const root = await realpath(home.root);
  const cfg = join(root, 'cc home');
  await mkdir(cfg, { recursive: true });
  const repo = await pushRepo(home, { env: { CLAUDE_CONFIG_DIR: cfg, FAKE_CC_LOG: join(root, 'claude-runs.jsonl'),
    ...extraEnv } });
  const claude = await recordingClaude(home);
  const server = await teamServer(t);
  const token = server.addToken(person);
  const where = { env: repo.env };
  if (connect) await writeConnection({ server: server.url, token, login: person.login }, where);
  const base = repo.git(['rev-parse', 'main']);
  repo.git(['checkout', '-q', '-b', 'feature', 'main']);
  await writeFile(join(repo.work, 'math.js'), MATH_V2);
  repo.git(['add', '.']);
  repo.git(['commit', '-q', '-m', `Check add, add clamp\n\nAgent-Session: ${SESSION}`],
    { GIT_AUTHOR_DATE: AT, GIT_COMMITTER_DATE: AT });
  const head = repo.git(['rev-parse', 'HEAD']);
  repo.git(['checkout', '-q', 'main']);
  const treePath = join(root, 'wt feature');
  repo.git(['worktree', 'add', '-q', treePath, 'feature']);
  const wt = await realpath(treePath);
  const answer = fixAnswer({ base, head, server: server.url });
  server.comments[ID] = answer;
  const git = sealedGit(repo.env);
  const s = { home, root, repo, server, token, where, env: repo.env, cfg, claude, wt, base, head, answer, git,
    /** `sonah fix` in-process, with a terminal that answers in turn. */
    fix: async (args, answers = [], { cwd = repo.work, env = repo.env, ...rest } = {}) => {
      const terminal = terminalWith(answers);
      const out = streams();
      const code = await runFixCommand(args, { env, cwd, stderr: out.stderr, terminal, git: sealedGit(env), ...rest });
      return { code, said: terminal.text(), ...out.chunks };
    },
    /** `sonah fixes` in-process. */
    fixes: async (args = [], { cwd = repo.work, env = repo.env, ...rest } = {}) => {
      const out = streams();
      const code = await runFixesCommand(args, { env, cwd, stdout: out.stdout, stderr: out.stderr,
        git: sealedGit(env), ...rest });
      return { code, ...out.chunks };
    },
    /** `sonah status` in-process (no network but the seat call). */
    status: async (args = []) => {
      const out = streams();
      const code = await runStatusCommand(args, { env: repo.env, stdout: out.stdout, stderr: out.stderr, git });
      return { code, ...out.chunks };
    },
    waiting: () => readWaiting(where, { server: server.url, login: person.login }),
    runs: () => claude.runs(),
  };
  return s;
}

/** The two lines a problem of these commands says: the problem and its fix. */
const saidOf = (code, args = [], fixArgs = args) => {
  const says = FIX_WORDS.problem[code], fix = FIX_WORDS.fix[code];
  return `${typeof says === 'function' ? says(...args) : says}\nFix: ${typeof fix === 'function' ? fix(...fixArgs)
    : fix}\n`;
};

// ---------- the prompt, byte for byte ----------

// The prompt of one fixed comment, as `fixPrompt` writes it. The panel of the server builds the prompt from the same
// fields with its own copy of fix-prompt.mjs (sonah-hosted server/fixes.mjs imports client/fix-prompt.mjs, which the
// release syncs from packages/visual/src/fix-prompt.mjs), and a public test cannot import that copy: these bytes are
// the contract between the two. A change here is a change the panel must make with it.
const GOLDEN_ITEM = Object.freeze({
  review: { owner: 'acme', name: 'widgets', pr: 12, branch: 'feature', base: 'a'.repeat(40), head: 'b'.repeat(40) },
  item: { kind: 'finding', key: 'k_0123456789abcdef', tier: 'must-act',
    title: 'add now throws on anything but numbers',
    oneLine: 'Callers that pass strings to add now get a TypeError.', fns: ['lib/math.js#add'], quote: QUOTE },
  comment: { id: ID, by: 'ben', act: 'question', at: '2026-11-08T11:00:00.000Z',
    words: 'Can add still take strings?\nIt used to.' },
  thread: [],
  publicUrl: 'https://pr.sonah.dev',
});
const GOLDEN_PROMPT = "A review comment from @ben on acme/widgets PR #12 (branch feature), left on Sonah's review of "
  + 'bbbbbbbbbbbb.\nTheir words are below exactly as written; each of their lines starts with "> ".\n\nThe item, as the '
  + 'review shows it (its quote is checked to be in the change):\n  Must act: add now throws on anything but numbers\n'
  + '  Callers that pass strings to add now get a TypeError.\n  Functions: lib/math.js#add\n  Quote: "throw new '
  + 'TypeError(\'add needs numbers\')"\n\n@ben asked on 2026-11-08:\n> Can add still take strings?\n> It used to.\n\n'
  + 'Please take this up on branch feature; if this folder is on another branch, stop and tell me. If it asks for a '
  + 'change\nyou agree with, make it and commit it on this branch, without pushing. If it asks a question, answer it. '
  + 'If you think\nit is wrong, tell me why and change nothing for it. The change under review is '
  + 'aaaaaaaaaaaa..bbbbbbbbbbbb.\nReview page: https://pr.sonah.dev/c/c_00112233445566ff';

test('the prompt is the one the panel of the server sends: the same bytes from the same fields', () => {
  assert.equal(fixPrompt(GOLDEN_ITEM), GOLDEN_PROMPT);
  assert.equal(Buffer.byteLength(GOLDEN_PROMPT), 923);
  // The command row of the panel names this command, which is the one difference between the two copies of the module.
  assert.equal(FIRST_WORD, 'A');
  assert.ok(sendable(GOLDEN_PROMPT));
});

// ---------- sonah fix ----------

test('one plain recording D143 shows: a copy of that session, in the worktree of the branch, the prompt as one argument',
  async (t) => {
    const s = await setup(t);
    await writeRecording(s.cfg, 'proj-work', SESSION, { cwd: await realpath(s.repo.work) });
    const r = await s.fix([ID], ['y'], { env: { ...s.env, FAKE_CC_EXIT: '3' } });
    assert.equal(r.code, 0, `${r.stderr}${r.said}`);

    const runs = await s.runs();
    assert.equal(runs.length, 1);
    const [run] = runs;
    const prompt = fixPrompt({ review: s.answer.review, item: s.answer.item, comment: s.answer.comment,
      publicUrl: new URL(s.server.url).origin });
    const session = run.argv[4];
    assert.deepEqual(run.argv, ['--resume', SESSION, '--fork-session', '--session-id', session, prompt]);
    assert.ok(isSessionId(session) && session !== SESSION, 'a new id of its own');
    assert.ok(prompt.startsWith('A review comment from @ben on acme/widgets PR #12 (branch feature)'));
    assert.equal(run.cwd, s.wt, 'the worktree that has the branch, not the folder it ran from');
    assert.equal(run.env.CLAUDE_CONFIG_DIR, s.cfg, 'the folder the recording was found in');

    // The author saw the whole prompt, with nothing hidden, and where it goes, before the question.
    for (const line of prompt.split('\n')) if (line) assert.ok(r.said.includes(`  ${shown(line)}\n`), line);
    assert.ok(r.said.includes(FIX_WORDS.toFork(SESSION.slice(0, 8), s.wt, s.cfg)), r.said);
    assert.ok(r.said.indexOf('It goes to') < r.said.indexOf(FIX_WORDS.question));

    // The launch record: 0600, the exact prompt, the session it went to; the server is told.
    const file = launchPath(s.where, ID);
    assert.equal(await mode(file), 0o600);
    const record = JSON.parse(await readFile(file, 'utf8'));
    assert.deepEqual({ ...record, launches: undefined }, { v: 1, comment: ID,
      review: `${s.server.url}/r/acme/widgets/pull/12`, repo: 'acme/widgets', branch: 'feature', base: s.base,
      head: s.head, launches: undefined });
    assert.equal(record.launches.length, 1);
    assert.deepEqual({ ...record.launches[0], at: null },
      { session, forkOf: SESSION, configDir: s.cfg, cwd: s.wt, prompt, at: null });
    assert.match(record.launches[0].at, /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/);
    assert.deepEqual(s.server.launches, [{ id: ID, session, forkOf: SESSION }]);
    assert.deepEqual(s.server.calls.filter((c) => c.path.startsWith('/api/fixes'))
      .map((c) => `${c.method} ${c.path}`), [`GET /api/fixes/${ID}`, `POST /api/fixes/${ID}/launched`]);
    assert.equal(s.server.calls.every((c) => c.authorization === `Bearer ${s.token}`), true);

    // A second fix of the same comment forks the newest session of the record (found again by D142), under another id.
    await writeRecording(s.cfg, 'proj-wt', session, { cwd: s.wt, from: '2026-11-08T12:00:00.000Z',
      to: '2026-11-08T12:00:01.000Z' });
    const second = await s.fix([ID], ['yes'], { cwd: s.wt });
    assert.equal(second.code, 0, second.stderr);
    const run2 = (await s.runs())[1];
    assert.deepEqual(run2.argv.slice(0, 4), ['--resume', session, '--fork-session', '--session-id']);
    assert.ok(isSessionId(run2.argv[4]) && ![session, SESSION].includes(run2.argv[4]));
    assert.ok(second.said.includes(FIX_WORDS.toLast(session.slice(0, 8), s.wt, s.cfg)), second.said);
    const after = JSON.parse(await readFile(file, 'utf8'));
    assert.deepEqual(after.launches.map((l) => [l.session, l.forkOf]),
      [[session, SESSION], [run2.argv[4], session]], 'one record, newest last');
  });

test('a second fix whose last session has no recording here picks again by D143; a launch the server refuses still runs',
  async (t) => {
    const s = await setup(t);
    await writeRecording(s.cfg, 'proj-work', SESSION, { cwd: await realpath(s.repo.work) });
    assert.equal((await s.fix([ID], ['y'])).code, 0);
    // no recording of the first fix's session (its author ended it before Claude Code wrote one)
    s.server.once('POST', `/api/fixes/${ID}/launched`, { status: 409, json: { error: 'fix_final' } });
    const again = await s.fix([ID], ['y']);
    assert.equal(again.code, 0, again.stderr);
    const run = (await s.runs())[1];
    assert.deepEqual(run.argv.slice(0, 2), ['--resume', SESSION], 'the session that wrote the change, again');
    assert.ok(again.said.includes(FIX_WORDS.notTold('refused')), again.said);
    assert.equal(JSON.parse(await readFile(launchPath(s.where, ID), 'utf8')).launches.length, 2);
  });

test('C8 review 1: a 401 to `launched` marks nothing, as PRIVACY says: the fix goes on, no refused mark is written, '
  + 'and the next `sonah fixes` still calls the server', async (t) => {
  const s = await setup(t);
  await writeRecording(s.cfg, 'proj-work', SESSION, { cwd: await realpath(s.repo.work) });
  s.server.once('POST', `/api/fixes/${ID}/launched`, { status: 401, json: { error: 'bad_token' } });
  const r = await s.fix([ID], ['y']);
  assert.equal(r.code, 0, r.stderr);
  assert.ok(r.said.includes(FIX_WORDS.notTold('refused')), r.said);
  assert.equal((await s.runs()).length, 1, 'Claude Code started all the same');
  await assert.rejects(stat(join(s.env.SONAH_HOME, 'team', 'refused.json')), { code: 'ENOENT' });
  const calls = s.server.calls.length;
  assert.equal((await s.fixes()).code, 0);
  assert.deepEqual(s.server.calls.slice(calls).map((c) => `${c.method} ${c.path}`), ['GET /api/fixes']);
});

test('two recordings of the session: it stops and names both, and --config-dir picks one', async (t) => {
  const s = await setup(t);
  const inRepo = await realpath(s.repo.work);
  const a = await writeRecording(s.cfg, 'proj-work', SESSION, { cwd: inRepo });
  const other = join(s.root, '.claude');
  const b = await writeRecording(other, 'proj-other', SESSION, { cwd: inRepo });
  const stopped = await s.fix([ID], ['y']);
  assert.equal(stopped.code, 2);
  // both recordings named, and both folders offered: the paths come from the folders as Sonah reads them, so the one
  // of CLAUDE_CONFIG_DIR and the one of HOME are each named as that setting spells it.
  const home = join(s.env.HOME, '.claude');
  assert.ok(stopped.stderr.includes(`session ${SESSION.slice(0, 8)}:`), stopped.stderr);
  for (const part of [join(s.cfg, 'projects', 'proj-work'), join(home, 'projects', 'proj-other'),
    `--config-dir ${s.cfg}`, `--config-dir ${home}`, '--new'])
    assert.ok(stopped.stderr.includes(part), `${part}\n---\n${stopped.stderr}`);
  assert.deepEqual([a, b].map((file) => file.endsWith(`${SESSION}.jsonl`)), [true, true]);
  assert.equal(stopped.said.includes(FIX_WORDS.question), false, 'never asked');
  assert.deepEqual(await s.runs(), []);
  assert.equal(await exists(launchPath(s.where, ID)), false);

  // --config-dir names one folder: that folder only. It is ~/.claude, which is Claude Code's own default, so
  // CLAUDE_CONFIG_DIR is left unset for it (D151: a login is keyed to the string of the variable).
  const picked = await s.fix([ID, '--config-dir', other], ['y']);
  assert.equal(picked.code, 0, picked.stderr);
  const [run] = await s.runs();
  assert.deepEqual(run.argv.slice(0, 2), ['--resume', SESSION]);
  assert.equal(run.env.CLAUDE_CONFIG_DIR, null);
  assert.equal(JSON.parse(await readFile(launchPath(s.where, ID), 'utf8')).launches[0].configDir, null);
  // the folder CLAUDE_CONFIG_DIR names keeps its own spelling, whatever --config-dir says of it
  assert.deepEqual(claudeFolders({ env: s.env, configDir: `${s.cfg}/` }).map((f) => f.spell), [s.cfg]);
});

test('two recordings in one Claude Code folder: it names both and asks for a new session, not a folder', async (t) => {
  const s = await setup(t);
  const inRepo = await realpath(s.repo.work);
  // one session id carries two recordings of one folder when the session was resumed from another folder, or a
  // project folder was renamed (session-id.js): --config-dir names that one folder and picks neither of them.
  const a = await writeRecording(s.cfg, 'proj-a', SESSION, { cwd: inRepo });
  const b = await writeRecording(s.cfg, 'proj-b', SESSION, { cwd: inRepo });
  const stopped = await s.fix([ID], ['y']);
  assert.equal(stopped.code, 2);
  assert.equal(stopped.stderr,
    saidOf('fix_several_recordings', [SESSION.slice(0, 8), [a, b].map(shown).join(', ')], [[s.cfg]]));
  assert.equal(stopped.stderr.includes('--config-dir'), false, 'one folder: nothing to name with --config-dir');
  assert.equal(stopped.said.includes(FIX_WORDS.question), false, 'never asked');
  assert.deepEqual(await s.runs(), []);
});

test('a recording that does not show the commit, none here, or --new: a new session, and it says why', async (t) => {
  const s = await setup(t);
  const inRepo = await realpath(s.repo.work);
  const newRun = async (args, expect) => {
    const r = await s.fix([ID, ...args], ['y']);
    assert.equal(r.code, 0, r.stderr);
    const run = (await s.runs()).at(-1);
    assert.equal(run.argv.length, 3);
    assert.equal(run.argv[0], '--session-id');
    assert.ok(isSessionId(run.argv[1]));
    assert.equal(run.env.CLAUDE_CONFIG_DIR, s.cfg, 'its environment as it was');
    assert.ok(r.said.includes(expect), `${expect}\n---\n${r.said}`);
    await rm(launchPath(s.where, ID)); // each case is a first fix
  };
  await t.test('none here', () => newRun([], FIX_WORDS.toNew(s.wt, FIX_WORDS.why.not_here(SESSION.slice(0, 8)))));
  // a call that ended before the commit was made
  await writeRecording(s.cfg, 'proj-work', SESSION,
    { cwd: inRepo, from: '2026-11-08T09:00:00.000Z', to: '2026-11-08T09:00:30.000Z' });
  await t.test('only named', () => newRun([], FIX_WORDS.toNew(s.wt, FIX_WORDS.why.not_shown(SESSION.slice(0, 8)))));
  // a call at the commit's time, in another repository's folder
  const elsewhere = join(s.root, 'elsewhere');
  await mkdir(elsewhere, { recursive: true });
  s.repo.git(['init', '-q', elsewhere], {}, s.root);
  await writeRecording(s.cfg, 'proj-work', SESSION, { cwd: await realpath(elsewhere) });
  await t.test('ran in another repository',
    () => newRun([], FIX_WORDS.toNew(s.wt, FIX_WORDS.why.not_shown(SESSION.slice(0, 8)))));
  await writeRecording(s.cfg, 'proj-work', SESSION, { cwd: inRepo });
  await t.test('--new', () => newRun(['--new'], FIX_WORDS.toNew(s.wt, FIX_WORDS.why.asked)));
  await t.test('a compressed recording (Codex keeps its own .zst)', async () => {
    const folder = { dir: s.cfg, spell: s.cfg };
    const plan = await pickSession({ dir: s.wt, base: s.base, head: s.head, files: ['math.js'], folders: [folder],
      env: s.env, git: s.git,
      find: async () => [{ file: join(s.cfg, 'x', `rollout-${SESSION}.jsonl.zst`), adapter: 'codex', folder }] });
    assert.deepEqual(plan, { kind: 'new', why: 'not_readable', session: SESSION });
  });
  await t.test('no agent commit touched the files of the item', async () => {
    const plan = await pickSession({ dir: s.wt, base: s.base, head: s.head, files: ['README.md'],
      folders: claudeFolders({ env: s.env }), env: s.env, git: s.git });
    assert.deepEqual(plan, { kind: 'new', why: 'no_agent_commit' });
  });
  await t.test('a git that stops answering between the two reads of the range: a new session, not a crash', async () => {
    // The range is read twice (the commits and their sessions): the second read gets no answer here.
    let reads = 0;
    const flaky = (dir, args, options) => {
      if (args.includes('--encoding=UTF-8')) { reads += 1; if (reads === 2) return Promise.resolve(null); }
      return s.git(dir, args, options);
    };
    const plan = await pickSession({ dir: s.wt, base: s.base, head: s.head, files: ['math.js'],
      folders: claudeFolders({ env: s.env }), env: s.env, git: flaky });
    assert.deepEqual(plan, { kind: 'new', why: 'range_unreadable' });
    assert.equal(reads, 2);
  });
});

test('the folder: none has the branch, it stops and checks nothing out; another clone, it stops; an old HEAD, it says so',
  async (t) => {
    const s = await setup(t);
    s.repo.git(['worktree', 'remove', '--force', s.wt]);
    const before = s.repo.git(['worktree', 'list', '--porcelain']);
    const none = await s.fix([ID], ['y']);
    assert.equal(none.code, 2);
    assert.equal(none.stderr, saidOf('fix_no_worktree', ['feature'], ['feature']));
    assert.equal(s.repo.git(['branch', '--show-current']), 'main', 'nothing was checked out');
    assert.equal(s.repo.git(['worktree', 'list', '--porcelain']), before, 'and no worktree was added');
    assert.deepEqual(await s.runs(), []);
    s.repo.git(['worktree', 'add', '-q', s.wt, 'feature']);

    // a clone of another repository
    const other = join(s.root, 'other clone');
    s.repo.git(['clone', '-q', s.repo.bare, other], {}, s.root);
    s.repo.git(['remote', 'set-url', 'origin', 'ssh://example.invalid/someone/else.git'], {}, other);
    const notOurs = await s.fix([ID], ['y'], { cwd: other });
    assert.equal(notOurs.code, 2);
    assert.equal(notOurs.stderr, saidOf('fix_not_this_repo', ['acme/widgets']));
    // a folder in no repository
    const plain = join(s.root, 'plain');
    await mkdir(plain, { recursive: true });
    const notGit = await s.fix([ID, '--repo', plain], ['y']);
    assert.equal(notGit.code, 2);
    assert.equal(notGit.stderr, saidOf('fix_not_git', [shown(plain)]));

    // the branch in two worktrees (git allows it with --force): it names both and picks neither
    const extra = join(s.root, 'wt b');
    s.repo.git(['worktree', 'add', '-q', '--force', extra, 'feature']);
    const several = await s.fix([ID], ['y']);
    assert.equal(several.code, 2);
    assert.ok(several.stderr.includes('More than one worktree has feature checked out'), several.stderr);
    assert.ok(several.stderr.includes(await realpath(extra)) && several.stderr.includes(s.wt), several.stderr);
    s.repo.git(['worktree', 'remove', '--force', extra]);

    // the branch checked out where HEAD is behind the reviewed head (a reset): said before the question
    s.repo.git(['reset', '-q', '--hard', s.base], {}, s.wt);
    const behind = await s.fix([ID], ['n']);
    assert.equal(behind.code, 1, 'no means no');
    assert.ok(behind.said.includes(FIX_WORDS.headNotHeld(s.head.slice(0, 12))), behind.said);
    assert.ok(behind.said.indexOf(FIX_WORDS.headNotHeld(s.head.slice(0, 12)))
      < behind.said.indexOf(FIX_WORDS.question));
    assert.ok(behind.said.includes(FIX_WORDS.nothingSent));
    assert.deepEqual(await s.runs(), []);
    assert.equal(await exists(launchPath(s.where, ID)), false);
  });

test('a terminal in no clone of it: the one worktree with the branch among the connected clones; several, it stops',
  async (t) => {
    const s = await setup(t);
    await writeRecording(s.cfg, 'proj-work', SESSION, { cwd: await realpath(s.repo.work) });
    // as `sonah hook add --push` keeps it
    const { updateHooks } = await import('../src/team-home.js');
    const common = await realpath(join(s.repo.work, '.git'));
    await updateHooks(s.where, () => [{ common, server: s.server.url }]);
    // the cached list holds the comment: once Claude Code is on it, the lines stop counting it
    await saveWaiting(s.where, { server: s.server.url, login: PERSON.login },
      checkList({ repo: { owner: 'acme', name: 'widgets' }, total: 2, fixes: waitingList({ head: s.head }) },
        { owner: 'acme', name: 'widgets' }));
    const plain = join(s.root, 'anywhere');
    await mkdir(plain, { recursive: true });
    const found = await s.fix([ID], ['y'], { cwd: plain });
    assert.equal(found.code, 0, found.stderr);
    const [run] = await s.runs();
    assert.equal(run.cwd, s.wt, 'the worktree of the connected clone that has the branch');
    assert.equal((await s.waiting())['acme/widgets'].fixes[0].state, 'launched');
    assert.equal(waitingCount((await s.waiting())['acme/widgets']), 1, 'one of the two still waits');

    // a folder named with --repo is the one used: no looking elsewhere
    const named = await s.fix([ID, '--repo', plain], ['y']);
    assert.equal(named.code, 2);
    assert.equal(named.stderr, saidOf('fix_not_git', [shown(plain)]));
    // the branch in two worktrees of the connected clones: it names both and picks neither
    const extra = join(s.root, 'wt b');
    s.repo.git(['worktree', 'add', '-q', '--force', extra, 'feature']);
    const several = await s.fix([ID], ['y'], { cwd: plain });
    assert.equal(several.code, 2);
    assert.ok(several.stderr.includes(await realpath(extra)), several.stderr);
    assert.equal((await s.runs()).length, 1, 'nothing more ran');
  });

test("a reply's thread from the server: checked by shape, then in the prompt sent, as the panel shows it", async (t) => {
  const s = await setup(t);
  const thread = [{ by: 'cy', act: 'override', at: '2026-11-08T10:00:00.000Z', words: 'Keep strings working.' }];
  const comment = { ...s.answer.comment, act: 'reply', words: 'Or throw, but say so.' };
  s.server.comments[ID] = { ...s.answer, comment, thread };
  const r = await s.fix([ID], ['y']);
  assert.equal(r.code, 0, r.stderr);
  const sent = (await s.runs())[0].argv.at(-1);
  assert.equal(sent, fixPrompt({ review: s.answer.review, item: s.answer.item, comment, thread,
    publicUrl: new URL(s.server.url).origin }));
  assert.match(sent, /@cy overrode it on 2026-11-08:\n> Keep strings working\.\n\n@ben wrote on 2026-11-08:\n> Or throw, but say so\./);
  // a thread entry that is not of its shape stops it, and names the field
  s.server.comments[ID] = { ...s.answer, thread: [{ ...thread[0], by: '$(touch x)' }] };
  const bad = await s.fix([ID], ['y']);
  assert.equal(bad.code, 2);
  assert.equal(bad.stderr, saidOf('fix_bad_answer', [s.server.url, 'thread[0].by']));
  assert.equal((await s.runs()).length, 1);
});

test('server data not of its shape is refused before anything runs; words go only into the one prompt argument',
  async (t) => {
    const s = await setup(t);
    await writeRecording(s.cfg, 'proj-work', SESSION, { cwd: await realpath(s.repo.work) });
    const hostile = [
      ['comment.id', { comment: { id: 'c_ffffffffffffffff' } }],
      ['comment.by', { comment: { by: '-rf' } }],
      ['comment.act', { comment: { act: 'confirm' } }],
      ['comment.words', { comment: { words: `fine${RLO}evil` } }],
      ['comment.words', { comment: { act: 'question', words: null } }],
      ['review.owner', { review: { owner: 'acme;touch HACKED' } }],
      ['review.owner', { review: { owner: '$(id)' } }],
      ['review.name', { review: { name: '..' } }],
      ['review.branch', { review: { branch: '--upload-pack=touch HACKED' } }],
      ['review.branch', { review: { branch: 'a b' } }],
      ['review.base', { review: { base: 'HEAD~1' } }],
      ['review.url', { review: { url: 'https://evil.example/r/acme/widgets/pull/12' } }],
      ['review.url', { review: { url: 'javascript:alert(1)' } }],
      ['item.files', { item: { files: ['math.js\n../../etc'] } }],
      ['item.tier', { item: { tier: 'must-panic' } }],
      ['fix.state', { fix: { state: 'pwned' } }],
    ];
    for (const [where, over] of hostile) {
      s.server.comments[ID] = fixAnswer({ base: s.base, head: s.head, server: s.server.url, ...over });
      const r = await s.fix([ID], ['y']);
      assert.equal(r.code, 2, where);
      assert.equal(r.stderr, saidOf('fix_bad_answer', [s.server.url, where]), where);
    }
    assert.deepEqual(await s.runs(), [], 'nothing ran');
    assert.equal(await exists(launchPath(s.where, ID)), false);

    // a fix in a final state: nothing to do, and it ends 0
    for (const state of FIX_FINAL_STATES) {
      s.server.comments[ID] = fixAnswer({ base: s.base, head: s.head, server: s.server.url,
        fix: { state, at: '2026-11-08T12:00:00.000Z' } });
      const done = await s.fix([ID], ['y']);
      assert.equal(done.code, 0);
      assert.equal(done.said, `${FIX_WORDS.finalState(state)}\n`);
    }
    assert.deepEqual(await s.runs(), []);

    // Shell text in the words is only text: one argv element, exactly the prompt, and nothing ran it.
    const words = `Try $(touch ${s.root}/HACKED) and \`touch ${s.root}/HACKED2\`; rm -rf ~\n`
      + '--dangerously-skip-permissions\n-p';
    const answer = fixAnswer({ base: s.base, head: s.head, server: s.server.url, comment: { words } });
    s.server.comments[ID] = answer;
    assert.equal((await s.fix([ID], ['y'])).code, 0);
    const [run] = await s.runs();
    assert.equal(run.argv.length, 6);
    assert.equal(run.argv[5], fixPrompt({ review: answer.review, item: answer.item, comment: answer.comment,
      publicUrl: new URL(s.server.url).origin }));
    assert.ok(run.argv[5].includes('> --dangerously-skip-permissions\n> -p'), 'their lines start with "> "');
    assert.equal(run.argv.filter((a) => a.startsWith('-')).length, 3,
      'the only options are --resume, --fork-session and --session-id');
    assert.equal(await exists(join(s.root, 'HACKED')), false);
    assert.equal(await exists(join(s.root, 'HACKED2')), false);
  });

test('an answer of one fix past 64 KB is read: a thread of THREAD_MAX replies and an item of many functions',
  async (t) => {
    const s = await setup(t);
    const words = 'A reply holds as much as the store keeps of one. '.repeat(42).slice(0, 2000);
    const thread = Array.from({ length: THREAD_MAX }, (_, i) => ({ by: 'ben', act: 'reply',
      at: `2026-11-08T11:${String(i).padStart(2, '0')}:00.000Z`, words }));
    const fns = Array.from({ length: 30 }, (_, i) => `math.js#long_${i}_${'x'.repeat(1000)}`);
    s.server.comments[ID] = { ...fixAnswer({ base: s.base, head: s.head, server: s.server.url,
      item: { fns: ['math.js#add', ...fns] } }), thread };
    assert.ok(JSON.stringify(s.server.comments[ID]).length > 64 * 1024, 'the answer is past 64 KB');
    const run = await s.fix([ID], ['y']);
    assert.equal(run.code, 0, run.stderr);
    assert.equal(run.stderr, '', 'nothing of it is an answer Sonah cannot read');
    const [sent] = await s.runs();
    assert.ok(sent.argv.at(-1).includes(words), 'the words of the thread reached the prompt');
  });

test('a prompt that would start with "-" is never sent; edit is $EDITOR on a private 0600 file, removed after',
  async (t) => {
    assert.throws(() => claudeArgv({ prompt: '--dangerously-skip-permissions', session: OTHER }),
      /must start with "A "/);
    assert.throws(() => claudeArgv({ prompt: '-p hi', session: OTHER, forkOf: SESSION }));
    assert.throws(() => claudeArgv({ prompt: 'A fine prompt', session: 'not-a-session' }));
    assert.equal(sendable('A b\0c'), false);
    assert.deepEqual(claudeArgv({ prompt: 'A fine prompt', session: OTHER }),
      ['--session-id', OTHER, 'A fine prompt']);

    const s = await setup(t);
    const edits = [];
    /** A stand-in for the child this command runs on the terminal: for the editor (which Sonah runs through /bin/sh,
     *  as git does) it records the file it was given, its mode and its folder's, then writes `to`; for claude it runs
     *  the stand-in on PATH, as the command itself does. */
    const editor = (to) => async (command, args, options) => {
      if (command !== '/bin/sh') {
        const r = spawnSync(command, args, { ...options, encoding: 'utf8' });
        return { code: r.status ?? 1 };
      }
      const file = args.at(-1);
      edits.push({ file, mode: await mode(file), dir: await mode(join(file, '..')),
        text: await readFile(file, 'utf8') });
      await writeFile(file, `${to}\n`);
      return { code: 0 };
    };
    const prompt = fixPrompt({ review: s.answer.review, item: s.answer.item, comment: s.answer.comment,
      publicUrl: new URL(s.server.url).origin });
    // an edit that starts with "-" is refused, the prompt stays as it was, and no is no
    const refused = await s.fix([ID], ['e', 'n'], { env: { ...s.env, EDITOR: 'true' },
      run: editor('--dangerously-skip-permissions fix it') });
    assert.equal(refused.code, 1);
    assert.ok(refused.said.includes(FIX_WORDS.editorFirstWord(FIRST_WORD)), refused.said);
    assert.deepEqual(await s.runs(), []);
    // an edit that keeps the first word is sent, as edited, and kept in the record
    const sent = await s.fix([ID], ['e', 'y'], { env: { ...s.env, EDITOR: 'true' },
      run: editor('A shorter prompt:\nplease check add.') });
    assert.equal(sent.code, 0, sent.stderr);
    const [run] = await s.runs();
    assert.equal(run.argv.at(-1), 'A shorter prompt:\nplease check add.', 'the line end the editor added is gone');
    assert.equal(JSON.parse(await readFile(launchPath(s.where, ID), 'utf8')).launches[0].prompt,
      'A shorter prompt:\nplease check add.');
    assert.equal(edits.length, 2);
    for (const edit of edits) {
      assert.equal(edit.mode, 0o600);
      assert.equal(edit.dir, 0o700);
      assert.equal(edit.text, prompt, 'the editor got the whole prompt');
      assert.equal(await exists(edit.file), false, 'removed after');
    }
    assert.ok(sent.said.includes('  A shorter prompt:\n  please check add.'),
      'the edited prompt is shown before the second question');
    // with no editor set, it says so and asks again
    const noEditor = await s.fix([ID], ['e', 'n'], { env: { ...s.env, EDITOR: '', VISUAL: '' } });
    assert.equal(noEditor.code, 1);
    assert.ok(noEditor.said.includes(FIX_WORDS.noEditor), noEditor.said);
  });

test('it needs a terminal, will not start inside Claude Code, needs claude on PATH and a connection', async (t) => {
  const s = await setup(t);
  const calls = s.server.calls.length;
  const noTty = await runFixCommand([ID], { env: s.env, cwd: s.repo.work, stderr: streams().stderr,
    terminal: { ...terminalWith(['y']), isTTY: false }, git: s.git });
  assert.equal(noTty, 2);
  const inside = await s.fix([ID], ['y'], { env: { ...s.env, CLAUDECODE: '1' } });
  assert.equal(inside.code, 2);
  assert.equal(inside.stderr, saidOf('fix_inside_claude'));
  const noClaude = await s.fix([ID], ['y'], { env: { ...s.env, PATH: '/nowhere' } });
  assert.equal(noClaude.code, 2);
  assert.equal(noClaude.stderr, saidOf('fix_no_claude'));
  assert.equal(s.server.calls.length, calls, 'the server was not asked');
  assert.deepEqual(await s.runs(), []);
  // a bad id, and one the server does not know or cannot answer
  const badId = await s.fix(['c_nope'], ['y']);
  assert.equal(badId.code, 2);
  assert.equal(badId.stderr, saidOf('fix_bad_id'));
  const unknown = await s.fix([SECOND], ['y']);
  assert.equal(unknown.code, 2);
  assert.equal(unknown.stderr, saidOf('fix_not_waiting', [SECOND, s.server.url]));
  s.server.comments[SECOND] = 409;
  const notFixable = await s.fix([SECOND], ['y']);
  assert.equal(notFixable.code, 2);
  assert.equal(notFixable.stderr, saidOf('fix_not_fixable', [SECOND]));
  // and with no connection at all, nothing of the repository is read
  const { forgetConnection } = await import('../src/team-home.js');
  const { PUSH_RUN_WORDS } = await import('../src/push-run.js');
  await forgetConnection(s.where);
  const off = await s.fix([ID], ['y']);
  assert.equal(off.code, 2);
  assert.equal(off.stderr, `${PUSH_RUN_WORDS.why.not_connected}\n`);
  // the usage of each command, for a word it does not take
  const usage = await s.fix([ID, '--what'], []);
  assert.equal(usage.code, 2);
  assert.equal(usage.stderr, `sonah fix: unknown option --what.\nusage: ${FIX_USAGE}\n`);
});

test('A9: without the commit link of D143, sonah fix says the server cannot mark this fix pushed', async (t) => {
  const s = await setup(t);
  const off = await s.fix([ID], ['n']);
  assert.equal(off.code, 1);
  assert.ok(off.said.includes(FIX_WORDS.noLink(shown(s.wt))), off.said);
  assert.ok(off.said.indexOf(FIX_WORDS.noLink(shown(s.wt))) < off.said.indexOf(FIX_WORDS.question));
  // with the link on in that worktree, it says nothing of it
  const { runHookCommand } = await import('../src/agent-session-hook.js');
  const out = streams();
  assert.equal(await runHookCommand(['add', '--repo', s.wt],
    { cwd: s.wt, stdout: out.stdout, stderr: out.stderr, git: s.git }), 0, out.chunks.stderr);
  const on = await s.fix([ID], ['n']);
  assert.equal(on.code, 1);
  assert.equal(on.said.includes(FIX_WORDS.noLink(shown(s.wt))), false, on.said);
});

test('D229 review 3: A9 names the worktree it read the link in, and names it to sonah hook add, which reads the '
  + 'folder you are in otherwise', async (t) => {
  const s = await setup(t);
  // The path the command advertises for a terminal in no clone of the repository: the worktree comes from the clones
  // in team/hooks.json, so the folder whose link A9 read is not the folder this terminal is in.
  const { updateHooks } = await import('../src/team-home.js');
  const common = await realpath(join(s.repo.work, '.git'));
  await updateHooks(s.where, () => [{ common, server: s.server.url }]);
  const plain = join(s.root, 'anywhere');
  await mkdir(plain, { recursive: true });
  const off = await s.fix([ID], ['n'], { cwd: plain });
  assert.equal(off.code, 1);
  assert.ok(off.said.includes(FIX_WORDS.noLink(shown(s.wt))), off.said);
  assert.ok(off.said.includes(`Run sonah hook add --repo ${shown(s.wt)} to turn that line on.`), off.said);
  assert.equal(off.said.includes(plain), false, 'the folder of this terminal is not the one named');
  // The one action the line gives is one this terminal can run, and the same command without the folder is not.
  const { HOOK_WORDS, runHookCommand } = await import('../src/agent-session-hook.js');
  const here = streams();
  assert.equal(await runHookCommand(['add'],
    { cwd: plain, stdout: here.stdout, stderr: here.stderr, git: s.git }), 2);
  assert.equal(here.chunks.stderr, `${HOOK_WORDS.problems.hook_not_git(plain)}\n`);
  const named = streams();
  assert.equal(await runHookCommand(['add', '--repo', s.wt],
    { cwd: plain, stdout: named.stdout, stderr: named.stderr, git: s.git }), 0, named.chunks.stderr);
  const on = await s.fix([ID], ['n'], { cwd: plain });
  assert.equal(on.code, 1);
  assert.equal(on.said.includes(FIX_WORDS.noLink(shown(s.wt))), false, on.said);
});

test("A9 reads the commit link as the person's git reads it: a core.hooksPath of their own config files",
  async (t) => {
    const s = await setup(t);
    const out = streams();
    const { runHookCommand } = await import('../src/agent-session-hook.js');
    assert.equal(await runHookCommand(['add', '--repo', s.wt],
      { cwd: s.wt, stdout: out.stdout, stderr: out.stderr, git: s.git }), 0, out.chunks.stderr);
    // A shared hooks folder that the person's own git config names, reached through GIT_CONFIG_GLOBAL (a dotfiles
    // home; XDG_CONFIG_HOME does the same): the git environment of this command's other calls keeps no such name, so
    // the line before the question would say the link is off where sonah doctor and sonah hook add say it is on.
    const shared = join(s.root, 'shared hooks');
    await mkdir(shared, { recursive: true });
    const hooks = s.repo.git(['rev-parse', '--git-path', 'hooks'], {}, s.wt);
    await rename(join(hooks, 'prepare-commit-msg'), join(shared, 'prepare-commit-msg'));
    const config = join(s.root, 'dotfiles gitconfig');
    await writeFile(config, `[core]\n\thooksPath = ${shared}\n`);
    const env = { ...s.env, GIT_CONFIG_GLOBAL: config };
    // git as this command runs it: each call in the environment the command gives that call
    const git = (dir, args, options = {}) => gitOut(dir, args, { ...options, env: options.env ?? env });
    const on = await s.fix([ID], ['n'], { env, git });
    assert.equal(on.code, 1);
    assert.equal(on.said.includes(FIX_WORDS.noLink(shown(s.wt))), false, on.said);
    assert.equal(on.said.includes(FIX_WORDS.linkNotChecked(shown(s.wt))), false, on.said);
  });

test("A9 where Sonah's line is in a hook file another tool owns: it says Sonah cannot tell, not that the line is off",
  async (t) => {
    const s = await setup(t);
    const out = streams();
    const { HOOK_LINE, commitLinkFacts, runHookCommand } = await import('../src/agent-session-hook.js');
    assert.equal(await runHookCommand(['add', '--repo', s.wt],
      { cwd: s.wt, stdout: out.stdout, stderr: out.stderr, git: s.git }), 0, out.chunks.stderr);
    // husky, lefthook or a prepare-commit-msg of your own: sonah hook add prints its line for you to add, and with
    // the line in that file D143 reads `not_checked`, which sonah doctor says asks nothing of you.
    const hooks = s.repo.git(['rev-parse', '--git-path', 'hooks'], {}, s.wt);
    await writeFile(join(hooks, 'prepare-commit-msg'), `#!/bin/sh\n# husky\n${HOOK_LINE}\n`);
    const facts = await commitLinkFacts(s.wt, { git: (d, a) => s.git(d, a) });
    assert.equal(facts.state, 'not_checked');
    assert.equal(facts.lineIn, join(hooks, 'prepare-commit-msg'), "the file that holds Sonah's own line");
    const r = await s.fix([ID], ['n']);
    assert.equal(r.code, 1);
    assert.ok(r.said.includes(FIX_WORDS.linkNotChecked(shown(s.wt))), r.said);
    assert.equal(r.said.includes(FIX_WORDS.noLink(shown(s.wt))), false, r.said);
    assert.ok(r.said.indexOf(FIX_WORDS.linkNotChecked(shown(s.wt))) < r.said.indexOf(FIX_WORDS.question));
  });

test("D229 review 3: A9 where the hook git runs is another tool's and holds no line of Sonah's: it asks for the line "
  + 'sonah hook add prints, as sonah doctor does of that state', async (t) => {
  const s = await setup(t);
  const out = streams();
  const { HOOK_WORDS, commitLinkFacts, commitLinkStatus, runHookCommand } = await import('../src/agent-session-hook.js');
  assert.equal(await runHookCommand(['add', '--repo', s.wt],
    { cwd: s.wt, stdout: out.stdout, stderr: out.stderr, git: s.git }), 0, out.chunks.stderr);
  // The other half of D143's `not_checked`: husky (or a prepare-commit-msg of your own) is the hook git runs, Sonah's
  // script is there from an earlier `sonah hook add`, and no line of Sonah's is in that file — the state `sonah hook
  // add` ends in whenever you did not add the line it printed.
  const hooks = s.repo.git(['rev-parse', '--git-path', 'hooks'], {}, s.wt);
  await writeFile(join(hooks, 'prepare-commit-msg'), '#!/bin/sh\n# husky\nnpx lint-staged\n');
  const facts = await commitLinkFacts(s.wt, { git: (d, a) => s.git(d, a) });
  assert.equal(facts.state, 'not_checked');
  assert.equal(facts.lineIn, null, "no line of Sonah's in the hook file");
  // `sonah doctor` asks for the line in this state, and asks nothing in the other one.
  assert.ok(commitLinkStatus(facts).line.endsWith(HOOK_WORDS.status.fix), commitLinkStatus(facts).line);
  const r = await s.fix([ID], ['n']);
  assert.equal(r.code, 1);
  assert.ok(r.said.includes(FIX_WORDS.linkAddLine(shown(s.wt))), r.said);
  assert.ok(r.said.includes(`Run sonah hook add --repo ${shown(s.wt)}, and add the line it prints.`), r.said);
  assert.equal(r.said.includes(FIX_WORDS.linkNotChecked(shown(s.wt))), false, r.said);
  assert.equal(r.said.includes(FIX_WORDS.noLink(shown(s.wt))), false, r.said);
  assert.ok(r.said.indexOf(FIX_WORDS.linkAddLine(shown(s.wt))) < r.said.indexOf(FIX_WORDS.question));
  // and once you add that line, Sonah says what it cannot tell and asks nothing
  const { HOOK_LINE } = await import('../src/agent-session-hook.js');
  await writeFile(join(hooks, 'prepare-commit-msg'), `#!/bin/sh\n# husky\nnpx lint-staged\n${HOOK_LINE}\n`);
  const added = await s.fix([ID], ['n']);
  assert.ok(added.said.includes(FIX_WORDS.linkNotChecked(shown(s.wt))), added.said);
  assert.equal(added.said.includes(FIX_WORDS.linkAddLine(shown(s.wt))), false, added.said);
});

test('a new session is given the Claude Code folder Sonah looked in, not a relative CLAUDE_CONFIG_DIR (D151)',
  async (t) => {
    const s = await setup(t);
    // `claudeFolders` resolves a relative CLAUDE_CONFIG_DIR against Sonah's own folder (claude-home.js), and Claude
    // Code runs in the worktree: as the person wrote it, it would name a folder inside the repository under review,
    // and a launch record of such a folder is one `claudeFolders` leaves out, so a second fix would start over.
    const env = { ...s.env, CLAUDE_CONFIG_DIR: relative(process.cwd(), s.cfg) };
    assert.equal(isAbsolute(env.CLAUDE_CONFIG_DIR), false, 'the person set a relative folder');
    const r = await s.fix([ID], ['y'], { env });
    assert.equal(r.code, 0, r.stderr);
    const [run] = await s.runs();
    assert.equal(run.argv[0], '--session-id', 'a new session');
    assert.equal(run.env.CLAUDE_CONFIG_DIR, s.cfg, 'the folder Sonah looked in, as D151 names it');
    assert.equal(JSON.parse(await readFile(launchPath(s.where, ID), 'utf8')).launches[0].configDir, s.cfg);
    // and the record is one the next fix of this comment reads: its session is the one forked
    await writeRecording(s.cfg, 'proj-wt', run.argv[1], { cwd: s.wt, from: '2026-11-08T12:00:00.000Z',
      to: '2026-11-08T12:00:01.000Z' });
    const second = await s.fix([ID], ['y'], { env });
    assert.equal(second.code, 0, second.stderr);
    assert.deepEqual((await s.runs())[1].argv.slice(0, 3), ['--resume', run.argv[1], '--fork-session']);
  });

test('C8 review 3: Claude Code starts with the shell\'s environment, an ANTHROPIC_API_KEY in it included, as PRIVACY '
  + 'says (team-privacy-docs.test.js holds the docs; the review of a push takes the key out, sonah fix does not)',
async (t) => {
  const s = await setup(t);
  const key = 'synthetic-key-of-the-shell';
  const r = await s.fix([ID], ['y'], { env: { ...s.env, ANTHROPIC_API_KEY: key } });
  assert.equal(r.code, 0, `${r.stderr}${r.said}`);
  const [run] = await s.runs();
  assert.equal(run.argv[0], '--session-id', 'a new session');
  assert.equal(run.env.ANTHROPIC_API_KEY, key, 'the key of the shell reaches Claude Code');
});

test('the reviewed range is read in the git environment of every other call here, not the one the person exports',
  async (t) => {
    const s = await setup(t);
    // a shell that exports GIT_DIR or GIT_WORK_TREE (a bare-repo dotfiles home, a git rebase --exec) would otherwise
    // have the range read against that repository instead of the worktree, and the session that wrote the change lost.
    const seen = [];
    const git = (dir, args, options = {}) => { seen.push(options.env ?? null); return s.git(dir, args, options); };
    const env = { ...s.env, GIT_DIR: join(s.root, 'elsewhere.git'), GIT_WORK_TREE: s.root };
    const plan = await planFix({ dir: s.wt, review: s.answer.review, item: s.answer.item, record: null, env,
      configDir: null, fresh: false, git });
    assert.ok(seen.length, 'it read the range');
    for (const passed of seen) {
      assert.equal(passed?.GIT_DIR, undefined, 'no git call of the range carries GIT_DIR');
      assert.equal(passed?.GIT_WORK_TREE, undefined, 'nor GIT_WORK_TREE');
      assert.equal(passed?.HOME, s.env.HOME, 'and HOME is still there');
    }
    assert.deepEqual([plan.kind, plan.why], ['new', 'not_here'], 'the range itself was read');
  });

// ---------- the cache, sonah fixes and sonah status ----------

test('the list is checked by shape: the repository and the counts whole, each entry alone, unknown fields left out',
  () => {
    const head = 'a'.repeat(40);
    const good = { repo: { owner: 'acme', name: 'widgets' }, total: 2, fixes: waitingList({ head }) };
    const list = checkList({ ...good, extra: 1, total: 9, fixes: [...good.fixes,
      { ...good.fixes[0], comment: { ...good.fixes[0].comment, by: '$(id)' } },
      { ...good.fixes[0], comment: { ...good.fixes[0].comment, first: 'two\nlines' } },
      { ...good.fixes[0], comment: { ...good.fixes[0].comment, first: `hidden${RLO}` } },
      { ...good.fixes[0], pr: { number: 12, branch: '-x' } },
      { ...good.fixes[0], state: 'pushed' }, 'nonsense'] }, { owner: 'ACME', name: 'Widgets' });
    assert.equal(list.fixes.length, 2);
    assert.equal(list.dropped, 6);
    assert.equal(list.total, 9);
    assert.deepEqual(list.fixes[0], { comment: good.fixes[0].comment, item: good.fixes[0].item,
      pr: good.fixes[0].pr, head, state: null });
    assert.equal(checkEntry({ ...good.fixes[0], surprise: 'x' }).surprise, undefined);
    assert.equal(checkList({ ...good, repo: { owner: 'acme', name: 'gadgets' } },
      { owner: 'acme', name: 'widgets' }), null);
    assert.equal(checkList({ ...good, total: 1 }, { owner: 'acme', name: 'widgets' }), null);
    assert.equal(checkList({ ...good, total: 101, fixes: Array(101).fill(good.fixes[0]) },
      { owner: 'acme', name: 'widgets' }), null);
    // a fix still waits when none was opened, or it was opened or launched; never once pushed or final
    for (const state of WAITING_STATES)
      assert.ok(state === null || (FIX_STATES.includes(state) && !FIX_FINAL_STATES.includes(state)));
    // the push hook's line reads the cache by branch, and leaves out what Claude Code is on
    assert.deepEqual(waitingOn({ fixes: list.fixes }, 'feature'), { count: 2, number: 12 });
    assert.deepEqual(waitingOn({ fixes: [{ ...list.fixes[0], pr: { number: null, branch: 'feature' } }] }, 'feature'),
      { count: 1, number: null });
    assert.equal(waitingOn({ fixes: list.fixes }, 'other'), null);
    const onIt = { at: list.fixes[0].comment.at, total: 2,
      fixes: [{ ...list.fixes[0], state: 'launched' }, list.fixes[1]] };
    assert.deepEqual(waitingOn(onIt, 'feature'), { count: 1, number: 12 });
    assert.equal(PRE_PUSH_WORDS.waiting(1, 'PR #12'), '1 comment waits for you on PR #12 (sonah fixes).');
    assert.equal(waitingCount(onIt), 1);
    assert.equal(waitingCount({ ...onIt, fixes: onIt.fixes.map((f) => ({ ...f, state: 'launched' })) }), 0);
  });

test('markLaunched: sonah fix marks its comment in the cache at once, so the lines stop counting it', async (t) => {
  const s = await setup(t);
  const connection = { server: s.server.url, login: PERSON.login };
  const list = checkList({ repo: { owner: 'acme', name: 'widgets' }, total: 2, fixes: waitingList({ head: s.head }) },
    { owner: 'acme', name: 'widgets' });
  assert.equal(await saveWaiting(s.where, connection, list), true);
  assert.equal(await markLaunched(s.where, connection, 'acme/widgets', ID), true);
  assert.equal(await markLaunched(s.where, connection, 'acme/widgets', ID), false, 'once');
  assert.equal(await markLaunched(s.where, connection, 'acme/gadgets', ID), false, 'another repository: nothing');
  assert.equal(await markLaunched(s.where, { server: s.server.url, login: 'hubot' }, 'acme/widgets', SECOND), false,
    'another login: nothing');
  const entry = (await s.waiting())['acme/widgets'];
  assert.deepEqual(entry.fixes.map((f) => f.state), ['launched', 'opened'], 'the other as it was');
  assert.equal(await mode(join(s.repo.env.SONAH_HOME, 'team', 'waiting.json')), 0o600);
});

test('fixes lists the comments that wait, keeps them in the cache, and status counts them with its command',
  async (t) => {
    const s = await setup(t);
    const list = waitingList({ head: s.head });
    list[0].item.title = `add throws${ESC}[2J on strings`;
    list[1].item.title = `clamp${RLO}`;
    s.server.fixes['acme/widgets'] = list;
    const r = await s.fixes();
    assert.equal(r.code, 0, r.stderr);
    assert.equal(r.stdout, ['2 comments wait for you on acme/widgets:', '',
      '  @ben asked on PR #12 · Must act: add throws\\u001b[2J on strings', '  Can add still take strings?',
      `  sonah fix ${ID}`, '', '  @cy overrode it on PR #12 · clamp\\u202e', `  sonah fix ${SECOND}`,
      ''].join('\n'));
    const call = s.server.calls.at(-1);
    assert.deepEqual([call.method, call.path, call.query, call.authorization],
      ['GET', '/api/fixes', { owner: 'acme', repo: 'widgets' }, `Bearer ${s.token}`]);

    const file = join(s.repo.env.SONAH_HOME, 'team', 'waiting.json');
    assert.equal(await mode(file), 0o600);
    const cached = await s.waiting();
    assert.deepEqual(Object.keys(cached), ['acme/widgets']);
    assert.equal(cached['acme/widgets'].total, 2);
    assert.deepEqual(cached['acme/widgets'].fixes.map((f) => f.comment.first),
      ['Can add still take strings?', null], 'only the first line of the words');
    assert.equal((await readFile(file, 'utf8')).includes(s.token), false, 'and never the token');

    const raw = (await s.fixes(['--json'])).stdout;
    assert.equal(raw.includes(RLO) || raw.includes(ESC), false, 'the JSON shows nothing hidden either');
    const parsed = JSON.parse(raw);
    assert.deepEqual(parsed.repo, { owner: 'acme', name: 'widgets' });
    assert.deepEqual(parsed.fixes.map((f) => f.item.title), [list[0].item.title, list[1].item.title],
      'and parses back the same');

    // D229 (amending D227's decision 14): the count of `sonah status` names the command that lists them
    const status = await s.status();
    assert.match(status.stdout, /^2 comments wait for you on acme\/widgets \(sonah fixes\)\.$/m);
    assert.deepEqual(JSON.parse((await s.status(['--json'])).stdout).waiting.map((w) => [w.repo, w.total, w.waiting]),
      [['acme/widgets', 2, 2]]);

    // a comment Claude Code is already on says so on its line
    s.server.fixes['acme/widgets'] = [{ ...list[0], state: 'launched' }];
    assert.ok((await s.fixes()).stdout.includes(`(${FIX_WORDS.onIt})`), 'the one Claude Code is on says so');

    s.server.fixes['acme/widgets'] = [];
    const empty = await s.fixes();
    assert.equal(empty.stdout, `${FIX_WORDS.none('acme/widgets')}\n`);
    assert.equal((await s.waiting())['acme/widgets'].total, 0, 'a refresh replaces its entry');
  });

test('fixes: the repository of this clone, else every clone with the push hook; its refusals and its exit codes',
  async (t) => {
    const s = await setup(t);
    assert.deepEqual(await repositoryOf(s.repo.work, { env: s.env, git: s.git }),
      { owner: 'acme', name: 'widgets' });
    // a folder in no clone of a repository, and no clone with the push hook: nothing to ask about
    const plain = join(s.root, 'anywhere');
    await mkdir(plain, { recursive: true });
    const none = await s.fixes([], { cwd: plain });
    assert.equal(none.code, 2);
    assert.equal(none.stderr, saidOf('fix_no_repository', [s.server.url]));
    assert.equal(s.server.calls.length, 0, 'and no call');

    // with the clone on the push hook's list, it lists that clone's repository from anywhere: one clone is one call,
    // its own, so the repository a fork's other remote names is not asked about and cannot lose the listing
    const { updateHooks } = await import('../src/team-home.js');
    const common = await realpath(join(s.repo.work, '.git'));
    await updateHooks(s.where, () => [{ common, server: s.server.url }]);
    s.repo.git(['remote', 'add', 'upstream', 'ssh://example.invalid/other/gadgets.git']);
    s.server.fixes['acme/widgets'] = [];
    const asked = s.server.calls.length;
    const listed = await s.fixes([], { cwd: plain });
    assert.equal(listed.code, 0, listed.stderr);
    assert.equal(listed.stdout, `${FIX_WORDS.none('acme/widgets')}\n`);
    assert.deepEqual(s.server.calls.slice(asked).map((c) => c.query),
      [{ owner: 'acme', repo: 'widgets' }], 'one call, of this clone\'s own repository');
    assert.deepEqual(await connectedRepositories(s.where, { env: s.env, git: s.git, server: s.server.url }),
      [{ owner: 'acme', name: 'widgets' }]);

    // an entry that is not of its shape is dropped and counted
    s.server.fixes['acme/widgets'] = [...waitingList({ head: s.head }), { comment: { id: 'nope' } }];
    const dropped = await s.fixes();
    assert.equal(dropped.code, 0);
    assert.equal(dropped.stderr, `${FIX_WORDS.dropped(1)}\n`);

    // an answer that is not of its shape at all, and a server that refuses the token
    s.server.once('GET', '/api/fixes', { status: 200, json: { repo: { owner: 'acme', name: 'gadgets' }, total: 0,
      fixes: [] } });
    const badList = await s.fixes();
    assert.equal(badList.code, 2);
    assert.equal(badList.stderr, saidOf('fix_bad_list', [s.server.url]));
    s.server.once('GET', '/api/fixes', { status: 401, json: { error: 'bad_token' } });
    const refused = await s.fixes();
    assert.equal(refused.code, 2);
    assert.match(refused.stderr, /no longer takes the token of this computer/);
    // the mark then stops the next one before it calls
    const after = await s.fixes();
    assert.equal(after.code, 2);
    assert.match(after.stderr, /no longer takes the token of this computer/);
    // the usage line
    const usage = await s.fixes(['--what']);
    assert.equal(usage.code, 2);
    assert.equal(usage.stderr, `sonah fixes: unknown option --what.\nusage: ${FIXES_USAGE}\n`);
  });

test('fixes and fix pass over a clone whose push hook is for another server', async (t) => {
  const s = await setup(t);
  // Two servers on one computer (the plan's risk 4): a clone hooked while this computer was connected to the other
  // server keeps that server in hooks.json, and a push of it is not reviewed on this connection either
  // (push-hook-run.js). The name of its repository is the other server's work, and never reaches this one.
  const theirs = join(s.root, 'client clone');
  s.repo.git(['clone', '-q', s.repo.work, theirs], {}, s.root);
  s.repo.git(['remote', 'set-url', 'origin', 'ssh://example.invalid/clientco/api.git'], {}, theirs);
  const { updateHooks } = await import('../src/team-home.js');
  const common = await realpath(join(theirs, '.git')), mine = await realpath(join(s.repo.work, '.git'));
  await updateHooks(s.where, () => [{ common, server: 'https://sonah.clientco.invalid' },
    { common: mine, server: s.server.url }]);
  s.server.fixes['acme/widgets'] = [];
  const plain = join(s.root, 'anywhere');
  await mkdir(plain, { recursive: true });
  const asked = s.server.calls.length;
  const listed = await s.fixes([], { cwd: plain });
  assert.equal(listed.code, 0, listed.stderr);
  assert.deepEqual(s.server.calls.slice(asked).map((c) => c.query), [{ owner: 'acme', repo: 'widgets' }],
    'one call, of the clone of this connection');
  assert.equal(listed.stdout.includes('clientco'), false, listed.stdout);
  assert.deepEqual(await connectedRepositories(s.where, { env: s.env, git: s.git, server: s.server.url }),
    [{ owner: 'acme', name: 'widgets' }]);

  // and the worktree is picked out of this connection's clones only: the review's branch checked out in the other
  // server's clone of the same repository is no second worktree to stop on
  s.repo.git(['remote', 'set-url', 'origin', PUSH_REMOTE], {}, theirs);
  s.repo.git(['checkout', '-q', 'feature'], {}, theirs);
  const found = await s.fix([ID], ['y'], { cwd: plain });
  assert.equal(found.code, 0, found.stderr);
  assert.equal((await s.runs())[0].cwd, s.wt, 'the worktree of the clone of this connection');
});

test('a refusal of these commands says a way on that they have: never --server, which neither takes', async (t) => {
  const s = await setup(t, { person: { login: 'octo', team: null, seat: null } });
  // In no team on the server: GET /api/fixes answers 403 not_member, and `sonah connect`'s own fix for a refusal
  // says to check --server, which neither of these commands takes. The server of their calls is the connection's.
  const notMine = await s.fixes();
  assert.equal(notMine.code, 2);
  assert.equal(notMine.stderr, `${TEAM_PROBLEM_WORDS.team_refused(s.server.url, 403, 'not_member')}\n`
    + `Fix: ${FIX_WORDS.notMemberFix(s.server.url)}\n`);
  s.server.once('GET', '/api/fixes', { status: 503, json: { error: 'busy' } });
  const down = await s.fixes();
  assert.equal(down.code, 2);
  assert.equal(down.stderr, `${TEAM_PROBLEM_WORDS.team_refused(s.server.url, 503, 'busy')}\n`
    + `Fix: ${FIX_WORDS.refusedFix}\n`);
  // `sonah fix` says the same of its own call, and starts nothing
  s.server.comments[ID] = 500;
  const one = await s.fix([ID], ['y']);
  assert.equal(one.code, 2);
  assert.equal(one.stderr, `${TEAM_PROBLEM_WORDS.team_refused(s.server.url, 500, 'refused')}\n`
    + `Fix: ${FIX_WORDS.refusedFix}\n`);
  for (const said of [notMine.stderr, down.stderr, one.stderr])
    assert.equal(said.includes('--server'), false, said);
  assert.deepEqual(await s.runs(), []);
});

test('the push hook says how many comments wait on a pushed branch, from the cache, with no network call', async (t) => {
  const s = await setup(t);
  const { updateHooks } = await import('../src/team-home.js');
  const common = await realpath(join(s.repo.work, '.git'));
  await updateHooks(s.where, () => [{ common, server: s.server.url }]);
  await saveWaiting(s.where, { server: s.server.url, login: PERSON.login },
    checkList({ repo: { owner: 'acme', name: 'widgets' }, total: 2, fixes: waitingList({ head: s.head }) },
      { owner: 'acme', name: 'widgets' }));
  const calls = s.server.calls.length;
  const lines = async (branch) => {
    const out = streams();
    await runPrePush(['origin', PUSH_REMOTE],
      { stdin: Readable.from([`refs/heads/${branch} ${s.head} refs/heads/${branch} ${'0'.repeat(40)}\n`]),
        stderr: out.stderr, env: s.env, cwd: s.repo.work, git: s.git, start: async () => false });
    return out.chunks.stderr;
  };
  assert.match(await lines('feature'), /^sonah: 2 comments wait for you on PR #12 \(sonah fixes\)\.$/m);
  assert.equal(/wait for you/.test(await lines('other')), false, 'another branch: no line');
  assert.equal(s.server.calls.length, calls, 'the hook made no network call');
  // a comment Claude Code is on is left out
  await markLaunched(s.where, { server: s.server.url, login: PERSON.login }, 'acme/widgets', ID);
  assert.match(await lines('feature'), /^sonah: 1 comment waits for you on PR #12 \(sonah fixes\)\.$/m);
  // another repository's cache says nothing of this one
  await rm(join(s.repo.env.SONAH_HOME, 'team', 'waiting.json'));
  await saveWaiting(s.where, { server: s.server.url, login: PERSON.login },
    checkList({ repo: { owner: 'acme', name: 'gadgets' }, total: 1, fixes: [waitingList({ head: s.head })[0]] },
      { owner: 'acme', name: 'gadgets' }));
  assert.equal(/wait for you/.test(await lines('feature')), false);
});

test("the upload's answers name the comments each session was opened to answer, from the launch records", async (t) => {
  const s = await setup(t);
  await writeRecording(s.cfg, 'proj-work', SESSION, { cwd: await realpath(s.repo.work) });
  assert.deepEqual([...await answersBySession(s.where, 'acme/widgets')], [], 'none before a fix');
  assert.equal((await s.fix([ID], ['y'])).code, 0);
  const session = (await s.runs())[0].argv[4];
  const answers = await answersBySession(s.where, 'acme/widgets');
  assert.deepEqual([...answers].map(([id, set]) => [id, [...set]]), [[session, [ID]]]);
  assert.deepEqual([...await answersBySession(s.where, 'acme/gadgets')], [], 'another repository: none');
  // the upload field itself, built as the push run and `sonah share` build it
  const { uploadSessions } = await import('../src/upload-sessions.js');
  const facts = { range: { base: s.base, head: s.head }, files: [{ path: 'math.js' }] };
  const built = await uploadSessions({ dir: s.wt, facts, answers, env: s.env, git: s.git,
    run: async (args, { cwd }) => {
      const text = await gitOut(cwd, args, { env: s.env });
      return text === null ? { ok: false, stdout: null } : { ok: true, stdout: Buffer.from(text, 'utf8') };
    } });
  assert.deepEqual(built, [{ id: SESSION, harness: 'claude-code', commits: [s.head], files: ['math.js'],
    answers: [] }], 'the session that wrote the change answers no comment of its own');
  const ours = await uploadSessions({ dir: s.wt, facts,
    answers: new Map([[SESSION, new Set([ID, SECOND])]]), env: s.env, git: s.git,
    run: async (args, { cwd }) => {
      const text = await gitOut(cwd, args, { env: s.env });
      return text === null ? { ok: false, stdout: null } : { ok: true, stdout: Buffer.from(text, 'utf8') };
    } });
  assert.deepEqual(ours[0].answers, [ID, SECOND].sort());
  // a file in the folder that is not a launch record is left out of the answers, and stops its own fix
  await writeFile(launchPath(s.where, SECOND), '{ not json\n', { mode: 0o600 });
  assert.deepEqual([...await answersBySession(s.where, 'acme/widgets')].map(([id]) => id), [session]);
  s.server.comments[SECOND] = fixAnswer({ base: s.base, head: s.head, server: s.server.url,
    comment: { id: SECOND } });
  const stopped = await s.fix([SECOND], ['y']);
  assert.equal(stopped.code, 2);
  assert.equal(stopped.stderr, saidOf('fix_record_unreadable', [launchPath(s.where, SECOND)]));
});

test('the launch records read are the newest files of the folder, whatever the names of the comments sort like',
  async (t) => {
    const s = await setup(t);
    await writeRecording(s.cfg, 'proj-work', SESSION, { cwd: await realpath(s.repo.work) });
    assert.equal((await s.fix([ID], ['y'])).code, 0);
    const session = (await s.runs())[0].argv[4];
    // LAUNCH_RECORDS_MAX older files of the folder, every name of them above this comment's: a comment's id is a
    // hash, so a bound on the last of the names would leave the fix just made out of the upload's answers.
    const folder = dirname(launchPath(s.where, ID));
    const before = new Date('2024-01-01T00:00:00Z');
    for (let i = 0; i < LAUNCH_RECORDS_MAX; i += 1) {
      const path = join(folder, `c_ff${i.toString(16).padStart(14, '0')}.json`);
      await writeFile(path, '{}\n', { mode: 0o600 });
      await utimes(path, before, before);
    }
    assert.equal((await readdir(folder)).length, LAUNCH_RECORDS_MAX + 1);
    const answers = await answersBySession(s.where, 'acme/widgets');
    assert.deepEqual([...answers].map(([id, set]) => [id, [...set]]), [[session, [ID]]],
      'the record of the fix just made is read');
  });

test('the entry: every problem has its words and its fix, and sonah fix in a pipe says it needs a terminal',
  async (t) => {
    for (const code of FIX_PROBLEMS) {
      assert.ok(FIX_WORDS.problem[code] !== undefined, code);
      assert.ok(FIX_WORDS.fix[code] !== undefined, code);
    }
    assert.deepEqual(Object.keys(FIX_WORDS.problem).sort(), [...FIX_PROBLEMS].sort());
    assert.deepEqual(Object.keys(FIX_WORDS.fix).sort(), [...FIX_PROBLEMS].sort());
    const s = await setup(t);
    // the real entry, with a pipe for its standard input: the refusal, not a question
    const piped = await runEntry(['fix', ID], { env: s.env, cwd: s.repo.work });
    assert.equal(piped.code, 2, piped.stderr);
    assert.equal(piped.stdout, '');
    assert.equal(piped.stderr, saidOf('fix_no_terminal'));
    // and `sonah fixes` through the entry
    s.server.fixes['acme/widgets'] = waitingList({ head: s.head });
    const listed = await runEntry(['fixes'], { env: s.env, cwd: s.repo.work });
    assert.equal(listed.code, 0, listed.stderr);
    assert.match(listed.stdout, /^2 comments wait for you on acme\/widgets:$/m);
    assert.match(listed.stdout, new RegExp(`^ {2}sonah fix ${ID}$`, 'm'));
    assert.deepEqual((await readdir(join(s.repo.env.SONAH_HOME, 'team'))).sort(),
      ['connection.json', 'waiting.json'], 'the list it read, and nothing else');
  });
