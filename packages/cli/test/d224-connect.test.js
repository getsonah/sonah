// D224 (item 10, C2): `sonah connect`, `sonah connect --token`, `sonah disconnect` and `sonah status` against a stand-in
// Sonah Team server on 127.0.0.1 (team-helpers.js), in a sealed SONAH_HOME. The order the plan's A1 sets: the code is
// exchanged, GET /api/token names whose the token is, Sonah shows "@login on <server>" and the seat (A6), asks, and a no
// revokes the token (DELETE /api/token); without a terminal it sends nothing. A connection to another server or login is
// replaced only after its own question, and the old token is then revoked (A5). Every refusal exits 2 with its words and
// fix. The token is never printed, never in a URL, and in no file but team/connection.json (0600 in a 0700 folder).
import test from 'node:test';
import assert from 'node:assert/strict';
import { chmod, lstat, mkdir, readFile, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { join } from 'node:path';
import { TEAM_PROBLEMS } from '../../evidence/src/ledger.js';
import { CONNECT_USAGE, CONNECT_WORDS, TEAM_FIX_WORDS, TEAM_PROBLEM_WORDS, parseConnectArgs, runConnectCommand,
  runDisconnectCommand, runStatusCommand, tokenName } from '../src/connect-command.js';
import { connectionPath, parseConnection, readConnection, writeConnection } from '../src/team-home.js';
import { teamProblemOf, TeamApiError } from '../src/team-api.js';
import { filesUnder, newToken, runEntry, sealedHome, streams, teamServer } from './team-helpers.js';

const OCTO = Object.freeze({ login: 'octo', team: 'Acme', seat: 'paid' });

/** `sonah connect` in-process, in a terminal unless `interactive` is false: `answers` answer its questions in order
 *  ('' is Enter, 'y', 'n'); `token` is what comes on standard input. D225: it runs in the sealed home, outside any git
 *  working tree, so connect offers no push hook (d225-push-hook.test.js tests the offer). */
async function connect(argv, { env, answers = [], interactive = true, token = null, host = 'test-host' }) {
  const out = streams();
  const asked = [];
  const code = await runConnectCommand(argv, { stdout: out.stdout, stderr: out.stderr, env, interactive,
    cwd: env.HOME, hostname: () => host,
    ask: async (question, { yes }) => {
      asked.push({ question, yes });
      assert.ok(answers.length > 0, `a question that the test does not answer: ${question}`);
      const said = answers.shift();
      return said === '' ? yes : said === 'y';
    },
    readToken: async () => token });
  assert.deepEqual(answers, [], 'every answer was asked for');
  return { code, asked, ...out.chunks };
}
const disconnect = async (env) => {
  const out = streams();
  return { code: await runDisconnectCommand([], { ...out, env }), ...out.chunks };
};
const status = async (env) => {
  const out = streams();
  return { code: await runStatusCommand([], { ...out, env }), ...out.chunks };
};

/** The token is in no output, in no URL a server got, and in no file but the connection file. */
async function tokenKeptSecret(home, servers, results) {
  const tokens = servers.flatMap((s) => [...s.tokens.keys()]);
  assert.ok(tokens.length > 0);
  for (const token of tokens) {
    for (const r of results) assert.ok(!`${r.stdout}${r.stderr}`.includes(token), 'a token was printed');
    for (const s of servers) for (const call of s.calls) {
      assert.ok(!call.url.includes(token), 'a token was put in a URL');
      assert.ok(!call.body.includes(token), 'a token was sent in a body');
    }
    for (const f of await filesUnder(home.root))
      if (f.text.includes(token)) assert.equal(f.path, home.file, `a token was written to ${f.path}`);
  }
}
const problem = (code, args, fixArgs = args) => {
  const says = TEAM_PROBLEM_WORDS[code], fix = TEAM_FIX_WORDS[code];
  return `${typeof says === 'function' ? says(...args) : says}\n${fix === undefined ? ''
    : `Fix: ${typeof fix === 'function' ? fix(...fixArgs) : fix}\n`}`;
};
const mode = async (path) => (await stat(path)).mode & 0o777;

test('connect with a code: the exchange, whose the token is, the question, then the connection file (0600 in 0700)',
  async (t) => {
  const home = await sealedHome(t);
  const server = await teamServer(t, { codes: { 'ABCD-EFGH': OCTO } });
  const r = await connect(['ABCD-EFGH', '--server', server.url], { env: home.env, answers: [''] });
  assert.equal(r.code, 0, r.stderr);
  assert.deepEqual(r.asked, [{ question: CONNECT_WORDS.ask(server.url, 'octo'), yes: true }]);
  assert.equal(r.stdout, [CONNECT_WORDS.whose.code(server.url, 'octo'), CONNECT_WORDS.seat.paid('Acme'),
    CONNECT_WORDS.connected(server.url, 'octo'), CONNECT_WORDS.kept(home.file), ''].join('\n'));
  assert.equal(r.stderr, '');
  // The calls, in A1's order: the exchange (no token), then GET /api/token with the new token in its header only.
  assert.deepEqual(server.calls.map((c) => `${c.method} ${c.url}`), ['POST /api/device/exchange', 'GET /api/token']);
  const [exchange, whoami] = server.calls;
  assert.deepEqual(JSON.parse(exchange.body), { code: 'ABCD-EFGH', name: 'sonah on test-host' });
  assert.equal(exchange.authorization, null);
  assert.equal(exchange.contentType, 'application/json');
  const [token] = server.tokens.keys();
  assert.equal(whoami.authorization, `Bearer ${token}`);
  assert.ok(server.calls.every((c) => c.userAgent === 'getsonah'));
  // The file: the server Sonah sent the code to (never the answer's `server`), the token and the login.
  assert.deepEqual(JSON.parse(await readFile(home.file, 'utf8')), { v: 1, server: server.url, token, login: 'octo' });
  assert.equal(await mode(home.file), 0o600);
  assert.equal(await mode(join(home.sonahHome, 'team')), 0o700);
  assert.equal(await mode(home.sonahHome), 0o700);
  assert.ok(server.live(token));
  await tokenKeptSecret(home, [server], [r]);
});

test('a no revokes the token that the code made, keeps nothing and exits 1; a failed revoke says where to revoke it',
  async (t) => {
  const home = await sealedHome(t);
  const server = await teamServer(t, { codes: { AAAABBBB: OCTO, CCCCDDDD: OCTO } });
  const no = await connect(['AAAABBBB', '--server', server.url], { env: home.env, answers: ['n'] });
  assert.equal(no.code, 1);
  const [first] = server.tokens.keys();
  assert.equal(server.live(first), false, 'the token is revoked');
  assert.deepEqual(server.calls.map((c) => `${c.method} ${c.path}`), ['POST /api/device/exchange', 'GET /api/token',
    'DELETE /api/token']);
  assert.equal(server.calls[2].authorization, `Bearer ${first}`);
  assert.ok(no.stdout.endsWith(`${CONNECT_WORDS.saidNo}\n${CONNECT_WORDS.newRevoked}\n`));
  await assert.rejects(stat(home.file), { code: 'ENOENT' });

  server.once('DELETE', '/api/token', { status: 503, json: { error: 'unavailable' } });
  const live = await connect(['CCCCDDDD', '--server', server.url], { env: home.env, answers: ['no'] });
  assert.equal(live.code, 1);
  assert.ok(live.stdout.endsWith(`${CONNECT_WORDS.saidNo}\n${CONNECT_WORDS.newLive(server.url)}\n`));
  assert.match(live.stdout, /settings\/tokens/);
  await assert.rejects(stat(home.file), { code: 'ENOENT' });
  await tokenKeptSecret(home, [server], [no, live]);
});

test('without a terminal, connect with a code sends nothing and exits 2, so the code still works (the real entry)',
  async (t) => {
  const home = await sealedHome(t);
  const server = await teamServer(t, { codes: { 'ABCD-EFGH': OCTO } });
  const r = await runEntry(['connect', 'ABCD-EFGH', '--server', server.url], { env: home.env });
  assert.equal(r.code, 2);
  assert.equal(r.stdout, '');
  assert.equal(r.stderr, problem('team_no_terminal', []));
  assert.deepEqual(server.calls, []);
  assert.deepEqual(await filesUnder(home.root), []);
  // The same code then connects in a terminal.
  assert.equal((await connect(['ABCD-EFGH', '--server', server.url], { env: home.env, answers: ['y'] })).code, 0);
});

test('every refusal of the exchange exits 2 with its words and fix, and keeps nothing', async (t) => {
  const home = await sealedHome(t);
  const server = await teamServer(t);
  const elsewhere = await teamServer(t);
  const cases = [
    [{ status: 400, json: { error: 'bad_code' } }, problem('team_bad_code', [server.url])],
    [{ status: 429, json: { error: 'rate_limited' }, headers: { 'retry-after': '60' } },
      problem('team_rate_limited', [server.url])],
    [{ status: 409, json: { error: 'too_many_tokens' } }, problem('team_too_many_tokens', [server.url])],
    [{ status: 415, json: { error: 'unsupported_type' } }, problem('team_refused', [server.url, 415, 'unsupported_type'],
      [server.url])],
    // A code that is not one (a long word, an upper-case one) is never shown; nor is a body that is not JSON.
    [{ status: 500, json: { error: 'Internal_Error' } }, problem('team_refused', [server.url, 500, null], [server.url])],
    [{ status: 302, headers: { location: `${elsewhere.url}/api/device/exchange` } },
      problem('team_redirect', [server.url])],
    [{ status: 201, json: { login: 'octo', server: server.url } }, problem('team_answer', [server.url])],
    [{ status: 201, json: { token: 'short', login: 'octo' } }, problem('team_answer', [server.url])],
  ];
  for (const [answer, words] of cases) {
    server.once('POST', '/api/device/exchange', answer);
    const r = await connect(['WXYZ2345', '--server', server.url], { env: home.env });
    assert.equal(r.code, 2, words);
    assert.equal(r.stderr, words);
    assert.equal(r.stdout, '');
  }
  assert.deepEqual(elsewhere.calls, [], 'a redirect is never followed');
  // A server that does not answer: nothing listens on this port once it is closed.
  const gone = await new Promise((resolve) => {
    const s = createServer().listen(0, '127.0.0.1', () => { const url = `http://127.0.0.1:${s.address().port}`;
      s.close(() => resolve(url)); });
  });
  const unreachable = await connect(['WXYZ2345', '--server', gone], { env: home.env });
  assert.equal(unreachable.code, 2);
  assert.equal(unreachable.stderr, problem('team_unreachable', [gone]));
  assert.ok(server.calls.every((c) => c.path === '/api/device/exchange'), 'no token was made, so nothing else is called');
  await assert.rejects(stat(home.file), { code: 'ENOENT' });
  for (const code of ['team_bad_code', 'team_rate_limited', 'team_too_many_tokens', 'team_refused', 'team_redirect',
    'team_answer', 'team_unreachable']) assert.ok(TEAM_PROBLEMS.includes(code));
});

test('the seat (A6): a paid seat, a free seat that teammates cannot read, no team; and when GET /api/token fails',
  async (t) => {
  const home = await sealedHome(t);
  const server = await teamServer(t, { codes: { PAID1111: OCTO, FREE2222: { login: 'free-one', team: 'Acme',
    seat: 'free' }, NONE3333: { login: 'loner', team: null, seat: null }, DOWN4444: OCTO, DOWN5555: OCTO,
  GONE6666: OCTO } });
  const free = await connect(['FREE2222', '--server', server.url], { env: home.env, answers: ['n'] });
  assert.ok(free.stdout.includes(`${CONNECT_WORDS.seat.free('Acme')}\n`));
  assert.match(CONNECT_WORDS.seat.free('Acme'), /teammates cannot/);
  const none = await connect(['NONE3333', '--server', server.url], { env: home.env, answers: ['n'] });
  assert.ok(none.stdout.includes(`${CONNECT_WORDS.seat.none}\n`));
  // GET /api/token not answered (an older server, 404): the exchange's login names whose it is, and the seat is not read.
  server.once('GET', '/api/token', { status: 404, json: { error: 'not_found' } });
  const older = await connect(['DOWN4444', '--server', server.url], { env: home.env, answers: ['y'] });
  assert.equal(older.code, 0);
  assert.equal(older.stdout.split('\n').slice(0, 2).join('\n'), `${CONNECT_WORDS.whose.code(server.url, 'octo')}\n`
    + CONNECT_WORDS.seat.notRead);
  // The server refuses the token it has just made: nothing to keep or revoke.
  server.once('GET', '/api/token', { status: 401, json: { error: 'bad_token' } });
  const refused = await connect(['DOWN5555', '--server', server.url], { env: home.env });
  assert.equal(refused.code, 2);
  assert.equal(refused.stderr, problem('team_answer', [server.url]));
  // No login from either answer: no one can tell whose the token is, so Sonah revokes it and asks nothing.
  server.once('POST', '/api/device/exchange', () => ({ status: 201, json: { token: server.addToken(OCTO), login: '' } }));
  server.once('GET', '/api/token', { status: 500 });
  const nobody = await connect(['GONE6666', '--server', server.url], { env: home.env });
  assert.equal(nobody.code, 2);
  assert.equal(nobody.stderr, `${problem('team_refused', [server.url, 500, null], [server.url])}`
    + `${CONNECT_WORDS.newRevoked}\n`);
  // In the order made: the two answered no and the one no one could name are revoked; the kept one and the one the
  // server refused (it stays live on this stand-in) are not.
  assert.deepEqual([...server.tokens.values()].map((p) => p.live), [false, false, true, true, false]);
  await tokenKeptSecret(home, [server], [free, none, older, refused, nobody]);
});

test('replacing (A5): another login asks first (default no); a yes revokes the old token on its own server', async (t) => {
  const home = await sealedHome(t);
  const first = await teamServer(t, { codes: { FIRST111: OCTO, AGAIN222: OCTO } });
  const second = await teamServer(t, { codes: { OTHER333: { login: 'other', team: 'Beta', seat: 'paid' },
    OTHER444: { login: 'other', team: 'Beta', seat: 'paid' } } });
  assert.equal((await connect(['FIRST111', '--server', first.url], { env: home.env, answers: [''] })).code, 0);
  const [oldToken] = first.tokens.keys();
  const before = await readFile(home.file, 'utf8');
  // Enter keeps the old connection, and the new token is revoked.
  const kept = await connect(['OTHER333', '--server', second.url], { env: home.env, answers: [''] });
  assert.equal(kept.code, 1);
  assert.deepEqual(kept.asked, [{ question: CONNECT_WORDS.askReplace(second.url, 'other'), yes: false }]);
  assert.ok(kept.stdout.includes(`${CONNECT_WORDS.replacing(first.url, 'octo')}\n`));
  assert.equal(await readFile(home.file, 'utf8'), before);
  assert.equal(first.live(oldToken), true);
  assert.equal([...second.tokens.keys()].some((tk) => second.live(tk)), false);
  // y replaces it: the old token is revoked on the first server, with the old token, and the new one is kept.
  const replaced = await connect(['OTHER444', '--server', second.url], { env: home.env, answers: ['y'] });
  assert.equal(replaced.code, 0, replaced.stderr);
  assert.equal(first.live(oldToken), false);
  const revoke = first.calls.at(-1);
  assert.deepEqual([revoke.method, revoke.path, revoke.authorization], ['DELETE', '/api/token', `Bearer ${oldToken}`]);
  assert.ok(replaced.stdout.includes(`${CONNECT_WORDS.oldRevoked}\n`));
  const now = JSON.parse(await readFile(home.file, 'utf8'));
  assert.deepEqual([now.server, now.login], [second.url, 'other']);
  assert.ok(second.live(now.token));
  // The saved server is the default: the same login there connects again with the connecting question only, and
  // the old token is revoked; one that cannot be revoked is said, with exit 1.
  const reToken = first.addToken(OCTO);
  await writeConnection({ server: first.url, token: reToken, login: 'octo' }, { env: home.env });
  first.once('DELETE', '/api/token', { status: 502 });
  const same = await connect(['AGAIN222'], { env: home.env, answers: ['y'] });
  assert.equal(same.code, 1);
  assert.deepEqual(same.asked.map((a) => a.question), [CONNECT_WORDS.ask(first.url, 'octo')]);
  assert.ok(same.stdout.includes(`${CONNECT_WORDS.oldLive(first.url)}\n`));
  assert.equal(first.live(reToken), true);
  await tokenKeptSecret(home, [first, second], [kept, replaced, same]);
});

test('connect --token: the token on standard input, checked with GET /api/token and shown before Sonah keeps it',
  async (t) => {
  const home = await sealedHome(t);
  const server = await teamServer(t);
  const token = server.addToken(OCTO);
  // The real entry, the token piped in (a newline and spaces around it): not a terminal, and no question is needed.
  const r = await runEntry(['connect', '--token', '--server', server.url], { env: home.env, input: `\n  ${token}  \n` });
  assert.equal(r.code, 0, r.stderr);
  assert.equal(r.stdout, [CONNECT_WORDS.whose.token(server.url, 'octo'), CONNECT_WORDS.seat.paid('Acme'),
    CONNECT_WORDS.connected(server.url, 'octo'), CONNECT_WORDS.kept(home.file), ''].join('\n'));
  assert.deepEqual(server.calls.map((c) => `${c.method} ${c.url} ${c.authorization === `Bearer ${token}`}`),
    ['GET /api/token true']);
  assert.deepEqual(JSON.parse(await readFile(home.file, 'utf8')), { v: 1, server: server.url, token, login: 'octo' });
  assert.equal(await mode(home.file), 0o600);
  // Refusals keep nothing and change nothing: a revoked token, a server that does not answer, not a token's shape.
  const other = await sealedHome(t);
  const revoked = server.addToken(OCTO);
  server.tokens.get(revoked).live = false;
  const bad = await runEntry(['connect', '--token', '--server', server.url], { env: other.env, input: revoked });
  assert.deepEqual([bad.code, bad.stdout, bad.stderr], [2, '', problem('team_bad_token', [server.url])]);
  const calls = server.calls.length;
  const shape = await runEntry(['connect', '--token', '--server', server.url], { env: other.env, input: 'not one\n' });
  assert.deepEqual([shape.code, shape.stderr], [2, problem('team_not_a_token', [], [server.url])]);
  const empty = await runEntry(['connect', '--token', '--server', server.url], { env: other.env, input: '' });
  assert.equal(empty.code, 2);
  assert.equal(server.calls.length, calls, 'a token not of its shape is never sent');
  await assert.rejects(stat(other.file), { code: 'ENOENT' });
  await tokenKeptSecret(home, [server], [r, bad, shape, empty]);
});

test('connect --token for another login: refused without a terminal; in a terminal a no leaves both tokens live',
  async (t) => {
  const home = await sealedHome(t);
  const server = await teamServer(t);
  const mine = server.addToken(OCTO);
  await writeConnection({ server: server.url, token: mine, login: 'octo' }, { env: home.env });
  const before = await readFile(home.file, 'utf8');
  const theirs = server.addToken({ login: 'other', team: 'Acme', seat: 'free' });
  const piped = await runEntry(['connect', '--token'], { env: home.env, input: `${theirs}\n` });
  assert.equal(piped.code, 2);
  assert.equal(piped.stderr, problem('team_replace_no_terminal', [server.url, 'octo']));
  assert.equal(await readFile(home.file, 'utf8'), before);
  const no = await connect(['--token'], { env: home.env, token: theirs, answers: ['n'] });
  assert.equal(no.code, 1);
  assert.deepEqual(no.asked.map((a) => [a.question, a.yes]), [[CONNECT_WORDS.askReplace(server.url, 'other'), false]]);
  assert.ok(no.stdout.endsWith(`${CONNECT_WORDS.saidNo}\n${CONNECT_WORDS.tokenStays}\n`));
  assert.equal(await readFile(home.file, 'utf8'), before);
  assert.ok(server.live(mine) && server.live(theirs), 'Sonah revoked no token');
  assert.ok(server.calls.every((c) => c.method === 'GET'));
  // The same token again: kept, and not revoked (it is the one being kept).
  const same = await connect(['--token'], { env: home.env, token: mine });
  assert.equal(same.code, 0);
  assert.deepEqual(same.asked, []);
  assert.ok(server.live(mine));
  // Ctrl-C at the prompt: 130, nothing sent.
  const calls = server.calls.length;
  const out = streams();
  assert.equal(await runConnectCommand(['--token'], { ...out, env: home.env, interactive: true, cwd: home.root,
    readToken: async () => null }), 130);
  assert.equal(server.calls.length, calls);
  await tokenKeptSecret(home, [server], [piped, no, same, out.chunks]);
});

test('disconnect revokes the token, then deletes the connection; offline it deletes it and says where to revoke it',
  async (t) => {
  const home = await sealedHome(t);
  const server = await teamServer(t);
  const save = async () => {
    const token = server.addToken(OCTO);
    await writeConnection({ server: server.url, token, login: 'octo' }, { env: home.env });
    return token;
  };
  const token = await save();
  const done = await disconnect(home.env);
  assert.deepEqual([done.code, done.stdout, done.stderr], [0, `${CONNECT_WORDS.disconnected(server.url)}\n`, '']);
  assert.equal(server.live(token), false);
  assert.deepEqual([server.calls.at(-1).method, server.calls.at(-1).authorization], ['DELETE', `Bearer ${token}`]);
  await assert.rejects(stat(home.file), { code: 'ENOENT' });
  // Nothing to disconnect: exit 2, nothing sent.
  const calls = server.calls.length;
  const nothing = await disconnect(home.env);
  assert.deepEqual([nothing.code, nothing.stderr], [2, problem('team_not_connected', [])]);
  assert.equal(server.calls.length, calls);
  // A token the server no longer takes: the connection is deleted, exit 0.
  const gone = await save();
  server.tokens.get(gone).live = false;
  const ended = await disconnect(home.env);
  assert.deepEqual([ended.code, ended.stdout], [0, `${CONNECT_WORDS.alreadyEnded(server.url)}\n`]);
  // The server fails or cannot be reached: the connection is deleted, the token is said to be live, exit 1.
  const live = await save();
  server.once('DELETE', '/api/token', { status: 503 });
  const down = await disconnect(home.env);
  assert.equal(down.code, 1);
  assert.equal(down.stdout, `${TEAM_PROBLEM_WORDS.team_refused(server.url, 503, null)}\n`
    + `${CONNECT_WORDS.deletedLive(server.url)}\n`);
  assert.ok(server.live(live));
  await assert.rejects(stat(home.file), { code: 'ENOENT' });
  // A file Sonah cannot read as a connection: deleted, no call, exit 1.
  await writeFile(home.file, '{"v":1}\n', { mode: 0o600 });
  const before = server.calls.length;
  const unreadable = await disconnect(home.env);
  assert.deepEqual([unreadable.code, unreadable.stdout], [1, `${CONNECT_WORDS.deletedUnreadable(home.file)}\n`]);
  assert.equal(server.calls.length, before);
  await assert.rejects(stat(home.file), { code: 'ENOENT' });
  await tokenKeptSecret(home, [server], [done, nothing, ended, down, unreadable]);
});

test('status: the server, the login, the team and the seat; never the token', async (t) => {
  const home = await sealedHome(t);
  const server = await teamServer(t);
  const none = await status(home.env);
  assert.deepEqual([none.code, none.stdout], [0, `${CONNECT_WORDS.status.none}\n`]);
  assert.deepEqual(server.calls, []);
  const token = server.addToken({ login: 'octo', team: 'Acme \u001b[31mRed‮', seat: 'free' });
  await writeConnection({ server: server.url, token, login: 'octo' }, { env: home.env });
  const free = await status(home.env);
  assert.equal(free.code, 0);
  // The team's name as the server gives it, with what no one sees or that moves the line shown escaped.
  assert.equal(free.stdout, `${CONNECT_WORDS.status.connected(server.url, 'octo')}\n`
    + `${CONNECT_WORDS.seat.free('Acme \\u001b[31mRed\\u202e')}\n`);
  assert.deepEqual([server.calls.at(-1).method, server.calls.at(-1).url], ['GET', '/api/token']);
  server.once('GET', '/api/token', { status: 429, json: { error: 'rate_limited' } });
  const busy = await status(home.env);
  assert.deepEqual([busy.code, busy.stdout], [0, `${CONNECT_WORDS.status.connected(server.url, 'octo')}\n`
    + `${TEAM_PROBLEM_WORDS.team_rate_limited(server.url)}\n${CONNECT_WORDS.seat.notRead}\n`]);
  server.tokens.get(token).live = false;
  const refused = await status(home.env);
  assert.deepEqual([refused.code, refused.stdout], [1, `${CONNECT_WORDS.status.connected(server.url, 'octo')}\n`
    + `${CONNECT_WORDS.status.refused(server.url)}\n`]);
  await writeFile(home.file, 'not json', { mode: 0o600 });
  const unreadable = await status(home.env);
  assert.deepEqual([unreadable.code, unreadable.stdout], [1, `${CONNECT_WORDS.status.unreadable(home.file)}\n`]);
  // The real entry says the same, and takes no argument.
  await writeConnection({ server: server.url, token: server.addToken(OCTO), login: 'octo' }, { env: home.env });
  const entry = await runEntry(['status'], { env: home.env });
  assert.deepEqual([entry.code, entry.stdout], [0, `${CONNECT_WORDS.status.connected(server.url, 'octo')}\n`
    + `${CONNECT_WORDS.seat.paid('Acme')}\n`]);
  // D227: --json and --all are its options now; any other is a usage error.
  const extra = await runEntry(['status', '--bogus'], { env: home.env });
  assert.deepEqual([extra.code, extra.stderr], [2, 'sonah status: unknown option --bogus.\nusage: sonah status [--json] '
    + '[--all]\n']);
  await tokenKeptSecret(home, [server], [none, free, busy, refused, unreadable, entry, extra]);
});

test('the connection file is read only as the person\'s own regular file of its shape; one others read is closed',
  async (t) => {
  const home = await sealedHome(t);
  const where = { env: home.env };
  const token = newToken();
  assert.equal((await readConnection(where)).state, 'absent');
  await writeConnection({ server: 'https://pr.sonah.dev', token, login: 'octo' }, where);
  assert.deepEqual(await readConnection(where), { state: 'ok', connection: { server: 'https://pr.sonah.dev', token,
    login: 'octo' } });
  await chmod(home.file, 0o644);
  assert.equal((await readConnection(where)).state, 'ok');
  assert.equal(await mode(home.file), 0o600, 'closed to others once read');
  await chmod(home.file, 0o620);
  assert.equal((await readConnection(where)).state, 'invalid', 'others can write it');
  await chmod(home.file, 0o600);
  const text = await readFile(home.file, 'utf8');
  const elsewhere = join(home.root, 'elsewhere.json');
  await writeFile(elsewhere, text, { mode: 0o600 });
  await rm(home.file);
  await symlink(elsewhere, home.file);
  assert.equal((await readConnection(where)).state, 'invalid', 'a link is never followed');
  assert.ok((await lstat(home.file)).isSymbolicLink());
  for (const shape of [{ v: 2, server: 'https://pr.sonah.dev', token, login: 'octo' },
    { v: 1, server: 'http://pr.sonah.dev', token, login: 'octo' }, { v: 1, server: 'https://pr.sonah.dev/', token,
      login: 'octo' }, { v: 1, server: 'https://pr.sonah.dev', token: 'short', login: 'octo' },
    { v: 1, server: 'https://pr.sonah.dev', token, login: '-octo' }, { v: 1, server: 'https://pr.sonah.dev', token,
      login: 'octo', team: 'Acme' }]) assert.equal(parseConnection(JSON.stringify(shape)), null, JSON.stringify(shape));
  assert.equal(connectionPath(where), join(home.sonahHome, 'team', 'connection.json'));
  await assert.rejects(writeConnection({ server: 'https://pr.sonah.dev', token: 'short', login: 'octo' }, where));
});

test('usage: no value the person typed is echoed, --hook and --no-hook once each, and the usage is within 80 columns',
  async (t) => {
  const home = await sealedHome(t);
  const token = newToken();
  for (const [argv, said] of [
    [[], 'give the code that Sonah Team shows'],
    [['--token', token], '--token takes the token on standard input, never on the command line'],
    [[token.slice(0, 41)], 'a code has 4 to 40 letters, digits, spaces or hyphens'],
    [[`--token=${token}`], 'unknown option --token=...'],
    // A server address that holds a user and a password (built here, so no such address is written in this file).
    [['ABCD-EFGH', '--server', ['https://user', `${token}@pr.sonah.dev`].join(':')], '--server takes an https address, '
      + 'such as https://pr.sonah.dev'],
    [['ABCD-EFGH', '--server'], '--server needs a value'],
    [['ABCD-EFGH', 'EFGH-ABCD'], 'more than one code is given'],
    // D225: --hook and --no-hook are taken (the push hook's offer), each once, and not both.
    [['ABCD-EFGH', '--hook', '--no-hook'], 'give --hook or --no-hook, not both'],
    [['ABCD-EFGH', '--no-hook', '--no-hook'], '--no-hook is given twice'],
  ]) {
    assert.throws(() => parseConnectArgs(argv), (e) => e.problem === said, argv.join(' '));
    const r = await connect(argv, { env: home.env });
    assert.equal(r.code, 2);
    assert.ok(!r.stderr.includes(token), 'a value was echoed');
    assert.equal(r.stderr, `sonah connect: ${said}${said.endsWith('...') ? '' : '.'}\nusage: ${CONNECT_USAGE}\n`);
  }
  const extra = streams();
  assert.equal(await runDisconnectCommand(['now'], { ...extra, env: home.env }), 2);
  assert.equal(extra.chunks.stderr, 'sonah disconnect: it takes no argument.\nusage: sonah disconnect\n');
  for (const line of `usage: ${CONNECT_USAGE}`.split('\n')) assert.ok(line.length <= 80, line);
  assert.deepEqual(parseConnectArgs(['ab12 CD34', '--server', 'https://team.example/sonah/']),
    { code: 'ab12 CD34', token: false, server: 'https://team.example/sonah', hook: null });
  assert.deepEqual(parseConnectArgs(['--token', '--hook']), { code: null, token: true, server: null, hook: true });
  assert.deepEqual(parseConnectArgs(['ABCD-EFGH', '--no-hook']), { code: 'ABCD-EFGH', token: false, server: null,
    hook: false });
  await assert.rejects(stat(home.sonahHome), { code: 'ENOENT' });
});

test('decision 10: the exchange names the token "sonah on <host>", cut to 60 characters', async (t) => {
  const home = await sealedHome(t);
  const server = await teamServer(t, { codes: { LONGHOST: OCTO } });
  const host = 'a-very-long-host-name-of-a-laptop-that-goes-on.example.internal';
  await connect(['LONGHOST', '--server', server.url], { env: home.env, answers: ['n'], host });
  const { name } = JSON.parse(server.calls[0].body);
  assert.equal(name, tokenName(host));
  assert.equal(name.length, 60);
  assert.ok(name.startsWith('sonah on a-very-long-host-name'));
  // The error kinds and the problems they name.
  assert.equal(teamProblemOf(new TeamApiError('refused', { status: 401, code: 'bad_token' })), 'team_bad_token');
  assert.equal(teamProblemOf(new TeamApiError('unreachable')), 'team_unreachable');
  assert.equal(teamProblemOf(new Error('x')), null);
  assert.throws(() => new TeamApiError('other'));
  await mkdir(home.sonahHome, { recursive: true });
});
