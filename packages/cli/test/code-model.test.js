// `sonah review --code-pass --code-model ID` (and SONAH_CODE_MODEL): the code step on a model of its own, the session on
// its own. The flag; which judge each request reaches; the session's requests and stored answers, byte for byte as they
// were; the default, the session's model; the code step's served model attested as the session's is; and a stored
// code-step answer never replayed for another model.
//
// Synthetic sessions, synthetic files and a deterministic fake reviewer: no recording, no model, no network.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { codeModelOf, parseSessionReviewArgs, replayLines, runSessionReviewCommand, sessionReviewUsage }
  from '../src/session-review-command.js';
import { CODE_STEP_PART, createReviewBudget } from '../src/review-budget.js';
import { writeCodePass } from '../src/settings.js';
import { SESSION_REVIEW_CLAUDE_CLI_MODEL } from '../../evidence/src/run-review.js';
import { codeSession, codeJudge, gitRepoWith, repoWith, sha256 } from './code-pass-fixture.js';

// F3b (D111): the accounting's calls are the code step's too.
const CODE_LABEL = /^code-(?:review|verify|account)(?::|$)/;
const SESSION_MODEL = SESSION_REVIEW_CLAUDE_CLI_MODEL;
const OPUS = 'claude-opus-5-5[1m]';
const OTHER = 'claude-opus-5-1[1m]';
const strip = (report) => {
  const { codePass: _pass, ...rest } = report;
  return JSON.parse(JSON.stringify(rest, (key, value) => (key === 'codeCheck' ? undefined : value)));
};
/** The session's requests, as their bytes, sorted: one lane does not fix the order of a challenge's passes, which start
 *  together and each read the answer store first, so under load p3 can be sent before p2 (lean-default.test.js). */
const sessionRequests = (calls) => calls.filter(({ request }) => !CODE_LABEL.test(request.label))
  .map(({ request }) => JSON.stringify([request.label, request.system, request.prompt])).sort();
const codeRequests = (calls) => calls.filter(({ request }) => CODE_LABEL.test(request.label));

/** The context window the fake transport reports for a requested model: its selector's, else the CLI's default. */
const windowOf = (model) => (model.endsWith('[1m]') ? 1_000_000 : 200_000);

/**
 * One `sonah review` run on the synthetic session, its files under `root`, its state under `state`. Every judge the
 * command makes is recorded by the model its settings name (`judges`), and every request by the judge it reached
 * (`calls`: `{ model, request }`). `served(model, request)` may change what the fake transport reports of a call.
 */
async function review(t, { root, state, argv = [], env = {}, served = () => ({}) } = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'sonah-code-model-run-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const home = join(dir, 'home'), file = join(dir, 'recording.jsonl');
  await mkdir(home); await writeFile(file, '{}\n');
  const output = join(dir, 'story.md');
  const judge = codeJudge();
  let out = '', err = '';
  const judges = [], calls = [];
  const code = await runSessionReviewCommand([file, '--concurrency', '1', '--state-dir', state, '--format', 'md',
    '--output', output, '--no-open', ...argv], {
    stdout: { write: (text) => { out += text; } }, stderr: { write: (text) => { err += text; } }, cwd: root,
    env: { HOME: home, SONAH_HOME: join(home, '.sonah'), CODEX_HOME: join(home, 'codex'),
      SONAH_CLAUDE_PROJECTS: join(home, 'claude-projects'), ...env },
    installSignals: false, loadReviews: async () => new Map(), openPage: async () => {},
    loadSession: async () => ({ session: codeSession(), hash: sha256('synthetic'), cwd: root }),
    createJudge: ({ config, onResult }) => {
      judges.push(config.model);
      return async (request) => {
        calls.push({ model: config.model, request });
        onResult({ ok: true, backend: 'claude-cli', attestation: 'attested', contextWindow: windowOf(config.model),
          usage: { input_tokens: 10, output_tokens: 2 }, ...served(config.model, request) });
        return judge(request);
      };
    } });
  const report = JSON.parse(await readFile(join(state, 'review', 'report.private.json'), 'utf8').catch(() => 'null'));
  return { code, out, err, judges, calls, report };
}

async function stateDir(t) {
  const dir = await mkdtemp(join(tmpdir(), 'sonah-code-model-state-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return join(dir, 'state');
}

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

test('--code-model: parsed once, whenever the code step may run, listed, and every other option as it was', () => {
  assert.equal(parseSessionReviewArgs(['--code-pass', '--code-model', OPUS]).codeModel, OPUS);
  assert.equal(parseSessionReviewArgs(['--code-model', OPUS, '--code-pass']).codeModel, OPUS);
  assert.equal(Object.hasOwn(parseSessionReviewArgs(['--code-pass']), 'codeModel'), false);
  const { codeModel: _set, ...rest } = parseSessionReviewArgs(['--code-pass', '--code-model', OPUS, '--dry-run']);
  assert.deepEqual(rest, parseSessionReviewArgs(['--code-pass', '--dry-run']));
  // The code step is on by default (or by the setting), so --code-model needs no --code-pass; only a review that turns
  // the step off on its own command line has no use for it.
  assert.equal(parseSessionReviewArgs(['--code-model', OPUS]).codeModel, OPUS);
  assert.throws(() => parseSessionReviewArgs(['--code-model', OPUS, '--no-code-pass']),
    { code: 'usage', problem: '--code-model is not used with --no-code-pass' });
  assert.throws(() => parseSessionReviewArgs(['--no-code-pass', '--code-model', OPUS]),
    { code: 'usage', problem: '--code-model is not used with --no-code-pass' });
  assert.throws(() => parseSessionReviewArgs(['--code-pass', '--code-model', OPUS, '--code-model', OTHER]),
    { code: 'usage', problem: '--code-model is given twice' });
  assert.throws(() => parseSessionReviewArgs(['--code-pass', '--code-model']), { code: 'usage', problem: '--code-model needs a value' });
  assert.throws(() => parseSessionReviewArgs(['--code-pass', '--code-model', '--dry-run']), { code: 'usage' });
  assert.match(sessionReviewUsage, /^ {2}--code-model ID {10}the reviewer's model for the code review only, when$/m);
  assert.ok(sessionReviewUsage.split('\n').every((line) => line.length <= 80));
  // The flag, else SONAH_CODE_MODEL, whenever the code step runs, whatever turned it on; neither when it does not run.
  for (const source of ['flag', 'config', 'default']) {
    const on = { on: true, source };
    assert.equal(codeModelOf(on, { codeModel: OPUS }, { SONAH_CODE_MODEL: OTHER }), OPUS, source);
    assert.equal(codeModelOf(on, {}, { SONAH_CODE_MODEL: OTHER }), OTHER, source);
    assert.equal(codeModelOf(on, {}, {}), null, source);
    assert.equal(codeModelOf({ on: false, source }, { codeModel: OPUS }, { SONAH_CODE_MODEL: OTHER }), null, source);
  }
});

test('--code-model: every code-step request reaches the code model\'s judge, every session request the session\'s', async (t) => {
  const root = await repoWith(t);
  const run = await review(t, { root, state: await stateDir(t), argv: ['--code-pass', '--code-model', OPUS] });
  assert.equal(run.code, 0, run.err);
  assert.deepEqual(run.judges, [SESSION_MODEL, OPUS], 'one judge for the session, one for the code step');
  const code = codeRequests(run.calls);
  const session = run.calls.filter(({ request }) => !CODE_LABEL.test(request.label));
  assert.ok(session.length > 0 && code.length > 0);
  assert.deepEqual([...new Set(session.map(({ model }) => model))], [SESSION_MODEL]);
  assert.deepEqual([...new Set(code.map(({ model }) => model))], [OPUS]);
  // The review agent, the checking agent of its finding and (F3b, D111) the accounting agent all went to it.
  assert.deepEqual(code.map(({ request }) => request.label), ['code-review:agent', 'code-verify:F1', 'code-account:1']);
  // The report records the code step's model; the usage line names it, with its share of the calls.
  assert.equal(run.report.codePass.model, OPUS);
  const usage = new RegExp(`^Review usage: ${run.calls.length} calls; .* Code step on ${OPUS.replace(/[[\]]/g, '\\$&')} `
    + `\\(the session on ${SESSION_MODEL.replace(/[[\]]/g, '\\$&')}\\): ${code.length} of these calls; \\d+ input bytes; `
    + `input tokens ${code.length * 10} \\(${code.length}/${code.length} calls reported\\); `
    + `output tokens ${code.length * 2} \\(${code.length}/${code.length} calls reported\\)\\.$`, 'm');
  assert.match(run.out, usage);
});

test('--code-model: the code step\'s served model is attested as the session\'s is, against its own model', async (t) => {
  const root = await repoWith(t);
  // A code-step call served without the 1M window its model selects, or unattested: the review fails, nothing is kept
  // of the code step, and the session part was never sent to the code model.
  for (const served of [(model) => (model === OPUS ? { contextWindow: 200_000 } : {}),
    (model) => (model === OPUS ? { attestation: 'unattested' } : {})]) {
    const run = await review(t, { root, state: await stateDir(t), argv: ['--code-pass', '--code-model', OPUS], served });
    assert.equal(run.code, 3);
    assert.match(run.err, /Review could not complete: model_unavailable\./);
    assert.ok(codeRequests(run.calls).length >= 1);
    assert.equal(run.report?.codePass, undefined, 'no code pass is saved');
    assert.ok(run.calls.filter(({ model }) => model === OPUS).every(({ request }) => CODE_LABEL.test(request.label)));
  }
  // A code model whose served model could never be attested (an alias, with or without the selector) is refused before
  // any call, as `--model` is.
  for (const alias of ['opus', 'sonnet[1m]', 'claude-opus-latest']) {
    const run = await review(t, { root, state: await stateDir(t), argv: ['--code-pass', '--code-model', alias] });
    assert.equal(run.code, 2, alias);
    assert.match(run.err, /Review could not complete: invalid_model\./);
    assert.deepEqual(run.calls, []);
  }
  // The same ids `--model` accepts: a full id without the selector, whose window is the CLI's default.
  const plain = await review(t, { root, state: await stateDir(t), argv: ['--code-pass', '--code-model', 'claude-opus-5-5'] });
  assert.equal(plain.code, 0, plain.err);
  assert.deepEqual(plain.judges, [SESSION_MODEL, 'claude-opus-5-5']);
});

test('--code-model: the session\'s requests are byte-identical, and an existing state replays them with no call', async (t) => {
  const root = await repoWith(t);
  const off = await review(t, { root, state: await stateDir(t), argv: ['--code-pass'] });
  const on = await review(t, { root, state: await stateDir(t), argv: ['--code-pass', '--code-model', OPUS] });
  assert.equal(off.code, 0); assert.equal(on.code, 0);
  assert.ok(sessionRequests(off.calls).length > 0);
  assert.deepEqual(sessionRequests(on.calls), sessionRequests(off.calls), 'the session requests, byte for byte');
  // The code step asks the same bytes too; only the model it asks differs.
  const bytes = (calls) => codeRequests(calls).map(({ request }) => JSON.stringify([request.label, request.system,
    request.prompt]));
  assert.deepEqual(bytes(on.calls), bytes(off.calls));
  assert.deepEqual(strip(on.report), strip(off.report), 'the session report as it was');
  const { model, answers: _a, ...pass } = on.report.codePass;
  const { answers: _b, ...before } = off.report.codePass;
  assert.equal(model, OPUS);
  assert.deepEqual(pass, before, 'the code pass as it was, but for the model it records');

  // An existing state, reviewed without the code pass on the session's model: the code-model run replays every session
  // answer (no call to either model for the session), and only the code step is sent, to the code model.
  const state = await stateDir(t);
  const first = await review(t, { root, state, argv: ['--no-code-pass'] });
  assert.equal(first.code, 0);
  const second = await review(t, { root, state, argv: ['--code-pass', '--code-model', OPUS] });
  assert.equal(second.code, 0, second.err);
  assert.deepEqual(sessionRequests(second.calls), [], 'the session part makes no call');
  assert.match(second.out, /^Model answers: (\d+) of \1 reused \(no call\)\.$/m);
  assert.ok(second.calls.length > 0 && second.calls.every(({ model: m }) => m === OPUS));

  // The dry run on such a state: the stored session answers would all be reused, the code step's requests would go to
  // the code model; no call, nothing written.
  const dryState = await stateDir(t);
  assert.equal((await review(t, { root, state: dryState, argv: ['--no-code-pass'] })).code, 0);
  const before2 = await listing(dryState);
  const dry = await review(t, { root, state: dryState, argv: ['--dry-run', '--code-pass', '--code-model', OPUS] });
  assert.equal(dry.code, 0);
  assert.deepEqual(dry.calls, []);
  assert.deepEqual(dry.judges, [], 'a dry run makes no judge');
  assert.match(dry.out, /^Stored session answers: the store answers (\d+) of \1 session calls, with no new call\.$/m);
  assert.match(dry.out, /^Code review: it would first send 1 call \(code-review:agent \d+ KB\) to claude-opus-5-5\[1m\]\. Then it would send one check for each finding and one for its questions\. Each 30 items would add one more call, at most 4\. The items are asks, statements that the agent wrote into a file and the agent's decisions not to act\.$/m);
  assert.deepEqual(await listing(dryState), before2, 'the dry run wrote nothing');
  // A code model that could not be attested: the dry run says the settings could not be read, and sends nothing.
  const refused = await review(t, { root, state: dryState, argv: ['--dry-run', '--code-pass', '--code-model', 'opus'] });
  assert.match(refused.out, /^Stored session answers: not counted, because Sonah could not read the settings of the reviewer\./m);
  assert.deepEqual(refused.calls, []);
});

test('--code-model default: no flag and no SONAH_CODE_MODEL is the session\'s model, on a judge of its own; the variable sets it', async (t) => {
  const root = await repoWith(t);
  const plain = await review(t, { root, state: await stateDir(t), argv: ['--code-pass'] });
  assert.equal(plain.code, 0);
  // The agentic code step always gets its own agent-capable judge, here on the session's model.
  assert.deepEqual(plain.judges, [SESSION_MODEL, SESSION_MODEL], 'the session\'s judge, then the code step\'s');
  assert.ok(codeRequests(plain.calls).length > 0 && plain.calls.every(({ model }) => model === SESSION_MODEL));
  assert.equal(Object.hasOwn(plain.report.codePass, 'model'), false, 'the report as before');
  assert.doesNotMatch(plain.out, /Code step on/);
  assert.match(plain.out, /^Review usage: \d+ calls; [^\n]*; utilization not reported\.$/m);
  // SONAH_CODE_MODEL, with --code-pass: the code step on that model; the flag wins over it.
  const fromEnv = await review(t, { root, state: await stateDir(t), argv: ['--code-pass'], env: { SONAH_CODE_MODEL: OPUS } });
  assert.equal(fromEnv.code, 0);
  assert.deepEqual(fromEnv.judges, [SESSION_MODEL, OPUS]);
  assert.deepEqual([...new Set(codeRequests(fromEnv.calls).map(({ model }) => model))], [OPUS]);
  assert.equal(fromEnv.report.codePass.model, OPUS);
  const flagWins = await review(t, { root, state: await stateDir(t), argv: ['--code-pass', '--code-model', OTHER],
    env: { SONAH_CODE_MODEL: OPUS } });
  assert.deepEqual(flagWins.judges, [SESSION_MODEL, OTHER]);
  // With the code step off (--no-code-pass, or the setting), SONAH_CODE_MODEL changes nothing: one judge, no code step.
  const noPass = await review(t, { root, state: await stateDir(t), argv: ['--no-code-pass'],
    env: { SONAH_CODE_MODEL: OPUS } });
  assert.equal(noPass.code, 0);
  assert.deepEqual(noPass.judges, [SESSION_MODEL]);
  assert.deepEqual(codeRequests(noPass.calls), []);
  assert.doesNotMatch(noPass.out, /Code review: on/);
  // The dry run's code-step line names no model without one.
  const lines = replayLines({ answers: { calls: 0, reused: 3 }, codeRequests: [{ label: 'code-review:agent', bytes: 2048 }] });
  // F3b (D111): and the accounting's calls, counted by the items in scope, each kind named (its review).
  assert.equal(lines[1], 'Code review: it would first send 1 call (code-review:agent 2 KB). Then it would send one check '
    + 'for each finding and one for its questions. Each 30 items would add one more call, at most 4. The items are asks, '
    + 'statements that the agent wrote into a file and the agent\'s decisions not to act.');
});

test('--code-model: a stored code-step answer is never replayed for another model, and is for the same one', async (t) => {
  // A git repository: its state keys the code step's stored answers, so the replay below holds once the transport
  // stores an agent's answer only with a known state.
  const root = await gitRepoWith(t);
  const state = await stateDir(t);
  const first = await review(t, { root, state, argv: ['--code-pass', '--code-model', OPUS] });
  assert.equal(first.code, 0);
  const asked = codeRequests(first.calls).length;
  assert.ok(asked > 0);
  // Another code model on the same state: the session part is replayed, and every code-step request is asked again.
  for (const argv of [['--code-pass', '--code-model', OTHER], ['--code-pass']]) {
    const other = await review(t, { root, state, argv });
    assert.equal(other.code, 0);
    assert.deepEqual(sessionRequests(other.calls), [], 'the session part makes no call');
    assert.equal(codeRequests(other.calls).length, asked, argv.join(' '));
    assert.match(other.out, new RegExp(`^Code review answers: 0 of ${asked} reused \\(no call\\)\\.$`, 'm'));
  }
  // The first model again: every answer it gave is reused, and nothing at all is asked.
  const again = await review(t, { root, state, argv: ['--code-pass', '--code-model', OPUS] });
  assert.equal(again.code, 0);
  assert.deepEqual(again.calls, []);
  assert.match(again.out, new RegExp(`^Code review answers: ${asked} of ${asked} reused \\(no call\\)\\.$`, 'm'));
  assert.equal(again.report.codePass.model, OPUS);
});

test('--code-model usage line: the code step\'s share counted apart; without a code model the line is as before', async () => {
  const request = { system: 'ab', prompt: 'cd' };
  const run = async (budget) => {
    await budget.wrap(async () => { budget.record({ usage: { input_tokens: 7, output_tokens: 1 } }); return {}; })(request);
    await budget.wrap(async () => { budget.record({ usage: { input_tokens: 5, output_tokens: 3 } }, CODE_STEP_PART); return {}; },
      CODE_STEP_PART)(request);
    await budget.wrap(async () => { budget.record({ usage: null }, CODE_STEP_PART); return {}; }, CODE_STEP_PART)(request);
    return budget;
  };
  const clock = () => 0;
  const budget = await run(createReviewBudget({}, { now: clock }));
  const before = 'Review usage: 3 calls; 12 input bytes; input tokens 12 (2/3 calls reported); output tokens 4 '
    + '(2/3 calls reported); wall 0 ms; utilization not reported.';
  assert.equal(budget.summaryLine(), before);
  assert.equal(budget.summaryLine({}), before);
  assert.equal(budget.summaryLine({ codeModel: OPUS, sessionModel: SESSION_MODEL }), `${before} Code step on ${OPUS} `
    + `(the session on ${SESSION_MODEL}): 2 of these calls; 8 input bytes; input tokens 5 (1/2 calls reported); `
    + 'output tokens 3 (1/2 calls reported).');
  // No code-step call: its counts are zero, never unreported.
  const none = createReviewBudget({}, { now: clock });
  assert.match(none.summaryLine({ codeModel: OPUS }), /\. Code step on claude-opus-5-5\[1m\]: 0 of these calls; 0 input bytes; input tokens 0 \(0\/0 calls reported\); output tokens 0 \(0\/0 calls reported\)\.$/);
  // The whole is unchanged by the part.
  const whole = createReviewBudget({}, { now: clock });
  await whole.wrap(async () => { whole.record({ usage: { input_tokens: 7, output_tokens: 1 } }); return {}; })(request);
  await whole.wrap(async () => { whole.record({ usage: { input_tokens: 5, output_tokens: 3 } }); return {}; })(request);
  await whole.wrap(async () => { whole.record({ usage: null }); return {}; })(request);
  assert.equal(whole.summaryLine(), before);
  assert.deepEqual(whole.snapshot(), budget.snapshot());
});

test('--code-model applies whenever the code step runs: by default, by the setting, by --code-pass; never when it is off', async (t) => {
  const root = await repoWith(t);
  // The default (no flag, no setting): the code step runs, on the code model the flag or SONAH_CODE_MODEL names.
  for (const [argv, env] of [[['--code-model', OPUS], {}], [[], { SONAH_CODE_MODEL: OPUS }]]) {
    const run = await review(t, { root, state: await stateDir(t), argv, env });
    assert.equal(run.code, 0, run.err);
    assert.match(run.out, /^Code review: on \(the default\)\./m);
    assert.deepEqual(run.judges, [SESSION_MODEL, OPUS]);
    assert.ok(codeRequests(run.calls).length > 0);
    assert.deepEqual([...new Set(codeRequests(run.calls).map(({ model }) => model))], [OPUS]);
    assert.equal(run.report.codePass.model, OPUS);
    assert.match(run.out, /Code step on claude-opus-5-5\[1m\] \(the session on /);
  }
  // The setting on (sonah config code-pass on), and the setting off with --code-pass: the same.
  for (const [setting, argv] of [[true, ['--code-model', OPUS]], [false, ['--code-pass', '--code-model', OPUS]]]) {
    const dir = await mkdtemp(join(tmpdir(), 'sonah-code-model-setting-'));
    t.after(() => rm(dir, { recursive: true, force: true }));
    await writeCodePass(setting, { env: { SONAH_HOME: dir } });
    const run = await review(t, { root, state: await stateDir(t), argv, env: { SONAH_HOME: dir } });
    assert.equal(run.code, 0, run.err);
    assert.deepEqual(run.judges, [SESSION_MODEL, OPUS], String(setting));
    assert.deepEqual([...new Set(codeRequests(run.calls).map(({ model }) => model))], [OPUS]);
  }
  // The setting off and no flag: the code step does not run, so neither the flag nor the variable makes a judge, and an
  // alias that could never be attested is not refused (it is never used).
  const off = await mkdtemp(join(tmpdir(), 'sonah-code-model-off-'));
  t.after(() => rm(off, { recursive: true, force: true }));
  await writeCodePass(false, { env: { SONAH_HOME: off } });
  for (const [argv, env] of [[['--code-model', OPUS], {}], [[], { SONAH_CODE_MODEL: 'opus' }]]) {
    const run = await review(t, { root, state: await stateDir(t), argv, env: { SONAH_HOME: off, ...env } });
    assert.equal(run.code, 0, run.err);
    assert.match(run.out, /^Code review: off \(your setting, sonah config\)\./m);
    assert.deepEqual(run.judges, [SESSION_MODEL]);
    assert.deepEqual(codeRequests(run.calls), []);
    assert.doesNotMatch(run.out, /Code step on/);
  }
  // The default with an unattestable code model: refused before any call, as with --code-pass.
  const refused = await review(t, { root, state: await stateDir(t), argv: ['--code-model', 'opus'] });
  assert.equal(refused.code, 2);
  assert.match(refused.err, /Review could not complete: invalid_model\./);
  assert.deepEqual(refused.calls, []);
});
