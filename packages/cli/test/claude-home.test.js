// W3d-8 (F178): where Claude Code keeps its recordings and its settings — one rule, one place.
//
// Sonah linked a parent recording to its sub-agent transcripts only when the parent sat under
// ~/.claude/projects: the root was a literal in seven places. A copy of a recording (and a review
// must run on a stable file, which a live session is not) lost every child, and a user who set
// CLAUDE_CONFIG_DIR lost every child and had `sonah init` write hooks into a settings.json Claude
// Code was not reading.
//
// Synthetic throughout. The path functions are pure and get their env and home passed in. The
// end-to-end cases run in a child process whose whole environment is written here — HOME
// included — so neither the real ~/.claude nor this process's environment is ever consulted, and
// nothing is set on process.env. The probe prints counts and statuses only, never session text.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, mkdir, writeFile, readFile, rm, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, isAbsolute } from 'node:path';
import { claudeConfigDir, claudeProjectsDir, harnessHomePlaces } from '../src/claude-home.js';
import { detectAdapters } from '../src/doctor.js';

const exec = promisify(execFile);
const HOME = '/synthetic/machine';
const where = (env) => ({ config: claudeConfigDir({ env, home: HOME }), projects: claudeProjectsDir({ env, home: HOME }) });

// ---- the rule ----------------------------------------------------------------------------

const MATRIX = [
  ['neither variable', {},
    { config: '/synthetic/machine/.claude', projects: '/synthetic/machine/.claude/projects' }],
  ['CLAUDE_CONFIG_DIR only', { CLAUDE_CONFIG_DIR: '/synthetic/c' },
    { config: '/synthetic/c', projects: '/synthetic/c/projects' }],
  ['SONAH_CLAUDE_PROJECTS only (the config dir stays put)', { SONAH_CLAUDE_PROJECTS: '/synthetic/p' },
    { config: '/synthetic/machine/.claude', projects: '/synthetic/p' }],
  ['both (SONAH_CLAUDE_PROJECTS never moves the config dir)', { CLAUDE_CONFIG_DIR: '/synthetic/c', SONAH_CLAUDE_PROJECTS: '/synthetic/p' },
    { config: '/synthetic/c', projects: '/synthetic/p' }],
  ['empty strings behave as unset', { CLAUDE_CONFIG_DIR: '', SONAH_CLAUDE_PROJECTS: '' },
    { config: '/synthetic/machine/.claude', projects: '/synthetic/machine/.claude/projects' }],
  ['a trailing slash is normalised', { CLAUDE_CONFIG_DIR: '/synthetic/c/', SONAH_CLAUDE_PROJECTS: '/synthetic/p/' },
    { config: '/synthetic/c', projects: '/synthetic/p' }],
];

for (const [name, env, expected] of MATRIX) {
  test(`claude home: ${name}`, () => {
    assert.deepEqual(where(env), expected);
  });
}

test('claude home: relative values are resolved to absolute paths', () => {
  const env = { CLAUDE_CONFIG_DIR: 'rel/config', SONAH_CLAUDE_PROJECTS: './rel/projects' };
  const got = where(env);
  assert.deepEqual(got, { config: resolve('rel/config'), projects: resolve('rel/projects') });
  for (const path of Object.values(got)) assert.ok(isAbsolute(path), path);
  assert.equal(claudeProjectsDir({ env: { CLAUDE_CONFIG_DIR: 'rel/config' }, home: HOME }),
    join(resolve('rel/config'), 'projects'));
});

test('claude home: the rule reads only the env it is given, and the home only when the env is silent', () => {
  // A non-string (a caller's typo, an injected object) is not a path: it is unset, not "undefined".
  assert.deepEqual(where({ CLAUDE_CONFIG_DIR: undefined, SONAH_CLAUDE_PROJECTS: null }), MATRIX[0][2]);
  assert.equal(claudeConfigDir({ env: { CLAUDE_CONFIG_DIR: '/synthetic/c' }, home: '/elsewhere' }), '/synthetic/c');
  assert.equal(claudeConfigDir({ env: {}, home: '/elsewhere' }), '/elsewhere/.claude');
});

test('the coding agents\' homes: Claude Code\'s folder and state file, as the review\'s own agents and the person\'s set them, and Codex\'s', () => {
  assert.deepEqual(harnessHomePlaces({ env: {}, home: '/h' }), ['/h/.claude', '/h/.claude.json', '/h/.codex']);
  // CLAUDE_CONFIG_DIR keeps the person's sessions (and its own .claude.json) elsewhere; the review's agents run with HOME.
  assert.deepEqual(harnessHomePlaces({ env: { CLAUDE_CONFIG_DIR: '/c', CODEX_HOME: 'x' }, home: '/h' }),
    ['/c', '/h/.claude', '/h/.claude.json', resolve('x')]);
  assert.ok(harnessHomePlaces({ env: { CLAUDE_CONFIG_DIR: '', CODEX_HOME: '' }, home: '/h' }).every(isAbsolute));
});

// (packages/pr's own copy of the rule was checked here; packages/pr is retired with `sonah pr`, owner decision
// 2026-10-06.)

test('no CLI call site keeps its own copy of the ~/.claude rule', async () => {
  for (const file of ['../index.js', '../bin/sonah.js', '../src/doctor.js', '../src/session-evidence.js']) {
    const source = await readFile(new URL(file, import.meta.url), 'utf8');
    assert.ok(!/['"]\.claude['"]/.test(source), `${file} still joins '.claude' itself`);
  }
});

// ---- doctor's counts ------------------------------------------------------------------------

async function scratch(t, label) {
  const dir = await realpath(await mkdtemp(join(tmpdir(), `sonah ${label} `)));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return dir;
}

test('CLAUDE_CONFIG_DIR moves the root doctor counts', async (t) => {
  const dir = await scratch(t, 'claude config dir');
  const home = join(dir, 'home'), config = join(dir, 'c');
  await mkdir(home);
  const env = { CLAUDE_CONFIG_DIR: config };
  assert.equal(claudeProjectsDir({ env, home }), join(config, 'projects'));
  const adapters = await detectAdapters({ home, env, codexHome: join(home, '.codex') });
  assert.equal(adapters.claude.where, join(config, 'projects'));

  const moved = { ...env, SONAH_CLAUDE_PROJECTS: join(dir, 'p') };
  // F180: doctor reports the LIVE install. A review's copy is not where Claude Code records.
  assert.equal((await detectAdapters({ home, env: moved, codexHome: join(home, '.codex') })).claude.where,
    join(config, 'projects'), 'SONAH_CLAUDE_PROJECTS never moves what the live install detects');
});

test('an injected home is a stand-in machine: the ambient CLAUDE_CONFIG_DIR never redirects it', async (t) => {
  // The temp homes the doctor tests hand to detectAdapters would otherwise be redirected into the real config dir of
  // whoever runs the suite with the variable set.
  const dir = await scratch(t, 'claude ambient');
  const home = join(dir, 'home'), stand = join(dir, 'stand-in');
  await mkdir(home); await mkdir(stand);
  const probe = `
    const doctor = await import(${JSON.stringify(new URL('../src/doctor.js', import.meta.url).href)});
    const home = await import(${JSON.stringify(new URL('../src/claude-home.js', import.meta.url).href)});
    const [stand] = process.argv.slice(1);
    process.stdout.write(JSON.stringify({
      injectedProjects: (await doctor.detectAdapters({ home: stand, codexHome: stand })).claude.where,
      ambientProjects: (await doctor.detectAdapters({ codexHome: stand })).claude.where,
      defaults: home.claudeProjectsDir(),
    }));`;
  const { stdout } = await exec(process.execPath, ['--input-type=module', '-e', probe, stand], {
    env: { HOME: home, SONAH_HOME: join(dir, 'sonah'), TMPDIR: tmpdir(), PATH: process.env.PATH,
      CLAUDE_CONFIG_DIR: join(dir, 'ambient') } });
  assert.deepEqual(JSON.parse(stdout), {
    injectedProjects: join(stand, '.claude', 'projects'),
    ambientProjects: join(dir, 'ambient', 'projects'),
    defaults: join(dir, 'ambient', 'projects'),
  });
});

// ---- a copied recording, synthetic -----------------------------------------------------------
//
// The B2 fixture from child-recordings.test.js: the layout and receipt Claude Code writes — a
// prose Agent result naming the agentId, and the child at <slug>/<session>/subagents/.

const SID = 'e3f1c2d4-1111-4222-8333-abcdefabcdef', AGENT = '0123456789abcdef';
const save = (file, rows) => writeFile(file, rows.map((r) => JSON.stringify(r)).join('\n') + '\n', { mode: 0o600 });
const user = (text) => ({ type: 'user', message: { content: text } });
const call = (id, name, input) => ({ type: 'assistant', message: { content: [{ type: 'tool_use', id, name, input }] } });
const result = (id, content) => ({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: id, content }] } });
const launch = (id, agentId) => [call(id, 'Agent', { prompt: 'private child brief' }),
  result(id, `Async agent launched.\nagentId: ${agentId}\nUse SendMessage to reach it.`)];

/** <root>/<slug>/<session>.jsonl + <root>/<slug>/<session>/subagents/agent-<id>.jsonl */
async function recordingTree(root) {
  const project = join(root, '-synthetic-repo'), nested = join(project, SID, 'subagents');
  await mkdir(nested, { recursive: true });
  const parent = join(project, `${SID}.jsonl`);
  await save(parent, [user('Read the parser.'), user('Now delegate the migration.'), ...launch('spawn-0', AGENT)]
    .map((r) => ({ cwd: '/repo', sessionId: SID, isSidechain: false, ...r })));
  await save(join(nested, `agent-${AGENT}.jsonl`), [user('Write src/0123.js'),
    call('child-write', 'Write', { file_path: 'src/0123.js', content: 'const attempts = 3;' }), result('child-write', 'written')]
    .map((r) => ({ cwd: '/repo', sessionId: SID, agentId: AGENT, isSidechain: true, ...r })));
  return parent;
}

const PROBE = `
  const evidence = await import(${JSON.stringify(new URL('../src/session-evidence.js', import.meta.url).href)});
  const cli = await import(${JSON.stringify(new URL('../index.js', import.meta.url).href)});
  const { redact } = await import(${JSON.stringify(new URL('../../redact/index.js', import.meta.url).href)});
  const { sessionFromLedger } = await import(${JSON.stringify(new URL('../../evidence/adapters/sonah-ledger.js', import.meta.url).href)});
  const facts = (ledger) => ({
    statuses: (ledger.delegations ?? []).map((d) => d.status),
    children: (ledger.children ?? []).length,
    missingChild: sessionFromLedger(ledger).adapterGaps.filter((g) => g.code === 'missing_child').length,
    incompleteChild: sessionFromLedger(ledger).adapterGaps.filter((g) =>
      g.code === 'incomplete_inventory' && g.channel === 'children' && g.delegationUnresolved === true).length,
  });
  const out = {};
  for (const file of process.argv.slice(1)) {
    const loaded = redact(await evidence.loadSessionEvidence([file])).ledger;
    const { ledger } = await cli.analyze([file]);
    out[file] = { loadSessionEvidence: facts(loaded), analyze: facts(ledger) };
  }
  process.stdout.write(JSON.stringify(out));`;

async function probe(dir, files, vars = {}) {
  const { stdout } = await exec(process.execPath, ['--input-type=module', '-e', PROBE, ...files], {
    env: { HOME: join(dir, 'home'), SONAH_HOME: join(dir, 'sonah'), TMPDIR: tmpdir(), PATH: process.env.PATH, ...vars },
    maxBuffer: 4 * 1024 * 1024 });
  return JSON.parse(stdout);
}

const LINKED = { statuses: ['linked'], children: 1, missingChild: 0, incompleteChild: 0 };
const both = (facts) => ({ loadSessionEvidence: facts, analyze: facts });

test('a copied recording links its sub-agent when SONAH_CLAUDE_PROJECTS names the copy', async (t) => {
  const dir = await scratch(t, 'claude copy');
  await mkdir(join(dir, 'home'));
  const copy = await recordingTree(join(dir, 'p'));

  // A copy outside a verified recordings namespace cannot establish a complete child inventory.
  // The unresolved hand-off is an incomplete inventory, not proof that a child is missing.
  const without = await probe(dir, [copy]);
  assert.equal(without[copy].analyze.children, 0);
  assert.notDeepEqual(without[copy].analyze.statuses, ['linked']);
  assert.equal(without[copy].analyze.missingChild, 0);
  assert.equal(without[copy].analyze.incompleteChild, 1);
  assert.deepEqual(without[copy].loadSessionEvidence, without[copy].analyze);

  const moved = await probe(dir, [copy], { SONAH_CLAUDE_PROJECTS: join(dir, 'p') });
  assert.deepEqual(moved[copy], both(LINKED));
});

test('CLAUDE_CONFIG_DIR is where Claude Code keeps recordings, and the default under HOME still links', async (t) => {
  const dir = await scratch(t, 'claude config recordings');
  const configured = await recordingTree(join(dir, 'c', 'projects'));
  const standard = await recordingTree(join(dir, 'home', '.claude', 'projects'));

  const set = await probe(dir, [configured], { CLAUDE_CONFIG_DIR: join(dir, 'c') });
  assert.deepEqual(set[configured], both(LINKED));

  const unset = await probe(dir, [standard]);
  assert.deepEqual(unset[standard], both(LINKED), 'the default root is HOME/.claude/projects, as before');
});

// F180: adapter detection reads the LIVE recordings. SONAH_CLAUDE_PROJECTS points a review at a copy; a user who
// exports it in their shell must not have `sonah doctor` count the copy instead of where Claude Code records.
test('the live projects root ignores SONAH_CLAUDE_PROJECTS and follows CLAUDE_CONFIG_DIR', async () => {
  const { claudeLiveProjectsDir } = await import('../src/claude-home.js');
  assert.equal(claudeLiveProjectsDir({ env: { SONAH_CLAUDE_PROJECTS: '/synthetic/copy' }, home: HOME }),
    join(HOME, '.claude', 'projects'));
  assert.equal(claudeLiveProjectsDir({ env: { SONAH_CLAUDE_PROJECTS: '/synthetic/copy', CLAUDE_CONFIG_DIR: '/synthetic/cfg' }, home: HOME }),
    join('/synthetic/cfg', 'projects'));
  assert.equal(claudeLiveProjectsDir({ env: {}, home: HOME }), claudeProjectsDir({ env: {}, home: HOME }));
});
