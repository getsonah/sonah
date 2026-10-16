// M33 (I2). One rule for a contradicted claim: it ends as exactly one of a published
// `claim_contradicted` finding, a rejected finding (the ledger's `rejectedFindings` row), or a withheld
// claim — never both published and withheld. The finding path grounds its receipts with the one
// deterministic near-miss repair (W3-3); the window's claim count used to check the same two receipts
// strictly, so a quote that grounded only after its snap was published as a finding AND counted as a
// withheld, rejected claim (`claimsRejected`, `withheld.proposals`, the rendered withheld section).
//
// Synthetic session, synthetic judge: no recording, no model call. Nothing prints.
import test from 'node:test';
import assert from 'node:assert/strict';
import { Session } from '../src/session.js';
import { runReview } from '../src/run-review.js';

const TEXT = {
  ask: 'SYNTHETIC_I2_ASK: add the retry helper, then run the unit, lint, build, push, migrate and integration steps.',
  unit: 'npm run test:unit',
  unitOut: 'SYNTHETIC_I2_OUT_UNIT: Tests: 1 failed, 4 passed, 5 total',
  unitSaid: 'SYNTHETIC_I2_SAID_UNIT: I added the retry helper and the unit tests pass now.',
  lint: 'npm run lint',
  lintOut: 'SYNTHETIC_I2_OUT_LINT: Lint: 3 errors found in src/retry.js',
  lintSaid: 'SYNTHETIC_I2_SAID_LINT: Lint is clean — no errors remain.',
  build: 'npm run build',
  buildOut: 'SYNTHETIC_I2_OUT_BUILD: Build failed: exit code 2 (tsc reported 4 errors)',
  buildSaid: 'SYNTHETIC_I2_SAID_BUILD: The build succeeded on the first try.',
  push: 'git push origin retry-helper',
  pushOut: "SYNTHETIC_I2_OUT_PUSH: error: failed to push some refs to 'origin'",
  pushSaid: 'SYNTHETIC_I2_SAID_PUSH: I pushed the branch & opened the pull request.',
  migrate: 'npm run migrate',
  migrateOut: 'SYNTHETIC_I2_OUT_MIGRATE: Migration aborted: relation “users” already exists',
  migrateSaid: 'SYNTHETIC_I2_SAID_MIGRATE: The migration ran cleanly against the staging database.',
  integration: 'npm run test:integration',
  integrationOut: 'SYNTHETIC_I2_OUT_INTEGRATION: integration: 11 passed, 1 failed',
  integrationSaid: 'SYNTHETIC_I2_SAID_INTEGRATION: All 12 integration tests pass.',
  fixedOut: 'SYNTHETIC_I2_OUT_FIXED: Tests: 5 passed, 5 total',
  fixedSaid: 'SYNTHETIC_I2_SAID_FIXED: After the fix the unit tests pass: 5 passed, 5 total.',
};
const whole = (key) => [{ sourceKey: key, fromByte: 0, untilByte: Buffer.byteLength(TEXT[key], 'utf8') }];
const T1 = { turn: 'T1' };
const run = (id, key) => ({ id, kind: 'invocation', callKey: id, tool: 'Bash', operation: 'command', paths: [],
  command: whole(key), input: [], changes: [], ...T1 });
const result = (id, out, over = {}) => ({ id: `${id}-r`, kind: 'observation', invocation: id, callKey: id,
  phase: 'terminal', result: 'failed', exitCode: 1, terminalStatusProven: true, output: whole(out),
  sourceOfResult: 'native', ...T1, ...over });
const said = (id, key, over = {}) => ({ id, kind: 'commentary', phase: 'working', beforeInvocation: null,
  text: whole(key), ...T1, ...over });

/** One human turn: six statements, each after a recorded result that contradicts it, then a fixed
 *  unit run and the accurate statement about it (a self-correction of the first). */
const session = () => new Session({ sessionKey: 'sess-i2', adapter: 'claude', blobs: { ...TEXT }, events: [
  { id: 'I1', kind: 'instruction', authority: 'human', supersedes: [], text: whole('ask'), ...T1 },
  run('A1', 'unit'), result('A1', 'unitOut'), said('C1', 'unitSaid'),
  run('A2', 'lint'), result('A2', 'lintOut'), said('C2', 'lintSaid'),
  run('A3', 'build'), result('A3', 'buildOut'), said('C3', 'buildSaid'),
  run('A4', 'push'), result('A4', 'pushOut'), said('C4', 'pushSaid'),
  run('A5', 'migrate'), result('A5', 'migrateOut'), said('C5', 'migrateSaid'),
  run('A6', 'integration'), result('A6', 'integrationOut'), said('C6', 'integrationSaid'),
  run('A7', 'unit'), result('A7', 'fixedOut', { result: 'succeeded', exitCode: 0 }),
  said('C7', 'fixedSaid', { phase: 'final' }),
].map((event, sequence) => ({ ...event, sequence })) });

const receipt = (eventId, role, quote) => ({ eventId, role, quote });
const words = (eventId, quote) => receipt(eventId, 'commentary', quote);
const shows = (eventId, quote) => receipt(eventId, 'observation', quote);

/**
 * Every contradicted claim of the invariant, with how its receipts ground. `near` quotes only ground
 * after the one deterministic snap (a doubled space, a dash for an em dash, an HTML entity, straight
 * quotes for curly ones); `wrong` quotes cannot be repaired (a word the source never had).
 */
const CLAIMS = Object.freeze({
  exact: { text: 'The agent said the unit tests pass.',
    stated: words('C1', 'I added the retry helper and the unit tests pass now.'),
    contradictedBy: shows('A1-r', 'Tests: 1 failed, 4 passed, 5 total') },
  nearStated: { text: 'The agent said lint is clean.',
    stated: words('C2', 'Lint is clean - no errors remain.'),
    contradictedBy: shows('A2-r', 'Lint: 3 errors found in src/retry.js') },
  wrongStated: { text: 'The agent said the build succeeded.',
    stated: words('C3', 'The build succeeded on the second try.'),
    contradictedBy: shows('A3-r', 'Build failed: exit code 2 (tsc reported 4 errors)') },
  nearEntity: { text: 'The agent said the branch was pushed.',
    stated: words('C4', 'I pushed the branch &amp; opened the pull request.'),
    contradictedBy: shows('A4-r', "error: failed to push some refs to 'origin'") },
  nearObserved: { text: 'The agent said the migration ran cleanly.',
    stated: words('C5', 'The migration ran cleanly against the staging database.'),
    contradictedBy: shows('A5-r', 'Migration aborted: relation "users" already exists') },
  wrongObserved: { text: 'The agent said every integration test passes.',
    stated: words('C6', 'All 12 integration tests pass.'),
    contradictedBy: shows('A6-r', 'integration: 12 passed, 0 failed') },
});
const PUBLISHED = ['exact', 'nearStated', 'nearEntity', 'nearObserved'];
const WITHHELD = ['wrongStated', 'wrongObserved'];
/** A claim of the same statement whose stated quote only grounds after its snap (a doubled space). */
const NEAR_UNIT = { ...CLAIMS.exact, stated: words('C1', 'I added the retry helper and  the unit tests pass now.') };
const RESOLVED = { observation: shows('A7-r', 'Tests: 5 passed, 5 total'),
  statement: words('C7', 'After the fix the unit tests pass: 5 passed, 5 total.') };
/** An open promise beside them: its own statement, no contradiction. */
const PROMISE = { text: 'The agent said it added the retry helper.', stated: words('C1', 'I added the retry helper'),
  contradictedBy: null };

// Every challenger upholds every item with receipts that ground exactly, whatever the item quotes,
// so each claim reaches grounding and the only thing under test is how its own receipts ground. M33 C (vote
// binding): one receipt is the item's own statement, quoted whole — a contradicted claim's support must bind
// to it, and a resolution's is its own later statement, never the claim it resolves. M33 C recheck: on a
// message two items share (C1: the unit claim and the open promise), a quote binds only when it lies within the
// item's own quote and within no other item's, so the whole message binds neither; the vote also cites the
// item's own result, quoted whole — an event no other item cites — as an honest challenger is told to.
const UPHOLD = words('C1', 'I added the retry helper');
const STATEMENT = session();
const ownWords = (candidate) => {
  const event = STATEMENT.event((candidate?.resolvedBy?.statement ?? candidate?.stated)?.eventId);
  return event ? words(event.id, STATEMENT.textOf(event, 'text')) : UPHOLD;
};
const ownResult = (candidate) => {
  const event = STATEMENT.event((candidate?.resolvedBy?.observation ?? candidate?.contradictedBy)?.eventId);
  return event?.kind === 'observation' ? [shows(event.id, STATEMENT.textOf(event, 'output'))] : [];
};
const judge = (claims) => async (request) => request.challenge
  ? { votes: request.challenge.items.map(({ key, candidate }) => ({ key, verdict: 'not-refuted',
    explanation: 'The agent said this.', receipts: [...ownResult(candidate), ownWords(candidate)] })) }
  : { decisions: [], pivots: [], requirements: [], claims };
const reviewOf = (claims) => runReview({ session: session(), pr: null, reviewScope: 'session-only', judge: judge(claims) });

const contradictions = (report) => report.findings.filter((f) => f.kind === 'claim_contradicted');
/** Is `claim` published: a contradiction finding citing exactly its two events? */
const publishedAs = (report, claim) => contradictions(report).some((f) => f.receipts.length === 2
  && f.receipts[0].eventId === claim.stated.eventId && f.receipts[1].eventId === claim.contradictedBy.eventId);
const windowOf = (report) => {
  assert.equal(report.windowResults.length, 1, 'the synthetic session is one window');
  return report.windowResults[0];
};
/** The withheld proposals no specific cause names: those whose quotes did not match the record. */
const quotesWithheld = (report) => (report.withheld?.proposals ?? 0)
  - Object.values(report.withheld?.causes ?? {}).reduce((n, k) => n + k, 0);

test('M33 I2 a contradicted claim whose quotes match exactly is published and not withheld', async () => {
  const report = await reviewOf([CLAIMS.exact]);
  assert.equal(contradictions(report).length, 1);
  assert.ok(publishedAs(report, CLAIMS.exact));
  assert.ok(contradictions(report)[0].receipts.every((r) => r.repaired !== true));
  assert.equal(report.claimsRejected, 0);
  assert.equal(report.withheld.proposals, 0);
  assert.equal(windowOf(report).grounding.withheld, 0);
  assert.equal(windowOf(report).grounding.claimsRejected, 0);
  assert.equal(windowOf(report).sessionGroundingComplete, true);
  assert.equal(quotesWithheld(report), 0);
});

test('M33 I2 a contradicted claim whose stated quote grounds only after its snap is published, never also withheld', async () => {
  const exact = await reviewOf([CLAIMS.exact]);
  const report = await reviewOf([NEAR_UNIT]);
  const [finding] = contradictions(report);
  assert.ok(finding, 'published as a finding');
  assert.equal(finding.receipts[0].repaired, true, 'the stated receipt was snapped');
  assert.equal(finding.receipts[0].quote, CLAIMS.exact.stated.quote, 'to the exact recorded text');
  assert.equal(finding.id, contradictions(exact)[0].id, 'the same finding the exact quote publishes');
  assert.equal(report.claimsRejected, 0, 'a published contradiction is not a rejected claim');
  assert.equal(report.withheld.proposals, 0, 'nor a withheld one');
  assert.equal(windowOf(report).grounding.withheld, 0);
  assert.equal(windowOf(report).grounding.claimsRejected, 0);
  assert.equal(windowOf(report).sessionGroundingComplete, true);
  assert.deepEqual(report.rejectedFindings, []);
  assert.equal(quotesWithheld(report), 0);
  // The per-part verdict is the exact quote's: the published finding, and nothing withheld beside it.
  assert.deepEqual(report.parts, exact.parts);
  assert.equal(report.sessionStatus, exact.sessionStatus);
  assert.equal(report.sessionReview, 'complete');
});

test('M33 I2 a contradicted claim whose contradicting quote grounds only after its snap is published, never also withheld', async () => {
  const report = await reviewOf([CLAIMS.nearObserved]);
  const [finding] = contradictions(report);
  assert.ok(finding && publishedAs(report, CLAIMS.nearObserved));
  assert.equal(finding.receipts[1].repaired, true);
  assert.equal(report.claimsRejected, 0);
  assert.equal(report.withheld.proposals, 0);
  assert.equal(windowOf(report).sessionGroundingComplete, true);
});

test('M33 I2 a contradicted claim whose quote cannot be repaired is not published and is withheld exactly once', async () => {
  for (const name of WITHHELD) {
    const report = await reviewOf([CLAIMS[name]]);
    assert.deepEqual(contradictions(report), [], name);
    assert.deepEqual(report.rejectedFindings.map((r) => r.reason), ['receipt_rejected'], `${name}: the ledger's row`);
    assert.equal(report.claimsRejected, 1, name);
    assert.equal(report.withheld.proposals, 1, `${name}: counted once, never again as its finding`);
    assert.equal(windowOf(report).grounding.withheld, 1, name);
    assert.equal(windowOf(report).sessionGroundingComplete, true, `${name}: a withheld claim does not cap grounding`);
    assert.ok(quotesWithheld(report) > 0, name);
  }
});

test('M33 I2 a self-corrected claim whose stated quote grounds only after its snap is published FYI, never also withheld', async () => {
  const report = await reviewOf([{ ...NEAR_UNIT, resolvedBy: RESOLVED }]);
  const [finding] = contradictions(report);
  assert.ok(finding);
  assert.equal(finding.status, 'FYI');
  assert.equal(finding.disclosureReason, 'self_corrected');
  assert.equal(report.counts.resolutions.verified, 1);
  assert.equal(report.claimsRejected, 0);
  assert.equal(report.withheld.proposals, 0);
  assert.equal(windowOf(report).sessionGroundingComplete, true);
  assert.equal(report.sessionStatus, 'FYI');
  assert.deepEqual(report.parts.map((part) => [part.part, part.status, part.reasons]), [['T1', 'FYI', ['finding_fyi']]]);
});

test('M33 I2 invariant: every contradicted claim is published XOR withheld, alone and together', async () => {
  const names = Object.keys(CLAIMS);
  // Alone: each claim ends as exactly one of the two.
  for (const name of names) {
    const report = await reviewOf([CLAIMS[name]]);
    const published = publishedAs(report, CLAIMS[name]);
    const withheld = report.withheld.proposals;
    assert.equal(published, PUBLISHED.includes(name), `${name}: published`);
    assert.equal(withheld, WITHHELD.includes(name) ? 1 : 0, `${name}: withheld`);
    assert.equal(Number(published) + withheld, 1, `${name}: published XOR withheld`);
    assert.equal(report.claimsRejected, withheld, `${name}: rejected exactly when withheld`);
  }
  // Together, beside an open promise: the same partition, every claim counted once.
  const report = await reviewOf([...names.map((name) => CLAIMS[name]), PROMISE]);
  assert.deepEqual(names.filter((name) => publishedAs(report, CLAIMS[name])), PUBLISHED);
  assert.equal(contradictions(report).length, PUBLISHED.length);
  assert.equal(report.withheld.proposals, WITHHELD.length);
  assert.equal(report.claimsRejected, WITHHELD.length);
  assert.equal(contradictions(report).length + report.withheld.proposals, names.length,
    'published + withheld is every contradicted claim, once');
  assert.equal(report.rejectedFindings.length, WITHHELD.length);
  assert.ok(report.rejectedFindings.every((r) => r.reason === 'receipt_rejected'));
  assert.equal(windowOf(report).grounding.withheld, WITHHELD.length);
  assert.equal(windowOf(report).sessionGroundingComplete, true);
  // The open promise is untouched: its stated receipt is no finding's, so it is published as before.
  assert.equal(report.promises.length, 1);
  assert.equal(report.counts.promisesAsFindings, 0);
});

// M33 I2 (repair after review). A contradicted claim with blank text ('' or only whitespace; the narrative
// schema lets `text` be any string) survives its challenge, but its window cannot read it (D58 `unread`:
// counted in `claimsRejected`, never withheld, and its window's grounding is incomplete). It used to be
// published as a DECIDE `claim_contradicted` finding with an empty explanation as well: one claim both
// published and rejected. It now ends as the unread claim alone — no finding, no ledger row — and nothing
// the review asks changes (the finding candidates are dropped only after the window's challenge ran).
/** A contradicted claim on its own pair of events (C7, A7-r), so no other claim's finding shares them. */
const BLANK = { text: '   ', stated: words('C7', 'After the fix the unit tests pass'),
  contradictedBy: shows('A7-r', 'Tests: 5 passed, 5 total') };

test('M33 I2 a contradicted claim with blank text is counted once, as unread, and never also published', async () => {
  for (const text of ['', '   ', '\n\t ']) {
    for (const claim of [{ ...CLAIMS.exact, text }, { ...CLAIMS.exact, text, resolvedBy: RESOLVED }]) {
      const name = `${JSON.stringify(text)}${claim.resolvedBy ? ' (self-corrected)' : ''}`;
      const report = await reviewOf([claim]);
      assert.deepEqual(contradictions(report), [], `${name}: an unread claim is never also the published finding`);
      assert.deepEqual(report.findings, [], name);
      assert.deepEqual(report.rejectedFindings, [], `${name}: nor a rejected finding row`);
      assert.equal(report.counts.resolutions, undefined, `${name}: no finding, so no resolution judged`);
      assert.equal(report.claimsRejected, 1, `${name}: counted once, as unread`);
      assert.equal(report.withheld.proposals, 0, `${name}: never as withheld`);
      assert.equal(windowOf(report).grounding.claimsRejected, 1, name);
      assert.equal(windowOf(report).grounding.withheld, 0, name);
      assert.equal(windowOf(report).grounding.rejectedFindings, 0, name);
      // D58, unchanged: a proposal no check could read leaves its window's grounding incomplete.
      assert.equal(windowOf(report).sessionGroundingComplete, false, name);
      assert.equal(report.sessionReview, 'incomplete', name);
      assert.equal(report.sessionStatus, 'UNCHECKED', `${name}: no DECIDE rests on an unread claim`);
      assert.deepEqual(report.parts.map((part) => [part.part, part.status, part.reasons]),
        [['T1', 'UNCHECKED', ['window_incomplete']]], name);
      assert.equal(quotesWithheld(report), 0, name);
    }
  }
  // An exact promise copy of its statement is not folded into a finding that was never published: it is
  // the open promise it always was.
  const copy = { text: 'The agent said the unit tests pass.', stated: CLAIMS.exact.stated, contradictedBy: null };
  const report = await reviewOf([{ ...CLAIMS.exact, text: ' ' }, copy]);
  assert.deepEqual(report.findings, []);
  assert.equal(report.promises.length, 1);
  assert.equal(report.counts.promisesAsFindings, 0);
  assert.equal(report.claimsRejected, 1);
});

test('M33 I2 invariant: no contradicted claim is both published and counted rejected, beside an unread one', async () => {
  const names = Object.keys(CLAIMS);
  const report = await reviewOf([...names.map((name) => CLAIMS[name]), BLANK, PROMISE]);
  assert.deepEqual(names.filter((name) => publishedAs(report, CLAIMS[name])), PUBLISHED);
  assert.equal(publishedAs(report, BLANK), false, 'the unread claim is not published');
  assert.equal(contradictions(report).length, PUBLISHED.length);
  assert.equal(report.withheld.proposals, WITHHELD.length, 'withheld: the unrepairable quotes, once each');
  assert.equal(report.claimsRejected, WITHHELD.length + 1, 'rejected: those, and the unread claim once');
  assert.equal(contradictions(report).length + report.claimsRejected, names.length + 1,
    'published + rejected is every contradicted claim, once');
  assert.deepEqual(report.rejectedFindings.map((r) => r.reason), WITHHELD.map(() => 'receipt_rejected'),
    'a ledger row for each withheld claim, none for the unread one');
  assert.equal(windowOf(report).grounding.withheld, WITHHELD.length);
  assert.equal(windowOf(report).grounding.claimsRejected, WITHHELD.length + 1);
  assert.equal(report.promises.length, 1);
});
