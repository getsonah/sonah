// B2: local recording selection and the existing resumable session-only review. No Git base is
// inferred: reviewSession owns planning, grounding, checkpoints and exact transport answer reuse.
// D82 step 10 (B5 O1-B): the one review route. A count-only PR comment, off by default, is built from this review's
// report and posted only after the page is written and the person confirms it (`--github OWNER/REPO --pr N
// --post-comment`, pr-sharing.js); the pull request's metadata is the only thing read from GitHub.
import { AsyncLocalStorage } from 'node:async_hooks';
import { createHash } from 'node:crypto';
import { setMaxListeners } from 'node:events';
import { constants } from 'node:fs';
import { access, lstat, readFile, realpath, stat, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { CLI_SAFE_ERROR_CODES, CODE_STEP_BACKEND_GAP, GAP_CODES, JUDGE_FAILURE_CODES, REVIEW_RUN_STATES,
  RUN_FAILURE_CODES, honestStatuses, reviewRunState } from '../../evidence/src/ledger.js';
import { COVERAGE_SENTENCE, coverageCauses } from '../../evidence/src/review.js';
import { WINDOW_INCOMPLETE_REASONS, planWindowRequests, SESSION_REVIEW_CLAUDE_CLI_MODEL } from '../../evidence/src/run-review.js';
import { REVIEW_SPEED_PROFILE_NAMES, reviewSpeedProfile, requestBoundOf } from '../../evidence/src/review-profiles.js';
import { sessionPage } from '../../render/session-page.js';
import { renderReportMarkdown } from '../../render/session-story.js';
import { reportModel, noCodeText } from '../../render/report-model.js';
import { targetPath } from '../../github/client.js';
import { GITHUB_ERROR_CODES } from '../../github/errors.js';
import { PUBLICATION_WORDS } from '../../github/publication.js';
import { strictJson } from '../../slicer/src/strict-json.js';
import { createAnswerCache } from './answer-cache.js';
import { claudeProjectsDir, harnessHomePlaces } from './claude-home.js';
import { answersFor, loadDecisionReviews } from './decision-reviews.js';
import { loadRecordedSessionWithHash } from './recorded-session.js';
import { openLocalPage, presentLocalPage } from './local-page.js';
import { attestableModel, createReviewJudge, reviewJudgeConfig, selectedContextWindow, rateLimitRecordOf } from './review-judge.js';
import { discoverSessions } from './session-discovery.js';
import { createSessionReviewStore, dryRunReplay, reviewCodePass, reviewSession } from './session-review.js';
import { codeRepoTop, placeHolds, readCodeSnapshot } from './code-snapshot.js';
import { CODE_FILE_STATES, CODE_DIFF_BASES, CODE_DIFF_STATES } from '../../evidence/src/ledger.js';
import { CODE_ACCOUNT_LIMITS, CODE_OUTSIDE_STATES, agentsRead, placesOf, foldersOf, unresolvedOf }
  from '../../evidence/src/code-pass.js';
import { codeReviewCoverage, codeNoChangeOf, reportNotReviewedOf, CODE_NO_CHANGE_KEYS, CODE_REPORT_WORDS,
  CODE_REPORT_LIMITS } from '../../evidence/src/code-report.js';
import { CODE_STEP_PART, CODE_STEP_ESTIMATE_MINUTES, createReviewBudget, normalizeReviewBudget, estimateLine }
  from './review-budget.js';
import { resolveCodePass } from './settings.js';
import { outputsInRepository, readRepoFacts } from './repo-links.js';
import { countLines, mdPathFor, reportOutputLines } from './report-output.js';

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
  'Reviews one recorded session. With no path, it reviews the latest one of this',
  'repository.',
  '',
  'options:',
  '  --repo DIR, --choose N   where to look, and the Nth session that',
  '                           sonah sessions lists',
  '  --dry-run                show what a review would read and roughly how long',
  '                           it takes, and send nothing',
  '  --backend claude-cli|codex-cli|anthropic-api',
  '                           the reviewer (default claude-cli, which uses your',
  '                           Claude Code login)',
  '  --model ID               the reviewer\'s model, needed for codex-cli and',
  '                           anthropic-api (leave it out for claude-cli: its',
  '                           default is the 1M-token model)',
  '  --timeout MS             how long one model call can take (default 20 minutes)',
  '  --concurrency N          parts of the session reviewed at a time (default 4,',
  '                           at most 12, or 3 with --profile standard)',
  '  --profile standard       check every item in three passes (the default checks',
  '                           decisions and asks in one pass), and is slower',
  '  --code-pass, --no-code-pass',
  '                           the code review, on or off for this review (on',
  '                           unless you ran sonah config code-pass off). It',
  '                           reads the repository (Read, Grep, Glob, no shell),',
  '                           reviews the session\'s change against your ask and',
  '                           what the agent said, and checks each finding. It',
  '                           runs only on claude-cli',
  '  --code-model ID          the reviewer\'s model for the code review only, when',
  '                           it runs (default: the session\'s model)',
  '  --code-repo DIR          the code review also reads the change in this git',
  '                           repository (for edits made by a script or after a',
  '                           cd). Give it once for each repository',
  '  --format md|html         md (the default): the report for your pull request',
  '                           in Markdown. html: the HTML page, and the Markdown',
  '                           report beside it (needs --output)',
  '  --output FILE            write new files, in a folder that exists, instead',
  '                           of printing. With --format html, the page opens in',
  '                           your browser',
  '  --no-open                do not open the page',
  '  --state-dir DIR          where Sonah keeps stored answers and the report',
  '                           (default: under ~/.sonah)',
  '  --max-calls N, --max-input-bytes N, --stop-at-utilization U',
  '                           optional stops, off by default (run again to resume)',
  '  --github OWNER/REPO --pr N --post-comment',
  '                           a PR comment of counts only, off by default (needs',
  '                           --format html --output FILE). Sonah shows it after',
  '                           it writes the page, and posts it only when you',
  '                           confirm it',
  '',
  'With no PR number, gh pr comment --body-file FILE posts to your branch\'s PR.'].join('\n');
/** How many abort listeners one of a review's own signals (the one that stops its transports, its admission signal and
 *  its budget's) may hold before Node warns of a leak (`setMaxListeners`). Each call in flight holds one listener on the
 *  transports' signal until it settles (review-judge.js `cancellationOf`) and a slot of its profile's limiter meanwhile
 *  (session-review.js `boundedJudge`, the session review's and the code review's calls alike), so at most the largest
 *  `maxCallsInFlight` of any profile are there at once, beside the review's own listener (`stopAdmission`). Node's
 *  default, 10, is less than twelve calls in flight; a listener past this bound is a leak, and Node still warns of it. */
export const REVIEW_SIGNAL_MAX_LISTENERS = Math.max(...REVIEW_SPEED_PROFILE_NAMES
  .map((name) => reviewSpeedProfile(name).maxCallsInFlight)) + 1;
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
    // D124: --code-repo DIR, more than once allowed: a git repository the code review reads as a place of the change.
    if (arg === '--code-repo') {
      const value = argv[++i];
      if (!value || value.startsWith('-')) throw usageError(`${arg} needs a value`);
      (options.codeRepos ??= []).push(value);
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
  // D124: --code-repo points the code review at a repository; a review that turns the step off has no use for it.
  if (options.codeRepos !== undefined && options.codePass === false)
    throw usageError('--code-repo is not used with --no-code-pass');
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
/** The advice the review prints after "Fix:", by its closed failure code (the code's own words name the problem). */
export const REVIEW_FIX_WORDS = Object.freeze({
  session_not_found: 'Give the path of a recording that you can read. Or run sonah sessions --repo DIR and choose a '
    + 'session from its list.',
  output_exists: 'Choose a new --output file name. Sonah never writes over a review that exists.',
  output_folder_missing: 'The folder named in --output does not exist. Create it first, or choose a file in a folder '
    + 'that exists, such as ~/review.html.',
  output_folder_unwritable: 'You cannot write to the folder named in --output. Choose a file in a folder that you own, '
    + 'such as ~/review.html.',
  unsupported_backend: 'Choose --backend claude-cli, codex-cli or anthropic-api.',
  invalid_model: 'Choose an exact model ID. A review on claude-cli needs a full model ID that Sonah can attest, and the '
    + '1M default is best. Run sonah doctor.',
  explicit_api_model_required: 'Add --model with the exact Anthropic model ID that your account supports.',
  anthropic_key_missing: 'Set ANTHROPIC_API_KEY in your terminal or secret manager, then retry.',
  review_in_progress: 'Wait for the other review to finish, then retry. If a review crashed, Sonah takes back its lock '
    + 'by itself.',
  review_state_invalid: 'Check that you own your SONAH_HOME directory and can write to it. Keep the history that is '
    + 'there.',
  review_interrupted: 'Run the same command again to resume. Sonah reuses its stored answers for the same calls.',
  model_unavailable: 'Run sonah doctor to check the reviewer and the context window that you asked for. Then run the '
    + 'same command again.',
  checkpoint_failed: 'Check that you can write to your SONAH_HOME directory. Then run the same command again to resume.',
  github_auth_missing: 'Run gh auth login, or give GH_TOKEN or GITHUB_TOKEN through your terminal or secret manager.',
  publication_disabled: 'Remove --post-comment for a local review. To post the comment, use a GitHub App token that '
    + 'can write reviews and checks. Set SONAH_GITHUB_ACTOR_ID and SONAH_GITHUB_APP_ID, and name a pull request of a '
    + 'private repository.',
  github_unavailable: 'Check that your GitHub token can read the repository and that the pull request exists. Then run '
    + 'the same command again.',
  github_response_invalid: 'Check that --github OWNER/REPO and --pr N name the pull request as GitHub shows it. Then '
    + 'run the same command again.',
  config_invalid: 'Sonah could not read your settings file, so it read and sent nothing. To write the file again, run '
    + 'sonah config code-pass on or sonah config code-pass off. Or add --code-pass or --no-code-pass to this review.',
  // D124: a folder given with --code-repo that is not there, or that no git working tree holds (code-snapshot.js
  // `codeRepoTop`); checked before anything is read or sent.
  code_repo_not_found: 'A folder that you gave with --code-repo does not exist, or is not a folder. Sonah read and sent '
    + 'nothing. Give the folder of the repository that the session changed.',
  code_repo_not_git: 'A folder that you gave with --code-repo is in no git repository. Sonah read and sent nothing. Give '
    + 'the folder of a git repository that the session changed, or any folder in it.',
  state_dir_holds_root: 'The --state-dir that you gave is the folder that the session worked in, or holds it. If '
    + 'Sonah used it, the code review would read what Sonah writes there as part of the change. Sonah read and sent '
    + 'nothing. Choose a --state-dir outside that folder, leave it out to use the folder of Sonah, or add --no-code-pass.',
});
/** What the review prints when it finds no recording for the repository (`claude`, `codex`: the folders it
 *  searched). */
export const NO_SESSION_WORDS = Object.freeze({
  none: 'Sonah found no Claude Code or Codex session for this repository. Run Claude Code or Codex here, or give the '
    + 'path of a recording.',
  searched: (claude, codex) => `Sonah searched ${claude} (the projects folder of Claude Code) and ${codex} `
    + '(the Codex home).',
  elsewhere: 'If your recordings are in another folder, set SONAH_CLAUDE_PROJECTS or CODEX_HOME, or give the path of a '
    + 'recording.',
});
/** The lines that count the stored answers a review used again, with no new call: the session review's and the code
 *  review's. */
export const ANSWER_REUSE_WORDS = Object.freeze({
  session: (reused, total) => `Model answers: ${reused} of ${total} reused (no call).`,
  code: (reused, total) => `Code review answers: ${reused} of ${total} reused (no call).`,
});
/** What the review prints when the system refuses Sonah access to the folder it runs in (`process.cwd()` fails with
 *  EPERM: macOS keeps a terminal without access out of ~/Documents, ~/Desktop and ~/Downloads), and the fix. `refused`
 *  names the folder only when Sonah can tell which folder it is (`shellFolderOf`), else null. */
export const WORKING_FOLDER_WORDS = Object.freeze({
  refused: (folder) => `The system refused Sonah access to ${folder === null ? 'the folder'
    : `${folder}, the folder`} that Sonah runs in.`,
  fix: 'Run sonah from a folder that this terminal can read. Or give this terminal access to the folder in the privacy '
    + 'settings of your system.',
});
/** The advice for any other failure code. */
export const REVIEW_FIX_DEFAULT = 'Run sonah doctor --no-probe, inspect the recording with --dry-run, and choose an '
  + 'output directory you own.';
const fixOf = (code) => (Object.hasOwn(REVIEW_FIX_WORDS, code) ? REVIEW_FIX_WORDS[code] : REVIEW_FIX_DEFAULT);

/** The kind of each of this file's word tables, for the style linter (packages/render/test/style-lint.js). The usage
 *  lines are fragments: each line of the help is read as it stands. */
export const STYLE_KINDS = Object.freeze({
  sessionReviewUsage: 'fragment', REVIEW_FIX_WORDS: 'notice', REVIEW_FIX_DEFAULT: 'notice', NO_SESSION_WORDS: 'notice',
  ANSWER_REUSE_WORDS: 'notice', WORKING_FOLDER_WORDS: 'notice',
  SAVED_COMMENT_WORDS: 'description', 'SAVED_COMMENT_WORDS.target': 'label', 'SAVED_COMMENT_WORDS.noReview': 'fragment',
  'SAVED_COMMENT_WORDS.unreadable': 'fragment',
  RUN_STATE_WORDS: 'fragment', 'RUN_STATE_WORDS.line': 'notice', CODE_STEP_SOURCE_WORDS: 'fragment',
  CODE_STEP_WORDS: 'notice', CODE_PASS_NO_ROOT: 'notice', CODE_STEP_BACKEND_LINE: 'notice', CODE_SNAPSHOT_WORDS: 'notice',
  REPLAY_UNREAD: 'notice', REPLAY_WORDS: 'notice', DRY_RUN_WORDS: 'notice',
});
/** The arguments each function of a word table is rendered with for the style linter. */
export const STYLE_FIXTURES = Object.freeze({
  'SAVED_COMMENT_WORDS.target': [['owner/repo', 7]],
  'NO_SESSION_WORDS.searched': [['/folder/one', '/folder/two']],
  'ANSWER_REUSE_WORDS.session': [[1, 2], [5, 5]], 'ANSWER_REUSE_WORDS.code': [[0, 3], [3, 3]],
  'WORKING_FOLDER_WORDS.refused': [['/folder/project'], [null]],
  'SAVED_COMMENT_WORDS.none': [['PR comment for owner/repo#7', 'this recording has no finished review yet'],
    ['PR comment for owner/repo#7', 'Sonah could not read the last saved review of this recording']],
  'SAVED_COMMENT_WORDS.lead': [['PR comment for owner/repo#7']],
  'RUN_STATE_WORDS.parts.session': [['complete'], ['did not finish']],
  'RUN_STATE_WORDS.parts.code': [['read every file']], 'RUN_STATE_WORDS.parts.codePass': [['covered the whole change']],
  'RUN_STATE_WORDS.how': [['initial']],
  'RUN_STATE_WORDS.line': [['complete', ['session review complete', 'code review covered the whole change'], '']],
  ...Object.fromEntries(['off', 'gated'].map((key) => [`CODE_STEP_WORDS.${key}`, [['the default'],
    ['--code-pass']]])),
  'CODE_STEP_WORDS.noChange': [['the default'], ['--code-pass'], ['the default', false]],
  'CODE_STEP_WORDS.on': [['the default'], ['--code-pass'], ['the default', 1], ['--code-pass', 3], ['the default', 0, false],
    ['the default', 2, false]],
  'CODE_SNAPSHOT_WORDS.head': [[3, 2, 'outside_root ×1'], [1, 1, '']],
  'CODE_SNAPSHOT_WORDS.changedOutside': [[1], [248], [1, true], [248, true]],
  'CODE_SNAPSHOT_WORDS.gitBase': [['0123456789ab', 'merge-base', 2, 1, 1], ['0123456789ab', 'recorded', 1, 0, 0],
    ['0123456789ab', 'reflog', 0, 0, 0, true]],
  'CODE_SNAPSHOT_WORDS.place': [[1, '/work/notes', 1], [16, '/work/notes', 15], [2, '/work/other-repo', 0, '0123456789ab'],
    [1, '/work/other-repo', 1, '0123456789ab']],
  'CODE_SNAPSHOT_WORDS.placeChangedOutside': [[1], [12], [1, true], [12, true]],
  'CODE_SNAPSHOT_WORDS.tailPlaces': [[2, 2], [1, 3], [0, 2], [1, 1, false], [0, 2, false]],
  'CODE_SNAPSHOT_WORDS.folders': [[1, [['/work/notes', 1]]], [5, [['/work/notes', 3], ['/tmp/scratch', 2]]],
    [40, [['/work/notes', 3], ['/tmp/scratch', 2]], 11], [3, [['/work/notes', 2]], 1]],
  'CODE_SNAPSHOT_WORDS.unresolved': [[1], [11]],
  'REPLAY_WORDS.stored': [[4, 5, 1], [5, 5, 0]],
  'REPLAY_WORDS.code': [[1, 'review 34 KB', 'claude-model-x'], [2, 'review 34 KB, repair 2 KB', null]],
  'DRY_RUN_WORDS.session': [[1, 1], [40, 3]], 'DRY_RUN_WORDS.over': [[1], [2]],
  'DRY_RUN_WORDS.recording': [[3, 1, 0], [1, 2, 1]],
  'DRY_RUN_WORDS.knownGaps': [[['actions/incomplete_inventory ×2', 'code/source_clipped']]],
});
/** "Working directory" and "settings" are technical nouns, not verbs in progress. */
export const STYLE_ALLOW = Object.freeze({ ...Object.fromEntries(['CODE_PASS_NO_ROOT', 'CODE_SNAPSHOT_WORDS.gitBase',
  'CODE_SNAPSHOT_WORDS.noBaseHere',
  'CODE_STEP_SOURCE_WORDS.config', 'REPLAY_UNREAD', 'REVIEW_FIX_WORDS.config_invalid', 'WORKING_FOLDER_WORDS.fix']
  .map((key) => [key, ['technical-noun']])),
  // D118 (a): the coverage line names each part by the report's field, as its other parts do ("code pass complete").
  'RUN_STATE_WORDS.codePassNoCode': ['quoted-term'] });

/** What a review writes in its state folder (`--state-dir`, else `session-reviews/<digest>` in Sonah's home), and
 *  nothing else there: the stored session answers, the review's record (and its lock), the code step's stored answers,
 *  and a pull request comment's record (pr-sharing.js). The code step leaves exactly these out of the session's change
 *  and the repository's state, never the state folder whole: `--state-dir .` makes it the working directory. */
export const STATE_FOLDER_ENTRIES = Object.freeze(['answers', 'review', 'code-pass', 'publication']);
const [STATE_ANSWERS, STATE_REVIEW, STATE_CODE_PASS] = STATE_FOLDER_ENTRIES;

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

/** The folder that the shell's PWD names, when it is the folder this process runs in (the same device and inode as
 *  `.`), else null: a line about the folder Sonah runs in names only a folder that Sonah can tell is that one. */
async function shellFolderOf(env) {
  const named = env?.PWD;
  if (typeof named !== 'string' || !isAbsolute(named)) return null;
  try {
    const [here, there] = await Promise.all([stat('.', { bigint: true }), stat(named, { bigint: true })]);
    return here.dev === there.dev && here.ino === there.ino ? named : null;
  } catch { return null; }
}

/** Injectable boundaries are for synthetic tests; the default path uses the product's own loaders,
 * transport, private stores and renderers. Selection and dry planning do not construct a reviewer.
 * D90 (owner decision 2026-10-15, privacy is not a design constraint): the session is loaded as recorded
 * (recorded-session.js), and the report .md or the page is rendered from it as loaded and written as rendered: nothing
 * is masked for a person. The answers and the review kept under SONAH_HOME hold the model's quotes as it read them: they stay on
 * this computer, owner-only (0600 files in 0700 folders). */
export async function runSessionReviewCommand(argv, { stdout = process.stdout, stderr = process.stderr,
  cwd = undefined, env = process.env, discover = discoverSessions, loadSession = loadRecordedSessionWithHash,
  createJudge = createReviewJudge, runSession = reviewSession, loadReviews = loadDecisionReviews,
  signal = null, installSignals = true, openPage = openLocalPage, client = null, confirm = undefined,
  resolveToken = null, readCode = readCodeSnapshot, runCode = reviewCodePass } = {}) {
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
  // The folder the review runs in, first read here. When the system refuses Sonah access to it (EPERM), the review
  // says so in fixed words, with the fix, as a problem Sonah names (exit 2), never as a crash.
  if (cwd === undefined) {
    try { cwd = process.cwd(); }
    catch (error) {
      if (error?.code !== 'EPERM') throw error;
      stderr.write(`${WORKING_FOLDER_WORDS.refused(await shellFolderOf(env))}\nFix: ${WORKING_FOLDER_WORDS.fix}\n`);
      return 2;
    }
  }
  const controller = new AbortController();
  const admission = new AbortController();
  setMaxListeners(REVIEW_SIGNAL_MAX_LISTENERS, controller.signal, admission.signal);
  const stopAdmission = () => admission.abort();
  const abort = () => controller.abort();
  let admissionFailure = null;
  let latestRateLimit = null;
  let budget = null, reviewStarted = false;
  // --code-model: the models the usage line names (the code step's and the session's); none otherwise.
  let usageModels = undefined;
  try {
    budget = createReviewBudget(options);
    setMaxListeners(REVIEW_SIGNAL_MAX_LISTENERS, budget.signal);
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
    // D124: each folder given with --code-repo, as the top folder of the git working tree that holds it
    // (code-snapshot.js `codeRepoTop`), each once, in the order given; a folder that is not there or that no git working
    // tree holds stops the review here, before anything else is read and before any call.
    const codeRepos = [];
    for (const given of options.codeRepos ?? []) {
      const found = await codeRepoTop(resolve(cwd, given));
      if (found.problem) throw failure(found.problem);
      if (!codeRepos.includes(found.top)) codeRepos.push(found.top);
    }
    const output = options.output ? resolve(cwd, options.output) : null;
    // D97: with --format html the Markdown report for your pull request is written beside the page (`mdPathFor`); both
    // are checked before the review.
    const mdTyped = output ? (options.format === 'html' ? mdPathFor(options.output) : options.output) : null;
    const mdOutput = output && options.format === 'html' ? resolve(cwd, mdTyped) : null;
    for (const path of [output, mdOutput].filter(Boolean)) {
      // An existing file is never overwritten; a folder that is not there, or that is not yours to write, is named.
      try { await lstat(path); throw failure('output_exists'); }
      catch (error) {
        if (error?.code === 'ENOTDIR') throw failure('output_folder_missing');
        if (error?.code !== 'ENOENT') throw error;
      }
      try { await access(dirname(path), constants.W_OK); }
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
        const W = NO_SESSION_WORDS;
        stdout.write(`${W.none}\n${W.searched(roots.claude, roots.codex)}\n${W.elsewhere}\n`);
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
    // D87: with the code step on, the change it reviews is read and frozen now, before any call (code-snapshot.js), under
    // the working directory the recording names, with the repository's state; the estimate then adds the step's range.
    // The agentic code step (D90): nothing is withheld for privacy's sake; its agents read the repository with read-only
    // tools, which only the claude-cli backend gives them, so on another backend the step does not run, and says why
    // (`code_step_backend`), before anything is read.
    const digest = createHash('sha256').update(file).digest('hex');
    const sonahHome = env.SONAH_HOME ?? join(home, '.sonah');
    const state = options.stateDir ? resolve(cwd, options.stateDir) : join(sonahHome, 'session-reviews', digest);
    // What Sonah writes (what this review writes in its state folder, by name, and Sonah's home) is no part of the
    // session's change; it and what the coding agents write in their homes while the review runs (the review's own
    // agents and any session of the person's) are never read as the repository changing (code-snapshot.js
    // `readCodeSnapshot`). A place that holds the working directory is never left out, so a state folder that is the
    // working directory or holds it would put Sonah's own writes in the next review's change, and the change of a
    // project folder named like one of its entries out of sight: the code step refuses it, before anything is read.
    if (codeStep.on && backend === 'claude-cli' && typeof loaded.cwd === 'string' && isAbsolute(loaded.cwd)
        && options.stateDir && await placeHolds(state, loaded.cwd)) throw failure('state_dir_holds_root');
    const snapshot = !codeStep.on ? null : backend === 'claude-cli' ? await readCode(session, { root: loaded.cwd ?? null,
      maxBytes: bound, recording: file, own: [...STATE_FOLDER_ENTRIES.map((entry) => join(resolve(state), entry)),
        resolve(sonahHome)],
      harnessHomes: harnessHomePlaces({ env, home }), ...(codeRepos.length ? { codeRepos } : {}) })
      : CODE_STEP_BACKEND_SNAPSHOT;
    const estimateOf = (plan, dryRun = false) => estimateLine({
      requestBytes: plan.requests.map(sizeOf).filter((bytes) => bytes <= bound),
      lanes: options.concurrency ?? reviewSpeedProfile(options.profile).windowConcurrency, dryRun,
      ...(codeStepAsks(snapshot) ? { extra: CODE_STEP_ESTIMATE_MINUTES } : {}) });
    if (options.dryRun) {
      if (!['claude-cli', 'codex-cli', 'anthropic-api'].includes(backend)) throw failure('unsupported_backend');
      const plan = planWindowRequests({ session, reviewScope: 'session-only', backend, speedProfile: options.profile });
      const over = plan.requests.filter((planned) => sizeOf(planned) > bound).length;
      for (const line of dryRunLines({ events: session.events.length, windows: plan.windows.length, over }))
        stdout.write(`${line}\n`);
      stdout.write(`${estimateOf(plan, true)}\n`);
      stdout.write(`${codeStepLine(codeStep, snapshot)}\n`);
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
            concurrency: options.concurrency, answerCache: createAnswerCache(join(state, STATE_ANSWERS),
              { ...config, readOnly: true }) });
        } catch { replay = null; }
        for (const line of replay ? replayLines({ ...replay, codeModel }) : [REPLAY_UNREAD]) stdout.write(`${line}\n`);
      }
      if (options.postComment)
        for (const line of await savedCommentLines(state, options)) stdout.write(`${line}\n`);
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
    stdout.write(`${codeStepLine(codeStep, snapshot)}\n`);
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
    // The agentic code step (D90): every code-step call (the review agent, its repair, its checking agents and their
    // re-asks) goes to a transport of its own — an agent-capable one — on the code model (--code-model) or, with none,
    // on the session's model, counted in the same budget (its share tallied apart) and stopped by the same signals.
    const stepConfig = codeConfig ?? config;
    const codeJudge = snapshot ? admitted(budget.wrap(createJudge({ config: stepConfig, env,
      timeoutMs: options.timeoutMs ?? 20 * 60_000, signal: controller.signal, onResult: onResultOf(CODE_STEP_PART) }),
    CODE_STEP_PART), selectedContextWindow(stepConfig.model)) : judge;
    if (signal?.aborted) controller.abort();
    signal?.addEventListener('abort', abort, { once: true });
    if (installSignals) { process.on('SIGINT', abort); process.on('SIGTERM', abort); }
    let result;
    try {
      result = await runSession({ session, judge, backend, model: config.model,
        answerCache: createAnswerCache(join(state, STATE_ANSWERS), config),
        store: createSessionReviewStore(join(state, STATE_REVIEW)),
        speedProfile: options.profile, concurrency: options.concurrency, signal: admission.signal,
        rateLimitTally: () => latestRateLimit, census: loaded.census ?? null,
        onWindowRecord: (event) => stderr.write(`Review window ${event.window}/${event.of} finished\n`) });
    } finally {
      signal?.removeEventListener('abort', abort);
      if (installSignals) { process.off('SIGINT', abort); process.off('SIGTERM', abort); }
    }
    let { report } = result;
    // D87: the code pass, after the session's review and on its report; its own stored answers (`code-pass/answers`).
    if (snapshot) {
      if (!snapshot.root) stdout.write(`${snapshot.gate ? CODE_STEP_BACKEND_LINE : CODE_PASS_NO_ROOT}\n`);
      // --code-model: the code step's stored answers are keyed by its own model (answer-cache.js `answerKey` binds the
      // model and the argv), so an answer one model gave is never replayed for another; and by the repository's state
      // (`repoState`), so an answer an agent gave from the repository is replayed only while it is unchanged.
      // The release review (owner, 2026-10-14): only --code-pass on the command line makes the code step's coverage
      // decide the exit code; on by default or by the setting, its coverage is shown and the session review decides.
      ({ report } = await runCode({ session, report, snapshot, judge: codeJudge, backend, speedProfile: options.profile,
        required: codeStep.source === 'flag' && codeStep.on === true,
        signal: admission.signal, answerCache: createAnswerCache(join(state, STATE_CODE_PASS, 'answers'),
          { ...(codeConfig ?? config), repoState: snapshot.repoState ?? null }),
        store: createSessionReviewStore(join(state, STATE_REVIEW)),
        ...(codeConfig ? { model: codeConfig.model } : {}) }));
    }
    // D97: the repository's facts for the report's code links (local git only, from the code step's snapshot), and
    // the count line in place of the attention lines. D118 (a): the folder the code step looked in (its snapshot's, or
    // the working directory the recording names when it could read none), which the first screen names when no code
    // was reviewed.
    const facts = snapshot ? await readRepoFacts({ snapshot, codePass: report.codePass })
      : { repo: null, github: undefined };
    const folder = snapshot?.root === true && typeof snapshot.dir === 'string' ? snapshot.dir : loaded.cwd ?? null;
    const linkFacts = { repo: facts.repo, ...(facts.github !== undefined ? { github: facts.github } : {}),
      sonahVersion: await sonahVersionOf(), ...(folder ? { folder } : {}) };
    const reportView = reportModel(session, report, linkFacts);
    stdout.write(`${runStateLine(report)}\n`);
    // D118 (a): no code reviewed, said on the terminal's first screen as the page and the report say it.
    if (reportView.header.noCode) stdout.write(`${noCodeText(reportView.header.noCode)}\n`);
    for (const line of [coverageSummaryLine(report), notCoveredLine(report), windowCompletionLine(report.instrument?.windowCompletion)])
      if (line) stdout.write(`${line}\n`);
    for (const line of countLines(reportView)) stdout.write(`${line}\n`);
    const answers = report.instrument?.answers;
    if (answers) stdout.write(`${ANSWER_REUSE_WORDS.session(answers.reused, answers.calls + answers.reused)}\n`);
    const codeAnswers = report.codePass?.answers;
    if (codeAnswers)
      stdout.write(`${ANSWER_REUSE_WORDS.code(codeAnswers.reused, codeAnswers.calls + codeAnswers.reused)}\n`);
    // D97: the Markdown report for your pull request always; with --format html the page too, the report beside it.
    // R2: the report says the page holds every part only when this run writes the page and the page kept every part.
    const page = options.format === 'html' ? sessionPage(session, report, { sessionHash: hash, ...linkFacts,
      decisionReviews: answersFor(hash, await loadReviews().catch(() => new Map())) }) : null;
    // D118 (a), amended (the owner, 2026-10-19: "yes, folder name only"): the report .md names that folder by its name
    // alone, and the home folder itself as `~` (render report-model.js `folderNameOf`), by the home as the environment
    // gives it and as the disk resolves it; the page and the terminal name the path.
    const homes = [home, await realpath(home).catch(() => null)].filter((spelling) => typeof spelling === 'string');
    const md = renderReportMarkdown(session, report, { ...linkFacts, homes, page: page ? { whole: page.whole } : null });
    if (page) {
      await writeFile(output, page.html, { mode: 0o600, flag: 'wx' });
      await writeFile(mdOutput, md, { mode: 0o600, flag: 'wx' });
      await presentLocalPage(output, { stdout, stderr, noOpen: options.noOpen, openPage });
    } else if (output) await writeFile(output, md, { mode: 0o600, flag: 'wx' });
    else stdout.write(md);
    if (output) {
      const inRepository = snapshot ? await outputsInRepository({ snapshot, paths: [output, mdOutput].filter(Boolean) })
        : false;
      for (const line of reportOutputLines({ md: { path: mdTyped, bytes: Buffer.byteLength(md, 'utf8') }, repo: facts.repo,
        github: facts.github, files: linkedFiles(report.codePass), inRepository })) stdout.write(`${line}\n`);
    }
    if (options.postComment) {
      const [owner, repo] = options.github.split('/');
      const sharing = await (await import('./pr-sharing.js')).sharePrReview({ client,
        github: { owner, repo, number: options.number }, report, stateDir: state, env, stdout, stderr, confirm });
      if (sharing?.exitCode) return sharing.exitCode;
    }
    return reviewExitCode(report);
  } catch (error) {
    const allowed = [...CLI_SAFE_ERROR_CODES, ...JUDGE_FAILURE_CODES, ...RUN_FAILURE_CODES, ...GITHUB_ERROR_CODES];
    const code = admissionFailure ?? (error?.code === 'EEXIST' ? 'output_exists'
      : allowed.includes(error?.code) ? error.code : 'review_failed');
    stderr.write(`Review could not complete: ${code}.\nFix: ${fixOf(code)}\n`);
    const toolFailure = ['review_failed', 'model_unavailable'];
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
 * D82 step 10: what a dry run with --post-comment shows — the comment this recording's last finished review would
 * post (`publicCommentText`: counts and fixed words only), read from the review's saved report, with nothing read from
 * GitHub and nothing posted. Fixed sentences when there is no such review or it cannot be read.
 */
/** The words of a dry run's PR comment lines (`savedCommentLines`). */
export const SAVED_COMMENT_WORDS = Object.freeze({
  target: (github, number) => `PR comment for ${github}#${number}`,
  after: 'A review without --dry-run shows the comment again and posts it only when you confirm it.',
  none: (target, why) => `${target}: ${why}. There is no comment to show.`,
  noReview: 'this recording has no finished review yet',
  unreadable: 'Sonah could not read the last saved review of this recording',
  lead: (target) => `${target}, as the last finished review of this recording would post it (a dry run reads nothing `
    + 'from GitHub and posts nothing):',
});
async function savedCommentLines(state, { github, number }) {
  const W = SAVED_COMMENT_WORDS;
  const target = W.target(github, number);
  let report = null;
  try {
    const parsed = strictJson(await readFile(join(state, STATE_REVIEW, 'report.private.json'), 'utf8'));
    report = parsed.json && parsed.strict ? parsed.value : null;
  } catch { report = null; }
  const none = (why) => [`${W.none(target, why)} ${W.after}`];
  if (report === null) return none(W.noReview);
  let text;
  try {
    text = (await import('../../github/index.js')).publicCommentText(report).summary;
  }
  catch { return none(W.unreadable); }
  return [W.lead(target), text, W.after];
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
  code: Object.freeze({ complete: 'read every file', partial: 'did not read every file', missing: 'did not run' }),
  session: Object.freeze({ complete: 'complete', incomplete: 'did not finish' }),
  codePass: Object.freeze({ complete: 'covered the whole change', partial: 'did not cover all of the change and its checks',
    missing: 'did not run', incomplete: 'did not finish',
    // D105: a review request too large to send was never sent, so no call started, as the page says.
    tooLarge: 'did not run, because its input was too large to send',
    // D100 (the audit of absence sentences): what Sonah found, never that the session changed no file. D113's review: a
    // change with no file to review, said by why as the page says it (evidence code-report.js `codeNoChangeOf`): no
    // recorded write that could have changed a file (`noWrite`); writes, none in the change, beside files that changed
    // outside them (`noWrittenChange`); else no changed file (`noFile`).
    noFile: 'had no change to review, because Sonah found no changed file here',
    noWrite: 'had no change to review, because the recording shows no write of the session that could have changed a '
      + 'file',
    noWrittenChange: 'had no change to review, because Sonah found no changed file here that the session wrote',
    // D123 (the beta.5 end-to-end smoke): no recorded write, but the session ran shell commands (`noSeenWrite`), whose
    // writes Sonah does not yet see: never that the session wrote nothing.
    noSeenWrite: 'had no change to review, because Sonah found no write of the session that it can read, and the '
      + 'session ran shell commands, whose writes Sonah does not yet see',
    backend: 'did not run, because it runs only on the claude-cli backend',
    // F3b (D111's second review): short of complete only by the items that its item-by-item check did not examine in a
    // way that Sonah could use (evidence code-report.js `codeReviewCoverage`): every call can have answered, and a
    // published finding can follow from such an item, so never "did not cover". The items are the ones the code step's
    // line names before the review (`CODE_STEP_WORDS.on`).
    unaccounted: 'covered the whole change, but its item-by-item check did not examine every item in a way that Sonah '
      + 'could use' }),
  // The release review: after a code pass short of complete that the person did not require on the command line.
  codePassApart: ', which does not change the exit code (add --code-pass to make it count)',
  // The line's parts: the session review, a pull request's code review (an earlier route), and the code step.
  parts: Object.freeze({ session: (words) => `session review ${words}`, code: (words) => `pull request review ${words}`,
    codePass: (words) => `code review ${words}` }),
  how: (mode) => ` ${mode} review.`,
  line: (state, parts, how) => `Sonah's review: ${state} (${parts.join(', ')}).${how}`,
  // D118 (a), the owner's go of 2026-10-18 (the dogfood's DF2): a status word never says "complete" without naming
  // what is missing. A review that ran to the end and reviewed no code (evidence code-report.js `codeNotReviewedOf`).
  completeNoCode: 'complete, but no code was reviewed',
  // The coverage line's part for a code pass whose own coverage is complete and that reviewed no code.
  codePassNoCode: 'code pass reviewed no code',
});

/** D71 (a): the first line the review command prints — whether Sonah's own review ran, and of what. Counts and fixed
 *  words only; no status, finding or session text. */
export function runStateLine(report, mode) {
  const state = reviewRunState(report);
  let honest = null;
  try { honest = honestStatuses({ ...report, findings: Array.isArray(report?.findings) ? report.findings : [] }); }
  catch { honest = null; }
  const session = RUN_STATE_WORDS.session[honest?.sessionReview === 'complete' ? 'complete' : 'incomplete'];
  const parts = [RUN_STATE_WORDS.parts.session(session)];
  if (honest?.reviewScope !== 'session-only') {
    const code = Object.hasOwn(RUN_STATE_WORDS.code, report?.codeCoverage) ? report.codeCoverage : 'missing';
    parts.unshift(RUN_STATE_WORDS.parts.code(RUN_STATE_WORDS.code[code]));
  }
  if (report?.codePass !== undefined) {
    // D87 review: a pass that ran over a session which changed or read no file read "every file it showed" — true, and
    // reassuring; it says there was none. D113's review: a change with no file to review as the page counts it (a
    // change that holds only writes outside the folders the code review can read among them), said by why, as the page
    // says it (evidence code-report.js `codeNoChangeOf`).
    const none = codeNoChangeOf(report.codePass);
    const coverage = ['complete', 'partial', 'missing'].includes(report.codePass?.coverage)
      ? report.codePass.coverage : 'missing';
    // The second release review (low): a pass that ran and has no complete answer is one that did not complete, as the
    // page and the story say (`ran`), never one that was not run.
    const gated = Array.isArray(report.codePass?.gaps) && report.codePass.gaps.some((g) => g?.code === CODE_STEP_BACKEND_GAP);
    // D105: a review request too large to send was not sent: the review did not run, never "did not finish".
    const unsent = report.codePass?.manifest?.review?.sent === false;
    // F3b (D111's second review): a coverage short of complete only by the accounting is said as that, never as a review
    // that did not cover the change and its checks (`codeReviewCoverage`).
    const pass = gated ? 'backend' : none !== null ? none : unsent && coverage === 'missing' ? 'tooLarge'
      : coverage === 'missing' && report.codePass?.ran === true ? 'incomplete'
        : coverage === 'partial' && codeReviewCoverage(report.codePass) === 'complete' ? 'unaccounted' : coverage;
    // The release review (owner, 2026-10-14): a code step that ran by default or by the setting, short of complete, is
    // said plainly, with why the review still reads complete (only --code-pass makes its coverage count).
    const apart = report.codePass?.required === false && pass !== 'complete' && !CODE_NO_CHANGE_KEYS.includes(pass);
    parts.push(RUN_STATE_WORDS.parts.codePass(`${RUN_STATE_WORDS.codePass[pass]}${apart ? RUN_STATE_WORDS.codePassApart
      : ''}`));
  }
  const how = ['initial', 'incremental', 'cached'].includes(mode) ? RUN_STATE_WORDS.how(mode) : '';
  // D118 (a): "complete" names what is missing when no code was reviewed: a session review with no code pass record, or a
  // code pass that reviewed none. A combined pull request review (an earlier route) is said by its own part above.
  // D122: one definition with the report model and the PR comment (`reportNotReviewedOf`).
  const noCode = reportNotReviewedOf(report) !== null;
  return RUN_STATE_WORDS.line(state === 'complete' && noCode ? RUN_STATE_WORDS.completeNoCode : RUN_STATE_WORDS[state],
    parts, how);
}

/** This Sonah's version, for the report's footer: the build's own when it carries one, else the package's; null when
 *  neither can be read. */
async function sonahVersionOf() {
  if (typeof SONAH_VERSION === 'string') return SONAH_VERSION;
  try { return JSON.parse(await readFile(new URL('../../../package.json', import.meta.url), 'utf8')).version ?? null; }
  catch { return null; }
}
/** The change's files whose commit Sonah can tell (D97): in the repository, with a hash, or deleted. */
const linkedFiles = (codePass) => (Array.isArray(codePass?.files) ? codePass.files : []).filter((f) => f && typeof f === 'object'
  && typeof f.path === 'string' && !CODE_OUTSIDE_STATES.includes(f.state) && (typeof f.sha256 === 'string' || f.type === 'deleted'
  || f.state === 'deleted')).map((f) => f.path);

/**
 * Every declared cause of what the review could not cover, with its count, in the renderer's code-owned sentences —
 * fixed words and integers only, never a gap note, path or quote. D71 (a): shown whenever the coverage is short of
 * complete (before D71, only beside a NO_FINDINGS status); null when it is complete. The PR comment's line, in its
 * words (github/publication.js PUBLICATION_WORDS).
 */
export function notCoveredLine(report) {
  if (report?.coverage === 'complete' && report?.codeCoverage !== 'partial') return null;
  let causes = [];
  try { causes = coverageCauses(report); } catch { causes = []; }
  if (causes.length)
    return PUBLICATION_WORDS.notCovered(causes.map(([cause, counts]) => COVERAGE_SENTENCE[cause](counts)));
  return report?.coverage === 'partial' ? PUBLICATION_WORDS.noCause : null;
}

/** A counts-only CLI summary. Every printed word is fixed here, and every printed value is a
 * closed coverage state or a validated count; recording paths, gap notes and model text stay out. */
export function coverageSummaryLine(report) {
  const states = new Set(['complete', 'partial', 'missing']);
  const isCount = (n) => Number.isSafeInteger(n) && n >= 0;
  const parts = [];
  // D123 (the beta.5 end-to-end smoke): the pull request's own code review (`codeCoverage`, an earlier route) is a part
  // only where `runStateLine` names it: a review whose effective scope is not session-only. A session review has no
  // such review, so "code missing" beside "code pass complete" said that its code review was missing.
  let honest = null;
  try { honest = honestStatuses({ ...report, findings: Array.isArray(report?.findings) ? report.findings : [] }); }
  catch { honest = null; }
  if (honest?.reviewScope !== 'session-only' && states.has(report?.codeCoverage))
    parts.push(`code ${report.codeCoverage}`);
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

  // D87: the code pass's own coverage, when it ran (`report.codePass`). D118 (a): never "complete" for a code pass that
  // reviewed no code (evidence code-report.js `codeNotReviewedOf`).
  if (states.has(report?.codePass?.coverage)) parts.push(report.codePass.coverage === 'complete'
    && reportNotReviewedOf(report) !== null ? RUN_STATE_WORDS.codePassNoCode : `code pass ${report.codePass.coverage}`);

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

/** The agentic code step (D90): the snapshot a review on another backend than claude-cli gets — no root, and the gate
 *  that says why the step does not run (`code_step_backend`, ledger.js GAP_CODES). Nothing is read. */
export const CODE_STEP_BACKEND_SNAPSHOT = Object.freeze({ root: false, gate: CODE_STEP_BACKEND_GAP, plan: Object.freeze([]),
  files: Object.freeze([]) });
/** Whether the code step reads a repository in this review (on, on claude-cli, with a working directory here). */
const codeStepReads = (snapshot) => snapshot?.root === true;
const [RECORDED_DIFF, UNRECORDED_DIFF, BASE_UNKNOWN_DIFF] = CODE_DIFF_STATES;
/** Whether the snapshot holds a change the review agent is sent (a path whose hunks can be shown): else no call. */
const codeStepAsks = (snapshot) => codeStepReads(snapshot) && (Array.isArray(snapshot.files) ? snapshot.files : [])
  .some((file) => [RECORDED_DIFF, UNRECORDED_DIFF, BASE_UNKNOWN_DIFF].includes(file?.diff));

/**
 * Owner decision 2026-10-14: the line beside the time estimate (and in a dry run) that says whether the code step runs in
 * this review, why (the flag, the setting or the default), and what it does: the agentic code step (D90) adds one review
 * agent with read-only access to the whole repository and one checking agent per finding it gives (and one for its
 * questions), and (F3b, D111) one accounting agent per batch of the items in scope, at most CODE_ACCOUNT_LIMITS.calls;
 * with no change to review (or no working directory here) it adds no call; on another
 * backend than claude-cli it does not run. Fixed words only.
 */
/** F3b (D111): the items the accounting's calls are counted by, the kinds of ledger.js CODE_ACCOUNT_SCOPE in its order,
 *  as the code step's line and the dry run's say them. D111 amended (2026-10-18): every ask of the session review, an ask
 *  an agent wrote into a helper's brief among them (CODE_ACCOUNT_ASK_SOURCES), so never "your asks". */
const ACCOUNT_ITEMS_WORDS = 'The items are asks, statements that the agent wrote into a file and the agent\'s decisions '
  + 'not to act.';
/** The words of the code step's line (`codeStepLine`), by whether it runs; `why` is CODE_STEP_SOURCE_WORDS. */
export const CODE_STEP_WORDS = Object.freeze({
  off: (why) => `Code review: off (${why}). Sonah reviews only the session, and reads or sends no file. Turn it on `
    + 'with --code-pass, or for every review with sonah config code-pass on.',
  turnOff: 'Turn it off with --no-code-pass, or for every review with sonah config code-pass off.',
  gated: (why) => `Code review: on (${why}), but it did not run. It runs only on the claude-cli backend, whose reviewer `
    + 'can read the repository.',
  // D117's review: `repository` false when no git repository holds the working directory (the agents read it whole).
  noChange: (why, repository = true) => `Code review: on (${why}). It reviews the change with read-only access to the `
    + `whole ${repository ? 'repository' : 'working directory'}. It found no change to review here, so it adds no call.`,
  // F3b (D111): and the accounting's calls, one per batch of its items in scope (ledger.js CODE_ACCOUNT_SCOPE, named by
  // those kinds alone), at most CODE_ACCOUNT_LIMITS.calls. D117's review: and the `folders` other folders of the change
  // that its agents read beside the repository (code-snapshot.js `agentFolders`, the top folder not counted).
  on: (why, folders = 0, repository = true) => `Code review: on (${why}). It reviews the change with read-only access to `
    + `the whole ${repository ? 'repository' : 'working directory'} (Read, Grep, Glob).${folders > 0 ? ` It also reads ${
      folders === 1 ? 'one other folder that holds' : `${folders} other folders that hold`} files of the change.` : ''} `
    + 'It adds one review call, and one check call for each finding. It adds one more call for each '
    + `${CODE_ACCOUNT_LIMITS.keys} items, at most ${CODE_ACCOUNT_LIMITS.calls}. ${ACCOUNT_ITEMS_WORDS}`,
});
export function codeStepLine({ on, source } = {}, snapshot = null) {
  const words = CODE_STEP_SOURCE_WORDS[source] ?? CODE_STEP_SOURCE_WORDS.default;
  const why = typeof words === 'string' ? words : words[on ? 'on' : 'off'];
  const W = CODE_STEP_WORDS;
  if (on !== true) return W.off(why);
  if (typeof snapshot?.gate === 'string') return `${W.gated(why)} ${W.turnOff}`;
  // D117's review: whether a git repository holds the working directory (a snapshot made by hand with no such fact: as
  // before), and the folders the agents read beside the repository's top folder.
  const repository = snapshot?.root !== true || snapshot.repository !== false;
  // D117 amended (the owner: "the page says plainly that edits made by helper agents or by scripts after cd are not seen
  // yet"): the page's one fixed sentence, when the session ran a shell command or delegated work (code-pass.js
  // `mayMissEdits`, read by the snapshot).
  const unseen = snapshot?.root === true && snapshot.unseenEdits === true ? ` ${CODE_REPORT_WORDS.unseenEdits}` : '';
  if (snapshot !== null && !codeStepAsks(snapshot)) return `${W.noChange(why, repository)}${unseen} ${W.turnOff}`;
  const folders = snapshot?.root === true && Array.isArray(snapshot.folders) ? snapshot.folders
    .filter((folder) => typeof folder === 'string' && folder !== snapshot.top).length : 0;
  return `${W.on(why, folders, repository)}${unseen} ${W.turnOff}`;
}

/** D87: what the CLI says when the code step has no working directory to read the session's files under. */
export const CODE_PASS_NO_ROOT = 'Code review: did not run. Sonah could not read a working directory of the session here, '
  + 'so it read no file.';
/** The agentic code step: what the CLI says when the review's backend cannot run it. */
export const CODE_STEP_BACKEND_LINE = 'Code review: did not run. It runs only on the claude-cli backend, whose reviewer '
  + 'can read the repository. Sonah read nothing.';

const [GIT_BASE] = CODE_DIFF_BASES;
/** The dry run's line about the code pass: how many paths the change under review holds (D113: the paths the session's
 *  recorded writes could have changed), how many can be read now, the others by their closed state, where the diff
 *  starts, and how many paths differ from it that no recorded write of the session touched (left out of the change).
 *  Counts, closed words and the start commit's short id only. */
/** The words of the dry run's line about the code step's change (`codeSnapshotLine`). */
export const CODE_SNAPSHOT_WORDS = Object.freeze({
  // D113 (code-snapshot/13): the change holds only the paths that a recorded write of the session could have changed,
  // or whose last change came while the session ran.
  head: (n, readable, others) => `Code review: the change holds ${n} ${n === 1 ? 'path' : 'paths'} that a recorded `
    + `write could have changed or that changed during the session. Sonah can read ${readable} of them now${others
      ? ` (not readable: ${others})` : ''}.`,
  // D117: with another repository or folder of the change (`here`), the sentence speaks of the working directory's
  // repository alone; each other place has its own (`place`).
  gitBase: (commit, how, differ, unrecorded, outside, here = false) => ` ${here ? 'In the repository of the working '
    + 'directory, the change' : 'The change'} runs from the start commit ${commit} of the `
    + `session (${how}). ${differ} ${differ === 1 ? 'path differs' : 'paths differ'}${unrecorded ? `, and Sonah found no `
      + `recorded edit that wrote ${unrecorded} of them` : ''}.${outside ? ` Sonah counts ${outside} more outside the `
      + 'working directory.' : ''}`,
  // D113: the paths that differ from the start commit that no recorded write of the session touched and that did not
  // last change during the session, counted. D113 amended (2026-10-18; the owner: "tag it by outside the evaluated
  // session"): tagged in those fixed words; `given`, whether the code review is given them after the change (the change
  // holds a file to review: `codeStepAsks`). Its review: read before the request is planned, so said only as far as the
  // request's bound leaves them room (their block gives way first, code-pass.js CODE_OUTSIDE_YIELD).
  changedOutside: (n, given = false) => ` ${n} more ${n === 1 ? 'path' : 'paths'} changed outside this session's `
    + `recorded writes, so ${n === 1 ? 'it is' : 'they are'} outside the evaluated session. Sonah leaves `
    + `${n === 1 ? 'it' : 'them'} out of the change.${given ? ' If there is room in the code review\'s input, Sonah gives '
      + `${n === 1 ? 'it' : 'them'} to the code review apart from the change.` : ''}`,
  // D100: git can fail to say for any reason: said as what Sonah could not read.
  noBase: ' Sonah could not read from git where the session started, so the change is the edits that the session '
    + 'recorded.',
  // D117: `noBase`, with another repository or folder of the change.
  noBaseHere: ' In the working directory, Sonah could not read from git where the session started. The change there is '
    + 'the edits that the session recorded.',
  tail: ' The code review can read any file of the repository.',
  // D117's review: `tail`, when no git repository holds the working directory.
  tailFolder: ' The code review can read any file of the working directory.',
  // D117: each other repository or folder the session wrote to, in the places' order: how many of the change's paths lie
  // there, where its change runs from (its base commit, or the recorded edits), and how many files of the change it holds.
  place: (n, at, differ, commit = null) => ` ${n} of the paths ${n === 1 ? 'lies' : 'lie'} in ${at}${commit
    ? `, a git repository whose change runs from its commit ${commit}` : ', whose change is the edits that the session '
      + 'recorded'}. The change holds ${differ} ${differ === 1 ? 'file' : 'files'} there.`,
  // D117: the paths of another git repository that differ from its base that no recorded write of the session touched
  // and that did not last change during the session, counted (as `changedOutside`, in its words: D113 amended, outside
  // the evaluated session, and `given` as there).
  placeChangedOutside: (n, given = false) => ` ${n} more ${n === 1 ? 'path' : 'paths'} changed there outside this `
    + `session's recorded writes, so ${n === 1 ? 'it is' : 'they are'} outside the evaluated session. Sonah leaves `
    + `${n === 1 ? 'it' : 'them'} out of the change.${given ? ' If there is room in the code review\'s input, Sonah gives '
      + `${n === 1 ? 'it' : 'them'} to the code review apart from the change.` : ''}`,
  // D117 amended (the owner, 2026-10-18: "files outside any repository are listed, not reviewed"): the folders in no git
  // repository that the session wrote to, with how many of its paths lie in each (at most
  // CODE_REPORT_LIMITS.changedOutsideNames by name), and how many more folders.
  folders: (n, entries, more = 0) => ` ${n} of the paths ${n === 1 ? 'lies' : 'lie'} in ${entries.length + more === 1
    ? 'a folder' : `${entries.length + more} folders`} that no git repository holds. Sonah lists ${n === 1 ? 'it'
    : 'them'} and does not review ${n === 1 ? 'it' : 'them'}: ${entries
      .map(([at, k]) => `${at} (${k})`).join(', ')}${more ? `, and ${more} more ${more === 1 ? 'folder' : 'folders'}` : ''}.`,
  // D117 amended (the owner: "paths that hold an unexpanded $VARIABLE are never counted"): the writes whose path holds an
  // unexpanded shell variable or command substitution, counted apart.
  unresolved: (n) => ` ${n} more ${n === 1 ? 'write names a path' : 'writes name paths'} with an unexpanded shell variable `
    + `or command substitution. Sonah cannot tell which ${n === 1 ? 'file it' : 'files they'} wrote, so it counts `
    + `${n === 1 ? 'it' : 'them'} apart and does not review ${n === 1 ? 'it' : 'them'}.`,
  // D117: the folders the code review reads beside the repository (code-snapshot.js `agentFolders`): `read` of the `all`
  // places named (its review: a place in the working directory is read there). `repository` false: no git repository
  // holds the working directory.
  tailPlaces: (read, all, repository = true) => {
    const what = repository ? 'the repository' : 'the working directory';
    return read === all ? ` The code review can read any file of ${what} and of those folders.`
      : ` The code review can read any file of ${what}, and of ${read === 0 ? 'none' : read} of those folders.`;
  },
});
export function codeSnapshotLine(snapshot) {
  if (typeof snapshot?.gate === 'string') return CODE_STEP_BACKEND_LINE;
  if (snapshot?.root !== true) return CODE_PASS_NO_ROOT;
  const W = CODE_SNAPSHOT_WORDS;
  const files = Array.isArray(snapshot.files) ? snapshot.files : [];
  const readable = files.filter((file) => typeof file?.text === 'string').length;
  const others = CODE_FILE_STATES.map((state) => [state, files.filter((file) => file?.state === state).length])
    .filter(([, n]) => n > 0).map(([state, n]) => `${state} ×${n}`);
  // D117: the working directory's repository's files (no `place`), then each other place's.
  const placed = placesOf(snapshot.base);
  const here = placed.length > 0;
  const differing = files.filter((file) => typeof file?.diff === 'string' && typeof file?.place !== 'string');
  const unrecorded = differing.filter((file) => file.diff === UNRECORDED_DIFF).length;
  const commit = typeof snapshot.base?.commit === 'string' ? snapshot.base.commit.slice(0, 12) : null;
  const outside = Number.isSafeInteger(snapshot.base?.outside) && snapshot.base.outside > 0 ? snapshot.base.outside : 0;
  const elsewhere = Array.isArray(snapshot.base?.changedOutside) ? snapshot.base.changedOutside.length : 0;
  const base = snapshot.base?.kind === GIT_BASE && commit
    ? `${W.gitBase(commit, snapshot.base.how, differing.length, unrecorded, outside, here)}${elsewhere
      ? W.changedOutside(elsewhere, codeStepAsks(snapshot)) : ''}` : here ? W.noBaseHere : W.noBase;
  // D124's review: the working folder's own repository given with --code-repo, read by its own rule, as the page says it.
  const givenHere = snapshot.base?.given === true ? ` ${CODE_REPORT_WORDS.givenHere}` : '';
  // D117: the paths of each other place, by where its change runs from, and what changed there outside the session
  // (D113 amended: outside the evaluated session, given to the code review as the working directory's are).
  const places = placed.map((p) => {
    const mine = files.filter((file) => file?.place === p.at);
    return `${W.place(mine.length, p.at, mine.filter((file) => typeof file?.diff === 'string').length,
      p.kind === GIT_BASE && typeof p.commit === 'string' ? p.commit.slice(0, 12) : null)}${Array.isArray(p.changedOutside)
      && p.changedOutside.length ? W.placeChangedOutside(p.changedOutside.length, codeStepAsks(snapshot)) : ''}`;
  }).join('');
  // The places the code review reads (code-pass.js `agentsRead`): each one that lies in the working directory, or in a
  // folder its agents read beside it (code-snapshot.js `agentFolders`), as the review's where block says them.
  const where = { root: snapshot.dir, realRoot: snapshot.realRoot, top: snapshot.top !== snapshot.realRoot
    ? snapshot.top : null, folders: Array.isArray(snapshot.folders) ? snapshot.folders : null };
  const read = placed.filter((p) => agentsRead(where, p.at)).length;
  const repository = snapshot.repository !== false;
  // D117 amended: the folders in no repository the session wrote to, listed, and the writes not resolved, counted.
  const folders = foldersOf(snapshot.base);
  const listed = folders.slice(0, CODE_REPORT_LIMITS.changedOutsideNames);
  const writes = `${folders.length ? W.folders(folders.reduce((n, f) => n + f.written, 0), listed.map((f) => [f.at,
    f.written]), folders.length - listed.length) : ''}${unresolvedOf(snapshot.base) > 0
    ? W.unresolved(unresolvedOf(snapshot.base)) : ''}`;
  // D122 (a review low of D117): the tail follows the places it counts ("those folders"), and the folders that no
  // repository holds and the writes not resolved, which the code review does not read, come after it.
  return `${W.head(files.length, readable, others.join(', '))}${base}${givenHere}${places}${here
    ? W.tailPlaces(read, placed.length, repository) : repository ? W.tail : W.tailFolder}${writes}`;
}

/** What the dry run says when the stored answers could not be counted (the reviewer's settings could not be read). */
export const REPLAY_UNREAD = 'Stored session answers: not counted, because Sonah could not read the settings of the '
  + 'reviewer. Sonah sent nothing.';
/** The words of the reuse dry run's lines (`replayLines`). */
export const REPLAY_WORDS = Object.freeze({
  stored: (reused, total, missing) => `Stored session answers: the store answers ${reused} of ${total} session calls, `
    + `with no new call.${missing ? ` A review would make at least ${missing} new ${missing === 1 ? 'call' : 'calls'}.`
      : ''}`,
  // F3b (D111): and the accounting's calls, one per batch of its items in scope (ledger.js CODE_ACCOUNT_SCOPE, named by
  // those kinds alone), at most CODE_ACCOUNT_LIMITS.calls.
  code: (n, list, model) => `Code review: it would first send ${n} ${n === 1 ? 'call' : 'calls'} (${list})${model
    ? ` to ${model}` : ''}. Then it would send one check for each finding and one for its questions. Each `
    + `${CODE_ACCOUNT_LIMITS.keys} items would add one more call, at most ${CODE_ACCOUNT_LIMITS.calls}. `
    + ACCOUNT_ITEMS_WORDS,
  noCode: 'Code review: it would send no call, because Sonah found no change to review.',
});
/** The reuse dry run's lines: the stored session answers a review would reuse, and the code step's first
 *  request (the review agent), counted. Counts, labels of Sonah's own and sizes only; with `codeModel` (--code-model), the model they would
 *  be sent to. */
export function replayLines({ answers, codeRequests, codeModel = null }) {
  const reused = Number.isSafeInteger(answers?.reused) ? answers.reused : 0;
  const missing = Number.isSafeInteger(answers?.calls) ? answers.calls : 0;
  const kb = (n) => `${Math.ceil(n / 1024)} KB`;
  const lines = [REPLAY_WORDS.stored(reused, reused + missing, missing)];
  if (codeRequests.length) lines.push(REPLAY_WORDS.code(codeRequests.length, codeRequests.map((r) => `${r.label} `
    + `${kb(r.bytes)}`).join(', '), typeof codeModel === 'string' && codeModel ? codeModel : null));
  else lines.push(REPLAY_WORDS.noCode);
  return lines;
}

/**
 * The dry run's first lines: that nothing was sent, written or posted; how many events the session holds and in how
 * many windows (the parts a review sends one at a time) it would be reviewed; and, only when there are any, the windows
 * too large for one request, which a review would not send and would list as not covered (`unreviewed_scope`).
 * Counts and fixed words only.
 */
const noun = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
/** The words of the dry run's first lines (`dryRunLines`) and of what the recording holds (`capturePreflightLines`). */
export const DRY_RUN_WORDS = Object.freeze({
  nothing: 'Dry run: Sonah sent nothing to a model, and wrote or posted nothing.',
  session: (events, windows) => `The session has ${noun(events, 'event')}, and Sonah would review ${events === 1 ? 'it'
    : 'them'} in ${noun(windows, 'window')}.`,
  over: (over) => `${noun(over, 'window is', 'windows are')} too large for one call. A review would not send `
    + `${over === 1 ? 'it' : 'them'} and would list ${over === 1 ? 'it' : 'them'} as not covered.`,
  recording: (actions, messages, gaps) => `In the recording: ${noun(actions, 'action')} · ${noun(messages, 'message')} `
    + `of yours · ${noun(gaps, 'known gap')}.`,
  knownGaps: (list) => `Known gaps: ${list.join(' · ')}.`,
});
export function dryRunLines({ events, windows, over }) {
  const lines = [DRY_RUN_WORDS.nothing, DRY_RUN_WORDS.session(events, windows)];
  if (over > 0) lines.push(DRY_RUN_WORDS.over(over));
  return lines;
}

/** Facts available before inference, with only closed gap channels/codes and counts on stdout.
 * A declared gap can later be covered by the diff, so this is a capture inventory, not a verdict. */
export function capturePreflightLines(session) {
  const events = Array.isArray(session?.events) ? session.events : [];
  const actions = events.filter((event) => event?.kind === 'invocation').length;
  const instructions = events.filter((event) => event?.kind === 'instruction' && event.authority === 'human').length;
  const gaps = Array.isArray(session?.adapterGaps) ? session.adapterGaps : [];
  const lines = [DRY_RUN_WORDS.recording(actions, instructions, gaps.length)];
  const channels = new Set(['actions', 'observations', 'instructions', 'commentary', 'children', 'code']);
  const known = new Map();
  for (const gap of gaps) {
    if (!GAP_CODES.includes(gap?.code) || !channels.has(gap?.channel)) continue;
    const key = `${gap.channel}/${gap.code}`;
    const count = Number.isSafeInteger(gap.count) && gap.count >= 0 ? gap.count : null;
    const prior = known.get(key);
    known.set(key, prior === undefined ? count : prior === null || count === null ? null : prior + count);
  }
  if (known.size) lines.push(DRY_RUN_WORDS.knownGaps([...known].sort(([a], [b]) => a.localeCompare(b))
    .map(([key, count]) => `${key}${Number.isSafeInteger(count) ? ` ×${count}` : ''}`)));
  return lines;
}
