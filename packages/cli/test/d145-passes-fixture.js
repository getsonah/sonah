// D145 (0.3.0-beta.7). A recorded session in the recorder's own format (golden/src/build.js), reviewed through the real
// command (`runSessionReviewCommand`: the answer store, the window records, the in-flight limit) with a fake transport,
// under `--profile standard`, so its one window asks 17 requirements in two batches of three passes. `capturePasses`
// returns, per request label, the digest of the bytes sent, its answer key and the occurrence its stored answer is
// filed under, and each window record's answers in order.
//
// It imports only what 0981e645 (the code before D145) already had, so the same file runs on both: the pinned values
// in d145-passes-after-first.test.js were computed ONCE by running it against `git archive 0981e645`.
//
// Every byte here is invented: no recording of a real session, no model, no network. Nothing prints.
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resetIds, session as recording, toJsonl } from '../../golden/src/build.js';
import { answerKey } from '../src/answer-cache.js';
import { runSessionReviewCommand } from '../src/session-review-command.js';

export const D145_ASK = 'SYNTHETIC_D145_ASK: write the seventeen synthetic notes into notes.md and nothing else.';
export const D145_REQUIREMENTS = 17;
const sha16 = (text) => createHash('sha256').update(text).digest('hex').slice(0, 16);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const passOf = (label) => Number(/:p(\d+)$/.exec(label ?? '')?.[1] ?? 0);

/** The recording: one ask, one statement, one file written and its result. A fixed cwd, so its bytes never move. */
export function d145Recording() {
  resetIds();
  return toJsonl(recording({ cwd: '/srv/sonah-d145', sessionId: 'synthetic-d145', version: '2.1.284' })
    .ask(D145_ASK).say('SYNTHETIC_D145_SAID: writing the notes now.')
    .create('notes.md', 'SYNTHETIC_D145_NOTES: seventeen synthetic notes.\n').done()) + '\n';
}

/**
 * The fake transport. A narrative answers with 17 requirements of the one ask; a checking call votes on every item it
 * is asked, `uncertain` in a second pass and `not-refuted` otherwise, and names its request's label in each vote, so a
 * stored answer says which request it answered. `latency(label)`: how long a call takes, in ms. `calls` gets each live
 * request's label, digest and key, in the order the transport received them, and `after`: the labels of the calls that
 * had returned when it was received.
 */
export const d145Transport = ({ calls, latency = () => 0 }) => {
  const returned = [];
  return ({ onResult, config }) => async (request) => {
    calls.push({ label: request.label, digest: sha16(`${request.system}\u0000${request.prompt}`),
      key: answerKey(request, { backend: config.backend, model: config.model }), after: [...returned] });
    try { return await answer(request, { onResult, config, latency }); } finally { returned.push(request.label); }
  };
};

async function answer(request, { onResult, config, latency }) {
  const wait = latency(request.label);
  if (wait > 0) await sleep(wait);
  onResult({ ok: true, backend: config.backend, attestation: 'attested', contextWindow: 1_000_000 });
  if (request.challenge) return { votes: request.challenge.items.map(({ key, candidate }) => ({ key,
    verdict: passOf(request.label) === 2 ? 'uncertain' : 'not-refuted',
    explanation: `SYNTHETIC_D145_VOTE of ${request.label}`, receipts: candidate?.receipts ?? [] })) };
  const instruction = request.window.events.find((event) => event.kind === 'instruction');
  const action = request.window.events.find((event) => event.kind === 'invocation');
  return { decisions: [], pivots: [], claims: [], failures: [], notClaims: [], forbiddenEdits: [],
    requirements: Array.from({ length: D145_REQUIREMENTS }, (_, k) => ({ text: `SYNTHETIC_D145_NOTE_${k + 1}`,
      instruction: { eventId: instruction.id, role: 'instruction', quote: D145_ASK },
      status: 'done', deliverable: { eventId: action.id, role: 'action', quote: 'notes.md' } })) };
}

async function filesUnder(folder) {
  const out = [];
  for (const entry of await readdir(folder, { withFileTypes: true }).catch(() => [])) {
    const path = join(folder, entry.name);
    if (entry.isDirectory()) out.push(...await filesUnder(path));
    else if (entry.isFile()) out.push(path);
  }
  return out;
}

/** One run of the command over `home`'s recording; `{ code, calls, stdout, stderr }`. */
export async function d145Run(home, { latency } = {}) {
  const calls = [];
  const out = { stdout: '', stderr: '' };
  const code = await runSessionReviewCommand([join(home, 'synthetic-d145.jsonl'), '--no-code-pass', '--profile', 'standard'],
    { cwd: join(home, 'repo'), installSignals: false, createJudge: d145Transport({ calls, latency }),
      env: { HOME: home, SONAH_HOME: join(home, '.sonah'), CODEX_HOME: join(home, 'codex'),
        SONAH_CLAUDE_PROJECTS: join(home, 'claude-projects') },
      loadReviews: async () => new Map(), openPage: async () => {},
      stdout: { write: (s) => { out.stdout += s; } }, stderr: { write: (s) => { out.stderr += s; } } });
  return { code, calls, ...out };
}

/** A fresh home holding the recording and an empty repository folder. The caller removes it. */
export async function d145Home() {
  const home = await mkdtemp(join(tmpdir(), 'sonah-d145-'));
  await mkdir(join(home, 'repo'));
  await writeFile(join(home, 'synthetic-d145.jsonl'), d145Recording());
  return home;
}

/**
 * What one live run sent and stored: `requests`, per label (sorted), `[label, digest, key, occurrence]` (digest and
 * key 16 hex characters); `records`, each window record's `answers` as `key16.occurrence`, in its order; `store`, each
 * stored answer file as `[key16.occurrence, digest of its bytes]`; and the run's own `calls` (labels in the order the
 * transport received them). The occurrence of a label is read from the stored answer that names that label, so it is
 * the store's own filing, not a guess from any order.
 */
export async function d145Stored(home) {
  const files = await filesUnder(join(home, '.sonah'));
  const occurrenceOf = new Map();
  const records = [], store = [];
  for (const path of files.sort()) {
    const name = path.split('/').at(-1);
    const answer = /^([0-9a-f]{64})\.(\d+)\.json$/.exec(name);
    if (answer) {
      const bytes = await readFile(path, 'utf8');
      store.push([`${answer[1].slice(0, 16)}.${answer[2]}`, sha16(bytes)]);
      const record = JSON.parse(bytes);
      const label = /^SYNTHETIC_D145_VOTE of (.+)$/.exec(record.response?.votes?.[0]?.explanation ?? '')?.[1];
      occurrenceOf.set(label ?? `narrative ${answer[1].slice(0, 16)}`, { key: answer[1], occurrence: Number(answer[2]) });
    } else if (path.includes('/windows/') && name.endsWith('.json')) {
      const record = JSON.parse(await readFile(path, 'utf8'));
      records.push(record.answers.map(({ key, occurrence }) => `${key.slice(0, 16)}.${occurrence}`));
    }
  }
  return { occurrenceOf, records, store: store.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0)) };
}

/**
 * The capture the pinned values were made from: one live run, then the same command again over the same state. Also
 * `returnedBefore`: per label, the labels whose calls had returned when the transport received it. The order in which
 * the transport receives requests in flight together is not fixed: each first looks up its stored answer
 * (answer-cache.js `memoizeJudge`), and those lookups end in any order. The order they reach the memo is, and the
 * window record lists them in it.
 */
export async function capturePasses({ latency } = {}) {
  const home = await d145Home();
  try {
    const live = await d145Run(home, { latency });
    const { occurrenceOf, records, store } = await d145Stored(home);
    const requests = live.calls.map(({ label, digest, key }) => {
      const stored = label.startsWith('challenge:') ? occurrenceOf.get(label) : occurrenceOf.get(`narrative ${key.slice(0, 16)}`);
      return [label, digest, key.slice(0, 16), stored?.key === key ? stored.occurrence : null];
    }).sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
    const replay = await d145Run(home, { latency });
    const again = await d145Stored(home);
    return { code: live.code, requests, records, store, sent: live.calls.map(({ label }) => label),
      returnedBefore: Object.fromEntries(live.calls.map(({ label, after }) => [label, after])),
      replay: { code: replay.code, calls: replay.calls.length, records: again.records } };
  } finally { await rm(home, { recursive: true, force: true }); }
}

/** A challenge pass's label: its run's prefix, its batch and its pass. */
const PASS_LABEL = /^(.*):b(\d+):p(\d+)$/;
/**
 * D145 rendered back: the requests a review sent, in the order the code before D145 sent them. Each run of consecutive
 * pass requests of one challenge run (one label prefix) is put in batch order, each batch's passes in pass order — what
 * 0981e645 sent; D145 sends every batch's first pass first. Anything else keeps its place.
 */
export function sentBeforeD145(requests) {
  const out = [];
  let block = [];
  const flush = () => {
    out.push(...block.map((request) => ({ request, at: PASS_LABEL.exec(request.label) }))
      .sort((a, b) => Number(a.at[2]) - Number(b.at[2]) || Number(a.at[3]) - Number(b.at[3])).map(({ request }) => request));
    block = [];
  };
  for (const request of requests) {
    const at = PASS_LABEL.exec(request?.label ?? '');
    if (!at || (block.length && PASS_LABEL.exec(block[0].label)[1] !== at[1])) flush();
    if (at) block.push(request); else out.push(request);
  }
  flush();
  return out;
}
/** Capture modules (m33-fast-profile-fixture.js) whose requests are digested in the order before D145. */
export const modulesBeforeD145 = (modules) => ({ ...modules, sentOrder: sentBeforeD145 });
