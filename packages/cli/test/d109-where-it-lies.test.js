// D109 (code-snapshot/12): a recorded write the change block does not hold is classed by where it really lies, by facts
// code holds — whether the code review can read it (it lies in the working directory or the repository's top folder)
// and which git repository holds it — never by the folder the writing agent worked in alone: in another git repository,
// `other_repository`; under the working directory in its repository (or in none, as the working directory) though the
// recording marks it outside the writing agent's working directory, `outside_writer_root`; in a harness home folder or
// outside every folder the review can read, `outside_root` (only counted). With a git base, a recorded write that git's
// list does not name because it lies in a repository nested in the working directory is `other_repository`, never
// dropped unnamed.
//
// Throwaway folders and synthetic sessions: no recording, no model, no network.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Session } from '../../evidence/src/session.js';
import { runCodePass } from '../../evidence/src/code-pass.js';
import { CODE_REPORT_WORDS, codeFooterLines } from '../../evidence/src/code-report.js';
import { readCodeSnapshot } from '../src/code-snapshot.js';
import { CODE_FILES, repoWith, gitRepoWith, withRun } from './code-pass-fixture.js';

const GIT_ENV = { ...Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_'))),
  GIT_AUTHOR_DATE: '2029-01-01T00:00:00Z', GIT_COMMITTER_DATE: '2029-01-01T00:00:00Z', GIT_AUTHOR_NAME: 'synthetic',
  GIT_AUTHOR_EMAIL: 's@example.invalid', GIT_COMMITTER_NAME: 'synthetic', GIT_COMMITTER_EMAIL: 's@example.invalid' };
const git = (cwd, ...args) => execFileSync('git', args, { cwd, env: GIT_ENV, stdio: 'pipe' });

/** A session of typed writes, each `[path, scopedOutside]`: the slicer's write scope set on the change when true. */
const writesOf = (writes) => new Session({ sessionKey: 's', events: writes.map(([path, outside], at) => ({ id: `W${at}`,
  kind: 'invocation', tool: 'Write', operation: 'write', paths: [{ path }], command: [], input: [],
  changes: [{ path, ...(outside ? { outsideRepository: true } : {}), before: [], after: [], diff: [] }],
  sequence: at })) });
const states = (snapshot) => snapshot.files.map((f) => [f.path, f.state]);

test('D109: in a working directory that is no repository, a write a helper recorded outside its own working directory '
  + 'is classed by where it lies — another repository, the working directory, a harness home, or outside', async (t) => {
  const root = await repoWith(t, { 'device/bridge/core.ts': 'export const c = 1;\n', 'notes/main.md': '# main\n',
    'orchestrator/server/gateway.py': 'x = 1\n', 'orchestrator/server/main_only.py': 'y = 2\n',
    'agenthome/memory.md': 'remember\n' });
  git(join(root, 'orchestrator'), 'init', '-q', '-b', 'main');
  const outside = await mkdtemp(join(tmpdir(), 'sonah-d109-outside-'));
  t.after(() => rm(outside, { recursive: true, force: true }));
  await writeFile(join(outside, 'scratch.sh'), 'echo hi\n');
  const session = writesOf([['device/bridge/core.ts', true], ['orchestrator/server/gateway.py', true],
    ['orchestrator/server/main_only.py', false], ['agenthome/memory.md', true], [join(outside, 'scratch.sh'), true],
    ['notes/main.md', false]]);
  const snapshot = await readCodeSnapshot(session, { root, maxBytes: 100_000, harnessHomes: [join(root, 'agenthome')] });
  assert.equal(snapshot.base.kind, 'recorded_edits');
  assert.deepEqual(states(snapshot), [['device/bridge/core.ts', 'outside_writer_root'],
    ['orchestrator/server/gateway.py', 'other_repository'], ['orchestrator/server/main_only.py', 'readable'],
    ['agenthome/memory.md', 'outside_root'], [join(outside, 'scratch.sh'), 'outside_root'], ['notes/main.md', 'readable']]);
  // A write the main agent recorded in the nested repository is still part of the change it reviews; none is said to lie
  // in the review's repository, for there is none.
  assert.ok(snapshot.files.every((f) => f.inRepository !== true));
  // D109's review: the harness home here lies in the working directory, which the review can read, so the write there is
  // marked `home`, and no reader says that it lies outside the folders the review could read; the scratch file is not.
  const homeOf = Object.fromEntries(snapshot.files.map((f) => [f.path, f.home === true]));
  assert.deepEqual([homeOf['agenthome/memory.md'], homeOf[join(outside, 'scratch.sh')]], [true, false]);
  const { codePass } = await runCodePass({ report: {}, session, snapshot: snapshot.files, base: snapshot.base, root,
    judge: async () => withRun({ findings: [], questions: [] }) });
  assert.deepEqual(codePass.footer.filter((e) => e.kind === 'outside_root'), [{ kind: 'outside_root', count: 2, home: 1 }]);
  const line = CODE_REPORT_WORDS.footerKinds.outside_root({ count: 2, home: 1 });
  assert.equal(line, '2 paths that the session wrote to, which Sonah counts but did not review: 1 outside the folders '
    + 'that the code review could read, 1 in a coding agent\'s home folder or under a name from your home folder');
  assert.ok(codeFooterLines({ codePass }).includes(line), codeFooterLines({ codePass }).join('\n'));
});

test('D109: with a git base, a write a helper recorded outside its own working directory that git lists is a part of the '
  + 'change in the review\'s repository; a recorded write in a repository nested in the working directory, which git\'s '
  + 'list does not name, is `other_repository`', async (t) => {
  const root = await gitRepoWith(t, { ...CODE_FILES, 'src/helper.js': 'export const h = 1;\n' });
  await mkdir(join(root, 'vendor', 'lib'), { recursive: true });
  await writeFile(join(root, 'vendor', 'lib', 'a.js'), 'export const a = 1;\n');
  git(join(root, 'vendor', 'lib'), 'init', '-q', '-b', 'main');
  await writeFile(join(root, 'src', 'helper.js'), 'export const h = 2;\n');
  // The recording's first timestamp, after the start commit: the start commit is found by date.
  const recording = join(root, '..', `${join(root).split('/').at(-1)}-recording.jsonl`);
  await writeFile(recording, `${JSON.stringify({ type: 'user', timestamp: '2030-01-01T00:00:00Z' })}\n`);
  t.after(() => rm(recording, { force: true }));
  const session = writesOf([['src/helper.js', true], ['vendor/lib/a.js', false]]);
  const snapshot = await readCodeSnapshot(session, { root, maxBytes: 100_000, recording });
  assert.equal(snapshot.base.kind, 'git');
  const byPath = Object.fromEntries(snapshot.files.map((f) => [f.path, f]));
  assert.equal(byPath['src/helper.js'].state, 'outside_writer_root');
  assert.equal(byPath['src/helper.js'].diff, 'withheld', 'git lists it: in the change, its hunks not shown');
  assert.equal(byPath['vendor/lib/a.js'].state, 'other_repository');
  assert.equal(byPath['vendor/lib/a.js'].diff, undefined, 'git\'s list does not name it');
});
