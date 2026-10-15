// D87 (owner decisions 2026-10-13/14): `sonah review --code-pass` — the flag, the files it reads, the session part it
// leaves byte for byte as it was, the stored answers it reuses, and what it never lets reach a page or a story.
//
// Synthetic sessions, synthetic files and a deterministic fake reviewer: no recording, no model, no network.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CODE_PASS_NO_ROOT, codeSnapshotLine, parseSessionReviewArgs, runSessionReviewCommand, sessionReviewUsage,
  runStateLine } from '../src/session-review-command.js';
import { readCodeSnapshot } from '../src/code-snapshot.js';
import { estimateLine } from '../src/review-budget.js';
import { CODE_FILES, FAKE_KEY, codeSession, codeJudge, contradictClaim, findEmptyInput, repoWith, sha256 }
  from './code-pass-fixture.js';

const CODE_LABEL = /^(?:code-check|code-pass|challenge:code-check|challenge:code-finding)(?::|$)/;
const strip = (report) => {
  const { codePass: _pass, ...rest } = report;
  return JSON.parse(JSON.stringify(rest, (key, value) => (key === 'codeCheck' ? undefined : value)));
};

/** One `sonah review` run on the synthetic session, its files under `root`, its state under `state`. */
async function review(t, { root, state = null, argv = [], judge = codeJudge({ check: contradictClaim, pass: findEmptyInput }),
  session = codeSession(), cwd = root, maskOutput = undefined, format = 'md' } = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'sonah-code-pass-run-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const home = join(dir, 'home'), file = join(dir, 'recording.jsonl');
  await mkdir(home); await writeFile(file, '{}\n');
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
    ...(maskOutput ? { maskOutput } : {}),
    createJudge: ({ onResult }) => async (request) => {
      calls.push(request);
      onResult({ ok: true, backend: 'claude-cli', attestation: 'attested', contextWindow: 1_000_000 });
      return judge(request);
    } });
  const written = await readFile(output, 'utf8').catch(() => null);
  const report = JSON.parse(await readFile(join(state ?? join(dir, 'state'), 'review', 'report.private.json'), 'utf8')
    .catch(() => 'null'));
  return { code, out, err, calls, written, report };
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
    assert.match(sessionReviewUsage, /^ {2}--code-pass, --no-code-pass\n {27}the code step, on or off for this review/m);
    assert.ok(sessionReviewUsage.split('\n').every((line) => line.length <= 80));
  });

test('D87: the session part is byte-identical with the code pass on and off — every request, the report and its statuses', async (t) => {
  const root = await repoWith(t);
  const off = await review(t, { root, argv: ['--no-code-pass'] });
  const on = await review(t, { root, argv: ['--code-pass'] });
  // Owner decision 2026-10-14: with no flag the code step runs (the default), the same requests as --code-pass.
  const byDefault = await review(t, { root });
  assert.equal(off.code, 0);
  assert.equal(on.code, 0);
  assert.equal(byDefault.code, 0);
  // Sorted: one lane does not fix the order of a challenge's passes, which start together and each read the answer
  // store first (answer-cache.js `memoizeJudge`), so under load p3 can be sent before p2 (lean-default.test.js).
  const session = (calls) => calls.filter((r) => !CODE_LABEL.test(r.label))
    .map((r) => JSON.stringify([r.label, r.system, r.prompt])).sort();
  assert.ok(session(off.calls).length > 0);
  assert.deepEqual(session(on.calls), session(off.calls), 'the session requests, byte for byte');
  assert.equal(off.calls.filter((r) => CODE_LABEL.test(r.label)).length, 0, 'with --no-code-pass the step asks nothing');
  const all = (calls) => calls.map((r) => JSON.stringify([r.label, r.system, r.prompt])).sort();
  assert.deepEqual(all(byDefault.calls), all(on.calls), 'no flag sends what --code-pass sends');
  assert.match(byDefault.out, /^Code step: on \(the default\)\. /m);
  assert.match(on.out, /^Code step: on \(--code-pass\)\. /m);
  assert.match(off.out, /^Code step: off \(--no-code-pass\)\. Only the session is reviewed; no file is read or sent\. /m);
  assert.ok(on.calls.some((r) => r.label === 'code-check') && on.calls.some((r) => r.label === 'code-pass:behaviour'));
  // The report: the session's members as they were; the pass beside them, and each checked row's codeCheck.
  assert.equal(off.report.codePass, undefined);
  assert.deepEqual(strip(on.report), JSON.parse(JSON.stringify(off.report)));
  assert.equal(on.report.promises[0].status, off.report.promises[0].status);
  assert.equal(on.report.promises[0].codeCheck.outcome, 'contradicted-by-code');
  // The story keeps the session's sections; it adds the code review's and the code check beside each checked row.
  assert.match(on.written, /## What the code review found/);
  assert.doesNotMatch(off.written, /What the code review found|code check:/);
  assert.match(on.out, /code pass read every file it showed/);
  assert.match(on.out, /1 claim \(asks, decisions\) contradicted by the code at review time/);
  assert.doesNotMatch(off.out, /code pass|Code pass/);
  assert.equal(off.out.match(/code step/gi).length, 1, 'off: only the line that says so');
});

/** The FAKE secrets planted in a shown file: a key of a known shape, and a value only its key name reveals. */
const CONTEXT_SECRET = 'Zk3vQ9pLm2Xw7Rt8yU4n';
const PLANTED = Object.freeze({ ...CODE_FILES, 'src/util.js': [
  'export const SEPARATOR = ",";',
  `export const TOKEN = "${FAKE_KEY}";`,
  'export const settings = {',
  `  password: "${CONTEXT_SECRET}",`,
  '};',
  '',
].join('\n') });
/** A reviewer that quotes the planted lines and restates both values in its own words. */
const leakingJudge = () => codeJudge({
  check: (rows) => rows.map((row) => ({ key: row.key, answer: 'contradicts',
    explanation: `It keeps ${FAKE_KEY} and ${CONTEXT_SECRET} in code.`,
    receipts: [{ path: 'src/util.js', side: 'new', startLine: 2, endLine: 2, quote: `export const TOKEN = "${FAKE_KEY}";` }] })),
  // The secrets are in a file the session read (not changed), so the finding is a contract break traced from the
  // changed line of parse.js into util.js.
  pass: (prompt, files, lens) => (lens !== 'behaviour' ? [] : [{ kind: 'contract_break',
    title: `Hard-coded ${CONTEXT_SECRET} and ${FAKE_KEY}`, explanation: `The value ${CONTEXT_SECRET} is a password; ${FAKE_KEY} is a token.`,
    input: `parse("${CONTEXT_SECRET}")`,
    trace: [{ step: 'parse splits its input.', source: 'file', path: 'src/parse.js', side: 'new', startLine: 2, endLine: 2,
      quote: 'const parts = input.split(",");' },
    { step: `It meets ${FAKE_KEY}.`, source: 'file', path: 'src/util.js', side: 'new', startLine: 4, endLine: 4,
      quote: `password: "${CONTEXT_SECRET}",` },
    { step: 'And the token.', source: 'file', path: 'src/util.js', side: 'new', startLine: 2, endLine: 2,
      quote: `export const TOKEN = "${FAKE_KEY}";` }],
    anchor: { path: 'src/util.js', side: 'new', startLine: 2, endLine: 4 }, leadsFrom: [] }]),
  questions: (prompt) => {
    const item = String(prompt).split('\n').filter((line) => line.startsWith('{"key":"S')).map((line) => JSON.parse(line))
      .find((entry) => entry.kind === 'ask');
    return item ? [{ question: `Should ${FAKE_KEY} stay?`, key: item.key, quote: 'add a parse function' }] : [];
  },
});
const fragments = (secret) => Array.from({ length: secret.length - 7 }, (_, at) => secret.slice(at, at + 8));

test('D87: a FAKE key planted in a shown file never reaches the page or the story, quoted or restated', async (t) => {
  const root = await repoWith(t, PLANTED);
  for (const format of ['html', 'md']) {
    const { code, written, report, calls } = await review(t, { root, argv: ['--code-pass'], judge: leakingJudge(), format });
    assert.equal(code, 0, format);
    // The model read the file as it is (D84: unredacted), and the report keeps what it said, on this computer only.
    assert.ok(calls.some((r) => r.label === 'code-pass:behaviour' && r.prompt.includes(CONTEXT_SECRET)));
    assert.equal(report.codePass.findings.length, 1, format);
    // The code step: a finding's trace quotes both planted lines, and an open question restates the key.
    assert.equal(report.codePass.findings[0].trace.length, 3, format);
    assert.equal(report.codePass.questions.length, 1, format);
    for (const secret of [FAKE_KEY, CONTEXT_SECRET])
      for (const piece of fragments(secret)) assert.ok(!written.includes(piece), `${format}: ${piece}`);
    assert.match(written, /What the code review found/);
  }
});

test('D87: when the output cannot be masked, nothing is written (output_not_masked)', async (t) => {
  const root = await repoWith(t);
  const refuse = (text) => { if (text.includes('What the code review found')) throw new Error('no'); return text; };
  const { code, err, written } = await review(t, { root, argv: ['--code-pass'], maskOutput: refuse });
  assert.equal(code, 3);
  assert.match(err, /output_not_masked/);
  assert.equal(written, null);
});

test('D87: the same tree asks nothing twice (D60), and an existing state replays the session part with 0 calls', async (t) => {
  const root = await repoWith(t);
  const dir = await mkdtemp(join(tmpdir(), 'sonah-code-pass-state-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const state = join(dir, 'state');
  // The reuse dry run: a review without the pass, then `--code-pass --state-dir <existing>`.
  const first = await review(t, { root, state, argv: ['--no-code-pass'] });
  assert.ok(first.calls.length > 0);
  const second = await review(t, { root, state, argv: ['--code-pass'] });
  assert.ok(second.calls.length > 0);
  assert.deepEqual(second.calls.filter((r) => !CODE_LABEL.test(r.label)), [], 'the session part makes no call');
  assert.match(second.out, /Model answers: (\d+) of \1 reused \(no call\)/);
  // And the same files again: nothing at all is asked.
  const third = await review(t, { root, state, argv: ['--code-pass'] });
  assert.deepEqual(third.calls, []);
  assert.match(third.out, /Code pass answers: (\d+) of \1 reused \(no call\)/);
  // The same report but for the counts of what was asked live and what was reused.
  const uncounted = (report) => JSON.parse(JSON.stringify(report, (key, value) => (['answers', 'resume'].includes(key)
    ? undefined : value)));
  assert.deepEqual(uncounted(third.report), uncounted(second.report));
  assert.deepEqual(third.report.codePass.answers, { calls: 0, reused: second.report.codePass.answers.calls });
});

test('D87: a dry run reads and counts the files, sends nothing, and the estimate includes the pass', async (t) => {
  const root = await repoWith(t);
  const plain = await review(t, { root, argv: ['--dry-run', '--no-code-pass'] });
  const { code, out, calls } = await review(t, { root, argv: ['--dry-run', '--code-pass'] });
  assert.equal(code, 0);
  assert.deepEqual(calls, []);
  assert.match(out, /^Code pass: 3 files the session changed, read or git shows differing; 2 readable now; not readable: credential_path ×1\. No git base: the diff is the session's recorded edits\. /m);
  // Owner decision 2026-10-14: beside the estimate, that the step runs and roughly what it adds: its first requests (the
  // check, then one per lens), then the checking passes no plan can count.
  assert.match(out, /^A review should take roughly [^\n]*\nCode step: on \(--code-pass\)\. It reads the files the session changed or read, as they are now, and sends them to the reviewer; it adds about 5 model calls after the session's review, then three checking passes for each answer and finding they give\. Turn it off with --no-code-pass, or for every review with sonah config code-pass off\.$/m);
  assert.match(plain.out, /^A review should take roughly [^\n]*\nCode step: off \(--no-code-pass\)\. /m);
  assert.notEqual(out.match(/A review should take roughly [^\n]*/)[0], plain.out.match(/A review should take roughly [^\n]*/)[0]);
  assert.notEqual(estimateLine({ requestBytes: [100_000], lanes: 4, after: [400_000, 400_000] }),
    estimateLine({ requestBytes: [100_000], lanes: 4 }));
  assert.equal(estimateLine({ requestBytes: [100_000], lanes: 4, after: [] }), estimateLine({ requestBytes: [100_000], lanes: 4 }));
});

test('D87: with no working directory to read under, the pass is not run, says so, and the run is incomplete', async (t) => {
  const root = await repoWith(t);
  const { code, out, calls, report } = await review(t, { root, argv: ['--code-pass'], cwd: null });
  assert.equal(code, 1);
  assert.ok(out.includes(CODE_PASS_NO_ROOT));
  assert.equal(calls.filter((r) => CODE_LABEL.test(r.label)).length, 0);
  assert.equal(report.codePass.coverage, 'missing');
  assert.equal(report.codePass.ran, false);
  assert.match(out, /code pass not run/);
  assert.equal(codeSnapshotLine({ root: false, files: [] }), CODE_PASS_NO_ROOT);
});

test('D87 reader: credential, harness, outside, linked-out, deleted and oversize files are declared; a read directory is no file', async (t) => {
  const outside = await mkdtemp(join(tmpdir(), 'sonah-code-pass-outside-'));
  t.after(() => rm(outside, { recursive: true, force: true }));
  await writeFile(join(outside, 'secret.js'), 'export const x = 1;\n');
  const root = await repoWith(t, { ...CODE_FILES, 'big.js': 'x'.repeat(5000), '.claude/settings.json': '{}' });
  await symlink(join(outside, 'secret.js'), join(root, 'linked.js'));
  const { Session } = await import('../../evidence/src/session.js');
  const read = (path, id) => ({ id, kind: 'invocation', tool: 'read', operation: 'other', paths: [{ path }],
    command: [], input: [], changes: [], sequence: 0 });
  const session = new Session({ sessionKey: 's', events: ['.env', '.claude/settings.json', '../outside.js',
    join(outside, 'secret.js'), 'linked.js', 'gone.js', 'big.js', 'src', 'src/util.js']
    .map((path, at) => ({ ...read(path, `R${at}`), sequence: at })) });
  const snapshot = await readCodeSnapshot(session, { root, home: null, maxBytes: 1000 });
  assert.equal(snapshot.root, true);
  assert.deepEqual(snapshot.files.map((f) => [f.path, f.state]), [['.env', 'credential_path'],
    ['.claude/settings.json', 'harness_home'], ['../outside.js', 'outside_root'], [join(outside, 'secret.js'), 'outside_root'],
    ['linked.js', 'outside_root'], ['gone.js', 'deleted'], ['big.js', 'oversize'], ['src/util.js', 'readable']]);
  assert.equal(snapshot.files.at(-1).text, CODE_FILES['src/util.js']);
  assert.deepEqual(await readCodeSnapshot(session, { root: join(root, 'nowhere'), maxBytes: 1000 }),
    { root: false, plan: snapshot.plan, files: [] });
  assert.deepEqual((await readCodeSnapshot(session, { root: null, maxBytes: 1000 })).root, false);
});

test('D87 low: a pass over a session that changed or read no file says it had none, never that it read every file', () => {
  const base = { reviewScope: 'session-only', findings: [], sessionReview: 'complete', coverage: 'complete' };
  const line = (codePass) => runStateLine({ ...base, codePass });
  assert.match(line({ ran: true, coverage: 'complete', files: [] }),
    /code pass had no file to read: the session changed or read none/);
  assert.match(line({ ran: true, coverage: 'complete', files: [{ path: 'a.js', state: 'shown' }] }),
    /code pass read every file it showed/);
  assert.match(line({ ran: false, coverage: 'missing', files: [] }), /code pass not run/);
  assert.match(line({ ran: true, coverage: 'partial', files: [{ path: 'a.js', state: 'not_shown' }] }),
    /code pass did not read every file it showed/);
});
