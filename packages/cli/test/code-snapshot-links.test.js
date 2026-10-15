// D87 review (FAIL, high): the code pass's reader decides outside-root, harness-home and credential-path on the REAL
// path of a file (every link followed, at any depth) as well as on the path as recorded. The reviewer's three probes,
// with throwaway folders and a temporary HOME (never the real ~/.claude): a linked folder that points outside the
// working directory, a linked folder that points into a harness home, and an innocently named link to `.env`.
//
// Synthetic sessions and files: no recording, no model, no network.
import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { constants } from 'node:fs';
import fsp, { mkdir, mkdtemp, realpath, rm, symlink, unlink, writeFile } from 'node:fs/promises';
import { syncBuiltinESMExports } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { Session } from '../../evidence/src/session.js';
import { readCodeSnapshot } from '../src/code-snapshot.js';
import { CODE_FILES, codeSession, codeJudge, contradictClaim, findEmptyInput, repoWith, sha256, shownFiles }
  from './code-pass-fixture.js';
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
/** A session that read each of `paths`, in order (typed reads; nothing else). */
const readsOf = (paths) => new Session({ sessionKey: 's', events: paths.map((path, at) => ({ id: `R${at}`,
  kind: 'invocation', tool: 'read', operation: 'other', paths: [{ path }], command: [], input: [], changes: [],
  sequence: at })) });
const states = (snapshot) => snapshot.files.map((f) => [f.path, f.state]);
const texts = (snapshot) => snapshot.files.map((f) => f.text ?? '').join('\n');

test('D87 links: a file reached through a linked folder outside the working directory is outside_root (probe 1)', async (t) => {
  const outside = await folder(t, 'outside');
  await writeFile(join(outside, 'secret.js'), `export const x = "${SECRET}";\n`);
  await mkdir(join(outside, 'deep', 'er'), { recursive: true });
  await writeFile(join(outside, 'deep', 'er', 'more.js'), `// ${SECRET}\n`);
  const root = await repoWith(t);
  await symlink(outside, join(root, 'linkdir'));
  // A link in the middle of a path, at any depth: src/vendor -> outside/deep.
  await symlink(join(outside, 'deep'), join(root, 'src', 'vendor'));
  const snapshot = await readCodeSnapshot(readsOf(['linkdir/secret.js', 'src/vendor/er/more.js', 'src/util.js']),
    { root, home: null, maxBytes: 100_000 });
  assert.deepEqual(states(snapshot), [['linkdir/secret.js', 'outside_root'], ['src/vendor/er/more.js', 'outside_root'],
    ['src/util.js', 'readable']]);
  assert.ok(!texts(snapshot).includes(SECRET));
});

test('D87 links: a linked folder into a harness home is harness_home, as the direct path is (probe 2, temporary HOME)', async (t) => {
  const home = await folder(t, 'home');
  await mkdir(join(home, '.claude'));
  await writeFile(join(home, '.claude', 'settings.json'), HARNESS);
  const root = await repoWith(t);
  await symlink(join(home, '.claude'), join(root, 'agentcfg'));
  const direct = join(home, '.claude', 'settings.json');
  const snapshot = await readCodeSnapshot(readsOf(['agentcfg/settings.json', direct]), { root, home, maxBytes: 100_000 });
  assert.deepEqual(states(snapshot), [['agentcfg/settings.json', 'harness_home'], [direct, 'harness_home']]);
  assert.ok(!texts(snapshot).includes('SYNTHETIC_HARNESS_SETTING'));
});

test('third review of the code step: a name under a set harness home is harness_home even when it cannot be resolved', async (t) => {
  // Claude Code's home set to a folder of the working directory, and a path under it that no resolution can place (a
  // link that leads to itself): by its name alone it is in the home, so it is never named — never `unreadable`.
  const root = await repoWith(t);
  await mkdir(join(root, 'agentcfg'));
  await symlink(join(root, 'agentcfg', 'loop'), join(root, 'agentcfg', 'loop'));
  const snapshot = await readCodeSnapshot(readsOf(['agentcfg/loop/history.jsonl', 'src/util.js']),
    { root, home: null, harness: [join(root, 'agentcfg')], maxBytes: 100_000 });
  assert.deepEqual(states(snapshot), [['agentcfg/loop/history.jsonl', 'harness_home'], ['src/util.js', 'readable']]);
});

test('D87 links: a harness home inside the working directory, reached by a link, is withheld by its real path', async (t) => {
  // The working directory is the home itself, named through a link (as /var is on macOS): only the real path of the
  // home places the linked folder in it.
  const base = await folder(t, 'base');
  const home = join(base, 'real-home');
  await mkdir(join(home, '.claude'), { recursive: true });
  await writeFile(join(home, '.claude', 'settings.json'), HARNESS);
  await writeFile(join(home, 'notes.js'), 'export const notes = 1;\n');
  await symlink(join(home, '.claude'), join(home, 'agentcfg'));
  await symlink(home, join(base, 'home-link'));
  const linkedHome = join(base, 'home-link');
  const snapshot = await readCodeSnapshot(readsOf(['agentcfg/settings.json', 'notes.js']),
    { root: linkedHome, home: linkedHome, maxBytes: 100_000 });
  assert.deepEqual(states(snapshot), [['agentcfg/settings.json', 'harness_home'], ['notes.js', 'readable']]);
});

test('D87 links: a harness home this computer names (Codex home, Claude Code configuration) is withheld by real path', async (t) => {
  const codexHome = await folder(t, 'codex-home');
  await writeFile(join(codexHome, 'config.toml'), 'model = "synthetic"\n');
  const root = await repoWith(t);
  await symlink(codexHome, join(root, 'tools'));
  const snapshot = await readCodeSnapshot(readsOf(['tools/config.toml', 'src/util.js']),
    { root, home: null, harness: [codexHome], maxBytes: 100_000 });
  assert.deepEqual(states(snapshot), [['tools/config.toml', 'harness_home'], ['src/util.js', 'readable']]);
});

test('D87 links: an innocently named link to a credential file is credential_path, never read (probe 3)', async (t) => {
  const root = await repoWith(t, { ...CODE_FILES, '.env': DOTENV });
  await symlink('.env', join(root, 'config.js'));
  await mkdir(join(root, 'keys'));
  await writeFile(join(root, 'keys', 'id_ed25519'), 'SYNTHETIC_PRIVATE_KEY\n');
  await symlink(join(root, 'keys'), join(root, 'settings'));
  const snapshot = await readCodeSnapshot(readsOf(['config.js', 'settings/id_ed25519', 'src/util.js']),
    { root, home: null, maxBytes: 100_000 });
  assert.deepEqual(states(snapshot), [['config.js', 'credential_path'], ['settings/id_ed25519', 'credential_path'],
    ['src/util.js', 'readable']]);
  assert.ok(!texts(snapshot).includes('SYNTHETIC_not_a_real_key'));
});

test('D87 links: a link that stays inside the working directory to an ordinary file is read', async (t) => {
  const root = await repoWith(t);
  await symlink(join(root, 'src'), join(root, 'lib'));
  await symlink('util.js', join(root, 'src', 'alias.js'));
  const snapshot = await readCodeSnapshot(readsOf(['lib/util.js', 'src/alias.js']), { root, home: null, maxBytes: 100_000 });
  assert.deepEqual(states(snapshot), [['lib/util.js', 'readable'], ['src/alias.js', 'readable']]);
  assert.equal(snapshot.files[0].text, CODE_FILES['src/util.js']);
});

test('D87 reader: a home-spelled path and a write the slicer scoped outside the repository are outside_root', async (t) => {
  // Each is there inside the working directory under a folder that spells it, so only the rule withholds it.
  const root = await repoWith(t, { ...CODE_FILES, '~/notes.js': 'export const n = 1;\n', 'scoped.js': 'export const s = 1;\n' });
  const session = new Session({ sessionKey: 's', events: [
    { id: 'R0', kind: 'invocation', tool: 'read', operation: 'other', paths: [{ path: '~/notes.js' }], command: [],
      input: [], changes: [], sequence: 0 },
    { id: 'W1', kind: 'invocation', tool: 'Write', operation: 'write', paths: [{ path: 'scoped.js' }], command: [],
      input: [], changes: [{ path: 'scoped.js', outsideRepository: true, before: [], after: [], diff: [] }], sequence: 1 },
  ] });
  const snapshot = await readCodeSnapshot(session, { root, home: null, maxBytes: 100_000 });
  assert.deepEqual(states(snapshot).sort(), [['scoped.js', 'outside_root'], ['~/notes.js', 'outside_root']]);
});

test('D87 reader: a FIFO is not a regular file: it is unreadable, and reading it never waits', { timeout: 10_000 },
  async (t) => {
    if (process.platform === 'win32') { t.skip('no FIFO on Windows'); return; }
    const root = await repoWith(t);
    try { execFileSync('mkfifo', [join(root, 'pipe.js')]); } catch { t.skip('mkfifo is not available'); return; }
    const snapshot = await readCodeSnapshot(readsOf(['pipe.js', 'src/util.js']), { root, home: null, maxBytes: 100_000 });
    assert.deepEqual(states(snapshot), [['pipe.js', 'unreadable'], ['src/util.js', 'readable']]);
  });

test('D87 links: through the CLI, files reached through linked folders never reach a request', async (t) => {
  const outside = await folder(t, 'outside-cli');
  await writeFile(join(outside, 'secret.js'), `export const SEPARATOR = ","; // ${SECRET}\n`);
  const home = await folder(t, 'home-cli');
  await mkdir(join(home, '.claude'));
  await writeFile(join(home, '.claude', 'settings.json'), HARNESS);
  const root = await repoWith(t, { ...CODE_FILES, '.env': DOTENV });
  await symlink(outside, join(root, 'linkdir'));
  await symlink(join(home, '.claude'), join(root, 'agentcfg'));
  await symlink('.env', join(root, 'config.js'));
  const session = codeSession({ reads: ['linkdir/secret.js', 'agentcfg/settings.json', 'config.js'] });
  const dir = await folder(t, 'run');
  const file = join(dir, 'recording.jsonl');
  await writeFile(file, '{}\n');
  const calls = [];
  const judge = codeJudge({ check: contradictClaim, pass: findEmptyInput });
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
  const asked = calls.filter((r) => /^(?:code-|challenge:code-)/.test(r.label));
  assert.ok(asked.some((r) => r.label === 'code-pass:behaviour'));
  for (const request of asked) {
    const bytes = JSON.stringify(request);
    for (const text of [SECRET, 'SYNTHETIC_HARNESS_SETTING', 'SYNTHETIC_not_a_real_key']) assert.ok(!bytes.includes(text),
      `${request.label}: ${text}`);
  }
  const pass = asked.find((r) => r.label === 'code-pass:behaviour').prompt;
  assert.match(pass, /^- linkdir\/secret\.js · not shown: outside the recorded working directory$/m);
  assert.match(pass, /^- config\.js · withheld: a credential-shaped path$/m);
  // The review of the code step: a file in a harness home is never named, by any name — counted only.
  for (const request of asked) assert.ok(!request.prompt.includes('agentcfg'), request.label);
  assert.match(pass, /^- and 1 more file outside the working directory or in a harness home: not shown, not named$/m);
});

// ---- D87 re-review (medium): a harness home's worktrees are the project, as the slicer says ----------------------
// The slicer withholds Claude Code's and Codex's home folders outside their `worktrees/` folders (slicer/src/before.js
// `inHarnessHome`; m36-withholding.test.js): a worktree there is the project under review. The reader's check of the
// homes this computer names is the same rule. Every home here is a temporary folder; the real ~/.claude is never used.

/** Write `files` (path -> text) under `root`, making folders as needed. */
async function writeTree(root, files) {
  for (const [path, text] of Object.entries(files)) {
    await mkdir(dirname(join(root, path)), { recursive: true });
    await writeFile(join(root, path), text);
  }
}
const SOURCES = { 'src/parse.js': CODE_FILES['src/parse.js'], 'src/util.js': CODE_FILES['src/util.js'] };

test('D87 worktrees: a working directory in a harness home\'s worktree is read, as the slicer exempts it', async (t) => {
  const home = await folder(t, 'wt-home');
  // A home this computer names by another name (CLAUDE_CONFIG_DIR, CODEX_HOME): the same rule.
  const named = { claude: join(home, 'agentcfg'), codex: join(home, 'cx') };
  const harness = [join(home, '.claude'), join(home, '.codex'), named.claude, named.codex];
  for (const root of [join(home, '.codex', 'worktrees', 'ab12', 'repo'), join(home, '.claude', 'worktrees', 'w1'),
    join(named.codex, 'worktrees', 'ab12', 'repo'), join(named.claude, 'worktrees', 'w1')]) {
    await writeTree(root, SOURCES);
    const snapshot = await readCodeSnapshot(readsOf(['src/parse.js', 'src/util.js']),
      { root, home, harness, maxBytes: 100_000 });
    assert.deepEqual(states(snapshot), [['src/parse.js', 'readable'], ['src/util.js', 'readable']], root);
    assert.equal(snapshot.files[1].text, CODE_FILES['src/util.js'], root);
  }
});

test('D87 worktrees: a file of a named harness home outside its worktrees is withheld, through links at any depth', async (t) => {
  // The working directory is the home, holding a Claude Code configuration folder and a Codex home under names the
  // path rule does not know (`agentcfg`, `cx`): only the named-home check withholds what is in them.
  const home = await folder(t, 'wt-named');
  const cfg = join(home, 'agentcfg'), cx = join(home, 'cx'), worktree = join(cx, 'worktrees', 'ab12', 'repo');
  await writeTree(home, { 'agentcfg/settings.json': HARNESS, 'agentcfg/projects/worktrees/a.js': HARNESS,
    'cx/auth.json': HARNESS, 'cx/worktrees-old/a.js': HARNESS });
  await writeTree(worktree, SOURCES);
  await symlink(cx, join(worktree, 'up')); // from inside a worktree back to the home
  await symlink(cfg, join(cfg, 'worktrees')); // a link NAMED worktrees, to the home itself
  await mkdir(join(home, 'proj', 'src', 'deep', 'er'), { recursive: true });
  await mkdir(join(home, 'proj', 'tools'));
  await symlink(cfg, join(home, 'proj', 'src', 'deep', 'er', 'cfg')); // a linked folder four deep
  await symlink(join(cx, 'auth.json'), join(home, 'proj', 'tools', 'auth.json')); // a linked file
  await symlink(worktree, join(home, 'proj', 'wt')); // a link INTO a worktree: the worktree's file
  const withheld = ['agentcfg/settings.json', 'agentcfg/projects/worktrees/a.js', 'agentcfg/worktrees/settings.json',
    'cx/auth.json', 'cx/worktrees-old/a.js', 'cx/worktrees/ab12/repo/up/auth.json', 'proj/src/deep/er/cfg/settings.json',
    'proj/tools/auth.json'];
  const shown = ['cx/worktrees/ab12/repo/src/util.js', 'proj/wt/src/util.js'];
  const snapshot = await readCodeSnapshot(readsOf([...withheld, ...shown]),
    { root: home, home, harness: [cfg, cx], maxBytes: 100_000 });
  assert.deepEqual(states(snapshot), [...withheld.map((path) => [path, 'harness_home']),
    ...shown.map((path) => [path, 'readable'])]);
  assert.ok(!texts(snapshot).includes('SYNTHETIC_HARNESS_SETTING'));
});

/** `sonah review --code-pass` over `session` at `root`, with `env` added to a temporary HOME's; the requests sent. */
async function codePassRun(t, { session, root, home, env = {} }) {
  const dir = await folder(t, 'run');
  const file = join(dir, 'recording.jsonl');
  await writeFile(file, '{}\n');
  const calls = [];
  const judge = codeJudge({ check: contradictClaim, pass: findEmptyInput });
  const code = await runSessionReviewCommand([file, '--concurrency', '1', '--state-dir', join(dir, 'state'),
    '--format', 'md', '--output', join(dir, 'story.md'), '--no-open', '--code-pass'], {
    stdout: { write: () => {} }, stderr: { write: () => {} }, cwd: root,
    env: { HOME: home, SONAH_HOME: join(dir, '.sonah'), SONAH_CLAUDE_PROJECTS: join(dir, 'claude-projects'), ...env },
    installSignals: false, loadReviews: async () => new Map(), openPage: async () => {},
    loadSession: async () => ({ session, hash: sha256('synthetic'), cwd: root }),
    createJudge: ({ onResult }) => async (request) => {
      calls.push(request);
      onResult({ ok: true, backend: 'claude-cli', attestation: 'attested', contextWindow: 1_000_000 });
      return judge(request);
    } });
  return { code, pass: calls.find((r) => r.label === 'code-pass:behaviour')?.prompt ?? null };
}

test('D87 worktrees: through the CLI, a session run in a Codex worktree under the home is checked in code', async (t) => {
  const home = await folder(t, 'wt-cli-home');
  const root = join(home, '.codex', 'worktrees', 'ab12', 'repo');
  await writeTree(root, CODE_FILES);
  const { code, pass } = await codePassRun(t, { session: codeSession(), root, home });
  assert.equal(code, 0);
  assert.ok(pass !== null, 'the code pass sent its request');
  assert.deepEqual(shownFiles(pass).map((f) => f.path), ['src/parse.js', 'src/util.js']);
  assert.match(pass, /^- \.env · withheld: a credential-shaped path$/m);
});

test('D87 worktrees: through the CLI, CLAUDE_CONFIG_DIR and CODEX_HOME are each a harness home, but for their worktrees',
  async (t) => {
    // Both inside the working directory, under names the path rule does not know: only the CLI's list withholds them.
    const home = await folder(t, 'named-cli-home');
    const root = await repoWith(t, { ...CODE_FILES, 'agentcfg/settings.json': HARNESS, 'cx/auth.json': HARNESS,
      'agentcfg/worktrees/w1/a.js': 'export const a = 1;\n', 'cx/worktrees/ab12/b.js': 'export const b = 2;\n' });
    const reads = ['agentcfg/settings.json', 'cx/auth.json', 'agentcfg/worktrees/w1/a.js', 'cx/worktrees/ab12/b.js'];
    const { code, pass } = await codePassRun(t, { session: codeSession({ reads }), root, home,
      env: { CLAUDE_CONFIG_DIR: join(root, 'agentcfg'), CODEX_HOME: join(root, 'cx') } });
    assert.equal(code, 0);
    assert.ok(!pass.includes('SYNTHETIC_HARNESS_SETTING'));
    // The review of the code step: a file in a harness home is never named, by any name — counted only. Its worktrees
    // are the project, shown and named.
    assert.ok(!pass.includes('agentcfg/settings.json') && !pass.includes('cx/auth.json'));
    assert.match(pass, /^- and 2 more files outside the working directory or in a harness home: not shown, not named$/m);
    assert.deepEqual(shownFiles(pass).map((f) => f.path),
      ['src/parse.js', 'src/util.js', 'agentcfg/worktrees/w1/a.js', 'cx/worktrees/ab12/b.js']);
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
  try { snapshot = await readCodeSnapshot(readsOf(['src/util.js', 'src/parse.js']), { root, home: null, maxBytes: 100_000 }); }
  finally { race.mock.restore(); syncBuiltinESMExports(); }
  assert.equal(swapped, true);
  assert.deepEqual(states(snapshot), [['src/util.js', 'unreadable'], ['src/parse.js', 'readable']]);
  assert.ok(!texts(snapshot).includes(SECRET));
});
