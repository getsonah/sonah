// `sonah review` in a folder the system refuses Sonah access to (macOS keeps a terminal without access out of
// ~/Documents): process.cwd() fails with EPERM, and the review says so in fixed words, names the folder when it can tell
// which folder it is, gives the fix and exits 2, never "sonah: EPERM: operation not permitted, uv_cwd" and exit 3. The
// CLI runs in a child process whose process.cwd() is made to throw that error before Sonah loads; synthetic files only,
// and nothing here builds a reviewer or reaches a model.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { WORKING_FOLDER_WORDS, sessionReviewUsage } from '../src/session-review-command.js';

const exec = promisify(execFile);
const BIN = fileURLToPath(new URL('../bin/sonah.js', import.meta.url));
/** Loaded before the CLI: process.cwd() throws what Node throws when the system refuses the working folder. */
const REFUSED_CWD = 'process.cwd = () => { throw Object.assign(new Error("EPERM: operation not permitted, uv_cwd"), '
  + '{ code: "EPERM", errno: -1, syscall: "uv_cwd" }); };';

async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), 'sonah-refused-folder-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const folder = join(directory, 'project'), other = join(directory, 'other'), home = join(directory, 'home');
  await mkdir(folder); await mkdir(other); await mkdir(home);
  const file = join(directory, 'recording.jsonl');
  await writeFile(file, '');
  return { folder, other, home, file };
}

async function refusedCli(args, { cwd, env }) {
  try {
    const r = await exec(process.execPath, ['--import', `data:text/javascript,${encodeURIComponent(REFUSED_CWD)}`, BIN,
      ...args], { cwd, env, timeout: 30_000 });
    return { code: 0, ...r };
  } catch (e) { return { code: e.code, stdout: e.stdout ?? '', stderr: e.stderr ?? '' }; }
}

const envOf = ({ home }, extra = {}) => ({ HOME: home, SONAH_HOME: join(home, '.sonah'), PATH: '/usr/bin:/bin',
  SONAH_NO_UPDATE_CHECK: '1', ...extra });
const refusedLines = (folder) => `${WORKING_FOLDER_WORDS.refused(folder)}\nFix: ${WORKING_FOLDER_WORDS.fix}\n`;

test('a refused working folder: the review names it, says the system refused access, gives the fix, exits 2',
  async (t) => {
  const input = await fixture(t);
  const r = await refusedCli(['review', input.file], { cwd: input.folder,
    env: envOf(input, { PWD: input.folder }) });
  assert.equal(r.stderr, refusedLines(input.folder));
  assert.equal(r.stderr.split('\n')[0],
    `The system refused Sonah access to ${input.folder}, the folder that Sonah runs in.`);
  assert.doesNotMatch(r.stderr, /uv_cwd|EPERM|^sonah:/m);
  assert.equal(r.stdout, '');
  assert.equal(r.code, 2);
});

test('the line names no folder that Sonah cannot tell is the one it runs in', async (t) => {
  const input = await fixture(t);
  for (const extra of [{ PWD: input.other }, {}, { PWD: 'project' }, { PWD: join(input.folder, 'gone') }]) {
    const r = await refusedCli(['review', input.file], { cwd: input.folder, env: envOf(input, extra) });
    assert.equal(r.stderr, refusedLines(null), JSON.stringify(extra));
    assert.equal(r.stderr.split('\n')[0], 'The system refused Sonah access to the folder that Sonah runs in.');
    assert.equal(r.code, 2);
  }
});

test('review --help and a usage error need no working folder', async (t) => {
  const input = await fixture(t);
  const help = await refusedCli(['review', '--help'], { cwd: input.folder, env: envOf(input, { PWD: input.folder }) });
  assert.equal(help.stdout, `${sessionReviewUsage}\n`);
  assert.equal(help.code, 0);
  const usage = await refusedCli(['review', '--unknown'], { cwd: input.folder, env: envOf(input) });
  assert.match(usage.stderr, /^sonah review: unknown option --unknown\.\nusage: /);
  assert.equal(usage.code, 2);
});
