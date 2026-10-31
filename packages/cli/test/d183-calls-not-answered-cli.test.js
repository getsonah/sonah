// D183 (0.3.0-beta.11): the terminal's run-state line says why the session review did not finish, as the report's header
// does; and the footer's count of calls asked again is the run record's tries less its requests, which holds because
// the budget counts each try inside the answer store and the store counts each request. Synthetic records and judges;
// no model call.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runStateLine, RUN_STATE_WORDS, windowCompletionLine, runSessionReviewCommand } from '../src/session-review-command.js';
import { createReviewJudge } from '../src/review-judge.js';
import { codeNarrative, codeSession, sha256 } from './code-pass-fixture.js';
import { reportModel } from '../../render/report-model.js';
import { REPORT_HEADER_WORDS } from '../../render/report-words.js';
import { createReviewBudget } from '../src/review-budget.js';
import { memoizeJudge } from '../src/answer-cache.js';
import { boundedJudge } from '../src/session-review.js';

const W = (failure = null) => ({ windowIndex: 0, eventIds: ['I1'], failure, groundingComplete: failure === null,
  challenge: failure === null ? { complete: true } : null });
const report = (windowResults, sessionReview = 'incomplete') => ({ reviewScope: 'session-only', sessionReview,
  coverage: sessionReview === 'complete' ? 'complete' : 'partial', windowResults, findings: [] });
const sessionPart = (line) => /session review (.+?)\)/.exec(line)?.[1];

test('D183: the run-state line says why the session review did not finish, by its failed windows\' class', () => {
  assert.equal(sessionPart(runStateLine(report([W('model_unavailable'), W('model_timeout')]))), RUN_STATE_WORDS.session.no_answer);
  assert.equal(sessionPart(runStateLine(report([W('model_unavailable'), W()]))), RUN_STATE_WORDS.session.some_no_answer);
  assert.equal(sessionPart(runStateLine(report([W('budget_exhausted'), W('unreviewed_scope')]))),
    RUN_STATE_WORDS.session.not_sent);
  // Mixed classes, some unsent, an incomplete window that answered, an older record: "did not finish" alone. Its fix
  // round: and calls the judge refused on this computer after the budget counted their tries (bytes it cannot carry),
  // alone or beside others: never sent, yet counted as model calls. D190: a missing API key has its own cause (below).
  for (const windows of [[W('budget_exhausted'), W('model_unavailable')], [W('budget_exhausted'), W()],
    [{ ...W(), groundingComplete: false }], [(({ failure, ...w }) => w)(W())], [W('invalid_model_input')],
    [W('budget_exhausted'), W('invalid_model_input')]])
    assert.equal(sessionPart(runStateLine(report(windows))), RUN_STATE_WORDS.session.incomplete, JSON.stringify(windows));
  // D190: calls that failed for a missing API key say so, every window or some.
  assert.equal(sessionPart(runStateLine(report([W('anthropic_key_missing'), W('anthropic_key_missing')]))),
    RUN_STATE_WORDS.session.key_missing);
  assert.equal(sessionPart(runStateLine(report([W('anthropic_key_missing'), W()]))), RUN_STATE_WORDS.session.some_key_missing);
  assert.equal(sessionPart(runStateLine(report([W()], 'complete'))), RUN_STATE_WORDS.session.complete);
  assert.equal(runStateLine(report([W('model_unavailable')])), "Sonah's review: incomplete (pull request review did not run, "
    + 'session review did not finish, because its calls did not answer).');
  // The window line is unchanged.
  assert.equal(windowCompletionLine({ windows: 2, complete: 0, unexplained: 0,
    byReason: { 'narrative:model_unavailable': 2 } }), 'Windows complete: 0 of 2; incomplete: narrative:model_unavailable ×2');
});

test('D183: through the answer store, the budget\'s tries less the store\'s requests are the calls asked again', async () => {
  const budget = createReviewBudget({}, { now: () => 0 });
  const failsLeft = new Map([['A', 1], ['C', 2]]);
  const failure = (code) => Object.assign(new Error(code), { code });
  // The transport: A fails once and then answers, B answers, C fails twice (its retry fails too).
  const transport = async (request) => {
    const left = failsLeft.get(request.label) ?? 0;
    if (left > 0) { failsLeft.set(request.label, left - 1); throw failure('model_unavailable'); }
    return { label: request.label };
  };
  // As the CLI composes them: the store outside the bounded, retrying judge, the budget around the transport.
  const memo = memoizeJudge(boundedJudge(budget.wrap(transport), () => {}, {}), null);
  for (const label of ['A', 'B', 'C']) await memo({ label, system: 's', prompt: 'p' }).catch(() => null);
  const tries = budget.usageRecord().calls, requests = memo.answers.calls;
  assert.deepEqual([tries, requests], [5, 3]);
  assert.equal(tries - requests, 2, 'A once, C once');
  // A request the budget refuses before any try is a request with no try: the difference falls short. In the CLI that
  // refusal pauses the run (review-budget.js `pause`), which saves no report, so no footer says it.
  const capped = createReviewBudget({ maxCalls: 2 }, { now: () => 0 });
  failsLeft.set('A', 1);
  const memo2 = memoizeJudge(boundedJudge(capped.wrap(transport), () => {}, {}), null);
  for (const label of ['A', 'B']) await memo2({ label, system: 's', prompt: 'p' }).catch(() => null);
  assert.deepEqual([capped.usageRecord().calls, memo2.answers.calls], [2, 2], 'A retried once, B refused: 1 retry, 0 counted');
});

// D190 amends it: the cause is the missing key, said as calls that failed, beside a footer that counts their tries.
test('D183 (fix round), D190: a review with no API key, through the CLI: nothing was sent, tries were counted, the key is named', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'sonah-d183-nokey-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const home = join(dir, 'home');
  await mkdir(home, { recursive: true });
  const file = join(dir, 'recording.jsonl');
  await writeFile(file, '{}\n');
  let fetches = 0, stdout = '';
  await runSessionReviewCommand([file, '--no-code-pass', '--backend', 'anthropic-api', '--model', 'claude-sonnet-5-5',
    '--state-dir', join(dir, 'state'), '--concurrency', '1'], { stdout: { write: (text) => { stdout += text; return true; } },
    stderr: { write: () => true }, cwd: dir, env: { HOME: home, SONAH_HOME: join(home, '.sonah'), PATH: '/nonexistent' },
    installSignals: false, loadReviews: async () => new Map(), openPage: async () => {}, updateNotice: async () => null,
    loadSession: async () => ({ session: codeSession(), hash: sha256('synthetic'), cwd: dir }),
    createJudge: (options) => createReviewJudge({ ...options, fetchImpl: async () => { fetches++; throw new Error('no network'); } }) });
  const report = JSON.parse(await readFile(join(dir, 'state', 'review', 'report.private.json'), 'utf8'));
  assert.equal(fetches, 0, 'nothing left the computer');
  assert.ok(report.windowResults.length > 0);
  assert.ok(report.windowResults.every((w) => w.failure === 'anthropic_key_missing'));
  assert.ok(report.instrument.usage.calls > 0, 'premise: the budget counted the tries');
  assert.equal(sessionPart(runStateLine(report)), RUN_STATE_WORDS.session.key_missing);
  assert.ok(stdout.includes(`session review ${RUN_STATE_WORDS.session.key_missing})`));
  const model = reportModel(codeSession(), report, {});
  assert.deepEqual(model.header.reviewIncomplete, [REPORT_HEADER_WORDS.reviewIncomplete,
    REPORT_HEADER_WORDS.calls.key_missing]);
});

// D190 fix round: the key's cause reads each window's first call alone (its `failure`). A review resumed with no API key,
// whose window's first answer replays from the answer store and whose later calls fail for the key, has no failed window
// and says no cause; CHANGELOG and CONTRACTS say so. Run 1 (a stub judge) answers the first call and stops at
// --max-calls 1; run 2 (the review judge, no key, a fetch that throws) resumes it.
test('D190 (fix round): a resumed review whose later calls fail for the key names no cause, as its words say', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'sonah-d190-resume-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const home = join(dir, 'home');
  await mkdir(home, { recursive: true });
  const file = join(dir, 'recording.jsonl');
  await writeFile(file, '{}\n');
  const args = [file, '--no-code-pass', '--backend', 'anthropic-api', '--model', 'claude-sonnet-5-5',
    '--state-dir', join(dir, 'state'), '--concurrency', '1'];
  let stdout = '';
  const io = (key) => ({ stdout: { write: (text) => { stdout += text; return true; } }, stderr: { write: () => true },
    cwd: dir, env: { HOME: home, SONAH_HOME: join(home, '.sonah'), PATH: '/nonexistent', ANTHROPIC_API_KEY: key },
    installSignals: false, loadReviews: async () => new Map(), openPage: async () => {}, updateNotice: async () => null,
    loadSession: async () => ({ session: codeSession(), hash: sha256('synthetic'), cwd: dir }) });
  let answered = 0;
  const stub = (options) => async () => {
    answered++;
    options.onResult?.({ ok: true, attestation: 'unattested', contextWindow: null, servedModel: 'claude-sonnet-5-5' });
    return codeNarrative();
  };
  await runSessionReviewCommand([...args, '--max-calls', '1'], { ...io('test-key'), createJudge: stub });
  assert.equal(answered, 1, 'premise: run 1 answered the first call alone');
  stdout = '';
  let fetches = 0;
  await runSessionReviewCommand(args, { ...io(''), createJudge: (options) => createReviewJudge({ ...options,
    fetchImpl: async () => { fetches++; throw new Error('no network'); } }) });
  const report = JSON.parse(await readFile(join(dir, 'state', 'review', 'report.private.json'), 'utf8'));
  assert.equal(fetches, 0, 'nothing left the computer');
  assert.ok(report.instrument.answers.reused >= 1, 'premise: the first answer replayed');
  assert.ok(report.instrument.usage.calls > 0, 'premise: later calls were tried, and failed for the key');
  assert.ok(report.windowResults.length > 0 && report.windowResults.every((w) => w.failure === null),
    'premise: no window failed');
  assert.equal(report.sessionReview, 'incomplete');
  assert.equal(sessionPart(runStateLine(report)), RUN_STATE_WORDS.session.incomplete);
  assert.ok(stdout.includes(`session review ${RUN_STATE_WORDS.session.incomplete})`));
  assert.ok(!stdout.includes('ANTHROPIC_API_KEY'));
  assert.deepEqual(reportModel(codeSession(), report, {}).header.reviewIncomplete, [REPORT_HEADER_WORDS.reviewIncomplete]);
});
