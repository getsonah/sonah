// A review with more calls in flight than Node's default listener limit (10) prints no MaxListenersExceededWarning: each
// call holds one abort listener on the review's run-wide signal until it settles (review-judge.js `cancellationOf`), so
// twelve calls in flight are no leak. The review raises the limit on its own signals to a bound from its concurrency caps
// (REVIEW_SIGNAL_MAX_LISTENERS); a listener past that bound still warns. Synthetic recording and fake transport only.
import test from 'node:test';
import assert from 'node:assert/strict';
import { getMaxListeners } from 'node:events';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { session as recording, toJsonl } from '../../golden/src/build.js';
import { REVIEW_SPEED_PROFILE_NAMES, reviewSpeedProfile } from '../../evidence/src/review-profiles.js';
import { REVIEW_SIGNAL_MAX_LISTENERS, runSessionReviewCommand } from '../src/session-review-command.js';
import { reviewSession } from '../src/session-review.js';

const ASK = 'Read the synthetic file.';
/** The most calls any profile lets a review have in flight at once. */
const MOST_IN_FLIGHT = Math.max(...REVIEW_SPEED_PROFILE_NAMES.map((name) => reviewSpeedProfile(name).maxCallsInFlight));

async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), 'sonah-signal-listeners-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const home = join(directory, 'home'), repo = join(directory, 'repo');
  await mkdir(home); await mkdir(repo);
  const file = join(directory, 'recording.jsonl');
  await writeFile(file, toJsonl(recording({ cwd: repo, sessionId: 'synthetic-listeners', version: '2.1.284' })
    .ask(ASK).read('a.js', 'Synthetic file content.').done()) + '\n');
  const env = { HOME: home, SONAH_HOME: join(home, '.sonah'), CODEX_HOME: join(home, 'codex'),
    SONAH_CLAUDE_PROJECTS: join(home, 'claude-projects') };
  return { file, options: { cwd: repo, env, installSignals: false, loadReviews: async () => new Map(),
    openPage: async () => {}, stdout: { write: () => {} }, stderr: { write: () => {} } } };
}

/** A fake transport that, like the real one, adds one abort listener to the signal it is given for each call and removes
 *  it when the call settles. The first `burst` calls are held until all of them are in flight together. */
function listeningTransport(burst, signals) {
  let waiting = 0, open;
  const together = new Promise((resolve) => { open = resolve; });
  return ({ onResult, config, signal }) => async (request) => {
    signals.add(signal);
    const onAbort = () => {};
    signal.addEventListener('abort', onAbort, { once: true });
    try {
      if (request.burst) {
        if (++waiting === burst) open();
        await together;
      }
      onResult({ ok: true, backend: config.backend, attestation: 'attested', contextWindow: 1_000_000 });
      if (request.burst) return {};
      if (request.challenge) return { votes: request.challenge.items.map(({ key, candidate }) => ({ key,
        verdict: 'not-refuted', explanation: 'The synthetic recording contains the cited read.',
        receipts: candidate.receipts })) };
      const instruction = request.window.events.find((event) => event.kind === 'instruction');
      const action = request.window.events.find((event) => event.kind === 'invocation');
      return { decisions: [], pivots: [], claims: [], requirements: instruction && action ? [{
        text: ASK, instruction: { eventId: instruction.id, role: 'instruction', quote: ASK }, status: 'done',
        deliverable: { eventId: action.id, role: 'action', quote: 'a.js' } }] : [],
        failures: [], notClaims: [], forbiddenEdits: [] };
    } finally { signal.removeEventListener('abort', onAbort); }
  };
}

/** Runs one review whose session step first sends `burst` calls at once through the review's own judge, then reviews
 *  the recording as usual; resolves the exit code, the leak warnings Node emitted and the signals the transport and the
 *  session step were given. */
async function reviewWithBurst(t, burst) {
  const input = await fixture(t);
  const warnings = [], signals = new Set();
  const onWarning = (warning) => { if (warning?.name === 'MaxListenersExceededWarning') warnings.push(warning); };
  process.on('warning', onWarning);
  try {
    const code = await runSessionReviewCommand([input.file, '--no-code-pass'], { ...input.options,
      createJudge: listeningTransport(burst, signals),
      runSession: async (args) => {
        signals.add(args.signal);
        await Promise.all(Array.from({ length: burst }, () => args.judge({ system: '', prompt: '', burst: true })));
        return reviewSession(args);
      } });
    // Node emits a process warning on a later tick.
    await new Promise((resolve) => setImmediate(resolve));
    return { code, warnings, signals };
  } finally { process.off('warning', onWarning); }
}

test('the bound covers every call a profile lets a review have in flight, beside the review\'s own listener', () => {
  assert.ok(MOST_IN_FLIGHT > 10, 'a profile allows more calls in flight than Node\'s default listener limit');
  assert.equal(REVIEW_SIGNAL_MAX_LISTENERS, MOST_IN_FLIGHT + 1);
});

test('a review with more than ten calls in flight on one signal prints no MaxListenersExceededWarning', async (t) => {
  const { code, warnings } = await reviewWithBurst(t, MOST_IN_FLIGHT);
  assert.equal(code, 0);
  assert.deepEqual(warnings.map((warning) => warning.message), []);
});

test('the review\'s signals keep a finite bound, so a listener past it still warns of a leak', async (t) => {
  const { signals } = await reviewWithBurst(t, 1);
  assert.equal(signals.size, 2, 'the transports\' signal and the admission signal');
  for (const signal of signals) assert.equal(getMaxListeners(signal), REVIEW_SIGNAL_MAX_LISTENERS);
});
