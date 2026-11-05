// D210 (lever 2): no code review on a session review that running the same command again can finish. The code review's
// requests carry what the session review found, so a code step run before a failed window is filled is asked again in
// whole on the run that fills it (measured 2026-11-02: $34.50, then $31.48 again). The code step now waits: it asks
// nothing, its record says why by the closed gap `code_step_waits`, the terminal and the report say that it runs after
// the session review when the same command is run again, and the exit code stays the session review's own. A window that
// a rerun cannot finish holds nothing back, nor does a session review that two runs in a row left unfinished, on a
// recording that grew between them too (D210's review). With no change to review, the step asks nothing either way, so it
// does not wait and keeps its own reason (D210's review).
//
// Synthetic sessions, synthetic files and a deterministic fake reviewer: no recording, no model, no network.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CODE_STEP_BACKEND_LINE, CODE_STEP_WAITS_LINE, RUN_STATE_WORDS, reviewExitCode, runSessionReviewCommand,
  runStateLine } from '../src/session-review-command.js';
import { ANSWER_INCOMPLETE_REASONS, codeStepWaits, createSessionReviewStore, sessionReviewRerunCanFinish,
  windowRerunCanFinish } from '../src/session-review.js';
import { CODE_TEXT, buildCodeSession, codeSession, codeJudge, gitRepoWith, repoWith, sha256 } from './code-pass-fixture.js';
import { CODE_NOT_REVIEWED_REASONS, CODE_STEP_WAITS_GAP, GAP_CODES, JUDGE_FAILURE_CODES, RETRYABLE_JUDGE_CODES }
  from '../../evidence/src/ledger.js';
import { WINDOW_FAILURE_CODES, WINDOW_INCOMPLETE_REASONS, windowIncompleteReasons } from '../../evidence/src/run-review.js';
import { CODE_REPORT_WORDS, codeCoverageLines, codeNotReviewedOf, notReviewedWordsOf } from '../../evidence/src/code-report.js';
import { CODE_STEP_GATES } from '../../evidence/src/code-pass.js';
import { GAP_HEADER_CAUSE } from '../../evidence/src/review.js';

const CODE_LABEL = /^code-(?:review|verify|account)(?::|$)/;
const failure = (code) => Object.assign(new Error(code), { code });

// ---- which windows a rerun can finish, from the existing closed codes -------------------------------------------------
/** A window record whose call failed with `code`. */
const failed = (code, at = 0) => ({ windowIndex: at, failure: code, groundingComplete: false, challenge: { complete: false } });
/** An answered window record left incomplete for `reason` (WINDOW_INCOMPLETE_REASONS), shaped as run-review.js reads it. */
function incomplete(reason, at = 0) {
  const done = { windowIndex: at, failure: null, groundingComplete: true, sessionGroundingComplete: true,
    relevanceComplete: true, challenge: { complete: true, results: [] } };
  const challenge = (over) => ({ ...done, challenge: { complete: false, results: [{ votes: [{ valid: true }] }], ...over } });
  return { 'grounding:session': { ...done, groundingComplete: false, sessionGroundingComplete: false },
    'grounding:relevance': { ...done, groundingComplete: false, relevanceComplete: false },
    'challenge:budget_exhausted': challenge({ budgetExhausted: true }),
    'challenge:votes_invalid': challenge({ results: [{ votes: [{ valid: false }] }] }),
    'challenge:items_unresolved': challenge({}) }[reason];
}

test('D210: a failed window is one a rerun can finish exactly when its code is one an identical request can answer '
  + 'differently; an answered one, when asking again can complete its answer', () => {
  // Every window failure code, by the existing list (ledger.js RETRYABLE_JUDGE_CODES), never by its wording.
  assert.deepEqual([...WINDOW_FAILURE_CODES].sort(), [...JUDGE_FAILURE_CODES, 'unreviewed_scope'].sort());
  const rerun = WINDOW_FAILURE_CODES.filter((code) => windowRerunCanFinish(failed(code)));
  assert.deepEqual(rerun, ['model_unavailable', 'model_timeout', 'model_response_invalid']);
  assert.deepEqual(rerun, [...RETRYABLE_JUDGE_CODES]);
  // Every answered window's reason, by the existing list (session-review.js ANSWER_INCOMPLETE_REASONS, F226).
  const answered = WINDOW_INCOMPLETE_REASONS.filter((reason) => !reason.startsWith('narrative:'));
  for (const reason of answered) assert.deepEqual(windowIncompleteReasons(incomplete(reason)), [reason], reason);
  assert.deepEqual(answered.filter((reason) => windowRerunCanFinish(incomplete(reason))).sort(),
    [...ANSWER_INCOMPLETE_REASONS].sort());
  assert.deepEqual([...ANSWER_INCOMPLETE_REASONS].sort(),
    ['challenge:items_unresolved', 'challenge:votes_invalid', 'grounding:session']);
  // A window that finished, or a record that is not a window's, is none.
  assert.equal(windowRerunCanFinish({ windowIndex: 0, failure: null, groundingComplete: true,
    sessionGroundingComplete: true, relevanceComplete: true, challenge: { complete: true } }), false);
  assert.equal(windowRerunCanFinish(null), false);
});

test('D210: the code step waits while some window a rerun can finish is unfinished, unless the review saved before '
  + 'this run also left one so', () => {
  const report = (windows, unfinishedBefore) => ({ windowResults: windows,
    instrument: { resume: { attempt: 1, ...(unfinishedBefore ? { unfinishedBefore } : {}) } } });
  assert.equal(codeStepWaits(report([incomplete('grounding:relevance', 0)])), false, 'absent evidence: no rerun helps');
  assert.equal(codeStepWaits(report([failed('model_unavailable', 0)])), true);
  assert.equal(codeStepWaits(report([failed('model_unavailable', 0)], true)), false, 'two runs in a row: it runs');
  assert.equal(codeStepWaits(report([failed('unreviewed_scope', 0), failed('model_timeout', 1)])), true,
    'a window too large to send beside one a rerun can still finish: it waits');
  assert.equal(codeStepWaits(report([failed('unreviewed_scope', 0), failed('model_timeout', 1)], true)), false);
  assert.equal(codeStepWaits(report([failed('unreviewed_scope', 0), failed('invalid_model_input', 1)])), false);
  assert.equal(codeStepWaits(report([incomplete('challenge:votes_invalid', 2)])), true);
  assert.equal(codeStepWaits(report([incomplete('challenge:votes_invalid', 2)], true)), false);
  assert.equal(codeStepWaits(report([failed('model_unavailable', 0)], 'yes')), true, 'only true is the record');
  assert.equal(codeStepWaits({}), false);
  assert.equal(codeStepWaits(null), false);
  // What a run reads from the review saved before it: the same rule over that report's windows, whichever they were.
  assert.equal(sessionReviewRerunCanFinish(report([failed('model_timeout', 4)])), true);
  assert.equal(sessionReviewRerunCanFinish(report([failed('unreviewed_scope', 0)])), false);
  assert.equal(sessionReviewRerunCanFinish(null), false);
});

test('D210: the closed words: the gap, the first screen\'s reason, the coverage line and the run-state line', () => {
  assert.equal(CODE_STEP_WAITS_GAP, 'code_step_waits');
  assert.equal(GAP_CODES.at(-1), CODE_STEP_WAITS_GAP, 'the last member: every index before it keeps its place');
  assert.equal(GAP_HEADER_CAUSE.code_step_waits, 'other_gap', 'kept in the code pass\'s own record');
  assert.deepEqual(CODE_STEP_GATES, ['code_step_backend', 'code_step_waits']);
  assert.equal(CODE_NOT_REVIEWED_REASONS.at(-1), 'waits');
  const pass = { ran: false, gaps: [{ code: CODE_STEP_WAITS_GAP, channel: 'code', scope: 'repository' }],
    coverage: 'missing', files: [], required: false };
  assert.equal(codeNotReviewedOf(pass), 'waits');
  assert.equal(codeNotReviewedOf({ ...pass, gaps: [{ code: 'code_step_backend' }] }), 'backend', 'the backend as before');
  assert.equal(codeNotReviewedOf({ ...pass, gaps: [] }), 'no_folder', 'no gap: as before');
  assert.equal(notReviewedWordsOf(pass, 'waits'), 'No code was reviewed. Reason: a part of the session review did not '
    + 'finish, and a new run can finish it. Run the same command again, and the code review runs after the session '
    + 'review.');
  assert.deepEqual(codeCoverageLines(pass), [CODE_REPORT_WORDS.notRun.code_step_waits]);
  assert.equal(CODE_REPORT_WORDS.notRun.code_step_waits, 'The code review did not run yet. A part of the session review '
    + 'did not finish, and a new run can finish it. Run the same command again, and the code review runs after the '
    + 'session review.');
  assert.equal(CODE_STEP_WAITS_LINE, 'Code review: did not run yet. A part of the session review did not finish, and a '
    + 'new run can finish it. Run the same command again, and the code review runs after the session review.');
  assert.notEqual(CODE_STEP_WAITS_LINE, CODE_STEP_BACKEND_LINE);
  // The run-state line: the session review's cause, then the code step's words, never "add --code-pass".
  const line = runStateLine({ windowResults: [failed('model_unavailable')], codePass: pass });
  assert.ok(line.includes(`code review ${RUN_STATE_WORDS.codePass.waits}`), line);
  assert.ok(!line.includes(RUN_STATE_WORDS.codePassApart), line);
  assert.equal(RUN_STATE_WORDS.codePass.waits, 'did not run yet: it runs after the session review on the next run');
});

// ---- the review command, end to end ------------------------------------------------------------------------------------
/** One `sonah review` of the synthetic session (one window) in `dir`'s state folder. `narrative` says how the window's
 *  call ends: answered, or failed with a closed code (after the transport's one retry for a retryable code). */
async function review(t, dir, { narrative = 'answer', flags = ['--code-pass'], format = 'md', session = codeSession } = {}) {
  const root = dir.root ?? (dir.root = await repoWith(t));
  const home = join(dir.path, 'home'), file = join(dir.path, 'recording.jsonl'), state = join(dir.path, 'state');
  await mkdir(home, { recursive: true }); await writeFile(file, '{}\n');
  const output = join(dir.path, `story-${dir.runs = (dir.runs ?? 0) + 1}.md`);
  const judge = codeJudge();
  let out = '';
  const calls = [];
  const code = await runSessionReviewCommand([file, '--concurrency', '1', '--state-dir', state, '--format', format,
    '--output', output, '--no-open', ...flags], {
    stdout: { write: (text) => { out += text; } }, stderr: { write: () => {} }, cwd: root,
    env: { HOME: home, SONAH_HOME: join(home, '.sonah'), CODEX_HOME: join(home, 'codex'),
      SONAH_CLAUDE_PROJECTS: join(home, 'claude-projects') },
    installSignals: false, loadReviews: async () => new Map(), openPage: async () => {},
    loadSession: async () => ({ session: session(), hash: sha256('synthetic'), cwd: root }),
    createJudge: ({ onResult }) => async (request) => {
      calls.push(request.label);
      if (request.label === 'narrative:w1' && narrative !== 'answer') throw failure(narrative);
      onResult({ ok: true, backend: 'claude-cli', attestation: 'attested', contextWindow: 1_000_000,
        usage: { input_tokens: 10, output_tokens: 2 }, costUsd: 0.01 });
      return judge(request);
    } });
  const report = JSON.parse(await readFile(join(state, 'review', 'report.private.json'), 'utf8'));
  return { code, out, calls, report, md: await readFile(output, 'utf8'),
    codeCalls: calls.filter((label) => CODE_LABEL.test(label ?? '')).length };
}
async function folder(t) {
  const path = await mkdtemp(join(tmpdir(), 'sonah-d210-'));
  t.after(() => rm(path, { recursive: true, force: true }));
  return { path };
}

test('D210: a window whose call did not answer: the code step asks nothing, its record and every reader say that it runs '
  + 'after the session review on the next run, and the exit code is the session review\'s own', async (t) => {
  for (const flags of [['--code-pass'], []]) {
    const dir = await folder(t);
    const run = await review(t, dir, { narrative: 'model_unavailable', flags });
    const why = flags.join(' ') || 'the default';
    assert.deepEqual(run.calls, ['narrative:w1', 'narrative:w1'], `${why}: the window's call and its one retry, no more`);
    assert.equal(run.codeCalls, 0, why);
    const pass = run.report.codePass;
    assert.equal(pass.ran, false, why);
    assert.deepEqual(pass.gaps, [{ code: CODE_STEP_WAITS_GAP, channel: 'code', scope: 'repository' }], why);
    assert.equal(pass.coverage, 'missing', why);
    assert.equal(pass.required, flags.length > 0, why);
    assert.deepEqual(pass.answers, { calls: 0, reused: 0 }, why);
    assert.equal(run.report.instrument.resume.unfinishedBefore, undefined, `${why}: the first run of the review`);
    // The exit code: the session review did not finish, so the review is incomplete, as without the code step.
    assert.equal(run.code, 1, why);
    const { codePass, ...sessionOnly } = run.report;
    assert.equal(reviewExitCode(sessionOnly), run.code, `${why}: the session review's own`);
    // The terminal: where the code step would start, the run-state line and the first screen.
    const lines = run.out.split('\n');
    assert.ok(lines.includes(CODE_STEP_WAITS_LINE), why);
    const state = lines.find((l) => l.startsWith('Sonah\'s review: '));
    assert.ok(state.includes(`code review ${RUN_STATE_WORDS.codePass.waits}`), state);
    assert.ok(!state.includes('add --code-pass'), state);
    const reason = notReviewedWordsOf(pass, 'waits');
    assert.ok(run.out.includes(reason), why);
    // The report says the same.
    assert.ok(run.md.includes(reason), why);
    assert.ok(run.md.includes(CODE_REPORT_WORDS.notRun.code_step_waits), why);
  }
});

test('D210: the run that finishes the session review runs the code step once', async (t) => {
  const dir = await folder(t);
  const first = await review(t, dir, { narrative: 'model_timeout' });
  assert.equal(first.codeCalls, 0);
  const second = await review(t, dir);
  assert.equal(second.report.codePass.ran, true);
  assert.ok(second.codeCalls > 0, 'the code review ran');
  assert.ok(!second.out.includes(CODE_STEP_WAITS_LINE));
  assert.equal(second.code, 0, second.out);
  assert.equal(second.report.instrument.resume.unfinishedBefore, true, 'the run before left it unfinished');
});

test('D210: a session review that two runs in a row left unfinished holds nothing back: the code step runs, as before',
  async (t) => {
  // A git repository, so the code step's answers are keyed by its state and stored (answer-cache.js `agentAnswerKey`).
  const dir = { ...(await folder(t)), root: await gitRepoWith(t) };
  const first = await review(t, dir, { narrative: 'model_unavailable' });
  assert.equal(first.codeCalls, 0);
  const second = await review(t, dir, { narrative: 'model_unavailable' });
  assert.equal(second.report.instrument.resume.unfinishedBefore, true);
  assert.equal(second.report.codePass.ran, true);
  assert.ok(second.codeCalls > 0);
  assert.equal(second.code, 1, 'the session review did not finish');
  // And a third run asks no code-review call again: its answers are stored, the session review's report the same.
  const third = await review(t, dir, { narrative: 'model_unavailable' });
  assert.equal(third.report.instrument.resume.unfinishedBefore, true);
  assert.equal(third.report.codePass.ran, true);
  assert.equal(third.codeCalls, 0, 'replayed');
});

/** The synthetic session grown by `turns` turns appended at its end, each a person's message and the agent's final
 *  reply, as the agent's own session grows between runs of /sonah: the window that holds the end changes its bytes. */
function grown(turns) {
  const T1 = { turn: 'T1' };
  const blobs = { ...CODE_TEXT };
  const specs = [
    { id: 'I1', kind: 'instruction', blob: 'ask', ...T1 },
    { id: 'W1', kind: 'invocation', write: 'src/parse.js', blob: 'body', ...T1 },
    { id: 'W1-r', kind: 'observation', invocation: 'W1', blob: 'wrote', ...T1 },
    { id: 'C1', kind: 'commentary', blob: 'claim', ...T1 },
    { id: 'C2', kind: 'commentary', blob: 'final', phase: 'final', ...T1 },
  ];
  for (let n = 1; n <= turns; n++) {
    blobs[`more${n}`] = `SYNTHETIC_FOLLOWUP_${n}: anything else?`;
    blobs[`reply${n}`] = `SYNTHETIC_REPLY_${n}: nothing else.`;
    specs.push({ id: `I${n + 1}`, kind: 'instruction', blob: `more${n}`, turn: `T${n + 1}` },
      { id: `F${n}`, kind: 'commentary', blob: `reply${n}`, phase: 'final', turn: `T${n + 1}` });
  }
  return buildCodeSession('sess-d210-grown', blobs, specs);
}

test('D210\'s review: on a recording that grows between runs, a window that never answers holds the code review back '
  + 'once, never on every run', async (t) => {
  const dir = { ...(await folder(t)), root: await gitRepoWith(t) };
  const runs = [];
  for (let k = 0; k < 3; k++) runs.push(await review(t, dir, { narrative: 'model_timeout', flags: [], session: () => grown(k) }));
  assert.equal(runs[0].report.codePass.ran, false, 'the first run waits');
  assert.equal(runs[0].codeCalls, 0);
  for (const [at, run] of runs.entries()) {
    assert.equal(run.report.windowResults.length, 1, `premise: one window, run ${at + 1}`);
    assert.equal(run.report.windowResults[0].failure, 'model_timeout', `premise: run ${at + 1}`);
  }
  for (const run of runs.slice(1)) {
    assert.equal(run.report.instrument.resume.unfinishedBefore, true);
    assert.equal(run.report.codePass.ran, true, 'the run after runs the code review');
    assert.ok(run.codeCalls > 0, 'the recording grew, so its requests are new');
    assert.ok(!run.out.includes(CODE_STEP_WAITS_LINE));
  }
  // The guard is the run before, never once ever: after a run that finished the session review, a new failure waits.
  await review(t, dir, { flags: [], session: () => grown(3) });
  const again = await review(t, dir, { narrative: 'model_unavailable', flags: [], session: () => grown(4) });
  assert.equal(again.report.instrument.resume.unfinishedBefore, undefined);
  assert.equal(again.report.codePass.ran, false);
  assert.equal(again.codeCalls, 0);
});

test('D210\'s review: the review saved before is read under the lock, before this run saves its own', async (t) => {
  const dir = await folder(t);
  const store = createSessionReviewStore(join(dir.path, 'review'));
  assert.deepEqual(await store.readReport(), { report: null }, 'none yet');
  await store.prepare();
  await writeFile(join(dir.path, 'review', 'report.private.json'), '{"windowResults":[]', { mode: 0o600 });
  assert.deepEqual(await store.readReport(), { report: null }, 'not strict JSON: none');
  await store.saveReport({ windowResults: [failed('model_timeout')] });
  assert.equal(sessionReviewRerunCanFinish((await store.readReport()).report), true);
});

test('D210\'s review: with no change to review the code step asks nothing either way, so it does not wait and keeps its '
  + 'own reason', async (t) => {
  const T1 = { turn: 'T1' };
  const noWrite = () => buildCodeSession('sess-d210-nowrite', { ...CODE_TEXT }, [
    { id: 'I1', kind: 'instruction', blob: 'ask', ...T1 },
    { id: 'R1', kind: 'invocation', read: 'src/util.js', blob: 'readUtil', ...T1 },
    { id: 'R1-r', kind: 'observation', invocation: 'R1', blob: 'readOut', ...T1 },
    { id: 'C1', kind: 'commentary', blob: 'claim', ...T1 },
    { id: 'C2', kind: 'commentary', blob: 'final', phase: 'final', ...T1 },
  ]);
  for (const flags of [[], ['--code-pass']]) {
    const dir = { ...(await folder(t)), root: await gitRepoWith(t) };
    const run = await review(t, dir, { narrative: 'model_unavailable', flags, session: noWrite });
    const why = flags.join(' ') || 'the default';
    assert.equal(run.report.windowResults[0].failure, 'model_unavailable', `premise: ${why}`);
    assert.equal(run.codeCalls, 0, why);
    assert.ok(!run.report.codePass.gaps.some((g) => g.code === CODE_STEP_WAITS_GAP), why);
    assert.equal(codeNotReviewedOf(run.report.codePass), 'no_write', why);
    assert.ok(!run.out.includes(CODE_STEP_WAITS_LINE), why);
    assert.ok(!run.md.includes(CODE_REPORT_WORDS.notRun.code_step_waits), why);
    const reason = `No code was reviewed. Reason: ${CODE_REPORT_WORDS.notReviewedReasons.no_write}`;
    assert.ok(run.out.includes(notReviewedWordsOf(run.report.codePass, 'no_write')), why);
    assert.ok(run.md.includes(reason), why);
  }
});

test('D210: a window that a rerun cannot finish keeps today\'s behaviour: the code step runs on the first run', async (t) => {
  for (const code of ['invalid_model_input', 'model_output_limit', 'model_response_incomplete', 'model_tool_use']) {
    const dir = await folder(t);
    const run = await review(t, dir, { narrative: code });
    assert.equal(run.report.windowResults[0].failure, code, `premise: ${code}`);
    assert.equal(run.report.codePass.ran, true, code);
    assert.ok(run.codeCalls > 0, code);
    assert.ok(!run.out.includes(CODE_STEP_WAITS_LINE), code);
  }
});

test('D210: a budget stop ends the run before its report, so no code-review call starts', async (t) => {
  const dir = await folder(t);
  const root = dir.root = await repoWith(t);
  void root;
  const home = join(dir.path, 'home'), file = join(dir.path, 'recording.jsonl'), state = join(dir.path, 'state');
  await mkdir(home, { recursive: true }); await writeFile(file, '{}\n');
  const judge = codeJudge();
  const labels = [];
  let out = '';
  const code = await runSessionReviewCommand([file, '--concurrency', '1', '--state-dir', state, '--format', 'md',
    '--output', join(dir.path, 'story.md'), '--no-open', '--code-pass', '--max-calls', '1'], {
    stdout: { write: (text) => { out += text; } }, stderr: { write: () => {} }, cwd: dir.root,
    env: { HOME: home, SONAH_HOME: join(home, '.sonah'), CODEX_HOME: join(home, 'codex'),
      SONAH_CLAUDE_PROJECTS: join(home, 'claude-projects') },
    installSignals: false, loadReviews: async () => new Map(), openPage: async () => {},
    loadSession: async () => ({ session: codeSession(), hash: sha256('synthetic'), cwd: dir.root }),
    createJudge: ({ onResult }) => async (request) => {
      labels.push(request.label);
      onResult({ ok: true, backend: 'claude-cli', attestation: 'attested', contextWindow: 1_000_000 });
      return judge(request);
    } });
  assert.ok(out.includes('Review stopped where you asked (max_calls).'), out);
  assert.equal(labels.filter((label) => CODE_LABEL.test(label ?? '')).length, 0);
  assert.notEqual(code, 0);
});
