// D219 (the owner, 2026-11-09: "both works"): `sonah review --format html` also draws the graphs page of the session's
// commits (`sonah visual`'s page) and the review page links to it, unless `--no-visual`. Through the CLI's review, on a
// temporary git repository (its remote a GitHub URL that is never contacted), with a deterministic fake reviewer and an
// injected graphs drawer: no recording, no model, no network. One test runs the real drawer (visual-command.js
// `drawVisualPage`) against packages/visual/test/fake-claude.mjs, put first on PATH as `claude`.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { chmod, copyFile, mkdir, mkdtemp, readFile, realpath, rm, stat, writeFile } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseSessionReviewArgs, runSessionReviewCommand, sessionReviewUsage } from '../src/session-review-command.js';
import { createSessionReviewStore } from '../src/session-review.js';
import { REVIEW_GRAPHS_WORDS, failureCodeOf, reviewGraphsDryRunLine, reviewGraphsPage, reviewGraphsRange,
  reviewLimited } from '../src/review-graphs.js';
import { VISUAL_DEFAULT_MODEL, VISUAL_FIX_WORDS, VISUAL_FIX_DEFAULT, VISUAL_WORDS, drawVisualPage, visualOutDir }
  from '../src/visual-command.js';
import { REPORT_GRAPHS_FAILURE_WORDS, REPORT_GRAPHS_WORDS, REPORT_HEADER_WORDS } from '../../render/report-words.js';
import { extract } from '../../visual/src/extract.mjs';
import { functionRequests, storyRequest, findingsRequest, mapAnswerIds, STORY_SYSTEM, FINDINGS_SYSTEM }
  from '../../visual/src/requests.mjs';
import { checkFunctions } from '../../visual/src/checks.mjs';
import { STOP_ERRORS, TRANSPORT_ERRORS } from '../../visual/src/transport-claude.mjs';
import { CODE_FILES, codeSession, codeJudge, sha256 } from './code-pass-fixture.js';

const START = '2030-01-01T00:00:00.000Z';
const BASE_PARSE = CODE_FILES['src/parse.js'].replace('split(",")', 'split(";")');
const GIT_ENV = (date) => ({ ...Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('GIT_'))),
  GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date, GIT_AUTHOR_NAME: 'synthetic', GIT_AUTHOR_EMAIL: 's@example.invalid',
  GIT_COMMITTER_NAME: 'synthetic', GIT_COMMITTER_EMAIL: 's@example.invalid' });
const FAKE_CLAUDE = fileURLToPath(new URL('../../visual/test/fake-claude.mjs', import.meta.url));
const W = REVIEW_GRAPHS_WORDS;
const G = REPORT_GRAPHS_WORDS;
/** The page's line that says why the graphs page was not drawn, as the page writes it. */
const notDrawnLine = (words) => `<p class="meta graphs">${words.replace(/'/g, '&#39;')}</p>`;

/** A repository: the base commit (before the session), then the session's work in the working tree, not committed;
 *  `commit()` commits it. Its remote has a GitHub URL that nothing contacts. */
async function repository(t) {
  const top = await realpath(await mkdtemp(join(tmpdir(), 'sonah-d219-')));
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
  const base = git(['rev-parse', 'HEAD']);
  git(['remote', 'add', 'origin', 'https://github.com/example-org/example-api.git']);
  git(['update-ref', 'refs/remotes/origin/main', base]);
  await writeFile(join(root, 'src', 'parse.js'), CODE_FILES['src/parse.js']);
  const recording = join(top, 'recording.jsonl');
  await writeFile(recording, `${JSON.stringify({ timestamp: START })}\n`);
  const out = join(top, 'out');
  await mkdir(out);
  const commit = () => {
    git(['add', '-A'], '2031-01-01T00:00:00Z');
    git(['commit', '-q', '-m', 'Split the input on commas'], '2031-01-01T00:00:00Z');
    return git(['rev-parse', 'HEAD']);
  };
  const env = { HOME: join(top, 'home'), SONAH_HOME: join(top, '.sonah'), CODEX_HOME: join(top, 'codex'),
    SONAH_CLAUDE_PROJECTS: join(top, 'claude') };
  return { top, root, base, recording, out, commit, env, state: join(top, 'state') };
}

/** A drawer in place of `drawVisualPage`: it records each input, says it starts, and writes a page (or fails as told). */
function fakeDrawer({ result = 'complete', output = null } = {}) {
  const inputs = [];
  const draw = async (input) => {
    inputs.push({ ...input, reviewPageThere: output ? existsSync(output) : null });
    input.onStart?.(input.outDir);
    if (result === 'throw') throw new Error('SYNTHETIC drawer failure');
    if (result === 'complete') {
      await mkdir(input.outDir, { recursive: true });
      await writeFile(join(input.outDir, 'page.html'), '<!doctype html><title>graphs</title>\n');
      return { status: 'complete', page: join(input.outDir, 'page.html'),
        run: { status: 'complete', totals: { calls: 4, costUsd: 0.637 } } };
    }
    if (result === 'pending') return { status: 'pending', needed: 2, run: { status: 'pending' } };
    return { status: 'failed', code: result };
  };
  return { draw, inputs };
}

/** One review run, every model call counted and every line kept in the order written (`log`: [stream, text]). */
async function review(repo, argv, { drawGraphs = undefined, codePass = true, env = {}, session = codeSession,
  signal = null, installSignals = false } = {}) {
  const calls = [], log = [];
  let out = '', err = '';
  const judge = codeJudge();
  const code = await runSessionReviewCommand([repo.recording, '--concurrency', '1', '--state-dir', repo.state,
    '--no-open', ...(codePass ? ['--code-pass'] : []), ...argv], {
    stdout: { write: (text) => { out += text; log.push(['out', text]); } },
    stderr: { write: (text) => { err += text; log.push(['err', text]); } }, cwd: repo.root,
    env: { ...repo.env, ...env }, installSignals, ...(signal ? { signal } : {}), loadReviews: async () => new Map(),
    openPage: async () => {},
    loadSession: async () => ({ session: session(), hash: sha256('synthetic'), cwd: repo.root }),
    createJudge: ({ onResult }) => async (request) => {
      calls.push(request);
      onResult({ ok: true, backend: 'claude-cli', attestation: 'attested', contextWindow: 1_000_000 });
      return judge(request);
    }, ...(drawGraphs !== undefined ? { drawGraphs } : {}) });
  return { code, calls, out, err, log };
}
const lineAt = (log, text) => log.findIndex(([, said]) => said === `${text}\n`);

test('D219: the words, the option and the help', () => {
  assert.equal(parseSessionReviewArgs(['--no-visual']).noVisual, true);
  assert.equal(parseSessionReviewArgs([]).noVisual, undefined);
  assert.throws(() => parseSessionReviewArgs(['--no-visual', '--no-visual']), { problem: '--no-visual is given twice' });
  // The background review carries it to the review it starts (the /sonah skill's).
  assert.equal(parseSessionReviewArgs(['--session', '11111111-2222-4333-8444-555555555555', '--background',
    '--no-visual']).noVisual, true);
  assert.ok(sessionReviewUsage.split(/[\s,]+/).includes('--no-visual'));
  assert.match(sessionReviewUsage, /^ {2}--no-visual {14}with --format html, do not draw the graphs page$/m);
  // The graphs page's line never reads as the review page's: install.test.js matches `Local page: <review page>`.
  assert.equal(W.page('/a/page.html'), 'Graphs page: /a/page.html');
  assert.equal(reviewLimited({ maxCalls: null, maxInputBytes: null, stopAtUtilization: null }), false);
  for (const field of ['maxCalls', 'maxInputBytes', 'stopAtUtilization'])
    assert.equal(reviewLimited({ [field]: 1 }), true, field);
});

test('D219: the range is the session\'s start commit to HEAD, only when each file of its change is at HEAD', () => {
  const start = 'a'.repeat(40), head = 'b'.repeat(40);
  const files = [{ path: 'src/a.js', state: 'reviewed' }, { path: 'src/gone.js', state: 'deleted', type: 'deleted' },
    { path: 'img/logo.png', state: 'binary', type: 'added' },
    { path: '/elsewhere/x.js', state: 'outside_root' }, { path: 'other.js', state: 'other_repository' }];
  const codePass = { files };
  const all = { atHead: ['src/a.js'], goneAtHead: ['src/gone.js'], cleanAtHead: ['img/logo.png'] };
  assert.deepEqual(reviewGraphsRange({ repo: { start, head, ...all }, codePass }), { base: start, head },
    'a deleted file HEAD does not hold counts, and a binary file git finds clean at HEAD; files outside do not');
  assert.deepEqual(reviewGraphsRange({ repo: { start, head, ...all, goneAtHead: [] }, codePass }),
    { skip: 'uncommitted', base: start });
  assert.deepEqual(reviewGraphsRange({ repo: { start, head, ...all, cleanAtHead: [] }, codePass }),
    { skip: 'uncommitted', base: start }, 'a binary file that git does not find clean at HEAD');
  assert.deepEqual(reviewGraphsRange({ repo: { start, head: start, ...all, atHead: [] }, codePass }),
    { skip: 'uncommitted', base: start }, 'HEAD is the start commit, and a file of the change differs from it');
  // HEAD is the start commit and nothing differs from it (a read-only session, or one that undid its change): no range.
  assert.deepEqual(reviewGraphsRange({ repo: { start, head: start, atHead: [], goneAtHead: [] },
    codePass: { files: [] } }), { skip: 'noCommits' });
  assert.deepEqual(reviewGraphsRange({ repo: { start, head: start, ...all }, codePass }), { skip: 'noCommits' });
  assert.deepEqual(reviewGraphsRange({ repo: { start, head, atHead: [], goneAtHead: [] }, codePass: { files: [] } }),
    { skip: 'noChange', base: start });
  for (const repo of [null, { start: null, head }, { start, head: null }, { start: 'not-a-sha', head }])
    assert.deepEqual(reviewGraphsRange({ repo, codePass }), { skip: 'unknown' });
  // The dry run's line: with the code step off, or no git repository or start commit in its snapshot, it is off and
  // says why.
  const options = { maxCalls: null, maxInputBytes: null, stopAtUtilization: null };
  const snapshot = { root: true, repository: true, top: '/repo', base: { kind: 'git', commit: start } };
  const dry = (extra) => reviewGraphsDryRunLine({ options, backend: 'claude-cli', codeStepOn: true, snapshot, ...extra });
  assert.equal(dry({}), W.dry.on);
  assert.equal(dry({ options: { ...options, noVisual: true } }), W.dry.off);
  assert.equal(dry({ backend: 'codex-cli' }), W.dry.backend);
  assert.equal(dry({ options: { ...options, maxCalls: 9 } }), W.dry.limits);
  assert.equal(dry({ codeStepOn: false, snapshot: null }), W.dry.codeStep);
  assert.equal(reviewGraphsDryRunLine({ options, backend: 'claude-cli' }), W.dry.codeStep, 'by default: no code step');
  assert.match(W.dry.codeStep, /Run sonah visual with a range, such as sonah visual main\.\.HEAD\.$/);
  for (const other of [{ root: false }, { root: true, repository: false, base: { kind: 'recorded_edits' } }])
    assert.equal(dry({ snapshot: other }), W.dry.noRepository, JSON.stringify(other));
  assert.equal(dry({ snapshot: { ...snapshot, base: { kind: 'recorded_edits' } } }), W.dry.unknown);
  assert.equal(/sonah visual/.test(W.dry.noRepository), false, 'no range where no git repository holds the folder');
});

test('D219: an HTML review of committed work draws the graphs page first, and its page links to it; the .md never does',
  async (t) => {
  const repo = await repository(t);
  const head = repo.commit();
  const output = join(repo.out, 'review.html');
  const { draw, inputs } = fakeDrawer({ output });
  const run = await review(repo, ['--format', 'html', '--output', output], { drawGraphs: draw });
  assert.equal(run.code, 0, run.err);
  // One drawing: the session's start commit to HEAD, in the repository's real top folder, with the visual's model, its
  // folder and the review's environment, before the review page is written.
  assert.equal(inputs.length, 1);
  const [input] = inputs;
  assert.deepEqual([input.top, input.base, input.head, input.model], [repo.root, repo.base, head, VISUAL_DEFAULT_MODEL]);
  assert.equal(input.outDir, visualOutDir({ top: repo.root, base: repo.base, head, model: VISUAL_DEFAULT_MODEL,
    env: repo.env }));
  assert.equal(input.env.SONAH_HOME, repo.env.SONAH_HOME);
  assert.equal(input.reviewPageThere, false, 'drawn before the review page is written');
  const graphs = join(input.outDir, 'page.html');
  // The lines: the started line on stderr, then the page's path and its usage on stdout, then the review's page.
  const order = [lineAt(run.log, W.started), lineAt(run.log, W.page(graphs)), lineAt(run.log, W.usage(4, '0.64')),
    lineAt(run.log, `Local page: ${output}`)];
  assert.ok(order.every((i) => i >= 0), JSON.stringify(run.log));
  assert.deepEqual(order, [...order].sort((a, b) => a - b));
  assert.equal(run.log[order[0]][0], 'err');
  assert.equal(run.out.match(/^Local page: /gm).length, 1, 'one Local page line, the review page\'s');
  // The page links to the graphs page once, in its header; the .md beside it names neither the link nor the path.
  const page = await readFile(output, 'utf8');
  const href = pathToFileURL(graphs).href;
  assert.equal(page.split(`href="${href}"`).length - 1, 1);
  assert.ok(page.includes(`<p class="meta graphs"><a href="${href}" rel="noreferrer noopener">`
    + `${REPORT_HEADER_WORDS.graphsPage.replace("'", '&#39;')}</a></p>`), page.slice(0, 4000));
  const md = await readFile(join(repo.out, 'review.md'), 'utf8');
  for (const text of ['file:', input.outDir, repo.env.SONAH_HOME, REPORT_HEADER_WORDS.graphsPage])
    assert.equal(md.includes(text), false, text);
  // No graphs line names a range: it was drawn.
  assert.equal(/sonah visual/.test(run.out + run.err), false);
});

test('D219: --no-visual, a Markdown review and a library call draw nothing and say nothing of it', async (t) => {
  const repo = await repository(t);
  repo.commit();
  const { draw, inputs } = fakeDrawer();
  const off = await review(repo, ['--format', 'html', '--output', join(repo.out, 'off.html'), '--no-visual'],
    { drawGraphs: draw });
  assert.equal(off.code, 0, off.err);
  const md = await review(repo, ['--format', 'md', '--output', join(repo.out, 'only.md')], { drawGraphs: draw });
  assert.equal(md.code, 0, md.err);
  const printed = await review(repo, [], { drawGraphs: draw });
  assert.equal(printed.code, 0, printed.err);
  // As D171's update notice: with no drawer handed in (a library call), nothing is drawn.
  const library = await review(repo, ['--format', 'html', '--output', join(repo.out, 'library.html')]);
  assert.equal(library.code, 0, library.err);
  assert.equal(inputs.length, 0);
  for (const run of [off, md, printed, library]) assert.equal(/Graphs page/.test(run.out + run.err), false, run.out);
  for (const name of ['off.html', 'library.html'])
    assert.equal((await readFile(join(repo.out, name), 'utf8')).includes('href="file:'), false, name);
});

test('D219: uncommitted work, the code review off and another backend are not drawn, each said in one line, on the page too',
  async (t) => {
  const repo = await repository(t);
  const { draw, inputs } = fakeDrawer();
  // The session's work is in the working tree: the graphs page draws commits only.
  const dirty = await review(repo, ['--format', 'html', '--output', join(repo.out, 'dirty.html')], { drawGraphs: draw });
  assert.equal(dirty.code, 0, dirty.err);
  const dirtyLine = G.uncommitted(`${repo.base.slice(0, 12)}..HEAD`);
  assert.ok(dirty.out.includes(`${dirtyLine}\n`), dirty.out);
  // With the code review off, Sonah reads no start commit: the line says so, and names sonah visual with a range.
  const noStart = await review(repo, ['--format', 'html', '--output', join(repo.out, 'nostart.html'), '--no-code-pass'],
    { drawGraphs: draw, codePass: false });
  assert.equal(noStart.code, 0, noStart.err);
  assert.ok(noStart.out.includes(`${G.codeStep}\n`), noStart.out);
  // Another backend: the user chose another provider, so no claude -p call, and no sonah visual named.
  const codex = await review(repo, ['--format', 'html', '--output', join(repo.out, 'codex.html'), '--backend', 'codex-cli',
    '--model', 'gpt-synthetic'], { drawGraphs: draw, codePass: false });
  assert.ok(codex.out.includes(`${G.backend}\n`), `${codex.out}\n${codex.err}`);
  assert.equal(/sonah visual/.test(G.backend), false);
  assert.equal(inputs.length, 0);
  for (const run of [dirty, noStart, codex]) {
    assert.equal(run.out.match(/^Graphs page/gm)?.length, 1, run.out);
    assert.equal(run.err.includes('Graphs page'), false, run.err);
  }
  // The page says the same line where the link would be, once; the .md beside it never does.
  for (const [name, line] of [['dirty', dirtyLine], ['nostart', G.codeStep], ['codex', G.backend]]) {
    const page = await readFile(join(repo.out, `${name}.html`), 'utf8');
    assert.equal(page.includes('href="file:'), false, name);
    assert.equal(page.split(notDrawnLine(line)).length, 2, `${name}: ${page.slice(0, 3000)}`);
    const md = await readFile(join(repo.out, `${name}.md`), 'utf8');
    assert.equal(/Graphs page|sonah visual/.test(md), false, name);
  }
});

test('D219: under a limit of calls or size it is not drawn, and the line names sonah visual with the range',
  async (t) => {
  const repo = await repository(t);
  const head = repo.commit();
  const { draw, inputs } = fakeDrawer();
  const range = `${repo.base.slice(0, 12)}..${head.slice(0, 12)}`;
  for (const [n, limit] of [['--max-calls', '100000'], ['--max-input-bytes', '900000000'],
    ['--stop-at-utilization', '0.99']].entries()) {
    const run = await review(repo, ['--format', 'html', '--output', join(repo.out, `limit-${n}.html`), ...limit],
      { drawGraphs: draw });
    assert.equal(run.code, 0, run.err);
    assert.ok(run.out.includes(`${G.limits(range)}\n`), run.out);
    assert.match(G.limits(range), new RegExp(`run sonah visual ${range}\\.$`));
    assert.ok((await readFile(join(repo.out, `limit-${n}.html`), 'utf8')).includes(notDrawnLine(G.limits(range))));
  }
  assert.equal(inputs.length, 0);
});

test('D219: a graphs page that fails keeps the review\'s exit code and page, with its lines marked on stderr', async (t) => {
  const repo = await repository(t);
  const head = repo.commit();
  const range = `${repo.base.slice(0, 12)}..${head.slice(0, 12)}`;
  const plain = await review(repo, ['--format', 'html', '--output', join(repo.out, 'plain.html')]);
  // The last field: the visual's closed code that the page says the problem and fix of (`other`: VISUAL_FIX_DEFAULT's).
  for (const [name, result, said, failure] of [
    ['auth', 'auth', VISUAL_WORDS.failed('auth', VISUAL_FIX_WORDS.auth), 'auth'],
    ['call', 'call_failed', VISUAL_WORDS.failed('call_failed', VISUAL_FIX_DEFAULT), 'other'],
    ['throw', 'throw', VISUAL_WORDS.failed('visual_failed', VISUAL_FIX_DEFAULT), 'other'],
    ['pending', 'pending', VISUAL_WORDS.pending(2, false), 'other']]) {
    const output = join(repo.out, `${name}.html`);
    const { draw, inputs } = fakeDrawer({ result, output });
    const run = await review(repo, ['--format', 'html', '--output', output], { drawGraphs: draw });
    assert.equal(inputs.length, 1, name);
    assert.equal(run.code, plain.code, `${name}: the review's exit code`);
    assert.equal(/review_failed|Review could not complete/.test(run.out + run.err), false, run.err);
    const marked = `${[...said.split('\n').map((line) => `${W.mark} ${line}`), W.again(range)].join('\n')}\n`;
    assert.ok(run.err.includes(marked), `${name}\n${run.err}`);
    assert.equal(/^Graphs page: \//m.test(run.out), false, 'no page line');
    assert.ok(run.out.includes(`Local page: ${output}`), run.out);
    const page = await readFile(output, 'utf8');
    assert.equal(page.includes('href="file:'), false, `${name}: no link`);
    // The page says it was not drawn, the problem and its fix, with the range: a /sonah background review's reader sees
    // no terminal. The terminal printed the visual's own lines instead.
    assert.ok(page.includes(notDrawnLine(G.failed(range, failure))), `${name}\n${page.slice(0, 3000)}`);
    assert.ok(G.failed(range, failure).includes(`un sonah visual ${range}`), name);
    assert.equal(run.out.includes(G.failed(range, failure)), false);
    assert.equal(/Graphs page: not drawn/.test(run.out + run.err), false, name);
  }
});

test('D219: the dry run says whether a review would draw the graphs page, and draws and sends nothing', async (t) => {
  const repo = await repository(t);
  repo.commit();
  const { draw, inputs } = fakeDrawer();
  const dry = (extra, options = {}) => review(repo, ['--dry-run', ...extra], { drawGraphs: draw, ...options });
  const html = ['--format', 'html', '--output', join(repo.out, 'dry.html')];
  const on = await dry(html);
  assert.equal(on.code, 0, on.err);
  assert.ok(on.out.endsWith(`${W.dry.on}\n`), on.out);
  assert.ok((await dry([...html, '--no-visual'])).out.endsWith(`${W.dry.off}\n`));
  assert.ok((await dry([...html, '--max-calls', '5'])).out.endsWith(`${W.dry.limits}\n`));
  assert.ok((await dry([...html, '--backend', 'codex-cli', '--model', 'gpt-synthetic'], { codePass: false })).out
    .endsWith(`${W.dry.backend}\n`));
  // With the code review off, a review would not draw it: the line says why and names sonah visual with a range.
  assert.ok((await dry([...html, '--no-code-pass'], { codePass: false })).out.endsWith(`${W.dry.codeStep}\n`));
  // A Markdown review never draws it, so its dry run says nothing of it; nor does a library call's.
  assert.equal((await dry([])).out.includes('Graphs page'), false);
  assert.equal((await review(repo, ['--dry-run', ...html])).out.includes('Graphs page'), false);
  assert.equal(inputs.length, 0);
  await assert.rejects(stat(join(repo.out, 'dry.html')));
  await assert.rejects(stat(join(repo.env.SONAH_HOME, 'visual')));
});

const SNAPSHOT = Object.freeze({ root: true, repository: true, top: '/nowhere' });

test('D228 (decision 15, widened): the review gives its drawer no server, so the drawer names the connected one',
  async () => {
  const start = 'a'.repeat(40), head = 'b'.repeat(40);
  // The owner widened decision 15 on 2026-11-12: this page names the server this computer is connected to, as
  // `sonah visual`'s does. It gets that by naming no server at all, so `drawVisualPage` reads the connection
  // (visual-command.js); a `server` given here, even VISUAL_DEFAULT_SERVER, would pin the page to one server again.
  let given = null;
  const page = await reviewGraphsPage({ options: {}, backend: 'claude-cli', repo: { start, head, atHead: ['x.js'],
    goneAtHead: [] }, codePass: { files: [{ path: 'x.js', state: 'reviewed' }] }, snapshot: SNAPSHOT,
  env: { SONAH_HOME: '/nowhere' }, stdout: { write: () => {} }, stderr: { write: () => {} },
  draw: async (options) => { given = options; return { status: 'complete', page: '/nowhere/page.html', run: {} }; } });
  assert.deepEqual(page, { graphsPage: 'file:///nowhere/page.html' });
  assert.ok(given, 'the drawer ran');
  assert.equal(Object.hasOwn(given, 'server'), false, 'the review names no server to the drawer');
  assert.equal(given.server, undefined);
});

test('D219: reviewGraphsPage never rejects, even when a stream throws', async () => {
  const start = 'a'.repeat(40), head = 'b'.repeat(40);
  // No file of the change to compare with HEAD (none changed, or the code review waits, D210): one line, no drawing.
  let said = '', drawn = 0;
  const range = `${start.slice(0, 12)}..HEAD`;
  assert.deepEqual(await reviewGraphsPage({ options: {}, backend: 'claude-cli', repo: { start, head, atHead: [],
    goneAtHead: [] }, codePass: { ran: false, files: [] }, snapshot: SNAPSHOT, env: {},
  stdout: { write: (text) => { said += text; } }, stderr: { write: () => assert.fail('no stderr') },
  draw: async () => { drawn++; } }), { graphsNotDrawn: { code: 'noChange', range } });
  assert.deepEqual([said, drawn], [`${G.noChange(range)}\n`, 0]);
  // A page that was drawn is linked even when no stream can be written to.
  const broken = { write: () => { throw new Error('SYNTHETIC closed stream'); } };
  const page = await reviewGraphsPage({ options: {}, backend: 'claude-cli', repo: { start, head, atHead: ['x.js'],
    goneAtHead: [] }, codePass: { files: [{ path: 'x.js', state: 'reviewed' }] }, snapshot: SNAPSHOT,
  env: { SONAH_HOME: '/nowhere' }, stdout: broken, stderr: broken,
  draw: async () => ({ status: 'complete', page: '/nowhere/page.html', run: {} }) });
  assert.deepEqual(page, { graphsPage: 'file:///nowhere/page.html' });
  // A drawer that throws: the failure, with the range, never a rejection.
  const thrown = await reviewGraphsPage({ options: {}, backend: 'claude-cli', repo: { start, head, atHead: ['x.js'],
    goneAtHead: [] }, codePass: { files: [{ path: 'x.js', state: 'reviewed' }] }, snapshot: SNAPSHOT,
  env: { SONAH_HOME: '/nowhere' }, stdout: broken, stderr: broken, draw: async () => { throw new Error('SYNTHETIC'); } });
  assert.deepEqual(thrown, { graphsNotDrawn: { code: 'failed', range: `${start.slice(0, 12)}..${head.slice(0, 12)}`,
    failure: 'other' } });
});

test('D219: the page says the problem and fix of the visual\'s closed code, which render mirrors, or of `other`',
  async () => {
  // The codes only `sonah visual` itself names, before any job: the review hands the visual two commits it read, in the
  // repository's real top folder, on the visual's default model.
  const commandOnly = ['folder_unreadable', 'not_git', 'base_not_found', 'head_not_found', 'default_branch_unknown',
    'no_merge_base', 'invalid_model'];
  // The codes a drawing ends with (`drawVisualPage`): an empty range, the folder, and each call that stops the job.
  const drawing = ['no_change', 'output_folder_unwritable', ...STOP_ERRORS];
  assert.deepEqual([...commandOnly, ...drawing].sort(), Object.keys(VISUAL_FIX_WORDS).sort());
  assert.deepEqual(Object.keys(REPORT_GRAPHS_FAILURE_WORDS).sort(), [...drawing, 'other'].sort());
  for (const code of drawing) assert.equal(failureCodeOf(code), code);
  // Every other ending has VISUAL_FIX_DEFAULT's fix: a failed call, `visual_failed`, and any other value.
  for (const code of [...commandOnly, ...TRANSPORT_ERRORS.filter((kind) => !STOP_ERRORS.includes(kind)),
    'visual_failed', 'other', 'toString', '__proto__', undefined, 7]) assert.equal(failureCodeOf(code), 'other', String(code));
  // Each failure says its own words, and only `no_change` names no range: the same range would draw nothing again.
  const range = '0123456789ab..fedcba987654';
  const lines = Object.keys(REPORT_GRAPHS_FAILURE_WORDS).map((failure) => G.failed(range, failure));
  assert.equal(new Set(lines).size, lines.length);
  for (const failure of Object.keys(REPORT_GRAPHS_FAILURE_WORDS))
    assert.equal(G.failed(range, failure).includes(range), failure !== 'no_change', failure);
  // Through reviewGraphsPage: the drawer's code is the page's failure; the terminal prints the visual's own lines.
  const start = 'a'.repeat(40), head = 'b'.repeat(40);
  for (const code of [...drawing, 'timeout', 'visual_failed']) {
    let err = '';
    const fact = await reviewGraphsPage({ options: {}, backend: 'claude-cli', repo: { start, head, atHead: ['x.js'],
      goneAtHead: [] }, codePass: { files: [{ path: 'x.js', state: 'reviewed' }] }, snapshot: SNAPSHOT,
    env: { SONAH_HOME: '/nowhere' }, stdout: { write: () => assert.fail('no stdout') },
    stderr: { write: (text) => { err += text; } }, draw: async () => ({ status: 'failed', code }) });
    assert.deepEqual(fact, { graphsNotDrawn: { code: 'failed', range: `${start.slice(0, 12)}..${head.slice(0, 12)}`,
      failure: drawing.includes(code) ? code : 'other' } }, code);
    const fix = Object.hasOwn(VISUAL_FIX_WORDS, code) ? VISUAL_FIX_WORDS[code] : VISUAL_FIX_DEFAULT;
    assert.ok(err.includes(VISUAL_WORDS.failed(code, fix).split('\n').map((line) => `${W.mark} ${line}`).join('\n')),
      code);
  }
});

test('D219: a committed change that holds a binary file draws the graphs page; git decides that file at HEAD',
  async (t) => {
  // The session also writes a binary file (a NUL byte: no text, so the code step holds no sha256 of it). Before D219's
  // fix it could never be at HEAD, so a committed change with an image or a lockfile always read as uncommitted.
  const repo = await repository(t);
  await mkdir(join(repo.root, 'img'));
  await writeFile(join(repo.root, 'img', 'logo.bin'), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x01, 0x02, 0xff]));
  const session = () => codeSession({ writes: [{ path: 'img/logo.bin', text: 'SYNTHETIC binary write' }] });
  const { draw, inputs } = fakeDrawer();
  // Not committed yet: the line says so, with the range once it is.
  // (The review's exit code is its own: with --code-pass, a binary file whose lines it cannot show leaves its coverage
  // short, so it exits 1, drawn or not.)
  const dirty = await review(repo, ['--format', 'html', '--output', join(repo.out, 'dirty.html')],
    { drawGraphs: draw, session });
  assert.ok(dirty.out.includes(`${G.uncommitted(`${repo.base.slice(0, 12)}..HEAD`)}\n`), dirty.out);
  assert.equal(inputs.length, 0);
  const head = repo.commit();
  const run = await review(repo, ['--format', 'html', '--output', join(repo.out, 'committed.html')],
    { drawGraphs: draw, session });
  assert.equal(run.code, dirty.code, run.err);
  assert.equal(inputs.length, 1, run.out);
  assert.deepEqual([inputs[0].base, inputs[0].head], [repo.base, head]);
  assert.equal(/not drawn/.test(run.out), false, run.out);
  // The binary file was part of the change the code step recorded, with no sha256.
  const md = await readFile(join(repo.out, 'committed.md'), 'utf8');
  assert.ok(md.includes('logo.bin'), 'the change holds the binary file');
  // After the commit, a working-tree edit of the binary file is uncommitted again.
  await writeFile(join(repo.root, 'img', 'logo.bin'), Buffer.from([0x00, 0x00, 0x01]));
  const edited = await review(repo, ['--format', 'html', '--output', join(repo.out, 'edited.html')],
    { drawGraphs: draw, session });
  assert.ok(edited.out.includes(`${G.uncommitted(`${repo.base.slice(0, 12)}..HEAD`)}\n`), edited.out);
  assert.equal(inputs.length, 1);
});

test('D219: a session that left HEAD at its start commit with nothing to commit names no range', async (t) => {
  const repo = await repository(t);
  // The working tree as the start commit holds it: the session's write is undone, and nothing was committed.
  execFileSync('git', ['checkout', '--', 'src/parse.js'], { cwd: repo.root, stdio: 'pipe' });
  const { draw, inputs } = fakeDrawer();
  const run = await review(repo, ['--format', 'html', '--output', join(repo.out, 'same.html')], { drawGraphs: draw });
  assert.equal(run.code, 0, run.err);
  assert.ok(run.out.includes(`${G.noCommits}\n`), run.out);
  assert.equal(/sonah visual|\.\.HEAD/.test(G.noCommits), false, 'no empty range is named');
  assert.equal(inputs.length, 0);
  assert.ok((await readFile(join(repo.out, 'same.html'), 'utf8')).includes(notDrawnLine(G.noCommits)));
});

test('D219: a relative SONAH_HOME draws into an absolute folder, and a drawn page is never read as a failure',
  async (t) => {
  const repo = await repository(t);
  const head = repo.commit();
  const output = join(repo.out, 'relative.html');
  const { draw, inputs } = fakeDrawer({ output });
  const env = { SONAH_HOME: join('..', 'relative-sonah') };
  const run = await review(repo, ['--format', 'html', '--output', output], { drawGraphs: draw, env });
  assert.equal(run.code, 0, run.err);
  assert.equal(inputs.length, 1);
  // Read from the folder the review runs in (its `cwd`, the repository here).
  const outDir = resolve(repo.root, visualOutDir({ top: repo.root, base: repo.base, head, model: VISUAL_DEFAULT_MODEL,
    env }));
  assert.equal(inputs[0].outDir, outDir);
  assert.ok(isAbsolute(inputs[0].outDir));
  const graphs = join(outDir, 'page.html');
  assert.ok(run.out.includes(`${W.page(graphs)}\n`), `${run.out}\n${run.err}`);
  assert.equal(/could not complete|not drawn/.test(run.out + run.err), false, run.err);
  assert.ok((await readFile(output, 'utf8')).includes(`href="${pathToFileURL(graphs).href}"`));
  // A drawer that says complete with a relative page, or none: the page, from the folder the review runs in, or the
  // folder it was given.
  const start = 'a'.repeat(40), tip = 'b'.repeat(40);
  const input = { options: {}, backend: 'claude-cli', repo: { start, head: tip, atHead: ['x.js'], goneAtHead: [] },
    codePass: { files: [{ path: 'x.js', state: 'reviewed' }] }, snapshot: SNAPSHOT, cwd: '/work',
    env: { SONAH_HOME: 'rel' }, stdout: { write: () => {} }, stderr: { write: () => {} } };
  assert.deepEqual(await reviewGraphsPage({ ...input, draw: async () => ({ status: 'complete', page: 'rel/page.html' }) }),
    { graphsPage: 'file:///work/rel/page.html' });
  let given = null;
  const drawnNoPage = await reviewGraphsPage({ ...input, draw: async (i) => { given = i.outDir; return { status: 'complete' }; } });
  assert.ok(given.startsWith('/work/rel/visual/'), given);
  assert.deepEqual(drawnNoPage, { graphsPage: pathToFileURL(join(given, 'page.html')).href });
});

test('D219: a stop while the graphs page is drawn abandons it alone; the review writes its page and its usage record',
  async (t) => {
  const start = 'a'.repeat(40), tip = 'b'.repeat(40);
  const range = `${start.slice(0, 12)}..${tip.slice(0, 12)}`;
  const input = { options: {}, backend: 'claude-cli', repo: { start, head: tip, atHead: ['x.js'], goneAtHead: [] },
    codePass: { files: [{ path: 'x.js', state: 'reviewed' }] }, snapshot: SNAPSHOT, env: { SONAH_HOME: '/nowhere' } };
  // The drawer is handed the signal, and never settles: the stop does not wait for it.
  let said = '', handed = null;
  const stopper = new AbortController();
  const stopped = await reviewGraphsPage({ ...input, signal: stopper.signal,
    stdout: { write: (text) => { said += text; } }, stderr: { write: () => {} },
    draw: (i) => { handed = i.signal; stopper.abort(); return new Promise(() => {}); } });
  assert.equal(handed, stopper.signal);
  assert.deepEqual(stopped, { graphsNotDrawn: { code: 'stopped', range } });
  assert.equal(said, `${G.stopped(range)}\n`);
  // A stop before it starts: no drawing.
  let calls = 0;
  assert.deepEqual(await reviewGraphsPage({ ...input, signal: AbortSignal.abort(), stdout: { write: () => {} },
    stderr: { write: () => {} }, draw: async () => { calls++; } }), { graphsNotDrawn: { code: 'stopped', range } });
  assert.equal(calls, 0);

  // Through the review: the review's own stop signal, and Ctrl-C or SIGTERM (the handlers it installs while it draws).
  const repo = await repository(t);
  const head = repo.commit();
  const reviewRange = `${repo.base.slice(0, 12)}..${head.slice(0, 12)}`;
  const plain = await review(repo, ['--format', 'html', '--output', join(repo.out, 'plain.html')]);
  const usageRuns = async () => (await createSessionReviewStore(join(repo.state, 'review')).readUsageRuns()).runs.length;
  const before = await usageRuns();
  const outside = new AbortController();
  const external = await review(repo, ['--format', 'html', '--output', join(repo.out, 'external.html')], {
    signal: outside.signal, drawGraphs: async (i) => { i.onStart(); outside.abort(); return new Promise(() => {}); } });
  assert.equal(external.code, plain.code, external.err);
  assert.ok(external.out.includes(`${G.stopped(reviewRange)}\n`), external.out);
  assert.ok(external.out.includes(`Local page: ${join(repo.out, 'external.html')}`), external.out);
  assert.ok((await readFile(join(repo.out, 'external.html'), 'utf8')).includes(notDrawnLine(G.stopped(reviewRange))));
  assert.equal(await usageRuns(), before + 1, 'the run\'s usage record is kept');
  // The process handlers: one more SIGINT and SIGTERM listener while it draws, none left after. The test calls the
  // review's SIGINT listener itself (no signal is sent to the test's process).
  const counts = () => [process.listenerCount('SIGINT'), process.listenerCount('SIGTERM')];
  const outsideCounts = counts();
  let during = null;
  const signalled = await review(repo, ['--format', 'html', '--output', join(repo.out, 'signalled.html')], {
    installSignals: true, drawGraphs: async (i) => {
      during = counts();
      i.onStart();
      process.listeners('SIGINT').at(-1)();
      return new Promise(() => {});
    } });
  assert.deepEqual(during, outsideCounts.map((n) => n + 1));
  assert.deepEqual(counts(), outsideCounts);
  assert.equal(signalled.code, plain.code, signalled.err);
  assert.ok(signalled.out.includes(`${G.stopped(reviewRange)}\n`), signalled.out);
  assert.ok((await readFile(join(repo.out, 'signalled.html'), 'utf8')).includes(notDrawnLine(G.stopped(reviewRange))));
  assert.equal(await usageRuns(), before + 2);
});

/** Answers the visual's stand-in gives, built from the requests and the facts (as visual-command.test.js does). */
function standInRules(facts) {
  const firstLine = (s) => s.split('\n')[0];
  const fnReqs = functionRequests(facts);
  const functionsAnswer = (req) => ({ functions: Object.keys(req.ids).map((id) => ({ id,
    summary: 'Does its part of the change.', change: 'Changes what this part does in the new version.' })) });
  const fnRecords = fnReqs.map((r) => ({ id: r.id, kind: r.kind, answer: mapAnswerIds(r, functionsAnswer(r)),
    error: null }));
  const story = storyRequest(facts, checkFunctions(facts, fnRecords).value);
  const short = Object.fromEntries(Object.entries(story.ids).map(([s, stable]) => [stable, s]));
  const fns = facts.functions.filter((f) => f.fold == null).slice(0, 3).map((f) => short[f.id]);
  const steps = [{ id: 's1', label: 'A caller starts it', fn: null, ext: 'caller', was: null, isNew: false },
    ...fns.map((fn, i) => ({ id: `s${i + 2}`, label: `Step ${i + 1} runs`, fn, ext: null,
      was: i === 0 ? 'ran the old way' : null, isNew: i < 2 }))];
  const edges = steps.slice(1).map((s, i) => ({ from: steps[i].id, to: s.id, label: null, kind: 'main' }));
  const storyAnswer = { oneLine: 'The change splits the input on commas.', ask: 'Make parse split on commas.',
    beforeNow: [{ before: 'It split on semicolons.', now: 'It splits on commas.' }],
    flows: [{ title: 'One call through the change', steps, edges }], glossary: [] };
  const findings = findingsRequest(facts);
  const byId = new Map(facts.functions.map((f) => [f.id, f]));
  const [fnShort, row] = Object.entries(findings.ids).map(([s, stable]) => [s, byId.get(stable)?.diff
    ?.find((r) => r[0] === '+' && r[3].trim().length >= 8)]).find(([, r]) => r);
  const findingsAnswer = { findings: [{ tier: 'must-know', title: 'A consequence a reviewer should know',
    oneLine: 'When this line runs, the new path is taken.', fns: [fnShort], quote: row[3].trim().slice(0, 60).trim() }] };
  return [
    ...fnReqs.map((r) => ({ when: r.prompt.split('\n').at(-1), text: JSON.stringify(functionsAnswer(r)) })),
    { when: firstLine(STORY_SYSTEM), text: JSON.stringify(storyAnswer) },
    { when: firstLine(FINDINGS_SYSTEM), text: JSON.stringify(findingsAnswer) },
  ];
}

test('D219: with the real drawer, the review draws the graphs page with sonah visual\'s job and links to the page it wrote',
  { timeout: 120_000 }, async (t) => {
  const repo = await repository(t);
  const head = repo.commit();
  // The visual's stand-in as `claude`, first on PATH, and its replies in the review's HOME.
  const bin = join(repo.top, 'bin');
  await mkdir(bin);
  await copyFile(FAKE_CLAUDE, join(bin, 'claude'));
  await chmod(join(bin, 'claude'), 0o755);
  await mkdir(repo.env.HOME, { recursive: true });
  const facts = await extract({ repoDir: repo.root, base: repo.base, head });
  await writeFile(join(repo.env.HOME, 'fake-claude.json'), JSON.stringify({ rules: standInRules(facts) }));
  const env = { PATH: `${bin}:${dirname(process.execPath)}:/usr/bin:/bin`, ANTHROPIC_API_KEY: 'not-a-key' };
  const lazyBefore = process.env.GIT_NO_LAZY_FETCH;
  const output = join(repo.out, 'real.html');
  const run = await review(repo, ['--format', 'html', '--output', output], { drawGraphs: drawVisualPage, env });
  assert.equal(run.code, 0, run.err);
  assert.equal(process.env.GIT_NO_LAZY_FETCH, lazyBefore, 'the review process\'s environment is as it was');
  const folder = visualOutDir({ top: repo.root, base: repo.base, head, model: VISUAL_DEFAULT_MODEL, env: repo.env });
  const graphs = join(folder, 'page.html');
  assert.ok(run.out.includes(`${W.page(graphs)}\n`), `${run.out}\n${run.err}`);
  assert.match(run.out, /^Graphs page usage: \d+ model calls?, list cost \$\d+\.\d\d, as the footer of the page counts them\.$/m);
  assert.ok(run.err.includes(`${W.started}\n`));
  assert.match(readFileSync(graphs, 'utf8'), /^<!doctype html>/i);
  // D221: the review's graphs page, like sonah visual's, has Save online for the repository its remote names, on the
  // default server, with its branch.
  const graphsPage = readFileSync(graphs, 'utf8');
  assert.ok(graphsPage.includes(`id="saveonline" href="https://pr.sonah.dev/share?owner=example-org&amp;`
    + `repo=example-api&amp;head=${head}"`));
  assert.ok(graphsPage.includes('<script type="application/json" id="sonah-upload" data-action="https://pr.sonah.dev/'
    + 'share">{"repo":{"owner":"example-org","name":"example-api"},"branch":"main",'));
  assert.ok((await readFile(output, 'utf8')).includes(`href="${pathToFileURL(graphs).href}"`));
  // The calls: the visual's model, on the person's login (no API key), none of the review's.
  const calls = readFileSync(join(repo.env.HOME, 'fake-claude.log.jsonl'), 'utf8').split('\n').filter(Boolean)
    .map((line) => JSON.parse(line));
  // The story's and the findings' calls at least (a change of one value asks no function's).
  assert.ok(calls.length >= 2, JSON.stringify(calls.map((c) => c.stdin.slice(0, 80))));
  for (const call of calls) {
    assert.equal(call.argv[call.argv.indexOf('--model') + 1], VISUAL_DEFAULT_MODEL);
    assert.equal(Object.hasOwn(call.env, 'ANTHROPIC_API_KEY'), false);
  }
  // The same review again reuses the graphs' stored answers: no new call.
  const again = await review(repo, ['--format', 'html', '--output', join(repo.out, 'again.html')],
    { drawGraphs: drawVisualPage, env });
  assert.equal(again.code, 0, again.err);
  assert.equal(readFileSync(join(repo.env.HOME, 'fake-claude.log.jsonl'), 'utf8').split('\n').filter(Boolean).length,
    calls.length);
});

test('D219: drawVisualPage puts GIT_NO_LAZY_FETCH back as it found it', async (t) => {
  const repo = await repository(t);
  const head = repo.commit();
  const before = process.env.GIT_NO_LAZY_FETCH;
  t.after(() => { if (before === undefined) delete process.env.GIT_NO_LAZY_FETCH; else process.env.GIT_NO_LAZY_FETCH = before; });
  for (const value of [undefined, '0']) {
    if (value === undefined) delete process.env.GIT_NO_LAZY_FETCH; else process.env.GIT_NO_LAZY_FETCH = value;
    const outDir = join(repo.top, `replay-${value ?? 'none'}`);
    const drawn = await drawVisualPage({ top: repo.root, base: repo.base, head, outDir, replayOnly: true,
      env: repo.env });
    assert.equal(drawn.status, 'pending', JSON.stringify(drawn));
    assert.equal(process.env.GIT_NO_LAZY_FETCH, value);
  }
  // The empty range is named before any folder is made.
  const empty = await drawVisualPage({ top: repo.root, base: head, head, outDir: join(repo.top, 'empty'), env: repo.env });
  assert.deepEqual(empty, { status: 'failed', code: 'no_change' });
  await assert.rejects(stat(join(repo.top, 'empty')));
});

test('D219: once its signal is aborted, drawVisualPage starts no claude call', { timeout: 60_000 }, async (t) => {
  const repo = await repository(t);
  const head = repo.commit();
  const bin = join(repo.top, 'bin');
  await mkdir(bin);
  await copyFile(FAKE_CLAUDE, join(bin, 'claude'));
  await chmod(join(bin, 'claude'), 0o755);
  await mkdir(repo.env.HOME, { recursive: true });
  const facts = await extract({ repoDir: repo.root, base: repo.base, head });
  await writeFile(join(repo.env.HOME, 'fake-claude.json'), JSON.stringify({ rules: standInRules(facts) }));
  const env = { ...repo.env, PATH: `${bin}:${dirname(process.execPath)}:/usr/bin:/bin` };
  const drawn = await drawVisualPage({ top: repo.root, base: repo.base, head, outDir: join(repo.top, 'stopped'), env,
    signal: AbortSignal.abort() });
  assert.notEqual(drawn.status, 'complete', JSON.stringify(drawn));
  assert.equal(existsSync(join(repo.env.HOME, 'fake-claude.log.jsonl')), false, 'no claude was started');
  // The same drawing with a signal that is never aborted asks as before.
  const asked = await drawVisualPage({ top: repo.root, base: repo.base, head, outDir: join(repo.top, 'asked'), env,
    signal: new AbortController().signal });
  assert.equal(asked.status, 'complete', JSON.stringify(asked));
  assert.ok(existsSync(join(repo.env.HOME, 'fake-claude.log.jsonl')));
});
