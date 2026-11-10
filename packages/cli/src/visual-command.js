// D216: `sonah visual`, the visual review of a branch's change: one page of what the change does, how it runs and where
// it lies, with graphs (packages/visual). The range is read from local git only; the one thing that leaves the computer
// while it runs is the `claude -p` calls the job makes, on the person's own Claude Code login.
// D221: in a repository whose push remote names an owner and a repository, the page has "Save online" and "Invite your
// team" (`visualShare`): links to the server's /share page of the review (https://pr.sonah.dev unless --server names
// another), and the review's upload, which the page sends there only when the person presses one of them. The branch
// whose tip is the head goes with it (none when no branch points at the head), so the saves of one branch land in one
// saved review. Drawing the page sends nothing: no request to the server is made here.
//
// Exit codes, as every command's (bin/sonah.js): 0 the page is written; 1 the job ran and answers are still needed;
// 2 a usage error, or a problem named with its fix (a range git cannot find, no default branch, a call that stopped on
// the account); 3 Sonah failed. What it prints is fixed words, codes and paths: never git's or the provider's text.
//
// No work at import: the visual package (packages/visual/src) and the review's model check are imported when it runs.
// D219: the job's machinery is one exported helper (`drawVisualPage`), which `sonah review --format html` also runs, for
// the graphs page of the session's commits (review-graphs.js).
import { createHash } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { gitTop, runGit } from './code-snapshot.js';
import { remoteOf } from './repo-links.js';
import { sonahHome } from './settings.js';
import { claudeConfigDirForCalls } from './claude-home.js';
import { LOCAL_PAGE_WORDS } from './local-page.js';

/** The model the visual review asks when --model names none: a full id, which the review's attestation accepts. */
export const VISUAL_DEFAULT_MODEL = 'claude-sonnet-5-5';
/** D221: the server "Save online" and "Invite your team" send the review to when --server names none. */
export const VISUAL_DEFAULT_SERVER = 'https://pr.sonah.dev';
/** The command's usage, printed under a usage error: two lines, each within 80 columns after `usage: `. */
const VISUAL_USAGE_LINE = 'sonah visual [BASE..HEAD] [--out DIR] [--model ID] [--replay-only]\n'
  + '                    [--server URL]';
/** `sonah visual --help`, within 80 columns. */
export const visualUsage = [`usage: ${VISUAL_USAGE_LINE}`,
  'Draws one page of a branch\'s change: what it does, with How and Where graphs.',
  'The model reads the change\'s code and diff through your Claude Code login.',
  'Sonah prints the path of the page.',
  '',
  'The range: BASE..HEAD, BASE.. or BASE (the last two end at HEAD). With no',
  'range: from where HEAD left the default branch of your remote (origin/HEAD',
  'in your local git) to HEAD. Sonah reads only your local git: it never fetches.',
  '',
  'When the push remote of the repository names its owner and name, the page',
  'has Save online and Invite your team. Nothing is sent until you press one.',
  'Then your browser sends the review (the code and diff of the change, the',
  'commit messages and the findings), the repository\'s owner and name and the',
  'branch to the server, where you sign in and it is saved to your account.',
  '',
  'options:',
  '  --out DIR        the folder for the page, the requests and the answers',
  '                   (default: one per range and model, under ~/.sonah/visual)',
  `  --model ID       the model's full ID (default ${VISUAL_DEFAULT_MODEL})`,
  '  --replay-only    send nothing, and use only the answers in the folder',
  '  --server URL     the server that Save online and Invite your team send the',
  `                   review to (default ${VISUAL_DEFAULT_SERVER}): https, or`,
  '                   http for this computer only',
  '',
  'Run the same command again to reuse the answers that Sonah stored.'].join('\n');

/** The problems the command names, each with its fix (closed codes; printed after "Fix:"). */
export const VISUAL_FIX_WORDS = Object.freeze({
  folder_unreadable: 'Run sonah visual from a folder that this terminal can read.',
  not_git: 'Run sonah visual in a folder of the git repository whose change you want to see.',
  base_not_found: 'Git cannot find the base of the range in this repository. Check its name. Sonah reads only your '
    + 'local git, so run git fetch first if the commit is only on the remote.',
  head_not_found: 'Git cannot find the head of the range in this repository. Check its name, or commit the change '
    + 'first.',
  default_branch_unknown: 'Give a range, such as sonah visual main..HEAD. Or run git remote set-head origin --auto '
    + '(with the name of your remote), then run the same command again.',
  no_merge_base: 'HEAD shares no commit with the default branch of your remote. Give a range, such as sonah visual '
    + 'main..HEAD.',
  no_change: 'The range holds no change: its head adds no commit to its base. Give a range whose head is ahead of its '
    + 'base, such as sonah visual main..HEAD on a branch, or sonah visual HEAD~1..HEAD for the last commit.',
  invalid_model: `Choose a full model ID, such as ${VISUAL_DEFAULT_MODEL}. Sonah does not accept an alias such as `
    + 'sonnet.',
  output_folder_unwritable: 'Sonah could not make or write the folder for the page. Choose a --out folder that you '
    + 'own, or check that you can write to your SONAH_HOME folder.',
  // The calls that stopped the job (packages/visual transport STOP_ERRORS): no further call could pass.
  cli_missing: 'Sonah could not start claude. Install Claude Code, sign in with claude auth login, then run the same '
    + 'command again.',
  auth: 'Run claude auth login with your Claude subscription account, then run the same command again. Sonah reuses '
    + 'the answers that it stored.',
  billing: 'Check the plan and billing of your Claude account, then run the same command again. Sonah reuses the '
    + 'answers that it stored.',
  model_not_found: `Your Claude account cannot use this model. Choose another one with --model, such as `
    + `${VISUAL_DEFAULT_MODEL}.`,
  usage_limit: 'Wait until the usage of your Claude plan resets, then run the same command again. Sonah reuses the '
    + 'answers that it stored.',
});
/** The fix of any other failure: a call that failed (timeout, output_limit, provider_busy, call_failed) or
 *  visual_failed. */
export const VISUAL_FIX_DEFAULT = 'Run the same command again. Sonah reuses the answers that it stored and asks only '
  + 'for the rest. If it fails again, run sonah doctor --no-probe.';
/** The kinds of a call that stopped the job: a problem with a fix (exit 2), not a failure of Sonah (exit 3). */
const STOP_CODES = Object.freeze(['cli_missing', 'auth', 'billing', 'model_not_found', 'usage_limit']);
/** The kinds of a story or findings call that failed, which end the job with no page (packages/visual transport
 *  TRANSPORT_ERRORS that do not stop the job): a failure of Sonah (exit 3), asked again on the next run. */
const CALL_CODES = Object.freeze(['timeout', 'output_limit', 'provider_busy', 'call_failed']);

/** The command's lines, in fixed words. */
export const VISUAL_WORDS = Object.freeze({
  started: (base, head, folder) => `Sonah draws the change from ${base.slice(0, 12)} to ${head.slice(0, 12)}. It keeps `
    + `the requests and answers in ${folder}.`,
  // A lower bound: a stage asked only once the one before it is answered (the story) is not counted yet.
  pending: (count, replayOnly) => `Visual review is not complete: at least ${count} `
    + `${count === 1 ? 'answer is' : 'answers are'} still needed. `
    + (replayOnly ? 'Run the same command without --replay-only to ask for them.'
      : 'Run the same command again to ask for them.'),
  failed: (code, fix) => `Visual review could not complete: ${code}.\nFix: ${fix}`,
});

const HASH = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;
const usageError = (problem) => Object.assign(new Error('usage'), { code: 'usage', problem });
/** A problem the command names with its fix (a code of VISUAL_FIX_WORDS). */
const problem = (code) => Object.assign(new Error(code), { code, named: true });
/** An option the person typed, as a usage error names it: its name before any `=`, at most 40 characters. */
const named = (arg) => {
  const name = arg.split('=')[0], shown = name.slice(0, 40);
  if (shown.length === arg.length) return arg;
  return shown.length < name.length ? `${shown}...` : `${shown}=...`;
};

/**
 * The range as the person gave it: `BASE..HEAD`, `BASE..` or `BASE` (HEAD is the head of both), as `{ base, head }`;
 * null for any other shape: `...`, an empty base, a side that starts with `-`, whitespace or NUL, more than one `..`.
 */
export function visualRange(text) {
  if (typeof text !== 'string' || text === '' || /[\s\0]/.test(text) || text.includes('...')) return null;
  const parts = text.split('..');
  if (parts.length > 2) return null;
  const [base, head = ''] = parts;
  const sides = { base, head: head === '' ? 'HEAD' : head };
  return sides.base === '' || sides.base.startsWith('-') || sides.head.startsWith('-') ? null : sides;
}

const LOOPBACK = Object.freeze(['localhost', '127.0.0.1', '[::1]']);
/**
 * D221: the server address "Save online" and "Invite your team" may send a review to, as the page names it: an https
 * URL (http only for this computer: localhost, 127.0.0.1 or [::1]), with no user, password, query or fragment, as its
 * origin and path with no trailing slash; null for anything else: over plain http the review would cross the network
 * unencrypted.
 */
export function visualServer(text) {
  if (typeof text !== 'string' || text === '' || /[\s\0?#]/.test(text)) return null;
  let url;
  try { url = new URL(text); } catch { return null; }
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && LOOPBACK.includes(url.hostname))) return null;
  if (url.username || url.password) return null;
  return `${url.origin}${url.pathname.replace(/\/+$/, '')}`;
}

/** The command's options, or a thrown usage error. `--help` and `-h` are answered first, before anything is read. */
export function parseVisualArgs(argv) {
  const options = { range: null, out: null, model: null, replayOnly: false, server: null, help: false };
  if (argv.includes('--help') || argv.includes('-h')) return { ...options, help: true };
  const values = new Map([['--out', 'out'], ['--model', 'model'], ['--server', 'server']]);
  const seen = new Set();
  let range = null;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--replay-only') {
      if (seen.has(arg)) throw usageError(`${arg} is given twice`);
      seen.add(arg); options.replayOnly = true;
    } else if (values.has(arg)) {
      const value = argv[++i];
      if (seen.has(arg)) throw usageError(`${arg} is given twice`);
      if (!value || value.startsWith('-')) throw usageError(`${arg} needs a value`);
      seen.add(arg); options[values.get(arg)] = value;
    } else if (arg.startsWith('-')) throw usageError(`unknown option ${named(arg)}`);
    else if (range !== null) throw usageError('more than one range is given');
    else range = arg;
  }
  if (range !== null) {
    options.range = visualRange(range);
    if (!options.range) throw usageError('the range takes the form BASE..HEAD, BASE.. or BASE');
  }
  if (options.server !== null) {
    options.server = visualServer(options.server);
    if (options.server === null) throw usageError('--server takes an https address, such as '
      + `${VISUAL_DEFAULT_SERVER}`);
  }
  return options;
}

const textOf = (result) => (result?.ok && result.stdout ? result.stdout.toString('utf8').trim() : '');
/** The commit a revision names in the repository at `top` (`--end-of-options`: never read as an option), or null. */
async function commitOf(top, revision, git) {
  const said = textOf(await git(['rev-parse', '--verify', '--quiet', '--end-of-options', `${revision}^{commit}`],
    { cwd: top }));
  return HASH.test(said) ? said : null;
}

/**
 * The base when no range is given, from local refs only: the commit where HEAD left the default branch of the
 * repository's remote (repo-links.js `remoteOf`), as its `refs/remotes/<remote>/HEAD` names it. `{ base }`, or
 * `{ problem }`: no remote or no such ref (`default_branch_unknown`), no shared commit (`no_merge_base`).
 */
export async function defaultBase(top, { git = runGit } = {}) {
  const remotes = textOf(await git(['remote'], { cwd: top })).split('\n').map((line) => line.trim()).filter(Boolean);
  const upstream = textOf(await git(['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{upstream}'],
    { cwd: top }));
  const remote = remoteOf(remotes, upstream);
  if (remote === null) return { problem: 'default_branch_unknown' };
  const ref = textOf(await git(['symbolic-ref', '--quiet', `refs/remotes/${remote}/HEAD`], { cwd: top }));
  if (!ref.startsWith(`refs/remotes/${remote}/`)) return { problem: 'default_branch_unknown' };
  const met = textOf(await git(['merge-base', 'HEAD', ref], { cwd: top }));
  return HASH.test(met) ? { base: met } : { problem: 'no_merge_base' };
}

// D221: the remotes whose URL names a repository on a server: git's network transports. A local path or a file: URL
// names a folder on this computer, never a repository the server knows, so its folders never go into the page.
const NETWORK_SCHEMES = Object.freeze(['https', 'http', 'ssh', 'git', 'git+ssh', 'ssh+git']);
// The owner and repository names the server takes (its store's own rules), so the page never carries an upload the
// server refuses for its name.
const OWNER_NAME = /^[A-Za-z0-9](?:[A-Za-z0-9]|[-_](?=[A-Za-z0-9])){0,99}$/;
const REPO_NAME = /^[A-Za-z0-9._-]{1,100}$/;
const SHA1 = /^[0-9a-f]{40}$/;

/**
 * D221: the repository a remote URL names on its server, as `{ owner, name }`: the last two parts of its path, from a
 * network URL (`https://host/o/r.git`, `ssh://git@host/o/r`, ...) or git's short ssh form (`git@host:o/r.git`), on any
 * host; `.git` and trailing slashes are dropped. Null for a local path, a `file:` URL, any other form, or names the
 * server would refuse. Structure only: the URL is never shown or sent.
 */
export function remoteRepository(url) {
  if (typeof url !== 'string' || /[\s\0]/.test(url.trim())) return null;
  const text = url.trim();
  let path;
  const full = /^([a-z][a-z0-9+.-]*):\/\/([^/]*)(\/.*)?$/i.exec(text);
  if (full) {
    if (!NETWORK_SCHEMES.includes(full[1].toLowerCase()) || full[2] === '') return null;
    path = full[3] ?? '';
  } else {
    // [user@]host:path, git's ssh form; a colon after a slash is a local path's (git reads it so too).
    const short = /^(?:[^@/:]+@)?([^/:]+):(.*)$/.exec(text);
    if (!short || short[2].startsWith('//')) return null;
    path = short[2];
  }
  const parts = path.replace(/[?#].*$/, '').replace(/\/+$/, '').replace(/\.git$/, '').split('/').filter(Boolean);
  if (parts.length < 2) return null;
  const [owner, name] = parts.slice(-2);
  return OWNER_NAME.test(owner) && REPO_NAME.test(name) && name !== '.' && name !== '..' ? { owner, name } : null;
}

const linesOf = (result) => textOf(result).split('\n').map((line) => line.trim()).filter(Boolean);
const BRANCH_REF = 'refs/heads/';

/**
 * D221: what the page's "Save online" and "Invite your team" name, from local git only: `{ url, branch }`, or null when
 * the page has neither. `url` is the server's /share page of the review (render.mjs `shareLink`: the server, the
 * repository the push remote names and the head commit); `branch` the branch whose tip is `head` (the checked-out
 * branch when it is, else the first local branch that is), or null when none is. The push remote is the branch's
 * (`branch.<b>.pushRemote`, `remote.pushDefault`, `branch.<b>.remote`, as git pushes), else `origin`, else the only
 * remote. Null with no such remote, a URL that names no repository (`remoteRepository`), a head that is not a SHA-1
 * commit (the server takes 40 hex characters), or any git call that fails: the page then simply has no buttons.
 */
export async function visualShare({ top, head, server = VISUAL_DEFAULT_SERVER, git = runGit, shareLink }) {
  try {
    if (server === null || !SHA1.test(head ?? '') || typeof shareLink !== 'function') return null;
    const at = linesOf(await git(['for-each-ref', '--format=%(refname)', `--points-at=${head}`, BRANCH_REF],
      { cwd: top })).filter((ref) => ref.startsWith(BRANCH_REF)).map((ref) => ref.slice(BRANCH_REF.length));
    const current = textOf(await git(['symbolic-ref', '--quiet', 'HEAD'], { cwd: top }));
    const checkedOut = current.startsWith(BRANCH_REF) ? current.slice(BRANCH_REF.length) : null;
    const branch = checkedOut !== null && at.includes(checkedOut) ? checkedOut : at[0] ?? null;
    const remotes = linesOf(await git(['remote'], { cwd: top }));
    const setting = async (key) => textOf(await git(['config', '--get', key], { cwd: top }));
    let remote = null;
    for (const key of [...(branch ? [`branch.${branch}.pushRemote`] : []), 'remote.pushDefault',
      ...(branch ? [`branch.${branch}.remote`] : [])]) {
      const value = await setting(key);
      if (value && value !== '.') { remote = value; break; }
    }
    remote ??= remotes.includes('origin') ? 'origin' : remotes.length === 1 ? remotes[0] : null;
    if (remote === null) return null;
    // A remote's name gives its push URL (git's own insteadOf rules applied); a branch's remote may also be a URL.
    const url = remotes.includes(remote)
      ? textOf(await git(['remote', 'get-url', '--push', '--', remote], { cwd: top })) : remote;
    const named = remoteRepository(url);
    if (!named) return null;
    return { url: shareLink(server, { owner: named.owner, repo: named.name, head }), branch };
  } catch {
    return null;
  }
}

/** The default folder of a range,
 *  `<Sonah's folder>/visual/<repository folder>-<8 hex of its path>/<base>-<head>-<model>` (12 characters of each
 *  commit; the model with any character but letters, digits, `.`, `_` and `-` as `-`), so the same range of the same
 *  repository asked of the same model finds its stored answers again (a request's id does not name the model, so
 *  another model gets a folder of its own). */
export function visualOutDir({ top, base, head, model, env = process.env }) {
  const place = `${basename(top)}-${createHash('sha256').update(top).digest('hex').slice(0, 8)}`;
  return join(sonahHome({ env }), 'visual', place,
    `${base.slice(0, 12)}-${head.slice(0, 12)}-${model.replace(/[^A-Za-z0-9._-]+/g, '-')}`);
}

/** The environment the claude calls are made from (D151, as the session review's): no API key, so a call runs on the
 *  person's Claude Code login, and CLAUDE_CONFIG_DIR as claude-home.js resolves it. */
export function visualCallEnvironment(env = process.env) {
  const out = { ...env };
  delete out.ANTHROPIC_API_KEY;
  const folder = claudeConfigDirForCalls(env);
  if (folder === null) delete out.CLAUDE_CONFIG_DIR;
  else out.CLAUDE_CONFIG_DIR = folder;
  return out;
}

/** The code a job that did not complete ends with: the stop of its calls, else the failed story or findings call,
 *  else `visual_failed`. Read from the job's closed fields only, never from its error text. */
function failureOf(run) {
  if (STOP_CODES.includes(run?.stop)) return run.stop;
  for (const kind of ['story', 'findings']) {
    const failed = (run?.requests ?? []).find((r) => r?.kind === kind && CALL_CODES.includes(r.error));
    if (failed) return failed.error;
  }
  return 'visual_failed';
}

/** The fix of a code the command or the job ended with: its own words (VISUAL_FIX_WORDS), else the default. */
export const visualFixOf = (code) => (Object.hasOwn(VISUAL_FIX_WORDS, code) ? VISUAL_FIX_WORDS[code]
  : VISUAL_FIX_DEFAULT);

/**
 * One drawing of the graphs page of `base..head`, two commits of the repository whose real top folder is `top`: the
 * job's machinery that `sonah visual` and (D219) `sonah review --format html` share (review-graphs.js). A head the base
 * already holds is `no_change`; the folder `outDir` and its `requests/` and `answers/` are made owner-only; the calls run
 * with `model` in the environment `visualCallEnvironment(env)` gives, or none are made with `replayOnly`; `onStart` is
 * told the folder just before the job starts. While the job runs, `GIT_NO_LAZY_FETCH` is set in this process's
 * environment, which extract keeps for its git children, so nothing but the claude calls reaches the network; its
 * earlier value is put back when the job ends (D219: the review's own process goes on after it). D219: `signal` (the
 * review's, which abandons the graphs page on Ctrl-C or SIGTERM): once it is aborted, no new call starts; each fails at
 * once as `call_failed`, without starting claude, so the job ends soon. A call already running is not stopped here:
 * packages/visual's transport takes no signal. At a terminal, Ctrl-C is expected to reach that claude too, since it
 * runs in this process's group, but no test has sent Ctrl-C at a real terminal (D219, Left): that is not checked.
 * D221: `server` (an address `visualServer` gave, or null for none) is where the page's "Save online" and "Invite your
 * team" send the review; the page has them when `visualShare` finds a push remote that names the repository. Both
 * commands draw it so: `sonah visual` with its --server, the review with the default server.
 * Resolves `{ status: 'complete', page, run }` (the page's path), `{ status: 'pending', needed, run }` (how many answers
 * are still needed) or `{ status: 'failed', code }` (a code of VISUAL_FIX_WORDS, a failed call's or `visual_failed`);
 * never rejects.
 */
export async function drawVisualPage({ top, base, head, model = VISUAL_DEFAULT_MODEL, outDir, replayOnly = false,
  env = process.env, git = runGit, onStart = null, signal = null, server = VISUAL_DEFAULT_SERVER }) {
  try {
    // A head the base already holds (the same commit, or one behind it) adds nothing to draw: the job would ask the
    // model about an empty change.
    if (base === head || (await git(['merge-base', '--is-ancestor', head, base], { cwd: top })).ok) {
      return { status: 'failed', code: 'no_change' };
    }
    // Every folder Sonah makes here is readable by its owner only; the job's own folders are made first, the same way.
    try {
      for (const folder of [outDir, join(outDir, 'requests'), join(outDir, 'answers')])
        mkdirSync(folder, { recursive: true, mode: 0o700 });
    } catch { return { status: 'failed', code: 'output_folder_unwritable' }; }
    const [{ runJob }, { claudeTransport, TransportError }, { shareLink }] = await Promise.all([
      import('../../visual/src/job.mjs'), import('../../visual/src/transport-claude.mjs'),
      import('../../visual/src/render.mjs')]);
    // D221: the buttons' link and branch, read from local git before the job starts (null: no buttons).
    const share = await visualShare({ top, head, server, git, shareLink });
    const calls = replayOnly ? null : claudeTransport({ model, env: visualCallEnvironment(env) });
    // D219: after a stop, no new call starts (the transport's own `by` and `model` kept for the answers' records).
    const transport = calls && signal ? Object.assign(async (request) => {
      if (signal.aborted) throw new TransportError('call_failed');
      return calls(request);
    }, { by: calls.by, model: calls.model }) : calls;
    onStart?.(outDir);
    // The job's git calls fetch no missing object of a partial clone (extract keeps this name for its git children).
    const before = process.env.GIT_NO_LAZY_FETCH;
    process.env.GIT_NO_LAZY_FETCH = '1';
    let run;
    try {
      run = await runJob({ repoDir: top, base, head, outDir, transport, mode: 'local',
        shareUrl: share?.url ?? null, branch: share?.branch ?? null });
    } finally {
      if (before === undefined) delete process.env.GIT_NO_LAZY_FETCH;
      else process.env.GIT_NO_LAZY_FETCH = before;
    }
    if (run?.status === 'complete') return { status: 'complete', page: join(outDir, 'page.html'), run };
    if (run?.status === 'pending') return { status: 'pending', needed: Array.isArray(run.needed) ? run.needed.length : 0,
      run };
    return { status: 'failed', code: failureOf(run), run };
  } catch {
    return { status: 'failed', code: 'visual_failed' };
  }
}

/**
 * `sonah visual [BASE..HEAD] [--out DIR] [--model ID] [--replay-only] [--server URL]`: the exit code. `cwd` is where it
 * runs (the repository is its top folder); `env` is the environment the calls and Sonah's folder are read from.
 * `presentPage`, when given, is called with the written page's path in place of printing the `Local page:` line (D218:
 * bare `sonah` prints that line and opens the page, bare-command.js).
 */
export async function runVisualCommand(argv, { stdout = process.stdout, stderr = process.stderr, cwd = undefined,
  env = process.env, git = runGit, presentPage = null } = {}) {
  let options;
  try { options = parseVisualArgs(argv); }
  catch (error) {
    const said = typeof error?.problem === 'string' ? `sonah visual: ${error.problem}${error.problem.endsWith('...')
      ? '' : '.'}\n` : '';
    stderr.write(`${said}usage: ${VISUAL_USAGE_LINE}\nRun sonah visual --help to see the options.\n`);
    return 2;
  }
  if (options.help) {
    stdout.write(`${visualUsage}\n`);
    return 0;
  }
  // A problem named with its fix, a stop of the calls among them, exits 2; any other failure is Sonah's, and exits 3.
  const failed = (code) => {
    stderr.write(`${VISUAL_WORDS.failed(code, visualFixOf(code))}\n`);
    return Object.hasOwn(VISUAL_FIX_WORDS, code) ? 2 : 3;
  };
  try {
    const model = options.model ?? VISUAL_DEFAULT_MODEL;
    const { attestableModel } = await import('./review-judge.js');
    if (!attestableModel(model)) throw problem('invalid_model');
    let root;
    try { root = cwd ?? process.cwd(); } catch { throw problem('folder_unreadable'); }
    const top = await gitTop({ root, git });
    if (!top) throw problem('not_git');
    // The range's two commits, each as git names it here; with no range, the head is HEAD and the base where it left
    // the default branch.
    const head = await commitOf(top, options.range?.head ?? 'HEAD', git);
    if (!head) throw problem('head_not_found');
    let base;
    if (options.range) {
      base = await commitOf(top, options.range.base, git);
      if (!base) throw problem('base_not_found');
    } else {
      const found = await defaultBase(top, { git });
      if (found.problem) throw problem(found.problem);
      base = found.base;
    }
    // The job (`drawVisualPage`, which D219's review shares): the empty range, the folders, the calls and the page.
    const outDir = options.out !== null ? resolve(root, options.out) : visualOutDir({ top, base, head, model, env });
    const drawn = await drawVisualPage({ top, base, head, model, outDir, replayOnly: options.replayOnly, env, git,
      server: options.server ?? VISUAL_DEFAULT_SERVER,
      onStart: (folder) => stderr.write(`${VISUAL_WORDS.started(base, head, folder)}\n`) });
    if (drawn.status === 'complete') {
      if (presentPage) await presentPage(drawn.page);
      else stdout.write(`${LOCAL_PAGE_WORDS.line(drawn.page)}\n`);
      return 0;
    }
    if (drawn.status === 'pending') {
      stdout.write(`${VISUAL_WORDS.pending(drawn.needed, options.replayOnly)}\n`);
      return 1;
    }
    return failed(drawn.code);
  } catch (error) {
    return failed(error?.named === true ? error.code : 'visual_failed');
  }
}
