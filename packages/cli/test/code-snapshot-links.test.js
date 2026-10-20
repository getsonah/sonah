// D87 review (FAIL, high), kept under D90 (the agentic code step, code-snapshot/9): the code step decides where a file
// is on the REAL path (every link followed, at any depth) as well as on the path as recorded — structure, never privacy.
// D117 (the owner, 2026-10-18: "the changes that happened outside the worktree but is relevant to this session should
// also be reviewed, make this default"): a path of the change reached through a linked folder that leads outside the
// working directory is reviewed where it really lies when a git repository holds it, named as the session spelled it;
// the repository reader reads it only as a file of that place (`places`), never outside every place of the change. D117
// amended ("files outside any repository are listed, not reviewed"): one that leads into a folder of no repository is
// listed by that folder and counted, never read. A write into a harness home stays out (counted). D90: a harness home inside the repository, a credential-shaped path or
// a `.claude` folder is a path like any other — read. With throwaway folders and a temporary HOME (never the real
// ~/.claude).
//
// Synthetic sessions and files: no recording, no model, no network.
import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { constants } from 'node:fs';
import fsp, { mkdir, mkdtemp, realpath, rm, symlink, unlink, writeFile } from 'node:fs/promises';
import { syncBuiltinESMExports } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Session } from '../../evidence/src/session.js';
import { createRepositoryReader, readCodeSnapshot } from '../src/code-snapshot.js';
import { CODE_FILES, codeSession, codeJudge, repoWith, sha256 } from './code-pass-fixture.js';
import { runSessionReviewCommand } from '../src/session-review-command.js';

const SECRET = 'SYNTHETIC_OUTSIDE_TEXT_never_sent';
const HARNESS = '{"SYNTHETIC_HARNESS_SETTING": true}';
const DOTENV = 'API_KEY=SYNTHETIC_not_a_real_key\n';

/** A fresh folder, removed after the test. */
async function folder(t, name) {
  const dir = await mkdtemp(join(tmpdir(), `sonah-code-links-${name}-`));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return dir;
}
/** A session that wrote each of `paths`, in order (typed writes whose text the record does not hold, so a file is the
 *  session's whatever it holds now). */
const writesOf = (paths) => new Session({ sessionKey: 's', events: paths.map((path, at) => ({ id: `W${at}`,
  kind: 'invocation', tool: 'Write', operation: 'write', paths: [{ path }], command: [], input: [],
  changes: [{ path, before: [], after: [], diff: [] }], sequence: at })) });
const states = (snapshot) => snapshot.files.map((f) => [f.path, f.state]);
const texts = (snapshot) => snapshot.files.map((f) => f.text ?? '').join('\n');

test('D87 links, D117 amended: a path reached through a linked folder outside the working directory into a folder of no repository is listed by that folder, never reviewed (probe 1)', async (t) => {
  const outside = await folder(t, 'outside');
  await writeFile(join(outside, 'secret.js'), `export const x = "${SECRET}";\n`);
  await mkdir(join(outside, 'deep', 'er'), { recursive: true });
  await writeFile(join(outside, 'deep', 'er', 'more.js'), `// ${SECRET}\n`);
  const root = await repoWith(t);
  await symlink(outside, join(root, 'linkdir'));
  // A link in the middle of a path, at any depth: src/vendor -> outside/deep.
  await symlink(join(outside, 'deep'), join(root, 'src', 'vendor'));
  const snapshot = await readCodeSnapshot(writesOf(['linkdir/secret.js', 'src/vendor/er/more.js', 'src/util.js']),
    { root, maxBytes: 100_000 });
  assert.deepEqual(states(snapshot), [['linkdir/secret.js', 'outside_root'], ['src/vendor/er/more.js', 'outside_root'],
    ['src/util.js', 'readable']]);
  assert.ok(!texts(snapshot).includes(SECRET));
  // D117 amended (the owner: "files outside any repository are listed, not reviewed"): the folder they really lie in,
  // which no git repository holds, is listed with its count (one folder holds both: the deeper one is the outer one's);
  // no place, no folder of the agents'.
  const real = await realpath(outside);
  assert.deepEqual(snapshot.files.map((f) => f.place ?? null), [null, null, null]);
  assert.equal(snapshot.base.places, undefined);
  assert.deepEqual(snapshot.base.folders, [{ at: real, written: 2 }]);
  assert.equal(snapshot.folders, undefined);
  // The repository reader: nothing outside the repository's top folder, by a link or an absolute name.
  const repo = createRepositoryReader({ root, maxBytes: 100_000, places: snapshot.base.places, files: snapshot.files });
  for (const path of ['linkdir/secret.js', 'src/vendor/er/more.js', join(outside, 'secret.js')])
    assert.equal(repo.read(path), null, path);
  assert.equal(repo.read('src/util.js').text, CODE_FILES['src/util.js']);
});

test('D90: a harness home folder, a credential-shaped path and a link to either inside the repository are read like any other file', async (t) => {
  const home = await folder(t, 'home');
  await mkdir(join(home, '.claude'));
  await writeFile(join(home, '.claude', 'settings.json'), HARNESS);
  const root = await repoWith(t, { ...CODE_FILES, '.env': DOTENV, '.claude/settings.json': HARNESS,
    'keys/id_ed25519': 'SYNTHETIC_PRIVATE_KEY\n' });
  await symlink('.env', join(root, 'config.js'));
  await symlink(join(root, 'keys'), join(root, 'settings'));
  // A linked folder into the (temporary) HOME's .claude, outside the repository: structure, not privacy, keeps it out.
  await symlink(join(home, '.claude'), join(root, 'agentcfg'));
  const paths = ['.env', 'config.js', 'settings/id_ed25519', '.claude/settings.json', 'agentcfg/settings.json'];
  // D117: the CLI names the harness homes; a write that lies in one outside the working directory stays out (counted).
  const snapshot = await readCodeSnapshot(writesOf(paths), { root, maxBytes: 100_000,
    harnessHomes: [join(home, '.claude')] });
  assert.deepEqual(states(snapshot), [['.env', 'readable'], ['config.js', 'readable'], ['settings/id_ed25519', 'readable'],
    ['.claude/settings.json', 'readable'], ['agentcfg/settings.json', 'outside_root']]);
  assert.equal(snapshot.files[4].home, true);
  assert.equal(snapshot.files[1].text, DOTENV);
  const repo = createRepositoryReader({ root, maxBytes: 100_000 });
  assert.equal(repo.read('config.js').text, DOTENV);
  assert.equal(repo.read('.claude/settings.json').text, HARNESS);
  assert.equal(repo.read('settings/id_ed25519').text, 'SYNTHETIC_PRIVATE_KEY\n');
  assert.equal(repo.read('agentcfg/settings.json'), null, 'outside the repository');
});

test('D87 links: a link that stays inside the working directory to an ordinary file is read', async (t) => {
  const root = await repoWith(t);
  await symlink(join(root, 'src'), join(root, 'lib'));
  await symlink('util.js', join(root, 'src', 'alias.js'));
  const snapshot = await readCodeSnapshot(writesOf(['lib/util.js', 'src/alias.js']), { root, maxBytes: 100_000 });
  assert.deepEqual(states(snapshot), [['lib/util.js', 'readable'], ['src/alias.js', 'readable']]);
  assert.equal(snapshot.files[0].text, CODE_FILES['src/util.js']);
  // The reader names a file by where it really is, relative to the working directory.
  assert.equal(createRepositoryReader({ root, maxBytes: 100_000 }).read('lib/util.js').path, 'src/util.js');
});

test('D87 reader: a home-spelled path is outside_root; a write the slicer scoped outside the repository that lies in the '
  + 'working directory is a file of the change (D117, amending D109)', async (t) => {
  // Each is there inside the working directory under a folder that spells it, so only the rule keeps it out.
  const root = await repoWith(t, { ...CODE_FILES, '~/notes.js': 'export const n = 1;\n', 'scoped.js': 'export const s = 1;\n' });
  const session = new Session({ sessionKey: 's', events: [
    { id: 'W0', kind: 'invocation', tool: 'Write', operation: 'write', paths: [{ path: '~/notes.js' }], command: [],
      input: [], changes: [{ path: '~/notes.js', before: [], after: [], diff: [] }], sequence: 0 },
    { id: 'W1', kind: 'invocation', tool: 'Write', operation: 'write', paths: [{ path: 'scoped.js' }], command: [],
      input: [], changes: [{ path: 'scoped.js', outsideRepository: true, before: [], after: [], diff: [] }], sequence: 1 },
  ] });
  const snapshot = await readCodeSnapshot(session, { root, maxBytes: 100_000 });
  // D109: by where it lies — under the working directory, in no other repository — never "outside the repository".
  // D117: there it is reviewed like any write in the working directory.
  assert.deepEqual(states(snapshot).sort(), [['scoped.js', 'readable'], ['~/notes.js', 'outside_root']]);
  assert.equal(snapshot.files.find((f) => f.path === 'scoped.js').diff, 'base_unknown');
});

test('D87 reader: a FIFO is not a regular file: it is unreadable, and reading it never waits', { timeout: 10_000 },
  async (t) => {
    if (process.platform === 'win32') { t.skip('no FIFO on Windows'); return; }
    const root = await repoWith(t);
    try { execFileSync('mkfifo', [join(root, 'pipe.js')]); } catch { t.skip('mkfifo is not available'); return; }
    const snapshot = await readCodeSnapshot(writesOf(['pipe.js', 'src/util.js']), { root, maxBytes: 100_000 });
    assert.deepEqual(states(snapshot), [['pipe.js', 'unreadable'], ['src/util.js', 'readable']]);
    assert.equal(createRepositoryReader({ root, maxBytes: 100_000 }).read('pipe.js'), null);
  });

test('D87 links, D117 amended: through the CLI, a file reached through a linked folder into a folder of no repository never reaches a request, and its folder is not read', async (t) => {
  const outside = await folder(t, 'outside-cli');
  await writeFile(join(outside, 'secret.js'), `export const SEPARATOR = ","; // ${SECRET}\n`);
  const home = await folder(t, 'home-cli');
  const root = await repoWith(t, { ...CODE_FILES, '.env': DOTENV });
  await symlink(outside, join(root, 'linkdir'));
  const base = codeSession();
  // The session also wrote the linked file and the .env: the first lies outside the repository, in a folder of the
  // change (D117), the second in the repository (D90: shown like any other).
  const writes = ['linkdir/secret.js', '.env'].map((path, at) => ({ id: `WL${at}`, kind: 'invocation', tool: 'Write',
    operation: 'write', paths: [{ path }], command: [], input: [], callKey: `WL${at}`,
    changes: [{ path, before: [], after: [], diff: [] }], sequence: base.events.length + at, turn: 'T1' }));
  const session = new Session({ sessionKey: 's-links-cli', adapter: 'claude', blobs: base.blobs,
    events: [...base.events, ...writes] });
  const dir = await folder(t, 'run');
  const file = join(dir, 'recording.jsonl');
  await writeFile(file, '{}\n');
  const calls = [];
  const judge = codeJudge();
  const code = await runSessionReviewCommand([file, '--concurrency', '1', '--state-dir', join(dir, 'state'),
    '--format', 'md', '--output', join(dir, 'story.md'), '--no-open', '--code-pass'], {
    stdout: { write: () => {} }, stderr: { write: () => {} }, cwd: root,
    env: { HOME: home, SONAH_HOME: join(dir, '.sonah'), CODEX_HOME: join(dir, 'codex'),
      SONAH_CLAUDE_PROJECTS: join(dir, 'claude-projects') },
    installSignals: false, loadReviews: async () => new Map(), openPage: async () => {},
    loadSession: async () => ({ session, hash: sha256('synthetic'), cwd: root }),
    createJudge: ({ onResult }) => async (request) => {
      calls.push(request);
      onResult({ ok: true, backend: 'claude-cli', attestation: 'attested', contextWindow: 1_000_000 });
      return judge(request);
    } });
  assert.equal(code, 0);
  const asked = calls.filter((r) => /^code-/.test(r.label));
  const review = asked.find((r) => r.label === 'code-review:agent');
  assert.ok(review);
  assert.match(review.prompt, /^- \.env → lines \d+-\d+ · modified · /m);
  // D117 amended: the write outside the repository, in a folder of no repository, is listed by that folder and counted:
  // no part of the change block, never in a request, and no agent reads its folder.
  const real = await realpath(outside);
  assert.ok(!/^- linkdir\//m.test(review.prompt), 'a write outside every repository is no part of the change block');
  for (const request of asked) assert.ok(!JSON.stringify(request).includes(SECRET), request.label);
  for (const request of asked) assert.ok(!request.agent.addDirs.includes(real), request.label);
});

// ---- D87 re-review (low): the last part of the real path is opened without following a link ----------------------

test('D87 reader: a link put at the file\'s real path after it was resolved is never followed', async (t) => {
  if (constants.O_NOFOLLOW === undefined) { t.skip('no O_NOFOLLOW on this platform'); return; }
  const outside = await folder(t, 'race-outside');
  await writeFile(join(outside, 'secret.js'), `// ${SECRET}\n`);
  const root = await repoWith(t);
  const target = await realpath(join(root, 'src', 'util.js'));
  // Another process's move, made at the worst moment: between the reader's realpath of the file and its open.
  const resolve = fsp.realpath;
  let swapped = false;
  const race = mock.method(fsp, 'realpath', async (path, ...rest) => {
    const real = await resolve(path, ...rest);
    if (real === target && !swapped) {
      swapped = true;
      await unlink(real);
      await symlink(join(outside, 'secret.js'), real);
    }
    return real;
  });
  syncBuiltinESMExports();
  let snapshot;
  try { snapshot = await readCodeSnapshot(writesOf(['src/util.js', 'src/parse.js']), { root, maxBytes: 100_000 }); }
  finally { race.mock.restore(); syncBuiltinESMExports(); }
  assert.equal(swapped, true);
  assert.deepEqual(states(snapshot), [['src/util.js', 'unreadable'], ['src/parse.js', 'readable']]);
  assert.ok(!texts(snapshot).includes(SECRET));
});
