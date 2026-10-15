// B1: diagnostics for reviewing existing recordings.
// No provider output, account identifiers, credentials or freeform error messages are printed.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { claudeLiveProjectsDir, claudeProjectsDir } from './claude-home.js';
import { codexExecutable } from './codex-model.js';
import { SESSION_REVIEW_CLAUDE_CLI_MODEL } from '../../evidence/src/run-review.js';
import { createReviewJudge, reviewJudgeConfig, cliVersionOf, highestUtilization, PROVIDER_CLASSES,
  servedModelId } from './review-judge.js';
import { utilizationWords } from './review-budget.js';
import { PROBE_REQUEST, probeOutcome } from './review-probe.js';
import { CODE_PASS_DEFAULT, codePassSettingLine, readSettings, settingsPath } from './settings.js';

const execute = promisify(execFile);
// Node's requirement is the package engines value; timeout bounds are Node's timer range.
const MIN_NODE_MAJOR = 20;
const MAX_TIMEOUT_MS = 2_147_483_647;
const DEFAULT_TIMEOUT_MS = 60_000;
// Local diagnostics are bounded too; neither command needs a large provider response.
const DIAGNOSTIC_BYTES = 64 * 1024;
export const DOCTOR_USAGE = 'sonah doctor [--no-probe] [--timeout MS] [--backend claude-cli|codex-cli] [--model ID]';
export const DOCTOR_FIXES = Object.freeze({
  node: 'Install Node.js 20 or newer, then run sonah doctor again.',
  claude: 'Install Claude Code from https://code.claude.com/docs/en/setup and make claude available on PATH.',
  claude_auth: 'Run claude auth login with your Claude subscription account, then run sonah doctor again.',
  claude_auth_unknown: 'Run claude auth status to check sign-in; update Claude Code if this command is unsupported.',
  codex: 'Install Codex or set SONAH_CODEX_BIN to its executable, then run sonah doctor again.',
  codex_auth: 'Run codex login with your ChatGPT account, then run sonah doctor again.',
  codex_auth_unknown: 'Run codex login status to check sign-in; update Codex if this command cannot complete.',
  model: 'Run sonah doctor again; check your provider allowance and network connection if it still cannot answer.',
  claude_model: 'Update Claude Code with claude update and confirm your account can use the requested long-context model.',
  skipped: 'Run sonah doctor without --no-probe to check the selected model with one tiny request.',
  sessions: 'Run a coding session in your repository, then pass its recording path to sonah review.',
  diagnostics: 'Check read access to your home and recording directories; correct HOME, CODEX_HOME, CLAUDE_CONFIG_DIR or SONAH_CLAUDE_PROJECTS if they point to unavailable paths.',
});
const usageError = () => Object.assign(new Error('usage'), { code: 'usage' });

/** Strict command grammar: each valued option appears once and --no-probe takes no value. */
export function parseDoctorArgs(argv, env = process.env) {
  const values = new Map([['--timeout', 'timeoutMs'], ['--backend', 'backend'], ['--model', 'model']]);
  const options = { probe: true };
  let noProbe = false;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--no-probe') {
      if (noProbe) throw usageError();
      noProbe = true; options.probe = false;
    } else {
      const key = values.get(argv[i]), value = argv[++i];
      if (!key || typeof value !== 'string' || !value || value.startsWith('--') || Object.hasOwn(options, key)) throw usageError();
      options[key] = value;
    }
  }
  // Decimal positive milliseconds are the documented CLI grammar.
  if (Object.hasOwn(options, 'timeoutMs') && !/^[1-9]\d{0,9}$/.test(options.timeoutMs)) throw usageError();
  options.timeoutMs = Object.hasOwn(options, 'timeoutMs') ? Number(options.timeoutMs) : DEFAULT_TIMEOUT_MS;
  if (!Number.isSafeInteger(options.timeoutMs) || options.timeoutMs < 1 || options.timeoutMs > MAX_TIMEOUT_MS) throw usageError();
  options.backend ??= env.SONAH_REVIEW_BACKEND ?? 'claude-cli';
  if (!['claude-cli', 'codex-cli'].includes(options.backend)) throw usageError();
  // The Claude diagnostic always checks the frozen 1M default; an explicit Codex backend may name its model.
  options.model ??= options.backend === 'claude-cli' ? SESSION_REVIEW_CLAUDE_CLI_MODEL : env.SONAH_MODEL;
  if (options.backend === 'claude-cli' && options.model !== SESSION_REVIEW_CLAUDE_CLI_MODEL) throw usageError();
  try { reviewJudgeConfig(env, options); } catch { throw usageError(); }
  return options;
}

// The subscription Claude transport's account/runtime inputs only. API keys, endpoints and repo
// configuration must not make auth status check a different account path from the model probe.
function diagnosticEnvironment(env, home) {
  const keys = ['HOME', 'PATH', 'TMPDIR', 'LANG', 'LC_ALL', 'USER', 'LOGNAME', 'SHELL',
    'SSL_CERT_FILE', 'SSL_CERT_DIR', 'NODE_EXTRA_CA_CERTS'];
  return { ...Object.fromEntries(keys.filter((key) => env[key] != null).map((key) => [key, env[key]])), HOME: home };
}

/** Check only typed exit status and, for Claude sign-in, the CLI's documented JSON fields.
 * https://code.claude.com/docs/en/cli-reference: auth status exits 0 signed in / 1 signed out.
 * All caught provider text stays local and is discarded after parsing; never stringify an error.
 */
async function command(file, args, options, runCli) {
  try { const result = await runCli(file, args, options); return { state: 'ok', stdout: result.stdout ?? '' }; }
  catch (error) {
    return { state: error?.code === 'ENOENT' ? 'missing' : 'unavailable',
      stdout: typeof error?.stdout === 'string' ? error.stdout : '', exitCode: error?.code };
  }
}
function authFact(result) {
  let value;
  try { value = JSON.parse(result.stdout); } catch { return { state: 'unknown' }; }
  if (!value || Array.isArray(value) || typeof value !== 'object' || typeof value.loggedIn !== 'boolean') return { state: 'unknown' };
  if (value.loggedIn === false && result.exitCode === 1) return { state: 'signed_out' };
  if (result.state !== 'ok' || value.loggedIn !== true) return { state: 'unknown' };
  // authMethod is a documented enum (including oauth_token), but it does not prove billing.
  // Report the typed sign-in fact only; the model probe checks whether the review can run.
  return { state: 'signed_in' };
}

/** Count files under dir whose basename passes `match`, bounded depth, never throwing. */
async function countMatching(dir, match, depth) {
  let names;
  try { names = await readdir(dir, { withFileTypes: true }); } catch { return 0; }
  let n = 0;
  for (const e of names) {
    if (e.isDirectory()) { if (depth > 0) n += await countMatching(join(dir, e.name), match, depth - 1); }
    else if (match(e.name)) n++;
  }
  return n;
}

/**
 * Which agents leave sessions on THIS machine, counted from the recordings on disk, never inferred from installed
 * binaries (`sonah doctor`, `sonah feedback`):
 *   claude  $CLAUDE_CONFIG_DIR|~/.claude/projects/<slug>/*.jsonl, the live recorder root (src/claude-home.js, F180)
 *   codex   $CODEX_HOME|~/.codex/sessions/**\/rollout-*.jsonl (the same rollout-name shape as
 *           packages/slicer/src/codex.js; basename only, so a path containing spaces cannot break it)
 * An injected `home` is a stand-in machine: the ambient CLAUDE_CONFIG_DIR applies to it only when an `env` is injected
 * alongside it.
 */
export async function detectAdapters({ home: injected, env, codexHome } = {}) {
  const home = injected ?? homedir();
  const claudeDir = claudeLiveProjectsDir(injected === undefined ? { env } : { home: injected, env: env ?? {} });
  const codexDir = join(codexHome ?? process.env.CODEX_HOME ?? join(home, '.codex'), 'sessions');
  return {
    claude: { count: await countMatching(claudeDir, (n) => n.endsWith('.jsonl'), 3), where: claudeDir },
    codex: { count: await countMatching(codexDir, (n) => /^rollout-\d{4}-\d{2}-\d{2}T/.test(n) && n.endsWith('.jsonl'), 4),
      where: codexDir },
  };
}

/** One explicit doctor invocation. With --no-probe, no model is created. Injected boundaries
 * let synthetic tests check every failure without using the user's providers or settings.
 */
export async function doctor(options = {}, { env = process.env, home = env.HOME ?? homedir(),
  nodeVersion = process.versions.node, runCli = execute, createJudge = createReviewJudge,
  adapters = detectAdapters, onProbe = () => {} } = {}) {
  const selected = parseDoctorArgs([
    ...('probe' in options && !options.probe ? ['--no-probe'] : []),
    ...['backend', 'model'].flatMap((key) => options[key] === undefined ? [] : [`--${key}`, options[key]]),
    ...(options.timeoutMs === undefined ? [] : ['--timeout', String(options.timeoutMs)]),
  ], env);
  const attention = [], lines = [];
  const version = cliVersionOf(nodeVersion);
  const node = { state: version && Number(version.split('.')[0]) >= MIN_NODE_MAJOR ? 'ok' : 'unsupported', version };
  lines.push(`Node: ${version ?? 'version unreadable'}${node.state === 'ok' ? ' (20 or newer)' : `. Fix: ${DOCTOR_FIXES.node}`}`);
  if (node.state !== 'ok') attention.push('node');
  const localEnv = diagnosticEnvironment(env, home);
  const cliOptions = { cwd: home, env: localEnv, timeout: selected.timeoutMs, maxBuffer: DIAGNOSTIC_BYTES, killSignal: 'SIGKILL' };
  const claudeResult = await command('claude', ['--version'], cliOptions, runCli);
  const claude = { state: claudeResult.state, version: cliVersionOf(String(claudeResult.stdout).trim().split(' ')[0]) };
  let auth = { state: 'not_checked' };
  if (claude.state === 'ok') auth = authFact(await command('claude', ['auth', 'status'], cliOptions, runCli));
  lines.push(`Claude: ${claude.state === 'ok' ? `present${claude.version ? ` (${claude.version})` : ''}`
    : `${claude.state}. Fix: ${DOCTOR_FIXES.claude}`}${selected.backend === 'codex-cli' ? ' (optional for this backend)' : ''}`);
  if (claude.state === 'ok') {
    const fix = auth.state === 'signed_in' ? '' : ` Fix: ${auth.state === 'unknown' ? DOCTOR_FIXES.claude_auth_unknown : DOCTOR_FIXES.claude_auth}`;
    lines.push(`Claude sign-in: ${auth.state === 'signed_in' ? 'signed in (confirm your account billing settings)' : auth.state}.${fix}`);
  }
  if (selected.backend === 'claude-cli') {
    if (claude.state !== 'ok') attention.push('claude');
    else if (auth.state !== 'signed_in') attention.push('claude_auth');
  }
  // Exactly the account/runtime keys codexEnvironment permits in the review transport.
  const codexKeys = ['HOME', 'CODEX_HOME', 'PATH', 'TMPDIR', 'LANG', 'LC_ALL', 'USER', 'LOGNAME', 'SHELL'];
  const codexEnv = { ...Object.fromEntries(codexKeys.filter((key) => env[key] != null).map((key) => [key, env[key]])), HOME: home };
  const codexOptions = { ...cliOptions, env: codexEnv };
  const codexBin = codexExecutable(env);
  const codexResult = await command(codexBin, ['--version'], codexOptions, runCli);
  const codex = { state: codexResult.state, auth: { state: 'not_checked' } };
  lines.push(`Codex: ${codex.state === 'ok' ? 'present' : `${codex.state}. ${DOCTOR_FIXES.codex}`}${selected.backend === 'claude-cli' ? ' (optional)' : ''}`);
  if (selected.backend === 'codex-cli') {
    if (codex.state !== 'ok') attention.push('codex');
    else {
      // Official CLI reference: login status exits 0 when credentials are present. Read only
      // its exit status; its text can contain private account details and is never displayed.
      // https://learn.chatgpt.com/docs/developer-commands?surface=cli#codex-login
      const login = await command(codexBin, ['login', 'status'], codexOptions, runCli);
      codex.auth.state = login.state === 'ok' ? 'signed_in' : login.exitCode === 1 ? 'signed_out' : 'unknown';
      const fix = codex.auth.state === 'signed_in' ? ''
        : ` Fix: ${codex.auth.state === 'unknown' ? DOCTOR_FIXES.codex_auth_unknown : DOCTOR_FIXES.codex_auth}`;
      lines.push(`Codex sign-in: ${codex.auth.state === 'signed_in' ? 'credentials present (confirm your ChatGPT account)' : codex.auth.state}.${fix}`);
      if (codex.auth.state !== 'signed_in') attention.push('codex_auth');
    }
  }
  let model = { state: 'not_checked', backend: selected.backend, asked: selected.model, providerClass: null };
  if (!selected.probe) {
    model.state = 'skipped';
    lines.push(`Model: not checked (--no-probe). ${DOCTOR_FIXES.skipped}`);
  } else if (attention.length > 0) {
    lines.push('Model: not checked; fix the selected backend and Node checks above, then run sonah doctor again.');
  } else {
    let metadata = null, answer = null, reports = 0;
    onProbe({ backend: selected.backend, model: selected.model });
    try {
      const judge = createJudge({ config: { backend: selected.backend, model: selected.model },
        env: { ...env, HOME: home }, timeoutMs: selected.timeoutMs,
        onResult: (value) => { reports++; metadata = value; } });
      answer = await judge(PROBE_REQUEST); // Exactly one attempt, with no transport retry.
    } catch { /* only the transport's closed metadata is used below */ }
    model.providerClass = PROVIDER_CLASSES.includes(metadata?.providerClass) ? metadata.providerClass : null;
    model.state = reports !== 1 || answer?.ok !== true ? 'not_answered'
      : selected.backend === 'claude-cli' ? probeOutcome(selected.model, metadata)
      : metadata?.ok === true ? 'ready' : 'not_answered';
    if (model.state === 'ready') {
      lines.push(`Model: ${selected.model} answered one tiny synthetic request${selected.backend === 'claude-cli' ? ' under the 1M context window' : '; served model identity is not attested by the Codex CLI'}.`);
    } else {
      attention.push('model');
      // The claude-cli transport refuses an answer it cannot attest (model_unavailable, providerClass identity_mismatch),
      // which reads not_answered above before probeOutcome is asked, so a selector or served-model change reaches here as
      // `not_answered` with that class, not under probeOutcome's own names: selector_shape_changed and
      // served_model_mismatch never reach this line; only a caller that hands probeOutcome a refused attempt's metadata
      // gets them (its own test).
      const unconfirmed = model.providerClass !== 'auth' && selected.backend === 'claude-cli'
        && (model.providerClass === 'identity_mismatch'
          || ['selector_shape_changed', 'served_model_mismatch', 'context_window_mismatch'].includes(model.state));
      const fix = model.providerClass === 'auth' ? (selected.backend === 'claude-cli' ? DOCTOR_FIXES.claude_auth : DOCTOR_FIXES.codex_auth)
        : unconfirmed ? DOCTOR_FIXES.claude_model : DOCTOR_FIXES.model;
      // D77 (F): a model doctor could not confirm gets one plain reason and its fix, not the outcome names; every other
      // outcome keeps its bracketed cause. facts.model keeps the closed state and providerClass for programs.
      lines.push(unconfirmed
        ? `Model: Sonah could not confirm the answer came from ${servedModelId(selected.model)} under its 1M-token window. Fix: ${fix}`
        : `Model: ${model.state}${model.providerClass ? ` (${model.providerClass})` : ''}. Fix: ${fix}`);
    }
    // M44: the plan usage the probe's one attempt reported (claude-cli only), as the review's usage line words it.
    if (selected.backend === 'claude-cli' && highestUtilization(metadata?.rateLimit) !== null)
      lines.push(`Claude usage: utilization ${utilizationWords(metadata.rateLimit)}.`);
  }
  const found = await adapters({ home, env, codexHome: env.CODEX_HOME ?? join(home, '.codex') });
  // The review root may be a copy; detectAdapters intentionally reports the live recorder root.
  const reviewRoot = claudeProjectsDir({ env, home });
  lines.push(`Claude sessions: ${found.claude.count} file(s) in ${found.claude.where}`);
  if (reviewRoot !== found.claude.where) lines.push(`Claude recording copy for review: ${reviewRoot}`);
  lines.push(`Codex sessions: ${found.codex.count} rollout(s) in ${found.codex.where}`);
  if (found.claude.count + found.codex.count === 0) lines.push(`No Claude or Codex recordings found. ${DOCTOR_FIXES.sessions}`);
  // Owner decision 2026-10-14: the code step's setting (settings.js). A settings file that cannot be read stops a review
  // given no --code-pass or --no-code-pass (`config_invalid`), so it needs the person.
  const read = await readSettings({ env, home });
  lines.push(codePassSettingLine(read, settingsPath({ env, home }), 'Code step (code-pass)'));
  if (read.state === 'invalid') attention.push('settings');
  const settings = { state: read.state, codePass: read.state === 'invalid' ? null
    : read.settings?.codePass ?? CODE_PASS_DEFAULT };
  lines.push(attention.length ? `needs attention: ${attention.join(', ')}` : 'Local review setup checked.');
  return { healthy: attention.length === 0, attention, text: lines.join('\n'), facts: { node, claude, auth, codex, model, adapters: found, settings } };
}

export async function runDoctorCommand(argv, { stdout = process.stdout, stderr = process.stderr, env = process.env,
  ...dependencies } = {}) {
  let options;
  try { options = parseDoctorArgs(argv, env); }
  catch {
    stderr.write(`usage: ${DOCTOR_USAGE}\nUse --backend codex-cli --model gpt-6.1-sol for Codex; the Claude check uses the frozen long-context default.\n`);
    return 2;
  }
  try {
    const result = await doctor(options, { ...dependencies, env,
      onProbe: ({ backend }) => stdout.write(`Doctor model check: one tiny synthetic request through ${backend}; uses your provider allowance.\n`) });
    stdout.write(`${result.text}\n`);
    return result.healthy ? 0 : 1;
  } catch {
    // Local paths and filesystem/provider errors can carry private text. Keep the CLI failure fixed.
    stderr.write(`Doctor could not complete its local diagnostics. Fix: ${DOCTOR_FIXES.diagnostics}\n`);
    return 3;
  }
}
