// D129 (C7; the owner, 2026-10-22): every review prints and
// stores what it cost — its calls, its input tokens (uncached, written to the cache, read from the cache) and output
// tokens, the list cost the CLI states, its wall time, the code review's part of each, and how far each usage limit
// moved from its first reading to its last — in the run record (`report.instrument.usage`), on the terminal's usage
// line and in the report's footer. Counts and numbers from the CLI's own reporting only; no model call.
//
// Synthetic sessions, synthetic files and a deterministic fake reviewer: no recording, no model, no network.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runSessionReviewCommand } from '../src/session-review-command.js';
import { CODE_STEP_PART, REVIEW_USAGE_VERSION, createReviewBudget } from '../src/review-budget.js';
import { codeSession, codeJudge, repoWith, sha256 } from './code-pass-fixture.js';
import { reportModel } from '../../render/report-model.js';
import { sessionPage } from '../../render/session-page.js';
import { renderReportMarkdown } from '../../render/session-story.js';
import { REPORT_FOOTER_WORDS } from '../../render/report-words.js';

const CODE_LABEL = /^code-(?:review|verify|account)(?::|$)/;
const COST = 0.0125;

/** One `sonah review` of the synthetic session with the code step on or off. Each call reports usage with a cache
 *  split, a list cost and a rate-limit reading that rises by one point a call. */
async function review(t, { codeStep = true } = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'sonah-d129-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const root = await repoWith(t);
  const home = join(dir, 'home'), file = join(dir, 'recording.jsonl'), state = join(dir, 'state');
  await mkdir(home); await writeFile(file, '{}\n');
  const output = join(dir, 'story.md');
  const judge = codeJudge();
  let out = '', n = 0;
  const calls = [];
  const code = await runSessionReviewCommand([file, '--concurrency', '1', '--state-dir', state, '--format', 'md',
    '--output', output, '--no-open', codeStep ? '--code-pass' : '--no-code-pass'], {
    stdout: { write: (text) => { out += text; } }, stderr: { write: () => {} }, cwd: root,
    env: { HOME: home, SONAH_HOME: join(home, '.sonah'), CODEX_HOME: join(home, 'codex'),
      SONAH_CLAUDE_PROJECTS: join(home, 'claude-projects') },
    installSignals: false, loadReviews: async () => new Map(), openPage: async () => {},
    loadSession: async () => ({ session: codeSession(), hash: sha256('synthetic'), cwd: root }),
    createJudge: ({ config, onResult }) => async (request) => {
      n++;
      calls.push(request);
      onResult({ ok: true, backend: 'claude-cli', attestation: 'attested', contextWindow: 1_000_000,
        usage: { input_tokens: 10, cache_creation_input_tokens: 4, cache_read_input_tokens: 6, output_tokens: 2 },
        costUsd: COST, rateLimit: { status: 'allowed', rateLimitType: 'five_hour', utilization: null, resetsAt: null,
          windows: { five_hour: 0.10 + n / 100, seven_day: 0.30 } } });
      void config;
      return judge(request);
    } });
  const report = JSON.parse(await readFile(join(state, 'review', 'report.private.json'), 'utf8'));
  return { code, out, calls, report, md: await readFile(output, 'utf8') };
}

test('D129: the run record keeps what the review cost, its totals equal to the per-call sums the CLI reported, and the '
  + "code review's part apart", async (t) => {
  const run = await review(t);
  assert.equal(run.code, 0, run.out);
  const usage = run.report.instrument.usage;
  const all = run.calls.length, code = run.calls.filter((r) => CODE_LABEL.test(r.label)).length;
  assert.ok(all > code && code > 0, 'premise: the session review and the code review both made calls');
  assert.equal(usage.version, REVIEW_USAGE_VERSION);
  assert.deepEqual([usage.calls, usage.inputTokens, usage.inputReportedCalls, usage.outputTokens, usage.outputReportedCalls],
    [all, all * 20, all, all * 2, all]);
  assert.deepEqual(usage.inputSplit, { uncached: all * 10, cacheWrite: all * 4, cacheRead: all * 6, reportedCalls: all });
  assert.equal(usage.costUsd, Math.round(all * COST * 1e6) / 1e6);
  assert.equal(usage.costReportedCalls, all);
  assert.ok(Number.isSafeInteger(usage.wallMs) && usage.wallMs >= 0);
  // Each usage limit from its first reading to its last, as the calls reported them.
  assert.deepEqual(usage.windows, { five_hour: { first: 0.11, last: 0.10 + all / 100 }, seven_day: { first: 0.3, last: 0.3 } });
  // The code review's part: its own calls, tokens, cost and wall time.
  assert.deepEqual([usage.code.calls, usage.code.inputTokens, usage.code.outputTokens, usage.code.costReportedCalls],
    [code, code * 20, code * 2, code]);
  assert.deepEqual(usage.code.inputSplit, { uncached: code * 10, cacheWrite: code * 4, cacheRead: code * 6,
    reportedCalls: code });
  assert.ok(Number.isSafeInteger(usage.code.wallMs) && usage.code.wallMs <= usage.wallMs);
  // Counts and numbers only.
  assert.doesNotMatch(JSON.stringify(usage), /"[^"]*\s[^"]*"/, 'no value holds words');

  // The terminal's usage line says the same, the code review's part apart.
  const line = run.out.split('\n').find((l) => l.startsWith('Review usage:'));
  assert.ok(line.startsWith(`Review usage: ${all} calls; `), line);
  assert.ok(line.includes(`input tokens ${all * 20} (${all}/${all} calls reported: ${all * 10} uncached, ${all * 4} `
    + `written to the cache, ${all * 6} read from the cache)`), line);
  assert.ok(line.includes(`list cost $${(all * COST).toFixed(2)} (${all}/${all} calls reported)`), line);
  assert.ok(line.includes(`limits from first to last reading: five-hour 0.11 to ${(0.10 + all / 100).toFixed(2)}, `
    + 'seven-day 0.30 to 0.30.'), line);
  assert.ok(line.includes(` Code step: ${code} of these calls; `), line);

  // And the report's footer, in plain words.
  assert.ok(run.md.includes(`In this run, Sonah made ${all} model calls, and the code review made ${code} of them.`),
    'the footer names the calls');
  assert.ok(run.md.includes(`The calls used ${all * 20} input tokens and ${all * 2} output tokens in less than 1 minute.`));
  assert.ok(run.md.includes(`Your five-hour usage went from 11% to ${10 + all}% of its limit.`));
  assert.ok(run.md.includes('Your seven-day usage went from 30% to 30% of its limit.'));
});

test('D129: with the code step off, the session review\'s own record keeps the cost, with no code part', async (t) => {
  const run = await review(t, { codeStep: false });
  assert.equal(run.code, 0, run.out);
  const usage = run.report.instrument.usage;
  assert.equal(usage.calls, run.calls.length);
  assert.equal(usage.code, null);
  assert.doesNotMatch(run.out, /Code step/);
  assert.ok(run.md.includes(`In this run, Sonah made ${run.calls.length} model calls.`));
});

test('D129: the usage record by itself — the split, the cost, the readings, the code part, and what stays unreported',
  async () => {
    let clock = 0;
    const budget = createReviewBudget({}, { now: () => clock });
    const request = { system: 'S', prompt: 'P' };
    const send = (part, metadata) => budget.wrap(async () => { clock += 5; budget.record(metadata, part); return {}; },
      part)(request);
    await send(null, { usage: { input_tokens: 1, cache_creation_input_tokens: 2, cache_read_input_tokens: 3,
      output_tokens: 4 }, costUsd: 0.5, rateLimit: { windows: { seven_day: 0.2 } } });
    clock = 100;
    await send(CODE_STEP_PART, { usage: { input_tokens: 5, output_tokens: 1 }, costUsd: 0.25,
      rateLimit: { windows: { five_hour: 0.4, seven_day: 0.25 } } });
    await send(CODE_STEP_PART, { usage: null, costUsd: null });
    clock = 200;
    const usage = budget.usageRecord();
    assert.deepEqual(usage, { version: 'sonah.review-usage/1', calls: 3, inputBytes: 6, inputTokens: 11,
      inputReportedCalls: 2, inputSplit: { uncached: 6, cacheWrite: 2, cacheRead: 3, reportedCalls: 2 },
      outputTokens: 5, outputReportedCalls: 2, costUsd: 0.75, costReportedCalls: 2, reportedCalls: 3, agentCalls: 0,
      turns: 0, wallMs: 200, windows: { five_hour: { first: 0.4, last: 0.4 }, seven_day: { first: 0.2, last: 0.25 } },
      code: { calls: 2, inputBytes: 4, inputTokens: 5, inputReportedCalls: 1,
        inputSplit: { uncached: 5, cacheWrite: 0, cacheRead: 0, reportedCalls: 1 }, outputTokens: 1,
        outputReportedCalls: 1, costUsd: 0.25, costReportedCalls: 1, wallMs: 10 } });
    // The Codex CLI's input already holds what it read from its cache: no split, the total as before.
    const codex = createReviewBudget();
    await codex.wrap(async () => { codex.record({ backend: 'codex-cli', usage: { input_tokens: 9, output_tokens: 1,
      cache_read_input_tokens: 4 } }); return {}; })(request);
    assert.deepEqual([codex.usageRecord().inputTokens, codex.usageRecord().inputSplit], [9, null]);
    // Nothing reported: null, never 0; no call: 0.
    const none = createReviewBudget();
    await none.wrap(async () => { none.record({}); return {}; })(request);
    assert.deepEqual([none.usageRecord().inputTokens, none.usageRecord().costUsd, none.usageRecord().windows,
      none.usageRecord().code], [null, null, null, null]);
    assert.deepEqual([createReviewBudget().usageRecord().inputTokens, createReviewBudget().usageRecord().costUsd], [0, 0]);
  });

test('D129: the footer reads the run record by counts alone, and an earlier report with none says nothing of cost', () => {
  const footer = (usage) => reportModel(null, { windowResults: [], instrument: { usage } }, {}).footer.usage;
  assert.equal(footer(undefined), null);
  assert.equal(footer({ version: 'sonah.review-usage/0', calls: 1, wallMs: 1 }), null, 'another version is not read');
  assert.equal(footer({ version: 'sonah.review-usage/1', calls: 'x', wallMs: 1 }), null);
  // Tokens are said only when every call reported them; a limit only by its closed name and as a fraction of it.
  assert.equal(footer({ version: 'sonah.review-usage/1', calls: 2, wallMs: 120_000, inputTokens: 5,
    inputReportedCalls: 1, outputTokens: 1, outputReportedCalls: 2, code: null,
    windows: { five_hour: { first: 0.5, last: 0.6 }, SECRET: { first: 0, last: 1 }, seven_day: { first: 'x', last: 1 } } }),
  'In this run, Sonah made 2 model calls. The calls took 2 minutes. Your five-hour usage went from 50% to 60% of its limit.');
  assert.equal(footer({ version: 'sonah.review-usage/1', calls: 0, wallMs: 10 }), REPORT_FOOTER_WORDS.usage({ calls: 0,
    wallMs: 10 }));
});

test('D129: the page and the .md say the cost right after the line that names Sonah, and nothing when the record has '
  + 'none', () => {
  const usage = { version: 'sonah.review-usage/1', calls: 3, wallMs: 90_000, inputTokens: 60, inputReportedCalls: 3,
    outputTokens: 6, outputReportedCalls: 3, code: { calls: 1 }, windows: { seven_day: { first: 0.2, last: 0.21 } } };
  const words = 'In this run, Sonah made 3 model calls, and the code review made 1 of them. The calls used 60 input '
    + 'tokens and 6 output tokens in 2 minutes. Your seven-day usage went from 20% to 21% of its limit.';
  const report = { windowResults: [], instrument: { usage } };
  const page = sessionPage(codeSession(), report, { sonahVersion: '0.9.0' }).html;
  assert.ok(page.includes(`<p class="gen">Sonah 0.9.0 · sonah.report-model/7</p><p>${words}</p>`));
  const md = renderReportMarkdown(codeSession(), report, { sonahVersion: '0.9.0' });
  assert.ok(md.includes(`Sonah 0.9.0 · sonah.report-model/7  \n${words}  \n`));
  const none = { windowResults: [] };
  assert.doesNotMatch(sessionPage(codeSession(), none, { sonahVersion: '0.9.0' }).html, /In this run/);
  assert.doesNotMatch(renderReportMarkdown(codeSession(), none, { sonahVersion: '0.9.0' }), /In this run/);
});

/** D129's review: runs of `sonah review` on one state folder, each with its own transport (`fail`: a request whose
 *  answer comes from a model the CLI does not attest, which stops the run with `model_unavailable`). */
async function reviews(t, { codeStep = true } = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'sonah-d129-runs-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const root = await repoWith(t);
  const home = join(dir, 'home'), file = join(dir, 'recording.jsonl'), state = join(dir, 'state');
  await mkdir(home); await writeFile(file, '{}\n');
  const judge = codeJudge();
  let runs = 0;
  const run = async (extra = [], { fail = () => false } = {}) => {
    let out = '';
    const calls = [];
    const code = await runSessionReviewCommand([file, '--concurrency', '1', '--state-dir', state, '--format', 'md',
      '--output', join(dir, `story-${++runs}.md`), '--no-open', codeStep ? '--code-pass' : '--no-code-pass', ...extra], {
      stdout: { write: (text) => { out += text; } }, stderr: { write: () => {} }, cwd: root,
      env: { HOME: home, SONAH_HOME: join(home, '.sonah'), CODEX_HOME: join(home, 'codex'),
        SONAH_CLAUDE_PROJECTS: join(home, 'claude-projects') },
      installSignals: false, loadReviews: async () => new Map(), openPage: async () => {},
      loadSession: async () => ({ session: codeSession(), hash: sha256('synthetic'), cwd: root }),
      createJudge: ({ onResult }) => async (request) => {
        calls.push(request);
        onResult({ ok: true, backend: 'claude-cli', attestation: fail(request) ? 'unattested' : 'attested',
          contextWindow: 1_000_000, usage: { input_tokens: 10, output_tokens: 2 }, costUsd: COST });
        return judge(request);
      } });
    return { code, out, calls };
  };
  const stored = async () => JSON.parse(await readFile(join(state, 'review', 'usage.private.json'), 'utf8'));
  return { run, stored, state, dir };
}

test('D129\'s review: each run keeps what it cost however it ended — stopped at a budget, resumed, replayed — and a '
  + 'replay never replaces the cost of the run that made the calls', async (t) => {
  const box = await reviews(t, { codeStep: false });
  // A run stopped at --max-calls saves no report; what it cost is kept all the same.
  const stopped = await box.run(['--max-calls', '2']);
  assert.match(stopped.out, /Review stopped where you asked \(max_calls\)/);
  let stored = await box.stored();
  assert.equal(stored.schema, 'sonah.review-usage-runs/1');
  assert.equal(stored.runs.length, 1);
  assert.deepEqual([stored.runs[0].usage.version, stored.runs[0].usage.calls, stored.runs[0].usage.inputTokens,
    stored.runs[0].paused], [REVIEW_USAGE_VERSION, stopped.calls.length, stopped.calls.length * 10, 'max_calls']);
  assert.ok(stopped.calls.length > 0);
  // The resumed run finishes, and keeps its own cost beside the first run's.
  const resumed = await box.run();
  assert.equal(resumed.code, 0, resumed.out);
  stored = await box.stored();
  assert.deepEqual(stored.runs.map((r) => [r.usage.calls, r.paused, r.failure]),
    [[stopped.calls.length, 'max_calls', 'review_interrupted'], [resumed.calls.length, null, null]]);
  // A replay of the finished review makes no call; the report says its own 0, and the calls before it are still kept.
  const replay = await box.run();
  assert.equal(replay.calls.length, 0);
  const report = JSON.parse(await readFile(join(box.state, 'review', 'report.private.json'), 'utf8'));
  assert.equal(report.instrument.usage.calls, 0);
  stored = await box.stored();
  assert.deepEqual(stored.runs.map((r) => r.usage.calls), [stopped.calls.length, resumed.calls.length, 0]);
  assert.equal(stored.runs.reduce((n, r) => n + r.usage.calls, 0), stopped.calls.length + resumed.calls.length);
  assert.doesNotMatch(JSON.stringify(stored), /"[^"]*\s[^"]*"/, 'no value holds words');
  // D132 (R3 b): the footer of a resumed or replayed review gives the whole review's cost, over the runs its state folder
  // keeps that made calls (D132's review, finding 4: a replay of stored answers is not counted) and that asked with this
  // run's backend, model and code model, each kept with its cost: the calls and the tokens summed, never the run's own
  // alone; no list cost (FOOTER_LIST_COST).
  assert.ok(stored.runs.every((r) => r.identity?.backend === 'claude-cli' && typeof r.identity.model === 'string'
    && r.identity.codeModel === null), JSON.stringify(stored.runs.map((r) => r.identity)));
  const story = (k) => readFile(join(box.dir, `story-${k}.md`), 'utf8');
  const all = stopped.calls.length + resumed.calls.length;
  const resumedMd = await story(2), replayMd = await story(3);
  assert.ok(resumedMd.includes(`Over its 2 runs, this review made ${all} model calls. The calls used ${all * 10} input `
    + `tokens and ${all * 2} output tokens in less than 1 minute.`), resumedMd.slice(-900));
  assert.ok(replayMd.includes(`Over its 2 runs, this review made ${all} model calls.`), replayMd.slice(-900));
  for (const text of [resumedMd, replayMd]) {
    assert.doesNotMatch(text, /In this run/);
    assert.doesNotMatch(text, /\$\d/, 'no list cost in the footer');
  }
  // Runs that asked with another backend or model, or that kept no identity, share no answers: not summed.
  const file = join(box.state, 'review', 'usage.private.json');
  const kept = JSON.parse(await readFile(file, 'utf8'));
  kept.runs[0].identity = { ...kept.runs[0].identity, model: 'another-model' };
  delete kept.runs[1].identity;
  await writeFile(file, JSON.stringify(kept), { mode: 0o600 });
  await box.run();
  assert.match(await story(4), /In this run, Sonah made no model calls\./);
});

test('D129\'s review: a run that fails in its code step keeps what it cost, the call it failed on included, with its '
  + 'failure', async (t) => {
    const box = await reviews(t);
    const failed = await box.run([], { fail: (request) => CODE_LABEL.test(request.label ?? '') });
    assert.equal(failed.code, 3, failed.out);
    // The session review's saved report holds no cost (the code step's record would have); the run's record does.
    const report = JSON.parse(await readFile(join(box.state, 'review', 'report.private.json'), 'utf8'));
    assert.equal(report.instrument.usage, undefined);
    const [only, ...more] = (await box.stored()).runs;
    assert.deepEqual(more, []);
    assert.deepEqual([only.usage.calls, only.failure, only.paused], [failed.calls.length, 'model_unavailable', null]);
    assert.equal(only.usage.code.calls, failed.calls.filter((r) => CODE_LABEL.test(r.label)).length);
    // A record that cannot be read is moved aside, never deleted, and the next run begins a new one.
    await writeFile(join(box.state, 'review', 'usage.private.json'), '{"schema":"other"}', { mode: 0o600 });
    await box.run();
    assert.equal((await box.stored()).runs.length, 1);
    assert.equal(await readFile(join(box.state, 'review', '.discarded', 'usage.private.json.0'), 'utf8'),
      '{"schema":"other"}');
  });
