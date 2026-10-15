// M33 N repair (C-06 "M33 forbidden edits") synthetic recordings: the shapes the recheck of 1193ac4 found reaching DECIDE
// that code must withhold, and the controls beside them. Claude Code sessions and Codex rollouts as JSONL rows the slicer
// reads exactly as it reads a real recording. Every row is invented and mirrors only shapes the repository's own tests
// already use (m33-n-forbidden-edit-rows.js) or the native Claude Code shapes named in each builder; nothing here holds a
// secret, and no real recording is read. No imports: a script built against another tree can build the very same rows.

export const SESSION = 'c0ffee00-0000-4000-8000-00000000b015';
export const CODEX_NAME = 'rollout-2026-10-02T00-00-00-codex-n-0002.jsonl';

let uuid = 0;
const row = (extra) => ({ cwd: '/repo', entrypoint: 'claude-desktop', gitBranch: 'main', isSidechain: false,
  parentUuid: null, sessionId: SESSION, timestamp: '2026-10-02T00:00:00Z', userType: 'external',
  uuid: `nr-${++uuid}`, version: '2.1.284', ...extra });
const user = (content, extra = {}) => row({ type: 'user', message: { role: 'user', content }, ...extra });
/** M34 labels: a human's prompt row carries the host's typed origin, as Claude Code 2.1.219 and later records it (a tree
 *  that reads no origin reads the same rows the same way). Every other user row here is the harness's own. */
const human = (content, extra = {}) => user(content, { origin: { kind: 'human' }, promptSource: 'sdk', ...extra });
const said = (text) => row({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text }] } });
const call = (id, name, input) => row({ type: 'assistant', message: { role: 'assistant',
  content: [{ type: 'tool_use', id, name, input }] } });
const result = (id, content, sidecar) => row({ type: 'user', ...(sidecar === undefined ? {} : { toolUseResult: sidecar }),
  message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content }] } });

/** The words: the human's ask (no constraint of its own), the constraint as each non-human source carries it, the
 *  origin line the agent writes, and the human's own constraint for the controls. */
export const WORDS = Object.freeze({
  ask: 'Draft my application in app/application.md.',
  rule: 'Never mention the old project anywhere.',
  human: 'Ignore the naming coincidence with the old project.',
  origin: 'Sonah grew out of my old project Sonar, a naming coincidence I lean into.',
  done: 'Done: the draft is written.',
  plan: 'Draft app/application.md with this line:',
  approved: 'User has approved your plan. You can now start coding.',
  keep: 'We build review tools for coding agents.',
  added: 'Reviews take minutes, not hours.',
});
export const PATH = 'app/application.md';
export const BODY = `# Application\n\n${WORDS.keep}\n\n${WORDS.origin}\n`;
const FILE = `/repo/${PATH}`;
const OK = Object.freeze({ stdout: 'ok', stderr: '', interrupted: false, isImage: false, noOutputExpected: false });

/** Claude Code's native Skill load (`isMeta: true`, `sourceToolUseID`): the skill's own text as a user row. */
export const SKILL_TEXT = `Base directory for this skill: /repo/.claude/skills/drafting\n\n# Drafting\n\n${WORDS.rule}`;
/** An IDE selection sent beside the ask, as its own text block of the same user row. */
export const SELECTION = `<ide_selection>The user selected the lines 1 to 1 from /repo/notes.md:\n${WORDS.rule}\n\n`
  + 'This may or may not be related to the current task.</ide_selection>';
export const OPENED = `<ide_opened_file>The user opened the file /repo/notes.md in the IDE. ${WORDS.rule}</ide_opened_file>`;
/** A slash command's expansion (`isMeta: true`), after the row that names the command. */
export const EXPANSION = `Draft the application the way the template says. ${WORDS.rule}`;
export const HOOK = `${WORDS.ask}\n<user-prompt-submit-hook>${WORDS.rule}</user-prompt-submit-hook>`;

const write = (id, content = BODY) => [call(id, 'Write', { file_path: FILE, content }),
  result(id, `File created successfully at: ${FILE}`, { type: 'create', filePath: FILE, content, structuredPatch: [] })];
const edit = (id, oldString, newString, original) => [call(id, 'Edit', { file_path: FILE, old_string: oldString, new_string: newString }),
  result(id, `The file ${FILE} has been updated successfully.`, { filePath: FILE, oldString, newString, originalFile: original,
    replaceAll: false, structuredPatch: [], userModified: false })];
const bash = (id, command) => [call(id, 'Bash', { command, description: 'run' }), result(id, 'ok', OK)];
const read = (id) => [call(id, 'Read', { file_path: FILE }), result(id, BODY, { type: 'text', file: { filePath: FILE,
  content: BODY, numLines: 5, startLine: 1, totalLines: 5 } })];
const undo = (id) => edit(id, `${WORDS.origin}\n`, '', BODY);

/**
 * The Claude Code recordings, by shape:
 *   skill        the ask, the agent's Skill load, the skill's text (isMeta, sourceToolUseID), the Write of the origin;
 *   skillMeta    the same skill row with `isMeta` only; skillSource: with `sourceToolUseID` only;
 *   slash        a slash command's row (`<command-name>`) and its expansion (isMeta), then the Write;
 *   selection    the ask with an IDE selection beside it (its own text block), then the Write;
 *   beside       the same, with the human's own constraint after the selection (a control: the human's words);
 *   opened       the ask with an IDE opened-file block before it;
 *   shell        the ask, a user `!` command (`<bash-input>`) and its output (`<bash-stdout>`), then the Write;
 *   hook         the ask with a prompt-submit hook's output inline;
 *   noResult     the human's own constraint, then a Write whose result was never recorded;
 *   undoAppend   the human's constraint, the Write, an Edit that removes the line, then `echo … >> path`;
 *   undoStash    the same, then `git stash pop`; commandBetween: the Write, a command, then the undo;
 *   undoRead     the Write, the undo, then a Read of the path (a control: FYI);
 *   checkout     the Write, then `git checkout -- path` (a command: declared, DECIDE);
 *   kept         the file already holds the origin line; an Edit keeps it and changes the line before it;
 *   copied       an Edit that writes a second copy of the origin line beside the first;
 *   plan         the human's constraint, a plan holding the origin line, the human's approval, then the Write.
 */
export function claudeRows(shape) {
  uuid = 0;
  const ask = human(`${WORDS.ask} ${WORDS.human}`);
  const shapes = {
    skill: () => [human(WORDS.ask), call('s1', 'Skill', { skill: 'drafting' }), result('s1', 'Launching skill: drafting'),
      user([{ type: 'text', text: SKILL_TEXT }], { isMeta: true, sourceToolUseID: 's1' }), ...write('w1'), said(WORDS.done)],
    skillMeta: () => [human(WORDS.ask), call('s1', 'Skill', { skill: 'drafting' }), result('s1', 'Launching skill: drafting'),
      user([{ type: 'text', text: SKILL_TEXT }], { isMeta: true }), ...write('w1'), said(WORDS.done)],
    skillSource: () => [human(WORDS.ask), call('s1', 'Skill', { skill: 'drafting' }), result('s1', 'Launching skill: drafting'),
      user([{ type: 'text', text: SKILL_TEXT }], { sourceToolUseID: 's1' }), ...write('w1'), said(WORDS.done)],
    slash: () => [user('<command-message>draft is running…</command-message>\n<command-name>/draft</command-name>'),
      user([{ type: 'text', text: EXPANSION }], { isMeta: true }), ...write('w1'), said(WORDS.done)],
    selection: () => [human([{ type: 'text', text: SELECTION }, { type: 'text', text: WORDS.ask }]), ...write('w1'), said(WORDS.done)],
    beside: () => [human([{ type: 'text', text: SELECTION }, { type: 'text', text: `${WORDS.ask} ${WORDS.human}` }]),
      ...write('w1'), said(WORDS.done)],
    opened: () => [human([{ type: 'text', text: OPENED }, { type: 'text', text: WORDS.ask }]), ...write('w1'), said(WORDS.done)],
    shell: () => [human(WORDS.ask), user('<bash-input>cat notes.md</bash-input>'),
      user(`<bash-stdout>${WORDS.rule}</bash-stdout><bash-stderr></bash-stderr>`), ...write('w1'), said(WORDS.done)],
    hook: () => [human(HOOK), ...write('w1'), said(WORDS.done)],
    noResult: () => [ask, call('w1', 'Write', { file_path: FILE, content: BODY }), said(WORDS.done)],
    undoAppend: () => [ask, ...write('w1'), ...undo('e1'), ...bash('b1', `echo "${WORDS.origin}" >> ${PATH}`), said(WORDS.done)],
    undoStash: () => [ask, ...write('w1'), ...undo('e1'), ...bash('b1', 'git stash pop'), said(WORDS.done)],
    commandBetween: () => [ask, ...write('w1'), ...bash('b1', 'npm test'), ...undo('e1'), said(WORDS.done)],
    undoRead: () => [ask, ...write('w1'), ...undo('e1'), ...read('r1'), said(WORDS.done)],
    checkout: () => [ask, ...write('w1'), ...bash('b1', `git checkout -- ${PATH}`), said(WORDS.done)],
    kept: () => [ask, ...edit('e1', `${WORDS.keep}\n\n${WORDS.origin}\n`, `${WORDS.added}\n\n${WORDS.origin}\n`, BODY), said(WORDS.done)],
    copied: () => [ask, ...edit('e1', `${WORDS.origin}\n`, `${WORDS.origin}\n${WORDS.origin}\n`, BODY), said(WORDS.done)],
    plan: () => [ask, call('p1', 'ExitPlanMode', { plan: `${WORDS.plan} ${WORDS.origin}` }),
      result('p1', WORDS.approved, { plan: `${WORDS.plan} ${WORDS.origin}`, isAgent: false }), ...write('w1'), said(WORDS.done)],
  };
  if (!Object.hasOwn(shapes, shape)) throw new Error(`no such shape: ${shape}`);
  return shapes[shape]();
}

const rollout = (payload) => ({ type: 'response_item', timestamp: '2026-10-02T00:00:00Z', payload });
export const CODEX_WORDS = Object.freeze({
  ask: 'Bump the version in package.json. Do not touch package-lock.json, and do not change the "name" field.',
  lock: 'Do not touch package-lock.json',
  name: 'do not change the "name" field',
  added: '"lockfileVersion": 3',
  context: '"name": "pkg"',
  version: '"version": "1.0.1"',
});
/** Codex apply_patch outputs: the native header (codex-rs `format_exec_output_for_model`) with exit 0 or 1, the older
 *  JSON with `metadata.exit_code`, a plain verification failure, and a bare word no native format has. */
export const PATCH_OUTPUTS = Object.freeze({
  native0: 'Exit code: 0\nWall time: 0.1 seconds\nOutput:\nSuccess. Updated the following files:\nM package-lock.json\n',
  native1: 'Exit code: 1\nWall time: 0.1 seconds\nOutput:\napply_patch verification failed: Failed to find expected lines\n',
  json0: JSON.stringify({ output: 'Success. Updated the following files:\nM package-lock.json\n',
    metadata: { exit_code: 0, duration_seconds: 0.0 } }),
  json1: JSON.stringify({ output: 'apply_patch verification failed: Failed to find expected lines',
    metadata: { exit_code: 1, duration_seconds: 0.0 } }),
  failed: 'apply_patch verification failed: Failed to find expected lines in package-lock.json',
  done: 'Done.',
});

/**
 * A Codex rollout: the ask, then one apply_patch whose output is `output` (null: none recorded). `patch`: `lock` (the
 * lockfile it ruled out) or `name` (package.json, the "name" line kept as a context line while the version changes).
 * `command` true: an `npm publish` whose output was never recorded instead of the patch.
 */
export function codexRows({ output = PATCH_OUTPUTS.native0, patch = 'lock', command = false } = {}) {
  const meta = { type: 'session_meta', payload: { id: 'codex-n-0002', cwd: '/repo', cli_version: '0.117.0' } };
  const ask = rollout({ type: 'message', role: 'user', content: [{ type: 'input_text', text: CODEX_WORDS.ask }] });
  const done = rollout({ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'Done.' }] });
  if (command) return [meta, ask, rollout({ type: 'function_call', name: 'exec_command', call_id: 'c1',
    arguments: JSON.stringify({ cmd: 'npm publish --access public' }) }), done];
  const input = patch === 'lock'
    ? `*** Begin Patch\n*** Update File: package-lock.json\n@@\n-  "lockfileVersion": 2\n+  ${CODEX_WORDS.added}\n*** End Patch`
    : `*** Begin Patch\n*** Update File: package.json\n@@\n   ${CODEX_WORDS.context},\n-  "version": "1.0.0",\n+  ${CODEX_WORDS.version},\n*** End Patch`;
  return [meta, ask, rollout({ type: 'custom_tool_call', name: 'apply_patch', call_id: 'p1', input }),
    ...(output === null ? [] : [rollout({ type: 'custom_tool_call_output', call_id: 'p1', output })]), done];
}
