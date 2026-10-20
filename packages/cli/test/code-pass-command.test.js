// D87 (owner decisions 2026-10-13/14), the agentic code step (code-pass/7, D90): `sonah review --code-pass` — the
// flag, what it reads, the session part it leaves byte for byte as it was, the stored answers it reuses, the backend it
// runs on, and (D90) what the agents read, shown as it is.
//
// Synthetic sessions, synthetic files and a deterministic fake reviewer: no recording, no model, no network.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CODE_PASS_NO_ROOT, CODE_STEP_BACKEND_LINE, codeSnapshotLine, codeStepLine, parseSessionReviewArgs,
  runSessionReviewCommand, sessionReviewUsage, runStateLine } from '../src/session-review-command.js';
import { createRepositoryReader, readCodeSnapshot } from '../src/code-snapshot.js';
import { reviewCodePass } from '../src/session-review.js';
import { Session } from '../../evidence/src/session.js';
import { estimateLine, CODE_STEP_ESTIMATE_MINUTES } from '../src/review-budget.js';
import { CODE_FILES, CODE_TEXT, FAKE_KEY, PARSE_QUOTE, buildCodeSession, codeSession, codeJudge, gitRepoWith, repoWith,
  reviewFinding, sha256 } from './code-pass-fixture.js';

// F3b (D111): the accounting's calls are the code step's too.
const CODE_LABEL = /^code-(?:review|verify|account)(?::|$)/;
const strip = (report) => {
  const { codePass: _pass, ...rest } = report;
  return JSON.parse(JSON.stringify(rest, (key, value) => (key === 'codeCheck' ? undefined : value)));
};

/** One `sonah review` run on the synthetic session, its files under `root`, its state under `state`; `cwd`, the
 *  working directory the recording names, or a function of the run's home folder that gives it; `home`, a folder that
 *  is there to be the run's home folder, else a new one named `homeName`. */
async function review(t, { root, state = null, argv = [], judge = codeJudge(), session = codeSession(), cwd = root,
  format = 'md', runCode = undefined, home: given = null, homeName = 'home' } = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'sonah-code-pass-run-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const home = given ?? join(dir, homeName), file = join(dir, 'recording.jsonl');
  if (typeof cwd === 'function') cwd = cwd(home);
  if (given === null) await mkdir(home);
  await writeFile(file, '{}\n');
  const env = { HOME: home, SONAH_HOME: join(home, '.sonah'), CODEX_HOME: join(home, 'codex'),
    SONAH_CLAUDE_PROJECTS: join(home, 'claude-projects') };
  const output = join(dir, format === 'html' ? 'page.html' : 'story.md');
  let out = '', err = '';
  const calls = [];
  const code = await runSessionReviewCommand([file, '--concurrency', '1', '--state-dir', state ?? join(dir, 'state'),
    '--format', format, '--output', output, '--no-open', ...argv], {
    stdout: { write: (text) => { out += text; } }, stderr: { write: (text) => { err += text; } }, cwd: root ?? dir, env,
    installSignals: false, loadReviews: async () => new Map(), openPage: async () => {},
    loadSession: async () => ({ session, hash: sha256('synthetic'), cwd }),
    ...(runCode ? { runCode } : {}),
    createJudge: ({ config, onResult }) => async (request) => {
      calls.push(request);
      onResult({ ok: true, backend: config.backend, attestation: config.backend === 'claude-cli' ? 'attested' : 'unattested',
        contextWindow: config.backend === 'claude-cli' ? 1_000_000 : null });
      return judge(request);
    } });
  const written = await readFile(output, 'utf8').catch(() => null);
  // D97: with --format html, the Markdown report beside the page.
  const besideMd = format === 'html' ? await readFile(join(dir, 'page.md'), 'utf8').catch(() => null) : null;
  const report = JSON.parse(await readFile(join(state ?? join(dir, 'state'), 'review', 'report.private.json'), 'utf8')
    .catch(() => 'null'));
  return { code, out, err, calls, written, besideMd, report, home };
}

test('D87 --code-pass and --no-code-pass: each parses once, never both, is listed, and leaves every other option as it was',
  () => {
    assert.equal(parseSessionReviewArgs(['--code-pass']).codePass, true);
    // Owner decision 2026-10-14: the code step is on by default; --no-code-pass turns it off for one review.
    assert.equal(parseSessionReviewArgs(['--no-code-pass']).codePass, false);
    assert.equal(Object.hasOwn(parseSessionReviewArgs([]), 'codePass'), false, 'no flag: the setting decides');
    for (const flag of ['--code-pass', '--no-code-pass']) {
      const { codePass: _set, ...rest } = parseSessionReviewArgs([flag, '--dry-run']);
      assert.deepEqual(rest, parseSessionReviewArgs(['--dry-run']), flag);
      assert.throws(() => parseSessionReviewArgs([flag, flag]), { code: 'usage' }, flag);
    }
    assert.throws(() => parseSessionReviewArgs(['--code-pass', '--no-code-pass']),
      (error) => error.code === 'usage' && error.problem === 'give --code-pass or --no-code-pass, not both');
    assert.match(sessionReviewUsage, /^ {2}--code-pass, --no-code-pass\n {27}the code review, on or off for this review/m);
    // The agentic code step: what the step does, in the help.
    assert.match(sessionReviewUsage, / It\n {27}reads the repository \(Read, Grep, Glob, no shell\)/);
    assert.match(sessionReviewUsage, /runs only on claude-cli$/m);
    assert.ok(sessionReviewUsage.split('\n').every((line) => line.length <= 80));
  });

test('D87: the session part is byte-identical with the code step on and off — every request, the report and its statuses', async (t) => {
  const root = await repoWith(t);
  const off = await review(t, { root, argv: ['--no-code-pass'] });
  const on = await review(t, { root, argv: ['--code-pass'] });
  // Owner decision 2026-10-14: with no flag the code step runs (the default), the same requests as --code-pass.
  const byDefault = await review(t, { root });
  assert.equal(off.code, 0);
  assert.equal(on.code, 0, on.err);
  assert.equal(byDefault.code, 0);
  const session = (calls) => calls.filter((r) => !CODE_LABEL.test(r.label))
    .map((r) => JSON.stringify([r.label, r.system, r.prompt])).sort();
  assert.ok(session(off.calls).length > 0);
  assert.deepEqual(session(on.calls), session(off.calls), 'the session requests, byte for byte');
  assert.equal(off.calls.filter((r) => CODE_LABEL.test(r.label)).length, 0, 'with --no-code-pass the step asks nothing');
  const all = (calls) => calls.map((r) => JSON.stringify([r.label, r.system, r.prompt])).sort();
  assert.deepEqual(all(byDefault.calls), all(on.calls), 'no flag sends what --code-pass sends');
  // D117's review: no git repository holds this working directory, so the line names the working directory.
  assert.match(byDefault.out, /^Code review: on \(the default\)\. It reviews the change with read-only access to the whole working directory \(Read, Grep, Glob\)\. It adds one review call, and one check call for each finding\. /m);
  // F3b (D111) and its review: the accounting's calls, counted by the items in scope, each kind named (never every claim
  // and decision).
  assert.match(byDefault.out, /check call for each finding\. It adds one more call for each 30 items, at most 4\. The items are asks, statements that the agent wrote into a file and the agent's decisions not to act\. /m);
  assert.match(on.out, /^Code review: on \(--code-pass\)\. /m);
  assert.match(off.out, /^Code review: off \(--no-code-pass\)\. Sonah reviews only the session, and reads or sends no file\. /m);
  // The agent requests: the review agent, then the checking agent of its one finding, each with its agent fields.
  const code = on.calls.filter((r) => CODE_LABEL.test(r.label));
  // F3b (D111): and the accounting agent of its one batch.
  assert.deepEqual(code.map((r) => r.label), ['code-review:agent', 'code-verify:F1', 'code-account:1']);
  assert.deepEqual(code.map((r) => [r.agent.maxTurns, r.agent.timeoutMs]), [[150, 45 * 60_000], [60, 30 * 60_000],
    [80, 30 * 60_000]]);
  assert.ok(code.every((r) => r.agent.root === root && Array.isArray(r.agent.addDirs) && r.schema));
  // The report: the session's members as they were; the pass beside them, and the row its claim_false finding names.
  assert.equal(off.report.codePass, undefined);
  assert.deepEqual(strip(on.report), JSON.parse(JSON.stringify(off.report)));
  assert.equal(on.report.promises[0].status, off.report.promises[0].status);
  assert.deepEqual([on.report.promises[0].codeCheck.outcome, on.report.promises[0].codeCheck.by],
    ['contradicted-by-code', 'finding']);
  // D97: the report .md (the story since /32) shows what the code review found as items, in its own words.
  assert.match(on.written, /How the code gets there:/);
  assert.doesNotMatch(off.written, /How the code gets there:|contradicted by the code review|code check:/);
  assert.match(on.out, /code review covered the whole change/);
  // D97: the terminal's count line names the code review's finding by its place, a Must act item.
  assert.match(on.out, /^Must act: ask 1 · src\/parse\.js:2 \(item 2\)$/m);
  assert.doesNotMatch(off.out, /src\/parse\.js:2/);
  assert.doesNotMatch(off.out, /code review (covered|did|had)/);
  // D118 (a): off, the first screen says no code was reviewed and why, right after the run state; on, it does not.
  assert.match(off.out, /^Sonah's review: complete, but no code was reviewed \(session review complete\)\.\nNo code was reviewed\. Reason: this review ran without the code review\. The items show no impact and no action\.$/m);
  assert.doesNotMatch(on.out, /No code was reviewed/);
  assert.equal(off.out.match(/code review/gi).length, 2, 'off: only the line that says so, and the no-code line');
});

/** FAKE secrets in a file the review agent reads and the session only read: a key of a known shape, and a value only its
 *  key name reveals. Not credentials. */
const CONTEXT_SECRET = 'Zk3vQ9pLm2Xw7Rt8yU4n';
const PLANTED = Object.freeze({ ...CODE_FILES, 'src/util.js': [
  'export const SEPARATOR = ",";',
  `export const TOKEN = "${FAKE_KEY}";`,
  'export const settings = {',
  `  password: "${CONTEXT_SECRET}",`,
  '};',
  '',
].join('\n') });
/** A reviewer whose finding is traced from parse.js into util.js, a file outside the change, quoting both values. */
const plantedJudge = () => codeJudge({
  review: () => ({ findings: [reviewFinding({ kind: 'contract_break', lens: 'contracts',
    title: 'parse feeds its parts to settings that hold a hard-coded password and token',
    trace: [reviewFinding().trace[0],
      { step: 'The settings hold a password.', path: 'src/util.js', side: 'new', startLine: 4, endLine: 4,
        quote: `password: "${CONTEXT_SECRET}",` },
      { step: 'And a token.', path: 'src/util.js', side: 'new', startLine: 2, endLine: 2,
        quote: `export const TOKEN = "${FAKE_KEY}";` }],
    anchor: { path: 'src/util.js', side: 'new', startLine: 2, endLine: 4 } })], questions: [] }),
});
/** A page's or a story's text with its escapes read back (HTML entities, Markdown backslashes). */
const unescaped = (text) => text.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/&amp;/g, '&').replace(/\\(.)/g, '$1');

test('D90: a file outside the change, credential-shaped values in it included, is read, quoted and shown as it is', async (t) => {
  const root = await repoWith(t, PLANTED);
  for (const format of ['html', 'md']) {
    const { code, written, report } = await review(t, { root, argv: ['--code-pass'], judge: plantedJudge(), format });
    assert.equal(code, 0, format);
    // The finding's steps ground in util.js as it is now, though the session only read it: nothing is withheld (D90).
    const [finding] = report.codePass.findings;
    assert.deepEqual(finding.trace.map((s) => [s.path, s.startLine, s.quote]), [['src/parse.js', 2, PARSE_QUOTE],
      ['src/util.js', 4, `password: "${CONTEXT_SECRET}",`], ['src/util.js', 2, `export const TOKEN = "${FAKE_KEY}";`]]);
    assert.ok(finding.trace.every((s) => s.span.includes(s.quote) && /^[0-9a-f]{64}$/.test(s.sha256)));
    assert.equal(report.codePass.withheld.length, 0);
    assert.deepEqual(report.codePass.files.map((f) => f.path), ['src/parse.js'], 'the change is parse.js alone');
    // The page (/37) and the report .md show the finding as an item in the code review's words.
    assert.match(written, format === 'html' ? /<em class="by-code-review">/ : /How the code gets there:/, format);
    // Nothing is masked for a person (D90): the quoted lines reach the page and the report .md as the agent read them.
    for (const secret of [FAKE_KEY, CONTEXT_SECRET]) assert.ok(unescaped(written).includes(secret), `${format}: ${secret}`);
    assert.doesNotMatch(written, /‹(?:redacted|dropped)/, format);
  }
});

test('D60: the same repository asks nothing twice, and an existing state replays the session part with 0 calls', async (t) => {
  // A git repository, so the code step's answers are keyed by its state (an agent request without one is never stored).
  const root = await gitRepoWith(t);
  const dir = await mkdtemp(join(tmpdir(), 'sonah-code-pass-state-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const state = join(dir, 'state');
  const first = await review(t, { root, state, argv: ['--no-code-pass'] });
  assert.ok(first.calls.length > 0);
  const second = await review(t, { root, state, argv: ['--code-pass'] });
  assert.ok(second.calls.length > 0);
  assert.deepEqual(second.calls.filter((r) => !CODE_LABEL.test(r.label)), [], 'the session part makes no call');
  assert.match(second.out, /Model answers: (\d+) of \1 reused \(no call\)/);
  // And the same repository again: nothing at all is asked, the review agent and its checkers included.
  const third = await review(t, { root, state, argv: ['--code-pass'] });
  assert.deepEqual(third.calls, []);
  // F3b (D111): the review agent, its finding's checker and the accounting's one batch.
  assert.match(third.out, /Code review answers: 3 of 3 reused \(no call\)/);
  const uncounted = (report) => JSON.parse(JSON.stringify(report, (key, value) => (['answers', 'resume'].includes(key)
    ? undefined : value)));
  assert.deepEqual(uncounted(third.report), uncounted(second.report));
  assert.deepEqual(third.report.codePass.answers, { calls: 0, reused: second.report.codePass.answers.calls });
  // D105: every agent answer the report uses carries its reading record, live and replayed alike: the store keeps it
  // beside the answer and sets it again, so the replayed report's records are the live one's, and none is null.
  for (const report of [second.report, third.report]) {
    assert.ok(report.codePass.agents.length >= 2);
    assert.ok(report.codePass.agents.every((a) => a.run !== null && a.run.reads.length > 0), JSON.stringify(report.codePass.agents));
  }
  assert.deepEqual(third.report.codePass.agents, second.report.codePass.agents);
  assert.ok(!third.report.codePass.footer.some((f) => f.kind === 'source_changed'), 'the repository did not change');
});

test('agentic code step: the repository\'s state is taken again after the step; a change during it is said, never complete', async (t) => {
  const root = await gitRepoWith(t);
  // The review agent's answer arrives after someone changed a file of the repository the step did not change.
  const judge = codeJudge({ review: async (prompt) => {
    await writeFile(join(root, 'README.md'), 'edited while the review ran\n');
    return { findings: [], questions: [] };
  } });
  const run = await review(t, { root, argv: ['--code-pass'], judge });
  assert.equal(run.code, 1, 'a required code step that may have read two states is not complete');
  assert.deepEqual(run.report.codePass.footer, [{ kind: 'source_changed' }]);
  assert.deepEqual(run.report.codePass.gaps.map((g) => g.code), ['source_changed']);
  assert.equal(run.report.codePass.coverage, 'partial');
  // Unchanged during the step: nothing said, complete.
  const still = await review(t, { root: await gitRepoWith(t), argv: ['--code-pass'], judge: codeJudge({
    review: () => ({ findings: [], questions: [] }) }) });
  assert.deepEqual([still.code, still.report.codePass.footer, still.report.codePass.coverage], [0, [], 'complete']);
  // A state that cannot be taken again after the step is no proof the repository stayed as it was: said the same way.
  for (const stateNow of [async () => null, async () => { throw new Error('git is gone'); }]) {
    const unknown = await review(t, { root: await gitRepoWith(t), argv: ['--code-pass'], judge: codeJudge({
      review: () => ({ findings: [], questions: [] }) }), runCode: (args) => reviewCodePass({ ...args, stateNow }) });
    assert.deepEqual([unknown.code, unknown.report.codePass.footer], [1, [{ kind: 'source_changed' }]]);
  }
});

test('agentic code step: on another backend than claude-cli the step does not run, and says why, everywhere', async (t) => {
  const root = await repoWith(t);
  for (const [argv, exit] of [[['--code-pass'], 1], [[], 0]]) {
    const run = await review(t, { root, argv: ['--backend', 'codex-cli', '--model', 'gpt-5.5-codex', ...argv] });
    assert.equal(run.code, exit, run.err);
    assert.equal(run.calls.filter((r) => CODE_LABEL.test(r.label)).length, 0);
    assert.match(run.out, /^Code review: on \([^)]*\), but it did not run\. It runs only on the claude-cli backend, whose reviewer can read the repository\. /m);
    assert.ok(run.out.includes(CODE_STEP_BACKEND_LINE));
    assert.match(run.out, /code review did not run, because it runs only on the claude-cli backend/);
    assert.deepEqual([run.report.codePass.ran, run.report.codePass.coverage, run.report.codePass.gaps.map((g) => g.code)],
      [false, 'missing', ['code_step_backend']]);
  }
  const dry = await review(t, { root, argv: ['--dry-run', '--backend', 'anthropic-api', '--model', 'claude-sonnet-5-5'] });
  assert.equal(dry.code, 0);
  assert.ok(dry.out.includes(CODE_STEP_BACKEND_LINE));
  assert.equal(codeSnapshotLine({ root: false, gate: 'code_step_backend', files: [] }), CODE_STEP_BACKEND_LINE);
  assert.match(codeStepLine({ on: true, source: 'flag' }, { root: false, gate: 'code_step_backend' }), /but it did not run/);
});

test('D87: a dry run reads the change, sends nothing, and the estimate includes the step\'s range', async (t) => {
  const root = await repoWith(t);
  const plain = await review(t, { root, argv: ['--dry-run', '--no-code-pass'] });
  const { code, out, calls } = await review(t, { root, argv: ['--dry-run', '--code-pass'] });
  assert.equal(code, 0);
  assert.deepEqual(calls, []);
  assert.match(out, /^Code review: the change holds 1 path that a recorded write could have changed or that changed during the session\. Sonah can read 1 of them now\. Sonah could not read from git where the session started, so the change is the edits that the session recorded\. The code review can read any file of the working directory\.$/m);
  assert.match(out, /^A review should take roughly [^\n]*\nCode review: on \(--code-pass\)\. It reviews the change/m);
  assert.match(plain.out, /^A review should take roughly [^\n]*\nCode review: off \(--no-code-pass\)\. /m);
  assert.notEqual(out.match(/A review should take roughly [^\n]*/)[0], plain.out.match(/A review should take roughly [^\n]*/)[0]);
  // The code step's share is a literal range until it is timed on real reviews: reported, never a limit.
  assert.deepEqual(CODE_STEP_ESTIMATE_MINUTES, [3, 15]);
  assert.notEqual(estimateLine({ requestBytes: [100_000], lanes: 4, extra: CODE_STEP_ESTIMATE_MINUTES }),
    estimateLine({ requestBytes: [100_000], lanes: 4 }));
  assert.equal(estimateLine({ requestBytes: [100_000], lanes: 4, after: [] }), estimateLine({ requestBytes: [100_000], lanes: 4 }));
});

test('agentic code step: a dry run counts the review agent\'s first request as a review sends it — the skill files it loads included', async (t) => {
  const SKILL = `SYNTHETIC_SKILL ${'tidy the parser. '.repeat(400)}`;
  const root = await repoWith(t, { ...CODE_FILES, '.claude/skills/tidy/SKILL.md': SKILL });
  const base = codeSession();
  // The session also loaded a skill of the repository (a recorded Skill call naming it).
  const session = new Session({ sessionKey: 's-skill', adapter: 'claude', blobs: { ...base.blobs, skill: '{"skill":"tidy"}' },
    events: [...base.events, { id: 'K1', kind: 'invocation', tool: 'Skill', operation: 'other', paths: [], changes: [],
      command: [], input: [{ sourceKey: 'skill', fromByte: 0, untilByte: 16 }], callKey: 'K1', turn: 'T1',
      sequence: base.events.length }] });
  // The dry run on the live run's state: the same session answers, so the same dossier.
  const dir = await mkdtemp(join(tmpdir(), 'sonah-code-pass-state-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const state = join(dir, 'state');
  const live = await review(t, { root, state, argv: ['--code-pass'], session });
  const sent = live.calls.find((r) => r.label === 'code-review:agent');
  assert.ok(sent.prompt.includes(SKILL.trim().slice(0, 200)), 'the review agent is given the skill the session loaded');
  const dry = await review(t, { root, state, argv: ['--dry-run', '--code-pass'], session });
  const kb = Math.ceil((Buffer.byteLength(sent.system) + Buffer.byteLength(sent.prompt)) / 1024);
  assert.match(dry.out, new RegExp(`^Code review: it would first send 1 call \\(code-review:agent ${kb} KB\\)`, 'm'));
});

test('D87: with no working directory to read under, the pass is not run, says so, and the run is incomplete', async (t) => {
  const root = await repoWith(t);
  const { code, out, calls, report } = await review(t, { root, argv: ['--code-pass'], cwd: null });
  assert.equal(code, 1);
  assert.ok(out.includes(CODE_PASS_NO_ROOT));
  assert.equal(calls.filter((r) => CODE_LABEL.test(r.label)).length, 0);
  assert.equal(report.codePass.coverage, 'missing');
  assert.equal(report.codePass.ran, false);
  assert.match(out, /code review did not run/);
  assert.equal(codeSnapshotLine({ root: false, files: [] }), CODE_PASS_NO_ROOT);
});

test('D118 (a), amended (the owner, 2026-10-19: "yes, folder name only"): the report .md names the folder Sonah looked in '
  + 'by its name alone, never the home folder\'s path or the user name in it; the page and the terminal name the path',
async (t) => {
  // The recording names a working directory under the home folder that is not there now: no code was reviewed
  // (`no_folder`), and the first screen names the folder the code step looked in.
  const USER = 'jdoe-synthetic';
  const at = (home) => join(home, 'code', 'gone-app');
  for (const format of ['md', 'html']) {
    const run = await review(t, { root: null, cwd: at, format, homeName: USER });
    const folder = at(run.home);
    const md = format === 'html' ? run.besideMd : run.written;
    assert.equal(run.report.codePass.ran, false, format);
    assert.match(md, /No code was reviewed\. Reason: Sonah could not read a working directory of the session on this /);
    assert.ok(md.includes('Folder: `gone-app`'), `${format}: the .md names the folder by its name`);
    for (const part of [folder, run.home, USER]) assert.ok(!md.includes(part), `${format}: the .md never holds ${part}`);
    assert.ok(run.out.includes(`Folder: ${folder}`), `${format}: the terminal names the path`);
    if (format === 'html') assert.ok(run.written.includes(`<code>${folder}</code>`), 'the page names the path');
  }
  // The home folder itself, as the environment spells it and as the disk resolves it (a harness records the working
  // directory's real path): its name is the user name, so the .md says `~`. A session that wrote nothing, run in the
  // home folder: the code step looked there and reviewed no code (`no_write`).
  const session = buildCodeSession('sess-no-write', CODE_TEXT, [
    { id: 'I1', kind: 'instruction', blob: 'ask', turn: 'T1' },
    { id: 'R1', kind: 'invocation', read: 'src/util.js', blob: 'readUtil', turn: 'T1' },
    { id: 'R1-r', kind: 'observation', invocation: 'R1', blob: 'readOut', turn: 'T1' },
    { id: 'C2', kind: 'commentary', blob: 'final', phase: 'final', turn: 'T1' }]);
  const real = await mkdtemp(join(tmpdir(), 'sonah-code-pass-home-'));
  t.after(() => rm(real, { recursive: true, force: true }));
  await mkdir(join(real, USER));
  await symlink(join(real, USER), join(real, 'link'));
  const realHome = await realpath(join(real, USER));
  for (const [home, cwd] of [[join(real, USER), join(real, USER)], [join(real, 'link'), realHome]]) {
    const run = await review(t, { root: null, cwd, home, session });
    assert.equal(run.report.codePass.ran, true, home);
    assert.match(run.written, /No code was reviewed\. Reason: the recording shows no write of the session /, home);
    assert.ok(run.written.includes('Folder: `~`'), `${home}: the .md names the home folder itself as ~`);
    for (const part of [home, cwd, USER]) assert.ok(!run.written.includes(part), `${home}: the .md holds ${part}`);
    assert.ok(run.out.includes(`Folder: ${cwd}`), `${home}: the terminal names the path`);
  }
});

test('D90 reader: any file of the repository is read — .env and a .claude folder too; outside the top folder, nothing', async (t) => {
  const outside = await mkdtemp(join(tmpdir(), 'sonah-code-pass-outside-'));
  t.after(() => rm(outside, { recursive: true, force: true }));
  await writeFile(join(outside, 'secret.js'), 'export const x = 1;\n');
  const root = await repoWith(t, { ...CODE_FILES, 'big.js': 'x'.repeat(5000), '.claude/settings.json': '{"a":1}\n',
    'bin.dat': 'a\u0000b' });
  await symlink(join(outside, 'secret.js'), join(root, 'linked.js'));
  const repo = createRepositoryReader({ root, maxBytes: 1000 });
  // A file the change does not touch, a credential-shaped one and one in a `.claude` folder: all read (D90).
  for (const path of ['src/util.js', '.env', '.claude/settings.json', './src/util.js', join(root, 'src/util.js')]) {
    const file = repo.read(path);
    assert.ok(file, path);
    assert.equal(file.path, path.includes('settings') ? '.claude/settings.json' : path.includes('.env') ? '.env' : 'src/util.js');
    assert.equal(file.sha256, sha256(file.text));
  }
  assert.equal(repo.read('.env').text, CODE_FILES['.env']);
  assert.equal(repo.read('src/util.js').lines, CODE_FILES['src/util.js'].split('\n').length);
  // Outside the top folder (by a path, an absolute name or a link), binary, too large, missing, a folder: nothing.
  for (const path of ['../x.js', join(outside, 'secret.js'), 'linked.js', 'bin.dat', 'big.js', 'gone.js', 'src', '', null])
    assert.equal(repo.read(path), null, String(path));
  // No start commit: no file at it.
  assert.equal(repo.base('src/util.js'), null);
  // The snapshot is the change under review: the session's write, as it is now; what it only read is not part of it.
  const session = codeSession();
  const snapshot = await readCodeSnapshot(session, { root, maxBytes: 1000 });
  assert.equal(snapshot.root, true);
  assert.deepEqual(snapshot.files.map((f) => [f.path, f.state]), [['src/parse.js', 'readable']]);
  assert.equal(snapshot.repoState, null, 'no repository, no state');
  assert.deepEqual(await readCodeSnapshot(session, { root: join(root, 'nowhere'), maxBytes: 1000 }),
    { root: false, plan: snapshot.plan, files: [] });
  assert.deepEqual((await readCodeSnapshot(session, { root: null, maxBytes: 1000 })).root, false);
});

test('D87 low: a pass over a session that changed no file says it had none, never that it reviewed the whole change', () => {
  const base = { reviewScope: 'session-only', findings: [], sessionReview: 'complete', coverage: 'complete' };
  const line = (codePass) => runStateLine({ ...base, codePass });
  assert.match(line({ ran: true, coverage: 'complete', files: [] }),
    /code review had no change to review, because Sonah found no changed file here/);
  assert.match(line({ ran: true, coverage: 'complete', files: [{ path: 'a.js', state: 'shown' }] }),
    /code review covered the whole change/);
  assert.match(line({ ran: false, coverage: 'missing', files: [] }), /code review did not run/);
  assert.match(line({ ran: true, coverage: 'partial', files: [{ path: 'a.js', state: 'binary' }] }),
    /code review did not cover all of the change and its checks/);
  assert.match(line({ ran: false, coverage: 'missing', files: [], gaps: [{ code: 'code_step_backend' }] }),
    /code review did not run, because it runs only on the claude-cli backend/);
  // D105: a review request too large to send was never sent: the review did not run, as the page says — never "did not
  // finish", which would say a call started.
  const unsent = { ran: true, coverage: 'missing', files: [{ path: 'a.js', state: 'shown' }],
    manifest: { review: { sent: false } } };
  assert.match(line(unsent), /code review did not run, because its input was too large to send\)/);
  assert.doesNotMatch(line(unsent), /did not finish/);
  assert.match(line({ ...unsent, manifest: { review: { sent: true } } }), /code review did not finish\)/);
});
