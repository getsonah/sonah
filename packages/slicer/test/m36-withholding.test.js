// D68 (R) (owner decision 2026-10-07; C-02 "M36 withholding narrowed"). An observation is withheld only when it is a
// credential-shaped file's (`CREDENTIAL_PATH`) or, D69 (b) (owner decision 2026-10-08; C-02 "D69 the harness home
// folders"), in a harness home folder of the recording's user (`~/.claude`, `~/.codex`, outside a harness worktree:
// settings, credentials, memory, other sessions' transcripts). A project's own `.claude` directory is shown. The home is
// read from where the recorder wrote the recording (`recordingHome`) or a home-relative path; unknown, every `.claude`
// and `.codex` directory outside a worktree is held (fails closed). Lying outside the session folder or in a scratchpad
// is no reason: those outputs are shown, and `external` still marks the write scope. The location rule a generic tool's
// input was read by (`cwdAnchoredPaths`, the M33 refreeze lanes g3/g4) is deleted.
// D69 review: a `.claude` or `.codex` directory outside the recorder's cwd is held whether or not the
// home is known (F5); the write scope reads the known home only (`homeFolderPath`); a generic tool's recorded input is
// read by its grammar, every value whole at any depth under any key (F4) — the free-text tokenizer and the key list are
// deleted — a code cell's by the inner calls the JavaScript grammar reads from it; a Codex command's output is withheld
// by the recorder's typed reading of it (`parsed_cmd`, F3).
//
// Synthetic recordings and paths only (/srv/x/…, /srv/u/…); no private recording, no model call.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { buildEvents, harnessHomePath, recordingHome } from '../src/events.js';
import { HARNESS_WORKTREES, homeFolderPath, inHarnessHome, isHomeFile, namesHomeFolder } from '../src/before.js';
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
const withheld = (e) => e.observationWithheld === true && e.tailLines === undefined;
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
  // Named in a free text, as a whole name (a backup's continuation too), withheld; another name that starts like it is not.
  for (const text of ['cat ~/.claude.json', 'jq . $HOME/.claude.json | head', 'cp ~/.claude.json.backup.17 /tmp/x',
    'cat /srv/u/.claude.json']) assert.equal(namesHomeFolder(text, place), true, text);
  for (const text of ['cat ~/.claude.jsonl', 'cat ~/.claude.json-old', 'cat /data/srv/u/.claude.json', 'cat ~/x.claude.json'])
    assert.equal(namesHomeFolder(text, place), false, text);
  // A typed read of it: withheld, and outside the work.
  const e = read('/srv/u/.claude.json');
  assert.equal(withheld(e), true);
  assert.equal(e.external, true);
  assert.equal(withheld(generic({ path: '~/.claude.json' })), true);
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

test('a typed read: credential files and the home folders withheld; a project .claude, outside folders and scratchpads shown', () => {
  for (const path of [`${CWD}/.env`, `${CWD}/config/id_rsa`, '/srv/u/.claude/settings.json',
    '/srv/u/.claude/projects/p/other-session.jsonl', '~/.claude/memory/notes.md', '/srv/u/.codex/sessions/r.jsonl',
    '~/.codex/auth.json']) {
    assert.equal(withheld(read(path)), true, path);
  }
  for (const path of ['/etc/hosts', '/srv/x/Acme Labs2/repo/a.js', `${CWD}/../secret.txt`, '../other/a.js',
    '~/notes.md', '/private/tmp/claude-501/p/s/scratchpad/plan.md', '/tmp/scratch/scratchpad/x.md']) {
    const e = read(path);
    assert.equal(shown(e), true, path);
    assert.equal(e.external, true, `${path}: outside the write scope all the same`);
  }
  // A project's own `.claude` directory is not a home folder: shown, and in the work under review.
  for (const path of [`${CWD}/.claude/settings.json`, '.claude/commands/run.md']) {
    const e = read(path);
    assert.equal(shown(e), true, path);
    assert.equal(e.external, undefined, path);
  }
  // A harness worktree is the project under review: shown, and not external.
  const worktree = read(`${CWD}/.claude/worktrees/feature/src/a.js`);
  assert.equal(shown(worktree), true);
  assert.equal(worktree.external, undefined);
  // The home unknown (a copied recording): every `.claude` and `.codex` directory is held, a project's own too.
  for (const path of [`${CWD}/.claude/settings.json`, '/srv/u/.codex/sessions/r.jsonl'])
    assert.equal(withheld(read(path, CWD, null)), true, path);
  // D69 review (F5): held, but a project's own `.claude` stays work under review (the write scope reads the known home
  // only); a folder outside the cwd is outside it by the cwd rule alone.
  assert.equal(read(`${CWD}/.claude/settings.json`, CWD, null).external, undefined);
  assert.equal(read('.claude/commands/run.md', CWD, null).external, undefined);
  assert.equal(read('/srv/u/.codex/sessions/r.jsonl', CWD, null).external, true);
  // Another home's harness folder (a devcontainer's `/root`, the recording under the host's home): held and outside.
  const other = read('/root/.claude/settings.json');
  assert.equal(withheld(other), true);
  assert.equal(other.external, true);
  assert.equal(other.path, '/root/.claude/settings.json', 'spelled as recorded (F7)');
});

test('a generic tool: withheld only when a value its input records is a credential file or a harness home folder', () => {
  for (const input of [{ path: `${CWD}/.env` }, { path: '/srv/u/.claude/settings.json' }, { path: '/srv/u/.codex/auth.json' },
    { file_path: '~/.claude/projects/p/s.jsonl' }, { query: 'q', cwd: '/srv/u/.claude' },
    { url: 'file:///srv/u/.claude/CLAUDE.md' }, { url: 'file:///srv/u/%2Eclaude/CLAUDE.md' }, 'cat /a/b/id_ed25519',
    JSON.stringify({ path: '/srv/u/.claude/x.md' }), '~/.codex/auth.json',
    // D69 review (F4): every value, at any depth, under any key — no key vocabulary, no first level only.
    { query: 'what is ~/.claude', note: '/srv/u/.claude/x' }, { paths: ['/srv/u/.claude/.credentials.json'] },
    { filepath: '/srv/u/.codex/auth.json' }, { a: { b: [{ c: '~/.codex/auth.json' }] } },
    { target: { files: [`${CWD}/src/a.js`, `${CWD}/deploy/key.pem`] } },
    // A value that names a harness home folder literally (`namesHomeFolder`: the home's own spelling, or the shell's
    // `~`, `$HOME`, `${HOME}`), however the text around it is cut — inside a command, a program, an option.
    'cat ~/.codex/config.toml', 'ls ~/.claude/projects', 'cat $HOME/.claude/settings.json',
    { command: 'cat ~/.codex/auth.json' }, { script: 'print(open("/srv/u/.codex/sessions/r.jsonl").read())' },
    { args: ['--config=${HOME}/.claude/settings.json'] }, 'tail -n 5 "/srv/u/.codex"']) {
    assert.equal(withheld(generic(input)), true, JSON.stringify(input).replaceAll(CWD, '<cwd>'));
  }
  for (const input of [{ path: '/outside/private.txt' }, { workdir: '/srv/x/Acme Other/src' },
    { path: `${CWD}/../b.js` }, `cat ${CWD}/src/../../b.js`, 'cat /etc/hosts', `diff ${CWD}/a.js /etc/hosts`,
    'ls ~/', { path: `${CWD}/.claude/worktrees/w/a.js` }, 'const v = obj.key; process.env.HOME',
    { path: `${CWD}/.claude/settings.json` }, `cat ${CWD}/.claude/commands/run.md`,
    // D69 review (F3): free text of no declared grammar is not cut into "path-like" words (the tokenizer is deleted): a
    // credential-shaped name inside a command is no recorded path of a generic tool; a home folder the text computes is
    // named by none of its spellings; a project's or another name that merely starts like a harness folder is none.
    `cat "${CWD}/notes dir/.env"`, `cat '${CWD}/notes dir/deploy key.pem'`, `cat \\"${CWD}/.env\\"`,
    'cat "$(echo ~)/.codex/auth.json"', 'cat ~/.claude-backup/settings.json', 'cat ~/.codexrc',
    'ls /srv/u/.claude/worktrees/w/src', `cat ${CWD}/.claude/settings.json`, 'cat /data/srv/u/.claude/x']) {
    assert.equal(shown(generic(input)), true, JSON.stringify(input).replaceAll(CWD, '<cwd>'));
  }
});

test('a Codex code cell: the same rule over the inner calls its script records, read by their grammars', async (t) => {
  // D69 review (F3): a code cell is a generic tool, withheld by what its input names (D68 R), read by grammars instead of
  // the deleted tokenizer: the inner calls the JavaScript grammar reads from its script (codex-exec.js `readExecCalls`) —
  // each call's recorded values whole — and an inner command call's command line by the shell grammar (`lexShell`):
  // each word whole, quotes removed.
  for (const script of [`text(await tools.exec_command({cmd:"ls",workdir:"~/.codex"}));`,
    `text(await tools.exec_command({cmd:"cat a",workdir:"/srv/x/other/.claude"}));`,
    `text(await tools.view_image({path:${JSON.stringify(`${CWD}/deploy/key.pem`)}}));`,
    ...[`cat '${CWD}/notes dir/.env'`, `cat ${CWD}/.env; ls`, 'cat ~/.claude/settings.json', 'cat ~/.codex/auth.json',
      'sed -n 1,80p "$HOME/.codex/sessions/r.jsonl"', 'rg token ~/.claude/projects | head'].map(exec)]) {
    assert.equal(withheld(await cell(t, script)), true, script.replaceAll(CWD, '<cwd>'));
  }
  // A word is a path only as the command names it: a path the shell or a program computes is not read (the formal
  // grammar's limit, said so); a project's own `.claude` and every other file are shown.
  for (const cmd of [`sed -n 1,5p '${CWD}/src/a.js'`, 'cat /etc/hosts', `cat '${CWD}/../other/a.js'`,
    'ls /srv/x/Acme Labs2/repo', `cat /private/tmp/claude-501/p/s/scratchpad/plan.md`, `cat '${CWD}/.claude/agents/a.md'`,
    'cat "$(echo ~)/.codex/auth.json"', "python3 -c 'print(open(\"/x/.env\").read())'"]) {
    assert.equal(shown(await cell(t, exec(cmd))), true, cmd.replaceAll(CWD, '<cwd>'));
  }
});

// D69 review (F3): a Codex command the recorder typed (`parsed_cmd`) as reading, searching or listing a withheld file.
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

test('D69 review F3: a Codex command typed as reading a withheld file has its output withheld; its words decide nothing', async (t) => {
  const { ledger, home } = await commands(t, [
    ['r1', 'cat ~/.codex/auth.json', [{ type: 'read', cmd: 'cat ~/.codex/auth.json', name: 'auth.json', path: '~/.codex/auth.json' }]],
    ['r2', 'sed -n 1,9p x', [{ type: 'read', cmd: 'sed -n 1,9p x', name: 'x', path: 'x' }]],
    ['r3', 'rg token .', [{ type: 'search', cmd: 'rg token .', query: 'token', path: '.claude' }], '/srv/u'],
    ['r4', 'cat .env', [{ type: 'read', cmd: 'cat .env', name: '.env', path: '.env' }]],
    ['r5', 'ls', [{ type: 'list_files', cmd: 'ls', path: null }]],
    ['r6', 'cat ~/.codex/auth.json | head', [{ type: 'unknown', cmd: 'cat ~/.codex/auth.json | head' }]]]);
  const byId = (id) => ledger.ledger.find((e) => e.kind === 'bash' && e.cmd?.startsWith({ r1: 'cat ~/.codex', r2: 'sed',
    r3: 'rg', r4: 'cat .env', r5: 'ls', r6: 'cat ~/.codex/auth.json |' }[id]));
  assert.equal(withheld(byId('r1')), true, 'a typed read of ~/.codex/auth.json');
  assert.equal(shown(byId('r2')), true, 'a typed read of a project file');
  assert.equal(withheld(byId('r4')), true, 'a typed read of a credential-shaped file');
  assert.equal(shown(byId('r5')), true, 'no typed path');
  assert.equal(shown(byId('r6')), true, 'a command the recorder typed no reading of: its words decide nothing');
  // A relative typed path is the command's own working directory's: under a command run in the home, `.claude` is the
  // home's (the cwd of the session is elsewhere).
  assert.equal(typeof home, 'string');
  const atHome = await commands(t, (at) => [['s1', 'rg token .claude', [{ type: 'search', cmd: 'rg token .claude',
    query: 'token', path: '.claude' }], at]]);
  const searched = atHome.ledger.ledger.find((e) => e.kind === 'bash');
  assert.equal(withheld(searched), true, 'a search under the home\'s .claude, from the command\'s own workdir');
  // A `.claude` folder outside the session's cwd is held, whatever home it is (F5), under any command's workdir.
  assert.equal(withheld(byId('r3')), true, 'a search of a .claude folder outside the cwd');
});

test('linear: a 2 MB generic input is read in well under a second of CPU', () => {
  const text = Array.from({ length: 40_000 }, (_, i) => `cat '${CWD}/dir ${i}/file ${i}.txt'`).join('\n');
  const values = Array.from({ length: 40_000 }, (_, i) => `${CWD}/dir ${i}/file ${i}.txt`);
  // 1 s of CPU, scaled by the slowdown measured under load (linear-clock.js), never a wall-clock limit.
  assertLinear(() => {
    assert.equal(shown(generic(text)), true);
    assert.equal(shown(generic({ files: values })), true);
    assert.equal(withheld(generic({ files: [...values, '~/.claude/settings.json'] })), true);
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
  // The verdict is the pattern's own, line break or not.
  assert.equal(withheld(generic({ path: 'notes\n/repo/.env' })), true);
  assert.equal(withheld(generic({ path: '.env\nnotes' })), false);
});

// ---- D68 (R) for what an edit records of a withheld file (M36 review) ---------------------------------------------

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

test('a withheld file\'s recorded hunks carry no line: an Edit, a Write update, a command\'s bashEditDiff', () => {
  for (const [path, why] of [[`${CWD}/.env`, 'credential_path'], [`${CWD}/config/secrets.yaml`, 'credential_path'],
    ['/srv/u/.claude/settings.json', 'harness_home'], ['/srv/u/.codex/config.toml', 'harness_home']]) {
    for (const [name, input, sidecar] of [
      ['Edit', { file_path: path, old_string: `b=${REMOVED}`, new_string: 'b=2' },
        { filePath: path, oldString: `b=${REMOVED}`, newString: 'b=2', originalFile: ORIGINAL, structuredPatch: HUNKS }],
      ['Write', { file_path: path, content: ORIGINAL.replace(`b=${REMOVED}`, 'b=2') },
        { type: 'update', filePath: path, content: ORIGINAL.replace(`b=${REMOVED}`, 'b=2'), originalFile: ORIGINAL,
          structuredPatch: HUNKS }]]) {
      const ledger = slicedClean([sideCall('e1', name, input), sideResult('e1', sidecar)]);
      const [edit] = ledger.ledger;
      assert.equal(edit.recorded.hunksWithheld, why, `${name} ${path}`);
      assert.equal(edit.recorded.hunks, undefined);
      // What the agent produced stays (an Edit's own strings, a Write's whole body); what the file held does not: an
      // Edit's unchanged context line, a Write update's removed line, the file before either.
      assert.equal(JSON.stringify(edit.recorded).includes(CONTEXT) || JSON.stringify(edit.recorded).includes(REMOVED), false);
      assert.equal(JSON.stringify(ledger).includes(name === 'Edit' ? CONTEXT : REMOVED), false, `${name} ${path}`);
    }
  }
  // A project file beside them keeps its hunks, a project's own `.claude` file too; the home unknown, that one is held.
  for (const path of [`${CWD}/src/a.js`, `${CWD}/.claude/settings.local.json`]) {
    const [kept] = slicedClean([sideCall('e1', 'Edit', { file_path: path, old_string: 'x', new_string: 'y' }),
      sideResult('e1', { filePath: path, originalFile: ORIGINAL, structuredPatch: HUNKS })]).ledger;
    assert.equal(kept.recorded.hunks[0].lines[0], ` a=${CONTEXT}`, path);
  }
  const [held] = slicedClean([sideCall('e1', 'Edit', { file_path: `${CWD}/.claude/settings.local.json`, old_string: 'x',
    new_string: 'y' }), sideResult('e1', { filePath: `${CWD}/.claude/settings.local.json`, originalFile: ORIGINAL,
    structuredPatch: HUNKS })], null).ledger;
  assert.equal(held.recorded.hunksWithheld, 'harness_home');
  // A command's bashEditDiff: the withheld file's hunks are not carried, the other file's are.
  const ledger = slicedClean([sideCall('b1', 'Bash', { command: 'node fix.js' }), sideResult('b1', { stdout: '',
    stderr: '', interrupted: false, isImage: false, noOutputExpected: true, bashEditDiff: { files: [
      { filePath: '/srv/u/.claude/settings.json', hunks: HUNKS }, { filePath: `${CWD}/src/a.js`, hunks: HUNKS }] } })]);
  const files = ledger.ledger[0].recorded.editDiff.files;
  // D69 review (F7): a file outside the recorder's cwd keeps its spelling as recorded.
  assert.deepEqual(files[0], { path: '/srv/u/.claude/settings.json', hunksWithheld: 'harness_home' });
  assert.equal(files[1].hunks[0].lines.length, 4);
  assert.equal(JSON.stringify(ledger).split(CONTEXT).length, 2, 'only the project file\'s context line');
});

test('a withheld file\'s prior state is withheld wherever its path is spelled (a relative `.claude` path too)', () => {
  const rows = [sideCall('e1', 'Edit', { file_path: '.claude/settings.json', old_string: 'x', new_string: 'y' }),
    sideResult('e1', { filePath: '.claude/settings.json', originalFile: ORIGINAL })];
  // The home unknown: held. The home known and not the cwd: a project's own file, its prior state kept.
  assert.deepEqual(slicedClean(rows, null).ledger[0].before, { withheld: 'harness home' });
  assert.equal(slicedClean(rows).ledger[0].before.source, 'original');
  // The recorder's cwd is the home: the relative `.claude` path is the home's — outside the work under review (D69 review
  // F5: the write scope reads every spelling, as an absolute one's always was), so no prior state is attached at all.
  const home = redact({ ask: [], claim: { finalMessage: '' }, dropped: [],
    ledger: buildEvents(rows, { cwd: HOME, home: HOME }).events }).ledger;
  assert.equal(home.ledger[0].external, true);
  assert.equal(home.ledger[0].before, undefined);
});

test('a Codex change of a withheld file: no hunk line, only why; a project .claude file\'s, where the home is known', async (t) => {
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
  // A copy (no recorder path form): the home is unknown, so the project's own `.claude` file is held (fails closed).
  const copy = await sliceAt(join(dir, 'copy'));
  assert.equal(copy.recorded.hunksWithheld, 'harness_home');
  assert.equal(copy.recorded.hunks, undefined);
  assert.equal(JSON.stringify(copy.recorded).includes(CONTEXT), false);
  // Where Codex wrote it: the home is known, and a project's own `.claude` file is no home folder.
  const recorded = await sliceAt(join(dir, 'home', '.codex', 'sessions', '2026', '10', '07'));
  assert.equal(recorded.recorded.hunksWithheld, undefined);
  assert.equal(recorded.recorded.hunks[0].lines[0], ` a=${CONTEXT}`);
});
