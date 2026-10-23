// D143: the commit-to-session link. `sonah hook add` turns on, in one repository, a git hook that ends a commit that
// Claude Code's agent makes with one line, `Agent-Session: <id>`, where the id is the one that Claude Code puts in the
// environment of the agent's own commands (CLAUDE_CODE_SESSION_ID). The link is provenance, never a time window: a
// commit made in the person's own terminal carries no such variable and is left as it is. A Codex session's commits are
// not stamped.
//
// Two rules hold over everything here: a message changes only by Agent-Session lines added at its end, and Sonah never
// breaks a commit or another tool's hook.
//
// Where each part lives (worktrees share the hooks folder and the git common dir, so one opt-in covers them all):
//   <git common dir>/sonah/agent-session.sh  AGENT_SESSION_SCRIPT: POSIX sh that calls only git and tail; no Node, no
//                                            network, no Sonah process at commit time. It never prints and always exits
//                                            0, since a prepare-commit-msg hook that fails stops the commit.
//   <hooks folder>/prepare-commit-msg        AGENT_SESSION_RUNNER: written only when no hook file is there,
//                                            core.hooksPath is not set, and no link lies on the way. Otherwise Sonah
//                                            changes no file of another tool and prints what to add (`advice`).
// `sonah hook remove` deletes only files whose bytes are Sonah's own (KNOWN_SCRIPTS, KNOWN_RUNNERS) inside the git common
// dir, also where a hook manager moved the runner (`.old`: lefthook; `.legacy`: pre-commit), and the hooks folder that
// `add` made, when it is empty. Lines already in history stay. `sonah doctor` reports the state (COMMIT_LINK_STATES) from
// the files alone, and says on only when it can see that git runs Sonah's script.
// Git 2.54's hooks defined in config (`hook.<name>.command`) are not used: no git of 2.54 or newer could be run here, so
// how such a hook gets the message file and its source is not tested.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { constants } from 'node:fs';
import { access, chmod, lstat, mkdir, readFile, readdir, rm, rmdir, writeFile } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { COMMIT_LINK_ROUTES, COMMIT_LINK_STATES, HOOK_PROBLEMS } from '../../evidence/src/ledger.js';

const execute = promisify(execFile);
/** The closed states and routes (evidence ledger.js), by name. */
const [OFF, ON, MOVED, NOT_RUN, NOT_CHECKED] = COMMIT_LINK_STATES;
const [RUNNER, PRE_COMMIT] = COMMIT_LINK_ROUTES;

/** The line's key, as the hook writes it and as Sonah reads it back. */
export const AGENT_SESSION_KEY = 'Agent-Session';
/** The git hook that runs for every commit, `--no-verify` included, before the editor. */
export const HOOK_EVENT = 'prepare-commit-msg';
/** Sonah's folder in the git common dir, the script's name there, and the note that `add` made the hooks folder. */
export const SCRIPT_FOLDER = 'sonah';
export const SCRIPT_NAME = 'agent-session.sh';
export const HOOKS_FOLDER_NOTE = 'hooks-folder-made';
export const HOOKS_FOLDER_NOTE_TEXT = 'sonah hook add made the hooks folder; sonah hook remove deletes it when it is empty.\n';
/** A session id as Claude Code writes it: a lower-case UUID. A shell `case` pattern, so the hook needs no grep. */
const UUID_CASE = [8, 4, 4, 4, 12].map((n) => '[0-9a-f]'.repeat(n)).join('-');
/** git's scissors line, below which an edited message is cut (the comment character before it varies). */
const SCISSORS = '------------------------ >8 ------------------------';

/** The hook's script, version 1. Its rules (each pinned by d143-agent-session-hook.test.js):
 *  - no source (an editor) or `template`: the person writes the message (lefthook leaves its placeholder `{2}` when
 *    git passes no source: no source too);
 *  - a rebase or a cherry-pick (rebase-merge, rebase-apply, CHERRY_PICK_HEAD): a replay, whose own lines travel in it;
 *  - only an id of a UUID's shape is written, so no environment value can put other text into a message;
 *  - a message that git calls empty stays so, and git still refuses it: once git strips comments, every line blank or
 *    a `Signed-off-by: ` line (git's own rule for an empty message);
 *  - a message with git's scissors line gets nothing, since git cuts what is below it;
 *  - an id already among the message's trailers is not added again;
 *  - the message's bytes are never rewritten: the line is appended at its end, after a newline if the file lacks one,
 *    and after a blank line unless git itself parses the last paragraph with the line as one trailer block
 *    (`git interpret-trailers --parse`, read only), whatever trailer settings the person has. */
export const AGENT_SESSION_SCRIPT = `#!/bin/sh
# sonah agent-session hook, version 1. sonah hook add wrote this file, and sonah hook remove deletes it.
# It appends one line, Agent-Session: <id>, at the end of the message of a commit that Claude Code's agent makes, and
# changes nothing else in the message. It calls only git and tail, prints nothing and always exits 0.
set +u
set -f
msg=\${1:-}
src=\${2:-}
# No source: the message comes from an editor. template: an unedited template. Both are the person's. {2}: lefthook's
# placeholder, left when git passes no source.
case "$src" in ''|template|'{2}') exit 0 ;; esac
[ -f "$msg" ] || exit 0
# A rebase or a cherry-pick replays commits, and their own lines travel in their messages.
for state in rebase-merge rebase-apply CHERRY_PICK_HEAD; do
  path=$(git rev-parse --git-path "$state" 2>/dev/null) || exit 0
  [ -e "$path" ] && exit 0
done
id=\${CLAUDE_CODE_SESSION_ID:-}
case "$id" in ${UUID_CASE}) ;; *) exit 0 ;; esac
# A message that git calls empty (blank lines and Signed-off-by lines only) stays so, and git still refuses it.
words=
while IFS= read -r text; do
  case "$text" in ''|'Signed-off-by: '*) ;; *) words=1; break ;; esac
done <<EOF
$(git stripspace --strip-comments < "$msg" 2>/dev/null)
EOF
[ -n "$words" ] || exit 0
# git cuts an edited message at its scissors line: nothing is added below it.
case "$(git stripspace < "$msg" 2>/dev/null)" in *'${SCISSORS}'*) exit 0 ;; esac
line="${AGENT_SESSION_KEY}: $id"
old=$(git interpret-trailers --parse --no-divider < "$msg" 2>/dev/null) || exit 0
# Once per id: an amend by the same session adds nothing.
case "
$old
" in *"
$line
"*) exit 0 ;; esac
# A message that ends without a newline would join the line to its last line.
[ -n "$(tail -c 1 "$msg")" ] && printf '\\n' >> "$msg"
# The line joins the last paragraph only when git reads that paragraph and the line as one trailer block.
new=$( { tail -c +1 "$msg"; printf '%s\\n' "$line"; } | git interpret-trailers --parse --no-divider 2>/dev/null )
if [ -n "$old" ] && [ "$new" = "$old
$line" ]; then
  printf '%s\\n' "$line" >> "$msg"
else
  printf '\\n%s\\n' "$line" >> "$msg"
fi
exit 0
`;
/** The one shell line that runs the script, for the runner and for a hook that another tool owns. It does nothing, and
 *  exits 0, once the script is gone. */
export const HOOK_LINE = `sonah_hook="$(git rev-parse --git-common-dir)/${SCRIPT_FOLDER}/${SCRIPT_NAME}"; `
  + 'if [ -f "$sonah_hook" ]; then sh "$sonah_hook" "$@"; fi';
/** The hook file Sonah writes when the hooks folder has none. */
export const AGENT_SESSION_RUNNER = `#!/bin/sh
# sonah agent-session hook, version 1: runs the script that sonah hook add wrote. sonah hook remove deletes this file.
${HOOK_LINE}
exit 0
`;
/** The same line as lefthook runs a command, with the hook's arguments as lefthook passes them: quoted, since lefthook
 *  puts git's arguments in place of {1} and {2} as they are, and the message file's path can hold a space (a linked
 *  worktree's is absolute). It holds no single quote, so it goes unchanged into a YAML single-quoted string and a TOML
 *  literal string. */
export const LEFTHOOK_RUN = `sonah_hook="$(git rev-parse --git-common-dir)/${SCRIPT_FOLDER}/${SCRIPT_NAME}"; `
  + 'if [ -f "$sonah_hook" ]; then sh "$sonah_hook" "{1}" "{2}"; fi';
export const LEFTHOOK_COMMAND = 'sonah-agent-session';
/** The commands that hand Sonah's hook to pre-commit, which then keeps it as `.legacy` and runs it. */
export const PRE_COMMIT_STEPS = `pre-commit uninstall -t ${HOOK_EVENT}\nsonah hook add\npre-commit install -t ${HOOK_EVENT}`;

/** Every version of the script and the runner that Sonah wrote: `remove` deletes, and `doctor` knows, only these bytes. */
export const KNOWN_SCRIPTS = Object.freeze([AGENT_SESSION_SCRIPT]);
export const KNOWN_RUNNERS = Object.freeze([AGENT_SESSION_RUNNER]);
/** Where hook managers move a hook file that was there before them: lefthook 2.x renames it to `.old` and runs nothing
 *  from there; pre-commit renames it to `.legacy` and runs it from its own hook. */
export const MOVED_SUFFIXES = Object.freeze({ old: '.old', legacy: '.legacy' });
/** The lines by which each hook manager's own hook file names itself: pre-commit's fixed id (its `install` and
 *  `uninstall` find their own hooks by it), and lefthook's call of its runner for this event. */
export const PRE_COMMIT_HOOK_ID = '# ID: 138fd403232d2ddd5efb44317e38bf03';
export const LEFTHOOK_HOOK_CALL = `call_lefthook run "${HOOK_EVENT}"`;
/** lefthook's configuration files, at the top of the working tree (lefthook's documented names and formats). */
export const LEFTHOOK_FILES = Object.freeze(['lefthook', '.lefthook', '.config/lefthook', 'lefthook-local',
  '.lefthook-local', '.config/lefthook-local'].flatMap((name) => ['yml', 'yaml', 'json', 'jsonc', 'toml']
  .map((ext) => `${name}.${ext}`)));
/** husky's hooks folder: core.hooksPath ends with it, and the hook that a person edits is beside it. */
const HUSKY_RUNNERS = '.husky/_';

/** The format of a lefthook file, from its extension. */
const lefthookFormat = (name) => (name.endsWith('.toml') ? 'toml' : /\.jsonc?$/.test(name) ? 'json' : 'yaml');
/** Whether a lefthook file's text names the prepare-commit-msg hook as a key, in its own format. */
export function lefthookNamesEvent(name, text) {
  const format = lefthookFormat(name);
  if (format === 'toml') return new RegExp(`^\\s*\\[\\s*"?${HOOK_EVENT}"?\\s*[.\\]]`, 'm').test(text);
  if (format === 'json') return text.includes(`"${HOOK_EVENT}"`);
  return new RegExp(`^["']?${HOOK_EVENT}["']?\\s*:`, 'm').test(text);
}
/** Whether a lefthook file's text holds Sonah's command, as each format writes it. */
const lefthookHoldsRun = (text) => text.includes(LEFTHOOK_RUN) || text.includes(JSON.stringify(LEFTHOOK_RUN));
/** Sonah's lefthook command in the format of the file named: the whole block when the file has no prepare-commit-msg,
 *  else only the command, to put under that hook's commands (never a second prepare-commit-msg key). */
export function lefthookLines(name, hasEvent) {
  const format = lefthookFormat(name);
  if (format === 'toml') return `[${HOOK_EVENT}.commands.${LEFTHOOK_COMMAND}]\nrun = '${LEFTHOOK_RUN}'`;
  if (format === 'json') {
    const command = `"${LEFTHOOK_COMMAND}": { "run": ${JSON.stringify(LEFTHOOK_RUN)} }`;
    return hasEvent ? command : `"${HOOK_EVENT}": { "commands": { ${command} } }`;
  }
  return hasEvent ? `    ${LEFTHOOK_COMMAND}:\n      run: '${LEFTHOOK_RUN}'`
    : `${HOOK_EVENT}:\n  commands:\n    ${LEFTHOOK_COMMAND}:\n      run: '${LEFTHOOK_RUN}'`;
}

export const HOOK_USAGE = 'sonah hook add|remove [--repo DIR]';

/** The words of `sonah hook` and of its line in `sonah doctor`. */
export const HOOK_WORDS = Object.freeze({
  turnedOn: (file) => `Sonah wrote ${file}. Git runs it at each commit in this repository and in its worktrees.`,
  alreadyOn: 'Sonah\'s hook is already on in this repository.',
  optIn: 'Each commit that your Claude Code agent makes here now ends with one line: Agent-Session: <id>. The id names '
    + 'the agent\'s recording on this computer. The hook adds no part of the recording to the commit and sends nothing. '
    + 'A commit that you make in your own terminal stays as you wrote it. A commit that you type in Claude Code\'s ! '
    + 'bash mode gets the line too. A Codex session gets no line yet.',
  optInOnce: 'Once git runs that line, each commit that your Claude Code agent makes here ends with one line: '
    + 'Agent-Session: <id>. The id names the agent\'s recording on this computer, and the hook sends nothing.',
  publicLine: 'If this repository is public, the line is public and stays in its history. Commits that carry the same '
    + 'id, in any repository, came from one session.',
  stopIt: 'Run sonah hook remove to stop it. The lines that are already in your history stay.',
  lefthookAhead: (file) => `This repository has a lefthook file, ${file}. A later lefthook install moves Sonah's hook `
    + 'aside, where nothing runs it. To keep the link, add Sonah\'s command to that file now.',
  notOnForeign: (file) => `Sonah did not turn the link on: ${file} is another hook, and Sonah does not change it.`,
  notOnPreCommit: (file) => `Sonah did not turn the link on: pre-commit wrote ${file}, and Sonah does not change it.`,
  notOnHooksPath: (dir) => `Sonah did not turn the link on: core.hooksPath sends git to ${dir}, and Sonah does not `
    + 'write there.',
  notOnLink: (dir) => `Sonah did not turn the link on: ${dir} is a link, and Sonah does not write through a link.`,
  notOnNotExecutable: (file) => `Sonah did not turn the link on: ${file} is Sonah's hook, but it is not executable. `
    + 'It lies outside the git folder, so Sonah does not change it.',
  makeExecutable: 'Make it executable with this command:',
  madeExecutable: (file) => `Sonah made its hook ${file} executable, so it runs at each commit again.`,
  addLine: (file) => `Add this line to ${file}, where the hook runs it, before any exec or exit:`,
  createFile: (file) => `Create ${file} with these lines, and make it executable:`,
  addLefthook: (file) => `Add these lines to ${file}:`,
  mergeLefthook: (file) => `Add these lines to ${file}, under the commands of its prepare-commit-msg:`,
  lefthookShared: 'Each worktree reads that file. The lines do nothing where Sonah\'s script is not there.',
  preCommitSteps: (dir) => `Run these commands in ${dir}. pre-commit then keeps Sonah's hook as `
    + 'prepare-commit-msg.legacy, and runs it:',
  thenDoctor: 'Then run sonah doctor.',
  removed: (files) => `Sonah deleted ${files.join(', ')}.`,
  nothingToRemove: 'Sonah\'s hook is not in this repository. Sonah changed nothing.',
  lineLeft: (file) => `The line that runs Sonah's script is still in ${file}. It does nothing now. Remove it when you `
    + 'next edit that file.',
  historyStays: 'The lines that are already in your commit history stay.',
  status: {
    off: 'Commit link: off in this repository. sonah hook add turns it on.',
    on: {
      runner: 'Commit link: on. Git runs Sonah\'s hook at each commit in this repository.',
      'pre-commit': (file) => `Commit link: on. pre-commit moved Sonah's hook to ${file}, and its own hook runs it.`,
    },
    moved: (file) => `Commit link: off. lefthook moved Sonah's hook to ${file}, and nothing runs it there.`,
    notRun: (file) => `Commit link: off. ${file} runs no line of Sonah's, and Sonah's script is still there.`,
    notExecutable: (file) => `Commit link: off. ${file} is Sonah's hook, but it is not executable, so git skips it.`,
    notChecked: (file) => `Commit link: not checked. ${file} is another tool's hook, and Sonah cannot tell whether it `
      + 'runs Sonah\'s script.',
    lineNotChecked: (file) => `Commit link: not checked. Sonah's line is in ${file}, and Sonah cannot tell whether `
      + 'git runs it there.',
    fix: 'Fix: run sonah hook add, and add what it prints.',
    check: 'To check it, let your agent make one commit, and look for the line in git log.',
  },
  problems: {
    hook_not_git: (dir) => `${dir} is in no git working tree. Sonah changed nothing.`,
    hook_bare_repository: (dir) => `${dir} is a bare repository, with no working tree. Sonah changed nothing.`,
    hook_file_foreign: (file) => `${file} is there, and Sonah did not write it. Sonah changed nothing. Move that file `
      + 'away, then run sonah hook add again.',
    hook_path_link: (path) => `${path} passes through a link. Sonah writes nothing through a link, and changed nothing.`,
  },
});

const failure = (code, file) => Object.assign(new Error(code), { code, file });
const runGit = async (dir, args) => {
  try { return (await execute('git', ['-C', dir, ...args], { maxBuffer: 1024 * 1024 })).stdout; }
  catch { return null; }
};
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

/** Whether `path` lies inside `root` with no link among the parts below `root` (each part checked, up to the first that
 *  is not there yet). Sonah writes and deletes only such paths, so nothing it does reaches a folder that a link points
 *  to, such as a tracked one in the working tree. */
export async function linkFreeUnder(root, path) {
  const rel = relative(root, path);
  if (!rel || rel.startsWith('..') || isAbsolute(rel)) return false;
  let at = root;
  for (const part of rel.split(sep)) {
    at = join(at, part);
    try { if ((await lstat(at)).isSymbolicLink()) return false; }
    catch (e) { if (e?.code === 'ENOENT') return true; throw e; }
  }
  return true;
}

/** The repository that holds `dir`, as git says it: its working tree's top, its common dir, the hooks folder git uses
 *  (core.hooksPath honoured), the default one, and core.hooksPath as configured. Throws a HOOK_PROBLEMS code. */
async function repositoryOf(dir, git) {
  const inside = await git(dir, ['rev-parse', '--is-inside-work-tree']);
  if (inside?.trim() !== 'true') {
    const bare = await git(dir, ['rev-parse', '--is-bare-repository']);
    throw failure(bare?.trim() === 'true' ? 'hook_bare_repository' : 'hook_not_git');
  }
  const paths = await git(dir, ['rev-parse', '--show-toplevel', '--git-common-dir', '--git-path', 'hooks']);
  const [top, common, hooks] = (paths ?? '').split('\n');
  if (!top || !common || !hooks) throw failure('hook_not_git');
  const hooksPath = (await git(dir, ['config', '--get', 'core.hooksPath']))?.replace(/\n$/, '') || null;
  const commonDir = resolve(dir, common);
  return { top, commonDir, hooksDir: resolve(dir, hooks), defaultHooksDir: join(commonDir, 'hooks'), hooksPath,
    scriptPath: join(commonDir, SCRIPT_FOLDER, SCRIPT_NAME), notePath: join(commonDir, SCRIPT_FOLDER, HOOKS_FOLDER_NOTE) };
}

/** husky's own hook file when core.hooksPath is husky's folder, else null. */
function huskyHookFile(repo) {
  if (!repo.hooksPath || !repo.hooksPath.replace(/\/+$/, '').endsWith(HUSKY_RUNNERS)) return null;
  return join(dirname(repo.hooksDir), HOOK_EVENT);
}

/**
 * What the files say of the link in the repository that holds `dir`: `{ repo, state, route, file, lineIn, ... }`, where
 * state is one of COMMIT_LINK_STATES and route, when on, one of COMMIT_LINK_ROUTES. On only when Sonah can see that git
 * runs the script: Sonah's own runner is the hook, or pre-commit's hook (by its id line) runs Sonah's runner that it
 * moved to `.legacy`. A line of Sonah's in another file is `lineIn`: not checked, since Sonah cannot tell whether that
 * file reaches it. Reads files and git's answers only; runs no hook. Throws a HOOK_PROBLEMS code.
 */
export async function commitLinkFacts(dir, { git = runGit } = {}) {
  const repo = await repositoryOf(dir, git);
  const script = await regularText(repo.scriptPath);
  const scriptState = script.kind === 'absent' ? 'absent' : isOneOf(script, KNOWN_SCRIPTS) ? 'sonah' : 'foreign';
  const hookFile = join(repo.hooksDir, HOOK_EVENT);
  const hook = await regularText(hookFile);
  const hookText = hook.kind === 'file' ? hook.text : '';
  const huskyFile = huskyHookFile(repo);
  // Sonah's runner wherever it is: the hooks folder git uses, the default one, and where a manager moved it.
  const runners = [];
  for (const folder of [...new Set([repo.hooksDir, repo.defaultHooksDir])])
    for (const suffix of ['', ...Object.values(MOVED_SUFFIXES)]) {
      const path = join(folder, `${HOOK_EVENT}${suffix}`);
      if (isOneOf(await regularText(path), KNOWN_RUNNERS)) {
        runners.push({ path, folder, suffix, sonahs: await linkFreeUnder(repo.commonDir, path) });
      }
    }
  const lefthookFiles = [];
  for (const name of LEFTHOOK_FILES) {
    const entry = await regularText(join(repo.top, name));
    if (entry.kind === 'file') lefthookFiles.push({ name, holdsRun: lefthookHoldsRun(entry.text),
      namesEvent: lefthookNamesEvent(name, entry.text) });
  }
  const moved = (suffix) => runners.find((r) => r.folder === repo.hooksDir && r.suffix === suffix);
  const facts = { repo, scriptState, scriptCurrent: script.kind === 'file' && script.text === AGENT_SESSION_SCRIPT,
    hookFile, hookKind: hook.kind, huskyFile, runners, lefthookFiles,
    lefthookHook: hookText.includes(LEFTHOOK_HOOK_CALL), preCommitHook: hookText.includes(PRE_COMMIT_HOOK_ID) };
  // Where a line or command of Sonah's sits in a file that another tool or the person owns.
  let lineIn = null;
  if (!isOneOf(hook, KNOWN_RUNNERS) && hookText.includes(HOOK_LINE)) lineIn = hookFile;
  else if (huskyFile) { const husky = await regularText(huskyFile); if (husky.kind === 'file' && husky.text.includes(HOOK_LINE)) lineIn = huskyFile; }
  if (!lineIn && facts.lefthookHook) {
    const named = lefthookFiles.find((f) => f.holdsRun);
    if (named) lineIn = join(repo.top, named.name);
  }
  // git runs a hook file, and pre-commit a `.legacy`, only when it is executable: without that, Sonah's runner is idle.
  let route = null, file = null, idle = null;
  if (isOneOf(hook, KNOWN_RUNNERS)) {
    if (await executable(hookFile)) { route = RUNNER; file = hookFile; } else idle = hookFile;
  } else if (facts.preCommitHook && moved(MOVED_SUFFIXES.legacy)) {
    const legacy = moved(MOVED_SUFFIXES.legacy).path;
    if (await executable(legacy)) { route = PRE_COMMIT; file = legacy; } else idle = legacy;
  }
  // Without Sonah's script, any line or runner that is left does nothing: the link is off.
  let state;
  if (scriptState !== 'sonah') state = OFF;
  else if (route) state = ON;
  else if (idle) { state = NOT_RUN; file = idle; }
  else if (lineIn) { state = NOT_CHECKED; file = lineIn; }
  else if (moved(MOVED_SUFFIXES.old)) { state = MOVED; file = moved(MOVED_SUFFIXES.old).path; }
  else if (facts.lefthookHook || hook.kind === 'absent') { state = NOT_RUN; file = hookFile; }
  else { state = NOT_CHECKED; file = hookFile; }
  return { ...facts, state, route: state === ON ? route : null, file, lineIn: state === NOT_CHECKED ? lineIn : null,
    notExecutable: state === NOT_RUN && idle ? idle : null };
}

/** The status line of `sonah doctor` for these facts, and whether it needs the person (Sonah's script is there and git
 *  provably does not run it). */
export function commitLinkStatus(facts) {
  const s = HOOK_WORDS.status;
  if (facts.state === OFF) return { line: s.off, attention: false };
  if (facts.state === ON) {
    const words = s.on[facts.route];
    return { line: typeof words === 'function' ? words(facts.file) : words, attention: false };
  }
  if (facts.state === MOVED) return { line: `${s.moved(facts.file)} ${s.fix}`, attention: true };
  if (facts.state === NOT_RUN && facts.notExecutable) return { line: `${s.notExecutable(facts.file)} ${s.fix}`, attention: true };
  if (facts.state === NOT_RUN) return { line: `${s.notRun(facts.file)} ${s.fix}`, attention: true };
  if (facts.lineIn) return { line: `${s.lineNotChecked(facts.lineIn)} ${s.check}`, attention: false };
  return { line: `${s.notChecked(facts.file)} ${s.fix}`, attention: false };
}

/** Sonah's command for the shared lefthook file (not a lefthook-local one, which is per working tree), in that file's
 *  format: the whole block, or only the command when the file already names prepare-commit-msg. */
function lefthookAdvice(facts) {
  const found = facts.lefthookFiles.find((f) => !f.name.includes('lefthook-local')) ?? facts.lefthookFiles[0];
  const name = found?.name ?? 'lefthook.yml';
  const file = join(facts.repo.top, name);
  const merge = Boolean(found?.namesEvent) && lefthookFormat(name) !== 'toml';
  return { file, words: (merge ? HOOK_WORDS.mergeLefthook : HOOK_WORDS.addLefthook)(file),
    text: lefthookLines(name, Boolean(found?.namesEvent)), after: HOOK_WORDS.lefthookShared };
}

/** What the person adds, and where, when Sonah does not write the hook file itself: `{ words, text, after }`. Never a
 *  line inside a hook file that pre-commit or lefthook wrote (it would not run, or would be lost at their next install). */
function advice(facts) {
  const { repo } = facts;
  if (facts.preCommitHook) return { words: HOOK_WORDS.preCommitSteps(repo.top), text: PRE_COMMIT_STEPS };
  if (facts.lefthookHook || (facts.state === MOVED && facts.lefthookFiles.length)) return lefthookAdvice(facts);
  if (facts.huskyFile) return { words: HOOK_WORDS.addLine(facts.huskyFile), text: HOOK_LINE };
  if (facts.hookKind === 'absent') return { words: HOOK_WORDS.createFile(facts.hookFile), text: AGENT_SESSION_RUNNER.trimEnd() };
  return { words: HOOK_WORDS.addLine(facts.hookFile), text: HOOK_LINE };
}

/** Writes `text` to `path` as an executable file, only if nothing is there (`wx`), and only inside the git common dir
 *  with no link on the way. */
async function writeNew(root, path, text) {
  if (!(await linkFreeUnder(root, path))) throw failure('hook_path_link', path);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, text, { flag: 'wx', mode: 0o755 });
  await chmod(path, 0o755);
}
const exists = (path) => lstat(path).then(() => true, () => false);
/** Whether git, or pre-commit, would run `path`: it may be executed (git and pre-commit both ask the same of a hook). */
const executable = (path) => access(path, constants.X_OK).then(() => true, () => false);
/** A path as one shell word. */
const shellQuoted = (path) => `'${path.replaceAll('\'', '\'\\\'\'')}'`;

/** `sonah hook add`: the outcome and the lines to print. Throws a HOOK_PROBLEMS code. */
export async function addHook(dir, { git = runGit } = {}) {
  let facts = await commitLinkFacts(dir, { git });
  const { repo } = facts;
  if (facts.scriptState === 'foreign') throw failure('hook_file_foreign', repo.scriptPath);
  if (!(await linkFreeUnder(repo.commonDir, repo.scriptPath))) throw failure('hook_path_link', repo.scriptPath);
  const wasOn = facts.state === ON && facts.scriptCurrent;
  // An older script of Sonah's is replaced; any other file there stopped the command above.
  if (facts.scriptState === 'sonah' && !facts.scriptCurrent) await rm(repo.scriptPath);
  if (!facts.scriptCurrent) await writeNew(repo.commonDir, repo.scriptPath, AGENT_SESSION_SCRIPT);
  facts = await commitLinkFacts(dir, { git });
  const lines = [];
  let outcome;
  const runnerSafe = !repo.hooksPath && facts.hookKind === 'absent' && await linkFreeUnder(repo.commonDir, facts.hookFile);
  if (wasOn) { outcome = 'already_on'; lines.push(HOOK_WORDS.alreadyOn); }
  else if (facts.state === ON) { outcome = 'on'; lines.push(commitLinkStatus(facts).line); }
  else if (facts.notExecutable && await linkFreeUnder(repo.commonDir, facts.notExecutable)) {
    // Sonah's own runner in the git folder that git skips: Sonah makes it executable again.
    await chmod(facts.notExecutable, 0o755);
    outcome = 'on';
    lines.push(HOOK_WORDS.madeExecutable(facts.notExecutable));
  } else if (facts.notExecutable) {
    outcome = 'add_line';
    lines.push(HOOK_WORDS.notOnNotExecutable(facts.notExecutable), HOOK_WORDS.makeExecutable, '',
      `chmod +x ${shellQuoted(facts.notExecutable)}`, '', HOOK_WORDS.thenDoctor);
  } else if (runnerSafe) {
    const madeFolder = !(await exists(repo.hooksDir));
    await writeNew(repo.commonDir, facts.hookFile, AGENT_SESSION_RUNNER);
    if (madeFolder && await linkFreeUnder(repo.commonDir, repo.notePath)) await writeFile(repo.notePath, HOOKS_FOLDER_NOTE_TEXT);
    outcome = 'on';
    lines.push(HOOK_WORDS.turnedOn(facts.hookFile));
    if (facts.lefthookFiles.length) {
      const add = lefthookAdvice(facts);
      lines.push('', HOOK_WORDS.lefthookAhead(add.file), add.words, '', add.text);
    }
  } else {
    outcome = 'add_line';
    const linked = !repo.hooksPath && facts.hookKind === 'absent';
    lines.push(linked ? HOOK_WORDS.notOnLink(repo.hooksDir)
      : repo.hooksPath && facts.hookKind === 'absent' ? HOOK_WORDS.notOnHooksPath(repo.hooksDir)
        : facts.preCommitHook ? HOOK_WORDS.notOnPreCommit(facts.hookFile) : HOOK_WORDS.notOnForeign(facts.hookFile));
    const add = advice(facts);
    lines.push(add.words, '', add.text, '', ...(add.after ? [add.after] : []), HOOK_WORDS.thenDoctor);
  }
  // The opt-in words say "now" only when git runs the line now; otherwise what happens once it does.
  lines.push('', outcome === 'add_line' ? HOOK_WORDS.optInOnce : HOOK_WORDS.optIn, HOOK_WORDS.publicLine, HOOK_WORDS.stopIt);
  return { outcome, facts: await commitLinkFacts(dir, { git }), lines };
}

/** `sonah hook remove`: deletes Sonah's own files inside the git common dir and nothing else. Throws a HOOK_PROBLEMS
 *  code. */
export async function removeHook(dir, { git = runGit } = {}) {
  const facts = await commitLinkFacts(dir, { git });
  const { repo } = facts;
  const deleted = [];
  const left = [];
  for (const runner of facts.runners) {
    if (runner.sonahs) { await rm(runner.path); deleted.push(runner.path); } else left.push(runner.path);
  }
  const note = await regularText(repo.notePath);
  const noted = note.kind === 'file' && note.text === HOOKS_FOLDER_NOTE_TEXT && await linkFreeUnder(repo.commonDir, repo.notePath);
  if (noted && await linkFreeUnder(repo.commonDir, repo.defaultHooksDir)) {
    try { if (!(await readdir(repo.defaultHooksDir)).length) { await rmdir(repo.defaultHooksDir); deleted.push(repo.defaultHooksDir); } }
    catch (e) { if (e?.code !== 'ENOENT') throw e; }
  }
  if (noted) await rm(repo.notePath);
  if (facts.scriptState === 'sonah' && await linkFreeUnder(repo.commonDir, repo.scriptPath)) {
    await rm(repo.scriptPath);
    deleted.push(repo.scriptPath);
  }
  const folder = dirname(repo.scriptPath);
  if (basename(folder) === SCRIPT_FOLDER && await linkFreeUnder(repo.commonDir, folder)) {
    try { if (!(await readdir(folder)).length) await rmdir(folder); } catch (e) { if (e?.code !== 'ENOENT') throw e; }
  }
  const lines = [deleted.length ? HOOK_WORDS.removed(deleted) : HOOK_WORDS.nothingToRemove];
  // A line that the person added to a file of theirs or of another tool stays: Sonah does not edit it, and without the
  // script it does nothing.
  for (const file of [facts.hookFile, facts.huskyFile].filter(Boolean)) {
    const entry = await regularText(file);
    if (entry.kind === 'file' && entry.text.includes(HOOK_LINE) && !left.includes(file)
      && !deleted.includes(file)) left.push(file);
  }
  for (const f of facts.lefthookFiles) if (f.holdsRun) left.push(join(repo.top, f.name));
  for (const file of left) lines.push(HOOK_WORDS.lineLeft(file));
  lines.push(HOOK_WORDS.historyStays);
  return { outcome: deleted.length ? 'removed' : 'nothing', deleted, left, lines };
}

/** `sonah hook add|remove [--repo DIR]`. Exit 0: the link is on, or Sonah's files are gone; 1: Sonah could not turn the
 *  link on by itself and printed what you add; 2: usage, or a problem that it names with its fix. */
export async function runHookCommand(argv, { stdout = process.stdout, stderr = process.stderr, cwd = process.cwd(),
  git = runGit } = {}) {
  const [action, ...rest] = argv;
  const usage = () => { stderr.write(`usage: ${HOOK_USAGE}\n`); return 2; };
  if (!['add', 'remove'].includes(action)) return usage();
  if (rest.length !== 0 && (rest.length !== 2 || rest[0] !== '--repo' || !rest[1] || rest[1].startsWith('--'))) return usage();
  const dir = resolve(cwd, rest[1] ?? '.');
  try {
    const result = action === 'add' ? await addHook(dir, { git }) : await removeHook(dir, { git });
    stdout.write(`${result.lines.join('\n')}\n`);
    return result.outcome === 'add_line' ? 1 : 0;
  } catch (e) {
    if (!HOOK_PROBLEMS.includes(e?.code)) throw e;
    stderr.write(`${HOOK_WORDS.problems[e.code](e.file ?? dir)}\n`);
    return 2;
  }
}

/** The kind of each of this file's word tables, for the style linter (packages/render/test/style-lint.js). */
export const STYLE_KINDS = Object.freeze({ HOOK_WORDS: 'notice' });
export const STYLE_FIXTURES = Object.freeze({
  'HOOK_WORDS.turnedOn': [['/repo/.git/hooks/prepare-commit-msg']],
  'HOOK_WORDS.lefthookAhead': [['/repo/lefthook.yml']],
  'HOOK_WORDS.notOnForeign': [['/repo/.git/hooks/prepare-commit-msg']],
  'HOOK_WORDS.notOnPreCommit': [['/repo/.git/hooks/prepare-commit-msg']],
  'HOOK_WORDS.notOnHooksPath': [['/repo/.husky/_']],
  'HOOK_WORDS.notOnLink': [['/repo/.git/hooks']],
  'HOOK_WORDS.notOnNotExecutable': [['/repo/.githooks/prepare-commit-msg']],
  'HOOK_WORDS.madeExecutable': [['/repo/.git/hooks/prepare-commit-msg']],
  'HOOK_WORDS.status.notExecutable': [['/repo/.git/hooks/prepare-commit-msg']],
  'HOOK_WORDS.addLine': [['/repo/.husky/prepare-commit-msg']],
  'HOOK_WORDS.createFile': [['/repo/.githooks/prepare-commit-msg']],
  'HOOK_WORDS.addLefthook': [['/repo/lefthook.yml']],
  'HOOK_WORDS.mergeLefthook': [['/repo/lefthook.yml']],
  'HOOK_WORDS.preCommitSteps': [['/repo']],
  'HOOK_WORDS.removed': [[['/repo/.git/hooks/prepare-commit-msg', '/repo/.git/sonah/agent-session.sh']]],
  'HOOK_WORDS.lineLeft': [['/repo/.husky/prepare-commit-msg']],
  'HOOK_WORDS.status.on.pre-commit': [['/repo/.git/hooks/prepare-commit-msg.legacy']],
  'HOOK_WORDS.status.moved': [['/repo/.git/hooks/prepare-commit-msg.old']],
  'HOOK_WORDS.status.notRun': [['/repo/.git/hooks/prepare-commit-msg']],
  'HOOK_WORDS.status.notChecked': [['/repo/.git/hooks/prepare-commit-msg']],
  'HOOK_WORDS.status.lineNotChecked': [['/repo/.husky/prepare-commit-msg']],
  'HOOK_WORDS.problems.hook_not_git': [['/tmp/notes']],
  'HOOK_WORDS.problems.hook_bare_repository': [['/srv/repo.git']],
  'HOOK_WORDS.problems.hook_file_foreign': [['/repo/.git/sonah/agent-session.sh']],
  'HOOK_WORDS.problems.hook_path_link': [['/repo/.git/sonah/agent-session.sh']],
});
