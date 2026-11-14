// Helpers of the team commands' tests (D224 on): a stand-in Sonah Team server on 127.0.0.1 that answers the routes the
// laptop calls as sonah-hosted HOSTING.md section 2 has them, records every call it gets, and makes tokens of the
// server's shape at random, so no test file holds one; a sealed SONAH_HOME; the real entry run with a piped stdin.
// D225: a temp repository whose push remote is a network URL, ssh://example.invalid/acme/widgets.git, served by a
// stand-in for ssh from a temp bare repository (`pushRepo`), so `remoteRepository` names it and git push works offline.
// No network: the server listens on the loopback address only, and the stand-in for ssh opens no connection.
// D227: the stand-in also answers GET /api/fixes and POST /api/uploads (sonah-hosted FIXLOOP.md "Shapes", UPLOADS.md,
// accounts mode), and every sealed home stops the push runs a test left going (their runners and their claude stand-ins)
// before its folder is removed.
// D229: it answers the fix loop's two as well, GET /api/fixes/<comment id> and POST /api/fixes/<comment id>/launched,
// and a stand-in claude that records its argv, folder and environment and runs nothing stands in for Claude Code
// (`recordingClaude`), with a Claude Code recording written as Claude Code writes one (`writeRecording`) and a terminal
// whose answers a test gives (`terminalWith`). No pty: `sonah fix` takes its terminal as an input.
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { createServer } from 'node:http';
import { readFileSync, readdirSync, realpathSync } from 'node:fs';
import { chmod, mkdir, mkdtemp, readdir, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const BIN = fileURLToPath(new URL('../bin/sonah.js', import.meta.url));

/** A token as the server makes them: `sonah_` and 43 base64url characters. */
export const newToken = () => `sonah_${randomBytes(32).toString('base64url')}`;

/**
 * The stand-in server. `codes` maps a code (as typed, spaces and hyphens dropped, any case) to the person it connects,
 * `{ login, team, seat }`; `addToken(person)` makes a live token for one. `once(method, path, answer)` queues one answer
 * `{ status, json, headers }` (or a function of the call, which may return a promise: one that never settles holds the
 * call) for the next such call, ahead of the route's own.
 * `calls` holds `{ method, path, url, query, authorization, userAgent, contentType, body }` of each call. D227: `fixes`
 * maps "<owner>/<name>" to the comments that wait there (GET /api/fixes); `uploads` holds each upload's body as parsed
 * (POST /api/uploads, answered 201 with the review's link). D229: `comments` maps a comment id to what GET
 * /api/fixes/<id> answers (a missing one is 404 `not_found`, and a value that is a number is answered with that
 * status), and `launches` holds each POST /api/fixes/<id>/launched as `{ id, session, forkOf }`.
 */
export async function teamServer(t, { codes = {}, fixes = {}, comments = {} } = {}) {
  const calls = [], tokens = new Map(), queued = [], uploads = [], launches = [];
  const codeMap = new Map(Object.entries(codes).map(([code, person]) => [code.replace(/[\s-]/g, '').toUpperCase(),
    person]));
  const addToken = (person) => { const token = newToken(); tokens.set(token, { ...person, live: true }); return token; };
  const send = (res, status, json = null, headers = {}) => {
    res.writeHead(status, { ...(json === null ? {} : { 'content-type': 'application/json' }), ...headers });
    res.end(json === null ? undefined : JSON.stringify(json));
  };
  const server = createServer(async (req, res) => {
    let body = '';
    for await (const chunk of req) body += chunk;
    const parsedUrl = new URL(req.url, 'http://127.0.0.1');
    const path = parsedUrl.pathname;
    const call = { method: req.method, path, url: req.url, query: Object.fromEntries(parsedUrl.searchParams),
      authorization: req.headers.authorization ?? null, userAgent: req.headers['user-agent'] ?? null,
      contentType: req.headers['content-type'] ?? null, body };
    calls.push(call);
    const at = queued.findIndex((q) => q.method === req.method && q.path === path);
    if (at >= 0) {
      const [{ answer }] = queued.splice(at, 1);
      const a = typeof answer === 'function' ? await answer(call) : answer;
      send(res, a.status, a.json ?? null, a.headers ?? {});
      return;
    }
    const bearer = /^Bearer (\S+)$/.exec(call.authorization ?? '')?.[1] ?? null;
    const person = bearer !== null ? tokens.get(bearer) : undefined;
    if (path === '/api/device/exchange' && req.method === 'POST') {
      let parsed = null;
      try { parsed = JSON.parse(body); } catch { /* below */ }
      const who = codeMap.get(String(parsed?.code ?? '').replace(/[\s-]/g, '').toUpperCase());
      if (!who) { send(res, 400, { error: 'bad_code' }); return; }
      codeMap.delete(String(parsed.code).replace(/[\s-]/g, '').toUpperCase());
      // `server` names another place on purpose: the laptop must keep the server it sent the code to.
      send(res, 201, { token: addToken(who), login: who.login, server: 'https://elsewhere.example' });
      return;
    }
    if (path === '/api/token' && (req.method === 'GET' || req.method === 'DELETE')) {
      if (!person?.live) { send(res, 401, { error: 'bad_token' }, { 'www-authenticate': 'Bearer realm="sonah"' }); return; }
      if (req.method === 'DELETE') { person.live = false; send(res, 204); return; }
      send(res, 200, { login: person.login, team: person.team === null ? null : { name: person.team },
        seat: person.seat });
      return;
    }
    // D229: the fix loop's two, as accounts mode answers them: the comment's author only, so an unknown id is 404.
    const one = /^\/api\/fixes\/(c_[0-9a-f]{16})$/.exec(path);
    const started = /^\/api\/fixes\/(c_[0-9a-f]{16})\/launched$/.exec(path);
    if ((one && req.method === 'GET') || (started && req.method === 'POST')) {
      if (!person?.live) { send(res, 401, { error: 'bad_token' }, { 'www-authenticate': 'Bearer realm="sonah"' }); return; }
      const answer = comments[(one ?? started)[1]];
      if (answer === undefined) { send(res, 404, { error: 'not_found' }); return; }
      if (typeof answer === 'number') { send(res, answer, { error: answer === 409 ? 'not_fixable' : 'refused' }); return; }
      if (one) { send(res, 200, answer); return; }
      let parsed = null;
      try { parsed = JSON.parse(body); } catch { send(res, 400, { error: 'bad_session' }); return; }
      launches.push({ id: started[1], session: parsed?.session ?? null, forkOf: parsed?.forkOf ?? null });
      send(res, 200, { fix: { at: new Date().toISOString(), comment: started[1], state: 'launched',
        by: { login: person.login, id: 1 }, route: 'command', session: parsed?.session, forkOf: parsed?.forkOf } });
      return;
    }
    // D227: the push run's two routes, as accounts mode answers them.
    if ((path === '/api/fixes' && req.method === 'GET') || (path === '/api/uploads' && req.method === 'POST')) {
      if (!person?.live) { send(res, 401, { error: 'bad_token' }, { 'www-authenticate': 'Bearer realm="sonah"' }); return; }
      if (person.team === null) { send(res, 403, { error: 'not_member' }); return; }
      if (path === '/api/fixes') {
        const owner = call.query.owner, repo = call.query.repo;
        const list = fixes[`${owner}/${repo}`] ?? [];
        send(res, 200, { repo: { owner, name: repo }, total: list.length, fixes: list });
        return;
      }
      let up;
      try { up = JSON.parse(body); } catch { send(res, 400, { error: 'bad_upload' }); return; }
      uploads.push(up);
      send(res, 201, { url: `${base}/r/${up.repo.owner}/${up.repo.name}/b/${encodeURIComponent(up.branch)}`,
        version: { head: up.head, base: up.base, at: new Date().toISOString() }, prs: [], dropped: {} });
      return;
    }
    send(res, 404, { error: 'not_found' });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  t.after(() => new Promise((resolve) => { server.closeAllConnections?.(); server.close(resolve); }));
  return {
    url: base, calls, tokens, addToken, uploads, fixes, comments, launches,
    once: (method, path, answer) => { queued.push({ method, path, answer }); },
    /** Whether a token is live on this server. */
    live: (token) => tokens.get(token)?.live === true,
  };
}

/** A sealed home: HOME and SONAH_HOME in a new folder (SONAH_HOME not made yet), no update check. D227: before the
 *  folder goes, the push runs a test left going are stopped (`stopRuns`). */
export async function sealedHome(t, prefix = 'sonah-team-') {
  const root = await mkdtemp(join(tmpdir(), prefix));
  t.after(async () => {
    await stopRuns(root);
    await rm(root, { recursive: true, force: true });
  });
  const env = { HOME: root, SONAH_HOME: join(root, 'sonah home'), PATH: '/usr/bin:/bin', SONAH_NO_UPDATE_CHECK: '1' };
  return { root, env, sonahHome: env.SONAH_HOME, file: join(env.SONAH_HOME, 'team', 'connection.json') };
}

/** Two writable streams that keep what they get. */
export function streams() {
  const chunks = { stdout: '', stderr: '' };
  return { chunks, stdout: { write: (text) => { chunks.stdout += text; return true; } },
    stderr: { write: (text) => { chunks.stderr += text; return true; } } };
}

/** The real entry with `args`, its stdin `input` (a pipe, ended), in `env`: `{ code, stdout, stderr }`. It is killed
 *  after `timeoutMs` (D228: a push run whose own time limit is longer passes its own, so that what ends the run is the
 *  limit under test and not this one). */
export function runEntry(args, { env, input = '', cwd = env.HOME, timeoutMs = 30_000 }) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [BIN, ...args], { cwd, env, stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '', stderr = '';
    const timer = setTimeout(() => child.kill('SIGKILL'), timeoutMs);
    child.stdout.setEncoding('utf8').on('data', (c) => { stdout += c; });
    child.stderr.setEncoding('utf8').on('data', (c) => { stderr += c; });
    child.on('error', reject);
    child.on('close', (code, signal) => { clearTimeout(timer); resolve({ code: signal ? signal : code, stdout, stderr }); });
    child.stdin.on('error', () => {});
    child.stdin.end(input);
  });
}

/** Every file under `dir` with its text, for checking where a token was written. */
export async function filesUnder(dir) {
  const out = [];
  let entries;
  try { entries = await readdir(dir, { withFileTypes: true }); } catch { return out; }
  for (const entry of entries) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...await filesUnder(path));
    else if (entry.isFile()) out.push({ path, text: await readFile(path, 'utf8') });
  }
  return out;
}

/** D225: the stand-in for ssh that git runs (as `core.sshCommand`) for ssh://example.invalid/<path>: it takes the command
 *  git asks the remote to run, `git-receive-pack '/<path>'` or `git-upload-pack '/<path>'`, and runs it on the bare
 *  repository at <its own folder>/remote/<path>. Any other command, or a path that leaves that folder, exits 128. It
 *  reads only its last argument, so git's ssh options (a port, -o) change nothing. */
export const SSH_SHIM = `#!/bin/sh
for last; do :; done
case "$last" in
  "git-receive-pack '/"*"'"|"git-upload-pack '/"*"'") ;;
  *) echo "ssh stand-in: not a git command" >&2; exit 128 ;;
esac
verb=\${last%% *}
path=\${last#* \\'/}
path=\${path%\\'}
case "$path" in *..*|*\\'*) echo "ssh stand-in: not a path under its folder" >&2; exit 128 ;; esac
exec git "\${verb#git-}" "$(dirname "$0")/remote/$path"
`;
/** The push remote of every `pushRepo`, and the owner and name a server reads from it. */
export const PUSH_REMOTE = 'ssh://example.invalid/acme/widgets.git';

/** The environment of git in a repository test: the sealed home's `bin` (where `pushRepo` puts a stand-in claude), then
 *  the caller's PATH (git, node), the sealed home's HOME and SONAH_HOME, no system or global git config of this
 *  computer, a fixed author, and nothing else (no CI, no GIT_ variable). */
export function repoEnv(home, extra = {}) {
  return { PATH: `${join(home.root, 'bin')}:${process.env.PATH ?? '/usr/bin:/bin'}`, HOME: home.root, SONAH_HOME: home.sonahHome,
    XDG_CONFIG_HOME: join(home.root, '.config'), GIT_CONFIG_NOSYSTEM: '1', LANG: 'C', SONAH_NO_UPDATE_CHECK: '1',
    TMPDIR: tmpdir(), GIT_AUTHOR_NAME: 'synthetic', GIT_AUTHOR_EMAIL: 's@example.invalid',
    GIT_COMMITTER_NAME: 'synthetic', GIT_COMMITTER_EMAIL: 's@example.invalid', ...extra };
}

/**
 * D225: a repository in the sealed home (`<root>/<name>`, a space in its name), whose origin is PUSH_REMOTE, which the
 * stand-in for ssh serves from the bare repository `<root>/remote/acme/widgets.git`; main is committed and pushed. A
 * stand-in claude is at `<root>/bin/claude`. Call it once a sealed home.
 * Returns `{ work, bare, env, git(args, extra) -> stdout, run(args, extra) -> { code, stdout, stderr },
 * commit(branch, text) -> sha, push(args, extra) -> { code, stdout, stderr, ms } }`.
 */
export async function pushRepo(home, { name = 'my work', env: extraEnv = {} } = {}) {
  const root = await realpath(home.root);
  const env = repoEnv(home, extraEnv);
  const shim = join(root, 'ssh-shim.sh');
  await writeFile(shim, SSH_SHIM);
  await chmod(shim, 0o755);
  // A stand-in claude first on PATH, so the push script names its folder (the push hook runs no model here).
  await mkdir(join(root, 'bin'), { recursive: true });
  await writeFile(join(root, 'bin', 'claude'), '#!/bin/sh\nexit 0\n');
  await chmod(join(root, 'bin', 'claude'), 0o755);
  const bare = join(root, 'remote', 'acme', 'widgets.git');
  await mkdir(dirname(bare), { recursive: true });
  const work = join(root, name);
  const run = (args, extra = {}, cwd = work) => {
    const r = spawnSync('git', args, { cwd, env: { ...env, ...extra }, encoding: 'utf8', timeout: 60_000 });
    return { code: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
  };
  const git = (args, extra = {}, cwd = work) => {
    const r = run(args, extra, cwd);
    if (r.code !== 0) throw new Error(`git ${args.join(' ')}: ${r.stderr}`);
    return r.stdout.trim();
  };
  git(['init', '-q', '--bare', '-b', 'main', bare], {}, root);
  git(['init', '-q', '-b', 'main', work], {}, root);
  for (const [key, value] of [['commit.gpgsign', 'false'], ['core.sshCommand', `'${shim}'`], ['ssh.variant', 'simple']])
    git(['config', key, value]);
  await writeFile(join(work, 'math.js'), 'export const add = (a, b) => a + b;\n');
  git(['add', '.']);
  git(['commit', '-q', '-m', 'Math helpers']);
  git(['remote', 'add', 'origin', PUSH_REMOTE]);
  git(['push', '-q', '-u', 'origin', 'main']);
  /** A commit on a branch (made from main when new) that writes `text` into math.js: its sha. */
  const commit = async (branch, text) => {
    const has = run(['rev-parse', '--verify', '--quiet', `refs/heads/${branch}`]).code === 0;
    git(['checkout', '-q', ...(has ? [branch] : ['-b', branch, 'main'])]);
    await writeFile(join(work, 'math.js'), text);
    git(['add', '.']);
    git(['commit', '-q', '-m', `Change ${branch}`]);
    return git(['rev-parse', 'HEAD']);
  };
  const push = (args, extra = {}) => {
    const t0 = performance.now();
    const r = run(['push', ...args], extra);
    return { ...r, ms: performance.now() - t0 };
  };
  return { root, work, bare, env, git, run, commit, push };
}

/**
 * D229: a stand-in claude at `<root>/bin/claude` (over the one `pushRepo` wrote) that records `{ argv, cwd, env, pid }`
 * on one line of `<root>/claude-runs.jsonl` and runs nothing, then exits with `$FAKE_CC_EXIT`, else 0. Its own file is
 * named fake-claude.mjs, so `runProcesses` finds one a test left going. Returns `{ path, log, runs() }`.
 */
export async function recordingClaude(home) {
  const root = await realpath(home.root);
  const log = join(root, 'claude-runs.jsonl');
  const script = join(root, 'fake-claude.mjs');
  await writeFile(script, `import { appendFileSync } from 'node:fs';
appendFileSync(process.env.FAKE_CC_LOG, JSON.stringify({ argv: process.argv.slice(2), cwd: process.cwd(), pid: process.pid,
  env: { CLAUDE_CONFIG_DIR: process.env.CLAUDE_CONFIG_DIR ?? null, HOME: process.env.HOME ?? null,
    CLAUDECODE: process.env.CLAUDECODE ?? null, ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY ?? null } }) + '\\n');
appendFileSync(process.env.HOME + '/fake-claude.pids', process.pid + '\\n');
process.exit(Number(process.env.FAKE_CC_EXIT || 0));
`);
  const path = join(root, 'bin', 'claude');
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `#!/bin/sh\nexec '${process.execPath}' '${script}' "$@"\n`);
  await chmod(path, 0o755);
  return { path, log,
    runs: async () => {
      let text = '';
      try { text = await readFile(log, 'utf8'); } catch { return []; }
      return text.split('\n').filter(Boolean).map((line) => JSON.parse(line));
    } };
}

/** D229: a terminal for `sonah fix`: always a terminal, the answers given in turn, everything said kept. */
export function terminalWith(answers = []) {
  const said = [];
  return { isTTY: true, said, text: () => said.join(''), out: (text) => { said.push(text); },
    ask: async (question) => { said.push(question); return answers.shift() ?? ''; } };
}

/**
 * D229: a Claude Code recording of the session `id` at `<configDir>/projects/<slug>/<id>.jsonl`: one Bash tool call
 * that ran in `cwd` from `from` to `to` (ISO times), as Claude Code writes the call and its result. Its path.
 */
export async function writeRecording(configDir, slug, id,
  { cwd, from = '2026-11-08T10:00:00.000Z', to = '2026-11-08T10:00:10.000Z' }) {
  const dir = join(configDir, 'projects', slug);
  await mkdir(dir, { recursive: true });
  const rows = [
    { type: 'user', timestamp: '2026-11-08T09:59:00.000Z', cwd, sessionId: id,
      message: { role: 'user', content: 'make add check its inputs' } },
    { type: 'assistant', timestamp: from, cwd, sessionId: id, message: { role: 'assistant',
      content: [{ type: 'tool_use', id: 'toolu_01', name: 'Bash', input: { command: 'git commit -am "Check add"' } }] } },
    { type: 'user', timestamp: to, cwd, sessionId: id, message: { role: 'user',
      content: [{ type: 'tool_result', tool_use_id: 'toolu_01', content: 'ok' }] } },
  ];
  const file = join(dir, `${id}.jsonl`);
  await writeFile(file, `${rows.map((row) => JSON.stringify(row)).join('\n')}\n`);
  return file;
}

const alive = (pid) => { try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; } };
/** The command line of a running process, or '' (ps). */
const commandOf = (pid) => {
  try { return execFileSync('ps', ['-o', 'command=', '-p', String(pid)], { encoding: 'utf8' }).trim(); }
  catch { return ''; }
};
const json = (file) => { try { return JSON.parse(readFileSync(file, 'utf8')); } catch { return null; } };
/** D230: the `sonah remind-refresh <folder>` processes whose folder is under `root` (by either spelling: a temp
 *  folder's real path differs on macOS). */
export function refreshesUnder(root) {
  const places = [root];
  try { places.push(realpathSync(root)); } catch { /* gone */ }
  let listed = '';
  try { listed = execFileSync('ps', ['-ax', '-o', 'pid=,command='], { encoding: 'utf8' }); } catch { return []; }
  return listed.split('\n').map((line) => /^\s*(\d+)\s+(.*)$/.exec(line)).filter(Boolean)
    .filter(([, , command]) => /sonah\.js remind-refresh /.test(command) && places.some((place) => command.includes(place)))
    .map(([, pid]) => Number(pid)).filter((pid) => pid !== process.pid);
}
const linesOf = (file) => { try { return readFileSync(file, 'utf8').split('\n').filter(Boolean); } catch { return []; } };

/**
 * D227: the processes of the push runs under `root` (a sealed home's folder) that run now: each runner that holds a
 * queue's runner.lock or the job slot, or that runs.json names as running, and each claude stand-in that logged its
 * pid ($HOME/claude-calls.jsonl, $HOME/fake-claude.pids), when its command line still names Sonah or the stand-in.
 * D230: and each `sonah remind-refresh` whose folder is under `root` (ps), which the reminder starts detached.
 */
export function runProcesses(root) {
  const team = join(root, 'sonah home', 'team');
  const pids = new Set();
  for (const lock of [join(team, 'locks', 'job.lock'), ...(() => {
    try { return readdirSync(join(team, 'queue')).map((d) => join(team, 'queue', d, 'runner.lock')); } catch { return []; }
  })()]) {
    const pid = json(lock)?.pid;
    if (Number.isSafeInteger(pid)) pids.add(pid);
  }
  for (const run of json(join(team, 'runs.json'))?.runs ?? []) if (Number.isSafeInteger(run?.pid)) pids.add(run.pid);
  const claude = new Set();
  for (const line of linesOf(join(root, 'claude-calls.jsonl'))) { try { claude.add(JSON.parse(line).pid); } catch {} }
  for (const line of linesOf(join(root, 'fake-claude.pids'))) claude.add(Number(line));
  const out = [];
  for (const pid of pids) {
    if (pid !== process.pid && alive(pid) && /sonah\.js.* push-run /.test(commandOf(pid))) out.push(pid);
  }
  for (const pid of claude) {
    const command = Number.isSafeInteger(pid) && alive(pid) ? commandOf(pid) : '';
    if (/fake-claude|gated-claude|stubborn-claude/.test(command)) out.push(pid);
  }
  out.push(...refreshesUnder(root));
  return out;
}

/** D227: stops the push runs under `root`: SIGTERM to each process and its group, up to 3 s to end, then SIGKILL. */
export async function stopRuns(root) {
  const send = (pid, signal) => {
    for (const target of [-pid, pid]) { try { process.kill(target, signal); } catch { /* gone */ } }
  };
  let left = runProcesses(root);
  for (const pid of left) send(pid, 'SIGTERM');
  for (let i = 0; i < 30 && left.some(alive); i++) await new Promise((resolve) => setTimeout(resolve, 100));
  for (const pid of left.filter(alive)) send(pid, 'SIGKILL');
  left = runProcesses(root);
  for (const pid of left) send(pid, 'SIGKILL');
}

/** D230: moved here from d225-push-hook.test.js, so the hidden remind-hook is held to the push hook's rule
 *  (d230-remind.test.js). */
/** The static import closure of the module at `path` (under the repository), as Node evaluates it: Map path -> bytes.
 *  A specifier that is not a relative path is one of Node's own modules, and an `import()` inside a function is paid
 *  only by a caller that reaches it, so neither is followed. Comments are taken out before the imports are read. */
export async function staticClosure(path) {
  const root = fileURLToPath(new URL('../../../', import.meta.url));
  const found = new Map();
  const walk = async (relative) => {
    if (found.has(relative)) return;
    const text = await readFile(join(root, relative), 'utf8');
    found.set(relative, Buffer.byteLength(text));
    const code = text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    for (const [, from, bare] of code.matchAll(
      /^[ \t]*(?:import|export)\b[^'"]*?\bfrom\s*['"]([^'"]+)['"]|^[ \t]*import\s*['"]([^'"]+)['"]/gm)) {
      const specifier = from ?? bare;
      if (!specifier.startsWith('.')) continue;
      await walk(join(dirname(relative), specifier));
    }
  };
  await walk(path);
  return found;
}
