// B2: local recording selection and the existing resumable session-only review. No Git base is
// inferred: reviewSession owns planning, grounding, checkpoints and exact transport answer reuse.
// D82 step 10 (B5 O1-B): the one review route. A count-only PR comment, off by default, is built from this review's
// report and posted only after the page is written and the person confirms it (`--github OWNER/REPO --pr N
// --post-comment`, pr-sharing.js); the pull request's metadata is the only thing read from GitHub.
import { AsyncLocalStorage } from 'node:async_hooks';
import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { access, lstat, readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { CLI_SAFE_ERROR_CODES, GAP_CODES, JUDGE_FAILURE_CODES, OUTPUT_NOT_MASKED, REVIEW_RUN_STATES, RUN_FAILURE_CODES,
  honestStatuses, reviewRunState } from '../../evidence/src/ledger.js';
import { COVERAGE_SENTENCE, attentionSummary, coverageCauses } from '../../evidence/src/review.js';
import { WINDOW_INCOMPLETE_REASONS, planWindowRequests, SESSION_REVIEW_CLAUDE_CLI_MODEL } from '../../evidence/src/run-review.js';
import { REVIEW_SPEED_PROFILE_NAMES, reviewSpeedProfile, requestBoundOf } from '../../evidence/src/review-profiles.js';
import { renderSessionPage } from '../../render/session-page.js';
import { renderSessionStory, forPeople } from '../../render/session-story.js';
import { maskForPeople, peopleMask, peopleSecretsFor, peopleSecretsOfTexts, joinSecretValues } from '../../redact/index.js';
import { targetPath } from '../../github/client.js';
import { GITHUB_ERROR_CODES } from '../../github/errors.js';
import { strictJson } from '../../slicer/src/strict-json.js';
import { createAnswerCache } from './answer-cache.js';
import { claudeConfigDir, claudeProjectsDir, recordingHarnessHome } from './claude-home.js';
import { answersFor, loadDecisionReviews } from './decision-reviews.js';
import { loadRecordedSessionWithHash } from './recorded-session.js';
import { openLocalPage, presentLocalPage } from './local-page.js';
import { attestableModel, createReviewJudge, reviewJudgeConfig, selectedContextWindow, rateLimitRecordOf } from './review-judge.js';
import { discoverSessions } from './session-discovery.js';
import { createSessionReviewStore, dryRunReplay, reviewCodePass, reviewSession } from './session-review.js';
import { readCodeSnapshot, snapshotTexts } from './code-snapshot.js';
import { CODE_FILE_STATES, CODE_DIFF_BASES, CODE_DIFF_STATES, CODE_PASS_LENSES } from '../../evidence/src/ledger.js';
import { fileBlock } from '../../evidence/src/code-pass.js';
import { sectionBytes } from '../../evidence/src/code-context.js';
import { CODE_STEP_PART, createReviewBudget, normalizeReviewBudget, estimateLine } from './review-budget.js';
import { resolveCodePass } from './settings.js';

/** The review's one usage line, printed under a usage error. */
const SESSION_REVIEW_USAGE_LINE = 'sonah review [session.jsonl] [options]';
/** Owner decision 2026-10-13: a review that names no `--profile` runs `m33-lean`, the default setting. `standard` (three checking passes on every item) stays selectable by name; no profile's definition
 *  moved (review-profiles.js). */
export const DEFAULT_REVIEW_PROFILE = 'm33-lean';
/** Owner decision 2026-10-13, the same rule: a review of the default profile that names no `--concurrency` reviews
 *  four parts of the session at a time, as releases are checked, and the time estimate is made at four. `--concurrency N` still runs up to the profile's lanes; a named other profile keeps its
 *  own lanes. Concurrency moves no request byte and no digest: only how many parts run side by side. */
export const DEFAULT_REVIEW_CONCURRENCY = 4;
/** `sonah review --help`: the usage line, then each option group, within 80 columns. `--profile standard` is listed;
 *  the other values are experiments, accepted and not listed. */
export const sessionReviewUsage = [SESSION_REVIEW_USAGE_LINE,
  'Reviews one recorded session; with no path, the latest one of this repository.',
  '',
  'options:',
  '  --repo DIR, --choose N   where to look, and the Nth session that',
  '                           sonah sessions lists',
  '  --dry-run                show what would be reviewed and roughly how long;',
  '                           send nothing',
  '  --backend claude-cli|codex-cli|anthropic-api',
  '                           the reviewer (default claude-cli: your claude login)',
  '  --model ID               the reviewer\'s model, needed for codex-cli and',
  '                           anthropic-api (leave it out for claude-cli: its',
  '                           default is the 1M-token model)',
  '  --timeout MS             how long one model call may take (default 20 minutes)',
  '  --concurrency N          parts of the session reviewed at a time (default 4,',
  '                           at most 12; at most 3 with --profile standard)',
  '  --profile standard       check every item in three passes (the default checks',
  '                           decisions and asks in one pass); slower',
  '  --code-pass, --no-code-pass',
  '                           the code step, on or off for this review (on unless',
  '                           you ran sonah config code-pass off): read the files',
  '                           the session changed or read, as they are now, check',
  '                           the agent\'s claims, decisions and asks against them,',
  '                           then review them; the files are sent to the reviewer',
  '  --code-model ID          the reviewer\'s model for the code step only, when',
  '                           it runs (default: the session\'s model)',
  '  --format md|html         a Markdown story (the default) or an HTML page',
  '                           (needs --output)',
  '  --output FILE            write a new file, in a folder that exists, instead',
  '                           of printing; an HTML page then opens in your browser',
  '  --no-open                do not open the page',
  '  --state-dir DIR          where stored answers and the report are kept',
  '                           (default: under ~/.sonah)',
  '  --max-calls N, --max-input-bytes N, --stop-at-utilization U',
  '                           optional stops, off by default; rerun to resume',
  '  --github OWNER/REPO --pr N --post-comment',
  '                           a count-only PR comment, off by default (needs',
  '                           --format html --output FILE): shown after the',
  '                           page is written, posted only once you confirm it'].join('\n');
const failure = (code) => Object.assign(new Error(code), { code });
/** A usage error, and the problem it names in fixed words (the option, when it is one the person typed). */
const usageError = (problem) => Object.assign(new Error('usage'), { code: 'usage', problem });
/** An option the person typed, as a usage error names it: its name before any `=` (a value given as `--name=value` is
 *  never printed back), at most 40 characters, with `...` where something was left out. */
const named = (arg) => {
  const name = arg.split('=')[0], shown = name.slice(0, 40);
  if (shown.length === arg.length) return arg;
  return shown.length < name.length ? `${shown}...` : `${shown}=...`;
};
const positive = (value) => typeof value === 'string' && /^[1-9]\d{0,9}$/.test(value)
  && Number.isSafeInteger(Number(value)) ? Number(value) : null;

export function parseSessionReviewArgs(argv) {
  const options = { dryRun: false, noOpen: false, format: 'md', profile: DEFAULT_REVIEW_PROFILE };
  const values = new Map([['--repo', 'repo'], ['--choose', 'choose'], ['--backend', 'backend'], ['--model', 'model'],
    ['--timeout', 'timeoutMs'], ['--concurrency', 'concurrency'], ['--profile', 'profile'],
    ['--format', 'format'], ['--output', 'output'], ['--state-dir', 'stateDir'],
    ['--max-calls', 'maxCalls'], ['--max-input-bytes', 'maxInputBytes'], ['--stop-at-utilization', 'stopAtUtilization'],
    ['--github', 'github'], ['--pr', 'number'], ['--code-model', 'codeModel']]);
  const seen = new Set();
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') { options.help = true; continue; }
    if (arg === '--dry-run' || arg === '--no-open' || arg === '--post-comment' || arg === '--code-pass') {
      if (seen.has(arg)) throw usageError(`${arg} is given twice`);
      seen.add(arg);
      options[{ '--dry-run': 'dryRun', '--no-open': 'noOpen', '--post-comment': 'postComment',
        '--code-pass': 'codePass' }[arg]] = true;
      continue;
    }
    // Owner decision 2026-10-14: the code step is on unless the setting (settings.js) or this flag turns it off.
    if (arg === '--no-code-pass') {
      if (seen.has(arg)) throw usageError(`${arg} is given twice`);
      seen.add(arg); options.codePass = false;
      continue;
    }
    if (values.has(arg)) {
      const value = argv[++i];
      if (seen.has(arg)) throw usageError(`${arg} is given twice`);
      if (!value || value.startsWith('-')) throw usageError(`${arg} needs a value`);
      seen.add(arg); options[values.get(arg)] = value;
    } else if (arg.startsWith('-')) throw usageError(`unknown option ${named(arg)}`);
    else if (options.file) throw usageError('more than one recording path is given');
    else options.file = arg;
  }
  if (options.help) return options;
  if (seen.has('--code-pass') && seen.has('--no-code-pass')) throw usageError('give --code-pass or --no-code-pass, not both');
  if (options.file && options.choose !== undefined) throw usageError('give a recording path or --choose N, not both');
  // The code step's own model is a setting of the code step, and of nothing else: it applies whenever the step runs (by
  // default, by the setting or by --code-pass), so only a review that turns the step off on its own command line has no
  // use for it.
  if (options.codeModel !== undefined && options.codePass === false)
    throw usageError('--code-model is not used with --no-code-pass');
  // The PR comment's three flags go together, and only with the page it follows (the saved local page precedes the
  // confirmation). `--github` and `--pr` name the pull request to comment on and nothing else, by the GitHub client's
  // own rule (client.js `targetPath`), so a name it would refuse is refused here, before the review.
  if (options.postComment || options.github !== undefined || options.number !== undefined) {
    if (!options.postComment) throw usageError('--github and --pr are used only with --post-comment');
    if (options.github === undefined || options.number === undefined)
      throw usageError('--post-comment needs --github OWNER/REPO and --pr N');
    const number = positive(options.number);
    const [owner, repo, ...rest] = options.github.split('/');
    const target = '--github takes OWNER/REPO and --pr a pull request number';
    try { targetPath({ owner, repo, number }); } catch { throw usageError(target); }
    if (rest.length) throw usageError(target);
    if (options.format !== 'html' || !options.output)
      throw usageError('--post-comment needs --format html --output FILE');
    options.number = number;
  }
  for (const [key, flag] of [['choose', '--choose'], ['timeoutMs', '--timeout'], ['concurrency', '--concurrency']]) {
    if (options[key] === undefined) continue;
    options[key] = positive(options[key]);
    if (options[key] === null) throw usageError(`${flag} needs a whole number from 1`);
  }
  if ((options.timeoutMs ?? 1) > 2_147_483_647) throw usageError('--timeout can be at most 2147483647 milliseconds');
  if (!REVIEW_SPEED_PROFILE_NAMES.includes(options.profile)) throw usageError('unknown --profile value');
  const lanes = reviewSpeedProfile(options.profile).windowConcurrency;
  if ((options.concurrency ?? 1) > lanes) throw usageError(`--concurrency can be at most ${lanes}`);
  if (options.concurrency === undefined && options.profile === DEFAULT_REVIEW_PROFILE)
    options.concurrency = Math.min(DEFAULT_REVIEW_CONCURRENCY, lanes);
  if (!['md', 'html'].includes(options.format)) throw usageError('--format takes md or html');
  if (options.format === 'html' && !options.output) throw usageError('--format html needs --output FILE');
  if (options.backend !== undefined && !['claude-cli', 'codex-cli', 'anthropic-api'].includes(options.backend))
    throw usageError('--backend takes claude-cli, codex-cli or anthropic-api');
  return normalizeReviewBudget(options);
}

// Only existing closed codes select fixed advice; neither recording text nor provider text is read.
const FIXES = Object.freeze({
  session_not_found: 'Choose an existing readable recording path, or run sonah sessions --repo DIR and choose a listed session.',
  output_exists: 'Choose a new --output filename; existing reviews are never overwritten.',
  output_folder_missing: 'The folder named in --output does not exist. Create it first, or choose a file in a folder '
    + 'that exists, such as ~/review.html.',
  output_folder_unwritable: 'You cannot write to the folder named in --output. Choose a file in a folder you own, such '
    + 'as ~/review.html.',
  unsupported_backend: 'Choose --backend claude-cli, codex-cli or anthropic-api.',
  invalid_model: 'Choose an exact model ID; Claude session reviews need a full attested ID, with the 1M default recommended. Run sonah doctor.',
  explicit_api_model_required: 'Add --model with the exact Anthropic model ID your account supports.',
  anthropic_key_missing: 'Set ANTHROPIC_API_KEY in your terminal or secret manager, then retry.',
  review_in_progress: 'Wait for the other review to finish, then retry. A lock left by a crashed review is reclaimed automatically.',
  review_state_invalid: 'Check that your SONAH_HOME directory is owned by you and writable; preserve existing history.',
  review_interrupted: 'Run the same command again to resume; stored answers are reused for identical requests.',
  model_unavailable: 'Run sonah doctor to check the reviewer and requested context window, then run the same command again.',
  checkpoint_failed: 'Check that your SONAH_HOME directory is writable, then run the same command again to resume.',
  github_auth_missing: 'Run gh auth login, or provide GH_TOKEN or GITHUB_TOKEN through your terminal or secret '
    + 'manager.',
  publication_disabled: 'Remove --post-comment for a local review. To post the comment, use a GitHub App token that '
    + 'can write reviews and checks, set SONAH_GITHUB_ACTOR_ID and SONAH_GITHUB_APP_ID, and name a pull request of a '
    + 'private repository.',
  github_unavailable: 'Check that your GitHub token can read the repository and that the pull request exists, then '
    + 'run the same command again.',
  github_response_invalid: 'Check that --github OWNER/REPO and --pr N name the pull request as GitHub shows it, then '
    + 'run the same command again.',
  [OUTPUT_NOT_MASKED]: 'Nothing was written: the review text could not be checked for secrets. Run the same command '
    + 'again (answers are kept); if it repeats, run sonah feedback and report it.',
  config_invalid: 'Your Sonah settings file could not be read, so nothing was read or sent. Run sonah config code-pass on '
    + 'or sonah config code-pass off to write it again, or add --code-pass or --no-code-pass to this review.',
});
const fixOf = (code) => FIXES[code] ?? 'Run sonah doctor --no-probe, inspect the recording with --dry-run, and choose an output directory you own.';

/** --code-model: the code step's model as the person set it — the flag, else SONAH_CODE_MODEL — whenever the code step
 *  runs in this review (`codeStep.on`, settings.js `resolveCodePass`: by default, by the setting or by --code-pass);
 *  null when the step does not run or neither names one (the code step then runs on the session's model, as before). */
export const codeModelOf = (codeStep, options, env) => (codeStep?.on === true
  ? options.codeModel ?? env.SONAH_CODE_MODEL ?? null : null);

/** --code-model: the code step's reviewer settings — `codeModel` on the session's backend, accepted as `--model` is
 *  (reviewJudgeConfig: an exact id, the CLI's context selector only on a full claude-cli id) and, on claude-cli, only an
 *  id whose served model can be attested (`invalid_model` otherwise) — or null for none. */
export function codeJudgeConfig(env, { backend, codeModel }) {
  if (codeModel === null || codeModel === undefined) return null;
  const config = reviewJudgeConfig(env, { backend, model: codeModel });
  if (config.backend === 'claude-cli' && !attestableModel(config.model)) throw failure('invalid_model');
  return config;
}

/** Injectable boundaries are for synthetic tests; the default path uses the product's own loaders,
 * transport, private stores and renderers. Selection and dry planning do not construct a reviewer.
 * D84 (owner decision 2026-10-12, "off for the model, on for output"): the session is loaded unredacted for the model
 * (recorded-session.js); the story or page is masked as it is rendered (with what the redactor's full walk hides in the
 * session, redact `peopleSecretsFor`) and passed once more through `maskOutput` (the one output function,
 * `maskForPeople`, given the session's values) as a whole before anything is written or printed — when that fails,
 * nothing is (`output_not_masked`). The answers and the review kept under SONAH_HOME hold the model's quotes as it read
 * them: they stay on this computer, owner-only (0600 files in 0700 folders). */
export async function runSessionReviewCommand(argv, { stdout = process.stdout, stderr = process.stderr,
  cwd = process.cwd(), env = process.env, discover = discoverSessions, loadSession = loadRecordedSessionWithHash,
  createJudge = createReviewJudge, runSession = reviewSession, loadReviews = loadDecisionReviews,
  signal = null, installSignals = true, openPage = openLocalPage, client = null, confirm = undefined,
  resolveToken = null, maskOutput = maskForPeople, readCode = readCodeSnapshot, runCode = reviewCodePass } = {}) {
  let options;
  try { options = parseSessionReviewArgs(argv); }
  catch (error) {
    // The problem first, in fixed words (it names an option the person typed), then the usage line. A problem that
    // ends in `...` (a shortened option) gets no second full stop.
    const end = (text) => (text.endsWith('...') ? '' : '.');
    const problem = typeof error?.problem === 'string' ? `sonah review: ${error.problem}${end(error.problem)}\n` : '';
    stderr.write(`${problem}usage: ${SESSION_REVIEW_USAGE_LINE}\nRun sonah review --help to see the options.\n`);
    return 2;
  }
  if (options.help) {
    stdout.write(`${sessionReviewUsage}\n`);
    return 0;
  }
  const controller = new AbortController();
  const admission = new AbortController();
  const stopAdmission = () => admission.abort();
  const abort = () => controller.abort();
  let admissionFailure = null;
  let latestRateLimit = null;
  let budget = null, reviewStarted = false;
  // --code-model: the models the usage line names (the code step's and the session's); none otherwise.
  let usageModels = undefined;
  try {
    budget = createReviewBudget(options);
    // B3: the principal ids a post needs are checked before anything is read; the token and the pull request itself
    // before the first model call (below).
    if (options.postComment) (await import('./pr-sharing.js')).validatePrSharing({ env });
    controller.signal.addEventListener('abort', stopAdmission, { once: true });
    budget.signal.addEventListener('abort', stopAdmission, { once: true });
    const home = env.HOME ?? homedir();
    // Owner decision 2026-10-14: whether the code step runs — the flag, then the setting, then the default (on) — decided
    // before anything is read, so a settings file that cannot be read stops the review here (`config_invalid`).
    const codeStep = await resolveCodePass({ flag: options.codePass, env, home });
    const roots = { claude: claudeProjectsDir({ env, home }), codex: resolve(env.CODEX_HOME || join(home, '.codex')) };
    const repo = resolve(cwd, options.repo ?? '.');
    const output = options.output ? resolve(cwd, options.output) : null;
    if (output) {
      // An existing file is never overwritten; a folder that is not there, or that is not yours to write, is named.
      try { await lstat(output); throw failure('output_exists'); }
      catch (error) {
        if (error?.code === 'ENOTDIR') throw failure('output_folder_missing');
        if (error?.code !== 'ENOENT') throw error;
      }
      try { await access(dirname(output), constants.W_OK); }
      catch (error) {
        if (error?.code === 'ENOENT' || error?.code === 'ENOTDIR') throw failure('output_folder_missing');
        if (error?.code === 'EACCES' || error?.code === 'EPERM' || error?.code === 'EROFS')
          throw failure('output_folder_unwritable');
        throw error;
      }
    }
    let file, adapter = null;
    if (options.file) file = resolve(cwd, options.file);
    else {
      const discovered = await discover({ repo, claudeProjects: roots.claude, codexHome: roots.codex });
      if (!discovered.sessions.length) {
        stdout.write('No Claude Code or Codex session was found for this repository. Run a coding session here, or pass an existing recording path.\n');
        stdout.write(`Searched Claude projects: ${roots.claude}; Codex home: ${roots.codex}.\n`);
        stdout.write('If recordings are elsewhere, set SONAH_CLAUDE_PROJECTS or CODEX_HOME, or pass an existing recording path.\n');
        return 1;
      }
      const picked = discovered.sessions[(options.choose ?? 1) - 1];
      if (!picked) throw failure('session_not_found');
      file = picked.file; adapter = picked.adapter;
    }
    try { await access(file, constants.R_OK); } catch { throw failure('session_not_found'); }
    const loaded = await loadSession({ parent: file, codexHome: roots.codex,
      claudeProjects: roots.claude, sessionKey: 'session' });
    const { session, hash } = loaded;
    stdout.write(`Recording: ${file} (${adapter ?? session.adapter}).\n`);
    const backend = options.backend ?? env.SONAH_REVIEW_BACKEND ?? 'claude-cli';
    // Owner decision 2026-10-10: no default limits; say up front how long the review should take, from its own plan
    // (D84 (4) a: the time only; each window's first request size sets it). A window whose request is over the review's
    // bound is declared `unreviewed_scope` and never sent, so it adds no time.
    const sizeOf = ({ request }) => Buffer.byteLength(request.system) + Buffer.byteLength(request.prompt);
    const bound = requestBoundOf(reviewSpeedProfile(options.profile), 'session-only', backend);
    // D87: with the code step on, the files are read and frozen now, before any call (code-snapshot.js), under the
    // working directory the recording names; the estimate then adds the step's first requests, run after the session's
    // parts. A file whose real path is in Claude Code's configuration folder or Codex's home, as this computer names
    // them, is withheld (`harness_home`), but for one in a worktree there (the project under review, as the slicer reads
    // it). The release review (low): and the harness home that wrote the recording, from where the recording lies in
    // its recorder's own layout (`recordingHarnessHome`; for Claude Code, under the folder it names after the working
    // directory the recording states), so a home set by CLAUDE_CONFIG_DIR or CODEX_HOME when the session ran, and not
    // now, is one too.
    const recorder = recordingHarnessHome(file, session.adapter, loaded.cwd ?? null);
    const snapshot = codeStep.on ? await readCode(session, { root: loaded.cwd ?? null, home,
      harness: [claudeConfigDir({ env, home }), roots.codex, ...(recorder ? [recorder] : [])], maxBytes: bound,
      recording: file }) : null;
    const estimateOf = (plan, dryRun = false) => estimateLine({
      requestBytes: plan.requests.map(sizeOf).filter((bytes) => bytes <= bound),
      lanes: options.concurrency ?? reviewSpeedProfile(options.profile).windowConcurrency, dryRun,
      ...(snapshot ? { after: codePassRequestBytes(snapshot, bound) } : {}) });
    const digest = createHash('sha256').update(file).digest('hex');
    const state = options.stateDir ? resolve(cwd, options.stateDir)
      : join(env.SONAH_HOME ?? join(home, '.sonah'), 'session-reviews', digest);
    if (options.dryRun) {
      if (!['claude-cli', 'codex-cli', 'anthropic-api'].includes(backend)) throw failure('unsupported_backend');
      const plan = planWindowRequests({ session, reviewScope: 'session-only', backend, speedProfile: options.profile });
      const over = plan.requests.filter((planned) => sizeOf(planned) > bound).length;
      for (const line of dryRunLines({ events: session.events.length, windows: plan.windows.length, over }))
        stdout.write(`${line}\n`);
      stdout.write(`${estimateOf(plan, true)}\n`);
      stdout.write(`${codeStepLine(codeStep, codePassRequestBytes(snapshot, bound).length)}\n`);
      for (const line of capturePreflightLines(session)) stdout.write(`${line}\n`);
      if (snapshot) stdout.write(`${codeSnapshotLine(snapshot)}\n`);
      // The reuse dry run: with the code step and --state-dir, what a review there
      // would reuse of the stored session answers and what the code step would send first. No call; nothing written.
      if (snapshot && options.stateDir) {
        const model = options.model ?? env.SONAH_MODEL ?? (backend === 'claude-cli' ? SESSION_REVIEW_CLAUDE_CLI_MODEL
          : undefined);
        let replay = null, codeModel = null;
        try {
          const config = reviewJudgeConfig(env, { backend, model });
          codeModel = codeJudgeConfig(env, { backend, codeModel: codeModelOf(codeStep, options, env) })?.model ?? null;
          replay = await dryRunReplay({ session, snapshot, backend, model: config.model, speedProfile: options.profile,
            concurrency: options.concurrency, answerCache: createAnswerCache(join(state, 'answers'),
              { ...config, readOnly: true }) });
        } catch { replay = null; }
        for (const line of replay ? replayLines({ ...replay, codeModel }) : [REPLAY_UNREAD]) stdout.write(`${line}\n`);
      }
      if (options.postComment)
        for (const line of await savedCommentLines(state, options, session)) stdout.write(`${line}\n`);
      return 0;
    }
    if (options.postComment) {
      // D82 step 10: a comment that could never be posted stops the review before its first model call: no token, or a
      // pull request that does not exist, that the token cannot read, or whose repository is public. The pull request
      // is read again after the page, so the comment is planned against the head current then.
      if (!client) {
        const token = await (resolveToken ?? (await import('./github.js')).resolveToken)(env);
        if (!token) throw failure('github_auth_missing');
        client = (await import('../../github/index.js')).createGitHubClient({ token });
      }
      const [owner, repo] = options.github.split('/');
      await (await import('./pr-sharing.js')).readPrTarget({ client, github: { owner, repo, number: options.number } });
    }
    const model = options.model ?? env.SONAH_MODEL ?? (backend === 'claude-cli' ? SESSION_REVIEW_CLAUDE_CLI_MODEL : undefined);
    const config = reviewJudgeConfig(env, { backend, model });
    if (backend === 'claude-cli' && !attestableModel(config.model)) throw failure('invalid_model');
    // --code-model (or SONAH_CODE_MODEL): the code step's own model, checked as the session's is, before any call; with
    // neither, null, and the code step runs on the session's model and transport, as before.
    const codeConfig = codeJudgeConfig(env, { backend, codeModel: codeModelOf(codeStep, options, env) });
    if (signal?.aborted) throw failure('review_interrupted');
    // Same admission facts as the existing session harness: one successful transport report,
    // attested Claude identity, and the requested context window when the model has a selector.
    const reports = new AsyncLocalStorage();
    const requestedWindow = selectedContextWindow(config.model);
    if (['claude-cli', 'codex-cli', 'anthropic-api'].includes(backend))
      stdout.write(`${estimateOf(planWindowRequests({ session, reviewScope: 'session-only', backend, speedProfile: options.profile }))}\n`);
    stdout.write(`${codeStepLine(codeStep, codePassRequestBytes(snapshot, bound).length)}\n`);
    reviewStarted = true;
    if (codeConfig) usageModels = { codeModel: codeConfig.model, sessionModel: config.model };
    const onResultOf = (part) => (metadata) => {
      budget.record(metadata, part);
      latestRateLimit = rateLimitRecordOf(metadata?.rateLimit) ?? latestRateLimit;
      reports.getStore()?.push(metadata);
    };
    const transport = createJudge({ config, env, timeoutMs: options.timeoutMs ?? 20 * 60_000,
      signal: controller.signal, onResult: onResultOf(null) });
    // Each answer's admission: one successful attempt, its served model attested as the one requested, and the context
    // window that model's selector asks for. The code step's judge (--code-model) is admitted by the same rule against
    // its own model.
    const admitted = (counted, window) => async (request) => {
      const attempt = [];
      const answer = await reports.run(attempt, () => counted(request));
      const metadata = attempt[0];
      if (attempt.length !== 1 || metadata?.ok !== true
          || !(metadata.attestation === 'attested' || (backend !== 'claude-cli' && metadata.attestation === 'unattested'))
          || (window !== null && metadata.contextWindow !== window)) {
        admissionFailure = 'model_unavailable'; controller.abort(); throw failure(admissionFailure);
      }
      return answer;
    };
    const judge = admitted(budget.wrap(transport), requestedWindow);
    // --code-model: every code-step call (step 1, the lenses, their re-asks and their checking passes) goes to a
    // transport of its own on that model, counted in the same budget and stopped by the same signals.
    const codeJudge = snapshot && codeConfig ? admitted(budget.wrap(createJudge({ config: codeConfig, env,
      timeoutMs: options.timeoutMs ?? 20 * 60_000, signal: controller.signal, onResult: onResultOf(CODE_STEP_PART) }),
    CODE_STEP_PART), selectedContextWindow(codeConfig.model)) : judge;
    if (signal?.aborted) controller.abort();
    signal?.addEventListener('abort', abort, { once: true });
    if (installSignals) { process.on('SIGINT', abort); process.on('SIGTERM', abort); }
    let result;
    try {
      result = await runSession({ session, judge, backend, model: config.model,
        answerCache: createAnswerCache(join(state, 'answers'), config), store: createSessionReviewStore(join(state, 'review')),
        speedProfile: options.profile, concurrency: options.concurrency, signal: admission.signal,
        rateLimitTally: () => latestRateLimit,
        onWindowRecord: (event) => stderr.write(`Review window ${event.window}/${event.of} finished\n`) });
    } finally {
      signal?.removeEventListener('abort', abort);
      if (installSignals) { process.off('SIGINT', abort); process.off('SIGTERM', abort); }
    }
    let { report } = result;
    // D87: the code pass, after the session's review and on its report; its own stored answers (`code-pass/answers`).
    if (snapshot) {
      if (!snapshot.root) stdout.write(`${CODE_PASS_NO_ROOT}\n`);
      // --code-model: the code step's stored answers are keyed by its own model (answer-cache.js `answerKey` binds the
      // model and the argv), so an answer one model gave is never replayed for another.
      // The release review (owner, 2026-10-14): only --code-pass on the command line makes the code step's coverage
      // decide the exit code; on by default or by the setting, its coverage is shown and the session review decides.
      ({ report } = await runCode({ session, report, snapshot, judge: codeJudge, backend, speedProfile: options.profile,
        required: codeStep.source === 'flag' && codeStep.on === true,
        signal: admission.signal, answerCache: createAnswerCache(join(state, 'code-pass', 'answers'), codeConfig ?? config),
        store: createSessionReviewStore(join(state, 'review')), ...(codeConfig ? { model: codeConfig.model } : {}) }));
    }
    stdout.write(`${runStateLine(report)}\n`);
    for (const line of [coverageSummaryLine(report), notCoveredLine(report), windowCompletionLine(report.instrument?.windowCompletion)])
      if (line) stdout.write(`${line}\n`);
    stdout.write(`${attentionCliLines(report).join('\n')}\n`);
    const answers = report.instrument?.answers;
    if (answers) stdout.write(`Model answers: ${answers.reused} of ${answers.calls + answers.reused} reused (no call).\n`);
    const codeAnswers = report.codePass?.answers;
    if (codeAnswers) stdout.write(`Code pass answers: ${codeAnswers.reused} of ${codeAnswers.calls + codeAnswers.reused} `
      + 'reused (no call).\n');
    // D87: what the output rules hide in the files the pass read is masked in everything written, beside the session's
    // own values (redact `peopleSecretsOfTexts`); when that scan cannot run, nothing is written.
    let codeSecrets = [];
    if (snapshot) {
      try { codeSecrets = peopleSecretsOfTexts(snapshotTexts(snapshot)); } catch { throw failure(OUTPUT_NOT_MASKED); }
    }
    const content = forPeople(options.format === 'html'
      ? renderSessionPage(session, report, { sessionHash: hash, codeSecrets,
        decisionReviews: answersFor(hash, await loadReviews().catch(() => new Map())) })
      : renderSessionStory(session, report, { codeSecrets }), options.format,
    (text) => maskOutput(text, joinSecretValues(peopleSecretsFor(session).values, codeSecrets)));
    if (output) {
      await writeFile(output, content, { mode: 0o600, flag: 'wx' });
      if (options.format === 'html') await presentLocalPage(output, { stdout, stderr, noOpen: options.noOpen, openPage });
      else stdout.write(`Session checklist: ${output}\n`);
    } else stdout.write(`${content}\n`);
    if (options.postComment) {
      const [owner, repo] = options.github.split('/');
      const sharing = await (await import('./pr-sharing.js')).sharePrReview({ client,
        github: { owner, repo, number: options.number }, report, stateDir: state, env, stdout, stderr, confirm,
        mask: commentMask(session, report) });
      if (sharing?.exitCode) return sharing.exitCode;
    }
    return reviewExitCode(report);
  } catch (error) {
    const allowed = [...CLI_SAFE_ERROR_CODES, ...JUDGE_FAILURE_CODES, ...RUN_FAILURE_CODES, ...GITHUB_ERROR_CODES];
    const code = admissionFailure ?? (error?.code === 'EEXIST' ? 'output_exists'
      : allowed.includes(error?.code) ? error.code : 'review_failed');
    stderr.write(`Review could not complete: ${code}.\nFix: ${fixOf(code)}\n`);
    const toolFailure = ['review_failed', 'model_unavailable', OUTPUT_NOT_MASKED];
    return RUN_FAILURE_CODES.includes(code) || toolFailure.includes(code) ? 3 : 2;
  } finally {
    controller.signal.removeEventListener('abort', stopAdmission);
    budget?.signal.removeEventListener('abort', stopAdmission);
    if (reviewStarted) {
      stdout.write(`${budget.summaryLine(usageModels)}\n`);
      const paused = budget.pauseLine();
      if (paused) stdout.write(`${paused}\n`);
    }
  }
}

/**
 * D84 x D82 step 10: the PR comment's mask, the session's (redact `peopleMask` over what the redactor's full walk hides
 * in it, `peopleSecretsFor`, with the values `report` restates): what `escapePublicText` masks each comment text with.
 * Built on the comment's first text, so a walk that cannot run fails that text (`disclosure_rejected`) and nothing is
 * posted or shown.
 */
function commentMask(session, report) {
  let mask = null;
  return (text) => (mask ??= peopleMask(peopleSecretsFor(session).values, { restatedIn: report }))(text);
}

/**
 * D82 step 10: what a dry run with --post-comment shows — the comment this recording's last finished review would
 * post (`publicCommentText`: counts and fixed words only), read from the review's saved report, with nothing read from
 * GitHub and nothing posted. Fixed sentences when there is no such review or it cannot be read.
 */
async function savedCommentLines(state, { github, number }, session) {
  const target = `PR comment for ${github}#${number}`;
  let report = null;
  try {
    const parsed = strictJson(await readFile(join(state, 'review', 'report.private.json'), 'utf8'));
    report = parsed.json && parsed.strict ? parsed.value : null;
  } catch { report = null; }
  const after = 'A review without --dry-run shows the comment again and posts it only once you confirm it.';
  const none = (why) => [`${target}: ${why}, so there is no comment to show. ${after}`];
  if (report === null) return none('this recording has no finished review yet');
  let text;
  try {
    text = (await import('../../github/index.js')).publicCommentText(report, { mask: commentMask(session, report) })
      .summary;
  }
  catch { return none("this recording's last saved review could not be read"); }
  return [`${target}, as this recording's last finished review would post it (a dry run reads nothing from GitHub and `
    + 'posts nothing):', text, after];
}

/**
 * F177. One closed line after the window progress lines: how many windows completed of how many,
 * each recorded reason the others did not with its count, in the vocabulary's order, and — only
 * when there are any — how many are incomplete with no recorded reason. Tokens and counts only:
 * a token outside `WINDOW_INCOMPLETE_REASONS` or a count that is not a count never prints, and a
 * record that cannot be read prints nothing.
 */
export function windowCompletionLine(completion) {
  const isCount = (n) => Number.isSafeInteger(n) && n >= 0;
  if (!completion || !isCount(completion.windows) || !isCount(completion.complete) || !isCount(completion.unexplained)
      || completion.complete > completion.windows) return null;
  const counts = completion.byReason ?? {};
  const reasons = WINDOW_INCOMPLETE_REASONS.filter((r) => Object.hasOwn(counts, r) && isCount(counts[r]) && counts[r] > 0)
    .map((r) => `${r} ×${counts[r]}`);
  let line = `Windows complete: ${completion.complete} of ${completion.windows}`;
  if (completion.complete < completion.windows && reasons.length) line += `; incomplete: ${reasons.join(', ')}`;
  if (completion.unexplained > 0) line += `; incomplete with no recorded reason: ${completion.unexplained}`;
  return line;
}

/**
 * D71 (a), owner decision 2026-10-08: the exit code reports only whether Sonah's own review ran — `complete` 0,
 * `incomplete` 1, `failed` 3 (ledger.js REVIEW_RUN_STATES) — never a judgment of the agent's work. A review with
 * findings that ran to the end exits 0; one that did not finish exits 1 whatever it found. Usage errors stay 2.
 * (Before D71 the exit followed the review's status: DECIDE 1, NO_FINDINGS and UNCHECKED 3.)
 */
export const REVIEW_RUN_EXIT_CODES = Object.freeze({ complete: 0, incomplete: 1, failed: 3 });
export function reviewExitCode(report) {
  const state = reviewRunState(report);
  return REVIEW_RUN_STATES.includes(state) ? REVIEW_RUN_EXIT_CODES[state] : REVIEW_RUN_EXIT_CODES.failed;
}

/** D71 (a): the CLI's words for what of Sonah's own review ran, by part — fixed words, never a status. D87: and the
 *  code pass, by its own coverage. */
export const RUN_STATE_WORDS = Object.freeze({
  complete: 'complete', incomplete: 'incomplete', failed: 'failed',
  code: Object.freeze({ complete: 'read every file', partial: 'did not read every file', missing: 'not run' }),
  session: Object.freeze({ complete: 'complete', incomplete: 'did not complete' }),
  codePass: Object.freeze({ complete: 'read every file it showed', partial: 'did not read every file it showed',
    missing: 'not run', incomplete: 'did not complete', noFile: 'had no file to read: the session changed or read none' }),
  // The release review: after a code pass short of complete that the person did not require on the command line.
  codePassApart: ', which does not change the exit code (add --code-pass to make it count)',
});

/** D71 (a): the first line the review command prints — whether Sonah's own review ran, and of what. Counts and fixed
 *  words only; no status, finding or session text. */
export function runStateLine(report, mode) {
  const state = reviewRunState(report);
  let honest = null;
  try { honest = honestStatuses({ ...report, findings: Array.isArray(report?.findings) ? report.findings : [] }); }
  catch { honest = null; }
  const session = RUN_STATE_WORDS.session[honest?.sessionReview === 'complete' ? 'complete' : 'incomplete'];
  const parts = [`session review ${session}`];
  if (honest?.reviewScope !== 'session-only') {
    const code = Object.hasOwn(RUN_STATE_WORDS.code, report?.codeCoverage) ? report.codeCoverage : 'missing';
    parts.unshift(`code review ${RUN_STATE_WORDS.code[code]}`);
  }
  if (report?.codePass !== undefined) {
    // D87 review: a pass that ran over a session which changed or read no file read "every file it showed" — true, and
    // reassuring; it says there was none.
    const none = report.codePass?.ran === true && Array.isArray(report.codePass.files) && !report.codePass.files.length;
    const coverage = ['complete', 'partial', 'missing'].includes(report.codePass?.coverage)
      ? report.codePass.coverage : 'missing';
    // The second release review (low): a pass that ran and has no complete answer is one that did not complete, as the
    // page and the story say (`ran`), never one that was not run.
    const pass = none ? 'noFile' : coverage === 'missing' && report.codePass?.ran === true ? 'incomplete' : coverage;
    // The release review (owner, 2026-10-14): a code step that ran by default or by the setting, short of complete, is
    // said plainly, with why the review still reads complete (only --code-pass makes its coverage count).
    const apart = report.codePass?.required === false && pass !== 'complete' && pass !== 'noFile';
    parts.push(`code pass ${RUN_STATE_WORDS.codePass[pass]}${apart ? RUN_STATE_WORDS.codePassApart : ''}`);
  }
  const how = ['initial', 'incremental', 'cached'].includes(mode) ? ` ${mode} review.` : '';
  return `Sonah's review: ${RUN_STATE_WORDS[state]} (${parts.join('; ')}).${how}`;
}

/** D71 (a), (d); S6 (S5 review M2): the heading of the checklist's attention lines the CLI prints. */
export const ATTENTION_CLI_HEADING = 'Where your attention is needed (each is listed in the review and on the session page):';

/**
 * D71 (a), (d); S6 (S5 review M2): the checklist's attention lines as the CLI prints them, after the run state — the same
 * counts and fixed words, in the same order, as the PR comment's and the page's summary (review.js `attentionSummary`); a
 * line the review bolds (a choice not to act, a failure passed over) is marked `!`, every other `-`. When nothing is
 * counted it says so, and that this is not a statement that the work is right. D88 (owner decision 2026-10-14): only the
 * agent's judgment and the settled problems are counted (review.js ATTENTION_ROWS); then one plain line, unmarked, says
 * how many rows Sonah could not check are folded, and where. Counts and fixed words only.
 */
export function attentionCliLines(report) {
  let summary = { lines: [], folded: null };
  try { summary = attentionSummary(report); } catch { summary = { lines: [], folded: null }; }
  const { lines, folded } = summary;
  return [ATTENTION_CLI_HEADING, ...(lines.length
    ? lines.map((line) => `  ${line.includes('**') ? '!' : '-'} ${line.split('**').join('')}`)
    : [`  ${ATTENTION_CLI_NONE}`]), ...(typeof folded === 'string' ? [`  ${folded}`] : [])];
}
/** The CLI's words when nothing is counted (the PR comment's, without "below"). */
export const ATTENTION_CLI_NONE = 'The review lists nothing for your attention. That is not a statement that the work is right.';

/**
 * Every declared cause of what the review could not cover, with its count, in the renderer's code-owned sentences —
 * fixed words and integers only, never a gap note, path or quote. D71 (a): shown whenever the coverage is short of
 * complete (before D71, only beside a NO_FINDINGS status); null when it is complete.
 */
export function notCoveredLine(report) {
  if (report?.coverage === 'complete' && report?.codeCoverage !== 'partial') return null;
  let causes = [];
  try { causes = coverageCauses(report); } catch { causes = []; }
  if (causes.length) return `Not covered: ${causes.map(([cause, counts]) => COVERAGE_SENTENCE[cause](counts)).join('; ')}.`;
  return report?.coverage === 'partial'
    ? 'Not covered: the report declares partial session coverage but names no cause.' : null;
}

/** A counts-only CLI summary. Every printed word is fixed here, and every printed value is a
 * closed coverage state or a validated count; recording paths, gap notes and model text stay out. */
export function coverageSummaryLine(report) {
  const states = new Set(['complete', 'partial', 'missing']);
  const isCount = (n) => Number.isSafeInteger(n) && n >= 0;
  const parts = [];
  if (states.has(report?.codeCoverage)) parts.push(`code ${report.codeCoverage}`);
  if (report?.coverage === 'complete') parts.push('session complete');
  else if (report?.coverage === 'missing') parts.push(report?.hasSessionEvidence === false
    ? 'session evidence unavailable (no linked recording)' : 'session evidence unavailable (no complete session review)');
  else if (report?.coverage === 'partial') {
    const gaps = Array.isArray(report?.session?.adapterGaps) ? report.session.adapterGaps : [];
    const observations = gaps.filter((gap) => gap?.code === 'incomplete_inventory'
      && gap?.channel === 'observations' && gap?.scope === 'session');
    const n = observations.every((gap) => isCount(gap.count))
      ? observations.reduce((sum, gap) => sum + gap.count, 0) : null;
    const cause = observations.length
      ? `including ${Number.isSafeInteger(n) && n > 0 ? `${n} action result${n === 1 ? '' : 's'}` : 'action result evidence'} missing, withheld, or unlinked`
      : 'see report for the unchecked scope';
    parts.push(`session evidence incomplete (${cause})`);
  }

  // D87: the code pass's own coverage, when it ran (`report.codePass`).
  if (states.has(report?.codePass?.coverage)) parts.push(`code pass ${report.codePass.coverage}`);

  const files = report?.codeCoverageFacts;
  const placed = files?.placed;
  if (Array.isArray(placed) && isCount(files?.snapshotFiles) && files.snapshotFiles > 0
      && placed.length <= files.snapshotFiles
      && placed.every((path) => typeof path === 'string' && path.length > 0)
      && new Set(placed).size === placed.length)
    parts.push(`files ${placed.length}/${files.snapshotFiles}`);

  const windows = report?.instrument?.windowCompletion;
  if (isCount(windows?.complete) && isCount(windows?.windows) && windows.windows > 0
      && windows.complete <= windows.windows)
    parts.push(`windows ${windows.complete}/${windows.windows}`);

  if (Array.isArray(report?.session?.adapterGaps)
      && report.session.adapterGaps.length > 0
      && report.session.adapterGaps.every((gap) => gap !== null && typeof gap === 'object' && !Array.isArray(gap)))
    parts.push(`adapter gaps ${report.session.adapterGaps.length}`);

  return parts.length ? `Coverage: ${parts.join('; ')}.` : null;
}

/** Owner decision 2026-10-14: where the code step's setting for this review came from (settings.js
 *  CODE_PASS_SOURCES), in the words the code step's line gives it. */
export const CODE_STEP_SOURCE_WORDS = Object.freeze({ flag: Object.freeze({ on: '--code-pass', off: '--no-code-pass' }),
  config: 'your setting, sonah config', default: 'the default' });

/**
 * Owner decision 2026-10-14: the line beside the time estimate (and in a dry run) that says whether the code step runs in
 * this review, why (the flag, the setting or the default), and roughly how many calls it adds: `calls`, its first
 * requests (`codePassRequestBytes`), then three checking passes for each answer and finding they give, which no plan can
 * count before the answers. Fixed words and one count only.
 */
export function codeStepLine({ on, source } = {}, calls = 0) {
  const words = CODE_STEP_SOURCE_WORDS[source] ?? CODE_STEP_SOURCE_WORDS.default;
  const why = typeof words === 'string' ? words : words[on ? 'on' : 'off'];
  if (on !== true) return `Code step: off (${why}). Only the session is reviewed; no file is read or sent. Turn it on `
    + 'with --code-pass, or for every review with sonah config code-pass on.';
  const n = Number.isSafeInteger(calls) && calls > 0 ? calls : 0;
  const adds = n ? `it adds about ${n} model calls after the session's review, then three checking passes for each `
    + 'answer and finding they give' : 'it found no file it can read here, so it adds no call';
  return `Code step: on (${why}). It reads the files the session changed or read, as they are now, and sends them to `
    + `the reviewer; ${adds}. Turn it off with --no-code-pass, or for every review with sonah config code-pass off.`;
}

/** D87: what the CLI says when the code step has no working directory to read the session's files under. */
export const CODE_PASS_NO_ROOT = 'Code pass: not run. The recording names no working directory that exists here, so no '
  + 'file was read.';

/** The code step's share of the time estimate: its first requests (step 1, then one per lens), each about the change
 *  and the files it would show, at most the request bound; none when there is nothing to read. */
export function codePassRequestBytes(snapshot, bound) {
  const files = (Array.isArray(snapshot?.files) ? snapshot.files : []);
  const readable = files.filter((file) => typeof file?.text === 'string');
  if (snapshot?.root !== true || !readable.length) return [];
  const bytes = Math.min(bound, readable.reduce((sum, file) => sum + Buffer.byteLength(fileBlock(file)) + 2, 0)
    + files.filter((file) => Array.isArray(file?.hunks)).reduce((sum, file) => sum + sectionBytes(file), 0));
  return [bytes, ...CODE_PASS_LENSES.map(() => bytes)];
}

const [GIT_BASE] = CODE_DIFF_BASES;
const [, UNRECORDED_DIFF] = CODE_DIFF_STATES;
/** The release review (medium): what the dry run says when the repository is the home folder or holds it — only the
 *  files the session changed or read are read, and how many other paths differ, counted. Fixed words and a count. */
export const homeRepositoryWords = (base) => (base?.homeRepository === true
  ? ` The repository is your home folder, so only the files the session changed or read are read${
    Number.isSafeInteger(base.unrecorded) && base.unrecorded > 0 ? `; ${base.unrecorded} other ${base.unrecorded === 1
      ? 'path differs' : 'paths differ'}, counted and not named` : ''}.` : '');

/** The dry run's line about the code pass: how many files the session changed or read, how many can be read now, the
 *  others by their closed state, and where the diff starts and how many paths it holds. Counts, closed words and the
 *  start commit's short id only. */
export function codeSnapshotLine(snapshot) {
  if (snapshot?.root !== true) return CODE_PASS_NO_ROOT;
  const files = Array.isArray(snapshot.files) ? snapshot.files : [];
  const readable = files.filter((file) => typeof file?.text === 'string').length;
  const others = CODE_FILE_STATES.map((state) => [state, files.filter((file) => file?.state === state).length])
    .filter(([, n]) => n > 0).map(([state, n]) => `${state} ×${n}`);
  const noun = (n) => `${n} file${n === 1 ? '' : 's'}`;
  const differing = files.filter((file) => typeof file?.diff === 'string');
  const unrecorded = differing.filter((file) => file.diff === UNRECORDED_DIFF).length;
  const commit = typeof snapshot.base?.commit === 'string' ? snapshot.base.commit.slice(0, 12) : null;
  const outside = Number.isSafeInteger(snapshot.base?.outside) && snapshot.base.outside > 0 ? snapshot.base.outside : 0;
  const base = snapshot.base?.kind === GIT_BASE && commit
    ? ` The diff starts at the session's start commit ${commit} (${snapshot.base.how}): ${differing.length} `
      + `path${differing.length === 1 ? '' : 's'} differ${differing.length === 1 ? 's' : ''}`
      + `${unrecorded ? `, ${unrecorded} not written by a recorded edit` : ''}`
      + `${outside ? `; ${outside} more outside the working directory, counted and not named` : ''}.`
      + homeRepositoryWords(snapshot.base)
    : ' No git base: the diff is the session\'s recorded edits.';
  return `Code pass: ${noun(files.length)} the session changed, read or git shows differing; ${readable} readable now`
    + `${others.length ? `; not readable: ${others.join(', ')}` : ''}.${base} A review would send the readable ones that fit.`;
}

/** What the dry run says when the stored answers could not be counted (the reviewer's settings could not be read). */
export const REPLAY_UNREAD = 'Stored session answers: not counted; the reviewer\'s settings could not be read. Nothing was sent.';
/** The reuse dry run's lines: the stored session answers a review would reuse, and the code step's first
 *  requests, counted. Counts, labels of Sonah's own and sizes only; with `codeModel` (--code-model), the model they would
 *  be sent to. */
export function replayLines({ answers, codeRequests, codeModel = null }) {
  const reused = Number.isSafeInteger(answers?.reused) ? answers.reused : 0;
  const missing = Number.isSafeInteger(answers?.calls) ? answers.calls : 0;
  const kb = (n) => `${Math.ceil(n / 1024)} KB`;
  const lines = [`Stored session answers: ${reused} of ${reused + missing} requests answered from the store (no call)`
    + `${missing ? `; at least ${missing} would be asked live` : ''}.`];
  if (codeRequests.length) lines.push(`Code step: it would first send ${codeRequests.length} request`
    + `${codeRequests.length === 1 ? '' : 's'} (${codeRequests.map((r) => `${r.label} ${kb(r.bytes)}`).join(', ')})`
    + `${typeof codeModel === 'string' && codeModel ? ` to ${codeModel}` : ''}, `
    + 'then three checking passes for each answer and finding they give.');
  else lines.push('Code step: it would send no request (no row to check and no differing path).');
  return lines;
}

/**
 * The dry run's first lines: that nothing was sent, written or posted; how many events the session holds and in how
 * many windows (the parts a review sends one at a time) it would be reviewed; and, only when there are any, the windows
 * too large for one request, which a review would not send and would list as not covered (`unreviewed_scope`).
 * Counts and fixed words only.
 */
export function dryRunLines({ events, windows, over }) {
  const noun = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
  const lines = ['Dry run: nothing was sent to a model, written or posted.',
    `The session has ${noun(events, 'event')}, to be reviewed in ${noun(windows, 'window')}.`];
  if (over > 0) lines.push(`${noun(over, 'window is', 'windows are')} too large for one request: a review would not `
    + `send ${over === 1 ? 'it' : 'them'} and would list ${over === 1 ? 'it' : 'them'} as not covered.`);
  return lines;
}

/** Facts available before inference, with only closed gap channels/codes and counts on stdout.
 * A declared gap can later be covered by the diff, so this is a capture inventory, not a verdict. */
export function capturePreflightLines(session) {
  const events = Array.isArray(session?.events) ? session.events : [];
  const actions = events.filter((event) => event?.kind === 'invocation').length;
  const instructions = events.filter((event) => event?.kind === 'instruction' && event.authority === 'human').length;
  const gaps = Array.isArray(session?.adapterGaps) ? session.adapterGaps : [];
  const noun = (n, singular) => `${n} ${singular}${n === 1 ? '' : 's'}`;
  const lines = [`In the recording: ${noun(actions, 'action')}; ${noun(instructions, 'human instruction')}; `
    + `${noun(gaps.length, 'known gap')}.`];
  const channels = new Set(['actions', 'observations', 'instructions', 'commentary', 'children', 'code']);
  const known = new Map();
  for (const gap of gaps) {
    if (!GAP_CODES.includes(gap?.code) || !channels.has(gap?.channel)) continue;
    const key = `${gap.channel}/${gap.code}`;
    const count = Number.isSafeInteger(gap.count) && gap.count >= 0 ? gap.count : null;
    const prior = known.get(key);
    known.set(key, prior === undefined ? count : prior === null || count === null ? null : prior + count);
  }
  if (known.size) lines.push(`Known gaps: ${[...known].sort(([a], [b]) => a.localeCompare(b))
    .map(([key, count]) => `${key}${Number.isSafeInteger(count) ? ` ×${count}` : ''}`).join('; ')}.`);
  return lines;
}
