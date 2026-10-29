// What a review writes and prints (D97), end to end through the CLI: `--format html --output X.html`
// writes the page and the Markdown report beside it (owner-only, never over a file that exists, both checked before any
// model call); `--format md --output` writes the report alone; with no `--output` the report goes to stdout. The terminal
// prints the count line, the report's line and the one `gh pr comment` line; and with a temporary git repository whose
// remote `origin` has a GitHub URL that is never contacted (its remote-tracking branch is written locally), the facts
// reach the page and the report as permalinks once the work is committed and "pushed" — and that re-run makes no model
// call. Synthetic sessions, a deterministic fake reviewer: no recording, no model, no network.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runSessionReviewCommand } from '../src/session-review-command.js';
import { REPORT_OUTPUT_WORDS } from '../src/report-output.js';
import { REPORT_TRIM_WORDS } from '../../render/report-words.js';
import { REPORT_MD_LIMITS } from '../../render/session-story.js';
import { CODE_FILES, codeSession, codeJudge, sha256 } from './code-pass-fixture.js';

const START = '2030-01-01T00:00:00.000Z';
const BASE_PARSE = CODE_FILES['src/parse.js'].replace('split(",")', 'split(";")');
const GIT_ENV = (date) => ({ ...Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('GIT_'))),
  GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date, GIT_AUTHOR_NAME: 'synthetic', GIT_AUTHOR_EMAIL: 's@example.invalid',
  GIT_COMMITTER_NAME: 'synthetic', GIT_COMMITTER_EMAIL: 's@example.invalid' });

/** A repository: the base commit (before the session), its remote-tracking branch written locally, then the session's
 *  work in the working tree, not committed. Its remote has a GitHub URL; nothing ever contacts it. */
async function repository(t) {
  const top = await mkdtemp(join(tmpdir(), 'sonah-report-files-'));
  t.after(() => rm(top, { recursive: true, force: true }));
  const root = join(top, 'repo');
  await mkdir(join(root, 'src'), { recursive: true });
  const git = (args, date = '2029-01-01T00:00:00Z') => execFileSync('git', args, { cwd: root, stdio: 'pipe',
    env: GIT_ENV(date) }).toString().trim();
  git(['init', '-q', '-b', 'main']);
  await writeFile(join(root, 'src', 'parse.js'), BASE_PARSE);
  await writeFile(join(root, 'src', 'util.js'), CODE_FILES['src/util.js']);
  git(['add', '-A']);
  git(['commit', '-q', '-m', 'base']);
  git(['remote', 'add', 'origin', 'https://github.com/example-org/example-api.git']);
  git(['update-ref', 'refs/remotes/origin/main', git(['rev-parse', 'HEAD'])]);
  await writeFile(join(root, 'src', 'parse.js'), CODE_FILES['src/parse.js']);
  const recording = join(top, 'recording.jsonl');
  await writeFile(recording, `${JSON.stringify({ timestamp: START })}\n`);
  const out = join(top, 'out dir');
  await mkdir(out);
  return { top, root, git, recording, out };
}

/** One review run; every model call counted. `session`: the session the run reviews (`codeSession()` by default). */
async function review(repo, argv, { state = join(repo.top, 'state'), session = codeSession() } = {}) {
  const calls = [];
  let out = '', err = '';
  const judge = codeJudge();
  const code = await runSessionReviewCommand([repo.recording, '--concurrency', '1', '--state-dir', state, '--no-open',
    '--code-pass', ...argv], {
    stdout: { write: (text) => { out += text; } }, stderr: { write: (text) => { err += text; } }, cwd: repo.root,
    env: { HOME: join(repo.top, 'home'), SONAH_HOME: join(repo.top, '.sonah'), CODEX_HOME: join(repo.top, 'codex'),
      SONAH_CLAUDE_PROJECTS: join(repo.top, 'claude') },
    installSignals: false, loadReviews: async () => new Map(), openPage: async () => {},
    loadSession: async () => ({ session, hash: sha256('synthetic'), cwd: repo.root }),
    createJudge: ({ onResult }) => async (request) => {
      calls.push(request);
      onResult({ ok: true, backend: 'claude-cli', attestation: 'attested', contextWindow: 1_000_000 });
      return judge(request);
    } });
  return { code, calls, out, err };
}

test('D97 (7, 8, 11): the page and its .md, the printed lines, and code links after a commit with no model call',
  async (t) => {
  const repo = await repository(t);
  // First run, the work not committed: the page and the .md beside it, owner-only.
  const first = await review(repo, ['--format', 'html', '--output', '../out dir/review.html']);
  assert.equal(first.code, 0, first.err);
  assert.ok(first.calls.length > 0);
  const page = join(repo.out, 'review.html'), report = join(repo.out, 'review.md');
  for (const file of [page, report]) assert.equal((await stat(file)).mode & 0o777, 0o600, file);
  const md = await readFile(report, 'utf8');
  assert.match(md, /^## Sonah review · /);
  assert.equal(/https:\/\/github\.com/.test(md), false, 'not committed: no code link');
  assert.match(md, /- This file differs from the last commit, so Sonah gives no link\./);
  // The terminal: the count line (no "(folded)"), the local page, the .md with its bytes, the gh line with the path as
  // typed and quoted for the shell, and how to get code links.
  const lines = first.out.split('\n');
  const count = lines.find((line) => line.startsWith('Must act '));
  // D161: the agent's decisions, when the review holds one, after the tiers.
  assert.match(count, /^Must act \d+ · Must know \d+ · Good to know \d+ (?:· \d+ decisions?(?: \([^)]*\))? )?· Your prompt: /);
  assert.equal(count.includes('(folded)'), false);
  assert.equal(first.out.includes('Where your attention is needed'), false);
  const at = (text) => { const i = lines.indexOf(text); assert.ok(i >= 0, `${text}\n${first.out}`); return i; };
  const order = [at(`Local page: ${page}`),
    at(REPORT_OUTPUT_WORDS.mdWritten('../out dir/review.md', Buffer.byteLength(md, 'utf8'))),
    at("To post it on the pull request of your current branch, run: gh pr comment --body-file '../out dir/review.md'"),
    at(REPORT_OUTPUT_WORDS.rerun)];
  assert.deepEqual(order, [...order].sort((a, b) => a - b));
  assert.ok(at(count) < order[0]);
  assert.equal(first.out.includes('--edit-last'), false);
  assert.equal(first.out.includes(REPORT_OUTPUT_WORDS.outputInRepository), false, 'the report is outside the repository');

  // Never written over: an existing .md stops the run before any model call, and the page is not written.
  await writeFile(join(repo.out, 'again.md'), 'mine');
  const refused = await review(repo, ['--format', 'html', '--output', join(repo.out, 'again.html')]);
  assert.equal(refused.code, 2);
  assert.match(refused.err, /output_exists/);
  assert.equal(refused.calls.length, 0);
  await assert.rejects(stat(join(repo.out, 'again.html')));
  assert.equal(await readFile(join(repo.out, 'again.md'), 'utf8'), 'mine');

  // Commit the work and "push" it (the remote-tracking branch written locally): the same command with a new --output
  // reuses every stored answer, and the page and the .md link the code at HEAD.
  repo.git(['add', '-A'], '2031-01-01T00:00:00Z');
  repo.git(['commit', '-q', '-m', 'the agent\'s work'], '2031-01-01T00:00:00Z');
  const head = repo.git(['rev-parse', 'HEAD']);
  repo.git(['update-ref', 'refs/remotes/origin/main', head], '2031-01-01T00:00:00Z');
  const second = await review(repo, ['--format', 'html', '--output', join(repo.out, 'linked.html')]);
  assert.equal(second.code, 0, second.err);
  assert.equal(second.calls.length, 0, 'every answer reused: no model call');
  const link = `https://github.com/example-org/example-api/blob/${head}/src/parse.js#L2`;
  const linkedMd = await readFile(join(repo.out, 'linked.md'), 'utf8');
  assert.ok(linkedMd.includes(`\n\n${link}\n\n`), linkedMd);
  assert.match(linkedMd, new RegExp(`· commit ${head.slice(0, 7)}`));
  assert.ok((await readFile(join(repo.out, 'linked.html'), 'utf8')).includes(`href="${link}"`));
  assert.equal(second.out.includes(REPORT_OUTPUT_WORDS.rerun), false, 'committed and pushed: nothing more to do');

  // HEAD not on the remote: the push line, and the re-run line.
  repo.git(['update-ref', 'refs/remotes/origin/main', repo.git(['rev-parse', 'HEAD~1'])], '2031-01-01T00:00:00Z');
  const unpushed = await review(repo, ['--format', 'md', '--output', join(repo.out, 'unpushed.md')]);
  assert.equal(unpushed.calls.length, 0);
  assert.ok(unpushed.out.includes(REPORT_OUTPUT_WORDS.notPushed.new(head.slice(0, 7), 'origin')), unpushed.out);
  assert.ok(unpushed.out.includes(REPORT_OUTPUT_WORDS.rerun));
  // --format md --output: the report alone, owner-only; the gh line, and no local page.
  assert.equal((await stat(join(repo.out, 'unpushed.md'))).mode & 0o777, 0o600);
  assert.ok(unpushed.out.includes(`--body-file ${join(repo.out, 'unpushed.md').includes(' ') ? `'${join(repo.out,
    'unpushed.md')}'` : join(repo.out, 'unpushed.md')}\n`));
  assert.equal(unpushed.out.includes('Local page:'), false);
  await assert.rejects(stat(join(repo.out, 'unpushed.html')));

  // The report written inside the repository, not ignored: said, before the re-run line.
  const inside = await review(repo, ['--format', 'md', '--output', 'review.md']);
  assert.equal(inside.code, 0, inside.err);
  const insideLines = inside.out.split('\n');
  assert.ok(insideLines.indexOf(REPORT_OUTPUT_WORDS.outputInRepository) >= 0, inside.out);
  assert.ok(insideLines.indexOf(REPORT_OUTPUT_WORDS.outputInRepository) < insideLines.indexOf(REPORT_OUTPUT_WORDS.rerun));
  assert.match(inside.out, /run: gh pr comment --body-file review\.md\n/);
});

test('D97 (9): with no --output the .md goes to stdout, and no gh line is printed', async (t) => {
  const repo = await repository(t);
  const run = await review(repo, []);
  assert.equal(run.code, 0, run.err);
  assert.match(run.out, /\n## Sonah review · /);
  assert.match(run.out, /\nRead this report before you share it\.\n/);
  assert.equal(run.out.includes('gh pr comment'), false);
  assert.equal(run.out.includes('Sonah wrote the report'), false);
});

test('R2: a shortened .md says that Sonah did not shorten the HTML page only when the same run wrote it', async (t) => {
  // --format md is the default: no page is written, so the .md must not send the reader to one.
  const repo = await repository(t);
  const session = codeSession({ askTail: `\n\n${'Keep each line of the parser short and plain. '.repeat(2000)}` });
  const alone = await review(repo, ['--format', 'md', '--output', join(repo.out, 'alone.md')], { session });
  assert.equal(alone.code, 0, alone.err);
  const md = await readFile(join(repo.out, 'alone.md'), 'utf8');
  assert.ok(Buffer.byteLength(md, 'utf8') <= REPORT_MD_LIMITS.maxBytes);
  assert.ok(md.includes(REPORT_TRIM_WORDS.mdShortened), 'the long message is shortened');
  assert.equal(md.includes(REPORT_TRIM_WORDS.pageWhole), false, 'no page was written');
  await assert.rejects(stat(join(repo.out, 'alone.html')));
  // With --format html the same run writes the page, which needed no size trim: the .md beside it says so.
  const paged = await review(repo, ['--format', 'html', '--output', join(repo.out, 'paged.html')], { session });
  assert.equal(paged.code, 0, paged.err);
  assert.equal(paged.calls.length, 0, 'every answer reused');
  const besidePage = await readFile(join(repo.out, 'paged.md'), 'utf8');
  assert.ok(besidePage.includes(`${REPORT_TRIM_WORDS.mdShortened} ${REPORT_TRIM_WORDS.pageWhole}`), besidePage.slice(0, 2000));
});
