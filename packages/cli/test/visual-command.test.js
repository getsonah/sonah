// D216: `sonah visual`, through the real entry, on a synthetic git repository in a temp folder (fixed author and dates,
// no user or system git config). The model is a stand-in: packages/visual/test/fake-claude.mjs, copied into a temp
// folder as `claude` and put first on PATH; it logs each call's argv and environment. SONAH_HOME and HOME are temp
// folders, and SONAH_NO_UPDATE_CHECK is set in every run of the entry: nothing here reaches a network or a real model.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFile, execFileSync } from 'node:child_process';
import { copyFileSync, chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync,
  statSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { extract } from '../../visual/src/extract.mjs';
import { functionRequests, storyRequest, findingsRequest, mapAnswerIds, STORY_SYSTEM, FINDINGS_SYSTEM }
  from '../../visual/src/requests.mjs';
import { checkFunctions } from '../../visual/src/checks.mjs';
import { shareLink } from '../../visual/src/render.mjs';
import { parseVisualArgs, remoteRepository, runVisualCommand, visualRange, visualServer, visualShare, visualUsage,
  VISUAL_DEFAULT_MODEL, VISUAL_DEFAULT_SERVER } from '../src/visual-command.js';
import { runGit } from '../src/code-snapshot.js';

const exec = promisify(execFile);
// fileURLToPath, never URL.pathname: a checkout may live under a folder with a space in its name.
const BIN = fileURLToPath(new URL('../bin/sonah.js', import.meta.url));
const FAKE = fileURLToPath(new URL('../../visual/test/fake-claude.mjs', import.meta.url));
const NODE_DIR = dirname(process.execPath);
const BASE_PATH = `${NODE_DIR}:/usr/bin:/bin`;
const firstLine = (s) => s.split('\n')[0];

let scratch, repo, bin, base, head;

/** git in the synthetic repository: no user or system config, a fixed author and fixed dates. */
const git = (args, cwd = repo) => execFileSync('git', args, { cwd, encoding: 'utf8', env: { PATH: BASE_PATH,
  HOME: scratch, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: join(scratch, 'no-git-config'), LC_ALL: 'C',
  GIT_AUTHOR_NAME: 'Test', GIT_AUTHOR_EMAIL: 'test@example.com', GIT_AUTHOR_DATE: '2026-01-02T03:04:05Z',
  GIT_COMMITTER_NAME: 'Test', GIT_COMMITTER_EMAIL: 'test@example.com', GIT_COMMITTER_DATE: '2026-01-02T03:04:05Z' } })
  .trim();

before(() => {
  scratch = realpathSync(mkdtempSync(join(tmpdir(), 'sonah-visual-cli-')));
  writeFileSync(join(scratch, 'no-git-config'), '');
  repo = join(scratch, 'widget');
  mkdirSync(join(repo, 'src'), { recursive: true });
  git(['init', '-q', '-b', 'main']);
  writeFileSync(join(repo, 'src', 'calc.js'), ['export function add(a, b) {', '  return a + b;', '}', '',
    'export function scale(value, factor) {', '  return value * factor;', '}', ''].join('\n'));
  git(['add', '.']);
  git(['commit', '-q', '-m', 'Add the calculator']);
  base = git(['rev-parse', 'HEAD']);
  git(['checkout', '-q', '-b', 'feature']);
  writeFileSync(join(repo, 'src', 'calc.js'), ['export function add(a, b) {',
    '  if (typeof a !== \'number\' || typeof b !== \'number\') throw new TypeError(\'add takes numbers\');',
    '  return a + b;', '}', '', 'export function scale(value, factor) {', '  return clamp(value * factor, 0, 100);',
    '}', '', 'export function clamp(value, low, high) {', '  return Math.min(high, Math.max(low, value));', '}', '']
    .join('\n'));
  git(['commit', '-q', '-am', 'Check the inputs and clamp the scale']);
  head = git(['rev-parse', 'HEAD']);
  // The stand-in CLI as `claude`, first on PATH.
  bin = join(scratch, 'bin');
  mkdirSync(bin);
  copyFileSync(FAKE, join(bin, 'claude'));
  chmodSync(join(bin, 'claude'), 0o755);
});
after(() => rmSync(scratch, { recursive: true, force: true }));

/** A fresh HOME and SONAH_HOME for one run: `rules` are the stand-in's replies (none: no fake-claude.json). */
function box(name, rules = null) {
  const home = join(scratch, name);
  mkdirSync(home);
  if (rules) writeFileSync(join(home, 'fake-claude.json'), JSON.stringify({ rules }));
  return { home, sonah: join(home, '.sonah') };
}

/** The entry with `args`, from `cwd`: an API key in its environment (it must not reach a call), and the stand-in on
 *  PATH unless `path` says otherwise. */
async function run(args, { home, sonah, cwd = repo, path = `${bin}:${BASE_PATH}`, env = {} }) {
  const options = { cwd, timeout: 120_000, killSignal: 'SIGKILL', maxBuffer: 16 * 1024 * 1024,
    env: { HOME: home, SONAH_HOME: sonah, PATH: path, SONAH_NO_UPDATE_CHECK: '1', ANTHROPIC_API_KEY: 'not-a-key',
      ...env } };
  try { const r = await exec(process.execPath, [BIN, ...args], options); return { code: 0, ...r }; }
  catch (e) { return { code: e.killed ? 'timeout' : e.code, stdout: e.stdout ?? '', stderr: e.stderr ?? '' }; }
}

const calls = (home) => {
  const log = join(home, 'fake-claude.log.jsonl');
  return existsSync(log) ? readFileSync(log, 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line)) : [];
};
const mode = (path) => statSync(path).mode & 0o777;

// Answers a stand-in would give, built from the requests and the facts (as packages/visual/test/job.test.js does).
function standInRules(facts) {
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
  const storyAnswer = { oneLine: 'The change checks the inputs and keeps the scale in its bounds.',
    ask: 'Make the program behave as the commit message says.',
    beforeNow: [{ before: 'It worked the old way.', now: 'It works the new way.' }],
    flows: [{ title: 'One call through the change', steps, edges }], glossary: [] };
  const findings = findingsRequest(facts);
  const byId = new Map(facts.functions.map((f) => [f.id, f]));
  const [fnShort, row] = Object.entries(findings.ids).map(([s, stable]) => [s, byId.get(stable)?.diff
    ?.find((r) => r[0] === '+' && r[3].trim().length >= 8)]).find(([, r]) => r);
  const findingsAnswer = { findings: [{ tier: 'must-know', title: 'A consequence a reviewer should know',
    oneLine: 'When this line runs, the new path is taken.', fns: [fnShort],
    quote: row[3].trim().slice(0, 60).trim() }] };
  return [
    ...fnReqs.map((r) => ({ when: r.prompt.split('\n').at(-1), text: JSON.stringify(functionsAnswer(r)) })),
    { when: firstLine(STORY_SYSTEM), text: JSON.stringify(storyAnswer) },
    { when: firstLine(FINDINGS_SYSTEM), text: JSON.stringify(findingsAnswer) },
  ];
}

test('the range shapes and the options, before anything is read', () => {
  assert.deepEqual(visualRange('main..HEAD'), { base: 'main', head: 'HEAD' });
  assert.deepEqual(visualRange('main..'), { base: 'main', head: 'HEAD' });
  assert.deepEqual(visualRange('v1.2'), { base: 'v1.2', head: 'HEAD' });
  assert.deepEqual(visualRange('a~2..b^'), { base: 'a~2', head: 'b^' });
  for (const bad of ['', '..', '..b', 'a...b', 'a..b..c', '-x', 'a..-b', 'a ..b', 'a\0..b', 'a\t'])
    assert.equal(visualRange(bad), null, JSON.stringify(bad));
  assert.deepEqual(parseVisualArgs([]), { range: null, out: null, model: null, replayOnly: false, server: null,
    help: false });
  assert.deepEqual(parseVisualArgs(['a..b', '--out', 'o', '--model', 'm', '--replay-only']),
    { range: { base: 'a', head: 'b' }, out: 'o', model: 'm', replayOnly: true, server: null, help: false });
  // D221: --server, as the page may name it.
  assert.equal(parseVisualArgs(['--server', 'https://sonah.example.com/team/']).server, 'https://sonah.example.com/team');
  assert.equal(VISUAL_DEFAULT_SERVER, 'https://pr.sonah.dev');
  assert.equal(parseVisualArgs(['--out', '-h']).help, true, '--help is a question, wherever it stands');
  assert.equal(VISUAL_DEFAULT_MODEL, 'claude-sonnet-5-5');
  for (const line of visualUsage.split('\n')) assert.ok(line.length <= 80, `wider than 80 columns: ${line}`);
});

test('sonah visual --help prints its usage and writes nothing', async () => {
  const where = box('help');
  for (const flag of ['--help', '-h']) {
    const r = await run(['visual', flag], { ...where, path: '/usr/bin:/bin' });
    assert.equal(r.code, 0, r.stderr);
    assert.equal(r.stdout, `${visualUsage}\n`);
    assert.match(r.stdout, /^usage: sonah visual \[BASE\.\.HEAD\] \[--out DIR\] \[--model ID\] \[--replay-only\]$/m);
  }
  assert.deepEqual(readdirSync(where.home), []);
});

test('a usage error exits 2, names the problem and writes nothing', async () => {
  const where = box('usage');
  for (const [args, said] of [
    [['a...b'], 'the range takes the form BASE..HEAD, BASE.. or BASE.'],
    [['..b'], 'the range takes the form BASE..HEAD, BASE.. or BASE.'],
    [['a..b..c'], 'the range takes the form BASE..HEAD, BASE.. or BASE.'],
    [['main..', 'HEAD'], 'more than one range is given.'],
    [['--out'], '--out needs a value.'],
    [['--model', '--replay-only'], '--model needs a value.'],
    [['--replay-only', '--replay-only'], '--replay-only is given twice.'],
    [['--out=elsewhere'], 'unknown option --out=...'],
    [['--server', 'http://sonah.example.com'], '--server takes an https address, such as https://pr.sonah.dev.'],
    [['--server', 'https://sonah.example.com/?team=1'], '--server takes an https address, such as https://pr.sonah.dev.'],
    [['--server', '--replay-only'], '--server needs a value.'],
    [['--fast'], 'unknown option --fast.']]) {
    const r = await run(['visual', ...args], where);
    assert.equal(r.code, 2, args.join(' '));
    assert.equal(r.stderr, `sonah visual: ${said}\nusage: sonah visual [BASE..HEAD] [--out DIR] [--model ID] `
      + '[--replay-only]\n                    [--server URL]\nRun sonah visual --help to see the options.\n',
    args.join(' '));
    assert.equal(r.stdout, '');
  }
  assert.deepEqual(readdirSync(where.home), []);
});

test('a problem with its fix exits 2: no repository, a range git cannot find, no change, a model alias',
  async () => {
  const where = box('problems');
  const outside = join(scratch, 'not-a-repository');
  mkdirSync(outside);
  for (const [args, code, cwd] of [[['main..HEAD'], 'not_git', outside], [['nope..HEAD'], 'base_not_found', repo],
    [['main..nope'], 'head_not_found', repo], [['HEAD..HEAD'], 'no_change', repo],
    [[head], 'no_change', repo], [['HEAD..main'], 'no_change', repo], // a head behind its base adds nothing
    [['main', '--model', 'sonnet'], 'invalid_model', repo]]) {
    const r = await run(['visual', ...args], { ...where, cwd });
    assert.equal(r.code, 2, `${args.join(' ')}: ${r.stderr}`);
    assert.match(r.stderr, new RegExp(`^Visual review could not complete: ${code}\\.\\nFix: \\S.*\\n$`),
      args.join(' '));
    assert.equal(r.stdout, '');
  }
  assert.deepEqual(readdirSync(where.home), [], 'nothing is made before the range is found');
});

test('no range: the base is where HEAD left the remote\'s default branch, from local refs only; --replay-only with '
  + 'no stored answers exits 1', async () => {
  const where = box('default');
  const noDefault = async () => {
    const r = await run(['visual'], where);
    assert.equal(r.code, 2, r.stderr);
    assert.match(r.stderr, new RegExp('^Visual review could not complete: default_branch_unknown\\.\\nFix: Give a '
      + 'range, such as sonah visual main\\.\\.HEAD\\. Or run git remote set-head origin --auto'));
  };
  await noDefault(); // no remote
  git(['remote', 'add', 'origin', join(scratch, 'no-such-remote.git')]);
  git(['update-ref', 'refs/remotes/origin/main', base]);
  await noDefault(); // a remote whose HEAD git has not set here
  git(['symbolic-ref', 'refs/remotes/origin/HEAD', 'refs/remotes/origin/main']);
  try {
    const r = await run(['visual', '--replay-only'], where);
    assert.equal(r.code, 1, r.stderr);
    const place = `widget-${createHash('sha256').update(realpathSync(repo)).digest('hex').slice(0, 8)}`;
    const out = join(where.sonah, 'visual', place, `${base.slice(0, 12)}-${head.slice(0, 12)}-claude-sonnet-5-5`);
    assert.equal(r.stderr, `Sonah draws the change from ${base.slice(0, 12)} to ${head.slice(0, 12)}. It keeps the `
      + `requests and answers in ${out}.\n`);
    const needed = JSON.parse(readFileSync(join(out, 'run.json'), 'utf8')).needed;
    assert.ok(needed.length > 0);
    const count = `${needed.length} answer${needed.length === 1 ? ' is' : 's are'}`;
    assert.equal(r.stdout, `Visual review is not complete: at least ${count} `
      + 'still needed. Run the same command without --replay-only to ask for them.\n');
    for (const id of needed) assert.ok(existsSync(join(out, 'requests', `${id}.json`)), `request ${id} is written`);
    assert.ok(!existsSync(join(out, 'page.html')));
    // Every folder Sonah made is readable by its owner only.
    for (const folder of [where.sonah, join(where.sonah, 'visual'), join(where.sonah, 'visual', place), out,
      join(out, 'requests'), join(out, 'answers')]) assert.equal(mode(folder), 0o700, folder);
    assert.deepEqual(calls(where.home), [], '--replay-only sends nothing');
  } finally {
    git(['remote', 'remove', 'origin']);
  }
});

test('with no push remote, a full run writes the local page with no share or upload, on the person\'s login; a rerun '
  + 'replays it',
  async () => {
  const facts = await extract({ repoDir: repo, base, head });
  const where = box('full', standInRules(facts));
  const out = join(scratch, 'full-out');
  const r = await run(['visual', `${base}..feature`, '--out', out], { ...where,
    env: { CLAUDE_CONFIG_DIR: 'claude-config' } });
  assert.equal(r.code, 0, r.stderr + r.stdout);
  assert.equal(r.stdout, `Local page: ${join(out, 'page.html')}\n`);
  const page = readFileSync(join(out, 'page.html'), 'utf8');
  assert.doesNotMatch(page, /id="saveonline"/);
  assert.doesNotMatch(page, /data-intent="invite"/);
  assert.doesNotMatch(page, /id="sonah-upload"/, 'no upload is carried');
  assert.doesNotMatch(page, /@import/, 'a page opened from disk requests no font');
  const urls = new Set(page.match(/https?:\/\/[^\s"'<>)\\]+/g) ?? []);
  for (const url of urls) assert.match(url, /^http:\/\/www\.w3\.org\/(?:2000\/svg|1999\/xlink)$/, url);
  assert.ok(!page.includes('https://'), 'no https address at all');
  for (const folder of [out, join(out, 'requests'), join(out, 'answers')]) assert.equal(mode(folder), 0o700, folder);
  const ran = JSON.parse(readFileSync(join(out, 'run.json'), 'utf8'));
  assert.deepEqual([ran.status, ran.range], ['complete', { base, head }]);
  for (const kind of ['functions', 'story', 'findings'])
    assert.ok(ran.requests.some((r) => r.kind === kind && !r.error && r.by === 'claude-cli'), `${kind} is answered`);
  assert.deepEqual(ran.totals.dropped, {}, 'every answer passed its checks');

  // Each call ran on the person's Claude Code login: no API key, the config folder made absolute, the full model id.
  const made = calls(where.home);
  assert.ok(made.length >= 3, `${made.length} calls`);
  for (const call of made) {
    assert.equal(call.env.ANTHROPIC_API_KEY, undefined);
    assert.ok(isAbsolute(call.env.CLAUDE_CONFIG_DIR));
    assert.ok([resolve(repo, 'claude-config'), resolve(realpathSync(repo), 'claude-config')]
      .includes(call.env.CLAUDE_CONFIG_DIR), call.env.CLAUDE_CONFIG_DIR);
    assert.equal(call.argv[call.argv.indexOf('--model') + 1], VISUAL_DEFAULT_MODEL);
  }

  // The same range again, sending nothing: the stored answers draw the same page.
  const again = await run(['visual', `${base}..feature`, '--out', out, '--replay-only'], where);
  assert.equal(again.code, 0, again.stderr);
  assert.equal(readFileSync(join(out, 'page.html'), 'utf8'), page);
  assert.equal(calls(where.home).length, made.length);

  // D218: a caller's presentPage is handed the written page in place of the Local page line (bare `sonah` prints that
  // line itself and opens the page).
  const shown = [], printed = { stdout: '', stderr: '' };
  const code = await runVisualCommand([`${base}..feature`, '--out', out, '--replay-only'], { cwd: repo,
    env: { HOME: where.home, SONAH_HOME: where.sonah }, stdout: { write: (text) => { printed.stdout += text; } },
    stderr: { write: (text) => { printed.stderr += text; } }, presentPage: async (file) => { shown.push(file); } });
  assert.equal(code, 0, printed.stderr);
  assert.deepEqual(shown, [join(out, 'page.html')]);
  assert.equal(printed.stdout, '');
  assert.equal(calls(where.home).length, made.length);
});

test('a call that stops on the account exits 2 with its fix; no claude on PATH is cli_missing', async () => {
  const signedOut = box('auth', [{ mode: 'auth' }]);
  const r = await run(['visual', `${base}..${head}`, '--out', join(scratch, 'auth-out')], signedOut);
  assert.equal(r.code, 2, r.stderr);
  assert.ok(r.stderr.includes('\nVisual review could not complete: auth.\nFix: Run claude auth login with your Claude '
    + 'subscription account, then run the same command again.'), r.stderr);
  assert.doesNotMatch(r.stderr, /please sign in/, 'never the provider\'s own words');
  assert.equal(r.stdout, '');
  assert.ok(!existsSync(join(scratch, 'auth-out', 'page.html')));

  // a PATH that holds git and nothing else, so no claude can be found (not even one installed in /usr/bin)
  const missing = box('missing');
  const onlyGit = join(scratch, 'only-git');
  mkdirSync(onlyGit);
  const gitPath = execFileSync('/bin/sh', ['-c', 'command -v git'], { encoding: 'utf8', env: { PATH: BASE_PATH } })
    .trim();
  writeFileSync(join(onlyGit, 'git'), `#!/bin/sh\nexec ${JSON.stringify(gitPath)} "$@"\n`, { mode: 0o755 });
  const m = await run(['visual', `${base}..${head}`, '--out', join(scratch, 'missing-out')], { ...missing,
    path: onlyGit });
  assert.equal(m.code, 2, m.stderr);
  assert.match(m.stderr, /\nVisual review could not complete: cli_missing\.\nFix: Sonah could not start claude\./);
});

/** D221: what a local page carries for "Save online" and "Invite your team" (render.mjs: a JSON script element), as
 *  `{ action, body }`, or null when it carries none. */
function carried(page) {
  const found = /<script type="application\/json" id="sonah-upload" data-action="([^"]*)">([\s\S]*?)<\/script>/
    .exec(page);
  return found ? { action: found[1], body: JSON.parse(found[2]) } : null;
}
/** The page without the upload it carries: the review it would send holds the hosted page, which keeps its font link. */
const withoutUpload = (page) => page.replace(/<script type="application\/json" id="sonah-upload"[\s\S]*?<\/script>/,
  '');

test('D221: the remote URL forms that name a repository, the addresses --server takes, and the branch of the head',
  async () => {
  const widget = { owner: 'example-org', name: 'widget' };
  for (const [url, named] of [['https://github.com/example-org/widget.git', widget],
    ['https://github.com/example-org/widget/', widget], ['git@github.com:example-org/widget.git', widget],
    ['ssh://git@github.com/example-org/widget.git', widget], ['git@git.example.com:example-org/widget', widget],
    ['https://gitlab.example.com/group/example-org/widget.git', widget]])
    assert.deepEqual(remoteRepository(url), named, url);
  for (const url of ['/srv/git/example-org/widget.git', './example-org/widget', '../example-org/widget.git',
    'file:///srv/git/example-org/widget.git', 'https://github.com/widget', 'https://github.com/example.org/widget',
    'https://github.com/example-org/..', 'ext::ssh -i key host example-org/widget', '', null])
    assert.equal(remoteRepository(url), null, String(url));

  for (const [text, server] of [['https://pr.sonah.dev', 'https://pr.sonah.dev'],
    ['https://pr.sonah.dev/', 'https://pr.sonah.dev'], ['https://sonah.example.com/team/', 'https://sonah.example.com/team'],
    ['http://127.0.0.1:8787', 'http://127.0.0.1:8787'], ['http://localhost:8787/', 'http://localhost:8787'],
    ['http://[::1]:8787', 'http://[::1]:8787']]) assert.equal(visualServer(text), server, text);
  for (const text of ['http://sonah.example.com', 'https://you@sonah.example.com', 'https://sonah.example.com/?a',
    'https://sonah.example.com#a', 'ftp://sonah.example.com', 'sonah.example.com', 'https://sonah.example.com/ x', '',
    null]) assert.equal(visualServer(text), null, String(text));

  const share = (sha, options = {}) => visualShare({ top: repo, head: sha, shareLink, ...options });
  assert.equal(await share(head), null, 'no remote: no buttons');
  git(['remote', 'add', 'origin', 'https://github.com/example-org/widget.git']);
  try {
    const link = (sha) => shareLink(VISUAL_DEFAULT_SERVER, { owner: 'example-org', repo: 'widget', head: sha });
    assert.deepEqual(await share(head), { url: link(head), branch: 'feature' }, 'the checked-out branch');
    assert.deepEqual(await share(base), { url: link(base), branch: 'main' }, 'the branch whose tip it is');
    // A commit no branch points at goes with no branch: its saves are one saved review per head.
    const loose = git(['commit-tree', `${head}^{tree}`, '-p', head, '-m', 'Not on a branch']);
    assert.deepEqual(await share(loose), { url: link(loose), branch: null });
    assert.deepEqual(await share(head, { server: 'http://127.0.0.1:8787' }), { url: shareLink('http://127.0.0.1:8787',
      { owner: 'example-org', repo: 'widget', head }), branch: 'feature' });
    assert.equal(await share(head, { server: null }), null, 'no server: no buttons');
    assert.equal(await share('a'.repeat(64)), null, 'the server takes a SHA-1 commit only');
    assert.equal(await share(head, { git: async () => ({ ok: false, stdout: null }) }), null, 'git failed: no buttons');
    assert.equal(await share(head, { git: async () => { throw new Error('SYNTHETIC'); } }), null);
    // Only local reads: no git call here reaches a remote.
    const asked = [];
    await share(head, { git: (args, options) => { asked.push(args[0]); return runGit(args, options); } });
    assert.deepEqual([...new Set(asked)].sort(), ['config', 'for-each-ref', 'remote', 'symbolic-ref']);
  } finally {
    git(['remote', 'remove', 'origin']);
  }
});

test('D221: with a push remote, the page has Save online and Invite your team and carries its review for them',
  async () => {
  const facts = await extract({ repoDir: repo, base, head });
  const where = box('share', standInRules(facts));
  const out = join(scratch, 'share-out');
  git(['remote', 'add', 'origin', 'git@github.com:example-org/widget.git']);
  try {
    const r = await run(['visual', `${base}..feature`, '--out', out], where);
    assert.equal(r.code, 0, r.stderr + r.stdout);
    assert.equal(r.stdout, `Local page: ${join(out, 'page.html')}\n`);
    const page = readFileSync(join(out, 'page.html'), 'utf8');
    const link = `https://pr.sonah.dev/share?owner=example-org&amp;repo=widget&amp;head=${head}`;
    assert.ok(page.includes(`id="saveonline" href="${link}"`), 'Save online links to the server\'s /share page');
    assert.equal(page.split(`href="${link}"`).length - 1, 3, 'Save online, and Invite your team twice');
    assert.equal(page.split('data-intent="invite"').length - 1, 2, 'Invite your team at the top and at the end of Decide');
    const sent = carried(page);
    assert.equal(sent.action, 'https://pr.sonah.dev/share');
    assert.deepEqual([sent.body.repo, sent.body.branch, sent.body.base, sent.body.head],
      [{ owner: 'example-org', name: 'widget' }, 'feature', base, head]);
    for (const name of ['facts', 'meaning', 'findings', 'run'])
      assert.deepEqual(sent.body[name], JSON.parse(readFileSync(join(out, `${name}.json`), 'utf8')), name);
    assert.match(sent.body.page, /^<!doctype html>/i);
    assert.doesNotMatch(sent.body.page, /id="saveonline"|id="sonah-upload"/, 'it sends the page the team page frames');
    // Outside what it would send, the page names the SVG namespaces and the server only, and no folder of this computer.
    for (const url of new Set(withoutUpload(page).match(/https?:\/\/[^\s"'<>)\\]+/g) ?? []))
      assert.match(url, /^(?:http:\/\/www\.w3\.org\/(?:2000\/svg|1999\/xlink)|https:\/\/pr\.sonah\.dev\/share(?:\?.*)?)$/,
        url);
    assert.ok(!page.includes(scratch), 'no path of this computer');

    // --server names another server; the stored answers draw the page again.
    const again = await run(['visual', `${base}..feature`, '--out', out, '--replay-only', '--server',
      'http://127.0.0.1:8787/'], where);
    assert.equal(again.code, 0, again.stderr);
    const local = readFileSync(join(out, 'page.html'), 'utf8');
    assert.equal(carried(local).action, 'http://127.0.0.1:8787/share');
    assert.ok(local.includes(`id="saveonline" href="http://127.0.0.1:8787/share?owner=example-org&amp;repo=widget`
      + `&amp;head=${head}"`));

    // The branch's push remote, as git pushes it: branch.feature.pushRemote names another remote.
    git(['remote', 'add', 'fork', 'https://gitlab.example.com/someone/widget-fork.git']);
    git(['config', 'branch.feature.pushRemote', 'fork']);
    const fork = await run(['visual', `${base}..feature`, '--out', out, '--replay-only'], where);
    assert.equal(fork.code, 0, fork.stderr);
    assert.deepEqual(carried(readFileSync(join(out, 'page.html'), 'utf8')).body.repo,
      { owner: 'someone', name: 'widget-fork' });

    // A remote that is a folder on this computer names no repository: the page has neither button and no upload.
    git(['config', '--unset', 'branch.feature.pushRemote']);
    git(['remote', 'remove', 'fork']);
    git(['remote', 'set-url', 'origin', join(scratch, 'elsewhere', 'widget.git')]);
    const plain = await run(['visual', `${base}..feature`, '--out', out, '--replay-only'], where);
    assert.equal(plain.code, 0, plain.stderr);
    assert.doesNotMatch(readFileSync(join(out, 'page.html'), 'utf8'), /id="saveonline"|data-intent=|id="sonah-upload"/);
  } finally {
    if (git(['config', '--list', '--local']).includes('branch.feature.pushremote='))
      git(['config', '--unset', 'branch.feature.pushRemote']);
    const left = git(['remote']).split('\n').filter(Boolean);
    for (const name of ['origin', 'fork']) if (left.includes(name)) git(['remote', 'remove', name]);
  }
});
