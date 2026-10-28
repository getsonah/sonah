// D151: every claude process Sonah starts gets one environment (review-judge.js `claudeEnvironment`): the person's
// CLAUDE_CONFIG_DIR (an absolute one exactly as written, a relative one resolved) and CLAUDE_CODE_OAUTH_TOKEN kept, so
// a call signs in with the login of the folder Sonah reads the recordings from; safe mode and the CLAUDE.md switch on every model call; nothing else of the person's. The
// argv does not move, so no answer key does. Every byte here is synthetic: the spawn and doctor's commands are injected,
// no CLI or model is started, and no real ~/.claude is read.
import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { createHash } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { CHALLENGE_MAX_OUTPUT_TOKENS, CLI_SAFE_MODE_VARIABLE, REVIEW_AGENT_TRANSPORT_VERSION, REVIEW_TRANSPORT_VERSION,
  agentRequestOf, claudeEnvironment, createReviewJudge, reviewAgentCliArgs, reviewCliArgs } from '../src/review-judge.js';
import { answerKey } from '../src/answer-cache.js';
import { DOCTOR_CLAUDE_WORDS, SAFE_MODE_CHECK, claudeLoginLines, doctor } from '../src/doctor.js';
import { SESSION_REVIEW_CLAUDE_CLI_MODEL } from '../../evidence/src/run-review.js';

const MODEL = 'claude-synthetic-5-5';
const SYSTEM = 'D151_SYNTHETIC_SYSTEM';
const SCHEMA = Object.freeze({ type: 'object', additionalProperties: false, required: ['exports'],
  properties: { exports: { type: 'array', items: { type: 'string' } } } });
const TOKEN = 'D151_SYNTHETIC_SETUP_TOKEN';

/** What the person's shell holds beside the account names: none of it reaches a claude process. Their own values of
 *  Sonah's settings are overridden. */
const NOISE = Object.freeze({ ANTHROPIC_API_KEY: 'synthetic', ANTHROPIC_AUTH_TOKEN: 'synthetic',
  ANTHROPIC_BASE_URL: 'https://example.invalid', CLAUDE_CODE_USE_BEDROCK: '1', CLAUDE_CODE_SIMPLE: '1',
  HTTPS_PROXY: 'http://proxy.invalid', SONAH_CLAUDE_PROJECTS: '/synthetic/recording-copy', SONAH_HOME: '/synthetic/s',
  CLAUDE_CODE_OAUTH_TOKEN_FILE_DESCRIPTOR: '3', CLAUDE_CODE_MAX_OUTPUT_TOKENS: '99', CLAUDE_CODE_SAFE_MODE: '0',
  CLAUDE_CODE_DISABLE_CLAUDE_MDS: '0', CLAUDE_CODE_DISABLE_AUTO_MEMORY: '0' });
const BASE = Object.freeze({ HOME: '/synthetic/home', PATH: '/synthetic/bin', USER: 'synthetic-user', LANG: 'C' });

/** The person's CLAUDE_CONFIG_DIR, and what every claude process is given for it: an absolute value exactly as
 *  written, since Claude Code names a login after the variable's own string (2.1.310: the macOS keychain entry is named
 *  after a hash of it, unresolved); a relative one resolved against Sonah's working folder. */
const FOLDERS = [
  ['absolute', '/synthetic/claude-work', '/synthetic/claude-work'],
  ['relative', 'rel/claude-work', resolve('rel/claude-work')],
  ['a trailing slash, as written', '/synthetic/claude-work/', '/synthetic/claude-work/'],
  ['a doubled slash, as written', '/synthetic//claude-work', '/synthetic//claude-work'],
  ['a dot segment, as written', '/synthetic/./claude-work', '/synthetic/./claude-work'],
  ['empty', '', undefined],
  ['unset', undefined, undefined],
];
const TOKENS = [['set', TOKEN, TOKEN], ['empty', '', undefined], ['unset', undefined, undefined]];

const personEnv = (folder, token) => ({ ...BASE, ...NOISE, ...(folder === undefined ? {} : { CLAUDE_CONFIG_DIR: folder }),
  ...(token === undefined ? {} : { CLAUDE_CODE_OAUTH_TOKEN: token }) });
/** The exact account part every claude process gets. */
const accountEnv = (folder, token) => ({ ...BASE, ...(folder === undefined ? {} : { CLAUDE_CONFIG_DIR: folder }),
  ...(token === undefined ? {} : { CLAUDE_CODE_OAUTH_TOKEN: token }) });
/** The exact environment of a model call: the account part and Sonah's own settings. */
const callEnv = (folder, token, extra = {}) => ({ ...accountEnv(folder, token), CLAUDE_CODE_DISABLE_TERMINAL_TITLE: '1',
  CLAUDE_CODE_DISABLE_REFUSAL_FALLBACK: '1', CLAUDE_CODE_DISABLE_AUTO_MEMORY: '1', CLAUDE_CODE_SAFE_MODE: '1',
  CLAUDE_CODE_DISABLE_CLAUDE_MDS: '1', ...extra });

/** A spawn that records each call's argv, working directory and environment, then fails the call (exit 1): only what
 *  the judge started it with is read. */
function capturingSpawn() {
  const calls = [];
  const spawnProcess = (command, args, options) => {
    calls.push({ command, args, cwd: options.cwd, env: options.env });
    const child = new EventEmitter();
    child.stdin = new PassThrough(); child.stdout = new PassThrough(); child.stderr = new PassThrough();
    child.kill = () => true;
    child.stdin.resume();
    child.stdin.on('end', () => setImmediate(() => child.emit('close', 1, null)));
    return child;
  };
  return { calls, spawnProcess };
}

async function scratch(t) {
  const dir = await mkdtemp(join(tmpdir(), 'sonah d151-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return dir;
}

const requests = (root) => ({
  session: { system: SYSTEM, prompt: 'D151_SYNTHETIC_PROMPT', label: 'narrative:w1' },
  challenge: { system: SYSTEM, prompt: 'D151_SYNTHETIC_CHALLENGE_PROMPT', label: 'challenge:w1:b1:p1', schema: SCHEMA,
    challenge: { items: [], pass: 1, batchIndex: 0 } },
  agent: { system: SYSTEM, prompt: 'D151_SYNTHETIC_PROMPT', label: 'code-review:agent', schema: SCHEMA,
    agent: { root, addDirs: [], maxTurns: 3 } },
});

// ---- the environment of each call kind, exactly ---------------------------------------------------------------------
test('D151: a session, a challenge and an agent call each get exactly the account part and Sonah\'s settings, for '
  + 'every CLAUDE_CONFIG_DIR and CLAUDE_CODE_OAUTH_TOKEN the person may have', async (t) => {
  const root = await scratch(t);
  for (const [folderCase, folder, given] of FOLDERS) for (const [tokenCase, token, kept] of TOKENS) {
    const fake = capturingSpawn();
    const judge = createReviewJudge({ config: { backend: 'claude-cli', model: MODEL }, env: personEnv(folder, token),
      spawnProcess: fake.spawnProcess });
    const sent = requests(root);
    for (const kind of ['session', 'challenge', 'agent']) await judge(sent[kind]).catch(() => {});
    const [session, challenge, agent] = fake.calls;
    const why = `CLAUDE_CONFIG_DIR ${folderCase}, CLAUDE_CODE_OAUTH_TOKEN ${tokenCase}`;
    assert.equal(fake.calls.length, 3, why);
    assert.deepEqual(session.env, callEnv(given, kept), `session: ${why}`);
    assert.deepEqual(challenge.env, callEnv(given, kept,
      { CLAUDE_CODE_MAX_OUTPUT_TOKENS: String(CHALLENGE_MAX_OUTPUT_TOKENS) }), `challenge: ${why}`);
    assert.deepEqual(agent.env, callEnv(given, kept), `agent: ${why}`);
    assert.equal(agent.cwd, root, 'an agent runs in its repository, where a relative folder would name another one');
    // The builder itself, called as the transport calls it.
    assert.deepEqual(claudeEnvironment(personEnv(folder, token), { request: sent.session }), callEnv(given, kept), why);
    assert.deepEqual(claudeEnvironment(personEnv(folder, token), { accountOnly: true }), accountEnv(given, kept), why);
  }
});

test('D151: an absolute CLAUDE_CONFIG_DIR reaches the child exactly as written, so its keychain login does too',
async (t) => {
  const root = await scratch(t);
  for (const written of ['/synthetic/claude-work/', '/synthetic/./claude-work', '/synthetic//claude-work']) {
    const fake = capturingSpawn();
    const judge = createReviewJudge({ config: { backend: 'claude-cli', model: MODEL }, env: personEnv(written),
      spawnProcess: fake.spawnProcess });
    const sent = requests(root);
    for (const kind of ['session', 'challenge', 'agent']) await judge(sent[kind]).catch(() => {});
    const { commands, probes } = await doctorRun(personEnv(written));
    for (const env of [...fake.calls, ...commands, ...probes].map((call) => call.env)) {
      assert.equal(env.CLAUDE_CONFIG_DIR, written, written);
      assert.notEqual(env.CLAUDE_CONFIG_DIR, resolve(written), 'never its resolved spelling');
    }
    assert.equal(fake.calls.length + commands.length + probes.length, 8, written);
  }
});

test('D151: a relative CLAUDE_CONFIG_DIR is given as the absolute folder Sonah reads, never as written', async (t) => {
  const root = await scratch(t);
  const fake = capturingSpawn();
  await createReviewJudge({ config: { backend: 'claude-cli', model: MODEL }, env: personEnv('rel/claude-work'),
    spawnProcess: fake.spawnProcess })(requests(root).agent).catch(() => {});
  assert.equal(fake.calls[0].env.CLAUDE_CONFIG_DIR, join(process.cwd(), 'rel', 'claude-work'));
  assert.ok(fake.calls[0].env.CLAUDE_CONFIG_DIR.startsWith('/'));
  assert.equal(CLI_SAFE_MODE_VARIABLE, 'CLAUDE_CODE_SAFE_MODE');
});

// ---- doctor: its checks and its probe use the same login ------------------------------------------------------------
/** doctor with injected commands and the real judge on a capturing spawn: `safeMode` is how the CLI answers the flag,
 *  `signedOut` whether `auth status` says signed out (exit 1 with its JSON), `home` doctor's injected home. */
async function doctorRun(env, { safeMode = 'accepted', probe = true, authReadable = true, signedOut = false,
  home = undefined } = {}) {
  const commands = [];
  const status = JSON.stringify({ loggedIn: !signedOut, authMethod: signedOut ? 'none' : 'claude.ai' });
  const runCli = async (file, args, options) => {
    commands.push({ file, args, env: options.env });
    if (file !== 'claude') throw Object.assign(new Error('absent'), { code: 'ENOENT' });
    if (args[0] === '--version') return { stdout: '2.1.310 (Claude Code)\n' };
    if (args.join(' ') === SAFE_MODE_CHECK.join(' ') && safeMode === 'refused')
      throw Object.assign(new Error('unknown option'), { code: 1, stdout: '' });
    if (!authReadable) return { stdout: 'unreadable' };
    if (signedOut) throw Object.assign(new Error('signed out'), { code: 1, stdout: status });
    return { stdout: status };
  };
  const fake = capturingSpawn();
  const result = await doctor({ probe }, { env, ...(home === undefined ? {} : { home }), nodeVersion: '20.0.0', runCli,
    createJudge: (options) => createReviewJudge({ ...options, spawnProcess: fake.spawnProcess }),
    adapters: async () => ({ claude: { count: 1, where: 'x' }, codex: { count: 0, where: 'y' } }),
    commitLink: async () => null });
  return { result, commands: commands.filter((c) => c.file === 'claude'), probes: fake.calls };
}

test('D151: doctor\'s four checks get the account part and its probe the call environment, on the same config folder '
  + 'and token as the review\'s calls', async () => {
  for (const [folderCase, folder, given] of FOLDERS) for (const [tokenCase, token, kept] of TOKENS) {
    const why = `CLAUDE_CONFIG_DIR ${folderCase}, CLAUDE_CODE_OAUTH_TOKEN ${tokenCase}`;
    const { commands, probes } = await doctorRun(personEnv(folder, token));
    assert.deepEqual(commands.map((c) => c.args.join(' ')), ['--version', 'auth status',
      '--restricted --max-turns 1 --json-schema {"type":"object"} auth status', '--safe-mode auth status'], why);
    for (const command of commands) assert.deepEqual(command.env, accountEnv(given, kept), `${command.args[0]}: ${why}`);
    assert.equal(probes.length, 1, why);
    assert.deepEqual(probes[0].env, callEnv(given, kept), `the probe: ${why}`);
    assert.deepEqual(probes[0].args, reviewCliArgs({ system: probes[0].args.at(-1),
      model: SESSION_REVIEW_CLAUDE_CLI_MODEL }), 'the probe\'s argv is the session argv');
  }
});

// ---- doctor's lines ---------------------------------------------------------------------------------------------------
test('D151: doctor names the config folder Sonah\'s calls sign in from, and the setup-token login when it is set',
async () => {
  const words = DOCTOR_CLAUDE_WORDS.login;
  assert.equal(words.default('/synthetic/home/.claude'), 'Claude Code login: Sonah\'s Claude Code calls sign in from '
    + '/synthetic/home/.claude, the default config folder.');
  assert.equal(words.named('/synthetic/claude-work'), 'Claude Code login: Sonah\'s Claude Code calls sign in from '
    + '/synthetic/claude-work, the config folder that CLAUDE_CONFIG_DIR names.');
  assert.equal(words.token('/synthetic/claude-work'), 'Claude Code login: Sonah\'s Claude Code calls sign in with '
    + 'CLAUDE_CODE_OAUTH_TOKEN. Claude Code uses it in place of the login in /synthetic/claude-work.');
  assert.equal(words.relative, 'Sonah found a relative CLAUDE_CONFIG_DIR and gives its Claude Code calls the absolute '
    + 'folder that it names here. An absolute CLAUDE_CONFIG_DIR keeps its macOS keychain login in those calls.');
  const fact = (configDir, from, relative, token) => ({ configDir, from, relative, token });
  for (const [folder, token, lines, expected] of [
    [undefined, undefined, [words.default('/synthetic/home/.claude')],
      fact('/synthetic/home/.claude', 'default', false, false)],
    ['', '', [words.default('/synthetic/home/.claude')], fact('/synthetic/home/.claude', 'default', false, false)],
    // An absolute value: the folder it names, resolved, on the line; the calls get it as written.
    ['/synthetic/claude-work/', undefined, [words.named('/synthetic/claude-work')],
      fact('/synthetic/claude-work', 'CLAUDE_CONFIG_DIR', false, false)],
    // A relative value: the folder Sonah reads, and the neutral line on the keychain login.
    ['rel/claude-work', undefined, [words.named(resolve('rel/claude-work')), words.relative],
      fact(resolve('rel/claude-work'), 'CLAUDE_CONFIG_DIR', true, false)],
    ['rel/claude-work', TOKEN, [words.token(resolve('rel/claude-work'))],
      fact(resolve('rel/claude-work'), 'CLAUDE_CONFIG_DIR', true, true)],
    ['/synthetic/claude-work', TOKEN, [words.token('/synthetic/claude-work')],
      fact('/synthetic/claude-work', 'CLAUDE_CONFIG_DIR', false, true)],
    [undefined, TOKEN, [words.token('/synthetic/home/.claude')], fact('/synthetic/home/.claude', 'default', false, true)],
  ]) {
    const env = personEnv(folder, token);
    assert.deepEqual(claudeLoginLines({ env, home: env.HOME }), { fact: expected, lines }, `${folder} ${token}`);
    const { result } = await doctorRun(env, { probe: false });
    const text = result.text.split('\n');
    // Right under the sign-in line, and never the token itself.
    const at = text.findIndex((l) => l.startsWith('Claude sign-in: ')) + 1;
    assert.deepEqual(text.slice(at, at + lines.length), lines, `${folder} ${token}`);
    assert.ok(!text[at + lines.length].startsWith('Sonah found a relative'), `${folder} ${token}`);
    assert.deepEqual(result.facts.login, expected);
    assert.ok(!result.text.includes(TOKEN), 'the token is never printed');
    assert.ok(!result.attention.some((a) => /login|relative/.test(a)), 'said, never attention');
  }
});

test('D151: doctor\'s checks and its probe run with doctor\'s own home, whatever HOME the environment holds',
async () => {
  for (const env of [personEnv('/synthetic/claude-work'), (({ HOME, ...rest }) => rest)(personEnv(undefined))]) {
    const { commands, probes } = await doctorRun(env, { home: '/synthetic/stand-in-home' });
    assert.equal(commands.length, 4);
    for (const call of [...commands, ...probes]) assert.equal(call.env.HOME, '/synthetic/stand-in-home');
    assert.equal(probes.length, 1);
  }
});

test('D151: doctor checks safe mode with no model call and says what it found, never as attention', async () => {
  const words = DOCTOR_CLAUDE_WORDS.safeMode;
  for (const [safeMode, authReadable, state, line] of [['accepted', true, 'accepted', words.accepted],
    ['refused', true, 'refused', words.refused], ['refused', false, 'unknown', words.notChecked]]) {
    const { result, probes } = await doctorRun(personEnv('/synthetic/claude-work'), { safeMode, authReadable,
      probe: false });
    assert.equal(result.facts.safeMode.state, state, safeMode);
    assert.ok(result.text.split('\n').includes(line), safeMode);
    assert.ok(!result.attention.some((a) => /safe/.test(a)), 'a review runs without it');
    assert.equal(probes.length, 0, 'no model call');
  }
  assert.equal(words.accepted, 'Claude Code safe mode: accepted. Sonah\'s Claude Code calls run in safe mode.');
  assert.equal(words.refused, 'Claude Code safe mode: this Claude Code refused --safe-mode when Sonah checked it. So '
    + 'Sonah cannot tell that its calls run in safe mode. Fix: update Claude Code, then run sonah doctor again.');
  assert.deepEqual(SAFE_MODE_CHECK, ['--safe-mode', 'auth', 'status']);
  // A signed-out person: the check still answers the sign-in JSON (exit 1), so it is read as accepted, or as refused when
  // the flag stops the command first; the sign-in fix is the attention, never safe mode.
  for (const [safeMode, state] of [['accepted', 'accepted'], ['refused', 'refused']]) {
    const { result } = await doctorRun(personEnv(undefined), { safeMode, signedOut: true, probe: false });
    assert.equal(result.facts.auth.state, 'signed_out');
    assert.equal(result.facts.safeMode.state, state, `signed out, ${safeMode}`);
    assert.ok(result.text.split('\n').includes(words[state]));
    assert.deepEqual(result.attention.filter((a) => a.startsWith('claude')), ['claude_auth']);
  }
  // A healthy setup stays healthy with the new lines.
  const { result } = await doctorRun(personEnv(undefined), { probe: false });
  assert.equal(result.healthy, true);
});

// ---- no argv, request byte or answer key moves -----------------------------------------------------------------------
test('D151: the argv and the answer key of a session, a challenge and an agent request are the ones frozen before it',
async (t) => {
  // Computed at 36da44be, before D151, by these same calls.
  const model = 'claude-sonnet-5-5[1m]';
  const sha = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
  const agentRequest = { system: SYSTEM, prompt: 'D151_SYNTHETIC_PROMPT', label: 'code-review:agent', schema: SCHEMA,
    agent: { root: '/synthetic/repo/pkg', addDirs: ['/synthetic/repo'], maxTurns: 40 } };
  const sent = requests('/synthetic/repo/pkg');
  const identity = { backend: 'claude-cli', model };
  assert.equal(answerKey(sent.session, identity), '2db2a432b7387f6e7a18effd3f3794dc70ac045d777cd9d252a391fe1ea470a4');
  assert.equal(answerKey(sent.challenge, identity), '7090543ce678a4d46f105264a9cb208bf23ab73516e0e0fc5f61b201cbc0a512');
  assert.equal(answerKey(agentRequest, { ...identity, repoState: 'a'.repeat(64) }),
    '3bc460b0fb39869cd944b752c3c8b7916e5671e95474922bbd21f71bbcb2bc07');
  assert.equal(sha(reviewCliArgs({ system: 'S', model })),
    'cef04c394a3f9fcb1d8840817fa37d5b2a1dc35ca69309d3fc7c757c2a962e2f');
  assert.equal(sha(reviewAgentCliArgs({ system: 'S', model, agent: agentRequestOf(agentRequest), schema: SCHEMA })),
    '9cb9306ae95a7cc938b557672b963d0fae63cc7cb3d4afbd0f244a09fbb1c7a4');
  assert.deepEqual([REVIEW_TRANSPORT_VERSION, REVIEW_AGENT_TRANSPORT_VERSION],
    ['sonah.review-transport/3', 'sonah.review-agent-transport/2'], 'neither transport version moves');
  // And the argv each call is spawned with is that argv, whatever the environment: the switches are never arguments.
  const root = await scratch(t);
  for (const env of [personEnv(undefined), personEnv('/synthetic/claude-work', TOKEN)]) {
    const fake = capturingSpawn();
    const judge = createReviewJudge({ config: { backend: 'claude-cli', model }, env, spawnProcess: fake.spawnProcess });
    const local = requests(root);
    for (const kind of ['session', 'challenge', 'agent']) await judge(local[kind]).catch(() => {});
    assert.deepEqual(fake.calls[0].args, reviewCliArgs({ system: SYSTEM, model }));
    assert.deepEqual(fake.calls[1].args, reviewCliArgs({ system: SYSTEM, model }));
    assert.deepEqual(fake.calls[2].args, reviewAgentCliArgs({ system: SYSTEM, model, agent: agentRequestOf(local.agent),
      schema: SCHEMA }));
    for (const call of fake.calls) assert.ok(!call.args.includes('--safe-mode') && !JSON.stringify(call.args)
      .includes('CLAUDE_'), 'no switch rides in the argv');
  }
});
