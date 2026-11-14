// D226: a graphs page's drawing that is safe to run in the background. `drawVisualPage`'s deadline stops the calls
// still running, and the folder's lock (visual-lock.js) lets one drawer at a time draw a folder: taken and released on
// every way out, a second drawer stopped with `folder_in_use`, a lock whose process is gone (or whose id came back to
// another process) taken back. On a synthetic git repository in a temp folder, with
// packages/visual/test/fake-claude.mjs as `claude` first on PATH; SONAH_HOME and HOME are temp folders, and nothing
// reaches a network or a real model.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFile, execFileSync, spawn, spawnSync } from 'node:child_process';
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync,
  writeFileSync } from 'node:fs';
import { link } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { extract } from '../../visual/src/extract.mjs';
import { functionRequests, storyRequest, findingsRequest, mapAnswerIds, STORY_SYSTEM, FINDINGS_SYSTEM }
  from '../../visual/src/requests.mjs';
import { checkFunctions } from '../../visual/src/checks.mjs';
import { VISUAL_WORDS, drawVisualPage, visualFixOf } from '../src/visual-command.js';
import { VISUAL_LOCK_FILE, VISUAL_LOCK_WORDS, lockHeld, processStart, statStart, takeVisualLock }
  from '../src/visual-lock.js';
import { REVIEW_GRAPHS_WORDS, reviewGraphsPage } from '../src/review-graphs.js';

const exec = promisify(execFile);
const BIN = fileURLToPath(new URL('../bin/sonah.js', import.meta.url));
const FAKE = fileURLToPath(new URL('../../visual/test/fake-claude.mjs', import.meta.url));
const LOCK_MODULE = new URL('../src/visual-lock.js', import.meta.url).href;
const CHANGELOG = fileURLToPath(new URL('../../../CHANGELOG.md', import.meta.url));
const BASE_PATH = `${dirname(process.execPath)}:/usr/bin:/bin`;
const POSIX = process.platform !== 'win32';
const firstLine = (s) => s.split('\n')[0];

let scratch, repo, bin, base, head, facts;

const git = (args, cwd = repo) => execFileSync('git', args, { cwd, encoding: 'utf8', env: { PATH: BASE_PATH,
  HOME: scratch, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: join(scratch, 'no-git-config'), LC_ALL: 'C',
  GIT_AUTHOR_NAME: 'Test', GIT_AUTHOR_EMAIL: 'test@example.com', GIT_AUTHOR_DATE: '2026-01-02T03:04:05Z',
  GIT_COMMITTER_NAME: 'Test', GIT_COMMITTER_EMAIL: 'test@example.com', GIT_COMMITTER_DATE: '2026-01-02T03:04:05Z' } })
  .trim();

before(async () => {
  scratch = realpathSync(mkdtempSync(join(tmpdir(), 'sonah d226 ')));
  writeFileSync(join(scratch, 'no-git-config'), '');
  repo = join(scratch, 'widget');
  mkdirSync(join(repo, 'src'), { recursive: true });
  git(['init', '-q', '-b', 'main']);
  writeFileSync(join(repo, 'src', 'calc.js'), ['export function add(a, b) {', '  return a + b;', '}', ''].join('\n'));
  git(['add', '.']);
  git(['commit', '-q', '-m', 'Add the calculator']);
  base = git(['rev-parse', 'HEAD']);
  writeFileSync(join(repo, 'src', 'calc.js'), ['export function add(a, b) {',
    '  if (typeof a !== \'number\' || typeof b !== \'number\') throw new TypeError(\'add takes numbers\');',
    '  return a + b;', '}', ''].join('\n'));
  git(['commit', '-q', '-am', 'Check the inputs']);
  head = git(['rev-parse', 'HEAD']);
  bin = join(scratch, 'bin');
  mkdirSync(bin);
  copyFileSync(FAKE, join(bin, 'claude'));
  chmodSync(join(bin, 'claude'), 0o755);
  facts = await extract({ repoDir: repo, base, head });
});
after(() => rmSync(scratch, { recursive: true, force: true }));

// Answers a stand-in would give, built from the requests and the facts (as visual-command.test.js does); `extra` is
// merged into each rule (a mode and its time).
function standInRules(extra = {}) {
  const fnReqs = functionRequests(facts);
  const functionsAnswer = (req) => ({ functions: Object.keys(req.ids).map((id) => ({ id,
    summary: 'Does its part of the change.', change: 'Changes what this part does in the new version.' })) });
  const fnRecords = fnReqs.map((r) => ({ id: r.id, kind: r.kind, answer: mapAnswerIds(r, functionsAnswer(r)),
    error: null }));
  const story = storyRequest(facts, checkFunctions(facts, fnRecords).value);
  const short = Object.fromEntries(Object.entries(story.ids).map(([s, stable]) => [stable, s]));
  const fns = facts.functions.filter((f) => f.fold == null).slice(0, 3).map((f) => short[f.id]);
  const steps = [{ id: 's1', label: 'A caller starts it', fn: null, ext: 'caller', was: null, isNew: false },
    ...fns.map((fn, i) => ({ id: `s${i + 2}`, label: `Step ${i + 1} runs`, fn, ext: null,
      was: i === 0 ? 'ran the old way' : null, isNew: i < 2 }))];
  const edges = steps.slice(1).map((s, i) => ({ from: steps[i].id, to: s.id, label: null, kind: 'main' }));
  const storyAnswer = { oneLine: 'The change checks the inputs.', ask: 'Make the program behave as the commit says.',
    beforeNow: [{ before: 'It worked the old way.', now: 'It works the new way.' }],
    flows: [{ title: 'One call through the change', steps, edges }], glossary: [] };
  const findings = findingsRequest(facts);
  const byId = new Map(facts.functions.map((f) => [f.id, f]));
  const [fnShort, row] = Object.entries(findings.ids).map(([s, stable]) => [s, byId.get(stable)?.diff
    ?.find((r) => r[0] === '+' && r[3].trim().length >= 8)]).find(([, r]) => r);
  const findingsAnswer = { findings: [{ tier: 'must-know', title: 'A consequence a reviewer should know',
    oneLine: 'When this line runs, the new path is taken.', fns: [fnShort],
    quote: row[3].trim().slice(0, 60).trim() }] };
  return [
    ...fnReqs.map((r) => ({ when: r.prompt.split('\n').at(-1), text: JSON.stringify(functionsAnswer(r)), ...extra })),
    { when: firstLine(STORY_SYSTEM), text: JSON.stringify(storyAnswer), ...extra },
    { when: firstLine(FINDINGS_SYSTEM), text: JSON.stringify(findingsAnswer), ...extra },
  ];
}

let boxes = 0;
/** A fresh HOME and SONAH_HOME with the stand-in's rules, the env of a drawing, its folder, and the stand-in's call log
 *  and slow processes. */
function box(rules) {
  const home = join(scratch, `box ${++boxes}`);
  mkdirSync(home);
  writeFileSync(join(home, 'fake-claude.json'), JSON.stringify({ rules }));
  const read = (name) => (existsSync(join(home, name)) ? readFileSync(join(home, name), 'utf8') : '');
  return { home, sonah: join(home, '.sonah'), out: join(home, 'page folder'),
    env: { HOME: home, SONAH_HOME: join(home, '.sonah'), PATH: `${bin}:${BASE_PATH}` },
    calls: () => read('fake-claude.log.jsonl').split('\n').filter(Boolean).length,
    pids: () => read('fake-claude.pids').split('\n').filter(Boolean).map(Number) };
}
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));
async function until(ready, what = 'a condition') {
  for (let i = 0; i < 300; i++) {
    const value = ready();
    if (value) return value;
    await sleep(50);
  }
  throw new Error(`${what}: not after 15 s`);
}
const runs = (pid) => { try { process.kill(pid, 0); return true; } catch (error) { return error.code === 'EPERM'; } };
/** The folder's own files: none of the lock's may be left once a drawing ends. */
const lockFiles = (folder) => readdirSync(folder).filter((name) => name.includes(VISUAL_LOCK_FILE));
const lockBytes = (lock) => `${JSON.stringify({ v: 1, ...lock })}\n`;
/** A process id that no process has now: a process that ran and ended. */
const deadPid = () => spawnSync(process.execPath, ['-e', '']).pid;
/** A start that no process here has: one tick after boot, or no date at all. */
const ANOTHER_START = '1';
/** The claim of the file at `path` whose bytes are `bytes`, as visual-lock.js names it. */
const claimOf = (path, bytes) => `${path}.claim-${createHash('sha256').update(bytes).digest('hex').slice(0, 16)}`;
/** The first line a child writes on its stdout. */
const firstSaid = (child) => new Promise((done) => { let said = ''; child.stdout.on('data', (c) => { said += c;
  if (said.includes('\n')) done(said.split('\n')[0]); }); });

/** A node process that runs until killed and says when it started, as its own lock would record it. */
async function runningProcess(t) {
  const child = spawn(process.execPath, ['--input-type=module', '-e', `import { processStart } from ${
    JSON.stringify(LOCK_MODULE)};
    process.stdout.write(JSON.stringify(await processStart(process.pid)) + '\\n'); setInterval(() => {}, 1000);`],
  { stdio: ['ignore', 'pipe', 'ignore'] });
  t.after(() => child.kill('SIGKILL'));
  return { pid: child.pid, start: JSON.parse(await firstSaid(child)) };
}

/** A process that takes the lock of `folder` and holds it until killed: its `{ pid, start }`. With `late`, its node
 *  begins that many seconds after its process (a shell that sleeps, then becomes node: a slow start of node). */
async function lockHolder(t, folder, late = 0) {
  const script = `import { takeVisualLock } from ${JSON.stringify(LOCK_MODULE)};
    const taken = await takeVisualLock(${JSON.stringify(folder)});
    process.stdout.write(taken.release ? 'held\\n' : 'not held\\n'); setInterval(() => {}, 1000);`;
  const options = { stdio: ['ignore', 'pipe', 'inherit'] };
  const child = late
    ? spawn('/bin/sh', ['-c', `sleep ${late}; exec "$0" --input-type=module -e "$1"`, process.execPath, script],
      options)
    : spawn(process.execPath, ['--input-type=module', '-e', script], options);
  t.after(() => child.kill('SIGKILL'));
  assert.equal(await firstSaid(child), 'held');
  const { pid, start } = JSON.parse(readFileSync(join(folder, VISUAL_LOCK_FILE), 'utf8'));
  assert.equal(pid, child.pid);
  return { pid, start };
}

/** The entry with `args` in the repository, as one drawer. */
async function sonah(args, where) {
  const options = { cwd: repo, timeout: 120_000, killSignal: 'SIGKILL', env: { ...where.env,
    SONAH_NO_UPDATE_CHECK: '1' } };
  try { const r = await exec(process.execPath, [BIN, ...args], options); return { code: 0, ...r }; }
  catch (e) { return { code: e.killed ? 'timeout' : e.code, stdout: e.stdout ?? '', stderr: e.stderr ?? '' }; }
}

test('D226: with no deadline, a drawing completes as before, and its folder keeps no lock file', async () => {
  const where = box(standInRules());
  const drawn = await drawVisualPage({ top: repo, base, head, outDir: where.out, env: where.env });
  assert.equal(drawn.status, 'complete', JSON.stringify(drawn));
  assert.deepEqual(lockFiles(where.out), []);
  assert.ok(where.calls() >= 2);
});

test('D226: the deadline stops the calls still running: the drawing ends `timeout`, each claude ended, the lock '
  + 'released', { timeout: 60_000 }, async () => {
  const where = box(standInRules({ mode: 'slow', ms: 60_000 }));
  const started = Date.now();
  const drawn = await drawVisualPage({ top: repo, base, head, outDir: where.out, env: where.env,
    deadline: started + 4000 });
  const took = Date.now() - started;
  assert.deepEqual({ status: drawn.status, code: drawn.code }, { status: 'failed', code: 'timeout' });
  assert.ok(took >= 3500 && took < 12_000, `it ends at the deadline (${took} ms)`);
  // Each call that ran was stopped at the deadline; those asked after it started no claude.
  const pids = where.pids();
  assert.ok(pids.length >= 1, 'a call was running at the deadline');
  assert.equal(where.calls(), pids.length, 'no claude started after the deadline');
  for (const pid of pids) await until(() => !runs(pid), `stand-in ${pid} ended`);
  const run = JSON.parse(readFileSync(join(where.out, 'run.json'), 'utf8'));
  assert.ok(run.requests.length >= 1 && run.requests.every((r) => r.error === 'timeout'), JSON.stringify(run.requests));
  assert.equal(existsSync(join(where.out, 'page.html')), false);
  assert.deepEqual(lockFiles(where.out), []);
});

test('D226: the lock is released when the drawing fails, and when its signal stops a call still running',
  { timeout: 60_000 }, async () => {
  // A call that stops the job on the account.
  const failing = box([{ mode: 'auth' }]);
  const failed = await drawVisualPage({ top: repo, base, head, outDir: failing.out, env: failing.env });
  assert.deepEqual({ status: failed.status, code: failed.code }, { status: 'failed', code: 'auth' });
  assert.deepEqual(lockFiles(failing.out), []);
  // Ctrl-C or SIGTERM while a call runs (D219's signal): the call stops at once, the drawing ends, the lock goes.
  const slow = box(standInRules({ mode: 'slow', ms: 60_000 }));
  const stop = new AbortController();
  const started = Date.now();
  const drawing = drawVisualPage({ top: repo, base, head, outDir: slow.out, env: slow.env, signal: stop.signal });
  const [pid] = await until(() => slow.pids().length && slow.pids(), 'a call runs');
  assert.ok(existsSync(join(slow.out, VISUAL_LOCK_FILE)), 'the lock is held while it draws');
  stop.abort();
  const drawn = await drawing;
  assert.deepEqual({ status: drawn.status, code: drawn.code }, { status: 'failed', code: 'call_failed' });
  assert.ok(Date.now() - started < 10_000);
  assert.equal(runs(pid), false, 'the stand-in ended');
  assert.deepEqual(lockFiles(slow.out), []);
});

test('D226: a process that exits while it holds a lock removes it; one that is killed leaves it, and it is taken back',
  { skip: !POSIX, timeout: 60_000 }, async () => {
  const where = box([]);
  mkdirSync(where.out);
  const holder = (how) => `import { takeVisualLock } from ${JSON.stringify(LOCK_MODULE)};
    const taken = await takeVisualLock(${JSON.stringify(where.out)});
    if (!taken.release) process.exit(9);
    process.stdout.write('held\\n');
    process.stdin.once('data', () => ${how});`;
  for (const [how, left] of [['process.exit(0)', false], ['process.kill(process.pid, "SIGKILL")', true]]) {
    const child = spawn(process.execPath, ['--input-type=module', '-e', holder(how)],
      { stdio: ['pipe', 'pipe', 'inherit'] });
    const ended = new Promise((done) => child.once('exit', done));
    await new Promise((done) => child.stdout.once('data', done));
    assert.ok(existsSync(join(where.out, VISUAL_LOCK_FILE)));
    const { pid, start } = JSON.parse(readFileSync(join(where.out, VISUAL_LOCK_FILE), 'utf8'));
    assert.deepEqual(await takeVisualLock(where.out), { holder: { pid, start } }, 'held by a running process');
    child.stdin.end('go\n');
    await ended;
    assert.equal(existsSync(join(where.out, VISUAL_LOCK_FILE)), left, how);
  }
  // The killed one's lock names a process that is gone: the next drawer takes it back.
  const taken = await takeVisualLock(where.out);
  assert.equal(typeof taken.release, 'function');
  assert.deepEqual(JSON.parse(readFileSync(join(where.out, VISUAL_LOCK_FILE), 'utf8')),
    { v: 1, pid: process.pid, start: await processStart(process.pid) });
  await taken.release();
  await taken.release();
  assert.deepEqual(lockFiles(where.out), []);
});

test('D226: two sonah visual on one folder: the second stops at once with folder_in_use (exit 2) and writes nothing',
  { timeout: 120_000 }, async () => {
  const where = box(standInRules({ mode: 'slow', ms: 1500 }));
  const first = sonah(['visual', `${base}..${head}`, '--out', where.out], where);
  await until(() => existsSync(join(where.out, VISUAL_LOCK_FILE)), 'the first takes the lock');
  const holder = JSON.parse(readFileSync(join(where.out, VISUAL_LOCK_FILE), 'utf8'));
  const calls = where.calls();
  const second = await sonah(['visual', `${base}..${head}`, '--out', where.out], where);
  assert.equal(second.code, 2, second.stderr);
  assert.equal(second.stdout, '');
  assert.equal(second.stderr, `${VISUAL_WORDS.failed('folder_in_use', VISUAL_LOCK_WORDS.folder_in_use)}\n`);
  assert.equal(visualFixOf('folder_in_use'), VISUAL_LOCK_WORDS.folder_in_use);
  assert.ok(where.calls() >= calls);
  assert.deepEqual(JSON.parse(readFileSync(join(where.out, VISUAL_LOCK_FILE), 'utf8')), holder,
    'the first one\'s lock is untouched');
  const done = await first;
  assert.equal(done.code, 0, done.stderr);
  assert.match(done.stdout, /^Local page: /m);
  assert.deepEqual(lockFiles(where.out), []);
  // Once the first has ended, the same command replays its answers: no new call.
  const made = where.calls();
  const again = await sonah(['visual', `${base}..${head}`, '--out', where.out], where);
  assert.equal(again.code, 0, again.stderr);
  assert.equal(where.calls(), made);
  // In one process too: two drawings of one folder at once, the second stopped before it writes anything.
  const twice = box(standInRules({ mode: 'slow', ms: 1000 }));
  const one = drawVisualPage({ top: repo, base, head, outDir: twice.out, env: twice.env });
  await until(() => existsSync(join(twice.out, VISUAL_LOCK_FILE)), 'the first takes the lock');
  let started = false;
  const other = await drawVisualPage({ top: repo, base, head, outDir: twice.out, env: twice.env,
    onStart: () => { started = true; } });
  assert.deepEqual(other, { status: 'failed', code: 'folder_in_use' });
  assert.equal(started, false);
  assert.equal((await one).status, 'complete');
  assert.deepEqual(lockFiles(twice.out), []);
});

test('D226: the review\'s graphs page prints the lock\'s problem and fix; its page says Sonah could not finish it',
  async () => {
  let err = '';
  const start = 'a'.repeat(40), end = 'b'.repeat(40);
  const fact = await reviewGraphsPage({ options: {}, backend: 'claude-cli', repo: { start, head: end, atHead: ['x.js'],
    goneAtHead: [] }, codePass: { files: [{ path: 'x.js', state: 'reviewed' }] },
  snapshot: { root: true, repository: true, top: '/nowhere' }, env: { SONAH_HOME: '/nowhere' },
  stdout: { write: () => assert.fail('no stdout') }, stderr: { write: (text) => { err += text; } },
  draw: async () => ({ status: 'failed', code: 'folder_in_use' }) });
  const range = `${start.slice(0, 12)}..${end.slice(0, 12)}`;
  assert.deepEqual(fact, { graphsNotDrawn: { code: 'failed', range, failure: 'other' } });
  const mark = REVIEW_GRAPHS_WORDS.mark;
  assert.equal(err, `${mark} Visual review could not complete: folder_in_use.\n${mark} Fix: `
    + `${VISUAL_LOCK_WORDS.folder_in_use}\n${REVIEW_GRAPHS_WORDS.again(range)}\n`);
});

test('D226: a stale lock is taken back: its process ended, its id came back to another process or to this one, or its '
  + 'bytes are not a lock\'s; a running holder\'s is not', { skip: !POSIX, timeout: 60_000 }, async (t) => {
  const where = box([]);
  mkdirSync(where.out);
  const path = join(where.out, VISUAL_LOCK_FILE);
  const live = await runningProcess(t);
  // The start another process reads is the one the process records for itself.
  assert.equal(typeof live.start, 'string');
  assert.equal(await processStart(live.pid), live.start);
  assert.notEqual(live.start, ANOTHER_START);
  assert.equal(await processStart(deadPid()), null);
  const stale = [
    ['its process ended', lockBytes({ pid: deadPid(), start: live.start })],
    ['its id came back to another process', lockBytes({ pid: live.pid, start: ANOTHER_START })],
    ['its id is this process\'s, from an earlier one', lockBytes({ pid: process.pid, start: ANOTHER_START })],
    ['a start that is not a text', lockBytes({ pid: live.pid, start: 1 })],
    ['bytes of another shape', 'not a lock\n'],
    ['an empty file', ''],
    ['a lock with no version', `${JSON.stringify({ pid: live.pid, start: live.start })}\n`],
  ];
  for (const [why, bytes] of stale) {
    writeFileSync(path, bytes);
    const taken = await takeVisualLock(where.out);
    assert.equal(typeof taken.release, 'function', why);
    assert.equal(JSON.parse(readFileSync(path, 'utf8')).pid, process.pid, why);
    await taken.release();
    assert.deepEqual(lockFiles(where.out), [], why);
  }
  // A claim left by a drawer that ended while it took a lock back does not keep the folder locked.
  const left = lockBytes({ pid: deadPid(), start: live.start });
  writeFileSync(path, left);
  writeFileSync(claimOf(path, left), lockBytes({ pid: deadPid(), start: live.start }));
  const after = await takeVisualLock(where.out);
  assert.equal(typeof after.release, 'function');
  await after.release();
  assert.deepEqual(lockFiles(where.out), []);
  // A running process that started when its lock says holds it, also in a later version's lock: nothing is taken
  // back, and the drawing stops.
  writeFileSync(path, `${JSON.stringify({ v: 2, pid: live.pid, start: live.start, more: true })}\n`);
  assert.deepEqual(await takeVisualLock(where.out), { holder: { pid: live.pid, start: live.start } });
  writeFileSync(path, lockBytes(live));
  assert.deepEqual(await takeVisualLock(where.out), { holder: { pid: live.pid, start: live.start } });
  assert.deepEqual(await drawVisualPage({ top: repo, base, head, outDir: where.out, env: where.env }),
    { status: 'failed', code: 'folder_in_use' });
  assert.equal(readFileSync(path, 'utf8'), lockBytes(live));
  // Where Sonah cannot read a start (Windows, no ps), a running process holds its lock.
  assert.equal(await lockHeld({ pid: live.pid, start: ANOTHER_START }, { startOf: async () => null }), true);
  assert.equal(await lockHeld({ pid: deadPid(), start: ANOTHER_START }, { startOf: async () => null }), false);
  // A process that could not read its own start (it records null) holds its lock while it runs.
  assert.equal(await lockHeld({ pid: live.pid, start: null }), true);
  assert.equal(await lockHeld({ pid: deadPid(), start: null }), false);
  // Its process gone, the drawing takes it back and draws.
  writeFileSync(path, lockBytes({ pid: deadPid(), start: live.start }));
  const rules = box(standInRules());
  writeFileSync(join(where.home, 'fake-claude.json'), readFileSync(join(rules.home, 'fake-claude.json')));
  const drawn = await drawVisualPage({ top: repo, base, head, outDir: where.out, env: where.env });
  assert.equal(drawn.status, 'complete', JSON.stringify(drawn));
  assert.deepEqual(lockFiles(where.out), []);
});

// D226's review (2026-11-11).
test('D226 review: a running holder keeps its lock when the wall clock moves while it draws, and when its node began '
  + 'seconds after its process', { skip: !POSIX, timeout: 60_000 }, async (t) => {
  const moved = box([]);
  const late = box([]);
  mkdirSync(moved.out);
  mkdirSync(late.out);
  // Its shell sleeps 6 s before node begins: more than the 5 s by which a start Sonah reckoned from node's own clock
  // could differ.
  const lateHolder = lockHolder(t, late.out, 6);
  const holder = await lockHolder(t, moved.out);
  // The wall clock set 10 minutes on after the holder took its lock (a virtual machine's clock set after its host
  // slept, a clock stepped by its time service or by hand), while the time the process has run, as Linux counts it
  // from boot, did not move: the start Sonah reads is still the one the lock records.
  const now = Date.now;
  Date.now = () => now() + 600_000;
  try { assert.deepEqual(await takeVisualLock(moved.out), { holder }); }
  finally { Date.now = now; }
  const slow = await lateHolder;
  assert.deepEqual(await takeVisualLock(late.out), { holder: slow });
  assert.equal(await lockHeld(slow), true);
  for (const [folder, lock] of [[moved.out, holder], [late.out, slow]]) {
    assert.deepEqual(JSON.parse(readFileSync(join(folder, VISUAL_LOCK_FILE), 'utf8')), { v: 1, ...lock });
    assert.deepEqual(lockFiles(folder), [VISUAL_LOCK_FILE]);
  }
});

test('D226 review: the start of a process on Linux is the 22nd field of /proc/<pid>/stat, read after its name',
  () => {
  const fields = (name) => `4242 (${name}) S 1 4242 4242 0 -1 4194560 812 0 0 0 3 1 0 0 20 0 1 0 987654 12345678 900`;
  assert.equal(statStart(fields('node')), '987654');
  assert.equal(statStart(fields('a) b (c')), '987654');
  assert.equal(statStart(fields('')), '987654');
  for (const other of ['', 'no fields', '4242 (node) S 1 2', fields('node').replace('987654', '-1')]) {
    assert.equal(statStart(other), null, other);
  }
});

test('D226 review: a claim is published whole as the lock is, and nobody removes another drawer\'s claim but under a '
  + 'claim of its own: one still being written, or one another drawer is taking back, is left', { skip: !POSIX },
async (t) => {
  const where = box([]);
  mkdirSync(where.out);
  const path = join(where.out, VISUAL_LOCK_FILE);
  const live = await runningProcess(t);
  const stale = lockBytes({ pid: deadPid(), start: live.start });
  const claim = claimOf(path, stale);
  // The claim goes into place by a hard link, complete, as the lock does.
  writeFileSync(path, stale);
  const linked = [];
  const taken = await takeVisualLock(where.out, { link: async (from, to) => { linked.push(to); return link(from, to); }
  });
  assert.equal(typeof taken.release, 'function');
  assert.deepEqual(linked, [path, claim, path]);
  await taken.release();
  assert.deepEqual(lockFiles(where.out), []);
  const dead = lockBytes({ pid: deadPid(), start: live.start });
  for (const [why, claims] of [
    // A claim with no record in it yet: a drawer between its creation and its write, where the file system has no hard
    // links. Removing it would let that drawer and this one both take the lock back.
    ['a claim still being written', { [claim]: '' }],
    // A claim that a drawer that ended left, which another drawer, running, is taking back now under its own claim.
    ['a dead drawer\'s claim that another drawer is taking back',
      { [claim]: dead, [claimOf(claim, dead)]: lockBytes(live) }],
  ]) {
    writeFileSync(path, stale);
    for (const [at, bytes] of Object.entries(claims)) writeFileSync(at, bytes);
    assert.deepEqual(await takeVisualLock(where.out), { holder: null }, why);
    assert.deepEqual(await drawVisualPage({ top: repo, base, head, outDir: where.out, env: where.env }),
      { status: 'failed', code: 'folder_in_use' }, why);
    assert.equal(readFileSync(path, 'utf8'), stale, why);
    for (const [at, bytes] of Object.entries(claims)) assert.equal(readFileSync(at, 'utf8'), bytes, why);
    assert.equal(lockFiles(where.out).length, 1 + Object.keys(claims).length, why);
    for (const at of [path, ...Object.keys(claims)]) rmSync(at);
  }
});

test('D226 review: where the folder has no hard links, a lock with no bytes yet is one a drawer is about to write, and '
  + 'is left', { skip: !POSIX }, async () => {
  const where = box([]);
  mkdirSync(where.out);
  const path = join(where.out, VISUAL_LOCK_FILE);
  const noLinks = { link: async () => {
    throw Object.assign(new Error('operation not supported'), { code: 'ENOTSUP' });
  } };
  writeFileSync(path, '');
  assert.deepEqual(await takeVisualLock(where.out, noLinks), { holder: null });
  assert.equal(readFileSync(path, 'utf8'), '');
  assert.deepEqual(lockFiles(where.out), [VISUAL_LOCK_FILE]);
  // Bytes of another shape are no drawer's: taken back there too.
  writeFileSync(path, 'not a lock\n');
  const there = await takeVisualLock(where.out, noLinks);
  assert.equal(typeof there.release, 'function');
  assert.equal(JSON.parse(readFileSync(path, 'utf8')).pid, process.pid);
  await there.release();
  // Where it has hard links, nobody writes a lock in place: one with no bytes was left by a crash, and is taken back.
  writeFileSync(path, '');
  const linked = await takeVisualLock(where.out);
  assert.equal(typeof linked.release, 'function');
  await linked.release();
  assert.deepEqual(lockFiles(where.out), []);
});

test('D226 review: the release note gives exit 2 to sonah visual and plain sonah, and the review keeps its own exit '
  + 'code', () => {
  const notes = readFileSync(CHANGELOG, 'utf8');
  // The CHANGELOG's first section: Unreleased, or the version D226 ships in (C8: 0.3.0-beta.17).
  const from = notes.indexOf('\n## ') + 1;
  assert.ok(from > 0 && /^## (?:Unreleased|0\.3\.0-beta\.17 )/.test(notes.slice(from)), notes.slice(from, from + 40));
  const paragraph = notes.slice(from, notes.indexOf('\n## ', from)).split('\n\n').map((p) => p.replace(/\s+/g, ' '))
    .find((p) => p.includes('folder_in_use'));
  assert.ok(paragraph, 'the note on folder_in_use');
  const exitsTwo = paragraph.split('; ').find((clause) => clause.includes('exits `2`'));
  assert.ok(exitsTwo && exitsTwo.includes('`sonah visual`') && !exitsTwo.includes('sonah review'), exitsTwo);
  assert.ok(paragraph.includes('`Graphs page: `'), paragraph);
  assert.ok(paragraph.includes('the review keeps its own exit code'), paragraph);
});
