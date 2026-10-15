// D78 (owner decision 2026-10-11): exact repeats of a claim are one claim. Two claims at the same event with the same
// role, quote, contradiction, resolution and support are one, whatever the review's paraphrase (`text`): the first is
// kept, with its text, and checked once; a copy that differs in any of those is another claim. Written statements
// follow the same rule in their own channel. Applied to a window's kept answer before anything is checked
// (`withoutRepeats`), and the proposal re-ask's and the evidence re-ask's merges never add a paraphrase of a present
// claim (`proposalIdentity`), since a published claim could repeat another.
//
// Synthetic sessions (/srv/x paths) and synthetic judges only: no recording, no model call. Nothing prints.
import test from 'node:test';
import assert from 'node:assert/strict';
import { Session } from '../src/session.js';
import * as reviewRun from '../src/run-review.js';
import { bytesOfTokens } from '../src/windows.js';

const REPO = { host: 'github.com', id: '0' };
const KEY = 'sess-d78';
const TEXT = {
  ask: 'SYNTHETIC_D78_ASK: make the synthetic replay report no gaps and say so.',
  ask2: 'SYNTHETIC_D78_ASK2: now do the same for the synthetic export.',
  replay: 'node /srv/x/replay.js',
  three: 'SYNTHETIC_D78_REPLAY: gaps=3',
  zero: 'SYNTHETIC_D78_REPLAY: gaps=0',
  claim: 'SYNTHETIC_D78_CLAIM: the replay reports no gaps.',
  fixed: 'SYNTHETIC_D78_FIXED: the replay now reports gaps=0.',
  claim2: 'SYNTHETIC_D78_CLAIM2: the export reports no gaps.',
  cat: 'cat /srv/x/big.log',
  big: 'y'.repeat(bytesOfTokens(3_000)),
};
const ref = (key) => [{ sourceKey: key, fromByte: 0, untilByte: Buffer.byteLength(TEXT[key], 'utf8') }];
const command = (id, key, turn) => ({ id, kind: 'invocation', callKey: id, tool: 'Bash', operation: 'command',
  paths: [], command: ref(key), input: [], changes: [], turn });
const output = (id, invocation, key, failed, turn) => ({ id, kind: 'observation', invocation, callKey: invocation,
  phase: 'terminal', result: failed ? 'failed' : 'succeeded', exitCode: failed ? 1 : 0, terminalStatusProven: true,
  output: ref(key), sourceOfResult: 'native', turn });
const said = (id, key, turn, phase = 'working') => ({ id, kind: 'commentary', phase, beforeInvocation: null,
  text: ref(key), turn });
const ask = (id, key, turn) => ({ id, kind: 'instruction', authority: 'human', supersedes: [], text: ref(key), turn });
/** 60 progress results of one `cat`, 180k tokens no window carries: two of them split a session-only review in two. */
const filler = (id, turn) => [command(id, 'cat', turn), ...Array.from({ length: 60 }, (_, k) => ({ id: `${id}-r${k}`,
  kind: 'observation', invocation: id, callKey: id, phase: 'progress', result: 'succeeded', exitCode: null,
  output: ref('big'), sourceOfResult: 'native', turn }))];

/** One turn: the ask, a failing replay, the claim, a passing replay and the agent's statement of it. */
const oneTurn = () => [ask('I1', 'ask', 'T1'), command('A1', 'replay', 'T1'), output('A1-r', 'A1', 'three', true, 'T1'),
  said('C1', 'claim', 'T1'), command('A2', 'replay', 'T1'), output('A2-r', 'A2', 'zero', false, 'T1'),
  said('C3', 'fixed', 'T1', 'final')];
const session = (events = oneTurn()) => new Session({ sessionKey: KEY, adapter: 'claude', blobs: { ...TEXT },
  children: [], events: events.map((event, sequence) => ({ ...event, sequence })) });
/** Two requests, split by size alone: the first turn, then a second ask with its own claim. */
const twoTurns = () => [...oneTurn(), ...filler('F1', 'T1'), ask('I2', 'ask2', 'T2'), said('C2', 'claim2', 'T2'),
  ...filler('F2', 'T2')];

const receipt = (eventId, role, quote) => ({ eventId, role, quote });
const STATED = receipt('C1', 'commentary', 'the replay reports no gaps.');
const AGAINST = receipt('A1-r', 'observation', TEXT.three);
const SUPPORT = receipt('A2-r', 'observation', TEXT.zero);
const RESOLVED_BY = Object.freeze({ observation: receipt('A2-r', 'observation', TEXT.zero),
  statement: receipt('C3', 'commentary', 'the replay now reports gaps=0.') });
const FIRST = 'The agent said the replay reports no gaps.';
const SECOND = 'The replay, the agent claims, shows no gap.';
/** A claim of `text` on the statement, with whatever it cites. */
const claim = (text, cites = {}) => ({ text, stated: STATED, ...cites });
const EMPTY = Object.freeze({ decisions: [], pivots: [], claims: [], requirements: [] });
const narrative = (claims, extra = {}) => ({ ...EMPTY, claims: structuredClone(claims), ...structuredClone(extra) });
const unique = (claims, extra = {}, over = {}) => reviewRun.withoutRepeats(narrative(claims, extra),
  { session: session(), repo: REPO, sourceMap: null, ...over });
const texts = (list) => list.map((c) => c.text);

// ---- 1. the rule, on one answer -------------------------------------------------------------------------------------

test('D78: exact repeats of a claim are one claim — the first kept, with its text, deterministically', () => {
  const same = { plain: {}, contradicted: { contradictedBy: AGAINST },
    resolved: { contradictedBy: AGAINST, resolvedBy: RESOLVED_BY }, supported: { supportedBy: SUPPORT },
    'a null contradiction beside an absent one': null };
  for (const [name, cites] of Object.entries(same)) {
    const pair = cites === null ? [claim(FIRST), claim(SECOND, { contradictedBy: null })]
      : [claim(FIRST, cites), claim(SECOND, cites)];
    const kept = unique(pair);
    assert.deepEqual(texts(kept.narrative.claims), [FIRST], name);
    assert.deepEqual(kept.narrative.claims[0], pair[0], `${name}: the first copy, as it came`);
    assert.deepEqual(kept.repeats, { claims: 1, written: 0 }, name);
    const reversed = unique([...pair].reverse());
    assert.deepEqual(texts(reversed.narrative.claims), [SECOND], `${name}: whichever comes first is the one kept`);
  }
  // Three copies are one claim; two repeats are counted.
  const three = unique([claim(FIRST), claim(SECOND), claim('A third paraphrase.')]);
  assert.deepEqual(three.repeats, { claims: 2, written: 0 });
  // Nothing else of the answer moves: the other channels, the closing lines and the failure rows are as they came.
  const extra = { decisions: [{ dimension: 'SYNTHETIC_D78_UNREADABLE' }], notClaims: [{ eventId: 'C3', lines: [1] }] };
  const kept = unique([claim(FIRST), claim(SECOND)], extra);
  assert.deepEqual(kept.narrative.decisions, extra.decisions);
  assert.deepEqual(kept.narrative.notClaims, extra.notClaims);
  assert.deepEqual(Object.keys(kept.narrative), ['decisions', 'pivots', 'claims', 'requirements', 'notClaims'],
    'the answer\'s own order');
});

test('D78: the same quote with another event, contradiction, resolution or support is another claim, apart', () => {
  const base = claim(FIRST, { contradictedBy: AGAINST });
  const apart = {
    'another event': claim(SECOND, { contradictedBy: AGAINST,
      stated: receipt('C3', 'commentary', 'the replay reports no gaps.') }),
    'another quote': claim(SECOND, { contradictedBy: AGAINST,
      stated: receipt('C1', 'commentary', 'reports no gaps.') }),
    'no contradiction': claim(SECOND),
    'another contradiction': claim(SECOND, { contradictedBy: receipt('A2-r', 'observation', TEXT.zero) }),
    'a resolution': claim(SECOND, { contradictedBy: AGAINST, resolvedBy: RESOLVED_BY }),
    'a support': claim(SECOND, { contradictedBy: AGAINST, supportedBy: SUPPORT }),
  };
  for (const [name, other] of Object.entries(apart)) {
    const kept = unique([base, other]);
    assert.deepEqual(texts(kept.narrative.claims), [FIRST, SECOND], name);
    assert.deepEqual(kept.repeats, { claims: 0, written: 0 }, name);
  }
  // Two supports that differ in one receipt field are two claims; a support repeated exactly is one.
  const supported = (quote) => claim(SECOND, { supportedBy: receipt('A2-r', 'observation', quote) });
  assert.equal(unique([claim(FIRST, { supportedBy: SUPPORT }), supported('gaps=0')]).narrative.claims.length, 2);
  assert.equal(unique([claim(FIRST, { supportedBy: SUPPORT }), supported(TEXT.zero)]).narrative.claims.length, 1);
});

test('D78: a copy no check can read is never dropped for an identity, and never keeps a readable copy out', () => {
  // `stated.role` is not the contract's: unreadable (`kind_rejected`), so both stay and the window stays incomplete.
  const unreadable = (text) => ({ text, stated: receipt('C1', 'action', 'the replay reports no gaps.') });
  assert.deepEqual(texts(unique([unreadable(FIRST), unreadable(SECOND)]).narrative.claims), [FIRST, SECOND]);
  // An unreadable copy before a readable one: the readable one is kept too.
  const mixed = unique([unreadable(FIRST), claim(SECOND), claim('Again.')]);
  assert.deepEqual(texts(mixed.narrative.claims), [FIRST, SECOND]);
  assert.deepEqual(mixed.repeats, { claims: 1, written: 0 });
  // A claim whose cited receipts no identity can be computed for (a non-string field) is kept as it came.
  const odd = claim(SECOND, { contradictedBy: { eventId: 'A1-r', role: 'observation', quote: 7 } });
  assert.deepEqual(texts(unique([claim(FIRST), odd, odd]).narrative.claims), [FIRST, SECOND, SECOND]);
  // A copy whose published record cannot be computed (a lone surrogate the transport's parser accepted, in its text) is
  // unread by its own check: never the kept copy, and the readable copy after it is kept and counted as no repeat.
  const lone = claim(`${FIRST} \ud83d`);
  assert.deepEqual(texts(unique([lone, claim(SECOND)]).narrative.claims), [lone.text, SECOND]);
  assert.deepEqual(unique([lone, claim(SECOND)]).repeats, { claims: 0, written: 0 });
  // Not an answer at all: returned as it came, nothing counted.
  assert.deepEqual(reviewRun.withoutRepeats(null, { session: session(), repo: REPO }),
    { narrative: null, repeats: { claims: 0, written: 0 } });
});

test('D78: written statements follow the same rule in their own channel, counted apart from the chat claims', () => {
  const written = (text, cites = {}) => ({ text, stated: receipt('W1', 'code', 'gaps: 0'), ...cites });
  const kept = unique([claim(FIRST), claim(SECOND)], { writtenClaims: [written('The notes say gaps: 0.'),
    written('Gaps 0, the notes say.'), written('Contradicted.', { contradictedBy: AGAINST }),
    written('Again.', { contradictedBy: AGAINST })] });
  assert.deepEqual(texts(kept.narrative.claims), [FIRST]);
  assert.deepEqual(texts(kept.narrative.writtenClaims), ['The notes say gaps: 0.', 'Contradicted.']);
  assert.deepEqual(kept.repeats, { claims: 1, written: 2 });
  // A `writtenClaims` member that is not a list is one unreadable proposal: kept as it came.
  const odd = unique([claim(FIRST)], { writtenClaims: { text: 'not a list' } });
  assert.deepEqual(odd.narrative.writtenClaims, { text: 'not a list' });
  assert.deepEqual(odd.repeats, { claims: 0, written: 0 });
});

// ---- 2. the two re-asks' merges ------------------------------------------------------------------------------------

test('D78: the proposal re-ask\'s merge never adds a paraphrase of a claim the first answer holds', () => {
  const s = session();
  const malformed = { dimension: 'SYNTHETIC_D78_UNREADABLE' };
  const ask = (first, second) => reviewRun.reaskedAnswer({ first: { ...EMPTY, decisions: [malformed], ...first },
    second: { ...EMPTY, ...second }, session: s, repo: REPO, sourceMap: null });
  for (const cites of [{}, { contradictedBy: AGAINST }, { supportedBy: SUPPORT }]) {
    const merged = ask({ claims: [claim(FIRST, cites)] }, { claims: [claim(SECOND, cites)] });
    assert.deepEqual(texts(merged.narrative.claims), [FIRST], 'the first answer\'s copy stands');
    assert.equal(merged.recovered, true);
  }
  // Review-WP2 still holds: a copy that cites a contradiction the first answer's copy does not is another claim.
  const cited = ask({ claims: [claim(FIRST)] }, { claims: [claim(SECOND, { contradictedBy: AGAINST })] });
  assert.deepEqual(texts(cited.narrative.claims), [FIRST, SECOND]);
  // And a written statement's paraphrase, likewise.
  const written = (text) => ({ text, stated: receipt('W1', 'code', 'gaps: 0') });
  const notes = ask({ writtenClaims: [written('The notes say gaps: 0.')] },
    { writtenClaims: [written('Gaps 0, the notes say.')] });
  assert.deepEqual(texts(notes.narrative.writtenClaims), ['The notes say gaps: 0.']);
});

test('D78: the evidence re-ask\'s merge keeps the re-ask\'s copy of a claim, never also the first answer\'s', () => {
  const s = session();
  for (const cites of [{}, { contradictedBy: AGAINST }, { supportedBy: SUPPORT }]) {
    const merged = reviewRun.servedAnswer({ first: narrative([claim(FIRST, cites)]),
      reask: narrative([claim(SECOND, cites)]), session: s, repo: REPO, sourceMap: null });
    assert.deepEqual(texts(merged.narrative.claims), [SECOND], 'the re-ask was asked with more: its copy is kept');
    assert.equal(merged.fromFirst, 0, 'nothing of the first answer was lost: its claim is present');
  }
  // A first-answer claim the re-ask left out is still kept after the re-ask's (M36 phase 3 review).
  const another = claim('Another statement.',
    { stated: receipt('C3', 'commentary', 'the replay now reports gaps=0.') });
  const kept = reviewRun.servedAnswer({ first: narrative([claim(FIRST), another]), reask: narrative([claim(SECOND)]),
    session: s, repo: REPO, sourceMap: null });
  assert.deepEqual(texts(kept.narrative.claims), [SECOND, 'Another statement.']);
  assert.equal(kept.fromFirst, 1);
});

test('D78: in either merge, a copy whose record cannot be computed never keeps a clean copy of its claim out', () => {
  const s = session();
  // A lone surrogate the transport's parser accepted, in its text: the C-06 identity digest refuses its record.
  const lone = claim(`${FIRST} \ud83d`);
  const malformed = { dimension: 'SYNTHETIC_D78_UNREADABLE' };
  // The proposal re-ask: the first answer's unrecordable copy stands, and the re-ask's clean copy is added beside it.
  const reasked = reviewRun.reaskedAnswer({ first: { ...EMPTY, decisions: [malformed], claims: [lone] },
    second: narrative([claim(SECOND)]), session: s, repo: REPO, sourceMap: null });
  assert.deepEqual(texts(reasked.narrative.claims), [lone.text, SECOND]);
  // The evidence re-ask: the re-ask's unrecordable copy is the base; the first answer's clean copy is kept after it.
  const served = reviewRun.servedAnswer({ first: narrative([claim(FIRST)]), reask: narrative([lone]),
    session: s, repo: REPO, sourceMap: null });
  assert.deepEqual(texts(served.narrative.claims), [lone.text, FIRST]);
  assert.equal(served.fromFirst, 1);
  // And the one pass after either merge keeps both: the clean copy is the one published.
  for (const merged of [reasked, served])
    assert.equal(reviewRun.withoutRepeats(merged.narrative, { session: s, repo: REPO }).narrative.claims.length, 2);
});

// ---- 3. the window: one item per claim before the challenge; two windows ---------------------------------------

/** Every challenge vote is an honest not-refuted vote citing the item's own receipt; `seen` collects the requests. */
const ownReceipt = ({ candidate }) => candidate.resolvedBy?.observation ?? candidate.contradictedBy
  ?? candidate.supportedBy ?? candidate.stated ?? candidate.instruction ?? candidate.receipts?.[0];
function judgeOf(answers, seen = []) {
  return async (request) => {
    seen.push(request);
    if (request.challenge) return { votes: request.challenge.items.map((item) => ({ key: item.key,
      verdict: 'not-refuted', explanation: 'Synthetic.', receipts: [ownReceipt(item)] })) };
    return structuredClone(answers[request.window.index] ?? EMPTY);
  };
}
/** The `claim` items every challenge request of window `w` asked, by key, once each (a batch is asked thrice). */
const claimItemsAsked = (seen, w) => [...new Set(seen
  .filter((r) => r.challenge && r.label.startsWith(`challenge:w${w}:`))
  .flatMap((r) => r.challenge.items.filter((item) => item.type === 'claim').map((item) => item.key)))].sort();
const review = (s, answers, seen = [], plan = null) => reviewRun.runReview({ session: s, pr: null,
  reviewScope: 'session-only', judge: judgeOf(answers, seen), ...(plan ? { plan } : {}) });

test('D78: a window\'s repeated claims are one item for the challenge and one row for the report', async () => {
  const seen = [];
  const report = await review(session(), [narrative([claim(FIRST), claim(SECOND), claim('A third paraphrase.')])],
    seen);
  assert.deepEqual(claimItemsAsked(seen, 1), ['claims:0'], 'one item for the three copies');
  assert.deepEqual(report.promises.map((p) => [p.text, p.status]), [[FIRST, 'open']],
    'one row, the first copy\'s words');
  assert.deepEqual(report.counts.claimRepeats, { claims: 2, written: 0 });
  assert.deepEqual(report.windowResults.map((w) => w.claimRepeats), [{ claims: 2, written: 0 }]);
  assert.equal(report.sessionReview, 'complete');
  // A repeated contradiction: one finding, challenged once, nothing for the ledger's merge to collapse.
  const contradicted = [];
  const decided = await review(session(), [narrative([claim(FIRST, { contradictedBy: AGAINST }),
    claim(SECOND, { contradictedBy: AGAINST })])], contradicted);
  assert.deepEqual(claimItemsAsked(contradicted, 1), ['claims:0']);
  assert.deepEqual(decided.findings.map((f) => f.kind), ['claim_contradicted']);
  assert.equal(decided.counts.findingsMerged, 0, 'the second copy was never a second finding');
  assert.deepEqual(decided.counts.claimRepeats, { claims: 1, written: 0 });
  // No repeat: the counts are absent, so a report without one keeps its bytes.
  const alone = await review(session(), [narrative([claim(FIRST)])]);
  assert.equal(alone.counts.claimRepeats, undefined);
  assert.ok(alone.windowResults.every((w) => !Object.hasOwn(w, 'claimRepeats')));
});

test('D78: two windows each keep one claim per identity, challenged once in their own window, counted together',
  async () => {
  const s = session(twoTurns());
  const plan = reviewRun.planWindowRequests({ session: s, reviewScope: 'session-only' });
  assert.equal(plan.windows.length, 2, 'premise: two windows');
  const second = { stated: receipt('C2', 'commentary', 'the export reports no gaps.') };
  const seen = [];
  const report = await review(s, [narrative([claim(FIRST), claim(SECOND)]),
    narrative([claim('The export is clean.', second), claim('No gap in the export.', second)])], seen, plan);
  assert.deepEqual([claimItemsAsked(seen, 1), claimItemsAsked(seen, 2)], [['claims:0'], ['claims:0']]);
  assert.deepEqual(report.promises.map((p) => [p.stated.eventId, p.text]),
    [['C1', FIRST], ['C2', 'The export is clean.']]);
  assert.deepEqual(report.counts.claimRepeats, { claims: 2, written: 0 });
  assert.deepEqual(report.windowResults.map((w) => w.claimRepeats),
    [{ claims: 1, written: 0 }, { claims: 1, written: 0 }]);
});

test('D78: the rule reads answers only — it is pure, and no request is built from one', () => {
  const s = session(twoTurns());
  // `withoutRepeats` is pure: the answer it is given is not changed, and the same answer gives the same result.
  const answer = narrative([claim(FIRST), claim(SECOND)]);
  const before = structuredClone(answer);
  const once = reviewRun.withoutRepeats(answer, { session: s, repo: REPO });
  assert.deepEqual(answer, before);
  assert.deepEqual(reviewRun.withoutRepeats(answer, { session: s, repo: REPO }), once);
  // The narrative requests are planned before any answer exists (no request byte moved: every planned request hashes
  // the same before and after this change): none holds an answer's words.
  for (const { request } of reviewRun.planWindowRequests({ session: s, reviewScope: 'session-only' }).requests)
    assert.ok(!request.prompt.includes(FIRST) && !request.prompt.includes(SECOND));
});
