// D228 (item 10, C5): `sonah share`, which puts a page that plain `sonah`, `sonah visual` or a push run already drew on
// this computer on the connected Sonah Team server, with no push. Modelled on d227-push-run.test.js: real git in
// throwaway repositories under a sealed HOME and SONAH_HOME with spaces in their paths, whose push remote
// ssh://example.invalid/acme/widgets.git a stand-in for ssh serves (team-helpers.js `pushRepo`); the pages drawn by the
// real `sonah visual` with the stand-in claude (packages/visual/test/fake-claude.mjs); a stand-in Sonah Team server on
// 127.0.0.1. No model, no network: every call goes to that stand-in, and a share makes no seat call and no probe.
// Decision 15 (amending D221) is here too: with no --server, a page's "Save online" and "Invite your team" name the
// server this computer is connected to.
// D228 review 1: which review of a branch took another's place is read from the commits, not from the times alone (a
// share puts up the page of any commit at any time); a share says a share's words, not a push's; a folder held to the
// deadline leaves the review waiting to be sent; and one run is sent by one process.
// D228 review 2: a pass takes one newest review of a branch, so three that wait and stand in a ring do not all end
// `replaced` with none sent; and a share that gave up on the page's folder says so in its own words.
// D228 review 4: the commit the branch holds says which review of it took another's place, before the commits of the
// two and their times; a pass sends no review the commits say is superseded; and it writes `replaced` only over a run
// that is still the one it read.
// D228 review 5: that commit is read from the branch on the remote, which is the branch a review is kept under and the
// only one a push moves, so these tests push to the stand-in remote where review 4's read the working copy's own
// branch; and the pass's other end-writes are guarded as its `replaced` write is.
// D228 review (second look 2): the review a run belongs to is the one the server keeps — its repository as the server
// keys it (the owner and name folded to lower case) and its branch — and which review of it is the newest is read
// over every clone of the repository on this computer; the commit that review's branch holds is read from a
// remote-tracking branch only, never from a refspec that maps the branch into this computer's own namespace.
// D228 review (second look 2, review 1): that commit is read of the remotes this clone's own runs name, and asked of
// the remote itself as soon as another clone's run is in the set; the review of the commit the remote holds takes the
// place of a review of any other, whether or not git here can relate the two; and where neither of git's orders can
// say a word, this clone's own waiting review is still sent instead of being left to another clone for good.
// D228 review (second look 2, review 2): that last order is gone again — it was each pass's own, so two clones each
// elected their own run and both POSTed the one review the server keeps, and a pass put its own older page over a
// review another clone had already put up. The read of the branch answers where something can still be said: a run
// that names no remote is left out of the names instead of turning it off, the ref this clone keeps answers for a
// remote that gives no answer at all, and a name nothing can answer for leaves it null for the whole review. And a
// share says the page's link before it orders the reviews that wait against it, under a budget of its own.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { once } from 'node:events';
import { chmod, mkdir, readFile, readdir, realpath, rm, stat, utimes, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SHARE_PROBLEMS } from '../../evidence/src/ledger.js';
import { FINDINGS_SYSTEM, STORY_SYSTEM } from '../../visual/src/requests.mjs';
import { runStatusCommand } from '../src/connect-command.js';
import { PUSH_RUN_WORDS, connectionStill, limitsFrom, pushedTip, sendFolder, takesPlaceOf,
  whyWords } from '../src/push-run.js';
import { SHARE_DEADLINE_MS, SHARE_ORDER_MS, SHARE_USAGE, SHARE_WORDS, runShareCommand,
  shareDeadlineMs } from '../src/share-command.js';
import { gitOut, trackingRef } from '../src/team-git.js';
import { forgetConnection, markRefused, readRuns, updateHooks, updateRun, waitsToSend,
  writeConnection } from '../src/team-home.js';
import { drawVisualPage, VISUAL_DEFAULT_MODEL, VISUAL_DEFAULT_SERVER, visualOutDir } from '../src/visual-command.js';
import { processStart, takeVisualLock } from '../src/visual-lock.js';
import { PUSH_REMOTE, filesUnder, pushRepo, runEntry, sealedHome, streams,
  teamServer } from './team-helpers.js';

const FAKE = fileURLToPath(new URL('../../visual/test/fake-claude.mjs', import.meta.url));
const sq = (text) => `'${String(text).replace(/'/g, "'\\''")}'`;
const firstLine = (s) => s.split('\n')[0];
const short = (sha) => sha.slice(0, 7);
const PERSON = { login: 'octo', team: 'Acme', seat: 'paid' };
const MATH_V2 = "export const add = (a, b) => {\n  if (typeof a !== 'number' || typeof b !== 'number') throw new "
  + "TypeError('add needs numbers');\n  return a + b;\n};\nexport const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, "
  + 'x));\n';

/** Answers that pass the checks for any change: a story, no findings and no function notes. */
const genericRules = () => [
  { when: firstLine(STORY_SYSTEM), text: JSON.stringify({ oneLine: 'add checks its inputs, and clamp is new.',
    ask: 'Make add refuse non-numbers and add clamp.', beforeNow: [{ before: 'add took anything',
      now: 'add refuses non-numbers' }], flows: [], glossary: [] }) },
  { when: firstLine(FINDINGS_SYSTEM), text: JSON.stringify({ findings: [] }) },
  { text: JSON.stringify({ functions: [] }) },
];

/**
 * A sealed home with a repository connected to a stand-in server, and no push hook (`sonah share` needs none): `{ home,
 * repo, server, token, where, common, env, place, folderOf(base, head), runs(), runOf(state?), visual(args),
 * share(args, cwd), status(args) }`. `place` is Sonah's visual folder of the repository, which `share` reads for the
 * pages of HEAD; `folderOf` is the folder `sonah visual` draws a range into.
 */
async function setup(t, { person = PERSON, env: extraEnv = {}, connect = true } = {}) {
  const home = await sealedHome(t, 'sonah d228 ');
  const repo = await pushRepo(home, { env: { SONAH_PUSH_RETRY_MS: '200', ...extraEnv } });
  const server = await teamServer(t);
  const token = server.addToken(person);
  const where = { env: repo.env };
  const top = await realpath(repo.work);
  const common = await realpath(join(repo.work, '.git'));
  if (connect) await writeConnection({ server: server.url, token, login: person.login }, where);
  await writeFile(join(repo.root, 'fake-claude.json'), JSON.stringify({ rules: genericRules() }));
  const claudeFile = join(repo.root, 'bin', 'claude');
  await writeFile(claudeFile, `#!/bin/sh\nexec ${sq(process.execPath)} ${sq(FAKE)} "$@"\n`);
  await chmod(claudeFile, 0o755);
  const folderOf = (base, head) => visualOutDir({ top, base, head, model: VISUAL_DEFAULT_MODEL, env: repo.env });
  const runs = async () => (await readRuns(where)).runs;
  const runOf = async (state) => (await runs()).find((r) => !state || r.state === state);
  const status = async (args = []) => {
    const out = streams();
    const code = await runStatusCommand(args, { env: repo.env, stdout: out.stdout, stderr: out.stderr,
      git: (dir, a) => new Promise((done) => done(spawnSync('git', ['-C', dir, ...a], { env: repo.env,
        encoding: 'utf8' }).stdout ?? null)) });
    return { code, ...out.chunks };
  };
  return { home, repo, server, token, where, common, top, env: repo.env, folderOf, runs, runOf, status,
    place: dirname(folderOf('0'.repeat(40), '0'.repeat(40))),
    visual: (args, cwd = repo.work) => runEntry(['visual', ...args], { env: repo.env, cwd }),
    share: (args = [], cwd = repo.work) => runEntry(['share', ...args], { env: repo.env, cwd }) };
}

/** The routes the stand-in server was called on, in order. */
const routesOf = (server) => server.calls.map((c) => `${c.method} ${c.path}`);
/** Sets the time of a folder's run.json, which `share` reads to find the newest page. */
const drawnAt = (dir, seconds) => utimes(join(dir, 'run.json'), new Date(seconds * 1000), new Date(seconds * 1000));
/** The two lines a problem of `sonah share` says: the problem and its fix. */
const saidOf = (code, ...args) => `${typeof SHARE_WORDS.problem[code] === 'function'
  ? SHARE_WORDS.problem[code](...args) : SHARE_WORDS.problem[code]}\nFix: ${SHARE_WORDS.fix[code]}\n`;

test('a page drawn here goes up: the link, the run, the log, no seat call and no probe, and the token nowhere else',
  async (t) => {
    const s = await setup(t, { env: { ANTHROPIC_API_KEY: 'sk-ant-test-not-a-key' } });
    const base = s.repo.git(['rev-parse', 'main']);
    const head = await s.repo.commit('feature', MATH_V2);
    const drawn = await s.visual(['main..feature']);
    assert.equal(drawn.code, 0, drawn.stderr);
    const outDir = s.folderOf(base, head);
    assert.deepEqual(routesOf(s.server), [], 'drawing a page calls no server');

    const shared = await s.share();
    assert.equal(shared.code, 0, shared.stderr);
    const sent = routesOf(s.server);
    const run = await s.runOf('shared');
    assert.equal(shared.stdout, `${SHARE_WORDS.sending(outDir)}\n`
      + `${SHARE_WORDS.shared(s.server.url, 'feature')}\npage: ${run.url}\n`);
    assert.equal(shared.stderr, '');
    // The page, its data and its sessions, as a push run sends them.
    assert.equal(s.server.uploads.length, 1);
    const up = s.server.uploads[0];
    assert.deepEqual(up.repo, { owner: 'acme', name: 'widgets' });
    assert.equal(up.branch, 'feature');
    assert.equal(up.head, head);
    assert.equal(up.base, base);
    assert.match(up.page, /^<!doctype html>/i);
    assert.equal(up.run.status, 'complete');
    assert.deepEqual(Object.keys(up).sort(), ['base', 'branch', 'facts', 'findings', 'head', 'meaning', 'page', 'repo',
      'run', 'sessions']);
    assert.equal(run.url, `${s.server.url}/r/acme/widgets/b/feature`);
    assert.equal(run.why, 'uploaded');
    assert.equal(run.repo, 'acme/widgets');
    assert.equal(run.branch, 'feature');
    assert.equal(run.sha, head);
    assert.equal(run.base, base);
    assert.equal(run.out, outDir);
    assert.equal(run.common, s.common);
    assert.equal(run.dir, s.top);
    assert.equal(run.server, s.server.url);
    assert.equal(run.login, 'octo');
    // The run names its log, as a push run's does, so `sonah status` shows it.
    assert.equal(run.log, join(s.env.SONAH_HOME, 'team', 'logs', `widgets-${head}.log`));
    assert.match(await readFile(run.log, 'utf8'), /sonah share: acme\/widgets feature/);
    assert.match(await readFile(run.log, 'utf8'), new RegExp(`shared: ${run.url}`));
    assert.equal((await stat(run.log)).mode & 0o777, 0o600);
    const text = await s.status();
    assert.ok(text.stdout.includes(`  acme/widgets feature ${short(head)}: shared\n`
      + `    ${PUSH_RUN_WORDS.why.uploaded(s.server.url)}\n    page: ${run.url}\n    log: ${run.log}\n`), text.stdout);

    // One call, under the token in the header only: no seat call, no probe of the waiting comments (`sonah status`
    // asked whose the token is after it).
    assert.deepEqual(sent, ['POST /api/uploads']);
    for (const c of s.server.calls) {
      assert.equal(c.authorization, `Bearer ${s.token}`);
      assert.equal(c.url.includes(s.token), false);
      assert.equal(c.userAgent, 'getsonah');
    }
    // The token is in the connection file and nowhere else: not in the output, the log, the runs or the page.
    const holders = (await filesUnder(s.repo.root)).filter((f) => f.text.includes(s.token)).map((f) => f.path);
    assert.deepEqual(holders, [join(s.repo.root, 'sonah home', 'team', 'connection.json')]);
    for (const stream of [shared.stdout, shared.stderr, drawn.stdout, drawn.stderr, text.stdout])
      assert.equal(stream.includes(s.token), false);
    assert.equal(SHARE_PROBLEMS.every((code) => Object.hasOwn(SHARE_WORDS.problem, code)
      && Object.hasOwn(SHARE_WORDS.fix, code)), true);
    assert.deepEqual(Object.keys(SHARE_WORDS.problem).sort(), [...SHARE_PROBLEMS].sort());
  });

test('a usage error and the connection: each exit 2, and a refused connection stops a share before it reads the '
  + 'repository', async (t) => {
  const s = await setup(t, { connect: false });
  for (const [args, problem] of [[['--bogus'], 'unknown option --bogus'], [['feature'], 'it takes no argument'],
    [['--dir'], '--dir needs a value'], [['--branch', '--repo'], '--branch needs a value'],
    [['--dir', 'a', '--dir', 'b'], '--dir is given twice']]) {
    const bad = await s.share(args);
    assert.equal(bad.code, 2, args.join(' '));
    assert.equal(bad.stderr, `sonah share: ${problem}.\nusage: ${SHARE_USAGE}\n`);
    assert.equal(bad.stdout, '');
  }
  // No connection: nothing of the repository is read, and nothing is said about its pages.
  const none = await s.share();
  assert.equal(none.code, 2);
  assert.equal(none.stderr, `${PUSH_RUN_WORDS.why.not_connected}\n`);
  // A connection file Sonah cannot read.
  await mkdir(join(s.env.SONAH_HOME, 'team'), { recursive: true, mode: 0o700 });
  await writeFile(join(s.env.SONAH_HOME, 'team', 'connection.json'), 'not a connection\n', { mode: 0o600 });
  const unreadable = await s.share();
  assert.equal(unreadable.code, 2);
  assert.equal(unreadable.stderr, `${PUSH_RUN_WORDS.why.connection_unreadable}\n`);
  // A connection the server no longer takes: the share stops with no git call and no call to the server.
  await writeConnection({ server: s.server.url, token: s.token, login: 'octo' }, s.where);
  assert.equal(await markRefused({ server: s.server.url, login: 'octo', token: s.token }, s.where), true);
  let asked = 0;
  const out = streams();
  const code = await runShareCommand([], { env: s.env, cwd: s.repo.work, stdout: out.stdout, stderr: out.stderr,
    git: () => { asked += 1; return Promise.resolve(null); }, fetch: () => Promise.reject(new Error('no call')) });
  assert.equal(code, 2);
  assert.equal(out.chunks.stderr, `${PUSH_RUN_WORDS.why.refused(s.server.url)}\n`);
  assert.equal(asked, 0, 'the connection comes first');
  assert.deepEqual(routesOf(s.server), []);
  assert.deepEqual(await s.runs(), []);
});

test('what stops a share of a repository, and its exit code: no page of HEAD, a folder that is no page, another '
  + 'repository, a branch, a remote, a folder in use and a drawing that fails', async (t) => {
  const s = await setup(t);
  const base = s.repo.git(['rev-parse', 'main']);
  const head = await s.repo.commit('feature', MATH_V2);
  // Exit 1: Sonah drew no page of HEAD yet.
  const nothing = await s.share();
  assert.equal(nothing.code, 1);
  assert.equal(nothing.stderr, saidOf('share_no_review', short(head)));

  const drawn = await s.visual(['main..feature']);
  assert.equal(drawn.code, 0, drawn.stderr);
  const outDir = s.folderOf(base, head);
  // A folder that holds no finished page, and a page whose commit is in another repository.
  const notAPage = await s.share(['--dir', '.']);
  assert.equal(notAPage.code, 2);
  assert.equal(notAPage.stderr, saidOf('share_not_a_review', s.repo.work));
  const other = join(s.repo.root, 'other work');
  s.repo.git(['init', '-q', '-b', 'main', other], {}, s.repo.root);
  s.repo.git(['config', 'commit.gpgsign', 'false'], {}, other);
  await writeFile(join(other, 'read.md'), 'another repository\n');
  s.repo.git(['add', '.'], {}, other);
  s.repo.git(['commit', '-q', '-m', 'Another'], {}, other);
  const elsewhere = await s.share(['--dir', outDir], other);
  assert.equal(elsewhere.code, 2);
  assert.equal(elsewhere.stderr, saidOf('share_not_a_review', outDir));

  // A branch name the server would refuse, and a push remote that names no repository.
  const badBranch = await s.share(['--branch', 'bad branch']);
  assert.equal(badBranch.code, 2);
  assert.equal(badBranch.stderr, saidOf('share_bad_branch'));
  s.repo.git(['remote', 'set-url', '--push', 'origin', join(s.repo.root, 'remote', 'acme', 'widgets.git')]);
  const noRepo = await s.share();
  assert.equal(noRepo.code, 2);
  assert.equal(noRepo.stderr, saidOf('share_no_repository'));
  assert.equal(SHARE_WORDS.problem.share_no_repository, PUSH_RUN_WORDS.why.no_repository);
  s.repo.git(['remote', 'set-url', '--push', 'origin', 'ssh://example.invalid/acme/widgets.git']);

  // Another Sonah holds the folder of the page (D226's lock).
  const lock = await takeVisualLock(outDir);
  assert.ok(lock.release);
  const inUse = await s.share();
  assert.equal(inUse.code, 2);
  assert.equal(inUse.stderr, saidOf('share_folder_in_use'));
  await lock.release();

  // Exit 3: Sonah cannot read the folder's lock, so it cannot draw the page again to send it.
  await mkdir(join(outDir, 'draw.lock'));
  const failed = await s.share();
  assert.equal(failed.code, 3);
  assert.equal(failed.stdout, `${SHARE_WORDS.sending(outDir)}\n`);
  assert.equal(failed.stderr, `${PUSH_RUN_WORDS.why.draw_failed('visual_failed')}\n`);
  const run = await s.runOf('failed');
  assert.equal(run.why, 'draw_failed');
  assert.equal(run.code, 'visual_failed');
  await rm(join(outDir, 'draw.lock'), { recursive: true });

  // No branch points at the page's commit, and the server keeps each review under a branch.
  s.repo.git(['checkout', '-q', '--detach', head]);
  s.repo.git(['branch', '-q', '-D', 'feature']);
  const noBranch = await s.share();
  assert.equal(noBranch.code, 2);
  assert.equal(noBranch.stderr, saidOf('share_no_branch', short(head)));
  assert.deepEqual(routesOf(s.server), [], 'nothing of all this reached the server');
  assert.deepEqual(s.server.uploads, []);
});

test('the folder: the newest finished page of HEAD, of any range or of a run of the repository; an unfinished one is '
  + 'not one', async (t) => {
  const s = await setup(t);
  const first = s.repo.git(['rev-parse', 'main']);
  await s.repo.commit('main', `${MATH_V2}// main moves on\n`);
  const second = s.repo.git(['rev-parse', 'main']);
  const head = await s.repo.commit('feature', `${MATH_V2}// feature\n`);
  // Two ranges that end at HEAD, and one folder of a push run (a run of the repository names its `out`).
  assert.equal((await s.visual(['main..feature'])).code, 0);
  assert.equal((await s.visual([`${first}..feature`])).code, 0);
  const near = s.folderOf(second, head);
  const far = s.folderOf(first, head);
  const pushed = join(s.repo.root, 'from a push');
  assert.equal((await s.visual(['main..feature', '--out', pushed])).code, 0);
  await updateRun(s.where, 'aaaaaaaaaaaa', { state: 'done', why: 'uploaded', common: s.common, dir: s.top,
    repo: 'acme/widgets', branch: 'feature', sha: head, base: second, out: pushed, server: s.server.url,
    login: 'octo', at: '2026-11-11T08:00:00.000Z' });
  // Two folders of HEAD that hold no finished page: one whose run is not complete, one whose meaning is gone.
  const copy = async (dir, names) => {
    await mkdir(dir, { recursive: true, mode: 0o700 });
    for (const name of names) await writeFile(join(dir, name), await readFile(join(near, name), 'utf8'));
    return dir;
  };
  const half = await copy(join(s.place, 'half drawn'), ['facts.json', 'meaning.json', 'findings.json', 'dropped.json']);
  await writeFile(join(half, 'run.json'), JSON.stringify({ ...JSON.parse(await readFile(join(near, 'run.json'), 'utf8')),
    status: 'pending' }));
  const gone = await copy(join(s.place, 'a file gone'), ['facts.json', 'findings.json', 'dropped.json', 'run.json']);

  // The newest wins, whichever of the three it is; the two that are no finished page never do.
  for (const [n, pick] of [[1, far], [2, near], [3, pushed]]) {
    for (const [dir, when] of [[far, 10], [near, 20], [pushed, 30], [half, 90], [gone, 90]])
      await drawnAt(dir, 1_800_000_000 + (dir === pick ? 100 : when) + n);
    const shared = await s.share();
    assert.equal(shared.code, 0, shared.stderr);
    assert.equal(shared.stdout.startsWith(`${SHARE_WORDS.sending(pick)}\n`), true, shared.stdout);
    assert.equal(s.server.uploads.at(-1).head, head);
    assert.equal((await s.runs()).at(-1).out, pick);
  }
  assert.deepEqual(s.server.uploads.map((u) => u.base), [first, second, second]);
  assert.deepEqual(routesOf(s.server), ['POST /api/uploads', 'POST /api/uploads', 'POST /api/uploads']);
});

test('--repo names the repository from outside it, --dir the page, which need not be of HEAD, and --branch the branch '
  + 'the review goes under', async (t) => {
  const s = await setup(t);
  const base = s.repo.git(['rev-parse', 'main']);
  const head = await s.repo.commit('feature', MATH_V2);
  assert.equal((await s.visual(['main..feature'])).code, 0);
  const outDir = s.folderOf(base, head);
  // Run where no repository is: --repo names it, and --branch the name the server keeps the review under.
  const named = await s.share(['--repo', s.repo.work, '--dir', outDir, '--branch', 'release-1'], s.home.root);
  assert.equal(named.code, 0, named.stderr);
  assert.equal(s.server.uploads.at(-1).branch, 'release-1');
  assert.equal(s.server.uploads.at(-1).head, head);
  assert.equal((await s.runs()).at(-1).branch, 'release-1');
  assert.equal((await s.runs()).at(-1).url, `${s.server.url}/r/acme/widgets/b/release-1`);
  // HEAD moves on: --dir still sends that page, whose commit is in this repository.
  const later = await s.repo.commit('feature', `${MATH_V2}// later\n`);
  const again = await s.share(['--dir', outDir, '--branch', 'feature']);
  assert.equal(again.code, 0, again.stderr);
  assert.equal(s.server.uploads.at(-1).head, head, 'the page --dir names, not the commit at HEAD');
  assert.equal((await s.runs()).at(-1).sha, head);
  assert.notEqual(later, head);
  assert.deepEqual(routesOf(s.server), ['POST /api/uploads', 'POST /api/uploads']);
});

test('a share sends the upload of the same page that waits: the same run, which ends shared, and the older ones of '
  + 'its branch end replaced', async (t) => {
  const s = await setup(t);
  const base = s.repo.git(['rev-parse', 'main']);
  const head = await s.repo.commit('feature', MATH_V2);
  assert.equal((await s.visual(['main..feature'])).code, 0);
  const outDir = s.folderOf(base, head);
  const row = (id, patch) => updateRun(s.where, id, { state: 'pending_upload', why: 'upload_failed', status: 503,
    common: s.common, dir: s.top, repo: 'acme/widgets', branch: 'feature', sha: head, base, out: outDir,
    server: s.server.url, login: 'octo', at: '2026-11-11T10:00:00.000Z', ...patch });
  await row('bbbbbbbbbbbb', { sha: 'b'.repeat(40), at: '2026-11-11T09:00:00.000Z', out: join(s.place, 'older') });
  await row('cccccccccccc', { branch: 'other', sha: 'c'.repeat(40), at: '2026-11-11T09:30:00.000Z' });
  await row('dddddddddddd', { common: join(s.repo.root, 'another', '.git'), sha: 'd'.repeat(40),
    at: '2026-11-11T09:30:00.000Z' });
  await row('eeeeeeeeeeee', { sha: 'e'.repeat(40), at: '2026-11-11T23:00:00.000Z' });
  await row('aaaaaaaaaaaa', {});
  const before = (await s.runs()).map((r) => r.id);

  const shared = await s.share();
  assert.equal(shared.code, 0, shared.stderr);
  assert.deepEqual((await s.runs()).map((r) => r.id), before, 'the run that waits is the share\'s own');
  const states = Object.fromEntries((await s.runs()).map((r) => [r.id, [r.state, r.why]]));
  assert.deepEqual(states.aaaaaaaaaaaa, ['shared', 'uploaded']);
  assert.deepEqual(states.bbbbbbbbbbbb, ['replaced', 'newer_push'], 'older, and of the same branch');
  assert.deepEqual(states.cccccccccccc, ['pending_upload', 'upload_failed'], 'another branch');
  assert.deepEqual(states.dddddddddddd, ['pending_upload', 'upload_failed'], 'another repository');
  assert.deepEqual(states.eeeeeeeeeeee, ['pending_upload', 'upload_failed'], 'newer than the one that was sent');
  const run = (await s.runs()).find((r) => r.id === 'aaaaaaaaaaaa');
  assert.equal(run.url, `${s.server.url}/r/acme/widgets/b/feature`);
  assert.equal(run.status, null);
  assert.equal(run.at, '2026-11-11T10:00:00.000Z', 'the push that drew it');
  assert.equal(s.server.uploads.length, 1);
  assert.deepEqual(routesOf(s.server), ['POST /api/uploads']);
  // A page of another commit, with a run that waits, is not that run: it gets its own.
  const next = await s.repo.commit('feature', `${MATH_V2}// next\n`);
  assert.equal((await s.visual([`${base}..feature`])).code, 0);
  assert.equal((await s.share()).code, 0);
  const fresh = (await s.runs()).at(-1);
  assert.equal(fresh.sha, next);
  assert.equal(before.includes(fresh.id), false);
  assert.equal(fresh.state, 'shared');
});

test('a share and a push of the same page write one log: the one its run names, named as a push run names it',
  async (t) => {
    const s = await setup(t);
    // A repository name of 86 characters, which the server takes (fix-prompt.mjs `isName`: at most 100) and which a
    // push run cuts to 80 for its log.
    const long = `widgets-${'x'.repeat(78)}`;
    s.repo.git(['remote', 'set-url', '--push', 'origin', `ssh://example.invalid/acme/${long}.git`]);
    const base = s.repo.git(['rev-parse', 'main']);
    const head = await s.repo.commit('feature', MATH_V2);
    assert.equal((await s.visual(['main..feature'])).code, 0);
    const logs = join(s.env.SONAH_HOME, 'team', 'logs');
    const pushed = join(logs, `${long.slice(0, 80)}-${head}.log`);
    // The upload of this page waits, with the log a push run wrote: the share goes on in that same log.
    await updateRun(s.where, 'aaaaaaaaaaaa', { state: 'pending_upload', why: 'upload_failed', common: s.common,
      dir: s.top, repo: `acme/${long}`, branch: 'feature', sha: head, out: s.folderOf(base, head), log: pushed,
      server: s.server.url, login: 'octo', at: '2026-11-11T10:00:00.000Z' });
    assert.equal((await s.share()).code, 0);
    const run = (await s.runs()).find((r) => r.id === 'aaaaaaaaaaaa');
    assert.equal(run.log, pushed);
    assert.match(await readFile(pushed, 'utf8'), new RegExp(`sonah share: acme/${long} feature ${head}`));
    assert.match(await readFile(pushed, 'utf8'), /shared: http/);
    // A page with no run that waits: its log is the one a push run of it would write, and no second log is beside it.
    const next = await s.repo.commit('feature', `${MATH_V2}// next\n`);
    assert.equal((await s.visual([`${base}..feature`])).code, 0);
    assert.equal((await s.share()).code, 0);
    assert.equal((await s.runs()).at(-1).log, join(logs, `${long.slice(0, 80)}-${next}.log`));
    assert.deepEqual((await readdir(logs)).sort(), [`${long.slice(0, 80)}-${head}.log`,
      `${long.slice(0, 80)}-${next}.log`].sort());
  });

test('a run that another process took up while the share sent its own is not replaced', async (t) => {
  const s = await setup(t);
  const base = s.repo.git(['rev-parse', 'main']);
  const head = await s.repo.commit('feature', MATH_V2);
  assert.equal((await s.visual(['main..feature'])).code, 0);
  await updateRun(s.where, 'bbbbbbbbbbbb', { state: 'pending_upload', why: 'upload_failed', common: s.common,
    dir: s.top, repo: 'acme/widgets', branch: 'feature', sha: 'b'.repeat(40), out: join(s.place, 'older'),
    server: s.server.url, login: 'octo', at: '2026-11-11T09:00:00.000Z' });
  // While the share's own upload is in flight, a push run takes that older one up and sends it: it no longer waits.
  const mine = { pid: process.pid, start: await processStart(process.pid) };
  s.server.once('POST', '/api/uploads', async (call) => {
    await updateRun(s.where, 'bbbbbbbbbbbb', { state: 'uploading', why: null, ...mine });
    return { status: 201, json: { url: `${s.server.url}/r/acme/widgets/b/feature`,
      version: { head: JSON.parse(call.body).head, base, at: new Date().toISOString() }, prs: [], dropped: {} } };
  });
  assert.equal((await s.share()).code, 0);
  const older = (await s.runs()).find((r) => r.id === 'bbbbbbbbbbbb');
  assert.deepEqual([older.state, older.pid], ['uploading', process.pid], 'left to the process that sends it');
});

test('a 401 marks the connection refused, as a push run\'s upload does, and the next share stops at the connection',
  async (t) => {
    const s = await setup(t);
    const base = s.repo.git(['rev-parse', 'main']);
    const head = await s.repo.commit('feature', MATH_V2);
    assert.equal((await s.visual(['main..feature'])).code, 0);
    s.server.tokens.get(s.token).live = false;
    const refused = await s.share();
    assert.equal(refused.code, 2);
    assert.equal(refused.stdout, `${SHARE_WORDS.sending(s.folderOf(base, head))}\n`);
    assert.equal(refused.stderr, `${PUSH_RUN_WORDS.why.refused(s.server.url)}\n`);
    const run = await s.runOf('failed');
    assert.equal(run.why, 'refused');
    assert.equal(whyWords(run), PUSH_RUN_WORDS.why.refused(s.server.url));
    await stat(join(s.env.SONAH_HOME, 'team', 'refused.json'));
    assert.deepEqual(routesOf(s.server), ['POST /api/uploads']);
    // The mark stops the next share before it reads the repository or calls the server again.
    const again = await s.share();
    assert.equal(again.code, 2);
    assert.equal(again.stdout, '');
    assert.equal(again.stderr, `${PUSH_RUN_WORDS.why.refused(s.server.url)}\n`);
    assert.deepEqual(routesOf(s.server), ['POST /api/uploads']);
    assert.equal((await s.runs()).length, 1);
  });

test('a server that refuses the upload: exit 2 in its own words; one that does not answer leaves the page waiting for '
  + 'the next share', async (t) => {
  const s = await setup(t);
  const base = s.repo.git(['rev-parse', 'main']);
  const head = await s.repo.commit('feature', MATH_V2);
  assert.equal((await s.visual(['main..feature'])).code, 0);
  s.server.once('POST', '/api/uploads', { status: 400, json: { error: 'bad_upload' } });
  const bad = await s.share();
  assert.equal(bad.code, 2);
  assert.equal(bad.stderr, `${PUSH_RUN_WORDS.why.upload_refused(s.server.url, 400, 'bad_upload')}\n`);
  const first = await s.runOf();
  assert.deepEqual([first.state, first.why, first.status, first.code], ['failed', 'upload_refused', 400, 'bad_upload']);

  // A 5xx: tried again twice, then the page waits. The next share sends that same run.
  for (let i = 0; i < 3; i++) s.server.once('POST', '/api/uploads', { status: 503 });
  const waits = await s.share();
  assert.equal(waits.code, 2);
  assert.equal(waits.stderr, `${PUSH_RUN_WORDS.why.upload_failed(s.server.url, 503)}\n`);
  const pending = (await s.runs()).at(-1);
  assert.deepEqual([pending.state, pending.why, pending.status], ['pending_upload', 'upload_failed', 503]);
  assert.equal(s.server.calls.length, 4, 'the first upload, then three of the second share');
  const sent = await s.share();
  assert.equal(sent.code, 0, sent.stderr);
  assert.equal((await s.runs()).length, 2, 'the page that waits keeps its run');
  const done = (await s.runs()).at(-1);
  assert.deepEqual([done.id, done.state, done.why, done.status], [pending.id, 'shared', 'uploaded', null]);
  assert.equal(s.server.uploads.length, 1, 'only the upload the server took');
  assert.deepEqual(new Set(routesOf(s.server)), new Set(['POST /api/uploads']));
});

test('decision 15 widened: a drawer given no server at all names the connected one, so the review\'s graphs page does',
  async (t) => {
  const s = await setup(t);
  // The owner widened decision 15 on 2026-11-12. `drawVisualPage` resolves the default itself when it is given no
  // `server`, which is what D219's graphs page of `sonah review --format html` gives it (d219-review-graphs.test.js
  // pins that it names none). Without this the drawer's own default stood and that page named pr.sonah.dev, whatever
  // this computer was connected to.
  const base = s.repo.git(['rev-parse', 'main']);
  const head = await s.repo.commit('feature', MATH_V2);
  const outDir = s.folderOf(base, head);
  const drawn = await drawVisualPage({ top: s.repo.work, base, head, outDir, env: s.repo.env });
  assert.equal(drawn.status, 'complete', drawn.code);
  const page = await readFile(join(outDir, 'page.html'), 'utf8');
  assert.ok(page.includes(`${s.server.url}/share?owner=acme&`), 'the connected server');
  assert.equal(page.includes(VISUAL_DEFAULT_SERVER), false, 'not the drawer\'s own default');
  assert.equal(page.includes(s.token), false, 'the token reaches no page');
  // An address given still wins, and `null` still means a page with no buttons.
  const other = await s.repo.commit('feature', `${MATH_V2}// two\n`);
  const named = s.folderOf(base, other);
  assert.equal((await drawVisualPage({ top: s.repo.work, base, head: other, outDir: named, env: s.repo.env,
    server: VISUAL_DEFAULT_SERVER })).status, 'complete');
  const pinned = await readFile(join(named, 'page.html'), 'utf8');
  assert.ok(pinned.includes(`${VISUAL_DEFAULT_SERVER}/share?owner=acme&`), 'the address given');
  assert.equal(pinned.includes(s.server.url), false);
  const third = await s.repo.commit('feature', `${MATH_V2}// three\n`);
  const none = s.folderOf(base, third);
  assert.equal((await drawVisualPage({ top: s.repo.work, base, head: third, outDir: none, env: s.repo.env,
    server: null })).status, 'complete');
  const bare = await readFile(join(none, 'page.html'), 'utf8');
  assert.equal(bare.includes('id="saveonline"'), false, 'null means a page with no buttons');
});

test('decision 15: a page drawn here names the server this computer is connected to, else pr.sonah.dev, and --server '
  + 'names another', async (t) => {
  const s = await setup(t);
  const other = await teamServer(t);
  const pageOf = async (dir) => readFile(join(dir, 'page.html'), 'utf8');
  const shareOf = (server) => `${server}/share?owner=acme&`;
  // Connected: the page's "Save online" and "Invite your team" name that server, and never the token.
  const base = s.repo.git(['rev-parse', 'main']);
  const head = await s.repo.commit('feature', MATH_V2);
  assert.equal((await s.visual(['main..feature'])).code, 0);
  const connected = await pageOf(s.folderOf(base, head));
  assert.ok(connected.includes(shareOf(s.server.url)), 'the connected server');
  assert.equal(connected.includes(VISUAL_DEFAULT_SERVER), false);
  assert.equal(connected.includes(s.token), false);
  // Not connected: the default server.
  await forgetConnection(s.where);
  const second = await s.repo.commit('feature', `${MATH_V2}// two\n`);
  assert.equal((await s.visual(['main..feature'])).code, 0);
  const alone = await pageOf(s.folderOf(base, second));
  assert.ok(alone.includes(shareOf(VISUAL_DEFAULT_SERVER)), 'https://pr.sonah.dev');
  assert.equal(alone.includes(s.server.url), false);
  // --server names the server, connected or not.
  await writeConnection({ server: s.server.url, token: s.token, login: 'octo' }, s.where);
  const third = await s.repo.commit('feature', `${MATH_V2}// three\n`);
  assert.equal((await s.visual(['main..feature', '--server', other.url])).code, 0);
  const given = await pageOf(s.folderOf(base, third));
  assert.ok(given.includes(shareOf(other.url)), '--server');
  assert.equal(given.includes(s.server.url), false);
  assert.equal(given.includes(VISUAL_DEFAULT_SERVER), false);
  // A page is drawn with no call to any server, and `sonah share` sends it to the connected one only.
  assert.deepEqual(routesOf(s.server), []);
  assert.deepEqual(routesOf(other), []);
  assert.equal((await s.share()).code, 0);
  assert.deepEqual(routesOf(s.server), ['POST /api/uploads']);
  assert.deepEqual(routesOf(other), []);
});

test('D228 review 1: a share of an older page of the branch replaces no review that waits to be sent, and one of a '
  + 'page the commits are behind does', async (t) => {
  const s = await setup(t);
  const base = s.repo.git(['rev-parse', 'main']);
  const older = await s.repo.commit('feature', MATH_V2);
  assert.equal((await s.visual(['main..feature'])).code, 0);
  const olderDir = s.folderOf(base, older);
  const newer = await s.repo.commit('feature', `${MATH_V2}// newer\n`);
  assert.equal((await s.visual([`${base}..feature`])).code, 0);
  const newerDir = s.folderOf(base, newer);
  const row = (id, patch) => updateRun(s.where, id, { state: 'pending_upload', why: 'upload_failed', status: null,
    common: s.common, dir: s.top, repo: 'acme/widgets', branch: 'feature', base, server: s.server.url, login: 'octo',
    ...patch });
  // The push of the newer commit drew its review last night, and the server did not take it.
  await row('eeeeeeeeeeee', { sha: newer, out: newerDir, at: '2026-11-11T23:00:00.000Z' });

  // This morning the person puts the older page up. Its run is this morning's, so the times alone would make it the
  // newest review of the branch, and the newer one would never be sent.
  const shared = await s.share(['--dir', olderDir, '--branch', 'feature']);
  assert.equal(shared.code, 0, shared.stderr);
  assert.equal(s.server.uploads.at(-1).head, older);
  const mine = (await s.runs()).at(-1);
  assert.deepEqual([mine.sha, mine.state], [older, 'shared']);
  assert.ok(mine.at > '2026-11-11T23:00:00.000Z', 'the share ran after that push');
  const waits = (await s.runs()).find((r) => r.id === 'eeeeeeeeeeee');
  assert.deepEqual([waits.state, waits.why], ['pending_upload', 'upload_failed'], 'the newer commit of the branch');
  assert.equal(await waitsToSend(waits), true);

  // The other way: a review of a commit that the shared page's commit holds is replaced, whatever the times say (a
  // clock set by hand gives this row a time of its own).
  await row('cccccccccccc', { sha: older, out: olderDir, at: '2026-11-30T00:00:00.000Z' });
  const second = await s.share();
  assert.equal(second.code, 0, second.stderr);
  assert.equal(s.server.uploads.at(-1).head, newer, 'the newest page of HEAD');
  const sent = (await s.runs()).find((r) => r.id === 'eeeeeeeeeeee');
  assert.deepEqual([sent.state, sent.why], ['shared', 'uploaded'], 'the review that waited, sent');
  const replaced = (await s.runs()).find((r) => r.id === 'cccccccccccc');
  assert.deepEqual([replaced.state, replaced.why], ['replaced', 'newer_push']);
  assert.equal(whyWords(replaced), PUSH_RUN_WORDS.why.newer_push('feature'));
  assert.deepEqual(routesOf(s.server), ['POST /api/uploads', 'POST /api/uploads']);
});

test('D228 review 1: a push run leaves a review that waits alone when a share put an older page of its branch up, '
  + 'and sends it', async (t) => {
  const s = await setup(t);
  // The repository is listed, with no hook file: a push starts no runner here, and the runner this test starts sends
  // what waits (push-run.js `sendPending`).
  await updateHooks(s.where, (repos) => [...repos, { common: s.common, server: s.server.url }]);
  const base = s.repo.git(['rev-parse', 'main']);
  const older = await s.repo.commit('feature', MATH_V2);
  assert.equal((await s.visual(['main..feature'])).code, 0);
  const newer = await s.repo.commit('feature', `${MATH_V2}// newer\n`);
  assert.equal((await s.visual([`${base}..feature`])).code, 0);
  const newerDir = s.folderOf(base, newer);
  const of = (patch) => ({ common: s.common, dir: s.top, repo: 'acme/widgets', branch: 'feature', base,
    server: s.server.url, login: 'octo', ...patch });
  // The share of the older page, as share records one: `shared`, with the time it ran.
  await updateRun(s.where, 'ffffffffffff', of({ state: 'shared', why: 'uploaded', sha: older,
    out: s.folderOf(base, older), at: new Date().toISOString(), url: `${s.server.url}/r/acme/widgets/b/feature` }));
  await updateRun(s.where, 'eeeeeeeeeeee', of({ state: 'pending_upload', why: 'upload_failed', status: null,
    sha: newer, out: newerDir, at: '2026-11-11T23:00:00.000Z' }));

  const pass = await runEntry(['push-run', '--repo', s.repo.work], { env: s.env, cwd: s.repo.work });
  assert.equal(pass.code, 0, pass.stderr);
  const sent = (await s.runs()).find((r) => r.id === 'eeeeeeeeeeee');
  assert.deepEqual([sent.state, sent.why], ['done', 'uploaded'], 'the newer commit of the branch is still sent');
  assert.equal(s.server.uploads.at(-1).head, newer);
  assert.equal((await s.runs()).find((r) => r.id === 'ffffffffffff').state, 'shared');
  assert.deepEqual(routesOf(s.server), ['POST /api/uploads']);
});

test('D228 review 1: what a share says of a folder it could not read, and of a connection that changed, names a '
  + 'share and not only a push', async (t) => {
  const s = await setup(t);
  const base = s.repo.git(['rev-parse', 'main']);
  const head = await s.repo.commit('feature', MATH_V2);
  assert.equal((await s.visual(['main..feature'])).code, 0);
  const outDir = s.folderOf(base, head);
  // A folder Sonah cannot read as a finished page: the person who ran a share has no push hook to try again with.
  await mkdir(join(outDir, 'draw.lock'));
  const failed = await s.share();
  assert.equal(failed.code, 3);
  assert.equal(failed.stderr, `${PUSH_RUN_WORDS.why.draw_failed('visual_failed')}\n`);
  assert.match(failed.stderr, /sonah share/, 'a share tries again too, with the answers that came back');
  await rm(join(outDir, 'draw.lock'), { recursive: true });

  // The connection changes while the upload is tried again: the same words say which connection sends a review.
  s.server.once('POST', '/api/uploads', async () => {
    await writeConnection({ server: s.server.url, token: s.token, login: 'other-octo' }, s.where);
    return { status: 503 };
  });
  const changed = await s.share();
  assert.equal(changed.code, 2);
  assert.equal(changed.stderr, `${PUSH_RUN_WORDS.why.connection_changed}\n`);
  assert.match(changed.stderr, /its push or its share/);
  const run = (await s.runs()).at(-1);
  assert.deepEqual([run.state, run.why], ['failed', 'connection_changed']);
});

test('D228 review 1: a share that waited for the page\'s folder to its deadline leaves the review waiting to be '
  + 'sent, and the next share sends that same run', async (t) => {
  const s = await setup(t, { env: { SONAH_SHARE_DEADLINE_MS: '1500', SONAH_PUSH_POLL_MS: '200' } });
  const base = s.repo.git(['rev-parse', 'main']);
  const head = await s.repo.commit('feature', MATH_V2);
  assert.equal((await s.visual(['main..feature'])).code, 0);
  const outDir = s.folderOf(base, head);
  // The review of the push of this page waits to be sent: the server answered 503.
  await updateRun(s.where, 'aaaaaaaaaaaa', { state: 'pending_upload', why: 'upload_failed', status: 503,
    common: s.common, dir: s.top, repo: 'acme/widgets', branch: 'feature', sha: head, base, out: outDir,
    server: s.server.url, login: 'octo', at: '2026-11-11T10:00:00.000Z' });
  // Another Sonah is taking that folder's lock back: its claim stands beside a lock that holds nothing (D226), so the
  // lock is free to nobody. The share passes its first look, then waits for the folder and gives up at its deadline.
  const lock = join(outDir, 'draw.lock');
  const stale = `${JSON.stringify({ v: 1, pid: 1, start: 'Thu Jan  1 00:00:00 1970' })}\n`;
  const claim = `${lock}.claim-${createHash('sha256').update(stale).digest('hex').slice(0, 16)}`;
  await writeFile(lock, stale, { mode: 0o600 });
  await writeFile(claim, `${JSON.stringify({ v: 1, pid: process.pid, start: await processStart(process.pid) })}\n`,
    { mode: 0o600 });

  const gave = await s.share();
  assert.equal(gave.code, 2);
  assert.equal(gave.stdout, `${SHARE_WORDS.sending(outDir)}\n`);
  assert.equal(gave.stderr, saidOf('share_folder_in_use'));
  const waits = (await s.runs()).find((r) => r.id === 'aaaaaaaaaaaa');
  assert.deepEqual([waits.state, waits.why], ['pending_upload', 'folder_held'], 'nothing was drawn and none sent');
  assert.equal(await waitsToSend(waits), true, 'the next push of the repository, or the next share, sends it');
  // D228 review 2: in its own words. The runner's `folder_in_use` says that Sonah waits for the folder and then uses
  // its answers, which is true of a review that waits to be drawn and false here: this share's process is gone.
  assert.equal(whyWords(waits), PUSH_RUN_WORDS.why.folder_held);
  assert.match(whyWords(waits), /sends this review\.$/);
  assert.equal(whyWords(waits).includes('Sonah waits for it'), false, 'nothing waits for that folder now');
  assert.deepEqual(routesOf(s.server), []);

  // Once the other Sonah ends, that same run is sent: one review, one run, one upload.
  await rm(claim, { force: true });
  await rm(lock, { force: true });
  const sent = await s.share();
  assert.equal(sent.code, 0, sent.stderr);
  const done = (await s.runs()).find((r) => r.id === 'aaaaaaaaaaaa');
  assert.deepEqual([done.state, done.why, done.status], ['shared', 'uploaded', null]);
  assert.equal((await s.runs()).length, 1, 'no second run of the same page');
  assert.equal(s.server.uploads.length, 1);
});

test('D228 review 1: a run that another process sends is left to it: a second sender takes nothing and sends nothing',
  async (t) => {
    const s = await setup(t);
    const base = s.repo.git(['rev-parse', 'main']);
    const head = await s.repo.commit('feature', MATH_V2);
    assert.equal((await s.visual(['main..feature'])).code, 0);
    const outDir = s.folderOf(base, head);
    // Another Sonah of this computer sends that review now: the run names its process, which runs.
    const other = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });
    t.after(() => { try { other.kill('SIGKILL'); } catch { /* gone already */ } });
    const start = await processStart(other.pid);
    assert.notEqual(start, null);
    await updateRun(s.where, 'aaaaaaaaaaaa', { state: 'uploading', why: null, pid: other.pid, start,
      common: s.common, dir: s.top, repo: 'acme/widgets', branch: 'feature', sha: head, base, out: outDir,
      server: s.server.url, login: 'octo', at: '2026-11-11T10:00:00.000Z' });
    const send = async () => sendFolder({ where: s.where, env: s.env, git: gitOut, fetch: globalThis.fetch,
      limits: limitsFrom(s.env), start: await processStart(process.pid),
      check: (asked) => connectionStill(s.where, asked), id: 'aaaaaaaaaaaa', top: s.top,
      named: { owner: 'acme', name: 'widgets' }, branch: 'feature', outDir,
      connection: { server: s.server.url, token: s.token, login: 'octo' }, deadline: Date.now() + 60_000,
      log: async () => {} });
    assert.deepEqual(await send(), { state: 'taken' });
    const left = (await s.runs()).find((r) => r.id === 'aaaaaaaaaaaa');
    assert.deepEqual([left.state, left.pid], ['uploading', other.pid], 'left to the process that sends it');
    assert.deepEqual(routesOf(s.server), [], 'and nothing was sent');

    // Once that process is gone, the run waits to be sent again, and this send takes it.
    other.kill('SIGKILL');
    await once(other, 'exit');
    assert.equal(await waitsToSend(left), true);
    const sent = await send();
    assert.equal(sent.state, 'done');
    assert.equal(sent.url, `${s.server.url}/r/acme/widgets/b/feature`);
    assert.equal((await s.runs()).find((r) => r.id === 'aaaaaaaaaaaa').pid, process.pid);
    assert.deepEqual(routesOf(s.server), ['POST /api/uploads']);
  });

test('D228 review 1: the share deadline is 10 minutes, and the environment only shortens it', () => {
  assert.equal(SHARE_DEADLINE_MS, 10 * 60_000);
  assert.equal(shareDeadlineMs({}), SHARE_DEADLINE_MS);
  assert.equal(shareDeadlineMs({ SONAH_SHARE_DEADLINE_MS: '1500' }), 1500);
  for (const value of ['0', '-1', '1.5', 'soon', '', '600001', String(Number.MAX_SAFE_INTEGER + 2)])
    assert.equal(shareDeadlineMs({ SONAH_SHARE_DEADLINE_MS: value }), SHARE_DEADLINE_MS, value);
});

test('D228 review 2: three reviews of a branch that wait can each take another\'s place; a pass sends one of them and '
  + 'replaces only the others', async (t) => {
  const s = await setup(t);
  // The repository is listed, with no hook file: a push starts no runner here, and the runner this test starts sends
  // what waits (push-run.js `sendPending`).
  await updateHooks(s.where, (repos) => [...repos, { common: s.common, server: s.server.url }]);
  const base = s.repo.git(['rev-parse', 'main']);
  const first = await s.repo.commit('feature', MATH_V2);
  assert.equal((await s.visual(['main..feature'])).code, 0);
  const second = await s.repo.commit('feature', `${MATH_V2}// newer\n`);
  assert.equal((await s.visual([`${base}..feature`])).code, 0);
  // A push moved the branch to another line of commits, so git says of this one and the two above only that they
  // share main: neither holds the other.
  const away = await s.repo.commit('other', `${MATH_V2}// another line\n`);
  assert.equal((await s.visual(['main..other'])).code, 0);
  // D228 review 4: the three stand in a ring only while this computer cannot name the branch's tip, which now decides
  // before the commits and the times both. `shipped` is a branch that was merged and deleted here, so there is none.
  const of = (patch) => ({ state: 'pending_upload', why: 'upload_failed', status: null, common: s.common, dir: s.top,
    repo: 'acme/widgets', branch: 'shipped', base, server: s.server.url, login: 'octo', ...patch });
  // Three shares of the branch that were killed while they sent leave three reviews that wait to be sent. They stand
  // in a ring: the second takes the first's place by their times, the third takes the second's by their times, and the
  // first takes the third's by the commits, since the third's commit is an ancestor of the first's.
  await updateRun(s.where, '111111111111', of({ sha: second, out: s.folderOf(base, second),
    at: '2026-11-11T10:00:00.000Z' }));
  await updateRun(s.where, '222222222222', of({ sha: away, out: s.folderOf(base, away),
    at: '2026-11-11T11:00:00.000Z' }));
  await updateRun(s.where, '333333333333', of({ sha: first, out: s.folderOf(base, first),
    at: '2026-11-11T12:00:00.000Z' }));
  const rows = await s.runs();
  const row = (id) => rows.find((r) => r.id === id);
  const took = (run, older) => takesPlaceOf(row(run), row(older), { dir: s.common, env: s.env, git: gitOut });
  assert.equal(await took('222222222222', '111111111111'), true, 'by their times');
  assert.equal(await took('333333333333', '222222222222'), true, 'by their times');
  assert.equal(await took('111111111111', '333333333333'), true, 'by the commits');

  const pass = await runEntry(['push-run', '--repo', s.repo.work], { env: s.env, cwd: s.repo.work });
  assert.equal(pass.code, 0, pass.stderr);
  const after = await s.runs();
  const ends = ['111111111111', '222222222222', '333333333333']
    .map((id) => after.find((r) => r.id === id)).map((r) => [r.id, r.state, r.why]);
  assert.equal(ends.filter(([, state]) => state === 'replaced').length, 2, 'not every review of the branch');
  const [kept] = ends.filter(([, state]) => state !== 'replaced');
  // D228 review 4: and the one it sends is not one that a review it passed over takes the place of by the commits.
  // The reduce alone kept the third, whose commit the first's holds: a pass put an ancestor's review up as the
  // branch's page and ended the review of the commit that holds it `replaced`.
  assert.deepEqual(kept, ['111111111111', 'done', 'uploaded'], 'the newest the pass found, sent');
  for (const [id, state, why] of ends) if (id !== kept[0]) assert.deepEqual([state, why],
    ['replaced', 'newer_push'], id);
  assert.equal(s.server.uploads.length, 1, 'one review of the branch went up');
  assert.equal(s.server.uploads[0].head, second);
  assert.deepEqual(routesOf(s.server), ['POST /api/uploads']);
});

test('D228 review 2: the docs name the state and the next step of each end of a share, and the branch --branch names',
  async () => {
    const flat = (text) => text.replace(/\s+/g, ' ');
    const doc = async (path) => flat(await readFile(new URL(`../../../${path}`, import.meta.url), 'utf8'));
    const trouble = await doc('docs/TROUBLESHOOTING.md');
    // A share that another Sonah holds the run of writes nothing: that review is `uploading` under the other process,
    // which sends it, and no lock is held.
    assert.equal(trouble.includes('or when another Sonah is already sending this review: the review waits to be sent, '
      + '`sonah status` shows it `pending_upload`'), false);
    assert.ok(trouble.includes('Sonah says the same when the folder is still held 10 minutes later: it sent nothing, '
      + '`sonah status` shows the review `pending_upload` with `Another Sonah held the folder of this page, so sonah '
      + 'share sent nothing.`, and the next push of the repository, or `sonah share`, sends it.'));
    assert.ok(trouble.includes('It says the same again when another Sonah is already sending this review, where no '
      + 'lock is held at all: `sonah status` shows that review `uploading` under the other Sonah\'s process, which '
      + 'sends it, so run nothing again.'));
    assert.ok(trouble.includes(`\`${PUSH_RUN_WORDS.why.folder_held.split('. ')[0]}.\` (a \`sonah share\` that waited `
      + 'for the page\'s folder to its own 10-minute deadline'), 'the pending_upload row says its words');
    // `--branch` wins over the branches at the page's commit (share-command.js gives it to `shareTarget` as `given`).
    const install = await doc('docs/INSTALL.md');
    assert.equal(install.includes('The branch whose tip the page\'s commit is, as the page\'s own buttons name it, '
      + 'else the one `--branch NAME` names.'), false);
    assert.ok(install.includes('**Which branch and repository.** The branch `--branch NAME` names, else the branch '
      + 'whose tip the page\'s commit is, as the page\'s own buttons name it.'));
  });

test('D228 review 3: the list of runs that `sonah status` prints names the pushes and the shares, in a repository '
  + 'with no push hook, and the docs call it the same', async (t) => {
  const s = await setup(t);
  const base = s.repo.git(['rev-parse', 'main']);
  const head = await s.repo.commit('feature', MATH_V2);
  assert.equal((await s.visual(['main..feature'])).code, 0);
  assert.equal((await s.share()).code, 0);
  // This person ran `sonah connect` and `sonah share`: no repository here has the push hook, and the only run of the
  // list is the one the share wrote of a commit they never pushed.
  // D228 review (second look 1): and it names the remote the share sent under, as a push's run names the one git
  // gave the hook, so the commit the branch holds can be read from it (`pushedTip`).
  assert.deepEqual((await s.runs()).map((r) => [r.state, r.remote ?? null]), [['shared', 'origin']]);
  const listed = await s.status();
  assert.equal(listed.code, 0, listed.stderr);
  assert.deepEqual(JSON.parse((await s.status(['--json'])).stdout).hooks, [], 'no push hook in this home');
  assert.ok(listed.stdout.includes(`${PUSH_RUN_WORDS.heading}\n  acme/widgets feature ${short(head)}: shared\n`),
    'the share\'s run is in that list');
  assert.match(listed.stdout, /Reviews of your pushes and shares, newest first:/, 'a share put this page up');
  assert.equal(/Reviews of your pushes,/.test(listed.stdout), false, 'this person pushed nothing');
  // The docs call that list what the heading calls it, and say that a share puts a page in it.
  const flat = (text) => text.replace(/\s+/g, ' ');
  const doc = async (path) => flat(await readFile(new URL(`../../../${path}`, import.meta.url), 'utf8'));
  const trouble = await doc('docs/TROUBLESHOOTING.md');
  assert.ok(trouble.includes(`under \`${PUSH_RUN_WORDS.heading}\``), 'TROUBLESHOOTING quotes the heading');
  assert.ok(trouble.includes('A page `sonah share` put online is in that list too, in a repository with no push '
    + 'hook.'));
  assert.ok((await doc('docs/INSTALL.md')).includes('it lists the last 10 reviews of your pushes and shares, newest '
    + 'first'));
});

test('D228 review 3: with two runs of one page that wait to be sent, the share sends the newest of them and the '
  + 'older one ends replaced', async (t) => {
  const s = await setup(t);
  const base = s.repo.git(['rev-parse', 'main']);
  const head = await s.repo.commit('feature', MATH_V2);
  assert.equal((await s.visual(['main..feature'])).code, 0);
  const outDir = s.folderOf(base, head);
  // Two reviews of the same page that wait to be sent: two pushes of the branch whose uploads the server did not
  // take, each of which drew the one folder of that range.
  const row = (id, at) => updateRun(s.where, id, { state: 'pending_upload', why: 'upload_failed', status: 503,
    common: s.common, dir: s.top, repo: 'acme/widgets', branch: 'feature', sha: head, base, out: outDir,
    server: s.server.url, login: 'octo', at });
  await row('aaaaaaaaaaaa', '2026-11-11T10:00:00.000Z');
  await row('bbbbbbbbbbbb', '2026-11-11T11:00:00.000Z');

  assert.equal((await s.share()).code, 0);
  const states = Object.fromEntries((await s.runs()).map((r) => [r.id, [r.state, r.why]]));
  assert.deepEqual(states.bbbbbbbbbbbb, ['shared', 'uploaded'], 'the newest of them is the share\'s own run');
  assert.deepEqual(states.aaaaaaaaaaaa, ['replaced', 'newer_push'], 'the older one of the same branch');
  assert.equal((await s.runs()).length, 2, 'no third run of the same page');
  assert.equal(s.server.uploads.length, 1);
});

test('D228 review 3: a run that waits under a connection that ended is sent under this one, and `sonah status` names '
  + 'the server the page went to', async (t) => {
  const s = await setup(t);
  const base = s.repo.git(['rev-parse', 'main']);
  const head = await s.repo.commit('feature', MATH_V2);
  assert.equal((await s.visual(['main..feature'])).code, 0);
  const outDir = s.folderOf(base, head);
  // The review of a push was `uploading` under a live runner while the person connected to another server, so
  // `endPendingUploads` left it as it was (team-home.js: a run a process has taken up is that process's), and the
  // runner was then killed: the run waits to be sent, with the server and the login of the connection that ended.
  const gone = 'https://old.invalid';
  await updateRun(s.where, 'aaaaaaaaaaaa', { state: 'uploading', why: null, common: s.common, dir: s.top,
    repo: 'acme/widgets', branch: 'feature', sha: head, base, out: outDir, server: gone, login: 'old-octo',
    at: '2026-11-11T10:00:00.000Z', pid: null, start: null });

  const shared = await s.share();
  assert.equal(shared.code, 0, shared.stderr);
  const run = (await s.runs()).find((r) => r.id === 'aaaaaaaaaaaa');
  assert.deepEqual([run.state, run.why], ['shared', 'uploaded'], 'that same run, sent by the share');
  assert.equal(run.server, s.server.url, 'the server it was sent to');
  assert.equal(run.login, 'octo');
  assert.equal(s.server.uploads.length, 1);
  assert.equal(whyWords(run), PUSH_RUN_WORDS.why.uploaded(s.server.url));
  const listed = await s.status();
  assert.ok(listed.stdout.includes(`    ${PUSH_RUN_WORDS.why.uploaded(s.server.url)}\n`), 'where Sonah put the page');
  assert.equal(listed.stdout.includes(gone), false, 'no server but the one the page went to');
  assert.equal(JSON.parse((await s.status(['--json'])).stdout).runs[0].words.includes(gone), false);
});

test('D228 review 4: a branch moved back onto a commit it already held sends the tip\'s review, not the dropped '
  + 'commit\'s', async (t) => {
  const s = await setup(t);
  await updateHooks(s.where, (repos) => [...repos, { common: s.common, server: s.server.url }]);
  const base = s.repo.git(['rev-parse', 'main']);
  const kept = await s.repo.commit('feature', MATH_V2);
  assert.equal((await s.visual(['main..feature'])).code, 0);
  const dropped = await s.repo.commit('feature', `${MATH_V2}// dropped\n`);
  assert.equal((await s.visual([`${base}..feature`])).code, 0);
  s.repo.git(['push', '-q', 'origin', 'feature']);
  // The person drops that commit (`git reset --hard HEAD~1`, or in a rebase) and force-pushes, so the branch holds the
  // first commit again: the review of that commit is the newer push's, although the dropped commit holds it. D228
  // review 5: the push is made here, since the branch the order is read from is the remote's.
  s.repo.git(['reset', '--hard', kept]);
  s.repo.git(['push', '-q', '--force', 'origin', 'feature']);
  assert.equal(s.repo.git(['rev-parse', 'refs/remotes/origin/feature']), kept);
  // D228 review (second look 1): each row names the remote its push went to, as every run of a push does
  // (`ticketFields`) and as review 5's own test below writes it: the commit the branch holds is read from that
  // remote, and with none named there is no remote to read it from.
  const of = (patch) => ({ status: null, common: s.common, dir: s.top, repo: 'acme/widgets', branch: 'feature', base,
    remote: 'origin', server: s.server.url, login: 'octo', ...patch });
  await updateRun(s.where, 'aaaaaaaaaaaa', of({ state: 'done', why: 'uploaded', sha: dropped,
    out: s.folderOf(base, dropped), url: `${s.server.url}/r/acme/widgets/feature`, at: '2026-11-11T10:00:00.000Z' }));
  // The push of the first commit again: the server did not take its upload, so that review waits to be sent.
  await updateRun(s.where, 'bbbbbbbbbbbb', of({ state: 'pending_upload', why: 'upload_failed', sha: kept,
    out: s.folderOf(base, kept), at: '2026-11-11T11:00:00.000Z' }));
  const rows = await s.runs();
  const row = (id) => rows.find((r) => r.id === id);
  const took = (run, older, head = null) => takesPlaceOf(row(run), row(older),
    { dir: s.common, env: s.env, git: gitOut, head });
  assert.equal(await took('bbbbbbbbbbbb', 'aaaaaaaaaaaa', kept), true, 'the branch holds the tip\'s commit');
  assert.equal(await took('aaaaaaaaaaaa', 'bbbbbbbbbbbb', kept), false, 'and not the dropped commit\'s');
  assert.equal(await took('bbbbbbbbbbbb', 'aaaaaaaaaaaa'), false, 'with no tip to read, the commits alone');

  const pass = await runEntry(['push-run', '--repo', s.repo.work], { env: s.env, cwd: s.repo.work });
  assert.equal(pass.code, 0, pass.stderr);
  const after = (await s.runs()).find((r) => r.id === 'bbbbbbbbbbbb');
  assert.deepEqual([after.state, after.why], ['done', 'uploaded'], 'the review of the branch\'s tip, sent');
  assert.equal(s.server.uploads.length, 1, 'and no review of the dropped commit');
  assert.equal(s.server.uploads[0].head, kept);
  assert.deepEqual(routesOf(s.server), ['POST /api/uploads']);
});

test('D228 review 4: a share of a page of another line of commits leaves the waiting review of the branch\'s tip to '
  + 'be sent', async (t) => {
  const s = await setup(t);
  await updateHooks(s.where, (repos) => [...repos, { common: s.common, server: s.server.url }]);
  const base = s.repo.git(['rev-parse', 'main']);
  const tip = await s.repo.commit('feature', MATH_V2);
  assert.equal((await s.visual(['main..feature'])).code, 0);
  // D228 review 5: the branch the order is read from is the remote's, so the tip is pushed here.
  s.repo.git(['push', '-q', 'origin', 'feature']);
  // A page of a commit of another line, which is what an older page of a branch is after any `git commit --amend`,
  // rebase or squash: git says of it and the branch's tip only that they share main.
  const away = await s.repo.commit('other', `${MATH_V2}// another line\n`);
  assert.equal((await s.visual(['main..other'])).code, 0);
  // The push of the tip: the server did not take its upload, so that review waits to be sent.
  await updateRun(s.where, 'aaaaaaaaaaaa', { state: 'pending_upload', why: 'upload_failed', status: null,
    common: s.common, dir: s.top, repo: 'acme/widgets', branch: 'feature', sha: tip, base, remote: 'origin',
    out: s.folderOf(base, tip), server: s.server.url, login: 'octo', at: '2026-11-11T10:00:00.000Z' });

  const shared = await s.share(['--dir', s.folderOf(base, away), '--branch', 'feature']);
  assert.equal(shared.code, 0, shared.stderr);
  const waiting = (await s.runs()).find((r) => r.id === 'aaaaaaaaaaaa');
  assert.deepEqual([waiting.state, waiting.why], ['pending_upload', 'upload_failed'], 'the tip\'s review still waits');
  // And the next pass sends it, since the branch holds its commit and not the shared page's.
  const pass = await runEntry(['push-run', '--repo', s.repo.work], { env: s.env, cwd: s.repo.work });
  assert.equal(pass.code, 0, pass.stderr);
  const sent = (await s.runs()).find((r) => r.id === 'aaaaaaaaaaaa');
  assert.deepEqual([sent.state, sent.why], ['done', 'uploaded'], 'sent by the pass that came after the share');
  assert.deepEqual(s.server.uploads.map((u) => u.head), [away, tip]);
});

test('D228 review 4: a pass writes no `replaced` over a review a share put online while the pass was sending',
  async (t) => {
    const s = await setup(t);
    await updateHooks(s.where, (repos) => [...repos, { common: s.common, server: s.server.url }]);
    const base = s.repo.git(['rev-parse', 'main']);
    const other = await s.repo.commit('other', `${MATH_V2}// another branch\n`);
    assert.equal((await s.visual(['main..other'])).code, 0);
    const older = await s.repo.commit('feature', MATH_V2);
    assert.equal((await s.visual(['main..feature'])).code, 0);
    const tip = await s.repo.commit('feature', `${MATH_V2}// newer\n`);
    assert.equal((await s.visual([`${base}..feature`])).code, 0);
    const of = (patch) => ({ status: null, common: s.common, dir: s.top, repo: 'acme/widgets', base,
      server: s.server.url, login: 'octo', ...patch });
    // runs.json keeps the runs in the order they were written, and the pass reads it once: this upload of another
    // branch is sent first, while the review of `feature` below still waits.
    await updateRun(s.where, 'aaaaaaaaaaaa', of({ state: 'pending_upload', why: 'upload_failed', branch: 'other',
      sha: other, out: s.folderOf(base, other), at: '2026-11-11T09:00:00.000Z' }));
    await updateRun(s.where, 'bbbbbbbbbbbb', of({ state: 'pending_upload', why: 'upload_failed', branch: 'feature',
      sha: older, out: s.folderOf(base, older), at: '2026-11-11T10:00:00.000Z' }));
    await updateRun(s.where, 'cccccccccccc', of({ state: 'done', why: 'uploaded', branch: 'feature', sha: tip,
      out: s.folderOf(base, tip), url: `${s.server.url}/r/acme/widgets/feature`, at: '2026-11-11T11:00:00.000Z' }));
    const url = `${s.server.url}/r/acme/widgets/feature/older`;
    // While that first upload is in flight, the person runs `sonah share` of the review that waits in another
    // terminal: it takes the run (`claimRun`), the server takes the page, and the run is `shared` with its link.
    // An answer this test gives is not counted among the server's uploads, so the pages sent are read here.
    const sent = [];
    s.server.once('POST', '/api/uploads', async (call) => {
      sent.push(JSON.parse(call.body));
      await updateRun(s.where, 'bbbbbbbbbbbb', { state: 'shared', why: 'uploaded', url, pid: process.pid,
        start: await processStart(process.pid) });
      return { status: 201, json: { url: `${s.server.url}/r/acme/widgets/other`,
        version: { head: sent.at(-1).head, base, at: new Date().toISOString() }, prs: [], dropped: {} } };
    });

    const pass = await runEntry(['push-run', '--repo', s.repo.work], { env: s.env, cwd: s.repo.work });
    assert.equal(pass.code, 0, pass.stderr);
    const run = (await s.runs()).find((r) => r.id === 'bbbbbbbbbbbb');
    assert.deepEqual([run.state, run.why, run.url], ['shared', 'uploaded', url], 'the page the share put online');
    assert.deepEqual(sent.map((u) => u.head), [other], 'the pass sent the other branch\'s review only');
    assert.deepEqual(routesOf(s.server), ['POST /api/uploads'], 'and nothing of the one it was told about');
    const mine = (await s.runs()).find((r) => r.id === 'aaaaaaaaaaaa');
    assert.deepEqual([mine.state, mine.why], ['done', 'uploaded'], 'the pass\'s own send went through');
  });

test('D228 review 4: INSTALL says the graphs page of a review names the connected server too', async () => {
  const flat = (text) => text.replace(/\s+/g, ' ');
  const install = flat(await readFile(new URL('../../../docs/INSTALL.md', import.meta.url), 'utf8'));
  assert.equal(install.includes('the buttons of a page that `sonah visual` or plain `sonah` draws name that server '
    + 'instead, so one computer sends to one server;'), false, 'not those two pages only');
  // C8 review 4: the server is the connection's when the page is drawn, and the page keeps it, so INSTALL no longer
  // says that one computer sends to one server (team-privacy-docs holds the rest of the docs to it).
  assert.ok(install.includes('the buttons of a page that `sonah visual` or plain `sonah` draws from then on name that '
    + 'server instead, and so do those of the graphs page that `sonah review --format html` draws'));
  assert.equal(install.includes('one computer sends to one server'), false);
  assert.ok(install.includes('with the same default model, folder and server for its buttons'), 'and in From a review');
});

test('D228 review 5: a commit undone here and not pushed leaves the pass sending the review of the commit the '
  + 'remote\'s branch holds', async (t) => {
  const s = await setup(t);
  await updateHooks(s.where, (repos) => [...repos, { common: s.common, server: s.server.url }]);
  const base = s.repo.git(['rev-parse', 'main']);
  const first = await s.repo.commit('feature', MATH_V2);
  assert.equal((await s.visual(['main..feature'])).code, 0);
  s.repo.git(['push', '-q', 'origin', 'feature']);
  const tip = await s.repo.commit('feature', `${MATH_V2}// newer\n`);
  assert.equal((await s.visual([`${base}..feature`])).code, 0);
  s.repo.git(['push', '-q', 'origin', 'feature']);
  // The person undoes that commit here and has not pushed (a `git reset --hard HEAD~1`, as before a force-push; a
  // `git commit --amend` and a rebase leave the branch the same way): the remote's branch still holds the commit, so
  // the review of it is the one the team waits for, and the one of the commit before it is not newer for being on
  // this computer's branch.
  s.repo.git(['reset', '--hard', first]);
  assert.equal(s.repo.git(['rev-parse', 'refs/heads/feature']), first, 'this computer\'s branch');
  assert.equal(s.repo.git(['rev-parse', 'refs/remotes/origin/feature']), tip, 'the remote\'s');
  const of = (patch) => ({ status: null, common: s.common, dir: s.top, repo: 'acme/widgets', branch: 'feature', base,
    remote: 'origin', server: s.server.url, login: 'octo', ...patch });
  await updateRun(s.where, 'aaaaaaaaaaaa', of({ state: 'done', why: 'uploaded', sha: first,
    out: s.folderOf(base, first), url: `${s.server.url}/r/acme/widgets/feature`, at: '2026-11-11T10:00:00.000Z' }));
  // The push of the commit the remote holds: the server did not take its upload, so that review waits to be sent.
  await updateRun(s.where, 'bbbbbbbbbbbb', of({ state: 'pending_upload', why: 'upload_failed', sha: tip,
    out: s.folderOf(base, tip), at: '2026-11-11T11:00:00.000Z' }));

  const pass = await runEntry(['push-run', '--repo', s.repo.work], { env: s.env, cwd: s.repo.work });
  assert.equal(pass.code, 0, pass.stderr);
  const after = (await s.runs()).find((r) => r.id === 'bbbbbbbbbbbb');
  assert.deepEqual([after.state, after.why], ['done', 'uploaded'], 'the review of the commit the remote holds, sent');
  assert.equal(s.server.uploads.length, 1, 'and no review of the commit before it');
  assert.equal(s.server.uploads[0].head, tip);
  assert.deepEqual(routesOf(s.server), ['POST /api/uploads']);
});

test('D228 review 5: a share of the page of the commit the remote\'s branch holds replaces the waiting review of an '
  + 'earlier commit of it, with an amended commit on this computer\'s branch', async (t) => {
  const s = await setup(t);
  await updateHooks(s.where, (repos) => [...repos, { common: s.common, server: s.server.url }]);
  const base = s.repo.git(['rev-parse', 'main']);
  const older = await s.repo.commit('feature', MATH_V2);
  assert.equal((await s.visual(['main..feature'])).code, 0);
  s.repo.git(['push', '-q', 'origin', 'feature']);
  const pushed = await s.repo.commit('feature', `${MATH_V2}// newer\n`);
  assert.equal((await s.visual([`${base}..feature`])).code, 0);
  s.repo.git(['push', '-q', 'origin', 'feature']);
  // The review of the first push waits to be sent: the server did not take its upload.
  await updateRun(s.where, 'aaaaaaaaaaaa', { state: 'pending_upload', why: 'upload_failed', status: null,
    common: s.common, dir: s.top, repo: 'acme/widgets', branch: 'feature', sha: older, base, remote: 'origin',
    out: s.folderOf(base, older), server: s.server.url, login: 'octo', at: '2026-11-11T10:00:00.000Z' });
  // They amend the pushed commit and have not force-pushed, then share the page of the commit the remote holds.
  s.repo.git(['commit', '-q', '--amend', '-m', 'Change feature again']);
  assert.notEqual(s.repo.git(['rev-parse', 'refs/heads/feature']), pushed, 'this computer\'s branch moved');
  assert.equal(s.repo.git(['rev-parse', 'refs/remotes/origin/feature']), pushed, 'and the remote\'s did not');

  const shared = await s.share(['--dir', s.folderOf(base, pushed), '--branch', 'feature']);
  assert.equal(shared.code, 0, shared.stderr);
  const waiting = (await s.runs()).find((r) => r.id === 'aaaaaaaaaaaa');
  assert.deepEqual([waiting.state, waiting.why], ['replaced', 'newer_push'], 'the review of the earlier commit');
  // And no pass puts that earlier review up over the page the person was just given the link to.
  const pass = await runEntry(['push-run', '--repo', s.repo.work], { env: s.env, cwd: s.repo.work });
  assert.equal(pass.code, 0, pass.stderr);
  assert.deepEqual(s.server.uploads.map((u) => u.head), [pushed], 'the shared page, and nothing after it');
});

test('D228 review 5: a pass writes no `connection_changed` over a review a share put online while the pass was '
  + 'sending', async (t) => {
  const s = await setup(t);
  await updateHooks(s.where, (repos) => [...repos, { common: s.common, server: s.server.url }]);
  const base = s.repo.git(['rev-parse', 'main']);
  const other = await s.repo.commit('other', `${MATH_V2}// another branch\n`);
  assert.equal((await s.visual(['main..other'])).code, 0);
  const head = await s.repo.commit('feature', MATH_V2);
  assert.equal((await s.visual(['main..feature'])).code, 0);
  const of = (patch) => ({ status: null, common: s.common, dir: s.top, repo: 'acme/widgets', base,
    server: s.server.url, login: 'octo', ...patch });
  // runs.json keeps the runs in the order they were written, and the pass reads it once: this upload of another
  // branch is sent first, while the review of `feature` below still waits.
  await updateRun(s.where, 'aaaaaaaaaaaa', of({ state: 'pending_upload', why: 'upload_failed', branch: 'other',
    sha: other, out: s.folderOf(base, other), at: '2026-11-11T09:00:00.000Z' }));
  // The review of `feature` was `uploading` under a live runner while the person connected to another server, so
  // `endPendingUploads` left it; that runner was then killed, so it waits to be sent with the server of the
  // connection that ended on it (review 3's own case, which `sonah status` and INSTALL tell them to share).
  await updateRun(s.where, 'bbbbbbbbbbbb', of({ state: 'uploading', why: null, branch: 'feature', sha: head,
    out: s.folderOf(base, head), server: 'https://old.invalid', login: 'old-octo', pid: null, start: null,
    at: '2026-11-11T10:00:00.000Z' }));
  const url = `${s.server.url}/r/acme/widgets/feature`;
  // While that first upload is in flight, the person runs `sonah share` of the review that waits in another terminal:
  // it re-homes the run to this connection (share-command.js writes `server` and `login` before its upload), takes it
  // (`claimRun`), the server takes the page, and the run is `shared` with its link.
  const sent = [];
  s.server.once('POST', '/api/uploads', async (call) => {
    sent.push(JSON.parse(call.body));
    await updateRun(s.where, 'bbbbbbbbbbbb', { state: 'shared', why: 'uploaded', url, server: s.server.url,
      login: 'octo', pid: process.pid, start: await processStart(process.pid) });
    return { status: 201, json: { url: `${s.server.url}/r/acme/widgets/other`,
      version: { head: sent.at(-1).head, base, at: new Date().toISOString() }, prs: [], dropped: {} } };
  });

  const pass = await runEntry(['push-run', '--repo', s.repo.work], { env: s.env, cwd: s.repo.work });
  assert.equal(pass.code, 0, pass.stderr);
  const run = (await s.runs()).find((r) => r.id === 'bbbbbbbbbbbb');
  assert.deepEqual([run.state, run.why, run.url], ['shared', 'uploaded', url], 'the page the share put online');
  assert.deepEqual(sent.map((u) => u.head), [other], 'the pass sent the other branch\'s review only');
  assert.deepEqual(routesOf(s.server), ['POST /api/uploads'], 'and nothing of the one it was told about');
  const mine = (await s.runs()).find((r) => r.id === 'aaaaaaaaaaaa');
  assert.deepEqual([mine.state, mine.why], ['done', 'uploaded'], 'the pass\'s own send went through');
});

test('D228 review 5: an end a pass read before it took a run is written over no share\'s page and link', async (t) => {
  const s = await setup(t);
  await updateHooks(s.where, (repos) => [...repos, { common: s.common, server: s.server.url }]);
  const base = s.repo.git(['rev-parse', 'main']);
  const other = await s.repo.commit('other', `${MATH_V2}// another branch\n`);
  assert.equal((await s.visual(['main..other'])).code, 0);
  const head = await s.repo.commit('feature', MATH_V2);
  assert.equal((await s.visual(['main..feature'])).code, 0);
  const of = (patch) => ({ status: null, common: s.common, dir: s.top, repo: 'acme/widgets', base,
    server: s.server.url, login: 'octo', ...patch });
  await updateRun(s.where, 'aaaaaaaaaaaa', of({ state: 'pending_upload', why: 'upload_failed', branch: 'other',
    sha: other, out: s.folderOf(base, other), at: '2026-11-11T09:00:00.000Z' }));
  await updateRun(s.where, 'bbbbbbbbbbbb', of({ state: 'pending_upload', why: 'upload_failed', branch: 'feature',
    sha: head, out: s.folderOf(base, head), at: '2026-11-11T10:00:00.000Z' }));
  const url = `${s.server.url}/r/acme/widgets/feature`;
  // While the pass's first upload is in flight, a `sonah share` puts the review of `feature` online, and the person
  // turns the push hook of the repository off. The pass then reaches that run and `sendFolder` reads the hook before
  // it takes the run, so it never holds it: the end is no write of this pass's, and least of all one that takes the
  // link the person was just given off the row (`url: sent.url ?? null`).
  const sent = [];
  s.server.once('POST', '/api/uploads', async (call) => {
    sent.push(JSON.parse(call.body));
    await updateRun(s.where, 'bbbbbbbbbbbb', { state: 'shared', why: 'uploaded', url, pid: process.pid,
      start: await processStart(process.pid) });
    await updateHooks(s.where, (repos) => repos.filter((r) => r.common !== s.common));
    return { status: 201, json: { url: `${s.server.url}/r/acme/widgets/other`,
      version: { head: sent.at(-1).head, base, at: new Date().toISOString() }, prs: [], dropped: {} } };
  });

  const pass = await runEntry(['push-run', '--repo', s.repo.work], { env: s.env, cwd: s.repo.work });
  assert.equal(pass.code, 0, pass.stderr);
  const run = (await s.runs()).find((r) => r.id === 'bbbbbbbbbbbb');
  assert.deepEqual([run.state, run.why, run.url], ['shared', 'uploaded', url], 'the page the share put online');
  assert.deepEqual(sent.map((u) => u.head), [other], 'the pass sent the other branch\'s review only');
  assert.deepEqual(routesOf(s.server), ['POST /api/uploads']);
});

test('D228 review (second look 1): a branch another process is uploading now is left to that process this pass, and '
  + 'the next pass sends it', async (t) => {
  const s = await setup(t);
  await updateHooks(s.where, (repos) => [...repos, { common: s.common, server: s.server.url }]);
  const base = s.repo.git(['rev-parse', 'main']);
  const older = await s.repo.commit('feature', MATH_V2);
  assert.equal((await s.visual(['main..feature'])).code, 0);
  const newer = await s.repo.commit('feature', `${MATH_V2}// newer\n`);
  assert.equal((await s.visual([`${base}..feature`])).code, 0);
  s.repo.git(['push', '-q', 'origin', 'feature']);
  const of = (patch) => ({ status: null, common: s.common, dir: s.top, repo: 'acme/widgets', branch: 'feature', base,
    remote: 'origin', server: s.server.url, login: 'octo', ...patch });
  // The push of the older commit was drawn and the server did not take its upload, so that review waits to be sent.
  await updateRun(s.where, 'aaaaaaaaaaaa', of({ state: 'pending_upload', why: 'upload_failed', sha: older,
    out: s.folderOf(base, older), at: '2026-11-11T10:00:00.000Z' }));
  // And a `sonah share` of the newer page is going in another terminal: it wrote its run `uploading` under its own
  // live process before its upload, and that upload is in flight. This test's own process stands for it.
  await updateRun(s.where, 'bbbbbbbbbbbb', of({ state: 'uploading', why: null, sha: newer,
    out: s.folderOf(base, newer), at: '2026-11-11T11:00:00.000Z', pid: process.pid,
    start: await processStart(process.pid) }));

  const pass = await runEntry(['push-run', '--repo', s.repo.work], { env: s.env, cwd: s.repo.work });
  assert.equal(pass.code, 0, pass.stderr);
  // A row a live process holds is in neither arm of the pass's candidate set, so the older review was the only one
  // the pass could elect as the branch's newest: it sent it, and nothing orders the two uploads, so the server could
  // have been left holding the review of the older commit as the branch's head while the person was handed the link
  // of the newer one.
  assert.deepEqual(routesOf(s.server), [], 'the pass sent nothing of that branch');
  const held = await s.runs();
  assert.deepEqual([held.find((r) => r.id === 'aaaaaaaaaaaa'), held.find((r) => r.id === 'bbbbbbbbbbbb')]
    .map((r) => [r.state, r.why]), [['pending_upload', 'upload_failed'], ['uploading', null]],
  'and ended neither of them');
  // The review is left waiting, not lost: once that process is gone (here, a row with no process at all), the next
  // pass sends the newest review of the branch and replaces the older one, as it always does.
  await updateRun(s.where, 'bbbbbbbbbbbb', { pid: null, start: null });
  const again = await runEntry(['push-run', '--repo', s.repo.work], { env: s.env, cwd: s.repo.work });
  assert.equal(again.code, 0, again.stderr);
  assert.deepEqual(s.server.uploads.map((u) => u.head), [newer]);
  const after = await s.runs();
  assert.deepEqual([after.find((r) => r.id === 'bbbbbbbbbbbb'), after.find((r) => r.id === 'aaaaaaaaaaaa')]
    .map((r) => [r.state, r.why]), [['done', 'uploaded'], ['replaced', 'newer_push']]);
});

test('D228 review (second look 1): two remotes are two reviews on the server: a share of one leaves the waiting '
  + 'review of the other repository, and a pass sends it', async (t) => {
  const s = await setup(t);
  await updateHooks(s.where, (repos) => [...repos, { common: s.common, server: s.server.url }]);
  // A fork workflow: `origin` is this person's fork (acme/widgets), `upstream` the team's repository (team/app), both
  // on Sonah Team and both served by the stand-in for ssh.
  const bare = join(s.repo.root, 'remote', 'team', 'app.git');
  await mkdir(join(s.repo.root, 'remote', 'team'), { recursive: true });
  s.repo.git(['init', '-q', '--bare', '-b', 'main', bare], {}, s.repo.root);
  s.repo.git(['remote', 'add', 'upstream', 'ssh://example.invalid/team/app.git']);
  const base = s.repo.git(['rev-parse', 'main']);
  const head = await s.repo.commit('feature', MATH_V2);
  assert.equal((await s.visual(['main..feature'])).code, 0);
  s.repo.git(['push', '-q', 'upstream', 'feature']);
  // The push to the team's repository was drawn and the server did not take its upload, so that review waits.
  await updateRun(s.where, 'aaaaaaaaaaaa', { state: 'pending_upload', why: 'upload_failed', status: null,
    common: s.common, dir: s.top, repo: 'team/app', branch: 'feature', sha: head, base, remote: 'upstream',
    out: s.folderOf(base, head), server: s.server.url, login: 'octo', at: '2026-11-11T10:00:00.000Z' });

  // `sonah share` here sends under the branch's push remote, which is `origin`: the person's own fork.
  const shared = await s.share();
  assert.equal(shared.code, 0, shared.stderr);
  const rows = await s.runs();
  const waiting = rows.find((r) => r.id === 'aaaaaaaaaaaa');
  // Read by the branch alone, the share took that run for its own (one branch, one commit, one folder) and sent it
  // as its own repository, so the review of the repository it was pushed to was never sent and its row named the
  // page of another one; what the share did not take, it ended `replaced`, `newer_push`.
  assert.deepEqual([waiting.state, waiting.why, waiting.repo], ['pending_upload', 'upload_failed', 'team/app'],
    'the review of the team repository still waits, and is still of that repository');
  const mine = rows.find((r) => r.id !== 'aaaaaaaaaaaa');
  assert.deepEqual([mine.state, mine.repo, mine.remote], ['shared', 'acme/widgets', 'origin'],
    'and the share is its own run');

  // And the next pass sends the one that waits, to the repository it was pushed to.
  const pass = await runEntry(['push-run', '--repo', s.repo.work], { env: s.env, cwd: s.repo.work });
  assert.equal(pass.code, 0, pass.stderr);
  assert.deepEqual(s.server.uploads.map((u) => `${u.repo.owner}/${u.repo.name} ${u.branch} ${u.head}`),
    [`acme/widgets feature ${head}`, `team/app feature ${head}`]);
  const sent = (await s.runs()).find((r) => r.id === 'aaaaaaaaaaaa');
  assert.deepEqual([sent.state, sent.why], ['done', 'uploaded']);
});

test('D228 review (second look 1): a clone whose refspecs map no such ref reads the pushed branch from the remote, so '
  + 'a commit put back and force-pushed does not send the dropped commit\'s review', async (t) => {
  const s = await setup(t);
  await updateHooks(s.where, (repos) => [...repos, { common: s.common, server: s.server.url }]);
  // What `git clone --single-branch` leaves behind (and `--depth 1` with it): one refspec, for one branch, so a push
  // of any other branch moves no remote-tracking ref at all and there is no local answer to read.
  s.repo.git(['config', 'remote.origin.fetch', '+refs/heads/main:refs/remotes/origin/main']);
  const base = s.repo.git(['rev-parse', 'main']);
  const kept = await s.repo.commit('feature', MATH_V2);
  assert.equal((await s.visual(['main..feature'])).code, 0);
  const dropped = await s.repo.commit('feature', `${MATH_V2}// dropped\n`);
  assert.equal((await s.visual([`${base}..feature`])).code, 0);
  s.repo.git(['push', '-q', 'origin', 'feature']);
  // The person drops that commit and force-pushes, so the remote's branch holds the first commit again.
  s.repo.git(['reset', '--hard', kept]);
  s.repo.git(['push', '-q', '--force', 'origin', 'feature']);
  assert.equal(s.repo.run(['rev-parse', '--verify', '--quiet', 'refs/remotes/origin/feature']).code, 1,
    'no remote-tracking ref of the pushed branch is here');
  const of = (patch) => ({ status: null, common: s.common, dir: s.top, repo: 'acme/widgets', branch: 'feature', base,
    remote: 'origin', server: s.server.url, login: 'octo', ...patch });
  // Both pushes were drawn and neither upload reached the server, so both reviews wait to be sent.
  await updateRun(s.where, 'aaaaaaaaaaaa', of({ state: 'pending_upload', why: 'upload_failed', sha: dropped,
    out: s.folderOf(base, dropped), at: '2026-11-11T10:00:00.000Z' }));
  await updateRun(s.where, 'bbbbbbbbbbbb', of({ state: 'pending_upload', why: 'upload_failed', sha: kept,
    out: s.folderOf(base, kept), at: '2026-11-11T11:00:00.000Z' }));
  assert.equal(await pushedTip(s.common, await s.runs(), 'feature', { env: s.env, git: gitOut }), kept,
    'the commit the remote holds, asked of the remote');

  const pass = await runEntry(['push-run', '--repo', s.repo.work], { env: s.env, cwd: s.repo.work });
  assert.equal(pass.code, 0, pass.stderr);
  // With no commit for the branch, the pair falls to the commits, where the dropped commit holds the one the branch
  // was put back to: that is the order review 4 was added to correct, and a pass then sent the review of a commit the
  // branch no longer holds and ended the only review of the commit the team can see `replaced`.
  assert.deepEqual(s.server.uploads.map((u) => u.head), [kept], 'the review of the commit the remote holds');
  const after = await s.runs();
  assert.deepEqual([after.find((r) => r.id === 'bbbbbbbbbbbb'), after.find((r) => r.id === 'aaaaaaaaaaaa')]
    .map((r) => [r.state, r.why]), [['done', 'uploaded'], ['replaced', 'newer_push']]);
});

test('D228 review (second look 1): with no remote named by every run of a branch, the commit it holds is not read '
  + 'from this computer\'s own origin', async (t) => {
  const s = await setup(t);
  await updateHooks(s.where, (repos) => [...repos, { common: s.common, server: s.server.url }]);
  const base = s.repo.git(['rev-parse', 'main']);
  // What this computer's own `origin` holds on a branch of that name: another line of commits, pushed from here.
  const ancestor = await s.repo.commit('elsewhere', MATH_V2);
  assert.equal((await s.visual(['main..elsewhere'])).code, 0);
  const stale = await s.repo.commit('elsewhere', `${MATH_V2}// and on\n`);
  s.repo.git(['push', '-q', 'origin', 'elsewhere:refs/heads/feature']);
  assert.equal(s.repo.git(['rev-parse', 'refs/remotes/origin/feature']), stale);
  // The branch the pushes went to: `git push https://… HEAD:feature`, so the runs name no remote (`ticketFields`
  // keeps only a remote's name) and this computer cannot say which branch they reached.
  const pushed = await s.repo.commit('feature', `${MATH_V2}// the pushed line\n`);
  assert.equal((await s.visual([`${base}..feature`])).code, 0);
  const of = (patch) => ({ status: null, common: s.common, dir: s.top, repo: 'acme/widgets', branch: 'feature', base,
    server: s.server.url, login: 'octo', ...patch });
  await updateRun(s.where, 'aaaaaaaaaaaa', of({ state: 'pending_upload', why: 'upload_failed', sha: ancestor,
    out: s.folderOf(base, ancestor), at: '2026-11-11T10:00:00.000Z' }));
  await updateRun(s.where, 'bbbbbbbbbbbb', of({ state: 'pending_upload', why: 'upload_failed', sha: pushed,
    out: s.folderOf(base, pushed), at: '2026-11-11T11:00:00.000Z' }));
  const rows = await s.runs();
  assert.deepEqual(rows.map((r) => r.remote), [null, null]);
  const tip = (list) => pushedTip(s.common, list, 'feature', { env: s.env, git: gitOut });
  assert.equal(await tip(rows), null, 'no run names a remote, so there is no branch of one to read');
  assert.equal(await tip([{ remote: 'origin' }]), stale, 'with one named, the branch on that remote');
  // D228 review (second look 2, review 2): with one of them named, that name is read and the run that names none is
  // left out of the names. It is no `origin` by default — the read above is still null with no name at all — but a
  // name a push of this very review went out through; refusing the whole set for the run that names none left the
  // force-push case of a clone whose own rows name both with no branch to read at all, where the commits elect the
  // dropped commit's review and end the tip's `replaced`, `newer_push`.
  assert.equal(await tip([{ remote: 'origin' }, { remote: null }]), stale,
    'and a run that names none is left out of the names, not refused for all of them');

  const pass = await runEntry(['push-run', '--repo', s.repo.work], { env: s.env, cwd: s.repo.work });
  assert.equal(pass.code, 0, pass.stderr);
  // Read from `origin` by default, the commit it holds on its own `feature` decided before the commits and the times:
  // the pushed commit is on no line of it, an ancestor of it is, so the older review was elected as the branch's
  // newest and the pushed commit's ended `replaced`, `newer_push`, which nothing sends again.
  assert.deepEqual(s.server.uploads.map((u) => u.head), [pushed], 'the newer review of the branch, by the times');
  const after = await s.runs();
  assert.deepEqual([after.find((r) => r.id === 'bbbbbbbbbbbb'), after.find((r) => r.id === 'aaaaaaaaaaaa')]
    .map((r) => [r.state, r.why]), [['done', 'uploaded'], ['replaced', 'newer_push']]);
});

test('D228 review (second look 2): a remote whose refspecs map the branch into this computer\'s own namespace does '
  + 'not make this computer\'s branch the commit the remote holds', async (t) => {
  const s = await setup(t);
  await updateHooks(s.where, (repos) => [...repos, { common: s.common, server: s.server.url }]);
  // What a mirror-style clone is left with, and what a backup remote is often given by hand: a refspec that maps every
  // ref of the remote onto the ref of the same name here, so a push of a branch moves no remote-tracking ref at all
  // and `refs/heads/<branch>` is what the fetch refspecs mapped the pushed branch to.
  s.repo.git(['config', 'remote.origin.fetch', '+refs/*:refs/*']);
  const base = s.repo.git(['rev-parse', 'main']);
  const first = await s.repo.commit('feature', MATH_V2);
  assert.equal((await s.visual(['main..feature'])).code, 0);
  s.repo.git(['push', '-q', 'origin', 'feature']);
  const tip = await s.repo.commit('feature', `${MATH_V2}// newer\n`);
  assert.equal((await s.visual([`${base}..feature`])).code, 0);
  s.repo.git(['push', '-q', 'origin', 'feature']);
  // The person undoes the pushed commit here and has not pushed (a `git reset --hard`, as before a force-push; an
  // amend and a rebase leave the branch the same way), so the remote's branch still holds it.
  s.repo.git(['reset', '--hard', first]);
  assert.equal(s.repo.git(['rev-parse', 'refs/heads/feature']), first, 'this computer\'s branch');
  assert.equal(s.repo.run(['rev-parse', '--verify', '--quiet', 'refs/remotes/origin/feature']).code, 1,
    'and no remote-tracking ref of it is here at all');
  assert.equal(await trackingRef(s.common, 'origin', 'feature', { env: s.env, git: gitOut }), null,
    'a refspec that maps the branch outside refs/remotes/ maps no remote-tracking ref of it');
  assert.equal(await pushedTip(s.common, [{ remote: 'origin' }], 'feature', { env: s.env, git: gitOut }), tip,
    'so the commit the branch holds is asked of the remote, which holds the pushed commit');
  const of = (patch) => ({ status: null, common: s.common, dir: s.top, repo: 'acme/widgets', branch: 'feature', base,
    remote: 'origin', server: s.server.url, login: 'octo', ...patch });
  await updateRun(s.where, 'aaaaaaaaaaaa', of({ state: 'done', why: 'uploaded', sha: first,
    out: s.folderOf(base, first), url: `${s.server.url}/r/acme/widgets/feature`, at: '2026-11-11T10:00:00.000Z' }));
  // The push of the commit the remote holds: the server did not take its upload, so that review waits to be sent.
  await updateRun(s.where, 'bbbbbbbbbbbb', of({ state: 'pending_upload', why: 'upload_failed', sha: tip,
    out: s.folderOf(base, tip), at: '2026-11-11T11:00:00.000Z' }));

  const pass = await runEntry(['push-run', '--repo', s.repo.work], { env: s.env, cwd: s.repo.work });
  assert.equal(pass.code, 0, pass.stderr);
  // Read from `refs/heads/feature`, which those refspecs mapped the branch to, the commit this computer's own branch
  // was put back to elected the review of that commit by the branch's line, and the only review of the commit the
  // team can see ended `replaced`, `newer_push`, which `waitsToSend` is false for: review 5's own bug in full, on
  // every amend or reset in such a repository.
  assert.deepEqual(s.server.uploads.map((u) => u.head), [tip], 'the review of the commit the remote holds, sent');
  const after = await s.runs();
  assert.deepEqual([after.find((r) => r.id === 'bbbbbbbbbbbb'), after.find((r) => r.id === 'aaaaaaaaaaaa')]
    .map((r) => [r.state, r.why]), [['done', 'uploaded'], ['done', 'uploaded']],
  'and the review of the commit this computer\'s branch holds replaced nothing');
});

test('D228 review (second look 2): two clones of one repository are one review on the server: a pass leaves its own '
  + 'older review of the branch where another clone put the newer one up', async (t) => {
  const s = await setup(t);
  await updateHooks(s.where, (repos) => [...repos, { common: s.common, server: s.server.url }]);
  // A second clone of the same repository on the same computer — another git common dir, the same owner and name on
  // the server — both with the push hook on and both pushing `feature`, which is what a person with a worktree per
  // task and a clone per task has.
  const second = join(s.repo.root, 'second clone');
  s.repo.git(['clone', '-q', '-c', `core.sshCommand='${join(s.repo.root, 'ssh-shim.sh')}'`, '-c', 'ssh.variant=simple',
    PUSH_REMOTE, second], {}, s.repo.root);
  const secondCommon = await realpath(join(second, '.git'));
  assert.notEqual(secondCommon, s.common);
  await updateHooks(s.where, (repos) => [...repos, { common: secondCommon, server: s.server.url }]);
  const base = s.repo.git(['rev-parse', 'main']);
  // This clone's push, drawn here: the server answered 503, so its review waits to be sent.
  const older = await s.repo.commit('feature', MATH_V2);
  assert.equal((await s.visual(['main..feature'])).code, 0);
  s.repo.git(['push', '-q', 'origin', 'feature']);
  // The other clone's push of a commit after it, drawn and taken by the server: the page the team reads is of it.
  s.repo.git(['fetch', '-q', 'origin'], {}, second);
  s.repo.git(['checkout', '-q', '-B', 'feature', 'origin/feature'], {}, second);
  await writeFile(join(second, 'math.js'), `${MATH_V2}// from the other clone\n`);
  s.repo.git(['add', '.'], {}, second);
  s.repo.git(['commit', '-q', '-m', 'Change feature in the other clone'], {}, second);
  const newer = s.repo.git(['rev-parse', 'HEAD'], {}, second);
  s.repo.git(['push', '-q', 'origin', 'feature'], {}, second);
  s.repo.git(['fetch', '-q', 'origin']);
  assert.equal(s.repo.git(['rev-parse', 'refs/remotes/origin/feature']), newer, 'the commit the remote holds');
  const of = (patch) => ({ status: null, repo: 'acme/widgets', branch: 'feature', base, remote: 'origin',
    server: s.server.url, login: 'octo', ...patch });
  await updateRun(s.where, 'aaaaaaaaaaaa', of({ common: s.common, dir: s.top, state: 'pending_upload',
    why: 'upload_failed', sha: older, out: s.folderOf(base, older), at: '2026-11-11T10:00:00.000Z' }));
  await updateRun(s.where, 'bbbbbbbbbbbb', of({ common: secondCommon, dir: await realpath(second), state: 'done',
    why: 'uploaded', sha: newer, url: `${s.server.url}/r/acme/widgets/b/feature`, at: '2026-11-11T11:00:00.000Z',
    out: visualOutDir({ top: await realpath(second), base, head: newer, model: VISUAL_DEFAULT_MODEL, env: s.env }) }));

  const pass = await runEntry(['push-run', '--repo', s.repo.work], { env: s.env, cwd: s.repo.work });
  assert.equal(pass.code, 0, pass.stderr);
  // Elected from this clone's runs alone, the older review was the only candidate of its branch, so the pass POSTed
  // it and the page the team reads went back to the older commit, with nothing written `replaced` and `sonah status`
  // reading `done` in both clones.
  assert.deepEqual(routesOf(s.server), [],
    'the pass sent nothing of a branch whose newest review is the other clone\'s');
  const after = await s.runs();
  assert.deepEqual([after.find((r) => r.id === 'aaaaaaaaaaaa'), after.find((r) => r.id === 'bbbbbbbbbbbb')]
    .map((r) => [r.state, r.why]), [['pending_upload', 'upload_failed'], ['done', 'uploaded']],
  'and ended neither row: the other clone\'s pass or share decides its own');
});

test('D228 review (second look 2): one repository reached under two casings is one review: a pass does not put the '
  + 'older review of it up over the newer one', async (t) => {
  const s = await setup(t);
  await updateHooks(s.where, (repos) => [...repos, { common: s.common, server: s.server.url }]);
  const base = s.repo.git(['rev-parse', 'main']);
  const older = await s.repo.commit('feature', MATH_V2);
  assert.equal((await s.visual(['main..feature'])).code, 0);
  s.repo.git(['push', '-q', 'origin', 'feature']);
  const newer = await s.repo.commit('feature', `${MATH_V2}// newer\n`);
  s.repo.git(['push', '-q', 'origin', 'feature']);
  const of = (patch) => ({ status: null, common: s.common, dir: s.top, branch: 'feature', base, remote: 'origin',
    server: s.server.url, login: 'octo', ...patch });
  // The push of the older commit went to the repository as `https://github.com/Acme/Widgets.git` spells it, and the
  // server did not take its upload, so that review waits to be sent.
  await updateRun(s.where, 'aaaaaaaaaaaa', of({ repo: 'Acme/Widgets', state: 'pending_upload', why: 'upload_failed',
    sha: older, out: s.folderOf(base, older), at: '2026-11-11T10:00:00.000Z' }));
  // The push of the commit after it went to `git@github.com:acme/widgets.git` — the same GitHub repository, and the
  // same review on the server, which keys it by the owner and name in lower case — and the server took it.
  await updateRun(s.where, 'bbbbbbbbbbbb', of({ repo: 'acme/widgets', state: 'done', why: 'uploaded', sha: newer,
    out: s.folderOf(base, newer), url: `${s.server.url}/r/acme/widgets/b/feature`, at: '2026-11-11T11:00:00.000Z' }));

  const pass = await runEntry(['push-run', '--repo', s.repo.work], { env: s.env, cwd: s.repo.work });
  assert.equal(pass.code, 0, pass.stderr);
  // Keyed by the text of the two, the waiting review was alone in its group, was elected as its branch's newest and
  // was POSTed over the newer review the team was reading, with nothing written `replaced` and both rows `done`.
  assert.deepEqual(s.server.uploads.map((u) => u.head), [], 'the pass put no older review of the one review up');
  const after = await s.runs();
  assert.deepEqual([after.find((r) => r.id === 'aaaaaaaaaaaa'), after.find((r) => r.id === 'bbbbbbbbbbbb')]
    .map((r) => [r.state, r.why]), [['replaced', 'newer_push'], ['done', 'uploaded']],
  'and the older review of it says a newer one took its place');
});

test('D228 review (second look 2): a share takes up the waiting review of its branch pushed under another casing of '
  + 'the repository, instead of writing a second run of the one review', async (t) => {
  const s = await setup(t);
  const base = s.repo.git(['rev-parse', 'main']);
  const head = await s.repo.commit('feature', MATH_V2);
  assert.equal((await s.visual(['main..feature'])).code, 0);
  s.repo.git(['push', '-q', 'origin', 'feature']);
  // The push's review waits to be sent, and its run names the repository as its own push URL spelled it, where this
  // share reads `acme/widgets` from `git remote get-url --push` (`remoteRepository`).
  await updateRun(s.where, 'aaaaaaaaaaaa', { state: 'pending_upload', why: 'upload_failed', status: null,
    common: s.common, dir: s.top, repo: 'Acme/Widgets', branch: 'feature', sha: head, base, remote: 'origin',
    out: s.folderOf(base, head), server: s.server.url, login: 'octo', at: '2026-11-11T10:00:00.000Z' });

  const shared = await s.share();
  assert.equal(shared.code, 0, shared.stderr);
  // Matched on the text of the repository, the share took that run for another review and wrote a second run of the
  // one review the server keeps, leaving the first waiting to be sent — and `replaceOlder` left it waiting too.
  const rows = await s.runs();
  assert.deepEqual(rows.map((r) => [r.id, r.state, r.why]), [['aaaaaaaaaaaa', 'shared', 'uploaded']],
    'the review of this branch and commit that waits is this share\'s own run');
  assert.deepEqual(rows.map((r) => r.repo), ['Acme/Widgets'], 'and the run keeps what its push read');
  assert.equal(s.server.uploads.length, 1);
});

test('D228 review (second look 2, review 1): another clone\'s row does not take the commit the branch holds out of '
  + 'this clone\'s own election', async (t) => {
  const s = await setup(t);
  await updateHooks(s.where, (repos) => [...repos, { common: s.common, server: s.server.url }]);
  const base = s.repo.git(['rev-parse', 'main']);
  const kept = await s.repo.commit('feature', MATH_V2);
  assert.equal((await s.visual(['main..feature'])).code, 0);
  const dropped = await s.repo.commit('feature', `${MATH_V2}// dropped\n`);
  assert.equal((await s.visual([`${base}..feature`])).code, 0);
  s.repo.git(['push', '-q', 'origin', 'feature']);
  // Review 4's own case: the person drops that commit (`git reset --hard HEAD~1`, or in a rebase) and force-pushes, so
  // the remote's branch holds the first commit again while the dropped commit's review is the newer push's.
  s.repo.git(['reset', '--hard', kept]);
  s.repo.git(['push', '-q', '--force', 'origin', 'feature']);
  const of = (patch) => ({ status: null, common: s.common, dir: s.top, repo: 'acme/widgets', branch: 'feature', base,
    remote: 'origin', server: s.server.url, login: 'octo', ...patch });
  await updateRun(s.where, 'aaaaaaaaaaaa', of({ state: 'pending_upload', why: 'upload_failed', sha: dropped,
    out: s.folderOf(base, dropped), at: '2026-11-11T10:00:00.000Z' }));
  await updateRun(s.where, 'bbbbbbbbbbbb', of({ state: 'pending_upload', why: 'upload_failed', sha: kept,
    out: s.folderOf(base, kept), at: '2026-11-11T11:00:00.000Z' }));
  // Two rows of another clone of this repository on this computer, which the election reads as runs of the one review
  // the server keeps and this pass neither sends nor ends: one of a push made with an address, which leaves `remote`
  // null (`ticketFields`), and one of a clone that calls the team's repository `upstream`, its own `origin` being the
  // person's fork. A remote's name, and no name at all, are each clone's own word for where its push went.
  const other = join(s.repo.root, 'other clone');
  await updateRun(s.where, 'cccccccccccc', of({ common: join(other, '.git'), dir: other, remote: null,
    state: 'done', why: 'uploaded', sha: base, out: join(other, 'url push'),
    url: `${s.server.url}/r/acme/widgets/c/feature`, at: '2026-11-11T08:00:00.000Z' }));
  await updateRun(s.where, 'dddddddddddd', of({ common: join(other, '.git'), dir: other, remote: 'upstream',
    state: 'done', why: 'uploaded', sha: base, out: join(other, 'named push'),
    url: `${s.server.url}/r/acme/widgets/d/feature`, at: '2026-11-11T09:00:00.000Z' }));

  const pass = await runEntry(['push-run', '--repo', s.repo.work], { env: s.env, cwd: s.repo.work });
  assert.equal(pass.code, 0, pass.stderr);
  // Read over the whole set, one foreign row that names no remote (or another remote) left no commit of the branch to
  // read at all, and the commits then elected the dropped commit's review: the pass POSTed the page of a commit the
  // remote does not hold and ended the only review of the commit it does hold `replaced`, `newer_push`, which
  // `waitsToSend` is false for — review 4's and review 5's own bug, through a row this pass never writes.
  assert.deepEqual(s.server.uploads.map((u) => u.head), [kept], 'the review of the commit the remote holds, sent');
  const after = await s.runs();
  assert.deepEqual([after.find((r) => r.id === 'bbbbbbbbbbbb'), after.find((r) => r.id === 'aaaaaaaaaaaa'),
    after.find((r) => r.id === 'cccccccccccc'), after.find((r) => r.id === 'dddddddddddd')]
    .map((r) => [r.state, r.why]),
  [['done', 'uploaded'], ['replaced', 'newer_push'], ['done', 'uploaded'], ['done', 'uploaded']],
  'and the other clone\'s rows are neither sent nor ended');
});

test('D228 review (second look 2, review 1): two remotes of one repository are one review whose branch is still '
  + 'read, so a share of another line of commits leaves the tip\'s waiting review alone', async (t) => {
  const s = await setup(t);
  const base = s.repo.git(['rev-parse', 'main']);
  const tip = await s.repo.commit('feature', MATH_V2);
  assert.equal((await s.visual(['main..feature'])).code, 0);
  s.repo.git(['push', '-q', 'origin', 'feature']);
  // The same repository under a second remote, which is what an `ssh` remote beside an `https` one is: two casings of
  // one URL were two reviews before second look 2 folded the key, and are one review with two remote names after it.
  s.repo.git(['remote', 'add', 'gh', PUSH_REMOTE]);
  assert.equal(s.repo.run(['rev-parse', '--verify', '--quiet', 'refs/remotes/gh/feature']).code, 1,
    'and nothing of the branch was ever fetched through it');
  // A page of a commit of another line, which is what an older page of a branch is after any amend, rebase or squash.
  const away = await s.repo.commit('other', `${MATH_V2}// another line\n`);
  assert.equal((await s.visual(['main..other'])).code, 0);
  // The push of the branch's tip went out through `gh`, under the repository as that remote's URL spells it, and the
  // server did not take its upload: that review waits to be sent.
  await updateRun(s.where, 'aaaaaaaaaaaa', { state: 'pending_upload', why: 'upload_failed', status: null,
    common: s.common, dir: s.top, repo: 'Acme/Widgets', branch: 'feature', sha: tip, base, remote: 'gh',
    out: s.folderOf(base, tip), server: s.server.url, login: 'octo', at: '2026-11-11T10:00:00.000Z' });

  const shared = await s.share(['--dir', s.folderOf(base, away), '--branch', 'feature']);
  assert.equal(shared.code, 0, shared.stderr);
  // Refused for naming two remotes, the read of the commit the branch holds was null, and the times then gave the
  // share's page of another line the place of the waiting review of the tip — review 1's own failure, in the shape
  // review 4 closed for one remote only.
  const rows = await s.runs();
  const waiting = rows.find((r) => r.id === 'aaaaaaaaaaaa');
  assert.deepEqual([waiting.state, waiting.why], ['pending_upload', 'upload_failed'], 'the tip\'s review still waits');
  assert.deepEqual(rows.find((r) => r.id !== 'aaaaaaaaaaaa').remote, 'origin', 'and the share names its own remote');
});

test('D228 review (second look 2, review 1): a share of another clone\'s commit that git here cannot read does not '
  + 'take the place of the review of the commit the remote holds', async (t) => {
  const s = await setup(t);
  await updateHooks(s.where, (repos) => [...repos, { common: s.common, server: s.server.url }]);
  const base = s.repo.git(['rev-parse', 'main']);
  const head = await s.repo.commit('feature', MATH_V2);
  assert.equal((await s.visual(['main..feature'])).code, 0);
  s.repo.git(['push', '-q', 'origin', 'feature']);
  // A commit of the other clone that was never pushed, so this clone's git holds no object of it: every `merge-base`
  // of it answers nothing, and neither the branch's line nor the commits can say a word about the pair.
  const unpushed = createHash('sha1').update('a commit of the other clone').digest('hex');
  assert.equal(s.repo.run(['cat-file', '-e', unpushed]).code, 1, 'no object of it here');
  const other = join(s.repo.root, 'other clone');
  const of = (patch) => ({ status: null, repo: 'acme/widgets', branch: 'feature', base, remote: 'origin',
    server: s.server.url, login: 'octo', ...patch });
  // This clone's push of the commit the remote holds: the server answered 503, so its review waits to be sent.
  await updateRun(s.where, 'aaaaaaaaaaaa', of({ common: s.common, dir: s.top, state: 'pending_upload',
    why: 'upload_failed', sha: head, out: s.folderOf(base, head), at: '2026-11-11T10:00:00.000Z' }));
  // And the other clone's `sonah share` of the page of that unpushed commit, which the server took.
  await updateRun(s.where, 'bbbbbbbbbbbb', of({ common: join(other, '.git'), dir: other, state: 'shared',
    why: 'uploaded', sha: unpushed, out: join(other, 'page'), url: `${s.server.url}/r/acme/widgets/b/feature`,
    at: '2026-11-11T11:00:00.000Z' }));
  const rows = await s.runs();
  const row = (id) => rows.find((r) => r.id === id);
  const took = (run, older) => takesPlaceOf(row(run), row(older), { dir: s.common, env: s.env, git: gitOut, head });
  assert.equal(await took('bbbbbbbbbbbb', 'aaaaaaaaaaaa'), false,
    'a commit the branch does not hold takes nothing from the review of the commit it does');
  assert.equal(await took('aaaaaaaaaaaa', 'bbbbbbbbbbbb'), true, 'and that review takes its place');

  const pass = await runEntry(['push-run', '--repo', s.repo.work], { env: s.env, cwd: s.repo.work });
  assert.equal(pass.code, 0, pass.stderr);
  // Left to the times, the share of the unpushed commit was elected the branch's newest and the whole review was left
  // to the clone that holds it, so the only review of the commit the team can see was never sent — not by this pass
  // and not by any pass after it, since every pass reads the same rows and the same order.
  assert.deepEqual(s.server.uploads.map((u) => u.head), [head], 'the review of the commit the remote holds, sent');
  const after = await s.runs();
  assert.deepEqual([after.find((r) => r.id === 'aaaaaaaaaaaa'), after.find((r) => r.id === 'bbbbbbbbbbbb')]
    .map((r) => [r.state, r.why]), [['done', 'uploaded'], ['shared', 'uploaded']],
  'and the other clone\'s share is left as it is');
});

test('D228 review (second look 2, review 1): with another clone in the set the commit the branch holds is asked of '
  + 'the remote, so a cache this clone\'s own push moved does not elect its older review', async (t) => {
  const s = await setup(t);
  await updateHooks(s.where, (repos) => [...repos, { common: s.common, server: s.server.url }]);
  const second = join(s.repo.root, 'second clone');
  s.repo.git(['clone', '-q', '-c', `core.sshCommand='${join(s.repo.root, 'ssh-shim.sh')}'`, '-c', 'ssh.variant=simple',
    PUSH_REMOTE, second], {}, s.repo.root);
  const secondCommon = await realpath(join(second, '.git'));
  await updateHooks(s.where, (repos) => [...repos, { common: secondCommon, server: s.server.url }]);
  const base = s.repo.git(['rev-parse', 'main']);
  // This clone's push, drawn here: the server answered 503, so its review waits to be sent.
  const older = await s.repo.commit('feature', MATH_V2);
  assert.equal((await s.visual(['main..feature'])).code, 0);
  s.repo.git(['push', '-q', 'origin', 'feature']);
  // The other clone's push of a commit after it, which the server took: the page the team reads is of it. This clone
  // never fetches, so its own remote-tracking branch still names its own push — a cache that its own pushes and
  // fetches move and another clone's do not — and its object store holds nothing of the newer commit.
  s.repo.git(['fetch', '-q', 'origin'], {}, second);
  s.repo.git(['checkout', '-q', '-B', 'feature', 'origin/feature'], {}, second);
  await writeFile(join(second, 'math.js'), `${MATH_V2}// from the other clone\n`);
  s.repo.git(['add', '.'], {}, second);
  s.repo.git(['commit', '-q', '-m', 'Change feature in the other clone'], {}, second);
  const newer = s.repo.git(['rev-parse', 'HEAD'], {}, second);
  s.repo.git(['push', '-q', 'origin', 'feature'], {}, second);
  assert.equal(s.repo.git(['rev-parse', 'refs/remotes/origin/feature']), older, 'this clone\'s cache of the branch');
  assert.equal(s.repo.run(['cat-file', '-e', newer]).code, 1, 'and no object of the newer commit');
  const tip = (options) => pushedTip(s.common, [{ remote: 'origin' }], 'feature',
    { env: s.env, git: gitOut, ...options });
  assert.equal(await tip(), older, 'the cache answers for this clone\'s own runs');
  assert.equal(await tip({ fresh: true }), newer, 'and the remote itself for every clone\'s');
  const of = (patch) => ({ status: null, repo: 'acme/widgets', branch: 'feature', base, remote: 'origin',
    server: s.server.url, login: 'octo', ...patch });
  await updateRun(s.where, 'aaaaaaaaaaaa', of({ common: s.common, dir: s.top, state: 'pending_upload',
    why: 'upload_failed', sha: older, out: s.folderOf(base, older), at: '2026-11-11T10:00:00.000Z' }));
  await updateRun(s.where, 'bbbbbbbbbbbb', of({ common: secondCommon, dir: await realpath(second), state: 'done',
    why: 'uploaded', sha: newer, url: `${s.server.url}/r/acme/widgets/b/feature`, at: '2026-11-11T11:00:00.000Z',
    out: visualOutDir({ top: await realpath(second), base, head: newer, model: VISUAL_DEFAULT_MODEL, env: s.env }) }));
  const rows = await s.runs();
  const row = (id) => rows.find((r) => r.id === id);
  const took = (run, seen, head) => takesPlaceOf(row(run), row(seen), { dir: s.common, env: s.env, git: gitOut, head });
  assert.equal(await took('bbbbbbbbbbbb', 'aaaaaaaaaaaa', newer), true,
    'the review of the commit the remote holds, of one git here cannot relate to it');
  assert.equal(await took('aaaaaaaaaaaa', 'bbbbbbbbbbbb', newer), false);

  const pass = await runEntry(['push-run', '--repo', s.repo.work], { env: s.env, cwd: s.repo.work });
  assert.equal(pass.code, 0, pass.stderr);
  // Read from this clone's own cache, the commit it last pushed was taken for the commit the branch holds: its own
  // older review was elected the branch's newest by the branch's line and POSTed, and the page the team reads went
  // backwards over the newer review the server had already taken.
  assert.deepEqual(routesOf(s.server), [], 'the pass sent nothing of a branch whose newest review is another clone\'s');
  const after = await s.runs();
  assert.deepEqual([after.find((r) => r.id === 'aaaaaaaaaaaa'), after.find((r) => r.id === 'bbbbbbbbbbbb')]
    .map((r) => [r.state, r.why]), [['pending_upload', 'upload_failed'], ['done', 'uploaded']],
  'and ended neither row');
});

test('D228 review (second look 2, review 2): with no commit of the branch to read, one order of the set holds in '
  + 'every clone, so two clones do not each elect their own run and both POST it', async (t) => {
  const s = await setup(t);
  await updateHooks(s.where, (repos) => [...repos, { common: s.common, server: s.server.url }]);
  const base = s.repo.git(['rev-parse', 'main']);
  const head = await s.repo.commit('feature', MATH_V2);
  assert.equal((await s.visual(['main..feature'])).code, 0);
  s.repo.git(['push', '-q', 'origin', 'feature']);
  const unpushed = createHash('sha1').update('another clone, another line').digest('hex');
  const other = join(s.repo.root, 'other clone');
  // Both pushes were made with an address rather than a remote's name, so neither run names a remote and this
  // computer cannot say which branch either reached (second look 1): there is no commit of the branch to read.
  const of = (patch) => ({ status: null, repo: 'acme/widgets', branch: 'feature', base, remote: null,
    server: s.server.url, login: 'octo', ...patch });
  await updateRun(s.where, 'aaaaaaaaaaaa', of({ common: s.common, dir: s.top, state: 'pending_upload',
    why: 'upload_failed', sha: head, out: s.folderOf(base, head), at: '2026-11-11T10:00:00.000Z' }));
  // The other clone's own waiting review, of a commit git here holds nothing of: neither the branch's line nor the
  // commits can say a word about the pair, and the times are all that is left.
  await updateRun(s.where, 'bbbbbbbbbbbb', of({ common: join(other, '.git'), dir: other, state: 'pending_upload',
    why: 'upload_failed', sha: unpushed, out: join(other, 'page'), at: '2026-11-11T11:00:00.000Z' }));
  assert.equal(await pushedTip(s.common, await s.runs(), 'feature', { env: s.env, git: gitOut }), null,
    'no run names a remote, so there is no branch of one to read');
  const rows = await s.runs();
  const row = (id) => rows.find((r) => r.id === id);
  const took = (run, older) => takesPlaceOf(row(run), row(older), { dir: s.common, env: s.env, git: gitOut });
  assert.equal(await took('bbbbbbbbbbbb', 'aaaaaaaaaaaa'), true, 'the later run takes the place of the earlier one');
  assert.equal(await took('aaaaaaaaaaaa', 'bbbbbbbbbbbb'), false, 'and the order is the same read in either clone');

  const pass = await runEntry(['push-run', '--repo', s.repo.work], { env: s.env, cwd: s.repo.work });
  assert.equal(pass.code, 0, pass.stderr);
  // Review 1 gave the pass's own clone the place of another's where neither of git's orders can say a word, so that a
  // dormant clone's row could not hold this review off the sends for good. That order is each pass's own, not one
  // order of the set: this pass elected its own run and POSTed it, and the pass of the other clone elects its own and
  // POSTs that — two POSTs of the one review the server keeps, the team reading whichever landed last, both rows
  // reading `done` and nothing written `replaced`. The times say nothing across clones, but they say the same thing
  // in every one of them: this review waits, and `sonah status` says it waits to be sent.
  assert.deepEqual(s.server.uploads.map((u) => u.head), [], 'the pass POSTs nothing beside the other clone\'s run');
  const after = await s.runs();
  assert.deepEqual([after.find((r) => r.id === 'aaaaaaaaaaaa'), after.find((r) => r.id === 'bbbbbbbbbbbb')]
    .map((r) => [r.state, r.why]), [['pending_upload', 'upload_failed'], ['pending_upload', 'upload_failed']],
  'and it ends neither row');
});

test('D228 review (second look 2, review 2): a pass does not put its own older page over the review another clone '
  + 'already put on the server, where git here can relate neither commit', async (t) => {
  const s = await setup(t);
  await updateHooks(s.where, (repos) => [...repos, { common: s.common, server: s.server.url }]);
  const base = s.repo.git(['rev-parse', 'main']);
  const mine = await s.repo.commit('feature', MATH_V2);
  assert.equal((await s.visual(['main..feature'])).code, 0);
  // The push went out with the repository's address rather than `origin`'s name, so its run names no remote and there
  // is no commit of the branch to read at all (second look 1).
  s.repo.git(['push', '-q', PUSH_REMOTE, 'feature']);
  const theirs = createHash('sha1').update('the other clone\'s own commit').digest('hex');
  const other = join(s.repo.root, 'other clone');
  const of = (patch) => ({ status: null, repo: 'acme/widgets', branch: 'feature', base, remote: null,
    server: s.server.url, login: 'octo', ...patch });
  // The server answered 503, so this clone's review of its own commit waits to be sent.
  await updateRun(s.where, 'aaaaaaaaaaaa', of({ common: s.common, dir: s.top, state: 'pending_upload',
    why: 'upload_failed', sha: mine, out: s.folderOf(base, mine), at: '2026-11-11T10:00:00.000Z' }));
  // And the other clone's review of a commit git here holds no object of, which the server took: its page is the one
  // the team reads of this branch.
  await updateRun(s.where, 'bbbbbbbbbbbb', of({ common: join(other, '.git'), dir: other, state: 'done',
    why: 'uploaded', sha: theirs, out: join(other, 'page'), url: `${s.server.url}/r/acme/widgets/b/feature`,
    at: '2026-11-11T11:00:00.000Z' }));

  const pass = await runEntry(['push-run', '--repo', s.repo.work], { env: s.env, cwd: s.repo.work });
  assert.equal(pass.code, 0, pass.stderr);
  // Review 1's `clone` order gave this pass's own run the place of another clone's wherever neither of git's orders
  // could say a word — a run the server had already taken included: the pass POSTed its own older page as the
  // branch's review, so the page the team reads went backwards, both rows read `done` with a url each, and nothing
  // was written `replaced`. It could see that row was sent and overwrote it anyway.
  assert.deepEqual(s.server.uploads.map((u) => u.head), [], 'the pass sends nothing over the review on the server');
  const after = await s.runs();
  assert.deepEqual([after.find((r) => r.id === 'aaaaaaaaaaaa'), after.find((r) => r.id === 'bbbbbbbbbbbb')]
    .map((r) => [r.state, r.why]), [['pending_upload', 'upload_failed'], ['done', 'uploaded']],
  'and ends neither row');
});

test('D228 review (second look 2, review 2): where the remote gives no answer at all, the ref this clone\'s own '
  + 'push moved says which commit the branch holds', async (t) => {
  const s = await setup(t);
  await updateHooks(s.where, (repos) => [...repos, { common: s.common, server: s.server.url }]);
  const base = s.repo.git(['rev-parse', 'main']);
  const kept = await s.repo.commit('feature', MATH_V2);
  assert.equal((await s.visual(['main..feature'])).code, 0);
  const dropped = await s.repo.commit('feature', `${MATH_V2}// dropped\n`);
  assert.equal((await s.visual([`${base}..feature`])).code, 0);
  s.repo.git(['push', '-q', 'origin', 'feature']);
  // Review 4's own case: the commit is dropped (`git reset --hard`, or a rebase) and the branch force-pushed, so the
  // remote holds the first commit again while the dropped commit's review is the newer push's.
  s.repo.git(['reset', '--hard', kept]);
  s.repo.git(['push', '-q', '--force', 'origin', 'feature']);
  assert.equal(s.repo.git(['rev-parse', 'refs/remotes/origin/feature']), kept,
    'this clone\'s own force-push moved the ref it keeps of the branch');
  // And the remote cannot be reached when the pass runs, which is a state of its own and not "the remote has no such
  // branch": a pass sends what waits once the queue drains, up to half an hour after the push (`afterQueue`), by when
  // the wifi may be gone, the VPN down, or an ssh key's passphrase out of reach of a detached runner (`remoteGitEnv`
  // leaves no prompt). `remoteTip` gives no answer at all for it.
  const gone = join(s.repo.root, 'ssh-gone.sh');
  await writeFile(gone, '#!/bin/sh\nexit 1\n');
  await chmod(gone, 0o755);
  s.repo.git(['config', 'core.sshCommand', `'${gone}'`]);
  assert.notEqual(s.repo.run(['ls-remote', '--', 'origin', 'refs/heads/feature']).code, 0, 'git answers nothing');
  assert.equal(await pushedTip(s.common, [{ remote: 'origin' }], 'feature',
    { env: s.env, git: gitOut, fresh: true }), kept, 'so the ref this clone keeps answers for that remote');
  const other = join(s.repo.root, 'other clone');
  const of = (patch) => ({ status: null, repo: 'acme/widgets', branch: 'feature', base, remote: 'origin',
    server: s.server.url, login: 'octo', ...patch });
  await updateRun(s.where, 'aaaaaaaaaaaa', of({ common: s.common, dir: s.top, state: 'pending_upload',
    why: 'upload_failed', sha: dropped, out: s.folderOf(base, dropped), at: '2026-11-11T10:00:00.000Z' }));
  await updateRun(s.where, 'bbbbbbbbbbbb', of({ common: s.common, dir: s.top, state: 'pending_upload',
    why: 'upload_failed', sha: kept, out: s.folderOf(base, kept), at: '2026-11-11T11:00:00.000Z' }));
  // One row of another clone of the repository, which is all it takes for the head read to ask the remote itself
  // (`fresh`) — an ordinary earlier push there, long done.
  await updateRun(s.where, 'cccccccccccc', of({ common: join(other, '.git'), dir: other, state: 'done',
    why: 'uploaded', sha: base, out: join(other, 'page'), url: `${s.server.url}/r/acme/widgets/c/feature`,
    at: '2026-11-11T09:00:00.000Z' }));

  const pass = await runEntry(['push-run', '--repo', s.repo.work], { env: s.env, cwd: s.repo.work });
  assert.equal(pass.code, 0, pass.stderr);
  // No answer read as no branch left `head` null for a pair that is wholly this clone's own, where that ref is no
  // guess at all: the commits then read backwards after the force-push, the dropped commit's review was elected the
  // branch's newest and POSTed, and the only review of the commit the remote holds ended `replaced`, `newer_push`,
  // which `waitsToSend` is false for.
  assert.deepEqual(s.server.uploads.map((u) => u.head), [kept], 'the review of the commit the remote holds, sent');
  const after = await s.runs();
  assert.deepEqual([after.find((r) => r.id === 'bbbbbbbbbbbb'), after.find((r) => r.id === 'aaaaaaaaaaaa'),
    after.find((r) => r.id === 'cccccccccccc')].map((r) => [r.state, r.why]),
  [['done', 'uploaded'], ['replaced', 'newer_push'], ['done', 'uploaded']],
  'the dropped commit\'s review ends `replaced`, and the other clone\'s row is left as it is');
});

test('D228 review (second look 2, review 2): one remote name of a review that nothing can answer for leaves the '
  + 'commit the branch holds unread, where a name that answers "no such branch" does not', async (t) => {
  const s = await setup(t);
  const kept = await s.repo.commit('feature', MATH_V2);
  s.repo.git(['push', '-q', 'origin', 'feature']);
  // A second remote of the one repository, which the casing fold made one review here (second look 2) — an `https`
  // remote beside an `ssh` one is the everyday pair — and which neither the remote nor this computer can say a word
  // about: its address is not there, and with no refspec of it nothing here maps the branch either.
  s.repo.git(['remote', 'add', 'gh', join(s.repo.root, 'no such remote.git')]);
  s.repo.git(['config', '--unset', 'remote.gh.fetch']);
  const tip = (list) => pushedTip(s.common, list, 'feature', { env: s.env, git: gitOut });
  assert.equal(await tip([{ remote: 'origin' }]), kept, 'the branch on the remote the push went to');
  assert.equal(await tip([{ remote: 'origin' }, { remote: 'gh' }]), null,
    'and null for the whole review where one of its names cannot be read at all');
  // "The remote has no such branch" stays an answer and not a gap: with a refspec of that name there, this computer
  // says it knows no such branch of it, and the name that answered stands for the review.
  s.repo.git(['config', 'remote.gh.fetch', '+refs/heads/*:refs/remotes/gh/*']);
  assert.equal(s.repo.run(['rev-parse', '--verify', '--quiet', 'refs/remotes/gh/feature']).code, 1,
    'nothing of the branch was ever fetched through it');
  assert.equal(await tip([{ remote: 'origin' }, { remote: 'gh' }]), kept,
    'a name this computer knows no such branch of says nothing rather than null for all of them');
});

test('D228 review (second look 2, review 2): a push made with an address leaves the remote the other runs name to '
  + 'read the branch from, instead of turning the read off for the whole review', async (t) => {
  const s = await setup(t);
  await updateHooks(s.where, (repos) => [...repos, { common: s.common, server: s.server.url }]);
  const base = s.repo.git(['rev-parse', 'main']);
  const kept = await s.repo.commit('feature', MATH_V2);
  assert.equal((await s.visual(['main..feature'])).code, 0);
  const dropped = await s.repo.commit('feature', `${MATH_V2}// dropped\n`);
  assert.equal((await s.visual([`${base}..feature`])).code, 0);
  s.repo.git(['push', '-q', 'origin', 'feature']);
  // The commit dropped and the branch force-pushed with the repository's address pasted in rather than the remote's
  // name, which leaves `remote` null on that run (`ticketFields`): the remote's branch holds the first commit again,
  // and this clone's own cache is behind the branch. Before git 2.56 such a push moves no ref here; from 2.56 it moves
  // `origin/feature` too, when the address is, as here, the push URL of exactly one remote. A push from another clone
  // leaves the cache behind with any git, so the ref is put back where the older git leaves it.
  s.repo.git(['reset', '--hard', kept]);
  s.repo.git(['push', '-q', '--force', PUSH_REMOTE, 'feature']);
  s.repo.git(['update-ref', 'refs/remotes/origin/feature', dropped]);
  assert.equal(s.repo.git(['rev-parse', 'refs/remotes/origin/feature']), dropped, 'the cache this clone keeps');
  const of = (patch) => ({ status: null, common: s.common, dir: s.top, repo: 'acme/widgets', branch: 'feature', base,
    server: s.server.url, login: 'octo', ...patch });
  await updateRun(s.where, 'aaaaaaaaaaaa', of({ remote: 'origin', state: 'pending_upload', why: 'upload_failed',
    sha: dropped, out: s.folderOf(base, dropped), at: '2026-11-11T10:00:00.000Z' }));
  await updateRun(s.where, 'bbbbbbbbbbbb', of({ remote: null, state: 'pending_upload', why: 'upload_failed',
    sha: kept, out: s.folderOf(base, kept), at: '2026-11-11T11:00:00.000Z' }));
  assert.equal(await pushedTip(s.common, await s.runs(), 'feature', { env: s.env, git: gitOut }), kept,
    'the names that are there are read, and asked of the remote, since this clone\'s cache is behind the branch');

  const pass = await runEntry(['push-run', '--repo', s.repo.work], { env: s.env, cwd: s.repo.work });
  assert.equal(pass.code, 0, pass.stderr);
  // Refused for the one row that names none, the read was null for the whole review and the commits read backwards:
  // the dropped commit's review was elected the branch's newest and POSTed, and the only review of the commit the
  // remote holds ended `replaced`, `newer_push`, which nothing sends again — fix 1 of review 1 moved that poison
  // inside the clone instead of taking it out.
  assert.deepEqual(s.server.uploads.map((u) => u.head), [kept], 'the review of the commit the remote holds, sent');
  const after = await s.runs();
  assert.deepEqual([after.find((r) => r.id === 'bbbbbbbbbbbb'), after.find((r) => r.id === 'aaaaaaaaaaaa')]
    .map((r) => [r.state, r.why]), [['done', 'uploaded'], ['replaced', 'newer_push']],
  'and the dropped commit\'s review ends `replaced`');
});

test('D228 review (second look 2, review 2): a share says the page\'s link before it orders the reviews that wait '
  + 'against it, and bounds the remotes it asks', async (t) => {
  const s = await setup(t);
  const base = s.repo.git(['rev-parse', 'main']);
  const older = await s.repo.commit('feature', MATH_V2);
  assert.equal((await s.visual(['main..feature'])).code, 0);
  const head = await s.repo.commit('feature', `${MATH_V2}// and on\n`);
  assert.equal((await s.visual([`${base}..feature`])).code, 0);
  s.repo.git(['push', '-q', 'origin', 'feature']);
  // A second remote of the one repository, so the runs of this one review name two remotes and each is asked which
  // commit the branch holds (`pushedTip`), as an `https` remote beside an `ssh` one is asked.
  s.repo.git(['remote', 'add', 'gh', PUSH_REMOTE]);
  // The push of the earlier commit went out through it and the server did not take the upload, so that review waits
  // for this share's page to be ordered against.
  await updateRun(s.where, 'aaaaaaaaaaaa', { status: null, common: s.common, dir: s.top, repo: 'acme/widgets',
    branch: 'feature', sha: older, base, remote: 'gh', state: 'pending_upload', why: 'upload_failed',
    out: s.folderOf(base, older), server: s.server.url, login: 'octo', at: '2026-11-11T10:00:00.000Z' });
  // Every `ls-remote` of the share, with what it had said by then and the time it was given.
  const asked = [];
  const out = streams();
  const git = (dir, args, options = {}) => {
    if (args[0] === 'ls-remote') asked.push({ timeoutMs: options.timeoutMs, said: out.chunks.stdout });
    return gitOut(dir, args, options);
  };
  const code = await runShareCommand(['--branch', 'feature'], { env: s.env, cwd: s.repo.work, stdout: out.stdout,
    stderr: out.stderr, git });
  assert.equal(code, 0, out.chunks.stderr);
  assert.match(out.chunks.stdout, /\npage: /, 'the share says the page\'s link');
  const rows = await s.runs();
  assert.deepEqual([rows.find((r) => r.id === 'aaaaaaaaaaaa')].map((r) => [r.state, r.why]),
    [['replaced', 'newer_push']], 'and the read of the branch ran, so the earlier review ends `replaced`');
  assert.equal(asked.length > 0, true, 'the remotes of the review were asked for the branch\'s commit');
  for (const call of asked) {
    // Where that read came before the link, a share behind a proxy that blackholes the host sat 30 seconds a remote
    // name with the page already online and nothing said, and a Ctrl-C in that window lost the link from the terminal.
    assert.match(call.said, /\npage: /, 'each after the link was said');
    assert.equal(call.timeoutMs <= SHARE_ORDER_MS, true, `each bounded by the share's own budget: ${call.timeoutMs}`);
  }
});
