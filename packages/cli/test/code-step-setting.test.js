// Owner decision 2026-10-14: the code step is on by default, with a quick switch. `sonah config code-pass on|off` keeps
// the setting in Sonah's own settings file (SONAH_HOME/config.json), `sonah config` shows it, `--code-pass` or
// `--no-code-pass` overrides it for one review (the flag, then the setting, then the default), the dry run and the
// estimate say whether the step runs and roughly what it adds, `sonah doctor` reports the setting, and the session's
// requests are the same bytes whichever way it is set.
//
// Synthetic sessions, synthetic files, a scratch SONAH_HOME and a deterministic fake reviewer: no recording, no model,
// no network.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { chmod, mkdir, mkdtemp, readFile, readdir, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { CLI_SAFE_ERROR_CODES } from '../../evidence/src/ledger.js';
import { codeStepLine, runSessionReviewCommand } from '../src/session-review-command.js';
import { CODE_PASS_DEFAULT, CODE_PASS_SOURCES, parseSettings, readSettings, resolveCodePass, runConfigCommand,
  settingsPath, sonahHome } from '../src/settings.js';
import { doctor } from '../src/doctor.js';
import { codeJudge, codeSession, contradictClaim, findEmptyInput, repoWith, sha256 } from './code-pass-fixture.js';

const exec = promisify(execFile);
const BIN = fileURLToPath(new URL('../bin/sonah.js', import.meta.url));
const CODE_LABEL = /^code-(?:review|verify)(?::|$)/;

/** A scratch home with its own SONAH_HOME (not created yet). */
async function scratch(t) {
  const dir = await mkdtemp(join(tmpdir(), 'sonah-code-step-setting-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const home = join(dir, 'home');
  await mkdir(home);
  const env = { HOME: home, SONAH_HOME: join(home, '.sonah'), CODEX_HOME: join(home, 'codex'),
    SONAH_CLAUDE_PROJECTS: join(home, 'claude-projects') };
  return { dir, home, env };
}
const streams = () => {
  const chunks = { stdout: '', stderr: '' };
  return { chunks, stdout: { write: (text) => { chunks.stdout += text; } },
    stderr: { write: (text) => { chunks.stderr += text; } } };
};
const config = async (box, argv) => {
  const out = streams();
  const code = await runConfigCommand(argv, { ...out, env: box.env, home: box.home });
  return { code, ...out.chunks };
};

test('the settings file: exact bytes, owner-only, and only its own shape is read as a setting', async (t) => {
  const box = await scratch(t);
  assert.equal(CODE_PASS_DEFAULT, true, 'owner decision 2026-10-14: on by default');
  assert.deepEqual(CODE_PASS_SOURCES, ['flag', 'config', 'default']);
  assert.equal(sonahHome({ env: box.env, home: box.home }), box.env.SONAH_HOME);
  assert.equal(sonahHome({ env: {}, home: box.home }), join(box.home, '.sonah'));
  assert.equal(settingsPath({ env: box.env }), join(box.env.SONAH_HOME, 'config.json'));
  assert.deepEqual(await readSettings({ env: box.env }), { state: 'absent' });
  assert.equal((await config(box, ['code-pass', 'off'])).code, 0);
  const path = settingsPath({ env: box.env });
  assert.equal(await readFile(path, 'utf8'), '{"version":1,"codePass":false}\n');
  assert.equal((await stat(path)).mode & 0o777, 0o600);
  assert.equal((await stat(box.env.SONAH_HOME)).mode & 0o777, 0o700);
  assert.deepEqual(await readdir(box.env.SONAH_HOME), ['config.json'], 'no temporary file is left beside it');
  assert.deepEqual(await readSettings({ env: box.env }), { state: 'ok', settings: { codePass: false } });
  assert.equal((await config(box, ['code-pass', 'on'])).code, 0);
  assert.equal(await readFile(path, 'utf8'), '{"version":1,"codePass":true}\n');
  // Only exactly this shape.
  assert.deepEqual(parseSettings('{"version":1}'), {});
  for (const text of ['', 'null', '[]', '{"codePass":true}', '{"version":2,"codePass":true}',
    '{"version":1,"codePass":"off"}', '{"version":1,"codePass":true,"other":1}',
    '{"version":1,"codePass":true,"codePass":false}', '{"version":1,"codePass":true'])
    assert.equal(parseSettings(text), null, text);
  // A file someone else could write, a link and a folder are not read as a setting.
  await chmod(path, 0o666);
  assert.deepEqual(await readSettings({ env: box.env }), { state: 'invalid' }, 'writable by others');
  await rm(path);
  const elsewhere = join(box.dir, 'elsewhere.json');
  await writeFile(elsewhere, '{"version":1,"codePass":true}\n', { mode: 0o600 });
  await symlink(elsewhere, path);
  assert.deepEqual(await readSettings({ env: box.env }), { state: 'invalid' }, 'a link is never followed');
  await rm(path);
  await mkdir(path);
  assert.deepEqual(await readSettings({ env: box.env }), { state: 'invalid' }, 'a folder');
});

test('the flag, then the setting, then the default; an unreadable setting stops only a review given no flag',
  async (t) => {
    const box = await scratch(t);
    const where = { env: box.env, home: box.home };
    assert.deepEqual(await resolveCodePass(where), { on: true, source: 'default' });
    assert.deepEqual(await resolveCodePass({ ...where, flag: false }), { on: false, source: 'flag' });
    await config(box, ['code-pass', 'off']);
    assert.deepEqual(await resolveCodePass(where), { on: false, source: 'config' });
    assert.deepEqual(await resolveCodePass({ ...where, flag: true }), { on: true, source: 'flag' });
    await config(box, ['code-pass', 'on']);
    assert.deepEqual(await resolveCodePass(where), { on: true, source: 'config' });
    assert.deepEqual(await resolveCodePass({ ...where, flag: false }), { on: false, source: 'flag' });
    await writeFile(settingsPath(where), 'not json\n', { mode: 0o600 });
    await assert.rejects(resolveCodePass(where), { code: 'config_invalid' });
    assert.ok(CLI_SAFE_ERROR_CODES.includes('config_invalid'), 'a code the review may print by name');
    for (const flag of [true, false]) assert.deepEqual(await resolveCodePass({ ...where, flag }), { on: flag, source: 'flag' });
  });

test('sonah config shows the setting, sets it, says how to change it, and refuses anything else', async (t) => {
  const box = await scratch(t);
  const path = settingsPath({ env: box.env });
  const shown = await config(box, []);
  assert.deepEqual([shown.code, shown.stdout, shown.stderr], [0, 'code-pass: on (the default). A review also runs the '
    + 'code step: a review agent reads the repository with read-only tools and reviews the session\'s change. Change it '
    + 'with sonah config code-pass off, or for one review with --no-code-pass.\n', '']);
  await assert.rejects(stat(box.env.SONAH_HOME), { code: 'ENOENT' }, 'showing writes nothing');
  const off = await config(box, ['code-pass', 'off']);
  assert.deepEqual([off.code, off.stdout], [0, `code-pass: off (set in ${path}). A review reads and sends the session `
    + 'only. Change it with sonah config code-pass on, or for one review with --code-pass.\n']);
  assert.equal((await config(box, [])).stdout, off.stdout);
  const on = await config(box, ['code-pass', 'on']);
  assert.match(on.stdout, new RegExp(`^code-pass: on \\(set in ${path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\)\\. `));
  for (const argv of [['code-pass'], ['code-pass', 'yes'], ['code-pass', 'off', 'on'], ['other', 'on'], ['--code-pass']]) {
    const bad = await config(box, argv);
    assert.deepEqual([bad.code, bad.stdout, bad.stderr], [2, '', 'usage: sonah config [code-pass on|off]\n'], argv.join(' '));
  }
  assert.equal(await readFile(path, 'utf8'), '{"version":1,"codePass":true}\n', 'a refused command changes nothing');
  // An unreadable file: `sonah config` says so and how to fix it (exit 1), and setting it writes it again.
  await writeFile(path, '{"version":1,"codePass":maybe}\n');
  const unreadable = await config(box, []);
  assert.deepEqual([unreadable.code, unreadable.stdout], [1, `code-pass: the settings file ${path} could not be read. `
    + 'Fix: run sonah config code-pass on or sonah config code-pass off to write it again.\n']);
  assert.equal((await config(box, ['code-pass', 'off'])).code, 0);
  assert.equal(await readFile(path, 'utf8'), '{"version":1,"codePass":false}\n');
  // A folder that cannot be written: exit 3, and the fix.
  const blocked = await scratch(t);
  await writeFile(blocked.env.SONAH_HOME, 'a file where the folder should be');
  const failed = await config(blocked, ['code-pass', 'off']);
  assert.equal(failed.code, 3);
  assert.match(failed.stderr, /^sonah config: the settings file .* could not be written\. Fix: /);
});

test('the installed command: sonah config is dispatched, and its --help writes nothing', async (t) => {
  const box = await scratch(t);
  const run = (args) => exec(process.execPath, [BIN, ...args], { env: { ...box.env, PATH: '/usr/bin:/bin' },
    cwd: box.home }).then((r) => ({ code: 0, ...r }), (e) => ({ code: e.code, stdout: e.stdout, stderr: e.stderr }));
  const help = await run(['config', '--help']);
  assert.equal(help.code, 0);
  assert.match(help.stdout, /^ {2}sonah config code-pass off {3}turn the code step off \(on turns it on\)$/m);
  assert.match(help.stdout, /sonah config code-pass off, or add --no-code-pass to one review\./);
  await assert.rejects(stat(box.env.SONAH_HOME), { code: 'ENOENT' });
  const off = await run(['config', 'code-pass', 'off']);
  assert.equal(off.code, 0);
  assert.match(off.stdout, /^code-pass: off \(set in /);
  assert.equal((await run(['config', 'code-pass'])).code, 2);
});

/** One `sonah review` of the synthetic session over its files, with the scratch home's settings. */
async function review(t, box, { root, argv = [], loadSession } = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'sonah-code-step-review-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const file = join(dir, 'recording.jsonl');
  await writeFile(file, '{}\n');
  const out = streams(), calls = [];
  const judge = codeJudge({ check: contradictClaim, pass: findEmptyInput });
  const code = await runSessionReviewCommand([file, '--concurrency', '1', '--state-dir', join(dir, 'state'),
    '--format', 'md', '--output', join(dir, 'story.md'), ...argv], {
    ...out, cwd: root, env: box.env, installSignals: false, loadReviews: async () => new Map(), openPage: async () => {},
    loadSession: loadSession ?? (async () => ({ session: codeSession(), hash: sha256('synthetic'), cwd: root })),
    createJudge: ({ onResult }) => async (request) => {
      calls.push(request);
      onResult({ ok: true, backend: 'claude-cli', attestation: 'attested', contextWindow: 1_000_000 });
      return judge(request);
    } });
  return { code, calls, ...out.chunks };
}
/** The session's requests, as their bytes, sorted: one lane does not fix the order of a challenge's passes, which start
 *  together and each read the answer store first, so under load p3 can be sent before p2 (lean-default.test.js). */
const sessionPart = (calls) => calls.filter((r) => !CODE_LABEL.test(r.label))
  .map((r) => JSON.stringify([r.label, r.system, r.prompt])).sort();
const codePart = (calls) => calls.filter((r) => CODE_LABEL.test(r.label));

test('a review follows the setting, the flag overrides it, and the session part is the same bytes every way',
  async (t) => {
    const root = await repoWith(t);
    const box = await scratch(t);
    const runs = {};
    runs.byDefault = await review(t, box, { root });
    await config(box, ['code-pass', 'off']);
    runs.settingOff = await review(t, box, { root });
    runs.flagOn = await review(t, box, { root, argv: ['--code-pass'] });
    await config(box, ['code-pass', 'on']);
    runs.settingOn = await review(t, box, { root });
    runs.flagOff = await review(t, box, { root, argv: ['--no-code-pass'] });
    for (const [name, run] of Object.entries(runs)) assert.equal(run.code, 0, `${name}: ${run.stderr}`);
    const session = sessionPart(runs.byDefault.calls);
    assert.ok(session.length > 0);
    for (const [name, run] of Object.entries(runs))
      assert.deepEqual(sessionPart(run.calls), session, `${name}: the session's requests, byte for byte`);
    for (const name of ['byDefault', 'flagOn', 'settingOn']) assert.ok(codePart(runs[name].calls).length > 0, name);
    for (const name of ['settingOff', 'flagOff']) assert.deepEqual(codePart(runs[name].calls), [], name);
    // The estimate's companion line names where the setting came from.
    assert.match(runs.byDefault.stdout, /^Code review: on \(the default\)\. [^\n]*It adds one review call, and one check call for each finding/m);
    assert.match(runs.settingOff.stdout, /^Code review: off \(your setting, sonah config\)\. Sonah reviews only the session, and reads or sends no file\. Turn it on with --code-pass, or for every review with sonah config code-pass on\.$/m);
    assert.match(runs.flagOn.stdout, /^Code review: on \(--code-pass\)\. /m);
    assert.match(runs.settingOn.stdout, /^Code review: on \(your setting, sonah config\)\. /m);
    assert.match(runs.flagOff.stdout, /^Code review: off \(--no-code-pass\)\. /m);
    // It follows the estimate, before the first call.
    assert.match(runs.byDefault.stdout, /^This review should take roughly [^\n]*\nCode review: on /m);
  });

test('an unreadable setting stops a review with no flag before anything is read; a flag still runs it', async (t) => {
  const root = await repoWith(t);
  const box = await scratch(t);
  await mkdir(box.env.SONAH_HOME, { recursive: true });
  await writeFile(settingsPath({ env: box.env }), '{"version":1,"codePass":"no"}\n', { mode: 0o600 });
  for (const argv of [[], ['--dry-run']]) {
    const stopped = await review(t, box, { root, argv,
      loadSession: async () => assert.fail('nothing is read before the setting is known') });
    assert.equal(stopped.code, 2, argv.join(' '));
    assert.deepEqual(stopped.calls, []);
    assert.equal(stopped.stderr, 'Review could not complete: config_invalid.\nFix: Sonah could not read your settings file, '
      + 'so it read and sent nothing. To write the file again, run sonah config code-pass on or sonah config code-pass '
      + 'off. Or add --code-pass or --no-code-pass to this review.\n');
  }
  const flagged = await review(t, box, { root, argv: ['--no-code-pass'] });
  assert.equal(flagged.code, 0);
  assert.deepEqual(codePart(flagged.calls), []);
});

test('a dry run says whether the step runs and roughly what it adds, and sends nothing', async (t) => {
  const root = await repoWith(t);
  const box = await scratch(t);
  const on = await review(t, box, { root, argv: ['--dry-run'] });
  assert.equal(on.code, 0);
  assert.deepEqual(on.calls, []);
  assert.match(on.stdout, /^A review should take roughly [^\n]*\nCode review: on \(the default\)\. It reviews the change with read-only access to the whole repository \(Read, Grep, Glob\)\. It adds one review call, and one check call for each finding\. /m);
  assert.match(on.stdout, /^Code review: the change holds \d+ paths? that the session changed/m, 'and what it would read');
  await assert.rejects(stat(box.env.SONAH_HOME), { code: 'ENOENT' }, 'a dry run writes no setting');
  await config(box, ['code-pass', 'off']);
  const off = await review(t, box, { root, argv: ['--dry-run'] });
  assert.match(off.stdout, /^A review should take roughly [^\n]*\nCode review: off \(your setting, sonah config\)\. /m);
  assert.doesNotMatch(off.stdout, /^Code review: the change holds/m, 'off: no file is read');
  // The line's words: no call is promised where there is no change to review.
  assert.match(codeStepLine({ on: true, source: 'default' }, { root: true, files: [] }),
    /It found no change to review here, so it adds no call\./);
  assert.match(codeStepLine({ on: true, source: 'default' }, { root: true, files: [{ path: 'a.js', diff: 'withheld' }] }),
    /It found no change to review here/);
  assert.match(codeStepLine({ on: true, source: 'config' }, { root: true, files: [{ path: 'a.js', diff: 'recorded' }] }),
    /It adds one review call, and one check call for each finding/);
});

test('sonah doctor reports the setting, and an unreadable one needs attention', async (t) => {
  const box = await scratch(t);
  const missing = () => Promise.reject(Object.assign(new Error('absent'), { code: 'ENOENT' }));
  const dependencies = { env: { ...box.env, PATH: '/synthetic/bin', SONAH_CODEX_BIN: '/synthetic/bin/codex' },
    home: box.home, nodeVersion: '20.0.0', runCli: missing,
    adapters: async () => ({ claude: { count: 1, where: 'claude' }, codex: { count: 0, where: 'codex' } }) };
  const lineOf = (text) => text.split('\n').find((line) => line.startsWith('Code step (code-pass): '));
  const byDefault = await doctor({ probe: false }, dependencies);
  assert.equal(lineOf(byDefault.text), 'Code step (code-pass): on (the default). A review also runs the code step: a '
    + 'review agent reads the repository with read-only tools and reviews the session\'s change. Change it with sonah '
    + 'config code-pass off, or for one review with --no-code-pass.');
  assert.deepEqual(byDefault.facts.settings, { state: 'absent', codePass: true });
  assert.ok(!byDefault.attention.includes('settings'));
  await config(box, ['code-pass', 'off']);
  const off = await doctor({ probe: false }, dependencies);
  assert.match(lineOf(off.text), /^Code step \(code-pass\): off \(set in .*config\.json\)\. A review reads and sends the session only\./);
  assert.deepEqual(off.facts.settings, { state: 'ok', codePass: false });
  await writeFile(settingsPath({ env: box.env }), '{}\n');
  const unreadable = await doctor({ probe: false }, dependencies);
  assert.match(lineOf(unreadable.text), /^Code step \(code-pass\): the settings file .* could not be read\. Fix: run sonah config code-pass on or sonah config code-pass off to write it again\.$/);
  assert.ok(unreadable.attention.includes('settings'));
  assert.equal(unreadable.healthy, false);
  assert.deepEqual(unreadable.facts.settings, { state: 'invalid', codePass: null });
});
