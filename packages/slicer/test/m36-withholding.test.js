// D90 (owner decision 2026-10-15, privacy is not a design constraint): the slicer withholds nothing for privacy. An
// observation, a prior state and a change's recorded hunks are carried whatever file they are of — a credential-shaped
// one (`CREDENTIAL_PATH`, withheld since D68 R) or one in a harness home folder of the recording's user (`~/.claude`,
// `~/.codex`, withheld since D69 b) — so the reviewer sees what the agent saw. What stays is structure: the harness home
// folders as a path rule (`harnessHomePath`, `recordingHome`, `inHarnessHome`, `isHomeFile`), which the code step's
// reader still reads, and the write scope (`homeFolderPath`, `external`): a file in the known home is outside the work
// under review, a project's own `.claude` is in it.
//
// Synthetic recordings and paths only (/srv/x/…, /srv/u/…); no private recording, no model call.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { buildEvents, harnessHomePath, recordingHome } from '../src/events.js';
import { HARNESS_WORKTREES, homeFolderPath, inHarnessHome, isHomeFile } from '../src/before.js';
import { sliceLineage } from '../index.js';
import { redact } from '../../redact/index.js';
import { assertLinear, assertLinearAsync } from '../../redact/test/linear-clock.js';

const CWD = '/srv/x/Acme Labs/repo';
/** The recording's user's home, as `recordingHome` reads it from where the recorder wrote the recording. */
const HOME = '/srv/u';
const OWN = 'thread-own';
const item = (payload) => ({ type: 'response_item', payload });
const event = (payload) => ({ type: 'event_msg', payload });

// A generic (unknown) Claude tool with a recorded text or object input; its result is VISIBLE_RESULT.
const call = (name, input) => ({ kind: 'assistant', adapter: 'claude', raw: { type: 'assistant',
  message: { role: 'assistant', content: [{ type: 'tool_use', id: 'c1', name, input }] } } });
const result = (content = 'VISIBLE_RESULT') => ({ kind: 'user', adapter: 'claude', raw: { type: 'user',
  message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'c1', content }] } } });
const generic = (input, cwd = CWD, home = HOME) => buildEvents([call('FutureInspect', input), result()], { cwd, home }).events[0];
const shown = (e) => e.observationWithheld !== true && Array.isArray(e.tailLines)
  && (e.tailLines.includes('VISIBLE_RESULT') || e.tailLines.includes('VISIBLE_CELL_OUTPUT'));
// A typed Claude Read of `path`.
const read = (path, cwd = CWD, home = HOME) => buildEvents([call('Read', { file_path: path }), result()], { cwd, home }).events[0];

// One Codex code cell (the paginated `exec` wrapper) whose script is `script`; its own output is VISIBLE.
async function cell(t, script, cwd = CWD) {
  const dir = await mkdtemp(join(tmpdir(), 'sonah-m36-withholding-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  // Where Codex writes a rollout (`<home>/.codex/sessions/<y>/<m>/<d>/`): the slicer reads the recording's home from it.
  const sessions = join(dir, 'home', '.codex', 'sessions', '2026', '10', '07');
  await mkdir(sessions, { recursive: true });
  const file = join(sessions, 'rollout-2026-10-07T10-00-00-synthetic.jsonl');
  const rows = [{ type: 'session_meta', payload: { id: OWN, cwd } },
    event({ type: 'task_started', turn_id: 't1', model_context_window: 1 }),
    item({ type: 'message', role: 'user', content: 'Inspect.' }),
    event({ type: 'item_completed', thread_id: OWN, turn_id: 't1', item: { id: 'm1', type: 'AgentMessage' } }),
    item({ type: 'custom_tool_call', name: 'exec', call_id: 'w1', input: script }),
    item({ type: 'custom_tool_call_output', call_id: 'w1',
      output: ['Script completed', 'VISIBLE_CELL_OUTPUT'].map((text) => ({ type: 'input_text', text })) })];
  await writeFile(file, rows.map((row) => JSON.stringify(row)).join('\n') + '\n');
  const ledger = await sliceLineage([file]);
  const cells = ledger.ledger.filter((e) => e.provenance === 'codex_code_cell');
  assert.equal(cells.length, 1);
  return cells[0];
}
const exec = (cmd) => `text(await tools.exec_command({cmd:${JSON.stringify(cmd)}}));`;

test('D69 (b): the harness home folders are the recording\'s user\'s ~/.claude and ~/.codex, outside a worktree', () => {
  const place = { home: HOME, cwd: CWD };
  for (const path of ['/srv/u/.claude/settings.json', '/srv/u/.claude/projects/p/s.jsonl', '~/.claude', '~/.claude/CLAUDE.md',
    '/srv/u/.codex/sessions/r.jsonl', '/srv/u/.codex/auth.json', '~/.codex/config.toml', '$HOME/.codex/auth.json',
    '${HOME}/.claude/x', '/srv/u/x/../.claude/settings.json']) assert.equal(harnessHomePath(path, place), true, path);
  for (const path of [`${CWD}/.claude/settings.local.json`, '.claude/commands/run.md', `${CWD}/.codex/config.toml`,
    `${CWD}/.claude/worktrees/feature/src/a.js`, '/srv/u/.claude/worktrees/w/a.js', '/srv/u/.codex/worktrees/1/repo/a.js',
    '/srv/x/repo/.claude-plugin/a.json', '/srv/x/repo/src/.claudeignore', '/srv/x/claude/a.md',
    '/srv/u/notes.md', '~/notes.md', 42, null]) assert.equal(harnessHomePath(path, place), false, String(path));
  // D69 review (F5): a harness folder outside the recorder's cwd is never the project's own — another home's (a
  // devcontainer's `/root`, recorded under the host's home), another project's — held though the home is known.
  for (const path of ['/srv/other/.claude/x', '/root/.claude/settings.json', '/root/.codex/auth.json',
    '/srv/x/Acme Labs/repo2/.claude/settings.json', '/srv/x/Acme Labs/repo-old/.codex/config.toml'])
    assert.equal(harnessHomePath(path, place), true, path);
  // The write scope reads the known home only: never another home's or a project's folder, never fails closed.
  for (const path of ['/srv/u/.claude/settings.json', '~/.codex/auth.json', '$HOME/.claude/x'])
    assert.equal(homeFolderPath(path, place), true, path);
  for (const path of ['/root/.claude/settings.json', `${CWD}/.claude/settings.json`, '.claude/commands/run.md',
    '/srv/u/.claude/worktrees/w/a.js']) assert.equal(homeFolderPath(path, place), false, path);
  for (const path of [`${CWD}/.claude/settings.json`, '.claude/commands/run.md', '/srv/u/.codex/auth.json'])
    assert.equal(homeFolderPath(path, { cwd: CWD }), false, `${path}: the home unknown`);
  // The recorder's cwd is the home: its `.claude` IS the home's.
  assert.equal(harnessHomePath('.claude/settings.json', { home: HOME, cwd: HOME }), true);
  // Windows spellings.
  assert.equal(harnessHomePath('C:\\Profiles\\u\\.claude\\settings.json', { home: 'C:/Profiles/u' }), true);
  // The home unknown: every `.claude` and `.codex` directory outside a worktree is held (fails closed).
  for (const path of ['/srv/x/repo/.claude/settings.local.json', '.claude/commands/run.md', '/srv/u/.codex/sessions/r.jsonl',
    'C:\\Profiles\\u\\.claude\\settings.json', '/srv/other/.claude/x']) assert.equal(harnessHomePath(path, { cwd: CWD }), true, path);
  for (const path of ['/srv/x/repo/.claude/worktrees/feature/src/a.js', '/srv/x/repo/src/.claudeignore'])
    assert.equal(harnessHomePath(path, { cwd: CWD }), false, path);
});

test('the fourth review of the code step: Claude Code\'s ~/.claude.json and its backups are harness home paths by the documented list', () => {
  // The harness files a harness keeps in the home folder itself, beside its home folder: a formal list of the harness's
  // own names (Claude Code's state file and the backups it writes beside it), never a fitted pattern.
  for (const name of ['.claude.json', '.claude.json.backup', '.claude.json.backup.1712345678901'])
    assert.equal(isHomeFile(name), true, name);
  for (const name of ['.claude', 'claude.json', '.claude.jsonl', '.claude.json-old', '.claude.json.bak', '.codex.json',
    'x.claude.json', '', null, 42]) assert.equal(isHomeFile(name), false, String(name));
  const place = { home: HOME, cwd: CWD };
  for (const path of ['/srv/u/.claude.json', '~/.claude.json', '$HOME/.claude.json.backup', '${HOME}/.claude.json.backup.1',
    '/srv/u/.claude.json.backup.1712345678901', '/root/.claude.json', '/srv/other/.claude.json.backup'])
    assert.equal(harnessHomePath(path, place), true, path);
  // Only the home folder's own: a project file of the same name under the cwd is the project's, once the home is known.
  for (const path of [`${CWD}/.claude.json`, '.claude.json', '/srv/u/x.claude.json', '~/.claude.jsonl', '~/.claude.json.bak'])
    assert.equal(harnessHomePath(path, place), false, path);
  // The recorder's cwd is the home (a dotfiles repository): its `.claude.json` IS the home's; the home unknown, held.
  assert.equal(harnessHomePath('.claude.json', { home: HOME, cwd: HOME }), true);
  assert.equal(harnessHomePath('.claude.json.backup', { cwd: CWD }), true);
  assert.equal(harnessHomePath(`${CWD}/sub/.claude.json`, { cwd: CWD }), true);
  // The write scope reads the known home's: its own state file is outside the work under review.
  assert.equal(homeFolderPath('/srv/u/.claude.json', place), true);
  assert.equal(homeFolderPath('~/.claude.json.backup', place), true);
  assert.equal(homeFolderPath(`${CWD}/.claude.json`, place), false);
  // D90: a typed read of it is shown, and outside the work; a generic tool's too.
  const e = read('/srv/u/.claude.json');
  assert.equal(shown(e), true);
  assert.equal(e.external, true);
  assert.equal(shown(generic({ path: '~/.claude.json' })), true);
  assert.equal(shown(generic({ path: `${CWD}/notes/claude.json` })), true);
});

test('D69 (b): the worktree exemption is one exported rule, the one every harness-home check here reads', () => {
  // The code pass's reader applies `inHarnessHome` to a home this computer names (cli/src/code-snapshot.js): it must
  // say what the slicer says of the same path under the recording's ~/.claude and ~/.codex, known home or not.
  assert.equal(HARNESS_WORKTREES, 'worktrees');
  for (const rest of ['', 'settings.json', 'projects/p/s.jsonl', 'worktrees', 'worktrees/', 'worktrees/w/a.js',
    'worktrees-old/a.js', 'projects/worktrees/a.js', 'Worktrees/a.js'])
    for (const folder of ['.claude', '.codex']) {
      const path = rest ? `${HOME}/${folder}/${rest}` : `${HOME}/${folder}`;
      assert.equal(harnessHomePath(path, { home: HOME, cwd: CWD }), inHarnessHome(rest), path);
      assert.equal(harnessHomePath(path, { cwd: CWD }), inHarnessHome(rest), `${path}: no home`);
      assert.equal(homeFolderPath(path, { home: HOME }), inHarnessHome(rest), `${path}: scope`);
    }
  assert.deepEqual(['', 'settings.json', 'worktrees', 'worktrees/w/a.js', 'worktrees-old/a.js', 'projects/worktrees/a.js']
    .map(inHarnessHome), [true, true, false, false, true, true]);
});

test('D69 (b): the recording\'s home is read from where its recorder wrote it, or not at all', () => {
  assert.equal(recordingHome(['/srv/u/.claude/projects/-srv-x-repo/s.jsonl']), HOME);
  assert.equal(recordingHome(['/srv/u/.claude/projects/-srv-x-repo/s/subagents/agent-a1.jsonl']), HOME);
  assert.equal(recordingHome(['/srv/u/.codex/sessions/2026/10/08/rollout-x.jsonl']), HOME);
  assert.equal(recordingHome(['/srv/u/.codex/archived_sessions/rollout-x.jsonl']), HOME);
  assert.equal(recordingHome(['/srv/u/.claude/projects/p/a.jsonl', '/srv/u/.claude/projects/p/b.jsonl']), HOME);
  for (const files of [['/tmp/copy/s.jsonl'], ['corpus/golden/d01.jsonl'], ['refs/entire/checkpoints/v1:ab/full.jsonl'],
    ['/srv/u/.claude/projects/p/a.jsonl', '/srv/v/.claude/projects/p/b.jsonl'], [], null, [42]])
    assert.equal(recordingHome(files), null, JSON.stringify(files));
});

test('D90: a typed read of a credential file or a harness home folder is shown; the write scope is unchanged', () => {
  for (const path of [`${CWD}/.env`, `${CWD}/config/id_rsa`, '/srv/u/.claude/settings.json',
    '/srv/u/.claude/projects/p/other-session.jsonl', '~/.claude/memory/notes.md', '/srv/u/.codex/sessions/r.jsonl',
    '~/.codex/auth.json', '/root/.claude/settings.json']) {
    const e = read(path);
    assert.equal(shown(e), true, path);
    assert.equal(e.observationWithheld, undefined, path);
  }
  for (const path of ['/etc/hosts', '/srv/x/Acme Labs2/repo/a.js', `${CWD}/../secret.txt`, '../other/a.js',
    '~/notes.md', '/private/tmp/claude-501/p/s/scratchpad/plan.md', '/tmp/scratch/scratchpad/x.md',
    '/srv/u/.claude/settings.json', '~/.codex/auth.json', '/root/.claude/settings.json']) {
    const e = read(path);
    assert.equal(shown(e), true, path);
    assert.equal(e.external, true, `${path}: outside the write scope all the same`);
  }
  // A project's own `.claude` directory, a credential-shaped file of the project and a harness worktree: shown, and in
  // the work under review — the home known or not.
  for (const [path, home] of [[`${CWD}/.claude/settings.json`, HOME], ['.claude/commands/run.md', HOME],
    [`${CWD}/.env`, HOME], [`${CWD}/.claude/worktrees/feature/src/a.js`, HOME], [`${CWD}/.claude/settings.json`, null],
    ['.claude/commands/run.md', null]]) {
    const e = read(path, CWD, home);
    assert.equal(shown(e), true, path);
    assert.equal(e.external, undefined, path);
  }
  assert.equal(read('/srv/u/.codex/sessions/r.jsonl', CWD, null).external, true);
  assert.equal(read('/root/.claude/settings.json').path, '/root/.claude/settings.json', 'spelled as recorded (F7)');
});

test('D90: a generic tool\'s output is shown whatever its input names', () => {
  for (const input of [{ path: `${CWD}/.env` }, { path: '/srv/u/.claude/settings.json' }, { path: '/srv/u/.codex/auth.json' },
    { file_path: '~/.claude/projects/p/s.jsonl' }, { query: 'q', cwd: '/srv/u/.claude' },
    { url: 'file:///srv/u/.claude/CLAUDE.md' }, 'cat /a/b/id_ed25519', JSON.stringify({ path: '/srv/u/.claude/x.md' }),
    { paths: ['/srv/u/.claude/.credentials.json'] }, { target: { files: [`${CWD}/src/a.js`, `${CWD}/deploy/key.pem`] } },
    'cat ~/.codex/config.toml', 'cat $HOME/.claude/settings.json', { args: ['--config=${HOME}/.claude/settings.json'] },
    { path: '/outside/private.txt' }, 'cat /etc/hosts', { path: `${CWD}/.claude/settings.json` }]) {
    const e = generic(input);
    assert.equal(shown(e), true, JSON.stringify(input).replaceAll(CWD, '<cwd>'));
    assert.equal(e._genericSensitiveOutput, undefined, 'no transient of a withholding rule is left on the event');
  }
});

test('D90: a Codex code cell\'s output is shown whatever its script names', async (t) => {
  for (const script of [`text(await tools.exec_command({cmd:"ls",workdir:"~/.codex"}));`,
    `text(await tools.view_image({path:${JSON.stringify(`${CWD}/deploy/key.pem`)}}));`,
    ...[`cat '${CWD}/notes dir/.env'`, 'cat ~/.claude/settings.json', 'cat ~/.codex/auth.json',
      `sed -n 1,5p '${CWD}/src/a.js'`].map(exec)]) {
    const e = await cell(t, script);
    assert.equal(shown(e), true, script.replaceAll(CWD, '<cwd>'));
    assert.equal(e.cellStrings, undefined, 'the script\'s strings are read for nothing, and carried nowhere');
  }
});

// A Codex command the recorder typed (`parsed_cmd`) as reading, searching or listing a file.
async function commands(t, list, cwd = CWD) {
  const dir = await mkdtemp(join(tmpdir(), 'sonah-m36-withholding-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const items = typeof list === 'function' ? list(join(dir, 'home')) : list;
  const sessions = join(dir, 'home', '.codex', 'sessions', '2026', '10', '08');
  await mkdir(sessions, { recursive: true });
  const file = join(sessions, 'rollout-2026-10-08T10-00-00-synthetic.jsonl');
  const rows = [{ type: 'session_meta', payload: { id: OWN, cwd } },
    event({ type: 'task_started', turn_id: 't1', model_context_window: 1 }),
    item({ type: 'message', role: 'user', content: 'Inspect.' }),
    event({ type: 'item_completed', thread_id: OWN, turn_id: 't1', item: { id: 'm1', type: 'AgentMessage' } }),
    ...items.map(([id, script, parsed, at = cwd]) => event({ type: 'item_completed', thread_id: OWN, turn_id: 't1',
      item: { id, type: 'CommandExecution', status: 'completed', source: 'unified_exec_startup',
        command: ['/bin/zsh', '-lc', script], cwd: pathToFileURL(at).href, exit_code: 0,
        aggregated_output: 'VISIBLE_RESULT', parsed_cmd: parsed, process_id: '1', duration: { secs: 0, nanos: 1 } } }))];
  await writeFile(file, rows.map((row) => JSON.stringify(row)).join('\n') + '\n');
  return { ledger: await sliceLineage([file]), home: join(dir, 'home') };
}

test('D90: a Codex command typed as reading a credential file or a harness home folder has its output shown', async (t) => {
  const { ledger } = await commands(t, [
    ['r1', 'cat ~/.codex/auth.json', [{ type: 'read', cmd: 'cat ~/.codex/auth.json', name: 'auth.json', path: '~/.codex/auth.json' }]],
    ['r3', 'rg token .', [{ type: 'search', cmd: 'rg token .', query: 'token', path: '.claude' }], '/srv/u'],
    ['r4', 'cat .env', [{ type: 'read', cmd: 'cat .env', name: '.env', path: '.env' }]]]);
  const commandsRun = ledger.ledger.filter((e) => e.kind === 'bash');
  assert.equal(commandsRun.length, 3);
  for (const e of commandsRun) assert.equal(shown(e), true, e.cmd);
});

test('linear: a 2 MB generic input is read in well under a second of CPU', () => {
  const text = Array.from({ length: 40_000 }, (_, i) => `cat '${CWD}/dir ${i}/file ${i}.txt'`).join('\n');
  const values = Array.from({ length: 40_000 }, (_, i) => `${CWD}/dir ${i}/file ${i}.txt`);
  // 1 s of CPU, scaled by the slowdown measured under load (linear-clock.js), never a wall-clock limit.
  assertLinear(() => {
    assert.equal(shown(generic(text)), true);
    assert.equal(shown(generic({ files: values })), true);
    assert.equal(shown(generic({ files: [...values, '~/.claude/settings.json'] })), true);
  }, 1000, 'a 2 MB generic input');
});

test('linear (M36 review): a 1 MB backslash run, and `/.env.` runs before a line break, in every reader', async (t) => {
  const M = 1 << 20;
  const backslashes = '\\'.repeat(M) + 'x';
  // A value is read whole as a path: `/.env.` runs, then a break and a last line (D69 review: no word of it is a
  // candidate of its own any more; the whole value's last line names no credential, so it is shown).
  const envRuns = `${'/.env.'.repeat(M / 6)}\nx`;
  // The quadratic readers took minutes here (1 MB of backslashes: about 25 minutes extrapolated from 160k at 39 s).
  // 4 s of CPU each, scaled by the slowdown measured under load (linear-clock.js), never a wall-clock limit.
  const inputs = [{ path: backslashes }, { url: backslashes }, backslashes, { nested: { file_path: backslashes } },
    { path: envRuns }, { nested: { file_path: envRuns } }];
  for (const [i, input] of inputs.entries()) {
    assertLinear(() => assert.equal(shown(generic(input)), true), 4000, `generic input ${i + 1} of ${inputs.length}`);
  }
  const script = `text(${JSON.stringify(backslashes)});`;
  await assertLinearAsync(async () => assert.equal(shown(await cell(t, script)), true), 4000, 'a code cell');
  // D90: whatever a value names, the output is shown.
  assert.equal(shown(generic({ path: 'notes\n/repo/.env' })), true);
  assert.equal(shown(generic({ path: '.env\nnotes' })), true);
});

// ---- D90: what an edit records of a credential file or a harness home file is carried --------------------------------

// A Claude Code main-thread call and its result with a typed sidecar.
const sideCall = (id, name, input) => ({ kind: 'assistant', adapter: 'claude', raw: { type: 'assistant',
  message: { role: 'assistant', content: [{ type: 'tool_use', id, name, input }] } } });
const sideResult = (id, sidecar) => ({ kind: 'user', adapter: 'claude', raw: { type: 'user', toolUseResult: sidecar,
  message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content: 'The file has been updated.' }] } } });
const hunk = (lines) => ({ oldStart: 1, oldLines: lines.filter((l) => l[0] !== '+').length, newStart: 1,
  newLines: lines.filter((l) => l[0] !== '-').length, lines });
const CONTEXT = 'UNCHANGED_CONTEXT_LINE_OF_THE_FILE';
const REMOVED = 'REMOVED_LINE_OF_THE_FILE';
const ORIGINAL = [`a=${CONTEXT}`, `b=${REMOVED}`, 'c=3', ''].join('\n');
const HUNKS = [hunk([` a=${CONTEXT}`, `-b=${REMOVED}`, '+b=2', ' c=3'])];
const slicedClean = (rows, home = HOME) => redact({ ask: [], claim: { finalMessage: '' }, dropped: [],
  ledger: buildEvents(rows, { cwd: CWD, home }).events }).ledger;

test('D90: every file\'s recorded hunks are carried: an Edit, a Write update, a command\'s bashEditDiff', () => {
  for (const path of [`${CWD}/.env`, `${CWD}/config/secrets.yaml`, '/srv/u/.claude/settings.json', '/srv/u/.codex/config.toml',
    `${CWD}/src/a.js`, `${CWD}/.claude/settings.local.json`]) {
    for (const [name, input, sidecar] of [
      ['Edit', { file_path: path, old_string: `b=${REMOVED}`, new_string: 'b=2' },
        { filePath: path, oldString: `b=${REMOVED}`, newString: 'b=2', originalFile: ORIGINAL, structuredPatch: HUNKS }],
      ['Write', { file_path: path, content: ORIGINAL.replace(`b=${REMOVED}`, 'b=2') },
        { type: 'update', filePath: path, content: ORIGINAL.replace(`b=${REMOVED}`, 'b=2'), originalFile: ORIGINAL,
          structuredPatch: HUNKS }]]) {
      for (const home of [HOME, null]) {
        const [edit] = slicedClean([sideCall('e1', name, input), sideResult('e1', sidecar)], home).ledger;
        assert.equal(edit.recorded.hunksWithheld, undefined, `${name} ${path}`);
        assert.deepEqual(edit.recorded.hunks[0].lines, [` a=${CONTEXT}`, `-b=${REMOVED}`, '+b=2', ' c=3'], `${name} ${path}`);
      }
    }
  }
  const ledger = slicedClean([sideCall('b1', 'Bash', { command: 'node fix.js' }), sideResult('b1', { stdout: '',
    stderr: '', interrupted: false, isImage: false, noOutputExpected: true, bashEditDiff: { files: [
      { filePath: '/srv/u/.claude/settings.json', hunks: HUNKS }, { filePath: `${CWD}/.env`, hunks: HUNKS }] } })]);
  const files = ledger.ledger[0].recorded.editDiff.files;
  // D69 review (F7): a file outside the recorder's cwd keeps its spelling as recorded.
  assert.deepEqual(files.map((file) => [file.path, file.hunksWithheld, file.hunks[0].lines.length]),
    [['/srv/u/.claude/settings.json', undefined, 4], ['.env', undefined, 4]]);
});

test('D90: every file\'s prior state is kept, wherever its path is spelled; the write scope still decides', () => {
  for (const [path, home] of [['.claude/settings.json', null], ['.claude/settings.json', HOME], ['.env', HOME]]) {
    const rows = [sideCall('e1', 'Edit', { file_path: path, old_string: 'x', new_string: 'y' }),
      sideResult('e1', { filePath: path, originalFile: ORIGINAL })];
    assert.equal(slicedClean(rows, home).ledger[0].before.source, 'original', `${path}, home ${home}`);
  }
  // The recorder's cwd is the home: the relative `.claude` path is the home's — outside the work under review (D69 review
  // F5: the write scope reads every spelling), so no prior state is attached at all: a scope rule, not a withholding.
  const rows = [sideCall('e1', 'Edit', { file_path: '.claude/settings.json', old_string: 'x', new_string: 'y' }),
    sideResult('e1', { filePath: '.claude/settings.json', originalFile: ORIGINAL })];
  const home = redact({ ask: [], claim: { finalMessage: '' }, dropped: [],
    ledger: buildEvents(rows, { cwd: HOME, home: HOME }).events }).ledger;
  assert.equal(home.ledger[0].external, true);
  assert.equal(home.ledger[0].before, undefined);
});

test('D90: a Codex change of a project .claude file carries its hunk lines, the home known or not', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'sonah-m36-withholding-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const rows = [{ type: 'session_meta', payload: { id: OWN, cwd: CWD } },
    event({ type: 'task_started', turn_id: 't1', model_context_window: 1 }),
    item({ type: 'message', role: 'user', content: 'Tune.' }),
    event({ type: 'item_completed', thread_id: OWN, turn_id: 't1', item: { id: 'f1', type: 'FileChange',
      status: 'completed', changes: { [`${CWD}/.claude/agents/a.md`]: { type: 'update', move_path: null,
        unified_diff: `@@ -1,3 +1,3 @@\n a=${CONTEXT}\n-b=${REMOVED}\n+b=2\n c=3\n` } } } })];
  const sliceAt = async (folder) => {
    await mkdir(folder, { recursive: true });
    const file = join(folder, 'rollout-2026-10-07T10-00-00-synthetic.jsonl');
    await writeFile(file, rows.map((row) => JSON.stringify(row)).join('\n') + '\n');
    return (await sliceLineage([file])).ledger.find((e) => e.kind === 'edit');
  };
  for (const folder of [join(dir, 'copy'), join(dir, 'home', '.codex', 'sessions', '2026', '10', '07')]) {
    const change = await sliceAt(folder);
    assert.equal(change.recorded.hunksWithheld, undefined);
    assert.equal(change.recorded.hunks[0].lines[0], ` a=${CONTEXT}`);
  }
});
