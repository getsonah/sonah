// The release review (owner, 2026-10-14): with the code step on by default, the session review's completeness decides
// the exit code. The code step's own coverage — short of complete, nothing to read, or no working directory here — is
// said plainly on the page, in the report .md and in the CLI, and does not by itself make the exit code non-zero. The one
// exception keeps the rule before it: --code-pass on the command line makes the code step's coverage count.
//
// Synthetic sessions, synthetic files and a deterministic fake reviewer: no recording, no model, no network.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runSessionReviewCommand, runStateLine, RUN_STATE_WORDS } from '../src/session-review-command.js';
import { writeCodePass } from '../src/settings.js';
import { reviewRunState } from '../../evidence/src/ledger.js';
import { CODE_REPORT_WORDS as STORY_CODE_WORDS } from '../../evidence/src/code-report.js';
import { CODE_FILES, CODE_TEXT, buildCodeSession, codeSession, codeJudge, repoWith, sha256 } from './code-pass-fixture.js';

/** One `sonah review` of `session` whose recorded working directory is `cwd`, in `format`, with `argv` and the settings
 *  file `setting` (true, false or none). */
async function review(t, { session = codeSession(), cwd, argv = [], setting = null, format = 'md',
  narrative = undefined, invalidCode = false } = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'sonah-code-step-exit-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const home = join(dir, 'home'), sonahHome = join(dir, '.sonah'), file = join(dir, 'recording.jsonl');
  await writeFile(file, '{}\n');
  if (setting !== null) await writeCodePass(setting, { env: { SONAH_HOME: sonahHome } });
  const output = join(dir, `review.${format === 'html' ? 'html' : 'md'}`);
  const judge = codeJudge(narrative ? { narrative } : {});
  let out = '';
  const code = await runSessionReviewCommand([file, '--concurrency', '1', '--state-dir', join(dir, 'state'),
    '--format', format, '--output', output, '--no-open', ...argv], {
    stdout: { write: (text) => { out += text; } }, stderr: { write: () => {} }, cwd: dir,
    env: { HOME: home, SONAH_HOME: sonahHome, CODEX_HOME: join(dir, 'codex'), SONAH_CLAUDE_PROJECTS: join(dir, 'claude') },
    installSignals: false, loadReviews: async () => new Map(), openPage: async () => {},
    loadSession: async () => ({ session, hash: sha256('synthetic'), cwd }),
    createJudge: ({ onResult }) => async (request) => {
      onResult({ ok: true, backend: 'claude-cli', attestation: 'attested', contextWindow: 1_000_000 });
      // `invalidCode`: every code-step answer is one the contract refuses, so the step runs and does not complete.
      if (invalidCode && /^code-/.test(request.label ?? '')) return { SYNTHETIC: 'not an answer' };
      return judge(request);
    } });
  const report = JSON.parse(await readFile(join(dir, 'state', 'review', 'report.private.json'), 'utf8').catch(() => 'null'));
  return { code, out, report, written: await readFile(output, 'utf8').catch(() => '') };
}

/** A session that wrote parse.js and logo.png under the working directory, logo.png binary now (a NUL byte, so its
 *  hunks are not shown): the code step is short of complete. (A file that changed after the session's last recorded
 *  edit no longer is: its hunks are shown.) */
async function partialCase(t) {
  const root = await repoWith(t, { ...CODE_FILES, 'src/logo.png': 'SYNTHETIC_LOGO\u0000\n' });
  const T1 = { turn: 'T1' };
  const session = buildCodeSession('s-exit-partial', { ...CODE_TEXT, logo: 'SYNTHETIC_LOGO\n' }, [
    { id: 'I1', kind: 'instruction', blob: 'ask', ...T1 },
    { id: 'W1', kind: 'invocation', write: 'src/parse.js', blob: 'body', ...T1 },
    { id: 'W1-r', kind: 'observation', invocation: 'W1', blob: 'wrote', ...T1 },
    { id: 'W2', kind: 'invocation', write: 'src/logo.png', blob: 'logo', ...T1 },
    { id: 'W2-r', kind: 'observation', invocation: 'W2', blob: 'wrote', ...T1 },
    { id: 'C1', kind: 'commentary', blob: 'claim', ...T1 }]);
  return { root, session };
}
/** A session that changed and read no file. */
const noFileSession = () => buildCodeSession('s-exit-none', CODE_TEXT, [
  { id: 'I1', kind: 'instruction', blob: 'ask', turn: 'T1' },
  { id: 'C1', kind: 'commentary', blob: 'claim', turn: 'T1' }]);

const SHORT = `code review ${RUN_STATE_WORDS.codePass.partial}`;
const APART = RUN_STATE_WORDS.codePassApart;

test('release review: the code step on by default never makes the exit code non-zero by itself; each case is said plainly', async (t) => {
  // Short of complete (a recorded write whose hunks it could not show): exit 0, the CLI and the page say so.
  const { root, session } = await partialCase(t);
  for (const format of ['md', 'html']) {
    const run = await review(t, { session, cwd: root, format });
    assert.equal(run.report.codePass.coverage, 'partial', format);
    assert.equal(run.report.codePass.required, false);
    assert.equal(run.code, 0, format);
    assert.match(run.out, /^Code review: on \(the default\)\./m);
    assert.ok(run.out.includes(`Sonah's review: complete (session review complete, ${SHORT}${APART}).`), run.out);
    assert.match(run.out, /^Coverage: .*code pass partial/m);
    assert.ok(run.written.includes(STORY_CODE_WORDS.coverage.partial), format);
  }
  // Nothing to read (the session changed and read no file): exit 0, said as such. D113: said plainly, as no write of
  // the session that the recording shows; D113's review: on the terminal too, as the page says it.
  const empty = await repoWith(t);
  const none = await review(t, { session: noFileSession(), cwd: empty });
  assert.equal(none.code, 0);
  assert.ok(none.out.includes(`code review ${RUN_STATE_WORDS.codePass.noWrite})`), none.out);
  assert.ok(none.written.includes(STORY_CODE_WORDS.noWrite));
  assert.ok(!none.written.includes(STORY_CODE_WORDS.noFile));
  // No working directory here (the recording's is not on this computer): exit 0, said as such.
  const gone = join(tmpdir(), `sonah-no-such-folder-${sha256(root).slice(0, 12)}`);
  for (const format of ['md', 'html']) {
    const missing = await review(t, { session: codeSession(), cwd: gone, format });
    assert.equal(missing.code, 0, format);
    assert.equal(missing.report.codePass.ran, false);
    assert.match(missing.out, /^Code review: did not run\. Sonah could not read a working directory of the session here/m);
    assert.ok(missing.out.includes(`code review did not run${APART})`), missing.out);
    assert.ok(missing.written.includes(STORY_CODE_WORDS.noRoot), format);
  }
  // The setting on (sonah config code-pass on) is not the command line: the same.
  const setting = await review(t, { session, cwd: root, setting: true });
  assert.match(setting.out, /^Code review: on \(your setting, sonah config\)\./m);
  assert.equal(setting.report.codePass.required, false);
  assert.equal(setting.code, 0);
  // Complete: exit 0 and nothing added to the line.
  const whole = await review(t, { session: codeSession(), cwd: await repoWith(t) });
  assert.equal(whole.report.codePass.coverage, 'complete');
  assert.equal(whole.code, 0);
  assert.ok(!whole.out.includes(APART));
});

test('release review: --code-pass on the command line keeps the rule before it — the code step\'s coverage counts', async (t) => {
  const { root, session } = await partialCase(t);
  const short = await review(t, { session, cwd: root, argv: ['--code-pass'] });
  assert.equal(short.report.codePass.required, true);
  assert.equal(short.code, 1);
  assert.ok(short.out.includes(`Sonah's review: incomplete (session review complete, ${SHORT}).`), short.out);
  // Also over a setting that is off.
  assert.equal((await review(t, { session, cwd: root, argv: ['--code-pass'], setting: false })).code, 1);
  // No working directory here: incomplete, exit 1.
  const gone = join(tmpdir(), `sonah-no-such-folder-${sha256(root).slice(0, 12)}`);
  const missing = await review(t, { session: codeSession(), cwd: gone, argv: ['--code-pass'] });
  assert.equal(missing.code, 1);
  assert.ok(missing.out.includes('code review did not run).'), missing.out);
  // Nothing to read reads complete (as before): exit 0.
  assert.equal((await review(t, { session: noFileSession(), cwd: await repoWith(t), argv: ['--code-pass'] })).code, 0);
});

test('release review: the session review\'s completeness decides, whatever the code step read', async (t) => {
  // A session review that did not complete (its window's answer is not one the contract accepts) exits 1, with the
  // code step complete, by default and with --code-pass alike.
  const broken = () => ({ SYNTHETIC: 'not an answer' });
  for (const argv of [[], ['--code-pass'], ['--no-code-pass']]) {
    const run = await review(t, { session: codeSession(), cwd: await repoWith(t), argv, narrative: broken });
    assert.equal(run.code, 1, argv.join(' '));
    assert.match(run.out, /^Sonah's review: incomplete \(session review did not finish/m, argv.join(' '));
  }
});

test('release review: reviewRunState counts a code pass only when it was required', async (t) => {
  // A real report whose session review completed and whose code pass read every file, its code pass then varied.
  const { report } = await review(t, { session: codeSession(), cwd: await repoWith(t), argv: ['--code-pass'] });
  assert.equal(reviewRunState(report), 'complete', 'premise: the session review and the code pass completed');
  const { required: _r, ...before } = report.codePass;
  const state = (codePass) => reviewRunState({ ...report, codePass });
  for (const coverage of ['partial', 'missing']) {
    assert.equal(state({ ...report.codePass, coverage, required: false }), 'complete', coverage);
    assert.equal(state({ ...report.codePass, coverage, required: true }), 'incomplete', coverage);
    assert.equal(state({ ...before, coverage }), 'incomplete', `${coverage}: a report from before the field reads as required`);
  }
  assert.equal(state({ ...report.codePass, required: false }), 'complete');
  const { codePass: _p, ...sessionOnly } = report;
  assert.equal(reviewRunState(sessionOnly), 'complete');
});

test('second release review (low): a code pass that ran and did not complete says so on the first line, as the story does', async (t) => {
  // The reviewer's probe: the code step runs and every answer it gets is one the contract refuses, so its coverage is
  // missing. The CLI's first line said "code pass not run" while the story said "The code review did not complete".
  for (const format of ['md', 'html']) {
    const run = await review(t, { session: codeSession(), cwd: await repoWith(t), format, invalidCode: true });
    assert.deepEqual([run.report.codePass.ran, run.report.codePass.coverage, run.report.codePass.required],
      [true, 'missing', false], format);
    assert.equal(run.code, 0, format);
    assert.ok(run.out.includes(`Sonah's review: complete (session review complete, code review did not finish${APART}).`),
      run.out);
    assert.ok(!run.out.includes('code review did not run'), format);
    assert.ok(run.written.includes(STORY_CODE_WORDS.coverage.missing), format);
  }
  // With --code-pass its coverage counts: incomplete, exit 1, in the same words.
  const counted = await review(t, { session: codeSession(), cwd: await repoWith(t), argv: ['--code-pass'], invalidCode: true });
  assert.equal(counted.code, 1);
  assert.ok(counted.out.includes(`Sonah's review: incomplete (session review complete, code review did not finish).`),
    counted.out);
  // The rule alone: ran and missing is "did not complete"; not ran (or a report from before the field) is "not run".
  const base = { reviewScope: 'session-only', findings: [], sessionReview: 'complete', coverage: 'complete' };
  const file = [{ path: 'a.js', state: 'shown' }];
  assert.match(runStateLine({ ...base, codePass: { ran: true, coverage: 'missing', files: file } }),
    /code review did not finish\)/);
  for (const codePass of [{ ran: false, coverage: 'missing', files: [] }, { coverage: 'missing', files: file }])
    assert.match(runStateLine({ ...base, codePass }), /code review did not run\)/);
  assert.equal(RUN_STATE_WORDS.codePass.incomplete, 'did not finish');
});
