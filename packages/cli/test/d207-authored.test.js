// D207: a commit is the session's when its message's first line lies literally inside a recorded action of the session or
// its helpers, made by the commit's committer time. A quiet commit reports nothing and a result can name any commit, so the
// action's own input is the evidence: never a hash, a result, a thought, a commit's words or who committed it. Recorder
// structure, times and a literal search.
//
// Synthetic recordings and throwaway repositories: no model, no network.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { isCursorSession } from '../../slicer/src/cursor.js';
import { actionsOf, authoredCommits, authoredPaths, pathsAtEnd } from '../src/code-snapshot.js';
import { at, claude, codex, ms, recording, repository, ROLLOUT, scratch } from './d207-fixture.js';

const COMMIT_AT = '2030-01-01T10:01:00Z';
const sorted = (set) => [...set].sort();
/** The repository with one commit of `b.txt`, `message`, made at `COMMIT_AT`. */
async function committed(t, message, when = COMMIT_AT) {
  const repo = await repository(t);
  await repo.put('b.txt', 'two\n');
  repo.git(['add', '-A']);
  repo.git(['commit', '-q', '-m', message], when);
  return repo;
}
const authoredFrom = async (repo, activity) => authoredPaths({ top: repo.top, base: repo.base,
  actions: await actionsOf(activity) });

test('D207: a commit the session typed is the session\'s though its result says nothing (a quiet commit)', async (t) => {
  const repo = await committed(t, 'Make the parser strict');
  const file = await recording(t, [claude.human(at('10:00:00')),
    claude.action(at('10:00:30'), 'git add -A && git commit -q -m "Make the parser strict"', 'c1'), claude.result(at('10:00:31'), '', 'c1')]);
  assert.deepEqual(sorted(await authoredFrom(repo, [{ file }])), ['b.txt']);
});

test('D207: a message in a heredoc: its first line is what is searched', async (t) => {
  const repo = await committed(t, 'Make the parser strict\n\nA body the action spells some other way.');
  const file = await recording(t, [claude.human(at('10:00:00')),
    claude.action(at('10:00:30'), 'git commit -F - <<\'EOF\'\nMake the parser strict\n\nA body the action spells otherwise.\nEOF', 'c1')]);
  assert.deepEqual(sorted(await authoredFrom(repo, [{ file }])), ['b.txt']);
});

test('D207: a subject typed after the commit is not authorship (copied from git log); the same second is', async (t) => {
  const repo = await committed(t, 'Make the parser strict');
  const late = await recording(t, [claude.action(at('10:01:01'), 'git log --grep="Make the parser strict"', 'c1')]);
  assert.deepEqual(sorted(await authoredFrom(repo, [{ file: late }])), []);
  const sameSecond = await recording(t, [claude.action('2030-01-01T10:01:00.900Z', 'git commit -qm "Make the parser strict"', 'c1')]);
  assert.deepEqual(sorted(await authoredFrom(repo, [{ file: sameSecond }])), ['b.txt']);
});

test('D207: a subject only in a result, a thought or the human\'s words is not authorship', async (t) => {
  const repo = await committed(t, 'Make the parser strict');
  const file = await recording(t, [claude.human(at('10:00:00'), 'Make the parser strict'),
    claude.thought(at('10:00:05'), 'Make the parser strict'), claude.action(at('10:00:10'), 'git log -1', 'c1'),
    claude.result(at('10:00:11'), 'Make the parser strict', 'c1')]);
  assert.deepEqual(sorted(await authoredFrom(repo, [{ file }])), []);
  // A row of the agent's words and a call: only the call's input counts.
  const mixed = await recording(t, [claude.mixed(at('10:00:10'), 'Make the parser strict', 'git status', 'c1')]);
  assert.deepEqual((await actionsOf([{ file: mixed }])).map((a) => a.text), ['git status']);
  assert.deepEqual(sorted(await authoredFrom(repo, [{ file: mixed }])), []);
  // The session's own recording on Codex: a human's words and an output do not count either.
  const rollout = await recording(t, [codex.meta(at('10:00:00')), codex.human(at('10:00:01'), 'Make the parser strict'),
    codex.execCommand(at('10:00:02'), 'git log -1', 'x1'), codex.output(at('10:00:03'), 'x1', 'Make the parser strict'),
    codex.say(at('10:00:04'), 'Make the parser strict')], ROLLOUT);
  assert.deepEqual(sorted(await authoredFrom(repo, [{ file: rollout }])), []);
});

test('D207: a helper\'s commit is the session\'s', async (t) => {
  const repo = await committed(t, 'Make the parser strict');
  const own = await recording(t, [claude.human(at('10:00:00')), claude.action(at('10:00:10'), 'git status', 'c1')]);
  const side = { isSidechain: true, agentId: 'a1' };
  const helper = await recording(t, [claude.human(at('10:00:20'), 'commit it', side),
    claude.action(at('10:00:30'), 'git commit -qm "Make the parser strict"', 'h1', side)], 'agent-a1.jsonl');
  assert.deepEqual(sorted(await authoredFrom(repo, [{ file: own }])), []);
  assert.deepEqual(sorted(await authoredFrom(repo, [{ file: own }, { file: helper, helper: true }])), ['b.txt']);
});

test('D207: an amended or rebased commit keeps its message and a later time, so it stays the session\'s', async (t) => {
  const repo = await committed(t, 'Make the parser strict');
  await repo.put('a.txt', 'two\n');
  repo.git(['add', '-A']);
  repo.git(['commit', '-q', '--amend', '--no-edit'], '2030-01-01T10:05:00Z');
  const typed = await recording(t, [claude.action(at('10:00:30'), 'git commit -qm "Make the parser strict"', 'c1')]);
  assert.deepEqual(sorted(await authoredFrom(repo, [{ file: typed }])), ['a.txt', 'b.txt']);
  // Rebased over a commit of other hands: only its own paths.
  const other = await repository(t, { 'a.txt': 'one\n', 'b.txt': 'one\n', 'c.txt': 'one\n' });
  other.git(['checkout', '-q', '-b', 'work']);
  await other.put('b.txt', 'two\n');
  other.git(['commit', '-qam', 'Make the parser strict'], COMMIT_AT);
  other.git(['checkout', '-q', 'main']);
  await other.put('c.txt', 'two\n');
  other.git(['commit', '-qam', 'A commit of other hands'], '2030-01-01T10:02:00Z');
  other.git(['checkout', '-q', 'work']);
  other.git(['rebase', '-q', 'main'], '2030-01-01T10:03:00Z');
  assert.deepEqual(sorted(await authoredFrom(other, [{ file: typed }])), ['b.txt']);
});

test('D207: a merge gives only the paths it resolved, never what it brought in', async (t) => {
  const repo = await repository(t);
  repo.git(['checkout', '-q', '-b', 'side']);
  await repo.put('a.txt', 'side\n');
  await repo.put('b.txt', 'side\n');
  repo.git(['commit', '-qam', 'A commit of other hands'], '2030-01-01T10:00:10Z');
  repo.git(['checkout', '-q', 'main']);
  await repo.put('a.txt', 'main\n');
  repo.git(['commit', '-qam', 'Another of other hands'], '2030-01-01T10:00:20Z');
  try { repo.git(['merge', '-q', 'side', '-m', 'Merge the side work'], '2030-01-01T10:01:00Z'); }
  catch { /* the conflict is resolved below */ }
  await repo.put('a.txt', 'both\n');
  repo.git(['add', '-A']);
  repo.git(['commit', '-q', '-m', 'Merge the side work'], '2030-01-01T10:01:00Z');
  const file = await recording(t, [claude.action(at('10:00:50'), 'git commit -m "Merge the side work"', 'c1')]);
  assert.deepEqual(sorted(await authoredFrom(repo, [{ file }])), ['a.txt']);
  // A merge with nothing to resolve holds no path of its own.
  const clean = await repository(t);
  clean.git(['checkout', '-q', '-b', 'side']);
  await clean.put('b.txt', 'side\n');
  clean.git(['commit', '-qam', 'A commit of other hands'], '2030-01-01T10:00:10Z');
  clean.git(['checkout', '-q', 'main']);
  await clean.put('a.txt', 'main\n');
  clean.git(['commit', '-qam', 'Another of other hands'], '2030-01-01T10:00:20Z');
  clean.git(['merge', '-q', '--no-ff', 'side', '-m', 'Merge the side work'], '2030-01-01T10:01:00Z');
  assert.deepEqual(sorted(await authoredFrom(clean, [{ file }])), []);
});

test('D207: a row with no time gives nothing (a recording with no timestamps)', async (t) => {
  const repo = await committed(t, 'Make the parser strict');
  const file = await recording(t, [claude.action(null, 'git commit -qm "Make the parser strict"', 'c1')]);
  assert.deepEqual(await actionsOf([{ file }]), []);
  assert.deepEqual(sorted(await authoredFrom(repo, [{ file }])), []);
});

test('D207: a file the session\'s commit deleted is named', async (t) => {
  const repo = await repository(t);
  repo.git(['rm', '-q', 'b.txt']);
  repo.git(['commit', '-q', '-m', 'Remove the old parser'], COMMIT_AT);
  const file = await recording(t, [claude.action(at('10:00:30'), 'git rm b.txt && git commit -qm "Remove the old parser"', 'c1')]);
  assert.deepEqual(sorted(await authoredFrom(repo, [{ file }])), ['b.txt']);
});

test('D207: an empty first line is no subject; a commit of no such line is nobody\'s', async (t) => {
  const repo = await repository(t);
  await repo.put('b.txt', 'two\n');
  repo.git(['add', '-A']);
  repo.git(['commit', '-q', '--allow-empty-message', '-m', ''], COMMIT_AT);
  const file = await recording(t, [claude.action(at('10:00:30'), 'git commit --allow-empty-message -m ""', 'c1')]);
  assert.deepEqual(await authoredCommits({ top: repo.top, base: repo.base, actions: await actionsOf([{ file }]) }), []);
});

test('D207: every harness\'s action input is read, by structure', async (t) => {
  const repo = await committed(t, 'Make the parser strict');
  const quoted = 'git commit -qm "Make the parser strict"';
  const rolloutOf = (...rows) => recording(t, [codex.meta(at('10:00:00')), codex.human(at('10:00:01')), ...rows], ROLLOUT);
  const script = `const r = await tools.exec_command({cmd:"git commit -qm 'Make the parser strict'"}); text(r);`;
  const shapes = [
    // A function call's arguments, whichever tool.
    await rolloutOf(codex.execCommand(at('10:00:30'), quoted, 'x1'), codex.output(at('10:00:31'), 'x1')),
    await rolloutOf(codex.shell(at('10:00:30'), quoted, 's1'), codex.output(at('10:00:31'), 's1')),
    // A custom tool call's input: a tool of no known name, and a code cell.
    await rolloutOf(codex.custom(at('10:00:30'), 'some_tool', quoted, 'u1')),
    await rolloutOf(codex.custom(at('10:00:30'), 'functions.exec', script, 'u1'), codex.customOutput(at('10:00:31'), 'u1',
      ['Script completed', '{"output":"ok","exit_code":0}'])),
    // The native item stream's command, with no call row at all.
    await rolloutOf(codex.turnStarted(at('10:00:29')), codex.nativeCommand(at('10:00:30'), quoted)),
    // A Claude Code call's input.
    await recording(t, [claude.human(at('10:00:00')), claude.action(at('10:00:30'), quoted, 'c1')]),
  ];
  for (const file of shapes) {
    assert.ok((await actionsOf([{ file }])).some((a) => a.text.includes('Make the parser strict')), file);
    assert.deepEqual(sorted(await authoredFrom(repo, [{ file }])), ['b.txt']);
  }
});

test('D207: a Cursor recording carries no time on its rows, so it gives no action, whatever it holds', async (t) => {
  const repo = await committed(t, 'Make the parser strict');
  const dir = join(await scratch(t), '.cursor', 'projects', 'repo', 'agent-transcripts');
  await mkdir(dir, { recursive: true });
  const file = join(dir, 'conversation.jsonl');
  await writeFile(file, `${JSON.stringify({ role: 'user', message: { content: [{ type: 'text', text: 'do it' }] } })}\n${JSON.stringify({ role: 'assistant',
    message: { content: [{ type: 'tool_use', name: 'Shell', input: { command: 'git commit -qm "Make the parser strict"' } }] } })}\n`);
  assert.equal(isCursorSession(file), true);
  assert.deepEqual(await actionsOf([{ file }]), []);
  assert.deepEqual(sorted(await authoredFrom(repo, [{ file }])), []);
});

test('D207: a frozen read gives the actions of the recording as it was', async (t) => {
  const rows = [claude.action(at('10:00:10'), 'git status', 'c1'), claude.action(at('10:00:30'), 'git commit -qm "x"', 'c2')];
  const file = await recording(t, rows);
  assert.equal((await actionsOf([{ file }])).length, 2);
  assert.deepEqual((await actionsOf([{ file, byteEnd: Buffer.byteLength(`${rows[0]}\n`) }])).map((a) => a.at), [ms('10:00:10')]);
});

test('D207: a recording that cannot be read gives no actions, and git that cannot say gives no paths', async (t) => {
  const file = await recording(t, [claude.action(at('10:00:10'), 'git status', 'c1')]);
  assert.equal(await actionsOf([{ file }, { file: join(await scratch(t), 'gone.jsonl'), helper: true }]), null);
  assert.equal(await actionsOf([{ file: null }]), null);
  assert.deepEqual(await actionsOf([]), []);
  const repo = await committed(t, 'Make the parser strict');
  const refusing = async () => ({ ok: false, stdout: null });
  const actions = await actionsOf([{ file }]);
  assert.equal(await authoredPaths({ top: repo.top, base: repo.base, actions, git: refusing }), null);
  assert.equal(await pathsAtEnd({ top: repo.top, end: at('10:01:00'), git: refusing }), null);
  // A log that is not git's: no commit evidence.
  const babble = async () => ({ ok: true, stdout: Buffer.from('not\0a\0log\0') });
  assert.equal(await authoredPaths({ top: repo.top, base: repo.base, actions, git: babble }), null);
});

test('D207: pathsAtEnd: what differs from the commit HEAD was on at the recording\'s end, as git names it', async (t) => {
  const repo = await committed(t, 'Before the end');
  await repo.put('a.txt', 'proof\n');
  repo.git(['commit', '-qam', 'After the end'], '2030-01-01T10:10:00Z');
  await repo.put('c.txt', 'untracked\n');
  assert.deepEqual(sorted(await pathsAtEnd({ top: repo.top, end: at('10:05:00') })), ['a.txt']);
  assert.deepEqual(sorted(await pathsAtEnd({ top: repo.top, end: at('10:20:00') })), []);
  assert.equal(await pathsAtEnd({ top: repo.top, end: '2020-01-01T00:00:00.000Z' }), null);
});
