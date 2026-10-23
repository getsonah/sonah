// B1 product diagnostics: synthetic CLI boundaries only; no provider, login, or user files.
import test from 'node:test';
import assert from 'node:assert/strict';
import { DOCTOR_FIXES, doctor, parseDoctorArgs, runDoctorCommand } from '../src/doctor.js';
import { SESSION_REVIEW_CLAUDE_CLI_MODEL } from '../../evidence/src/run-review.js';
import { PROBE_REQUEST } from '../src/review-probe.js';
import { servedModelId } from '../src/review-judge.js';

const LONG = SESSION_REVIEW_CLAUDE_CLI_MODEL;
const PRIVATE = 'SYNTHETIC_DOCTOR_PRIVATE_DETAIL';
const ENV = { HOME: '/tmp/synthetic-doctor-home', PATH: '/synthetic/bin', SONAH_CODEX_BIN: '/synthetic/bin/codex' };
const missing = () => Object.assign(new Error(PRIVATE), { code: 'ENOENT', stderr: PRIVATE });
const ready = { ok: true, attestation: 'attested', configuredModel: LONG,
  servedModels: [servedModelId(LONG)], contextWindow: 1_000_000 };
function fakes({ claude = true, codex = false, auth = 'signed_in', codexAuth = 'signed_in', metadata = ready, answer = { ok: true } } = {}) {
  const commands = [], calls = [], judges = [];
  const runCli = async (file, args, options) => {
    commands.push({ file, args, options });
    if (file === ENV.SONAH_CODEX_BIN) {
      if (!codex) throw missing();
      if (args[0] === 'login') {
        if (codexAuth !== 'signed_in') throw Object.assign(new Error(PRIVATE), { code: codexAuth === 'signed_out' ? 1 : 2, stderr: PRIVATE });
        return { stdout: PRIVATE };
      }
      return { stdout: 'codex-cli synthetic' };
    }
    if (!claude) throw missing();
    if (args[0] === '--version') return { stdout: `2.1.278 (Claude Code)\n${PRIVATE}` };
    if (auth === 'unknown') return { stdout: PRIVATE };
    const value = { loggedIn: auth !== 'signed_out', authMethod: auth === 'oauth_token' ? 'oauth_token' : auth === 'api_key' ? 'api_key' : 'claude.ai',
      email: PRIVATE, organizationId: PRIVATE };
    if (auth === 'signed_out') throw Object.assign(new Error(PRIVATE), { code: 1, stdout: JSON.stringify(value), stderr: PRIVATE });
    return { stdout: JSON.stringify(value) };
  };
  return { commands, calls, judges, dependencies: { env: ENV, nodeVersion: '20.0.0', runCli,
    createJudge: (options) => { judges.push(options); return async (request) => {
      calls.push(request); options.onResult(metadata);
      if (!metadata.ok) throw new Error(PRIVATE);
      return answer;
    }; },
    adapters: async ({ home }) => ({ claude: { count: 0, where: `${home}/.claude/projects` },
      codex: { count: 0, where: `${home}/.codex/sessions` } }),
    // D143: no repository of the person's is read; the commit link's own test gives doctor a synthetic one.
    commitLink: async () => null } };
}

test('B1 doctor checks Node, subscription sign-in, one 1M probe and session locations without capture hooks', async () => {
  const fake = fakes();
  const result = await doctor({}, fake.dependencies);
  assert.equal(result.healthy, true);
  assert.equal(result.facts.auth.state, 'signed_in');
  assert.equal(result.facts.model.state, 'ready');
  assert.equal(fake.calls.length, 1);
  assert.deepEqual(fake.calls[0], PROBE_REQUEST);
  assert.deepEqual(fake.judges[0].config, { backend: 'claude-cli', model: LONG });
  assert.match(result.text, /1M context window/);
  assert.match(result.text, /Claude sessions: 0 file\(s\) in/);
  assert.match(result.text, /Codex sessions: 0 rollout\(s\) in/);
  assert.match(result.text, /Run a coding session/);
  assert.doesNotMatch(result.text, /SYNTHETIC_DOCTOR_PRIVATE_DETAIL|hooks/);
  assert.deepEqual(result.attention, []);
});

test('B1 --no-probe makes no judge or model and states the remaining check', async () => {
  const fake = fakes();
  const result = await doctor({ probe: false }, fake.dependencies);
  assert.equal(result.healthy, true);
  assert.equal(result.facts.model.state, 'skipped');
  assert.equal(fake.calls.length, 0);
  assert.equal(fake.judges.length, 0);
  assert.match(result.text, /not checked \(--no-probe\)/);
  assert.match(result.text, /without --no-probe/);
});

test('B1 missing CLI, signed-out/other auth, unreadable auth, and old Node have fixes and cost no calls', async () => {
  for (const [settings, nodeVersion, expected, fix] of [
    [{ claude: false }, '20.0.0', 'claude', 'Install Claude Code'],
    [{ auth: 'signed_out' }, '20.0.0', 'claude_auth', 'claude auth login'],
    [{ auth: 'unknown' }, '20.0.0', 'claude_auth', 'claude auth status'],
    [{}, '19.9.0', 'node', 'Install Node.js 20'],
  ]) {
    const fake = fakes(settings);
    const result = await doctor({}, { ...fake.dependencies, nodeVersion });
    assert.equal(result.healthy, false, expected);
    assert.ok(result.attention.includes(expected), expected);
    assert.ok(result.text.includes(fix), expected);
    assert.equal(fake.calls.length, 0, expected);
    assert.equal(fake.judges.length, 0, expected);
    assert.doesNotMatch(result.text, /SYNTHETIC_DOCTOR_PRIVATE_DETAIL/);
  }
});

test('B1 Claude sign-in check uses the same subscription account inputs as the model transport', async () => {
  const fake = fakes();
  const env = { ...ENV, ANTHROPIC_API_KEY: PRIVATE, ANTHROPIC_BASE_URL: PRIVATE,
    CLAUDE_CONFIG_DIR: '/synthetic/other-account', SONAH_CLAUDE_PROJECTS: '/synthetic/recording-copy' };
  const result = await doctor({ probe: false }, { ...fake.dependencies, env });
  const authEnv = fake.commands.find((entry) => entry.args[0] === 'auth').options.env;
  assert.equal(authEnv.HOME, ENV.HOME);
  assert.equal(authEnv.ANTHROPIC_API_KEY, undefined);
  assert.equal(authEnv.ANTHROPIC_BASE_URL, undefined);
  assert.equal(authEnv.CLAUDE_CONFIG_DIR, undefined);
  assert.match(result.text, /Claude recording copy for review: \/synthetic\/recording-copy/);
});

test('B1 a failed, mismatched, or wrong-context Claude probe is never retried and has a concrete fix', async () => {
  for (const metadata of [
    { ok: false, providerClass: 'auth' },
    { ...ready, contextWindow: 200_000 },
    { ...ready, contextWindow: null },
    { ...ready, attestation: 'mismatch', providerClass: 'identity_mismatch', servedModels: ['claude-other-9-9'] },
  ]) {
    const fake = fakes({ metadata });
    const result = await doctor({}, fake.dependencies);
    assert.equal(result.healthy, false);
    assert.equal(fake.calls.length, 1);
    assert.ok(result.attention.includes('model'));
    assert.match(result.text, /Fix: /);
    assert.doesNotMatch(result.text, /SYNTHETIC_DOCTOR_PRIVATE_DETAIL/);
  }
});

test('D77 (F) a model doctor could not confirm gets one plain reason and the update fix; the closed facts stay', async () => {
  const plain = `Model: Sonah could not confirm the answer came from ${servedModelId(LONG)} under its 1M-token window. `
    + `Fix: ${DOCTOR_FIXES.claude_model}`;
  for (const [settings, state, providerClass] of [
    // The transport refused an answer it could not attest as the asked model.
    [{ answer: { ok: false, detail: PRIVATE },
      metadata: { ...ready, ok: false, attestation: 'mismatch', providerClass: 'identity_mismatch' } }, 'not_answered', 'identity_mismatch'],
    [{ metadata: { ...ready, contextWindow: 200_000 } }, 'context_window_mismatch', null],
    [{ metadata: { ...ready, contextWindow: null } }, 'context_window_mismatch', null],
    [{ metadata: { ...ready, attestation: 'mismatch', providerClass: 'identity_mismatch', servedModels: ['claude-other-9-9'] } },
      'served_model_mismatch', 'identity_mismatch'],
  ]) {
    const fake = fakes(settings), out = [];
    const exit = await runDoctorCommand([], { ...fake.dependencies,
      stdout: { write: (value) => out.push(value) }, stderr: { write: () => {} } });
    const result = await doctor({}, fakes(settings).dependencies);
    assert.equal(exit, 1, state);
    assert.equal(result.facts.model.state, state);
    assert.equal(result.facts.model.providerClass, providerClass);
    assert.ok(result.attention.includes('model'), state);
    assert.ok(out.join('').includes(`${plain}\n`), state);
    assert.doesNotMatch(out.join(''), /not_answered|identity_mismatch|context_window_mismatch|served_model_mismatch|SYNTHETIC_DOCTOR_PRIVATE_DETAIL/);
  }
  // Every other outcome keeps its bracketed cause and its own fix.
  for (const [providerClass, fix] of [['rate_limit', DOCTOR_FIXES.model], ['auth', DOCTOR_FIXES.claude_auth]]) {
    const result = await doctor({}, fakes({ metadata: { ok: false, providerClass } }).dependencies);
    assert.ok(result.text.includes(`Model: not_answered (${providerClass}). Fix: ${fix}`), providerClass);
  }
});

test('B1 an attested transport with the wrong tiny answer is not described as answering the check', async () => {
  const fake = fakes({ answer: { ok: false, detail: PRIVATE } });
  const result = await doctor({}, fake.dependencies);
  assert.equal(result.facts.model.state, 'not_answered');
  assert.equal(result.healthy, false);
  assert.equal(fake.calls.length, 1);
  assert.doesNotMatch(result.text, /SYNTHETIC_DOCTOR_PRIVATE_DETAIL/);
});

test('B1 selected Codex checks one named model, works without Claude, and reports identity limits', async () => {
  const fake = fakes({ claude: false, codex: true, metadata: { ok: true, attestation: 'unattested' } });
  const result = await doctor({ backend: 'codex-cli', model: 'gpt-6.1-sol' }, fake.dependencies);
  assert.equal(result.healthy, true);
  assert.equal(fake.calls.length, 1);
  assert.deepEqual(fake.judges[0].config, { backend: 'codex-cli', model: 'gpt-6.1-sol' });
  assert.match(result.text, /served model identity is not attested/);
  assert.match(result.text, /optional for this backend/);
  const skip = await doctor({ backend: 'codex-cli', model: 'gpt-6.1-sol', probe: false }, fake.dependencies);
  assert.equal(skip.facts.model.state, 'skipped');
  assert.equal(fake.calls.length, 1, 'the skipped invocation creates no second call');
});

test('B1 missing selected Codex fails without a model; authentication failure names codex login', async () => {
  const absent = fakes();
  const missingResult = await doctor({ backend: 'codex-cli', model: 'gpt-6.1-sol' }, absent.dependencies);
  assert.equal(missingResult.healthy, false);
  assert.ok(missingResult.attention.includes('codex'));
  assert.equal(absent.calls.length, 0);
  const auth = fakes({ codex: true, metadata: { ok: false, providerClass: 'auth' } });
  const result = await doctor({ backend: 'codex-cli', model: 'gpt-6.1-sol' }, auth.dependencies);
  assert.equal(auth.calls.length, 1);
  assert.match(result.text, /codex login/);
});

test('B1 invalid options fail before any CLI, file or model action', async () => {
  for (const args of [['--timeout', '0'], ['--timeout', 'Infinity'], ['--timeout', '2147483648'],
    ['--no-probe', '--no-probe'], ['--unknown'], ['--repo'], ['--backend', 'anthropic-api'],
    ['--backend', 'codex-cli'], ['--model', 'sonnet']]) {
    assert.throws(() => parseDoctorArgs(args, ENV), { code: 'usage' });
    const fake = fakes(), written = [];
    assert.equal(await runDoctorCommand(args, { ...fake.dependencies,
      stdout: { write: (text) => written.push(text) }, stderr: { write: (text) => written.push(text) } }), 2);
    assert.equal(fake.commands.length, 0);
    assert.equal(fake.calls.length, 0);
    assert.match(written.join(''), /usage: sonah doctor/);
  }
});

test('B1 CLI command warns about the one model request only when it will make one', async () => {
  for (const args of [[], ['--no-probe']]) {
    const fake = fakes(), out = [];
    assert.equal(await runDoctorCommand(args, { ...fake.dependencies,
      stdout: { write: (value) => out.push(value) }, stderr: { write: () => {} } }), 0);
    assert.equal(fake.calls.length, args.length ? 0 : 1);
    assert.equal(out.join('').includes('uses your provider allowance'), !args.length);
  }
});


test('B1 documented Claude auth methods do not infer subscription billing or reject a typed sign-in', async () => {
  for (const auth of ['signed_in', 'oauth_token', 'api_key']) {
    const fake = fakes({ auth });
    const result = await doctor({ probe: false }, fake.dependencies);
    assert.equal(result.facts.auth.state, 'signed_in');
    assert.equal(result.healthy, true);
    assert.match(result.text, /confirm your account billing settings/);
    assert.equal(fake.calls.length, 0);
  }
});

test('B1 selected Codex signed-out or unknown sign-in stops before any model, even under --no-probe', async () => {
  for (const codexAuth of ['signed_out', 'unknown']) for (const probe of [true, false]) {
    const fake = fakes({ codex: true, codexAuth });
    const result = await doctor({ backend: 'codex-cli', model: 'gpt-6.1-sol', probe }, fake.dependencies);
    assert.equal(result.healthy, false);
    assert.equal(result.facts.codex.auth.state, codexAuth);
    assert.ok(result.attention.includes('codex_auth'));
    assert.equal(fake.calls.length, 0);
    assert.equal(fake.judges.length, 0);
    assert.match(result.text, codexAuth === 'signed_out' ? /codex login with/ : /codex login status/);
    assert.doesNotMatch(result.text, /SYNTHETIC_DOCTOR_PRIVATE_DETAIL/);
  }
});

test('B1 Codex sign-in status uses the same executable and clean account environment as the review transport', async () => {
  const fake = fakes({ codex: true });
  const env = { ...ENV, CODEX_HOME: '/synthetic/codex-account', OPENAI_API_KEY: PRIVATE, CODEX_API_KEY: PRIVATE,
    CODEX_ACCESS_TOKEN: PRIVATE, OPENAI_BASE_URL: PRIVATE, HTTPS_PROXY: PRIVATE, SSL_CERT_FILE: PRIVATE };
  const result = await doctor({ backend: 'codex-cli', model: 'gpt-6.1-sol', probe: false }, { ...fake.dependencies, env });
  assert.equal(result.healthy, true);
  const status = fake.commands.find((entry) => entry.args[0] === 'login');
  assert.equal(status.file, env.SONAH_CODEX_BIN);
  assert.deepEqual(status.args, ['login', 'status']);
  assert.deepEqual(status.options.env, { HOME: ENV.HOME, CODEX_HOME: env.CODEX_HOME, PATH: ENV.PATH });
  assert.equal(fake.calls.length, 0);
  assert.doesNotMatch(result.text, /SYNTHETIC_DOCTOR_PRIVATE_DETAIL/);
});


test('B1 a local diagnostics failure prints only the fixed read-access fix and exits 3', async () => {
  const fake = fakes(), out = [], errors = [];
  const exit = await runDoctorCommand(['--no-probe'], { ...fake.dependencies,
    adapters: async () => { throw Object.assign(new Error(PRIVATE), { path: PRIVATE, code: 'EACCES' }); },
    stdout: { write: (value) => out.push(value) }, stderr: { write: (value) => errors.push(value) } });
  assert.equal(exit, 3);
  assert.equal(fake.calls.length, 0);
  assert.equal(fake.judges.length, 0);
  assert.match(errors.join(''), /Doctor could not complete its local diagnostics/);
  assert.match(errors.join(''), /Check read access to your home and recording directories/);
  assert.match(errors.join(''), /HOME, CODEX_HOME, CLAUDE_CONFIG_DIR or SONAH_CLAUDE_PROJECTS/);
  assert.doesNotMatch([...out, ...errors].join(''), /SYNTHETIC_DOCTOR_PRIVATE_DETAIL|EACCES/);
});
