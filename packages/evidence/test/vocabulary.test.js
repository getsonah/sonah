// M66 / M72 / M77: one closed vocabulary per layer, and nothing outside it reaches a reader.
//
// Three separate holes the audit found: gap codes defined as literals in two files and absent
// from the frozen list (M72); judge failure codes collapsed to `model_unavailable` so
// `anthropic_key_missing` was never reportable as itself (M77); and reason strings built with
// dynamic text, which makes a per-reason false-positive rate uncomputable (M66).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { GAP_CODES, JUDGMENT_REASONS, JUDGE_FAILURE_CODES, CLI_SAFE_ERROR_CODES, RETRYABLE_JUDGE_CODES, RUN_FAILURE_CODES,
  UNRECORDED_COVER } from '../src/ledger.js';
import { GAP_SENTENCE, UNRECORDED_COVER_SENTENCE } from '../src/review.js';
import { runReview } from '../src/run-review.js';
import { redisPivotSession, redisPivotPr } from '../fixtures/redis-pivot.js';
import { GITHUB_ERROR_CODES } from '../../github/errors.js';

const HERE = dirname(fileURLToPath(import.meta.url));

// ---------------------------------------------------------------- 1. gap codes are one list

test('M72: the gap phrasebook and the frozen gap list are the same set', () => {
  assert.deepEqual(Object.keys(GAP_SENTENCE).sort(), [...GAP_CODES].sort(),
    'a gap code with no sentence renders as a bare token; a sentence with no code is dead text');
});

test('W3c-10: one sentence per unrecorded-write cover, and one for a write nothing covered', () => {
  assert.deepEqual(Object.keys(UNRECORDED_COVER_SENTENCE).sort(), [...UNRECORDED_COVER, 'none'].sort());
});

// ------------------------------------------------- 2. no reason carries dynamic text

test('M66: every judgment reason and judge failure code is a bare lowercase token', () => {
  for (const r of [...JUDGMENT_REASONS, ...JUDGE_FAILURE_CODES, ...GAP_CODES]) {
    assert.match(r, /^[a-z][a-z_]*$/, `${r} is not a bare token`);
    assert.ok(!r.includes(':'), `${r} carries dynamic text after a colon`);
  }
});

// ------------------------------------------------------ 3. judge failure codes pass through

test('M77: a declared judge failure code reaches the window failure as itself', async () => {
  const session = redisPivotSession();
  const pr = redisPivotPr();
  const throws = (code) => async () => { const e = new Error('x'); e.code = code; throw e; };

  for (const code of JUDGE_FAILURE_CODES) {
    const report = await runReview({ session, pr, judge: throws(code) });
    assert.deepEqual(report.windowFailures, [{ window: 1, reason: code }],
      `${code} was not reported as itself`);
    assert.equal(report.sessionStatus, 'UNCHECKED');
  }
});

test('F86: every retryable judge code is a failure code, so it survives the one retry as itself', async () => {
  // A retryable code that is not a failure code is retried once and then, when the retry fails
  // the same way, collapses to `model_unavailable` in the window failure — M77's asymmetry.
  const strays = RETRYABLE_JUDGE_CODES.filter((code) => !JUDGE_FAILURE_CODES.includes(code));
  assert.deepEqual(strays, [], `retryable but not reportable: ${strays.join(', ')}`);

  const session = redisPivotSession();
  const pr = redisPivotPr();
  for (const code of ['model_timeout', 'model_response_invalid']) {
    const judge = async () => { const e = new Error('x'); e.code = code; throw e; };
    const report = await runReview({ session, pr, judge });
    assert.deepEqual(report.windowFailures, [{ window: 1, reason: code }], `${code} collapsed`);
  }
});

test('M77: an undeclared code still defaults to model_unavailable — the set stays closed', async () => {
  const session = redisPivotSession();
  const pr = redisPivotPr();
  const judge = async () => { const e = new Error('x'); e.code = 'something_new_from_a_backend'; throw e; };
  const report = await runReview({ session, pr, judge });
  assert.deepEqual(report.windowFailures, [{ window: 1, reason: 'model_unavailable' }]);
});

// ---------------------------------------------------- 4. the CLI's own safe-error vocabulary
//
// F47/F48: the CLI's `safe` set and RETRYABLE_JUDGE_CODES used to be literals declared away from
// JUDGE_FAILURE_CODES — one an inline `new Set([...])` in the CLI, the other a copy in
// review-judge.js with a comment saying it belonged here. Both are frozen exports in this file's
// constants block now, so a per-reason false-positive rate stays computable for them too.

const HERE_CLI = join(HERE, '..', '..', 'cli', 'src');

test('F47: every code the review command raises before the "Review could not complete:" catch is a member',
  async () => {
  // Read-only: the CLI belongs to this same spec's CLI ownership region, but this test proves the
  // constant by parsing the actual source rather than trusting a hand-kept list. D82 step 10: the
  // PR route (pr-review.js) is removed; the session review command (`failure(code)`), the review
  // store and call bound it calls (session-review.js, `error(code)` and `failure(code)`) and the PR
  // comment's sharing (pr-sharing.js, `GitHubError(code)`) are read instead.
  const source = await readFile(join(HERE_CLI, 'session-review-command.js'), 'utf8')
    + await readFile(join(HERE_CLI, 'session-review.js'), 'utf8')
    + await readFile(join(HERE_CLI, 'pr-sharing.js'), 'utf8');
  const codes = [...source.matchAll(/\b(?:error|failure|GitHubError)\('([a-z][a-z_]*)'\)/g)].map((m) => m[1])
    // parseSessionReviewArgs' own `usage` error is caught before argv even resolves to a session —
    // it is printed as `usage: ...`, never reaches the "Review could not complete:" catch, and so
    // is not a member of this vocabulary.
    .filter((c) => c !== 'usage');
  assert.ok(codes.length > 0, 'the review command moved or stopped using its error(code) helpers');
  // B4: operational pauses use the already-closed run interruption vocabulary, as the CLI catch does.
  const members = new Set([...CLI_SAFE_ERROR_CODES, ...GITHUB_ERROR_CODES, ...RUN_FAILURE_CODES,
    ...JUDGE_FAILURE_CODES]);
  const strays = codes.filter((c) => !members.has(c));
  assert.deepEqual(strays, [],
    `the review command can raise a code the reader can never see named: ${strays.join(', ')}`);
});

test('F47/F48: CLI_SAFE_ERROR_CODES and RETRYABLE_JUDGE_CODES are frozen, bare lowercase tokens', () => {
  assert.ok(Object.isFrozen(CLI_SAFE_ERROR_CODES));
  assert.ok(Object.isFrozen(RETRYABLE_JUDGE_CODES));
  for (const c of [...CLI_SAFE_ERROR_CODES, ...RETRYABLE_JUDGE_CODES]) {
    assert.match(c, /^[a-z][a-z_]*$/, `${c} is not a bare token`);
    assert.ok(!c.includes(':'), `${c} carries dynamic text after a colon`);
  }
});

test('F48: review-judge.js re-exports the one RETRYABLE_JUDGE_CODES declared here', async () => {
  const mod = await import(pathToFileURL(join(HERE_CLI, 'review-judge.js')));
  assert.equal(mod.RETRYABLE_JUDGE_CODES, RETRYABLE_JUDGE_CODES, 'must be the same frozen array, not a second copy');
});

// ------------------------------------------ 5. a judge failure reaches the reader as a closed word
//
// W3e-6 / F214: `invalid_model_input` — the judge refusing a request its transport cannot carry,
// before anything is sent — was not a failure code, so a window read `model_unavailable` with no
// class. Every declared code now reaches a narrative shortfall in the closed list, that shortfall has
// its one sentence and its one completion token, and this refusal has its own of each.

test('F214: every judge failure code maps to a closed narrative shortfall, sentence and completion token', async () => {
  const { NARRATIVE_SHORTFALL, WINDOW_INCOMPLETE_REASONS } = await import('../src/run-review.js');
  const { SHORTFALL_SENTENCE } = await import('../src/review.js');
  const session = redisPivotSession();
  const pr = redisPivotPr();
  const seen = {};
  for (const code of JUDGE_FAILURE_CODES) {
    const judge = async () => { const e = new Error('x'); e.code = code; throw e; };
    const [window] = (await runReview({ session, pr, judge })).windowResults;
    assert.equal(window.failure, code);
    const said = window.shortfall.narrative;
    assert.ok(NARRATIVE_SHORTFALL.includes(said) && said !== 'ok', `${code} → ${said}`);
    assert.equal(typeof SHORTFALL_SENTENCE[said], 'string', `${code} → ${said} has no sentence`);
    assert.ok(WINDOW_INCOMPLETE_REASONS.includes(`narrative:${said}`), `${code} → ${said} has no completion token`);
    seen[code] = said;
  }
  assert.equal(seen.invalid_model_input, 'input_invalid', 'a request never sent is not a model that could not be reached');
  assert.ok(!RETRYABLE_JUDGE_CODES.includes('invalid_model_input'), 'an identical request is refused identically');
});

// F216 (W3f-1): the transport's own two codes for a reply it could not take whole —
// `model_output_limit` (longer than the output ceiling) and `model_response_incomplete` (the API
// stopped before `end_turn`) — were not failure codes, so a window read `model_unavailable`: told
// the model could not be reached, when it answered at length. Each is named as itself now, with
// its own narrative shortfall, sentence and completion token. Driven through the real transport.
test('F216: an output-limit and an incomplete reply are named as themselves, never model_unavailable', async () => {
  const { NARRATIVE_SHORTFALL, WINDOW_INCOMPLETE_REASONS } = await import('../src/run-review.js');
  const { SHORTFALL_SENTENCE, renderReview } = await import('../src/review.js');
  const { createReviewJudge } = await import(pathToFileURL(join(HERE, '..', '..', 'cli', 'src', 'review-judge.js')));
  const api = { config: { backend: 'anthropic-api', model: 'claude-synthetic-1' }, env: { ANTHROPIC_API_KEY: 'synthetic' } };
  const cases = [
    ['model_output_limit', 'output_limit', 'output_limit',
      createReviewJudge({ ...api, maxOutputBytes: 1, fetchImpl: async () => new Response('{"synthetic":"reply"}') })],
    ['model_response_incomplete', 'response_incomplete', null,
      createReviewJudge({ ...api, fetchImpl: async () => new Response(JSON.stringify({ stop_reason: 'max_tokens',
        content: [{ type: 'text', text: '{"decisions":' }] })) })],
  ];
  for (const [code, token, transport, judge] of cases) {
    assert.ok(JUDGE_FAILURE_CODES.includes(code), `${code} is a declared failure code`);
    assert.ok(NARRATIVE_SHORTFALL.includes(token), `${token} is a narrative shortfall`);
    assert.ok(WINDOW_INCOMPLETE_REASONS.includes(`narrative:${token}`), `${token} has a completion token`);
    assert.equal(typeof SHORTFALL_SENTENCE[token], 'string', `${token} has a sentence`);
    const report = await runReview({ session: redisPivotSession(), pr: redisPivotPr(), judge });
    const [window] = report.windowResults;
    assert.equal(window.failure, code);
    assert.equal(window.shortfall.narrative, token);
    assert.equal(window.shortfall.transport, transport);
    assert.deepEqual(report.instrument.windowCompletion.byReason, { [`narrative:${token}`]: 1 });
    const md = renderReview(report);
    assert.ok(md.includes(SHORTFALL_SENTENCE[token]), `the reader is told what happened to ${code}`);
    assert.ok(!md.includes(SHORTFALL_SENTENCE.model_unavailable), 'never that the model could not be reached');
  }
  assert.notEqual(SHORTFALL_SENTENCE.output_limit, SHORTFALL_SENTENCE.response_incomplete);
});
