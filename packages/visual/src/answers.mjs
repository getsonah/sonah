// Layer 2, replay: every answer is stored under its request id and replays from there; only a missing one is asked.
// A reply is read as the last JSON object in its text. If that fails or has the wrong shape, the request is asked once
// more with the problems appended (a new request id); then it abstains with `answer_invalid`.
// Then, if any text or list of the usable answer is over its limit (checks.mjs counts them), one short limit re-ask
// lists exactly those fields with their counts and limits and asks for them only; each re-asked field that now passes
// replaces the first answer's, field by field. What still fails is dropped by the checks.

import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { answerProblems, fixFields, fixRequest, mapAnswerIds, retryRequest } from './requests.mjs';
import { limitFailures, mergeFixes } from './checks.mjs';
import { STOP_ERRORS, TRANSPORT_ERRORS, TransportError } from './transport-claude.mjs';

/** Why a request has no answer (closed): not asked yet, unusable after the re-ask, or the call failed. */
export const ANSWER_ERRORS = Object.freeze(['pending', 'answer_invalid', ...TRANSPORT_ERRORS]);
export const ANSWER_BY = Object.freeze(['claude-cli', 'stand-in']);
export const CONCURRENCY = 3;

const ID = /^[0-9a-f]{64}$/;
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const usable = (r) => isObj(r) && (typeof r.text === 'string' || isObj(r.answer));

/**
 * The store: `<dir>/<id>.json`, one record per request id ({ id, kind, by, model, ms, costUsd, text, answer }).
 * A stand-in may write records with `answer` and no `text`. A file that is not such a record is a miss.
 */
export function answerStore(dir) {
  mkdirSync(dir, { recursive: true });
  return {
    dir,
    get(id) {
      if (!ID.test(id)) return null;
      try {
        const r = JSON.parse(readFileSync(join(dir, `${id}.json`), 'utf8'));
        return usable(r) ? r : null;
      } catch { return null; }
    },
    put(id, record) {
      if (!ID.test(id)) throw new Error('answer store: a request id is 64 hex characters');
      const file = join(dir, `${id}.json`);
      const tmp = `${file}.${process.pid}.tmp`;
      writeFileSync(tmp, JSON.stringify(record, null, 2) + '\n');
      renameSync(tmp, file);
    },
  };
}

/** The end index of the balanced object that opens at `start`, honouring strings; -1 when it never closes. */
function closeOf(text, start) {
  let depth = 0, inStr = false, esc = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === '\\') esc = true;
      else if (ch === '"') inStr = false;
    } else if (ch === '"') inStr = true;
    else if (ch === '{') depth++;
    else if (ch === '}' && --depth === 0) return i;
  }
  return -1;
}

/** The last top-level JSON object in a text (prose and code fences around it are skipped), or null. */
export function lastJsonObject(text) {
  if (typeof text !== 'string') return null;
  let best = null, i = 0;
  while ((i = text.indexOf('{', i)) !== -1) {
    const end = closeOf(text, i);
    if (end !== -1) {
      try {
        const v = JSON.parse(text.slice(i, end + 1));
        if (isObj(v)) { best = v; i = end + 1; continue; }
      } catch { /* not JSON from here: try the next brace */ }
    }
    i++;
  }
  return best;
}

/** A record's raw answer (short ids, as written) and its shape problems. A stand-in's stored `answer` is used as it is. */
function readRecord(request, record) {
  const fromText = typeof record.text === 'string' ? lastJsonObject(record.text) : null;
  const raw = fromText ?? (isObj(record.answer) ? record.answer : null);
  if (raw === null) return { raw: null, fatal: ['no JSON object was found in the answer'], soft: [] };
  if (request.fix) return { raw, fatal: fixFields(request, raw) ? [] : ['the answer has no "fields" object'], soft: [] };
  const { fatal, soft } = answerProblems(request, raw);
  return { raw: fatal.length ? null : raw, fatal, soft };
}

const sum = (xs) => (xs.some(Number.isFinite) ? xs.filter(Number.isFinite).reduce((a, b) => a + b, 0) : null);

/**
 * Answer every request: replay what is stored, ask the transport for the rest, up to `concurrency` at a time.
 * `transport` null means replay only: a missing answer comes back with error 'pending'. After a call fails with a
 * STOP_ERRORS kind no new call starts; the requests not yet asked come back 'pending'. `onRequest(request)` is told of
 * every request looked up, re-asks included, so the job can write it to requests/<id>.json for a stand-in.
 * Returns, in request order: { id, kind, answer, error, by, model, costUsd, ms, replayed, problems, attempts }.
 */
export async function answerAll(requests, { transport = null, store, concurrency = CONCURRENCY, onRequest = null } = {}) {
  const list = (requests ?? []).filter(Boolean);
  const state = { stop: null };
  const results = new Array(list.length);
  let next = 0;
  const worker = async () => {
    while (next < list.length) {
      const i = next++;
      results[i] = await answerOne(list[i], { transport, store, onRequest, state });
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(concurrency, list.length)) }, worker));
  return results;
}

/** The first STOP_ERRORS kind any attempt of these results met, or null: the job stops and says so. */
export function stopOf(results) {
  for (const r of results ?? []) for (const a of r?.attempts ?? []) if (STOP_ERRORS.includes(a.error)) return a.error;
  return null;
}

async function answerOne(request, ctx) {
  const attempts = [];
  const first = await obtain(request, ctx);
  attempts.push(first.attempt);
  if (first.error) return result(request, attempts, null, first.error, []);
  const one = readRecord(request, first.record);
  let raw = null, problems = [], used = 0;
  const problems1 = [...one.fatal, ...one.soft];
  if (!problems1.length) raw = one.raw;
  else {
    // The shape re-ask: the same request with its problems appended.
    const again = retryRequest(request, problems1);
    const second = await obtain(again, ctx);
    attempts.push(second.attempt);
    const two = second.error ? null : readRecord(again, second.record);
    if (two && !two.fatal.length) { raw = two.raw; problems = two.soft; used = 1; }
    // The re-ask failed or is not answered yet: keep the first answer if its shape was usable at all.
    else if (!one.fatal.length) { raw = one.raw; problems = one.soft; }
    else return result(request, attempts, null, second.error ?? 'answer_invalid', problems1);
  }

  // The limit re-ask: once, for the texts and lists over their limits only.
  const failures = limitFailures(request.kind, raw);
  let limits = null;
  if (failures.length) {
    const fix = fixRequest(request, failures);
    const got = await obtain(fix, ctx);
    attempts.push(got.attempt);
    const read = got.error ? null : readRecord(fix, got.record);
    const fields = read && !read.fatal.length ? fixFields(fix, read.raw) : null;
    const merged = mergeFixes(raw, failures, fields);
    raw = merged.answer;
    limits = { over: failures.length, fixed: merged.fixed.length };
  }
  return result(request, attempts, mapAnswerIds(request, raw), null, problems, used, limits);
}

// `used`: the attempt whose answer is kept (a limit re-ask only adds fields to it). `limits`: { over, fixed } when a
// limit re-ask was made.
function result(request, attempts, answer, error, problems, used = attempts.length - 1, limits = null) {
  const a = attempts[used] ?? {};
  return { id: request.id, kind: request.kind, answer, error, by: a.by ?? null, model: a.model ?? null,
    costUsd: sum(attempts.map((x) => x.costUsd)), ms: sum(attempts.map((x) => x.ms)), replayed: a.replayed ?? false,
    problems, attempts, ...(limits ? { limits } : {}) };
}

/** One request's record: from the store, else from one call (stored at once), else an error kind. */
async function obtain(request, { transport, store, onRequest, state }) {
  const base = { id: request.id, by: null, model: null, costUsd: null, ms: null, replayed: false, error: null };
  if (onRequest) await onRequest(request);
  const stored = await store.get(request.id);
  if (stored) {
    return { record: stored, attempt: { ...base, by: stored.by ?? null, model: stored.model ?? null,
      costUsd: Number.isFinite(stored.costUsd) ? stored.costUsd : null, ms: Number.isFinite(stored.ms) ? stored.ms : null,
      replayed: true } };
  }
  if (!transport || state.stop) return { error: 'pending', attempt: { ...base, error: 'pending' } };
  let out;
  try {
    out = await transport(request);
  } catch (e) {
    const kind = e instanceof TransportError || TRANSPORT_ERRORS.includes(e?.kind) ? e.kind : 'call_failed';
    if (STOP_ERRORS.includes(kind)) state.stop ??= kind;
    return { error: kind, attempt: { ...base, error: kind, costUsd: Number.isFinite(e?.costUsd) ? e.costUsd : null,
      ms: Number.isFinite(e?.ms) ? e.ms : null } };
  }
  if (!isObj(out) || typeof out.text !== 'string') return { error: 'call_failed', attempt: { ...base, error: 'call_failed' } };
  const by = ANSWER_BY.includes(out.by) ? out.by : ANSWER_BY.includes(transport.by) ? transport.by : 'claude-cli';
  const record = { v: 1, id: request.id, kind: request.kind, ...(request.retryOf ? { retryOf: request.retryOf } : {}),
    ...(request.fix ? { fix: request.fix } : {}),
    by, model: typeof out.model === 'string' ? out.model : null,
    ms: Number.isFinite(out.ms) ? out.ms : null, costUsd: Number.isFinite(out.costUsd) ? out.costUsd : null,
    text: out.text };
  const parsed = readRecord(request, record);
  if (parsed.raw && !request.fix) record.answer = mapAnswerIds(request, parsed.raw);
  await store.put(request.id, record);
  return { record, attempt: { ...base, by: record.by, model: record.model, costUsd: record.costUsd, ms: record.ms } };
}
