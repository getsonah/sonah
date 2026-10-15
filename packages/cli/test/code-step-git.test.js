// The code step's diff, read with git: the session's start commit
// placed by structure (the commit a recording names, else the HEAD reflog entry in effect at the recording's first
// timestamp, else the newest first-parent commit made by then), every path that differs from it, git's own patch of
// each, an unrecorded change marked, the withholding rules before any line is read, nothing written to the repository;
// and the reuse dry run: a dry run with --code-pass and --state-dir that reuses the stored session answers with no
// call and writes nothing.
//
// Throwaway repositories in temporary folders, synthetic sessions, a deterministic fake reviewer: no recording, no
// model, no network. Every commit date is fixed, so the reflog's times are too.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readdir, readFile, rm, stat, symlink, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readCodeSnapshot, recordingStart, runGit, startCommit, snapshotTexts } from '../src/code-snapshot.js';
import { runSessionReviewCommand } from '../src/session-review-command.js';
import { claudeProjectFolder } from '../src/claude-home.js';
import { CODE_FILES, CODE_TEXT, codeSession, buildCodeSession, codeJudge, contradictClaim, findEmptyInput, sha256,
  parseFinding } from './code-pass-fixture.js';

const BASE_PARSE = CODE_FILES['src/parse.js'].replace('split(",")', 'split(";")');
const START = '2030-01-01T00:00:00.000Z';

/** A fresh repository: the base commit (dated before the session's start), then `after` — the files as the session
 *  left them, uncommitted unless `commitAfter` (dated after the start). */
async function repository(t, { base = { 'src/parse.js': BASE_PARSE, 'src/util.js': CODE_FILES['src/util.js'],
  'gen.js': 'export const generated = 1;\n', 'README.md': '# readme\n' }, after = { 'src/parse.js': CODE_FILES['src/parse.js'],
  'gen.js': 'export const generated = 2;\n' }, commitAfter = false, at = null } = {}) {
  // `at`: a folder to make the repository in, inside a temporary folder its caller removes.
  const root = at ?? await mkdtemp(join(tmpdir(), 'sonah-code-step-git-'));
  if (at) await mkdir(at, { recursive: true });
  else t.after(() => rm(root, { recursive: true, force: true }));
  const git = (args, date = '2029-01-01T00:00:00Z') => execFileSync('git', args, { cwd: root, stdio: 'pipe',
    env: { ...Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('GIT_'))),
      GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date, GIT_AUTHOR_NAME: 'synthetic', GIT_AUTHOR_EMAIL: 's@example.invalid',
      GIT_COMMITTER_NAME: 'synthetic', GIT_COMMITTER_EMAIL: 's@example.invalid' } }).toString();
  git(['init', '-q', '-b', 'main']);
  const write = async (files) => {
    for (const [path, text] of Object.entries(files)) {
      await mkdir(join(root, path, '..'), { recursive: true });
      await writeFile(join(root, path), text);
    }
  };
  await write(base);
  git(['add', '-A']);
  git(['commit', '-q', '-m', 'base']);
  const baseCommit = git(['rev-parse', 'HEAD']).trim();
  await write(after);
  if (commitAfter) { git(['add', '-A']); git(['commit', '-q', '-m', 'agent work'], '2031-01-01T00:00:00Z'); }
  return { root, baseCommit, git };
}
async function recordingAt(t, rows) {
  const dir = await mkdtemp(join(tmpdir(), 'sonah-code-step-rec-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const file = join(dir, 'recording.jsonl');
  await writeFile(file, `${rows.map((row) => JSON.stringify(row)).join('\n')}\n`);
  return file;
}

test('code step git: the recording\'s opening timestamp and a Codex rollout\'s commit are read by structure', async (t) => {
  const claude = await recordingAt(t, [{ type: 'queue-operation', operation: 'enqueue', timestamp: START, content: 'x' },
    { type: 'user', timestamp: '2030-01-01T00:00:09.000Z' }]);
  assert.deepEqual(await recordingStart(claude), { at: START, commit: null });
  const codex = await recordingAt(t, [{ timestamp: START, type: 'session_meta', payload: { git: { commit_hash: 'a'.repeat(40) } } }]);
  assert.deepEqual(await recordingStart(codex), { at: START, commit: 'a'.repeat(40) });
  assert.deepEqual(await recordingStart(null), { at: null, commit: null });
  assert.deepEqual(await recordingStart(join(tmpdir(), 'sonah-no-such-recording.jsonl')), { at: null, commit: null });
});

test('code step git: the start commit is the one HEAD held when the session began — reflog, then commit date', async (t) => {
  const { root, baseCommit, git } = await repository(t, { commitAfter: true });
  assert.deepEqual(await startCommit({ top: root, start: { at: START } }), { commit: baseCommit, how: 'reflog' });
  // The agent's own commit, made after the start, is not the start.
  assert.notEqual(git(['rev-parse', 'HEAD']).trim(), baseCommit);
  // A recorded commit git has wins; one it does not have is passed over.
  assert.deepEqual(await startCommit({ top: root, start: { at: START, commit: baseCommit } }),
    { commit: baseCommit, how: 'recorded' });
  assert.deepEqual(await startCommit({ top: root, start: { at: START, commit: 'f'.repeat(40) } }),
    { commit: baseCommit, how: 'reflog' });
  // No reflog: the newest first-parent commit made by then.
  await rm(join(root, '.git', 'logs'), { recursive: true, force: true });
  assert.deepEqual(await startCommit({ top: root, start: { at: START } }), { commit: baseCommit, how: 'commit_date' });
  assert.equal(await startCommit({ top: root, start: { at: '2000-01-01T00:00:00Z' } }), null, 'nothing was made by then');
  assert.equal(await startCommit({ top: root, start: { at: null } }), null);
});

test('code step git: every differing path, its base and git\'s patch, checked; unrecorded changes marked; nothing written', async (t) => {
  const { root, git } = await repository(t, { after: { 'src/parse.js': CODE_FILES['src/parse.js'],
    'gen.js': 'export const generated = 2;\n', '.env': 'API_KEY=SYNTHETIC_not_a_real_key\n' } });
  // The session wrote parse.js and read util.js and .env; gen.js changed with no recorded edit (a generator).
  const session = codeSession();
  const recording = await recordingAt(t, [{ timestamp: START }]);
  const index = await stat(join(root, '.git', 'index'));
  const snapshot = await readCodeSnapshot(session, { root, home: null, maxBytes: 1_000_000, recording });
  assert.deepEqual(snapshot.base.kind, 'git');
  assert.equal(snapshot.base.how, 'reflog');
  // An untracked file no recorded edit wrote and that did not change after the session began is not part of the diff.
  assert.deepEqual(snapshot.files.map((f) => [f.path, f.state, f.type ?? null, f.diff ?? null]), [
    ['src/parse.js', 'readable', 'modified', 'recorded'], ['gen.js', 'readable', 'modified', 'unrecorded_change'],
    ['src/util.js', 'readable', null, null], ['.env', 'credential_path', null, null]]);
  const parse = snapshot.files[0];
  assert.equal(parse.base.text, BASE_PARSE);
  assert.ok(parse.hunks[0].rows.some((r) => r.type === '-' && r.text === '  const parts = input.split(";");'));
  assert.ok(parse.hunks[0].rows.some((r) => r.type === '+' && r.text === '  const parts = input.split(",");'));
  // Changed after the session began, it is: an added path, withheld, its lines never read, before or after.
  const later = new Date('2031-01-01T00:00:00Z');
  await utimes(join(root, '.env'), later, later);
  const fresh = await readCodeSnapshot(session, { root, home: null, maxBytes: 1_000_000, recording });
  const env = fresh.files.find((f) => f.path === '.env');
  assert.deepEqual([env.state, env.type, env.diff, env.text, env.hunks, env.base], ['credential_path', 'added', 'withheld',
    undefined, [], null]);
  // git wrote nothing: the index is as it was.
  assert.equal((await stat(join(root, '.git', 'index'))).mtimeMs, index.mtimeMs);
  assert.equal(git(['status', '--porcelain']).includes('.env'), true, 'the untracked file stays untracked');
});

test('code step git: through the CLI, the lens requests carry git\'s hunks and the run is the same with the same tree', async (t) => {
  const { root } = await repository(t);
  const recording = await recordingAt(t, [{ timestamp: START }]);
  const dir = await mkdtemp(join(tmpdir(), 'sonah-code-step-run-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const once = async (state, argv = []) => {
    const calls = [];
    let out = '';
    const judge = codeJudge({ check: contradictClaim, pass: findEmptyInput });
    const code = await runSessionReviewCommand([recording, '--concurrency', '1', '--state-dir', state, '--format', 'md',
      '--output', join(dir, `story-${Math.random().toString(16).slice(2)}.md`), '--no-open', '--code-pass', ...argv], {
      stdout: { write: (text) => { out += text; } }, stderr: { write: () => {} }, cwd: root,
      env: { HOME: join(dir, 'home'), SONAH_HOME: join(dir, '.sonah'), CODEX_HOME: join(dir, 'codex'),
        SONAH_CLAUDE_PROJECTS: join(dir, 'claude') },
      installSignals: false, loadReviews: async () => new Map(), openPage: async () => {},
      loadSession: async () => ({ session: codeSession(), hash: sha256('synthetic'), cwd: root }),
      createJudge: ({ onResult }) => async (request) => {
        calls.push(request);
        onResult({ ok: true, backend: 'claude-cli', attestation: 'attested', contextWindow: 1_000_000 });
        return judge(request);
      } });
    return { code, calls, out };
  };
  const state = join(dir, 'state');
  const first = await once(state);
  assert.equal(first.code, 0);
  const lens = first.calls.find((r) => r.label === 'code-pass:behaviour');
  assert.match(lens.prompt, /^- gen\.js → lines \d+-\d+ · modified · not written by a recorded edit$/m);
  assert.match(lens.prompt, /^\| {4}2 \| {6}\| - \| {3}const parts = input\.split\(";"\);$/m);
  assert.match(lens.prompt, /^@@ -1,4 \+1,4 @@/m);
  const report = JSON.parse(await readFile(join(state, 'review', 'report.private.json'), 'utf8'));
  assert.equal(report.codePass.base.kind, 'git');
  assert.equal(report.codePass.findings.length, 1);
  assert.deepEqual(report.codePass.files.find((f) => f.path === 'gen.js').diff, 'unrecorded_change');
  // The reuse dry run: the stored session answers would all be reused; no call, nothing written.
  const before = await listing(state);
  const dry = await once(state, ['--dry-run']);
  assert.equal(dry.code, 0);
  assert.deepEqual(dry.calls, []);
  const reused = /^Stored session answers: (\d+) of (\d+) requests answered from the store \(no call\)\.$/m.exec(dry.out);
  assert.ok(reused && Number(reused[1]) > 0 && reused[1] === reused[2], dry.out);
  assert.match(dry.out, /^Code step: it would first send 5 requests \(code-check \d+ KB, code-pass:behaviour \d+ KB, code-pass:tests \d+ KB, code-pass:contracts \d+ KB, code-pass:ask \d+ KB\), then three checking passes for each answer and finding they give\.$/m);
  assert.match(dry.out, /The diff starts at the session's start commit [0-9a-f]{12} \(reflog\): 2 paths differ, 1 not written by a recorded edit\./);
  assert.deepEqual(await listing(state), before, 'the dry run wrote nothing, and touched no stored answer');
  // A state with no stored answers: they are counted as asked live, still with no call.
  const empty = await once(join(dir, 'empty-state'), ['--dry-run']);
  assert.deepEqual(empty.calls, []);
  assert.match(empty.out, /^Stored session answers: 0 of (\d+) requests answered from the store \(no call\); at least \1 would be asked live\.$/m);
});

/** Every file under `dir` with its size and modification time: what a dry run must leave as it was. */
async function listing(dir) {
  const out = [];
  const walk = async (at) => {
    for (const entry of await readdir(at, { withFileTypes: true }).catch(() => [])) {
      const path = join(at, entry.name);
      if (entry.isDirectory()) await walk(path);
      else { const info = await stat(path); out.push([path.slice(dir.length), info.size, info.mtimeMs]); }
    }
  };
  await walk(dir);
  return out.sort();
}

// ---- the review of the code step (FAIL, 2026-10-14): the reviewer's probes, with real git -----------------------------

/** One `sonah review --code-pass` run over `session` with its files under `root` (the recording's working directory),
 *  the state under `state`; `env` adds to the run's environment. Every request is kept. */
async function reviewIn(t, { root, recording, state, session = codeSession(), judge, argv = [], env = {}, format = 'md' }) {
  const dir = await mkdtemp(join(tmpdir(), 'sonah-code-step-review-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const calls = [];
  let out = '';
  const output = join(dir, `story.${format === 'html' ? 'html' : 'md'}`);
  const code = await runSessionReviewCommand([recording, '--concurrency', '1', '--state-dir', state, '--format', format,
    '--output', output, '--no-open', '--code-pass', ...argv], {
    stdout: { write: (text) => { out += text; } }, stderr: { write: () => {} }, cwd: root,
    env: { HOME: join(dir, 'home'), SONAH_HOME: join(dir, '.sonah'), CODEX_HOME: join(dir, 'codex'),
      SONAH_CLAUDE_PROJECTS: join(dir, 'claude'), ...env },
    installSignals: false, loadReviews: async () => new Map(), openPage: async () => {},
    loadSession: async () => ({ session, hash: sha256('synthetic'), cwd: root }),
    createJudge: ({ onResult }) => async (request) => {
      calls.push(request);
      onResult({ ok: true, backend: 'claude-cli', attestation: 'attested', contextWindow: 1_000_000 });
      return judge(request);
    } });
  const written = await readFile(output, 'utf8').catch(() => null);
  const report = JSON.parse(await readFile(join(state, 'review', 'report.private.json'), 'utf8').catch(() => 'null'));
  return { code, calls, out, written, report };
}
/** The part of a request it showed (a receipt repair appends the reviewer's own failed answers after it). */
const shownOf = (request) => request.prompt.split('\n\n## Receipt repair — one attempt only\n')[0];

test('review of the code step (high, the probe): a staged file under a -diff attribute is binary, never shown, never published', async (t) => {
  const SQL = 'DELETE FROM users WHERE id = $1;';
  const { root, git } = await repository(t, { after: { 'src/parse.js': CODE_FILES['src/parse.js'],
    'db/migrate.sql': `${SQL}\n`, 'db/untracked.sql': 'SELECT SYNTHETIC_UNTRACKED;\n', 'db/seed.sql': 'SELECT 2;\n' },
  base: { 'src/parse.js': BASE_PARSE, 'src/util.js': CODE_FILES['src/util.js'], '.gitattributes': '*.sql -diff\n',
    'db/seed.sql': 'SELECT 1;\n' } });
  git(['add', 'db/migrate.sql']);
  const recording = await recordingAt(t, [{ timestamp: START }]);
  const later = new Date('2031-01-01T00:00:00Z');
  await utimes(join(root, 'db', 'untracked.sql'), later, later);
  // Read with git: the staged file, the modified one and the untracked one are each binary; no text of them is kept.
  const snapshot = await readCodeSnapshot(codeSession(), { root, home: null, maxBytes: 1_000_000, recording });
  for (const path of ['db/migrate.sql', 'db/seed.sql', 'db/untracked.sql']) {
    const file = snapshot.files.find((f) => f.path === path);
    assert.deepEqual([file.state, file.diff, file.text, file.hunks], ['binary', 'withheld', undefined, []], path);
  }
  assert.ok(!snapshotTexts(snapshot).some((text) => text.includes(SQL)));
  // The probe's finding, quoting the staged file: never grounded, never checked, never published; coverage partial.
  const finding = parseFinding({ anchor: { path: 'db/migrate.sql', side: 'new', startLine: 1, endLine: 1 },
    trace: [{ step: 'It deletes a user.', source: 'file', path: 'db/migrate.sql', side: 'new', startLine: 1, endLine: 1,
      quote: SQL }] });
  const judge = codeJudge({ check: contradictClaim, pass: (prompt, files, lens) => (lens === 'behaviour' ? [finding] : []) });
  const { code, calls, report, written, out } = await reviewIn(t, { root, recording, judge,
    state: join(await mkdtemp(join(tmpdir(), 'sonah-code-step-bin-')), 'state') });
  // The code step did not cover the whole change: the run says so, and is incomplete (never "complete").
  assert.equal(code, 1);
  assert.match(out, /code pass did not read every file it showed/);
  assert.deepEqual(report.codePass.findings, []);
  assert.ok(report.codePass.rejected.some((r) => r.reason === 'evidence_grounding_failed' && r.cause === 'file_not_shown'));
  assert.equal(calls.filter((r) => r.label.startsWith('challenge:code-finding')).length, 0);
  for (const request of calls) {
    assert.ok(!shownOf(request).includes(SQL), request.label);
    assert.ok(!shownOf(request).includes('SYNTHETIC_UNTRACKED'), request.label);
  }
  assert.deepEqual(report.codePass.files.filter((f) => f.state === 'binary').map((f) => f.path).sort(),
    ['db/migrate.sql', 'db/seed.sql', 'db/untracked.sql']);
  assert.equal(report.codePass.coverage, 'partial');
  assert.ok(!written.includes(SQL));
});

test('review of the code step (low, privacy, the probe): from a folder of a repository, no path outside it is named', async (t) => {
  const { root: top } = await repository(t, {
    base: { 'app/src/parse.js': BASE_PARSE, 'app/src/util.js': CODE_FILES['src/util.js'],
      'other-team/secret-project-name/plan.md': 'plan 1\n', 'agentcfg/settings.json': '{"a":1}\n',
      'app/cfg/settings.json': '{"b":1}\n' },
    after: { 'app/src/parse.js': CODE_FILES['src/parse.js'], 'other-team/secret-project-name/plan.md': 'plan 2\n',
      'agentcfg/settings.json': '{"a":2}\n', 'app/cfg/settings.json': '{"b":2}\n', 'loose.txt': 'new\n' } });
  const root = join(top, 'app');
  const recording = await recordingAt(t, [{ timestamp: START }]);
  const later = new Date('2031-01-01T00:00:00Z');
  await utimes(join(top, 'loose.txt'), later, later);
  // git's lists stop at the working directory: the two tracked paths changed outside it are counted, never listed.
  const snapshot = await readCodeSnapshot(codeSession(), { root, home: null, harness: [join(root, 'cfg')],
    maxBytes: 1_000_000, recording });
  assert.equal(snapshot.base.outside, 2);
  assert.deepEqual(snapshot.files.map((f) => [f.path, f.state]), [['src/parse.js', 'readable'],
    ['cfg/settings.json', 'harness_home'], ['src/util.js', 'readable'], ['.env', 'credential_path']]);
  const state = join(await mkdtemp(join(tmpdir(), 'sonah-code-step-sub-')), 'state');
  const run = await reviewIn(t, { root, recording, state, env: { CLAUDE_CONFIG_DIR: join(root, 'cfg') },
    judge: codeJudge({ check: contradictClaim, pass: findEmptyInput }) });
  // A changed path in the harness home under it was withheld, so the code step is partial and the run incomplete.
  assert.equal(run.code, 1);
  assert.equal(run.report.codePass.coverage, 'partial');
  assert.equal(run.report.codePass.findings.length, 1);
  const code = run.calls.filter((r) => /^(code-|challenge:code-)/.test(r.label));
  assert.ok(code.length > 5);
  for (const request of code)
    for (const name of ['secret-project-name', 'other-team', 'agentcfg', 'loose.txt', 'cfg/settings.json', top])
      assert.ok(!request.prompt.includes(name), `${request.label}: ${name}`);
  const lens = code.find((r) => r.label === 'code-pass:behaviour').prompt;
  assert.match(lens, /^- and 1 more differing path outside the working directory or in a harness home: not named, no hunk shown$/m);
  assert.match(lens, /^- and 2 more paths differ from the start commit outside the working directory: not reviewed, not named$/m);
  assert.equal(run.report.codePass.base.outside, 2);
  assert.match(run.written, /2 paths outside the working directory also differ from where the session started: not reviewed, and not named/);
  // The dry run says the count, and names nothing outside.
  const dry = await reviewIn(t, { root, recording, state, argv: ['--dry-run'], env: { CLAUDE_CONFIG_DIR: join(root, 'cfg') },
    judge: codeJudge({}) });
  assert.match(dry.out, /: 2 paths differ; 2 more outside the working directory, counted and not named\./);
  assert.ok(!dry.out.includes('secret-project-name'));
});

test('second review of the code step (low, privacy, the probe): with HOME the repository, a credential-shaped harness file is never named', async (t) => {
  // A dotfiles repository: the working directory is the user's home, so its .claude and .codex are the harness homes.
  const { root } = await repository(t, {
    base: { 'src/parse.js': BASE_PARSE, 'src/util.js': CODE_FILES['src/util.js'], '.claude/settings.json': '{"a":1}\n',
      '.claude/secrets.json': '{"token":"one"}\n', '.codex/config.toml': 'model = "one"\n',
      '.claude/credentials.json': '{"token":"old"}\n' },
    after: { 'src/parse.js': CODE_FILES['src/parse.js'], '.claude/settings.json': '{"a":2}\n',
      '.claude/secrets.json': '{"token":"two"}\n', '.codex/config.toml': 'model = "two"\n' } });
  // A credential-shaped harness file deleted since the start commit: no real path to resolve, its name decides.
  await rm(join(root, '.claude', 'credentials.json'));
  const recording = await recordingAt(t, [{ timestamp: START }]);
  // The session also read two links whose real files are in the harness home: one named plainly, one with a
  // credential-shaped name of its own. The release review: with the home folder as the repository only the paths the
  // session recorded are read, so it read the harness files too (a path it did not record is never named at all).
  await symlink(join(root, '.claude', 'secrets.json'), join(root, 'linked.json'));
  await symlink(join(root, '.claude', 'settings.json'), join(root, 'secrets.yaml'));
  const session = codeSession({ reads: ['linked.json', 'secrets.yaml', '.claude/settings.json', '.claude/secrets.json',
    '.codex/config.toml', '.claude/credentials.json'] });
  const snapshot = await readCodeSnapshot(session, { root, home: root,
    harness: [join(root, '.claude'), join(root, '.codex')], maxBytes: 1_000_000, recording });
  // In a harness home before any other rule: a credential-shaped file there is harness_home, never credential_path, by
  // its own name or by where a link really leads.
  const states = Object.fromEntries(snapshot.files.map((f) => [f.path, f.state]));
  assert.equal(states['.claude/secrets.json'], 'harness_home');
  assert.equal(states['.claude/credentials.json'], 'harness_home');
  assert.equal(states['linked.json'], 'harness_home');
  assert.equal(states['secrets.yaml'], 'harness_home');
  assert.equal(states['.claude/settings.json'], 'harness_home');
  assert.equal(states['.codex/config.toml'], 'harness_home');
  // A credential-shaped file outside a harness home is still named by its state, its content never read.
  assert.equal(states['.env'], 'credential_path');
  const state = join(await mkdtemp(join(tmpdir(), 'sonah-code-step-home-')), 'state');
  const run = await reviewIn(t, { root, recording, state, session, env: { HOME: root },
    judge: codeJudge({ check: contradictClaim, pass: findEmptyInput }) });
  const code = run.calls.filter((r) => /^(code-|challenge:code-)/.test(r.label));
  assert.ok(code.length > 5);
  for (const request of code)
    for (const name of ['secrets.json', '.claude', '.codex', 'settings.json', 'config.toml', 'linked.json',
      'credentials.json', 'secrets.yaml'])
      assert.ok(!request.prompt.includes(name), `${request.label}: ${name}`);
  const lens = code.find((r) => r.label === 'code-pass:behaviour').prompt;
  assert.match(lens, /^- and 4 more differing paths outside the working directory or in a harness home: not named, no hunk shown$/m);
  assert.match(lens, /^- \.env · withheld: a credential-shaped path$/m);
  assert.deepEqual(run.report.codePass.files.filter((f) => f.state === 'harness_home').map((f) => f.path).sort(),
    ['.claude/credentials.json', '.claude/secrets.json', '.claude/settings.json', '.codex/config.toml', 'linked.json',
      'secrets.yaml']);
  // Withheld changed paths under the working directory: the code step is partial and the run incomplete.
  assert.equal(run.report.codePass.coverage, 'partial');
  assert.equal(run.code, 1);
});

test('third review of the code step (medium, probes G1 and G2): a file deleted from a set or linked harness home is never named or sent', async (t) => {
  // The reviewer's probes, with real git and a temporary HOME outside the repository. G1: Claude Code's home is set
  // (CLAUDE_CONFIG_DIR) to a folder of the repository. G2: the home's ~/.claude is a link to a folder of the
  // repository, as in a dotfiles repository. In each, tracked files of that home were deleted since the start commit.
  // G3: as G2, with Claude Code's home set elsewhere, and every file of the linked folder deleted, so the default home
  // is a link that leads nowhere now: it is still a harness home, placed where it leads.
  const LINES = ['RR2_TRANSCRIPT_LINE', 'RR2_CRED_LINE', 'RR2_HISTORY_LINE'];
  const DELETED = ['projects/-Users-x-RR2SECRETPROJ/sess.jsonl', '.credentials.json', 'history.jsonl'];
  for (const [probe, folder] of [['G1', 'agentcfg'], ['G2', 'claude'], ['G3', 'claude']]) {
    const { root } = await repository(t, {
      base: { 'src/parse.js': BASE_PARSE, 'src/util.js': CODE_FILES['src/util.js'],
        [`${folder}/${DELETED[0]}`]: `{"line":"${LINES[0]}"}\n`,
        [`${folder}/${DELETED[1]}`]: `{"claudeAiOauth":{"accessToken":"${LINES[1]}"}}\n`,
        [`${folder}/${DELETED[2]}`]: `{"display":"${LINES[2]}"}\n`, [`${folder}/settings.json`]: '{"a":1}\n' },
      after: { 'src/parse.js': CODE_FILES['src/parse.js'] } });
    for (const path of [...DELETED, ...(probe === 'G3' ? ['settings.json'] : [])]) await rm(join(root, folder, path));
    if (probe === 'G3') await rm(join(root, folder), { recursive: true });
    const home = await mkdtemp(join(tmpdir(), `sonah-code-step-home-${probe}-`));
    t.after(() => rm(home, { recursive: true, force: true }));
    const env = probe === 'G1' ? { HOME: home, CLAUDE_CONFIG_DIR: join(root, folder) }
      : probe === 'G3' ? { HOME: home, CLAUDE_CONFIG_DIR: join(home, 'cfg') } : { HOME: home };
    if (probe !== 'G1') await symlink(join(root, folder), join(home, '.claude'));
    const recording = await recordingAt(t, [{ timestamp: START }]);
    // Read as the CLI reads it: each deleted file of the home is harness_home, never deleted, and no line of it, at
    // the start commit or now, is read.
    const harness = [env.CLAUDE_CONFIG_DIR ?? join(home, '.claude'), join(home, '.codex')];
    const snapshot = await readCodeSnapshot(codeSession(), { root, home, harness, maxBytes: 1_000_000, recording });
    const states = Object.fromEntries(snapshot.files.map((f) => [f.path, f.state]));
    for (const path of DELETED) assert.equal(states[`${folder}/${path}`], 'harness_home', `${probe} ${path}`);
    for (const file of snapshot.files.filter((f) => f.state === 'harness_home'))
      assert.deepEqual([file.text, file.hunks, file.base], [undefined, [], null], `${probe} ${file.path}`);
    for (const text of snapshotTexts(snapshot)) for (const line of LINES) assert.ok(!text.includes(line), `${probe} ${line}`);
    // Through the CLI: no request of the code step names a file of the home or holds a line of it.
    const state = join(await mkdtemp(join(tmpdir(), `sonah-code-step-${probe}-`)), 'state');
    t.after(() => rm(join(state, '..'), { recursive: true, force: true }));
    const run = await reviewIn(t, { root, recording, state, env, judge: codeJudge({ check: contradictClaim,
      pass: findEmptyInput }) });
    const code = run.calls.filter((r) => /^(code-|challenge:code-)/.test(r.label));
    assert.ok(code.length > 5, probe);
    for (const request of code)
      for (const name of [`${folder}/`, 'RR2SECRETPROJ', '.credentials.json', 'history.jsonl', 'sess.jsonl', ...LINES])
        assert.ok(!request.prompt.includes(name), `${probe} ${request.label}: ${name}`);
    for (const path of DELETED)
      assert.equal(run.report.codePass.files.find((f) => f.path === `${folder}/${path}`)?.state, 'harness_home', probe);
    assert.ok(!run.written.includes('RR2'), probe);
    // Withheld changed paths under the working directory: the code step is partial and the run incomplete.
    assert.equal(run.report.codePass.coverage, 'partial', probe);
    assert.equal(run.code, 1, probe);
  }
});

test('second review of the code step (low, the probe): a recorded edit to a sibling folder of the repository keeps coverage partial', async (t) => {
  const SIBLING = 'export const SYNTHSIBLING = 2;\n';
  const { root: top } = await repository(t, {
    base: { 'app/src/parse.js': BASE_PARSE, 'app/src/util.js': CODE_FILES['src/util.js'], 'lib/SYNTHSIBLING.js': 'x\n' },
    after: { 'app/src/parse.js': CODE_FILES['src/parse.js'], 'lib/SYNTHSIBLING.js': SIBLING } });
  const root = join(top, 'app');
  const recording = await recordingAt(t, [{ timestamp: START }]);
  // The session wrote parse.js under the working directory and, by a recorded edit, a file of a sibling folder.
  const T1 = { turn: 'T1' };
  const session = buildCodeSession('s-sibling', { ...CODE_TEXT, sibling: SIBLING }, [
    { id: 'I1', kind: 'instruction', blob: 'ask', ...T1 },
    { id: 'W1', kind: 'invocation', write: 'src/parse.js', blob: 'body', ...T1 },
    { id: 'W1-r', kind: 'observation', invocation: 'W1', blob: 'wrote', ...T1 },
    { id: 'W2', kind: 'invocation', write: join(top, 'lib', 'SYNTHSIBLING.js'), blob: 'sibling', ...T1 },
    { id: 'W2-r', kind: 'observation', invocation: 'W2', blob: 'wrote', ...T1 },
    { id: 'C1', kind: 'commentary', blob: 'claim', ...T1 }]);
  const state = join(await mkdtemp(join(tmpdir(), 'sonah-code-step-sibling-')), 'state');
  const run = await reviewIn(t, { root, recording, state, session,
    judge: codeJudge({ check: contradictClaim, pass: findEmptyInput }) });
  // Everything under the working directory was shown; the sibling edit was not: partial, and the run incomplete.
  assert.equal(run.report.codePass.findings.length, 1);
  assert.deepEqual(run.report.codePass.files.filter((f) => f.state === 'outside_root').map((f) => f.path),
    [join(top, 'lib', 'SYNTHSIBLING.js')]);
  assert.equal(run.report.codePass.coverage, 'partial');
  assert.equal(run.code, 1);
  // Never named in a request.
  for (const request of run.calls.filter((r) => /^(code-|challenge:code-)/.test(r.label)))
    assert.ok(!request.prompt.includes('SYNTHSIBLING'), request.label);
});

test('review of the code step (M14): a secret only in the start commit\'s text is masked wherever the reviewer restates it', async (t) => {
  const SECRET = 'Qm7Lw2Xp9Rk4Tz8Vb3Ny';
  const baseUtil = ['export const SEPARATOR = ",";', 'export const settings = {', `  password: "${SECRET}",`, '};', ''].join('\n');
  const { root } = await repository(t, { base: { 'src/parse.js': BASE_PARSE, 'src/util.js': baseUtil },
    after: { 'src/parse.js': CODE_FILES['src/parse.js'], 'src/util.js': 'export const SEPARATOR = ",";\n' } });
  const recording = await recordingAt(t, [{ timestamp: START }]);
  const snapshot = await readCodeSnapshot(codeSession(), { root, home: null, maxBytes: 1_000_000, recording });
  assert.ok(snapshotTexts(snapshot).includes(baseUtil), 'the start commit\'s text is scanned with the files now');
  // A finding on the removed line, restating the value in the reviewer's own words.
  const finding = { kind: 'bug', title: `The password ${SECRET} was removed`, explanation: `It held ${SECRET}.`,
    input: `login("${SECRET}")`, trace: [{ step: `The old code set ${SECRET}.`, source: 'base', path: 'src/util.js',
      side: 'old', startLine: 3, endLine: 3, quote: `password: "${SECRET}",` }],
    anchor: { path: 'src/util.js', side: 'old', startLine: 3, endLine: 3 }, leadsFrom: [] };
  for (const format of ['md', 'html']) {
    const state = join(await mkdtemp(join(tmpdir(), 'sonah-code-step-secret-')), 'state');
    t.after(() => rm(join(state, '..'), { recursive: true, force: true }));
    const run = await reviewIn(t, { root, recording, state, format, judge: codeJudge({ check: contradictClaim,
      pass: (prompt, files, lens) => (lens === 'behaviour' ? [finding] : []) }) });
    assert.equal(run.code, 0, format);
    assert.equal(run.report.codePass.findings.length, 1, format);
    for (let at = 0; at + 8 <= SECRET.length; at++) assert.ok(!run.written.includes(SECRET.slice(at, at + 8)), format);
  }
});

test('fourth review of the code step (medium, probe H1): with HOME the repository, Claude Code\'s ~/.claude.json and its backups are never named or sent', async (t) => {
  // The reviewer's probe, with real git and a temporary HOME that is the repository: Claude Code's own state file lies
  // outside ~/.claude, beside it. It is tracked and changed; a backup of it is new and untracked; an older backup was
  // deleted since the start commit; and the session read a link to it under another name.
  const LINES = ['RR4_OAUTH_EMAIL_synthetic@example.invalid', 'RR4_PROMPT_HISTORY_LINE', 'RR4_BACKUP_LINE', 'RR4_OLD_BACKUP'];
  const { root } = await repository(t, {
    base: { 'src/parse.js': BASE_PARSE, 'src/util.js': CODE_FILES['src/util.js'],
      '.claude.json': `{"oauthAccount":{"emailAddress":"${LINES[0]}"}}\n`,
      '.claude.json.backup.1700000000000': `{"history":["${LINES[3]}"]}\n` },
    after: { 'src/parse.js': CODE_FILES['src/parse.js'],
      '.claude.json': `{"oauthAccount":{"emailAddress":"${LINES[0]}"},"projects":{"history":["${LINES[1]}"]}}\n`,
      '.claude.json.backup': `{"history":["${LINES[2]}"]}\n` } });
  await rm(join(root, '.claude.json.backup.1700000000000'));
  const later = new Date('2031-01-01T00:00:00Z');
  await utimes(join(root, '.claude.json.backup'), later, later);
  await symlink(join(root, '.claude.json'), join(root, 'state-copy.json'));
  const recording = await recordingAt(t, [{ timestamp: START }]);
  // The release review: with the home folder as the repository only the paths the session recorded are read, so the
  // session also read the file and its backups (a path it did not record is never named at all).
  const session = codeSession({ reads: ['state-copy.json', '.claude.json', '.claude.json.backup',
    '.claude.json.backup.1700000000000'] });
  const NAMES = ['.claude.json', '.claude.json.backup', '.claude.json.backup.1700000000000', 'state-copy.json'];
  const snapshot = await readCodeSnapshot(session, { root, home: root,
    harness: [join(root, '.claude'), join(root, '.codex')], maxBytes: 1_000_000, recording });
  const states = Object.fromEntries(snapshot.files.map((f) => [f.path, f.state]));
  for (const name of NAMES) assert.equal(states[name], 'harness_home', name);
  for (const file of snapshot.files.filter((f) => f.state === 'harness_home'))
    assert.deepEqual([file.text, file.hunks ?? [], file.base ?? null], [undefined, [], null], file.path);
  for (const text of snapshotTexts(snapshot)) for (const line of LINES) assert.ok(!text.includes(line), line);
  // Through the CLI, as the reviewer ran it: no request names a harness file or holds a line of one; partial, exit 1.
  const state = join(await mkdtemp(join(tmpdir(), 'sonah-code-step-h1-')), 'state');
  t.after(() => rm(join(state, '..'), { recursive: true, force: true }));
  const run = await reviewIn(t, { root, recording, state, session, env: { HOME: root },
    judge: codeJudge({ check: contradictClaim, pass: findEmptyInput }) });
  const code = run.calls.filter((r) => /^(code-|challenge:code-)/.test(r.label));
  assert.ok(code.length > 5);
  for (const request of code)
    for (const text of ['.claude.json', 'state-copy.json', ...LINES])
      assert.ok(!request.prompt.includes(text), `${request.label}: ${text}`);
  for (const name of NAMES)
    assert.equal(run.report.codePass.files.find((f) => f.path === name)?.state, 'harness_home', name);
  assert.ok(!LINES.some((line) => run.written.includes(line)));
  assert.equal(run.report.codePass.coverage, 'partial');
  assert.equal(run.code, 1);
});

test('fourth review of the code step (low, probe L1): a tracked link into ~/.claude, deleted or retargeted since the start commit, never names its target', async (t) => {
  // The reviewer's probe: HOME is outside the repository; a link the repository tracked at the start commit led into
  // ~/.claude/projects. A link's text at the start commit is its target, which git's patch shows as a removed line.
  for (const probe of ['deleted', 'retargeted']) {
    const home = await mkdtemp(join(tmpdir(), `sonah-code-step-home-L1-${probe}-`));
    t.after(() => rm(home, { recursive: true, force: true }));
    const target = join(home, '.claude', 'projects', '-Users-x-RR4PROJ', 'RR4NAME.jsonl');
    await mkdir(join(target, '..'), { recursive: true });
    await writeFile(target, '{"line":"RR4_TRANSCRIPT"}\n');
    const { root, git } = await repository(t, { after: { 'src/parse.js': CODE_FILES['src/parse.js'] } });
    await symlink(target, join(root, 'transcript.jsonl'));
    git(['add', 'transcript.jsonl']);
    git(['commit', '-q', '-m', 'link'], '2029-06-01T00:00:00Z');
    await rm(join(root, 'transcript.jsonl'));
    if (probe === 'retargeted') await symlink(join(root, 'src', 'util.js'), join(root, 'transcript.jsonl'));
    const recording = await recordingAt(t, [{ timestamp: START }]);
    const harness = [join(home, '.claude'), join(home, '.codex')];
    const snapshot = await readCodeSnapshot(codeSession(), { root, home, harness, maxBytes: 1_000_000, recording });
    const link = snapshot.files.find((f) => f.path === 'transcript.jsonl');
    assert.deepEqual([link?.state, link?.text, link?.hunks, link?.base], ['harness_home', undefined, [], null], probe);
    for (const text of snapshotTexts(snapshot)) assert.ok(!text.includes('RR4'), probe);
    const state = join(await mkdtemp(join(tmpdir(), `sonah-code-step-L1-${probe}-`)), 'state');
    t.after(() => rm(join(state, '..'), { recursive: true, force: true }));
    const run = await reviewIn(t, { root, recording, state, env: { HOME: home },
      judge: codeJudge({ check: contradictClaim, pass: findEmptyInput }) });
    const code = run.calls.filter((r) => /^(code-|challenge:code-)/.test(r.label));
    assert.ok(code.length > 5, probe);
    for (const request of code)
      for (const text of ['RR4', '.claude', 'transcript.jsonl', home])
        assert.ok(!request.prompt.includes(text), `${probe} ${request.label}: ${text}`);
    assert.equal(run.report.codePass.files.find((f) => f.path === 'transcript.jsonl')?.state, 'harness_home', probe);
    assert.equal(run.report.codePass.coverage, 'partial', probe);
    assert.equal(run.code, 1, probe);
  }
});

// ---- the release review (2026-10-14): with the home folder as the repository, only what the session recorded --------

test('release review (medium): with HOME the repository, only the paths the session recorded changing or reading are read; the rest counted, never named or sent', async (t) => {
  // The reviewer's probe, with real git and a temporary HOME that is the repository. Tracked dotfiles changed since the
  // start commit, and untracked files (Sonah's own stores, another harness's settings and chats, a shell history) made
  // after the session began: none was written or read by the session, so none may be named, read or sent. The session
  // wrote parse.js and a new untracked file, and read util.js and an untracked file made after it began.
  const SECRETS = { '.zsh_history': 'RR5_SHELL_HISTORY', '.config/gh/hosts.yml': 'RR5_GH_OAUTH_TOKEN',
    '.git-credentials': 'RR5_GIT_CREDENTIAL', '.docker/config.json': 'RR5_DOCKER_AUTH' };
  const UNTRACKED = { '.sonah/session-reviews/abc/answers/one.json': 'RR5_STORED_ANSWER',
    '.sonah/session-reviews/abc/review/report.private.json': 'RR5_PRIVATE_REPORT', '.sonah/outcomes/one.json': 'RR5_OUTCOME',
    '.cursor/mcp.json': 'RR5_CURSOR_MCP', '.cursor/chats/other-project.json': 'RR5_OTHER_CHAT',
    '.gemini/settings.json': 'RR5_GEMINI', 'Documents/notes.txt': 'RR5_DOCUMENT' };
  const { root } = await repository(t, {
    base: { 'src/parse.js': BASE_PARSE, 'src/util.js': CODE_FILES['src/util.js'],
      ...Object.fromEntries(Object.keys(SECRETS).map((path) => [path, 'old\n'])) },
    after: { 'src/parse.js': CODE_FILES['src/parse.js'], 'src/new.js': 'export const added = 1;\n',
      'scratch/read-me.txt': 'read by the session\n',
      ...Object.fromEntries(Object.entries(SECRETS).map(([path, line]) => [path, `${line}\n`])),
      ...Object.fromEntries(Object.entries(UNTRACKED).map(([path, line]) => [path, `${line}\n`])) } });
  const later = new Date('2031-01-01T00:00:00Z');
  for (const path of ['src/new.js', 'scratch/read-me.txt', ...Object.keys(UNTRACKED)])
    await utimes(join(root, path), later, later);
  const recording = await recordingAt(t, [{ timestamp: START }]);
  const T1 = { turn: 'T1' };
  const blobs = { ...CODE_TEXT, added: 'export const added = 1;\n', scratch: 'scratch/read-me.txt' };
  const session = buildCodeSession('s-home', blobs, [
    { id: 'I1', kind: 'instruction', blob: 'ask', ...T1 },
    { id: 'W1', kind: 'invocation', write: 'src/parse.js', blob: 'body', ...T1 },
    { id: 'W1-r', kind: 'observation', invocation: 'W1', blob: 'wrote', ...T1 },
    { id: 'W2', kind: 'invocation', write: join(root, 'src', 'new.js'), blob: 'added', ...T1 },
    { id: 'W2-r', kind: 'observation', invocation: 'W2', blob: 'wrote', ...T1 },
    { id: 'R1', kind: 'invocation', read: 'src/util.js', blob: 'readUtil', ...T1 },
    { id: 'R1-r', kind: 'observation', invocation: 'R1', blob: 'readOut', ...T1 },
    { id: 'R2', kind: 'invocation', read: 'scratch/read-me.txt', blob: 'scratch', ...T1 },
    { id: 'C1', kind: 'commentary', blob: 'claim', ...T1 },
    { id: 'C2', kind: 'commentary', blob: 'final', phase: 'final', ...T1 }]);
  // git is asked about untracked files only by the recorded paths, never over the whole home folder.
  const asked = [];
  const git = (args, options) => { asked.push(args); return runGit(args, options); };
  const NAMES = [...Object.keys(SECRETS), ...Object.keys(UNTRACKED)];
  const LINES = [...Object.values(SECRETS), ...Object.values(UNTRACKED)];
  const snapshot = await readCodeSnapshot(session, { root, home: root, harness: [join(root, '.claude'),
    join(root, '.codex')], maxBytes: 1_000_000, recording, git });
  assert.deepEqual(snapshot.files.map((f) => [f.path, f.state, f.type ?? null]).sort(), [
    ['scratch/read-me.txt', 'readable', 'added'], ['src/new.js', 'readable', 'added'],
    ['src/parse.js', 'readable', 'modified'], ['src/util.js', 'readable', null]]);
  assert.deepEqual([snapshot.base.homeRepository, snapshot.base.unrecorded], [true, Object.keys(SECRETS).length]);
  for (const text of snapshotTexts(snapshot)) for (const line of LINES) assert.ok(!text.includes(line), line);
  const untracked = asked.filter((args) => args.includes('ls-files'));
  assert.ok(untracked.length >= 1);
  for (const args of untracked) {
    const specs = args.slice(args.indexOf('--') + 1);
    assert.ok(specs.length > 0 && specs.every((spec) => spec.startsWith(':(top,literal)')), args.join(' '));
    assert.deepEqual(specs.map((spec) => spec.slice(':(top,literal)'.length)).sort(),
      ['scratch/read-me.txt', 'src/new.js', 'src/parse.js', 'src/util.js']);
  }
  // HOME held by the repository (its top folder is HOME's parent), with the working directory under HOME: the same.
  const home = join(root, 'Documents');
  const nested = await readCodeSnapshot(session, { root, home, maxBytes: 1_000_000, recording });
  assert.deepEqual(nested.files.map((f) => f.path).sort(), ['scratch/read-me.txt', 'src/new.js', 'src/parse.js',
    'src/util.js']);
  assert.equal(nested.base.homeRepository, true);
  // HOME elsewhere: the repository is a project as before, its fresh untracked files and changed paths all read.
  const elsewhere = await mkdtemp(join(tmpdir(), 'sonah-code-step-home-else-'));
  t.after(() => rm(elsewhere, { recursive: true, force: true }));
  const project = await readCodeSnapshot(session, { root, home: elsewhere, maxBytes: 1_000_000, recording });
  assert.equal(project.base.homeRepository, undefined);
  for (const path of ['.zsh_history', '.cursor/mcp.json', 'Documents/notes.txt'])
    assert.ok(project.files.some((f) => f.path === path), path);
  // Through the CLI, as the reviewer ran it (HOME the repository, the step on by default): no request names a path the
  // session did not record or holds a line of one; the page counts them and says why.
  for (const format of ['md', 'html']) {
    const state = join(await mkdtemp(join(tmpdir(), 'sonah-code-step-home-run-')), 'state');
    t.after(() => rm(join(state, '..'), { recursive: true, force: true }));
    const run = await reviewIn(t, { root, recording, state, session, format, env: { HOME: root },
      judge: codeJudge({ check: contradictClaim, pass: findEmptyInput }) });
    const code = run.calls.filter((r) => /^(code-|challenge:code-)/.test(r.label));
    assert.ok(code.length > 5, format);
    for (const request of code)
      for (const text of [...NAMES, ...LINES, '.sonah', '.cursor', '.gemini', 'Documents'])
        assert.ok(!request.prompt.includes(text), `${format} ${request.label}: ${text}`);
    assert.deepEqual(run.report.codePass.base.homeRepository, true);
    assert.equal(run.report.codePass.base.unrecorded, Object.keys(SECRETS).length);
    assert.deepEqual(run.report.codePass.files.map((f) => f.path).sort(), ['scratch/read-me.txt', 'src/new.js',
      'src/parse.js', 'src/util.js']);
    for (const text of [...NAMES, ...LINES]) assert.ok(!run.written.includes(text), `${format}: ${text}`);
    assert.ok(run.written.includes('The repository is your home folder, so only the files the session changed or read '
      + 'were read; 4 other paths that differ from where the session started were not read, named or sent, and '
      + 'untracked files it did not change or read were not looked for'), format);
  }
  // The dry run says so too.
  const dry = await reviewIn(t, { root, recording, state: join(root, '..', 'no-state'), session, argv: ['--dry-run'],
    env: { HOME: root }, judge: codeJudge({ check: contradictClaim, pass: findEmptyInput }) });
  assert.match(dry.out, / The repository is your home folder, so only the files the session changed or read are read; 4 other paths differ, counted and not named\./);
});

test('release review (low): the harness home that wrote the recording is one, by where the recording lies, with no variable set now', async (t) => {
  // The reviewer's probe: Claude Code's home was a second folder (CLAUDE_CONFIG_DIR=~/.claude-2) when the session ran,
  // and the variable is unset when Sonah runs. The recording lies at <that home>/projects/<project>/<session>.jsonl, so
  // that folder is a harness home: no file of it is named or sent, by any name. Two layouts: HOME the repository with
  // the folder ~/.claude-2 (the session read files there), and a project that holds the folder it ran Claude Code from
  // (`agentcfg`, as the third review's G1, here with the variable unset), whose changed files no session recorded.
  const LINES = ['RR6_OAUTH_ACCOUNT', 'RR6_SETTINGS_LINE', 'RR6_OTHER_TRANSCRIPT'];
  for (const [probe, folder] of [['home', '.claude-2'], ['project', 'agentcfg']]) {
    const { root } = await repository(t, {
      base: { 'src/parse.js': BASE_PARSE, 'src/util.js': CODE_FILES['src/util.js'],
        [`${folder}/.claude.json`]: '{"a":1}\n', [`${folder}/settings.json`]: '{"b":1}\n' },
      after: { 'src/parse.js': CODE_FILES['src/parse.js'],
        [`${folder}/.claude.json`]: `{"oauthAccount":"${LINES[0]}"}\n`, [`${folder}/settings.json`]: `{"b":"${LINES[1]}"}\n`,
        [`${folder}/projects/-other-project/other.jsonl`]: `{"line":"${LINES[2]}"}\n` } });
    const later = new Date('2031-01-01T00:00:00Z');
    await utimes(join(root, folder, 'projects', '-other-project', 'other.jsonl'), later, later);
    await symlink(join(root, folder, 'settings.json'), join(root, 'cfg-link.json'));
    // Claude Code's own layout: the project's folder is its name for the working directory the recording states.
    const recording = join(root, folder, 'projects', claudeProjectFolder(root), 'session.jsonl');
    await mkdir(join(recording, '..'), { recursive: true });
    await writeFile(recording, `${JSON.stringify({ timestamp: START })}\n`);
    const home = probe === 'home' ? root : await mkdtemp(join(tmpdir(), 'sonah-code-step-home-rr6-'));
    if (probe !== 'home') t.after(() => rm(home, { recursive: true, force: true }));
    const session = codeSession({ reads: ['cfg-link.json', `${folder}/.claude.json`, `${folder}/settings.json`] });
    const NAMES = ['cfg-link.json', `${folder}/`, '.claude.json', 'settings.json', 'other.jsonl'];
    const state = join(await mkdtemp(join(tmpdir(), `sonah-code-step-rr6-${probe}-`)), 'state');
    t.after(() => rm(join(state, '..'), { recursive: true, force: true }));
    // No CLAUDE_CONFIG_DIR: the default homes are under a HOME that holds no such folder by that name.
    const run = await reviewIn(t, { root, recording, state, session, env: { HOME: home },
      judge: codeJudge({ check: contradictClaim, pass: findEmptyInput }) });
    const code = run.calls.filter((r) => /^(code-|challenge:code-)/.test(r.label));
    assert.ok(code.length > 5, probe);
    for (const request of code)
      for (const text of [...NAMES, ...LINES]) assert.ok(!request.prompt.includes(text), `${probe} ${request.label}: ${text}`);
    const states = Object.fromEntries(run.report.codePass.files.map((f) => [f.path, f.state]));
    for (const path of ['cfg-link.json', `${folder}/.claude.json`, `${folder}/settings.json`])
      assert.equal(states[path], 'harness_home', `${probe} ${path}`);
    if (probe === 'project') assert.equal(states[`${folder}/projects/-other-project/other.jsonl`], 'harness_home');
    for (const line of LINES) assert.ok(!run.written.includes(line), `${probe} ${line}`);
  }
});

// ---- the second release review (2026-10-15): a harness home only in its recorder's own layout ----------------------

test('second release review (medium): a recording kept in a folder named projects never makes the home folder a harness home', async (t) => {
  // The reviewer's probes, with the variable unset: G1, the repository at ~/projects/app with its recording kept in it
  // (~/projects/app/session.jsonl); G2, the recording kept with others at ~/projects/recordings/session.jsonl and the
  // project at ~/code/app. Neither folder is Claude Code's name for the working directory, so neither names a harness
  // home: the session's files are read and the code step runs, by default and in the dry run. Control: the same session
  // with its recording in Claude Code's own layout under a second config folder (~/.claude-2/projects/<the working
  // directory, as Claude Code names it>/session.jsonl) still makes that folder a harness home.
  for (const probe of ['G1', 'G2', 'layout']) {
    const home = await mkdtemp(join(tmpdir(), `sonah-code-step-home-${probe}-`));
    t.after(() => rm(home, { recursive: true, force: true }));
    const at = probe === 'G1' ? join(home, 'projects', 'app') : join(home, 'code', 'app');
    const { root } = await repository(t, { at, base: { 'src/parse.js': BASE_PARSE, 'src/util.js': CODE_FILES['src/util.js'],
      '.claude-2/settings.json': '{"b":1}\n' }, after: { 'src/parse.js': CODE_FILES['src/parse.js'],
      '.claude-2/settings.json': '{"b":"RR7_SETTINGS_LINE"}\n' } });
    const recording = probe === 'G1' ? join(root, 'session.jsonl')
      : probe === 'G2' ? join(home, 'projects', 'recordings', 'session.jsonl')
        : join(root, '.claude-2', 'projects', claudeProjectFolder(root), 'session.jsonl');
    await mkdir(join(recording, '..'), { recursive: true });
    await writeFile(recording, `${JSON.stringify({ timestamp: START })}\n`);
    const session = codeSession({ reads: ['.claude-2/settings.json'] });
    const state = join(await mkdtemp(join(tmpdir(), `sonah-code-step-${probe}-`)), 'state');
    t.after(() => rm(join(state, '..'), { recursive: true, force: true }));
    const run = await reviewIn(t, { root, recording, state, session, env: { HOME: home },
      judge: codeJudge({ check: contradictClaim, pass: findEmptyInput }) });
    const states = Object.fromEntries(run.report.codePass.files.map((f) => [f.path, f.state]));
    const code = run.calls.filter((r) => /^(code-|challenge:code-)/.test(r.label));
    assert.ok(code.length > 5, probe);
    for (const path of ['src/parse.js', 'src/util.js']) assert.equal(states[path], 'shown', `${probe} ${path}`);
    assert.ok(code.some((request) => request.prompt.includes('src/parse.js')), probe);
    if (probe === 'layout') {
      assert.equal(states['.claude-2/settings.json'], 'harness_home');
      for (const request of code) assert.ok(!request.prompt.includes('RR7_SETTINGS_LINE'), request.label);
      continue;
    }
    // Not a harness home: the file the session read in the working directory is read as any other.
    assert.equal(states['.claude-2/settings.json'], 'shown', probe);
    assert.ok(!Object.values(states).includes('harness_home'), probe);
    assert.equal(run.report.codePass.coverage, 'complete', probe);
    assert.equal(run.code, 0, probe);
    const dry = await reviewIn(t, { root, recording, state: join(state, '..', 'dry'), session, argv: ['--dry-run'],
      env: { HOME: home }, judge: codeJudge({ check: contradictClaim, pass: findEmptyInput }) });
    assert.doesNotMatch(dry.out, /harness_home/, probe);
    assert.match(dry.out, /Code step: on/, probe);
  }
});
