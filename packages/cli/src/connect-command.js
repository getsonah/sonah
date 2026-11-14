// D224 (item 10, C2): `sonah connect`, `sonah disconnect` and `sonah status`, this computer's connection to a Sonah Team
// server (https://pr.sonah.dev unless --server names another): the first of the team commands. Ported from the private
// laptop client's `connect` and `login` (sonah-hosted client/sonah-pr.mjs), with getsonah's exit codes, its argument
// style (`--opt value` only) and its server rule (visual-command.js `visualServer`). The plan's A1 sets the order:
//   sonah connect <code>   exchanges the code for an upload token (POST /api/device/exchange, named "sonah on <this
//                          computer's host name>"), asks the server whose it is (GET /api/token), shows "@login on
//                          <server>" with the team and seat (A6: a free seat is told its teammates cannot read its
//                          reviews), and asks before it keeps it (decision 2). A no revokes it (DELETE /api/token). It asks
//                          only in a terminal: anywhere else it stops before it sends anything, so the code still works.
//   sonah connect --token  the same with a token from <server>/settings/tokens on standard input (decision 5; no echo in
//                          a terminal): GET /api/token checks it and names its login before Sonah keeps it. Sonah never
//                          revokes a token you gave it this way unless it replaces it later.
//   sonah disconnect       revokes the token on its server (DELETE /api/token), then deletes the connection; when the
//                          server cannot revoke it, deletes the connection all the same and says where to revoke it.
//   sonah status           the connection: the server, the login, the team and the seat (GET /api/token).
// A connection to another server or login is replaced only after its own question, and its token is then revoked (A5),
// as it is when the same login connects again. Sonah keeps one connection: team/connection.json (team-home.js).
// D225 (C3): once `sonah connect` keeps a connection in a git working tree, it offers the push hook of that repository
// (decision 3: "[Y/n]", with the cost and the server named; --hook turns it on, --no-hook does not ask), as
// `sonah hook add --push` turns it on (push-hook.js), then D143's commit link when it is off, after D143's words on the
// public line. Replacing a connection drops the push hook's tickets of the old one (A5); `sonah status` adds each
// repository with the push hook (push-hook.js `pushHookReport`), and marks a token its server refuses (401), so a push
// starts nothing until this computer connects again.
// D227 (C4): `sonah status [--json] [--all]` adds the reviews of pushes (push-run.js `runsReport`: the newest 10, or all,
// from team/runs.json, with no network call; a run whose process ended shows as `stopped`) and the comments that wait
// for you from the cache (fix-waiting.js); --json prints all of it as one JSON object. Replacing a connection also ends
// what the old one left: its waiting comments' cache and its uploads that wait (team-home.js `forgetOtherConnection`).
// D227 review: the runs of the tickets dropped, by a replacing connection or `sonah disconnect`, end `failed`,
// `connection_changed` (push-queue.js `forgetTickets`), and disconnect drops the tickets that way, so a running
// runner keeps its lock.
//
// Exit codes, as every command's (bin/sonah.js): 0 done; 1 it ran and something needs you (you answered no; a token that
// Sonah could not revoke, which you revoke on the server's page; a connection file it cannot read; a token the server no
// longer takes; D225: a push hook that printed a line for you to add, or that git does not run); 2 a usage error, or a
// problem named with its fix (ledger.js TEAM_PROBLEMS); 3 Sonah failed; 130 Ctrl-C at the token's prompt. The token is never printed, logged or put in a URL: only the Authorization header of a call to
// its own server carries it (team-api.js), and only team/connection.json keeps it.
//
// No work at import.
import { hostname as osHostname } from 'node:os';
import { createInterface } from 'node:readline';
import { HOOK_PROBLEMS, TEAM_PROBLEMS } from '../../evidence/src/ledger.js';
import { shown } from '../../visual/src/fix-prompt.mjs';
import { addHook, commitLinkFacts, HOOK_WORDS } from './agent-session-hook.js';
import { isInteractive } from './bare-command.js';
import { forgetTickets } from './push-queue.js';
import { teamApi, teamProblemOf } from './team-api.js';
import { gitOut } from './team-git.js';
import { connectionPath, forgetConnection, forgetOtherConnection, isToken, markRefused, readConnection,
  writeConnection } from './team-home.js';
import { VISUAL_DEFAULT_SERVER, visualServer } from './visual-command.js';

/** The commands' usage, each line within 80 columns after `usage: `. */
export const CONNECT_USAGE = 'sonah connect <code> [--server URL] [--hook|--no-hook]\n'
  + '       sonah connect --token [--server URL] [--hook|--no-hook]';
export const DISCONNECT_USAGE = 'sonah disconnect';
export const STATUS_USAGE = 'sonah status [--json] [--all]';
/** A code as Sonah Team shows it (8 letters and digits, often in two groups): what the private client took. */
const CODE_SHAPE = /^[A-Za-z0-9 -]{4,40}$/;
/** Decision 10: the name the exchange gives the token, as /settings/tokens lists it; the server keeps 60 characters. */
export const TOKEN_NAME_MAX = 60;
export const tokenName = (host) => `sonah on ${host}`.slice(0, TOKEN_NAME_MAX);
/** The most Sonah reads of what comes on standard input for --token. */
const MAX_TOKEN_INPUT = 64 * 1024;
/** D227 review: how the run of a ticket that a changed or ended connection drops ends (A5). */
const CONNECTION_CHANGED = Object.freeze({ state: 'failed', why: 'connection_changed' });

/** The lines the commands print, in fixed words. A login and a server are shown as the server and the file give them,
 *  after their checks; a team's name through fix-prompt.mjs `shown`. */
export const CONNECT_WORDS = Object.freeze({
  whose: {
    code: (server, login) => `This code connects this computer to ${server} as @${login}.`,
    token: (server, login) => `This token connects this computer to ${server} as @${login}.`,
  },
  // A6, by TEAM_SEATS: the seat the server names, and what a free seat means for the reviews that you put there.
  seat: {
    paid: (team) => `You have a paid seat in the team ${team} there.`,
    free: (team) => `You have a free seat in the team ${team} there. Only you can read your reviews there, and your `
      + 'teammates cannot.',
    none: 'You are in no team there yet. The server refuses your reviews until you join a team.',
    notRead: 'Sonah could not read your team and seat from the server.',
  },
  replacing: (server, login) => `This computer has a connection to ${server} as @${login} now. A new connection `
    + 'replaces it, and Sonah then revokes its token.',
  ask: (server, login) => `Connect this computer to ${server} as @${login}? [Y/n] `,
  askReplace: (server, login) => `Replace that connection with ${server} as @${login}? [y/N] `,
  tokenPrompt: (server) => `Paste the upload token from ${server}/settings/tokens, then press Enter: `,
  connected: (server, login) => `Sonah connected this computer to ${server} as @${login}.`,
  kept: (file) => `Sonah keeps the token in ${file}, which only you can read.`,
  saidNo: 'Sonah did not connect this computer.',
  newRevoked: 'Sonah revoked the token that the code made.',
  newLive: (server) => `The token that the code made is still live. Revoke it at ${server}/settings/tokens.`,
  tokenStays: 'Your token is still live, and the connection of this computer stays as it was.',
  oldRevoked: 'Sonah revoked the token of the connection that this computer had before.',
  oldEnded: 'The token of the connection that this computer had before no longer works.',
  oldLive: (server) => 'The token of the connection that this computer had before is still live. Revoke it at '
    + `${server}/settings/tokens.`,
  disconnected: (server) => `Sonah revoked the token of this computer on ${server}, and deleted the connection.`,
  alreadyEnded: (server) => `${server} no longer takes the token of this computer, so Sonah only deleted the `
    + 'connection.',
  deletedLive: (server) => `Sonah deleted the connection, but it could not revoke the token on ${server}. The token is `
    + `still live. Revoke it at ${server}/settings/tokens.`,
  deletedUnreadable: (file) => `Sonah deleted ${file}, which it could not read as a connection, so it revoked no token. `
    + 'If that file held a token, revoke it on the tokens page of its server (/settings/tokens).',
  // D225: the push hook's offer (decision 3), and D143's commit link after it.
  hookCost: 'Sonah can review each push of this repository in the background. Each review counts toward your Claude '
    + 'Code plan.',
  askHook: (server) => `Review each push of this repository on your Claude Code login, and put it on ${server}? [Y/n] `,
  hookLater: 'Run sonah hook add --push in a repository to review each push from it.',
  askLink: 'Also end each commit of your Claude Code agent here with an Agent-Session line that names its session? '
    + '[Y/n] ',
  linkLater: 'Run sonah hook add to end each commit of your Claude Code agent here with an Agent-Session line.',
  status: {
    connected: (server, login) => `This computer has a connection to ${server} as @${login}.`,
    none: 'This computer has no connection to a Sonah Team server. Run sonah connect <code> to connect it.',
    unreadable: (file) => `Sonah cannot read ${file} as a connection. Run sonah disconnect to delete it, then `
      + 'connect again.',
    refused: (server) => `${server} no longer takes the token of this computer. Run sonah disconnect, then connect `
      + 'again with a new code.',
  },
});

/** The problems the commands name (ledger.js TEAM_PROBLEMS), each said on stderr, then its fix after "Fix:". */
export const TEAM_PROBLEM_WORDS = Object.freeze({
  team_no_terminal: 'Sonah asks before it keeps a connection, and this is not a terminal. Sonah sent nothing, so the '
    + 'code still works.',
  team_replace_no_terminal: (server, login) => `This computer has a connection to ${server} as @${login}, and Sonah `
    + 'asks before it replaces one. This is not a terminal, so Sonah changed nothing.',
  team_not_a_token: 'That is not an upload token. A token has 16 to 512 characters, with no space.',
  team_bad_code: (server) => `${server} does not know this code. A code works once, for 10 minutes.`,
  team_rate_limited: (server) => `${server} asks Sonah to wait a minute.`,
  team_too_many_tokens: (server) => `You have as many upload tokens on ${server} as it allows.`,
  team_bad_token: (server) => `${server} does not take this token. Someone revoked it, or it belongs to another `
    + 'server.',
  team_unreachable: (server) => `Sonah could not reach ${server}.`,
  team_redirect: (server) => `${server} answered with a redirect, and Sonah does not follow one.`,
  team_refused: (server, status, code) => `${server} answered with the status ${status}${code ? ` (${code})` : ''}.`,
  team_answer: (server) => `${server} gave an answer that Sonah cannot read.`,
  team_unwritable: (file) => `Sonah could not write ${file}, so it kept no connection.`,
  team_not_connected: 'This computer has no connection to a Sonah Team server. Sonah changed nothing.',
});
/** The fix of each problem that has one. */
export const TEAM_FIX_WORDS = Object.freeze({
  team_no_terminal: 'Run sonah connect <code> in a terminal, or pass a token on standard input with sonah connect '
    + '--token.',
  team_replace_no_terminal: 'Run sonah disconnect first, or run sonah connect in a terminal.',
  team_not_a_token: (server) => `Copy the whole token from ${server}/settings/tokens.`,
  team_bad_code: (server) => `Run sonah connect with a new code from ${server}.`,
  team_rate_limited: 'Wait one minute before you run the same command again.',
  team_too_many_tokens: (server) => `Open ${server}/settings/tokens and revoke a token that you no longer use.`,
  team_bad_token: (server) => `Make a new token at ${server}/settings/tokens, and pass it to sonah connect --token.`,
  team_unreachable: 'Check the address of the server and your network connection.',
  team_redirect: `Check that --server names the server itself, such as ${VISUAL_DEFAULT_SERVER}.`,
  team_refused: 'Check that --server names a Sonah Team server.',
  team_answer: 'Check that --server names a Sonah Team server.',
  team_unwritable: 'Check that you own your SONAH_HOME folder and can write to it.',
});

const usageError = (problem) => Object.assign(new Error('usage'), { code: 'usage', problem });
/** An option the person typed, as a usage error names it: its name before any `=`, at most 40 characters (a value is
 *  never echoed: it could be a token). */
const named = (arg) => {
  const name = arg.split('=')[0], shown40 = name.slice(0, 40);
  if (shown40.length === arg.length) return arg;
  return shown40.length < name.length ? `${shown40}...` : `${shown40}=...`;
};

/** `sonah connect`'s options, or a thrown usage error: `{ code, token, server, hook }`, hook true (--hook), false
 *  (--no-hook) or null (ask). No value the person gave is put in the error's words. */
export function parseConnectArgs(argv) {
  const options = { code: null, token: false, server: null, hook: null };
  const seen = new Set();
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--token') {
      if (seen.has(arg)) throw usageError('--token is given twice');
      seen.add(arg); options.token = true;
    } else if (arg === '--hook' || arg === '--no-hook') {
      if (seen.has(arg)) throw usageError(`${arg} is given twice`);
      if (options.hook !== null) throw usageError('give --hook or --no-hook, not both');
      seen.add(arg); options.hook = arg === '--hook';
    } else if (arg === '--server') {
      const value = argv[++i];
      if (seen.has(arg)) throw usageError('--server is given twice');
      if (!value || value.startsWith('-')) throw usageError('--server needs a value');
      seen.add(arg); options.server = value;
    } else if (arg.startsWith('-')) throw usageError(`unknown option ${named(arg)}`);
    else if (options.code !== null) throw usageError('more than one code is given');
    else options.code = arg;
  }
  if (options.token && options.code !== null)
    throw usageError('--token takes the token on standard input, never on the command line');
  if (!options.token && options.code === null) throw usageError('give the code that Sonah Team shows');
  if (!options.token && !CODE_SHAPE.test(options.code))
    throw usageError('a code has 4 to 40 letters, digits, spaces or hyphens');
  if (options.server !== null) {
    options.server = visualServer(options.server);
    if (options.server === null) throw usageError(`--server takes an https address, such as ${VISUAL_DEFAULT_SERVER}`);
  }
  return options;
}

/** One question in the terminal: true for yes. `yes` is the answer of an empty line; only y or yes is yes; Ctrl-C and
 *  Ctrl-D are no. */
export function askOnTerminal(question, { yes, input = process.stdin, output = process.stdout }) {
  return new Promise((resolve) => {
    const terminal = createInterface({ input, output });
    let settled = false;
    const finish = (answer) => {
      if (settled) return;
      settled = true; terminal.close(); resolve(answer);
    };
    terminal.once('close', () => finish(false));
    terminal.once('SIGINT', () => finish(false));
    terminal.question(question, (line) => {
      const said = line.trim().toLowerCase();
      finish(said === '' ? yes : said === 'y' || said === 'yes');
    });
  });
}

/** The token on standard input: in a terminal, typed or pasted with no echo after `prompt` (null after Ctrl-C);
 *  anywhere else, its first line that is not empty, of at most MAX_TOKEN_INPUT read. Trimmed. */
export function readTokenOnInput({ prompt, input = process.stdin, output = process.stderr }) {
  if (input.isTTY === true && typeof input.setRawMode === 'function') {
    return new Promise((resolve) => {
      let text = '';
      const finish = (value) => {
        input.removeListener('data', onData);
        input.setRawMode(false); input.pause();
        output.write('\n');
        resolve(value);
      };
      const onData = (chunk) => {
        for (const ch of String(chunk)) {
          if (ch === '\r' || ch === '\n' || ch === '\u0004') { finish(text.trim()); return; }
          if (ch === '\u0003') { finish(null); return; }
          if (ch === '\u007f' || ch === '\b') text = text.slice(0, -1);
          else if (text.length < MAX_TOKEN_INPUT) text += ch;
        }
      };
      output.write(prompt);
      input.setRawMode(true); input.setEncoding('utf8');
      input.on('data', onData); input.resume();
    });
  }
  return new Promise((resolve) => {
    let text = '', done = false;
    const finish = () => {
      if (done) return;
      done = true;
      input.removeListener('data', onData);
      input.destroy?.();
      resolve(text.split(/\r?\n/).map((line) => line.trim()).find(Boolean) ?? '');
    };
    const onData = (chunk) => {
      text += chunk;
      if (text.length >= MAX_TOKEN_INPUT || /\S[^\n]*\n/.test(text)) finish();
    };
    input.setEncoding?.('utf8');
    input.on('data', onData); input.once('end', finish); input.once('error', finish); input.once('close', finish);
  });
}

/** The line that says a problem (TEAM_PROBLEMS). */
function problemLine(code, args) {
  if (!TEAM_PROBLEMS.includes(code)) throw new Error('not a team problem');
  const says = TEAM_PROBLEM_WORDS[code];
  return typeof says === 'function' ? says(...args) : says;
}
/** A problem and its fix, as stderr gets them. */
function problemText(code, args, fixArgs = args) {
  const fix = TEAM_FIX_WORDS[code];
  if (fix === undefined) return `${problemLine(code, args)}\n`;
  return `${problemLine(code, args)}\nFix: ${typeof fix === 'function' ? fix(...fixArgs) : fix}\n`;
}
/** The problem of a failed call (team-api.js `teamProblemOf`) with the arguments its words take; an error that is not
 *  the server's is thrown on (Sonah failed). */
function callProblem(error, server) {
  const code = teamProblemOf(error);
  if (code === null) throw error;
  return { code, args: code === 'team_refused' ? [server, error.status, error.code] : [server] };
}
const callProblemText = (error, server) => {
  const { code, args } = callProblem(error, server);
  return problemText(code, args, [server]);
};
const callProblemLine = (error, server) => {
  const { code, args } = callProblem(error, server);
  return problemLine(code, args);
};
/** The line of the seat, from GET /api/token's answer (D225: `sonah hook add --push` says it too). */
export const seatLine = (who) => (who.team === null ? CONNECT_WORDS.seat.none
  : CONNECT_WORDS.seat[who.seat](shown(who.team)));
const usageFailure = (stderr, command, usage, error) => {
  if (error?.code !== 'usage') throw error;
  stderr.write(`sonah ${command}: ${error.problem}${error.problem.endsWith('...') ? '' : '.'}\nusage: ${usage}\n`);
  return 2;
};

/**
 * `sonah connect <code> [--server URL]` and `sonah connect --token [--server URL]`: the exit code. `interactive` is
 * whether Sonah may ask (isInteractive); `ask(question, { yes })` asks one question, `readToken({ prompt })` reads the
 * token, `hostname()` names this computer and `fetch` makes the calls, each injectable so a test needs no terminal and
 * reaches only its own server.
 */
export async function runConnectCommand(argv, { stdout = process.stdout, stderr = process.stderr, env = process.env,
  stdin = process.stdin, interactive = isInteractive({ stdin, stdout }), ask = null, readToken = null,
  hostname = osHostname, fetch = globalThis.fetch, cwd = process.cwd(), git = gitOut, push = {} } = {}) {
  let options;
  try { options = parseConnectArgs(argv); }
  catch (error) { return usageFailure(stderr, 'connect', CONNECT_USAGE, error); }
  const where = { env };
  const say = (line) => stdout.write(`${line}\n`);
  const question = ask ?? ((text, how) => askOnTerminal(text, { ...how, input: stdin, output: stdout }));
  const saved = await readConnection(where);
  const old = saved.state === 'ok' ? saved.connection : null;
  const server = options.server ?? old?.server ?? VISUAL_DEFAULT_SERVER;
  const file = connectionPath(where);

  // Ends the connection this one replaces (A5): its token is revoked on its own server, unless it is the same token.
  // D225: the push hook's tickets that another server or login left go with it.
  const endOld = async (token, login) => {
    if (old !== null && (old.server !== server || old.login !== login)) {
      await forgetTickets(where, { keep: { server, login }, end: CONNECTION_CHANGED });
      await forgetOtherConnection(where, { server, login });
    }
    if (old === null || old.token === token) return 0;
    try { await teamApi({ server: old.server, token: old.token, fetch }).revoke(); }
    catch (error) {
      const code = teamProblemOf(error);
      if (code === null) throw error;
      if (code === 'team_bad_token') { say(CONNECT_WORDS.oldEnded); return 0; }
      say(CONNECT_WORDS.oldLive(old.server));
      return 1;
    }
    say(CONNECT_WORDS.oldRevoked);
    return 0;
  };
  /** Asks whether to keep the connection to `server` as `login`: the replacing question (default no) when this
   *  computer has one to another server or login, else the connecting one (default yes). */
  const keepIt = async (login, { askAlways }) => {
    if (old !== null && (old.server !== server || old.login !== login)) {
      say(CONNECT_WORDS.replacing(old.server, old.login));
      return question(CONNECT_WORDS.askReplace(server, login), { yes: false });
    }
    return askAlways ? question(CONNECT_WORDS.ask(server, login), { yes: true }) : true;
  };
  /** D225: the push hook of the repository that holds `cwd`, once the connection is kept (decision 3), then D143's
   *  commit link when it is off: the exit code it adds (1 when a hook needs you). Nothing outside a git working tree,
   *  and nothing with --no-hook. The seat was said above, so the hook does not say it again. */
  const offer = async () => {
    if (options.hook === false) return 0;
    if ((await git(cwd, ['rev-parse', '--is-inside-work-tree']))?.trim() !== 'true') {
      if (options.hook !== true) return 0;
      say(HOOK_WORDS.problems.hook_not_git(cwd));
      return 1;
    }
    if (options.hook === null) {
      say('');
      say(CONNECT_WORDS.hookCost);
      if (!interactive || !await question(CONNECT_WORDS.askHook(server), { yes: true })) {
        say(CONNECT_WORDS.hookLater);
        return 0;
      }
    }
    const { runPushHookCommand } = await import('./push-hook.js');
    say('');
    const hooked = await runPushHookCommand('add', cwd, { stdout, stderr, git, env, fetch, seat: false, ...push });
    if (hooked === 2) return 1;
    const link = await commitLinkFacts(cwd, { git }).catch(() => null);
    if (link?.state !== 'off') return hooked;
    say('');
    if (!interactive) { say(CONNECT_WORDS.linkLater); return hooked; }
    say(HOOK_WORDS.publicLine);
    if (!await question(CONNECT_WORDS.askLink, { yes: true })) { say(CONNECT_WORDS.linkLater); return hooked; }
    try {
      const added = await addHook(cwd, { git });
      for (const line of added.lines.filter((l) => l !== HOOK_WORDS.publicLine)) say(line);
      return Math.max(hooked, added.outcome === 'add_line' ? 1 : 0);
    } catch (error) {
      if (!HOOK_PROBLEMS.includes(error?.code)) throw error;
      say(HOOK_WORDS.problems[error.code](error.file ?? cwd));
      return 1;
    }
  };

  if (options.token) {
    const token = await (readToken ?? ((how) => readTokenOnInput({ ...how, input: stdin, output: stderr })))(
      { prompt: CONNECT_WORDS.tokenPrompt(server) });
    if (token === null) return 130;
    if (!isToken(token)) { stderr.write(problemText('team_not_a_token', [], [server])); return 2; }
    let who;
    try { who = await teamApi({ server, token, fetch }).whoami(); }
    catch (error) { stderr.write(callProblemText(error, server)); return 2; }
    say(CONNECT_WORDS.whose.token(server, who.login));
    say(seatLine(who));
    if (old !== null && (old.server !== server || old.login !== who.login) && !interactive) {
      stderr.write(problemText('team_replace_no_terminal', [old.server, old.login]));
      return 2;
    }
    if (!await keepIt(who.login, { askAlways: false })) {
      say(CONNECT_WORDS.saidNo); say(CONNECT_WORDS.tokenStays);
      return 1;
    }
    try { await writeConnection({ server, token, login: who.login }, where); }
    catch { stderr.write(problemText('team_unwritable', [file])); return 2; }
    const ended = await endOld(token, who.login);
    say(CONNECT_WORDS.connected(server, who.login));
    say(CONNECT_WORDS.kept(file));
    return Math.max(ended, await offer());
  }

  // A code: Sonah asks before it keeps the token, so it sends nothing where it cannot ask.
  if (!interactive) { stderr.write(problemText('team_no_terminal', [])); return 2; }
  let made;
  try { made = await teamApi({ server, fetch }).exchange(options.code, tokenName(hostname())); }
  catch (error) { stderr.write(callProblemText(error, server)); return 2; }
  const madeApi = teamApi({ server, token: made.token, fetch });
  // The token the code made is live from here: it is kept, revoked, or said to be live, on every way out.
  let settled = false;
  const revokeMade = async () => {
    settled = true;
    try { await madeApi.revoke(); return true; } catch (error) {
      if (teamProblemOf(error) === null) throw error;
      return false;
    }
  };
  try {
    let who = null, whoFailed = null;
    try { who = await madeApi.whoami(); }
    catch (error) {
      whoFailed = error;
      if (teamProblemOf(error) === null) throw error;
    }
    // A server that refuses the token it has just made gives nothing to keep or to revoke.
    if (whoFailed !== null && teamProblemOf(whoFailed) === 'team_bad_token') {
      settled = true;
      stderr.write(problemText('team_answer', [server]));
      return 2;
    }
    // With GET /api/token not answered, the exchange's login names whose the token is; with neither, no one can tell.
    const login = who?.login ?? made.login;
    if (login === null) {
      const revoked = await revokeMade();
      stderr.write(whoFailed !== null ? callProblemText(whoFailed, server) : problemText('team_answer', [server]));
      stderr.write(`${revoked ? CONNECT_WORDS.newRevoked : CONNECT_WORDS.newLive(server)}\n`);
      return 2;
    }
    say(CONNECT_WORDS.whose.code(server, login));
    say(who ? seatLine(who) : CONNECT_WORDS.seat.notRead);
    if (!await keepIt(login, { askAlways: true })) {
      const revoked = await revokeMade();
      say(CONNECT_WORDS.saidNo);
      say(revoked ? CONNECT_WORDS.newRevoked : CONNECT_WORDS.newLive(server));
      return 1;
    }
    try { await writeConnection({ server, token: made.token, login }, where); }
    catch {
      const revoked = await revokeMade();
      stderr.write(problemText('team_unwritable', [file]));
      stderr.write(`${revoked ? CONNECT_WORDS.newRevoked : CONNECT_WORDS.newLive(server)}\n`);
      return 2;
    }
    settled = true;
    const ended = await endOld(made.token, login);
    say(CONNECT_WORDS.connected(server, login));
    say(CONNECT_WORDS.kept(file));
    return Math.max(ended, await offer());
  } finally {
    // Sonah failed before the token was kept or revoked: it is revoked, with no word, as Sonah exits 3.
    if (!settled) await madeApi.revoke().catch(() => {});
  }
}

/** `sonah disconnect`: the exit code. 0 the token is revoked (or the server no longer takes it) and the connection
 *  deleted; 1 the connection is deleted, and the token is still live or the file could not be read; 2 no connection. */
export async function runDisconnectCommand(argv, { stdout = process.stdout, stderr = process.stderr,
  env = process.env, fetch = globalThis.fetch } = {}) {
  if (argv.length) return usageFailure(stderr, 'disconnect', DISCONNECT_USAGE, usageError(argv[0].startsWith('-')
    ? `unknown option ${named(argv[0])}` : 'it takes no argument'));
  const where = { env };
  const say = (line) => stdout.write(`${line}\n`);
  // The connection first, so a push meanwhile keeps nothing; then every ticket, their runs ended.
  const forget = async () => {
    await forgetConnection(where);
    await forgetTickets(where, { end: CONNECTION_CHANGED });
  };
  const saved = await readConnection(where);
  if (saved.state === 'absent') { stderr.write(problemText('team_not_connected', [])); return 2; }
  if (saved.state === 'invalid') {
    await forget();
    say(CONNECT_WORDS.deletedUnreadable(connectionPath(where)));
    return 1;
  }
  const { server, token } = saved.connection;
  let failed = null;
  try { await teamApi({ server, token, fetch }).revoke(); }
  catch (error) {
    if (teamProblemOf(error) === null) throw error;
    failed = error;
  }
  await forget();
  if (failed === null) { say(CONNECT_WORDS.disconnected(server)); return 0; }
  if (teamProblemOf(failed) === 'team_bad_token') { say(CONNECT_WORDS.alreadyEnded(server)); return 0; }
  say(callProblemLine(failed, server));
  say(CONNECT_WORDS.deletedLive(server));
  return 1;
}

/** D227: `sonah status`'s options, or a thrown usage error: `{ json, all }`. */
export function parseStatusArgs(argv) {
  const options = { json: false, all: false };
  for (const arg of argv) {
    if (arg === '--json' || arg === '--all') {
      const key = arg.slice(2);
      if (options[key]) throw usageError(`${arg} is given twice`);
      options[key] = true;
    } else throw usageError(arg.startsWith('-') ? `unknown option ${named(arg)}` : 'it takes no argument');
  }
  return options;
}

/** D227: JSON for a terminal: what JSON.stringify leaves as it is and no one sees (C1 controls, format characters, line
 *  and paragraph separators) written as its \u escape, so the text parses back the same and shows nothing hidden. */
export const jsonText = (value) => JSON.stringify(value, null, 1).replace(/[\u0080-\u009f\p{Cf}\p{Zl}\p{Zp}]/gu,
  (ch) => Array.from({ length: ch.length }, (_, i) => `\\u${ch.charCodeAt(i).toString(16).padStart(4, '0')}`).join(''));

/** `sonah status [--json] [--all]`: the exit code. 0 it said the connection (or that there is none); 1 the connection
 *  file cannot be read, or the server no longer takes its token (D225: or a push hook needs you). The token is never
 *  printed. D227: then the reviews of pushes and the comments that wait, from files only; --json prints one object
 *  `{ v: 1, connection, hooks, runs, waiting }` instead of the lines, with the same exit code. D230: and the Claude
 *  Code start reminder, from Claude Code's settings (remind.js `remindReport`; `remind` in the JSON): a line only when
 *  it is not off, and the code 1 when its entry runs a node or a Sonah that is gone, or another install. */
export async function runStatusCommand(argv, { stdout = process.stdout, stderr = process.stderr, env = process.env,
  fetch = globalThis.fetch, git = gitOut } = {}) {
  let options;
  try { options = parseStatusArgs(argv); }
  catch (error) { return usageFailure(stderr, 'status', STATUS_USAGE, error); }
  const where = { env };
  const lines = [];
  const say = (line) => lines.push(line);
  const saved = await readConnection(where);
  const { code, json } = await connectionStatus(saved, { say, where, fetch });
  // D225: each repository with the push hook, from its files (push-hook.js); one that needs you makes the code 1.
  const { pushHookReport } = await import('./push-hook.js');
  const report = await pushHookReport({ env, git, connection: saved.state === 'ok' ? saved.connection : null });
  // D227: the reviews of pushes and the comments that wait, from files only (push-run.js).
  const { runsReport } = await import('./push-run.js');
  const runs = await runsReport({ where, connection: saved.state === 'ok' ? saved.connection : null,
    all: options.all });
  // D230: the Claude Code start reminder, from Claude Code's settings (remind.js).
  const { remindReport } = await import('./remind.js');
  const remind = await remindReport({ env });
  const exit = report?.attention || remind.attention ? 1 : code;
  if (options.json) {
    stdout.write(`${jsonText({ v: 1, connection: json, hooks: report?.repos ?? [], runs: runs.runs,
      waiting: runs.waiting, remind: remind.json })}\n`);
    return exit;
  }
  if (report !== null) lines.push('', ...report.lines);
  if (runs.lines.length) lines.push('', ...runs.lines);
  if (remind.lines.length) lines.push('', ...remind.lines);
  for (const line of lines) stdout.write(`${line}\n`);
  return exit;
}

/** `sonah status`'s lines of the connection, and its exit code; D227: and its JSON, `{ state, server, login, team,
 *  seat }`, `state` one of none, unreadable, ok, refused, not_read. D225: a token its server refuses (401) is marked,
 *  so the push hook starts nothing until this computer connects again. */
async function connectionStatus(saved, { say, where, fetch }) {
  const json = (state, extra = {}) => ({ state, server: null, login: null, team: null, seat: null, ...extra });
  if (saved.state === 'absent') { say(CONNECT_WORDS.status.none); return { code: 0, json: json('none') }; }
  if (saved.state === 'invalid') {
    say(CONNECT_WORDS.status.unreadable(connectionPath(where)));
    return { code: 1, json: json('unreadable') };
  }
  const { server, token, login } = saved.connection;
  let who;
  try { who = await teamApi({ server, token, fetch }).whoami(); }
  catch (error) {
    const problem = teamProblemOf(error);
    if (problem === null) throw error;
    say(CONNECT_WORDS.status.connected(server, login));
    if (problem === 'team_bad_token') {
      await markRefused(saved.connection, where).catch(() => {});
      say(CONNECT_WORDS.status.refused(server));
      return { code: 1, json: json('refused', { server, login }) };
    }
    say(callProblemLine(error, server));
    say(CONNECT_WORDS.seat.notRead);
    return { code: 0, json: json('not_read', { server, login }) };
  }
  say(CONNECT_WORDS.status.connected(server, who.login));
  say(seatLine(who));
  return { code: 0, json: json('ok', { server, login: who.login, team: who.team, seat: who.seat }) };
}

/** The kind of each of this file's word tables, for the style linter (packages/render/test/style-lint.js). */
export const STYLE_KINDS = Object.freeze({ CONNECT_WORDS: 'notice', TEAM_PROBLEM_WORDS: 'notice',
  TEAM_FIX_WORDS: 'action' });
const SERVER = 'https://pr.sonah.dev';
export const STYLE_FIXTURES = Object.freeze({
  'CONNECT_WORDS.whose.code': [[SERVER, 'octo']],
  'CONNECT_WORDS.whose.token': [[SERVER, 'octo']],
  'CONNECT_WORDS.seat.paid': [['Acme']],
  'CONNECT_WORDS.seat.free': [['Acme']],
  'CONNECT_WORDS.replacing': [[SERVER, 'octo']],
  'CONNECT_WORDS.ask': [[SERVER, 'octo']],
  'CONNECT_WORDS.askReplace': [[SERVER, 'octo']],
  'CONNECT_WORDS.askHook': [[SERVER]],
  'CONNECT_WORDS.tokenPrompt': [[SERVER]],
  'CONNECT_WORDS.connected': [[SERVER, 'octo']],
  'CONNECT_WORDS.kept': [['~/.sonah/team/connection.json']],
  'CONNECT_WORDS.newLive': [[SERVER]],
  'CONNECT_WORDS.oldLive': [[SERVER]],
  'CONNECT_WORDS.disconnected': [[SERVER]],
  'CONNECT_WORDS.alreadyEnded': [[SERVER]],
  'CONNECT_WORDS.deletedLive': [[SERVER]],
  'CONNECT_WORDS.deletedUnreadable': [['~/.sonah/team/connection.json']],
  'CONNECT_WORDS.status.connected': [[SERVER, 'octo']],
  'CONNECT_WORDS.status.unreadable': [['~/.sonah/team/connection.json']],
  'CONNECT_WORDS.status.refused': [[SERVER]],
  'TEAM_PROBLEM_WORDS.team_replace_no_terminal': [[SERVER, 'octo']],
  'TEAM_PROBLEM_WORDS.team_bad_code': [[SERVER]],
  'TEAM_PROBLEM_WORDS.team_rate_limited': [[SERVER]],
  'TEAM_PROBLEM_WORDS.team_too_many_tokens': [[SERVER]],
  'TEAM_PROBLEM_WORDS.team_bad_token': [[SERVER]],
  'TEAM_PROBLEM_WORDS.team_unreachable': [[SERVER]],
  'TEAM_PROBLEM_WORDS.team_redirect': [[SERVER]],
  'TEAM_PROBLEM_WORDS.team_refused': [[SERVER, 404, 'not_found'], [SERVER, 502, null]],
  'TEAM_PROBLEM_WORDS.team_answer': [[SERVER]],
  'TEAM_PROBLEM_WORDS.team_unwritable': [['~/.sonah/team/connection.json']],
  'TEAM_FIX_WORDS.team_not_a_token': [[SERVER]],
  'TEAM_FIX_WORDS.team_bad_code': [[SERVER]],
  'TEAM_FIX_WORDS.team_too_many_tokens': [[SERVER]],
  'TEAM_FIX_WORDS.team_bad_token': [[SERVER]],
});
