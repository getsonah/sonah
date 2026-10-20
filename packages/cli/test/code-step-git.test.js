// The code step's diff, read with git (the agentic code step's starting map since code-snapshot/9): the session's start
// commit placed by structure (the commit a recording names, else the HEAD reflog entry in effect at the recording's
// first timestamp, else the newest first-parent commit made by then), every path that differs from it, git's own patch
// of each, an unrecorded change marked, nothing written to the repository, and the repository's state; D90: nothing withheld for privacy's sake (a harness home, a credential-shaped path and the home
// folder as the repository are paths like any other); and the reuse dry run: a dry run with --code-pass and
// --state-dir that reuses the stored session answers with no call and writes nothing.
//
// Throwaway repositories in temporary folders, synthetic sessions, a deterministic fake reviewer: no recording, no
// model, no network. Every commit date is fixed, so the reflog's times are too.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { chmod, mkdir, mkdtemp, readdir, readFile, realpath, rename, rm, stat, symlink, utimes, writeFile }
  from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createRepositoryReader, readCodeSnapshot, recordingStart, repositoryState, startCommit, snapshotTexts }
  from '../src/code-snapshot.js';
import { runSessionReviewCommand, STATE_FOLDER_ENTRIES } from '../src/session-review-command.js';
import { CODE_FILES, CODE_TEXT, codeSession, buildCodeSession, codeJudge, contradictClaim, reviewFinding, sha256 }
  from './code-pass-fixture.js';

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

test('code step git: every path the session wrote that differs, its base and git\'s patch, checked; D113: a differing path no recorded write touched is named apart, never read; nothing written', async (t) => {
  const { root, git } = await repository(t, { after: { 'src/parse.js': CODE_FILES['src/parse.js'],
    'gen.js': 'export const generated = 2;\n', '.env': 'API_KEY=SYNTHETIC_not_a_real_key\n' } });
  // The session wrote parse.js and read util.js and .env; gen.js changed with no recorded edit (a generator). What the
  // session only read is no part of the change (the review agent reads any file itself).
  const session = codeSession();
  const recording = await recordingAt(t, [{ timestamp: START }]);
  const index = await stat(join(root, '.git', 'index'));
  const snapshot = await readCodeSnapshot(session, { root, maxBytes: 1_000_000, recording });
  assert.deepEqual(snapshot.base.kind, 'git');
  assert.equal(snapshot.base.how, 'reflog');
  // An untracked file no recorded edit wrote and that did not change after the session began is not part of the diff.
  // D113: gen.js differs, but no recorded write touched it: no part of the change, named apart and never read.
  assert.deepEqual(snapshot.files.map((f) => [f.path, f.state, f.type ?? null, f.diff ?? null]), [
    ['src/parse.js', 'readable', 'modified', 'recorded']]);
  assert.deepEqual([snapshot.base.changedOutside, snapshot.base.written], [['gen.js'], 1]);
  assert.ok(!snapshotTexts(snapshot).some((text) => text.includes('generated')), 'gen.js was not read');
  const parse = snapshot.files[0];
  assert.equal(parse.base.text, BASE_PARSE);
  assert.ok(parse.hunks[0].rows.some((r) => r.type === '-' && r.text === '  const parts = input.split(";");'));
  assert.ok(parse.hunks[0].rows.some((r) => r.type === '+' && r.text === '  const parts = input.split(",");'));
  // The repository's state: over every file git lists (tracked, or untracked and not ignored) and the start commit.
  assert.match(snapshot.repoState, /^[0-9a-f]{64}$/);
  assert.equal(snapshot.repoState, await repositoryState({ top: snapshot.top, commit: snapshot.base.commit }));
  // Changed after the session began, it differs from the start commit as an added path; D113: no recorded write touched
  // it, so it is named apart with gen.js, never read.
  const later = new Date('2031-01-01T00:00:00Z');
  await utimes(join(root, '.env'), later, later);
  const fresh = await readCodeSnapshot(session, { root, maxBytes: 1_000_000, recording });
  assert.equal(fresh.files.find((f) => f.path === '.env'), undefined);
  assert.deepEqual(fresh.base.changedOutside, ['.env', 'gen.js']);
  // D90: a credential-shaped path the session wrote is a path of the change like any other, its hunks shown.
  const wrote = await readCodeSnapshot(codeSession({ writes: [{ path: '.env', text: 'API_KEY=SYNTHETIC_not_a_real_key\n' }] }),
    { root, maxBytes: 1_000_000, recording });
  const env = wrote.files.find((f) => f.path === '.env');
  assert.deepEqual([env.state, env.type, env.diff, env.text, env.hunks.length], ['readable', 'added', 'recorded',
    'API_KEY=SYNTHETIC_not_a_real_key\n', 1]);
  assert.deepEqual(wrote.base.changedOutside, ['gen.js']);
  assert.equal(fresh.repoState, snapshot.repoState, 'a file\'s time is no part of the state');
  // The reader the grounding reads through: any file of the repository, now and at the start commit.
  const repo = createRepositoryReader({ root, top: fresh.top, commit: fresh.base.commit, maxBytes: 1_000_000 });
  assert.equal(repo.read('README.md').text, '# readme\n', 'a file outside the change');
  assert.equal(repo.read('.env').text, 'API_KEY=SYNTHETIC_not_a_real_key\n');
  assert.equal(repo.base('src/parse.js').text, BASE_PARSE);
  assert.equal(repo.base('.env'), null, 'not at the start commit');
  assert.equal(repo.base('../outside.js'), null);
  // git wrote nothing: the index is as it was.
  assert.equal((await stat(join(root, '.git', 'index'))).mtimeMs, index.mtimeMs);
  assert.equal(git(['status', '--porcelain']).includes('.env'), true, 'the untracked file stays untracked');
});

test('code step git: through the CLI, the review agent\'s request carries git\'s hunks and the run is the same with the same tree', async (t) => {
  const { root } = await repository(t);
  const recording = await recordingAt(t, [{ timestamp: START }]);
  const dir = await mkdtemp(join(tmpdir(), 'sonah-code-step-run-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const once = async (state, argv = []) => {
    const calls = [];
    let out = '';
    const judge = codeJudge();
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
  const review = first.calls.find((r) => r.label === 'code-review:agent');
  // D113: gen.js changed with no recorded write: no part of the change, counted in its table of contents. D113 amended:
  // given to the code review apart, after the change, outside the evaluated session.
  const [ownPart, outsidePart = ''] = review.prompt.split('# The files outside the evaluated session');
  assert.ok(!ownPart.includes('gen.js'));
  assert.match(outsidePart, /^- gen\.js → lines \d+-\d+ · /m);
  assert.match(review.prompt, /^- and 1 more path differs from the start commit in the working directory, changed outside this session's recorded writes: outside the evaluated session, not part of this change$/m);
  assert.match(review.prompt, /^\| {4}2 \| {6}\| - \| {3}const parts = input\.split\(";"\);$/m);
  assert.match(review.prompt, /^@@ -1,4 \+1,4 @@/m);
  assert.deepEqual(review.agent.addDirs, [], 'the working directory is the repository\'s top folder');
  const report = JSON.parse(await readFile(join(state, 'review', 'report.private.json'), 'utf8'));
  assert.equal(report.codePass.base.kind, 'git');
  assert.equal(report.codePass.findings.length, 1);
  // code-pass/10: a shown file's added and removed lines, the + and - rows of git's hunks.
  assert.deepEqual(report.codePass.files.find((f) => f.path === 'src/parse.js'), { path: 'src/parse.js',
    type: 'modified', state: 'shown', sha256: sha256(CODE_FILES['src/parse.js']), hunks: 1, added: 1, removed: 1 });
  // D113: the record names gen.js apart, and the story says so.
  assert.deepEqual([report.codePass.base.changedOutside, report.codePass.base.written], [['gen.js'], 1]);
  assert.deepEqual(report.codePass.files.map((f) => f.path), ['src/parse.js']);
  // The reuse dry run: the stored session answers would all be reused; no call, nothing written.
  const before = await listing(state);
  const dry = await once(state, ['--dry-run']);
  assert.equal(dry.code, 0);
  assert.deepEqual(dry.calls, []);
  const reused = /^Stored session answers: the store answers (\d+) of (\d+) session calls, with no new call\.$/m.exec(dry.out);
  assert.ok(reused && Number(reused[1]) > 0 && reused[1] === reused[2], dry.out);
  assert.match(dry.out, /^Code review: it would first send 1 call \(code-review:agent \d+ KB\)\. Then it would send one check for each finding and one for its questions\. Each 30 items would add one more call, at most 4\. The items are asks, statements that the agent wrote into a file and the agent's decisions not to act\.$/m);
  assert.match(dry.out, /The change runs from the start commit [0-9a-f]{12} of the session \(reflog\)\. 1 path differs\. 1 more path changed outside this session's recorded writes, so it is outside the evaluated session\. Sonah leaves it out of the change\. If there is room in the code review's input, Sonah gives it to the code review apart from the change\./);
  assert.match(dry.out, /^Code review: the change holds 1 path that a recorded write could have changed or that changed during the session\./m);
  assert.deepEqual(await listing(state), before, 'the dry run wrote nothing, and touched no stored answer');
  // A state with no stored answers: they are counted as asked live, still with no call.
  const empty = await once(join(dir, 'empty-state'), ['--dry-run']);
  assert.deepEqual(empty.calls, []);
  assert.match(empty.out, /^Stored session answers: the store answers 0 of (\d+) session calls, with no new call\. A review would make at least \1 new calls?\.$/m);
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
 *  the state under `state` (null: none given, the default under Sonah's home); `env` adds to the run's environment (a
 *  value undefined unsets it); `inject` adds to the command's own boundaries. Every request is kept. */
async function reviewIn(t, { root, recording, state, session = codeSession(), judge, argv = [], env = {}, format = 'md',
  inject = {}, codePass = '--code-pass' }) {
  const dir = await mkdtemp(join(tmpdir(), 'sonah-code-step-review-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const calls = [];
  let out = '', err = '';
  const output = join(dir, `story.${format === 'html' ? 'html' : 'md'}`);
  const runEnv = { HOME: join(dir, 'home'), SONAH_HOME: join(dir, '.sonah'), CODEX_HOME: join(dir, 'codex'),
    SONAH_CLAUDE_PROJECTS: join(dir, 'claude'), ...env };
  const code = await runSessionReviewCommand([recording, '--concurrency', '1', ...(state ? ['--state-dir', state] : []),
    '--format', format, '--output', output, '--no-open', codePass, ...argv], {
    stdout: { write: (text) => { out += text; } }, stderr: { write: (text) => { err += text; } }, cwd: root, env: runEnv,
    installSignals: false, loadReviews: async () => new Map(), openPage: async () => {},
    loadSession: async () => ({ session, hash: sha256('synthetic'), cwd: root }),
    createJudge: ({ onResult }) => async (request) => {
      calls.push(request);
      onResult({ ok: true, backend: 'claude-cli', attestation: 'attested', contextWindow: 1_000_000 });
      return judge(request);
    }, ...inject });
  const stateDir = state ?? join(runEnv.SONAH_HOME ?? join(runEnv.HOME, '.sonah'), 'session-reviews', sha256(recording));
  const written = await readFile(output, 'utf8').catch(() => null);
  const report = JSON.parse(await readFile(join(stateDir, 'review', 'report.private.json'), 'utf8').catch(() => 'null'));
  return { code, calls, out, err, written, report };
}
/** The part of a request it showed (a repair appends its note after it). */
const shownOf = (request) => request.prompt.split('\n\n## Repair — one attempt only\n')[0];

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
  // D113: each is a file of the change because the session wrote it (each write's recorded body is another text).
  const session = codeSession({ writes: ['db/migrate.sql', 'db/seed.sql', 'db/untracked.sql']
    .map((path) => ({ path, text: 'SYNTHETIC_RECORDED_BODY\n' })) });
  const snapshot = await readCodeSnapshot(session, { root, maxBytes: 1_000_000, recording });
  for (const path of ['db/migrate.sql', 'db/seed.sql', 'db/untracked.sql']) {
    const file = snapshot.files.find((f) => f.path === path);
    assert.deepEqual([file.state, file.diff, file.text, file.hunks], ['binary', 'withheld', undefined, []], path);
  }
  assert.ok(!snapshotTexts(snapshot).some((text) => text.includes(SQL)));
  // The probe's finding, anchored in the staged file: the agent may read the file (D90), but no line of it is a line
  // the change block shows changed, so the finding is out of scope — never checked, never published; coverage partial.
  const finding = reviewFinding({ anchor: { path: 'db/migrate.sql', side: 'new', startLine: 1, endLine: 1 },
    trace: [{ step: 'It deletes a user.', path: 'db/migrate.sql', side: 'new', startLine: 1, endLine: 1, quote: SQL }] });
  const judge = codeJudge({ review: () => ({ findings: [finding], questions: [] }) });
  const { code, calls, report, written, out } = await reviewIn(t, { root, recording, judge, session,
    state: join(await mkdtemp(join(tmpdir(), 'sonah-code-step-bin-')), 'state') });
  // The code step did not cover the whole change: the run says so, and is incomplete (never "complete").
  assert.equal(code, 1);
  assert.match(out, /code review did not cover all of the change and its checks/);
  assert.deepEqual(report.codePass.findings, []);
  assert.deepEqual(report.codePass.withheld.map((w) => [w.reason, w.cause]), [['out_of_scope', 'out_of_scope']]);
  assert.equal(calls.filter((r) => r.label.startsWith('code-verify:')).length, 0);
  for (const request of calls) {
    assert.ok(!shownOf(request).includes(SQL), request.label);
    assert.ok(!shownOf(request).includes('SYNTHETIC_UNTRACKED'), request.label);
  }
  assert.deepEqual(report.codePass.files.filter((f) => f.state === 'binary').map((f) => f.path).sort(),
    ['db/migrate.sql', 'db/seed.sql', 'db/untracked.sql']);
  assert.equal(report.codePass.coverage, 'partial');
  assert.ok(!written.includes(SQL));
});

// ---- D90 (owner decision 2026-10-15): privacy is not a design constraint; the code step may see everything --------

test('D90: from a folder of a repository, git\'s lists stop at the working directory; the paths outside are counted, and the agents may read the whole repository', async (t) => {
  const { root: top } = await repository(t, {
    base: { 'app/src/parse.js': BASE_PARSE, 'app/src/util.js': CODE_FILES['src/util.js'],
      'other-team/project/plan.md': 'plan 1\n', 'agentcfg/settings.json': '{"a":1}\n', 'app/cfg/settings.json': '{"b":1}\n' },
    after: { 'app/src/parse.js': CODE_FILES['src/parse.js'], 'other-team/project/plan.md': 'plan 2\n',
      'agentcfg/settings.json': '{"a":2}\n', 'app/cfg/settings.json': '{"b":2}\n', 'loose.txt': 'new\n' } });
  const root = join(top, 'app');
  const recording = await recordingAt(t, [{ timestamp: START }]);
  // D113: the session wrote the configuration file too, so it is a file of the change.
  const session = codeSession({ writes: [{ path: 'cfg/settings.json', text: '{"b":2}\n' }] });
  const snapshot = await readCodeSnapshot(session, { root, maxBytes: 1_000_000, recording });
  // Two tracked paths changed outside the working directory: counted. A configuration folder under it (once withheld as a
  // harness home when CLAUDE_CONFIG_DIR named it): a path of the change like any other.
  assert.equal(snapshot.base.outside, 2);
  assert.deepEqual(snapshot.files.map((f) => [f.path, f.state, f.diff]), [['src/parse.js', 'readable', 'recorded'],
    ['cfg/settings.json', 'readable', 'recorded']]);
  assert.deepEqual(snapshot.base.changedOutside, []);
  assert.equal(snapshot.top, await realpath(top));
  const state = join(await mkdtemp(join(tmpdir(), 'sonah-code-step-sub-')), 'state');
  t.after(() => rm(join(state, '..'), { recursive: true, force: true }));
  const run = await reviewIn(t, { root, recording, state, session, env: { CLAUDE_CONFIG_DIR: join(root, 'cfg') },
    judge: codeJudge() });
  assert.equal(run.code, 0);
  assert.equal(run.report.codePass.coverage, 'complete');
  const review = run.calls.find((r) => r.label === 'code-review:agent');
  assert.match(review.prompt, /^- cfg\/settings\.json → lines \d+-\d+ · modified$/m);
  assert.match(review.prompt, /^- and 2 more paths differ from the start commit outside the working directory: not part of the change reviewed$/m);
  assert.deepEqual(review.agent.addDirs, [await realpath(top)]);
  // The repository reader reads a file elsewhere in the repository, by a path from the working directory.
  const repo = createRepositoryReader({ root, top: snapshot.top, commit: snapshot.base.commit, maxBytes: 1_000_000 });
  assert.equal(repo.read('../other-team/project/plan.md').text, 'plan 2\n');
  assert.equal(repo.read('../other-team/project/plan.md').path, '../other-team/project/plan.md');
  assert.equal(repo.base('../other-team/project/plan.md').text, 'plan 1\n');
  // And by a path from the top folder, when the working directory holds no such path: named from the working directory.
  assert.deepEqual([repo.read('other-team/project/plan.md')?.text, repo.read('other-team/project/plan.md')?.path],
    ['plan 2\n', '../other-team/project/plan.md']);
  assert.equal(repo.base('other-team/project/plan.md')?.text, 'plan 1\n');
  assert.equal(repo.read('src/parse.js').path, 'src/parse.js', 'the working directory first');
});

test('D90: with HOME the repository, the harness\'s own files are paths like any other — listed, read and shown', async (t) => {
  // A dotfiles repository: the working directory is the user's home, holding Claude Code's and Codex's folders and
  // Claude Code's state file. Once withheld and never named (harness_home), now part of the change like any file.
  const { root } = await repository(t, {
    base: { 'src/parse.js': BASE_PARSE, 'src/util.js': CODE_FILES['src/util.js'], '.claude/settings.json': '{"a":1}\n',
      '.codex/config.toml': 'model = "one"\n', '.claude.json': '{"projects":{}}\n', '.zsh_history': 'old\n' },
    after: { 'src/parse.js': CODE_FILES['src/parse.js'], '.claude/settings.json': '{"a":2}\n',
      '.codex/config.toml': 'model = "two"\n', '.claude.json': '{"projects":{"x":1}}\n', '.zsh_history': 'new\n',
      '.claude.json.backup': '{"projects":{"x":0}}\n' } });
  const later = new Date('2031-01-01T00:00:00Z');
  await utimes(join(root, '.claude.json.backup'), later, later);
  await symlink(join(root, '.claude', 'settings.json'), join(root, 'linked.json'));
  const recording = await recordingAt(t, [{ timestamp: START }]);
  // D113: the session wrote them, so they are files of the change.
  const session = codeSession({ writes: [['.claude/settings.json', '{"a":2}\n'], ['.codex/config.toml', 'model = "two"\n'],
    ['.claude.json', '{"projects":{"x":1}}\n'], ['.zsh_history', 'new\n'], ['.claude.json.backup', '{"projects":{"x":0}}\n']]
    .map(([path, text]) => ({ path, text })) });
  const snapshot = await readCodeSnapshot(session, { root, maxBytes: 1_000_000, recording });
  assert.deepEqual(snapshot.files.map((f) => [f.path, f.state]).sort(), [['.claude.json', 'readable'],
    ['.claude.json.backup', 'readable'], ['.claude/settings.json', 'readable'], ['.codex/config.toml', 'readable'],
    ['.zsh_history', 'readable'], ['src/parse.js', 'readable']]);
  assert.equal(snapshot.base.homeRepository, undefined, 'no home-folder limit');
  const state = join(await mkdtemp(join(tmpdir(), 'sonah-code-step-home-')), 'state');
  t.after(() => rm(join(state, '..'), { recursive: true, force: true }));
  const run = await reviewIn(t, { root, recording, state, session, env: { HOME: root }, judge: codeJudge() });
  assert.equal(run.code, 0);
  assert.equal(run.report.codePass.coverage, 'complete');
  const review = run.calls.find((r) => r.label === 'code-review:agent');
  for (const text of ['- .claude/settings.json → lines', '- .claude.json → lines', '- .codex/config.toml → lines',
    '{"projects":{"x":1}}', 'model = "two"']) assert.ok(review.prompt.includes(text), text);
  const repo = createRepositoryReader({ root, top: snapshot.top, commit: snapshot.base.commit, maxBytes: 1_000_000 });
  assert.equal(repo.read('linked.json').text, '{"a":2}\n');
  assert.equal(repo.base('.claude/settings.json').text, '{"a":1}\n');
});

test('second review of the code step (low, the probe), D117: a recorded edit to a sibling folder in the repository is reviewed from the start commit', async (t) => {
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
  const run = await reviewIn(t, { root, recording, state, session, judge: codeJudge() });
  // Everything under the working directory was shown; D117: so is the sibling edit, a part of the repository's change,
  // from the start commit (git's diff of that one path), named by its absolute path, and no more counted outside.
  assert.equal(run.report.codePass.findings.length, 1);
  const sibling = join(top, 'lib', 'SYNTHSIBLING.js');
  assert.deepEqual(run.report.codePass.files.map((f) => [f.path, f.state, f.type]),
    [['src/parse.js', 'shown', 'modified'], [sibling, 'shown', 'modified']]);
  assert.equal(run.report.codePass.base.outside, undefined);
  assert.deepEqual(run.report.codePass.footer, []);
  assert.equal(run.report.codePass.coverage, 'complete');
  assert.equal(run.code, 0);
  // The agents may read the whole repository: its top folder is added to where they read, and named.
  const review = run.calls.find((r) => r.label === 'code-review:agent');
  assert.deepEqual(review.agent.addDirs, [await realpath(top)]);
  assert.ok(review.prompt.includes(`The repository's top folder: ${await realpath(top)}`));
  assert.match(review.prompt, new RegExp(`^- ${sibling.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} → lines \\d+-\\d+ · modified`, 'm'));
  // D117 amended (the owner, 2026-10-18: "files outside any repository are listed, not reviewed"): a recorded write
  // outside every repository (an agent's scratch file) is listed by its folder and counted, never a file of the change;
  // the agents do not read that folder.
  const scratch = await mkdtemp(join(tmpdir(), 'sonah-code-step-scratch-'));
  t.after(() => rm(scratch, { recursive: true, force: true }));
  await writeFile(join(scratch, 'notes.md'), 'scratch\n');
  const outside = buildCodeSession('s-scratch', { ...CODE_TEXT, scratch: 'scratch\n' }, [
    { id: 'I1', kind: 'instruction', blob: 'ask', ...T1 },
    { id: 'W1', kind: 'invocation', write: 'src/parse.js', blob: 'body', ...T1 },
    { id: 'W1-r', kind: 'observation', invocation: 'W1', blob: 'wrote', ...T1 },
    { id: 'W2', kind: 'invocation', write: join(scratch, 'notes.md'), blob: 'scratch', ...T1 },
    { id: 'C1', kind: 'commentary', blob: 'claim', ...T1 }]);
  const counted = await reviewIn(t, { root, recording, state: join(state, '..', 'scratch-state'), session: outside,
    judge: codeJudge() });
  const realScratch = await realpath(scratch);
  assert.deepEqual(counted.report.codePass.footer, [{ kind: 'outside_root', count: 1 }]);
  assert.deepEqual(counted.report.codePass.files.find((f) => f.path === join(scratch, 'notes.md')),
    { path: join(scratch, 'notes.md'), state: 'outside_root' });
  assert.equal(counted.report.codePass.base.places, undefined);
  assert.deepEqual(counted.report.codePass.base.folders, [{ at: realScratch, written: 1 }]);
  const scratchReview = counted.calls.find((r) => r.label === 'code-review:agent');
  assert.deepEqual(scratchReview.agent.addDirs, [await realpath(top)]);
  assert.ok(!scratchReview.prompt.includes(scratch) && !scratchReview.prompt.includes(realScratch));
  assert.equal(counted.report.codePass.coverage, 'complete');
  assert.equal(counted.code, 0);
});

test('D90: a secret only in the start commit\'s text is shown wherever the reviewer restates it, as the model read it', async (t) => {
  const SECRET = 'Qm7Lw2Xp9Rk4Tz8Vb3Ny';
  const baseUtil = ['export const SEPARATOR = ",";', 'export const settings = {', `  password: "${SECRET}",`, '};', ''].join('\n');
  const { root } = await repository(t, { base: { 'src/parse.js': BASE_PARSE, 'src/util.js': baseUtil },
    after: { 'src/parse.js': CODE_FILES['src/parse.js'], 'src/util.js': 'export const SEPARATOR = ",";\n' } });
  const recording = await recordingAt(t, [{ timestamp: START }]);
  // D113: the session wrote util.js, so it is a file of the change.
  const session = codeSession({ writes: [{ path: 'src/util.js', text: 'export const SEPARATOR = ",";\n' }] });
  const snapshot = await readCodeSnapshot(session, { root, maxBytes: 1_000_000, recording });
  assert.ok(snapshotTexts(snapshot).includes(baseUtil), 'the snapshot holds the start commit\'s text');
  // A finding on the removed line, restating the value in the reviewer's own words.
  const finding = reviewFinding({ title: `The password ${SECRET} was removed`, claims: [`It held ${SECRET}.`],
    input: `login("${SECRET}")`, trace: [{ step: `The old code set ${SECRET}.`, path: 'src/util.js', side: 'old',
      startLine: 3, endLine: 3, quote: `password: "${SECRET}",` }],
    anchor: { path: 'src/util.js', side: 'old', startLine: 3, endLine: 3 } });
  for (const format of ['md', 'html']) {
    const state = join(await mkdtemp(join(tmpdir(), 'sonah-code-step-secret-')), 'state');
    t.after(() => rm(join(state, '..'), { recursive: true, force: true }));
    const run = await reviewIn(t, { root, recording, state, format, session,
      judge: codeJudge({ review: () => ({ findings: [finding], questions: [] }) }) });
    assert.equal(run.code, 0, format);
    assert.equal(run.report.codePass.findings.length, 1, format);
    // D90 (owner decision 2026-10-15): nothing is masked for a person; the finding is shown in the reviewer's words.
    assert.ok(run.written.replace(/\\(.)/g, '$1').includes(`The password ${SECRET} was removed`), format);
    assert.doesNotMatch(run.written, /‹(?:redacted|dropped)/, format);
  }
});

// ---- what the review itself writes, and what the coding agents do while it runs -------------------------------------

/** Every file under `dir` dated `when`: as a review's own writes look to the next review of a session that began before
 *  them. */
async function dateAll(dir, when) {
  for (const entry of await readdir(dir, { withFileTypes: true }).catch(() => [])) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) await dateAll(path, when); else await utimes(path, when, when);
  }
}
const LATER = new Date('2031-01-01T00:00:00Z');
/** A `readCode` that keeps each snapshot's repository state. */
const keepingStates = (states) => async (session, options) => {
  const snapshot = await readCodeSnapshot(session, options);
  states.push(snapshot.repoState);
  return snapshot;
};

test('agentic code step: a state folder inside the repository is no part of the change or of its state; a second review asks nothing', async (t) => {
  const { root } = await repository(t);
  const recording = await recordingAt(t, [{ timestamp: START }]);
  const state = join(root, 'review-state');
  const states = [];
  const first = await reviewIn(t, { root, recording, state, judge: codeJudge(), inject: { readCode: keepingStates(states) } });
  assert.equal(first.code, 0, first.out);
  assert.deepEqual([first.report.codePass.footer, first.report.codePass.coverage], [[], 'complete'],
    'what the review wrote while it ran is no change of the repository');
  // What the first review stored, as it looks when the session began before it.
  await dateAll(state, LATER);
  const second = await reviewIn(t, { root, recording, state, judge: codeJudge(), inject: { readCode: keepingStates(states) } });
  assert.deepEqual(second.calls, [], 'nothing is asked again');
  assert.equal(states[1], states[0], 'the same repository state');
  assert.deepEqual(second.report.codePass.files.map((f) => f.path), first.report.codePass.files.map((f) => f.path));
  assert.ok(!second.report.codePass.files.some((f) => f.path.startsWith('review-state')));
  // Read without naming it Sonah's, the folder is a part of the state, and (D113: no recorded write touched it) named
  // apart among the files that changed outside this session's recorded writes.
  await dateAll(state, LATER);
  const unnamed = await readCodeSnapshot(codeSession(), { root, maxBytes: 1_000_000, recording });
  assert.ok(unnamed.base.changedOutside.some((path) => path.startsWith('review-state/')));
  assert.ok(!first.report.codePass.base.changedOutside.some((path) => path.startsWith('review-state/')));
  assert.notEqual(unnamed.repoState, states[0]);
});

test('agentic code step: with HOME the repository, the default state and the coding agents\' homes are no part of its state', async (t) => {
  const { root } = await repository(t);
  const recording = await recordingAt(t, [{ timestamp: START }]);
  // The review agent's harness writes its own files while the step runs: Claude Code's folder and state file, Codex's.
  let runs = 0;
  const harness = async (prompt) => {
    runs += 1;
    await mkdir(join(root, '.claude', 'statsig'), { recursive: true });
    await writeFile(join(root, '.claude', 'statsig', 'cache'), `run ${runs}\n`);
    await writeFile(join(root, '.claude.json'), `{"numStartups":${runs}}\n`);
    await mkdir(join(root, '.codex'), { recursive: true });
    await writeFile(join(root, '.codex', 'history.jsonl'), `{"run":${runs}}\n`);
    return contradictClaim(prompt);
  };
  const env = { HOME: root, SONAH_HOME: undefined, CODEX_HOME: undefined };
  const states = [];
  const first = await reviewIn(t, { root, recording, state: null, env, judge: codeJudge({ review: harness }),
    inject: { readCode: keepingStates(states) } });
  assert.equal(first.code, 0, first.out);
  assert.equal(runs, 1);
  assert.deepEqual([first.report.codePass.footer, first.report.codePass.coverage], [[], 'complete']);
  assert.ok((await stat(join(root, '.sonah', 'session-reviews'))).isDirectory(), 'the state is in the repository');
  await dateAll(join(root, '.sonah'), LATER);
  const second = await reviewIn(t, { root, recording, state: null, env, judge: codeJudge({ review: harness }),
    inject: { readCode: keepingStates(states) } });
  assert.deepEqual(second.calls, []);
  assert.equal(states[1], states[0]);
  assert.ok(!second.report.codePass.files.some((f) => f.path.startsWith('.sonah')));
  // A write anywhere else in the repository while the step runs is still said.
  const edited = await reviewIn(t, { root, recording, state: null, env, argv: ['--code-model', 'claude-opus-5-5'],
    judge: codeJudge({ review: async (prompt) => { await writeFile(join(root, 'README.md'), 'edited\n');
      return contradictClaim(prompt); } }) });
  assert.deepEqual(edited.report.codePass.footer, [{ kind: 'source_changed' }]);
});

test('agentic code step: the repository\'s state — the start commit, each file\'s bytes as they are, its mode, a link\'s target, and the places left out', async (t) => {
  const { root, baseCommit } = await repository(t, { after: {} });
  const top = await realpath(root);
  const state = (over = {}) => repositoryState({ top, commit: baseCommit, ...over });
  const start = await state();
  assert.match(start, /^[0-9a-f]{64}$/);
  assert.equal(await state(), start, 'the same repository, the same state');
  assert.notEqual(await state({ commit: 'b'.repeat(40) }), start, 'the start commit is part of it');
  // The bytes as they are, never as a filter of git's would store them: a line ending alone is another state.
  await writeFile(join(root, '.gitattributes'), '* text=auto\n');
  const lf = await state();
  await writeFile(join(root, 'README.md'), '# readme\r\n');
  assert.notEqual(await state(), lf, 'CRLF is not LF');
  await writeFile(join(root, 'README.md'), '# readme\n');
  assert.equal(await state(), lf);
  // A file's mode.
  await chmod(join(root, 'gen.js'), 0o755);
  assert.notEqual(await state(), lf, 'executable');
  await chmod(join(root, 'gen.js'), 0o644);
  assert.equal(await state(), lf);
  // A link: its target, not the file it leads to.
  await symlink('README.md', join(root, 'link'));
  const linked = await state();
  assert.notEqual(linked, lf);
  await rm(join(root, 'link'));
  await symlink('gen.js', join(root, 'link'));
  assert.notEqual(await state(), linked, 'another target');
  await rm(join(root, 'link'));
  assert.equal(await state(), lf);
  // A tracked file in a left-out place (a home folder kept in git that tracks a harness's state file): its edits are no
  // part of the state either.
  const tracked = [join(root, 'gen.js')];
  const genText = await readFile(join(root, 'gen.js'), 'utf8');
  const withoutGen = await state({ omit: tracked });
  await writeFile(join(root, 'gen.js'), 'export const generated = 9;\n');
  assert.notEqual(await state(), lf);
  assert.equal(await state({ omit: tracked }), withoutGen, 'a tracked file in a left-out place');
  await writeFile(join(root, 'gen.js'), genText);
  assert.equal(await state(), lf);
  // The places a review writes, when they lie in the repository: left out, a folder not made yet by where it will be;
  // a place elsewhere, or the top folder itself, leaves nothing out.
  const omit = [join(root, 'review-state'), join(root, '.home-state.json'), join(tmpdir(), 'elsewhere')];
  await mkdir(join(root, 'review-state', 'answers'), { recursive: true });
  await writeFile(join(root, 'review-state', 'answers', 'a.json'), '{}\n');
  await writeFile(join(root, '.home-state.json'), '{}\n');
  assert.equal(await state({ omit }), lf);
  const all = await state();
  assert.notEqual(all, lf);
  assert.equal(await state({ omit: [root] }), all, 'the top folder is never left out');
  await writeFile(join(root, 'review-state-notes.txt'), 'x\n');
  assert.notEqual(await state({ omit }), lf, 'a name that only begins like a left-out folder is no part of it');
  await rm(join(root, 'review-state-notes.txt'));
  // A file git cannot read leaves the state known: hashed here, or named unreadable.
  if (process.getuid?.() !== 0) {
    await chmod(join(root, 'gen.js'), 0o000);
    t.after(() => chmod(join(root, 'gen.js'), 0o644).catch(() => {}));
    const hidden = await state({ omit });
    assert.match(hidden, /^[0-9a-f]{64}$/);
    assert.equal(await state({ omit }), hidden);
    assert.notEqual(hidden, lf);
    // An unreadable file is named in the state, never skipped: it is not the same state as the file gone.
    await chmod(join(root, 'README.md'), 0o000);
    t.after(() => chmod(join(root, 'README.md'), 0o644).catch(() => {}));
    const both = await state({ omit });
    const away = join(await mkdtemp(join(tmpdir(), 'sonah-code-step-away-')), 'README.md');
    t.after(() => rm(join(away, '..'), { recursive: true, force: true }));
    await rename(join(root, 'README.md'), away);
    assert.notEqual(await state({ omit }), both, 'unreadable is not gone');
    await rename(away, join(root, 'README.md'));
    await chmod(join(root, 'README.md'), 0o644);
    await chmod(join(root, 'gen.js'), 0o644);
    assert.equal(await state({ omit }), lf);
  }
});

// ---- the second review of the fix round: only what Sonah writes is left out, never the change itself ---------------

test('agentic code step: a state folder that is the working directory, or holds it, is refused before anything is read; without the code step it is used', async (t) => {
  // --state-dir . from a folder below the top folder, --state-dir .. from there (the top folder), --state-dir . at the
  // top folder, and a working directory named like one of the state folder's entries (review/) under it: what Sonah
  // writes there would be the next review's change, and a project folder named like an entry would be out of sight.
  for (const { below, given } of [{ below: 'app', given: '.' }, { below: 'app', given: '..' }, { below: '', given: '.' },
    { below: 'review', given: '..' }]) {
    const at = below ? `${below}/` : '';
    const { root: top } = await repository(t, {
      base: { [`${at}src/parse.js`]: BASE_PARSE, [`${at}src/util.js`]: CODE_FILES['src/util.js'], 'README.md': '# readme\n' },
      after: { [`${at}src/parse.js`]: CODE_FILES['src/parse.js'] } });
    const root = below ? join(top, below) : top;
    const state = resolve(root, given);
    const label = `${below || 'the top folder'}, --state-dir ${given}`;
    const recording = await recordingAt(t, [{ timestamp: START }]);
    const read = [];
    const run = await reviewIn(t, { root, recording, state, judge: codeJudge(),
      inject: { readCode: async (...args) => { read.push(args); return readCodeSnapshot(...args); } } });
    assert.equal(run.code, 2, label);
    assert.match(run.err, /^Review could not complete: state_dir_holds_root\.\nFix: The --state-dir that you gave is the folder that the session worked in, or holds it/, label);
    assert.deepEqual([run.calls, read], [[], []], `${label}: nothing read or sent`);
    // Nothing written: no entry Sonah makes (a project folder named review/ is the project's), no record of a review.
    assert.deepEqual((await readdir(state)).filter((name) => STATE_FOLDER_ENTRIES.includes(name) && name !== below), [],
      `${label}: nothing written`);
    for (const record of ['progress.json', 'report.private.json'])
      await assert.rejects(stat(join(state, 'review', record)), { code: 'ENOENT' }, `${label}: ${record}`);
  }
  // Without the code step nothing is read from the repository, so such a folder is the review's like any other.
  const { root } = await repository(t);
  const recording = await recordingAt(t, [{ timestamp: START }]);
  const off = await reviewIn(t, { root, recording, state: root, judge: codeJudge(), codePass: '--no-code-pass' });
  assert.equal(off.code, 0, off.err);
  assert.ok(off.calls.length > 0 && !off.calls.some((r) => /^code-/.test(r.label)));
  assert.ok((await readdir(root)).includes('review'));
  // A state folder inside the working directory, holding none of it, is used, and what it holds is Sonah's alone.
  const inside = await reviewIn(t, { root, recording, state: join(root, 'sonah-state'), judge: codeJudge() });
  assert.equal(inside.code, 0, inside.err);
  assert.deepEqual(inside.report.codePass.files.map((f) => f.path).sort(), ['src/parse.js']);
  // D113: gen.js changed with no recorded write: named apart; Sonah's own folder is not.
  assert.deepEqual(inside.report.codePass.base.changedOutside, ['gen.js']);
});

test('agentic code step: a place that holds the working directory is never left out, of the change or of the state', async (t) => {
  const { root: top } = await repository(t, {
    base: { 'app/src/parse.js': BASE_PARSE, 'app/src/util.js': CODE_FILES['src/util.js'] },
    after: { 'app/src/parse.js': CODE_FILES['src/parse.js'] } });
  const root = join(top, 'app');
  const recording = await recordingAt(t, [{ timestamp: START }]);
  const read = (over = {}) => readCodeSnapshot(codeSession(), { root, maxBytes: 1_000_000, recording, ...over });
  const differing = (snapshot) => snapshot.files.filter((f) => f.diff !== undefined).map((f) => f.path);
  const plain = await read();
  assert.deepEqual(differing(plain), ['src/parse.js']);
  // The working directory, or the top folder above it, named as Sonah's or a harness's place: nothing is left out.
  for (const place of [root, top]) {
    const named = await read({ own: [place], harnessHomes: [place] });
    assert.deepEqual(differing(named), ['src/parse.js'], place);
    assert.equal(named.repoState, plain.repoState, place);
    assert.equal(await repositoryState({ top: named.top, commit: named.base.commit, omit: named.stateOmits, root }),
      plain.repoState, `${place}: the state taken again`);
  }
  // A place inside it is left out of the state like any other; of the change, only what git does not track and no
  // recorded edit wrote: src/parse.js is both, so it is reviewed.
  const inner = await read({ own: [join(root, 'src')] });
  assert.deepEqual(differing(inner), ['src/parse.js']);
  assert.notEqual(inner.repoState, plain.repoState);
  // Through the CLI: Claude Code's folder is the working directory (CLAUDE_CONFIG_DIR); the state taken after the step
  // keeps it too, so an unchanged repository reads unchanged.
  const state = join(await mkdtemp(join(tmpdir(), 'sonah-code-step-holds-')), 'state');
  t.after(() => rm(join(state, '..'), { recursive: true, force: true }));
  const run = await reviewIn(t, { root, recording, state, env: { CLAUDE_CONFIG_DIR: root }, judge: codeJudge() });
  assert.deepEqual([run.code, run.report.codePass.footer, run.report.codePass.coverage], [0, [], 'complete']);
  assert.deepEqual(run.report.codePass.files.map((f) => f.path), ['src/parse.js']);
});

test('agentic code step: of a place Sonah writes, only what git does not track and no recorded edit wrote is left out of the change', async (t) => {
  const { root: top } = await repository(t, {
    base: { 'app/src/parse.js': BASE_PARSE, 'app/src/util.js': CODE_FILES['src/util.js'],
      'app/state/answers/kept.json': '{"a":1}\n', 'state/answers/kept.json': '{"b":1}\n', 'lib/other.js': 'x\n' },
    after: { 'app/src/parse.js': CODE_FILES['src/parse.js'], 'app/state/answers/kept.json': '{"a":2}\n',
      'state/answers/kept.json': '{"b":2}\n', 'lib/other.js': 'y\n', 'app/state/answers/stored.json': '{}\n' } });
  const root = join(top, 'app');
  await utimes(join(root, 'state', 'answers', 'stored.json'), LATER, LATER);
  const recording = await recordingAt(t, [{ timestamp: START }]);
  const read = (own) => readCodeSnapshot(codeSession(), { root, maxBytes: 1_000_000, recording, own });
  const differing = (snapshot) => snapshot.files.filter((f) => f.diff !== undefined).map((f) => f.path).sort();
  // Named as Sonah's: the untracked file it could have written is left out; the files git tracks there are still named
  // (Sonah never adds a file to git), and one outside the working directory is counted. D113: neither was written by a
  // recorded write of the session, so neither is part of the change: each is named apart.
  const named = await read([join(root, 'state', 'answers'), join(top, 'state', 'answers')]);
  assert.deepEqual([differing(named), named.base.changedOutside, named.base.outside],
    [['src/parse.js'], ['state/answers/kept.json'], 2]);
  const unnamed = await read([]);
  assert.deepEqual([differing(unnamed), unnamed.base.changedOutside, unnamed.base.outside],
    [['src/parse.js'], ['state/answers/kept.json', 'state/answers/stored.json'], 2]);
});

test('agentic code step: a project folder named like a state folder\'s entry is reviewed — the session\'s write in it and a tracked file changed beside it', async (t) => {
  // The state folder (pkg) holds no part of the working directory (the top folder), but its entry review/ is a folder of
  // the project: the session wrote pkg/review/parse.js and a new pkg/review/added.js (git does not track it), and
  // pkg/review/check.js changed with no recorded edit.
  const { root } = await repository(t, {
    base: { 'pkg/review/parse.js': BASE_PARSE, 'pkg/review/check.js': 'export const checked = 1;\n',
      'src/util.js': CODE_FILES['src/util.js'] },
    after: { 'pkg/review/parse.js': CODE_FILES['src/parse.js'], 'pkg/review/check.js': 'export const checked = 2;\n',
      'pkg/review/added.js': 'export const added = 1;\n' } });
  const T1 = { turn: 'T1' };
  const session = buildCodeSession('sess-review-folder', { ...CODE_TEXT, added: 'export const added = 1;\n' }, [
    { id: 'I1', kind: 'instruction', blob: 'ask', ...T1 },
    { id: 'W1', kind: 'invocation', write: 'pkg/review/parse.js', blob: 'body', ...T1 },
    { id: 'W1-r', kind: 'observation', invocation: 'W1', blob: 'wrote', ...T1 },
    { id: 'W2', kind: 'invocation', write: 'pkg/review/added.js', blob: 'added', ...T1 },
    { id: 'W2-r', kind: 'observation', invocation: 'W2', blob: 'wrote', ...T1 },
    { id: 'C1', kind: 'commentary', blob: 'claim', ...T1 },
    { id: 'C2', kind: 'commentary', blob: 'final', phase: 'final', ...T1 }]);
  const recording = await recordingAt(t, [{ timestamp: START }]);
  const state = join(root, 'pkg');
  const nothing = () => ({ findings: [], questions: [] });
  const first = await reviewIn(t, { root, recording, state, session, judge: codeJudge({ review: nothing }) });
  assert.equal(first.code, 0, first.err);
  // D113: the session's writes are the change; check.js, which changed with no recorded write, is named apart, never
  // left out as Sonah's own.
  const project = ['pkg/review/added.js', 'pkg/review/parse.js'];
  assert.deepEqual(first.report.codePass.files.map((f) => f.path).sort(), project);
  assert.deepEqual(first.report.codePass.base.changedOutside, ['pkg/review/check.js']);
  const asked = first.calls.find((r) => r.label === 'code-review:agent');
  assert.ok(asked && project.every((path) => asked.prompt.includes(path)));
  assert.deepEqual([first.report.codePass.footer, first.report.codePass.coverage], [[], 'complete']);
  // What the review wrote in pkg/review/ beside them is Sonah's: the next review of the same tree asks nothing.
  for (const entry of STATE_FOLDER_ENTRIES) await dateAll(join(state, entry), LATER);
  const second = await reviewIn(t, { root, recording, state, session, judge: codeJudge({ review: nothing }) });
  assert.deepEqual(second.calls, [], 'nothing is asked again');
  assert.deepEqual(second.report.codePass.files.map((f) => f.path).sort(), project);
});

test('agentic code step: with HOME the repository, another review writing in Sonah\'s home is no change of the repository', async (t) => {
  const { root } = await repository(t);
  const recording = await recordingAt(t, [{ timestamp: START }]);
  // While this review's agent works, a review of another recording writes its own state under Sonah's home.
  let runs = 0;
  const alongside = async (prompt) => {
    runs += 1;
    const answers = join(root, '.sonah', 'session-reviews', 'another', 'answers');
    await mkdir(answers, { recursive: true });
    await writeFile(join(answers, `${runs}.json`), '{}\n');
    return contradictClaim(prompt);
  };
  const env = { HOME: root, SONAH_HOME: undefined, CODEX_HOME: undefined };
  const states = [];
  const first = await reviewIn(t, { root, recording, state: null, env, judge: codeJudge({ review: alongside }),
    inject: { readCode: keepingStates(states) } });
  assert.equal(runs, 1);
  assert.deepEqual([first.code, first.report.codePass.footer, first.report.codePass.coverage], [0, [], 'complete']);
  await dateAll(join(root, '.sonah'), LATER);
  const second = await reviewIn(t, { root, recording, state: null, env, judge: codeJudge({ review: alongside }),
    inject: { readCode: keepingStates(states) } });
  assert.deepEqual(second.calls, [], 'nothing is asked again');
  assert.equal(states[1], states[0]);
  assert.ok(!second.report.codePass.files.some((f) => f.path.startsWith('.sonah')));
});

// ---- a file changed after the session's last recorded edit (D90: never blank what the reviewer needs) -------------

/** The session: the ask, a write of `src/parse.js`, a delete of `src/gone.js` (each with its result), the claim. */
function writeThenDeleteSession() {
  const T1 = { turn: 'T1' };
  return buildCodeSession('s-changed-since', { ...CODE_TEXT }, [
    { id: 'I1', kind: 'instruction', blob: 'ask', ...T1 },
    { id: 'W1', kind: 'invocation', write: 'src/parse.js', blob: 'body', ...T1 },
    { id: 'W1-r', kind: 'observation', invocation: 'W1', blob: 'wrote', ...T1 },
    { id: 'D1', kind: 'invocation', callKey: 'D1', tool: 'Bash', operation: 'delete', paths: [{ path: 'src/gone.js' }],
      command: [], input: [], changes: [{ path: 'src/gone.js', before: [], after: [], diff: [] }], ...T1 },
    { id: 'D1-r', kind: 'observation', invocation: 'D1', blob: 'wrote', ...T1 },
    { id: 'C1', kind: 'commentary', blob: 'claim', ...T1 }]);
}

test('a file changed after the session\'s last recorded edit: its hunks are in the request, a finding on a changed line is in scope, the footer says so and coverage stays complete; a deleted file keeps its treatment', async (t) => {
  // The session wrote parse.js; then one line of it changed (a formatter rewrote `trim()`) after its last recorded
  // edit.
  const DRIFTED = CODE_FILES['src/parse.js'].replace('part.trim()', 'part.trimEnd()');
  const GONE = 'export const SYNTHETIC_GONE = 1;\n';
  const { root } = await repository(t, { base: { 'src/parse.js': BASE_PARSE, 'src/util.js': CODE_FILES['src/util.js'],
    'src/gone.js': GONE }, after: { 'src/parse.js': DRIFTED } });
  await rm(join(root, 'src', 'gone.js'));
  const recording = await recordingAt(t, [{ timestamp: START }]);
  const session = writeThenDeleteSession();
  // A finding of a kind that must anchor on a changed line: parse.js line 2, which the change modified.
  const judge = codeJudge({ review: () => ({ findings: [reviewFinding()], questions: [] }) });
  const state = join(await mkdtemp(join(tmpdir(), 'sonah-code-step-since-')), 'state');
  const { code, calls, report, written } = await reviewIn(t, { root, recording, state, session, judge });
  const review = calls.find((r) => r.label === 'code-review:agent');
  // The request holds the file's hunks, git's own, from the start commit to now: the agent's line and the later one.
  assert.match(review.prompt, /^- src\/parse\.js → lines \d+-\d+ · modified · changed after the session's last recorded edit, so its lines now may not all be the agent's/m);
  assert.match(review.prompt, /^\| {4}2 \| {6}\| - \| {3}const parts = input\.split\(";"\);$/m);
  assert.match(review.prompt, /^\| {6}\| {4}2 \| \+ \| {3}const parts = input\.split\(","\);$/m);
  assert.match(review.prompt, /^\| {6}\| {4}3 \| \+ \| {3}return parts\.map\(\(part\) => part\.trimEnd\(\)\);$/m);
  assert.ok(!review.prompt.includes('no longer holds what the session last wrote'));
  // The finding on the changed line is in scope: checked, and published.
  assert.deepEqual(calls.filter((r) => r.label.startsWith('code-verify:')).map((r) => r.label), ['code-verify:F1']);
  assert.deepEqual(report.codePass.findings.map((f) => [f.kind, f.anchor.path, f.anchor.startLine]),
    [['bug', 'src/parse.js', 2]]);
  assert.deepEqual(report.codePass.withheld, []);
  // The drift is a fact: the file's state names it; nothing is withheld; the coverage is complete and the run too.
  const parse = report.codePass.files.find((f) => f.path === 'src/parse.js');
  assert.deepEqual(parse, { path: 'src/parse.js', type: 'modified', state: 'changed_since_session',
    sha256: sha256(DRIFTED), hunks: 1, added: 2, removed: 2 });
  assert.deepEqual([report.codePass.footer, report.codePass.coverage, code], [[], 'complete', 0]);
  assert.ok(written.includes('1 file changed after the session\'s last recorded edit, so Sonah cannot tell whether all '
    + 'of its lines are the agent\'s: src/parse.js'), written);
  // D109: the one tally: both files seen whole (the file now, and the deleted file's removed lines).
  assert.ok(written.includes('The change covers 2 files. The code review saw 2 of them whole.'), written);
  // The deleted file keeps its treatment: not there, its change its removed lines only, no note of its own.
  const gone = report.codePass.files.find((f) => f.path === 'src/gone.js');
  assert.deepEqual(gone, { path: 'src/gone.js', type: 'deleted', state: 'deleted', hunks: 1, added: 0, removed: 1 });
  assert.match(review.prompt, /^- src\/gone\.js → lines \d+-\d+ · deleted( · S\d+)*$/m);
  assert.match(review.prompt, /^\| {4}1 \| {6}\| - \| export const SYNTHETIC_GONE = 1;$/m);
});

test('a file the session deleted that is there again is still not shown: listed by name, no line of it sent', async (t) => {
  const GONE = 'export const SYNTHETIC_GONE = 1;\n';
  const BACK = 'export const SYNTHETIC_BACK = 2;\n';
  const { root } = await repository(t, { base: { 'src/parse.js': BASE_PARSE, 'src/util.js': CODE_FILES['src/util.js'],
    'src/gone.js': GONE }, after: { 'src/parse.js': CODE_FILES['src/parse.js'], 'src/gone.js': BACK } });
  const recording = await recordingAt(t, [{ timestamp: START }]);
  const judge = codeJudge({ review: () => ({ findings: [], questions: [] }) });
  const state = join(await mkdtemp(join(tmpdir(), 'sonah-code-step-back-')), 'state');
  const { calls, report } = await reviewIn(t, { root, recording, state, session: writeThenDeleteSession(), judge });
  const review = calls.find((r) => r.label === 'code-review:agent');
  assert.match(review.prompt, /^- src\/gone\.js · modified · it no longer holds what the session last wrote to it: no hunk shown/m);
  for (const request of calls) assert.ok(!request.prompt.includes('SYNTHETIC_BACK'), request.label);
  assert.deepEqual(report.codePass.files.find((f) => f.path === 'src/gone.js'), { path: 'src/gone.js', type: 'modified',
    state: 'changed_since_session', hunks: 0 });
  assert.deepEqual([report.codePass.footer, report.codePass.coverage], [[{ kind: 'withheld', path: 'src/gone.js' }],
    'partial']);
});

test('D108 review: one repository reader serves the code pass and reads each path once — a file the session read is read '
  + 'while the review request is planned, and the grounding checks a quote in it against that text, even when the file '
  + 'changes while the review agent runs', async (t) => {
  const { root } = await repository(t);
  const recording = await recordingAt(t, [{ timestamp: START }]);
  const UTIL_LINE = 'export function trimAll(list) { return list.map((x) => x.trim()); }';
  const CHANGED = CODE_FILES['src/util.js'].replace('trimAll(list)', 'trimAll(items)');
  // A finding whose trace quotes line 3 of util.js, which the session read and did not change: as it was when the request
  // was planned, not as it is once the review agent has run.
  const finding = reviewFinding({ kind: 'contract_break', lens: 'contracts', trace: [reviewFinding().trace[0],
    { step: 'A caller trims each part again.', path: 'src/util.js', side: 'new', startLine: 3, endLine: 3,
      quote: UTIL_LINE }] });
  let rewrites = 0;
  const judge = codeJudge({ review: async () => {
    // The file changes while the review agent runs, after its request was planned and sent.
    if (rewrites++ === 0) await writeFile(join(root, 'src', 'util.js'), CHANGED);
    return { findings: [finding], questions: [] };
  } });
  const run = await reviewIn(t, { root, recording, state: null, judge });
  const review = run.calls.find((r) => r.label === 'code-review:agent');
  // Planned before the change: the reads block shows util.js as the session left it.
  assert.ok(review.prompt.includes(`${String(3).padStart(6, ' ')}\t${UTIL_LINE}`), 'the reads block, as planned');
  assert.equal(await readFile(join(root, 'src', 'util.js'), 'utf8'), CHANGED, 'the file changed during the review');
  // The grounding read util.js through the same reader: the text read while planning, so the quote grounds and the
  // finding is published, on the file as it was then.
  assert.equal(run.report.codePass.findings.length, 1, JSON.stringify(run.report.codePass.withheld));
  const step = run.report.codePass.findings[0].trace.find((s) => s.path === 'src/util.js');
  assert.deepEqual([step.sha256, step.span], [sha256(CODE_FILES['src/util.js']), UTIL_LINE]);
  // And the record says the repository changed during the review.
  assert.ok(run.report.codePass.footer.some((f) => f.kind === 'source_changed'));
  assert.equal(run.report.codePass.coverage, 'partial');
});
