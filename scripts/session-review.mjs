#!/usr/bin/env node
// M33 (C-07 "Window checkpoints and resumable session review"). A resumable, session-only review
// of one recorded session and its linked children, under a hard physical-call budget, a deadline
// and a circuit breaker. Count-only: stdout is one JSON summary of integers and closed codes, and
// stderr one count-only line per recorded window — never a path, command, quote, identity, label,
// prompt or model output. Every file it writes is owner-only under --out. Running it again with
// the same --out continues the review: every stored answer is replayed (D60) and only what is
// missing is asked.
//
//   node scripts/session-review.mjs --parent FILE --codex-home DIR --out DIR
//     --backend claude-cli|codex-cli [--model ID] --max-calls N --max-seconds 1..2147483
//     [--timeout-ms 1..2147483647] [--session-key LITERAL] [--speed-profile standard|m33-fast|m33-lean]
//     [--concurrency 1..3, or 1..12 with m33-fast or m33-lean] [--stop-at-utilization U, 0 < U <= 1]
//     [--max-input-bytes N]
//
// M33 J: `--speed-profile` names the review's frozen speed profile (packages/evidence/src/
// review-profiles.js). `standard`, this script's default, is the review exactly as it always ran; `sonah review`
// runs `m33-lean` when given no --profile (D85), so a run that should match it must name `--speed-profile m33-lean`.
// `m33-fast` is an opt-in experiment, run only when named, for a session-only review: 786432-byte windows (a window whose request would not fit is re-cut, never below 196608),
// requests up to 1048576 bytes, up to 12 window lanes (the default with it) and 12 calls in flight, and a tiered
// challenge.
// M33 K: `m33-lean` is a second opt-in experiment: the standard windows and request bound (every narrative
// request is byte-identical to the standard one, so a COPY of a standard run's answers directory answers
// them with no call), m33-fast's tiered challenge with a cited-evidence dossier for its single-pass run, and
// 12 lanes and 12 calls in flight. `--stop-at-utilization U` stops admitting new windows and calls, as the
// deadline does, after any attempt that reports a rate-limit utilization of at least U (breaker
// `utilization`; M44: the highest any reported window carries, review-judge.js highestUtilization, so a
// five-hour window can stop a run before the seven-day one); unlike the deadline (which also cancels the calls in
// flight), every call in flight finishes and its answer is stored, and the run ends `review_interrupted`, resumable.
// progress.json carries the latest rate-limit fields an attempt reported (closed codes and numbers only).
//
// On claude-cli the model must be a full id that can be attested (`attestableModel`; an alias
// such as `sonnet` is a usage error), and an answer is admitted — returned, and so stored by D60 —
// only when its call is attested. codex-cli cannot attest: its answers are admitted unattested,
// and the summary's `servedModel` says so.
// D70 (a): on claude-cli `--model` may be left out — on the command line or by a caller of runSessionReviewHarness: the
// run then asks the frozen default (run-review.js SESSION_REVIEW_CLAUDE_CLI_MODEL, the CLI's long-context selector on
// the full id) for every call; codex-cli still names its model. The summary states the model value asked and whether
// it was the default or named (`model`), the context window that value requests and the windows the CLI reported its
// calls ran under (`contextWindow`), and each attempt its reported window.
// D70 review (S0): when the asked value requests a window, an attempt that reports another one, or answers and reports
// none, stops the run like a served-model mismatch (breaker `context_window`): a run that asked for the long-context
// window never goes on under another. `--max-input-bytes N` bounds the request bytes the run sends (system and prompt,
// UTF-8, counted before each attempt, retries included): an attempt that would pass it is not sent and no new window or
// call is admitted (breaker `max_input_bytes`); as with the utilization guard, every call in flight finishes and its
// answer is stored, and the run ends `review_interrupted`, resumable. The call cap does not bound tokens; this does,
// up to the bytes per token of the text. The summary counts the bytes sent (`inputBytes`) and the CLI versions the
// attempts ran on (`cliVersion`, a SemVer normal version each, `unreported` for none).
import { AsyncLocalStorage } from 'node:async_hooks';
import { setMaxListeners } from 'node:events';
import { realpathSync } from 'node:fs';
import { chmod, mkdir, open, rename, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { loadSessionEvidence } from '../packages/cli/src/session-evidence.js';
import { outcomesFor } from '../packages/cli/src/outcomes.js';
import { redact } from '../packages/redact/index.js';
import { sessionFromLedger } from '../packages/evidence/adapters/sonah-ledger.js';
import { createAnswerCache } from '../packages/cli/src/answer-cache.js';
import { ATTESTATION_STATES, NON_RETRYABLE_PROVIDER_CLASSES, PROVIDER_CLASSES, REPLY_SHAPES, REPLY_STOP_REASONS,
  USAGE_TOKEN_FIELDS, attestableModel, cliVersionOf, createReviewJudge, highestUtilization, rateLimitRecordOf,
  replyShapeRecordOf, selectedContextWindow } from '../packages/cli/src/review-judge.js';
import { CHECKPOINT_DISCARD_REASONS, SESSION_REVIEW_FAILURES, SESSION_REVIEW_STATES, createSessionReviewStore,
  reviewSession, servedModelState } from '../packages/cli/src/session-review.js';
import { CLI_SAFE_ERROR_CODES, JUDGE_FAILURE_CODES, SESSION_REVIEW_COMPLETION,
  WITHHELD_REJECTION_CAUSES, WRITTEN_WITHHELD_CAUSES, WRITTEN_LABELS, PART_CAUSES, PART_REASONS,
  PROMISE_STATUSES } from '../packages/evidence/src/ledger.js';
import { coverageCauses } from '../packages/evidence/src/review.js';
import { REVIEW_SPEED_PROFILE_NAMES, REVIEW_SPEED_PROFILES } from '../packages/evidence/src/review-profiles.js';
import { SESSION_REVIEW_CLAUDE_CLI_MODEL } from '../packages/evidence/src/run-review.js';
import { CHALLENGE_PROFILE } from '../packages/evidence/src/challenge.js';
import { EVIDENCE_REQUEST_REFUSALS } from '../packages/evidence/src/evidence-requests.js';

// /2 (M33 G4): each coverage cause is `{ n, atLeast }` (G3), and the summary counts what the review
// withheld — by closed cause — and the agent claims reported as their contradicted findings.
// /3 (M33 written statements): it counts the statements the agent wrote into files by closed label, and
// the withheld causes include the written statements' own.
// /4 (M33 per-part verdicts): it carries the parts' status histogram, how many parts carry each closed
// reason, the NO_FINDINGS part causes, whether the session-wide entry is a limit, and the windows asked
// again for an unreadable proposal.
// /5 (M33 review-WP2): the NO_FINDINGS part causes count the session-wide entry apart from the parts
// (`session_wide_unchecked`); `parts_unchecked` counts parts only.
// /6 (M33 J): it names the run's speed profile and sums the attempts' token counts (`tokens`).
// /7 (M33 K): the part reasons and causes include `decide_unsettled` / `parts_decide_unsettled`, the breaker
// may be `utilization`, and it carries the latest rate-limit fields seen (`rateLimit`).
// /8 (M33 C, claims are facts): it counts the published promises by closed status (`promisesByStatus`). (M33 C
// recheck 2: code withholds no chat claim as not a claim, so the withheld causes are /7's.)
// /9 (M36 phase 3, owner decision D68 Q; C-07 "M36 evidence re-ask"): it counts the windows' evidence requests — the
// windows that asked, the items requested and served, the bytes served, the re-asks made, kept and failed, and every
// item not served by its closed reason (`evidenceRequests`). Counts only. (M36 phase 3 review: `kept` counts the windows
// whose re-ask answer was kept, merged with the first — a re-ask never replaces it — and `fromFirst` the first answers'
// proposals their re-ask did not repeat, kept beside it.)
// /10 (D70 (a), amended by its review S0 before any /10 summary was written): the model value the run asked and whether
// it was the default or named (`model: { asked, source }`, a model id and a closed MODEL_SOURCES member); the context
// window that value requests (`contextWindow.requested`: the CLI's context selector's window in tokens, or null for the
// CLI's own default for the id) and how many attempts the CLI reported running under each window
// (`contextWindow.reported`, by window in tokens; `unreported` for none); the request bytes sent and their bound
// (`inputBytes: { sent, max }`); and the attempts by the CLI version they ran on (`cliVersion`). Each attempt in
// attempts.json carries its reported window and CLI version. Counts, closed codes and the asked model id only.
// /11 (D71 (a), owner decision 2026-10-08: no verdict in any summary): the summary carries no status — `sessionStatus`,
// `reviewStatus` and the parts' status histogram (`parts.byStatus`) are gone; whether the review completed is
// `sessionReview`, and the parts keep their closed reasons and causes. The report itself keeps its statuses for any
// reader outside this repository.
// /12 (D71, S2: the reviewer brief as the checklist): the promises by closed status count `incomplete` too (a claim whose
// every cited check never ran to an end), and the checklist's own counts ride beside them (`checklist`: the requirement
// rows by status and by the closed reason code lowered them for, the refused `restsOn` ids, `notClaims` and the closing
// message's coverage — report.counts.checklist; null on a report without one). Counts only.
// /13 (D71, S3: the new channels): the checklist's counts carry the failures section (`failures`: the RESULTs listed by
// typed outcome, the rows by handling and by the closed reason code lowered them for, the rows left out), the choices not
// to act proposed and published (`notActing`), the contradicted claims by what contradicts them (`contradictions`), the
// project instruction files the recording gave the agent (`projectInstructions`) and the claims marked as assumptions
// (`assumptions`). Counts and closed names only.
// /14 (M44: the CLI reports utilization per window): the rate-limit fields (`rateLimit`, and each attempt's) carry
// `windows`, each reported window's utilization by its closed RATE_LIMIT_WINDOWS name (null when none), and the
// `utilization` breaker compares the highest utilization any reported window carries. Closed names and numbers only.
// /15 (M44: the unreadable replies): each attempt in attempts.json carries `replyShape`, an accepted claude-cli reply's
// closed shape (review-judge.js replyShapeOf: the REPLY_SHAPES code, whether a fence was there, the reply's characters and
// those before and after the value read, the final assistant event's last REPLY_BLOCK_TYPES (at most
// REPLY_FINAL_BLOCKS_KEPT), its blocks and text blocks, the assistant events and their text blocks, whether the joined text
// blocks read as an object, the REPLY_STOP_REASONS stop reason, turns and thinking tokens), null for any other attempt; the
// summary counts them (`replyShape`; an unreadable reply with no stop reason under `unreported`). Closed values and numbers
// only, never any text.
// /16 (D78, a bare votes list is read): a challenge reply that is a bare list of the batch's votes is now an answer, so
// an `array` reply is no longer always unreadable. `replyShape.unreadable` counts only the attempts that failed, and
// `replyShape.readAsVotes` the `array` replies read as votes; `byCode` still counts every accepted reply's shape.
// /17 (owner decision D80, the D80 integration; item Q): a quote only in the body of a write whose command did not run,
// failed or stopped is refused with one closed reason, `write_command_not_run_or_failed`, so `withheld.causes` and the
// checklist's requirement and failure reasons (`checklist.requirements.reasons`, `checklist.failures.reasons`) carry it
// (0 unless a row or statement was refused so). Items N, M and W add no summary field (M's `counts.claimsMerged` is
// the report's; the summary's promise counts read the merged claims). Counts and closed names only.
export const HARNESS_SUMMARY_SCHEMA = 'sonah.session-review-harness/17';
export const HARNESS_BACKENDS = Object.freeze(['claude-cli', 'codex-cli']);
const [CLAUDE_CLI] = HARNESS_BACKENDS;
/** A call's served-model attestation as the transport reports it (review-judge.js's
 *  ATTESTATION_STATES), and `unknown` when it reported none or a value outside that table. */
export const ATTESTATIONS = Object.freeze([...ATTESTATION_STATES, 'unknown']);
const [ATTESTED, MISMATCH, UNATTESTED] = ATTESTATION_STATES;
const UNKNOWN_ATTESTATION = ATTESTATIONS.at(-1);
/** C-07's closed provider classes are review-judge.js's; a value outside the table is `unknown`. */
const UNKNOWN_PROVIDER = PROVIDER_CLASSES.at(-1);
/** Why the breaker stopped admission: a served-model mismatch, a context window other than the one the asked model
 *  value requests (D70 review), a non-retryable provider class (NON_RETRYABLE_PROVIDER_CLASSES, never a transient
 *  one), a rate-limit utilization at or over `--stop-at-utilization` (M33 K), the call budget, the request-byte budget
 *  (D70 review), the deadline or a signal. */
const ATTESTATION_TRIP = 'attestation_mismatch', CONTEXT_WINDOW_TRIP = 'context_window', UTILIZATION_TRIP = 'utilization',
  MAX_CALLS_TRIP = 'max_calls', MAX_INPUT_BYTES_TRIP = 'max_input_bytes', DEADLINE_TRIP = 'deadline', SIGNAL_TRIP = 'signal';
export const BREAKER_REASONS = Object.freeze([ATTESTATION_TRIP, CONTEXT_WINDOW_TRIP, ...NON_RETRYABLE_PROVIDER_CLASSES,
  UTILIZATION_TRIP, MAX_CALLS_TRIP, MAX_INPUT_BYTES_TRIP, DEADLINE_TRIP, SIGNAL_TRIP]);
/** D70 review (S0): where the model a run asked came from — the frozen default (no model named) or the run's own. */
export const MODEL_SOURCES = Object.freeze(['default', 'named']);
const [DEFAULT_MODEL, NAMED_MODEL] = MODEL_SOURCES;
/** D70 (a): the model value a run asks — the one it names, else on claude-cli the frozen long-context default. */
const askedModel = (options) => (options?.model !== undefined ? options.model
  : options?.backend === CLAUDE_CLI ? SESSION_REVIEW_CLAUDE_CLI_MODEL : undefined);
/** The harness's own failures: a malformed command line, or a recording that could not be loaded. */
export const HARNESS_FAILURES = Object.freeze(['usage', 'session_load_failed']);
const [USAGE, SESSION_LOAD_FAILED] = HARNESS_FAILURES;
const [BUDGET_EXHAUSTED] = JUDGE_FAILURE_CODES.filter((c) => c === 'budget_exhausted');
const [MODEL_UNAVAILABLE] = JUDGE_FAILURE_CODES.filter((c) => c === 'model_unavailable');
const [RUNNING, FINISHED, INTERRUPTED, FAILED] = SESSION_REVIEW_STATES;
const [, REVIEW_INTERRUPTED, , REVIEW_FAILED] = SESSION_REVIEW_FAILURES;
const OTHER_CODE = UNKNOWN_PROVIDER;
/** setTimeout keeps a delay in a signed 32-bit millisecond count; a longer one fires at once
 *  (Node's TimeoutOverflowWarning). Every timer this harness or its transport sets fits it. */
const MAX_TIMER_MS = 2_147_483_647;
const MAX_SECONDS = Math.floor(MAX_TIMER_MS / 1000);
/** M33 J: the speed profile a run names nothing for. */
const [STANDARD_PROFILE] = REVIEW_SPEED_PROFILE_NAMES;
/** M44: the one reply shape that is an answer, and the key the unreadable replies with no stop reason count under. */
const [READABLE_REPLY, ARRAY_REPLY] = REPLY_SHAPES;
const UNREPORTED_STOP = 'unreported';

const failure = (code) => Object.assign(new Error(code), { code });
const count = (n) => (Number.isSafeInteger(n) && n >= 0 ? n : 0);
/** A count, or null: a value that is not a non-negative integer is no count at all. */
const countOrNull = (n) => (Number.isSafeInteger(n) && n >= 0 ? n : null);
const nonNegative = (n) => (Number.isFinite(n) && n >= 0 ? n : null);
const positive = (text) => (/^[1-9]\d{0,15}$/.test(text) && Number.isSafeInteger(Number(text)) ? Number(text) : null);
const within = (n, max) => Number.isSafeInteger(n) && n >= 1 && n <= max;
/** M33 K: a `--stop-at-utilization` bound: a fraction in (0, 1], as `0.9`, `1` or `1.0` — nothing else. */
const fraction = (text) => (/^(?:0\.\d{1,6}|1(?:\.0{1,6})?)$/.test(text) && Number(text) > 0 ? Number(text) : null);
const utilizationBound = (value) => value === undefined || (typeof value === 'number' && value > 0 && value <= 1);
const zeros = (vocabulary) => Object.fromEntries(vocabulary.map((token) => [token, 0]));
const CLOSED_CODES = new Set([...SESSION_REVIEW_FAILURES, ...CLI_SAFE_ERROR_CODES, ...JUDGE_FAILURE_CODES,
  ...CHECKPOINT_DISCARD_REASONS, ...HARNESS_FAILURES]);
const closedCode = (code) => (CLOSED_CODES.has(code) ? code : REVIEW_FAILED);
/** M33 (C-06): the coverage and completion fields are closed vocabularies (D71 (a): the summary carries no status). A
 *  value outside one reads as its most conservative member, never as itself. */
const COVERAGE_STATES = Object.freeze(['complete', 'partial', 'missing']);
const [, REVIEW_INCOMPLETE] = SESSION_REVIEW_COMPLETION;
const member = (value, vocabulary, fallback) => (vocabulary.includes(value) ? value : fallback);
/** M33 (C-06): every declared cause of a partial coverage with its count — closed COVERAGE_CAUSES
 *  tokens, each `{ n, atLeast }`. A cause whose declarations stated no count is counted by its
 *  declarations (review.js `coverageCauses`): that count is a lower bound, `atLeast: true`, and is
 *  never recorded like an exact one (G3). `n` is null only for a fact that has no count (no windows,
 *  no actions). A partial coverage is never reported without them. */
function causeCounts(report) {
  let causes = [];
  try { causes = coverageCauses(report); } catch { causes = []; }
  return Object.fromEntries(causes.map(([cause, counts]) => {
    const n = Number.isSafeInteger(counts?.n) && counts.n >= 0 ? counts.n : null;
    return [cause, { n, atLeast: n !== null && counts.atLeast === true }];
  }));
}

/** M33 G4: what the review withheld as inconclusive (D58), as counts only — the proposals, the
 *  challenge items left unsettled, and every closed WITHHELD_REJECTION_CAUSES cause, always present.
 *  A value that is not a count reads as zero; nothing about any item leaves the harness. */
function withheldCounts(report) {
  const withheld = report?.withheld;
  return { proposals: count(withheld?.proposals), unsettled: count(withheld?.unsettled),
    causes: Object.fromEntries([...WITHHELD_REJECTION_CAUSES, ...WRITTEN_WITHHELD_CAUSES]
      .map((cause) => [cause, count(withheld?.causes?.[cause])])) };
}

/** M33 C: the published promises by closed status (PROMISE_STATUSES), every status always present. Counts
 *  only: no claim text or quote leaves the harness. A status outside the vocabulary counts nowhere. */
/** M36 phase 3 (D68 Q): the windows' evidence requests, counts only — zeros when no window asked. */
const evidenceCounts = (report) => {
  const counted = report?.counts?.evidenceRequests ?? {};
  return { ...Object.fromEntries(['windows', 'requested', 'items', 'served', 'servedBytes', 'reasks', 'kept',
    'fromFirst', 'reaskFailed']
    .map((field) => [field, count(counted[field])])),
  refused: Object.fromEntries(EVIDENCE_REQUEST_REFUSALS.map((reason) => [reason, count(counted.refused?.[reason])])) };
};

function promiseCounts(report) {
  const promises = Array.isArray(report?.promises) ? report.promises : [];
  return Object.fromEntries(PROMISE_STATUSES.map((status) => [status, promises.filter((p) => p?.status === status).length]));
}

/** M33 (C-06 "M33 written statements"): the published written statements by closed side label, every
 *  label always present. Counts only: no statement text, quote or path leaves the harness. */
function writtenCounts(report) {
  const statements = Array.isArray(report?.writtenClaims) ? report.writtenClaims : [];
  return Object.fromEntries(WRITTEN_LABELS.map((label) => [label, statements.filter((w) => w?.label === label).length]));
}

/** M33 (C-06 "M33 per-part verdicts"): the parts, as counts and closed codes only — how many carry each closed reason
 *  (every reason always present), the part causes (the session-wide entry's `session_wide_unchecked` apart from the
 *  parts'), and whether the session-wide entry is a limit, with its closed reasons. D71 (a): no part's status. A value
 *  outside a vocabulary counts nowhere. No part's events or text leave the harness. */
function partCounts(report) {
  const parts = Array.isArray(report?.parts) ? report.parts : [];
  const wide = report?.sessionWideLimits;
  const has = (list, token) => Array.isArray(list) && list.includes(token);
  return {
    total: parts.length,
    byReason: Object.fromEntries(PART_REASONS.map((reason) => [reason, parts.filter((p) => has(p?.reasons, reason)).length])),
    causes: Object.fromEntries(PART_CAUSES.map((cause) => [cause, count(report?.partCounts?.[cause])])),
    sessionWide: { limited: wide?.limited === true, reasons: PART_REASONS.filter((reason) => has(wide?.reasons, reason)) },
  };
}

/**
 * Whether a run may start with these options. C-07: this runner requests a full model id
 * and admits an answer only when it is attested, so on claude-cli a model `attestableModel` refuses
 * (an alias such as `sonnet`) is a usage error. codex-cli reports no served model: allowed, and
 * every answer it gives is recorded `unattested`. Every bound is an integer a timer can hold.
 */
function harnessOptionsValid(options) {
  return options !== null && typeof options === 'object'
    && ['parent', 'codexHome', 'out', 'sessionKey'].every((k) => typeof options[k] === 'string' && options[k] !== '')
    && HARNESS_BACKENDS.includes(options.backend)
    && typeof askedModel(options) === 'string' && askedModel(options) !== ''
    && (options.backend !== CLAUDE_CLI || attestableModel(askedModel(options)))
    && Number.isSafeInteger(options.maxCalls) && options.maxCalls >= 1
    && within(options.maxSeconds, MAX_SECONDS) && within(options.timeoutMs, MAX_TIMER_MS)
    // M33 J: the lanes are bounded by the named profile's (a caller that names none runs standard).
    && REVIEW_SPEED_PROFILE_NAMES.includes(speedOf(options))
    && within(options.concurrency, REVIEW_SPEED_PROFILES[speedOf(options)].windowConcurrency)
    && utilizationBound(options.stopAtUtilization)
    // D70 review (S0): the request-byte budget, when given, is a positive integer.
    && (options.maxInputBytes === undefined || (Number.isSafeInteger(options.maxInputBytes) && options.maxInputBytes >= 1));
}

/** M33 J: the speed profile a run's options name; standard when they name none. */
const speedOf = (options) => (options.speedProfile === undefined ? STANDARD_PROFILE : options.speedProfile);

/** The command line, or a `usage` error. Every value is required once; nothing else is accepted. */
export function parseHarnessArgs(argv) {
  const names = new Map([['--parent', 'parent'], ['--codex-home', 'codexHome'], ['--out', 'out'], ['--backend', 'backend'],
    ['--model', 'model'], ['--max-calls', 'maxCalls'], ['--max-seconds', 'maxSeconds'], ['--timeout-ms', 'timeoutMs'],
    ['--session-key', 'sessionKey'], ['--concurrency', 'concurrency'], ['--speed-profile', 'speedProfile'],
    ['--stop-at-utilization', 'stopAtUtilization'], ['--max-input-bytes', 'maxInputBytes']]);
  const raw = {};
  for (let i = 0; i < argv.length; i += 2) {
    const name = names.get(argv[i]);
    const value = argv[i + 1];
    if (!name || typeof value !== 'string' || !value || Object.hasOwn(raw, name)) throw failure(USAGE);
    raw[name] = value;
  }
  if (['parent', 'codexHome', 'out', 'backend', 'maxCalls', 'maxSeconds'].some((k) => !Object.hasOwn(raw, k)))
    throw failure(USAGE);
  // M33 J: the speed profile by name, standard by default; with no --concurrency, the profile's lanes.
  const speedProfile = raw.speedProfile ?? STANDARD_PROFILE;
  const lanes = REVIEW_SPEED_PROFILE_NAMES.includes(speedProfile) ? REVIEW_SPEED_PROFILES[speedProfile].windowConcurrency : null;
  // D70 (a): with no --model, claude-cli asks the frozen default (`askedModel`); codex-cli has none (usage). The
  // option stays absent, so the run records that it took the default.
  const options = { parent: raw.parent, codexHome: raw.codexHome, out: raw.out, backend: raw.backend,
    ...(Object.hasOwn(raw, 'model') ? { model: raw.model } : {}),
    maxCalls: positive(raw.maxCalls), maxSeconds: positive(raw.maxSeconds),
    timeoutMs: Object.hasOwn(raw, 'timeoutMs') ? positive(raw.timeoutMs) : 20 * 60_000,
    sessionKey: raw.sessionKey ?? 'session', speedProfile,
    concurrency: Object.hasOwn(raw, 'concurrency') ? positive(raw.concurrency) : lanes,
    // M33 K: absent is today's behaviour; a value that is not a fraction in (0, 1] is usage.
    ...(Object.hasOwn(raw, 'stopAtUtilization') ? { stopAtUtilization: fraction(raw.stopAtUtilization) ?? Number.NaN } : {}),
    // D70 review (S0): absent is no byte budget; a value that is not a positive integer is usage.
    ...(Object.hasOwn(raw, 'maxInputBytes') ? { maxInputBytes: positive(raw.maxInputBytes) ?? Number.NaN } : {}) };
  if (!harnessOptionsValid(options)) throw failure(USAGE);
  return options;
}

/** The recorded session, exactly as the session count replay loads it: parent and linked children,
 *  bounded and validated before anything else reads it (redact; D90: nothing is masked; this utility writes only
 *  owner-only files, 0600 in a 0700 directory). */
async function loadRecordedSession({ parent, codexHome, sessionKey }) {
  const files = [resolve(parent)];
  const raw = await loadSessionEvidence(files, { outcomes: await outcomesFor(files), reviewLinkedChildren: true,
    recordingRoots: { codex: join(resolve(codexHome), 'sessions') } });
  const { ledger } = redact(raw);
  return sessionFromLedger(ledger, { sessionKey });
}

async function writePrivate(directory, name, value) {
  const temp = join(directory, `.${randomUUID()}.tmp`);
  let handle = null;
  try {
    handle = await open(temp, 'wx', 0o600);
    await handle.writeFile(`${JSON.stringify(value)}\n`);
    await handle.sync();
    await handle.close();
    handle = null;
    await rename(temp, join(directory, name));
  } finally {
    await handle?.close().catch(() => {});
    await rm(temp, { force: true }).catch(() => {});
  }
}

/**
 * Run (or continue) one review. Resolves `{ summary, exitCode }`: 0 finished, 3 interrupted,
 * 2 usage, 1 otherwise. `loadSession`, `createJudge`, `now` and `write` are injectable for
 * synthetic tests. Options that `parseHarnessArgs` would refuse are refused here too, before any
 * directory, timer, transport or call.
 */
export async function runSessionReviewHarness(options, { loadSession = loadRecordedSession, createJudge = createReviewJudge,
  now = Date.now, write = (text) => process.stdout.write(text), progress = (text) => process.stderr.write(text),
  installSignals = true } = {}) {
  const previousMask = process.umask(0o077);
  const usable = harnessOptionsValid(options);
  const out = usable ? resolve(options.out) : null;
  // D70 (a): the model value every call asks, and the context window it requests (null: the CLI's default for the id).
  const model = usable ? askedModel(options) : null;
  const requestedWindow = usable ? selectedContextWindow(model) : null;
  // M33 K: two signals. `admission` (the review's) stops admitting windows and calls; `controller` (the
  // transport's) also cancels every call in flight. Every breaker aborts both, except the utilization
  // guard, which aborts admission only: the calls in flight finish and their answers are stored.
  const controller = new AbortController();
  const admission = new AbortController();
  // M33 K: each call in flight holds one abort listener on each signal (review-judge.js `cancellationOf`;
  // the review's bounded judge); twelve lanes pass Node's default of ten. Sized to every call the
  // profile's review can have in flight.
  if (usable) setMaxListeners(REVIEW_SPEED_PROFILES[speedOf(options)].windowConcurrency * CHALLENGE_PROFILE.maxConcurrency,
    controller.signal, admission.signal);
  let breaker = null;
  // M33 K: the latest rate-limit fields an attempt reported (closed codes and numbers only), or null.
  let latestRateLimit = null;
  const trip = (reason) => { breaker ??= reason; admission.abort(); controller.abort(); };
  // `counted` refuses every attempt after a breaker, a retry included, so nothing new starts either way.
  const stopAdmitting = (reason) => { breaker ??= reason; admission.abort(); };
  // `refused`: answers the transport returned that were not admitted (never stored, never used).
  const tally = { attempted: 0, returned: 0, ok: 0, refused: 0 };
  const attestation = zeros(ATTESTATIONS), providerClass = {};
  // Admitted answers only, by attestation: what this attempt's live answers are attested as.
  const served = { [ATTESTED]: 0, [UNATTESTED]: 0 };
  const attempts = [];
  // M33 J: every attempt's token counts, summed.
  const tokens = zeros(USAGE_TOKEN_FIELDS);
  // D70 (a): how many attempts the CLI reported running under each context window (null: none reported). D70 review
  // (S0): and under each CLI version (null: none readable), and the request bytes sent.
  const reportedWindows = new Map(), cliVersions = new Map();
  let sentBytes = 0;
  // M44: the accepted claude-cli replies by closed shape, and of the unreadable ones (any shape but `object`) how many
  // carried a fence, how many the joined text blocks would have read, and their stop reasons.
  // D78 (/16): an `array` reply read as a challenge's votes is an answer, counted apart (`readAsVotes`).
  const replyShapes = { byCode: zeros(REPLY_SHAPES), readAsVotes: 0, unreadable: { fenced: 0, joinedTextReadable: 0,
    byStopReason: { ...zeros(REPLY_STOP_REASONS), [UNREPORTED_STOP]: 0 } } };
  // Each physical attempt's own reports, whichever other attempts are in flight beside it.
  const attemptScope = new AsyncLocalStorage();
  // This attempt's own progress: the last one it wrote. Never read back from the store, where an
  // earlier attempt's (or another review's) progress may be.
  let own = null;
  let timer = null, signals = 0;
  const onSignal = () => { if (++signals > 1) process.exit(130); trip(SIGNAL_TRIP); };
  let failureCode = null, result = null;
  try {
    if (!usable) throw failure(USAGE);
    const deadline = now() + options.maxSeconds * 1000;
    timer = setTimeout(() => trip(DEADLINE_TRIP), options.maxSeconds * 1000);
    timer.unref?.();
    if (installSignals) { process.on('SIGINT', onSignal); process.on('SIGTERM', onSignal); }
    await mkdir(out, { recursive: true, mode: 0o700 });
    await chmod(out, 0o700);
    // Closed fields of each attempt only; the transport's text and model names never leave. M33 J: and
    // its token counts, durations and last rate-limit event — numbers and closed codes only.
    const onResult = (metadata) => {
      tally.returned++;
      const ok = metadata?.ok === true;
      const attested = ATTESTATION_STATES.includes(metadata?.attestation) ? metadata.attestation : UNKNOWN_ATTESTATION;
      const provider = metadata?.providerClass == null ? null
        : PROVIDER_CLASSES.includes(metadata.providerClass) ? metadata.providerClass : UNKNOWN_PROVIDER;
      const code = ok ? null : JUDGE_FAILURE_CODES.includes(metadata?.code) ? metadata.code : OTHER_CODE;
      const usage = Object.fromEntries(USAGE_TOKEN_FIELDS.map((field) => [field, countOrNull(metadata?.usage?.[field])]));
      for (const field of USAGE_TOKEN_FIELDS) tokens[field] += count(usage[field]);
      // M33 J: the transport's rate-limit report as closed codes and numbers only (review-judge.js rateLimitRecordOf;
      // M44: with each window's utilization), or null when it reported none.
      const rateLimit = rateLimitRecordOf(metadata?.rateLimit);
      const utilization = highestUtilization(rateLimit);
      if (rateLimit !== null) latestRateLimit = rateLimit;
      // D70 (a): the context window the CLI states it ran this attempt under, a count, or null.
      const contextWindow = countOrNull(metadata?.contextWindow) || null;
      reportedWindows.set(contextWindow, (reportedWindows.get(contextWindow) ?? 0) + 1);
      // D70 review (S0): the CLI version the attempt ran on, a SemVer normal version, or null.
      const cliVersion = cliVersionOf(metadata?.cliVersion);
      cliVersions.set(cliVersion, (cliVersions.get(cliVersion) ?? 0) + 1);
      // M44: an accepted reply's closed shape (review-judge.js replyShapeRecordOf), or null; a code outside
      // REPLY_SHAPES counts nowhere.
      const replyShape = replyShapeRecordOf(metadata?.replyShape);
      if (replyShape?.code != null) {
        replyShapes.byCode[replyShape.code]++;
        if (replyShape.code === ARRAY_REPLY && ok === true) replyShapes.readAsVotes++;
        else if (replyShape.code !== READABLE_REPLY) {
          const { unreadable } = replyShapes;
          if (replyShape.fenced === true) unreadable.fenced++;
          if (replyShape.joinedTextReadable === true) unreadable.joinedTextReadable++;
          unreadable.byStopReason[replyShape.stopReason ?? UNREPORTED_STOP]++;
        }
      }
      attempts.push({ ok, code, attestation: attested, providerClass: provider,
        elapsedMs: count(metadata?.elapsedMs), inputBytes: count(metadata?.inputBytes),
        usage, durationMs: nonNegative(metadata?.durationMs), durationApiMs: nonNegative(metadata?.durationApiMs),
        rateLimit, contextWindow, cliVersion, replyShape });
      attestation[attested]++;
      if (provider) providerClass[provider] = (providerClass[provider] ?? 0) + 1;
      if (ok) tally.ok++;
      attemptScope.getStore()?.push({ ok, attestation: attested });
      if (attested === MISMATCH) trip(ATTESTATION_TRIP);
      else if (NON_RETRYABLE_PROVIDER_CLASSES.includes(provider)) trip(provider);
      // D70 review (S0): a run that asked for a window never goes on under another — an attempt that reports another
      // window, or answers and reports none, stops it before any further call (a failed attempt that reports none is
      // left to its own class).
      else if (requestedWindow !== null && (contextWindow !== null || ok) && contextWindow !== requestedWindow)
        trip(CONTEXT_WINDOW_TRIP);
      // M33 K: no window or call is admitted after it, as after the deadline; unlike the deadline, the
      // transport's signal is left alone, so every call in flight finishes and its answer is stored.
      // M44: `utilization` is the highest any window the attempt reported carries.
      else if (options.stopAtUtilization !== undefined && utilization !== null
          && utilization >= options.stopAtUtilization) stopAdmitting(UTILIZATION_TRIP);
    };
    // C-07: claude-cli admits only an attested answer; codex-cli, which cannot attest, an
    // unattested one. A mismatch, or a report that is missing or not a member, is never admitted.
    const admissible = (attested) => attested === ATTESTED || (options.backend !== CLAUDE_CLI && attested === UNATTESTED);
    let session;
    try { session = await loadSession(options); } catch { throw failure(SESSION_LOAD_FAILED); }
    const transport = createJudge({ config: { backend: options.backend, model },
      timeoutMs: options.timeoutMs, signal: controller.signal, onResult });
    // Every physical attempt — a retry included — passes here, and is counted when it is admitted.
    // An answer is returned (so D60 stores it) only when this attempt's one report is ok and
    // admissible; otherwise it is refused as `model_unavailable` and nothing from it is kept.
    const counted = async (request) => {
      // D70 review (S0): the bytes this attempt would send, as the transport counts them.
      const bytes = (typeof request?.system === 'string' ? Buffer.byteLength(request.system) : 0)
        + (typeof request?.prompt === 'string' ? Buffer.byteLength(request.prompt) : 0);
      if (breaker === null && tally.attempted >= options.maxCalls) trip(MAX_CALLS_TRIP);
      if (breaker === null && now() >= deadline) trip(DEADLINE_TRIP);
      // An attempt that would pass the byte budget is not sent; the calls in flight finish and are stored.
      if (breaker === null && options.maxInputBytes !== undefined && sentBytes + bytes > options.maxInputBytes)
        stopAdmitting(MAX_INPUT_BYTES_TRIP);
      if (breaker !== null) throw failure(BUDGET_EXHAUSTED);
      tally.attempted++;
      sentBytes += bytes;
      const reports = [];
      const answer = await attemptScope.run(reports, () => transport(request));
      const [report] = reports;
      if (reports.length !== 1 || !report.ok || !admissible(report.attestation)) {
        tally.refused++;
        throw failure(MODEL_UNAVAILABLE);
      }
      served[report.attestation]++;
      return answer;
    };
    const store = createSessionReviewStore(join(out, 'review'));
    result = await reviewSession({ session, judge: counted, backend: options.backend, model,
      answerCache: createAnswerCache(join(out, 'answers'), { backend: options.backend, model }),
      store: { ...store, writeProgress: async (value) => { await store.writeProgress(value); own = value; } },
      signal: admission.signal, concurrency: options.concurrency, speedProfile: speedOf(options),
      servedModelTally: () => ({ ...served }), rateLimitTally: () => latestRateLimit,
      onWindowRecord: (event) => progress(`${JSON.stringify({ window: event.window, of: event.of,
        finished: event.finished, state: event.state })}\n`) });
  } catch (error) {
    failureCode = closedCode(error?.code);
  } finally {
    clearTimeout(timer);
    if (installSignals) { process.off('SIGINT', onSignal); process.off('SIGTERM', onSignal); }
  }
  try {
    // Only this attempt's own progress. An attempt that wrote none — a usage error, a load failure,
    // a refused lock, or a review that failed before its first progress — reports zero counts and
    // no state. A `running` progress is this attempt's last write before a failure whose own
    // write did not land: it ended as the failure says.
    const state = own === null ? null : own.state !== RUNNING ? own.state
      : failureCode === REVIEW_INTERRUPTED ? INTERRUPTED : FAILED;
    const windows = own?.windows ?? {};
    const report = result?.report ?? null;
    const summary = {
      schema: HARNESS_SUMMARY_SCHEMA,
      state,
      failure: failureCode,
      attempt: count(own?.attempt),
      windows: Object.fromEntries(['total', 'finished', 'complete', 'incomplete', 'failed', 'replayed']
        .map((field) => [field, count(windows[field])])),
      calls: { live: count(own?.calls?.live), reused: count(own?.calls?.reused) },
      // M33 J: the run's speed profile (a closed name; null for a command line refused as usage), and
      // the token counts every attempt reported, summed.
      speedProfile: usable ? speedOf(options) : null,
      tokens: { ...tokens },
      // M33 K: the latest rate-limit fields an attempt reported, or null.
      rateLimit: latestRateLimit,
      // D70 (a): the model value asked and where it came from (null for a command line refused as usage); the window
      // that value requests (null: the CLI's default for the id) and the attempts by the window the CLI reported, in
      // ascending order, `unreported` last.
      model: usable ? { asked: model, source: options.model === undefined ? DEFAULT_MODEL : NAMED_MODEL } : null,
      contextWindow: { requested: requestedWindow,
        reported: Object.fromEntries([...[...reportedWindows.keys()].filter((w) => w !== null).sort((a, b) => a - b)
          .map((w) => [String(w), reportedWindows.get(w)]),
        ...(reportedWindows.has(null) ? [['unreported', reportedWindows.get(null)]] : [])]) },
      // D70 review (S0): the request bytes sent and the budget (null: none), and the attempts by CLI version.
      inputBytes: { sent: sentBytes, max: usable && options.maxInputBytes !== undefined ? options.maxInputBytes : null },
      cliVersion: Object.fromEntries([...[...cliVersions.keys()].filter((v) => v !== null).sort()
        .map((v) => [v, cliVersions.get(v)]), ...(cliVersions.has(null) ? [['unreported', cliVersions.get(null)]] : [])]),
      physicalCalls: { ...tally },
      breaker,
      attestation: { ...attestation },
      providerClass,
      servedModel: servedModelState(served),
      // M44: the accepted replies by closed shape, and what the unreadable ones carried. Counts only.
      replyShape: { byCode: { ...replyShapes.byCode }, readAsVotes: replyShapes.readAsVotes,
        unreadable: { ...replyShapes.unreadable,
        byStopReason: { ...replyShapes.unreadable.byStopReason } } },
      ...(report && failureCode === null && state === FINISHED ? {
        coverage: member(report.coverage, COVERAGE_STATES, 'missing'),
        sessionReview: member(report.sessionReview, SESSION_REVIEW_COMPLETION, REVIEW_INCOMPLETE),
        coverageCauses: report.coverage === 'complete' ? {} : causeCounts(report),
        decisions: report.decisions.length, findings: report.findings.length,
        // C-06 (M33): grounded agent claims published as open promises — a count, never their text.
        promises: Array.isArray(report.promises) ? report.promises.length : 0,
        // M33 C: and by closed status — `open` (a reader is shown "not checked") or `verified`.
        promisesByStatus: promiseCounts(report),
        // D71 (S2): the checklist's counts (run-review.js `report.counts.checklist`), counts and closed names only.
        checklist: report.counts?.checklist ?? null,
        // G4: claims reported as their contradicted findings instead, and what was withheld.
        promisesAsFindings: count(report.counts?.promisesAsFindings),
        withheld: withheldCounts(report),
        writtenClaims: writtenCounts(report),
        // M33 (I2): `rejected` counts by where each rejection is recorded, so its fields overlap and are
        // never added up: a contradicted claim whose receipts were rejected is both a ledger row
        // (`findings`) and a rejected claim (`claims`). It is one proposal, withheld once
        // (`withheld.proposals`).
        rejected: { decisions: report.rejectedDecisions.length, findings: report.rejectedFindings.length,
          pivots: count(report.pivotsRejected), requirements: count(report.requirementsRejected),
          claims: count(report.claimsRejected) },
        windowCompletion: report.instrument.windowCompletion,
        // M33 (C-06 "M33 per-part verdicts"): the parts, and the windows asked again for an unreadable proposal.
        parts: partCounts(report),
        proposalReasks: Object.fromEntries(['asked', 'recovered', 'unreadable']
          .map((field) => [field, count(report.counts?.proposalReasks?.[field])])),
        // M36 phase 3 (D68 Q): the windows' evidence requests, every count always present.
        evidenceRequests: evidenceCounts(report),
      } : {}),
    };
    // A command line refused as usage touches no file.
    if (out !== null) {
      await writePrivate(out, 'summary.json', summary).catch(() => {});
      await writePrivate(out, 'attempts.json', attempts).catch(() => {});
    }
    write(`${JSON.stringify(summary)}\n`);
    return { summary, exitCode: failureCode === null && state === FINISHED ? 0
      : failureCode === REVIEW_INTERRUPTED ? 3 : failureCode === USAGE ? 2 : 1 };
  } finally { process.umask(previousMask); }
}

/** Run as a script (by its own path, a symlink to it, or a path with spaces; both sides resolved, so it holds under
 *  --preserve-symlinks-main too), never when imported. */
const invokedDirectly = () => {
  try { return Boolean(process.argv[1]) && realpathSync(resolve(process.argv[1])) === realpathSync(new URL(import.meta.url)); }
  catch { return false; }
};

if (invokedDirectly()) {
  process.umask(0o077);
  let options = null;
  try { options = parseHarnessArgs(process.argv.slice(2)); }
  catch {
    process.stderr.write('usage: session-review.mjs --parent FILE --codex-home DIR --out DIR --backend claude-cli|codex-cli '
      + '[--model ID] --max-calls N --max-seconds 1..2147483 [--timeout-ms 1..2147483647] [--session-key LITERAL] '
      + '[--speed-profile standard|m33-fast|m33-lean] [--concurrency 1..3, or 1..12 with m33-fast or m33-lean] '
      + '[--stop-at-utilization U, 0 < U <= 1] [--max-input-bytes N]  '
      + '(claude-cli: a full model id, never an alias; by default the long-context id; codex-cli: required)\n');
    process.exitCode = 2;
  }
  if (options) {
    try { process.exitCode = (await runSessionReviewHarness(options)).exitCode; }
    catch (error) {
      process.stderr.write(`${JSON.stringify({ failure: closedCode(error?.code) })}\n`);
      process.exitCode = 1;
    }
  }
}
