// Explicit, tool-free transports for session/PR review, and one claude-cli agent transport with read-only tools for the
// requests that carry `agent` (`isAgentRequest`). Never infer billing from a key.
import { spawn } from 'node:child_process';
import { mkdtemp, chmod, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { isAbsolute, join } from 'node:path';
import { REASKABLE_JUDGE_CODES, RETRYABLE_JUDGE_CODES, CODE_READ_FAILURES } from '../../evidence/src/ledger.js';
import { TRANSPORT_SHORTFALL } from '../../evidence/src/run-review.js';
import { codexExecutable, codexJudgeArgs } from './codex-model.js';
import { IMAGE_BACKENDS, REQUEST_IMAGE_LIMITS } from '../../evidence/src/images.js';
import { REPLY_BEGUN } from '../../evidence/src/challenge.js';

// W3d-1: a transport failure also carries its closed `transportClass`. The message is the
// code and nothing else — no stderr, no provider body, no error text reaches the thrown error.
const failure = (code, transportClass = null) => Object.assign(new Error(code), { code },
  TRANSPORT_SHORTFALL.includes(transportClass) ? { transportClass } : {});

// Everything a model returns is UNTRUSTED. This only finds the JSON value in a reply; it believes nothing in it.

/**
 * Models wrap JSON in prose and fences no matter how firmly they are asked not to. This is not
 * defensive programming, it is a known fix (a fence strip, as `strip_json_fence` does elsewhere):
 * without it the parse fails and the findings are dropped silently.
 */
export function extractJson(text) {
  if (!text) return null;
  const fenced = text.match(/```(?:json)?\s*\n([\s\S]*?)```/);
  const candidates = [fenced?.[1], text];
  for (const c of candidates) {
    if (!c) continue;
    const t = c.trim();
    const start = t.search(/[[{]/);
    if (start === -1) continue;
    // Walk to the matching close so trailing prose does not break the parse.
    const open = t[start];
    const close = open === '{' ? '}' : ']';
    let depth = 0;
    let inStr = false;
    let esc = false;
    for (let i = start; i < t.length; i++) {
      const ch = t[i];
      if (inStr) {
        if (esc) esc = false;
        else if (ch === '\\') esc = true;
        else if (ch === '"') inStr = false;
        continue;
      }
      if (ch === '"') { inStr = true; continue; }
      if (ch === open) depth++;
      else if (ch === close) {
        depth--;
        if (depth === 0) {
          try { return JSON.parse(t.slice(start, i + 1)); } catch { break; }
        }
      }
    }
  }
  return null;
}

// ------------------------------------------------------------------ M33 C-07 closed vocabularies
//
// "Served-model attestation for the local Claude transport (M33)". Every token below is a frozen
// literal; logic only ever compares against these, never builds one.

/** Why a call failed on the provider's side, read ONLY from exact membership of a typed stream
 *  field (the assistant `error` enum, or an integer `api_error_status`) — never from message,
 *  result, error-detail or stderr text (B5). Attempt metadata beside the closed transport class;
 *  window failures keep their codes. */
const AUTH = 'auth', BILLING = 'billing', RATE_LIMIT = 'rate_limit', MODEL_NOT_FOUND = 'model_not_found',
  INVALID_REQUEST = 'invalid_request', OUTPUT_TOKENS = 'output_tokens', OVERLOADED = 'overloaded',
  SERVER_ERROR = 'server_error', IDENTITY_MISMATCH = 'identity_mismatch', UNKNOWN_PROVIDER = 'unknown';
export const PROVIDER_CLASSES = Object.freeze([AUTH, BILLING, RATE_LIMIT, MODEL_NOT_FOUND, INVALID_REQUEST,
  OUTPUT_TOKENS, OVERLOADED, SERVER_ERROR, IDENTITY_MISMATCH, UNKNOWN_PROVIDER]);
/** Asking again cannot change these answers; the scripted runner (scripts/session-review.mjs) admits no further call
 *  after them.
 *  M33 refreeze: listed in the fixed precedence order — when any observed value of a call maps to one
 *  of these, the first one here that was observed is the call's class. */
export const NON_RETRYABLE_PROVIDER_CLASSES = Object.freeze([IDENTITY_MISMATCH, AUTH, BILLING, RATE_LIMIT,
  MODEL_NOT_FOUND, INVALID_REQUEST]);
/** The assistant `error` enum of the installed Claude Code 2.1.278 stream-json schema, member by
 *  member, to its class. A null prototype: `__proto__`, `constructor` and friends are not members. */
export const PROVIDER_ERROR_CLASS = Object.freeze(Object.assign(Object.create(null), {
  authentication_failed: AUTH, oauth_org_not_allowed: AUTH, account_on_hold: AUTH, verification_required: AUTH,
  cloud_credential_error: AUTH, billing_error: BILLING, rate_limit: RATE_LIMIT, model_not_found: MODEL_NOT_FOUND,
  invalid_request: INVALID_REQUEST, max_output_tokens: OUTPUT_TOKENS, overloaded: OVERLOADED,
  server_error: SERVER_ERROR, unknown: UNKNOWN_PROVIDER,
}));
/** M33 refreeze. An integer `api_error_status`, exact value to class, used only when no assistant
 *  carries an `error` enum value. Any other integer from 500 to 599 is `server_error`; every other
 *  value (a non-integer included) is `unknown`. A null prototype, like the enum map. */
export const API_ERROR_STATUS_CLASS = Object.freeze(Object.assign(Object.create(null), {
  400: INVALID_REQUEST, 401: AUTH, 402: BILLING, 403: AUTH, 404: MODEL_NOT_FOUND, 429: RATE_LIMIT, 529: OVERLOADED,
}));
const SERVER_ERROR_STATUS_MIN = 500, SERVER_ERROR_STATUS_MAX = 599;
/** M33 refreeze. An assistant field whose value is neither null nor false marks an API error; so does
 *  any non-null `api_error_status` (API_ERROR_STATUS_FIELD) on an assistant. */
export const API_ERROR_MARKER_FIELDS = Object.freeze(['is_api_error_message', 'api_error', 'api_error_code', 'aborted']);
const API_ERROR_STATUS_FIELD = 'api_error_status';

/** Whether a call's answer is proved to come from the requested model. `attested`: a claude-cli call
 *  that answered under a full requested id with every condition proved. `mismatch` (M33 refreeze):
 *  a call that failed on identity evidence — an init or a served model naming another id, a
 *  model-fallback event, an assistant that is not top-level, or an alias answer inconsistent with its
 *  init. `unattested`: everything else — an alias answer, any failure without identity evidence, and
 *  every codex-cli or anthropic-api call, whose stream cannot say. */
const ATTESTED = 'attested', MISMATCH = 'mismatch', UNATTESTED = 'unattested';
export const ATTESTATION_STATES = Object.freeze([ATTESTED, MISMATCH, UNATTESTED]);

/** `system` subtypes that mean another model answered, or was asked to; all four are in 2.1.278. */
export const MODEL_FALLBACK_SUBTYPES = Object.freeze(['model_fallback', 'model_consent_fallback',
  'model_refusal_fallback', 'model_refusal_no_fallback']);
const API_RETRY_SUBTYPE = 'api_retry';
/** The model string Claude Code writes on a message it built locally for an API error. */
export const SYNTHETIC_MODEL = '<synthetic>';
/** Recorded in place of a model value that is not a model id, so no stream text is ever recorded. */
export const UNRECOGNIZED_MODEL = '<unrecognized>';
/** A call refused, or stopped, because the review's signal aborted. Never retried. */
export const REVIEW_CANCELLED = 'review_cancelled';
/** A stopped child is sent SIGTERM, then SIGKILL after this fixed grace if it has not exited. */
export const KILL_GRACE_MS = 5000;
/** After SIGKILL, how long a stopped call still waits for its child's `close` before it destroys the
 *  child's stdio pipes (held open by a grandchild that inherited them) and settles without it. */
export const STDIO_GRACE_MS = 2000;
/** The effort every review call asks for; `claude --help` (2.1.278) lists it for `--effort`. */
export const REVIEW_EFFORT = 'high';

/**
 * D77 (H). The most output tokens one checker (challenge) call may produce through the claude CLI: a cost guard
 * against a reply that runs on, never a judgment rule, and never on a narrative call (the call that reads a window
 * proposes every row and has no bound). A readable challenge reply for a batch (at most
 * CHALLENGE_PROFILE.maxItemsPerBatch = 16 items) stays far below 16,384 output tokens; a reply that runs on instead
 * can reach the CLI's own ceiling for the model, 128,000 (its `max_output_tokens` default and upper bound for
 * `claude-sonnet-5-5`, 2.1.296, byte search of its bundle), plus a continuation, and minutes of time, for a reply that
 * is then not read. 32,768 = 2^15 is twice that 16,384 and about a quarter of that ceiling (4 x 32,768 = 131,072). One
 * frozen literal, like every bound here: no flag, no environment variable of Sonah's, no per-repo tuning.
 *
 * How it is applied: the CLI reads CLAUDE_CODE_MAX_OUTPUT_TOKENS from its environment as the `max_tokens` of each API
 * call (2.1.296: a value above the model's ceiling is capped to the ceiling, an invalid one ignored for the default;
 * the CLI never refuses the call over it). `localEnvironment` sets it on a challenge call only (`isChallengeRequest`),
 * so it changes no argv and so no answer key (answer-cache.js binds the argv, never the environment). What happens when
 * a reply hits it: the CLI stops that API call at the limit and, in print mode, may ask the model to continue up to
 * three times (its `maxOutputTokensRecoveryCount`, 2.1.296), each continuation bounded by the same number, so one
 * runaway call costs at most 4 x 32,768 output tokens. A continuation that answers whole is a complete reply; one that
 * does not read is `model_response_invalid` (the transport's one retry, then the challenge's one re-ask); when the
 * continuations are spent the stream carries the CLI's `max_output_tokens` error and the call fails
 * `model_response_incomplete` (`output_tokens`), which is never retried and never stored. Nothing cut is ever accepted
 * as an answer: the challenge reads only a reply that is a JSON object with the batch's own `votes` (batchVotes).
 * Codex and the API are unchanged: the installed Codex CLI has no model output-token setting (byte search, 0 hits),
 * and the API transport already sends REVIEW_API_MAX_TOKENS on every call, in its body and so in the key.
 */
export const CHALLENGE_MAX_OUTPUT_TOKENS = 32_768;
/** The claude CLI's environment setting for the most output tokens one API call may produce (2.1.296, byte search: its
 *  own stream text when a reply hits it reads "set the CLAUDE_CODE_MAX_OUTPUT_TOKENS environment variable"). */
const CLI_MAX_OUTPUT_TOKENS_VARIABLE = 'CLAUDE_CODE_MAX_OUTPUT_TOKENS';

/**
 * D77 (H). Whether a request is a checker (challenge) request, by structure: `challengeItems` (evidence/src/challenge.js)
 * sets a `challenge` record on every request it sends, a batch or a re-ask, and no narrative, re-ask-for-evidence or
 * probe request carries one. Never read from the label's wording.
 */
export const isChallengeRequest = (request) => isRecord(request) && isRecord(request.challenge);

/**
 * D78. A reply's JSON read as an answer, or null when it is none. An object is the answer as it came. On a challenge
 * request (`isChallengeRequest`), a bare non-empty list is read as the batch's `votes` when every element is a vote of
 * the request's own schema (only its fields, the required ones present: `request.schema`'s vote items) for one of the
 * batch's own keys (`request.challenge.items`): the model's most common unreadable reply (the votes list without its
 * object). Structure only, never wording; the challenge's own reader
 * (`batchVotes`) then reads it like any reply (each key once, each vote checked). Anything else (a list on any other
 * request, an empty list, an element that is not such a vote) stays `model_response_invalid`, and so is retried and
 * re-asked as before, never stored. The reply shape is recorded as it came (`array`).
 */
export function answerOf(json, request) {
  if (isRecord(json)) return json;
  if (!Array.isArray(json) || json.length === 0 || !isChallengeRequest(request)) return null;
  const vote = request.schema?.properties?.votes?.items;
  if (!isRecord(vote) || !isRecord(vote.properties) || !Array.isArray(vote.required)
      || !Array.isArray(request.challenge.items)) return null;
  const keys = new Set(request.challenge.items.map((item) => item?.key).filter((key) => typeof key === 'string'));
  const fields = Object.keys(vote.properties);
  const isVote = (element) => isRecord(element) && keys.has(element.key)
    && Object.keys(element).every((field) => fields.includes(field))
    && vote.required.every((field) => Object.hasOwn(element, field));
  return json.every(isVote) ? { votes: json } : null;
}

/** M33 J. The closed values a claude-cli `rate_limit_event`'s `status` and `rateLimitType` are kept as
 *  (count-only instrumentation). A value outside the list is recorded as its last member, `unknown`;
 *  an absent one as null. Nothing else of the event is kept but its utilizations and reset time (rateLimitOf): no text
 *  field, no identifier. The types are the CLI's own `rateLimitType` enum (2.1.296 added `seven_day_overage_included`),
 *  then `unknown`. */
export const RATE_LIMIT_STATUSES = Object.freeze(['allowed', 'allowed_warning', 'rejected', 'unknown']);
export const RATE_LIMIT_TYPES = Object.freeze(['five_hour', 'seven_day', 'seven_day_opus', 'seven_day_sonnet',
  'seven_day_overage_included', 'overage', 'unknown']);
/** M44. The usage windows a claude-cli `rate_limit_info.unifiedWindows` reports, each `{ utilization, resetsAt }`,
 *  under the names its own stream schema declares (2.1.296: these three); only each window's utilization is kept. From
 *  2.1.296 the CLI reports utilization there only, and the top-level `utilization` older versions report is absent. A
 *  window under any other name is kept as the last member, `other` (the highest such utilization); its name is never
 *  kept or read. */
export const RATE_LIMIT_WINDOWS = Object.freeze(['five_hour', 'seven_day', 'seven_day_overage_included', 'other']);
const OTHER_WINDOW = RATE_LIMIT_WINDOWS.at(-1);
const RATE_LIMIT_EVENT = 'rate_limit_event';
/** M33 J. The token counts of a call's `usage` the scripted runner keeps — numbers only, by these
 *  names, each null when it is not a count. Declared here, beside the stream that reports them. */
export const USAGE_TOKEN_FIELDS = Object.freeze(['input_tokens', 'output_tokens', 'cache_creation_input_tokens',
  'cache_read_input_tokens']);
/** M44. An attempt can be accepted by the CLI (exit 0, `success`, no tool use) and still fail
 *  `model_response_invalid`; no reply text is recorded, so the cause cannot be named from it. These closed lists describe an
 *  accepted claude-cli reply by structure only (count-only instrumentation, `replyShapeOf`: computed after the answer is
 *  decided, never deciding it). How extractJson (above) read the result's `result` text: `object` (the
 *  answer), `array` (its first bracket opened a top-level array), `unclosed` (a `{` or `[` the walk never closed),
 *  `unparsed` (closed, and JSON.parse refused it), `no_bracket` (no `{` or `[`), `empty` (white space or nothing),
 *  `absent` (no `result` string). */
export const REPLY_SHAPES = Object.freeze(['object', 'array', 'unclosed', 'unparsed', 'no_bracket', 'empty', 'absent']);
const [OBJECT_REPLY, ARRAY_REPLY, UNCLOSED_REPLY, UNPARSED_REPLY, NO_BRACKET_REPLY, EMPTY_REPLY, ABSENT_REPLY] = REPLY_SHAPES;
/** M44. A content block's `type` in the final assistant event, as the API names it; any other value is `other`. */
export const REPLY_BLOCK_TYPES = Object.freeze(['text', 'thinking', 'redacted_thinking', 'tool_use', 'other']);
const [TEXT_BLOCK] = REPLY_BLOCK_TYPES, OTHER_BLOCK = REPLY_BLOCK_TYPES.at(-1);
/** M44. How many of the final assistant event's block types a reply shape keeps, the last ones (the CLI reads the
 *  last); `finalBlockCount` counts them all, so a record stays small however many blocks the event carries. */
export const REPLY_FINAL_BLOCKS_KEPT = 8;
/** M44. The result event's `stop_reason`: the CLI's own list of the API's stop reasons (2.1.296, byte search of its
 *  bundle), then `tool_deferred`, which the CLI sets itself; any other value is `other`, an absent or null one null. */
export const REPLY_STOP_REASONS = Object.freeze(['end_turn', 'max_tokens', 'stop_sequence', 'tool_use', 'pause_turn',
  'compaction', 'refusal', 'model_context_window_exceeded', 'tool_deferred', 'other']);
const OTHER_STOP = REPLY_STOP_REASONS.at(-1);

const MODEL_VALUE = /^[a-zA-Z0-9][a-zA-Z0-9._:[\]-]{0,199}$/;
const FULL_MODEL_ID = /^claude-[a-z0-9]+(?:[-.][a-z0-9]+)*$/;
const VERSION_COMPONENT = /^\d+(?:\.\d+)?$/;
/** A model value a review may request, its context selector (below) taken off first. */
const REQUESTED_MODEL = /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,199}$/;

/**
 * D70 (a). The claude CLI's documented long-context selector, and the context window it selects, in tokens: a suffix
 * on a model id (Claude Code 2.1.278's own help: "/model sonnet[1m] for a 1M context window"; its model list reads
 * "`claude-sonnet-5[1m]` is shorthand for the same entry", "a 1M variant"). It is the CLI's context-window setting —
 * the CLI raises its own request limit to that window and asks the API for it — never part of the served model's
 * identity: the CLI's `init` names the id with the selector, and the API's answer names the id without it (a
 * `claude-sonnet-5-5[1m]` request is answered as `claude-sonnet-5-5`). A closed table of one frozen
 * literal; nothing else is read as a selector.
 */
export const CLI_CONTEXT_SELECTORS = Object.freeze({ '[1m]': 1_000_000 });

/** D70 (a). The context selector a model value ends with (a CLI_CONTEXT_SELECTORS member), or null. */
export function cliContextSelector(model) {
  if (typeof model !== 'string') return null;
  return Object.keys(CLI_CONTEXT_SELECTORS).find((selector) => model.length > selector.length && model.endsWith(selector))
    ?? null;
}

/** D70 (a). The model id that serves a request: the requested value without its context selector. */
export function servedModelId(model) {
  const selector = cliContextSelector(model);
  return selector ? model.slice(0, -selector.length) : model;
}

/** D70 (a). The context window a requested model value selects (its selector's), or null: the CLI's own default for
 *  the id. */
export function selectedContextWindow(model) {
  const selector = cliContextSelector(model);
  return selector ? CLI_CONTEXT_SELECTORS[selector] : null;
}

/** SemVer 2.0.0's normal version (semver.org, item 2): `X.Y.Z`, each a non-negative integer without leading zeros. */
const SEMVER_NORMAL_VERSION = /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)$/;
/**
 * D70 review (S0). The claude CLI's version as its `init` states it (`claude_code_version`), when it is a SemVer normal
 * version, else null. Count-only instrumentation, never deciding attestation: the selector's attestation shape (the
 * init names the requested value with the selector; every top-level assistant the id without it) and the window read
 * (the result's `modelUsage` keyed by the value as configured) were measured on Claude Code 2.1.278 only, and no
 * documentation states either, so a run records the version it ran on and `sonah doctor` checks the shape with one call
 * before a paid run.
 */
export function cliVersionOf(value) {
  return typeof value === 'string' && value.length <= 32 && SEMVER_NORMAL_VERSION.test(value) ? value : null;
}

/**
 * M33. Can a served model be attested against this requested id? Only a full first-party id — the
 * `claude-` prefix and a numeric version component, lowercase, no `latest` — names exactly one
 * model. An alias (`sonnet`, `opus`, `haiku`, `claude-sonnet`, `best`, …) is resolved by the CLI and
 * can never be proved equal to what served it. D70 (a): a full id with the CLI's context selector is
 * attestable as the id without it (`servedModelId`); an alias with one is not.
 */
export function attestableModel(model) {
  const id = servedModelId(model);
  if (typeof id !== 'string' || !FULL_MODEL_ID.test(id)) return false;
  const components = id.split('-').slice(1);
  return components.some((part) => VERSION_COMPONENT.test(part)) && !components.includes('latest');
}

/** A model value as it may be recorded: itself when it is a model id or `<synthetic>`, else a token. */
const recordedModel = (value) => (value === SYNTHETIC_MODEL || (typeof value === 'string' && MODEL_VALUE.test(value))
  ? value : UNRECOGNIZED_MODEL);
const isRecord = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

/**
 * M33. Stop a child: SIGTERM first (the CLI exits cleanly on it), then SIGKILL after KILL_GRACE_MS
 * unless it has exited by then. `close` waits for the child's stdio pipes too, and a grandchild that
 * inherited them can hold them open long after the child is gone: if `close` has still not come
 * STDIO_GRACE_MS after SIGKILL, the pipes are destroyed and `abandon` settles the call, so a stopped
 * call is bounded by its stop, KILL_GRACE_MS and STDIO_GRACE_MS. Returns a function that cancels
 * whichever timer is pending, which the caller runs on `close`.
 */
function stopChild(child, hasClosed, abandon) {
  try { child.kill('SIGTERM'); } catch { /* no untrusted process error escapes */ }
  let timer = setTimeout(() => {
    if (hasClosed()) return;
    try { child.kill('SIGKILL'); } catch { /* no untrusted process error escapes */ }
    timer = setTimeout(() => {
      if (hasClosed()) return;
      for (const pipe of [child.stdin, child.stdout, child.stderr])
        try { pipe?.destroy(); } catch { /* no untrusted process error escapes */ }
      abandon();
    }, STDIO_GRACE_MS);
  }, KILL_GRACE_MS);
  return () => clearTimeout(timer);
}

/**
 * M33 refreeze. Each in-flight call adds its own abort listener when it starts its work and removes
 * it when it settles, so nothing accumulates on a run-wide signal across calls or across judges (a
 * runner that builds one judge per call). An already-aborted signal runs the listener at once and
 * adds nothing.
 */
function cancellationOf(signal) {
  if (signal != null && (typeof signal.aborted !== 'boolean' || typeof signal.addEventListener !== 'function'
      || typeof signal.removeEventListener !== 'function'))
    throw new TypeError('signal must be an AbortSignal or null');
  return {
    get aborted() { return signal?.aborted === true; },
    register(listener) {
      if (signal == null) return () => {};
      if (signal.aborted) { listener(); return () => {}; }
      const onAbort = () => listener();
      signal.addEventListener('abort', onAbort, { once: true });
      return () => signal.removeEventListener('abort', onAbort);
    },
  };
}

/**
 * W3d-1. Why the local CLI failed, from what the process DID — our own stop, its exit status,
 * whether a result event arrived — never from what it printed. A window can fail
 * `model_unavailable` in every review, and the one field that could say why is deliberately not
 * recorded (B5), because the transport's text can carry the prompt or a credential.
 */
function localTransportClass({ stop, exitCode, result }) {
  if (stop === 'model_timeout') return 'timeout';
  if (stop === 'model_output_limit') return 'output_limit';
  // A non-zero code, or death by a signal this process did not send (`exitCode` is null then).
  if (exitCode !== 0) return 'exit_nonzero';
  if (result == null) return 'no_output';
  // Exit 0 with a result event that says it failed (`is_error`, or a subtype other than success).
  return 'unknown';
}
// M33: /3 — the claude-cli answer is attested, the argv pins `--effort`, and the environment disables
// refusal fallback and automatic memory. Answers stored under the unattested /2 transport never replay.
// D70 (a): not bumped. A plain id's argv, environment and attestation are byte for byte /3's, and an id with the CLI's
// context selector was refused before (`invalid_model`), so no answer is stored under one; the selector is in the
// model value and the argv, both of which the answer key binds (answer-cache.js), so a selected window never replays
// an answer asked without it, nor the reverse.
// D77 (H): not bumped. The checker's output-token limit (CHALLENGE_MAX_OUTPUT_TOKENS) rides in a challenge call's
// environment, never its argv, so no key moves; a narrative call's argv, environment and attestation stay byte for byte
// /3's. A stored answer is a complete reply the transport accepted, and the limit only turns a reply over it into a
// failure, which is never stored: an answer stored before the limit is one a replay costs no output for (the limit is
// a cost guard, D77, not a judgment rule), and one stored under it is complete without it.
// D78: not bumped. A challenge reply that is a bare list of the batch's votes is now read as `{ votes }` (`answerOf`);
// no argv, environment or body moves, so no key moves. A stored answer is always an object the transport accepted and
// is replayed as it was stored, never through answerOf: an answer stored before reads exactly as it did.
export const REVIEW_TRANSPORT_VERSION = 'sonah.review-transport/3';
export function reviewJudgeConfig(env = process.env, options = {}) {
  const backend = options.backend ?? env.SONAH_REVIEW_BACKEND ?? 'claude-cli';
  if (!['claude-cli', 'anthropic-api', 'codex-cli'].includes(backend)) throw failure('unsupported_backend');
  const model = options.model ?? env.SONAH_MODEL ?? (backend === 'claude-cli' ? 'sonnet' : null);
  // D70 (a): the CLI's context selector only on claude-cli, and only on a full id it can attest (`attestableModel`):
  // no other transport has the setting, and an alias's init could not be checked against it.
  const selector = cliContextSelector(model);
  if (!model || !REQUESTED_MODEL.test(servedModelId(model))
      || (selector !== null && (backend !== 'claude-cli' || !attestableModel(model)))) throw failure('invalid_model');
  if (backend === 'anthropic-api' && (!model.startsWith('claude-') || ['claude-sonnet', 'claude-opus', 'claude-haiku'].includes(model)))
    throw failure('explicit_api_model_required');
  return { backend, model, version: REVIEW_TRANSPORT_VERSION };
}

/** The claude CLI's environment setting that loads no CLAUDE.md file of any kind (2.1.296, byte search of its bundle:
 *  it gates the project, user and managed files alike, beside `--setting-sources`). */
const CLI_DISABLE_CLAUDE_MDS_VARIABLE = 'CLAUDE_CODE_DISABLE_CLAUDE_MDS';

// Only account/runtime environment reaches the subscription CLI. In particular API credentials,
// provider overrides, inherited Claude options and repository configuration cannot change billing.
// D77 (H): `request` decides one setting of Sonah's own, the checker's output-token limit (below); the
// person's own CLAUDE_CODE_MAX_OUTPUT_TOKENS, like every other inherited Claude option, never reaches a call.
function localEnvironment(env, request = null) {
  const clean = Object.fromEntries(['HOME', 'PATH', 'TMPDIR', 'LANG', 'LC_ALL', 'USER', 'LOGNAME', 'SHELL',
    'SSL_CERT_FILE', 'SSL_CERT_DIR', 'NODE_EXTRA_CA_CERTS'].filter((k) => env[k] != null).map((k) => [k, env[k]]));
  // Supported in print mode: skip the small/fast-model session-title request while preserving
  // subscription authentication and the primary review. https://code.claude.com/docs/en/env-vars
  // M33: the installed 2.1.278 binary reads both names below (byte search): refusal fallback is on
  // unless CLAUDE_CODE_DISABLE_REFUSAL_FALLBACK is set, and a truthy CLAUDE_CODE_DISABLE_AUTO_MEMORY
  // turns automatic memory off whatever the setting sources. A fallback reply would otherwise be
  // another model's answer under the requested model's name.
  return { ...clean, CLAUDE_CODE_DISABLE_TERMINAL_TITLE: '1', CLAUDE_CODE_DISABLE_REFUSAL_FALLBACK: '1',
    CLAUDE_CODE_DISABLE_AUTO_MEMORY: '1',
    // D77 (H): the checker's output-token limit, on a challenge call only (CHALLENGE_MAX_OUTPUT_TOKENS).
    ...(isChallengeRequest(request) ? { [CLI_MAX_OUTPUT_TOKENS_VARIABLE]: String(CHALLENGE_MAX_OUTPUT_TOKENS) } : {}),
    // The agent transport: an agent request runs in a repository, whose CLAUDE.md files the CLI would otherwise load as
    // the agent's own instructions. The agent reads them with its tools, as evidence, never as instructions.
    ...(isAgentRequest(request) ? { [CLI_DISABLE_CLAUDE_MDS_VARIABLE]: '1' } : {}) };
}

// Keep the desktop CLI's account location, but no API credentials, provider endpoint overrides,
// inherited tool/configuration switches, or proxy settings. `--ignore-user-config` still uses
// CODEX_HOME for authentication (as the native CLI's own help states).
function codexEnvironment(env) {
  return Object.fromEntries(['HOME', 'CODEX_HOME', 'PATH', 'TMPDIR', 'LANG', 'LC_ALL', 'USER', 'LOGNAME', 'SHELL']
    .filter((key) => env[key] != null).map((key) => [key, env[key]]));
}

// The file path is deliberately relative to each private cwd. The actual cwd is fresh on every
// call, while argv is stable and can be bound byte-for-byte by D60's answer key.
const CODEX_INSTRUCTIONS_FILE = 'instructions.txt';

/**
 * Gain I (2026-10-13; C-05 "Gain I"): a request's images (`request.images`, evidence images.js `requestImages`),
 * checked before any transport sends them: a list of at most REQUEST_IMAGE_LIMITS.maxImages, each `{ mediaType, data }`
 * of an accepted media type and canonical base64 within the per-image cap, all within the request's cap. `[]` for a
 * request that carries none; null for a list a transport must refuse (`invalid_model_input`), never send in part.
 */
export function requestImagesOf(request) {
  if (request?.images === undefined) return [];
  const images = request.images;
  const limits = REQUEST_IMAGE_LIMITS;
  if (!Array.isArray(images) || images.length > limits.maxImages) return null;
  let chars = 0;
  for (const image of images) {
    if (image === null || typeof image !== 'object' || !limits.mediaTypes.includes(image.mediaType)
      || typeof image.data !== 'string' || !image.data || image.data.length % 4 !== 0
      || image.data.length > limits.maxBase64Chars || !/^[A-Za-z0-9+/]*={0,2}$/.test(image.data)) return null;
    chars += image.data.length;
  }
  return chars <= limits.maxTotalBase64Chars ? images.map(({ mediaType, data }) => ({ mediaType, data })) : null;
}

/** Gain I: the images a request is sent with on `backend` — its checked images (`requestImagesOf`), `[]` when it
 *  carries none — or null when it must be refused (`invalid_model_input`): images a request cannot carry, or any image
 *  on a backend whose transport sends none (not one of IMAGE_BACKENDS). A request is never sent without its images:
 *  its scope was built as though they were shown. */
export function sendableImages(request, backend) {
  const images = requestImagesOf(request);
  return images === null || (images.length > 0 && !IMAGE_BACKENDS.includes(backend)) ? null : images;
}

/** Gain I: the file a codex-cli call attaches its `n`th image (from 1) as, in its private cwd: relative and fixed, so
 *  the argv stays stable for D60's answer key; the extension is the media type's. */
const CODEX_IMAGE_EXTENSIONS = Object.freeze({ 'image/jpeg': 'jpg', 'image/png': 'png', 'image/gif': 'gif',
  'image/webp': 'webp' });
export const codexImageFile = (n, mediaType) => `image-${n}.${CODEX_IMAGE_EXTENSIONS[mediaType]}`;

/** `images`: the request's checked images (`requestImagesOf`); with none the argv is byte for byte as before. Gain I:
 *  each image is attached to the prompt by the installed CLI's own flag (`codex exec --help`: "-i, --image <FILE>...
 *  Optional image(s) to attach to the initial prompt"), one `--image <file>` pair each, placed straight after `exec`
 *  so the next flag ends the option's values and none of them is read as the prompt. */
export function reviewCodexArgs({ model, images = [] }) {
  const args = codexJudgeArgs(model, CODEX_INSTRUCTIONS_FILE);
  // codexJudgeArgs (codex-model.js) still emits this legacy key, which the legacy compiler's
  // transport used. The current native desktop CLI reports it as an error item, even though a later turn may
  // complete. Keep review's fixed argv valid without changing the shared argv's bytes.
  const retiredViewImage = args.findIndex((arg, index) => arg === '-c' && args[index + 1] === 'tools.view_image=false');
  if (retiredViewImage !== -1) args.splice(retiredViewImage, 2);
  args.splice(args.length - 1, 0, '--ignore-rules');
  if (Array.isArray(images) && images.length)
    args.splice(args.indexOf('exec') + 1, 0, ...images.flatMap((image, at) => ['--image',
      codexImageFile(at + 1, image.mediaType)]));
  return args;
}
/** `images` (Gain I): whether the request carries images. With none the argv is byte for byte as before; with some the
 *  request is one stream-json user message on stdin (`claudeStreamInput`): `--input-format stream-json`, which the
 *  installed CLI accepts only with `--print` and `--output-format stream-json` (its own checks, and `claude --help`).
 */
export function reviewCliArgs({ system, model, images = false }) {
  return ['--print', '--model', model, '--effort', REVIEW_EFFORT, '--output-format', 'stream-json', '--verbose',
    ...(images ? ['--input-format', 'stream-json'] : []),
    '--include-partial-messages', '--tools', '', '--disable-slash-commands',
    '--setting-sources', '', '--mcp-config', '{"mcpServers":{}}', '--strict-mcp-config',
    '--no-session-persistence', '--system-prompt', system];
}

// ------------------------------------------------------------------------------------ the agent transport
//
// A request that carries `agent` is an agent request: Claude Code runs it as an agent with three read-only tools over a
// repository, for as many turns as `agent.maxTurns` allows, and answers through the CLI's structured output tool
// (`--json-schema`, the request's own `schema`). Only claude-cli has it; every other request, on every backend, is sent
// exactly as before (reviewCliArgs, REVIEW_TRANSPORT_VERSION).

/** Its version, bound in the answer key of agent requests only (answer-cache.js); REVIEW_TRANSPORT_VERSION stays the
 *  version of every other request. A change to the agent argv, its environment or how its answer is read is a new
 *  version. /2 (D105, F2 part A3): the run record also holds each Read's path, start line, line count and the file's
 *  total lines, from the CLI's typed tool results (`readRanges`, `readsUnranged`), and each Read that read nothing apart
 *  (`readsFailed`), and the answer store keeps it beside the answer; no stored agent answer of /1 replays. */
export const REVIEW_AGENT_TRANSPORT_VERSION = 'sonah.review-agent-transport/2';
/** The tools an agent request is given (`--tools`, `--allowedTools`): it can read and search, never write or run. */
export const AGENT_TOOLS = Object.freeze(['Read', 'Grep', 'Glob']);
/** The tool through which the CLI returns a `--json-schema` answer (2.1.296: a `tool_use` of this name in the stream,
 *  and the answer as the result event's `structured_output`). */
export const STRUCTURED_OUTPUT_TOOL = 'StructuredOutput';
/** The tool names an agent request may use, each counted by name (`agentRunOf`); a tool use of any other name, and any
 *  tool use on a request that is not an agent request, fails the call `model_tool_use`. */
export const AGENT_TOOL_NAMES = Object.freeze([...AGENT_TOOLS, STRUCTURED_OUTPUT_TOOL]);
/** The most stdout one agent call may print, in place of the judge's bound (createReviewJudge's `maxOutputBytes`, 16 MiB
 *  by default). The CLI prints every tool result twice in its stream (the message and its `tool_use_result`), so a run
 *  of many Reads prints far more than a one-reply call; four times that default. */
export const AGENT_MAX_OUTPUT_BYTES = 64 * 1024 * 1024;
/** The result subtypes the CLI ends an agent run with when it stops it, each to its closed failure code (ledger.js
 *  JUDGE_FAILURE_CODES) and its transport class (run-review.js TRANSPORT_SHORTFALL). Read from the one result event's
 *  typed `subtype`, never from its text, and on an agent call only. Neither is retried: an identical request runs into
 *  the same limit. */
export const AGENT_RESULT_FAILURES = Object.freeze(Object.assign(Object.create(null), {
  error_max_turns: Object.freeze({ code: 'model_turn_limit', transportClass: 'turn_limit' }),
  error_max_structured_output_retries: Object.freeze({ code: 'model_structured_output_failed',
    transportClass: 'structured_output_failed' }) }));
/** The options the agent argv adds that an older Claude Code may not have (doctor.js checks them once, with no call). */
export const AGENT_CLI_OPTIONS = Object.freeze(['--restricted', '--max-turns', '--json-schema']);
/** The members `request.agent` may have. `root`: the absolute path of an existing directory, the agent's working
 *  directory; `addDirs`: absolute paths of existing directories the agent may also read (default none); `maxTurns`: a
 *  positive whole number, the CLI's `--max-turns`; `timeoutMs`: a positive whole number of milliseconds, the call's own
 *  timeout in place of the judge's. */
const AGENT_FIELDS = Object.freeze(['root', 'addDirs', 'maxTurns', 'timeoutMs']);
/** Node's timer range: a longer timeout would fire at once. */
const MAX_TIMEOUT_MS = 2_147_483_647;

/** Whether a request is an agent request: it carries `agent` at all. A malformed one is still an agent request, and is
 *  refused (`invalid_model_input`), never sent without its tools or sent as a session request. */
export const isAgentRequest = (request) => isRecord(request) && request.agent !== undefined;

const absolutePath = (value) => typeof value === 'string' && value.length > 0 && !value.includes('\0') && isAbsolute(value);
const positiveWhole = (value, max = Number.MAX_SAFE_INTEGER) => Number.isSafeInteger(value) && value > 0 && value <= max;

/** An agent request's `agent` and `schema`, checked by shape (`{ root, addDirs, maxTurns, timeoutMs, schema }`, addDirs
 *  defaulting to none and timeoutMs to null), or null when the request is no agent request the transport can send:
 *  `agent` is not a record of AGENT_FIELDS members with valid values, or `schema` is not a JSON object. Whether the
 *  directories exist is checked when the call is made (createReviewJudge). */
export function agentRequestOf(request) {
  if (!isAgentRequest(request)) return null;
  const { agent, schema } = request;
  if (!isRecord(agent) || Object.keys(agent).some((key) => !AGENT_FIELDS.includes(key))) return null;
  const addDirs = agent.addDirs === undefined ? [] : agent.addDirs;
  if (!absolutePath(agent.root) || !Array.isArray(addDirs) || !addDirs.every(absolutePath)
      || !positiveWhole(agent.maxTurns)
      || !(agent.timeoutMs === undefined || positiveWhole(agent.timeoutMs, MAX_TIMEOUT_MS))) return null;
  let schemaText;
  try { schemaText = JSON.stringify(schema); } catch { return null; }
  if (!isRecord(schema) || typeof schemaText !== 'string' || schemaText.includes('\0')) return null;
  return { root: agent.root, addDirs: [...addDirs], maxTurns: agent.maxTurns, timeoutMs: agent.timeoutMs ?? null, schema };
}

/**
 * The agent argv: the tool-free argv's settings isolation (no slash commands, no setting sources, no MCP server, no
 * persisted session, Sonah's system prompt in argv and the prompt on stdin), with three read-only tools allowed without
 * a prompt (`dontAsk`, `--permission-prompts none`), confined to the working directory and each `--add-dir` (`--restricted`:
 * a Read outside them, through a link included, is refused), at most `agent.maxTurns` turns, and the answer through the
 * CLI's structured output tool (`--json-schema`). No `--include-partial-messages`: nothing reads a partial message. The
 * system prompt comes last, as in reviewCliArgs.
 */
export function reviewAgentCliArgs({ system, model, agent, schema }) {
  return ['--print', '--model', model, '--effort', REVIEW_EFFORT, '--output-format', 'stream-json', '--verbose',
    '--tools', AGENT_TOOLS.join(','), '--allowedTools', ...AGENT_TOOLS,
    '--permission-mode', 'dontAsk', '--permission-prompts', 'none', '--restricted',
    ...(agent.addDirs ?? []).flatMap((dir) => ['--add-dir', dir]), '--max-turns', String(agent.maxTurns),
    '--json-schema', JSON.stringify(schema),
    '--disable-slash-commands', '--setting-sources', '', '--mcp-config', '{"mcpServers":{}}', '--strict-mcp-config',
    '--no-session-persistence', '--system-prompt', system];
}

/** The options of the agent argv whose value is left out of the answer key: an absolute path (`--add-dir`), so a moved
 *  checkout still replays, and the system prompt, which the key binds already. */
const AGENT_UNKEYED_VALUES = Object.freeze(['--add-dir', '--system-prompt']);

/** The agent argv as the answer key binds it (answer-cache.js): every argument in order, each AGENT_UNKEYED_VALUES
 *  option kept and its one value left out. Read left to right, so a value is never taken for an option. */
export function reviewAgentKeyArgs(argv) {
  const kept = [];
  for (let at = 0; at < argv.length; at++) {
    kept.push(argv[at]);
    if (AGENT_UNKEYED_VALUES.includes(argv[at])) at++;
  }
  return kept;
}

/** Gain I: a request's text and images as the content of one user message, the shape both the Messages API and the
 *  CLI's stream-json input read: the prompt, then each image after a line naming it ("Image 1:", as the prompt numbers
 *  them, prompt.js `IMAGES_ATTACHED`). */
export function imageContent(prompt, images) {
  return [{ type: 'text', text: prompt }, ...images.flatMap((image, at) => [{ type: 'text', text: `Image ${at + 1}:` },
    { type: 'image', source: { type: 'base64', media_type: image.mediaType, data: image.data } }])];
}

/** Gain I: the one stdin line of a claude-cli request with images: a stream-json user message (the shape the installed
 *  CLI's stream-json reader takes: `type` user, `message.role` user, `message.content` a list), newline-terminated. */
export function claudeStreamInput(prompt, images) {
  return `${JSON.stringify({ type: 'user', message: { role: 'user', content: imageContent(prompt, images) } })}\n`;
}

// W3f-2 / F227. The API transport's fixed arguments: where it sends, the API version it names, and
// every body field beside the request's own `system` and `prompt`. `callApi` sends exactly these.
export const REVIEW_API_URL = 'https://api.anthropic.com/v1/messages';
export const REVIEW_API_VERSION = '2023-06-01';
export const REVIEW_API_MAX_TOKENS = 16384;
/** The API request body, exactly as `callApi` sends it. Gain I: a request's images (`requestImagesOf`) as image blocks
 *  of its one user message (`imageContent`); with none the body is byte for byte as before. */
export function reviewApiBody({ system, prompt, model, images = [] }) {
  return { model, max_tokens: REVIEW_API_MAX_TOKENS, system,
    messages: [{ role: 'user',
      content: Array.isArray(images) && images.length ? imageContent(prompt, images) : prompt }] };
}

/**
 * W3f-2 / F227. Every argument a transport sends for one request beside the prompt, built by the
 * same functions the transport calls — the CLI's argv (`reviewCliArgs`), or the API's URL, version
 * header and body less its messages (`reviewApiBody`). The answer key binds this (answer-cache.js),
 * so an argument changed without a REVIEW_TRANSPORT_VERSION bump can never replay an answer given
 * under another. Never the credential or the environment: neither changes what the model is asked.
 * `null` for a backend this module has no transport for.
 * The agent transport: with `agent` and `schema` (an agent request's, `agentRequestOf`), the agent argv the call is
 * spawned with (`reviewAgentCliArgs`), on claude-cli only; null on any other backend, which has no agent transport.
 */
export function reviewTransportArguments({ backend, model, system, images = [], agent = undefined, schema = undefined }) {
  if (agent !== undefined)
    return backend === 'claude-cli' ? { argv: reviewAgentCliArgs({ system, model, agent, schema }) } : null;
  if (backend === 'claude-cli') return { argv: reviewCliArgs({ system, model, images: images.length > 0 }) };
  if (backend === 'codex-cli') return { argv: reviewCodexArgs({ model, images }), instructions: system };
  if (backend === 'anthropic-api') {
    const { messages: omitted, ...body } = reviewApiBody({ system, prompt: '', model });
    return { url: REVIEW_API_URL, version: REVIEW_API_VERSION, body };
  }
  return null;
}

// The stream may contain private text in agent messages, errors, IDs and stderr. Only numeric
// usage and closed status/count fields leave this function as instrumentation.
function codexUsage(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
  const usage = Object.fromEntries(['input_tokens', 'cached_input_tokens', 'output_tokens', 'total_tokens']
    .filter((key) => Number.isSafeInteger(value[key]) && value[key] >= 0).map((key) => [key, value[key]]));
  return Object.keys(usage).length ? usage : null;
}

async function callCodexLocal(request, config, { env, spawnProcess, timeoutMs, maxOutputBytes, cancellation }) {
  let directory;
  try {
    directory = await mkdtemp(join(tmpdir(), 'sonah-review-codex-'));
    await chmod(directory, 0o700);
    await writeFile(join(directory, CODEX_INSTRUCTIONS_FILE), request.system,
      { encoding: 'utf8', mode: 0o600, flag: 'wx' });
    // Gain I: each image the request carries, as its file in the same private directory (owner-only, removed below).
    for (const [at, image] of requestImagesOf(request).entries())
      await writeFile(join(directory, codexImageFile(at + 1, image.mediaType)), Buffer.from(image.data, 'base64'),
        { mode: 0o600, flag: 'wx' });
  } catch {
    if (directory) await rm(directory, { recursive: true, force: true }).catch(() => {});
    return { ok: false, code: 'model_unavailable', transportClass: 'spawn_failed' };
  }
  // M33: an abort that arrived while the private directory was being written starts nothing.
  if (cancellation.aborted) {
    await rm(directory, { recursive: true, force: true }).catch(() => {});
    throw failure(REVIEW_CANCELLED);
  }

  let result;
  try {
    result = await new Promise((resolve) => {
      let child, done = false, pending = '', bytes = 0, stderrBytes = 0, completed = false, failed = false;
      let invalid = false, message = null, usage = null, stop = null, stopClass = null, stdinFinished = false, stdinFailed = false;
      let closed = false, cancelGrace = () => {}, unregister = () => {};
      const toolIds = new Set();
      let unnamedTools = 0;
      const metadata = (exitCode = null) => ({ usage, modelUsage: null, costUsd: null,
        reportedModels: [], toolUse: toolIds.size + unnamedTools, exitCode });
      let timer;
      const finish = (outcome) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        unregister();
        resolve(outcome);
      };
      const stopped = (exitCode = null) => ({ ok: false, code: stop, ...(stopClass ? { transportClass: stopClass } : {}),
        ...metadata(exitCode) });
      // Our own stop, recorded once: SIGTERM first, SIGKILL only if it has not exited after the fixed
      // grace. M33 refreeze: the call settles only on the child's `close`, so the private cwd is not
      // removed under a live child, a retry never overlaps it, and a limiter slot bounds live processes
      // — unless `close` never comes because a grandchild holds the pipes: then the call settles a
      // fixed grace after SIGKILL, its pipes destroyed (stopChild, M33 G1).
      const terminate = (why, transportClass = null) => {
        if (done || stop) return;
        stop = why;
        stopClass = transportClass;
        if (!child || closed) { finish(stopped()); return; }
        cancelGrace = stopChild(child, () => closed, () => finish(stopped()));
      };
      const eventLine = (line) => {
        if (!line.trim()) return;
        let event;
        try { event = JSON.parse(line); } catch { invalid = true; return; }
        if (!event || Array.isArray(event) || typeof event !== 'object' || typeof event.type !== 'string') {
          invalid = true; return;
        }
        if (event.type.startsWith('item.')) {
          if (completed) invalid = true;
          const item = event.item;
          // Codex also uses item events for diagnostics. They are not tool calls, but a review
          // with an error item is still not a clean completed answer; never surface its text.
          if (item?.type === 'error') { failed = true; return; }
          if (!item || typeof item !== 'object' || Array.isArray(item) ||
              !['agent_message', 'reasoning'].includes(item.type)) {
            if (typeof item?.id === 'string') toolIds.add(item.id);
            else unnamedTools++;
            terminate('model_tool_use');
            return;
          }
          if (event.type === 'item.completed' && item.type === 'agent_message')
            message = typeof item.text === 'string' ? item.text : null;
          else if (!['item.started', 'item.updated', 'item.completed'].includes(event.type)) invalid = true;
          return;
        }
        if (event.type === 'turn.completed') {
          if (completed) invalid = true;
          completed = true;
          usage = codexUsage(event.usage);
        } else if (event.type === 'turn.failed' || event.type === 'error') failed = true;
        else if (!['thread.started', 'turn.started'].includes(event.type)) invalid = true;
      };
      try {
        child = spawnProcess(codexExecutable(env), reviewCodexArgs({ model: config.model,
          images: requestImagesOf(request) }), {
          cwd: directory, env: codexEnvironment(env), stdio: ['pipe', 'pipe', 'pipe'],
        });
        child.stdin.on('finish', () => { stdinFinished = true; });
        child.stdin.on('error', () => { stdinFailed = true; terminate('model_unavailable', 'unknown'); });
        child.stdout.setEncoding('utf8');
        child.stdout.on('data', (chunk) => {
          if (done || stop) return;
          bytes += Buffer.byteLength(chunk, 'utf8');
          if (bytes > maxOutputBytes) { terminate('model_output_limit', 'output_limit'); return; }
          pending += chunk;
          let newline;
          while (!done && !stop && (newline = pending.indexOf('\n')) !== -1) {
            const line = pending.slice(0, newline);
            pending = pending.slice(newline + 1);
            eventLine(line);
          }
        });
        child.stderr.on('data', (chunk) => {
          if (done || stop) return;
          stderrBytes += Buffer.byteLength(chunk);
          if (stderrBytes > maxOutputBytes) terminate('model_output_limit', 'output_limit');
        });
        child.on('error', () => finish({ ok: false, code: 'model_unavailable', transportClass: 'spawn_failed', ...metadata() }));
        child.on('close', (exitCode) => {
          closed = true;
          cancelGrace();
          if (done) return;
          if (stop) return finish(stopped(exitCode));
          if (pending) eventLine(pending);
          if (done) return; // A tool item on the unterminated last line has already settled the call.
          const common = metadata(exitCode);
          if (stdinFailed || !stdinFinished)
            return finish({ ok: false, code: 'model_unavailable', transportClass: 'unknown', ...common });
          if (exitCode !== 0) return finish({ ok: false, code: 'model_unavailable', transportClass: 'exit_nonzero', ...common });
          if (failed) return finish({ ok: false, code: 'model_unavailable', transportClass: 'unknown', ...common });
          if (invalid) return finish({ ok: false, code: 'model_response_invalid', ...common });
          if (message === null) return finish({ ok: false, code: 'model_unavailable', transportClass: 'no_output', ...common });
          if (!completed) return finish({ ok: false, code: 'model_response_incomplete', ...common });
          let json;
          try { json = JSON.parse(message.trim()); } catch { /* a fenced or partial object is not a completed JSON reply */ }
          // D78: an object, or on a challenge request a bare list of votes (`answerOf`).
          const answer = answerOf(json, request);
          if (answer === null) return finish({ ok: false, code: 'model_response_invalid', ...common });
          finish({ ok: true, json: answer, ...common });
        });
        timer = setTimeout(() => terminate('model_timeout', 'timeout'), timeoutMs);
        unregister = cancellation.register(() => terminate(REVIEW_CANCELLED));
        child.stdin.end(request.prompt);
      } catch {
        try { child?.kill('SIGKILL'); } catch { /* suppress untrusted process text */ }
        finish({ ok: false, code: 'model_unavailable', transportClass: 'spawn_failed', ...metadata() });
      }
    });
  } finally {
    try { await rm(directory, { recursive: true, force: true }); }
    catch { return { ok: false, code: 'model_unavailable', transportClass: 'unknown' }; }
  }
  return result;
}

/**
 * M33. Everything the claude-cli stream says about who answered, read from typed fields of parsed
 * events only. No text field (content, result, errors, error details, cwd) is kept: the counts,
 * the enum values, the status values and the model values below are all that leave this function
 * (D70 review: and the init's CLI version, kept by its caller only as a SemVer normal version).
 * The agent transport: and the paths an agent asked its Read tool for (`reads`); since /2, each Read's lines from the
 * CLI's typed tool result (`readRanges`: `readRange`), and the Reads whose tool result the CLI typed as an error
 * (`readErrors`).
 */
function readClaudeStream(output) {
  // The agent transport: `toolNames` counts tool uses by name, for AGENT_TOOL_NAMES members only (an unnamed tool use,
  // or one of another name, is counted in `toolUse` alone, so it is never allowed); `reads` holds the distinct paths the
  // Read tool was asked for, in the order first asked; `readUses` the ids of those Read uses, each with the path it asked
  // for (or null), `readRanges` the range of each, by id, once, in the order its result came, and `readErrors` the ids
  // of those whose tool result the CLI typed `is_error: true` (a Read that failed: it read nothing).
  const stream = { inits: 0, initModels: [], initVersions: [], topLevelModels: [], nestedModels: [], toolUse: 0, syntheticMessages: 0,
    apiErrorMarkers: 0, errorValues: [], errorStatuses: [], fallbacks: 0, apiRetries: 0, results: [],
    reportedModels: new Set(), rateLimit: null, toolNames: new Map(), reads: new Set(), readUses: new Map(),
    readRanges: new Map(), readErrors: new Set() };
  const present = (event, field) => Object.hasOwn(event, field) && event[field] !== null;
  for (const line of output.split('\n')) {
    let event;
    try { event = JSON.parse(line); } catch { continue; }
    if (!isRecord(event) || typeof event.type !== 'string') continue;
    // Unchanged pre-M33 instrumentation: every top-level `model` (the init's configured model) and
    // every assistant's `message.model`. `servedModels` is the attested subset.
    if (typeof event.model === 'string') stream.reportedModels.add(event.model);
    if (event.type === 'system') {
      if (event.subtype === 'init') { stream.inits++; stream.initModels.push(event.model); stream.initVersions.push(event.claude_code_version); }
      else if (MODEL_FALLBACK_SUBTYPES.includes(event.subtype)) stream.fallbacks++;
      else if (event.subtype === API_RETRY_SUBTYPE) stream.apiRetries++;
    } else if (event.type === 'assistant') {
      const message = isRecord(event.message) ? event.message : {};
      if (typeof message.model === 'string') stream.reportedModels.add(message.model);
      for (const block of Array.isArray(message.content) ? message.content : []) {
        if (!isRecord(block) || block.type !== 'tool_use') continue;
        stream.toolUse++;
        if (!AGENT_TOOL_NAMES.includes(block.name)) continue;
        stream.toolNames.set(block.name, (stream.toolNames.get(block.name) ?? 0) + 1);
        if (block.name === 'Read' && typeof block.id === 'string') stream.readUses.set(block.id, isRecord(block.input)
          && typeof block.input.file_path === 'string' ? block.input.file_path : null);
        if (block.name === 'Read' && isRecord(block.input) && typeof block.input.file_path === 'string')
          stream.reads.add(block.input.file_path);
      }
      if (message.model === SYNTHETIC_MODEL) stream.syntheticMessages++;
      // M33 refreeze: a marker is any marker field neither null nor false, or any non-null status.
      const status = present(event, API_ERROR_STATUS_FIELD);
      if (status || API_ERROR_MARKER_FIELDS.some((field) => present(event, field) && event[field] !== false))
        stream.apiErrorMarkers++;
      if (status) stream.errorStatuses.push(event[API_ERROR_STATUS_FIELD]);
      if (Object.hasOwn(event, 'error')) stream.errorValues.push(event.error);
      // M33 refreeze: the transport has no tools, so every assistant must be top-level — a
      // `parent_tool_use_id` present and null. A missing or any other value (false, an id) is nested.
      // The agent transport's tools start no agent of their own (no Task tool), so the same holds there.
      if (event.parent_tool_use_id === null) stream.topLevelModels.push(message.model);
      else stream.nestedModels.push(message.model);
    } else if (event.type === 'user') {
      // /2: a Read's lines, from the typed result the CLI prints beside its tool result (`readRange`); and each tool
      // result of a Read use of this run that the CLI typed as an error, by its own block, whatever else the message holds.
      const range = readRange(event, stream.readUses);
      if (range && !stream.readRanges.has(range.id)) stream.readRanges.set(range.id, range.range);
      for (const block of isRecord(event.message) && Array.isArray(event.message.content) ? event.message.content : [])
        if (isRecord(block) && block.type === 'tool_result' && block.is_error === true
          && stream.readUses.has(block.tool_use_id)) stream.readErrors.add(block.tool_use_id);
    } else if (event.type === 'result') {
      stream.results.push(event);
      if (present(event, API_ERROR_STATUS_FIELD)) stream.errorStatuses.push(event[API_ERROR_STATUS_FIELD]);
    } else if (event.type === RATE_LIMIT_EVENT) stream.rateLimit = rateLimitOf(event);
  }
  return stream;
}

/**
 * The agent transport /2 (D105): the lines one Read returned, from a user event of the stream, by the CLI's typed
 * fields only (Claude Code 2.1.296: `tool_use_result.file` with `filePath`, `startLine`, `numLines` and `totalLines`
 * beside the tool result): `{ id, range: { path, startLine, numLines, totalLines } }`, or null. Only an event whose
 * message holds exactly one tool result, for a Read use of this run (`readUses`), is read: the typed result then
 * belongs to it by structure. A result of any other shape (an image, a format change) gives none, and that Read counts
 * as unranged; a Read that failed (`readErrors`, or refused) is apart, whatever range its result gives (`agentRunOf`).
 * No text of the file is kept.
 */
function readRange(event, readUses) {
  const content = isRecord(event.message) && Array.isArray(event.message.content) ? event.message.content : [];
  const results = content.filter((block) => isRecord(block) && block.type === 'tool_result');
  if (results.length !== 1 || !readUses.has(results[0].tool_use_id)) return null;
  const file = isRecord(event.tool_use_result) && isRecord(event.tool_use_result.file) ? event.tool_use_result.file : null;
  const count = (n) => Number.isSafeInteger(n) && n >= 0;
  if (!file || typeof file.filePath !== 'string' || !file.filePath || !Number.isSafeInteger(file.startLine)
    || file.startLine < 1 || !count(file.numLines) || !count(file.totalLines)) return null;
  return { id: results[0].tool_use_id, range: { path: file.filePath, startLine: file.startLine, numLines: file.numLines,
    totalLines: file.totalLines } };
}

/** A utilization: a finite non-negative number, else null (a string is never parsed). One above 1 is kept: the CLI's
 *  schema states usage can legitimately run past a window's cap, and such a reading must still stop a review asked to
 *  stop below it. */
const utilizationOf = (value) => (Number.isFinite(value) && value >= 0 ? value : null);

/** M44. `[name, utilization]` pairs as `{ window: utilization }` under RATE_LIMIT_WINDOWS names, in that order: a
 *  name outside the list counts as `other`, which keeps the highest; a pair with no utilization is skipped. Null when no
 *  window has one. */
function windowsOf(pairs) {
  const highest = new Map();
  for (const [name, value] of pairs) {
    const utilization = utilizationOf(value);
    if (utilization === null) continue;
    const window = RATE_LIMIT_WINDOWS.includes(name) ? name : OTHER_WINDOW;
    highest.set(window, Math.max(highest.get(window) ?? 0, utilization));
  }
  return highest.size === 0 ? null : Object.fromEntries(RATE_LIMIT_WINDOWS.filter((window) => highest.has(window))
    .map((window) => [window, highest.get(window)]));
}

function closedRateLimit(fields, windowPairs) {
  const closed = (value, vocabulary) => (value == null ? null : vocabulary.includes(value) && typeof value === 'string'
    ? value : vocabulary.at(-1));
  return { status: closed(fields.status, RATE_LIMIT_STATUSES), rateLimitType: closed(fields.rateLimitType, RATE_LIMIT_TYPES),
    utilization: utilizationOf(fields.utilization),
    resetsAt: Number.isSafeInteger(fields.resetsAt) && fields.resetsAt >= 0 ? fields.resetsAt : null,
    windows: windowsOf(windowPairs) };
}

/** M33 J. One `rate_limit_event`'s closed and numeric fields, from its `rate_limit_info` (or, when it
 *  carries none, the event itself): the status and window type as RATE_LIMIT_STATUSES and
 *  RATE_LIMIT_TYPES members, the top-level utilization (older CLIs: the currently limiting window's) as a
 *  finite non-negative number and the reset time as a non-negative integer — each null when absent or not
 *  of its type — and (M44) `windows`, each `unifiedWindows` window's utilization (windowsOf), or null. */
export function rateLimitOf(event) {
  const info = isRecord(event.rate_limit_info) ? event.rate_limit_info : Object.hasOwn(event, 'rate_limit_info') ? {} : event;
  const unified = isRecord(info.unifiedWindows) ? Object.entries(info.unifiedWindows) : [];
  return closedRateLimit(info, unified.map(([name, window]) => [name, isRecord(window) ? window.utilization : null]));
}

/** M44. A rate-limit record rateLimitOf already made (a transport's `metadata.rateLimit`), closed again the same
 *  way, its `windows` read as `{ window: utilization }`; null when it is not a record. */
export function rateLimitRecordOf(value) {
  return isRecord(value) ? closedRateLimit(value, isRecord(value.windows) ? Object.entries(value.windows) : []) : null;
}

/** M44. The utilization `--stop-at-utilization` compares, and the usage lines lead with: the highest any reported
 *  limit carries, over the top-level `utilization` (older CLIs) and every window in `windows` (2.1.296 on), or null when
 *  none is reported. The highest, because each window is a limit of its own: a five-hour window at 0.95 pauses a review
 *  asked to stop at 0.9 while the seven-day window is at 0.2. */
export function highestUtilization(value) {
  const record = rateLimitRecordOf(value);
  const readings = record === null ? [] : [record.utilization, ...Object.values(record.windows ?? {})]
    .filter((reading) => reading !== null);
  return readings.length === 0 ? null : Math.max(...readings);
}

/** M33 J. A duration the result event states, in milliseconds: a finite non-negative number, else null. */
const durationOf = (value) => (Number.isFinite(value) && value >= 0 ? value : null);

/** D70 (a). The context window, in tokens, the CLI states it ran the call under: the result's `modelUsage` entry for
 *  the requested model value (the CLI keys it by the value as configured, its context selector included) and that
 *  entry's `contextWindow`, a positive integer — else null. Count-only instrumentation, never part of an answer. */
function reportedContextWindow(modelUsage, requested) {
  if (!isRecord(modelUsage) || !Object.hasOwn(modelUsage, requested) || !isRecord(modelUsage[requested])) return null;
  const window = modelUsage[requested].contextWindow;
  return Number.isSafeInteger(window) && window > 0 ? window : null;
}

/** M44. extractJson's fence (above), character for character, and the closing fence's length. */
const REPLY_FENCE = /```(?:json)?\s*\n([\s\S]*?)```/;
const REPLY_FENCE_CLOSE = '```'.length;
const countOf = (value) => (Number.isSafeInteger(value) && value >= 0 ? value : null);
/** A line that JSON.parse could read as an object: `{` after JSON white space only (a line holds no line feed). */
const OBJECT_LINE = /^[ \t\r]*\{/;

/**
 * M44. One extractJson candidate (`offset`: where it starts in the reply), walked exactly as extractJson walks it:
 * trimmed, from its first `{` or `[` to the bracket of the same kind that closes it (brackets inside strings ignored),
 * then JSON.parse. Its closed shape, where in the reply that first bracket stands (`start`) and where the walk closed
 * (`end`, exclusive; null when it never closed). The parsed value is never kept.
 */
function walkReplyCandidate(candidate, offset) {
  const trimmed = candidate.trim();
  if (trimmed === '') return { code: EMPTY_REPLY, start: null, end: null };
  const first = trimmed.search(/[[{]/);
  if (first === -1) return { code: NO_BRACKET_REPLY, start: null, end: null };
  const start = offset + candidate.length - candidate.trimStart().length + first;
  const open = trimmed[first], close = open === '{' ? '}' : ']';
  let depth = 0, inString = false, escaped = false;
  for (let i = first; i < trimmed.length; i++) {
    const ch = trimmed[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') { inString = true; continue; }
    if (ch === open) depth++;
    else if (ch === close && --depth === 0) {
      const end = start + i - first + 1;
      try { return { code: Array.isArray(JSON.parse(trimmed.slice(first, i + 1))) ? ARRAY_REPLY : OBJECT_REPLY, start, end }; }
      catch { return { code: UNPARSED_REPLY, start, end }; }
    }
  }
  return { code: UNCLOSED_REPLY, start, end: null };
}

/** M44. How extractJson reads a reply's text, its fence's text first and then the whole: the shape of the candidate
 *  it returned, else of the last it tried (the whole text); whether its fence matched; and in characters (UTF-16 code
 *  units) the reply's length, what stands before that candidate's first bracket and after the walk closed it (null when
 *  there is no bracket, or no close). */
function replyTextShape(text) {
  if (typeof text !== 'string') return { code: ABSENT_REPLY, fenced: false, chars: null, charsBefore: null, charsAfter: null };
  const fence = REPLY_FENCE.exec(text);
  // The fence's text ends where its closing fence begins, at the end of the match.
  const candidates = [...(fence ? [[fence[1], fence.index + fence[0].length - REPLY_FENCE_CLOSE - fence[1].length]] : []),
    [text, 0]];
  let walked = { code: EMPTY_REPLY, start: null, end: null };
  for (const [candidate, offset] of candidates) {
    if (!candidate) continue;
    walked = walkReplyCandidate(candidate, offset);
    if (walked.code === OBJECT_REPLY || walked.code === ARRAY_REPLY) break;
  }
  return { code: walked.code, fenced: fence !== null, chars: text.length, charsBefore: walked.start,
    charsAfter: walked.end === null ? null : text.length - walked.end };
}

const blockTypeOf = (block) => (isRecord(block) && typeof block.type === 'string' && REPLY_BLOCK_TYPES.includes(block.type)
  ? block.type : OTHER_BLOCK);

/**
 * M44. What an accepted claude-cli reply looked like, as closed values and counts only, never any text.
 * `code`, `fenced`, `chars`, `charsBefore`, `charsAfter`: how extractJson read the result event's `result`
 * (replyTextShape). From the stream's assistant events (each `assistant` line, so one message the CLI prints block by
 * block counts once per event): the final event's last REPLY_FINAL_BLOCKS_KEPT content-block types in order
 * (`finalBlocks`, REPLY_BLOCK_TYPES; the CLI's `result` is the text of that event's last block, when it is text:
 * 2.1.296, byte search of its bundle), how many blocks and text blocks it carried (`finalBlockCount`,
 * `finalTextBlocks`); how many assistant events there were (`assistantEvents`) and the text blocks they carried
 * (`textBlocks`); and whether those text blocks, joined in order, read as a JSON object by the same extractor
 * (`joinedTextReadable`; the value is never kept). From the result event: `stopReason` (REPLY_STOP_REASONS, null when
 * absent), `numTurns` and `usage.output_tokens_details.thinking_tokens` (`thinkingTokens`), each a count or null.
 */
export function replyShapeOf(output, result) {
  let final = [], assistantEvents = 0, textBlocks = 0;
  const texts = [];
  for (const line of typeof output === 'string' ? output.split('\n') : []) {
    // A line that cannot be an object is never parsed: JSON.parse would only refuse it, at the cost of a throw.
    if (!OBJECT_LINE.test(line)) continue;
    let event;
    try { event = JSON.parse(line); } catch { continue; }
    if (!isRecord(event) || event.type !== 'assistant') continue;
    assistantEvents++;
    final = isRecord(event.message) && Array.isArray(event.message.content) ? event.message.content : [];
    for (const block of final) {
      if (!isRecord(block) || block.type !== TEXT_BLOCK) continue;
      textBlocks++;
      if (typeof block.text === 'string') texts.push(block.text);
    }
  }
  const reply = isRecord(result) ? result : {};
  const details = isRecord(reply.usage) && isRecord(reply.usage.output_tokens_details) ? reply.usage.output_tokens_details : {};
  const stop = reply.stop_reason;
  return { ...replyTextShape(reply.result), finalBlocks: final.slice(-REPLY_FINAL_BLOCKS_KEPT).map(blockTypeOf),
    finalBlockCount: final.length, finalTextBlocks: final.filter((block) => blockTypeOf(block) === TEXT_BLOCK).length,
    assistantEvents, textBlocks, joinedTextReadable: isRecord(extractJson(texts.join(''))),
    stopReason: stop == null ? null : typeof stop === 'string' && REPLY_STOP_REASONS.includes(stop) ? stop : OTHER_STOP,
    numTurns: countOf(reply.num_turns), thinkingTokens: countOf(details.thinking_tokens) };
}

/** M44. A reply shape replyShapeOf made (a transport's `metadata.replyShape`), closed again field by field: a value
 *  outside its list or of another type is null (a block type `other`, and only the last REPLY_FINAL_BLOCKS_KEPT are
 *  kept); null when it is not a record. */
export function replyShapeRecordOf(value) {
  if (!isRecord(value)) return null;
  const member = (field, list) => (typeof field === 'string' && list.includes(field) ? field : null);
  const flag = (field) => (typeof field === 'boolean' ? field : null);
  return { code: member(value.code, REPLY_SHAPES), fenced: flag(value.fenced), chars: countOf(value.chars),
    charsBefore: countOf(value.charsBefore), charsAfter: countOf(value.charsAfter),
    finalBlocks: Array.isArray(value.finalBlocks) ? value.finalBlocks.slice(-REPLY_FINAL_BLOCKS_KEPT)
      .map((type) => member(type, REPLY_BLOCK_TYPES) ?? OTHER_BLOCK) : null,
    finalBlockCount: countOf(value.finalBlockCount), finalTextBlocks: countOf(value.finalTextBlocks),
    assistantEvents: countOf(value.assistantEvents),
    textBlocks: countOf(value.textBlocks), joinedTextReadable: flag(value.joinedTextReadable),
    stopReason: value.stopReason == null ? null : member(value.stopReason, REPLY_STOP_REASONS) ?? OTHER_STOP,
    numTurns: countOf(value.numTurns), thinkingTokens: countOf(value.thinkingTokens) };
}

/** A value that names a model, as identity evidence: a string that is not the locally built marker. */
const namesModel = (model) => typeof model === 'string' && model !== SYNTHETIC_MODEL;

/**
 * M33 refreeze. Positive evidence that the call was not answered by the one model it had to be:
 * a model-fallback event; an assistant that is not top-level; for a full requested id, an init or a
 * top-level assistant naming another model; for an alias, inits naming different models, or a
 * top-level assistant naming another model than the init does. A missing, repeated or non-string
 * init, or no top-level assistant at all, fails the call but proves nothing either way.
 * D70 (a): the init names the requested value as configured, the CLI's context selector included; a top-level
 * assistant names the model that served it, the id without the selector (`servedModelId`).
 */
function identityFailed(stream, requested, attestable) {
  if (stream.fallbacks > 0 || stream.nestedModels.length > 0) return true;
  const initNamed = [...new Set(stream.initModels.filter(namesModel))];
  if (attestable) return initNamed.some((model) => model !== requested)
    || stream.topLevelModels.some((model) => namesModel(model) && model !== servedModelId(requested));
  if (initNamed.length > 1) return true;
  return initNamed.length === 1 && stream.topLevelModels.some((model) => namesModel(model) && model !== initNamed[0]);
}

/**
 * M33 C-07 and its refreeze. `accepted`: whether the answer may be returned at all. It needs every
 * condition: exactly one `init`; at least one assistant, every one top-level and naming exactly the
 * one expected model — the requested full id, or for an alias the model the single init names; no
 * `<synthetic>`, API-error marker or `error` field on any assistant; no model-fallback event;
 * exactly one result with `subtype: "success"`, `is_error: false` and no API error status; exit 0
 * and no stop. `attested`: accepted under a full requested id. An alias is never attested — an
 * accepted alias answer is `unattested`. `identityFailed`: identityFailed() above. D70 (a): under a full id with
 * the CLI's context selector, the init names the requested value and every top-level assistant the id without it.
 */
function judgeClaudeCall(stream, requested, { exitCode, stop }) {
  const attestable = attestableModel(requested);
  const result = stream.results.at(-1) ?? null;
  const cleanResult = stream.results.length === 1 && result.subtype === 'success' && result.is_error === false
    && (result.api_error_status === undefined || result.api_error_status === null);
  const noApiError = stream.syntheticMessages === 0 && stream.apiErrorMarkers === 0 && stream.errorValues.length === 0;
  const clean = exitCode === 0 && !stop && cleanResult && noApiError;
  const configured = attestable ? requested : stream.initModels[0];
  const served = attestable ? servedModelId(requested) : stream.initModels[0];
  const proved = stream.inits === 1 && typeof configured === 'string' && stream.initModels[0] === configured
    && stream.nestedModels.length === 0 && stream.topLevelModels.length > 0
    && stream.topLevelModels.every((model) => model === served);
  const failedIdentity = identityFailed(stream, requested, attestable);
  const accepted = clean && proved && !failedIdentity;
  return { accepted, attested: accepted && attestable, identityFailed: failedIdentity };
}

/** M33 refreeze. An `api_error_status` value to its class: API_ERROR_STATUS_CLASS, else any other
 *  integer from 500 to 599 is `server_error`, and anything else — a non-integer too — `unknown`. */
function statusClass(status) {
  if (!Number.isSafeInteger(status)) return UNKNOWN_PROVIDER;
  if (Object.hasOwn(API_ERROR_STATUS_CLASS, status)) return API_ERROR_STATUS_CLASS[status];
  return status >= SERVER_ERROR_STATUS_MIN && status <= SERVER_ERROR_STATUS_MAX ? SERVER_ERROR : UNKNOWN_PROVIDER;
}
/** An assistant `error` value to its class, by exact membership of PROVIDER_ERROR_CLASS only. */
const enumClass = (value) => (typeof value === 'string' && Object.hasOwn(PROVIDER_ERROR_CLASS, value)
  ? PROVIDER_ERROR_CLASS[value] : UNKNOWN_PROVIDER);

/**
 * M33 C-07 and its refreeze. The provider class of a call that was not accepted, from typed values
 * only, never any text. Every observed value is mapped: identity evidence to `identity_mismatch`,
 * each assistant `error` value by exact enum membership, each non-null `api_error_status` (on an
 * assistant or a result) by statusClass(). If any of them is a class an identical request cannot
 * change, the first observed in NON_RETRYABLE_PROVIDER_CLASSES' fixed order wins. Otherwise the
 * enum values decide, or the statuses when there is no enum value; one agreed class is the class,
 * and disagreeing values — or none at all — are `unknown`.
 */
function providerClassOf(stream, failedIdentity) {
  const enumClasses = stream.errorValues.map(enumClass);
  const statusClasses = stream.errorStatuses.map(statusClass);
  const observed = new Set([...(failedIdentity ? [IDENTITY_MISMATCH] : []), ...enumClasses, ...statusClasses]);
  const nonRetryable = NON_RETRYABLE_PROVIDER_CLASSES.find((providerClass) => observed.has(providerClass));
  if (nonRetryable) return nonRetryable;
  const deciding = new Set(enumClasses.length > 0 ? enumClasses : statusClasses);
  return deciding.size === 1 ? [...deciding][0] : UNKNOWN_PROVIDER;
}

/** The agent transport: what one agent call did, as counts and the paths it read (never any other text of the stream):
 *  the turns the result states (`num_turns`), the tool uses by AGENT_TOOL_NAMES name, the distinct paths the Read tool
 *  was asked for, in the order first asked, each Read's lines from its typed result (/2: `readRanges`, in the order the
 *  results came; `readsUnranged`, the Reads with none that did not fail, and `readsUnrangedPaths`, the distinct paths
 *  those Reads asked for, in the order first asked; `readsFailed`, each distinct path and CODE_READ_FAILURES reason of
 *  a Read that read nothing, in the order first asked: one the result lists among its refused tool uses (by its id),
 *  `refused`, else one whose tool result the CLI typed as an error, `failed` — never ranged, never unranged), how many
 *  tool uses the CLI refused (`permission_denials`; `--restricted` refuses a path outside the working directory and its
 *  `--add-dir`s), and the result's duration, cost and usage. */
function agentRunOf(stream, result) {
  const [REFUSED_READ, FAILED_READ] = CODE_READ_FAILURES;
  const denied = new Set((Array.isArray(result?.permission_denials) ? result.permission_denials : [])
    .filter((d) => isRecord(d) && stream.readUses.has(d.tool_use_id)).map((d) => d.tool_use_id));
  const failed = new Set([...stream.readUses.keys()].filter((id) => denied.has(id) || stream.readErrors.has(id)));
  const ranged = [...stream.readRanges].filter(([id]) => !failed.has(id));
  const readsFailed = [];
  for (const [id, path] of stream.readUses) {
    const reason = denied.has(id) ? REFUSED_READ : FAILED_READ;
    if (failed.has(id) && path !== null && !readsFailed.some((r) => r.path === path && r.reason === reason))
      readsFailed.push({ path, reason });
  }
  return { numTurns: countOf(result?.num_turns),
    toolCalls: Object.fromEntries(AGENT_TOOL_NAMES.map((name) => [name, stream.toolNames.get(name) ?? 0])),
    reads: [...stream.reads],
    readRanges: ranged.map(([, range]) => range),
    readsUnranged: Math.max(0, (stream.toolNames.get('Read') ?? 0) - ranged.length - failed.size),
    readsUnrangedPaths: [...new Set([...stream.readUses].filter(([id, path]) => path !== null && !failed.has(id)
      && !stream.readRanges.has(id)).map(([, path]) => path))],
    readsFailed,
    permissionDenials: Array.isArray(result?.permission_denials) ? result.permission_denials.length : null,
    durationMs: durationOf(result?.duration_ms),
    costUsd: Number.isFinite(result?.total_cost_usd) ? result.total_cost_usd : null,
    usage: isRecord(result?.usage) ? result.usage : null };
}

/**
 * The agent transport /2 (D105, F2 part A3): one agent run as the answer store keeps it beside the answer and sets it again
 * on replay — `{ numTurns, toolCalls, reads, readRanges, readsUnranged, readsUnrangedPaths, readsFailed }`: the turns,
 * the tool uses by AGENT_TOOL_NAMES name, the paths the Read tool was asked for, each Read's `{ path, startLine,
 * numLines, totalLines }`, the Reads with no range that did not fail and the paths they asked for, and each `{ path,
 * reason }` of a Read that read nothing (CODE_READ_FAILURES). Paths, counts and closed reasons only, never text: the
 * duration, the cost and the usage are not kept. Null when `run` is not a run record of this version (one of /1 has no
 * `readRanges`, an earlier one of /2 no `readsFailed`): such an answer is never stored, and a stored one is a miss.
 */
export function agentRunRecord(run) {
  if (!isRecord(run)) return null;
  const count = (n) => Number.isSafeInteger(n) && n >= 0;
  const tools = run.toolCalls;
  if (!(run.numTurns === null || count(run.numTurns)) || !isRecord(tools)
    || Object.keys(tools).some((name) => !AGENT_TOOL_NAMES.includes(name)) || !Object.values(tools).every(count)
    || !Array.isArray(run.reads) || !run.reads.every((path) => typeof path === 'string')
    || !Array.isArray(run.readRanges) || !count(run.readsUnranged) || !Array.isArray(run.readsUnrangedPaths)
    || !run.readsUnrangedPaths.every((path) => typeof path === 'string') || !Array.isArray(run.readsFailed)
    || !run.readsFailed.every((r) => isRecord(r) && Object.keys(r).length === 2 && typeof r.path === 'string'
      && r.path !== '' && CODE_READ_FAILURES.includes(r.reason))) return null;
  const RANGE = ['path', 'startLine', 'numLines', 'totalLines'];
  const ranges = run.readRanges.map((r) => (isRecord(r) && Object.keys(r).length === RANGE.length
    && RANGE.every((key) => Object.hasOwn(r, key)) && typeof r.path === 'string' && r.path !== ''
    && Number.isSafeInteger(r.startLine) && r.startLine >= 1 && count(r.numLines) && count(r.totalLines)
    ? { path: r.path, startLine: r.startLine, numLines: r.numLines, totalLines: r.totalLines } : null));
  if (ranges.includes(null)) return null;
  return { numTurns: run.numTurns, toolCalls: Object.fromEntries(Object.entries(tools)), reads: [...run.reads],
    readRanges: ranges, readsUnranged: run.readsUnranged, readsUnrangedPaths: [...run.readsUnrangedPaths],
    readsFailed: run.readsFailed.map((r) => ({ path: r.path, reason: r.reason })) };
}

/** `agent` (the agent transport): an agent request's checked `agent` and `schema` (agentRequestOf), or null. An agent
 *  call runs in `agent.root` with the agent argv, its own timeout when it states one and AGENT_MAX_OUTPUT_BYTES; any
 *  other call in a fresh private folder that holds nothing, as before. */
async function callLocal(request, config, { env, spawnProcess, timeoutMs, maxOutputBytes, cancellation, agent = null }) {
  const directory = agent ? null : await mkdtemp(join(tmpdir(), 'sonah-review-judge-'));
  const callTimeoutMs = agent?.timeoutMs ?? timeoutMs;
  const outputBound = agent ? AGENT_MAX_OUTPUT_BYTES : maxOutputBytes;
  try {
    if (directory) await chmod(directory, 0o700);
    // M33: an abort that arrived while the private directory was made starts nothing.
    if (cancellation.aborted) throw failure(REVIEW_CANCELLED);
    return await new Promise((resolve) => {
      let child = null, done = false, closed = false, output = '', size = 0, stop = null, timer = null;
      let unregister = () => {}, cancelGrace = () => {};
      // D145: a request whose later passes wait for it (challenge.js REPLY_BEGUN) is told once that the model's reply has
      // begun: at the first `stream_event` line, the API's own stream that `--include-partial-messages` prints (its
      // `message_start` comes once the prompt is processed, and so cached). Read by the line's typed `type` only; the
      // scan ends there, or at the first `assistant` or `result` line, which no reply-begun signal follows.
      let begun = typeof request?.[REPLY_BEGUN] === 'function' ? request[REPLY_BEGUN] : null, scanned = 0;
      const scanReplyBegun = () => {
        let newline;
        while (begun !== null && (newline = output.indexOf('\n', scanned)) !== -1) {
          let event = null;
          try { event = JSON.parse(output.slice(scanned, newline)); } catch { /* not a line this scan reads */ }
          scanned = newline + 1;
          const type = isRecord(event) ? event.type : null;
          if (type === 'stream_event') {
            const told = begun;
            begun = null;
            try { told(); } catch { /* the caller's signal never changes the call */ }
          } else if (type === 'assistant' || type === 'result') begun = null;
        }
      };
      const finish = (result) => {
        if (done) return;
        done = true; clearTimeout(timer); unregister(); resolve(result);
      };
      // Our own stop: recorded once, then SIGTERM, then SIGKILL after the fixed grace (M33). If the
      // pipes are still held open a fixed grace after SIGKILL, the call settles without `close`
      // (stopChild, M33 G1), from what the stream had said before the stop.
      const halt = (why) => {
        if (stop || closed || done) return;
        stop = why;
        if (child) cancelGrace = stopChild(child, () => closed, () => settle(null));
      };
      // Gain I: a request with images is one stream-json user message (`claudeStreamInput`); any other, its prompt.
      const images = requestImagesOf(request);
      const argv = agent ? reviewAgentCliArgs({ system: request.system, model: config.model, agent, schema: agent.schema })
        : reviewCliArgs({ system: request.system, model: config.model, images: images.length > 0 });
      try { child = spawnProcess('claude', argv, {
        cwd: agent ? agent.root : directory, env: localEnvironment(env, request), stdio: ['pipe', 'pipe', 'pipe'],
      }); } catch { finish({ ok: false, code: 'model_unavailable', transportClass: 'spawn_failed' }); return; }
      timer = setTimeout(() => halt('model_timeout'), callTimeoutMs);
      unregister = cancellation.register(() => halt(REVIEW_CANCELLED));
      child.stdin.on('error', () => {});
      child.stdin.end(images.length ? claudeStreamInput(request.prompt, images) : request.prompt);
      child.stdout.setEncoding('utf8');
      child.stdout.on('data', (chunk) => {
        if (stop) return;
        size += Buffer.byteLength(chunk);
        if (size > outputBound) { halt('model_output_limit'); return; }
        output += chunk;
        if (begun !== null) scanReplyBegun();
      });
      child.stderr.on('data', () => {}); // Never expose provider output that may contain input text.
      // The child could not be started (ENOENT, EACCES, …). Its error text is never read.
      child.on('error', () => finish({ ok: false, code: 'model_unavailable', transportClass: 'spawn_failed' }));
      child.on('close', (exitCode) => {
        closed = true;
        cancelGrace();
        settle(exitCode);
      });
      function settle(exitCode) {
        if (done) return;
        const stream = readClaudeStream(output);
        const result = stream.results.at(-1) ?? null;
        const verdict = judgeClaudeCall(stream, config.model, { exitCode, stop });
        // M33 refreeze: a failed call is `mismatch` only on identity evidence, else `unattested`.
        const failedAttestation = verdict.identityFailed ? MISMATCH : UNATTESTED;
        const identityClass = verdict.identityFailed ? IDENTITY_MISMATCH : null;
        const metadata = { usage: result?.usage ?? null, modelUsage: result?.modelUsage ?? null,
          costUsd: Number.isFinite(result?.total_cost_usd) ? result.total_cost_usd : null,
          reportedModels: [...stream.reportedModels], toolUse: stream.toolUse, exitCode,
          attestation: failedAttestation, providerClass: identityClass,
          configuredModel: stream.inits === 1 ? recordedModel(stream.initModels[0]) : null,
          // Every top-level assistant's model, and the model of a nested one when it is another id.
          servedModels: [...new Set([...stream.topLevelModels,
            ...stream.nestedModels.filter((model) => typeof model === 'string' && model !== config.model)].map(recordedModel))],
          syntheticMessages: stream.syntheticMessages,
          apiErrorStatus: Number.isSafeInteger(result?.api_error_status) ? result.api_error_status : null,
          apiRetries: stream.apiRetries,
          // M33 J: count-only instrumentation — the result's own durations and the last rate-limit event.
          durationMs: durationOf(result?.duration_ms), durationApiMs: durationOf(result?.duration_api_ms),
          rateLimit: stream.rateLimit,
          // D70 (a): the context window the CLI states it ran this call under, a count.
          contextWindow: reportedContextWindow(result?.modelUsage, config.model),
          // D70 review (S0): the CLI version its one init states, a SemVer normal version, or null.
          cliVersion: stream.inits === 1 ? cliVersionOf(stream.initVersions[0]) : null,
          // The agent transport: what the agent did (agentRunOf), on an agent call only.
          ...(agent ? { agentRun: agentRunOf(stream, result) } : {}) };
        if (stop) {
          // A cancellation is the review stopping, not the transport failing: no transport class.
          // A stop does not hide identity evidence already on the stream (`identity_mismatch`), nor
          // (M33 G1) any class an identical request cannot change that a typed field already carried:
          // the retry wrapper must not ask again and a runner must stop. A retryable class is not kept.
          const transportClass = stop === REVIEW_CANCELLED ? null : localTransportClass({ stop, exitCode, result });
          const observed = providerClassOf(stream, verdict.identityFailed);
          return finish({ ok: false, code: stop, ...(transportClass ? { transportClass } : {}), ...metadata,
            providerClass: NON_RETRYABLE_PROVIDER_CLASSES.includes(observed) ? observed : identityClass });
        }
        // A tool call is the model breaking its contract, not the transport failing: no class. The agent transport: a
        // tool use of an AGENT_TOOL_NAMES name is the agent working; any other (an unnamed one included) still breaks it.
        const allowedUses = agent ? AGENT_TOOL_NAMES.reduce((sum, name) => sum + (stream.toolNames.get(name) ?? 0), 0) : 0;
        if (stream.toolUse > allowedUses) return finish({ ok: false, code: 'model_tool_use', ...metadata });
        if (!verdict.accepted) {
          // The agent transport: the CLI stopped an agent run at a limit of its request and said which in the one
          // result's typed subtype (AGENT_RESULT_FAILURES), its own code and class. Identity evidence wins. A session
          // call has no such limit, so it never reads one.
          const limit = agent && stream.results.length === 1 && !verdict.identityFailed
            ? AGENT_RESULT_FAILURES[result.subtype] : undefined;
          if (isRecord(limit)) return finish({ ok: false, code: limit.code, transportClass: limit.transportClass, ...metadata });
          const providerClass = providerClassOf(stream, verdict.identityFailed);
          return finish({ ok: false, code: providerClass === OUTPUT_TOKENS ? 'model_response_incomplete' : 'model_unavailable',
            transportClass: localTransportClass({ stop, exitCode, result }), ...metadata, providerClass });
        }
        // The agent transport: the CLI's structured output (`--json-schema`) is the answer when it is an object; else the
        // result's text, read as any reply is.
        const raw = agent && isRecord(result.structured_output) ? result.structured_output
          : typeof result.result === 'string' ? extractJson(result.result) : null;
        // D78: an object, or on a challenge request a bare list of votes (`answerOf`).
        const answer = answerOf(raw, request);
        const ok = answer !== null, json = ok ? answer : raw;
        // M44: the accepted reply's closed shape, beside the answer; it never decides it, and its failure is no shape.
        let replyShape = null;
        try { replyShape = replyShapeOf(output, result); } catch { /* instrumentation never changes an answer */ }
        // Only an answer is attested; an accepted call whose reply is not a JSON object is `unattested`.
        finish({ ok, json, code: 'model_response_invalid', ...metadata, replyShape,
          attestation: ok && verdict.attested ? ATTESTED : UNATTESTED });
      }
    });
  } finally { if (directory) await rm(directory, { recursive: true, force: true }); }
}

async function callApi(request, config, { env, fetchImpl, timeoutMs, maxOutputBytes, cancellation }) {
  if (!env.ANTHROPIC_API_KEY) return { ok: false, code: 'anthropic_key_missing' };
  const controller = new AbortController(), timer = setTimeout(() => controller.abort(), timeoutMs);
  let cancelled = false;
  const unregister = cancellation.register(() => { cancelled = true; controller.abort(); });
  try {
    // https://platform.claude.com/docs/en/api/messages/create : system is top-level; no tools.
    const response = await fetchImpl(REVIEW_API_URL, {
      method: 'POST', signal: controller.signal,
      headers: { 'content-type': 'application/json', 'anthropic-version': REVIEW_API_VERSION, 'x-api-key': env.ANTHROPIC_API_KEY },
      body: JSON.stringify(reviewApiBody({ system: request.system, prompt: request.prompt, model: config.model,
        images: requestImagesOf(request) })),
    });
    // W3d-1: the HTTP status is already recorded as a number; the class list has no HTTP word,
    // so an error status is `unknown` rather than a CLI word that would misdescribe it.
    if (!response.ok) return { ok: false, code: 'model_unavailable', httpStatus: response.status, transportClass: 'unknown' };
    let data = '', bytes = 0;
    const decoder = new TextDecoder();
    for await (const chunk of response.body) {
      bytes += chunk.byteLength;
      if (bytes > maxOutputBytes) { controller.abort(); return { ok: false, code: 'model_output_limit', transportClass: 'output_limit' }; }
      data += decoder.decode(chunk, { stream: true });
    }
    data += decoder.decode();
    const body = JSON.parse(data), toolUse = (body.content ?? []).filter((b) => b.type === 'tool_use').length;
    // M33: the API's own `model` echo is recorded exactly, but the call is reported `unattested`: the
    // contract defines attestation for the claude-cli stream only, and a mismatch here fails nothing.
    const metadata = { usage: body.usage ?? null, reportedModels: typeof body.model === 'string' ? [body.model] : [], toolUse, costUsd: null,
      servedModels: typeof body.model === 'string' ? [recordedModel(body.model)] : [] };
    if (body.stop_reason !== 'end_turn' || toolUse) return { ok: false, code: toolUse ? 'model_tool_use' : 'model_response_incomplete', ...metadata };
    const raw = extractJson((body.content ?? []).filter((b) => b.type === 'text').map((b) => b.text).join(''));
    // D78: an object, or on a challenge request a bare list of votes (`answerOf`).
    const answer = answerOf(raw, request);
    return { ok: answer !== null, json: answer ?? raw, code: 'model_response_invalid', ...metadata };
  } catch {
    if (cancelled) return { ok: false, code: REVIEW_CANCELLED };
    return controller.signal.aborted ? { ok: false, code: 'model_timeout', transportClass: 'timeout' }
      : { ok: false, code: 'model_unavailable', transportClass: 'unknown' };
  }
  finally { clearTimeout(timer); unregister(); }
}

// F48: moved beside JUDGE_FAILURE_CODES in packages/evidence/src/ledger.js, now that this file's
// constants block is not held by another wave. Re-exported here so every existing import of
// RETRYABLE_JUDGE_CODES from this module keeps working unchanged.
export { RETRYABLE_JUDGE_CODES } from '../../evidence/src/ledger.js';

// `attempts` is deliberately NOT enumerable. run-review.js pins a narrative to a closed shape —
// its keys must be exactly the channels — so an ordinary property would fail every retried window
// as `model_response_invalid`, which is the opposite of what a retry is for. Instrumentation
// reads `result.attempts`; Object.keys, JSON.stringify and structuredClone never see it.
function withAttempts(result, attempts) {
  if (result === null || typeof result !== 'object') return result;
  try {
    Object.defineProperty(result, 'attempts',
      { value: attempts, enumerable: false, configurable: true, writable: true });
  } catch { /* a sealed result keeps its shape; the count is not worth failing a review over */ }
  return result;
}

/** The timeout failure code (ledger.js JUDGE_FAILURE_CODES). */
const MODEL_TIMEOUT = 'model_timeout';
/** The agent transport: the failures of an agent request the transport does not ask again, each for its own reason. A
 *  timeout: one stuck agent must not cost two. A reply that came back and could not be read (ledger.js
 *  REASKABLE_JUDGE_CODES): the caller's one re-ask or repair asks again, naming what was wrong (evidence/src/code-pass.js
 *  `rereadable`), so a transport retry of the identical request would be a second, unexplained one. */
const AGENT_NOT_RETRIED = Object.freeze([MODEL_TIMEOUT, ...REASKABLE_JUDGE_CODES]);

/** One retry, with the identical request, on a transport failure only. Then the failure stands:
 *  a transport that fails twice is not a blip, and a third call is a guess paid for in tokens.
 *  M33: never after a cancellation, and never after a provider class an identical request cannot
 *  change (NON_RETRYABLE_PROVIDER_CLASSES: identity mismatch, auth, billing, rate limit, model not
 *  found, invalid request) — those would only spend the account's quota on the same refusal. The
 *  class is the call's one class (providerClassOf), so a stop class observed beside a retryable one
 *  is never retried either. The agent transport: nor an agent request (`isAgentRequest`) that timed out or whose reply
 *  could not be read (AGENT_NOT_RETRIED). */
export function withTransportRetry(judge) {
  return async (request) => {
    try { return withAttempts(await judge(request), 1); }
    catch (error) {
      if (error?.code === REVIEW_CANCELLED || NON_RETRYABLE_PROVIDER_CLASSES.includes(error?.providerClass)) throw error;
      if (!RETRYABLE_JUDGE_CODES.includes(error?.code)) throw error;
      // The agent transport: an agent call that ran out its time, or whose reply could not be read, is not asked again
      // here (AGENT_NOT_RETRIED).
      if (AGENT_NOT_RETRIED.includes(error.code) && isAgentRequest(request)) throw error;
      return withAttempts(await judge(request), 2);
    }
  };
}

/** The agent transport: what one agent call did (agentRunOf) rides on its answer, or on its thrown failure, not
 *  enumerable, like `attempts`: Object.keys, JSON.stringify and structuredClone never see it, so a stored answer never
 *  holds it. An answer that has a member of that name of its own keeps it. */
function withAgentRun(value, agentRun) {
  if (!isRecord(agentRun) || value === null || typeof value !== 'object' || Object.hasOwn(value, 'agentRun')) return value;
  try {
    Object.defineProperty(value, 'agentRun', { value: agentRun, enumerable: false, configurable: true, writable: true });
  } catch { /* a sealed answer keeps its shape */ }
  return value;
}

/** The agent transport: whether every path is a directory that exists now (links followed). */
async function directoriesExist(paths) {
  for (const path of paths) {
    try { if (!(await stat(path)).isDirectory()) return false; } catch { return false; }
  }
  return true;
}

/** M33: every recorded result carries the attestation fields, whichever path produced it. A path that
 *  read no stream (a process that could not start) has no identity evidence: `unattested` (refreeze). */
const attestationDefaults = () => ({ attestation: UNATTESTED,
  providerClass: null, configuredModel: null, servedModels: [], syntheticMessages: 0, apiErrorStatus: null, apiRetries: 0,
  // M33 J: a path whose stream carries no durations or rate-limit event (codex-cli, the API, a process
  // that could not start) records none.
  durationMs: null, durationApiMs: null, rateLimit: null,
  // D70 (a): a path whose stream states no context window records none. D70 review (S0): nor a CLI version.
  contextWindow: null, cliVersion: null,
  // M44: only an accepted claude-cli reply has a shape (replyShapeOf).
  replyShape: null });

/** The closed provider class rides on the thrown failure, not enumerable, like `attempts` does. */
function withProviderClass(error, providerClass) {
  if (PROVIDER_CLASSES.includes(providerClass))
    Object.defineProperty(error, 'providerClass', { value: providerClass, enumerable: false, configurable: false, writable: false });
  return error;
}

/**
 * `signal` (M33): an AbortSignal or null. Once it aborts, every in-flight child is stopped SIGTERM
 * first then SIGKILL after KILL_GRACE_MS (an API call is aborted), that call fails
 * `review_cancelled` once its child has closed, and every later call fails `review_cancelled`
 * without starting anything. Each in-flight call holds one abort listener, removed when it settles.
 * A claude-cli call that is not accepted throws `model_unavailable` (or `model_response_incomplete`
 * for `output_tokens`) with its closed `providerClass`; nothing from it is returned, so D60 never
 * stores it. An accepted call under an alias answers, `unattested`; only a full id is `attested`.
 * The agent transport: an agent request (`isAgentRequest`) runs with the agent argv in its `agent.root`, may use the
 * AGENT_TOOL_NAMES tools, answers with its structured output, and fails `model_turn_limit` or
 * `model_structured_output_failed` when the CLI stops it (AGENT_RESULT_FAILURES); what it did rides on its answer and
 * its failure (`agentRun`, not enumerable) and reaches `onResult` as `metadata.agentRun`.
 */
export function createReviewJudge({ config, env = process.env, spawnProcess = spawn, fetchImpl = fetch,
  timeoutMs = 20 * 60_000, maxOutputBytes = 16 * 1024 * 1024, onResult = () => {}, signal = null } = {}) {
  config = reviewJudgeConfig(env, config);
  const cancellation = cancellationOf(signal);
  return async (request) => {
    if (cancellation.aborted) throw failure(REVIEW_CANCELLED);
    if (typeof request?.system !== 'string' || typeof request?.prompt !== 'string' ||
        request.system.includes('\0') || request.prompt.includes('\0')) throw failure('invalid_model_input');
    // Gain I: a request's images are sent whole by a backend that sends images, or the request is refused — never sent
    // without them (its scope was built as though they were shown).
    if (sendableImages(request, config.backend) === null) throw failure('invalid_model_input');
    // The agent transport: an agent request is sent only by claude-cli, only well formed (agentRequestOf), without
    // images (its argv reads one prompt on stdin), and only into directories that exist; else it is refused before
    // anything starts, never sent without its tools.
    let agent = null;
    if (isAgentRequest(request)) {
      agent = agentRequestOf(request);
      if (config.backend !== 'claude-cli' || agent === null || requestImagesOf(request).length > 0
          || !(await directoriesExist([agent.root, ...agent.addDirs]))) throw failure('invalid_model_input');
      if (cancellation.aborted) throw failure(REVIEW_CANCELLED);
    }
    const started = Date.now();
    const result = await (config.backend === 'claude-cli' ? callLocal : config.backend === 'codex-cli' ? callCodexLocal : callApi)(request, config,
      { env, spawnProcess, fetchImpl, timeoutMs, maxOutputBytes, cancellation, agent });
    const { json, ...metadata } = { ...attestationDefaults(), ...result };
    if (metadata.ok) delete metadata.code;
    await onResult({ ...metadata, backend: config.backend, requestedModel: config.model,
      elapsedMs: Date.now() - started, inputBytes: Buffer.byteLength(request.system) + Buffer.byteLength(request.prompt) });
    if (!result.ok) throw withAgentRun(withProviderClass(failure(result.code, result.transportClass), metadata.providerClass),
      metadata.agentRun);
    return withAgentRun(json, metadata.agentRun);
  };
}
