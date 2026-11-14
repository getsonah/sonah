// D230 (item 10, C7): `sonah remind on|off`, the Claude Code start reminder (sonah-hosted FIXLOOP.md "How the author is
// told", optional). Ported from the private laptop client's remind.mjs (sonah-hosted client/remind.mjs, its settings
// half) and its `remind` command (client/sonah-pr.mjs), with getsonah's exit codes and words.
//   `sonah remind on`   adds one SessionStart entry to Claude Code's user settings, settings.json in Claude Code's folder
//        ($CLAUDE_CONFIG_DIR, else ~/.claude; claude-home.js `claudeConfigDir`):
//        `{"matcher":"startup|resume","hooks":[{"type":"command","command":"'<node>' '<sonah.js>' remind-hook
//        # sonah:remind","timeout":10}]}`, the command led by `SONAH_HOME='<folder>'` when SONAH_HOME is set, so the
//        hook reads the connection this command sees. What it runs is remind-hook.js.
//   `sonah remind off`  removes it, and a group, the SessionStart list or the `hooks` object only when it is empty
//        because the entry went.
// Only Sonah's own entry is ever added, changed or removed: a hook whose command ends with `# sonah:remind`. A
// settings file that is not plain JSON of its shape (a comment, a trailing comma, a repeated key, `hooks` that is not
// an object) is left as it is, and `on` prints the entry to add. The file is written whole (a new file beside it, then
// a rename), through a link to the file it names, with the file's own mode, and only when no one changed it since
// Sonah read it. The private laptop client's own entry (`# sonah-pr:remind`) is never touched: `on` stops and says to
// turn it off first, so Claude Code never shows the comments twice. `sonah status` says whether the reminder is on,
// and whether the node and the Sonah its entry names are still there and still this install (`remindReport`).
//
// Exit codes, as every command's (bin/sonah.js): 0 done; 1 settings.json is not plain JSON (`on` prints the entry),
// Claude Code's folder is not there, or the private client's reminder is on; 2 a usage error, Windows, or a Sonah that
// runs from a folder made for one run; 3 Sonah failed.
//
// No work at import.
import { randomBytes } from 'node:crypto';
import { constants } from 'node:fs';
import { access, lstat, open, readFile, realpath, rename, rm, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { REMIND_CHECKS, REMIND_PROBLEMS, REMIND_STATES } from '../../evidence/src/ledger.js';
import { strictJson } from '../../slicer/src/strict-json.js';
import { claudeConfigDir } from './claude-home.js';
import { sonahHome } from './settings.js';

export const REMIND_USAGE = 'sonah remind on|off';
/** The end of the command of Sonah's entry, and of the private laptop client's. */
export const REMIND_MARK = 'sonah:remind';
export const PRIVATE_REMIND_MARK = 'sonah-pr:remind';
/** Claude Code's SessionStart sources the entry runs for, and how long Claude Code lets it run, in seconds. */
export const REMIND_MATCHER = 'startup|resume';
export const REMIND_TIMEOUT_S = 10;
/** The hidden command the entry runs. */
export const REMIND_HOOK_COMMAND = 'remind-hook';
const SONAH_CLI = fileURLToPath(new URL('../bin/sonah.js', import.meta.url));
const MAX_SETTINGS_BYTES = 16 * 1024 * 1024;
/** How often `on` and `off` read the file again when another process changed it while they wrote it. */
const WRITE_TRIES = 3;
const [OFF, ON, PRIVATE_CLIENT, NOT_CHECKED] = REMIND_STATES;
const [NODE_GONE, SONAH_GONE, OTHER_INSTALL, OTHER_HOME] = REMIND_CHECKS;
const plainObject = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);

/** A path or a value as one shell word, and back (null for anything else). */
const shellQuoted = (text) => `'${String(text).replaceAll('\'', '\'\\\'\'')}'`;
const SHELL_WORD = String.raw`'(?:[^']|'\\'')*'`;
const unquoted = (word) => word.slice(1, -1).replaceAll('\'\\\'\'', '\'');

/** Claude Code's user settings file, as Claude Code finds it. */
export const settingsFile = (env = process.env) => join(claudeConfigDir({ env, home: env.HOME || homedir() }),
  'settings.json');

/** The command of Sonah's entry for this install: `{ node, cli, home }` (home: SONAH_HOME, or null). */
export const remindCommand = ({ node, cli, home = null }) => `${home === null ? '' : `SONAH_HOME=${shellQuoted(home)} `}`
  + `${shellQuoted(node)} ${shellQuoted(cli)} ${REMIND_HOOK_COMMAND} # ${REMIND_MARK}`;
/** The install an entry's command names, `{ node, cli, home }`, when it is exactly one `remindCommand` writes; else
 *  null. */
export function parseRemindCommand(command) {
  const m = new RegExp(`^(?:SONAH_HOME=(${SHELL_WORD}) )?(${SHELL_WORD}) (${SHELL_WORD}) ${REMIND_HOOK_COMMAND} `
    + `# ${REMIND_MARK}$`).exec(String(command));
  return m ? { node: unquoted(m[2]), cli: unquoted(m[3]), home: m[1] === undefined ? null : unquoted(m[1]) } : null;
}
/** Sonah's SessionStart group for a command. */
export const remindEntry = (command) => ({ matcher: REMIND_MATCHER,
  hooks: [{ type: 'command', command, timeout: REMIND_TIMEOUT_S }] });
const endsWithMark = (mark) => (hook) => plainObject(hook) && typeof hook.command === 'string'
  && hook.command.trimEnd().endsWith(`# ${mark}`);
const isOurs = endsWithMark(REMIND_MARK);
const isPrivateClients = endsWithMark(PRIVATE_REMIND_MARK);
/** The hooks of the SessionStart groups that `pick` takes, in order. */
const hooksOf = (json, pick) => (json.hooks?.SessionStart ?? [])
  .filter((group) => plainObject(group) && Array.isArray(group.hooks)).flatMap((group) => group.hooks.filter(pick));

/** The words of the command and of `sonah status`. A path is shown as it is. */
export const REMIND_WORDS = Object.freeze({
  added: (file) => `Sonah added its SessionStart entry to ${file}. When Claude Code starts in a repository where `
    + 'comments of your team wait for you, it shows them to you.',
  updated: (file) => `Sonah updated its SessionStart entry in ${file} to run this install of Sonah.`,
  present: (file) => `Sonah's SessionStart entry is already in ${file}.`,
  // What the reminder reads and sends, said after each `on` (the plan's A4).
  about: 'The reminder reads the comments that Sonah keeps on this computer. It gives them to Claude Code as a '
    + 'message for you, not as context for the agent. Then, at most once a minute for each repository, it asks your '
    + 'Sonah Team server for its list again.',
  stopIt: 'Run sonah remind off to stop it.',
  notConnected: 'This computer has no connection to Sonah Team yet, so the reminder shows nothing. Run sonah connect '
    + '<code> first.',
  removed: (file) => `Sonah removed its SessionStart entry from ${file}.`,
  none: (file) => `Sonah's SessionStart entry is not in ${file}. Sonah changed nothing.`,
  notPlain: (file) => `${file} is not plain JSON, so Sonah leaves it as it is.`,
  addEntry: 'Add this to its "hooks", in its "SessionStart" list:',
  removeEntry: `Remove the SessionStart hook whose command ends with "# ${REMIND_MARK}" from it.`,
  noFolder: (dir) => `Claude Code's folder ${dir} is not there. Start Claude Code once, then run sonah remind on `
    + 'again.',
  privateClient: (file) => `${file} has the reminder of sonah-pr, an earlier client of Sonah Team. Sonah changed `
    + 'nothing. Run sonah-pr remind off first, then run sonah remind on again.',
  problems: {
    remind_windows: 'Sonah turns the reminder on only on macOS and Linux. Sonah changed nothing.',
    remind_temporary_install: (path) => `This Sonah runs from ${path}, in a folder that npx, pnpm dlx, bunx or yarn `
      + 'dlx made for one run. An entry that names it stops once that folder goes. Sonah changed nothing. Install '
      + 'Sonah with npm install -g getsonah, and run its sonah remind on.',
  },
  // `sonah status`, when the reminder is not off.
  report: {
    on: (file) => `Claude Code start reminder: on (${file}).`,
    privateClient: (file) => `Claude Code start reminder: sonah-pr's, an earlier client of Sonah Team (${file}).`,
    notChecked: (file) => `Claude Code start reminder: not checked. ${file} is not plain JSON.`,
    nodeGone: (path) => `The node that the reminder runs is no longer at ${path}.`,
    sonahGone: (path) => `The Sonah that the reminder runs is no longer at ${path}.`,
    otherInstall: (path) => `The reminder runs the Sonah at ${path}, and not this install of Sonah.`,
    // D230 review 1: the entry names another Sonah folder, so it reads another connection and its comments.
    otherHome: (theirs, mine) => `The reminder reads the Sonah folder ${theirs}, and this command reads ${mine}.`,
    refresh: 'Fix: run sonah remind on again, or sonah remind off.',
  },
});

const failure = (code, file) => Object.assign(new Error(code), { code, file });

/** The settings: `{ state: 'absent' }`, `{ state: 'unreadable' }` (not a regular file, too large, not plain JSON of its
 *  shape, or a link to nothing, which a write would replace with a file), or `{ state: 'ok', text, json, mode }`. A
 *  link is followed to the file it names. */
async function readSettings(file) {
  let info;
  try { info = await stat(file); }
  catch (error) {
    if (error?.code !== 'ENOENT') return { state: 'unreadable' };
    return (await lstat(file).then(() => true, () => false)) ? { state: 'unreadable' } : { state: 'absent' };
  }
  if (!info.isFile() || info.size > MAX_SETTINGS_BYTES) return { state: 'unreadable' };
  let text;
  try { text = await readFile(file, 'utf8'); } catch { return { state: 'unreadable' }; }
  const parsed = strictJson(text);
  const json = parsed.json && parsed.strict ? parsed.value : null;
  if (!plainObject(json) || (json.hooks !== undefined && !plainObject(json.hooks))
    || (json.hooks?.SessionStart !== undefined && !Array.isArray(json.hooks.SessionStart)))
    return { state: 'unreadable', text };
  return { state: 'ok', text, json, mode: info.mode & 0o777 };
}

/** Writes `json` whole over `file` (through a link, to the file it names) with `mode`: a new file beside it, then a
 *  rename, and only while the file still holds `before` (null: still absent). Whether it wrote. */
async function writeSettings(file, json, mode, before) {
  const target = await realpath(file).catch(() => file);
  const temporary = join(dirname(target), `.${basename(target)}.sonah.${process.pid}.${randomBytes(4).toString('hex')}`);
  let handle;
  try {
    handle = await open(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL
      | (constants.O_NOFOLLOW ?? 0), mode);
    await handle.writeFile(`${JSON.stringify(json, null, 2)}\n`, 'utf8');
    await handle.chmod(mode);
    // D230 review 1: on the disk before the rename, so a crash right after it never leaves the person's settings empty.
    await handle.sync();
    await handle.close(); handle = null;
    const now = await readFile(target, 'utf8').catch((error) => (error?.code === 'ENOENT' ? null : undefined));
    if (now !== before) { await rm(temporary, { force: true }); return false; }
    await rename(temporary, target);
    return true;
  } catch (error) {
    await handle?.close().catch(() => {});
    await rm(temporary, { force: true }).catch(() => {});
    throw error;
  }
}

/** Reads the settings, makes `change(json)`'s change and writes it whole, again from the start when another process
 *  changed the file meanwhile: the read state when there was nothing to write, else `written`. */
async function changeSettings(file, change, { absent = null } = {}) {
  for (let i = 0; i < WRITE_TRIES; i++) {
    const read = await readSettings(file);
    if (read.state === 'unreadable' || (read.state === 'absent' && absent === null)) return read;
    const json = read.state === 'ok' ? read.json : absent();
    const outcome = change(json);
    if (outcome.write === false) return { ...read, ...outcome };
    if (await writeSettings(file, json, read.state === 'ok' ? read.mode : 0o644, read.state === 'ok' ? read.text : null))
      return { state: 'written', ...outcome };
  }
  throw new Error(`${file} changed each time Sonah wrote it`);
}

/** `sonah remind on`'s change: `{ status, file, entry }`, status one of added, updated, present, unreadable,
 *  no_folder, private_client. `install` is `{ node, cli, home }`. */
export async function remindOn({ env = process.env, install }) {
  const file = settingsFile(env);
  const command = remindCommand(install);
  const entry = remindEntry(command);
  try { await access(dirname(file)); if (!(await stat(dirname(file))).isDirectory()) throw new Error('not a folder'); }
  catch { return { status: 'no_folder', file, entry }; }
  const done = await changeSettings(file, (json) => {
    if (hooksOf(json, isPrivateClients).length) return { write: false, status: 'private_client' };
    const mine = hooksOf(json, isOurs);
    if (mine.length && mine.every((hook) => hook.command === command)) return { write: false, status: 'present' };
    if (mine.length) for (const hook of mine) hook.command = command; // node or Sonah moved
    else {
      json.hooks ??= {};
      json.hooks.SessionStart ??= [];
      json.hooks.SessionStart.push(entry);
    }
    return { status: mine.length ? 'updated' : 'added' };
  }, { absent: () => ({}) });
  return { status: done.state === 'unreadable' ? 'unreadable' : done.status, file, entry };
}

/** `sonah remind off`'s change: `{ status, file }`, status one of removed, none, unreadable. Only Sonah's own hooks go,
 *  and a group, the list or the hooks object only when it is empty because they went. */
export async function remindOff({ env = process.env } = {}) {
  const file = settingsFile(env);
  const done = await changeSettings(file, (json) => {
    if (!hooksOf(json, isOurs).length) return { write: false, status: 'none' };
    const groups = json.hooks.SessionStart.flatMap((group) => {
      if (!plainObject(group) || !Array.isArray(group.hooks) || !group.hooks.some(isOurs)) return [group];
      const rest = group.hooks.filter((hook) => !isOurs(hook));
      return rest.length ? [{ ...group, hooks: rest }] : [];
    });
    if (groups.length) json.hooks.SessionStart = groups; else delete json.hooks.SessionStart;
    if (!Object.keys(json.hooks).length) delete json.hooks;
    return { status: 'removed' };
  });
  if (done.state === 'absent') return { status: 'none', file };
  return { status: done.state === 'unreadable' ? 'unreadable' : done.status, file };
}

const executable = (path) => access(path, constants.X_OK).then(() => true, () => false);
const regularFile = (path) => stat(path).then((s) => s.isFile(), () => false);

/**
 * The reminder, for `sonah status`, from Claude Code's settings alone (nothing runs, nothing is sent): `{ lines,
 * attention, json: { state, file, checks } }`, state of REMIND_STATES and checks of REMIND_CHECKS. Off says nothing,
 * and so does a settings file that is not plain JSON and does not hold Sonah's mark: the reminder is a choice, and most
 * people never make it. D230 review 1: an entry that names another Sonah folder than this command's (its SONAH_HOME) is
 * `other_home`, since it shows another connection's comments at every start. D230 review 2: only an entry that names
 * one: an entry with none reads the SONAH_HOME that Claude Code itself runs with, which no command can see.
 */
export async function remindReport({ env = process.env, cliPath = SONAH_CLI } = {}) {
  const file = settingsFile(env);
  const s = REMIND_WORDS.report;
  const quiet = (state) => ({ lines: [], attention: false, json: { state, file, checks: [] } });
  const read = await readSettings(file);
  if (read.state === 'absent') return quiet(OFF);
  if (read.state === 'unreadable') {
    if (!read.text?.includes(REMIND_MARK)) return quiet(NOT_CHECKED);
    return { lines: [s.notChecked(file)], attention: false, json: { state: NOT_CHECKED, file, checks: [] } };
  }
  const mine = hooksOf(read.json, isOurs);
  if (!mine.length) {
    if (!hooksOf(read.json, isPrivateClients).length) return quiet(OFF);
    return { lines: [s.privateClient(file)], attention: false, json: { state: PRIVATE_CLIENT, file, checks: [] } };
  }
  const lines = [s.on(file)], checks = [];
  const me = await realpath(cliPath).catch(() => cliPath);
  const here = resolve(sonahHome({ env }));
  for (const install of [...new Set(mine.map((hook) => hook.command))].map(parseRemindCommand)) {
    if (install === null) { if (!checks.includes(OTHER_INSTALL)) checks.push(OTHER_INSTALL); continue; }
    if (!(await executable(install.node))) { lines.push(s.nodeGone(install.node)); checks.push(NODE_GONE); }
    if (!(await regularFile(install.cli))) { lines.push(s.sonahGone(install.cli)); checks.push(SONAH_GONE); }
    else if (await realpath(install.cli).catch(() => null) !== me) {
      lines.push(s.otherInstall(install.cli)); checks.push(OTHER_INSTALL);
    }
    // An entry with no SONAH_HOME reads the one Claude Code runs with (review 2), so only a named folder is compared.
    if (install.home !== null && resolve(install.home) !== here) {
      lines.push(s.otherHome(resolve(install.home), here)); checks.push(OTHER_HOME);
    }
  }
  if (checks.length) lines.push(s.refresh);
  return { lines: [lines[0], ...lines.slice(1).map((line) => `  ${line}`)], attention: checks.length > 0,
    json: { state: ON, file, checks: [...new Set(checks)] } };
}

/** `sonah remind on|off`: the exit code. `install` gives the node and Sonah the entry runs (by default this process's
 *  node, by a path on PATH that leads to it, and this install's entry); `connected` says whether this computer has a
 *  connection (read from team/connection.json by default). */
export async function runRemindCommand(argv, { stdout = process.stdout, stderr = process.stderr, env = process.env,
  platform = process.platform, cliPath = SONAH_CLI, execPath = process.execPath } = {}) {
  const [action, ...rest] = argv;
  if (!['on', 'off'].includes(action) || rest.length) {
    stderr.write(`usage: ${REMIND_USAGE}\n`);
    return 2;
  }
  const say = (lines) => stdout.write(`${[].concat(lines).join('\n')}\n`);
  if (action === 'off') {
    const r = await remindOff({ env });
    if (r.status === 'removed') say(REMIND_WORDS.removed(r.file));
    else if (r.status === 'none') say(REMIND_WORDS.none(r.file));
    else say([REMIND_WORDS.notPlain(r.file), REMIND_WORDS.removeEntry]);
    return r.status === 'unreadable' ? 1 : 0;
  }
  try {
    if (platform === 'win32') throw failure('remind_windows');
    const { stableNode, temporaryInstall } = await import('./push-hook.js');
    const cli = await realpath(cliPath);
    if (temporaryInstall(cli)) throw failure('remind_temporary_install', cli);
    // As the push script names it (push-hook.js): absolute, since Claude Code runs the entry in another folder.
    const home = typeof env.SONAH_HOME === 'string' && env.SONAH_HOME !== '' ? resolve(env.SONAH_HOME) : null;
    const r = await remindOn({ env, install: { node: await stableNode(env, execPath), cli, home } });
    if (r.status === 'no_folder') { say(REMIND_WORDS.noFolder(dirname(r.file))); return 1; }
    if (r.status === 'private_client') { say(REMIND_WORDS.privateClient(r.file)); return 1; }
    if (r.status === 'unreadable') {
      say([REMIND_WORDS.notPlain(r.file), REMIND_WORDS.addEntry, JSON.stringify(r.entry, null, 2)]);
      return 1;
    }
    const { readConnection } = await import('./team-home.js');
    const connected = (await readConnection({ env })).state === 'ok';
    say([r.status === 'added' ? REMIND_WORDS.added(r.file) : r.status === 'updated' ? REMIND_WORDS.updated(r.file)
      : REMIND_WORDS.present(r.file), REMIND_WORDS.about, ...(connected ? [] : [REMIND_WORDS.notConnected]),
    REMIND_WORDS.stopIt]);
    return 0;
  } catch (e) {
    if (!REMIND_PROBLEMS.includes(e?.code)) throw e;
    const says = REMIND_WORDS.problems[e.code];
    stderr.write(`${typeof says === 'function' ? says(e.file) : says}\n`);
    return 2;
  }
}

/** The kind of each of this file's word tables, for the style linter (packages/render/test/style-lint.js). */
export const STYLE_KINDS = Object.freeze({ REMIND_WORDS: 'notice', 'REMIND_WORDS.addEntry': 'heading' });
const FILE = '/tmp/sonah/cc-home/settings.json';
export const STYLE_FIXTURES = Object.freeze({
  'REMIND_WORDS.added': [[FILE]],
  'REMIND_WORDS.updated': [[FILE]],
  'REMIND_WORDS.present': [[FILE]],
  'REMIND_WORDS.removed': [[FILE]],
  'REMIND_WORDS.none': [[FILE]],
  'REMIND_WORDS.notPlain': [[FILE]],
  'REMIND_WORDS.noFolder': [['/tmp/sonah/cc-home']],
  'REMIND_WORDS.privateClient': [[FILE]],
  'REMIND_WORDS.problems.remind_temporary_install': [['/tmp/sonah/_npx/1/sonah.js']],
  'REMIND_WORDS.report.on': [[FILE]],
  'REMIND_WORDS.report.privateClient': [[FILE]],
  'REMIND_WORDS.report.notChecked': [[FILE]],
  'REMIND_WORDS.report.nodeGone': [['/tmp/sonah/node']],
  'REMIND_WORDS.report.sonahGone': [['/tmp/sonah/sonah.js']],
  'REMIND_WORDS.report.otherInstall': [['/tmp/sonah/sonah.js']],
  'REMIND_WORDS.report.otherHome': [['/tmp/sonah/work-home', '/tmp/sonah/home/.sonah']],
});
