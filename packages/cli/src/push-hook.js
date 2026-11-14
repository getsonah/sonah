// D225 (item 10, C3): the push hook. `sonah hook add --push` turns on, in one repository, a git pre-push hook that leaves
// each pushed branch for Sonah to review in the background, on the person's own Claude Code login, and to put on the
// Sonah Team server this computer is connected to (`sonah connect`). Ported from the private laptop client's hook.mjs
// (sonah-hosted client/hook.mjs), with D143's rules for where a hook goes (agent-session-hook.js) in place of its own.
//
// Two rules hold over everything here, as in D143: Sonah never stops, slows or fails a push, and never changes a file
// of another tool. Where each part lives (worktrees share the hooks folder and the git common dir):
//   <git common dir>/sonah/pre-push.sh  `pushScriptText`: POSIX sh that a hook sources. It reads the refs that git
//                                       pushes, hands them to `sonah pre-push` (this install's node and sonah.js, by
//                                       their paths, with SONAH_HOME when it was set and claude's folder first on
//                                       PATH, since a git app started from the dock has a short PATH), and gives them
//                                       back on standard input to the rest of the hook. Written whole on every
//                                       `add --push`, so it names the install that ran last. It names the getsonah
//                                       version that wrote it.
//   <hooks folder>/pre-push             PUSH_HOOK_RUNNER: written only when no hook file is there, core.hooksPath is not
//                                       set, and no link lies on the way (D143's rule; the private client wrote into
//                                       core.hooksPath, the plan's decision 1 reverses it). Otherwise Sonah prints the
//                                       one line to add (husky, lefthook with use_stdin, pre-commit, a hook of another
//                                       tool). The line sources the script, so the refs reach the rest of that hook.
//   team/hooks.json                     the repository and the server its hook is for (team-home.js).
// `sonah hook remove --push` deletes only Sonah's own bytes (the runner, also where a hook manager moved it, and a script
// that is exactly one that Sonah writes), takes the repository off the list and drops its tickets (D227 review: their
// runs end `skipped`, `hook_removed`; D227 review 1: so do the repository's reviews that wait to be sent, and the
// runner ends a ticket it took as soon as it reads the list again, push-run.js). `sonah status` and `sonah doctor`
// report each listed repository from its files (`pushHookReport`): whether git runs the hook, and whether the node and
// the Sonah it names are still there and still this install.
//
// No work at import.
import { constants } from 'node:fs';
import { access, chmod, lstat, mkdir, readFile, readdir, realpath, rename, rm, rmdir, writeFile } from 'node:fs/promises';
import { delimiter, dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { HOOK_PROBLEMS, PUSH_HOOK_PROBLEMS, PUSH_HOOK_ROUTES, PUSH_HOOK_STATES } from '../../evidence/src/ledger.js';
import { HOOK_WORDS, HOOKS_FOLDER_NOTE, HOOKS_FOLDER_NOTE_TEXT, LEFTHOOK_FILES, MOVED_SUFFIXES, PRE_COMMIT_HOOK_ID,
  SCRIPT_FOLDER, linkFreeUnder } from './agent-session-hook.js';
import { CONNECT_WORDS, seatLine } from './connect-command.js';
import { PUSH_BRANCHES_MAX, forgetTickets, waitingTickets } from './push-queue.js';
import { teamApi, teamProblemOf } from './team-api.js';
import { commonDirOf, gitOut, worktreesOf } from './team-git.js';
import { endPendingUploads, hooksPath, markRefused, readConnection, readHooks, updateHooks } from './team-home.js';
import { VISUAL_DEFAULT_SERVER } from './visual-command.js';

/** The closed states and routes (evidence ledger.js), by name. */
const [OFF, ON, MOVED, NOT_RUN, NOT_CHECKED] = PUSH_HOOK_STATES;
const [RUNNER, PRE_COMMIT] = PUSH_HOOK_ROUTES;

/** The git hook that runs before a push sends anything, with the remote's name and URL as its arguments and a line for
 *  each ref on standard input. */
export const PUSH_HOOK_EVENT = 'pre-push';
/** The push script's name in Sonah's folder of the git common dir. */
export const PUSH_SCRIPT_NAME = 'pre-push.sh';
/** This install's entry: the path the push script names (its real path, at `add --push`). */
export const SONAH_CLI = fileURLToPath(new URL('../bin/sonah.js', import.meta.url));
const PACKAGE_JSON = new URL('../../../package.json', import.meta.url);
/** The private laptop client's mark in the hook it wrote (sonah-hosted client/hook.mjs), and the file its line sources. */
export const PRIVATE_CLIENT_MARK = 'sonah-pr:pre-push';
const PRIVATE_CLIENT_SCRIPT = '/.sonah/hosted/pre-push.sh';

/** The one shell line that sources Sonah's push script, for the runner and for a hook that another tool owns. It
 *  sources the script only when it is there and is shell (`sh -n`), so no damaged file, `set -eu` or missing Sonah can
 *  fail a push; it holds no single quote, so it goes unchanged into a YAML or TOML single-quoted string. */
export const PUSH_HOOK_LINE = `sonah_push="$(git rev-parse --git-common-dir 2>/dev/null || :)/${SCRIPT_FOLDER}/`
  + `${PUSH_SCRIPT_NAME}"; if [ -f "$sonah_push" ] && sh -n "$sonah_push" 2>/dev/null; then . "$sonah_push"; fi`;
/** The hook file Sonah writes when the hooks folder has none. */
export const PUSH_HOOK_RUNNER = `#!/bin/sh
# sonah push hook, version 1: sources the script that sonah hook add --push wrote. sonah hook remove --push deletes this
# file.
${PUSH_HOOK_LINE}
exit 0
`;
/** The same line as lefthook runs a command (with `use_stdin: true`, so the refs reach it): lefthook runs it with no
 *  arguments, so it sets the hook's two, as lefthook puts them in place of {1} and {2}. */
export const LEFTHOOK_PUSH_RUN = `set -- "{1}" "{2}"; ${PUSH_HOOK_LINE}`;
export const LEFTHOOK_PUSH_COMMAND = 'sonah-push';
/** The commands that hand Sonah's hook to pre-commit, which then keeps it as `.legacy` and runs it with the refs. */
export const PRE_COMMIT_PUSH_STEPS = `pre-commit uninstall -t ${PUSH_HOOK_EVENT}\nsonah hook add --push\n`
  + `pre-commit install -t ${PUSH_HOOK_EVENT}`;
/** lefthook's call of its runner for this event, in the hook file it writes. */
export const LEFTHOOK_PUSH_CALL = `call_lefthook run "${PUSH_HOOK_EVENT}"`;
/** Every version of the runner that Sonah wrote: `remove --push` deletes, and the report knows, only these bytes. */
export const KNOWN_PUSH_RUNNERS = Object.freeze([PUSH_HOOK_RUNNER]);
/** husky's hooks folder: core.hooksPath ends with it, and the hook that a person edits is beside it. */
const HUSKY_RUNNERS = '.husky/_';
/** The pre-push hook that husky 9's install writes in that folder, as husky 9.1 writes it (read from husky 9.1.7's
 *  index.js): its `h` runs `.husky/pre-push` with the hook's arguments and standard input, and nothing when that file
 *  is not there. Sonah knows only these bytes (one newline after them is taken too). */
export const HUSKY_PUSH_STUBS = Object.freeze(['#!/usr/bin/env sh\n. "$(dirname "$0")/h"']);

/** A path or a value as one shell word. */
const shellQuoted = (text) => `'${String(text).replaceAll('\'', '\'\\\'\'')}'`;
/** The value of one shell word of `shellQuoted`'s form, or null. */
function unquoted(word) {
  if (!/^'(?:[^']|'\\'')*'$/.test(word)) return null;
  return word.slice(1, -1).replaceAll('\'\\\'\'', '\'');
}
const VERSION_SHAPE = /^[0-9A-Za-z.+-]{1,64}$/;

/**
 * The push script, version 1, for this install: `{ version, node, cli, home, claudeDir }` (home: SONAH_HOME at
 * `add --push`, or null; claudeDir: the folder of the claude found on PATH then, or null). Its rules (each pinned by
 * d225-push-hook.test.js): it reads the refs to their end, hands them on with the hook's two arguments, gives them back
 * on standard input, and never fails; Sonah's process writes nothing on standard output, and its lines go to standard
 * error, where git shows them; when node or Sonah is gone, it says so in one line.
 */
export function pushScriptText({ version, node, cli, home = null, claudeDir = null }) {
  const env = `${home === null ? '' : `SONAH_HOME=${shellQuoted(home)} `}${claudeDir === null ? ''
    : `PATH=${shellQuoted(claudeDir)}:"$PATH" `}`;
  return `# sonah push hook, version 1. sonah hook add --push wrote this file, and sonah hook remove --push deletes it.
# getsonah ${version}
# A pre-push hook sources this file. It hands the refs that git pushes to Sonah, which keeps each pushed branch for its
# review in the background, and gives the refs back on standard input to the rest of the hook. It never stops a push.
sonah_node=${shellQuoted(node)}
sonah_cli=${shellQuoted(cli)}
sonah_refs=$(cat)
if [ -z "$sonah_refs" ]; then
  :
elif [ -x "$sonah_node" ] && [ -f "$sonah_cli" ]; then
  printf '%s\\n' "$sonah_refs" | ${env}"$sonah_node" "$sonah_cli" pre-push "$@" >/dev/null || :
else
  printf '%s\\n' ${shellQuoted(`sonah: ${PUSH_HOOK_WORDS.scriptMoved}`)} >&2
fi
if [ -n "$sonah_refs" ]; then
exec 0<<SONAH_PUSH_REFS
$sonah_refs
SONAH_PUSH_REFS
else
exec 0</dev/null
fi
unset sonah_node sonah_cli sonah_refs sonah_push
`;
}

/** The install a push script names, `{ version, node, cli, home, claudeDir }`, when the text is exactly one that
 *  `pushScriptText` writes; else null. */
export function parsePushScript(text) {
  if (typeof text !== 'string') return null;
  const line = (pattern) => pattern.exec(text)?.[1] ?? null;
  const version = line(/^# getsonah (\S+)$/m);
  const node = unquoted(line(/^sonah_node=(.+)$/m) ?? '');
  const cli = unquoted(line(/^sonah_cli=(.+)$/m) ?? '');
  const run = line(/^ {2}printf '%s\\n' "\$sonah_refs" \| (.*)"\$sonah_node" /m);
  if (version === null || node === null || cli === null || run === null) return null;
  const homeWord = /^SONAH_HOME=('(?:[^']|'\\'')*') /.exec(run)?.[1] ?? null;
  const pathWord = /PATH=('(?:[^']|'\\'')*'):"\$PATH" $/.exec(run)?.[1] ?? null;
  const values = { version, node, cli, home: homeWord === null ? null : unquoted(homeWord),
    claudeDir: pathWord === null ? null : unquoted(pathWord) };
  return pushScriptText(values) === text ? values : null;
}

/** The words of `sonah hook add --push`, `remove --push`, the push script, and the push hook's lines in `sonah status`
 *  and `sonah doctor`. */
export const PUSH_HOOK_WORDS = Object.freeze({
  turnedOn: (file) => `Sonah wrote ${file}. Git runs it at each push from this repository and from its worktrees.`,
  alreadyOn: 'Sonah\'s push hook is already on in this repository.',
  scriptWritten: (file) => `Sonah wrote ${file}, which names this install of Sonah.`,
  notOnForeign: (file) => `Sonah did not turn the push hook on: ${file} is another hook, and Sonah does not change it.`,
  notOnPreCommit: (file) => `Sonah did not turn the push hook on: pre-commit wrote ${file}, and Sonah does not change `
    + 'it.',
  notOnHooksPath: (dir) => `Sonah did not turn the push hook on: core.hooksPath sends git to ${dir}, and Sonah does not `
    + 'write there.',
  notOnLink: (dir) => `Sonah did not turn the push hook on: ${dir} is a link, and Sonah does not write through a link.`,
  notOnNotExecutable: (file) => `Sonah did not turn the push hook on: ${file} is Sonah's hook, but it is not `
    + 'executable. It lies outside the git folder, so Sonah does not change it.',
  madeExecutable: (file) => `Sonah made its hook ${file} executable, so it runs at each push again.`,
  addLine: (file) => `Add this line to ${file}, at its top, before anything in it reads standard input:`,
  addLefthook: (file) => `Add these lines to ${file}:`,
  mergeLefthook: (file) => `Add these lines to ${file}, under the commands of its pre-push:`,
  lefthookAhead: (file) => `This repository has a lefthook file, ${file}. A later lefthook install moves Sonah's hook `
    + 'aside, where nothing runs it. To keep the push hook, add Sonah\'s command to that file now.',
  preCommitSteps: (dir) => `Run these commands in ${dir}. pre-commit then keeps Sonah's hook as pre-push.legacy, and `
    + 'runs it:',
  thenStatus: 'Then run sonah status.',
  // What the hook does, said after each `add --push` (the plan's section 2; A7): "now" only when git runs it now, as
  // D143's opt-in words; when there is something to add, what it does once git runs it.
  about: (server) => 'Each push from this repository now leaves each pushed branch for a review in the background. '
    + `Sonah puts each review on ${server}.`,
  aboutOnce: (server) => 'Once git runs Sonah\'s push script, each push from this repository leaves each pushed branch '
    + `for a background review. Sonah puts each review on ${server}.`,
  cost: 'Each review runs on your Claude Code login, as sonah visual does, and counts toward your Claude Code plan.',
  cap: `Sonah reviews at most ${PUSH_BRANCHES_MAX} branches of one push, the newest first.`,
  skipOnce: 'Run git push --no-verify to push once with no review.',
  stopIt: 'Run sonah hook remove --push to stop it.',
  notConnected: 'This computer has no connection to Sonah Team yet, so a push starts no review. Run sonah connect '
    + '<code> first.',
  noClaude: 'Sonah did not find Claude Code on your PATH. Each review needs Claude Code. Install it, then run sonah '
    + 'hook add --push again.',
  privateClient: (file) => `${file} belongs to sonah-pr, an earlier client of Sonah Team, which already reviews each `
    + 'push here. Sonah changed nothing. Run sonah-pr hook uninstall here first, then run sonah hook add --push again.',
  // The push script's one line when node or Sonah is gone (it holds no single quote).
  scriptMoved: 'Sonah moved or was uninstalled, so Sonah does not review this push. Run sonah hook add --push again, or '
    + 'sonah hook remove --push.',
  removed: (files) => `Sonah deleted ${files.join(', ')}.`,
  unlisted: 'Pushes from this repository start no review now.',
  nothingToRemove: 'Sonah\'s push hook is not in this repository. Sonah changed nothing.',
  stays: 'Sonah\'s push hook stays on in this repository. Run sonah hook remove --push to remove it too.',
  problems: {
    push_hook_temporary_install: (path) => `This Sonah runs from ${path}, in a folder that npx, pnpm dlx, bunx or yarn `
      + 'dlx made for one run. A hook that names it stops once that folder goes. Sonah changed nothing. Install Sonah '
      + 'with npm install -g getsonah, and run its sonah hook add --push.',
    push_hook_windows: 'Sonah turns the push hook on only on macOS and Linux. Sonah changed nothing.',
    push_hook_list_unreadable: (file) => `Sonah cannot read ${file} as its list of repositories with a push hook. `
      + 'Sonah changed nothing. Delete that file, then run sonah hook add --push again in each repository.',
  },
  // `sonah status` and `sonah doctor`: one heading for each listed repository, then its lines.
  report: {
    heading: (top, server) => `Push hook in ${top}, for ${server}:`,
    off: 'Off. Sonah\'s push script is not in the git folder of this repository.',
    on: {
      runner: 'On. Git runs Sonah\'s hook at each push.',
      'pre-commit': (file) => `On. pre-commit moved Sonah's hook to ${file}, and its own hook runs it.`,
    },
    moved: (file) => `Off. lefthook moved Sonah's hook to ${file}, and nothing runs it there.`,
    notRun: (file) => `Off. ${file} runs no line of Sonah's, and Sonah's push script is still there.`,
    notExecutable: (file) => `Off. ${file} is Sonah's hook, but it is not executable, so git skips it.`,
    notChecked: (file) => `Not checked. ${file} is another tool's hook, and Sonah cannot tell whether it runs Sonah's `
      + 'push script.',
    lineNotChecked: (file) => `Not checked. Sonah's line is in ${file}, and Sonah cannot tell whether git runs it there.`,
    check: 'To check it, push a branch, and look for the line of Sonah in what git push prints.',
    fix: (top) => `Fix: run sonah hook add --push in ${top}, and add what it prints.`,
    nodeGone: (path) => `The node that the hook runs is no longer at ${path}.`,
    sonahGone: (path) => `The Sonah that the hook runs is no longer at ${path}.`,
    otherInstall: (version, path) => `The hook runs getsonah ${version} at ${path}, and not this install of Sonah.`,
    otherServer: (server) => `This computer has its connection to ${server}, so a push from here starts no review.`,
    refresh: (top) => `Fix: run sonah hook add --push in ${top} again, or sonah hook remove --push there.`,
    gone: (common) => `${common} is no longer a git repository, so no push runs this hook.`,
    waiting: (branches) => `Branches that wait for review: ${branches.join(', ')}.`,
  },
});

const failure = (code, file) => Object.assign(new Error(code), { code, file });
/** `{ kind: 'file', text }` for a regular file, `{ kind: 'absent' }`, or `{ kind: 'other' }` for a link, a folder or
 *  anything else that is not a regular file (never followed or read). */
async function regularText(path) {
  try {
    if (!(await lstat(path)).isFile()) return { kind: 'other' };
    return { kind: 'file', text: await readFile(path, 'utf8') };
  } catch (e) {
    if (e?.code === 'ENOENT' || e?.code === 'ENOTDIR') return { kind: 'absent' };
    throw e;
  }
}
const isOneOf = (entry, known) => entry.kind === 'file' && known.includes(entry.text);
const exists = (path) => lstat(path).then(() => true, () => false);
/** Whether git, or pre-commit, would run `path`: it may be executed. */
const executable = (path) => access(path, constants.X_OK).then(() => true, () => false);

/** The repository that holds `dir`, as git says it: its working tree's top, its common dir (and its real path, the
 *  list's key), the hooks folder git uses (core.hooksPath honoured), the default one, and core.hooksPath as configured.
 *  Throws a HOOK_PROBLEMS code. */
async function repositoryOf(dir, git) {
  const inside = await git(dir, ['rev-parse', '--is-inside-work-tree']);
  if (inside?.trim() !== 'true') {
    const bare = await git(dir, ['rev-parse', '--is-bare-repository']);
    throw failure(bare?.trim() === 'true' ? 'hook_bare_repository' : 'hook_not_git');
  }
  const paths = await git(dir, ['rev-parse', '--show-toplevel', '--git-common-dir', '--git-path', 'hooks']);
  const [top, common, hooks] = (paths ?? '').split('\n');
  if (!top || !common || !hooks) throw failure('hook_not_git');
  const hooksPathSet = (await git(dir, ['config', '--get', 'core.hooksPath']))?.replace(/\n$/, '') || null;
  const commonDir = resolve(dir, common);
  return { top, commonDir, realCommon: await realpath(commonDir), hooksDir: resolve(dir, hooks),
    defaultHooksDir: join(commonDir, 'hooks'), hooksPath: hooksPathSet,
    scriptPath: join(commonDir, SCRIPT_FOLDER, PUSH_SCRIPT_NAME),
    notePath: join(commonDir, SCRIPT_FOLDER, HOOKS_FOLDER_NOTE) };
}

/** The format of a lefthook file, from its extension. */
const lefthookFormat = (name) => (name.endsWith('.toml') ? 'toml' : /\.jsonc?$/.test(name) ? 'json' : 'yaml');
/** Whether a lefthook file's text names the pre-push hook as a key, in its own format. */
export function lefthookNamesPush(name, text) {
  const format = lefthookFormat(name);
  if (format === 'toml') return new RegExp(`^\\s*\\[\\s*"?${PUSH_HOOK_EVENT}"?\\s*[.\\]]`, 'm').test(text);
  if (format === 'json') return text.includes(`"${PUSH_HOOK_EVENT}"`);
  return new RegExp(`^["']?${PUSH_HOOK_EVENT}["']?\\s*:`, 'm').test(text);
}
const lefthookHoldsPushRun = (text) => text.includes(LEFTHOOK_PUSH_RUN)
  || text.includes(JSON.stringify(LEFTHOOK_PUSH_RUN));
/** Sonah's lefthook command for the push hook in the format of the file named: the whole block when the file has no
 *  pre-push, else only the command, to put under that hook's commands. `use_stdin` hands it the refs. */
export function lefthookPushLines(name, hasEvent) {
  const format = lefthookFormat(name);
  if (format === 'toml')
    return `[${PUSH_HOOK_EVENT}.commands.${LEFTHOOK_PUSH_COMMAND}]\nuse_stdin = true\nrun = '${LEFTHOOK_PUSH_RUN}'`;
  if (format === 'json') {
    const command = `"${LEFTHOOK_PUSH_COMMAND}": { "use_stdin": true, "run": ${JSON.stringify(LEFTHOOK_PUSH_RUN)} }`;
    return hasEvent ? command : `"${PUSH_HOOK_EVENT}": { "commands": { ${command} } }`;
  }
  const command = `${LEFTHOOK_PUSH_COMMAND}:\n      use_stdin: true\n      run: '${LEFTHOOK_PUSH_RUN}'`;
  return hasEvent ? `    ${command}` : `${PUSH_HOOK_EVENT}:\n  commands:\n    ${command}`;
}

/** husky's own pre-push file when core.hooksPath is husky's folder, else null. */
function huskyHookFile(repo) {
  if (!repo.hooksPath || !repo.hooksPath.replace(/\/+$/, '').endsWith(HUSKY_RUNNERS)) return null;
  return join(dirname(repo.hooksDir), PUSH_HOOK_EVENT);
}

/**
 * What the files say of the push hook in the repository that holds `dir`: `{ repo, state, route, file, lineIn,
 * script, ... }`, where state is one of PUSH_HOOK_STATES and route, when on, one of PUSH_HOOK_ROUTES, by D143's rules
 * (agent-session-hook.js `commitLinkFacts`) for the pre-push hook. `script` is the install Sonah's push script names,
 * or null. `privateClient` is a hook file that holds the private client's mark or line. Reads files and git's answers
 * only; runs no hook. Throws a HOOK_PROBLEMS code.
 */
export async function pushHookFacts(dir, { git = gitOut } = {}) {
  const repo = await repositoryOf(dir, git);
  const scriptEntry = await regularText(repo.scriptPath);
  const script = scriptEntry.kind === 'file' ? parsePushScript(scriptEntry.text) : null;
  const scriptState = scriptEntry.kind === 'absent' ? 'absent' : script ? 'sonah' : 'foreign';
  const hookFile = join(repo.hooksDir, PUSH_HOOK_EVENT);
  const hook = await regularText(hookFile);
  const hookText = hook.kind === 'file' ? hook.text : '';
  const huskyFile = huskyHookFile(repo);
  const husky = huskyFile ? await regularText(huskyFile) : { kind: 'absent' };
  const runners = [];
  for (const folder of [...new Set([repo.hooksDir, repo.defaultHooksDir])])
    for (const suffix of ['', ...Object.values(MOVED_SUFFIXES)]) {
      const path = join(folder, `${PUSH_HOOK_EVENT}${suffix}`);
      if (isOneOf(await regularText(path), KNOWN_PUSH_RUNNERS)) {
        runners.push({ path, folder, suffix, sonahs: await linkFreeUnder(repo.commonDir, path) });
      }
    }
  const lefthookFiles = [];
  for (const name of LEFTHOOK_FILES) {
    const entry = await regularText(join(repo.top, name));
    if (entry.kind === 'file') lefthookFiles.push({ name, holdsRun: lefthookHoldsPushRun(entry.text),
      namesEvent: lefthookNamesPush(name, entry.text) });
  }
  // The private client's hook, where git runs it or where it wrote it.
  let privateClient = null;
  for (const [path, entry] of [[hookFile, hook], [huskyFile, husky],
    [join(repo.defaultHooksDir, PUSH_HOOK_EVENT), await regularText(join(repo.defaultHooksDir, PUSH_HOOK_EVENT))]]) {
    if (!privateClient && path && entry.kind === 'file'
      && (entry.text.includes(PRIVATE_CLIENT_MARK) || entry.text.includes(PRIVATE_CLIENT_SCRIPT))) privateClient = path;
  }
  const moved = (suffix) => runners.find((r) => r.folder === repo.hooksDir && r.suffix === suffix);
  const facts = { repo, scriptState, script, scriptText: scriptEntry.kind === 'file' ? scriptEntry.text : null,
    hookFile, hookKind: hook.kind, huskyFile, runners, lefthookFiles, privateClient,
    lefthookHook: hookText.includes(LEFTHOOK_PUSH_CALL), preCommitHook: hookText.includes(PRE_COMMIT_HOOK_ID),
    huskyHook: huskyFile !== null && hook.kind === 'file' && HUSKY_PUSH_STUBS.includes(hookText.replace(/\n$/, '')) };
  let lineIn = null;
  if (!isOneOf(hook, KNOWN_PUSH_RUNNERS) && hookText.includes(PUSH_HOOK_LINE)) lineIn = hookFile;
  else if (husky.kind === 'file' && husky.text.includes(PUSH_HOOK_LINE)) lineIn = huskyFile;
  if (!lineIn && facts.lefthookHook) {
    const named = lefthookFiles.find((f) => f.holdsRun);
    if (named) lineIn = join(repo.top, named.name);
  }
  let route = null, file = null, idle = null;
  if (isOneOf(hook, KNOWN_PUSH_RUNNERS)) {
    if (await executable(hookFile)) { route = RUNNER; file = hookFile; } else idle = hookFile;
  } else if (facts.preCommitHook && moved(MOVED_SUFFIXES.legacy)) {
    const legacy = moved(MOVED_SUFFIXES.legacy).path;
    if (await executable(legacy)) { route = PRE_COMMIT; file = legacy; } else idle = legacy;
  }
  let state;
  if (scriptState !== 'sonah') state = OFF;
  else if (route) state = ON;
  else if (idle) { state = NOT_RUN; file = idle; }
  else if (lineIn) { state = NOT_CHECKED; file = lineIn; }
  else if (moved(MOVED_SUFFIXES.old)) { state = MOVED; file = moved(MOVED_SUFFIXES.old).path; }
  // husky 9's hook runs only .husky/pre-push, as lefthook's runs only its file's commands: with no line of Sonah's
  // there, git runs no line of Sonah's.
  else if (facts.huskyHook) { state = NOT_RUN; file = huskyFile; }
  else if (facts.lefthookHook || hook.kind === 'absent') { state = NOT_RUN; file = hookFile; }
  else { state = NOT_CHECKED; file = hookFile; }
  return { ...facts, state, route: state === ON ? route : null, file, lineIn: state === NOT_CHECKED ? lineIn : null,
    notExecutable: state === NOT_RUN && idle ? idle : null };
}

/** The state line of the push hook for these facts, and whether it needs the person (Sonah's script is there and git
 *  provably does not run it, or the repository is listed and its script is gone). */
export function pushHookStatus(facts, top) {
  const s = PUSH_HOOK_WORDS.report;
  if (facts.state === OFF) return { lines: [s.off, s.refresh(top)], attention: true };
  if (facts.state === ON) {
    const words = s.on[facts.route];
    return { lines: [typeof words === 'function' ? words(facts.file) : words], attention: false };
  }
  if (facts.state === MOVED) return { lines: [s.moved(facts.file), s.fix(top)], attention: true };
  if (facts.state === NOT_RUN && facts.notExecutable)
    return { lines: [s.notExecutable(facts.file), s.fix(top)], attention: true };
  if (facts.state === NOT_RUN) return { lines: [s.notRun(facts.file), s.fix(top)], attention: true };
  if (facts.lineIn) return { lines: [s.lineNotChecked(facts.lineIn), s.check], attention: false };
  return { lines: [s.notChecked(facts.file), s.fix(top)], attention: false };
}

/** Sonah's command for the shared lefthook file, in that file's format. */
function lefthookAdvice(facts) {
  const found = facts.lefthookFiles.find((f) => !f.name.includes('lefthook-local')) ?? facts.lefthookFiles[0];
  const name = found?.name ?? 'lefthook.yml';
  const file = join(facts.repo.top, name);
  const merge = Boolean(found?.namesEvent) && lefthookFormat(name) !== 'toml';
  return { file, words: (merge ? PUSH_HOOK_WORDS.mergeLefthook : PUSH_HOOK_WORDS.addLefthook)(file),
    text: lefthookPushLines(name, Boolean(found?.namesEvent)), after: HOOK_WORDS.lefthookShared };
}

/** What the person adds, and where, when Sonah does not write the hook file itself: `{ words, text, after }`. */
function advice(facts) {
  const { repo } = facts;
  if (facts.preCommitHook) return { words: PUSH_HOOK_WORDS.preCommitSteps(repo.top), text: PRE_COMMIT_PUSH_STEPS };
  if (facts.lefthookHook || (facts.state === MOVED && facts.lefthookFiles.length)) return lefthookAdvice(facts);
  if (facts.huskyFile) return { words: PUSH_HOOK_WORDS.addLine(facts.huskyFile), text: PUSH_HOOK_LINE };
  if (facts.hookKind === 'absent')
    return { words: HOOK_WORDS.createFile(facts.hookFile), text: PUSH_HOOK_RUNNER.trimEnd() };
  return { words: PUSH_HOOK_WORDS.addLine(facts.hookFile), text: PUSH_HOOK_LINE };
}

/** Writes `text` to `path` whole, inside the git common dir with no link on the way: a new file beside it (`wx`), then
 *  a rename, so a push that sources it never reads half of one. */
async function writeScript(root, path, text) {
  const temporary = join(dirname(path), `.${PUSH_SCRIPT_NAME}.${process.pid}.tmp`);
  if (!(await linkFreeUnder(root, path)) || !(await linkFreeUnder(root, temporary))) throw failure('hook_path_link', path);
  await mkdir(dirname(path), { recursive: true });
  try {
    await writeFile(temporary, text, { flag: 'wx', mode: 0o644 });
    await rename(temporary, path);
  } catch (error) {
    await rm(temporary, { force: true }).catch(() => {});
    throw error;
  }
}
/** Writes the runner as an executable file, only if nothing is there (`wx`), inside the git common dir with no link. */
async function writeRunner(root, path, text) {
  if (!(await linkFreeUnder(root, path))) throw failure('hook_path_link', path);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, text, { flag: 'wx', mode: 0o755 });
  await chmod(path, 0o755);
}

/** Whether this install's entry lies in a folder that npx, pnpm dlx, bunx or yarn dlx made for one run. */
export function temporaryInstall(path) {
  return String(path).split(/[\\/]/).some((part) => part === '_npx' || part === 'dlx' || /^dlx-\d+$/.test(part)
    || part.startsWith('bunx-'));
}
/** The executable files named `name` in the absolute folders of PATH, in its order. */
async function onPath(name, env) {
  const found = [];
  for (const dir of String(env.PATH ?? '').split(delimiter).filter((d) => d && isAbsolute(d))) {
    if (await executable(join(dir, name))) found.push(join(dir, name));
  }
  return found;
}
/** D230 review 1: a folder of links that fnm makes for one shell (`fnm_multishells/<pid>_<time>/bin`) and removes with it
 *  or at the next start of the computer: a path through it outlives nothing. */
const shellOnly = (path) => String(path).split(/[\\/]/).includes('fnm_multishells');
/** The node this process runs, by a path on PATH that leads to it when there is one (a package manager's link outlives
 *  an upgrade), else its own path. D230 review 1: never a path through fnm's folder of one shell, which the push script
 *  and the start reminder's entry would name after it is gone. */
export async function stableNode(env, execPath = process.execPath) {
  const real = (path) => realpath(path).catch(() => null);
  const me = await real(execPath);
  for (const path of await onPath('node', env)) {
    if (me !== null && !shellOnly(path) && await real(path) === me) return path;
  }
  return execPath;
}
/** The claude that PATH finds first, or null. D229: `sonah fix` runs it by this path, never by the word `claude`
 *  through a shell. */
export async function claudeOnPath(env) {
  const [found] = await onPath('claude', env);
  return found ?? null;
}
/** The folder of the claude that PATH finds first, or null. */
export async function claudeFolder(env) {
  const found = await claudeOnPath(env);
  return found ? dirname(found) : null;
}
/** This install's getsonah version: the build's own when it carries one, else the package's; null when unreadable. */
export async function installedVersion() {
  const version = typeof SONAH_VERSION === 'string' ? SONAH_VERSION
    : await readFile(PACKAGE_JSON, 'utf8').then((text) => JSON.parse(text).version, () => null);
  return VERSION_SHAPE.test(version ?? '') ? version : null;
}

/** The seat line for a connection (A6): GET /api/token's answer said as `sonah connect` says it; the token's refusal
 *  (401) is marked and said; any other failure says that Sonah could not read the seat. */
async function seatOf(connection, { fetch, where }) {
  try { return seatLine(await teamApi({ server: connection.server, token: connection.token, fetch }).whoami()); }
  catch (error) {
    const code = teamProblemOf(error);
    if (code === null) throw error;
    if (code === 'team_bad_token') {
      await markRefused(connection, where).catch(() => {});
      return CONNECT_WORDS.status.refused(connection.server);
    }
    return CONNECT_WORDS.seat.notRead;
  }
}

/**
 * `sonah hook add --push`: `{ outcome, lines, server }`, outcome `on`, `already_on`, `add_line` (Sonah printed what you
 * add) or `private_client` (the private client's hook reviews the pushes here). Throws a HOOK_PROBLEMS or
 * PUSH_HOOK_PROBLEMS code before it writes anything. With `seat` null, a connected computer asks the server whose seat
 * the token has (GET /api/token, A6) and says it; one that is not connected asks nothing. `seat` false says no seat
 * (`sonah connect` has said it already); a string is said as it is.
 */
export async function addPushHook(dir, { git = gitOut, env = process.env, platform = process.platform,
  cliPath = SONAH_CLI, execPath = process.execPath, version, fetch = globalThis.fetch, seat = null } = {}) {
  if (platform === 'win32') throw failure('push_hook_windows');
  const cli = await realpath(cliPath);
  if (temporaryInstall(cli)) throw failure('push_hook_temporary_install', cli);
  let facts = await pushHookFacts(dir, { git });
  const { repo } = facts;
  if (facts.privateClient)
    return { outcome: 'private_client', lines: [PUSH_HOOK_WORDS.privateClient(facts.privateClient)] };
  if (facts.scriptState === 'foreign') throw failure('hook_file_foreign', repo.scriptPath);
  if (!(await linkFreeUnder(repo.commonDir, repo.scriptPath))) throw failure('hook_path_link', repo.scriptPath);
  const where = { env };
  if ((await readHooks(where)).state === 'invalid') throw failure('push_hook_list_unreadable', hooksPath(where));
  const saved = await readConnection(where);
  const connection = saved.state === 'ok' ? saved.connection : null;
  const server = connection?.server ?? VISUAL_DEFAULT_SERVER;
  const claudeDir = await claudeFolder(env);
  const text = pushScriptText({ version: version ?? await installedVersion() ?? 'unknown',
    node: await stableNode(env, execPath), cli, home: typeof env.SONAH_HOME === 'string' && env.SONAH_HOME !== ''
      ? resolve(env.SONAH_HOME) : null, claudeDir });
  const wasOn = facts.state === ON && facts.scriptText === text;
  const lines = [];
  if (facts.scriptText !== text) {
    await writeScript(repo.commonDir, repo.scriptPath, text);
    if (facts.state === ON) lines.push(PUSH_HOOK_WORDS.scriptWritten(repo.scriptPath));
  }
  facts = await pushHookFacts(dir, { git });
  let outcome;
  const runnerSafe = !repo.hooksPath && facts.hookKind === 'absent' && await linkFreeUnder(repo.commonDir, facts.hookFile);
  if (wasOn) { outcome = 'already_on'; lines.push(PUSH_HOOK_WORDS.alreadyOn); }
  else if (facts.state === ON) { outcome = 'on'; lines.push(...pushHookStatus(facts, repo.top).lines); }
  else if (facts.notExecutable && await linkFreeUnder(repo.commonDir, facts.notExecutable)) {
    await chmod(facts.notExecutable, 0o755);
    outcome = 'on';
    lines.push(PUSH_HOOK_WORDS.madeExecutable(facts.notExecutable));
  } else if (facts.notExecutable) {
    outcome = 'add_line';
    lines.push(PUSH_HOOK_WORDS.notOnNotExecutable(facts.notExecutable), HOOK_WORDS.makeExecutable, '',
      `chmod +x ${shellQuoted(facts.notExecutable)}`, '', PUSH_HOOK_WORDS.thenStatus);
  } else if (runnerSafe) {
    const madeFolder = !(await exists(repo.hooksDir));
    await writeRunner(repo.commonDir, facts.hookFile, PUSH_HOOK_RUNNER);
    if (madeFolder && await linkFreeUnder(repo.commonDir, repo.notePath) && !(await exists(repo.notePath)))
      await writeFile(repo.notePath, HOOKS_FOLDER_NOTE_TEXT);
    outcome = 'on';
    lines.push(PUSH_HOOK_WORDS.turnedOn(facts.hookFile));
    if (facts.lefthookFiles.length) {
      const add = lefthookAdvice(facts);
      lines.push('', PUSH_HOOK_WORDS.lefthookAhead(add.file), add.words, '', add.text);
    }
  } else {
    outcome = 'add_line';
    const linked = !repo.hooksPath && facts.hookKind === 'absent';
    lines.push(linked ? PUSH_HOOK_WORDS.notOnLink(repo.hooksDir)
      : repo.hooksPath && facts.hookKind === 'absent' ? PUSH_HOOK_WORDS.notOnHooksPath(repo.hooksDir)
        : facts.preCommitHook ? PUSH_HOOK_WORDS.notOnPreCommit(facts.hookFile)
          : PUSH_HOOK_WORDS.notOnForeign(facts.hookFile));
    const add = advice(facts);
    lines.push(add.words, '', add.text, '', ...(add.after ? [add.after] : []), PUSH_HOOK_WORDS.thenStatus);
  }
  await updateHooks(where, (repos) => [...repos.filter((r) => r.common !== repo.realCommon),
    { common: repo.realCommon, server }]);
  // The words say "now" only when git runs the hook now; otherwise what it does once git does (D143's rule).
  lines.push('', (outcome === 'add_line' ? PUSH_HOOK_WORDS.aboutOnce : PUSH_HOOK_WORDS.about)(server),
    PUSH_HOOK_WORDS.cost, PUSH_HOOK_WORDS.cap, PUSH_HOOK_WORDS.skipOnce, PUSH_HOOK_WORDS.stopIt);
  if (claudeDir === null) lines.push(PUSH_HOOK_WORDS.noClaude);
  if (connection === null) lines.push(PUSH_HOOK_WORDS.notConnected);
  else if (seat !== false) lines.push(seat ?? await seatOf(connection, { fetch, where }));
  return { outcome, lines, server };
}

/** `sonah hook remove --push`: deletes Sonah's own push files inside the git common dir and nothing else, takes the
 *  repository off the list and drops its tickets. Throws a HOOK_PROBLEMS or PUSH_HOOK_PROBLEMS code. */
export async function removePushHook(dir, { git = gitOut, env = process.env } = {}) {
  const facts = await pushHookFacts(dir, { git });
  const { repo } = facts;
  const where = { env };
  const listed = await readHooks(where);
  if (listed.state === 'invalid') throw failure('push_hook_list_unreadable', hooksPath(where));
  const deleted = [], left = [];
  for (const runner of facts.runners) {
    if (runner.sonahs) { await rm(runner.path); deleted.push(runner.path); } else left.push(runner.path);
  }
  if (facts.scriptState === 'sonah' && await linkFreeUnder(repo.commonDir, repo.scriptPath)) {
    await rm(repo.scriptPath);
    deleted.push(repo.scriptPath);
  }
  // The hooks folder that `add` made (D143's note), when it is empty now; the note stays while the folder holds a file.
  const note = await regularText(repo.notePath);
  if (note.kind === 'file' && note.text === HOOKS_FOLDER_NOTE_TEXT && await linkFreeUnder(repo.commonDir, repo.notePath)
    && await linkFreeUnder(repo.commonDir, repo.defaultHooksDir)) {
    try {
      if (!(await readdir(repo.defaultHooksDir)).length) {
        await rmdir(repo.defaultHooksDir);
        deleted.push(repo.defaultHooksDir);
        await rm(repo.notePath);
      }
    } catch (e) { if (e?.code !== 'ENOENT') throw e; }
  }
  const folder = dirname(repo.scriptPath);
  if (await linkFreeUnder(repo.commonDir, folder)) {
    try { if (!(await readdir(folder)).length) await rmdir(folder); } catch (e) { if (e?.code !== 'ENOENT') throw e; }
  }
  const wasListed = listed.state === 'ok' && listed.repos.some((r) => r.common === repo.realCommon);
  if (wasListed) await updateHooks(where, (repos) => repos.filter((r) => r.common !== repo.realCommon));
  // D227 review: the runs of the tickets dropped end `skipped`, `hook_removed`. D227 review 1: and the repository's
  // reviews that wait to be sent; a failure to write the runs is dropped, as forgetTickets drops it.
  const off = { state: 'skipped', why: 'hook_removed' };
  await forgetTickets(where, { common: repo.realCommon, end: off });
  await endPendingUploads(where, { common: repo.realCommon, end: off }).catch(() => {});
  const lines = [deleted.length ? PUSH_HOOK_WORDS.removed(deleted)
    : wasListed ? PUSH_HOOK_WORDS.unlisted : PUSH_HOOK_WORDS.nothingToRemove];
  if (deleted.length) lines.push(PUSH_HOOK_WORDS.unlisted);
  for (const file of [facts.hookFile, facts.huskyFile].filter(Boolean)) {
    const entry = await regularText(file);
    if (entry.kind === 'file' && entry.text.includes(PUSH_HOOK_LINE) && !left.includes(file) && !deleted.includes(file))
      left.push(file);
  }
  for (const f of facts.lefthookFiles) if (f.holdsRun) left.push(join(repo.top, f.name));
  for (const file of left) lines.push(HOOK_WORDS.lineLeft(file));
  return { outcome: deleted.length || wasListed ? 'removed' : 'nothing', deleted, left, lines };
}

/** Plain `sonah hook remove`'s one added line (the plan's section 2): the push hook stays, when Sonah's push script is
 *  in the repository that holds `dir`; else null. */
export async function pushHookStaysLine(dir, { git = gitOut } = {}) {
  const common = await commonDirOf(dir, { git });
  if (common === null) return null;
  const entry = await regularText(join(common, SCRIPT_FOLDER, PUSH_SCRIPT_NAME)).catch(() => ({ kind: 'other' }));
  return entry.kind === 'file' && parsePushScript(entry.text) ? PUSH_HOOK_WORDS.stays : null;
}

/** `sonah hook add --push` and `sonah hook remove --push` in `dir`: the exit code. 0 on, or Sonah's push files are
 *  gone; 1 Sonah printed what you add, or the private client's hook reviews the pushes here; 2 a problem that it names
 *  with its fix. */
export async function runPushHookCommand(action, dir, { stdout = process.stdout, stderr = process.stderr,
  git = gitOut, ...options } = {}) {
  try {
    const result = action === 'add' ? await addPushHook(dir, { git, ...options })
      : await removePushHook(dir, { git, env: options.env });
    stdout.write(`${result.lines.join('\n')}\n`);
    return result.outcome === 'add_line' || result.outcome === 'private_client' ? 1 : 0;
  } catch (e) {
    if (HOOK_PROBLEMS.includes(e?.code)) { stderr.write(`${HOOK_WORDS.problems[e.code](e.file ?? dir)}\n`); return 2; }
    if (!PUSH_HOOK_PROBLEMS.includes(e?.code)) throw e;
    const says = PUSH_HOOK_WORDS.problems[e.code];
    stderr.write(`${typeof says === 'function' ? says(e.file ?? dir) : says}\n`);
    return 2;
  }
}

/** The main working tree of the repository whose git common dir is `common` that is there, else another of its
 *  worktrees that is; null when none is. */
async function workTreeOf(common, git) {
  for (const tree of await worktreesOf(common, { git })) {
    if (!tree.bare && isAbsolute(tree.path) && await exists(tree.path)) return tree.path;
  }
  return null;
}

/**
 * The push hook of each repository on the list, for `sonah status` and `sonah doctor`, from the files alone (no hook
 * runs, nothing is sent): `{ lines, attention, repos: [{ common, server, state, checks }] }`, or null when the list
 * names no repository. `connection` is this computer's (or null); `cliPath` is this install's entry, which the hook's
 * script should name; `home` the home folder that Sonah's folder is in when SONAH_HOME is not set (settings.js).
 */
export async function pushHookReport({ env = process.env, home, git = gitOut, connection = null,
  cliPath = SONAH_CLI } = {}) {
  const where = home === undefined ? { env } : { env, home };
  const listed = await readHooks(where);
  if (listed.state === 'invalid') {
    return { lines: [PUSH_HOOK_WORDS.problems.push_hook_list_unreadable(hooksPath(where))], attention: true, repos: [] };
  }
  if (listed.state !== 'ok' || !listed.repos.length) return null;
  const s = PUSH_HOOK_WORDS.report;
  const mine = await realpath(cliPath).catch(() => cliPath);
  const lines = [], repos = [];
  let attention = false;
  for (const { common, server } of listed.repos) {
    const top = await workTreeOf(common, git);
    let facts = null;
    if (top !== null) facts = await pushHookFacts(top, { git }).catch(() => null);
    if (facts === null || facts.repo.realCommon !== common) {
      lines.push(s.heading(common, server), `  ${s.gone(common)}`);
      repos.push({ common, server, state: null, checks: ['repository_gone'] });
      continue;
    }
    const status = pushHookStatus(facts, top);
    const said = [...status.lines], checks = [];
    let needs = status.attention;
    if (facts.script) {
      if (!(await executable(facts.script.node))) { said.push(s.nodeGone(facts.script.node)); checks.push('node_gone'); }
      if ((await regularText(facts.script.cli)).kind !== 'file') {
        said.push(s.sonahGone(facts.script.cli)); checks.push('sonah_gone');
      } else if (await realpath(facts.script.cli).catch(() => null) !== mine) {
        said.push(s.otherInstall(facts.script.version, facts.script.cli)); checks.push('other_install');
      }
      if (checks.length) { said.push(s.refresh(top)); needs = true; }
    }
    if (connection !== null && connection.server !== server) {
      said.push(s.otherServer(connection.server), s.refresh(top));
      checks.push('other_server');
      needs = true;
    }
    const waiting = await waitingTickets(where, common);
    if (waiting.length) said.push(s.waiting(waiting.map((t) => t.branch)));
    lines.push(s.heading(top, server), ...[...new Set(said)].map((line) => `  ${line}`));
    repos.push({ common, server, state: facts.state, checks });
    attention ||= needs;
  }
  return { lines, attention, repos };
}

/** The kind of each of this file's word tables, for the style linter (packages/render/test/style-lint.js). */
export const STYLE_KINDS = Object.freeze({ PUSH_HOOK_WORDS: 'notice', 'PUSH_HOOK_WORDS.report.heading': 'fragment' });
const SERVER = 'https://pr.sonah.dev';
export const STYLE_FIXTURES = Object.freeze({
  'PUSH_HOOK_WORDS.turnedOn': [['/repo/.git/hooks/pre-push']],
  'PUSH_HOOK_WORDS.scriptWritten': [['/repo/.git/sonah/pre-push.sh']],
  'PUSH_HOOK_WORDS.notOnForeign': [['/repo/.git/hooks/pre-push']],
  'PUSH_HOOK_WORDS.notOnPreCommit': [['/repo/.git/hooks/pre-push']],
  'PUSH_HOOK_WORDS.notOnHooksPath': [['/repo/.husky/_']],
  'PUSH_HOOK_WORDS.notOnLink': [['/repo/.git/hooks']],
  'PUSH_HOOK_WORDS.notOnNotExecutable': [['/repo/.githooks/pre-push']],
  'PUSH_HOOK_WORDS.madeExecutable': [['/repo/.git/hooks/pre-push']],
  'PUSH_HOOK_WORDS.addLine': [['/repo/.husky/pre-push']],
  'PUSH_HOOK_WORDS.addLefthook': [['/repo/lefthook.yml']],
  'PUSH_HOOK_WORDS.mergeLefthook': [['/repo/lefthook.yml']],
  'PUSH_HOOK_WORDS.lefthookAhead': [['/repo/lefthook.yml']],
  'PUSH_HOOK_WORDS.preCommitSteps': [['/repo']],
  'PUSH_HOOK_WORDS.about': [[SERVER]],
  'PUSH_HOOK_WORDS.aboutOnce': [[SERVER]],
  'PUSH_HOOK_WORDS.privateClient': [['/repo/.git/hooks/pre-push']],
  'PUSH_HOOK_WORDS.removed': [[['/repo/.git/hooks/pre-push', '/repo/.git/sonah/pre-push.sh']]],
  'PUSH_HOOK_WORDS.problems.push_hook_temporary_install': [['/tmp/_npx/1a2b/node_modules/getsonah/bin/sonah.js']],
  'PUSH_HOOK_WORDS.problems.push_hook_list_unreadable': [['~/.sonah/team/hooks.json']],
  'PUSH_HOOK_WORDS.report.heading': [['/repo', SERVER]],
  'PUSH_HOOK_WORDS.report.on.pre-commit': [['/repo/.git/hooks/pre-push.legacy']],
  'PUSH_HOOK_WORDS.report.moved': [['/repo/.git/hooks/pre-push.old']],
  'PUSH_HOOK_WORDS.report.notRun': [['/repo/.git/hooks/pre-push']],
  'PUSH_HOOK_WORDS.report.notExecutable': [['/repo/.git/hooks/pre-push']],
  'PUSH_HOOK_WORDS.report.notChecked': [['/repo/.git/hooks/pre-push']],
  'PUSH_HOOK_WORDS.report.lineNotChecked': [['/repo/.husky/pre-push']],
  'PUSH_HOOK_WORDS.report.fix': [['/repo']],
  'PUSH_HOOK_WORDS.report.nodeGone': [['/opt/node/bin/node']],
  'PUSH_HOOK_WORDS.report.sonahGone': [['/opt/node/lib/node_modules/getsonah/packages/cli/bin/sonah.js']],
  'PUSH_HOOK_WORDS.report.otherInstall': [['0.3.0-beta.17',
    '/opt/node/lib/node_modules/getsonah/packages/cli/bin/sonah.js']],
  'PUSH_HOOK_WORDS.report.otherServer': [['http://127.0.0.1:8080']],
  'PUSH_HOOK_WORDS.report.refresh': [['/repo']],
  'PUSH_HOOK_WORDS.report.gone': [['/repo/.git']],
  'PUSH_HOOK_WORDS.report.waiting': [[['feature-x', 'fix-y']]],
});
