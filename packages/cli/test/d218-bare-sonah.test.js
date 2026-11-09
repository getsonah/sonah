// D218 (the owner, 2026-11-09): bare `sonah` in a terminal draws the graphs page. The terminal is injected, and so are
// the visual's runner and the browser opener: nothing here needs a terminal, starts a model call or opens a browser.
// Not in a terminal, bare `sonah` prints the usage table and exits 2 as before (exitcodes.test.js runs the entry so).
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { BARE_WORDS, isInteractive, runBareCommand } from '../src/bare-command.js';
import { LOCAL_PAGE_OPEN_FIX } from '../src/local-page.js';
import { updateNoticeApplies } from '../src/update-check.js';

const exec = promisify(execFile);
const BIN = fileURLToPath(new URL('../bin/sonah.js', import.meta.url));
const USAGE = 'usage:\n  sonah review [--repo DIR] [--choose N]';
const PAGE = resolve('synthetic visual out', 'page.html');

const streams = () => {
  const chunks = { stdout: '', stderr: '' };
  return { chunks, stdout: { write: (text) => { chunks.stdout += text; } },
    stderr: { write: (text) => { chunks.stderr += text; } } };
};

/** A stand-in for `sonah visual`: it records each argv, writes `said` on stderr and, on 0, shows `PAGE` through the
 *  presentPage it is handed, as runVisualCommand does. */
function standIn(code, said = '') {
  const calls = [];
  const run = async (argv, { stderr, presentPage }) => {
    calls.push(argv);
    assert.equal(typeof presentPage, 'function', 'the bare command hands the visual a presentPage');
    stderr.write(said);
    if (code === 0) await presentPage(PAGE);
    return code;
  };
  return { run, calls };
}

test('D218: the words bare sonah adds, as they are printed', () => {
  assert.equal(BARE_WORDS.notice, 'Sonah draws this branch\'s change as a page of graphs, with claude -p on your '
    + 'Claude plan. Run sonah --help to see every command.');
  assert.equal(BARE_WORDS.help, 'Run sonah --help to see every command.');
  assert.equal(BARE_WORDS.openFix, 'Sonah saved the page, but could not open it. Open the HTML path that Sonah printed '
    + 'in your browser.');
  assert.ok(!BARE_WORDS.openFix.includes('--no-open'), 'bare sonah has no --no-open to offer');
});

test('D218: interactive means standard input and standard output are both a terminal', () => {
  const tty = { isTTY: true };
  assert.equal(isInteractive({ stdin: tty, stdout: tty }), true);
  for (const [stdin, stdout] of [[{}, tty], [tty, {}], [{}, {}], [{ isTTY: 1 }, tty], [undefined, tty]])
    assert.equal(isInteractive({ stdin, stdout }), false, JSON.stringify([stdin, stdout]));
});

test('D218: in a terminal, a page written: the notice, the visual once with no arguments, one Local page line, '
  + 'the page opened once', async () => {
  const out = streams(), visual = standIn(0, 'the visual\'s own started line\n'), opened = [];
  const code = await runBareCommand({ usage: USAGE, interactive: true, ...out, runVisual: visual.run,
    openPage: async (path) => {
      assert.equal(out.chunks.stdout, `Local page: ${PAGE}\n`, 'the line is printed before the page is opened');
      opened.push(path);
    } });
  assert.equal(code, 0);
  assert.deepEqual(visual.calls, [[]]);
  assert.deepEqual(opened, [PAGE]);
  assert.equal(out.chunks.stdout, `Local page: ${PAGE}\n`);
  assert.equal(out.chunks.stderr, `${BARE_WORDS.notice}\nthe visual's own started line\n`, 'the notice comes first');
});

test('D218: a page the browser does not open keeps exit 0 and says so, without --no-open', async () => {
  const out = streams(), visual = standIn(0);
  const code = await runBareCommand({ usage: USAGE, interactive: true, ...out, runVisual: visual.run,
    openPage: async () => { throw Object.assign(new Error('SYNTHETIC_OPENER_ERROR'), { code: 'ENOENT' }); } });
  assert.equal(code, 0);
  assert.equal(out.chunks.stdout, `Local page: ${PAGE}\n`);
  assert.equal(out.chunks.stderr, `${BARE_WORDS.notice}\n${BARE_WORDS.openFix}\n`);
  assert.ok(!out.chunks.stderr.includes(LOCAL_PAGE_OPEN_FIX));
  assert.doesNotMatch(out.chunks.stderr, /SYNTHETIC_OPENER_ERROR|ENOENT/);
});

test('D218: in a terminal, a problem the visual names keeps its exit 2 and its lines, then the help line', async () => {
  const said = 'Visual review could not complete: default_branch_unknown.\nFix: Give a range, such as sonah visual '
    + 'main..HEAD.\n';
  const out = streams(), visual = standIn(2, said);
  const code = await runBareCommand({ usage: USAGE, interactive: true, ...out, runVisual: visual.run,
    openPage: () => assert.fail('no page was written') });
  assert.equal(code, 2);
  assert.deepEqual(visual.calls, [[]]);
  assert.equal(out.chunks.stdout, '');
  assert.equal(out.chunks.stderr, `${BARE_WORDS.notice}\n${said}${BARE_WORDS.help}\n`);
});

test('D218: in a terminal, a failure keeps exit 3 and answers still needed keep exit 1, with no line added',
  async () => {
  for (const [exit, said] of [[3, 'Visual review could not complete: visual_failed.\nFix: Run the same command again.\n'],
    [1, '']]) {
    const out = streams(), visual = standIn(exit, said);
    const code = await runBareCommand({ usage: USAGE, interactive: true, ...out, runVisual: visual.run,
      openPage: () => assert.fail('no page was written') });
    assert.equal(code, exit);
    assert.deepEqual(visual.calls, [[]]);
    assert.equal(out.chunks.stderr, `${BARE_WORDS.notice}\n${said}`, `exit ${exit}`);
  }
});

test('D218: not in a terminal, the usage table and exit 2: no visual, no page, nothing on stdout', async () => {
  const out = streams();
  const code = await runBareCommand({ usage: USAGE, interactive: false, ...out,
    runVisual: () => assert.fail('not in a terminal, the visual does not run'),
    openPage: () => assert.fail('not in a terminal, no page is opened') });
  assert.equal(code, 2);
  assert.equal(out.chunks.stdout, '');
  assert.equal(out.chunks.stderr, `${USAGE}\n`);
});

test('D218: the entry in a pipe prints the usage and writes nothing; its help says what plain sonah does; no update '
  + 'check', async (t) => {
  const home = await mkdtemp(join(tmpdir(), 'sonah-d218-'));
  t.after(() => rm(home, { recursive: true, force: true }));
  const env = { HOME: home, SONAH_HOME: home, PATH: '/usr/bin:/bin', SONAH_NO_UPDATE_CHECK: '1' };
  const bare = await exec(process.execPath, [BIN], { cwd: home, env, timeout: 30_000 })
    .then((r) => ({ code: 0, ...r }), (e) => ({ code: e.code, stdout: e.stdout, stderr: e.stderr }));
  const help = await exec(process.execPath, [BIN, '--help'], { cwd: home, env, timeout: 30_000 });
  assert.equal(bare.code, 2);
  assert.equal(bare.stdout, '');
  assert.ok(help.stdout.endsWith(`\n\n${bare.stderr}`), 'the same usage table as --help prints');
  assert.deepEqual(await readdir(home), []);
  assert.ok(help.stdout.includes('In a terminal, plain sonah, with no command, draws this branch\'s change as a\npage '
    + 'of graphs, as sonah visual does, and opens the page in your browser.'));
  assert.equal(updateNoticeApplies([]), false);
});
