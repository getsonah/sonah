// M33 R repair 2. A Codex patch was cut before redaction had seen it whole.
//
// Codex records an edit as a patch — an `apply_patch` Update section, or a native FileChange's `unified_diff` — and the
// slicer turned it into an Edit by keeping only its changed lines (codex.js `splitPatch`): every context line went, and
// so did every changed line whose own text starts with `--` or `++` (it read them as file headers), a removed PEM BEGIN
// line among them. Redaction then saw a secret block's body without the line that makes it secret — a YAML block's
// `signing_key: |` kept as context, a PEM BEGIN line removed or kept as context, the first line of a continued value —
// and left those lines verbatim in the ledger, the session and the review requests. The same edit made by Claude Code,
// whose old and new strings hold that line, was clean.
//
// Now a patch becomes the two texts it changes: the old one (every context line and every `-` line, in order) and the
// new one (every context line and every `+` line), a hunk's anchor or section heading as context in both; so the line
// that makes a block secret travels with its block, and redaction judges each side whole. A `---`/`+++` line is a file
// header only in a unified diff, before its first hunk; in a hunk, and anywhere in an apply_patch body (which has no
// file headers), it is a changed line. An Add File keeps every `+` line.
//
// Synthetic recordings only: every byte is invented. No recording, no model, no network.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { redact, sliceHash } from '../../redact/index.js';
import { patchInput } from '../src/codex.js';
import { ARG_SEP } from '../src/events.js';
import { codexSliced, direct, native, patchOf, shapes, edits, leaks, WORDS, ROTATED, BEGIN, END, PEM_BODY, unpadded, CASES }
  from './m33-r-codex-patch-fixture.js';

// ---- the leak is closed in both shapes -------------------------------------------------------------------------------

for (const [name, { path, secrets, hunk }] of Object.entries(CASES)) {
  test(`M33 R repair 2: ${name} leaks no line of it, from an apply_patch or a native FileChange`, async () => {
    for (const [shape, rows] of shapes(path, hunk)) {
      const { raw, clean } = await codexSliced(rows);
      const [edit] = edits(clean);
      assert.equal(edit?.kind, 'edit', `${shape}: the Update is an edit`);
      assert.equal(edit.path, path);
      if (shape === 'FileChange') assert.ok(Number.isInteger(edit.sourceLocator.fileChangeRecord), 'the native item\'s own edit');
      assert.deepEqual(leaks(JSON.stringify(clean), secrets), [], `${shape}: no fragment anywhere in the ledger`);
      // The slicer handed redaction the line that makes the block secret, with the block, in each side it holds.
      const [oldText, newText] = edits(raw)[0].argsExcerpt.split(ARG_SEP);
      const key = hunk.find((line) => /signing_key|BEGIN|DB_PASSWORD/.test(line));
      const keyText = key.startsWith('@@ ') ? key.slice(3) : key.slice(1);
      if (!key.startsWith('-')) assert.ok(newText.includes(keyText), `${shape}: the new side holds its key line`);
      assert.ok(oldText.includes(keyText), `${shape}: the old side holds its key line`);
    }
  });
}

test('M33 R repair 2: the change stays visible, each line masked where it stands', async () => {
  const { path, hunk } = CASES['a YAML secret block whose key is a context line'];
  for (const [shape, rows] of shapes(path, hunk)) {
    const { clean } = await codexSliced(rows);
    const [edit] = edits(clean);
    assert.equal(edit.diff.split('\n').filter((line) => line === '-  ‹redacted:secret-value›').length, WORDS.length, shape);
    assert.equal(edit.diff.split('\n').filter((line) => line === '+  ‹redacted:secret-value›').length, ROTATED.length, shape);
    assert.ok(clean.dropped.some((d) => d.where === 'diff' && d.reason === 'redacted:secret-key-value'), shape);
    assert.ok(clean.dropped.some((d) => d.where === 'argsExcerpt'), `${shape}: the arguments declare it too`);
    assert.ok(clean.dropped.some((d) => d.where === 'after'), `${shape}: and the edit's own text`);
  }
});

// ---- a patch is the two texts it changes -----------------------------------------------------------------------------

test('M33 R repair 2: a patch\'s old text is its context and `-` lines, its new text its context and `+` lines', () => {
  const patch = ['*** Begin Patch', '*** Update File: src/app.py', '@@ class Store:', ' def load(self):',
    '-    return 1', '+    return 2', '     # done', '', ' def save(self):', '@@', ' tail = 3', '-x = 1', '+x = 2',
    '*** End of File', '*** End Patch'].join('\n');
  assert.deepEqual(patchInput(patch), {
    file_path: 'src/app.py', _files: ['src/app.py'],
    old_string: ['class Store:', 'def load(self):', '    return 1', '    # done', '', 'def save(self):', 'tail = 3', 'x = 1'].join('\n'),
    new_string: ['class Store:', 'def load(self):', '    return 2', '    # done', '', 'def save(self):', 'tail = 3', 'x = 2'].join('\n'),
  });
  // A patch of changed lines only splits exactly as it always did.
  assert.deepEqual(patchInput('*** Begin Patch\n*** Update File: src/worker.py\n-old line\n+new line\n*** End Patch'),
    { file_path: 'src/worker.py', old_string: 'old line', new_string: 'new line', _files: ['src/worker.py'] });
});

test('M33 R repair 2: a changed line whose text starts with `--` or `++` is a changed line, never a header', async () => {
  // apply_patch has no file headers: a removed SQL comment and an added C increment are changes.
  const sql = patchOf('q.sql', ['@@', ' select 1;', '--- a/b note', '+++i;', ' select 2;']);
  const { raw } = await codexSliced(direct(sql));
  const [oldText, newText] = edits(raw)[0].argsExcerpt.split(ARG_SEP);
  assert.equal(oldText, 'select 1;\n-- a/b note\nselect 2;');
  assert.equal(newText, 'select 1;\n++i;\nselect 2;');
  // A unified diff's headers are its lines before the first hunk; within a hunk `---` is a removed line.
  const diff = ['--- a/keys.txt', '+++ b/keys.txt', '@@ -1,4 +1,2 @@', ' first: 1', `-${BEGIN}`, `-${PEM_BODY[2]}`, `-${END}`,
    '--- not a header', ' second: 2', ''].join('\n');
  const { raw: nat, clean } = await codexSliced(native('keys.txt', diff));
  const [natOld, natNew] = edits(nat)[0].argsExcerpt.split(ARG_SEP);
  assert.equal(natOld, ['first: 1', BEGIN, PEM_BODY[2], END, '-- not a header', 'second: 2'].join('\n'));
  assert.equal(natNew, 'first: 1\nsecond: 2');
  assert.deepEqual(leaks(JSON.stringify(clean), unpadded([PEM_BODY[2]])), []);
  // An Add File keeps every added line, `+++…` among them.
  const add = '*** Begin Patch\n*** Add File: src/inc.c\n+int i;\n+++i;\n*** End Patch';
  const { raw: added } = await codexSliced(direct(add));
  assert.equal(edits(added)[0].kind, 'create');
  assert.equal(edits(added)[0].argsExcerpt, 'int i;\n++i;');
});

test('M33 R repair 2: a clean patch with context renders the change with its context, the same in both shapes', async () => {
  const hunk = ['@@', ' first = 1', '-second = 2', '+second = 3', ' third = 4'];
  const ledgers = [];
  for (const [shape, rows] of shapes('a.py', hunk)) {
    const { raw, clean } = await codexSliced(rows);
    const [edit] = edits(clean);
    assert.equal(edit.diff, ' first = 1\n-second = 2\n+second = 3\n third = 4', shape);
    assert.equal(edit.argsExcerpt, `first = 1\nsecond = 2\nthird = 4${ARG_SEP}first = 1\nsecond = 3\nthird = 4`, shape);
    assert.equal(edits(raw)[0].diff, edit.diff, `${shape}: nothing to redact, nothing changed by redaction`);
    ledgers.push(edit);
  }
  assert.equal(ledgers[0].diff, ledgers[1].diff);
  // A patch of changed lines only renders exactly the bytes it always did.
  const { clean } = await codexSliced(direct(patchOf('b.py', ['@@', '-old', '+new'])));
  assert.equal(edits(clean)[0].diff, '-old\n+new');
  assert.equal(edits(clean)[0].argsExcerpt, `old${ARG_SEP}new`);
});

test('M33 R repair 2: the same patch gives the same bytes, and a second redaction pass changes nothing', async () => {
  const { path, hunk } = CASES['a PEM block whose BEGIN and END lines are context'];
  for (const [shape, rows] of shapes(path, hunk)) {
    const { clean } = await codexSliced(rows);
    const { clean: again } = await codexSliced(rows);
    assert.equal(sliceHash(again), sliceHash(clean), shape);
    const twice = redact({ ...structuredClone(clean), dropped: [] }).ledger;
    assert.equal(sliceHash(twice), sliceHash(clean), shape);
  }
});
