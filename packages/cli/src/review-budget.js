// Optional stops the person can set, never limits by default (owner decision, 2026-10-10: "remove that limit... let it
// run... keep it so that if they want, they can stop it"). With no flag a review runs to the end; the CLI states up
// front how long it should take (`estimateLine`). Admission is separate from transport cancellation so
// already-started answers can finish and enter the cache.
import { performance } from 'node:perf_hooks';
import { JUDGE_FAILURE_CODES } from '../../evidence/src/ledger.js';
import { RATE_LIMIT_WINDOWS, highestUtilization, rateLimitRecordOf } from './review-judge.js';

export const DEFAULT_REVIEW_BUDGET = Object.freeze({ maxCalls: null, maxInputBytes: null, stopAtUtilization: null });
export const REVIEW_BUDGET_REASONS = Object.freeze(['max_calls', 'max_input_bytes', 'utilization']);
const [MAX_CALLS, MAX_INPUT_BYTES, UTILIZATION] = REVIEW_BUDGET_REASONS;
const BUDGET_EXHAUSTED = JUDGE_FAILURE_CODES.find(code => code === 'budget_exhausted');
const failure = code => Object.assign(new Error(code), { code });
const count = value => Number.isSafeInteger(value) && value >= 0;
const positive = value => (typeof value === 'string' || typeof value === 'number')
  && /^[1-9]\d{0,15}$/.test(String(value)) && Number.isSafeInteger(Number(value)) ? Number(value) : null;
// Same documented CLI fraction grammar as scripts/session-review.mjs (M33 K).
const fraction = value => (typeof value === 'string' || typeof value === 'number')
  && /^(?:0\.\d{1,6}|1(?:\.0{1,6})?)$/.test(String(value)) && Number(value) > 0 ? Number(value) : null;

/** M44. Each RATE_LIMIT_WINDOWS window in plain words, as the usage lines print it. */
export const RATE_LIMIT_WINDOW_WORDS = Object.freeze({ five_hour: 'five-hour', seven_day: 'seven-day',
  seven_day_overage_included: 'seven-day with extra usage', other: 'other limit' });

/** M44. A usage reading in words: the highest utilization (highestUtilization: what `--stop-at-utilization`
 *  compares), then each window that reported one, e.g. `0.57 (five-hour 0.57, seven-day 0.18)`; `not reported` when
 *  there is none. Closed names and numbers only. */
export function utilizationWords(rateLimit) {
  const highest = highestUtilization(rateLimit);
  if (highest === null) return 'not reported';
  const windows = rateLimitRecordOf(rateLimit).windows ?? {};
  const each = RATE_LIMIT_WINDOWS.filter((window) => Object.hasOwn(windows, window))
    .map((window) => `${RATE_LIMIT_WINDOW_WORDS[window]} ${windows[window]}`);
  return each.length === 0 ? `${highest}` : `${highest} (${each.join(', ')})`;
}

/** What a usage error says of each budget field's value, naming its flag. */
const BUDGET_USAGE = Object.freeze({ maxCalls: '--max-calls needs a whole number from 1',
  maxInputBytes: '--max-input-bytes needs a whole number from 1',
  stopAtUtilization: '--stop-at-utilization needs a number above 0 and at most 1, with up to 6 decimals, '
    + 'such as 0.9' });

/** Mutates only the three budget fields, accepting strict raw CLI strings or already normalized numbers. An absent
 * field is null: no stop. Invalid supplied text is a usage error, never silently defaulted; it names the flag. */
export function normalizeReviewBudget(options) {
  for (const field of ['maxCalls', 'maxInputBytes', 'stopAtUtilization']) {
    if (options[field] === undefined || options[field] === null) { options[field] = DEFAULT_REVIEW_BUDGET[field]; continue; }
    const value = field === 'stopAtUtilization' ? fraction(options[field]) : positive(options[field]);
    if (value === null) throw Object.assign(failure('usage'), { problem: BUDGET_USAGE[field] });
    options[field] = value;
  }
  return options;
}

/** The input bytes one attempt is charged (`--max-input-bytes`, and the usage line's "input bytes"): its system and
 *  prompt, UTF-8, and (Gain I, 2026-10-13; C-05 "Gain I") each image it carries as the request holds it, its base64
 *  characters, so an image is counted every time a request sends it. A request without images is charged as before.
 *  The per-request context bound and the time estimate stay text-only: an image's tokens do not scale with its
 *  bytes. */
export function chargedInputBytes(request) {
  const text = (typeof request?.system === 'string' ? Buffer.byteLength(request.system) : 0)
    + (typeof request?.prompt === 'string' ? Buffer.byteLength(request.prompt) : 0);
  const images = Array.isArray(request?.images) ? request.images : [];
  return images.reduce((sum, image) => sum + (typeof image?.data === 'string' ? Buffer.byteLength(image.data) : 0),
    text);
}

/** `--code-model`: the part of a review whose calls, bytes and tokens the usage line also counts on their own (`wrap`
 *  and `record` given it), the code step's. */
export const CODE_STEP_PART = 'code';

/** record receives the transport's single onResult callback for each physical attempt;
 * wrap surrounds the physical transport, inside the exact-answer cache. Never pass this
 * admission signal to the transport: it is for the engine's next windows and requests.
 * `--code-model`: a transport wrapped, and its attempts recorded, with `CODE_STEP_PART` are also tallied on their own,
 * and `summaryLine({ codeModel, sessionModel })` then adds the code step's model and share. With neither, as before. */
export function createReviewBudget(options = {}, { now = () => performance.now() } = {}) {
  const limits = normalizeReviewBudget({ ...options });
  const started = now(), admission = new AbortController();
  let calls = 0, inputBytes = 0, reportedCalls = 0, inputTokens = 0, outputTokens = 0;
  // The code step's share of the counts above, when its calls are on their own model (`--code-model`).
  const code = { calls: 0, inputBytes: 0, inputTokens: 0, outputTokens: 0, inputReportedCalls: 0, outputReportedCalls: 0 };
  // M44: `rateLimit` is the latest attempt's closed rate-limit record that reported a utilization; `utilization`
  // its highest (highestUtilization), which `--stop-at-utilization` compares.
  let inputReportedCalls = 0, outputReportedCalls = 0, utilization = null, rateLimit = null, reason = null;
  // The agent transport: attempts of agent requests (their metadata carries `agentRun`) and the turns they report; and
  // the cost every attempt that states one reports (the CLI's `total_cost_usd`, at list price).
  let agentCalls = 0, turns = 0, turnsReportedCalls = 0, costUsd = 0, costReportedCalls = 0;
  const pause = value => { reason ??= value; admission.abort(); };
  const record = (metadata, part = null) => {
    reportedCalls++;
    if (metadata?.agentRun !== null && typeof metadata?.agentRun === 'object') {
      agentCalls++;
      const reported = metadata.agentRun.numTurns;
      if (count(reported) && count(turns + reported)) { turns += reported; turnsReportedCalls++; }
    }
    if (Number.isFinite(metadata?.costUsd) && metadata.costUsd >= 0) { costUsd += metadata.costUsd; costReportedCalls++; }
    const usage = metadata?.usage;
    // The code step's share is never more than the whole, so it is a count whenever the whole is.
    const ofCode = part === CODE_STEP_PART;
    if (count(usage?.input_tokens)) {
      const extra = metadata?.backend === 'codex-cli' ? []
        : [usage.cache_creation_input_tokens, usage.cache_read_input_tokens].filter(value => value !== undefined);
      const total = usage.input_tokens + extra.reduce((sum, value) => sum + (count(value) ? value : 0), 0);
      if (extra.every(count) && count(total) && count(inputTokens + total)) {
        inputTokens += total; inputReportedCalls++;
        if (ofCode) { code.inputTokens += total; code.inputReportedCalls++; }
      }
    }
    if (count(usage?.output_tokens) && count(outputTokens + usage.output_tokens)) {
      outputTokens += usage.output_tokens; outputReportedCalls++;
      if (ofCode) { code.outputTokens += usage.output_tokens; code.outputReportedCalls++; }
    }
    const latest = highestUtilization(metadata?.rateLimit);
    if (latest !== null) {
      utilization = latest; rateLimit = rateLimitRecordOf(metadata.rateLimit);
      if (limits.stopAtUtilization !== null && latest >= limits.stopAtUtilization) pause(UTILIZATION);
    }
  };
  const snapshot = () => ({ calls, inputBytes, reportedCalls,
    inputTokens: calls === 0 || inputReportedCalls > 0 ? inputTokens : null,
    outputTokens: calls === 0 || outputReportedCalls > 0 ? outputTokens : null,
    inputReportedCalls, outputReportedCalls, utilization, windows: rateLimit?.windows ?? null, reason,
    agentCalls, turns: agentCalls === 0 || turnsReportedCalls > 0 ? turns : null, turnsReportedCalls,
    costUsd: calls === 0 || costReportedCalls > 0 ? costUsd : null, costReportedCalls,
    elapsedMs: Math.max(0, Math.round(now() - started)),
    limits: { maxCalls: limits.maxCalls, maxInputBytes: limits.maxInputBytes, stopAtUtilization: limits.stopAtUtilization } });
  return {
    signal: admission.signal, record, snapshot,
    wrap: (transport, part = null) => async (request, ...args) => {
      const bytes = chargedInputBytes(request);
      if (reason === null && limits.maxCalls !== null && calls >= limits.maxCalls) pause(MAX_CALLS);
      if (reason === null && limits.maxInputBytes !== null && inputBytes + bytes > limits.maxInputBytes) pause(MAX_INPUT_BYTES);
      if (reason !== null) throw failure(BUDGET_EXHAUSTED);
      // Reserve before calling the transport or yielding: concurrent requests cannot overspend.
      calls++; inputBytes += bytes;
      if (part === CODE_STEP_PART) { code.calls++; code.inputBytes += bytes; }
      return transport(request, ...args);
    },
    summaryLine: ({ codeModel = null, sessionModel = null } = {}) => {
      const state = snapshot();
      const tokens = (total, reported, of = calls) => total === null ? `not reported (0/${of} calls reported)`
        : `${total} (${reported}/${of} calls reported)`;
      // The agent transport: the turns its agents took, only when an agent request ran.
      const agentTurns = agentCalls === 0 ? ''
        : `agent turns ${state.turns === null ? 'not reported' : state.turns} (${turnsReportedCalls}/${agentCalls} agent calls `
          + 'reported); ';
      const line = `Review usage: ${calls} calls; ${inputBytes} input bytes; input tokens ${tokens(state.inputTokens, inputReportedCalls)}; `
        + `output tokens ${tokens(state.outputTokens, outputReportedCalls)}; ${agentTurns}wall ${state.elapsedMs} ms; `
        + `utilization ${utilizationWords(rateLimit)}.`;
      if (typeof codeModel !== 'string' || !codeModel) return line;
      // --code-model: the code step's model and its share of the calls, bytes and tokens above (the session's model
      // beside it, when given). Model ids the reviewer's settings accepted, counts and fixed words only.
      const known = (total, reported) => (code.calls === 0 || reported > 0 ? total : null);
      const session = typeof sessionModel === 'string' && sessionModel ? ` (the session on ${sessionModel})` : '';
      return `${line} Code step on ${codeModel}${session}: ${code.calls} of these calls; ${code.inputBytes} input bytes; `
        + `input tokens ${tokens(known(code.inputTokens, code.inputReportedCalls), code.inputReportedCalls, code.calls)}; `
        + `output tokens ${tokens(known(code.outputTokens, code.outputReportedCalls), code.outputReportedCalls, code.calls)}.`;
    },
    pauseLine: () => reason === null ? null : `Review stopped where you asked (${reason}). Run the same command again to resume: `
      + 'stored answers are kept and nothing is asked twice.',
  };
}

/** Time rates (owner decision D84 (4) a, 2026-10-12: the person sees only a rough time; calls and bytes are internal).
 *  Frozen documented literals, never tuned per repo; an estimate, never a limit. A window's minutes are
 *  `minutesAtOneMB` x (its first request's bytes / 1e6) ^ `exponent`: a power law in the request size, in the default
 *  profile (m33-lean) at four lanes. The shown range is that time x `range`, a rough range. A
 *  window whose size is not known is taken at a typical request, `unknownRequestBytes`. `--profile standard` (three
 *  checking passes on every item) checks more and is not covered. Nor are the calls the asks fixes add (2026-10-13), which the plan cannot
 *  know before the answers: S3's re-ask of each requirement the check refuted (a request the size of its window) and
 *  the check of a new status it gives, and S1's whole-window vote in m33-lean; a window where they run can take longer
 *  than its range. */
export const REVIEW_ESTIMATE_RATES = Object.freeze({ minutesAtOneMB: 12.3, exponent: 0.61,
  range: Object.freeze([0.6, 1.7]), unknownRequestBytes: 48_000 });

/** The agentic code step's share of the estimate (code-pass/7): a literal range of minutes added after the session's
 *  windows — one review agent, then its checking agents side by side — until it is timed on real reviews. Reported,
 *  never a limit. */
export const CODE_STEP_ESTIMATE_MINUTES = Object.freeze([3, 15]);

/** The rough time range, in whole minutes, of a review whose windows' first requests are `requestBytes` (one entry per
 *  request, in plan order; an entry that is not a byte count is `unknownRequestBytes`), run `lanes` at a time: each
 *  window starts in the next lane to come free, as the review admits them, and the busiest lane sets the time. Null
 *  when there is nothing to send. D87 (D74: the estimate includes the code pass): `after`, requests run one after
 *  another once the windows are done, each timed by the same rates and added; `extra`, a range of minutes added as it
 *  is (the agentic code step's, CODE_STEP_ESTIMATE_MINUTES). A review with neither is timed as before. */
export function estimateMinutes({ requestBytes = [], lanes, after = [], extra = null } = {}) {
  const sizes = Array.isArray(requestBytes) ? requestBytes : [];
  const later = Array.isArray(after) ? after : [];
  const added = Array.isArray(extra) && extra.length === 2 && extra.every((n) => Number.isSafeInteger(n) && n >= 0)
    ? extra : null;
  if (!sizes.length && !later.length && !added) return null;
  const { minutesAtOneMB, exponent, range: [low, high], unknownRequestBytes } = REVIEW_ESTIMATE_RATES;
  const minutesOf = (bytes) => minutesAtOneMB * ((Number.isFinite(bytes) && bytes >= 0 ? bytes : unknownRequestBytes)
    / 1e6) ** exponent;
  const busy = new Array(Number.isSafeInteger(lanes) && lanes > 0 ? Math.max(1, Math.min(lanes, sizes.length)) : 1).fill(0);
  for (const bytes of sizes) busy[busy.indexOf(Math.min(...busy))] += minutesOf(bytes);
  const minutes = Math.max(...busy) + later.reduce((sum, bytes) => sum + minutesOf(bytes), 0);
  const lo = Math.max(1, Math.round(minutes * low)) + (added?.[0] ?? 0);
  return [lo, Math.max(lo + 1, Math.round(minutes * high) + (added?.[1] ?? 0))];
}

/** One line, before any call: roughly how long this review should take, from its own plan (`estimateMinutes`), and how
 *  to stop it. Time only: no calls, sizes or windows. A dry run (`dryRun`) runs nothing, so its line says only how long
 *  a review would take. */
export function estimateLine({ requestBytes = [], lanes, dryRun = false, after = [], extra = null } = {}) {
  const minutes = estimateMinutes({ requestBytes, lanes, after, extra });
  if (dryRun) return minutes === null ? 'A review would have nothing to send to a model.'
    : `A review should take roughly ${minutes[0]}-${minutes[1]} minutes (less if answers are already stored).`;
  if (minutes === null) return 'This review has nothing to send to a model.';
  return `This review should take roughly ${minutes[0]}-${minutes[1]} minutes (less if answers are already stored). `
    + 'It runs to the end; press Ctrl-C to stop at any point (answers so far are kept and the same command resumes).';
}
