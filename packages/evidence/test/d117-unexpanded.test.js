// D117 amended and D118 (b), one rule since their integration (the owner, 2026-10-18, decision 1: "paths that hold an
// unexpanded $VARIABLE are never counted"): the one function every reader of a written path shares (code-context.js
// `unresolvedShellPaths`), by the recorder's structure (which writes the slicer read from a command's text) and the
// shell's own grammar on the recorded spelling, never a list of names; and the record's readers of the folders listed and
// the writes counted apart (code-pass.js `foldersOf`, `unresolvedOf`). Pure: no disk, no model.
import test from 'node:test';
import assert from 'node:assert/strict';
import { unresolvedShellPaths } from '../src/code-context.js';
import { foldersOf, unresolvedOf } from '../src/code-pass.js';

/** A session whose one command (`B1`) wrote each of `shell` (read from its text) and whose file tool wrote each of
 *  `tool`, in that order. No result is recorded, so every write's effect is unknown: one that could have changed a file. */
const sessionOf = ({ shell = [], tool = [] }) => ({ events: [
  { id: 'B1', kind: 'invocation', operation: 'command', changes: [] },
  ...shell.map((path, at) => ({ id: `S${at}`, kind: 'invocation', operation: 'write', shellWriteOf: 'B1',
    changes: [{ path }] })),
  ...tool.map((path, at) => ({ id: `W${at}`, kind: 'invocation', operation: 'write', changes: [{ path }] }))] });

test('D117 amended, D118 (b): a shell write\'s spelling holds an unexpanded parameter expansion or command substitution, '
  + 'by the shell\'s grammar alone', () => {
  const expanded = ['$R/prep.sh', '${S}/release-notes.md', 'out/$NAME.js', '$1/a.js', '$@', '$$/pid.txt', '$?.log',
    '$(git rev-parse --show-toplevel)/x.md', '`pwd`/x.md', '/abs/$P/run-fb.sh', '$_/x', '$-x', '$ANY_NAME_AT_ALL/x.js'];
  assert.deepEqual(unresolvedShellPaths(sessionOf({ shell: expanded })), expanded);
  // A dollar sign that the shell keeps as it is (at the end, or before a character that starts no expansion), and any
  // path with none.
  const kept = ['cost$.md', 'a$/b.js', 'src/parse.js', '/abs/path/x.md', 'a$.b', '$', 'price$.txt'];
  assert.deepEqual(unresolvedShellPaths(sessionOf({ shell: kept })), []);
  // The home folder's spellings keep D109's class: named from the home, never "not resolved".
  assert.deepEqual(unresolvedShellPaths(sessionOf({ shell: ['$HOME/notes.md', '${HOME}/x.md', '~/x.md'] })), []);
  assert.deepEqual(unresolvedShellPaths(null), []);
});

test('D117 amended, D118 (b): the shell-only gate — a path a file tool wrote is the path the tool used, so a `$` in it '
  + 'is a character of its name, once a file tool wrote it at all', () => {
  // A file tool's path alone: a file, whatever it holds.
  assert.deepEqual(unresolvedShellPaths(sessionOf({ tool: ['app/routes/users.$id.tsx', '$P/x.js'] })), []);
  // The same spelling written by a shell command and by a file tool, in either order: a file.
  assert.deepEqual(unresolvedShellPaths(sessionOf({ shell: ['app/$id.tsx'], tool: ['app/$id.tsx'] })), []);
  // Each spelling once, in the order first written; a shell write of a path a file tool also wrote stays a file.
  assert.deepEqual(unresolvedShellPaths(sessionOf({ shell: ['$B/x', '$A/y', '$B/x', 'lib/$k.js'],
    tool: ['lib/$k.js'] })), ['$B/x', '$A/y']);
  // A write refused before it ran changed nothing, so it is no write here.
  const refused = sessionOf({ shell: ['$R/x.sh'] });
  refused.events[0].recorded = { denial: 'user-rejected' };
  refused.events.push({ id: 'B1-r', kind: 'observation', phase: 'terminal', invocation: 'B1' });
  assert.deepEqual(unresolvedShellPaths(refused), []);
});

test('D117 amended: the record\'s folders listed and writes not resolved read back only when well formed', () => {
  assert.deepEqual(foldersOf({ folders: [{ at: '/a', written: 2 }, { at: 'rel', written: 1 }, { at: '/b', written: 0 },
    { at: '/c', written: -1 }, null, { at: '/d', written: 1, extra: true }] }), [{ at: '/a', written: 2 },
    { at: '/d', written: 1 }]);
  assert.deepEqual(foldersOf({}), []);
  assert.deepEqual(foldersOf(null), []);
  assert.equal(unresolvedOf({ unresolved: 3 }), 3);
  for (const base of [{}, null, { unresolved: -1 }, { unresolved: 1.5 }, { unresolved: '2' }])
    assert.equal(unresolvedOf(base), 0, JSON.stringify(base));
});
