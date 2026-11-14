// D227 (item 10, C4): the push run. A push in a repository with Sonah's push hook starts `sonah push-run` in the
// background, at low priority; it waits for the remote to show the commit, probes the server with GET /api/fixes, draws
// the branch's page with `drawVisualPage` (the stand-in claude, packages/visual/test/fake-claude.mjs) and uploads it
// with its `sessions` to POST /api/uploads; `sonah status` shows each run. Ported from sonah-hosted
// test/client/run.test.js (its 5 tests: the PR's base becomes the remote's default branch, decision 8) and
// test/client/sessions.test.js (the 2 that the push run covers: the field, and an agent's commit named in an upload; the
// other 2 test the private client's offer of D143's commit link, which D143's and D225's tests cover here), plus the
// plan's additions. Real git in throwaway repositories under a sealed HOME and SONAH_HOME with spaces in their paths,
// whose push remote ssh://example.invalid/acme/widgets.git a stand-in for ssh serves (team-helpers.js `pushRepo`); a
// stand-in Sonah Team server on 127.0.0.1; time limits shortened only by the test variables. Every runner and claude
// stand-in a test leaves is stopped before its folder goes (team-helpers.js `stopRuns`). No model, no network.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { chmod, mkdir, readFile, readdir, realpath, rm, stat, utimes, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PUSH_RUN_REASONS, PUSH_RUN_STATES } from '../../evidence/src/ledger.js';
import { FINDINGS_SYSTEM, STORY_SYSTEM, findingsRequest } from '../../visual/src/requests.mjs';
import { extract } from '../../visual/src/extract.mjs';
import { SESSION_HARNESSES } from '../../visual/src/fix-prompt.mjs';
import { runConnectCommand, runDisconnectCommand, runStatusCommand } from '../src/connect-command.js';
import { checkList, readWaiting, repoKeyOf, saveWaiting } from '../src/fix-waiting.js';
import { PRE_PUSH_WORDS, launchers, runEnv } from '../src/push-hook-run.js';
import { leaveTicket, runnerGoing, takeJobSlot, takeRunner, waitingTickets } from '../src/push-queue.js';
import { PUSH_RUN_LIMITS, PUSH_RUN_WORDS, limitsFrom, pruneLogs, whyWords } from '../src/push-run.js';
import { gitOut, isRemoteName, pushUrlOf } from '../src/team-git.js';
import { forgetConnection, markRefused, readConnection, readRuns, updateHooks,
  writeConnection } from '../src/team-home.js';
import { SESSIONS_LIMITS, uploadSessions } from '../src/upload-sessions.js';
import { remoteRepository, visualOutDir, VISUAL_DEFAULT_MODEL } from '../src/visual-command.js';
import { takeVisualLock } from '../src/visual-lock.js';
import { filesUnder, pushRepo, runEntry, runProcesses, sealedHome, streams, teamServer } from './team-helpers.js';

const FAKE = fileURLToPath(new URL('../../visual/test/fake-claude.mjs', import.meta.url));
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));
const sq = (text) => `'${String(text).replace(/'/g, "'\\''")}'`;
const firstLine = (s) => s.split('\n')[0];
const PERSON = { login: 'octo', team: 'Acme', seat: 'paid' };
const MATH_V2 = "export const add = (a, b) => {\n  if (typeof a !== 'number' || typeof b !== 'number') throw new "
  + "TypeError('add needs numbers');\n  return a + b;\n};\nexport const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, "
  + 'x));\n';
const SESSION = '3f1c2a9e-7b4d-4c8a-9e21-5d6f7a8b9c0d';
const OTHER = '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d';

/** Waits until `ready()` gives a value: that value. */
async function waitFor(ready, { what = 'a condition', ms = 60_000 } = {}) {
  const until = Date.now() + ms;
  for (;;) {
    const value = await ready();
    if (value) return value;
    if (Date.now() > until) throw new Error(`timed out waiting for ${what}`);
    await sleep(100);
  }
}

/** Answers that pass the checks for any change: a story, no findings and no function notes. */
const genericRules = () => [
  { when: firstLine(STORY_SYSTEM), text: JSON.stringify({ oneLine: 'add checks its inputs, and clamp is new.',
    ask: 'Make add refuse non-numbers and add clamp.', beforeNow: [{ before: 'add took anything',
      now: 'add refuses non-numbers' }], flows: [], glossary: [] }) },
  { when: firstLine(FINDINGS_SYSTEM), text: JSON.stringify({ findings: [] }) },
  { text: JSON.stringify({ functions: [] }) },
];
/** As genericRules, with one Must act finding on add, quoted from MATH_V2's diff. */
async function richRules(repoDir, base, head) {
  const facts = await extract({ repoDir, base, head });
  const request = await findingsRequest(facts);
  const short = Object.entries(request.ids).find(([, id]) => id.endsWith('#add'))[0];
  const finding = { tier: 'must-act', title: 'add now throws on anything but numbers',
    oneLine: 'Callers that pass strings to add now get a TypeError.', fns: [short],
    quote: "throw new TypeError('add needs numbers')" };
  return [genericRules()[0], { when: firstLine(FINDINGS_SYSTEM), text: JSON.stringify({ findings: [finding] }) },
    genericRules()[2]];
}

/**
 * A sealed home with a repository whose push hook is on, connected to a stand-in server: `{ home, repo, server, token,
 * where, common, env, rules(list), claude(kind), runs(), runOf(sha, state?), status(args) }`. `claude('fake')` makes
 * the stand-in claude the one on the hook's PATH; `claude('gated')` one that waits for $HOME/claude-go and logs its pid,
 * its parent's (the runner's) and its CPU priority as it starts, and its pid again as it ends (`ended`), each a line of
 * $HOME/claude-calls.jsonl in the order they happened; `claude('stubborn')` one that ignores SIGTERM and never answers.
 * `listed` (with `hook: false`) lists the repository in hooks.json with no hook file, so a push starts no runner and
 * a runner that the test starts reviews the tickets it leaves (D227 review 1: none once the repository is not listed).
 */
async function setup(t, { person = PERSON, env: extraEnv = {}, connect = true, hook = true, listed = false,
  name } = {}) {
  const home = await sealedHome(t, 'sonah d227 ');
  const repo = await pushRepo(home, { env: { SONAH_PUSH_POLL_MS: '200', ...extraEnv }, ...(name ? { name } : {}) });
  const server = await teamServer(t);
  const token = server.addToken(person);
  const where = { env: repo.env };
  const common = await realpath(join(repo.work, '.git'));
  if (connect) await writeConnection({ server: server.url, token, login: person.login }, where);
  const rules = (list) => writeFile(join(repo.root, 'fake-claude.json'), JSON.stringify({ rules: list }));
  await rules(genericRules());
  const claudeFile = join(repo.root, 'bin', 'claude');
  const claude = async (kind = 'fake') => {
    let text;
    if (kind === 'fake') text = `#!/bin/sh\nexec ${sq(process.execPath)} ${sq(FAKE)} "$@"\n`;
    else if (kind === 'gated') {
      const js = join(repo.root, 'gated-claude.mjs');
      await writeFile(js, `import { spawn } from 'node:child_process';
import { appendFileSync, existsSync } from 'node:fs';
import { getPriority } from 'node:os';
import { join } from 'node:path';
const home = process.env.HOME;
const said = (line) => appendFileSync(join(home, 'claude-calls.jsonl'), JSON.stringify(line) + '\\n');
said({ pid: process.pid, ppid: process.ppid, nice: getPriority() });
const go = () => {
  if (!existsSync(join(home, 'claude-go'))) { setTimeout(go, 50); return; }
  const child = spawn(process.execPath, [${JSON.stringify(FAKE)}, ...process.argv.slice(2)], { stdio: 'inherit' });
  child.on('exit', (code) => { said({ pid: process.pid, ended: true }); process.exit(code ?? 1); });
};
go();
`);
      text = `#!/bin/sh\nexec ${sq(process.execPath)} ${sq(js)} "$@"\n`;
    } else {
      const stubborn = join(repo.root, 'stubborn-claude');
      await writeFile(stubborn, 'echo $$ >> "$HOME/fake-claude.pids"\ntrap \'\' TERM\nwhile :; do sleep 1; done\n');
      text = `#!/bin/sh\nexec /bin/sh ${sq(stubborn)} "$@"\n`;
    }
    await writeFile(claudeFile, text);
    await chmod(claudeFile, 0o755);
  };
  await claude('fake');
  if (hook) {
    const added = await runEntry(['hook', 'add', '--push'], { env: repo.env, cwd: repo.work });
    assert.equal(added.code, 0, added.stdout + added.stderr);
  } else if (listed) await updateHooks(where, (repos) => [...repos, { common, server: server.url }]);
  const runs = async () => (await readRuns(where)).runs;
  const runOf = async (sha, state) => (await runs()).find((r) => r.sha === sha && (!state || r.state === state));
  const status = async (args = []) => {
    const out = streams();
    const code = await runStatusCommand(args, { env: repo.env, stdout: out.stdout, stderr: out.stderr,
      git: (dir, a) => new Promise((done) => done(spawnSync('git', ['-C', dir, ...a], { env: repo.env,
        encoding: 'utf8' }).stdout ?? null)) });
    return { code, ...out.chunks };
  };
  return { home, repo, server, token, where, common, env: repo.env, rules, claude, runs, runOf, status };
}

/** `sonah push-run --repo <work>` run in the foreground through the real entry, in `env`; `more` is runEntry's rest
 *  (`timeoutMs`, for a run whose own time limit is longer than the entry's). */
const pushRun = (s, env = s.env, cwd = s.repo.work, more = {}) => runEntry(['push-run', '--repo', cwd],
  { env, cwd, ...more });
/** The calls the stand-in claude logged: `[{ argv, env, cwd, stdin }]`. */
async function claudeLog(s) {
  try {
    return (await readFile(join(s.repo.root, 'fake-claude.log.jsonl'), 'utf8')).split('\n').filter(Boolean)
      .map((line) => JSON.parse(line));
  } catch { return []; }
}
/** The nice value of a process, as ps shows it. */
const niceOf = (pid) => {
  const r = spawnSync('ps', ['-o', 'ni=', '-p', String(pid)], { encoding: 'utf8' });
  return r.status === 0 ? Number(r.stdout.trim()) : null;
};
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; } };
/** The pids the stand-in claude of a test wrote as its calls started ($HOME/fake-claude.pids). */
const heldPids = async (s) => (await readFile(join(s.repo.root, 'fake-claude.pids'), 'utf8').catch(() => ''))
  .split('\n').filter(Boolean).map(Number);

/**
 * D228: runs `attempt(giveUpMs)` (one try of a ticket whose claude call never answers) with the ticket's time limit
 * doubled until the run really held a call inside it: what that try gave, with `held` (the pids of the calls it was
 * holding) and the `giveUpMs` it ran with.
 *
 * A ticket's time limit runs from its push, so the run's own start comes out of it: a node process, git, the probe,
 * the drawing's modules, extract. That is the computer's work (measured from the ticket to the first call: 0.7 s on an
 * idle laptop, 1.2 to 1.8 s with as many busy processes as it has cores, over 4 and over 6 s under the whole suite's
 * load), and once it has spent the limit the drawing asks for no call at all: with less than DEADLINE_MIN_MS left
 * every request fails at once as `timeout` and no claude starts, so a test of what a call does at its deadline has
 * nothing to watch: it read fake-claude.pids and found none. A limit long enough for every computer is a guess, so
 * these two tests do not make one: `from` is only where they start (over the slowest start seen, so one try is the
 * usual case), a try the run spent before its first call is run again with twice as much, and a loaded computer makes
 * them slower, never red.
 */
async function withCallHeld(t, s, attempt, { from = 8_000, upTo = 32_000 } = {}) {
  for (let giveUpMs = from; giveUpMs <= upTo; giveUpMs *= 2) {
    // each try's own held calls only: a try that held none started no claude, so none of them is left running
    await rm(join(s.repo.root, 'fake-claude.pids'), { force: true });
    const out = await attempt(giveUpMs);
    const held = await heldPids(s);
    if (held.length) return { ...out, held, giveUpMs };
    t.diagnostic(`the run spent its ${giveUpMs} ms before it called claude: again with ${giveUpMs * 2} ms`);
  }
  throw new Error(`no claude call ran inside ${upTo} ms of a ticket's time limit`);
}

test('a push is reviewed in the background at low priority, and its page, data and sessions are uploaded', async (t) => {
  const s = await setup(t, { env: { ANTHROPIC_API_KEY: 'sk-ant-test-not-a-key' } });
  const head = await s.repo.commit('feature', MATH_V2);
  await s.rules(await richRules(s.repo.work, s.repo.git(['rev-parse', 'main']), head));
  await s.claude('gated');
  const p = s.repo.push(['-q', 'origin', 'feature']);
  assert.equal(p.code, 0, p.stderr);
  assert.equal(p.stderr, `sonah: ${PRE_PUSH_WORDS.started(['feature'])}\n`);
  t.diagnostic(`git push with the hook returned in ${Math.round(p.ms)} ms while the review went on`);

  // While its first claude call is held, the run is running, and both run at low CPU priority.
  const running = await waitFor(() => s.runOf(head, 'running'), { what: 'the run to start' });
  const calls = join(s.repo.root, 'claude-calls.jsonl');
  const first = await waitFor(async () => {
    try { return JSON.parse((await readFile(calls, 'utf8')).split('\n')[0]); } catch { return null; }
  }, { what: 'a claude call' });
  const nice = niceOf(running.pid);
  t.diagnostic(`the runner's nice value: ${nice}; its claude call's: ${first.nice}`);
  assert.ok(nice >= 10, `nice ${nice}`);
  assert.ok(first.nice >= 10);
  await writeFile(join(s.repo.root, 'claude-go'), '');

  const up = await waitFor(() => s.server.uploads.find((u) => u.head === head), { what: 'the upload' });
  assert.deepEqual(up.repo, { owner: 'acme', name: 'widgets' });
  assert.equal(up.branch, 'feature');
  assert.equal(up.base, s.repo.git(['rev-parse', 'main']), 'the merge base with the remote\'s default branch');
  assert.match(up.page, /^<!doctype html>/i);
  assert.equal(up.run.status, 'complete');
  assert.equal(up.findings.length, 1);
  assert.equal(up.findings[0].tier, 'must-act');
  assert.deepEqual(Object.keys(up).sort(), ['base', 'branch', 'facts', 'findings', 'head', 'meaning', 'page', 'repo',
    'run', 'sessions']);
  assert.deepEqual(up.sessions, [], 'no commit of the range names an agent session');
  // The probe before any claude call, then the upload; each with the token in the header only.
  const routes = s.server.calls.map((c) => `${c.method} ${c.path}`);
  assert.deepEqual(routes.slice(0, 3), ['GET /api/token', 'GET /api/fixes', 'POST /api/uploads']);
  assert.deepEqual(s.server.calls[1].query, { owner: 'acme', repo: 'widgets' });
  assert.equal(routes.includes('GET /api/prs'), false, 'decision 8');
  for (const c of s.server.calls) {
    assert.equal(c.authorization, `Bearer ${s.token}`);
    assert.equal(c.url.includes(s.token), false);
    assert.equal(c.userAgent, 'getsonah');
  }

  const done = await waitFor(() => s.runOf(head, 'done'), { what: 'the run to end' });
  assert.equal(done.url, `${s.server.url}/r/acme/widgets/b/feature`);
  assert.equal(done.why, 'uploaded');
  assert.equal(done.out, visualOutDir({ top: await realpath(s.repo.work), base: up.base, head,
    model: VISUAL_DEFAULT_MODEL, env: s.env }));
  for (const f of ['facts.json', 'meaning.json', 'findings.json', 'run.json', 'page.html'])
    await stat(join(done.out, f));
  // The full model id, and no API key in claude's environment (the plan's section 2, step 4).
  const log = await claudeLog(s);
  assert.ok(log.length >= 3);
  for (const call of log) {
    assert.equal(call.argv[call.argv.indexOf('--model') + 1], VISUAL_DEFAULT_MODEL);
    assert.equal(Object.hasOwn(call.env, 'ANTHROPIC_API_KEY'), false);
  }
  // The runner ends once no ticket is left.
  await waitFor(() => !alive(running.pid), { what: 'the runner to end' });
  assert.equal((await readdir(join(s.repo.env.SONAH_HOME, 'team', 'locks'))).includes('job.lock'), false);

  // sonah status: the run, its page and its log; --json the same; no call for the runs.
  const before = s.server.calls.length;
  const text = await s.status();
  assert.equal(text.code, 0, text.stdout);
  assert.ok(text.stdout.includes(`${PUSH_RUN_WORDS.heading}\n  acme/widgets feature ${head.slice(0, 7)}: done\n`
    + `    ${PUSH_RUN_WORDS.why.uploaded(s.server.url)}\n    page: ${done.url}\n    log: ${done.log}\n`), text.stdout);
  const json = JSON.parse((await s.status(['--json'])).stdout);
  assert.equal(json.v, 1);
  assert.deepEqual(json.connection, { state: 'ok', server: s.server.url, login: 'octo', team: 'Acme', seat: 'paid' });
  assert.equal(json.runs[0].state, 'done');
  assert.equal(json.runs[0].url, done.url);
  assert.equal(json.runs[0].log, done.log);
  assert.deepEqual(s.server.calls.slice(before).map((c) => c.path), ['/api/token', '/api/token'],
    'status asks only whose the token is');
  assert.match(await readFile(done.log, 'utf8'), /done: Sonah put this review on/);
  assert.equal((await stat(done.log)).mode & 0o777, 0o600);
  assert.equal((await stat(join(s.repo.env.SONAH_HOME, 'team', 'logs'))).mode & 0o777, 0o700);
  assert.equal((await stat(join(s.repo.env.SONAH_HOME, 'team', 'runs.json'))).mode & 0o777, 0o600);

  // The token is in the connection file and nowhere else under HOME.
  const holders = (await filesUnder(s.repo.root)).filter((f) => f.text.includes(s.token)).map((f) => f.path);
  assert.deepEqual(holders, [join(s.repo.root, 'sonah home', 'team', 'connection.json')]);
});

test("the base is the merge base with the remote's default branch, asked of the remote when git has no origin/HEAD; a commit on it is skipped", async (t) => {
  const s = await setup(t);
  const main1 = s.repo.git(['rev-parse', 'main']);
  const head = await s.repo.commit('feature', MATH_V2);
  // main moves on before the push: the base stays where feature left it
  await s.repo.commit('main', `${MATH_V2}// main moves on\n`);
  assert.equal(s.repo.push(['-q', '--no-verify', 'origin', 'main']).code, 0);
  assert.equal(s.repo.push(['-q', 'origin', 'feature']).code, 0);
  const done = await waitFor(() => s.runOf(head, 'done'), { what: 'feature done' });
  assert.equal(s.server.uploads.find((u) => u.head === head).base, main1);
  assert.match(await readFile(done.log, 'utf8'), /refs\/remotes\/origin\/HEAD is not set here/);
  // A branch whose tip is on the default branch: nothing to review, no call.
  const calls = (await claudeLog(s)).length;
  s.repo.git(['branch', 'same', main1]);
  assert.equal(s.repo.push(['-q', 'origin', 'same']).code, 0);
  const skipped = await waitFor(() => s.runOf(main1, 'skipped'), { what: 'same skipped' });
  assert.equal(skipped.why, 'on_default_branch');
  assert.equal(whyWords(skipped), PUSH_RUN_WORDS.why.on_default_branch('origin'));
  assert.equal((await claudeLog(s)).length, calls);
  assert.equal(s.server.uploads.length, 1);
});

test('one runner per repository: pushes leave tickets, a newer push of a branch replaces a waiting one, a review going finishes', async (t) => {
  const s = await setup(t);
  await s.claude('gated');
  const pushed = (...branches) => {
    const r = s.repo.push(['-q', 'origin', ...branches]);
    assert.equal(r.code, 0, r.stderr);
    return r;
  };
  let most = 0;
  const watch = setInterval(async () => {
    most = Math.max(most, (await s.runs()).filter((r) => r.state === 'running').length);
  }, 20);
  t.after(() => clearInterval(watch));
  const x1 = await s.repo.commit('x', `${MATH_V2}// x1\n`);
  pushed('x');
  const first = await waitFor(() => s.runOf(x1, 'running'), { what: 'x1 running' });
  // two branches in one push while x1 is reviewed: tickets only, no second runner
  const y1 = await s.repo.commit('y', `${MATH_V2}// y1\n`);
  const z1 = await s.repo.commit('z', `${MATH_V2}// z1\n`);
  const yz = pushed('y', 'z');
  assert.match(yz.stderr, /^sonah: Sonah reviews [yz], [yz] in the background, after the push that it reviews now/);
  await waitFor(async () => (await s.runOf(y1, 'waiting')) && (await s.runOf(z1, 'waiting')) && true,
    { what: 'y1 and z1 waiting' });
  const x2 = await s.repo.commit('x', `${MATH_V2}// x2\n`);
  pushed('x');
  await waitFor(() => s.runOf(x2, 'waiting'), { what: 'x2 waiting' });
  const x3 = await s.repo.commit('x', `${MATH_V2}// x3\n`);
  pushed('x');
  await waitFor(() => s.runOf(x2, 'replaced'), { what: 'x2 replaced' });
  assert.equal((await s.runOf(x1)).state, 'running', 'the review going on finishes');

  await writeFile(join(s.repo.root, 'claude-go'), '');
  await waitFor(() => s.runOf(x3, 'done'), { what: 'x3 done', ms: 90_000 });
  clearInterval(watch);
  const order = s.server.uploads.map((u) => u.head);
  assert.deepEqual(order.slice(0, 1), [x1], 'x1 finished first');
  assert.deepEqual(new Set(order), new Set([x1, y1, z1, x3]), 'x2 never ran');
  assert.equal(order.length, 4);
  assert.equal(most, 1, 'never two reviews of the repository at once');
  const replaced = await s.runOf(x2);
  assert.equal(replaced.why, 'newer_push');
  assert.equal(whyWords(replaced), PUSH_RUN_WORDS.why.newer_push('x'));
  // every review ran in the one process the first push started, which ends once no ticket is left
  const pids = new Set();
  for (const sha of [x1, y1, z1, x3]) pids.add((await s.runOf(sha)).pid);
  assert.deepEqual([...pids], [first.pid]);
  await waitFor(() => !alive(first.pid), { what: 'the runner to end' });
});

test("the laptop's one job slot: two repositories' runners never draw at once", async (t) => {
  const s = await setup(t);
  await s.claude('gated');
  // A second clone of the same remote: another git common dir, so another queue and runner.
  const other = join(s.repo.root, 'other clone');
  s.repo.git(['-c', `core.sshCommand=${sq(join(s.repo.root, 'ssh-shim.sh'))}`, '-c', 'ssh.variant=simple', 'clone', '-q',
    'ssh://example.invalid/acme/widgets.git', other], {}, s.repo.root);
  for (const [key, value] of [['commit.gpgsign', 'false'], ['core.sshCommand', sq(join(s.repo.root, 'ssh-shim.sh'))],
    ['ssh.variant', 'simple']]) s.repo.git(['config', key, value], {}, other);
  assert.equal((await runEntry(['hook', 'add', '--push'], { env: s.env, cwd: other })).code, 0);
  let most = 0;
  const watch = setInterval(async () => {
    most = Math.max(most, (await s.runs()).filter((r) => r.state === 'running').length);
  }, 20);
  t.after(() => clearInterval(watch));
  const a = await s.repo.commit('a', `${MATH_V2}// a\n`);
  assert.equal(s.repo.push(['-q', 'origin', 'a']).code, 0);
  await waitFor(() => s.runOf(a, 'running'), { what: 'a running' });
  s.repo.git(['checkout', '-q', '-b', 'b'], {}, other);
  await writeFile(join(other, 'math.js'), `${MATH_V2}// b\n`);
  s.repo.git(['commit', '-q', '-am', 'b'], {}, other);
  const b = s.repo.git(['rev-parse', 'HEAD'], {}, other);
  const pushB = s.repo.run(['push', '-q', 'origin', 'b'], {}, other);
  assert.equal(pushB.code, 0, pushB.stderr);
  assert.equal(pushB.stderr, `sonah: ${PRE_PUSH_WORDS.started(['b'])}\n`, 'another repository: its own runner');
  const queued = await waitFor(async () => {
    const run = await s.runOf(b, 'queued');
    return run?.why === 'job_slot' && run;
  }, { what: 'b waiting for the job slot' });
  assert.equal((await s.runOf(a)).state, 'running');
  assert.equal(whyWords(queued), PUSH_RUN_WORDS.why.job_slot);
  await writeFile(join(s.repo.root, 'claude-go'), '');
  await waitFor(async () => (await s.runOf(a, 'done')) && (await s.runOf(b, 'done')), { what: 'both done', ms: 90_000 });
  clearInterval(watch);
  assert.equal(most, 1, 'one drawing at a time on this computer');
  const runnerA = (await s.runOf(a)).pid, runnerB = (await s.runOf(b)).pid;
  assert.notEqual(runnerA, runnerB);
  // D227 review 0: the drawings themselves, by the order the calls logged their start (with their runner, the call's
  // parent) and their end: every call of a's runner ended before the first call of b's runner began.
  const lines = (await readFile(join(s.repo.root, 'claude-calls.jsonl'), 'utf8')).split('\n').filter(Boolean)
    .map((line) => JSON.parse(line));
  const runnerOf = new Map(lines.filter((l) => !l.ended).map((l) => [l.pid, l.ppid]));
  assert.equal(lines.filter((l) => l.ended).length, runnerOf.size, 'every call ended');
  const order = lines.map((l) => runnerOf.get(l.pid));
  const firstB = order.indexOf(runnerB);
  assert.ok(firstB > 0, `both runners drew: ${JSON.stringify(order)}`);
  assert.deepEqual(order, [...Array(firstB).fill(runnerA), ...Array(order.length - firstB).fill(runnerB)],
    'no call of one runner while a call of the other ran');
});

test('a run waits for the remote to show the commit, fails after the wait, and gives up at its time limit', async (t) => {
  const s = await setup(t);
  const ticket = async (branch, sha, at = Date.now()) => {
    const { ticket: left } = await leaveTicket(s.where, { common: s.common, dir: await realpath(s.repo.work), branch,
      sha, remote: 'origin', server: s.server.url, login: 'octo', at });
    return left;
  };
  // Never pushed: it waits, then says so.
  const lone = await s.repo.commit('lone', MATH_V2);
  await ticket('lone', lone);
  const r = await pushRun(s, { ...s.env, SONAH_PUSH_REMOTE_WAIT_MS: '1500' });
  assert.equal(r.code, 0);
  assert.equal(r.stdout + r.stderr, '', 'the hidden command prints nothing');
  const never = await s.runOf(lone, 'failed');
  assert.equal(never.why, 'remote_never_showed');
  assert.equal(whyWords(never), PUSH_RUN_WORDS.why.remote_never_showed('2 seconds'));

  // Started before its push: it waits for it, then reviews and uploads.
  const later = await s.repo.commit('later', MATH_V2);
  await ticket('later', later);
  const running = pushRun(s);
  // D227 review 0: until the runner has looked (not a fixed second, which a busy computer can outlast)
  await waitFor(async () => (await s.runOf(later, 'waiting'))?.why === 'remote_not_seen',
    { what: 'the run to wait for the remote' });
  assert.equal(s.server.uploads.length, 0);
  assert.equal(s.repo.push(['-q', '--no-verify', 'origin', 'later']).code, 0);
  assert.equal((await running).code, 0);
  assert.equal(s.server.uploads.at(-1).head, later);

  // A claude call that never answers is stopped at the ticket's last second: the run gives up, nothing stays behind.
  // D228: the limit is not a number that must outlast the run's own start on any computer (`withCallHeld`): a limit the
  // run spends before its first call proves nothing, and at 4 seconds the whole suite's load spent them all on git and
  // the probe, so the read of fake-claude.pids below failed with ENOENT instead of proving the stop. Each try pushes a
  // branch of its own, so each has its own run, its own folder and its own held calls.
  await s.rules([{ mode: 'slow', ms: 120_000 }]);
  let tries = 0;
  const { run: gave, held, giveUpMs, took } = await withCallHeld(t, s, async (limit) => {
    const branch = `slow${++tries}`;
    const sha = await s.repo.commit(branch, `${MATH_V2}// ${branch}\n`);
    assert.equal(s.repo.push(['-q', '--no-verify', 'origin', branch]).code, 0);
    const at = Date.now();
    await ticket(branch, sha, at);
    const g = await pushRun(s, { ...s.env, SONAH_PUSH_GIVE_UP_MS: String(limit) }, s.repo.work,
      { timeoutMs: limit + 20_000 });
    assert.equal(g.code, 0, g.stdout + g.stderr);
    const run = await s.runOf(sha, 'gave_up');
    assert.ok(run, `the run of ${branch} did not give up: ${JSON.stringify(await s.runOf(sha))}`);
    return { took: Date.now() - at, run };
  });
  assert.equal(gave.why, 'time_limit');
  assert.equal(whyWords(gave), PUSH_RUN_WORDS.why.time_limit(`${giveUpMs / 1000} seconds`));
  // at the ticket's own limit, not at the half hour a run has by default
  assert.ok(took >= giveUpMs && took < giveUpMs + 10_000, `it gave up after ${took} ms of ${giveUpMs} ms`);
  assert.ok(held.length >= 1);
  await waitFor(() => held.every((pid) => !alive(pid)), { what: 'the held calls to stop', ms: 10_000 });
  assert.equal(s.server.uploads.length, 1, 'nothing more was uploaded');
});

test('the backstop ends a run whose call ignores its stop, a little after the deadline, and the call with it', async (t) => {
  const s = await setup(t);
  await s.claude('stubborn');
  // The calls ignore the SIGTERM that the deadline sends; without the backstop the transport's own SIGKILL would end
  // them 5 s later, and the drawing would end and say so in the log.
  // D228: the deadline must catch a call of the run's that runs, and a fixed limit does not make it so: at 6 seconds
  // the whole suite's load spent them on the run's own start, so the drawing asked for no call at all, ended itself as
  // `timeout` at the deadline, said so in the log, and the run gave up before the backstop's second was up.
  // `withCallHeld` only tries again with twice the limit, so what this test proves does not turn on the computer.
  let tries = 0;
  const { gave, log, held, giveUpMs, took } = await withCallHeld(t, s, async (limit) => {
    const branch = `stuck${++tries}`;
    const head = await s.repo.commit(branch, `${MATH_V2}// ${branch}\n`);
    assert.equal(s.repo.push(['-q', '--no-verify', 'origin', branch]).code, 0);
    const at = Date.now();
    await leaveTicket(s.where, { common: s.common, dir: await realpath(s.repo.work), branch, sha: head,
      remote: 'origin', server: s.server.url, login: 'octo', at });
    const r = await pushRun(s, { ...s.env, SONAH_PUSH_GIVE_UP_MS: String(limit), SONAH_PUSH_BACKSTOP_MS: '1000' },
      s.repo.work, { timeoutMs: limit + 20_000 });
    assert.equal(r.code, 0, r.stdout + r.stderr);
    const run = await s.runOf(head, 'gave_up');
    assert.ok(run, `the run of ${branch} did not give up: ${JSON.stringify(await s.runOf(head))}`);
    return { took: Date.now() - at, gave: run, log: await readFile(run.log, 'utf8') };
  });
  assert.equal(gave.why, 'time_limit');
  assert.equal(log.includes('the drawing ended'), false, `the backstop ended it, not the drawing: ${log}`);
  // after the deadline, and inside the 5 s the transport holds a call that ignores SIGTERM: the drawing had not ended
  assert.ok(took >= giveUpMs && took < giveUpMs + 5_000, `the backstop ended it after ${took} ms of ${giveUpMs} ms`);
  assert.ok(held.length >= 1);
  await waitFor(() => held.every((pid) => !alive(pid)), { what: 'the calls that ignored SIGTERM to end', ms: 5_000 });
  assert.deepEqual(runProcesses(s.repo.root), []);
  assert.deepEqual(await waitingTickets(s.where, s.common), [], 'its ticket is not taken again');
});

test('a run that claude refuses says what to do and ends the pass; logs are pruned at 30 days, visual folders never', async (t) => {
  const s = await setup(t);
  await s.rules([{ mode: 'auth' }]);
  const a = await s.repo.commit('a', `${MATH_V2}// a\n`);
  const b = await s.repo.commit('b', `${MATH_V2}// b\n`);
  // An old visual folder of another range, and an old log, before the pass.
  const visual = join(s.env.SONAH_HOME, 'visual', 'old-0000', 'a-b-model');
  await mkdir(visual, { recursive: true });
  const logs = join(s.env.SONAH_HOME, 'team', 'logs');
  await mkdir(logs, { recursive: true });
  const old = new Date(Date.now() - 40 * 86_400_000);
  await writeFile(join(logs, 'old.log'), 'x');
  await utimes(join(logs, 'old.log'), old, old);
  await utimes(visual, old, old);
  await writeFile(join(logs, 'notes.txt'), 'x');
  await utimes(join(logs, 'notes.txt'), old, old);
  assert.equal(s.repo.push(['-q', 'origin', 'a', 'b']).code, 0);
  const ends = await waitFor(async () => {
    const both = [await s.runOf(a, 'failed'), await s.runOf(b, 'failed')];
    return both.every(Boolean) && both;
  }, { what: 'both runs to fail' });
  for (const run of ends) {
    assert.equal(run.why, 'auth');
    assert.equal(whyWords(run), PUSH_RUN_WORDS.why.auth);
  }
  assert.equal(ends.filter((run) => run.out !== null).length, 1, 'the second ticket started no drawing');
  assert.equal(s.server.uploads.length, 0);
  const text = await s.status();
  assert.ok(text.stdout.includes(`: failed\n    ${PUSH_RUN_WORDS.why.auth}\n`), text.stdout);
  await waitFor(() => runProcesses(s.repo.root).length === 0, { what: 'the runner to end' });
  assert.deepEqual((await readdir(logs)).filter((n) => n === 'old.log' || n === 'notes.txt'), ['notes.txt']);
  await stat(visual);
  // pruneLogs alone: only .log files older than 30 days
  await writeFile(join(logs, 'older.log'), 'x');
  await utimes(join(logs, 'older.log'), old, old);
  await pruneLogs(logs);
  assert.equal((await readdir(logs)).includes('older.log'), false);
});

test('the probe: a revoked token marks the connection refused and ends the pass; no team fails; 503 goes on', async (t) => {
  // 401: no claude call, both tickets failed, the connection marked, and the next push starts nothing.
  const s = await setup(t);
  const a = await s.repo.commit('a', `${MATH_V2}// a\n`);
  const b = await s.repo.commit('b', `${MATH_V2}// b\n`);
  s.server.tokens.get(s.token).live = false;
  assert.equal(s.repo.push(['-q', 'origin', 'a', 'b']).code, 0);
  const refused = await waitFor(async () => {
    const both = [await s.runOf(a, 'failed'), await s.runOf(b, 'failed')];
    return both.every(Boolean) && both;
  }, { what: 'both refused' });
  for (const run of refused) assert.equal(run.why, 'refused');
  assert.equal(whyWords(refused[0]), PUSH_RUN_WORDS.why.refused(s.server.url));
  assert.equal(s.server.calls.filter((c) => c.path === '/api/fixes').length, 1, 'one probe a repository a pass');
  assert.deepEqual(await claudeLog(s), []);
  await stat(join(s.env.SONAH_HOME, 'team', 'refused.json'));
  const c = await s.repo.commit('c', `${MATH_V2}// c\n`);
  const again = s.repo.push(['-q', 'origin', 'c']);
  assert.equal(again.stderr, `sonah: ${PRE_PUSH_WORDS.refused(s.server.url)}\n`);
  assert.equal(await s.runOf(c), undefined);

  // 403 not_member: failed, no claude call.
  const n = await setup(t, { person: { login: 'nomad', team: null, seat: null } });
  const head = await n.repo.commit('feature', MATH_V2);
  assert.equal(n.repo.push(['-q', 'origin', 'feature']).code, 0);
  const lone = await waitFor(() => n.runOf(head, 'failed'), { what: 'not_member' });
  assert.equal(lone.why, 'not_member');
  assert.equal(whyWords(lone), PUSH_RUN_WORDS.why.not_member(n.server.url));
  assert.deepEqual(await claudeLog(n), []);

  // 503 and 429 to the probe: the review goes on (decision 16), and the upload goes through.
  const o = await setup(t);
  o.server.once('GET', '/api/fixes', { status: 503, json: { error: 'busy' } });
  const ok = await o.repo.commit('feature', MATH_V2);
  assert.equal(o.repo.push(['-q', 'origin', 'feature']).code, 0);
  await waitFor(() => o.runOf(ok, 'done'), { what: 'done after a 503 probe' });
  o.server.once('GET', '/api/fixes', { status: 429, json: { error: 'rate_limited' } });
  const ok2 = await o.repo.commit('feature', `${MATH_V2}// two\n`);
  assert.equal(o.repo.push(['-q', 'origin', 'feature']).code, 0);
  await waitFor(() => o.runOf(ok2, 'done'), { what: 'done after a 429 probe' });
});

test('C8 review 1: a 401 to the GET /api/fixes after the queue marks nothing, as PRIVACY says, and the next push is '
  + 'reviewed', async (t) => {
  const s = await setup(t);
  // The probe is answered as the route answers it; the call after the queue meets a 401.
  s.server.once('GET', '/api/fixes', { status: 200, json: { repo: { owner: 'acme', name: 'widgets' }, total: 0,
    fixes: [] } });
  s.server.once('GET', '/api/fixes', { status: 401, json: { error: 'bad_token' } });
  const head = await s.repo.commit('feature', MATH_V2);
  assert.equal(s.repo.push(['-q', 'origin', 'feature']).code, 0);
  await waitFor(() => s.runOf(head, 'done'), { what: 'the review sent' });
  await waitFor(() => runProcesses(s.repo.root).length === 0, { what: 'the runner to end' });
  assert.equal(s.server.calls.filter((c) => c.path === '/api/fixes').length, 2,
    'the probe, and the call after the queue');
  await assert.rejects(stat(join(s.env.SONAH_HOME, 'team', 'refused.json')), { code: 'ENOENT' });
  const next = await s.repo.commit('feature', `${MATH_V2}// two\n`);
  const p = s.repo.push(['-q', 'origin', 'feature']);
  assert.equal(p.stderr, `sonah: ${PRE_PUSH_WORDS.started(['feature'])}\n`);
  await waitFor(() => s.runOf(next, 'done'), { what: 'the next review sent' });
});

test('an upload that does not reach the server waits, and a later pass sends the newest of its branch', async (t) => {
  const s = await setup(t, { env: { SONAH_PUSH_RETRY_MS: '200' } });
  const fail = (n) => { for (let i = 0; i < n; i++) s.server.once('POST', '/api/uploads', { status: 503 }); };
  fail(3);
  const f1 = await s.repo.commit('feature', MATH_V2);
  assert.equal(s.repo.push(['-q', 'origin', 'feature']).code, 0);
  const p1 = await waitFor(() => s.runOf(f1, 'pending_upload'), { what: 'f1 pending' });
  assert.equal(p1.why, 'upload_failed');
  assert.equal(p1.status, 503);
  assert.equal(p1.server, s.server.url);
  assert.equal(p1.login, 'octo');
  assert.equal(whyWords(p1), PUSH_RUN_WORDS.why.upload_failed(s.server.url, 503));
  assert.equal(s.server.calls.filter((c) => c.path === '/api/uploads').length, 3, 'tried again after 5 s and 20 s');
  await waitFor(() => runProcesses(s.repo.root).length === 0, { what: 'the first runner to end' });
  // A second push of the branch fails too: f1 is replaced by it, and f2 waits for a later pass.
  fail(3);
  const f2 = await s.repo.commit('feature', `${MATH_V2}// two\n`);
  assert.equal(s.repo.push(['-q', 'origin', 'feature']).code, 0);
  await waitFor(() => s.runOf(f1, 'replaced'), { what: 'f1 replaced' });
  await waitFor(() => runProcesses(s.repo.root).length === 0, { what: 'the second runner to end' });
  assert.equal((await s.runOf(f2)).state, 'pending_upload');
  // A push of another branch: its own upload, then f2's, which goes through now.
  const g = await s.repo.commit('g', `${MATH_V2}// g\n`);
  assert.equal(s.repo.push(['-q', 'origin', 'g']).code, 0);
  const sent = await waitFor(() => s.runOf(f2, 'done'), { what: 'f2 sent' });
  assert.equal(sent.url, `${s.server.url}/r/acme/widgets/b/feature`);
  assert.deepEqual(s.server.uploads.map((u) => u.head), [g, f2]);
  assert.equal((await s.runOf(f1)).state, 'replaced');

  // A5: an upload that waits is the connection's own: a disconnect ends it.
  fail(3);
  const h = await s.repo.commit('h', `${MATH_V2}// h\n`);
  assert.equal(s.repo.push(['-q', 'origin', 'h']).code, 0);
  await waitFor(() => s.runOf(h, 'pending_upload'), { what: 'h pending' });
  await waitFor(() => runProcesses(s.repo.root).length === 0, { what: 'the runner to end' });
  await forgetConnection(s.where);
  const ended = await s.runOf(h);
  assert.equal(ended.state, 'failed');
  assert.equal(ended.why, 'connection_changed');
});

test('a push of a branch that `sonah visual` drew already reuses its folder and its answers: no new call', async (t) => {
  const s = await setup(t);
  const head = await s.repo.commit('feature', MATH_V2);
  const drawn = await runEntry(['visual', 'main..feature'], { env: s.env, cwd: s.repo.work });
  assert.equal(drawn.code, 0, drawn.stderr);
  const calls = (await claudeLog(s)).length;
  assert.ok(calls >= 3);
  // Another drawer holds the folder (D226's lock, here this test's): the run waits for it, then replays.
  const folder = visualOutDir({ top: await realpath(s.repo.work), base: s.repo.git(['rev-parse', 'main']), head,
    model: VISUAL_DEFAULT_MODEL, env: s.env });
  const lock = await takeVisualLock(folder);
  assert.ok(lock.release);
  assert.equal(s.repo.push(['-q', 'origin', 'feature']).code, 0);
  const waits = await waitFor(async () => {
    const run = await s.runOf(head, 'queued');
    return run?.why === 'folder_in_use' && run;
  }, { what: 'the run to wait for the folder' });
  assert.equal(whyWords(waits), PUSH_RUN_WORDS.why.folder_in_use);
  await lock.release();
  const done = await waitFor(() => s.runOf(head, 'done'), { what: 'done' });
  assert.equal((await claudeLog(s)).length, calls, 'the stored answers, replayed');
  assert.ok(drawn.stdout.includes(done.out), 'the folder of sonah visual');
  assert.equal(s.server.uploads.at(-1).head, head);
});

test('CI: a push starts no runner and leaves no run', async (t) => {
  const s = await setup(t);
  const head = await s.repo.commit('feature', MATH_V2);
  const p = s.repo.push(['-q', 'origin', 'feature'], { CI: 'true' });
  assert.equal(p.code, 0);
  assert.equal(p.stderr, '');
  await sleep(500);
  assert.deepEqual(await s.runs(), []);
  assert.deepEqual(await waitingTickets(s.where, s.common), []);
  assert.deepEqual(runProcesses(s.repo.root), []);
  // and push-run itself does nothing under CI
  await leaveTicket(s.where, { common: s.common, dir: await realpath(s.repo.work), branch: 'feature', sha: head,
    remote: 'origin', server: s.server.url, login: 'octo', at: Date.now() });
  assert.equal((await pushRun(s, { ...s.env, CI: '1' })).code, 0);
  assert.equal((await waitingTickets(s.where, s.common)).length, 1);
  assert.deepEqual(await claudeLog(s), []);
});

test('the cap of a push (A7), end to end: the 3 newest tips are reviewed and uploaded, the rest named once', async (t) => {
  const s = await setup(t);
  const shas = {};
  for (const [i, branch] of ['b1', 'b2', 'b3', 'b4', 'b5'].entries()) {
    s.repo.git(['checkout', '-q', '-b', branch, 'main']);
    await writeFile(join(s.repo.work, 'math.js'), `${MATH_V2}// ${branch}\n`);
    s.repo.git(['commit', '-q', '-am', branch], { GIT_COMMITTER_DATE: `2026-01-0${i + 1}T00:00:00Z` });
    shas[branch] = s.repo.git(['rev-parse', 'HEAD']);
  }
  const p = s.repo.push(['-q', 'origin', 'b1', 'b2', 'b3', 'b4', 'b5']);
  assert.equal(p.code, 0);
  assert.equal(p.stderr, `sonah: ${PRE_PUSH_WORDS.started(['b5', 'b4', 'b3'])}\nsonah: `
    + `${PRE_PUSH_WORDS.rest(['b2', 'b1'], 0)}\n`);
  await waitFor(async () => (await Promise.all(['b5', 'b4', 'b3'].map((b) => s.runOf(shas[b], 'done')))).every(Boolean),
    { what: 'three uploads', ms: 90_000 });
  await waitFor(() => runProcesses(s.repo.root).length === 0, { what: 'the runner to end' });
  assert.deepEqual(new Set(s.server.uploads.map((u) => u.branch)), new Set(['b5', 'b4', 'b3']));
  assert.equal(s.server.uploads.length, 3);
  for (const branch of ['b1', 'b2']) assert.equal(await s.runOf(shas[branch]), undefined);
});

test('a pushed worktree that is gone: the run reads the change from another worktree of the repository', async (t) => {
  const s = await setup(t);
  const tree = join(s.repo.root, 'linked tree');
  s.repo.git(['worktree', 'add', '-q', '-b', 'side', tree, 'main']);
  await writeFile(join(tree, 'math.js'), MATH_V2);
  s.repo.git(['commit', '-q', '-am', 'Side change'], {}, tree);
  const head = s.repo.git(['rev-parse', 'HEAD'], {}, tree);
  assert.equal(s.repo.run(['push', '-q', '--no-verify', 'origin', 'side'], {}, tree).code, 0);
  const dir = await realpath(tree);
  await rm(tree, { recursive: true, force: true });
  await leaveTicket(s.where, { common: s.common, dir, branch: 'side', sha: head, remote: 'origin', server: s.server.url,
    login: 'octo', at: Date.now() });
  assert.equal((await pushRun(s)).code, 0);
  const done = await s.runOf(head, 'done');
  assert.ok(done, JSON.stringify(await s.runs()));
  assert.equal(done.dir, await realpath(s.repo.work), 'the main worktree');
  assert.equal(s.server.uploads.at(-1).head, head);
  // With no worktree of the repository left at all, the run says so: a repository whose git folder lives apart from
  // its only worktree, which is gone.
  const folder = join(s.repo.root, 'apart.git'), only = join(s.repo.root, 'apart tree');
  s.repo.git(['init', '-q', '-b', 'main', '--separate-git-dir', folder, only], {}, s.repo.root);
  await writeFile(join(only, 'math.js'), MATH_V2);
  s.repo.git(['add', '.'], {}, only);
  s.repo.git(['commit', '-q', '-m', 'Only'], {}, only);
  const lost = s.repo.git(['rev-parse', 'HEAD'], {}, only);
  const lostCommon = await realpath(folder);
  const lostDir = await realpath(only);
  await rm(only, { recursive: true, force: true });
  await leaveTicket(s.where, { common: lostCommon, dir: lostDir, branch: 'main', sha: lost, remote: 'origin',
    server: s.server.url, login: 'octo', at: Date.now() });
  assert.equal((await runEntry(['push-run', '--repo', folder], { env: s.env, cwd: folder })).code, 0);
  const gone = await s.runOf(lost, 'failed');
  assert.equal(gone?.why, 'repository_gone');
  assert.equal(whyWords(gone), PUSH_RUN_WORDS.why.repository_gone);
});

test("the upload's sessions: each named session once, its commits, the version's files they changed, its answers", async (t) => {
  const s = await setup(t, { hook: false, connect: false });
  const git = s.repo.git;
  git(['checkout', '-q', '-b', 'feature']);
  const commit = async (message, files) => {
    for (const [file, text] of Object.entries(files)) {
      if (text === null) git(['rm', '-q', file]);
      else {
        await mkdir(join(s.repo.work, file, '..'), { recursive: true });
        await writeFile(join(s.repo.work, file), text);
        git(['add', file]);
      }
    }
    git(['commit', '-q', '-m', message]);
    return git(['rev-parse', 'HEAD']);
  };
  const main = git(['rev-parse', 'main']);
  const c1 = await commit(`Check add\n\nAgent-Session: ${SESSION}`, { 'math.js': MATH_V2, 'tmp/scratch.txt': 'x\n' });
  const c2 = await commit('Drop the scratch file', { 'tmp/scratch.txt': null });
  // a squash keeps an earlier line in its body; the id in capitals is the same session
  const c3 = await commit(`Docs and a fix\n\n* fix\n\nAgent-Session: ${OTHER.toUpperCase()}\nAgent-Session: ${SESSION}`,
    { 'README.md': 'Widgets.\n', 'math.js': `${MATH_V2}// more\n` });
  const facts = { range: { base: main, head: c3 }, files: [{ path: 'README.md' }, { path: 'math.js' }] };
  const env = { ...s.env, GIT_CONFIG_NOSYSTEM: '1' };
  const sessions = await uploadSessions({ dir: s.repo.work, facts, env,
    answers: new Map([[OTHER, new Set(['c_0123456789abcdef'])]]) });
  assert.deepEqual(sessions, [
    { id: OTHER, harness: SESSION_HARNESSES[0], commits: [c3], files: ['README.md', 'math.js'],
      answers: ['c_0123456789abcdef'] },
    { id: SESSION, harness: 'claude-code', commits: [c3, c1], files: ['README.md', 'math.js'], answers: [] },
  ], 'newest first; tmp/scratch.txt is not among the version files');
  assert.equal(sessions.some((x) => x.commits.includes(c2)), false);
  assert.deepEqual(SESSIONS_LIMITS, { entries: 100, commits: 1000, files: 3000, answers: 100 });
  // no line in the range: an empty list; a range git cannot read: a throw (the upload then has no field)
  assert.deepEqual(await uploadSessions({ dir: s.repo.work, facts: { range: { base: c1, head: c2 }, files: [] }, env }),
    []);
  await assert.rejects(uploadSessions({ dir: s.repo.work, facts: { range: { base: 'f'.repeat(40), head: c3 },
    files: [] }, env }));
});

test("an agent's commit, linked by D143's hook, is named in the push's upload", async (t) => {
  const s = await setup(t);
  assert.equal((await runEntry(['hook', 'add'], { env: s.env, cwd: s.repo.work })).code, 0);
  s.repo.git(['checkout', '-q', '-b', 'feature']);
  await writeFile(join(s.repo.work, 'math.js'), MATH_V2);
  s.repo.git(['commit', '-q', '-am', 'Check add, add clamp'], { CLAUDE_CODE_SESSION_ID: SESSION });
  const agent = s.repo.git(['rev-parse', 'HEAD']);
  assert.match(s.repo.git(['log', '-1', '--format=%B']), new RegExp(`Agent-Session: ${SESSION}\\s*$`));
  await writeFile(join(s.repo.work, 'README.md'), 'Widgets.\n');
  s.repo.git(['add', 'README.md']);
  s.repo.git(['commit', '-q', '-m', 'Readme']);
  const head = s.repo.git(['rev-parse', 'HEAD']);
  assert.equal(s.repo.push(['-q', 'origin', 'feature']).code, 0);
  await waitFor(() => s.runOf(head, 'done'), { what: 'done' });
  assert.deepEqual(s.server.uploads.at(-1).sessions, [{ id: SESSION, harness: 'claude-code', commits: [agent],
    files: ['math.js'], answers: [] }]);
});

test('sonah status: the newest 10 runs or all, a dead process as stopped, the waiting comments from the cache', async (t) => {
  const s = await setup(t, { hook: false });
  const sha = 'a'.repeat(40);
  // a run whose process ended while it ran
  const gone = spawnSync(process.execPath, ['-e', 'console.log(process.pid)'], { encoding: 'utf8' });
  const dead = Number(gone.stdout.trim());
  const { updateRuns } = await import('../src/team-home.js');
  await updateRuns(s.where, () => Array.from({ length: 12 }, (_, i) => ({ id: `00000000000${i.toString(16)}`,
    state: i === 11 ? 'running' : 'done', why: i === 11 ? null : 'uploaded', branch: `b${i}`, sha, repo: 'acme/widgets',
    server: s.server.url, login: 'octo', pid: i === 11 ? dead : null,
    at: new Date(Date.UTC(2026, 0, 1 + i)).toISOString() })));
  const json = JSON.parse((await s.status(['--json'])).stdout);
  assert.equal(json.runs.length, 10);
  assert.equal(json.runs[0].state, 'stopped');
  assert.equal(json.runs[0].why, 'process_ended');
  assert.equal(json.runs[0].words, PUSH_RUN_WORDS.why.process_ended);
  assert.equal(JSON.parse((await s.status(['--json', '--all'])).stdout).runs.length, 12);
  const text = await s.status();
  assert.ok(text.stdout.includes(`  acme/widgets b11 ${sha.slice(0, 7)}: stopped\n    `
    + `${PUSH_RUN_WORDS.why.process_ended}\n`), text.stdout);
  // the cache of the comments that wait, of this connection only
  const comment = (n) => ({ comment: { id: `c_000000000000000${n}`, by: 'mona', act: 'question',
    at: '2026-11-11T10:00:00.000Z', first: 'Why does add throw?' }, item: { kind: 'finding', key: 'k_add',
    tier: 'must-act', title: 'add throws' }, pr: { number: null, branch: 'feature' }, head: sha, state: null });
  const list = checkList({ repo: { owner: 'acme', name: 'widgets' }, total: 2, fixes: [comment(1), comment(2)] },
    { owner: 'acme', name: 'widgets' });
  assert.equal(list.fixes.length, 2);
  const { saveWaiting } = await import('../src/fix-waiting.js');
  await saveWaiting(s.where, { server: s.server.url, login: 'octo' }, list);
  assert.equal((await stat(join(s.env.SONAH_HOME, 'team', 'waiting.json'))).mode & 0o777, 0o600);
  assert.ok((await s.status()).stdout.endsWith(`${PUSH_RUN_WORDS.waiting(2, 'acme/widgets')}\n`));
  assert.deepEqual(JSON.parse((await s.status(['--json'])).stdout).waiting.map((w) => [w.repo, w.waiting, w.total]),
    [['acme/widgets', 2, 2]]);
  assert.deepEqual(Object.keys(await readWaiting(s.where, { server: s.server.url, login: 'someone' })), [],
    'another login reads none');
  // usage
  const bad = await s.status(['--bogus']);
  assert.equal(bad.code, 2);
  assert.match(bad.stderr, /^sonah status: unknown option --bogus\.\nusage: sonah status \[--json\] \[--all\]\n$/);
  assert.equal((await s.status(['--all', '--all'])).code, 2);
  // the cache goes with the connection (A5)
  await forgetConnection(s.where);
  await assert.rejects(stat(join(s.env.SONAH_HOME, 'team', 'waiting.json')));
  assert.equal(repoKeyOf('Acme', 'Widgets'), 'acme/widgets');
});

test('the run states and reasons are closed; the limits only shorten; the runner starts at low priority without git\'s hook settings', () => {
  assert.deepEqual(PUSH_RUN_STATES, ['waiting', 'queued', 'running', 'uploading', 'done', 'skipped', 'replaced',
    'failed', 'gave_up', 'pending_upload', 'shared', 'stopped']);
  for (const why of PUSH_RUN_REASONS) assert.ok(Object.hasOwn(PUSH_RUN_WORDS.why, why), why);
  assert.deepEqual(Object.keys(PUSH_RUN_WORDS.why).sort(), [...PUSH_RUN_REASONS].sort());
  assert.deepEqual(limitsFrom({}), { remoteWaitMs: 600_000, giveUpMs: 1_800_000, pollMs: 2_000, backstopMs: 60_000,
    retryMs: [5_000, 20_000] });
  assert.equal(PUSH_RUN_LIMITS.giveUpMs, 30 * 60_000);
  const short = limitsFrom({ SONAH_PUSH_GIVE_UP_MS: '4000', SONAH_PUSH_REMOTE_WAIT_MS: '99999999', SONAH_PUSH_POLL_MS: 'x',
    SONAH_PUSH_RETRY_MS: '200' });
  assert.equal(short.giveUpMs, 4000);
  assert.equal(short.remoteWaitMs, 600_000, 'never longer');
  assert.equal(short.pollMs, 2_000);
  assert.deepEqual(short.retryMs, [200, 200]);
  // D227 review 0: nice on every platform, never macOS's background policy (`taskpolicy -b`), which starved the review
  // on a busy computer.
  assert.deepEqual(launchers(['node', 'sonah.js', 'push-run']).map((w) => w[0]), ['nice', 'node']);
  assert.deepEqual(launchers(['node', 'x'])[0][1], ['-n', '10', 'node', 'x']);
  assert.equal(launchers(['node', 'x']).flat(2).includes('taskpolicy'), false);
  assert.deepEqual(runEnv({ PATH: '/bin', GIT_DIR: '/x/.git', GIT_INDEX_FILE: 'i', GIT_SSH_COMMAND: 'ssh -i k',
    GIT_CONFIG_GLOBAL: '/g', NODE_TEST_CONTEXT: 'child', SSH_AUTH_SOCK: '/s' }), { PATH: '/bin',
    GIT_SSH_COMMAND: 'ssh -i k', GIT_CONFIG_GLOBAL: '/g', SSH_AUTH_SOCK: '/s' });
});

test('SIGTERM stops the runner: the call running ends, the run says stopped, and its ticket is not taken again', async (t) => {
  const s = await setup(t);
  await s.claude('gated');
  const head = await s.repo.commit('feature', MATH_V2);
  assert.equal(s.repo.push(['-q', 'origin', 'feature']).code, 0);
  const running = await waitFor(() => s.runOf(head, 'running'), { what: 'the run to draw' });
  const calls = join(s.repo.root, 'claude-calls.jsonl');
  const first = await waitFor(async () => {
    try { return JSON.parse((await readFile(calls, 'utf8')).split('\n')[0]); } catch { return null; }
  }, { what: 'a claude call' });
  process.kill(running.pid, 'SIGTERM');
  const stopped = await waitFor(() => s.runOf(head, 'stopped'), { what: 'stopped' });
  assert.equal(stopped.why, 'process_ended');
  await waitFor(() => !alive(running.pid) && !alive(first.pid), { what: 'the runner and its call to end', ms: 15_000 });
  assert.deepEqual(await waitingTickets(s.where, s.common), []);
  assert.equal(s.server.uploads.length, 0);
});

test('A5: connecting as another login ends what the old connection left: its waiting comments and its uploads that wait', async (t) => {
  const s = await setup(t, { hook: false, env: { SONAH_PUSH_RETRY_MS: '200' } });
  const { updateRuns, readRuns: runsOf } = await import('../src/team-home.js');
  await updateRuns(s.where, () => [{ id: 'aaaaaaaaaaaa', state: 'pending_upload', why: 'upload_failed', branch: 'f',
    sha: 'a'.repeat(40), server: s.server.url, login: 'octo', at: '2026-11-11T10:00:00.000Z' },
  { id: 'bbbbbbbbbbbb', state: 'done', why: 'uploaded', branch: 'g', sha: 'b'.repeat(40), server: s.server.url,
    login: 'octo', at: '2026-11-11T10:00:00.000Z' }]);
  const list = checkList({ repo: { owner: 'acme', name: 'widgets' }, total: 0, fixes: [] },
    { owner: 'acme', name: 'widgets' });
  const { saveWaiting } = await import('../src/fix-waiting.js');
  await saveWaiting(s.where, { server: s.server.url, login: 'octo' }, list);
  // the same login again keeps them
  const same = streams();
  assert.equal(await runConnectCommand(['--token', '--server', s.server.url, '--no-hook'], { ...same, env: s.env,
    interactive: true, ask: async () => true, readToken: async () => s.server.addToken(PERSON), cwd: s.repo.root }), 0,
  same.chunks.stderr);
  assert.equal((await runsOf(s.where)).runs[0].state, 'pending_upload');
  await stat(join(s.env.SONAH_HOME, 'team', 'waiting.json'));
  // another login ends them
  const other = streams();
  assert.equal(await runConnectCommand(['--token', '--server', s.server.url, '--no-hook'], { ...other, env: s.env,
    interactive: true, ask: async () => true, readToken: async () => s.server.addToken({ login: 'hubot', team: 'Acme',
      seat: 'paid' }), cwd: s.repo.root }), 0, other.chunks.stderr);
  const [pending, done] = (await runsOf(s.where)).runs;
  assert.deepEqual([pending.state, pending.why], ['failed', 'connection_changed']);
  assert.equal(done.state, 'done', 'a run that ended stays as it ended');
  await assert.rejects(stat(join(s.env.SONAH_HOME, 'team', 'waiting.json')));
});

// ---- D227 review (2026-11-11): each test fails with its fix taken out -----------------------------------------------

/** Whether a run has ended (no process works on it now). */
const ended = (r) => Boolean(r) && !['waiting', 'queued', 'running', 'uploading'].includes(r.state);
/** The calls the gated claude logged so far (as they started). */
async function gatedCalls(s) {
  try {
    return (await readFile(join(s.repo.root, 'claude-calls.jsonl'), 'utf8')).split('\n').filter(Boolean)
      .filter((line) => !JSON.parse(line).ended).length;
  } catch { return 0; }
}
/** The server's POST /api/uploads calls. */
const postsOf = (s) => s.server.calls.filter((c) => c.method === 'POST' && c.path === '/api/uploads');
/** `sonah connect --token` in a terminal that says yes, which must exit 0. */
async function connectToken(s, server, token) {
  const out = streams();
  const code = await runConnectCommand(['--token', '--server', server, '--no-hook'], { ...out, env: s.env,
    interactive: true, ask: async () => true, readToken: async () => token, cwd: s.repo.root });
  assert.equal(code, 0, out.chunks.stdout + out.chunks.stderr);
}

test('D227 review: after the queue, a repository\'s comments are asked again only under the connection that probed it',
  async (t) => {
  const s = await setup(t);
  await s.claude('gated');
  const other = await teamServer(t);
  const head = await s.repo.commit('feature', MATH_V2);
  assert.equal(s.repo.push(['-q', 'origin', 'feature']).code, 0);
  await waitFor(() => s.runOf(head, 'running'), { what: 'the run to draw' });
  await waitFor(async () => (await gatedCalls(s)) > 0, { what: 'a claude call' });
  // While the page is drawn, the person connects this computer to another team's server.
  await connectToken(s, other.url, other.addToken(PERSON));
  await writeFile(join(s.repo.root, 'claude-go'), '');
  const run = await waitFor(async () => { const r = await s.runOf(head); return ended(r) && r; }, { what: 'the end' });
  assert.deepEqual([run.state, run.why], ['failed', 'connection_changed']);
  await waitFor(() => runProcesses(s.repo.root).length === 0, { what: 'the runner to end' });
  assert.deepEqual(other.calls.filter((c) => c.path === '/api/fixes').map((c) => c.url), [],
    'the other server never hears of acme/widgets');
  assert.equal(s.server.calls.filter((c) => c.path === '/api/fixes').length, 1, 'the probe only');
});

test('D227 review: a review drawn while the same login connects again goes up with the new token, and marks nothing',
  async (t) => {
  const s = await setup(t);
  await s.claude('gated');
  const head = await s.repo.commit('feature', MATH_V2);
  assert.equal(s.repo.push(['-q', 'origin', 'feature']).code, 0);
  await waitFor(() => s.runOf(head, 'running'), { what: 'the run to draw' });
  await waitFor(async () => (await gatedCalls(s)) > 0, { what: 'a claude call' });
  // `sonah connect --token` as octo again: the new token is kept, then the old one revoked.
  const fresh = s.server.addToken(PERSON);
  await connectToken(s, s.server.url, fresh);
  assert.equal(s.server.live(s.token), false, 'the old token is revoked');
  // A 401 to the old token marks nothing: the connection holds another one.
  assert.equal(await markRefused({ server: s.server.url, login: 'octo', token: s.token }, s.where), false);
  await assert.rejects(stat(join(s.env.SONAH_HOME, 'team', 'refused.json')));
  await writeFile(join(s.repo.root, 'claude-go'), '');
  const run = await waitFor(async () => { const r = await s.runOf(head); return ended(r) && r; }, { what: 'the end' });
  assert.deepEqual([run.state, run.why], ['done', 'uploaded']);
  assert.deepEqual(postsOf(s).map((c) => c.authorization), [`Bearer ${fresh}`]);
  await assert.rejects(stat(join(s.env.SONAH_HOME, 'team', 'refused.json')));
  await waitFor(() => runProcesses(s.repo.root).length === 0, { what: 'the runner to end' });

  // The next push starts its review. A refused mark made while it draws (another repository's runner met a 401) sends
  // nothing more.
  await rm(join(s.repo.root, 'claude-go'));
  const calls = await gatedCalls(s);
  const next = await s.repo.commit('feature', `${MATH_V2}// two\n`);
  const p = s.repo.push(['-q', 'origin', 'feature']);
  assert.equal(p.stderr, `sonah: ${PRE_PUSH_WORDS.started(['feature'])}\n`);
  await waitFor(() => s.runOf(next, 'running'), { what: 'the next run to draw' });
  await waitFor(async () => (await gatedCalls(s)) > calls, { what: 'its claude call' });
  assert.equal(await markRefused((await readConnection(s.where)).connection, s.where), true);
  await writeFile(join(s.repo.root, 'claude-go'), '');
  const refused = await waitFor(async () => { const r = await s.runOf(next); return ended(r) && r; }, { what: 'end' });
  assert.deepEqual([refused.state, refused.why], ['failed', 'refused']);
  assert.equal(postsOf(s).length, 1, 'no upload after the mark');
});

test('D227 review: once an upload that waits is refused (401), no other upload that waits is sent', async (t) => {
  const s = await setup(t, { env: { SONAH_PUSH_RETRY_MS: '200' } });
  // Two branches of one push, each tried 3 times: both wait.
  for (let i = 0; i < 6; i++) s.server.once('POST', '/api/uploads', { status: 503 });
  const f = await s.repo.commit('f', `${MATH_V2}// f\n`);
  const g = await s.repo.commit('g', `${MATH_V2}// g\n`);
  assert.equal(s.repo.push(['-q', 'origin', 'f', 'g']).code, 0);
  await waitFor(async () => (await s.runOf(f, 'pending_upload')) && s.runOf(g, 'pending_upload'),
    { what: 'both wait' });
  await waitFor(() => runProcesses(s.repo.root).length === 0, { what: 'the first runner to end' });
  // The next push: its own upload goes through, then the first upload sent again is answered 401.
  s.server.once('POST', '/api/uploads', { status: 201, json: { url: `${s.server.url}/r/acme/widgets/b/h` } });
  s.server.once('POST', '/api/uploads', { status: 401, json: { error: 'bad_token' } });
  const before = postsOf(s).length;
  const h = await s.repo.commit('h', `${MATH_V2}// h\n`);
  assert.equal(s.repo.push(['-q', 'origin', 'h']).code, 0);
  await waitFor(() => s.runOf(h, 'done'), { what: 'h done' });
  await waitFor(() => runProcesses(s.repo.root).length === 0, { what: 'the second runner to end' });
  assert.equal(postsOf(s).length - before, 2, 'h, then one upload sent again; after its 401 nothing');
  const ends = [await s.runOf(f), await s.runOf(g)].map((r) => `${r.state} ${r.why}`).sort();
  assert.deepEqual(ends, ['failed refused', 'pending_upload upload_failed']);
  await stat(join(s.env.SONAH_HOME, 'team', 'refused.json'));
});

test("D227 review: an upload's 403 not_member stops the repository's next tickets from drawing, as the probe's does",
  async (t) => {
  // In no team, and the probe gets no answer it can read (a cold server): the first ticket draws.
  const s = await setup(t, { person: { login: 'nomad', team: null, seat: null } });
  s.server.once('GET', '/api/fixes', { status: 503, json: { error: 'busy' } });
  const shas = [];
  for (const b of ['a', 'b', 'c']) shas.push(await s.repo.commit(b, `${MATH_V2}// ${b}\n`));
  assert.equal(s.repo.push(['-q', 'origin', 'a', 'b', 'c']).code, 0);
  const runs = await waitFor(async () => {
    const all = await Promise.all(shas.map((sha) => s.runOf(sha)));
    return all.every(ended) && all;
  }, { what: 'the three runs to end' });
  for (const run of runs) assert.deepEqual([run.state, run.why], ['failed', 'not_member']);
  assert.equal(postsOf(s).length, 1, 'one review drawn and refused');
  assert.equal(runs.filter((r) => r.out !== null).length, 1, 'the other two drew nothing');
  assert.equal(s.server.calls.filter((c) => c.path === '/api/fixes').length, 1, 'one probe');
});

test('D227 review: an upload sent again is its sending process\'s in sonah status, and one cut off is sent by the next '
  + 'pass', async (t) => {
  const s = await setup(t, { env: { SONAH_PUSH_RETRY_MS: '200' } });
  for (let i = 0; i < 3; i++) s.server.once('POST', '/api/uploads', { status: 503 });
  const f = await s.repo.commit('feature', MATH_V2);
  assert.equal(s.repo.push(['-q', 'origin', 'feature']).code, 0);
  const first = await waitFor(() => s.runOf(f, 'pending_upload'), { what: 'f waits' });
  await waitFor(() => runProcesses(s.repo.root).length === 0, { what: 'the first runner to end' });
  // The next push's runner sends it again, and the server holds that call.
  s.server.once('POST', '/api/uploads', { status: 201, json: { url: `${s.server.url}/r/acme/widgets/b/g` } });
  s.server.once('POST', '/api/uploads', () => new Promise(() => {}));
  const g = await s.repo.commit('g', `${MATH_V2}// g\n`);
  assert.equal(s.repo.push(['-q', 'origin', 'g']).code, 0);
  await waitFor(() => s.runOf(g, 'done'), { what: 'g done' });
  const sending = await waitFor(() => s.runOf(f, 'uploading'), { what: 'f sent again' });
  await waitFor(() => postsOf(s).length === 5, { what: 'its call' });
  assert.notEqual(sending.pid, first.pid, 'the process that sends it now');
  const shown = JSON.parse((await s.status(['--json'])).stdout).runs.find((r) => r.sha === f);
  assert.equal(shown.state, 'uploading');
  // That runner is killed while it sends: the run waits for the next pass, which sends it.
  for (const target of [-sending.pid, sending.pid]) { try { process.kill(target, 'SIGKILL'); } catch { /* gone */ } }
  await waitFor(() => !alive(sending.pid), { what: 'the runner to end' });
  assert.equal((await s.runOf(f)).state, 'uploading');
  const h = await s.repo.commit('h', `${MATH_V2}// h\n`);
  assert.equal(s.repo.push(['-q', 'origin', 'h']).code, 0);
  const sent = await waitFor(() => s.runOf(f, 'done'), { what: 'f sent by the next pass' });
  assert.equal(sent.url, `${s.server.url}/r/acme/widgets/b/feature`);
  assert.ok(await s.runOf(h, 'done'));
});

test('D227 review: a ticket ended on the way never ends a newer push of its branch that took its file meanwhile',
  async (t) => {
  const s = await setup(t, { hook: false, listed: true });
  // feature's first tip is on the remote; the old ticket's commit never reached it.
  const shown = await s.repo.commit('feature', MATH_V2);
  assert.equal(s.repo.push(['-q', 'origin', 'feature']).code, 0);
  const unseen = await s.repo.commit('feature', `${MATH_V2}// never pushed\n`);
  const dir = await realpath(s.repo.work);
  const fields = { common: s.common, dir, branch: 'feature', remote: 'origin', server: s.server.url, login: 'octo' };
  const old = await leaveTicket(s.where, { ...fields, sha: unseen, at: Date.now() - 5_000 });
  // A runner in a process of its own (it lowers its priority) whose git, once it reads the old ticket's
  // remote-tracking branch, finds that a newer push of the branch has replaced the ticket's file meanwhile.
  const src = (name) => JSON.stringify(new URL(`../src/${name}`, import.meta.url).href);
  const script = join(s.repo.root, 'swap-run.mjs');
  await writeFile(script, `import { runPushRun } from ${src('push-run.js')};
import { leaveTicket } from ${src('push-queue.js')};
import { gitOut } from ${src('team-git.js')};
const fields = JSON.parse(process.argv[2]);
let newer = null;
const git = async (dir, args, options) => {
  const out = await gitOut(dir, args, options);
  if (newer === null && args.some((a) => String(a).startsWith('refs/remotes/origin/feature')))
    newer = (await leaveTicket({ env: process.env }, { ...fields, at: Date.now() })).ticket;
  return out;
};
await runPushRun(['--repo', fields.dir], { git, draw: async () => ({ status: 'failed', code: 'call_failed' }),
  limits: { remoteWaitMs: 1000, giveUpMs: 600000, pollMs: 50, backstopMs: 60000, retryMs: [50, 50] }, exit: () => {} });
process.stdout.write(JSON.stringify(newer));
`);
  // Not spawnSync: the stand-in server in this process answers the runner's calls meanwhile.
  const r = await new Promise((done) => {
    const child = spawn(process.execPath, [script, JSON.stringify({ ...fields, sha: shown })], { env: s.env,
      stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '', stderr = '';
    child.stdout.setEncoding('utf8').on('data', (c) => { stdout += c; });
    child.stderr.setEncoding('utf8').on('data', (c) => { stderr += c; });
    child.on('close', (status) => done({ status, stdout, stderr }));
  });
  assert.equal(r.status, 0, r.stderr);
  const newer = JSON.parse(r.stdout);
  assert.equal(newer.sha, shown);
  const runs = await s.runs();
  const oldRun = runs.find((x) => x.id === old.ticket.id), newRun = runs.find((x) => x.id === newer.id);
  assert.deepEqual([oldRun.state, oldRun.why], ['replaced', 'newer_push']);
  assert.deepEqual([newRun.state, newRun.why, newRun.code], ['failed', 'draw_failed', 'call_failed'],
    'the newer push was reviewed in its own turn');
  assert.deepEqual(await waitingTickets(s.where, s.common), []);
  assert.deepEqual(s.server.calls.map((c) => `${c.method} ${c.path} ${c.query.owner ?? ''}`),
    ['GET /api/fixes acme', 'GET /api/fixes acme'], 'its probe, and the comments after the queue');
});

test('D227 review: the runs of dropped tickets end (disconnect, another login, hook remove --push), and a runner keeps '
  + 'its lock', async (t) => {
  const s = await setup(t);
  // The test holds the repository's runner, so each push's run waits.
  const runner = await takeRunner(s.where, s.common);
  t.after(() => runner?.release());
  const pushOf = async (branch) => {
    const sha = await s.repo.commit(branch, `${MATH_V2}// ${branch}\n`);
    const p = s.repo.push(['-q', 'origin', branch]);
    assert.equal(p.stderr, `sonah: ${PRE_PUSH_WORDS.behind([branch])}\n`);
    assert.equal((await s.runOf(sha)).state, 'waiting');
    return sha;
  };
  const endOf = async (sha) => { const r = await s.runOf(sha); return [r.state, r.why]; };
  const a = await pushOf('a');
  const gone = streams();
  assert.equal(await runDisconnectCommand([], { ...gone, env: s.env }), 0, gone.chunks.stderr);
  assert.deepEqual(await endOf(a), ['failed', 'connection_changed']);
  assert.equal(await runnerGoing(s.where, s.common), true, 'disconnect leaves the runner its lock');
  // Connected again as octo, a push waits; connecting as another login ends it.
  await writeConnection({ server: s.server.url, token: s.server.addToken(PERSON), login: 'octo' }, s.where);
  const b = await pushOf('b');
  await connectToken(s, s.server.url, s.server.addToken({ login: 'hubot', team: 'Acme', seat: 'paid' }));
  assert.deepEqual(await endOf(b), ['failed', 'connection_changed']);
  // `sonah hook remove --push` drops the repository's tickets: their runs are skipped.
  const c = await pushOf('c');
  const removed = await runEntry(['hook', 'remove', '--push'], { env: s.env, cwd: s.repo.work });
  assert.equal(removed.code, 0, removed.stdout + removed.stderr);
  assert.deepEqual(await endOf(c), ['skipped', 'hook_removed']);
  assert.equal(whyWords(await s.runOf(c)), PUSH_RUN_WORDS.why.hook_removed);
  assert.deepEqual(await waitingTickets(s.where, s.common), []);
  assert.equal(await runnerGoing(s.where, s.common), true);
});

// ---- D227 review 0 (2026-11-11): a test that failed only under load ------------------------------------------------

test('D227 review 0: a run leaves running before its job slot goes, so no two runs are running at once', async (t) => {
  const s = await setup(t, { hook: false, listed: true });
  const dir = await realpath(s.repo.work);
  const fields = { common: s.common, dir, remote: 'origin', server: s.server.url, login: 'octo' };
  const shas = {};
  for (const [i, branch] of ['a', 'b'].entries()) {
    shas[branch] = await s.repo.commit(branch, `${MATH_V2}// ${branch}\n`);
    assert.equal(s.repo.push(['-q', 'origin', branch]).code, 0);
    await leaveTicket(s.where, { ...fields, branch, sha: shas[branch], at: Date.now() - 2_000 + i });
  }
  // A runner in a process of its own (it lowers its priority) whose job slot writes down, each time it goes, the state
  // of each run then. Its drawings: a's waits for its folder, then fails; b's is complete (its folder holds nothing, so
  // there is nothing to send).
  const src = (name) => JSON.stringify(new URL(`../src/${name}`, import.meta.url).href);
  const script = join(s.repo.root, 'slot-run.mjs');
  await writeFile(script, `import { runPushRun } from ${src('push-run.js')};
import { takeJobSlot } from ${src('push-queue.js')};
import { readRuns } from ${src('team-home.js')};
const draws = [{ status: 'failed', code: 'folder_in_use' }, { status: 'failed', code: 'call_failed' },
  { status: 'complete', run: { totals: {} } }];
const seen = [];
const slot = async (where) => {
  const lock = await takeJobSlot(where);
  let gone = false;
  return lock && { release: async () => {
    if (gone) return;
    gone = true;
    seen.push(Object.fromEntries((await readRuns(where)).runs.map((r) => [r.branch, [r.state, r.why]])));
    await lock.release();
  } };
};
await runPushRun(['--repo', process.argv[2]], { draw: async () => draws.shift(), slot,
  limits: { remoteWaitMs: 60000, giveUpMs: 600000, pollMs: 50, backstopMs: 60000, retryMs: [50, 50] }, exit: () => {} });
process.stdout.write(JSON.stringify(seen));
`);
  // Not spawnSync: the stand-in server in this process answers the runner's calls meanwhile.
  const r = await new Promise((done) => {
    const child = spawn(process.execPath, [script, dir], { env: s.env, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '', stderr = '';
    child.stdout.setEncoding('utf8').on('data', (c) => { stdout += c; });
    child.stderr.setEncoding('utf8').on('data', (c) => { stderr += c; });
    child.on('close', (status) => done({ status, stdout, stderr }));
  });
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(JSON.parse(r.stdout), [
    { a: ['queued', 'folder_in_use'], b: ['queued', null] },
    { a: ['failed', 'draw_failed'], b: ['queued', null] },
    { a: ['failed', 'draw_failed'], b: ['uploading', null] },
  ], 'the slot goes once the run waits for its folder, has ended, or is sent');
  const endOf = async (branch) => { const x = await s.runOf(shas[branch]); return [x.state, x.why, x.code]; };
  assert.deepEqual(await endOf('a'), ['failed', 'draw_failed', 'call_failed']);
  assert.deepEqual(await endOf('b'), ['failed', 'draw_failed', 'visual_failed']);
});

// ---- D227 review 1 (2026-11-12): each test fails with its fix taken out ---------------------------------------------

/** Waits until the run of `sha` is `queued` for the laptop's job slot (its ticket taken, its probe made): that run. */
const queuedForSlot = (s, sha) => waitFor(async () => {
  const run = await s.runOf(sha, 'queued');
  return run?.why === 'job_slot' && run;
}, { what: 'a run waiting for the job slot' });
/** Kills a runner and its process group, and waits until it is gone. */
async function killRunner(pid) {
  for (const target of [-pid, pid]) { try { process.kill(target, 'SIGKILL'); } catch { /* gone */ } }
  await waitFor(() => !alive(pid), { what: 'the runner to end' });
}

test('D227 review 1: once the push hook is off, a ticket the runner took draws and sends nothing, and an upload that '
  + 'waits ends', async (t) => {
  const s = await setup(t, { env: { SONAH_PUSH_RETRY_MS: '200' } });
  for (let i = 0; i < 3; i++) s.server.once('POST', '/api/uploads', { status: 503 });
  const f = await s.repo.commit('feature', MATH_V2);
  assert.equal(s.repo.push(['-q', 'origin', 'feature']).code, 0);
  await waitFor(() => s.runOf(f, 'pending_upload'), { what: 'f waits to be sent' });
  await waitFor(() => runProcesses(s.repo.root).length === 0, { what: 'the first runner to end' });
  // The test holds the laptop's job slot: the next push's runner takes its ticket, probes, and waits for the slot.
  let slot = await takeJobSlot(s.where);
  t.after(() => slot?.release());
  const calls = (await claudeLog(s)).length;
  const g = await s.repo.commit('g', `${MATH_V2}// g\n`);
  assert.equal(s.repo.push(['-q', 'origin', 'g']).code, 0);
  const queued = await queuedForSlot(s, g);
  assert.notEqual(queued.pid, null, 'the runner took its ticket');
  const before = s.server.calls.length;
  const removed = await runEntry(['hook', 'remove', '--push'], { env: s.env, cwd: s.repo.work });
  assert.equal(removed.code, 0, removed.stdout + removed.stderr);
  const waited = await s.runOf(f);
  assert.deepEqual([waited.state, waited.why], ['skipped', 'hook_removed'], 'the upload that waited ends');
  await slot.release();
  slot = null;
  const run = await waitFor(async () => { const r = await s.runOf(g); return ended(r) && r; }, { what: 'g to end' });
  assert.deepEqual([run.state, run.why], ['skipped', 'hook_removed']);
  assert.equal(whyWords(run), PUSH_RUN_WORDS.why.hook_removed);
  await waitFor(() => runProcesses(s.repo.root).length === 0, { what: 'the runner to end' });
  assert.equal((await claudeLog(s)).length, calls, 'no claude call once the hook is off');
  assert.deepEqual(s.server.calls.slice(before).map((c) => `${c.method} ${c.path}`), [], 'nothing sent once it is off');
  assert.equal((await s.runOf(f)).state, 'skipped');
});

test('D227 review 1: a drawing that runs when the push hook is turned off stops: its call ends, none starts after it',
  async (t) => {
  const s = await setup(t);
  await s.claude('gated');
  const head = await s.repo.commit('feature', MATH_V2);
  assert.equal(s.repo.push(['-q', 'origin', 'feature']).code, 0);
  await waitFor(() => s.runOf(head, 'running'), { what: 'the run to draw' });
  await waitFor(async () => (await gatedCalls(s)) > 0, { what: 'a claude call' });
  const removed = await runEntry(['hook', 'remove', '--push'], { env: s.env, cwd: s.repo.work });
  assert.equal(removed.code, 0, removed.stdout + removed.stderr);
  // The calls still wait for claude-go: the run ends without them.
  const run = await waitFor(async () => { const r = await s.runOf(head); return ended(r) && r; },
    { what: 'the run to end while its calls wait', ms: 20_000 });
  assert.deepEqual([run.state, run.why], ['skipped', 'hook_removed']);
  await waitFor(() => runProcesses(s.repo.root).length === 0, { what: 'the runner and its calls to end' });
  const started = await gatedCalls(s);
  await writeFile(join(s.repo.root, 'claude-go'), '');
  await sleep(1000);
  assert.equal(await gatedCalls(s), started, 'no call after it stopped');
  assert.deepEqual(postsOf(s), []);
});

test('D227 review 1: once sonah disconnect ran, a ticket the runner took draws nothing', async (t) => {
  const s = await setup(t);
  let slot = await takeJobSlot(s.where);
  t.after(() => slot?.release());
  const g = await s.repo.commit('g', `${MATH_V2}// g\n`);
  assert.equal(s.repo.push(['-q', 'origin', 'g']).code, 0);
  await queuedForSlot(s, g);
  const before = s.server.calls.length;
  const gone = streams();
  assert.equal(await runDisconnectCommand([], { ...gone, env: s.env }), 0, gone.chunks.stderr);
  await slot.release();
  slot = null;
  const run = await waitFor(async () => { const r = await s.runOf(g); return ended(r) && r; }, { what: 'g to end' });
  assert.deepEqual([run.state, run.why], ['failed', 'connection_changed']);
  await waitFor(() => runProcesses(s.repo.root).length === 0, { what: 'the runner to end' });
  assert.deepEqual(await claudeLog(s), [], 'no claude call after the disconnect');
  assert.deepEqual(s.server.calls.slice(before).map((c) => `${c.method} ${c.path}`), ['DELETE /api/token'],
    'the disconnect\'s own call only');
});

test('D227 review 1: a list of waiting comments that comes after sonah disconnect, or for another login, is not kept',
  async (t) => {
  const s = await setup(t);
  let answer;
  const held = new Promise((done) => { answer = done; });
  s.server.once('GET', '/api/fixes', () => held);
  const g = await s.repo.commit('g', `${MATH_V2}// g\n`);
  assert.equal(s.repo.push(['-q', 'origin', 'g']).code, 0);
  await waitFor(() => s.server.calls.some((c) => c.path === '/api/fixes'), { what: 'the probe' });
  const gone = streams();
  assert.equal(await runDisconnectCommand([], { ...gone, env: s.env }), 0, gone.chunks.stderr);
  answer({ status: 200, json: { repo: { owner: 'acme', name: 'widgets' }, total: 0, fixes: [] } });
  const run = await waitFor(async () => { const r = await s.runOf(g); return ended(r) && r; }, { what: 'g to end' });
  assert.deepEqual([run.state, run.why], ['failed', 'connection_changed']);
  await waitFor(() => runProcesses(s.repo.root).length === 0, { what: 'the runner to end' });
  const cache = join(s.env.SONAH_HOME, 'team', 'waiting.json');
  await assert.rejects(stat(cache), 'the answer after the disconnect is not kept');
  // Connected as hubot, whose list is kept: an answer asked under octo leaves it as it is.
  const hubot = { login: 'hubot', team: 'Acme', seat: 'paid' };
  await writeConnection({ server: s.server.url, token: s.server.addToken(hubot), login: 'hubot' }, s.where);
  const list = checkList({ repo: { owner: 'acme', name: 'widgets' }, total: 2, fixes: [] },
    { owner: 'acme', name: 'widgets' });
  assert.equal(await saveWaiting(s.where, { server: s.server.url, login: 'hubot' }, list), true);
  const kept = await readFile(cache, 'utf8');
  assert.equal(await saveWaiting(s.where, { server: s.server.url, login: 'octo' }, { ...list, total: 7 }), false);
  assert.equal(await readFile(cache, 'utf8'), kept);
});

test('D227 review 1: a first upload cut off is sent by the next pass; sonah disconnect ends one cut off so',
  async (t) => {
  const s = await setup(t);
  s.server.once('POST', '/api/uploads', () => new Promise(() => {}));
  const f = await s.repo.commit('feature', MATH_V2);
  assert.equal(s.repo.push(['-q', 'origin', 'feature']).code, 0);
  const sending = await waitFor(() => s.runOf(f, 'uploading'), { what: 'f sent' });
  await waitFor(() => postsOf(s).length === 1, { what: 'its call' });
  // The runner ends while it sends (the computer shut down): its taken ticket stays for the next runner to find.
  await killRunner(sending.pid);
  assert.equal((await s.runOf(f)).state, 'uploading');
  const g = await s.repo.commit('g', `${MATH_V2}// g\n`);
  assert.equal(s.repo.push(['-q', 'origin', 'g']).code, 0);
  await waitFor(() => s.runOf(g, 'done'), { what: 'g done' });
  await waitFor(() => runProcesses(s.repo.root).length === 0, { what: 'the second runner to end' });
  const sent = await s.runOf(f);
  assert.deepEqual([sent.state, sent.why, sent.url], ['done', 'uploaded', `${s.server.url}/r/acme/widgets/b/feature`],
    'sent by the next pass, not stopped');
  assert.deepEqual(s.server.uploads.map((u) => u.head), [g, f]);

  // One cut off the same way waits to be sent: sonah disconnect ends it, and a new connection of the same login does
  // not send it (A5).
  s.server.once('POST', '/api/uploads', () => new Promise(() => {}));
  const h = await s.repo.commit('h', `${MATH_V2}// h\n`);
  assert.equal(s.repo.push(['-q', 'origin', 'h']).code, 0);
  const cut = await waitFor(() => s.runOf(h, 'uploading'), { what: 'h sent' });
  await waitFor(() => postsOf(s).length === 4, { what: 'its call' });
  await killRunner(cut.pid);
  const gone = streams();
  assert.equal(await runDisconnectCommand([], { ...gone, env: s.env }), 0, gone.chunks.stderr);
  const endedRun = await s.runOf(h);
  assert.deepEqual([endedRun.state, endedRun.why], ['failed', 'connection_changed']);
  await writeConnection({ server: s.server.url, token: s.server.addToken(PERSON), login: 'octo' }, s.where);
  const k = await s.repo.commit('k', `${MATH_V2}// k\n`);
  assert.equal(s.repo.push(['-q', 'origin', 'k']).code, 0);
  await waitFor(() => s.runOf(k, 'done'), { what: 'k done' });
  await waitFor(() => runProcesses(s.repo.root).length === 0, { what: 'the third runner to end' });
  assert.deepEqual([(await s.runOf(h)).state, (await s.runOf(h)).why], ['failed', 'connection_changed']);
  assert.deepEqual(s.server.uploads.map((u) => u.head), [g, f, k], 'h is never sent');
});

test('D227 review (second look 1): a push to a remote given as a host:path target keeps its run, and the review reads '
  + 'the repository out of the target', async (t) => {
  const s = await setup(t);
  // This test holds the repository's runner, so the push's ticket and its run stay as the hook left them.
  const runner = await takeRunner(s.where, s.common);
  t.after(() => runner.release());
  const head = await s.repo.commit('feature', MATH_V2);
  // git's scp-style target, with no user named: git reads the colon before any slash and pushes over ssh, and the
  // hook gets this string where it gets a remote's name.
  const target = 'git.example.invalid:/acme/widgets.git';
  const pushed = s.repo.push(['-q', target, 'HEAD:refs/heads/feature']);
  assert.equal(pushed.code, 0, pushed.stderr);
  assert.equal(pushed.stderr, `sonah: ${PRE_PUSH_WORDS.behind(['feature'])}\n`);
  const ticket = (await waitingTickets(s.where, s.common)).find((x) => x.branch === 'feature');
  assert.equal(ticket.remote, target, 'the ticket keeps what git gave the hook');
  // The run's row is kept, and names no remote: a target is a URL, not a remote's name, so runs.json holds null for
  // it as it does for ssh://host/path. Read as a name, the row was dropped at every write of it and the push left no
  // record: `sonah status` showed nothing, and a pending upload of it could never be found to be sent.
  const run = await s.runOf(head);
  assert.ok(run, 'the push left a run of its branch in runs.json');
  assert.deepEqual([run.state, run.branch, run.remote], ['waiting', 'feature', null]);
  const listed = await s.status();
  assert.ok(listed.stdout.includes(`  - feature ${head.slice(0, 7)}: waiting\n`), listed.stdout);
  assert.deepEqual(JSON.parse((await s.status(['--json'])).stdout).runs.map((r) => r.sha), [head]);
  // And the review of that push names the repository: the target is its own push URL (no `git remote get-url` of a
  // remote of that name, which has none), and `remoteRepository` reads git's ssh form with no user already.
  assert.equal(isRemoteName(target), false);
  assert.equal(await pushUrlOf(s.repo.work, target, { env: s.env, git: gitOut }), target);
  assert.deepEqual(remoteRepository(target), { owner: 'acme', name: 'widgets' });
});
