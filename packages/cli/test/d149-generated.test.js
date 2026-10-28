// D149: the git attributes that make a file of the change generated or vendored are read beside its git diff
// (`gitAttributesOf`: `linguist-generated` set, `linguist-vendored` set, `diff` unset, in that order), 200 paths a call,
// and the frozen snapshot keeps each such file's source (`generated`). Reads only: nothing is written.
//
// A temporary repository with synthetic files and a synthetic session: no recording of anyone's, no model, no network.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readCodeSnapshot, gitAttributesOf } from '../src/code-snapshot.js';
import { CODE_FILES, codeSession } from './code-pass-fixture.js';

const BASE_PARSE = CODE_FILES['src/parse.js'].replace('split(",")', 'split(";")');
const START = '2030-01-01T00:00:00.000Z';

/** A fresh repository: `base` committed before the session's start, then `after` written, uncommitted. */
async function repository(t, { base, after }) {
  const root = await mkdtemp(join(tmpdir(), 'sonah-d149-generated-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const git = (args) => execFileSync('git', args, { cwd: root, stdio: 'pipe',
    env: { ...Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('GIT_'))),
      GIT_AUTHOR_DATE: '2029-01-01T00:00:00Z', GIT_COMMITTER_DATE: '2029-01-01T00:00:00Z', GIT_AUTHOR_NAME: 'synthetic',
      GIT_AUTHOR_EMAIL: 's@example.invalid', GIT_COMMITTER_NAME: 'synthetic', GIT_COMMITTER_EMAIL: 's@example.invalid',
      GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null' } }).toString();
  const write = async (files) => {
    for (const [path, text] of Object.entries(files)) {
      await mkdir(join(root, path, '..'), { recursive: true });
      await writeFile(join(root, path), text);
    }
  };
  git(['init', '-q', '-b', 'main']);
  await write(base);
  git(['add', '-A']);
  git(['commit', '-q', '-m', 'base']);
  await write(after);
  return root;
}

test('D149: a file of the change keeps the git attribute that makes it generated or vendored, read beside its diff', async (t) => {
  const root = await repository(t, {
    base: { '.gitattributes': 'gen/** linguist-generated\nvendor/** linguist-vendored\n*.bin -diff\n'
      + 'both/** linguist-generated linguist-vendored\nnot/** linguist-generated=false\n', 'src/parse.js': BASE_PARSE,
    'gen/out.js': 'export const out = 1;\n', 'vendor/lib.js': 'export const lib = 1;\n', 'data.bin': 'one\n',
    'both/x.js': 'export const x = 1;\n', 'not/y.js': 'export const y = 1;\n', 'package-lock.json': '{"v":1}\n' },
    after: { 'src/parse.js': CODE_FILES['src/parse.js'], 'gen/out.js': 'export const out = 2;\n',
      'vendor/lib.js': 'export const lib = 2;\n', 'data.bin': 'two\n', 'both/x.js': 'export const x = 2;\n',
      'not/y.js': 'export const y = 2;\n', 'package-lock.json': '{"v":2}\n' } });
  const recording = join(root, '..', `${root.split('/').at(-1)}.jsonl`);
  await writeFile(recording, `${JSON.stringify({ timestamp: START })}\n`);
  t.after(() => rm(recording, { force: true }));
  const session = codeSession({ writes: ['gen/out.js', 'vendor/lib.js', 'data.bin', 'both/x.js', 'not/y.js',
    'package-lock.json'].map((path) => ({ path, text: 'SYNTHETIC_RECORDED_BODY\n' })) });
  const index = await stat(join(root, '.git', 'index'));
  const snapshot = await readCodeSnapshot(session, { root, maxBytes: 1_000_000, recording });
  assert.deepEqual(snapshot.files.map((f) => [f.path, f.state, f.generated ?? null]).sort(), [
    ['both/x.js', 'readable', 'linguist-generated'], ['data.bin', 'binary', 'diff-unset'],
    ['gen/out.js', 'readable', 'linguist-generated'], ['not/y.js', 'readable', null],
    // A lock file's name is the planner's to read (code-pass.js `generatedSourceOf`), from the path alone.
    ['package-lock.json', 'readable', null], ['src/parse.js', 'readable', null],
    ['vendor/lib.js', 'readable', 'linguist-vendored']]);
  // Reads only: git's index is as it was.
  assert.equal((await stat(join(root, '.git', 'index'))).mtimeMs, index.mtimeMs);
});

test('D149: the attributes are asked 200 paths a call, and a call that fails gives none', async () => {
  const paths = Array.from({ length: 201 }, (_, i) => `gen/f${i}.js`);
  const calls = [];
  const git = async (args) => {
    calls.push(args);
    const asked = args.slice(args.indexOf('--') + 1);
    if (asked.includes('gen/f200.js')) return { ok: false, stdout: null };
    return { ok: true, stdout: Buffer.from(asked.flatMap((p) => [p, 'linguist-generated', p === 'gen/f1.js' ? 'unset'
      : 'set', p, 'linguist-vendored', 'unspecified', p, 'diff', 'unspecified']).map((x) => `${x}\0`).join('')) };
  };
  const found = await gitAttributesOf(paths, { top: '/synthetic', git });
  assert.deepEqual(calls.map((args) => args.slice(args.indexOf('--') + 1).length), [200, 1]);
  assert.deepEqual(calls[0].slice(0, 5), ['check-attr', '-z', 'linguist-generated', 'linguist-vendored', 'diff']);
  assert.equal(found.size, 199);
  assert.equal(found.get('gen/f0.js'), 'linguist-generated');
  assert.equal(found.has('gen/f1.js'), false);
  assert.equal(found.has('gen/f200.js'), false);
});
