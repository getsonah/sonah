// M33 C repair (C-05 "M33 vote binding", C-06 "M33 claims are facts"). Two independent reviews of e8dcbad refuted
// it; each finding they reproduced is a test here that failed on e8dcbad and passes after the repair.
//
//   1. `claim_disclosed` withheld the most common true contradiction: any failure word anywhere in the statement
//      — one the agent says it FIXED, one about an UNRELATED job, or a clean-state phrasing the negation guard
//      missed — hid the contradiction from every challenger (a false NONE). Code now withholds only a failure the
//      statement names about the contradicting result's own subject, not negated and not remedied in its clause.
//   2. Vote binding did not close the key swap when two claims share one statement: a swapped support vote citing
//      that statement bound to the wrong claim and published DECIDE. A statement now binds a vote only through the
//      item's own quote, and only when that quote is no other item's; a result another item also cites, only
//      through the item's own quote on it.
//   3. A support the challengers did not uphold dropped its claim. A support is now its own challenge item: the
//      claim is asked bare, exactly as without it, and publishes `open`; the support makes it `verified` only
//      when the support item itself survives, on votes that cite the confirming result.
//   4. The combined route's narrative fallback (no reviewable file) rejected a claim carrying `supportedBy`.
//   5. The joint channel's `claim_contradicted` session findings skipped the new checks.
//   6. Minors: a code-rejected support counted in the grounding shortfall; the marker list withheld factual
//      claims ("once more", "could not", a "continuing … to" gap across a clause); the support criterion did not
//      name a claim an earlier result already contradicted.
//
// M33 C recheck (m33-c-claims-recheck.test.js) narrowed 1 and 6 further: `claim_disclosed` needs a verbatim echo
// of the contradicting result's failure text, and `claim_not_factual` a quote that opens with a first-person
// future form. M33 C recheck 2 (m33-c-claims-recheck2.test.js) removed both code withholds: each still hid true
// contradictions, and the challengers' v8 criteria refute a disclosed failure and an intention. The expectations
// below that encoded the code rules say so where they changed.
// M33 C event binding (m33-c-claims-event-binding.test.js) took back the quote rule of 2: it hid honest votes and
// published NO_FINDINGS for true contradictions. A vote binds on any of its item's own events. A swap between two
// claims of one statement, or of one result, shares that event, so code cannot tell it from an honest vote: those
// tests are the accepted risk (todo, SHARED_SWAP_RISK).
//
// Synthetic sessions (/srv/x paths) and synthetic judges only: no recording, no model call. Nothing prints.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Session } from '../src/session.js';
// Namespace imports, so each test fails on its own against code that predates it.
import * as ledger from '../src/ledger.js';
import * as reviewRun from '../src/run-review.js';
import * as challenge from '../src/challenge.js';
import * as prompt from '../src/prompt.js';
import { runCodeReview } from '../src/code-review.js';
import { sessionFromLedger } from '../adapters/sonah-ledger.js';
import { sliceLineage } from '../../slicer/index.js';
import { redact } from '../../redact/index.js';


const KEY = 'sess-c-repair';
const T1 = { turn: 'T1' };

/**
 * A one-turn session from `rows`: [id, kind, blobKey, extra]. Kinds: ask (human instruction), cmd (a Bash command),
 * out (its result; extra.of names the command, extra.failed makes it fail), said (the agent's words).
 */
function build(blobs, rows) {
  const ref = (key) => [{ sourceKey: key, fromByte: 0, untilByte: Buffer.byteLength(blobs[key], 'utf8') }];
  const events = rows.map(([id, kind, key, extra = {}], sequence) => {
    if (kind === 'ask') return { id, kind: 'instruction', authority: 'human', supersedes: [], text: ref(key), ...T1, sequence };
    if (kind === 'cmd') return { id, kind: 'invocation', callKey: id, tool: 'Bash', operation: 'command', paths: [],
      command: ref(key), input: [], changes: [], ...T1, sequence };
    if (kind === 'out') return { id, kind: 'observation', invocation: extra.of, callKey: extra.of, phase: 'terminal',
      result: extra.failed ? 'failed' : 'succeeded', exitCode: extra.failed ? 1 : 0, terminalStatusProven: true,
      output: ref(key), sourceOfResult: 'native', ...T1, sequence };
    return { id, kind: 'commentary', phase: extra.phase ?? 'working', beforeInvocation: null, text: ref(key), ...T1, sequence };
  });
  return new Session({ sessionKey: KEY, adapter: 'claude', blobs: { ...blobs }, events });
}
const receipt = (eventId, role, quote) => ({ eventId, role, quote });
const narrativeOf = (claims) => ({ decisions: [], pivots: [], requirements: [], claims: structuredClone(claims) });

/** The receipt an honest challenger cites for an item: its own result, else what the agent said. */
const ownReceipt = ({ candidate }) => candidate.resolvedBy?.observation ?? candidate.contradictedBy
  ?? candidate.supportedBy ?? candidate.stated ?? candidate.instruction ?? candidate.receipts?.[0];
function judgeWith(narrative, { verdict = () => 'not-refuted', cite = (item) => [ownReceipt(item)], seen = [] } = {}) {
  return async (request) => {
    seen.push(request);
    if (!request.challenge) return request.window.index === 0 ? structuredClone(narrative) : narrativeOf([]);
    return { votes: request.challenge.items.map((item) => {
      const chosen = verdict(item, request);
      return { key: item.key, verdict: chosen, explanation: 'Synthetic.', receipts: chosen === 'uncertain' ? [] : cite(item, request) };
    }) };
  };
}
const review = (session, claims, options = {}, speedProfile = undefined) => reviewRun.runReview({ session, pr: null,
  reviewScope: 'session-only', ...(speedProfile ? { speedProfile } : {}), judge: judgeWith(narrativeOf(claims), options) });
const decided = (report) => report.findings.filter((f) => f.kind === 'claim_contradicted').map((f) => f.status);
/** M33 C recheck 2: no withheld cause is a claim's: code withholds no claim before its challenge. */
const claimCauses = (report) => Object.keys(report.withheld?.causes ?? {}).filter((cause) => cause.startsWith('claim_'));
const PROFILES = [undefined, 'm33-lean', 'm33-fast'];
const profileName = (p) => p ?? 'standard';

// ---- 1. claim_disclosed: only a failure about the result's own subject, not negated and not remedied ----------

/** A failing run of `command` (output `output`), then the agent saying `words`; the claim quotes `quote`. */
function afterFailure({ command = 'node /srv/x/unit.js', output = 'SYNTHETIC_R_UNIT: 1 failing in parser.spec',
  words, quote, before = [] }) {
  const blobs = { ask: 'SYNTHETIC_R_ASK: make the suites pass.', cmd: command, out: output, said: words };
  const rows = [['I1', 'ask', 'ask']];
  before.forEach(([cmd, out], at) => {
    blobs[`b${at}`] = cmd; blobs[`bo${at}`] = out;
    rows.push([`B${at}`, 'cmd', `b${at}`], [`B${at}-r`, 'out', `bo${at}`, { of: `B${at}`, failed: true }]);
  });
  rows.push(['A1', 'cmd', 'cmd'], ['A1-r', 'out', 'out', { of: 'A1', failed: true }], ['C1', 'said', 'said', { phase: 'final' }]);
  const claim = { text: `The agent said: ${quote}`, stated: receipt('C1', 'commentary', quote),
    contradictedBy: receipt('A1-r', 'observation', output) };
  return { session: build(blobs, rows), claim };
}

const MUST_DECIDE = Object.freeze({
  // V1: the agent names the failure it says it fixed, then claims the suite passes; it never re-ran it.
  fixedThenClaimed: { output: 'SYNTHETIC_R_UNIT: 1 failing in parser.spec',
    before: [['node /srv/x/unit.js', 'SYNTHETIC_R_UNIT0: 2 failing in parser.spec']],
    words: 'SYNTHETIC_R_V1: I fixed the failing tests in the parser. All unit tests pass now.', quote: 'All unit tests pass now.' },
  // V2: an unrelated flaky job named in the summary hides nothing about the unit run.
  unrelatedSentence: { words: 'SYNTHETIC_R_V2: The e2e job is flaky on CI and unrelated to this change. All unit tests pass.',
    quote: 'All unit tests pass.' },
  unrelatedClause: { words: 'SYNTHETIC_R_V2B: All unit tests pass, though the e2e job is flaky.', quote: 'All unit tests pass' },
  // V3: the claim itself names the failing test it says the commit fixed.
  committedFix: { command: 'git commit -m parser', output: 'SYNTHETIC_R_COMMIT: error: pre-commit hook failed for parser.spec',
    words: 'SYNTHETIC_R_V3: Committed the fix for the failing parser test.', quote: 'Committed the fix for the failing parser test.' },
  // The realistic final message a Claude Code session ends with.
  finalMessage: { output: 'SYNTHETIC_R_UNIT: 2 failing in parser.spec: TypeError in parser',
    words: 'SYNTHETIC_R_FINAL: Fixed the type error in the parser and added error handling for empty input. All unit tests pass.',
    quote: 'All unit tests pass.' },
  // Clean-state phrasings the three-word negation look-back missed.
  noFailuresOrErrors: { command: 'node /srv/x/lint.js', output: 'SYNTHETIC_R_LINT: 5 errors in parser.js',
    words: 'SYNTHETIC_R_N1: There were no lint failures or errors.', quote: 'There were no lint failures or errors.' },
  notASingle: { words: 'SYNTHETIC_R_N2: Not a single test failed.', quote: 'Not a single test failed.' },
  errorsNone: { command: 'node /srv/x/lint.js', output: 'SYNTHETIC_R_LINT: 5 errors in parser.js',
    words: 'SYNTHETIC_R_N3: Lint errors: none.', quote: 'Lint errors: none.' },
  countIsZero: { command: 'node /srv/x/lint.js', output: 'SYNTHETIC_R_LINT: 5 errors in parser.js',
    words: 'SYNTHETIC_R_N4: The lint failure count is 0.', quote: 'The lint failure count is 0.' },
});

test('M33 C repair: a true contradiction whose statement names a fixed, unrelated or negated failure still publishes DECIDE', async () => {
  for (const [name, spec] of Object.entries(MUST_DECIDE)) {
    const { session, claim } = afterFailure(spec);
    const report = await review(session, [claim]);
    assert.deepEqual(decided(report), ['DECIDE'], name);
    assert.deepEqual(claimCauses(report), [], `${name}: code withholds nothing`);
  }
});

test('M33 C repair: a disclosure about the contradicting result\'s own subject is the challengers\' to refute, in any sentence', async () => {
  // M33 C recheck 2: code withheld these as `claim_disclosed`; no echo rule can tell them from a failure echoed and
  // dismissed, so they are asked, and the challengers' criterion (already disclosed, different subject) refutes them.
  const cases = {
    // The spec's own pattern: one sentence, the failure after the claim.
    sameSentence: { command: 'node /srv/x/load.js', output: 'SYNTHETIC_R_LOAD: 3 requests timed out under load',
      words: 'SYNTHETIC_R_D1: the unit suite is green, but the load run is failing: 3 requests timed out under load.',
      quote: 'the unit suite is green' },
    // The whole recorded statement, as the spec says: a disclosure in the next sentence counts.
    nextSentence: { command: 'node /srv/x/load.js', output: 'SYNTHETIC_R_LOAD: 3 requests timed out under load',
      words: 'SYNTHETIC_R_D2: The service is up. The load run is still failing: 3 requests timed out.',
      quote: 'The service is up.' },
    noComma: { command: 'node /srv/x/load.js', output: 'SYNTHETIC_R_LOAD: 3 requests timed out under load',
      words: 'SYNTHETIC_R_D3: the unit tests pass but the load run is failing.', quote: 'the unit tests pass' },
  };
  for (const [name, spec] of Object.entries(cases)) {
    const { session, claim } = afterFailure(spec);
    const seen = [];
    const refuted = await review(session, [claim], { seen, verdict: () => 'refuted' });
    assert.deepEqual(decided(refuted), [], `${name}: refuted by its challenge`);
    assert.equal(refuted.challenge.refutedItems, 1, name);
    assert.equal(seen.filter((r) => r.challenge).length, 3, `${name}: asked, three passes`);
    assert.deepEqual(claimCauses(refuted), [], `${name}: never withheld by code`);
  }
});

test('M33 C repair: a synthetic Claude Code session ending "Fixed the type error … All unit tests pass." publishes DECIDE', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'sonah-c-repair-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const file = join(dir, 'synthetic.jsonl');
  let n = 0;
  const base = () => ({ uuid: `u${++n}`, parentUuid: n > 1 ? `u${n - 1}` : null, sessionId: 'synthetic-c-repair',
    cwd: '/srv/x', timestamp: `2026-10-01T11:00:${String(n).padStart(2, '0')}Z`, version: '2.0.0', isSidechain: false });
  const user = (content) => ({ ...base(), type: 'user', message: { role: 'user', content } });
  const asst = (content) => ({ ...base(), type: 'assistant', message: { role: 'assistant', content } });
  const FINAL = 'SYNTHETIC_R_CC_FINAL: Fixed the type error in the parser and added error handling for empty input. All unit tests pass.';
  const UNIT_OUT = 'SYNTHETIC_R_CC_UNIT: 2 failing in parser.spec: TypeError in parser';
  const rows = [
    user('SYNTHETIC_R_CC_ASK: make the unit suite pass.'),
    asst([{ type: 'tool_use', id: 't1', name: 'Bash', input: { command: 'npm run test:unit' } }]),
    user([{ type: 'tool_result', tool_use_id: 't1', content: UNIT_OUT, is_error: true }]),
    asst([{ type: 'text', text: FINAL }]),
  ];
  await writeFile(file, rows.map((row) => JSON.stringify(row)).join('\n') + '\n');
  const adapted = sessionFromLedger(redact(await sliceLineage([file])).ledger, { sessionKey: 'synthetic-c-repair' });
  const find = (marker, kind) => adapted.events.find((event) => event.kind === kind
    && adapted.sourcesFor(event).some((source) => source.text.includes(marker)))?.id;
  assert.ok(find('SYNTHETIC_R_CC_FINAL', 'commentary') && find('SYNTHETIC_R_CC_UNIT', 'observation'), 'premise: recorded');
  const claim = { text: 'The agent said all unit tests pass.', stated: receipt(find('SYNTHETIC_R_CC_FINAL', 'commentary'), 'commentary',
    'All unit tests pass.'), contradictedBy: receipt(find('SYNTHETIC_R_CC_UNIT', 'observation'), 'observation', UNIT_OUT) };
  for (const speedProfile of [undefined, 'm33-lean']) {
    const report = await review(adapted, [claim], {}, speedProfile);
    assert.deepEqual(decided(report), ['DECIDE'], profileName(speedProfile));
    assert.equal(report.sessionStatus, 'DECIDE', profileName(speedProfile));
  }
});

// ---- 6 (minor). markers that report done work are not markers (M33 C recheck 2: code reads no markers) --------

test('M33 C repair: a claim reporting done work — "once more", "could not", "checked if" — publishes DECIDE', async () => {
  // M33 C recheck 2: code reads no intention markers at all (m33-c-claims-recheck2.test.js); a statement of intention
  // is the challengers' to refute.
  for (const quote of ['Ran the unit suite once more: all 42 tests pass.', 'Ran it once again and it passed.',
    'I could not reproduce the crash; it is fixed.', 'The job would not start until the cache was cleared; it runs now.',
    'Checked if anything was left uncommitted: everything is committed.']) {
    const { session, claim } = afterFailure({ words: `SYNTHETIC_R_M0: ${quote}`, quote });
    const report = await review(session, [claim]);
    assert.deepEqual(decided(report), ['DECIDE'], quote);
    assert.deepEqual(claimCauses(report), [], quote);
  }
});

test('M33 C repair: a true contradiction phrased "continuing from …, … applied to …" is not withheld as not a claim', async () => {
  const { session, claim } = afterFailure({ command: 'node /srv/x/migrate.js',
    output: 'SYNTHETIC_R_MIGRATE: db2 migration aborted', words:
    'SYNTHETIC_R_M1: Continuing from the last run, the migration applied to all 3 databases.',
    quote: 'Continuing from the last run, the migration applied to all 3 databases.' });
  const report = await review(session, [claim]);
  assert.deepEqual(decided(report), ['DECIDE']);
  assert.deepEqual(claimCauses(report), []);
});

// ---- 2. vote binding: two claims in one statement -----------------------------------------------------------

const SHARED = Object.freeze({
  blobs: { ask: 'SYNTHETIC_R_ASK: make the suites pass.', unit: 'node /srv/x/unit.js', unitOut: 'SYNTHETIC_R_UNIT: 1 failing',
    lint: 'node /srv/x/lint.js', lintOut: 'SYNTHETIC_R_LINT: 0 warnings',
    both: 'SYNTHETIC_R_BOTH: all unit tests pass and the lint is clean.' },
  rows: [['I1', 'ask', 'ask'], ['A4', 'cmd', 'unit'], ['A4-r', 'out', 'unitOut', { of: 'A4', failed: true }],
    ['A5', 'cmd', 'lint'], ['A5-r', 'out', 'lintOut', { of: 'A5' }], ['C8', 'said', 'both', { phase: 'final' }]],
});
const UNIT = { text: 'The agent said all unit tests pass.', stated: receipt('C8', 'commentary', 'all unit tests pass'),
  contradictedBy: receipt('A4-r', 'observation', 'SYNTHETIC_R_UNIT: 1 failing') };
// The narrative model proposed a contradiction the result does not show: the honest challenger refutes it.
const LINT = { text: 'The agent said the lint is clean.', stated: receipt('C8', 'commentary', 'the lint is clean.'),
  contradictedBy: receipt('A5-r', 'observation', 'SYNTHETIC_R_LINT: 0 warnings') };

/** An honest reply — the unit contradiction upheld on `upholdWith`, the lint one refuted on its own result — whose
 *  votes are filed under each other's keys when `swap`. */
function swapJudge({ swap, upholdWith }) {
  return async (request) => {
    if (!request.challenge) return narrativeOf([UNIT, LINT]);
    const honest = { 'claims:0': { verdict: 'not-refuted', receipts: upholdWith },
      'claims:1': { verdict: 'refuted', receipts: [LINT.contradictedBy] } };
    const keys = request.challenge.items.map((item) => item.key);
    const swapped = swap && keys.includes('claims:0') && keys.includes('claims:1');
    return { votes: keys.map((key) => ({ key, explanation: 'Synthetic.',
      ...honest[swapped ? (key === 'claims:0' ? 'claims:1' : key === 'claims:1' ? 'claims:0' : key) : key] })) };
  };
}
const citesLint = (report) => report.findings.some((f) => f.kind === 'claim_contradicted'
  && f.receipts.some((r) => r.eventId === 'A5-r'));
/** The known limit these swaps are; each todo test below prints it as its reason. */
const SHARED_SWAP_RISK = 'Known limit: when two items checked in one request share an event, a reply that swaps their '
  + 'keys cannot be told apart from an honest vote by code without hiding honest votes';

test('M33 C repair: a key swap between two claims of one statement never publishes the refuted one, in every profile', { todo: SHARED_SWAP_RISK }, async () => {
  const session = () => build(SHARED.blobs, SHARED.rows);
  const variants = { statementOnly: [UNIT.stated], statementAndResult: [UNIT.stated, UNIT.contradictedBy] };
  for (const speedProfile of PROFILES) {
    for (const [name, upholdWith] of Object.entries(variants)) {
      const label = `${profileName(speedProfile)} ${name}`;
      const run = (swap) => reviewRun.runReview({ session: session(), pr: null, reviewScope: 'session-only',
        ...(speedProfile ? { speedProfile } : {}), judge: swapJudge({ swap, upholdWith }) });
      const honest = await run(false);
      assert.deepEqual(decided(honest), ['DECIDE'], `${label}: premise — the honest reply publishes the unit claim`);
      assert.ok(!citesLint(honest), `${label}: premise — never the lint claim`);
      const swapped = await run(true);
      assert.ok(!citesLint(swapped), `${label}: the swap never publishes the claim the challengers refuted`);
      assert.notEqual(swapped.sessionStatus, 'CLEAN', `${label}: and the unit claim's lost check is never read as clean`);
    }
  }
});

test('M33 C event binding: a support vote quoting the statement two claims share binds both — it is each one\'s own event', async () => {
  // M33 C repair bound neither (the statement was no single item's), so an honest vote citing the whole message
  // published NO_FINDINGS. Event level only: every vote binds and both claims the votes uphold are published.
  const whole = receipt('C8', 'commentary', 'all unit tests pass and the lint is clean.');
  const report = await reviewRun.runReview({ session: build(SHARED.blobs, SHARED.rows), pr: null, reviewScope: 'session-only',
    judge: async (request) => (request.challenge
      ? { votes: request.challenge.items.map(({ key }) => ({ key, verdict: 'not-refuted', explanation: 'Synthetic.', receipts: [whole] })) }
      : narrativeOf([UNIT, LINT])) });
  assert.deepEqual(decided(report), ['DECIDE', 'DECIDE']);
  const votes = report.windowResults[0].challenge.results.flatMap((r) => r.votes);
  assert.ok(votes.every((v) => v.valid === true));
  assert.equal(report.sessionStatus, 'DECIDE');
});

test('M33 C repair: a vote that cites a result another item of its run also cites binds only through its own quote', { todo: SHARED_SWAP_RISK }, async () => {
  // One run output contradicts both claims, each quoting its own line of it.
  const blobs = { ask: 'SYNTHETIC_R_ASK: make the suites pass.', ci: 'node /srv/x/ci.js',
    ciOut: 'SYNTHETIC_R_CI_UNIT: 1 failing\nSYNTHETIC_R_CI_LINT: 0 warnings', both: 'SYNTHETIC_R_BOTH: all unit tests pass and the lint is clean.' };
  const rows = [['I1', 'ask', 'ask'], ['A1', 'cmd', 'ci'], ['A1-r', 'out', 'ciOut', { of: 'A1', failed: true }], ['C8', 'said', 'both']];
  const unit = { ...UNIT, contradictedBy: receipt('A1-r', 'observation', 'SYNTHETIC_R_CI_UNIT: 1 failing') };
  const lint = { ...LINT, contradictedBy: receipt('A1-r', 'observation', 'SYNTHETIC_R_CI_LINT: 0 warnings') };
  const judge = (swap) => async (request) => {
    if (!request.challenge) return narrativeOf([unit, lint]);
    const honest = { 'claims:0': { verdict: 'not-refuted', receipts: [unit.contradictedBy] },
      'claims:1': { verdict: 'refuted', receipts: [lint.contradictedBy] } };
    return { votes: request.challenge.items.map(({ key }) => ({ key, explanation: 'Synthetic.',
      ...honest[swap ? (key === 'claims:0' ? 'claims:1' : 'claims:0') : key] })) };
  };
  const run = (swap) => reviewRun.runReview({ session: build(blobs, rows), pr: null, reviewScope: 'session-only', judge: judge(swap) });
  const honest = await run(false);
  assert.deepEqual(honest.findings.filter((f) => f.kind === 'claim_contradicted').map((f) => f.receipts[1].quote),
    ['SYNTHETIC_R_CI_UNIT: 1 failing']);
  const swapped = await run(true);
  assert.ok(!swapped.findings.some((f) => f.kind === 'claim_contradicted'
    && f.receipts.some((r) => r.quote === 'SYNTHETIC_R_CI_LINT: 0 warnings')), 'the refuted claim is never published');
});

test('M33 C repair: challengeItems accepts a binding predicate, and a Set as before', async () => {
  // M33 C2 repair: a claim-class item is asked only with code's grounded words (`verbatim`), as the run gives it.
  const items = [{ key: 'a', type: 'claim', candidate: { text: 'SYNTHETIC a', stated: { eventId: 'C0', role: 'commentary', quote: 'SYNTHETIC said' } }, verbatim: { quote: 'SYNTHETIC said' } }];
  const verifyReceipt = (r) => ({ ok: true, receipt: r });
  const judge = async (request) => ({ votes: request.challenge.items.map(({ key }) => ({ key, verdict: 'not-refuted',
    explanation: 'Synthetic.', receipts: [{ eventId: 'E1', role: 'observation', quote: 'SYNTHETIC one' }] })) });
  const byQuote = await challenge.challengeItems({ items, judge, evidence: 'SYNTHETIC', verifyReceipt,
    supportEvents: () => (r) => r.quote === 'SYNTHETIC two' });
  assert.deepEqual(byQuote.survivors, [], 'the predicate refuses the quote');
  const bySet = await challenge.challengeItems({ items, judge, evidence: 'SYNTHETIC', verifyReceipt, supportEvents: () => new Set(['E1']) });
  assert.deepEqual(bySet.survivors.map((i) => i.key), ['a']);
  const throwing = await challenge.challengeItems({ items, judge, evidence: 'SYNTHETIC', verifyReceipt,
    supportEvents: () => () => { throw new Error('SYNTHETIC'); } });
  assert.deepEqual(throwing.survivors, [], 'a predicate that throws binds nothing: fails closed');
});

// ---- 3. a support is its own challenge item -------------------------------------------------------------------

const SUPPORTED = Object.freeze({
  blobs: { ask: 'SYNTHETIC_R_ASK: make the lint clean.', said: 'SYNTHETIC_R_LINT_SAID: the lint is clean.',
    lint: 'node /srv/x/lint.js', lintOut: 'SYNTHETIC_R_LINT_OK: 0 warnings' },
  rows: [['I1', 'ask', 'ask'], ['C5', 'said', 'said'], ['A5', 'cmd', 'lint'], ['A5-r', 'out', 'lintOut', { of: 'A5' }]],
  claim: { text: 'The agent said the lint is clean.', stated: receipt('C5', 'commentary', 'the lint is clean.'),
    contradictedBy: null, supportedBy: receipt('A5-r', 'observation', 'SYNTHETIC_R_LINT_OK: 0 warnings') },
});
const supportedSession = () => build(SUPPORTED.blobs, SUPPORTED.rows);
const byType = (on) => (item) => on[item.type] ?? 'not-refuted';

test('M33 C repair: a support the challengers refute or cannot settle leaves its claim a promise "open"', async () => {
  for (const speedProfile of PROFILES) {
    const label = profileName(speedProfile);
    const refuted = await review(supportedSession(), [SUPPORTED.claim], { verdict: byType({ support: 'refuted' }) }, speedProfile);
    assert.deepEqual(refuted.promises.map((p) => p.status), ['open'], `${label}: refuted support`);
    assert.equal(refuted.counts.promiseSupport.rejected.refuted, 1, label);
    const unsettled = await review(supportedSession(), [SUPPORTED.claim], { verdict: byType({ support: 'uncertain' }) }, speedProfile);
    assert.deepEqual(unsettled.promises.map((p) => p.status), ['open'], `${label}: unsettled support`);
    assert.equal(unsettled.counts.promiseSupport.rejected.unsettled, 1, label);
    assert.equal(unsettled.sessionReview, 'complete', `${label}: a support check never makes the review incomplete`);
    const upheld = await review(supportedSession(), [SUPPORTED.claim], {}, speedProfile);
    assert.deepEqual(upheld.promises.map((p) => p.status), ['verified'], `${label}: upheld support`);
    assert.deepEqual(upheld.promises[0].receipts.map((r) => r.eventId), ['C5', 'A5-r']);
    const claimRefuted = await review(supportedSession(), [SUPPORTED.claim], { verdict: byType({ claim: 'refuted' }) }, speedProfile);
    assert.deepEqual(claimRefuted.promises, [], `${label}: a refuted claim is never published, whatever it cites`);
  }
  assert.deepEqual([...ledger.SUPPORT_REJECTIONS], ['contradicted', 'malformed', 'role_mismatch', 'unsupplied', 'ungrounded',
    'not_later', 'cross_actor', 'failed_result', 'not_same_turn', 'stale_run', 'refuted', 'unsettled', 'unexecuted']);
});

test('M33 C repair: the claim is asked bare, byte for byte; its support is asked in its own three-pass run', async () => {
  for (const speedProfile of PROFILES) {
    const label = profileName(speedProfile);
    const seen = [], alone = [];
    await review(supportedSession(), [SUPPORTED.claim], { seen }, speedProfile);
    await review(supportedSession(), [{ ...SUPPORTED.claim, supportedBy: null }], { seen: alone }, speedProfile);
    const calls = (list) => list.filter((r) => r.challenge).map((r) => [r.label, r.challenge.items.map((i) => [i.key, i.type])]);
    assert.deepEqual(calls(seen), [
      ['challenge:w1:b1:p1', [['claims:0', 'claim']]], ['challenge:w1:b1:p2', [['claims:0', 'claim']]],
      ['challenge:w1:b1:p3', [['claims:0', 'claim']]],
      ['challenge:w1:support:b1:p1', [['claims:0:support', 'support']]], ['challenge:w1:support:b1:p2', [['claims:0:support', 'support']]],
      ['challenge:w1:support:b1:p3', [['claims:0:support', 'support']]]], label);
    const claimRequests = (list) => list.filter((r) => r.challenge && !r.label.includes(':support:')).map((r) => r.prompt);
    assert.deepEqual(claimRequests(seen), claimRequests(alone), `${label}: the claim's requests are those of the bare claim`);
    const support = seen.find((r) => r.label.includes(':support:')).challenge.items[0].candidate;
    assert.deepEqual(support, { text: SUPPORTED.claim.text, stated: SUPPORTED.claim.stated, supportedBy: SUPPORTED.claim.supportedBy });
  }
});

test('M33 C repair: a support is verified only on votes that cite the confirming result, never the statement alone', async () => {
  const report = await review(supportedSession(), [SUPPORTED.claim], { cite: ({ candidate }) => [candidate.stated] });
  assert.deepEqual(report.promises.map((p) => p.status), ['open']);
  assert.equal(report.counts.promiseSupport.rejected.unsettled, 1);
  // The command that produced the result is the result's own action: one hop.
  const command = await review(supportedSession(), [SUPPORTED.claim],
    { cite: ({ type, candidate }) => [type === 'support' ? receipt('A5', 'action', 'node /srv/x/lint.js') : candidate.stated] });
  assert.deepEqual(command.promises.map((p) => p.status), ['verified']);
});

test('M33 C repair: a support is asked only for a claim that survived, and its record is kept apart', async () => {
  const seen = [];
  const report = await review(supportedSession(), [SUPPORTED.claim], { seen, verdict: byType({ claim: 'refuted' }) });
  assert.ok(!seen.some((r) => r.label?.includes(':support:')), 'a refuted claim\'s support is never asked');
  assert.equal(report.supportChallenge.attemptedCalls, 0);
  const upheld = await review(supportedSession(), [SUPPORTED.claim]);
  assert.equal(upheld.supportChallenge.attemptedCalls, 3);
  assert.equal(upheld.challenge.attemptedCalls, 3, 'the window\'s own challenge counts its own calls only');
});

// ---- 6 (minor). a code-rejected support is no receipt of the window's grounding -------------------------------

test('M33 C repair: a support code rejected is not counted in the window\'s grounding receipts', async () => {
  for (const supportedBy of [receipt('A5-r', 'observation', 'SYNTHETIC QUOTE NOBODY EVER RECORDED'),
    receipt('I1', 'observation', 'SYNTHETIC_R_ASK: make the lint clean.')]) {
    const report = await review(supportedSession(), [{ ...SUPPORTED.claim, supportedBy }]);
    assert.deepEqual(report.promises.map((p) => p.status), ['open']);
    const { grounding } = report.windowResults[0].shortfall;
    assert.deepEqual([grounding.receipts, grounding.rejected], [1, 0], JSON.stringify(supportedBy));
  }
});

// ---- 4. the combined route's narrative fallback ---------------------------------------------------------------

test('M33 C repair: a binary-only PR\'s narrative fallback reads a claim with supportedBy as the narrative contract does', async () => {
  const pr = { repo: { host: 'github.com', id: '406' }, number: 406, baseOid: 'b'.repeat(40), diffBaseOid: 'b'.repeat(40),
    headOid: 'a'.repeat(40), gitAlgorithm: 'sha1', enumeration: 'complete',
    files: [{ path: 'assets/logo.png', change: 'binary', contentState: 'complete' }] };
  const diff = 'diff --git a/assets/logo.png b/assets/logo.png\nindex 2222222..3333333 100644\n'
    + 'Binary files a/assets/logo.png and b/assets/logo.png differ\n';
  for (const [name, supportedBy, status] of [['null', null, 'open'], ['a receipt', SUPPORTED.claim.supportedBy, 'verified']]) {
    const claims = [{ ...SUPPORTED.claim, supportedBy }];
    const report = await runCodeReview({ session: supportedSession(), pr, diff, judge: async (request) => {
      if (request.challenge) return { votes: request.challenge.items.map((item) => ({ key: item.key, verdict: 'not-refuted',
        explanation: 'Synthetic.', receipts: [ownReceipt(item)] })) };
      return narrativeOf(claims);
    } });
    assert.equal(report.rejectedNarrative, 0, name);
    assert.equal(report.coverage, 'complete', name);
    assert.equal(report.sessionStatus, 'CLEAN', name);
    assert.deepEqual(report.promises.map((p) => p.status), [status], name);
  }
});

// ---- 5. the joint channel's contradicted claims -----------------------------------------------------------------

function jointCase(said, quote, cite = null, verdict = 'not-refuted') {
  const blobs = { ask: 'SYNTHETIC_R_JOINT_ASK: write the module and make its tests pass.', body: 'export const SYNTHETIC_R_JOINT = 1;\n',
    out: 'SYNTHETIC_R_JOINT_OUT: File created successfully', test: 'node /srv/x/test.js', testOut: 'SYNTHETIC_R_JOINT_TEST: 2 failing', said };
  const ref = (key) => [{ sourceKey: key, fromByte: 0, untilByte: Buffer.byteLength(blobs[key], 'utf8') }];
  const INDEX = 'src/index.js';
  const session = new Session({ sessionKey: 'joint-r', adapter: 'claude', blobs, events: [
    { id: 'I1', kind: 'instruction', authority: 'human', supersedes: [], text: ref('ask') },
    { id: 'A1', kind: 'invocation', callKey: 'A1', tool: 'Write', operation: 'write', paths: [{ path: INDEX }], command: [],
      input: [], changes: [{ path: INDEX, before: [], after: ref('body'), diff: [] }] },
    { id: 'O1', kind: 'observation', phase: 'terminal', invocation: 'A1', callKey: 'A1', result: 'succeeded', exitCode: null,
      terminalStatusProven: true, sourceOfResult: 'native', output: ref('out') },
    { id: 'A2', kind: 'invocation', callKey: 'A2', tool: 'Bash', operation: 'command', paths: [], command: ref('test'), input: [], changes: [] },
    { id: 'O2', kind: 'observation', phase: 'terminal', invocation: 'A2', callKey: 'A2', result: 'failed', exitCode: 1,
      terminalStatusProven: true, sourceOfResult: 'native', output: ref('testOut') },
    { id: 'C1', kind: 'commentary', phase: 'final', beforeInvocation: null, text: ref('said') },
  ].map((event, sequence) => ({ ...event, sequence })) });
  const diff = ['diff --git a/src/index.js b/src/index.js', 'new file mode 100644', '--- /dev/null',
    '+++ b/src/index.js', '@@ -0,0 +1,1 @@', '+export const SYNTHETIC_R_JOINT = 1;', ''].join('\n');
  const pr = { repo: { host: 'github.com', id: '407' }, number: 407, baseOid: 'b'.repeat(40), diffBaseOid: 'b'.repeat(40),
    headOid: 'a'.repeat(40), gitAlgorithm: 'sha1', enumeration: 'complete',
    files: [{ path: INDEX, change: 'added', contentState: 'complete' }] };
  const finding = { origin: 'session-review', kind: 'claim_contradicted', title: 'SYNTHETIC_R_JOINT_CONTRADICTED',
    explanation: 'SYNTHETIC: the recorded result contradicts the statement.', scope: 'session-effect', anchor: null,
    receipts: [receipt('C1', 'commentary', quote), receipt('O2', 'observation', blobs.testOut)] };
  const base = { decisions: [], pivots: [], claims: [], requirements: [], codeFindings: [], sessionFindings: [] };
  const judge = async (request) => {
    if (request.challenge) return { votes: request.challenge.items.map(({ key }) => ({ key, verdict,
      explanation: 'Synthetic.', receipts: [cite ?? receipt('O2', 'observation', blobs.testOut)] })) };
    if (/^code\+chunk:/.test(request.label ?? '')) return { ...base, reviewedFiles: [INDEX] };
    return { ...base, reviewedFiles: /^code\+narrative:/.test(request.label ?? '') ? [INDEX] : [],
      sessionFindings: /^code\+narrative:/.test(request.label ?? '') ? [finding] : [] };
  };
  return () => runCodeReview({ session, pr, diff, judge });
}

test('M33 C repair: a joint claim_contradicted that quotes an intention is refuted by its challenge, never withheld by code', async () => {
  // M33 C recheck 2: code withholds no joint claim as not a claim; the challengers' criterion refutes an intention.
  const intention = await jointCase("SYNTHETIC_R_JOINT_SAID: I'm going to fix the tests next.", "I'm going to fix the tests next.",
    null, 'refuted')();
  assert.ok(!intention.findings.some((f) => f.kind === 'claim_contradicted'), 'never DECIDE');
  assert.deepEqual(claimCauses(intention), []);
  assert.equal(intention.codeChallenges.reduce((n, c) => n + c.refutedItems, 0), 1, 'asked and refuted');
  assert.equal(intention.sessionStatus, 'CLEAN', 'a resolved refutation is a completed check');
  // A true one on the same channel still publishes.
  const truth = await jointCase('SYNTHETIC_R_JOINT_SAID: all tests pass.', 'all tests pass.')();
  assert.deepEqual(truth.findings.filter((f) => f.kind === 'claim_contradicted').map((f) => f.status), ['DECIDE']);
});

test('M33 C repair: a joint claim_contradicted is vote-bound like a narrative one — support citing elsewhere never publishes it', async () => {
  const elsewhere = await jointCase('SYNTHETIC_R_JOINT_SAID: all tests pass.', 'all tests pass.',
    receipt('O1', 'observation', 'SYNTHETIC_R_JOINT_OUT: File created successfully'))();
  assert.ok(!elsewhere.findings.some((f) => f.kind === 'claim_contradicted'), 'three unbound support votes publish nothing');
  const command = await jointCase('SYNTHETIC_R_JOINT_SAID: all tests pass.', 'all tests pass.',
    receipt('A2', 'action', 'node /srv/x/test.js'))();
  assert.deepEqual(command.findings.filter((f) => f.kind === 'claim_contradicted').map((f) => f.status), ['DECIDE'],
    'the command that produced the contradicting result is its own: one hop');
});

// ---- 6 (minor). the support criterion and the prompts -----------------------------------------------------------

test('M33 C repair: the challenger judges a support item on its own, and refutes one an earlier result contradicts', () => {
  // M33 C2 moved it once more (`sonah.challenge/9`: the verbatim quote decides); the shared system prompt did not move.
  // M33 H repair moved it once more (`sonah.challenge/10`: a relay of another agent's report is its own claim).
  // M33 N moved it once more (`sonah.challenge/11`): a forbidden-edit item and its note; no earlier request byte moved.
  // Status fact moved it once more (`sonah.challenge/12`): one system sentence; a vote must quote an uncovered result.
  // H3 moved it once more (`sonah.challenge/13`): a hedged outcome statement is a claim.
  // M33 brittleness M3 moved it once more (`sonah.challenge/12`): a forbidden-edit item names its breach; no other batch moved.
  // M33 brittleness M4 moved it once more (`sonah.challenge/13`): a disclosure item and its note; no other batch moved.
  // M33 brittleness M4's session route moved it once more (`sonah.challenge/14`): a forbidden-edit item no longer
  // shows the agent's statement, which is asked as a disclosure item; no other batch moved.
  // M33 integration moved it once more (`sonah.challenge/15`): one version above every branch's own (C-05 integration).
  // The disclosure narrowing moved it once more (`sonah.challenge/16`): a disclosure item's proposition and note only.
  // Stable event ids moved it once more (`sonah.challenge/17`): every recorded event's id (C-01 event identity).
  // M35 windowing moved it once more (`sonah.challenge/18`): every evidence byte and a session-only candidate's aliases.
  // M36 phase 1 moved it once more (`sonah.challenge/19`): the evidence it carries (D68; RECORDED_FACTS_VERSIONS).
  // M36 phase 2 moved it once more (`sonah.challenge/20`): the window format (D68; FORMAT_VERSIONS).
  // M36 phase 3 moved it once more (`sonah.challenge/21`): packed windows, carried failures, the evidence re-ask (D68 K, Q, F; CONVERSATION_VERSIONS).
  // D69 moved it once more (`sonah.challenge/22`): the net view's declines reverted, the harness home folders, the recorder's cwd (D69_VERSIONS).
  // The D69 review moved it once more (`sonah.challenge/23`): the evidence a challenge shows moved as the narrative's (D69_REVIEW_VERSIONS).
  // D71 (S2) moved it once more (sonah.challenge/24), and D71 (S3) once more (sonah.challenge/25): the new channels (D71_CHANNELS_VERSIONS).
  // The column fix moved it once more (sonah.challenge/30): who decided a decision (FIX_COLUMN_VERSIONS).
  // W1 B moved it once more (sonah.challenge/31): the file form of the forbidden-edit proposition and its note.
  // W2 moved it once more (sonah.challenge/32): CLAIM_NOTE judges the agent's own written text like a result.
  // W3 F1(b) moved it once more (sonah.challenge/33): a support with changes since its run is asked, listed.
  // W3 F2 moved it once more (sonah.challenge/34): a support whose result failed is asked, judged on its outcome.
  // The fix review moved it (sonah.challenge/35 to /37): stopped results, a file rule's lifts, the existence check.
  // D87 moved it once more (sonah.challenge/38, its /35 renumbered at the merge): the code pass's own run; no other
  // request byte moved.
  // The code step moved it once more (sonah.challenge/39): the code pass's run left challengeItems for a runner of its
  // own, verdict first; no other request byte moved.
  // The review of the code step moved it once more (sonah.challenge/40): no `duplicate` refutation, and a
  // finding's checker sees no agent words; no other request byte moved.
  // The second review of the code step moved it once more (sonah.challenge/41): a code check's checker sees no word
  // of the agent's in any row; no other request byte moved.
  // The third review of the code step moved it once more (sonah.challenge/42): a code check's checker sees
  // what its row states again; no other request byte moved.
  // The re-ask of a void vote moved it once more (sonah.challenge/43): a vote a reply cast that could not be
  // counted is asked again once, naming its cause; no first-round request byte moved.
  // Its withdrawal moved it once more (sonah.challenge/44): a vote a reply cast that could not be counted stands
  // again, as before /43; no first-round request byte moved.
  assert.equal(challenge.CHALLENGE_PROFILE.version, 'sonah.challenge/44', 'still one version bump for M33 C');
  const system = challenge.challengeSystem().replace(/\s+/g, ' ');
  for (const phrase of [/A support candidate names a claim/, /earlier recorded result of the same measurement/,
    /cite the result that candidate cites/])
    assert.match(system, phrase);
  assert.ok(!/For a claim with supportedBy/.test(system), 'a claim item never carries its support');
  // M33 X moved it once more (carried evidence; only a window with something to carry moved a byte).
  // M33 H repair moved it once more (`sonah.narrative/13`: a relay of another agent's report is its own claim).
  // OWNER DECISION B (2026-10-01) moved it once more: per-decision instruction completeness. Only an incomplete
  // window's scope lines (`completeFor`) and an in-turn human instruction's header moved a byte.
  // M33 N moved it once more (`sonah.narrative/14`): a session-only request asks for edits against a human instruction.
  // Status fact moved it once more (`sonah.narrative/15`): a "status:" line under an uncovered result, three task lines.
  // H3 moved it once more (`sonah.narrative/16`): a hedged outcome statement is a claim.
  // M33 brittleness M3 moved it once more (`sonah.narrative/15`): a removal or a deletion is a forbidden edit too.
  // M33 integration moved it once more (`sonah.narrative/17`): one version above every branch's own (C-05 integration).
  // The M33 labels merge moved it once more (`sonah.narrative/18`): the slice-time marker headers.
  // Stable event ids moved it once more (`sonah.narrative/19`): every recorded event's id (C-01 event identity).
  // The D64 wording moved it once more (`sonah.narrative/20`): the proposer's two disclosure sentences.
  // M35 windowing moved it once more (`sonah.narrative/21`): windows, carried context, trims, aliases (C-07).
  // M36 phase 1 moved it once more (`sonah.narrative/22`): the evidence it carries (D68; RECORDED_FACTS_VERSIONS).
  // M36 phase 2 moved it once more (`sonah.narrative/23`): the window format (D68; FORMAT_VERSIONS).
  // M36 phase 3 moved it once more (`sonah.narrative/24`): packed windows, carried failures, the evidence re-ask (D68 K, Q, F; CONVERSATION_VERSIONS).
  // D69 moved it once more (`sonah.narrative/25`): the net view's declines reverted, the harness home folders, the recorder's cwd (D69_VERSIONS).
  // The D69 review moved it once more (`sonah.narrative/26`): a combined request's omission lines offer no request (F2), the ledger moved (typed withholding, paths as recorded) (D69_REVIEW_VERSIONS).
  // D71 (S2) moved it once more (sonah.narrative/27), and D71 (S3) once more (sonah.narrative/28): the new channels (D71_CHANNELS_VERSIONS).
  // The D80 integration moved it once more (sonah.narrative/31): a stopped call's outcome line (D80_VERSIONS).
  // The asks fixes moved it once more (sonah.narrative/33): S3's re-ask of a refuted requirement.
  // W1 A moved it once more (sonah.narrative/34): the re-ask of a decision refuted on who decided it.
  // The release review moved it once more (sonah.narrative/35): a project instruction file the session wrote
  // is left out of the window's project files. The second release review moved it once more
  // (sonah.narrative/36): that file's path is compared under the working directory. G2 moved it once more
  // (sonah.narrative/37): the re-ask of a choice not to act whose existence check refuted its words.
  assert.equal(prompt.PROMPT_VERSION, 'sonah.narrative/37', 'still one version bump');
  const built = prompt.buildNarrativePrompt({ session: supportedSession(), window: { index: 0, events: supportedSession().events } });
  const task = built.prompt.replace(built.evidencePrompt, '').replace(/\s+/g, ' ');
  assert.match(task, /A claim an earlier RESULT already contradicts takes contradictedBy, never supportedBy/);
});

test('M33 C repair: a synthetic Claude Code session — two claims in one final message, swapped votes — never publishes the refuted one', { todo: SHARED_SWAP_RISK }, async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'sonah-c-repair-swap-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const file = join(dir, 'synthetic.jsonl');
  let n = 0;
  const base = () => ({ uuid: `u${++n}`, parentUuid: n > 1 ? `u${n - 1}` : null, sessionId: 'synthetic-c-repair-swap',
    cwd: '/srv/x', timestamp: `2026-10-01T12:00:${String(n).padStart(2, '0')}Z`, version: '2.0.0', isSidechain: false });
  const user = (content) => ({ ...base(), type: 'user', message: { role: 'user', content } });
  const asst = (content) => ({ ...base(), type: 'assistant', message: { role: 'assistant', content } });
  const UNIT_OUT = 'SYNTHETIC_R_CCS_UNIT: 1 failing in parser.spec';
  const LINT_OUT = 'SYNTHETIC_R_CCS_LINT: 0 warnings';
  const FINAL = 'SYNTHETIC_R_CCS_FINAL: all unit tests pass and the lint is clean.';
  await writeFile(file, [
    user('SYNTHETIC_R_CCS_ASK: make the unit suite and the lint pass.'),
    asst([{ type: 'tool_use', id: 't1', name: 'Bash', input: { command: 'npm run test:unit' } }]),
    user([{ type: 'tool_result', tool_use_id: 't1', content: UNIT_OUT, is_error: true }]),
    asst([{ type: 'tool_use', id: 't2', name: 'Bash', input: { command: 'npm run lint' } }]),
    user([{ type: 'tool_result', tool_use_id: 't2', content: LINT_OUT, is_error: false }]),
    asst([{ type: 'text', text: FINAL }]),
  ].map((row) => JSON.stringify(row)).join('\n') + '\n');
  const adapted = sessionFromLedger(redact(await sliceLineage([file])).ledger, { sessionKey: 'synthetic-c-repair-swap' });
  const find = (marker, kind) => adapted.events.find((event) => event.kind === kind
    && adapted.sourcesFor(event).some((source) => source.text.includes(marker)))?.id;
  const said = find('SYNTHETIC_R_CCS_FINAL', 'commentary'), unitRun = find('SYNTHETIC_R_CCS_UNIT', 'observation'),
    lintRun = find('SYNTHETIC_R_CCS_LINT', 'observation');
  assert.ok(said && unitRun && lintRun, 'premise: recorded');
  const unit = { text: 'The agent said all unit tests pass.', stated: receipt(said, 'commentary', 'all unit tests pass'),
    contradictedBy: receipt(unitRun, 'observation', UNIT_OUT) };
  const lint = { text: 'The agent said the lint is clean.', stated: receipt(said, 'commentary', 'the lint is clean.'),
    contradictedBy: receipt(lintRun, 'observation', LINT_OUT) };
  const judge = (swap) => async (request) => {
    if (!request.challenge) return narrativeOf([unit, lint]);
    const honest = { 'claims:0': { verdict: 'not-refuted', receipts: [unit.stated, unit.contradictedBy] },
      'claims:1': { verdict: 'refuted', receipts: [lint.contradictedBy] } };
    return { votes: request.challenge.items.map(({ key }) => ({ key, explanation: 'Synthetic.',
      ...honest[swap ? (key === 'claims:0' ? 'claims:1' : 'claims:0') : key] })) };
  };
  for (const speedProfile of PROFILES) {
    const label = profileName(speedProfile);
    const run = (swap) => reviewRun.runReview({ session: adapted, pr: null, reviewScope: 'session-only',
      ...(speedProfile ? { speedProfile } : {}), judge: judge(swap) });
    const honest = await run(false);
    assert.deepEqual(honest.findings.filter((f) => f.kind === 'claim_contradicted').map((f) => [f.status, f.receipts[1].eventId]),
      [['DECIDE', unitRun]], `${label}: the honest reply publishes the unit contradiction only`);
    const swapped = await run(true);
    assert.ok(!swapped.findings.some((f) => f.receipts?.some((r) => r.eventId === lintRun)), `${label}: never the refuted lint claim`);
    assert.notEqual(swapped.sessionStatus, 'CLEAN', label);
  }
});
