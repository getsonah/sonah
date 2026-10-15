// M33 I3 (C-06 "M33 self-corrected claims" and "M33 written statements"). How the two challenge classes
// that are not ordinary proposals are batched — the rule the comments in challenge.js and run-review.js
// must state, held here to what the code does:
//   - a window's resolution items are asked in one challenge run of their own, and its written
//     statements' items in another: never in a batch with an ordinary proposal or with the other class;
//   - items of the same class are batched together, within CHALLENGE_PROFILE's item and byte limits;
//   - a malformed reply voids that pass for every item in its batch, and the bounded per-pass re-ask
//     asks those slots again; a malformed reply of one class never costs another class any vote;
//   - a call that throws anything but an unreadable reply (not in REASKABLE_JUDGE_CODES) costs every
//     item in its batch that pass, and is not re-asked;
//   - an item is judged by the survival rule on the votes that stand, whichever pass was voided: two
//     grounded support votes uphold it even with one slot never answered. A resolution slot left
//     unanswered makes the window incomplete even then; a written slot never does.
// Cost, with k items of one class: 3 x ceil(k/16) planned calls (when the byte bound does not split a
// batch) plus at most 3 re-asks, against 3k planned calls for one item per call.
// The key-swap risk (C-05 "M33 vote binding"): a well-formed reply that files batch-mates' verdicts under each
// other's keys is never re-asked — code cannot tell it apart. A not-refuted vote on a publication-bound item (a
// contradicted claim, a resolution, a written statement's contradiction) counts as support only when it cites one
// of that item's own events (one hop invocation <-> result included: event level only, M33 C event binding).
//   - Closed for batch-mates whose events are DISJOINT: a swapped support vote cites its batch-mate's events, so it
//     cannot publish the wrong FYI or label the wrong statement `contradicted`; it can only cost the honest one
//     (conservative).
//   - Accepted risk, recorded as known failures (todo) below, for batch-mates that SHARE an event (two resolutions
//     citing one rerun, two written statements one result is said to contradict): the swapped vote cites an event
//     that is the wrong item's own too, and code cannot tell it from an honest vote without hiding honest votes
//     (M33 C recheck 2's quote and misfiled-vote rules tried, and hid honest votes on true contradictions).
// The judges here cite each item's own evidence.
//
// Synthetic session (/srv/x paths), synthetic judges: no recording, no model call. Nothing prints.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { Session } from '../src/session.js';
import * as reviewRun from '../src/run-review.js';
import * as challenge from '../src/challenge.js';
import { beforeRelayRule } from './m33-h-relay-rule-fixture.js';
import { beforeStatusFact } from './status-fact-fixture.js';
import { beforeHedgedClaims } from './h3-hedged-claims-fixture.js';
import { requestBeforeSupportOrder } from './m33-support-order-fixture.js';
import { textBeforeW2, textBeforeW3, textBeforeFixReview } from './m33-integration-fixture.js';

const SESSION_KEY = 'sess-i3';
const TEXT = {
  ask: 'SYNTHETIC_I3_ASK: make the synthetic replay and lint clean, and note the status.',
  replay: 'node /srv/x/replay.js',
  lint: 'node /srv/x/lint.js',
  noteA: '# Synthetic notes\nSYNTHETIC_I3_NOTE_A: every synthetic replay passes.\n',
  noteB: '# Synthetic status\nSYNTHETIC_I3_NOTE_B: the synthetic lint is clean.\n',
  wroteA: 'SYNTHETIC_I3_WROTE_A: file created',
  wroteB: 'SYNTHETIC_I3_WROTE_B: file created',
  claimA: 'SYNTHETIC_I3_CLAIM_A: the replay is clean now.',
  replay3: 'SYNTHETIC_I3_REPLAY: gaps=3',
  claimB: 'SYNTHETIC_I3_CLAIM_B: the lint is clean now.',
  lint2: 'SYNTHETIC_I3_LINT: 2 warnings',
  replay0: 'SYNTHETIC_I3_REPLAY: gaps=0',
  fixedA: 'SYNTHETIC_I3_FIXED_A: the replay now reports gaps=0 after the fix.',
  lint0: 'SYNTHETIC_I3_LINT: 0 warnings',
  fixedB: 'SYNTHETIC_I3_FIXED_B: the lint now reports 0 warnings after the fix.',
};
const whole = (key) => [{ sourceKey: key, fromByte: 0, untilByte: Buffer.byteLength(TEXT[key], 'utf8') }];
const T1 = { turn: 'T1' };
const command = (id, key) => ({ id, kind: 'invocation', callKey: id, tool: 'Bash', operation: 'command',
  paths: [], command: whole(key), input: [], changes: [], ...T1 });
const write = (id, path, key) => ({ id, kind: 'invocation', callKey: id, tool: 'Write', operation: 'write',
  paths: [{ path }], command: [], input: [], changes: [{ path, diff: [], before: [], after: whole(key) }], ...T1 });
const result = (id, invocation, out, over = {}) => ({ id, kind: 'observation', invocation, callKey: invocation,
  phase: 'terminal', result: 'succeeded', exitCode: 0, terminalStatusProven: true, output: whole(out),
  sourceOfResult: 'native', ...T1, ...over });
const said = (id, key, phase = 'working') => ({ id, kind: 'commentary', phase, beforeInvocation: null, text: whole(key), ...T1 });

/** One human turn, one review window: two written notes, two claims each contradicted by a later failing
 *  run, and each corrected in the same turn by a later passing run of the same measurement and an
 *  accurate statement. */
function session() {
  const events = [
    { id: 'I1', kind: 'instruction', authority: 'human', supersedes: [], text: whole('ask'), ...T1 },
    write('W1', '/srv/x/NOTES.md', 'noteA'), result('W1-r', 'W1', 'wroteA'),
    write('W2', '/srv/x/STATUS.md', 'noteB'), result('W2-r', 'W2', 'wroteB'),
    said('C1', 'claimA'),
    command('A1', 'replay'), result('A1-r', 'A1', 'replay3', { result: 'failed', exitCode: 1 }),
    said('C2', 'claimB'),
    command('L1', 'lint'), result('L1-r', 'L1', 'lint2', { result: 'failed', exitCode: 1 }),
    command('A2', 'replay'), result('A2-r', 'A2', 'replay0'),
    said('C3', 'fixedA'),
    command('L2', 'lint'), result('L2-r', 'L2', 'lint0'),
    said('C4', 'fixedB', 'final'),
  ].map((event, sequence) => ({ ...event, sequence }));
  return new Session({ sessionKey: SESSION_KEY, adapter: 'claude', blobs: { ...TEXT }, events });
}

const receipt = (eventId, role, quote) => ({ eventId, role, quote });
const quoted = (key) => TEXT[key].trim().split('\n').at(-1);
const CLAIM_A = { text: 'The agent said the replay is clean.', stated: receipt('C1', 'commentary', 'the replay is clean now.'),
  contradictedBy: receipt('A1-r', 'observation', TEXT.replay3) };
const CLAIM_B = { text: 'The agent said the lint is clean.', stated: receipt('C2', 'commentary', 'the lint is clean now.'),
  contradictedBy: receipt('L1-r', 'observation', TEXT.lint2) };
const RESOLVED_A = { observation: receipt('A2-r', 'observation', TEXT.replay0),
  statement: receipt('C3', 'commentary', 'the replay now reports gaps=0 after the fix.') };
const RESOLVED_B = { observation: receipt('L2-r', 'observation', TEXT.lint0),
  statement: receipt('C4', 'commentary', 'the lint now reports 0 warnings after the fix.') };
const WRITTEN_A = { text: 'The notes say every replay passes.', stated: receipt('W1', 'code', quoted('noteA')),
  contradictedBy: receipt('A1-r', 'observation', TEXT.replay3) };
const WRITTEN_B = { text: 'The status says the lint is clean.', stated: receipt('W2', 'code', quoted('noteB')),
  contradictedBy: receipt('L1-r', 'observation', TEXT.lint2) };

/** Both claims resolved, both written statements contradicted — or `bare` claims without a resolution. */
const narrativeOf = ({ resolved = true, written = true } = {}) => ({ decisions: [], pivots: [], requirements: [],
  claims: resolved ? [{ ...CLAIM_A, resolvedBy: RESOLVED_A }, { ...CLAIM_B, resolvedBy: RESOLVED_B }] : [CLAIM_A, CLAIM_B],
  writtenClaims: written ? [WRITTEN_A, WRITTEN_B] : [] });
const EMPTY = { decisions: [], pivots: [], claims: [], requirements: [] };
/** M33 C: each item's own evidence, as an honest challenger cites it for support (vote binding). A key nobody
 *  asked about cites the first claim's statement. */
const OWN = Object.freeze({
  'claims:0': CLAIM_A.stated, 'claims:1': CLAIM_B.stated,
  'claims:0:resolution': RESOLVED_A.observation, 'claims:1:resolution': RESOLVED_B.observation,
  'writtenClaims:0': WRITTEN_A.contradictedBy, 'writtenClaims:1': WRITTEN_B.contradictedBy,
});
const SUPPORT = CLAIM_A.stated;
const vote = (key, verdict = 'not-refuted', cited = OWN[key] ?? SUPPORT) => ({ key, verdict, explanation: 'Recorded.', receipts: [cited] });
const upholdAll = ({ key }) => vote(key);

/** `reply(request)` answers a challenge request; null means "uphold every item". Every request is kept. */
function judgeWith(narrative, reply, seen = []) {
  return async (request) => {
    seen.push(request);
    if (!request.challenge) return request.window.index === 0 ? structuredClone(narrative) : EMPTY;
    return reply?.(request) ?? { votes: request.challenge.items.map(upholdAll) };
  };
}
const review = (narrative, reply, seen) => reviewRun.runReview({ session: session(), pr: null, reviewScope: 'session-only',
  judge: judgeWith(narrative, reply, seen) });

const typesOf = (request) => [...new Set(request.challenge.items.map((item) => item.type))];
const keysOf = (request) => request.challenge.items.map((item) => item.key);
const ofType = (seen, type) => seen.filter((request) => request.challenge && typesOf(request).includes(type));
const statuses = (report) => report.findings.filter((f) => f.kind === 'claim_contradicted')
  .map((f) => `${f.status}${f.disclosureReason ? `/${f.disclosureReason}` : ''}`);
const labels = (report) => report.writtenClaims.map((w) => [w.stated.eventId, w.label]);
const resultsOf = (record, keys) => record.results.filter((r) => keys.includes(r.key));
const RESOLUTION_KEYS = ['claims:0:resolution', 'claims:1:resolution'];
const WRITTEN_KEYS = ['writtenClaims:0', 'writtenClaims:1'];
const CLAIM_KEYS = ['claims:0', 'claims:1'];
/** A malformed reply: the vote on the batch's LAST item is filed under a key nobody asked about. */
const misKeyed = (request) => ({ votes: request.challenge.items.map((item, at, all) =>
  vote(at === all.length - 1 ? `${item.key}-unknown` : item.key)) });

// ---- premise -------------------------------------------------------------------------------------------

test('M33 I3 premise: the synthetic window publishes both self-corrections and both contradicted notes', async () => {
  const report = await review(narrativeOf());
  assert.deepEqual(statuses(report), ['FYI/self_corrected', 'FYI/self_corrected']);
  assert.deepEqual(labels(report), [['W1', 'contradicted'], ['W2', 'contradicted']]);
  assert.equal(report.counts.resolutions.verified, 2);
  assert.equal(report.windowResults.length, 1, 'one window holds every item');
  assert.equal(report.sessionReview, 'complete');
});

// ---- the batching rule ---------------------------------------------------------------------------------

test('M33 I3: two resolution items share one call per pass, and never a call with a proposal or a written item', async () => {
  const seen = [];
  await review(narrativeOf(), null, seen);
  const challenged = seen.filter((request) => request.challenge);
  for (const request of challenged)
    assert.equal(typesOf(request).length, 1, `${request.label}: one class per call, got ${typesOf(request)}`);
  const resolutions = ofType(seen, 'resolution');
  assert.deepEqual(resolutions.map((request) => request.label),
    ['challenge:w1:resolution:b1:p1', 'challenge:w1:resolution:b1:p2', 'challenge:w1:resolution:b1:p3'],
    'one batch, three passes: 3 x ceil(2/16) calls, not 3 x 2');
  for (const request of resolutions) assert.deepEqual(keysOf(request), RESOLUTION_KEYS, 'both resolutions in each call');
  // The contradictions are asked in their own run, before any resolution, exactly as without a resolution.
  const claims = ofType(seen, 'claim');
  assert.deepEqual(claims.map((request) => keysOf(request)), Array(3).fill(CLAIM_KEYS));
  assert.ok(Math.max(...claims.map((r) => seen.indexOf(r))) < Math.min(...resolutions.map((r) => seen.indexOf(r))),
    'every proposal call is sent before the first resolution call');
});

test('M33 I3: two written statements share one call per pass, and never a call with a proposal or a resolution', async () => {
  const seen = [];
  await review(narrativeOf(), null, seen);
  const written = ofType(seen, 'written');
  assert.deepEqual(written.map((request) => request.label),
    ['challenge:w1:written:b1:p1', 'challenge:w1:written:b1:p2', 'challenge:w1:written:b1:p3']);
  for (const request of written) {
    assert.deepEqual(typesOf(request), ['written'], 'no other class beside a written item');
    assert.deepEqual(keysOf(request), WRITTEN_KEYS, 'both written statements in each call');
  }
  // The same for a window with written statements and no claims at all: still one batch per pass.
  const alone = [];
  const report = await review({ ...narrativeOf(), claims: [] }, null, alone);
  assert.deepEqual(alone.filter((request) => request.challenge).map((request) => [request.label, keysOf(request)]),
    [1, 2, 3].map((pass) => [`challenge:w1:written:b1:p${pass}`, WRITTEN_KEYS]));
  assert.deepEqual(labels(report), [['W1', 'contradicted'], ['W2', 'contradicted']]);
});

// ---- a malformed reply ---------------------------------------------------------------------------------

test('M33 I3: a malformed reply to the resolution batch is re-asked for every slot in it, and both keep their votes', async () => {
  const seen = [];
  // Pass 1's first reply to the resolution batch mis-keys ONE vote: batchVotes voids the pass for both.
  const reply = (request) => (typesOf(request).includes('resolution') && request.challenge.pass === 1
    && !request.challenge.reask ? misKeyed(request) : null);
  const report = await review(narrativeOf(), reply, seen);
  const reasks = seen.filter((request) => request.challenge?.reask);
  assert.deepEqual(reasks.map((request) => [request.label, keysOf(request)]),
    [['challenge:w1:resolution:reask:p1', RESOLUTION_KEYS]], 'one re-ask, carrying every slot the malformed reply voided');
  const record = report.windowResults[0].challenge;
  assert.equal(record.reaskCalls, 1);
  assert.equal(record.reaskedSlots, 2);
  for (const result of resultsOf(record, RESOLUTION_KEYS)) {
    assert.equal(result.votes.length, 3, result.key);
    assert.ok(result.votes.every((v) => v.valid && v.answered && v.verdict === 'not-refuted'), `${result.key}: every vote stands`);
    assert.deepEqual(result.votes.map((v) => v.reasked === true), [true, false, false], `${result.key}: pass 1 was re-asked`);
    assert.equal(result.survived, true, result.key);
  }
  assert.deepEqual(statuses(report), ['FYI/self_corrected', 'FYI/self_corrected'], 'the re-ask recovered both');
  assert.equal(report.counts.resolutions.verified, 2);
  assert.equal(report.sessionReview, 'complete');
});

test('M33 I3: a malformed resolution reply never costs a contradiction any vote; the finding stays DECIDE', async () => {
  const baselineSeen = [];
  const baseline = await review(narrativeOf({ resolved: false }), null, baselineSeen);
  assert.deepEqual(statuses(baseline), ['DECIDE', 'DECIDE'], 'premise: the contradictions alone');
  const seen = [];
  // Every reply to a resolution batch, re-asks included, is malformed.
  const report = await review(narrativeOf(), (request) => (typesOf(request).includes('resolution') ? misKeyed(request) : null), seen);
  const record = report.windowResults[0].challenge;
  // The contradictions' votes are exactly those they get without any resolution.
  assert.deepEqual(resultsOf(record, CLAIM_KEYS), resultsOf(baseline.windowResults[0].challenge, CLAIM_KEYS));
  for (const result of resultsOf(record, CLAIM_KEYS))
    assert.ok(result.votes.every((v) => v.valid && v.answered && !v.reasked), `${result.key}: untouched`);
  // The resolutions got one re-ask per pass and no vote: unexecuted, never FYI.
  assert.equal(ofType(seen, 'resolution').length, 6, 'three passes plus at most three re-asks');
  assert.equal(record.reaskCalls, 3);
  for (const result of resultsOf(record, RESOLUTION_KEYS))
    assert.ok(result.votes.every((v) => !v.answered && v.reasked === true), result.key);
  assert.deepEqual(statuses(report), ['DECIDE', 'DECIDE'], 'the contradictions decide exactly as without a resolution');
  assert.equal(report.counts.resolutions.rejected.unexecuted, 2);
  // And neither class costs the written statements anything.
  assert.deepEqual(labels(report), [['W1', 'contradicted'], ['W2', 'contradicted']]);
});

test('M33 I3: a malformed written reply is re-asked for both statements, and never costs a claim or a resolution', async () => {
  const recovered = await review(narrativeOf(), (request) => (typesOf(request).includes('written')
    && request.challenge.pass === 2 && !request.challenge.reask ? misKeyed(request) : null));
  const writtenRecord = recovered.windowResults[0].writtenChallenge;
  assert.equal(writtenRecord.reaskCalls, 1);
  assert.equal(writtenRecord.reaskedSlots, 2);
  assert.deepEqual(labels(recovered), [['W1', 'contradicted'], ['W2', 'contradicted']], 'the re-ask recovered both');
  // Every written reply malformed: both stay unverified (unexecuted); claims and resolutions untouched.
  const seen = [];
  const lost = await review(narrativeOf(), (request) => (typesOf(request).includes('written') ? misKeyed(request) : null), seen);
  assert.deepEqual(labels(lost), [['W1', 'unverified'], ['W2', 'unverified']]);
  assert.equal(lost.counts.writtenClaims.contradictionsRejected.unexecuted, 2);
  assert.equal(ofType(seen, 'written').length, 6, 'three passes plus at most three re-asks');
  assert.deepEqual(statuses(lost), ['FYI/self_corrected', 'FYI/self_corrected']);
  assert.equal(lost.windowResults[0].challenge.reaskCalls, 0, 'the window\'s own challenge spent no re-ask');
  assert.equal(lost.sessionReview, 'complete', 'written statements never make a window incomplete');
});

test('M33 I3: a cost the re-ask cannot recover — a persistently mis-keyed item voids its batch-mate too, only ever conservatively', async () => {
  // Every reply, re-asks included, mis-keys ONLY the first resolution's and the first written statement's
  // vote. Asked one item per call, the second of each would have kept its votes; batched, it loses them
  // in every pass. A voided pass costs votes only, and through them the batch-mate's FYI and `contradicted`
  // label — it can never add one: the contradiction stays DECIDE, the note stays `unverified`, each
  // counted `unexecuted`.
  const firstOnly = new Set(['claims:0:resolution', 'writtenClaims:0']);
  const report = await review(narrativeOf(), (request) => (typesOf(request).some((type) => type === 'resolution' || type === 'written')
    ? { votes: request.challenge.items.map((item) => vote(firstOnly.has(item.key) ? `${item.key}-unknown` : item.key)) } : null));
  const resolutions = resultsOf(report.windowResults[0].challenge, RESOLUTION_KEYS);
  const written = resultsOf(report.windowResults[0].writtenChallenge, WRITTEN_KEYS);
  for (const result of [...resolutions, ...written])
    assert.ok(result.votes.every((v) => !v.answered && v.reasked === true) && !result.survived, `${result.key}: no vote stands`);
  assert.deepEqual(statuses(report), ['DECIDE', 'DECIDE']);
  assert.equal(report.counts.resolutions.rejected.unexecuted, 2);
  assert.deepEqual(labels(report), [['W1', 'unverified'], ['W2', 'unverified']]);
  assert.equal(report.counts.writtenClaims.contradictionsRejected.unexecuted, 2);
  assert.equal(report.sessionReview, 'incomplete', 'an unexecuted resolution is a check that did not run, and says so');
  // The contradictions themselves were asked apart, and every one of their votes stands.
  for (const result of resultsOf(report.windowResults[0].challenge, CLAIM_KEYS))
    assert.ok(result.survived && result.votes.every((v) => v.valid && v.answered), result.key);
});

const answeredOf = (result) => result.votes.map((v) => v.answered === true);

test('M33 I3: a pass voided even after its re-ask costs that pass only — two support votes from the others still uphold', async () => {
  // Pass 1 of the resolution batch is mis-keyed in its first reply AND in its re-ask; passes 2-3 uphold.
  // challengeOutcome reads survival before execution: each resolution is upheld (FYI), not `unexecuted`,
  // and its never-answered slot still makes the window incomplete.
  const seen = [];
  const report = await review(narrativeOf(), (request) => (typesOf(request).includes('resolution')
    && request.challenge.pass === 1 ? misKeyed(request) : null), seen);
  assert.deepEqual(ofType(seen, 'resolution').map((request) => request.label),
    ['challenge:w1:resolution:b1:p1', 'challenge:w1:resolution:b1:p2', 'challenge:w1:resolution:b1:p3',
      'challenge:w1:resolution:reask:p1']);
  for (const result of resultsOf(report.windowResults[0].challenge, RESOLUTION_KEYS)) {
    assert.deepEqual(answeredOf(result), [false, true, true], `${result.key}: pass 1 never answered`);
    assert.equal(result.survived, true, `${result.key}: two grounded support votes stand`);
    assert.equal(result.executionComplete, false, result.key);
  }
  assert.deepEqual(statuses(report), ['FYI/self_corrected', 'FYI/self_corrected']);
  assert.equal(report.counts.resolutions.verified, 2);
  assert.equal(report.counts.resolutions.rejected.unexecuted, 0);
  assert.equal(report.sessionReview, 'incomplete', 'an unanswered resolution slot leaves the window incomplete, even upheld');
  // The same for written statements: labelled `contradicted` on the two passes that stand, and a written
  // slot never makes the window incomplete.
  const written = await review(narrativeOf(), (request) => (typesOf(request).includes('written')
    && request.challenge.pass === 1 ? misKeyed(request) : null));
  for (const result of resultsOf(written.windowResults[0].writtenChallenge, WRITTEN_KEYS)) {
    assert.deepEqual(answeredOf(result), [false, true, true], `${result.key}: pass 1 never answered`);
    assert.equal(result.survived, true, result.key);
  }
  assert.deepEqual(labels(written), [['W1', 'contradicted'], ['W2', 'contradicted']]);
  assert.equal(written.counts.writtenClaims.contradictionsRejected.unexecuted, 0);
  assert.deepEqual(statuses(written), ['FYI/self_corrected', 'FYI/self_corrected']);
  assert.equal(written.sessionReview, 'complete');
});

const thrown = (code) => Object.assign(new Error(code), { code });

test('M33 I3: a batched call that fails for any reason but an unreadable reply costs every batch-mate that pass, with no re-ask', async () => {
  // Pass 1's resolution call and pass 1's written call each throw model_unavailable (not in
  // REASKABLE_JUDGE_CODES): a check that did not run, for both items in the batch, and never re-asked.
  const seen = [];
  const reply = (request) => {
    if (request.challenge.pass === 1 && typesOf(request).some((type) => type === 'resolution' || type === 'written'))
      throw thrown('model_unavailable');
    return null;
  };
  const report = await review(narrativeOf(), reply, seen);
  assert.equal(seen.filter((request) => request.challenge?.reask).length, 0, 'nothing is re-asked');
  const record = report.windowResults[0].challenge, writtenRecord = report.windowResults[0].writtenChallenge;
  assert.equal(record.reaskCalls, 0);
  assert.equal(writtenRecord.reaskCalls, 0);
  for (const result of [...resultsOf(record, RESOLUTION_KEYS), ...resultsOf(writtenRecord, WRITTEN_KEYS)]) {
    assert.deepEqual(answeredOf(result), [false, true, true], `${result.key}: pass 1 lost for both batch-mates`);
    assert.equal(result.survived, true, `${result.key}: the other two passes still uphold`);
  }
  assert.deepEqual(statuses(report), ['FYI/self_corrected', 'FYI/self_corrected']);
  assert.deepEqual(labels(report), [['W1', 'contradicted'], ['W2', 'contradicted']]);
  assert.equal(report.sessionReview, 'incomplete');
  // Contrast: an unreadable reply (model_response_invalid, the one REASKABLE code) takes its pass's re-ask.
  const reaskable = await review(narrativeOf(), (request) => {
    if (request.challenge.pass === 1 && !request.challenge.reask && typesOf(request).includes('resolution'))
      throw thrown('model_response_invalid');
    return null;
  });
  const recovered = reaskable.windowResults[0].challenge;
  assert.equal(recovered.reaskCalls, 1);
  assert.equal(recovered.reaskedSlots, 2);
  for (const result of resultsOf(recovered, RESOLUTION_KEYS)) assert.equal(result.executionComplete, true, result.key);
  assert.equal(reaskable.sessionReview, 'complete');
});

// ---- accepted risk: a well-formed key swap between batch-mates ------------------------------------------

/** The honest challenger: claims:0's resolution holds and claims:1's does not; writtenClaims:0 is shown
 *  false by its result and writtenClaims:1 is not. Each vote cites its own item's evidence. */
const HONEST = {
  'claims:0:resolution': vote('claims:0:resolution', 'not-refuted', RESOLVED_A.observation),
  'claims:1:resolution': vote('claims:1:resolution', 'refuted', RESOLVED_B.statement),
  'writtenClaims:0': vote('writtenClaims:0', 'not-refuted', WRITTEN_A.contradictedBy),
  'writtenClaims:1': vote('writtenClaims:1', 'refuted', WRITTEN_B.stated),
};
const SWAPPABLE = new Set(['resolution', 'written']);
const honest = (request) => (typesOf(request).some((type) => SWAPPABLE.has(type))
  ? { votes: keysOf(request).map((key) => HONEST[key]) } : null);
/** Well-formed: every asked key voted on exactly once — but each with its batch-mate's vote. */
const swapped = (request) => {
  if (!typesOf(request).some((type) => SWAPPABLE.has(type))) return null;
  const keys = keysOf(request);
  return { votes: keys.map((key, at) => ({ ...HONEST[keys[keys.length - 1 - at]], key })) };
};

test('M33 I3 accepted-risk premise: a reply that swaps two batch-mates\' votes is well-formed — nothing is re-asked', async () => {
  const truth = await review(narrativeOf(), honest);
  assert.deepEqual(statuses(truth), ['FYI/self_corrected', 'DECIDE']);
  assert.deepEqual(labels(truth), [['W1', 'contradicted'], ['W2', 'unverified']]);
  assert.equal(truth.sessionReview, 'complete');
  const seen = [];
  const report = await review(narrativeOf(), swapped, seen);
  assert.equal(seen.filter((request) => request.challenge?.reask).length, 0, 'a well-formed reply takes no re-ask');
  for (const result of [...resultsOf(report.windowResults[0].challenge, RESOLUTION_KEYS),
    ...resultsOf(report.windowResults[0].writtenChallenge, WRITTEN_KEYS)])
    assert.deepEqual(answeredOf(result), [true, true, true], `${result.key}: every pass answered`);
  assert.equal(report.sessionReview, 'complete', 'nothing in the record says a check went wrong');
});

// Formerly known failures (todo), closed by M33 C's vote binding for batch-mates with DISJOINT events: a precision
// failure caused by same-class batching that the re-ask cannot recover. Each assertion is the precision property
// only: a swap may cost the honest FYI or `contradicted` label (conservative), but must never publish one the honest
// challenger withheld. Ordinary proposal batches are bound the same way (a contradicted or supported claim).

test('M33 I3 vote binding: a resolution key swap between batch-mates with disjoint events never publishes FYI for the refuted one', async () => {
  const report = await review(narrativeOf(), swapped);
  assert.equal(statuses(report)[1], 'DECIDE', 'claims:1: its resolution was refuted, so the contradiction must stay DECIDE');
  // The swapped support vote cites claims:0's correction, none of claims:1's events: answered, never support.
  const [swappedSupport] = resultsOf(report.windowResults[0].challenge, ['claims:1:resolution']);
  assert.ok(swappedSupport.votes.every((v) => v.answered && !v.valid && v.cause === 'support_unbound'));
  assert.equal(report.counts.resolutions.verified, 0, 'the swap costs the honest FYI too — conservatively');
});

test('M33 I3 vote binding: a written key swap between batch-mates with disjoint events never labels contradicted the cleared one', async () => {
  const report = await review(narrativeOf(), swapped);
  assert.deepEqual(labels(report)[1], ['W2', 'unverified'], 'writtenClaims:1: its contradiction was refuted, so it must stay unverified');
  assert.deepEqual(labels(report)[0], ['W1', 'unverified'], 'and the honest label is lost, never gained');
});

// Known failures (todo), by the coordinator's decision after M33 C's second recheck: the same swap between
// batch-mates that SHARE an event. Claim B's proposed resolution cites the replay rerun (A2-r) that also resolves
// claim A — the wrong measurement, so the honest challenger refutes it; written statement B is said to be
// contradicted by the replay run (A1-r) that contradicts written statement A — the wrong measurement again. A
// swapped support vote cites A's evidence, which is B's own event too: it binds, and code cannot tell it from an
// honest vote that cites the shared event without hiding that vote. Behaviour is not changed here.
const SHARED_SWAP_RISK = 'Known limit: when two items of one class checked in one request share an event, a reply that '
  + 'swaps their keys is well-formed and binds; code cannot tell it apart without hiding honest votes';
const RESOLVED_B_SHARED = { observation: RESOLVED_A.observation, statement: RESOLVED_B.statement };
const WRITTEN_B_SHARED = { ...WRITTEN_B, contradictedBy: WRITTEN_A.contradictedBy };
const sharedNarrative = () => ({ ...narrativeOf(), claims: [{ ...CLAIM_A, resolvedBy: RESOLVED_A }, { ...CLAIM_B, resolvedBy: RESOLVED_B_SHARED }],
  writtenClaims: [WRITTEN_A, WRITTEN_B_SHARED] });
const HONEST_SHARED = { ...HONEST,
  'claims:1:resolution': vote('claims:1:resolution', 'refuted', RESOLVED_B_SHARED.statement),
  'writtenClaims:1': vote('writtenClaims:1', 'refuted', WRITTEN_B_SHARED.stated) };
const sharedReply = (swap) => (request) => {
  if (!typesOf(request).some((type) => SWAPPABLE.has(type))) return null;
  const keys = keysOf(request);
  return { votes: keys.map((key, at) => ({ ...HONEST_SHARED[swap ? keys[keys.length - 1 - at] : key], key })) };
};

test('M33 I3 accepted-risk premise: batch-mates sharing an event — the honest reply publishes only what it upholds', async () => {
  const truth = await review(sharedNarrative(), sharedReply(false));
  assert.deepEqual(statuses(truth), ['FYI/self_corrected', 'DECIDE']);
  assert.deepEqual(labels(truth), [['W1', 'contradicted'], ['W2', 'unverified']]);
  assert.equal(truth.sessionReview, 'complete');
});

test('M33 I3 known failure: a resolution key swap between batch-mates sharing an event never publishes FYI for the refuted one', { todo: SHARED_SWAP_RISK }, async () => {
  const report = await review(sharedNarrative(), sharedReply(true));
  assert.equal(statuses(report)[1], 'DECIDE', 'claims:1: its resolution was refuted, so the contradiction must stay DECIDE');
});

test('M33 I3 known failure: a written key swap between batch-mates sharing an event never labels contradicted the cleared one', { todo: SHARED_SWAP_RISK }, async () => {
  const report = await review(sharedNarrative(), sharedReply(true));
  assert.deepEqual(labels(report)[1], ['W2', 'unverified'], 'writtenClaims:1: its contradiction was refuted, so it must stay unverified');
});

// ---- the cost of the rule ------------------------------------------------------------------------------

test('M33 I3: k items of one class cost 3 x ceil(k/16) planned calls plus 3 x ceil(k/16) re-asks at most', async () => {
  const verifyReceipt = (r) => ({ ok: true, receipt: r });
  for (const type of ['resolution', 'written']) {
    for (const k of [1, 2, 16, 17, 33]) {
      // M33 C2 repair: a claim-class item is asked only with code's grounded words (`verbatim`), as the run gives it.
      const items = Array.from({ length: k }, (_, i) => ({ key: `${type}:${i}`, type, candidate: { text: `synthetic ${i}`,
        stated: { eventId: 'C0', role: 'commentary', quote: `synthetic said ${i}` } }, verbatim: { quote: `synthetic said ${i}` } }));
      const labels = [];
      // Every first reply is malformed; every re-ask answers.
      const judge = async (request) => {
        labels.push(request.label);
        return request.challenge.reask ? { votes: request.challenge.items.map(upholdAll) } : misKeyed(request);
      };
      const run = await challenge.challengeItems({ items, judge, evidence: 'Synthetic evidence.', verifyReceipt });
      const batches = Math.ceil(k / challenge.CHALLENGE_PROFILE.maxItemsPerBatch);
      assert.equal(run.plannedCalls, 3 * batches, `${type} k=${k}`);
      // S2 (2026-10-13): each pass's re-ask covers every voided slot, in as many batches as the item bound needs.
      assert.equal(run.reaskCalls, challenge.CHALLENGE_PROFILE.passes * batches, `${type} k=${k}: every slot re-asked`);
      assert.equal(run.reaskedSlots, challenge.CHALLENGE_PROFILE.passes * k, `${type} k=${k}: each slot once`);
      assert.equal(labels.length, 6 * batches, `${type} k=${k}`);
      assert.ok(run.plannedCalls <= 3 * k, `${type} k=${k}: never more planned calls than one item per call`);
      if (k > 1) assert.ok(run.plannedCalls < 3 * k, `${type} k=${k}: fewer planned calls than one item per call`);
      // A re-ask obeys the same item bound, and no voided slot is left unexecuted.
      assert.equal(run.results.filter((r) => !r.executionComplete).length, 0, `${type} k=${k}`);
      assert.equal(run.survivors.length, k, `${type} k=${k}: every re-asked slot answered`);
    }
  }
});

// ---- no request byte changed (D60) ---------------------------------------------------------------------

const digest = (text) => createHash('sha256').update(text, 'utf8').digest('hex');
/**
 * Owner decision 2026-10-05 (M33 light fixes, G3): `sonah.challenge/11` amended in one SYSTEM sentence — a support
 * candidate's result is "recorded before or after it, said to confirm it" (m33-support-order-fixture.js). The new
 * bytes of the shared system prompt and of a claim-class batch's system; rendered back, each is /11's below.
 */
const MOVED_BY_SUPPORT_ORDER = Object.freeze({
  shared: '4c885bdf8522d331c9bd9b28710207af07a265f87b41a124b08f6e8935f3f335',
  batch: '45dcf9ebf8bad06563586b830686d197c8d832dac73c075e43c75a49e68a6f79',
});
const beforeSupportOrder = (system) => requestBeforeSupportOrder({ system }).system;

/**
 * H3 (`sonah.challenge/13`): the ONLY values that moved from /11's — the shared system
 * prompt (`shared`: a claim is a statement about the state or the outcome of the work, hedged or not; a contradiction is
 * refuted when the quoted words assert nothing about it), so this claim-class batch's system (`system`), and the version.
 * Rendered back as /11 sent it (h3-hedged-claims-fixture.js `beforeHedgedClaims`), the shared prompt is /11's f5088620…
 * and the batch's system /11's 5cf2ddec…, byte for byte.
 * H3's review repair (2026-10-06; /13, was /12) re-pinned these values once, in place: the relay sentence's example
 * phrasings are gone and a hedge on a relay is not doubt — the same prompt moved, by the same fixture's texts, and the
 * render-back still reproduces /11's values.
 * The owner's decision of 2026-10-06 (still /13) re-pinned `system` once more, in place: CLAIM_WORDS_NOTE lists no kinds
 * of statement (the quoted text may narrow what the words assert and never widens it), so this claim-class batch's
 * system moved and `shared` did not; the same fixture renders the note back, and /11's 5cf2ddec… still reproduces.
 */
const MOVED_BY_H3 = Object.freeze({ version: 'sonah.challenge/13',
  shared: '00c25b67f253b6af2186b8c1d23646d73236d579b9296b955f5330f91d932b0d',
  system: '7ed41837cdc7a494d20f5676ea1c6077000e45463553a42efe93e98d1e65a4e9' });

/**
 * M33 integration (2026-10-06; `sonah.challenge/15`): the claim-class batch's system as the merged code sends it — the
 * shared system prompt with the status fact's sentence, H3's texts and G3's support-order sentence, then H3's
 * CLAIM_WORDS_NOTE — and the one version above every branch's own. No branch sent these bytes; each branch's own value
 * reproduces with the other branches' texts rendered back (the test below), and /11's through all of them.
 */
const MOVED_BY_INTEGRATION = Object.freeze({ version: 'sonah.challenge/15',
  system: 'b7632c847973ac9744e9b264043311745ff67c8ace4ee976e752da079754d896' });
/**
 * Disclosure narrowed (owner decision 2026-10-06; `sonah.challenge/16`): a disclosure item's proposition and
 * DISCLOSURE_NOTE, sent only to a batch holding one. The ONLY value that moved from `MOVED_BY_INTEGRATION` is the
 * version: this claim-class batch's system did not move (its digest is MOVED_BY_INTEGRATION's, byte for byte).
 */
const MOVED_BY_DISCLOSURE_NARROW = Object.freeze({ ...MOVED_BY_INTEGRATION, version: 'sonah.challenge/16' });
/**
 * Stable event ids (C-01 event identity, 2026-10-07; `sonah.challenge/17`): a recorded session's event ids, which every
 * challenge request shows, moved. The ONLY value that moved from `MOVED_BY_DISCLOSURE_NARROW` is the version: no system
 * text moved (this claim-class batch's system is MOVED_BY_INTEGRATION's, byte for byte), and this session is hand-built,
 * so it keeps its positional ids.
 */
const MOVED_BY_STABLE_IDS = Object.freeze({ ...MOVED_BY_DISCLOSURE_NARROW, version: 'sonah.challenge/17' });
/**
 * M35 windowing (`sonah.challenge/18`): a session-only challenge request names events by its window's aliases and its
 * evidence is the window and its carried context. The ONLY value that moved from `MOVED_BY_STABLE_IDS` is the version:
 * no system text moved (this claim-class batch's system is MOVED_BY_INTEGRATION's, byte for byte).
 */
const MOVED_BY_WINDOWING = Object.freeze({ ...MOVED_BY_STABLE_IDS, version: 'sonah.challenge/18' });
/**
 * M36 phase 1, recording fidelity (D68; `sonah.challenge/19`): the evidence a challenge request carries moved for a real
 * session (whole bodies, statements and reports, newly shown observations, new Codex actions). The ONLY value that moved
 * from `MOVED_BY_WINDOWING` is the version: no system text moved (this claim-class batch's system is
 * MOVED_BY_INTEGRATION's, byte for byte).
 */
const MOVED_BY_RECORDED_FACTS = Object.freeze({ ...MOVED_BY_WINDOWING, version: 'sonah.challenge/19' });
/**
 * M36 phase 2, the window format (D68; `sonah.challenge/20`): every evidence byte a challenge request shows moved (a
 * RESULT's label line and its cut on whole lines, commands whole, an edit as its recorded hunk runs). The ONLY value that
 * moved from `MOVED_BY_RECORDED_FACTS` is the version: no system text moved (this claim-class batch's system is
 * MOVED_BY_INTEGRATION's, byte for byte).
 */
const MOVED_BY_M36_FORMAT = Object.freeze({ ...MOVED_BY_RECORDED_FACTS, version: 'sonah.challenge/20' });
/**
 * M36 phase 3 (D68 K, Q, F; `sonah.challenge/21`): the evidence a challenge request shows moved for a window of several
 * sessions, a carried proven failure or a served section. The ONLY value that moved from `MOVED_BY_M36_FORMAT` is the
 * version: no system text moved.
 */
const MOVED_BY_M36_CONVERSATION = Object.freeze({ ...MOVED_BY_M36_FORMAT, version: 'sonah.challenge/21' });
/**
 * Owner decisions D69 (2026-10-08; `sonah.challenge/22`): the evidence a challenge request shows moved as the
 * narrative's (no file changed twice is declared; the harness home folders; the recorder's cwd). The ONLY value that
 * moved from `MOVED_BY_M36_CONVERSATION` is the version: no system text moved.
 */
const MOVED_BY_D69 = Object.freeze({ ...MOVED_BY_M36_CONVERSATION, version: 'sonah.challenge/22' });
/**
 * The D69 review (2026-10-08; `sonah.challenge/23`): the evidence a challenge request shows moved as the narrative's (a
 * combined window's omission lines offer no request; typed withholding; paths outside the cwd spelled as recorded). The
 * ONLY value that moved from `MOVED_BY_D69` is the version: no system text moved.
 */
const MOVED_BY_D69_REVIEW = Object.freeze({ ...MOVED_BY_D69, version: 'sonah.challenge/23' });
/**
 * D71 (S2; `sonah.challenge/24`): a SESSION-ONLY batch is sent the session challenge's core and the notes
 * of its own item types (challenge.js `checklistSystem`) — SESSION_BATCH_D71 for this claim-class batch — so the shared
 * system prompt and the combined route's claim-class batch system above are /23's bytes, still sent by the combined route
 * (D71 i). The version moved once.
 */
const MOVED_BY_D71_BRIEF = Object.freeze({ ...MOVED_BY_D69_REVIEW, version: 'sonah.challenge/24' });
const SESSION_BATCH_D71 = '513750873bbdca2a6602fe6ab53f31e47061aea1c1cbff855e293e6434bec3b2';
/**
 * D71 (S3, the new channels; `sonah.challenge/25`): the session challenge's core names a sixth receipt role and its claim
 * note says how a contradiction that is not a result is judged, so this claim-class batch's session system moved
 * (SESSION_BATCH_D71_CHANNELS); the combined route's claim-class batch system above did not (D71 i). The version moved once.
 */
const MOVED_BY_D71_CHANNELS = Object.freeze({ ...MOVED_BY_D71_BRIEF, version: 'sonah.challenge/25' });
const SESSION_BATCH_D71_CHANNELS = '2e53eaaf36c6294fd1c5eb362d7e648584ac3d5ccc72d829b11df1921524377b';
/** S7 (`sonah.challenge/26`): only the failure note moved (a batch holding a failure
 *  item), so neither this claim-class batch's session system nor the combined one moved. The version moved once. */
const MOVED_BY_S7 = Object.freeze({ ...MOVED_BY_D71_CHANNELS, version: 'sonah.challenge/26' });
/** The column fix (owner decisions D83 (2) and D84; `sonah.challenge/30`): only DECISION_NOTE and the decision
 *  propositions moved (a batch holding a decision item), so neither this claim-class batch's session system nor the
 *  combined one moved. The version moved once. */
const MOVED_BY_FIX_COLUMN = Object.freeze({ ...MOVED_BY_S7, version: 'sonah.challenge/30' });
/** W1 B (owner decision 2026-10-13; `sonah.challenge/31`): only FORBIDDEN_EDIT_NOTE moved and a forbidden edit against a
 *  project instruction file has a proposition of its own (a batch holding a forbidden-edit item), so neither this
 *  claim-class batch's session system nor the combined one moved. The version moved once. */
const MOVED_BY_W1 = Object.freeze({ ...MOVED_BY_FIX_COLUMN, version: 'sonah.challenge/31' });
/** W2 (owner decision 2026-10-13; `sonah.challenge/32`): CLAIM_NOTE moved (the agent's own written text as a
 *  contradiction, judged like a result), so this claim-class batch's session system moved; rendered back
 *  (`textBeforeW2`), it is SESSION_BATCH_D71_CHANNELS byte for byte. The combined one did not move. */
const SESSION_BATCH_W2 = '1a82803dbbb011f56c5530f531243bc488e7fe66c1dd84f2305feea6eee6153a';
const MOVED_BY_W2 = Object.freeze({ ...MOVED_BY_W1, version: 'sonah.challenge/32' });
/** W3 F1(b) and F2 (owner decision 2026-10-13; `sonah.challenge/33`, then `/34`): CLAIM_NOTE moved once more (a support
 *  with changes recorded since its run, listed under "changed since:"; a failed run's result supports only words that
 *  it failed), so this claim-class batch's session system moved; rendered back (`textBeforeW3`), it is SESSION_BATCH_W2
 *  byte for byte. The combined one did not move. */
const SESSION_BATCH_W3 = 'ef723445ba8f11d7e71c5b1c30e2c4ff8fbd901ca70767240ac6358ff298b684';
const MOVED_BY_W3 = Object.freeze({ ...MOVED_BY_W2, version: 'sonah.challenge/34' });
/** The fix review (2026-10-14; `sonah.challenge/35`): CLAIM_NOTE's failed-result sentence names a cancelled or stopped
 *  result too, so this claim-class batch's session system moved; rendered back (`textBeforeFixReview`), it is
 *  SESSION_BATCH_W3 byte for byte. The combined one did not move. Then `/36`: only FORBIDDEN_EDIT_NOTE and the file form
 *  of the forbidden-edit proposition moved, and `/37`: only the existence run's batches, so neither system here moved. */
const SESSION_BATCH_FIX_REVIEW = 'c74803091b097aa45a4e38fbdddca60440fc3dec433e486d68e35922117544d8';
const MOVED_BY_FIX_REVIEW = Object.freeze({ ...MOVED_BY_W3, version: 'sonah.challenge/37' });
/** D87 (owner decisions 2026-10-13/14; `sonah.challenge/38`, its `/35` renumbered at its merge with the fix
 *  review): the code pass's own run (its core, notes and propositions, sent only to a code-pass batch), so
 *  neither this claim-class batch's session system nor the combined one moved. The version moved once. */
const MOVED_BY_CODE_PASS = Object.freeze({ ...MOVED_BY_FIX_REVIEW, version: 'sonah.challenge/38' });
/** The code step (`sonah.challenge/39`): the code pass's run left `challengeItems` for its own
 *  runner (`challengeCodeStep`), so no session or combined batch's system moved. The version moved once. */
const MOVED_BY_CODE_STEP = Object.freeze({ ...MOVED_BY_CODE_PASS, version: 'sonah.challenge/39' });
/** The review of the code step (`sonah.challenge/40`): the code step's own run lost `duplicate` and shows a finding's
 *  checker no agent words, so no session or combined batch's system moved. The version moved once. */
const MOVED_BY_CODE_STEP_REVIEW = Object.freeze({ ...MOVED_BY_CODE_STEP, version: 'sonah.challenge/40' });
/** The second review of the code step (`sonah.challenge/41`): a code check's checker sees no word of the agent's in any
 *  row, so no session or combined batch's system moved. The version moved once. */
const MOVED_BY_CODE_STEP_REREVIEW = Object.freeze({ ...MOVED_BY_CODE_STEP_REVIEW, version: 'sonah.challenge/41' });
/** The third review of the code step (`sonah.challenge/42`): a code check's checker sees what its row states again, so
 *  no session or combined batch's system moved. The version moved once. */
const MOVED_BY_CODE_STEP_THIRD_REVIEW = Object.freeze({ ...MOVED_BY_CODE_STEP_REREVIEW, version: 'sonah.challenge/42' });

test('M33 I3: the challenge/10 system prompt is frozen bytes; stored answers stay keyed to them (D60)', async () => {
  const seen = [];
  await review(narrativeOf(), null, seen);
  const systems = new Set(seen.filter((request) => request.challenge).map((request) => request.system));
  assert.equal(systems.size, 1, 'every class is asked with the one challenge system prompt');
  // D71 (S2): the session route's batch system is the core and its claim note; the combined route's claim-class batch
  // system (`batch`) is what every value below pins, unchanged.
  const [sessionSystem] = [...systems];
  assert.equal(sessionSystem, challenge.checklistSystem(['claim']));
  const batch = `${challenge.challengeSystem()}\n${challenge.CLAIM_WORDS_NOTE}`;
  // M33 C2 (challenge/9): every class here is a claim class, so every batch is sent the shared system prompt — /8's
  // bytes, unchanged — and then code's fixed CLAIM_WORDS_NOTE. A batch holding no claim-class item is sent /8's bytes.
  // M33 H repair (challenge/10): the shared system prompt moved by the relay rule alone — rendered back as /9 sent it
  // (`beforeRelayRule`), it is /8's and /9's ed87be33… byte for byte, and the claim-class batch's system is /9's ce6edb1c….
  // Status fact (its branch's challenge/12): one sentence of the shared system prompt; H3 (its branch's challenge/13): the
  // claim definition and the relay sentence (MOVED_BY_H3); G3 (M33 light fixes, challenge/11 amended): the support-order
  // sentence alone (MOVED_BY_SUPPORT_ORDER). Each branch's own value reproduces with the other two's texts rendered back,
  // and rendered back through all three (`beforeStatusFact`, `beforeHedgedClaims`, `beforeSupportOrder`) it is /10's and
  // /11's f5088620… byte for byte.
  assert.equal(digest(beforeSupportOrder(beforeHedgedClaims(challenge.challengeSystem()))),
    '36ba106f7f8a0c708e75d0a6177ed00d50e0b1687c9303dfbe43aa0379e8837f', 'the shared system prompt moved by the status fact');
  assert.equal(digest(beforeSupportOrder(beforeStatusFact(challenge.challengeSystem()))), MOVED_BY_H3.shared,
    'the shared system prompt moved by H3');
  assert.equal(digest(beforeStatusFact(beforeHedgedClaims(challenge.challengeSystem()))), MOVED_BY_SUPPORT_ORDER.shared,
    'the shared system prompt moved by the support-order sentence');
  assert.equal(digest(beforeStatusFact(beforeHedgedClaims(batch))), MOVED_BY_SUPPORT_ORDER.batch);
  const sent11 = (text) => beforeSupportOrder(beforeStatusFact(beforeHedgedClaims(text)));
  assert.equal(digest(sent11(challenge.challengeSystem())), 'f5088620f2c57b30db4027d5c6bb046bd167f179ecf42ed03aea68208a255a5a',
    'the shared system prompt moved by the relay rule');
  assert.equal(digest(beforeRelayRule(sent11(challenge.challengeSystem()))),
    'ed87be3319f3bfa2fedccd25ae13ea1f8fea51d8cdbe9a1bb2fa53ace04e9b2b', 'and by nothing else');
  assert.equal(digest(beforeRelayRule(sent11(batch))), 'ce6edb1c59234774ef18b2c540838ee97866b12d4ec8d9be263a87fd505bf168');
  assert.equal(digest(sent11(batch)), '5cf2ddec1a9eb5a0dab0f297c05a328c9cb1e2d161e4f291c8d3af0366c3594a', '/11\'s');
  assert.equal(digest(sessionSystem), SESSION_BATCH_FIX_REVIEW, 'the session route\'s claim-class batch system (fix review)');
  assert.equal(digest(textBeforeFixReview(sessionSystem)), SESSION_BATCH_W3,
    'the session route\'s claim-class batch system (W3)');
  assert.equal(digest(textBeforeW3(sessionSystem)), SESSION_BATCH_W2, 'the session route\'s claim-class batch system (W2)');
  assert.equal(digest(textBeforeW2(sessionSystem)), SESSION_BATCH_D71_CHANNELS,
    'the session route\'s claim-class batch system (D71 S3), rendered back');
  assert.notEqual(SESSION_BATCH_D71_CHANNELS, SESSION_BATCH_D71);
  assert.deepEqual({ version: challenge.CHALLENGE_PROFILE.version, system: digest(batch) },
    // M33 C: version 8 — the claim and support criteria and the vote-binding sentence (was challenge/7, 64892e12…).
    // M33 C repair: the support item's own criterion and the binding sentence, before version 8 was ever released
    // (e8dcbad's unreleased 93016610… is superseded; D60 keys on bytes, so an answer to it can only miss).
    // M33 C2: version 9 — a claim-class batch's system is ed87be33… followed by CLAIM_WORDS_NOTE.
    // M33 C2 repair: the note names code's grounded words and their context, before version 9 was ever released
    // (c1ae0c9's unreleased a0b57e6d… is superseded; D60 keys on bytes, so an answer to it can only miss).
    // M33 H repair: version 10 — the shared system prompt says a relay of another agent's report is the passing
    // agent's own claim (was challenge/9, ce6edb1c…). M33 N: version 11 — a forbidden-edit item and its note, sent only
    // to a batch holding one; the shared system prompt and this batch's system did not move (5cf2ddec…). Status fact
    // (M33 outcomes repair): version 12 — one sentence of the shared system prompt. H3 (M33 claims repair): version
    // 12, the shared system prompt's claim definition, and its review repair version 13, the relay sentence (MOVED_BY_H3);
    // then, before 13 was ever released, CLAIM_WORDS_NOTE's list of statement kinds (owner decision, 2026-10-06).
    // M33 brittleness M3 (M33 forbidden-edit repair): version 12 — a forbidden-edit item names its breach and the note says
    // what each is; this batch's system did not move (the version moves because a forbidden-edit batch's bytes did). M33
    // brittleness M4: version 13 — a disclosure item and its note, sent only to a batch holding one; this batch's system
    // did not move. M4's session route: version 14 — a forbidden-edit item no longer shows the agent's statement (asked
    // as a disclosure item); this batch's system did not move. G3 (M33 light fixes): /11 amended in place — the
    // support-order sentence (MOVED_BY_SUPPORT_ORDER). M33 integration: version 15, one above every branch's own, for
    // the merged prompt: the status fact's, H3's and G3's SYSTEM texts and H3's note (MOVED_BY_INTEGRATION). The
    // disclosure narrowing: version 16 — a disclosure item's proposition and note; this batch's system did not move
    // (MOVED_BY_DISCLOSURE_NARROW). Stable event ids: version 17 — a recorded session's event ids; this batch's system did
    // not move (MOVED_BY_STABLE_IDS). M35 windowing: version 18 — aliases and the window's evidence; this batch's system
    // did not move (MOVED_BY_WINDOWING). M36 phase 1: version 19 — the evidence it carries; this batch's system did not
    // move (MOVED_BY_RECORDED_FACTS). M36 phase 2: version 20 — the window format; this batch's system did not move
    // (MOVED_BY_M36_FORMAT). M36 phase 3: version 21 — packed windows, carried failures, served sections; this batch's
    // system did not move (MOVED_BY_M36_CONVERSATION). D69 moved the version once more; no system text (MOVED_BY_D69).
    // The D69 review moved the version once more; no system text (MOVED_BY_D69_REVIEW). D71 (S2) moved the version once
    // more; this (combined) batch's system did not move (MOVED_BY_D71_BRIEF). D71 (S3) moved the version once more; this
    // (combined) batch's system did not move (MOVED_BY_D71_CHANNELS). S7 moved the version once more; this batch's system
    // did not move (MOVED_BY_S7). The column fix moved the version once more; this batch's system did not move
    // (MOVED_BY_FIX_COLUMN). W1 B moved the version once more; this batch's system did not move (MOVED_BY_W1). W2 moved
    // the version once more; this (combined) batch's system did not move (MOVED_BY_W2). W3 F1(b) moved the version once
    // more; this (combined) batch's system did not move (MOVED_BY_W3). The fix review moved the version once more; this
    // (combined) batch's system did not move (MOVED_BY_FIX_REVIEW). D87 moved the version once more; no batch's system
    // here moved (MOVED_BY_CODE_PASS). The code step moved the version once more; no batch's system here moved
    // (MOVED_BY_CODE_STEP). The review of the code step moved the version once more; no batch's system here moved
    // (MOVED_BY_CODE_STEP_REVIEW). The second review of the code step moved the version once more; no batch's system
    // here moved (MOVED_BY_CODE_STEP_REREVIEW). The third review of the code step moved the version once more; no
    // batch's system here moved (MOVED_BY_CODE_STEP_THIRD_REVIEW).
    MOVED_BY_CODE_STEP_THIRD_REVIEW,
    'a change to the challenge system prompt moves the version and misses every stored challenge answer');
});

// ---- the comments say what the code does --------------------------------------------------------------

const sourceOf = (file) => readFile(new URL(`../src/${file}`, import.meta.url), 'utf8');
const commentText = (line) => line.match(/^\s*(?:\/\/|\/\*\*|\*\/?)\s?(.*)$/)?.[1];
const flat = (lines) => lines.join(' ').replace(/\s+/g, ' ');

/** A source file's comment-looking lines, flattened — for the stale wording that must be gone anywhere. */
const commentsOf = async (file) => flat((await sourceOf(file)).split('\n').map(commentText).filter((t) => t !== undefined));

/** The one comment block directly above the first code line of `file` starting with `anchor`, flattened:
 *  the contiguous `//` or `/** … *\/` lines, never a line of a template literal such as prompt text. */
async function commentAbove(file, anchor) {
  const lines = (await sourceOf(file)).split('\n');
  const at = lines.findIndex((line) => line.trimStart().startsWith(anchor));
  assert.ok(at > 0, `${file}: no line starts with ${anchor}`);
  const block = [];
  for (let i = at - 1; i >= 0 && commentText(lines[i]) !== undefined; i--) block.unshift(commentText(lines[i]));
  assert.ok(block.length > 0, `${file}: no comment above ${anchor}`);
  return flat(block);
}

const RULE = /never in a batch with an ordinary proposal or with the other class/;
const REASK = /bounded per-pass re-ask/;
const STALE = [/never in a batch with any other item/, /never beside another item/];

test('M33 I3: the comments state the batching rule the tests above pin, not "never beside another item"', async () => {
  for (const file of ['challenge.js', 'run-review.js']) {
    const comments = await commentsOf(file);
    for (const stale of STALE) assert.ok(!stale.test(comments), `${file} still claims one item per call (${stale.source})`);
  }
  // Each named block, where the rule is stated: the CHALLENGE_PROFILE version-7 note, the
  // writtenStatementsOf doc, the H1b resolution comment, and the `ask` comment.
  const blocks = [
    ['challenge.js', 'export const CHALLENGE_PROFILE', [RULE, REASK]],
    ['run-review.js', 'async function writtenStatementsOf(', [RULE, REASK]],
    ['run-review.js', 'challenge = resolutions.length', [RULE, REASK]],
    ['run-review.js', 'ask = (list,', [/batched together within the challenge profile's item and byte limits/]],
  ];
  for (const [file, anchor, rules] of blocks) {
    const block = await commentAbove(file, anchor);
    for (const rule of rules) assert.ok(rule.test(block), `${file} (${anchor}): the comment does not state ${rule.source}`);
  }
});
