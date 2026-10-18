// W3f-1 (D60). One reuse rule: the same request bytes get the same answer, and nothing else is
// reused. Every model answer is a function of the exact bytes sent and of who answered them;
// everything the review does with an answer — parsing, grounding, receipt verification, relevance,
// challenge bookkeeping, coverage — is deterministic code that re-runs on every review. So a
// request this recording's reviews have already sent, byte for byte, to the same backend and model
// is given the answer it got then, with no call; any other request is a live call.
//
// What it stores: model answers only. It never stores request
// text (the request is rebuilt from the recording on every review; a copy here would double the
// private data at rest), and never an answer the judge did not return successfully. W3f-2: an
// answer that left its window incomplete is removed at the end of its review (F226, `windowsToReask` in
// session-review.js), and each recording's store is bounded, least recently used first (F228).
import { createHash, randomUUID } from 'node:crypto';
import { constants as fsConstants } from 'node:fs';
import { chmod, lstat, mkdir, open, readdir, rename, rm, utimes } from 'node:fs/promises';
import { join } from 'node:path';
import { REVIEW_AGENT_TRANSPORT_VERSION, REVIEW_TRANSPORT_VERSION, agentRequestOf, agentRunRecord, isAgentRequest,
  reviewAgentKeyArgs, reviewTransportArguments, requestImagesOf } from './review-judge.js';

/** The record format and the key's own shape. A change to either is a new version, never read as this one.
 *  /2: the key binds the transport's own arguments (F227). */
export const ANSWER_CACHE_VERSION = 'sonah.answer-cache/2';

/**
 * Every field of a request the transport actually sends, and so every field of it the key binds.
 * `review-judge.js`: `callLocal` passes `system` as `--system-prompt` and writes `prompt` to stdin;
 * `callApi` sends `system` and one user message whose content is `prompt`. Nothing else of a
 * request leaves this process — not `label`, `schema`, `window`, `evidencePrompt` or `challenge`
 * (a challenge's candidates are inside `prompt`). The backend, the model, the transport version and
 * (W3f-2 / F227) the transport's own arguments — the CLI's argv, the API's URL, version and body
 * fields — are bound beside them, so an argument changed without a version bump is a new question.
 */
export const SENT_FIELDS = Object.freeze(['system', 'prompt']);
/** Gain I (2026-10-13): and a request's images (`images`, review-judge.js `requestImagesOf`), when it carries any —
 *  each bound by its media type and the SHA-256 of its data, beside the transport arguments it changes (the CLI's
 *  argv). A request that carries none is keyed byte for byte as before. */
export const SENT_IMAGE_FIELD = 'images';

const plain = (value) => value !== null && typeof value === 'object' && !Array.isArray(value)
  && [Object.prototype, null].includes(Object.getPrototypeOf(value));
const jsonType = (value) => (value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value);
const typed = (value, type) => (Array.isArray(type) ? type : [type]).some((t) =>
  t === 'integer' ? Number.isSafeInteger(value) : t === 'object' ? plain(value) : t === jsonType(value));

/** The agent transport: a repository's state as the answer key binds it, a SHA-256 in hex. */
export const REPO_STATE = /^[0-9a-f]{64}$/;

/**
 * The agent transport (review-judge.js `isAgentRequest`). An agent request's answer depends on the files its agent read,
 * which no request byte holds, so its key also binds `repoState`: a digest of the repository as it was when the review
 * began (the caller's; a SHA-256 in hex, REPO_STATE). An agent request keyed without one has no key: it is never looked
 * up and never stored. Its key binds REVIEW_AGENT_TRANSPORT_VERSION in place of REVIEW_TRANSPORT_VERSION, and the agent
 * argv the transport spawns it with (`transportArguments`, its agent branch) as `agent` in place of `args`, less the
 * values the key must not hold (`reviewAgentKeyArgs`: each `--add-dir` path, so a moved checkout still replays, and the
 * system prompt, which `system` binds); `repo` is the repository's state. A request that is not an agent request is
 * keyed byte for byte as before. An agent request no transport can send (not claude-cli, malformed, or with images:
 * review-judge.js refuses all three) has no key either.
 */
function agentAnswerKey(request, { backend, model, transportArguments, repoState }) {
  const agent = agentRequestOf(request);
  if (agent === null || backend !== 'claude-cli' || typeof repoState !== 'string' || !REPO_STATE.test(repoState)
      || requestImagesOf(request)?.length !== 0) return null;
  const args = transportArguments({ backend, model, system: request.system, agent, schema: agent.schema });
  if (!Array.isArray(args?.argv)) return null;
  return createHash('sha256').update(JSON.stringify({ v: ANSWER_CACHE_VERSION, transport: REVIEW_AGENT_TRANSPORT_VERSION,
    backend, model, agent: reviewAgentKeyArgs(args.argv), system: request.system, prompt: request.prompt,
    repo: repoState })).digest('hex');
}

/**
 * The key of one request: SHA-256 over a canonical JSON of what the model receives and who
 * answers it — fixed field order, strings as JSON strings. `args` is every argument the transport
 * sends beside the prompt (`reviewTransportArguments`, review-judge.js; `null` for a backend it has
 * no transport for, whose name alone is then bound); a test may pass `transportArguments` to stand
 * for another transport. `null` for a request the transport could not send at all (no string
 * `system` or `prompt`): it is never looked up and never stored. An agent request is keyed by `agentAnswerKey`, with
 * `repoState`.
 */
export function answerKey(request, { backend, model, transportArguments = reviewTransportArguments, repoState = null }) {
  if (typeof request?.system !== 'string' || typeof request?.prompt !== 'string') return null;
  if (isAgentRequest(request)) return agentAnswerKey(request, { backend, model, transportArguments, repoState });
  const images = requestImagesOf(request);
  if (images === null) return null;
  const args = (images.length ? transportArguments({ backend, model, system: request.system, images })
    : transportArguments({ backend, model, system: request.system })) ?? null;
  return createHash('sha256').update(JSON.stringify({ v: ANSWER_CACHE_VERSION, transport: REVIEW_TRANSPORT_VERSION,
    backend, model, args, system: request.system, prompt: request.prompt,
    ...(images.length ? { [SENT_IMAGE_FIELD]: images.map((image) => [image.mediaType,
      createHash('sha256').update(image.data).digest('hex')]) } : {}) })).digest('hex');
}

/**
 * Was this returned successfully? A JSON object — never null, an array or a scalar — in the shape
 * the request's own schema declares at its top level: every required member present, every
 * present member of its declared JSON type, and nothing outside a closed schema. A reply that is
 * not the object the request asked for is an invalid response, and is asked again next time.
 * Everything below the top level is judged by the review itself, identically, whether the answer
 * came live or from here.
 *
 * M33 I1: this verdict is the consumer's own at the top level, for every request a review sends —
 * each request schema is closed exactly where its consumer reads it closed — so an answer kept here
 * is never one its review rejects (which would be replayed on every later review). `get` applies it
 * again on every read, so an answer an earlier, looser rule kept is a miss and is asked again. The
 * one difference runs the other way: a `writtenClaims` value that is not a list (C-06 written
 * statements) is read as one unreadable statement beside the rest of the answer, and the answer is
 * not kept (m33-i1-answer-agreement.test.js).
 */
export function answerStorable(request, response) {
  if (!plain(response)) return false;
  const schema = request?.schema;
  if (!plain(schema)) return true;
  const properties = plain(schema.properties) ? schema.properties : {};
  if (schema.additionalProperties === false && Object.keys(response).some((key) => !Object.hasOwn(properties, key)))
    return false;
  if ((Array.isArray(schema.required) ? schema.required : []).some((key) => !Object.hasOwn(response, key))) return false;
  return Object.entries(properties).every(([key, child]) => !Object.hasOwn(response, key)
    || child?.type === undefined || typed(response[key], child.type));
}

/**
 * W3f-2 / F228. The most one recording's stored answers may occupy on disk. A frozen literal, like
 * every other bound here: no flag, no environment variable, no per-repo tuning. After each review
 * the least recently used answers (oldest modification time; a hit refreshes it) are removed until
 * the recording's directory fits. A removed answer costs one call the next time it is asked.
 */
export const ANSWER_STORE_MAX_BYTES = 64 * 1024 * 1024;

/** The name of one stored answer, `<key>.<occurrence>.json`. Nothing else in the directory is one. */
const RECORD_NAME = /^[a-f0-9]{64}\.(?:0|[1-9]\d*)\.json$/;

const isOccurrence = (n) => Number.isSafeInteger(n) && n >= 0;
const isKey = (key) => typeof key === 'string' && /^[a-f0-9]{64}$/.test(key);

/** M33: a regular file this process's user owns, with no group or other permission bit. */
const ownerOnly = (info, uid) => info.isFile() && info.uid === uid && (info.mode & 0o077) === 0;

/**
 * M33. The text of a stored answer, or null. Only a regular file owned by this process's user with
 * no group or other permission bit is read, through a handle that cannot follow a link, and only
 * when the handle is the file `lstat` saw: an answer planted under a shared or loosened
 * `SONAH_HOME`, or a link to one, is never replayed. A platform with no user id reads nothing.
 */
async function readOwnerOnly(path) {
  const uid = typeof process.getuid === 'function' ? process.getuid() : null;
  if (!Number.isSafeInteger(uid)) return null;
  let handle = null;
  try {
    const seen = await lstat(path);
    if (!ownerOnly(seen, uid)) return null;
    handle = await open(path, fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0));
    const info = await handle.stat();
    if (!ownerOnly(info, uid) || info.ino !== seen.ino || info.dev !== seen.dev) return null;
    return await handle.readFile('utf8');
  } catch { return null; }
  finally { await handle?.close().catch(() => {}); }
}

/**
 * `SONAH_HOME/answers/<session digest>/`: one file per (key, occurrence), `{ key, occurrence,
 * response }` and nothing else — and, for an agent request (the agent transport /2, D105), `run`: what the agent read
 * (review-judge.js `agentRunRecord`: its turns, its tool uses and each Read's path and lines; paths and counts only).
 * An agent answer with no such run is never stored, and a stored one without it is a miss; a hit sets it again on the
 * answer, not enumerable, as the transport does (`agentRun`). Mode 0700 for the directory, 0600 for every file, written to a
 * private temp file and renamed into place. A file that cannot be read or parsed, or whose key or
 * occurrence is not the one asked for, or whose response is not storable, is a miss — never an
 * error: the request is simply asked live, and its answer replaces the file.
 *
 * `occurrence`: the n-th time ONE review sends the same bytes. The three challenge passes send
 * one request three times on purpose, for three independent votes; each pass has its own stored
 * answer, so one vote is never counted three times.
 *
 * W3f-2 / F228: `maxBytes` (ANSWER_STORE_MAX_BYTES; a test may pass a smaller one) bounds the
 * directory — `prune`, after every review; a hit refreshes its file's modification time.
 *
 * `readOnly` (the code step's reuse dry run): a hit is read and nothing else — no time is
 * touched — and `put`, `remove` and `prune` change nothing. The keys and the record format are the same.
 *
 * `repoState` (the agent transport): the state of the repository the review's agent requests read (REPO_STATE), bound in
 * each agent request's key (`answerKey`); with none, an agent request is never looked up or stored. Every other
 * request's key ignores it.
 */
export function createAnswerCache(directory, { backend, model, transportArguments = reviewTransportArguments,
  maxBytes = ANSWER_STORE_MAX_BYTES, readOnly = false, repoState = null } = {}) {
  if (typeof directory !== 'string' || !directory) throw new TypeError('An answer cache needs a directory');
  if (typeof backend !== 'string' || !backend || typeof model !== 'string' || !model)
    throw new TypeError('An answer cache is keyed by the backend and model that answer');
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 0) throw new TypeError('An answer cache bound is a byte count');
  if (repoState !== null && (typeof repoState !== 'string' || !REPO_STATE.test(repoState)))
    throw new TypeError('A repository state is a SHA-256 in hex');
  const keyOf = (request) => answerKey(request, { backend, model, transportArguments, repoState });
  const pathOf = (key, occurrence) => join(directory, `${key}.${occurrence}.json`);
  return {
    directory,
    keyOf,
    async get(request, occurrence = 0) {
      const key = keyOf(request);
      if (key === null || !isOccurrence(occurrence)) return null;
      const bytes = await readOwnerOnly(pathOf(key, occurrence));
      if (bytes === null) return null;
      let record;
      try { record = JSON.parse(bytes); } catch { return null; }
      if (!plain(record) || record.key !== key || record.occurrence !== occurrence
        || !answerStorable(request, record.response)) return null;
      // D105: an agent answer replays only with its reading record, set on it again as the transport sets it.
      const run = isAgentRequest(request) ? agentRunRecord(record.run) : null;
      if (isAgentRequest(request) && run === null) return null;
      if (run !== null) Object.defineProperty(record.response, 'agentRun', { value: run, enumerable: false,
        configurable: true, writable: true });
      // F228: a hit is a use. Its modification time moves to now, so `prune` removes the answers
      // no review has asked for longest, never one the last review read.
      if (readOnly) return record.response;
      const now = new Date();
      await utimes(pathOf(key, occurrence), now, now).catch(() => {});
      return record.response;
    },
    /** True when the answer was stored. A write that fails costs the next review one call, never this one. */
    async put(request, response, occurrence = 0) {
      if (readOnly) return false;
      const key = keyOf(request);
      if (key === null || !isOccurrence(occurrence) || !answerStorable(request, response)) return false;
      // D105: an agent answer is kept with its reading record, or not at all (a stored one without it is a miss).
      const run = isAgentRequest(request) ? agentRunRecord(response.agentRun) : null;
      if (isAgentRequest(request) && run === null) return false;
      let bytes;
      try { bytes = JSON.stringify({ key, occurrence, response, ...(run !== null ? { run } : {}) }); } catch { return false; }
      const temp = join(directory, `.${randomUUID()}.tmp`);
      let handle = null;
      try {
        await mkdir(directory, { recursive: true, mode: 0o700 });
        await chmod(directory, 0o700);
        // M33: the bytes reach the disk before the name does, so a crash leaves the old answer
        // or the new one, never a torn file under the answer's name.
        handle = await open(temp, 'wx', 0o600);
        await handle.writeFile(bytes);
        await handle.sync();
        await handle.close();
        handle = null;
        await rename(temp, pathOf(key, occurrence));
        return true;
      } catch { return false; }
      finally {
        await handle?.close().catch(() => {});
        await rm(temp, { force: true }).catch(() => {});
      }
    },
    /** W3f-2 / F226. Remove one stored answer, so the next review asks its request again. True when
     *  a file was there to remove; a failure to remove is never an error for the review. */
    async remove(key, occurrence) {
      if (readOnly || !isKey(key) || !isOccurrence(occurrence)) return false;
      try { await rm(pathOf(key, occurrence)); return true; } catch { return false; }
    },
    /**
     * W3f-2 / F228. Bound this recording's store at `maxBytes`: remove the stored answers with the
     * oldest modification time (the name breaks a tie, so the order never depends on the listing)
     * until the rest fit. Only answer records count and only they are removed — never a temp file
     * or anything else found there. `{ removed, bytes }`: how many went, and the bytes that remain.
     * A directory that cannot be read, or a file that cannot be removed, is never an error.
     */
    async prune() {
      if (readOnly) return { removed: 0, bytes: 0 };
      let names;
      try { names = (await readdir(directory)).filter((name) => RECORD_NAME.test(name)); }
      catch { return { removed: 0, bytes: 0 }; }
      const records = [];
      for (const name of names) {
        try {
          const info = await lstat(join(directory, name));
          if (info.isFile()) records.push({ name, size: info.size, mtimeMs: info.mtimeMs });
        } catch { /* removed meanwhile: nothing to count */ }
      }
      records.sort((a, b) => a.mtimeMs - b.mtimeMs || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
      let bytes = records.reduce((sum, r) => sum + r.size, 0), removed = 0;
      for (const record of records) {
        if (bytes <= maxBytes) break;
        try { await rm(join(directory, record.name)); bytes -= record.size; removed++; } catch { /* kept */ }
      }
      return { removed, bytes };
    },
  };
}

/**
 * The judge one review calls through. A request whose bytes were answered before is given that
 * answer; any other is passed to `judge` — the bounded, retrying transport, which is why this sits
 * outside it: a hit takes no limiter slot and starts nothing. A live answer is stored only when
 * `answerStorable`; a thrown failure (timeout, output limit, unreachable, refused) is rethrown and
 * never stored, so the next review asks it again.
 *
 * Occurrences are counted from this wrapper's creation — one per review — and assigned when a
 * request arrives, before anything is awaited, so the passes of one challenge batch take them in
 * the order the challenge queued them. `fresh` skips every lookup and still stores what it gets.
 * With no cache it only counts. `answers` is `{ calls, reused }`: requests sent live (whatever
 * came back) and requests answered from the cache.
 *
 * M33: `touchedFor(belongs)` — the `{ label, key, occurrence }` of every stored answer this review
 * read or wrote for a request whose label `belongs` accepts, in the order the requests were
 * DISPATCHED (never the order answers came back); `answersFor(belongs)` — `{ calls, reused }` over
 * those labels only. Both are copies, in memory only.
 */
export function memoizeJudge(judge, cache = null, { fresh = false } = {}) {
  const asked = new Map();
  // W3f-2 / F226: every stored answer this review read or wrote, with the label of the request it
  // answered — in memory only, for this review's end (`forget`); never written anywhere.
  const touched = [];
  // M33: per label, requests sent live and requests answered from the cache.
  const perLabel = new Map();
  const tally = (label, field) => {
    const counts = perLabel.get(label) ?? { calls: 0, reused: 0 };
    counts[field]++;
    perLabel.set(label, counts);
  };
  let calls = 0, reused = 0, dispatched = 0;
  const memoized = async (request) => {
    const key = cache ? cache.keyOf(request) : null;
    const label = typeof request?.label === 'string' ? request.label : null;
    if (key === null) { calls++; tally(label, 'calls'); return judge(request); }
    // Assigned before anything is awaited: dispatch order and occurrence never depend on timing.
    const occurrence = asked.get(key) ?? 0;
    asked.set(key, occurrence + 1);
    const order = dispatched++;
    if (!fresh) {
      const stored = await cache.get(request, occurrence);
      if (stored !== null) { reused++; tally(label, 'reused'); touched.push({ label, key, occurrence, order }); return stored; }
    }
    calls++;
    tally(label, 'calls');
    const response = await judge(request);
    if (await cache.put(request, response, occurrence)) touched.push({ label, key, occurrence, order });
    return response;
  };
  Object.defineProperty(memoized, 'answers', { enumerable: true, get: () => ({ calls, reused }) });
  Object.defineProperty(memoized, 'touchedFor', { value: (belongs) => touched
    .filter(({ label }) => belongs(label)).sort((a, b) => a.order - b.order)
    .map(({ label, key, occurrence }) => ({ label, key, occurrence })) });
  Object.defineProperty(memoized, 'answersFor', { value: (belongs) => {
    let live = 0, stored = 0;
    for (const [label, counts] of perLabel) if (belongs(label)) { live += counts.calls; stored += counts.reused; }
    return { calls: live, reused: stored };
  } });
  /**
   * W3f-2 / F226. Remove every stored answer this review read or wrote for a request whose label
   * `belongs` accepts, so the next review asks those requests again. Returns how many were removed.
   * The caller decides which labels: the requests of a window an answer left incomplete.
   */
  Object.defineProperty(memoized, 'forget', { value: async (belongs) => {
    if (!cache || typeof cache.remove !== 'function') return 0;
    let removed = 0;
    for (const { label, key, occurrence } of touched)
      if (belongs(label) && await cache.remove(key, occurrence)) removed++;
    return removed;
  } });
  return memoized;
}
