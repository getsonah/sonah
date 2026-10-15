// Owner decision 2026-10-13: `sonah review` with no --profile runs the default setting (m33-lean); `--profile standard`
// stays selectable. The default is a name only: no profile's definition moved, so a
// review naming nothing sends exactly the requests `--profile m33-lean` sends, and `--profile standard` sends exactly
// what the same command sends when the review is given no profile name at all (the library's own default, whose plan
// the *-baseline tests pin).
//
// Synthetic sessions and a deterministic fake transport only: no recording, no model, no network.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { canonicalJson } from '../../evidence/contracts/canonical.js';
import { planWindowRequests, runProfile } from '../../evidence/src/run-review.js';
import { REVIEW_SPEED_PROFILE_NAMES, reviewSpeedProfile } from '../../evidence/src/review-profiles.js';
import { DEFAULT_REVIEW_PROFILE, DEFAULT_REVIEW_CONCURRENCY, parseSessionReviewArgs, runSessionReviewCommand }
  from '../src/session-review-command.js';
import { reviewSession, sessionProfileDigest } from '../src/session-review.js';
import { fixtureJudge, manyWindowSession, turnNarrative, turnSession, windowNarrative }
  from './m33-fast-profile-fixture.js';

const LEAN = 'm33-lean';
const sha256 = (text) => createHash('sha256').update(text).digest('hex');

test('the parsed default profile is m33-lean; standard and every other name still parse', () => {
  assert.equal(DEFAULT_REVIEW_PROFILE, LEAN);
  assert.ok(REVIEW_SPEED_PROFILE_NAMES.includes(DEFAULT_REVIEW_PROFILE));
  assert.equal(parseSessionReviewArgs([]).profile, LEAN);
  assert.deepEqual(parseSessionReviewArgs([]), parseSessionReviewArgs(['--profile', LEAN]));
  assert.deepEqual(parseSessionReviewArgs(['--dry-run', '--backend', 'codex-cli']),
    parseSessionReviewArgs(['--dry-run', '--backend', 'codex-cli', '--profile', LEAN]));
  for (const name of REVIEW_SPEED_PROFILE_NAMES)
    assert.equal(parseSessionReviewArgs(['--profile', name]).profile, name);
  // The lanes: four by default, as releases are checked (DEFAULT_REVIEW_CONCURRENCY); --concurrency N up to the
  // profile's lanes (twelve for the default, three with standard); a named standard keeps its own lanes.
  assert.equal(DEFAULT_REVIEW_CONCURRENCY, 4);
  assert.equal(parseSessionReviewArgs([]).concurrency, 4);
  assert.equal(parseSessionReviewArgs(['--profile', LEAN]).concurrency, 4);
  assert.equal(parseSessionReviewArgs(['--profile', 'standard']).concurrency, undefined);
  assert.equal(parseSessionReviewArgs(['--concurrency', '12']).concurrency, 12);
  assert.equal(parseSessionReviewArgs(['--concurrency', '1']).concurrency, 1);
  assert.equal(parseSessionReviewArgs(['--profile', 'standard', '--concurrency', '3']).concurrency, 3);
  assert.throws(() => parseSessionReviewArgs(['--profile', 'standard', '--concurrency', '4']), { code: 'usage' });
  // No profile's definition moved: the library's own default (naming nothing) is still standard.
  assert.equal(reviewSpeedProfile(), reviewSpeedProfile('standard'));
  assert.equal(canonicalJson(runProfile('session-only')), canonicalJson(runProfile('session-only', 'standard')));
  for (const backend of [undefined, 'codex-cli']) {
    assert.equal(sessionProfileDigest(parseSessionReviewArgs([]).profile, backend),
      sessionProfileDigest(LEAN, backend));
    assert.notEqual(sessionProfileDigest(LEAN, backend), sessionProfileDigest(undefined, backend));
    assert.equal(sessionProfileDigest('standard', backend), sessionProfileDigest(undefined, backend));
  }
});

const CASES = [
  { name: 'turn', session: turnSession, narrativeOf: () => turnNarrative() },
  { name: 'lanes', session: () => manyWindowSession(4), narrativeOf: (session, request) => windowNarrative(session,
    request.window) },
];

/** Every request `sonah review` sends for `argv`, as each request's JSON bytes, sorted. Sorted because one lane does not
 *  fix the order: a challenge's passes start together and each reads the answer store first (answer-cache.js
 *  `memoizeJudge`), so which reaches the lane first follows the disk; under load p2 can be sent before p1. `runSession`
 *  stands in for the review the command runs (the real one unless a test wraps it). */
async function sent(t, { session, narrativeOf }, argv, runSession = reviewSession) {
  const dir = await mkdtemp(join(tmpdir(), 'sonah-lean-default-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const home = join(dir, 'home'), repo = join(dir, 'repo'), file = join(dir, 'recording.jsonl');
  await mkdir(home); await mkdir(repo); await writeFile(file, '{}\n');
  const env = { HOME: home, SONAH_HOME: join(home, '.sonah'), CODEX_HOME: join(home, 'codex'),
    SONAH_CLAUDE_PROJECTS: join(home, 'claude-projects') };
  const seen = [], quiet = { write: () => {} };
  const judge = fixtureJudge({ narrativeOf: (request) => narrativeOf(session, request), seen });
  // The session's requests alone: the code step (on by default, owner decision 2026-10-14) is turned off by its flag.
  const code = await runSessionReviewCommand([file, '--concurrency', '1', '--no-code-pass', ...argv], { stdout: quiet, stderr: quiet,
    cwd: repo, env, installSignals: false, runSession, loadReviews: async () => new Map(), openPage: async () => {},
    loadSession: async () => ({ session, hash: sha256('synthetic') }),
    createJudge: ({ onResult, config }) => async (request) => {
      onResult({ ok: true, backend: config.backend, attestation: config.backend === 'claude-cli' ? 'attested'
        : 'unattested', contextWindow: config.backend === 'claude-cli' ? 1_000_000 : null });
      return judge(request);
    } });
  assert.equal(code, 0);
  return seen.map((request) => JSON.stringify(request)).sort();
}

test('a review with no --profile sends the requests --profile m33-lean sends, byte for byte; standard its own',
  async (t) => {
    for (const c of CASES) {
      for (const backend of [[], ['--backend', 'codex-cli', '--model', 'synthetic-model']]) {
        const session = c.session();
        const label = `${c.name} ${backend.join(' ') || 'claude-cli'}`;
        const byDefault = await sent(t, { ...c, session }, backend);
        const lean = await sent(t, { ...c, session }, [...backend, '--profile', LEAN]);
        const standard = await sent(t, { ...c, session }, [...backend, '--profile', 'standard']);
        assert.ok(byDefault.length > 0, label);
        assert.deepEqual(byDefault, lean, label);
        assert.notDeepEqual(standard, lean, `${label}: the two settings send different checks`);
        // `--profile standard` sends what the review sends when it is given no profile name (the library default).
        const unnamed = await sent(t, { ...c, session }, [...backend, '--profile', 'standard'],
          (args) => reviewSession({ ...args, speedProfile: undefined }));
        assert.deepEqual(standard, unnamed, `${label}: standard is the library default`);
        // The narrative requests the command plans under each name are its library plan's for that name; standard's
        // are the library default's (naming nothing), the bytes the baseline tests pin.
        const plan = (speedProfile) => planWindowRequests({ session, reviewScope: 'session-only',
          backend: backend.length ? 'codex-cli' : 'claude-cli', speedProfile })
          .requests.map(({ request }) => JSON.stringify(request));
        assert.deepEqual(plan(DEFAULT_REVIEW_PROFILE), plan(LEAN), label);
        assert.deepEqual(plan('standard'), plan(undefined), label);
      }
    }
  });
