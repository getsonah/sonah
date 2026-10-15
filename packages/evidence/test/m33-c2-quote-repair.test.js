// M33 C2 repair (C-06 "M33 the verbatim quote decides", recheck MAJOR). The words a challenger is shown as THE claim
// must be the words publication grounds — never the narrative model's own `stated.quote` string. Publication grounds a
// contradicted claim's stated receipt with the finding's receipt check (strict, then the one W3-3 near-miss repair,
// which can drop one edge word), and a promise's with the strict check alone. Before the repair, the challenger judged
// the model's string, so one edge word the agent never said decided the verdict:
//   E1 (false NONE)   the model's quote added a trailing "locally"; the challengers refuted a CI result against a
//                     local claim, while the snapped quote — what the finding would publish — CI does contradict;
//   B3 (false DECIDE) the model's quote added a leading "integration,"; the challengers upheld CI's integration failure,
//                     and the published finding quoted the snapped words, which CI does not contradict.
// Now each claim-class item is asked only after its stated receipt grounds by the check its publication applies, and
// is shown the exact source substring that check returns, as code's `claim` (and in its shown `stated` receipt). One
// that does not ground can never publish: it is never asked, and goes on to grounding, which withholds and counts it
// under the existing closed causes (a quote that did not match the record). A short, context-dependent quote ("none of them still
// calls hash().") is shown beside the whole text it is quoted from (`context`), and code's sentence says that text may
// identify what the words refer to but never widens what they assert — a true contradiction stays DECIDE.
//
// The fake challenger follows the instructions it is sent: it reads only the request bytes, judges the words the
// instructions name as THE claim, resolves a pronoun only from a `context` the instructions allow it to read for that,
// and refutes, citing the agent's own words, what the result does not show false.
//
// Synthetic sessions (/srv/qr paths), synthetic judges: no recording, no model call. Nothing prints.
import { readingStableIds } from './m35-windows-fixture.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { Session } from '../src/session.js';
// Namespace imports, so each test fails on its own against code that predates it.
import * as challenge from '../src/challenge.js';
import * as reviewRun from '../src/run-review.js';

const SESSION_KEY = 'sess-c2-quote-repair';
const TEXT = {
  ask: 'SYNTHETIC_QR_ASK: move the synthetic hashing to digest() and run every suite.',
  e1: 'SYNTHETIC_QR_E1: All six integration tests pass on the branch.',
  b3: 'SYNTHETIC_QR_B3: lint, unit and smoke tests all pass on the branch.',
  moved: 'SYNTHETIC_QR_MOVED: I moved /srv/qr/src/a.js and /srv/qr/src/b.js to digest(); none of them still calls hash().',
  green: 'SYNTHETIC_QR_GREEN: the build is green.',
  docs: 'SYNTHETIC_QR_DOCS: the docs mention every flag in the reference table.',
  ci: 'node /srv/qr/ci.js',
  ciOut: 'SYNTHETIC_QR_CI: integration 4 of 6 passed, 2 failed; lint, unit and smoke passed',
  grep: 'grep -n hash( /srv/qr/src/a.js /srv/qr/src/b.js',
  grepOut: 'SYNTHETIC_QR_GREP: /srv/qr/src/b.js:12: return hash(x);',
  rerunOut: 'SYNTHETIC_QR_CI: integration 6 of 6 passed; lint, unit and smoke passed',
  fixed: 'SYNTHETIC_QR_FIXED: after the fix all six integration tests pass on the branch.',
};
const whole = (key) => [{ sourceKey: key, fromByte: 0, untilByte: Buffer.byteLength(TEXT[key], 'utf8') }];
const T1 = { turn: 'T1' };
const command = (id, key) => ({ id, kind: 'invocation', callKey: id, tool: 'Bash', operation: 'command',
  paths: [], command: whole(key), input: [], changes: [], ...T1 });
const result = (id, invocation, key, over = {}) => ({ id, kind: 'observation', invocation, callKey: invocation,
  phase: 'terminal', result: 'succeeded', exitCode: 0, terminalStatusProven: true, output: whole(key),
  sourceOfResult: 'native', ...T1, ...over });
const said = (id, key) => ({ id, kind: 'commentary', phase: 'working', beforeInvocation: null, text: whole(key), ...T1 });

/** One human turn, one review window: every statement this file judges, then the results, in session order. */
function session() {
  const events = [
    { id: 'I1', kind: 'instruction', authority: 'human', supersedes: [], text: whole('ask'), ...T1 },
    said('C1', 'e1'), said('C2', 'b3'), said('C3', 'moved'), said('C4', 'green'), said('C5', 'docs'),
    command('A1', 'ci'), result('A1-r', 'A1', 'ciOut', { result: 'failed', exitCode: 1 }),
    command('A2', 'grep'), result('A2-r', 'A2', 'grepOut'),
    command('A3', 'ci'), result('A3-r', 'A3', 'rerunOut'),
    said('C6', 'fixed'),
  ].map((event, sequence) => ({ ...event, sequence }));
  return new Session({ sessionKey: SESSION_KEY, adapter: 'claude', blobs: { ...TEXT }, events });
}

const receipt = (eventId, role, quote) => ({ eventId, role, quote });
const CI = receipt('A1-r', 'observation', 'integration 4 of 6 passed, 2 failed');
const GREP = receipt('A2-r', 'observation', '/srv/qr/src/b.js:12: return hash(x);');
/** What publication grounds each near-miss quote to: the exact source substring, one edge word dropped. */
const SNAPPED = Object.freeze({
  e1: 'All six integration tests pass on the branch',
  b3: 'lint, unit and smoke tests all pass on the branch',
});
const CLAIMS = Object.freeze({
  // E1: the narrative model added a trailing word the agent never said.
  e1: { text: 'The agent said the integration suite passes locally.',
    stated: receipt('C1', 'commentary', 'All six integration tests pass on the branch locally.'), contradictedBy: CI },
  // B3: the narrative model added a leading word the agent never said.
  b3: { text: 'The agent said every suite, integration included, passes.',
    stated: receipt('C2', 'commentary', 'integration, lint, unit and smoke tests all pass on the branch.'), contradictedBy: CI },
  // A short quote whose pronoun only its own message resolves — exact, so its bytes are kept.
  pronoun: { text: 'The agent said no moved file still calls hash().',
    stated: receipt('C3', 'commentary', 'none of them still calls hash().'), contradictedBy: GREP },
  // Grounds neither strictly nor by the one repair: a finding could never publish it.
  fabricated: { text: 'The agent said the build and the staging deploy are green.',
    stated: receipt('C4', 'commentary', 'the build is green and every deploy check passed on staging.'), contradictedBy: CI },
  // No contradiction: a promise, which publication grounds strictly. It grounds only after a repair, so never publishes.
  repairOnlyPromise: { text: 'The agent said the docs list every flag.',
    stated: receipt('C5', 'commentary', 'the docs mention every flag in the reference table today.'), contradictedBy: null },
});
const RESOLVED = Object.freeze({ observation: receipt('A3-r', 'observation', 'integration 6 of 6 passed'),
  statement: receipt('C6', 'commentary', 'after the fix all six integration tests pass on the branch.') });
const narrativeOf = (claims) => ({ decisions: [], pivots: [], requirements: [], claims: structuredClone(claims) });

// ---- the fake challenger: it follows the instructions it is sent, and reads nothing but the request bytes --------

const CANDIDATES = '\n# Candidates to challenge\n';
// D71 (S2): a session-only batch gives its candidates one per line; a combined one, one JSON array.
const shownItems = (request) => {
  const tail = request.prompt.slice(request.prompt.lastIndexOf(CANDIDATES) + CANDIDATES.length);
  return tail.startsWith('[') ? JSON.parse(tail) : tail.split('\n').filter(Boolean).map((line) => JSON.parse(line));
};
const noted = (request) => typeof challenge.CLAIM_WORDS_NOTE === 'string' && request.system.includes(challenge.CLAIM_WORDS_NOTE);
/** The words judged as the claim: code's `claim` when the request names it THE claim, else the candidate's `text`. */
const wordsJudged = (request, shown) => (noted(request) && typeof shown.claim === 'string' ? shown.claim : shown.text);
/** May the shown context identify what the words refer to? Only when code's sentence says so and shows one. */
const referentFrom = (request, shown) => noted(request) && /identify what the words refer to/.test(challenge.CLAIM_WORDS_NOTE)
  && typeof shown.context === 'string' ? shown.context : '';
const vote = (key, verdict, cited) => ({ key, verdict, explanation: 'Synthetic.', receipts: [cited] });

/** What each recorded result shows false, read from the judged words (and, for a pronoun, what context names). */
function showsFalse(request, shown) {
  const words = String(wordsJudged(request, shown) ?? '');
  if (shown.contradictedBy.eventId === 'A1-r')
    // A CI run cannot contradict a claim about a local run; it does contradict any claim that integration passes.
    return /integration/i.test(words) && !/locally/i.test(words);
  if (shown.contradictedBy.eventId === 'A2-r') {
    // "them" names nothing by itself: refuted as depending on wording the quote does not contain, unless a context
    // the instructions allow to identify referents names the file the result shows still calling hash().
    if (!/none of them still calls hash\(\)/.test(words)) return false;
    return /\/srv\/qr\/src\/b\.js/.test(referentFrom(request, shown));
  }
  return false;
}

function follow(request, { key, type, candidate: shown }) {
  if (type === 'resolution') return vote(key, 'not-refuted', shown.resolvedBy.observation);
  if (!shown.contradictedBy) return vote(key, 'not-refuted', shown.stated);
  return showsFalse(request, shown) ? vote(key, 'not-refuted', shown.contradictedBy) : vote(key, 'refuted', shown.stated);
}

function judgeWith(narrative, seen = []) {
  return async (request) => {
    seen.push(request);
    if (!request.challenge) return structuredClone(narrative);
    return { votes: shownItems(request).map((item) => follow(request, item)) };
  };
}
const PROFILES = Object.freeze([undefined, 'm33-lean']);
const nameOf = (profile) => profile ?? 'standard';
// M35: the judge reads each request with its window's aliases written back as stable ids (m35-windows-fixture.js).
const run = (claims, speedProfile, seen = []) => {
  const base = session();
  return reviewRun.runReview({ session: base, pr: null, reviewScope: 'session-only', ...(speedProfile ? { speedProfile } : {}),
    judge: readingStableIds(base, judgeWith(narrativeOf(claims), seen), { speedProfile }) });
};
const contradictions = (report) => report.findings.filter((f) => f.kind === 'claim_contradicted');
const decides = (report) => contradictions(report).map((f) => [f.receipts.find((r) => r.role === 'commentary')?.eventId, f.status]);
const commentaryOf = (finding) => finding.receipts.find((r) => r.role === 'commentary');
/** Every shown item of type `type` across the challenge requests, with the request that showed it. */
const shownOf = (seen, type) => seen.filter((request) => request.challenge)
  .flatMap((request) => shownItems(request).filter((item) => item.type === type).map((item) => ({ request, item })));

// ---- E1: an edge word the agent never said can no longer hide a true contradiction --------------------------------

test('M33 C2 repair E1: a quote one trailing word longer than the agent\'s is judged as publication grounds it — DECIDE (both profiles)', async () => {
  for (const profile of PROFILES) {
    const name = nameOf(profile);
    const seen = [];
    const report = await run([CLAIMS.e1], profile, seen);
    const asked = shownOf(seen, 'claim');
    assert.equal(asked.length, 3, `${name}: the claim is asked three times`);
    for (const { request, item } of asked) {
      assert.equal(item.candidate.claim, SNAPPED.e1, `${name}: THE claim is the exact source substring, never the model's string`);
      assert.equal(item.candidate.stated.quote, SNAPPED.e1, `${name}: and its shown receipt quotes the same bytes`);
      assert.ok(!item.candidate.claim.includes('locally') && item.candidate.reviewersReading.includes('locally'),
        `${name}: the word the agent never said is shown only in the reviewer's reading`);
      assert.equal(item.candidate.reviewersReading, CLAIMS.e1.text, name);
      assert.equal(item.candidate.context, TEXT.e1, `${name}: the whole message the words are quoted from`);
      // The internal item is untouched: identity, binding, grounding and publication read the claim as proposed.
      assert.deepEqual(request.challenge.items.find((x) => x.key === item.key).candidate, CLAIMS.e1, name);
    }
    assert.deepEqual(decides(report), [['C1', 'DECIDE']], `${name}: the true contradiction is published`);
    const [finding] = contradictions(report);
    assert.equal(commentaryOf(finding).quote, SNAPPED.e1, `${name}: published on the very words the challengers judged`);
    assert.equal(report.sessionStatus, 'DECIDE', name);
  }
});

// ---- B3: an edge word the agent never said can no longer manufacture a contradiction -------------------------------

test('M33 C2 repair B3: a quote one leading word longer than the agent\'s publishes no DECIDE on words CI does not contradict (both profiles)', async () => {
  for (const profile of PROFILES) {
    const name = nameOf(profile);
    const seen = [];
    const report = await run([CLAIMS.b3], profile, seen);
    const asked = shownOf(seen, 'claim');
    assert.equal(asked.length, 3, name);
    for (const { item } of asked) {
      assert.equal(item.candidate.claim, SNAPPED.b3, name);
      assert.equal(item.candidate.stated.quote, SNAPPED.b3, name);
      assert.ok(!item.candidate.claim.includes('integration'), `${name}: the added word is not the agent's`);
    }
    assert.deepEqual(decides(report), [], `${name}: no DECIDE`);
    assert.notEqual(report.sessionStatus, 'DECIDE', name);
    const [result] = report.windowResults[0].challenge.results.filter((r) => r.type === 'claim');
    assert.ok(result.votes.every((v) => v.valid === true && v.verdict === 'refuted'), `${name}: three valid refutations`);
    assert.equal(result.resolved, true, name);
    assert.equal(report.withheld.unsettled, 0, `${name}: a check that ran and settled`);
    assert.equal(report.sessionReview, 'complete', name);
  }
});

// ---- a short, context-dependent quote: its message may name what it refers to, never widen it --------------------

test('M33 C2 repair: a true contradiction quoted as a short pronoun clause stays DECIDE, its message shown as context (both profiles)', async () => {
  for (const profile of PROFILES) {
    const name = nameOf(profile);
    const seen = [];
    const report = await run([CLAIMS.pronoun], profile, seen);
    const asked = shownOf(seen, 'claim');
    assert.equal(asked.length, 3, name);
    for (const { request, item } of asked) {
      assert.deepEqual(Object.keys(item.candidate), ['proposition', 'claim', 'context', 'stated', 'contradictedBy', 'reviewersReading'], name);
      // Exact quotes keep their bytes: the claim and its receipt are the proposal's, byte for byte.
      assert.equal(item.candidate.claim, CLAIMS.pronoun.stated.quote, name);
      assert.deepEqual(item.candidate.stated, CLAIMS.pronoun.stated, name);
      assert.equal(item.candidate.context, TEXT.moved, `${name}: the whole message it is quoted from`);
      assert.equal(request.system, challenge.checklistSystem(request.challenge.items.map((item) => item.type)), name);
    }
    assert.deepEqual(decides(report), [['C3', 'DECIDE']], `${name}: the referent its message names is not wording it lacks`);
    assert.equal(commentaryOf(contradictions(report)[0]).quote, CLAIMS.pronoun.stated.quote, name);
  }
});

test('M33 C2 repair: code\'s sentence lets the quoted text identify what the words refer to, and never widen what they assert', () => {
  const flat = challenge.CLAIM_WORDS_NOTE.replace(/\s+/g, ' ');
  for (const phrase of [/"context"/, /the whole text those words are quoted from/, /identify what the words refer to/,
    /never widens what they assert/, /exactly as code found them in the record/, /must hold against the verbatim words/,
    /vote refuted/, /cite the agent's verbatim words/])
    assert.match(flat, phrase);
  assert.equal(typeof challenge.CLAIM_CONTEXT_MAX_BYTES, 'number');
  assert.ok(Number.isSafeInteger(challenge.CLAIM_CONTEXT_MAX_BYTES) && challenge.CLAIM_CONTEXT_MAX_BYTES > 0);
});

// ---- a quote that does not ground is never asked --------------------------------------------------------------------

test('M33 C2 repair: a claim whose words do not ground by its publication\'s check is never asked, and is withheld (both profiles)', async () => {
  for (const profile of PROFILES) {
    const name = nameOf(profile);
    const seen = [];
    const claims = [CLAIMS.fabricated, CLAIMS.repairOnlyPromise, CLAIMS.e1];
    const report = await run(claims, profile, seen);
    const askedKeys = new Set(seen.filter((request) => request.challenge).flatMap((request) => shownItems(request).map((i) => i.key)));
    assert.ok(!askedKeys.has('claims:0'), `${name}: a fabricated quote is never put to a challenger`);
    assert.ok(!askedKeys.has('claims:1'), `${name}: nor a promise whose quote grounds only after a repair`);
    assert.ok(askedKeys.has('claims:2'), `${name}: a grounded claim beside them is asked`);
    const window = report.windowResults[0];
    // Never a challenge item: no vote, no refutation, nothing unsettled, and nothing withheld at the challenge.
    assert.ok(!window.challenge.results.some((r) => ['claims:0', 'claims:1'].includes(r.key)), name);
    assert.ok(!window.challenge.rejected.some((r) => ['claims:0', 'claims:1'].includes(r.key)), name);
    assert.equal(window.challenge.withheldProposals, 0, name);
    // Grounded, unasked, by the very check publication applies: withheld and counted exactly as a claim whose quote did
    // not match the record always was — once each, under the existing closed causes, never a gap.
    assert.equal(window.grounding.withheld, 2, `${name}: both withheld by grounding`);
    assert.equal(window.grounding.claimsRejected, 2, name);
    assert.equal(window.groundingComplete, true, `${name}: a check that ran and was inconclusive`);
    assert.deepEqual(report.rejectedFindings.map((r) => r.reason), ['receipt_rejected'], `${name}: the contradicted one's finding`);
    assert.equal(report.withheld.proposals, 2, `${name}: each once`);
    assert.equal(report.claimsRejected, 2, name);
    assert.equal(report.promises.length, 0, name);
    assert.deepEqual(decides(report), [['C1', 'DECIDE']], `${name}: and nothing else about the window changes`);
    assert.equal(report.sessionReview, 'complete', `${name}: a withheld quote never makes the review incomplete`);
    assert.equal(window.challenge.complete, true, name);
  }
});

// ---- resolution and support items show the same grounded words ---------------------------------------------------

test('M33 C2 repair: a resolution item shows its claim as publication grounds it (both profiles)', async () => {
  for (const profile of PROFILES) {
    const name = nameOf(profile);
    const seen = [];
    const report = await run([{ ...CLAIMS.e1, resolvedBy: RESOLVED }], profile, seen);
    const asked = shownOf(seen, 'resolution');
    assert.equal(asked.length, 3, `${name}: the resolution item is asked three times`);
    for (const { request, item } of asked) {
      assert.deepEqual(Object.keys(item.candidate),
        ['proposition', 'claim', 'context', 'stated', 'contradictedBy', 'resolvedBy', 'reviewersReading'], name);
      assert.equal(item.candidate.claim, SNAPPED.e1, name);
      assert.equal(item.candidate.stated.quote, SNAPPED.e1, name);
      assert.equal(item.candidate.context, TEXT.e1, name);
      assert.deepEqual(item.candidate.resolvedBy, RESOLVED, `${name}: the proposed pair, as proposed`);
      assert.equal(request.system, challenge.checklistSystem(request.challenge.items.map((item) => item.type)), name);
    }
    assert.deepEqual(contradictions(report).map((f) => `${f.status}/${f.disclosureReason}`), ['FYI/self_corrected'], name);
  }
});

// ---- challengeItems: code's words or nothing ---------------------------------------------------------------------

test('M33 C2 repair: challengeItems shows code\'s grounded words, never the candidate\'s, and never asks a claim item without them', async () => {
  const item = { key: 'claims:0', type: 'claim', candidate: structuredClone(CLAIMS.e1),
    verbatim: { quote: SNAPPED.e1, context: TEXT.e1 } };
  const seen = [];
  await challenge.challengeItems({ items: [item], evidence: 'SYNTHETIC WINDOW EVIDENCE', passes: 1, requiredSurvivals: 1,
    verifyReceipt: (r) => ({ ok: true, receipt: r }),
    judge: async (request) => { seen.push(request); return { votes: [vote(item.key, 'refuted', CLAIMS.e1.stated)] }; } });
  const [shown] = shownItems(seen[0]);
  assert.deepEqual(shown.candidate, { claim: SNAPPED.e1, context: TEXT.e1, stated: { ...CLAIMS.e1.stated, quote: SNAPPED.e1 },
    contradictedBy: CI, reviewersReading: CLAIMS.e1.text });
  assert.deepEqual(challenge.shownCandidate(item), shown.candidate, 'the one place a shown candidate is made');
  // Without code's words — or with words that are not a string — a claim-class item is never asked: its slots are
  // checks that did not run (fail closed), never a request showing the narrative model's string or its paraphrase.
  for (const verbatim of [undefined, null, {}, { quote: '' }, { quote: 7 }, { quote: SNAPPED.e1, context: 7 }]) {
    for (const type of challenge.CLAIM_ITEM_TYPES) {
      const bare = { key: 'k', type, candidate: structuredClone(CLAIMS.e1), ...(verbatim === undefined ? {} : { verbatim }) };
      assert.equal(challenge.shownCandidate(bare), null, `${type} ${JSON.stringify(verbatim)}`);
      let calls = 0;
      const out = await challenge.challengeItems({ items: [bare], evidence: 'E', passes: 1, requiredSurvivals: 1,
        verifyReceipt: (r) => ({ ok: true, receipt: r }), judge: async () => { calls++; return { votes: [] }; } });
      assert.equal(calls, 0, `${type} ${JSON.stringify(verbatim)}: never sent`);
      assert.deepEqual(out.rejected, [{ key: 'k', type, resolved: false, executionComplete: false, reason: 'unreviewed_scope' }]);
      assert.equal(out.complete, false);
    }
  }
  // A context longer than the bound is not shown; the evidence still holds the whole message.
  const long = 'x'.repeat(challenge.CLAIM_CONTEXT_MAX_BYTES + 1);
  assert.deepEqual(challenge.verbatimWords('the quote', [`${long} the quote`]), { quote: 'the quote' });
  assert.deepEqual(challenge.verbatimWords('the quote', ['said: the quote']), { quote: 'the quote', context: 'said: the quote' });
  // No context when two different shown texts hold the words (no guess), or when the text is the words themselves.
  assert.deepEqual(challenge.verbatimWords('the quote', ['a: the quote', 'b: the quote']), { quote: 'the quote' });
  assert.deepEqual(challenge.verbatimWords('the quote', ['the quote', 'the quote']), { quote: 'the quote' });
  assert.deepEqual(challenge.verbatimWords('the quote', []), { quote: 'the quote' });
});
